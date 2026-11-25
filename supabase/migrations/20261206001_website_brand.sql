-- 20261206001_website_brand.sql
-- Website engine, phase 2: the shop's brand profile (docs/roadmap/website-engine-audit.md).
--
--   * One brand per shop (a businesses row with a website). Owner decision 2026-11-25.
--   * One record per fact: name, description, logo, primary and secondary colour, address and
--     contacts stay on businesses (receipts and the app use them too). website_brand holds the
--     rest: industry, personality, tone, story, fonts, styles, logo variants, socials, hours.
--   * website_brand_save() writes both in one transaction, checked by business.update.
--   * Fonts come from an allow-list only; colours are #rrggbb; the page background must be
--     light (dark text sits on it everywhere). No free CSS or HTML anywhere.
--   * Existing shops get design_preset 'original' so their website looks exactly as before
--     until someone changes the design. New shops get the look their industry and
--     personality suggest (website/src/engine/presets.ts).
--   * Until drafts exist (phase 5) the public website reads this table directly.
--
-- Reverse: DROP FUNCTION website_brand_save, fn_website_brand_public, fn_valid_*;
--          DROP TABLE website_brand; restore get_public_storefront from 20261204004.

-- ============================================================================================
-- 1. Value rules (shared by the table checks and the save function)
-- ============================================================================================
CREATE OR REPLACE FUNCTION public.fn_website_fonts()
RETURNS text[]
LANGUAGE sql IMMUTABLE
SET search_path = ''
AS $$
    -- Keep in step with FONTS in website/src/engine/brand.ts.
    SELECT ARRAY['Poppins', 'Inter', 'DM Sans', 'Manrope', 'Work Sans', 'Nunito Sans', 'Outfit',
                 'Archivo', 'Space Grotesk', 'IBM Plex Sans', 'Lora', 'Playfair Display',
                 'Cormorant Garamond', 'Fraunces', 'Source Serif 4'];
$$;

-- WCAG relative luminance of #rrggbb (0 = black, 1 = white).
CREATE OR REPLACE FUNCTION public.fn_hex_luminance(p_hex text)
RETURNS numeric
LANGUAGE plpgsql IMMUTABLE
SET search_path = ''
AS $$
DECLARE
    c numeric[] := ARRAY[]::numeric[];
    v numeric;
    i integer;
BEGIN
    IF p_hex IS NULL OR p_hex !~* '^#[0-9a-f]{6}$' THEN
        RETURN NULL;
    END IF;
    FOR i IN 0..2 LOOP
        v := ('x' || substr(p_hex, 2 + i * 2, 2))::bit(8)::integer / 255.0;
        c := c || CASE WHEN v <= 0.03928 THEN v / 12.92 ELSE power((v + 0.055) / 1.055, 2.4) END;
    END LOOP;
    RETURN 0.2126 * c[1] + 0.7152 * c[2] + 0.0722 * c[3];
END;
$$;

-- {"instagram": "https://..."}: known networks only, https addresses.
CREATE OR REPLACE FUNCTION public.fn_valid_social_links(p jsonb)
RETURNS boolean
LANGUAGE sql IMMUTABLE
SET search_path = ''
AS $$
    SELECT jsonb_typeof(p) = 'object'
       AND NOT EXISTS (
           SELECT 1 FROM jsonb_each(p) e
           WHERE e.key NOT IN ('facebook', 'instagram', 'tiktok', 'x', 'youtube', 'linkedin')
              OR jsonb_typeof(e.value) <> 'string'
              OR e.value #>> '{}' !~ '^https://[^\s<>"]+$'
              OR length(e.value #>> '{}') > 300);
$$;

-- [{"day":0,"open":"08:00","close":"18:00"}]: day 0 = Monday ... 6 = Sunday; a missing day is closed.
CREATE OR REPLACE FUNCTION public.fn_valid_opening_hours(p jsonb)
RETURNS boolean
LANGUAGE sql IMMUTABLE
SET search_path = ''
AS $$
    SELECT jsonb_typeof(p) = 'array'
       AND jsonb_array_length(p) <= 14
       AND NOT EXISTS (
           SELECT 1 FROM jsonb_array_elements(p) h
           WHERE jsonb_typeof(h) <> 'object'
              OR (h->>'day') !~ '^[0-6]$'
              OR (h->>'open') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
              OR (h->>'close') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$|^24:00$'
              OR (h->>'close') <= (h->>'open'));
$$;

REVOKE ALL ON FUNCTION public.fn_website_fonts(), public.fn_hex_luminance(text),
    public.fn_valid_social_links(jsonb), public.fn_valid_opening_hours(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_website_fonts(), public.fn_hex_luminance(text),
    public.fn_valid_social_links(jsonb), public.fn_valid_opening_hours(jsonb) TO authenticated, service_role;

-- ============================================================================================
-- 2. The brand table
-- ============================================================================================
CREATE TABLE IF NOT EXISTS public.website_brand (
    business_id uuid PRIMARY KEY REFERENCES public.businesses(id) ON DELETE CASCADE,
    -- What the business is and how it presents itself. Drives the default design.
    industry text NOT NULL DEFAULT 'general_retail' CHECK (industry IN (
        'food_grocery', 'restaurant', 'beauty', 'fashion', 'electronics', 'pharmacy', 'hardware',
        'professional_services', 'logistics', 'general_retail', 'other')),
    personality text CHECK (personality IS NULL OR personality IN (
        'premium', 'friendly', 'bold', 'classic', 'minimal', 'natural', 'technical', 'playful')),
    tone text NOT NULL DEFAULT 'warm' CHECK (tone IN ('warm', 'formal', 'confident', 'playful', 'plain')),
    -- NULL = from industry and personality; 'original' = the website's look before phase 2.
    design_preset text CHECK (design_preset IS NULL OR design_preset IN (
        'original', 'premium', 'friendly', 'bold', 'classic', 'minimal', 'natural', 'technical', 'playful')),
    tagline text CHECK (tagline IS NULL OR length(tagline) <= 120),
    story text CHECK (story IS NULL OR length(story) <= 4000),
    mission text CHECK (mission IS NULL OR length(mission) <= 500),
    audience text CHECK (audience IS NULL OR length(audience) <= 500),
    positioning text CHECK (positioning IS NULL OR length(positioning) <= 500),
    guidelines text CHECK (guidelines IS NULL OR length(guidelines) <= 2000),
    -- Colours beyond businesses.primary_color / secondary_color.
    accent_color text CHECK (accent_color IS NULL OR accent_color ~* '^#[0-9a-f]{6}$'),
    background_color text CHECK (background_color IS NULL OR (background_color ~* '^#[0-9a-f]{6}$'
                                 AND public.fn_hex_luminance(background_color) >= 0.75)),
    -- Type. NULL = from the preset.
    heading_font text CHECK (heading_font IS NULL OR heading_font = ANY (public.fn_website_fonts())),
    body_font text CHECK (body_font IS NULL OR body_font = ANY (public.fn_website_fonts())),
    heading_weight smallint CHECK (heading_weight IS NULL OR heading_weight IN (400, 500, 600, 700, 800)),
    -- Shapes and imagery. NULL = from the preset.
    corner_style text CHECK (corner_style IS NULL OR corner_style IN ('square', 'soft', 'round')),
    button_style text CHECK (button_style IS NULL OR button_style IN ('solid', 'outline', 'pill')),
    density text CHECK (density IS NULL OR density IN ('compact', 'comfortable', 'airy')),
    -- 'cutout' = product on a plain background, shown whole; 'photo' = photograph filling its frame.
    image_style text CHECK (image_style IS NULL OR image_style IN ('cutout', 'photo')),
    image_ratio text CHECK (image_ratio IS NULL OR image_ratio IN ('square', 'portrait', 'landscape')),
    -- Logo variants (the main logo is businesses.logo_url).
    logo_light_url text CHECK (logo_light_url IS NULL OR (logo_light_url ~ '^https://[^\s<>"]+$' AND length(logo_light_url) <= 1000)),
    logo_mark_url text CHECK (logo_mark_url IS NULL OR (logo_mark_url ~ '^https://[^\s<>"]+$' AND length(logo_mark_url) <= 1000)),
    favicon_url text CHECK (favicon_url IS NULL OR (favicon_url ~ '^https://[^\s<>"]+$' AND length(favicon_url) <= 1000)),
    social_links jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (public.fn_valid_social_links(social_links)),
    opening_hours jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (public.fn_valid_opening_hours(opening_hours)),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    updated_by uuid
);

ALTER TABLE public.website_brand ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS pol_website_brand_select ON public.website_brand;
CREATE POLICY pol_website_brand_select ON public.website_brand FOR SELECT TO authenticated
    USING (business_id = ANY (public.get_user_business_ids()));
-- Writes only through website_brand_save (one transaction with businesses).
REVOKE ALL ON public.website_brand FROM anon, authenticated;
GRANT SELECT ON public.website_brand TO authenticated;
GRANT ALL ON public.website_brand TO service_role;

DROP TRIGGER IF EXISTS trg_website_brand_updated_at ON public.website_brand;
CREATE TRIGGER trg_website_brand_updated_at BEFORE UPDATE ON public.website_brand
    FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();
DROP TRIGGER IF EXISTS trg_zz_plan_read_only ON public.website_brand;
CREATE TRIGGER trg_zz_plan_read_only BEFORE INSERT OR UPDATE OR DELETE ON public.website_brand
    FOR EACH ROW EXECUTE FUNCTION public.fn_block_when_read_only();

-- A first guess at the industry from the free-text business type and name.
CREATE OR REPLACE FUNCTION public.fn_guess_industry(p_type text, p_name text)
RETURNS text
LANGUAGE sql IMMUTABLE
SET search_path = ''
AS $$
    SELECT CASE
        WHEN t ~ '(dairy|milk|grocer|supermarket|food|bakery|butcher|farm|fruit|vegetable|mini ?mart)' THEN 'food_grocery'
        WHEN t ~ '(restaurant|cafe|café|hotel|eatery|kitchen|grill|bar\b|coffee)' THEN 'restaurant'
        WHEN t ~ '(beauty|salon|spa|cosmetic|skin|hair|barber|nail|perfume)' THEN 'beauty'
        WHEN t ~ '(fashion|cloth|boutique|apparel|shoe|wear)' THEN 'fashion'
        WHEN t ~ '(electronic|phone|computer|gadget|tech|appliance)' THEN 'electronics'
        WHEN t ~ '(pharma|chemist|clinic|medical|drug)' THEN 'pharmacy'
        WHEN t ~ '(hardware|construction|building|tools|paint)' THEN 'hardware'
        WHEN t ~ '(logistic|courier|transport|delivery|freight|haulage|moving)' THEN 'logistics'
        WHEN t ~ '(consult|law|legal|account|agency|service|studio|design|insurance)' THEN 'professional_services'
        ELSE 'general_retail' END
    FROM (SELECT lower(COALESCE(p_type, '') || ' ' || COALESCE(p_name, '')) AS t) x;
$$;
REVOKE ALL ON FUNCTION public.fn_guess_industry(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_guess_industry(text, text) TO service_role;

-- Existing shops keep today's look. Rows are added for every live business so the Brand screen
-- always has one; a business created later gets its row on first save.
INSERT INTO public.website_brand (business_id, industry, design_preset)
SELECT b.id, public.fn_guess_industry(b.business_type, b.name), 'original'
FROM public.businesses b
WHERE b.deleted_at IS NULL
ON CONFLICT (business_id) DO NOTHING;

-- ============================================================================================
-- 3. Saving the brand (both tables, one transaction)
-- ============================================================================================
CREATE OR REPLACE FUNCTION public.website_brand_save(p_business_id uuid, p_brand jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    -- Keys that live on businesses; everything else is a website_brand column.
    v_biz_keys text[] := ARRAY['description', 'logo_url', 'primary_color', 'secondary_color'];
    v_brand_keys text[] := ARRAY['industry', 'personality', 'tone', 'design_preset', 'tagline', 'story',
        'mission', 'audience', 'positioning', 'guidelines', 'accent_color', 'background_color',
        'heading_font', 'body_font', 'heading_weight', 'corner_style', 'button_style', 'density',
        'image_style', 'image_ratio', 'logo_light_url', 'logo_mark_url', 'favicon_url',
        'social_links', 'opening_hours'];
    v_key text;
    v_txt jsonb := '{}'::jsonb;
    r public.website_brand;
BEGIN
    IF NOT public.has_permission(p_business_id, 'business.update') THEN
        RAISE EXCEPTION 'You do not have permission to change the website brand.';
    END IF;
    IF jsonb_typeof(COALESCE(p_brand, 'null'::jsonb)) <> 'object' THEN
        RAISE EXCEPTION 'Nothing to save.';
    END IF;
    FOR v_key IN SELECT jsonb_object_keys(p_brand) LOOP
        IF NOT (v_key = ANY (v_biz_keys) OR v_key = ANY (v_brand_keys)) THEN
            RAISE EXCEPTION 'Unknown brand setting: %', v_key;
        END IF;
    END LOOP;

    -- Text: trimmed, empty = not set.
    SELECT COALESCE(jsonb_object_agg(e.key, CASE WHEN jsonb_typeof(e.value) = 'string'
                                               THEN to_jsonb(NULLIF(trim(e.value #>> '{}'), ''))
                                               ELSE e.value END), '{}'::jsonb)
    INTO v_txt FROM jsonb_each(p_brand) e;

    -- Clear messages for the rules people are most likely to hit.
    IF v_txt ? 'primary_color' AND v_txt->>'primary_color' IS NOT NULL AND v_txt->>'primary_color' !~* '^#[0-9a-f]{6}$' THEN
        RAISE EXCEPTION 'Colours are written like #1f6feb.';
    END IF;
    IF v_txt ? 'secondary_color' AND v_txt->>'secondary_color' IS NOT NULL AND v_txt->>'secondary_color' !~* '^#[0-9a-f]{6}$' THEN
        RAISE EXCEPTION 'Colours are written like #1f6feb.';
    END IF;
    IF v_txt->>'background_color' IS NOT NULL AND COALESCE(public.fn_hex_luminance(v_txt->>'background_color'), 0) < 0.75 THEN
        RAISE EXCEPTION 'Pick a light page background. Text on a dark background is hard to read on this website.';
    END IF;
    IF v_txt->>'logo_url' IS NOT NULL AND (v_txt->>'logo_url' !~ '^https://[^\s<>"]+$' OR length(v_txt->>'logo_url') > 1000) THEN
        RAISE EXCEPTION 'The logo must be an uploaded picture.';
    END IF;

    UPDATE public.businesses SET
        description     = CASE WHEN v_txt ? 'description' THEN v_txt->>'description' ELSE description END,
        logo_url        = CASE WHEN v_txt ? 'logo_url' THEN v_txt->>'logo_url' ELSE logo_url END,
        primary_color   = CASE WHEN v_txt ? 'primary_color' THEN lower(v_txt->>'primary_color') ELSE primary_color END,
        secondary_color = CASE WHEN v_txt ? 'secondary_color' THEN lower(v_txt->>'secondary_color') ELSE secondary_color END
    WHERE id = p_business_id AND deleted_at IS NULL
      AND (v_txt ?| v_biz_keys);

    INSERT INTO public.website_brand (business_id) VALUES (p_business_id) ON CONFLICT (business_id) DO NOTHING;
    UPDATE public.website_brand w SET
        industry        = CASE WHEN v_txt ? 'industry' THEN COALESCE(v_txt->>'industry', 'general_retail') ELSE w.industry END,
        personality     = CASE WHEN v_txt ? 'personality' THEN v_txt->>'personality' ELSE w.personality END,
        tone            = CASE WHEN v_txt ? 'tone' THEN COALESCE(v_txt->>'tone', 'warm') ELSE w.tone END,
        design_preset   = CASE WHEN v_txt ? 'design_preset' THEN v_txt->>'design_preset' ELSE w.design_preset END,
        tagline         = CASE WHEN v_txt ? 'tagline' THEN v_txt->>'tagline' ELSE w.tagline END,
        story           = CASE WHEN v_txt ? 'story' THEN v_txt->>'story' ELSE w.story END,
        mission         = CASE WHEN v_txt ? 'mission' THEN v_txt->>'mission' ELSE w.mission END,
        audience        = CASE WHEN v_txt ? 'audience' THEN v_txt->>'audience' ELSE w.audience END,
        positioning     = CASE WHEN v_txt ? 'positioning' THEN v_txt->>'positioning' ELSE w.positioning END,
        guidelines      = CASE WHEN v_txt ? 'guidelines' THEN v_txt->>'guidelines' ELSE w.guidelines END,
        accent_color    = CASE WHEN v_txt ? 'accent_color' THEN lower(v_txt->>'accent_color') ELSE w.accent_color END,
        background_color= CASE WHEN v_txt ? 'background_color' THEN lower(v_txt->>'background_color') ELSE w.background_color END,
        heading_font    = CASE WHEN v_txt ? 'heading_font' THEN v_txt->>'heading_font' ELSE w.heading_font END,
        body_font       = CASE WHEN v_txt ? 'body_font' THEN v_txt->>'body_font' ELSE w.body_font END,
        heading_weight  = CASE WHEN v_txt ? 'heading_weight' THEN (v_txt->>'heading_weight')::smallint ELSE w.heading_weight END,
        corner_style    = CASE WHEN v_txt ? 'corner_style' THEN v_txt->>'corner_style' ELSE w.corner_style END,
        button_style    = CASE WHEN v_txt ? 'button_style' THEN v_txt->>'button_style' ELSE w.button_style END,
        density         = CASE WHEN v_txt ? 'density' THEN v_txt->>'density' ELSE w.density END,
        image_style     = CASE WHEN v_txt ? 'image_style' THEN v_txt->>'image_style' ELSE w.image_style END,
        image_ratio     = CASE WHEN v_txt ? 'image_ratio' THEN v_txt->>'image_ratio' ELSE w.image_ratio END,
        logo_light_url  = CASE WHEN v_txt ? 'logo_light_url' THEN v_txt->>'logo_light_url' ELSE w.logo_light_url END,
        logo_mark_url   = CASE WHEN v_txt ? 'logo_mark_url' THEN v_txt->>'logo_mark_url' ELSE w.logo_mark_url END,
        favicon_url     = CASE WHEN v_txt ? 'favicon_url' THEN v_txt->>'favicon_url' ELSE w.favicon_url END,
        social_links    = CASE WHEN v_txt ? 'social_links' THEN COALESCE(v_txt->'social_links', '{}'::jsonb) ELSE w.social_links END,
        opening_hours   = CASE WHEN v_txt ? 'opening_hours' THEN COALESCE(v_txt->'opening_hours', '[]'::jsonb) ELSE w.opening_hours END,
        updated_by      = auth.uid()
    WHERE w.business_id = p_business_id
    RETURNING w.* INTO r;
    RETURN to_jsonb(r);
END;
$$;
REVOKE ALL ON FUNCTION public.website_brand_save(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.website_brand_save(uuid, jsonb) TO authenticated, service_role;

-- ============================================================================================
-- 4. The public part of the brand, added to the storefront
-- ============================================================================================
-- Internal notes (audience, positioning, guidelines, tone) never leave the database.
CREATE OR REPLACE FUNCTION public.fn_website_brand_public(p_business_id uuid)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT jsonb_strip_nulls(jsonb_build_object(
        'industry', COALESCE(w.industry, public.fn_guess_industry(b.business_type, b.name)),
        'personality', w.personality,
        'designPreset', w.design_preset,
        'tagline', w.tagline,
        'story', w.story,
        'mission', w.mission,
        'secondaryColor', CASE WHEN b.secondary_color ~* '^#[0-9a-f]{6}$' THEN lower(b.secondary_color) END,
        'accentColor', w.accent_color,
        'backgroundColor', w.background_color,
        'headingFont', w.heading_font,
        'bodyFont', w.body_font,
        'headingWeight', w.heading_weight,
        'cornerStyle', w.corner_style,
        'buttonStyle', w.button_style,
        'density', w.density,
        'imageStyle', w.image_style,
        'imageRatio', w.image_ratio,
        'logoLightUrl', w.logo_light_url,
        'logoMarkUrl', w.logo_mark_url,
        'faviconUrl', w.favicon_url,
        'socialLinks', NULLIF(w.social_links, '{}'::jsonb),
        'openingHours', NULLIF(w.opening_hours, '[]'::jsonb)))
    FROM public.businesses b
    LEFT JOIN public.website_brand w ON w.business_id = b.id
    WHERE b.id = p_business_id;
$$;
REVOKE ALL ON FUNCTION public.fn_website_brand_public(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_website_brand_public(uuid) TO service_role;

-- Same as 20261204004, plus 'brand'.
CREATE OR REPLACE FUNCTION public.get_public_storefront(p_slug text)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_id uuid;
    v_shop jsonb;
    v_data jsonb;
    st public.platform_settings;
BEGIN
    SELECT b.id INTO v_id FROM public.businesses b
    WHERE b.website_slug = lower(trim(p_slug)) AND b.deleted_at IS NULL;
    IF NOT FOUND THEN
        RETURN NULL;
    END IF;
    v_shop := public.fn_website_shop(v_id);
    IF NOT (v_shop->>'open')::boolean THEN
        RETURN NULL;
    END IF;
    v_data := public.fn_public_storefront_data(lower(trim(p_slug)));
    IF v_data IS NULL THEN
        RETURN NULL;
    END IF;
    SELECT * INTO st FROM public.platform_settings WHERE id;
    RETURN v_data || jsonb_build_object(
        'brand', public.fn_website_brand_public(v_id),
        'site', jsonb_build_object(
            'ordersOpen', (v_shop->>'orders_open')::boolean,
            'poweredBy', (v_shop->>'powered_by')::boolean,
            'platformName', st.platform_name,
            'platformUrl', CASE WHEN st.platform_domain IS NOT NULL THEN 'https://' || st.platform_domain END,
            'host', public.fn_website_home_host(v_id)));
END;
$$;
REVOKE ALL ON FUNCTION public.get_public_storefront(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_storefront(text) TO anon, authenticated, service_role;
