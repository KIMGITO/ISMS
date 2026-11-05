-- =============================================================================
-- 20261105013_customer_groups_loyalty_messaging.sql
-- Why: Customers need grouping by type, payment terms and delivery rhythm, and
-- staff need to pick items to follow in reports. Points could be earned but never
-- spent, and tiers only moved in the client. Adds redemption, server-side tiers,
-- WhatsApp settings, and sign-ups that have no email, such as phone or USSD.
-- Dependencies: 20261105010 (customer_accounts)
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- CUSTOMER GROUPS
-- ---------------------------------------------------------------------------
ALTER TABLE public.customers
    ADD COLUMN IF NOT EXISTS customer_type TEXT NOT NULL DEFAULT 'individual'
        CHECK (customer_type IN ('individual', 'institution', 'business', 'other')),
    ADD COLUMN IF NOT EXISTS payment_terms TEXT NOT NULL DEFAULT 'pay_now'
        CHECK (payment_terms IN ('pay_now', 'weekly', 'monthly')),
    ADD COLUMN IF NOT EXISTS delivery_frequency TEXT NOT NULL DEFAULT 'none'
        CHECK (delivery_frequency IN ('none', 'daily', 'weekly', 'monthly'));

CREATE INDEX IF NOT EXISTS idx_customers_groups
    ON public.customers(business_id, customer_type, payment_terms, delivery_frequency);

-- ---------------------------------------------------------------------------
-- REPORT TRACKING: what each business chose to follow in its reports
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.report_tracked_items (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    item_type   TEXT NOT NULL CHECK (item_type IN (
                    'customer', 'product', 'customer_type', 'payment_terms', 'delivery_frequency')),
    item_key    TEXT NOT NULL,
    label       TEXT NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (business_id, item_type, item_key)
);

ALTER TABLE public.report_tracked_items ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.report_tracked_items FROM anon;
GRANT SELECT, INSERT, DELETE ON public.report_tracked_items TO authenticated;
CREATE POLICY pol_report_tracked_select ON public.report_tracked_items FOR SELECT
    USING (business_id = ANY(public.get_user_business_ids()));
CREATE POLICY pol_report_tracked_insert ON public.report_tracked_items FOR INSERT
    WITH CHECK (business_id = ANY(public.get_user_business_ids()));
CREATE POLICY pol_report_tracked_delete ON public.report_tracked_items FOR DELETE
    USING (business_id = ANY(public.get_user_business_ids()));

-- ---------------------------------------------------------------------------
-- LOYALTY
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.loyalty_settings (
    business_id       UUID PRIMARY KEY REFERENCES public.businesses(id) ON DELETE CASCADE,
    point_value       NUMERIC(10,2) NOT NULL DEFAULT 1.00 CHECK (point_value > 0),
    min_redeem_points INTEGER NOT NULL DEFAULT 100 CHECK (min_redeem_points > 0),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.loyalty_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.loyalty_settings FROM anon;
GRANT SELECT, INSERT, UPDATE ON public.loyalty_settings TO authenticated;
CREATE POLICY pol_loyalty_settings_select ON public.loyalty_settings FOR SELECT
    USING (business_id = ANY(public.get_user_business_ids()));
CREATE POLICY pol_loyalty_settings_write ON public.loyalty_settings FOR ALL
    USING (public.is_owner_or_admin(business_id))
    WITH CHECK (public.is_owner_or_admin(business_id));

CREATE TABLE IF NOT EXISTS public.loyalty_redemptions (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    customer_id UUID NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
    points      INTEGER NOT NULL CHECK (points > 0),
    value       NUMERIC(14,2) NOT NULL CHECK (value > 0),
    recorded_by TEXT NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.loyalty_redemptions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.loyalty_redemptions FROM anon;
GRANT SELECT ON public.loyalty_redemptions TO authenticated;
CREATE POLICY pol_loyalty_redemptions_select ON public.loyalty_redemptions FOR SELECT
    USING (business_id = ANY(public.get_user_business_ids()));

-- The earn trigger never moved tiers; only the client did. Tiers rise with points and
-- don't fall when points are spent, so redeeming never costs a customer their tier.
CREATE OR REPLACE FUNCTION public.fn_raise_customer_tier()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
    IF NEW.loyalty_points > OLD.loyalty_points THEN
        NEW.tier := GREATEST(NEW.tier, public.calculate_customer_tier(NEW.loyalty_points));
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_raise_customer_tier ON public.customers;
CREATE TRIGGER trg_raise_customer_tier
BEFORE UPDATE OF loyalty_points ON public.customers
FOR EACH ROW EXECUTE FUNCTION public.fn_raise_customer_tier();

-- Points become money on the account. Debt is cleared first, because a customer can't
-- hold debt and wallet balance together.
CREATE OR REPLACE FUNCTION public.fn_redeem_points(p_customer_id UUID, p_points INTEGER, p_recorded_by TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_customer public.customers%ROWTYPE;
    v_value_per NUMERIC(10,2);
    v_min       INTEGER;
    v_value     NUMERIC(14,2);
    v_to_debt   NUMERIC(14,2);
    v_to_wallet NUMERIC(14,2);
    v_debt      NUMERIC(14,2);
    v_wallet    NUMERIC(14,2);
    v_ref       TEXT := 'redeem-' || gen_random_uuid();
BEGIN
    SELECT * INTO v_customer FROM public.customers
    WHERE id = p_customer_id AND deleted_at IS NULL
    FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Customer not found.';
    END IF;

    SELECT point_value, min_redeem_points INTO v_value_per, v_min
    FROM public.loyalty_settings WHERE business_id = v_customer.business_id;
    v_value_per := COALESCE(v_value_per, 1);
    v_min := COALESCE(v_min, 100);

    IF p_points IS NULL OR p_points < v_min THEN
        RAISE EXCEPTION 'You can redeem from % points.', v_min;
    END IF;
    IF p_points > v_customer.loyalty_points THEN
        RAISE EXCEPTION 'That is more points than the % available.', v_customer.loyalty_points;
    END IF;

    v_value     := round(p_points * v_value_per, 2);
    v_to_debt   := LEAST(v_customer.debt_balance, v_value);
    v_to_wallet := v_value - v_to_debt;
    v_debt      := v_customer.debt_balance - v_to_debt;
    v_wallet    := v_customer.wallet_balance + v_to_wallet;

    UPDATE public.customers
    SET loyalty_points = loyalty_points - p_points,
        debt_balance = v_debt,
        wallet_balance = v_wallet
    WHERE id = p_customer_id;

    INSERT INTO public.loyalty_redemptions (business_id, customer_id, points, value, recorded_by)
    VALUES (v_customer.business_id, p_customer_id, p_points, v_value, p_recorded_by);

    IF v_to_debt > 0 THEN
        INSERT INTO public.customer_ledger
            (business_id, customer_id, type, amount, wallet_balance, debt_balance, recorded_by, note, reference_id)
        VALUES (v_customer.business_id, p_customer_id, 'debt_payment', v_to_debt, v_wallet, v_debt, p_recorded_by,
                p_points || ' points redeemed', v_ref || '-debt');
    END IF;
    IF v_to_wallet > 0 THEN
        INSERT INTO public.customer_ledger
            (business_id, customer_id, type, amount, wallet_balance, debt_balance, recorded_by, note, reference_id)
        VALUES (v_customer.business_id, p_customer_id, 'wallet_topup', v_to_wallet, v_wallet, v_debt, p_recorded_by,
                p_points || ' points redeemed', v_ref || '-wallet');
    END IF;

    RETURN jsonb_build_object('value', v_value, 'toDebt', v_to_debt, 'toWallet', v_to_wallet,
                              'points', v_customer.loyalty_points - p_points);
END;
$$;

CREATE OR REPLACE FUNCTION public.redeem_customer_points(p_customer_id UUID, p_points INTEGER, p_recorded_by TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    PERFORM public.assert_business_member((SELECT business_id FROM public.customers WHERE id = p_customer_id));
    RETURN public.fn_redeem_points(p_customer_id, p_points, COALESCE(NULLIF(trim(p_recorded_by), ''), 'Staff'));
END;
$$;

CREATE OR REPLACE FUNCTION public.redeem_my_points(p_points INTEGER)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_customer_id UUID;
BEGIN
    SELECT customer_id INTO v_customer_id FROM public.customer_accounts WHERE id = auth.uid();
    IF v_customer_id IS NULL THEN
        RAISE EXCEPTION 'Please finish setting up your account first.';
    END IF;
    RETURN public.fn_redeem_points(v_customer_id, p_points, 'Customer');
END;
$$;

CREATE OR REPLACE FUNCTION public.get_my_rewards()
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT jsonb_build_object(
        'points', c.loyalty_points,
        'tier', c.tier,
        'wallet', c.wallet_balance,
        'debt', c.debt_balance,
        'pointValue', COALESCE(s.point_value, 1),
        'minRedeem', COALESCE(s.min_redeem_points, 100)
    )
    FROM public.customer_accounts a
    JOIN public.customers c ON c.id = a.customer_id
    LEFT JOIN public.loyalty_settings s ON s.business_id = c.business_id
    WHERE a.id = auth.uid();
$$;

REVOKE ALL ON FUNCTION public.fn_redeem_points(UUID, INTEGER, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_redeem_points(UUID, INTEGER, TEXT) TO service_role;
REVOKE ALL ON FUNCTION public.redeem_customer_points(UUID, INTEGER, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.redeem_customer_points(UUID, INTEGER, TEXT) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.redeem_my_points(INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.redeem_my_points(INTEGER) TO authenticated;
REVOKE ALL ON FUNCTION public.get_my_rewards() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_rewards() TO authenticated;

-- ---------------------------------------------------------------------------
-- WHATSAPP: holds an API token, so it has no policies and only edge functions read it
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.whatsapp_settings (
    business_id       UUID PRIMARY KEY REFERENCES public.businesses(id) ON DELETE CASCADE,
    enabled           BOOLEAN NOT NULL DEFAULT FALSE,
    phone_number_id   TEXT,
    access_token      TEXT,
    template_name     TEXT,
    template_language TEXT NOT NULL DEFAULT 'en',
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.whatsapp_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.whatsapp_settings FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.whatsapp_settings TO service_role;

-- ---------------------------------------------------------------------------
-- SIGN-UP WITHOUT EMAIL: the staff trigger failed when a new login's phone was
-- already on public.users, and left the name blank when there was no email.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_phone TEXT := COALESCE(NEW.raw_user_meta_data->>'phone', NEW.phone);
BEGIN
    IF EXISTS (SELECT 1 FROM public.users u WHERE u.phone = v_phone AND u.id <> NEW.id) THEN
        v_phone := NULL;
    END IF;

    INSERT INTO public.users (id, auth_user_id, name, email, phone, is_verified)
    VALUES (
        NEW.id,
        NEW.id,
        COALESCE(
            NULLIF(NEW.raw_user_meta_data->>'name', ''),
            NULLIF(NEW.raw_user_meta_data->>'full_name', ''),
            NULLIF(split_part(COALESCE(NEW.email, ''), '@', 1), ''),
            'User'
        ),
        NEW.email,
        v_phone,
        FALSE
    )
    ON CONFLICT (id) DO UPDATE SET
        email = EXCLUDED.email,
        phone = COALESCE(public.users.phone, EXCLUDED.phone);

    RETURN NEW;
END;
$$;

-- The dial-code gateway identifies callers by the phone on their login, which the network
-- vouches for. customer_accounts.phone isn't used: it's unverified and families can share it.
CREATE OR REPLACE FUNCTION public.find_account_by_auth_phone(p_phone TEXT)
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT a.id
    FROM auth.users u
    JOIN public.customer_accounts a ON a.id = u.id
    WHERE u.phone = p_phone
    LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.find_account_by_auth_phone(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.find_account_by_auth_phone(TEXT) TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
