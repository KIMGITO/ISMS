-- =============================================================================
-- 20261110008_reviews_promotions.sql
-- Customer reviews and promo codes for the customer website.
-- =============================================================================
-- Reviews: signed-in customers review a product, or the shop as a whole. Every
-- review waits for staff approval (Online Store > Reviews) before it appears on
-- the website, and staff can reply. "Verified buyer" is worked out here from paid
-- orders, so a customer can't claim it. One review per customer per product;
-- editing it sends it back for approval.
--
-- Promo codes: staff create them in Online Store > Promotions. The website checks
-- a code with check_promo_code (no sign-in needed, so the cart can show the saving),
-- but only place_online_order applies it, on the server, after normal pricing. The
-- saving comes off products only (never delivery) and adds to online_orders.discount,
-- which confirm_online_order_payment already carries into the sale, so profit,
-- receipts and points stay right. A code used on an order that is later cancelled
-- frees that use again. Scheduled orders never take a code.
-- Dependencies: 20261105010, 20261105015, 20261109001, 20261110006
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- REVIEWS
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.website_reviews (
    id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id   UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    account_id    UUID REFERENCES public.customer_accounts(id) ON DELETE SET NULL,
    product_id    UUID REFERENCES public.products(id) ON DELETE CASCADE,
    rating        INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
    title         TEXT CHECK (title IS NULL OR length(title) <= 120),
    body          TEXT NOT NULL CHECK (length(trim(body)) BETWEEN 3 AND 2000),
    display_name  TEXT NOT NULL CHECK (length(display_name) <= 60),
    verified      BOOLEAN NOT NULL DEFAULT FALSE,
    status        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'hidden')),
    featured      BOOLEAN NOT NULL DEFAULT FALSE,
    staff_reply   TEXT CHECK (staff_reply IS NULL OR length(staff_reply) <= 1000),
    replied_by    TEXT,
    replied_at    TIMESTAMPTZ,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_website_reviews_account_product
    ON public.website_reviews (account_id, COALESCE(product_id, '00000000-0000-0000-0000-000000000000'::uuid));
CREATE INDEX IF NOT EXISTS idx_website_reviews_public
    ON public.website_reviews (business_id, status, created_at DESC);

ALTER TABLE public.website_reviews ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.website_reviews FROM anon;
GRANT SELECT, UPDATE, DELETE ON public.website_reviews TO authenticated;

DROP POLICY IF EXISTS pol_website_reviews_staff_select ON public.website_reviews;
CREATE POLICY pol_website_reviews_staff_select ON public.website_reviews FOR SELECT
    USING (business_id = ANY(public.get_user_business_ids()) OR account_id = auth.uid());
DROP POLICY IF EXISTS pol_website_reviews_staff_update ON public.website_reviews;
CREATE POLICY pol_website_reviews_staff_update ON public.website_reviews FOR UPDATE
    USING (public.is_owner_or_admin(business_id))
    WITH CHECK (public.is_owner_or_admin(business_id));
DROP POLICY IF EXISTS pol_website_reviews_staff_delete ON public.website_reviews;
CREATE POLICY pol_website_reviews_staff_delete ON public.website_reviews FOR DELETE
    USING (public.is_owner_or_admin(business_id));

-- "Jane Wanjiku" is shown as "Jane W.", so reviews never publish a full name.
CREATE OR REPLACE FUNCTION public.fn_review_display_name(p_name TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT left(
        initcap(split_part(trim(p_name), ' ', 1))
        || CASE WHEN position(' ' IN trim(p_name)) > 0
                THEN ' ' || upper(left(trim(substring(trim(p_name) FROM position(' ' IN trim(p_name)))), 1)) || '.'
                ELSE '' END,
        60);
$$;

CREATE OR REPLACE FUNCTION public.submit_my_review(
    p_product_id UUID,
    p_rating     INTEGER,
    p_title      TEXT,
    p_body       TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_account  public.customer_accounts%ROWTYPE;
    v_verified BOOLEAN;
    v_id       UUID;
    v_title    TEXT := NULLIF(left(trim(COALESCE(p_title, '')), 120), '');
    v_body     TEXT := trim(COALESCE(p_body, ''));
BEGIN
    SELECT * INTO v_account FROM public.customer_accounts WHERE id = auth.uid();
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Please sign in to write a review.';
    END IF;
    IF p_rating IS NULL OR p_rating NOT BETWEEN 1 AND 5 THEN
        RAISE EXCEPTION 'Please choose a star rating.';
    END IF;
    IF length(v_body) < 3 THEN
        RAISE EXCEPTION 'Please write a few words about your experience.';
    END IF;
    IF length(v_body) > 2000 THEN
        RAISE EXCEPTION 'Please keep your review under 2000 characters.';
    END IF;
    IF p_product_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.products
        WHERE id = p_product_id AND business_id = v_account.business_id AND deleted_at IS NULL AND show_on_website
    ) THEN
        RAISE EXCEPTION 'That product is no longer available.';
    END IF;
    -- A few reviews an hour is plenty for a real customer.
    IF (SELECT count(*) FROM public.website_reviews
        WHERE account_id = v_account.id AND updated_at > NOW() - INTERVAL '1 hour') >= 5 THEN
        RAISE EXCEPTION 'You have sent several reviews just now. Please try again later.';
    END IF;

    SELECT EXISTS (
        SELECT 1 FROM public.online_orders o
        WHERE o.account_id = v_account.id
          AND o.status IN ('paid', 'preparing', 'out_for_delivery', 'ready_for_pickup', 'completed')
          AND (p_product_id IS NULL OR EXISTS (
              SELECT 1 FROM public.online_order_items i WHERE i.order_id = o.id AND i.product_id = p_product_id))
    ) INTO v_verified;

    INSERT INTO public.website_reviews
        (business_id, account_id, product_id, rating, title, body, display_name, verified)
    VALUES
        (v_account.business_id, v_account.id, p_product_id, p_rating, v_title, v_body,
         public.fn_review_display_name(v_account.name), v_verified)
    ON CONFLICT (account_id, COALESCE(product_id, '00000000-0000-0000-0000-000000000000'::uuid))
    DO UPDATE SET rating = EXCLUDED.rating, title = EXCLUDED.title, body = EXCLUDED.body,
                  display_name = EXCLUDED.display_name, verified = EXCLUDED.verified,
                  status = 'pending', featured = FALSE, updated_at = NOW()
    RETURNING id INTO v_id;
    RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.submit_my_review(UUID, INTEGER, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_my_review(UUID, INTEGER, TEXT, TEXT) TO authenticated;

-- ---------------------------------------------------------------------------
-- PROMO CODES
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.website_promo_codes (
    id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id       UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    code              TEXT NOT NULL CHECK (code ~ '^[A-Z0-9][A-Z0-9-]{2,23}$'),
    description       TEXT CHECK (description IS NULL OR length(description) <= 200),
    kind              TEXT NOT NULL CHECK (kind IN ('percent', 'amount')),
    value             NUMERIC(14,2) NOT NULL CHECK (value > 0),
    min_order         NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (min_order >= 0),
    starts_at         TIMESTAMPTZ,
    ends_at           TIMESTAMPTZ,
    max_uses          INTEGER CHECK (max_uses IS NULL OR max_uses > 0),
    once_per_customer BOOLEAN NOT NULL DEFAULT TRUE,
    show_on_website   BOOLEAN NOT NULL DEFAULT FALSE,
    active            BOOLEAN NOT NULL DEFAULT TRUE,
    created_by        TEXT,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (business_id, code),
    CHECK (kind <> 'percent' OR value <= 90),
    CHECK (ends_at IS NULL OR starts_at IS NULL OR ends_at > starts_at)
);

ALTER TABLE public.website_promo_codes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.website_promo_codes FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.website_promo_codes TO authenticated;
DROP POLICY IF EXISTS pol_promo_codes_select ON public.website_promo_codes;
CREATE POLICY pol_promo_codes_select ON public.website_promo_codes FOR SELECT
    USING (business_id = ANY(public.get_user_business_ids()));
DROP POLICY IF EXISTS pol_promo_codes_write ON public.website_promo_codes;
CREATE POLICY pol_promo_codes_write ON public.website_promo_codes FOR ALL
    USING (public.is_owner_or_admin(business_id))
    WITH CHECK (public.is_owner_or_admin(business_id));

ALTER TABLE public.online_orders
    ADD COLUMN IF NOT EXISTS promo_code_id UUID REFERENCES public.website_promo_codes(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS promo_code    TEXT,
    ADD COLUMN IF NOT EXISTS promo_value   NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (promo_value >= 0);

CREATE INDEX IF NOT EXISTS idx_online_orders_promo ON public.online_orders (promo_code_id) WHERE promo_code_id IS NOT NULL;

-- What a code takes off this subtotal, or a customer-facing reason it can't be used.
-- p_account_id NULL skips the once-per-customer check (the cart preview before sign-in).
CREATE OR REPLACE FUNCTION public.fn_promo_value(
    p_promo      public.website_promo_codes,
    p_subtotal   NUMERIC,
    p_account_id UUID
)
RETURNS NUMERIC
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_uses INTEGER;
BEGIN
    IF NOT p_promo.active OR (p_promo.starts_at IS NOT NULL AND NOW() < p_promo.starts_at) THEN
        RAISE EXCEPTION 'That promo code isn''t active yet.';
    END IF;
    IF p_promo.ends_at IS NOT NULL AND NOW() >= p_promo.ends_at THEN
        RAISE EXCEPTION 'That promo code has expired.';
    END IF;
    IF p_subtotal < p_promo.min_order THEN
        RAISE EXCEPTION 'That code needs an order of at least % in products.', p_promo.min_order;
    END IF;
    IF p_promo.max_uses IS NOT NULL THEN
        SELECT count(*) INTO v_uses FROM public.online_orders
        WHERE promo_code_id = p_promo.id AND status <> 'cancelled';
        IF v_uses >= p_promo.max_uses THEN
            RAISE EXCEPTION 'That promo code has been fully used.';
        END IF;
    END IF;
    IF p_account_id IS NOT NULL AND p_promo.once_per_customer AND EXISTS (
        SELECT 1 FROM public.online_orders
        WHERE promo_code_id = p_promo.id AND account_id = p_account_id AND status <> 'cancelled'
    ) THEN
        RAISE EXCEPTION 'You have already used that promo code.';
    END IF;

    RETURN LEAST(
        p_subtotal,
        CASE WHEN p_promo.kind = 'percent'
             THEN round(p_subtotal * p_promo.value / 100, 2)
             ELSE p_promo.value END
    );
END;
$$;
REVOKE ALL ON FUNCTION public.fn_promo_value(public.website_promo_codes, NUMERIC, UUID) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.check_promo_code(p_slug TEXT, p_code TEXT, p_subtotal NUMERIC)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_promo public.website_promo_codes%ROWTYPE;
    v_value NUMERIC;
BEGIN
    SELECT pc.* INTO v_promo
    FROM public.website_promo_codes pc
    JOIN public.businesses b ON b.id = pc.business_id
    WHERE b.website_slug = p_slug AND b.deleted_at IS NULL
      AND pc.code = upper(trim(COALESCE(p_code, '')));
    IF NOT FOUND THEN
        RAISE EXCEPTION 'We don''t recognise that promo code.';
    END IF;
    v_value := public.fn_promo_value(v_promo, COALESCE(p_subtotal, 0), auth.uid());
    RETURN jsonb_build_object(
        'code', v_promo.code,
        'description', v_promo.description,
        'kind', v_promo.kind,
        'value', v_promo.value,
        'saving', v_value
    );
END;
$$;
REVOKE ALL ON FUNCTION public.check_promo_code(TEXT, TEXT, NUMERIC) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.check_promo_code(TEXT, TEXT, NUMERIC) TO anon, authenticated;

-- The website's order entry point, now taking an optional promo code. The old
-- six-argument version is dropped so calls can't be ambiguous.
DROP FUNCTION IF EXISTS public.place_online_order(JSONB, TEXT, TEXT, TEXT, UUID, INTEGER);
CREATE OR REPLACE FUNCTION public.place_online_order(
    p_items JSONB, p_fulfilment TEXT, p_address TEXT, p_notes TEXT,
    p_zone_id UUID DEFAULT NULL, p_points INTEGER DEFAULT 0, p_promo_code TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_order_id UUID;
    v_order    public.online_orders%ROWTYPE;
    v_promo    public.website_promo_codes%ROWTYPE;
    v_saving   NUMERIC(14,2);
    v_raw      NUMERIC(14,2);
    v_total    NUMERIC(14,2);
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

    v_order_id := public.fn_build_online_order(auth.uid(), p_items, p_fulfilment, p_address, p_notes, NULL, p_zone_id, p_points);

    IF NULLIF(trim(COALESCE(p_promo_code, '')), '') IS NOT NULL THEN
        SELECT * INTO v_order FROM public.online_orders WHERE id = v_order_id;
        -- Locked, so two orders can't both take the last use of a limited code.
        SELECT * INTO v_promo FROM public.website_promo_codes
        WHERE business_id = v_order.business_id AND code = upper(trim(p_promo_code))
        FOR UPDATE;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'We don''t recognise that promo code.';
        END IF;
        v_saving := public.fn_promo_value(v_promo, v_order.subtotal, auth.uid());

        v_raw := v_order.subtotal + v_order.delivery_fee - COALESCE(v_order.points_value, 0) - v_saving;
        v_total := floor(v_raw);
        IF v_total < 1 THEN
            RAISE EXCEPTION 'With that code and your points the total is under 1 shilling. Please use fewer points.';
        END IF;

        UPDATE public.online_orders
        SET promo_code_id = v_promo.id,
            promo_code = v_promo.code,
            promo_value = v_saving,
            total = v_total,
            discount = subtotal + delivery_fee - v_total
        WHERE id = v_order_id;
    END IF;

    RETURN v_order_id;
END;
$$;
REVOKE ALL ON FUNCTION public.place_online_order(JSONB, TEXT, TEXT, TEXT, UUID, INTEGER, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.place_online_order(JSONB, TEXT, TEXT, TEXT, UUID, INTEGER, TEXT) TO authenticated;

-- ---------------------------------------------------------------------------
-- STOREFRONT: same as 20261110006, plus approved reviews and public promotions.
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
            'assistantEnabled', COALESCE(s.assistant_enabled, TRUE),
            'openingHours', NULLIF(trim(s.opening_hours), ''),
            'whatsapp', NULLIF(trim(s.whatsapp), '')
        ),
        'pages', COALESCE(s.pages, '{}'::jsonb),
        'loyalty', jsonb_build_object(
            'pointsPerShilling', 2,
            'valueBronze', COALESCE(l.value_bronze, 0.02),
            'valueSilver', COALESCE(l.value_silver, 0.01),
            'valueGold', COALESCE(l.value_gold, 0.005),
            'minRedeem', COALESCE(l.min_redeem_points, 100)
        ),
        'reviews', COALESCE((
            SELECT jsonb_agg(r ORDER BY r->>'createdAt' DESC)
            FROM (
                SELECT jsonb_build_object(
                    'id', rv.id,
                    'productId', rv.product_id,
                    'rating', rv.rating,
                    'title', rv.title,
                    'body', rv.body,
                    'name', rv.display_name,
                    'verified', rv.verified,
                    'featured', rv.featured,
                    'reply', rv.staff_reply,
                    'createdAt', rv.created_at
                ) AS r
                FROM public.website_reviews rv
                WHERE rv.business_id = b.id AND rv.status = 'approved'
                ORDER BY rv.featured DESC, rv.created_at DESC
                LIMIT 300
            ) recent
        ), '[]'::jsonb),
        'promotions', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                'code', pc.code,
                'description', pc.description,
                'kind', pc.kind,
                'value', pc.value,
                'minOrder', pc.min_order,
                'endsAt', pc.ends_at
            ) ORDER BY pc.created_at DESC)
            FROM public.website_promo_codes pc
            WHERE pc.business_id = b.id AND pc.active AND pc.show_on_website
              AND (pc.starts_at IS NULL OR pc.starts_at <= NOW())
              AND (pc.ends_at IS NULL OR pc.ends_at > NOW())
        ), '[]'::jsonb),
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
    LEFT JOIN public.loyalty_settings l ON l.business_id = b.id
    WHERE b.website_slug = p_slug
      AND b.deleted_at IS NULL;
$$;

COMMIT;
