-- =============================================================================
-- 20261110006_website_pages.sql
-- Website info pages that staff can edit: About, Help, Delivery, Payments,
-- Returns, Terms, Privacy and Cookies, plus opening hours and a WhatsApp number.
-- =============================================================================
-- Why: the customer website now has a full set of shop and legal pages. Each page
-- has a default built from live business data (name, contacts, delivery areas,
-- minimum order, points rule). Staff can replace any page's text from the app
-- under Online Store > Pages. An empty page falls back to the default.
-- The storefront also exposes the points rule (customer-safe values only), so the
-- website explains rewards with the same numbers the database uses.
-- Dependencies: 20261105010 (customer portal), 20261108002 (points rule)
-- =============================================================================

BEGIN;

ALTER TABLE public.website_settings
    ADD COLUMN IF NOT EXISTS pages         JSONB NOT NULL DEFAULT '{}'::jsonb,
    ADD COLUMN IF NOT EXISTS opening_hours TEXT,
    ADD COLUMN IF NOT EXISTS whatsapp      TEXT;

ALTER TABLE public.website_settings DROP CONSTRAINT IF EXISTS website_settings_pages_check;
ALTER TABLE public.website_settings ADD CONSTRAINT website_settings_pages_check CHECK (
    jsonb_typeof(pages) = 'object'
    AND pg_column_size(pages) < 200000
);

ALTER TABLE public.website_settings DROP CONSTRAINT IF EXISTS website_settings_hours_check;
ALTER TABLE public.website_settings ADD CONSTRAINT website_settings_hours_check CHECK (
    (opening_hours IS NULL OR length(opening_hours) <= 500)
    AND (whatsapp IS NULL OR whatsapp ~ '^\+?[0-9 ]{7,20}$')
);

-- Same as 20261105010, plus pages, openingHours, whatsapp and loyalty.
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
