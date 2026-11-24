-- How long records are kept, and erasing a customer's personal details (2026-11-24, owner's
-- decision: "as Kenyan law demands"). Closes finding EXP-07.
--
-- The law this follows:
--   - Tax Procedures Act 2015, s.23: business records are kept for at least 5 years.
--   - Companies Act 2015: a company's accounting records are kept for 7 years.
--   - Data Protection Act 2019, s.25 and s.39: personal data is kept no longer than needed, unless
--     a law requires it; s.40: a person may ask for their personal data to be erased.
--
-- 1. Money records are never deleted by the app: sales, the books, customer ledger, payments,
--    expenses, stock history, invoices (at least 7 years covers both laws above).
-- 2. The audit trail is kept for 7 years, then removed by the daily retention job only.
-- 3. Records that only serve day-to-day work are removed by the same job:
--      notifications                  1 year
--      website chat messages          2 years
--      crash reports                  90 days
--      backup run log                 1 year
-- 4. erase_customer(): on the customer's request, their name, phone, email and delivery details
--    are removed, their website account is deleted (with its chat, schedules and votes), and their
--    online orders, reviews and feedback lose the name and phone. Their sales and ledger stay, as
--    the tax law requires, now pointing at "Erased customer" (phone 0000000). Refused while the customer owes
--    money or has money in their wallet (money rule 4: settle it first). Needs customers.erase.

-- ---------------------------------------------------------------- audit trail: 7 years
CREATE OR REPLACE FUNCTION public.fn_audit_logs_append_only()
RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        -- Only the retention job, and only entries older than 7 years.
        IF current_setting('isms.retention_job', TRUE) = 'on'
           AND OLD."timestamp" < now() - interval '7 years' THEN
            RETURN OLD;
        END IF;
        RAISE EXCEPTION 'Audit log entries can''t be deleted.' USING ERRCODE = '42501';
    END IF;
    -- Only a link being blanked by its foreign key (the business, person or user was removed).
    IF (to_jsonb(NEW) - ARRAY['business_id', 'employee_id', 'user_id'])
           IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['business_id', 'employee_id', 'user_id'])
       OR (NEW.business_id IS DISTINCT FROM OLD.business_id AND NEW.business_id IS NOT NULL)
       OR (NEW.employee_id IS DISTINCT FROM OLD.employee_id AND NEW.employee_id IS NOT NULL)
       OR (NEW.user_id     IS DISTINCT FROM OLD.user_id     AND NEW.user_id     IS NOT NULL) THEN
        RAISE EXCEPTION 'Audit log entries can''t be changed.' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
END;
$$;
ALTER FUNCTION public.fn_audit_logs_append_only() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.fn_audit_logs_append_only() FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------- daily retention job
CREATE OR REPLACE FUNCTION public.run_data_retention()
RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
AS $$
DECLARE
    v_out jsonb := '{}'::jsonb;
    v_n   integer;
BEGIN
    DELETE FROM public.notifications WHERE created_at < now() - interval '1 year';
    GET DIAGNOSTICS v_n = ROW_COUNT; v_out := v_out || jsonb_build_object('notifications', v_n);

    DELETE FROM public.customer_messages WHERE created_at < now() - interval '2 years';
    GET DIAGNOSTICS v_n = ROW_COUNT; v_out := v_out || jsonb_build_object('customer_messages', v_n);

    DELETE FROM public.crash_reports WHERE last_seen_at < now() - interval '90 days';
    GET DIAGNOSTICS v_n = ROW_COUNT; v_out := v_out || jsonb_build_object('crash_reports', v_n);

    DELETE FROM public.backup_history_logs WHERE "timestamp" < now() - interval '1 year';
    GET DIAGNOSTICS v_n = ROW_COUNT; v_out := v_out || jsonb_build_object('backup_history_logs', v_n);

    PERFORM set_config('isms.retention_job', 'on', TRUE);
    DELETE FROM public.audit_logs WHERE "timestamp" < now() - interval '7 years';
    GET DIAGNOSTICS v_n = ROW_COUNT; v_out := v_out || jsonb_build_object('audit_logs', v_n);
    PERFORM set_config('isms.retention_job', 'off', TRUE);

    RETURN v_out;
END;
$$;
ALTER FUNCTION public.run_data_retention() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.run_data_retention() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.run_data_retention() TO service_role;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
        PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'data-retention';
        PERFORM cron.schedule('data-retention', '30 0 * * *', $job$SELECT public.run_data_retention()$job$);
    END IF;
END;
$$;

-- ---------------------------------------------------------------- erase a customer
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS erased_at timestamptz;

CREATE OR REPLACE FUNCTION public.erase_customer(p_customer_id uuid)
RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
AS $$
DECLARE
    v_c        public.customers%ROWTYPE;
    v_accounts uuid[];
    v_deleted  integer := 0;
    v_kept     integer := 0;
    v_acc      uuid;
    v_label    CONSTANT text := 'Erased customer';
BEGIN
    SELECT * INTO v_c FROM public.customers WHERE id = p_customer_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Customer not found.';
    END IF;
    IF public.has_permission(v_c.business_id, 'customers.erase') IS NOT TRUE THEN
        RAISE EXCEPTION 'You don''t have permission to erase customers.' USING ERRCODE = '42501';
    END IF;
    IF v_c.erased_at IS NOT NULL THEN
        RAISE EXCEPTION 'This customer''s details were already erased.';
    END IF;
    IF v_c.debt_balance > 0 THEN
        RAISE EXCEPTION 'This customer owes KSh %. Settle the debt before erasing their details.',
            to_char(v_c.debt_balance, 'FM999,999,999,990.00');
    END IF;
    IF v_c.wallet_balance > 0 THEN
        RAISE EXCEPTION 'This customer has KSh % in their wallet. Pay it back or use it before erasing their details.',
            to_char(v_c.wallet_balance, 'FM999,999,999,990.00');
    END IF;

    SELECT coalesce(array_agg(id), '{}') INTO v_accounts
    FROM public.customer_accounts WHERE customer_id = p_customer_id;

    -- Records kept for the law lose the name and contact details.
    UPDATE public.online_orders
       SET customer_name = v_label, customer_phone = '', delivery_address = NULL, notes = NULL
     WHERE account_id = ANY(v_accounts);
    UPDATE public.website_reviews SET display_name = 'Former customer' WHERE account_id = ANY(v_accounts);
    UPDATE public.complaints SET customer_name = v_label WHERE account_id = ANY(v_accounts);

    -- The website account: deleting the sign-in removes the account, its chat, schedules and votes.
    -- A sign-in that is also a staff member is kept; only the customer profile on it is cleared.
    FOREACH v_acc IN ARRAY v_accounts LOOP
        IF EXISTS (SELECT 1 FROM public.users u
                   JOIN public.business_memberships bm ON bm.user_id = u.id
                   WHERE u.auth_user_id = v_acc) THEN
            DELETE FROM public.customer_messages WHERE account_id = v_acc;
            DELETE FROM public.customer_order_schedules WHERE account_id = v_acc;
            DELETE FROM public.customer_accounts WHERE id = v_acc;
            v_kept := v_kept + 1;
        ELSE
            DELETE FROM auth.users WHERE id = v_acc;
            v_deleted := v_deleted + 1;
        END IF;
    END LOOP;

    UPDATE public.customers
       SET name = v_label,
           phone = '0000000',  -- the phone is required; this placeholder is nobody's number
           email = NULL,
           description = NULL,
           delivery_zone_id = NULL,
           delivery_address = NULL,
           delivery_building = NULL,
           delivery_landmark = NULL,
           delivery_notes = NULL,
           notify_service = FALSE,
           notify_promotions = FALSE,
           delivery_frequency = 'none',
           erased_at = now(),
           deleted_at = coalesce(deleted_at, now()),
           updated_at = now(),
           last_modified_by = 'erase_customer'
     WHERE id = p_customer_id;

    INSERT INTO public.audit_logs (business_id, user_id, action, table_name, record_id, details)
    VALUES (v_c.business_id,
            (SELECT u.id FROM public.users u WHERE u.auth_user_id = auth.uid()),
            'customer_erased', 'customers', p_customer_id::text,
            jsonb_build_object('account_number', v_c.account_number,
                               'website_accounts_deleted', v_deleted));

    RETURN jsonb_build_object('erased', TRUE, 'website_accounts_deleted', v_deleted,
                              'staff_sign_ins_kept', v_kept);
END;
$$;
ALTER FUNCTION public.erase_customer(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.erase_customer(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.erase_customer(uuid) TO authenticated, service_role;
