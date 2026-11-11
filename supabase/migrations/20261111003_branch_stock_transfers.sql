-- =============================================================================
-- 20261111003_branch_stock_transfers.sql
--
-- Moving stock between branches (e.g. Main sends milk to three shops).
--
-- Each branch is its own business row with its own products, stock and cost. A transfer
-- moves stock from a product at one branch to the same product at another:
--
--   send     -> stock leaves the sending branch now ("on the way")
--   receive  -> the receiving branch counts what arrived; only that is added there
--   cancel   -> while still on the way, the sender takes it back; stock returns
--
-- What it must not break:
--   * Sales, profit, growth, cash balancing, KRA, points: a transfer writes no sale,
--     expense or payment, so none of those see it. The business as a whole does not
--     earn or spend anything by moving its own stock.
--   * Cost of goods: each line carries the sender's cost at the time it was sent. On
--     arrival the receiving product's cost becomes the weighted average of what it had
--     and what came in, so the receiving branch's later sales (which save unit_cost at the
--     moment of sale) show the true margin, and the sender is not credited with profit.
--   * Stock history: every move is logged in inventory_adjustments with before/after
--     stock (Transfer Out / Transfer In / Transfer Return), so counts still reconcile.
--   * Shortages: what was sent but not received stays on the transfer as "short", with
--     its cost value, so losses on the road are visible instead of silently vanishing.
--
-- Rules: the two branches must share an owner. Sending needs inventory.transfer_stock at
-- the sender; receiving needs inventory.receive_stock or inventory.transfer_stock at the
-- receiver. Everything goes through the functions below; clients cannot write the tables.
-- Dependencies: 20261105014 (permissions), 20261109005 (fn_my_employee, unit_cost),
--               20261109004 (notification catalog), 20261110001 (notification privacy)
-- =============================================================================

-- New stock history types. ADD VALUE cannot share a transaction with code that uses the
-- value, and the functions below only use it when they run, so this sits outside BEGIN.
ALTER TYPE public.inventory_adjustment_type ADD VALUE IF NOT EXISTS 'Transfer Out';
ALTER TYPE public.inventory_adjustment_type ADD VALUE IF NOT EXISTS 'Transfer In';
ALTER TYPE public.inventory_adjustment_type ADD VALUE IF NOT EXISTS 'Transfer Return';

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Tables
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.stock_transfers (
    id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    reference         TEXT NOT NULL UNIQUE,
    from_business_id  UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    to_business_id    UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    status            TEXT NOT NULL DEFAULT 'in_transit'
                          CHECK (status IN ('in_transit', 'received', 'cancelled')),
    note              TEXT,
    sent_by_name      TEXT NOT NULL,
    sent_by_user_id   UUID REFERENCES public.users(id) ON DELETE SET NULL,
    sent_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    received_by_name  TEXT,
    received_at       TIMESTAMPTZ,
    receive_note      TEXT,
    cancelled_by_name TEXT,
    cancelled_at      TIMESTAMPTZ,
    cancel_reason     TEXT,
    client_reference  TEXT,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (from_business_id <> to_business_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_stock_transfers_client_ref
    ON public.stock_transfers (from_business_id, client_reference) WHERE client_reference IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_stock_transfers_from ON public.stock_transfers (from_business_id, sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_stock_transfers_to   ON public.stock_transfers (to_business_id, sent_at DESC);

CREATE TABLE IF NOT EXISTS public.stock_transfer_items (
    id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    transfer_id       UUID NOT NULL REFERENCES public.stock_transfers(id) ON DELETE CASCADE,
    from_product_id   UUID REFERENCES public.products(id) ON DELETE SET NULL,
    to_product_id     UUID REFERENCES public.products(id) ON DELETE SET NULL,
    product_name      TEXT NOT NULL,
    sku               TEXT,
    unit              TEXT NOT NULL,
    category          TEXT NOT NULL,
    unit_cost         NUMERIC(14,2) NOT NULL CHECK (unit_cost >= 0),
    unit_price        NUMERIC(14,2) NOT NULL CHECK (unit_price >= 0),
    quantity_sent     NUMERIC(14,3) NOT NULL CHECK (quantity_sent > 0),
    quantity_received NUMERIC(14,3) CHECK (quantity_received IS NULL OR (quantity_received >= 0 AND quantity_received <= quantity_sent)),
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_stock_transfer_items_transfer ON public.stock_transfer_items (transfer_id);

ALTER TABLE public.stock_transfers      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_transfer_items ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.stock_transfers, public.stock_transfer_items FROM anon, authenticated;
GRANT SELECT ON public.stock_transfers TO authenticated;

-- Read-only, so live updates reach both branches. Lines are read through list_stock_transfers.
DROP POLICY IF EXISTS pol_stock_transfers_select ON public.stock_transfers;
CREATE POLICY pol_stock_transfers_select ON public.stock_transfers
    FOR SELECT USING (
        (from_business_id = ANY(public.get_user_business_ids())
            AND public.has_permission(from_business_id, 'inventory.transfer_stock', 'inventory.receive_stock', 'inventory.stock_history'))
        OR (to_business_id = ANY(public.get_user_business_ids())
            AND public.has_permission(to_business_id, 'inventory.transfer_stock', 'inventory.receive_stock', 'inventory.stock_history'))
    );

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
       AND NOT EXISTS (
           SELECT 1 FROM pg_publication_tables
           WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'stock_transfers'
       ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.stock_transfers;
    END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 2. Helpers
-- ---------------------------------------------------------------------------
-- True when one person is an active Owner of both branches.
CREATE OR REPLACE FUNCTION public.fn_branches_share_owner(p_a UUID, p_b UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.business_memberships a
        JOIN public.business_memberships b ON b.user_id = a.user_id
        WHERE a.business_id = p_a AND b.business_id = p_b
          AND a.role = 'Owner' AND b.role = 'Owner'
          AND a.status = 'Active' AND b.status = 'Active'
    );
$$;

-- The signed-in person's name as staff at this branch, or their account name.
CREATE OR REPLACE FUNCTION public.fn_my_display_name(p_business_id UUID)
RETURNS TEXT
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
    v_name TEXT;
BEGIN
    v_name := (public.fn_my_employee(p_business_id)).name;
    IF NULLIF(btrim(COALESCE(v_name, '')), '') IS NULL THEN
        SELECT u.name INTO v_name FROM public.users u WHERE u.auth_user_id = auth.uid();
    END IF;
    RETURN COALESCE(NULLIF(btrim(COALESCE(v_name, '')), ''), 'Staff');
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_my_user_id()
RETURNS UUID
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
    SELECT u.id FROM public.users u WHERE u.auth_user_id = auth.uid() LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.fn_branches_share_owner(UUID, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_my_display_name(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_my_user_id() FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Which branches this branch can send to
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.list_transfer_branches(p_business_id UUID)
RETURNS TABLE (id UUID, name TEXT, address TEXT)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
    PERFORM public.assert_business_member(p_business_id);
    PERFORM public.assert_permission(p_business_id, 'inventory.transfer_stock', 'inventory.receive_stock');

    RETURN QUERY
    SELECT b.id, b.name, b.address
    FROM public.businesses b
    WHERE b.id <> p_business_id
      AND b.deleted_at IS NULL
      AND public.fn_branches_share_owner(p_business_id, b.id)
    ORDER BY b.name;
END;
$$;

-- ---------------------------------------------------------------------------
-- 4. Send
-- p_items: [{ "product_id": uuid, "quantity": number }, ...]
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.send_stock_transfer(
    p_from_business_id UUID,
    p_to_business_id   UUID,
    p_items            JSONB,
    p_note             TEXT DEFAULT NULL,
    p_reference_id     TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
    v_existing  public.stock_transfers;
    v_transfer  public.stock_transfers;
    v_to_name   TEXT;
    v_from_name TEXT;
    v_me        TEXT;
    v_line      RECORD;
    v_count     INTEGER := 0;
    v_value     NUMERIC := 0;
BEGIN
    PERFORM public.assert_business_member(p_from_business_id);
    PERFORM public.assert_permission(p_from_business_id, 'inventory.transfer_stock');

    IF p_reference_id IS NOT NULL THEN
        SELECT * INTO v_existing FROM public.stock_transfers
        WHERE from_business_id = p_from_business_id AND client_reference = p_reference_id;
        IF FOUND THEN
            RETURN jsonb_build_object('id', v_existing.id, 'reference', v_existing.reference);
        END IF;
    END IF;

    IF p_to_business_id IS NULL OR p_to_business_id = p_from_business_id THEN
        RAISE EXCEPTION 'Choose the branch the stock is going to.';
    END IF;
    SELECT name INTO v_to_name FROM public.businesses WHERE id = p_to_business_id AND deleted_at IS NULL;
    IF v_to_name IS NULL OR NOT public.fn_branches_share_owner(p_from_business_id, p_to_business_id) THEN
        RAISE EXCEPTION 'You can only send stock to another branch of this business.';
    END IF;
    SELECT name INTO v_from_name FROM public.businesses WHERE id = p_from_business_id;

    IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
        RAISE EXCEPTION 'Add at least one product to send.';
    END IF;
    IF jsonb_array_length(p_items) > 200 THEN
        RAISE EXCEPTION 'Send at most 200 products at a time.';
    END IF;

    IF EXISTS (
        SELECT 1 FROM jsonb_array_elements(p_items) e
        LEFT JOIN public.products p ON p.id = (e->>'product_id')::UUID
        WHERE p.id IS NULL OR p.business_id <> p_from_business_id OR p.deleted_at IS NOT NULL
    ) THEN
        RAISE EXCEPTION 'One of the products is not in this branch any more. Refresh and try again.';
    END IF;

    v_me := public.fn_my_display_name(p_from_business_id);

    INSERT INTO public.stock_transfers (
        reference, from_business_id, to_business_id, note, sent_by_name, sent_by_user_id, client_reference
    ) VALUES (
        'TR-' || to_char(NOW() AT TIME ZONE 'Africa/Nairobi', 'YYMMDD') || '-'
              || upper(substr(md5(gen_random_uuid()::TEXT), 1, 5)),
        p_from_business_id, p_to_business_id,
        NULLIF(btrim(COALESCE(p_note, '')), ''),
        v_me, public.fn_my_user_id(), p_reference_id
    )
    RETURNING * INTO v_transfer;

    -- Same product listed twice is sent once with the quantities added. Rows are locked
    -- in id order so two transfers at once cannot deadlock.
    FOR v_line IN
        WITH wanted AS (
            SELECT (e->>'product_id')::UUID AS product_id, SUM((e->>'quantity')::NUMERIC) AS qty
            FROM jsonb_array_elements(p_items) e
            GROUP BY 1
        )
        SELECT p.id, p.name, p.sku, p.unit, p.category, p.cost, p.price, p.stock, w.qty
        FROM wanted w
        JOIN public.products p ON p.id = w.product_id
        ORDER BY p.id
        FOR UPDATE OF p
    LOOP
        IF v_line.qty IS NULL OR v_line.qty <= 0 THEN
            RAISE EXCEPTION 'Enter how much % to send.', v_line.name;
        END IF;
        v_line.qty := ROUND(v_line.qty, 3);
        IF v_line.qty > v_line.stock THEN
            RAISE EXCEPTION 'Only % % of % left here. You can''t send %.',
                trim(to_char(v_line.stock, 'FM999999990.###')), v_line.unit, v_line.name,
                trim(to_char(v_line.qty, 'FM999999990.###'));
        END IF;

        INSERT INTO public.stock_transfer_items (
            transfer_id, from_product_id, product_name, sku, unit, category, unit_cost, unit_price, quantity_sent
        ) VALUES (
            v_transfer.id, v_line.id, v_line.name, v_line.sku, v_line.unit, v_line.category,
            v_line.cost, v_line.price, v_line.qty
        );

        UPDATE public.products SET stock = stock - v_line.qty, updated_at = NOW() WHERE id = v_line.id;

        INSERT INTO public.inventory_adjustments (
            business_id, product_id, product_name, type, quantity_adjusted, previous_stock, new_stock,
            reason, staff_name, reference_number, notes
        ) VALUES (
            p_from_business_id, v_line.id, v_line.name, 'Transfer Out', -v_line.qty,
            v_line.stock, v_line.stock - v_line.qty,
            'Sent to ' || v_to_name, v_me, v_transfer.reference, v_transfer.note
        );

        v_count := v_count + 1;
        v_value := v_value + v_line.qty * v_line.cost;
    END LOOP;

    INSERT INTO public.notifications (business_id, title, message, type, priority, action_type, action_target, payload, created_by)
    VALUES (
        p_to_business_id,
        'Stock on the way',
        v_from_name || ' sent ' || v_count || CASE WHEN v_count = 1 THEN ' product' ELSE ' products' END
            || ' (' || v_transfer.reference || '). Check it when it arrives and confirm what came.',
        'Stock Transfer', 'high', 'navigate', 'stock-transfers',
        jsonb_build_object('transferId', v_transfer.id, 'reference', v_transfer.reference),
        'system'
    );

    RETURN jsonb_build_object('id', v_transfer.id, 'reference', v_transfer.reference, 'lines', v_count, 'costValue', ROUND(v_value, 2));
END;
$$;

-- ---------------------------------------------------------------------------
-- 5. Receive
-- p_lines: [{ "item_id": uuid, "quantity_received": number }, ...]. A line left out is
-- taken as fully received.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.receive_stock_transfer(
    p_transfer_id UUID,
    p_lines       JSONB DEFAULT '[]'::JSONB,
    p_note        TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
    v_t         public.stock_transfers;
    v_item      public.stock_transfer_items;
    v_src       public.products;
    v_dest      public.products;
    v_from_name TEXT;
    v_me        TEXT;
    v_qty       NUMERIC(14,3);
    v_given     JSONB;
    v_new_cost  NUMERIC(14,2);
    v_short     NUMERIC := 0;
    v_short_n   INTEGER := 0;
    v_created   INTEGER := 0;
BEGIN
    SELECT * INTO v_t FROM public.stock_transfers WHERE id = p_transfer_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Transfer not found.';
    END IF;
    PERFORM public.assert_business_member(v_t.to_business_id);
    PERFORM public.assert_permission(v_t.to_business_id, 'inventory.receive_stock', 'inventory.transfer_stock');

    IF v_t.status = 'received' THEN
        RETURN jsonb_build_object('id', v_t.id, 'reference', v_t.reference, 'already', TRUE);
    END IF;
    IF v_t.status = 'cancelled' THEN
        RAISE EXCEPTION 'This transfer was cancelled by the sender, so there is nothing to receive.';
    END IF;

    SELECT name INTO v_from_name FROM public.businesses WHERE id = v_t.from_business_id;
    v_me := public.fn_my_display_name(v_t.to_business_id);

    FOR v_item IN SELECT * FROM public.stock_transfer_items WHERE transfer_id = v_t.id ORDER BY id LOOP
        SELECT e INTO v_given
        FROM jsonb_array_elements(COALESCE(p_lines, '[]'::JSONB)) e
        WHERE (e->>'item_id')::UUID = v_item.id
        LIMIT 1;

        v_qty := CASE WHEN v_given IS NULL OR v_given->>'quantity_received' IS NULL
                      THEN v_item.quantity_sent
                      ELSE ROUND((v_given->>'quantity_received')::NUMERIC, 3) END;
        IF v_qty < 0 THEN
            RAISE EXCEPTION 'Received amount for % can''t be below zero.', v_item.product_name;
        END IF;
        IF v_qty > v_item.quantity_sent THEN
            RAISE EXCEPTION 'More % came than was sent (% %). Receive what was sent, then restock the extra.',
                v_item.product_name, trim(to_char(v_item.quantity_sent, 'FM999999990.###')), v_item.unit;
        END IF;

        -- The same product here: same SKU first, then same name.
        v_dest := NULL;
        IF NULLIF(btrim(COALESCE(v_item.sku, '')), '') IS NOT NULL THEN
            SELECT * INTO v_dest FROM public.products
            WHERE business_id = v_t.to_business_id AND sku = v_item.sku AND deleted_at IS NULL
            FOR UPDATE;
        END IF;
        IF v_dest.id IS NULL THEN
            SELECT * INTO v_dest FROM public.products
            WHERE business_id = v_t.to_business_id AND deleted_at IS NULL
              AND lower(btrim(name)) = lower(btrim(v_item.product_name))
            ORDER BY created_at
            LIMIT 1
            FOR UPDATE;
        END IF;

        IF v_dest.id IS NOT NULL AND lower(btrim(v_dest.unit)) <> lower(btrim(v_item.unit)) THEN
            RAISE EXCEPTION '% is counted in % here but in % at %. Make the units match first.',
                v_item.product_name, v_dest.unit, v_item.unit, v_from_name;
        END IF;

        IF v_dest.id IS NULL THEN
            -- Not sold here yet: add it, copying the sender's details. Its selling price can
            -- be changed afterwards; its cost is what the stock cost the business.
            SELECT * INTO v_src FROM public.products WHERE id = v_item.from_product_id;
            INSERT INTO public.products (
                business_id, name, category, price, cost, image, stock, min_stock, unit, sku,
                description, perishable, expiry_days, last_modified_by
            ) VALUES (
                v_t.to_business_id, v_item.product_name, v_item.category, v_item.unit_price, v_item.unit_cost,
                v_src.image, 0, COALESCE(v_src.min_stock, 0), v_item.unit,
                CASE WHEN v_item.sku IS NOT NULL AND NOT EXISTS (
                    SELECT 1 FROM public.products x WHERE x.business_id = v_t.to_business_id AND x.sku = v_item.sku
                ) THEN v_item.sku END,
                v_src.description, COALESCE(v_src.perishable, TRUE), v_src.expiry_days, v_me
            )
            RETURNING * INTO v_dest;
            v_created := v_created + 1;
        END IF;

        IF v_qty > 0 THEN
            -- Weighted average: what was already here at its cost, plus what came at the sender's.
            v_new_cost := CASE
                WHEN v_dest.stock <= 0 THEN v_item.unit_cost
                ELSE ROUND((v_dest.stock * v_dest.cost + v_qty * v_item.unit_cost) / (v_dest.stock + v_qty), 2)
            END;

            UPDATE public.products
            SET stock = stock + v_qty, cost = v_new_cost, updated_at = NOW()
            WHERE id = v_dest.id;

            INSERT INTO public.inventory_adjustments (
                business_id, product_id, product_name, type, quantity_adjusted, previous_stock, new_stock,
                reason, staff_name, reference_number, notes
            ) VALUES (
                v_t.to_business_id, v_dest.id, v_dest.name, 'Transfer In', v_qty,
                v_dest.stock, v_dest.stock + v_qty,
                'From ' || v_from_name
                    || CASE WHEN v_qty < v_item.quantity_sent
                            THEN ' (' || trim(to_char(v_item.quantity_sent - v_qty, 'FM999999990.###')) || ' ' || v_item.unit || ' short)'
                            ELSE '' END,
                v_me, v_t.reference, NULLIF(btrim(COALESCE(p_note, '')), '')
            );
        END IF;

        IF v_qty < v_item.quantity_sent THEN
            v_short := v_short + (v_item.quantity_sent - v_qty) * v_item.unit_cost;
            v_short_n := v_short_n + 1;
        END IF;

        UPDATE public.stock_transfer_items
        SET quantity_received = v_qty, to_product_id = v_dest.id
        WHERE id = v_item.id;
    END LOOP;

    UPDATE public.stock_transfers
    SET status = 'received', received_by_name = v_me, received_at = NOW(),
        receive_note = NULLIF(btrim(COALESCE(p_note, '')), ''), updated_at = NOW()
    WHERE id = v_t.id;

    IF v_short_n > 0 THEN
        INSERT INTO public.notifications (business_id, title, message, type, priority, action_type, action_target, payload, created_by)
        SELECT v_t.from_business_id, 'Transfer arrived short',
               b.name || ' received ' || v_t.reference || ' with ' || v_short_n
                   || CASE WHEN v_short_n = 1 THEN ' product' ELSE ' products' END
                   || ' short (KSh ' || trim(to_char(ROUND(v_short), 'FM999,999,999,990')) || ' at cost).',
               'Stock Transfer', 'high', 'navigate', 'stock-transfers',
               jsonb_build_object('transferId', v_t.id, 'reference', v_t.reference), 'system'
        FROM public.businesses b WHERE b.id = v_t.to_business_id;
    END IF;

    RETURN jsonb_build_object('id', v_t.id, 'reference', v_t.reference, 'shortValue', ROUND(v_short, 2), 'productsAdded', v_created);
END;
$$;

-- ---------------------------------------------------------------------------
-- 6. Cancel (sender, while still on the way). Stock goes back.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cancel_stock_transfer(p_transfer_id UUID, p_reason TEXT)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
    v_t       public.stock_transfers;
    v_item    public.stock_transfer_items;
    v_stock   NUMERIC(14,3);
    v_name    TEXT;
    v_me      TEXT;
BEGIN
    SELECT * INTO v_t FROM public.stock_transfers WHERE id = p_transfer_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Transfer not found.';
    END IF;
    PERFORM public.assert_business_member(v_t.from_business_id);
    PERFORM public.assert_permission(v_t.from_business_id, 'inventory.transfer_stock');

    IF v_t.status = 'cancelled' THEN
        RETURN;
    END IF;
    IF v_t.status = 'received' THEN
        RAISE EXCEPTION 'This transfer was already received, so it can''t be cancelled. Send the stock back with a new transfer.';
    END IF;
    IF NULLIF(btrim(COALESCE(p_reason, '')), '') IS NULL THEN
        RAISE EXCEPTION 'Say why this transfer is being cancelled.';
    END IF;

    v_me := public.fn_my_display_name(v_t.from_business_id);

    FOR v_item IN SELECT * FROM public.stock_transfer_items WHERE transfer_id = v_t.id ORDER BY from_product_id LOOP
        IF v_item.from_product_id IS NULL THEN
            CONTINUE; -- product was removed for good; nothing to put back
        END IF;
        SELECT stock, name INTO v_stock, v_name FROM public.products WHERE id = v_item.from_product_id FOR UPDATE;
        IF NOT FOUND THEN
            CONTINUE;
        END IF;

        UPDATE public.products SET stock = stock + v_item.quantity_sent, updated_at = NOW() WHERE id = v_item.from_product_id;

        INSERT INTO public.inventory_adjustments (
            business_id, product_id, product_name, type, quantity_adjusted, previous_stock, new_stock,
            reason, staff_name, reference_number, notes
        ) VALUES (
            v_t.from_business_id, v_item.from_product_id, v_name, 'Transfer Return', v_item.quantity_sent,
            v_stock, v_stock + v_item.quantity_sent,
            'Transfer cancelled', v_me, v_t.reference, btrim(p_reason)
        );
    END LOOP;

    UPDATE public.stock_transfers
    SET status = 'cancelled', cancelled_by_name = v_me, cancelled_at = NOW(),
        cancel_reason = btrim(p_reason), updated_at = NOW()
    WHERE id = v_t.id;

    INSERT INTO public.notifications (business_id, title, message, type, priority, action_type, action_target, payload, created_by)
    SELECT v_t.to_business_id, 'Transfer cancelled',
           b.name || ' cancelled ' || v_t.reference || ': ' || btrim(p_reason),
           'Stock Transfer', 'medium', 'navigate', 'stock-transfers',
           jsonb_build_object('transferId', v_t.id, 'reference', v_t.reference), 'system'
    FROM public.businesses b WHERE b.id = v_t.from_business_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- 7. List transfers in and out of a branch, newest first, with their lines.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.list_stock_transfers(p_business_id UUID, p_limit INTEGER DEFAULT 100)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
    v_out JSONB;
BEGIN
    PERFORM public.assert_business_member(p_business_id);
    PERFORM public.assert_permission(p_business_id, 'inventory.transfer_stock', 'inventory.receive_stock', 'inventory.stock_history');

    SELECT COALESCE(jsonb_agg(row_data ORDER BY sort_key DESC), '[]'::JSONB) INTO v_out
    FROM (
        SELECT t.sent_at AS sort_key,
               jsonb_build_object(
                   'id', t.id,
                   'reference', t.reference,
                   'direction', CASE WHEN t.from_business_id = p_business_id THEN 'out' ELSE 'in' END,
                   'fromBusinessId', t.from_business_id,
                   'fromName', bf.name,
                   'toBusinessId', t.to_business_id,
                   'toName', bt.name,
                   'status', t.status,
                   'note', t.note,
                   'sentBy', t.sent_by_name,
                   'sentAt', t.sent_at,
                   'receivedBy', t.received_by_name,
                   'receivedAt', t.received_at,
                   'receiveNote', t.receive_note,
                   'cancelledBy', t.cancelled_by_name,
                   'cancelledAt', t.cancelled_at,
                   'cancelReason', t.cancel_reason,
                   'items', COALESCE((
                       SELECT jsonb_agg(jsonb_build_object(
                           'id', i.id,
                           'fromProductId', i.from_product_id,
                           'toProductId', i.to_product_id,
                           'productName', i.product_name,
                           'sku', i.sku,
                           'unit', i.unit,
                           'unitCost', i.unit_cost,
                           'quantitySent', i.quantity_sent,
                           'quantityReceived', i.quantity_received
                       ) ORDER BY i.product_name)
                       FROM public.stock_transfer_items i WHERE i.transfer_id = t.id
                   ), '[]'::JSONB)
               ) AS row_data
        FROM public.stock_transfers t
        JOIN public.businesses bf ON bf.id = t.from_business_id
        JOIN public.businesses bt ON bt.id = t.to_business_id
        WHERE t.from_business_id = p_business_id OR t.to_business_id = p_business_id
        ORDER BY t.sent_at DESC
        LIMIT LEAST(GREATEST(COALESCE(p_limit, 100), 1), 500)
    ) q;

    RETURN v_out;
END;
$$;

REVOKE ALL ON FUNCTION public.list_transfer_branches(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.send_stock_transfer(UUID, UUID, JSONB, TEXT, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.receive_stock_transfer(UUID, JSONB, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.cancel_stock_transfer(UUID, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.list_stock_transfers(UUID, INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION
    public.list_transfer_branches(UUID),
    public.send_stock_transfer(UUID, UUID, JSONB, TEXT, TEXT),
    public.receive_stock_transfer(UUID, JSONB, TEXT),
    public.cancel_stock_transfer(UUID, TEXT),
    public.list_stock_transfers(UUID, INTEGER)
TO authenticated;

-- ---------------------------------------------------------------------------
-- 8. Notifications: "Stock Transfer" belongs with the other stock alerts.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_notification_catalog()
RETURNS TABLE (category TEXT, types TEXT[], permissions TEXT[], locked BOOLEAN)
LANGUAGE sql
IMMUTABLE
AS $$
    VALUES
        ('stock', ARRAY['Stock Almost Finished', 'Out Of Stock', 'Stock Transfer'], ARRAY['inventory.view'], FALSE),
        ('sales', ARRAY['Sales Summary', 'Daily Report', 'Weekly Report', 'Monthly Report'], ARRAY['reports.sales'], FALSE),
        ('debts', ARRAY['Debt Due Reminder', 'Credit Sale'], ARRAY['customers.debts'], FALSE),
        ('deliveries', ARRAY['Delivery Assigned', 'Delivery Completed'], ARRAY['deliveries.view'], FALSE),
        ('payments', ARRAY['Payment Received', 'Low Cash Balance'], ARRAY['payments.view', 'payments.verify'], FALSE),
        ('online_store', ARRAY['Online Store'], ARRAY['online_store.view'], FALSE),
        ('schedules', ARRAY['Schedule Reminder', 'Scheduled Reminder'], NULL::TEXT[], FALSE),
        ('unaccepted', ARRAY['Alert Not Accepted'], ARRAY['staff.view'], FALSE),
        ('ai', ARRAY['AI Business Insight', 'AI Recommendation', 'AI Risk Alert'], ARRAY['ai.insights'], FALSE),
        ('announcements', ARRAY['Business Announcement', 'Custom Notification'], NULL::TEXT[], FALSE),
        ('account', ARRAY['Role Invitation', 'Account Activity', 'System Update'], NULL::TEXT[], TRUE);
$$;

COMMIT;
