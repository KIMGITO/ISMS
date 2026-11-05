-- =============================================================================
-- 20261105010_customer_portal.sql
-- Customer portal: public storefront, accounts, online orders with M-Pesa,
-- order schedules, messages, feedback, articles and assistant quotas.
-- =============================================================================
-- Why: The website runs with the anon key, and table policies can't hide columns
-- (products.cost, exact stock), so anon only gets narrow functions and no table
-- policies. A business stays private until website_slug is set.
-- Customers sign in through Supabase Auth but get no business membership,
-- so every staff policy keeps excluding them. They read their own rows through
-- RLS and write only through the functions below, which price orders on the
-- server. Only service_role can confirm a payment.
-- A paid order inserts a normal transaction, so the existing triggers handle
-- stock, loyalty points and money assets exactly as they do for POS sales.
-- Dependencies: 003, 005, 006, 008, 010, 012
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- TABLES
-- ---------------------------------------------------------------------------
ALTER TABLE public.businesses
    ADD COLUMN IF NOT EXISTS website_slug TEXT UNIQUE
    CHECK (website_slug IS NULL OR website_slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$');

ALTER TABLE public.products
    ADD COLUMN IF NOT EXISTS show_on_website BOOLEAN NOT NULL DEFAULT TRUE;

CREATE TABLE IF NOT EXISTS public.website_settings (
    business_id       UUID PRIMARY KEY REFERENCES public.businesses(id) ON DELETE CASCADE,
    delivery_enabled  BOOLEAN NOT NULL DEFAULT TRUE,
    delivery_fee      NUMERIC(14,2) NOT NULL DEFAULT 0.00 CHECK (delivery_fee >= 0),
    min_order         NUMERIC(14,2) NOT NULL DEFAULT 0.00 CHECK (min_order >= 0),
    assistant_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Optional delivery areas, added and deleted by staff. With none active, orders use the flat fee.
CREATE TABLE IF NOT EXISTS public.delivery_zones (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    name        TEXT NOT NULL CHECK (length(trim(name)) > 0),
    fee         NUMERIC(14,2) NOT NULL DEFAULT 0.00 CHECK (fee >= 0),
    active      BOOLEAN NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (business_id, name)
);

-- customer_id starts as a new customers row. It is never matched to an existing
-- customer by phone, because the phone number is unverified and matching would
-- hand over that customer's history.
CREATE TABLE IF NOT EXISTS public.customer_accounts (
    id               UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    business_id      UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    customer_id      UUID REFERENCES public.customers(id) ON DELETE SET NULL,
    name             TEXT NOT NULL CHECK (length(trim(name)) > 0),
    phone            TEXT NOT NULL,
    email            TEXT,
    delivery_address TEXT,
    delivery_notes   TEXT,
    delivery_zone_id UUID REFERENCES public.delivery_zones(id) ON DELETE SET NULL,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.customer_order_schedules (
    id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id      UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    account_id       UUID NOT NULL REFERENCES public.customer_accounts(id) ON DELETE CASCADE,
    items            JSONB NOT NULL,
    days_of_week     INTEGER[] NOT NULL,
    fulfilment       TEXT NOT NULL CHECK (fulfilment IN ('delivery', 'pickup')),
    delivery_address TEXT,
    notes            TEXT,
    active           BOOLEAN NOT NULL DEFAULT TRUE,
    next_run_date    DATE NOT NULL,
    last_run_date    DATE,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.online_orders (
    id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    order_number     BIGSERIAL UNIQUE,
    business_id      UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    account_id       UUID REFERENCES public.customer_accounts(id) ON DELETE SET NULL,
    schedule_id      UUID REFERENCES public.customer_order_schedules(id) ON DELETE SET NULL,
    transaction_id   UUID REFERENCES public.transactions(id) ON DELETE SET NULL,
    customer_name    TEXT NOT NULL,
    customer_phone   TEXT NOT NULL,
    status           TEXT NOT NULL DEFAULT 'pending_payment' CHECK (status IN (
                         'pending_payment', 'payment_failed', 'paid', 'preparing',
                         'out_for_delivery', 'ready_for_pickup', 'completed', 'cancelled')),
    fulfilment       TEXT NOT NULL CHECK (fulfilment IN ('delivery', 'pickup')),
    delivery_address TEXT,
    -- A copy of the area's name, so deleting a zone can't change past orders.
    delivery_zone    TEXT,
    notes            TEXT,
    subtotal         NUMERIC(14,2) NOT NULL CHECK (subtotal >= 0),
    delivery_fee     NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (delivery_fee >= 0),
    discount         NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (discount >= 0),
    -- M-Pesa only accepts whole shillings, so cents are rounded down in the customer's favour.
    total            NUMERIC(14,2) NOT NULL CHECK (total > 0 AND total = trunc(total)),
    mpesa_receipt    TEXT,
    paid_at          TIMESTAMPTZ,
    needs_attention  BOOLEAN NOT NULL DEFAULT FALSE,
    attention_reason TEXT,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.online_order_items (
    id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    order_id     UUID NOT NULL REFERENCES public.online_orders(id) ON DELETE CASCADE,
    product_id   UUID NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
    product_name TEXT NOT NULL,
    unit         TEXT NOT NULL,
    unit_price   NUMERIC(14,2) NOT NULL CHECK (unit_price >= 0),
    quantity     NUMERIC(14,3) NOT NULL CHECK (quantity > 0),
    line_total   NUMERIC(14,2) NOT NULL CHECK (line_total >= 0)
);

CREATE TABLE IF NOT EXISTS public.customer_messages (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    account_id  UUID NOT NULL REFERENCES public.customer_accounts(id) ON DELETE CASCADE,
    sender      TEXT NOT NULL CHECK (sender IN ('customer', 'staff', 'system')),
    staff_name  TEXT,
    body        TEXT NOT NULL CHECK (length(trim(body)) BETWEEN 1 AND 1000),
    order_id    UUID REFERENCES public.online_orders(id) ON DELETE SET NULL,
    read_at     TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.website_articles (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id     UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    slug            TEXT NOT NULL CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
    title           TEXT NOT NULL CHECK (length(trim(title)) > 0),
    summary         TEXT NOT NULL DEFAULT '',
    body            TEXT NOT NULL DEFAULT '',
    category        TEXT NOT NULL DEFAULT 'Milk care',
    cover_image_url TEXT,
    published       BOOLEAN NOT NULL DEFAULT FALSE,
    published_at    TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (business_id, slug)
);

CREATE TABLE IF NOT EXISTS public.assistant_usage (
    bucket       TEXT NOT NULL,
    window_start TIMESTAMPTZ NOT NULL,
    uses         INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (bucket, window_start)
);

ALTER TABLE public.complaints
    ADD COLUMN IF NOT EXISTS feedback_type TEXT NOT NULL DEFAULT 'feedback'
        CHECK (feedback_type IN ('feedback', 'suggestion', 'complaint')),
    ADD COLUMN IF NOT EXISTS product_id UUID REFERENCES public.products(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS account_id UUID REFERENCES public.customer_accounts(id) ON DELETE SET NULL;

ALTER TABLE public.mpesa_transactions
    ADD COLUMN IF NOT EXISTS online_order_id UUID REFERENCES public.online_orders(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_customer_accounts_business ON public.customer_accounts(business_id);
CREATE INDEX IF NOT EXISTS idx_online_orders_business ON public.online_orders(business_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_online_orders_account ON public.online_orders(account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_online_order_items_order ON public.online_order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_order_schedules_due ON public.customer_order_schedules(next_run_date) WHERE active;
CREATE INDEX IF NOT EXISTS idx_order_schedules_account ON public.customer_order_schedules(account_id);
CREATE INDEX IF NOT EXISTS idx_customer_messages_account ON public.customer_messages(account_id, created_at);
CREATE INDEX IF NOT EXISTS idx_customer_messages_business ON public.customer_messages(business_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_mpesa_transactions_online_order ON public.mpesa_transactions(online_order_id);

DO $$
DECLARE
    tbl TEXT;
BEGIN
    FOREACH tbl IN ARRAY ARRAY['website_settings', 'customer_accounts', 'customer_order_schedules',
                               'online_orders', 'website_articles'] LOOP
        EXECUTE format(
            'DROP TRIGGER IF EXISTS trg_%1$s_updated_at ON public.%1$I;
             CREATE TRIGGER trg_%1$s_updated_at
             BEFORE UPDATE ON public.%1$I
             FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();', tbl);
    END LOOP;
END;
$$;

-- ---------------------------------------------------------------------------
-- ACCESS: customers read their own rows; staff read their business's rows.
-- Orders, schedules and messages are written only by the functions below.
-- ---------------------------------------------------------------------------
ALTER TABLE public.website_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_order_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.online_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.online_order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.website_articles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assistant_usage ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.website_settings, public.customer_accounts, public.customer_order_schedules,
    public.online_orders, public.online_order_items, public.customer_messages,
    public.website_articles, public.assistant_usage FROM anon, authenticated;
REVOKE ALL ON SEQUENCE public.online_orders_order_number_seq FROM anon, authenticated;

GRANT SELECT ON public.customer_accounts, public.customer_order_schedules, public.online_orders,
    public.online_order_items, public.customer_messages TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.website_articles, public.website_settings TO authenticated;
-- Edge functions read these with the service role. New tables get no Data API access by default.
GRANT SELECT ON public.businesses, public.products, public.website_settings, public.website_articles,
    public.online_orders, public.mpesa_transactions TO service_role;

CREATE POLICY pol_customer_accounts_select ON public.customer_accounts FOR SELECT
    USING (id = auth.uid() OR business_id = ANY(public.get_user_business_ids()));
CREATE POLICY pol_order_schedules_select ON public.customer_order_schedules FOR SELECT
    USING (account_id = auth.uid() OR business_id = ANY(public.get_user_business_ids()));
CREATE POLICY pol_online_orders_select ON public.online_orders FOR SELECT
    USING (account_id = auth.uid() OR business_id = ANY(public.get_user_business_ids()));
CREATE POLICY pol_online_order_items_select ON public.online_order_items FOR SELECT
    USING (EXISTS (
        SELECT 1 FROM public.online_orders o
        WHERE o.id = order_id
          AND (o.account_id = auth.uid() OR o.business_id = ANY(public.get_user_business_ids()))
    ));
CREATE POLICY pol_customer_messages_select ON public.customer_messages FOR SELECT
    USING (account_id = auth.uid() OR business_id = ANY(public.get_user_business_ids()));
CREATE POLICY pol_website_articles_select ON public.website_articles FOR SELECT
    USING (business_id = ANY(public.get_user_business_ids()));
CREATE POLICY pol_website_articles_write ON public.website_articles FOR ALL
    USING (public.is_owner_or_admin(business_id))
    WITH CHECK (public.is_owner_or_admin(business_id));
CREATE POLICY pol_website_settings_select ON public.website_settings FOR SELECT
    USING (business_id = ANY(public.get_user_business_ids()));
CREATE POLICY pol_website_settings_write ON public.website_settings FOR ALL
    USING (public.is_owner_or_admin(business_id))
    WITH CHECK (public.is_owner_or_admin(business_id));
ALTER TABLE public.delivery_zones ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.delivery_zones FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.delivery_zones TO authenticated;
CREATE POLICY pol_delivery_zones_select ON public.delivery_zones FOR SELECT
    USING (business_id = ANY(public.get_user_business_ids()));
CREATE POLICY pol_delivery_zones_write ON public.delivery_zones FOR ALL
    USING (public.is_owner_or_admin(business_id))
    WITH CHECK (public.is_owner_or_admin(business_id));

-- ---------------------------------------------------------------------------
-- HELPERS (internal)
-- ---------------------------------------------------------------------------

-- Returns +2547XXXXXXXX or +2541XXXXXXXX, or NULL if the number isn't a Kenyan mobile.
CREATE OR REPLACE FUNCTION public.fn_normalize_ke_phone(p_phone TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT CASE
        WHEN d ~ '^254[17][0-9]{8}$' THEN '+' || d
        WHEN d ~ '^0[17][0-9]{8}$' THEN '+254' || substr(d, 2)
        WHEN d ~ '^[17][0-9]{8}$' THEN '+254' || d
    END
    FROM (SELECT regexp_replace(COALESCE(p_phone, ''), '[^0-9]', '', 'g') AS d) s;
$$;

CREATE OR REPLACE FUNCTION public.fn_nairobi_today()
RETURNS DATE
LANGUAGE sql
STABLE
AS $$
    SELECT (NOW() AT TIME ZONE 'Africa/Nairobi')::DATE;
$$;

-- First date on or after p_from that falls on one of the days (0 = Sunday).
CREATE OR REPLACE FUNCTION public.fn_next_schedule_date(p_days INTEGER[], p_from DATE)
RETURNS DATE
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT min(d)::DATE
    FROM generate_series(p_from, p_from + 6, INTERVAL '1 day') d
    WHERE EXTRACT(DOW FROM d)::INTEGER = ANY(p_days);
$$;

CREATE OR REPLACE FUNCTION public.fn_notify_staff(p_business_id UUID, p_title TEXT, p_message TEXT, p_payload JSONB)
RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
    INSERT INTO public.notifications (business_id, title, message, type, payload, created_by)
    VALUES (p_business_id, p_title, p_message, 'Online Store', p_payload, 'website');
$$;

CREATE OR REPLACE FUNCTION public.fn_customer_message(p_account_id UUID, p_order_id UUID, p_body TEXT)
RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
    INSERT INTO public.customer_messages (business_id, account_id, sender, body, order_id)
    SELECT a.business_id, a.id, 'system', p_body, p_order_id
    FROM public.customer_accounts a
    WHERE a.id = p_account_id;
$$;

-- Validates cart lines against the catalogue. Prices always come from products,
-- never from the caller. RAISE messages here are safe to show to customers.
CREATE OR REPLACE FUNCTION public.fn_build_online_order(
    p_account_id UUID,
    p_items      JSONB,
    p_fulfilment TEXT,
    p_address    TEXT,
    p_notes      TEXT,
    p_schedule_id UUID,
    p_zone_id    UUID DEFAULT NULL
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

    UPDATE public.online_orders
    SET subtotal = v_subtotal, discount = v_raw - floor(v_raw), total = floor(v_raw)
    WHERE id = v_order_id;

    RETURN v_order_id;
EXCEPTION
    WHEN invalid_text_representation OR numeric_value_out_of_range THEN
        RAISE EXCEPTION 'Your cart has an invalid item.';
END;
$$;

-- ---------------------------------------------------------------------------
-- STOREFRONT: customer-safe fields only. Returns NULL for an unpublished slug.
-- Products priced at 0 are skipped because those are usually raw materials.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_public_storefront(p_slug TEXT)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT jsonb_build_object(
        'business', jsonb_build_object(
            'name', b.name,
            'description', b.description,
            'address', b.address,
            'contactEmail', NULLIF(b.contact_email, ''),
            'contactPhone', NULLIF(b.contact_phone, ''),
            'logoUrl', b.logo_url,
            'coverImageUrl', b.cover_image_url,
            'primaryColor', b.primary_color,
            'currency', b.currency,
            'paymentMethods', to_jsonb(b.default_payment_methods)
        ),
        'settings', jsonb_build_object(
            'deliveryEnabled', COALESCE(s.delivery_enabled, TRUE),
            'deliveryFee', COALESCE(s.delivery_fee, 0),
            'minOrder', COALESCE(s.min_order, 0),
            'assistantEnabled', COALESCE(s.assistant_enabled, TRUE)
        ),
        'deliveryZones', COALESCE((
            SELECT jsonb_agg(jsonb_build_object('id', z.id, 'name', z.name, 'fee', z.fee) ORDER BY z.name)
            FROM public.delivery_zones z
            WHERE z.business_id = b.id AND z.active
        ), '[]'::jsonb),
        'branches', COALESCE((
            SELECT jsonb_agg(jsonb_build_object('name', br.name, 'address', br.address) ORDER BY br.name)
            FROM public.branches br
            WHERE br.business_id = b.id AND br.deleted_at IS NULL
        ), '[]'::jsonb),
        'products', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                'id', p.id,
                'name', p.name,
                'category', p.category,
                'price', p.price,
                'unit', p.unit,
                'description', p.description,
                'image', p.image,
                'inStock', p.stock > 0
            ) ORDER BY p.category, p.name)
            FROM public.products p
            WHERE p.business_id = b.id
              AND p.deleted_at IS NULL
              AND p.show_on_website
              AND p.price > 0
        ), '[]'::jsonb),
        'articles', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                'id', a.id,
                'slug', a.slug,
                'title', a.title,
                'summary', a.summary,
                'body', a.body,
                'category', a.category,
                'coverImageUrl', a.cover_image_url,
                'publishedAt', a.published_at
            ) ORDER BY a.published_at DESC)
            FROM public.website_articles a
            WHERE a.business_id = b.id AND a.published
        ), '[]'::jsonb)
    )
    FROM public.businesses b
    LEFT JOIN public.website_settings s ON s.business_id = b.id
    WHERE b.website_slug = p_slug
      AND b.deleted_at IS NULL;
$$;

-- ---------------------------------------------------------------------------
-- FEEDBACK: validates input and writes to complaints. The hourly cap per business
-- limits how much spam an anonymous caller can push into the staff queue.
-- Suggestions have no rating, so they are stored as a neutral 3.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.submit_website_feedback(
    p_slug       TEXT,
    p_name       TEXT,
    p_contact    TEXT,
    p_rating     INTEGER,
    p_comment    TEXT,
    p_type       TEXT DEFAULT 'feedback',
    p_product_id UUID DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_business_id UUID;
    v_name TEXT := trim(COALESCE(p_name, ''));
    v_contact TEXT := trim(COALESCE(p_contact, ''));
    v_comment TEXT := trim(COALESCE(p_comment, ''));
    v_rating INTEGER := CASE WHEN p_type = 'suggestion' THEN 3 ELSE p_rating END;
    v_product TEXT;
    v_account UUID;
BEGIN
    IF length(v_name) NOT BETWEEN 1 AND 100
       OR length(v_contact) > 120
       OR length(v_comment) NOT BETWEEN 1 AND 2000
       OR p_type NOT IN ('feedback', 'suggestion', 'complaint')
       OR v_rating IS NULL
       OR v_rating NOT BETWEEN 1 AND 5 THEN
        RAISE EXCEPTION 'Invalid feedback' USING ERRCODE = '22023';
    END IF;

    SELECT id INTO v_business_id
    FROM public.businesses
    WHERE website_slug = p_slug AND deleted_at IS NULL;

    IF v_business_id IS NULL THEN
        RAISE EXCEPTION 'Unknown website' USING ERRCODE = 'P0002';
    END IF;

    IF (
        SELECT count(*) FROM public.complaints
        WHERE business_id = v_business_id
          AND last_modified_by = 'website'
          AND created_at > NOW() - INTERVAL '1 hour'
    ) >= 30 THEN
        RAISE EXCEPTION 'Too many submissions' USING ERRCODE = '53400';
    END IF;

    SELECT name INTO v_product FROM public.products
    WHERE id = p_product_id AND business_id = v_business_id AND deleted_at IS NULL;

    SELECT id INTO v_account FROM public.customer_accounts
    WHERE id = auth.uid() AND business_id = v_business_id;

    INSERT INTO public.complaints
        (business_id, customer_name, rating, comment, sentiment, branch, last_modified_by,
         feedback_type, product_id, account_id)
    VALUES (
        v_business_id,
        v_name,
        v_rating,
        CASE WHEN v_product IS NULL THEN '' ELSE 'About ' || v_product || E':\n' END
            || v_comment
            || CASE WHEN v_contact = '' THEN '' ELSE E'\n\nContact: ' || v_contact END,
        (CASE WHEN v_rating >= 4 THEN 'positive'
              WHEN v_rating = 3 THEN 'neutral'
              ELSE 'negative' END)::public.sentiment,
        'Website',
        'website',
        p_type,
        CASE WHEN v_product IS NULL THEN NULL ELSE p_product_id END,
        v_account
    );

    RETURN TRUE;
END;
$$;

-- ---------------------------------------------------------------------------
-- CUSTOMER: account
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_create_customer_account(p_uid UUID, p_slug TEXT, p_name TEXT, p_phone TEXT)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_uid UUID := p_uid;
    v_business_id UUID;
    v_customer_id UUID;
    v_email TEXT;
    v_name TEXT := left(trim(COALESCE(p_name, '')), 100);
    v_phone TEXT := public.fn_normalize_ke_phone(p_phone);
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
        RAISE EXCEPTION 'Please enter your name.';
    END IF;
    IF v_phone IS NULL THEN
        RAISE EXCEPTION 'Please enter a valid Kenyan phone number, like 0712 345 678.';
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
    RETURNING id INTO v_customer_id;

    INSERT INTO public.customer_accounts (id, business_id, customer_id, name, phone, email)
    VALUES (v_uid, v_business_id, v_customer_id, v_name, v_phone, v_email);

    RETURN v_uid;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_customer_account(p_slug TEXT, p_name TEXT, p_phone TEXT)
RETURNS UUID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT public.fn_create_customer_account(auth.uid(), p_slug, p_name, p_phone);
$$;

CREATE OR REPLACE FUNCTION public.update_my_account(p_name TEXT, p_phone TEXT, p_address TEXT, p_notes TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_name TEXT := left(trim(COALESCE(p_name, '')), 100);
    v_phone TEXT := public.fn_normalize_ke_phone(p_phone);
    v_customer_id UUID;
BEGIN
    IF v_name = '' THEN
        RAISE EXCEPTION 'Please enter your name.';
    END IF;
    IF v_phone IS NULL THEN
        RAISE EXCEPTION 'Please enter a valid Kenyan phone number, like 0712 345 678.';
    END IF;

    UPDATE public.customer_accounts
    SET name = v_name,
        phone = v_phone,
        delivery_address = left(NULLIF(trim(COALESCE(p_address, '')), ''), 300),
        delivery_notes = left(NULLIF(trim(COALESCE(p_notes, '')), ''), 300)
    WHERE id = auth.uid()
    RETURNING customer_id INTO v_customer_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Please finish setting up your account first.';
    END IF;

    UPDATE public.customers SET name = v_name, phone = v_phone WHERE id = v_customer_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- CUSTOMER: orders
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.place_online_order(
    p_items JSONB, p_fulfilment TEXT, p_address TEXT, p_notes TEXT, p_zone_id UUID DEFAULT NULL
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
    RETURN public.fn_build_online_order(auth.uid(), p_items, p_fulfilment, p_address, p_notes, NULL, p_zone_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.cancel_my_order(p_order_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    UPDATE public.online_orders
    SET status = 'cancelled'
    WHERE id = p_order_id
      AND account_id = auth.uid()
      AND status IN ('pending_payment', 'payment_failed');
    IF NOT FOUND THEN
        RAISE EXCEPTION 'This order can no longer be cancelled here. Please message us.';
    END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- CUSTOMER: schedules
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.save_order_schedule(
    p_id         UUID,
    p_items      JSONB,
    p_days       INTEGER[],
    p_fulfilment TEXT,
    p_address    TEXT,
    p_notes      TEXT,
    p_active     BOOLEAN
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_account public.customer_accounts%ROWTYPE;
    v_id UUID;
    v_address TEXT := NULLIF(trim(COALESCE(p_address, '')), '');
    v_next DATE;
BEGIN
    SELECT * INTO v_account FROM public.customer_accounts WHERE id = auth.uid();
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Please finish setting up your account first.';
    END IF;

    IF COALESCE(array_length(p_days, 1), 0) = 0 OR EXISTS (SELECT 1 FROM unnest(p_days) d WHERE d NOT BETWEEN 0 AND 6) THEN
        RAISE EXCEPTION 'Please choose at least one day.';
    END IF;
    IF jsonb_typeof(p_items) IS DISTINCT FROM 'array' OR jsonb_array_length(p_items) NOT BETWEEN 1 AND 30 THEN
        RAISE EXCEPTION 'Please add at least one product.';
    END IF;
    IF p_fulfilment NOT IN ('delivery', 'pickup') THEN
        RAISE EXCEPTION 'Please choose delivery or pickup.';
    END IF;
    IF p_fulfilment = 'delivery' AND v_address IS NULL THEN
        RAISE EXCEPTION 'Please enter your delivery location.';
    END IF;
    IF EXISTS (
        SELECT 1 FROM jsonb_array_elements(p_items) e
        LEFT JOIN public.products p
            ON p.id = (e->>'productId')::UUID
           AND p.business_id = v_account.business_id
           AND p.deleted_at IS NULL AND p.show_on_website AND p.price > 0
        WHERE p.id IS NULL
           OR COALESCE((e->>'quantity')::NUMERIC, 0) <= 0
           OR (e->>'quantity')::NUMERIC > 1000
    ) THEN
        RAISE EXCEPTION 'Please check the products in your schedule.';
    END IF;

    -- Starts tomorrow, so saving a schedule never creates an order immediately.
    v_next := public.fn_next_schedule_date(p_days, public.fn_nairobi_today() + 1);

    IF p_id IS NULL THEN
        IF (SELECT count(*) FROM public.customer_order_schedules WHERE account_id = v_account.id) >= 10 THEN
            RAISE EXCEPTION 'You can have up to 10 schedules.';
        END IF;
        INSERT INTO public.customer_order_schedules
            (business_id, account_id, items, days_of_week, fulfilment, delivery_address, notes, active, next_run_date)
        VALUES
            (v_account.business_id, v_account.id, p_items, p_days, p_fulfilment,
             CASE WHEN p_fulfilment = 'delivery' THEN v_address END,
             left(NULLIF(trim(COALESCE(p_notes, '')), ''), 500), COALESCE(p_active, TRUE), v_next)
        RETURNING id INTO v_id;
    ELSE
        UPDATE public.customer_order_schedules
        SET items = p_items,
            days_of_week = p_days,
            fulfilment = p_fulfilment,
            delivery_address = CASE WHEN p_fulfilment = 'delivery' THEN v_address END,
            notes = left(NULLIF(trim(COALESCE(p_notes, '')), ''), 500),
            active = COALESCE(p_active, TRUE),
            next_run_date = v_next
        WHERE id = p_id AND account_id = v_account.id
        RETURNING id INTO v_id;
        IF v_id IS NULL THEN
            RAISE EXCEPTION 'Schedule not found.';
        END IF;
    END IF;

    RETURN v_id;
EXCEPTION
    WHEN invalid_text_representation THEN
        RAISE EXCEPTION 'Please check the products in your schedule.';
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_order_schedule(p_id UUID)
RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
    DELETE FROM public.customer_order_schedules WHERE id = p_id AND account_id = auth.uid();
$$;

-- ---------------------------------------------------------------------------
-- CUSTOMER: messages
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.send_customer_message(p_body TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_account public.customer_accounts%ROWTYPE;
    v_body TEXT := trim(COALESCE(p_body, ''));
BEGIN
    SELECT * INTO v_account FROM public.customer_accounts WHERE id = auth.uid();
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Please finish setting up your account first.';
    END IF;
    IF length(v_body) NOT BETWEEN 1 AND 1000 THEN
        RAISE EXCEPTION 'Please write a message of up to 1000 characters.';
    END IF;
    IF (
        SELECT count(*) FROM public.customer_messages
        WHERE account_id = v_account.id AND sender = 'customer'
          AND created_at > NOW() - INTERVAL '1 hour'
    ) >= 20 THEN
        RAISE EXCEPTION 'You have sent many messages. Please wait a little before sending more.';
    END IF;

    INSERT INTO public.customer_messages (business_id, account_id, sender, body)
    VALUES (v_account.business_id, v_account.id, 'customer', v_body);

    PERFORM public.fn_notify_staff(v_account.business_id, 'New customer message',
        v_account.name || ': ' || left(v_body, 120), jsonb_build_object('accountId', v_account.id));
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_my_messages_read()
RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
    UPDATE public.customer_messages
    SET read_at = NOW()
    WHERE account_id = auth.uid() AND sender <> 'customer' AND read_at IS NULL;
$$;

-- ---------------------------------------------------------------------------
-- STAFF: order progress and replies
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.staff_update_online_order(p_order_id UUID, p_status TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_order public.online_orders%ROWTYPE;
    v_allowed TEXT[];
    v_message TEXT;
BEGIN
    SELECT * INTO v_order FROM public.online_orders WHERE id = p_order_id FOR UPDATE;
    IF NOT FOUND OR NOT v_order.business_id = ANY(public.get_user_business_ids()) THEN
        RAISE EXCEPTION 'Order not found.';
    END IF;

    v_allowed := CASE v_order.status
        WHEN 'pending_payment' THEN ARRAY['cancelled']
        WHEN 'payment_failed' THEN ARRAY['cancelled']
        WHEN 'paid' THEN ARRAY['preparing']
        WHEN 'preparing' THEN
            CASE v_order.fulfilment WHEN 'delivery' THEN ARRAY['out_for_delivery'] ELSE ARRAY['ready_for_pickup'] END
        WHEN 'out_for_delivery' THEN ARRAY['completed']
        WHEN 'ready_for_pickup' THEN ARRAY['completed']
        ELSE ARRAY[]::TEXT[]
    END;
    IF NOT p_status = ANY(v_allowed) THEN
        RAISE EXCEPTION 'That status change is not allowed.';
    END IF;

    UPDATE public.online_orders SET status = p_status WHERE id = p_order_id;

    v_message := 'Order #' || v_order.order_number || CASE p_status
        WHEN 'preparing' THEN ' is being prepared.'
        WHEN 'out_for_delivery' THEN ' is on its way.'
        WHEN 'ready_for_pickup' THEN ' is ready for pickup.'
        WHEN 'completed' THEN ' is complete. Thank you!'
        ELSE ' was cancelled.'
    END;
    PERFORM public.fn_customer_message(v_order.account_id, v_order.id, v_message);
END;
$$;

CREATE OR REPLACE FUNCTION public.staff_clear_order_attention(p_order_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    UPDATE public.online_orders
    SET needs_attention = FALSE
    WHERE id = p_order_id AND business_id = ANY(public.get_user_business_ids());
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Order not found.';
    END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.staff_send_customer_message(p_account_id UUID, p_body TEXT, p_staff_name TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_business_id UUID;
    v_body TEXT := trim(COALESCE(p_body, ''));
BEGIN
    SELECT business_id INTO v_business_id FROM public.customer_accounts WHERE id = p_account_id;
    IF v_business_id IS NULL OR NOT v_business_id = ANY(public.get_user_business_ids()) THEN
        RAISE EXCEPTION 'Customer not found.';
    END IF;
    IF length(v_body) NOT BETWEEN 1 AND 1000 THEN
        RAISE EXCEPTION 'Please write a message of up to 1000 characters.';
    END IF;

    INSERT INTO public.customer_messages (business_id, account_id, sender, staff_name, body)
    VALUES (v_business_id, p_account_id, 'staff', left(p_staff_name, 100), v_body);

    UPDATE public.customer_messages
    SET read_at = NOW()
    WHERE account_id = p_account_id AND sender = 'customer' AND read_at IS NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.staff_mark_customer_messages_read(p_account_id UUID)
RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
    UPDATE public.customer_messages
    SET read_at = NOW()
    WHERE account_id = p_account_id
      AND sender = 'customer'
      AND read_at IS NULL
      AND business_id = ANY(public.get_user_business_ids());
$$;

-- ---------------------------------------------------------------------------
-- BACKEND: M-Pesa payment lifecycle (service_role only)
-- ---------------------------------------------------------------------------

-- Checks the caller owns a payable order and that it can still be fulfilled.
CREATE OR REPLACE FUNCTION public.begin_order_payment(p_order_id UUID, p_user_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_order public.online_orders%ROWTYPE;
    v_short TEXT;
BEGIN
    SELECT * INTO v_order FROM public.online_orders
    WHERE id = p_order_id AND account_id = p_user_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Order not found.';
    END IF;
    IF v_order.status NOT IN ('pending_payment', 'payment_failed') THEN
        RAISE EXCEPTION 'This order has already been paid or closed.';
    END IF;

    SELECT i.product_name INTO v_short
    FROM public.online_order_items i
    JOIN public.products p ON p.id = i.product_id
    WHERE i.order_id = p_order_id AND p.stock < i.quantity
    LIMIT 1;
    IF v_short IS NOT NULL THEN
        RAISE EXCEPTION 'We no longer have enough % for this order. Please cancel it and order again.', v_short;
    END IF;

    RETURN jsonb_build_object('total', v_order.total, 'orderNumber', v_order.order_number, 'businessId', v_order.business_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.record_order_checkout(
    p_order_id UUID, p_checkout_request_id TEXT, p_merchant_request_id TEXT, p_phone TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    INSERT INTO public.mpesa_transactions
        (business_id, online_order_id, checkout_request_id, merchant_request_id, phone, amount)
    SELECT business_id, id, p_checkout_request_id, p_merchant_request_id, p_phone, total
    FROM public.online_orders
    WHERE id = p_order_id;

    UPDATE public.online_orders
    SET status = 'pending_payment'
    WHERE id = p_order_id AND status = 'payment_failed';
END;
$$;

-- Applies a Daraja result exactly once per checkout. Successful money always gets
-- recorded; anything unexpected is flagged for staff instead of being dropped.
CREATE OR REPLACE FUNCTION public.confirm_online_order_payment(
    p_checkout_request_id TEXT,
    p_result_code         INTEGER,
    p_amount              NUMERIC,
    p_receipt             TEXT,
    p_raw                 JSONB
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_payment public.mpesa_transactions%ROWTYPE;
    v_order   public.online_orders%ROWTYPE;
    v_tx_id   UUID;
    v_short   TEXT;
    v_reason  TEXT;
BEGIN
    SELECT * INTO v_payment FROM public.mpesa_transactions
    WHERE checkout_request_id = p_checkout_request_id AND online_order_id IS NOT NULL
    FOR UPDATE;
    IF NOT FOUND THEN
        RETURN 'unknown';
    END IF;
    -- A status check can mark a row Failed before the customer's success callback arrives,
    -- so only Completed blocks a success. Money received must never be dropped.
    IF v_payment.status = 'Completed' OR (v_payment.status <> 'Pending' AND p_result_code <> 0) THEN
        RETURN 'duplicate';
    END IF;

    SELECT * INTO v_order FROM public.online_orders WHERE id = v_payment.online_order_id FOR UPDATE;

    IF p_result_code <> 0 THEN
        UPDATE public.mpesa_transactions
        SET status = 'Failed', raw_callback = p_raw
        WHERE id = v_payment.id;

        IF v_order.status = 'pending_payment' AND NOT EXISTS (
            SELECT 1 FROM public.mpesa_transactions m
            WHERE m.online_order_id = v_order.id AND m.status = 'Pending' AND m.id <> v_payment.id
        ) THEN
            UPDATE public.online_orders SET status = 'payment_failed' WHERE id = v_order.id;
        END IF;
        RETURN 'failed';
    END IF;

    UPDATE public.mpesa_transactions
    SET status = 'Completed',
        amount = COALESCE(p_amount, amount),
        receipt_number = p_receipt,
        mpesa_receipt_timestamp = NOW(),
        raw_callback = p_raw
    WHERE id = v_payment.id;

    IF COALESCE(p_amount, 0) <> v_order.total THEN
        v_reason := format('M-Pesa receipt %s paid %s but the order total is %s.', p_receipt, p_amount, v_order.total);
    ELSIF v_order.status NOT IN ('pending_payment', 'payment_failed') THEN
        v_reason := format('Extra M-Pesa payment %s of %s arrived on an order that was already %s. It may need a refund.',
                           p_receipt, p_amount, v_order.status);
    END IF;

    IF v_reason IS NOT NULL THEN
        UPDATE public.online_orders
        SET needs_attention = TRUE,
            attention_reason = concat_ws(' ', attention_reason, v_reason)
        WHERE id = v_order.id;
        PERFORM public.fn_notify_staff(v_order.business_id, 'Online payment needs checking',
            'Order #' || v_order.order_number || ': ' || v_reason, jsonb_build_object('orderId', v_order.id));
        RETURN 'flagged';
    END IF;

    SELECT i.product_name INTO v_short
    FROM public.online_order_items i
    JOIN public.products p ON p.id = i.product_id
    WHERE i.order_id = v_order.id AND p.stock < i.quantity
    LIMIT 1;

    INSERT INTO public.transactions
        (business_id, total, discount, tax, final_total, amount_paid, payment_method,
         customer_id, customer_name, staff_name, note, is_delivery, delivery_fee, reference_id)
    SELECT v_order.business_id, v_order.subtotal + v_order.delivery_fee, v_order.discount, 0, v_order.total, v_order.total, 'M-Pesa',
           a.customer_id, v_order.customer_name, 'Website',
           'Online order #' || v_order.order_number || ', M-Pesa ' || COALESCE(p_receipt, ''),
           v_order.fulfilment = 'delivery', v_order.delivery_fee, 'online-' || v_order.id
    FROM (SELECT 1) one
    LEFT JOIN public.customer_accounts a ON a.id = v_order.account_id
    RETURNING id INTO v_tx_id;

    INSERT INTO public.transaction_items (transaction_id, product_id, product_name, unit_price, quantity, line_total)
    SELECT v_tx_id, product_id, product_name, unit_price, quantity, line_total
    FROM public.online_order_items
    WHERE order_id = v_order.id;

    UPDATE public.mpesa_transactions SET transaction_id = v_tx_id WHERE id = v_payment.id;

    UPDATE public.online_orders
    SET status = 'paid',
        paid_at = NOW(),
        mpesa_receipt = p_receipt,
        transaction_id = v_tx_id,
        needs_attention = v_short IS NOT NULL,
        attention_reason = CASE WHEN v_short IS NOT NULL
            THEN 'Paid, but stock of ' || v_short || ' ran short before payment arrived.' END
    WHERE id = v_order.id;

    PERFORM public.fn_customer_message(v_order.account_id, v_order.id,
        'We received your payment for order #' || v_order.order_number || '. M-Pesa receipt: ' || COALESCE(p_receipt, '-') || '.');
    PERFORM public.fn_notify_staff(v_order.business_id, 'New online order',
        'Order #' || v_order.order_number || ' from ' || v_order.customer_name || ' is paid.'
            || CASE WHEN v_short IS NOT NULL THEN ' Stock of ' || v_short || ' is short.' ELSE '' END,
        jsonb_build_object('orderId', v_order.id));

    RETURN 'paid';
END;
$$;

-- Daraja says the customer paid, but the callback carrying the receipt hasn't arrived.
-- Staff are told once. If the callback arrives later it settles the order and clears this.
CREATE OR REPLACE FUNCTION public.flag_order_payment_unconfirmed(p_order_id UUID, p_checkout_request_id TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_order public.online_orders%ROWTYPE;
    v_reason TEXT := 'M-Pesa reports this order as paid (' || p_checkout_request_id
        || ') but its confirmation never arrived. Check the M-Pesa statement.';
BEGIN
    UPDATE public.online_orders
    SET needs_attention = TRUE, attention_reason = v_reason
    WHERE id = p_order_id
      AND NOT needs_attention
      AND status IN ('pending_payment', 'payment_failed')
    RETURNING * INTO v_order;

    IF FOUND THEN
        PERFORM public.fn_notify_staff(v_order.business_id, 'Online payment needs checking',
            'Order #' || v_order.order_number || ': ' || v_reason, jsonb_build_object('orderId', v_order.id));
    END IF;
END;
$$;

-- Returns TRUE and counts the call if the visitor and the business are under their limits.
CREATE OR REPLACE FUNCTION public.consume_assistant_quota(p_business_id UUID, p_visitor TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_visitor_uses INTEGER;
    v_business_uses INTEGER;
BEGIN
    INSERT INTO public.assistant_usage (bucket, window_start, uses)
    VALUES ('visitor:' || p_visitor, date_trunc('hour', NOW()), 1)
    ON CONFLICT (bucket, window_start) DO UPDATE SET uses = assistant_usage.uses + 1
    RETURNING uses INTO v_visitor_uses;

    INSERT INTO public.assistant_usage (bucket, window_start, uses)
    VALUES ('business:' || p_business_id, date_trunc('day', NOW()), 1)
    ON CONFLICT (bucket, window_start) DO UPDATE SET uses = assistant_usage.uses + 1
    RETURNING uses INTO v_business_uses;

    RETURN v_visitor_uses <= 40 AND v_business_uses <= 2000;
END;
$$;

-- ---------------------------------------------------------------------------
-- BACKEND: daily job. Raises due schedules as unpaid orders, because M-Pesa needs
-- the customer to approve each payment. Also closes abandoned unpaid orders.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.run_customer_portal_daily()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_today DATE := public.fn_nairobi_today();
    v_schedule public.customer_order_schedules%ROWTYPE;
    v_order_id UUID;
    v_number BIGINT;
    v_total NUMERIC;
    v_created INTEGER := 0;
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

    FOR v_schedule IN
        SELECT * FROM public.customer_order_schedules
        WHERE active AND next_run_date <= v_today
        FOR UPDATE SKIP LOCKED
    LOOP
        BEGIN
            v_order_id := public.fn_build_online_order(
                v_schedule.account_id, v_schedule.items, v_schedule.fulfilment,
                v_schedule.delivery_address, v_schedule.notes, v_schedule.id);
            SELECT order_number, total INTO v_number, v_total FROM public.online_orders WHERE id = v_order_id;
            PERFORM public.fn_customer_message(v_schedule.account_id, v_order_id,
                'Your scheduled order #' || v_number || ' is ready. Please pay ' || v_total || ' from your Orders page to confirm it.');
            v_created := v_created + 1;
        EXCEPTION WHEN OTHERS THEN
            PERFORM public.fn_customer_message(v_schedule.account_id, NULL,
                'We couldn''t prepare your scheduled order today: ' || SQLERRM);
        END;

        UPDATE public.customer_order_schedules
        SET last_run_date = v_today,
            next_run_date = public.fn_next_schedule_date(days_of_week, v_today + 1)
        WHERE id = v_schedule.id;
    END LOOP;

    RETURN v_created;
END;
$$;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
        PERFORM cron.unschedule('customer-portal-daily')
        WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'customer-portal-daily');
        -- 02:00 UTC is 05:00 in Nairobi.
        PERFORM cron.schedule('customer-portal-daily', '0 2 * * *',
            $cron$SELECT public.run_customer_portal_daily()$cron$);
    END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- FUNCTION ACCESS
-- ---------------------------------------------------------------------------
DO $$
DECLARE
    fn TEXT;
BEGIN
    FOREACH fn IN ARRAY ARRAY[
        'fn_normalize_ke_phone(TEXT)', 'fn_nairobi_today()', 'fn_next_schedule_date(INTEGER[], DATE)',
        'fn_notify_staff(UUID, TEXT, TEXT, JSONB)', 'fn_customer_message(UUID, UUID, TEXT)',
        'fn_build_online_order(UUID, JSONB, TEXT, TEXT, TEXT, UUID, UUID)', 'fn_create_customer_account(UUID, TEXT, TEXT, TEXT)', 'run_customer_portal_daily()',
        'begin_order_payment(UUID, UUID)', 'record_order_checkout(UUID, TEXT, TEXT, TEXT)',
        'confirm_online_order_payment(TEXT, INTEGER, NUMERIC, TEXT, JSONB)', 'consume_assistant_quota(UUID, TEXT)',
        'flag_order_payment_unconfirmed(UUID, TEXT)'
    ] LOOP
        EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon, authenticated', fn);
    END LOOP;

    FOREACH fn IN ARRAY ARRAY[
        'begin_order_payment(UUID, UUID)', 'record_order_checkout(UUID, TEXT, TEXT, TEXT)',
        'confirm_online_order_payment(TEXT, INTEGER, NUMERIC, TEXT, JSONB)', 'consume_assistant_quota(UUID, TEXT)',
        'flag_order_payment_unconfirmed(UUID, TEXT)',
        'fn_build_online_order(UUID, JSONB, TEXT, TEXT, TEXT, UUID, UUID)', 'fn_create_customer_account(UUID, TEXT, TEXT, TEXT)'
    ] LOOP
        EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO service_role', fn);
    END LOOP;

    FOREACH fn IN ARRAY ARRAY[
        'create_customer_account(TEXT, TEXT, TEXT)', 'update_my_account(TEXT, TEXT, TEXT, TEXT)',
        'place_online_order(JSONB, TEXT, TEXT, TEXT, UUID)', 'cancel_my_order(UUID)',
        'save_order_schedule(UUID, JSONB, INTEGER[], TEXT, TEXT, TEXT, BOOLEAN)', 'delete_order_schedule(UUID)',
        'send_customer_message(TEXT)', 'mark_my_messages_read()',
        'staff_update_online_order(UUID, TEXT)', 'staff_clear_order_attention(UUID)',
        'staff_send_customer_message(UUID, TEXT, TEXT)', 'staff_mark_customer_messages_read(UUID)'
    ] LOOP
        EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon', fn);
        EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated', fn);
    END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.submit_website_feedback(TEXT, TEXT, TEXT, INTEGER, TEXT, TEXT, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_website_feedback(TEXT, TEXT, TEXT, INTEGER, TEXT, TEXT, UUID) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;
