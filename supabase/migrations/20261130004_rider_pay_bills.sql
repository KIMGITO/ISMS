-- Riders to pay: what the shop owes riders for deliveries, shown with the bills, counted as
-- spending ON THE DAY IT IS OWED, and paid later from petty cash or an account.
--
-- Rules:
-- - The shop owes a rider for a delivery it pays for: delivery_mode 'charged' or 'free'
--   (never 'rider_collects', where the customer pays the rider), website orders, and
--   delivery trips (one pay for the whole trip). A failed, cancelled or deleted delivery
--   is not owed.
-- - The rider does not need an account. A till sale owes the rider named at the sale;
--   riders with an account are matched by rider_id, riders without one by the name
--   (case and spaces ignored).
-- - Owed (books, source 'rider_pay', one entry per delivery or trip, dated the delivery's
--   day): Dr Rider pay (expense) / Cr We owe riders (2010, per rider).
--   Every spending figure (Finances, Home, dashboard snapshots, the Expenses list) counts
--   it on that day too, through fn_spending().
-- - Paid: ONE expenses row (category 'Rider pay', rider_payment = true), from petty cash
--   (Cash, counted at the end of the shift) or from Cash / M-Pesa / Airtel Money / Card /
--   Bank. It moves the Payments screen balance and shows in the petty cashbook like any
--   other spending, but it is NOT spending again: the books post it Dr We owe riders /
--   Cr money, and fn_spending() leaves it out. rider_pay_links says which deliveries it paid.
-- - Removing that expense makes the deliveries owed again (money and books undo it). Its
--   amount can't be edited: remove it and pay again.
-- - Money paid for a delivery that later stops being owed (deleted, failed, put into a
--   trip, pay lowered) is not lost: it counts as paid ahead and covers the rider's next
--   deliveries, oldest first. In the books it is a debit balance on that rider.

-- ---------------------------------------------------------------- links
ALTER TABLE public.expenses ADD COLUMN IF NOT EXISTS rider_payment boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN public.expenses.rider_payment IS
    'Money paid to a rider for deliveries already counted as spending (rider_pay_links). Moves money, not profit.';

CREATE TABLE IF NOT EXISTS public.rider_pay_links (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    expense_id uuid NOT NULL REFERENCES public.expenses(id) ON DELETE CASCADE,
    kind text NOT NULL CHECK (kind IN ('sale', 'online', 'trip')),
    item_id uuid NOT NULL,
    rider_key text NOT NULL,
    rider_name text NOT NULL,
    amount numeric(14,2) NOT NULL CHECK (amount > 0),
    created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.rider_pay_links OWNER TO postgres;
CREATE INDEX IF NOT EXISTS idx_rider_pay_links_item ON public.rider_pay_links (business_id, kind, item_id);
CREATE INDEX IF NOT EXISTS idx_rider_pay_links_rider ON public.rider_pay_links (business_id, rider_key);
CREATE INDEX IF NOT EXISTS idx_rider_pay_links_expense ON public.rider_pay_links (expense_id);
ALTER TABLE public.rider_pay_links ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.rider_pay_links FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.rider_pay_links TO service_role;

COMMENT ON TABLE public.rider_pay_links IS
    'Which deliveries a rider payment (an expenses row, rider_payment = true) paid for.';

-- ---------------------------------------------------------------- rider identity
CREATE OR REPLACE FUNCTION public.fn_rider_key(p_rider_id uuid, p_name text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
    SELECT COALESCE(p_rider_id::text,
                    'name:' || lower(regexp_replace(btrim(COALESCE(p_name, '')), '\s+', ' ', 'g')));
$$;
ALTER FUNCTION public.fn_rider_key(uuid, text) OWNER TO postgres;

-- ---------------------------------------------------------------- what is owed
-- One row per delivery (or trip) the shop owes a rider for. p_id narrows it to one sale,
-- website order or trip (used by the books).
CREATE OR REPLACE FUNCTION public.fn_rider_owed(p_business_id uuid, p_id uuid DEFAULT NULL)
RETURNS TABLE(kind text, item_id uuid, rider_id uuid, rider_name text, rider_key text, reference text,
              customer_name text, place text, item_date timestamptz, status text, amount numeric)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
AS $$
    WITH members AS (
        SELECT t.trip_id, t.rider_id, NULLIF(regexp_replace(btrim(COALESCE(t.rider_name, '')), '\s+', ' ', 'g'), '') AS rname,
               t.timestamp AS d, COALESCE(NULLIF(t.customer_name, ''), 'Walk-in') AS cname,
               COALESCE(t.delivery_status, 'assigned') AS st
        FROM public.transactions t
        WHERE t.business_id = p_business_id AND t.trip_id IS NOT NULL AND t.is_delivery
          AND (p_id IS NULL OR t.trip_id = p_id)
          AND t.deleted_at IS NULL AND COALESCE(t.delivery_status, 'assigned') <> 'failed'
        UNION ALL
        SELECT o.trip_id, o.rider_id, NULL, COALESCE(o.rider_assigned_at, o.created_at), o.customer_name,
               CASE o.status WHEN 'completed' THEN 'delivered' WHEN 'out_for_delivery' THEN 'out_for_delivery' ELSE 'assigned' END
        FROM public.online_orders o
        WHERE o.business_id = p_business_id AND o.trip_id IS NOT NULL AND o.status <> 'cancelled'
          AND (p_id IS NULL OR o.trip_id = p_id)
    ), trips AS (
        SELECT dt.id, dt.rider_pay, dt.label,
               (array_agg(m.rider_id ORDER BY m.d) FILTER (WHERE m.rider_id IS NOT NULL))[1] AS rider_id,
               (array_agg(m.rname ORDER BY m.d) FILTER (WHERE m.rname IS NOT NULL))[1] AS rname,
               count(*) AS n, min(m.d) AS d, string_agg(m.cname, ', ' ORDER BY m.d) AS cnames,
               CASE WHEN bool_and(m.st = 'delivered') THEN 'delivered'
                    WHEN bool_or(m.st = 'out_for_delivery') THEN 'out_for_delivery' ELSE 'assigned' END AS st
        FROM public.delivery_trips dt
        JOIN members m ON m.trip_id = dt.id
        WHERE dt.business_id = p_business_id AND dt.rider_pay > 0
        GROUP BY dt.id
    ), items AS (
        SELECT 'sale'::text AS kind, t.id AS item_id, t.rider_id,
               COALESCE(NULLIF(regexp_replace(btrim(COALESCE(t.rider_name, '')), '\s+', ' ', 'g'), ''), e.name) AS rider_name,
               public.fn_receipt_number(t.id) AS reference,
               COALESCE(NULLIF(t.customer_name, ''), 'Walk-in') AS customer_name,
               NULLIF(trim(substring(t.note FROM '^Deliver to: ([^.]*)')), '') AS place,
               t.timestamp AS item_date, COALESCE(t.delivery_status, 'assigned') AS status,
               t.rider_pay AS amount
        FROM public.transactions t
        LEFT JOIN public.employees e ON e.id = t.rider_id
        WHERE t.business_id = p_business_id AND t.is_delivery AND t.deleted_at IS NULL AND t.trip_id IS NULL
          AND (p_id IS NULL OR t.id = p_id)
          AND t.delivery_mode <> 'rider_collects' AND COALESCE(t.delivery_status, 'assigned') <> 'failed'
          AND t.rider_pay > 0
          AND (t.rider_id IS NOT NULL OR NULLIF(btrim(COALESCE(t.rider_name, '')), '') IS NOT NULL)
        UNION ALL
        SELECT 'online', o.id, o.rider_id, e.name, '#' || o.order_number, o.customer_name, o.delivery_zone,
               COALESCE(o.rider_assigned_at, o.created_at),
               CASE o.status WHEN 'completed' THEN 'delivered' WHEN 'out_for_delivery' THEN 'out_for_delivery' ELSE 'assigned' END,
               o.delivery_fee
        FROM public.online_orders o
        JOIN public.employees e ON e.id = o.rider_id
        WHERE o.business_id = p_business_id AND o.fulfilment = 'delivery' AND o.trip_id IS NULL
          AND (p_id IS NULL OR o.id = p_id)
          AND o.status <> 'cancelled' AND o.delivery_fee > 0
        UNION ALL
        SELECT 'trip', tr.id, tr.rider_id, COALESCE(tr.rname, e.name),
               'Trip of ' || tr.n || ' deliveries', tr.cnames, tr.label, tr.d, tr.st, tr.rider_pay
        FROM trips tr
        LEFT JOIN public.employees e ON e.id = tr.rider_id
        WHERE tr.rider_id IS NOT NULL OR tr.rname IS NOT NULL
    )
    SELECT i.kind, i.item_id, i.rider_id, i.rider_name, public.fn_rider_key(i.rider_id, i.rider_name),
           i.reference, i.customer_name, i.place, i.item_date, i.status, i.amount
    FROM items i;
$$;
ALTER FUNCTION public.fn_rider_owed(uuid, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.fn_rider_owed(uuid, uuid) FROM PUBLIC, anon, authenticated;

-- What is owed with what is paid on it. paid = paid on this item directly to this rider,
-- plus the rider's paid-ahead money spread over their deliveries oldest first.
CREATE OR REPLACE FUNCTION public.fn_rider_pay_items(p_business_id uuid)
RETURNS TABLE(kind text, item_id uuid, rider_key text, rider_id uuid, rider_name text, reference text,
              customer_name text, place text, item_date timestamptz, status text,
              amount numeric, paid numeric, balance numeric)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
AS $$
    WITH keyed AS (
        SELECT o.*, o.rider_key AS rkey FROM public.fn_rider_owed(p_business_id) o
    ), links AS (
        -- Payments still standing (their expense not removed).
        SELECT l.kind, l.item_id, l.rider_key, SUM(l.amount) AS amt
        FROM public.rider_pay_links l
        JOIN public.expenses x ON x.id = l.expense_id AND x.deleted_at IS NULL
        WHERE l.business_id = p_business_id
        GROUP BY l.kind, l.item_id, l.rider_key
    ), direct AS (
        SELECT k.*, LEAST(COALESCE(lk.amt, 0), k.amount) AS dpaid
        FROM keyed k
        -- Only what was paid to this same rider (a delivery moved to another rider after
        -- it was paid stays paid-ahead money of the first rider).
        LEFT JOIN links lk ON lk.kind = k.kind AND lk.item_id = k.item_id AND lk.rider_key = k.rkey
    ), ahead AS (
        SELECT r.rider_key, SUM(r.amt) - COALESCE((SELECT SUM(d.dpaid) FROM direct d WHERE d.rkey = r.rider_key), 0) AS credit
        FROM links r GROUP BY r.rider_key
    ), spread AS (
        SELECT d.*, COALESCE(a.credit, 0) AS credit,
               COALESCE(SUM(d.amount - d.dpaid) OVER (PARTITION BY d.rkey ORDER BY d.item_date, d.item_id
                        ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING), 0) AS before
        FROM direct d LEFT JOIN ahead a ON a.rider_key = d.rkey
    )
    SELECT s.kind, s.item_id, s.rkey, s.rider_id, s.rider_name, s.reference, s.customer_name, s.place,
           s.item_date, s.status, s.amount,
           s.dpaid + LEAST(s.amount - s.dpaid, GREATEST(s.credit - s.before, 0)),
           s.amount - s.dpaid - LEAST(s.amount - s.dpaid, GREATEST(s.credit - s.before, 0))
    FROM spread s;
$$;
ALTER FUNCTION public.fn_rider_pay_items(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.fn_rider_pay_items(uuid) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------- spending
-- The business's spending as profit sees it: every expense except rider payments, plus
-- rider pay owed, dated the day it was owed. Same columns as public.expenses, so reports
-- read it in place of the table. Rider pay rows have id = the sale / order / trip id,
-- category 'Rider pay', source 'rider_pay', no payment_method (no money moved yet).
CREATE OR REPLACE FUNCTION public.fn_spending(p_business_id uuid)
RETURNS SETOF public.expenses
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
AS $$
    SELECT e.* FROM public.expenses e
    WHERE e.business_id = p_business_id AND NOT e.rider_payment
    UNION ALL
    SELECT (jsonb_populate_record(NULL::public.expenses, jsonb_build_object(
        'id', o.item_id, 'business_id', p_business_id, 'category', 'Rider pay', 'amount', o.amount,
        'description', o.rider_name || ' · ' || o.reference || COALESCE(' · ' || o.customer_name, ''),
        'date', o.item_date, 'staff_name', o.rider_name, 'source', 'rider_pay',
        'last_modified_by', 'System', 'created_at', o.item_date, 'updated_at', o.item_date,
        'version', 1, 'sync_status', 'synced', 'rider_payment', false))).*
    FROM public.fn_rider_owed(p_business_id) o;
$$;
ALTER FUNCTION public.fn_spending(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.fn_spending(uuid) FROM PUBLIC, anon, authenticated;

-- The app's copy for Home and the Expenses list (they read expenses directly).
CREATE OR REPLACE FUNCTION public.list_rider_pay_owed(p_business_id uuid, p_start timestamptz DEFAULT NULL)
RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
AS $$
BEGIN
    PERFORM public.assert_business_member(p_business_id);
    RETURN COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                   'id', o.item_id, 'kind', o.kind, 'date', o.item_date, 'amount', o.amount,
                   'rider', o.rider_name, 'reference', o.reference, 'customer', o.customer_name) ORDER BY o.item_date DESC)
        FROM public.fn_rider_owed(p_business_id) o
        WHERE p_start IS NULL OR o.item_date >= p_start), '[]'::jsonb);
END;
$$;
ALTER FUNCTION public.list_rider_pay_owed(uuid, timestamptz) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.list_rider_pay_owed(uuid, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_rider_pay_owed(uuid, timestamptz) TO authenticated;

-- ---------------------------------------------------------------- staff: riders to pay
-- Every delivery owed since p_start (paid or not), plus anything still unpaid from before,
-- so the screen can filter by paid / not paid and by day, week or month.
DROP FUNCTION IF EXISTS public.list_rider_pay(uuid);
CREATE OR REPLACE FUNCTION public.list_rider_pay(p_business_id uuid, p_start timestamptz DEFAULT NULL)
RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
AS $$
DECLARE
    v_riders   jsonb;
    v_items    jsonb;
    v_payments jsonb;
BEGIN
    PERFORM public.assert_business_member(p_business_id);
    PERFORM public.assert_permission(p_business_id, 'supplier_bills.manage', 'accounting.manage', 'purchases.approve',
                                     'expenses.create', 'expenses.view', 'pettycash.record', 'finance.view');

    CREATE TEMP TABLE IF NOT EXISTS _rider_list ON COMMIT DROP AS
        SELECT * FROM public.fn_rider_pay_items(p_business_id) WITH NO DATA;
    TRUNCATE _rider_list;
    INSERT INTO _rider_list SELECT * FROM public.fn_rider_pay_items(p_business_id);

    WITH paid_total AS (
        SELECT l.rider_key, SUM(l.amount) AS amt
        FROM public.rider_pay_links l
        JOIN public.expenses x ON x.id = l.expense_id AND x.deleted_at IS NULL
        WHERE l.business_id = p_business_id
        GROUP BY l.rider_key
    ), riders AS (
        SELECT it.rider_key,
               (array_agg(it.rider_id) FILTER (WHERE it.rider_id IS NOT NULL))[1] AS rider_id,
               (array_agg(it.rider_name ORDER BY it.item_date DESC))[1] AS name,
               SUM(it.amount) AS earned, SUM(it.balance) AS owed
        FROM _rider_list it GROUP BY it.rider_key
    )
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
               'key', r.rider_key, 'riderId', r.rider_id, 'name', r.name, 'owed', r.owed,
               -- Paid for deliveries no longer owed, not yet used up.
               'ahead', GREATEST(COALESCE(p.amt, 0) - (r.earned - r.owed), 0)) ORDER BY r.owed DESC, r.name), '[]'::jsonb)
    INTO v_riders
    FROM riders r LEFT JOIN paid_total p ON p.rider_key = r.rider_key;

    SELECT COALESCE(jsonb_agg(jsonb_build_object(
               'kind', it.kind, 'id', it.item_id, 'riderKey', it.rider_key, 'rider', it.rider_name,
               'reference', it.reference, 'customer', it.customer_name, 'place', it.place,
               'date', it.item_date, 'status', it.status,
               'amount', it.amount, 'paid', it.paid, 'balance', it.balance) ORDER BY it.item_date DESC), '[]'::jsonb)
    INTO v_items
    FROM _rider_list it
    WHERE it.balance > 0 OR p_start IS NULL OR it.item_date >= p_start;

    SELECT COALESCE(jsonb_agg(x ORDER BY x->>'date' DESC), '[]'::jsonb) INTO v_payments
    FROM (
        SELECT jsonb_build_object(
                   'expenseId', e.id, 'date', e.date, 'amount', e.amount, 'method', e.payment_method,
                   'from', e.source, 'by', e.staff_name, 'note', e.description,
                   'rider', MIN(l.rider_name), 'deliveries', COUNT(l.id),
                   'removed', e.deleted_at IS NOT NULL) AS x
        FROM public.expenses e
        JOIN public.rider_pay_links l ON l.expense_id = e.id
        WHERE e.business_id = p_business_id AND (p_start IS NULL OR e.date >= p_start)
        GROUP BY e.id
    ) q;

    RETURN jsonb_build_object('riders', v_riders, 'items', v_items, 'payments', v_payments);
END;
$$;
ALTER FUNCTION public.list_rider_pay(uuid, timestamptz) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.list_rider_pay(uuid, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_rider_pay(uuid, timestamptz) TO authenticated;

-- ---------------------------------------------------------------- pay a rider
-- p_items: ["sale:<uuid>", "trip:<uuid>", …] to pay those, or NULL for everything owed.
-- p_from: 'petty_cash' (cash from the till) or 'account' (an expense from p_method).
CREATE OR REPLACE FUNCTION public.pay_rider(
    p_business_id uuid, p_rider_key text, p_items jsonb, p_from text, p_method text,
    p_note text DEFAULT NULL, p_reference_id text DEFAULT NULL)
RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
AS $$
DECLARE
    v_me     public.employees;
    v_exp    public.expenses;
    v_total  numeric;
    v_count  integer;
    v_name   text;
    v_method text;
    v_source text;
BEGIN
    PERFORM public.assert_business_member(p_business_id);
    IF p_from = 'petty_cash' THEN
        PERFORM public.assert_permission(p_business_id, 'pettycash.record', 'expenses.create');
        v_method := 'Cash';
        v_source := 'petty_cash';
    ELSIF p_from = 'account' THEN
        PERFORM public.assert_permission(p_business_id, 'expenses.create');
        v_method := p_method;
        v_source := 'expense';
        IF v_method IS NULL OR v_method NOT IN ('Cash', 'M-Pesa', 'Airtel Money', 'Card', 'Bank') THEN
            RAISE EXCEPTION 'Choose Cash, M-Pesa, Airtel Money, Card or Bank.';
        END IF;
    ELSE
        RAISE EXCEPTION 'Choose petty cash or an account to pay from.';
    END IF;

    IF p_reference_id IS NOT NULL THEN
        SELECT * INTO v_exp FROM public.expenses WHERE business_id = p_business_id AND reference_id = p_reference_id;
        IF FOUND THEN
            RETURN jsonb_build_object('expenseId', v_exp.id, 'amount', v_exp.amount);
        END IF;
    END IF;

    -- One payment at a time per rider, so the same delivery is never paid twice.
    PERFORM pg_advisory_xact_lock(hashtext(p_business_id::text || '|rider|' || p_rider_key));

    CREATE TEMP TABLE IF NOT EXISTS _rider_pay ON COMMIT DROP AS
        SELECT * FROM public.fn_rider_pay_items(p_business_id) WITH NO DATA;
    TRUNCATE _rider_pay;
    INSERT INTO _rider_pay
    SELECT i.* FROM public.fn_rider_pay_items(p_business_id) i
    WHERE i.rider_key = p_rider_key AND i.balance > 0
      AND (p_items IS NULL OR jsonb_typeof(p_items) <> 'array'
           OR (i.kind || ':' || i.item_id::text) IN (SELECT jsonb_array_elements_text(p_items)));

    SELECT COALESCE(SUM(balance), 0), COUNT(*), (array_agg(rider_name ORDER BY item_date DESC))[1]
    INTO v_total, v_count, v_name FROM _rider_pay;
    IF v_total <= 0 THEN
        RAISE EXCEPTION 'Nothing to pay this rider. Refresh the list.';
    END IF;
    IF v_source = 'petty_cash' AND v_total > 1000000 THEN
        RAISE EXCEPTION 'That amount is too large for petty cash. Pay it from an account.';
    END IF;

    v_me := public.fn_my_employee(p_business_id);

    INSERT INTO public.expenses (
        business_id, category, amount, description, date, staff_name, payment_method, source,
        employee_id, reference_id, last_modified_by, rider_payment
    ) VALUES (
        p_business_id, 'Rider pay', round(v_total, 2),
        v_name || ' · ' || v_count || CASE WHEN v_count = 1 THEN ' delivery' ELSE ' deliveries' END
            || COALESCE(' · ' || NULLIF(btrim(COALESCE(p_note, '')), ''), ''),
        NOW(), COALESCE(v_me.name, 'Staff'), v_method, v_source,
        v_me.id, p_reference_id, COALESCE(v_me.name, 'Staff'), true
    ) RETURNING * INTO v_exp;

    INSERT INTO public.rider_pay_links (business_id, expense_id, kind, item_id, rider_key, rider_name, amount)
    SELECT p_business_id, v_exp.id, r.kind, r.item_id, p_rider_key, v_name, round(r.balance, 2)
    FROM _rider_pay r;
    -- Post again now the links exist, so the books name the rider whatever the trigger timing.
    UPDATE public.expenses SET updated_at = NOW() WHERE id = v_exp.id;

    RETURN jsonb_build_object('expenseId', v_exp.id, 'amount', v_exp.amount, 'deliveries', v_count, 'rider', v_name);
END;
$$;
ALTER FUNCTION public.pay_rider(uuid, text, jsonb, text, text, text, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.pay_rider(uuid, text, jsonb, text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pay_rider(uuid, text, jsonb, text, text, text, text) TO authenticated;

-- ---------------------------------------------------------------- remove a payment
-- Takes the payment back: the money returns to its account, the books undo it, and the
-- deliveries are owed again. Petty cash payments can also be removed from the cashbook.
CREATE OR REPLACE FUNCTION public.remove_rider_payment(p_business_id uuid, p_expense_id uuid, p_reason text)
RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
AS $$
DECLARE
    v_me public.employees;
BEGIN
    PERFORM public.assert_business_member(p_business_id);
    PERFORM public.assert_permission(p_business_id, 'expenses.delete');
    IF NULLIF(btrim(COALESCE(p_reason, '')), '') IS NULL THEN
        RAISE EXCEPTION 'Say why this payment is removed.';
    END IF;
    v_me := public.fn_my_employee(p_business_id);
    UPDATE public.expenses
    SET deleted_at = NOW(), removed_by = COALESCE(v_me.name, 'Staff'), removed_reason = btrim(p_reason),
        last_modified_by = COALESCE(v_me.name, 'Staff')
    WHERE id = p_expense_id AND business_id = p_business_id AND rider_payment AND deleted_at IS NULL;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'This payment was already removed.';
    END IF;
END;
$$;
ALTER FUNCTION public.remove_rider_payment(uuid, uuid, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.remove_rider_payment(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.remove_rider_payment(uuid, uuid, text) TO authenticated;

-- ---------------------------------------------------------------- keep a payment whole
-- A rider payment's amount is the sum of its links. Changing it would make the books,
-- the cash and the riders' list disagree, so it is removed and paid again instead.
CREATE OR REPLACE FUNCTION public.fn_guard_rider_payment()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
    IF (NEW.amount IS DISTINCT FROM OLD.amount OR NEW.business_id IS DISTINCT FROM OLD.business_id
        OR NEW.rider_payment IS DISTINCT FROM OLD.rider_payment)
       AND EXISTS (SELECT 1 FROM public.rider_pay_links l WHERE l.expense_id = OLD.id) THEN
        RAISE EXCEPTION 'This is a rider payment. Remove it and pay the rider again to change the amount.';
    END IF;
    RETURN NEW;
END;
$$;
ALTER FUNCTION public.fn_guard_rider_payment() OWNER TO postgres;
DROP TRIGGER IF EXISTS trg_guard_rider_payment ON public.expenses;
CREATE TRIGGER trg_guard_rider_payment BEFORE UPDATE OF amount, business_id, rider_payment ON public.expenses
    FOR EACH ROW EXECUTE FUNCTION public.fn_guard_rider_payment();

-- ---------------------------------------------------------------- books: We owe riders
-- Book lines can name a rider as the other party (what each rider is owed).
ALTER TABLE public.acc_lines DROP CONSTRAINT IF EXISTS acc_lines_party_type_check;
ALTER TABLE public.acc_lines ADD CONSTRAINT acc_lines_party_type_check
    CHECK (party_type = ANY (ARRAY['customer'::text, 'supplier'::text, 'branch'::text, 'rider'::text]));

CREATE OR REPLACE FUNCTION public.acc_rider_payable(p_business_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_id uuid;
BEGIN
    SELECT id INTO v_id FROM public.acc_accounts WHERE business_id = p_business_id AND system_key = 'rider_payable';
    IF v_id IS NULL THEN
        PERFORM public.acc_ensure_accounts(p_business_id);
        INSERT INTO public.acc_accounts (business_id, code, name, type, system_key, description)
        SELECT p_business_id,
               (SELECT MIN(c)::text FROM generate_series(2010, 2049) c
                WHERE NOT EXISTS (SELECT 1 FROM public.acc_accounts y WHERE y.business_id = p_business_id AND y.code = c::text)),
               'We owe riders', 'liability', 'rider_payable', 'Delivery pay owed to riders, not yet paid'
        ON CONFLICT DO NOTHING;
        SELECT id INTO v_id FROM public.acc_accounts WHERE business_id = p_business_id AND system_key = 'rider_payable';
    END IF;
    RETURN v_id;
END;
$$;
ALTER FUNCTION public.acc_rider_payable(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.acc_rider_payable(uuid) FROM PUBLIC, anon, authenticated;

-- Lines for one sale / website order / trip: owed on its day (or nothing if no longer owed).
CREATE OR REPLACE FUNCTION public.acc_rider_pay_lines(p_id uuid) RETURNS TABLE(b uuid, d date, m text, l jsonb)
    LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
    v_b uuid;
    o   record;
BEGIN
    SELECT business_id INTO v_b FROM public.transactions WHERE id = p_id;
    IF v_b IS NULL THEN SELECT business_id INTO v_b FROM public.online_orders WHERE id = p_id; END IF;
    IF v_b IS NULL THEN SELECT business_id INTO v_b FROM public.delivery_trips WHERE id = p_id; END IF;
    -- Gone (a trip undone): take back what was posted.
    IF v_b IS NULL THEN
        SELECT business_id INTO v_b FROM public.acc_entries WHERE source_type = 'rider_pay' AND source_id = p_id LIMIT 1;
    END IF;
    IF v_b IS NULL THEN RETURN; END IF;

    SELECT * INTO o FROM public.fn_rider_owed(v_b, p_id) LIMIT 1;
    b := v_b;
    l := '[]'::jsonb;
    IF o.item_id IS NULL THEN
        d := (NOW() AT TIME ZONE 'Africa/Nairobi')::date;
        m := 'Rider pay no longer owed';
    ELSE
        d := (o.item_date AT TIME ZONE 'Africa/Nairobi')::date;
        m := 'Rider pay owed · ' || o.rider_name || ' · ' || o.reference;
        l := public.acc_l(l, public.acc_expense_account(v_b, 'Rider pay'), o.amount);
        l := public.acc_l(l, public.acc_rider_payable(v_b), -o.amount, 'rider', o.rider_key, o.rider_name);
    END IF;
    RETURN NEXT;
END;
$$;
ALTER FUNCTION public.acc_rider_pay_lines(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.acc_rider_pay_lines(uuid) FROM PUBLIC, anon, authenticated;

-- Post the delivery and its trip (old and new) when a delivery or trip changes.
CREATE OR REPLACE FUNCTION public.acc_trg_post_rider_pay() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
    v_ids uuid[];
    v_id  uuid;
    v_b   uuid;
BEGIN
    IF TG_OP = 'DELETE' THEN
        v_ids := ARRAY[OLD.id];
        v_b := OLD.business_id;
    ELSE
        v_ids := ARRAY[NEW.id];
        v_b := NEW.business_id;
    END IF;
    IF TG_TABLE_NAME <> 'delivery_trips' THEN
        IF TG_OP <> 'DELETE' AND NEW.trip_id IS NOT NULL THEN v_ids := v_ids || NEW.trip_id; END IF;
        IF TG_OP <> 'INSERT' AND OLD.trip_id IS NOT NULL THEN v_ids := v_ids || OLD.trip_id; END IF;
    END IF;
    FOREACH v_id IN ARRAY v_ids LOOP
        BEGIN
            PERFORM public.acc_post_source('rider_pay', v_id);
        EXCEPTION WHEN OTHERS THEN
            BEGIN
                INSERT INTO public.acc_post_errors (business_id, source_type, source_id, message)
                SELECT v_b, 'rider_pay', v_id, SQLERRM
                WHERE EXISTS (SELECT 1 FROM public.businesses WHERE id = v_b)
                ON CONFLICT (source_type, source_id) DO UPDATE SET message = EXCLUDED.message, created_at = NOW();
            EXCEPTION WHEN OTHERS THEN NULL;
            END;
        END;
    END LOOP;
    RETURN NULL;
END;
$$;
ALTER FUNCTION public.acc_trg_post_rider_pay() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.acc_trg_post_rider_pay() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_acc_rider_pay_sale_ins ON public.transactions;
CREATE CONSTRAINT TRIGGER trg_acc_rider_pay_sale_ins AFTER INSERT ON public.transactions
    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN (NEW.is_delivery)
    EXECUTE FUNCTION public.acc_trg_post_rider_pay();
DROP TRIGGER IF EXISTS trg_acc_rider_pay_sale_upd ON public.transactions;
CREATE CONSTRAINT TRIGGER trg_acc_rider_pay_sale_upd AFTER UPDATE ON public.transactions
    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN (NEW.is_delivery OR OLD.is_delivery)
    EXECUTE FUNCTION public.acc_trg_post_rider_pay();
DROP TRIGGER IF EXISTS trg_acc_rider_pay_online_ins ON public.online_orders;
CREATE CONSTRAINT TRIGGER trg_acc_rider_pay_online_ins AFTER INSERT ON public.online_orders
    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN (NEW.fulfilment = 'delivery')
    EXECUTE FUNCTION public.acc_trg_post_rider_pay();
DROP TRIGGER IF EXISTS trg_acc_rider_pay_online_upd ON public.online_orders;
CREATE CONSTRAINT TRIGGER trg_acc_rider_pay_online_upd AFTER UPDATE ON public.online_orders
    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN (NEW.fulfilment = 'delivery' OR OLD.fulfilment = 'delivery')
    EXECUTE FUNCTION public.acc_trg_post_rider_pay();
DROP TRIGGER IF EXISTS trg_acc_rider_pay_trip ON public.delivery_trips;
CREATE CONSTRAINT TRIGGER trg_acc_rider_pay_trip AFTER INSERT OR UPDATE OR DELETE ON public.delivery_trips
    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
    EXECUTE FUNCTION public.acc_trg_post_rider_pay();

-- ================================================================ existing functions
-- Copied from their newest version with the rider pay changes marked "Rider pay (20261130004)".


CREATE OR REPLACE FUNCTION "public"."acc_post_source"("p_type" "text", "p_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $_$
DECLARE
    v_b      UUID;
    v_date   DATE;
    v_memo   TEXT;
    v_lines  JSONB := '[]'::JSONB;
    t        public.transactions%ROWTYPE;
    e        public.expenses%ROWTYPE;
    cl       public.customer_ledger%ROWTYPE;
    py       public.payments%ROWTYPE;
    pu       public.purchases%ROWTYPE;
    sp       public.supplier_payments%ROWTYPE;
    ia       public.inventory_adjustments%ROWTYPE;
    v_cost   NUMERIC;
    v_goods  NUMERIC;
    v_deliv  NUMERIC;
    v_owed   NUMERIC;
    v_money  NUMERIC;
    v_method TEXT;
    v_cname  TEXT;
    v_code   TEXT;
    v_ref    TEXT;
    v_rest   NUMERIC;
    v_party  TEXT;
BEGIN
    IF p_type = 'sale' THEN
        SELECT * INTO t FROM public.transactions WHERE id = p_id;
        IF NOT FOUND THEN RETURN; END IF;
        v_b := t.business_id;
        v_date := (t.timestamp AT TIME ZONE 'Africa/Nairobi')::DATE;
        v_cname := COALESCE(NULLIF(t.customer_name, ''), 'Walk-in');
        v_memo := 'Sale ' || public.fn_receipt_number(t.id) || ' · ' || v_cname;
        IF t.deleted_at IS NULL THEN
            v_deliv := CASE WHEN t.is_delivery THEN COALESCE(t.delivery_fee, 0) ELSE 0 END;
            v_goods := t.final_total - COALESCE(t.tax, 0) - v_deliv;
            IF t.payment_method IN ('Credit_Debt', 'Credit') THEN
                v_money := COALESCE(t.amount_paid, 0);
                v_method := 'Cash';
            ELSE
                v_money := t.final_total - COALESCE(t.wallet_applied, 0);
                v_method := t.payment_method::TEXT;
            END IF;
            v_owed := t.final_total - v_money - COALESCE(t.wallet_applied, 0);
            v_lines := public.acc_l(v_lines, public.acc_account(v_b, public.acc_money_key(v_method)), v_money);
            v_lines := public.acc_l(v_lines, public.acc_account(v_b, 'wallets'), t.wallet_applied, 'customer', t.customer_id::TEXT, v_cname);
            v_lines := public.acc_l(v_lines, public.acc_account(v_b, 'receivable'), v_owed, 'customer', t.customer_id::TEXT, v_cname);
            -- Promotion codes (20261126003): sales at the price before the code, the code's
            -- discount on its own line, so the books show what promotions cost.
            v_lines := public.acc_l(v_lines, public.acc_account(v_b, 'sales'), -(v_goods + COALESCE(t.promotion_discount, 0)));
            v_lines := public.acc_l(v_lines, public.acc_account(v_b, 'promo_discounts'), COALESCE(t.promotion_discount, 0));
            v_lines := public.acc_l(v_lines, public.acc_account(v_b, 'delivery'), -v_deliv);
            v_lines := public.acc_l(v_lines, public.acc_account(v_b, 'vat'), -COALESCE(t.tax, 0));
            SELECT COALESCE(SUM(ti.quantity * COALESCE(ti.unit_cost, p.cost, 0)), 0) INTO v_cost
            FROM public.transaction_items ti
            LEFT JOIN public.products p ON p.id = ti.product_id
            WHERE ti.transaction_id = t.id;
            v_cost := round(v_cost, 2);
            v_lines := public.acc_l(v_lines, public.acc_account(v_b, 'cogs'), v_cost);
            v_lines := public.acc_l(v_lines, public.acc_account(v_b, 'inventory'), -v_cost);
        END IF;

    ELSIF p_type = 'expense' THEN
        SELECT * INTO e FROM public.expenses WHERE id = p_id;
        IF NOT FOUND THEN RETURN; END IF;
        v_b := e.business_id;
        v_date := (e.date AT TIME ZONE 'Africa/Nairobi')::DATE;
        v_memo := CASE WHEN e.source = 'petty_cash' THEN 'Petty cash: ' ELSE 'Expense: ' END
                  || COALESCE(e.category, 'Other') || COALESCE(' · ' || NULLIF(e.description, ''), '');
        IF e.deleted_at IS NULL AND e.amount > 0 AND e.rider_payment THEN
            -- Rider pay (20261130004): paying a rider settles what is owed; the spending was booked on the
            -- delivery's day (source 'rider_pay').
            SELECT l.rider_key, l.rider_name INTO v_party, v_cname
            FROM public.rider_pay_links l WHERE l.expense_id = e.id LIMIT 1;
            v_memo := CASE WHEN e.source = 'petty_cash' THEN 'Petty cash: ' ELSE '' END
                      || 'Paid rider (' || COALESCE(e.payment_method, 'Cash') || ') · ' || COALESCE(NULLIF(e.description, ''), v_cname, 'Rider');
            v_lines := public.acc_l(v_lines, public.acc_rider_payable(v_b), e.amount, 'rider', v_party, v_cname);
            v_lines := public.acc_l(v_lines, public.acc_account(v_b, public.acc_money_key(COALESCE(e.payment_method, 'Cash'))), -e.amount);
        ELSIF e.deleted_at IS NULL AND e.amount > 0 THEN
            v_lines := public.acc_l(v_lines, public.acc_expense_account(v_b, e.category), e.amount);
            v_lines := public.acc_l(v_lines, public.acc_account(v_b, public.acc_money_key(COALESCE(e.payment_method, 'Cash'))), -e.amount);
        END IF;

    ELSIF p_type = 'cledger' THEN
        -- Customer money that is not part of a sale. Rows are never changed once written.
        SELECT * INTO cl FROM public.customer_ledger WHERE id = p_id;
        IF NOT FOUND THEN RETURN; END IF;
        v_b := cl.business_id;
        v_date := (cl.created_at AT TIME ZONE 'Africa/Nairobi')::DATE;
        SELECT name INTO v_cname FROM public.customers WHERE id = cl.customer_id;
        v_cname := COALESCE(v_cname, 'Customer');
        v_party := cl.customer_id::TEXT;
        v_ref := COALESCE(cl.reference_id, '');

        -- Payment method: the payment this row came from, else the note ("… via M-Pesa"), else cash.
        v_method := NULL;
        IF v_ref ~ '^void-[0-9a-f-]{36}-' THEN
            SELECT method INTO v_method FROM public.payments WHERE id = substring(v_ref FROM 6 FOR 36)::UUID;
        ELSIF v_ref ~ '-(debt-payment|wallet-topup)$' THEN
            SELECT method INTO v_method FROM public.payments
            WHERE business_id = cl.business_id AND reference_code = regexp_replace(v_ref, '-(debt-payment|wallet-topup)$', '');
        END IF;
        IF v_method IS NULL THEN
            v_method := COALESCE(substring(cl.note FROM 'via (M-Pesa|Airtel Money|Cash|Card|Bank)'), 'Cash');
        END IF;

        IF cl.type = 'debt_payment' AND v_ref LIKE 'redeem-%' THEN
            v_memo := 'Debt paid with loyalty points · ' || v_cname;
            v_lines := public.acc_l(v_lines, public.acc_account(v_b, 'loyalty'), cl.amount);
            v_lines := public.acc_l(v_lines, public.acc_account(v_b, 'receivable'), -cl.amount, 'customer', v_party, v_cname);
        ELSIF cl.type = 'debt_payment' THEN
            v_memo := 'Debt payment (' || v_method || ') · ' || v_cname;
            v_lines := public.acc_l(v_lines, public.acc_account(v_b, public.acc_money_key(v_method)), cl.amount);
            v_lines := public.acc_l(v_lines, public.acc_account(v_b, 'receivable'), -cl.amount, 'customer', v_party, v_cname);
        ELSIF cl.type = 'wallet_topup' AND v_ref NOT LIKE 'merge-%' THEN
            v_memo := 'Wallet top-up (' || v_method || ') · ' || v_cname;
            v_lines := public.acc_l(v_lines, public.acc_account(v_b, public.acc_money_key(v_method)), cl.amount);
            v_lines := public.acc_l(v_lines, public.acc_account(v_b, 'wallets'), -cl.amount, 'customer', v_party, v_cname);
        ELSIF cl.type = 'wallet_usage' AND cl.transaction_id IS NULL AND v_ref LIKE 'void-%' THEN
            v_memo := 'Voided wallet top-up (' || v_method || ') · ' || v_cname;
            v_lines := public.acc_l(v_lines, public.acc_account(v_b, 'wallets'), cl.amount, 'customer', v_party, v_cname);
            v_lines := public.acc_l(v_lines, public.acc_account(v_b, public.acc_money_key(v_method)), -cl.amount);
        ELSIF cl.type = 'wallet_usage' AND cl.transaction_id IS NULL THEN
            v_memo := 'Wallet money paid debt · ' || v_cname;
            v_lines := public.acc_l(v_lines, public.acc_account(v_b, 'wallets'), cl.amount, 'customer', v_party, v_cname);
            v_lines := public.acc_l(v_lines, public.acc_account(v_b, 'receivable'), -cl.amount, 'customer', v_party, v_cname);
        ELSIF cl.type = 'debt_adjustment' AND v_ref LIKE 'void-%' THEN
            v_memo := 'Voided debt payment (' || v_method || ') · ' || v_cname;
            v_lines := public.acc_l(v_lines, public.acc_account(v_b, 'receivable'), cl.amount, 'customer', v_party, v_cname);
            v_lines := public.acc_l(v_lines, public.acc_account(v_b, public.acc_money_key(v_method)), -cl.amount);
        ELSIF cl.type IN ('debt_adjustment', 'debt_creation') AND cl.transaction_id IS NULL AND v_ref NOT LIKE 'merge-%' THEN
            v_memo := 'Debt added by hand · ' || v_cname;
            v_lines := public.acc_l(v_lines, public.acc_account(v_b, 'receivable'), cl.amount, 'customer', v_party, v_cname);
            v_lines := public.acc_l(v_lines, public.acc_account(v_b, 'opening'), -cl.amount);
        ELSE
            RETURN; -- part of a sale (the sale posts it) or moved between merged customers
        END IF;

    ELSIF p_type = 'payment' THEN
        -- Only the part of a payment that is not applied to a customer's debt or wallet
        -- (those parts post from the customer ledger).
        SELECT * INTO py FROM public.payments WHERE id = p_id;
        IF NOT FOUND THEN RETURN; END IF;
        v_b := py.business_id;
        v_date := (COALESCE(py.date, py.created_at) AT TIME ZONE 'Africa/Nairobi')::DATE;
        v_memo := 'Payment ' || COALESCE(py.reference_code, '') || ' (' || py.method || ') · ' || COALESCE(py.customer_name, py.sender_name, 'Walk-in');
        v_rest := py.amount - COALESCE(py.debt_applied, 0) - COALESCE(py.wallet_applied, 0);
        IF py.status = 'Success' AND v_rest > 0 THEN
            v_lines := public.acc_l(v_lines, public.acc_account(v_b, public.acc_money_key(py.method)), v_rest);
            v_lines := public.acc_l(v_lines, public.acc_account(v_b, 'unmatched'), -v_rest, 'customer', py.customer_id::TEXT, COALESCE(py.customer_name, py.sender_name));
        END IF;

    ELSIF p_type = 'purchase' THEN
        SELECT * INTO pu FROM public.purchases WHERE id = p_id;
        IF NOT FOUND THEN RETURN; END IF;
        v_b := pu.business_id;
        v_date := (COALESCE(pu.received_at, pu.date) AT TIME ZONE 'Africa/Nairobi')::DATE;
        v_code := COALESCE(NULLIF(pu.reference_number, ''), 'PO-' || upper(left(replace(pu.id::TEXT, '-', ''), 8)));
        v_memo := 'Purchase ' || v_code || ' received · ' || COALESCE(pu.supplier_name, 'Supplier');
        IF pu.status = 'Received' AND pu.total_amount > 0
           AND NOT EXISTS (SELECT 1 FROM public.purchase_receipts r WHERE r.purchase_id = pu.id) THEN
            v_party := COALESCE(pu.supplier_id::TEXT, 'name:' || lower(trim(COALESCE(pu.supplier_name, ''))));
            v_lines := public.acc_l(v_lines, public.acc_account(v_b, 'inventory'), pu.total_amount);
            v_lines := public.acc_l(v_lines, public.acc_account(v_b, 'payable'), -pu.total_amount, 'supplier', v_party, pu.supplier_name);
        END IF;

    ELSIF p_type = 'supplier_payment' THEN
        SELECT * INTO sp FROM public.supplier_payments WHERE id = p_id;
        IF NOT FOUND THEN RETURN; END IF;
        v_b := sp.business_id;
        v_date := (sp.paid_at AT TIME ZONE 'Africa/Nairobi')::DATE;
        v_memo := 'Paid supplier (' || sp.method || ') · ' || sp.supplier_name || COALESCE(' · ' || NULLIF(sp.reference, ''), '');
        IF sp.voided_at IS NULL THEN
            v_party := COALESCE(sp.supplier_id::TEXT, 'name:' || lower(trim(sp.supplier_name)));
            v_lines := public.acc_l(v_lines, public.acc_account(v_b, 'payable'), sp.amount, 'supplier', v_party, sp.supplier_name);
            v_lines := public.acc_l(v_lines, public.acc_account(v_b, public.acc_money_key(sp.method)), -sp.amount);
        END IF;

    ELSIF p_type = 'stock_adj' THEN
        SELECT * INTO ia FROM public.inventory_adjustments WHERE id = p_id;
        IF NOT FOUND THEN RETURN; END IF;
        v_b := ia.business_id;
        v_date := (ia.timestamp AT TIME ZONE 'Africa/Nairobi')::DATE;
        v_memo := ia.type::TEXT || ': ' || COALESCE(ia.product_name, '') || COALESCE(' · ' || NULLIF(ia.reason, ''), '');
        IF ia.deleted_at IS NULL AND ia.type::TEXT = 'Restock' AND ia.reason = 'Opening stock' THEN
            -- Stock a product started with (20261119001): it was there before the books.
            SELECT COALESCE(cost, 0) INTO v_cost FROM public.products WHERE id = ia.product_id;
            v_cost := round(COALESCE(v_cost, 0) * COALESCE(ia.quantity_adjusted, 0), 2);
            v_lines := public.acc_l(v_lines, public.acc_account(v_b, 'inventory'), v_cost);
            v_lines := public.acc_l(v_lines, public.acc_account(v_b, 'opening'), -v_cost);
        ELSIF ia.deleted_at IS NULL
           AND (ia.type::TEXT IN ('Damage', 'Production Waste')
                OR (ia.type::TEXT = 'Reconciliation' AND COALESCE(ia.reason, '') <> 'Sold')) THEN
            SELECT COALESCE(cost, 0) INTO v_cost FROM public.products WHERE id = ia.product_id;
            v_cost := round(COALESCE(v_cost, 0) * COALESCE(ia.quantity_adjusted, 0), 2);
            v_lines := public.acc_l(v_lines, public.acc_account(v_b, 'inventory'), v_cost);
            v_lines := public.acc_l(v_lines, public.acc_account(v_b, 'stock_loss'), -v_cost);
        END IF;

    ELSIF p_type IN ('sales_delivery', 'sales_invoice', 'invoice_payment', 'credit_note') THEN
        -- Quotes & invoices (20261117001).
        SELECT r.b, r.d, r.m, r.l INTO v_b, v_date, v_memo, v_lines FROM public.acc_sales_doc_lines(p_type, p_id) r;
        IF v_b IS NULL THEN RETURN; END IF;

    ELSIF p_type IN ('purchase_receipt', 'supplier_bill', 'supplier_return', 'transfer_out', 'transfer_close', 'transfer_in') THEN
        -- Buying and transfers (20261118001).
        SELECT r.b, r.d, r.m, r.l INTO v_b, v_date, v_memo, v_lines FROM public.acc_buying_lines(p_type, p_id) r;
        IF v_b IS NULL THEN RETURN; END IF;

    ELSIF p_type = 'referral_reward' THEN
        -- Referral wallet credit (20261126003).
        SELECT r.b, r.d, r.m, r.l INTO v_b, v_date, v_memo, v_lines FROM public.acc_referral_lines(p_id) r;
        IF v_b IS NULL THEN RETURN; END IF;

    ELSIF p_type = 'rider_pay' THEN
        -- Rider pay (20261130004): delivery pay owed to a rider, on the delivery's day.
        SELECT r.b, r.d, r.m, r.l INTO v_b, v_date, v_memo, v_lines FROM public.acc_rider_pay_lines(p_id) r;
        IF v_b IS NULL THEN RETURN; END IF;

    ELSE
        RAISE EXCEPTION 'Unknown source %', p_type;
    END IF;

    IF v_b IS NULL OR NOT EXISTS (SELECT 1 FROM public.businesses WHERE id = v_b) THEN
        RETURN;
    END IF;
    PERFORM public.acc_apply(v_b, p_type, p_id, v_date, v_memo, v_lines);
    DELETE FROM public.acc_post_errors WHERE source_type = p_type AND source_id = p_id;
END;
$_$;
ALTER FUNCTION "public"."acc_post_source"("p_type" "text", "p_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."acc_source_ids"("p_business_id" "uuid", "p_type" "text", "p_offset" integer, "p_limit" integer) RETURNS SETOF "uuid"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
    IF p_type = 'sale' THEN
        RETURN QUERY SELECT id FROM public.transactions WHERE business_id = p_business_id ORDER BY timestamp, id OFFSET p_offset LIMIT p_limit;
    ELSIF p_type = 'expense' THEN
        RETURN QUERY SELECT id FROM public.expenses WHERE business_id = p_business_id ORDER BY date, id OFFSET p_offset LIMIT p_limit;
    ELSIF p_type = 'cledger' THEN
        RETURN QUERY SELECT id FROM public.customer_ledger WHERE business_id = p_business_id
            AND type IN ('debt_payment', 'wallet_topup', 'wallet_usage', 'debt_adjustment', 'debt_creation')
            AND (transaction_id IS NULL) ORDER BY created_at, id OFFSET p_offset LIMIT p_limit;
    ELSIF p_type = 'payment' THEN
        RETURN QUERY SELECT id FROM public.payments WHERE business_id = p_business_id ORDER BY created_at, id OFFSET p_offset LIMIT p_limit;
    ELSIF p_type = 'purchase' THEN
        RETURN QUERY SELECT id FROM public.purchases WHERE business_id = p_business_id ORDER BY date, id OFFSET p_offset LIMIT p_limit;
    ELSIF p_type = 'supplier_payment' THEN
        RETURN QUERY SELECT id FROM public.supplier_payments WHERE business_id = p_business_id ORDER BY paid_at, id OFFSET p_offset LIMIT p_limit;
    ELSIF p_type = 'stock_adj' THEN
        RETURN QUERY SELECT id FROM public.inventory_adjustments WHERE business_id = p_business_id
            AND ((type::TEXT IN ('Damage', 'Production Waste', 'Reconciliation') AND COALESCE(reason, '') <> 'Sold')
                 OR (type::TEXT = 'Restock' AND reason = 'Opening stock'))
            ORDER BY timestamp, id OFFSET p_offset LIMIT p_limit;
    ELSIF p_type = 'sales_delivery' THEN
        RETURN QUERY SELECT id FROM public.sales_deliveries WHERE business_id = p_business_id ORDER BY delivered_at, id OFFSET p_offset LIMIT p_limit;
    ELSIF p_type = 'sales_invoice' THEN
        RETURN QUERY SELECT id FROM public.sales_invoices WHERE business_id = p_business_id ORDER BY created_at, id OFFSET p_offset LIMIT p_limit;
    ELSIF p_type = 'invoice_payment' THEN
        RETURN QUERY SELECT id FROM public.invoice_payments WHERE business_id = p_business_id ORDER BY created_at, id OFFSET p_offset LIMIT p_limit;
    ELSIF p_type = 'credit_note' THEN
        RETURN QUERY SELECT id FROM public.credit_notes WHERE business_id = p_business_id ORDER BY created_at, id OFFSET p_offset LIMIT p_limit;
    ELSIF p_type = 'purchase_receipt' THEN
        RETURN QUERY SELECT id FROM public.purchase_receipts WHERE business_id = p_business_id ORDER BY received_at, id OFFSET p_offset LIMIT p_limit;
    ELSIF p_type = 'supplier_bill' THEN
        RETURN QUERY SELECT id FROM public.supplier_bills WHERE business_id = p_business_id ORDER BY created_at, id OFFSET p_offset LIMIT p_limit;
    ELSIF p_type = 'supplier_return' THEN
        RETURN QUERY SELECT id FROM public.supplier_returns WHERE business_id = p_business_id ORDER BY created_at, id OFFSET p_offset LIMIT p_limit;
    ELSIF p_type IN ('transfer_out', 'transfer_close') THEN
        RETURN QUERY SELECT id FROM public.stock_transfers WHERE from_business_id = p_business_id ORDER BY created_at, id OFFSET p_offset LIMIT p_limit;
    ELSIF p_type = 'referral_reward' THEN
        RETURN QUERY SELECT id FROM public.referral_rewards WHERE business_id = p_business_id AND kind = 'wallet' ORDER BY issued_at, id OFFSET p_offset LIMIT p_limit;
    ELSIF p_type = 'rider_pay' THEN
        -- Rider pay (20261130004): every delivery sale, website delivery and trip.
        RETURN QUERY SELECT x.id FROM (
            SELECT id, timestamp AS d FROM public.transactions WHERE business_id = p_business_id AND is_delivery
            UNION ALL SELECT id, created_at FROM public.online_orders WHERE business_id = p_business_id AND fulfilment = 'delivery'
            UNION ALL SELECT id, created_at FROM public.delivery_trips WHERE business_id = p_business_id
        ) x ORDER BY x.d, x.id OFFSET p_offset LIMIT p_limit;
    ELSIF p_type = 'transfer_in' THEN
        RETURN QUERY SELECT id FROM public.stock_transfers WHERE to_business_id = p_business_id ORDER BY created_at, id OFFSET p_offset LIMIT p_limit;
    END IF;
END;
$$;
ALTER FUNCTION "public"."acc_source_ids"("p_business_id" "uuid", "p_type" "text", "p_offset" integer, "p_limit" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."acc_rebuild_start"("p_business_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE v_lock DATE;
BEGIN
    PERFORM public.assert_business_member(p_business_id);
    PERFORM public.assert_permission(p_business_id, 'accounting.manage');
    PERFORM public.acc_ensure_accounts(p_business_id);
    SELECT lock_date INTO v_lock FROM public.acc_settings WHERE business_id = p_business_id;
    DELETE FROM public.acc_entries
    WHERE business_id = p_business_id AND source_type IS NOT NULL
      AND (v_lock IS NULL OR entry_date > v_lock);
    UPDATE public.acc_entries e SET reversed_at = NULL
    WHERE e.business_id = p_business_id AND e.reversed_at IS NOT NULL AND e.source_type IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM public.acc_entries r WHERE r.reversal_of = e.id);
    DELETE FROM public.acc_post_errors WHERE business_id = p_business_id;
    RETURN jsonb_build_object('kinds', jsonb_build_array('sale', 'expense', 'cledger', 'payment', 'purchase', 'supplier_payment',
        'stock_adj', 'sales_delivery', 'sales_invoice', 'invoice_payment', 'credit_note',
        'purchase_receipt', 'supplier_bill', 'supplier_return', 'transfer_out', 'transfer_close', 'transfer_in', 'referral_reward', 'rider_pay'));
END;
$$;
ALTER FUNCTION "public"."acc_rebuild_start"("p_business_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_finance_report_till"("p_business_id" "uuid", "p_start" timestamp with time zone, "p_end" timestamp with time zone) RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
    v_sales      JSONB;
    v_methods    JSONB;
    v_cogs       JSONB;
    v_expenses   JSONB;
    v_exp_cats   JSONB;
    v_exp_list   JSONB;
    v_points     JSONB;
    v_money_in   JSONB;
    v_debts      JSONB;
    v_wallets    JSONB;
    v_daily      JSONB;
    v_activity   JSONB;
    v_products   JSONB;
    v_goods      NUMERIC := 0;
    v_cost       NUMERIC := 0;
    v_exp_total  NUMERIC := 0;
    v_pts_debt   NUMERIC := 0;
BEGIN
    PERFORM public.assert_business_member(p_business_id);
    PERFORM public.assert_permission(p_business_id, 'finance.view');

    -- Sales
    SELECT jsonb_build_object(
        'count', COUNT(*),
        'total', COALESCE(SUM(final_total), 0),
        'vat', COALESCE(SUM(tax), 0),
        'delivery', COALESCE(SUM(CASE WHEN is_delivery THEN delivery_fee ELSE 0 END), 0),
        'discounts', COALESCE(SUM(discount), 0),
        'net', COALESCE(SUM(final_total - tax), 0),
        'paid', COALESCE(SUM(final_total) FILTER (WHERE payment_method NOT IN ('Credit_Debt', 'Credit')), 0),
        'credit', COALESCE(SUM(final_total) FILTER (WHERE payment_method IN ('Credit_Debt', 'Credit')), 0),
        'creditCount', COUNT(*) FILTER (WHERE payment_method IN ('Credit_Debt', 'Credit')),
        'walletUsed', COALESCE(SUM(wallet_applied) FILTER (WHERE payment_method IN ('Credit_Debt', 'Credit')), 0),
        'creditOwed', COALESCE(SUM(GREATEST(0, final_total - COALESCE(amount_paid, 0) - COALESCE(wallet_applied, 0)))
                        FILTER (WHERE payment_method IN ('Credit_Debt', 'Credit')), 0)
    ), COALESCE(SUM(final_total - tax), 0)
    INTO v_sales, v_goods
    FROM public.transactions
    WHERE business_id = p_business_id AND deleted_at IS NULL
      AND timestamp >= p_start AND timestamp <= p_end;

    SELECT COALESCE(jsonb_object_agg(m, amt), '{}'::JSONB) INTO v_methods
    FROM (
        SELECT payment_method::TEXT AS m, SUM(final_total) AS amt
        FROM public.transactions
        WHERE business_id = p_business_id AND deleted_at IS NULL
          AND timestamp >= p_start AND timestamp <= p_end
        GROUP BY payment_method
    ) x;

    -- Cost of goods: the cost recorded on the sale line, else the product's cost now
    SELECT jsonb_build_object(
        'total', COALESCE(SUM(ti.quantity * COALESCE(ti.unit_cost, p.cost, 0)), 0),
        'estimatedLines', COUNT(*) FILTER (WHERE ti.unit_cost IS NULL),
        'lines', COUNT(*)
    ), COALESCE(SUM(ti.quantity * COALESCE(ti.unit_cost, p.cost, 0)), 0)
    INTO v_cogs, v_cost
    FROM public.transaction_items ti
    JOIN public.transactions t ON t.id = ti.transaction_id
    LEFT JOIN public.products p ON p.id = ti.product_id
    WHERE t.business_id = p_business_id AND t.deleted_at IS NULL
      AND t.timestamp >= p_start AND t.timestamp <= p_end;

    -- Best and worst products by profit
    SELECT COALESCE(jsonb_agg(row_to_json(x) ORDER BY x.profit DESC), '[]'::JSONB) INTO v_products
    FROM (
        SELECT ti.product_name AS name,
               SUM(ti.quantity) AS qty,
               SUM(ti.line_total) AS revenue,
               SUM(ti.quantity * COALESCE(ti.unit_cost, p.cost, 0)) AS cost,
               SUM(ti.line_total) - SUM(ti.quantity * COALESCE(ti.unit_cost, p.cost, 0)) AS profit
        FROM public.transaction_items ti
        JOIN public.transactions t ON t.id = ti.transaction_id
        LEFT JOIN public.products p ON p.id = ti.product_id
        WHERE t.business_id = p_business_id AND t.deleted_at IS NULL
          AND t.timestamp >= p_start AND t.timestamp <= p_end
        GROUP BY ti.product_name
        ORDER BY 5 DESC
        LIMIT 50
    ) x;

    -- Expenses (petty cash is part of them)
    SELECT jsonb_build_object(
        'total', COALESCE(SUM(amount), 0),
        'pettyCash', COALESCE(SUM(amount) FILTER (WHERE source = 'petty_cash'), 0),
        'pettyCashCount', COUNT(*) FILTER (WHERE source = 'petty_cash'),
        'count', COUNT(*)
    ), COALESCE(SUM(amount), 0)
    INTO v_expenses, v_exp_total
    FROM public.fn_spending(p_business_id) AS expenses  -- Rider pay (20261130004)
    WHERE business_id = p_business_id AND deleted_at IS NULL
      AND date >= p_start AND date <= p_end;

    SELECT COALESCE(jsonb_agg(row_to_json(x) ORDER BY x.amount DESC), '[]'::JSONB) INTO v_exp_cats
    FROM (
        SELECT category, SUM(amount) AS amount, COUNT(*) AS count,
               SUM(amount) FILTER (WHERE source = 'petty_cash') AS "pettyCash"
        FROM public.fn_spending(p_business_id) AS expenses  -- Rider pay (20261130004)
        WHERE business_id = p_business_id AND deleted_at IS NULL
          AND date >= p_start AND date <= p_end
        GROUP BY category
    ) x;

    SELECT COALESCE(jsonb_agg(row_to_json(x) ORDER BY x.date DESC), '[]'::JSONB) INTO v_exp_list
    FROM (
        SELECT id, date, category, description, amount, staff_name AS "staffName",
               source, payment_method AS method, receipt_ref AS "receiptRef"
        FROM public.fn_spending(p_business_id) AS expenses  -- Rider pay (20261130004)
        WHERE business_id = p_business_id AND deleted_at IS NULL
          AND date >= p_start AND date <= p_end
        ORDER BY date DESC
        LIMIT 300
    ) x;

    -- Points: earned, used (and what they cost), and what customers still hold
    SELECT COALESCE(SUM(value), 0) INTO v_pts_debt
    FROM public.loyalty_redemptions
    WHERE business_id = p_business_id AND refunded_at IS NULL AND kind = 'account'
      AND created_at >= p_start AND created_at <= p_end;

    SELECT jsonb_build_object(
        'earned', (SELECT COALESCE(SUM(points), 0) FROM public.loyalty_points_earned
                   WHERE business_id = p_business_id AND created_at >= p_start AND created_at <= p_end),
        'earnedBySource', (SELECT COALESCE(jsonb_object_agg(source, pts), '{}'::JSONB) FROM (
                   SELECT source, SUM(points) AS pts FROM public.loyalty_points_earned
                   WHERE business_id = p_business_id AND created_at >= p_start AND created_at <= p_end
                   GROUP BY source) s),
        'used', (SELECT COALESCE(jsonb_agg(row_to_json(u)), '[]'::JSONB) FROM (
                   SELECT kind, COUNT(*) AS count, SUM(points) AS points, SUM(value) AS value
                   FROM public.loyalty_redemptions
                   WHERE business_id = p_business_id AND refunded_at IS NULL
                     AND created_at >= p_start AND created_at <= p_end
                   GROUP BY kind) u),
        'usedValue', (SELECT COALESCE(SUM(value), 0) FROM public.loyalty_redemptions
                   WHERE business_id = p_business_id AND refunded_at IS NULL
                     AND created_at >= p_start AND created_at <= p_end),
        'debtPaidWithPoints', v_pts_debt,
        'outstandingPoints', (SELECT COALESCE(SUM(loyalty_points), 0) FROM public.customers
                   WHERE business_id = p_business_id AND deleted_at IS NULL AND merged_into_id IS NULL),
        'outstandingValue', (SELECT COALESCE(SUM(loyalty_points * public.fn_point_value(business_id, tier)), 0) FROM public.customers
                   WHERE business_id = p_business_id AND deleted_at IS NULL AND merged_into_id IS NULL)
    ) INTO v_points;

    -- Money that came in. Customer money is counted once, from the customer ledger, which every
    -- payment, debt payment and top-up writes to. Voided payments are left out.
    WITH voided AS (
        SELECT reference_code FROM public.payments
        WHERE business_id = p_business_id AND status = 'Voided'
    ), ledger AS (
        SELECT l.type, l.amount FROM public.customer_ledger l
        WHERE l.business_id = p_business_id
          AND l.created_at >= p_start AND l.created_at <= p_end
          AND l.type IN ('debt_payment', 'wallet_topup')
          AND NOT EXISTS (SELECT 1 FROM voided v
                          WHERE l.reference_id IN (v.reference_code || '-debt-payment', v.reference_code || '-wallet-topup'))
    )
    SELECT jsonb_build_object(
        'sales', COALESCE((v_sales->>'paid')::NUMERIC, 0),
        'debtRepaid', COALESCE((SELECT SUM(amount) FROM ledger WHERE type = 'debt_payment'), 0),
        'walletTopups', COALESCE((SELECT SUM(amount) FROM ledger WHERE type = 'wallet_topup'), 0),
        'otherPayments', COALESCE((SELECT SUM(amount - debt_applied - wallet_applied) FROM public.payments
                          WHERE business_id = p_business_id AND status = 'Success'
                            AND date >= p_start AND date <= p_end), 0)
    ) INTO v_money_in;

    -- Debts as they stand now, with their age
    SELECT jsonb_build_object(
        'outstanding', (SELECT COALESCE(SUM(debt_balance), 0) FROM public.customers
                        WHERE business_id = p_business_id AND deleted_at IS NULL AND merged_into_id IS NULL),
        'debtors', (SELECT COUNT(*) FROM public.customers
                    WHERE business_id = p_business_id AND deleted_at IS NULL AND merged_into_id IS NULL AND debt_balance > 0),
        'aging', (SELECT jsonb_build_object(
                    'week', COALESCE(SUM(balance) FILTER (WHERE created_at >= NOW() - INTERVAL '7 days'), 0),
                    'month', COALESCE(SUM(balance) FILTER (WHERE created_at < NOW() - INTERVAL '7 days' AND created_at >= NOW() - INTERVAL '30 days'), 0),
                    'quarter', COALESCE(SUM(balance) FILTER (WHERE created_at < NOW() - INTERVAL '30 days' AND created_at >= NOW() - INTERVAL '90 days'), 0),
                    'older', COALESCE(SUM(balance) FILTER (WHERE created_at < NOW() - INTERVAL '90 days'), 0))
                  FROM public.credit_payments
                  WHERE business_id = p_business_id AND status IN ('Open', 'Partial')),
        'top', (SELECT COALESCE(jsonb_agg(row_to_json(d)), '[]'::JSONB) FROM (
                  SELECT c.id, c.name, c.phone, c.debt_balance AS owed,
                         (SELECT MIN(cp.created_at) FROM public.credit_payments cp
                          WHERE cp.customer_id = c.id AND cp.status IN ('Open', 'Partial')) AS since
                  FROM public.customers c
                  WHERE c.business_id = p_business_id AND c.deleted_at IS NULL AND c.merged_into_id IS NULL AND c.debt_balance > 0
                  ORDER BY c.debt_balance DESC
                  LIMIT 15) d)
    ) INTO v_debts;

    SELECT jsonb_build_object(
        'held', COALESCE(SUM(wallet_balance), 0),
        'customers', COUNT(*) FILTER (WHERE wallet_balance > 0)
    ) INTO v_wallets
    FROM public.customers
    WHERE business_id = p_business_id AND deleted_at IS NULL AND merged_into_id IS NULL;

    -- Day by day, on the Kenya clock
    WITH days AS (
        SELECT generate_series(
            date_trunc('day', p_start AT TIME ZONE 'Africa/Nairobi'),
            date_trunc('day', p_end AT TIME ZONE 'Africa/Nairobi'),
            INTERVAL '1 day') AS d
        LIMIT 400
    ), s AS (
        SELECT date_trunc('day', t.timestamp AT TIME ZONE 'Africa/Nairobi') AS d,
               SUM(t.final_total - t.tax) AS sales
        FROM public.transactions t
        WHERE t.business_id = p_business_id AND t.deleted_at IS NULL AND t.timestamp >= p_start AND t.timestamp <= p_end
        GROUP BY 1
    ), c AS (
        SELECT date_trunc('day', t.timestamp AT TIME ZONE 'Africa/Nairobi') AS d,
               SUM(ti.quantity * COALESCE(ti.unit_cost, p.cost, 0)) AS cost
        FROM public.transaction_items ti
        JOIN public.transactions t ON t.id = ti.transaction_id
        LEFT JOIN public.products p ON p.id = ti.product_id
        WHERE t.business_id = p_business_id AND t.deleted_at IS NULL AND t.timestamp >= p_start AND t.timestamp <= p_end
        GROUP BY 1
    ), e AS (
        SELECT date_trunc('day', date AT TIME ZONE 'Africa/Nairobi') AS d, SUM(amount) AS expenses
        FROM public.fn_spending(p_business_id) AS expenses  -- Rider pay (20261130004)
        WHERE business_id = p_business_id AND deleted_at IS NULL AND date >= p_start AND date <= p_end
        GROUP BY 1
    ), r AS (
        SELECT date_trunc('day', created_at AT TIME ZONE 'Africa/Nairobi') AS d, SUM(value) AS points
        FROM public.loyalty_redemptions
        WHERE business_id = p_business_id AND refunded_at IS NULL AND kind = 'account'
          AND created_at >= p_start AND created_at <= p_end
        GROUP BY 1
    )
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'day', to_char(days.d, 'YYYY-MM-DD'),
        'sales', COALESCE(s.sales, 0),
        'cost', COALESCE(c.cost, 0),
        'expenses', COALESCE(e.expenses, 0),
        'points', COALESCE(r.points, 0),
        'profit', COALESCE(s.sales, 0) - COALESCE(c.cost, 0) - COALESCE(e.expenses, 0) - COALESCE(r.points, 0)
    ) ORDER BY days.d), '[]'::JSONB) INTO v_daily
    FROM days
    LEFT JOIN s ON s.d = days.d
    LEFT JOIN c ON c.d = days.d
    LEFT JOIN e ON e.d = days.d
    LEFT JOIN r ON r.d = days.d;

    -- What happened, newest first
    SELECT COALESCE(jsonb_agg(row_to_json(a) ORDER BY a.at DESC), '[]'::JSONB) INTO v_activity
    FROM (
        (SELECT t.timestamp AS at,
                CASE WHEN t.payment_method IN ('Credit_Debt', 'Credit') THEN 'credit_sale' ELSE 'sale' END AS kind,
                t.final_total AS amount,
                COALESCE(t.wallet_applied, 0) AS wallet,
                t.payment_method::TEXT AS method,
                t.customer_name AS customer,
                t.staff_name AS "by",
                NULL::TEXT AS detail
         FROM public.transactions t
         WHERE t.business_id = p_business_id AND t.deleted_at IS NULL AND t.timestamp >= p_start AND t.timestamp <= p_end
         ORDER BY t.timestamp DESC LIMIT 200)
        UNION ALL
        (SELECT e.date, CASE WHEN e.source = 'petty_cash' THEN 'petty_cash' ELSE 'expense' END, e.amount, 0,
                e.payment_method, NULL, e.staff_name, e.category || COALESCE(': ' || NULLIF(e.description, ''), '')
         FROM public.expenses e
         WHERE e.business_id = p_business_id AND e.deleted_at IS NULL AND e.date >= p_start AND e.date <= p_end
         ORDER BY e.date DESC LIMIT 200)
        UNION ALL
        (SELECT l.created_at, l.type, l.amount, 0, NULL, c.name, l.recorded_by, NULL
         FROM public.customer_ledger l
         JOIN public.customers c ON c.id = l.customer_id
         WHERE l.business_id = p_business_id AND l.created_at >= p_start AND l.created_at <= p_end
           AND (l.type IN ('debt_payment', 'wallet_topup') OR (l.type = 'wallet_usage' AND l.transaction_id IS NULL))
         ORDER BY l.created_at DESC LIMIT 200)
        UNION ALL
        (SELECT r.created_at, 'points_' || r.kind, r.value, 0, NULL, c.name, r.recorded_by, r.points::TEXT
         FROM public.loyalty_redemptions r
         JOIN public.customers c ON c.id = r.customer_id
         WHERE r.business_id = p_business_id AND r.refunded_at IS NULL AND r.created_at >= p_start AND r.created_at <= p_end
         ORDER BY r.created_at DESC LIMIT 200)
        UNION ALL
        (SELECT p.voided_at, 'payment_voided', p.amount, 0, p.method, p.customer_name, p.voided_by, p.void_reason
         FROM public.payments p
         WHERE p.business_id = p_business_id AND p.status = 'Voided' AND p.voided_at >= p_start AND p.voided_at <= p_end
         ORDER BY p.voided_at DESC LIMIT 100)
        ORDER BY 1 DESC
        LIMIT 400
    ) a;

    RETURN jsonb_build_object(
        'start', p_start,
        'end', p_end,
        'sales', v_sales,
        'salesByMethod', v_methods,
        'costOfGoods', v_cogs,
        'expenses', v_expenses,
        'expenseCategories', v_exp_cats,
        'expenseList', v_exp_list,
        'points', v_points,
        'moneyIn', v_money_in,
        'debts', v_debts,
        'wallets', v_wallets,
        'products', v_products,
        'daily', v_daily,
        'activity', v_activity,
        'profit', jsonb_build_object(
            'sales', v_goods,
            'costOfGoods', v_cost,
            'gross', v_goods - v_cost,
            'expenses', v_exp_total,
            'pointsToDebt', v_pts_debt,
            'net', v_goods - v_cost - v_exp_total - v_pts_debt
        )
    );
END;
$$;
ALTER FUNCTION "public"."get_finance_report_till"("p_business_id" "uuid", "p_start" timestamp with time zone, "p_end" timestamp with time zone) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_business_dashboard_metrics"("p_business_id" "uuid", "p_start_date" timestamp with time zone, "p_end_date" timestamp with time zone) RETURNS json
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
    result JSON;
BEGIN
    PERFORM public.assert_permission(p_business_id, 'home.view', 'reports.view');
    PERFORM public.assert_business_member(p_business_id);
    SELECT json_build_object(
        'totalSales',    COALESCE(SUM(t.final_total), 0),
        'orderCount',    COUNT(t.id),
        'aov',           COALESCE(AVG(t.final_total), 0),
        'totalExpenses', (
            SELECT COALESCE(SUM(e.amount), 0)
            FROM public.fn_spending(p_business_id) e  -- Rider pay (20261130004)
            WHERE e.business_id = p_business_id
              AND e.date BETWEEN p_start_date AND p_end_date
              AND e.deleted_at IS NULL
        )
    ) INTO result
    FROM public.transactions t
    WHERE t.business_id = p_business_id
      AND t.timestamp BETWEEN p_start_date AND p_end_date
      AND t.deleted_at IS NULL;

    RETURN result;
END;
$$;
ALTER FUNCTION "public"."get_business_dashboard_metrics"("p_business_id" "uuid", "p_start_date" timestamp with time zone, "p_end_date" timestamp with time zone) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."refresh_dashboard_snapshot"("p_business_id" "uuid", "p_date" "date" DEFAULT CURRENT_DATE, "p_timeframe" "text" DEFAULT 'daily'::"text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
    v_start          TIMESTAMPTZ;
    v_end            TIMESTAMPTZ;
    v_total_sales    NUMERIC(14,2);
    v_total_expenses NUMERIC(14,2);
    v_order_count    INTEGER;
    v_avg_order      NUMERIC(14,2);
    v_top_product    UUID;
    v_top_category   TEXT;
    v_pay_breakdown  JSONB;
BEGIN
    v_end := (p_date + 1)::TIMESTAMPTZ;
    v_start := CASE p_timeframe
        WHEN 'weekly'  THEN (p_date - INTERVAL '6 days')::TIMESTAMPTZ
        WHEN 'monthly' THEN (p_date - INTERVAL '29 days')::TIMESTAMPTZ
        ELSE p_date::TIMESTAMPTZ
    END;

    SELECT
        COALESCE(SUM(final_total), 0),
        COUNT(*),
        COALESCE(AVG(final_total), 0)
    INTO v_total_sales, v_order_count, v_avg_order
    FROM public.transactions
    WHERE business_id = p_business_id
      AND timestamp >= v_start
      AND timestamp < v_end
      AND deleted_at IS NULL;

    SELECT COALESCE(SUM(amount), 0)
    INTO v_total_expenses
    FROM public.fn_spending(p_business_id) AS expenses  -- Rider pay (20261130004)
    WHERE business_id = p_business_id
      AND date >= v_start
      AND date < v_end
      AND deleted_at IS NULL;

    SELECT p.id
    INTO v_top_product
    FROM public.transaction_items ti
    JOIN public.transactions t ON ti.transaction_id = t.id
    JOIN public.products p ON ti.product_id = p.id
    WHERE t.business_id = p_business_id
      AND t.timestamp >= v_start
      AND t.timestamp < v_end
      AND t.deleted_at IS NULL
    GROUP BY p.id
    ORDER BY SUM(ti.quantity) DESC
    LIMIT 1;

    SELECT p.category
    INTO v_top_category
    FROM public.transaction_items ti
    JOIN public.transactions t ON ti.transaction_id = t.id
    JOIN public.products p ON ti.product_id = p.id
    WHERE t.business_id = p_business_id
      AND t.timestamp >= v_start
      AND t.timestamp < v_end
      AND t.deleted_at IS NULL
    GROUP BY p.category
    ORDER BY SUM(ti.line_total) DESC
    LIMIT 1;

    SELECT jsonb_object_agg(payment_method, total_amount)
    INTO v_pay_breakdown
    FROM (
        SELECT
            payment_method::TEXT,
            SUM(final_total) AS total_amount
        FROM public.transactions
        WHERE business_id = p_business_id
          AND timestamp >= v_start
          AND timestamp < v_end
          AND deleted_at IS NULL
        GROUP BY payment_method
    ) pm;

    INSERT INTO public.dashboard_analytics_snapshots
        (business_id, snapshot_date, timeframe, total_sales, total_expenses,
         order_count, avg_order_value, top_product_id, top_category, payment_breakdown)
    VALUES (
        p_business_id, p_date, p_timeframe,
        v_total_sales, v_total_expenses,
        v_order_count, v_avg_order,
        v_top_product, v_top_category,
        COALESCE(v_pay_breakdown, '{}')
    )
    ON CONFLICT (business_id, snapshot_date, timeframe) DO UPDATE SET
        total_sales     = EXCLUDED.total_sales,
        total_expenses  = EXCLUDED.total_expenses,
        order_count     = EXCLUDED.order_count,
        avg_order_value = EXCLUDED.avg_order_value,
        top_product_id  = EXCLUDED.top_product_id,
        top_category    = EXCLUDED.top_category,
        payment_breakdown = EXCLUDED.payment_breakdown;
END;
$$;
ALTER FUNCTION "public"."refresh_dashboard_snapshot"("p_business_id" "uuid", "p_date" "date", "p_timeframe" "text") OWNER TO "postgres";

-- ================================================================ post what already exists
DO $$
DECLARE v_id uuid;
BEGIN
    FOR v_id IN
        SELECT id FROM public.transactions WHERE is_delivery
        UNION ALL SELECT id FROM public.online_orders WHERE fulfilment = 'delivery'
        UNION ALL SELECT id FROM public.delivery_trips
    LOOP
        BEGIN
            PERFORM public.acc_post_source('rider_pay', v_id);
        EXCEPTION WHEN OTHERS THEN NULL;
        END;
    END LOOP;
END $$;
