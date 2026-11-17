-- Ask a supplier for stock, straight from a low-stock alert.
--
-- When a product runs low and has a preferred supplier, the low-stock notification carries
-- that supplier, and staff can send a request ("We need milk tomorrow, 200 L") with a note.
-- The request goes to the one supplier chosen (the preferred one unless another is picked),
-- never to every supplier of the product. It rings on the phone of everyone at that supplier
-- who has the app (Supplier
-- sign-in), until they accept the ring. In their portal they then accept (with the day they
-- will deliver) or decline, with a note of their own. The person who asked is told each step:
-- seen, accepted or declined. Nobody accepting the ring in 15 minutes reports as usual
-- ("... hasn't accepted").
--
-- A supplier without the app still gets the request recorded; the app then offers WhatsApp
-- or SMS with the same words.

-- ── Table ────────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.supplier_stock_requests (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id    uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    supplier_id    uuid NOT NULL REFERENCES public.suppliers(id) ON DELETE CASCADE,
    product_id     uuid REFERENCES public.products(id) ON DELETE SET NULL,
    product_name   text NOT NULL,
    unit           text,
    quantity       numeric(14,3) NOT NULL CHECK (quantity > 0),
    needed_by      date,
    note           text CHECK (note IS NULL OR char_length(note) <= 500),
    status         text NOT NULL DEFAULT 'sent'
                   CHECK (status IN ('sent', 'seen', 'accepted', 'declined', 'cancelled')),
    in_app         boolean NOT NULL DEFAULT false,
    asked_by       uuid REFERENCES public.users(id) ON DELETE SET NULL,
    asked_by_name  text,
    seen_at        timestamptz,
    responded_at   timestamptz,
    responded_by   uuid REFERENCES public.users(id) ON DELETE SET NULL,
    delivery_date  date,
    response_note  text CHECK (response_note IS NULL OR char_length(response_note) <= 500),
    created_at     timestamptz NOT NULL DEFAULT now(),
    updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_supplier_stock_requests_business
    ON public.supplier_stock_requests (business_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_supplier_stock_requests_supplier
    ON public.supplier_stock_requests (supplier_id, created_at DESC);

ALTER TABLE public.supplier_stock_requests ENABLE ROW LEVEL SECURITY;
-- Staff read their business's requests; every change goes through the functions below.
CREATE POLICY pol_supplier_stock_requests_select ON public.supplier_stock_requests FOR SELECT
    USING (business_id = ANY (public.get_user_business_ids())
           AND public.has_permission(business_id, 'purchases.view', 'purchases.create', 'purchases.request_quote'));
GRANT SELECT ON public.supplier_stock_requests TO authenticated;
GRANT ALL ON public.supplier_stock_requests TO service_role;

-- ── Low-stock alert: say who supplies it ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_check_low_stock() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
AS $$
DECLARE
    v_sup     public.suppliers%ROWTYPE;
    v_level   numeric := COALESCE(NEW.reorder_level, NEW.min_stock);
    v_suggest numeric;
BEGIN
    -- Only notify when the threshold is newly crossed
    IF NEW.stock <= NEW.min_stock
       AND (OLD.stock IS NULL OR OLD.stock > NEW.min_stock)
    THEN
        IF NEW.preferred_supplier_id IS NOT NULL THEN
            SELECT * INTO v_sup FROM public.suppliers
            WHERE id = NEW.preferred_supplier_id AND deleted_at IS NULL;
        END IF;
        v_suggest := COALESCE(NEW.reorder_qty, NULLIF(GREATEST(ceil(v_level * 2 - NEW.stock), 0), 0));

        INSERT INTO public.notifications
            (business_id, role, title, message, type, priority,
             action_type, action_target, payload, status)
        VALUES (
            NEW.business_id,
            'Owner',
            CASE
                WHEN NEW.stock = 0 THEN '🚨 Out of Stock: ' || NEW.name
                ELSE '⚠️ Low Stock: ' || NEW.name
            END,
            CASE
                WHEN NEW.stock = 0
                    THEN '"' || NEW.name || '" is completely out of stock. Reorder immediately!'
                ELSE '"' || NEW.name || '" has only ' || NEW.stock || ' ' || NEW.unit ||
                     ' remaining (min: ' || NEW.min_stock || '). Reorder soon.'
            END,
            CASE WHEN NEW.stock = 0 THEN 'Out Of Stock' ELSE 'Stock Almost Finished' END,
            CASE WHEN NEW.stock = 0 THEN 'critical'::public.notification_priority
                 ELSE 'high'::public.notification_priority END,
            'navigate',
            'inventory',
            jsonb_strip_nulls(jsonb_build_object(
                'productId',     NEW.id,
                'productName',   NEW.name,
                'stock',         NEW.stock,
                'minStock',      NEW.min_stock,
                'unit',          NEW.unit,
                'suggestedQty',  v_suggest,
                'supplierId',    v_sup.id,
                'supplierName',  COALESCE(NULLIF(v_sup.company, ''), v_sup.name),
                'supplierInApp', CASE WHEN v_sup.id IS NULL THEN NULL ELSE EXISTS (
                                     SELECT 1 FROM public.supplier_accounts a
                                     WHERE a.supplier_id = v_sup.id AND a.status = 'active') END
            )),
            'delivered'
        );
    END IF;

    RETURN NEW;
END;
$$;

-- ── Staff: send a request ────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.ask_supplier_for_stock(
    p_product_id  uuid,
    p_quantity    numeric,
    p_needed_by   date DEFAULT NULL,
    p_note        text DEFAULT NULL,
    p_supplier_id uuid DEFAULT NULL
) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
AS $$
DECLARE
    v_p     public.products%ROWTYPE;
    v_s     public.suppliers%ROWTYPE;
    v_me    uuid := (SELECT u.id FROM public.users u WHERE u.auth_user_id = auth.uid());
    v_name  text := (SELECT u.name FROM public.users u WHERE u.auth_user_id = auth.uid());
    v_biz   text;
    v_note  text := left(NULLIF(btrim(COALESCE(p_note, '')), ''), 500);
    v_id    uuid;
    v_sent  integer := 0;
    v_when  text;
    v_text  text;
BEGIN
    SELECT * INTO v_p FROM public.products WHERE id = p_product_id AND deleted_at IS NULL;
    IF NOT FOUND THEN RAISE EXCEPTION 'That product was not found.'; END IF;
    PERFORM public.assert_business_member(v_p.business_id);
    PERFORM public.assert_permission(v_p.business_id, 'purchases.create', 'purchases.request_quote');

    SELECT * INTO v_s FROM public.suppliers
    WHERE id = COALESCE(p_supplier_id, v_p.preferred_supplier_id)
      AND business_id = v_p.business_id AND deleted_at IS NULL;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Choose which supplier to ask.';
    END IF;
    IF p_quantity IS NULL OR p_quantity <= 0 OR p_quantity > 100000000 THEN
        RAISE EXCEPTION 'Type how much you need.';
    END IF;
    IF p_needed_by IS NOT NULL AND p_needed_by < (NOW() AT TIME ZONE 'Africa/Nairobi')::date THEN
        RAISE EXCEPTION 'The day you need it can''t be in the past.';
    END IF;

    SELECT name INTO v_biz FROM public.businesses WHERE id = v_p.business_id;

    INSERT INTO public.supplier_stock_requests
        (business_id, supplier_id, product_id, product_name, unit, quantity, needed_by, note, asked_by, asked_by_name)
    VALUES (v_p.business_id, v_s.id, v_p.id, v_p.name, v_p.unit, round(p_quantity, 3), p_needed_by, v_note, v_me, v_name)
    RETURNING id INTO v_id;

    v_when := CASE
        WHEN p_needed_by IS NULL THEN ''
        WHEN p_needed_by = (NOW() AT TIME ZONE 'Africa/Nairobi')::date THEN ' today'
        WHEN p_needed_by = (NOW() AT TIME ZONE 'Africa/Nairobi')::date + 1 THEN ' tomorrow'
        ELSE ' by ' || to_char(p_needed_by, 'Dy DD Mon') END;
    v_text := v_biz || ' needs ' || trim(to_char(round(p_quantity, 3), 'FM999,999,990.999'), '.') || ' '
              || COALESCE(v_p.unit, '') || ' of ' || v_p.name || v_when || '.'
              || COALESCE(' Note: ' || v_note, '');

    -- Rings on each person at the supplier who has the app.
    INSERT INTO public.notifications
        (business_id, user_id, title, message, type, priority, action_type, action_target, payload, created_by, ring)
    SELECT a.business_id, a.user_id, 'Stock request', v_text, 'Supplier', 'critical', 'navigate', 'supplier-portal',
           jsonb_build_object('stockRequestId', v_id), 'system', TRUE
    FROM public.supplier_accounts a
    WHERE a.business_id = v_p.business_id AND a.supplier_id = v_s.id AND a.status = 'active';
    GET DIAGNOSTICS v_sent = ROW_COUNT;

    UPDATE public.supplier_stock_requests SET in_app = v_sent > 0 WHERE id = v_id;

    RETURN jsonb_build_object(
        'id', v_id,
        'inApp', v_sent > 0,
        'people', v_sent,
        'supplierName', COALESCE(NULLIF(v_s.company, ''), v_s.name),
        'phone', v_s.phone,
        'email', v_s.email,
        'message', 'Hello ' || v_s.name || ', ' || v_text);
END;
$$;

REVOKE ALL ON FUNCTION public.ask_supplier_for_stock(uuid, numeric, date, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ask_supplier_for_stock(uuid, numeric, date, text, uuid) TO authenticated, service_role;

-- Staff: who to ask. One supplier is chosen and only they get it, even when several sell the
-- product. Listed: the preferred supplier first, then those who delivered it before (most
-- often first), then everyone else.
CREATE OR REPLACE FUNCTION public.stock_request_suppliers(p_product_id uuid) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
AS $$
DECLARE v_p public.products%ROWTYPE;
BEGIN
    SELECT * INTO v_p FROM public.products WHERE id = p_product_id AND deleted_at IS NULL;
    IF NOT FOUND THEN RAISE EXCEPTION 'That product was not found.'; END IF;
    PERFORM public.assert_business_member(v_p.business_id);
    PERFORM public.assert_permission(v_p.business_id, 'purchases.create', 'purchases.request_quote');
    RETURN COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
            'id', s.id, 'name', COALESCE(NULLIF(s.company, ''), s.name), 'contact', s.name, 'phone', s.phone,
            'preferred', s.id = v_p.preferred_supplier_id,
            'inApp', EXISTS (SELECT 1 FROM public.supplier_accounts a WHERE a.supplier_id = s.id AND a.status = 'active'),
            'times', COALESCE(h.times, 0), 'lastDate', h.last_date, 'lastPrice', h.last_price)
            ORDER BY (s.id = v_p.preferred_supplier_id) DESC, COALESCE(h.times, 0) DESC, h.last_date DESC NULLS LAST,
                     COALESCE(NULLIF(s.company, ''), s.name))
        FROM public.suppliers s
        LEFT JOIN LATERAL (
            SELECT count(DISTINCT pu.id) AS times, max(COALESCE(pu.ordered_at, pu.date))::date AS last_date,
                   (array_agg(i.price ORDER BY COALESCE(pu.ordered_at, pu.date) DESC))[1] AS last_price
            FROM public.purchase_items i
            JOIN public.purchases pu ON pu.id = i.purchase_id
            WHERE i.product_id = v_p.id AND pu.supplier_id = s.id AND pu.status IN ('Ordered', 'Part received', 'Received')
        ) h ON TRUE
        WHERE s.business_id = v_p.business_id AND s.deleted_at IS NULL
    ), '[]'::jsonb);
END;
$$;

REVOKE ALL ON FUNCTION public.stock_request_suppliers(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.stock_request_suppliers(uuid) TO authenticated, service_role;

-- Staff: take a request back (the supplier sees it as cancelled).
CREATE OR REPLACE FUNCTION public.cancel_supplier_stock_request(p_request_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
AS $$
DECLARE v_r public.supplier_stock_requests%ROWTYPE;
BEGIN
    SELECT * INTO v_r FROM public.supplier_stock_requests WHERE id = p_request_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'That request was not found.'; END IF;
    PERFORM public.assert_business_member(v_r.business_id);
    PERFORM public.assert_permission(v_r.business_id, 'purchases.create', 'purchases.request_quote');
    IF v_r.status = 'cancelled' THEN RETURN; END IF;

    UPDATE public.supplier_stock_requests SET status = 'cancelled', updated_at = NOW() WHERE id = v_r.id;
    -- Stop it ringing.
    UPDATE public.notifications SET accepted_at = COALESCE(accepted_at, NOW()), escalated_at = COALESCE(escalated_at, NOW())
    WHERE business_id = v_r.business_id AND type = 'Supplier' AND payload->>'stockRequestId' = v_r.id::text;
    PERFORM public.fn_notify_supplier(v_r.business_id, v_r.supplier_id, 'Request cancelled',
        (SELECT name FROM public.businesses WHERE id = v_r.business_id) || ' no longer needs the '
            || v_r.product_name || ' they asked for.',
        jsonb_build_object('stockRequestId', v_r.id));
END;
$$;

REVOKE ALL ON FUNCTION public.cancel_supplier_stock_request(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cancel_supplier_stock_request(uuid) TO authenticated, service_role;

-- Staff: the latest requests, newest first (for the low-stock alert and Buying).
CREATE OR REPLACE FUNCTION public.supplier_stock_requests_list(p_business_id uuid, p_product_id uuid DEFAULT NULL)
    RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
AS $$
BEGIN
    PERFORM public.assert_business_member(p_business_id);
    PERFORM public.assert_permission(p_business_id, 'purchases.view', 'purchases.create', 'purchases.request_quote');
    RETURN COALESCE((
        SELECT jsonb_agg(x ORDER BY (x->>'createdAt') DESC)
        FROM (
            SELECT jsonb_build_object(
                'id', r.id, 'productId', r.product_id, 'productName', r.product_name, 'unit', r.unit,
                'quantity', r.quantity, 'neededBy', r.needed_by, 'note', r.note, 'status', r.status,
                'inApp', r.in_app, 'askedBy', r.asked_by_name, 'createdAt', r.created_at,
                'seenAt', r.seen_at, 'respondedAt', r.responded_at, 'deliveryDate', r.delivery_date,
                'responseNote', r.response_note, 'respondedBy', (SELECT u.name FROM public.users u WHERE u.id = r.responded_by),
                'supplierId', r.supplier_id,
                'supplierName', (SELECT COALESCE(NULLIF(s.company, ''), s.name) FROM public.suppliers s WHERE s.id = r.supplier_id),
                'supplierPhone', (SELECT s.phone FROM public.suppliers s WHERE s.id = r.supplier_id)) AS x
            FROM public.supplier_stock_requests r
            WHERE r.business_id = p_business_id
              AND (p_product_id IS NULL OR r.product_id = p_product_id)
            ORDER BY r.created_at DESC
            LIMIT 100
        ) q
    ), '[]'::jsonb);
END;
$$;

REVOKE ALL ON FUNCTION public.supplier_stock_requests_list(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.supplier_stock_requests_list(uuid, uuid) TO authenticated, service_role;

-- ── Supplier: accept or decline ──────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.supplier_portal_answer_stock_request(
    p_request_id    uuid,
    p_accept        boolean,
    p_delivery_date date DEFAULT NULL,
    p_note          text DEFAULT NULL
) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
AS $$
DECLARE
    v_r    public.supplier_stock_requests%ROWTYPE;
    v_me   uuid := (SELECT u.id FROM public.users u WHERE u.auth_user_id = auth.uid());
    v_who  text;
    v_note text := left(NULLIF(btrim(COALESCE(p_note, '')), ''), 500);
    v_msg  text;
BEGIN
    SELECT * INTO v_r FROM public.supplier_stock_requests WHERE id = p_request_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'That request was not found.'; END IF;
    IF public.assert_supplier(v_r.business_id, 'supplier_portal.stock_requests') IS DISTINCT FROM v_r.supplier_id THEN
        RAISE EXCEPTION 'That request was not found.';
    END IF;
    IF v_r.status = 'cancelled' THEN
        RAISE EXCEPTION 'The business cancelled this request.';
    END IF;
    IF p_accept AND p_delivery_date IS NULL THEN
        RAISE EXCEPTION 'Choose the day you will deliver.';
    END IF;
    IF p_accept AND p_delivery_date < (NOW() AT TIME ZONE 'Africa/Nairobi')::date THEN
        RAISE EXCEPTION 'Choose the day you will deliver (today or later).';
    END IF;
    IF NOT p_accept AND v_note IS NULL THEN
        RAISE EXCEPTION 'Say why you can''t, so they can find it elsewhere.';
    END IF;

    UPDATE public.supplier_stock_requests
    SET status = CASE WHEN p_accept THEN 'accepted' ELSE 'declined' END,
        seen_at = COALESCE(seen_at, NOW()), responded_at = NOW(), responded_by = v_me,
        delivery_date = CASE WHEN p_accept THEN p_delivery_date END,
        response_note = v_note, updated_at = NOW()
    WHERE id = v_r.id;

    -- Answering also stops it ringing for the others at the supplier.
    UPDATE public.notifications SET accepted_at = NOW(), accepted_by = v_me
    WHERE business_id = v_r.business_id AND type = 'Supplier' AND accepted_at IS NULL
      AND payload->>'stockRequestId' = v_r.id::text;

    SELECT COALESCE(NULLIF(s.company, ''), s.name) INTO v_who FROM public.suppliers s WHERE s.id = v_r.supplier_id;
    v_msg := v_who || CASE WHEN p_accept
                 THEN ' will deliver ' || trim(to_char(v_r.quantity, 'FM999,999,990.999'), '.') || ' ' || COALESCE(v_r.unit, '')
                      || ' of ' || v_r.product_name || ' on ' || to_char(p_delivery_date, 'Dy DD Mon')
                 ELSE ' can''t deliver the ' || v_r.product_name || ' you asked for' END
             || COALESCE(': ' || v_note, '') || '.';
    PERFORM public.fn_buying_notify(v_r.business_id, v_r.asked_by, 'Purchase',
        CASE WHEN p_accept THEN 'Supplier accepted your request' ELSE 'Supplier declined your request' END,
        v_msg, 'buying', jsonb_build_object('stockRequestId', v_r.id, 'productId', v_r.product_id));
END;
$$;

REVOKE ALL ON FUNCTION public.supplier_portal_answer_stock_request(uuid, boolean, date, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.supplier_portal_answer_stock_request(uuid, boolean, date, text) TO authenticated, service_role;

-- When someone at the supplier accepts the ring, the asker learns it was seen.
CREATE OR REPLACE FUNCTION public.fn_stock_request_seen() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
AS $$
DECLARE
    v_r   public.supplier_stock_requests%ROWTYPE;
    v_who text;
BEGIN
    IF NEW.type <> 'Supplier' OR NOT (NEW.payload ? 'stockRequestId') OR NEW.accepted_by IS NULL THEN
        RETURN NULL;
    END IF;
    UPDATE public.supplier_stock_requests
    SET status = 'seen', seen_at = NOW(), updated_at = NOW()
    WHERE id = (NEW.payload->>'stockRequestId')::uuid AND status = 'sent'
    RETURNING * INTO v_r;
    IF v_r.id IS NULL THEN RETURN NULL; END IF;   -- already seen or answered

    SELECT name INTO v_who FROM public.users WHERE id = NEW.accepted_by;
    PERFORM public.fn_buying_notify(v_r.business_id, v_r.asked_by, 'Purchase', 'Supplier saw your request',
        COALESCE(v_who, 'Someone') || ' at ' || (SELECT COALESCE(NULLIF(s.company, ''), s.name) FROM public.suppliers s WHERE s.id = v_r.supplier_id)
            || ' saw your request for ' || v_r.product_name || '. You''ll be told when they answer.',
        'buying', jsonb_build_object('stockRequestId', v_r.id, 'productId', v_r.product_id));
    RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_stock_request_seen ON public.notifications;
CREATE TRIGGER trg_stock_request_seen
    AFTER UPDATE OF accepted_at ON public.notifications
    FOR EACH ROW WHEN (OLD.accepted_at IS NULL AND NEW.accepted_at IS NOT NULL)
    EXECUTE FUNCTION public.fn_stock_request_seen();

-- ── Ringing alerts reach people at a supplier too ────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_my_ringing_alerts(p_business_id uuid)
    RETURNS TABLE(id uuid, title text, message text, type text, action_target text, created_at timestamp with time zone)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
AS $$
    SELECT n.id, n.title, n.message, n.type, n.action_target, n.created_at
    FROM public.notifications n
    WHERE n.business_id = p_business_id
      AND (p_business_id = ANY(public.get_user_business_ids())
           OR (n.type = 'Supplier' AND public.fn_my_supplier_id(p_business_id) IS NOT NULL))
      AND n.ring AND n.accepted_at IS NULL AND n.deleted_at IS NULL
      AND n.created_at > NOW() - INTERVAL '12 hours'
      AND public.fn_is_alert_recipient(n, (SELECT u.id FROM public.users u WHERE u.auth_user_id = auth.uid()))
    ORDER BY n.created_at;
$$;

CREATE OR REPLACE FUNCTION public.accept_alert(p_notification_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
AS $$
DECLARE
    v_n public.notifications%ROWTYPE;
    v_by TEXT;
    v_me UUID := (SELECT u.id FROM public.users u WHERE u.auth_user_id = auth.uid());
BEGIN
    SELECT * INTO v_n FROM public.notifications WHERE id = p_notification_id AND deleted_at IS NULL FOR UPDATE;
    IF NOT FOUND OR NOT (v_n.business_id = ANY(public.get_user_business_ids())
                         OR (v_n.type = 'Supplier' AND v_n.user_id = v_me
                             AND public.fn_my_supplier_id(v_n.business_id) IS NOT NULL)) THEN
        RAISE EXCEPTION 'That alert was not found.';
    END IF;
    IF v_me IS NULL OR NOT public.fn_is_alert_recipient(v_n, v_me) THEN
        RAISE EXCEPTION 'That alert was not sent to you.' USING ERRCODE = '42501';
    END IF;

    IF v_n.accepted_at IS NULL THEN
        UPDATE public.notifications
        SET accepted_at = NOW(), accepted_by = v_me,
            read_at = COALESCE(read_at, NOW()), clicked_at = COALESCE(clicked_at, NOW())
        WHERE id = v_n.id;
        RETURN jsonb_build_object('accepted', TRUE, 'alreadyAcceptedBy', NULL,
                                  'actionTarget', v_n.action_target, 'businessId', v_n.business_id);
    END IF;

    SELECT name INTO v_by FROM public.users WHERE id = v_n.accepted_by;
    RETURN jsonb_build_object('accepted', FALSE,
                              'alreadyAcceptedBy', CASE WHEN v_n.accepted_by = v_me THEN 'you' ELSE COALESCE(v_by, 'someone') END,
                              'actionTarget', v_n.action_target, 'businessId', v_n.business_id);
END;
$$;

-- "Not accepted" goes to the business's managers; a supplier's ring opens Buying for them.
CREATE OR REPLACE FUNCTION public.escalate_unaccepted_alerts() RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
AS $$
DECLARE
    v_n RECORD;
    v_who TEXT;
    v_count INTEGER := 0;
BEGIN
    FOR v_n IN
        SELECT n.* FROM public.notifications n
        WHERE n.ring AND n.accepted_at IS NULL AND n.escalated_at IS NULL AND n.deleted_at IS NULL
          AND n.created_at < NOW() - INTERVAL '15 minutes'
          AND n.created_at > NOW() - INTERVAL '12 hours'
        FOR UPDATE SKIP LOCKED
    LOOP
        UPDATE public.notifications SET escalated_at = NOW() WHERE id = v_n.id;

        IF v_n.user_id IS NOT NULL THEN
            SELECT name INTO v_who FROM public.users WHERE id = v_n.user_id;
            v_who := COALESCE(v_who, 'A team member')
                     || CASE WHEN v_n.type = 'Supplier' THEN ' (supplier)' ELSE '' END || ' hasn''t';
        ELSE
            v_who := 'Nobody has';
        END IF;

        INSERT INTO public.notifications
            (business_id, title, message, type, priority, action_type, action_target, payload, created_by)
        VALUES (
            v_n.business_id,
            'Alert not accepted',
            v_who || ' accepted "' || v_n.title || '" from '
                || to_char(v_n.created_at AT TIME ZONE 'Africa/Nairobi', 'HH24:MI') || '.',
            'Alert Not Accepted',
            'high'::public.notification_priority,
            'navigate'::public.notification_action_type,
            CASE WHEN v_n.type = 'Supplier' THEN 'buying' ELSE v_n.action_target END,
            jsonb_build_object('notificationId', v_n.id, 'userId', v_n.user_id),
            'system'
        );
        v_count := v_count + 1;
    END LOOP;
    RETURN v_count;
END;
$$;

-- ── Supplier portal: their requests ──────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.supplier_portal_stock_requests(p_business_id uuid) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
AS $$
DECLARE v_s uuid := public.assert_supplier(p_business_id, 'supplier_portal.stock_requests');
BEGIN
    RETURN COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
            'id', r.id, 'productName', r.product_name, 'unit', r.unit, 'quantity', r.quantity,
            'neededBy', r.needed_by, 'note', r.note, 'status', r.status, 'askedBy', r.asked_by_name,
            'askedAt', r.created_at, 'deliveryDate', r.delivery_date, 'responseNote', r.response_note,
            'respondedAt', r.responded_at) ORDER BY r.created_at DESC)
        FROM public.supplier_stock_requests r
        WHERE r.business_id = p_business_id AND r.supplier_id = v_s
          AND r.created_at > NOW() - INTERVAL '90 days'
    ), '[]'::jsonb);
END;
$$;

REVOKE ALL ON FUNCTION public.supplier_portal_stock_requests(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.supplier_portal_stock_requests(uuid) TO authenticated, service_role;

-- Tell the portal whether requests are shared with this supplier.
CREATE OR REPLACE FUNCTION public.supplier_portal_accounts() RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
AS $$
DECLARE v_me UUID := public.fn_my_user_id();
BEGIN
    IF v_me IS NULL THEN RETURN '[]'::JSONB; END IF;
    UPDATE public.supplier_accounts SET last_seen_at = NOW()
    WHERE user_id = v_me AND status = 'active' AND (last_seen_at IS NULL OR last_seen_at < NOW() - INTERVAL '5 minutes');
    RETURN COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
            'accountId', a.id,
            'businessId', b.id,
            'businessName', b.name,
            'businessLogo', b.logo_url,
            'businessPhone', b.contact_phone,
            'supplierId', s.id,
            'supplierName', COALESCE(NULLIF(s.company, ''), s.name),
            'can', jsonb_build_object(
                'orders', public.supplier_can(b.id, 'supplier_portal.orders'),
                'priceRequests', public.supplier_can(b.id, 'supplier_portal.price_requests'),
                'deliveries', public.supplier_can(b.id, 'supplier_portal.deliveries'),
                'statement', public.supplier_can(b.id, 'supplier_portal.statement'),
                'updateDetails', public.supplier_can(b.id, 'supplier_portal.update_details'),
                'stock', public.supplier_can(b.id, 'supplier_portal.stock'),
                'stockRequests', public.supplier_can(b.id, 'supplier_portal.stock_requests'))
        ) ORDER BY b.name)
        FROM public.supplier_accounts a
        JOIN public.businesses b ON b.id = a.business_id AND b.deleted_at IS NULL
        JOIN public.suppliers s ON s.id = a.supplier_id AND s.deleted_at IS NULL
        WHERE a.user_id = v_me AND a.status = 'active'
    ), '[]'::JSONB);
END;
$$;

-- ── Supplier role: requests are on by default ────────────────────────────────────────────
INSERT INTO public.role_default_permissions (role, permissions) VALUES
    ('Supplier', ARRAY['supplier_portal.deliveries', 'supplier_portal.orders', 'supplier_portal.price_requests', 'supplier_portal.statement', 'supplier_portal.stock_requests', 'supplier_portal.update_details'])
ON CONFLICT (role) DO UPDATE SET permissions = EXCLUDED.permissions;
