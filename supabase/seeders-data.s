-- =============================================================================
-- seed.sql: small, useful test data for a LOCAL database
--
-- Loaded automatically by `supabase db reset` (see [db.seed] in config.toml),
-- or by hand: psql "$LOCAL_DB_URL" -f supabase/seed.sql
--
-- It refuses to run when the database already has a business, so it can never
-- mix test data into the live database.
--
-- What it creates (dates are relative to the day it runs):
--   * 3 branches: Main (Ngong Road), Westlands, Thika Road
--   * staff logins (see supabase/SEED_LOGINS.md for emails and passwords)
--   * 6 product categories, 15 products in every branch
--   * about 40 customers, a few of them businesses buying on account
--   * 90 days of sales: Cash, M-Pesa, Card, Bank and credit, plus debt repayments
--   * stock: Main gets supplier deliveries; Westlands and Thika Road get fresh
--     milk and bread delivered and everything else by stock transfer from Main
--     on Mondays and Thursdays (plus one cancelled and one still on the way)
--
-- Sales, credit and debt payments go through the same database functions the
-- app calls (process_customer_transaction, process_debt_payment) and the same
-- triggers, so stock, money balances, debts and points agree. Rows those
-- functions stamp with now() are moved back to when they happened.
--
-- It runs as one transaction (the Supabase CLI sends the file as one batch), so a failure
-- leaves nothing behind.
-- =============================================================================

SET client_min_messages = error;   -- triggers warn that push secrets are unset; that is expected locally
SET check_function_bodies = off;    -- helpers refer to work tables created just below them

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM public.businesses) THEN
        RAISE EXCEPTION 'seed.sql only fills an empty database, and this one already has businesses. Run it on a local database with supabase db reset, never on the live one.';
    END IF;
END $$;

SELECT setseed(0.2611);

-- -----------------------------------------------------------------------------
-- Helpers (pg_temp: they vanish when the session ends)
-- -----------------------------------------------------------------------------

CREATE FUNCTION pg_temp.ri(a INT, b INT) RETURNS INT LANGUAGE sql VOLATILE
AS $$ SELECT a + floor(random() * (b - a + 1))::INT $$;

-- Local Nairobi time on a day -> timestamptz, with random seconds
CREATE FUNCTION pg_temp.at(d DATE, h INT, m INT) RETURNS TIMESTAMPTZ LANGUAGE sql VOLATILE
AS $$ SELECT ((d + make_time(h, m, floor(random() * 60)::INT)) AT TIME ZONE 'Africa/Nairobi') $$;

-- Auth user + identity; handle_new_user creates the public.users row.
CREATE FUNCTION pg_temp.mk_user(p_id UUID, p_email TEXT, p_password TEXT, p_name TEXT, p_phone TEXT, p_created TIMESTAMPTZ)
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
        extensions.crypt(p_password, extensions.gen_salt('bf')), p_created,
        '{"provider":"email","providers":["email"]}',
        jsonb_build_object('name', p_name, 'phone', p_phone),
        p_created, p_created, now() - interval '1 day',
        '', '', '', '', '', '', '', '', FALSE, FALSE
    );
    INSERT INTO auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
    VALUES (gen_random_uuid(), p_id, p_id::TEXT,
            jsonb_build_object('sub', p_id::TEXT, 'email', p_email, 'email_verified', TRUE),
            'email', now() - interval '1 day', p_created, p_created);
    -- is_verified = TRUE also sets verified_email (fn_users_protect_verified)
    UPDATE public.users SET is_verified = TRUE, phone_verified = TRUE, created_at = p_created, updated_at = p_created
    WHERE id = p_id;
    RETURN p_id;
END $f$;

-- Rows the app's functions and triggers stamp with now() -> the moment the event happened.
-- Sale-linked rows (they carry a transaction_id) are fixed by stamp_sales instead.
CREATE FUNCTION pg_temp.stamp(p_ts TIMESTAMPTZ) RETURNS VOID LANGUAGE plpgsql AS $f$
DECLARE
    t0 TIMESTAMPTZ := now();
BEGIN
    SET LOCAL session_replication_role = replica;
    UPDATE public.customer_ledger       SET created_at = p_ts WHERE created_at = t0 AND transaction_id IS NULL;
    UPDATE public.debt_payments         SET created_at = p_ts WHERE created_at = t0;
    UPDATE public.loyalty_points_earned SET created_at = p_ts WHERE created_at = t0 AND transaction_id IS NULL;
    UPDATE public.wallet_transactions   SET created_at = p_ts WHERE created_at = t0 AND transaction_id IS NULL;
    UPDATE public.payments              SET created_at = p_ts WHERE created_at = t0;
    UPDATE public.payment_asset_ledger  SET created_at = p_ts WHERE created_at = t0 AND transaction_id IS NULL;
    UPDATE public.credit_payments       SET settled_at = p_ts WHERE settled_at = t0;
    UPDATE public.credit_payments       SET updated_at = p_ts WHERE updated_at = t0 AND created_at <> t0;
    UPDATE public.notifications         SET created_at = p_ts, updated_at = p_ts, sent_at = p_ts, delivered_at = p_ts
                                        WHERE created_at = t0;
    SET LOCAL session_replication_role = origin;
END $f$;

-- Sale-linked rows created on this day -> the sale's time. Run at the end of each day.
CREATE FUNCTION pg_temp.stamp_sales(p_day DATE) RETURNS VOID LANGUAGE plpgsql AS $f$
DECLARE
    t0 TIMESTAMPTZ := now();
BEGIN
    SET LOCAL session_replication_role = replica;
    CREATE TEMP TABLE IF NOT EXISTS seed_new_tx (id UUID, business_id UUID, ts TIMESTAMPTZ, rn TEXT);
    TRUNCATE seed_new_tx;
    INSERT INTO seed_new_tx
    SELECT t.id, t.business_id, t.timestamp, public.fn_receipt_number(t.id)
    FROM public.transactions t
    WHERE t.timestamp >= (p_day::TIMESTAMP AT TIME ZONE 'Africa/Nairobi') - interval '1 hour'
      AND t.timestamp <  ((p_day + 1)::TIMESTAMP AT TIME ZONE 'Africa/Nairobi') + interval '1 hour';

    UPDATE public.transactions t SET created_at = n.ts, updated_at = n.ts
    FROM seed_new_tx n WHERE t.id = n.id AND t.created_at = t0;
    UPDATE public.transaction_items ti SET created_at = n.ts
    FROM seed_new_tx n WHERE ti.transaction_id = n.id AND ti.created_at = t0;
    UPDATE public.inventory_adjustments ia SET timestamp = n.ts, created_at = n.ts, updated_at = n.ts
    FROM seed_new_tx n
    WHERE ia.reference_number = n.rn AND ia.business_id = n.business_id AND ia.reason = 'Sold' AND ia.created_at = t0;
    UPDATE public.payment_asset_ledger x SET created_at = n.ts
    FROM seed_new_tx n WHERE x.transaction_id = n.id AND x.created_at = t0;
    UPDATE public.loyalty_points_earned x SET created_at = n.ts
    FROM seed_new_tx n WHERE x.transaction_id = n.id AND x.created_at = t0;
    UPDATE public.customer_ledger x SET created_at = n.ts
    FROM seed_new_tx n WHERE x.transaction_id = n.id AND x.created_at = t0;
    UPDATE public.wallet_transactions x SET created_at = n.ts
    FROM seed_new_tx n WHERE x.transaction_id = n.id AND x.created_at = t0;
    SET LOCAL session_replication_role = origin;
END $f$;

-- Stock movement with an explicit time (restock, transfers).
CREATE FUNCTION pg_temp.adjust(p_prod UUID, p_type public.inventory_adjustment_type, p_delta NUMERIC, p_reason TEXT,
                               p_staff TEXT, p_ts TIMESTAMPTZ, p_ref TEXT DEFAULT NULL)
RETURNS NUMERIC LANGUAGE plpgsql AS $f$
DECLARE
    v_old NUMERIC; v_new NUMERIC; v_name TEXT; v_biz UUID;
BEGIN
    SELECT stock, name, business_id INTO v_old, v_name, v_biz FROM public.products WHERE id = p_prod FOR UPDATE;
    v_new := GREATEST(0, v_old + p_delta);
    IF v_new = v_old THEN
        RETURN 0;
    END IF;
    UPDATE public.products SET stock = v_new WHERE id = p_prod;
    INSERT INTO public.inventory_adjustments (business_id, product_id, product_name, type, quantity_adjusted,
        previous_stock, new_stock, timestamp, reason, staff_name, reference_number, created_at, updated_at, last_modified_by)
    VALUES (v_biz, p_prod, v_name, p_type, v_new - v_old, v_old, v_new, p_ts, p_reason, p_staff, p_ref,
            p_ts, p_ts, p_staff);
    RETURN v_new - v_old;
END $f$;

-- One sale, recorded the way the till records it:
--   credit sale with a customer -> process_customer_transaction (wallet first, then debt)
--   anything else               -> transactions + transaction_items insert (amount_paid = total)
-- p_lines: [{"p": product_id, "q": quantity, "d": line discount %}]
CREATE FUNCTION pg_temp.sale(p_biz UUID, p_ts TIMESTAMPTZ, p_staff UUID, p_staff_name TEXT,
                             p_cust UUID, p_cust_name TEXT, p_method TEXT, p_lines JSONB)
RETURNS UUID LANGUAGE plpgsql AS $f$
DECLARE
    v_items JSONB; v_total NUMERIC; v_disc NUMERIC; v_final NUMERIC; v_id UUID; v_ref TEXT;
BEGIN
    SELECT jsonb_agg(jsonb_build_object(
               'product_id', pr.id, 'product_name', pr.name, 'unit_price', pr.price,
               'quantity', (l->>'q')::NUMERIC, 'discount_percentage', COALESCE((l->>'d')::NUMERIC, 0))),
           SUM(pr.price * (l->>'q')::NUMERIC),
           SUM(round(pr.price * (l->>'q')::NUMERIC * COALESCE((l->>'d')::NUMERIC, 0) / 100, 2))
    INTO v_items, v_total, v_disc
    FROM jsonb_array_elements(p_lines) l
    JOIN public.products pr ON pr.id = (l->>'p')::UUID
    WHERE (l->>'q')::NUMERIC > 0;

    IF v_items IS NULL THEN
        RETURN NULL;
    END IF;

    v_final := v_total - v_disc;
    v_ref   := 'tx-' || (extract(epoch FROM p_ts) * 1000)::BIGINT || '-' || substr(md5(random()::TEXT), 1, 6);

    IF p_cust IS NOT NULL AND p_method = 'Credit_Debt' THEN
        v_id := public.process_customer_transaction(
            p_biz, p_cust, p_cust_name, p_staff, p_staff_name, v_total, v_disc, 0, v_final, 0,
            'Credit_Debt', p_ts, NULL, FALSE, 0, NULL, v_ref, v_items);
        SET LOCAL session_replication_role = replica;
        UPDATE public.credit_payments SET created_at = p_ts, updated_at = p_ts WHERE transaction_id = v_id;
        SET LOCAL session_replication_role = origin;
    ELSE
        INSERT INTO public.transactions (business_id, total, discount, tax, final_total, amount_paid, wallet_applied,
            payment_method, customer_id, customer_name, staff_id, staff_name, status, timestamp, is_delivery,
            delivery_fee, reference_id, created_at, updated_at)
        VALUES (p_biz, v_total, v_disc, 0, v_final, v_final, 0, p_method::public.payment_method, p_cust, p_cust_name,
            p_staff, p_staff_name, 'Synced', p_ts, FALSE, 0, v_ref, p_ts, p_ts)
        RETURNING id INTO v_id;

        INSERT INTO public.transaction_items (transaction_id, product_id, product_name, unit_price, quantity,
            discount_percentage, line_total, created_at)
        SELECT v_id, (i->>'product_id')::UUID, i->>'product_name', (i->>'unit_price')::NUMERIC,
               (i->>'quantity')::NUMERIC, (i->>'discount_percentage')::NUMERIC,
               round((i->>'unit_price')::NUMERIC * (1 - (i->>'discount_percentage')::NUMERIC / 100)
                     * (i->>'quantity')::NUMERIC, 2),
               p_ts
        FROM jsonb_array_elements(v_items) i;
    END IF;
    RETURN v_id;
END $f$;

-- Random basket from a branch's shelf: weighted by popularity, never more than in stock.
CREATE FUNCTION pg_temp.basket(p_biz UUID, p_lines INT) RETURNS JSONB
LANGUAGE sql VOLATILE AS $f$
    SELECT jsonb_agg(jsonb_build_object('p', id, 'q', q, 'd', d))
    FROM (
        SELECT p.id,
               LEAST(floor(p.stock), c.qlo + floor(power(random(), 2.2) * (c.qhi - c.qlo + 1)))::NUMERIC AS q,
               CASE WHEN random() < 0.03 THEN 10 ELSE 0 END AS d
        FROM public.products p
        JOIN seed_catalog c ON c.sku = p.sku
        WHERE p.business_id = p_biz AND p.stock >= 1 AND p.deleted_at IS NULL
        ORDER BY -ln(1 - random()) / c.weight
        LIMIT p_lines
    ) x
$f$;

-- -----------------------------------------------------------------------------
-- Working tables
-- -----------------------------------------------------------------------------

-- kind: fresh = delivered to every branch each morning; stock = delivered to Main,
--       sent to the other branches by transfer
CREATE TEMP TABLE seed_catalog (sku TEXT PRIMARY KEY, name TEXT, category TEXT, price NUMERIC, cost NUMERIC,
    unit TEXT, perishable BOOLEAN, expiry INT, kind TEXT, weight NUMERIC, qlo INT, qhi INT, target NUMERIC,
    supplier TEXT, descr TEXT);
-- Inside DO so the Supabase CLI, which prepares the whole file before running it, doesn't
-- look for seed_catalog before the line above has created it.
DO $catalog$ BEGIN
INSERT INTO seed_catalog VALUES
  ('KK-FM-1000',   'Fresh Milk 1L',            'Fresh Milk',    65,  42,  'Litres',  TRUE,  3,    'fresh', 30, 1, 4, 40, 'Kiambu Dairy Farmers Co-op', 'Pasteurised whole milk, packed the morning it is collected.'),
  ('KK-FM-500',    'Fresh Milk 500ml',         'Fresh Milk',    35,  23,  'Packets', TRUE,  3,    'fresh', 18, 1, 4, 30, 'Kiambu Dairy Farmers Co-op', 'Pasteurised whole milk, half litre.'),
  ('KK-UHT-500',   'Long Life Milk 500ml',     'Fresh Milk',    65,  47,  'Packets', FALSE, NULL, 'stock',  4, 1, 6, 40, 'Limuru Fresh Farms',         'UHT milk, keeps 6 months unopened.'),
  ('KK-ML-500',    'Mala 500ml',               'Fermented Milk',60,  34,  'Packets', TRUE,  7,    'stock', 12, 1, 3, 25, 'Kiambu Dairy Farmers Co-op', 'Traditional fermented milk.'),
  ('KK-ML-1000',   'Mala 1L',                  'Fermented Milk',110, 62,  'Packets', TRUE,  7,    'stock',  6, 1, 2, 12, 'Kiambu Dairy Farmers Co-op', 'Traditional fermented milk, family size.'),
  ('KK-YG-STR-500','Strawberry Yoghurt 500ml', 'Yoghurt',       130, 68,  'Pieces',  TRUE,  10,   'stock',  9, 1, 3, 18, 'Kiambu Dairy Farmers Co-op', 'Made with real strawberry.'),
  ('KK-YG-VAN-500','Vanilla Yoghurt 500ml',    'Yoghurt',       130, 68,  'Pieces',  TRUE,  10,   'stock',  7, 1, 3, 15, 'Kiambu Dairy Farmers Co-op', 'Lightly sweet, vanilla.'),
  ('KK-YG-MNG-250','Mango Yoghurt 250ml',      'Yoghurt',       70,  37,  'Pieces',  TRUE,  10,   'stock',  6, 1, 4, 15, 'Kiambu Dairy Farmers Co-op', 'Kids'' favourite.'),
  ('KK-BTR-250',   'Salted Butter 250g',       'Butter & Cheese',320,225, 'Pieces',  TRUE,  60,   'stock',  3, 1, 2, 10, 'Limuru Fresh Farms',         'Farm butter.'),
  ('KK-GHE-500',   'Pure Ghee 500g',           'Butter & Cheese',650,455, 'Jars',    FALSE, NULL, 'stock',  1.5, 1, 1, 6, 'Limuru Fresh Farms',        'Clarified butter.'),
  ('KK-MOZ-200',   'Mozzarella 200g',          'Butter & Cheese',450,300, 'Pieces',  TRUE,  30,   'stock',  1.2, 1, 2, 6, 'Limuru Fresh Farms',        'Fresh mozzarella.'),
  ('KK-BRD-WHT',   'White Bread 400g',         'Bakery & Eggs', 65,  52,  'Loaves',  TRUE,  4,    'fresh',  8, 1, 2, 15, 'Nairobi Bakers Ltd',         NULL),
  ('KK-BRD-BRN',   'Brown Bread 400g',         'Bakery & Eggs', 70,  56,  'Loaves',  TRUE,  4,    'fresh',  4, 1, 2, 8,  'Nairobi Bakers Ltd',         NULL),
  ('KK-EGG-TRAY',  'Eggs (Tray of 30)',        'Bakery & Eggs', 450, 365, 'Trays',   TRUE,  21,   'stock',  2.5, 1, 1, 8, 'Ruiru Poultry Farm',        'Free-range kienyeji-cross eggs.'),
  ('KK-HNY-500',   'Pure Honey 500g',          'Pantry',        550, 390, 'Jars',    FALSE, NULL, 'stock',  0.8, 1, 1, 6, 'Sweet Valley Honey',        'Raw honey from Baringo.');
END $catalog$;

-- branch number -> business id, staff
CREATE TEMP TABLE seed_branch (n INT PRIMARY KEY, id UUID, name TEXT, scale NUMERIC, cashier UUID, cashier_name TEXT);
CREATE TEMP TABLE seed_cust (id UUID PRIMARY KEY, biz UUID, name TEXT, kind TEXT, weight NUMERIC);

-- =============================================================================
-- 1. People, branches, categories, products, customers
-- =============================================================================
DO $seed$
DECLARE
    B1 CONSTANT UUID := 'b1000000-0000-4000-8000-000000000001';   -- Main (Ngong Road)
    B2 CONSTANT UUID := 'b2000000-0000-4000-8000-000000000002';   -- Westlands
    B3 CONSTANT UUID := 'b3000000-0000-4000-8000-000000000003';   -- Thika Road
    U_OWNER CONSTANT UUID := 'a0000000-0000-4000-8000-000000000001';
    U_MGR   CONSTANT UUID := 'a0000000-0000-4000-8000-000000000002';
    U_CASH1 CONSTANT UUID := 'a0000000-0000-4000-8000-000000000003';
    U_CASH2 CONSTANT UUID := 'a0000000-0000-4000-8000-000000000004';
    U_CASH3 CONSTANT UUID := 'a0000000-0000-4000-8000-000000000005';
    U_STOCK CONSTANT UUID := 'a0000000-0000-4000-8000-000000000006';
    U_RIDER CONSTANT UUID := 'a0000000-0000-4000-8000-000000000007';
    d0 DATE := (now() AT TIME ZONE 'Africa/Nairobi')::DATE - 90;
    t_open TIMESTAMPTZ;
    v_firsts TEXT[] := ARRAY['Wanjiku','Achieng','Kamau','Otieno','Njeri','Mwangi','Atieno','Kiprop','Chebet','Wafula',
        'Nyambura','Omondi','Wairimu','Kibet','Akinyi','Mutua','Muthoni','Ochieng','Grace','Brian','Faith','Kevin','Mercy','Lucy'];
    v_lasts TEXT[] := ARRAY['Kamau','Otieno','Wanjiru','Mwangi','Odhiambo','Kiprono','Njoroge','Mutua','Wafula','Chebet',
        'Omondi','Karanja','Kariuki','Ndungu','Ouma','Kimani','Wekesa','Rotich'];
    v_name TEXT; i INT := 0; v_biz UUID;
BEGIN
    t_open := pg_temp.at(d0 - 7, 9, 0);

    -- Logins (owner password differs; the rest share Test1234!) --------------
    PERFORM pg_temp.mk_user(U_OWNER, 'kimanthidennis02@gmail.com', 'Admin@123', 'Dennis Kimanthi', '+254711000001', t_open);
    PERFORM pg_temp.mk_user(U_MGR,   'manager@kaykays.test',   'Test1234!', 'Mercy Achieng',  '+254711000002', t_open);
    PERFORM pg_temp.mk_user(U_CASH1, 'cashier@kaykays.test',   'Test1234!', 'Brian Otieno',   '+254711000003', t_open);
    PERFORM pg_temp.mk_user(U_CASH2, 'westlands@kaykays.test', 'Test1234!', 'Lucy Wambui',    '+254711000004', t_open);
    PERFORM pg_temp.mk_user(U_CASH3, 'thika@kaykays.test',     'Test1234!', 'Faith Njeri',    '+254711000005', t_open);
    PERFORM pg_temp.mk_user(U_STOCK, 'stock@kaykays.test',     'Test1234!', 'Joseph Kiprono', '+254711000006', t_open);
    PERFORM pg_temp.mk_user(U_RIDER, 'rider@kaykays.test',     'Test1234!', 'Peter Mwangi',   '+254711000007', t_open);

    -- Branches (each branch is a business sharing the owner) -------------------
    INSERT INTO public.businesses (id, name, business_type, description, address, contact_email, contact_phone,
        primary_color, secondary_color, is_tax_enabled, tax_percentage, website_slug, created_at, updated_at,
        default_payment_methods)
    VALUES
      (B1, 'KayKay''s Milk', 'Dairy', 'Fresh farm milk, mala, yoghurt and dairy in Nairobi.',
       'Ngong Road, opposite Adams Arcade, Nairobi', 'hello@kaykays.test', '+254711000001', '#f59e0b', '#1f2937',
       FALSE, 16, 'kaykays', t_open, t_open, ARRAY['Cash','M-Pesa','Card','Bank']),
      (B2, 'KayKay''s Milk Westlands', 'Dairy', 'Westlands branch.',
       'Woodvale Grove, Westlands, Nairobi', 'westlands@kaykays.test', '+254711000004', '#f59e0b', '#1f2937',
       FALSE, 16, NULL, t_open, t_open, ARRAY['Cash','M-Pesa','Card','Bank']),
      (B3, 'KayKay''s Milk Thika Road', 'Dairy', 'Thika Road branch.',
       'Roysambu, next to TRM, Nairobi', 'thika@kaykays.test', '+254711000005', '#f59e0b', '#1f2937',
       FALSE, 16, NULL, t_open, t_open, ARRAY['Cash','M-Pesa','Card','Bank']);

    INSERT INTO public.branches (business_id, name, address, created_at, updated_at) VALUES
      (B1, 'Main branch', 'Ngong Road, opposite Adams Arcade, Nairobi', t_open, t_open),
      (B2, 'Main branch', 'Woodvale Grove, Westlands, Nairobi', t_open, t_open),
      (B3, 'Main branch', 'Roysambu, next to TRM, Nairobi', t_open, t_open);

    -- Memberships create the employee rows (fn_membership_sync_employee)
    INSERT INTO public.business_memberships (business_id, user_id, role, status, joined_at, created_at, updated_at) VALUES
      (B1, U_OWNER, 'Owner',             'Active', t_open, t_open, t_open),
      (B2, U_OWNER, 'Owner',             'Active', t_open, t_open, t_open),
      (B3, U_OWNER, 'Owner',             'Active', t_open, t_open, t_open),
      (B1, U_MGR,   'Manager',           'Active', t_open, t_open, t_open),
      (B1, U_CASH1, 'Cashier',           'Active', t_open, t_open, t_open),
      (B2, U_CASH2, 'Cashier',           'Active', t_open, t_open, t_open),
      (B3, U_CASH3, 'Cashier',           'Active', t_open, t_open, t_open),
      (B1, U_STOCK, 'Inventory Manager', 'Active', t_open, t_open, t_open),
      (B1, U_RIDER, 'Rider',             'Active', t_open, t_open, t_open);

    UPDATE public.employees SET created_at = t_open, updated_at = t_open, last_seen_at = now() - (random() * interval '20 hours');

    INSERT INTO seed_branch
    SELECT b.n, b.id, b.name, b.scale, e.id, e.name
    FROM (VALUES (1, B1, 'KayKay''s Milk', 1.0, U_CASH1), (2, B2, 'KayKay''s Milk Westlands', 0.6, U_CASH2),
                 (3, B3, 'KayKay''s Milk Thika Road', 0.5, U_CASH3)) b(n, id, name, scale, u)
    JOIN public.employees e ON e.business_id = b.id AND e.user_id = b.u;

    -- Settings ----------------------------------------------------------------
    INSERT INTO public.receipt_settings (business_id, business_name, address, phone, email, pin_number,
        header_message, footer_message, thank_you_message, is_tax_enabled, tax_percentage)
    SELECT id, name, (SELECT address FROM public.businesses WHERE businesses.id = sb.id), '+254 711 000 001',
           'hello@kaykays.test', 'P051234567X', 'Fresh from the farm, every morning',
           'Keep milk below 4°C.', 'Asante sana! Karibu tena.', FALSE, 16
    FROM seed_branch sb;
    INSERT INTO public.printer_settings (business_id) SELECT id FROM seed_branch;
    UPDATE public.loyalty_settings SET min_redeem_points = 1000, points_enabled = TRUE
    WHERE business_id IN (SELECT id FROM seed_branch);

    -- Categories and products: the same range in every branch ------------------
    INSERT INTO public.product_categories (business_id, name, created_by, created_at, updated_at)
    SELECT sb.id, c.category, 'Dennis Kimanthi', t_open, t_open
    FROM seed_branch sb CROSS JOIN (SELECT DISTINCT category FROM seed_catalog) c
    ON CONFLICT DO NOTHING;

    INSERT INTO public.products (business_id, name, category, price, cost, stock, min_stock, unit, sku, description,
        perishable, expiry_days, show_on_website, created_at, updated_at, last_modified_by)
    SELECT sb.id, c.name, c.category, c.price, c.cost, ceil(c.target * sb.scale), GREATEST(1, ceil(c.target * sb.scale * 0.2)),
           c.unit, c.sku, c.descr, c.perishable, c.expiry, sb.n = 1, t_open, t_open, 'Dennis Kimanthi'
    FROM seed_branch sb CROSS JOIN seed_catalog c;

    -- Customers ---------------------------------------------------------------
    -- Businesses buying on account (credit), paying back every week or so
    INSERT INTO seed_cust (id, biz, name, kind, weight) VALUES
      (gen_random_uuid(), B1, 'Green Valley Hotel',     'business',    0),
      (gen_random_uuid(), B1, 'Tumaini Day School',     'institution', 0),
      (gen_random_uuid(), B2, 'Westlands Coffee House', 'business',    0),
      (gen_random_uuid(), B3, 'Roysambu Bakery',        'business',    0);

    -- Individuals: 16 at Main, 10 each at the other branches
    FOR v_name IN
        SELECT f || ' ' || l FROM unnest(v_firsts) f CROSS JOIN unnest(v_lasts) l
        WHERE f <> l ORDER BY random() LIMIT 36
    LOOP
        i := i + 1;
        v_biz := CASE WHEN i <= 16 THEN B1 WHEN i <= 26 THEN B2 ELSE B3 END;
        INSERT INTO seed_cust VALUES (gen_random_uuid(), v_biz, v_name, 'individual',
                                      CASE WHEN random() < 0.25 THEN 5 WHEN random() < 0.6 THEN 2 ELSE 0.7 END);
    END LOOP;

    INSERT INTO public.customers (id, business_id, name, phone, email, join_date, customer_type, payment_terms,
        delivery_frequency, notify_service, notify_promotions, created_at, updated_at, last_modified_by)
    SELECT c.id, c.biz, c.name,
           '+2547' || lpad((((12345678 + n * 7654321) % 90000000) + 10000000)::TEXT, 8, '0'),
           CASE WHEN c.kind <> 'individual'
                THEN 'accounts@' || lower(regexp_replace(c.name, '[^A-Za-z]', '', 'g')) || '.test'
                WHEN random() < 0.35 THEN lower(replace(c.name, ' ', '.')) || '@example.com' END,
           j, c.kind, CASE WHEN c.kind = 'individual' THEN 'pay_now' ELSE 'weekly' END, 'none',
           TRUE, random() < 0.4, j, j, 'Brian Otieno'
    FROM (SELECT *, row_number() OVER (ORDER BY name) AS n,
                 pg_temp.at(d0 - 5 + floor(random() * 60)::INT, 10, 0) AS j
          FROM seed_cust) c;

    -- Suppliers ---------------------------------------------------------------
    INSERT INTO public.suppliers (business_id, name, phone, company, product_supplied, created_at, updated_at)
    SELECT B1, v.contact, v.phone, s.supplier, v.what, t_open, t_open
    FROM (SELECT DISTINCT supplier FROM seed_catalog) s
    JOIN (VALUES ('Kiambu Dairy Farmers Co-op', 'Samuel Ndungu', '+254722100001', 'Fresh milk, mala, yoghurt'),
                 ('Limuru Fresh Farms',         'Ann Wairimu',   '+254722100002', 'Butter, ghee, cheese, long life milk'),
                 ('Nairobi Bakers Ltd',         'Daniel Ouma',   '+254722100003', 'Bread'),
                 ('Ruiru Poultry Farm',         'Ruth Chebet',   '+254722100004', 'Eggs'),
                 ('Sweet Valley Honey',         'James Muriuki', '+254722100005', 'Honey')) v(company, contact, phone, what)
      ON v.company = s.supplier;
END $seed$;

-- =============================================================================
-- 2. Day by day for 90 days: deliveries, transfers, sales, debt payments
-- =============================================================================
DO $history$
DECLARE
    B1 CONSTANT UUID := 'b1000000-0000-4000-8000-000000000001';
    U_STOCK CONSTANT UUID := 'a0000000-0000-4000-8000-000000000006';
    today DATE := (now() AT TIME ZONE 'Africa/Nairobi')::DATE;
    d0 DATE := today - 90;
    v_now TIMESTAMPTZ := now();
    hours INT[] := ARRAY[6,7,7,7,8,8,8,9,9,10,10,11,11,12,12,13,13,14,15,16,16,17,17,17,18,18,18,19,19,20];
    d DATE; dow INT; v_n INT; k INT; ts TIMESTAMPTZ;
    b RECORD; r RECORD; ac RECORD; v_method TEXT; v_tref TEXT; v_transfer UUID; v_qty NUMERIC; v_cnt INT;
    v_staff UUID; v_staff_name TEXT; v_cid UUID; v_cname TEXT;
BEGIN
    FOR i IN 0..(today - d0) LOOP
        d := d0 + i;
        dow := extract(dow FROM d)::INT;     -- 0 = Sunday

        -- ------------------------------------------------ morning deliveries
        -- Main: everything below target. Other branches: fresh milk and bread only.
        FOR r IN SELECT p.id, p.stock, p.business_id, sb.n, c.kind, c.supplier, ceil(c.target * sb.scale) AS target
                 FROM public.products p JOIN seed_catalog c ON c.sku = p.sku JOIN seed_branch sb ON sb.id = p.business_id
                 WHERE (sb.n = 1 OR c.kind = 'fresh')
        LOOP
            CONTINUE WHEN r.kind = 'stock' AND NOT (dow IN (1, 4) OR r.stock < r.target * 0.3);
            CONTINUE WHEN r.stock >= r.target * 0.9;
            -- Main keeps extra for the two branches it supplies
            v_qty := ceil(r.target * CASE WHEN r.n = 1 AND r.kind = 'stock' THEN 3.5 ELSE 1 END - r.stock);
            CONTINUE WHEN v_qty <= 0;
            PERFORM pg_temp.adjust(r.id, 'Restock', v_qty, 'Delivery from ' || r.supplier,
                CASE r.n WHEN 1 THEN 'Joseph Kiprono' WHEN 2 THEN 'Lucy Wambui' ELSE 'Faith Njeri' END,
                pg_temp.at(d, 5, pg_temp.ri(5, 50)),
                'PO-' || to_char(d, 'YYMMDD') || '-' || upper(substr(md5(r.business_id::TEXT || r.supplier), 1, 4)));
        END LOOP;

        -- ------------------------------------- transfers Main -> Westlands / Thika Road
        IF dow IN (1, 4) THEN
            FOR b IN SELECT * FROM seed_branch sb WHERE sb.n > 1 ORDER BY sb.n LOOP
                ts := pg_temp.at(d, 9, pg_temp.ri(0, 40));
                v_tref := 'TR-' || to_char(d, 'YYMMDD') || '-' || b.n || upper(substr(md5(d::TEXT || b.n), 1, 4));
                INSERT INTO public.stock_transfers (reference, from_business_id, to_business_id, status, note, sent_by_name,
                    sent_by_user_id, sent_at, received_by_name, received_at, created_at, updated_at, client_reference)
                VALUES (v_tref, B1, b.id, 'received', CASE WHEN random() < 0.3 THEN 'Regular top-up' END, 'Joseph Kiprono',
                        U_STOCK, ts, b.cashier_name, ts + interval '80 minutes', ts, ts + interval '80 minutes', 'seed-' || v_tref)
                RETURNING id INTO v_transfer;
                v_cnt := 0;
                FOR r IN SELECT m.id AS from_id, w.id AS to_id, m.stock AS from_stock, w.stock AS to_stock,
                                ceil(c.target * b.scale * 2) AS target, m.name, m.sku, m.unit, m.category, m.cost, m.price
                         FROM seed_catalog c
                         JOIN public.products m ON m.sku = c.sku AND m.business_id = B1
                         JOIN public.products w ON w.sku = c.sku AND w.business_id = b.id
                         WHERE c.kind = 'stock' ORDER BY c.sku
                LOOP
                    v_qty := LEAST(r.target - r.to_stock, floor(r.from_stock * 0.45));
                    CONTINUE WHEN v_qty < 1;
                    v_cnt := v_cnt + 1;
                    INSERT INTO public.stock_transfer_items (transfer_id, from_product_id, to_product_id, product_name, sku, unit,
                        category, unit_cost, unit_price, quantity_sent, quantity_received, created_at)
                    VALUES (v_transfer, r.from_id, r.to_id, r.name, r.sku, r.unit, r.category, r.cost, r.price, v_qty,
                            CASE WHEN random() < 0.03 THEN v_qty - 1 ELSE v_qty END, ts);
                    PERFORM pg_temp.adjust(r.from_id, 'Transfer Out', -v_qty, 'Sent to ' || b.name, 'Joseph Kiprono', ts, v_tref);
                    PERFORM pg_temp.adjust(r.to_id, 'Transfer In',
                        (SELECT quantity_received FROM public.stock_transfer_items WHERE transfer_id = v_transfer AND to_product_id = r.to_id),
                        'Received from KayKay''s Milk', b.cashier_name, ts + interval '80 minutes', v_tref);
                END LOOP;
                IF v_cnt = 0 THEN
                    DELETE FROM public.stock_transfers WHERE id = v_transfer;
                END IF;
            END LOOP;
        END IF;

        -- ------------------------------------------------------------- sales
        FOR b IN SELECT * FROM seed_branch sb ORDER BY sb.n LOOP
            v_n := round((CASE WHEN dow IN (0, 6) THEN 22 ELSE 16 END) * b.scale * (0.8 + random() * 0.4));
            FOR k IN 1..v_n LOOP
                ts := pg_temp.at(d, hours[pg_temp.ri(1, array_length(hours, 1))], pg_temp.ri(0, 59));
                CONTINUE WHEN ts > v_now;
                -- the cashier sells; the owner or manager sometimes covers at Main
                IF b.n = 1 AND random() < 0.15 THEN
                    SELECT id, name INTO v_staff, v_staff_name FROM public.employees
                    WHERE business_id = B1 AND user_id = 'a0000000-0000-4000-8000-000000000002';
                ELSE
                    v_staff := b.cashier; v_staff_name := b.cashier_name;
                END IF;
                -- about a third of sales have a known customer
                v_cid := NULL; v_cname := NULL;
                IF random() < 0.35 THEN
                    SELECT id, name INTO v_cid, v_cname FROM seed_cust WHERE biz = b.id AND kind = 'individual'
                    ORDER BY -ln(1 - random()) / weight LIMIT 1;
                END IF;
                v_method := CASE WHEN random() < 0.55 THEN 'M-Pesa' WHEN random() < 0.75 THEN 'Cash'
                                 WHEN random() < 0.6 THEN 'Card' ELSE 'Bank' END;
                -- a regular occasionally takes it on credit
                IF v_cid IS NOT NULL AND random() < 0.08 THEN v_method := 'Credit_Debt'; END IF;
                PERFORM pg_temp.sale(b.id, ts, v_staff, v_staff_name, v_cid, v_cname, v_method,
                                     pg_temp.basket(b.id, pg_temp.ri(1, 3)));
            END LOOP;

            -- account customers buy on credit most weekdays
            FOR ac IN SELECT id, name FROM seed_cust WHERE biz = b.id AND kind <> 'individual' LOOP
                CONTINUE WHEN dow = 0 OR random() < 0.3;
                ts := pg_temp.at(d, 7, pg_temp.ri(0, 50));
                CONTINUE WHEN ts > v_now;
                PERFORM pg_temp.sale(b.id, ts, b.cashier, b.cashier_name, ac.id, ac.name, 'Credit_Debt',
                    jsonb_build_array(
                        jsonb_build_object('p', (SELECT id FROM public.products WHERE business_id = b.id AND sku = 'KK-FM-1000'),
                                           'q', pg_temp.ri(4, 12)),
                        jsonb_build_object('p', (SELECT id FROM public.products WHERE business_id = b.id AND sku = 'KK-BRD-WHT'),
                                           'q', pg_temp.ri(0, 3))));
            END LOOP;

            -- Fridays: account customers pay most of what they owe; others with debt pay now and then
            FOR ac IN SELECT cu.id, cu.name, cu.debt_balance, sc.kind FROM public.customers cu JOIN seed_cust sc ON sc.id = cu.id
                     WHERE cu.business_id = b.id AND cu.debt_balance > 0 LOOP
                CONTINUE WHEN NOT ((ac.kind <> 'individual' AND dow = 5 AND random() < 0.85)
                                   OR (ac.kind = 'individual' AND random() < 0.15));
                ts := pg_temp.at(d, 17, pg_temp.ri(0, 50));
                CONTINUE WHEN ts > v_now;
                PERFORM public.process_debt_payment(b.id, ac.id,
                    CASE WHEN random() < 0.7 THEN ac.debt_balance ELSE round(ac.debt_balance / 2) END,
                    CASE WHEN random() < 0.7 THEN 'M-Pesa' ELSE 'Cash' END, b.cashier_name, NULL,
                    'debt-' || to_char(ts, 'YYMMDDHH24MI') || '-' || substr(md5(random()::TEXT), 1, 6));
                PERFORM pg_temp.stamp(ts);
            END LOOP;
        END LOOP;

        -- whatever notifications the day's triggers raised (low stock, etc.) get an evening time
        PERFORM pg_temp.stamp(LEAST(pg_temp.at(d, 21, 15), v_now - interval '1 minute'));
        PERFORM pg_temp.stamp_sales(d);
    END LOOP;
END $history$;

-- =============================================================================
-- 3. Finishing touches: one transfer cancelled, one on the way, last-visit dates
-- =============================================================================
DO $final$
DECLARE
    B1 CONSTANT UUID := 'b1000000-0000-4000-8000-000000000001';
    B2 CONSTANT UUID := 'b2000000-0000-4000-8000-000000000002';
    B3 CONSTANT UUID := 'b3000000-0000-4000-8000-000000000003';
    U_STOCK CONSTANT UUID := 'a0000000-0000-4000-8000-000000000006';
    r RECORD; v_id UUID; v_ts TIMESTAMPTZ; v_ref TEXT;
BEGIN
    -- Cancelled transfer to Westlands, 12 days ago: stock went out and came back
    v_ts := now() - interval '12 days' - interval '3 hours';
    v_ref := 'TR-' || to_char(v_ts AT TIME ZONE 'Africa/Nairobi', 'YYMMDD') || '-CANCL';
    INSERT INTO public.stock_transfers (reference, from_business_id, to_business_id, status, note, sent_by_name, sent_by_user_id,
        sent_at, cancelled_by_name, cancelled_at, cancel_reason, created_at, updated_at, client_reference)
    VALUES (v_ref, B1, B2, 'cancelled', 'Extra yoghurt for the weekend', 'Joseph Kiprono', U_STOCK, v_ts, 'Joseph Kiprono',
            v_ts + interval '40 minutes', 'Rider was not available, sent with Thursday''s transfer instead', v_ts,
            v_ts + interval '40 minutes', 'seed-' || v_ref)
    RETURNING id INTO v_id;
    FOR r IN SELECT m.id AS from_id, w.id AS to_id, m.name, m.sku, m.unit, m.category, m.cost, m.price
             FROM public.products m JOIN public.products w ON w.sku = m.sku AND w.business_id = B2
             WHERE m.business_id = B1 AND m.sku IN ('KK-YG-STR-500', 'KK-YG-VAN-500') LOOP
        INSERT INTO public.stock_transfer_items (transfer_id, from_product_id, to_product_id, product_name, sku, unit, category,
            unit_cost, unit_price, quantity_sent, created_at)
        VALUES (v_id, r.from_id, r.to_id, r.name, r.sku, r.unit, r.category, r.cost, r.price, 6, v_ts);
        INSERT INTO public.inventory_adjustments (business_id, product_id, product_name, type, quantity_adjusted, previous_stock,
            new_stock, timestamp, reason, staff_name, reference_number, created_at, updated_at)
        VALUES (B1, r.from_id, r.name, 'Transfer Out', -6, 20, 14, v_ts, 'Sent to KayKay''s Milk Westlands', 'Joseph Kiprono', v_ref, v_ts, v_ts),
               (B1, r.from_id, r.name, 'Transfer Return', 6, 14, 20, v_ts + interval '40 minutes', 'Transfer cancelled', 'Joseph Kiprono', v_ref,
                v_ts + interval '40 minutes', v_ts + interval '40 minutes');
    END LOOP;

    -- Transfer to Thika Road sent 50 minutes ago, not received yet (test Receive)
    v_ts := now() - interval '50 minutes';
    v_ref := 'TR-' || to_char(v_ts AT TIME ZONE 'Africa/Nairobi', 'YYMMDD') || '-TRANS';
    INSERT INTO public.stock_transfers (reference, from_business_id, to_business_id, status, note, sent_by_name, sent_by_user_id,
        sent_at, created_at, updated_at, client_reference)
    VALUES (v_ref, B1, B3, 'in_transit', 'Butter and long life milk', 'Joseph Kiprono', U_STOCK, v_ts, v_ts, v_ts, 'seed-' || v_ref)
    RETURNING id INTO v_id;
    FOR r IN SELECT m.id AS from_id, m.name, m.sku, m.unit, m.category, m.cost, m.price
             FROM public.products m WHERE m.business_id = B1 AND m.sku IN ('KK-BTR-250', 'KK-UHT-500') AND m.stock >= 4 LOOP
        INSERT INTO public.stock_transfer_items (transfer_id, from_product_id, product_name, sku, unit, category,
            unit_cost, unit_price, quantity_sent, created_at)
        VALUES (v_id, r.from_id, r.name, r.sku, r.unit, r.category, r.cost, r.price, 3, v_ts);
        PERFORM pg_temp.adjust(r.from_id, 'Transfer Out', -3, 'Sent to KayKay''s Milk Thika Road', 'Joseph Kiprono', v_ts, v_ref);
    END LOOP;
    INSERT INTO public.notifications (business_id, title, message, type, priority, action_type, action_target, payload, created_by,
        status, created_at, updated_at, sent_at, delivered_at)
    VALUES (B3, 'Stock on the way', 'KayKay''s Milk sent 2 products (' || v_ref || '). Check it when it arrives and confirm what came.',
            'Stock Transfer', 'high', 'navigate', 'stock-transfers', jsonb_build_object('transferId', v_id, 'reference', v_ref),
            'system', 'delivered', v_ts, v_ts, v_ts, v_ts);

    -- Customers' "updated" date = their last purchase
    SET LOCAL session_replication_role = replica;
    UPDATE public.customers c SET updated_at = GREATEST(c.created_at,
        COALESCE((SELECT MAX(timestamp) FROM public.transactions t WHERE t.customer_id = c.id), c.created_at));
    SET LOCAL session_replication_role = origin;
END $final$;

ANALYZE public.transactions, public.transaction_items, public.inventory_adjustments, public.customers,
        public.products, public.customer_ledger, public.payment_asset_ledger, public.credit_payments;
