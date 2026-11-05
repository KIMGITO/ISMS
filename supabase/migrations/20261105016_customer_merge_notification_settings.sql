-- =============================================================================
-- 20261105016_customer_merge_notification_settings.sql
-- Why: A customer added by staff and the same person signing up online became two
-- unconnected records, which split their debt, points and history. Staff can now
-- review and merge these. Notification settings were saved per device and never
-- stopped a push, and customers couldn't opt out of messages.
-- Dependencies: 20261105014 (has_permission), 20261105010 (customer_accounts)
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- CUSTOMER COLUMNS
-- ---------------------------------------------------------------------------
ALTER TABLE public.customers
    ADD COLUMN IF NOT EXISTS merged_into_id UUID REFERENCES public.customers(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS notify_service BOOLEAN NOT NULL DEFAULT TRUE,
    ADD COLUMN IF NOT EXISTS notify_promotions BOOLEAN NOT NULL DEFAULT FALSE;

-- The same number can be written +254712..., 254712... or 0712...
CREATE OR REPLACE FUNCTION public.fn_phone_key(p_phone TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT CASE
        WHEN length(d) < 7 THEN NULL
        WHEN d ~ '^0[0-9]{9}$' THEN '254' || substr(d, 2)
        WHEN d ~ '^[17][0-9]{8}$' THEN '254' || d
        ELSE d
    END
    FROM (SELECT regexp_replace(COALESCE(p_phone, ''), '[^0-9]', '', 'g') AS d) s;
$$;

-- Staff forms store this placeholder when a customer has no email.
CREATE OR REPLACE FUNCTION public.fn_email_key(p_email TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT NULLIF(NULLIF(lower(trim(COALESCE(p_email, ''))), ''), 'no-email@kaykays.com');
$$;

CREATE INDEX IF NOT EXISTS idx_customers_phone_key
    ON public.customers(business_id, public.fn_phone_key(phone)) WHERE deleted_at IS NULL;

-- ---------------------------------------------------------------------------
-- MERGE RECORDS
-- ---------------------------------------------------------------------------
-- Customer ids stay plain UUIDs here, so the merge's own move step leaves this history alone.
CREATE TABLE IF NOT EXISTS public.customer_merges (
    id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id        UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    kept_customer_id   UUID NOT NULL,
    merged_customer_id UUID NOT NULL,
    kept_before        JSONB NOT NULL,
    merged_before      JSONB NOT NULL,
    moved_rows         JSONB NOT NULL,
    merged_by          TEXT NOT NULL,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Families and institutions can really share a number, so staff can dismiss a match.
-- It comes back if a new customer joins the group.
CREATE TABLE IF NOT EXISTS public.customer_duplicate_dismissals (
    id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id  UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    customer_ids UUID[] NOT NULL,
    dismissed_by TEXT NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.customer_merges ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_duplicate_dismissals ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.customer_merges, public.customer_duplicate_dismissals FROM anon, authenticated;
GRANT SELECT ON public.customer_merges, public.customer_duplicate_dismissals TO authenticated;
CREATE POLICY pol_customer_merges_select ON public.customer_merges FOR SELECT
    USING (public.has_permission(business_id, 'customers.manage'));
CREATE POLICY pol_customer_duplicate_dismissals_select ON public.customer_duplicate_dismissals FOR SELECT
    USING (public.has_permission(business_id, 'customers.manage'));

-- ---------------------------------------------------------------------------
-- FINDING DUPLICATES
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.find_duplicate_customers(p_business_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_result JSONB;
BEGIN
    PERFORM public.assert_permission(p_business_id, 'customers.manage');

    WITH base AS (
        SELECT id, public.fn_phone_key(phone) AS phone_key, public.fn_email_key(email) AS email_key
        FROM public.customers
        WHERE business_id = p_business_id AND deleted_at IS NULL
    ),
    matches AS (
        SELECT 'phone' AS match_on, phone_key AS match_value, array_agg(id ORDER BY id) AS ids
        FROM base WHERE phone_key IS NOT NULL GROUP BY phone_key HAVING count(*) > 1
        UNION ALL
        SELECT 'email', email_key, array_agg(id ORDER BY id)
        FROM base WHERE email_key IS NOT NULL GROUP BY email_key HAVING count(*) > 1
    ),
    -- The same people matching on both phone and email show once.
    groups AS (
        SELECT DISTINCT ON (ids) match_on, match_value, ids
        FROM matches
        ORDER BY ids, match_on DESC
    )
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'matchOn', g.match_on,
        'matchValue', g.match_value,
        'customerIds', to_jsonb(g.ids),
        'accountCustomerIds', COALESCE((
            SELECT jsonb_agg(DISTINCT a.customer_id)
            FROM public.customer_accounts a
            WHERE a.customer_id = ANY(g.ids)
        ), '[]'::jsonb)
    )), '[]'::jsonb) INTO v_result
    FROM groups g
    WHERE NOT EXISTS (
        SELECT 1 FROM public.customer_duplicate_dismissals d
        WHERE d.business_id = p_business_id AND d.customer_ids @> g.ids
    );

    RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.dismiss_duplicate_customers(p_business_id UUID, p_customer_ids UUID[])
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    PERFORM public.assert_permission(p_business_id, 'customers.manage');
    IF (SELECT count(*) FROM public.customers WHERE id = ANY(p_customer_ids) AND business_id = p_business_id)
       <> cardinality(p_customer_ids) OR cardinality(p_customer_ids) < 2 THEN
        RAISE EXCEPTION 'Those customers were not found.';
    END IF;
    INSERT INTO public.customer_duplicate_dismissals (business_id, customer_ids, dismissed_by)
    VALUES (p_business_id, p_customer_ids,
            COALESCE((SELECT name FROM public.users WHERE auth_user_id = auth.uid()), 'system'));
END;
$$;

-- ---------------------------------------------------------------------------
-- MERGING
-- ---------------------------------------------------------------------------
-- Money and points are added together and history moves across. The kept record's customer
-- type, payment terms, delivery schedule and notes stay. Staff choose the name, phone and email.
CREATE OR REPLACE FUNCTION public.merge_customers(
    p_keep_id UUID,
    p_merge_id UUID,
    p_name TEXT,
    p_phone TEXT,
    p_email TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_keep  public.customers%ROWTYPE;
    v_merge public.customers%ROWTYPE;
    v_name  TEXT := left(trim(COALESCE(p_name, '')), 100);
    v_phone TEXT := trim(COALESCE(p_phone, ''));
    v_by    TEXT;
    v_fk    RECORD;
    v_count BIGINT;
    v_moved JSONB := '{}'::jsonb;
    v_debt  NUMERIC(14,2);
    v_wallet NUMERIC(14,2);
    v_offset NUMERIC(14,2);
    v_merge_id UUID := uuid_generate_v4();
    v_open RECORD;
    v_applied NUMERIC(14,2);
    v_left NUMERIC(14,2);
BEGIN
    IF p_keep_id IS NULL OR p_merge_id IS NULL OR p_keep_id = p_merge_id THEN
        RAISE EXCEPTION 'Please choose two different customers.';
    END IF;

    -- A fixed lock order, so two people merging the same pair can't deadlock.
    PERFORM 1 FROM public.customers WHERE id IN (p_keep_id, p_merge_id) ORDER BY id FOR UPDATE;

    SELECT * INTO v_keep FROM public.customers WHERE id = p_keep_id AND deleted_at IS NULL;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'The customer to keep was not found.';
    END IF;
    SELECT * INTO v_merge FROM public.customers WHERE id = p_merge_id AND deleted_at IS NULL;
    IF NOT FOUND OR v_merge.business_id <> v_keep.business_id THEN
        RAISE EXCEPTION 'The customer to merge was not found.';
    END IF;

    PERFORM public.assert_permission(v_keep.business_id, 'customers.manage');

    IF v_name = '' THEN
        RAISE EXCEPTION 'Please choose a name.';
    END IF;
    IF v_phone = '' THEN
        RAISE EXCEPTION 'Please choose a phone number.';
    END IF;

    v_by := COALESCE((SELECT name FROM public.users WHERE auth_user_id = auth.uid()), 'system');

    -- Every table pointing at customers moves across, including any added later.
    FOR v_fk IN
        SELECT c.conrelid AS tbl, c.conrelid::regclass::text AS tbl_name, a.attname AS col
        FROM pg_constraint c
        JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
        WHERE c.contype = 'f'
          AND c.confrelid = 'public.customers'::regclass
          AND c.conrelid <> 'public.customers'::regclass
    LOOP
        EXECUTE format('UPDATE %s SET %I = $1 WHERE %I = $2', v_fk.tbl_name, v_fk.col, v_fk.col)
            USING p_keep_id, p_merge_id;
        GET DIAGNOSTICS v_count = ROW_COUNT;
        IF v_count > 0 THEN
            v_moved := v_moved || jsonb_build_object(v_fk.tbl_name, v_count);
        END IF;

        -- Reports read the name saved on each row.
        IF EXISTS (SELECT 1 FROM pg_attribute
                   WHERE attrelid = v_fk.tbl AND attname = 'customer_name' AND NOT attisdropped) THEN
            EXECUTE format('UPDATE %s SET customer_name = $1 WHERE %I = $2 AND customer_name IS DISTINCT FROM $1',
                           v_fk.tbl_name, v_fk.col)
                USING v_name, p_keep_id;
        END IF;
    END LOOP;

    -- Tracked report items hold the id as text.
    UPDATE public.report_tracked_items t
    SET item_key = p_keep_id::TEXT, label = v_name
    WHERE t.item_type = 'customer' AND t.item_key = p_merge_id::TEXT
      AND NOT EXISTS (SELECT 1 FROM public.report_tracked_items o
                      WHERE o.business_id = t.business_id AND o.item_type = 'customer'
                        AND o.item_key = p_keep_id::TEXT);
    DELETE FROM public.report_tracked_items
    WHERE item_type = 'customer' AND item_key = p_merge_id::TEXT AND business_id = v_keep.business_id;

    -- Wallet money clears debt first, because a customer can't hold debt and wallet together.
    v_debt   := v_keep.debt_balance + v_merge.debt_balance;
    v_wallet := v_keep.wallet_balance + v_merge.wallet_balance;
    v_offset := LEAST(v_debt, v_wallet);
    v_debt   := v_debt - v_offset;
    v_wallet := v_wallet - v_offset;

    UPDATE public.customers
    SET merged_into_id = p_keep_id,
        deleted_at = NOW(),
        debt_balance = 0,
        wallet_balance = 0,
        loyalty_points = 0,
        purchases_count = 0,
        last_modified_by = v_by
    WHERE id = p_merge_id;

    -- Records merged into this one earlier now point at the record that survives.
    UPDATE public.customers SET merged_into_id = p_keep_id WHERE merged_into_id = p_merge_id;

    UPDATE public.customers
    SET name = v_name,
        phone = v_phone,
        email = NULLIF(trim(COALESCE(p_email, '')), ''),
        debt_balance = v_debt,
        wallet_balance = v_wallet,
        loyalty_points = v_keep.loyalty_points + v_merge.loyalty_points,
        tier = GREATEST(v_keep.tier, v_merge.tier),
        purchases_count = v_keep.purchases_count + v_merge.purchases_count,
        join_date = LEAST(v_keep.join_date, v_merge.join_date),
        -- An opt-out on either record stands, and so does agreeing to offers.
        notify_service = v_keep.notify_service AND v_merge.notify_service,
        notify_promotions = v_keep.notify_promotions OR v_merge.notify_promotions,
        last_modified_by = v_by
    WHERE id = p_keep_id;

    -- The wallet money used on debt also settles the oldest open debts, so they match the balance.
    v_left := v_offset;
    FOR v_open IN
        SELECT id, balance FROM public.credit_payments
        WHERE customer_id = p_keep_id AND status IN ('Open', 'Partial')
        ORDER BY created_at
    LOOP
        EXIT WHEN v_left <= 0;
        v_applied := LEAST(v_left, v_open.balance);
        v_left := v_left - v_applied;
        UPDATE public.credit_payments
        SET amount_paid = amount_paid + v_applied,
            status = CASE WHEN amount_paid + v_applied >= amount_owed
                          THEN 'Settled'::public.credit_status ELSE 'Partial'::public.credit_status END,
            settled_at = CASE WHEN amount_paid + v_applied >= amount_owed THEN NOW() END
        WHERE id = v_open.id;
    END LOOP;

    IF v_merge.debt_balance > 0 THEN
        INSERT INTO public.customer_ledger
            (business_id, customer_id, type, amount, wallet_balance, debt_balance, recorded_by, note, reference_id)
        VALUES (v_keep.business_id, p_keep_id, 'debt_adjustment', v_merge.debt_balance, v_wallet, v_debt, v_by,
                'Debt moved from merged record: ' || v_merge.name, 'merge-debt-' || v_merge_id);
    END IF;
    IF v_merge.wallet_balance > 0 THEN
        INSERT INTO public.customer_ledger
            (business_id, customer_id, type, amount, wallet_balance, debt_balance, recorded_by, note, reference_id)
        VALUES (v_keep.business_id, p_keep_id, 'wallet_topup', v_merge.wallet_balance, v_wallet, v_debt, v_by,
                'Wallet moved from merged record: ' || v_merge.name, 'merge-wallet-' || v_merge_id);
    END IF;

    INSERT INTO public.customer_merges
        (id, business_id, kept_customer_id, merged_customer_id, kept_before, merged_before, moved_rows, merged_by)
    VALUES (v_merge_id, v_keep.business_id, p_keep_id, p_merge_id, to_jsonb(v_keep), to_jsonb(v_merge), v_moved, v_by);

    RETURN jsonb_build_object(
        'keepId', p_keep_id,
        'debt', v_debt,
        'wallet', v_wallet,
        'points', v_keep.loyalty_points + v_merge.loyalty_points,
        'movedRows', v_moved
    );
END;
$$;

-- A device that was offline or hasn't refreshed can still send the merged customer's id.
-- Its new rows follow the merge, so that money and history aren't stranded.
CREATE OR REPLACE FUNCTION public.fn_redirect_merged_customer()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
    v_target UUID;
BEGIN
    IF NEW.customer_id IS NOT NULL THEN
        SELECT merged_into_id INTO v_target FROM public.customers WHERE id = NEW.customer_id;
        IF v_target IS NOT NULL THEN
            NEW.customer_id := v_target;
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

DO $migration$
DECLARE
    v_table TEXT;
BEGIN
    FOREACH v_table IN ARRAY ARRAY['transactions', 'customer_ledger', 'debt_payments', 'credit_payments',
                                   'wallet_transactions', 'payments', 'loyalty_redemptions']
    LOOP
        -- The name sorts before the other BEFORE INSERT triggers, so they see the final id.
        EXECUTE format('DROP TRIGGER IF EXISTS trg_a_redirect_merged_customer ON public.%I', v_table);
        EXECUTE format('CREATE TRIGGER trg_a_redirect_merged_customer BEFORE INSERT ON public.%I
                        FOR EACH ROW EXECUTE FUNCTION public.fn_redirect_merged_customer()', v_table);
    END LOOP;
END;
$migration$;

-- Payment functions update a customer by id. On a merged record that money would disappear
-- from view, so the payment fails with a clear message instead.
CREATE OR REPLACE FUNCTION public.fn_block_merged_customer_balances()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
    IF OLD.merged_into_id IS NOT NULL
       AND (NEW.debt_balance, NEW.wallet_balance, NEW.loyalty_points)
           IS DISTINCT FROM (OLD.debt_balance, OLD.wallet_balance, OLD.loyalty_points) THEN
        RAISE EXCEPTION 'This customer was merged into another record. Please refresh and try again.';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_block_merged_customer_balances ON public.customers;
CREATE TRIGGER trg_block_merged_customer_balances
BEFORE UPDATE ON public.customers
FOR EACH ROW EXECUTE FUNCTION public.fn_block_merged_customer_balances();

-- Without SMS codes, a phone number on a sign-up is only a claim, so staff decide.
CREATE OR REPLACE FUNCTION public.fn_flag_duplicate_signup()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM public.customers c
        WHERE c.business_id = NEW.business_id
          AND c.id <> NEW.id
          AND c.deleted_at IS NULL
          AND public.fn_phone_key(c.phone) = public.fn_phone_key(NEW.phone)
    ) THEN
        PERFORM public.fn_notify_staff(NEW.business_id, 'Possible duplicate customer',
            NEW.name || ' signed up with a phone number already on a customer record. Check Customers > Duplicates.',
            jsonb_build_object('customerId', NEW.id));
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_flag_duplicate_signup ON public.customers;
CREATE TRIGGER trg_flag_duplicate_signup
AFTER INSERT ON public.customers
FOR EACH ROW WHEN (NEW.last_modified_by = 'website')
EXECUTE FUNCTION public.fn_flag_duplicate_signup();

-- Merges only happen through merge_customers, and contact choices need the update permission.
CREATE OR REPLACE FUNCTION public.fn_guard_customer_balances()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
    IF current_user NOT IN ('anon', 'authenticated') THEN
        RETURN NEW;
    END IF;

    IF TG_OP = 'INSERT' THEN
        NEW.merged_into_id := NULL;
        IF NOT public.has_permission(NEW.business_id, 'loyalty.adjust') THEN
            NEW.loyalty_points := 0;
            NEW.tier := 'Bronze';
        END IF;
        IF NOT public.has_permission(NEW.business_id, 'customers.manage') THEN
            NEW.wallet_balance := 0;
            NEW.debt_balance := 0;
        END IF;
        RETURN NEW;
    END IF;

    IF NEW.merged_into_id IS DISTINCT FROM OLD.merged_into_id THEN
        RAISE EXCEPTION 'Customers can only be merged from the duplicates screen.' USING ERRCODE = '42501';
    END IF;
    IF (NEW.loyalty_points, NEW.tier) IS DISTINCT FROM (OLD.loyalty_points, OLD.tier)
       AND NOT public.has_permission(NEW.business_id, 'loyalty.adjust') THEN
        RAISE EXCEPTION 'Your role does not allow changing points or tiers.' USING ERRCODE = '42501';
    END IF;
    IF (NEW.wallet_balance, NEW.debt_balance) IS DISTINCT FROM (OLD.wallet_balance, OLD.debt_balance)
       AND NOT public.has_permission(NEW.business_id, 'customers.manage') THEN
        RAISE EXCEPTION 'Your role does not allow changing balances.' USING ERRCODE = '42501';
    END IF;
    IF (NEW.name, NEW.phone, NEW.email, NEW.description, NEW.customer_type, NEW.payment_terms, NEW.delivery_frequency,
        NEW.notify_service, NEW.notify_promotions)
       IS DISTINCT FROM (OLD.name, OLD.phone, OLD.email, OLD.description, OLD.customer_type, OLD.payment_terms, OLD.delivery_frequency,
        OLD.notify_service, OLD.notify_promotions)
       AND NOT public.has_permission(NEW.business_id, 'customers.update') THEN
        RAISE EXCEPTION 'Your role does not allow changing customer details.' USING ERRCODE = '42501';
    END IF;
    IF NEW.deleted_at IS DISTINCT FROM OLD.deleted_at
       AND NOT public.has_permission(NEW.business_id, 'customers.delete') THEN
        RAISE EXCEPTION 'Your role does not allow removing customers.' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- CUSTOMER CONTACT CHOICES
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_my_contact_preferences()
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT jsonb_build_object('service', c.notify_service, 'promotions', c.notify_promotions)
    FROM public.customer_accounts a
    JOIN public.customers c ON c.id = a.customer_id
    WHERE a.id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION public.update_my_contact_preferences(p_service BOOLEAN, p_promotions BOOLEAN)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    UPDATE public.customers c
    SET notify_service = COALESCE(p_service, c.notify_service),
        notify_promotions = COALESCE(p_promotions, c.notify_promotions)
    FROM public.customer_accounts a
    WHERE a.id = auth.uid() AND c.id = a.customer_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Please finish setting up your account first.';
    END IF;
END;
$$;

-- Order messages stop when a customer turns them off, since the Orders page still shows the
-- same status. A message with no order, such as a failed schedule, has no other place to appear.
CREATE OR REPLACE FUNCTION public.fn_customer_message(p_account_id UUID, p_order_id UUID, p_body TEXT)
RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
    INSERT INTO public.customer_messages (business_id, account_id, sender, body, order_id)
    SELECT a.business_id, a.id, 'system', p_body, p_order_id
    FROM public.customer_accounts a
    LEFT JOIN public.customers c ON c.id = a.customer_id
    WHERE a.id = p_account_id
      AND (p_order_id IS NULL OR COALESCE(c.notify_service, TRUE));
$$;

-- Used by the messaging functions before sending to a number or address.
CREATE OR REPLACE FUNCTION public.fn_contact_allowed(p_business_id UUID, p_phone TEXT, p_email TEXT, p_purpose TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT NOT EXISTS (
        SELECT 1 FROM public.customers c
        WHERE c.business_id = p_business_id
          AND c.deleted_at IS NULL
          AND (public.fn_phone_key(c.phone) = public.fn_phone_key(p_phone)
               OR public.fn_email_key(c.email) = public.fn_email_key(p_email))
          AND NOT CASE WHEN p_purpose = 'promotion' THEN c.notify_promotions ELSE c.notify_service END
    );
$$;

-- ---------------------------------------------------------------------------
-- STAFF NOTIFICATION SETTINGS
-- ---------------------------------------------------------------------------
-- The one list of categories. Staff see a category if they hold any of its permissions, or
-- always if it has none. Locked categories can't be turned off.
CREATE OR REPLACE FUNCTION public.fn_notification_catalog()
RETURNS TABLE (category TEXT, types TEXT[], permissions TEXT[], locked BOOLEAN)
LANGUAGE sql
IMMUTABLE
AS $$
    VALUES
        ('stock', ARRAY['Stock Almost Finished', 'Out Of Stock'], ARRAY['inventory.view'], FALSE),
        ('sales', ARRAY['Sales Summary', 'Daily Report', 'Weekly Report', 'Monthly Report'], ARRAY['reports.sales'], FALSE),
        ('debts', ARRAY['Debt Due Reminder'], ARRAY['customers.debts'], FALSE),
        ('deliveries', ARRAY['Delivery Assigned', 'Delivery Completed'], ARRAY['deliveries.view'], FALSE),
        ('payments', ARRAY['Payment Received', 'Low Cash Balance'], ARRAY['payments.view', 'payments.verify'], FALSE),
        ('online_store', ARRAY['Online Store'], ARRAY['online_store.view'], FALSE),
        ('schedules', ARRAY['Schedule Reminder', 'Scheduled Reminder'], NULL::TEXT[], FALSE),
        ('ai', ARRAY['AI Business Insight', 'AI Recommendation', 'AI Risk Alert'], ARRAY['ai.insights'], FALSE),
        ('announcements', ARRAY['Business Announcement', 'Custom Notification'], NULL::TEXT[], FALSE),
        ('account', ARRAY['Role Invitation', 'Account Activity', 'System Update'], NULL::TEXT[], TRUE);
$$;

-- The same check as has_permission, for a recipient rather than the caller.
CREATE OR REPLACE FUNCTION public.fn_user_has_permission(p_business_id UUID, p_user_id UUID, p_permissions TEXT[])
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_role TEXT;
    v_code TEXT;
    v_granted BOOLEAN;
BEGIN
    SELECT role::TEXT INTO v_role FROM public.business_memberships
    WHERE user_id = p_user_id AND business_id = p_business_id AND status = 'Active';

    IF v_role IS NULL THEN
        RETURN FALSE;
    END IF;
    IF p_permissions IS NULL OR v_role IN ('Owner', 'Admin', 'Administrator') THEN
        RETURN TRUE;
    END IF;

    FOREACH v_code IN ARRAY p_permissions LOOP
        SELECT rp.granted INTO v_granted
        FROM public.role_permissions rp
        WHERE rp.business_id = p_business_id AND rp.role::TEXT = v_role AND rp.permission = v_code;

        IF COALESCE(v_granted, v_code = ANY(
            COALESCE((SELECT d.permissions FROM public.role_default_permissions d WHERE d.role = v_role), '{}')
        )) THEN
            RETURN TRUE;
        END IF;
    END LOOP;
    RETURN FALSE;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_notification_wanted(p_business_id UUID, p_user_id UUID, p_type TEXT, p_direct BOOLEAN)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_cat RECORD;
    v_category TEXT;
BEGIN
    -- A rider's assignment is stored as 'Online Store', but to them it's a delivery.
    SELECT * INTO v_cat FROM public.fn_notification_catalog() c
    WHERE CASE WHEN p_type = 'Online Store' AND p_direct THEN c.category = 'deliveries' ELSE p_type = ANY(c.types) END;
    v_category := v_cat.category;

    IF v_category IS NULL OR v_cat.locked THEN
        RETURN TRUE;
    END IF;
    IF EXISTS (SELECT 1 FROM public.notification_preferences p
               WHERE p.business_id = p_business_id AND p.user_id = p_user_id
                 AND p.category IN ('all', v_category) AND NOT p.enabled) THEN
        RETURN FALSE;
    END IF;
    RETURN p_direct OR public.fn_user_has_permission(p_business_id, p_user_id, v_cat.permissions);
END;
$$;

-- Who a push goes to. For categories tied to a permission, that permission decides rather than
-- the row's role, because stock alerts written for 'Owner' should also reach a Manager. Other
-- rows, such as a shift report for the Owner, stay with the role they name.
CREATE OR REPLACE FUNCTION public.fn_notification_recipients(p_business_id UUID, p_user_id UUID, p_role TEXT, p_type TEXT)
RETURNS UUID[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT CASE
        WHEN p_user_id IS NOT NULL THEN
            CASE WHEN p_business_id IS NULL OR public.fn_notification_wanted(p_business_id, p_user_id, p_type, TRUE)
                 THEN ARRAY[p_user_id] ELSE '{}'::UUID[] END
        ELSE COALESCE((
            SELECT array_agg(m.user_id)
            FROM public.business_memberships m
            WHERE m.business_id = p_business_id
              AND m.status = 'Active'
              AND public.fn_notification_wanted(p_business_id, m.user_id, p_type, FALSE)
              AND (
                  p_role IS NULL
                  OR m.role::TEXT ILIKE p_role
                  OR EXISTS (SELECT 1 FROM public.fn_notification_catalog() c
                             WHERE p_type = ANY(c.types) AND c.permissions IS NOT NULL)
              )
        ), '{}'::UUID[])
    END;
$$;

CREATE OR REPLACE FUNCTION public.get_my_notification_settings(p_business_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_user UUID;
BEGIN
    SELECT u.id INTO v_user
    FROM public.users u
    JOIN public.business_memberships m ON m.user_id = u.id
    WHERE u.auth_user_id = auth.uid() AND m.business_id = p_business_id AND m.status = 'Active';
    IF v_user IS NULL THEN
        RAISE EXCEPTION 'Your role does not allow this.' USING ERRCODE = '42501';
    END IF;

    RETURN jsonb_build_object(
        'userId', v_user,
        'role', (SELECT m.role::TEXT FROM public.business_memberships m
                 WHERE m.user_id = v_user AND m.business_id = p_business_id),
        'paused', EXISTS (SELECT 1 FROM public.notification_preferences p
                          WHERE p.business_id = p_business_id AND p.user_id = v_user
                            AND p.category = 'all' AND NOT p.enabled),
        'categories', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                'category', c.category,
                'types', to_jsonb(c.types),
                'locked', c.locked,
                'followsRole', c.permissions IS NULL,
                'enabled', c.locked OR NOT EXISTS (
                    SELECT 1 FROM public.notification_preferences p
                    WHERE p.business_id = p_business_id AND p.user_id = v_user
                      AND p.category = c.category AND NOT p.enabled)
            ))
            FROM public.fn_notification_catalog() c
            WHERE public.fn_user_has_permission(p_business_id, v_user, c.permissions)
        ), '[]'::jsonb),
        'hiddenTypes', COALESCE((
            SELECT jsonb_agg(t)
            FROM public.fn_notification_catalog() c, unnest(c.types) t
            WHERE NOT public.fn_user_has_permission(p_business_id, v_user, c.permissions)
        ), '[]'::jsonb)
    );
END;
$$;

-- p_category 'all' pauses everything except locked categories.
CREATE OR REPLACE FUNCTION public.set_my_notification_setting(p_business_id UUID, p_category TEXT, p_enabled BOOLEAN)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_user UUID;
BEGIN
    SELECT u.id INTO v_user
    FROM public.users u
    JOIN public.business_memberships m ON m.user_id = u.id
    WHERE u.auth_user_id = auth.uid() AND m.business_id = p_business_id AND m.status = 'Active';
    IF v_user IS NULL THEN
        RAISE EXCEPTION 'Your role does not allow this.' USING ERRCODE = '42501';
    END IF;

    IF p_category <> 'all' AND NOT EXISTS (
        SELECT 1 FROM public.fn_notification_catalog() c WHERE c.category = p_category AND NOT c.locked
    ) THEN
        RAISE EXCEPTION 'That notification setting can''t be changed.';
    END IF;

    INSERT INTO public.notification_preferences (business_id, user_id, category, enabled)
    VALUES (p_business_id, v_user, p_category, COALESCE(p_enabled, TRUE))
    ON CONFLICT (business_id, user_id, category) DO UPDATE SET enabled = EXCLUDED.enabled;
END;
$$;

-- Each person's settings are their own. Any member could previously change a colleague's.
DROP POLICY IF EXISTS pol_notif_pref_all ON public.notification_preferences;
CREATE POLICY pol_notif_pref_own ON public.notification_preferences FOR ALL
    USING (user_id = (SELECT id FROM public.users WHERE auth_user_id = auth.uid()))
    WITH CHECK (user_id = (SELECT id FROM public.users WHERE auth_user_id = auth.uid()));

-- ---------------------------------------------------------------------------
-- ACCESS
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.fn_phone_key(TEXT), public.fn_email_key(TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.find_duplicate_customers(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.dismiss_duplicate_customers(UUID, UUID[]) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.merge_customers(UUID, UUID, TEXT, TEXT, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_my_contact_preferences() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.update_my_contact_preferences(BOOLEAN, BOOLEAN) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_my_notification_settings(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.set_my_notification_setting(UUID, TEXT, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.find_duplicate_customers(UUID), public.dismiss_duplicate_customers(UUID, UUID[]),
    public.merge_customers(UUID, UUID, TEXT, TEXT, TEXT), public.get_my_contact_preferences(),
    public.update_my_contact_preferences(BOOLEAN, BOOLEAN), public.get_my_notification_settings(UUID),
    public.set_my_notification_setting(UUID, TEXT, BOOLEAN)
TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.fn_flag_duplicate_signup() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_contact_allowed(UUID, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_user_has_permission(UUID, UUID, TEXT[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_notification_wanted(UUID, UUID, TEXT, BOOLEAN) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_notification_recipients(UUID, UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_contact_allowed(UUID, TEXT, TEXT, TEXT),
    public.fn_notification_recipients(UUID, UUID, TEXT, TEXT)
TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
