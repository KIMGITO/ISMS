-- =============================================================================
-- 20260808_004_create_wallet_debt_rpcs.sql
-- integrated Shop Management System
-- Create atomic RPCs for wallet top-up, debt payment, and wallet spending.
-- All RPCs are idempotent via reference_id.
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. process_wallet_topup
-- Handles wallet top-up with optional debt repayment in one DB transaction.
-- Idempotent via reference_id.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.process_wallet_topup(
    p_business_id   UUID,
    p_customer_id   UUID,
    p_amount        NUMERIC(14,2),
    p_recorded_by   TEXT,
    p_note          TEXT,
    p_reference_id  TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_wallet_before NUMERIC(14,2);
    v_wallet_after  NUMERIC(14,2);
    v_debt_before   NUMERIC(14,2);
    v_debt_after    NUMERIC(14,2);
    v_debt_paid     NUMERIC(14,2);
    v_wallet_dep    NUMERIC(14,2);
BEGIN
    -- Idempotency check
    IF p_reference_id IS NOT NULL THEN
        IF EXISTS (
            SELECT 1 FROM public.customer_ledger
            WHERE business_id = p_business_id
              AND reference_id = p_reference_id
        ) THEN
            RETURN;
        END IF;
    END IF;

    -- Validate
    IF p_amount <= 0 THEN
        RAISE EXCEPTION 'Amount must be greater than zero.';
    END IF;

    SELECT wallet_balance, debt_balance
    INTO v_wallet_before, v_debt_before
    FROM public.customers
    WHERE id = p_customer_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Customer not found: %', p_customer_id;
    END IF;

    v_wallet_before := COALESCE(v_wallet_before, 0);
    v_debt_before   := COALESCE(v_debt_before, 0);

    -- Apply payment: first to debt, then to wallet
    v_debt_paid  := LEAST(v_debt_before, p_amount);
    v_wallet_dep := p_amount - v_debt_paid;

    v_debt_after  := v_debt_before - v_debt_paid;
    v_wallet_after := v_wallet_before + v_wallet_dep;

    -- Update customer balances
    UPDATE public.customers
    SET debt_balance = v_debt_after,
        wallet_balance = v_wallet_after
    WHERE id = p_customer_id;

    -- Ledger entry for debt payment (if any)
    IF v_debt_paid > 0 THEN
        INSERT INTO public.customer_ledger
            (business_id, customer_id, type, amount, wallet_balance, debt_balance,
             recorded_by, note, reference_id)
        VALUES (
            p_business_id, p_customer_id, 'debt_payment', v_debt_paid,
            v_wallet_after, v_debt_after, p_recorded_by,
            COALESCE(p_note, 'Debt automatically paid off via wallet deposit'),
            p_reference_id || '-debt-payment'
        )
        ON CONFLICT (business_id, reference_id) WHERE reference_id IS NOT NULL DO NOTHING;
    END IF;

    -- Ledger entry for wallet top-up (if any)
    IF v_wallet_dep > 0 THEN
        INSERT INTO public.customer_ledger
            (business_id, customer_id, type, amount, wallet_balance, debt_balance,
             recorded_by, note, reference_id)
        VALUES (
            p_business_id, p_customer_id, 'wallet_topup', v_wallet_dep,
            v_wallet_after, v_debt_after, p_recorded_by,
            COALESCE(p_note, 'Wallet top-up'),
            p_reference_id || '-wallet-topup'
        )
        ON CONFLICT (business_id, reference_id) WHERE reference_id IS NOT NULL DO NOTHING;
    END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- 2. process_debt_payment
-- Handles debt repayment in one DB transaction. Idempotent via reference_id.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.process_debt_payment(
    p_business_id   UUID,
    p_customer_id   UUID,
    p_amount        NUMERIC(14,2),
    p_method        TEXT,
    p_recorded_by   TEXT,
    p_note          TEXT,
    p_reference_id  TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_wallet_before NUMERIC(14,2);
    v_debt_before   NUMERIC(14,2);
    v_debt_after    NUMERIC(14,2);
    v_rem_payment   NUMERIC(14,2);
    v_applied       NUMERIC(14,2);
    v_rec           RECORD;
BEGIN
    -- Idempotency check
    IF p_reference_id IS NOT NULL THEN
        IF EXISTS (
            SELECT 1 FROM public.customer_ledger
            WHERE business_id = p_business_id
              AND reference_id = p_reference_id
        ) THEN
            RETURN;
        END IF;
    END IF;

    -- Validate
    IF p_amount <= 0 THEN
        RAISE EXCEPTION 'Amount must be greater than zero.';
    END IF;

    SELECT wallet_balance, debt_balance
    INTO v_wallet_before, v_debt_before
    FROM public.customers
    WHERE id = p_customer_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Customer not found: %', p_customer_id;
    END IF;

    v_wallet_before := COALESCE(v_wallet_before, 0);
    v_debt_before   := COALESCE(v_debt_before, 0);

    IF p_amount > v_debt_before THEN
        RAISE EXCEPTION 'Cannot pay off more than outstanding debt.';
    END IF;

    v_debt_after := v_debt_before - p_amount;

    -- Update customer debt
    UPDATE public.customers
    SET debt_balance = v_debt_after
    WHERE id = p_customer_id;

    -- Create debt payment record
    INSERT INTO public.debt_payments
        (business_id, customer_id, amount_paid, remaining_debt,
         payment_method, recorded_by, note)
    VALUES (
        p_business_id, p_customer_id, p_amount, v_debt_after,
        p_method, p_recorded_by, COALESCE(p_note, '')
    );

    -- Update credit_payments FIFO
    v_rem_payment := p_amount;
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

    -- Create ledger entry
    INSERT INTO public.customer_ledger
        (business_id, customer_id, type, amount, wallet_balance, debt_balance,
         recorded_by, note, reference_id)
    VALUES (
        p_business_id, p_customer_id, 'debt_payment', p_amount,
        v_wallet_before, v_debt_after, p_recorded_by,
        COALESCE(p_note, 'Debt payment via ' || p_method),
        p_reference_id
    )
    ON CONFLICT (business_id, reference_id) WHERE reference_id IS NOT NULL DO NOTHING;
END;
$$;

-- ---------------------------------------------------------------------------
-- 3. process_wallet_spend
-- Handles wallet spending in one DB transaction. Idempotent via reference_id.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.process_wallet_spend(
    p_business_id   UUID,
    p_customer_id   UUID,
    p_amount        NUMERIC(14,2),
    p_recorded_by   TEXT,
    p_note          TEXT,
    p_reference_id  TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_wallet_before NUMERIC(14,2);
    v_wallet_after  NUMERIC(14,2);
    v_debt_before   NUMERIC(14,2);
BEGIN
    -- Idempotency check
    IF p_reference_id IS NOT NULL THEN
        IF EXISTS (
            SELECT 1 FROM public.customer_ledger
            WHERE business_id = p_business_id
              AND reference_id = p_reference_id
        ) THEN
            RETURN;
        END IF;
    END IF;

    -- Validate
    IF p_amount <= 0 THEN
        RAISE EXCEPTION 'Amount must be greater than zero.';
    END IF;

    SELECT wallet_balance, debt_balance
    INTO v_wallet_before, v_debt_before
    FROM public.customers
    WHERE id = p_customer_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Customer not found: %', p_customer_id;
    END IF;

    v_wallet_before := COALESCE(v_wallet_before, 0);
    v_debt_before   := COALESCE(v_debt_before, 0);

    IF p_amount > v_wallet_before THEN
        RAISE EXCEPTION 'Insufficient wallet balance.';
    END IF;

    v_wallet_after := v_wallet_before - p_amount;

    -- Update customer wallet
    UPDATE public.customers
    SET wallet_balance = v_wallet_after
    WHERE id = p_customer_id;

    -- Create ledger entry
    INSERT INTO public.customer_ledger
        (business_id, customer_id, type, amount, wallet_balance, debt_balance,
         recorded_by, note, reference_id)
    VALUES (
        p_business_id, p_customer_id, 'wallet_usage', p_amount,
        v_wallet_after, v_debt_before, p_recorded_by,
        COALESCE(p_note, 'Wallet credit spent'),
        p_reference_id
    )
    ON CONFLICT (business_id, reference_id) WHERE reference_id IS NOT NULL DO NOTHING;
END;
$$;

-- Force API schema compilation update
NOTIFY pgrst, 'reload schema';

COMMIT;