-- =============================================================================
-- seed_quick.sql: the smallest useful test data, for quick testing
--
-- Creates (nothing else: no sales, no history):
--   * 2 branches: KayKay's Milk (Main, Ngong Road) and KayKay's Milk Westlands
--   * logins: the owner, 1 admin and 5 riders (see supabase/SEED_LOGINS.md)
--   * 5 products, stocked in both branches (opening stock is logged as a Restock)
--   * 5 customers: 3 at Main, 2 at Westlands
--
-- Load it on an EMPTY database, or on one where the owner has signed up and made
-- one business that is still empty: that owner and business are kept (the business
-- becomes the Main branch). It refuses anything else.
--   local:  set sql_paths = ["seed_quick.sql"] and enabled = true in config.toml,
--           then `npx supabase db reset`
--   linked: npx supabase db query --linked -f supabase/seed_quick.sql
--
-- Runs as one transaction, so a failure leaves nothing behind.
-- =============================================================================

SET client_min_messages = error;
SET check_function_bodies = off;

DO $$
BEGIN
    IF (SELECT count(*) FROM public.businesses) > 1
       OR EXISTS (SELECT 1 FROM public.products) OR EXISTS (SELECT 1 FROM public.customers)
       OR EXISTS (SELECT 1 FROM public.transactions)
       OR EXISTS (SELECT 1 FROM auth.users WHERE email LIKE '%@kaykays.test') THEN
        RAISE EXCEPTION 'seed_quick.sql only fills an empty database (or one with a single, still empty business).';
    END IF;
END $$;

-- Auth user + identity; handle_new_user creates the public.users row.
CREATE FUNCTION pg_temp.mk_user(p_id UUID, p_email TEXT, p_password TEXT, p_name TEXT, p_phone TEXT)
RETURNS UUID LANGUAGE plpgsql AS $f$
BEGIN
    INSERT INTO auth.users (
        instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
        raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
        confirmation_token, recovery_token, email_change_token_new, email_change,
        email_change_token_current, phone_change, phone_change_token, reauthentication_token,
        is_sso_user, is_anonymous
    ) VALUES (
        '00000000-0000-0000-0000-000000000000', p_id, 'authenticated', 'authenticated', p_email,
        extensions.crypt(p_password, extensions.gen_salt('bf')), now(),
        '{"provider":"email","providers":["email"]}',
        jsonb_build_object('name', p_name, 'phone', p_phone),
        now(), now(), '', '', '', '', '', '', '', '', FALSE, FALSE
    );
    INSERT INTO auth.identities (id, user_id, provider_id, identity_data, provider, created_at, updated_at)
    VALUES (gen_random_uuid(), p_id, p_id::TEXT,
            jsonb_build_object('sub', p_id::TEXT, 'email', p_email, 'email_verified', TRUE),
            'email', now(), now());
    -- is_verified = TRUE also sets verified_email (fn_users_protect_verified)
    UPDATE public.users SET is_verified = TRUE, phone_verified = TRUE WHERE id = p_id;
    RETURN p_id;
END $f$;

DO $seed$
DECLARE
    B1 UUID := 'b0000000-0000-4000-8000-000000000001';  -- Main (or the business already there)
    B2 CONSTANT UUID := 'b0000000-0000-4000-8000-000000000002';  -- Westlands
    U_OWNER UUID := 'a0000000-0000-4000-8000-000000000001';
    v_existing BOOLEAN := EXISTS (SELECT 1 FROM public.businesses);
    v_owner_name TEXT := 'Dennis Kimanthi';
    U_ADMIN CONSTANT UUID := 'a0000000-0000-4000-8000-000000000002';
    U_R1 CONSTANT UUID := 'a0000000-0000-4000-8000-000000000011';
    U_R2 CONSTANT UUID := 'a0000000-0000-4000-8000-000000000012';
    U_R3 CONSTANT UUID := 'a0000000-0000-4000-8000-000000000013';
    U_R4 CONSTANT UUID := 'a0000000-0000-4000-8000-000000000014';
    U_R5 CONSTANT UUID := 'a0000000-0000-4000-8000-000000000015';
BEGIN
    -- Logins --------------------------------------------------------------------
    IF v_existing THEN
        -- Keep the owner who signed up and their business (it becomes Main).
        SELECT m.business_id, m.user_id INTO B1, U_OWNER
        FROM public.business_memberships m WHERE m.role = 'Owner' ORDER BY m.created_at, m.id LIMIT 1;
        IF B1 IS NULL THEN RAISE EXCEPTION 'The existing business has no owner.'; END IF;
        SELECT COALESCE(NULLIF(name, ''), v_owner_name) INTO v_owner_name FROM public.users WHERE id = U_OWNER;
    ELSE
        PERFORM pg_temp.mk_user(U_OWNER, 'kimanthidennis02@gmail.com', 'Admin@123', 'Dennis Kimanthi', '+254711000001');
    END IF;
    PERFORM pg_temp.mk_user(U_ADMIN, 'admin@kaykays.test',  'Test1234!', 'Grace Wanjiku',  '+254711000002');
    PERFORM pg_temp.mk_user(U_R1,    'rider1@kaykays.test', 'Test1234!', 'Peter Mwangi',   '+254711000011');
    PERFORM pg_temp.mk_user(U_R2,    'rider2@kaykays.test', 'Test1234!', 'Kevin Odhiambo', '+254711000012');
    PERFORM pg_temp.mk_user(U_R3,    'rider3@kaykays.test', 'Test1234!', 'Samuel Kiptoo',  '+254711000013');
    PERFORM pg_temp.mk_user(U_R4,    'rider4@kaykays.test', 'Test1234!', 'John Mutua',     '+254711000014');
    PERFORM pg_temp.mk_user(U_R5,    'rider5@kaykays.test', 'Test1234!', 'Collins Wafula', '+254711000015');

    -- Branches (each branch is a business sharing the owner) ----------------------
    IF NOT v_existing THEN
    INSERT INTO public.businesses (id, name, business_type, description, address, contact_email, contact_phone,
        primary_color, secondary_color, is_tax_enabled, tax_percentage, website_slug, default_payment_methods)
    VALUES
      (B1, 'KayKay''s Milk', 'Dairy', 'Fresh farm milk, mala, yoghurt and dairy in Nairobi.',
       'Ngong Road, opposite Adams Arcade, Nairobi', 'hello@kaykays.test', '+254711000001', '#f59e0b', '#1f2937',
       FALSE, 16, 'kaykays', ARRAY['Cash','M-Pesa','Card','Bank']);
    INSERT INTO public.branches (business_id, name, address)
    VALUES (B1, 'Main branch', 'Ngong Road, opposite Adams Arcade, Nairobi');
    INSERT INTO public.business_memberships (business_id, user_id, role, status, created_at)
    VALUES (B1, U_OWNER, 'Owner', 'Active', now() - interval '1 second');
    END IF;

    INSERT INTO public.businesses (id, name, business_type, description, address, contact_email, contact_phone,
        primary_color, secondary_color, is_tax_enabled, tax_percentage, website_slug, default_payment_methods)
    VALUES
      (B2, (SELECT name FROM public.businesses WHERE id = B1) || ' Westlands', 'Dairy', 'Westlands branch.',
       'Woodvale Grove, Westlands, Nairobi', 'westlands@kaykays.test', '+254711000003', '#f59e0b', '#1f2937',
       FALSE, 16, NULL, ARRAY['Cash','M-Pesa','Card','Bank']);

    INSERT INTO public.branches (business_id, name, address)
    VALUES (B2, 'Main branch', 'Woodvale Grove, Westlands, Nairobi');

    -- Memberships create the employee rows (fn_membership_sync_employee).
    -- The owner's membership is made first, so the owner is the system creator.
    INSERT INTO public.business_memberships (business_id, user_id, role, status, created_at) VALUES
      (B2, U_OWNER, 'Owner', 'Active', now() - interval '1 second'),
      (B1, U_ADMIN, 'Admin', 'Active', now()),
      (B2, U_ADMIN, 'Admin', 'Active', now()),
      (B1, U_R1,    'Rider', 'Active', now()),
      (B1, U_R2,    'Rider', 'Active', now()),
      (B1, U_R3,    'Rider', 'Active', now()),
      (B2, U_R4,    'Rider', 'Active', now()),
      (B2, U_R5,    'Rider', 'Active', now());

    -- Settings --------------------------------------------------------------------
    INSERT INTO public.receipt_settings (business_id, business_name, address, phone, email,
        header_message, footer_message, thank_you_message, is_tax_enabled, tax_percentage)
    SELECT id, name, address, contact_phone, contact_email,
           'Fresh from the farm, every morning', 'Keep milk below 4°C.', 'Asante sana! Karibu tena.', FALSE, 16
    FROM public.businesses b WHERE id IN (B1, B2)
      AND NOT EXISTS (SELECT 1 FROM public.receipt_settings r WHERE r.business_id = b.id);
    INSERT INTO public.printer_settings (business_id)
    SELECT x FROM unnest(ARRAY[B1, B2]) x
    WHERE NOT EXISTS (SELECT 1 FROM public.printer_settings p WHERE p.business_id = x);

    -- Products: the same 5 in both branches (categories register themselves;
    -- opening stock is logged by fn_product_opening_stock) ------------------------
    INSERT INTO public.products (business_id, name, category, price, cost, stock, min_stock, unit, sku,
        description, perishable, expiry_days, show_on_website, last_modified_by)
    SELECT b.id, p.name, p.category, p.price, p.cost, p.stock * b.scale, p.min_stock, p.unit, p.sku,
           p.descr, p.perishable, p.expiry, b.id = B1, v_owner_name
    FROM (VALUES (B1, 1.0), (B2, 0.5)) b(id, scale)
    CROSS JOIN (VALUES
      ('Fresh Milk 1L',        'Milk',   60.00,  45.00, 80.0, 15.0, 'Litres',  'MLK-1L',   'Fresh farm milk, delivered every morning.', TRUE,  3),
      ('Mala 500ml',           'Milk',   70.00,  50.00, 40.0, 10.0, 'Packets', 'MALA-500', 'Fermented milk.',                           TRUE,  7),
      ('Yoghurt Vanilla 500ml','Yoghurt',120.00, 85.00, 30.0,  8.0, 'Packets', 'YOG-V500', 'Thick vanilla yoghurt.',                    TRUE, 14),
      ('Butter 250g',          'Butter', 280.00,210.00, 20.0,  5.0, 'Pieces',  'BTR-250',  'Salted farm butter.',                       TRUE, 60),
      ('Eggs Tray (30)',       'Eggs',   450.00,380.00, 12.0,  3.0, 'Trays',   'EGG-30',   'Kienyeji-fed layer eggs.',                  TRUE, 21)
    ) p(name, category, price, cost, stock, min_stock, unit, sku, descr, perishable, expiry);

    -- Customers: 3 at Main, 2 at Westlands -------------------------------------------
    INSERT INTO public.customers (business_id, name, phone, email, customer_type, payment_terms,
        delivery_address, delivery_landmark, last_modified_by)
    VALUES
      (B1, 'Achieng Ndungu',     '+254722300001', 'achieng.ndungu@example.com', 'individual', 'pay_now',
       'Kilimani, Argwings Kodhek Rd', 'Near Yaya Centre', v_owner_name),
      (B1, 'Mutua Mwangi',       '+254722300002', NULL,                         'individual', 'pay_now',
       'Lavington, James Gichuru Rd', NULL, v_owner_name),
      (B1, 'Green Valley Hotel', '+254722300003', 'accounts@greenvalley.test',  'business',   'weekly',
       'Ngong Road', 'Next to the Shell station', v_owner_name),
      (B2, 'Wairimu Kamau',      '+254722300004', 'wairimu.kamau@example.com',  'individual', 'pay_now',
       'Westlands, Woodvale Grove', 'Opposite Sarit Centre', v_owner_name),
      (B2, 'Westlands Coffee House', '+254722300005', 'accounts@westlandscoffee.test', 'business', 'weekly',
       'Westlands, Mpaka Rd', NULL, v_owner_name);
END $seed$;
