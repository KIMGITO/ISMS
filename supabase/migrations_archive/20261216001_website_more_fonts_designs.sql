-- 20261216001_website_more_fonts_designs.sql
-- Website design rebuild (2026-11-28): more fonts and five designs made for one kind of business.
--
--   * fn_website_fonts() gains 17 Google fonts (website/src/engine/brand.ts FONTS). Four are
--     display faces the website uses for headings only (Syne, Bebas Neue, DM Serif Display,
--     Abril Fatface); the database allows them in both columns and the website falls back to the
--     design's text font if one is chosen for text.
--   * personality and design_preset accept 'fresh', 'editorial', 'care', 'workshop', 'bistro'
--     (website/src/engine/presets.ts).
--   * Colour sets need no change: they fill the existing colour columns.
--   * No data changes. Shops with design_preset 'original' look exactly as before.
--
-- Reverse: restore fn_website_fonts() and the two checks from 20261206001 (only if no row uses
--          the new values: UPDATE website_brand SET ... = NULL first).

CREATE OR REPLACE FUNCTION public.fn_website_fonts()
RETURNS text[]
LANGUAGE sql IMMUTABLE
SET search_path = ''
AS $$
    -- Keep in step with FONTS in website/src/engine/brand.ts.
    SELECT ARRAY['Poppins', 'Inter', 'DM Sans', 'Manrope', 'Work Sans', 'Nunito Sans', 'Outfit',
                 'Archivo', 'Space Grotesk', 'IBM Plex Sans', 'Lora', 'Playfair Display',
                 'Cormorant Garamond', 'Fraunces', 'Source Serif 4',
                 'Plus Jakarta Sans', 'Figtree', 'Sora', 'Lexend', 'Rubik', 'Montserrat', 'Raleway',
                 'Josefin Sans', 'Barlow', 'Bricolage Grotesque', 'Syne', 'Bebas Neue',
                 'DM Serif Display', 'Libre Baskerville', 'EB Garamond', 'Merriweather', 'Abril Fatface'];
$$;

ALTER TABLE public.website_brand DROP CONSTRAINT IF EXISTS website_brand_personality_check;
ALTER TABLE public.website_brand ADD CONSTRAINT website_brand_personality_check CHECK (personality IS NULL OR personality IN (
    'premium', 'friendly', 'bold', 'classic', 'minimal', 'natural', 'technical', 'playful',
    'fresh', 'editorial', 'care', 'workshop', 'bistro'));

ALTER TABLE public.website_brand DROP CONSTRAINT IF EXISTS website_brand_design_preset_check;
ALTER TABLE public.website_brand ADD CONSTRAINT website_brand_design_preset_check CHECK (design_preset IS NULL OR design_preset IN (
    'original', 'premium', 'friendly', 'bold', 'classic', 'minimal', 'natural', 'technical', 'playful',
    'fresh', 'editorial', 'care', 'workshop', 'bistro'));
