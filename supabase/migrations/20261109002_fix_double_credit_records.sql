-- Fix: a credit sale was recorded twice on the credit list.
--
-- process_customer_transaction() inserted a credit_payments row, and the sale trigger
-- (fn_process_completed_transaction) inserted another for the same sale. The customer's debt
-- balance was right, but the credit list held every credit sale twice. Paying the debt settled
-- one copy and left the other open, so invoices listed each sale twice and treated the
-- difference as already paid.

-- 1. The function no longer inserts its own credit record (the trigger creates the one).
--    Patched from the live definition so the permission checks added by later migrations stay.
DO $migration$
DECLARE
    v_fn  RECORD;
    v_def TEXT;
BEGIN
    FOR v_fn IN
        SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.proname = 'process_customer_transaction'
    LOOP
        v_def := pg_get_functiondef(v_fn.oid);
        IF v_def ~ 'INSERT INTO public\.credit_payments' THEN
            EXECUTE regexp_replace(
                v_def,
                'INSERT INTO public\.credit_payments\s*\([^;]*?\)\s*VALUES\s*\([^;]*?\);',
                '-- credit record: created by the sale trigger, once per sale',
                ''
            );
        END IF;
    END LOOP;
END;
$migration$;

-- 2. Repair sales already doubled: keep the earliest record, carry over what was paid across
--    the copies (never more than the sale's debt), drop the rest.
WITH dup AS (
    SELECT transaction_id,
           (array_agg(id ORDER BY created_at, id))[1] AS keep_id,
           max(amount_owed) AS owed,
           sum(amount_paid) AS paid
    FROM public.credit_payments
    WHERE transaction_id IS NOT NULL
    GROUP BY transaction_id
    HAVING count(*) > 1
), fixed AS (
    UPDATE public.credit_payments c
    SET amount_owed = d.owed,
        amount_paid = LEAST(d.owed, d.paid),
        status = CASE WHEN LEAST(d.owed, d.paid) >= d.owed THEN 'Settled'::public.credit_status
                      WHEN LEAST(d.owed, d.paid) > 0 THEN 'Partial'::public.credit_status
                      ELSE 'Open'::public.credit_status END,
        settled_at = CASE WHEN LEAST(d.owed, d.paid) >= d.owed THEN COALESCE(c.settled_at, NOW()) ELSE NULL END,
        updated_at = NOW()
    FROM dup d
    WHERE c.id = d.keep_id
    RETURNING d.transaction_id, d.keep_id
)
DELETE FROM public.credit_payments c
USING fixed f
WHERE c.transaction_id = f.transaction_id AND c.id <> f.keep_id;

-- 3. One credit record per sale, enforced.
CREATE UNIQUE INDEX IF NOT EXISTS uq_credit_payments_transaction
    ON public.credit_payments (transaction_id) WHERE transaction_id IS NOT NULL;
