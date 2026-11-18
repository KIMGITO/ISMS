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
