-- =============================================================================
-- 20260917002_integrate_money_received.sql
-- ISMS — Integrated Money Asset & Expense Tracking
-- =============================================================================
-- Why: Resolve PGRST205 (missing money_assets table) and integrate
-- money received (Sales/Payments) and money spent (Expenses) into a 
-- unified asset balance system.
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. ENSURE BASE TABLES EXIST
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.money_assets (
    id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id   UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    method        TEXT NOT NULL CHECK (method IN ('M-Pesa', 'Cash', 'Card', 'Bank', 'Other', 'Mobile_Wallet')),
    balance       NUMERIC(14,2) NOT NULL DEFAULT 0.00 CHECK (balance >= 0),
    last_payment_at TIMESTAMPTZ,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (business_id, method)
);

ALTER TABLE public.money_assets ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.payment_asset_ledger (
    id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id   UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    asset_id      UUID NOT NULL REFERENCES public.money_assets(id) ON DELETE CASCADE,
    payment_id    UUID REFERENCES public.payments(id) ON DELETE SET NULL,
    transaction_id UUID REFERENCES public.transactions(id) ON DELETE SET NULL,
    expense_id    UUID REFERENCES public.expenses(id) ON DELETE SET NULL,
    type          TEXT NOT NULL CHECK (type IN ('Credit', 'Debit')),
    amount        NUMERIC(14,2) NOT NULL CHECK (amount <> 0),
    balance_before NUMERIC(14,2) NOT NULL,
    balance_after  NUMERIC(14,2) NOT NULL,
    description   TEXT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.payment_asset_ledger ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- 2. ENHANCE EXPENSES TABLE
-- ---------------------------------------------------------------------------
ALTER TABLE public.expenses
    ADD COLUMN IF NOT EXISTS payment_method TEXT DEFAULT 'Cash'
    CHECK (payment_method IN ('M-Pesa', 'Cash', 'Card', 'Bank', 'Other', 'Mobile_Wallet'));

COMMIT;
BEGIN;

-- ---------------------------------------------------------------------------
-- 3. UPDATED RPC: process_business_payment
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.process_business_payment(
    p_business_id   UUID,
    p_reference_code TEXT,
    p_amount        NUMERIC,
    p_method        TEXT,
    p_sender_name   TEXT,
    p_sender_phone  TEXT DEFAULT NULL,
    p_status        TEXT DEFAULT 'Success',
    p_date          TIMESTAMPTZ DEFAULT NOW(),
    p_customer_id   UUID DEFAULT NULL,
    p_payment_type  TEXT DEFAULT 'walk-in',
    p_description   TEXT DEFAULT NULL,
    p_recorded_by   TEXT DEFAULT NULL
) RETURNS UUID AS $$
DECLARE
    v_payment_id   UUID;
    v_asset_id     UUID;
    v_asset_before NUMERIC(14,2);
    v_asset_after  NUMERIC(14,2);
BEGIN
    INSERT INTO public.payments (
        business_id, reference_code, amount, method, sender_name,
        sender_phone, status, date, customer_id, payment_type,
        description, recorded_by, created_at
    )
    VALUES (
        p_business_id, p_reference_code, p_amount, p_method, p_sender_name,
        p_sender_phone, p_status, p_date, p_customer_id, p_payment_type,
        p_description, p_recorded_by, NOW()
    )
    RETURNING id INTO v_payment_id;

    IF p_status = 'Success' THEN
        INSERT INTO public.money_assets (business_id, method, balance)
        VALUES (p_business_id, p_method, 0)
        ON CONFLICT (business_id, method) DO NOTHING;

        SELECT id, balance INTO v_asset_id, v_asset_before
        FROM public.money_assets
        WHERE business_id = p_business_id AND method = p_method;

        v_asset_after := v_asset_before + p_amount;

        UPDATE public.money_assets
        SET balance = v_asset_after,
            last_payment_at = p_date,
            updated_at = NOW()
        WHERE id = v_asset_id;

        INSERT INTO public.payment_asset_ledger (
            business_id, asset_id, payment_id, type, amount,
            balance_before, balance_after, description, method
        )
        VALUES (
            p_business_id, v_asset_id, v_payment_id, 'Credit', p_amount,
            v_asset_before, v_asset_after, 'Manual Payment: ' || p_reference_code, p_method
        );
    END IF;
    RETURN v_payment_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ---------------------------------------------------------------------------
-- 4. NEW TRIGGER: fn_process_expense_asset_update()
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_process_expense_asset_update()
RETURNS TRIGGER AS $$
DECLARE
    v_asset_id     UUID;
    v_asset_before NUMERIC(14,2);
    v_asset_after  NUMERIC(14,2);
BEGIN
    IF NEW.deleted_at IS NULL THEN
        INSERT INTO public.money_assets (business_id, method, balance)
        VALUES (NEW.business_id, NEW.payment_method, 0)
        ON CONFLICT (business_id, method) DO NOTHING;

        SELECT id, balance INTO v_asset_id, v_asset_before
        FROM public.money_assets
        WHERE business_id = NEW.business_id AND method = NEW.payment_method;

        v_asset_after := v_asset_before - NEW.amount;
        
        UPDATE public.money_assets
        SET balance = v_asset_after, updated_at = NOW()
        WHERE id = v_asset_id;

        INSERT INTO public.payment_asset_ledger (
            business_id, asset_id, expense_id, type, amount,
            balance_before, balance_after, description, method
        )
        VALUES (
            NEW.business_id, v_asset_id, NEW.id, 'Debit', -NEW.amount,
            v_asset_before, v_asset_after, 'Expense: ' || NEW.category, NEW.payment_method
        );
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_process_expense_asset_update ON public.expenses;
CREATE TRIGGER trg_process_expense_asset_update
AFTER INSERT ON public.expenses
FOR EACH ROW EXECUTE FUNCTION public.fn_process_expense_asset_update();

COMMIT;
BEGIN;

-- ---------------------------------------------------------------------------
-- 5. UPDATE: fn_process_completed_transaction()
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_process_completed_transaction()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    points_earned INTEGER;
    v_debt_amt    NUMERIC(14,2);
    v_asset_id     UUID;
    v_asset_before NUMERIC(14,2);
    v_asset_after  NUMERIC(14,2);
    v_method       TEXT;
BEGIN
    -- 1. Loyalty points
    IF NEW.customer_id IS NOT NULL THEN
        points_earned := GREATEST(0, FLOOR((NEW.final_total - COALESCE(NEW.delivery_fee, 0)) / 100));
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
        WHEN NEW.payment_method = 'Mobile_Wallet' THEN 'Mobile_Wallet'
        WHEN NEW.payment_method = 'M-Pesa' THEN 'M-Pesa'
        WHEN NEW.payment_method = 'Card' THEN 'Card'
        WHEN NEW.payment_method = 'Bank' THEN 'Bank'
        WHEN NEW.payment_method = 'Cash' THEN 'Cash'
        ELSE 'Other'
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

-- 6. POLICIES
DROP POLICY IF EXISTS pol_money_assets_all ON public.money_assets;
CREATE POLICY pol_money_assets_all ON public.money_assets
    FOR ALL USING (business_id = ANY(public.get_user_business_ids()));

DROP POLICY IF EXISTS pol_payment_asset_ledger_select ON public.payment_asset_ledger;
CREATE POLICY pol_payment_asset_ledger_select ON public.payment_asset_ledger
    FOR SELECT USING (business_id = ANY(public.get_user_business_ids()));

NOTIFY pgrst, 'reload schema';

COMMIT;
