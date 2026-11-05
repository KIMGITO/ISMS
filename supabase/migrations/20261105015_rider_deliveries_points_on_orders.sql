-- =============================================================================
-- 20261105015_rider_deliveries_points_on_orders.sql
-- Why: Riders were named on sales but nothing tied a delivery to them, so they had
-- no way to see their work without the full customer list. Riders now see only
-- their assigned deliveries and history. Points can also pay part of an order.
-- Dependencies: 20261105010 (online orders), 20261105013 (loyalty),
--               20261105014 (has_permission)
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- COLUMNS
-- ---------------------------------------------------------------------------
ALTER TABLE public.online_orders
    ADD COLUMN IF NOT EXISTS rider_id           UUID REFERENCES public.employees(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS rider_assigned_at  TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS delivered_at       TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS points_used        INTEGER NOT NULL DEFAULT 0 CHECK (points_used >= 0),
    ADD COLUMN IF NOT EXISTS points_value       NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (points_value >= 0),
    ADD COLUMN IF NOT EXISTS points_refunded_at TIMESTAMPTZ;

ALTER TABLE public.transactions
    ADD COLUMN IF NOT EXISTS rider_id         UUID REFERENCES public.employees(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS delivery_status  TEXT CHECK (delivery_status IN ('assigned', 'out_for_delivery', 'delivered', 'failed')),
    ADD COLUMN IF NOT EXISTS delivered_at     TIMESTAMPTZ;

ALTER TABLE public.loyalty_redemptions
    ADD COLUMN IF NOT EXISTS order_id    UUID REFERENCES public.online_orders(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS refunded_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_online_orders_rider ON public.online_orders(rider_id) WHERE rider_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_transactions_rider ON public.transactions(rider_id) WHERE rider_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- POINTS ON ORDERS
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.place_online_order(JSONB, TEXT, TEXT, TEXT, UUID);
DROP FUNCTION IF EXISTS public.fn_build_online_order(UUID, JSONB, TEXT, TEXT, TEXT, UUID, UUID);

CREATE OR REPLACE FUNCTION public.fn_build_online_order(
    p_account_id UUID,
    p_items      JSONB,
    p_fulfilment TEXT,
    p_address    TEXT,
    p_notes      TEXT,
    p_schedule_id UUID,
    p_zone_id    UUID DEFAULT NULL,
    p_points     INTEGER DEFAULT 0
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_account  public.customer_accounts%ROWTYPE;
    v_settings public.website_settings%ROWTYPE;
    v_order_id UUID;
    v_line     RECORD;
    v_subtotal NUMERIC(14,2) := 0;
    v_fee      NUMERIC(14,2) := 0;
    v_raw      NUMERIC(14,2);
    v_address  TEXT := NULLIF(trim(COALESCE(p_address, '')), '');
    v_zone     public.delivery_zones%ROWTYPE;
    v_customer public.customers%ROWTYPE;
    v_points   INTEGER := COALESCE(p_points, 0);
    v_point_value NUMERIC(10,2);
    v_min_redeem  INTEGER;
    v_points_value NUMERIC(14,2) := 0;
BEGIN
    SELECT * INTO v_account FROM public.customer_accounts WHERE id = p_account_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Please finish setting up your account first.';
    END IF;

    IF jsonb_typeof(p_items) IS DISTINCT FROM 'array'
       OR jsonb_array_length(p_items) NOT BETWEEN 1 AND 30 THEN
        RAISE EXCEPTION 'Your cart is empty.';
    END IF;

    IF p_fulfilment NOT IN ('delivery', 'pickup') THEN
        RAISE EXCEPTION 'Please choose delivery or pickup.';
    END IF;

    SELECT * INTO v_settings FROM public.website_settings WHERE business_id = v_account.business_id;
    v_settings.delivery_enabled := COALESCE(v_settings.delivery_enabled, TRUE);
    v_settings.delivery_fee := COALESCE(v_settings.delivery_fee, 0);
    v_settings.min_order := COALESCE(v_settings.min_order, 0);

    IF p_fulfilment = 'delivery' THEN
        IF NOT v_settings.delivery_enabled THEN
            RAISE EXCEPTION 'Delivery is not available right now. Please choose pickup.';
        END IF;
        IF v_address IS NULL THEN
            RAISE EXCEPTION 'Please enter your delivery location.';
        END IF;
        v_fee := v_settings.delivery_fee;

        IF EXISTS (SELECT 1 FROM public.delivery_zones z WHERE z.business_id = v_account.business_id AND z.active) THEN
            SELECT * INTO v_zone FROM public.delivery_zones z
            WHERE z.id = COALESCE(p_zone_id, v_account.delivery_zone_id)
              AND z.business_id = v_account.business_id
              AND z.active;
            IF NOT FOUND THEN
                RAISE EXCEPTION 'Please choose your delivery area.';
            END IF;
            v_fee := v_zone.fee;
            -- Scheduled orders reuse the area the customer last chose.
            UPDATE public.customer_accounts SET delivery_zone_id = v_zone.id WHERE id = v_account.id;
        END IF;
    END IF;

    INSERT INTO public.online_orders
        (business_id, account_id, schedule_id, customer_name, customer_phone, fulfilment,
         delivery_address, delivery_zone, notes, subtotal, delivery_fee, total)
    VALUES
        (v_account.business_id, v_account.id, p_schedule_id, v_account.name, v_account.phone, p_fulfilment,
         CASE WHEN p_fulfilment = 'delivery' THEN v_address END, v_zone.name,
         left(NULLIF(trim(COALESCE(p_notes, '')), ''), 500), 0, v_fee, 1)
    RETURNING id INTO v_order_id;

    FOR v_line IN
        SELECT i.product_id, sum(i.quantity) AS quantity,
               p.name, p.unit, p.price, p.stock, p.id AS found_id
        FROM (
            SELECT (e->>'productId')::UUID AS product_id, (e->>'quantity')::NUMERIC(14,3) AS quantity
            FROM jsonb_array_elements(p_items) e
        ) i
        LEFT JOIN public.products p
            ON p.id = i.product_id
           AND p.business_id = v_account.business_id
           AND p.deleted_at IS NULL
           AND p.show_on_website
           AND p.price > 0
        GROUP BY i.product_id, p.name, p.unit, p.price, p.stock, p.id
    LOOP
        IF v_line.found_id IS NULL THEN
            RAISE EXCEPTION 'A product in your cart is no longer available.';
        END IF;
        IF v_line.quantity IS NULL OR v_line.quantity <= 0 OR v_line.quantity > 1000 THEN
            RAISE EXCEPTION 'Please check the amount of %.', v_line.name;
        END IF;
        IF v_line.stock < v_line.quantity THEN
            RAISE EXCEPTION 'We don''t have enough % right now. Please try a smaller amount.', v_line.name;
        END IF;

        INSERT INTO public.online_order_items
            (order_id, product_id, product_name, unit, unit_price, quantity, line_total)
        VALUES
            (v_order_id, v_line.product_id, v_line.name, v_line.unit, v_line.price, v_line.quantity,
             round(v_line.price * v_line.quantity, 2));
        v_subtotal := v_subtotal + round(v_line.price * v_line.quantity, 2);
    END LOOP;

    IF v_subtotal < v_settings.min_order THEN
        RAISE EXCEPTION 'The minimum order is %.', v_settings.min_order;
    END IF;

    v_raw := v_subtotal + v_fee;
    IF floor(v_raw) < 1 THEN
        RAISE EXCEPTION 'Your order total is too small to pay by M-Pesa.';
    END IF;

    IF v_points <> 0 THEN
        SELECT * INTO v_customer FROM public.customers WHERE id = v_account.customer_id FOR UPDATE;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'Please finish setting up your account first.';
        END IF;
        SELECT point_value, min_redeem_points INTO v_point_value, v_min_redeem
        FROM public.loyalty_settings WHERE business_id = v_account.business_id;
        v_point_value := COALESCE(v_point_value, 1);
        v_min_redeem := COALESCE(v_min_redeem, 100);

        IF v_points < v_min_redeem THEN
            RAISE EXCEPTION 'You can use points from % points.', v_min_redeem;
        END IF;
        IF v_points > v_customer.loyalty_points THEN
            RAISE EXCEPTION 'You only have % points.', v_customer.loyalty_points;
        END IF;

        v_points_value := round(v_points * v_point_value, 2);
        -- M-Pesa needs at least Ksh 1, and it's what confirms the order.
        IF floor(v_raw - v_points_value) < 1 THEN
            RAISE EXCEPTION 'Points can cover all but the last shilling of an order. Please use fewer points.';
        END IF;

        UPDATE public.customers SET loyalty_points = loyalty_points - v_points WHERE id = v_customer.id;
        INSERT INTO public.loyalty_redemptions (business_id, customer_id, points, value, recorded_by, order_id)
        VALUES (v_account.business_id, v_customer.id, v_points, v_points_value, 'Customer', v_order_id);
    END IF;

    UPDATE public.online_orders
    SET subtotal = v_subtotal,
        discount = v_raw - floor(v_raw - v_points_value),
        total = floor(v_raw - v_points_value),
        points_used = v_points,
        points_value = v_points_value
    WHERE id = v_order_id;

    RETURN v_order_id;
EXCEPTION
    WHEN invalid_text_representation OR numeric_value_out_of_range THEN
        RAISE EXCEPTION 'Your cart has an invalid item.';
END;
$$;

CREATE OR REPLACE FUNCTION public.place_online_order(
    p_items JSONB, p_fulfilment TEXT, p_address TEXT, p_notes TEXT, p_zone_id UUID DEFAULT NULL, p_points INTEGER DEFAULT 0
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Please sign in first.';
    END IF;
    IF (
        SELECT count(*) FROM public.online_orders
        WHERE account_id = auth.uid() AND status IN ('pending_payment', 'payment_failed')
    ) >= 5 THEN
        RAISE EXCEPTION 'You have several unpaid orders. Please pay or cancel one first.';
    END IF;
    RETURN public.fn_build_online_order(auth.uid(), p_items, p_fulfilment, p_address, p_notes, NULL, p_zone_id, p_points);
END;
$$;

REVOKE ALL ON FUNCTION public.fn_build_online_order(UUID, JSONB, TEXT, TEXT, TEXT, UUID, UUID, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_build_online_order(UUID, JSONB, TEXT, TEXT, TEXT, UUID, UUID, INTEGER) TO service_role;
REVOKE ALL ON FUNCTION public.place_online_order(JSONB, TEXT, TEXT, TEXT, UUID, INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.place_online_order(JSONB, TEXT, TEXT, TEXT, UUID, INTEGER) TO authenticated;

-- Every route to cancelling an order comes through here, so the points always come back.
CREATE OR REPLACE FUNCTION public.fn_refund_order_points()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF NEW.status = 'cancelled' AND OLD.status <> 'cancelled'
       AND OLD.points_used > 0 AND OLD.points_refunded_at IS NULL THEN
        UPDATE public.customers c
        SET loyalty_points = c.loyalty_points + OLD.points_used
        FROM public.customer_accounts a
        WHERE a.id = OLD.account_id AND c.id = a.customer_id;

        UPDATE public.loyalty_redemptions SET refunded_at = NOW() WHERE order_id = OLD.id AND refunded_at IS NULL;
        NEW.points_refunded_at := NOW();
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_refund_order_points ON public.online_orders;
CREATE TRIGGER trg_refund_order_points
BEFORE UPDATE OF status ON public.online_orders
FOR EACH ROW EXECUTE FUNCTION public.fn_refund_order_points();

-- Points used at the till. The sale records them as a discount; if it fails, the app gives them back.
CREATE OR REPLACE FUNCTION public.spend_points_at_till(p_customer_id UUID, p_points INTEGER, p_recorded_by TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_customer public.customers%ROWTYPE;
    v_value_per NUMERIC(10,2);
    v_min INTEGER;
    v_value NUMERIC(14,2);
    v_id UUID;
BEGIN
    SELECT * INTO v_customer FROM public.customers WHERE id = p_customer_id AND deleted_at IS NULL FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Customer not found.';
    END IF;
    PERFORM public.assert_permission(v_customer.business_id, 'customers.loyalty');

    SELECT point_value, min_redeem_points INTO v_value_per, v_min
    FROM public.loyalty_settings WHERE business_id = v_customer.business_id;
    v_value_per := COALESCE(v_value_per, 1);
    v_min := COALESCE(v_min, 100);

    IF p_points IS NULL OR p_points < v_min THEN
        RAISE EXCEPTION 'You can use points from % points.', v_min;
    END IF;
    IF p_points > v_customer.loyalty_points THEN
        RAISE EXCEPTION 'This customer only has % points.', v_customer.loyalty_points;
    END IF;

    v_value := round(p_points * v_value_per, 2);
    UPDATE public.customers SET loyalty_points = loyalty_points - p_points WHERE id = p_customer_id;
    INSERT INTO public.loyalty_redemptions (business_id, customer_id, points, value, recorded_by)
    VALUES (v_customer.business_id, p_customer_id, p_points, v_value, COALESCE(NULLIF(trim(p_recorded_by), ''), 'Staff'))
    RETURNING id INTO v_id;

    RETURN jsonb_build_object('redemptionId', v_id, 'value', v_value);
END;
$$;

CREATE OR REPLACE FUNCTION public.refund_till_points(p_redemption_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_row public.loyalty_redemptions%ROWTYPE;
BEGIN
    SELECT * INTO v_row FROM public.loyalty_redemptions
    WHERE id = p_redemption_id AND refunded_at IS NULL AND order_id IS NULL
    FOR UPDATE;
    IF NOT FOUND THEN
        RETURN;
    END IF;
    PERFORM public.assert_permission(v_row.business_id, 'customers.loyalty');

    UPDATE public.customers SET loyalty_points = loyalty_points + v_row.points WHERE id = v_row.customer_id;
    UPDATE public.loyalty_redemptions SET refunded_at = NOW() WHERE id = p_redemption_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- RIDERS
-- ---------------------------------------------------------------------------
-- Till sales name a rider, so link the delivery to that rider's employee record.
CREATE OR REPLACE FUNCTION public.fn_link_sale_rider()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF NEW.is_delivery THEN
        NEW.delivery_status := COALESCE(NEW.delivery_status, 'assigned');
        IF NEW.rider_id IS NULL AND NEW.rider_name IS NOT NULL THEN
            SELECT e.id INTO NEW.rider_id
            FROM public.employees e
            WHERE e.business_id = NEW.business_id AND e.name = NEW.rider_name
              AND e.role = 'Rider' AND e.deleted_at IS NULL
            ORDER BY e.created_at
            LIMIT 1;
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_link_sale_rider ON public.transactions;
CREATE TRIGGER trg_link_sale_rider
BEFORE INSERT ON public.transactions
FOR EACH ROW EXECUTE FUNCTION public.fn_link_sale_rider();

CREATE OR REPLACE FUNCTION public.fn_my_employee_id(p_business_id UUID)
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT e.id
    FROM public.employees e
    JOIN public.users u ON u.id = e.user_id
    WHERE e.business_id = p_business_id AND u.auth_user_id = auth.uid() AND e.deleted_at IS NULL
    LIMIT 1;
$$;

-- A rider's own deliveries with what they need: who, where, how much. Nothing else about the customer.
CREATE OR REPLACE FUNCTION public.get_my_deliveries(p_business_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_rider UUID;
BEGIN
    PERFORM public.assert_permission(p_business_id, 'deliveries.view');
    v_rider := public.fn_my_employee_id(p_business_id);
    IF v_rider IS NULL THEN
        RETURN '[]'::JSONB;
    END IF;

    RETURN COALESCE((
        SELECT jsonb_agg(row_to_json(d) ORDER BY d.assigned_at DESC)
        FROM (
            SELECT 'online' AS source, o.id, '#' || o.order_number AS reference,
                   o.customer_name, o.customer_phone,
                   o.delivery_address AS address, o.delivery_zone AS area, o.notes,
                   o.total AS amount, o.delivery_fee,
                   CASE o.status
                       WHEN 'out_for_delivery' THEN 'out_for_delivery'
                       WHEN 'completed' THEN 'delivered'
                       WHEN 'cancelled' THEN 'failed'
                       ELSE 'assigned'
                   END AS status,
                   COALESCE(o.rider_assigned_at, o.created_at) AS assigned_at, o.delivered_at,
                   (SELECT string_agg(i.quantity::FLOAT8 || ' ' || i.unit || ' ' || i.product_name, ', ')
                    FROM public.online_order_items i WHERE i.order_id = o.id) AS items
            FROM public.online_orders o
            WHERE o.business_id = p_business_id AND o.rider_id = v_rider
            UNION ALL
            SELECT 'sale', t.id, 'Sale', COALESCE(c.name, t.customer_name, 'Walk-in customer'), c.phone,
                   NULL, NULL, t.note,
                   t.final_total, t.delivery_fee,
                   COALESCE(t.delivery_status, 'assigned'),
                   t.timestamp, t.delivered_at,
                   (SELECT string_agg(i.quantity::FLOAT8 || ' ' || i.product_name, ', ')
                    FROM public.transaction_items i WHERE i.transaction_id = t.id)
            FROM public.transactions t
            LEFT JOIN public.customers c ON c.id = t.customer_id
            WHERE t.business_id = p_business_id AND t.rider_id = v_rider AND t.deleted_at IS NULL
        ) d
    ), '[]'::JSONB);
END;
$$;

CREATE OR REPLACE FUNCTION public.rider_update_delivery(p_source TEXT, p_id UUID, p_status TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_order public.online_orders%ROWTYPE;
    v_sale  public.transactions%ROWTYPE;
BEGIN
    IF p_status NOT IN ('out_for_delivery', 'delivered', 'failed') THEN
        RAISE EXCEPTION 'That delivery status is not valid.';
    END IF;

    IF p_source = 'online' THEN
        SELECT * INTO v_order FROM public.online_orders WHERE id = p_id FOR UPDATE;
        IF NOT FOUND OR v_order.rider_id IS NULL
           OR v_order.rider_id IS DISTINCT FROM public.fn_my_employee_id(v_order.business_id) THEN
            RAISE EXCEPTION 'This delivery is not assigned to you.' USING ERRCODE = '42501';
        END IF;
        PERFORM public.assert_permission(v_order.business_id, CASE WHEN p_status = 'failed' THEN 'deliveries.cancel' ELSE 'deliveries.complete' END);

        IF p_status = 'failed' THEN
            -- Staff decide what happens next, because the customer has already paid.
            UPDATE public.online_orders
            SET needs_attention = TRUE,
                attention_reason = concat_ws(' ', attention_reason, 'The rider could not complete this delivery.'),
                rider_id = NULL
            WHERE id = p_id;
            PERFORM public.fn_notify_staff(v_order.business_id, 'Delivery not completed',
                'Order #' || v_order.order_number || ' could not be delivered.', jsonb_build_object('orderId', p_id));
        ELSIF p_status = 'out_for_delivery' THEN
            IF v_order.status NOT IN ('paid', 'preparing') THEN
                RAISE EXCEPTION 'This order can''t go out for delivery yet.';
            END IF;
            UPDATE public.online_orders SET status = 'out_for_delivery' WHERE id = p_id;
            PERFORM public.fn_customer_message(v_order.account_id, p_id,
                'Your order #' || v_order.order_number || ' is on the way.');
        ELSE
            IF v_order.status <> 'out_for_delivery' THEN
                RAISE EXCEPTION 'Please mark this order as out for delivery first.';
            END IF;
            UPDATE public.online_orders SET status = 'completed', delivered_at = NOW() WHERE id = p_id;
            PERFORM public.fn_customer_message(v_order.account_id, p_id,
                'Your order #' || v_order.order_number || ' has been delivered. Thank you!');
        END IF;
    ELSIF p_source = 'sale' THEN
        SELECT * INTO v_sale FROM public.transactions WHERE id = p_id AND deleted_at IS NULL FOR UPDATE;
        IF NOT FOUND OR v_sale.rider_id IS NULL
           OR v_sale.rider_id IS DISTINCT FROM public.fn_my_employee_id(v_sale.business_id) THEN
            RAISE EXCEPTION 'This delivery is not assigned to you.' USING ERRCODE = '42501';
        END IF;
        PERFORM public.assert_permission(v_sale.business_id, CASE WHEN p_status = 'failed' THEN 'deliveries.cancel' ELSE 'deliveries.complete' END);
        UPDATE public.transactions
        SET delivery_status = p_status,
            delivered_at = CASE WHEN p_status = 'delivered' THEN NOW() ELSE delivered_at END
        WHERE id = p_id;
    ELSE
        RAISE EXCEPTION 'That delivery was not found.';
    END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.staff_assign_rider(p_order_id UUID, p_rider_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_order public.online_orders%ROWTYPE;
    v_rider public.employees%ROWTYPE;
BEGIN
    SELECT * INTO v_order FROM public.online_orders WHERE id = p_order_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Order not found.';
    END IF;
    PERFORM public.assert_permission(v_order.business_id, 'orders.assign_rider');

    IF v_order.fulfilment <> 'delivery' OR v_order.status NOT IN ('paid', 'preparing', 'out_for_delivery') THEN
        RAISE EXCEPTION 'Only paid delivery orders can be given to a rider.';
    END IF;

    IF p_rider_id IS NULL THEN
        UPDATE public.online_orders SET rider_id = NULL, rider_assigned_at = NULL WHERE id = p_order_id;
        RETURN;
    END IF;

    SELECT * INTO v_rider FROM public.employees
    WHERE id = p_rider_id AND business_id = v_order.business_id AND role = 'Rider' AND deleted_at IS NULL;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'That rider was not found.';
    END IF;

    UPDATE public.online_orders SET rider_id = p_rider_id, rider_assigned_at = NOW() WHERE id = p_order_id;
    INSERT INTO public.notifications (business_id, user_id, title, message, type, payload, created_by)
    VALUES (v_order.business_id, v_rider.user_id, 'New delivery',
            'Order #' || v_order.order_number || ' for ' || v_order.customer_name || ' is assigned to you.',
            'Online Store', jsonb_build_object('orderId', p_order_id), 'system');
END;
$$;

REVOKE ALL ON FUNCTION public.fn_my_employee_id(UUID) FROM PUBLIC, anon, authenticated;
DO $$
DECLARE
    fn TEXT;
BEGIN
    FOREACH fn IN ARRAY ARRAY[
        'spend_points_at_till(UUID, INTEGER, TEXT)', 'refund_till_points(UUID)',
        'get_my_deliveries(UUID)', 'rider_update_delivery(TEXT, UUID, TEXT)', 'staff_assign_rider(UUID, UUID)'
    ] LOOP
        EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon', fn);
        EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated', fn);
    END LOOP;
END;
$$;

-- ---------------------------------------------------------------------------
-- Used by the dial-code function for someone who began phone sign-in on the website.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.find_auth_user_by_phone(p_phone TEXT)
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT id FROM auth.users WHERE phone = p_phone LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.find_auth_user_by_phone(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.find_auth_user_by_phone(TEXT) TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
