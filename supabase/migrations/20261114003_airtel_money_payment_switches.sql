-- =============================================================================
-- 20261114003_airtel_money_payment_switches.sql
--
-- 1. Airtel Money is the fifth way money comes in: Cash, M-Pesa, Airtel Money, Card, Bank.
--    It has its own balance, because the money sits in the Airtel merchant account, not the
--    M-Pesa till. (The enum value was added by 20261114002.)
-- 2. Airtel Money prompts (Airtel Africa Open API, "USSD push" collections). Each business
--    keeps its own Airtel client id and secret in airtel_payment_secrets, which no client can
--    read; only the airtel-payments and airtel-callback edge functions use them. A prompt is
--    settled here once, whichever comes first: the callback or the app checking. The edge
--    functions ask Airtel for the result before calling this, so a forged callback can't
--    record money.
-- 3. Payment methods can be switched on and off per business. businesses.default_payment_methods
--    (which nothing read before) is now the list of methods the business takes. Existing
--    businesses get the four they could already use; Airtel Money starts off until it is set
--    up. Changing the list needs the new permission payments.configure (owners and admins
--    always have it; give it to other roles under Roles).
--    Switching a method off hides it at the till and on payment forms and stops new prompts or
--    card charges with it. Money that still arrives (a till payment, a late callback) is still
--    recorded, so nothing is ever lost; old records keep their method.
-- 4. New permission payments.airtel (send Airtel Money prompts), given to Cashier like
--    payments.mpesa.
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Five methods everywhere
-- ---------------------------------------------------------------------------
ALTER TABLE public.payments      DROP CONSTRAINT IF EXISTS payments_method_check;
ALTER TABLE public.money_assets  DROP CONSTRAINT IF EXISTS money_assets_method_check;
ALTER TABLE public.expenses      DROP CONSTRAINT IF EXISTS expenses_payment_method_check;
ALTER TABLE public.debt_payments DROP CONSTRAINT IF EXISTS debt_payments_payment_method_check;
ALTER TABLE public.transactions  DROP CONSTRAINT IF EXISTS transactions_payment_method_check;

ALTER TABLE public.payments
    ADD CONSTRAINT payments_method_check CHECK (method IN ('Cash', 'M-Pesa', 'Airtel Money', 'Card', 'Bank'));
ALTER TABLE public.money_assets
    ADD CONSTRAINT money_assets_method_check CHECK (method IN ('Cash', 'M-Pesa', 'Airtel Money', 'Card', 'Bank'));
ALTER TABLE public.expenses
    ADD CONSTRAINT expenses_payment_method_check CHECK (payment_method IN ('Cash', 'M-Pesa', 'Airtel Money', 'Card', 'Bank'));
ALTER TABLE public.debt_payments
    ADD CONSTRAINT debt_payments_payment_method_check CHECK (payment_method IN ('Cash', 'M-Pesa', 'Airtel Money', 'Card', 'Bank'));
ALTER TABLE public.transactions
    ADD CONSTRAINT transactions_payment_method_check
    CHECK (payment_method IN ('Cash', 'M-Pesa', 'Airtel Money', 'Card', 'Bank', 'Credit_Debt', 'Credit'));

CREATE OR REPLACE FUNCTION public.fn_post_money_asset(
    p_business_id UUID,
    p_method      TEXT,
    p_delta       NUMERIC,
    p_description TEXT,
    p_payment_id  UUID DEFAULT NULL,
    p_expense_id  UUID DEFAULT NULL,
    p_recorded_by TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_method   TEXT := CASE WHEN p_method = 'Mobile_Wallet' THEN 'M-Pesa' WHEN p_method = 'Other' THEN 'Cash' ELSE p_method END;
    v_asset_id UUID;
    v_after    NUMERIC(14,2);
BEGIN
    IF COALESCE(p_delta, 0) = 0 THEN
        RETURN;
    END IF;
    IF v_method IS NULL OR v_method NOT IN ('Cash', 'M-Pesa', 'Airtel Money', 'Card', 'Bank') THEN
        RAISE EXCEPTION 'Choose Cash, M-Pesa, Airtel Money, Card or Bank.';
    END IF;

    INSERT INTO public.money_assets (business_id, method, balance)
    VALUES (p_business_id, v_method, p_delta)
    ON CONFLICT (business_id, method)
    DO UPDATE SET balance = money_assets.balance + p_delta, updated_at = NOW()
    RETURNING id, balance INTO v_asset_id, v_after;

    INSERT INTO public.payment_asset_ledger (
        business_id, asset_id, payment_id, expense_id, type, method, amount,
        balance_before, balance_after, description, recorded_by
    )
    VALUES (
        p_business_id, v_asset_id, p_payment_id, p_expense_id,
        CASE WHEN p_delta > 0 THEN 'Credit' ELSE 'Debit' END, v_method, p_delta,
        v_after - p_delta, v_after, p_description, p_recorded_by
    );
END;
$$;
REVOKE ALL ON FUNCTION public.fn_post_money_asset(UUID, TEXT, NUMERIC, TEXT, UUID, UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_post_money_asset(UUID, TEXT, NUMERIC, TEXT, UUID, UUID, TEXT) TO service_role;

-- Same body as 20261110009 with Airtel Money accepted and payments.airtel allowed.
CREATE OR REPLACE FUNCTION public.process_business_payment(
    p_business_id    UUID,
    p_reference_code TEXT,
    p_amount         NUMERIC(14,2),
    p_method         TEXT,
    p_sender_name    TEXT,
    p_sender_phone   TEXT,
    p_status         TEXT DEFAULT 'Success',
    p_date           TIMESTAMPTZ DEFAULT NOW(),
    p_customer_id    UUID DEFAULT NULL,
    p_customer_name  TEXT DEFAULT NULL,
    p_payment_type   TEXT DEFAULT 'walk-in',
    p_description    TEXT DEFAULT NULL,
    p_recorded_by    TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_payment_id     UUID;
    v_amount         NUMERIC(14,2) := round(COALESCE(p_amount, 0), 2);
    v_status         TEXT := COALESCE(p_status, 'Success');
    v_customer_id    UUID := p_customer_id;
    v_merged_into    UUID;
    v_debt_before    NUMERIC(14,2) := 0;
    v_debt_after     NUMERIC(14,2) := 0;
    v_wallet_before  NUMERIC(14,2) := 0;
    v_wallet_after   NUMERIC(14,2) := 0;
    v_debt_applied   NUMERIC(14,2) := 0;
    v_wallet_applied NUMERIC(14,2) := 0;
    v_applied_to     TEXT := 'none';
    v_existing_id    UUID;
    v_by             TEXT := COALESCE(NULLIF(trim(p_recorded_by), ''), 'System');
    v_left           NUMERIC(14,2);
    v_take           NUMERIC(14,2);
    v_rec            RECORD;
BEGIN
    PERFORM public.assert_business_member(p_business_id);
    PERFORM public.assert_permission(p_business_id, 'payments.cash', 'payments.mpesa', 'payments.verify', 'payments.card', 'payments.airtel');

    -- Same business + reference: already recorded, so return it (safe to retry).
    IF p_reference_code IS NOT NULL THEN
        SELECT id INTO v_existing_id
        FROM public.payments
        WHERE business_id = p_business_id AND reference_code = p_reference_code
        LIMIT 1;
        IF v_existing_id IS NOT NULL THEN
            RETURN v_existing_id;
        END IF;
    END IF;

    IF v_amount <= 0 THEN
        RAISE EXCEPTION 'Amount must be greater than zero.';
    END IF;
    IF p_method IS NULL OR p_method NOT IN ('Cash', 'M-Pesa', 'Airtel Money', 'Card', 'Bank') THEN
        RAISE EXCEPTION 'Choose Cash, M-Pesa, Airtel Money, Card or Bank.';
    END IF;
    IF v_status NOT IN ('Success', 'Pending', 'Failed') THEN
        RAISE EXCEPTION 'A payment is Success, Pending or Failed.';
    END IF;

    IF v_customer_id IS NOT NULL THEN
        SELECT merged_into_id INTO v_merged_into
        FROM public.customers WHERE id = v_customer_id AND business_id = p_business_id;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'That customer was not found in this business.';
        END IF;
        v_customer_id := COALESCE(v_merged_into, v_customer_id);

        SELECT COALESCE(wallet_balance, 0), COALESCE(debt_balance, 0)
        INTO v_wallet_before, v_debt_before
        FROM public.customers
        WHERE id = v_customer_id AND business_id = p_business_id
        FOR UPDATE;
    END IF;

    -- Debt first, the rest to the wallet.
    IF v_status = 'Success' AND v_customer_id IS NOT NULL THEN
        v_debt_applied   := LEAST(v_debt_before, v_amount);
        v_wallet_applied := v_amount - v_debt_applied;
        v_debt_after     := v_debt_before - v_debt_applied;
        v_wallet_after   := v_wallet_before + v_wallet_applied;
        v_applied_to := CASE
            WHEN v_debt_applied > 0 AND v_wallet_applied > 0 THEN 'mixed'
            WHEN v_debt_applied > 0 THEN 'debt'
            WHEN v_wallet_applied > 0 THEN 'wallet'
            ELSE 'none' END;
    END IF;

    INSERT INTO public.payments (
        business_id, reference_code, amount, method,
        sender_name, sender_phone, status, date,
        customer_id, customer_name, payment_type, description,
        applied_to, debt_applied, wallet_applied, reference_id, recorded_by
    )
    VALUES (
        p_business_id, p_reference_code, v_amount, p_method,
        p_sender_name, p_sender_phone, v_status, COALESCE(p_date, NOW()),
        v_customer_id, COALESCE(p_customer_name, p_sender_name),
        CASE WHEN v_customer_id IS NULL THEN 'walk-in' ELSE COALESCE(p_payment_type, 'customer') END,
        p_description,
        v_applied_to, v_debt_applied, v_wallet_applied,
        p_reference_code, v_by
    )
    RETURNING id INTO v_payment_id;

    IF v_status <> 'Success' THEN
        RETURN v_payment_id;
    END IF;

    PERFORM public.fn_post_money_asset(
        p_business_id, p_method, v_amount,
        COALESCE(p_description, 'Payment: ' || p_reference_code), v_payment_id, NULL, v_by
    );
    UPDATE public.money_assets SET last_payment_at = COALESCE(p_date, NOW())
    WHERE business_id = p_business_id AND method = p_method;

    IF v_customer_id IS NULL OR (v_debt_applied = 0 AND v_wallet_applied = 0) THEN
        RETURN v_payment_id;
    END IF;

    UPDATE public.customers
    SET debt_balance = v_debt_after, wallet_balance = v_wallet_after
    WHERE id = v_customer_id;

    IF v_debt_applied > 0 THEN
        INSERT INTO public.customer_ledger (
            business_id, customer_id, type, amount, wallet_balance,
            debt_balance, recorded_by, note, reference_id
        )
        VALUES (
            p_business_id, v_customer_id, 'debt_payment', v_debt_applied,
            v_wallet_after, v_debt_after, v_by,
            COALESCE(p_description, 'Debt payment via ' || p_method),
            p_reference_code || '-debt-payment'
        )
        ON CONFLICT (business_id, reference_id) WHERE reference_id IS NOT NULL DO NOTHING;

        -- Points for money towards a debt come from this row's trigger.
        INSERT INTO public.debt_payments (
            business_id, customer_id, amount_paid, remaining_debt,
            payment_method, recorded_by, note
        )
        VALUES (
            p_business_id, v_customer_id, v_debt_applied, v_debt_after,
            p_method, v_by, COALESCE(p_description, 'Debt payment via ' || p_method)
        );

        -- Oldest credit first.
        v_left := v_debt_applied;
        FOR v_rec IN
            SELECT id, balance FROM public.credit_payments
            WHERE customer_id = v_customer_id AND business_id = p_business_id
              AND status IN ('Open', 'Partial')
            ORDER BY created_at ASC, id ASC
            FOR UPDATE
        LOOP
            EXIT WHEN v_left <= 0;
            v_take := LEAST(v_left, v_rec.balance);
            v_left := v_left - v_take;
            UPDATE public.credit_payments
            SET amount_paid = amount_paid + v_take,
                status = CASE WHEN amount_paid + v_take >= amount_owed
                              THEN 'Settled'::public.credit_status ELSE 'Partial'::public.credit_status END,
                settled_at = CASE WHEN amount_paid + v_take >= amount_owed THEN NOW() ELSE NULL END,
                updated_at = NOW()
            WHERE id = v_rec.id;
        END LOOP;
    END IF;

    IF v_wallet_applied > 0 THEN
        INSERT INTO public.customer_ledger (
            business_id, customer_id, type, amount, wallet_balance,
            debt_balance, recorded_by, note, reference_id
        )
        VALUES (
            p_business_id, v_customer_id, 'wallet_topup', v_wallet_applied,
            v_wallet_after, v_debt_after, v_by,
            COALESCE(p_description, 'Wallet top-up via ' || p_method),
            p_reference_code || '-wallet-topup'
        )
        ON CONFLICT (business_id, reference_id) WHERE reference_id IS NOT NULL DO NOTHING;
    END IF;

    RETURN v_payment_id;
END;
$$;

-- A sale paid with Airtel Money adds to the Airtel Money balance. Same body as 20261109005,
-- except an unknown method now goes to Cash: "Other" no longer passes the balance check, so
-- the old fallback would have made the sale fail.
CREATE OR REPLACE FUNCTION public.fn_process_completed_transaction() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
    points_earned INTEGER;
    v_debt_amt    NUMERIC(14,2);
    v_asset_id     UUID;
    v_asset_before NUMERIC(14,2);
    v_asset_after  NUMERIC(14,2);
    v_method       TEXT;
BEGIN
    -- 1. Loyalty points (see fn_sale_points)
    IF NEW.customer_id IS NOT NULL THEN
        points_earned := public.fn_sale_points(NEW.final_total, NEW.delivery_fee, NEW.payment_method, NEW.wallet_applied);
        UPDATE public.customers
        SET loyalty_points = COALESCE(loyalty_points, 0) + points_earned,
            purchases_count = purchases_count + 1
        WHERE id = NEW.customer_id;
    END IF;

    -- 2. Shift sales
    IF NEW.staff_id IS NOT NULL THEN
        UPDATE public.shifts
        SET sales_count = sales_count + 1,
            sales_total = sales_total + NEW.final_total
        WHERE employee_id = NEW.staff_id AND status = 'Active' AND deleted_at IS NULL;
    END IF;

    -- 3. Money Asset Tracking
    v_method := CASE
        WHEN NEW.payment_method = 'Airtel Money' THEN 'Airtel Money'
        WHEN NEW.payment_method = 'M-Pesa' THEN 'M-Pesa'
        WHEN NEW.payment_method = 'Card' THEN 'Card'
        WHEN NEW.payment_method = 'Bank' THEN 'Bank'
        WHEN NEW.payment_method = 'Cash' THEN 'Cash'
        ELSE 'Cash'
    END;

    IF NEW.payment_method NOT IN ('Credit_Debt', 'Credit') AND NEW.final_total > 0 THEN
        INSERT INTO public.money_assets (business_id, method, balance)
        VALUES (NEW.business_id, v_method, 0)
        ON CONFLICT (business_id, method) DO NOTHING;

        SELECT id, balance INTO v_asset_id, v_asset_before
        FROM public.money_assets
        WHERE business_id = NEW.business_id AND method = v_method;

        v_asset_after := v_asset_before + NEW.final_total;

        UPDATE public.money_assets
        SET balance = v_asset_after,
            last_payment_at = NEW.timestamp,
            updated_at = NOW()
        WHERE id = v_asset_id;

        INSERT INTO public.payment_asset_ledger (
            business_id, asset_id, transaction_id, type, amount,
            balance_before, balance_after, description, method
        )
        VALUES (
            NEW.business_id, v_asset_id, NEW.id, 'Credit', NEW.final_total,
            v_asset_before, v_asset_after, 'POS Sale: ' || NEW.id, v_method
        );
    END IF;

    -- 4. Debt / wallet settlement
    IF NEW.customer_id IS NOT NULL AND NEW.payment_method IN ('Credit_Debt', 'Credit') THEN
        v_debt_amt := NEW.final_total - COALESCE(NEW.amount_paid, 0) - COALESCE(NEW.wallet_applied, 0);
        IF COALESCE(NEW.wallet_applied, 0) > 0 THEN
            UPDATE public.customers SET wallet_balance = wallet_balance - NEW.wallet_applied WHERE id = NEW.customer_id;
        END IF;
        IF v_debt_amt > 0 THEN
            INSERT INTO public.credit_payments (business_id, transaction_id, customer_id, customer_name, amount_owed, amount_paid, status, recorded_by)
            VALUES (NEW.business_id, NEW.id, NEW.customer_id, COALESCE(NEW.customer_name, 'Unknown'), v_debt_amt, 0, 'Open', NEW.staff_name);
            UPDATE public.customers SET debt_balance = debt_balance + v_debt_amt WHERE id = NEW.customer_id;
        END IF;
    END IF;

    RETURN NEW;
END;
$$;


-- ---------------------------------------------------------------------------
-- 2. Payment methods on and off
-- ---------------------------------------------------------------------------
COMMENT ON COLUMN public.businesses.default_payment_methods IS
    'The ways this business takes money, in any order: Cash, M-Pesa, Airtel Money, Card, Bank. Change with set_payment_methods().';

ALTER TABLE public.businesses DROP CONSTRAINT IF EXISTS businesses_payment_methods_check;
-- Nothing read this list before, so it is reset to what the till already showed.
UPDATE public.businesses SET default_payment_methods = ARRAY['Cash', 'M-Pesa', 'Card', 'Bank'];
ALTER TABLE public.businesses
    ALTER COLUMN default_payment_methods SET DEFAULT ARRAY['Cash', 'M-Pesa', 'Card', 'Bank'],
    ADD CONSTRAINT businesses_payment_methods_check CHECK (
        cardinality(default_payment_methods) >= 1
        AND default_payment_methods <@ ARRAY['Cash', 'M-Pesa', 'Airtel Money', 'Card', 'Bank']::TEXT[]
    );

-- Saves which methods are on. At least one must stay on. Returns the saved list in the
-- app's order.
CREATE OR REPLACE FUNCTION public.set_payment_methods(p_business_id UUID, p_methods TEXT[])
RETURNS TEXT[]
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_all  TEXT[] := ARRAY['Cash', 'M-Pesa', 'Airtel Money', 'Card', 'Bank'];
    v_list TEXT[];
    v_bad  TEXT;
BEGIN
    PERFORM public.assert_business_member(p_business_id);
    PERFORM public.assert_permission(p_business_id, 'payments.configure');

    SELECT m INTO v_bad FROM unnest(COALESCE(p_methods, '{}')) m WHERE NOT (m = ANY(v_all)) LIMIT 1;
    IF v_bad IS NOT NULL THEN
        RAISE EXCEPTION '% isn''t a payment method. Choose from Cash, M-Pesa, Airtel Money, Card and Bank.', v_bad;
    END IF;

    SELECT array_agg(m ORDER BY array_position(v_all, m)) INTO v_list
    FROM (SELECT DISTINCT m FROM unnest(p_methods) m) d;
    IF COALESCE(cardinality(v_list), 0) = 0 THEN
        RAISE EXCEPTION 'Keep at least one payment method on.';
    END IF;

    UPDATE public.businesses SET default_payment_methods = v_list WHERE id = p_business_id;
    RETURN v_list;
END;
$$;
REVOKE ALL ON FUNCTION public.set_payment_methods(UUID, TEXT[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_payment_methods(UUID, TEXT[]) TO authenticated, service_role;

-- Server-side helper for edge functions and the website.
CREATE OR REPLACE FUNCTION public.fn_method_enabled(p_business_id UUID, p_method TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT COALESCE((SELECT p_method = ANY(default_payment_methods) FROM public.businesses WHERE id = p_business_id), FALSE);
$$;
REVOKE ALL ON FUNCTION public.fn_method_enabled(UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_method_enabled(UUID, TEXT) TO service_role;

-- The website offers cards only while Card is switched on.
CREATE OR REPLACE FUNCTION public.website_accepts_cards(p_slug TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.businesses b
        JOIN public.card_payment_settings c ON c.business_id = b.id AND c.online_enabled
        JOIN public.card_payment_secrets k ON k.business_id = b.id
        WHERE b.website_slug = p_slug AND b.deleted_at IS NULL
          AND 'Card' = ANY(b.default_payment_methods)
    );
$$;
REVOKE ALL ON FUNCTION public.website_accepts_cards(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.website_accepts_cards(TEXT) TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Airtel Money
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.airtel_payment_settings (
    business_id   UUID PRIMARY KEY REFERENCES public.businesses(id) ON DELETE CASCADE,
    environment   TEXT NOT NULL DEFAULT 'staging' CHECK (environment IN ('staging', 'production')),
    country       TEXT NOT NULL DEFAULT 'KE' CHECK (country ~ '^[A-Z]{2}$'),
    currency      TEXT NOT NULL DEFAULT 'KES' CHECK (currency ~ '^[A-Z]{3}$'),
    -- The merchant code customers pay to themselves, shown on screen. Optional.
    merchant_code TEXT CHECK (merchant_code IS NULL OR length(merchant_code) BETWEEN 3 AND 20),
    status        TEXT NOT NULL DEFAULT 'connected' CHECK (status IN ('connected', 'error')),
    last_error    TEXT,
    updated_by    TEXT,
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.airtel_payment_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS pol_airtel_settings_select ON public.airtel_payment_settings;
CREATE POLICY pol_airtel_settings_select ON public.airtel_payment_settings FOR SELECT
    USING (public.has_permission(business_id, 'settings.integrations', 'payments.airtel', 'payments.view'));
-- Writes go through the airtel-payments edge function, which checks the keys with Airtel first.

CREATE TABLE IF NOT EXISTS public.airtel_payment_secrets (
    business_id    UUID PRIMARY KEY REFERENCES public.businesses(id) ON DELETE CASCADE,
    client_id      TEXT NOT NULL,
    client_secret  TEXT NOT NULL,
    -- Part of the callback URL given to Airtel; identifies the business.
    callback_token TEXT NOT NULL UNIQUE,
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.airtel_payment_secrets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.airtel_payment_secrets FROM anon, authenticated;

-- Status names match mpesa_transactions so the app treats both prompts the same way.
CREATE TABLE IF NOT EXISTS public.airtel_transactions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id     UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    -- The transaction id we send to Airtel; Airtel quotes it back.
    reference       TEXT NOT NULL UNIQUE,
    phone           TEXT NOT NULL,
    amount          NUMERIC(14,2) NOT NULL CHECK (amount > 0),
    status          TEXT NOT NULL DEFAULT 'Pending' CHECK (status IN ('Pending', 'Completed', 'Failed')),
    airtel_money_id TEXT,
    result_code     TEXT,
    result_message  TEXT,
    customer_id     UUID REFERENCES public.customers(id) ON DELETE SET NULL,
    description     TEXT,
    requested_by    TEXT,
    payment_id      UUID REFERENCES public.payments(id) ON DELETE SET NULL,
    raw             JSONB,
    paid_at         TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_airtel_transactions_business ON public.airtel_transactions (business_id, created_at DESC);
ALTER TABLE public.airtel_transactions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS pol_airtel_transactions_select ON public.airtel_transactions;
CREATE POLICY pol_airtel_transactions_select ON public.airtel_transactions FOR SELECT
    USING (public.has_permission(business_id, 'payments.view', 'payments.airtel'));
GRANT SELECT ON public.airtel_transactions, public.airtel_payment_settings TO authenticated;
GRANT ALL ON public.airtel_transactions, public.airtel_payment_settings, public.airtel_payment_secrets TO service_role;

DO $$ BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.airtel_transactions;
EXCEPTION WHEN duplicate_object OR undefined_object THEN NULL; END $$;

-- Applies Airtel's answer to a prompt. Called only by the edge functions, after they asked
-- Airtel themselves. Once per prompt: a repeat returns 'duplicate'. A prompt marked failed
-- can still be paid later (Airtel sometimes reports "ambiguous" first).
CREATE OR REPLACE FUNCTION public.confirm_airtel_payment(
    p_reference       TEXT,
    p_success         BOOLEAN,
    p_airtel_money_id TEXT,
    p_code            TEXT,
    p_message         TEXT,
    p_raw             JSONB
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_req  public.airtel_transactions%ROWTYPE;
    v_name TEXT;
    v_pid  UUID;
    v_ref  TEXT;
BEGIN
    SELECT * INTO v_req FROM public.airtel_transactions WHERE reference = p_reference FOR UPDATE;
    IF NOT FOUND THEN
        RETURN 'unknown';
    END IF;
    IF v_req.status = 'Completed' OR (v_req.status <> 'Pending' AND NOT p_success) THEN
        RETURN 'duplicate';
    END IF;

    IF NOT p_success THEN
        UPDATE public.airtel_transactions
        SET status = 'Failed', result_code = p_code, result_message = p_message,
            raw = COALESCE(p_raw, raw), updated_at = NOW()
        WHERE id = v_req.id;
        RETURN 'failed';
    END IF;

    v_ref := COALESCE(NULLIF(trim(p_airtel_money_id), ''), 'AIRTEL-' || v_req.reference);
    SELECT name INTO v_name FROM public.customers WHERE id = v_req.customer_id;

    v_pid := public.process_business_payment(
        v_req.business_id, v_ref, v_req.amount, 'Airtel Money',
        COALESCE(v_name, 'Airtel ' || v_req.phone), v_req.phone, 'Success', NOW(),
        v_req.customer_id, v_name,
        CASE WHEN v_req.customer_id IS NULL THEN 'walk-in' ELSE 'customer' END,
        COALESCE(v_req.description, 'Airtel Money prompt'), v_req.requested_by
    );

    UPDATE public.airtel_transactions
    SET status = 'Completed', airtel_money_id = v_ref, result_code = p_code, result_message = p_message,
        raw = COALESCE(p_raw, raw), payment_id = v_pid, paid_at = NOW(), updated_at = NOW()
    WHERE id = v_req.id;

    PERFORM public.fn_notify_staff(v_req.business_id, 'Airtel Money payment received',
        format('Ksh %s from %s (%s).', v_req.amount, COALESCE(v_name, v_req.phone), v_ref),
        jsonb_build_object('paymentId', v_pid));
    RETURN 'recorded';
END;
$$;
REVOKE ALL ON FUNCTION public.confirm_airtel_payment(TEXT, BOOLEAN, TEXT, TEXT, TEXT, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_airtel_payment(TEXT, BOOLEAN, TEXT, TEXT, TEXT, JSONB) TO service_role;

-- ---------------------------------------------------------------------------
-- 4. Role defaults (mirrors SYSTEM_ROLES in src/utils/permissions.ts; a test compares them)
-- payments.configure is left to owners and admins unless a role is given it.
-- ---------------------------------------------------------------------------
INSERT INTO public.role_default_permissions (role, permissions) VALUES
    ('Manager', ARRAY['ai.insights', 'ai.use', 'assets.view', 'bom.create', 'bom.update', 'bom.view', 'business.switch', 'business.view', 'communication.send', 'communication.view', 'complaints.reply', 'complaints.view', 'customers.create', 'customers.debts', 'customers.loyalty', 'customers.manage', 'customers.schedules', 'customers.update', 'customers.view', 'dashboard.view', 'deliveries.assign', 'deliveries.cancel', 'deliveries.complete', 'deliveries.create', 'deliveries.view', 'expenses.create', 'expenses.update', 'expenses.view', 'files.view', 'finance.view', 'home.view', 'inventory.adjust_stock', 'inventory.expiry', 'inventory.receive_stock', 'inventory.stock_count', 'inventory.stock_history', 'inventory.transfer_stock', 'inventory.view', 'inventory.wastage', 'loyalty.adjust', 'notifications.send', 'notifications.view', 'online_store.view', 'orders.assign_rider', 'orders.complete', 'orders.create', 'orders.update', 'orders.view', 'payments.card', 'payments.cash', 'payments.verify', 'payments.view', 'pettycash.record', 'pos.close_shift', 'pos.create_sale', 'pos.open_shift', 'pos.walkin_customer', 'production.approve', 'production.create', 'production.update', 'production.view', 'products.create', 'products.export', 'products.import', 'products.manage_categories', 'products.update', 'products.view', 'purchases.approve', 'purchases.create', 'purchases.export', 'purchases.print', 'purchases.update', 'purchases.view', 'reports.customers', 'reports.deliveries', 'reports.inventory', 'reports.profit', 'reports.sales', 'reports.view', 'settings.tax', 'settings.theme', 'settings.update', 'settings.view', 'staff.schedule', 'staff.view', 'suppliers.create', 'suppliers.export', 'suppliers.import', 'suppliers.update', 'suppliers.view']),
    ('Cashier', ARRAY['ai.use', 'business.view', 'complaints.view', 'customers.create', 'customers.debts', 'customers.loyalty', 'customers.schedules', 'customers.view', 'dashboard.view', 'inventory.view', 'notifications.view', 'online_store.view', 'orders.assign_rider', 'orders.create', 'orders.update', 'orders.view', 'payments.card', 'payments.cash', 'payments.mpesa', 'payments.airtel', 'payments.verify', 'pettycash.record', 'pos.cancel_sale', 'pos.close_shift', 'pos.create_sale', 'pos.discount', 'pos.open_shift', 'pos.walkin_customer', 'products.view', 'settings.theme']),
    ('Rider', ARRAY['ai.use', 'business.view', 'dashboard.view', 'deliveries.cancel', 'deliveries.complete', 'deliveries.delivery_price', 'deliveries.delivery_zones', 'deliveries.view', 'notifications.view', 'settings.theme'])
ON CONFLICT (role) DO UPDATE SET permissions = EXCLUDED.permissions;

NOTIFY pgrst, 'reload schema';

COMMIT;
