-- 20261206002_website_drafts_publish.sql
-- Website engine, phases 4 and 5: the Website workspace saves into a draft; Publish puts the
-- draft live and keeps a numbered version; any version can be put back (docs/roadmap/website-engine-audit.md).
--
--   * The draft is one document per shop: brand, home page arrangement, banner slides, adverts,
--     pages, menu, search engine text and contact details. Nothing a visitor sees changes until
--     Publish.
--   * The live tables stay the single record of what is published (website_brand, businesses,
--     website_settings), so get_public_storefront, receipts and old readers keep working, and no
--     existing content moves anywhere. The draft starts as a copy of what is live.
--   * Publish and Put back go through fn_website_apply, the only writer of the design columns.
--     Direct writes to those columns are taken away from the app (old app versions get a clear
--     refusal instead of being overwritten by the next publish). Delivery fee, minimum order
--     and the assistant switch stay directly editable: they are shop operations, not design.
--   * A draft is checked when saved, by applying it inside a sub-transaction that is always
--     rolled back, so a draft can never hold something Publish would refuse, and the preview
--     never shows content the live site could not.
--   * Preview: a member who may change the website gets a link that works for two hours. The
--     link's secret is stored only as a SHA-256 hash, names the shop itself and works only on
--     that shop's own address. The tenant always comes from the secret, never from the caller.
--   * Every check is has_permission(business, 'business.update'), the same as the brand.
--
-- Reverse: DROP FUNCTION website_draft_get, website_draft_save, website_draft_discard,
--          website_publish, website_rollback, website_preview_link, get_preview_storefront,
--          website_stats, fn_website_apply, fn_website_live_document, fn_website_brand_shape,
--          fn_valid_home, fn_valid_navigation, fn_valid_seo;
--          DROP TABLE website_preview_links, website_published, website_versions, website_drafts;
--          ALTER TABLE website_settings DROP COLUMN home, navigation, seo;
--          GRANT INSERT, UPDATE, DELETE ON website_settings TO authenticated;
--          GRANT EXECUTE ON FUNCTION website_brand_save(uuid, jsonb) TO authenticated;
--          restore fn_website_brand_public and get_public_storefront from 20261206001.

-- ============================================================================================
-- 1. New design settings: home page arrangement, header menu, search engine text
-- ============================================================================================
-- Section kinds: keep in step with SECTION_KINDS in website/src/engine/layout.ts
-- (src/test/websiteEngineTests.ts compares the two).
CREATE OR REPLACE FUNCTION public.fn_valid_home(p jsonb)
RETURNS boolean
LANGUAGE sql IMMUTABLE
SET search_path = ''
AS $$
    SELECT p IS NULL OR jsonb_typeof(p) = 'null' OR (
        jsonb_typeof(p) = 'array' AND jsonb_array_length(p) <= 24
        AND NOT EXISTS (
            SELECT 1 FROM jsonb_array_elements(p) e
            WHERE jsonb_typeof(e) <> 'object'
               OR NOT (COALESCE(e->>'kind', '') = ANY (ARRAY['hero', 'categories', 'adverts', 'strip', 'strip2',
                      'promotions', 'offers', 'products', 'reviewed', 'aisles', 'story', 'trust', 'testimonials',
                      'recent', 'guides', 'visit', 'contact']))
               OR (e ? 'variant' AND (jsonb_typeof(e->'variant') <> 'string' OR length(e->>'variant') > 20))
               OR (e ? 'title' AND jsonb_typeof(e->'title') <> 'null'
                   AND (jsonb_typeof(e->'title') <> 'string' OR length(e->>'title') > 60))
               OR (e ? 'hidden' AND jsonb_typeof(e->'hidden') <> 'boolean')
               OR EXISTS (SELECT 1 FROM jsonb_object_keys(e) k WHERE k NOT IN ('kind', 'variant', 'title', 'hidden'))));
$$;

-- A menu link goes to a page of this website (/path) or to an https address. Nothing else:
-- no javascript:, no protocol-relative //host, no spaces or quotes.
CREATE OR REPLACE FUNCTION public.fn_valid_link(p text)
RETURNS boolean
LANGUAGE sql IMMUTABLE
SET search_path = ''
AS $$
    SELECT p IS NOT NULL AND length(p) <= 300
       AND (p ~ '^/([A-Za-z0-9_~%+=&?.#-][A-Za-z0-9/_~%+=&?.#-]*)?$' OR p ~ '^https://[A-Za-z0-9.-]+(/[^\s<>"'']*)?$');
$$;

CREATE OR REPLACE FUNCTION public.fn_valid_navigation(p jsonb)
RETURNS boolean
LANGUAGE sql IMMUTABLE
SET search_path = ''
AS $$
    SELECT p IS NULL OR jsonb_typeof(p) = 'null' OR (
        jsonb_typeof(p) = 'object'
        AND NOT EXISTS (SELECT 1 FROM jsonb_object_keys(p) k WHERE k <> 'header')
        AND jsonb_typeof(p->'header') = 'array'
        AND jsonb_array_length(p->'header') <= 8
        AND NOT EXISTS (
            SELECT 1 FROM jsonb_array_elements(p->'header') e
            WHERE jsonb_typeof(e) <> 'object'
               OR jsonb_typeof(e->'label') IS DISTINCT FROM 'string'
               OR length(trim(e->>'label')) NOT BETWEEN 1 AND 30
               OR NOT public.fn_valid_link(e->>'href')
               OR EXISTS (SELECT 1 FROM jsonb_object_keys(e) k WHERE k NOT IN ('label', 'href'))));
$$;

CREATE OR REPLACE FUNCTION public.fn_valid_seo(p jsonb)
RETURNS boolean
LANGUAGE sql IMMUTABLE
SET search_path = ''
AS $$
    SELECT p IS NULL OR jsonb_typeof(p) = 'null' OR (
        jsonb_typeof(p) = 'object'
        AND NOT EXISTS (SELECT 1 FROM jsonb_object_keys(p) k WHERE k NOT IN ('title', 'description', 'shareImage'))
        AND (NOT p ? 'title' OR (jsonb_typeof(p->'title') = 'string' AND length(p->>'title') <= 70))
        AND (NOT p ? 'description' OR (jsonb_typeof(p->'description') = 'string' AND length(p->>'description') <= 170))
        AND (NOT p ? 'shareImage' OR (jsonb_typeof(p->'shareImage') = 'string'
             AND p->>'shareImage' ~ '^https://[^\s<>"]+$' AND length(p->>'shareImage') <= 1000)));
$$;

-- Page text: page ids only, text only.
CREATE OR REPLACE FUNCTION public.fn_valid_pages(p jsonb)
RETURNS boolean
LANGUAGE sql IMMUTABLE
SET search_path = ''
AS $$
    SELECT jsonb_typeof(p) = 'object' AND NOT EXISTS (
        SELECT 1 FROM jsonb_each(p) e
        WHERE e.key !~ '^[a-z0-9-]{1,40}$' OR jsonb_typeof(e.value) <> 'string' OR length(e.value #>> '{}') > 60000);
$$;

GRANT EXECUTE ON FUNCTION public.fn_valid_home(jsonb), public.fn_valid_link(text), public.fn_valid_navigation(jsonb),
    public.fn_valid_seo(jsonb), public.fn_valid_pages(jsonb) TO authenticated, service_role;

ALTER TABLE public.website_settings
    ADD COLUMN IF NOT EXISTS home jsonb,
    ADD COLUMN IF NOT EXISTS navigation jsonb,
    ADD COLUMN IF NOT EXISTS seo jsonb;
ALTER TABLE public.website_settings DROP CONSTRAINT IF EXISTS website_settings_home_check;
ALTER TABLE public.website_settings ADD CONSTRAINT website_settings_home_check CHECK (public.fn_valid_home(home));
ALTER TABLE public.website_settings DROP CONSTRAINT IF EXISTS website_settings_navigation_check;
ALTER TABLE public.website_settings ADD CONSTRAINT website_settings_navigation_check CHECK (public.fn_valid_navigation(navigation));
ALTER TABLE public.website_settings DROP CONSTRAINT IF EXISTS website_settings_seo_check;
ALTER TABLE public.website_settings ADD CONSTRAINT website_settings_seo_check CHECK (public.fn_valid_seo(seo));
-- NOT VALID: shops saved before this rule keep working; every new write is checked.
ALTER TABLE public.website_settings DROP CONSTRAINT IF EXISTS website_settings_page_text_check;
ALTER TABLE public.website_settings ADD CONSTRAINT website_settings_page_text_check CHECK (public.fn_valid_pages(pages)) NOT VALID;

-- Design columns are written only by Publish / Put back. Shop operations stay editable.
-- business_id is in the UPDATE list because an upsert sets every column it sends; the row
-- policy still limits it to shops the user may change.
REVOKE INSERT, UPDATE, DELETE ON public.website_settings FROM authenticated;
GRANT INSERT (business_id, delivery_enabled, delivery_fee, min_order, assistant_enabled) ON public.website_settings TO authenticated;
GRANT UPDATE (business_id, delivery_enabled, delivery_fee, min_order, assistant_enabled) ON public.website_settings TO authenticated;
-- The brand too: it goes live only by publishing.
REVOKE EXECUTE ON FUNCTION public.website_brand_save(uuid, jsonb) FROM authenticated;

-- ============================================================================================
-- 2. Tables: the draft, published versions, the pointer to the live one, preview links
-- ============================================================================================
CREATE TABLE IF NOT EXISTS public.website_drafts (
    business_id uuid PRIMARY KEY REFERENCES public.businesses(id) ON DELETE CASCADE,
    document jsonb NOT NULL CHECK (jsonb_typeof(document) = 'object' AND pg_column_size(document) < 600000),
    -- Goes up by one on every save; a save names the revision it started from, so two people
    -- editing at once cannot silently overwrite each other.
    revision integer NOT NULL DEFAULT 1,
    updated_by uuid,
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.website_versions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    number integer NOT NULL,
    -- 'start' = how the website was before its first publish; 'publish'; 'rollback' = put back.
    kind text NOT NULL CHECK (kind IN ('start', 'publish', 'rollback')),
    note text CHECK (note IS NULL OR length(note) <= 200),
    document jsonb NOT NULL CHECK (jsonb_typeof(document) = 'object'),
    created_by uuid,
    created_by_name text,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (business_id, number)
);
CREATE INDEX IF NOT EXISTS website_versions_business_idx ON public.website_versions (business_id, number DESC);

CREATE TABLE IF NOT EXISTS public.website_published (
    business_id uuid PRIMARY KEY REFERENCES public.businesses(id) ON DELETE CASCADE,
    version_id uuid NOT NULL REFERENCES public.website_versions(id),
    published_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.website_preview_links (
    secret_hash bytea PRIMARY KEY,
    business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    created_by uuid,
    expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS website_preview_links_business_idx ON public.website_preview_links (business_id);

ALTER TABLE public.website_drafts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.website_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.website_published ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.website_preview_links ENABLE ROW LEVEL SECURITY;
-- Reads and writes go through the functions below. Version history is readable by the people
-- who may publish (the history list in the app); nothing is writable directly.
REVOKE ALL ON public.website_drafts, public.website_versions, public.website_published, public.website_preview_links FROM anon, authenticated;
GRANT ALL ON public.website_drafts, public.website_versions, public.website_published, public.website_preview_links TO service_role;
GRANT SELECT (id, business_id, number, kind, note, created_by_name, created_at) ON public.website_versions TO authenticated;
DROP POLICY IF EXISTS pol_website_versions_select ON public.website_versions;
CREATE POLICY pol_website_versions_select ON public.website_versions FOR SELECT TO authenticated
    USING (public.has_permission(business_id, 'business.update'));

-- A shop on a read-only plan changes nothing here either (20261204001 section 6).
DROP TRIGGER IF EXISTS trg_zz_plan_read_only ON public.website_drafts;
CREATE TRIGGER trg_zz_plan_read_only BEFORE INSERT OR UPDATE OR DELETE ON public.website_drafts
    FOR EACH ROW EXECUTE FUNCTION public.fn_block_when_read_only();
DROP TRIGGER IF EXISTS trg_zz_plan_read_only ON public.website_versions;
CREATE TRIGGER trg_zz_plan_read_only BEFORE INSERT OR UPDATE OR DELETE ON public.website_versions
    FOR EACH ROW EXECUTE FUNCTION public.fn_block_when_read_only();
DROP TRIGGER IF EXISTS trg_zz_plan_read_only ON public.website_published;
CREATE TRIGGER trg_zz_plan_read_only BEFORE INSERT OR UPDATE OR DELETE ON public.website_published
    FOR EACH ROW EXECUTE FUNCTION public.fn_block_when_read_only();
DROP TRIGGER IF EXISTS trg_zz_plan_read_only ON public.website_preview_links;
CREATE TRIGGER trg_zz_plan_read_only BEFORE INSERT OR UPDATE OR DELETE ON public.website_preview_links
    FOR EACH ROW EXECUTE FUNCTION public.fn_block_when_read_only();

-- ============================================================================================
-- 3. The website as one document: what is live now, and putting a document live
-- ============================================================================================
-- Every brand key, so a draft and the live website compare field by field.
CREATE OR REPLACE FUNCTION public.fn_website_live_document(p_business_id uuid)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT jsonb_build_object(
        'brand', jsonb_build_object(
                'industry', public.fn_guess_industry(b.business_type, b.name), 'personality', NULL, 'tone', 'warm',
                'design_preset', NULL, 'tagline', NULL, 'story', NULL, 'mission', NULL, 'audience', NULL,
                'positioning', NULL, 'guidelines', NULL, 'accent_color', NULL, 'background_color', NULL,
                'heading_font', NULL, 'body_font', NULL, 'heading_weight', NULL, 'corner_style', NULL,
                'button_style', NULL, 'density', NULL, 'image_style', NULL, 'image_ratio', NULL,
                'logo_light_url', NULL, 'logo_mark_url', NULL, 'favicon_url', NULL,
                'social_links', '{}'::jsonb, 'opening_hours', '[]'::jsonb)
            || COALESCE(to_jsonb(w) - ARRAY['business_id', 'created_at', 'updated_at', 'updated_by'], '{}'::jsonb)
            || jsonb_build_object(
                'description', NULLIF(b.description, ''), 'logo_url', NULLIF(b.logo_url, ''),
                'primary_color', NULLIF(b.primary_color, ''), 'secondary_color', NULLIF(b.secondary_color, '')),
        'home', COALESCE(s.home, 'null'::jsonb),
        'heroSlides', COALESCE(s.hero_slides, '[]'::jsonb),
        'adCards', COALESCE(s.ad_cards, '[]'::jsonb),
        'pages', COALESCE(s.pages, '{}'::jsonb),
        'navigation', COALESCE(s.navigation, 'null'::jsonb),
        'seo', COALESCE(s.seo, 'null'::jsonb),
        'contact', jsonb_build_object('openingHours', NULLIF(trim(s.opening_hours), ''), 'whatsapp', NULLIF(trim(s.whatsapp), '')))
    FROM public.businesses b
    LEFT JOIN public.website_brand w ON w.business_id = b.id
    LEFT JOIN public.website_settings s ON s.business_id = b.id
    WHERE b.id = p_business_id;
$$;
REVOKE ALL ON FUNCTION public.fn_website_live_document(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_website_live_document(uuid) TO service_role;

-- A document as received: only known parts, brand keys only the known ones. Parts not sent
-- are taken from the open draft (p_onto_draft) or else from the live website.
CREATE OR REPLACE FUNCTION public.fn_website_clean_document(p_business_id uuid, p_doc jsonb, p_onto_draft boolean DEFAULT FALSE)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_live jsonb := public.fn_website_live_document(p_business_id);
    v_base jsonb;
    v_key text;
BEGIN
    v_base := CASE WHEN p_onto_draft THEN (SELECT document FROM public.website_drafts WHERE business_id = p_business_id) END;
    -- A draft saved before a new part existed gets that part from the live website.
    v_base := v_live || COALESCE(v_base, '{}'::jsonb);
    IF jsonb_typeof(COALESCE(p_doc, 'null'::jsonb)) <> 'object' THEN
        RAISE EXCEPTION 'Nothing to save.';
    END IF;
    FOR v_key IN SELECT jsonb_object_keys(p_doc) LOOP
        IF NOT v_live ? v_key THEN
            RAISE EXCEPTION 'Unknown website part: %', v_key;
        END IF;
    END LOOP;
    IF p_doc ? 'brand' THEN
        IF jsonb_typeof(p_doc->'brand') <> 'object' THEN
            RAISE EXCEPTION 'The brand must be a set of fields.';
        END IF;
        FOR v_key IN SELECT jsonb_object_keys(p_doc->'brand') LOOP
            IF NOT (v_live->'brand') ? v_key THEN
                RAISE EXCEPTION 'Unknown brand setting: %', v_key;
            END IF;
        END LOOP;
        p_doc := jsonb_set(p_doc, '{brand}', (v_live->'brand') || (v_base->'brand') || (p_doc->'brand'));
    END IF;
    IF p_doc ? 'contact' THEN
        IF jsonb_typeof(p_doc->'contact') <> 'object'
           OR EXISTS (SELECT 1 FROM jsonb_object_keys(p_doc->'contact') k WHERE k NOT IN ('openingHours', 'whatsapp')) THEN
            RAISE EXCEPTION 'Contact details hold opening hours and a WhatsApp number only.';
        END IF;
        p_doc := jsonb_set(p_doc, '{contact}', (v_live->'contact') || (v_base->'contact') || (p_doc->'contact'));
    END IF;
    RETURN v_base || p_doc;
END;
$$;
DROP FUNCTION IF EXISTS public.fn_website_clean_document(uuid, jsonb);
REVOKE ALL ON FUNCTION public.fn_website_clean_document(uuid, jsonb, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_website_clean_document(uuid, jsonb, boolean) TO service_role;

-- Puts a whole document live. The only writer of the design columns. Every value is checked by
-- website_brand_save and the table checks; anything wrong stops the whole change.
CREATE OR REPLACE FUNCTION public.fn_website_apply(p_business_id uuid, p_doc jsonb)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_slides jsonb := COALESCE(NULLIF(p_doc->'heroSlides', 'null'::jsonb), '[]'::jsonb);
    v_cards jsonb := COALESCE(NULLIF(p_doc->'adCards', 'null'::jsonb), '[]'::jsonb);
    v_pages jsonb := COALESCE(NULLIF(p_doc->'pages', 'null'::jsonb), '{}'::jsonb);
BEGIN
    IF NOT public.has_permission(p_business_id, 'business.update') THEN
        RAISE EXCEPTION 'You do not have permission to change the website.';
    END IF;
    -- Clear messages for what the table checks would otherwise refuse with a constraint name.
    IF NOT public.fn_valid_home(p_doc->'home') THEN
        RAISE EXCEPTION 'The home page arrangement has a section the website does not know.';
    END IF;
    IF NOT public.fn_valid_navigation(p_doc->'navigation') THEN
        RAISE EXCEPTION 'A menu link is not allowed. Links go to a page of this website (starting with /) or a secure web address (https), with a name of up to 30 letters, and at most 8 links.';
    END IF;
    IF NOT public.fn_valid_seo(p_doc->'seo') THEN
        RAISE EXCEPTION 'Search engine text is too long: up to 70 letters for the title and 170 for the description. The sharing picture must be uploaded.';
    END IF;
    IF NOT public.fn_valid_pages(v_pages) THEN
        RAISE EXCEPTION 'A page has text the website cannot show.';
    END IF;

    PERFORM public.website_brand_save(p_business_id, p_doc->'brand');

    INSERT INTO public.website_settings (business_id) VALUES (p_business_id) ON CONFLICT (business_id) DO NOTHING;
    UPDATE public.website_settings SET
        hero_slides   = v_slides,
        ad_cards      = v_cards,
        pages         = v_pages,
        home          = NULLIF(p_doc->'home', 'null'::jsonb),
        navigation    = NULLIF(p_doc->'navigation', 'null'::jsonb),
        seo           = NULLIF(p_doc->'seo', 'null'::jsonb),
        opening_hours = NULLIF(trim(p_doc#>>'{contact,openingHours}'), ''),
        whatsapp      = NULLIF(trim(p_doc#>>'{contact,whatsapp}'), '')
    WHERE business_id = p_business_id;
END;
$$;
REVOKE ALL ON FUNCTION public.fn_website_apply(uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_website_apply(uuid, jsonb) TO service_role;

-- Checks a document by putting it live inside a sub-transaction that is always undone.
-- Returns NULL when the document is fine, else the reason it would be refused.
CREATE OR REPLACE FUNCTION public.fn_website_check_document(p_business_id uuid, p_doc jsonb)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    BEGIN
        PERFORM public.fn_website_apply(p_business_id, p_doc);
        RAISE EXCEPTION USING ERRCODE = 'P0901', MESSAGE = 'website-check-ok';
    EXCEPTION
        WHEN SQLSTATE 'P0901' THEN
            RETURN NULL;
        WHEN check_violation THEN
            RETURN CASE
                WHEN SQLERRM LIKE '%hero_slides%' THEN 'A banner slide has a value the website cannot show. Check its link and picture.'
                WHEN SQLERRM LIKE '%ad_cards%' THEN 'An advert has a value the website cannot show. Check its link and picture.'
                WHEN SQLERRM LIKE '%hours%' THEN 'The WhatsApp number may hold digits, spaces and a leading + only, and opening hours up to 500 letters.'
                WHEN SQLERRM LIKE '%font%' THEN 'That font is not on the website''s list of fonts.'
                ELSE 'A website setting has a value that is not allowed. Check the colours, fonts and pictures.' END;
        WHEN OTHERS THEN
            RETURN SQLERRM;
    END;
END;
$$;
REVOKE ALL ON FUNCTION public.fn_website_check_document(uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_website_check_document(uuid, jsonb) TO service_role;

-- ============================================================================================
-- 4. The draft: read, save, discard
-- ============================================================================================
CREATE OR REPLACE FUNCTION public.fn_website_published_info(p_business_id uuid)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT jsonb_build_object('number', v.number, 'at', p.published_at, 'by', v.created_by_name, 'kind', v.kind)
    FROM public.website_published p
    JOIN public.website_versions v ON v.id = p.version_id
    WHERE p.business_id = p_business_id;
$$;
REVOKE ALL ON FUNCTION public.fn_website_published_info(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_website_published_info(uuid) TO service_role;

-- The draft (or, when there is none, what is live), whether it differs from the live website,
-- and the published version.
CREATE OR REPLACE FUNCTION public.website_draft_get(p_business_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_live jsonb;
    d public.website_drafts;
BEGIN
    IF NOT public.has_permission(p_business_id, 'business.update') THEN
        RAISE EXCEPTION 'You do not have permission to change the website.';
    END IF;
    v_live := public.fn_website_live_document(p_business_id);
    IF v_live IS NULL THEN
        RAISE EXCEPTION 'Shop not found.';
    END IF;
    SELECT * INTO d FROM public.website_drafts WHERE business_id = p_business_id;
    RETURN jsonb_build_object(
        'document', COALESCE(d.document, v_live),
        'revision', COALESCE(d.revision, 0),
        'changed', d.document IS NOT NULL AND d.document IS DISTINCT FROM v_live,
        'savedAt', d.updated_at,
        'savedBy', (SELECT u.name FROM public.users u WHERE u.auth_user_id = d.updated_by LIMIT 1),
        'published', public.fn_website_published_info(p_business_id));
END;
$$;
REVOKE ALL ON FUNCTION public.website_draft_get(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.website_draft_get(uuid) TO authenticated, service_role;

-- Saves the draft. p_base_revision is the revision the editor loaded; if someone saved since,
-- nothing is saved and the caller is told to reload. Returns the new revision.
CREATE OR REPLACE FUNCTION public.website_draft_save(p_business_id uuid, p_document jsonb, p_base_revision integer)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_doc jsonb;
    v_current integer;
    v_problem text;
BEGIN
    IF NOT public.has_permission(p_business_id, 'business.update') THEN
        RAISE EXCEPTION 'You do not have permission to change the website.';
    END IF;
    IF pg_column_size(p_document) > 600000 THEN
        RAISE EXCEPTION 'The website is too large to save. Remove some pictures or page text.';
    END IF;
    -- One save at a time per shop.
    PERFORM pg_advisory_xact_lock(hashtextextended('website:' || p_business_id::text, 0));
    SELECT revision INTO v_current FROM public.website_drafts WHERE business_id = p_business_id;
    IF COALESCE(v_current, 0) <> COALESCE(p_base_revision, -1) THEN
        RAISE EXCEPTION 'Someone else saved the website since you opened it. Reload to see their changes, then make yours again.';
    END IF;
    v_doc := public.fn_website_clean_document(p_business_id, p_document, TRUE);
    v_problem := public.fn_website_check_document(p_business_id, v_doc);
    IF v_problem IS NOT NULL THEN
        RAISE EXCEPTION '%', v_problem;
    END IF;
    INSERT INTO public.website_drafts AS d (business_id, document, revision, updated_by, updated_at)
    VALUES (p_business_id, v_doc, 1, auth.uid(), now())
    ON CONFLICT (business_id) DO UPDATE
        SET document = EXCLUDED.document, revision = d.revision + 1, updated_by = auth.uid(), updated_at = now();
    RETURN jsonb_build_object(
        'revision', (SELECT revision FROM public.website_drafts WHERE business_id = p_business_id),
        'changed', v_doc IS DISTINCT FROM public.fn_website_live_document(p_business_id));
END;
$$;
REVOKE ALL ON FUNCTION public.website_draft_save(uuid, jsonb, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.website_draft_save(uuid, jsonb, integer) TO authenticated, service_role;

-- Throws the draft away: the editor shows the live website again.
CREATE OR REPLACE FUNCTION public.website_draft_discard(p_business_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF NOT public.has_permission(p_business_id, 'business.update') THEN
        RAISE EXCEPTION 'You do not have permission to change the website.';
    END IF;
    DELETE FROM public.website_drafts WHERE business_id = p_business_id;
END;
$$;
REVOKE ALL ON FUNCTION public.website_draft_discard(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.website_draft_discard(uuid) TO authenticated, service_role;

-- ============================================================================================
-- 5. Publish and put back
-- ============================================================================================
CREATE OR REPLACE FUNCTION public.fn_website_record_version(p_business_id uuid, p_kind text, p_note text)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_number integer;
    v_id uuid;
BEGIN
    SELECT COALESCE(max(number), 0) + 1 INTO v_number FROM public.website_versions WHERE business_id = p_business_id;
    INSERT INTO public.website_versions (business_id, number, kind, note, document, created_by, created_by_name)
    VALUES (p_business_id, v_number, p_kind, NULLIF(left(trim(COALESCE(p_note, '')), 200), ''),
            public.fn_website_live_document(p_business_id), auth.uid(),
            (SELECT u.name FROM public.users u WHERE u.auth_user_id = auth.uid() LIMIT 1))
    RETURNING id INTO v_id;
    INSERT INTO public.website_published (business_id, version_id, published_at) VALUES (p_business_id, v_id, now())
    ON CONFLICT (business_id) DO UPDATE SET version_id = EXCLUDED.version_id, published_at = now();
    RETURN v_number;
END;
$$;
REVOKE ALL ON FUNCTION public.fn_website_record_version(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_website_record_version(uuid, text, text) TO service_role;

-- Puts the draft live. The first publish also keeps how the website was before, as version 1,
-- so even the very first change can be undone. Returns the new version number.
CREATE OR REPLACE FUNCTION public.website_publish(p_business_id uuid, p_base_revision integer, p_note text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    d public.website_drafts;
    v_number integer;
BEGIN
    IF NOT public.has_permission(p_business_id, 'business.update') THEN
        RAISE EXCEPTION 'You do not have permission to publish the website.';
    END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended('website:' || p_business_id::text, 0));
    SELECT * INTO d FROM public.website_drafts WHERE business_id = p_business_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'There are no changes to publish.';
    END IF;
    IF d.revision <> COALESCE(p_base_revision, -1) THEN
        RAISE EXCEPTION 'Someone else saved the website since you opened it. Reload to see their changes before publishing.';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.website_versions WHERE business_id = p_business_id) THEN
        PERFORM public.fn_website_record_version(p_business_id, 'start', 'How the website was before the first publish');
    END IF;
    PERFORM public.fn_website_apply(p_business_id, d.document);
    v_number := public.fn_website_record_version(p_business_id, 'publish', p_note);
    DELETE FROM public.website_drafts WHERE business_id = p_business_id;
    RETURN jsonb_build_object('number', v_number);
END;
$$;
REVOKE ALL ON FUNCTION public.website_publish(uuid, integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.website_publish(uuid, integer, text) TO authenticated, service_role;

-- Puts an older version live again, as a new version (history is never rewritten). An open
-- draft is thrown away, because it was based on what is being replaced.
CREATE OR REPLACE FUNCTION public.website_rollback(p_business_id uuid, p_version_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v public.website_versions;
    v_number integer;
BEGIN
    IF NOT public.has_permission(p_business_id, 'business.update') THEN
        RAISE EXCEPTION 'You do not have permission to publish the website.';
    END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended('website:' || p_business_id::text, 0));
    -- The version must belong to this shop: the shop comes from the caller's permission check
    -- above, and the version is looked up within it.
    SELECT * INTO v FROM public.website_versions WHERE id = p_version_id AND business_id = p_business_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'That version was not found.';
    END IF;
    PERFORM public.fn_website_apply(p_business_id, public.fn_website_clean_document(p_business_id, v.document));
    v_number := public.fn_website_record_version(p_business_id, 'rollback', 'Put back version ' || v.number);
    DELETE FROM public.website_drafts WHERE business_id = p_business_id;
    RETURN jsonb_build_object('number', v_number);
END;
$$;
REVOKE ALL ON FUNCTION public.website_rollback(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.website_rollback(uuid, uuid) TO authenticated, service_role;

-- ============================================================================================
-- 6. The storefront: public (live) and preview (draft)
-- ============================================================================================
-- The public brand from a brand document (live or draft). Internal notes never leave.
CREATE OR REPLACE FUNCTION public.fn_website_brand_shape(p jsonb)
RETURNS jsonb
LANGUAGE sql IMMUTABLE
SET search_path = ''
AS $$
    SELECT jsonb_strip_nulls(jsonb_build_object(
        'industry', p->>'industry',
        'personality', p->>'personality',
        'designPreset', p->>'design_preset',
        'tagline', p->>'tagline',
        'story', p->>'story',
        'mission', p->>'mission',
        'secondaryColor', CASE WHEN p->>'secondary_color' ~* '^#[0-9a-f]{6}$' THEN lower(p->>'secondary_color') END,
        'accentColor', p->>'accent_color',
        'backgroundColor', p->>'background_color',
        'headingFont', p->>'heading_font',
        'bodyFont', p->>'body_font',
        'headingWeight', p->'heading_weight',
        'cornerStyle', p->>'corner_style',
        'buttonStyle', p->>'button_style',
        'density', p->>'density',
        'imageStyle', p->>'image_style',
        'imageRatio', p->>'image_ratio',
        'logoLightUrl', p->>'logo_light_url',
        'logoMarkUrl', p->>'logo_mark_url',
        'faviconUrl', p->>'favicon_url',
        'socialLinks', NULLIF(p->'social_links', '{}'::jsonb),
        'openingHours', NULLIF(p->'opening_hours', '[]'::jsonb)));
$$;
GRANT EXECUTE ON FUNCTION public.fn_website_brand_shape(jsonb) TO service_role;

-- Same as 20261206001, now built from the live document so live and preview share one shape.
CREATE OR REPLACE FUNCTION public.fn_website_brand_public(p_business_id uuid)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT public.fn_website_brand_shape(public.fn_website_live_document(p_business_id)->'brand');
$$;
REVOKE ALL ON FUNCTION public.fn_website_brand_public(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_website_brand_public(uuid) TO service_role;

-- Same as 20261206001, plus 'home', 'navigation' and 'seo'.
CREATE OR REPLACE FUNCTION public.get_public_storefront(p_slug text)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_id uuid;
    v_shop jsonb;
    v_data jsonb;
    s public.website_settings;
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
    SELECT * INTO s FROM public.website_settings WHERE business_id = v_id;
    SELECT * INTO st FROM public.platform_settings WHERE id;
    RETURN v_data || jsonb_strip_nulls(jsonb_build_object(
        'home', s.home,
        'navigation', s.navigation,
        'seo', s.seo)) || jsonb_build_object(
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

-- A preview link for the draft, valid two hours. Returns the secret once; only its hash is kept.
CREATE OR REPLACE FUNCTION public.website_preview_link(p_business_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_secret text := encode(extensions.gen_random_bytes(24), 'hex');
    v_expires timestamptz := now() + interval '2 hours';
BEGIN
    IF NOT public.has_permission(p_business_id, 'business.update') THEN
        RAISE EXCEPTION 'You do not have permission to change the website.';
    END IF;
    IF (SELECT website_slug FROM public.businesses WHERE id = p_business_id) IS NULL THEN
        RAISE EXCEPTION 'Choose a web address for the shop first (Domains and publishing).';
    END IF;
    -- Only this shop's rows: another shop's rows may be locked by a read-only plan.
    DELETE FROM public.website_preview_links WHERE business_id = p_business_id AND expires_at < now();
    -- At most 20 open links per shop: the oldest go.
    DELETE FROM public.website_preview_links WHERE secret_hash IN (
        SELECT secret_hash FROM public.website_preview_links WHERE business_id = p_business_id
        ORDER BY expires_at DESC OFFSET 19);
    INSERT INTO public.website_preview_links (secret_hash, business_id, created_by, expires_at)
    VALUES (extensions.digest(v_secret, 'sha256'), p_business_id, auth.uid(), v_expires);
    RETURN jsonb_build_object(
        'secret', v_secret,
        'expiresAt', v_expires,
        'slug', (SELECT website_slug FROM public.businesses WHERE id = p_business_id),
        'host', public.fn_website_home_host(p_business_id));
END;
$$;
REVOKE ALL ON FUNCTION public.website_preview_link(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.website_preview_link(uuid) TO authenticated, service_role;

-- The storefront with the draft in place of the live design, for a valid preview secret on the
-- shop's own address (p_slug). Works before the shop is open online, so it can be prepared.
-- Products, prices, stock and reviews are the live ones: only the design is drafted.
CREATE OR REPLACE FUNCTION public.get_preview_storefront(p_slug text, p_secret text)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_id uuid;
    v_doc jsonb;
    v_data jsonb;
    v_shop jsonb;
    st public.platform_settings;
BEGIN
    IF p_secret IS NULL OR p_secret !~ '^[0-9a-f]{48}$' THEN
        RETURN NULL;
    END IF;
    SELECT l.business_id INTO v_id
    FROM public.website_preview_links l
    JOIN public.businesses b ON b.id = l.business_id
    WHERE l.secret_hash = extensions.digest(p_secret, 'sha256')
      AND l.expires_at > now()
      AND b.deleted_at IS NULL
      AND b.website_slug = lower(trim(p_slug));
    IF NOT FOUND THEN
        RETURN NULL;
    END IF;
    v_data := public.fn_public_storefront_data(lower(trim(p_slug)));
    IF v_data IS NULL THEN
        RETURN NULL;
    END IF;
    v_doc := COALESCE((SELECT document FROM public.website_drafts WHERE business_id = v_id),
                      public.fn_website_live_document(v_id));
    v_shop := public.fn_website_shop(v_id);
    SELECT * INTO st FROM public.platform_settings WHERE id;
    RETURN v_data || jsonb_build_object(
        'business', (v_data->'business') || jsonb_build_object(
            'description', v_doc#>>'{brand,description}',
            'logoUrl', v_doc#>>'{brand,logo_url}',
            'primaryColor', v_doc#>>'{brand,primary_color}'),
        'settings', (v_data->'settings') || jsonb_build_object(
            'openingHours', v_doc#>>'{contact,openingHours}',
            'whatsapp', v_doc#>>'{contact,whatsapp}'),
        'pages', v_doc->'pages',
        'heroSlides', COALESCE((SELECT jsonb_agg(x) FROM jsonb_array_elements(v_doc->'heroSlides') x
                                WHERE COALESCE((x->>'hidden')::boolean, FALSE) IS FALSE), '[]'::jsonb),
        'adCards', COALESCE((SELECT jsonb_agg(x) FROM jsonb_array_elements(v_doc->'adCards') x
                             WHERE COALESCE((x->>'hidden')::boolean, FALSE) IS FALSE), '[]'::jsonb),
        'brand', public.fn_website_brand_shape(v_doc->'brand'),
        'site', jsonb_build_object(
            'ordersOpen', FALSE,
            'poweredBy', (v_shop->>'powered_by')::boolean,
            'platformName', st.platform_name,
            'platformUrl', CASE WHEN st.platform_domain IS NOT NULL THEN 'https://' || st.platform_domain END,
            'host', public.fn_website_home_host(v_id),
            'preview', TRUE))
        || jsonb_strip_nulls(jsonb_build_object(
            'home', NULLIF(v_doc->'home', 'null'::jsonb),
            'navigation', NULLIF(v_doc->'navigation', 'null'::jsonb),
            'seo', NULLIF(v_doc->'seo', 'null'::jsonb)));
END;
$$;
REVOKE ALL ON FUNCTION public.get_preview_storefront(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_preview_storefront(text, text) TO anon, authenticated, service_role;

-- ============================================================================================
-- 7. Statistics from real records only: website orders. Visits are not counted yet.
-- ============================================================================================
CREATE OR REPLACE FUNCTION public.website_stats(p_business_id uuid, p_days integer DEFAULT 30)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_days integer := LEAST(GREATEST(COALESCE(p_days, 30), 1), 365);
    v_from timestamptz;
BEGIN
    IF NOT public.has_permission(p_business_id, 'business.update') THEN
        RAISE EXCEPTION 'You do not have permission to see website statistics.';
    END IF;
    v_from := date_trunc('day', now()) - make_interval(days => v_days - 1);
    RETURN jsonb_build_object(
        'days', v_days,
        'orders', (SELECT count(*) FROM public.online_orders WHERE business_id = p_business_id AND created_at >= v_from),
        'paidOrders', (SELECT count(*) FROM public.online_orders WHERE business_id = p_business_id AND created_at >= v_from AND paid_at IS NOT NULL),
        'revenue', (SELECT COALESCE(sum(total), 0)::numeric(14,2) FROM public.online_orders WHERE business_id = p_business_id AND created_at >= v_from AND paid_at IS NOT NULL),
        'byDay', COALESCE((
            SELECT jsonb_agg(jsonb_build_object('day', d.day, 'orders', d.orders, 'revenue', d.revenue) ORDER BY d.day)
            FROM (
                SELECT g.day::date AS day,
                       count(o.id) AS orders,
                       COALESCE(sum(o.total) FILTER (WHERE o.paid_at IS NOT NULL), 0)::numeric(14,2) AS revenue
                FROM generate_series(v_from, date_trunc('day', now()), interval '1 day') g(day)
                LEFT JOIN public.online_orders o
                    ON o.business_id = p_business_id AND o.created_at >= g.day AND o.created_at < g.day + interval '1 day'
                GROUP BY g.day) d), '[]'::jsonb),
        'topProducts', COALESCE((
            SELECT jsonb_agg(jsonb_build_object('name', t.name, 'quantity', t.quantity) ORDER BY t.quantity DESC, t.name)
            FROM (
                SELECT i.product_name AS name, round(sum(i.quantity), 1) AS quantity
                FROM public.online_order_items i
                JOIN public.online_orders o ON o.id = i.order_id
                WHERE o.business_id = p_business_id AND o.created_at >= v_from AND o.paid_at IS NOT NULL
                GROUP BY i.product_name
                ORDER BY sum(i.quantity) DESC, i.product_name
                LIMIT 5) t), '[]'::jsonb),
        'visitsCounted', FALSE);
END;
$$;
REVOKE ALL ON FUNCTION public.website_stats(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.website_stats(uuid, integer) TO authenticated, service_role;
