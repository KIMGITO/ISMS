-- Home banner pictures placed freely: staff drag and zoom each picture in Online Store > Home banner.
--
-- Each slide may now carry "positions": one box per picture, { "x", "y", "w", "h" } in percent of
-- the square display (left, top, width, height). Without it the website uses the automatic layout.
-- Only the validator changes; get_public_storefront already returns the whole slide.
-- Needs 20261111002 (the hero_slides column and its CHECK, which calls this function).

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
    v_box   JSONB;
BEGIN
    IF p_slides IS NULL OR jsonb_typeof(p_slides) <> 'array' OR jsonb_array_length(p_slides) > 6 THEN
        RETURN FALSE;
    END IF;
    FOR v_slide IN SELECT value FROM jsonb_array_elements(p_slides) LOOP
        IF jsonb_typeof(v_slide) <> 'object' THEN RETURN FALSE; END IF;
        -- Only the known keys, so nothing unexpected reaches the public website.
        IF EXISTS (
            SELECT 1 FROM jsonb_object_keys(v_slide) k
            WHERE k NOT IN ('id', 'title', 'body', 'ctaLabel', 'ctaHref', 'images', 'positions', 'hidden')
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
        -- Optional: where each picture sits, one box per picture, in percent of the display.
        IF v_slide ? 'positions' THEN
            IF jsonb_typeof(v_slide->'positions') <> 'array'
               OR jsonb_array_length(v_slide->'positions') <> jsonb_array_length(v_slide->'images') THEN RETURN FALSE; END IF;
            FOR v_box IN SELECT value FROM jsonb_array_elements(v_slide->'positions') LOOP
                IF jsonb_typeof(v_box) <> 'object'
                   OR EXISTS (SELECT 1 FROM jsonb_object_keys(v_box) k WHERE k NOT IN ('x', 'y', 'w', 'h'))
                   OR jsonb_typeof(v_box->'x') IS DISTINCT FROM 'number'
                   OR jsonb_typeof(v_box->'y') IS DISTINCT FROM 'number'
                   OR jsonb_typeof(v_box->'w') IS DISTINCT FROM 'number'
                   OR jsonb_typeof(v_box->'h') IS DISTINCT FROM 'number'
                   OR (v_box->>'x')::numeric NOT BETWEEN -50 AND 100
                   OR (v_box->>'y')::numeric NOT BETWEEN -50 AND 100
                   OR (v_box->>'w')::numeric NOT BETWEEN 8 AND 200
                   OR (v_box->>'h')::numeric NOT BETWEEN 8 AND 200 THEN
                    RETURN FALSE;
                END IF;
            END LOOP;
        END IF;
    END LOOP;
    RETURN TRUE;
END;
$$;

COMMIT;
