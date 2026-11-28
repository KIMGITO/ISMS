-- Shop features: quotes, messages, suppliers, VAT, delivery, promotions, shifts, riders, regular orders, permissions, safety checks, records, plans, website addresses.
-- Merged on 2026-11-28 from these files, in this order (each section keeps its own notes):
--   20261121001_quote_sold_at_till.sql
--   20261122001_message_variables.sql
--   20261123001_supplier_stock_requests.sql
--   20261124001_vat_needs_etims.sql
--   20261125001_delivery_modes_sale_edit_log.sql
--   20261126001_promotions.sql
--   20261126002_referrals.sql
--   20261126003_promotion_referral_books.sql
--   20261127001_auto_clock_out.sql
--   20261128001_customer_profile.sql
--   20261128002_signed_out_sessions_denied.sql
--   20261128003_only_creator_creates_business.sql
--   20261129001_revoke_invitation.sql
--   20261130001_delivery_trips.sql
--   20261130002_still_on_shift_check.sql
--   20261130003_stock_period_report.sql
--   20261130004_rider_pay_bills.sql
--   20261130005_regular_orders.sql
--   20261130006_permissions_db_level.sql
--   20261130007_quantity_one_decimal.sql
--   20261130008_ai_reads_permissions.sql
--   20261201001_lock_function_grants.sql
--   20261201002_sale_totals_check.sql
--   20261201003_ops_watchdog.sql
--   20261201004_abuse_limits.sql
--   20261201005_permission_cache.sql
--   20261201006_realtime_publication.sql
--   20261201007_storage_usage_alert.sql
--   20261202001_record_refs_global_search.sql
--   20261203001_keep_records.sql
--   20261203002_retention_and_erasure.sql
--   20261204001_saas_tenants_plans.sql
--   20261204002_ai_platform_usage.sql
--   20261204003_signup_join_plan_page.sql
--   20261204004_website_addresses.sql
--   20261204005_platform_console_plans_page.sql

-- ===================================================================
-- 20261121001_quote_sold_at_till
-- ===================================================================
-- Quotes are now made from the POS cart and sold from it: "Sell in POS" loads a quote into
-- the cart, and when that sale goes through the quote is marked accepted and linked to the
-- sale. The separate Quotes & Invoices screen is gone; its tables stay for old documents.

ALTER TABLE public.quotes ADD COLUMN IF NOT EXISTS transaction_id uuid;

CREATE OR REPLACE FUNCTION public.mark_quote_sold(p_id uuid, p_transaction_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
    v_q public.quotes%ROWTYPE;
BEGIN
    SELECT * INTO v_q FROM public.quotes WHERE id = p_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'That quote was not found.';
    END IF;
    PERFORM public.assert_business_member(v_q.business_id);
    PERFORM public.assert_permission(v_q.business_id, 'pos.create_sale');
    IF v_q.status = 'accepted' THEN
        RETURN; -- already sold (a retry after a dropped connection)
    END IF;
    UPDATE public.quotes
       SET status = 'accepted', decided_at = NOW(), transaction_id = p_transaction_id, updated_at = NOW()
     WHERE id = p_id;
END;
$$;

REVOKE ALL ON FUNCTION public.mark_quote_sold(uuid, uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.mark_quote_sold(uuid, uuid) TO authenticated;

-- ===================================================================
-- 20261122001_message_variables
-- ===================================================================
-- Messages to many customers: variables the business makes itself, and each customer's
-- buying history for the "last bought" groups and variables.
--
-- message_variables: one value for everybody, such as {offer_ends} = "Sunday". The app
-- adds them next to the built-in ones ({first_name}, {debt}, ...). Keys are lower case
-- letters, digits and _, and can't take the name of a built-in variable (checked in the app).

CREATE TABLE IF NOT EXISTS public.message_variables (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    key         text NOT NULL CHECK (key ~ '^[a-z][a-z0-9_]{1,29}$'),
    label       text NOT NULL CHECK (char_length(label) BETWEEN 1 AND 60),
    value       text NOT NULL DEFAULT '' CHECK (char_length(value) <= 300),
    updated_by  text,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now(),
    UNIQUE (business_id, key)
);

ALTER TABLE public.message_variables ENABLE ROW LEVEL SECURITY;

CREATE POLICY pol_message_variables_select ON public.message_variables FOR SELECT
    USING (business_id = ANY (public.get_user_business_ids())
           AND public.has_permission(business_id, 'communication.view', 'communication.send', 'customers.view'));
CREATE POLICY pol_message_variables_insert ON public.message_variables FOR INSERT
    WITH CHECK (public.has_permission(business_id, 'communication.send'));
CREATE POLICY pol_message_variables_update ON public.message_variables FOR UPDATE
    USING (public.has_permission(business_id, 'communication.send'))
    WITH CHECK (public.has_permission(business_id, 'communication.send'));
CREATE POLICY pol_message_variables_delete ON public.message_variables FOR DELETE
    USING (public.has_permission(business_id, 'communication.send'));

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.message_variables TO authenticated;
GRANT ALL ON TABLE public.message_variables TO service_role;

-- Last purchase, number of purchases and total spent per customer, from the sales
-- themselves (the app only holds recent sales). Runs as the caller, so the usual rules
-- on transactions apply.
CREATE OR REPLACE FUNCTION public.customer_purchase_stats(p_business_id uuid)
RETURNS TABLE (customer_id uuid, last_purchase_at timestamptz, purchases integer, total_spent numeric)
LANGUAGE sql STABLE
SET search_path TO 'public'
AS $$
    SELECT t.customer_id, max(t."timestamp"), count(*)::integer, COALESCE(sum(t.final_total), 0)
    FROM public.transactions t
    WHERE t.business_id = p_business_id
      AND t.customer_id IS NOT NULL
      AND t.deleted_at IS NULL
    GROUP BY t.customer_id;
$$;

REVOKE ALL ON FUNCTION public.customer_purchase_stats(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.customer_purchase_stats(uuid) TO authenticated, service_role;

-- ===================================================================
-- 20261123001_supplier_stock_requests
-- ===================================================================
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

-- ===================================================================
-- 20261124001_vat_needs_etims
-- ===================================================================
-- VAT needs KRA eTIMS.
-- No sale, quote, order or invoice may carry VAT unless the branch has KRA eTIMS connected,
-- even when the business tax switch is on. The app applies the same rule (useVatPercent);
-- this makes it hold for older apps and sales queued offline too.

-- 1. The rule, in one place.
CREATE OR REPLACE FUNCTION public.vat_allowed(p_business_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
    SELECT COALESCE((SELECT is_tax_enabled FROM public.businesses WHERE id = p_business_id), FALSE)
       AND EXISTS (SELECT 1 FROM public.kra_etims_settings
                   WHERE business_id = p_business_id AND status = 'connected');
$$;
ALTER FUNCTION public.vat_allowed(uuid) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION public.vat_allowed(uuid) TO authenticated, service_role;

-- 2. Tax is off unless someone turns it on, and it can only be turned on with eTIMS connected.
ALTER TABLE public.businesses ALTER COLUMN is_tax_enabled SET DEFAULT false;
UPDATE public.businesses b SET is_tax_enabled = false
WHERE is_tax_enabled
  AND NOT EXISTS (SELECT 1 FROM public.kra_etims_settings k WHERE k.business_id = b.id AND k.status = 'connected');

CREATE OR REPLACE FUNCTION public.fn_tax_needs_etims() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
    IF NEW.is_tax_enabled AND NOT EXISTS (
        SELECT 1 FROM public.kra_etims_settings WHERE business_id = NEW.id AND status = 'connected'
    ) THEN
        NEW.is_tax_enabled := false;
    END IF;
    RETURN NEW;
END;
$$;
ALTER FUNCTION public.fn_tax_needs_etims() OWNER TO postgres;
DROP TRIGGER IF EXISTS trg_tax_needs_etims ON public.businesses;
CREATE TRIGGER trg_tax_needs_etims BEFORE INSERT OR UPDATE OF is_tax_enabled ON public.businesses
    FOR EACH ROW EXECUTE FUNCTION public.fn_tax_needs_etims();

-- 3. Sales: VAT sent without eTIMS is not VAT. The customer already paid final_total, so it
--    stays the same; the amount just counts as part of the price (sales), not VAT owed to KRA.
CREATE OR REPLACE FUNCTION public.fn_sale_vat_needs_etims() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
    IF COALESCE(NEW.tax, 0) > 0 AND NOT public.vat_allowed(NEW.business_id) THEN
        NEW.total := NEW.total + NEW.tax;
        NEW.tax := 0;
    END IF;
    RETURN NEW;
END;
$$;
ALTER FUNCTION public.fn_sale_vat_needs_etims() OWNER TO postgres;
DROP TRIGGER IF EXISTS trg_0_sale_vat_needs_etims ON public.transactions;
CREATE TRIGGER trg_0_sale_vat_needs_etims BEFORE INSERT ON public.transactions
    FOR EACH ROW EXECUTE FUNCTION public.fn_sale_vat_needs_etims();

-- 4. Quotes and orders (invoices copy their order's lines): every line is checked here.
CREATE OR REPLACE FUNCTION "public"."sd_norm_lines"("p_business_id" "uuid", "p_lines" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
    v_el    JSONB;
    v_pos   INTEGER := 0;
    v_out   JSONB := '[]'::JSONB;
    v_pid   UUID;
    v_name  TEXT;
    v_unit  TEXT;
    v_pname TEXT;
    v_punit TEXT;
    v_qty   NUMERIC;
    v_price NUMERIC;
    v_disc  NUMERIC;
    v_vat   NUMERIC;
    v_net   NUMERIC;
    v_tax   NUMERIC;
    v_vat_ok BOOLEAN := public.vat_allowed(p_business_id);
BEGIN
    IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) = 0 THEN
        RAISE EXCEPTION 'Add at least one item.';
    END IF;
    IF jsonb_array_length(p_lines) > 200 THEN
        RAISE EXCEPTION 'A document can have at most 200 items.';
    END IF;
    FOR v_el IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
        v_pos := v_pos + 1;
        v_pid := NULLIF(v_el->>'productId', '')::UUID;
        v_pname := NULL;
        v_punit := NULL;
        IF v_pid IS NOT NULL THEN
            SELECT name, unit INTO v_pname, v_punit FROM public.products
            WHERE id = v_pid AND business_id = p_business_id;
            IF NOT FOUND THEN
                RAISE EXCEPTION 'Item % is not a product of this branch.', v_pos;
            END IF;
        END IF;
        v_name  := left(COALESCE(NULLIF(trim(v_el->>'name'), ''), v_pname, ''), 200);
        v_unit  := left(COALESCE(NULLIF(trim(v_el->>'unit'), ''), v_punit), 20);
        v_qty   := round(COALESCE(NULLIF(v_el->>'quantity', '')::NUMERIC, 0), 3);
        v_price := round(COALESCE(NULLIF(v_el->>'unitPrice', '')::NUMERIC, 0), 2);
        v_disc  := round(COALESCE(NULLIF(v_el->>'discountPct', '')::NUMERIC, 0), 2);
        v_vat   := COALESCE(NULLIF(v_el->>'vatRate', '')::NUMERIC, 0);
        -- No VAT without KRA eTIMS (signed receipts), whatever the app sent.
        IF NOT v_vat_ok THEN
            v_vat := 0;
        END IF;
        IF v_name = '' THEN
            RAISE EXCEPTION 'Item % needs a name.', v_pos;
        ELSIF v_qty <= 0 THEN
            RAISE EXCEPTION '% needs a quantity above zero.', v_name;
        ELSIF v_price < 0 THEN
            RAISE EXCEPTION '% can''t have a price below zero.', v_name;
        ELSIF v_disc < 0 OR v_disc > 100 THEN
            RAISE EXCEPTION 'The discount on % must be between 0 and 100%%.', v_name;
        ELSIF v_vat NOT IN (0, 8, 16) THEN
            RAISE EXCEPTION 'VAT on % must be 0%%, 8%% or 16%%.', v_name;
        END IF;
        v_net := round(v_qty * v_price * (1 - v_disc / 100), 2);
        v_tax := round(v_net * v_vat / 100, 2);
        v_out := v_out || jsonb_build_array(jsonb_build_object(
            'position', v_pos, 'product_id', v_pid, 'name', v_name, 'unit', v_unit,
            'quantity', v_qty, 'unit_price', v_price, 'discount_pct', v_disc, 'vat_rate', v_vat,
            'line_net', v_net, 'line_vat', v_tax, 'line_total', v_net + v_tax));
    END LOOP;
    RETURN v_out;
END;
$$;

ALTER FUNCTION "public"."sd_norm_lines"("p_business_id" "uuid", "p_lines" "jsonb") OWNER TO "postgres";

-- ===================================================================
-- 20261125001_delivery_modes_sale_edit_log
-- ===================================================================
-- 2026-11-17 POS: how delivery is paid, what the rider earns, and every change to a sale is logged.
--
-- 1. Three ways a delivery is paid (transactions.delivery_mode):
--      charged        the fee is on our bill: the customer pays us now or later (weekly /
--                     monthly accounts), and the shop pays the rider.
--      rider_collects the customer pays the rider the fee in cash on delivery; the rider keeps
--                     it (and brings back any cash for the goods). Not on our bill.
--      free           the customer isn't charged; the shop pays the rider from its own money.
--    delivery_fee stays what the customer pays THE SHOP for delivery (0 unless 'charged'), so
--    final_total, points, refunds and the books (delivery income) keep working unchanged.
--    transactions.rider_pay is what the rider earns for the delivery. The shop owes it for
--    'charged' and 'free'; it is booked as an expense when the rider is paid, not at the sale.
-- 2. Riders see the mode and their pay in their list (fn_delivery_rows), so they know what to
--    collect and who pays them.
-- 3. Sale edits are logged: any change to a sale or its items after it was made goes to
--    audit_logs (Audit screen, and the sale's own history in the Sales Log). Delivery
--    progress by riders (rider_id, delivery_status, delivered_at) is not an edit and is
--    left out; so are sync columns.

ALTER TABLE public.transactions
    ADD COLUMN IF NOT EXISTS delivery_mode TEXT NOT NULL DEFAULT 'charged',
    ADD COLUMN IF NOT EXISTS rider_pay NUMERIC(14,2) NOT NULL DEFAULT 0;
DO $$ BEGIN
    ALTER TABLE public.transactions ADD CONSTRAINT transactions_delivery_mode_check
        CHECK (delivery_mode IN ('charged', 'rider_collects', 'free'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
    ALTER TABLE public.transactions ADD CONSTRAINT transactions_rider_pay_check CHECK (rider_pay >= 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
COMMENT ON COLUMN public.transactions.delivery_mode IS
    'charged: fee on our bill, shop pays the rider. rider_collects: customer pays the rider in cash, rider keeps it. free: customer not charged, shop pays the rider.';
COMMENT ON COLUMN public.transactions.rider_pay IS
    'What the rider earns for this delivery. Owed by the shop unless delivery_mode = rider_collects.';

-- Deliveries made before this: the fee was on the bill and riders price their own areas.
-- (Before the edit-log trigger below exists, so it isn't logged as an edit.)
UPDATE public.transactions SET rider_pay = delivery_fee
WHERE is_delivery AND delivery_fee > 0 AND rider_pay = 0;

-- ---------------------------------------------------------------- credit sales carry the mode and rider pay
DROP FUNCTION IF EXISTS public.process_customer_transaction("p_business_id" "uuid", "p_customer_id" "uuid", "p_customer_name" "text", "p_staff_id" "uuid", "p_staff_name" "text", "p_total" numeric, "p_discount" numeric, "p_tax" numeric, "p_final_total" numeric, "p_amount_paid" numeric, "p_payment_method" "public"."payment_method", "p_timestamp" timestamp with time zone, "p_note" "text", "p_is_delivery" boolean, "p_delivery_fee" numeric, "p_rider_name" "text", "p_reference_id" "text", "p_items" "jsonb");

CREATE FUNCTION "public"."process_customer_transaction"("p_business_id" "uuid", "p_customer_id" "uuid", "p_customer_name" "text", "p_staff_id" "uuid", "p_staff_name" "text", "p_total" numeric, "p_discount" numeric, "p_tax" numeric, "p_final_total" numeric, "p_amount_paid" numeric, "p_payment_method" "public"."payment_method", "p_timestamp" timestamp with time zone, "p_note" "text", "p_is_delivery" boolean, "p_delivery_fee" numeric, "p_rider_name" "text", "p_reference_id" "text", "p_items" "jsonb", "p_delivery_mode" "text" DEFAULT 'charged', "p_rider_pay" numeric DEFAULT 0) RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
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
    PERFORM public.assert_permission(p_business_id, 'pos.create_sale');
    PERFORM public.assert_business_member(p_business_id); IF p_customer_id IS NOT NULL THEN PERFORM public.assert_business_member((SELECT business_id FROM public.customers WHERE id = p_customer_id)); END IF; PERFORM public.assert_business_member(pr.business_id) FROM public.products pr WHERE pr.id IN (SELECT (e->>'product_id')::UUID FROM jsonb_array_elements(COALESCE(p_items, '[]'::JSONB)) e WHERE e->>'product_id' IS NOT NULL);
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
         delivery_fee, rider_name, reference_id, delivery_mode, rider_pay)
    VALUES (
        p_business_id, p_total, p_discount, p_tax, p_final_total,
        p_amount_paid, v_wallet_used, p_payment_method, p_customer_id,
        p_customer_name, p_staff_id, p_staff_name, 'Synced',
        COALESCE(p_timestamp, NOW()), p_note, COALESCE(p_is_delivery, FALSE),
        COALESCE(p_delivery_fee, 0), p_rider_name, p_reference_id,
        CASE WHEN COALESCE(p_is_delivery, FALSE) THEN COALESCE(p_delivery_mode, 'charged') ELSE 'charged' END,
        CASE WHEN COALESCE(p_is_delivery, FALSE) THEN GREATEST(COALESCE(p_rider_pay, 0), 0) ELSE 0 END
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
        -- credit record: created by the sale trigger, once per sale

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

ALTER FUNCTION public.process_customer_transaction("p_business_id" "uuid", "p_customer_id" "uuid", "p_customer_name" "text", "p_staff_id" "uuid", "p_staff_name" "text", "p_total" numeric, "p_discount" numeric, "p_tax" numeric, "p_final_total" numeric, "p_amount_paid" numeric, "p_payment_method" "public"."payment_method", "p_timestamp" timestamp with time zone, "p_note" "text", "p_is_delivery" boolean, "p_delivery_fee" numeric, "p_rider_name" "text", "p_reference_id" "text", "p_items" "jsonb", "p_delivery_mode" "text", "p_rider_pay" numeric) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.process_customer_transaction("p_business_id" "uuid", "p_customer_id" "uuid", "p_customer_name" "text", "p_staff_id" "uuid", "p_staff_name" "text", "p_total" numeric, "p_discount" numeric, "p_tax" numeric, "p_final_total" numeric, "p_amount_paid" numeric, "p_payment_method" "public"."payment_method", "p_timestamp" timestamp with time zone, "p_note" "text", "p_is_delivery" boolean, "p_delivery_fee" numeric, "p_rider_name" "text", "p_reference_id" "text", "p_items" "jsonb", "p_delivery_mode" "text", "p_rider_pay" numeric) FROM PUBLIC;
GRANT ALL ON FUNCTION public.process_customer_transaction("p_business_id" "uuid", "p_customer_id" "uuid", "p_customer_name" "text", "p_staff_id" "uuid", "p_staff_name" "text", "p_total" numeric, "p_discount" numeric, "p_tax" numeric, "p_final_total" numeric, "p_amount_paid" numeric, "p_payment_method" "public"."payment_method", "p_timestamp" timestamp with time zone, "p_note" "text", "p_is_delivery" boolean, "p_delivery_fee" numeric, "p_rider_name" "text", "p_reference_id" "text", "p_items" "jsonb", "p_delivery_mode" "text", "p_rider_pay" numeric) TO authenticated;
GRANT ALL ON FUNCTION public.process_customer_transaction("p_business_id" "uuid", "p_customer_id" "uuid", "p_customer_name" "text", "p_staff_id" "uuid", "p_staff_name" "text", "p_total" numeric, "p_discount" numeric, "p_tax" numeric, "p_final_total" numeric, "p_amount_paid" numeric, "p_payment_method" "public"."payment_method", "p_timestamp" timestamp with time zone, "p_note" "text", "p_is_delivery" boolean, "p_delivery_fee" numeric, "p_rider_name" "text", "p_reference_id" "text", "p_items" "jsonb", "p_delivery_mode" "text", "p_rider_pay" numeric) TO service_role;

-- ---------------------------------------------------------------- riders see what to collect and who pays them
DROP FUNCTION IF EXISTS public.fn_delivery_rows(uuid);

CREATE FUNCTION "public"."fn_delivery_rows"("p_business_id" "uuid") RETURNS TABLE("source" "text", "id" "uuid", "reference" "text", "customer_name" "text", "customer_phone" "text", "address" "text", "area" "text", "notes" "text", "amount" numeric, "delivery_fee" numeric, "status" "text", "assigned_at" timestamp with time zone, "delivered_at" timestamp with time zone, "created_at" timestamp with time zone, "items" "text", "payment" "text", "balance_due" numeric, "rider_id" "uuid", "is_open" boolean, "delivery_mode" "text", "rider_pay" numeric)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
    SELECT 'online', o.id, '#' || o.order_number,
           o.customer_name, o.customer_phone,
           o.delivery_address, o.delivery_zone, o.notes,
           o.total, o.delivery_fee,
           CASE o.status
               WHEN 'out_for_delivery' THEN 'out_for_delivery'
               WHEN 'completed' THEN 'delivered'
               WHEN 'cancelled' THEN 'failed'
               ELSE 'assigned'
           END,
           COALESCE(o.rider_assigned_at, o.created_at), o.delivered_at, o.created_at,
           (SELECT string_agg(i.quantity::FLOAT8 || ' ' || i.unit || ' ' || i.product_name, ', ')
            FROM public.online_order_items i WHERE i.order_id = o.id),
           'Paid online (M-Pesa)', 0::NUMERIC,
           o.rider_id,
           o.rider_id IS NULL AND o.status IN ('paid', 'preparing'),
           -- Website orders: paid online with the fee; the shop pays the rider.
           'charged'::TEXT, o.delivery_fee
    FROM public.online_orders o
    WHERE o.business_id = p_business_id AND o.fulfilment = 'delivery'
      AND (o.rider_id IS NOT NULL OR o.status IN ('paid', 'preparing'))
    UNION ALL
    SELECT 'sale', t.id, 'Till sale', COALESCE(c.name, t.customer_name, 'Walk-in customer'), c.phone,
           -- The till saves the location as "Deliver to: <place>." at the start of the note.
           NULLIF(trim(substring(t.note FROM '^Deliver to: ([^.]*)')), ''), NULL,
           NULLIF(trim(regexp_replace(COALESCE(t.note, ''), '^Deliver to: [^.]*\.?\s*', '')), ''),
           t.final_total, t.delivery_fee,
           COALESCE(t.delivery_status, 'assigned'),
           t.timestamp, t.delivered_at, t.timestamp,
           (SELECT string_agg(i.quantity::FLOAT8 || ' ' || i.product_name, ', ')
            FROM public.transaction_items i WHERE i.transaction_id = t.id),
           t.payment_method::TEXT,
           GREATEST(t.final_total - t.amount_paid - t.wallet_applied, 0),
           t.rider_id,
           t.rider_id IS NULL,
           t.delivery_mode, t.rider_pay
    FROM public.transactions t
    LEFT JOIN public.customers c ON c.id = t.customer_id
    WHERE t.business_id = p_business_id AND t.is_delivery AND t.deleted_at IS NULL
      AND (t.rider_id IS NOT NULL
           OR (NULLIF(trim(COALESCE(t.rider_name, '')), '') IS NULL
               AND COALESCE(t.delivery_status, 'assigned') = 'assigned'
               AND t.timestamp > NOW() - INTERVAL '3 days'));
$$;

ALTER FUNCTION public.fn_delivery_rows(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.fn_delivery_rows(uuid) FROM PUBLIC;

-- ---------------------------------------------------------------- sale edit log
CREATE OR REPLACE FUNCTION public.fn_audit_sale_change() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
    -- Bookkeeping and the rider's delivery progress are not edits.
    v_ignore   TEXT[] := ARRAY['updated_at', 'created_at', 'version', 'sync_status', 'last_modified_by', 'status'];
    v_delivery TEXT[] := ARRAY['rider_id', 'rider_name', 'delivery_status', 'delivered_at'];
    v_old      JSONB := to_jsonb(OLD);
    v_new      JSONB := CASE WHEN TG_OP = 'UPDATE' THEN to_jsonb(NEW) ELSE '{}'::JSONB END;
    v_changes  JSONB := '{}'::JSONB;
    v_key      TEXT;
    v_action   TEXT;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM public.businesses b WHERE b.id = OLD.business_id) THEN
        RETURN NULL;
    END IF;
    IF TG_OP = 'UPDATE' THEN
        FOR v_key IN SELECT jsonb_object_keys(v_new) LOOP
            CONTINUE WHEN v_key = ANY(v_ignore);
            IF (v_old -> v_key) IS DISTINCT FROM (v_new -> v_key) THEN
                v_changes := v_changes || jsonb_build_object(v_key, jsonb_build_object('from', v_old -> v_key, 'to', v_new -> v_key));
            END IF;
        END LOOP;
        -- Nothing changed, or only a rider taking / moving the delivery along.
        IF v_changes = '{}'::JSONB
           OR NOT EXISTS (SELECT 1 FROM jsonb_object_keys(v_changes) k WHERE k <> ALL(v_delivery)) THEN
            RETURN NULL;
        END IF;
    END IF;

    v_action := CASE
        WHEN TG_OP = 'DELETE' THEN 'DELETE'
        WHEN v_changes ? 'deleted_at' AND (v_new ->> 'deleted_at') IS NOT NULL THEN 'DELETE'
        WHEN v_changes ? 'deleted_at' THEN 'RESTORE'
        ELSE 'UPDATE'
    END;

    INSERT INTO public.audit_logs (business_id, user_id, action, table_name, record_id, details)
    VALUES (
        OLD.business_id,
        (SELECT u.id FROM public.users u WHERE u.id = auth.uid() OR u.auth_user_id = auth.uid() LIMIT 1),
        v_action,
        'transactions',
        OLD.id::TEXT,
        jsonb_build_object('label', 'Sale ' || public.fn_receipt_number(OLD.id), 'by', public.fn_audit_actor_name())
            || CASE WHEN TG_OP = 'UPDATE' THEN jsonb_build_object('changes', v_changes) ELSE '{}'::JSONB END
    );
    RETURN NULL;
END;
$$;
ALTER FUNCTION public.fn_audit_sale_change() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.fn_audit_sale_change() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_audit_sale_change ON public.transactions;
CREATE TRIGGER trg_audit_sale_change
    AFTER UPDATE OR DELETE ON public.transactions
    FOR EACH ROW EXECUTE FUNCTION public.fn_audit_sale_change();

-- Items: a line changed, taken out, or added after the sale was made. Lines written with the
-- sale itself (same minute) are the sale, not an edit.
CREATE OR REPLACE FUNCTION public.fn_audit_sale_item_change() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
    v_tx_id   UUID;
    v_sale    public.transactions%ROWTYPE;
    v_changes JSONB := '{}'::JSONB;
    v_what    TEXT;
BEGIN
    IF TG_OP = 'DELETE' THEN v_tx_id := OLD.transaction_id; ELSE v_tx_id := NEW.transaction_id; END IF;
    SELECT * INTO v_sale FROM public.transactions WHERE id = v_tx_id;
    IF NOT FOUND THEN
        RETURN NULL; -- the sale itself is going; its own row logs that
    END IF;
    IF TG_OP = 'INSERT' AND v_sale.created_at > NOW() - INTERVAL '1 minute' THEN
        RETURN NULL;
    END IF;

    IF TG_OP = 'UPDATE' THEN
        IF OLD.quantity IS DISTINCT FROM NEW.quantity THEN
            v_changes := v_changes || jsonb_build_object(NEW.product_name || ' quantity', jsonb_build_object('from', OLD.quantity, 'to', NEW.quantity));
        END IF;
        IF OLD.unit_price IS DISTINCT FROM NEW.unit_price THEN
            v_changes := v_changes || jsonb_build_object(NEW.product_name || ' price', jsonb_build_object('from', OLD.unit_price, 'to', NEW.unit_price));
        END IF;
        IF OLD.discount_percentage IS DISTINCT FROM NEW.discount_percentage THEN
            v_changes := v_changes || jsonb_build_object(NEW.product_name || ' discount %', jsonb_build_object('from', OLD.discount_percentage, 'to', NEW.discount_percentage));
        END IF;
        IF OLD.product_id IS DISTINCT FROM NEW.product_id OR OLD.product_name IS DISTINCT FROM NEW.product_name THEN
            v_changes := v_changes || jsonb_build_object('item', jsonb_build_object('from', OLD.product_name, 'to', NEW.product_name));
        END IF;
        IF OLD.line_total IS DISTINCT FROM NEW.line_total THEN
            v_changes := v_changes || jsonb_build_object(NEW.product_name || ' line total', jsonb_build_object('from', OLD.line_total, 'to', NEW.line_total));
        END IF;
        IF v_changes = '{}'::JSONB THEN
            RETURN NULL;
        END IF;
    ELSIF TG_OP = 'INSERT' THEN
        v_what := NEW.quantity::FLOAT8 || ' × ' || NEW.product_name || ' at ' || NEW.unit_price;
        v_changes := jsonb_build_object('item added', jsonb_build_object('from', NULL, 'to', v_what));
    ELSE
        v_what := OLD.quantity::FLOAT8 || ' × ' || OLD.product_name || ' at ' || OLD.unit_price;
        v_changes := jsonb_build_object('item removed', jsonb_build_object('from', v_what, 'to', NULL));
    END IF;

    INSERT INTO public.audit_logs (business_id, user_id, action, table_name, record_id, details)
    VALUES (
        v_sale.business_id,
        (SELECT u.id FROM public.users u WHERE u.id = auth.uid() OR u.auth_user_id = auth.uid() LIMIT 1),
        'UPDATE',
        'transactions',
        v_sale.id::TEXT,
        jsonb_build_object('label', 'Sale ' || public.fn_receipt_number(v_sale.id), 'by', public.fn_audit_actor_name(), 'changes', v_changes)
    );
    RETURN NULL;
END;
$$;
ALTER FUNCTION public.fn_audit_sale_item_change() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.fn_audit_sale_item_change() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_audit_sale_item_change ON public.transaction_items;
CREATE TRIGGER trg_audit_sale_item_change
    AFTER INSERT OR UPDATE OR DELETE ON public.transaction_items
    FOR EACH ROW EXECUTE FUNCTION public.fn_audit_sale_item_change();

-- Sale history is read by sale id (Sales Log → a sale → Changes).
CREATE INDEX IF NOT EXISTS idx_audit_logs_record ON public.audit_logs (business_id, table_name, record_id);

-- ===================================================================
-- 20261126001_promotions
-- ===================================================================
-- 2026-11-17 Promotion codes for the till and the online shop, in one place.
--
-- The online shop already had promo codes (website_promo_codes). That table is now the one
-- promotions table for both channels; its name is kept because the online shop's functions
-- use it. A promotion is:
--   kind       what it gives:  percent | amount | free_items (some units of one product free)
--                              | none (only used by referral welcome rows, 20261126002)
--   promo_type what staff picked (percentage, fixed, buy_x_get_y, free_product, min_spend,
--              customer, first_purchase, referral). It only presets the fields; the rules
--              below are generic, so no campaign has code of its own.
--   audience   everyone | selected (promotion_customers) | first_purchase | referral
--   scope      all products | chosen products (promotion_products) | categories (promotion_categories)
--   branches   always its own branch; promotion_branches adds sister branches (same owner)
--   limits     starts/ends, min_order (on the items the promotion covers), max_discount,
--              max_uses (all channels, all branches), once_per_customer, stackable.
--
-- Till flow (same shape as loyalty points at the till):
--   promo_check    preview only, never changes anything; returns ok/reason/discount.
--   promo_reserve  locks the promotion, checks again, holds one use for 20 minutes and
--                  returns the server's discount. The till uses that number, never its own.
--   sale           saved with transactions.promotion_redemption_id, in ONE database
--                  transaction (record_till_sale, or process_customer_transaction for
--                  credit). A deferred trigger then works the discount out again from the
--                  sale's own items and refuses the whole sale if it differs or the rules
--                  no longer pass. So the sale and its redemption commit together or not at all.
--   promo_release  the sale failed: the hold is given back at once (or it times out).
-- Cancelled sale -> redemption 'cancelled'; fully refunded -> 'refunded'; both free the use.
-- Partly refunded -> 'partially_refunded' (still a use). Online orders write a redemption
-- too (trigger), so limits and reports cover both channels.

-- ============================================================================ promotions
ALTER TABLE public.website_promo_codes
    ADD COLUMN IF NOT EXISTS name text,
    ADD COLUMN IF NOT EXISTS promo_type text NOT NULL DEFAULT 'percentage',
    ADD COLUMN IF NOT EXISTS max_discount numeric(14,2),
    ADD COLUMN IF NOT EXISTS audience text NOT NULL DEFAULT 'everyone',
    ADD COLUMN IF NOT EXISTS product_scope text NOT NULL DEFAULT 'all',
    ADD COLUMN IF NOT EXISTS buy_qty numeric(14,3),
    ADD COLUMN IF NOT EXISTS reward_product_id uuid REFERENCES public.products(id) ON DELETE RESTRICT,
    ADD COLUMN IF NOT EXISTS reward_qty numeric(14,3),
    ADD COLUMN IF NOT EXISTS stackable boolean NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS use_pos boolean NOT NULL DEFAULT true,
    ADD COLUMN IF NOT EXISTS use_online boolean NOT NULL DEFAULT true,
    -- manual: made by staff. referral_welcome: the hidden rules of a referral campaign's
    -- first purchase (never typed). referral_reward: a referrer's personal reward code.
    ADD COLUMN IF NOT EXISTS origin text NOT NULL DEFAULT 'manual',
    ADD COLUMN IF NOT EXISTS archived_at timestamptz,
    ADD COLUMN IF NOT EXISTS updated_by text;

-- Codes made for the online shop before this stay online-only, and stay as they were.
UPDATE public.website_promo_codes SET use_pos = false, name = COALESCE(name, code)
WHERE promo_type = 'percentage' AND name IS NULL;

COMMENT ON TABLE public.website_promo_codes IS
    'All promotions (till and online shop). Name kept from when only the website had codes.';

ALTER TABLE public.website_promo_codes
    DROP CONSTRAINT IF EXISTS website_promo_codes_kind_check,
    DROP CONSTRAINT IF EXISTS website_promo_codes_value_check,
    DROP CONSTRAINT IF EXISTS website_promo_codes_description_check;
ALTER TABLE public.website_promo_codes
    ADD CONSTRAINT website_promo_codes_kind_check CHECK (kind IN ('percent', 'amount', 'free_items', 'none')),
    ADD CONSTRAINT website_promo_codes_value_check CHECK (kind IN ('free_items', 'none') OR value > 0),
    ADD CONSTRAINT website_promo_codes_description_check CHECK (description IS NULL OR length(description) <= 500),
    ADD CONSTRAINT promo_type_check CHECK (promo_type IN ('percentage', 'fixed', 'buy_x_get_y', 'free_product',
        'min_spend', 'customer', 'first_purchase', 'referral')),
    ADD CONSTRAINT promo_audience_check CHECK (audience IN ('everyone', 'selected', 'first_purchase', 'referral')),
    ADD CONSTRAINT promo_scope_check CHECK (product_scope IN ('all', 'products', 'categories')),
    ADD CONSTRAINT promo_max_discount_check CHECK (max_discount IS NULL OR max_discount > 0),
    ADD CONSTRAINT promo_free_items_check CHECK (kind <> 'free_items'
        OR (reward_product_id IS NOT NULL AND reward_qty > 0)),
    ADD CONSTRAINT promo_buy_qty_check CHECK (buy_qty IS NULL OR buy_qty > 0),
    ADD CONSTRAINT promo_none_check CHECK (kind <> 'none' OR audience = 'referral'),
    ADD CONSTRAINT promo_channel_check CHECK (use_pos OR use_online),
    -- The online shop works out codes on the order subtotal only.
    ADD CONSTRAINT promo_online_check CHECK (NOT use_online
        OR (kind IN ('percent', 'amount') AND audience = 'everyone' AND product_scope = 'all')),
    ADD CONSTRAINT promo_show_online_check CHECK (NOT show_on_website OR use_online),
    ADD CONSTRAINT promo_archived_check CHECK (archived_at IS NULL OR NOT active),
    ADD CONSTRAINT promo_origin_check CHECK (origin IN ('manual', 'referral_welcome', 'referral_reward')),
    ADD CONSTRAINT promo_name_check CHECK (name IS NULL OR length(trim(name)) BETWEEN 1 AND 80);

CREATE INDEX IF NOT EXISTS idx_promotions_business_active
    ON public.website_promo_codes (business_id) WHERE archived_at IS NULL;

-- What a promotion covers, who may use it, and where.
CREATE TABLE IF NOT EXISTS public.promotion_products (
    promotion_id uuid NOT NULL REFERENCES public.website_promo_codes(id) ON DELETE CASCADE,
    product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
    PRIMARY KEY (promotion_id, product_id)
);
CREATE INDEX IF NOT EXISTS idx_promotion_products_product ON public.promotion_products (product_id);

CREATE TABLE IF NOT EXISTS public.promotion_categories (
    promotion_id uuid NOT NULL REFERENCES public.website_promo_codes(id) ON DELETE CASCADE,
    category text NOT NULL CHECK (length(trim(category)) > 0),
    PRIMARY KEY (promotion_id, category)
);

CREATE TABLE IF NOT EXISTS public.promotion_customers (
    promotion_id uuid NOT NULL REFERENCES public.website_promo_codes(id) ON DELETE CASCADE,
    customer_id uuid NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (promotion_id, customer_id)
);
CREATE INDEX IF NOT EXISTS idx_promotion_customers_customer ON public.promotion_customers (customer_id);

CREATE TABLE IF NOT EXISTS public.promotion_branches (
    promotion_id uuid NOT NULL REFERENCES public.website_promo_codes(id) ON DELETE CASCADE,
    business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    PRIMARY KEY (promotion_id, business_id)
);
CREATE INDEX IF NOT EXISTS idx_promotion_branches_business ON public.promotion_branches (business_id);

-- ============================================================================ redemptions
CREATE TABLE IF NOT EXISTS public.promotion_redemptions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    promotion_id uuid NOT NULL REFERENCES public.website_promo_codes(id),
    code text NOT NULL,
    business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    channel text NOT NULL CHECK (channel IN ('pos', 'online')),
    transaction_id uuid REFERENCES public.transactions(id) ON DELETE SET NULL,
    order_id uuid REFERENCES public.online_orders(id) ON DELETE SET NULL,
    customer_id uuid REFERENCES public.customers(id) ON DELETE SET NULL,
    account_id uuid,
    staff_id uuid,
    staff_name text,
    status text NOT NULL CHECK (status IN ('reserved', 'redeemed', 'released', 'expired', 'cancelled',
        'refunded', 'partially_refunded')),
    discount numeric(14,2) NOT NULL CHECK (discount >= 0),
    subtotal numeric(14,2) NOT NULL DEFAULT 0,
    sale_total numeric(14,2),
    refunded_amount numeric(14,2) NOT NULL DEFAULT 0,
    lines jsonb NOT NULL DEFAULT '[]'::jsonb,
    reference_id text,
    reserved_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz,
    redeemed_at timestamptz,
    ended_at timestamptz,
    end_reason text,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_promotion_redemptions_tx ON public.promotion_redemptions (transaction_id) WHERE transaction_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_promotion_redemptions_order ON public.promotion_redemptions (order_id) WHERE order_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_promotion_redemptions_promo ON public.promotion_redemptions (promotion_id, status);
CREATE INDEX IF NOT EXISTS idx_promotion_redemptions_business ON public.promotion_redemptions (business_id, redeemed_at DESC);
CREATE INDEX IF NOT EXISTS idx_promotion_redemptions_customer ON public.promotion_redemptions (customer_id) WHERE customer_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_promotion_redemptions_held ON public.promotion_redemptions (expires_at) WHERE status = 'reserved';

ALTER TABLE public.transactions
    ADD COLUMN IF NOT EXISTS promotion_redemption_id uuid REFERENCES public.promotion_redemptions(id),
    ADD COLUMN IF NOT EXISTS promotion_code text,
    ADD COLUMN IF NOT EXISTS promotion_discount numeric(14,2) NOT NULL DEFAULT 0;
CREATE UNIQUE INDEX IF NOT EXISTS uq_transactions_promotion ON public.transactions (promotion_redemption_id) WHERE promotion_redemption_id IS NOT NULL;
COMMENT ON COLUMN public.transactions.promotion_discount IS
    'Part of discount that came from a promotion code; set by the database from the redemption, never by the app.';

-- ============================================================================ permissions
-- promotions.view   dashboard and lists          promotions.manage  create, edit, switch off, archive
-- pos.apply_promotion  type a code at the till
INSERT INTO public.role_default_permissions (role, permissions) VALUES
    ('Cashier', ARRAY['ai.use', 'business.view', 'complaints.view', 'customers.create', 'customers.debts', 'customers.loyalty', 'customers.schedules', 'customers.view', 'dashboard.view', 'inventory.view', 'notifications.view', 'online_store.view', 'orders.assign_rider', 'orders.create', 'orders.update', 'orders.view', 'payments.airtel', 'payments.card', 'payments.cash', 'payments.mpesa', 'payments.verify', 'pettycash.record', 'pos.apply_promotion', 'pos.cancel_sale', 'pos.close_shift', 'pos.create_sale', 'pos.discount', 'pos.open_shift', 'pos.walkin_customer', 'products.view', 'settings.theme'])
ON CONFLICT (role) DO UPDATE SET permissions = EXCLUDED.permissions;
INSERT INTO public.role_default_permissions (role, permissions) VALUES
    ('Manager', ARRAY['accounting.view', 'ai.insights', 'ai.use', 'assets.view', 'bom.create', 'bom.update', 'bom.view', 'business.switch', 'business.view', 'communication.send', 'communication.view', 'complaints.reply', 'complaints.view', 'customers.create', 'customers.debts', 'customers.loyalty', 'customers.manage', 'customers.schedules', 'customers.update', 'customers.view', 'dashboard.view', 'deliveries.assign', 'deliveries.cancel', 'deliveries.complete', 'deliveries.create', 'deliveries.view', 'expenses.create', 'expenses.update', 'expenses.view', 'files.view', 'finance.view', 'home.view', 'inventory.adjust_stock', 'inventory.expiry', 'inventory.receive_stock', 'inventory.request_transfer', 'inventory.stock_count', 'inventory.stock_history', 'inventory.transfer_stock', 'inventory.view', 'inventory.wastage', 'invoices.manage', 'invoices.view', 'loyalty.adjust', 'notifications.send', 'notifications.view', 'online_store.view', 'orders.assign_rider', 'orders.complete', 'orders.create', 'orders.update', 'orders.view', 'payments.card', 'payments.cash', 'payments.verify', 'payments.view', 'pettycash.record', 'pos.apply_promotion', 'pos.close_shift', 'pos.create_sale', 'pos.open_shift', 'pos.walkin_customer', 'production.approve', 'production.create', 'production.update', 'production.view', 'products.create', 'products.export', 'products.import', 'products.manage_categories', 'products.update', 'products.view', 'promotions.manage', 'promotions.view', 'purchases.approve', 'purchases.create', 'purchases.export', 'purchases.print', 'purchases.request_quote', 'purchases.update', 'purchases.view', 'quotes.manage', 'quotes.view', 'refunds.create', 'reports.customers', 'reports.deliveries', 'reports.inventory', 'reports.profit', 'reports.sales', 'reports.view', 'sales_orders.manage', 'sales_orders.view', 'settings.tax', 'settings.theme', 'settings.update', 'settings.view', 'staff.schedule', 'staff.view', 'supplier_bills.manage', 'suppliers.create', 'suppliers.export', 'suppliers.import', 'suppliers.update', 'suppliers.view'])
ON CONFLICT (role) DO UPDATE SET permissions = EXCLUDED.permissions;

-- ============================================================================ RLS
ALTER TABLE public.promotion_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.promotion_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.promotion_customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.promotion_branches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.promotion_redemptions ENABLE ROW LEVEL SECURITY;

-- Promotions: staff of the branch read them; only promotions.manage writes (the app writes
-- through save_promotion / set_promotion_status, which check the same).
DROP POLICY IF EXISTS pol_promo_codes_write ON public.website_promo_codes;
CREATE POLICY pol_promo_codes_write ON public.website_promo_codes
    USING (public.has_permission(business_id, 'promotions.manage'))
    WITH CHECK (public.has_permission(business_id, 'promotions.manage'));

CREATE POLICY pol_promotion_products_select ON public.promotion_products FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.website_promo_codes p WHERE p.id = promotion_id AND p.business_id = ANY (public.get_user_business_ids())));
CREATE POLICY pol_promotion_categories_select ON public.promotion_categories FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.website_promo_codes p WHERE p.id = promotion_id AND p.business_id = ANY (public.get_user_business_ids())));
CREATE POLICY pol_promotion_customers_select ON public.promotion_customers FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.website_promo_codes p WHERE p.id = promotion_id
            AND public.has_permission(p.business_id, 'promotions.view', 'promotions.manage')));
CREATE POLICY pol_promotion_branches_select ON public.promotion_branches FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.website_promo_codes p WHERE p.id = promotion_id AND p.business_id = ANY (public.get_user_business_ids())));
-- Redemptions are written only by the functions below.
CREATE POLICY pol_promotion_redemptions_select ON public.promotion_redemptions FOR SELECT USING (
    public.has_permission(business_id, 'promotions.view', 'promotions.manage'));

GRANT SELECT ON public.promotion_products, public.promotion_categories, public.promotion_customers,
    public.promotion_branches, public.promotion_redemptions TO authenticated;
GRANT ALL ON public.promotion_products, public.promotion_categories, public.promotion_customers,
    public.promotion_branches, public.promotion_redemptions TO service_role;

-- ============================================================================ helpers
CREATE OR REPLACE FUNCTION public.fn_ksh(p numeric) RETURNS text LANGUAGE sql IMMUTABLE AS $$
    SELECT 'KSh ' || replace(to_char(round(COALESCE(p, 0), 2), 'FM999,999,999,990.00'), '.00', '')
$$;

CREATE OR REPLACE FUNCTION public.fn_promo_norm_code(p text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
    SELECT upper(regexp_replace(COALESCE(p, ''), '\s', '', 'g'))
$$;

-- Does this redemption use up one of the promotion's uses right now?
CREATE OR REPLACE FUNCTION public.fn_promo_counts(p_status text, p_expires timestamptz) RETURNS boolean
LANGUAGE sql STABLE AS $$
    SELECT p_status IN ('redeemed', 'partially_refunded') OR (p_status = 'reserved' AND p_expires > now())
$$;

CREATE OR REPLACE FUNCTION public.fn_promo_fail(p_reason text, p_hint text DEFAULT NULL) RETURNS jsonb
LANGUAGE sql IMMUTABLE AS $$
    SELECT jsonb_build_object('ok', false, 'reason', p_reason) || CASE WHEN p_hint IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('hint', p_hint) END
$$;

CREATE OR REPLACE FUNCTION public.fn_promo_when(p timestamptz) RETURNS text LANGUAGE sql STABLE AS $$
    SELECT to_char(p AT TIME ZONE 'Africa/Nairobi', 'FMDD Mon YYYY, HH24:MI')
$$;

-- active | off | scheduled | expired | used_up | archived
CREATE OR REPLACE FUNCTION public.fn_promo_status(p public.website_promo_codes) RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
    IF p.archived_at IS NOT NULL THEN RETURN 'archived'; END IF;
    IF NOT p.active THEN RETURN 'off'; END IF;
    IF p.ends_at IS NOT NULL AND p.ends_at <= now() THEN RETURN 'expired'; END IF;
    IF p.starts_at IS NOT NULL AND p.starts_at > now() THEN RETURN 'scheduled'; END IF;
    IF p.max_uses IS NOT NULL AND (SELECT count(*) FROM public.promotion_redemptions r
        WHERE r.promotion_id = p.id AND public.fn_promo_counts(r.status, r.expires_at)) >= p.max_uses THEN
        RETURN 'used_up';
    END IF;
    RETURN 'active';
END;
$$;

-- The employee row of whoever is signed in, at this branch.
CREATE OR REPLACE FUNCTION public.fn_my_employee(p_business_id uuid) RETURNS public.employees
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT e.* FROM public.employees e JOIN public.users u ON u.id = e.user_id
    WHERE u.auth_user_id = auth.uid() AND e.business_id = p_business_id AND e.deleted_at IS NULL
    LIMIT 1
$$;

-- A code typed at the till: this branch's own promotion first, then a sister branch's
-- promotion that was switched on here. System rows (referral welcome) are never typed.
CREATE OR REPLACE FUNCTION public.fn_promo_find(p_business_id uuid, p_code text) RETURNS public.website_promo_codes
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT p.* FROM public.website_promo_codes p
    WHERE p.code = public.fn_promo_norm_code(p_code) AND p.origin <> 'referral_welcome'
      AND (p.business_id = p_business_id
           OR EXISTS (SELECT 1 FROM public.promotion_branches pb WHERE pb.promotion_id = p.id AND pb.business_id = p_business_id))
    ORDER BY (p.business_id = p_business_id) DESC, p.created_at DESC
    LIMIT 1
$$;

-- A new random code: PREFIX + 6 letters/digits that are easy to read out (no 0/O, 1/I).
CREATE OR REPLACE FUNCTION public.fn_promo_new_code(p_business_id uuid, p_prefix text DEFAULT '') RETURNS text
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_chars text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    v_prefix text := left(regexp_replace(upper(COALESCE(p_prefix, '')), '[^A-Z0-9]', '', 'g'), 12);
    v_code text;
    i int;
BEGIN
    FOR attempt IN 1..50 LOOP
        v_code := v_prefix;
        FOR i IN 1..6 LOOP
            v_code := v_code || substr(v_chars, 1 + floor(random() * length(v_chars))::int, 1);
        END LOOP;
        IF NOT EXISTS (SELECT 1 FROM public.website_promo_codes WHERE business_id = p_business_id AND code = v_code) THEN
            RETURN v_code;
        END IF;
    END LOOP;
    RAISE EXCEPTION 'Could not make a free code. Try again.';
END;
$$;

-- ============================================================================ the rules engine
-- Works out one promotion on one cart. Never raises for a rule: returns
--   {ok:false, reason, hint?}  or  {ok:true, discount, subtotal, eligible, lines[], note?}
-- p_items: [{product_id, quantity, unit_price, discount_percentage, product_name?}] as sold.
-- p_other_discount: cart discount and points already taken off (for "can't combine").
-- p_exclude: a redemption not to count as a use (the one being finished).
CREATE OR REPLACE FUNCTION public.fn_promo_evaluate(
    p public.website_promo_codes, p_business_id uuid, p_customer_id uuid, p_items jsonb,
    p_other_discount numeric DEFAULT 0, p_exclude uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_cust   public.customers%ROWTYPE;
    v_items  jsonb;
    v_bad    boolean;
    v_used   int;
    v_cart   numeric;
    v_base   numeric;
    v_q      numeric;
    v_disc_lines boolean;
    v_d      numeric := 0;
    v_note   text;
    v_rqty   numeric;
    v_rnet   numeric;
    v_rname  text;
    v_sets   numeric;
    v_earned numeric;
    v_free   numeric;
    v_reward_elig boolean;
    v_lines  jsonb := '[]'::jsonb;
    v_names  text;
BEGIN
    IF p.id IS NULL THEN
        RETURN public.fn_promo_fail('No promotion uses that code.');
    END IF;
    IF p.archived_at IS NOT NULL THEN
        RETURN public.fn_promo_fail('This promotion has been archived.');
    END IF;
    IF NOT p.active THEN
        RETURN public.fn_promo_fail('This promotion is switched off.');
    END IF;
    IF NOT p.use_pos THEN
        RETURN public.fn_promo_fail('This code is for the online shop only.');
    END IF;
    IF p.starts_at IS NOT NULL AND p.starts_at > now() THEN
        RETURN public.fn_promo_fail('This promotion starts on ' || public.fn_promo_when(p.starts_at) || '.');
    END IF;
    IF p.ends_at IS NOT NULL AND p.ends_at <= now() THEN
        RETURN public.fn_promo_fail('This promotion ended on ' || public.fn_promo_when(p.ends_at) || '.');
    END IF;
    IF p.business_id <> p_business_id AND NOT EXISTS (
        SELECT 1 FROM public.promotion_branches pb WHERE pb.promotion_id = p.id AND pb.business_id = p_business_id) THEN
        RETURN public.fn_promo_fail('This promotion is not on at this branch.');
    END IF;

    IF p.max_uses IS NOT NULL THEN
        SELECT count(*) INTO v_used FROM public.promotion_redemptions r
        WHERE r.promotion_id = p.id AND r.id IS DISTINCT FROM p_exclude AND public.fn_promo_counts(r.status, r.expires_at);
        IF v_used >= p.max_uses THEN
            RETURN public.fn_promo_fail('This promotion has been fully used (' || p.max_uses || ' of ' || p.max_uses || ').');
        END IF;
    END IF;

    -- Who is buying
    IF p_customer_id IS NOT NULL THEN
        SELECT * INTO v_cust FROM public.customers WHERE id = p_customer_id AND deleted_at IS NULL;
        IF NOT FOUND THEN
            RETURN public.fn_promo_fail('That customer was not found.');
        END IF;
    END IF;
    IF p.audience <> 'everyone' OR p.once_per_customer THEN
        IF p_customer_id IS NULL THEN
            RETURN public.fn_promo_fail(CASE p.audience
                WHEN 'selected' THEN 'This code is for particular customers. Choose the customer first.'
                WHEN 'first_purchase' THEN 'This code is for a new customer''s first purchase. Choose the customer first.'
                WHEN 'referral' THEN 'A referral code needs the new customer. Choose or add the customer first.'
                ELSE 'This code can be used once per customer. Choose the customer first.' END);
        END IF;
        IF p.audience = 'selected' AND NOT EXISTS (
            SELECT 1 FROM public.promotion_customers pc WHERE pc.promotion_id = p.id AND pc.customer_id = p_customer_id) THEN
            RETURN public.fn_promo_fail(v_cust.name || ' can''t use this code: it was given to other customers.');
        END IF;
        IF p.audience IN ('first_purchase', 'referral') AND EXISTS (
            SELECT 1 FROM public.transactions t WHERE t.customer_id = p_customer_id AND t.deleted_at IS NULL
              AND (p_exclude IS NULL OR t.promotion_redemption_id IS DISTINCT FROM p_exclude)) THEN  -- not the sale being saved
            RETURN public.fn_promo_fail('This code is for a first purchase, and ' || v_cust.name || ' has bought before.');
        END IF;
        IF p.once_per_customer AND EXISTS (
            SELECT 1 FROM public.promotion_redemptions r
            WHERE r.promotion_id = p.id AND r.customer_id = p_customer_id AND r.id IS DISTINCT FROM p_exclude
              AND public.fn_promo_counts(r.status, r.expires_at)) THEN
            RETURN public.fn_promo_fail(v_cust.name || ' has already used this code.');
        END IF;
    END IF;

    -- The cart, line by line, with what each line costs after its own discount.
    SELECT jsonb_agg(jsonb_build_object(
               'id', x.product_id, 'name', COALESCE(pr.name, x.product_name, 'Item'), 'cat', pr.category,
               'q', x.quantity, 'dp', COALESCE(x.discount_percentage, 0),
               'net', round(x.unit_price * x.quantity * (1 - COALESCE(x.discount_percentage, 0) / 100), 2),
               'elig', (p.product_scope = 'all'
                        OR (p.product_scope = 'products' AND EXISTS (SELECT 1 FROM public.promotion_products pp
                             WHERE pp.promotion_id = p.id AND pp.product_id = x.product_id))
                        OR (p.product_scope = 'categories' AND EXISTS (SELECT 1 FROM public.promotion_categories pc
                             WHERE pc.promotion_id = p.id AND lower(pc.category) = lower(pr.category))))
           ) ORDER BY ord),
           bool_or(x.product_id IS NULL OR x.quantity IS NULL OR x.quantity <= 0 OR x.unit_price IS NULL OR x.unit_price < 0
                   OR COALESCE(x.discount_percentage, 0) NOT BETWEEN 0 AND 100)
    INTO v_items, v_bad
    FROM ROWS FROM (jsonb_to_recordset(COALESCE(p_items, '[]'::jsonb))
             AS (product_id uuid, quantity numeric, unit_price numeric, discount_percentage numeric, product_name text))
         WITH ORDINALITY AS x(product_id, quantity, unit_price, discount_percentage, product_name, ord)
    LEFT JOIN public.products pr ON pr.id = x.product_id;
    IF v_items IS NULL THEN
        RETURN public.fn_promo_fail('Add items to the cart first.');
    END IF;
    IF v_bad THEN
        RETURN public.fn_promo_fail('An item in the cart has a wrong quantity or price.');
    END IF;

    SELECT COALESCE(SUM((e->>'net')::numeric), 0),
           COALESCE(SUM((e->>'net')::numeric) FILTER (WHERE (e->>'elig')::boolean), 0),
           COALESCE(SUM((e->>'q')::numeric) FILTER (WHERE (e->>'elig')::boolean), 0),
           COALESCE(bool_or((e->>'dp')::numeric > 0), false)
    INTO v_cart, v_base, v_q, v_disc_lines
    FROM jsonb_array_elements(v_items) e;

    IF v_base <= 0 THEN
        SELECT string_agg(n, ', ') INTO v_names FROM (
            SELECT pr.name AS n FROM public.promotion_products pp JOIN public.products pr ON pr.id = pp.product_id
            WHERE pp.promotion_id = p.id
            UNION ALL SELECT pc.category FROM public.promotion_categories pc WHERE pc.promotion_id = p.id
            ORDER BY 1 LIMIT 6) s;
        RETURN public.fn_promo_fail('None of the items in the cart are part of this promotion.',
            CASE WHEN v_names IS NOT NULL THEN 'It covers: ' || v_names || '.' END);
    END IF;

    IF NOT p.stackable AND (v_disc_lines OR COALESCE(p_other_discount, 0) > 0.004) THEN
        RETURN public.fn_promo_fail('This promotion can''t be combined with other discounts.',
            'Remove the other discount (item %, cart discount or points) first.');
    END IF;

    IF v_base < p.min_order THEN
        RETURN public.fn_promo_fail('Spend at least ' || public.fn_ksh(p.min_order)
            || CASE WHEN p.product_scope <> 'all' THEN ' on the promotion''s items' ELSE '' END
            || ' to use this code. The cart has ' || public.fn_ksh(v_base) || '.',
            'Add ' || public.fn_ksh(p.min_order - v_base) || ' more.');
    END IF;

    -- What it gives
    IF p.kind = 'percent' THEN
        v_d := round(v_base * p.value / 100, 2);
    ELSIF p.kind = 'amount' THEN
        v_d := LEAST(p.value, v_base);
    ELSIF p.kind = 'free_items' THEN
        SELECT COALESCE(SUM((e->>'q')::numeric), 0), COALESCE(SUM((e->>'net')::numeric), 0), bool_or((e->>'elig')::boolean)
        INTO v_rqty, v_rnet, v_reward_elig
        FROM jsonb_array_elements(v_items) e WHERE e->>'id' = p.reward_product_id::text;
        SELECT name INTO v_rname FROM public.products WHERE id = p.reward_product_id;
        v_rname := COALESCE(v_rname, 'the free item');
        IF p.buy_qty IS NOT NULL THEN
            -- Buy X get Y: every buy_qty of the covered items earns reward_qty free. When the
            -- free item is itself covered, a set is buy_qty + reward_qty of them.
            IF COALESCE(v_reward_elig, false) THEN
                v_sets := floor(v_q / (p.buy_qty + p.reward_qty));
                IF v_sets = 0 AND v_q >= p.buy_qty THEN
                    RETURN public.fn_promo_fail('Add ' || trim(to_char(p.buy_qty + p.reward_qty - v_q, 'FM999990.###')) || ' more ' || v_rname || ': it''s free with this code.');
                END IF;
            ELSE
                v_sets := floor(v_q / p.buy_qty);
            END IF;
            IF v_sets = 0 THEN
                RETURN public.fn_promo_fail('Buy at least ' || trim(to_char(p.buy_qty, 'FM999990.###')) || ' of the promotion''s items to get '
                    || trim(to_char(p.reward_qty, 'FM999990.###')) || ' ' || v_rname || ' free. The cart has ' || trim(to_char(v_q, 'FM999990.###')) || '.');
            END IF;
            v_earned := v_sets * p.reward_qty;
        ELSE
            v_earned := p.reward_qty;
        END IF;
        IF COALESCE(v_rqty, 0) <= 0 THEN
            RETURN public.fn_promo_fail('Add ' || trim(to_char(v_earned, 'FM999990.###')) || ' ' || v_rname || ' to the cart: it''s free with this code.');
        END IF;
        v_free := LEAST(v_earned, v_rqty);
        v_d := round(v_rnet / v_rqty * v_free, 2);
        IF v_free < v_earned THEN
            v_note := 'Add ' || trim(to_char(v_earned - v_free, 'FM999990.###')) || ' more ' || v_rname || ': also free.';
        END IF;
    END IF;

    IF p.kind <> 'none' AND v_d <= 0 THEN
        RETURN public.fn_promo_fail('This promotion gives nothing off this cart.');
    END IF;
    IF p.max_discount IS NOT NULL AND v_d > p.max_discount THEN
        v_d := p.max_discount;
        v_note := 'Capped at the ' || public.fn_ksh(p.max_discount) || ' most this promotion gives.';
    END IF;
    v_d := LEAST(v_d, v_cart);

    -- Share the discount over the lines it came from (for the per-product report).
    IF v_d > 0 THEN
        WITH t AS (
            SELECT e, (e->>'net')::numeric AS net,
                   row_number() OVER (ORDER BY (e->>'net')::numeric DESC) AS rn
            FROM jsonb_array_elements(v_items) e
            WHERE CASE WHEN p.kind = 'free_items' THEN e->>'id' = p.reward_product_id::text ELSE (e->>'elig')::boolean END
        ), s AS (SELECT SUM(net) AS tot FROM t),
        a AS (SELECT t.e, t.rn, CASE WHEN s.tot > 0 THEN round(v_d * t.net / s.tot, 2) ELSE 0 END AS share FROM t, s),
        f AS (SELECT SUM(share) AS ss FROM a)
        SELECT jsonb_agg(jsonb_build_object('productId', a.e->>'id', 'name', a.e->>'name', 'category', a.e->>'cat',
                   'quantity', (a.e->>'q')::numeric, 'net', (a.e->>'net')::numeric,
                   'discount', a.share + CASE WHEN a.rn = 1 THEN v_d - f.ss ELSE 0 END) ORDER BY a.rn)
        INTO v_lines FROM a, f;
    END IF;

    RETURN jsonb_build_object('ok', true, 'discount', v_d, 'subtotal', v_cart, 'eligible', v_base,
                              'lines', COALESCE(v_lines, '[]'::jsonb))
           || CASE WHEN v_note IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('note', v_note) END;
END;
$$;

-- What the till shows about a promotion.
CREATE OR REPLACE FUNCTION public.fn_promo_summary(p public.website_promo_codes) RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_r text;
BEGIN
    SELECT name INTO v_r FROM public.products WHERE id = p.reward_product_id;
    RETURN CASE p.kind
        WHEN 'percent' THEN trim(to_char(p.value, 'FM990.##')) || '% off'
        WHEN 'amount' THEN public.fn_ksh(p.value) || ' off'
        WHEN 'free_items' THEN CASE WHEN p.buy_qty IS NOT NULL
            THEN 'Buy ' || trim(to_char(p.buy_qty, 'FM999990.###')) || ', get ' || trim(to_char(p.reward_qty, 'FM999990.###')) || ' ' || COALESCE(v_r, 'item') || ' free'
            ELSE trim(to_char(p.reward_qty, 'FM999990.###')) || ' ' || COALESCE(v_r, 'item') || ' free' END
        ELSE 'Referral' END
        || CASE WHEN p.min_order > 0 THEN ' on ' || public.fn_ksh(p.min_order) || ' or more' ELSE '' END;
END;
$$;

-- ============================================================================ till RPCs
-- Preview: is the code good for this cart, and what does it take off? Changes nothing.
CREATE OR REPLACE FUNCTION public.promo_check(
    p_business_id uuid, p_code text, p_customer_id uuid, p_items jsonb, p_other_discount numeric DEFAULT 0
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
    p public.website_promo_codes;
    v jsonb;
BEGIN
    PERFORM public.assert_business_member(p_business_id);
    PERFORM public.assert_permission(p_business_id, 'pos.apply_promotion');
    IF public.fn_promo_norm_code(p_code) = '' THEN
        RETURN public.fn_promo_fail('Type a code first.');
    END IF;
    p := public.fn_promo_find(p_business_id, p_code);
    IF p.id IS NULL THEN
        RETURN public.fn_promo_fail('No promotion uses the code ' || public.fn_promo_norm_code(p_code) || '.');
    END IF;
    v := public.fn_promo_evaluate(p, p_business_id, p_customer_id, p_items, p_other_discount);
    RETURN v || jsonb_build_object('code', p.code, 'name', COALESCE(p.name, p.code), 'promotionId', p.id,
                                   'summary', public.fn_promo_summary(p), 'kind', p.kind);
END;
$$;

-- Hold one use of the code for this sale and return the server's discount.
CREATE OR REPLACE FUNCTION public.promo_reserve(
    p_business_id uuid, p_code text, p_customer_id uuid, p_items jsonb,
    p_other_discount numeric DEFAULT 0, p_reference_id text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
    p   public.website_promo_codes;
    v   jsonb;
    e   public.employees;
    v_id uuid;
BEGIN
    PERFORM public.assert_business_member(p_business_id);
    PERFORM public.assert_permission(p_business_id, 'pos.apply_promotion');
    p := public.fn_promo_find(p_business_id, p_code);
    IF p.id IS NULL THEN
        RAISE EXCEPTION 'No promotion uses the code %.', public.fn_promo_norm_code(p_code);
    END IF;
    -- One till at a time per promotion, so two sales can't both take its last use.
    PERFORM 1 FROM public.website_promo_codes WHERE id = p.id FOR UPDATE;
    SELECT * INTO p FROM public.website_promo_codes WHERE id = p.id;
    v := public.fn_promo_evaluate(p, p_business_id, p_customer_id, p_items, p_other_discount);
    IF NOT (v->>'ok')::boolean THEN
        RAISE EXCEPTION '%', v->>'reason';
    END IF;
    e := public.fn_my_employee(p_business_id);
    INSERT INTO public.promotion_redemptions (promotion_id, code, business_id, channel, customer_id, staff_id, staff_name,
        status, discount, subtotal, lines, reference_id, expires_at)
    VALUES (p.id, p.code, p_business_id, 'pos', p_customer_id, e.id, e.name, 'reserved',
        (v->>'discount')::numeric, (v->>'subtotal')::numeric, v->'lines', p_reference_id, now() + interval '20 minutes')
    RETURNING id INTO v_id;
    RETURN v || jsonb_build_object('redemptionId', v_id, 'code', p.code, 'name', COALESCE(p.name, p.code),
                                   'summary', public.fn_promo_summary(p), 'expiresAt', now() + interval '20 minutes');
END;
$$;

-- The sale didn't happen: give the held use back now.
CREATE OR REPLACE FUNCTION public.promo_release(p_redemption_id uuid) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.promotion_redemptions%ROWTYPE;
BEGIN
    SELECT * INTO r FROM public.promotion_redemptions WHERE id = p_redemption_id FOR UPDATE;
    IF NOT FOUND THEN RETURN; END IF;
    PERFORM public.assert_business_member(r.business_id);
    PERFORM public.assert_permission(r.business_id, 'pos.apply_promotion');
    UPDATE public.promotion_redemptions SET status = 'released', ended_at = now(), end_reason = 'Sale not completed'
    WHERE id = r.id AND status = 'reserved' AND transaction_id IS NULL;
END;
$$;

-- ============================================================================ limits, at every write
-- Whatever writes a use (till, online shop, a finished hold), the promotion row is locked
-- and the limits are checked again, so two at once can't go over.
CREATE OR REPLACE FUNCTION public.fn_promo_redemption_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE p public.website_promo_codes%ROWTYPE;
BEGIN
    IF NOT public.fn_promo_counts(NEW.status, NEW.expires_at) THEN RETURN NEW; END IF;
    IF TG_OP = 'UPDATE' AND public.fn_promo_counts(OLD.status, OLD.expires_at) THEN RETURN NEW; END IF;
    SELECT * INTO p FROM public.website_promo_codes WHERE id = NEW.promotion_id FOR UPDATE;
    IF p.max_uses IS NOT NULL AND (SELECT count(*) FROM public.promotion_redemptions r
        WHERE r.promotion_id = p.id AND r.id <> NEW.id AND public.fn_promo_counts(r.status, r.expires_at)) >= p.max_uses THEN
        RAISE EXCEPTION 'This promotion has been fully used (% of %).', p.max_uses, p.max_uses;
    END IF;
    IF p.once_per_customer AND NEW.customer_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.promotion_redemptions r
        WHERE r.promotion_id = p.id AND r.id <> NEW.id AND r.customer_id = NEW.customer_id
          AND public.fn_promo_counts(r.status, r.expires_at)) THEN
        RAISE EXCEPTION 'This customer has already used the code %.', p.code;
    END IF;
    IF p.once_per_customer AND NEW.account_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.promotion_redemptions r
        WHERE r.promotion_id = p.id AND r.id <> NEW.id AND r.account_id = NEW.account_id
          AND public.fn_promo_counts(r.status, r.expires_at)) THEN
        RAISE EXCEPTION 'You have already used that promo code.';
    END IF;
    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_promo_redemption_guard ON public.promotion_redemptions;
CREATE TRIGGER trg_promo_redemption_guard BEFORE INSERT OR UPDATE OF status ON public.promotion_redemptions
    FOR EACH ROW EXECUTE FUNCTION public.fn_promo_redemption_guard();

-- ============================================================================ the sale and its redemption
-- Before a sale is written: the promotion part of the discount is copied from the hold, so
-- the app can't claim a different one, and the link can't be moved later.
CREATE OR REPLACE FUNCTION public.fn_sale_promotion_stamp() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.promotion_redemptions%ROWTYPE;
BEGIN
    IF TG_OP = 'UPDATE' THEN
        IF NEW.promotion_redemption_id IS DISTINCT FROM OLD.promotion_redemption_id
           OR NEW.promotion_discount IS DISTINCT FROM OLD.promotion_discount
           OR NEW.promotion_code IS DISTINCT FROM OLD.promotion_code THEN
            RAISE EXCEPTION 'A sale''s promotion can''t be changed after the sale. Refund it and sell again.';
        END IF;
        RETURN NEW;
    END IF;
    IF NEW.promotion_redemption_id IS NULL THEN
        NEW.promotion_code := NULL;
        NEW.promotion_discount := 0;
        RETURN NEW;
    END IF;
    SELECT * INTO r FROM public.promotion_redemptions WHERE id = NEW.promotion_redemption_id;
    IF NOT FOUND OR r.business_id <> NEW.business_id OR r.channel <> 'pos' THEN
        RAISE EXCEPTION 'That promotion hold is not for this branch. Apply the code again.';
    END IF;
    NEW.promotion_code := r.code;
    NEW.promotion_discount := r.discount;
    IF NEW.discount + 0.009 < r.discount THEN
        RAISE EXCEPTION 'The sale''s discount (%) is less than the promotion''s (%).', NEW.discount, r.discount;
    END IF;
    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_0_sale_promotion_stamp ON public.transactions;
CREATE TRIGGER trg_0_sale_promotion_stamp BEFORE INSERT OR UPDATE ON public.transactions
    FOR EACH ROW EXECUTE FUNCTION public.fn_sale_promotion_stamp();

-- Hook for the referral program (20261126002) to run when a promotion sale is final.
CREATE OR REPLACE FUNCTION public.fn_promo_after_redeem(p_redemption_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$ BEGIN RETURN; END; $$;
CREATE OR REPLACE FUNCTION public.fn_promo_after_end(p_redemption_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$ BEGIN RETURN; END; $$;

-- When the sale commits (its items are written by then): work the promotion out again from
-- what was actually sold and finish the redemption, or refuse the whole sale.
CREATE OR REPLACE FUNCTION public.fn_sale_promotion_commit() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    r       public.promotion_redemptions%ROWTYPE;
    p       public.website_promo_codes%ROWTYPE;
    t       public.transactions%ROWTYPE;
    v_items jsonb;
    v_line  numeric;
    v_other numeric;
    v       jsonb;
BEGIN
    SELECT * INTO t FROM public.transactions WHERE id = NEW.id;
    IF NOT FOUND OR t.promotion_redemption_id IS NULL THEN RETURN NULL; END IF;
    SELECT * INTO r FROM public.promotion_redemptions WHERE id = t.promotion_redemption_id FOR UPDATE;
    IF r.transaction_id = t.id AND r.status <> 'reserved' THEN RETURN NULL; END IF; -- already done
    IF r.transaction_id IS NOT NULL AND r.transaction_id <> t.id THEN
        RAISE EXCEPTION 'That promotion was already used on another sale.';
    END IF;
    IF r.status NOT IN ('reserved', 'expired') THEN
        RAISE EXCEPTION 'The promotion hold was given back. Apply the code again.';
    END IF;
    SELECT * INTO p FROM public.website_promo_codes WHERE id = r.promotion_id FOR UPDATE;

    SELECT jsonb_agg(jsonb_build_object('product_id', product_id, 'quantity', quantity, 'unit_price', unit_price,
                                        'discount_percentage', discount_percentage, 'product_name', product_name)),
           COALESCE(SUM(round(unit_price * quantity * discount_percentage / 100, 2)), 0)
    INTO v_items, v_line
    FROM public.transaction_items WHERE transaction_id = t.id;
    v_other := round(t.discount - v_line - r.discount, 2);
    IF v_other < -0.05 THEN
        RAISE EXCEPTION 'The sale''s discount doesn''t include the promotion''s %.', public.fn_ksh(r.discount);
    END IF;

    v := public.fn_promo_evaluate(p, t.business_id, t.customer_id, v_items, GREATEST(v_other, 0), r.id);
    IF NOT (v->>'ok')::boolean THEN
        RAISE EXCEPTION 'Promotion %: %', p.code, v->>'reason';
    END IF;
    IF abs((v->>'discount')::numeric - r.discount) > 0.01 THEN
        RAISE EXCEPTION 'The cart changed after % was applied (it now gives %, not %). Apply the code again.',
            p.code, public.fn_ksh((v->>'discount')::numeric), public.fn_ksh(r.discount);
    END IF;

    UPDATE public.promotion_redemptions
    SET status = 'redeemed', transaction_id = t.id, customer_id = t.customer_id,
        staff_id = COALESCE(t.staff_id, staff_id), staff_name = COALESCE(t.staff_name, staff_name),
        sale_total = t.final_total, subtotal = (v->>'subtotal')::numeric, lines = v->'lines',
        redeemed_at = now(), expires_at = NULL
    WHERE id = r.id;
    PERFORM public.fn_promo_after_redeem(r.id);
    RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS trg_sale_promotion_commit ON public.transactions;
CREATE CONSTRAINT TRIGGER trg_sale_promotion_commit AFTER INSERT ON public.transactions
    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN (NEW.promotion_redemption_id IS NOT NULL)
    EXECUTE FUNCTION public.fn_sale_promotion_commit();

-- A cancelled (deleted) sale gives its use back.
CREATE OR REPLACE FUNCTION public.fn_sale_promotion_cancel() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid := CASE WHEN TG_OP = 'DELETE' THEN OLD.promotion_redemption_id ELSE NEW.promotion_redemption_id END;
BEGIN
    IF v_id IS NULL THEN RETURN NULL; END IF;
    UPDATE public.promotion_redemptions
    SET status = 'cancelled', ended_at = now(), end_reason = 'Sale cancelled'
    WHERE id = v_id AND status IN ('reserved', 'expired', 'redeemed', 'partially_refunded');
    IF FOUND THEN PERFORM public.fn_promo_after_end(v_id); END IF;
    RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS trg_sale_promotion_cancel ON public.transactions;
CREATE TRIGGER trg_sale_promotion_cancel AFTER UPDATE OF deleted_at ON public.transactions
    FOR EACH ROW WHEN (OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL AND NEW.promotion_redemption_id IS NOT NULL)
    EXECUTE FUNCTION public.fn_sale_promotion_cancel();
DROP TRIGGER IF EXISTS trg_sale_promotion_delete ON public.transactions;
CREATE TRIGGER trg_sale_promotion_delete AFTER DELETE ON public.transactions
    FOR EACH ROW WHEN (OLD.promotion_redemption_id IS NOT NULL)
    EXECUTE FUNCTION public.fn_sale_promotion_cancel();

-- Refunds (credit notes against the sale): all of it back frees the use; part keeps it.
CREATE OR REPLACE FUNCTION public.fn_sale_promotion_refund() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_rid  uuid;
    v_tot  numeric;
    v_back numeric;
    v_new  text;
BEGIN
    SELECT promotion_redemption_id, final_total INTO v_rid, v_tot FROM public.transactions WHERE id = NEW.transaction_id;
    IF v_rid IS NULL THEN RETURN NULL; END IF;
    SELECT COALESCE(SUM(total), 0) INTO v_back FROM public.credit_notes WHERE transaction_id = NEW.transaction_id;
    v_new := CASE WHEN v_back >= v_tot - 0.01 THEN 'refunded' WHEN v_back > 0 THEN 'partially_refunded' ELSE 'redeemed' END;
    UPDATE public.promotion_redemptions
    SET refunded_amount = v_back, status = v_new,
        ended_at = CASE WHEN v_new = 'refunded' THEN now() ELSE ended_at END,
        end_reason = CASE WHEN v_new = 'refunded' THEN 'Sale refunded' ELSE end_reason END
    WHERE id = v_rid AND status IN ('redeemed', 'partially_refunded');
    IF FOUND THEN PERFORM public.fn_promo_after_end(v_rid); END IF;
    RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS trg_sale_promotion_refund ON public.credit_notes;
CREATE TRIGGER trg_sale_promotion_refund AFTER INSERT OR UPDATE OF total ON public.credit_notes
    FOR EACH ROW WHEN (NEW.transaction_id IS NOT NULL) EXECUTE FUNCTION public.fn_sale_promotion_refund();

-- ============================================================================ online shop
-- Online orders write a redemption as well, so limits and reports see both channels.
CREATE OR REPLACE FUNCTION public.fn_order_promotion_sync() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    IF NEW.promo_code_id IS NULL THEN RETURN NULL; END IF;
    IF NOT EXISTS (SELECT 1 FROM public.promotion_redemptions WHERE order_id = NEW.id) THEN
        INSERT INTO public.promotion_redemptions (promotion_id, code, business_id, channel, order_id, account_id,
            customer_id, status, discount, subtotal, sale_total, redeemed_at, ended_at, end_reason)
        VALUES (NEW.promo_code_id, COALESCE(NEW.promo_code, ''), NEW.business_id, 'online', NEW.id, NEW.account_id,
            (SELECT a.customer_id FROM public.customer_accounts a WHERE a.id = NEW.account_id),
            CASE WHEN NEW.status = 'cancelled' THEN 'cancelled' ELSE 'redeemed' END,
            NEW.promo_value, NEW.subtotal, NEW.total, now(),
            CASE WHEN NEW.status = 'cancelled' THEN now() END,
            CASE WHEN NEW.status = 'cancelled' THEN 'Order cancelled' END);
    ELSIF NEW.status = 'cancelled' THEN
        UPDATE public.promotion_redemptions SET status = 'cancelled', ended_at = now(), end_reason = 'Order cancelled'
        WHERE order_id = NEW.id AND status IN ('redeemed', 'partially_refunded');
    ELSE
        UPDATE public.promotion_redemptions SET discount = NEW.promo_value, sale_total = NEW.total
        WHERE order_id = NEW.id AND status = 'redeemed' AND (discount <> NEW.promo_value OR sale_total IS DISTINCT FROM NEW.total);
    END IF;
    RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS trg_order_promotion_sync ON public.online_orders;
CREATE TRIGGER trg_order_promotion_sync AFTER INSERT OR UPDATE OF promo_code_id, status, promo_value ON public.online_orders
    FOR EACH ROW EXECUTE FUNCTION public.fn_order_promotion_sync();

-- Orders placed before this.
INSERT INTO public.promotion_redemptions (promotion_id, code, business_id, channel, order_id, account_id, status,
    discount, subtotal, sale_total, redeemed_at, created_at)
SELECT o.promo_code_id, COALESCE(o.promo_code, ''), o.business_id, 'online', o.id, o.account_id,
       CASE WHEN o.status = 'cancelled' THEN 'cancelled' ELSE 'redeemed' END,
       o.promo_value, o.subtotal, o.total, o.created_at, o.created_at
FROM public.online_orders o
WHERE o.promo_code_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.promotion_redemptions r WHERE r.order_id = o.id);

-- The online shop's own check: same table, now with the till-only, archive, cap and the
-- shared use count.
CREATE OR REPLACE FUNCTION public.fn_promo_value(p_promo public.website_promo_codes, p_subtotal numeric, p_account_id uuid)
RETURNS numeric LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uses integer;
BEGIN
    IF p_promo.archived_at IS NOT NULL OR p_promo.origin <> 'manual' OR NOT p_promo.active
       OR (p_promo.starts_at IS NOT NULL AND now() < p_promo.starts_at) THEN
        RAISE EXCEPTION 'That promo code isn''t active yet.';
    END IF;
    IF NOT p_promo.use_online THEN
        RAISE EXCEPTION 'That code can only be used in our shop.';
    END IF;
    IF p_promo.ends_at IS NOT NULL AND now() >= p_promo.ends_at THEN
        RAISE EXCEPTION 'That promo code has expired.';
    END IF;
    IF p_subtotal < p_promo.min_order THEN
        RAISE EXCEPTION 'That code needs an order of at least % in products.', p_promo.min_order;
    END IF;
    IF p_promo.max_uses IS NOT NULL THEN
        SELECT count(*) INTO v_uses FROM public.promotion_redemptions r
        WHERE r.promotion_id = p_promo.id AND public.fn_promo_counts(r.status, r.expires_at);
        IF v_uses >= p_promo.max_uses THEN
            RAISE EXCEPTION 'That promo code has been fully used.';
        END IF;
    END IF;
    IF p_account_id IS NOT NULL AND p_promo.once_per_customer AND EXISTS (
        SELECT 1 FROM public.promotion_redemptions r
        WHERE r.promotion_id = p_promo.id AND r.account_id = p_account_id AND public.fn_promo_counts(r.status, r.expires_at)
    ) THEN
        RAISE EXCEPTION 'You have already used that promo code.';
    END IF;
    RETURN LEAST(p_subtotal, COALESCE(p_promo.max_discount, p_subtotal),
        CASE WHEN p_promo.kind = 'percent' THEN round(p_subtotal * p_promo.value / 100, 2) ELSE p_promo.value END);
END;
$$;

-- ============================================================================ till sale in one go
-- A paid sale with a promotion: header and items in one database transaction, so the
-- deferred check above sees the items. Runs as the caller: the same row rules as the app's
-- own inserts apply (pos.create_sale).
CREATE OR REPLACE FUNCTION public.record_till_sale(p_sale jsonb, p_items jsonb) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = public AS $$
DECLARE
    v_id  uuid;
    v_b   uuid := (p_sale->>'business_id')::uuid;
    v_ref text := NULLIF(p_sale->>'reference_id', '');
BEGIN
    IF v_ref IS NOT NULL THEN
        SELECT id INTO v_id FROM public.transactions WHERE business_id = v_b AND reference_id = v_ref AND deleted_at IS NULL;
        IF FOUND THEN RETURN v_id; END IF;
    END IF;
    IF COALESCE(p_sale->>'payment_method', '') IN ('Credit', 'Credit_Debt') THEN
        RAISE EXCEPTION 'Credit sales are saved with process_customer_transaction.';
    END IF;
    IF jsonb_array_length(COALESCE(p_items, '[]'::jsonb)) = 0 THEN
        RAISE EXCEPTION 'The cart is empty.';
    END IF;
    INSERT INTO public.transactions (id, business_id, total, discount, tax, final_total, amount_paid, wallet_applied,
        payment_method, customer_id, customer_name, staff_id, staff_name, status, timestamp, note, is_delivery,
        delivery_fee, delivery_mode, rider_pay, rider_name, reference_id, promotion_redemption_id)
    VALUES (COALESCE((p_sale->>'id')::uuid, gen_random_uuid()), v_b,
        (p_sale->>'total')::numeric, COALESCE((p_sale->>'discount')::numeric, 0), COALESCE((p_sale->>'tax')::numeric, 0),
        (p_sale->>'final_total')::numeric, (p_sale->>'final_total')::numeric, 0,
        (p_sale->>'payment_method')::public.payment_method, (p_sale->>'customer_id')::uuid, NULLIF(p_sale->>'customer_name', ''),
        (p_sale->>'staff_id')::uuid, COALESCE(p_sale->>'staff_name', 'Staff'), 'Synced',
        COALESCE((p_sale->>'timestamp')::timestamptz, now()), p_sale->>'note', COALESCE((p_sale->>'is_delivery')::boolean, false),
        COALESCE((p_sale->>'delivery_fee')::numeric, 0),
        CASE WHEN COALESCE((p_sale->>'is_delivery')::boolean, false) THEN COALESCE(p_sale->>'delivery_mode', 'charged') ELSE 'charged' END,
        CASE WHEN COALESCE((p_sale->>'is_delivery')::boolean, false) THEN GREATEST(COALESCE((p_sale->>'rider_pay')::numeric, 0), 0) ELSE 0 END,
        NULLIF(p_sale->>'rider_name', ''), v_ref, (p_sale->>'promotion_redemption_id')::uuid)
    RETURNING id INTO v_id;
    INSERT INTO public.transaction_items (transaction_id, product_id, product_name, unit_price, quantity, discount_percentage, line_total)
    SELECT v_id, x.product_id, COALESCE(x.product_name, 'Item'), x.unit_price, x.quantity, COALESCE(x.discount_percentage, 0),
           round(x.unit_price * (1 - COALESCE(x.discount_percentage, 0) / 100) * x.quantity, 2)
    FROM jsonb_to_recordset(p_items) AS x(product_id uuid, product_name text, unit_price numeric, quantity numeric, discount_percentage numeric);
    RETURN v_id;
END;
$$;

-- ============================================================================ managing promotions
-- One call saves a promotion with what it covers, who and where. p_doc keys (camelCase):
-- name, code, description, promoType, kind, value, maxDiscount, minOrder, startsAt, endsAt,
-- maxUses, oncePerCustomer, stackable, audience, productScope, productIds[], categories[],
-- customerIds[], branchIds[], buyQty, rewardProductId, rewardQty, usePos, useOnline,
-- showOnWebsite, active.
CREATE OR REPLACE FUNCTION public.save_promotion(p_business_id uuid, p_id uuid, p_doc jsonb) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
    d        jsonb := COALESCE(p_doc, '{}'::jsonb);
    v_type   text := COALESCE(d->>'promoType', 'percentage');
    v_kind   text := d->>'kind';
    v_aud    text := COALESCE(d->>'audience', 'everyone');
    v_scope  text := COALESCE(d->>'productScope', 'all');
    v_code   text := public.fn_promo_norm_code(d->>'code');
    v_name   text := NULLIF(trim(COALESCE(d->>'name', '')), '');
    v_value  numeric := COALESCE(NULLIF(d->>'value', '')::numeric, 0);
    v_min    numeric := COALESCE(NULLIF(d->>'minOrder', '')::numeric, 0);
    v_maxd   numeric := NULLIF(d->>'maxDiscount', '')::numeric;
    v_uses   int := NULLIF(d->>'maxUses', '')::int;
    v_start  timestamptz := NULLIF(d->>'startsAt', '')::timestamptz;
    v_end    timestamptz := NULLIF(d->>'endsAt', '')::timestamptz;
    v_buy    numeric := NULLIF(d->>'buyQty', '')::numeric;
    v_rprod  uuid := NULLIF(d->>'rewardProductId', '')::uuid;
    v_rqty   numeric := NULLIF(d->>'rewardQty', '')::numeric;
    v_pos    boolean := COALESCE((d->>'usePos')::boolean, true);
    v_online boolean := COALESCE((d->>'useOnline')::boolean, false);
    v_show   boolean := COALESCE((d->>'showOnWebsite')::boolean, false);
    v_by     text;
    v_old    public.website_promo_codes%ROWTYPE;
    v_id     uuid;
    v_n      int;
BEGIN
    PERFORM public.assert_business_member(p_business_id);
    PERFORM public.assert_permission(p_business_id, 'promotions.manage');
    v_by := COALESCE((public.fn_my_employee(p_business_id)).name, 'Staff');

    IF p_id IS NOT NULL THEN
        SELECT * INTO v_old FROM public.website_promo_codes WHERE id = p_id AND business_id = p_business_id FOR UPDATE;
        IF NOT FOUND THEN RAISE EXCEPTION 'That promotion was not found at this branch.'; END IF;
        IF v_old.origin <> 'manual' THEN RAISE EXCEPTION 'Referral codes and rewards are managed in Promotions → Referrals.'; END IF;
        IF v_old.archived_at IS NOT NULL THEN RAISE EXCEPTION 'Restore the promotion before changing it.'; END IF;
    END IF;

    -- What each type means. The type only presets the generic fields.
    IF v_type = 'referral' THEN
        RAISE EXCEPTION 'Referral codes belong to customers: set them up in Promotions → Referrals.';
    ELSIF v_type = 'percentage' THEN v_kind := 'percent';
    ELSIF v_type = 'fixed' THEN v_kind := 'amount';
    ELSIF v_type = 'buy_x_get_y' THEN
        v_kind := 'free_items';
        IF v_buy IS NULL OR v_buy <= 0 THEN RAISE EXCEPTION 'Say how many the customer must buy.'; END IF;
    ELSIF v_type = 'free_product' THEN v_kind := 'free_items'; v_buy := NULL;
    ELSIF v_type = 'min_spend' THEN
        IF v_min <= 0 THEN RAISE EXCEPTION 'Say how much the customer must spend.'; END IF;
    ELSIF v_type = 'customer' THEN v_aud := 'selected';
    ELSIF v_type = 'first_purchase' THEN v_aud := 'first_purchase';
    ELSE RAISE EXCEPTION 'Unknown promotion type %.', v_type;
    END IF;
    IF v_kind IS NULL OR v_kind NOT IN ('percent', 'amount', 'free_items') THEN
        RAISE EXCEPTION 'Choose what the promotion gives: a percentage, an amount or free items.';
    END IF;
    IF v_aud NOT IN ('everyone', 'selected', 'first_purchase') THEN RAISE EXCEPTION 'Choose who can use the code.'; END IF;
    IF v_scope NOT IN ('all', 'products', 'categories') THEN RAISE EXCEPTION 'Choose what the promotion covers.'; END IF;
    IF v_kind <> 'free_items' THEN v_buy := NULL; v_rprod := NULL; v_rqty := NULL; END IF;

    IF v_name IS NULL THEN RAISE EXCEPTION 'Give the promotion a name.'; END IF;
    IF length(v_name) > 80 THEN RAISE EXCEPTION 'Keep the name under 80 characters.'; END IF;
    IF v_code = '' THEN v_code := public.fn_promo_new_code(p_business_id); END IF;
    IF v_code !~ '^[A-Z0-9][A-Z0-9-]{2,23}$' THEN
        RAISE EXCEPTION 'A code is 3 to 24 letters, numbers or dashes, starting with a letter or number.';
    END IF;
    IF v_kind = 'percent' AND (v_value <= 0 OR v_value > 90) THEN RAISE EXCEPTION 'A percentage is between 1 and 90.'; END IF;
    IF v_kind = 'amount' AND v_value <= 0 THEN RAISE EXCEPTION 'Type the amount off.'; END IF;
    IF v_kind = 'free_items' THEN
        IF v_rprod IS NULL OR NOT EXISTS (SELECT 1 FROM public.products WHERE id = v_rprod AND business_id = p_business_id) THEN
            RAISE EXCEPTION 'Choose the free product.';
        END IF;
        IF v_rqty IS NULL OR v_rqty <= 0 THEN RAISE EXCEPTION 'Say how many are free.'; END IF;
        v_value := 0;
    END IF;
    IF v_min < 0 THEN RAISE EXCEPTION 'The minimum purchase can''t be below zero.'; END IF;
    IF v_maxd IS NOT NULL AND v_maxd <= 0 THEN v_maxd := NULL; END IF;
    IF v_uses IS NOT NULL AND v_uses <= 0 THEN RAISE EXCEPTION 'The number of uses must be at least 1, or left empty for no limit.'; END IF;
    IF v_start IS NOT NULL AND v_end IS NOT NULL AND v_end <= v_start THEN RAISE EXCEPTION 'The end must be after the start.'; END IF;
    IF v_online AND (v_kind NOT IN ('percent', 'amount') OR v_aud <> 'everyone' OR v_scope <> 'all') THEN
        RAISE EXCEPTION 'The online shop takes only percentage or amount codes for everyone on all products.';
    END IF;
    IF NOT v_pos AND NOT v_online THEN RAISE EXCEPTION 'Choose where the code works: at the till, online, or both.'; END IF;
    IF NOT v_online THEN v_show := false; END IF;
    IF v_scope = 'products' AND jsonb_array_length(COALESCE(d->'productIds', '[]')) = 0 THEN RAISE EXCEPTION 'Choose the products it covers.'; END IF;
    IF v_scope = 'categories' AND jsonb_array_length(COALESCE(d->'categories', '[]')) = 0 THEN RAISE EXCEPTION 'Choose the categories it covers.'; END IF;
    IF v_aud = 'selected' AND jsonb_array_length(COALESCE(d->'customerIds', '[]')) = 0 THEN RAISE EXCEPTION 'Choose the customers who can use it.'; END IF;

    -- Codes are unique at this branch and at every branch it is switched on.
    IF EXISTS (SELECT 1 FROM public.website_promo_codes WHERE business_id = p_business_id AND code = v_code AND id IS DISTINCT FROM p_id) THEN
        RAISE EXCEPTION 'The code % is already used here. Choose another.', v_code;
    END IF;
    SELECT count(*) INTO v_n FROM jsonb_array_elements_text(COALESCE(d->'branchIds', '[]')) bid
    WHERE bid::uuid <> p_business_id AND (
        NOT public.fn_branches_share_owner(p_business_id, bid::uuid)
        OR EXISTS (SELECT 1 FROM public.website_promo_codes x WHERE x.business_id = bid::uuid AND x.code = v_code)
        OR EXISTS (SELECT 1 FROM public.promotion_branches pb JOIN public.website_promo_codes x ON x.id = pb.promotion_id
                   WHERE pb.business_id = bid::uuid AND x.code = v_code AND x.id IS DISTINCT FROM p_id));
    IF v_n > 0 THEN
        RAISE EXCEPTION 'The code % is already used at one of the chosen branches, or a branch isn''t yours.', v_code;
    END IF;

    IF p_id IS NULL THEN
        INSERT INTO public.website_promo_codes (business_id, code, name, description, promo_type, kind, value, min_order,
            max_discount, starts_at, ends_at, max_uses, once_per_customer, stackable, audience, product_scope, buy_qty,
            reward_product_id, reward_qty, use_pos, use_online, show_on_website, active, created_by, updated_by)
        VALUES (p_business_id, v_code, v_name, NULLIF(trim(COALESCE(d->>'description', '')), ''), v_type, v_kind, v_value, v_min,
            v_maxd, v_start, v_end, v_uses, COALESCE((d->>'oncePerCustomer')::boolean, false), COALESCE((d->>'stackable')::boolean, false),
            v_aud, v_scope, v_buy, v_rprod, v_rqty, v_pos, v_online, v_show, COALESCE((d->>'active')::boolean, true), v_by, v_by)
        RETURNING id INTO v_id;
    ELSE
        v_id := p_id;
        UPDATE public.website_promo_codes SET code = v_code, name = v_name,
            description = NULLIF(trim(COALESCE(d->>'description', '')), ''), promo_type = v_type, kind = v_kind,
            value = v_value, min_order = v_min, max_discount = v_maxd, starts_at = v_start, ends_at = v_end,
            max_uses = v_uses, once_per_customer = COALESCE((d->>'oncePerCustomer')::boolean, false),
            stackable = COALESCE((d->>'stackable')::boolean, false), audience = v_aud, product_scope = v_scope,
            buy_qty = v_buy, reward_product_id = v_rprod, reward_qty = v_rqty, use_pos = v_pos, use_online = v_online,
            show_on_website = v_show, active = COALESCE((d->>'active')::boolean, active), updated_by = v_by, updated_at = now()
        WHERE id = v_id;
    END IF;

    DELETE FROM public.promotion_products WHERE promotion_id = v_id;
    DELETE FROM public.promotion_categories WHERE promotion_id = v_id;
    DELETE FROM public.promotion_customers WHERE promotion_id = v_id;
    DELETE FROM public.promotion_branches WHERE promotion_id = v_id;
    IF v_scope = 'products' THEN
        INSERT INTO public.promotion_products (promotion_id, product_id)
        SELECT DISTINCT v_id, pr.id FROM jsonb_array_elements_text(d->'productIds') x JOIN public.products pr ON pr.id = x::uuid
        WHERE pr.business_id = p_business_id;
    ELSIF v_scope = 'categories' THEN
        INSERT INTO public.promotion_categories (promotion_id, category)
        SELECT DISTINCT v_id, trim(x) FROM jsonb_array_elements_text(d->'categories') x WHERE trim(x) <> '';
    END IF;
    IF v_aud = 'selected' THEN
        INSERT INTO public.promotion_customers (promotion_id, customer_id)
        SELECT DISTINCT v_id, c.id FROM jsonb_array_elements_text(d->'customerIds') x JOIN public.customers c ON c.id = x::uuid
        WHERE c.business_id = p_business_id AND c.deleted_at IS NULL;
    END IF;
    INSERT INTO public.promotion_branches (promotion_id, business_id)
    SELECT DISTINCT v_id, x::uuid FROM jsonb_array_elements_text(COALESCE(d->'branchIds', '[]')) x WHERE x::uuid <> p_business_id;
    RETURN v_id;
END;
$$;

-- Switch on or off, archive (keeps every record; the code stops working) or restore.
CREATE OR REPLACE FUNCTION public.set_promotion_status(p_id uuid, p_action text) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE p public.website_promo_codes%ROWTYPE;
BEGIN
    SELECT * INTO p FROM public.website_promo_codes WHERE id = p_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'That promotion was not found.'; END IF;
    PERFORM public.assert_business_member(p.business_id);
    PERFORM public.assert_permission(p.business_id, 'promotions.manage');
    IF p.origin <> 'manual' THEN
        RAISE EXCEPTION 'Referral codes and rewards are managed in Promotions → Referrals.';
    END IF;
    IF p_action = 'activate' THEN
        IF p.archived_at IS NOT NULL THEN RAISE EXCEPTION 'Restore the promotion first.'; END IF;
        UPDATE public.website_promo_codes SET active = true, updated_at = now() WHERE id = p_id;
    ELSIF p_action = 'deactivate' THEN
        UPDATE public.website_promo_codes SET active = false, updated_at = now() WHERE id = p_id;
    ELSIF p_action = 'archive' THEN
        UPDATE public.website_promo_codes SET active = false, show_on_website = false, archived_at = now(), updated_at = now() WHERE id = p_id;
    ELSIF p_action = 'restore' THEN
        UPDATE public.website_promo_codes SET archived_at = NULL, updated_at = now() WHERE id = p_id;
    ELSE
        RAISE EXCEPTION 'Unknown action %.', p_action;
    END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.promo_generate_code(p_business_id uuid, p_prefix text DEFAULT '') RETURNS text
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
BEGIN
    PERFORM public.assert_business_member(p_business_id);
    PERFORM public.assert_permission(p_business_id, 'promotions.manage');
    RETURN public.fn_promo_new_code(p_business_id, p_prefix);
END;
$$;

-- Every promotion of this branch (and ones shared to it) with its rules and use so far.
CREATE OR REPLACE FUNCTION public.promotions_list(p_business_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
    PERFORM public.assert_business_member(p_business_id);
    PERFORM public.assert_permission(p_business_id, 'promotions.view', 'promotions.manage');
    RETURN COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
            'id', p.id, 'code', p.code, 'name', COALESCE(p.name, p.code), 'description', p.description,
            'promoType', p.promo_type, 'kind', p.kind, 'value', p.value, 'maxDiscount', p.max_discount,
            'minOrder', p.min_order, 'startsAt', p.starts_at, 'endsAt', p.ends_at, 'maxUses', p.max_uses,
            'oncePerCustomer', p.once_per_customer, 'stackable', p.stackable, 'audience', p.audience,
            'productScope', p.product_scope, 'buyQty', p.buy_qty, 'rewardProductId', p.reward_product_id,
            'rewardQty', p.reward_qty, 'usePos', p.use_pos, 'useOnline', p.use_online, 'showOnWebsite', p.show_on_website,
            'active', p.active, 'archivedAt', p.archived_at, 'createdAt', p.created_at, 'createdBy', p.created_by,
            'ownBranch', p.business_id = p_business_id, 'origin', p.origin,
            'status', public.fn_promo_status(p), 'summary', public.fn_promo_summary(p),
            'productIds', COALESCE((SELECT jsonb_agg(product_id) FROM public.promotion_products WHERE promotion_id = p.id), '[]'),
            'categories', COALESCE((SELECT jsonb_agg(category) FROM public.promotion_categories WHERE promotion_id = p.id), '[]'),
            'customerIds', COALESCE((SELECT jsonb_agg(customer_id) FROM public.promotion_customers WHERE promotion_id = p.id), '[]'),
            'branchIds', COALESCE((SELECT jsonb_agg(business_id) FROM public.promotion_branches WHERE promotion_id = p.id), '[]'),
            'uses', (SELECT count(*) FROM public.promotion_redemptions r WHERE r.promotion_id = p.id AND r.status IN ('redeemed', 'partially_refunded')),
            'held', (SELECT count(*) FROM public.promotion_redemptions r WHERE r.promotion_id = p.id AND r.status = 'reserved' AND r.expires_at > now()),
            'discountGiven', (SELECT COALESCE(SUM(discount), 0) FROM public.promotion_redemptions r WHERE r.promotion_id = p.id AND r.status IN ('redeemed', 'partially_refunded'))
        ) ORDER BY p.archived_at NULLS FIRST, p.created_at DESC)
        FROM public.website_promo_codes p
        WHERE p.origin = 'manual' AND (p.business_id = p_business_id
              OR EXISTS (SELECT 1 FROM public.promotion_branches pb WHERE pb.promotion_id = p.id AND pb.business_id = p_business_id))
    ), '[]'::jsonb);
END;
$$;

-- Uses of one promotion, newest first.
CREATE OR REPLACE FUNCTION public.promotion_redemptions_list(p_promotion_id uuid, p_limit int DEFAULT 100) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_b uuid;
BEGIN
    SELECT business_id INTO v_b FROM public.website_promo_codes WHERE id = p_promotion_id;
    IF v_b IS NULL THEN RAISE EXCEPTION 'That promotion was not found.'; END IF;
    PERFORM public.assert_business_member(v_b);
    PERFORM public.assert_permission(v_b, 'promotions.view', 'promotions.manage');
    RETURN COALESCE((
        SELECT jsonb_agg(x ORDER BY x->>'at' DESC) FROM (
            SELECT jsonb_build_object('id', r.id, 'at', COALESCE(r.redeemed_at, r.reserved_at), 'status', r.status,
                'channel', r.channel, 'discount', r.discount, 'saleTotal', r.sale_total, 'refunded', r.refunded_amount,
                'customer', c.name, 'staff', r.staff_name, 'branch', b.name, 'endReason', r.end_reason,
                'receipt', CASE WHEN r.transaction_id IS NOT NULL THEN public.fn_receipt_number(r.transaction_id) END,
                'order', o.order_number) AS x
            FROM public.promotion_redemptions r
            LEFT JOIN public.customers c ON c.id = r.customer_id
            LEFT JOIN public.businesses b ON b.id = r.business_id
            LEFT JOIN public.online_orders o ON o.id = r.order_id
            WHERE r.promotion_id = p_promotion_id AND r.status NOT IN ('released')
            ORDER BY COALESCE(r.redeemed_at, r.reserved_at) DESC
            LIMIT LEAST(GREATEST(p_limit, 1), 500)) s
    ), '[]'::jsonb);
END;
$$;

-- ============================================================================ dashboard
-- Figures for one branch and period. Sales "with a promotion" are not extra sales the
-- promotion caused: they are sales where a code was used. Gross = before any discount;
-- net = after all discounts, without VAT and delivery.
CREATE OR REPLACE FUNCTION public.promotion_dashboard(p_business_id uuid, p_from date, p_to date) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_from timestamptz := (p_from::timestamp AT TIME ZONE 'Africa/Nairobi');
    v_to   timestamptz := ((p_to + 1)::timestamp AT TIME ZONE 'Africa/Nairobi');
    v_res  jsonb;
BEGIN
    PERFORM public.assert_business_member(p_business_id);
    PERFORM public.assert_permission(p_business_id, 'promotions.view', 'promotions.manage');
    IF p_to < p_from THEN RAISE EXCEPTION 'The end date is before the start date.'; END IF;

    WITH u AS (   -- uses in the period, with what the sale was worth
        SELECT r.*, p.name AS promo_name,
               CASE WHEN r.channel = 'pos' THEN t.total ELSE o.subtotal END AS gross,
               CASE WHEN r.channel = 'pos' THEN GREATEST(t.discount - r.discount, 0) ELSE COALESCE(o.points_value, 0) END AS other_disc,
               CASE WHEN r.channel = 'pos' THEN t.final_total - t.tax - t.delivery_fee ELSE o.subtotal - r.discount - COALESCE(o.points_value, 0) END AS net
        FROM public.promotion_redemptions r
        JOIN public.website_promo_codes p ON p.id = r.promotion_id
        LEFT JOIN public.transactions t ON t.id = r.transaction_id
        LEFT JOIN public.online_orders o ON o.id = r.order_id
        WHERE r.business_id = p_business_id AND r.redeemed_at >= v_from AND r.redeemed_at < v_to
          AND r.status IN ('redeemed', 'partially_refunded', 'refunded')
    ), live AS (SELECT * FROM u WHERE status IN ('redeemed', 'partially_refunded')),
    plain AS (    -- till sales without a code, to compare the average sale
        SELECT count(*) AS n, COALESCE(AVG(t.final_total - t.tax - t.delivery_fee), 0) AS avg_net
        FROM public.transactions t
        WHERE t.business_id = p_business_id AND t.deleted_at IS NULL AND t.promotion_redemption_id IS NULL
          AND t.timestamp >= v_from AND t.timestamp < v_to
    ), promos AS (
        SELECT p.*, public.fn_promo_status(p) AS st FROM public.website_promo_codes p
        WHERE p.origin = 'manual' AND p.business_id = p_business_id
    )
    SELECT jsonb_build_object(
        'counts', (SELECT jsonb_build_object(
            'total', count(*), 'active', count(*) FILTER (WHERE st = 'active'),
            'scheduled', count(*) FILTER (WHERE st = 'scheduled'), 'expired', count(*) FILTER (WHERE st IN ('expired', 'used_up')),
            'off', count(*) FILTER (WHERE st = 'off'), 'archived', count(*) FILTER (WHERE st = 'archived')) FROM promos),
        'totals', (SELECT jsonb_build_object(
            'redemptions', count(*), 'discount', COALESCE(SUM(discount), 0),
            'grossSales', COALESCE(SUM(gross), 0), 'otherDiscounts', COALESCE(SUM(other_disc), 0),
            'netSales', COALESCE(SUM(net), 0), 'avgNet', COALESCE(AVG(net), 0),
            'customers', count(DISTINCT COALESCE(customer_id::text, account_id::text))) FROM live),
        'refunds', (SELECT jsonb_build_object('count', count(*) FILTER (WHERE status = 'refunded'),
            'partial', count(*) FILTER (WHERE status = 'partially_refunded'),
            'amount', COALESCE(SUM(refunded_amount), 0)) FROM u),
        'withoutPromotion', (SELECT jsonb_build_object('sales', n, 'avgNet', avg_net) FROM plain),
        'byPromotion', COALESCE((SELECT jsonb_agg(x ORDER BY (x->>'uses')::int DESC, (x->>'netSales')::numeric DESC) FROM (
            SELECT jsonb_build_object('promotionId', promotion_id, 'code', max(code), 'name', max(promo_name),
                'uses', count(*), 'discount', SUM(discount), 'grossSales', SUM(gross), 'netSales', SUM(net),
                'netPerShilling', CASE WHEN SUM(discount) > 0 THEN round(SUM(net) / SUM(discount), 2) END,
                'discountShare', CASE WHEN SUM(gross) > 0 THEN round(SUM(discount) * 100 / SUM(gross), 1) END) AS x
            FROM live GROUP BY promotion_id) s), '[]'),
        'byProduct', COALESCE((SELECT jsonb_agg(x ORDER BY (x->>'discount')::numeric DESC) FROM (
            SELECT jsonb_build_object('productId', l->>'productId', 'name', max(l->>'name'), 'category', max(l->>'category'),
                'quantity', SUM((l->>'quantity')::numeric), 'net', SUM((l->>'net')::numeric),
                'discount', SUM((l->>'discount')::numeric), 'uses', count(DISTINCT live.id)) AS x
            FROM live, jsonb_array_elements(live.lines) l
            GROUP BY l->>'productId' LIMIT 50) s), '[]'),
        'byDay', COALESCE((SELECT jsonb_agg(x ORDER BY x->>'date') FROM (
            SELECT jsonb_build_object('date', (redeemed_at AT TIME ZONE 'Africa/Nairobi')::date, 'uses', count(*),
                'discount', SUM(discount), 'netSales', SUM(net)) AS x
            FROM live GROUP BY (redeemed_at AT TIME ZONE 'Africa/Nairobi')::date) s), '[]')
    ) INTO v_res;
    RETURN v_res;
END;
$$;

-- ============================================================================ credit sales carry the promotion
DROP FUNCTION IF EXISTS public.process_customer_transaction(uuid, uuid, text, uuid, text, numeric, numeric, numeric, numeric, numeric, public.payment_method, timestamptz, text, boolean, numeric, text, text, jsonb, text, numeric);

CREATE FUNCTION "public"."process_customer_transaction"("p_business_id" "uuid", "p_customer_id" "uuid", "p_customer_name" "text", "p_staff_id" "uuid", "p_staff_name" "text", "p_total" numeric, "p_discount" numeric, "p_tax" numeric, "p_final_total" numeric, "p_amount_paid" numeric, "p_payment_method" "public"."payment_method", "p_timestamp" timestamp with time zone, "p_note" "text", "p_is_delivery" boolean, "p_delivery_fee" numeric, "p_rider_name" "text", "p_reference_id" "text", "p_items" "jsonb", "p_delivery_mode" "text" DEFAULT 'charged', "p_rider_pay" numeric DEFAULT 0, "p_promotion_redemption_id" "uuid" DEFAULT NULL) RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
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
    PERFORM public.assert_permission(p_business_id, 'pos.create_sale');
    PERFORM public.assert_business_member(p_business_id); IF p_customer_id IS NOT NULL THEN PERFORM public.assert_business_member((SELECT business_id FROM public.customers WHERE id = p_customer_id)); END IF; PERFORM public.assert_business_member(pr.business_id) FROM public.products pr WHERE pr.id IN (SELECT (e->>'product_id')::UUID FROM jsonb_array_elements(COALESCE(p_items, '[]'::JSONB)) e WHERE e->>'product_id' IS NOT NULL);
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
         delivery_fee, rider_name, reference_id, delivery_mode, rider_pay, promotion_redemption_id)
    VALUES (
        p_business_id, p_total, p_discount, p_tax, p_final_total,
        p_amount_paid, v_wallet_used, p_payment_method, p_customer_id,
        p_customer_name, p_staff_id, p_staff_name, 'Synced',
        COALESCE(p_timestamp, NOW()), p_note, COALESCE(p_is_delivery, FALSE),
        COALESCE(p_delivery_fee, 0), p_rider_name, p_reference_id,
        CASE WHEN COALESCE(p_is_delivery, FALSE) THEN COALESCE(p_delivery_mode, 'charged') ELSE 'charged' END,
        CASE WHEN COALESCE(p_is_delivery, FALSE) THEN GREATEST(COALESCE(p_rider_pay, 0), 0) ELSE 0 END,
        p_promotion_redemption_id
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
        -- credit record: created by the sale trigger, once per sale

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

ALTER FUNCTION public.process_customer_transaction(uuid, uuid, text, uuid, text, numeric, numeric, numeric, numeric, numeric, public.payment_method, timestamptz, text, boolean, numeric, text, text, jsonb, text, numeric, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.process_customer_transaction(uuid, uuid, text, uuid, text, numeric, numeric, numeric, numeric, numeric, public.payment_method, timestamptz, text, boolean, numeric, text, text, jsonb, text, numeric, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.process_customer_transaction(uuid, uuid, text, uuid, text, numeric, numeric, numeric, numeric, numeric, public.payment_method, timestamptz, text, boolean, numeric, text, text, jsonb, text, numeric, uuid) TO authenticated, service_role;

-- ============================================================================ held uses time out
DO $do$ BEGIN
    IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
        PERFORM cron.schedule('expire-promotion-holds', '*/5 * * * *',
            $job$UPDATE public.promotion_redemptions SET status = 'expired', ended_at = now(), end_reason = 'Hold timed out'
                 WHERE status = 'reserved' AND expires_at < now()$job$);
    END IF;
END $do$;

-- ============================================================================ who may call what
DO $do$
DECLARE f text;
BEGIN
    -- Internal: only other database functions use these.
    FOREACH f IN ARRAY ARRAY[
        'public.fn_promo_status(public.website_promo_codes)', 'public.fn_my_employee(uuid)', 'public.fn_promo_find(uuid, text)',
        'public.fn_promo_new_code(uuid, text)', 'public.fn_promo_evaluate(public.website_promo_codes, uuid, uuid, jsonb, numeric, uuid)',
        'public.fn_promo_summary(public.website_promo_codes)', 'public.fn_promo_redemption_guard()', 'public.fn_sale_promotion_stamp()',
        'public.fn_sale_promotion_commit()', 'public.fn_sale_promotion_cancel()', 'public.fn_sale_promotion_refund()',
        'public.fn_order_promotion_sync()', 'public.fn_promo_after_redeem(uuid)', 'public.fn_promo_after_end(uuid)']
    LOOP
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', f);
        EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', f);
    END LOOP;
    -- Called by the app; each checks the signed-in person's permission itself.
    FOREACH f IN ARRAY ARRAY[
        'public.promo_check(uuid, text, uuid, jsonb, numeric)', 'public.promo_reserve(uuid, text, uuid, jsonb, numeric, text)',
        'public.promo_release(uuid)', 'public.record_till_sale(jsonb, jsonb)', 'public.save_promotion(uuid, uuid, jsonb)',
        'public.set_promotion_status(uuid, text)', 'public.promo_generate_code(uuid, text)', 'public.promotions_list(uuid)',
        'public.promotion_redemptions_list(uuid, integer)', 'public.promotion_dashboard(uuid, date, date)']
    LOOP
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', f);
        EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', f);
    END LOOP;
END $do$;

-- ===================================================================
-- 20261126002_referrals
-- ===================================================================
-- 2026-11-17 Customer referral program (two-sided), built on promotions (20261126001).
--
-- Pieces, reusing what exists:
--   referral_campaigns  one running campaign per branch: what each side gets, the limits,
--                       the wait before rewards, and fraud settings. Its first-purchase
--                       rules (minimum, products, branches, combine with discounts, dates)
--                       live in a hidden promotion row (origin 'referral_welcome'), so the
--                       till checks a referral with the same engine as any promotion code.
--   referral_codes      one code per customer (e.g. DENNIS482), shared with as many people
--                       as they like. Typed in the till's promotion box.
--   referrals           referrer -> new customer: pending (code applied, sale not yet saved),
--                       qualified (first purchase saved), rewarded, rejected, cancelled, expired.
--   referral_rewards    every reward given, one row per side, never more (unique), with what
--                       it cost. Kinds: amount / percent / free_product (a personal code the
--                       customer uses later), wallet (credit now), points (now), and
--                       discount_at_sale (the new customer's welcome, taken off the sale).
-- Money: wallet credit posts to the books (Referral rewards expense / Customer wallet money);
-- discounts post with the sale (Promotion discounts). See 20261126003.
--
-- Lifecycle at the till: cashier picks the NEW customer, types the referrer's code
--   promo_check / promo_reserve find no promotion, find the referral code, run the referral
--   checks (below) and the welcome rules; reserve also writes the pending referral.
--   Sale commits -> qualified (fraud flags worked out); rewards are given after the
--   campaign's wait (hold_days) if the sale is still whole, by a job every 10 minutes, or at
--   once when hold_days = 0. Flagged referrals wait for a manager when review_flagged.
--   Sale cancelled or refunded before rewards -> cancelled. After rewards -> rewards taken
--   back where still possible (unused codes revoked, unspent wallet credit and points
--   removed) and the referral is cancelled with the flag refunded_after_reward.

-- ============================================================================ campaigns
CREATE TABLE IF NOT EXISTS public.referral_campaigns (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    name text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 80),
    description text CHECK (description IS NULL OR length(description) <= 500),
    active boolean NOT NULL DEFAULT true,
    starts_at timestamptz,
    ends_at timestamptz,
    referrer_kind text NOT NULL CHECK (referrer_kind IN ('amount', 'percent', 'wallet', 'free_product', 'points')),
    referrer_value numeric(14,2) NOT NULL DEFAULT 0 CHECK (referrer_value >= 0),
    referrer_product_id uuid REFERENCES public.products(id) ON DELETE RESTRICT,
    referrer_qty numeric(14,3),
    welcome_kind text NOT NULL CHECK (welcome_kind IN ('amount', 'percent', 'wallet', 'free_product', 'points')),
    welcome_value numeric(14,2) NOT NULL DEFAULT 0 CHECK (welcome_value >= 0),
    welcome_product_id uuid REFERENCES public.products(id) ON DELETE RESTRICT,
    welcome_qty numeric(14,3),
    welcome_promotion_id uuid NOT NULL REFERENCES public.website_promo_codes(id),
    max_per_referrer int CHECK (max_per_referrer IS NULL OR max_per_referrer > 0),
    max_total int CHECK (max_total IS NULL OR max_total > 0),
    max_rewards_per_customer int CHECK (max_rewards_per_customer IS NULL OR max_rewards_per_customer > 0),
    reward_expiry_days int CHECK (reward_expiry_days IS NULL OR reward_expiry_days > 0),
    hold_days int NOT NULL DEFAULT 3 CHECK (hold_days BETWEEN 0 AND 60),
    exclude_existing boolean NOT NULL DEFAULT true,
    new_customer_days int NOT NULL DEFAULT 30 CHECK (new_customer_days BETWEEN 1 AND 365),
    require_phone boolean NOT NULL DEFAULT true,
    review_flagged boolean NOT NULL DEFAULT true,
    created_by text,
    updated_by text,
    archived_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CHECK (ends_at IS NULL OR starts_at IS NULL OR ends_at > starts_at),
    CHECK (archived_at IS NULL OR NOT active),
    CHECK (referrer_kind <> 'free_product' OR (referrer_product_id IS NOT NULL AND referrer_qty > 0)),
    CHECK (welcome_kind <> 'free_product' OR (welcome_product_id IS NOT NULL AND welcome_qty > 0)),
    CHECK (referrer_kind NOT IN ('amount', 'percent', 'wallet', 'points') OR referrer_value > 0),
    CHECK (welcome_kind NOT IN ('amount', 'percent', 'wallet', 'points') OR welcome_value > 0),
    CHECK (referrer_kind <> 'percent' OR referrer_value <= 90),
    CHECK (welcome_kind <> 'percent' OR welcome_value <= 90)
);
-- One running campaign per branch, so a code always means one set of rewards.
CREATE UNIQUE INDEX IF NOT EXISTS uq_referral_campaign_active ON public.referral_campaigns (business_id) WHERE active;

-- ============================================================================ codes
CREATE TABLE IF NOT EXISTS public.referral_codes (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    customer_id uuid NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
    code text NOT NULL CHECK (code ~ '^[A-Z0-9][A-Z0-9-]{2,23}$'),
    status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'revoked')),
    status_reason text,
    status_by text,
    status_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (business_id, code)
);
-- One code per customer that isn't revoked (a revoked code is kept for the record).
CREATE UNIQUE INDEX IF NOT EXISTS uq_referral_code_customer ON public.referral_codes (customer_id) WHERE status <> 'revoked';

-- ============================================================================ referrals
CREATE TABLE IF NOT EXISTS public.referrals (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    campaign_id uuid NOT NULL REFERENCES public.referral_campaigns(id),
    code_id uuid NOT NULL REFERENCES public.referral_codes(id),
    code text NOT NULL,
    referrer_customer_id uuid NOT NULL REFERENCES public.customers(id),
    referred_customer_id uuid NOT NULL REFERENCES public.customers(id),
    status text NOT NULL CHECK (status IN ('pending', 'qualified', 'rewarded', 'rejected', 'cancelled', 'expired')),
    redemption_id uuid REFERENCES public.promotion_redemptions(id),
    transaction_id uuid REFERENCES public.transactions(id) ON DELETE SET NULL,
    purchase_amount numeric(14,2),
    welcome_discount numeric(14,2) NOT NULL DEFAULT 0,
    flags text[] NOT NULL DEFAULT '{}',
    staff_id uuid,
    staff_name text,
    reward_due_at timestamptz,
    qualified_at timestamptz,
    rewarded_at timestamptz,
    ended_at timestamptz,
    end_reason text,
    decided_by text,
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK (referrer_customer_id <> referred_customer_id)
);
-- A new customer is referred once (a cancelled, rejected or expired try doesn't count).
CREATE UNIQUE INDEX IF NOT EXISTS uq_referral_referred ON public.referrals (referred_customer_id)
    WHERE status IN ('pending', 'qualified', 'rewarded');
CREATE UNIQUE INDEX IF NOT EXISTS uq_referral_redemption ON public.referrals (redemption_id) WHERE redemption_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_referrals_referrer ON public.referrals (referrer_customer_id, status);
CREATE INDEX IF NOT EXISTS idx_referrals_business ON public.referrals (business_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_referrals_due ON public.referrals (reward_due_at) WHERE status = 'qualified';

-- ============================================================================ rewards
CREATE TABLE IF NOT EXISTS public.referral_rewards (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    referral_id uuid NOT NULL REFERENCES public.referrals(id),
    campaign_id uuid NOT NULL REFERENCES public.referral_campaigns(id),
    customer_id uuid NOT NULL REFERENCES public.customers(id),
    side text NOT NULL CHECK (side IN ('referrer', 'referred')),
    kind text NOT NULL CHECK (kind IN ('amount', 'percent', 'wallet', 'free_product', 'points', 'discount_at_sale')),
    value numeric(14,2) NOT NULL DEFAULT 0,
    points int NOT NULL DEFAULT 0,
    product_id uuid REFERENCES public.products(id),
    qty numeric(14,3),
    promotion_id uuid REFERENCES public.website_promo_codes(id),
    status text NOT NULL CHECK (status IN ('issued', 'used', 'expired', 'revoked', 'reversed')),
    cost numeric(14,2) NOT NULL DEFAULT 0,       -- money it has cost so far
    reversed_amount numeric(14,2) NOT NULL DEFAULT 0,
    used_transaction_id uuid REFERENCES public.transactions(id) ON DELETE SET NULL,
    expires_at timestamptz,
    issued_at timestamptz NOT NULL DEFAULT now(),
    used_at timestamptz,
    ended_at timestamptz,
    end_reason text,
    issued_by text,
    UNIQUE (referral_id, side)                    -- issuing twice does nothing
);
CREATE INDEX IF NOT EXISTS idx_referral_rewards_customer ON public.referral_rewards (customer_id, status);
CREATE INDEX IF NOT EXISTS idx_referral_rewards_promotion ON public.referral_rewards (promotion_id) WHERE promotion_id IS NOT NULL;

-- Wallet credit and points from referrals are recorded where the app already looks.
ALTER TABLE public.customer_ledger DROP CONSTRAINT IF EXISTS customer_ledger_type_check;
ALTER TABLE public.customer_ledger ADD CONSTRAINT customer_ledger_type_check CHECK (type IN
    ('wallet_topup', 'wallet_usage', 'debt_creation', 'debt_payment', 'debt_adjustment', 'refund', 'referral_reward', 'referral_reversal'));
ALTER TABLE public.loyalty_points_earned DROP CONSTRAINT IF EXISTS loyalty_points_earned_source_check;
ALTER TABLE public.loyalty_points_earned ADD CONSTRAINT loyalty_points_earned_source_check CHECK (source IN ('sale', 'debt_payment', 'referral'));

-- ============================================================================ permissions
-- referrals.view  see campaigns, referrals and costs     referrals.manage  campaigns, approve, reject, suspend
INSERT INTO public.role_default_permissions (role, permissions) VALUES
    ('Manager', ARRAY['accounting.view', 'ai.insights', 'ai.use', 'assets.view', 'bom.create', 'bom.update', 'bom.view', 'business.switch', 'business.view', 'communication.send', 'communication.view', 'complaints.reply', 'complaints.view', 'customers.create', 'customers.debts', 'customers.loyalty', 'customers.manage', 'customers.schedules', 'customers.update', 'customers.view', 'dashboard.view', 'deliveries.assign', 'deliveries.cancel', 'deliveries.complete', 'deliveries.create', 'deliveries.view', 'expenses.create', 'expenses.update', 'expenses.view', 'files.view', 'finance.view', 'home.view', 'inventory.adjust_stock', 'inventory.expiry', 'inventory.receive_stock', 'inventory.request_transfer', 'inventory.stock_count', 'inventory.stock_history', 'inventory.transfer_stock', 'inventory.view', 'inventory.wastage', 'invoices.manage', 'invoices.view', 'loyalty.adjust', 'notifications.send', 'notifications.view', 'online_store.view', 'orders.assign_rider', 'orders.complete', 'orders.create', 'orders.update', 'orders.view', 'payments.card', 'payments.cash', 'payments.verify', 'payments.view', 'pettycash.record', 'pos.apply_promotion', 'pos.close_shift', 'pos.create_sale', 'pos.open_shift', 'pos.walkin_customer', 'production.approve', 'production.create', 'production.update', 'production.view', 'products.create', 'products.export', 'products.import', 'products.manage_categories', 'products.update', 'products.view', 'promotions.manage', 'promotions.view', 'referrals.manage', 'referrals.view', 'purchases.approve', 'purchases.create', 'purchases.export', 'purchases.print', 'purchases.request_quote', 'purchases.update', 'purchases.view', 'quotes.manage', 'quotes.view', 'refunds.create', 'reports.customers', 'reports.deliveries', 'reports.inventory', 'reports.profit', 'reports.sales', 'reports.view', 'sales_orders.manage', 'sales_orders.view', 'settings.tax', 'settings.theme', 'settings.update', 'settings.view', 'staff.schedule', 'staff.view', 'supplier_bills.manage', 'suppliers.create', 'suppliers.export', 'suppliers.import', 'suppliers.update', 'suppliers.view'])
ON CONFLICT (role) DO UPDATE SET permissions = EXCLUDED.permissions;

-- ============================================================================ RLS
ALTER TABLE public.referral_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.referral_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.referrals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.referral_rewards ENABLE ROW LEVEL SECURITY;
-- Read only; every change goes through the functions below.
CREATE POLICY pol_referral_campaigns_select ON public.referral_campaigns FOR SELECT USING (
    public.has_permission(business_id, 'referrals.view', 'referrals.manage'));
CREATE POLICY pol_referral_codes_select ON public.referral_codes FOR SELECT USING (
    public.has_permission(business_id, 'referrals.view', 'referrals.manage', 'customers.view'));
CREATE POLICY pol_referrals_select ON public.referrals FOR SELECT USING (
    public.has_permission(business_id, 'referrals.view', 'referrals.manage'));
CREATE POLICY pol_referral_rewards_select ON public.referral_rewards FOR SELECT USING (
    public.has_permission(business_id, 'referrals.view', 'referrals.manage'));
GRANT SELECT ON public.referral_campaigns, public.referral_codes, public.referrals, public.referral_rewards TO authenticated;
GRANT ALL ON public.referral_campaigns, public.referral_codes, public.referrals, public.referral_rewards TO service_role;

-- ============================================================================ codes share one box
-- Promotion codes and referral codes are typed in the same box: neither may take the other's.
CREATE OR REPLACE FUNCTION public.fn_code_not_taken() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    IF TG_TABLE_NAME = 'website_promo_codes' THEN
        IF EXISTS (SELECT 1 FROM public.referral_codes r WHERE r.business_id = NEW.business_id AND r.code = NEW.code) THEN
            RAISE EXCEPTION 'The code % is a customer''s referral code. Choose another.', NEW.code;
        END IF;
    ELSIF EXISTS (SELECT 1 FROM public.website_promo_codes p WHERE p.business_id = NEW.business_id AND p.code = NEW.code) THEN
        RAISE EXCEPTION 'The code % is already a promotion code.', NEW.code;
    END IF;
    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_promo_code_not_taken ON public.website_promo_codes;
CREATE TRIGGER trg_promo_code_not_taken BEFORE INSERT OR UPDATE OF code ON public.website_promo_codes
    FOR EACH ROW EXECUTE FUNCTION public.fn_code_not_taken();
DROP TRIGGER IF EXISTS trg_referral_code_not_taken ON public.referral_codes;
CREATE TRIGGER trg_referral_code_not_taken BEFORE INSERT OR UPDATE OF code ON public.referral_codes
    FOR EACH ROW EXECUTE FUNCTION public.fn_code_not_taken();

-- ============================================================================ helpers
-- Phones are compared with the existing fn_phone_key (07.. / 7.. / +254.. are the same number).

-- "Bob N." - enough for a customer to recognise a friend, nothing more.
CREATE OR REPLACE FUNCTION public.fn_short_name(p text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
    SELECT CASE WHEN p IS NULL OR trim(p) = '' THEN 'A friend'
        ELSE split_part(trim(p), ' ', 1) || CASE WHEN split_part(trim(p), ' ', 2) <> ''
            THEN ' ' || left(split_part(trim(p), ' ', 2), 1) || '.' ELSE '' END END
$$;

CREATE OR REPLACE FUNCTION public.fn_referral_campaign(p_business_id uuid) RETURNS public.referral_campaigns
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT * FROM public.referral_campaigns WHERE business_id = p_business_id AND active LIMIT 1
$$;

-- The customer's code, made the first time it's needed: first name + 3 digits.
CREATE OR REPLACE FUNCTION public.fn_referral_code_for(p_customer_id uuid) RETURNS public.referral_codes
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
    c   public.customers%ROWTYPE;
    r   public.referral_codes%ROWTYPE;
    v_base text;
    v_code text;
BEGIN
    SELECT * INTO r FROM public.referral_codes WHERE customer_id = p_customer_id AND status <> 'revoked';
    IF FOUND THEN RETURN r; END IF;
    SELECT * INTO c FROM public.customers WHERE id = p_customer_id AND deleted_at IS NULL AND merged_into_id IS NULL;
    IF NOT FOUND THEN RAISE EXCEPTION 'That customer was not found.'; END IF;
    v_base := left(regexp_replace(upper(split_part(trim(c.name), ' ', 1)), '[^A-Z]', '', 'g'), 10);
    IF length(v_base) < 2 THEN v_base := 'FRIEND'; END IF;
    FOR attempt IN 1..60 LOOP
        v_code := v_base || lpad((100 + floor(random() * 900))::int::text, 3, '0');
        IF attempt > 40 THEN v_code := v_base || lpad(floor(random() * 100000)::int::text, 5, '0'); END IF;
        IF NOT EXISTS (SELECT 1 FROM public.referral_codes WHERE business_id = c.business_id AND code = v_code)
           AND NOT EXISTS (SELECT 1 FROM public.website_promo_codes WHERE business_id = c.business_id AND code = v_code) THEN
            INSERT INTO public.referral_codes (business_id, customer_id, code) VALUES (c.business_id, c.id, v_code)
            RETURNING * INTO r;
            RETURN r;
        END IF;
    END LOOP;
    RAISE EXCEPTION 'Could not make a free referral code. Try again.';
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_referral_reward_text(p_kind text, p_value numeric, p_product uuid, p_qty numeric)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_p text;
BEGIN
    SELECT name INTO v_p FROM public.products WHERE id = p_product;
    RETURN CASE p_kind
        WHEN 'amount' THEN public.fn_ksh(p_value) || ' off'
        WHEN 'percent' THEN trim(to_char(p_value, 'FM990.##')) || '% off'
        WHEN 'wallet' THEN public.fn_ksh(p_value) || ' wallet credit'
        WHEN 'points' THEN trim(to_char(p_value, 'FM999,999,990')) || ' points'
        WHEN 'free_product' THEN trim(to_char(p_qty, 'FM999990.###')) || ' ' || COALESCE(v_p, 'item') || ' free'
        ELSE p_kind END;
END;
$$;

-- ============================================================================ the referral check
-- All rules for "this new customer uses that referral code on this cart". Never raises for
-- a rule. On top of the welcome promotion's rules (dates, branch, minimum, products,
-- combine) it checks the code, the campaign's limits and the signs of a fake referral.
CREATE OR REPLACE FUNCTION public.fn_referral_evaluate(
    p_code public.referral_codes, p_business_id uuid, p_customer_id uuid, p_items jsonb,
    p_other_discount numeric DEFAULT 0, p_exclude_redemption uuid DEFAULT NULL, p_exclude_referral uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
    k   public.referral_campaigns%ROWTYPE;
    p   public.website_promo_codes%ROWTYPE;
    a   public.customers%ROWTYPE;   -- referrer
    c   public.customers%ROWTYPE;   -- new customer
    v   jsonb;
    v_n int;
    v_twin text;
BEGIN
    IF p_code.status = 'suspended' THEN
        RETURN public.fn_promo_fail('This referral code is on hold. Ask a manager.');
    ELSIF p_code.status = 'revoked' THEN
        RETURN public.fn_promo_fail('This referral code has been switched off.');
    END IF;
    k := public.fn_referral_campaign(p_code.business_id);
    IF k.id IS NULL THEN
        RETURN public.fn_promo_fail('No referral programme is running just now.');
    END IF;
    SELECT * INTO a FROM public.customers WHERE id = p_code.customer_id;
    IF a.deleted_at IS NOT NULL OR a.merged_into_id IS NOT NULL THEN
        RETURN public.fn_promo_fail('This referral code belongs to a customer who was removed.');
    END IF;
    IF p_customer_id IS NULL THEN
        RETURN public.fn_promo_fail('A referral code is for a new customer. Choose or add the new customer first.');
    END IF;
    SELECT * INTO c FROM public.customers WHERE id = p_customer_id AND deleted_at IS NULL;
    IF NOT FOUND THEN RETURN public.fn_promo_fail('That customer was not found.'); END IF;
    IF c.merged_into_id IS NOT NULL THEN RETURN public.fn_promo_fail('That customer was merged into another.'); END IF;

    -- Not themselves, not a second account of the referrer.
    IF c.id = a.id THEN
        RETURN public.fn_promo_fail('Customers can''t use their own referral code.');
    END IF;
    IF public.fn_phone_key(c.phone) = public.fn_phone_key(a.phone)
       OR (NULLIF(lower(trim(c.email)), '') IS NOT NULL AND lower(trim(c.email)) = lower(trim(a.email))) THEN
        RETURN public.fn_promo_fail(c.name || ' has the same phone or email as the person who referred them.');
    END IF;
    IF k.require_phone AND COALESCE(length(public.fn_phone_key(c.phone)), 0) < 9 THEN
        RETURN public.fn_promo_fail('Add ' || c.name || '''s phone number first: referrals need one.');
    END IF;
    -- Genuinely new: no purchases, and not someone already known under another record.
    SELECT x.name INTO v_twin FROM public.customers x
    WHERE x.business_id = c.business_id AND x.id <> c.id AND x.deleted_at IS NULL
      AND (public.fn_phone_key(x.phone) = public.fn_phone_key(c.phone)
           OR (NULLIF(lower(trim(c.email)), '') IS NOT NULL AND lower(trim(x.email)) = lower(trim(c.email))))
    LIMIT 1;
    IF v_twin IS NOT NULL THEN
        RETURN public.fn_promo_fail('This phone or email already belongs to ' || v_twin || ', so ' || c.name || ' isn''t a new customer.');
    END IF;
    IF EXISTS (SELECT 1 FROM public.transactions t WHERE t.customer_id = c.id AND t.deleted_at IS NULL) THEN
        RETURN public.fn_promo_fail(c.name || ' has bought before, so isn''t a new customer.');
    END IF;
    IF k.exclude_existing AND c.created_at < now() - make_interval(days => k.new_customer_days) THEN
        RETURN public.fn_promo_fail(c.name || ' has been a customer for more than ' || k.new_customer_days || ' days.');
    END IF;
    IF EXISTS (SELECT 1 FROM public.referrals r WHERE r.referred_customer_id = c.id
               AND r.status IN ('pending', 'qualified', 'rewarded') AND r.id IS DISTINCT FROM p_exclude_referral) THEN
        RETURN public.fn_promo_fail(c.name || ' was already referred.');
    END IF;

    -- Limits
    IF k.max_per_referrer IS NOT NULL THEN
        SELECT count(*) INTO v_n FROM public.referrals r
        WHERE r.campaign_id = k.id AND r.referrer_customer_id = a.id AND r.status IN ('pending', 'qualified', 'rewarded')
          AND r.id IS DISTINCT FROM p_exclude_referral;
        IF v_n >= k.max_per_referrer THEN
            RETURN public.fn_promo_fail(public.fn_short_name(a.name) || ' has made the most referrals this programme allows (' || k.max_per_referrer || ').');
        END IF;
    END IF;
    IF k.max_total IS NOT NULL THEN
        SELECT count(*) INTO v_n FROM public.referrals r
        WHERE r.campaign_id = k.id AND r.status IN ('pending', 'qualified', 'rewarded') AND r.id IS DISTINCT FROM p_exclude_referral;
        IF v_n >= k.max_total THEN
            RETURN public.fn_promo_fail('The referral programme is full (' || k.max_total || ' referrals).');
        END IF;
    END IF;

    -- The first purchase: same engine as promotion codes.
    SELECT * INTO p FROM public.website_promo_codes WHERE id = k.welcome_promotion_id;
    v := public.fn_promo_evaluate(p, p_business_id, c.id, p_items, p_other_discount, p_exclude_redemption);
    IF NOT (v->>'ok')::boolean THEN RETURN v; END IF;
    RETURN v || jsonb_build_object('referral', true, 'campaignId', k.id, 'campaignName', k.name,
        'referrer', public.fn_short_name(a.name), 'referrerId', a.id,
        'welcome', public.fn_referral_reward_text(k.welcome_kind, k.welcome_value, k.welcome_product_id, k.welcome_qty),
        'referrerReward', public.fn_referral_reward_text(k.referrer_kind, k.referrer_value, k.referrer_product_id, k.referrer_qty),
        'promotionId', p.id);
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_referral_find_code(p_business_id uuid, p_code text) RETURNS public.referral_codes
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT r.* FROM public.referral_codes r
    LEFT JOIN public.referral_campaigns k ON k.business_id = r.business_id AND k.active
    WHERE r.code = public.fn_promo_norm_code(p_code)
      AND (r.business_id = p_business_id OR EXISTS (SELECT 1 FROM public.promotion_branches pb
           WHERE pb.promotion_id = k.welcome_promotion_id AND pb.business_id = p_business_id))
    ORDER BY (r.business_id = p_business_id) DESC, (r.status = 'active') DESC
    LIMIT 1
$$;

-- ============================================================================ till RPCs, now with referral codes
CREATE OR REPLACE FUNCTION public.promo_check(
    p_business_id uuid, p_code text, p_customer_id uuid, p_items jsonb, p_other_discount numeric DEFAULT 0
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
    p public.website_promo_codes;
    r public.referral_codes;
    v jsonb;
BEGIN
    PERFORM public.assert_business_member(p_business_id);
    PERFORM public.assert_permission(p_business_id, 'pos.apply_promotion');
    IF public.fn_promo_norm_code(p_code) = '' THEN
        RETURN public.fn_promo_fail('Type a code first.');
    END IF;
    p := public.fn_promo_find(p_business_id, p_code);
    IF p.id IS NOT NULL THEN
        v := public.fn_promo_evaluate(p, p_business_id, p_customer_id, p_items, p_other_discount);
        RETURN v || jsonb_build_object('code', p.code, 'name', COALESCE(p.name, p.code), 'promotionId', p.id,
                                       'summary', public.fn_promo_summary(p), 'kind', p.kind);
    END IF;
    r := public.fn_referral_find_code(p_business_id, p_code);
    IF r.id IS NOT NULL THEN
        v := public.fn_referral_evaluate(r, p_business_id, p_customer_id, p_items, p_other_discount);
        RETURN v || jsonb_build_object('code', r.code, 'name', 'Referral', 'referral', true,
            'summary', COALESCE(v->>'welcome', 'Referral'), 'kind', 'referral');
    END IF;
    RETURN public.fn_promo_fail('No promotion uses the code ' || public.fn_promo_norm_code(p_code) || '.');
END;
$$;

CREATE OR REPLACE FUNCTION public.promo_reserve(
    p_business_id uuid, p_code text, p_customer_id uuid, p_items jsonb,
    p_other_discount numeric DEFAULT 0, p_reference_id text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
    p    public.website_promo_codes;
    r    public.referral_codes;
    k    public.referral_campaigns%ROWTYPE;
    v    jsonb;
    e    public.employees;
    v_id uuid;
    v_ref uuid;
BEGIN
    PERFORM public.assert_business_member(p_business_id);
    PERFORM public.assert_permission(p_business_id, 'pos.apply_promotion');
    e := public.fn_my_employee(p_business_id);
    p := public.fn_promo_find(p_business_id, p_code);
    IF p.id IS NULL THEN
        r := public.fn_referral_find_code(p_business_id, p_code);
        IF r.id IS NULL THEN
            RAISE EXCEPTION 'No promotion uses the code %.', public.fn_promo_norm_code(p_code);
        END IF;
        -- One referral at a time per programme: the limits can't be passed by two tills.
        k := public.fn_referral_campaign(r.business_id);
        IF k.id IS NOT NULL THEN PERFORM 1 FROM public.referral_campaigns WHERE id = k.id FOR UPDATE; END IF;
        PERFORM 1 FROM public.referral_codes WHERE id = r.id FOR UPDATE;
        PERFORM 1 FROM public.website_promo_codes WHERE id = k.welcome_promotion_id FOR UPDATE;
        v := public.fn_referral_evaluate(r, p_business_id, p_customer_id, p_items, p_other_discount);
        IF NOT (v->>'ok')::boolean THEN RAISE EXCEPTION '%', v->>'reason'; END IF;
        INSERT INTO public.promotion_redemptions (promotion_id, code, business_id, channel, customer_id, staff_id, staff_name,
            status, discount, subtotal, lines, reference_id, expires_at)
        VALUES (k.welcome_promotion_id, r.code, p_business_id, 'pos', p_customer_id, e.id, e.name, 'reserved',
            (v->>'discount')::numeric, (v->>'subtotal')::numeric, v->'lines', p_reference_id, now() + interval '20 minutes')
        RETURNING id INTO v_id;
        INSERT INTO public.referrals (business_id, campaign_id, code_id, code, referrer_customer_id, referred_customer_id,
            status, redemption_id, staff_id, staff_name)
        VALUES (r.business_id, k.id, r.id, r.code, r.customer_id, p_customer_id, 'pending', v_id, e.id, e.name)
        RETURNING id INTO v_ref;
        RETURN v || jsonb_build_object('redemptionId', v_id, 'referralId', v_ref, 'code', r.code, 'name', 'Referral',
            'summary', v->>'welcome', 'expiresAt', now() + interval '20 minutes');
    END IF;

    PERFORM 1 FROM public.website_promo_codes WHERE id = p.id FOR UPDATE;
    SELECT * INTO p FROM public.website_promo_codes WHERE id = p.id;
    v := public.fn_promo_evaluate(p, p_business_id, p_customer_id, p_items, p_other_discount);
    IF NOT (v->>'ok')::boolean THEN RAISE EXCEPTION '%', v->>'reason'; END IF;
    INSERT INTO public.promotion_redemptions (promotion_id, code, business_id, channel, customer_id, staff_id, staff_name,
        status, discount, subtotal, lines, reference_id, expires_at)
    VALUES (p.id, p.code, p_business_id, 'pos', p_customer_id, e.id, e.name, 'reserved',
        (v->>'discount')::numeric, (v->>'subtotal')::numeric, v->'lines', p_reference_id, now() + interval '20 minutes')
    RETURNING id INTO v_id;
    RETURN v || jsonb_build_object('redemptionId', v_id, 'code', p.code, 'name', COALESCE(p.name, p.code),
                                   'summary', public.fn_promo_summary(p), 'expiresAt', now() + interval '20 minutes');
END;
$$;

CREATE OR REPLACE FUNCTION public.promo_release(p_redemption_id uuid) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.promotion_redemptions%ROWTYPE;
BEGIN
    SELECT * INTO r FROM public.promotion_redemptions WHERE id = p_redemption_id FOR UPDATE;
    IF NOT FOUND THEN RETURN; END IF;
    PERFORM public.assert_business_member(r.business_id);
    PERFORM public.assert_permission(r.business_id, 'pos.apply_promotion');
    UPDATE public.promotion_redemptions SET status = 'released', ended_at = now(), end_reason = 'Sale not completed'
    WHERE id = r.id AND status = 'reserved' AND transaction_id IS NULL;
    UPDATE public.referrals SET status = 'cancelled', ended_at = now(), end_reason = 'Sale not completed'
    WHERE redemption_id = r.id AND status = 'pending';
END;
$$;

-- ============================================================================ rewards: give and take back
-- Gives each side its reward once. Safe to call again: a reward that exists is left alone.
CREATE OR REPLACE FUNCTION public.fn_referral_issue(p_referral_id uuid, p_by text DEFAULT 'System') RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
    f   public.referrals%ROWTYPE;
    k   public.referral_campaigns%ROWTYPE;
    rd  public.promotion_redemptions%ROWTYPE;
    v_side text;
    v_kind text; v_value numeric; v_prod uuid; v_qty numeric; v_cust uuid;
    v_n int;
BEGIN
    SELECT * INTO f FROM public.referrals WHERE id = p_referral_id FOR UPDATE;
    IF NOT FOUND OR f.status <> 'qualified' THEN RETURN; END IF;
    SELECT * INTO k FROM public.referral_campaigns WHERE id = f.campaign_id;
    SELECT * INTO rd FROM public.promotion_redemptions WHERE id = f.redemption_id;
    IF rd.status NOT IN ('redeemed', 'partially_refunded') THEN RETURN; END IF;

    FOREACH v_side IN ARRAY ARRAY['referred', 'referrer'] LOOP
        IF v_side = 'referrer' THEN
            v_kind := k.referrer_kind; v_value := k.referrer_value; v_prod := k.referrer_product_id; v_qty := k.referrer_qty; v_cust := f.referrer_customer_id;
        ELSE
            v_kind := k.welcome_kind; v_value := k.welcome_value; v_prod := k.welcome_product_id; v_qty := k.welcome_qty; v_cust := f.referred_customer_id;
            -- A discount or free item for the new customer was taken off the first sale.
            CONTINUE WHEN v_kind IN ('amount', 'percent', 'free_product');
        END IF;
        CONTINUE WHEN EXISTS (SELECT 1 FROM public.referral_rewards WHERE referral_id = f.id AND referral_rewards.side = v_side);
        IF v_side = 'referrer' AND k.max_rewards_per_customer IS NOT NULL THEN
            SELECT count(*) INTO v_n FROM public.referral_rewards x
            WHERE x.customer_id = v_cust AND x.side = 'referrer' AND x.status NOT IN ('revoked', 'reversed');
            IF v_n >= k.max_rewards_per_customer THEN
                INSERT INTO public.referral_rewards (business_id, referral_id, campaign_id, customer_id, side, kind, value, status, ended_at, end_reason, issued_by)
                VALUES (f.business_id, f.id, k.id, v_cust, v_side, v_kind, v_value, 'revoked', now(), 'Most rewards a customer can get reached', p_by);
                CONTINUE;
            END IF;
        END IF;
        PERFORM public.fn_referral_give(f, k, v_side, v_cust, v_kind, v_value, v_prod, v_qty, p_by);
    END LOOP;
    UPDATE public.referrals SET status = 'rewarded', rewarded_at = now() WHERE id = f.id;
END;
$$;

-- One reward, given the way its kind needs.
CREATE OR REPLACE FUNCTION public.fn_referral_give(
    f public.referrals, k public.referral_campaigns, p_side text, p_cust uuid, p_kind text,
    p_value numeric, p_prod uuid, p_qty numeric, p_by text
) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
    c        public.customers%ROWTYPE;
    v_rid    uuid;
    v_promo  uuid;
    v_code   text;
    v_exp    timestamptz := CASE WHEN k.reward_expiry_days IS NOT NULL THEN now() + make_interval(days => k.reward_expiry_days) END;
    v_other  text;
BEGIN
    SELECT * INTO c FROM public.customers WHERE id = p_cust FOR UPDATE;
    SELECT name INTO v_other FROM public.customers
    WHERE id = CASE WHEN p_side = 'referrer' THEN f.referred_customer_id ELSE f.referrer_customer_id END;

    INSERT INTO public.referral_rewards (business_id, referral_id, campaign_id, customer_id, side, kind, value, points,
        product_id, qty, status, cost, expires_at, issued_by)
    VALUES (c.business_id, f.id, k.id, c.id, p_side, p_kind, CASE WHEN p_kind = 'points' THEN 0 ELSE p_value END,
        CASE WHEN p_kind = 'points' THEN p_value::int ELSE 0 END, p_prod, p_qty, 'issued',
        CASE WHEN p_kind = 'wallet' THEN p_value ELSE 0 END,
        CASE WHEN p_kind IN ('amount', 'percent', 'free_product') THEN v_exp END, p_by)
    ON CONFLICT (referral_id, side) DO NOTHING
    RETURNING id INTO v_rid;
    IF v_rid IS NULL THEN RETURN; END IF;   -- given already

    IF p_kind = 'wallet' THEN
        UPDATE public.customers SET wallet_balance = wallet_balance + p_value WHERE id = c.id;
        INSERT INTO public.wallet_transactions (business_id, customer_id, amount, balance_before, balance_after, reason, recorded_by)
        VALUES (c.business_id, c.id, p_value, c.wallet_balance, c.wallet_balance + p_value,
                'Referral reward (' || public.fn_short_name(v_other) || ')', p_by);
        INSERT INTO public.customer_ledger (business_id, customer_id, type, amount, wallet_balance, debt_balance, recorded_by, note, reference_id)
        VALUES (c.business_id, c.id, 'referral_reward', p_value, c.wallet_balance + p_value, c.debt_balance, p_by,
                'Referral reward: wallet credit', 'referral-' || v_rid::text);
    ELSIF p_kind = 'points' THEN
        IF NOT public.fn_points_on(c.business_id) THEN
            UPDATE public.referral_rewards SET status = 'revoked', ended_at = now(), end_reason = 'Points are switched off' WHERE id = v_rid;
            RETURN;
        END IF;
        UPDATE public.customers SET loyalty_points = loyalty_points + p_value::int WHERE id = c.id;
        INSERT INTO public.loyalty_points_earned (business_id, customer_id, points, source, amount)
        VALUES (c.business_id, c.id, p_value::int, 'referral', 0);
    ELSE
        -- A personal code, used once by this customer at the till.
        v_code := public.fn_promo_new_code(c.business_id, 'RW');
        INSERT INTO public.website_promo_codes (business_id, code, name, description, promo_type, kind, value, min_order,
            starts_at, ends_at, max_uses, once_per_customer, stackable, audience, product_scope, reward_product_id, reward_qty,
            use_pos, use_online, active, origin, created_by, updated_by)
        VALUES (c.business_id, v_code, 'Referral reward', 'Thank you for referring ' || public.fn_short_name(v_other) || '.',
            'customer', CASE p_kind WHEN 'free_product' THEN 'free_items' ELSE p_kind END,
            CASE WHEN p_kind = 'free_product' THEN 0 ELSE p_value END, 0, now(), v_exp, 1, true, false, 'selected', 'all',
            CASE WHEN p_kind = 'free_product' THEN p_prod END, CASE WHEN p_kind = 'free_product' THEN p_qty END,
            true, false, true, 'referral_reward', p_by, p_by)
        RETURNING id INTO v_promo;
        INSERT INTO public.promotion_customers (promotion_id, customer_id) VALUES (v_promo, c.id);
        UPDATE public.referral_rewards SET promotion_id = v_promo WHERE id = v_rid;
    END IF;
END;
$$;

-- Takes a reward back as far as it still can (the sale it came from was undone).
CREATE OR REPLACE FUNCTION public.fn_referral_take_back(p_reward_id uuid, p_reason text, p_by text DEFAULT 'System') RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
    w  public.referral_rewards%ROWTYPE;
    c  public.customers%ROWTYPE;
    v_back numeric;
    v_pts int;
BEGIN
    SELECT * INTO w FROM public.referral_rewards WHERE id = p_reward_id FOR UPDATE;
    IF NOT FOUND OR w.status IN ('revoked', 'reversed', 'expired') THEN RETURN; END IF;
    IF w.kind = 'wallet' THEN
        SELECT * INTO c FROM public.customers WHERE id = w.customer_id FOR UPDATE;
        v_back := LEAST(w.value, c.wallet_balance);       -- what wasn't spent yet
        IF v_back > 0 THEN
            UPDATE public.customers SET wallet_balance = wallet_balance - v_back WHERE id = c.id;
            INSERT INTO public.wallet_transactions (business_id, customer_id, amount, balance_before, balance_after, reason, recorded_by)
            VALUES (c.business_id, c.id, -v_back, c.wallet_balance, c.wallet_balance - v_back, 'Referral reward taken back: ' || p_reason, p_by);
            INSERT INTO public.customer_ledger (business_id, customer_id, type, amount, wallet_balance, debt_balance, recorded_by, note, reference_id)
            VALUES (c.business_id, c.id, 'referral_reversal', v_back, c.wallet_balance - v_back, c.debt_balance, p_by,
                    'Referral reward taken back: ' || p_reason, 'referral-back-' || w.id::text);
        END IF;
        UPDATE public.referral_rewards SET status = 'reversed', reversed_amount = COALESCE(v_back, 0),
            cost = w.value - COALESCE(v_back, 0), ended_at = now(), end_reason = p_reason WHERE id = w.id;
    ELSIF w.kind = 'points' THEN
        SELECT * INTO c FROM public.customers WHERE id = w.customer_id FOR UPDATE;
        v_pts := LEAST(w.points, c.loyalty_points);
        UPDATE public.customers SET loyalty_points = loyalty_points - v_pts WHERE id = c.id;
        UPDATE public.referral_rewards SET status = 'reversed', reversed_amount = v_pts, ended_at = now(), end_reason = p_reason WHERE id = w.id;
    ELSIF w.kind IN ('amount', 'percent', 'free_product') THEN
        IF w.status = 'used' THEN RETURN; END IF;           -- already spent at a sale: the sale keeps it
        UPDATE public.website_promo_codes SET active = false, archived_at = now() WHERE id = w.promotion_id;
        UPDATE public.referral_rewards SET status = 'revoked', ended_at = now(), end_reason = p_reason WHERE id = w.id;
    ELSIF w.kind = 'discount_at_sale' THEN
        UPDATE public.referral_rewards SET status = 'reversed', cost = 0, ended_at = now(), end_reason = p_reason WHERE id = w.id;
    END IF;
END;
$$;

-- ============================================================================ hooks from the sale
-- A sale with a promotion was saved.
CREATE OR REPLACE FUNCTION public.fn_promo_after_redeem(p_redemption_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    rd  public.promotion_redemptions%ROWTYPE;
    t   public.transactions%ROWTYPE;
    f   public.referrals%ROWTYPE;
    k   public.referral_campaigns%ROWTYPE;
    v_flags text[] := '{}';
    v_net numeric;
    v_min numeric;
BEGIN
    SELECT * INTO rd FROM public.promotion_redemptions WHERE id = p_redemption_id;
    SELECT * INTO t FROM public.transactions WHERE id = rd.transaction_id;

    -- A referral reward code was used.
    UPDATE public.referral_rewards SET status = 'used', used_at = now(), used_transaction_id = t.id, cost = rd.discount
    WHERE promotion_id = rd.promotion_id AND status = 'issued';

    -- The first purchase of a referred customer.
    SELECT * INTO f FROM public.referrals WHERE redemption_id = rd.id FOR UPDATE;
    IF NOT FOUND THEN RETURN; END IF;
    IF f.status NOT IN ('pending', 'expired') THEN
        RAISE EXCEPTION 'This referral was already % . Apply the code again.', f.status;
    END IF;
    SELECT * INTO k FROM public.referral_campaigns WHERE id = f.campaign_id;
    SELECT min_order INTO v_min FROM public.website_promo_codes WHERE id = k.welcome_promotion_id;
    v_net := t.final_total - t.tax - t.delivery_fee;

    -- Signs worth a second look (fraud monitoring).
    IF (SELECT count(*) FROM public.referrals x WHERE x.referrer_customer_id = f.referrer_customer_id
        AND x.status IN ('qualified', 'rewarded') AND x.qualified_at > now() - interval '24 hours') >= 2 THEN
        v_flags := array_append(v_flags, 'many_in_a_day');
    END IF;
    IF f.staff_id IS NOT NULL AND (SELECT count(*) FROM public.referrals x WHERE x.referrer_customer_id = f.referrer_customer_id
        AND x.staff_id = f.staff_id AND x.status IN ('qualified', 'rewarded')) >= 2 THEN
        v_flags := array_append(v_flags, 'same_cashier_again');
    END IF;
    IF v_min > 0 AND rd.subtotal < v_min * 1.1 THEN
        v_flags := array_append(v_flags, 'just_over_minimum');
    END IF;
    IF (SELECT created_at FROM public.customers WHERE id = f.referred_customer_id) > now() - interval '15 minutes' THEN
        v_flags := array_append(v_flags, 'added_at_the_till');
    END IF;
    IF EXISTS (SELECT 1 FROM public.customers a JOIN public.customers c ON c.id = f.referred_customer_id
               WHERE a.id = f.referrer_customer_id
                 AND right(public.fn_phone_key(a.phone), 6) = right(public.fn_phone_key(c.phone), 6)) THEN
        v_flags := array_append(v_flags, 'similar_phone');
    END IF;

    UPDATE public.referrals SET status = 'qualified', transaction_id = t.id, purchase_amount = v_net,
        welcome_discount = rd.discount, qualified_at = now(), flags = v_flags,
        reward_due_at = now() + make_interval(days => k.hold_days), ended_at = NULL, end_reason = NULL
    WHERE id = f.id;
    IF rd.discount > 0 THEN
        INSERT INTO public.referral_rewards (business_id, referral_id, campaign_id, customer_id, side, kind, value, status, cost,
            used_at, used_transaction_id, issued_by)
        VALUES (f.business_id, f.id, k.id, f.referred_customer_id, 'referred', 'discount_at_sale', rd.discount, 'used', rd.discount,
            now(), t.id, COALESCE(t.staff_name, 'Till'))
        ON CONFLICT (referral_id, side) DO NOTHING;
    END IF;
    IF k.hold_days = 0 AND NOT (k.review_flagged AND cardinality(v_flags) > 0) THEN
        PERFORM public.fn_referral_issue(f.id, 'Till');
    END IF;
END;
$$;

-- A sale with a promotion was cancelled or refunded.
CREATE OR REPLACE FUNCTION public.fn_promo_after_end(p_redemption_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    rd  public.promotion_redemptions%ROWTYPE;
    f   public.referrals%ROWTYPE;
    w   public.referral_rewards%ROWTYPE;
    v_min numeric;
    v_reason text;
BEGIN
    SELECT * INTO rd FROM public.promotion_redemptions WHERE id = p_redemption_id;
    -- A reward code's sale undone: the code can be used again.
    IF rd.status IN ('cancelled', 'refunded') THEN
        UPDATE public.referral_rewards SET status = 'issued', used_at = NULL, used_transaction_id = NULL, cost = 0
        WHERE promotion_id = rd.promotion_id AND status = 'used' AND used_transaction_id = rd.transaction_id AND kind <> 'discount_at_sale';
    END IF;

    SELECT * INTO f FROM public.referrals WHERE redemption_id = rd.id FOR UPDATE;
    IF NOT FOUND OR f.status NOT IN ('pending', 'qualified', 'rewarded') THEN RETURN; END IF;
    IF rd.status = 'partially_refunded' THEN
        SELECT p.min_order INTO v_min FROM public.referral_campaigns k JOIN public.website_promo_codes p ON p.id = k.welcome_promotion_id
        WHERE k.id = f.campaign_id;
        IF COALESCE(rd.sale_total, 0) - rd.refunded_amount >= COALESCE(v_min, 0) THEN RETURN; END IF;
        v_reason := 'First purchase refunded below the minimum';
    ELSIF rd.status = 'refunded' THEN v_reason := 'First purchase refunded';
    ELSIF rd.status = 'cancelled' THEN v_reason := 'First purchase cancelled';
    ELSE RETURN;
    END IF;
    FOR w IN SELECT * FROM public.referral_rewards WHERE referral_id = f.id LOOP
        PERFORM public.fn_referral_take_back(w.id, v_reason);
    END LOOP;
    UPDATE public.referrals SET status = 'cancelled', ended_at = now(), end_reason = v_reason,
        flags = CASE WHEN f.status = 'rewarded' THEN array_append(flags, 'refunded_after_reward') ELSE flags END
    WHERE id = f.id;
END;
$$;

-- ============================================================================ the timed jobs
-- Rewards that waited long enough; held uses and reward codes that ran out.
CREATE OR REPLACE FUNCTION public.run_referral_jobs() RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
    f  record;
    n  int := 0;
BEGIN
    UPDATE public.promotion_redemptions SET status = 'expired', ended_at = now(), end_reason = 'Hold timed out'
    WHERE status = 'reserved' AND expires_at < now();
    UPDATE public.referrals x SET status = 'expired', ended_at = now(), end_reason = 'The sale was never finished'
    FROM public.promotion_redemptions r
    WHERE x.redemption_id = r.id AND x.status = 'pending' AND r.status IN ('expired', 'released');
    UPDATE public.referral_rewards SET status = 'expired', ended_at = now(), end_reason = 'Not used in time'
    WHERE status = 'issued' AND expires_at IS NOT NULL AND expires_at < now();

    FOR f IN SELECT x.id FROM public.referrals x
             JOIN public.referral_campaigns k ON k.id = x.campaign_id
             JOIN public.referral_codes c ON c.id = x.code_id
             WHERE x.status = 'qualified' AND x.reward_due_at <= now()
               AND c.status = 'active' AND NOT (k.review_flagged AND cardinality(x.flags) > 0)
    LOOP
        PERFORM public.fn_referral_issue(f.id, 'System');
        n := n + 1;
    END LOOP;
    RETURN n;
END;
$$;

DO $do$ BEGIN
    IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
        PERFORM cron.unschedule('expire-promotion-holds') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'expire-promotion-holds');
        PERFORM cron.schedule('referral-and-promotion-jobs', '*/10 * * * *', $job$SELECT public.run_referral_jobs()$job$);
    END IF;
END $do$;

-- ============================================================================ managing
-- p_doc: name, description, active, startsAt, endsAt, referrerKind, referrerValue,
-- referrerProductId, referrerQty, welcomeKind, welcomeValue, welcomeProductId, welcomeQty,
-- minPurchase, maxDiscount, productScope, productIds[], categories[], branchIds[], stackable,
-- maxPerReferrer, maxTotal, maxRewardsPerCustomer, rewardExpiryDays, holdDays,
-- excludeExisting, newCustomerDays, requirePhone, reviewFlagged.
CREATE OR REPLACE FUNCTION public.save_referral_campaign(p_business_id uuid, p_id uuid, p_doc jsonb) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
    d       jsonb := COALESCE(p_doc, '{}'::jsonb);
    k       public.referral_campaigns%ROWTYPE;
    v_by    text;
    v_wk    text := d->>'welcomeKind';
    v_rk    text := d->>'referrerKind';
    v_promo uuid;
    v_id    uuid;
    v_scope text := COALESCE(d->>'productScope', 'all');
    v_active boolean := COALESCE((d->>'active')::boolean, true);
BEGIN
    PERFORM public.assert_business_member(p_business_id);
    PERFORM public.assert_permission(p_business_id, 'referrals.manage');
    v_by := COALESCE((public.fn_my_employee(p_business_id)).name, 'Staff');
    IF NULLIF(trim(COALESCE(d->>'name', '')), '') IS NULL THEN RAISE EXCEPTION 'Give the programme a name.'; END IF;
    IF v_rk NOT IN ('amount', 'percent', 'wallet', 'free_product', 'points') THEN RAISE EXCEPTION 'Choose what the person who refers gets.'; END IF;
    IF v_wk NOT IN ('amount', 'percent', 'wallet', 'free_product', 'points') THEN RAISE EXCEPTION 'Choose what the new customer gets.'; END IF;
    IF v_rk <> 'free_product' AND COALESCE(NULLIF(d->>'referrerValue', '')::numeric, 0) <= 0 THEN RAISE EXCEPTION 'Type how much the person who refers gets.'; END IF;
    IF v_wk <> 'free_product' AND COALESCE(NULLIF(d->>'welcomeValue', '')::numeric, 0) <= 0 THEN RAISE EXCEPTION 'Type how much the new customer gets.'; END IF;
    IF v_rk = 'free_product' AND (NULLIF(d->>'referrerProductId', '') IS NULL OR COALESCE(NULLIF(d->>'referrerQty', '')::numeric, 0) <= 0) THEN
        RAISE EXCEPTION 'Choose the free product and how many for the person who refers.'; END IF;
    IF v_wk = 'free_product' AND (NULLIF(d->>'welcomeProductId', '') IS NULL OR COALESCE(NULLIF(d->>'welcomeQty', '')::numeric, 0) <= 0) THEN
        RAISE EXCEPTION 'Choose the free product and how many for the new customer.'; END IF;
    IF (v_rk = 'percent' AND (d->>'referrerValue')::numeric > 90) OR (v_wk = 'percent' AND (d->>'welcomeValue')::numeric > 90) THEN
        RAISE EXCEPTION 'A percentage is between 1 and 90.'; END IF;
    IF (v_rk = 'points' OR v_wk = 'points') AND NOT public.fn_points_on(p_business_id) THEN
        RAISE EXCEPTION 'Loyalty points are switched off. Switch them on, or choose another reward.'; END IF;
    IF v_scope NOT IN ('all', 'products', 'categories') THEN RAISE EXCEPTION 'Choose what the first purchase must include.'; END IF;

    IF p_id IS NOT NULL THEN
        SELECT * INTO k FROM public.referral_campaigns WHERE id = p_id AND business_id = p_business_id FOR UPDATE;
        IF NOT FOUND THEN RAISE EXCEPTION 'That programme was not found.'; END IF;
        IF k.archived_at IS NOT NULL THEN RAISE EXCEPTION 'That programme was ended. Start a new one.'; END IF;
        v_promo := k.welcome_promotion_id;
    END IF;
    -- Starting a programme ends the one running (one at a time per branch).
    IF v_active THEN
        UPDATE public.referral_campaigns SET active = false, updated_at = now(), updated_by = v_by
        WHERE business_id = p_business_id AND active AND id IS DISTINCT FROM p_id;
    END IF;

    -- The hidden first-purchase rules.
    IF v_promo IS NULL THEN
        INSERT INTO public.website_promo_codes (business_id, code, name, promo_type, kind, value, audience, use_pos, use_online,
            origin, active, created_by)
        VALUES (p_business_id, public.fn_promo_new_code(p_business_id, 'REFW'), 'Referral welcome', 'referral', 'none', 0,
            'referral', true, false, 'referral_welcome', true, v_by)
        RETURNING id INTO v_promo;
    END IF;
    UPDATE public.website_promo_codes SET
        name = 'Referral welcome: ' || trim(d->>'name'),
        kind = CASE v_wk WHEN 'amount' THEN 'amount' WHEN 'percent' THEN 'percent' WHEN 'free_product' THEN 'free_items' ELSE 'none' END,
        value = CASE WHEN v_wk IN ('amount', 'percent') THEN (d->>'welcomeValue')::numeric ELSE 0 END,
        reward_product_id = CASE WHEN v_wk = 'free_product' THEN (d->>'welcomeProductId')::uuid END,
        reward_qty = CASE WHEN v_wk = 'free_product' THEN (d->>'welcomeQty')::numeric END,
        min_order = COALESCE(NULLIF(d->>'minPurchase', '')::numeric, 0),
        max_discount = NULLIF(NULLIF(d->>'maxDiscount', '')::numeric, 0),
        starts_at = NULLIF(d->>'startsAt', '')::timestamptz, ends_at = NULLIF(d->>'endsAt', '')::timestamptz,
        product_scope = v_scope, stackable = COALESCE((d->>'stackable')::boolean, false),
        active = v_active, updated_by = v_by, updated_at = now()
    WHERE id = v_promo;
    DELETE FROM public.promotion_products WHERE promotion_id = v_promo;
    DELETE FROM public.promotion_categories WHERE promotion_id = v_promo;
    DELETE FROM public.promotion_branches WHERE promotion_id = v_promo;
    IF v_scope = 'products' THEN
        INSERT INTO public.promotion_products (promotion_id, product_id)
        SELECT DISTINCT v_promo, pr.id FROM jsonb_array_elements_text(COALESCE(d->'productIds', '[]')) x
        JOIN public.products pr ON pr.id = x::uuid AND pr.business_id = p_business_id;
    ELSIF v_scope = 'categories' THEN
        INSERT INTO public.promotion_categories (promotion_id, category)
        SELECT DISTINCT v_promo, trim(x) FROM jsonb_array_elements_text(COALESCE(d->'categories', '[]')) x WHERE trim(x) <> '';
    END IF;
    INSERT INTO public.promotion_branches (promotion_id, business_id)
    SELECT DISTINCT v_promo, x::uuid FROM jsonb_array_elements_text(COALESCE(d->'branchIds', '[]')) x
    WHERE x::uuid <> p_business_id AND public.fn_branches_share_owner(p_business_id, x::uuid);

    IF p_id IS NULL THEN
        INSERT INTO public.referral_campaigns (business_id, name, welcome_promotion_id, active, created_by,
            referrer_kind, referrer_value, referrer_product_id, referrer_qty, welcome_kind, welcome_value, welcome_product_id, welcome_qty)
        VALUES (p_business_id, trim(d->>'name'), v_promo, false, v_by,
            v_rk, CASE WHEN v_rk = 'free_product' THEN 0 ELSE (d->>'referrerValue')::numeric END,
            CASE WHEN v_rk = 'free_product' THEN (d->>'referrerProductId')::uuid END, CASE WHEN v_rk = 'free_product' THEN (d->>'referrerQty')::numeric END,
            v_wk, CASE WHEN v_wk = 'free_product' THEN 0 ELSE (d->>'welcomeValue')::numeric END,
            CASE WHEN v_wk = 'free_product' THEN (d->>'welcomeProductId')::uuid END, CASE WHEN v_wk = 'free_product' THEN (d->>'welcomeQty')::numeric END)
        RETURNING id INTO v_id;
    ELSE
        v_id := p_id;
    END IF;
    UPDATE public.referral_campaigns SET
        name = trim(d->>'name'), description = NULLIF(trim(COALESCE(d->>'description', '')), ''), active = v_active,
        starts_at = NULLIF(d->>'startsAt', '')::timestamptz, ends_at = NULLIF(d->>'endsAt', '')::timestamptz,
        referrer_kind = v_rk, referrer_value = CASE WHEN v_rk = 'free_product' THEN 0 ELSE (d->>'referrerValue')::numeric END,
        referrer_product_id = CASE WHEN v_rk = 'free_product' THEN (d->>'referrerProductId')::uuid END,
        referrer_qty = CASE WHEN v_rk = 'free_product' THEN (d->>'referrerQty')::numeric END,
        welcome_kind = v_wk, welcome_value = CASE WHEN v_wk = 'free_product' THEN 0 ELSE (d->>'welcomeValue')::numeric END,
        welcome_product_id = CASE WHEN v_wk = 'free_product' THEN (d->>'welcomeProductId')::uuid END,
        welcome_qty = CASE WHEN v_wk = 'free_product' THEN (d->>'welcomeQty')::numeric END,
        max_per_referrer = NULLIF(d->>'maxPerReferrer', '')::int, max_total = NULLIF(d->>'maxTotal', '')::int,
        max_rewards_per_customer = NULLIF(d->>'maxRewardsPerCustomer', '')::int,
        reward_expiry_days = NULLIF(d->>'rewardExpiryDays', '')::int,
        hold_days = COALESCE(NULLIF(d->>'holdDays', '')::int, 3),
        exclude_existing = COALESCE((d->>'excludeExisting')::boolean, true),
        new_customer_days = COALESCE(NULLIF(d->>'newCustomerDays', '')::int, 30),
        require_phone = COALESCE((d->>'requirePhone')::boolean, true),
        review_flagged = COALESCE((d->>'reviewFlagged')::boolean, true),
        updated_by = v_by, updated_at = now()
    WHERE id = v_id;
    RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.end_referral_campaign(p_id uuid) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE k public.referral_campaigns%ROWTYPE;
BEGIN
    SELECT * INTO k FROM public.referral_campaigns WHERE id = p_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'That programme was not found.'; END IF;
    PERFORM public.assert_business_member(k.business_id);
    PERFORM public.assert_permission(k.business_id, 'referrals.manage');
    UPDATE public.referral_campaigns SET active = false, archived_at = now(), updated_at = now() WHERE id = p_id;
    UPDATE public.website_promo_codes SET active = false WHERE id = k.welcome_promotion_id;
END;
$$;

-- Suspend (hold: no new uses, no rewards paid), revoke (for good) or restore a code.
CREATE OR REPLACE FUNCTION public.set_referral_code_status(p_code_id uuid, p_status text, p_reason text) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.referral_codes%ROWTYPE;
BEGIN
    SELECT * INTO r FROM public.referral_codes WHERE id = p_code_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'That referral code was not found.'; END IF;
    PERFORM public.assert_business_member(r.business_id);
    PERFORM public.assert_permission(r.business_id, 'referrals.manage');
    IF p_status NOT IN ('active', 'suspended', 'revoked') THEN RAISE EXCEPTION 'Unknown status %.', p_status; END IF;
    IF r.status = 'revoked' THEN RAISE EXCEPTION 'A revoked code stays revoked. The customer can get a new one.'; END IF;
    IF p_status <> 'active' AND NULLIF(trim(COALESCE(p_reason, '')), '') IS NULL THEN RAISE EXCEPTION 'Say why.'; END IF;
    UPDATE public.referral_codes SET status = p_status, status_reason = NULLIF(trim(p_reason), ''),
        status_by = COALESCE((public.fn_my_employee(r.business_id)).name, 'Staff'), status_at = now()
    WHERE id = r.id;
END;
$$;

-- A manager's call on a qualified referral: pay the rewards now, or refuse them.
CREATE OR REPLACE FUNCTION public.decide_referral(p_referral_id uuid, p_approve boolean, p_reason text DEFAULT NULL) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
    f public.referrals%ROWTYPE;
    w public.referral_rewards%ROWTYPE;
    v_by text;
BEGIN
    SELECT * INTO f FROM public.referrals WHERE id = p_referral_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'That referral was not found.'; END IF;
    PERFORM public.assert_business_member(f.business_id);
    PERFORM public.assert_permission(f.business_id, 'referrals.manage');
    v_by := COALESCE((public.fn_my_employee(f.business_id)).name, 'Staff');
    IF f.status <> 'qualified' THEN RAISE EXCEPTION 'Only a referral waiting for its rewards can be decided (this one is %).', f.status; END IF;
    IF p_approve THEN
        UPDATE public.referrals SET decided_by = v_by WHERE id = f.id;
        PERFORM public.fn_referral_issue(f.id, v_by);
    ELSE
        IF NULLIF(trim(COALESCE(p_reason, '')), '') IS NULL THEN RAISE EXCEPTION 'Say why the rewards are refused.'; END IF;
        FOR w IN SELECT * FROM public.referral_rewards WHERE referral_id = f.id AND kind <> 'discount_at_sale' LOOP
            PERFORM public.fn_referral_take_back(w.id, p_reason, v_by);
        END LOOP;
        UPDATE public.referrals SET status = 'rejected', ended_at = now(), end_reason = trim(p_reason), decided_by = v_by WHERE id = f.id;
    END IF;
END;
$$;

-- ============================================================================ reading
-- A customer's code and how it's doing (staff screen). Makes the code if a programme runs.
CREATE OR REPLACE FUNCTION public.customer_referral(p_customer_id uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
    c public.customers%ROWTYPE;
    r public.referral_codes%ROWTYPE;
    k public.referral_campaigns%ROWTYPE;
BEGIN
    SELECT * INTO c FROM public.customers WHERE id = p_customer_id AND deleted_at IS NULL;
    IF NOT FOUND THEN RAISE EXCEPTION 'That customer was not found.'; END IF;
    PERFORM public.assert_business_member(c.business_id);
    PERFORM public.assert_permission(c.business_id, 'customers.view');
    k := public.fn_referral_campaign(c.business_id);
    SELECT * INTO r FROM public.referral_codes WHERE customer_id = c.id AND status <> 'revoked';
    IF r.id IS NULL AND k.id IS NOT NULL THEN r := public.fn_referral_code_for(c.id); END IF;
    RETURN public.fn_referral_summary(c, r, k);
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_referral_summary(c public.customers, r public.referral_codes, k public.referral_campaigns)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT jsonb_build_object(
        'code', r.code, 'codeId', r.id, 'codeStatus', r.status, 'codeReason', r.status_reason,
        'campaign', CASE WHEN k.id IS NULL THEN NULL ELSE jsonb_build_object('name', k.name, 'endsAt', k.ends_at,
            'youGet', public.fn_referral_reward_text(k.referrer_kind, k.referrer_value, k.referrer_product_id, k.referrer_qty),
            'friendGets', public.fn_referral_reward_text(k.welcome_kind, k.welcome_value, k.welcome_product_id, k.welcome_qty),
            'minPurchase', (SELECT min_order FROM public.website_promo_codes WHERE id = k.welcome_promotion_id)) END,
        'invited', (SELECT count(*) FROM public.referrals x WHERE x.referrer_customer_id = c.id AND x.status <> 'cancelled'),
        'successful', (SELECT count(*) FROM public.referrals x WHERE x.referrer_customer_id = c.id AND x.status = 'rewarded'),
        'pending', (SELECT count(*) FROM public.referrals x WHERE x.referrer_customer_id = c.id AND x.status IN ('pending', 'qualified')),
        'rewardsEarned', (SELECT count(*) FROM public.referral_rewards w WHERE w.customer_id = c.id AND w.side = 'referrer' AND w.status IN ('issued', 'used')),
        'rewardsAvailable', COALESCE((SELECT jsonb_agg(jsonb_build_object('kind', w.kind, 'what',
                public.fn_referral_reward_text(w.kind, CASE WHEN w.kind = 'points' THEN w.points ELSE w.value END, w.product_id, w.qty),
                'code', p.code, 'expiresAt', w.expires_at) ORDER BY w.issued_at DESC)
            FROM public.referral_rewards w LEFT JOIN public.website_promo_codes p ON p.id = w.promotion_id
            WHERE w.customer_id = c.id AND w.side = 'referrer' AND w.status = 'issued' AND w.kind IN ('amount', 'percent', 'free_product')), '[]'),
        'rewardsUsed', (SELECT count(*) FROM public.referral_rewards w WHERE w.customer_id = c.id AND w.side = 'referrer'
            AND (w.status = 'used' OR (w.status = 'issued' AND w.kind IN ('wallet', 'points')))),
        'walletEarned', (SELECT COALESCE(SUM(w.value - w.reversed_amount), 0) FROM public.referral_rewards w
            WHERE w.customer_id = c.id AND w.side = 'referrer' AND w.kind = 'wallet' AND w.status IN ('issued', 'reversed')),
        'pointsEarned', (SELECT COALESCE(SUM(w.points), 0) FROM public.referral_rewards w
            WHERE w.customer_id = c.id AND w.side = 'referrer' AND w.kind = 'points' AND w.status = 'issued'),
        -- Friends by first name and initial only.
        'friends', COALESCE((SELECT jsonb_agg(jsonb_build_object('name', public.fn_short_name(f.name), 'status', x.status, 'at', x.created_at)
                ORDER BY x.created_at DESC)
            FROM (SELECT * FROM public.referrals x WHERE x.referrer_customer_id = c.id AND x.status <> 'cancelled'
                  ORDER BY x.created_at DESC LIMIT 20) x
            JOIN public.customers f ON f.id = x.referred_customer_id), '[]'))
$$;

-- The signed-in website customer's own referral page.
CREATE OR REPLACE FUNCTION public.my_referral(p_slug text) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_b  uuid;
    c    public.customers%ROWTYPE;
    r    public.referral_codes%ROWTYPE;
    k    public.referral_campaigns%ROWTYPE;
BEGIN
    IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Please sign in first.'; END IF;
    SELECT id INTO v_b FROM public.businesses WHERE website_slug = p_slug AND deleted_at IS NULL;
    IF v_b IS NULL THEN RAISE EXCEPTION 'Shop not found.'; END IF;
    SELECT * INTO c FROM public.customers WHERE id = public.fn_account_customer(auth.uid(), v_b) AND deleted_at IS NULL;
    k := public.fn_referral_campaign(v_b);
    IF c.id IS NULL THEN
        RETURN jsonb_build_object('linked', false, 'running', k.id IS NOT NULL);
    END IF;
    SELECT * INTO r FROM public.referral_codes WHERE customer_id = c.id AND status <> 'revoked';
    IF r.id IS NULL AND k.id IS NOT NULL THEN r := public.fn_referral_code_for(c.id); END IF;
    RETURN jsonb_build_object('linked', true, 'running', k.id IS NOT NULL) || public.fn_referral_summary(c, r, k);
END;
$$;

-- Management view of the programme for a period.
CREATE OR REPLACE FUNCTION public.referral_dashboard(p_business_id uuid, p_from date, p_to date) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_from timestamptz := (p_from::timestamp AT TIME ZONE 'Africa/Nairobi');
    v_to   timestamptz := ((p_to + 1)::timestamp AT TIME ZONE 'Africa/Nairobi');
    k      public.referral_campaigns%ROWTYPE;
    v_res  jsonb;
BEGIN
    PERFORM public.assert_business_member(p_business_id);
    PERFORM public.assert_permission(p_business_id, 'referrals.view', 'referrals.manage');
    k := public.fn_referral_campaign(p_business_id);
    WITH x AS (SELECT * FROM public.referrals WHERE business_id = p_business_id AND created_at >= v_from AND created_at < v_to
                  AND NOT (status = 'cancelled' AND end_reason = 'Sale not completed')),
         w AS (SELECT * FROM public.referral_rewards WHERE business_id = p_business_id AND issued_at >= v_from AND issued_at < v_to)
    SELECT jsonb_build_object(
        'campaign', CASE WHEN k.id IS NULL THEN NULL ELSE (to_jsonb(k) - 'business_id') || jsonb_build_object(
            'welcome', (SELECT jsonb_build_object('minPurchase', p.min_order, 'maxDiscount', p.max_discount, 'stackable', p.stackable,
                    'productScope', p.product_scope,
                    'productIds', COALESCE((SELECT jsonb_agg(product_id) FROM public.promotion_products WHERE promotion_id = p.id), '[]'),
                    'categories', COALESCE((SELECT jsonb_agg(category) FROM public.promotion_categories WHERE promotion_id = p.id), '[]'),
                    'branchIds', COALESCE((SELECT jsonb_agg(business_id) FROM public.promotion_branches WHERE promotion_id = p.id), '[]'))
                FROM public.website_promo_codes p WHERE p.id = k.welcome_promotion_id),
            'referrerText', public.fn_referral_reward_text(k.referrer_kind, k.referrer_value, k.referrer_product_id, k.referrer_qty),
            'welcomeText', public.fn_referral_reward_text(k.welcome_kind, k.welcome_value, k.welcome_product_id, k.welcome_qty)) END,
        'counts', (SELECT jsonb_build_object('total', count(*),
            'pending', count(*) FILTER (WHERE status = 'pending'), 'qualified', count(*) FILTER (WHERE status = 'qualified'),
            'rewarded', count(*) FILTER (WHERE status = 'rewarded'), 'rejected', count(*) FILTER (WHERE status = 'rejected'),
            'cancelled', count(*) FILTER (WHERE status = 'cancelled'), 'expired', count(*) FILTER (WHERE status = 'expired'),
            'flagged', count(*) FILTER (WHERE status = 'qualified' AND cardinality(flags) > 0),
            'firstPurchases', COALESCE(SUM(purchase_amount) FILTER (WHERE status IN ('qualified', 'rewarded')), 0)) FROM x),
        'costs', (SELECT jsonb_build_object(
            'wallet', COALESCE(SUM(cost) FILTER (WHERE kind = 'wallet'), 0),
            'welcomeDiscounts', COALESCE(SUM(cost) FILTER (WHERE kind = 'discount_at_sale'), 0),
            'rewardCodesUsed', COALESCE(SUM(cost) FILTER (WHERE kind IN ('amount', 'percent', 'free_product') AND status = 'used'), 0),
            'rewardCodesOpen', count(*) FILTER (WHERE kind IN ('amount', 'percent', 'free_product') AND status = 'issued'),
            'points', COALESCE(SUM(points) FILTER (WHERE kind = 'points' AND status = 'issued'), 0),
            'takenBack', COALESCE(SUM(reversed_amount) FILTER (WHERE kind = 'wallet'), 0),
            'total', COALESCE(SUM(cost), 0)) FROM w),
        -- What referred customers have bought since they came (not extra sales caused by it).
        'referredSales', (SELECT COALESCE(SUM(t.final_total - t.tax - t.delivery_fee), 0) FROM public.transactions t
            JOIN public.referrals y ON y.referred_customer_id = t.customer_id AND y.status IN ('qualified', 'rewarded')
            WHERE y.business_id = p_business_id AND t.deleted_at IS NULL AND t.timestamp >= y.created_at
              AND t.timestamp >= v_from AND t.timestamp < v_to),
        'topReferrers', COALESCE((SELECT jsonb_agg(z ORDER BY (z->>'rewarded')::int DESC, (z->>'referrals')::int DESC) FROM (
            SELECT jsonb_build_object('customerId', a.id, 'name', a.name, 'code', rc.code, 'codeId', rc.id, 'codeStatus', rc.status,
                'referrals', count(*), 'rewarded', count(*) FILTER (WHERE x.status = 'rewarded'),
                'flagged', count(*) FILTER (WHERE cardinality(x.flags) > 0),
                'cost', COALESCE((SELECT SUM(cost) FROM public.referral_rewards w2 WHERE w2.customer_id = a.id AND w2.side = 'referrer'), 0)) AS z
            FROM x JOIN public.customers a ON a.id = x.referrer_customer_id
            LEFT JOIN public.referral_codes rc ON rc.id = x.code_id
            GROUP BY a.id, a.name, rc.code, rc.id, rc.status LIMIT 20) s), '[]'),
        'referrals', COALESCE((SELECT jsonb_agg(z ORDER BY z->>'at' DESC) FROM (
            SELECT jsonb_build_object('id', x.id, 'at', x.created_at, 'status', x.status, 'code', x.code,
                'referrer', a.name, 'referred', c.name, 'purchase', x.purchase_amount, 'welcomeDiscount', x.welcome_discount,
                'flags', to_jsonb(x.flags), 'staff', x.staff_name, 'rewardDueAt', x.reward_due_at, 'endReason', x.end_reason,
                'receipt', CASE WHEN x.transaction_id IS NOT NULL THEN public.fn_receipt_number(x.transaction_id) END,
                'rewards', COALESCE((SELECT jsonb_agg(jsonb_build_object('side', w2.side, 'kind', w2.kind, 'status', w2.status,
                    'what', public.fn_referral_reward_text(CASE WHEN w2.kind = 'discount_at_sale' THEN 'amount' ELSE w2.kind END,
                        CASE WHEN w2.kind = 'points' THEN w2.points ELSE w2.value END, w2.product_id, w2.qty)))
                    FROM public.referral_rewards w2 WHERE w2.referral_id = x.id), '[]')) AS z
            FROM x JOIN public.customers a ON a.id = x.referrer_customer_id JOIN public.customers c ON c.id = x.referred_customer_id
            ORDER BY x.created_at DESC LIMIT 200) s), '[]')
    ) INTO v_res;
    RETURN v_res;
END;
$$;

-- ============================================================================ who may call what
DO $do$
DECLARE f text;
BEGIN
    FOREACH f IN ARRAY ARRAY[
        'public.fn_code_not_taken()', 'public.fn_referral_campaign(uuid)', 'public.fn_referral_code_for(uuid)',
        'public.fn_referral_reward_text(text, numeric, uuid, numeric)',
        'public.fn_referral_evaluate(public.referral_codes, uuid, uuid, jsonb, numeric, uuid, uuid)',
        'public.fn_referral_find_code(uuid, text)', 'public.fn_referral_issue(uuid, text)',
        'public.fn_referral_give(public.referrals, public.referral_campaigns, text, uuid, text, numeric, uuid, numeric, text)',
        'public.fn_referral_take_back(uuid, text, text)', 'public.fn_promo_after_redeem(uuid)', 'public.fn_promo_after_end(uuid)',
        'public.run_referral_jobs()', 'public.fn_referral_summary(public.customers, public.referral_codes, public.referral_campaigns)']
    LOOP
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', f);
        EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', f);
    END LOOP;
    FOREACH f IN ARRAY ARRAY[
        'public.promo_check(uuid, text, uuid, jsonb, numeric)', 'public.promo_reserve(uuid, text, uuid, jsonb, numeric, text)',
        'public.promo_release(uuid)', 'public.save_referral_campaign(uuid, uuid, jsonb)', 'public.end_referral_campaign(uuid)',
        'public.set_referral_code_status(uuid, text, text)', 'public.decide_referral(uuid, boolean, text)',
        'public.customer_referral(uuid)', 'public.my_referral(text)', 'public.referral_dashboard(uuid, date, date)']
    LOOP
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', f);
        EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', f);
    END LOOP;
END $do$;

-- ===================================================================
-- 20261126003_promotion_referral_books
-- ===================================================================
-- 2026-11-17 Promotions and referrals in the books.
--
-- Till sale with a promotion code (t.promotion_discount, set by the database):
--     Sales (4000)                 credit  goods at the price before the code (VAT out)
--     Promotion discounts (4050)   debit   the code's discount (a minus against sales)
--   so profit is unchanged, and the cost of promotions has its own line in Profit or loss.
--   Referral welcome discounts and used referral reward codes are promotion discounts too.
--   Other discounts (item %, cart discount, points) stay inside Sales as before.
-- Referral wallet credit (referral_rewards.kind = 'wallet'), source 'referral_reward':
--     Referral rewards (6150)      debit   what the credit has cost (less any taken back)
--     Customer wallet money (2100) credit  the customer's wallet
--   Taken back later -> the entry is posted again for the smaller amount (or removed).
-- Points from referrals post nothing when given, like all points: they cost money only when
-- spent (as a discount at the till, or Loyalty points used on debt).
-- Online-shop promo codes stay inside the online order's figures as before.

CREATE OR REPLACE FUNCTION "public"."acc_ensure_accounts"("p_business_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM public.businesses WHERE id = p_business_id) THEN
        RETURN;
    END IF;
    INSERT INTO public.acc_accounts (business_id, code, name, type, system_key, description)
    SELECT p_business_id, a.code, a.name, a.type, a.k, a.d
    FROM (VALUES
        ('1000', 'Cash on hand',                    'asset',     'cash',         'Cash in the till and the safe'),
        ('1010', 'M-Pesa',                          'asset',     'mpesa',        'Till, paybill and M-Pesa prompts'),
        ('1015', 'Airtel Money',                    'asset',     'airtel',       'Airtel Money payments'),
        ('1020', 'Bank',                            'asset',     'bank',         'Bank account'),
        ('1030', 'Card payments',                   'asset',     'card',         'Card payments not yet paid out to the bank'),
        ('1100', 'Customers owe us',                'asset',     'receivable',   'Debt from credit sales (receivables)'),
        ('1200', 'Stock',                           'asset',     'inventory',    'Value of goods in stock, at cost'),
        ('1210', 'Stock on the way to branches',    'asset',     'in_transit',   'Stock sent to another branch and not yet received there, at cost'),
        ('1300', 'VAT on purchases',                'asset',     'vat_input',    'VAT paid on supplier bills, claimed back from KRA'),
        ('1500', 'Equipment & fixed assets',        'asset',     'fixed_assets', 'Fridges, coolers, motorbikes, furniture'),
        ('1510', 'Depreciation so far',             'asset',     'acc_depreciation', 'Value used up on fixed assets (shown as minus)'),
        ('2000', 'We owe suppliers',                'liability', 'payable',      'Supplier bills not yet paid (payables)'),
        ('2050', 'Goods received, not billed',      'liability', 'grni',         'Goods that arrived before the supplier''s bill, at the order price'),
        ('2100', 'Customer wallet money',           'liability', 'wallets',      'Money customers keep with us in their wallets'),
        ('2150', 'Payments not matched to a sale',  'liability', 'unmatched',    'Walk-in payments received before a sale or customer is known'),
        ('2200', 'VAT to pay KRA',                  'liability', 'vat',          'VAT charged on sales, less VAT paid to KRA'),
        ('2300', 'Loans',                           'liability', 'loans',        'Money borrowed'),
        ('3000', 'Owner''s capital',                'equity',    'capital',      'Money the owner put into the business'),
        ('3050', 'Opening balances',                'equity',    'opening',      'Balances brought in when the books started'),
        ('3100', 'Owner drawings',                  'equity',    'drawings',     'Money the owner took out'),
        ('3200', 'Owner''s account between branches','equity',   'branches',     'Stock moved between branches of the same owner, at cost. Adds up to zero across all branches'),
        ('3900', 'Retained earnings',               'equity',    'retained',     'Profit kept from past years'),
        ('4000', 'Sales',                           'income',    'sales',        'Goods sold, after discounts, without VAT'),
        ('4010', 'Delivery fees',                   'income',    'delivery',     'Delivery charges on sales'),
        ('4900', 'Other income',                    'income',    'other_income', 'Income that is not from sales'),
        ('5000', 'Cost of goods sold',              'expense',   'cogs',         'What the goods sold cost us'),
        ('5100', 'Stock losses & count differences','expense',   'stock_loss',   'Damage, production waste, stock count differences and stock lost between branches'),
        ('5300', 'Loyalty points used on debt',     'expense',   'loyalty',      'Debt paid with loyalty points instead of money'),
        ('6000', 'General expenses',                'expense',   'expenses',     'Expenses without a category'),
        ('6900', 'Depreciation',                    'expense',   'depreciation', 'Value of fixed assets used up this period'),
        ('6990', 'Cash short or over',              'expense',   'cash_diff',    'Differences found when counting money')
    ) AS a(code, name, type, k, d)
    WHERE NOT EXISTS (SELECT 1 FROM public.acc_accounts x WHERE x.business_id = p_business_id AND x.system_key = a.k)
    ON CONFLICT DO NOTHING;
    -- A code already taken by a typed account: use the next free one in that hundred.
    INSERT INTO public.acc_accounts (business_id, code, name, type, system_key, description)
    SELECT p_business_id,
           (SELECT MIN(c)::TEXT FROM generate_series(a.code::INTEGER + 1, a.code::INTEGER + 89) c
            WHERE NOT EXISTS (SELECT 1 FROM public.acc_accounts y WHERE y.business_id = p_business_id AND y.code = c::TEXT)),
           a.name, a.type, a.k, a.d
    FROM (VALUES
        ('1210', 'Stock on the way to branches', 'asset', 'in_transit', 'Stock sent to another branch and not yet received there, at cost'),
        ('1300', 'VAT on purchases', 'asset', 'vat_input', 'VAT paid on supplier bills, claimed back from KRA'),
        ('2050', 'Goods received, not billed', 'liability', 'grni', 'Goods that arrived before the supplier''s bill, at the order price'),
        ('3200', 'Owner''s account between branches', 'equity', 'branches', 'Stock moved between branches of the same owner, at cost. Adds up to zero across all branches'),
        ('4050', 'Promotion discounts', 'income', 'promo_discounts', 'Discounts given with promotion and referral codes at the till. A minus against sales'),
        ('6150', 'Referral rewards', 'expense', 'referral_rewards', 'Wallet credit given to customers for bringing new customers')
    ) AS a(code, name, type, k, d)
    WHERE NOT EXISTS (SELECT 1 FROM public.acc_accounts x WHERE x.business_id = p_business_id AND x.system_key = a.k)
    ON CONFLICT DO NOTHING;
    INSERT INTO public.acc_settings (business_id) VALUES (p_business_id) ON CONFLICT DO NOTHING;
END;
$$;

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
        IF e.deleted_at IS NULL AND e.amount > 0 THEN
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
    ELSIF p_type = 'transfer_in' THEN
        RETURN QUERY SELECT id FROM public.stock_transfers WHERE to_business_id = p_business_id ORDER BY created_at, id OFFSET p_offset LIMIT p_limit;
    END IF;
END;
$$;

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
        'purchase_receipt', 'supplier_bill', 'supplier_return', 'transfer_out', 'transfer_close', 'transfer_in', 'referral_reward'));
END;
$$;

-- The lines for one referral wallet reward.
CREATE OR REPLACE FUNCTION public.acc_referral_lines(p_id uuid) RETURNS TABLE(b uuid, d date, m text, l jsonb)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
    w public.referral_rewards%ROWTYPE;
    v_name text;
    v_amt numeric;
    v_lines jsonb := '[]'::jsonb;
BEGIN
    SELECT * INTO w FROM public.referral_rewards WHERE id = p_id;
    IF NOT FOUND OR w.kind <> 'wallet' THEN RETURN; END IF;
    SELECT name INTO v_name FROM public.customers WHERE id = w.customer_id;
    v_amt := CASE WHEN w.status IN ('issued', 'reversed') THEN w.value - w.reversed_amount ELSE 0 END;
    v_lines := public.acc_l(v_lines, public.acc_account(w.business_id, 'referral_rewards'), v_amt);
    v_lines := public.acc_l(v_lines, public.acc_account(w.business_id, 'wallets'), -v_amt, 'customer', w.customer_id::text, v_name);
    RETURN QUERY SELECT w.business_id, (w.issued_at AT TIME ZONE 'Africa/Nairobi')::date,
        'Referral reward (wallet credit) · ' || COALESCE(v_name, 'Customer'), v_lines;
END;
$$;
REVOKE ALL ON FUNCTION public.acc_referral_lines(uuid) FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_acc_referral_reward ON public.referral_rewards;
CREATE CONSTRAINT TRIGGER trg_acc_referral_reward AFTER INSERT OR UPDATE ON public.referral_rewards
    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.acc_trg_post('referral_reward');

-- The two new accounts for every business now (others get them on first use).
SELECT public.acc_ensure_accounts(id) FROM public.businesses;

-- ===================================================================
-- 20261127001_auto_clock_out
-- ===================================================================
-- Auto clock-out: a shift left open for 15 hours is closed by the database (no phone needs
-- to be on) and the owners get the same shift report a normal clock-out sends, marked as
-- automatic. The person whose shift it was is told too.
--
-- The report mirrors shiftReportText() in src/services/shiftReport.ts: summary per product,
-- money in per method, cash to hand over, needs attention, closing balances, then details.
-- The shift ends at start + 15 hours, so the report covers exactly that window.

CREATE OR REPLACE FUNCTION public.fn_ksh(p numeric) RETURNS text
    LANGUAGE sql IMMUTABLE AS $$
    SELECT 'KSh ' || trim(to_char(round(COALESCE(p, 0)), 'FM999,999,999,990'));
$$;

CREATE OR REPLACE FUNCTION public.fn_qty(p numeric, p_unit text) RETURNS text
    LANGUAGE sql IMMUTABLE AS $$
    SELECT trim(trailing '.' FROM trim(trailing '0' FROM round(COALESCE(p, 0), 2)::text))
        || CASE WHEN COALESCE(p_unit, '') <> '' THEN ' ' || p_unit ELSE '' END;
$$;

CREATE OR REPLACE FUNCTION public.fn_shift_report_text(p_shift_id uuid, p_end timestamptz, p_note text DEFAULT NULL)
RETURNS text
    LANGUAGE plpgsql VOLATILE SECURITY DEFINER
    SET search_path TO 'public'
AS $$
DECLARE
    v_s public.shifts;
    v_name text;
    v_lines text[] := ARRAY[]::text[];
    v_r record;
    v_first boolean := true;
    v_mins int;
    v_tz constant text := 'Africa/Nairobi';
    v_cash numeric := 0; v_credit numeric := 0; v_cash_debt numeric := 0; v_cash_exp numeric := 0;
    v_money_total numeric := 0; v_expected numeric; v_exp_total numeric := 0; v_debt_total numeric := 0;
    v_till numeric;
    v_attention text[] := ARRAY[]::text[];
BEGIN
    SELECT * INTO v_s FROM public.shifts WHERE id = p_shift_id;
    IF NOT FOUND THEN RETURN NULL; END IF;
    SELECT name INTO v_name FROM public.employees WHERE id = v_s.employee_id;
    v_name := COALESCE(v_name, 'Staff');
    v_mins := GREATEST(0, round(extract(epoch FROM (p_end - v_s.start_time)) / 60));

    -- Sales by this person in the window, with each product's share of the sale's final total.
    CREATE TEMP TABLE IF NOT EXISTS _sr_sales (id uuid, final_total numeric, method text) ON COMMIT DROP;
    CREATE TEMP TABLE IF NOT EXISTS _sr_lines (product_id uuid, name text, qty numeric, share numeric, method text) ON COMMIT DROP;
    TRUNCATE _sr_sales; TRUNCATE _sr_lines;

    INSERT INTO _sr_sales
    SELECT t.id, t.final_total, t.payment_method::text
    FROM public.transactions t
    WHERE t.business_id = v_s.business_id AND t.staff_id = v_s.employee_id AND t.deleted_at IS NULL
      AND t."timestamp" BETWEEN v_s.start_time AND p_end;

    INSERT INTO _sr_lines
    SELECT i.product_id, i.product_name, i.quantity,
           CASE WHEN sum(i.unit_price * i.quantity * (1 - i.discount_percentage / 100)) OVER w > 0
                THEN s.final_total * (i.unit_price * i.quantity * (1 - i.discount_percentage / 100))
                     / sum(i.unit_price * i.quantity * (1 - i.discount_percentage / 100)) OVER w
                ELSE s.final_total / count(*) OVER w END,
           s.method
    FROM _sr_sales s JOIN public.transaction_items i ON i.transaction_id = s.id
    WINDOW w AS (PARTITION BY s.id);

    SELECT COALESCE(sum(final_total) FILTER (WHERE method = 'Cash'), 0),
           COALESCE(sum(final_total) FILTER (WHERE method IN ('Credit', 'Credit_Debt')), 0)
      INTO v_cash, v_credit FROM _sr_sales;
    SELECT COALESCE(sum(amount_paid) FILTER (WHERE payment_method = 'Cash'), 0), COALESCE(sum(amount_paid), 0)
      INTO v_cash_debt, v_debt_total
      FROM public.debt_payments
     WHERE business_id = v_s.business_id AND recorded_by = v_name AND created_at BETWEEN v_s.start_time AND p_end;
    SELECT COALESCE(sum(amount) FILTER (WHERE COALESCE(payment_method, 'Cash') = 'Cash'), 0), COALESCE(sum(amount), 0)
      INTO v_cash_exp, v_exp_total
      FROM public.expenses
     WHERE business_id = v_s.business_id AND deleted_at IS NULL AND COALESCE(created_at, date) BETWEEN v_s.start_time AND p_end;
    v_expected := round(v_cash + v_cash_debt - v_cash_exp, 2);

    v_lines := v_lines || ('*Shift report: ' || v_name || '*');
    v_lines := v_lines || (to_char(p_end AT TIME ZONE v_tz, 'Dy, FMDD Mon YYYY') || ', '
        || lower(to_char(v_s.start_time AT TIME ZONE v_tz, 'FMHH12:MI am')) || ' – '
        || lower(to_char(p_end AT TIME ZONE v_tz, 'FMHH12:MI am')) || ' ('
        || CASE WHEN v_mins >= 60 THEN (v_mins / 60) || 'h ' || (v_mins % 60) || 'm' ELSE v_mins || 'm' END || ')');
    IF p_note IS NOT NULL THEN v_lines := v_lines || p_note; END IF;

    -- Summary per product
    v_lines := v_lines || ARRAY['', '*Summary*'];
    FOR v_r IN
        SELECT l.name, COALESCE(p.unit, '') AS unit, sum(l.qty) AS sold, sum(l.share) AS earned, count(*) AS sales,
               sum(l.share) FILTER (WHERE l.method = 'Cash') AS cash,
               sum(l.share) FILTER (WHERE l.method = 'M-Pesa') AS till,
               sum(l.share) FILTER (WHERE l.method NOT IN ('Cash', 'M-Pesa', 'Credit', 'Credit_Debt')) AS other,
               sum(l.share) FILTER (WHERE l.method IN ('Credit', 'Credit_Debt')) AS credit
        FROM _sr_lines l LEFT JOIN public.products p ON p.id = l.product_id
        GROUP BY l.product_id, l.name, p.unit ORDER BY earned DESC
    LOOP
        IF NOT v_first THEN v_lines := v_lines || ''::text; END IF;
        v_first := false;
        v_lines := v_lines || v_r.name;
        v_lines := v_lines || ('- Sales: ' || fn_ksh(v_r.earned) || ' from ' || v_r.sales || CASE WHEN v_r.sales = 1 THEN ' sale' ELSE ' sales' END
            || ' (' || fn_qty(v_r.sold, v_r.unit) || ')');
        v_lines := v_lines || ('- Money taken in: ' || fn_ksh(COALESCE(v_r.cash, 0) + COALESCE(v_r.till, 0) + COALESCE(v_r.other, 0))
            || COALESCE(' (' || NULLIF(concat_ws(', ',
                   CASE WHEN COALESCE(v_r.cash, 0) <> 0 THEN 'cash ' || fn_ksh(v_r.cash) END,
                   CASE WHEN COALESCE(v_r.till, 0) <> 0 THEN 'till ' || fn_ksh(v_r.till) END,
                   CASE WHEN COALESCE(v_r.other, 0) <> 0 THEN 'other ' || fn_ksh(v_r.other) END), '') || ')', ''));
        IF COALESCE(v_r.credit, 0) <> 0 THEN v_lines := v_lines || ('- On credit: ' || fn_ksh(v_r.credit)); END IF;
    END LOOP;
    IF v_first THEN v_lines := v_lines || 'No sales this shift.'::text; END IF;

    -- Amount made: Cash, then till, then the rest by size
    v_lines := v_lines || ARRAY['', '*Amount made today*'];
    FOR v_r IN
        WITH m AS (
            SELECT method, final_total AS sales, 0::numeric AS debt FROM _sr_sales WHERE method NOT IN ('Credit', 'Credit_Debt')
            UNION ALL
            SELECT payment_method, 0, amount_paid FROM public.debt_payments
             WHERE business_id = v_s.business_id AND recorded_by = v_name AND created_at BETWEEN v_s.start_time AND p_end
            UNION ALL SELECT 'Cash', 0, 0 UNION ALL SELECT 'M-Pesa', 0, 0
        )
        SELECT method, sum(sales + debt) AS total, sum(debt) AS debt FROM m GROUP BY method
        ORDER BY CASE method WHEN 'Cash' THEN 0 WHEN 'M-Pesa' THEN 1 ELSE 2 END, total DESC
    LOOP
        v_lines := v_lines || ('- ' || CASE WHEN v_r.method = 'M-Pesa' THEN 'Till (M-Pesa)' ELSE v_r.method END || ': ' || fn_ksh(v_r.total)
            || CASE WHEN v_r.debt <> 0 THEN ' (incl. ' || fn_ksh(v_r.debt) || ' debt repaid)' ELSE '' END);
        v_money_total := v_money_total + v_r.total;
        IF v_r.method = 'M-Pesa' THEN v_till := v_r.total; END IF;
    END LOOP;
    v_lines := v_lines || ('- Total: ' || fn_ksh(v_money_total) || CASE WHEN v_credit <> 0 THEN ', plus ' || fn_ksh(v_credit) || ' on credit' ELSE '' END);
    IF v_cash_exp <> 0 THEN v_lines := v_lines || ('- Cash spent: ' || fn_ksh(v_cash_exp)); END IF;
    v_lines := v_lines || ('- Cash to hand over: ' || fn_ksh(v_expected));

    -- Needs attention: uncounted cash and stock running low on things sold
    IF v_expected > 0 THEN v_attention := v_attention || 'Cash in the drawer was not counted'::text; END IF;
    FOR v_r IN
        SELECT DISTINCT p.name, p.stock, p.unit, p.stock <= 0 AS out
        FROM _sr_lines l JOIN public.products p ON p.id = l.product_id
        WHERE p.stock <= 0 OR (p.min_stock > 0 AND p.stock <= p.min_stock)
        ORDER BY out DESC, p.stock
    LOOP
        v_attention := v_attention || CASE WHEN v_r.out THEN v_r.name || ' is out of stock'
                                           ELSE v_r.name || ' is running low (' || fn_qty(v_r.stock, v_r.unit) || ' left)' END;
    END LOOP;
    IF array_length(v_attention, 1) > 0 THEN
        v_lines := v_lines || ARRAY['', '*Needs attention*'];
        FOR i IN 1 .. array_length(v_attention, 1) LOOP v_lines := v_lines || ('- ' || v_attention[i]); END LOOP;
    END IF;

    v_lines := v_lines || ARRAY['', '*Closing balances*'];
    v_lines := v_lines || ('- Cash in drawer: ' || fn_ksh(v_expected) || ' (expected, not counted)');
    IF v_till IS NOT NULL THEN v_lines := v_lines || ('- Till (M-Pesa) received: ' || fn_ksh(v_till)); END IF;
    FOR v_r IN
        SELECT p.name, p.stock, p.unit, sum(l.share) AS earned
        FROM _sr_lines l JOIN public.products p ON p.id = l.product_id
        GROUP BY p.id, p.name, p.stock, p.unit ORDER BY earned DESC
    LOOP
        v_lines := v_lines || ('- ' || v_r.name || ': ' || fn_qty(v_r.stock, v_r.unit) || ' left');
    END LOOP;

    -- Details
    IF v_credit <> 0 THEN
        v_lines := v_lines || ARRAY['', ('*Credit given (' || fn_ksh(v_credit) || ')*')];
        FOR v_r IN
            WITH cs AS (
                SELECT s.id, s.final_total, COALESCE(t.customer_id::text, t.customer_name, 'unknown') AS who,
                       COALESCE(t.customer_name, c.name, 'Unknown customer') AS name, c.debt_balance
                FROM _sr_sales s JOIN public.transactions t ON t.id = s.id LEFT JOIN public.customers c ON c.id = t.customer_id
                WHERE s.method IN ('Credit', 'Credit_Debt')
            )
            SELECT max(cs.name) AS name, sum(cs.final_total) AS amount, max(cs.debt_balance) AS owes,
                   (SELECT string_agg(fn_qty(i.quantity, '') || ' × ' || i.product_name, ', ')
                      FROM public.transaction_items i JOIN cs c2 ON c2.id = i.transaction_id WHERE c2.who = cs.who) AS items
            FROM cs GROUP BY cs.who
        LOOP
            v_lines := v_lines || ('- ' || v_r.name || ': ' || fn_ksh(v_r.amount) || ' (' || COALESCE(v_r.items, '') || ') | now owes ' || fn_ksh(v_r.owes));
        END LOOP;
    END IF;

    IF v_debt_total <> 0 THEN
        v_lines := v_lines || ARRAY['', ('*Debt repaid (' || fn_ksh(v_debt_total) || ')*')];
        FOR v_r IN
            SELECT COALESCE(c.name, 'Unknown customer') AS name, d.amount_paid, d.payment_method, d.remaining_debt
            FROM public.debt_payments d LEFT JOIN public.customers c ON c.id = d.customer_id
            WHERE d.business_id = v_s.business_id AND d.recorded_by = v_name AND d.created_at BETWEEN v_s.start_time AND p_end
            ORDER BY d.created_at
        LOOP
            v_lines := v_lines || ('- ' || v_r.name || ': ' || fn_ksh(v_r.amount_paid) || ' by '
                || CASE WHEN v_r.payment_method = 'M-Pesa' THEN 'Till (M-Pesa)' ELSE v_r.payment_method END
                || ' | still owes ' || fn_ksh(v_r.remaining_debt));
        END LOOP;
    END IF;

    IF v_exp_total <> 0 THEN
        v_lines := v_lines || ARRAY['', ('*Expenses (' || fn_ksh(v_exp_total) || ')*')];
        FOR v_r IN
            SELECT category, amount, COALESCE(payment_method, 'Cash') AS method, description
            FROM public.expenses
            WHERE business_id = v_s.business_id AND deleted_at IS NULL AND COALESCE(created_at, date) BETWEEN v_s.start_time AND p_end
            ORDER BY COALESCE(created_at, date)
        LOOP
            v_lines := v_lines || ('- ' || v_r.category || ': ' || fn_ksh(v_r.amount) || ' ('
                || CASE WHEN v_r.method = 'M-Pesa' THEN 'Till (M-Pesa)' ELSE v_r.method END || ')'
                || CASE WHEN COALESCE(v_r.description, '') <> '' THEN ', ' || v_r.description ELSE '' END);
        END LOOP;
    END IF;

    RETURN array_to_string(v_lines, E'\n');
END;
$$;

CREATE OR REPLACE FUNCTION public.auto_clock_out_long_shifts() RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
AS $$
DECLARE
    v_s record;
    v_end timestamptz;
    v_text text;
    v_n int := 0;
BEGIN
    FOR v_s IN
        SELECT s.id, s.business_id, s.employee_id, s.start_time, e.name, e.user_id
        FROM public.shifts s
        LEFT JOIN public.employees e ON e.id = s.employee_id
        WHERE s.status = 'Active' AND s.end_time IS NULL AND s.deleted_at IS NULL
          AND s.start_time <= now() - interval '15 hours'
        ORDER BY s.start_time
        FOR UPDATE OF s SKIP LOCKED
    LOOP
        v_end := v_s.start_time + interval '15 hours';

        -- Same guard as a normal clock-out: only a still-open shift is closed.
        UPDATE public.shifts SET status = 'Closed', end_time = v_end, last_modified_by = 'auto-clock-out'
         WHERE id = v_s.id AND status = 'Active' AND end_time IS NULL;
        IF NOT FOUND THEN CONTINUE; END IF;
        UPDATE public.employees SET active_shift_id = NULL WHERE id = v_s.employee_id AND active_shift_id = v_s.id;

        v_text := public.fn_shift_report_text(v_s.id, v_end,
            '_Clocked out automatically after 15 hours: ' || COALESCE(v_s.name, 'Staff') || ' did not clock out._');

        INSERT INTO public.notifications (business_id, role, title, message, type, priority, payload, created_by)
        VALUES (v_s.business_id, 'Owner',
                'Shift ended: ' || COALESCE(v_s.name, 'Staff') || ' (automatic)',
                COALESCE(v_s.name, 'Staff') || ' did not clock out, so the shift was closed automatically after 15 hours.',
                'Custom Notification', 'high',
                jsonb_build_object('reportText', v_text, 'employeeName', COALESCE(v_s.name, 'Staff'),
                                   'employeeId', v_s.employee_id, 'closedAt', v_end, 'autoClockOut', true),
                'system');

        -- Tell the person too, so they know why their clock bar is off.
        IF v_s.user_id IS NOT NULL THEN
            INSERT INTO public.notifications (business_id, user_id, title, message, type, priority, payload, created_by)
            VALUES (v_s.business_id, v_s.user_id, 'You were clocked out',
                    'You did not clock out, so your shift was closed automatically after 15 hours. Your report went to the owners.',
                    'Custom Notification', 'medium',
                    jsonb_build_object('reportText', v_text, 'employeeName', COALESCE(v_s.name, 'Staff'), 'autoClockOut', true),
                    'system');
        END IF;
        v_n := v_n + 1;
    END LOOP;
    RETURN v_n;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_shift_report_text(uuid, timestamptz, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.auto_clock_out_long_shifts() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_shift_report_text(uuid, timestamptz, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.auto_clock_out_long_shifts() TO service_role;

DO $do$ BEGIN
    IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
        PERFORM cron.schedule('auto-clock-out', '*/5 * * * *', $job$SELECT public.auto_clock_out_long_shifts()$job$);
    END IF;
END $do$;

-- ===================================================================
-- 20261128001_customer_profile
-- ===================================================================
-- One customer record, the same from the app and the website.
--
-- Every customer has a full name and a phone number (any network, not only M-Pesa). The rest
-- can be added later: email, and a delivery location in parts, like a shop app address book:
-- delivery area (the shop's delivery zones), estate/street, building and house number, a
-- nearby landmark and delivery instructions.
--
-- The customers row is the truth. A website account keeps a copy for its orders; staff edits
-- in the app are copied to it, and the website's own edits write both.

-- Phone numbers: Kenyan numbers in any usual form become +2547…/+2541…; numbers typed with a
-- country code (+256…, 00256…) are kept when they have 9 to 15 digits. NULL when unusable.
CREATE OR REPLACE FUNCTION public.fn_normalize_phone(p_phone TEXT) RETURNS TEXT
    LANGUAGE sql IMMUTABLE
    AS $$
    SELECT CASE
        WHEN d ~ '^254' AND intl THEN public.fn_normalize_ke_phone(d)
        WHEN intl AND d ~ '^[1-9][0-9]{8,14}$' THEN '+' || d
        WHEN intl THEN NULL
        ELSE public.fn_normalize_ke_phone(d)
    END
    FROM (
        SELECT regexp_replace(regexp_replace(trim(COALESCE(p_phone, '')), '^00', '+'), '[^0-9]', '', 'g') AS d,
               regexp_replace(trim(COALESCE(p_phone, '')), '^00', '+') LIKE '+%' AS intl
    ) s;
$$;

REVOKE ALL ON FUNCTION public.fn_normalize_phone(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_normalize_phone(TEXT) TO authenticated, service_role;

-- ── Delivery location on every customer ──────────────────────────────────────
ALTER TABLE public.customers
    ADD COLUMN IF NOT EXISTS delivery_zone_id UUID REFERENCES public.delivery_zones(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS delivery_address TEXT,
    ADD COLUMN IF NOT EXISTS delivery_building TEXT,
    ADD COLUMN IF NOT EXISTS delivery_landmark TEXT,
    ADD COLUMN IF NOT EXISTS delivery_notes TEXT;

ALTER TABLE public.customer_accounts
    ADD COLUMN IF NOT EXISTS delivery_building TEXT,
    ADD COLUMN IF NOT EXISTS delivery_landmark TEXT;

-- ── Clean every customer the same way, whoever saves it ─────────────────────
CREATE OR REPLACE FUNCTION public.fn_customer_standard() RETURNS TRIGGER
    LANGUAGE plpgsql
    AS $$
DECLARE
    v_phone TEXT;
BEGIN
    NEW.name := left(regexp_replace(trim(COALESCE(NEW.name, '')), '\s+', ' ', 'g'), 100);

    IF TG_OP = 'INSERT' OR NEW.phone IS DISTINCT FROM OLD.phone THEN
        v_phone := public.fn_normalize_phone(NEW.phone);
        IF v_phone IS NOT NULL THEN
            NEW.phone := v_phone;
        ELSIF length(regexp_replace(COALESCE(NEW.phone, ''), '[^0-9]', '', 'g')) < 7 THEN
            RAISE EXCEPTION 'Please enter a valid phone number, like 0712 345 678.';
        ELSE
            -- A landline or unusual number from an invoice: kept as typed, never lost.
            NEW.phone := trim(NEW.phone);
        END IF;
    END IF;

    NEW.email := NULLIF(lower(trim(COALESCE(NEW.email, ''))), '');
    IF NEW.email = 'no-email@kaykays.com' THEN
        NEW.email := NULL;
    END IF;

    NEW.delivery_address := left(NULLIF(trim(COALESCE(NEW.delivery_address, '')), ''), 200);
    NEW.delivery_building := left(NULLIF(trim(COALESCE(NEW.delivery_building, '')), ''), 120);
    NEW.delivery_landmark := left(NULLIF(trim(COALESCE(NEW.delivery_landmark, '')), ''), 120);
    NEW.delivery_notes := left(NULLIF(trim(COALESCE(NEW.delivery_notes, '')), ''), 300);

    IF NEW.delivery_zone_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.delivery_zones z WHERE z.id = NEW.delivery_zone_id AND z.business_id = NEW.business_id
    ) THEN
        NEW.delivery_zone_id := NULL;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_customer_standard ON public.customers;
CREATE TRIGGER trg_customer_standard
    BEFORE INSERT OR UPDATE OF name, phone, email, delivery_zone_id, delivery_address, delivery_building, delivery_landmark, delivery_notes
    ON public.customers
    FOR EACH ROW EXECUTE FUNCTION public.fn_customer_standard();

-- Old rows: the placeholder email the app used to save, and phones in mixed forms.
UPDATE public.customers SET email = NULL WHERE email IN ('', 'no-email@kaykays.com');
UPDATE public.customers SET phone = public.fn_normalize_phone(phone)
WHERE public.fn_normalize_phone(phone) IS NOT NULL AND phone <> public.fn_normalize_phone(phone);

-- ── Staff edits reach the website account ───────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_customer_to_account() RETURNS TRIGGER
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
    UPDATE public.customer_accounts a
    SET name = NEW.name,
        phone = NEW.phone,
        delivery_address = NEW.delivery_address,
        delivery_building = NEW.delivery_building,
        delivery_landmark = NEW.delivery_landmark,
        delivery_notes = NEW.delivery_notes,
        delivery_zone_id = COALESCE(NEW.delivery_zone_id, a.delivery_zone_id)
    WHERE a.customer_id = NEW.id
      AND (a.name, a.phone, a.delivery_address, a.delivery_building, a.delivery_landmark, a.delivery_notes, a.delivery_zone_id)
          IS DISTINCT FROM
          (NEW.name, NEW.phone, NEW.delivery_address, NEW.delivery_building, NEW.delivery_landmark, NEW.delivery_notes,
           COALESCE(NEW.delivery_zone_id, a.delivery_zone_id));
    RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_customer_to_account ON public.customers;
CREATE TRIGGER trg_customer_to_account
    AFTER UPDATE OF name, phone, delivery_zone_id, delivery_address, delivery_building, delivery_landmark, delivery_notes
    ON public.customers
    FOR EACH ROW EXECUTE FUNCTION public.fn_customer_to_account();

-- ── Website sign-up: same phone rule as the app ─────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_create_customer_account(p_uid UUID, p_slug TEXT, p_name TEXT, p_phone TEXT) RETURNS UUID
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
    v_uid UUID := p_uid;
    v_business_id UUID;
    v_customer_id UUID;
    v_email TEXT;
    v_name TEXT := left(regexp_replace(trim(COALESCE(p_name, '')), '\s+', ' ', 'g'), 100);
    v_phone TEXT := public.fn_normalize_phone(p_phone);
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'Please sign in first.';
    END IF;
    -- The page and the auth listener can both call this right after sign-up.
    PERFORM pg_advisory_xact_lock(hashtextextended(v_uid::TEXT, 0));
    IF EXISTS (SELECT 1 FROM public.customer_accounts WHERE id = v_uid) THEN
        RETURN v_uid;
    END IF;
    IF v_name = '' THEN
        RAISE EXCEPTION 'Please enter your full name.';
    END IF;
    IF v_phone IS NULL THEN
        RAISE EXCEPTION 'Please enter a valid phone number, like 0712 345 678.';
    END IF;

    SELECT id INTO v_business_id
    FROM public.businesses
    WHERE website_slug = p_slug AND deleted_at IS NULL;
    IF v_business_id IS NULL THEN
        RAISE EXCEPTION 'This shop is not available.';
    END IF;

    SELECT email INTO v_email FROM auth.users WHERE id = v_uid;

    INSERT INTO public.customers (business_id, name, phone, email, description, last_modified_by)
    VALUES (v_business_id, v_name, v_phone, v_email, 'Website account', 'website')
    RETURNING id, name, phone INTO v_customer_id, v_name, v_phone;

    INSERT INTO public.customer_accounts (id, business_id, customer_id, name, phone, email)
    VALUES (v_uid, v_business_id, v_customer_id, v_name, v_phone, v_email);

    RETURN v_uid;
END;
$$;

-- ── Website profile: name, phone and the whole delivery location ────────────
CREATE OR REPLACE FUNCTION public.update_my_profile(
    p_name TEXT, p_phone TEXT, p_address TEXT, p_building TEXT, p_landmark TEXT, p_notes TEXT, p_zone_id UUID DEFAULT NULL
) RETURNS VOID
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
    v_name TEXT := left(regexp_replace(trim(COALESCE(p_name, '')), '\s+', ' ', 'g'), 100);
    v_phone TEXT := public.fn_normalize_phone(p_phone);
    v_account public.customer_accounts%ROWTYPE;
    v_zone UUID;
BEGIN
    IF v_name = '' THEN
        RAISE EXCEPTION 'Please enter your full name.';
    END IF;
    IF v_phone IS NULL THEN
        RAISE EXCEPTION 'Please enter a valid phone number, like 0712 345 678.';
    END IF;

    SELECT * INTO v_account FROM public.customer_accounts WHERE id = auth.uid() FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Please finish setting up your account first.';
    END IF;

    SELECT z.id INTO v_zone FROM public.delivery_zones z
    WHERE z.id = p_zone_id AND z.business_id = v_account.business_id AND z.active;

    UPDATE public.customer_accounts
    SET name = v_name,
        phone = v_phone,
        delivery_address = left(NULLIF(trim(COALESCE(p_address, '')), ''), 200),
        delivery_building = left(NULLIF(trim(COALESCE(p_building, '')), ''), 120),
        delivery_landmark = left(NULLIF(trim(COALESCE(p_landmark, '')), ''), 120),
        delivery_notes = left(NULLIF(trim(COALESCE(p_notes, '')), ''), 300),
        delivery_zone_id = COALESCE(v_zone, delivery_zone_id)
    WHERE id = v_account.id;

    UPDATE public.customers
    SET name = v_name,
        phone = v_phone,
        delivery_address = p_address,
        delivery_building = p_building,
        delivery_landmark = p_landmark,
        delivery_notes = p_notes,
        delivery_zone_id = COALESCE(v_zone, delivery_zone_id)
    WHERE id = v_account.customer_id;
END;
$$;

REVOKE ALL ON FUNCTION public.update_my_profile(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_my_profile(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, UUID) TO authenticated;

-- The older four-field version, kept for website pages already open in a browser.
CREATE OR REPLACE FUNCTION public.update_my_account(p_name TEXT, p_phone TEXT, p_address TEXT, p_notes TEXT) RETURNS VOID
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
    v_account public.customer_accounts%ROWTYPE;
BEGIN
    SELECT * INTO v_account FROM public.customer_accounts WHERE id = auth.uid();
    PERFORM public.update_my_profile(p_name, p_phone, p_address, v_account.delivery_building,
                                     v_account.delivery_landmark, p_notes, NULL);
END;
$$;

-- Accounts made before this: their saved location goes onto the customer too.
UPDATE public.customers c
SET delivery_address = COALESCE(c.delivery_address, a.delivery_address),
    delivery_notes = COALESCE(c.delivery_notes, a.delivery_notes),
    delivery_zone_id = COALESCE(c.delivery_zone_id, a.delivery_zone_id)
FROM public.customer_accounts a
WHERE a.customer_id = c.id
  AND (a.delivery_address IS NOT NULL OR a.delivery_notes IS NOT NULL OR a.delivery_zone_id IS NOT NULL);

-- ===================================================================
-- 20261128002_signed_out_sessions_denied
-- ===================================================================
-- Signing out must end access everywhere, at once.
--
-- Supabase access tokens are self-contained: after sign-out the token kept
-- working against the database until it expired (up to jwt_expiry = 1 hour).
-- Sign-out deletes the row in auth.sessions, so every request from a signed-in
-- role now checks that its session row still exists.
--
--   * API (tables + RPC): PostgREST runs public.check_request_session() before
--     every request; a dead session gets HTTP 401 {"code":"session_revoked"}.
--   * File storage: a restrictive policy on storage.objects.
--   * Edge functions already use auth.getUser(), which refuses dead sessions.

CREATE OR REPLACE FUNCTION public.session_is_live()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT CASE
    -- Only signed-in users have a session to check (anon / service_role pass).
    WHEN coalesce(auth.jwt() ->> 'role', '') <> 'authenticated' THEN true
    -- Every token the Auth server issues carries its session id.
    WHEN coalesce(auth.jwt() ->> 'session_id', '') = '' THEN false
    ELSE EXISTS (
      SELECT 1
      FROM auth.sessions s
      WHERE s.id::text = auth.jwt() ->> 'session_id'
        AND (s.not_after IS NULL OR s.not_after > now())
    )
  END;
$$;

REVOKE ALL ON FUNCTION public.session_is_live() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.session_is_live() TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.check_request_session()
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT public.session_is_live() THEN
    RAISE SQLSTATE 'PGRST' USING
      message = json_build_object(
        'code', 'session_revoked',
        'message', 'You are signed out. Please sign in again.'
      )::text,
      detail = json_build_object(
        'status', 401,
        'headers', json_build_object('WWW-Authenticate', 'Bearer error="invalid_token"')
      )::text;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.check_request_session() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.check_request_session() TO anon, authenticated, service_role;

ALTER ROLE authenticator SET pgrst.db_pre_request = 'public.check_request_session';
NOTIFY pgrst, 'reload config';

-- File storage: a dead session can't read, upload, change or delete files.
DROP POLICY IF EXISTS "signed-in session must be live" ON storage.objects;
CREATE POLICY "signed-in session must be live" ON storage.objects
  AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT public.session_is_live()))
  WITH CHECK ((SELECT public.session_is_live()));

-- ===================================================================
-- 20261128003_only_creator_creates_business
-- ===================================================================
-- Only the person who set up the system can create businesses.
--
-- The system creator is whoever holds the first Owner membership ever made
-- (the first person to register and set up a business). Everyone else joins
-- by invitation and can never create a business or become an Owner.
--
-- Closes three gaps:
--   * create_business_with_owner allowed any Owner (an invite as Owner made one).
--   * Any signed-in user could insert a row into businesses directly.
--   * Owners/Admins could invite someone as Owner, or write an Owner membership.

CREATE OR REPLACE FUNCTION public.is_system_creator(p_auth_user_id uuid DEFAULT auth.uid())
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.users u
    WHERE u.auth_user_id = p_auth_user_id
      AND u.id = (
        SELECT bm.user_id
        FROM public.business_memberships bm
        WHERE bm.role = 'Owner'
        ORDER BY bm.created_at, bm.id
        LIMIT 1
      )
  );
$$;

REVOKE ALL ON FUNCTION public.is_system_creator(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_system_creator(uuid) TO authenticated, service_role;

-- True only for a verified account that is setting the system up for the first
-- time, or for the system creator.
CREATE OR REPLACE FUNCTION public.can_create_business()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT auth.uid() IS NOT NULL
     AND public.account_email_verified(auth.uid())
     AND (
       NOT EXISTS (SELECT 1 FROM public.business_memberships WHERE role = 'Owner')
       OR public.is_system_creator(auth.uid())
     );
$$;

REVOKE ALL ON FUNCTION public.can_create_business() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_create_business() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.create_business_with_owner(
  p_name text, p_type text, p_country text, p_currency text,
  p_logo_url text, p_description text, p_address text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
    v_business_id UUID;
    v_user_id     UUID;
BEGIN
    IF NOT public.account_email_verified(auth.uid()) THEN
        RAISE EXCEPTION 'Please verify your email before creating a business.' USING ERRCODE = '42501';
    END IF;
    -- Serialise first-time setup so two people can't both become the creator.
    PERFORM pg_advisory_xact_lock(hashtext('create_business_with_owner'));
    IF NOT public.can_create_business() THEN
        RAISE EXCEPTION 'Only the person who set up this system can create a business. Ask them to invite you.' USING ERRCODE = '42501';
    END IF;

    SELECT id INTO v_user_id
    FROM public.users
    WHERE auth_user_id = auth.uid();

    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'User profile not found. Please complete signup first.';
    END IF;

    INSERT INTO public.businesses
        (name, business_type, country, currency, logo_url, description, address)
    VALUES
        (p_name, p_type, p_country, p_currency, p_logo_url, p_description, p_address)
    RETURNING id INTO v_business_id;

    INSERT INTO public.branches (business_id, name, address)
    VALUES (v_business_id, 'Main branch', p_address);

    INSERT INTO public.business_memberships (business_id, user_id, role, status)
    VALUES (v_business_id, v_user_id, 'Owner', 'Active');

    INSERT INTO public.employees
        (id, business_id, user_id, name, role, email, phone, pin, assigned_branches)
    SELECT
        v_user_id, v_business_id, v_user_id,
        name, 'Owner', email, phone, '0000',
        jsonb_build_array(v_business_id::TEXT)
    FROM public.users
    WHERE id = v_user_id
    ON CONFLICT (id) DO UPDATE SET
        business_id = v_business_id,
        role        = 'Owner';

    RETURN v_business_id;
END;
$$;

-- Businesses are only made through create_business_with_owner.
DROP POLICY IF EXISTS "pol_businesses_insert" ON public.businesses;
CREATE POLICY "pol_businesses_insert" ON public.businesses
  FOR INSERT WITH CHECK ((SELECT public.can_create_business()));

-- Nobody is invited as Owner.
CREATE OR REPLACE FUNCTION public.fn_invitation_not_owner()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.role = 'Owner' THEN
    RAISE EXCEPTION 'Nobody can be invited as Owner.' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_invitation_not_owner ON public.invitations;
CREATE TRIGGER trg_invitation_not_owner
  BEFORE INSERT OR UPDATE OF role ON public.invitations
  FOR EACH ROW EXECUTE FUNCTION public.fn_invitation_not_owner();

-- The app can't make anyone an Owner; only create_business_with_owner does
-- (it runs as the function owner, not as the signed-in user).
CREATE OR REPLACE FUNCTION public.fn_membership_owner_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF current_user IN ('authenticated', 'anon')
     AND NEW.role = 'Owner'
     AND (TG_OP = 'INSERT' OR OLD.role IS DISTINCT FROM 'Owner') THEN
    RAISE EXCEPTION 'Nobody can be made an Owner.' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_membership_owner_guard ON public.business_memberships;
CREATE TRIGGER trg_membership_owner_guard
  BEFORE INSERT OR UPDATE OF role ON public.business_memberships
  FOR EACH ROW EXECUTE FUNCTION public.fn_membership_owner_guard();

NOTIFY pgrst, 'reload schema';

-- ===================================================================
-- 20261129001_revoke_invitation
-- ===================================================================
-- Revoking a staff invitation removes it for good, together with the sign-up
-- the invited person made for it.
--
-- Before: the app deleted the row straight from the table. Only Owners/Admins
-- pass the table's write policy, so for anyone else (with staff.invite) the
-- delete matched nothing and the invitation stayed. And an invited person who
-- had already signed up kept their account, so the email could not be invited
-- again ("A registered user with this email address already exists").
--
-- Now: revoke_invitation() deletes the invitation and any account registered
-- for it (claimed it, or signed up with its email) that has nothing else in
-- the system: no membership in any business, no supplier or website customer
-- account, no other pending invitation, and is not the system creator.
-- Accounts that do have something else are left alone.

CREATE OR REPLACE FUNCTION public.revoke_invitation(p_invitation_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_inv      public.invitations%ROWTYPE;
    v_email    TEXT;
    v_auth_id  UUID;
    v_user_id  UUID;
    v_removed  INTEGER := 0;
BEGIN
    SELECT * INTO v_inv FROM public.invitations WHERE id = p_invitation_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'That invitation was not found.' USING ERRCODE = 'P0002';
    END IF;

    IF NOT (public.is_owner_or_admin(v_inv.business_id)
            OR public.has_permission(v_inv.business_id, 'staff.invite')) THEN
        RAISE EXCEPTION 'You are not allowed to remove invitations.' USING ERRCODE = '42501';
    END IF;

    v_email := LOWER(TRIM(COALESCE(v_inv.email, '')));

    DELETE FROM public.invitations WHERE id = v_inv.id;

    -- Accepted invitations belong to a real member; only the record goes.
    IF v_inv.status = 'Accepted' THEN
        RETURN jsonb_build_object('removed_accounts', 0);
    END IF;

    FOR v_auth_id IN
        SELECT a.id FROM auth.users a
        WHERE a.id = v_inv.claimed_by
           OR (v_email <> '' AND LOWER(TRIM(a.email)) = v_email)
    LOOP
        SELECT u.id INTO v_user_id FROM public.users u WHERE u.auth_user_id = v_auth_id;

        CONTINUE WHEN public.is_system_creator(v_auth_id);
        CONTINUE WHEN v_user_id IS NOT NULL AND EXISTS (
            SELECT 1 FROM public.business_memberships bm WHERE bm.user_id = v_user_id);
        CONTINUE WHEN v_user_id IS NOT NULL AND EXISTS (
            SELECT 1 FROM public.supplier_accounts sa WHERE sa.user_id = v_user_id);
        CONTINUE WHEN EXISTS (SELECT 1 FROM public.customer_accounts ca WHERE ca.id = v_auth_id);
        CONTINUE WHEN EXISTS (
            SELECT 1 FROM public.invitations i
            WHERE i.status = 'Pending'
              AND (i.claimed_by = v_auth_id
                   OR (v_email <> '' AND LOWER(TRIM(i.email)) = v_email)));

        IF v_user_id IS NOT NULL THEN
            -- trg_on_public_user_deleted removes the auth.users row too.
            DELETE FROM public.users WHERE id = v_user_id;
        END IF;
        DELETE FROM auth.users WHERE id = v_auth_id;
        v_removed := v_removed + 1;
    END LOOP;

    -- Sign-up codes sent to that email are no longer needed.
    IF v_email <> '' AND v_removed > 0 THEN
        DELETE FROM public.otps WHERE LOWER(TRIM(email)) = v_email;
    END IF;

    RETURN jsonb_build_object('removed_accounts', v_removed);
END;
$$;

ALTER FUNCTION public.revoke_invitation(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.revoke_invitation(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.revoke_invitation(uuid) TO authenticated, service_role;

-- ===================================================================
-- 20261130001_delivery_trips
-- ===================================================================
-- Delivery trips: several deliveries to one place, done in one round, paid to the rider once.
--
-- Example: three customers on the same estate each pay KSh 200 delivery (KSh 600), but the
-- rider goes once, so the rider earns KSh 200 for the trip, not 600. Grouping is optional:
-- a delivery not in a trip is paid as before (its own rider_pay).
--
-- Rules:
-- - Owners, admins and anyone with deliveries.assign make and undo trips.
-- - A trip has two or more deliveries, all with the same rider or all still open (no rider).
--   A rider who accepts one delivery of an open trip gets the whole trip; giving it back
--   gives back the whole trip.
-- - Deliveries where the customer pays the rider in cash ('rider_collects') can't join a trip:
--   the rider is paid by the customer there, not by the shop.
-- - What the customer pays (delivery_fee) never changes. Only what the rider is owed does.
--   transactions.rider_pay keeps the single-delivery figure; fn_delivery_rows returns each
--   trip member's share of the trip pay (the first member takes any rounding cents), so
--   adding up rider_pay over a rider's deliveries gives the right total.

CREATE TABLE IF NOT EXISTS public.delivery_trips (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    rider_pay numeric(14,2) NOT NULL CHECK (rider_pay >= 0),
    label text,
    created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
    created_by_name text,
    created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.delivery_trips OWNER TO postgres;
CREATE INDEX IF NOT EXISTS idx_delivery_trips_business ON public.delivery_trips (business_id, created_at DESC);
ALTER TABLE public.delivery_trips ENABLE ROW LEVEL SECURITY;
-- Read through the RPCs below; no direct table access.
REVOKE ALL ON TABLE public.delivery_trips FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.delivery_trips TO service_role;

ALTER TABLE public.transactions  ADD COLUMN IF NOT EXISTS trip_id uuid REFERENCES public.delivery_trips(id) ON DELETE SET NULL;
ALTER TABLE public.online_orders ADD COLUMN IF NOT EXISTS trip_id uuid REFERENCES public.delivery_trips(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_transactions_trip ON public.transactions (trip_id) WHERE trip_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_online_orders_trip ON public.online_orders (trip_id) WHERE trip_id IS NOT NULL;

COMMENT ON COLUMN public.transactions.trip_id IS
    'Delivery trip this sale was grouped into; the rider is paid the trip''s rider_pay once for all of them.';

-- ---------------------------------------------------------------- rows riders and staff see
DROP FUNCTION IF EXISTS public.fn_delivery_rows(uuid);

CREATE FUNCTION public.fn_delivery_rows(p_business_id uuid)
RETURNS TABLE(source text, id uuid, reference text, customer_name text, customer_phone text, address text, area text,
              notes text, amount numeric, delivery_fee numeric, status text, assigned_at timestamptz,
              delivered_at timestamptz, created_at timestamptz, items text, payment text, balance_due numeric,
              rider_id uuid, is_open boolean, delivery_mode text, rider_pay numeric,
              trip_id uuid, trip_pay numeric, trip_size integer, own_pay numeric)
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
               -- Website orders: paid online with the fee; the shop pays the rider.
               'charged'::text AS delivery_mode, o.delivery_fee AS own_pay, o.trip_id
        FROM public.online_orders o
        WHERE o.business_id = p_business_id AND o.fulfilment = 'delivery'
          AND (o.rider_id IS NOT NULL OR o.status IN ('paid', 'preparing'))
        UNION ALL
        SELECT 'sale', t.id, 'Till sale', COALESCE(c.name, t.customer_name, 'Walk-in customer'), c.phone,
               -- The till saves the location as "Deliver to: <place>." at the start of the note.
               NULLIF(trim(substring(t.note FROM '^Deliver to: ([^.]*)')), ''), NULL,
               NULLIF(trim(regexp_replace(COALESCE(t.note, ''), '^Deliver to: [^.]*\.?\s*', '')), ''),
               t.final_total, t.delivery_fee,
               COALESCE(t.delivery_status, 'assigned'),
               t.timestamp, t.delivered_at, t.timestamp,
               (SELECT string_agg(i.quantity::FLOAT8 || ' ' || i.product_name, ', ')
                FROM public.transaction_items i WHERE i.transaction_id = t.id),
               t.payment_method::text,
               GREATEST(t.final_total - t.amount_paid - t.wallet_applied, 0),
               t.rider_id,
               t.rider_id IS NULL,
               t.delivery_mode, t.rider_pay, t.trip_id
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
           m.trip_id, m.trip_pay, CASE WHEN m.trip_id IS NULL THEN NULL ELSE m.n END, m.own_pay
    FROM m;
$$;
ALTER FUNCTION public.fn_delivery_rows(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.fn_delivery_rows(uuid) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------- staff: recent deliveries to group
-- Everything from the last 7 days that a rider has, or that waits for one, with the rider's
-- name. Failed ones are left out: there is nothing to pay for them.
CREATE OR REPLACE FUNCTION public.get_delivery_board(p_business_id uuid) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
AS $$
BEGIN
    PERFORM public.assert_permission(p_business_id, 'deliveries.assign');
    RETURN COALESCE((
        SELECT jsonb_agg((to_jsonb(d) - 'is_open') || jsonb_build_object('rider_name', e.name) ORDER BY d.created_at DESC)
        FROM public.fn_delivery_rows(p_business_id) d
        LEFT JOIN public.employees e ON e.id = d.rider_id
        WHERE d.status <> 'failed' AND d.created_at > NOW() - INTERVAL '7 days'
    ), '[]'::jsonb);
END;
$$;
ALTER FUNCTION public.get_delivery_board(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_delivery_board(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_delivery_board(uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------- make / undo a trip
CREATE OR REPLACE FUNCTION public.group_deliveries(p_business_id uuid, p_items jsonb, p_rider_pay numeric, p_label text DEFAULT NULL)
RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
AS $$
DECLARE
    v_trip uuid;
    v_item jsonb;
    v_rows int := 0;
    v_riders int;
    v_user uuid;
    v_name text;
BEGIN
    PERFORM public.assert_permission(p_business_id, 'deliveries.assign');
    IF jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) < 2 THEN
        RAISE EXCEPTION 'Pick at least two deliveries for one trip.';
    END IF;
    IF p_rider_pay IS NULL OR p_rider_pay < 0 THEN
        RAISE EXCEPTION 'Enter what the rider gets for the trip.';
    END IF;

    CREATE TEMP TABLE IF NOT EXISTS _trip_pick (source text, id uuid) ON COMMIT DROP;
    TRUNCATE _trip_pick;
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
        INSERT INTO _trip_pick VALUES (v_item->>'source', (v_item->>'id')::uuid);
    END LOOP;

    -- Lock the rows and check each one.
    PERFORM 1 FROM public.transactions t JOIN _trip_pick p ON p.source = 'sale' AND p.id = t.id FOR UPDATE OF t;
    PERFORM 1 FROM public.online_orders o JOIN _trip_pick p ON p.source = 'online' AND p.id = o.id FOR UPDATE OF o;

    IF EXISTS (
        SELECT 1 FROM _trip_pick p
        WHERE NOT EXISTS (SELECT 1 FROM public.fn_delivery_rows(p_business_id) d WHERE d.source = p.source AND d.id = p.id)
    ) THEN
        RAISE EXCEPTION 'One of those deliveries was not found. Refresh and try again.';
    END IF;

    IF EXISTS (SELECT 1 FROM public.fn_delivery_rows(p_business_id) d JOIN _trip_pick p ON p.source = d.source AND p.id = d.id
               WHERE d.status = 'failed') THEN
        RAISE EXCEPTION 'A delivery that was not delivered can''t join a trip.';
    END IF;
    IF EXISTS (SELECT 1 FROM public.fn_delivery_rows(p_business_id) d JOIN _trip_pick p ON p.source = d.source AND p.id = d.id
               WHERE d.delivery_mode = 'rider_collects') THEN
        RAISE EXCEPTION 'A delivery the customer pays the rider for can''t join a trip.';
    END IF;
    IF EXISTS (SELECT 1 FROM public.fn_delivery_rows(p_business_id) d JOIN _trip_pick p ON p.source = d.source AND p.id = d.id
               WHERE d.trip_id IS NOT NULL) THEN
        RAISE EXCEPTION 'One of those deliveries is already in a trip. Undo that trip first.';
    END IF;
    SELECT count(DISTINCT COALESCE(d.rider_id::text, '-')) INTO v_riders
      FROM public.fn_delivery_rows(p_business_id) d JOIN _trip_pick p ON p.source = d.source AND p.id = d.id;
    IF v_riders > 1 THEN
        RAISE EXCEPTION 'A trip is one rider''s round. Pick deliveries of the same rider, or ones still waiting for a rider.';
    END IF;

    SELECT u.id, u.name INTO v_user, v_name FROM public.users u WHERE u.auth_user_id = auth.uid();
    INSERT INTO public.delivery_trips (business_id, rider_pay, label, created_by, created_by_name)
    VALUES (p_business_id, round(p_rider_pay, 2), NULLIF(trim(COALESCE(p_label, '')), ''), v_user, v_name)
    RETURNING id INTO v_trip;

    UPDATE public.transactions t SET trip_id = v_trip
      FROM _trip_pick p WHERE p.source = 'sale' AND p.id = t.id AND t.business_id = p_business_id;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    UPDATE public.online_orders o SET trip_id = v_trip
      FROM _trip_pick p WHERE p.source = 'online' AND p.id = o.id AND o.business_id = p_business_id;
    RETURN v_trip;
END;
$$;
ALTER FUNCTION public.group_deliveries(uuid, jsonb, numeric, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.group_deliveries(uuid, jsonb, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.group_deliveries(uuid, jsonb, numeric, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.ungroup_delivery_trip(p_trip_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
AS $$
DECLARE
    v_business uuid;
BEGIN
    SELECT business_id INTO v_business FROM public.delivery_trips WHERE id = p_trip_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'That trip was not found.';
    END IF;
    PERFORM public.assert_permission(v_business, 'deliveries.assign');
    UPDATE public.transactions SET trip_id = NULL WHERE trip_id = p_trip_id;
    UPDATE public.online_orders SET trip_id = NULL WHERE trip_id = p_trip_id;
    DELETE FROM public.delivery_trips WHERE id = p_trip_id;
END;
$$;
ALTER FUNCTION public.ungroup_delivery_trip(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.ungroup_delivery_trip(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ungroup_delivery_trip(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.set_delivery_trip_pay(p_trip_id uuid, p_rider_pay numeric) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
AS $$
DECLARE
    v_business uuid;
BEGIN
    SELECT business_id INTO v_business FROM public.delivery_trips WHERE id = p_trip_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'That trip was not found.';
    END IF;
    PERFORM public.assert_permission(v_business, 'deliveries.assign');
    IF p_rider_pay IS NULL OR p_rider_pay < 0 THEN
        RAISE EXCEPTION 'Enter what the rider gets for the trip.';
    END IF;
    UPDATE public.delivery_trips SET rider_pay = round(p_rider_pay, 2) WHERE id = p_trip_id;
END;
$$;
ALTER FUNCTION public.set_delivery_trip_pay(uuid, numeric) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.set_delivery_trip_pay(uuid, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_delivery_trip_pay(uuid, numeric) TO authenticated, service_role;

-- ---------------------------------------------------------------- accepting / giving back a whole trip
-- The single-delivery logic stays in the old functions, renamed; the public ones add the trip.
ALTER FUNCTION public.rider_accept_delivery(text, uuid) RENAME TO fn_rider_accept_one;
ALTER FUNCTION public.rider_release_delivery(text, uuid) RENAME TO fn_rider_release_one;
ALTER FUNCTION public.rider_update_delivery(text, uuid, text) RENAME TO fn_rider_update_one;
REVOKE ALL ON FUNCTION public.fn_rider_accept_one(text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_rider_release_one(text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_rider_update_one(text, uuid, text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.fn_delivery_trip_of(p_source text, p_id uuid) RETURNS uuid
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
AS $$
    SELECT CASE WHEN p_source = 'online' THEN (SELECT trip_id FROM public.online_orders WHERE id = p_id)
                WHEN p_source = 'sale' THEN (SELECT trip_id FROM public.transactions WHERE id = p_id) END;
$$;
ALTER FUNCTION public.fn_delivery_trip_of(text, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.fn_delivery_trip_of(text, uuid) FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.rider_accept_delivery(p_source text, p_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
AS $$
DECLARE
    v_trip uuid;
    v_r record;
BEGIN
    PERFORM public.fn_rider_accept_one(p_source, p_id);
    v_trip := public.fn_delivery_trip_of(p_source, p_id);
    IF v_trip IS NULL THEN RETURN; END IF;
    -- The rest of the trip comes along. One that can't (cancelled meanwhile) is skipped.
    FOR v_r IN
        SELECT 'sale' AS source, id FROM public.transactions WHERE trip_id = v_trip AND deleted_at IS NULL AND NOT (id = p_id AND p_source = 'sale')
        UNION ALL
        SELECT 'online', id FROM public.online_orders WHERE trip_id = v_trip AND NOT (id = p_id AND p_source = 'online')
    LOOP
        BEGIN
            PERFORM public.fn_rider_accept_one(v_r.source, v_r.id);
        EXCEPTION WHEN OTHERS THEN
            NULL;
        END;
    END LOOP;
END;
$$;
ALTER FUNCTION public.rider_accept_delivery(text, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.rider_accept_delivery(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rider_accept_delivery(text, uuid) TO authenticated, service_role;

CREATE FUNCTION public.rider_release_delivery(p_source text, p_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
AS $$
DECLARE
    v_trip uuid;
    v_r record;
BEGIN
    PERFORM public.fn_rider_release_one(p_source, p_id);
    v_trip := public.fn_delivery_trip_of(p_source, p_id);
    IF v_trip IS NULL THEN RETURN; END IF;
    -- Giving back one gives back the trip; ones already started stay with the rider.
    FOR v_r IN
        SELECT 'sale' AS source, id FROM public.transactions WHERE trip_id = v_trip AND deleted_at IS NULL AND rider_id IS NOT NULL AND NOT (id = p_id AND p_source = 'sale')
        UNION ALL
        SELECT 'online', id FROM public.online_orders WHERE trip_id = v_trip AND rider_id IS NOT NULL AND NOT (id = p_id AND p_source = 'online')
    LOOP
        BEGIN
            PERFORM public.fn_rider_release_one(v_r.source, v_r.id);
        EXCEPTION WHEN OTHERS THEN
            NULL;
        END;
    END LOOP;
END;
$$;
ALTER FUNCTION public.rider_release_delivery(text, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.rider_release_delivery(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rider_release_delivery(text, uuid) TO authenticated, service_role;

CREATE FUNCTION public.rider_update_delivery(p_source text, p_id uuid, p_status text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
AS $$
BEGIN
    PERFORM public.fn_rider_update_one(p_source, p_id, p_status);
    -- Not delivered: it leaves its trip, so the rest of the trip keeps the whole trip pay.
    IF p_status = 'failed' THEN
        IF p_source = 'sale' THEN
            UPDATE public.transactions SET trip_id = NULL WHERE id = p_id AND trip_id IS NOT NULL;
        ELSE
            UPDATE public.online_orders SET trip_id = NULL WHERE id = p_id AND trip_id IS NOT NULL;
        END IF;
    END IF;
END;
$$;
ALTER FUNCTION public.rider_update_delivery(text, uuid, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.rider_update_delivery(text, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rider_update_delivery(text, uuid, text) TO authenticated, service_role;

-- ---------------------------------------------------------------- grouping is not a sale edit
CREATE OR REPLACE FUNCTION public.fn_audit_sale_change() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
    -- Bookkeeping and the rider's delivery progress are not edits.
    v_ignore   TEXT[] := ARRAY['updated_at', 'created_at', 'version', 'sync_status', 'last_modified_by', 'status'];
    v_delivery TEXT[] := ARRAY['rider_id', 'rider_name', 'delivery_status', 'delivered_at', 'trip_id'];
    v_old      JSONB := to_jsonb(OLD);
    v_new      JSONB := CASE WHEN TG_OP = 'UPDATE' THEN to_jsonb(NEW) ELSE '{}'::JSONB END;
    v_changes  JSONB := '{}'::JSONB;
    v_key      TEXT;
    v_action   TEXT;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM public.businesses b WHERE b.id = OLD.business_id) THEN
        RETURN NULL;
    END IF;
    IF TG_OP = 'UPDATE' THEN
        FOR v_key IN SELECT jsonb_object_keys(v_new) LOOP
            CONTINUE WHEN v_key = ANY(v_ignore);
            IF (v_old -> v_key) IS DISTINCT FROM (v_new -> v_key) THEN
                v_changes := v_changes || jsonb_build_object(v_key, jsonb_build_object('from', v_old -> v_key, 'to', v_new -> v_key));
            END IF;
        END LOOP;
        -- Nothing changed, or only a rider taking / moving the delivery along.
        IF v_changes = '{}'::JSONB
           OR NOT EXISTS (SELECT 1 FROM jsonb_object_keys(v_changes) k WHERE k <> ALL(v_delivery)) THEN
            RETURN NULL;
        END IF;
    END IF;

    v_action := CASE
        WHEN TG_OP = 'DELETE' THEN 'DELETE'
        WHEN v_changes ? 'deleted_at' AND (v_new ->> 'deleted_at') IS NOT NULL THEN 'DELETE'
        WHEN v_changes ? 'deleted_at' THEN 'RESTORE'
        ELSE 'UPDATE'
    END;

    INSERT INTO public.audit_logs (business_id, user_id, action, table_name, record_id, details)
    VALUES (
        OLD.business_id,
        (SELECT u.id FROM public.users u WHERE u.id = auth.uid() OR u.auth_user_id = auth.uid() LIMIT 1),
        v_action,
        'transactions',
        OLD.id::TEXT,
        jsonb_build_object('label', 'Sale ' || public.fn_receipt_number(OLD.id), 'by', public.fn_audit_actor_name())
            || CASE WHEN TG_OP = 'UPDATE' THEN jsonb_build_object('changes', v_changes) ELSE '{}'::JSONB END
    );
    RETURN NULL;
END;
$$;
ALTER FUNCTION public.fn_audit_sale_change() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.fn_audit_sale_change() FROM PUBLIC;

-- ===================================================================
-- 20261130002_still_on_shift_check
-- ===================================================================
-- "Still working?" before the 15-hour auto clock-out.
--
-- At 15 hours on shift the person is asked (notification + a question on their screen).
-- "Still working" keeps the shift open and asks again 2 hours later. No answer within
-- 3 minutes: the shift is closed and marked as closed automatically, the owners get the shift
-- report and the person is told. The shift ends when the question became due (15 h after
-- clock-in, or 2 h after the last "still working"), not when the 3 minutes ran out, so time
-- nobody vouched for is not counted.
--
-- Replaces auto_clock_out_long_shifts() from 20261127001 and runs it every minute.

ALTER TABLE public.shifts
    ADD COLUMN IF NOT EXISTS still_on_asked_at timestamptz,
    ADD COLUMN IF NOT EXISTS still_on_confirmed_at timestamptz,
    ADD COLUMN IF NOT EXISTS closed_automatically boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.shifts.still_on_asked_at IS 'When "Still working?" was asked and not yet answered; cleared by confirm_still_on_shift.';
COMMENT ON COLUMN public.shifts.still_on_confirmed_at IS 'Last time the person answered "Still working"; the next question is due 2 hours later.';
COMMENT ON COLUMN public.shifts.closed_automatically IS 'The shift was closed by the database because nobody answered "Still working?".';

UPDATE public.shifts SET closed_automatically = true
 WHERE last_modified_by = 'auto-clock-out' AND NOT closed_automatically;

-- When the next "Still working?" is due for an open shift.
CREATE OR REPLACE FUNCTION public.fn_still_on_due(p_start timestamptz, p_confirmed timestamptz) RETURNS timestamptz
    LANGUAGE sql IMMUTABLE AS $$
    SELECT COALESCE(p_confirmed + interval '2 hours', p_start + interval '15 hours');
$$;

CREATE OR REPLACE FUNCTION public.confirm_still_on_shift(p_shift_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
AS $$
DECLARE
    v_s public.shifts;
BEGIN
    SELECT * INTO v_s FROM public.shifts WHERE id = p_shift_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'That shift was not found.';
    END IF;
    IF NOT (public.is_my_employee(v_s.employee_id) OR public.has_permission(v_s.business_id, 'staff.update')) THEN
        RAISE EXCEPTION 'This is not your shift.' USING ERRCODE = '42501';
    END IF;
    IF v_s.status <> 'Active' OR v_s.end_time IS NOT NULL THEN
        RAISE EXCEPTION 'This shift has already ended. Clock in again to start a new one.';
    END IF;
    UPDATE public.shifts SET still_on_asked_at = NULL, still_on_confirmed_at = now() WHERE id = p_shift_id;
END;
$$;
ALTER FUNCTION public.confirm_still_on_shift(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.confirm_still_on_shift(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.confirm_still_on_shift(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.auto_clock_out_long_shifts() RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
AS $$
DECLARE
    v_s record;
    v_end timestamptz;
    v_hours text;
    v_text text;
    v_n int := 0;
BEGIN
    -- 1. No answer within 3 minutes: close the shift.
    FOR v_s IN
        SELECT s.id, s.business_id, s.employee_id, s.start_time, s.still_on_asked_at, s.still_on_confirmed_at, e.name, e.user_id
        FROM public.shifts s
        LEFT JOIN public.employees e ON e.id = s.employee_id
        WHERE s.status = 'Active' AND s.end_time IS NULL AND s.deleted_at IS NULL
          AND s.still_on_asked_at <= now() - interval '3 minutes'
        ORDER BY s.start_time
        FOR UPDATE OF s SKIP LOCKED
    LOOP
        v_end := LEAST(v_s.still_on_asked_at, public.fn_still_on_due(v_s.start_time, v_s.still_on_confirmed_at));
        v_end := GREATEST(v_end, v_s.start_time);

        -- Same guard as a normal clock-out: only a still-open shift is closed.
        UPDATE public.shifts
           SET status = 'Closed', end_time = v_end, closed_automatically = true,
               still_on_asked_at = NULL, last_modified_by = 'auto-clock-out'
         WHERE id = v_s.id AND status = 'Active' AND end_time IS NULL;
        IF NOT FOUND THEN CONTINUE; END IF;
        UPDATE public.employees SET active_shift_id = NULL WHERE id = v_s.employee_id AND active_shift_id = v_s.id;

        v_hours := floor(extract(epoch FROM (v_end - v_s.start_time)) / 3600)::int || 'h '
                || (floor(extract(epoch FROM (v_end - v_s.start_time)) / 60)::int % 60) || 'm';
        v_text := public.fn_shift_report_text(v_s.id, v_end,
            '_Clocked out automatically: ' || COALESCE(v_s.name, 'Staff') || ' did not answer "Still working?" within 3 minutes._');

        INSERT INTO public.notifications (business_id, role, title, message, type, priority, payload, created_by)
        VALUES (v_s.business_id, 'Owner',
                'Shift ended: ' || COALESCE(v_s.name, 'Staff') || ' (automatic)',
                COALESCE(v_s.name, 'Staff') || ' did not answer "Still working?", so the shift was closed automatically after ' || v_hours || '.',
                'Custom Notification', 'high',
                jsonb_build_object('reportText', v_text, 'employeeName', COALESCE(v_s.name, 'Staff'),
                                   'employeeId', v_s.employee_id, 'closedAt', v_end, 'autoClockOut', true),
                'system');

        IF v_s.user_id IS NOT NULL THEN
            INSERT INTO public.notifications (business_id, user_id, title, message, type, priority, payload, created_by)
            VALUES (v_s.business_id, v_s.user_id, 'You were clocked out automatically',
                    'Nobody answered "Still working?", so your shift was closed at '
                        || lower(to_char(v_end AT TIME ZONE 'Africa/Nairobi', 'FMHH12:MI am')) || ' (' || v_hours || '). Your report went to the owners.',
                    'Custom Notification', 'high',
                    jsonb_build_object('reportText', v_text, 'employeeName', COALESCE(v_s.name, 'Staff'), 'autoClockOut', true, 'shiftId', v_s.id),
                    'system');
        END IF;
        v_n := v_n + 1;
    END LOOP;

    -- 2. Due: ask "Still working?".
    FOR v_s IN
        SELECT s.id, s.business_id, s.start_time, e.name, e.user_id
        FROM public.shifts s
        LEFT JOIN public.employees e ON e.id = s.employee_id
        WHERE s.status = 'Active' AND s.end_time IS NULL AND s.deleted_at IS NULL
          AND s.still_on_asked_at IS NULL
          AND public.fn_still_on_due(s.start_time, s.still_on_confirmed_at) <= now()
        FOR UPDATE OF s SKIP LOCKED
    LOOP
        UPDATE public.shifts SET still_on_asked_at = now() WHERE id = v_s.id AND still_on_asked_at IS NULL;
        IF v_s.user_id IS NOT NULL THEN
            v_hours := floor(extract(epoch FROM (now() - v_s.start_time)) / 3600)::int || ' hours';
            INSERT INTO public.notifications (business_id, user_id, title, message, type, priority, payload, created_by)
            VALUES (v_s.business_id, v_s.user_id, 'Still working?',
                    'You have been clocked in for ' || v_hours || '. Open the app and tap "Still working" within 3 minutes, or you will be clocked out.',
                    'Custom Notification', 'critical',
                    jsonb_build_object('stillOnShift', true, 'shiftId', v_s.id),
                    'system');
        END IF;
    END LOOP;
    RETURN v_n;
END;
$$;

REVOKE ALL ON FUNCTION public.auto_clock_out_long_shifts() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.auto_clock_out_long_shifts() TO service_role;

-- Every minute, so the 3 minutes really are about 3 (scheduling the same name replaces the job).
DO $do$ BEGIN
    IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
        PERFORM cron.schedule('auto-clock-out', '* * * * *', $job$SELECT public.auto_clock_out_long_shifts()$job$);
    END IF;
END $do$;

-- ===================================================================
-- 20261130003_stock_period_report
-- ===================================================================
-- Daily / monthly stock report, and transfer lines by date.
--
-- stock_period_report: for one branch and a time range, per product:
--   opening and closing stock (read from the stock log, which records every change with the
--   stock before and after, sales included), what came in and went out by kind, and the sales
--   grouped by customer, payment method and delivery. Plus who owes money now.
-- list_stock_transfer_lines: every product line sent or received in a date range, so the
--   transfers screen can show transfers per product, per branch, per day.
--
-- Read only. Both check membership and permission like the screens that call them.

CREATE OR REPLACE FUNCTION public.stock_period_report(p_business_id uuid, p_from timestamptz, p_to timestamptz)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
    v_products jsonb;
    v_sales jsonb;
    v_debts jsonb;
BEGIN
    PERFORM public.assert_business_member(p_business_id);
    PERFORM public.assert_permission(p_business_id, 'reports.inventory', 'reports.view', 'reports.sales', 'inventory.stock_history', 'finance.view');
    IF p_from IS NULL OR p_to IS NULL OR p_to <= p_from THEN
        RAISE EXCEPTION 'Pick a start that is before the end.';
    END IF;
    IF p_to - p_from > interval '400 days' THEN
        RAISE EXCEPTION 'Pick at most a year at a time.';
    END IF;

    -- Per product. Every change is measured as new_stock - previous_stock, so the parts add up
    -- to closing - opening; whatever no kind explains (sales logged, stock counts) is the rest.
    WITH adj AS (
        SELECT a.product_id, a.type::text AS kind, COALESCE(a.reason, '') AS reason,
               (a.new_stock - a.previous_stock) AS delta
        FROM public.inventory_adjustments a
        WHERE a.business_id = p_business_id AND a.timestamp >= p_from AND a.timestamp < p_to
    ),
    moves AS (
        SELECT product_id,
            SUM(delta) FILTER (WHERE kind = 'Restock' AND reason <> 'Returned') AS received,
            SUM(delta) FILTER (WHERE kind = 'Restock' AND reason = 'Returned') AS returned,
            SUM(delta) FILTER (WHERE kind = 'Transfer In') AS from_branches,
            SUM(delta) FILTER (WHERE kind IN ('Transfer Out', 'Transfer Return')) AS to_branches,
            SUM(delta) FILTER (WHERE kind = 'Production Output' OR (kind = 'Production Reversal' AND delta < 0)) AS made,
            SUM(delta) FILTER (WHERE kind = 'Production Consumption' OR (kind = 'Production Reversal' AND delta > 0)) AS used,
            SUM(delta) FILTER (WHERE kind IN ('Damage', 'Production Waste')) AS waste,
            SUM(delta) FILTER (WHERE kind = 'Supplier Return') AS to_supplier,
            SUM(delta) FILTER (WHERE kind = 'Reconciliation' AND reason = 'Sold') AS sold_logged,
            SUM(delta) FILTER (WHERE kind = 'Reconciliation' AND reason <> 'Sold') AS counted,
            COUNT(*) AS changes
        FROM adj GROUP BY product_id
    )
    SELECT COALESCE(jsonb_agg(row ORDER BY row->>'name'), '[]'::jsonb) INTO v_products
    FROM (
        SELECT jsonb_build_object(
            'id', p.id,
            'name', p.name,
            'unit', COALESCE(p.unit, ''),
            'price', p.price,
            'stockNow', p.stock,
            'opening', COALESCE(
                (SELECT a.new_stock FROM public.inventory_adjustments a
                  WHERE a.product_id = p.id AND a.timestamp < p_from ORDER BY a.timestamp DESC, a.created_at DESC LIMIT 1),
                (SELECT a.previous_stock FROM public.inventory_adjustments a
                  WHERE a.product_id = p.id AND a.timestamp >= p_from ORDER BY a.timestamp, a.created_at LIMIT 1),
                p.stock),
            'closing', COALESCE(
                (SELECT a.new_stock FROM public.inventory_adjustments a
                  WHERE a.product_id = p.id AND a.timestamp < p_to ORDER BY a.timestamp DESC, a.created_at DESC LIMIT 1),
                (SELECT a.previous_stock FROM public.inventory_adjustments a
                  WHERE a.product_id = p.id AND a.timestamp >= p_to ORDER BY a.timestamp, a.created_at LIMIT 1),
                p.stock),
            'received', COALESCE(m.received, 0),
            'returned', COALESCE(m.returned, 0),
            'fromBranches', COALESCE(m.from_branches, 0),
            'toBranches', COALESCE(-m.to_branches, 0),
            'made', COALESCE(m.made, 0),
            'used', COALESCE(-m.used, 0),
            'waste', COALESCE(-m.waste, 0),
            'toSupplier', COALESCE(-m.to_supplier, 0),
            'soldLogged', COALESCE(-m.sold_logged, 0),
            'counted', COALESCE(m.counted, 0),
            'changes', COALESCE(m.changes, 0)
        ) AS row
        FROM public.products p
        LEFT JOIN moves m ON m.product_id = p.id
        WHERE p.business_id = p_business_id
          AND (p.deleted_at IS NULL OR m.product_id IS NOT NULL)
    ) q;

    -- Sales in the range, grouped. Each line gets its share of what the sale charged (less any
    -- delivery fee), so discounts are spread fairly and the lines add up to the sale.
    WITH lines AS (
        SELECT t.id AS tx_id, t.customer_id, t.customer_name, t.payment_method::text AS method, t.is_delivery,
               ti.product_id, ti.quantity,
               COALESCE(ti.line_total, 0) AS line_total,
               GREATEST(t.final_total - CASE WHEN t.is_delivery THEN COALESCE(t.delivery_fee, 0) ELSE 0 END, 0) AS charged,
               SUM(COALESCE(ti.line_total, 0)) OVER (PARTITION BY t.id) AS tx_lines,
               COUNT(*) OVER (PARTITION BY t.id) AS tx_count
        FROM public.transactions t
        JOIN public.transaction_items ti ON ti.transaction_id = t.id
        WHERE t.business_id = p_business_id AND t.deleted_at IS NULL
          AND t.timestamp >= p_from AND t.timestamp < p_to
    )
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'productId', g.product_id,
        'customerId', g.customer_id,
        'customerName', g.customer_name,
        'customerType', g.customer_type,
        'method', g.method,
        'delivery', g.is_delivery,
        'qty', g.qty,
        'value', g.value,
        'sales', g.sales
    )), '[]'::jsonb) INTO v_sales
    FROM (
        SELECT l.product_id, l.customer_id,
               COALESCE(c.name, NULLIF(TRIM(l.customer_name), '')) AS customer_name,
               c.customer_type, l.method, l.is_delivery,
               SUM(l.quantity) AS qty,
               ROUND(SUM(CASE WHEN l.tx_lines > 0 THEN l.charged * l.line_total / l.tx_lines ELSE l.charged / l.tx_count END), 2) AS value,
               COUNT(DISTINCT l.tx_id) AS sales
        FROM lines l
        LEFT JOIN public.customers c ON c.id = l.customer_id
        GROUP BY l.product_id, l.customer_id, COALESCE(c.name, NULLIF(TRIM(l.customer_name), '')), c.customer_type, l.method, l.is_delivery
    ) g;

    -- Who owes money now (not as at the end of the range: debts are not logged per day).
    SELECT COALESCE(jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'owes', c.debt_balance) ORDER BY c.debt_balance DESC), '[]'::jsonb)
    INTO v_debts
    FROM public.customers c
    WHERE c.business_id = p_business_id AND c.deleted_at IS NULL AND c.debt_balance > 0;

    RETURN jsonb_build_object('products', v_products, 'sales', v_sales, 'debts', v_debts);
END;
$$;

ALTER FUNCTION public.stock_period_report(uuid, timestamptz, timestamptz) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.stock_period_report(uuid, timestamptz, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.stock_period_report(uuid, timestamptz, timestamptz) TO authenticated;


CREATE OR REPLACE FUNCTION public.list_stock_transfer_lines(p_business_id uuid, p_from timestamptz, p_to timestamptz)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
    v_out jsonb;
BEGIN
    PERFORM public.assert_business_member(p_business_id);
    PERFORM public.assert_permission(p_business_id, 'inventory.transfer_stock', 'inventory.receive_stock', 'inventory.stock_history', 'inventory.request_transfer');
    IF p_from IS NULL OR p_to IS NULL OR p_to <= p_from THEN
        RAISE EXCEPTION 'Pick a start that is before the end.';
    END IF;

    -- Only stock that actually moved: sent (on the way or received). Asked-for, drafts,
    -- declined and cancelled transfers moved nothing.
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'transferId', t.id,
        'reference', t.reference,
        'status', t.status,
        'direction', CASE WHEN t.from_business_id = p_business_id THEN 'out' ELSE 'in' END,
        'otherBranch', CASE WHEN t.from_business_id = p_business_id THEN bt.name ELSE bf.name END,
        'sentAt', t.sent_at,
        'receivedAt', t.received_at,
        'productName', i.product_name,
        'sku', i.sku,
        'unit', i.unit,
        'unitCost', i.unit_cost,
        'quantitySent', i.quantity_sent,
        'quantityReceived', i.quantity_received
    ) ORDER BY t.sent_at DESC, i.product_name), '[]'::jsonb) INTO v_out
    FROM public.stock_transfers t
    JOIN public.stock_transfer_items i ON i.transfer_id = t.id
    JOIN public.businesses bf ON bf.id = t.from_business_id
    JOIN public.businesses bt ON bt.id = t.to_business_id
    WHERE (t.from_business_id = p_business_id OR t.to_business_id = p_business_id)
      AND t.status IN ('in_transit', 'received')
      AND t.sent_at >= p_from AND t.sent_at < p_to;

    RETURN v_out;
END;
$$;

ALTER FUNCTION public.list_stock_transfer_lines(uuid, timestamptz, timestamptz) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.list_stock_transfer_lines(uuid, timestamptz, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_stock_transfer_lines(uuid, timestamptz, timestamptz) TO authenticated;

-- ===================================================================
-- 20261130004_rider_pay_bills
-- ===================================================================
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

-- ===================================================================
-- 20261130005_regular_orders
-- ===================================================================
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

-- ===================================================================
-- 20261130006_permissions_db_level
-- ===================================================================
-- Roles and permissions enforced by the database, matching the app.
--
-- 1. Read grants. Many tables had a read rule (RLS policy) but signed-in users had no SELECT
--    grant, so Postgres refused before the rule ran: "permission denied for table invoices".
--    Nobody, the Owner and Admin included, could read invoices, invoice numbers, credit notes,
--    quotes, sales orders/invoices, the books, supplier payments, KRA receipts or points earned.
--    The rules already say who may read; this gives them the grant they need.
-- 2. Tables that only let "Owner or Admin" write now follow the Roles screen, using the same
--    permission the app checks before showing the action (business.update, staff.invite, ...).
--    Tables holding secrets (ai_settings, sms_settings, google_sheets_backup) stay Owner/Admin
--    only; their edge functions check the permission and never return the secret.
-- 3. Only the Owner or an Admin can make, change or remove an Admin, and nobody can change the
--    permissions of their own role. The app already hid these; now the database refuses them.
-- 4. touch_my_presence: every role can mark itself online (the heartbeat wrote to employees,
--    which only Owner/Admin may write, so other roles never showed as online).

-- 1. Read grants -----------------------------------------------------------------------------
DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN
        SELECT DISTINCT c.relname
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        JOIN pg_policies p ON p.schemaname = n.nspname AND p.tablename = c.relname
        WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relrowsecurity
          AND p.cmd IN ('SELECT', 'ALL')
          AND (p.roles && ARRAY['public', 'authenticated']::NAME[])
          AND NOT has_table_privilege('authenticated', c.oid, 'SELECT')
    LOOP
        EXECUTE format('GRANT SELECT ON public.%I TO authenticated', r.relname);
        RAISE NOTICE 'granted SELECT on %', r.relname;
    END LOOP;
END $$;

-- The API never truncates or adds triggers; signed-in and anonymous users don't need these.
DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN
        SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
    LOOP
        EXECUTE format('REVOKE TRUNCATE, TRIGGER, REFERENCES ON public.%I FROM anon, authenticated', r.relname);
    END LOOP;
END $$;

-- Helpers --------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_is_top_role(p_role TEXT)
RETURNS BOOLEAN LANGUAGE sql IMMUTABLE AS $$
    SELECT COALESCE(p_role IN ('Owner', 'Admin', 'Administrator'), FALSE);
$$;

-- The signed-in person's role in a business, or NULL.
CREATE OR REPLACE FUNCTION public.fn_my_role(p_business_id UUID)
RETURNS TEXT LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT bm.role::TEXT
    FROM public.business_memberships bm
    JOIN public.users u ON u.id = bm.user_id
    WHERE u.auth_user_id = auth.uid() AND bm.business_id = p_business_id AND bm.status = 'Active'
    LIMIT 1;
$$;
REVOKE ALL ON FUNCTION public.fn_my_role(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_my_role(UUID) TO authenticated;

-- Who may change a role's permissions: staff.roles, never for Owner/Admin (they always have
-- everything) and never for your own role, unless you are the Owner or an Admin.
CREATE OR REPLACE FUNCTION public.fn_can_edit_role_permissions(p_business_id UUID, p_role TEXT)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT public.is_owner_or_admin(p_business_id)
        OR (public.has_permission(p_business_id, 'staff.roles')
            AND NOT public.fn_is_top_role(p_role)
            AND p_role IS DISTINCT FROM public.fn_my_role(p_business_id));
$$;
REVOKE ALL ON FUNCTION public.fn_can_edit_role_permissions(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_can_edit_role_permissions(UUID, TEXT) TO authenticated;

-- 2. Policies that follow the Roles screen ----------------------------------------------------

-- Branches and business details: business.update; deleting the business: business.delete.
DROP POLICY IF EXISTS pol_branches_write ON public.branches;
CREATE POLICY pol_branches_write ON public.branches FOR ALL
    USING (public.has_permission(business_id, 'business.update'))
    WITH CHECK (public.has_permission(business_id, 'business.update'));

DROP POLICY IF EXISTS pol_businesses_update ON public.businesses;
CREATE POLICY pol_businesses_update ON public.businesses FOR UPDATE
    USING (public.has_permission(id, 'business.update'))
    WITH CHECK (public.has_permission(id, 'business.update'));

DROP POLICY IF EXISTS pol_businesses_delete ON public.businesses;
CREATE POLICY pol_businesses_delete ON public.businesses FOR DELETE
    USING (public.has_permission(id, 'business.delete'));

-- Staff records: staff.update.
DROP POLICY IF EXISTS pol_employees_write ON public.employees;
CREATE POLICY pol_employees_write ON public.employees FOR ALL
    USING (public.has_permission(business_id, 'staff.update'))
    WITH CHECK (public.has_permission(business_id, 'staff.update'));

-- Team: changing a role needs staff.update or staff.roles, removing someone staff.remove.
-- Adding people goes through invitations (accept_invitation_with_token), so direct inserts
-- stay Owner/Admin.
DROP POLICY IF EXISTS pol_memberships_write ON public.business_memberships;
DROP POLICY IF EXISTS pol_memberships_insert ON public.business_memberships;
CREATE POLICY pol_memberships_insert ON public.business_memberships FOR INSERT
    WITH CHECK (public.is_owner_or_admin(business_id));
DROP POLICY IF EXISTS pol_memberships_update ON public.business_memberships;
CREATE POLICY pol_memberships_update ON public.business_memberships FOR UPDATE
    USING (public.has_permission(business_id, 'staff.update', 'staff.roles'))
    WITH CHECK (public.has_permission(business_id, 'staff.update', 'staff.roles'));
DROP POLICY IF EXISTS pol_memberships_delete ON public.business_memberships;
CREATE POLICY pol_memberships_delete ON public.business_memberships FOR DELETE
    USING (public.has_permission(business_id, 'staff.remove'));

-- Invitations: see with staff.view / invitations.view, send with staff.invite /
-- invitations.create, cancel with invitations.delete / staff.invite.
DROP POLICY IF EXISTS pol_invitations_write ON public.invitations;
DROP POLICY IF EXISTS pol_invitations_select ON public.invitations;
CREATE POLICY pol_invitations_select ON public.invitations FOR SELECT
    USING (public.has_permission(business_id, 'staff.view', 'invitations.view', 'staff.invite', 'invitations.create'));
DROP POLICY IF EXISTS pol_invitations_insert ON public.invitations;
CREATE POLICY pol_invitations_insert ON public.invitations FOR INSERT
    WITH CHECK (public.has_permission(business_id, 'staff.invite', 'invitations.create'));
DROP POLICY IF EXISTS pol_invitations_update ON public.invitations;
CREATE POLICY pol_invitations_update ON public.invitations FOR UPDATE
    USING (public.has_permission(business_id, 'staff.invite', 'invitations.create'))
    WITH CHECK (public.has_permission(business_id, 'staff.invite', 'invitations.create'));
DROP POLICY IF EXISTS pol_invitations_delete ON public.invitations;
CREATE POLICY pol_invitations_delete ON public.invitations FOR DELETE
    USING (public.has_permission(business_id, 'invitations.delete', 'staff.invite'));

-- Role permissions: see fn_can_edit_role_permissions.
DROP POLICY IF EXISTS pol_role_perms_write ON public.role_permissions;
CREATE POLICY pol_role_perms_write ON public.role_permissions FOR ALL
    USING (public.fn_can_edit_role_permissions(business_id, role::TEXT))
    WITH CHECK (public.fn_can_edit_role_permissions(business_id, role::TEXT));

-- Receipt and printer settings: the Receipts & printing screen (settings.tax / settings.update).
DROP POLICY IF EXISTS pol_receipt_settings_write ON public.receipt_settings;
CREATE POLICY pol_receipt_settings_write ON public.receipt_settings FOR ALL
    USING (public.has_permission(business_id, 'settings.tax', 'settings.update'))
    WITH CHECK (public.has_permission(business_id, 'settings.tax', 'settings.update'));

DROP POLICY IF EXISTS pol_printer_settings_write ON public.printer_settings;
CREATE POLICY pol_printer_settings_write ON public.printer_settings FOR ALL
    USING (public.has_permission(business_id, 'settings.tax', 'settings.update'))
    WITH CHECK (public.has_permission(business_id, 'settings.tax', 'settings.update'));

-- Website content: the app lets business.update manage the website.
DROP POLICY IF EXISTS pol_website_settings_write ON public.website_settings;
CREATE POLICY pol_website_settings_write ON public.website_settings FOR ALL
    USING (public.has_permission(business_id, 'business.update'))
    WITH CHECK (public.has_permission(business_id, 'business.update'));

DROP POLICY IF EXISTS pol_website_articles_write ON public.website_articles;
CREATE POLICY pol_website_articles_write ON public.website_articles FOR ALL
    USING (public.has_permission(business_id, 'business.update'))
    WITH CHECK (public.has_permission(business_id, 'business.update'));

DROP POLICY IF EXISTS pol_product_ideas_staff_write ON public.website_product_ideas;
CREATE POLICY pol_product_ideas_staff_write ON public.website_product_ideas FOR ALL
    USING (public.has_permission(business_id, 'business.update'))
    WITH CHECK (public.has_permission(business_id, 'business.update'));

DROP POLICY IF EXISTS pol_website_reviews_staff_update ON public.website_reviews;
CREATE POLICY pol_website_reviews_staff_update ON public.website_reviews FOR UPDATE
    USING (public.has_permission(business_id, 'business.update', 'complaints.reply'))
    WITH CHECK (public.has_permission(business_id, 'business.update', 'complaints.reply'));

DROP POLICY IF EXISTS pol_website_reviews_staff_delete ON public.website_reviews;
CREATE POLICY pol_website_reviews_staff_delete ON public.website_reviews FOR DELETE
    USING (public.has_permission(business_id, 'business.update'));

-- 3. Admin guard ---------------------------------------------------------------------------------
-- Covers direct writes and update_team_member alike. Server jobs (no signed-in user) pass.
CREATE OR REPLACE FUNCTION public.fn_membership_top_role_guard()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_biz UUID := COALESCE(NEW.business_id, OLD.business_id);
BEGIN
    IF auth.uid() IS NULL OR public.is_owner_or_admin(v_biz) THEN
        RETURN COALESCE(NEW, OLD);
    END IF;
    IF TG_OP = 'DELETE' AND public.fn_is_top_role(OLD.role::TEXT) THEN
        RAISE EXCEPTION 'Only the Owner or an Admin can remove an Admin.' USING ERRCODE = '42501';
    END IF;
    IF TG_OP = 'UPDATE' AND OLD.role IS DISTINCT FROM NEW.role
       AND (public.fn_is_top_role(OLD.role::TEXT) OR public.fn_is_top_role(NEW.role::TEXT)) THEN
        RAISE EXCEPTION 'Only the Owner or an Admin can make someone an Admin.' USING ERRCODE = '42501';
    END IF;
    RETURN COALESCE(NEW, OLD);
END;
$$;
DROP TRIGGER IF EXISTS trg_membership_top_role_guard ON public.business_memberships;
CREATE TRIGGER trg_membership_top_role_guard
    BEFORE UPDATE OR DELETE ON public.business_memberships
    FOR EACH ROW EXECUTE FUNCTION public.fn_membership_top_role_guard();

-- Invitations: nobody is invited as Owner; only the Owner or an Admin invites an Admin.
CREATE OR REPLACE FUNCTION public.fn_invitation_not_owner()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    IF NEW.role = 'Owner' THEN
        RAISE EXCEPTION 'Nobody can be invited as Owner.' USING ERRCODE = '42501';
    END IF;
    IF public.fn_is_top_role(NEW.role::TEXT) AND auth.uid() IS NOT NULL
       AND NOT public.is_owner_or_admin(NEW.business_id) THEN
        RAISE EXCEPTION 'Only the Owner or an Admin can invite an Admin.' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
END;
$$;

-- 4. Presence for every role ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.touch_my_presence(p_business_id UUID)
RETURNS VOID LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
    UPDATE public.employees e
    SET last_seen_at = NOW()
    FROM public.users u
    WHERE u.auth_user_id = auth.uid()
      AND e.user_id = u.id
      AND e.business_id = p_business_id
      AND p_business_id = ANY (public.get_user_business_ids());
$$;
REVOKE ALL ON FUNCTION public.touch_my_presence(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.touch_my_presence(UUID) TO authenticated;

-- Payments are never deleted from the app (money rule 4: undo is a soft-delete that reverses the
-- balance and books). Signed-in users have no DELETE grant, so this rule never applied.
DROP POLICY IF EXISTS pol_payments_delete ON public.payments;

-- ===================================================================
-- 20261130007_quantity_one_decimal
-- ===================================================================
-- Quantities have at most one decimal place (owner, 2026-11-18): 2, 1.5, 0.5.
-- Money is already numeric(14,2) everywhere, so it is always stored to the cent. Rates that are
-- not amounts (percentages, loyalty KSh-per-point values) keep their own precision.
--
-- Every quantity column (stock, sale lines, transfers, purchases, recipes, production, regular
-- orders, promotion item counts) becomes numeric(p,1); Postgres rounds anything written to it.
-- Recipes give their ingredients per batch (yield_quantity), so small amounts are written as a
-- batch amount (5 kg salt for 100 loaves), not per item.
-- The three views that read these columns are dropped and made again unchanged.

DO $$
DECLARE
    v_cols TEXT[] := ARRAY[
        'bill_of_materials.yield_quantity',
        'bom_ingredients.quantity_required',
        'credit_note_lines.quantity',
        'inventory_adjustments.quantity_adjusted',
        'inventory_adjustments.previous_stock',
        'inventory_adjustments.new_stock',
        'online_order_items.quantity',
        'production_batches.quantity_produced',
        'products.reorder_qty',
        'products.stock',
        'products.min_stock',
        'products.reorder_level',
        'purchase_items.qty_damaged',
        'purchase_items.qty_received',
        'purchase_items.quantity',
        'purchase_receipt_lines.qty_received',
        'purchase_receipt_lines.qty_damaged',
        'quote_lines.quantity',
        'recipe_ingredients.quantity',
        'recipes.yield_quantity',
        'referral_campaigns.referrer_qty',
        'referral_campaigns.welcome_qty',
        'referral_rewards.qty',
        'regular_order_days.quantity',
        'sales_delivery_lines.quantity',
        'sales_invoice_lines.qty_credited',
        'sales_invoice_lines.quantity',
        'sales_order_lines.qty_invoiced',
        'sales_order_lines.qty_delivered',
        'sales_order_lines.quantity',
        'stock_transfer_items.quantity_written_off',
        'stock_transfer_items.quantity_sent',
        'stock_transfer_items.quantity_received',
        'stock_transfer_items.quantity_requested',
        'stock_transfer_items.quantity_late',
        'stock_transfer_items.quantity_found',
        'supplier_return_lines.quantity',
        'supplier_stock_requests.quantity',
        'transaction_items.quantity',
        'website_promo_codes.reward_qty',
        'website_promo_codes.buy_qty'
    ];
    v_views TEXT[] := ARRAY['v_active_products', 'v_low_stock_products', 'v_product_sales_rank'];
    v_defs  JSONB := '{}'::JSONB;
    v_name  TEXT;
    v_col   TEXT;
    v_tbl   TEXT;
    v_att   TEXT;
    v_prec  INT;
    v_scale INT;
    g       RECORD;
BEGIN
    -- Save each view (definition, options, grants) before dropping it.
    FOREACH v_name IN ARRAY v_views LOOP
        IF to_regclass('public.' || v_name) IS NULL THEN CONTINUE; END IF;
        v_defs := v_defs || jsonb_build_object(v_name, jsonb_build_object(
            'sql', pg_get_viewdef(('public.' || v_name)::regclass, TRUE),
            'opts', (SELECT COALESCE(array_to_string(reloptions, ', '), '') FROM pg_class WHERE oid = ('public.' || v_name)::regclass),
            'grants', (SELECT COALESCE(jsonb_agg(jsonb_build_object('who', grantee, 'what', privilege_type)), '[]'::JSONB)
                       FROM information_schema.role_table_grants
                       WHERE table_schema = 'public' AND table_name = v_name AND grantee <> 'postgres')));
        EXECUTE format('DROP VIEW public.%I', v_name);
    END LOOP;

    FOREACH v_col IN ARRAY v_cols LOOP
        v_tbl := split_part(v_col, '.', 1);
        v_att := split_part(v_col, '.', 2);
        SELECT numeric_precision, numeric_scale INTO v_prec, v_scale
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = v_tbl AND column_name = v_att AND data_type = 'numeric';
        IF NOT FOUND OR v_scale = 1 THEN CONTINUE; END IF;
        -- Same digits before the point (or more), one after it.
        EXECUTE format('ALTER TABLE public.%I ALTER COLUMN %I TYPE NUMERIC(%s,1)',
                       v_tbl, v_att, GREATEST(COALESCE(v_prec, 14) - COALESCE(v_scale, 0) + 1, 14));
    END LOOP;

    FOR v_name IN SELECT jsonb_object_keys(v_defs) LOOP
        EXECUTE format('CREATE VIEW public.%I%s AS %s', v_name,
                       CASE WHEN v_defs -> v_name ->> 'opts' = '' THEN '' ELSE ' WITH (' || (v_defs -> v_name ->> 'opts') || ')' END,
                       v_defs -> v_name ->> 'sql');
        FOR g IN SELECT x ->> 'who' AS who, x ->> 'what' AS what FROM jsonb_array_elements(v_defs -> v_name -> 'grants') x LOOP
            EXECUTE format('GRANT %s ON public.%I TO %I', g.what, v_name, g.who);
        END LOOP;
    END LOOP;
END $$;

-- Regular orders keep an amount per weekday in an array.
ALTER TABLE public.regular_orders
    ALTER COLUMN day_qty TYPE NUMERIC(14,1)[],
    ALTER COLUMN pending_day_qty TYPE NUMERIC(14,1)[];

-- ===================================================================
-- 20261130008_ai_reads_permissions
-- ===================================================================
-- The assistant reads what a person may do from the database on every message, using the
-- same rule as has_permission: a saved row on the Roles screen wins, otherwise the role's
-- default. Before this, the chat function read only saved rows (so a role never saved had
-- nothing) and offered a fixed list of 12 tasks, so it refused things the Roles screen allowed.

CREATE OR REPLACE FUNCTION public.my_permissions(p_business_id uuid)
RETURNS TABLE (member_role text, full_access boolean, codes text[])
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
    v_role text;
BEGIN
    SELECT bm.role::text INTO v_role
    FROM public.business_memberships bm
    JOIN public.users u ON u.id = bm.user_id
    WHERE u.auth_user_id = auth.uid()
      AND bm.business_id = p_business_id
      AND bm.status = 'Active';

    IF v_role IS NULL THEN
        RETURN;
    END IF;
    IF v_role IN ('Owner', 'Admin', 'Administrator') THEN
        RETURN QUERY SELECT v_role, true, ARRAY[]::text[];
        RETURN;
    END IF;

    RETURN QUERY
    SELECT v_role, false, COALESCE(array_agg(s.code ORDER BY s.code), ARRAY[]::text[])
    FROM (
        SELECT rp.permission AS code
        FROM public.role_permissions rp
        WHERE rp.business_id = p_business_id AND rp.role::text = v_role AND rp.granted
        UNION
        SELECT d.code
        FROM public.role_default_permissions r, unnest(r.permissions) AS d(code)
        WHERE r.role = v_role
          AND NOT EXISTS (
              SELECT 1 FROM public.role_permissions rp
              WHERE rp.business_id = p_business_id AND rp.role::text = v_role AND rp.permission = d.code
          )
    ) s;
END;
$$;

REVOKE ALL ON FUNCTION public.my_permissions(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_permissions(uuid) TO authenticated, service_role;

-- Which business's AI settings to use. A branch that never saved its own uses the ones
-- the owner saved on another branch, so the website and app of every branch run on the
-- AI the owner chose instead of the built-in default.
CREATE OR REPLACE FUNCTION public.fn_ai_settings_business(p_business_id uuid)
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
    SELECT COALESCE(
        (SELECT s.business_id FROM public.ai_settings s WHERE s.business_id = p_business_id),
        (SELECT s.business_id
         FROM public.ai_settings s
         JOIN public.businesses b ON b.id = s.business_id AND b.deleted_at IS NULL
         WHERE s.business_id <> p_business_id
           AND public.fn_branches_share_owner(p_business_id, s.business_id)
         ORDER BY s.updated_at DESC
         LIMIT 1),
        p_business_id
    );
$$;

REVOKE ALL ON FUNCTION public.fn_ai_settings_business(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_ai_settings_business(uuid) TO service_role;

-- ===================================================================
-- 20261201001_lock_function_grants
-- ===================================================================
-- Who can call each database function goes back to what the migrations grant.
--
-- On the live database, Supabase's default privileges had given EXECUTE on every function
-- created after the 2026-11-16 reset to anon and authenticated (PUBLIC as well). So anyone
-- with the public app key, signed in or not, could call functions only the server should run:
-- update_user_password_by_email (set any account's password), fn_post_money_asset and acc_apply
-- (money balances and the books), settle_card_payment / confirm_*_payment (mark payments paid),
-- otp_* and others. A database built from these files never had those grants, which is why
-- the tests did not see it (security review 2026-11-23, finding SEC-01).
--
-- For each function below: EXECUTE is taken from PUBLIC, anon and authenticated, then given
-- back only to the roles the migrations meant (service_role always, so edge functions keep
-- working). The list is every function whose live grants were wider than a clean build's.
-- Functions not listed are unchanged. A function missing on this database is skipped.
--
-- New functions: no longer callable by anon/authenticated unless a migration grants it,
-- the same as on a clean build (and as every migration since 20261120001 already does).

DO $$
DECLARE
    r record;
    v_fn regprocedure;
BEGIN
    FOR r IN SELECT * FROM (VALUES
    ('public.acc_account(p_business_id uuid, p_key text)', 'service_role'),
    ('public.acc_apply(p_business_id uuid, p_type text, p_id uuid, p_date date, p_memo text, p_lines jsonb, p_by text)', 'service_role'),
    ('public.acc_buying_lines(p_type text, p_id uuid)', 'service_role'),
    ('public.acc_checks(p_business_id uuid)', 'authenticated, service_role'),
    ('public.acc_delete_account(p_id uuid)', 'authenticated, service_role'),
    ('public.acc_delete_entry(p_entry_id uuid)', 'authenticated, service_role'),
    ('public.acc_ensure_accounts(p_business_id uuid)', 'service_role'),
    ('public.acc_errors(p_business_id uuid)', 'authenticated, service_role'),
    ('public.acc_expense_account(p_business_id uuid, p_category text)', 'service_role'),
    ('public.acc_journal(p_business_id uuid, p_start date, p_end date, p_search text, p_kind text, p_limit integer, p_offset integer)', 'authenticated, service_role'),
    ('public.acc_ledger(p_account_id uuid, p_start date, p_end date, p_limit integer)', 'authenticated, service_role'),
    ('public.acc_match_stock(p_business_id uuid, p_note text)', 'authenticated, service_role'),
    ('public.acc_payables(p_business_id uuid)', 'authenticated, service_role'),
    ('public.acc_post_source(p_type text, p_id uuid)', 'service_role'),
    ('public.acc_rebuild_chunk(p_business_id uuid, p_type text, p_offset integer, p_limit integer)', 'authenticated, service_role'),
    ('public.acc_rebuild_start(p_business_id uuid)', 'authenticated, service_role'),
    ('public.acc_receivables(p_business_id uuid)', 'authenticated, service_role'),
    ('public.acc_reconcile_money(p_business_id uuid, p_account_id uuid, p_actual numeric, p_note text)', 'authenticated, service_role'),
    ('public.acc_report(p_business_id uuid, p_start date, p_end date)', 'authenticated, service_role'),
    ('public.acc_retry_errors(p_business_id uuid)', 'authenticated, service_role'),
    ('public.acc_reverse_entry(p_entry_id uuid, p_date date)', 'authenticated, service_role'),
    ('public.acc_sales_doc_lines(p_type text, p_id uuid)', 'service_role'),
    ('public.acc_save_account(p_business_id uuid, p_id uuid, p_code text, p_name text, p_type text, p_description text, p_active boolean)', 'authenticated, service_role'),
    ('public.acc_save_entry(p_business_id uuid, p_date date, p_memo text, p_lines jsonb, p_entry_id uuid)', 'authenticated, service_role'),
    ('public.acc_set_lock_date(p_business_id uuid, p_date date)', 'authenticated, service_role'),
    ('public.acc_source_ids(p_business_id uuid, p_type text, p_offset integer, p_limit integer)', 'service_role'),
    ('public.acc_sync_money(p_entry_id uuid, p_sign integer, p_by text)', 'service_role'),
    ('public.acc_trg_post()', 'service_role'),
    ('public.acc_trg_post_rider_pay()', 'service_role'),
    ('public.acc_trg_post_transfer()', 'service_role'),
    ('public.acc_vat(p_business_id uuid, p_start date, p_end date)', 'authenticated, service_role'),
    ('public.acc_who()', 'service_role'),
    ('public.accept_alert(p_notification_id uuid)', 'authenticated, service_role'),
    ('public.accept_schedule_occurrence(p_schedule_id uuid, p_date date, p_time text)', 'authenticated, service_role'),
    ('public.accept_transfer_request(p_transfer_id uuid, p_items jsonb)', 'authenticated, service_role'),
    ('public.account_email_verified(p_auth_user_id uuid)', 'authenticated, service_role'),
    ('public.adjust_stock_bulk(p_adjustments jsonb, p_employee_id uuid, p_staff_name text)', 'authenticated, service_role'),
    ('public.adjust_stock_manually(p_product_id uuid, p_employee_id uuid, p_staff_name text, p_adj_type inventory_adjustment_type, p_quantity numeric, p_reason text)', 'authenticated, service_role'),
    ('public.approve_purchase(p_id uuid, p_note text)', 'authenticated, service_role'),
    ('public.approve_stock_transfer(p_transfer_id uuid)', 'authenticated, service_role'),
    ('public.approve_supplier_bill(p_id uuid, p_note text)', 'authenticated, service_role'),
    ('public.ask_supplier_for_stock(p_product_id uuid, p_quantity numeric, p_needed_by date, p_note text, p_supplier_id uuid)', 'authenticated, service_role'),
    ('public.ask_supplier_prices(p_purchase_id uuid, p_supplier_ids uuid[], p_via text)', 'authenticated, service_role'),
    ('public.assert_permission(p_business_id uuid, VARIADIC p_permissions text[])', 'authenticated, service_role'),
    ('public.assert_supplier(p_business_id uuid, p_code text)', 'authenticated, service_role'),
    ('public.attach_card_payment_to_sale(p_card_payment_id uuid, p_transaction_id uuid)', 'authenticated, service_role'),
    ('public.attach_sale_to_customer(p_transaction_id uuid, p_customer_id uuid)', 'authenticated, service_role'),
    ('public.begin_order_payment(p_order_id uuid, p_user_id uuid)', 'service_role'),
    ('public.buying_nightly()', 'service_role'),
    ('public.buying_overview(p_business_id uuid)', 'authenticated, service_role'),
    ('public.can_create_business()', 'authenticated, service_role'),
    ('public.cancel_my_order(p_order_id uuid)', 'authenticated, service_role'),
    ('public.cancel_sales_delivery(p_id uuid, p_reason text)', 'authenticated, service_role'),
    ('public.cancel_sales_order(p_id uuid, p_reason text)', 'authenticated, service_role'),
    ('public.cancel_stock_transfer(p_transfer_id uuid, p_reason text)', 'authenticated, service_role'),
    ('public.cancel_supplier_stock_request(p_request_id uuid)', 'authenticated, service_role'),
    ('public.check_rate_limit(p_key text, p_limit integer, p_window_seconds integer)', 'service_role'),
    ('public.choose_supplier_quote(p_quote_id uuid)', 'authenticated, service_role'),
    ('public.close_purchase(p_id uuid, p_reason text)', 'authenticated, service_role'),
    ('public.confirm_airtel_payment(p_reference text, p_success boolean, p_airtel_money_id text, p_code text, p_message text, p_raw jsonb)', 'service_role'),
    ('public.confirm_online_order_payment(p_checkout_request_id text, p_result_code integer, p_amount numeric, p_receipt text, p_raw jsonb)', 'service_role'),
    ('public.confirm_store_payment_request(p_checkout_request_id text, p_result_code integer, p_amount numeric, p_receipt text, p_raw jsonb)', 'service_role'),
    ('public.consume_assistant_quota(p_business_id uuid, p_visitor text)', 'service_role'),
    ('public.create_business_with_owner(p_name text, p_type text, p_country text, p_currency text, p_logo_url text, p_description text, p_address text)', 'authenticated, service_role'),
    ('public.create_credit_note(p_business_id uuid, p_doc jsonb)', 'authenticated, service_role'),
    ('public.create_customer_account(p_slug text, p_name text, p_phone text)', 'authenticated, service_role'),
    ('public.create_suggested_purchases(p_business_id uuid, p_lines jsonb)', 'authenticated, service_role'),
    ('public.create_supplier_bill(p_business_id uuid, p_doc jsonb)', 'authenticated, service_role'),
    ('public.create_supplier_return(p_business_id uuid, p_doc jsonb)', 'authenticated, service_role'),
    ('public.customer_open_invoices(p_customer_id uuid)', 'authenticated, service_role'),
    ('public.customer_purchase_stats(p_business_id uuid)', 'authenticated, service_role'),
    ('public.decline_transfer_request(p_transfer_id uuid, p_reason text)', 'authenticated, service_role'),
    ('public.delete_invoice(p_invoice_id uuid)', 'authenticated, service_role'),
    ('public.delete_log_entries(p_business_id uuid, p_log text, p_ids uuid[], p_before timestamp with time zone)', 'authenticated, service_role'),
    ('public.delete_my_notifications(p_ids uuid[])', 'authenticated, service_role'),
    ('public.delete_petty_cash_category(p_business_id uuid, p_id uuid)', 'authenticated, service_role'),
    ('public.delete_quote(p_id uuid)', 'authenticated, service_role'),
    ('public.deliver_sales_order(p_order_id uuid, p_lines jsonb, p_note text)', 'authenticated, service_role'),
    ('public.dismiss_duplicate_customers(p_business_id uuid, p_customer_ids uuid[])', 'authenticated, service_role'),
    ('public.escalate_unaccepted_alerts()', 'service_role'),
    ('public.find_account_by_auth_phone(p_phone text)', 'service_role'),
    ('public.find_auth_user_by_phone(p_phone text)', 'service_role'),
    ('public.find_duplicate_customers(p_business_id uuid)', 'authenticated, service_role'),
    ('public.finish_invitation(p_invite_id uuid, p_auth_user_id uuid, p_name text, p_phone text)', 'service_role'),
    ('public.flag_due_schedule_reminders()', 'service_role'),
    ('public.flag_order_payment_unconfirmed(p_order_id uuid, p_checkout_request_id text)', 'service_role'),
    ('public.fn_account_customer(p_account_id uuid, p_business_id uuid)', 'service_role'),
    ('public.fn_alert_crash()', 'service_role'),
    ('public.fn_audit_sale_change()', 'service_role'),
    ('public.fn_audit_sale_item_change()', 'service_role'),
    ('public.fn_bill_refresh(p_bill_id uuid)', 'service_role'),
    ('public.fn_branches_share_owner(p_a uuid, p_b uuid)', 'service_role'),
    ('public.fn_build_online_order(p_account_id uuid, p_items jsonb, p_fulfilment text, p_address text, p_notes text, p_schedule_id uuid, p_zone_id uuid, p_points integer)', 'service_role'),
    ('public.fn_buying_ctx()', 'service_role'),
    ('public.fn_buying_notify(p_business_id uuid, p_user_id uuid, p_type text, p_title text, p_message text, p_target text, p_payload jsonb)', 'service_role'),
    ('public.fn_can_approve(p_business_id uuid, p_amount numeric)', 'service_role'),
    ('public.fn_can_see_notification(p_business_id uuid, p_user_id uuid, p_role text, p_type text, p_created_at timestamp with time zone)', 'authenticated, service_role'),
    ('public.fn_cancel_production_batch(p_batch_id uuid, p_staff_name text, p_return_items jsonb)', 'authenticated, service_role'),
    ('public.fn_complete_production_batch(p_batch_id uuid, p_staff_name text)', 'authenticated, service_role'),
    ('public.fn_contact_allowed(p_business_id uuid, p_phone text, p_email text, p_purpose text)', 'service_role'),
    ('public.fn_create_customer_account(p_uid uuid, p_slug text, p_name text, p_phone text)', 'service_role'),
    ('public.fn_create_production_batch(p_business_id uuid, p_bom_id uuid, p_recipe_name text, p_quantity_produced numeric, p_unit text, p_status text, p_staff_name text, p_date timestamp with time zone)', 'authenticated, service_role'),
    ('public.fn_customer_message(p_account_id uuid, p_order_id uuid, p_body text)', 'service_role'),
    ('public.fn_find_rider(p_business_id uuid, p_name text)', 'service_role'),
    ('public.fn_flag_duplicate_signup()', 'service_role'),
    ('public.fn_in_buying_ctx()', 'service_role'),
    ('public.fn_is_alert_recipient(p_notification notifications, p_user_id uuid)', 'service_role'),
    ('public.fn_method_enabled(p_business_id uuid, p_method text)', 'service_role'),
    ('public.fn_my_display_name(p_business_id uuid)', 'service_role'),
    ('public.fn_my_employee_id(p_business_id uuid)', 'service_role'),
    ('public.fn_my_name()', 'service_role'),
    ('public.fn_my_rider_user(p_business_id uuid)', 'service_role'),
    ('public.fn_my_supplier_id(p_business_id uuid)', 'authenticated, service_role'),
    ('public.fn_my_user_id()', 'service_role'),
    ('public.fn_nairobi_today()', 'service_role'),
    ('public.fn_needs_approval(p_business_id uuid, p_amount numeric)', 'service_role'),
    ('public.fn_next_schedule_date(p_days integer[], p_from date)', 'service_role'),
    ('public.fn_normalize_ke_phone(p_phone text)', 'service_role'),
    ('public.fn_normalize_phone(p_phone text)', 'authenticated, service_role'),
    ('public.fn_notification_recipients(p_business_id uuid, p_user_id uuid, p_role text, p_type text)', 'service_role'),
    ('public.fn_notification_wanted(p_business_id uuid, p_user_id uuid, p_type text, p_direct boolean)', 'service_role'),
    ('public.fn_notify_riders(p_business_id uuid, p_title text, p_message text, p_payload jsonb, p_except_user uuid)', 'service_role'),
    ('public.fn_notify_staff(p_business_id uuid, p_title text, p_message text, p_payload jsonb)', 'service_role'),
    ('public.fn_notify_supplier(p_business_id uuid, p_supplier_id uuid, p_title text, p_message text, p_payload jsonb)', 'service_role'),
    ('public.fn_point_value(p_business_id uuid, p_tier customer_tier)', 'authenticated, service_role'),
    ('public.fn_points_on(p_business_id uuid)', 'authenticated, service_role'),
    ('public.fn_post_money_asset(p_business_id uuid, p_method text, p_delta numeric, p_description text, p_payment_id uuid, p_expense_id uuid, p_recorded_by text)', 'service_role'),
    ('public.fn_promo_value(p_promo website_promo_codes, p_subtotal numeric, p_account_id uuid)', 'service_role'),
    ('public.fn_purchase_guard()', 'service_role'),
    ('public.fn_purchase_item_guard()', 'service_role'),
    ('public.fn_purchase_notify()', 'service_role'),
    ('public.fn_push_new_notification()', 'service_role'),
    ('public.fn_redeem_points(p_customer_id uuid, p_points integer, p_recorded_by text)', 'service_role'),
    ('public.fn_register_product_category()', 'service_role'),
    ('public.fn_role_limit(p_business_id uuid, p_role text)', 'service_role'),
    ('public.fn_schedule_alarm_sync()', 'service_role'),
    ('public.fn_schedule_user(p_employee_id uuid)', 'service_role'),
    ('public.fn_seed_business_expense_categories()', 'service_role'),
    ('public.fn_seed_expense_categories(p_business_id uuid)', 'service_role'),
    ('public.fn_seed_petty_cash_categories(p_business_id uuid)', 'service_role'),
    ('public.fn_settle_online_order_airtel(p_airtel_id uuid)', 'service_role'),
    ('public.fn_settle_online_order_card(p_card_id uuid)', 'service_role'),
    ('public.fn_staff_can_see_account(p_account_id uuid)', 'authenticated, service_role'),
    ('public.fn_supplier_payment_bill()', 'service_role'),
    ('public.fn_supplier_portal_events()', 'service_role'),
    ('public.fn_sync_employee(p_business_id uuid, p_user_id uuid)', 'service_role'),
    ('public.fn_transfer_dispatch(p_transfer_id uuid)', 'service_role'),
    ('public.fn_transfer_go(p_transfer_id uuid)', 'service_role'),
    ('public.fn_transfer_value(p_transfer_id uuid)', 'service_role'),
    ('public.fn_user_has_permission(p_business_id uuid, p_user_id uuid, p_permissions text[])', 'service_role'),
    ('public.fn_wallet_pays_debt(p_customer_id uuid, p_recorded_by text)', 'service_role'),
    ('public.get_business_dashboard_metrics(p_business_id uuid, p_start_date timestamp with time zone, p_end_date timestamp with time zone)', 'authenticated, service_role'),
    ('public.get_business_payments(p_business_id uuid, p_limit integer, p_offset integer)', 'authenticated, service_role'),
    ('public.get_delivery_requests(p_business_id uuid)', 'authenticated, service_role'),
    ('public.get_finance_report(p_business_id uuid, p_start timestamp with time zone, p_end timestamp with time zone)', 'authenticated, service_role'),
    ('public.get_finance_report_till(p_business_id uuid, p_start timestamp with time zone, p_end timestamp with time zone)', 'service_role'),
    ('public.get_money_assets(p_business_id uuid)', 'authenticated, service_role'),
    ('public.get_my_alarms()', 'authenticated, service_role'),
    ('public.get_my_contact_preferences()', 'authenticated, service_role'),
    ('public.get_my_deliveries(p_business_id uuid)', 'authenticated, service_role'),
    ('public.get_my_notification_settings(p_business_id uuid)', 'authenticated, service_role'),
    ('public.get_my_rewards()', 'authenticated, service_role'),
    ('public.get_my_ringing_alerts(p_business_id uuid)', 'authenticated, service_role'),
    ('public.handle_till_payment(p_till_payment_id uuid, p_action text, p_customer_id uuid, p_note text, p_handled_by text)', 'authenticated, service_role'),
    ('public.has_permission(p_business_id uuid, VARIADIC p_permissions text[])', 'authenticated, service_role'),
    ('public.invite_guess_key()', 'service_role'),
    ('public.invite_guesses_left()', 'service_role'),
    ('public.invite_supplier_user(p_supplier_id uuid, p_name text, p_email text, p_phone text)', 'authenticated, service_role'),
    ('public.invoice_ageing(p_business_id uuid)', 'authenticated, service_role'),
    ('public.invoice_sales_order(p_order_id uuid, p_lines jsonb, p_issue_date date, p_terms_days integer, p_notes text)', 'authenticated, service_role'),
    ('public.is_my_employee(p_employee_id uuid)', 'authenticated, service_role'),
    ('public.is_system_creator(p_auth_user_id uuid)', 'authenticated, service_role'),
    ('public.issue_invoice(p_business_id uuid, p_customer_id uuid, p_prefix text, p_issued_at date, p_due_at date, p_balance_due numeric, p_document jsonb, p_created_by text)', 'authenticated, service_role'),
    ('public.kra_next_invoice_no(p_business_id uuid)', 'service_role'),
    ('public.link_till_points(p_redemption_id uuid, p_transaction_id uuid)', 'authenticated, service_role'),
    ('public.list_petty_cash(p_business_id uuid, p_start timestamp with time zone, p_end timestamp with time zone)', 'authenticated, service_role'),
    ('public.list_stock_transfer_lines(p_business_id uuid, p_from timestamp with time zone, p_to timestamp with time zone)', 'authenticated, service_role'),
    ('public.list_stock_transfers(p_business_id uuid, p_limit integer)', 'authenticated, service_role'),
    ('public.list_transfer_branches(p_business_id uuid)', 'authenticated, service_role'),
    ('public.log_mpesa_payment(p_checkout_request_id text, p_merchant_request_id text, p_phone text, p_amount numeric, p_status text, p_receipt_number text, p_business_id uuid, p_raw_callback jsonb)', 'service_role'),
    ('public.log_sizes(p_business_id uuid)', 'authenticated, service_role'),
    ('public.mark_my_messages_read()', 'authenticated, service_role'),
    ('public.mark_quote_sold(p_id uuid, p_transaction_id uuid)', 'authenticated, service_role'),
    ('public.merge_customers(p_keep_id uuid, p_merge_id uuid, p_name text, p_phone text, p_email text)', 'authenticated, service_role'),
    ('public.otp_after_password_reset(p_auth_user_id uuid)', 'service_role'),
    ('public.otp_check(p_email text, p_type text, p_code text, p_consume boolean)', 'service_role'),
    ('public.otp_confirm_signup(p_email text)', 'service_role'),
    ('public.otp_issue(p_email text, p_type text, p_code text)', 'service_role'),
    ('public.otp_lookup_user(p_email text)', 'service_role'),
    ('public.place_online_order(p_items jsonb, p_fulfilment text, p_address text, p_notes text, p_zone_id uuid, p_points integer, p_promo_code text)', 'authenticated, service_role'),
    ('public.place_purchase_order(p_id uuid)', 'authenticated, service_role'),
    ('public.process_business_payment(p_business_id uuid, p_reference_code text, p_amount numeric, p_method text, p_sender_name text, p_sender_phone text, p_status text, p_date timestamp with time zone, p_customer_id uuid, p_customer_name text, p_payment_type text, p_description text, p_recorded_by text)', 'authenticated, service_role'),
    ('public.process_debt_payment(p_business_id uuid, p_customer_id uuid, p_amount numeric, p_method text, p_recorded_by text, p_note text, p_reference_id text)', 'authenticated, service_role'),
    ('public.process_wallet_spend(p_business_id uuid, p_customer_id uuid, p_amount numeric, p_recorded_by text, p_note text, p_reference_id text)', 'authenticated, service_role'),
    ('public.process_wallet_topup(p_business_id uuid, p_customer_id uuid, p_amount numeric, p_recorded_by text, p_note text, p_reference_id text)', 'authenticated, service_role'),
    ('public.purchase_details(p_purchase_id uuid)', 'authenticated, service_role'),
    ('public.quote_to_order(p_quote_id uuid)', 'authenticated, service_role'),
    ('public.receive_purchase(p_purchase_id uuid, p_staff_name text, p_update_cost boolean)', 'authenticated, service_role'),
    ('public.receive_purchase_lines(p_purchase_id uuid, p_lines jsonb, p_note text, p_update_cost boolean)', 'authenticated, service_role'),
    ('public.receive_stock_transfer(p_transfer_id uuid, p_lines jsonb, p_note text)', 'authenticated, service_role'),
    ('public.record_bill_payment(p_bill_id uuid, p_amount numeric, p_method text, p_reference text, p_note text, p_paid_at timestamp with time zone)', 'authenticated, service_role'),
    ('public.record_invoice_payment(p_invoice_id uuid, p_amount numeric, p_method text, p_reference text, p_paid_at timestamp with time zone, p_payment_id uuid)', 'authenticated, service_role'),
    ('public.record_order_checkout(p_order_id uuid, p_checkout_request_id text, p_merchant_request_id text, p_phone text)', 'service_role'),
    ('public.record_petty_cash(p_business_id uuid, p_amount numeric, p_category text, p_description text, p_receipt_ref text, p_reference_id text)', 'authenticated, service_role'),
    ('public.record_supplier_payment(p_business_id uuid, p_supplier_id uuid, p_supplier_name text, p_purchase_id uuid, p_amount numeric, p_method text, p_reference text, p_note text, p_paid_at timestamp with time zone)', 'authenticated, service_role'),
    ('public.record_till_payment(p_raw jsonb)', 'service_role'),
    ('public.redeem_customer_points(p_customer_id uuid, p_points integer, p_recorded_by text)', 'authenticated, service_role'),
    ('public.redeem_my_points(p_points integer)', 'authenticated, service_role'),
    ('public.refresh_dashboard_snapshot(p_business_id uuid, p_date date, p_timeframe text)', 'service_role'),
    ('public.refund_till_points(p_redemption_id uuid)', 'authenticated, service_role'),
    ('public.register_device_token(p_token text, p_platform text, p_sound text)', 'authenticated, service_role'),
    ('public.reject_purchase(p_id uuid, p_reason text)', 'authenticated, service_role'),
    ('public.remove_petty_cash(p_expense_id uuid, p_reason text)', 'authenticated, service_role'),
    ('public.remove_supplier_access(p_account_id uuid, p_invitation_id uuid)', 'authenticated, service_role'),
    ('public.reorder_overview(p_business_id uuid)', 'authenticated, service_role'),
    ('public.request_password_reset_otp(p_email text)', 'service_role'),
    ('public.request_stock_transfer(p_to_business_id uuid, p_from_business_id uuid, p_items jsonb, p_note text)', 'authenticated, service_role'),
    ('public.run_customer_portal_daily()', 'service_role'),
    ('public.run_due_backups()', 'service_role'),
    ('public.sale_refund_lines(p_transaction_id uuid)', 'authenticated, service_role'),
    ('public.sales_docs(p_business_id uuid, p_since date)', 'authenticated, service_role'),
    ('public.save_buying_settings(p_business_id uuid, p_tolerance_pct numeric, p_safety_days integer, p_limits jsonb)', 'authenticated, service_role'),
    ('public.save_otp(p_email text, p_code text, p_type text)', 'service_role'),
    ('public.save_petty_cash_category(p_business_id uuid, p_id uuid, p_name text)', 'authenticated, service_role'),
    ('public.save_quote(p_business_id uuid, p_id uuid, p_doc jsonb)', 'authenticated, service_role'),
    ('public.save_reorder_settings(p_business_id uuid, p_rows jsonb)', 'authenticated, service_role'),
    ('public.save_sales_order(p_business_id uuid, p_id uuid, p_doc jsonb)', 'authenticated, service_role'),
    ('public.save_supplier_quote(p_quote_id uuid, p_lines jsonb, p_delivery_days integer, p_note text)', 'authenticated, service_role'),
    ('public.sd_customer(p_business_id uuid, p_customer_id uuid)', 'service_role'),
    ('public.sd_guard_payment_void()', 'service_role'),
    ('public.sd_invoice_refresh(p_invoice_id uuid)', 'service_role'),
    ('public.sd_lines_json(p_table text, p_fk text, p_id uuid)', 'service_role'),
    ('public.sd_next_no(p_business_id uuid, p_kind text, p_date date)', 'service_role'),
    ('public.sd_norm_lines(p_business_id uuid, p_lines jsonb)', 'service_role'),
    ('public.sd_order_refresh(p_order_id uuid)', 'service_role'),
    ('public.sd_order_totals(p_order_id uuid)', 'service_role'),
    ('public.send_customer_message(p_body text)', 'authenticated, service_role'),
    ('public.send_draft_transfer(p_transfer_id uuid, p_items jsonb)', 'authenticated, service_role'),
    ('public.send_stock_transfer(p_from_business_id uuid, p_to_business_id uuid, p_items jsonb, p_note text, p_reference_id text)', 'authenticated, service_role'),
    ('public.set_customer_payment_terms(p_customer_id uuid, p_terms text)', 'authenticated, service_role'),
    ('public.set_invoice_archived(p_invoice_id uuid, p_archived boolean)', 'authenticated, service_role'),
    ('public.set_my_notification_setting(p_business_id uuid, p_category text, p_enabled boolean)', 'authenticated, service_role'),
    ('public.set_payment_methods(p_business_id uuid, p_methods text[])', 'authenticated, service_role'),
    ('public.set_quote_status(p_id uuid, p_status text)', 'authenticated, service_role'),
    ('public.settle_card_payment(p_reference text, p_success boolean, p_amount_paid numeric, p_provider_reference text, p_card_brand text, p_card_last4 text, p_failure_reason text, p_raw jsonb)', 'service_role'),
    ('public.settle_customer_debt_fifo(p_business_id uuid, p_customer_id uuid, p_amount_paid numeric, p_recorded_by text)', 'authenticated, service_role'),
    ('public.settle_transfer_shortage(p_transfer_id uuid, p_lines jsonb, p_note text)', 'authenticated, service_role'),
    ('public.spend_points_at_till(p_customer_id uuid, p_points integer, p_recorded_by text)', 'authenticated, service_role'),
    ('public.staff_assign_rider(p_order_id uuid, p_rider_id uuid)', 'authenticated, service_role'),
    ('public.staff_clear_order_attention(p_order_id uuid)', 'authenticated, service_role'),
    ('public.staff_mark_customer_messages_read(p_account_id uuid)', 'authenticated, service_role'),
    ('public.staff_send_customer_message(p_account_id uuid, p_body text, p_staff_name text)', 'authenticated, service_role'),
    ('public.staff_update_online_order(p_order_id uuid, p_status text)', 'authenticated, service_role'),
    ('public.stock_period_report(p_business_id uuid, p_from timestamp with time zone, p_to timestamp with time zone)', 'authenticated, service_role'),
    ('public.stock_request_suppliers(p_product_id uuid)', 'authenticated, service_role'),
    ('public.submit_my_review(p_product_id uuid, p_rating integer, p_title text, p_body text)', 'authenticated, service_role'),
    ('public.suggest_product_idea(p_title text, p_description text)', 'authenticated, service_role'),
    ('public.supplier_access_list(p_supplier_id uuid)', 'authenticated, service_role'),
    ('public.supplier_can(p_business_id uuid, p_code text)', 'authenticated, service_role'),
    ('public.supplier_portal_accounts()', 'authenticated, service_role'),
    ('public.supplier_portal_answer_stock_request(p_request_id uuid, p_accept boolean, p_delivery_date date, p_note text)', 'authenticated, service_role'),
    ('public.supplier_portal_confirm(p_purchase_id uuid, p_expected_date date, p_note text)', 'authenticated, service_role'),
    ('public.supplier_portal_data(p_business_id uuid)', 'authenticated, service_role'),
    ('public.supplier_portal_price(p_quote_id uuid, p_lines jsonb, p_delivery_days integer, p_note text)', 'authenticated, service_role'),
    ('public.supplier_portal_stock_requests(p_business_id uuid)', 'authenticated, service_role'),
    ('public.supplier_portal_update_details(p_business_id uuid, p_details jsonb)', 'authenticated, service_role'),
    ('public.supplier_stock_requests_list(p_business_id uuid, p_product_id uuid)', 'authenticated, service_role'),
    ('public.switch_my_store(p_slug text)', 'authenticated, service_role'),
    ('public.transfer_request_catalog(p_to_business_id uuid, p_from_business_id uuid)', 'authenticated, service_role'),
    ('public.unmatched_payments(p_business_id uuid)', 'authenticated, service_role'),
    ('public.unregister_device_token(p_token text)', 'authenticated, service_role'),
    ('public.update_my_account(p_name text, p_phone text, p_address text, p_notes text)', 'authenticated, service_role'),
    ('public.update_my_contact_preferences(p_service boolean, p_promotions boolean)', 'authenticated, service_role'),
    ('public.update_my_profile(p_name text, p_phone text, p_address text, p_building text, p_landmark text, p_notes text, p_zone_id uuid)', 'authenticated, service_role'),
    ('public.update_product_category_bulk(p_business_id uuid, p_old_category text, p_new_category text)', 'authenticated, service_role'),
    ('public.update_team_member(p_business_id uuid, p_user_id uuid, p_name text, p_phone text, p_avatar text, p_role text)', 'authenticated, service_role'),
    ('public.update_user_password_by_email(p_email text, p_new_password text)', 'service_role'),
    ('public.verify_password_reset_otp(p_email text, p_code text)', 'service_role'),
    ('public.verify_signup_otp(p_email text, p_code text)', 'service_role'),
    ('public.void_business_payment(p_payment_id uuid, p_reason text, p_voided_by text)', 'authenticated, service_role'),
    ('public.void_invoice_payment(p_id uuid, p_reason text)', 'authenticated, service_role'),
    ('public.void_sales_invoice(p_id uuid, p_reason text)', 'authenticated, service_role'),
    ('public.void_supplier_bill(p_id uuid, p_reason text)', 'authenticated, service_role'),
    ('public.void_supplier_payment(p_id uuid, p_reason text)', 'authenticated, service_role'),
    ('public.vote_product_idea(p_idea_id uuid, p_vote boolean)', 'authenticated, service_role')
    ) AS t(sig, keep)
    LOOP
        SELECT p.oid::regprocedure INTO v_fn FROM pg_proc p
        WHERE p.pronamespace = 'public'::regnamespace
          AND 'public.' || format('%I(%s)', p.proname, pg_get_function_identity_arguments(p.oid)) = r.sig;
        CONTINUE WHEN v_fn IS NULL;
        EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated', v_fn);
        EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO %s', v_fn, r.keep);
    END LOOP;
END $$;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO service_role;
-- New tables: nothing for anon/authenticated until a migration grants it (RLS does not cover TRUNCATE).
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, authenticated;

-- Views: anon and authenticated keep SELECT where granted; TRUNCATE/TRIGGER/REFERENCES do nothing on a view.
DO $$
DECLARE v record;
BEGIN
    FOR v IN SELECT c.oid::regclass AS rel FROM pg_class c
             WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('v', 'm')
    LOOP
        EXECUTE format('REVOKE TRUNCATE, TRIGGER, REFERENCES ON %s FROM anon, authenticated', v.rel);
    END LOOP;
END $$;

-- ===================================================================
-- 20261201002_sale_totals_check
-- ===================================================================
-- A paid till sale is saved in one step, and its money figures must match its items
-- (security review 2026-11-23, finding FIN-01).
--
-- Before: record_till_sale stored the header totals exactly as the till sent them. A sale
-- could take KSh 200.00 of goods out of stock and book KSh 1.00, with no discount recorded,
-- so the gap showed nowhere. And most paid sales did not use this function at all: the app
-- inserted the header and the items as two requests, so a dropped connection could leave
-- money booked with no items and no stock moved (FIN-02).
--
-- Now record_till_sale checks, within cent rounding:
--   total        = sum of unit price x quantity of the items
--   discount     between 0 and the total
--   final_total  = total - discount + tax, plus up to the delivery fee (charged deliveries)
-- and rejects anything else with a plain message. Quantities must be above 0, prices and
-- discounts not negative. The app sends every paid sale here (same release), so header
-- and items are saved together or not at all.
--
-- A repeat of a sale already saved (same reference_id) returns that sale, as before. If
-- that earlier sale was saved by an older app without its items, the items are added now
-- (what syncOfflineSale did on the client).
--
-- Customer and credit sales (process_customer_transaction, also used by regular orders) get the
-- same check. Older installed apps still insert cash sales directly;
-- direct inserts get the same check once every device has updated (docs/security/threat-register.md, FIN-02).

-- The one check, shared by paid sales (record_till_sale) and customer/credit sales
-- (process_customer_transaction, which regular orders also use). Raises a plain message.
CREATE OR REPLACE FUNCTION public.fn_check_sale_totals(p_total numeric, p_discount numeric, p_tax numeric,
    p_final numeric, p_fee numeric, p_items jsonb)
 RETURNS void
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
DECLARE
    v_lines numeric;
    v_n     integer;
    v_bad   integer;
    v_tol   numeric;
    v_base  numeric;
    v_disc  numeric := COALESCE(p_discount, 0);
    v_tax   numeric := COALESCE(p_tax, 0);
    v_fee   numeric := COALESCE(p_fee, 0);
BEGIN
    IF jsonb_typeof(COALESCE(p_items, '[]'::jsonb)) <> 'array' OR jsonb_array_length(COALESCE(p_items, '[]'::jsonb)) = 0 THEN
        RAISE EXCEPTION 'The cart is empty.';
    END IF;
    SELECT count(*),
           COALESCE(sum(round(x.unit_price * x.quantity, 2)), 0),
           count(*) FILTER (WHERE x.quantity IS NULL OR x.quantity <= 0 OR x.unit_price IS NULL OR x.unit_price < 0
                            OR COALESCE(x.discount_percentage, 0) < 0 OR COALESCE(x.discount_percentage, 0) > 100)
      INTO v_n, v_lines, v_bad
      FROM jsonb_to_recordset(p_items) AS x(unit_price numeric, quantity numeric, discount_percentage numeric);
    IF v_bad > 0 THEN
        RAISE EXCEPTION 'Each item needs a quantity above 0, a price of 0 or more and a discount from 0 to 100%%.';
    END IF;
    IF p_total IS NULL OR p_final IS NULL OR v_disc < 0 OR v_tax < 0 OR v_fee < 0 THEN
        RAISE EXCEPTION 'This sale is missing its total. Please try again.';
    END IF;
    v_tol := 0.01 * v_n + 0.01;
    IF abs(p_total - v_lines) > v_tol THEN
        RAISE EXCEPTION 'The sale total (KSh %) does not match its items (KSh %). Please check the cart and try again.',
            to_char(p_total, 'FM999,999,999,990.00'), to_char(v_lines, 'FM999,999,999,990.00');
    END IF;
    IF v_disc > p_total + v_tol THEN
        RAISE EXCEPTION 'The discount is more than the sale total.';
    END IF;
    v_base := p_total - v_disc + v_tax;
    IF p_final < v_base - v_tol OR p_final > v_base + v_fee + v_tol THEN
        RAISE EXCEPTION 'The amount to pay (KSh %) does not match the items, discount and VAT (KSh %). Please check the cart and try again.',
            to_char(p_final, 'FM999,999,999,990.00'), to_char(v_base, 'FM999,999,999,990.00');
    END IF;
END;
$function$;
REVOKE ALL ON FUNCTION public.fn_check_sale_totals(numeric, numeric, numeric, numeric, numeric, jsonb) FROM PUBLIC, anon;
-- record_till_sale runs as the caller, so signed-in staff need to run the check.
GRANT EXECUTE ON FUNCTION public.fn_check_sale_totals(numeric, numeric, numeric, numeric, numeric, jsonb) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.record_till_sale(p_sale jsonb, p_items jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
    v_id    uuid;
    v_b     uuid := (p_sale->>'business_id')::uuid;
    v_ref   text := NULLIF(p_sale->>'reference_id', '');
    v_total numeric := (p_sale->>'total')::numeric;
    v_disc  numeric := COALESCE((p_sale->>'discount')::numeric, 0);
    v_tax   numeric := COALESCE((p_sale->>'tax')::numeric, 0);
    v_final numeric := (p_sale->>'final_total')::numeric;
    v_fee   numeric := CASE WHEN COALESCE((p_sale->>'is_delivery')::boolean, false)
                            THEN COALESCE((p_sale->>'delivery_fee')::numeric, 0) ELSE 0 END;
BEGIN
    IF jsonb_typeof(COALESCE(p_items, '[]'::jsonb)) <> 'array' OR jsonb_array_length(COALESCE(p_items, '[]'::jsonb)) = 0 THEN
        RAISE EXCEPTION 'The cart is empty.';
    END IF;

    IF v_ref IS NOT NULL THEN
        SELECT id INTO v_id FROM public.transactions WHERE business_id = v_b AND reference_id = v_ref AND deleted_at IS NULL;
        IF FOUND THEN
            -- Saved before by an older app whose items request never arrived: add them now.
            IF NOT EXISTS (SELECT 1 FROM public.transaction_items WHERE transaction_id = v_id) THEN
                INSERT INTO public.transaction_items (transaction_id, product_id, product_name, unit_price, quantity, discount_percentage, line_total)
                SELECT v_id, x.product_id, COALESCE(x.product_name, 'Item'), x.unit_price, x.quantity, COALESCE(x.discount_percentage, 0),
                       round(x.unit_price * (1 - COALESCE(x.discount_percentage, 0) / 100) * x.quantity, 2)
                FROM jsonb_to_recordset(p_items) AS x(product_id uuid, product_name text, unit_price numeric, quantity numeric, discount_percentage numeric);
            END IF;
            RETURN v_id;
        END IF;
    END IF;

    IF COALESCE(p_sale->>'payment_method', '') IN ('Credit', 'Credit_Debt') THEN
        RAISE EXCEPTION 'Credit sales are saved with process_customer_transaction.';
    END IF;

    PERFORM public.fn_check_sale_totals(v_total, v_disc, v_tax, v_final, v_fee, p_items);

    INSERT INTO public.transactions (id, business_id, total, discount, tax, final_total, amount_paid, wallet_applied,
        payment_method, customer_id, customer_name, staff_id, staff_name, status, timestamp, note, is_delivery,
        delivery_fee, delivery_mode, rider_pay, rider_name, reference_id, promotion_redemption_id)
    VALUES (COALESCE((p_sale->>'id')::uuid, gen_random_uuid()), v_b,
        v_total, v_disc, v_tax, v_final, v_final, 0,
        (p_sale->>'payment_method')::public.payment_method, (p_sale->>'customer_id')::uuid, NULLIF(p_sale->>'customer_name', ''),
        (p_sale->>'staff_id')::uuid, COALESCE(p_sale->>'staff_name', 'Staff'), 'Synced',
        COALESCE((p_sale->>'timestamp')::timestamptz, now()), p_sale->>'note', COALESCE((p_sale->>'is_delivery')::boolean, false),
        COALESCE((p_sale->>'delivery_fee')::numeric, 0),
        CASE WHEN COALESCE((p_sale->>'is_delivery')::boolean, false) THEN COALESCE(p_sale->>'delivery_mode', 'charged') ELSE 'charged' END,
        CASE WHEN COALESCE((p_sale->>'is_delivery')::boolean, false) THEN GREATEST(COALESCE((p_sale->>'rider_pay')::numeric, 0), 0) ELSE 0 END,
        NULLIF(p_sale->>'rider_name', ''), v_ref, (p_sale->>'promotion_redemption_id')::uuid)
    RETURNING id INTO v_id;
    INSERT INTO public.transaction_items (transaction_id, product_id, product_name, unit_price, quantity, discount_percentage, line_total)
    SELECT v_id, x.product_id, COALESCE(x.product_name, 'Item'), x.unit_price, x.quantity, COALESCE(x.discount_percentage, 0),
           round(x.unit_price * (1 - COALESCE(x.discount_percentage, 0) / 100) * x.quantity, 2)
    FROM jsonb_to_recordset(p_items) AS x(product_id uuid, product_name text, unit_price numeric, quantity numeric, discount_percentage numeric);
    RETURN v_id;
END;
$function$;

-- Customer and credit sales: the same check, right after the repeat check. Otherwise unchanged.
CREATE OR REPLACE FUNCTION public.process_customer_transaction(p_business_id uuid, p_customer_id uuid, p_customer_name text, p_staff_id uuid, p_staff_name text, p_total numeric, p_discount numeric, p_tax numeric, p_final_total numeric, p_amount_paid numeric, p_payment_method payment_method, p_timestamp timestamp with time zone, p_note text, p_is_delivery boolean, p_delivery_fee numeric, p_rider_name text, p_reference_id text, p_items jsonb, p_delivery_mode text DEFAULT 'charged'::text, p_rider_pay numeric DEFAULT 0, p_promotion_redemption_id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    PERFORM public.assert_permission(p_business_id, 'pos.create_sale');
    PERFORM public.assert_business_member(p_business_id); IF p_customer_id IS NOT NULL THEN PERFORM public.assert_business_member((SELECT business_id FROM public.customers WHERE id = p_customer_id)); END IF; PERFORM public.assert_business_member(pr.business_id) FROM public.products pr WHERE pr.id IN (SELECT (e->>'product_id')::UUID FROM jsonb_array_elements(COALESCE(p_items, '[]'::JSONB)) e WHERE e->>'product_id' IS NOT NULL);
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

    -- The money figures must match the items (20261201002).
    PERFORM public.fn_check_sale_totals(p_total, p_discount, p_tax, p_final_total,
        CASE WHEN COALESCE(p_is_delivery, FALSE) THEN COALESCE(p_delivery_fee, 0) ELSE 0 END, p_items);

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
         delivery_fee, rider_name, reference_id, delivery_mode, rider_pay, promotion_redemption_id)
    VALUES (
        p_business_id, p_total, p_discount, p_tax, p_final_total,
        p_amount_paid, v_wallet_used, p_payment_method, p_customer_id,
        p_customer_name, p_staff_id, p_staff_name, 'Synced',
        COALESCE(p_timestamp, NOW()), p_note, COALESCE(p_is_delivery, FALSE),
        COALESCE(p_delivery_fee, 0), p_rider_name, p_reference_id,
        CASE WHEN COALESCE(p_is_delivery, FALSE) THEN COALESCE(p_delivery_mode, 'charged') ELSE 'charged' END,
        CASE WHEN COALESCE(p_is_delivery, FALSE) THEN GREATEST(COALESCE(p_rider_pay, 0), 0) ELSE 0 END,
        p_promotion_redemption_id
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
        -- credit record: created by the sale trigger, once per sale

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
$function$;

-- ===================================================================
-- 20261201003_ops_watchdog
-- ===================================================================
-- Phase 5: the database checks itself every 10 minutes and tells Telegram (through the
-- ops-alert function) when something is wrong, and again when it is fixed.
--
-- Checks (ops_watchdog_checks):
--   cron:<job>        a scheduled job's latest run failed
--   payments:mpesa    M-Pesa prompts with no answer from Safaricom after N minutes
--   payments:airtel   the same for Airtel Money
--   payments:card     card payments with no answer from Paystack
--   edge:calls        calls from the database to edge functions failing (pg_net)
--   db:size           database over 80% of the plan's size
--   db:connections    connections over 80% of the maximum
--
-- A problem is sent once, then again every realert_hours while it lasts; "fixed" is sent when
-- it clears. Each run stamps ops_watchdog_config.last_run_at; the public health check
-- (GET ops-alert) answers 503 when that is over 30 minutes old, so the outside uptime monitor
-- also notices if this job itself stops.
--
-- Settings (SQL editor): UPDATE ops_watchdog_config SET db_size_limit_mb = 8192;  -- Pro plan
-- Test on purpose:       SELECT public.run_ops_watchdog(true);  -- sends every current check

CREATE TABLE IF NOT EXISTS public.ops_watchdog_config (
    id boolean PRIMARY KEY DEFAULT true CHECK (id),
    db_size_limit_mb integer NOT NULL DEFAULT 500,       -- Supabase Free plan
    payment_stuck_minutes integer NOT NULL DEFAULT 30,
    edge_failures_threshold integer NOT NULL DEFAULT 3,  -- failed calls in 15 minutes
    realert_hours integer NOT NULL DEFAULT 6,
    last_run_at timestamptz
);
INSERT INTO public.ops_watchdog_config (id) VALUES (true) ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS public.ops_watchdog_state (
    check_key text PRIMARY KEY,
    problem text,                 -- NULL when fine
    first_seen_at timestamptz,
    last_alerted_at timestamptz,
    updated_at timestamptz NOT NULL DEFAULT now()
);

-- Server only: no app role reads or writes these.
ALTER TABLE public.ops_watchdog_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ops_watchdog_state ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ops_watchdog_config, public.ops_watchdog_state FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.ops_watchdog_config, public.ops_watchdog_state TO service_role;


CREATE OR REPLACE FUNCTION public.ops_watchdog_checks()
RETURNS TABLE(check_key text, problem text)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
    c public.ops_watchdog_config;
    v_n integer;
    v_oldest timestamptz;
    v_msg text;
    v_size bigint;
    v_max integer;
BEGIN
    SELECT * INTO c FROM public.ops_watchdog_config WHERE id;

    -- Scheduled jobs: the latest run of each active job, if it failed in the last day.
    IF to_regclass('cron.job_run_details') IS NOT NULL THEN
        RETURN QUERY
        SELECT 'cron:' || j.jobname,
               CASE WHEN d.status = 'failed'
                    THEN 'Scheduled job "' || j.jobname || '" failed at '
                         || to_char(d.end_time AT TIME ZONE 'Africa/Nairobi', 'DD Mon HH24:MI')
                         || ': ' || left(COALESCE(d.return_message, '(no message)'), 200)
               END
        FROM cron.job j
        LEFT JOIN LATERAL (
            SELECT r.status, r.end_time, r.return_message
            FROM cron.job_run_details r
            WHERE r.jobid = j.jobid AND r.start_time > now() - interval '1 day'
            ORDER BY r.start_time DESC LIMIT 1
        ) d ON true
        WHERE j.active AND j.jobname IS NOT NULL;
    END IF;

    -- Payments waiting for the provider's answer (callback) for too long. Only the last day,
    -- so an abandoned prompt doesn't ring forever.
    SELECT count(*), min(created_at) INTO v_n, v_oldest FROM public.mpesa_transactions
    WHERE status = 'Pending'
      AND created_at < now() - make_interval(mins => c.payment_stuck_minutes)
      AND created_at > now() - interval '1 day';
    check_key := 'payments:mpesa';
    problem := CASE WHEN v_n > 0 THEN v_n || ' M-Pesa prompt(s) have had no answer from Safaricom for over '
        || c.payment_stuck_minutes || ' min (oldest ' || to_char(v_oldest AT TIME ZONE 'Africa/Nairobi', 'DD Mon HH24:MI')
        || '). Check mpesa-webhook logs and the callback URL.' END;
    RETURN NEXT;

    SELECT count(*), min(created_at) INTO v_n, v_oldest FROM public.airtel_transactions
    WHERE status = 'Pending'
      AND created_at < now() - make_interval(mins => c.payment_stuck_minutes)
      AND created_at > now() - interval '1 day';
    check_key := 'payments:airtel';
    problem := CASE WHEN v_n > 0 THEN v_n || ' Airtel Money payment(s) have had no answer for over '
        || c.payment_stuck_minutes || ' min (oldest ' || to_char(v_oldest AT TIME ZONE 'Africa/Nairobi', 'DD Mon HH24:MI')
        || '). Check airtel-callback logs.' END;
    RETURN NEXT;

    SELECT count(*), min(created_at) INTO v_n, v_oldest FROM public.card_payments
    WHERE status = 'pending'
      AND created_at < now() - make_interval(mins => c.payment_stuck_minutes)
      AND created_at > now() - interval '1 day';
    check_key := 'payments:card';
    problem := CASE WHEN v_n > 0 THEN v_n || ' card payment(s) have had no answer from Paystack for over '
        || c.payment_stuck_minutes || ' min (oldest ' || to_char(v_oldest AT TIME ZONE 'Africa/Nairobi', 'DD Mon HH24:MI')
        || '). Check card-webhook logs.' END;
    RETURN NEXT;

    -- Calls the database makes to edge functions (pushes, backups, crash alerts, rings).
    check_key := 'edge:calls';
    problem := NULL;
    IF to_regclass('net._http_response') IS NOT NULL THEN
        SELECT count(*),
               max(COALESCE(status_code::text, '') || ' ' || left(COALESCE(error_msg, content::text, ''), 120))
        INTO v_n, v_msg
        FROM net._http_response
        WHERE created > now() - interval '15 minutes'
          AND (status_code >= 500 OR error_msg IS NOT NULL OR timed_out);
        IF v_n >= c.edge_failures_threshold THEN
            problem := v_n || ' calls from the database to edge functions failed in the last 15 min. Example: '
                || trim(v_msg) || '. Check Edge Functions → Logs.';
        END IF;
    END IF;
    RETURN NEXT;

    v_size := pg_database_size(current_database());
    check_key := 'db:size';
    problem := CASE WHEN v_size > c.db_size_limit_mb::bigint * 1024 * 1024 * 0.8
        THEN 'Database is ' || pg_size_pretty(v_size) || ', over 80% of the ' || c.db_size_limit_mb
             || ' MB plan limit. Delete old logs or upgrade the plan.' END;
    RETURN NEXT;

    SELECT count(*) INTO v_n FROM pg_stat_activity;
    v_max := current_setting('max_connections')::integer;
    check_key := 'db:connections';
    problem := CASE WHEN v_n >= v_max * 0.8
        THEN v_n || ' of ' || v_max || ' database connections in use.' END;
    RETURN NEXT;
END;
$$;


-- p_send_all: send every check now, fine or not (to test the alert path on purpose).
CREATE OR REPLACE FUNCTION public.run_ops_watchdog(p_send_all boolean DEFAULT false)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
    c public.ops_watchdog_config;
    r record;
    v_prev public.ops_watchdog_state;
    v_problems jsonb := '[]'::jsonb;
    v_fixed jsonb := '[]'::jsonb;
    v_alert_keys text[] := '{}';
    v_url text;
    v_key text;
BEGIN
    UPDATE public.ops_watchdog_config SET last_run_at = now() WHERE id RETURNING * INTO c;

    FOR r IN SELECT * FROM public.ops_watchdog_checks() LOOP
        SELECT * INTO v_prev FROM public.ops_watchdog_state s WHERE s.check_key = r.check_key;

        IF r.problem IS NOT NULL AND (
               p_send_all OR v_prev.problem IS NULL OR v_prev.last_alerted_at IS NULL
               OR v_prev.last_alerted_at < now() - make_interval(hours => c.realert_hours)) THEN
            v_problems := v_problems || jsonb_build_object('key', r.check_key, 'problem', r.problem,
                'since', COALESCE(v_prev.first_seen_at, now()));
            v_alert_keys := v_alert_keys || r.check_key;
        ELSIF r.problem IS NULL AND v_prev.problem IS NOT NULL THEN
            v_fixed := v_fixed || jsonb_build_object('key', r.check_key, 'problem', v_prev.problem,
                'since', v_prev.first_seen_at);
        END IF;

        INSERT INTO public.ops_watchdog_state AS s (check_key, problem, first_seen_at, updated_at)
        VALUES (r.check_key, r.problem, CASE WHEN r.problem IS NOT NULL THEN now() END, now())
        ON CONFLICT (check_key) DO UPDATE SET
            problem = EXCLUDED.problem,
            first_seen_at = CASE WHEN EXCLUDED.problem IS NULL THEN NULL
                                 ELSE COALESCE(s.first_seen_at, now()) END,
            last_alerted_at = CASE WHEN EXCLUDED.problem IS NULL THEN NULL ELSE s.last_alerted_at END,
            updated_at = now();
    END LOOP;

    IF jsonb_array_length(v_problems) = 0 AND jsonb_array_length(v_fixed) = 0 AND NOT p_send_all THEN
        RETURN 0;
    END IF;

    SELECT decrypted_secret INTO v_url FROM vault.decrypted_secrets WHERE name = 'project_url';
    SELECT decrypted_secret INTO v_key FROM vault.decrypted_secrets WHERE name = 'service_role_key';
    IF v_url IS NULL OR v_key IS NULL THEN
        -- Not marked as alerted, so it is sent once the secrets are set.
        RAISE WARNING 'run_ops_watchdog: Vault secrets project_url and service_role_key are not set; % problem(s) not sent.',
            jsonb_array_length(v_problems);
        RETURN 0;
    END IF;

    PERFORM net.http_post(
        url := rtrim(v_url, '/') || '/functions/v1/ops-alert',
        headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_key),
        body := jsonb_build_object('action', 'watchdog', 'problems', v_problems, 'fixed', v_fixed,
                                   'test', p_send_all),
        timeout_milliseconds := 15000
    );

    UPDATE public.ops_watchdog_state SET last_alerted_at = now() WHERE check_key = ANY (v_alert_keys);
    RETURN jsonb_array_length(v_problems) + jsonb_array_length(v_fixed);
END;
$$;

REVOKE ALL ON FUNCTION public.ops_watchdog_checks() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.run_ops_watchdog(boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ops_watchdog_checks() TO service_role;
GRANT EXECUTE ON FUNCTION public.run_ops_watchdog(boolean) TO service_role;

-- The health check reads only this: when the watchdog last ran (no details, it is public).
CREATE OR REPLACE FUNCTION public.ops_watchdog_heartbeat()
RETURNS jsonb
LANGUAGE sql SECURITY DEFINER STABLE
SET search_path TO 'public'
AS $$
    SELECT jsonb_build_object(
        'last_run_at', (SELECT last_run_at FROM public.ops_watchdog_config WHERE id),
        'open_problems', (SELECT count(*) FROM public.ops_watchdog_state WHERE problem IS NOT NULL));
$$;
REVOKE ALL ON FUNCTION public.ops_watchdog_heartbeat() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ops_watchdog_heartbeat() TO service_role;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
        PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'ops-watchdog';
        PERFORM cron.schedule('ops-watchdog', '*/10 * * * *', $job$SELECT public.run_ops_watchdog()$job$);
    END IF;
END;
$$;

-- ===================================================================
-- 20261201004_abuse_limits
-- ===================================================================
-- Phase 6: notice abuse, and stop promo codes being guessed.
--
-- 1. security_events: one row each time a public function turns a caller away (wrong callback
--    token, bad Paystack signature, IP not on the allow-list, body too large), and the first
--    time in a window that a rate limit blocks a key. Server only; kept 30 days.
-- 2. check_rate_limit records that first block. Behaviour is otherwise unchanged.
-- 3. check_promo_code: at most 20 wrong codes per caller IP per 15 minutes. A wrong code now
--    returns {"error": ...} instead of raising, because raising would also undo the counter.
--    The website reads the new answer (website/src/api.ts checkPromoCode).
-- 4. The Phase 5 watchdog gains two checks, abuse:refused and abuse:rate_limited. The existing
--    checks are kept as they were (renamed ops_watchdog_core_checks) and not rewritten.
-- 5. A daily job deletes events over 30 days old and rate-limit windows over 2 days old.
--
-- Settings (SQL editor):
--   UPDATE ops_watchdog_config SET abuse_refused_threshold = 10, abuse_limited_threshold = 20;

-- 1 ───────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.security_events (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    created_at timestamptz NOT NULL DEFAULT now(),
    kind text NOT NULL,      -- bad_token | bad_signature | ip_not_allowed | too_large | rate_limited
    source text NOT NULL,    -- function name, or the rate-limit key's prefix (otp, mail, promo, ...)
    ip text,
    detail text              -- rate_limited: the key (may hold an email or phone); never a secret
);
CREATE INDEX IF NOT EXISTS security_events_created_at_idx ON public.security_events (created_at);

ALTER TABLE public.security_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.security_events FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, DELETE ON public.security_events TO service_role;

CREATE INDEX IF NOT EXISTS rate_limits_window_start_idx ON public.rate_limits (window_start);

-- Called by edge functions (shared/guard.ts securityEvent). Capped at 1000 rows an hour, so a
-- flood of bad calls can't fill the database.
CREATE OR REPLACE FUNCTION public.log_security_event(p_kind text, p_source text, p_ip text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
    IF NOT public.check_rate_limit('security_events', 1000, 3600) THEN
        RETURN;
    END IF;
    INSERT INTO public.security_events (kind, source, ip)
    VALUES (left(COALESCE(p_kind, '?'), 40), left(COALESCE(p_source, '?'), 40), left(p_ip, 64));
END;
$$;
REVOKE ALL ON FUNCTION public.log_security_event(text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.log_security_event(text, text, text) TO service_role;

-- 2 ───────────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.check_rate_limit(p_key text, p_limit integer, p_window_seconds integer)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
    v_count INTEGER;
BEGIN
    INSERT INTO public.rate_limits AS r (key, window_start, count)
    VALUES (p_key, NOW(), 1)
    ON CONFLICT (key) DO UPDATE SET
        count        = CASE WHEN r.window_start < NOW() - make_interval(secs => p_window_seconds) THEN 1 ELSE r.count + 1 END,
        window_start = CASE WHEN r.window_start < NOW() - make_interval(secs => p_window_seconds) THEN NOW() ELSE r.window_start END
    RETURNING count INTO v_count;

    -- The first refusal in this window is noted for the watchdog (not every one, so a flood
    -- adds one row per key, not thousands). The event cap's own key is left out.
    IF v_count = p_limit + 1 AND p_key <> 'security_events' THEN
        INSERT INTO public.security_events (kind, source, detail)
        VALUES ('rate_limited', left(split_part(p_key, ':', 1), 40), left(p_key, 120));
    END IF;

    RETURN v_count <= p_limit;
END;
$$;
-- Grants unchanged (service_role only, 20261201001); CREATE OR REPLACE keeps them.

-- 3 ───────────────────────────────────────────────────────────────────────────────────────
-- The caller's IP as the API gateway passed it on (first trusted header wins).
CREATE OR REPLACE FUNCTION public.request_ip()
RETURNS text
LANGUAGE sql STABLE
AS $$
    SELECT COALESCE(
        NULLIF(TRIM(split_part(COALESCE(
            current_setting('request.headers', TRUE)::json->>'cf-connecting-ip',
            current_setting('request.headers', TRUE)::json->>'x-real-ip',
            current_setting('request.headers', TRUE)::json->>'x-forwarded-for',
            ''), ',', 1)), ''),
        'unknown');
$$;
REVOKE ALL ON FUNCTION public.request_ip() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.request_ip() TO service_role;

CREATE OR REPLACE FUNCTION public.check_promo_code(p_slug text, p_code text, p_subtotal numeric)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
    v_promo public.website_promo_codes%ROWTYPE;
    v_value NUMERIC;
    v_key text := 'promo:ip:' || public.request_ip();
BEGIN
    IF EXISTS (SELECT 1 FROM public.rate_limits
               WHERE key = v_key AND window_start > NOW() - INTERVAL '15 minutes' AND count >= 20) THEN
        PERFORM public.check_rate_limit(v_key, 20, 900);  -- counts this try; notes the first refusal
        RETURN jsonb_build_object('error', 'Too many wrong codes. Please wait 15 minutes and try again.');
    END IF;

    SELECT pc.* INTO v_promo
    FROM public.website_promo_codes pc
    JOIN public.businesses b ON b.id = pc.business_id
    WHERE b.website_slug = p_slug AND b.deleted_at IS NULL
      AND pc.code = upper(trim(COALESCE(p_code, '')));
    IF NOT FOUND THEN
        PERFORM public.check_rate_limit(v_key, 20, 900);
        RETURN jsonb_build_object('error', 'We don''t recognise that promo code.');
    END IF;

    v_value := public.fn_promo_value(v_promo, COALESCE(p_subtotal, 0), auth.uid());
    RETURN jsonb_build_object(
        'code', v_promo.code,
        'description', v_promo.description,
        'kind', v_promo.kind,
        'value', v_promo.value,
        'saving', v_value
    );
END;
$$;
-- Grants unchanged (anon + authenticated, it is the website's); CREATE OR REPLACE keeps them.

-- 4 ───────────────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.ops_watchdog_config
    ADD COLUMN IF NOT EXISTS abuse_refused_threshold integer NOT NULL DEFAULT 10,  -- per hour
    ADD COLUMN IF NOT EXISTS abuse_limited_threshold integer NOT NULL DEFAULT 20;  -- per hour

DO $$
BEGIN
    IF to_regprocedure('public.ops_watchdog_core_checks()') IS NULL THEN
        ALTER FUNCTION public.ops_watchdog_checks() RENAME TO ops_watchdog_core_checks;
    END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.ops_watchdog_checks()
RETURNS TABLE(check_key text, problem text)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
    c public.ops_watchdog_config;
    v_n integer;
    v_top text;
BEGIN
    RETURN QUERY SELECT * FROM public.ops_watchdog_core_checks();

    SELECT * INTO c FROM public.ops_watchdog_config WHERE id;

    -- Callers turned away by the public functions (wrong token, bad signature, ...).
    SELECT count(*) INTO v_n FROM public.security_events
    WHERE kind <> 'rate_limited' AND created_at > now() - interval '1 hour';
    check_key := 'abuse:refused';
    problem := NULL;
    IF v_n >= c.abuse_refused_threshold THEN
        SELECT string_agg(x.label, ', ') INTO v_top FROM (
            SELECT source || ' ' || kind || ' x' || count(*)
                   || COALESCE(' (IP ' || (array_agg(ip ORDER BY created_at DESC))[1] || ')', '') AS label
            FROM public.security_events
            WHERE kind <> 'rate_limited' AND created_at > now() - interval '1 hour'
            GROUP BY source, kind ORDER BY count(*) DESC LIMIT 3) x;
        problem := v_n || ' calls were refused in the last hour: ' || v_top
            || '. If a callback token leaked, change it (MPESA_CALLBACK_TOKEN / USSD_CALLBACK_TOKEN) and update the provider.';
    END IF;
    RETURN NEXT;

    -- Rate limits that started blocking (one row per key per window).
    SELECT count(*) INTO v_n FROM public.security_events
    WHERE kind = 'rate_limited' AND created_at > now() - interval '1 hour';
    check_key := 'abuse:rate_limited';
    problem := NULL;
    IF v_n >= c.abuse_limited_threshold THEN
        SELECT string_agg(x.label, ', ') INTO v_top FROM (
            SELECT source || ' x' || count(*) AS label
            FROM public.security_events
            WHERE kind = 'rate_limited' AND created_at > now() - interval '1 hour'
            GROUP BY source ORDER BY count(*) DESC LIMIT 3) x;
        problem := v_n || ' callers hit a rate limit in the last hour (' || v_top
            || '). Look at security_events for the keys; it may be a bot or one shop with a busy day.';
    END IF;
    RETURN NEXT;
END;
$$;
REVOKE ALL ON FUNCTION public.ops_watchdog_checks() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ops_watchdog_core_checks() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ops_watchdog_checks() TO service_role;
GRANT EXECUTE ON FUNCTION public.ops_watchdog_core_checks() TO service_role;

-- 5 ───────────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.purge_security_data()
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
    v_events integer;
    v_limits integer;
BEGIN
    DELETE FROM public.security_events WHERE created_at < now() - interval '30 days';
    GET DIAGNOSTICS v_events = ROW_COUNT;
    -- The longest window any limit uses is one day.
    DELETE FROM public.rate_limits WHERE window_start < now() - interval '2 days';
    GET DIAGNOSTICS v_limits = ROW_COUNT;
    RETURN v_events + v_limits;
END;
$$;
REVOKE ALL ON FUNCTION public.purge_security_data() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purge_security_data() TO service_role;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
        PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'purge-security-data';
        PERFORM cron.schedule('purge-security-data', '20 0 * * *', $job$SELECT public.purge_security_data()$job$);
    END IF;
END;
$$;

-- ===================================================================
-- 20261201005_permission_cache
-- ===================================================================
-- Phase 8: faster row security. Same answers, worked out once per request instead of once per row.
--
-- Row security calls has_permission(business_id, ...) and fn_can_see_notification(...) for every
-- row a query looks at, and each call does 2-4 lookups. On live (2026-11-23) the sales list with
-- its lines took 0.65-1 s on average for 45 sales; on a branch with 50,000 sales a cashier waited
-- 1.7 s for it (docs/deployment/performance.md).
--
-- Each answer is now kept for the rest of the current transaction (set_config(..., true)).
-- PostgREST runs every API request in its own transaction, so the memory never outlives one
-- request: a permission change or a removed member takes effect on the next request, as before.
-- The key holds the signed-in user, so switching user inside one transaction (tests) is safe.
-- Any change to memberships, users or permissions in the same transaction (create a business,
-- accept an invite, edit Roles) bumps a counter that is part of every key, so nothing stale is
-- ever read back.
-- Callers that are not anon/authenticated (service role, SECURITY DEFINER code run as owner)
-- still return TRUE before any lookup, unchanged.
-- Also: an index for the notification list (newest first per business).

-- The counter: part of every cache key; bumped by any write to the tables the answers read.
CREATE OR REPLACE FUNCTION public.fn_perm_cache_gen()
 RETURNS text
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $$ SELECT COALESCE(NULLIF(current_setting('isms_hp.gen', TRUE), ''), '0') $$;
-- Called only from the SECURITY DEFINER functions below (as their owner), as on live by default.
REVOKE ALL ON FUNCTION public.fn_perm_cache_gen() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.fn_perm_cache_bump()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $$
BEGIN
    -- Runs as whoever made the change (e.g. a manager on the Roles screen), so it reads the
    -- counter itself rather than calling fn_perm_cache_gen(), which they can't execute.
    PERFORM set_config('isms_hp.gen',
        (COALESCE(NULLIF(current_setting('isms_hp.gen', TRUE), ''), '0')::bigint + 1)::text, TRUE);
    RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.fn_perm_cache_bump() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_perm_cache_bump ON public.business_memberships;
CREATE TRIGGER trg_perm_cache_bump AFTER INSERT OR UPDATE OR DELETE OR TRUNCATE ON public.business_memberships
  FOR EACH STATEMENT EXECUTE FUNCTION public.fn_perm_cache_bump();
DROP TRIGGER IF EXISTS trg_perm_cache_bump ON public.role_permissions;
CREATE TRIGGER trg_perm_cache_bump AFTER INSERT OR UPDATE OR DELETE OR TRUNCATE ON public.role_permissions
  FOR EACH STATEMENT EXECUTE FUNCTION public.fn_perm_cache_bump();
DROP TRIGGER IF EXISTS trg_perm_cache_bump ON public.role_default_permissions;
CREATE TRIGGER trg_perm_cache_bump AFTER INSERT OR UPDATE OR DELETE OR TRUNCATE ON public.role_default_permissions
  FOR EACH STATEMENT EXECUTE FUNCTION public.fn_perm_cache_bump();
DROP TRIGGER IF EXISTS trg_perm_cache_bump ON public.users;
CREATE TRIGGER trg_perm_cache_bump AFTER INSERT OR UPDATE OR DELETE OR TRUNCATE ON public.users
  FOR EACH STATEMENT EXECUTE FUNCTION public.fn_perm_cache_bump();

-- My active businesses (used by many policies as business_id = ANY(get_user_business_ids())).
CREATE OR REPLACE FUNCTION public.get_user_business_ids()
 RETURNS uuid[]
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_ids UUID[];
    v_key TEXT;
    v_hit TEXT;
BEGIN
    v_key := 'isms_hp.b' || md5(COALESCE(auth.uid()::text, '-') || '|' || public.fn_perm_cache_gen());
    v_hit := current_setting(v_key, TRUE);
    IF v_hit IS NOT NULL AND v_hit <> '' THEN
        RETURN v_hit::uuid[];
    END IF;

    SELECT array_agg(bm.business_id)
    INTO v_ids
    FROM public.business_memberships bm
    JOIN public.users u ON bm.user_id = u.id
    WHERE u.auth_user_id = auth.uid()
      AND bm.status = 'Active';

    v_ids := COALESCE(v_ids, ARRAY[]::UUID[]);
    PERFORM set_config(v_key, v_ids::text, TRUE);
    RETURN v_ids;
END;
$function$;

CREATE OR REPLACE FUNCTION public.has_permission(p_business_id uuid, VARIADIC p_permissions text[])
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_role TEXT;
    v_code TEXT;
    v_granted BOOLEAN;
    v_key TEXT;
    v_hit TEXT;
    v_result BOOLEAN := FALSE;
BEGIN
    IF COALESCE(current_setting('role', TRUE), 'none') NOT IN ('anon', 'authenticated') THEN
        RETURN TRUE;
    END IF;

    -- Already answered in this request?
    v_key := 'isms_hp.k' || md5(COALESCE(auth.uid()::text, '-') || '|' || COALESCE(p_business_id::text, '-')
                                || '|' || array_to_string(p_permissions, ',') || '|' || public.fn_perm_cache_gen());
    v_hit := current_setting(v_key, TRUE);
    IF v_hit IN ('t', 'f') THEN
        RETURN v_hit = 't';
    END IF;

    SELECT bm.role::TEXT INTO v_role
    FROM public.business_memberships bm
    JOIN public.users u ON u.id = bm.user_id
    WHERE u.auth_user_id = auth.uid()
      AND bm.business_id = p_business_id
      AND bm.status = 'Active';

    IF v_role IS NULL THEN
        v_result := FALSE;
    ELSIF v_role IN ('Owner', 'Admin', 'Administrator') THEN
        v_result := TRUE;
    ELSE
        FOREACH v_code IN ARRAY p_permissions LOOP
            SELECT rp.granted INTO v_granted
            FROM public.role_permissions rp
            WHERE rp.business_id = p_business_id AND rp.role::TEXT = v_role AND rp.permission = v_code;

            IF COALESCE(v_granted, v_code = ANY(
                COALESCE((SELECT d.permissions FROM public.role_default_permissions d WHERE d.role = v_role), '{}')
            )) THEN
                v_result := TRUE;
                EXIT;
            END IF;
        END LOOP;
    END IF;

    PERFORM set_config(v_key, CASE WHEN v_result THEN 't' ELSE 'f' END, TRUE);
    RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_can_see_notification(p_business_id uuid, p_user_id uuid, p_role text, p_type text, p_created_at timestamp with time zone)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_me     UUID;
    v_role   TEXT;
    v_joined TIMESTAMPTZ;
    v_perms  TEXT[];
    v_gated  BOOLEAN;
    v_key    TEXT;
    v_hit    TEXT;
    v_ok     BOOLEAN;
BEGIN
    -- Who I am in this business: looked up once per request.
    v_key := 'isms_cn.m' || md5(COALESCE(auth.uid()::text, '-') || '|' || COALESCE(p_business_id::text, '-')
                                || '|' || public.fn_perm_cache_gen());
    v_hit := current_setting(v_key, TRUE);
    IF v_hit IS NOT NULL AND v_hit <> '' THEN
        IF v_hit = '-' THEN
            RETURN FALSE;
        END IF;
        v_me := split_part(v_hit, '|', 1)::uuid;
        v_role := split_part(v_hit, '|', 2);
        v_joined := NULLIF(split_part(v_hit, '|', 3), '')::timestamptz;
    ELSE
        SELECT u.id, m.role::TEXT, m.joined_at INTO v_me, v_role, v_joined
        FROM public.users u
        JOIN public.business_memberships m ON m.user_id = u.id
        WHERE u.auth_user_id = auth.uid() AND m.business_id = p_business_id AND m.status = 'Active';
        PERFORM set_config(v_key,
            CASE WHEN v_me IS NULL THEN '-' ELSE v_me::text || '|' || v_role || '|' || COALESCE(v_joined::text, '') END,
            TRUE);
    END IF;

    IF v_me IS NULL THEN
        RETURN FALSE;
    END IF;
    IF p_user_id IS NOT NULL THEN
        RETURN p_user_id = v_me;
    END IF;
    IF p_created_at < v_joined THEN
        RETURN FALSE;
    END IF;

    -- Whether my role may see this kind of notification: once per type per request.
    v_key := 'isms_cn.t' || md5(v_me::text || '|' || p_business_id::text || '|' || COALESCE(p_type, '-')
                                || '|' || COALESCE(p_role, '-') || '|' || public.fn_perm_cache_gen());
    v_hit := current_setting(v_key, TRUE);
    IF v_hit IN ('t', 'f') THEN
        RETURN v_hit = 't';
    END IF;

    SELECT c.permissions, TRUE INTO v_perms, v_gated
    FROM public.fn_notification_catalog() c
    WHERE p_type = ANY(c.types) AND c.permissions IS NOT NULL
    LIMIT 1;

    IF v_gated THEN
        v_ok := public.fn_user_has_permission(p_business_id, v_me, v_perms);
    ELSE
        v_ok := p_role IS NULL OR v_role ILIKE p_role;
    END IF;
    PERFORM set_config(v_key, CASE WHEN v_ok THEN 't' ELSE 'f' END, TRUE);
    RETURN v_ok;
END;
$function$;

-- The notification list: newest first within one business.
CREATE INDEX IF NOT EXISTS idx_notifications_business_created
  ON public.notifications (business_id, created_at DESC) WHERE deleted_at IS NULL;

-- Policies that test business_id = ANY(get_user_business_ids()): wrap the call in (SELECT ...)
-- so Postgres runs it once per query instead of once per row (where an OR keeps it out of the
-- index condition, e.g. notifications). Same function, same answer.
DO $$
DECLARE
    r record;
    v_using text;
    v_check text;
    v_n int := 0;
BEGIN
    FOR r IN
        SELECT schemaname, tablename, policyname, qual, with_check
        FROM pg_policies
        WHERE schemaname IN ('public', 'storage')
          AND (COALESCE(qual, '') || COALESCE(with_check, '')) ~ '(?<!SELECT )get_user_business_ids\(\)'
    LOOP
        v_using := regexp_replace(r.qual, '(?<!SELECT )get_user_business_ids\(\)', '(SELECT get_user_business_ids())::uuid[]', 'g');
        v_check := regexp_replace(r.with_check, '(?<!SELECT )get_user_business_ids\(\)', '(SELECT get_user_business_ids())::uuid[]', 'g');
        EXECUTE format('ALTER POLICY %I ON %I.%I', r.policyname, r.schemaname, r.tablename)
             || CASE WHEN v_using IS NOT NULL THEN format(' USING (%s)', v_using) ELSE '' END
             || CASE WHEN v_check IS NOT NULL THEN format(' WITH CHECK (%s)', v_check) ELSE '' END;
        v_n := v_n + 1;
    END LOOP;
    RAISE NOTICE 'Policies now asking get_user_business_ids() once per query: %', v_n;
END;
$$;

-- pg_cron writes a row for every job run (about 2,800 a day here: 3.5 MB a week, ~180 MB a year
-- on a database of 37 MB). Keep a week, which is what the watchdog and anyone debugging need.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
        PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'prune-cron-history';
        PERFORM cron.schedule('prune-cron-history', '40 0 * * *', $job$DELETE FROM cron.job_run_details WHERE end_time < now() - interval '7 days'$job$);
    END IF;
END;
$$;

-- ===================================================================
-- 20261201006_realtime_publication
-- ===================================================================
-- Phase 10: live updates only for the tables the apps actually follow.
--
-- 1. money_assets was never in the live-update list, so the Payments balances the app follows
--    (subscribeMoneyAssets, MoneyAssetRepository.subscribe) never refreshed on their own after a
--    sale or expense on another device (money rule 2: the screen must match the books).
-- 2. 27 tables were in the list but no app or website screen follows them (checked against the
--    code and release v7.5.5). Realtime still decoded every change to them: on live its change
--    polling was ~80% of all database time (pg_stat_statements, 2026-11-05 to 11-23). Removing
--    them changes no data and no screen. Add a table back here when a screen starts following it.
--
-- destructive-ok: removes tables from the realtime publication only; no table, column or row changes.

DO $$
DECLARE
  t text;
  unused text[] := ARRAY[
    'ai_insights', 'ai_settings', 'audit_logs', 'backup_history_logs', 'branches',
    'business_assets', 'complaint_replies', 'complaints', 'credit_payments', 'customer_ledger',
    'dashboard_analytics_snapshots', 'device_fcm_tokens', 'employees', 'google_sheets_backup',
    'notification_preferences', 'offline_sync_queue', 'printer_settings', 'purchase_items',
    'receipt_settings', 'recipe_ingredients', 'recipes', 'scheduled_reports', 'sms_settings',
    'storage_files', 'suppliers', 'transaction_items', 'wallet_transactions'];
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    RETURN;
  END IF;

  FOREACH t IN ARRAY unused LOOP
    IF EXISTS (SELECT 1 FROM pg_publication_tables
               WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = t) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime DROP TABLE public.%I', t);
    END IF;
  END LOOP;

  IF to_regclass('public.money_assets') IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM pg_publication_tables
       WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'money_assets') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.money_assets;
  END IF;
END $$;

-- ===================================================================
-- 20261201007_storage_usage_alert
-- ===================================================================
-- Phase 10: usage alert for file storage, next to the database size alert (db:size).
--
-- Pictures, logos, receipts and business files live in Supabase Storage, which has its own plan
-- limit (Free: 1 GB; Pro: 100 GB included, then billed per GB). Nothing warned before it filled.
-- New watchdog check storage:size: files over 80% of storage_limit_mb.
--
-- Settings (SQL editor): UPDATE ops_watchdog_config SET storage_limit_mb = 102400;  -- Pro plan
-- Like 20261201004, the existing checks are kept as they are (renamed ops_watchdog_abuse_checks)
-- and called first.

ALTER TABLE public.ops_watchdog_config
    ADD COLUMN IF NOT EXISTS storage_limit_mb integer NOT NULL DEFAULT 1024;  -- Supabase Free plan

DO $$
BEGIN
    IF to_regprocedure('public.ops_watchdog_abuse_checks()') IS NULL THEN
        ALTER FUNCTION public.ops_watchdog_checks() RENAME TO ops_watchdog_abuse_checks;
    END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.ops_watchdog_checks()
RETURNS TABLE(check_key text, problem text)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
    c public.ops_watchdog_config;
    v_size bigint;
BEGIN
    RETURN QUERY SELECT * FROM public.ops_watchdog_abuse_checks();

    SELECT * INTO c FROM public.ops_watchdog_config WHERE id;

    check_key := 'storage:size';
    problem := NULL;
    IF to_regclass('storage.objects') IS NOT NULL THEN
        BEGIN
            EXECUTE $q$SELECT COALESCE(sum((metadata->>'size')::bigint), 0) FROM storage.objects$q$
                INTO v_size;
            IF v_size > c.storage_limit_mb::bigint * 1024 * 1024 * 0.8 THEN
                problem := 'Stored files are ' || pg_size_pretty(v_size) || ', over 80% of the '
                    || c.storage_limit_mb || ' MB plan limit. Delete old files or upgrade the plan.';
            END IF;
        EXCEPTION WHEN insufficient_privilege THEN
            problem := 'The watchdog cannot read storage.objects to measure stored files.';
        END;
    END IF;
    RETURN NEXT;
END;
$$;
REVOKE ALL ON FUNCTION public.ops_watchdog_checks() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ops_watchdog_abuse_checks() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ops_watchdog_checks() TO service_role;
GRANT EXECUTE ON FUNCTION public.ops_watchdog_abuse_checks() TO service_role;

-- ===================================================================
-- 20261202001_record_refs_global_search
-- ===================================================================
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

-- ===================================================================
-- 20261203001_keep_records
-- ===================================================================
-- Records the books and reports stand on are kept (2026-11-24, owner's decision).
--
-- 1. Settings > Old records could delete the audit trail, sales older than 3 months, stock
--    history older than 3 days and "who used points". Each of those breaks a rule:
--    - the audit trail is the record of who changed what; one that can be deleted proves nothing;
--    - sales, damage / waste / count differences / opening stock (stock_adj in the books) and
--      points used (a discount profit figures read) are money: deleting them makes past reports
--      and the books disagree (money rule 2).
--    delete_log_entries() now only clears logs that carry no money and no audit value:
--    points earned (points are never cash; balances stay), backup runs and crash reports.
-- 2. The audit trail is append-only in the database: no role can delete or edit an entry. The one
--    change allowed is the database itself blanking a link when the business, person or user it
--    points at is removed (the ON DELETE SET NULL foreign keys).
-- 3. Sales cannot be deleted by anyone signed in. A sale is undone by voiding it (deleted_at),
--    which reverses stock, money and books (money rule 4). The direct DELETE policy that
--    orders.cancel gave is dropped and the DELETE grant revoked. How long sales are kept, and
--    whether very old ones are ever archived, is a separate decision (docs/TO_FINISH.md).
-- 4. New permission support.report (About > Report a problem): checked by the ops-alert function
--    with has_permission instead of the role names Owner/Admin. Owners and admins hold every
--    permission; other roles get it only when the owner ticks it in Roles.

-- ---------------------------------------------------------------- 1. old records cleanup
CREATE OR REPLACE FUNCTION public.delete_log_entries(
    p_business_id uuid, p_log text, p_ids uuid[] DEFAULT NULL::uuid[], p_before timestamptz DEFAULT NULL::timestamptz)
RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
AS $_$
DECLARE
    v_table TEXT;
    v_time  TEXT;
    v_count INTEGER;
BEGIN
    IF public.is_owner_or_admin(p_business_id) IS NOT TRUE THEN
        RAISE EXCEPTION 'Only an owner or admin can delete logs.' USING ERRCODE = '42501';
    END IF;

    IF p_log IN ('sales', 'stock', 'points_used', 'audit') THEN
        RAISE EXCEPTION 'This record is kept for the books and the audit trail, so it can''t be deleted.'
            USING ERRCODE = '42501';
    END IF;

    SELECT t.tbl, t.col INTO v_table, v_time
    FROM (VALUES
        ('points_earned', 'loyalty_points_earned', 'created_at'),
        ('backups',       'backup_history_logs',   'timestamp'),
        ('crashes',       'crash_reports',         'last_seen_at')
    ) AS t(name, tbl, col)
    WHERE t.name = p_log;

    IF v_table IS NULL THEN
        RAISE EXCEPTION 'Unknown log: %', p_log;
    END IF;

    IF p_ids IS NOT NULL THEN
        IF cardinality(p_ids) = 0 THEN
            RETURN 0;
        END IF;
        EXECUTE format('DELETE FROM public.%I WHERE business_id = $1 AND id = ANY($2)', v_table)
            USING p_business_id, p_ids;
    ELSIF p_before IS NOT NULL THEN
        EXECUTE format('DELETE FROM public.%I WHERE business_id = $1 AND %I < $2', v_table, v_time)
            USING p_business_id, p_before;
    ELSE
        RAISE EXCEPTION 'Choose which entries to delete.';
    END IF;

    GET DIAGNOSTICS v_count = ROW_COUNT;
    RETURN v_count;
END;
$_$;
ALTER FUNCTION public.delete_log_entries(uuid, text, uuid[], timestamptz) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.delete_log_entries(uuid, text, uuid[], timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_log_entries(uuid, text, uuid[], timestamptz) TO authenticated, service_role;

-- Sizes of the logs that can still be cleared.
CREATE OR REPLACE FUNCTION public.log_sizes(p_business_id uuid)
RETURNS TABLE(log text, row_count bigint, oldest timestamptz)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
AS $$
BEGIN
    IF public.is_owner_or_admin(p_business_id) IS NOT TRUE THEN
        RAISE EXCEPTION 'Only an owner or admin can see this.' USING ERRCODE = '42501';
    END IF;

    RETURN QUERY
    SELECT 'points_earned', COUNT(*), MIN(created_at) FROM public.loyalty_points_earned WHERE business_id = p_business_id
    UNION ALL
    SELECT 'backups', COUNT(*), MIN(timestamp) FROM public.backup_history_logs WHERE business_id = p_business_id
    UNION ALL
    SELECT 'crashes', COUNT(*), MIN(last_seen_at) FROM public.crash_reports WHERE business_id = p_business_id;
END;
$$;
ALTER FUNCTION public.log_sizes(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.log_sizes(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.log_sizes(uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------- 2. audit trail is append-only
CREATE OR REPLACE FUNCTION public.fn_audit_logs_append_only()
RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'Audit log entries can''t be deleted.' USING ERRCODE = '42501';
    END IF;
    -- Only a link being blanked by its foreign key (the business, person or user was removed).
    IF (to_jsonb(NEW) - ARRAY['business_id', 'employee_id', 'user_id'])
           IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['business_id', 'employee_id', 'user_id'])
       OR (NEW.business_id IS DISTINCT FROM OLD.business_id AND NEW.business_id IS NOT NULL)
       OR (NEW.employee_id IS DISTINCT FROM OLD.employee_id AND NEW.employee_id IS NOT NULL)
       OR (NEW.user_id     IS DISTINCT FROM OLD.user_id     AND NEW.user_id     IS NOT NULL) THEN
        RAISE EXCEPTION 'Audit log entries can''t be changed.' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
END;
$$;
ALTER FUNCTION public.fn_audit_logs_append_only() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.fn_audit_logs_append_only() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_audit_logs_append_only ON public.audit_logs;
CREATE TRIGGER trg_audit_logs_append_only BEFORE UPDATE OR DELETE ON public.audit_logs
    FOR EACH ROW EXECUTE FUNCTION public.fn_audit_logs_append_only();

-- TRUNCATE skips row triggers, so nobody but the database owner may truncate it.
REVOKE TRUNCATE ON public.audit_logs FROM authenticated, anon, service_role;

-- ---------------------------------------------------------------- 3. sales are voided, never deleted
DROP POLICY IF EXISTS pol_transactions_delete ON public.transactions;
REVOKE DELETE, TRUNCATE ON public.transactions FROM authenticated, anon;

-- ===================================================================
-- 20261203002_retention_and_erasure
-- ===================================================================
-- How long records are kept, and erasing a customer's personal details (2026-11-24, owner's
-- decision: "as Kenyan law demands"). Closes finding EXP-07.
--
-- The law this follows:
--   - Tax Procedures Act 2015, s.23: business records are kept for at least 5 years.
--   - Companies Act 2015: a company's accounting records are kept for 7 years.
--   - Data Protection Act 2019, s.25 and s.39: personal data is kept no longer than needed, unless
--     a law requires it; s.40: a person may ask for their personal data to be erased.
--
-- 1. Money records are never deleted by the app: sales, the books, customer ledger, payments,
--    expenses, stock history, invoices (at least 7 years covers both laws above).
-- 2. The audit trail is kept for 7 years, then removed by the daily retention job only.
-- 3. Records that only serve day-to-day work are removed by the same job:
--      notifications                  1 year
--      website chat messages          2 years
--      crash reports                  90 days
--      backup run log                 1 year
-- 4. erase_customer(): on the customer's request, their name, phone, email and delivery details
--    are removed, their website account is deleted (with its chat, schedules and votes), and their
--    online orders, reviews and feedback lose the name and phone. Their sales and ledger stay, as
--    the tax law requires, now pointing at "Erased customer" (phone 0000000). Refused while the customer owes
--    money or has money in their wallet (money rule 4: settle it first). Needs customers.erase.

-- ---------------------------------------------------------------- audit trail: 7 years
CREATE OR REPLACE FUNCTION public.fn_audit_logs_append_only()
RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        -- Only the retention job, and only entries older than 7 years.
        IF current_setting('isms.retention_job', TRUE) = 'on'
           AND OLD."timestamp" < now() - interval '7 years' THEN
            RETURN OLD;
        END IF;
        RAISE EXCEPTION 'Audit log entries can''t be deleted.' USING ERRCODE = '42501';
    END IF;
    -- Only a link being blanked by its foreign key (the business, person or user was removed).
    IF (to_jsonb(NEW) - ARRAY['business_id', 'employee_id', 'user_id'])
           IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['business_id', 'employee_id', 'user_id'])
       OR (NEW.business_id IS DISTINCT FROM OLD.business_id AND NEW.business_id IS NOT NULL)
       OR (NEW.employee_id IS DISTINCT FROM OLD.employee_id AND NEW.employee_id IS NOT NULL)
       OR (NEW.user_id     IS DISTINCT FROM OLD.user_id     AND NEW.user_id     IS NOT NULL) THEN
        RAISE EXCEPTION 'Audit log entries can''t be changed.' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
END;
$$;
ALTER FUNCTION public.fn_audit_logs_append_only() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.fn_audit_logs_append_only() FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------- daily retention job
CREATE OR REPLACE FUNCTION public.run_data_retention()
RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
AS $$
DECLARE
    v_out jsonb := '{}'::jsonb;
    v_n   integer;
BEGIN
    DELETE FROM public.notifications WHERE created_at < now() - interval '1 year';
    GET DIAGNOSTICS v_n = ROW_COUNT; v_out := v_out || jsonb_build_object('notifications', v_n);

    DELETE FROM public.customer_messages WHERE created_at < now() - interval '2 years';
    GET DIAGNOSTICS v_n = ROW_COUNT; v_out := v_out || jsonb_build_object('customer_messages', v_n);

    DELETE FROM public.crash_reports WHERE last_seen_at < now() - interval '90 days';
    GET DIAGNOSTICS v_n = ROW_COUNT; v_out := v_out || jsonb_build_object('crash_reports', v_n);

    DELETE FROM public.backup_history_logs WHERE "timestamp" < now() - interval '1 year';
    GET DIAGNOSTICS v_n = ROW_COUNT; v_out := v_out || jsonb_build_object('backup_history_logs', v_n);

    PERFORM set_config('isms.retention_job', 'on', TRUE);
    DELETE FROM public.audit_logs WHERE "timestamp" < now() - interval '7 years';
    GET DIAGNOSTICS v_n = ROW_COUNT; v_out := v_out || jsonb_build_object('audit_logs', v_n);
    PERFORM set_config('isms.retention_job', 'off', TRUE);

    RETURN v_out;
END;
$$;
ALTER FUNCTION public.run_data_retention() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.run_data_retention() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.run_data_retention() TO service_role;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
        PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'data-retention';
        PERFORM cron.schedule('data-retention', '30 0 * * *', $job$SELECT public.run_data_retention()$job$);
    END IF;
END;
$$;

-- ---------------------------------------------------------------- erase a customer
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS erased_at timestamptz;

CREATE OR REPLACE FUNCTION public.erase_customer(p_customer_id uuid)
RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
AS $$
DECLARE
    v_c        public.customers%ROWTYPE;
    v_accounts uuid[];
    v_deleted  integer := 0;
    v_kept     integer := 0;
    v_acc      uuid;
    v_label    CONSTANT text := 'Erased customer';
BEGIN
    SELECT * INTO v_c FROM public.customers WHERE id = p_customer_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Customer not found.';
    END IF;
    IF public.has_permission(v_c.business_id, 'customers.erase') IS NOT TRUE THEN
        RAISE EXCEPTION 'You don''t have permission to erase customers.' USING ERRCODE = '42501';
    END IF;
    IF v_c.erased_at IS NOT NULL THEN
        RAISE EXCEPTION 'This customer''s details were already erased.';
    END IF;
    IF v_c.debt_balance > 0 THEN
        RAISE EXCEPTION 'This customer owes KSh %. Settle the debt before erasing their details.',
            to_char(v_c.debt_balance, 'FM999,999,999,990.00');
    END IF;
    IF v_c.wallet_balance > 0 THEN
        RAISE EXCEPTION 'This customer has KSh % in their wallet. Pay it back or use it before erasing their details.',
            to_char(v_c.wallet_balance, 'FM999,999,999,990.00');
    END IF;

    SELECT coalesce(array_agg(id), '{}') INTO v_accounts
    FROM public.customer_accounts WHERE customer_id = p_customer_id;

    -- Records kept for the law lose the name and contact details.
    UPDATE public.online_orders
       SET customer_name = v_label, customer_phone = '', delivery_address = NULL, notes = NULL
     WHERE account_id = ANY(v_accounts);
    UPDATE public.website_reviews SET display_name = 'Former customer' WHERE account_id = ANY(v_accounts);
    UPDATE public.complaints SET customer_name = v_label WHERE account_id = ANY(v_accounts);

    -- The website account: deleting the sign-in removes the account, its chat, schedules and votes.
    -- A sign-in that is also a staff member is kept; only the customer profile on it is cleared.
    FOREACH v_acc IN ARRAY v_accounts LOOP
        IF EXISTS (SELECT 1 FROM public.users u
                   JOIN public.business_memberships bm ON bm.user_id = u.id
                   WHERE u.auth_user_id = v_acc) THEN
            DELETE FROM public.customer_messages WHERE account_id = v_acc;
            DELETE FROM public.customer_order_schedules WHERE account_id = v_acc;
            DELETE FROM public.customer_accounts WHERE id = v_acc;
            v_kept := v_kept + 1;
        ELSE
            DELETE FROM auth.users WHERE id = v_acc;
            v_deleted := v_deleted + 1;
        END IF;
    END LOOP;

    UPDATE public.customers
       SET name = v_label,
           phone = '0000000',  -- the phone is required; this placeholder is nobody's number
           email = NULL,
           description = NULL,
           delivery_zone_id = NULL,
           delivery_address = NULL,
           delivery_building = NULL,
           delivery_landmark = NULL,
           delivery_notes = NULL,
           notify_service = FALSE,
           notify_promotions = FALSE,
           delivery_frequency = 'none',
           erased_at = now(),
           deleted_at = coalesce(deleted_at, now()),
           updated_at = now(),
           last_modified_by = 'erase_customer'
     WHERE id = p_customer_id;

    INSERT INTO public.audit_logs (business_id, user_id, action, table_name, record_id, details)
    VALUES (v_c.business_id,
            (SELECT u.id FROM public.users u WHERE u.auth_user_id = auth.uid()),
            'customer_erased', 'customers', p_customer_id::text,
            jsonb_build_object('account_number', v_c.account_number,
                               'website_accounts_deleted', v_deleted));

    RETURN jsonb_build_object('erased', TRUE, 'website_accounts_deleted', v_deleted,
                              'staff_sign_ins_kept', v_kept);
END;
$$;
ALTER FUNCTION public.erase_customer(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.erase_customer(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.erase_customer(uuid) TO authenticated, service_role;

-- ===================================================================
-- 20261204001_saas_tenants_plans
-- ===================================================================
-- SaaS: companies (tenants), plans, modules, limits, trial and the platform admin (2026-11-24).
--
-- Until now the "system creator" was simply the first person ever to become an Owner, and only
-- that person could create businesses, so a second company could never sign up. A branch is a
-- row of `businesses`; branches were grouped only by sharing an Owner.
--
-- Now:
-- * platform_admins: the people who run the platform (the developer). Not tied to any business.
--   is_system_creator() now means "is a platform admin".
-- * tenants: the paying company. Every business row (branch) belongs to one tenant. Existing
--   branches are grouped by their Owner. Stock transfers check "same tenant".
-- * plans + tenant_subscriptions: the plan of each tenant (trial, starter, pro, pro_plus,
--   perpetual), its status, add-ons and per-tenant custom limits set by the platform admin.
-- * Modules: a permission whose module is not in the plan answers FALSE in has_permission, for
--   the Owner too. Background work (books posting, callbacks, cron) does not run as an app role
--   and is not affected, so the books stay complete while a module is locked.
-- * Limits: branches and staff (Owner, riders and suppliers are not staff) are checked in the
--   database when a branch is added or restored, an invitation is made or a member joins.
-- * Read-only: when a trial ends unpaid or a paid period runs out (after grace), writes by app
--   users to the tenant's business tables are refused. Reading and exporting still work.
--   Payment callbacks and other server work still record money (money rule 1).
-- * Trial on/off switch (platform_settings), one trial per person, sign-up requests the
--   platform admin approves (for bank transfers and agreed deals), and platform_* functions for
--   the admin website: change any tenant's plan by hand without payment, add-ons, custom limits,
--   extend a trial, list tenants with counts only.

-- ============================================================================================
-- 1. Platform admins
-- ============================================================================================
CREATE TABLE IF NOT EXISTS public.platform_admins (
    auth_user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    name text,
    created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.platform_admins ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS pol_platform_admins_select ON public.platform_admins;
CREATE POLICY pol_platform_admins_select ON public.platform_admins
    FOR SELECT TO authenticated USING (auth_user_id = (SELECT auth.uid()));
REVOKE ALL ON public.platform_admins FROM anon, authenticated;
GRANT SELECT ON public.platform_admins TO authenticated;
GRANT ALL ON public.platform_admins TO service_role;

CREATE OR REPLACE FUNCTION public.is_platform_admin(p_auth_user_id uuid DEFAULT auth.uid())
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT p_auth_user_id IS NOT NULL
       AND EXISTS (SELECT 1 FROM public.platform_admins pa WHERE pa.auth_user_id = p_auth_user_id);
$$;
REVOKE ALL ON FUNCTION public.is_platform_admin(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_platform_admin(uuid) TO authenticated, service_role;

-- Whoever the old rule treated as the system creator (the first Owner) becomes the first
-- platform admin, so nothing changes for the live system. More are added by SQL only.
INSERT INTO public.platform_admins (auth_user_id, name)
SELECT u.auth_user_id, u.name
FROM public.business_memberships bm
JOIN public.users u ON u.id = bm.user_id
WHERE bm.role = 'Owner' AND u.auth_user_id IS NOT NULL
  AND EXISTS (SELECT 1 FROM auth.users au WHERE au.id = u.auth_user_id)
ORDER BY bm.created_at, bm.id
LIMIT 1
ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION public.is_system_creator(p_auth_user_id uuid DEFAULT auth.uid())
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $$ SELECT public.is_platform_admin(p_auth_user_id); $$;
REVOKE ALL ON FUNCTION public.is_system_creator(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_system_creator(uuid) TO authenticated, service_role;

-- What the platform admin did (plan changes, approvals). Only platform admins read it.
CREATE TABLE IF NOT EXISTS public.platform_audit (
    id bigserial PRIMARY KEY,
    tenant_id uuid,
    action text NOT NULL,
    details jsonb NOT NULL DEFAULT '{}'::jsonb,
    by_auth_user_id uuid DEFAULT auth.uid(),
    created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.platform_audit ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS pol_platform_audit_select ON public.platform_audit;
CREATE POLICY pol_platform_audit_select ON public.platform_audit
    FOR SELECT TO authenticated USING ((SELECT public.is_platform_admin()));
REVOKE ALL ON public.platform_audit FROM anon, authenticated;
GRANT SELECT ON public.platform_audit TO authenticated;
GRANT ALL ON public.platform_audit TO service_role;

CREATE OR REPLACE FUNCTION public.fn_platform_log(p_tenant_id uuid, p_action text, p_details jsonb)
RETURNS void
LANGUAGE sql SECURITY DEFINER
SET search_path = ''
AS $$
    INSERT INTO public.platform_audit (tenant_id, action, details) VALUES (p_tenant_id, p_action, COALESCE(p_details, '{}'::jsonb));
$$;
REVOKE ALL ON FUNCTION public.fn_platform_log(uuid, text, jsonb) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.fn_require_platform_admin()
RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF NOT public.is_platform_admin() THEN
        RAISE EXCEPTION 'Only the platform admin can do this.' USING ERRCODE = '42501';
    END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.fn_require_platform_admin() FROM PUBLIC, anon, authenticated;

-- ============================================================================================
-- 2. Platform settings (one row)
-- ============================================================================================
CREATE TABLE IF NOT EXISTS public.platform_settings (
    id boolean PRIMARY KEY DEFAULT true CHECK (id),
    trial_enabled boolean NOT NULL DEFAULT true,
    trial_days integer NOT NULL DEFAULT 14 CHECK (trial_days BETWEEN 1 AND 90),
    trial_plan text NOT NULL DEFAULT 'trial',
    grace_days integer NOT NULL DEFAULT 7 CHECK (grace_days BETWEEN 0 AND 60),
    read_only_days integer NOT NULL DEFAULT 30 CHECK (read_only_days BETWEEN 0 AND 365),
    platform_domain text CHECK (platform_domain IS NULL OR platform_domain ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$'),
    updated_at timestamptz NOT NULL DEFAULT now(),
    updated_by uuid
);
INSERT INTO public.platform_settings (id) VALUES (true) ON CONFLICT DO NOTHING;
ALTER TABLE public.platform_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS pol_platform_settings_select ON public.platform_settings;
CREATE POLICY pol_platform_settings_select ON public.platform_settings
    FOR SELECT TO authenticated USING (true);
REVOKE ALL ON public.platform_settings FROM anon, authenticated;
GRANT SELECT ON public.platform_settings TO authenticated;
GRANT ALL ON public.platform_settings TO service_role;

-- ============================================================================================
-- 3. Modules and plans
-- ============================================================================================
-- Modules a business can run without. Everything not listed here is core (every plan).
CREATE TABLE IF NOT EXISTS public.plan_modules (
    key text PRIMARY KEY CHECK (key ~ '^[a-z_]+$'),
    name text NOT NULL,
    tier text NOT NULL CHECK (tier IN ('growth', 'advanced')),
    addable boolean NOT NULL DEFAULT false,  -- a Pro tenant can buy it on its own
    sort integer NOT NULL DEFAULT 0
);
INSERT INTO public.plan_modules (key, name, tier, addable, sort) VALUES
    ('buying',         'Buying and suppliers',  'growth',   false, 10),
    ('stock_report',   'Stock report',          'growth',   false, 20),
    ('transfers',      'Branch transfers',      'growth',   false, 30),
    ('deliveries',     'Deliveries and riders', 'growth',   false, 40),
    ('promotions',     'Promotions and points', 'growth',   false, 50),
    ('regular_orders', 'Regular orders',        'growth',   false, 60),
    ('production',     'Production and BOM',    'growth',   false, 70),
    ('quotes',         'Quotes and orders',     'growth',   false, 80),
    ('messaging',      'Bulk messaging',        'growth',   false, 90),
    ('online_store',   'Online store',          'advanced', true,  100),
    ('accounting',     'Books and accounting',  'advanced', true,  110),
    ('ai',             'AI assistant and insights', 'advanced', true, 120),
    ('own_domain',     'Own web address',       'advanced', true,  130)
ON CONFLICT (key) DO UPDATE SET name = EXCLUDED.name, tier = EXCLUDED.tier,
    addable = EXCLUDED.addable, sort = EXCLUDED.sort;

-- Which permissions belong to which module (LIKE patterns; the longest match wins).
CREATE TABLE IF NOT EXISTS public.module_permissions (
    pattern text PRIMARY KEY,
    module text NOT NULL REFERENCES public.plan_modules(key) ON DELETE CASCADE
);
INSERT INTO public.module_permissions (pattern, module) VALUES
    ('suppliers.%', 'buying'), ('purchases.%', 'buying'), ('supplier_bills.%', 'buying'),
    ('supplier_portal.%', 'buying'),
    ('inventory.transfer_stock', 'transfers'), ('inventory.receive_stock', 'transfers'),
    ('inventory.request_transfer', 'transfers'),
    ('deliveries.%', 'deliveries'), ('orders.assign_rider', 'deliveries'),
    ('settings.delivery', 'deliveries'), ('reports.deliveries', 'deliveries'),
    ('promotions.%', 'promotions'), ('referrals.%', 'promotions'), ('loyalty.%', 'promotions'),
    ('customers.loyalty', 'promotions'), ('pos.apply_promotion', 'promotions'),
    ('customers.schedules', 'regular_orders'),
    ('bom.%', 'production'), ('production.%', 'production'),
    ('quotes.%', 'quotes'), ('sales_orders.%', 'quotes'),
    ('communication.%', 'messaging'),
    ('online_store.%', 'online_store'),
    ('accounting.%', 'accounting'),
    ('ai.%', 'ai')
ON CONFLICT (pattern) DO UPDATE SET module = EXCLUDED.module;

CREATE TABLE IF NOT EXISTS public.plans (
    code text PRIMARY KEY CHECK (code ~ '^[a-z0-9_]+$'),
    name text NOT NULL,
    kind text NOT NULL CHECK (kind IN ('trial', 'subscription', 'perpetual')),
    description text,
    monthly_price numeric(14,2) CHECK (monthly_price >= 0),
    annual_price numeric(14,2) CHECK (annual_price >= 0),
    one_time_price numeric(14,2) CHECK (one_time_price >= 0),   -- NULL on perpetual = "ask us"
    max_branches integer NOT NULL CHECK (max_branches >= 1),
    max_staff integer NOT NULL CHECK (max_staff >= 0),
    storage_mb integer NOT NULL CHECK (storage_mb >= 0),
    ai_daily_cap integer NOT NULL DEFAULT 0 CHECK (ai_daily_cap >= 0),
    ai_addon_daily_cap integer NOT NULL DEFAULT 0 CHECK (ai_addon_daily_cap >= 0),
    modules text[] NOT NULL DEFAULT '{}',
    addons_allowed boolean NOT NULL DEFAULT false,
    own_ai_key boolean NOT NULL DEFAULT false,      -- the tenant brings its own AI key
    show_powered_by boolean NOT NULL DEFAULT false, -- small "Powered by" line on the store
    is_public boolean NOT NULL DEFAULT true,
    active boolean NOT NULL DEFAULT true,
    sort integer NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.plans (code, name, kind, description, monthly_price, annual_price, one_time_price,
                          max_branches, max_staff, storage_mb, ai_daily_cap, ai_addon_daily_cap,
                          modules, addons_allowed, own_ai_key, show_powered_by, sort) VALUES
    ('trial', 'Free trial', 'trial', 'Try everything for free.', 0, 0, NULL,
     1, 2, 1024, 20, 0,
     ARRAY['buying','stock_report','transfers','deliveries','promotions','regular_orders','production','quotes','messaging','online_store','accounting','ai'],
     false, false, true, 0),
    ('starter', 'Starter', 'subscription', 'One shop: selling, stock, customers, money and staff.', 3000, 30000, NULL,
     1, 3, 1024, 0, 0, ARRAY[]::text[], false, false, false, 10),
    ('pro', 'Pro', 'subscription', 'Up to 3 branches with buying, deliveries, promotions and more.', 6000, 60000, NULL,
     3, 10, 5120, 0, 50,
     ARRAY['buying','stock_report','transfers','deliveries','promotions','regular_orders','production','quotes','messaging'],
     true, false, true, 20),
    ('pro_plus', 'Pro Plus', 'subscription', 'Everything: online store, books and accounting, AI.', 12000, 120000, NULL,
     10, 30, 20480, 100, 0,
     ARRAY['buying','stock_report','transfers','deliveries','promotions','regular_orders','production','quotes','messaging','online_store','accounting','ai','own_domain'],
     false, false, false, 30),
    ('perpetual', 'Perpetual licence', 'perpetual', 'Pay once. You bring your own AI key and provider accounts; the licence stays ours.', NULL, NULL, NULL,
     10, 30, 5120, 0, 0,
     ARRAY['buying','stock_report','transfers','deliveries','promotions','regular_orders','production','quotes','messaging','online_store','accounting','ai','own_domain'],
     false, true, false, 40)
ON CONFLICT (code) DO NOTHING;

ALTER TABLE public.plan_modules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.module_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.plans ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS pol_plan_modules_select ON public.plan_modules;
CREATE POLICY pol_plan_modules_select ON public.plan_modules FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS pol_module_permissions_select ON public.module_permissions;
CREATE POLICY pol_module_permissions_select ON public.module_permissions FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS pol_plans_select ON public.plans;
CREATE POLICY pol_plans_select ON public.plans FOR SELECT TO authenticated
    USING (active OR (SELECT public.is_platform_admin()));
REVOKE ALL ON public.plan_modules, public.module_permissions, public.plans FROM anon, authenticated;
GRANT SELECT ON public.plan_modules, public.module_permissions, public.plans TO authenticated;
GRANT ALL ON public.plan_modules, public.module_permissions, public.plans TO service_role;

-- ============================================================================================
-- 4. Tenants (the paying company) and their subscription
-- ============================================================================================
CREATE TABLE IF NOT EXISTS public.tenants (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name text NOT NULL CHECK (length(trim(name)) > 0),
    owner_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_tenants_owner ON public.tenants(owner_user_id);

CREATE TABLE IF NOT EXISTS public.tenant_subscriptions (
    tenant_id uuid PRIMARY KEY REFERENCES public.tenants(id) ON DELETE CASCADE,
    plan_code text NOT NULL REFERENCES public.plans(code),
    status text NOT NULL DEFAULT 'trial' CHECK (status IN ('trial', 'active', 'suspended')),
    billing_cycle text NOT NULL DEFAULT 'trial' CHECK (billing_cycle IN ('trial', 'monthly', 'annual', 'one_time', 'manual')),
    started_at timestamptz NOT NULL DEFAULT now(),
    trial_ends_at timestamptz,
    current_period_end timestamptz,     -- NULL = no end (perpetual, or set by hand)
    addons text[] NOT NULL DEFAULT '{}',
    custom_limits jsonb NOT NULL DEFAULT '{}'::jsonb,
    note text,
    updated_at timestamptz NOT NULL DEFAULT now(),
    updated_by uuid
);

ALTER TABLE public.businesses ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES public.tenants(id);
CREATE INDEX IF NOT EXISTS idx_businesses_tenant ON public.businesses(tenant_id);

-- Group the existing branches: one tenant per Owner; a business without an Owner gets its own.
-- Everything that exists today goes on Pro Plus with no end date (the platform admin can move
-- any of them to another plan by hand).
DO $$
DECLARE
    r record;
    v_tenant uuid;
BEGIN
    -- The Owner of each business (the first one, should there be more).
    CREATE TEMP TABLE _owner_of ON COMMIT DROP AS
    SELECT DISTINCT ON (bm.business_id) bm.business_id, bm.user_id
    FROM public.business_memberships bm
    JOIN public.businesses b ON b.id = bm.business_id
    WHERE bm.role = 'Owner' AND bm.status = 'Active' AND b.tenant_id IS NULL
    ORDER BY bm.business_id, bm.created_at, bm.id;

    FOR r IN
        SELECT o.user_id, (array_agg(b.name ORDER BY b.created_at, b.id))[1] AS name
        FROM _owner_of o JOIN public.businesses b ON b.id = o.business_id
        GROUP BY o.user_id
    LOOP
        INSERT INTO public.tenants (name, owner_user_id) VALUES (r.name, r.user_id) RETURNING id INTO v_tenant;
        UPDATE public.businesses SET tenant_id = v_tenant
        WHERE id IN (SELECT business_id FROM _owner_of WHERE user_id = r.user_id);
    END LOOP;

    FOR r IN SELECT id, name FROM public.businesses WHERE tenant_id IS NULL LOOP
        INSERT INTO public.tenants (name) VALUES (r.name) RETURNING id INTO v_tenant;
        UPDATE public.businesses SET tenant_id = v_tenant WHERE id = r.id;
    END LOOP;

    INSERT INTO public.tenant_subscriptions (tenant_id, plan_code, status, billing_cycle, note)
    SELECT t.id, 'pro_plus', 'active', 'manual', 'Existing before plans (2026-11-24)'
    FROM public.tenants t
    ON CONFLICT (tenant_id) DO NOTHING;
END;
$$;

ALTER TABLE public.businesses ALTER COLUMN tenant_id SET NOT NULL;

-- A new tenant starts on the trial plan (create_business_with_owner then sets the real plan).
CREATE OR REPLACE FUNCTION public.fn_tenant_default_subscription()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    s public.platform_settings;
BEGIN
    SELECT * INTO s FROM public.platform_settings WHERE id;
    INSERT INTO public.tenant_subscriptions (tenant_id, plan_code, status, billing_cycle, trial_ends_at)
    VALUES (NEW.id, COALESCE(s.trial_plan, 'trial'), 'trial', 'trial',
            now() + make_interval(days => COALESCE(s.trial_days, 14)))
    ON CONFLICT (tenant_id) DO NOTHING;
    RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.fn_tenant_default_subscription() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_tenant_default_subscription ON public.tenants;
CREATE TRIGGER trg_tenant_default_subscription AFTER INSERT ON public.tenants
    FOR EACH ROW EXECUTE FUNCTION public.fn_tenant_default_subscription();

-- A business inserted without a tenant (seed scripts, tests) gets a tenant of its own; when its
-- Owner joins and already owns a tenant, it moves into that one (fn_business_owner_tenant).
CREATE OR REPLACE FUNCTION public.fn_business_default_tenant()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF NEW.tenant_id IS NULL THEN
        INSERT INTO public.tenants (name) VALUES (NEW.name) RETURNING id INTO NEW.tenant_id;
    END IF;
    RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.fn_business_default_tenant() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_a_business_default_tenant ON public.businesses;
CREATE TRIGGER trg_a_business_default_tenant BEFORE INSERT ON public.businesses
    FOR EACH ROW EXECUTE FUNCTION public.fn_business_default_tenant();

CREATE OR REPLACE FUNCTION public.fn_business_owner_tenant()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_tenant uuid;
    v_owner uuid;
    v_other uuid;
BEGIN
    IF NEW.role <> 'Owner' OR NEW.status <> 'Active' THEN
        RETURN NULL;
    END IF;
    SELECT b.tenant_id INTO v_tenant FROM public.businesses b WHERE b.id = NEW.business_id;
    SELECT t.owner_user_id INTO v_owner FROM public.tenants t WHERE t.id = v_tenant;
    IF v_tenant IS NULL OR v_owner IS NOT NULL THEN
        RETURN NULL;
    END IF;
    SELECT t.id INTO v_other FROM public.tenants t
    WHERE t.owner_user_id = NEW.user_id AND t.id <> v_tenant
    ORDER BY t.created_at LIMIT 1;
    IF v_other IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM public.businesses b WHERE b.tenant_id = v_tenant AND b.id <> NEW.business_id) THEN
        PERFORM set_config('isms.tenant_move', 'on', true);
        UPDATE public.businesses SET tenant_id = v_other WHERE id = NEW.business_id;
        PERFORM set_config('isms.tenant_move', '', true);
        DELETE FROM public.tenants WHERE id = v_tenant;
    ELSE
        UPDATE public.tenants SET owner_user_id = NEW.user_id, updated_at = now() WHERE id = v_tenant;
    END IF;
    RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.fn_business_owner_tenant() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_business_owner_tenant ON public.business_memberships;
CREATE TRIGGER trg_business_owner_tenant AFTER INSERT ON public.business_memberships
    FOR EACH ROW EXECUTE FUNCTION public.fn_business_owner_tenant();

-- Nobody in the app moves a branch to another company.
CREATE OR REPLACE FUNCTION public.fn_business_tenant_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
    IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
       AND COALESCE(current_setting('role', true), 'none') IN ('anon', 'authenticated')
       AND COALESCE(current_setting('isms.tenant_move', true), '') <> 'on'
       AND NOT public.is_platform_admin() THEN
        RAISE EXCEPTION 'A branch can''t be moved to another company.' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.fn_business_tenant_guard() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_business_tenant_guard ON public.businesses;
CREATE TRIGGER trg_business_tenant_guard BEFORE UPDATE OF tenant_id ON public.businesses
    FOR EACH ROW EXECUTE FUNCTION public.fn_business_tenant_guard();

-- Members of any branch see their tenant and its subscription; platform admins see all.
ALTER TABLE public.tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenant_subscriptions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS pol_tenants_select ON public.tenants;
CREATE POLICY pol_tenants_select ON public.tenants FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM public.businesses b
            WHERE b.tenant_id = tenants.id AND b.id = ANY (public.get_user_business_ids()))
    OR (SELECT public.is_platform_admin()));
DROP POLICY IF EXISTS pol_tenant_subscriptions_select ON public.tenant_subscriptions;
CREATE POLICY pol_tenant_subscriptions_select ON public.tenant_subscriptions FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM public.businesses b
            WHERE b.tenant_id = tenant_subscriptions.tenant_id AND b.id = ANY (public.get_user_business_ids()))
    OR (SELECT public.is_platform_admin()));
REVOKE ALL ON public.tenants, public.tenant_subscriptions FROM anon, authenticated;
GRANT SELECT ON public.tenants, public.tenant_subscriptions TO authenticated;
GRANT ALL ON public.tenants, public.tenant_subscriptions TO service_role;

-- Plan answers are kept for the rest of the request; any change to these bumps the counter.
DROP TRIGGER IF EXISTS trg_perm_cache_bump ON public.tenant_subscriptions;
CREATE TRIGGER trg_perm_cache_bump AFTER INSERT OR UPDATE OR DELETE OR TRUNCATE ON public.tenant_subscriptions
  FOR EACH STATEMENT EXECUTE FUNCTION public.fn_perm_cache_bump();
DROP TRIGGER IF EXISTS trg_perm_cache_bump ON public.plans;
CREATE TRIGGER trg_perm_cache_bump AFTER INSERT OR UPDATE OR DELETE OR TRUNCATE ON public.plans
  FOR EACH STATEMENT EXECUTE FUNCTION public.fn_perm_cache_bump();
DROP TRIGGER IF EXISTS trg_perm_cache_bump ON public.module_permissions;
CREATE TRIGGER trg_perm_cache_bump AFTER INSERT OR UPDATE OR DELETE OR TRUNCATE ON public.module_permissions
  FOR EACH STATEMENT EXECUTE FUNCTION public.fn_perm_cache_bump();
DROP TRIGGER IF EXISTS trg_perm_cache_bump ON public.platform_settings;
CREATE TRIGGER trg_perm_cache_bump AFTER INSERT OR UPDATE OR DELETE OR TRUNCATE ON public.platform_settings
  FOR EACH STATEMENT EXECUTE FUNCTION public.fn_perm_cache_bump();
DROP TRIGGER IF EXISTS trg_perm_cache_bump_tenant ON public.businesses;
CREATE TRIGGER trg_perm_cache_bump_tenant AFTER INSERT OR UPDATE OF tenant_id, deleted_at ON public.businesses
  FOR EACH STATEMENT EXECUTE FUNCTION public.fn_perm_cache_bump();

-- ============================================================================================
-- 5. What a tenant's plan allows right now
-- ============================================================================================
CREATE OR REPLACE FUNCTION public.fn_business_tenant(p_business_id uuid)
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $$ SELECT b.tenant_id FROM public.businesses b WHERE b.id = p_business_id; $$;
REVOKE ALL ON FUNCTION public.fn_business_tenant(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_business_tenant(uuid) TO service_role;

-- Status: trial (until trial_ends_at, then read_only), active (until current_period_end, then
-- grace for grace_days, then read_only for read_only_days, then suspended), suspended (by hand).
CREATE OR REPLACE FUNCTION public.fn_tenant_plan(p_tenant_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    s public.tenant_subscriptions;
    p public.plans;
    st public.platform_settings;
    c jsonb;
    v_key text;
    v_hit text;
    v_status text;
    v_mod text[];
    v_addons text[];
    v_cap integer;
    r jsonb;
BEGIN
    IF p_tenant_id IS NULL THEN
        RETURN NULL;
    END IF;
    v_key := 'isms_tp.t' || md5(p_tenant_id::text || '|' || public.fn_perm_cache_gen());
    v_hit := current_setting(v_key, true);
    IF v_hit IS NOT NULL AND v_hit <> '' THEN
        RETURN v_hit::jsonb;
    END IF;

    SELECT * INTO s FROM public.tenant_subscriptions WHERE tenant_id = p_tenant_id;
    IF NOT FOUND THEN
        RETURN NULL;
    END IF;
    SELECT * INTO p FROM public.plans WHERE code = s.plan_code;
    SELECT * INTO st FROM public.platform_settings WHERE id;
    c := COALESCE(s.custom_limits, '{}'::jsonb);

    IF s.status = 'suspended' THEN
        v_status := 'suspended';
    ELSIF s.status = 'trial' THEN
        v_status := CASE WHEN s.trial_ends_at IS NULL OR now() < s.trial_ends_at THEN 'trial' ELSE 'read_only' END;
    ELSIF s.current_period_end IS NULL OR now() <= s.current_period_end THEN
        v_status := 'active';
    ELSIF now() <= s.current_period_end + make_interval(days => COALESCE(st.grace_days, 7)) THEN
        v_status := 'grace';
    ELSIF now() <= s.current_period_end + make_interval(days => COALESCE(st.grace_days, 7) + COALESCE(st.read_only_days, 30)) THEN
        v_status := 'read_only';
    ELSE
        v_status := 'suspended';
    END IF;

    v_addons := CASE WHEN p.addons_allowed
                     THEN ARRAY(SELECT a FROM unnest(s.addons) a
                                WHERE a IN (SELECT m.key FROM public.plan_modules m WHERE m.addable))
                     ELSE ARRAY[]::text[] END;
    v_mod := ARRAY(
        SELECT DISTINCT x FROM (
            SELECT unnest(p.modules) AS x
            UNION ALL SELECT unnest(v_addons)
            UNION ALL SELECT jsonb_array_elements_text(CASE WHEN jsonb_typeof(c->'modules') = 'array' THEN c->'modules' ELSE '[]'::jsonb END)
        ) m WHERE x IN (SELECT key FROM public.plan_modules)
        ORDER BY x);

    v_cap := COALESCE((c->>'ai_daily_cap')::integer,
                      CASE WHEN 'ai' = ANY (v_addons) AND p.ai_addon_daily_cap > 0 THEN p.ai_addon_daily_cap
                           ELSE p.ai_daily_cap END);

    r := jsonb_build_object(
        'tenant_id', p_tenant_id,
        'plan', p.code,
        'plan_name', p.name,
        'kind', p.kind,
        'status', v_status,
        'writable', v_status IN ('trial', 'active', 'grace'),
        'billing_cycle', s.billing_cycle,
        'trial_ends_at', s.trial_ends_at,
        'period_end', s.current_period_end,
        'max_branches', COALESCE((c->>'max_branches')::integer, p.max_branches),
        'max_staff', COALESCE((c->>'max_staff')::integer, p.max_staff),
        'storage_mb', COALESCE((c->>'storage_mb')::integer, p.storage_mb),
        'ai_daily_cap', v_cap,
        'modules', to_jsonb(v_mod),
        'addons', to_jsonb(v_addons),
        'own_ai_key', p.own_ai_key,
        'powered_by', p.show_powered_by AND NOT ('own_domain' = ANY (v_mod)));
    PERFORM set_config(v_key, r::text, true);
    RETURN r;
END;
$$;
REVOKE ALL ON FUNCTION public.fn_tenant_plan(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_tenant_plan(uuid) TO service_role;

-- The module a permission belongs to (NULL = core, every plan).
CREATE OR REPLACE FUNCTION public.fn_permission_module(p_code text)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT mp.module FROM public.module_permissions mp
    WHERE p_code LIKE mp.pattern
    ORDER BY length(mp.pattern) DESC
    LIMIT 1;
$$;
REVOKE ALL ON FUNCTION public.fn_permission_module(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_permission_module(text) TO service_role;

-- Does the business's plan include this module? Core (NULL) always does. Truthful for every
-- caller (edge functions use it with the service role).
CREATE OR REPLACE FUNCTION public.has_module(p_business_id uuid, p_module text)
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    r jsonb;
BEGIN
    IF p_module IS NULL OR p_module = '' THEN
        RETURN true;
    END IF;
    r := public.fn_tenant_plan(public.fn_business_tenant(p_business_id));
    RETURN COALESCE(r->'modules' ? p_module, false);
END;
$$;
REVOKE ALL ON FUNCTION public.has_module(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.has_module(uuid, text) TO service_role;

-- has_permission (20261201005) plus modules: a permission whose module the plan lacks is not
-- granted, to the Owner either. Non-app callers still get TRUE before any lookup, as before.
CREATE OR REPLACE FUNCTION public.has_permission(p_business_id uuid, VARIADIC p_permissions text[])
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_role TEXT;
    v_code TEXT;
    v_granted BOOLEAN;
    v_key TEXT;
    v_hit TEXT;
    v_codes TEXT[];
    v_result BOOLEAN := FALSE;
BEGIN
    IF COALESCE(current_setting('role', TRUE), 'none') NOT IN ('anon', 'authenticated') THEN
        RETURN TRUE;
    END IF;

    -- Already answered in this request?
    v_key := 'isms_hp.k' || md5(COALESCE(auth.uid()::text, '-') || '|' || COALESCE(p_business_id::text, '-')
                                || '|' || array_to_string(p_permissions, ',') || '|' || public.fn_perm_cache_gen());
    v_hit := current_setting(v_key, TRUE);
    IF v_hit IN ('t', 'f') THEN
        RETURN v_hit = 't';
    END IF;

    -- Only the permissions whose module is in the plan count.
    v_codes := ARRAY(SELECT c FROM unnest(p_permissions) c
                     WHERE public.has_module(p_business_id, public.fn_permission_module(c)));

    IF cardinality(v_codes) = 0 THEN
        v_result := FALSE;
    ELSE
        SELECT bm.role::TEXT INTO v_role
        FROM public.business_memberships bm
        JOIN public.users u ON u.id = bm.user_id
        WHERE u.auth_user_id = auth.uid()
          AND bm.business_id = p_business_id
          AND bm.status = 'Active';

        IF v_role IS NULL THEN
            v_result := FALSE;
        ELSIF v_role IN ('Owner', 'Admin', 'Administrator') THEN
            v_result := TRUE;
        ELSE
            FOREACH v_code IN ARRAY v_codes LOOP
                SELECT rp.granted INTO v_granted
                FROM public.role_permissions rp
                WHERE rp.business_id = p_business_id AND rp.role::TEXT = v_role AND rp.permission = v_code;

                IF COALESCE(v_granted, v_code = ANY(
                    COALESCE((SELECT d.permissions FROM public.role_default_permissions d WHERE d.role = v_role), '{}')
                )) THEN
                    v_result := TRUE;
                    EXIT;
                END IF;
            END LOOP;
        END IF;
    END IF;

    PERFORM set_config(v_key, CASE WHEN v_result THEN 't' ELSE 'f' END, TRUE);
    RETURN v_result;
END;
$function$;

-- Branches of one company: stock transfers, promotions and referrals use this.
CREATE OR REPLACE FUNCTION public.fn_branches_share_owner(p_a uuid, p_b uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.businesses a
        JOIN public.businesses b ON b.tenant_id = a.tenant_id
        WHERE a.id = p_a AND b.id = p_b
    );
$$;

-- ============================================================================================
-- 6. Read-only: no app writes to a tenant's business tables unless its plan is writable
-- ============================================================================================
CREATE OR REPLACE FUNCTION public.fn_plan_read_only_message(p_status text)
RETURNS text
LANGUAGE sql IMMUTABLE
SET search_path = ''
AS $$
    SELECT CASE p_status
        WHEN 'suspended' THEN 'This business is suspended. Contact support to continue.'
        ELSE 'This business is read-only until a plan is chosen. Your records are safe and can still be viewed and exported.'
    END;
$$;

CREATE OR REPLACE FUNCTION public.fn_block_when_read_only()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_business uuid;
    r jsonb;
BEGIN
    IF COALESCE(current_setting('role', true), 'none') NOT IN ('anon', 'authenticated') THEN
        RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
    END IF;
    IF TG_OP = 'DELETE' THEN
        v_business := (to_jsonb(OLD)->>'business_id')::uuid;
    ELSE
        v_business := (to_jsonb(NEW)->>'business_id')::uuid;
    END IF;
    IF v_business IS NOT NULL THEN
        r := public.fn_tenant_plan(public.fn_business_tenant(v_business));
        IF r IS NOT NULL AND NOT (r->>'writable')::boolean THEN
            RAISE EXCEPTION '%', public.fn_plan_read_only_message(r->>'status')
                USING ERRCODE = '42501', HINT = 'plan_read_only';
        END IF;
    END IF;
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;
REVOKE ALL ON FUNCTION public.fn_block_when_read_only() FROM PUBLIC, anon, authenticated;

-- Tables that stay writable while read-only: sign-in and membership housekeeping, the trail,
-- notifications and problem reports. Keep this list in step with grants_check.sql.
DO $$
DECLARE
    t text;
BEGIN
    FOR t IN
        SELECT c.relname
        FROM pg_class c
        JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'business_id' AND NOT a.attisdropped
        WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'r'
          AND c.relname NOT IN ('audit_logs', 'notifications', 'notification_preferences',
                                'business_memberships', 'crash_reports', 'problem_reports')
    LOOP
        EXECUTE format('DROP TRIGGER IF EXISTS trg_zz_plan_read_only ON public.%I', t);
        EXECUTE format('CREATE TRIGGER trg_zz_plan_read_only BEFORE INSERT OR UPDATE OR DELETE ON public.%I '
                       'FOR EACH ROW EXECUTE FUNCTION public.fn_block_when_read_only()', t);
    END LOOP;
END;
$$;

-- ============================================================================================
-- 7. Limits: branches and staff
-- ============================================================================================
-- Staff = active members in any of the tenant's branches, except Owner, riders and suppliers.
CREATE OR REPLACE FUNCTION public.fn_tenant_staff_used(p_tenant_id uuid, p_exclude_user uuid DEFAULT NULL)
RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT count(DISTINCT bm.user_id)::integer
    FROM public.business_memberships bm
    JOIN public.businesses b ON b.id = bm.business_id
    WHERE b.tenant_id = p_tenant_id AND b.deleted_at IS NULL
      AND bm.status = 'Active'
      AND bm.role NOT IN ('Owner', 'Rider', 'Supplier')
      AND bm.user_id IS DISTINCT FROM p_exclude_user;
$$;
REVOKE ALL ON FUNCTION public.fn_tenant_staff_used(uuid, uuid) FROM PUBLIC, anon, authenticated;

-- Pending invitations that will take a staff place (not for someone already on the staff).
CREATE OR REPLACE FUNCTION public.fn_tenant_staff_pending(p_tenant_id uuid, p_exclude_invitation uuid DEFAULT NULL)
RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT count(DISTINCT lower(COALESCE(NULLIF(i.email, ''), NULLIF(i.phone, ''), i.id::text)))::integer
    FROM public.invitations i
    JOIN public.businesses b ON b.id = i.business_id
    WHERE b.tenant_id = p_tenant_id AND b.deleted_at IS NULL
      AND i.status = 'Pending' AND i.expires_at > now()
      AND i.role NOT IN ('Owner', 'Rider', 'Supplier')
      AND i.id IS DISTINCT FROM p_exclude_invitation
      AND NOT EXISTS (
          SELECT 1 FROM public.business_memberships bm
          JOIN public.businesses b2 ON b2.id = bm.business_id
          JOIN public.users u ON u.id = bm.user_id
          WHERE b2.tenant_id = p_tenant_id AND bm.status = 'Active'
            AND bm.role NOT IN ('Owner', 'Rider', 'Supplier')
            AND i.email IS NOT NULL AND lower(u.email) = lower(i.email));
$$;
REVOKE ALL ON FUNCTION public.fn_tenant_staff_pending(uuid, uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.fn_check_branch_limit()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    r jsonb;
    v_count integer;
BEGIN
    IF COALESCE(current_setting('role', true), 'none') NOT IN ('anon', 'authenticated') THEN
        RETURN NEW;
    END IF;
    IF TG_OP = 'UPDATE' AND NOT (OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS NULL) THEN
        RETURN NEW;
    END IF;
    -- One change at a time per tenant, so two new branches can't both slip in.
    PERFORM 1 FROM public.tenant_subscriptions WHERE tenant_id = NEW.tenant_id FOR UPDATE;
    r := public.fn_tenant_plan(NEW.tenant_id);
    IF r IS NULL THEN
        RETURN NEW;
    END IF;
    IF NOT (r->>'writable')::boolean THEN
        RAISE EXCEPTION '%', public.fn_plan_read_only_message(r->>'status') USING ERRCODE = '42501', HINT = 'plan_read_only';
    END IF;
    SELECT count(*) INTO v_count FROM public.businesses
    WHERE tenant_id = NEW.tenant_id AND deleted_at IS NULL AND id <> NEW.id;
    IF v_count >= (r->>'max_branches')::integer THEN
        RAISE EXCEPTION 'Your plan (%) allows % %. Upgrade to add more.', r->>'plan_name', r->>'max_branches',
            CASE WHEN (r->>'max_branches')::integer = 1 THEN 'branch' ELSE 'branches' END
            USING ERRCODE = '42501', HINT = 'plan_limit_branches';
    END IF;
    RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.fn_check_branch_limit() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_b_branch_limit ON public.businesses;
CREATE TRIGGER trg_b_branch_limit BEFORE INSERT OR UPDATE OF deleted_at ON public.businesses
    FOR EACH ROW EXECUTE FUNCTION public.fn_check_branch_limit();

CREATE OR REPLACE FUNCTION public.fn_staff_limit_message(r jsonb)
RETURNS text
LANGUAGE sql IMMUTABLE
SET search_path = ''
AS $$
    SELECT format('Your plan (%s) allows %s staff (the owner, riders and suppliers don''t count). Upgrade or remove someone first.',
                  r->>'plan_name', r->>'max_staff');
$$;

CREATE OR REPLACE FUNCTION public.fn_check_invitation_staff_limit()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_tenant uuid;
    r jsonb;
BEGIN
    IF COALESCE(current_setting('role', true), 'none') NOT IN ('anon', 'authenticated')
       OR NEW.status <> 'Pending' OR NEW.role IN ('Owner', 'Rider', 'Supplier') THEN
        RETURN NEW;
    END IF;
    IF TG_OP = 'UPDATE' AND OLD.status = 'Pending' AND OLD.role NOT IN ('Owner', 'Rider', 'Supplier') THEN
        RETURN NEW;  -- already holding a place
    END IF;
    -- Someone who may not invite is refused by row security, without learning the plan's limits.
    IF NOT public.has_permission(NEW.business_id, 'staff.invite') THEN
        RETURN NEW;
    END IF;
    v_tenant := public.fn_business_tenant(NEW.business_id);
    -- Someone already on the staff of this company takes no new place.
    IF NEW.email IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.business_memberships bm
        JOIN public.businesses b ON b.id = bm.business_id
        JOIN public.users u ON u.id = bm.user_id
        WHERE b.tenant_id = v_tenant AND bm.status = 'Active'
          AND bm.role NOT IN ('Owner', 'Rider', 'Supplier') AND lower(u.email) = lower(NEW.email)) THEN
        RETURN NEW;
    END IF;
    PERFORM 1 FROM public.tenant_subscriptions WHERE tenant_id = v_tenant FOR UPDATE;
    r := public.fn_tenant_plan(v_tenant);
    IF r IS NULL THEN
        RETURN NEW;
    END IF;
    IF public.fn_tenant_staff_used(v_tenant) + public.fn_tenant_staff_pending(v_tenant, NEW.id)
       >= (r->>'max_staff')::integer THEN
        RAISE EXCEPTION '%', public.fn_staff_limit_message(r) USING ERRCODE = '42501', HINT = 'plan_limit_staff';
    END IF;
    RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.fn_check_invitation_staff_limit() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_invitation_staff_limit ON public.invitations;
CREATE TRIGGER trg_invitation_staff_limit BEFORE INSERT OR UPDATE OF status, role ON public.invitations
    FOR EACH ROW EXECUTE FUNCTION public.fn_check_invitation_staff_limit();

CREATE OR REPLACE FUNCTION public.fn_check_membership_staff_limit()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_tenant uuid;
    r jsonb;
BEGIN
    IF COALESCE(current_setting('role', true), 'none') NOT IN ('anon', 'authenticated')
       OR NEW.status <> 'Active' OR NEW.role IN ('Owner', 'Rider', 'Supplier') THEN
        RETURN NEW;
    END IF;
    IF TG_OP = 'UPDATE' AND OLD.status = 'Active' AND OLD.role NOT IN ('Owner', 'Rider', 'Supplier') THEN
        RETURN NEW;  -- already counted
    END IF;
    v_tenant := public.fn_business_tenant(NEW.business_id);
    -- Already on the staff of another branch of this company: no new place.
    IF EXISTS (SELECT 1 FROM public.business_memberships bm
               JOIN public.businesses b ON b.id = bm.business_id
               WHERE b.tenant_id = v_tenant AND bm.user_id = NEW.user_id AND bm.id <> NEW.id
                 AND bm.status = 'Active' AND bm.role NOT IN ('Owner', 'Rider', 'Supplier')) THEN
        RETURN NEW;
    END IF;
    PERFORM 1 FROM public.tenant_subscriptions WHERE tenant_id = v_tenant FOR UPDATE;
    r := public.fn_tenant_plan(v_tenant);
    IF r IS NULL THEN
        RETURN NEW;
    END IF;
    IF public.fn_tenant_staff_used(v_tenant, NEW.user_id) >= (r->>'max_staff')::integer THEN
        RAISE EXCEPTION '%', public.fn_staff_limit_message(r) USING ERRCODE = '42501', HINT = 'plan_limit_staff';
    END IF;
    RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.fn_check_membership_staff_limit() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_membership_staff_limit ON public.business_memberships;
CREATE TRIGGER trg_membership_staff_limit BEFORE INSERT OR UPDATE OF status, role ON public.business_memberships
    FOR EACH ROW EXECUTE FUNCTION public.fn_check_membership_staff_limit();

-- ============================================================================================
-- 8. Trial claims and sign-up requests
-- ============================================================================================
CREATE TABLE IF NOT EXISTS public.trial_claims (
    auth_user_id uuid PRIMARY KEY,
    email text,
    tenant_id uuid REFERENCES public.tenants(id) ON DELETE SET NULL,
    claimed_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_trial_claims_email ON public.trial_claims (lower(email)) WHERE email IS NOT NULL;
ALTER TABLE public.trial_claims ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS pol_trial_claims_select ON public.trial_claims;
CREATE POLICY pol_trial_claims_select ON public.trial_claims FOR SELECT TO authenticated
    USING (auth_user_id = (SELECT auth.uid()) OR (SELECT public.is_platform_admin()));
REVOKE ALL ON public.trial_claims FROM anon, authenticated;
GRANT SELECT ON public.trial_claims TO authenticated;
GRANT ALL ON public.trial_claims TO service_role;

CREATE TABLE IF NOT EXISTS public.signup_requests (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    auth_user_id uuid NOT NULL,
    email text,
    plan_code text NOT NULL REFERENCES public.plans(code),
    billing_cycle text NOT NULL CHECK (billing_cycle IN ('monthly', 'annual', 'one_time')),
    business_name text NOT NULL CHECK (length(trim(business_name)) > 0),
    phone text,
    message text CHECK (message IS NULL OR length(message) <= 2000),
    addons text[] NOT NULL DEFAULT '{}',
    status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'used', 'cancelled')),
    payment_reference text,
    decided_by uuid,
    decided_at timestamptz,
    decision_note text,
    tenant_id uuid REFERENCES public.tenants(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_signup_requests_user ON public.signup_requests(auth_user_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_signup_requests_one_open ON public.signup_requests(auth_user_id)
    WHERE status IN ('pending', 'approved');
ALTER TABLE public.signup_requests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS pol_signup_requests_select ON public.signup_requests;
CREATE POLICY pol_signup_requests_select ON public.signup_requests FOR SELECT TO authenticated
    USING (auth_user_id = (SELECT auth.uid()) OR (SELECT public.is_platform_admin()));
REVOKE ALL ON public.signup_requests FROM anon, authenticated;
GRANT SELECT ON public.signup_requests TO authenticated;
GRANT ALL ON public.signup_requests TO service_role;

CREATE OR REPLACE FUNCTION public.fn_can_start_trial(p_auth_user_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT COALESCE((SELECT trial_enabled FROM public.platform_settings WHERE id), false)
       AND NOT EXISTS (
           SELECT 1 FROM public.trial_claims tc
           WHERE tc.auth_user_id = p_auth_user_id
              OR lower(tc.email) = (SELECT lower(au.email) FROM auth.users au WHERE au.id = p_auth_user_id));
$$;
REVOKE ALL ON FUNCTION public.fn_can_start_trial(uuid) FROM PUBLIC, anon, authenticated;

-- Where the signed-in person stands before they have a company: can they start a trial, is a
-- request waiting, which plans can they choose.
CREATE OR REPLACE FUNCTION public.my_signup_state()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_uid uuid := auth.uid();
    v_req jsonb;
    s public.platform_settings;
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'Please sign in.' USING ERRCODE = '42501';
    END IF;
    SELECT * INTO s FROM public.platform_settings WHERE id;
    SELECT to_jsonb(r) INTO v_req FROM (
        SELECT id, plan_code, billing_cycle, business_name, status, decision_note, created_at, decided_at
        FROM public.signup_requests
        WHERE auth_user_id = v_uid AND status IN ('pending', 'approved', 'rejected')
        ORDER BY created_at DESC LIMIT 1) r;
    RETURN jsonb_build_object(
        'email_verified', public.account_email_verified(v_uid),
        'owns_company', EXISTS (SELECT 1 FROM public.tenants t JOIN public.users u ON u.id = t.owner_user_id
                                WHERE u.auth_user_id = v_uid),
        'trial_enabled', s.trial_enabled,
        'trial_days', s.trial_days,
        'can_start_trial', public.fn_can_start_trial(v_uid),
        'request', v_req,
        'is_platform_admin', public.is_platform_admin(v_uid));
END;
$$;
REVOKE ALL ON FUNCTION public.my_signup_state() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_signup_state() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.request_business_signup(
    p_plan_code text, p_billing_cycle text, p_business_name text,
    p_phone text DEFAULT NULL, p_message text DEFAULT NULL, p_addons text[] DEFAULT '{}')
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_uid uuid := auth.uid();
    p public.plans;
    v_id uuid;
BEGIN
    IF v_uid IS NULL OR NOT public.account_email_verified(v_uid) THEN
        RAISE EXCEPTION 'Please verify your email first.' USING ERRCODE = '42501';
    END IF;
    SELECT * INTO p FROM public.plans WHERE code = p_plan_code AND active AND is_public;
    IF NOT FOUND OR p.kind = 'trial' THEN
        RAISE EXCEPTION 'Choose one of the plans.';
    END IF;
    IF (p.kind = 'perpetual') <> (p_billing_cycle = 'one_time') OR p_billing_cycle NOT IN ('monthly', 'annual', 'one_time') THEN
        RAISE EXCEPTION 'Choose how you want to pay for this plan.';
    END IF;
    IF EXISTS (SELECT 1 FROM unnest(COALESCE(p_addons, '{}')) a
               WHERE NOT p.addons_allowed OR a NOT IN (SELECT key FROM public.plan_modules WHERE addable)) THEN
        RAISE EXCEPTION 'Add-ons can only be added to the Pro plan.';
    END IF;
    IF EXISTS (SELECT 1 FROM public.signup_requests WHERE auth_user_id = v_uid AND status IN ('pending', 'approved')) THEN
        RAISE EXCEPTION 'You already have a request waiting. Cancel it first to make a new one.';
    END IF;
    INSERT INTO public.signup_requests (auth_user_id, email, plan_code, billing_cycle, business_name, phone, message, addons)
    VALUES (v_uid, (SELECT email FROM auth.users WHERE id = v_uid), p.code, p_billing_cycle,
            trim(p_business_name), NULLIF(trim(COALESCE(p_phone, '')), ''), NULLIF(trim(COALESCE(p_message, '')), ''),
            COALESCE(p_addons, '{}'))
    RETURNING id INTO v_id;
    RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.request_business_signup(text, text, text, text, text, text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_business_signup(text, text, text, text, text, text[]) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.cancel_signup_request(p_request_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    UPDATE public.signup_requests SET status = 'cancelled', updated_at = now()
    WHERE id = p_request_id AND auth_user_id = auth.uid() AND status IN ('pending', 'approved');
    IF NOT FOUND THEN
        RAISE EXCEPTION 'That request can''t be cancelled.';
    END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.cancel_signup_request(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_signup_request(uuid) TO authenticated, service_role;

-- ============================================================================================
-- 9. Creating a business: a new company (trial, approved request, or platform admin) or a new
--    branch of the company the person owns (branch limit applies)
-- ============================================================================================
CREATE OR REPLACE FUNCTION public.can_create_business()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT auth.uid() IS NOT NULL
       AND public.account_email_verified(auth.uid())
       AND (
           public.is_platform_admin(auth.uid())
           OR EXISTS (SELECT 1 FROM public.tenants t JOIN public.users u ON u.id = t.owner_user_id
                      WHERE u.auth_user_id = auth.uid())
           OR EXISTS (SELECT 1 FROM public.signup_requests r
                      WHERE r.auth_user_id = auth.uid() AND r.status = 'approved')
           OR public.fn_can_start_trial(auth.uid())
       );
$$;
REVOKE ALL ON FUNCTION public.can_create_business() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_create_business() TO authenticated, service_role;

DROP FUNCTION IF EXISTS public.create_business_with_owner(text, text, text, text, text, text, text);
CREATE OR REPLACE FUNCTION public.create_business_with_owner(
  p_name text, p_type text, p_country text, p_currency text,
  p_logo_url text, p_description text, p_address text,
  p_plan_code text DEFAULT NULL, p_new_company boolean DEFAULT false)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
    v_business_id UUID;
    v_user_id     UUID;
    v_uid         UUID := auth.uid();
    v_admin       BOOLEAN;
    v_tenant      UUID;
    v_req         public.signup_requests;
    v_plan        public.plans;
    s             public.platform_settings;
BEGIN
    IF NOT public.account_email_verified(v_uid) THEN
        RAISE EXCEPTION 'Please verify your email before creating a business.' USING ERRCODE = '42501';
    END IF;
    PERFORM pg_advisory_xact_lock(hashtext('create_business_with_owner'));

    SELECT id INTO v_user_id FROM public.users WHERE auth_user_id = v_uid;
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'User profile not found. Please complete signup first.';
    END IF;
    v_admin := public.is_platform_admin(v_uid);
    SELECT * INTO s FROM public.platform_settings WHERE id;

    -- A new branch of the company this person owns.
    IF NOT (v_admin AND p_new_company) THEN
        SELECT t.id INTO v_tenant FROM public.tenants t
        WHERE t.owner_user_id = v_user_id ORDER BY t.created_at LIMIT 1;
    END IF;

    IF v_tenant IS NULL THEN
        -- A new company: platform admin (any plan, no payment), an approved request, or a trial.
        IF v_admin THEN
            SELECT * INTO v_plan FROM public.plans WHERE code = COALESCE(p_plan_code, s.trial_plan);
            IF NOT FOUND THEN
                RAISE EXCEPTION 'Unknown plan.';
            END IF;
        ELSE
            SELECT * INTO v_req FROM public.signup_requests
            WHERE auth_user_id = v_uid AND status = 'approved'
            ORDER BY decided_at DESC NULLS LAST LIMIT 1 FOR UPDATE;
            IF FOUND THEN
                SELECT * INTO v_plan FROM public.plans WHERE code = v_req.plan_code;
            ELSIF public.fn_can_start_trial(v_uid) THEN
                SELECT * INTO v_plan FROM public.plans WHERE code = s.trial_plan;
            ELSE
                RAISE EXCEPTION 'Choose a plan to start your business.' USING ERRCODE = '42501', HINT = 'plan_required';
            END IF;
        END IF;

        INSERT INTO public.tenants (name, owner_user_id) VALUES (trim(p_name), v_user_id) RETURNING id INTO v_tenant;
        UPDATE public.tenant_subscriptions SET
            plan_code = v_plan.code,
            status = CASE WHEN v_plan.kind = 'trial' THEN 'trial' ELSE 'active' END,
            billing_cycle = CASE WHEN v_plan.kind = 'trial' THEN 'trial'
                                 WHEN v_req.id IS NOT NULL THEN v_req.billing_cycle
                                 ELSE 'manual' END,
            trial_ends_at = CASE WHEN v_plan.kind = 'trial' THEN now() + make_interval(days => s.trial_days) END,
            current_period_end = CASE WHEN v_req.billing_cycle = 'monthly' THEN now() + interval '1 month'
                                      WHEN v_req.billing_cycle = 'annual' THEN now() + interval '1 year' END,
            addons = COALESCE(v_req.addons, '{}'),
            note = CASE WHEN v_admin THEN 'Created by the platform admin' END,
            updated_at = now(), updated_by = v_uid
        WHERE tenant_id = v_tenant;

        IF v_req.id IS NOT NULL THEN
            UPDATE public.signup_requests SET status = 'used', tenant_id = v_tenant, updated_at = now() WHERE id = v_req.id;
        ELSIF v_plan.kind = 'trial' AND NOT v_admin THEN
            INSERT INTO public.trial_claims (auth_user_id, email, tenant_id)
            VALUES (v_uid, (SELECT email FROM auth.users WHERE id = v_uid), v_tenant);
        END IF;
        PERFORM public.fn_platform_log(v_tenant, 'company_created',
            jsonb_build_object('plan', v_plan.code, 'request', v_req.id, 'by_admin', v_admin));
    END IF;

    INSERT INTO public.businesses
        (name, business_type, country, currency, logo_url, description, address, tenant_id)
    VALUES
        (p_name, p_type, p_country, p_currency, p_logo_url, p_description, p_address, v_tenant)
    RETURNING id INTO v_business_id;

    INSERT INTO public.branches (business_id, name, address)
    VALUES (v_business_id, 'Main branch', p_address);

    INSERT INTO public.business_memberships (business_id, user_id, role, status)
    VALUES (v_business_id, v_user_id, 'Owner', 'Active');

    INSERT INTO public.employees
        (id, business_id, user_id, name, role, email, phone, pin, assigned_branches)
    SELECT
        v_user_id, v_business_id, v_user_id,
        name, 'Owner', email, phone, '0000',
        jsonb_build_array(v_business_id::TEXT)
    FROM public.users
    WHERE id = v_user_id
    ON CONFLICT (id) DO UPDATE SET
        business_id = v_business_id,
        role        = 'Owner';

    RETURN v_business_id;
END;
$$;
REVOKE ALL ON FUNCTION public.create_business_with_owner(text, text, text, text, text, text, text, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_business_with_owner(text, text, text, text, text, text, text, text, boolean) TO authenticated, service_role;

-- ============================================================================================
-- 10. What the app shows: plan, limits and use for the business that is open
-- ============================================================================================
CREATE OR REPLACE FUNCTION public.get_plan_usage(p_business_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_tenant uuid;
    r jsonb;
BEGIN
    PERFORM public.assert_business_member(p_business_id);
    v_tenant := public.fn_business_tenant(p_business_id);
    r := public.fn_tenant_plan(v_tenant);
    IF r IS NULL THEN
        RETURN NULL;
    END IF;
    RETURN r || jsonb_build_object(
        'company_name', (SELECT name FROM public.tenants WHERE id = v_tenant),
        'branches_used', (SELECT count(*) FROM public.businesses WHERE tenant_id = v_tenant AND deleted_at IS NULL),
        'staff_used', public.fn_tenant_staff_used(v_tenant),
        'staff_pending', public.fn_tenant_staff_pending(v_tenant),
        'is_company_owner', EXISTS (SELECT 1 FROM public.tenants t JOIN public.users u ON u.id = t.owner_user_id
                                    WHERE t.id = v_tenant AND u.auth_user_id = auth.uid()));
END;
$$;
REVOKE ALL ON FUNCTION public.get_plan_usage(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_plan_usage(uuid) TO authenticated, service_role;

-- ============================================================================================
-- 11. Platform admin functions (the admin website)
-- ============================================================================================
CREATE OR REPLACE FUNCTION public.platform_update_settings(p_settings jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    r jsonb;
BEGIN
    PERFORM public.fn_require_platform_admin();
    IF EXISTS (SELECT 1 FROM jsonb_object_keys(COALESCE(p_settings, '{}')) k
               WHERE k NOT IN ('trial_enabled', 'trial_days', 'trial_plan', 'grace_days', 'read_only_days', 'platform_domain')) THEN
        RAISE EXCEPTION 'Unknown setting.';
    END IF;
    IF p_settings ? 'trial_plan' AND NOT EXISTS (SELECT 1 FROM public.plans WHERE code = p_settings->>'trial_plan') THEN
        RAISE EXCEPTION 'Unknown plan.';
    END IF;
    UPDATE public.platform_settings SET
        trial_enabled   = COALESCE((p_settings->>'trial_enabled')::boolean, trial_enabled),
        trial_days      = COALESCE((p_settings->>'trial_days')::integer, trial_days),
        trial_plan      = COALESCE(p_settings->>'trial_plan', trial_plan),
        grace_days      = COALESCE((p_settings->>'grace_days')::integer, grace_days),
        read_only_days  = COALESCE((p_settings->>'read_only_days')::integer, read_only_days),
        platform_domain = CASE WHEN p_settings ? 'platform_domain'
                               THEN NULLIF(lower(trim(p_settings->>'platform_domain')), '') ELSE platform_domain END,
        updated_at = now(), updated_by = auth.uid()
    WHERE id
    RETURNING to_jsonb(platform_settings.*) INTO r;
    PERFORM public.fn_platform_log(NULL, 'settings_changed', p_settings);
    RETURN r;
END;
$$;
REVOKE ALL ON FUNCTION public.platform_update_settings(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.platform_update_settings(jsonb) TO authenticated, service_role;

-- Put a tenant on any plan by hand, paid or not. Returns the plan now in force, with a warning
-- when the company is over the new plan's limits (nothing is removed).
CREATE OR REPLACE FUNCTION public.platform_set_plan(
    p_tenant_id uuid, p_plan_code text, p_status text DEFAULT 'active',
    p_billing_cycle text DEFAULT 'manual', p_period_end timestamptz DEFAULT NULL, p_note text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    p public.plans;
    s public.platform_settings;
    r jsonb;
    v_warn text[] := '{}';
    v_branches integer;
BEGIN
    PERFORM public.fn_require_platform_admin();
    SELECT * INTO p FROM public.plans WHERE code = p_plan_code;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Unknown plan.';
    END IF;
    IF p_status NOT IN ('trial', 'active', 'suspended') THEN
        RAISE EXCEPTION 'Status must be trial, active or suspended.';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.tenant_subscriptions WHERE tenant_id = p_tenant_id) THEN
        RAISE EXCEPTION 'Unknown company.';
    END IF;
    SELECT * INTO s FROM public.platform_settings WHERE id;
    UPDATE public.tenant_subscriptions SET
        plan_code = p.code,
        status = p_status,
        billing_cycle = CASE WHEN p_status = 'trial' THEN 'trial' ELSE COALESCE(p_billing_cycle, 'manual') END,
        trial_ends_at = CASE WHEN p_status = 'trial'
                             THEN GREATEST(COALESCE(trial_ends_at, now()), now() + make_interval(days => s.trial_days))
                             ELSE trial_ends_at END,
        current_period_end = CASE WHEN p_status = 'trial' THEN NULL ELSE p_period_end END,
        addons = CASE WHEN p.addons_allowed THEN addons ELSE '{}' END,
        note = COALESCE(p_note, note),
        updated_at = now(), updated_by = auth.uid()
    WHERE tenant_id = p_tenant_id;
    PERFORM public.fn_platform_log(p_tenant_id, 'plan_set',
        jsonb_build_object('plan', p.code, 'status', p_status, 'cycle', p_billing_cycle, 'period_end', p_period_end, 'note', p_note));

    r := public.fn_tenant_plan(p_tenant_id);
    SELECT count(*) INTO v_branches FROM public.businesses WHERE tenant_id = p_tenant_id AND deleted_at IS NULL;
    IF v_branches > (r->>'max_branches')::integer THEN
        v_warn := v_warn || format('%s branches open; the plan allows %s.', v_branches, r->>'max_branches');
    END IF;
    IF public.fn_tenant_staff_used(p_tenant_id) > (r->>'max_staff')::integer THEN
        v_warn := v_warn || format('%s staff; the plan allows %s.', public.fn_tenant_staff_used(p_tenant_id), r->>'max_staff');
    END IF;
    RETURN r || jsonb_build_object('warnings', to_jsonb(v_warn));
END;
$$;
REVOKE ALL ON FUNCTION public.platform_set_plan(uuid, text, text, text, timestamptz, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.platform_set_plan(uuid, text, text, text, timestamptz, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.platform_set_addons(p_tenant_id uuid, p_addons text[])
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_allowed boolean;
BEGIN
    PERFORM public.fn_require_platform_admin();
    SELECT p.addons_allowed INTO v_allowed
    FROM public.tenant_subscriptions s JOIN public.plans p ON p.code = s.plan_code
    WHERE s.tenant_id = p_tenant_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Unknown company.';
    END IF;
    IF cardinality(COALESCE(p_addons, '{}')) > 0 AND NOT v_allowed THEN
        RAISE EXCEPTION 'Add-ons can only be added to the Pro plan.';
    END IF;
    IF EXISTS (SELECT 1 FROM unnest(COALESCE(p_addons, '{}')) a
               WHERE a NOT IN (SELECT key FROM public.plan_modules WHERE addable)) THEN
        RAISE EXCEPTION 'That module can''t be bought on its own.';
    END IF;
    UPDATE public.tenant_subscriptions
    SET addons = ARRAY(SELECT DISTINCT unnest(COALESCE(p_addons, '{}')) ORDER BY 1),
        updated_at = now(), updated_by = auth.uid()
    WHERE tenant_id = p_tenant_id;
    PERFORM public.fn_platform_log(p_tenant_id, 'addons_set', jsonb_build_object('addons', p_addons));
    RETURN public.fn_tenant_plan(p_tenant_id);
END;
$$;
REVOKE ALL ON FUNCTION public.platform_set_addons(uuid, text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.platform_set_addons(uuid, text[]) TO authenticated, service_role;

-- Custom limits for one company (large businesses): max_branches, max_staff, storage_mb,
-- ai_daily_cap (numbers; null clears) and modules (extra modules, a list). {} clears all.
CREATE OR REPLACE FUNCTION public.platform_set_custom_limits(p_tenant_id uuid, p_limits jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    k text;
BEGIN
    PERFORM public.fn_require_platform_admin();
    FOR k IN SELECT jsonb_object_keys(COALESCE(p_limits, '{}')) LOOP
        IF k NOT IN ('max_branches', 'max_staff', 'storage_mb', 'ai_daily_cap', 'modules') THEN
            RAISE EXCEPTION 'Unknown limit: %', k;
        END IF;
        IF k <> 'modules' AND jsonb_typeof(p_limits->k) NOT IN ('number', 'null') THEN
            RAISE EXCEPTION '% must be a number.', k;
        END IF;
        IF k <> 'modules' AND jsonb_typeof(p_limits->k) = 'number'
           AND ((p_limits->>k)::numeric < CASE WHEN k = 'max_branches' THEN 1 ELSE 0 END
                OR (p_limits->>k)::numeric <> trunc((p_limits->>k)::numeric)) THEN
            RAISE EXCEPTION '% must be a whole number of at least %.', k, CASE WHEN k = 'max_branches' THEN 1 ELSE 0 END;
        END IF;
    END LOOP;
    IF jsonb_typeof(p_limits->'modules') = 'array' AND EXISTS (
        SELECT 1 FROM jsonb_array_elements_text(p_limits->'modules') m
        WHERE m NOT IN (SELECT key FROM public.plan_modules)) THEN
        RAISE EXCEPTION 'Unknown module.';
    END IF;
    UPDATE public.tenant_subscriptions
    SET custom_limits = jsonb_strip_nulls(COALESCE(p_limits, '{}')), updated_at = now(), updated_by = auth.uid()
    WHERE tenant_id = p_tenant_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Unknown company.';
    END IF;
    PERFORM public.fn_platform_log(p_tenant_id, 'custom_limits_set', p_limits);
    RETURN public.fn_tenant_plan(p_tenant_id);
END;
$$;
REVOKE ALL ON FUNCTION public.platform_set_custom_limits(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.platform_set_custom_limits(uuid, jsonb) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.platform_extend_trial(p_tenant_id uuid, p_days integer)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    PERFORM public.fn_require_platform_admin();
    IF p_days IS NULL OR p_days < 1 OR p_days > 90 THEN
        RAISE EXCEPTION 'Extend by 1 to 90 days.';
    END IF;
    UPDATE public.tenant_subscriptions
    SET trial_ends_at = GREATEST(COALESCE(trial_ends_at, now()), now()) + make_interval(days => p_days),
        updated_at = now(), updated_by = auth.uid()
    WHERE tenant_id = p_tenant_id AND status = 'trial';
    IF NOT FOUND THEN
        RAISE EXCEPTION 'That company is not on a trial.';
    END IF;
    PERFORM public.fn_platform_log(p_tenant_id, 'trial_extended', jsonb_build_object('days', p_days));
    RETURN public.fn_tenant_plan(p_tenant_id);
END;
$$;
REVOKE ALL ON FUNCTION public.platform_extend_trial(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.platform_extend_trial(uuid, integer) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.platform_decide_signup(p_request_id uuid, p_approve boolean, p_note text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    PERFORM public.fn_require_platform_admin();
    UPDATE public.signup_requests
    SET status = CASE WHEN p_approve THEN 'approved' ELSE 'rejected' END,
        decided_by = auth.uid(), decided_at = now(), decision_note = p_note, updated_at = now()
    WHERE id = p_request_id AND status = 'pending';
    IF NOT FOUND THEN
        RAISE EXCEPTION 'That request is not waiting for a decision.';
    END IF;
    PERFORM public.fn_platform_log(NULL, CASE WHEN p_approve THEN 'signup_approved' ELSE 'signup_rejected' END,
        jsonb_build_object('request', p_request_id, 'note', p_note));
END;
$$;
REVOKE ALL ON FUNCTION public.platform_decide_signup(uuid, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.platform_decide_signup(uuid, boolean, text) TO authenticated, service_role;

-- Every company with counts only (no sales amounts, customers or products).
CREATE OR REPLACE FUNCTION public.platform_tenants()
RETURNS TABLE (
    tenant_id uuid, name text, owner_name text, owner_email text,
    plan text, plan_name text, status text, trial_ends_at timestamptz, period_end timestamptz,
    addons jsonb, branches integer, max_branches integer, staff integer, max_staff integer,
    created_at timestamptz, last_sale_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    PERFORM public.fn_require_platform_admin();
    RETURN QUERY
    SELECT t.id, t.name, u.name, u.email,
           r->>'plan', r->>'plan_name', r->>'status',
           (r->>'trial_ends_at')::timestamptz, (r->>'period_end')::timestamptz, r->'addons',
           (SELECT count(*)::integer FROM public.businesses b WHERE b.tenant_id = t.id AND b.deleted_at IS NULL),
           (r->>'max_branches')::integer,
           public.fn_tenant_staff_used(t.id), (r->>'max_staff')::integer,
           t.created_at,
           (SELECT max(tx.timestamp) FROM public.transactions tx JOIN public.businesses b ON b.id = tx.business_id
            WHERE b.tenant_id = t.id)
    FROM public.tenants t
    LEFT JOIN public.users u ON u.id = t.owner_user_id
    CROSS JOIN LATERAL (SELECT public.fn_tenant_plan(t.id) AS r) x
    ORDER BY t.created_at DESC;
END;
$$;
REVOKE ALL ON FUNCTION public.platform_tenants() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.platform_tenants() TO authenticated, service_role;

-- ===================================================================
-- 20261204002_ai_platform_usage
-- ===================================================================
-- 20261204002_ai_platform_usage.sql
-- The AI is run by the platform, not by each business (SaaS step 4, owner decision 2026-11-24).
--
--   * platform_ai_settings: one row. Provider, model and tuning for every business; the keys
--     stay as server secrets (HF_TOKEN_A..E, GEMINI_API_KEY, ...). Only the platform admin
--     changes it.
--   * A business keeps only its "Assistant instructions" (ai_settings.system_prompt) and the
--     on/off switch. Provider, model and key in ai_settings are used only when the plan says
--     the business brings its own AI key (Perpetual).
--   * ai_usage: AI requests per company per day (Nairobi). fn_ai_use() is called by every
--     edge function before it runs the AI: it refuses when the plan has no AI, when the plan
--     is read-only or suspended, or when today's cap is used up, and counts the request.
--   * get_ai_usage(): what the app shows (used today, the cap, own key or not).

-- ============================================================================================
-- 1. Platform AI settings
-- ============================================================================================
CREATE TABLE IF NOT EXISTS public.platform_ai_settings (
    id boolean PRIMARY KEY DEFAULT true CHECK (id),
    provider text NOT NULL DEFAULT 'huggingface',
    model text NOT NULL DEFAULT 'Qwen/Qwen2.5-72B-Instruct',
    temperature numeric(4,2) NOT NULL DEFAULT 0.7 CHECK (temperature >= 0 AND temperature <= 2),
    max_tokens integer NOT NULL DEFAULT 2048 CHECK (max_tokens BETWEEN 64 AND 32768),
    top_p numeric(4,2) NOT NULL DEFAULT 0.95 CHECK (top_p > 0 AND top_p <= 1),
    top_k integer NOT NULL DEFAULT 40 CHECK (top_k >= 0),
    enabled boolean NOT NULL DEFAULT true,
    updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.platform_ai_settings (id) VALUES (true) ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.platform_ai_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS pol_platform_ai_settings_select ON public.platform_ai_settings;
CREATE POLICY pol_platform_ai_settings_select ON public.platform_ai_settings
    FOR SELECT TO authenticated USING (public.is_platform_admin());
REVOKE ALL ON public.platform_ai_settings FROM anon, authenticated;
GRANT SELECT ON public.platform_ai_settings TO authenticated;
GRANT ALL ON public.platform_ai_settings TO service_role;

CREATE OR REPLACE FUNCTION public.platform_update_ai_settings(p_settings jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    r public.platform_ai_settings;
BEGIN
    PERFORM public.fn_require_platform_admin();
    UPDATE public.platform_ai_settings SET
        provider    = COALESCE(NULLIF(btrim(p_settings->>'provider'), ''), provider),
        model       = COALESCE(NULLIF(btrim(p_settings->>'model'), ''), model),
        temperature = COALESCE((p_settings->>'temperature')::numeric, temperature),
        max_tokens  = COALESCE((p_settings->>'max_tokens')::integer, max_tokens),
        top_p       = COALESCE((p_settings->>'top_p')::numeric, top_p),
        top_k       = COALESCE((p_settings->>'top_k')::integer, top_k),
        enabled     = COALESCE((p_settings->>'enabled')::boolean, enabled),
        updated_at  = now()
    WHERE id
    RETURNING * INTO r;
    PERFORM public.fn_platform_log(NULL, 'ai_settings', p_settings);
    RETURN to_jsonb(r);
END;
$$;
REVOKE ALL ON FUNCTION public.platform_update_ai_settings(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.platform_update_ai_settings(jsonb) TO authenticated, service_role;

-- ============================================================================================
-- 2. Daily use per company
-- ============================================================================================
CREATE TABLE IF NOT EXISTS public.ai_usage (
    tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    day date NOT NULL,
    calls integer NOT NULL DEFAULT 0 CHECK (calls >= 0),
    refused integer NOT NULL DEFAULT 0 CHECK (refused >= 0),
    PRIMARY KEY (tenant_id, day)
);
ALTER TABLE public.ai_usage ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS pol_ai_usage_select ON public.ai_usage;
CREATE POLICY pol_ai_usage_select ON public.ai_usage
    FOR SELECT TO authenticated USING (public.is_platform_admin());
REVOKE ALL ON public.ai_usage FROM anon, authenticated;
GRANT SELECT ON public.ai_usage TO authenticated;
GRANT ALL ON public.ai_usage TO service_role;

CREATE OR REPLACE FUNCTION public.fn_ai_today()
RETURNS date
LANGUAGE sql STABLE
SET search_path = ''
AS $$ SELECT (now() AT TIME ZONE 'Africa/Nairobi')::date $$;

-- Called by edge functions (service role) before each AI request.
-- Returns {allowed, reason, used, cap, own_key}. reason: not_in_plan | read_only | cap_reached.
-- cap 0 with own_key = no cap (the business pays its own provider).
CREATE OR REPLACE FUNCTION public.fn_ai_use(p_business_id uuid, p_count boolean DEFAULT true)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_tenant uuid;
    r jsonb;
    v_cap integer;
    v_own boolean;
    v_used integer;
BEGIN
    v_tenant := public.fn_business_tenant(p_business_id);
    r := public.fn_tenant_plan(v_tenant);
    IF r IS NULL THEN
        RETURN jsonb_build_object('allowed', false, 'reason', 'not_in_plan', 'used', 0, 'cap', 0, 'own_key', false);
    END IF;
    v_cap := COALESCE((r->>'ai_daily_cap')::integer, 0);
    v_own := COALESCE((r->>'own_ai_key')::boolean, false);
    SELECT calls INTO v_used FROM public.ai_usage WHERE tenant_id = v_tenant AND day = public.fn_ai_today();
    v_used := COALESCE(v_used, 0);

    IF NOT COALESCE(r->'modules' ? 'ai', false) THEN
        RETURN jsonb_build_object('allowed', false, 'reason', 'not_in_plan', 'used', v_used, 'cap', v_cap, 'own_key', v_own);
    END IF;
    IF NOT COALESCE((r->>'writable')::boolean, false) THEN
        RETURN jsonb_build_object('allowed', false, 'reason', 'read_only', 'used', v_used, 'cap', v_cap, 'own_key', v_own);
    END IF;
    IF NOT p_count THEN
        RETURN jsonb_build_object('allowed', v_own OR v_cap = 0 OR v_used < v_cap,
                                  'reason', CASE WHEN v_own OR v_cap = 0 OR v_used < v_cap THEN NULL ELSE 'cap_reached' END,
                                  'used', v_used, 'cap', v_cap, 'own_key', v_own);
    END IF;

    -- A cap of 0 on a platform-run plan means the plan has AI but no daily limit was set:
    -- treat it as no cap only for own-key plans; otherwise nothing is allowed.
    IF NOT v_own AND v_cap <= 0 THEN
        RETURN jsonb_build_object('allowed', false, 'reason', 'cap_reached', 'used', v_used, 'cap', 0, 'own_key', false);
    END IF;

    INSERT INTO public.ai_usage AS u (tenant_id, day, calls)
    VALUES (v_tenant, public.fn_ai_today(), 1)
    ON CONFLICT (tenant_id, day) DO UPDATE SET calls = u.calls + 1
        WHERE v_own OR u.calls < v_cap
    RETURNING calls INTO v_used;

    IF v_used IS NULL THEN
        UPDATE public.ai_usage SET refused = refused + 1
        WHERE tenant_id = v_tenant AND day = public.fn_ai_today()
        RETURNING calls INTO v_used;
        RETURN jsonb_build_object('allowed', false, 'reason', 'cap_reached', 'used', v_used, 'cap', v_cap, 'own_key', v_own);
    END IF;
    RETURN jsonb_build_object('allowed', true, 'reason', NULL, 'used', v_used, 'cap', v_cap, 'own_key', v_own);
END;
$$;
REVOKE ALL ON FUNCTION public.fn_ai_use(uuid, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_ai_use(uuid, boolean) TO service_role;

-- The plan facts the AI runner needs (service role): own key or platform AI.
CREATE OR REPLACE FUNCTION public.fn_ai_plan(p_business_id uuid)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT jsonb_build_object(
        'own_key', COALESCE((r->>'own_ai_key')::boolean, false),
        'has_ai', COALESCE(r->'modules' ? 'ai', false),
        'platform', (SELECT to_jsonb(s) FROM public.platform_ai_settings s WHERE s.id))
    FROM (SELECT public.fn_tenant_plan(public.fn_business_tenant(p_business_id)) AS r) x;
$$;
REVOKE ALL ON FUNCTION public.fn_ai_plan(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_ai_plan(uuid) TO service_role;

-- What the app shows under Settings -> Assistant.
CREATE OR REPLACE FUNCTION public.get_ai_usage(p_business_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_tenant uuid;
    r jsonb;
BEGIN
    PERFORM public.assert_business_member(p_business_id);
    v_tenant := public.fn_business_tenant(p_business_id);
    r := public.fn_tenant_plan(v_tenant);
    RETURN jsonb_build_object(
        'has_ai', COALESCE(r->'modules' ? 'ai', false),
        'own_key', COALESCE((r->>'own_ai_key')::boolean, false),
        'cap', COALESCE((r->>'ai_daily_cap')::integer, 0),
        'used', COALESCE((SELECT calls FROM public.ai_usage WHERE tenant_id = v_tenant AND day = public.fn_ai_today()), 0),
        'resets_at', ((public.fn_ai_today() + 1)::timestamp AT TIME ZONE 'Africa/Nairobi'));
END;
$$;
REVOKE ALL ON FUNCTION public.get_ai_usage(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_ai_usage(uuid) TO authenticated, service_role;

-- ===================================================================
-- 20261204003_signup_join_plan_page
-- ===================================================================
-- 20261204003_signup_join_plan_page.sql
-- SaaS step 5: how people get in (owner decisions 2026-11-24, round 2 and 3).
--
--   * Prices the plan page shows: set-up fee per plan, add-on prices per module, VAT and the
--     payment instructions as platform settings. Nothing is hardcoded in the app.
--   * provider_cost_estimates: what a business pays OTHERS (Safaricom, card company, SMS,
--     domain). Rows the platform admin edits; the app only shows them as estimates.
--   * Plan-change requests from an existing company (signup_requests.kind = 'change'); the
--     platform admin's approval applies the plan.
--   * Join codes: one code per branch (8 letters, expires). Someone signed in enters it, the
--     branch sees a request, and someone with staff.invite lets them in and picks the role.
--     Businesses are never searchable: a wrong code says nothing about any business.
--   * Invitations sent to the signed-in person's verified email can be accepted from the
--     start screen without typing the code.
--   * my_signup_state() also returns those invitations and the person's join requests.

-- ============================================================================================
-- 1. Prices and payment details
-- ============================================================================================
ALTER TABLE public.plans
    ADD COLUMN IF NOT EXISTS setup_fee numeric(14,2) NOT NULL DEFAULT 0 CHECK (setup_fee >= 0);

ALTER TABLE public.plan_modules
    ADD COLUMN IF NOT EXISTS addon_monthly_price numeric(14,2) CHECK (addon_monthly_price >= 0),
    ADD COLUMN IF NOT EXISTS addon_annual_price numeric(14,2) CHECK (addon_annual_price >= 0);

ALTER TABLE public.platform_settings
    ADD COLUMN IF NOT EXISTS vat_percent numeric(5,2) NOT NULL DEFAULT 0 CHECK (vat_percent >= 0 AND vat_percent <= 50),
    ADD COLUMN IF NOT EXISTS payment_instructions text CHECK (payment_instructions IS NULL OR length(payment_instructions) <= 1000),
    ADD COLUMN IF NOT EXISTS terms_url text CHECK (terms_url IS NULL OR terms_url ~ '^https://'),
    ADD COLUMN IF NOT EXISTS contact_text text CHECK (contact_text IS NULL OR length(contact_text) <= 300);

CREATE OR REPLACE FUNCTION public.platform_update_settings(p_settings jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    r jsonb;
BEGIN
    PERFORM public.fn_require_platform_admin();
    IF EXISTS (SELECT 1 FROM jsonb_object_keys(COALESCE(p_settings, '{}')) k
               WHERE k NOT IN ('trial_enabled', 'trial_days', 'trial_plan', 'grace_days', 'read_only_days', 'platform_domain',
                               'vat_percent', 'payment_instructions', 'terms_url', 'contact_text')) THEN
        RAISE EXCEPTION 'Unknown setting.';
    END IF;
    IF p_settings ? 'trial_plan' AND NOT EXISTS (SELECT 1 FROM public.plans WHERE code = p_settings->>'trial_plan') THEN
        RAISE EXCEPTION 'Unknown plan.';
    END IF;
    UPDATE public.platform_settings SET
        trial_enabled   = COALESCE((p_settings->>'trial_enabled')::boolean, trial_enabled),
        trial_days      = COALESCE((p_settings->>'trial_days')::integer, trial_days),
        trial_plan      = COALESCE(p_settings->>'trial_plan', trial_plan),
        grace_days      = COALESCE((p_settings->>'grace_days')::integer, grace_days),
        read_only_days  = COALESCE((p_settings->>'read_only_days')::integer, read_only_days),
        platform_domain = CASE WHEN p_settings ? 'platform_domain'
                               THEN NULLIF(lower(trim(p_settings->>'platform_domain')), '') ELSE platform_domain END,
        vat_percent     = COALESCE((p_settings->>'vat_percent')::numeric, vat_percent),
        payment_instructions = CASE WHEN p_settings ? 'payment_instructions'
                               THEN NULLIF(trim(p_settings->>'payment_instructions'), '') ELSE payment_instructions END,
        terms_url       = CASE WHEN p_settings ? 'terms_url'
                               THEN NULLIF(trim(p_settings->>'terms_url'), '') ELSE terms_url END,
        contact_text    = CASE WHEN p_settings ? 'contact_text'
                               THEN NULLIF(trim(p_settings->>'contact_text'), '') ELSE contact_text END,
        updated_at = now(), updated_by = auth.uid()
    WHERE id
    RETURNING to_jsonb(platform_settings.*) INTO r;
    PERFORM public.fn_platform_log(NULL, 'settings_changed', p_settings);
    RETURN r;
END;
$$;

-- Prices of plans and add-ons (the admin website edits them; the plan page reads them).
CREATE OR REPLACE FUNCTION public.platform_update_plan_prices(
    p_plan_code text, p_monthly numeric, p_annual numeric, p_one_time numeric, p_setup_fee numeric)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    PERFORM public.fn_require_platform_admin();
    UPDATE public.plans SET
        monthly_price = round(p_monthly, 2), annual_price = round(p_annual, 2),
        one_time_price = round(p_one_time, 2), setup_fee = round(COALESCE(p_setup_fee, 0), 2),
        updated_at = now()
    WHERE code = p_plan_code;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Unknown plan.';
    END IF;
    PERFORM public.fn_platform_log(NULL, 'plan_prices', jsonb_build_object('plan', p_plan_code,
        'monthly', p_monthly, 'annual', p_annual, 'one_time', p_one_time, 'setup_fee', p_setup_fee));
END;
$$;
REVOKE ALL ON FUNCTION public.platform_update_plan_prices(text, numeric, numeric, numeric, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.platform_update_plan_prices(text, numeric, numeric, numeric, numeric) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.platform_update_addon_prices(p_module text, p_monthly numeric, p_annual numeric)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    PERFORM public.fn_require_platform_admin();
    UPDATE public.plan_modules SET addon_monthly_price = round(p_monthly, 2), addon_annual_price = round(p_annual, 2)
    WHERE key = p_module AND addable;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'That module can''t be bought as an add-on.';
    END IF;
    PERFORM public.fn_platform_log(NULL, 'addon_prices', jsonb_build_object('module', p_module, 'monthly', p_monthly, 'annual', p_annual));
END;
$$;
REVOKE ALL ON FUNCTION public.platform_update_addon_prices(text, numeric, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.platform_update_addon_prices(text, numeric, numeric) TO authenticated, service_role;

-- ============================================================================================
-- 2. What a business pays others (estimates only)
-- ============================================================================================
-- basis says what the cost is multiplied by on the plan page calculator:
--   percent_mpesa  % of M-Pesa sales a month     percent_card  % of card sales a month
--   per_sms        each SMS sent                 per_month     fixed each month
--   per_year       fixed each year (shown a month as 1/12)       free          no charge
-- needs: the module the cost comes with (NULL = every business).
CREATE TABLE IF NOT EXISTS public.provider_cost_estimates (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    provider text NOT NULL CHECK (length(trim(provider)) > 0),
    item text NOT NULL CHECK (length(trim(item)) > 0),
    basis text NOT NULL CHECK (basis IN ('percent_mpesa', 'percent_card', 'per_sms', 'per_month', 'per_year', 'free')),
    amount numeric(14,2) NOT NULL DEFAULT 0 CHECK (amount >= 0),
    max_amount numeric(14,2) CHECK (max_amount IS NULL OR max_amount >= 0),
    needs text REFERENCES public.plan_modules(key) ON UPDATE CASCADE ON DELETE SET NULL,
    note text CHECK (note IS NULL OR length(note) <= 500),
    checked_on date,
    sort integer NOT NULL DEFAULT 0,
    active boolean NOT NULL DEFAULT true,
    updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.provider_cost_estimates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS pol_provider_cost_estimates_select ON public.provider_cost_estimates;
CREATE POLICY pol_provider_cost_estimates_select ON public.provider_cost_estimates
    FOR SELECT TO authenticated USING (active OR (SELECT public.is_platform_admin()));
REVOKE ALL ON public.provider_cost_estimates FROM anon, authenticated;
GRANT SELECT ON public.provider_cost_estimates TO authenticated;
GRANT ALL ON public.provider_cost_estimates TO service_role;

-- Starting rows. Every figure is a placeholder for the platform admin to check and edit before
-- anyone relies on it (checked_on stays empty until then, and the app says "not checked").
INSERT INTO public.provider_cost_estimates (provider, item, basis, amount, max_amount, needs, note, sort)
SELECT * FROM (VALUES
    ('Safaricom', 'M-Pesa till (Buy Goods) charge', 'percent_mpesa', 0.55::numeric, 200::numeric, NULL::text,
     'Charged by Safaricom on each payment to your till.', 10),
    ('Card company (e.g. Paystack)', 'Card payment charge', 'percent_card', 2.90, NULL, NULL,
     'Only if you take card payments.', 20),
    ('SMS company', 'Each SMS sent', 'per_sms', 0.80, NULL, 'messaging',
     'Only for SMS you send to customers.', 30),
    ('KRA', 'eTIMS receipts', 'free', 0, NULL, NULL,
     'KRA does not charge for eTIMS.', 40),
    ('Domain seller', 'Your own web address (.co.ke)', 'per_year', 1500, NULL, 'own_domain',
     'Only if you want your own address for the online store.', 50)
) AS v(provider, item, basis, amount, max_amount, needs, note, sort)
WHERE NOT EXISTS (SELECT 1 FROM public.provider_cost_estimates)
  AND (v.needs IS NULL OR EXISTS (SELECT 1 FROM public.plan_modules m WHERE m.key = v.needs));

CREATE OR REPLACE FUNCTION public.platform_save_cost_estimate(p_row jsonb)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_id uuid := NULLIF(p_row->>'id', '')::uuid;
BEGIN
    PERFORM public.fn_require_platform_admin();
    IF v_id IS NULL THEN
        INSERT INTO public.provider_cost_estimates (provider, item, basis, amount, max_amount, needs, note, checked_on, sort, active)
        VALUES (trim(p_row->>'provider'), trim(p_row->>'item'), p_row->>'basis',
                round(COALESCE((p_row->>'amount')::numeric, 0), 2), round((p_row->>'max_amount')::numeric, 2),
                NULLIF(p_row->>'needs', ''), NULLIF(trim(p_row->>'note'), ''), (p_row->>'checked_on')::date,
                COALESCE((p_row->>'sort')::integer, 0), COALESCE((p_row->>'active')::boolean, true))
        RETURNING id INTO v_id;
    ELSE
        UPDATE public.provider_cost_estimates SET
            provider = COALESCE(trim(p_row->>'provider'), provider),
            item = COALESCE(trim(p_row->>'item'), item),
            basis = COALESCE(p_row->>'basis', basis),
            amount = COALESCE(round((p_row->>'amount')::numeric, 2), amount),
            max_amount = CASE WHEN p_row ? 'max_amount' THEN round((p_row->>'max_amount')::numeric, 2) ELSE max_amount END,
            needs = CASE WHEN p_row ? 'needs' THEN NULLIF(p_row->>'needs', '') ELSE needs END,
            note = CASE WHEN p_row ? 'note' THEN NULLIF(trim(p_row->>'note'), '') ELSE note END,
            checked_on = CASE WHEN p_row ? 'checked_on' THEN (p_row->>'checked_on')::date ELSE checked_on END,
            sort = COALESCE((p_row->>'sort')::integer, sort),
            active = COALESCE((p_row->>'active')::boolean, active),
            updated_at = now()
        WHERE id = v_id;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'Unknown cost row.';
        END IF;
    END IF;
    PERFORM public.fn_platform_log(NULL, 'cost_estimate_saved', p_row || jsonb_build_object('id', v_id));
    RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.platform_save_cost_estimate(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.platform_save_cost_estimate(jsonb) TO authenticated, service_role;

-- ============================================================================================
-- 3. Sign-up requests: payment reference, and plan changes for an existing company
-- ============================================================================================
ALTER TABLE public.signup_requests
    ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'new' CHECK (kind IN ('new', 'change'));

DROP FUNCTION IF EXISTS public.request_business_signup(text, text, text, text, text, text[]);
CREATE OR REPLACE FUNCTION public.request_business_signup(
    p_plan_code text, p_billing_cycle text, p_business_name text,
    p_phone text DEFAULT NULL, p_message text DEFAULT NULL, p_addons text[] DEFAULT '{}',
    p_payment_reference text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_uid uuid := auth.uid();
    p public.plans;
    v_id uuid;
BEGIN
    IF v_uid IS NULL OR NOT public.account_email_verified(v_uid) THEN
        RAISE EXCEPTION 'Please verify your email first.' USING ERRCODE = '42501';
    END IF;
    IF NOT public.check_rate_limit('signup_request:' || v_uid::text, 10, 86400) THEN
        RAISE EXCEPTION 'Too many requests today. Please try again tomorrow.';
    END IF;
    IF length(trim(COALESCE(p_business_name, ''))) = 0 THEN
        RAISE EXCEPTION 'Enter the business name.';
    END IF;
    SELECT * INTO p FROM public.plans WHERE code = p_plan_code AND active AND is_public;
    IF NOT FOUND OR p.kind = 'trial' THEN
        RAISE EXCEPTION 'Choose one of the plans.';
    END IF;
    IF (p.kind = 'perpetual') <> (p_billing_cycle = 'one_time') OR p_billing_cycle NOT IN ('monthly', 'annual', 'one_time') THEN
        RAISE EXCEPTION 'Choose how you want to pay for this plan.';
    END IF;
    IF EXISTS (SELECT 1 FROM unnest(COALESCE(p_addons, '{}')) a
               WHERE NOT p.addons_allowed OR a NOT IN (SELECT key FROM public.plan_modules WHERE addable)) THEN
        RAISE EXCEPTION 'Add-ons can only be added to the Pro plan.';
    END IF;
    IF EXISTS (SELECT 1 FROM public.signup_requests WHERE auth_user_id = v_uid AND status IN ('pending', 'approved')) THEN
        RAISE EXCEPTION 'You already have a request waiting. Cancel it first to make a new one.';
    END IF;
    INSERT INTO public.signup_requests (auth_user_id, email, plan_code, billing_cycle, business_name, phone, message,
                                        addons, payment_reference, kind)
    VALUES (v_uid, (SELECT email FROM auth.users WHERE id = v_uid), p.code, p_billing_cycle,
            trim(p_business_name), NULLIF(trim(COALESCE(p_phone, '')), ''), NULLIF(trim(COALESCE(p_message, '')), ''),
            COALESCE(p_addons, '{}'), NULLIF(left(trim(COALESCE(p_payment_reference, '')), 60), ''), 'new')
    RETURNING id INTO v_id;
    PERFORM public.fn_platform_log(NULL, 'signup_requested', jsonb_build_object('request', v_id, 'plan', p.code));
    RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.request_business_signup(text, text, text, text, text, text[], text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_business_signup(text, text, text, text, text, text[], text) TO authenticated, service_role;

-- The company owner asks for another plan (or add-ons). The platform admin approves it.
CREATE OR REPLACE FUNCTION public.request_plan_change(
    p_business_id uuid, p_plan_code text, p_billing_cycle text, p_addons text[] DEFAULT '{}',
    p_payment_reference text DEFAULT NULL, p_message text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_uid uuid := auth.uid();
    v_tenant uuid;
    p public.plans;
    v_id uuid;
BEGIN
    v_tenant := public.fn_business_tenant(p_business_id);
    IF v_uid IS NULL OR v_tenant IS NULL OR NOT EXISTS (
        SELECT 1 FROM public.tenants t JOIN public.users u ON u.id = t.owner_user_id
        WHERE t.id = v_tenant AND u.auth_user_id = v_uid) THEN
        RAISE EXCEPTION 'Only the owner of the company can change its plan.' USING ERRCODE = '42501';
    END IF;
    IF NOT public.check_rate_limit('plan_change:' || v_uid::text, 10, 86400) THEN
        RAISE EXCEPTION 'Too many requests today. Please try again tomorrow.';
    END IF;
    SELECT * INTO p FROM public.plans WHERE code = p_plan_code AND active AND is_public;
    IF NOT FOUND OR p.kind = 'trial' THEN
        RAISE EXCEPTION 'Choose one of the plans.';
    END IF;
    IF (p.kind = 'perpetual') <> (p_billing_cycle = 'one_time') OR p_billing_cycle NOT IN ('monthly', 'annual', 'one_time') THEN
        RAISE EXCEPTION 'Choose how you want to pay for this plan.';
    END IF;
    IF EXISTS (SELECT 1 FROM unnest(COALESCE(p_addons, '{}')) a
               WHERE NOT p.addons_allowed OR a NOT IN (SELECT key FROM public.plan_modules WHERE addable)) THEN
        RAISE EXCEPTION 'Add-ons can only be added to the Pro plan.';
    END IF;
    IF EXISTS (SELECT 1 FROM public.signup_requests WHERE auth_user_id = v_uid AND status IN ('pending', 'approved')) THEN
        RAISE EXCEPTION 'You already have a request waiting. Cancel it first to make a new one.';
    END IF;
    INSERT INTO public.signup_requests (auth_user_id, email, plan_code, billing_cycle, business_name, message,
                                        addons, payment_reference, kind, tenant_id)
    VALUES (v_uid, (SELECT email FROM auth.users WHERE id = v_uid), p.code, p_billing_cycle,
            (SELECT name FROM public.tenants WHERE id = v_tenant), NULLIF(trim(COALESCE(p_message, '')), ''),
            COALESCE(p_addons, '{}'), NULLIF(left(trim(COALESCE(p_payment_reference, '')), 60), ''), 'change', v_tenant)
    RETURNING id INTO v_id;
    PERFORM public.fn_platform_log(v_tenant, 'plan_change_requested', jsonb_build_object('request', v_id, 'plan', p.code));
    RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.request_plan_change(uuid, text, text, text[], text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_plan_change(uuid, text, text, text[], text, text) TO authenticated, service_role;

-- The owner's open plan-change request (Business & branches -> plan).
CREATE OR REPLACE FUNCTION public.my_plan_request(p_business_id uuid)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT to_jsonb(r) FROM (
        SELECT id, plan_code, billing_cycle, addons, status, decision_note, payment_reference, created_at, decided_at
        FROM public.signup_requests
        WHERE auth_user_id = auth.uid() AND kind = 'change'
          AND tenant_id = public.fn_business_tenant(p_business_id)
          AND (status = 'pending' OR (status = 'rejected' AND decided_at > now() - interval '30 days'))
        ORDER BY created_at DESC LIMIT 1) r;
$$;
REVOKE ALL ON FUNCTION public.my_plan_request(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_plan_request(uuid) TO authenticated, service_role;

-- Approving a plan change applies it at once (the request is then used).
CREATE OR REPLACE FUNCTION public.platform_decide_signup(p_request_id uuid, p_approve boolean, p_note text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_req public.signup_requests;
BEGIN
    PERFORM public.fn_require_platform_admin();
    SELECT * INTO v_req FROM public.signup_requests WHERE id = p_request_id AND status = 'pending' FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'That request is not waiting for a decision.';
    END IF;
    UPDATE public.signup_requests
    SET status = CASE WHEN NOT p_approve THEN 'rejected' WHEN kind = 'change' THEN 'used' ELSE 'approved' END,
        decided_by = auth.uid(), decided_at = now(), decision_note = p_note, updated_at = now()
    WHERE id = p_request_id;
    IF p_approve AND v_req.kind = 'change' THEN
        PERFORM public.platform_set_plan(v_req.tenant_id, v_req.plan_code, 'active', v_req.billing_cycle,
            CASE v_req.billing_cycle WHEN 'monthly' THEN now() + interval '1 month'
                                     WHEN 'annual' THEN now() + interval '1 year' END,
            p_note);
        PERFORM public.platform_set_addons(v_req.tenant_id, v_req.addons)
        WHERE (SELECT addons_allowed FROM public.plans WHERE code = v_req.plan_code);
    END IF;
    PERFORM public.fn_platform_log(v_req.tenant_id, CASE WHEN p_approve THEN 'signup_approved' ELSE 'signup_rejected' END,
        jsonb_build_object('request', p_request_id, 'kind', v_req.kind, 'note', p_note));
END;
$$;

-- ============================================================================================
-- 4. Join codes and join requests
-- ============================================================================================
CREATE TABLE IF NOT EXISTS public.business_join_codes (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    code text NOT NULL UNIQUE CHECK (code ~ '^[A-HJ-NP-Z2-9]{8}$'),
    created_by uuid,
    expires_at timestamptz NOT NULL,
    revoked_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_join_codes_one_live ON public.business_join_codes(business_id) WHERE revoked_at IS NULL;
ALTER TABLE public.business_join_codes ENABLE ROW LEVEL SECURITY;
-- No direct access: only the functions below.
REVOKE ALL ON public.business_join_codes FROM anon, authenticated;
GRANT ALL ON public.business_join_codes TO service_role;

CREATE TABLE IF NOT EXISTS public.join_requests (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    auth_user_id uuid NOT NULL,
    user_id uuid,
    name text NOT NULL,
    email text,
    phone text,
    status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
    role public.employee_role,
    decided_by uuid,
    decided_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_join_requests_one_open ON public.join_requests(business_id, auth_user_id) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_join_requests_business ON public.join_requests(business_id, status);
ALTER TABLE public.join_requests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS pol_join_requests_select ON public.join_requests;
CREATE POLICY pol_join_requests_select ON public.join_requests FOR SELECT TO authenticated
    USING (auth_user_id = (SELECT auth.uid()) OR public.has_permission(business_id, 'staff.invite'));
REVOKE ALL ON public.join_requests FROM anon, authenticated;
GRANT SELECT ON public.join_requests TO authenticated;
GRANT ALL ON public.join_requests TO service_role;

CREATE OR REPLACE FUNCTION public.fn_new_join_code()
RETURNS text
LANGUAGE plpgsql VOLATILE
SET search_path = ''
AS $$
DECLARE
    v_alpha constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';  -- no I, O, 0, 1
    v_bytes bytea := extensions.gen_random_bytes(8);
    v_code text := '';
BEGIN
    FOR i IN 0..7 LOOP
        v_code := v_code || substr(v_alpha, (get_byte(v_bytes, i) % 32) + 1, 1);
    END LOOP;
    RETURN v_code;
END;
$$;
REVOKE ALL ON FUNCTION public.fn_new_join_code() FROM PUBLIC, anon, authenticated;

-- The branch's live code, or NULL. Only people who may invite staff see it.
CREATE OR REPLACE FUNCTION public.get_join_code(p_business_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF NOT public.has_permission(p_business_id, 'staff.invite') THEN
        RAISE EXCEPTION 'You do not have permission to invite staff.' USING ERRCODE = '42501';
    END IF;
    RETURN (SELECT jsonb_build_object('code', code, 'expires_at', expires_at, 'created_at', created_at)
            FROM public.business_join_codes
            WHERE business_id = p_business_id AND revoked_at IS NULL AND expires_at > now());
END;
$$;
REVOKE ALL ON FUNCTION public.get_join_code(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_join_code(uuid) TO authenticated, service_role;

-- A new code (the old one stops working). p_days 1..30.
CREATE OR REPLACE FUNCTION public.create_join_code(p_business_id uuid, p_days integer DEFAULT 7)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_code text;
    v_try integer := 0;
BEGIN
    IF NOT public.has_permission(p_business_id, 'staff.invite') THEN
        RAISE EXCEPTION 'You do not have permission to invite staff.' USING ERRCODE = '42501';
    END IF;
    IF p_days IS NULL OR p_days < 1 OR p_days > 30 THEN
        RAISE EXCEPTION 'A join code can last 1 to 30 days.';
    END IF;
    UPDATE public.business_join_codes SET revoked_at = now()
    WHERE business_id = p_business_id AND revoked_at IS NULL;
    LOOP
        v_try := v_try + 1;
        v_code := public.fn_new_join_code();
        BEGIN
            INSERT INTO public.business_join_codes (business_id, code, created_by, expires_at)
            VALUES (p_business_id, v_code, auth.uid(), now() + make_interval(days => p_days));
            EXIT;
        EXCEPTION WHEN unique_violation THEN
            IF v_try >= 5 THEN RAISE; END IF;
        END;
    END LOOP;
    RETURN public.get_join_code(p_business_id);
END;
$$;
REVOKE ALL ON FUNCTION public.create_join_code(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_join_code(uuid, integer) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.revoke_join_code(p_business_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF NOT public.has_permission(p_business_id, 'staff.invite') THEN
        RAISE EXCEPTION 'You do not have permission to invite staff.' USING ERRCODE = '42501';
    END IF;
    UPDATE public.business_join_codes SET revoked_at = now()
    WHERE business_id = p_business_id AND revoked_at IS NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.revoke_join_code(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.revoke_join_code(uuid) TO authenticated, service_role;

-- Someone signed in enters a code. Wrong, expired and revoked codes all give the same answer
-- ({error}), and guesses are limited per person and per IP. A right code gives
-- {request_id, business_name}.
CREATE OR REPLACE FUNCTION public.redeem_join_code(p_code text, p_name text DEFAULT NULL, p_phone text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_uid uuid := auth.uid();
    v_code text := upper(regexp_replace(COALESCE(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
    c public.business_join_codes;
    v_user public.users;
    v_req uuid;
BEGIN
    IF v_uid IS NULL OR NOT public.account_email_verified(v_uid) THEN
        RAISE EXCEPTION 'Please verify your email first.' USING ERRCODE = '42501';
    END IF;
    IF NOT public.check_rate_limit('join_code:' || v_uid::text, 10, 900)
       OR NOT public.check_rate_limit('join_code_ip:' || public.request_ip(), 30, 900) THEN
        RAISE EXCEPTION 'Too many tries. Please wait 15 minutes and try again.';
    END IF;
    SELECT * INTO c FROM public.business_join_codes
    WHERE code = v_code AND revoked_at IS NULL AND expires_at > now();
    IF NOT FOUND THEN
        -- Answered, not raised: an error would undo the guess counted above.
        RETURN jsonb_build_object('error', 'That join code is not valid. Ask for a new one.');
    END IF;
    SELECT * INTO v_user FROM public.users WHERE auth_user_id = v_uid;
    IF EXISTS (SELECT 1 FROM public.business_memberships
               WHERE business_id = c.business_id AND user_id = v_user.id AND status = 'Active') THEN
        RAISE EXCEPTION 'You are already in this business.';
    END IF;
    SELECT id INTO v_req FROM public.join_requests
    WHERE business_id = c.business_id AND auth_user_id = v_uid AND status = 'pending';
    IF v_req IS NULL THEN
        INSERT INTO public.join_requests (business_id, auth_user_id, user_id, name, email, phone)
        VALUES (c.business_id, v_uid, v_user.id,
                COALESCE(NULLIF(trim(COALESCE(p_name, '')), ''), NULLIF(trim(v_user.name), ''), 'New team member'),
                (SELECT email FROM auth.users WHERE id = v_uid),
                COALESCE(NULLIF(trim(COALESCE(p_phone, '')), ''), v_user.phone))
        RETURNING id INTO v_req;
    END IF;
    RETURN jsonb_build_object('request_id', v_req,
                              'business_name', (SELECT name FROM public.businesses WHERE id = c.business_id));
END;
$$;
REVOKE ALL ON FUNCTION public.redeem_join_code(text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.redeem_join_code(text, text, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.cancel_join_request(p_request_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    UPDATE public.join_requests SET status = 'cancelled', decided_at = now()
    WHERE id = p_request_id AND auth_user_id = auth.uid() AND status = 'pending';
    IF NOT FOUND THEN
        RAISE EXCEPTION 'That request can''t be cancelled.';
    END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.cancel_join_request(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_join_request(uuid) TO authenticated, service_role;

-- Let them in with a role, or turn them away. Only the Owner gives Owner-level or admin roles.
CREATE OR REPLACE FUNCTION public.decide_join_request(p_request_id uuid, p_approve boolean, p_role text DEFAULT 'Staff')
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    r public.join_requests;
    v_role public.employee_role;
    v_user uuid;
BEGIN
    SELECT * INTO r FROM public.join_requests WHERE id = p_request_id FOR UPDATE;
    IF NOT FOUND OR NOT public.has_permission(r.business_id, 'staff.invite') THEN
        RAISE EXCEPTION 'You do not have permission to add staff.' USING ERRCODE = '42501';
    END IF;
    IF r.status <> 'pending' THEN
        RAISE EXCEPTION 'That request has already been answered.';
    END IF;

    IF NOT p_approve THEN
        UPDATE public.join_requests SET status = 'rejected', decided_by = auth.uid(), decided_at = now() WHERE id = r.id;
        RETURN;
    END IF;

    BEGIN
        v_role := p_role::public.employee_role;
    EXCEPTION WHEN invalid_text_representation THEN
        RAISE EXCEPTION 'Choose a role.';
    END;
    IF v_role = 'Owner' THEN
        RAISE EXCEPTION 'A business has one owner. Choose another role.';
    END IF;
    IF v_role IN ('Admin', 'Administrator') AND NOT EXISTS (
        SELECT 1 FROM public.business_memberships m JOIN public.users u ON u.id = m.user_id
        WHERE m.business_id = r.business_id AND u.auth_user_id = auth.uid() AND m.role = 'Owner' AND m.status = 'Active') THEN
        RAISE EXCEPTION 'Only the owner can make someone an admin.' USING ERRCODE = '42501';
    END IF;

    v_user := r.user_id;
    IF v_user IS NULL THEN
        SELECT id INTO v_user FROM public.users WHERE auth_user_id = r.auth_user_id;
    END IF;
    IF v_user IS NULL THEN
        INSERT INTO public.users (id, auth_user_id, name, email, phone, is_verified)
        VALUES (r.auth_user_id, r.auth_user_id, r.name, r.email, r.phone, true)
        RETURNING id INTO v_user;
    END IF;

    -- The staff limit trigger refuses this when the plan is full.
    INSERT INTO public.business_memberships (business_id, user_id, role, status)
    VALUES (r.business_id, v_user, v_role, 'Active')
    ON CONFLICT (business_id, user_id) DO UPDATE SET role = v_role, status = 'Active';
    PERFORM public.fn_sync_employee(r.business_id, v_user);

    UPDATE public.join_requests
    SET status = 'approved', role = v_role, user_id = v_user, decided_by = auth.uid(), decided_at = now()
    WHERE id = r.id;
END;
$$;
REVOKE ALL ON FUNCTION public.decide_join_request(uuid, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.decide_join_request(uuid, boolean, text) TO authenticated, service_role;

-- ============================================================================================
-- 5. Invitations to my verified email, accepted from the start screen
-- ============================================================================================
CREATE OR REPLACE FUNCTION public.accept_my_invitation(p_invite_id uuid)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_uid uuid := auth.uid();
    v_inv public.invitations;
BEGIN
    IF v_uid IS NULL OR NOT public.account_email_verified(v_uid) THEN
        RAISE EXCEPTION 'Please verify your email first.' USING ERRCODE = '42501';
    END IF;
    SELECT * INTO v_inv FROM public.invitations
    WHERE id = p_invite_id AND status = 'Pending' AND expires_at > now()
      AND lower(trim(email)) = (SELECT lower(trim(email)) FROM auth.users WHERE id = v_uid)
    FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'That invitation has expired or was cancelled. Ask for a new one.';
    END IF;
    PERFORM public.finish_invitation(v_inv.id, v_uid,
        (SELECT name FROM public.users WHERE auth_user_id = v_uid),
        (SELECT phone FROM public.users WHERE auth_user_id = v_uid));
    RETURN v_inv.business_id;
END;
$$;
REVOKE ALL ON FUNCTION public.accept_my_invitation(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.accept_my_invitation(uuid) TO authenticated, service_role;

-- ============================================================================================
-- 6. Where the signed-in person stands (start screen)
-- ============================================================================================
CREATE OR REPLACE FUNCTION public.my_signup_state()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_uid uuid := auth.uid();
    v_email text;
    v_req jsonb;
    s public.platform_settings;
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'Please sign in.' USING ERRCODE = '42501';
    END IF;
    SELECT * INTO s FROM public.platform_settings WHERE id;
    SELECT lower(trim(email)) INTO v_email FROM auth.users WHERE id = v_uid;
    SELECT to_jsonb(r) INTO v_req FROM (
        SELECT id, plan_code, billing_cycle, business_name, status, decision_note, payment_reference, created_at, decided_at
        FROM public.signup_requests
        WHERE auth_user_id = v_uid AND kind = 'new' AND status IN ('pending', 'approved', 'rejected')
        ORDER BY created_at DESC LIMIT 1) r;
    RETURN jsonb_build_object(
        'email_verified', public.account_email_verified(v_uid),
        'owns_company', EXISTS (SELECT 1 FROM public.tenants t JOIN public.users u ON u.id = t.owner_user_id
                                WHERE u.auth_user_id = v_uid),
        'trial_enabled', s.trial_enabled,
        'trial_days', s.trial_days,
        'can_start_trial', public.fn_can_start_trial(v_uid),
        'request', v_req,
        'is_platform_admin', public.is_platform_admin(v_uid),
        -- Invitations only once the email is proven to be theirs.
        'invites', CASE WHEN public.account_email_verified(v_uid) THEN COALESCE((
            SELECT jsonb_agg(jsonb_build_object('id', i.id, 'business_name', b.name, 'role', i.role,
                                                'expires_at', i.expires_at, 'supplier', i.supplier_id IS NOT NULL)
                             ORDER BY i.created_at DESC)
            FROM public.invitations i JOIN public.businesses b ON b.id = i.business_id
            WHERE lower(trim(i.email)) = v_email AND i.status = 'Pending' AND i.expires_at > now()
              AND b.deleted_at IS NULL), '[]'::jsonb) ELSE '[]'::jsonb END,
        'join_requests', COALESCE((
            SELECT jsonb_agg(jsonb_build_object('id', j.id, 'business_name', b.name, 'status', j.status,
                                                'created_at', j.created_at) ORDER BY j.created_at DESC)
            FROM public.join_requests j JOIN public.businesses b ON b.id = j.business_id
            WHERE j.auth_user_id = v_uid
              AND (j.status = 'pending' OR (j.status = 'rejected' AND j.decided_at > now() - interval '14 days'))),
            '[]'::jsonb));
END;
$$;

-- Plan page facts that are not in the plans table (any signed-in person).
CREATE OR REPLACE FUNCTION public.get_plan_page_settings()
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT jsonb_build_object('vat_percent', vat_percent, 'payment_instructions', payment_instructions,
                              'terms_url', terms_url, 'contact_text', contact_text,
                              'trial_enabled', trial_enabled, 'trial_days', trial_days)
    FROM public.platform_settings WHERE id;
$$;
REVOKE ALL ON FUNCTION public.get_plan_page_settings() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_plan_page_settings() TO authenticated, service_role;

-- A read-only or suspended company issues no codes and takes no one in (same rule as every
-- other business table, 20261204001 section 6).
DROP TRIGGER IF EXISTS trg_zz_plan_read_only ON public.business_join_codes;
CREATE TRIGGER trg_zz_plan_read_only BEFORE INSERT OR UPDATE OR DELETE ON public.business_join_codes
    FOR EACH ROW EXECUTE FUNCTION public.fn_block_when_read_only();
DROP TRIGGER IF EXISTS trg_zz_plan_read_only ON public.join_requests;
CREATE TRIGGER trg_zz_plan_read_only BEFORE INSERT OR UPDATE OR DELETE ON public.join_requests
    FOR EACH ROW EXECUTE FUNCTION public.fn_block_when_read_only();

-- ===================================================================
-- 20261204004_website_addresses
-- ===================================================================
-- 20261204004_website_addresses.sql
-- SaaS step 6: one website for every business, chosen by its address (owner decisions 2026-11-24).
--
--   * Each shop (a branch with a website name, businesses.website_slug) lives at
--     <website name>.<platform domain>. Never a path. The platform domain is a platform setting.
--   * A shop can change its website name twice a year. The old address sends visitors to the new
--     one for 90 days, and no other shop can take it in that time. Platform words (www, admin,
--     app, api...) can't be taken.
--   * Own web address (module own_domain: a Pro add-on, included in Pro Plus): one per shop,
--     added through Cloudflare for SaaS by the website-domain edge function. Once it is active
--     the subdomain sends visitors to it.
--   * The public shop only opens when the company's plan has the Online store and isn't
--     suspended. Read-only companies keep their shop visible but take no orders.
--   * resolve_website_host(host): the one question the website Worker asks for every address.
--     An unknown address says nothing about any business.
--   * "Powered by" shows on plans with show_powered_by and no own domain (Pro), never on Pro Plus.

-- ============================================================================================
-- 1. Platform settings for addresses
-- ============================================================================================
ALTER TABLE public.platform_settings
    ADD COLUMN IF NOT EXISTS platform_name text CHECK (platform_name IS NULL OR length(trim(platform_name)) BETWEEN 1 AND 60),
    -- Where an own domain points its CNAME (the Cloudflare for SaaS fallback origin).
    -- NULL = customers.<platform domain>.
    ADD COLUMN IF NOT EXISTS custom_domain_target text CHECK (custom_domain_target IS NULL OR custom_domain_target ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$');

CREATE OR REPLACE FUNCTION public.platform_update_settings(p_settings jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    r jsonb;
BEGIN
    PERFORM public.fn_require_platform_admin();
    IF EXISTS (SELECT 1 FROM jsonb_object_keys(COALESCE(p_settings, '{}')) k
               WHERE k NOT IN ('trial_enabled', 'trial_days', 'trial_plan', 'grace_days', 'read_only_days', 'platform_domain',
                               'vat_percent', 'payment_instructions', 'terms_url', 'contact_text',
                               'platform_name', 'custom_domain_target')) THEN
        RAISE EXCEPTION 'Unknown setting.';
    END IF;
    IF p_settings ? 'trial_plan' AND NOT EXISTS (SELECT 1 FROM public.plans WHERE code = p_settings->>'trial_plan') THEN
        RAISE EXCEPTION 'Unknown plan.';
    END IF;
    UPDATE public.platform_settings SET
        trial_enabled   = COALESCE((p_settings->>'trial_enabled')::boolean, trial_enabled),
        trial_days      = COALESCE((p_settings->>'trial_days')::integer, trial_days),
        trial_plan      = COALESCE(p_settings->>'trial_plan', trial_plan),
        grace_days      = COALESCE((p_settings->>'grace_days')::integer, grace_days),
        read_only_days  = COALESCE((p_settings->>'read_only_days')::integer, read_only_days),
        platform_domain = CASE WHEN p_settings ? 'platform_domain'
                               THEN NULLIF(lower(trim(p_settings->>'platform_domain')), '') ELSE platform_domain END,
        vat_percent     = COALESCE((p_settings->>'vat_percent')::numeric, vat_percent),
        payment_instructions = CASE WHEN p_settings ? 'payment_instructions'
                               THEN NULLIF(trim(p_settings->>'payment_instructions'), '') ELSE payment_instructions END,
        terms_url       = CASE WHEN p_settings ? 'terms_url'
                               THEN NULLIF(trim(p_settings->>'terms_url'), '') ELSE terms_url END,
        contact_text    = CASE WHEN p_settings ? 'contact_text'
                               THEN NULLIF(trim(p_settings->>'contact_text'), '') ELSE contact_text END,
        platform_name   = CASE WHEN p_settings ? 'platform_name'
                               THEN NULLIF(trim(p_settings->>'platform_name'), '') ELSE platform_name END,
        custom_domain_target = CASE WHEN p_settings ? 'custom_domain_target'
                               THEN NULLIF(lower(trim(p_settings->>'custom_domain_target')), '') ELSE custom_domain_target END,
        updated_at = now(), updated_by = auth.uid()
    WHERE id
    RETURNING to_jsonb(platform_settings.*) INTO r;
    PERFORM public.fn_platform_log(NULL, 'settings_changed', p_settings);
    RETURN r;
END;
$$;
REVOKE ALL ON FUNCTION public.platform_update_settings(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.platform_update_settings(jsonb) TO authenticated, service_role;

-- Normalises a typed address: "HTTPS://Shop.co.ke/path" -> "shop.co.ke". NULL when it isn't one.
CREATE OR REPLACE FUNCTION public.fn_clean_hostname(p_host text)
RETURNS text
LANGUAGE sql IMMUTABLE
SET search_path = ''
AS $$
    SELECT CASE WHEN h ~ '^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$' AND length(h) <= 253 THEN h END
    FROM (SELECT rtrim(split_part(split_part(regexp_replace(lower(trim(COALESCE(p_host, ''))), '^[a-z]+://', ''),
                                             '/', 1), ':', 1), '.') AS h) x;
$$;
REVOKE ALL ON FUNCTION public.fn_clean_hostname(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_clean_hostname(text) TO service_role;

-- ============================================================================================
-- 2. Website names: reserved words, two changes a year, 90-day redirects
-- ============================================================================================
CREATE OR REPLACE FUNCTION public.fn_reserved_website_slug(p_slug text)
RETURNS boolean
LANGUAGE sql IMMUTABLE
SET search_path = ''
AS $$
    SELECT p_slug = ANY (ARRAY[
        'www', 'app', 'apps', 'admin', 'api', 'auth', 'login', 'signup', 'account', 'accounts',
        'mail', 'email', 'smtp', 'imap', 'pop', 'ftp', 'ns1', 'ns2', 'dns', 'mx',
        'help', 'support', 'status', 'docs', 'blog', 'news', 'about', 'pricing', 'terms', 'privacy',
        'cdn', 'static', 'assets', 'media', 'files', 'img', 'images', 'customers', 'customer',
        'dev', 'staging', 'test', 'preview', 'demo', 'internal', 'platform', 'billing', 'pay', 'payments',
        'webhook', 'webhooks', 'shop', 'store', 'stores', 'my', 'dashboard', 'console', 'root']);
$$;
REVOKE ALL ON FUNCTION public.fn_reserved_website_slug(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_reserved_website_slug(text) TO service_role;

CREATE TABLE IF NOT EXISTS public.website_slug_history (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    old_slug text NOT NULL,
    new_slug text,
    changed_at timestamptz NOT NULL DEFAULT now(),
    redirect_until timestamptz NOT NULL DEFAULT now() + interval '90 days',
    changed_by uuid
);
CREATE INDEX IF NOT EXISTS idx_website_slug_history_old ON public.website_slug_history(old_slug, redirect_until DESC);
CREATE INDEX IF NOT EXISTS idx_website_slug_history_business ON public.website_slug_history(business_id, changed_at DESC);
ALTER TABLE public.website_slug_history ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.website_slug_history FROM anon, authenticated;
GRANT ALL ON public.website_slug_history TO service_role;

CREATE OR REPLACE FUNCTION public.fn_website_slug_guard()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_app boolean := COALESCE(current_setting('role', true), 'none') IN ('anon', 'authenticated')
                     AND NOT public.is_platform_admin();
    v_count integer;
    v_next timestamptz;
BEGIN
    NEW.website_slug := NULLIF(lower(trim(COALESCE(NEW.website_slug, ''))), '');
    IF TG_OP = 'UPDATE' AND NEW.website_slug IS NOT DISTINCT FROM OLD.website_slug THEN
        RETURN NEW;
    END IF;

    IF NEW.website_slug IS NOT NULL THEN
        IF length(NEW.website_slug) < 3 OR length(NEW.website_slug) > 40 THEN
            RAISE EXCEPTION 'A website name has 3 to 40 letters, numbers or dashes.';
        END IF;
        IF public.fn_reserved_website_slug(NEW.website_slug) THEN
            RAISE EXCEPTION 'That website name is kept for the platform. Please choose another.';
        END IF;
        IF EXISTS (SELECT 1 FROM public.website_slug_history h
                   WHERE h.old_slug = NEW.website_slug AND h.redirect_until > now() AND h.business_id <> NEW.id) THEN
            RAISE EXCEPTION 'Another shop used that website name recently. Please choose another.';
        END IF;
    END IF;

    IF TG_OP = 'UPDATE' AND OLD.website_slug IS NOT NULL THEN
        IF v_app THEN
            SELECT count(*), min(changed_at) + interval '365 days' INTO v_count, v_next
            FROM public.website_slug_history
            WHERE business_id = NEW.id AND changed_at > now() - interval '365 days';
            IF v_count >= 2 THEN
                RAISE EXCEPTION 'The website name can be changed twice a year. The next change is possible from %.',
                    to_char(v_next AT TIME ZONE 'Africa/Nairobi', 'DD Mon YYYY');
            END IF;
        END IF;
        -- Taking back its own old name ends that redirect.
        DELETE FROM public.website_slug_history
        WHERE business_id = NEW.id AND old_slug = NEW.website_slug AND redirect_until > now();
        INSERT INTO public.website_slug_history (business_id, old_slug, new_slug, changed_by)
        VALUES (NEW.id, OLD.website_slug, NEW.website_slug, auth.uid());
    END IF;
    RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.fn_website_slug_guard() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_website_slug_guard ON public.businesses;
CREATE TRIGGER trg_website_slug_guard BEFORE INSERT OR UPDATE OF website_slug ON public.businesses
    FOR EACH ROW EXECUTE FUNCTION public.fn_website_slug_guard();

-- ============================================================================================
-- 3. Own web addresses (one per shop; Cloudflare for SaaS does the certificate)
-- ============================================================================================
CREATE TABLE IF NOT EXISTS public.website_domains (
    business_id uuid PRIMARY KEY REFERENCES public.businesses(id) ON DELETE CASCADE,
    hostname text NOT NULL UNIQUE CHECK (public.fn_clean_hostname(hostname) = hostname),
    status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'failed')),
    cf_hostname_id text,
    -- Records the shop must add at its domain company: [{type, name, value}]
    dns_records jsonb NOT NULL DEFAULT '[]'::jsonb,
    last_error text,
    checked_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    created_by uuid
);
ALTER TABLE public.website_domains ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS pol_website_domains_select ON public.website_domains;
CREATE POLICY pol_website_domains_select ON public.website_domains FOR SELECT TO authenticated
    USING ((SELECT public.is_owner_or_admin(business_id)));
REVOKE ALL ON public.website_domains FROM anon, authenticated;
GRANT SELECT ON public.website_domains TO authenticated;
GRANT ALL ON public.website_domains TO service_role;

-- Step 1 of adding an own address (the edge function then registers it with Cloudflare).
-- Returns the clean address and the Cloudflare id of the one it replaces, to remove there.
CREATE OR REPLACE FUNCTION public.website_domain_start(p_business_id uuid, p_hostname text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_host text := public.fn_clean_hostname(p_hostname);
    v_domain text;
    v_old public.website_domains;
BEGIN
    IF NOT public.is_owner_or_admin(p_business_id) THEN
        RAISE EXCEPTION 'Only the owner or an admin can change the web address.';
    END IF;
    IF NOT public.has_module(p_business_id, 'own_domain') THEN
        RAISE EXCEPTION 'Your plan does not include your own web address. It comes with Pro Plus, or as an add-on to Pro.'
            USING HINT = 'plan_module';
    END IF;
    IF v_host IS NULL THEN
        RAISE EXCEPTION 'That is not a web address. Type it like shop.example.co.ke';
    END IF;
    SELECT platform_domain INTO v_domain FROM public.platform_settings WHERE id;
    IF v_domain IS NOT NULL AND (v_host = v_domain OR v_host LIKE '%.' || v_domain) THEN
        RAISE EXCEPTION 'That address belongs to the platform. Use your own domain.';
    END IF;
    IF EXISTS (SELECT 1 FROM public.website_domains WHERE hostname = v_host AND business_id <> p_business_id) THEN
        RAISE EXCEPTION 'That address is already in use by another shop.';
    END IF;

    SELECT * INTO v_old FROM public.website_domains WHERE business_id = p_business_id;
    IF FOUND AND v_old.hostname = v_host THEN
        RETURN jsonb_build_object('hostname', v_host, 'old_cf_id', NULL, 'cf_id', v_old.cf_hostname_id);
    END IF;
    DELETE FROM public.website_domains WHERE business_id = p_business_id;
    INSERT INTO public.website_domains (business_id, hostname, created_by) VALUES (p_business_id, v_host, auth.uid());
    RETURN jsonb_build_object('hostname', v_host, 'old_cf_id', v_old.cf_hostname_id, 'cf_id', NULL);
END;
$$;
REVOKE ALL ON FUNCTION public.website_domain_start(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.website_domain_start(uuid, text) TO authenticated, service_role;

-- Removes the shop's own address. Returns the Cloudflare id to remove there.
CREATE OR REPLACE FUNCTION public.website_domain_remove(p_business_id uuid)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_cf text;
BEGIN
    IF NOT public.is_owner_or_admin(p_business_id) THEN
        RAISE EXCEPTION 'Only the owner or an admin can change the web address.';
    END IF;
    DELETE FROM public.website_domains WHERE business_id = p_business_id RETURNING cf_hostname_id INTO v_cf;
    RETURN v_cf;
END;
$$;
REVOKE ALL ON FUNCTION public.website_domain_remove(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.website_domain_remove(uuid) TO authenticated, service_role;

-- ============================================================================================
-- 4. Is the shop open? And which shop is at this address?
-- ============================================================================================
-- {open, orders_open, powered_by, own_domain} for a branch, from its company's plan.
CREATE OR REPLACE FUNCTION public.fn_website_shop(p_business_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    r jsonb := public.fn_tenant_plan(public.fn_business_tenant(p_business_id));
    v_open boolean;
BEGIN
    IF r IS NULL THEN
        RETURN jsonb_build_object('open', false, 'orders_open', false, 'powered_by', false, 'own_domain', false);
    END IF;
    v_open := (r->'modules' ? 'online_store') AND r->>'status' <> 'suspended';
    RETURN jsonb_build_object(
        'open', v_open,
        'orders_open', v_open AND COALESCE((r->>'writable')::boolean, false),
        'powered_by', COALESCE((r->>'powered_by')::boolean, false),
        'own_domain', r->'modules' ? 'own_domain');
END;
$$;
REVOKE ALL ON FUNCTION public.fn_website_shop(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_website_shop(uuid) TO service_role;

-- The address a shop is shown at: its active own domain (plan allowing), else its subdomain.
CREATE OR REPLACE FUNCTION public.fn_website_home_host(p_business_id uuid)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT COALESCE(
        (SELECT d.hostname FROM public.website_domains d
         WHERE d.business_id = b.id AND d.status = 'active'
           AND public.has_module(b.id, 'own_domain')),
        CASE WHEN s.platform_domain IS NOT NULL AND b.website_slug IS NOT NULL
             THEN b.website_slug || '.' || s.platform_domain END)
    FROM public.businesses b CROSS JOIN public.platform_settings s
    WHERE b.id = p_business_id AND s.id;
$$;
REVOKE ALL ON FUNCTION public.fn_website_home_host(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_website_home_host(uuid) TO service_role;

-- The website Worker asks this for every address it serves (cached for a minute there).
--   {kind:'none'}                     nothing here (says nothing about any business)
--   {kind:'platform'}                 the platform's own address (www or bare domain)
--   {kind:'redirect', host}           send the visitor to this address (301)
--   {kind:'closed', name}             a shop whose plan has no online store now
--   {kind:'shop', slug, host, ...}    serve this shop
CREATE OR REPLACE FUNCTION public.resolve_website_host(p_host text)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_host text := public.fn_clean_hostname(p_host);
    st public.platform_settings;
    v_sub text;
    v_id uuid;
    v_name text;
    v_slug text;
    v_home text;
    v_shop jsonb;
BEGIN
    IF v_host IS NULL THEN
        RETURN jsonb_build_object('kind', 'none');
    END IF;
    SELECT * INTO st FROM public.platform_settings WHERE id;

    IF st.platform_domain IS NOT NULL AND (v_host = st.platform_domain OR v_host = 'www.' || st.platform_domain) THEN
        RETURN jsonb_build_object('kind', 'platform');
    END IF;

    IF st.platform_domain IS NOT NULL AND right(v_host, length(st.platform_domain) + 1) = '.' || st.platform_domain THEN
        v_sub := left(v_host, length(v_host) - length(st.platform_domain) - 1);
        IF position('.' IN v_sub) > 0 THEN
            RETURN jsonb_build_object('kind', 'none');
        END IF;
        SELECT b.id, b.name, b.website_slug INTO v_id, v_name, v_slug
        FROM public.businesses b WHERE b.website_slug = v_sub AND b.deleted_at IS NULL;
        IF NOT FOUND THEN
            -- An old name within its 90 days: send visitors to where the shop is now.
            SELECT h.business_id INTO v_id FROM public.website_slug_history h
            JOIN public.businesses b ON b.id = h.business_id AND b.deleted_at IS NULL
            WHERE h.old_slug = v_sub AND h.redirect_until > now()
            ORDER BY h.changed_at DESC LIMIT 1;
            v_home := CASE WHEN v_id IS NOT NULL THEN public.fn_website_home_host(v_id) END;
            IF v_home IS NOT NULL AND (public.fn_website_shop(v_id)->>'open')::boolean THEN
                RETURN jsonb_build_object('kind', 'redirect', 'host', v_home);
            END IF;
            RETURN jsonb_build_object('kind', 'none');
        END IF;
    ELSE
        SELECT b.id, b.name, b.website_slug INTO v_id, v_name, v_slug
        FROM public.website_domains d
        JOIN public.businesses b ON b.id = d.business_id AND b.deleted_at IS NULL
        WHERE d.hostname = v_host AND d.status = 'active';
        IF NOT FOUND THEN
            RETURN jsonb_build_object('kind', 'none');
        END IF;
    END IF;

    v_shop := public.fn_website_shop(v_id);
    IF v_slug IS NULL OR NOT (v_shop->>'open')::boolean THEN
        RETURN jsonb_build_object('kind', 'closed', 'name', v_name);
    END IF;
    v_home := public.fn_website_home_host(v_id);
    IF v_home IS NOT NULL AND v_home <> v_host THEN
        RETURN jsonb_build_object('kind', 'redirect', 'host', v_home);
    END IF;
    RETURN jsonb_build_object(
        'kind', 'shop',
        'slug', v_slug,
        'host', COALESCE(v_home, v_host),
        'powered_by', (v_shop->>'powered_by')::boolean,
        'orders_open', (v_shop->>'orders_open')::boolean,
        'platform_name', st.platform_name,
        'platform_url', CASE WHEN st.platform_domain IS NOT NULL THEN 'https://' || st.platform_domain END);
END;
$$;
REVOKE ALL ON FUNCTION public.resolve_website_host(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_website_host(text) TO anon, authenticated, service_role;

-- ============================================================================================
-- 5. The public shop only opens on a plan with the Online store
-- ============================================================================================
ALTER FUNCTION public.get_public_storefront(text) RENAME TO fn_public_storefront_data;
REVOKE ALL ON FUNCTION public.fn_public_storefront_data(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_public_storefront_data(text) TO service_role;

CREATE OR REPLACE FUNCTION public.get_public_storefront(p_slug text)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_id uuid;
    v_shop jsonb;
    v_data jsonb;
    st public.platform_settings;
BEGIN
    SELECT b.id INTO v_id FROM public.businesses b
    WHERE b.website_slug = lower(trim(p_slug)) AND b.deleted_at IS NULL;
    IF NOT FOUND THEN
        RETURN NULL;
    END IF;
    v_shop := public.fn_website_shop(v_id);
    IF NOT (v_shop->>'open')::boolean THEN
        RETURN NULL;
    END IF;
    v_data := public.fn_public_storefront_data(lower(trim(p_slug)));
    IF v_data IS NULL THEN
        RETURN NULL;
    END IF;
    SELECT * INTO st FROM public.platform_settings WHERE id;
    RETURN v_data || jsonb_build_object('site', jsonb_build_object(
        'ordersOpen', (v_shop->>'orders_open')::boolean,
        'poweredBy', (v_shop->>'powered_by')::boolean,
        'platformName', st.platform_name,
        'platformUrl', CASE WHEN st.platform_domain IS NOT NULL THEN 'https://' || st.platform_domain END,
        'host', public.fn_website_home_host(v_id)));
END;
$$;
REVOKE ALL ON FUNCTION public.get_public_storefront(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_storefront(text) TO anon, authenticated, service_role;

-- No online order for a shop whose plan has no online store, whoever calls.
CREATE OR REPLACE FUNCTION public.fn_online_order_needs_store()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF NOT (public.fn_website_shop(NEW.business_id)->>'orders_open')::boolean THEN
        RAISE EXCEPTION 'This shop is not taking online orders right now.' USING HINT = 'plan_module';
    END IF;
    RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.fn_online_order_needs_store() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_online_order_needs_store ON public.online_orders;
CREATE TRIGGER trg_online_order_needs_store BEFORE INSERT ON public.online_orders
    FOR EACH ROW EXECUTE FUNCTION public.fn_online_order_needs_store();

-- ============================================================================================
-- 6. What the app's Online Store screen shows about the address
-- ============================================================================================
CREATE OR REPLACE FUNCTION public.website_address_info(p_business_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    b public.businesses;
    st public.platform_settings;
    d public.website_domains;
    v_shop jsonb;
    v_count integer;
    v_next timestamptz;
BEGIN
    IF NOT public.is_owner_or_admin(p_business_id) THEN
        RAISE EXCEPTION 'Only the owner or an admin can see the web address settings.';
    END IF;
    SELECT * INTO b FROM public.businesses WHERE id = p_business_id;
    SELECT * INTO st FROM public.platform_settings WHERE id;
    SELECT * INTO d FROM public.website_domains WHERE business_id = p_business_id;
    v_shop := public.fn_website_shop(p_business_id);
    SELECT count(*), min(changed_at) + interval '365 days' INTO v_count, v_next
    FROM public.website_slug_history
    WHERE business_id = p_business_id AND changed_at > now() - interval '365 days';

    RETURN jsonb_build_object(
        'slug', b.website_slug,
        'platform_domain', st.platform_domain,
        'address', CASE WHEN b.website_slug IS NOT NULL AND st.platform_domain IS NOT NULL
                        THEN b.website_slug || '.' || st.platform_domain END,
        'home', public.fn_website_home_host(p_business_id),
        'open', (v_shop->>'open')::boolean,
        'orders_open', (v_shop->>'orders_open')::boolean,
        'changes_left', CASE WHEN b.website_slug IS NULL THEN NULL ELSE greatest(0, 2 - v_count) END,
        'next_change_at', CASE WHEN v_count >= 2 THEN v_next END,
        'old_names', COALESCE((SELECT jsonb_agg(jsonb_build_object('slug', h.old_slug, 'until', h.redirect_until)
                                                ORDER BY h.changed_at DESC)
                               FROM public.website_slug_history h
                               WHERE h.business_id = p_business_id AND h.redirect_until > now()), '[]'::jsonb),
        'own_domain_allowed', (v_shop->>'own_domain')::boolean,
        'domain_target', COALESCE(st.custom_domain_target,
                                  CASE WHEN st.platform_domain IS NOT NULL THEN 'customers.' || st.platform_domain END),
        'domain', CASE WHEN d.business_id IS NULL THEN NULL ELSE jsonb_build_object(
            'hostname', d.hostname, 'status', d.status, 'dns_records', d.dns_records,
            'last_error', d.last_error, 'checked_at', d.checked_at) END);
END;
$$;
REVOKE ALL ON FUNCTION public.website_address_info(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.website_address_info(uuid) TO authenticated, service_role;

-- ============================================================================================
-- 7. Read-only companies: same rule as every other business table (20261204001 section 6)
-- ============================================================================================
DROP TRIGGER IF EXISTS trg_zz_plan_read_only ON public.website_slug_history;
CREATE TRIGGER trg_zz_plan_read_only BEFORE INSERT OR UPDATE OR DELETE ON public.website_slug_history
    FOR EACH ROW EXECUTE FUNCTION public.fn_block_when_read_only();
DROP TRIGGER IF EXISTS trg_zz_plan_read_only ON public.website_domains;
CREATE TRIGGER trg_zz_plan_read_only BEFORE INSERT OR UPDATE OR DELETE ON public.website_domains
    FOR EACH ROW EXECUTE FUNCTION public.fn_block_when_read_only();

-- ===================================================================
-- 20261204005_platform_console_plans_page
-- ===================================================================
-- 20261204005_platform_console_plans_page.sql
-- SaaS step 7 (owner decision 2026-11-24, round 4): the platform console lives INSIDE the main
-- app, shown only to platform admins, and customers see the plans and subscribe from a public
-- web page on the platform domain.
--
--   * platform_settings.app_url: where the app opens (the plans page sends people there to sign
--     up, with the plan they picked).
--   * get_public_plans(): what the public plans page shows. Anyone may call it (the website
--     Worker does, with the anon key). Plans, prices, add-ons, trial, VAT, terms and contact
--     only: nothing about any business.
--   * Console reads, all platform admin only and all counts, never sales amounts, customers
--     or products: platform_overview(), platform_tenant_detail(), platform_requests().

-- ============================================================================================
-- 1. Where the app is
-- ============================================================================================
ALTER TABLE public.platform_settings
    ADD COLUMN IF NOT EXISTS app_url text CHECK (app_url IS NULL OR app_url ~ '^https://[^\s/?#]+(/[^\s?#]*)?$');

CREATE OR REPLACE FUNCTION public.platform_update_settings(p_settings jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    r jsonb;
BEGIN
    PERFORM public.fn_require_platform_admin();
    IF EXISTS (SELECT 1 FROM jsonb_object_keys(COALESCE(p_settings, '{}')) k
               WHERE k NOT IN ('trial_enabled', 'trial_days', 'trial_plan', 'grace_days', 'read_only_days', 'platform_domain',
                               'vat_percent', 'payment_instructions', 'terms_url', 'contact_text',
                               'platform_name', 'custom_domain_target', 'app_url')) THEN
        RAISE EXCEPTION 'Unknown setting.';
    END IF;
    IF p_settings ? 'trial_plan' AND NOT EXISTS (SELECT 1 FROM public.plans WHERE code = p_settings->>'trial_plan') THEN
        RAISE EXCEPTION 'Unknown plan.';
    END IF;
    UPDATE public.platform_settings SET
        trial_enabled   = COALESCE((p_settings->>'trial_enabled')::boolean, trial_enabled),
        trial_days      = COALESCE((p_settings->>'trial_days')::integer, trial_days),
        trial_plan      = COALESCE(p_settings->>'trial_plan', trial_plan),
        grace_days      = COALESCE((p_settings->>'grace_days')::integer, grace_days),
        read_only_days  = COALESCE((p_settings->>'read_only_days')::integer, read_only_days),
        platform_domain = CASE WHEN p_settings ? 'platform_domain'
                               THEN NULLIF(lower(trim(p_settings->>'platform_domain')), '') ELSE platform_domain END,
        vat_percent     = COALESCE((p_settings->>'vat_percent')::numeric, vat_percent),
        payment_instructions = CASE WHEN p_settings ? 'payment_instructions'
                               THEN NULLIF(trim(p_settings->>'payment_instructions'), '') ELSE payment_instructions END,
        terms_url       = CASE WHEN p_settings ? 'terms_url'
                               THEN NULLIF(trim(p_settings->>'terms_url'), '') ELSE terms_url END,
        contact_text    = CASE WHEN p_settings ? 'contact_text'
                               THEN NULLIF(trim(p_settings->>'contact_text'), '') ELSE contact_text END,
        platform_name   = CASE WHEN p_settings ? 'platform_name'
                               THEN NULLIF(trim(p_settings->>'platform_name'), '') ELSE platform_name END,
        custom_domain_target = CASE WHEN p_settings ? 'custom_domain_target'
                               THEN NULLIF(lower(trim(p_settings->>'custom_domain_target')), '') ELSE custom_domain_target END,
        app_url         = CASE WHEN p_settings ? 'app_url'
                               THEN NULLIF(rtrim(trim(p_settings->>'app_url'), '/'), '') ELSE app_url END,
        updated_at = now(), updated_by = auth.uid()
    WHERE id
    RETURNING to_jsonb(platform_settings.*) INTO r;
    PERFORM public.fn_platform_log(NULL, 'settings_changed', p_settings);
    RETURN r;
END;
$$;
REVOKE ALL ON FUNCTION public.platform_update_settings(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.platform_update_settings(jsonb) TO authenticated, service_role;

-- ============================================================================================
-- 2. The public plans page
-- ============================================================================================
CREATE OR REPLACE FUNCTION public.get_public_plans()
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT jsonb_build_object(
        'platform_name', s.platform_name,
        'app_url', s.app_url,
        'trial_enabled', s.trial_enabled,
        'trial_days', s.trial_days,
        'vat_percent', s.vat_percent,
        'terms_url', s.terms_url,
        'contact_text', s.contact_text,
        'plans', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                'code', p.code, 'name', p.name, 'kind', p.kind, 'description', p.description,
                'monthly_price', p.monthly_price, 'annual_price', p.annual_price,
                'one_time_price', p.one_time_price, 'setup_fee', p.setup_fee,
                'max_branches', p.max_branches, 'max_staff', p.max_staff, 'storage_mb', p.storage_mb,
                'ai_daily_cap', p.ai_daily_cap, 'addons_allowed', p.addons_allowed,
                'show_powered_by', p.show_powered_by,
                'modules', COALESCE((SELECT jsonb_agg(m.key ORDER BY m.sort) FROM public.plan_modules m
                                     WHERE m.key = ANY (p.modules)), '[]'::jsonb))
                ORDER BY p.sort)
            FROM public.plans p
            WHERE p.active AND p.is_public AND (p.kind <> 'trial')), '[]'::jsonb),
        'modules', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                'key', m.key, 'name', m.name, 'tier', m.tier, 'addable', m.addable,
                'addon_monthly_price', m.addon_monthly_price, 'addon_annual_price', m.addon_annual_price)
                ORDER BY m.sort)
            FROM public.plan_modules m), '[]'::jsonb))
    FROM public.platform_settings s WHERE s.id;
$$;
REVOKE ALL ON FUNCTION public.get_public_plans() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_plans() TO anon, authenticated, service_role;

-- ============================================================================================
-- 3. Console reads (platform admin only; counts, never business figures)
-- ============================================================================================
CREATE OR REPLACE FUNCTION public.platform_overview()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    r jsonb;
BEGIN
    PERFORM public.fn_require_platform_admin();
    SELECT jsonb_build_object(
        'companies', count(*),
        'by_status', COALESCE(jsonb_object_agg(x.status, x.n) FILTER (WHERE x.status IS NOT NULL), '{}'::jsonb),
        'by_plan', (SELECT COALESCE(jsonb_object_agg(y.plan, y.n), '{}'::jsonb) FROM (
                        SELECT public.fn_tenant_plan(t.id)->>'plan' AS plan, count(*) AS n
                        FROM public.tenants t GROUP BY 1) y),
        'trials_ending_7_days', (SELECT count(*) FROM public.tenant_subscriptions
                                 WHERE status = 'trial' AND trial_ends_at BETWEEN now() AND now() + interval '7 days'),
        'requests_waiting', (SELECT count(*) FROM public.signup_requests WHERE status = 'pending'),
        'ai_calls_today', (SELECT COALESCE(sum(calls), 0) FROM public.ai_usage WHERE day = public.fn_ai_today()),
        'ai_refused_today', (SELECT COALESCE(sum(refused), 0) FROM public.ai_usage WHERE day = public.fn_ai_today()),
        'branches', (SELECT count(*) FROM public.businesses WHERE deleted_at IS NULL),
        'active_7_days', (SELECT count(DISTINCT b.tenant_id) FROM public.transactions tx
                          JOIN public.businesses b ON b.id = tx.business_id
                          WHERE tx.timestamp > now() - interval '7 days'))
    INTO r
    FROM (SELECT public.fn_tenant_plan(t.id)->>'status' AS status, count(*) AS n
          FROM public.tenants t GROUP BY 1) x;
    RETURN r;
END;
$$;
REVOKE ALL ON FUNCTION public.platform_overview() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.platform_overview() TO authenticated, service_role;

-- One company: its subscription, its branches (name, website address, counts) and what the
-- platform admin did to it. Sales are a count per branch, never an amount.
CREATE OR REPLACE FUNCTION public.platform_tenant_detail(p_tenant_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    s public.tenant_subscriptions;
BEGIN
    PERFORM public.fn_require_platform_admin();
    SELECT * INTO s FROM public.tenant_subscriptions WHERE tenant_id = p_tenant_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Unknown company.';
    END IF;
    RETURN jsonb_build_object(
        'plan', public.fn_tenant_plan(p_tenant_id),
        'subscription', jsonb_build_object(
            'plan_code', s.plan_code, 'status', s.status, 'billing_cycle', s.billing_cycle,
            'trial_ends_at', s.trial_ends_at, 'period_end', s.current_period_end,
            'addons', to_jsonb(s.addons), 'custom_limits', s.custom_limits, 'note', s.note,
            'started_at', s.started_at),
        'branches', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                'id', b.id, 'name', b.name, 'website_slug', b.website_slug,
                'website_home', public.fn_website_home_host(b.id),
                'staff', (SELECT count(*) FROM public.business_memberships bm
                          WHERE bm.business_id = b.id AND bm.status = 'Active'
                            AND bm.role::text <> 'Support'),
                'sales_30_days', (SELECT count(*) FROM public.transactions tx
                                  WHERE tx.business_id = b.id AND tx.timestamp > now() - interval '30 days'),
                'last_sale_at', (SELECT max(tx.timestamp) FROM public.transactions tx WHERE tx.business_id = b.id))
                ORDER BY b.created_at)
            FROM public.businesses b WHERE b.tenant_id = p_tenant_id AND b.deleted_at IS NULL), '[]'::jsonb),
        'ai_today', (SELECT jsonb_build_object('calls', calls, 'refused', refused) FROM public.ai_usage
                     WHERE tenant_id = p_tenant_id AND day = public.fn_ai_today()),
        'ai_30_days', (SELECT COALESCE(sum(calls), 0) FROM public.ai_usage
                       WHERE tenant_id = p_tenant_id AND day > public.fn_ai_today() - 30),
        'history', COALESCE((
            SELECT jsonb_agg(jsonb_build_object('action', a.action, 'details', a.details, 'at', a.created_at)
                             ORDER BY a.created_at DESC)
            FROM (SELECT * FROM public.platform_audit WHERE tenant_id = p_tenant_id
                  ORDER BY created_at DESC LIMIT 30) a), '[]'::jsonb));
END;
$$;
REVOKE ALL ON FUNCTION public.platform_tenant_detail(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.platform_tenant_detail(uuid) TO authenticated, service_role;

-- Sign-up and plan-change requests, newest first (waiting ones on top), with the asker's name.
CREATE OR REPLACE FUNCTION public.platform_requests(p_include_decided boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    PERFORM public.fn_require_platform_admin();
    RETURN COALESCE((
        SELECT jsonb_agg(to_jsonb(x) ORDER BY (x.status = 'pending') DESC, x.created_at DESC)
        FROM (
            SELECT r.id, r.kind, r.status, r.email, r.phone, r.business_name, r.plan_code,
                   p.name AS plan_name, r.billing_cycle, r.addons, r.payment_reference, r.message,
                   r.decision_note, r.created_at, r.decided_at, r.tenant_id,
                   (SELECT u.name FROM public.users u WHERE u.auth_user_id = r.auth_user_id LIMIT 1) AS person,
                   CASE WHEN r.tenant_id IS NOT NULL THEN public.fn_tenant_plan(r.tenant_id)->>'plan_name' END AS current_plan
            FROM public.signup_requests r
            JOIN public.plans p ON p.code = r.plan_code
            WHERE r.status = 'pending'
               OR (p_include_decided AND r.created_at > now() - interval '90 days')
            ORDER BY r.created_at DESC
            LIMIT 200) x), '[]'::jsonb);
END;
$$;
REVOKE ALL ON FUNCTION public.platform_requests(boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.platform_requests(boolean) TO authenticated, service_role;
