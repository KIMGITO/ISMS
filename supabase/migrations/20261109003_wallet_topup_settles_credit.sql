-- Fix: money that clears debt through a wallet top-up reduced the customer's debt but left
-- their credit records open (so invoices still listed that debt) and earned no points.
--
-- process_wallet_topup() now settles the oldest credit records with the part that goes to debt,
-- and that part earns 1 point per KSh 1, like any other money paid towards a debt.
-- Patched from the live definition so the permission checks added by later migrations stay.
DO $migration$
DECLARE
    v_fn  RECORD;
    v_def TEXT;
BEGIN
    FOR v_fn IN
        SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.proname = 'process_wallet_topup'
    LOOP
        v_def := pg_get_functiondef(v_fn.oid);
        IF v_def !~ 'settles the oldest credit records' THEN
            EXECUTE replace(
                v_def,
                '-- Ledger entry for debt payment (if any)',
                $patch$-- Debt paid by the top-up settles the oldest credit records (settles the oldest credit records)
    IF v_debt_paid > 0 THEN
        DECLARE
            v_left    NUMERIC(14,2) := v_debt_paid;
            v_applied NUMERIC(14,2);
            v_rec     RECORD;
        BEGIN
            FOR v_rec IN
                SELECT id, balance FROM public.credit_payments
                WHERE customer_id = p_customer_id AND business_id = p_business_id AND status IN ('Open', 'Partial')
                ORDER BY created_at ASC, id ASC
                FOR UPDATE
            LOOP
                EXIT WHEN v_left <= 0;
                v_applied := LEAST(v_left, v_rec.balance);
                v_left := v_left - v_applied;
                UPDATE public.credit_payments
                SET amount_paid = amount_paid + v_applied,
                    status = CASE WHEN amount_paid + v_applied >= amount_owed THEN 'Settled'::public.credit_status ELSE 'Partial'::public.credit_status END,
                    settled_at = CASE WHEN amount_paid + v_applied >= amount_owed THEN NOW() ELSE NULL END,
                    updated_at = NOW()
                WHERE id = v_rec.id;
            END LOOP;
        END;
        UPDATE public.customers SET loyalty_points = COALESCE(loyalty_points, 0) + FLOOR(v_debt_paid)::INTEGER WHERE id = p_customer_id;
        IF to_regclass('public.loyalty_points_earned') IS NOT NULL AND FLOOR(v_debt_paid) > 0 THEN
            INSERT INTO public.loyalty_points_earned (business_id, customer_id, points, source, amount)
            VALUES (p_business_id, p_customer_id, FLOOR(v_debt_paid)::INTEGER, 'debt_payment', v_debt_paid);
        END IF;
    END IF;

    -- Ledger entry for debt payment (if any)$patch$
            );
        END IF;
    END LOOP;
END;
$migration$;

-- One-time reconciliation. A customer's debt balance is the authority: where their open credit
-- records add up to more than they owe (left over from top-ups and the doubled records fixed in
-- 20261109002), the oldest records are settled for the difference.
DO $migration$
DECLARE
    v_c      RECORD;
    v_excess NUMERIC(14,2);
    v_rec    RECORD;
    v_take   NUMERIC(14,2);
BEGIN
    FOR v_c IN
        SELECT c.id, c.business_id, COALESCE(c.debt_balance, 0) AS debt,
               (SELECT COALESCE(SUM(cp.balance), 0) FROM public.credit_payments cp
                 WHERE cp.customer_id = c.id AND cp.status IN ('Open', 'Partial')) AS open_total
        FROM public.customers c
    LOOP
        v_excess := v_c.open_total - v_c.debt;
        IF v_excess <= 0.009 THEN
            CONTINUE;
        END IF;
        FOR v_rec IN
            SELECT id, balance FROM public.credit_payments
            WHERE customer_id = v_c.id AND status IN ('Open', 'Partial')
            ORDER BY created_at ASC, id ASC
        LOOP
            EXIT WHEN v_excess <= 0;
            v_take := LEAST(v_excess, v_rec.balance);
            v_excess := v_excess - v_take;
            UPDATE public.credit_payments
            SET amount_paid = amount_paid + v_take,
                status = CASE WHEN amount_paid + v_take >= amount_owed THEN 'Settled'::public.credit_status ELSE 'Partial'::public.credit_status END,
                settled_at = CASE WHEN amount_paid + v_take >= amount_owed THEN NOW() ELSE NULL END,
                updated_at = NOW()
            WHERE id = v_rec.id;
        END LOOP;
    END LOOP;
END;
$migration$;
