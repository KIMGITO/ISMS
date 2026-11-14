-- =============================================================================
-- seed.sql: one year of realistic test data for a LOCAL database
--
-- Loaded automatically by `supabase db reset` (see [db.seed] in config.toml),
-- or by hand: psql "$LOCAL_DB_URL" -f supabase/seed.sql
--
-- It refuses to run when the database already has a business, so it can never
-- mix test data into the live database.
--
-- Every date is relative to the day it runs: the history always covers the last
-- 365 days up to "now", so dashboards and reports look current.
--
-- Sales, credit, debt payments, wallet top-ups and points go through the same
-- database functions the app calls (process_customer_transaction,
-- process_business_payment, process_debt_payment, redeem_customer_points) and the
-- same triggers, so stock, money balances, debts, points and tiers all agree.
-- Rows those functions stamp with now() are moved back to the moment they
-- happened.
--
-- The history commits once per simulated day. One year in a single transaction
-- piles thousands of row versions onto the few rows that change on every sale
-- (stock, money balances), and it slows to a crawl. If it stops halfway, run
-- supabase db reset again.
--
-- Sign in (all passwords: Test1234!)
--   owner@kaykays.test      Owner, both branches
--   manager@kaykays.test    Manager
--   cashier@kaykays.test    Cashier (mornings)
--   cashier2@kaykays.test   Cashier (afternoons, joined later in the year)
--   rider@kaykays.test      Rider
--   stock@kaykays.test      Inventory Manager (restocks, production)
--   westlands@kaykays.test  Cashier at the Westlands branch
--   Website customers: see the customer_accounts table (same password).
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

CREATE FUNCTION pg_temp.pick(arr TEXT[]) RETURNS TEXT LANGUAGE sql VOLATILE
AS $$ SELECT arr[1 + floor(random() * array_length(arr, 1))::INT] $$;

-- Local Nairobi time on a day -> timestamptz, with random seconds
CREATE FUNCTION pg_temp.at(d DATE, h INT, m INT) RETURNS TIMESTAMPTZ LANGUAGE sql VOLATILE
AS $$ SELECT ((d + make_time(h, m, floor(random() * 60)::INT)) AT TIME ZONE 'Africa/Nairobi') $$;

CREATE FUNCTION pg_temp.mpesa_code() RETURNS TEXT LANGUAGE sql VOLATILE
AS $$ SELECT 'T' || upper(substr(translate(md5(random()::TEXT), '0123456789', 'GHJKLMNPQR'), 1, 3))
             || upper(substr(md5(random()::TEXT), 1, 6)) $$;

-- Auth user + identity; handle_new_user creates the public.users row.
CREATE FUNCTION pg_temp.mk_user(p_id UUID, p_email TEXT, p_name TEXT, p_phone TEXT, p_customer BOOLEAN, p_created TIMESTAMPTZ)
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
        jsonb_build_object('name', p_name, 'phone', p_phone)
            || CASE WHEN p_customer THEN '{"account_type":"customer"}'::JSONB ELSE '{}'::JSONB END,
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

-- Rows that the app's functions and triggers create carry now(). This moves the ones
-- belonging to the event that just happened back to its real time. Sale-linked rows
-- are fixed in bulk at the end instead (they carry a transaction_id).
CREATE FUNCTION pg_temp.stamp(p_ts TIMESTAMPTZ) RETURNS VOID LANGUAGE plpgsql AS $f$
DECLARE
    t0 TIMESTAMPTZ := now();
BEGIN
    SET LOCAL session_replication_role = replica;
    UPDATE public.customer_ledger       SET created_at = p_ts WHERE created_at = t0 AND transaction_id IS NULL;
    UPDATE public.debt_payments         SET created_at = p_ts WHERE created_at = t0;
    UPDATE public.loyalty_points_earned SET created_at = p_ts WHERE created_at = t0 AND transaction_id IS NULL;
    UPDATE public.loyalty_redemptions   SET created_at = p_ts WHERE created_at = t0;
    UPDATE public.wallet_transactions   SET created_at = p_ts WHERE created_at = t0 AND transaction_id IS NULL;
    UPDATE public.payments              SET created_at = p_ts WHERE created_at = t0;
    UPDATE public.payment_asset_ledger  SET created_at = p_ts WHERE created_at = t0 AND transaction_id IS NULL;
    UPDATE public.credit_payments       SET settled_at = p_ts WHERE settled_at = t0;
    UPDATE public.credit_payments       SET updated_at = p_ts WHERE updated_at = t0 AND created_at <> t0;
    UPDATE public.notifications         SET created_at = p_ts, updated_at = p_ts, sent_at = p_ts, delivered_at = p_ts
                                        WHERE created_at = t0;
    UPDATE public.customer_messages     SET created_at = p_ts WHERE created_at = t0;
    SET LOCAL session_replication_role = origin;
END $f$;

-- Sale-linked rows created in this transaction -> the sale's time. Run before each commit.
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

-- Stock movement with an explicit time (restock, damage, production, transfers).
CREATE FUNCTION pg_temp.adjust(p_prod UUID, p_type public.inventory_adjustment_type, p_delta NUMERIC, p_reason TEXT,
                               p_staff TEXT, p_ts TIMESTAMPTZ, p_ref TEXT DEFAULT NULL, p_batch UUID DEFAULT NULL,
                               p_notes TEXT DEFAULT NULL)
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
        previous_stock, new_stock, timestamp, reason, staff_name, reference_number, notes, batch_id,
        created_at, updated_at, last_modified_by)
    VALUES (v_biz, p_prod, v_name, p_type, v_new - v_old, v_old, v_new, p_ts, p_reason, p_staff, p_ref, p_notes,
            p_batch, p_ts, p_ts, p_staff);
    RETURN v_new - v_old;
END $f$;

-- One sale, recorded the way the till records it:
--   credit sale with a customer -> process_customer_transaction (wallet first, then debt)
--   anything else               -> transactions + transaction_items insert (amount_paid = total)
-- p_lines: [{"p": product_id, "q": quantity, "d": line discount %}]
CREATE FUNCTION pg_temp.sale(p_biz UUID, p_ts TIMESTAMPTZ, p_staff UUID, p_staff_name TEXT,
                             p_cust UUID, p_cust_name TEXT, p_method TEXT, p_lines JSONB,
                             p_fee NUMERIC DEFAULT 0, p_rider TEXT DEFAULT NULL, p_note TEXT DEFAULT NULL,
                             p_ref TEXT DEFAULT NULL, p_cart_discount NUMERIC DEFAULT 0)
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

    v_disc  := v_disc + COALESCE(p_cart_discount, 0);
    v_final := v_total - v_disc + COALESCE(p_fee, 0);
    v_ref   := COALESCE(p_ref, 'tx-' || (extract(epoch FROM p_ts) * 1000)::BIGINT || '-' || substr(md5(random()::TEXT), 1, 6));

    IF p_cust IS NOT NULL AND p_method = 'Credit_Debt' THEN
        v_id := public.process_customer_transaction(
            p_biz, p_cust, p_cust_name, p_staff, p_staff_name, v_total, v_disc, 0, v_final, 0,
            'Credit_Debt', p_ts, p_note, p_rider IS NOT NULL, COALESCE(p_fee, 0), p_rider, v_ref, v_items);
        SET LOCAL session_replication_role = replica;
        UPDATE public.credit_payments SET created_at = p_ts, updated_at = p_ts WHERE transaction_id = v_id;
        SET LOCAL session_replication_role = origin;
    ELSE
        INSERT INTO public.transactions (business_id, total, discount, tax, final_total, amount_paid, wallet_applied,
            payment_method, customer_id, customer_name, staff_id, staff_name, status, timestamp, note, is_delivery,
            delivery_fee, rider_name, reference_id, created_at, updated_at)
        VALUES (p_biz, v_total, v_disc, 0, v_final, v_final, 0, p_method::public.payment_method, p_cust, p_cust_name,
            p_staff, p_staff_name, 'Synced', p_ts, p_note, p_rider IS NOT NULL, COALESCE(p_fee, 0), p_rider, v_ref,
            p_ts, p_ts)
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

    INSERT INTO seed_sold (product_id, sold_on, qty)
    SELECT (i->>'product_id')::UUID, (p_ts AT TIME ZONE 'Africa/Nairobi')::DATE, SUM((i->>'quantity')::NUMERIC)
    FROM jsonb_array_elements(v_items) i GROUP BY 1
    ON CONFLICT (product_id, sold_on) DO UPDATE SET qty = seed_sold.qty + EXCLUDED.qty;

    RETURN v_id;
END $f$;

-- Random basket from a branch's shelf: weighted by popularity, never more than in stock.
CREATE FUNCTION pg_temp.basket(p_biz UUID, p_lines INT, p_web_only BOOLEAN DEFAULT FALSE) RETURNS JSONB
LANGUAGE sql VOLATILE AS $f$
    SELECT jsonb_agg(jsonb_build_object('p', id, 'q', q, 'd', d))
    FROM (
        SELECT sp.id,
               LEAST(floor(p.stock), sp.qlo + floor(power(random(), 2.2) * (sp.qhi - sp.qlo + 1)))::NUMERIC AS q,
               CASE WHEN p_web_only THEN 0 WHEN random() < 0.03 THEN 10 WHEN random() < 0.04 THEN 5 ELSE 0 END AS d
        FROM seed_prod sp
        JOIN public.products p ON p.id = sp.id
        WHERE sp.biz = p_biz AND p.stock >= 1 AND p.deleted_at IS NULL
          AND (NOT p_web_only OR p.show_on_website)
        ORDER BY -ln(1 - random()) / sp.weight
        LIMIT p_lines
    ) x
$f$;

-- -----------------------------------------------------------------------------
-- Working tables
-- -----------------------------------------------------------------------------

CREATE TEMP TABLE seed_prod (
    id UUID PRIMARY KEY, biz UUID, sku TEXT, kind TEXT, weight NUMERIC, qlo INT, qhi INT,
    base_target NUMERIC, supplier TEXT, milk_per_unit NUMERIC, recipe_id UUID, bom_id UUID
);
CREATE TEMP TABLE seed_sold (product_id UUID, sold_on DATE, qty NUMERIC, PRIMARY KEY (product_id, sold_on));
CREATE TEMP TABLE seed_cust (
    id UUID PRIMARY KEY, biz UUID, name TEXT, kind TEXT, weight NUMERIC, join_d DATE, last_d DATE,
    credit_p NUMERIC, inst_litres INT, inst_days INT[], term_only BOOLEAN, pay_ratio NUMERIC, terms TEXT
);
CREATE TEMP TABLE seed_shift (emp UUID, biz UUID, s TIMESTAMPTZ, e TIMESTAMPTZ);
CREATE TEMP TABLE seed_purchase_lines (biz UUID, day DATE, supplier TEXT, name TEXT, qty NUMERIC, unit TEXT, cost NUMERIC,
    happened_at TIMESTAMPTZ, ref TEXT);
CREATE TEMP TABLE seed_exp (biz UUID, category TEXT, amount NUMERIC, descr TEXT, method TEXT, happened_at TIMESTAMPTZ, staff TEXT,
    ref TEXT);

-- Speed up the per-event stamping (dropped again at the end)
CREATE INDEX seed_tmp_dp   ON public.debt_payments (created_at);
CREATE INDEX seed_tmp_lpe  ON public.loyalty_points_earned (created_at) WHERE transaction_id IS NULL;
CREATE INDEX seed_tmp_cl   ON public.customer_ledger (created_at) WHERE transaction_id IS NULL;
CREATE INDEX seed_tmp_lr   ON public.loyalty_redemptions (created_at);
CREATE INDEX seed_tmp_wt   ON public.wallet_transactions (created_at) WHERE transaction_id IS NULL;
CREATE INDEX seed_tmp_pay  ON public.payments (created_at);
CREATE INDEX seed_tmp_pal  ON public.payment_asset_ledger (created_at) WHERE transaction_id IS NULL;
CREATE INDEX seed_tmp_cps  ON public.credit_payments (settled_at);
CREATE INDEX seed_tmp_cpu  ON public.credit_payments (updated_at);
CREATE INDEX seed_tmp_ntf  ON public.notifications (created_at);
CREATE INDEX seed_tmp_cm   ON public.customer_messages (created_at);
CREATE INDEX seed_tmp_ia   ON public.inventory_adjustments (reference_number);

-- =============================================================================
-- 1. People, businesses, settings, catalogue, customers
-- =============================================================================
DO $seed$
DECLARE
    B1 CONSTANT UUID := 'b1000000-0000-4000-8000-000000000001';   -- Main branch
    B2 CONSTANT UUID := 'b2000000-0000-4000-8000-000000000002';   -- Westlands branch
    U_OWNER CONSTANT UUID := 'a0000000-0000-4000-8000-000000000001';
    U_MGR   CONSTANT UUID := 'a0000000-0000-4000-8000-000000000002';
    U_CASH1 CONSTANT UUID := 'a0000000-0000-4000-8000-000000000003';
    U_CASH2 CONSTANT UUID := 'a0000000-0000-4000-8000-000000000004';
    U_RIDER CONSTANT UUID := 'a0000000-0000-4000-8000-000000000005';
    U_STOCK CONSTANT UUID := 'a0000000-0000-4000-8000-000000000006';
    U_WEST  CONSTANT UUID := 'a0000000-0000-4000-8000-000000000007';
    d0 DATE := (now() AT TIME ZONE 'Africa/Nairobi')::DATE - 365;
    v_firsts TEXT[] := ARRAY['Wanjiku','Achieng','Kamau','Otieno','Njeri','Mwangi','Atieno','Kiprop','Chebet','Wafula',
        'Nyambura','Omondi','Wairimu','Kibet','Akinyi','Mutua','Muthoni','Ochieng','Jepkosgei','Njoroge','Moraa','Kiplagat',
        'Wambui','Onyango','Nduta','Barasa','Awino','Kariuki','Naliaka','Gitau','Adhiambo','Mbugua','Wangari','Korir',
        'Nekesa','Maina','Akoth','Ruto','Kerubo','Waweru','Grace','Brian','Faith','Kevin','Mercy','Dennis','Lucy','Peter',
        'Joyce','Samuel','Esther','David','Ann','James','Mary','John','Ruth','Daniel'];
    v_lasts TEXT[] := ARRAY['Kamau','Otieno','Wanjiru','Mwangi','Odhiambo','Kiprono','Njoroge','Mutua','Wafula','Chebet',
        'Omondi','Karanja','Achieng','Kariuki','Ndungu','Ouma','Kimani','Wekesa','Rotich','Gathoni','Owino','Macharia',
        'Nyaga','Langat','Muriuki','Ochieng','Mugo','Kiplagat','Wairimu','Okoth','Githinji','Cheruiyot','Nduati','Simiyu',
        'Kirui','Oduor','Maina','Nyokabi','Kosgei','Muthoka'];
    v_name TEXT; v_id UUID; v_join DATE; v_kind TEXT; v_w NUMERIC; i INT := 0; r RECORD;
    v_cat UUID;
BEGIN
    -- Staff logins -------------------------------------------------------------
    PERFORM pg_temp.mk_user(U_OWNER, 'owner@kaykays.test',     'Kevin Kamau',     '+254711000001', FALSE, pg_temp.at(d0 - 20, 9, 0));
    PERFORM pg_temp.mk_user(U_MGR,   'manager@kaykays.test',   'Mercy Achieng',   '+254711000002', FALSE, pg_temp.at(d0 - 18, 10, 0));
    PERFORM pg_temp.mk_user(U_CASH1, 'cashier@kaykays.test',   'Brian Otieno',    '+254711000003', FALSE, pg_temp.at(d0 - 15, 11, 0));
    PERFORM pg_temp.mk_user(U_CASH2, 'cashier2@kaykays.test',  'Faith Njeri',     '+254711000004', FALSE, pg_temp.at(d0 + 75, 9, 0));
    PERFORM pg_temp.mk_user(U_RIDER, 'rider@kaykays.test',     'Peter Mwangi',    '+254711000005', FALSE, pg_temp.at(d0 - 15, 12, 0));
    PERFORM pg_temp.mk_user(U_STOCK, 'stock@kaykays.test',     'Joseph Kiprono',  '+254711000006', FALSE, pg_temp.at(d0 - 15, 13, 0));
    PERFORM pg_temp.mk_user(U_WEST,  'westlands@kaykays.test', 'Lucy Wambui',     '+254711000007', FALSE, pg_temp.at(d0 + 180, 9, 0));

    -- Businesses (each branch is a business sharing the owner) ------------------
    INSERT INTO public.businesses (id, name, business_type, description, address, contact_email, contact_phone,
        primary_color, secondary_color, is_tax_enabled, tax_percentage, website_slug, created_at, updated_at,
        default_payment_methods)
    VALUES
      (B1, 'KayKay''s Milk', 'Dairy', 'Fresh farm milk, mala, yoghurt and dairy delivered daily in Nairobi.',
       'Ngong Road, opposite Adams Arcade, Nairobi', 'hello@kaykays.test', '+254711000001', '#f59e0b', '#1f2937',
       FALSE, 16, 'kaykays', pg_temp.at(d0 - 20, 9, 5), pg_temp.at(d0 - 20, 9, 5),
       ARRAY['Cash','M-Pesa','Card','Bank']),
      (B2, 'KayKay''s Milk Westlands', 'Dairy', 'Westlands branch.',
       'Woodvale Grove, Westlands, Nairobi', 'westlands@kaykays.test', '+254711000007', '#f59e0b', '#1f2937',
       FALSE, 16, NULL, pg_temp.at(d0 + 180, 8, 0), pg_temp.at(d0 + 180, 8, 0),
       ARRAY['Cash','M-Pesa','Card','Bank']);

    INSERT INTO public.branches (business_id, name, address, created_at, updated_at) VALUES
      (B1, 'Main branch', 'Ngong Road, opposite Adams Arcade, Nairobi', pg_temp.at(d0 - 20, 9, 5), pg_temp.at(d0 - 20, 9, 5)),
      (B2, 'Main branch', 'Woodvale Grove, Westlands, Nairobi', pg_temp.at(d0 + 180, 8, 0), pg_temp.at(d0 + 180, 8, 0));

    -- Memberships create the employee rows (fn_membership_sync_employee)
    INSERT INTO public.business_memberships (business_id, user_id, role, status, joined_at, created_at, updated_at) VALUES
      (B1, U_OWNER, 'Owner',             'Active', pg_temp.at(d0 - 20, 9, 5),  pg_temp.at(d0 - 20, 9, 5),  pg_temp.at(d0 - 20, 9, 5)),
      (B1, U_MGR,   'Manager',           'Active', pg_temp.at(d0 - 18, 10, 0), pg_temp.at(d0 - 18, 10, 0), pg_temp.at(d0 - 18, 10, 0)),
      (B1, U_CASH1, 'Cashier',           'Active', pg_temp.at(d0 - 15, 11, 0), pg_temp.at(d0 - 15, 11, 0), pg_temp.at(d0 - 15, 11, 0)),
      (B1, U_CASH2, 'Cashier',           'Active', pg_temp.at(d0 + 75, 9, 0),  pg_temp.at(d0 + 75, 9, 0),  pg_temp.at(d0 + 75, 9, 0)),
      (B1, U_RIDER, 'Rider',             'Active', pg_temp.at(d0 - 15, 12, 0), pg_temp.at(d0 - 15, 12, 0), pg_temp.at(d0 - 15, 12, 0)),
      (B1, U_STOCK, 'Inventory Manager', 'Active', pg_temp.at(d0 - 15, 13, 0), pg_temp.at(d0 - 15, 13, 0), pg_temp.at(d0 - 15, 13, 0)),
      (B2, U_OWNER, 'Owner',             'Active', pg_temp.at(d0 + 180, 8, 0), pg_temp.at(d0 + 180, 8, 0), pg_temp.at(d0 + 180, 8, 0)),
      (B2, U_WEST,  'Cashier',           'Active', pg_temp.at(d0 + 180, 9, 0), pg_temp.at(d0 + 180, 9, 0), pg_temp.at(d0 + 180, 9, 0));

    UPDATE public.employees e SET created_at = m.joined_at, updated_at = m.joined_at,
        last_seen_at = now() - (random() * interval '20 hours')
    FROM public.business_memberships m
    WHERE m.user_id = e.user_id AND m.business_id = e.business_id;

    INSERT INTO public.invitations (business_id, invited_by, name, email, phone, role, status, created_at, updated_at, expires_at)
    VALUES (B1, U_OWNER, 'Grace Atieno', 'grace@kaykays.test', '+254711000008', 'Cashier', 'Pending',
            now() - interval '1 day', now() - interval '1 day', now() + interval '2 days');

    -- Settings ----------------------------------------------------------------
    INSERT INTO public.receipt_settings (business_id, business_name, address, phone, email, website, pin_number,
        header_message, footer_message, thank_you_message, return_policy, is_tax_enabled, tax_percentage)
    VALUES
      (B1, 'KayKay''s Milk', 'Ngong Road, opp. Adams Arcade', '+254 711 000 001', 'hello@kaykays.test', 'kaykays.test',
       'P051234567X', 'Fresh from the farm, every morning', 'Keep milk below 4°C. Boil raw milk before use.',
       'Asante sana! Karibu tena.', 'Unopened packs can be returned within 24 hours with this receipt.', FALSE, 16),
      (B2, 'KayKay''s Milk Westlands', 'Woodvale Grove, Westlands', '+254 711 000 007', 'westlands@kaykays.test', 'kaykays.test',
       'P051234567X', 'Fresh from the farm, every morning', 'Keep milk below 4°C.', 'Asante sana! Karibu tena.', NULL, FALSE, 16);

    INSERT INTO public.printer_settings (business_id) VALUES (B1), (B2);
    UPDATE public.loyalty_settings SET min_redeem_points = 1000, points_enabled = TRUE WHERE business_id IN (B1, B2);
    INSERT INTO public.mpesa_settings (business_id, till_number, registered_at, updated_by)
    VALUES (B1, '5123456', pg_temp.at(d0 - 10, 10, 0), 'Kevin Kamau');

    INSERT INTO public.delivery_zones (business_id, name, fee, active, created_by_name, created_at, updated_at) VALUES
      (B1, 'Kilimani',     100, TRUE,  'Kevin Kamau', pg_temp.at(d0 - 10, 10, 0), pg_temp.at(d0 - 10, 10, 0)),
      (B1, 'Kileleshwa',   150, TRUE,  'Kevin Kamau', pg_temp.at(d0 - 10, 10, 0), pg_temp.at(d0 - 10, 10, 0)),
      (B1, 'Lavington',    200, TRUE,  'Kevin Kamau', pg_temp.at(d0 - 10, 10, 0), pg_temp.at(d0 - 10, 10, 0)),
      (B1, 'Westlands',    200, TRUE,  'Kevin Kamau', pg_temp.at(d0 - 10, 10, 0), pg_temp.at(d0 - 10, 10, 0)),
      (B1, 'South C',      250, TRUE,  'Mercy Achieng', pg_temp.at(d0 + 40, 10, 0), pg_temp.at(d0 + 40, 10, 0)),
      (B1, 'Rongai',       300, FALSE, 'Mercy Achieng', pg_temp.at(d0 + 60, 10, 0), pg_temp.at(d0 + 200, 10, 0));

    INSERT INTO public.website_settings (business_id, delivery_enabled, delivery_fee, min_order, assistant_enabled,
        opening_hours, whatsapp, created_at, updated_at)
    VALUES (B1, TRUE, 150, 300, TRUE, E'Mon–Sat: 6:30am – 9:00pm\nSunday: 7:00am – 7:00pm',
            '+254 711 000 001', pg_temp.at(d0 + 165, 10, 0), now() - interval '3 days');

    INSERT INTO public.website_promo_codes (business_id, code, description, kind, value, min_order, starts_at, ends_at,
        max_uses, once_per_customer, show_on_website, active, created_by, created_at, updated_at) VALUES
      (B1, 'KARIBU10', '10% off your first order', 'percent', 10, 0, NULL, NULL, NULL, TRUE, TRUE, TRUE, 'Kevin Kamau',
       pg_temp.at(d0 + 165, 10, 0), pg_temp.at(d0 + 165, 10, 0)),
      (B1, 'MILK50', 'KSh 50 off orders over KSh 500', 'amount', 50, 500, NULL, NULL, NULL, FALSE, FALSE, TRUE, 'Mercy Achieng',
       pg_temp.at(d0 + 200, 10, 0), pg_temp.at(d0 + 200, 10, 0)),
      (B1, 'JAMHURI15', 'Jamhuri Day weekend', 'percent', 15, 300, pg_temp.at(d0 + 27, 0, 0), pg_temp.at(d0 + 30, 23, 0), 200,
       TRUE, FALSE, FALSE, 'Kevin Kamau', pg_temp.at(d0 + 25, 10, 0), pg_temp.at(d0 + 31, 10, 0));

    INSERT INTO public.website_articles (business_id, slug, title, summary, body, category, published, published_at, created_at, updated_at) VALUES
      (B1, 'how-to-store-fresh-milk', 'How to keep fresh milk fresh for longer',
       'Simple habits that stop milk going sour before you finish it.',
       E'Keep milk in the coldest part of the fridge, not the door.\n\nPour what you need and put the rest back straight away. Raw milk should be boiled once and cooled quickly before it goes into the fridge.\n\nOur packed milk stays good for three days below 4°C.',
       'Milk care', TRUE, pg_temp.at(d0 + 170, 9, 0), pg_temp.at(d0 + 168, 9, 0), pg_temp.at(d0 + 170, 9, 0)),
      (B1, 'mala-vs-yoghurt', 'Mala or yoghurt: what is the difference?',
       'Both are fermented, but they are made and taste differently.',
       E'Mala is milk fermented with a mesophilic culture at room temperature, so it is thinner and tangier.\n\nYoghurt is fermented warm with a thermophilic culture, which makes it thicker and milder.',
       'Products', TRUE, pg_temp.at(d0 + 190, 9, 0), pg_temp.at(d0 + 189, 9, 0), pg_temp.at(d0 + 190, 9, 0)),
      (B1, 'meet-our-farmers', 'Meet the farmers behind your morning milk',
       'Our milk comes from 40 small farms in Kiambu, collected before sunrise.',
       E'Every morning our cooperative collects milk from small-scale farmers in Kiambu. Each can is tested for freshness and fat before it is cooled and brought to the shop.',
       'Our story', TRUE, pg_temp.at(d0 + 240, 9, 0), pg_temp.at(d0 + 238, 9, 0), pg_temp.at(d0 + 240, 9, 0)),
      (B1, 'school-milk-programme', 'Milk for schools: how our programme works',
       'Daily delivery and monthly invoicing for schools and children''s homes.',
       E'Schools, homes and canteens get milk delivered every weekday before 8am and pay once a month.',
       'Business', FALSE, NULL, now() - interval '2 days', now() - interval '2 days');

    -- Suppliers ---------------------------------------------------------------
    INSERT INTO public.suppliers (business_id, name, phone, email, company, product_supplied, notes, created_at, updated_at) VALUES
      (B1, 'Samuel Ndungu', '+254722100001', 'orders@kiambucoop.test', 'Kiambu Dairy Farmers Co-op', 'Fresh milk', 'Delivers 5:00am daily. Pays farmers on the 10th.', pg_temp.at(d0 - 12, 10, 0), pg_temp.at(d0 - 12, 10, 0)),
      (B1, 'Ann Wairimu',   '+254722100002', NULL, 'Limuru Fresh Farms', 'Cream, butter, cheese', NULL, pg_temp.at(d0 - 12, 10, 0), pg_temp.at(d0 - 12, 10, 0)),
      (B1, 'Daniel Ouma',   '+254722100003', 'sales@nairobibakers.test', 'Nairobi Bakers Ltd', 'Bread', 'Order by 4pm for next morning.', pg_temp.at(d0 - 12, 10, 0), pg_temp.at(d0 - 12, 10, 0)),
      (B1, 'Ruth Chebet',   '+254722100004', NULL, 'Ruiru Poultry Farm', 'Eggs', NULL, pg_temp.at(d0 - 12, 10, 0), pg_temp.at(d0 - 12, 10, 0)),
      (B1, 'James Muriuki', '+254722100005', NULL, 'Sweet Valley Honey', 'Honey, drinking chocolate', NULL, pg_temp.at(d0 + 30, 10, 0), pg_temp.at(d0 + 30, 10, 0)),
      (B1, 'Esther Kosgei', '+254722100006', 'hello@packright.test', 'PackRight Supplies', 'Bottles, cans, packaging, starter culture', 'Minimum order KSh 5,000.', pg_temp.at(d0 - 12, 10, 0), pg_temp.at(d0 - 12, 10, 0));

    -- Products ----------------------------------------------------------------
    -- kind: milk = delivered daily, made = produced in-house from bulk milk, dry = weekly order,
    --       bulk_only = bulk milk (sold mostly to institutions, also the raw material)
    CREATE TEMP TABLE seed_catalog (sku TEXT, name TEXT, category TEXT, price NUMERIC, cost NUMERIC, unit TEXT,
        perishable BOOLEAN, expiry INT, kind TEXT, weight NUMERIC, qlo INT, qhi INT, base NUMERIC, supplier TEXT,
        milk NUMERIC, web BOOLEAN, westlands BOOLEAN, descr TEXT) ON COMMIT DROP;
    INSERT INTO seed_catalog VALUES
      ('KK-FM-1000','Fresh Milk 1L','Fresh Milk',65,42,'Litres',TRUE,3,'milk',30,1,4,40,'Kiambu Dairy Farmers Co-op',NULL,TRUE,TRUE,'Pasteurised whole milk, packed the morning it is collected.'),
      ('KK-FM-500','Fresh Milk 500ml','Fresh Milk',35,23,'Packets',TRUE,3,'milk',18,1,4,30,'Kiambu Dairy Farmers Co-op',NULL,TRUE,TRUE,'Pasteurised whole milk, half litre.'),
      ('KK-FM-BULK','Fresh Milk (Bulk, per litre)','Fresh Milk',58,40,'Litres',TRUE,2,'bulk_only',6,2,10,120,'Kiambu Dairy Farmers Co-op',NULL,FALSE,TRUE,'Bring your own container. Also used for institutions and our yoghurt.'),
      ('KK-UHT-500','Long Life Milk 500ml','Fresh Milk',65,47,'Packets',FALSE,NULL,'dry',4,1,6,40,'Limuru Fresh Farms',NULL,TRUE,TRUE,'UHT milk, keeps 6 months unopened.'),
      ('KK-ML-500','Mala 500ml','Fermented Milk',60,34,'Packets',TRUE,7,'made',12,1,3,25,NULL,0.5,TRUE,TRUE,'Traditional fermented milk.'),
      ('KK-ML-1000','Mala 1L','Fermented Milk',110,62,'Packets',TRUE,7,'made',6,1,2,12,NULL,1.0,TRUE,TRUE,'Traditional fermented milk, family size.'),
      ('KK-LALA-1000','Lala Traditional 1L','Fermented Milk',120,66,'Packets',TRUE,7,'made',3,1,2,8,NULL,1.0,TRUE,FALSE,'Slow-fermented, thick.'),
      ('KK-YG-PLN-500','Plain Yoghurt 500ml','Yoghurt',120,62,'Pieces',TRUE,10,'made',7,1,3,15,NULL,0.55,TRUE,TRUE,'Thick set yoghurt, no added sugar.'),
      ('KK-YG-STR-500','Strawberry Yoghurt 500ml','Yoghurt',130,68,'Pieces',TRUE,10,'made',9,1,3,18,NULL,0.55,TRUE,TRUE,'Made with real strawberry.'),
      ('KK-YG-VAN-500','Vanilla Yoghurt 500ml','Yoghurt',130,68,'Pieces',TRUE,10,'made',7,1,3,15,NULL,0.55,TRUE,TRUE,'Lightly sweet, vanilla.'),
      ('KK-YG-MNG-250','Mango Yoghurt 250ml','Yoghurt',70,37,'Pieces',TRUE,10,'made',6,1,4,15,NULL,0.3,TRUE,TRUE,'Kids'' favourite.'),
      ('KK-YG-GRK-400','Greek Yoghurt 400g','Yoghurt',280,150,'Pieces',TRUE,14,'made',2,1,2,6,NULL,1.2,TRUE,FALSE,'Strained, high protein.'),
      ('KK-BTR-250','Salted Butter 250g','Butter & Ghee',320,225,'Pieces',TRUE,60,'dry',3,1,2,10,'Limuru Fresh Farms',NULL,TRUE,TRUE,'Farm butter.'),
      ('KK-GHE-500','Pure Ghee 500g','Butter & Ghee',650,455,'Jars',FALSE,NULL,'dry',1.5,1,1,6,'Limuru Fresh Farms',NULL,TRUE,FALSE,'Clarified butter.'),
      ('KK-CRM-250','Fresh Cream 250ml','Cream & Cheese',180,110,'Pieces',TRUE,7,'milk',2,1,2,6,'Limuru Fresh Farms',NULL,TRUE,FALSE,'Pouring cream.'),
      ('KK-MOZ-200','Mozzarella 200g','Cream & Cheese',450,300,'Pieces',TRUE,30,'dry',1.2,1,2,6,'Limuru Fresh Farms',NULL,TRUE,FALSE,'Fresh mozzarella.'),
      ('KK-CHD-200','Cheddar 200g','Cream & Cheese',480,320,'Pieces',TRUE,60,'dry',0.8,1,1,4,'Limuru Fresh Farms',NULL,TRUE,FALSE,'Mature cheddar.'),
      ('KK-BRD-WHT','White Bread 400g','Bakery',65,52,'Loaves',TRUE,4,'milk',8,1,2,15,'Nairobi Bakers Ltd',NULL,FALSE,TRUE,NULL),
      ('KK-BRD-BRN','Brown Bread 400g','Bakery',70,56,'Loaves',TRUE,4,'milk',4,1,2,8,'Nairobi Bakers Ltd',NULL,FALSE,TRUE,NULL),
      ('KK-EGG-TRAY','Eggs (Tray of 30)','Eggs',450,365,'Trays',TRUE,21,'dry',2.5,1,1,8,'Ruiru Poultry Farm',NULL,TRUE,TRUE,'Free-range kienyeji-cross eggs.'),
      ('KK-EGG-1','Egg (Single)','Eggs',17,12.2,'Pieces',TRUE,21,'dry',3,1,6,60,'Ruiru Poultry Farm',NULL,FALSE,TRUE,NULL),
      ('KK-HNY-500','Pure Honey 500g','Pantry',550,390,'Jars',FALSE,NULL,'dry',0.8,1,1,6,'Sweet Valley Honey',NULL,TRUE,FALSE,'Raw honey from Baringo.'),
      ('KK-CHOC-250','Drinking Chocolate 250g','Pantry',350,250,'Tins',FALSE,NULL,'dry',0.7,1,1,6,'Sweet Valley Honey',NULL,TRUE,FALSE,NULL),
      ('KK-BTL-1000','Reusable Milk Bottle 1L','Accessories',150,80,'Pieces',FALSE,NULL,'dry',0.6,1,2,10,'PackRight Supplies',NULL,TRUE,TRUE,'Glass, with lid. Bring it back for refills.'),
      ('KK-CAN-5L','Milk Can 5L','Accessories',1200,780,'Pieces',FALSE,NULL,'dry',0.15,1,1,3,'PackRight Supplies',NULL,FALSE,FALSE,'Aluminium can with lid.');

    INSERT INTO public.products (business_id, name, category, price, cost, stock, min_stock, unit, sku, description,
        perishable, expiry_days, show_on_website, created_at, updated_at, last_modified_by)
    SELECT B1, c.name, c.category, c.price, c.cost,
           CASE WHEN c.kind = 'bulk_only' THEN c.base * 2 ELSE c.base END,
           GREATEST(1, ceil(c.base * 0.2)), c.unit, c.sku, c.descr, c.perishable, c.expiry, c.web,
           pg_temp.at(d0 - 10, 12, 0), pg_temp.at(d0 - 10, 12, 0), 'Kevin Kamau'
    FROM seed_catalog c;

    -- Westlands carries part of the range, same SKUs, smaller targets
    INSERT INTO public.products (business_id, name, category, price, cost, stock, min_stock, unit, sku, description,
        perishable, expiry_days, show_on_website, created_at, updated_at, last_modified_by)
    SELECT B2, c.name, c.category, c.price, c.cost, 0, GREATEST(1, ceil(c.base * 0.1)), c.unit, c.sku, c.descr,
           c.perishable, c.expiry, FALSE, pg_temp.at(d0 + 180, 8, 30), pg_temp.at(d0 + 180, 8, 30), 'Kevin Kamau'
    FROM seed_catalog c WHERE c.westlands;

    INSERT INTO seed_prod (id, biz, sku, kind, weight, qlo, qhi, base_target, supplier, milk_per_unit)
    SELECT p.id, p.business_id, c.sku, c.kind, c.weight, c.qlo, c.qhi,
           CASE WHEN p.business_id = B1 THEN c.base ELSE ceil(c.base * 0.45) END, c.supplier, c.milk
    FROM public.products p JOIN seed_catalog c ON c.sku = p.sku;

    -- A product that was dropped from the range (soft-deleted)
    INSERT INTO public.products (business_id, name, category, price, cost, stock, min_stock, unit, sku, perishable,
        expiry_days, show_on_website, deleted_at, created_at, updated_at, last_modified_by)
    VALUES (B1, 'Flavoured Milk 300ml', 'Fresh Milk', 50, 32, 0, 5, 'Pieces', 'KK-FLV-300', TRUE, 5, FALSE,
            pg_temp.at(d0 + 120, 15, 0), pg_temp.at(d0 - 10, 12, 0), pg_temp.at(d0 + 120, 15, 0), 'Mercy Achieng');

    -- Old prices for the first months; the price rise happens during the year (step 2)
    UPDATE public.products SET price = price - 5 WHERE business_id = B1 AND sku IN ('KK-FM-1000','KK-FM-BULK','KK-ML-500');
    UPDATE public.products SET price = price - 3 WHERE business_id = B1 AND sku = 'KK-FM-500';
    UPDATE public.products SET cost = cost - 3 WHERE business_id = B1 AND sku IN ('KK-FM-1000','KK-FM-BULK');

    -- Recipes + bills of materials for what is made in-house --------------------
    FOR r IN SELECT sp.id, sp.milk_per_unit, p.name, p.unit, sp.sku FROM seed_prod sp JOIN public.products p ON p.id = sp.id
             WHERE sp.biz = B1 AND sp.kind = 'made' LOOP
        INSERT INTO public.recipes (business_id, name, code, description, yield_quantity, yield_unit, created_at, updated_at)
        VALUES (B1, r.name, 'RCP-' || substr(r.sku, 4), 'House recipe for ' || r.name, 1, r.unit,
                pg_temp.at(d0 - 8, 10, 0), pg_temp.at(d0 - 8, 10, 0))
        RETURNING id INTO v_id;
        INSERT INTO public.recipe_ingredients (recipe_id, name, quantity, unit, created_at) VALUES
            (v_id, 'Fresh milk', r.milk_per_unit, 'Litres', pg_temp.at(d0 - 8, 10, 0)),
            (v_id, 'Starter culture', 2, 'Grams', pg_temp.at(d0 - 8, 10, 0));
        IF r.sku LIKE 'KK-YG-%' AND r.sku NOT IN ('KK-YG-PLN-500','KK-YG-GRK-400') THEN
            INSERT INTO public.recipe_ingredients (recipe_id, name, quantity, unit, created_at)
            VALUES (v_id, 'Fruit / flavour', 25, 'Grams', pg_temp.at(d0 - 8, 10, 0)),
                   (v_id, 'Sugar', 20, 'Grams', pg_temp.at(d0 - 8, 10, 0));
        END IF;
        UPDATE seed_prod SET recipe_id = v_id WHERE id = r.id;

        INSERT INTO public.bill_of_materials (business_id, product_id, recipe_id, name, yield_quantity, yield_unit, created_at, updated_at)
        VALUES (B1, r.id, v_id, r.name, 1, r.unit, pg_temp.at(d0 - 8, 10, 0), pg_temp.at(d0 - 8, 10, 0))
        RETURNING id INTO v_id;
        INSERT INTO public.bom_ingredients (bom_id, product_id, quantity_required, unit, waste_percentage, created_at)
        SELECT v_id, sp.id, r.milk_per_unit, 'Litres', 2, pg_temp.at(d0 - 8, 10, 0)
        FROM seed_prod sp WHERE sp.biz = B1 AND sp.sku = 'KK-FM-BULK';
        UPDATE seed_prod SET bom_id = v_id WHERE id = r.id;
    END LOOP;

    -- Business assets ---------------------------------------------------------
    INSERT INTO public.business_assets (business_id, name, code, serial_number, value, status, created_at, updated_at) VALUES
      (B1, 'Milk ATM dispenser 500L', 'AST-001', 'MATM-500-22871', 380000, 'Active', pg_temp.at(d0 - 10, 10, 0), pg_temp.at(d0 - 10, 10, 0)),
      (B1, 'Display fridge (double door)', 'AST-002', 'DF-2D-99310', 85000, 'Active', pg_temp.at(d0 - 10, 10, 0), pg_temp.at(d0 - 10, 10, 0)),
      (B1, 'Chest freezer 300L', 'AST-003', 'CF300-11820', 65000, 'Active', pg_temp.at(d0 - 10, 10, 0), pg_temp.at(d0 - 10, 10, 0)),
      (B1, 'Delivery motorbike (KMFX 221B)', 'AST-004', 'ME4KC2190P8765432', 135000, 'Active', pg_temp.at(d0 - 10, 10, 0), pg_temp.at(d0 - 10, 10, 0)),
      (B1, 'Generator 5kVA', 'AST-005', 'GEN5-77120', 70000, 'Under Repair', pg_temp.at(d0 - 10, 10, 0), now() - interval '6 days'),
      (B1, 'Old cooler box', 'AST-006', NULL, 0, 'Disposed', pg_temp.at(d0 - 10, 10, 0), pg_temp.at(d0 + 90, 10, 0)),
      (B2, 'Display fridge (single door)', 'AST-101', 'DF-1D-55102', 55000, 'Active', pg_temp.at(d0 + 180, 10, 0), pg_temp.at(d0 + 180, 10, 0));

    -- Customers ---------------------------------------------------------------
    -- Institutions and businesses buying bulk milk on account
    INSERT INTO seed_cust (id, biz, name, kind, weight, join_d, credit_p, inst_litres, inst_days, term_only, pay_ratio, terms) VALUES
      (gen_random_uuid(), B1, 'Green Valley Hotel',        'business',    0, d0 - 60,  1, 30, '{0,1,2,3,4,5,6}', FALSE, 1.0, 'weekly'),
      (gen_random_uuid(), B1, 'Kilimani Bistro',           'business',    0, d0 - 30,  1, 12, '{1,2,3,4,5,6}',   FALSE, 1.0, 'weekly'),
      (gen_random_uuid(), B1, 'Riverside Café',            'business',    0, d0 + 20,  1, 8,  '{1,2,3,4,5,6}',   FALSE, 0.7, 'weekly'),
      (gen_random_uuid(), B1, 'Neema Bakery',              'business',    0, d0 + 45,  1, 15, '{1,2,3,4,5,6}',   FALSE, 1.0, 'weekly'),
      (gen_random_uuid(), B1, 'Faraja Clinic Canteen',     'institution', 0, d0 + 200, 1, 10, '{1,2,3,4,5}',     FALSE, 1.0, 'weekly'),
      (gen_random_uuid(), B1, 'Tumaini Day School',        'institution', 0, d0 - 90,  1, 40, '{1,2,3,4,5}',     TRUE,  0.6, 'monthly'),
      (gen_random_uuid(), B1, 'Sunrise Academy',           'institution', 0, d0 + 53,  1, 35, '{1,2,3,4,5}',     TRUE,  1.0, 'monthly'),
      (gen_random_uuid(), B1, 'Upendo Children''s Home',   'institution', 0, d0 - 120, 1, 20, '{0,1,2,3,4,5,6}', FALSE, 1.0, 'monthly'),
      (gen_random_uuid(), B1, 'Highrise Apartments Office','other',       0, d0 + 100, 1, 6,  '{1,2,3,4,5}',     FALSE, 1.0, 'monthly'),
      (gen_random_uuid(), B2, 'Westlands Coffee House',    'business',    0, d0 + 190, 1, 8,  '{1,2,3,4,5,6}',   FALSE, 1.0, 'weekly');

    -- Individuals: shuffled unique name pairs
    FOR v_name IN
        SELECT f || ' ' || l FROM unnest(v_firsts) f CROSS JOIN unnest(v_lasts) l
        WHERE f <> l ORDER BY random() LIMIT 165
    LOOP
        i := i + 1;
        v_join := CASE WHEN random() < 0.35 THEN d0 - pg_temp.ri(10, 400)
                       ELSE d0 + floor(power(random(), 1.3) * 360)::INT END;
        v_kind := CASE WHEN i <= 14 THEN 'wallet' ELSE 'individual' END;
        v_w := CASE WHEN random() < 0.18 THEN 6 WHEN random() < 0.55 THEN 2 ELSE 0.5 END;
        INSERT INTO seed_cust (id, biz, name, kind, weight, join_d, last_d, credit_p)
        VALUES (gen_random_uuid(), CASE WHEN i > 140 THEN B2 ELSE B1 END, v_name, v_kind, v_w,
                CASE WHEN i > 140 THEN GREATEST(v_join, d0 + 182) ELSE v_join END,
                CASE WHEN random() < 0.15 THEN d0 + pg_temp.ri(120, 330) END,
                CASE WHEN random() < 0.3 THEN 0.12 ELSE 0.02 END);
    END LOOP;

    INSERT INTO public.customers (id, business_id, name, phone, email, join_date, customer_type, payment_terms,
        delivery_frequency, description, notify_service, notify_promotions, created_at, updated_at, last_modified_by)
    SELECT c.id, c.biz, c.name,
           '+2547' || lpad((((12345678 + n * 7654321) % 90000000) + 10000000)::TEXT, 8, '0'),
           CASE WHEN c.kind IN ('business','institution','other')
                THEN 'accounts@' || lower(regexp_replace(c.name, '[^A-Za-z]', '', 'g')) || '.test'
                WHEN random() < 0.35 THEN lower(replace(c.name, ' ', '.')) || '@example.com' END,
           pg_temp.at(c.join_d, 10, 0),
           CASE WHEN c.kind IN ('wallet','individual') THEN 'individual' ELSE c.kind END,
           COALESCE(c.terms, 'pay_now'),
           CASE WHEN c.inst_litres IS NOT NULL THEN 'daily' WHEN random() < 0.08 THEN 'weekly' ELSE 'none' END,
           CASE WHEN c.inst_litres IS NOT NULL THEN 'Standing order: about ' || c.inst_litres || ' L of milk a day, delivered before 8am.'
                WHEN c.kind = 'wallet' THEN 'Prepays into wallet.' END,
           TRUE, random() < 0.4,
           pg_temp.at(c.join_d, 10, 0), pg_temp.at(c.join_d, 10, 0), 'Brian Otieno'
    FROM (SELECT *, row_number() OVER (ORDER BY join_d, name) AS n FROM seed_cust) c;

    -- Two duplicate records of the same person (tests Customers > Duplicates)
    SELECT id, name, phone INTO r FROM public.customers WHERE business_id = B1 AND customer_type = 'individual'
    ORDER BY join_date LIMIT 1 OFFSET 20;
    INSERT INTO public.customers (business_id, name, phone, join_date, created_at, updated_at, last_modified_by, description)
    VALUES (B1, split_part(r.name, ' ', 1) || ' ' || upper(left(split_part(r.name, ' ', 2), 1)) || '.',
            '0' || substr(r.phone, 5), now() - interval '9 days', now() - interval '9 days', now() - interval '9 days',
            'Faith Njeri', 'Added at the till, probably the same person');

    -- Product reports the owner follows
    INSERT INTO public.report_tracked_items (business_id, item_type, item_key, label)
    SELECT B1, 'product', id::TEXT, name FROM public.products WHERE business_id = B1 AND sku IN ('KK-FM-1000','KK-YG-STR-500');
    INSERT INTO public.report_tracked_items (business_id, item_type, item_key, label)
    SELECT B1, 'customer', id::TEXT, name FROM public.customers WHERE business_id = B1 AND name = 'Green Valley Hotel';
    INSERT INTO public.report_tracked_items (business_id, item_type, item_key, label)
    VALUES (B1, 'customer_type', 'institution', 'Institutions'), (B1, 'payment_terms', 'monthly', 'Monthly accounts');

    -- Website shoppers: logins linked to their customer records (shop opens on day 170)
    FOR r IN SELECT c.id, c.name, c.phone, c.email FROM public.customers c JOIN seed_cust sc ON sc.id = c.id
             WHERE c.business_id = B1 AND c.email LIKE '%@example.com' AND sc.join_d < d0 + 250 AND sc.last_d IS NULL
             ORDER BY sc.weight DESC, c.name LIMIT 12
    LOOP
        v_id := gen_random_uuid();
        v_join := GREATEST(d0 + 170, (SELECT join_d FROM seed_cust WHERE id = r.id)) + pg_temp.ri(0, 90);
        PERFORM pg_temp.mk_user(v_id, r.email, r.name, r.phone, TRUE, pg_temp.at(v_join, 19, 0));
        INSERT INTO public.customer_accounts (id, business_id, customer_id, name, phone, email, delivery_address,
            delivery_notes, delivery_zone_id, created_at, updated_at)
        SELECT v_id, B1, r.id, r.name, r.phone, r.email,
               pg_temp.pick(ARRAY['Hse 14, Argwings Kodhek Rd','Apt B4, Riara Rd','Ole Dume Rd, Gate 3',
                                  'Lenana Rd, Silver Court 2A','Kirichwa Rd, Hse 7','Gitanga Rd, Valley View Apts 3C']),
               CASE WHEN random() < 0.4 THEN 'Call on arrival' END,
               (SELECT id FROM public.delivery_zones WHERE business_id = B1 AND active ORDER BY random() LIMIT 1),
               pg_temp.at(v_join, 19, 0), pg_temp.at(v_join, 19, 0);
    END LOOP;
END $seed$;

-- =============================================================================
-- 2. Day-by-day history: restock, production, deliveries, sales, payments,
--    expenses, petty cash, transfers. Chronological, so stock and balances evolve.
-- =============================================================================
DO $history$
DECLARE
    B1 CONSTANT UUID := 'b1000000-0000-4000-8000-000000000001';
    B2 CONSTANT UUID := 'b2000000-0000-4000-8000-000000000002';
    today DATE := (now() AT TIME ZONE 'Africa/Nairobi')::DATE;
    d0 DATE := today - 365;
    d_faith DATE := d0 + 78;          -- afternoon cashier starts
    d_west  DATE := d0 + 182;         -- Westlands opens
    d_price DATE := d0 + 140;         -- milk price rise
    d_web   DATE := d0 + 170;         -- website shop goes live
    hours INT[] := ARRAY[6,7,7,7,7,8,8,8,8,8,9,9,9,9,10,10,10,11,11,11,12,12,12,12,13,13,13,13,14,14,14,
                         15,15,15,16,16,16,16,17,17,17,17,17,18,18,18,18,18,18,19,19,19,19,19,20,20,20];
    -- employees (ids are the user ids in the main branch)
    E_OWNER UUID := 'a0000000-0000-4000-8000-000000000001';
    E_MGR   UUID := 'a0000000-0000-4000-8000-000000000002';
    E_CASH1 UUID := 'a0000000-0000-4000-8000-000000000003';
    E_CASH2 UUID := 'a0000000-0000-4000-8000-000000000004';
    E_RIDER UUID := 'a0000000-0000-4000-8000-000000000005';
    E_STOCK UUID := 'a0000000-0000-4000-8000-000000000006';
    E_WEST  UUID := 'a0000000-0000-4000-8000-000000000007';
    E_OWNER2 UUID;
    d DATE; dow INT; n INT; k INT; h INT; ts TIMESTAMPTZ; v_ts TIMESTAMPTZ[];
    v_staff UUID; v_staff_name TEXT; v_cust RECORD; v_method TEXT; v_lines JSONB; v_tx UUID;
    v_fee NUMERIC; v_rider TEXT; v_note TEXT;
    f NUMERIC; prog NUMERIC; r RECORD; p RECORD; v_avg NUMERIC; v_target NUMERIC; v_qty NUMERIC;
    v_ref TEXT; v_amt NUMERIC; v_batch UUID; v_cnt INT;
    v_zone RECORD; v_cat TEXT; v_desc TEXT; v_order UUID; v_acc RECORD; v_status TEXT; v_sub NUMERIC;
    v_pdisc NUMERIC; v_total NUMERIC; v_receipt TEXT; v_ordnum BIGINT; v_transfer UUID;
    v_bulk UUID; v_tref TEXT; v_school_closed BOOLEAN; v_now TIMESTAMPTZ := now();
    v_cid UUID; v_cname TEXT; v_ckind TEXT; v_ccredit NUMERIC; v_cwallet NUMERIC;
    v_promo_id UUID; v_promo_code TEXT; v_k INT; i INT;
BEGIN
    SELECT id INTO E_OWNER2 FROM public.employees WHERE business_id = B2 AND user_id = E_OWNER;
    SELECT id INTO v_bulk FROM public.products WHERE business_id = B1 AND sku = 'KK-FM-BULK';

    FOR i IN 0..(today - d0) LOOP
        d := d0 + i;
        dow := extract(dow FROM d)::INT;     -- 0 = Sunday
        prog := (d - d0)::NUMERIC / 365;

        IF d = d_price THEN
            UPDATE public.products SET price = price + 5 WHERE business_id = B1 AND sku IN ('KK-FM-1000','KK-FM-BULK','KK-ML-500');
            UPDATE public.products SET price = price + 3 WHERE business_id = B1 AND sku = 'KK-FM-500';
            UPDATE public.products SET cost = cost + 3 WHERE business_id = B1 AND sku IN ('KK-FM-1000','KK-FM-BULK');
        END IF;

        -- ---------------------------------------------------------------- restock
        FOR r IN SELECT sp.*, pr.stock, pr.cost, pr.unit, pr.name
                 FROM seed_prod sp JOIN public.products pr ON pr.id = sp.id
                 WHERE (sp.biz = B1 OR (sp.biz = B2 AND d >= d_west))
                   AND sp.kind IN ('milk','bulk_only','dry')
                   AND (sp.biz = B1 OR sp.kind IN ('milk','bulk_only'))
                 ORDER BY sp.supplier, sp.sku
        LOOP
            SELECT COALESCE(SUM(qty), 0) / 7 INTO v_avg FROM seed_sold WHERE product_id = r.id AND seed_sold.sold_on BETWEEN d - 7 AND d - 1;
            v_target := GREATEST(r.base_target, ceil(v_avg * CASE r.kind WHEN 'dry' THEN 12 WHEN 'bulk_only' THEN 1.6 ELSE 1.5 END));
            IF (r.kind IN ('milk','bulk_only') AND r.stock < v_target * 0.95 AND NOT (dow = 0 AND r.supplier = 'Nairobi Bakers Ltd'))
               OR (r.kind = 'dry' AND ((dow = 2 AND r.stock < v_target * 0.6) OR r.stock < v_avg * 2))
            THEN
                -- Cheddar is left to run out over the last weeks (tests out-of-stock screens)
                CONTINUE WHEN r.sku = 'KK-CHD-200' AND d > today - 25;
                v_qty := ceil(v_target - r.stock);
                CONTINUE WHEN v_qty <= 0;
                ts := pg_temp.at(d, 5, pg_temp.ri(5, 50));
                v_ref := 'PO-' || to_char(d, 'YYMMDD') || '-' || upper(substr(md5(r.biz::TEXT || r.supplier), 1, 4));
                PERFORM pg_temp.adjust(r.id, 'Restock', v_qty, 'Delivery from ' || r.supplier,
                    CASE WHEN r.biz = B1 THEN 'Joseph Kiprono' ELSE 'Lucy Wambui' END, ts, v_ref);
                INSERT INTO seed_purchase_lines VALUES (r.biz, d, r.supplier, r.name, v_qty, r.unit, r.cost, ts, v_ref);
            END IF;
        END LOOP;

        -- ---------------------------------------------------------- production (main)
        FOR r IN SELECT sp.*, pr.stock, pr.name, pr.unit FROM seed_prod sp JOIN public.products pr ON pr.id = sp.id
                 WHERE sp.biz = B1 AND sp.kind = 'made' ORDER BY sp.sku
        LOOP
            SELECT COALESCE(SUM(qty), 0) / 7 INTO v_avg FROM seed_sold WHERE product_id = r.id AND seed_sold.sold_on BETWEEN d - 7 AND d - 1;
            v_target := GREATEST(r.base_target, ceil(v_avg * 4));
            IF (dow IN (1, 4) AND r.stock < v_target * 0.8) OR r.stock < v_avg * 1.2 THEN
                v_qty := ceil(v_target - r.stock);
                CONTINUE WHEN v_qty <= 0;
                ts := pg_temp.at(d, 6, pg_temp.ri(0, 50));
                -- make sure there is milk to make it from
                SELECT stock INTO v_amt FROM public.products WHERE id = v_bulk;
                IF v_amt < v_qty * r.milk_per_unit * 1.02 THEN
                    PERFORM pg_temp.adjust(v_bulk, 'Restock', ceil(v_qty * r.milk_per_unit * 1.02 - v_amt) + 20,
                        'Extra delivery for production', 'Joseph Kiprono', ts - interval '20 minutes');
                END IF;
                v_ref := 'PB-' || to_char(d, 'YYMMDD') || '-' || upper(substr(md5(r.id::TEXT || d::TEXT), 1, 4));
                INSERT INTO public.production_batches (business_id, recipe_id, recipe_name, quantity_produced, unit, status,
                    staff_name, date, product_id, bom_id, reference_number, created_at, updated_at)
                VALUES (B1, r.recipe_id, r.name, v_qty, r.unit, 'Completed', 'Joseph Kiprono', ts, r.id, r.bom_id, v_ref, ts, ts + interval '3 hours')
                RETURNING id INTO v_batch;
                PERFORM pg_temp.adjust(v_bulk, 'Production Consumption', -round(v_qty * r.milk_per_unit * 1.02, 2),
                    'Used for ' || r.name, 'Joseph Kiprono', ts, v_ref, v_batch);
                PERFORM pg_temp.adjust(r.id, 'Production Output', v_qty, 'Batch ' || v_ref, 'Joseph Kiprono',
                    ts + interval '3 hours', v_ref, v_batch);
                INSERT INTO seed_sold (product_id, sold_on, qty) VALUES (v_bulk, d, round(v_qty * r.milk_per_unit * 1.02, 2))
                ON CONFLICT (product_id, sold_on) DO UPDATE SET qty = seed_sold.qty + EXCLUDED.qty;
            END IF;
        END LOOP;

        -- --------------------------------------------- stock transfers to Westlands
        IF d >= d_west AND dow IN (1, 4) THEN
            ts := pg_temp.at(d, 9, pg_temp.ri(30, 59));
            v_tref := 'TR-' || to_char(d, 'YYMMDD') || '-' || upper(substr(md5(d::TEXT || 'tr'), 1, 5));
            INSERT INTO public.stock_transfers (reference, from_business_id, to_business_id, status, note, sent_by_name,
                sent_by_user_id, sent_at, received_by_name, received_at, created_at, updated_at, client_reference)
            VALUES (v_tref, B1, B2, 'received', CASE WHEN random() < 0.3 THEN 'Regular top-up' END, 'Joseph Kiprono',
                    E_STOCK, ts, 'Lucy Wambui', ts + interval '95 minutes', ts, ts + interval '95 minutes', 'seed-' || v_tref)
            RETURNING id INTO v_transfer;
            v_cnt := 0;
            FOR r IN SELECT w.id AS to_id, w.base_target, m.id AS from_id, pw.stock AS to_stock, pm.stock AS from_stock,
                            pm.name, pm.sku, pm.unit, pm.category, pm.cost, pm.price
                     FROM seed_prod w JOIN seed_prod m ON m.sku = w.sku AND m.biz = B1
                     JOIN public.products pw ON pw.id = w.id JOIN public.products pm ON pm.id = m.id
                     WHERE w.biz = B2 AND w.kind IN ('made','dry') ORDER BY pm.sku
            LOOP
                SELECT COALESCE(SUM(qty), 0) / 7 INTO v_avg FROM seed_sold WHERE product_id = r.to_id AND seed_sold.sold_on BETWEEN d - 7 AND d - 1;
                v_target := GREATEST(r.base_target, ceil(v_avg * 4.5));
                v_qty := LEAST(ceil(v_target - r.to_stock), floor(r.from_stock * 0.5));
                CONTINUE WHEN v_qty <= 0;
                v_cnt := v_cnt + 1;
                INSERT INTO public.stock_transfer_items (transfer_id, from_product_id, to_product_id, product_name, sku, unit,
                    category, unit_cost, unit_price, quantity_sent, quantity_received, created_at)
                VALUES (v_transfer, r.from_id, r.to_id, r.name, r.sku, r.unit, r.category, r.cost, r.price, v_qty,
                        CASE WHEN random() < 0.03 THEN v_qty - 1 ELSE v_qty END, ts);
                PERFORM pg_temp.adjust(r.from_id, 'Transfer Out', -v_qty, 'Sent to KayKay''s Milk Westlands', 'Joseph Kiprono', ts, v_tref);
                PERFORM pg_temp.adjust(r.to_id, 'Transfer In',
                    (SELECT quantity_received FROM public.stock_transfer_items WHERE transfer_id = v_transfer AND to_product_id = r.to_id),
                    'Received from KayKay''s Milk', 'Lucy Wambui', ts + interval '95 minutes', v_tref);
                INSERT INTO seed_sold (product_id, sold_on, qty) VALUES (r.from_id, d, v_qty)
                ON CONFLICT (product_id, sold_on) DO UPDATE SET qty = seed_sold.qty + EXCLUDED.qty;
            END LOOP;
            IF v_cnt = 0 THEN
                DELETE FROM public.stock_transfers WHERE id = v_transfer;
            END IF;
        END IF;

        -- -------------------------------------------------------- shifts (who works)
        IF dow = 0 THEN
            INSERT INTO seed_shift VALUES (E_MGR, B1, pg_temp.at(d, 6, pg_temp.ri(40, 55)), pg_temp.at(d, 19, pg_temp.ri(5, 30)));
        ELSE
            INSERT INTO seed_shift VALUES
                (E_CASH1, B1, pg_temp.at(d, 6, pg_temp.ri(15, 29)), pg_temp.at(d, 14, pg_temp.ri(30, 50))),
                (CASE WHEN d >= d_faith THEN E_CASH2 ELSE E_MGR END, B1, pg_temp.at(d, 13, pg_temp.ri(45, 59)), pg_temp.at(d, 21, pg_temp.ri(5, 25))),
                (E_RIDER, B1, pg_temp.at(d, 6, pg_temp.ri(10, 30)), pg_temp.at(d, 15, pg_temp.ri(0, 40))),
                (E_STOCK, B1, pg_temp.at(d, 5, pg_temp.ri(0, 15)), pg_temp.at(d, 13, pg_temp.ri(0, 30)));
            IF d >= d_faith AND dow <> 6 THEN
                INSERT INTO seed_shift VALUES (E_MGR, B1, pg_temp.at(d, 8, pg_temp.ri(45, 59)), pg_temp.at(d, 17, pg_temp.ri(0, 30)));
            END IF;
            IF d >= d_west THEN
                INSERT INTO seed_shift VALUES (E_WEST, B2, pg_temp.at(d, 6, pg_temp.ri(45, 59)), pg_temp.at(d, 19, pg_temp.ri(5, 20)));
            END IF;
        END IF;

        -- ------------------------------------------- institution deliveries (credit)
        v_school_closed := extract(month FROM d) IN (4, 8, 11, 12) OR (extract(month FROM d) = 1 AND extract(day FROM d) < 6);
        FOR v_cust IN SELECT * FROM seed_cust WHERE inst_litres IS NOT NULL AND join_d <= d AND dow = ANY(inst_days)
                        AND (biz = B1 OR d >= d_west) AND NOT (term_only AND v_school_closed) ORDER BY name
        LOOP
            ts := pg_temp.at(d, pg_temp.ri(6, 7), pg_temp.ri(0, 59));
            CONTINUE WHEN ts > v_now - interval '10 minutes';
            SELECT jsonb_build_array(jsonb_build_object('p', sp.id, 'q', LEAST(floor(pr.stock), round(v_cust.inst_litres * (0.8 + random() * 0.4)))))
                   || COALESCE((SELECT jsonb_agg(jsonb_build_object('p', x.id, 'q', pg_temp.ri(2, 6))) FROM (
                          SELECT sp2.id FROM seed_prod sp2 JOIN public.products p2 ON p2.id = sp2.id
                          WHERE sp2.biz = v_cust.biz AND sp2.kind IN ('made','milk') AND p2.stock >= 6
                          ORDER BY random() LIMIT CASE WHEN random() < 0.35 THEN 1 ELSE 0 END) x), '[]'::JSONB)
            INTO v_lines
            FROM seed_prod sp JOIN public.products pr ON pr.id = sp.id
            WHERE sp.biz = v_cust.biz AND sp.sku = 'KK-FM-BULK';
            IF v_cust.biz = B1 THEN
                v_staff := E_CASH1; v_staff_name := 'Brian Otieno';
                IF dow = 0 THEN v_staff := E_MGR; v_staff_name := 'Mercy Achieng'; END IF;
                v_rider := 'Peter Mwangi';
            ELSE
                v_staff := E_WEST; v_staff_name := 'Lucy Wambui'; v_rider := NULL;
            END IF;
            PERFORM pg_temp.sale(v_cust.biz, ts, v_staff, v_staff_name, v_cust.id, v_cust.name, 'Credit_Debt', v_lines,
                                 0, v_rider, 'Standing order');
        END LOOP;

        -- --------------------------------------------- institution payments on terms
        FOR v_cust IN SELECT sc.*, c.debt_balance FROM seed_cust sc JOIN public.customers c ON c.id = sc.id
                      WHERE sc.inst_litres IS NOT NULL AND c.debt_balance > 0
                        AND ((sc.terms = 'weekly' AND dow = 1) OR (sc.terms = 'monthly' AND extract(day FROM d) = 5))
        LOOP
            ts := pg_temp.at(d, pg_temp.ri(9, 11), pg_temp.ri(0, 59));
            CONTINUE WHEN ts > v_now;
            v_amt := round(v_cust.debt_balance * CASE WHEN v_cust.pay_ratio < 1 THEN v_cust.pay_ratio + random() * 0.15 ELSE 1 END);
            v_amt := LEAST(v_amt, v_cust.debt_balance);
            CONTINUE WHEN v_amt <= 0;
            v_method := CASE WHEN v_cust.terms = 'monthly' THEN 'Bank' WHEN random() < 0.8 THEN 'M-Pesa' ELSE 'Bank' END;
            PERFORM public.process_business_payment(v_cust.biz,
                CASE WHEN v_method = 'M-Pesa' THEN pg_temp.mpesa_code() ELSE 'BNK-' || to_char(d, 'YYMMDD') || '-' || upper(substr(md5(random()::TEXT), 1, 5)) END,
                v_amt, v_method, v_cust.name, NULL, 'Success', ts, v_cust.id, v_cust.name, 'customer',
                CASE WHEN v_cust.terms = 'monthly' THEN to_char(d - 10, 'FMMonth') || ' account' ELSE 'Weekly account' END,
                CASE WHEN v_cust.biz = B1 THEN 'Mercy Achieng' ELSE 'Lucy Wambui' END);
            PERFORM pg_temp.stamp(ts);
        END LOOP;

        -- ------------------------------------------------------------- till sales
        FOR k IN 1..2 LOOP
            CONTINUE WHEN k = 2 AND (d < d_west OR dow = 0);
            IF k = 1 THEN
                f := (22 + 18 * prog)
                     * CASE dow WHEN 6 THEN 1.3 WHEN 0 THEN 1.1 WHEN 1 THEN 0.95 ELSE 1 END
                     * CASE WHEN extract(month FROM d) = 12 AND extract(day FROM d) >= 15 THEN 1.25
                            WHEN extract(month FROM d) = 1 AND extract(day FROM d) <= 12 THEN 0.82
                            WHEN extract(month FROM d) IN (4, 5) THEN 0.92 ELSE 1 END
                     * (0.82 + random() * 0.36);
            ELSE
                f := LEAST(16, 5 + 11 * ((d - d_west)::NUMERIC / 150)) * CASE dow WHEN 6 THEN 1.25 ELSE 1 END * (0.8 + random() * 0.4);
            END IF;
            n := round(f);

            SELECT array_agg(t ORDER BY t) INTO v_ts FROM (
                SELECT pg_temp.at(d, hh, CASE WHEN hh = 6 THEN pg_temp.ri(30, 59) ELSE pg_temp.ri(0, 59) END) AS t
                FROM (SELECT hours[1 + floor(random() * array_length(hours, 1))::INT] AS hh FROM generate_series(1, n)) g
                WHERE NOT (dow = 0 AND (hh < 7 OR hh >= 19)) AND NOT (k = 2 AND (hh < 7 OR hh >= 19))
            ) s WHERE t < v_now - interval '3 minutes';

            CONTINUE WHEN v_ts IS NULL;
            FOREACH ts IN ARRAY v_ts LOOP
                h := extract(hour FROM ts AT TIME ZONE 'Africa/Nairobi')::INT;
                IF k = 2 THEN
                    IF random() < 0.04 THEN v_staff := E_OWNER2; v_staff_name := 'Kevin Kamau';
                    ELSE v_staff := E_WEST; v_staff_name := 'Lucy Wambui'; END IF;
                ELSIF dow = 0 THEN
                    v_staff := E_MGR; v_staff_name := 'Mercy Achieng';
                ELSIF random() < 0.02 THEN
                    v_staff := E_OWNER; v_staff_name := 'Kevin Kamau';
                ELSIF h < 14 THEN
                    IF d >= d_faith AND h >= 9 AND random() < 0.06 THEN v_staff := E_MGR; v_staff_name := 'Mercy Achieng';
                    ELSE v_staff := E_CASH1; v_staff_name := 'Brian Otieno'; END IF;
                ELSIF d >= d_faith THEN
                    v_staff := E_CASH2; v_staff_name := 'Faith Njeri';
                ELSE
                    v_staff := E_MGR; v_staff_name := 'Mercy Achieng';
                END IF;

                v_lines := pg_temp.basket(CASE k WHEN 1 THEN B1 ELSE B2 END,
                    (ARRAY[1,1,1,1,2,2,2,3,3,4])[1 + floor(random() * 10)::INT]);
                CONTINUE WHEN v_lines IS NULL;

                v_fee := 0; v_rider := NULL; v_note := NULL;
                v_cid := NULL; v_cname := NULL; v_ckind := NULL; v_ccredit := 0; v_cwallet := 0;
                IF random() < (CASE k WHEN 1 THEN 0.5 ELSE 0.35 END) THEN
                    SELECT sc.id, sc.name, sc.kind, sc.credit_p, c.wallet_balance
                    INTO v_cid, v_cname, v_ckind, v_ccredit, v_cwallet
                    FROM seed_cust sc JOIN public.customers c ON c.id = sc.id
                    WHERE sc.biz = CASE k WHEN 1 THEN B1 ELSE B2 END AND sc.inst_litres IS NULL
                      AND sc.join_d <= d AND (sc.last_d IS NULL OR sc.last_d >= d)
                    ORDER BY -ln(1 - random()) / sc.weight LIMIT 1;
                END IF;

                IF v_cid IS NOT NULL AND (
                       (v_ckind = 'wallet' AND (v_cwallet > 0 OR random() < 0.3))
                       OR random() < v_ccredit) THEN
                    v_method := 'Credit_Debt';
                ELSE
                    v_method := CASE WHEN random() < 0.44 THEN 'Cash' WHEN random() < 0.9 THEN 'M-Pesa'
                                     WHEN random() < 0.75 THEN 'Card' ELSE 'Bank' END;
                END IF;

                IF k = 1 AND v_cid IS NOT NULL AND random() < 0.08 THEN
                    SELECT name, fee INTO v_zone FROM public.delivery_zones WHERE business_id = B1 AND active ORDER BY random() LIMIT 1;
                    v_fee := v_zone.fee; v_rider := 'Peter Mwangi'; v_note := 'Deliver to ' || v_zone.name;
                END IF;

                PERFORM pg_temp.sale(CASE k WHEN 1 THEN B1 ELSE B2 END, ts, v_staff, v_staff_name,
                    v_cid, v_cname, v_method, v_lines, v_fee, v_rider, v_note);
            END LOOP;
        END LOOP;

        -- --------------------------------------------- website orders (main branch)
        IF d >= d_web THEN
            FOR k IN 1..(CASE WHEN random() < 0.25 + 0.5 * prog THEN pg_temp.ri(1, 3) ELSE 0 END) LOOP
                ts := pg_temp.at(d, pg_temp.ri(6, 21), pg_temp.ri(0, 59));
                CONTINUE WHEN ts > v_now - interval '5 minutes';
                SELECT a.id, a.name, a.phone, a.customer_id, a.delivery_address, z.name AS zone, z.fee INTO v_acc
                FROM public.customer_accounts a LEFT JOIN public.delivery_zones z ON z.id = a.delivery_zone_id
                WHERE a.business_id = B1 AND a.created_at <= ts ORDER BY random() LIMIT 1;
                CONTINUE WHEN v_acc.id IS NULL;
                v_lines := pg_temp.basket(B1, pg_temp.ri(1, 4), TRUE);
                CONTINUE WHEN v_lines IS NULL;
                SELECT SUM(pr.price * (l->>'q')::NUMERIC) INTO v_sub FROM jsonb_array_elements(v_lines) l
                JOIN public.products pr ON pr.id = (l->>'p')::UUID;
                v_fee := CASE WHEN random() < 0.75 THEN COALESCE(v_acc.fee, 150) ELSE 0 END;
                v_promo_id := NULL; v_promo_code := NULL; v_pdisc := 0;
                IF NOT EXISTS (SELECT 1 FROM public.online_orders o WHERE o.account_id = v_acc.id) THEN
                    SELECT id, code INTO v_promo_id, v_promo_code FROM public.website_promo_codes WHERE business_id = B1 AND code = 'KARIBU10';
                    v_pdisc := round(v_sub * 0.10);
                ELSIF v_sub >= 500 AND d >= d0 + 200 AND random() < 0.2 THEN
                    SELECT id, code INTO v_promo_id, v_promo_code FROM public.website_promo_codes WHERE business_id = B1 AND code = 'MILK50';
                    v_pdisc := 50;
                END IF;
                v_total := v_sub - v_pdisc + v_fee;
                v_status := CASE
                    WHEN ts > v_now - interval '40 minutes' THEN pg_temp.pick(ARRAY['paid','pending_payment'])
                    WHEN ts > v_now - interval '3 hours' THEN pg_temp.pick(ARRAY['preparing', CASE WHEN v_fee > 0 THEN 'out_for_delivery' ELSE 'ready_for_pickup' END])
                    WHEN random() < 0.06 THEN 'cancelled'
                    WHEN random() < 0.04 THEN 'payment_failed'
                    ELSE 'completed' END;
                v_order := gen_random_uuid();
                v_receipt := CASE WHEN v_status IN ('paid','preparing','out_for_delivery','ready_for_pickup','completed') THEN pg_temp.mpesa_code() END;
                INSERT INTO public.online_orders (id, business_id, account_id, customer_name, customer_phone, status, fulfilment,
                    delivery_address, delivery_zone, notes, subtotal, delivery_fee, discount, total, mpesa_receipt, paid_at,
                    created_at, updated_at, rider_id, rider_assigned_at, delivered_at, promo_code_id, promo_code, promo_value,
                    payment_method, payment_reference)
                VALUES (v_order, B1, v_acc.id, v_acc.name, v_acc.phone, v_status,
                    CASE WHEN v_fee > 0 THEN 'delivery' ELSE 'pickup' END,
                    CASE WHEN v_fee > 0 THEN COALESCE(v_acc.delivery_address, 'Gate B, ' || COALESCE(v_acc.zone, 'Kilimani')) END,
                    CASE WHEN v_fee > 0 THEN COALESCE(v_acc.zone, 'Kilimani') END,
                    CASE WHEN random() < 0.2 THEN pg_temp.pick(ARRAY['Call when at the gate','Leave with the guard','Please bring change for 1000','Ring the bell twice']) END,
                    v_sub, v_fee, v_pdisc, v_total, v_receipt,
                    CASE WHEN v_receipt IS NOT NULL THEN ts + interval '1 minute' END,
                    ts, ts + interval '2 hours',
                    CASE WHEN v_fee > 0 AND v_status IN ('out_for_delivery','completed') THEN E_RIDER END,
                    CASE WHEN v_fee > 0 AND v_status IN ('out_for_delivery','completed') THEN ts + interval '25 minutes' END,
                    CASE WHEN v_fee > 0 AND v_status = 'completed' THEN ts + interval '70 minutes' END,
                    v_promo_id, v_promo_code, v_pdisc,
                    CASE WHEN v_status <> 'pending_payment' THEN 'M-Pesa' END, v_receipt);
                INSERT INTO public.online_order_items (order_id, product_id, product_name, unit, unit_price, quantity, line_total)
                SELECT v_order, pr.id, pr.name, pr.unit, pr.price, (l->>'q')::NUMERIC, pr.price * (l->>'q')::NUMERIC
                FROM jsonb_array_elements(v_lines) l JOIN public.products pr ON pr.id = (l->>'p')::UUID;

                IF v_status <> 'pending_payment' AND v_status <> 'cancelled' OR (v_status = 'cancelled' AND random() < 0.5) THEN
                    INSERT INTO public.mpesa_transactions (business_id, checkout_request_id, merchant_request_id, phone, amount,
                        status, receipt_number, mpesa_receipt_timestamp, online_order_id, customer_id, account_reference,
                        description, created_at, updated_at)
                    VALUES (B1, 'ws_CO_' || to_char(ts, 'DDMMYYYYHH24MISS') || substr(md5(random()::TEXT), 1, 6),
                        substr(md5(random()::TEXT), 1, 5) || '-' || substr(md5(random()::TEXT), 1, 8),
                        replace(v_acc.phone, '+', ''), v_total,
                        CASE WHEN v_receipt IS NOT NULL THEN 'Completed' ELSE 'Failed' END::public.mpesa_status,
                        v_receipt, CASE WHEN v_receipt IS NOT NULL THEN ts + interval '1 minute' END,
                        v_order, v_acc.customer_id, 'Order', 'Online order', ts, ts + interval '1 minute');
                END IF;

                IF v_receipt IS NOT NULL THEN
                    SELECT order_number INTO v_ordnum FROM public.online_orders WHERE id = v_order;
                    v_tx := pg_temp.sale(B1, ts + interval '1 minute', NULL, 'Website', v_acc.customer_id, v_acc.name, 'M-Pesa',
                        v_lines, v_fee, CASE WHEN v_fee > 0 THEN 'Peter Mwangi' END,
                        'Online order #' || v_ordnum || ', M-Pesa ' || v_receipt, 'online-' || v_order, v_pdisc);
                    UPDATE public.online_orders SET transaction_id = v_tx WHERE id = v_order;
                    UPDATE public.mpesa_transactions SET transaction_id = v_tx WHERE online_order_id = v_order AND status = 'Completed';
                    INSERT INTO public.customer_messages (business_id, account_id, sender, body, order_id, created_at, read_at)
                    VALUES (B1, v_acc.id, 'system', 'We received your payment for order #' || v_ordnum || '. M-Pesa receipt: ' || v_receipt || '.', v_order, ts + interval '1 minute', ts + interval '5 minutes');
                    IF v_status IN ('out_for_delivery','completed') AND v_fee > 0 THEN
                        INSERT INTO public.customer_messages (business_id, account_id, sender, body, order_id, created_at, read_at)
                        VALUES (B1, v_acc.id, 'system', 'Order #' || v_ordnum || ' is on its way.', v_order, ts + interval '25 minutes', ts + interval '30 minutes');
                    END IF;
                    IF v_status = 'completed' THEN
                        INSERT INTO public.customer_messages (business_id, account_id, sender, body, order_id, created_at, read_at)
                        VALUES (B1, v_acc.id, 'system', 'Order #' || v_ordnum || ' is complete. Thank you!', v_order, ts + interval '70 minutes', ts + interval '3 hours');
                        -- some customers leave a review
                        IF random() < 0.22 THEN
                            v_k := pg_temp.ri(1, 100);
                            INSERT INTO public.website_reviews (business_id, account_id, product_id, rating, title, body, display_name,
                                verified, status, featured, staff_reply, replied_by, replied_at, created_at, updated_at)
                            SELECT B1, v_acc.id, (v_lines->0->>'p')::UUID,
                                CASE WHEN v_k <= 62 THEN 5 WHEN v_k <= 88 THEN 4 WHEN v_k <= 95 THEN 3 WHEN v_k <= 98 THEN 2 ELSE 1 END,
                                CASE WHEN v_k <= 62 THEN pg_temp.pick(ARRAY['Best milk in Nairobi','Fresh every time','Love it','Kids finish it in a day'])
                                     WHEN v_k <= 88 THEN pg_temp.pick(ARRAY['Very good','Good value','Tasty'])
                                     WHEN v_k <= 95 THEN 'Okay' ELSE 'Disappointed' END,
                                CASE WHEN v_k <= 62 THEN pg_temp.pick(ARRAY['Arrived cold and fresh. The rider was on time and polite.',
                                        'Thick, creamy and tastes like milk from shags. We have switched completely.',
                                        'I order every week and it has never been sour. Highly recommend.',
                                        'The strawberry yoghurt is the kids'' favourite. Delivery was quick.'])
                                     WHEN v_k <= 88 THEN pg_temp.pick(ARRAY['Good quality, delivery took a bit longer than expected.',
                                        'Nice and fresh. Would like bigger packs.', 'Tastes great, price is fair.'])
                                     WHEN v_k <= 95 THEN 'The milk was fine but the packet was leaking slightly.'
                                     ELSE 'Delivery was two hours late and the yoghurt was warm.' END,
                                split_part(v_acc.name, ' ', 1) || ' ' || left(split_part(v_acc.name, ' ', 2), 1) || '.',
                                TRUE,
                                CASE WHEN ts > v_now - interval '4 days' THEN 'pending' WHEN v_k = 100 THEN 'hidden' ELSE 'approved' END,
                                v_k <= 4,
                                CASE WHEN v_k > 88 THEN 'Sorry about this. We have spoken to the team and sent you a voucher.'
                                     WHEN random() < 0.25 THEN 'Asante! Glad you enjoy it.' END,
                                CASE WHEN v_k > 88 OR random() < 0.25 THEN 'Mercy Achieng' END,
                                CASE WHEN v_k > 88 THEN ts + interval '1 day' END,
                                ts + interval '1 day', ts + interval '1 day'
                            ON CONFLICT DO NOTHING;   -- one review per customer per product
                        END IF;
                    END IF;
                ELSIF v_status = 'payment_failed' THEN
                    INSERT INTO public.customer_messages (business_id, account_id, sender, body, order_id, created_at)
                    VALUES (B1, v_acc.id, 'system', 'The M-Pesa payment did not go through. You can try again from your orders.', v_order, ts + interval '2 minutes');
                END IF;
            END LOOP;
        END IF;

        -- ------------------------------------------------ individual debt payments
        FOR v_cust IN SELECT c.id, c.name, c.business_id, c.debt_balance, sc.kind FROM public.customers c
                      JOIN seed_cust sc ON sc.id = c.id
                      WHERE c.debt_balance > 0 AND sc.inst_litres IS NULL AND (c.business_id = B1 OR d >= d_west)
                      ORDER BY c.name
        LOOP
            CONTINUE WHEN random() > CASE WHEN v_cust.kind = 'wallet' THEN 0.12 ELSE 0.16 END;
            ts := pg_temp.at(d, pg_temp.ri(17, 20), pg_temp.ri(0, 59));
            CONTINUE WHEN ts > v_now;
            v_method := CASE WHEN random() < 0.65 THEN 'M-Pesa' ELSE 'Cash' END;
            IF v_cust.kind = 'wallet' THEN
                -- tops up the wallet: clears the debt first, the rest stays as credit
                v_amt := (ARRAY[1000, 1500, 2000, 2000, 3000, 5000])[pg_temp.ri(1, 6)];
                v_amt := GREATEST(v_amt, ceil(v_cust.debt_balance / 500) * 500);
            ELSE
                v_amt := CASE WHEN random() < 0.7 THEN v_cust.debt_balance ELSE round(v_cust.debt_balance / 2) END;
            END IF;
            CONTINUE WHEN v_amt <= 0;
            IF v_cust.kind <> 'wallet' AND random() < 0.25 THEN
                -- recorded from the customer's page (Customers > Pay debt)
                PERFORM public.process_debt_payment(v_cust.business_id, v_cust.id, LEAST(v_amt, v_cust.debt_balance), v_method,
                    CASE WHEN v_cust.business_id = B1 THEN CASE WHEN d >= d_faith THEN 'Faith Njeri' ELSE 'Mercy Achieng' END ELSE 'Lucy Wambui' END,
                    NULL, 'debt-' || to_char(ts, 'YYMMDDHH24MI') || '-' || substr(md5(random()::TEXT), 1, 6));
            ELSE
                PERFORM public.process_business_payment(v_cust.business_id,
                    CASE WHEN v_method = 'M-Pesa' THEN pg_temp.mpesa_code() ELSE 'CSH-' || to_char(ts, 'YYMMDDHH24MI') || '-' || upper(substr(md5(random()::TEXT), 1, 4)) END,
                    v_amt, v_method, v_cust.name, NULL, 'Success', ts, v_cust.id, v_cust.name, 'customer',
                    CASE WHEN v_cust.kind = 'wallet' THEN 'Wallet top-up' ELSE 'Paid towards balance' END,
                    CASE WHEN v_cust.business_id = B1 THEN CASE WHEN d >= d_faith THEN 'Faith Njeri' ELSE 'Mercy Achieng' END ELSE 'Lucy Wambui' END);
            END IF;
            PERFORM pg_temp.stamp(ts);
        END LOOP;

        -- Wallet customers with an empty wallet and no debt top up now and then
        FOR v_cust IN SELECT c.id, c.name FROM public.customers c JOIN seed_cust sc ON sc.id = c.id
                      WHERE sc.kind = 'wallet' AND sc.join_d <= d AND c.wallet_balance < 200 AND c.debt_balance = 0
                        AND (sc.last_d IS NULL OR sc.last_d >= d)
        LOOP
            CONTINUE WHEN random() > 0.08;
            ts := pg_temp.at(d, pg_temp.ri(8, 19), pg_temp.ri(0, 59));
            CONTINUE WHEN ts > v_now;
            IF random() < 0.8 THEN
                PERFORM public.process_business_payment(B1, pg_temp.mpesa_code(), (ARRAY[1000, 2000, 3000, 5000])[pg_temp.ri(1, 4)],
                    'M-Pesa', v_cust.name, NULL, 'Success', ts, v_cust.id, v_cust.name, 'customer', 'Wallet top-up', 'Brian Otieno');
            ELSE
                PERFORM public.process_wallet_topup(B1, v_cust.id, (ARRAY[500, 1000, 2000])[pg_temp.ri(1, 3)], 'Brian Otieno',
                    'Cash top-up at the till', 'topup-' || to_char(ts, 'YYMMDDHH24MI') || '-' || substr(md5(random()::TEXT), 1, 6));
            END IF;
            PERFORM pg_temp.stamp(ts);
        END LOOP;

        -- Saturday: points taken off what a customer owes
        IF dow = 6 THEN
            FOR v_cust IN SELECT c.id FROM public.customers c
                          WHERE c.business_id = B1 AND c.debt_balance > 50 AND c.loyalty_points >= 3000
                          ORDER BY random() LIMIT 2
            LOOP
                ts := pg_temp.at(d, 16, pg_temp.ri(0, 59));
                CONTINUE WHEN ts > v_now;
                PERFORM public.redeem_customer_points(v_cust.id, (SELECT LEAST(loyalty_points, 20000) FROM public.customers WHERE id = v_cust.id),
                    CASE WHEN d >= d_faith THEN 'Faith Njeri' ELSE 'Mercy Achieng' END);
                PERFORM pg_temp.stamp(ts);
            END LOOP;
        END IF;

        -- ------------------------------------------------------------- expenses
        IF extract(day FROM d) = 1 THEN
            INSERT INTO seed_exp VALUES (B1, 'Rent', 45000, 'Shop rent – ' || to_char(d, 'FMMonth YYYY'), 'Bank', pg_temp.at(d, 9, 15), 'Kevin Kamau', 'RENT-' || to_char(d, 'YYMM'));
            IF d >= d_west THEN
                INSERT INTO seed_exp VALUES (B2, 'Rent', 28000, 'Shop rent – ' || to_char(d, 'FMMonth YYYY'), 'M-Pesa', pg_temp.at(d, 9, 30), 'Kevin Kamau', 'RENT-W-' || to_char(d, 'YYMM'));
            END IF;
        END IF;
        IF extract(day FROM d) = 28 THEN
            INSERT INTO seed_exp VALUES
                (B1, 'Wages', 32000, to_char(d, 'FMMonth') || ' wages – Mercy Achieng', 'M-Pesa', pg_temp.at(d, 17, 0), 'Kevin Kamau', NULL),
                (B1, 'Wages', 18000, to_char(d, 'FMMonth') || ' wages – Brian Otieno', 'M-Pesa', pg_temp.at(d, 17, 2), 'Kevin Kamau', NULL),
                (B1, 'Wages', 16000, to_char(d, 'FMMonth') || ' wages – Peter Mwangi', 'M-Pesa', pg_temp.at(d, 17, 4), 'Kevin Kamau', NULL),
                (B1, 'Wages', 20000, to_char(d, 'FMMonth') || ' wages – Joseph Kiprono', 'M-Pesa', pg_temp.at(d, 17, 6), 'Kevin Kamau', NULL);
            IF d >= d_faith THEN
                INSERT INTO seed_exp VALUES (B1, 'Wages', 18000, to_char(d, 'FMMonth') || ' wages – Faith Njeri', 'M-Pesa', pg_temp.at(d, 17, 8), 'Kevin Kamau', NULL);
            END IF;
            IF d >= d_west THEN
                INSERT INTO seed_exp VALUES (B2, 'Wages', 17000, to_char(d, 'FMMonth') || ' wages – Lucy Wambui', 'M-Pesa', pg_temp.at(d, 17, 10), 'Kevin Kamau', NULL);
            END IF;
        END IF;
        IF extract(day FROM d) = 10 THEN
            INSERT INTO seed_exp VALUES (B1, 'Utilities', pg_temp.ri(65, 95) * 100, 'KPLC electricity tokens (fridges + milk ATM)', 'M-Pesa', pg_temp.at(d, 10, 20), 'Mercy Achieng', NULL);
            IF d >= d_west THEN
                INSERT INTO seed_exp VALUES (B2, 'Utilities', pg_temp.ri(25, 40) * 100, 'KPLC electricity tokens', 'M-Pesa', pg_temp.at(d, 10, 40), 'Lucy Wambui', NULL);
            END IF;
        END IF;
        IF extract(day FROM d) = 12 THEN
            INSERT INTO seed_exp VALUES (B1, 'Utilities', pg_temp.ri(12, 19) * 100, 'Nairobi Water bill', 'M-Pesa', pg_temp.at(d, 11, 0), 'Mercy Achieng', NULL),
                                        (B1, 'Utilities', 2999, 'Internet (Safaricom Home Fibre)', 'M-Pesa', pg_temp.at(d, 11, 5), 'Mercy Achieng', NULL);
        END IF;
        IF extract(day FROM d) = 15 THEN
            INSERT INTO seed_exp VALUES (B1, 'Marketing', pg_temp.ri(20, 60) * 100, 'Facebook & Instagram ads', 'Card', pg_temp.at(d, 20, 0), 'Kevin Kamau', NULL);
        END IF;
        IF dow = 3 THEN
            INSERT INTO seed_exp VALUES (B1, 'Transport', pg_temp.ri(18, 26) * 100, 'Fuel – delivery motorbike', 'Cash', pg_temp.at(d, 7, 30), 'Peter Mwangi', NULL);
        END IF;
        IF dow = 5 AND extract(week FROM d)::INT % 2 = 0 THEN
            INSERT INTO seed_exp VALUES (B1, 'Supplies', pg_temp.ri(15, 40) * 100, pg_temp.pick(ARRAY['Milk packets and sealing film','Yoghurt cups and lids','Starter culture and sugar','Carrier bags']), 'M-Pesa', pg_temp.at(d, 12, 0), 'Joseph Kiprono', NULL);
        END IF;
        IF random() < 0.025 THEN
            INSERT INTO seed_exp VALUES (B1, 'Maintenance', pg_temp.ri(15, 120) * 100, pg_temp.pick(ARRAY['Fridge compressor service','Milk ATM pump repair','Generator service','Motorbike service and tyres','Plumbing – shop sink']), 'Cash', pg_temp.at(d, 14, 0), 'Mercy Achieng', NULL);
        END IF;
        IF extract(day FROM d) = 20 AND extract(month FROM d)::INT % 3 = 0 THEN
            INSERT INTO seed_exp VALUES (B1, 'Other', 10000, 'County business permit (quarterly instalment)', 'Bank', pg_temp.at(d, 10, 0), 'Kevin Kamau', 'PERMIT-' || to_char(d, 'YYMM'));
        END IF;

        -- petty cash, a few times a week
        FOR k IN 1..(CASE WHEN random() < 0.55 THEN pg_temp.ri(1, 2) ELSE 0 END) LOOP
            v_cat := pg_temp.pick(ARRAY['Transport','Transport','Cleaning','Food & tea','Food & tea','Repairs','Supplies','Airtime','Other']);
            v_desc := CASE v_cat
                WHEN 'Transport' THEN pg_temp.pick(ARRAY['Boda to the bank','Matatu fare to buy packets','Boda for urgent delivery'])
                WHEN 'Cleaning' THEN pg_temp.pick(ARRAY['Detergent and jik','Mop and bucket','Hand soap'])
                WHEN 'Food & tea' THEN pg_temp.pick(ARRAY['Tea and mandazi for staff','Lunch for stocktake team','Sugar for staff tea'])
                WHEN 'Repairs' THEN pg_temp.pick(ARRAY['Fixed door hinge','New padlock','Bulb for the store'])
                WHEN 'Supplies' THEN pg_temp.pick(ARRAY['Receipt paper rolls','Marker pens and tape','Price stickers'])
                WHEN 'Airtime' THEN 'Airtime for customer calls'
                ELSE pg_temp.pick(ARRAY['Water for the shop','Photocopies','Tip for guard']) END;
            INSERT INTO seed_exp VALUES (B1, v_cat,
                CASE v_cat WHEN 'Repairs' THEN pg_temp.ri(3, 15) * 100 WHEN 'Food & tea' THEN pg_temp.ri(10, 35) * 10 ELSE pg_temp.ri(10, 60) * 10 END,
                v_desc, 'Cash', pg_temp.at(d, pg_temp.ri(8, 18), pg_temp.ri(0, 59)),
                CASE WHEN dow = 0 THEN 'Mercy Achieng' WHEN random() < 0.5 THEN 'Brian Otieno' WHEN d >= d_faith THEN 'Faith Njeri' ELSE 'Mercy Achieng' END,
                'petty');
        END LOOP;

        FOR r IN SELECT * FROM seed_exp WHERE happened_at <= v_now ORDER BY happened_at LOOP
            INSERT INTO public.expenses (business_id, category_id, category, amount, description, date, staff_name, receipt_ref,
                payment_method, source, employee_id, reference_id, created_at, updated_at, last_modified_by)
            SELECT r.biz, ec.id, r.category, r.amount, r.descr, r.happened_at, r.staff,
                   CASE WHEN r.ref = 'petty' THEN CASE WHEN random() < 0.4 THEN 'RCT-' || pg_temp.ri(1000, 9999) END ELSE r.ref END,
                   r.method, CASE WHEN r.ref = 'petty' THEN 'petty_cash' ELSE 'expense' END,
                   (SELECT e.id FROM public.employees e WHERE e.business_id = r.biz AND e.name = r.staff LIMIT 1),
                   CASE WHEN r.ref = 'petty' THEN 'petty-' || substr(md5(random()::TEXT), 1, 12) END,
                   r.happened_at, r.happened_at, r.staff
            FROM (SELECT 1) one
            LEFT JOIN public.expense_categories ec ON ec.business_id = r.biz AND ec.name = r.category AND r.ref IS DISTINCT FROM 'petty';
            PERFORM pg_temp.stamp(r.happened_at);
        END LOOP;
        DELETE FROM seed_exp;

        -- Expired or damaged stock now and then
        IF random() < 0.18 AND d < today THEN
            SELECT sp.id, pr.stock INTO r FROM seed_prod sp JOIN public.products pr ON pr.id = sp.id
            WHERE sp.biz = B1 AND pr.perishable AND pr.stock >= 3 ORDER BY random() LIMIT 1;
            IF r.id IS NOT NULL THEN
                PERFORM pg_temp.adjust(r.id, 'Damage', -pg_temp.ri(1, LEAST(4, floor(r.stock)::INT)),
                    pg_temp.pick(ARRAY['Expired','Packet burst','Dropped','Went sour – fridge door left open']),
                    'Joseph Kiprono', pg_temp.at(d, 20, 30));
            END IF;
        END IF;
        -- monthly stock count corrections
        IF extract(day FROM d) = 1 THEN
            FOR r IN SELECT sp.id, pr.stock FROM seed_prod sp JOIN public.products pr ON pr.id = sp.id
                     WHERE sp.biz = B1 AND sp.kind = 'dry' AND pr.stock >= 4 ORDER BY random() LIMIT 2 LOOP
                PERFORM pg_temp.adjust(r.id, 'Reconciliation', (ARRAY[-2,-1,-1,1])[pg_temp.ri(1, 4)], 'Monthly stock count',
                    'Joseph Kiprono', pg_temp.at(d, 20, 45), 'COUNT-' || to_char(d, 'YYMM'));
            END LOOP;
        END IF;

        -- whatever notifications the day's triggers raised (low stock, etc.) get an evening time
        PERFORM pg_temp.stamp(LEAST(pg_temp.at(d, 21, 15), v_now - interval '1 minute'));
        PERFORM pg_temp.stamp_sales(d);
        COMMIT;
    END LOOP;

    -- Purchases: one per supplier per delivery
    CREATE TEMP TABLE seed_po ON COMMIT DROP AS
        SELECT gen_random_uuid() AS id, biz, ref, supplier, SUM(qty * cost) AS total, MIN(happened_at) AS happened_at
        FROM seed_purchase_lines GROUP BY biz, ref, supplier;
    INSERT INTO public.purchases (id, business_id, supplier_name, total_amount, status, date, created_at, updated_at)
    SELECT id, biz, supplier, total, 'Received', happened_at, happened_at, happened_at FROM seed_po;
    INSERT INTO public.purchase_items (purchase_id, name, quantity, unit, price, created_at)
    SELECT po.id, l.name, l.qty, l.unit, l.cost, l.happened_at
    FROM seed_purchase_lines l JOIN seed_po po ON po.ref = l.ref AND po.biz = l.biz;
    -- orders not delivered yet
    INSERT INTO public.purchases (business_id, supplier_name, total_amount, status, date, created_at, updated_at) VALUES
      ('b1000000-0000-4000-8000-000000000001', 'PackRight Supplies', 18500, 'Ordered', now() - interval '2 days', now() - interval '2 days', now() - interval '2 days'),
      ('b1000000-0000-4000-8000-000000000001', 'Sweet Valley Honey', 7800, 'Pending', now() - interval '5 hours', now() - interval '5 hours', now() - interval '5 hours'),
      ('b1000000-0000-4000-8000-000000000001', 'Limuru Fresh Farms', 12400, 'Cancelled', now() - interval '20 days', now() - interval '20 days', now() - interval '19 days');

    -- Shifts, with totals from the sales made during them; today's open shifts stay Active
    INSERT INTO public.shifts (business_id, employee_id, start_time, end_time, sales_count, sales_total, status, created_at, updated_at, last_modified_by)
    SELECT s.biz, e.id, s.s, CASE WHEN s.e > now() THEN NULL ELSE s.e END,
           COALESCE(t.cnt, 0), COALESCE(t.total, 0),
           CASE WHEN s.e > now() THEN 'Active' ELSE 'Closed' END::public.shift_status, s.s, LEAST(s.e, now()), e.name
    FROM seed_shift s
    JOIN public.employees e ON e.business_id = s.biz AND (e.id = s.emp OR (e.user_id = s.emp AND s.biz <> 'b1000000-0000-4000-8000-000000000001'))
    LEFT JOIN LATERAL (
        SELECT COUNT(*) AS cnt, SUM(final_total) AS total FROM public.transactions tx
        WHERE tx.staff_id = e.id AND tx.timestamp BETWEEN s.s AND s.e
    ) t ON TRUE
    WHERE s.s < now();
    UPDATE public.employees e SET active_shift_id = sh.id
    FROM public.shifts sh WHERE sh.employee_id = e.id AND sh.status = 'Active';
END $history$;

-- =============================================================================
-- 3. Times for sale-linked rows, deliveries, and everything that is not a sale
-- =============================================================================
DO $final$
DECLARE
    B1 CONSTANT UUID := 'b1000000-0000-4000-8000-000000000001';
    B2 CONSTANT UUID := 'b2000000-0000-4000-8000-000000000002';
    U_OWNER CONSTANT UUID := 'a0000000-0000-4000-8000-000000000001';
    E_MGR   CONSTANT UUID := 'a0000000-0000-4000-8000-000000000002';
    E_CASH1 CONSTANT UUID := 'a0000000-0000-4000-8000-000000000003';
    E_CASH2 CONSTANT UUID := 'a0000000-0000-4000-8000-000000000004';
    E_RIDER CONSTANT UUID := 'a0000000-0000-4000-8000-000000000005';
    E_STOCK CONSTANT UUID := 'a0000000-0000-4000-8000-000000000006';
    t0 TIMESTAMPTZ := now();
    today DATE := (now() AT TIME ZONE 'Africa/Nairobi')::DATE;
    d0 DATE := today - 365;
    r RECORD; v_id UUID; v_ts TIMESTAMPTZ; v_rating INT; v_k INT; v_ref TEXT;
BEGIN
    -- ------------------------------------------------ deliveries and last-visit dates
    SET LOCAL session_replication_role = replica;
    -- Deliveries: done, except today's latest which are still on the road
    UPDATE public.transactions
    SET delivery_status = 'delivered', delivered_at = timestamp + (20 + random() * 55) * interval '1 minute'
    WHERE is_delivery AND timestamp < now() - interval '2 hours';
    UPDATE public.transactions SET delivery_status = 'out_for_delivery'
    WHERE is_delivery AND delivery_status = 'assigned' AND timestamp < now() - interval '25 minutes';

    UPDATE public.customers c SET updated_at = GREATEST(c.created_at,
        COALESCE((SELECT MAX(timestamp) FROM public.transactions t WHERE t.customer_id = c.id), c.created_at));
    SET LOCAL session_replication_role = origin;

    -- ------------------------------------------------ stock transfers: one cancelled, one on the way
    v_ts := now() - interval '19 days' - interval '3 hours';
    v_ref := 'TR-' || to_char(v_ts AT TIME ZONE 'Africa/Nairobi', 'YYMMDD') || '-CANCL';
    INSERT INTO public.stock_transfers (reference, from_business_id, to_business_id, status, note, sent_by_name, sent_by_user_id,
        sent_at, cancelled_by_name, cancelled_at, cancel_reason, created_at, updated_at, client_reference)
    VALUES (v_ref, B1, B2, 'cancelled', 'Extra yoghurt for the weekend', 'Joseph Kiprono', E_STOCK, v_ts, 'Joseph Kiprono',
            v_ts + interval '40 minutes', 'Rider was not available, sent with Thursday''s transfer instead', v_ts,
            v_ts + interval '40 minutes', 'seed-' || v_ref)
    RETURNING id INTO v_id;
    FOR r IN SELECT m.id AS from_id, w.id AS to_id, p.name, p.sku, p.unit, p.category, p.cost, p.price
             FROM seed_prod m JOIN seed_prod w ON w.sku = m.sku AND w.biz = B2 JOIN public.products p ON p.id = m.id
             WHERE m.biz = B1 AND m.sku IN ('KK-YG-STR-500', 'KK-YG-VAN-500') LOOP
        INSERT INTO public.stock_transfer_items (transfer_id, from_product_id, to_product_id, product_name, sku, unit, category,
            unit_cost, unit_price, quantity_sent, created_at)
        VALUES (v_id, r.from_id, r.to_id, r.name, r.sku, r.unit, r.category, r.cost, r.price, 6, v_ts);
        INSERT INTO public.inventory_adjustments (business_id, product_id, product_name, type, quantity_adjusted, previous_stock,
            new_stock, timestamp, reason, staff_name, reference_number, created_at, updated_at)
        VALUES (B1, r.from_id, r.name, 'Transfer Out', -6, 20, 14, v_ts, 'Sent to KayKay''s Milk Westlands', 'Joseph Kiprono', v_ref, v_ts, v_ts),
               (B1, r.from_id, r.name, 'Transfer Return', 6, 14, 20, v_ts + interval '40 minutes', 'Transfer cancelled', 'Joseph Kiprono', v_ref,
                v_ts + interval '40 minutes', v_ts + interval '40 minutes');
    END LOOP;

    v_ts := now() - interval '50 minutes';
    v_ref := 'TR-' || to_char(v_ts AT TIME ZONE 'Africa/Nairobi', 'YYMMDD') || '-TRANS';
    INSERT INTO public.stock_transfers (reference, from_business_id, to_business_id, status, note, sent_by_name, sent_by_user_id,
        sent_at, created_at, updated_at, client_reference)
    VALUES (v_ref, B1, B2, 'in_transit', 'Butter and long life milk', 'Joseph Kiprono', E_STOCK, v_ts, v_ts, v_ts, 'seed-' || v_ref)
    RETURNING id INTO v_id;
    FOR r IN SELECT m.id AS from_id, w.id AS to_id, p.name, p.sku, p.unit, p.category, p.cost, p.price, p.stock
             FROM seed_prod m JOIN seed_prod w ON w.sku = m.sku AND w.biz = B2 JOIN public.products p ON p.id = m.id
             WHERE m.biz = B1 AND m.sku IN ('KK-BTR-250', 'KK-UHT-500') AND p.stock >= 4 LOOP
        INSERT INTO public.stock_transfer_items (transfer_id, from_product_id, product_name, sku, unit, category,
            unit_cost, unit_price, quantity_sent, created_at)
        VALUES (v_id, r.from_id, r.name, r.sku, r.unit, r.category, r.cost, r.price, 3, v_ts);
        PERFORM pg_temp.adjust(r.from_id, 'Transfer Out', -3, 'Sent to KayKay''s Milk Westlands', 'Joseph Kiprono', v_ts, v_ref);
    END LOOP;
    INSERT INTO public.notifications (business_id, title, message, type, priority, action_type, action_target, payload, created_by,
        status, created_at, updated_at, sent_at, delivered_at)
    VALUES (B2, 'Stock on the way', 'KayKay''s Milk sent 2 products (' || v_ref || '). Check it when it arrives and confirm what came.',
            'Stock Transfer', 'high', 'navigate', 'stock-transfers', jsonb_build_object('transferId', v_id, 'reference', v_ref),
            'system', 'delivered', v_ts, v_ts, v_ts, v_ts);

    -- Production: one batch spoiled, one in progress right now
    INSERT INTO public.production_batches (business_id, recipe_id, recipe_name, quantity_produced, unit, status, staff_name, date,
        product_id, bom_id, reference_number, created_at, updated_at)
    SELECT B1, sp.recipe_id, p.name, 20, p.unit, 'Cancelled', 'Joseph Kiprono', now() - interval '41 days', p.id, sp.bom_id,
           'PB-SPOILT-1', now() - interval '41 days', now() - interval '41 days'
    FROM seed_prod sp JOIN public.products p ON p.id = sp.id WHERE sp.biz = B1 AND sp.sku = 'KK-YG-PLN-500'
    UNION ALL
    SELECT B1, sp.recipe_id, p.name, 30, p.unit, 'In Progress', 'Joseph Kiprono', now() - interval '2 hours', p.id, sp.bom_id,
           'PB-TODAY-1', now() - interval '2 hours', now() - interval '2 hours'
    FROM seed_prod sp JOIN public.products p ON p.id = sp.id WHERE sp.biz = B1 AND sp.sku = 'KK-ML-500';

    -- Cheddar ran out (expired stock written off)
    SELECT sp.id, p.stock INTO r FROM seed_prod sp JOIN public.products p ON p.id = sp.id WHERE sp.biz = B1 AND sp.sku = 'KK-CHD-200';
    IF r.stock > 0 THEN
        PERFORM pg_temp.adjust(r.id, 'Damage', -r.stock, 'Expired', 'Joseph Kiprono', now() - interval '3 hours');
        PERFORM pg_temp.stamp(now() - interval '3 hours');
    END IF;

    -- ------------------------------------------------ M-Pesa till: payments that hit the till
    FOR r IN SELECT t.id, t.final_total, t.timestamp, t.staff_name, t.customer_name, c.phone
             FROM public.transactions t LEFT JOIN public.customers c ON c.id = t.customer_id
             WHERE t.business_id = B1 AND t.payment_method = 'M-Pesa' AND t.staff_name <> 'Website'
               AND t.timestamp > now() - interval '14 days'
             ORDER BY random() LIMIT 40 LOOP
        INSERT INTO public.mpesa_till_payments (business_id, trans_id, trans_type, amount, short_code, msisdn, payer_name, trans_time,
            status, handled_by, handled_at, note, created_at)
        VALUES (B1, pg_temp.mpesa_code(), 'Buy Goods', r.final_total, '5123456',
                COALESCE(left(replace(r.phone, '+', ''), 6) || '***' || right(r.phone, 3), '2547' || pg_temp.ri(10, 99) || '***' || pg_temp.ri(100, 999)),
                COALESCE(upper(r.customer_name), pg_temp.pick(ARRAY['JOHN','MARY','PETER','ESTHER','DAVID','ANN']) || ' ' ||
                         pg_temp.pick(ARRAY['KAMAU','OTIENO','WANJIRU','MUTUA','CHEBET'])),
                r.timestamp - interval '30 seconds', 'matched_sale', r.staff_name, r.timestamp, 'Sale ' || public.fn_receipt_number(r.id),
                r.timestamp - interval '30 seconds');
    END LOOP;
    INSERT INTO public.mpesa_till_payments (business_id, trans_id, trans_type, amount, short_code, msisdn, payer_name, trans_time, status,
        handled_by, handled_at, note, created_at)
    SELECT B1, pg_temp.mpesa_code(), 'Buy Goods', amt, '5123456', '2547' || pg_temp.ri(10, 99) || '***' || pg_temp.ri(100, 999),
           nm, now() - mins * interval '1 minute', st, CASE WHEN st = 'ignored' THEN 'Mercy Achieng' END,
           CASE WHEN st = 'ignored' THEN now() - (mins - 10) * interval '1 minute' END,
           CASE WHEN st = 'ignored' THEN 'Test payment from the bank, refunded' END,
           now() - mins * interval '1 minute'
    FROM (VALUES (350, 'GRACE MUTHONI', 25, 'unclaimed'), (1200, 'SAMUEL OTIENO', 70, 'unclaimed'),
                 (65, 'JANE WANJIKU', 140, 'unclaimed'), (2000, 'KILIMANI BISTRO', 300, 'unclaimed'),
                 (480, 'DAVID KORIR', 1500, 'unclaimed'), (1, 'KCB TEST', 4000, 'ignored')) v(amt, nm, mins, st);

    -- Card terminal records for recent card sales
    INSERT INTO public.card_payments (business_id, purpose, channel, status, amount, amount_paid, currency, reference,
        provider_reference, payer_name, description, customer_id, transaction_id, card_brand, card_last4, requested_by,
        paid_at, created_at, updated_at)
    SELECT t.business_id, 'sale', 'terminal', 'success', t.final_total, t.final_total, 'KES',
           'KKM-' || substr(md5(t.id::TEXT), 1, 12), 'T' || pg_temp.ri(100000000, 999999999), t.customer_name,
           'Sale ' || public.fn_receipt_number(t.id), t.customer_id, t.id,
           pg_temp.pick(ARRAY['visa','visa','mastercard']), lpad(pg_temp.ri(0, 9999)::TEXT, 4, '0'), t.staff_name,
           t.timestamp, t.timestamp - interval '1 minute', t.timestamp
    FROM public.transactions t WHERE t.payment_method = 'Card' AND t.timestamp > now() - interval '60 days';
    INSERT INTO public.card_payments (business_id, purpose, channel, status, amount, currency, reference, failure_reason,
        requested_by, created_at, updated_at)
    VALUES (B1, 'sale', 'terminal', 'failed', 840, 'KES', 'KKM-FAILED-0001', 'Insufficient funds', 'Faith Njeri',
            now() - interval '3 days', now() - interval '3 days'),
           (B1, 'sale', 'terminal', 'cancelled', 260, 'KES', 'KKM-CANCEL-0001', 'Cancelled on terminal', 'Brian Otieno',
            now() - interval '6 hours', now() - interval '6 hours');

    -- ------------------------------------------------ feedback and complaints
    FOR v_k IN 1..58 LOOP
        v_ts := pg_temp.at(d0 + pg_temp.ri(5, 364), pg_temp.ri(8, 20), pg_temp.ri(0, 59));
        CONTINUE WHEN v_ts > now();
        v_rating := (ARRAY[5,5,5,5,4,4,4,3,2,1])[pg_temp.ri(1, 10)];
        SELECT c.name, a.id AS acc INTO r FROM public.customers c LEFT JOIN public.customer_accounts a ON a.customer_id = c.id
        WHERE c.business_id = B1 AND c.customer_type = 'individual' ORDER BY random() LIMIT 1;
        INSERT INTO public.complaints (business_id, customer_name, rating, comment, timestamp, resolved, sentiment, branch,
            feedback_type, product_id, account_id, created_at, updated_at, archived_at)
        VALUES (B1, r.name, v_rating,
            CASE v_rating
                WHEN 5 THEN pg_temp.pick(ARRAY['Very friendly staff and the milk is always fresh.','Brian was so helpful this morning, asante!',
                    'Best mala in the area.','Delivery came early, perfect for breakfast.'])
                WHEN 4 THEN pg_temp.pick(ARRAY['Good milk. Please stock more Greek yoghurt.','Nice shop, the queue was a bit long on Saturday.',
                    'Could you open earlier on Sundays?'])
                WHEN 3 THEN pg_temp.pick(ARRAY['Milk was okay but the packet was not well sealed.','Prices went up, quality is the same.'])
                WHEN 2 THEN pg_temp.pick(ARRAY['Yoghurt was sour two days before the date.','I was given the wrong change.'])
                ELSE pg_temp.pick(ARRAY['Rider never came and nobody picked my call.','Found the milk had gone off when I got home.']) END,
            v_ts, v_ts < now() - interval '10 days' AND random() < 0.85,
            CASE WHEN v_rating >= 4 THEN 'positive' WHEN v_rating = 3 THEN 'neutral' ELSE 'negative' END::public.sentiment,
            'Main branch',
            CASE WHEN v_rating <= 2 THEN 'complaint' WHEN random() < 0.25 THEN 'suggestion' ELSE 'feedback' END,
            CASE WHEN random() < 0.3 THEN (SELECT id FROM seed_prod WHERE biz = B1 ORDER BY random() LIMIT 1) END,
            r.acc, v_ts, v_ts, CASE WHEN v_ts < now() - interval '200 days' AND random() < 0.3 THEN v_ts + interval '30 days' END)
        RETURNING id INTO v_id;
        IF v_rating <= 3 OR random() < 0.2 THEN
            INSERT INTO public.complaint_replies (complaint_id, author, role, message, timestamp, created_at)
            VALUES (v_id, 'Mercy Achieng', 'Manager',
                    CASE WHEN v_rating <= 2 THEN 'We are very sorry. We have replaced the product and spoken to the team.'
                         WHEN v_rating = 3 THEN 'Thank you, we are checking the sealing machine.'
                         ELSE 'Asante for the kind words!' END,
                    v_ts + interval '3 hours', v_ts + interval '3 hours');
        END IF;
    END LOOP;

    -- ------------------------------------------------ customer chat from the website
    FOR r IN SELECT a.id, a.name FROM public.customer_accounts a ORDER BY a.created_at LIMIT 4 LOOP
        v_ts := now() - (pg_temp.ri(1, 40) * interval '1 day') - (pg_temp.ri(0, 600) * interval '1 minute');
        INSERT INTO public.customer_messages (business_id, account_id, sender, staff_name, body, created_at, read_at) VALUES
            (B1, r.id, 'customer', NULL, pg_temp.pick(ARRAY['Hi, do you deliver on Sunday?','Can I change my delivery address for tomorrow?',
                'Do you have lactose-free milk?','Can I pay monthly like the schools?']), v_ts, v_ts + interval '20 minutes'),
            (B1, r.id, 'staff', 'Mercy Achieng', 'Hello ' || split_part(r.name, ' ', 1) || ', yes we can. I have updated it for you.',
                v_ts + interval '25 minutes', v_ts + interval '2 hours');
    END LOOP;
    SELECT id INTO v_id FROM public.customer_accounts ORDER BY created_at DESC LIMIT 1;
    INSERT INTO public.customer_messages (business_id, account_id, sender, body, created_at)
    VALUES (B1, v_id, 'customer', 'Hello, my order has not arrived yet. Is the rider on the way?', now() - interval '12 minutes');

    -- Repeat orders customers set up on the website
    INSERT INTO public.customer_order_schedules (business_id, account_id, items, days_of_week, fulfilment, delivery_address, notes,
        active, next_run_date, last_run_date, created_at, updated_at)
    SELECT B1, a.id,
           jsonb_build_array(jsonb_build_object('productId', (SELECT id FROM seed_prod WHERE biz = B1 AND sku = 'KK-FM-1000'), 'quantity', 2),
                             jsonb_build_object('productId', (SELECT id FROM seed_prod WHERE biz = B1 AND sku = 'KK-YG-STR-500'), 'quantity', 1)),
           CASE WHEN rn = 1 THEN ARRAY[1,3,5] ELSE ARRAY[6] END, 'delivery', a.delivery_address,
           CASE WHEN rn = 1 THEN 'Before 7am please' END, rn = 1, today + 1, today - 1,
           now() - interval '30 days', now() - interval '2 days'
    FROM (SELECT a.*, row_number() OVER (ORDER BY a.created_at) AS rn FROM public.customer_accounts a) a WHERE rn <= 2;

    -- ------------------------------------------------ staff announcements and reminders
    FOR r IN SELECT * FROM (VALUES
        (330, 'Stock count on Sunday', 'Full stock count after closing on Sunday. Please stay 30 minutes extra.'),
        (290, 'New price list', 'Fresh milk 1L goes up to KSh 65 from the 1st. The till is updated.'),
        (240, 'Welcome Faith!', 'Faith Njeri joins as afternoon cashier from Monday.'),
        (225, 'Milk price change', 'Fresh milk and Mala 500ml go up by KSh 5 from today. Cooperative raised farm-gate prices.'),
        (183, 'Westlands is open', 'Our second branch at Woodvale Grove opens today. Lucy is in charge there.'),
        (170, 'Website shop is live', 'Customers can now order and pay online. Watch the Online Orders screen.'),
        (90,  'Fridge maintenance', 'Technician comes Thursday 3pm. Move yoghurt to the chest freezer first.'),
        (35,  'December prep', 'Expect busier weekends from mid-December. Order extra packets this week.'),
        (2,   'Generator out for repair', 'If power goes, close the milk ATM and keep fridges shut.')
    ) v(days_ago, title, msg) LOOP
        v_ts := pg_temp.at(today - r.days_ago, 7, 30);
        PERFORM public.fn_notify_staff(B1, r.title, r.msg, '{}'::JSONB);
        PERFORM pg_temp.stamp(v_ts);
    END LOOP;
    SET LOCAL session_replication_role = replica;
    UPDATE public.notifications SET read_at = created_at + interval '2 hours', status = 'delivered'
    WHERE created_at < now() - interval '3 days' AND read_at IS NULL AND random() < 0.92;
    SET LOCAL session_replication_role = origin;

    INSERT INTO public.schedules (business_id, employee_id, title, notes, date, start_time, end_time, repeat, color, created_by,
        created_at, updated_at) VALUES
      (B1, E_CASH1, 'Open shop and receive milk', 'Check temperature of every can', d0 + 5, '06:15', '06:45', 'Daily', '#f59e0b', E_MGR, pg_temp.at(d0 + 4, 9, 0), pg_temp.at(d0 + 4, 9, 0)),
      (B1, E_RIDER, 'Institution deliveries', 'Schools first, then hotels', d0 + 5, '06:30', '08:00', 'Daily', '#10b981', E_MGR, pg_temp.at(d0 + 4, 9, 0), pg_temp.at(d0 + 4, 9, 0)),
      (B1, E_STOCK, 'Weekly stock count', NULL, d0 + 6, '19:15', '20:30', 'Weekly', '#6366f1', U_OWNER, pg_temp.at(d0 + 4, 9, 0), pg_temp.at(d0 + 4, 9, 0)),
      (B1, E_MGR, 'Bank the day''s cash', 'Equity Bank, Ngong Rd branch', d0 + 5, '20:45', NULL, 'Daily', '#ef4444', U_OWNER, pg_temp.at(d0 + 4, 9, 0), pg_temp.at(d0 + 4, 9, 0)),
      (B1, E_CASH2, 'Close till and count cash', NULL, d0 + 80, '20:50', '21:05', 'Daily', '#f59e0b', E_MGR, pg_temp.at(d0 + 78, 9, 0), pg_temp.at(d0 + 78, 9, 0)),
      (B1, E_MGR, 'Pay cooperative', 'Kiambu Dairy Farmers Co-op invoice', d0 + 10, '10:00', NULL, 'Monthly', '#0ea5e9', U_OWNER, pg_temp.at(d0 + 4, 9, 0), pg_temp.at(d0 + 4, 9, 0)),
      (B1, E_STOCK, 'Fridge service visit', 'Technician from CoolTech', today + 3, '15:00', '16:30', 'None', '#a855f7', E_MGR, now() - interval '1 day', now() - interval '1 day');

    INSERT INTO public.scheduled_reports (business_id, name, frequency, recipients, report_type, format, last_run_at, next_run_at,
        enabled, created_by, created_at, updated_at)
    VALUES (B1, 'Weekly owner summary', 'weekly', '["owner@kaykays.test"]', 'full', 'email', now() - interval '3 days',
            now() + interval '4 days', TRUE, U_OWNER, pg_temp.at(d0 + 10, 9, 0), now() - interval '3 days');

    INSERT INTO public.problem_reports (business_id, reported_by, reporter, severity, summary, details, screen, platform, app_version,
        status, created_at, resolved_at) VALUES
      (B1, 'a0000000-0000-4000-8000-000000000004', 'Faith Njeri', 'minor', 'Receipt prints customer name twice',
       'Happens on credit sales only.', 'sales', 'android', '5.3.2', 'resolved', now() - interval '40 days', now() - interval '33 days'),
      (B1, 'a0000000-0000-4000-8000-000000000003', 'Brian Otieno', 'broken', 'Till froze when scanning two items fast',
       'Had to close and reopen the app. Sale was saved.', 'sales', 'android', '5.4.0', 'in_progress', now() - interval '4 days', NULL),
      (B1, 'a0000000-0000-4000-8000-000000000002', 'Mercy Achieng', 'minor', 'Petty cash list does not scroll on small phone',
       NULL, 'petty-cash', 'android', '5.4.0', 'open', now() - interval '8 hours', NULL);

    INSERT INTO public.ai_insights (business_id, title, content, type, date, created_at) VALUES
      (B1, 'Saturday mornings are your busiest time', 'About a third of weekly fresh milk is sold on Saturday between 7am and 11am. Consider a second cashier then.', 'Insight', now() - interval '6 days', now() - interval '6 days'),
      (B1, 'Riverside Café keeps a growing balance', 'Riverside Café pays about 70% of its weekly account. Its balance has grown every month since it joined.', 'Warning', now() - interval '3 days', now() - interval '3 days'),
      (B1, 'Strawberry yoghurt sells out on Mondays', 'Production on Monday and Thursday leaves strawberry yoghurt short on Monday afternoons. Make a bigger Thursday batch.', 'Recommendation', now() - interval '1 day', now() - interval '1 day');
END $final$;

DROP INDEX public.seed_tmp_dp, public.seed_tmp_lpe, public.seed_tmp_cl, public.seed_tmp_lr, public.seed_tmp_wt, public.seed_tmp_pay,
           public.seed_tmp_pal, public.seed_tmp_cps, public.seed_tmp_cpu, public.seed_tmp_ntf, public.seed_tmp_cm,
           public.seed_tmp_ia;

ANALYZE public.transactions, public.transaction_items, public.inventory_adjustments, public.customers,
        public.products, public.customer_ledger, public.payment_asset_ledger, public.credit_payments;
