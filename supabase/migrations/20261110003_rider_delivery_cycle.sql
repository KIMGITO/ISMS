-- =============================================================================
-- 20261110003_rider_delivery_cycle.sql
-- Why: Riders could only work on deliveries staff gave them, and only the owner
-- could set delivery areas. Now every delivery nobody has taken is an open request
-- that any rider can see and accept. Riders run it from there (start, delivered,
-- couldn't deliver, or give it back), and they can add areas and set prices.
-- Owners and admins see who set each price and can change it.
-- Dependencies: 20261105015 (rider deliveries), 20261110001 (fn_sync_employee,
--               fn_find_rider, rider trigger)
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. DELIVERY AREAS: riders can add and price them; everyone sees who set them
-- ---------------------------------------------------------------------------
ALTER TABLE public.delivery_zones
    ADD COLUMN IF NOT EXISTS created_by      UUID,
    ADD COLUMN IF NOT EXISTS created_by_name TEXT,
    ADD COLUMN IF NOT EXISTS updated_by_name TEXT;

CREATE OR REPLACE FUNCTION public.fn_stamp_delivery_zone()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_name TEXT;
BEGIN
    SELECT NULLIF(trim(u.name), '') INTO v_name FROM public.users u WHERE u.auth_user_id = auth.uid();
    NEW.name := trim(NEW.name);
    NEW.updated_at := NOW();
    IF TG_OP = 'INSERT' THEN
        NEW.created_by := auth.uid();
        NEW.created_by_name := v_name;
    ELSE
        -- Who first added an area never changes.
        NEW.created_by := OLD.created_by;
        NEW.created_by_name := OLD.created_by_name;
    END IF;
    NEW.updated_by_name := v_name;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_stamp_delivery_zone ON public.delivery_zones;
CREATE TRIGGER trg_stamp_delivery_zone
BEFORE INSERT OR UPDATE ON public.delivery_zones
FOR EACH ROW EXECUTE FUNCTION public.fn_stamp_delivery_zone();

DROP POLICY IF EXISTS pol_delivery_zones_write ON public.delivery_zones;
DROP POLICY IF EXISTS pol_delivery_zones_insert ON public.delivery_zones;
DROP POLICY IF EXISTS pol_delivery_zones_update ON public.delivery_zones;
DROP POLICY IF EXISTS pol_delivery_zones_delete ON public.delivery_zones;

CREATE POLICY pol_delivery_zones_insert ON public.delivery_zones FOR INSERT
    WITH CHECK (public.has_permission(business_id, 'deliveries.delivery_zones'));
CREATE POLICY pol_delivery_zones_update ON public.delivery_zones FOR UPDATE
    USING (public.has_permission(business_id, 'deliveries.delivery_zones', 'deliveries.delivery_price'))
    WITH CHECK (public.has_permission(business_id, 'deliveries.delivery_zones', 'deliveries.delivery_price'));
-- Riders can delete only areas they added. Owners and admins can delete any area.
CREATE POLICY pol_delivery_zones_delete ON public.delivery_zones FOR DELETE
    USING (public.is_owner_or_admin(business_id)
           OR (created_by = auth.uid() AND public.has_permission(business_id, 'deliveries.delivery_zones')));

-- ---------------------------------------------------------------------------
-- 2. TILL SALES: an explicit rider wins over the name lookup
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_link_sale_rider()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF NEW.is_delivery THEN
        NEW.delivery_status := COALESCE(NEW.delivery_status, 'assigned');
        IF NULLIF(TRIM(COALESCE(NEW.rider_name, '')), '') IS NOT NULL
           AND (NEW.rider_id IS NULL
                OR (TG_OP = 'UPDATE' AND NEW.rider_name IS DISTINCT FROM OLD.rider_name
                    AND NEW.rider_id IS NOT DISTINCT FROM OLD.rider_id)) THEN
            NEW.rider_id := public.fn_find_rider(NEW.business_id, NEW.rider_name);
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- 3. ONE LIST OF DELIVERIES, used by the rider screens
-- ---------------------------------------------------------------------------
-- Till sales open to riders only for a few days, so old unassigned sales don't flood the list.
CREATE OR REPLACE FUNCTION public.fn_delivery_rows(p_business_id UUID)
RETURNS TABLE (
    source TEXT, id UUID, reference TEXT, customer_name TEXT, customer_phone TEXT,
    address TEXT, area TEXT, notes TEXT, amount NUMERIC, delivery_fee NUMERIC,
    status TEXT, assigned_at TIMESTAMPTZ, delivered_at TIMESTAMPTZ, created_at TIMESTAMPTZ,
    items TEXT, payment TEXT, balance_due NUMERIC, rider_id UUID, is_open BOOLEAN
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
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
           o.rider_id IS NULL AND o.status IN ('paid', 'preparing')
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
           t.rider_id IS NULL
    FROM public.transactions t
    LEFT JOIN public.customers c ON c.id = t.customer_id
    WHERE t.business_id = p_business_id AND t.is_delivery AND t.deleted_at IS NULL
      AND (t.rider_id IS NOT NULL
           OR (NULLIF(trim(COALESCE(t.rider_name, '')), '') IS NULL
               AND COALESCE(t.delivery_status, 'assigned') = 'assigned'
               AND t.timestamp > NOW() - INTERVAL '3 days'));
$$;

REVOKE ALL ON FUNCTION public.fn_delivery_rows(UUID) FROM PUBLIC, anon, authenticated;

-- A rider's own deliveries, newest first.
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
        SELECT jsonb_agg(to_jsonb(d) - 'rider_id' - 'is_open' ORDER BY d.assigned_at DESC)
        FROM public.fn_delivery_rows(p_business_id) d
        WHERE d.rider_id = v_rider
    ), '[]'::JSONB);
END;
$$;

-- Deliveries nobody has taken yet. The phone number shows once a rider accepts.
CREATE OR REPLACE FUNCTION public.get_delivery_requests(p_business_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    PERFORM public.assert_permission(p_business_id, 'deliveries.view');

    RETURN COALESCE((
        SELECT jsonb_agg(
                   (to_jsonb(d) - 'rider_id' - 'is_open') || jsonb_build_object('customer_phone', NULL)
                   ORDER BY d.created_at)
        FROM public.fn_delivery_rows(p_business_id) d
        WHERE d.is_open
    ), '[]'::JSONB);
END;
$$;

-- ---------------------------------------------------------------------------
-- 4. ACCEPTING AND GIVING BACK
-- ---------------------------------------------------------------------------
-- Tells every active rider in the business, except the one who caused it.
CREATE OR REPLACE FUNCTION public.fn_notify_riders(
    p_business_id UUID, p_title TEXT, p_message TEXT, p_payload JSONB, p_except_user UUID DEFAULT NULL
)
RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
    INSERT INTO public.notifications (business_id, user_id, title, message, type, payload, created_by)
    SELECT p_business_id, m.user_id, p_title, p_message, 'Delivery Assigned', p_payload, 'system'
    FROM public.business_memberships m
    WHERE m.business_id = p_business_id AND m.status = 'Active' AND m.role = 'Rider'
      AND m.user_id IS DISTINCT FROM p_except_user;
$$;

REVOKE ALL ON FUNCTION public.fn_notify_riders(UUID, TEXT, TEXT, JSONB, UUID) FROM PUBLIC, anon, authenticated;

-- The signed-in rider's user id for this business, or an error if they aren't a rider.
CREATE OR REPLACE FUNCTION public.fn_my_rider_user(p_business_id UUID)
RETURNS UUID
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_user UUID;
BEGIN
    SELECT u.id INTO v_user
    FROM public.users u
    JOIN public.business_memberships m ON m.user_id = u.id
    WHERE u.auth_user_id = auth.uid() AND m.business_id = p_business_id
      AND m.status = 'Active' AND m.role = 'Rider';
    IF v_user IS NULL THEN
        RAISE EXCEPTION 'Only riders can accept deliveries.' USING ERRCODE = '42501';
    END IF;
    RETURN v_user;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_my_rider_user(UUID) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.rider_accept_delivery(p_source TEXT, p_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_order    public.online_orders%ROWTYPE;
    v_sale     public.transactions%ROWTYPE;
    v_user     UUID;
    v_employee UUID;
    v_name     TEXT;
BEGIN
    IF p_source = 'online' THEN
        SELECT * INTO v_order FROM public.online_orders WHERE id = p_id FOR UPDATE;
        IF NOT FOUND OR v_order.fulfilment <> 'delivery' THEN
            RAISE EXCEPTION 'That delivery was not found.';
        END IF;
        PERFORM public.assert_permission(v_order.business_id, 'deliveries.complete');
        v_user := public.fn_my_rider_user(v_order.business_id);
        v_employee := public.fn_sync_employee(v_order.business_id, v_user);

        IF v_order.rider_id = v_employee THEN
            RETURN;
        END IF;
        IF v_order.rider_id IS NOT NULL THEN
            RAISE EXCEPTION 'Another rider has already taken this delivery.';
        END IF;
        IF v_order.status NOT IN ('paid', 'preparing') THEN
            RAISE EXCEPTION 'This delivery is no longer open.';
        END IF;

        SELECT name INTO v_name FROM public.users WHERE id = v_user;
        UPDATE public.online_orders SET rider_id = v_employee, rider_assigned_at = NOW() WHERE id = p_id;
        PERFORM public.fn_notify_staff(v_order.business_id, 'Rider accepted delivery',
            COALESCE(v_name, 'A rider') || ' will deliver order #' || v_order.order_number || '.',
            jsonb_build_object('orderId', p_id));
        PERFORM public.fn_customer_message(v_order.account_id, p_id,
            'A rider has picked up your order #' || v_order.order_number || '. It will be on its way soon.');
    ELSIF p_source = 'sale' THEN
        SELECT * INTO v_sale FROM public.transactions WHERE id = p_id AND deleted_at IS NULL FOR UPDATE;
        IF NOT FOUND OR NOT v_sale.is_delivery THEN
            RAISE EXCEPTION 'That delivery was not found.';
        END IF;
        PERFORM public.assert_permission(v_sale.business_id, 'deliveries.complete');
        v_user := public.fn_my_rider_user(v_sale.business_id);
        v_employee := public.fn_sync_employee(v_sale.business_id, v_user);

        IF v_sale.rider_id = v_employee THEN
            RETURN;
        END IF;
        IF v_sale.rider_id IS NOT NULL OR NULLIF(trim(COALESCE(v_sale.rider_name, '')), '') IS NOT NULL THEN
            RAISE EXCEPTION 'Another rider has already taken this delivery.';
        END IF;
        IF COALESCE(v_sale.delivery_status, 'assigned') <> 'assigned' THEN
            RAISE EXCEPTION 'This delivery is no longer open.';
        END IF;

        SELECT name INTO v_name FROM public.users WHERE id = v_user;
        UPDATE public.transactions
        SET rider_id = v_employee, rider_name = COALESCE(v_name, 'Rider'), delivery_status = 'assigned'
        WHERE id = p_id;
    ELSE
        RAISE EXCEPTION 'That delivery was not found.';
    END IF;
END;
$$;

-- A rider who can't take a delivery after all puts it back in the requests, before starting it.
CREATE OR REPLACE FUNCTION public.rider_release_delivery(p_source TEXT, p_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_order public.online_orders%ROWTYPE;
    v_sale  public.transactions%ROWTYPE;
    v_user  UUID;
BEGIN
    IF p_source = 'online' THEN
        SELECT * INTO v_order FROM public.online_orders WHERE id = p_id FOR UPDATE;
        IF NOT FOUND OR v_order.rider_id IS NULL
           OR v_order.rider_id IS DISTINCT FROM public.fn_my_employee_id(v_order.business_id) THEN
            RAISE EXCEPTION 'This delivery is not assigned to you.' USING ERRCODE = '42501';
        END IF;
        PERFORM public.assert_permission(v_order.business_id, 'deliveries.complete');
        IF v_order.status NOT IN ('paid', 'preparing') THEN
            RAISE EXCEPTION 'You have already started this delivery.';
        END IF;
        SELECT u.id INTO v_user FROM public.users u WHERE u.auth_user_id = auth.uid();

        UPDATE public.online_orders SET rider_id = NULL, rider_assigned_at = NULL WHERE id = p_id;
        PERFORM public.fn_notify_staff(v_order.business_id, 'Delivery needs a rider',
            'The rider gave back order #' || v_order.order_number || '.', jsonb_build_object('orderId', p_id));
        PERFORM public.fn_notify_riders(v_order.business_id, 'Delivery request',
            'Order #' || v_order.order_number || COALESCE(' to ' || v_order.delivery_zone, '') || ' needs a rider.',
            jsonb_build_object('orderId', p_id), v_user);
    ELSIF p_source = 'sale' THEN
        SELECT * INTO v_sale FROM public.transactions WHERE id = p_id AND deleted_at IS NULL FOR UPDATE;
        IF NOT FOUND OR v_sale.rider_id IS NULL
           OR v_sale.rider_id IS DISTINCT FROM public.fn_my_employee_id(v_sale.business_id) THEN
            RAISE EXCEPTION 'This delivery is not assigned to you.' USING ERRCODE = '42501';
        END IF;
        PERFORM public.assert_permission(v_sale.business_id, 'deliveries.complete');
        IF COALESCE(v_sale.delivery_status, 'assigned') <> 'assigned' THEN
            RAISE EXCEPTION 'You have already started this delivery.';
        END IF;
        SELECT u.id INTO v_user FROM public.users u WHERE u.auth_user_id = auth.uid();

        UPDATE public.transactions SET rider_id = NULL, rider_name = NULL WHERE id = p_id;
        PERFORM public.fn_notify_riders(v_sale.business_id, 'Delivery request',
            'A till delivery for ' || COALESCE(v_sale.customer_name, 'a customer') || ' needs a rider.',
            jsonb_build_object('saleId', p_id), v_user);
    ELSE
        RAISE EXCEPTION 'That delivery was not found.';
    END IF;
END;
$$;

DO $$
DECLARE
    fn TEXT;
BEGIN
    FOREACH fn IN ARRAY ARRAY[
        'get_my_deliveries(UUID)', 'get_delivery_requests(UUID)',
        'rider_accept_delivery(TEXT, UUID)', 'rider_release_delivery(TEXT, UUID)'
    ] LOOP
        EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon', fn);
        EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated', fn);
    END LOOP;
END;
$$;

-- ---------------------------------------------------------------------------
-- 5. RIDERS HEAR ABOUT NEW REQUESTS
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_announce_order_request()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF NEW.fulfilment = 'delivery' AND NEW.rider_id IS NULL AND NEW.status = 'paid'
       AND OLD.status IS DISTINCT FROM 'paid' THEN
        PERFORM public.fn_notify_riders(NEW.business_id, 'New delivery request',
            'Order #' || NEW.order_number || COALESCE(' to ' || NEW.delivery_zone, '') || ' needs a rider.',
            jsonb_build_object('orderId', NEW.id));
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_announce_order_request ON public.online_orders;
CREATE TRIGGER trg_announce_order_request
AFTER UPDATE OF status ON public.online_orders
FOR EACH ROW EXECUTE FUNCTION public.fn_announce_order_request();

CREATE OR REPLACE FUNCTION public.fn_announce_sale_request()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF NEW.is_delivery AND NEW.rider_id IS NULL AND NEW.deleted_at IS NULL
       AND NULLIF(trim(COALESCE(NEW.rider_name, '')), '') IS NULL THEN
        PERFORM public.fn_notify_riders(NEW.business_id, 'New delivery request',
            'A till delivery for ' || COALESCE(NEW.customer_name, 'a customer') || ' needs a rider.',
            jsonb_build_object('saleId', NEW.id));
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_announce_sale_request ON public.transactions;
CREATE TRIGGER trg_announce_sale_request
AFTER INSERT ON public.transactions
FOR EACH ROW EXECUTE FUNCTION public.fn_announce_sale_request();

-- ---------------------------------------------------------------------------
-- 6. Role defaults (mirrors SYSTEM_ROLES in src/utils/permissions.ts; a test compares them)
-- ---------------------------------------------------------------------------
INSERT INTO public.role_default_permissions (role, permissions) VALUES
    ('Manager', ARRAY['ai.insights', 'ai.use', 'assets.view', 'bom.create', 'bom.update', 'bom.view', 'business.switch', 'business.view', 'communication.send', 'communication.view', 'complaints.reply', 'complaints.view', 'customers.create', 'customers.debts', 'customers.loyalty', 'customers.manage', 'customers.schedules', 'customers.update', 'customers.view', 'dashboard.view', 'deliveries.assign', 'deliveries.cancel', 'deliveries.complete', 'deliveries.create', 'deliveries.view', 'expenses.create', 'expenses.update', 'expenses.view', 'files.view', 'finance.view', 'home.view', 'inventory.adjust_stock', 'inventory.expiry', 'inventory.receive_stock', 'inventory.stock_count', 'inventory.stock_history', 'inventory.transfer_stock', 'inventory.view', 'inventory.wastage', 'loyalty.adjust', 'notifications.send', 'notifications.view', 'online_store.view', 'orders.assign_rider', 'orders.complete', 'orders.create', 'orders.update', 'orders.view', 'payments.cash', 'payments.verify', 'payments.view', 'pettycash.record', 'pos.close_shift', 'pos.create_sale', 'pos.open_shift', 'pos.walkin_customer', 'production.approve', 'production.create', 'production.update', 'production.view', 'products.create', 'products.export', 'products.import', 'products.manage_categories', 'products.update', 'products.view', 'purchases.approve', 'purchases.create', 'purchases.export', 'purchases.print', 'purchases.update', 'purchases.view', 'reports.customers', 'reports.deliveries', 'reports.inventory', 'reports.profit', 'reports.sales', 'reports.view', 'settings.tax', 'settings.theme', 'settings.update', 'settings.view', 'staff.schedule', 'staff.view', 'suppliers.create', 'suppliers.export', 'suppliers.import', 'suppliers.update', 'suppliers.view']),
    ('Cashier', ARRAY['ai.use', 'business.view', 'complaints.view', 'customers.create', 'customers.debts', 'customers.loyalty', 'customers.schedules', 'customers.view', 'dashboard.view', 'inventory.view', 'notifications.view', 'online_store.view', 'orders.assign_rider', 'orders.create', 'orders.update', 'orders.view', 'payments.cash', 'payments.mpesa', 'payments.verify', 'pettycash.record', 'pos.cancel_sale', 'pos.close_shift', 'pos.create_sale', 'pos.discount', 'pos.open_shift', 'pos.walkin_customer', 'products.view', 'settings.theme']),
    ('Rider', ARRAY['ai.use', 'business.view', 'dashboard.view', 'deliveries.cancel', 'deliveries.complete', 'deliveries.delivery_price', 'deliveries.delivery_zones', 'deliveries.view', 'notifications.view', 'settings.theme'])
ON CONFLICT (role) DO UPDATE SET permissions = EXCLUDED.permissions;

NOTIFY pgrst, 'reload schema';

COMMIT;
