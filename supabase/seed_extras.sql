-- =============================================================================
-- seed_extras.sql: the rest of the business, on top of seed.sql
--
-- Runs after seed.sql (see [db.seed] sql_paths in config.toml). Remove it from
-- sql_paths to get only the minimal data.
--
-- Adds, for the same 90 days:
--   * purchases: one per supplier delivery already in the stock history
--   * production: recipes for mala and yoghurt at Main; the mala/yoghurt that
--     arrived at Main become production batches made from bulk milk
--   * shifts for every staff member, with their sales counted
--   * expenses (rent, wages, power, transport) and petty cash for every branch
--   * website: delivery areas, promo codes, 8 shopper logins, online orders
--   * deliveries: some past Main sales were delivered by the rider, and a few
--     deliveries today are still in progress or waiting for a rider
--   * business assets for every branch
--   * opening money balances for every branch
--
-- It never adds past stock movements that would clash with the sales already
-- there: past purchases and batches are built from the deliveries seed.sql made,
-- and past online orders and deliveries are made from existing sales. Only
-- today's open orders and deliveries are new sales.
--
-- Money balances: expenses are written in date order after the sales, so the
-- running balances in the money ledger are recalculated at the end.
-- =============================================================================

SET client_min_messages = error;
SET check_function_bodies = off;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM public.businesses WHERE id = 'b1000000-0000-4000-8000-000000000001') THEN
        RAISE EXCEPTION 'seed_extras.sql adds to the data from seed.sql. Run seed.sql first.';
    END IF;
    IF EXISTS (SELECT 1 FROM public.purchases) OR EXISTS (SELECT 1 FROM public.customer_accounts) THEN
        RAISE EXCEPTION 'seed_extras.sql has already run on this database (or it is not a seeded test database).';
    END IF;
END $$;

SELECT setseed(0.4177);

-- -----------------------------------------------------------------------------
-- Helpers (own names, so they never clash with seed.sql's in the same session)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION pg_temp.x_ri(a INT, b INT) RETURNS INT LANGUAGE sql VOLATILE
AS $$ SELECT a + floor(random() * (b - a + 1))::INT $$;

CREATE OR REPLACE FUNCTION pg_temp.x_pick(arr TEXT[]) RETURNS TEXT LANGUAGE sql VOLATILE
AS $$ SELECT arr[1 + floor(random() * array_length(arr, 1))::INT] $$;

CREATE OR REPLACE FUNCTION pg_temp.x_at(d DATE, h INT, m INT) RETURNS TIMESTAMPTZ LANGUAGE sql VOLATILE
AS $$ SELECT ((d + make_time(h, m, floor(random() * 60)::INT)) AT TIME ZONE 'Africa/Nairobi') $$;

CREATE OR REPLACE FUNCTION pg_temp.x_mpesa() RETURNS TEXT LANGUAGE sql VOLATILE
AS $$ SELECT 'T' || upper(substr(translate(md5(random()::TEXT), '0123456789', 'GHJKLMNPQR'), 1, 3))
             || upper(substr(md5(random()::TEXT), 1, 6)) $$;

-- Website shopper login (customer account type)
CREATE OR REPLACE FUNCTION pg_temp.x_shopper(p_id UUID, p_email TEXT, p_name TEXT, p_phone TEXT, p_created TIMESTAMPTZ)
RETURNS UUID LANGUAGE plpgsql AS $f$
BEGIN
    INSERT INTO auth.users (
        instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
        raw_app_meta_data, raw_user_meta_data, created_at, updated_at, last_sign_in_at,
        confirmation_token, recovery_token, email_change_token_new, email_change,
        email_change_token_current, phone_change, phone_change_token, reauthentication_token,
        is_sso_user, is_anonymous
    ) VALUES (
        '00000000-0000-0000-0000-000000000000', p_id, 'authenticated', 'authenticated', p_email,
        extensions.crypt('Test1234!', extensions.gen_salt('bf')), p_created,
        '{"provider":"email","providers":["email"]}',
        jsonb_build_object('name', p_name, 'phone', p_phone, 'account_type', 'customer'),
        p_created, p_created, now() - interval '1 day',
        '', '', '', '', '', '', '', '', FALSE, FALSE
    );
    INSERT INTO auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
    VALUES (gen_random_uuid(), p_id, p_id::TEXT,
            jsonb_build_object('sub', p_id::TEXT, 'email', p_email, 'email_verified', TRUE),
            'email', now() - interval '1 day', p_created, p_created);
    UPDATE public.users SET is_verified = TRUE, phone_verified = TRUE, created_at = p_created, updated_at = p_created
    WHERE id = p_id;
    RETURN p_id;
END $f$;

-- Stock movement with an explicit time and an optional production batch
CREATE OR REPLACE FUNCTION pg_temp.x_adjust(p_prod UUID, p_type public.inventory_adjustment_type, p_delta NUMERIC,
                                            p_reason TEXT, p_staff TEXT, p_ts TIMESTAMPTZ, p_ref TEXT, p_batch UUID)
RETURNS NUMERIC LANGUAGE plpgsql AS $f$
DECLARE
    v_old NUMERIC; v_new NUMERIC; v_name TEXT; v_biz UUID;
BEGIN
    SELECT stock, name, business_id INTO v_old, v_name, v_biz FROM public.products WHERE id = p_prod FOR UPDATE;
    v_new := GREATEST(0, v_old + p_delta);
    IF v_new = v_old THEN RETURN 0; END IF;
    UPDATE public.products SET stock = v_new WHERE id = p_prod;
    INSERT INTO public.inventory_adjustments (business_id, product_id, product_name, type, quantity_adjusted,
        previous_stock, new_stock, timestamp, reason, staff_name, reference_number, batch_id, created_at, updated_at, last_modified_by)
    VALUES (v_biz, p_prod, v_name, p_type, v_new - v_old, v_old, v_new, p_ts, p_reason, p_staff, p_ref, p_batch,
            p_ts, p_ts, p_staff);
    RETURN v_new - v_old;
END $f$;

-- =============================================================================
-- 1. Production at Main: bulk milk, recipes, batches
-- =============================================================================
DO $production$
DECLARE
    B1 CONSTANT UUID := 'b1000000-0000-4000-8000-000000000001';
    v_open TIMESTAMPTZ;
    v_bulk UUID; r RECORD; v_recipe UUID; v_bom UUID; v_batch UUID; v_ref TEXT; v_need NUMERIC; v_have NUMERIC;
BEGIN
    SELECT created_at INTO v_open FROM public.businesses WHERE id = B1;

    -- Bulk milk: the raw material (also sold by the litre, but not by this seed)
    INSERT INTO public.products (business_id, name, category, price, cost, stock, min_stock, unit, sku, description,
        perishable, expiry_days, show_on_website, created_at, updated_at, last_modified_by)
    VALUES (B1, 'Fresh Milk (Bulk, per litre)', 'Fresh Milk', 58, 40, 0, 20, 'Litres', 'KK-FM-BULK',
            'Bring your own container. Also what our mala and yoghurt are made from.', TRUE, 2, FALSE,
            v_open, v_open, 'Dennis Kimanthi')
    RETURNING id INTO v_bulk;

    CREATE TEMP TABLE x_made (sku TEXT, milk NUMERIC, flavoured BOOLEAN) ON COMMIT DROP;
    INSERT INTO x_made VALUES ('KK-ML-500', 0.5, FALSE), ('KK-ML-1000', 1.0, FALSE),
        ('KK-YG-STR-500', 0.55, TRUE), ('KK-YG-VAN-500', 0.55, TRUE), ('KK-YG-MNG-250', 0.3, TRUE);

    -- Recipe + bill of materials per product
    CREATE TEMP TABLE x_recipe (product_id UUID, recipe_id UUID, bom_id UUID, milk NUMERIC, name TEXT, unit TEXT) ON COMMIT DROP;
    FOR r IN SELECT p.id, p.name, p.unit, p.sku, m.milk, m.flavoured
             FROM public.products p JOIN x_made m ON m.sku = p.sku WHERE p.business_id = B1 LOOP
        INSERT INTO public.recipes (business_id, name, code, description, yield_quantity, yield_unit, created_at, updated_at)
        VALUES (B1, r.name, 'RCP-' || substr(r.sku, 4), 'House recipe for ' || r.name, 1, r.unit, v_open, v_open)
        RETURNING id INTO v_recipe;
        INSERT INTO public.recipe_ingredients (recipe_id, name, quantity, unit, created_at) VALUES
            (v_recipe, 'Fresh milk', r.milk, 'Litres', v_open),
            (v_recipe, 'Starter culture', 2, 'Grams', v_open);
        IF r.flavoured THEN
            INSERT INTO public.recipe_ingredients (recipe_id, name, quantity, unit, created_at)
            VALUES (v_recipe, 'Fruit / flavour', 25, 'Grams', v_open), (v_recipe, 'Sugar', 20, 'Grams', v_open);
        END IF;
        INSERT INTO public.bill_of_materials (business_id, product_id, recipe_id, name, yield_quantity, yield_unit, created_at, updated_at)
        VALUES (B1, r.id, v_recipe, r.name, 1, r.unit, v_open, v_open)
        RETURNING id INTO v_bom;
        INSERT INTO public.bom_ingredients (bom_id, product_id, quantity_required, unit, waste_percentage, created_at)
        VALUES (v_bom, v_bulk, r.milk, 'Litres', 2, v_open);
        INSERT INTO x_recipe VALUES (r.id, v_recipe, v_bom, r.milk, r.name, r.unit);
    END LOOP;

    -- Every delivery of mala/yoghurt at Main becomes a batch made in-house that morning
    FOR r IN SELECT ia.id AS adj_id, ia.timestamp AS ts, ia.quantity_adjusted AS qty, x.*
             FROM public.inventory_adjustments ia JOIN x_recipe x ON x.product_id = ia.product_id
             WHERE ia.business_id = B1 AND ia.type = 'Restock'
             ORDER BY ia.timestamp LOOP
        v_need := round(r.qty * r.milk * 1.02, 2);
        -- bulk milk delivered first when there isn't enough
        SELECT stock INTO v_have FROM public.products WHERE id = v_bulk;
        IF v_have < v_need THEN
            PERFORM pg_temp.x_adjust(v_bulk, 'Restock', ceil(v_need - v_have) + 60, 'Delivery from Kiambu Dairy Farmers Co-op',
                'Joseph Kiprono', r.ts - interval '40 minutes',
                'PO-' || to_char(r.ts AT TIME ZONE 'Africa/Nairobi', 'YYMMDD') || '-BULK', NULL);
        END IF;
        v_ref := 'PB-' || to_char(r.ts AT TIME ZONE 'Africa/Nairobi', 'YYMMDD') || '-' || upper(substr(md5(r.adj_id::TEXT), 1, 4));
        INSERT INTO public.production_batches (business_id, recipe_id, recipe_name, quantity_produced, unit, status,
            staff_name, date, product_id, bom_id, reference_number, created_at, updated_at)
        VALUES (B1, r.recipe_id, r.name, r.qty, r.unit, 'Completed', 'Joseph Kiprono', r.ts - interval '3 hours',
                r.product_id, r.bom_id, v_ref, r.ts - interval '3 hours', r.ts)
        RETURNING id INTO v_batch;
        PERFORM pg_temp.x_adjust(v_bulk, 'Production Consumption', -v_need, 'Used for ' || r.name, 'Joseph Kiprono',
            r.ts - interval '3 hours', v_ref, v_batch);
        UPDATE public.inventory_adjustments
        SET type = 'Production Output', reason = 'Batch ' || v_ref, reference_number = v_ref, batch_id = v_batch,
            staff_name = 'Joseph Kiprono', last_modified_by = 'Joseph Kiprono'
        WHERE id = r.adj_id;
    END LOOP;

    -- Top bulk milk up for today's counter sales
    SELECT stock INTO v_have FROM public.products WHERE id = v_bulk;
    PERFORM pg_temp.x_adjust(v_bulk, 'Restock', GREATEST(0, 120 - v_have), 'Delivery from Kiambu Dairy Farmers Co-op',
        'Joseph Kiprono', pg_temp.x_at((now() AT TIME ZONE 'Africa/Nairobi')::DATE, 5, 10),
        'PO-' || to_char(now() AT TIME ZONE 'Africa/Nairobi', 'YYMMDD') || '-BULK', NULL);

    -- One spoiled batch, one being made right now (no stock moved for either)
    INSERT INTO public.production_batches (business_id, recipe_id, recipe_name, quantity_produced, unit, status, staff_name, date,
        product_id, bom_id, reference_number, created_at, updated_at)
    SELECT B1, recipe_id, name, 20, unit, 'Cancelled', 'Joseph Kiprono', now() - interval '23 days', product_id, bom_id,
           'PB-SPOILT-1', now() - interval '23 days', now() - interval '23 days'
    FROM x_recipe WHERE name LIKE 'Vanilla%'
    UNION ALL
    SELECT B1, recipe_id, name, 30, unit, 'In Progress', 'Joseph Kiprono', now() - interval '2 hours', product_id, bom_id,
           'PB-TODAY-1', now() - interval '2 hours', now() - interval '2 hours'
    FROM x_recipe WHERE name = 'Mala 500ml';

    -- Low-stock alerts the bulk milk history raised just now would all show as today's; drop them
    DELETE FROM public.notifications WHERE created_at = now();
END $production$;

-- =============================================================================
-- 2. Purchases: one per supplier delivery in the stock history
-- =============================================================================
DO $purchases$
BEGIN
    CREATE TEMP TABLE x_po ON COMMIT DROP AS
        SELECT gen_random_uuid() AS id, ia.business_id, ia.reference_number AS ref,
               substr(ia.reason, length('Delivery from ') + 1) AS supplier, MIN(ia.timestamp) AS ts
        FROM public.inventory_adjustments ia
        WHERE ia.type = 'Restock' AND ia.reason LIKE 'Delivery from %'
        GROUP BY ia.business_id, ia.reference_number, ia.reason;

    INSERT INTO public.purchases (id, business_id, supplier_name, total_amount, status, date, created_at, updated_at)
    SELECT po.id, po.business_id, po.supplier,
           (SELECT SUM(ia.quantity_adjusted * p.cost) FROM public.inventory_adjustments ia JOIN public.products p ON p.id = ia.product_id
            WHERE ia.business_id = po.business_id AND ia.reference_number = po.ref AND ia.type = 'Restock'),
           'Received', po.ts, po.ts, po.ts
    FROM x_po po;

    INSERT INTO public.purchase_items (purchase_id, name, quantity, unit, price, created_at)
    SELECT po.id, p.name, SUM(ia.quantity_adjusted), p.unit, p.cost, po.ts
    FROM x_po po
    JOIN public.inventory_adjustments ia ON ia.business_id = po.business_id AND ia.reference_number = po.ref AND ia.type = 'Restock'
    JOIN public.products p ON p.id = ia.product_id
    GROUP BY po.id, p.name, p.unit, p.cost, po.ts;

    -- Orders not delivered yet
    INSERT INTO public.purchases (business_id, supplier_name, total_amount, status, date, created_at, updated_at) VALUES
      ('b1000000-0000-4000-8000-000000000001', 'Limuru Fresh Farms', 18500, 'Ordered', now() - interval '2 days', now() - interval '2 days', now() - interval '2 days'),
      ('b1000000-0000-4000-8000-000000000001', 'Sweet Valley Honey', 7800, 'Pending', now() - interval '5 hours', now() - interval '5 hours', now() - interval '5 hours'),
      ('b2000000-0000-4000-8000-000000000002', 'Nairobi Bakers Ltd', 3900, 'Cancelled', now() - interval '20 days', now() - interval '20 days', now() - interval '19 days');
END $purchases$;

-- =============================================================================
-- 3. Website: settings, delivery areas, promo codes, shopper logins, orders
--    and deliveries made from existing sales
-- =============================================================================
DO $website$
DECLARE
    B1 CONSTANT UUID := 'b1000000-0000-4000-8000-000000000001';
    today DATE := (now() AT TIME ZONE 'Africa/Nairobi')::DATE;
    d0 DATE := today - 90;
    E_RIDER UUID; r RECORD; v_id UUID; v_order UUID; v_zone RECORD; v_receipt TEXT; v_num BIGINT; v_k INT;
    v_promo UUID; v_status TEXT; v_ts TIMESTAMPTZ; i INT := 0;
BEGIN
    SELECT e.id INTO E_RIDER FROM public.employees e
    WHERE e.business_id = B1 AND e.user_id = 'a0000000-0000-4000-8000-000000000007';

    INSERT INTO public.delivery_zones (business_id, name, fee, active, created_at, updated_at) VALUES
      (B1, 'Kilimani',   100, TRUE,  d0, d0), (B1, 'Kileleshwa', 150, TRUE, d0, d0),
      (B1, 'Lavington',  200, TRUE,  d0, d0), (B1, 'South C',    250, TRUE, d0, d0),
      (B1, 'Rongai',     300, FALSE, d0, d0);

    INSERT INTO public.website_settings (business_id, delivery_enabled, delivery_fee, min_order, assistant_enabled,
        opening_hours, whatsapp, created_at, updated_at)
    VALUES (B1, TRUE, 150, 300, TRUE, E'Mon–Sat: 6:30am – 9:00pm\nSunday: 7:00am – 7:00pm', '+254 711 000 001', d0, d0);

    INSERT INTO public.website_promo_codes (business_id, code, description, kind, value, min_order, max_uses,
        once_per_customer, show_on_website, active, created_by, created_at, updated_at) VALUES
      (B1, 'KARIBU10', '10% off your first order', 'percent', 10, 0, NULL, TRUE, TRUE, TRUE, 'Dennis Kimanthi', d0, d0),
      (B1, 'MILK50', 'KSh 50 off orders over KSh 500', 'amount', 50, 500, NULL, FALSE, FALSE, TRUE, 'Mercy Achieng', d0, d0);

    -- 8 shoppers: Main's most regular customers get a login
    FOR r IN SELECT c.id, c.name, c.phone, c.created_at FROM public.customers c
             WHERE c.business_id = B1 AND c.customer_type = 'individual'
             ORDER BY (SELECT COUNT(*) FROM public.transactions t WHERE t.customer_id = c.id) DESC, c.name LIMIT 8 LOOP
        i := i + 1;
        v_id := gen_random_uuid();
        UPDATE public.customers SET email = lower(replace(r.name, ' ', '.')) || '@example.com' WHERE id = r.id;
        PERFORM pg_temp.x_shopper(v_id, lower(replace(r.name, ' ', '.')) || '@example.com', r.name, r.phone, r.created_at);
        SELECT id, name INTO v_zone FROM public.delivery_zones WHERE business_id = B1 AND active ORDER BY random() LIMIT 1;
        INSERT INTO public.customer_accounts (id, business_id, customer_id, name, phone, email, delivery_address,
            delivery_notes, delivery_zone_id, created_at, updated_at)
        VALUES (v_id, B1, r.id, r.name, r.phone, lower(replace(r.name, ' ', '.')) || '@example.com',
                (ARRAY['Hse 14, Argwings Kodhek Rd','Apt B4, Riara Rd','Ole Dume Rd, Gate 3','Lenana Rd, Silver Court 2A',
                       'Kirichwa Rd, Hse 7','Gitanga Rd, Valley View Apts 3C','Ngong Rd, Hse 22','Chania Ave, Apt 5'])[i],
                CASE WHEN random() < 0.4 THEN 'Call on arrival' END, v_zone.id, r.created_at, r.created_at);
    END LOOP;

    -- Past online orders: half the shoppers' M-Pesa sales in the last 60 days were ordered on the website
    SELECT id INTO v_promo FROM public.website_promo_codes WHERE business_id = B1 AND code = 'KARIBU10';
    SET LOCAL session_replication_role = replica;   -- no "new order" alerts for history
    FOR r IN SELECT t.id AS tx, t.timestamp AS ts, t.total, t.discount, t.final_total, a.id AS acc, a.name, a.phone,
                    a.delivery_address, z.name AS zone
             FROM public.transactions t
             JOIN public.customer_accounts a ON a.customer_id = t.customer_id
             LEFT JOIN public.delivery_zones z ON z.id = a.delivery_zone_id
             WHERE t.business_id = B1 AND t.payment_method = 'M-Pesa'
               AND t.timestamp BETWEEN now() - interval '60 days' AND now() - interval '1 day'
               AND random() < 0.5
             ORDER BY t.timestamp LOOP
        v_order := gen_random_uuid();
        v_receipt := pg_temp.x_mpesa();
        INSERT INTO public.online_orders (id, business_id, account_id, customer_name, customer_phone, status, fulfilment,
            delivery_address, delivery_zone, subtotal, delivery_fee, discount, total, mpesa_receipt, paid_at,
            created_at, updated_at, rider_id, rider_assigned_at, delivered_at, transaction_id, payment_method, payment_reference)
        VALUES (v_order, B1, r.acc, r.name, r.phone, 'completed', CASE WHEN random() < 0.6 THEN 'delivery' ELSE 'pickup' END,
                r.delivery_address, r.zone, r.total, 0, r.discount, GREATEST(1, round(r.final_total)), v_receipt, r.ts,
                r.ts - interval '1 minute', r.ts + interval '90 minutes', NULL, NULL, NULL, r.tx, 'M-Pesa', v_receipt)
        RETURNING order_number INTO v_num;
        UPDATE public.online_orders SET rider_id = E_RIDER, rider_assigned_at = r.ts + interval '20 minutes',
            delivered_at = r.ts + interval '65 minutes', notes = 'Free delivery'
        WHERE id = v_order AND fulfilment = 'delivery';
        INSERT INTO public.online_order_items (order_id, product_id, product_name, unit, unit_price, quantity, line_total)
        SELECT v_order, ti.product_id, ti.product_name, p.unit, ti.unit_price, ti.quantity, ti.line_total
        FROM public.transaction_items ti JOIN public.products p ON p.id = ti.product_id WHERE ti.transaction_id = r.tx;
        UPDATE public.transactions SET staff_id = NULL, staff_name = 'Website',
            note = 'Online order #' || v_num || ', M-Pesa ' || v_receipt
        WHERE id = r.tx;
        INSERT INTO public.mpesa_transactions (business_id, checkout_request_id, merchant_request_id, phone, amount, status,
            receipt_number, mpesa_receipt_timestamp, online_order_id, customer_id, account_reference, description,
            transaction_id, created_at, updated_at)
        SELECT B1, 'ws_CO_' || to_char(r.ts, 'DDMMYYYYHH24MISS') || substr(md5(random()::TEXT), 1, 6),
               substr(md5(random()::TEXT), 1, 5) || '-' || substr(md5(random()::TEXT), 1, 8),
               replace(r.phone, '+', ''), GREATEST(1, round(r.final_total)), 'Completed', v_receipt, r.ts, v_order,
               a.customer_id, 'Order', 'Online order', r.tx, r.ts - interval '1 minute', r.ts
        FROM public.customer_accounts a WHERE a.id = r.acc;
        -- a few reviews
        IF random() < 0.25 THEN
            v_k := pg_temp.x_ri(1, 10);
            INSERT INTO public.website_reviews (business_id, account_id, product_id, rating, title, body, display_name,
                verified, status, created_at, updated_at)
            SELECT B1, r.acc, ti.product_id, CASE WHEN v_k <= 6 THEN 5 WHEN v_k <= 9 THEN 4 ELSE 2 END,
                   CASE WHEN v_k <= 6 THEN 'Fresh every time' WHEN v_k <= 9 THEN 'Good value' ELSE 'Arrived warm' END,
                   CASE WHEN v_k <= 6 THEN 'Arrived cold and fresh. The rider was on time.'
                        WHEN v_k <= 9 THEN 'Nice and fresh. Would like bigger packs.'
                        ELSE 'The yoghurt was warm when it got here.' END,
                   split_part(r.name, ' ', 1) || ' ' || left(split_part(r.name, ' ', 2), 1) || '.', TRUE,
                   CASE WHEN r.ts > now() - interval '4 days' THEN 'pending' ELSE 'approved' END,
                   r.ts + interval '1 day', r.ts + interval '1 day'
            FROM public.transaction_items ti WHERE ti.transaction_id = r.tx LIMIT 1
            ON CONFLICT DO NOTHING;
        END IF;
    END LOOP;

    -- Two past orders that never became sales: one cancelled, one whose payment failed
    FOR r IN SELECT a.id, a.name, a.phone, s.status, s.days FROM public.customer_accounts a
             CROSS JOIN (VALUES ('cancelled', 9), ('payment_failed', 4)) s(status, days)
             ORDER BY random() LIMIT 2 LOOP
        v_ts := now() - r.days * interval '1 day';
        v_order := gen_random_uuid();
        INSERT INTO public.online_orders (id, business_id, account_id, customer_name, customer_phone, status, fulfilment,
            subtotal, delivery_fee, discount, total, created_at, updated_at, payment_method)
        SELECT v_order, B1, r.id, r.name, r.phone, r.status, 'pickup', p.price * 2, 0, 0, p.price * 2, v_ts, v_ts, 'M-Pesa'
        FROM public.products p WHERE p.business_id = B1 AND p.sku = 'KK-FM-1000';
        INSERT INTO public.online_order_items (order_id, product_id, product_name, unit, unit_price, quantity, line_total)
        SELECT v_order, p.id, p.name, p.unit, p.price, 2, p.price * 2 FROM public.products p WHERE p.business_id = B1 AND p.sku = 'KK-FM-1000';
    END LOOP;

    -- Past deliveries: some of Main's sales to known customers went out with the rider
    UPDATE public.transactions t
    SET is_delivery = TRUE, rider_name = 'Peter Mwangi', rider_id = E_RIDER, delivery_status = 'delivered',
        delivered_at = t.timestamp + (25 + random() * 50) * interval '1 minute',
        note = COALESCE(t.note || '. ', '') || 'Free delivery'
    WHERE t.business_id = B1 AND t.customer_id IS NOT NULL AND t.staff_name <> 'Website'
      AND t.timestamp < now() - interval '1 day' AND random() < 0.12;
    UPDATE public.transactions t SET is_delivery = TRUE, rider_name = 'Peter Mwangi', rider_id = E_RIDER,
        delivery_status = 'delivered', delivered_at = t.timestamp + interval '65 minutes'
    FROM public.online_orders o WHERE o.transaction_id = t.id AND o.fulfilment = 'delivery';
    SET LOCAL session_replication_role = origin;
END $website$;

-- =============================================================================
-- 4. Today: open website orders and deliveries in progress (new sales, so stock moves now)
-- =============================================================================
DO $today$
DECLARE
    B1 CONSTANT UUID := 'b1000000-0000-4000-8000-000000000001';
    E_CASH UUID; r RECORD; v_tx UUID; v_order UUID; v_num BIGINT; v_receipt TEXT; v_ts TIMESTAMPTZ; v_fee NUMERIC;
    v_prod RECORD; i INT := 0;
BEGIN
    SELECT e.id INTO E_CASH FROM public.employees e WHERE e.business_id = B1 AND e.user_id = 'a0000000-0000-4000-8000-000000000003';

    -- Deliveries booked at the till: delivered, on the road, assigned, and one open request no rider has taken
    FOR r IN SELECT * FROM (VALUES (1, 'delivered', 'Peter Mwangi', 150), (2, 'out_for_delivery', 'Peter Mwangi', 70),
                                   (3, 'assigned', 'Peter Mwangi', 35), (4, NULL, NULL, 15)) v(n, status, rider, mins) LOOP
        SELECT c.id, c.name, z.name AS zone, z.fee INTO v_prod
        FROM public.customers c CROSS JOIN LATERAL (SELECT name, fee FROM public.delivery_zones WHERE business_id = B1 AND active ORDER BY random() LIMIT 1) z
        WHERE c.business_id = B1 AND c.customer_type = 'individual' ORDER BY random() LIMIT 1;
        v_ts := now() - r.mins * interval '1 minute';
        INSERT INTO public.transactions (business_id, total, discount, tax, final_total, amount_paid, wallet_applied, payment_method,
            customer_id, customer_name, staff_id, staff_name, status, timestamp, note, is_delivery, delivery_fee, rider_name,
            delivery_status, delivered_at, reference_id, created_at, updated_at)
        SELECT B1, p.price * 3, 0, 0, p.price * 3 + v_prod.fee, p.price * 3 + v_prod.fee, 0, 'M-Pesa', v_prod.id, v_prod.name,
               E_CASH, 'Brian Otieno', 'Synced', v_ts, 'Deliver to ' || v_prod.zone, TRUE, v_prod.fee, r.rider,
               COALESCE(r.status, 'assigned'), CASE WHEN r.status = 'delivered' THEN v_ts + interval '50 minutes' END,
               'tx-' || (extract(epoch FROM v_ts) * 1000)::BIGINT || '-dl' || r.n, v_ts, v_ts
        FROM public.products p WHERE p.business_id = B1 AND p.sku = 'KK-FM-1000'
        RETURNING id INTO v_tx;
        INSERT INTO public.transaction_items (transaction_id, product_id, product_name, unit_price, quantity, discount_percentage, line_total, created_at)
        SELECT v_tx, p.id, p.name, p.price, 3, 0, p.price * 3, v_ts FROM public.products p WHERE p.business_id = B1 AND p.sku = 'KK-FM-1000';
    END LOOP;

    -- Website orders waiting for the shop: unpaid, paid, being packed, on the way
    FOR r IN SELECT a.*, z.name AS zone, z.fee, s.status, s.mins, s.n
             FROM (SELECT *, row_number() OVER (ORDER BY created_at) AS rn FROM public.customer_accounts) a
             LEFT JOIN public.delivery_zones z ON z.id = a.delivery_zone_id
             JOIN (VALUES (1, 'pending_payment', 6), (2, 'paid', 18), (3, 'preparing', 45), (4, 'out_for_delivery', 80))
                  s(n, status, mins) ON s.n = a.rn LOOP
        v_ts := now() - r.mins * interval '1 minute';
        v_fee := COALESCE(r.fee, 150);
        SELECT id, name, unit, price INTO v_prod FROM public.products WHERE business_id = B1 AND sku = 'KK-YG-STR-500';
        v_order := gen_random_uuid();
        v_receipt := CASE WHEN r.status <> 'pending_payment' THEN pg_temp.x_mpesa() END;
        INSERT INTO public.online_orders (id, business_id, account_id, customer_name, customer_phone, status, fulfilment,
            delivery_address, delivery_zone, subtotal, delivery_fee, discount, total, mpesa_receipt, paid_at, created_at, updated_at,
            rider_id, rider_assigned_at, payment_method, payment_reference)
        VALUES (v_order, B1, r.id, r.name, r.phone, r.status, 'delivery', r.delivery_address, r.zone,
                v_prod.price * 2, v_fee, 0, v_prod.price * 2 + v_fee, v_receipt,
                CASE WHEN v_receipt IS NOT NULL THEN v_ts + interval '1 minute' END, v_ts, v_ts,
                CASE WHEN r.status = 'out_for_delivery' THEN (SELECT id FROM public.employees WHERE business_id = B1 AND user_id = 'a0000000-0000-4000-8000-000000000007') END,
                CASE WHEN r.status = 'out_for_delivery' THEN v_ts + interval '30 minutes' END,
                CASE WHEN v_receipt IS NOT NULL THEN 'M-Pesa' END, v_receipt)
        RETURNING order_number INTO v_num;
        INSERT INTO public.online_order_items (order_id, product_id, product_name, unit, unit_price, quantity, line_total)
        VALUES (v_order, v_prod.id, v_prod.name, v_prod.unit, v_prod.price, 2, v_prod.price * 2);
        IF v_receipt IS NOT NULL THEN
            INSERT INTO public.transactions (business_id, total, discount, tax, final_total, amount_paid, wallet_applied, payment_method,
                customer_id, customer_name, staff_name, status, timestamp, note, is_delivery, delivery_fee, rider_name, reference_id,
                created_at, updated_at)
            VALUES (B1, v_prod.price * 2, 0, 0, v_prod.price * 2 + v_fee, v_prod.price * 2 + v_fee, 0, 'M-Pesa', r.customer_id, r.name,
                    'Website', 'Synced', v_ts + interval '1 minute', 'Online order #' || v_num || ', M-Pesa ' || v_receipt, TRUE, v_fee,
                    CASE WHEN r.status = 'out_for_delivery' THEN 'Peter Mwangi' END, 'online-' || v_order,
                    v_ts + interval '1 minute', v_ts + interval '1 minute')
            RETURNING id INTO v_tx;
            INSERT INTO public.transaction_items (transaction_id, product_id, product_name, unit_price, quantity, discount_percentage, line_total, created_at)
            VALUES (v_tx, v_prod.id, v_prod.name, v_prod.price, 2, 0, v_prod.price * 2, v_ts + interval '1 minute');
            UPDATE public.online_orders SET transaction_id = v_tx WHERE id = v_order;
            INSERT INTO public.mpesa_transactions (business_id, checkout_request_id, merchant_request_id, phone, amount, status,
                receipt_number, mpesa_receipt_timestamp, online_order_id, customer_id, account_reference, description,
                transaction_id, created_at, updated_at)
            VALUES (B1, 'ws_CO_' || to_char(v_ts, 'DDMMYYYYHH24MISS') || r.n, substr(md5(random()::TEXT), 1, 13),
                    replace(r.phone, '+', ''), v_prod.price * 2 + v_fee, 'Completed', v_receipt, v_ts + interval '1 minute',
                    v_order, r.customer_id, 'Order', 'Online order', v_tx, v_ts, v_ts + interval '1 minute');
        END IF;
    END LOOP;

    INSERT INTO public.customer_messages (business_id, account_id, sender, body, created_at)
    SELECT B1, a.id, 'customer', 'Hello, is my order on the way?', now() - interval '12 minutes'
    FROM public.customer_accounts a ORDER BY a.created_at OFFSET 3 LIMIT 1;
END $today$;

-- =============================================================================
-- 5. Shifts, expenses, petty cash, assets
-- =============================================================================
DO $people_money$
DECLARE
    B1 CONSTANT UUID := 'b1000000-0000-4000-8000-000000000001';
    B2 CONSTANT UUID := 'b2000000-0000-4000-8000-000000000002';
    B3 CONSTANT UUID := 'b3000000-0000-4000-8000-000000000003';
    today DATE := (now() AT TIME ZONE 'Africa/Nairobi')::DATE;
    d0 DATE := today - 90;
    d DATE; dow INT; b RECORD; k INT; v_cat TEXT; v_ts TIMESTAMPTZ;
BEGIN
    -- Shifts --------------------------------------------------------------------
    -- Cashiers and the manager open to close (the manager covers the till at Main); stock and rider mornings, no stock on Sundays
    CREATE TEMP TABLE x_shift (biz UUID, emp UUID, s TIMESTAMPTZ, e TIMESTAMPTZ) ON COMMIT DROP;
    FOR d IN SELECT generate_series(d0, today, interval '1 day')::DATE LOOP
        dow := extract(dow FROM d)::INT;
        INSERT INTO x_shift
        SELECT e.business_id, e.id,
               pg_temp.x_at(d, CASE r.role WHEN 'Cashier' THEN 5 WHEN 'Manager' THEN 5 WHEN 'Inventory Manager' THEN 4 ELSE 6 END,
                               pg_temp.x_ri(30, 55)),
               pg_temp.x_at(d, CASE r.role WHEN 'Cashier' THEN 21 WHEN 'Manager' THEN 21 WHEN 'Inventory Manager' THEN 13 ELSE 15 END,
                               pg_temp.x_ri(0, 25))
        FROM public.employees e
        JOIN public.business_memberships r ON r.business_id = e.business_id AND r.user_id = e.user_id
        WHERE r.role <> 'Owner' AND NOT (dow = 0 AND r.role = 'Inventory Manager');
    END LOOP;
    INSERT INTO public.shifts (business_id, employee_id, start_time, end_time, sales_count, sales_total, status, created_at, updated_at, last_modified_by)
    SELECT s.biz, s.emp, s.s, CASE WHEN s.e > now() THEN NULL ELSE s.e END,
           COALESCE(t.cnt, 0), COALESCE(t.total, 0),
           CASE WHEN s.e > now() THEN 'Active' ELSE 'Closed' END::public.shift_status, s.s, LEAST(s.e, now()), e.name
    FROM x_shift s JOIN public.employees e ON e.id = s.emp
    LEFT JOIN LATERAL (SELECT COUNT(*) AS cnt, SUM(final_total) AS total FROM public.transactions tx
                       WHERE tx.staff_id = s.emp AND tx.timestamp BETWEEN s.s AND s.e) t ON TRUE
    WHERE s.s < now();
    UPDATE public.employees e SET active_shift_id = sh.id FROM public.shifts sh WHERE sh.employee_id = e.id AND sh.status = 'Active';

    -- Opening balances: money each branch had when it opened (the first wages fall
    -- before enough sales money has come in)
    FOR b IN SELECT * FROM (VALUES (B1, 'M-Pesa', 60000), (B1, 'Cash', 20000), (B2, 'M-Pesa', 15000), (B2, 'Cash', 10000),
                                   (B3, 'M-Pesa', 15000), (B3, 'Cash', 10000)) v(id, method, amount) LOOP
        PERFORM public.fn_post_money_asset(b.id, b.method, b.amount, 'Opening balance', NULL, NULL, 'Dennis Kimanthi');
    END LOOP;
    SET LOCAL session_replication_role = replica;
    UPDATE public.payment_asset_ledger l SET created_at = bz.created_at
    FROM public.businesses bz WHERE l.business_id = bz.id AND l.description = 'Opening balance';
    SET LOCAL session_replication_role = origin;

    -- Expenses and petty cash ---------------------------------------------------
    CREATE TEMP TABLE x_exp (biz UUID, category TEXT, amount NUMERIC, descr TEXT, method TEXT, ts TIMESTAMPTZ, staff TEXT, petty BOOLEAN) ON COMMIT DROP;
    FOR d IN SELECT generate_series(d0, today, interval '1 day')::DATE LOOP
        dow := extract(dow FROM d)::INT;
        -- sized to what each branch takes in; rent and wages go out by M-Pesa (paybill), where most sales money lands
        FOR b IN SELECT * FROM (VALUES (B1, 25000, 60, 90, 'Brian Otieno', 1), (B2, 12000, 25, 40, 'Lucy Wambui', 2),
                                       (B3, 10000, 25, 40, 'Faith Njeri', 3))
                 v(id, rent, power_lo, power_hi, cashier, n) LOOP
            IF extract(day FROM d) = 1 THEN
                INSERT INTO x_exp VALUES (b.id, 'Rent', b.rent, 'Shop rent – ' || to_char(d, 'FMMonth YYYY'), 'M-Pesa', pg_temp.x_at(d, 9, 15), 'Dennis Kimanthi', FALSE);
            END IF;
            IF extract(day FROM d) = 28 THEN
                INSERT INTO x_exp VALUES (b.id, 'Wages', 12000, to_char(d, 'FMMonth') || ' wages – ' || b.cashier, 'M-Pesa', pg_temp.x_at(d, 17, 0), 'Dennis Kimanthi', FALSE);
                IF b.n = 1 THEN
                    INSERT INTO x_exp VALUES
                        (B1, 'Wages', 15000, to_char(d, 'FMMonth') || ' wages – Mercy Achieng', 'Cash', pg_temp.x_at(d, 17, 2), 'Dennis Kimanthi', FALSE),
                        (B1, 'Wages', 10000, to_char(d, 'FMMonth') || ' wages – Joseph Kiprono', 'Cash', pg_temp.x_at(d, 17, 4), 'Dennis Kimanthi', FALSE),
                        (B1, 'Wages', 8000, to_char(d, 'FMMonth') || ' wages – Peter Mwangi', 'M-Pesa', pg_temp.x_at(d, 17, 6), 'Dennis Kimanthi', FALSE);
                END IF;
            END IF;
            IF extract(day FROM d) = 10 THEN
                INSERT INTO x_exp VALUES (b.id, 'Utilities', pg_temp.x_ri(b.power_lo, b.power_hi) * 100, 'KPLC electricity tokens', 'M-Pesa', pg_temp.x_at(d, 10, 20), b.cashier, FALSE);
            END IF;
            IF b.n = 1 AND dow = 3 THEN
                INSERT INTO x_exp VALUES (B1, 'Transport', pg_temp.x_ri(8, 14) * 100, 'Fuel – delivery motorbike', 'Cash', pg_temp.x_at(d, 7, 30), 'Peter Mwangi', FALSE);
            END IF;
            IF b.n = 1 AND extract(day FROM d) = 15 THEN
                INSERT INTO x_exp VALUES (B1, 'Marketing', pg_temp.x_ri(10, 30) * 100, 'Facebook & Instagram ads', 'Card', pg_temp.x_at(d, 20, 0), 'Dennis Kimanthi', FALSE);
            END IF;
            -- petty cash, a few times a week
            FOR k IN 1..(CASE WHEN random() < 0.45 THEN 1 ELSE 0 END) LOOP
                v_cat := pg_temp.x_pick(ARRAY['Transport','Cleaning','Food & tea','Food & tea','Repairs','Supplies','Airtime','Other']);
                INSERT INTO x_exp VALUES (b.id, v_cat,
                    CASE v_cat WHEN 'Repairs' THEN pg_temp.x_ri(3, 15) * 100 WHEN 'Food & tea' THEN pg_temp.x_ri(10, 35) * 10 ELSE pg_temp.x_ri(10, 60) * 10 END,
                    CASE v_cat
                        WHEN 'Transport' THEN pg_temp.x_pick(ARRAY['Boda to the bank','Matatu fare to buy packets'])
                        WHEN 'Cleaning' THEN pg_temp.x_pick(ARRAY['Detergent and jik','Hand soap'])
                        WHEN 'Food & tea' THEN pg_temp.x_pick(ARRAY['Tea and mandazi for staff','Sugar for staff tea'])
                        WHEN 'Repairs' THEN pg_temp.x_pick(ARRAY['Fixed door hinge','Bulb for the store'])
                        WHEN 'Supplies' THEN pg_temp.x_pick(ARRAY['Receipt paper rolls','Price stickers'])
                        WHEN 'Airtime' THEN 'Airtime for customer calls'
                        ELSE pg_temp.x_pick(ARRAY['Water for the shop','Photocopies']) END,
                    'Cash', pg_temp.x_at(d, pg_temp.x_ri(9, 17), pg_temp.x_ri(0, 59)), b.cashier, TRUE);
            END LOOP;
        END LOOP;
    END LOOP;

    INSERT INTO public.expenses (business_id, category_id, category, amount, description, date, staff_name, receipt_ref,
        payment_method, source, employee_id, reference_id, created_at, updated_at, last_modified_by)
    SELECT x.biz, ec.id, x.category, x.amount, x.descr, x.ts, x.staff,
           CASE WHEN x.petty AND random() < 0.4 THEN 'RCT-' || pg_temp.x_ri(1000, 9999) END,
           x.method, CASE WHEN x.petty THEN 'petty_cash' ELSE 'expense' END,
           (SELECT e.id FROM public.employees e WHERE e.business_id = x.biz AND e.name = x.staff LIMIT 1),
           CASE WHEN x.petty THEN 'petty-' || substr(md5(random()::TEXT), 1, 12) END,
           x.ts, x.ts, x.staff
    FROM x_exp x
    LEFT JOIN public.expense_categories ec ON ec.business_id = x.biz AND ec.name = x.category AND NOT x.petty
    WHERE x.ts <= now()
    ORDER BY x.ts;

    -- Assets --------------------------------------------------------------------
    INSERT INTO public.business_assets (business_id, name, code, serial_number, value, status, created_at, updated_at) VALUES
      (B1, 'Milk ATM dispenser 500L', 'AST-001', 'MATM-500-22871', 380000, 'Active', d0, d0),
      (B1, 'Display fridge (double door)', 'AST-002', 'DF-2D-99310', 85000, 'Active', d0, d0),
      (B1, 'Delivery motorbike (KMFX 221B)', 'AST-003', 'ME4KC2190P8765432', 135000, 'Active', d0, d0),
      (B1, 'Generator 5kVA', 'AST-004', 'GEN5-77120', 70000, 'Under Repair', d0, now() - interval '6 days'),
      (B1, 'Old cooler box', 'AST-005', NULL, 0, 'Disposed', d0, now() - interval '40 days'),
      (B2, 'Display fridge (single door)', 'AST-101', 'DF-1D-55102', 55000, 'Active', d0, d0),
      (B3, 'Display fridge (single door)', 'AST-201', 'DF-1D-55877', 55000, 'Active', d0, d0),
      (B3, 'Chest freezer 300L', 'AST-202', 'CF300-11820', 65000, 'Active', d0, d0);
END $people_money$;

-- =============================================================================
-- 6. Money ledger: right times for expense rows, then running balances in date order
-- =============================================================================
DO $ledger$
BEGIN
    SET LOCAL session_replication_role = replica;
    UPDATE public.payment_asset_ledger l SET created_at = e.date FROM public.expenses e WHERE l.expense_id = e.id;
    UPDATE public.payment_asset_ledger l SET created_at = t.timestamp
    FROM public.transactions t WHERE l.transaction_id = t.id AND l.created_at <> t.timestamp;
    UPDATE public.payment_asset_ledger l
    SET balance_after = x.run, balance_before = x.run - l.amount
    FROM (SELECT id, SUM(amount) OVER (PARTITION BY asset_id ORDER BY created_at, id) AS run
          FROM public.payment_asset_ledger) x
    WHERE x.id = l.id;
    -- the stored balance stays the sum of its ledger
    UPDATE public.money_assets m SET balance = s.total
    FROM (SELECT asset_id, SUM(amount) AS total FROM public.payment_asset_ledger GROUP BY asset_id) s
    WHERE s.asset_id = m.id AND m.balance <> s.total;
    SET LOCAL session_replication_role = origin;
END $ledger$;

ANALYZE public.transactions, public.expenses, public.shifts, public.purchases, public.online_orders, public.payment_asset_ledger;
