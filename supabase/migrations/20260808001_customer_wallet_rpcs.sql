-- =============================================================================
-- 20260808001_customer_wallet_rpcs.sql
-- integrated Shop Management System
-- Atomic RPCs for customer sales, wallet, and debt
-- =============================================================================
-- Why: Wallet balance and debt coexist (a customer with 168 wallet buying 200
-- on credit ends at wallet=0, debt=32). These RPCs apply each operation in one
-- DB transaction and are idempotent via reference_id.
-- Dependencies: 001-016
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. process_customer_transaction
-- Handles the complete customer sale operation in one DB transaction:
--   - Validates customer exists
--   - Computes wallet_used = MIN(wallet_balance, final_total)
--   - Computes debt_created = final_total - wallet_used
--   - Deducts wallet, adds debt atomically
--   - Creates transaction + items
--   - Creates credit_payments record if debt > 0
--   - Creates customer_ledger entries
--   - Creates wallet_transactions entries
--   - Idempotent via reference_id (ON CONFLICT DO NOTHING)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.process_customer_transaction(
    p_business_id    UUID,
    p_customer_id    UUID,
    p_customer_name  TEXT,
    p_staff_id       UUID,
    p_staff_name     TEXT,
    p_total          NUMERIC(14,2),
    p_discount       NUMERIC(14,2),
    p_tax            NUMERIC(14,2),
    p_final_total    NUMERIC(14,2),
    p_amount_paid    NUMERIC(14,2),
    p_payment_method public.payment_method,
    p_timestamp      TIMESTAMPTZ,
    p_note           TEXT,
    p_is_delivery    BOOLEAN,
    p_delivery_fee   NUMERIC(14,2),
    p_rider_name     TEXT,
    p_reference_id   TEXT,
    p_items          JSONB
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_tx_id          UUID;
    v_wallet_before  NUMERIC(14,2);
    v_wallet_after   NUMERIC(14,2);
    v_debt_before    NUMERIC(14,2);
    v_debt_after     NUMERIC(14,2);
    v_wallet_used    NUMERIC(14,2);
    v_debt_created   NUMERIC(14,2);
    v_item           JSONB;
    v_line_total     NUMERIC(14,2);
BEGIN
    -- Idempotency check: if this reference_id was already processed, return existing tx
    IF p_reference_id IS NOT NULL THEN
        SELECT id INTO v_tx_id
        FROM public.transactions
        WHERE business_id = p_business_id
          AND reference_id = p_reference_id
          AND deleted_at IS NULL;

        IF FOUND THEN
            RETURN v_tx_id;
        END IF;
    END IF;

    -- Validate customer exists
    IF NOT EXISTS (SELECT 1 FROM public.customers WHERE id = p_customer_id) THEN
        RAISE EXCEPTION 'Customer not found: %', p_customer_id;
    END IF;

    -- Fetch current balances
    SELECT wallet_balance, debt_balance
    INTO v_wallet_before, v_debt_before
    FROM public.customers
    WHERE id = p_customer_id;

    v_wallet_before := COALESCE(v_wallet_before, 0);
    v_debt_before   := COALESCE(v_debt_before, 0);

    -- Compute wallet usage and debt creation
    -- For credit sales: wallet is applied first, remaining becomes debt
    IF p_payment_method IN ('Credit_Debt', 'Credit') THEN
        v_wallet_used  := LEAST(v_wallet_before, p_final_total);
        v_debt_created := GREATEST(0, p_final_total - v_wallet_used);
    ELSE
        v_wallet_used  := 0;
        v_debt_created := 0;
    END IF;

    -- Insert transaction header
    INSERT INTO public.transactions
        (business_id, total, discount, tax, final_total, amount_paid,
         wallet_applied, payment_method, customer_id, customer_name,
         staff_id, staff_name, status, timestamp, note, is_delivery,
         delivery_fee, rider_name, reference_id)
    VALUES (
        p_business_id, p_total, p_discount, p_tax, p_final_total,
        p_amount_paid, v_wallet_used, p_payment_method, p_customer_id,
        p_customer_name, p_staff_id, p_staff_name, 'Synced',
        COALESCE(p_timestamp, NOW()), p_note, COALESCE(p_is_delivery, FALSE),
        COALESCE(p_delivery_fee, 0), p_rider_name, p_reference_id
    )
    RETURNING id INTO v_tx_id;

    -- Insert transaction items
    IF p_items IS NOT NULL AND jsonb_array_length(p_items) > 0 THEN
        FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
        LOOP
            v_line_total := ROUND(
                (COALESCE((v_item->>'unit_price')::NUMERIC, 0) *
                 (1 - COALESCE((v_item->>'discount_percentage')::NUMERIC, 0) / 100)) *
                COALESCE((v_item->>'quantity')::NUMERIC, 1),
                2
            );

            INSERT INTO public.transaction_items
                (transaction_id, product_id, product_name, unit_price,
                 quantity, discount_percentage, line_total)
            VALUES (
                v_tx_id,
                (v_item->>'product_id')::UUID,
                COALESCE(v_item->>'product_name', 'Unknown Product'),
                COALESCE((v_item->>'unit_price')::NUMERIC, 0),
                COALESCE((v_item->>'quantity')::NUMERIC, 1),
                COALESCE((v_item->>'discount_percentage')::NUMERIC, 0),
                v_line_total
            );
        END LOOP;
    END IF;

    -- Apply wallet deduction
    IF v_wallet_used > 0 THEN
        v_wallet_after := GREATEST(0, v_wallet_before - v_wallet_used);

        UPDATE public.customers
        SET wallet_balance = v_wallet_after
        WHERE id = p_customer_id;

        INSERT INTO public.wallet_transactions
            (business_id, customer_id, amount, balance_before, balance_after,
             reason, transaction_id, recorded_by)
        VALUES (
            p_business_id, p_customer_id, -v_wallet_used,
            v_wallet_before, v_wallet_after,
            'Applied to checkout sale', v_tx_id, p_staff_name
        );

        INSERT INTO public.customer_ledger
            (business_id, customer_id, type, amount, wallet_balance, debt_balance,
             recorded_by, note, transaction_id, reference_id)
        VALUES (
            p_business_id, p_customer_id, 'wallet_usage', v_wallet_used,
            v_wallet_after, v_debt_before, p_staff_name,
            'Paid for order ' || v_tx_id::TEXT || ' using wallet credit',
            v_tx_id, 'tx-' || v_tx_id::TEXT || '-wallet-usage'
        )
        ON CONFLICT (business_id, reference_id) WHERE reference_id IS NOT NULL DO NOTHING;
    END IF;

    -- Create debt record if applicable
    IF v_debt_created > 0 THEN
        INSERT INTO public.credit_payments
            (business_id, transaction_id, customer_id, customer_name,
             amount_owed, amount_paid, status, recorded_by)
        VALUES (
            p_business_id, v_tx_id, p_customer_id, p_customer_name,
            v_debt_created, 0, 'Open', p_staff_name
        );

        v_debt_after := v_debt_before + v_debt_created;

        UPDATE public.customers
        SET debt_balance = v_debt_after
        WHERE id = p_customer_id;

        INSERT INTO public.customer_ledger
            (business_id, customer_id, type, amount, wallet_balance, debt_balance,
             recorded_by, note, transaction_id, reference_id)
        VALUES (
            p_business_id, p_customer_id, 'debt_creation', v_debt_created,
            COALESCE(v_wallet_after, v_wallet_before), v_debt_after, p_staff_name,
            'Outstanding balance for order ' || v_tx_id::TEXT || ' charged to debt',
            v_tx_id, 'tx-' || v_tx_id::TEXT || '-debt-creation'
        )
        ON CONFLICT (business_id, reference_id) WHERE reference_id IS NOT NULL DO NOTHING;
    END IF;

    RETURN v_tx_id;
END;
$$;

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
