-- Regular orders: one scheduler for customers we supply on fixed days.
--
-- A regular order is one customer + one product, with a quantity for each day of the week
-- (Sun..Sat). "10 every Saturday", "10 each weekday", "20 on Mondays" and
-- "20 Mon/Tue, 23 Wed/Thu, 19 Fri" are all the same shape.
--
-- Who sets it:
--   * Staff with customers.schedules set it directly from the customer's page.
--   * A customer asks from their website account. A new order waits as 'requested'; a change to
--     a running order waits in pending_* while the old quantities keep running. Someone with
--     customers.manage (owner, admin, manager) approves or declines.
--
-- Day by day (regular_order_days): a one-day change of quantity, a skip with a message to the
-- customer, or the delivery itself.
--
-- Money and stock (CLAUDE.md money rules): marking a day delivered records ONE sale through
-- process_customer_transaction - the same function the till uses for a customer. So stock goes
-- down through the sale-item trigger, the books post from the sale, the customer's wallet is
-- used first and the rest becomes debt when "On account" is chosen, and points are earned as
-- for any sale. Nothing new moves money. Refunding that sale in full (credit note) clears the day's
-- "delivered" mark, so the day is due again and the two can't disagree.
--
-- Ringing: from the ring time (default 16:00) everyone at the branch is rung while any of
-- today's regular orders is neither delivered nor skipped, again every 2 hours until done.
-- The evening before, a notice warns when tomorrow's orders plus usual sales need more stock
-- than is on hand.
--
-- Replaces the website-only customer_order_schedules (which created unpaid online orders).
-- Its active rows move here as requests for the owner to approve; the old table is kept read-only
-- because past online orders still point at it.

-- ── Tables ────────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.regular_orders (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id      uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    customer_id      uuid NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
    product_id       uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
    -- Quantity per weekday: [1] Sunday .. [7] Saturday (EXTRACT(DOW) + 1).
    day_qty          numeric(12,3)[] NOT NULL,
    status           text NOT NULL DEFAULT 'active'
                     CHECK (status IN ('requested', 'active', 'paused', 'declined', 'ended')),
    fulfilment       text NOT NULL DEFAULT 'delivery' CHECK (fulfilment IN ('delivery', 'pickup')),
    delivery_address text,
    note             text,
    starts_on        date NOT NULL DEFAULT public.fn_nairobi_today(),
    ends_on          date,
    -- A customer's change to a running order, waiting for approval.
    pending_day_qty  numeric(12,3)[],
    pending_fulfilment text CHECK (pending_fulfilment IS NULL OR pending_fulfilment IN ('delivery', 'pickup')),
    pending_address  text,
    pending_note     text,
    pending_since    timestamptz,
    requested_by_customer boolean NOT NULL DEFAULT false,
    decision_note    text,
    decided_by       text,
    decided_at       timestamptz,
    created_by       text NOT NULL DEFAULT 'System',
    updated_by       text,
    created_at       timestamptz NOT NULL DEFAULT now(),
    updated_at       timestamptz NOT NULL DEFAULT now(),
    deleted_at       timestamptz,
    CONSTRAINT regular_orders_week CHECK (array_length(day_qty, 1) = 7 AND 0 <= ALL(day_qty)),
    CONSTRAINT regular_orders_pending_week CHECK (pending_day_qty IS NULL
        OR (array_length(pending_day_qty, 1) = 7 AND 0 <= ALL(pending_day_qty))),
    CONSTRAINT regular_orders_dates CHECK (ends_on IS NULL OR ends_on >= starts_on)
);

-- One running order per customer and product; change the quantities instead of adding another.
CREATE UNIQUE INDEX IF NOT EXISTS uq_regular_orders_customer_product
    ON public.regular_orders (customer_id, product_id)
    WHERE deleted_at IS NULL AND status IN ('requested', 'active', 'paused');
CREATE INDEX IF NOT EXISTS idx_regular_orders_business ON public.regular_orders (business_id) WHERE deleted_at IS NULL;

DROP TRIGGER IF EXISTS trg_regular_orders_updated_at ON public.regular_orders;
CREATE TRIGGER trg_regular_orders_updated_at BEFORE UPDATE ON public.regular_orders
    FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();

CREATE TABLE IF NOT EXISTS public.regular_order_days (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id      uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    regular_order_id uuid NOT NULL REFERENCES public.regular_orders(id) ON DELETE CASCADE,
    day              date NOT NULL,
    -- changed: a different quantity this day (still to deliver); skipped: not this day;
    -- delivered: done, with the sale that recorded it.
    status           text NOT NULL CHECK (status IN ('changed', 'skipped', 'delivered')),
    quantity         numeric(12,3) NOT NULL DEFAULT 0 CHECK (quantity >= 0),
    -- Deleting the sale for good removes the mark too, so the day is due again.
    transaction_id   uuid REFERENCES public.transactions(id) ON DELETE CASCADE,
    message          text,
    by_name          text,
    created_at       timestamptz NOT NULL DEFAULT now(),
    updated_at       timestamptz NOT NULL DEFAULT now(),
    UNIQUE (regular_order_id, day),
    CONSTRAINT regular_order_days_sale CHECK ((status = 'delivered') = (transaction_id IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS idx_regular_order_days_day ON public.regular_order_days (business_id, day);
CREATE INDEX IF NOT EXISTS idx_regular_order_days_tx ON public.regular_order_days (transaction_id) WHERE transaction_id IS NOT NULL;

DROP TRIGGER IF EXISTS trg_regular_order_days_updated_at ON public.regular_order_days;
CREATE TRIGGER trg_regular_order_days_updated_at BEFORE UPDATE ON public.regular_order_days
    FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();

CREATE TABLE IF NOT EXISTS public.regular_order_settings (
    business_id uuid PRIMARY KEY REFERENCES public.businesses(id) ON DELETE CASCADE,
    ring_at     time NOT NULL DEFAULT '16:00',
    updated_by  text,
    updated_at  timestamptz NOT NULL DEFAULT now()
);

-- All reads and writes go through the functions below (they check permissions and keep the
-- sale link intact), so nobody writes these tables directly.
ALTER TABLE public.regular_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.regular_order_days ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.regular_order_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.regular_orders, public.regular_order_days, public.regular_order_settings FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.regular_orders, public.regular_order_days, public.regular_order_settings TO service_role;

-- ── Refunding the sale clears "delivered" ────────────────────────────────────────────────
-- A sale is undone with a credit note (Sales Log: refund, or edit = take it all back). Once a
-- regular order's line is credited in full, that day is due again (mark it delivered again, or
-- skip it). A part refund leaves it delivered. The credit note moves the money and stock back.
CREATE OR REPLACE FUNCTION public.fn_regular_order_sale_credited() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
    v_ti public.transaction_items%ROWTYPE;
BEGIN
    IF NEW.transaction_item_id IS NULL THEN RETURN NEW; END IF;
    SELECT * INTO v_ti FROM public.transaction_items WHERE id = NEW.transaction_item_id;
    IF NOT FOUND THEN RETURN NEW; END IF;
    IF (SELECT COALESCE(SUM(l.quantity), 0) FROM public.credit_note_lines l
        WHERE l.transaction_item_id = v_ti.id) >= v_ti.quantity THEN
        DELETE FROM public.regular_order_days x
        USING public.regular_orders o
        WHERE x.transaction_id = v_ti.transaction_id AND x.regular_order_id = o.id
          AND o.product_id = v_ti.product_id;
    END IF;
    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_regular_order_sale_credited ON public.credit_note_lines;
CREATE TRIGGER trg_regular_order_sale_credited
    AFTER INSERT ON public.credit_note_lines
    FOR EACH ROW EXECUTE FUNCTION public.fn_regular_order_sale_credited();

-- ── Helpers ───────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_my_name() RETURNS text
    LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
    SELECT COALESCE((SELECT NULLIF(trim(name), '') FROM public.users WHERE id = public.fn_my_user_id()), 'Staff');
$$;
REVOKE ALL ON FUNCTION public.fn_my_name() FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.fn_qty_text(p numeric) RETURNS text
    LANGUAGE sql IMMUTABLE
AS $$
    SELECT rtrim(rtrim(to_char(round(COALESCE(p, 0), 3), 'FM999,999,990.999'), '0'), '.');
$$;

-- Every regular-order line between two days: what is planned, and what happened.
-- state: due | changed | skipped | delivered. quantity is what to deliver (or was delivered).
CREATE OR REPLACE FUNCTION public.fn_regular_order_lines(p_business_id uuid, p_from date, p_to date)
    RETURNS TABLE(order_id uuid, customer_id uuid, product_id uuid, day date,
                  planned numeric, state text, quantity numeric, transaction_id uuid, message text, by_name text)
    LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
    WITH days AS (
        SELECT d::date AS day FROM generate_series(p_from, p_to, INTERVAL '1 day') d
    )
    SELECT o.id, o.customer_id, o.product_id, dd.day,
           o.day_qty[EXTRACT(DOW FROM dd.day)::int + 1],
           COALESCE(x.status, 'due'),
           CASE WHEN x.status IN ('changed', 'delivered') THEN x.quantity
                WHEN x.status = 'skipped' THEN 0
                ELSE o.day_qty[EXTRACT(DOW FROM dd.day)::int + 1] END,
           x.transaction_id, x.message, x.by_name
    FROM public.regular_orders o
    CROSS JOIN days dd
    LEFT JOIN public.regular_order_days x ON x.regular_order_id = o.id AND x.day = dd.day
    WHERE o.business_id = p_business_id
      AND o.deleted_at IS NULL
      AND (x.status = 'delivered'
           OR (o.status = 'active'
               AND dd.day >= o.starts_on AND (o.ends_on IS NULL OR dd.day <= o.ends_on)
               AND (o.day_qty[EXTRACT(DOW FROM dd.day)::int + 1] > 0 OR x.status IS NOT NULL)));
$$;
REVOKE ALL ON FUNCTION public.fn_regular_order_lines(uuid, date, date) FROM PUBLIC, anon, authenticated;

-- Stock and usual sales of the products on regular orders. Usual sales leave out the regular
-- orders themselves, so they are not counted twice: average per day over the last 28 days
-- (or since the first sale, if sooner), and what was sold so far today.
CREATE OR REPLACE FUNCTION public.fn_regular_order_stock(p_business_id uuid)
    RETURNS TABLE(product_id uuid, name text, unit text, price numeric, stock numeric,
                  avg_other numeric, sold_today_other numeric)
    LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
    WITH today AS (SELECT public.fn_nairobi_today() AS d),
    prods AS (
        SELECT DISTINCT o.product_id FROM public.regular_orders o
        WHERE o.business_id = p_business_id AND o.deleted_at IS NULL
          AND o.status IN ('requested', 'active', 'paused')
    ),
    sold AS (
        SELECT ti.product_id,
               (t.timestamp AT TIME ZONE 'Africa/Nairobi')::date AS d,
               ti.quantity
        FROM public.transaction_items ti
        JOIN public.transactions t ON t.id = ti.transaction_id
        WHERE t.business_id = p_business_id AND t.deleted_at IS NULL
          AND ti.product_id IN (SELECT product_id FROM prods)
          AND t.timestamp >= ((SELECT d FROM today) - 28)::timestamp AT TIME ZONE 'Africa/Nairobi'
          AND NOT EXISTS (SELECT 1 FROM public.regular_order_days x WHERE x.transaction_id = t.id)
    ),
    agg AS (
        SELECT s.product_id,
               SUM(s.quantity) FILTER (WHERE s.d < (SELECT d FROM today)) AS past_qty,
               (SELECT d FROM today) - MIN(s.d) AS days_seen,
               SUM(s.quantity) FILTER (WHERE s.d = (SELECT d FROM today)) AS today_qty
        FROM sold s GROUP BY s.product_id
    )
    SELECT p.id, p.name, COALESCE(p.unit, ''), p.price, COALESCE(p.stock, 0),
           round(COALESCE(a.past_qty, 0) / GREATEST(1, LEAST(28, COALESCE(a.days_seen, 1))), 3),
           COALESCE(a.today_qty, 0)
    FROM prods pr
    JOIN public.products p ON p.id = pr.product_id
    LEFT JOIN agg a ON a.product_id = p.id;
$$;
REVOKE ALL ON FUNCTION public.fn_regular_order_stock(uuid) FROM PUBLIC, anon, authenticated;

-- Tells the customer in their website messages, if they have an account. Returns whether it went.
CREATE OR REPLACE FUNCTION public.fn_regular_order_tell(p_business_id uuid, p_customer_id uuid, p_body text)
    RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_sent integer;
BEGIN
    IF NULLIF(trim(COALESCE(p_body, '')), '') IS NULL THEN RETURN FALSE; END IF;
    INSERT INTO public.customer_messages (business_id, account_id, sender, staff_name, body)
    SELECT DISTINCT p_business_id, a.id, 'system', NULL::text, left(trim(p_body), 1000)
    FROM public.customer_accounts a
    WHERE a.customer_id = p_customer_id
       OR EXISTS (SELECT 1 FROM public.customer_account_stores s
                  WHERE s.account_id = a.id AND s.customer_id = p_customer_id);
    GET DIAGNOSTICS v_sent = ROW_COUNT;
    RETURN v_sent > 0;
END;
$$;
REVOKE ALL ON FUNCTION public.fn_regular_order_tell(uuid, uuid, text) FROM PUBLIC, anon, authenticated;

-- Words for a week of quantities: "Mon 20, Tue 20, Wed 23" (or "nothing").
CREATE OR REPLACE FUNCTION public.fn_week_text(p_qty numeric[], p_unit text)
    RETURNS text LANGUAGE sql IMMUTABLE
AS $$
    SELECT COALESCE(string_agg((ARRAY['Sun','Mon','Tue','Wed','Thu','Fri','Sat'])[i] || ' '
                               || public.fn_qty_text(p_qty[i]), ', ' ORDER BY ((i + 5) % 7)), 'nothing')
           || COALESCE(' ' || NULLIF(p_unit, ''), '')
    FROM generate_series(1, 7) i WHERE p_qty[i] > 0;
$$;

-- When nothing is left to do today, stop the "not done" alert ringing on every phone.
CREATE OR REPLACE FUNCTION public.fn_regular_orders_quiet(p_business_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM public.fn_regular_order_lines(p_business_id, public.fn_nairobi_today(), public.fn_nairobi_today()) l
                   WHERE l.state IN ('due', 'changed') AND l.quantity > 0) THEN
        UPDATE public.notifications
        SET accepted_at = NOW(), accepted_by = public.fn_my_user_id(), read_at = COALESCE(read_at, NOW())
        WHERE business_id = p_business_id AND type = 'Regular Order' AND ring
          AND accepted_at IS NULL AND deleted_at IS NULL;
    END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.fn_regular_orders_quiet(uuid) FROM PUBLIC, anon, authenticated;

-- ── Staff: read ───────────────────────────────────────────────────────────────────────────
-- Everything a screen needs: the orders (one customer's, or all), each day's lines from p_from
-- to p_to, stock and usual sales of the products, and the ring time.
CREATE OR REPLACE FUNCTION public.get_regular_orders(p_business_id uuid, p_from date, p_to date, p_customer_id uuid DEFAULT NULL)
    RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
    v_from date := COALESCE(p_from, public.fn_nairobi_today());
    v_to   date := LEAST(COALESCE(p_to, v_from + 6), v_from + 62);
BEGIN
    PERFORM public.assert_permission(p_business_id, 'customers.view', 'customers.schedules', 'pos.create_sale');

    RETURN jsonb_build_object(
        'today', public.fn_nairobi_today(),
        'ringAt', to_char(COALESCE((SELECT ring_at FROM public.regular_order_settings WHERE business_id = p_business_id), '16:00'::time), 'HH24:MI'),
        'orders', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                'id', o.id, 'customerId', o.customer_id, 'customerName', c.name, 'customerPhone', c.phone,
                'productId', o.product_id, 'productName', p.name, 'unit', COALESCE(p.unit, ''), 'price', p.price,
                'dayQty', to_jsonb(o.day_qty), 'status', o.status, 'fulfilment', o.fulfilment,
                'address', o.delivery_address, 'note', o.note, 'startsOn', o.starts_on, 'endsOn', o.ends_on,
                'pendingDayQty', to_jsonb(o.pending_day_qty), 'pendingFulfilment', o.pending_fulfilment,
                'pendingAddress', o.pending_address, 'pendingNote', o.pending_note, 'pendingSince', o.pending_since,
                'requestedByCustomer', o.requested_by_customer, 'decisionNote', o.decision_note,
                'decidedBy', o.decided_by, 'decidedAt', o.decided_at,
                'createdBy', o.created_by, 'updatedBy', o.updated_by, 'updatedAt', o.updated_at,
                'walletBalance', c.wallet_balance, 'debtBalance', c.debt_balance)
                ORDER BY c.name, p.name)
            FROM public.regular_orders o
            JOIN public.customers c ON c.id = o.customer_id
            JOIN public.products p ON p.id = o.product_id
            WHERE o.business_id = p_business_id AND o.deleted_at IS NULL
              AND (p_customer_id IS NULL OR o.customer_id = p_customer_id)
              AND (o.status IN ('requested', 'active', 'paused')
                   OR o.updated_at > NOW() - INTERVAL '30 days')), '[]'::jsonb),
        'lines', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                'orderId', l.order_id, 'customerId', l.customer_id, 'productId', l.product_id,
                'day', l.day, 'planned', l.planned, 'state', l.state, 'quantity', l.quantity,
                'transactionId', l.transaction_id, 'message', l.message, 'by', l.by_name)
                ORDER BY l.day)
            FROM public.fn_regular_order_lines(p_business_id, v_from, v_to) l
            WHERE p_customer_id IS NULL OR l.customer_id = p_customer_id), '[]'::jsonb),
        'stock', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                'productId', s.product_id, 'name', s.name, 'unit', s.unit, 'price', s.price, 'stock', s.stock,
                'avgOther', s.avg_other, 'soldTodayOther', s.sold_today_other))
            FROM public.fn_regular_order_stock(p_business_id) s), '[]'::jsonb)
    );
END;
$$;
REVOKE ALL ON FUNCTION public.get_regular_orders(uuid, date, date, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_regular_orders(uuid, date, date, uuid) TO authenticated, service_role;

-- ── Staff: set up and change ──────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.save_regular_order(
    p_business_id uuid, p_id uuid, p_customer_id uuid, p_product_id uuid, p_day_qty numeric[],
    p_fulfilment text, p_address text, p_note text, p_starts_on date, p_ends_on date, p_status text)
    RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
    v_o      public.regular_orders%ROWTYPE;
    v_id     uuid;
    v_by     text := public.fn_my_name();
    v_status text := COALESCE(NULLIF(p_status, ''), 'active');
    v_qty    numeric(12,3)[];
BEGIN
    PERFORM public.assert_permission(p_business_id, 'customers.schedules');

    IF p_day_qty IS NULL OR array_length(p_day_qty, 1) IS DISTINCT FROM 7
       OR EXISTS (SELECT 1 FROM unnest(p_day_qty) q WHERE q IS NULL OR q < 0 OR q > 100000) THEN
        RAISE EXCEPTION 'Enter a quantity (0 or more) for each day.';
    END IF;
    v_qty := ARRAY(SELECT round(q, 3) FROM unnest(p_day_qty) q);
    IF v_status NOT IN ('active', 'paused', 'ended') THEN
        RAISE EXCEPTION 'Choose running, paused or ended.';
    END IF;
    IF v_status = 'active' AND NOT EXISTS (SELECT 1 FROM unnest(v_qty) q WHERE q > 0) THEN
        RAISE EXCEPTION 'Enter a quantity for at least one day.';
    END IF;
    IF COALESCE(p_fulfilment, 'delivery') NOT IN ('delivery', 'pickup') THEN
        RAISE EXCEPTION 'Choose delivery or pickup.';
    END IF;
    IF p_ends_on IS NOT NULL AND p_ends_on < COALESCE(p_starts_on, public.fn_nairobi_today()) THEN
        RAISE EXCEPTION 'The end date is before the start date.';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.customers WHERE id = p_customer_id AND business_id = p_business_id) THEN
        RAISE EXCEPTION 'Customer not found at this branch.';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.products WHERE id = p_product_id AND business_id = p_business_id AND deleted_at IS NULL) THEN
        RAISE EXCEPTION 'Product not found at this branch.';
    END IF;

    IF p_id IS NULL THEN
        BEGIN
            INSERT INTO public.regular_orders
                (business_id, customer_id, product_id, day_qty, status, fulfilment, delivery_address, note,
                 starts_on, ends_on, created_by, updated_by)
            VALUES (p_business_id, p_customer_id, p_product_id, v_qty, v_status, COALESCE(p_fulfilment, 'delivery'),
                    NULLIF(trim(COALESCE(p_address, '')), ''), left(NULLIF(trim(COALESCE(p_note, '')), ''), 500),
                    COALESCE(p_starts_on, public.fn_nairobi_today()), p_ends_on, v_by, v_by)
            RETURNING id INTO v_id;
        EXCEPTION WHEN unique_violation THEN
            RAISE EXCEPTION 'This customer already has a regular order for this product. Change that one instead.';
        END;
        RETURN v_id;
    END IF;

    SELECT * INTO v_o FROM public.regular_orders
    WHERE id = p_id AND business_id = p_business_id AND deleted_at IS NULL FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Regular order not found.'; END IF;
    IF v_o.customer_id <> p_customer_id OR v_o.product_id <> p_product_id THEN
        RAISE EXCEPTION 'The customer and product of a regular order can''t change. End it and add a new one.';
    END IF;
    -- A customer's request or change is the owner's to decide; editing it is deciding it.
    IF (v_o.status = 'requested' OR v_o.pending_day_qty IS NOT NULL)
       AND NOT public.has_permission(p_business_id, 'customers.manage') THEN
        RAISE EXCEPTION 'The customer asked for this. It needs approval by the owner or a manager.';
    END IF;

    UPDATE public.regular_orders
    SET day_qty = v_qty, status = v_status, fulfilment = COALESCE(p_fulfilment, 'delivery'),
        delivery_address = NULLIF(trim(COALESCE(p_address, '')), ''),
        note = left(NULLIF(trim(COALESCE(p_note, '')), ''), 500),
        starts_on = COALESCE(p_starts_on, starts_on), ends_on = p_ends_on,
        pending_day_qty = NULL, pending_fulfilment = NULL, pending_address = NULL, pending_note = NULL, pending_since = NULL,
        decided_by = CASE WHEN v_o.status = 'requested' OR v_o.pending_day_qty IS NOT NULL THEN v_by ELSE decided_by END,
        decided_at = CASE WHEN v_o.status = 'requested' OR v_o.pending_day_qty IS NOT NULL THEN NOW() ELSE decided_at END,
        updated_by = v_by
    WHERE id = p_id;

    IF v_o.status = 'requested' OR v_o.pending_day_qty IS NOT NULL THEN
        PERFORM public.fn_regular_order_tell(p_business_id, v_o.customer_id,
            'Your regular order for ' || (SELECT name FROM public.products WHERE id = v_o.product_id)
            || ' is confirmed: ' || public.fn_week_text(v_qty, (SELECT unit FROM public.products WHERE id = v_o.product_id)) || '.');
    END IF;
    PERFORM public.fn_regular_orders_quiet(p_business_id);
    RETURN p_id;
END;
$$;
REVOKE ALL ON FUNCTION public.save_regular_order(uuid, uuid, uuid, uuid, numeric[], text, text, text, date, date, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_regular_order(uuid, uuid, uuid, uuid, numeric[], text, text, text, date, date, text) TO authenticated, service_role;

-- Removes an order. Past deliveries stay: they are sales.
CREATE OR REPLACE FUNCTION public.remove_regular_order(p_business_id uuid, p_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
    PERFORM public.assert_permission(p_business_id, 'customers.schedules');
    UPDATE public.regular_orders SET deleted_at = NOW(), updated_by = public.fn_my_name()
    WHERE id = p_id AND business_id = p_business_id AND deleted_at IS NULL;
    IF NOT FOUND THEN RAISE EXCEPTION 'Regular order not found.'; END IF;
    DELETE FROM public.regular_order_days WHERE regular_order_id = p_id AND status <> 'delivered';
    PERFORM public.fn_regular_orders_quiet(p_business_id);
END;
$$;
REVOKE ALL ON FUNCTION public.remove_regular_order(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.remove_regular_order(uuid, uuid) TO authenticated, service_role;

-- Approve or decline what a customer asked for (a new order, or a change to a running one).
CREATE OR REPLACE FUNCTION public.decide_regular_order(p_business_id uuid, p_id uuid, p_approve boolean, p_note text)
    RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
    v_o    public.regular_orders%ROWTYPE;
    v_by   text := public.fn_my_name();
    v_note text := left(NULLIF(trim(COALESCE(p_note, '')), ''), 500);
    v_p    public.products%ROWTYPE;
    v_text text;
BEGIN
    PERFORM public.assert_permission(p_business_id, 'customers.manage');
    SELECT * INTO v_o FROM public.regular_orders
    WHERE id = p_id AND business_id = p_business_id AND deleted_at IS NULL FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Regular order not found.'; END IF;
    SELECT * INTO v_p FROM public.products WHERE id = v_o.product_id;

    IF v_o.status = 'requested' THEN
        IF p_approve THEN
            UPDATE public.regular_orders
            SET status = 'active', starts_on = GREATEST(starts_on, public.fn_nairobi_today()),
                decision_note = v_note, decided_by = v_by, decided_at = NOW(), updated_by = v_by
            WHERE id = p_id;
            v_text := 'Your regular order for ' || v_p.name || ' is confirmed: ' || public.fn_week_text(v_o.day_qty, v_p.unit) || '.';
        ELSE
            UPDATE public.regular_orders
            SET status = 'declined', decision_note = v_note, decided_by = v_by, decided_at = NOW(), updated_by = v_by
            WHERE id = p_id;
            v_text := 'We can''t take your regular order for ' || v_p.name || ' at the moment.';
        END IF;
    ELSIF v_o.pending_day_qty IS NOT NULL THEN
        IF p_approve THEN
            UPDATE public.regular_orders
            SET day_qty = pending_day_qty,
                status = CASE WHEN 0 = ALL(pending_day_qty) THEN 'ended' ELSE status END,
                fulfilment = COALESCE(pending_fulfilment, fulfilment),
                delivery_address = COALESCE(pending_address, delivery_address),
                note = COALESCE(pending_note, note),
                pending_day_qty = NULL, pending_fulfilment = NULL, pending_address = NULL, pending_note = NULL, pending_since = NULL,
                decision_note = v_note, decided_by = v_by, decided_at = NOW(), updated_by = v_by
            WHERE id = p_id;
            v_text := CASE WHEN 0 = ALL(v_o.pending_day_qty)
                           THEN 'Your regular order for ' || v_p.name || ' has stopped, as you asked.'
                           ELSE 'Your change is confirmed. ' || v_p.name || ' from now on: ' || public.fn_week_text(v_o.pending_day_qty, v_p.unit) || '.' END;
        ELSE
            UPDATE public.regular_orders
            SET pending_day_qty = NULL, pending_fulfilment = NULL, pending_address = NULL, pending_note = NULL, pending_since = NULL,
                decision_note = v_note, decided_by = v_by, decided_at = NOW(), updated_by = v_by
            WHERE id = p_id;
            v_text := 'We can''t make the change to your regular order for ' || v_p.name || '. It stays: '
                      || public.fn_week_text(v_o.day_qty, v_p.unit) || '.';
        END IF;
    ELSE
        RAISE EXCEPTION 'There is nothing waiting for approval on this order.';
    END IF;

    PERFORM public.fn_regular_order_tell(p_business_id, v_o.customer_id, v_text || COALESCE(' ' || v_note, ''));
    PERFORM public.fn_regular_orders_quiet(p_business_id);
END;
$$;
REVOKE ALL ON FUNCTION public.decide_regular_order(uuid, uuid, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.decide_regular_order(uuid, uuid, boolean, text) TO authenticated, service_role;

-- One day only: change the quantity, skip (with a message to the customer), or put it back.
-- p_action: 'change' | 'skip' | 'reset'. Returns what to send the customer by WhatsApp/SMS
-- if they have no website account: {inApp, phone, name, text}.
CREATE OR REPLACE FUNCTION public.set_regular_order_day(
    p_business_id uuid, p_order_ids uuid[], p_day date, p_action text, p_qty numeric, p_message text)
    RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
    v_by      text := public.fn_my_name();
    v_msg     text := left(NULLIF(trim(COALESCE(p_message, '')), ''), 1000);
    v_today   date := public.fn_nairobi_today();
    v_o       public.regular_orders%ROWTYPE;
    v_cust    uuid;
    v_in_app  boolean := FALSE;
BEGIN
    PERFORM public.assert_permission(p_business_id, 'customers.schedules');
    IF p_action NOT IN ('change', 'skip', 'reset') THEN RAISE EXCEPTION 'Unknown action.'; END IF;
    IF p_day IS NULL OR p_day < v_today - 31 OR p_day > v_today + 366 THEN RAISE EXCEPTION 'Choose a day within the next year.'; END IF;
    IF p_action = 'change' AND (p_qty IS NULL OR p_qty < 0 OR p_qty > 100000) THEN RAISE EXCEPTION 'Enter a quantity of 0 or more.'; END IF;
    IF p_action = 'change' AND p_day < v_today THEN RAISE EXCEPTION 'That day has passed. Skip it or mark it delivered.'; END IF;
    IF COALESCE(array_length(p_order_ids, 1), 0) = 0 THEN RAISE EXCEPTION 'Choose an order.'; END IF;

    FOR v_o IN SELECT * FROM public.regular_orders
               WHERE id = ANY(p_order_ids) AND business_id = p_business_id AND deleted_at IS NULL FOR UPDATE
    LOOP
        IF v_cust IS NOT NULL AND v_cust <> v_o.customer_id THEN
            RAISE EXCEPTION 'Change one customer at a time.';
        END IF;
        v_cust := v_o.customer_id;
        IF EXISTS (SELECT 1 FROM public.regular_order_days WHERE regular_order_id = v_o.id AND day = p_day AND status = 'delivered') THEN
            RAISE EXCEPTION 'Already delivered that day. To undo, refund the sale in the Sales Log.';
        END IF;

        IF p_action = 'reset' THEN
            DELETE FROM public.regular_order_days WHERE regular_order_id = v_o.id AND day = p_day;
        ELSE
            INSERT INTO public.regular_order_days (business_id, regular_order_id, day, status, quantity, message, by_name)
            VALUES (p_business_id, v_o.id, p_day,
                    CASE WHEN p_action = 'skip' OR p_qty = 0 THEN 'skipped' ELSE 'changed' END,
                    CASE WHEN p_action = 'skip' THEN 0 ELSE round(p_qty, 3) END, v_msg, v_by)
            ON CONFLICT (regular_order_id, day) DO UPDATE
            SET status = EXCLUDED.status, quantity = EXCLUDED.quantity, message = EXCLUDED.message, by_name = EXCLUDED.by_name;
        END IF;
    END LOOP;
    IF v_cust IS NULL THEN RAISE EXCEPTION 'Regular order not found.'; END IF;

    IF v_msg IS NOT NULL THEN
        v_in_app := public.fn_regular_order_tell(p_business_id, v_cust, v_msg);
    END IF;
    PERFORM public.fn_regular_orders_quiet(p_business_id);
    RETURN (SELECT jsonb_build_object('inApp', v_in_app, 'phone', c.phone, 'name', c.name, 'text', v_msg)
            FROM public.customers c WHERE c.id = v_cust);
END;
$$;
REVOKE ALL ON FUNCTION public.set_regular_order_day(uuid, uuid[], date, text, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_regular_order_day(uuid, uuid[], date, text, numeric, text) TO authenticated, service_role;

-- ── Staff: delivered ──────────────────────────────────────────────────────────────────────
-- Records one customer's regular orders for a day as ONE sale, through the till's own customer
-- sale function: stock, books, wallet/debt and points follow from the sale.
-- p_lines: [{orderId, quantity}]. p_payment_method: 'Credit_Debt' (on account: wallet first, the
-- rest as debt) or a money method paid now. Safe to repeat with the same p_reference_id.
CREATE OR REPLACE FUNCTION public.deliver_regular_orders(
    p_business_id uuid, p_customer_id uuid, p_day date, p_lines jsonb, p_payment_method text,
    p_rider_name text, p_rider_pay numeric, p_reference_id text, p_note text)
    RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
    v_today    date := public.fn_nairobi_today();
    v_by       text := public.fn_my_name();
    v_c        public.customers%ROWTYPE;
    v_line     jsonb;
    v_o        public.regular_orders%ROWTYPE;
    v_p        public.products%ROWTYPE;
    v_qty      numeric(12,3);
    v_items    jsonb := '[]'::jsonb;
    v_done     jsonb := '[]'::jsonb;
    v_subtotal numeric(14,2) := 0;
    v_tax      numeric(14,2) := 0;
    v_final    numeric(14,2);
    v_delivery boolean := FALSE;
    v_tx       uuid;
    v_method   public.payment_method;
    v_ref      text := NULLIF(trim(COALESCE(p_reference_id, '')), '');
    v_note     text;
BEGIN
    PERFORM public.assert_permission(p_business_id, 'pos.create_sale');
    IF v_ref IS NULL THEN RAISE EXCEPTION 'Missing reference.'; END IF;

    -- Already recorded (a double tap or a retry after a dropped connection).
    SELECT id INTO v_tx FROM public.transactions
    WHERE business_id = p_business_id AND reference_id = v_ref AND deleted_at IS NULL;
    IF FOUND THEN RETURN v_tx; END IF;

    IF p_day IS NULL OR p_day > v_today THEN RAISE EXCEPTION 'You can only mark today or an earlier day delivered.'; END IF;
    IF p_day < v_today - 31 THEN RAISE EXCEPTION 'That day is too long ago. Record it as a normal sale.'; END IF;
    BEGIN
        v_method := p_payment_method::public.payment_method;
    EXCEPTION WHEN invalid_text_representation THEN
        RAISE EXCEPTION 'Choose how it was paid.';
    END;
    IF v_method NOT IN ('Credit_Debt', 'Cash', 'M-Pesa', 'Airtel Money', 'Card', 'Bank') THEN
        RAISE EXCEPTION 'Choose how it was paid.';
    END IF;
    IF COALESCE(p_rider_pay, 0) < 0 THEN RAISE EXCEPTION 'Rider pay can''t be negative.'; END IF;

    SELECT * INTO v_c FROM public.customers WHERE id = p_customer_id AND business_id = p_business_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Customer not found at this branch.'; END IF;
    IF jsonb_typeof(p_lines) IS DISTINCT FROM 'array' OR jsonb_array_length(p_lines) = 0 THEN
        RAISE EXCEPTION 'Nothing to deliver.';
    END IF;

    FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
        v_qty := round(COALESCE((v_line->>'quantity')::numeric, 0), 3);
        CONTINUE WHEN v_qty <= 0;
        IF v_qty > 100000 THEN RAISE EXCEPTION 'Check the quantities.'; END IF;
        SELECT * INTO v_o FROM public.regular_orders
        WHERE id = (v_line->>'orderId')::uuid AND business_id = p_business_id
          AND customer_id = p_customer_id AND deleted_at IS NULL
        FOR UPDATE;
        IF NOT FOUND THEN RAISE EXCEPTION 'Regular order not found for this customer.'; END IF;
        IF v_o.status IN ('requested', 'declined') THEN RAISE EXCEPTION 'That regular order is not approved.'; END IF;
        IF EXISTS (SELECT 1 FROM public.regular_order_days WHERE regular_order_id = v_o.id AND day = p_day AND status = 'delivered') THEN
            RAISE EXCEPTION 'Already marked delivered for that day.';
        END IF;
        SELECT * INTO v_p FROM public.products WHERE id = v_o.product_id AND deleted_at IS NULL;
        IF NOT FOUND THEN RAISE EXCEPTION 'A product on this order was removed.'; END IF;

        v_items := v_items || jsonb_build_array(jsonb_build_object(
            'product_id', v_p.id, 'product_name', v_p.name, 'unit_price', v_p.price,
            'quantity', v_qty, 'discount_percentage', 0));
        v_done := v_done || jsonb_build_array(jsonb_build_object('orderId', v_o.id, 'quantity', v_qty));
        v_subtotal := v_subtotal + round(v_p.price * v_qty, 2);
        v_delivery := v_delivery OR v_o.fulfilment = 'delivery';
    END LOOP;
    IF jsonb_array_length(v_items) = 0 THEN RAISE EXCEPTION 'Enter a quantity to deliver.'; END IF;

    -- VAT exactly as the till: only with KRA eTIMS connected and tax switched on.
    IF public.vat_allowed(p_business_id) THEN
        v_tax := round(v_subtotal * COALESCE((SELECT tax_percentage FROM public.businesses WHERE id = p_business_id), 0) / 100, 2);
    END IF;
    v_final := v_subtotal + v_tax;
    v_note := 'Regular order for ' || to_char(p_day, 'Dy DD Mon') || COALESCE('. ' || NULLIF(trim(COALESCE(p_note, '')), ''), '');

    v_tx := public.process_customer_transaction(
        p_business_id, p_customer_id, v_c.name, NULL, v_by,
        v_subtotal, 0, v_tax, v_final,
        CASE WHEN v_method = 'Credit_Debt' THEN 0 ELSE v_final END,
        v_method, NOW(), v_note,
        v_delivery, 0, NULLIF(trim(COALESCE(p_rider_name, '')), ''), v_ref, v_items,
        'free', CASE WHEN v_delivery THEN COALESCE(p_rider_pay, 0) ELSE 0 END, NULL);

    IF v_delivery THEN
        UPDATE public.transactions SET delivery_status = 'delivered', delivered_at = NOW()
        WHERE id = v_tx AND delivery_status IS DISTINCT FROM 'delivered';
    END IF;

    INSERT INTO public.regular_order_days (business_id, regular_order_id, day, status, quantity, transaction_id, by_name, message)
    SELECT p_business_id, (d->>'orderId')::uuid, p_day, 'delivered', (d->>'quantity')::numeric, v_tx, v_by, NULL
    FROM jsonb_array_elements(v_done) d
    ON CONFLICT (regular_order_id, day) DO UPDATE
    SET status = 'delivered', quantity = EXCLUDED.quantity, transaction_id = EXCLUDED.transaction_id,
        by_name = EXCLUDED.by_name, message = NULL;

    PERFORM public.fn_regular_orders_quiet(p_business_id);
    RETURN v_tx;
END;
$$;
REVOKE ALL ON FUNCTION public.deliver_regular_orders(uuid, uuid, date, jsonb, text, text, numeric, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.deliver_regular_orders(uuid, uuid, date, jsonb, text, text, numeric, text, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.save_regular_order_settings(p_business_id uuid, p_ring_at time) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
    PERFORM public.assert_permission(p_business_id, 'customers.manage');
    IF p_ring_at IS NULL OR p_ring_at < '06:00' OR p_ring_at > '22:00' THEN
        RAISE EXCEPTION 'Choose a time between 06:00 and 22:00.';
    END IF;
    INSERT INTO public.regular_order_settings (business_id, ring_at, updated_by)
    VALUES (p_business_id, p_ring_at, public.fn_my_name())
    ON CONFLICT (business_id) DO UPDATE SET ring_at = EXCLUDED.ring_at, updated_by = EXCLUDED.updated_by, updated_at = NOW();
END;
$$;
REVOKE ALL ON FUNCTION public.save_regular_order_settings(uuid, time) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_regular_order_settings(uuid, time) TO authenticated, service_role;

-- ── Customers (website account) ───────────────────────────────────────────────────────────
-- The customer record at the store the signed-in customer is using.
CREATE OR REPLACE FUNCTION public.fn_my_store_customer(OUT business_id uuid, OUT customer_id uuid, OUT account_id uuid)
    LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
    SELECT a.business_id, COALESCE(s.customer_id, a.customer_id), a.id
    FROM public.customer_accounts a
    LEFT JOIN public.customer_account_stores s ON s.account_id = a.id AND s.business_id = a.business_id
    WHERE a.id = auth.uid();
$$;
REVOKE ALL ON FUNCTION public.fn_my_store_customer() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_my_regular_orders() RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
    v_me    record;
    v_today date := public.fn_nairobi_today();
BEGIN
    SELECT * INTO v_me FROM public.fn_my_store_customer();
    IF v_me.account_id IS NULL OR v_me.customer_id IS NULL THEN
        RETURN jsonb_build_object('orders', '[]'::jsonb, 'days', '[]'::jsonb, 'today', v_today);
    END IF;

    RETURN jsonb_build_object(
        'today', v_today,
        'orders', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                'id', o.id, 'productId', o.product_id, 'productName', p.name, 'unit', COALESCE(p.unit, ''),
                'price', p.price, 'dayQty', to_jsonb(o.day_qty), 'status', o.status, 'fulfilment', o.fulfilment,
                'address', o.delivery_address, 'note', o.note,
                'pendingDayQty', to_jsonb(o.pending_day_qty), 'pendingFulfilment', o.pending_fulfilment,
                'pendingAddress', o.pending_address, 'pendingNote', o.pending_note, 'decisionNote', o.decision_note)
                ORDER BY p.name)
            FROM public.regular_orders o JOIN public.products p ON p.id = o.product_id
            WHERE o.customer_id = v_me.customer_id AND o.business_id = v_me.business_id AND o.deleted_at IS NULL
              AND (o.status IN ('requested', 'active', 'paused') OR o.decided_at > NOW() - INTERVAL '14 days')), '[]'::jsonb),
        -- The coming two weeks, plus the last week's skips and deliveries.
        'days', COALESCE((
            SELECT jsonb_agg(jsonb_build_object('orderId', l.order_id, 'day', l.day, 'state', l.state,
                                                'quantity', l.quantity, 'message', l.message) ORDER BY l.day)
            FROM public.fn_regular_order_lines(v_me.business_id, v_today - 7, v_today + 13) l
            WHERE l.customer_id = v_me.customer_id
              AND (l.day >= v_today OR l.state IN ('skipped', 'delivered'))), '[]'::jsonb)
    );
END;
$$;
REVOKE ALL ON FUNCTION public.get_my_regular_orders() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_regular_orders() TO authenticated;

-- A customer asks for a new regular order, or a change to theirs. Nothing changes until the
-- owner approves; a running order keeps its current quantities meanwhile. All zeros = stop.
CREATE OR REPLACE FUNCTION public.request_regular_order(
    p_id uuid, p_product_id uuid, p_day_qty numeric[], p_fulfilment text, p_address text, p_note text)
    RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
    v_me      record;
    v_o       public.regular_orders%ROWTYPE;
    v_p       public.products%ROWTYPE;
    v_qty     numeric(12,3)[];
    v_address text := NULLIF(trim(COALESCE(p_address, '')), '');
    v_note    text := left(NULLIF(trim(COALESCE(p_note, '')), ''), 500);
    v_id      uuid;
    v_name    text;
    v_kind    text;
BEGIN
    SELECT * INTO v_me FROM public.fn_my_store_customer();
    IF v_me.account_id IS NULL OR v_me.customer_id IS NULL THEN
        RAISE EXCEPTION 'Please finish setting up your account first.';
    END IF;
    IF p_day_qty IS NULL OR array_length(p_day_qty, 1) IS DISTINCT FROM 7
       OR EXISTS (SELECT 1 FROM unnest(p_day_qty) q WHERE q IS NULL OR q < 0 OR q > 1000) THEN
        RAISE EXCEPTION 'Please enter an amount (0 to 1000) for each day.';
    END IF;
    v_qty := ARRAY(SELECT round(q, 3) FROM unnest(p_day_qty) q);
    IF COALESCE(p_fulfilment, 'delivery') NOT IN ('delivery', 'pickup') THEN
        RAISE EXCEPTION 'Please choose delivery or pickup.';
    END IF;
    IF COALESCE(p_fulfilment, 'delivery') = 'delivery' AND v_address IS NULL THEN
        RAISE EXCEPTION 'Please enter your delivery location.';
    END IF;
    SELECT name INTO v_name FROM public.customers WHERE id = v_me.customer_id;

    IF p_id IS NULL THEN
        SELECT * INTO v_p FROM public.products
        WHERE id = p_product_id AND business_id = v_me.business_id AND deleted_at IS NULL AND show_on_website AND price > 0;
        IF NOT FOUND THEN RAISE EXCEPTION 'Please choose a product from this shop.'; END IF;
        IF NOT EXISTS (SELECT 1 FROM unnest(v_qty) q WHERE q > 0) THEN
            RAISE EXCEPTION 'Please enter an amount for at least one day.';
        END IF;
        -- Already have one for this product: this becomes a change to it.
        SELECT * INTO v_o FROM public.regular_orders
        WHERE customer_id = v_me.customer_id AND product_id = p_product_id AND deleted_at IS NULL
          AND status IN ('requested', 'active', 'paused')
        FOR UPDATE;
        IF NOT FOUND THEN
            IF (SELECT count(*) FROM public.regular_orders WHERE customer_id = v_me.customer_id
                AND deleted_at IS NULL AND status IN ('requested', 'active', 'paused')) >= 10 THEN
                RAISE EXCEPTION 'You can have up to 10 regular orders.';
            END IF;
            INSERT INTO public.regular_orders
                (business_id, customer_id, product_id, day_qty, status, fulfilment, delivery_address, note,
                 starts_on, requested_by_customer, created_by, updated_by)
            VALUES (v_me.business_id, v_me.customer_id, p_product_id, v_qty, 'requested', COALESCE(p_fulfilment, 'delivery'),
                    CASE WHEN COALESCE(p_fulfilment, 'delivery') = 'delivery' THEN v_address END, v_note,
                    public.fn_nairobi_today() + 1, TRUE, COALESCE(v_name, 'Customer'), COALESCE(v_name, 'Customer'))
            RETURNING id INTO v_id;
            v_kind := 'new';
        END IF;
    ELSE
        SELECT * INTO v_o FROM public.regular_orders
        WHERE id = p_id AND customer_id = v_me.customer_id AND deleted_at IS NULL FOR UPDATE;
        IF NOT FOUND THEN RAISE EXCEPTION 'Regular order not found.'; END IF;
    END IF;

    IF v_id IS NULL THEN
        SELECT * INTO v_p FROM public.products WHERE id = v_o.product_id;
        IF v_o.status IN ('requested', 'declined', 'ended') THEN
            -- Not running yet (or any more): the request itself is updated, and waits again.
            IF NOT EXISTS (SELECT 1 FROM unnest(v_qty) q WHERE q > 0) THEN
                RAISE EXCEPTION 'Please enter an amount for at least one day.';
            END IF;
            BEGIN
                UPDATE public.regular_orders
                SET day_qty = v_qty, status = 'requested', fulfilment = COALESCE(p_fulfilment, 'delivery'),
                    delivery_address = CASE WHEN COALESCE(p_fulfilment, 'delivery') = 'delivery' THEN v_address END,
                    note = v_note, requested_by_customer = TRUE, ends_on = NULL,
                    starts_on = GREATEST(starts_on, public.fn_nairobi_today() + 1),
                    updated_by = COALESCE(v_name, 'Customer')
                WHERE id = v_o.id;
            EXCEPTION WHEN unique_violation THEN
                RAISE EXCEPTION 'You already have a regular order for this product. Change that one instead.';
            END;
            v_kind := 'new';
        ELSE
            UPDATE public.regular_orders
            SET pending_day_qty = v_qty, pending_fulfilment = COALESCE(p_fulfilment, 'delivery'),
                pending_address = CASE WHEN COALESCE(p_fulfilment, 'delivery') = 'delivery' THEN v_address END,
                pending_note = v_note, pending_since = NOW(), updated_by = COALESCE(v_name, 'Customer')
            WHERE id = v_o.id;
            v_kind := CASE WHEN 0 = ALL(v_qty) THEN 'stop' ELSE 'change' END;
        END IF;
        v_id := v_o.id;
    END IF;

    -- Tell staff there is something to approve (not a ringing alert).
    INSERT INTO public.notifications (business_id, title, message, type, priority, action_type, action_target, payload, created_by)
    VALUES (v_me.business_id,
            CASE v_kind WHEN 'new' THEN 'Regular order request' WHEN 'stop' THEN 'Regular order stop request' ELSE 'Regular order change' END,
            COALESCE(v_name, 'A customer') || CASE v_kind WHEN 'stop' THEN ' wants to stop ' ELSE ' asks for ' END
            || v_p.name || CASE WHEN v_kind = 'stop' THEN '' ELSE ': ' || public.fn_week_text(v_qty, v_p.unit) END
            || '. Approve it in Regular Orders.',
            'Regular Order', 'high', 'navigate', 'regular-orders',
            jsonb_build_object('regularOrderId', v_id, 'kind', v_kind), 'system');
    RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.request_regular_order(uuid, uuid, numeric[], text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_regular_order(uuid, uuid, numeric[], text, text, text) TO authenticated;

-- A customer takes back what they asked for: a waiting change is dropped, a request not yet
-- approved is removed.
CREATE OR REPLACE FUNCTION public.withdraw_my_regular_order_request(p_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_me record;
BEGIN
    SELECT * INTO v_me FROM public.fn_my_store_customer();
    IF v_me.customer_id IS NULL THEN RAISE EXCEPTION 'Please finish setting up your account first.'; END IF;

    UPDATE public.regular_orders
    SET pending_day_qty = NULL, pending_fulfilment = NULL, pending_address = NULL, pending_note = NULL, pending_since = NULL
    WHERE id = p_id AND customer_id = v_me.customer_id AND deleted_at IS NULL AND pending_day_qty IS NOT NULL;
    IF FOUND THEN RETURN; END IF;

    UPDATE public.regular_orders SET deleted_at = NOW()
    WHERE id = p_id AND customer_id = v_me.customer_id AND deleted_at IS NULL AND status IN ('requested', 'declined', 'ended');
    IF NOT FOUND THEN
        RAISE EXCEPTION 'This order is running. To stop it, set every day to 0 and send - the shop will confirm.';
    END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.withdraw_my_regular_order_request(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.withdraw_my_regular_order_request(uuid) TO authenticated;

-- ── Ringing and tomorrow's stock ──────────────────────────────────────────────────────────
-- Runs every 10 minutes. From each branch's ring time:
--  * rings everyone while any of today's regular orders is neither delivered nor skipped,
--    again 2 hours after the last ring was accepted if still not done;
--  * once a day, a notice when tomorrow's regular orders plus usual sales need more of a
--    product than is in stock.
CREATE OR REPLACE FUNCTION public.ring_regular_orders() RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
    v_today   date := public.fn_nairobi_today();
    v_now     time := (NOW() AT TIME ZONE 'Africa/Nairobi')::time;
    v_b       uuid;
    v_left    integer;
    v_who     text;
    v_short   text;
    v_rung    integer := 0;
BEGIN
    FOR v_b IN
        SELECT DISTINCT o.business_id FROM public.regular_orders o
        WHERE o.deleted_at IS NULL AND o.status = 'active'
          AND v_now >= COALESCE((SELECT s.ring_at FROM public.regular_order_settings s WHERE s.business_id = o.business_id), '16:00'::time)
    LOOP
        SELECT count(DISTINCT l.customer_id),
               string_agg(DISTINCT c.name, ', ')
        INTO v_left, v_who
        FROM public.fn_regular_order_lines(v_b, v_today, v_today) l
        JOIN public.customers c ON c.id = l.customer_id
        WHERE l.state IN ('due', 'changed') AND l.quantity > 0;

        IF v_left > 0 AND NOT EXISTS (
            SELECT 1 FROM public.notifications n
            WHERE n.business_id = v_b AND n.type = 'Regular Order' AND n.ring AND n.deleted_at IS NULL
              AND n.payload->>'day' = v_today::text
              AND (n.accepted_at IS NULL OR n.accepted_at > NOW() - INTERVAL '2 hours'))
        THEN
            INSERT INTO public.notifications
                (business_id, title, message, type, priority, action_type, action_target, payload, created_by, ring)
            VALUES (v_b, 'Regular orders not done',
                    v_left || CASE WHEN v_left = 1 THEN ' customer is' ELSE ' customers are' END
                    || ' still waiting today: ' || left(v_who, 300) || '. Mark each delivered or skipped.',
                    'Regular Order', 'critical', 'navigate', 'regular-orders',
                    jsonb_build_object('day', v_today, 'kind', 'not_done'), 'system', TRUE);
            v_rung := v_rung + 1;
        END IF;

        -- Tomorrow: once a day.
        IF NOT EXISTS (SELECT 1 FROM public.notifications n
                       WHERE n.business_id = v_b AND n.type = 'Regular Order'
                         AND n.payload->>'kind' = 'short' AND n.payload->>'day' = (v_today + 1)::text) THEN
            SELECT string_agg(s.name || ': need about ' || public.fn_qty_text(ceil(need)) || COALESCE(' ' || NULLIF(s.unit, ''), '')
                              || ', have ' || public.fn_qty_text(s.stock) || '. Order about '
                              || public.fn_qty_text(ceil(need - s.stock)) || ' more', '; ')
            INTO v_short
            FROM (
                SELECT st.*,
                       COALESCE((SELECT SUM(l.quantity) FROM public.fn_regular_order_lines(v_b, v_today, v_today + 1) l
                                 WHERE l.product_id = st.product_id AND l.state IN ('due', 'changed')), 0)
                       + GREATEST(st.avg_other - st.sold_today_other, 0) + st.avg_other AS need
                FROM public.fn_regular_order_stock(v_b) st
            ) s
            WHERE s.need > s.stock
              AND EXISTS (SELECT 1 FROM public.fn_regular_order_lines(v_b, v_today + 1, v_today + 1) l
                          WHERE l.product_id = s.product_id AND l.state IN ('due', 'changed') AND l.quantity > 0);
            IF v_short IS NOT NULL THEN
                INSERT INTO public.notifications
                    (business_id, title, message, type, priority, action_type, action_target, payload, created_by)
                VALUES (v_b, 'Not enough for tomorrow', left('Tomorrow''s regular orders and usual sales. ' || v_short || '.', 1000),
                        'Regular Order', 'high', 'navigate', 'regular-orders',
                        jsonb_build_object('day', v_today + 1, 'kind', 'short'), 'system');
            END IF;
        END IF;
    END LOOP;
    RETURN v_rung;
END;
$$;
REVOKE ALL ON FUNCTION public.ring_regular_orders() FROM PUBLIC, anon, authenticated;

DO $do$ BEGIN
    IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
        PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'ring-regular-orders';
        PERFORM cron.schedule('ring-regular-orders', '*/10 * * * *', $job$SELECT public.ring_regular_orders()$job$);
    END IF;
END $do$;

-- ── The old website schedules become requests here ────────────────────────────────────────
INSERT INTO public.regular_orders
    (business_id, customer_id, product_id, day_qty, status, fulfilment, delivery_address, note,
     starts_on, requested_by_customer, created_by, updated_by)
SELECT s.business_id, COALESCE(cas.customer_id, a.customer_id), p.id,
       ARRAY(SELECT CASE WHEN (d - 1) = ANY(s.days_of_week) THEN round((e->>'quantity')::numeric, 3) ELSE 0 END
             FROM generate_series(1, 7) d),
       'requested', s.fulfilment, s.delivery_address, s.notes,
       public.fn_nairobi_today(), TRUE, a.name, a.name
FROM public.customer_order_schedules s
JOIN public.customer_accounts a ON a.id = s.account_id
LEFT JOIN public.customer_account_stores cas ON cas.account_id = a.id AND cas.business_id = s.business_id
CROSS JOIN LATERAL jsonb_array_elements(s.items) e
JOIN public.products p ON p.id = (e->>'productId')::uuid AND p.business_id = s.business_id AND p.deleted_at IS NULL
WHERE s.active AND COALESCE(cas.customer_id, a.customer_id) IS NOT NULL
  AND COALESCE((e->>'quantity')::numeric, 0) > 0
ON CONFLICT DO NOTHING;

UPDATE public.customer_order_schedules SET active = FALSE WHERE active;
COMMENT ON TABLE public.customer_order_schedules IS
    'Replaced by regular_orders (20261130005). Kept read-only: past online_orders.schedule_id point here.';

DROP FUNCTION IF EXISTS public.save_order_schedule(uuid, jsonb, integer[], text, text, text, boolean);
DROP FUNCTION IF EXISTS public.delete_order_schedule(uuid);

-- The nightly job no longer turns schedules into unpaid online orders.
CREATE OR REPLACE FUNCTION public.run_customer_portal_daily() RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
    UPDATE public.online_orders
    SET status = 'cancelled'
    WHERE status IN ('pending_payment', 'payment_failed')
      AND created_at < NOW() - INTERVAL '48 hours'
      AND NOT EXISTS (
          SELECT 1 FROM public.mpesa_transactions m
          WHERE m.online_order_id = online_orders.id AND m.status = 'Pending'
            AND m.created_at > NOW() - INTERVAL '1 hour'
      );

    DELETE FROM public.assistant_usage WHERE window_start < NOW() - INTERVAL '3 days';
    RETURN 0;
END;
$$;
