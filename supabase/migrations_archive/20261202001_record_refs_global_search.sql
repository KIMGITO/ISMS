-- Record references, one search across the business, and product-first deliveries (2026-11-23).
--
-- 1. References people can read out and type back: expenses (EXP-2026-000123), stock movements
--    (STM-…), audit log entries (LOG-…) and customer account entries (LDG-…). These tables had
--    no number of their own (expenses.receipt_ref is the supplier's paper; inventory_adjustments
--    .reference_number is the sale or document that moved the stock; customer_ledger.reference_id
--    is a repeat guard). Records that already have a number keep it: receipts (TXN-/RCT- from the
--    sale id), journal entries (JE-<no>), invoices, orders, quotes, transfers, purchases.
--    - Numbers come from one database sequence per kind, like acc_entries.no (JE-). Sequences take
--      no row locks, so two tills saving at once never wait on, or deadlock over, a counter (a
--      sale writes stock movements and log entries in the same transaction).
--    - Set by the database on insert (any value the app sends is replaced) and never changed.
--    - Unique (unique index). The internal uuid stays the key every link uses.
-- 2. global_search(): one call that searches sales, deliveries, payments, expenses, stock
--    movements, customer account entries, journal entries, audit log entries, transfers and
--    website orders. It runs as the signed-in person (SECURITY INVOKER), so each table's own RLS
--    decides what they can find: a cashier without expenses.view finds no expenses.
-- 3. Deliveries: till-sale deliveries show their receipt number instead of "Till sale", and
--    each delivery returns its items as lines (name, quantity, unit) so riders read products and
--    quantities first.

-- ---------------------------------------------------------------- 1. references
CREATE SEQUENCE IF NOT EXISTS public.ref_expense_seq;
CREATE SEQUENCE IF NOT EXISTS public.ref_stock_move_seq;
CREATE SEQUENCE IF NOT EXISTS public.ref_audit_log_seq;
CREATE SEQUENCE IF NOT EXISTS public.ref_customer_ledger_seq;
REVOKE ALL ON SEQUENCE public.ref_expense_seq, public.ref_stock_move_seq, public.ref_audit_log_seq,
    public.ref_customer_ledger_seq FROM PUBLIC, anon, authenticated;

ALTER TABLE public.expenses              ADD COLUMN IF NOT EXISTS ref_no text;
ALTER TABLE public.inventory_adjustments ADD COLUMN IF NOT EXISTS ref_no text;
ALTER TABLE public.audit_logs            ADD COLUMN IF NOT EXISTS ref_no text;
ALTER TABLE public.customer_ledger       ADD COLUMN IF NOT EXISTS ref_no text;

COMMENT ON COLUMN public.expenses.ref_no IS 'Readable reference (EXP-2026-000123), set by the database on insert, never changed.';
COMMENT ON COLUMN public.inventory_adjustments.ref_no IS 'Readable reference (STM-2026-000123), set by the database on insert, never changed.';
COMMENT ON COLUMN public.audit_logs.ref_no IS 'Readable reference (LOG-2026-000123), set by the database on insert, never changed.';
COMMENT ON COLUMN public.customer_ledger.ref_no IS 'Readable reference (LDG-2026-000123), set by the database on insert, never changed.';

-- PREFIX-YEAR-NUMBER. The year is the Kenyan year the record was made; the number keeps counting.
CREATE OR REPLACE FUNCTION public.fn_make_ref(p_prefix text, p_no bigint, p_at timestamptz)
RETURNS text
    LANGUAGE sql IMMUTABLE
AS $$
    SELECT p_prefix || '-' || to_char(COALESCE(p_at, '2026-01-01'::timestamptz) AT TIME ZONE 'Africa/Nairobi', 'YYYY')
           || '-' || lpad(p_no::text, 6, '0');
$$;
REVOKE ALL ON FUNCTION public.fn_make_ref(text, bigint, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_make_ref(text, bigint, timestamptz) TO authenticated, service_role;

-- Trigger: TG_ARGV[0] = prefix, TG_ARGV[1] = sequence. Runs as owner so the app needs no
-- rights on the sequences.
CREATE OR REPLACE FUNCTION public.fn_set_ref_no()
RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        NEW.ref_no := public.fn_make_ref(TG_ARGV[0], nextval(TG_ARGV[1]::regclass), now());
    ELSIF NEW.ref_no IS DISTINCT FROM OLD.ref_no THEN
        NEW.ref_no := OLD.ref_no; -- stable: a reference never changes once given
    END IF;
    RETURN NEW;
END;
$$;
ALTER FUNCTION public.fn_set_ref_no() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.fn_set_ref_no() FROM PUBLIC, anon, authenticated;

-- Number the rows that already exist, oldest first. Every other trigger on the table is paused
-- for this one update, so it moves no money balance, writes no audit entry and bumps no
-- updated_at; they are switched back on straight after.
DO $$
DECLARE
    v record;
    v_n bigint;
BEGIN
    FOR v IN SELECT * FROM (VALUES
        ('expenses',              'EXP', 'ref_expense_seq',         'created_at'),
        ('inventory_adjustments', 'STM', 'ref_stock_move_seq',      'created_at'),
        ('audit_logs',            'LOG', 'ref_audit_log_seq',       'created_at'),
        ('customer_ledger',       'LDG', 'ref_customer_ledger_seq', 'created_at')
    ) AS t(tbl, prefix, seq, at_col)
    LOOP
        EXECUTE format('ALTER TABLE public.%I DISABLE TRIGGER USER', v.tbl);
        EXECUTE format(
            'WITH o AS (SELECT id, %2$I AS at, row_number() OVER (ORDER BY %2$I, id) + COALESCE((SELECT max(substring(ref_no FROM ''([0-9]+)$'')::bigint) FROM public.%1$I), 0) AS n
                        FROM public.%1$I WHERE ref_no IS NULL)
             UPDATE public.%1$I x SET ref_no = public.fn_make_ref(%3$L, o.n, o.at) FROM o WHERE o.id = x.id',
            v.tbl, v.at_col, v.prefix);
        EXECUTE format('ALTER TABLE public.%I ENABLE TRIGGER USER', v.tbl);
        EXECUTE format('SELECT COALESCE(max(substring(ref_no FROM ''([0-9]+)$'')::bigint), 0) FROM public.%I', v.tbl) INTO v_n;
        PERFORM setval(('public.' || v.seq)::regclass, GREATEST(v_n, 1), v_n > 0);

        EXECUTE format('DROP TRIGGER IF EXISTS trg_ref_no ON public.%I', v.tbl);
        EXECUTE format('CREATE TRIGGER trg_ref_no BEFORE INSERT OR UPDATE OF ref_no ON public.%I
                        FOR EACH ROW EXECUTE FUNCTION public.fn_set_ref_no(%L, %L)', v.tbl, v.prefix, 'public.' || v.seq);
        EXECUTE format('CREATE UNIQUE INDEX IF NOT EXISTS %I ON public.%I (ref_no) WHERE ref_no IS NOT NULL',
                       'uq_' || v.tbl || '_ref_no', v.tbl);
        -- Part of a reference ("000123") finds it too.
        EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON public.%I USING gin (ref_no public.gin_trgm_ops)',
                       'idx_' || v.tbl || '_ref_no_trgm', v.tbl);
    END LOOP;
END;
$$;

-- ---------------------------------------------------------------- search indexes
-- Receipt codes are the first 8 characters of the sale id (fn_short_id); a typed code is matched
-- as a range on this index, so "ABCD" finds ABCD0000…ABCDFFFF without reading every sale.
CREATE INDEX IF NOT EXISTS idx_transactions_short_id
    ON public.transactions (business_id, (public.fn_short_id(id) COLLATE "C"));
CREATE INDEX IF NOT EXISTS idx_transactions_customer_name_trgm
    ON public.transactions USING gin (customer_name public.gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_payments_reference_code_trgm
    ON public.payments USING gin (reference_code public.gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_mpesa_transactions_receipt
    ON public.mpesa_transactions (business_id, upper(receipt_number));

-- ---------------------------------------------------------------- 2. global search
-- Returns up to p_limit results per kind, best match first:
--   [{kind, id, ref, title, subtitle, amount, at, status, rank, …links}]
-- kind: sale | delivery | order | payment | expense | stock_move | customer_ledger | journal |
--       audit | transfer. rank: 100 exact reference, 85-90 part of a reference, 40-60 text.
-- Products, customers, suppliers, invoices and purchases are searched by the app from lists it
-- already holds (and invoices by their own lookup), so they are not repeated here.
CREATE OR REPLACE FUNCTION public.global_search(p_business_id uuid, p_query text, p_limit integer DEFAULT 6)
RETURNS jsonb
    LANGUAGE plpgsql STABLE
    SET search_path TO 'public'
AS $$
DECLARE
    v_q     text := left(btrim(COALESCE(p_query, '')), 80);
    v_up    text;
    v_like  text;
    v_code  text;
    v_num   numeric;
    v_int   bigint;
    v_je    bigint;
    v_mpesa uuid[];
    v_lim   integer := LEAST(GREATEST(COALESCE(p_limit, 6), 1), 20);
    v_out   jsonb := '[]'::jsonb;
BEGIN
    IF p_business_id IS NULL OR length(v_q) < 2 THEN
        RETURN v_out;
    END IF;
    v_up := upper(v_q);
    v_like := '%' || replace(replace(replace(v_q, '\', '\\'), '%', '\%'), '_', '\_') || '%';
    IF replace(v_q, ',', '') ~ '^[0-9]+(\.[0-9]{1,2})?$' THEN
        v_num := replace(v_q, ',', '')::numeric;
    END IF;
    IF v_q ~ '^#?[0-9]{1,12}$' THEN
        v_int := ltrim(v_q, '#')::bigint;
    END IF;
    v_je := substring(v_up FROM '^JE[- ]?([0-9]{1,12})$')::bigint;

    -- A receipt number as printed or logged: ABCD1234, TXN-ABCD1234, RCT-2026-ABCD1234. Our
    -- own record prefixes are references of other kinds, not receipts.
    IF v_up !~ '^(EXP|STM|LOG|LDG|JE|INV|SO|QT|DN|GRN|BILL|CN|RTS|PO|TRF|PUR)[- ]' THEN
        v_code := COALESCE(substring(v_up FROM '^([0-9A-F]{4,8})$'),
                           substring(v_up FROM '^[A-Z]{2,6}[- ](?:(?:19|20)[0-9]{2}[- ])?([0-9A-F]{4,8})$'));
        -- Plain numbers under 6 digits are prices or quantities, not receipts.
        IF v_code ~ '^[0-9]+$' AND length(v_code) < 6 AND v_up !~ '[A-Z]' THEN
            v_code := NULL;
        END IF;
    END IF;

    -- An M-Pesa code (QK12AB34CD) points at the sale it paid for.
    IF v_up ~ '^[A-Z0-9]{8,12}$' THEN
        SELECT array_agg(m.transaction_id) INTO v_mpesa
        FROM public.mpesa_transactions m
        WHERE m.business_id = p_business_id AND upper(m.receipt_number) = v_up AND m.transaction_id IS NOT NULL;
    END IF;

    -- Sales: receipt number, M-Pesa code, customer, exact amount.
    v_out := v_out || COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                   'kind', 'sale', 'id', s.id, 'ref', public.fn_receipt_number(s.id),
                   'title', COALESCE(NULLIF(s.customer_name, ''), 'Walk-in customer'),
                   'subtitle', (SELECT string_agg(trim(to_char(i.quantity, 'FM999999990.9'), '.') || ' × ' || i.product_name, ', ')
                                FROM (SELECT quantity, product_name FROM public.transaction_items
                                      WHERE transaction_id = s.id ORDER BY product_name LIMIT 4) i),
                   'amount', s.final_total, 'at', s.timestamp, 'status', s.payment_method::text,
                   'is_delivery', s.is_delivery, 'rank', s.rk)
               ORDER BY s.rk DESC, s.timestamp DESC)
        FROM (
            SELECT t.*,
                   CASE WHEN v_code IS NOT NULL AND public.fn_short_id(t.id) = v_code THEN 100
                        WHEN t.id = ANY (COALESCE(v_mpesa, '{}')) THEN 95
                        WHEN v_code IS NOT NULL AND public.fn_short_id(t.id) COLLATE "C" >= v_code
                             AND public.fn_short_id(t.id) COLLATE "C" < v_code || 'G' THEN 90
                        WHEN t.customer_name ILIKE v_like THEN 55
                        ELSE 45 END AS rk
            FROM public.transactions t
            WHERE t.business_id = p_business_id AND t.deleted_at IS NULL
              AND ((v_code IS NOT NULL AND public.fn_short_id(t.id) COLLATE "C" >= v_code
                    AND public.fn_short_id(t.id) COLLATE "C" < v_code || 'G')
                   OR t.id = ANY (COALESCE(v_mpesa, '{}'))
                   OR t.customer_name ILIKE v_like
                   OR (v_num IS NOT NULL AND t.final_total = v_num))
            ORDER BY rk DESC, t.timestamp DESC
            LIMIT v_lim
        ) s), '[]'::jsonb);

    -- Deliveries made at the till: receipt number, customer, rider or a product on them.
    v_out := v_out || COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                   'kind', 'delivery', 'source', 'sale', 'id', s.id, 'ref', public.fn_receipt_number(s.id),
                   'title', COALESCE(NULLIF(s.customer_name, ''), 'Walk-in customer'),
                   'subtitle', (SELECT string_agg(trim(to_char(i.quantity, 'FM999999990.9'), '.') || COALESCE(' ' || NULLIF(p.unit, ''), '') || ' ' || i.product_name, ', ')
                                FROM (SELECT * FROM public.transaction_items WHERE transaction_id = s.id ORDER BY product_name LIMIT 4) i
                                LEFT JOIN public.products p ON p.id = i.product_id),
                   'amount', s.final_total, 'at', s.timestamp,
                   'status', COALESCE(s.delivery_status, 'assigned'), 'rider', s.rider_name, 'rank', s.rk)
               ORDER BY s.rk DESC, s.timestamp DESC)
        FROM (
            SELECT t.*,
                   CASE WHEN v_code IS NOT NULL AND public.fn_short_id(t.id) = v_code THEN 100
                        WHEN v_code IS NOT NULL AND public.fn_short_id(t.id) COLLATE "C" >= v_code
                             AND public.fn_short_id(t.id) COLLATE "C" < v_code || 'G' THEN 90
                        WHEN t.customer_name ILIKE v_like OR t.rider_name ILIKE v_like THEN 55
                        ELSE 45 END AS rk
            FROM public.transactions t
            WHERE t.business_id = p_business_id AND t.deleted_at IS NULL AND t.is_delivery
              AND ((v_code IS NOT NULL AND public.fn_short_id(t.id) COLLATE "C" >= v_code
                    AND public.fn_short_id(t.id) COLLATE "C" < v_code || 'G')
                   OR t.customer_name ILIKE v_like OR t.rider_name ILIKE v_like
                   OR (t.timestamp > now() - interval '30 days' AND EXISTS (
                         SELECT 1 FROM public.transaction_items i WHERE i.transaction_id = t.id AND i.product_name ILIKE v_like)))
            ORDER BY rk DESC, t.timestamp DESC
            LIMIT v_lim
        ) s), '[]'::jsonb);

    -- Website orders (deliveries and pick-ups): order number, customer, phone, M-Pesa code.
    v_out := v_out || COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                   'kind', CASE WHEN s.fulfilment = 'delivery' THEN 'delivery' ELSE 'order' END,
                   'source', 'online', 'id', s.id, 'ref', '#' || s.order_number,
                   'title', s.customer_name,
                   'subtitle', (SELECT string_agg(trim(to_char(i.quantity, 'FM999999990.9'), '.') || COALESCE(' ' || NULLIF(i.unit, ''), '') || ' ' || i.product_name, ', ')
                                FROM (SELECT * FROM public.online_order_items WHERE order_id = s.id LIMIT 4) i),
                   'amount', s.total, 'at', s.created_at, 'status', s.status, 'rank', s.rk)
               ORDER BY s.rk DESC, s.created_at DESC)
        FROM (
            SELECT o.*,
                   CASE WHEN v_int IS NOT NULL AND o.order_number = v_int THEN 100
                        WHEN upper(COALESCE(o.mpesa_receipt, '')) = v_up OR upper(COALESCE(o.payment_reference, '')) = v_up THEN 95
                        ELSE 50 END AS rk
            FROM public.online_orders o
            WHERE o.business_id = p_business_id
              AND ((v_int IS NOT NULL AND o.order_number = v_int)
                   OR upper(COALESCE(o.mpesa_receipt, '')) = v_up OR upper(COALESCE(o.payment_reference, '')) = v_up
                   OR o.customer_name ILIKE v_like
                   OR (length(v_q) >= 4 AND o.customer_phone LIKE v_like))
            ORDER BY rk DESC, o.created_at DESC
            LIMIT v_lim
        ) s), '[]'::jsonb);

    -- Payments received: payment reference or M-Pesa code, payer, phone, exact amount.
    v_out := v_out || COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                   'kind', 'payment', 'id', s.id, 'ref', s.reference_code,
                   'title', s.sender_name, 'subtitle', s.method || COALESCE(' · ' || NULLIF(s.description, ''), ''),
                   'amount', s.amount, 'at', s.date, 'status', s.status, 'rank', s.rk)
               ORDER BY s.rk DESC, s.date DESC)
        FROM (
            SELECT p.*,
                   CASE WHEN upper(p.reference_code) = v_up THEN 100
                        WHEN p.reference_code ILIKE v_like THEN 85
                        WHEN p.sender_name ILIKE v_like THEN 55
                        ELSE 45 END AS rk
            FROM public.payments p
            WHERE p.business_id = p_business_id
              AND (p.reference_code ILIKE v_like OR p.sender_name ILIKE v_like
                   OR (length(v_q) >= 4 AND p.sender_phone LIKE v_like)
                   OR (v_num IS NOT NULL AND p.amount = v_num))
            ORDER BY rk DESC, p.date DESC
            LIMIT v_lim
        ) s), '[]'::jsonb);

    -- Expenses and petty cash: reference, what it was for, category, supplier receipt, amount.
    v_out := v_out || COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                   'kind', 'expense', 'id', s.id, 'ref', s.ref_no,
                   'title', COALESCE(NULLIF(s.description, ''), s.category),
                   'subtitle', s.category || CASE WHEN s.source = 'petty_cash' THEN ' · Petty cash' ELSE '' END
                               || COALESCE(' · ' || NULLIF(s.payment_method, ''), ''),
                   'amount', s.amount, 'at', s.date, 'petty_cash', s.source = 'petty_cash', 'rank', s.rk)
               ORDER BY s.rk DESC, s.date DESC)
        FROM (
            SELECT e.*,
                   CASE WHEN e.ref_no = v_up THEN 100
                        WHEN e.ref_no ILIKE v_like THEN 85
                        WHEN upper(COALESCE(e.receipt_ref, '')) = v_up THEN 80
                        WHEN e.description ILIKE v_like OR e.category ILIKE v_like THEN 55
                        ELSE 45 END AS rk
            FROM public.expenses e
            WHERE e.business_id = p_business_id AND e.deleted_at IS NULL
              AND (e.ref_no ILIKE v_like OR e.description ILIKE v_like OR e.category ILIKE v_like
                   OR e.receipt_ref ILIKE v_like OR (v_num IS NOT NULL AND e.amount = v_num))
            ORDER BY rk DESC, e.date DESC
            LIMIT v_lim
        ) s), '[]'::jsonb);

    -- Stock movements: reference, the document that moved it (receipt, transfer), product.
    v_out := v_out || COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                   'kind', 'stock_move', 'id', s.id, 'ref', s.ref_no,
                   'title', s.product_name,
                   'subtitle', CASE WHEN s.quantity_adjusted > 0 THEN '+' ELSE '' END
                               || trim(to_char(s.quantity_adjusted, 'FM999999990.9'), '.') || ' · ' || s.type::text
                               || COALESCE(' · ' || NULLIF(s.reference_number, ''), ''),
                   'quantity', s.quantity_adjusted, 'at', s.timestamp, 'status', s.type::text,
                   'source_ref', s.reference_number, 'rank', s.rk)
               ORDER BY s.rk DESC, s.timestamp DESC)
        FROM (
            SELECT a.*,
                   CASE WHEN a.ref_no = v_up THEN 100
                        WHEN a.ref_no ILIKE v_like THEN 85
                        WHEN upper(COALESCE(a.reference_number, '')) = v_up THEN 80
                        WHEN a.reference_number ILIKE v_like OR (v_code IS NOT NULL AND a.reference_number ILIKE '%' || v_code || '%') THEN 70
                        ELSE 50 END AS rk
            FROM public.inventory_adjustments a
            WHERE a.business_id = p_business_id AND a.deleted_at IS NULL
              AND (a.ref_no ILIKE v_like OR a.reference_number ILIKE v_like
                   OR (v_code IS NOT NULL AND a.reference_number ILIKE '%' || v_code || '%')
                   OR a.product_name ILIKE v_like)
            ORDER BY rk DESC, a.timestamp DESC
            LIMIT v_lim
        ) s), '[]'::jsonb);

    -- Customer account entries (debts, wallet, refunds): reference, note, payment code.
    v_out := v_out || COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                   'kind', 'customer_ledger', 'id', s.id, 'ref', s.ref_no, 'customer_id', s.customer_id,
                   'title', COALESCE(s.cname, 'Customer'),
                   'subtitle', replace(s.type, '_', ' ') || COALESCE(' · ' || NULLIF(s.note, ''), ''),
                   'amount', s.amount, 'at', s.created_at, 'status', s.type, 'rank', s.rk)
               ORDER BY s.rk DESC, s.created_at DESC)
        FROM (
            SELECT l.*, c.name AS cname,
                   CASE WHEN l.ref_no = v_up THEN 100
                        WHEN l.ref_no ILIKE v_like THEN 85
                        WHEN l.reference_id ILIKE v_like THEN 70
                        ELSE 50 END AS rk
            FROM public.customer_ledger l
            LEFT JOIN public.customers c ON c.id = l.customer_id
            WHERE l.business_id = p_business_id
              AND (l.ref_no ILIKE v_like OR l.reference_id ILIKE v_like OR l.note ILIKE v_like)
            ORDER BY rk DESC, l.created_at DESC
            LIMIT v_lim
        ) s), '[]'::jsonb);

    -- Journal entries in the books: JE-120, or what the memo says.
    v_out := v_out || COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                   'kind', 'journal', 'id', s.id, 'ref', 'JE-' || s.no, 'no', s.no,
                   'title', COALESCE(NULLIF(s.memo, ''), 'Journal entry'),
                   'subtitle', COALESCE(replace(s.source_type, '_', ' '), 'manual entry')
                               || CASE WHEN s.reversed_at IS NOT NULL THEN ' · reversed' ELSE '' END,
                   'amount', (SELECT sum(debit) FROM public.acc_lines WHERE entry_id = s.id),
                   'at', s.entry_date, 'rank', s.rk)
               ORDER BY s.rk DESC, s.entry_date DESC)
        FROM (
            SELECT e.*,
                   CASE WHEN e.no = COALESCE(v_je, v_int) THEN 100 ELSE 50 END AS rk
            FROM public.acc_entries e
            WHERE e.business_id = p_business_id
              AND (e.no = COALESCE(v_je, v_int) OR (v_je IS NULL AND e.memo ILIKE v_like))
            ORDER BY rk DESC, e.entry_date DESC, e.no DESC
            LIMIT v_lim
        ) s), '[]'::jsonb);

    -- Audit log: reference, what changed, who.
    v_out := v_out || COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                   'kind', 'audit', 'id', s.id, 'ref', s.ref_no,
                   'title', COALESCE(NULLIF(s.details->>'label', ''), NULLIF(s.details->>'name', ''), s.action),
                   'subtitle', s.action || COALESCE(' · ' || NULLIF(s.table_name, ''), '')
                               || COALESCE(' · by ' || NULLIF(COALESCE(s.details->>'by', s.details->>'staff_name'), ''), ''),
                   'at', s.timestamp, 'status', s.action, 'rank', s.rk)
               ORDER BY s.rk DESC, s.timestamp DESC)
        FROM (
            SELECT a.*,
                   CASE WHEN a.ref_no = v_up THEN 100
                        WHEN a.ref_no ILIKE v_like THEN 85
                        ELSE 50 END AS rk
            FROM public.audit_logs a
            WHERE a.business_id = p_business_id
              AND (a.ref_no ILIKE v_like
                   OR (length(v_q) >= 3 AND (a.details->>'label' ILIKE v_like OR a.details->>'by' ILIKE v_like)))
            ORDER BY rk DESC, a.timestamp DESC
            LIMIT v_lim
        ) s), '[]'::jsonb);

    -- Stock transfers between branches: transfer reference.
    v_out := v_out || COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                   'kind', 'transfer', 'id', s.id, 'ref', s.reference,
                   'title', s.reference,
                   'subtitle', replace(s.status, '_', ' ') || COALESCE(' · ' || NULLIF(s.note, ''), ''),
                   'at', s.sent_at, 'status', s.status,
                   'rank', CASE WHEN upper(s.reference) = v_up THEN 100 ELSE 80 END)
               ORDER BY s.sent_at DESC)
        FROM (
            SELECT tr.* FROM public.stock_transfers tr
            WHERE (tr.from_business_id = p_business_id OR tr.to_business_id = p_business_id)
              AND tr.reference ILIKE v_like
            ORDER BY tr.sent_at DESC
            LIMIT v_lim
        ) s), '[]'::jsonb);

    RETURN v_out;
END;
$$;
ALTER FUNCTION public.global_search(uuid, text, integer) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.global_search(uuid, text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.global_search(uuid, text, integer) TO authenticated, service_role;
COMMENT ON FUNCTION public.global_search(uuid, text, integer) IS
    'One search across sales, deliveries, payments, expenses, stock, customer accounts, books, audit log and transfers. Runs as the caller: RLS decides what each person finds.';

-- ---------------------------------------------------------------- 3. deliveries, products first
-- Same rows as 20261130001, plus: till sales carry their receipt number as the reference, items
-- say the unit, and `lines` lists each product with its quantity and unit.
DROP FUNCTION IF EXISTS public.fn_delivery_rows(uuid);

CREATE FUNCTION public.fn_delivery_rows(p_business_id uuid)
RETURNS TABLE(source text, id uuid, reference text, customer_name text, customer_phone text, address text, area text,
              notes text, amount numeric, delivery_fee numeric, status text, assigned_at timestamptz,
              delivered_at timestamptz, created_at timestamptz, items text, payment text, balance_due numeric,
              rider_id uuid, is_open boolean, delivery_mode text, rider_pay numeric,
              trip_id uuid, trip_pay numeric, trip_size integer, own_pay numeric, lines jsonb)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
AS $$
    WITH r AS (
        SELECT 'online'::text AS source, o.id, '#' || o.order_number AS reference,
               o.customer_name, o.customer_phone,
               o.delivery_address AS address, o.delivery_zone AS area, o.notes,
               o.total AS amount, o.delivery_fee,
               CASE o.status
                   WHEN 'out_for_delivery' THEN 'out_for_delivery'
                   WHEN 'completed' THEN 'delivered'
                   WHEN 'cancelled' THEN 'failed'
                   ELSE 'assigned'
               END AS status,
               COALESCE(o.rider_assigned_at, o.created_at) AS assigned_at, o.delivered_at, o.created_at,
               (SELECT string_agg(i.quantity::FLOAT8 || ' ' || i.unit || ' ' || i.product_name, ', ')
                FROM public.online_order_items i WHERE i.order_id = o.id) AS items,
               'Paid online (M-Pesa)'::text AS payment, 0::numeric AS balance_due,
               o.rider_id,
               o.rider_id IS NULL AND o.status IN ('paid', 'preparing') AS is_open,
               'charged'::text AS delivery_mode, o.delivery_fee AS own_pay, o.trip_id,
               (SELECT jsonb_agg(jsonb_build_object('name', i.product_name, 'quantity', i.quantity::FLOAT8,
                                                    'unit', NULLIF(i.unit, '')) ORDER BY i.product_name)
                FROM public.online_order_items i WHERE i.order_id = o.id) AS lines
        FROM public.online_orders o
        WHERE o.business_id = p_business_id AND o.fulfilment = 'delivery'
          AND (o.rider_id IS NOT NULL OR o.status IN ('paid', 'preparing'))
        UNION ALL
        SELECT 'sale', t.id, public.fn_receipt_number(t.id), COALESCE(c.name, t.customer_name, 'Walk-in customer'), c.phone,
               -- The till saves the location as "Deliver to: <place>." at the start of the note.
               NULLIF(trim(substring(t.note FROM '^Deliver to: ([^.]*)')), ''), NULL,
               NULLIF(trim(regexp_replace(COALESCE(t.note, ''), '^Deliver to: [^.]*\.?\s*', '')), ''),
               t.final_total, t.delivery_fee,
               COALESCE(t.delivery_status, 'assigned'),
               t.timestamp, t.delivered_at, t.timestamp,
               (SELECT string_agg(i.quantity::FLOAT8 || COALESCE(' ' || NULLIF(p.unit, ''), '') || ' ' || i.product_name, ', ')
                FROM public.transaction_items i LEFT JOIN public.products p ON p.id = i.product_id
                WHERE i.transaction_id = t.id),
               t.payment_method::text,
               GREATEST(t.final_total - t.amount_paid - t.wallet_applied, 0),
               t.rider_id,
               t.rider_id IS NULL,
               t.delivery_mode, t.rider_pay, t.trip_id,
               (SELECT jsonb_agg(jsonb_build_object('name', i.product_name, 'quantity', i.quantity::FLOAT8,
                                                    'unit', NULLIF(p.unit, '')) ORDER BY i.product_name)
                FROM public.transaction_items i LEFT JOIN public.products p ON p.id = i.product_id
                WHERE i.transaction_id = t.id)
        FROM public.transactions t
        LEFT JOIN public.customers c ON c.id = t.customer_id
        WHERE t.business_id = p_business_id AND t.is_delivery AND t.deleted_at IS NULL
          AND (t.rider_id IS NOT NULL
               OR (NULLIF(trim(COALESCE(t.rider_name, '')), '') IS NULL
                   AND COALESCE(t.delivery_status, 'assigned') = 'assigned'
                   AND t.timestamp > NOW() - INTERVAL '3 days'))
    ), m AS (
        SELECT r.*, dt.rider_pay AS trip_pay,
               count(*) OVER (PARTITION BY r.trip_id)::int AS n,
               row_number() OVER (PARTITION BY r.trip_id ORDER BY r.created_at, r.id) AS k
        FROM r LEFT JOIN public.delivery_trips dt ON dt.id = r.trip_id
    )
    SELECT m.source, m.id, m.reference, m.customer_name, m.customer_phone, m.address, m.area, m.notes,
           m.amount, m.delivery_fee, m.status, m.assigned_at, m.delivered_at, m.created_at, m.items,
           m.payment, m.balance_due, m.rider_id, m.is_open, m.delivery_mode,
           CASE WHEN m.trip_id IS NULL THEN m.own_pay
                -- Equal shares; the first member takes the rounding remainder.
                ELSE round(m.trip_pay / m.n, 2)
                     + CASE WHEN m.k = 1 THEN m.trip_pay - round(m.trip_pay / m.n, 2) * m.n ELSE 0 END
           END,
           m.trip_id, m.trip_pay, CASE WHEN m.trip_id IS NULL THEN NULL ELSE m.n END, m.own_pay,
           COALESCE(m.lines, '[]'::jsonb)
    FROM m;
$$;
ALTER FUNCTION public.fn_delivery_rows(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.fn_delivery_rows(uuid) FROM PUBLIC, anon, authenticated;
