-- 20261105002_security_hardening.sql
-- Closes account-takeover and cross-tenant data access paths reachable with only the public anon key.
--   1. Tenant guard on every SECURITY DEFINER RPC that takes business-scoped arguments.
--   2. Server-only OTP lifecycle (see supabase/functions/auth-otp). Clients can no longer read,
--      write or receive OTP codes, or set a password by email.
--   3. Provider secrets (ai_settings, sms_settings) limited to owners/admins; backup logs scoped per tenant.
-- Deploy the auth-otp, send-email and shared edge functions BEFORE applying this migration.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Tenant guard
-- API requests always run under SET ROLE anon/authenticated, which SECURITY DEFINER does not change.
-- Any other role is a trusted backend caller (service_role, pg_cron, migrations).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.assert_business_member(p_business_id UUID)
RETURNS VOID
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF current_setting('role', TRUE) NOT IN ('anon', 'authenticated') THEN
        RETURN;
    END IF;

    IF (p_business_id = ANY(public.get_user_business_ids())) IS NOT TRUE THEN
        RAISE EXCEPTION 'You do not have access to this business.' USING ERRCODE = '42501';
    END IF;
END;
$$;

-- Prepends the guard to the deployed function body, keeping its current logic intact.
DO $migration$
DECLARE
    v_target RECORD;
    v_def    TEXT;
    v_guard  TEXT;
    v_biz    CONSTANT TEXT := 'PERFORM public.assert_business_member(p_business_id);';
    v_cust   CONSTANT TEXT := 'IF p_customer_id IS NOT NULL THEN PERFORM public.assert_business_member((SELECT business_id FROM public.customers WHERE id = p_customer_id)); END IF;';
    v_batch  CONSTANT TEXT := 'PERFORM public.assert_business_member((SELECT business_id FROM public.production_batches WHERE id = p_batch_id));';
BEGIN
    FOR v_target IN
        SELECT p.oid, p.proname::TEXT AS name, l.lanname::TEXT AS language
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        JOIN pg_language l ON l.oid = p.prolang
        WHERE n.nspname = 'public'
          AND p.proname IN (
              'get_business_dashboard_metrics', 'get_business_payments', 'get_money_assets',
              'update_product_category_bulk', 'fn_create_production_batch', 'process_business_payment',
              'process_customer_transaction', 'process_debt_payment', 'process_wallet_spend',
              'process_wallet_topup', 'settle_customer_debt_fifo',
              'adjust_stock_manually', 'adjust_stock_bulk',
              'fn_cancel_production_batch', 'fn_complete_production_batch'
          )
    LOOP
        v_guard := CASE
            WHEN v_target.name = 'process_customer_transaction'
                THEN v_biz || ' ' || v_cust || ' PERFORM public.assert_business_member(pr.business_id) FROM public.products pr WHERE pr.id IN (SELECT (e->>''product_id'')::UUID FROM jsonb_array_elements(COALESCE(p_items, ''[]''::JSONB)) e WHERE e->>''product_id'' IS NOT NULL);'
            WHEN v_target.name IN ('process_debt_payment', 'process_wallet_spend', 'process_wallet_topup',
                                   'settle_customer_debt_fifo')
                THEN v_biz || ' ' || v_cust
            WHEN v_target.name = 'adjust_stock_manually'
                THEN 'PERFORM public.assert_business_member((SELECT business_id FROM public.products WHERE id = p_product_id));'
            WHEN v_target.name = 'adjust_stock_bulk'
                THEN 'PERFORM public.assert_business_member(pr.business_id) FROM public.products pr WHERE pr.id IN (SELECT (e->>''product_id'')::UUID FROM jsonb_array_elements(p_adjustments) e);'
            WHEN v_target.name IN ('fn_cancel_production_batch', 'fn_complete_production_batch')
                THEN v_batch
            ELSE v_biz
        END;

        v_def := pg_get_functiondef(v_target.oid);
        IF v_target.language = 'plpgsql' THEN
            EXECUTE regexp_replace(v_def, '\mBEGIN\M', 'BEGIN' || E'\n    ' || v_guard, 'i');
        ELSIF v_target.language = 'sql' AND v_guard = v_biz THEN
            EXECUTE regexp_replace(v_def, 'AS \$function\$', 'AS $function$' || E'\n    SELECT public.assert_business_member(p_business_id);');
        ELSE
            RAISE EXCEPTION 'Cannot guard %: unsupported language %', v_target.name, v_target.language;
        END IF;

        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', v_target.oid::regprocedure);
        EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', v_target.oid::regprocedure);
    END LOOP;
END;
$migration$;

-- The single-owner rule used to be enforced only by the client, so any signed-up account could
-- call this RPC directly and become an Owner. Existing owners can still add businesses.
DO $migration$
DECLARE
    v_fn    RECORD;
    v_guard CONSTANT TEXT := $guard$
    IF current_setting('role', TRUE) IN ('anon', 'authenticated')
       AND EXISTS (SELECT 1 FROM public.business_memberships WHERE role = 'Owner')
       AND NOT EXISTS (
           SELECT 1
           FROM public.business_memberships bm
           JOIN public.users u ON u.id = bm.user_id
           WHERE u.auth_user_id = auth.uid() AND bm.role = 'Owner' AND bm.status = 'Active'
       ) THEN
        RAISE EXCEPTION 'Only the business owner can create a new business.' USING ERRCODE = '42501';
    END IF;$guard$;
BEGIN
    FOR v_fn IN
        SELECT p.oid
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.proname = 'create_business_with_owner'
    LOOP
        EXECUTE regexp_replace(pg_get_functiondef(v_fn.oid), '\mBEGIN\M', 'BEGIN' || v_guard, 'i');
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', v_fn.oid::regprocedure);
        EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', v_fn.oid::regprocedure);
    END LOOP;
END;
$migration$;

-- Backend-only RPCs: no app code calls these directly.
REVOKE ALL ON FUNCTION public.flag_due_schedule_reminders() FROM PUBLIC, anon, authenticated;
DO $migration$
DECLARE
    v_fn RECORD;
BEGIN
    FOR v_fn IN
        SELECT p.oid
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public'
          AND p.proname IN ('log_mpesa_payment', 'refresh_dashboard_snapshot',
                            'request_password_reset_otp', 'verify_password_reset_otp',
                            'update_user_password_by_email', 'save_otp', 'verify_signup_otp')
    LOOP
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', v_fn.oid::regprocedure);
        EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', v_fn.oid::regprocedure);
    END LOOP;
END;
$migration$;

-- ---------------------------------------------------------------------------
-- 2. OTP lifecycle: service_role only, used by the auth-otp edge function
-- ---------------------------------------------------------------------------
ALTER TABLE public.otps ADD COLUMN IF NOT EXISTS attempts INTEGER NOT NULL DEFAULT 0;

-- No policy means no client access. The previous policy exposed codes to their email's owner.
DROP POLICY IF EXISTS pol_otps_all ON public.otps;

CREATE OR REPLACE FUNCTION public.otp_lookup_user(p_email TEXT)
RETURNS TABLE (auth_user_id UUID, user_name TEXT)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT au.id,
           COALESCE(u.name, au.raw_user_meta_data->>'name', au.raw_user_meta_data->>'full_name', 'User')
    FROM auth.users au
    LEFT JOIN public.users u ON u.auth_user_id = au.id
    WHERE LOWER(TRIM(au.email)) = LOWER(TRIM(p_email))
       OR LOWER(TRIM(u.email)) = LOWER(TRIM(p_email))
    LIMIT 1;
$$;

-- Returns FALSE when a code was issued in the last 45 seconds; the earlier code stays valid.
CREATE OR REPLACE FUNCTION public.otp_issue(p_email TEXT, p_type TEXT, p_code TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_email TEXT := LOWER(TRIM(p_email));
BEGIN
    IF EXISTS (
        SELECT 1 FROM public.otps
        WHERE email = v_email AND type = p_type AND created_at > NOW() - INTERVAL '45 seconds'
    ) THEN
        RETURN FALSE;
    END IF;

    INSERT INTO public.otps (email, code, type, expires_at, attempts)
    VALUES (v_email, p_code, p_type, NOW() + INTERVAL '15 minutes', 0)
    ON CONFLICT (email, type) DO UPDATE SET
        code       = EXCLUDED.code,
        expires_at = EXCLUDED.expires_at,
        attempts   = 0,
        created_at = NOW();

    RETURN TRUE;
END;
$$;

-- Allows 5 wrong guesses per issued code, which makes a 6-digit code impractical to brute force.
CREATE OR REPLACE FUNCTION public.otp_check(p_email TEXT, p_type TEXT, p_code TEXT, p_consume BOOLEAN)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_email TEXT := LOWER(TRIM(p_email));
    v_otp   public.otps%ROWTYPE;
BEGIN
    SELECT * INTO v_otp
    FROM public.otps
    WHERE email = v_email AND type = p_type
    FOR UPDATE;

    IF NOT FOUND OR v_otp.expires_at <= NOW() OR v_otp.attempts >= 5 THEN
        RETURN FALSE;
    END IF;

    IF TRIM(v_otp.code) <> TRIM(p_code) THEN
        UPDATE public.otps SET attempts = attempts + 1 WHERE id = v_otp.id;
        RETURN FALSE;
    END IF;

    IF p_consume THEN
        DELETE FROM public.otps WHERE id = v_otp.id;
    END IF;

    RETURN TRUE;
END;
$$;

CREATE OR REPLACE FUNCTION public.otp_confirm_signup(p_email TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_email TEXT := LOWER(TRIM(p_email));
BEGIN
    UPDATE public.users SET is_verified = TRUE WHERE LOWER(TRIM(email)) = v_email;

    UPDATE auth.users
    SET email_confirmed_at = NOW(),
        raw_app_meta_data  = COALESCE(raw_app_meta_data, '{}') ||
                             jsonb_build_object('provider', 'email', 'providers', ARRAY['email'])
    WHERE LOWER(TRIM(email)) = v_email;
END;
$$;

REVOKE ALL ON FUNCTION public.otp_lookup_user(TEXT)                  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.otp_issue(TEXT, TEXT, TEXT)            FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.otp_check(TEXT, TEXT, TEXT, BOOLEAN)   FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.otp_confirm_signup(TEXT)               FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.otp_lookup_user(TEXT)                TO service_role;
GRANT EXECUTE ON FUNCTION public.otp_issue(TEXT, TEXT, TEXT)          TO service_role;
GRANT EXECUTE ON FUNCTION public.otp_check(TEXT, TEXT, TEXT, BOOLEAN) TO service_role;
GRANT EXECUTE ON FUNCTION public.otp_confirm_signup(TEXT)             TO service_role;

-- ---------------------------------------------------------------------------
-- 3. RLS: provider secrets and backup logs
-- Non-admin features reach these settings through edge functions using the service role.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS pol_ai_settings_select ON public.ai_settings;
CREATE POLICY pol_ai_settings_select ON public.ai_settings
    FOR SELECT USING (public.is_owner_or_admin(business_id));

DROP POLICY IF EXISTS pol_sms_settings_select ON public.sms_settings;
CREATE POLICY pol_sms_settings_select ON public.sms_settings
    FOR SELECT USING (public.is_owner_or_admin(business_id));

DROP POLICY IF EXISTS "backup_logs_all" ON public.backup_history_logs;
DROP POLICY IF EXISTS pol_backup_logs_select ON public.backup_history_logs;
CREATE POLICY pol_backup_logs_select ON public.backup_history_logs
    FOR SELECT USING (business_id = ANY(public.get_user_business_ids()));

-- This policy let anyone list every receipt's verification token. Members keep access
-- through pol_receipt_verif_write, which is FOR ALL.
DROP POLICY IF EXISTS pol_receipt_verif_select ON public.receipt_verifications;

NOTIFY pgrst, 'reload schema';

COMMIT;
