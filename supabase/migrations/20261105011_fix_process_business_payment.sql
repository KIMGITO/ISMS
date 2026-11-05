-- =============================================================================
-- 20261105011_fix_process_business_payment.sql
-- Why: process_business_payment failed on every path. Walk-in calls hit NOT NULL
-- errors on money_assets.balance and payment_asset_ledger, and calls omitting
-- p_customer_name were ambiguous between two overloads. This leaves one function.
-- It also limits the customer lookup to p_business_id, so a member can't change
-- another business's customer balances, and credits the wallet with any overpayment
-- when the customer has no existing balance.
-- =============================================================================

BEGIN;

DROP FUNCTION IF EXISTS public.process_business_payment(
    UUID, TEXT, NUMERIC, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ, UUID, TEXT, TEXT, TEXT
);

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
    v_asset_id        UUID;
BEGIN
    PERFORM public.assert_business_member(p_business_id);

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
        WHERE id = p_customer_id AND business_id = p_business_id;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'Customer not found: %', p_customer_id;
        END IF;
    END IF;

    -- Determine debt/wallet split for successful payments
    IF p_status = 'Success' AND p_customer_id IS NOT NULL THEN
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
        INSERT INTO public.money_assets (business_id, method, balance, last_payment_at)
        VALUES (p_business_id, p_method, p_amount, p_date)
        ON CONFLICT (business_id, method)
        DO UPDATE SET
            balance = money_assets.balance + p_amount,
            last_payment_at = p_date,
            updated_at = NOW()
        RETURNING id, balance INTO v_asset_id, v_asset_after;

        v_asset_before := v_asset_after - p_amount;

        -- Asset ledger entry
        INSERT INTO public.payment_asset_ledger (
            business_id, asset_id, payment_id, type, method, amount,
            balance_before, balance_after, description, recorded_by
        )
        VALUES (
            p_business_id, v_asset_id, v_payment_id, 'Credit', p_method, p_amount,
            v_asset_before, v_asset_after,
            COALESCE(p_description, 'Payment: ' || p_reference_code), p_recorded_by
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
                    v_wallet_after, v_debt_after, COALESCE(p_recorded_by, 'System'),
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
                    p_method, COALESCE(p_recorded_by, 'System'),
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
                    v_wallet_after, v_debt_after, COALESCE(p_recorded_by, 'System'),
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

REVOKE ALL ON FUNCTION public.process_business_payment(
    UUID, TEXT, NUMERIC, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ, UUID, TEXT, TEXT, TEXT, TEXT
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.process_business_payment(
    UUID, TEXT, NUMERIC, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ, UUID, TEXT, TEXT, TEXT, TEXT
) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
