-- =============================================================================
-- 20260808_002_fix_transaction_trigger.sql
-- integrated Shop Management System
-- Update fn_process_completed_transaction to:
--   1. Handle wallet_applied correctly (deduct wallet before adding debt)
--   2. Create customer_ledger entries atomically (single authoritative path)
--   3. Use reference_id for idempotency
-- =============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.fn_process_completed_transaction()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    points_earned INTEGER;
    new_points    INTEGER;
    v_debt_amt    NUMERIC(14,2);
    v_wallet_amt  NUMERIC(14,2);
    v_wallet_before NUMERIC(14,2);
    v_wallet_after  NUMERIC(14,2);
    v_debt_before   NUMERIC(14,2);
    v_debt_after    NUMERIC(14,2);
BEGIN
    -- 1. Loyalty points: earn 1 point per KES 100 spent (excl. delivery fee)
    IF NEW.customer_id IS NOT NULL THEN
        points_earned := GREATEST(0, FLOOR((NEW.final_total - COALESCE(NEW.delivery_fee, 0)) / 100));

        SELECT loyalty_points INTO new_points
        FROM public.customers
        WHERE id = NEW.customer_id;

        new_points := COALESCE(new_points, 0) + points_earned;

        UPDATE public.customers
        SET
            loyalty_points  = new_points,
            purchases_count = purchases_count + 1,
            tier            = public.calculate_customer_tier(new_points)
        WHERE id = NEW.customer_id;
    END IF;

    -- 2. Shift sales aggregation (only when staff is punched in)
    IF NEW.staff_id IS NOT NULL THEN
        UPDATE public.shifts
        SET
            sales_count = sales_count + 1,
            sales_total = sales_total + NEW.final_total
        WHERE employee_id = NEW.staff_id
          AND status = 'Active'
          AND deleted_at IS NULL;
    END IF;

    -- 3. Debt / wallet settlement for credit transactions
    -- Only credit sales (Credit_Debt / Credit) may create debt. Fully-paid
    -- methods (Cash, M-Pesa, Card, Bank, Mobile_Wallet) must never create a
    -- credit record, even if amount_paid is missing/zero.
    IF NEW.customer_id IS NOT NULL AND NEW.payment_method IN ('Credit_Debt', 'Credit') THEN
        -- Fetch current customer balances BEFORE any modification
        SELECT wallet_balance, debt_balance
        INTO v_wallet_before, v_debt_before
        FROM public.customers
        WHERE id = NEW.customer_id;

        v_wallet_before := COALESCE(v_wallet_before, 0);
        v_debt_before   := COALESCE(v_debt_before, 0);

        -- 3a. Deduct wallet amount if used at checkout
        IF COALESCE(NEW.wallet_applied, 0) > 0 THEN
            v_wallet_after := GREATEST(0, v_wallet_before - NEW.wallet_applied);

            UPDATE public.customers
            SET wallet_balance = v_wallet_after
            WHERE id = NEW.customer_id;

            INSERT INTO public.wallet_transactions
                (business_id, customer_id, amount, balance_before, balance_after,
                 reason, transaction_id, recorded_by)
            VALUES (
                NEW.business_id,
                NEW.customer_id,
                -NEW.wallet_applied,
                v_wallet_before,
                v_wallet_after,
                'Applied to checkout sale',
                NEW.id,
                NEW.staff_name
            );

            -- Create customer_ledger entry for wallet usage
            INSERT INTO public.customer_ledger
                (business_id, customer_id, type, amount, wallet_balance, debt_balance,
                 recorded_by, note, transaction_id, reference_id)
            VALUES (
                NEW.business_id,
                NEW.customer_id,
                'wallet_usage',
                NEW.wallet_applied,
                v_wallet_after,
                v_debt_before,
                NEW.staff_name,
                'Paid for order ' || NEW.id::TEXT || ' using wallet credit',
                NEW.id,
                'tx-' || NEW.id::TEXT || '-wallet-usage'
            )
            ON CONFLICT (business_id, reference_id) WHERE reference_id IS NOT NULL DO NOTHING;
        END IF;

        -- 3b. Create debt record if customer underpaid
        v_debt_amt := NEW.final_total - COALESCE(NEW.amount_paid, 0) - COALESCE(NEW.wallet_applied, 0);

        IF v_debt_amt > 0 THEN
            INSERT INTO public.credit_payments
                (business_id, transaction_id, customer_id, customer_name,
                 amount_owed, amount_paid, status, recorded_by)
            VALUES (
                NEW.business_id,
                NEW.id,
                NEW.customer_id,
                COALESCE(NEW.customer_name, 'Unknown'),
                v_debt_amt,
                0,
                'Open',
                NEW.staff_name
            );

            v_debt_after := v_debt_before + v_debt_amt;

            UPDATE public.customers
            SET debt_balance = v_debt_after
            WHERE id = NEW.customer_id;

            -- Create customer_ledger entry for debt creation
            INSERT INTO public.customer_ledger
                (business_id, customer_id, type, amount, wallet_balance, debt_balance,
                 recorded_by, note, transaction_id, reference_id)
            VALUES (
                NEW.business_id,
                NEW.customer_id,
                'debt_creation',
                v_debt_amt,
                COALESCE(v_wallet_after, v_wallet_before),
                v_debt_after,
                NEW.staff_name,
                'Outstanding balance for order ' || NEW.id::TEXT || ' charged to debt',
                NEW.id,
                'tx-' || NEW.id::TEXT || '-debt-creation'
            )
            ON CONFLICT (business_id, reference_id) WHERE reference_id IS NOT NULL DO NOTHING;
        END IF;

        -- 3c. Credit wallet with overpayment change
        IF v_debt_amt < 0 THEN
            v_wallet_amt := -v_debt_amt;
            v_wallet_after := v_wallet_before + v_wallet_amt;

            UPDATE public.customers
            SET wallet_balance = v_wallet_after
            WHERE id = NEW.customer_id;

            INSERT INTO public.wallet_transactions
                (business_id, customer_id, amount, balance_before, balance_after,
                 reason, transaction_id, recorded_by)
            VALUES (
                NEW.business_id,
                NEW.customer_id,
                v_wallet_amt,
                v_wallet_before,
                v_wallet_after,
                'Overpayment at checkout',
                NEW.id,
                NEW.staff_name
            );

            -- Create customer_ledger entry for wallet top-up from overpayment
            INSERT INTO public.customer_ledger
                (business_id, customer_id, type, amount, wallet_balance, debt_balance,
                 recorded_by, note, transaction_id, reference_id)
            VALUES (
                NEW.business_id,
                NEW.customer_id,
                'wallet_topup',
                v_wallet_amt,
                v_wallet_after,
                v_debt_before,
                NEW.staff_name,
                'Overpayment at checkout credited to wallet',
                NEW.id,
                'tx-' || NEW.id::TEXT || '-wallet-overpay'
            )
            ON CONFLICT (business_id, reference_id) WHERE reference_id IS NOT NULL DO NOTHING;
        END IF;
    END IF;

    -- 4. Security audit log (NULL-safe employee_id)
    INSERT INTO public.audit_logs
        (business_id, employee_id, action, table_name, record_id, details)
    VALUES (
        NEW.business_id,
        CASE
            WHEN EXISTS (SELECT 1 FROM public.employees WHERE id = NEW.staff_id)
            THEN NEW.staff_id
            ELSE NULL
        END,
        'CREATE_TRANSACTION',
        'transactions',
        NEW.id::TEXT,
        jsonb_build_object(
            'final_total',     NEW.final_total,
            'amount_paid',     NEW.amount_paid,
            'wallet_applied',  COALESCE(NEW.wallet_applied, 0),
            'payment_method',  NEW.payment_method,
            'is_delivery',     NEW.is_delivery,
            'customer_id',     NEW.customer_id
        )
    );

    RETURN NEW;
END;
$$;

-- Force API schema compilation update
NOTIFY pgrst, 'reload schema';

COMMIT;