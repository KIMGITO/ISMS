-- =============================================================================
-- 20260819001_money_assets_payments.sql
-- integrated Shop Management System
-- Payments, money assets, and the asset ledger
-- =============================================================================
-- Why: Links payments to customers, reconciles them against debt and wallet,
-- and keeps one balance per payment method. Sales and payments credit it and
-- expenses debit it, each with an immutable ledger row.
-- fn_process_completed_transaction, which credits sales, is in migration 012.
-- Dependencies: 001-016
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. ENHANCE payments TABLE
-- ---------------------------------------------------------------------------
ALTER TABLE public.payments
    ADD COLUMN IF NOT EXISTS customer_id        UUID REFERENCES public.customers(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS customer_name      TEXT,
    ADD COLUMN IF NOT EXISTS payment_type       TEXT NOT NULL DEFAULT 'walk-in'
        CHECK (payment_type IN ('customer', 'walk-in')),
    ADD COLUMN IF NOT EXISTS description        TEXT,
    ADD COLUMN IF NOT EXISTS applied_to         TEXT NOT NULL DEFAULT 'none'
        CHECK (applied_to IN ('none', 'debt', 'wallet', 'mixed')),
    ADD COLUMN IF NOT EXISTS debt_applied       NUMERIC(14,2) NOT NULL DEFAULT 0.00 CHECK (debt_applied >= 0),
    ADD COLUMN IF NOT EXISTS wallet_applied     NUMERIC(14,2) NOT NULL DEFAULT 0.00 CHECK (wallet_applied >= 0),
    ADD COLUMN IF NOT EXISTS reference_id       TEXT,
    ADD COLUMN IF NOT EXISTS recorded_by        TEXT;

-- Idempotency: unique business + reference code per payment
CREATE UNIQUE INDEX IF NOT EXISTS uq_payments_business_reference
    ON public.payments(business_id, reference_code);

-- Fast lookups
CREATE INDEX IF NOT EXISTS idx_payments_customer_id
    ON public.payments(customer_id);
CREATE INDEX IF NOT EXISTS idx_payments_payment_type
    ON public.payments(payment_type);
CREATE INDEX IF NOT EXISTS idx_payments_method
    ON public.payments(method);
CREATE INDEX IF NOT EXISTS idx_payments_status
    ON public.payments(status);
CREATE INDEX IF NOT EXISTS idx_payments_date
    ON public.payments(date);

-- ---------------------------------------------------------------------------
-- 2. TABLE: money_assets
-- Business money received, tracked per payment method.
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

-- ---------------------------------------------------------------------------
-- 3. TABLE: payment_asset_ledger
-- Immutable record of every money_assets movement. payment_id, transaction_id,
-- and expense_id say what caused it; method is kept for traceability.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.payment_asset_ledger (
    id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id    UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    payment_id     UUID REFERENCES public.payments(id) ON DELETE CASCADE,
    method         TEXT,
    amount         NUMERIC(14,2) NOT NULL CHECK (amount <> 0),
    balance_before NUMERIC(14,2) NOT NULL DEFAULT 0.00,
    balance_after  NUMERIC(14,2) NOT NULL DEFAULT 0.00,
    recorded_by    TEXT,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    asset_id       UUID NOT NULL REFERENCES public.money_assets(id) ON DELETE CASCADE,
    transaction_id UUID REFERENCES public.transactions(id) ON DELETE SET NULL,
    expense_id     UUID REFERENCES public.expenses(id) ON DELETE SET NULL,
    type           TEXT NOT NULL CHECK (type IN ('Credit', 'Debit')),
    description    TEXT
    -- No updated_at: append-only ledger
);

ALTER TABLE public.payment_asset_ledger ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_payment_asset_ledger_payment_id
    ON public.payment_asset_ledger(payment_id);
CREATE INDEX IF NOT EXISTS idx_payment_asset_ledger_business_id
    ON public.payment_asset_ledger(business_id);

-- ---------------------------------------------------------------------------
-- 4. ENHANCE expenses TABLE: the method each expense is paid from
-- ---------------------------------------------------------------------------
ALTER TABLE public.expenses
    ADD COLUMN IF NOT EXISTS payment_method TEXT DEFAULT 'Cash'
    CHECK (payment_method IN ('M-Pesa', 'Cash', 'Card', 'Bank', 'Other', 'Mobile_Wallet'));

-- ---------------------------------------------------------------------------
-- 5. RLS POLICIES
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS pol_payments_all ON public.payments;
CREATE POLICY pol_payments_all ON public.payments
    FOR ALL USING (business_id = ANY(public.get_user_business_ids()));

DROP POLICY IF EXISTS pol_money_assets_all ON public.money_assets;
CREATE POLICY pol_money_assets_all ON public.money_assets
    FOR ALL USING (business_id = ANY(public.get_user_business_ids()));

DROP POLICY IF EXISTS pol_payment_asset_ledger_all ON public.payment_asset_ledger;
CREATE POLICY pol_payment_asset_ledger_all ON public.payment_asset_ledger
    FOR ALL USING (business_id = ANY(public.get_user_business_ids()));

DROP POLICY IF EXISTS pol_payment_asset_ledger_select ON public.payment_asset_ledger;
CREATE POLICY pol_payment_asset_ledger_select ON public.payment_asset_ledger
    FOR SELECT USING (business_id = ANY(public.get_user_business_ids()));

-- ---------------------------------------------------------------------------
-- 6. ATOMIC RPC: process_business_payment
-- Records a payment, increments money asset, and applies to customer
-- debt/wallet if a customer is linked. All in ONE DB transaction.
-- Idempotent via p_reference_code (unique business + reference code).
-- ---------------------------------------------------------------------------
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
    v_payment_id      UUID;
    v_debt_before     NUMERIC(14,2) := 0;
    v_debt_after      NUMERIC(14,2) := 0;
    v_wallet_before   NUMERIC(14,2) := 0;
    v_wallet_after    NUMERIC(14,2) := 0;
    v_debt_applied    NUMERIC(14,2) := 0;
    v_wallet_applied  NUMERIC(14,2) := 0;
    v_applied_to      TEXT := 'none';
    v_asset_before    NUMERIC(14,2) := 0;
    v_asset_after     NUMERIC(14,2) := 0;
    v_existing_id     UUID;
BEGIN
    -- Idempotency check: existing payment with same business + reference code
    IF p_reference_code IS NOT NULL THEN
        SELECT id INTO v_existing_id
        FROM public.payments
        WHERE business_id = p_business_id
          AND reference_code = p_reference_code
        LIMIT 1;

        IF v_existing_id IS NOT NULL THEN
            RETURN v_existing_id;
        END IF;
    END IF;

    -- Validate
    IF p_amount <= 0 THEN
        RAISE EXCEPTION 'Amount must be greater than zero.';
    END IF;

    -- Load customer balances if a customer is linked
    IF p_customer_id IS NOT NULL THEN
        SELECT COALESCE(wallet_balance, 0), COALESCE(debt_balance, 0)
        INTO v_wallet_before, v_debt_before
        FROM public.customers
        WHERE id = p_customer_id;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'Customer not found: %', p_customer_id;
        END IF;
    END IF;

    -- Determine debt/wallet split for successful payments
    IF p_status = 'Success' AND p_customer_id IS NOT NULL AND v_debt_before + v_wallet_before > 0 THEN
        -- First apply to outstanding debt, then to wallet
        v_debt_applied   := LEAST(v_debt_before, p_amount);
        v_wallet_applied := p_amount - v_debt_applied;

        -- Only apply to wallet if customer has no remaining debt AND has used
        -- wallet before, OR if amount exceeds total debt. We always credit
        -- the wallet with any remaining amount after debt settlement.
        -- The customers table constraint prevents having both debt > 0 and
        -- wallet > 0 simultaneously, so if v_debt_before > 0 and the payment
        -- only partially covers it, v_wallet_applied must be 0.

        -- Actually: After debt payment, if amount remains, it goes to wallet.
        -- But the DB constraint chk_not_both_debt_and_wallet prevents both
        -- being > 0 at the same time. Since we compute debt_after first:
        v_debt_after   := v_debt_before - v_debt_applied;

        -- If debt is fully cleared and there is remaining money, credit wallet
        IF v_debt_after = 0 THEN
            v_wallet_after := v_wallet_before + v_wallet_applied;
        ELSE
            -- Still has debt; all payment went to debt
            v_wallet_after   := v_wallet_before;
            v_wallet_applied := 0;
            -- Recompute: remaining after debt should still be 0 if debt not cleared
        END IF;

        IF v_debt_applied > 0 AND v_wallet_applied > 0 THEN
            v_applied_to := 'mixed';
        ELSIF v_debt_applied > 0 THEN
            v_applied_to := 'debt';
        ELSIF v_wallet_applied > 0 THEN
            v_applied_to := 'wallet';
        END IF;
    END IF;

    -- ---------------------------------------------------------------------
    -- Insert payment record
    -- ---------------------------------------------------------------------
    INSERT INTO public.payments (
        business_id, reference_code, amount, method,
        sender_name, sender_phone, status, date,
        customer_id, customer_name, payment_type, description,
        applied_to, debt_applied, wallet_applied, reference_id, recorded_by
    )
    VALUES (
        p_business_id, p_reference_code, p_amount, p_method,
        p_sender_name, p_sender_phone, p_status, p_date,
        p_customer_id, COALESCE(p_customer_name, p_sender_name),
        p_payment_type, p_description,
        v_applied_to, v_debt_applied, v_wallet_applied,
        p_reference_code, p_recorded_by
    )
    RETURNING id INTO v_payment_id;

    -- ---------------------------------------------------------------------
    -- Only successful payments affect assets and customer balances
    -- ---------------------------------------------------------------------
    IF p_status = 'Success' THEN
        -- Increment money asset for this method
        SELECT COALESCE(balance, 0)
        INTO v_asset_before
        FROM public.money_assets
        WHERE business_id = p_business_id AND method = p_method;

        v_asset_after := v_asset_before + p_amount;

        INSERT INTO public.money_assets (business_id, method, balance, last_payment_at)
        VALUES (p_business_id, p_method, v_asset_after, p_date)
        ON CONFLICT (business_id, method)
        DO UPDATE SET
            balance = money_assets.balance + p_amount,
            last_payment_at = p_date,
            updated_at = NOW();

        -- Asset ledger entry
        INSERT INTO public.payment_asset_ledger (
            business_id, payment_id, method, amount,
            balance_before, balance_after, recorded_by
        )
        VALUES (
            p_business_id, v_payment_id, p_method, p_amount,
            v_asset_before, v_asset_before + p_amount, p_recorded_by
        );

        -- Apply to customer debt + wallet
        IF p_customer_id IS NOT NULL AND (v_debt_applied > 0 OR v_wallet_applied > 0) THEN
            -- Update customer balances
            UPDATE public.customers
            SET debt_balance   = v_debt_after,
                wallet_balance = v_wallet_after
            WHERE id = p_customer_id;

            -- Debt portion ledger entry
            IF v_debt_applied > 0 THEN
                INSERT INTO public.customer_ledger (
                    business_id, customer_id, type, amount, wallet_balance,
                    debt_balance, recorded_by, note, reference_id
                )
                VALUES (
                    p_business_id, p_customer_id, 'debt_payment', v_debt_applied,
                    v_wallet_after, v_debt_after, p_recorded_by,
                    COALESCE(p_description, 'Debt payment via ' || p_method),
                    p_reference_code || '-debt-payment'
                )
                ON CONFLICT (business_id, reference_id) WHERE reference_id IS NOT NULL DO NOTHING;

                -- Insert into debt_payments history
                INSERT INTO public.debt_payments (
                    business_id, customer_id, amount_paid, remaining_debt,
                    payment_method, recorded_by, note
                )
                VALUES (
                    p_business_id, p_customer_id, v_debt_applied, v_debt_after,
                    p_method, p_recorded_by,
                    COALESCE(p_description, 'Debt payment via ' || p_method)
                );

                -- Update credit_payments FIFO
                DECLARE
                    v_rem_payment NUMERIC(14,2) := v_debt_applied;
                    v_applied     NUMERIC(14,2);
                    v_rec         RECORD;
                BEGIN
                    FOR v_rec IN
                        SELECT id, amount_owed, amount_paid AS existing_paid, balance
                        FROM public.credit_payments
                        WHERE customer_id = p_customer_id
                          AND business_id = p_business_id
                          AND status IN ('Open', 'Partial')
                        ORDER BY created_at ASC
                    LOOP
                        EXIT WHEN v_rem_payment <= 0;

                        v_applied := LEAST(v_rem_payment, v_rec.balance);
                        v_rem_payment := v_rem_payment - v_applied;

                        UPDATE public.credit_payments
                        SET
                            amount_paid = amount_paid + v_applied,
                            status = CASE
                                WHEN (amount_paid + v_applied) >= amount_owed
                                    THEN 'Settled'::public.credit_status
                                ELSE 'Partial'::public.credit_status
                            END,
                            settled_at = CASE
                                WHEN (amount_paid + v_applied) >= amount_owed THEN NOW()
                                ELSE NULL
                            END,
                            updated_at = NOW()
                        WHERE id = v_rec.id;
                    END LOOP;
                END;
            END IF;

            -- Wallet portion ledger entry
            IF v_wallet_applied > 0 THEN
                INSERT INTO public.customer_ledger (
                    business_id, customer_id, type, amount, wallet_balance,
                    debt_balance, recorded_by, note, reference_id
                )
                VALUES (
                    p_business_id, p_customer_id, 'wallet_topup', v_wallet_applied,
                    v_wallet_after, v_debt_after, p_recorded_by,
                    COALESCE(p_description, 'Wallet top-up via ' || p_method),
                    p_reference_code || '-wallet-topup'
                )
                ON CONFLICT (business_id, reference_id) WHERE reference_id IS NOT NULL DO NOTHING;
            END IF;
        END IF;
    END IF;

    RETURN v_payment_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- 7. HELPER: get money asset balances for a business
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_money_assets(
    p_business_id UUID
)
RETURNS TABLE (
    method        TEXT,
    balance       NUMERIC(14,2),
    last_payment_at TIMESTAMPTZ
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT method, balance, last_payment_at
    FROM public.money_assets
    WHERE business_id = p_business_id
    ORDER BY balance DESC;
$$;

-- ---------------------------------------------------------------------------
-- 8. HELPER: get business payment with customer info
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_business_payments(
    p_business_id UUID,
    p_limit       INTEGER DEFAULT 100,
    p_offset      INTEGER DEFAULT 0
)
RETURNS TABLE (
    id             UUID,
    reference_code TEXT,
    amount         NUMERIC(14,2),
    method         TEXT,
    sender_name    TEXT,
    sender_phone   TEXT,
    status         TEXT,
    date           TIMESTAMPTZ,
    customer_id    UUID,
    customer_name  TEXT,
    payment_type   TEXT,
    description    TEXT,
    applied_to     TEXT,
    debt_applied   NUMERIC(14,2),
    wallet_applied NUMERIC(14,2),
    recorded_by    TEXT,
    created_at     TIMESTAMPTZ
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT
        p.id, p.reference_code, p.amount, p.method,
        p.sender_name, p.sender_phone, p.status, p.date,
        p.customer_id, p.customer_name, p.payment_type, p.description,
        p.applied_to, p.debt_applied, p.wallet_applied, p.recorded_by, p.created_at
    FROM public.payments p
    WHERE p.business_id = p_business_id
    ORDER BY p.date DESC
    LIMIT p_limit OFFSET p_offset;
$$;

-- ---------------------------------------------------------------------------
-- 9. ATOMIC RPC: process_business_payment, without p_customer_name
-- Writes the full ledger row (asset_id, type, description). A named call that
-- omits p_customer_name matches both this and section 6, so it fails as ambiguous.
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
-- 10. TRIGGER: debit the matching money asset when an expense is recorded
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

-- Force API schema compilation update
NOTIFY pgrst, 'reload schema';

COMMIT;
