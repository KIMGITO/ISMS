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
