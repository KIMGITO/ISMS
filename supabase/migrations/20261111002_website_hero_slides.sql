-- Home page banner (hero slider) managed from the app: Online Store > Home banner.
--
-- website_settings.hero_slides holds up to 6 slides:
--   { "id": text, "title": text, "body": text, "ctaLabel": text, "ctaHref": text,
--     "images": [url, url?, url?], "hidden": boolean? }
-- Owners and admins already are the only ones who may write website_settings (RLS from
-- 20261105010). The CHECK below makes the database refuse anything the website shouldn't show:
-- unsafe links (only /paths on the site and https:// addresses), non-https images, over-long
-- text, too many slides or images. The public storefront returns only slides that aren't hidden;
-- when there are none, the website shows its built-in slides.

BEGIN;

CREATE OR REPLACE FUNCTION public.fn_valid_hero_slides(p_slides JSONB)
RETURNS BOOLEAN
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
    v_slide JSONB;
    v_image JSONB;
    v_href  TEXT;
BEGIN
    IF p_slides IS NULL OR jsonb_typeof(p_slides) <> 'array' OR jsonb_array_length(p_slides) > 6 THEN
        RETURN FALSE;
    END IF;
    FOR v_slide IN SELECT value FROM jsonb_array_elements(p_slides) LOOP
        IF jsonb_typeof(v_slide) <> 'object' THEN RETURN FALSE; END IF;
        -- Only the known keys, so nothing unexpected reaches the public website.
        IF EXISTS (
            SELECT 1 FROM jsonb_object_keys(v_slide) k
            WHERE k NOT IN ('id', 'title', 'body', 'ctaLabel', 'ctaHref', 'images', 'hidden')
        ) THEN RETURN FALSE; END IF;
        IF jsonb_typeof(v_slide->'title') IS DISTINCT FROM 'string'
           OR length(trim(v_slide->>'title')) NOT BETWEEN 1 AND 90 THEN RETURN FALSE; END IF;
        IF v_slide ? 'id' AND (jsonb_typeof(v_slide->'id') <> 'string' OR length(v_slide->>'id') > 40) THEN RETURN FALSE; END IF;
        IF v_slide ? 'body' AND (jsonb_typeof(v_slide->'body') <> 'string' OR length(v_slide->>'body') > 160) THEN RETURN FALSE; END IF;
        IF v_slide ? 'hidden' AND jsonb_typeof(v_slide->'hidden') <> 'boolean' THEN RETURN FALSE; END IF;
        IF v_slide ? 'ctaLabel' AND (jsonb_typeof(v_slide->'ctaLabel') <> 'string' OR length(v_slide->>'ctaLabel') > 30) THEN RETURN FALSE; END IF;
        IF v_slide ? 'ctaHref' THEN
            IF jsonb_typeof(v_slide->'ctaHref') <> 'string' THEN RETURN FALSE; END IF;
            v_href := v_slide->>'ctaHref';
            -- A page on this site ("/shop?category=Milk", not "//elsewhere") or a secure web address.
            IF length(v_href) > 300
               OR v_href !~ '^(/([A-Za-z0-9._~%!$&''()*+,;=:@/?#-]*)?|https://[A-Za-z0-9.-]+(:[0-9]+)?(/[A-Za-z0-9._~%!$&''()*+,;=:@/?#-]*)?)$'
               OR v_href ~ '^//' THEN
                RETURN FALSE;
            END IF;
        END IF;
        IF jsonb_typeof(v_slide->'images') IS DISTINCT FROM 'array'
           OR jsonb_array_length(v_slide->'images') NOT BETWEEN 1 AND 3 THEN RETURN FALSE; END IF;
        FOR v_image IN SELECT value FROM jsonb_array_elements(v_slide->'images') LOOP
            IF jsonb_typeof(v_image) <> 'string'
               OR length(v_image #>> '{}') > 500
               OR (v_image #>> '{}') !~ '^(https://[A-Za-z0-9.-]+(:[0-9]+)?/[A-Za-z0-9._~%!$&''()*+,;=:@/?-]*|/hero/[a-z0-9-]+\.(webp|png|jpg))$' THEN
                RETURN FALSE;
            END IF;
        END LOOP;
    END LOOP;
    RETURN TRUE;
END;
$$;

ALTER TABLE public.website_settings
    ADD COLUMN IF NOT EXISTS hero_slides JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE public.website_settings DROP CONSTRAINT IF EXISTS website_settings_hero_slides_check;
ALTER TABLE public.website_settings ADD CONSTRAINT website_settings_hero_slides_check
    CHECK (public.fn_valid_hero_slides(hero_slides) AND pg_column_size(hero_slides) < 20000);

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
        -- Home page slides from Online Store > Home banner; hidden ones never leave the database.
        'heroSlides', COALESCE((
            SELECT jsonb_agg(slide) FROM jsonb_array_elements(s.hero_slides) AS slide
            WHERE COALESCE((slide->>'hidden')::boolean, FALSE) IS FALSE
        ), '[]'::jsonb),
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
