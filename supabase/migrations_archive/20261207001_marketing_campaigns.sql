-- 20261207001_marketing_campaigns.sql
-- Marketing & advertising: campaigns, their creatives, website placements, a shared media
-- library (pictures and videos), scheduling in the shop's own time zone, publication history and
-- real advert statistics (loaded / seen / clicked / order placed). Plan: docs/MARKETING_AND_ADVERTISING.md.
--
--   * A campaign holds the schedule, status, priority and call to action. Its creatives (one per
--     placement: home banner, announcement bar, cards, product promotion, video, pop-up, category
--     banner, campaign page) share that schedule and status.
--   * Whether a campaign is showing is worked out from the clock every time it is read
--     (fn_mkt_status): never before its start, never after its end, with no job that has to run
--     on time. A job every 5 minutes only writes "started"/"ended" into the history.
--   * Visitors read adverts only through get_public_campaigns(slug); the shop comes from the
--     address, never from the caller. Drafts, paused, ended and archived campaigns are never in it.
--   * Every change goes through the functions below (has_permission marketing.manage); members with
--     marketing.view may read. Pictures and videos live in the public bucket website-media under
--     the shop's own folder and are registered in website_media, which checks the stored file's
--     real size and type.
--   * Statistics: "loaded" (on the page), "seen" (half visible for a second), "clicked", and
--     "order" (an online order placed by the signed-in customer who clicked, within 24 hours).
--     Each is counted once per visit, creative and day. A visit is a random id kept in the
--     browser tab; nothing personal is stored.
--   * Order values in the reports are read from online_orders at report time, never copied.
--
-- Reverse: SELECT cron.unschedule('marketing-jobs'); DROP FUNCTION <every function below>;
--          DROP TABLE marketing_conversions, marketing_ad_seen, marketing_ad_daily,
--          marketing_preview_links, marketing_campaign_events, marketing_creatives, marketing_placements, marketing_campaigns,
--          website_media, canva_oauth_states, canva_connections;
--          ALTER TABLE businesses DROP COLUMN timezone; DELETE FROM storage.buckets WHERE id = 'website-media';
--          DELETE FROM module_permissions WHERE pattern = 'marketing.%'; restore Manager defaults from 20261126002.

-- ============================================================================================
-- 1. The shop's time zone (schedules are typed in it)
-- ============================================================================================
ALTER TABLE public.businesses ADD COLUMN IF NOT EXISTS timezone text NOT NULL DEFAULT 'Africa/Nairobi';

CREATE OR REPLACE FUNCTION public.fn_valid_timezone(p text)
RETURNS boolean
LANGUAGE sql STABLE
SET search_path = ''
AS $$
    SELECT p IS NOT NULL AND EXISTS (SELECT 1 FROM pg_catalog.pg_timezone_names WHERE name = p);
$$;

CREATE OR REPLACE FUNCTION public.fn_business_timezone_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
    IF NOT public.fn_valid_timezone(NEW.timezone) THEN
        RAISE EXCEPTION 'Unknown time zone %', NEW.timezone USING ERRCODE = '22023';
    END IF;
    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_business_timezone_guard ON public.businesses;
CREATE TRIGGER trg_business_timezone_guard BEFORE INSERT OR UPDATE OF timezone ON public.businesses
    FOR EACH ROW EXECUTE FUNCTION public.fn_business_timezone_guard();

CREATE OR REPLACE FUNCTION public.business_set_timezone(p_business_id uuid, p_timezone text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    PERFORM public.assert_permission(p_business_id, 'business.update', 'marketing.manage');
    IF NOT public.fn_valid_timezone(p_timezone) THEN
        RAISE EXCEPTION 'Unknown time zone %', p_timezone USING ERRCODE = '22023';
    END IF;
    UPDATE public.businesses SET timezone = p_timezone WHERE id = p_business_id;
END;
$$;

-- ============================================================================================
-- 2. Media library (pictures, videos, captions) shared by adverts and the website
-- ============================================================================================
CREATE TABLE IF NOT EXISTS public.website_media (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    kind text NOT NULL CHECK (kind IN ('image', 'video', 'captions')),
    path text NOT NULL CHECK (length(path) <= 300),
    url text NOT NULL CHECK (url ~ '^https?://' AND length(url) <= 600),
    mime_type text NOT NULL,
    bytes bigint NOT NULL CHECK (bytes > 0),
    width integer CHECK (width BETWEEN 1 AND 8000),
    height integer CHECK (height BETWEEN 1 AND 8000),
    duration_ms integer CHECK (duration_ms BETWEEN 0 AND 600000),
    title text CHECK (length(title) <= 120),
    alt_text text CHECK (length(alt_text) <= 250),
    folder text CHECK (length(folder) <= 60),
    focal_x numeric(5,2) NOT NULL DEFAULT 50 CHECK (focal_x BETWEEN 0 AND 100),
    focal_y numeric(5,2) NOT NULL DEFAULT 50 CHECK (focal_y BETWEEN 0 AND 100),
    source text NOT NULL DEFAULT 'upload' CHECK (source IN ('upload', 'canva')),
    canva_design_id text CHECK (length(canva_design_id) <= 64),
    created_by uuid,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    deleted_at timestamptz,
    UNIQUE (path),
    CHECK (kind <> 'image' OR (width IS NOT NULL AND height IS NOT NULL)),
    CHECK (kind <> 'video' OR (width IS NOT NULL AND height IS NOT NULL AND duration_ms IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS idx_website_media_business ON public.website_media (business_id, created_at DESC) WHERE deleted_at IS NULL;

-- Files: public bucket (adverts are public), writes only into a shop's own folder by people who
-- may manage marketing or the website. Size and type limits are also enforced by the bucket.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types) VALUES
    ('website-media', 'website-media', true, 52428800,
     '{image/jpeg,image/png,image/webp,image/avif,image/gif,video/mp4,video/webm,text/vtt}')
ON CONFLICT (id) DO UPDATE SET public = EXCLUDED.public, file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "website-media upload" ON storage.objects;
CREATE POLICY "website-media upload" ON storage.objects AS PERMISSIVE FOR INSERT TO authenticated
    WITH CHECK (bucket_id = 'website-media'
        AND public.fn_storage_folder_permission(split_part(name, '/', 1), VARIADIC ARRAY['marketing.manage', 'business.update']));
DROP POLICY IF EXISTS "website-media delete" ON storage.objects;
CREATE POLICY "website-media delete" ON storage.objects AS PERMISSIVE FOR DELETE TO authenticated
    USING (bucket_id = 'website-media'
        AND public.fn_storage_folder_permission(split_part(name, '/', 1), VARIADIC ARRAY['marketing.manage', 'business.update']));
DROP POLICY IF EXISTS "website-media read" ON storage.objects;
CREATE POLICY "website-media read" ON storage.objects AS PERMISSIVE FOR SELECT TO anon, authenticated
    USING (bucket_id = 'website-media');

-- ============================================================================================
-- 3. Campaigns, creatives, placements, history
-- ============================================================================================
CREATE TABLE IF NOT EXISTS public.marketing_campaigns (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 80),
    description text CHECK (length(description) <= 500),
    campaign_type text NOT NULL DEFAULT 'other' CHECK (campaign_type IN ('seasonal', 'discount', 'flash_sale',
        'brand_awareness', 'black_friday', 'christmas', 'new_product', 'clearance', 'event', 'other')),
    objective text NOT NULL DEFAULT 'sales' CHECK (objective IN ('awareness', 'traffic', 'sales', 'product_launch', 'engagement', 'store_visits')),
    -- What staff decided. What visitors see also depends on the clock: fn_mkt_status.
    state text NOT NULL DEFAULT 'draft' CHECK (state IN ('draft', 'live', 'paused', 'ended', 'archived')),
    starts_at timestamptz NOT NULL,
    ends_at timestamptz,
    priority integer NOT NULL DEFAULT 50 CHECK (priority BETWEEN 1 AND 100),
    cta_label text CHECK (length(cta_label) <= 30),
    cta_kind text NOT NULL DEFAULT 'none' CHECK (cta_kind IN ('none', 'link', 'product', 'category', 'landing', 'promo_code', 'whatsapp')),
    cta_target text CHECK (length(cta_target) <= 300),
    discount_label text CHECK (length(discount_label) <= 40),
    promotion_id uuid REFERENCES public.website_promo_codes(id) ON DELETE SET NULL,
    target_product_ids uuid[] NOT NULL DEFAULT '{}' CHECK (cardinality(target_product_ids) <= 24),
    target_category text CHECK (length(target_category) <= 80),
    landing_slug text CHECK (landing_slug ~ '^[a-z0-9]([a-z0-9-]{0,48}[a-z0-9])?$'),
    tone text NOT NULL DEFAULT 'brand' CHECK (tone IN ('brand', 'dark', 'light')),
    revision integer NOT NULL DEFAULT 1,
    started_logged_at timestamptz,
    ended_logged_at timestamptz,
    published_at timestamptz,
    created_by uuid,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CHECK (ends_at IS NULL OR ends_at > starts_at),
    UNIQUE (business_id, landing_slug)
);
CREATE INDEX IF NOT EXISTS idx_marketing_campaigns_live ON public.marketing_campaigns (business_id, starts_at, ends_at) WHERE state = 'live';
CREATE INDEX IF NOT EXISTS idx_marketing_campaigns_business ON public.marketing_campaigns (business_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS public.marketing_creatives (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id uuid NOT NULL REFERENCES public.marketing_campaigns(id) ON DELETE CASCADE,
    business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    placement text NOT NULL CHECK (placement IN ('hero', 'announcement', 'card', 'product', 'video', 'popup', 'category', 'landing')),
    format text NOT NULL CHECK (format IN ('hero_16x9', 'wide_3x1', 'card_4x5', 'square_1x1', 'story_9x16', 'video_16x9', 'video_9x16', 'text')),
    media_id uuid REFERENCES public.website_media(id),
    mobile_media_id uuid REFERENCES public.website_media(id),
    poster_media_id uuid REFERENCES public.website_media(id),
    captions_media_id uuid REFERENCES public.website_media(id),
    headline text CHECK (length(headline) <= 90),
    body text CHECK (length(body) <= 200),
    cta_label text CHECK (length(cta_label) <= 30),
    alt_text text CHECK (length(alt_text) <= 250),
    focal_x numeric(5,2) CHECK (focal_x BETWEEN 0 AND 100),
    focal_y numeric(5,2) CHECK (focal_y BETWEEN 0 AND 100),
    text_position text NOT NULL DEFAULT 'left' CHECK (text_position IN ('left', 'center', 'right', 'none')),
    autoplay_muted boolean NOT NULL DEFAULT false,
    hidden boolean NOT NULL DEFAULT false,
    position integer NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_marketing_creatives_campaign ON public.marketing_creatives (campaign_id, position);
CREATE INDEX IF NOT EXISTS idx_marketing_creatives_media ON public.marketing_creatives (media_id);

-- Per shop, per placement: on/off and how many adverts share it. No row = the defaults in fn_mkt_placement.
CREATE TABLE IF NOT EXISTS public.marketing_placements (
    business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    placement text NOT NULL CHECK (placement IN ('hero', 'announcement', 'card', 'product', 'video', 'popup', 'category', 'landing')),
    enabled boolean NOT NULL DEFAULT true,
    max_items integer NOT NULL CHECK (max_items BETWEEN 1 AND 6),
    rotation text NOT NULL DEFAULT 'priority' CHECK (rotation IN ('priority', 'rotate')),
    interval_s integer NOT NULL DEFAULT 7 CHECK (interval_s BETWEEN 4 AND 30),
    popup_delay_s integer NOT NULL DEFAULT 8 CHECK (popup_delay_s BETWEEN 3 AND 120),
    popup_every_h integer NOT NULL DEFAULT 24 CHECK (popup_every_h BETWEEN 6 AND 720),
    updated_by uuid,
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (business_id, placement)
);

CREATE TABLE IF NOT EXISTS public.marketing_campaign_events (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    campaign_id uuid NOT NULL REFERENCES public.marketing_campaigns(id) ON DELETE CASCADE,
    business_id uuid NOT NULL,
    event text NOT NULL CHECK (event IN ('created', 'edited', 'published', 'unpublished', 'paused', 'resumed',
        'ended', 'archived', 'restored', 'duplicated', 'started', 'finished', 'creative_added', 'creative_changed', 'creative_removed')),
    note text CHECK (length(note) <= 300),
    actor uuid,
    at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_marketing_events_campaign ON public.marketing_campaign_events (campaign_id, at DESC);
CREATE INDEX IF NOT EXISTS idx_marketing_events_business ON public.marketing_campaign_events (business_id, at DESC);

-- Statistics: one row per creative per day; raw "seen once per visit" keys kept 3 days for de-duplication.
CREATE TABLE IF NOT EXISTS public.marketing_ad_daily (
    creative_id uuid NOT NULL REFERENCES public.marketing_creatives(id) ON DELETE CASCADE,
    day date NOT NULL,
    business_id uuid NOT NULL,
    campaign_id uuid NOT NULL,
    loads integer NOT NULL DEFAULT 0,
    views integer NOT NULL DEFAULT 0,
    clicks integer NOT NULL DEFAULT 0,
    conversions integer NOT NULL DEFAULT 0,
    PRIMARY KEY (creative_id, day)
);
CREATE INDEX IF NOT EXISTS idx_marketing_ad_daily_campaign ON public.marketing_ad_daily (campaign_id, day);
CREATE INDEX IF NOT EXISTS idx_marketing_ad_daily_business ON public.marketing_ad_daily (business_id, day);

CREATE TABLE IF NOT EXISTS public.marketing_ad_seen (
    visit text NOT NULL,
    creative_id uuid NOT NULL,
    kind text NOT NULL CHECK (kind IN ('load', 'view', 'click')),
    day date NOT NULL,
    at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (visit, creative_id, kind, day)
);
CREATE INDEX IF NOT EXISTS idx_marketing_ad_seen_at ON public.marketing_ad_seen (at);

-- One order counts for at most one advert (the last one clicked in that visit).
CREATE TABLE IF NOT EXISTS public.marketing_conversions (
    order_id uuid PRIMARY KEY REFERENCES public.online_orders(id) ON DELETE CASCADE,
    business_id uuid NOT NULL,
    campaign_id uuid NOT NULL REFERENCES public.marketing_campaigns(id) ON DELETE CASCADE,
    creative_id uuid NOT NULL REFERENCES public.marketing_creatives(id) ON DELETE CASCADE,
    at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_marketing_conversions_campaign ON public.marketing_conversions (campaign_id);

-- Canva: one connection per person (Canva accounts belong to people, not shops). Tokens are
-- encrypted by the canva-connect function before they get here; only that function reads them.
CREATE TABLE IF NOT EXISTS public.canva_connections (
    user_id uuid PRIMARY KEY,
    canva_user_id text,
    canva_team_id text,
    display_name text,
    access_token_enc text NOT NULL,
    refresh_token_enc text NOT NULL,
    access_expires_at timestamptz NOT NULL,
    scopes text,
    connected_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.canva_oauth_states (
    state text PRIMARY KEY,
    user_id uuid NOT NULL,
    business_id uuid NOT NULL,
    verifier_enc text NOT NULL,
    return_to text,
    created_at timestamptz NOT NULL DEFAULT now()
);

-- ============================================================================================
-- 4. Rules shared by the app (src/features/marketing/rules.ts, same numbers; compared by tests)
-- ============================================================================================
-- Formats: the shape a picture is shown in. ratio = width / height.
CREATE OR REPLACE FUNCTION public.fn_mkt_format(p_format text)
RETURNS jsonb
LANGUAGE sql IMMUTABLE
SET search_path = ''
AS $$
    SELECT CASE p_format
        WHEN 'hero_16x9'  THEN '{"ratio":1.7778,"min_width":1280,"media":"image"}'
        WHEN 'wide_3x1'   THEN '{"ratio":3.0,"min_width":1200,"media":"image"}'
        WHEN 'card_4x5'   THEN '{"ratio":0.8,"min_width":600,"media":"image"}'
        WHEN 'square_1x1' THEN '{"ratio":1.0,"min_width":600,"media":"image"}'
        WHEN 'story_9x16' THEN '{"ratio":0.5625,"min_width":720,"media":"image"}'
        WHEN 'video_16x9' THEN '{"ratio":1.7778,"min_width":640,"media":"video"}'
        WHEN 'video_9x16' THEN '{"ratio":0.5625,"min_width":360,"media":"video"}'
        WHEN 'text'       THEN '{"media":"none"}'
    END::jsonb;
$$;

-- Placements: which formats each takes, and its defaults.
CREATE OR REPLACE FUNCTION public.fn_mkt_placement(p_placement text)
RETURNS jsonb
LANGUAGE sql IMMUTABLE
SET search_path = ''
AS $$
    SELECT CASE p_placement
        WHEN 'hero'         THEN '{"formats":["hero_16x9","video_16x9"],"mobile":["hero_16x9","card_4x5","square_1x1","story_9x16"],"max_items":3,"rotation":"rotate"}'
        WHEN 'announcement' THEN '{"formats":["text"],"mobile":[],"max_items":1,"rotation":"rotate"}'
        WHEN 'card'         THEN '{"formats":["card_4x5","square_1x1"],"mobile":[],"max_items":3,"rotation":"priority"}'
        WHEN 'product'      THEN '{"formats":["text","square_1x1","card_4x5"],"mobile":[],"max_items":1,"rotation":"priority"}'
        WHEN 'video'        THEN '{"formats":["video_16x9","video_9x16"],"mobile":["video_9x16"],"max_items":1,"rotation":"priority"}'
        WHEN 'popup'        THEN '{"formats":["square_1x1","card_4x5","text"],"mobile":[],"max_items":1,"rotation":"priority"}'
        WHEN 'category'     THEN '{"formats":["wide_3x1"],"mobile":["wide_3x1","square_1x1","card_4x5"],"max_items":1,"rotation":"rotate"}'
        WHEN 'landing'      THEN '{"formats":["hero_16x9","wide_3x1","square_1x1","card_4x5","video_16x9","video_9x16","text"],"mobile":["card_4x5","square_1x1","story_9x16","video_9x16"],"max_items":6,"rotation":"priority"}'
    END::jsonb;
$$;

-- A call to action goes to a page of this website or to an https address. Nothing else.
CREATE OR REPLACE FUNCTION public.fn_mkt_valid_href(p text)
RETURNS boolean
LANGUAGE sql IMMUTABLE
SET search_path = ''
AS $$
    SELECT p IS NOT NULL AND length(p) <= 300 AND p !~ '[\s"''<>\\]'
       AND ((p ~ '^/' AND p !~ '^//') OR p ~* '^https://[a-z0-9.-]+\.[a-z]{2,}(/|$|\?|#)');
$$;

-- What visitors see now: draft | scheduled | active | paused | completed | archived.
CREATE OR REPLACE FUNCTION public.fn_mkt_status(p_state text, p_starts timestamptz, p_ends timestamptz, p_now timestamptz DEFAULT now())
RETURNS text
LANGUAGE sql IMMUTABLE
SET search_path = ''
AS $$
    SELECT CASE
        WHEN p_state = 'archived' THEN 'archived'
        WHEN p_state = 'draft' THEN 'draft'
        WHEN p_state = 'ended' THEN 'completed'
        WHEN p_ends IS NOT NULL AND p_now >= p_ends THEN 'completed'
        WHEN p_state = 'paused' THEN 'paused'
        WHEN p_now < p_starts THEN 'scheduled'
        ELSE 'active'
    END;
$$;

-- Local time typed in the app ('2026-11-27T08:00') to an instant, in the shop's time zone.
CREATE OR REPLACE FUNCTION public.fn_mkt_local_time(p_business_id uuid, p_local text)
RETURNS timestamptz
LANGUAGE plpgsql STABLE
SET search_path = ''
AS $$
DECLARE
    v_tz text;
BEGIN
    IF p_local IS NULL OR btrim(p_local) = '' THEN
        RETURN NULL;
    END IF;
    IF p_local !~ '^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2})?$' THEN
        RAISE EXCEPTION 'Dates must look like 2026-11-27 08:00' USING ERRCODE = '22023';
    END IF;
    SELECT timezone INTO v_tz FROM public.businesses WHERE id = p_business_id;
    RETURN (replace(p_local, 'T', ' ')::timestamp) AT TIME ZONE COALESCE(v_tz, 'Africa/Nairobi');
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_mkt_log(p_campaign uuid, p_business uuid, p_event text, p_note text DEFAULT NULL)
RETURNS void
LANGUAGE sql
SET search_path = ''
AS $$
    INSERT INTO public.marketing_campaign_events (campaign_id, business_id, event, note, actor)
    VALUES (p_campaign, p_business, p_event, left(p_note, 300), auth.uid());
$$;

-- Problems that stop a campaign going live (empty array = fine). Also used by the app.
CREATE OR REPLACE FUNCTION public.fn_mkt_campaign_problems(p_campaign_id uuid)
RETURNS text[]
LANGUAGE plpgsql STABLE
SET search_path = ''
AS $$
DECLARE
    c public.marketing_campaigns;
    v text[] := '{}';
BEGIN
    SELECT * INTO c FROM public.marketing_campaigns WHERE id = p_campaign_id;
    IF NOT EXISTS (SELECT 1 FROM public.marketing_creatives WHERE campaign_id = c.id AND NOT hidden) THEN
        v := array_append(v, 'Add at least one creative (a banner, card, video or message).');
    END IF;
    IF c.ends_at IS NOT NULL AND c.ends_at <= now() THEN
        v := array_append(v, 'The end date has already passed.');
    END IF;
    IF c.cta_kind NOT IN ('none', 'promo_code', 'whatsapp') AND COALESCE(c.cta_target, '') = '' AND c.cta_kind <> 'landing' THEN
        v := array_append(v, 'Choose where the button goes.');
    END IF;
    IF c.cta_kind = 'landing' AND c.landing_slug IS NULL THEN
        v := array_append(v, 'Give the campaign page a web address first.');
    END IF;
    IF c.cta_kind = 'promo_code' AND c.promotion_id IS NULL THEN
        v := array_append(v, 'Choose the promotion code the button shows.');
    END IF;
    IF EXISTS (SELECT 1 FROM public.marketing_creatives r
               WHERE r.campaign_id = c.id AND NOT r.hidden AND r.placement = 'product'
                 AND cardinality(c.target_product_ids) = 0 AND c.target_category IS NULL) THEN
        v := array_append(v, 'A product promotion needs the products or the category it is shown on.');
    END IF;
    -- Two pop-ups at the same time with the same priority would take turns at random: refuse.
    IF EXISTS (SELECT 1 FROM public.marketing_creatives r WHERE r.campaign_id = c.id AND NOT r.hidden AND r.placement = 'popup')
       AND EXISTS (
        SELECT 1 FROM public.marketing_campaigns o
        JOIN public.marketing_creatives orr ON orr.campaign_id = o.id AND NOT orr.hidden AND orr.placement = 'popup'
        WHERE o.business_id = c.business_id AND o.id <> c.id AND o.state IN ('live', 'paused')
          AND o.priority = c.priority
          AND (o.ends_at IS NULL OR o.ends_at > c.starts_at)
          AND (c.ends_at IS NULL OR c.ends_at > o.starts_at)
          AND (o.ends_at IS NULL OR o.ends_at > now())) THEN
        v := array_append(v, 'Another campaign has a pop-up at the same time with the same priority. Change the priority of one of them.');
    END IF;
    RETURN v;
END;
$$;

-- A creative's media must exist in this shop, be the right kind, and be sharp enough for its format.
CREATE OR REPLACE FUNCTION public.fn_mkt_check_media(p_business uuid, p_media uuid, p_format text, p_what text)
RETURNS void
LANGUAGE plpgsql STABLE
SET search_path = ''
AS $$
DECLARE
    m public.website_media;
    f jsonb := public.fn_mkt_format(p_format);
BEGIN
    IF p_media IS NULL THEN
        RETURN;
    END IF;
    SELECT * INTO m FROM public.website_media WHERE id = p_media AND business_id = p_business AND deleted_at IS NULL;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'The % is not in this shop''s media library', p_what USING ERRCODE = '22023';
    END IF;
    IF p_what = 'poster picture' THEN
        IF m.kind <> 'image' THEN RAISE EXCEPTION 'The poster must be a picture' USING ERRCODE = '22023'; END IF;
        RETURN;
    END IF;
    IF p_what = 'captions file' THEN
        IF m.kind <> 'captions' THEN RAISE EXCEPTION 'Captions must be a .vtt file' USING ERRCODE = '22023'; END IF;
        RETURN;
    END IF;
    IF f->>'media' = 'none' THEN
        RAISE EXCEPTION 'A text-only creative has no picture' USING ERRCODE = '22023';
    END IF;
    IF m.kind <> f->>'media' THEN
        RAISE EXCEPTION 'This format needs a %', CASE f->>'media' WHEN 'video' THEN 'video' ELSE 'picture' END USING ERRCODE = '22023';
    END IF;
    -- Half the recommended width is the floor; below it the advert would look blurred.
    IF m.width < (f->>'min_width')::integer / 2 THEN
        RAISE EXCEPTION 'The % is too small for this format (% px wide; at least % px, ideally %)',
            p_what, m.width, (f->>'min_width')::integer / 2, f->>'min_width' USING ERRCODE = '22023';
    END IF;
END;
$$;

-- ============================================================================================
-- 5. Staff functions
-- ============================================================================================
-- Register an uploaded file. The size and type come from the stored file itself, not the caller.
CREATE OR REPLACE FUNCTION public.website_media_register(p_business_id uuid, p_path text, p_meta jsonb DEFAULT '{}')
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    o record;
    v_mime text;
    v_bytes bigint;
    v_kind text;
    v_id uuid;
    v_used bigint;
    v_quota bigint;
    v_w integer := NULLIF(p_meta->>'width', '')::integer;
    v_h integer := NULLIF(p_meta->>'height', '')::integer;
    v_d integer := NULLIF(p_meta->>'duration_ms', '')::integer;
    v_url text;
BEGIN
    PERFORM public.assert_permission(p_business_id, 'marketing.manage', 'business.update');
    IF p_path IS NULL OR split_part(p_path, '/', 1) <> p_business_id::text OR p_path ~ '\.\.' THEN
        RAISE EXCEPTION 'That file is not in this shop''s folder' USING ERRCODE = '42501';
    END IF;
    SELECT * INTO o FROM storage.objects WHERE bucket_id = 'website-media' AND name = p_path;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'The upload did not finish. Try again.' USING ERRCODE = 'P0002';
    END IF;
    v_mime := lower(COALESCE(o.metadata->>'mimetype', ''));
    v_bytes := COALESCE((o.metadata->>'size')::bigint, 0);
    v_kind := CASE
        WHEN v_mime IN ('image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/gif') THEN 'image'
        WHEN v_mime IN ('video/mp4', 'video/webm') THEN 'video'
        WHEN v_mime = 'text/vtt' THEN 'captions' END;
    IF v_kind IS NULL THEN
        RAISE EXCEPTION 'That kind of file is not accepted (%). Use JPG, PNG, WebP, AVIF, GIF, MP4, WebM or VTT.', v_mime USING ERRCODE = '22023';
    END IF;
    IF (v_kind = 'image' AND v_bytes > 10485760) OR (v_kind = 'video' AND v_bytes > 52428800) OR (v_kind = 'captions' AND v_bytes > 204800) THEN
        RAISE EXCEPTION 'That file is too large (pictures up to 10 MB, videos up to 50 MB, captions up to 200 KB)' USING ERRCODE = '22023';
    END IF;
    IF v_kind IN ('image', 'video') AND (v_w IS NULL OR v_h IS NULL OR v_w NOT BETWEEN 16 AND 8000 OR v_h NOT BETWEEN 16 AND 8000) THEN
        RAISE EXCEPTION 'The picture size could not be read' USING ERRCODE = '22023';
    END IF;
    IF v_kind = 'video' AND (v_d IS NULL OR v_d NOT BETWEEN 1000 AND 180000) THEN
        RAISE EXCEPTION 'Videos must be between 1 second and 3 minutes long' USING ERRCODE = '22023';
    END IF;
    -- The plan's storage allowance covers this library.
    v_quota := NULLIF(public.fn_tenant_plan(public.fn_business_tenant(p_business_id))->>'storage_mb', '')::bigint * 1048576;
    IF v_quota IS NOT NULL AND v_quota > 0 THEN
        SELECT COALESCE(sum(m.bytes), 0) INTO v_used FROM public.website_media m
        JOIN public.businesses b ON b.id = m.business_id
        WHERE b.tenant_id = (SELECT tenant_id FROM public.businesses WHERE id = p_business_id) AND m.deleted_at IS NULL;
        IF v_used + v_bytes > v_quota THEN
            RAISE EXCEPTION 'Your plan''s storage is full (% MB). Remove unused media or change plan.', v_quota / 1048576 USING ERRCODE = '53100';
        END IF;
    END IF;
    v_url := NULLIF(p_meta->>'url', '');
    IF v_url IS NULL OR v_url !~ ('^https?://[^/]+/storage/v1/object/public/website-media/' || replace(p_path, '.', '\.') || '$') THEN
        RAISE EXCEPTION 'The file address does not match the upload' USING ERRCODE = '22023';
    END IF;
    INSERT INTO public.website_media (business_id, kind, path, url, mime_type, bytes, width, height, duration_ms,
        title, alt_text, folder, source, canva_design_id, created_by)
    VALUES (p_business_id, v_kind, p_path, v_url, v_mime, v_bytes,
        CASE WHEN v_kind <> 'captions' THEN v_w END, CASE WHEN v_kind <> 'captions' THEN v_h END,
        CASE WHEN v_kind = 'video' THEN v_d END,
        left(NULLIF(btrim(p_meta->>'title'), ''), 120), left(NULLIF(btrim(p_meta->>'alt_text'), ''), 250),
        left(NULLIF(btrim(p_meta->>'folder'), ''), 60),
        CASE WHEN p_meta->>'source' = 'canva' THEN 'canva' ELSE 'upload' END,
        left(NULLIF(p_meta->>'canva_design_id', ''), 64), auth.uid())
    RETURNING id INTO v_id;
    RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.website_media_update(p_media_id uuid, p_meta jsonb)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    m public.website_media;
BEGIN
    SELECT * INTO m FROM public.website_media WHERE id = p_media_id AND deleted_at IS NULL;
    IF NOT FOUND THEN RAISE EXCEPTION 'Media not found' USING ERRCODE = 'P0002'; END IF;
    PERFORM public.assert_permission(m.business_id, 'marketing.manage', 'business.update');
    UPDATE public.website_media SET
        title = CASE WHEN p_meta ? 'title' THEN left(NULLIF(btrim(p_meta->>'title'), ''), 120) ELSE title END,
        alt_text = CASE WHEN p_meta ? 'alt_text' THEN left(NULLIF(btrim(p_meta->>'alt_text'), ''), 250) ELSE alt_text END,
        folder = CASE WHEN p_meta ? 'folder' THEN left(NULLIF(btrim(p_meta->>'folder'), ''), 60) ELSE folder END,
        focal_x = CASE WHEN p_meta ? 'focal_x' THEN (p_meta->>'focal_x')::numeric ELSE focal_x END,
        focal_y = CASE WHEN p_meta ? 'focal_y' THEN (p_meta->>'focal_y')::numeric ELSE focal_y END,
        updated_at = now()
    WHERE id = p_media_id;
END;
$$;

-- Removes media no creative uses. Returns the stored path when the file itself may be deleted
-- (nothing ever referred to it), else NULL (kept for the history of past campaigns).
CREATE OR REPLACE FUNCTION public.website_media_remove(p_media_id uuid)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    m public.website_media;
    v_ref boolean;
BEGIN
    SELECT * INTO m FROM public.website_media WHERE id = p_media_id AND deleted_at IS NULL;
    IF NOT FOUND THEN RAISE EXCEPTION 'Media not found' USING ERRCODE = 'P0002'; END IF;
    PERFORM public.assert_permission(m.business_id, 'marketing.manage', 'business.update');
    IF EXISTS (SELECT 1 FROM public.marketing_creatives r JOIN public.marketing_campaigns c ON c.id = r.campaign_id
               WHERE c.state <> 'archived' AND p_media_id IN (r.media_id, r.mobile_media_id, r.poster_media_id, r.captions_media_id)) THEN
        RAISE EXCEPTION 'A campaign still uses this. Replace it in the campaign first.' USING ERRCODE = '23503';
    END IF;
    v_ref := EXISTS (SELECT 1 FROM public.marketing_creatives r
                     WHERE p_media_id IN (r.media_id, r.mobile_media_id, r.poster_media_id, r.captions_media_id));
    IF v_ref THEN
        UPDATE public.website_media SET deleted_at = now(), updated_at = now() WHERE id = p_media_id;
        RETURN NULL;
    END IF;
    DELETE FROM public.website_media WHERE id = p_media_id;
    RETURN m.path;
END;
$$;

-- Create (p_campaign->>'id' empty) or change a campaign. Times are local to the shop.
CREATE OR REPLACE FUNCTION public.marketing_campaign_save(p_business_id uuid, p_campaign jsonb, p_base_revision integer DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    c public.marketing_campaigns;
    v_id uuid := NULLIF(p_campaign->>'id', '')::uuid;
    v_starts timestamptz;
    v_ends timestamptz;
    v_products uuid[];
    v_kind text := COALESCE(NULLIF(p_campaign->>'cta_kind', ''), 'none');
    v_target text := NULLIF(btrim(p_campaign->>'cta_target'), '');
    v_promo uuid := NULLIF(p_campaign->>'promotion_id', '')::uuid;
    k text;
BEGIN
    PERFORM public.assert_permission(p_business_id, 'marketing.manage');
    FOR k IN SELECT jsonb_object_keys(p_campaign) LOOP
        IF k NOT IN ('id', 'name', 'description', 'campaign_type', 'objective', 'starts_local', 'ends_local', 'priority',
                     'cta_label', 'cta_kind', 'cta_target', 'discount_label', 'promotion_id', 'target_product_ids',
                     'target_category', 'landing_slug', 'tone') THEN
            RAISE EXCEPTION 'Unknown campaign setting %', k USING ERRCODE = '22023';
        END IF;
    END LOOP;
    v_starts := public.fn_mkt_local_time(p_business_id, p_campaign->>'starts_local');
    v_ends := public.fn_mkt_local_time(p_business_id, p_campaign->>'ends_local');
    IF v_starts IS NULL THEN
        RAISE EXCEPTION 'Choose when the campaign starts' USING ERRCODE = '22023';
    END IF;
    IF v_ends IS NOT NULL AND v_ends <= v_starts THEN
        RAISE EXCEPTION 'The campaign must end after it starts' USING ERRCODE = '22023';
    END IF;
    -- Destination checks
    IF v_kind = 'link' AND NOT public.fn_mkt_valid_href(v_target) THEN
        RAISE EXCEPTION 'The button link must be a page of your website (/shop) or an https:// address' USING ERRCODE = '22023';
    END IF;
    IF v_kind = 'product' AND (v_target IS NULL OR NOT EXISTS (
            SELECT 1 FROM public.products WHERE id::text = v_target AND business_id = p_business_id)) THEN
        RAISE EXCEPTION 'Choose a product of this shop for the button' USING ERRCODE = '22023';
    END IF;
    IF v_kind NOT IN ('link', 'product', 'category') THEN
        v_target := NULL;
    END IF;
    IF v_promo IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.website_promo_codes WHERE id = v_promo AND business_id = p_business_id) THEN
        RAISE EXCEPTION 'That promotion code is not this shop''s' USING ERRCODE = '22023';
    END IF;
    SELECT COALESCE(array_agg(DISTINCT x::uuid), '{}') INTO v_products
    FROM jsonb_array_elements_text(COALESCE(p_campaign->'target_product_ids', '[]')) x;
    IF EXISTS (SELECT 1 FROM unnest(v_products) pid WHERE NOT EXISTS (
            SELECT 1 FROM public.products p WHERE p.id = pid AND p.business_id = p_business_id)) THEN
        RAISE EXCEPTION 'Some chosen products are not this shop''s' USING ERRCODE = '22023';
    END IF;

    IF v_id IS NULL THEN
        INSERT INTO public.marketing_campaigns (business_id, name, starts_at, created_by)
        VALUES (p_business_id, COALESCE(NULLIF(btrim(p_campaign->>'name'), ''), 'x'), v_starts, auth.uid())
        RETURNING * INTO c;
        PERFORM public.fn_mkt_log(c.id, p_business_id, 'created');
    ELSE
        SELECT * INTO c FROM public.marketing_campaigns WHERE id = v_id AND business_id = p_business_id FOR UPDATE;
        IF NOT FOUND THEN RAISE EXCEPTION 'Campaign not found' USING ERRCODE = 'P0002'; END IF;
        IF c.state = 'archived' THEN RAISE EXCEPTION 'Restore the campaign before changing it' USING ERRCODE = '22023'; END IF;
        IF p_base_revision IS NOT NULL AND p_base_revision <> c.revision THEN
            RAISE EXCEPTION 'Someone else saved this campaign. Reload it and make your change again.' USING ERRCODE = '40001';
        END IF;
        PERFORM public.fn_mkt_log(c.id, p_business_id, 'edited');
    END IF;

    UPDATE public.marketing_campaigns SET
        name = btrim(p_campaign->>'name'),
        description = NULLIF(btrim(p_campaign->>'description'), ''),
        campaign_type = COALESCE(NULLIF(p_campaign->>'campaign_type', ''), 'other'),
        objective = COALESCE(NULLIF(p_campaign->>'objective', ''), 'sales'),
        starts_at = v_starts,
        ends_at = v_ends,
        priority = COALESCE(NULLIF(p_campaign->>'priority', '')::integer, 50),
        cta_label = NULLIF(btrim(p_campaign->>'cta_label'), ''),
        cta_kind = v_kind,
        cta_target = v_target,
        discount_label = NULLIF(btrim(p_campaign->>'discount_label'), ''),
        promotion_id = v_promo,
        target_product_ids = v_products,
        target_category = NULLIF(btrim(p_campaign->>'target_category'), ''),
        landing_slug = NULLIF(lower(btrim(p_campaign->>'landing_slug')), ''),
        tone = COALESCE(NULLIF(p_campaign->>'tone', ''), 'brand'),
        -- A changed schedule is announced again by the job.
        started_logged_at = CASE WHEN v_starts IS DISTINCT FROM c.starts_at THEN NULL ELSE c.started_logged_at END,
        ended_logged_at = CASE WHEN v_ends IS DISTINCT FROM c.ends_at THEN NULL ELSE c.ended_logged_at END,
        revision = c.revision + CASE WHEN v_id IS NULL THEN 0 ELSE 1 END,
        updated_at = now()
    WHERE id = c.id;
    RETURN c.id;
EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'Another campaign already uses that page address' USING ERRCODE = '23505';
END;
$$;

-- publish | unpublish | pause | resume | end | archive | restore
CREATE OR REPLACE FUNCTION public.marketing_campaign_action(p_campaign_id uuid, p_action text, p_note text DEFAULT NULL)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    c public.marketing_campaigns;
    v_status text;
    v_problems text[];
BEGIN
    SELECT * INTO c FROM public.marketing_campaigns WHERE id = p_campaign_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Campaign not found' USING ERRCODE = 'P0002'; END IF;
    PERFORM public.assert_permission(c.business_id, 'marketing.manage');
    v_status := public.fn_mkt_status(c.state, c.starts_at, c.ends_at);

    IF p_action = 'publish' THEN
        IF c.state NOT IN ('draft') THEN RAISE EXCEPTION 'Only a draft can be published' USING ERRCODE = '22023'; END IF;
        v_problems := public.fn_mkt_campaign_problems(c.id);
        IF cardinality(v_problems) > 0 THEN
            RAISE EXCEPTION '%', array_to_string(v_problems, ' ') USING ERRCODE = '22023';
        END IF;
        UPDATE public.marketing_campaigns SET state = 'live', published_at = now(), updated_at = now(), revision = revision + 1 WHERE id = c.id;
        PERFORM public.fn_mkt_log(c.id, c.business_id, 'published',
            CASE WHEN c.starts_at > now() THEN 'Scheduled' ELSE 'Showing now' END);
    ELSIF p_action = 'unpublish' THEN
        IF c.state NOT IN ('live', 'paused') OR v_status = 'completed' THEN
            RAISE EXCEPTION 'Only a published campaign that has not finished can go back to draft' USING ERRCODE = '22023';
        END IF;
        UPDATE public.marketing_campaigns SET state = 'draft', updated_at = now(), revision = revision + 1 WHERE id = c.id;
        PERFORM public.fn_mkt_log(c.id, c.business_id, 'unpublished', p_note);
    ELSIF p_action = 'pause' THEN
        IF v_status NOT IN ('active', 'scheduled') THEN RAISE EXCEPTION 'Only a running or scheduled campaign can be paused' USING ERRCODE = '22023'; END IF;
        UPDATE public.marketing_campaigns SET state = 'paused', updated_at = now(), revision = revision + 1 WHERE id = c.id;
        PERFORM public.fn_mkt_log(c.id, c.business_id, 'paused', p_note);
    ELSIF p_action = 'resume' THEN
        IF v_status <> 'paused' THEN RAISE EXCEPTION 'Only a paused campaign can be resumed' USING ERRCODE = '22023'; END IF;
        v_problems := public.fn_mkt_campaign_problems(c.id);
        IF cardinality(v_problems) > 0 THEN
            RAISE EXCEPTION '%', array_to_string(v_problems, ' ') USING ERRCODE = '22023';
        END IF;
        UPDATE public.marketing_campaigns SET state = 'live', updated_at = now(), revision = revision + 1 WHERE id = c.id;
        PERFORM public.fn_mkt_log(c.id, c.business_id, 'resumed', p_note);
    ELSIF p_action = 'end' THEN
        IF v_status NOT IN ('active', 'scheduled', 'paused') THEN RAISE EXCEPTION 'This campaign is not running' USING ERRCODE = '22023'; END IF;
        UPDATE public.marketing_campaigns SET state = 'ended',
            ends_at = CASE WHEN ends_at IS NULL OR ends_at > now() THEN GREATEST(now(), starts_at + interval '1 second') ELSE ends_at END,
            ended_logged_at = now(), updated_at = now(), revision = revision + 1 WHERE id = c.id;
        PERFORM public.fn_mkt_log(c.id, c.business_id, 'ended', p_note);
    ELSIF p_action = 'archive' THEN
        IF v_status IN ('active', 'scheduled', 'paused') THEN RAISE EXCEPTION 'End the campaign before archiving it' USING ERRCODE = '22023'; END IF;
        UPDATE public.marketing_campaigns SET state = 'archived', updated_at = now(), revision = revision + 1 WHERE id = c.id;
        PERFORM public.fn_mkt_log(c.id, c.business_id, 'archived', p_note);
    ELSIF p_action = 'restore' THEN
        IF c.state <> 'archived' THEN RAISE EXCEPTION 'Only an archived campaign can be restored' USING ERRCODE = '22023'; END IF;
        UPDATE public.marketing_campaigns SET state = CASE WHEN published_at IS NULL THEN 'draft' ELSE 'ended' END,
            updated_at = now(), revision = revision + 1 WHERE id = c.id;
        PERFORM public.fn_mkt_log(c.id, c.business_id, 'restored', p_note);
    ELSE
        RAISE EXCEPTION 'Unknown action %', p_action USING ERRCODE = '22023';
    END IF;
    SELECT * INTO c FROM public.marketing_campaigns WHERE id = p_campaign_id;
    RETURN public.fn_mkt_status(c.state, c.starts_at, c.ends_at);
END;
$$;

-- Copy as a new draft (same creatives, schedule moved to start tomorrow at the same time of day
-- when the original has already started).
CREATE OR REPLACE FUNCTION public.marketing_campaign_duplicate(p_campaign_id uuid)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    c public.marketing_campaigns;
    v_id uuid;
    v_shift interval := interval '0';
BEGIN
    SELECT * INTO c FROM public.marketing_campaigns WHERE id = p_campaign_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Campaign not found' USING ERRCODE = 'P0002'; END IF;
    PERFORM public.assert_permission(c.business_id, 'marketing.manage');
    IF c.starts_at < now() THEN
        v_shift := (date_trunc('day', now()) + interval '1 day' + (c.starts_at - date_trunc('day', c.starts_at))) - c.starts_at;
    END IF;
    INSERT INTO public.marketing_campaigns (business_id, name, description, campaign_type, objective, state,
        starts_at, ends_at, priority, cta_label, cta_kind, cta_target, discount_label, promotion_id,
        target_product_ids, target_category, landing_slug, tone, created_by)
    VALUES (c.business_id, left('Copy of ' || c.name, 80), c.description, c.campaign_type, c.objective, 'draft',
        c.starts_at + v_shift, c.ends_at + v_shift, c.priority, c.cta_label, c.cta_kind, c.cta_target, c.discount_label,
        c.promotion_id, c.target_product_ids, c.target_category, NULL, c.tone, auth.uid())
    RETURNING id INTO v_id;
    INSERT INTO public.marketing_creatives (campaign_id, business_id, placement, format, media_id, mobile_media_id,
        poster_media_id, captions_media_id, headline, body, cta_label, alt_text, focal_x, focal_y, text_position,
        autoplay_muted, hidden, position)
    SELECT v_id, r.business_id, r.placement, r.format, r.media_id, r.mobile_media_id, r.poster_media_id,
        r.captions_media_id, r.headline, r.body, r.cta_label, r.alt_text, r.focal_x, r.focal_y, r.text_position,
        r.autoplay_muted, r.hidden, r.position
    FROM public.marketing_creatives r
    WHERE r.campaign_id = c.id AND NOT r.hidden
      -- Creatives whose media was removed from the library are left out of the copy.
      AND NOT EXISTS (SELECT 1 FROM public.website_media m
                      WHERE m.deleted_at IS NOT NULL AND m.id IN (r.media_id, r.mobile_media_id, r.poster_media_id, r.captions_media_id));
    PERFORM public.fn_mkt_log(v_id, c.business_id, 'duplicated', 'From ' || c.name);
    RETURN v_id;
END;
$$;

-- Add (no id) or change a creative of a campaign.
CREATE OR REPLACE FUNCTION public.marketing_creative_save(p_campaign_id uuid, p_creative jsonb)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    c public.marketing_campaigns;
    v_id uuid := NULLIF(p_creative->>'id', '')::uuid;
    v_placement text := p_creative->>'placement';
    v_format text := p_creative->>'format';
    v_pl jsonb := public.fn_mkt_placement(p_creative->>'placement');
    v_media uuid := NULLIF(p_creative->>'media_id', '')::uuid;
    v_mobile uuid := NULLIF(p_creative->>'mobile_media_id', '')::uuid;
    v_poster uuid := NULLIF(p_creative->>'poster_media_id', '')::uuid;
    v_captions uuid := NULLIF(p_creative->>'captions_media_id', '')::uuid;
    v_mobile_format text;
    v_count integer;
    k text;
BEGIN
    SELECT * INTO c FROM public.marketing_campaigns WHERE id = p_campaign_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Campaign not found' USING ERRCODE = 'P0002'; END IF;
    PERFORM public.assert_permission(c.business_id, 'marketing.manage');
    IF c.state = 'archived' THEN RAISE EXCEPTION 'Restore the campaign before changing it' USING ERRCODE = '22023'; END IF;
    FOR k IN SELECT jsonb_object_keys(p_creative) LOOP
        IF k NOT IN ('id', 'placement', 'format', 'media_id', 'mobile_media_id', 'poster_media_id', 'captions_media_id',
                     'headline', 'body', 'cta_label', 'alt_text', 'focal_x', 'focal_y', 'text_position', 'autoplay_muted',
                     'hidden', 'position', 'mobile_format') THEN
            RAISE EXCEPTION 'Unknown creative setting %', k USING ERRCODE = '22023';
        END IF;
    END LOOP;
    IF v_pl IS NULL THEN RAISE EXCEPTION 'Unknown placement %', v_placement USING ERRCODE = '22023'; END IF;
    IF NOT (v_pl->'formats' ? v_format) THEN
        RAISE EXCEPTION 'The % placement does not take the % format', v_placement, v_format USING ERRCODE = '22023';
    END IF;
    IF v_format = 'text' THEN
        IF COALESCE(btrim(p_creative->>'headline'), '') = '' THEN
            RAISE EXCEPTION 'A text-only creative needs its message' USING ERRCODE = '22023';
        END IF;
        v_media := NULL; v_mobile := NULL; v_poster := NULL; v_captions := NULL;
    ELSIF v_media IS NULL THEN
        RAISE EXCEPTION 'Choose the picture or video for this creative' USING ERRCODE = '22023';
    END IF;
    PERFORM public.fn_mkt_check_media(c.business_id, v_media, v_format, CASE WHEN v_format LIKE 'video%' THEN 'video' ELSE 'picture' END);
    IF v_mobile IS NOT NULL THEN
        v_mobile_format := COALESCE(NULLIF(p_creative->>'mobile_format', ''), (v_pl->'mobile'->>0));
        IF NOT (v_pl->'mobile' ? v_mobile_format) THEN
            RAISE EXCEPTION 'The % placement has no phone version in that format', v_placement USING ERRCODE = '22023';
        END IF;
        PERFORM public.fn_mkt_check_media(c.business_id, v_mobile, v_mobile_format, 'phone version');
    END IF;
    IF v_format LIKE 'video%' THEN
        IF v_poster IS NULL THEN
            RAISE EXCEPTION 'A video needs a cover picture, shown until it plays' USING ERRCODE = '22023';
        END IF;
        PERFORM public.fn_mkt_check_media(c.business_id, v_poster, v_format, 'poster picture');
        PERFORM public.fn_mkt_check_media(c.business_id, v_captions, v_format, 'captions file');
    ELSE
        v_poster := NULL; v_captions := NULL;
    END IF;
    IF COALESCE((p_creative->>'autoplay_muted')::boolean, false) AND v_format NOT LIKE 'video%' THEN
        RAISE EXCEPTION 'Only videos can play by themselves' USING ERRCODE = '22023';
    END IF;
    IF v_media IS NOT NULL AND COALESCE(btrim(p_creative->>'alt_text'), '') = ''
       AND NOT EXISTS (SELECT 1 FROM public.website_media WHERE id = v_media AND alt_text IS NOT NULL) THEN
        RAISE EXCEPTION 'Describe the picture for people who cannot see it (picture description)' USING ERRCODE = '22023';
    END IF;

    IF v_id IS NULL THEN
        SELECT count(*) INTO v_count FROM public.marketing_creatives WHERE campaign_id = c.id;
        IF v_count >= 20 THEN RAISE EXCEPTION 'A campaign can have up to 20 creatives' USING ERRCODE = '22023'; END IF;
        INSERT INTO public.marketing_creatives (campaign_id, business_id, placement, format, position)
        VALUES (c.id, c.business_id, v_placement, v_format, v_count)
        RETURNING id INTO v_id;
        PERFORM public.fn_mkt_log(c.id, c.business_id, 'creative_added', v_placement);
    ELSE
        IF NOT EXISTS (SELECT 1 FROM public.marketing_creatives WHERE id = v_id AND campaign_id = c.id) THEN
            RAISE EXCEPTION 'Creative not found' USING ERRCODE = 'P0002';
        END IF;
        PERFORM public.fn_mkt_log(c.id, c.business_id, 'creative_changed', v_placement);
    END IF;
    UPDATE public.marketing_creatives SET
        placement = v_placement, format = v_format,
        media_id = v_media, mobile_media_id = v_mobile, poster_media_id = v_poster, captions_media_id = v_captions,
        headline = NULLIF(btrim(p_creative->>'headline'), ''),
        body = NULLIF(btrim(p_creative->>'body'), ''),
        cta_label = NULLIF(btrim(p_creative->>'cta_label'), ''),
        alt_text = NULLIF(btrim(p_creative->>'alt_text'), ''),
        focal_x = NULLIF(p_creative->>'focal_x', '')::numeric,
        focal_y = NULLIF(p_creative->>'focal_y', '')::numeric,
        text_position = COALESCE(NULLIF(p_creative->>'text_position', ''), 'left'),
        autoplay_muted = COALESCE((p_creative->>'autoplay_muted')::boolean, false),
        hidden = COALESCE((p_creative->>'hidden')::boolean, false),
        position = COALESCE(NULLIF(p_creative->>'position', '')::integer, position),
        updated_at = now()
    WHERE id = v_id;
    UPDATE public.marketing_campaigns SET revision = revision + 1, updated_at = now() WHERE id = c.id;
    RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.marketing_creative_remove(p_creative_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    r public.marketing_creatives;
    c public.marketing_campaigns;
BEGIN
    SELECT * INTO r FROM public.marketing_creatives WHERE id = p_creative_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Creative not found' USING ERRCODE = 'P0002'; END IF;
    SELECT * INTO c FROM public.marketing_campaigns WHERE id = r.campaign_id FOR UPDATE;
    PERFORM public.assert_permission(c.business_id, 'marketing.manage');
    IF c.state = 'archived' THEN RAISE EXCEPTION 'Restore the campaign before changing it' USING ERRCODE = '22023'; END IF;
    -- A creative with statistics is hidden, not deleted, so the figures stay true.
    IF EXISTS (SELECT 1 FROM public.marketing_ad_daily WHERE creative_id = r.id)
       OR EXISTS (SELECT 1 FROM public.marketing_conversions WHERE creative_id = r.id) THEN
        UPDATE public.marketing_creatives SET hidden = true, updated_at = now() WHERE id = r.id;
    ELSE
        DELETE FROM public.marketing_creatives WHERE id = r.id;
    END IF;
    IF c.state IN ('live', 'paused') AND NOT EXISTS (SELECT 1 FROM public.marketing_creatives WHERE campaign_id = c.id AND NOT hidden) THEN
        RAISE EXCEPTION 'A published campaign needs at least one creative. Pause or end it instead.' USING ERRCODE = '22023';
    END IF;
    UPDATE public.marketing_campaigns SET revision = revision + 1, updated_at = now() WHERE id = c.id;
    PERFORM public.fn_mkt_log(c.id, c.business_id, 'creative_removed', r.placement);
END;
$$;

CREATE OR REPLACE FUNCTION public.marketing_placement_save(p_business_id uuid, p_placement text, p_settings jsonb)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    d jsonb := public.fn_mkt_placement(p_placement);
BEGIN
    PERFORM public.assert_permission(p_business_id, 'marketing.manage');
    IF d IS NULL THEN RAISE EXCEPTION 'Unknown placement %', p_placement USING ERRCODE = '22023'; END IF;
    -- One pop-up at a time, always.
    IF p_placement = 'popup' AND COALESCE((p_settings->>'max_items')::integer, 1) <> 1 THEN
        RAISE EXCEPTION 'Only one pop-up is ever shown at a time' USING ERRCODE = '22023';
    END IF;
    INSERT INTO public.marketing_placements AS p (business_id, placement, enabled, max_items, rotation, interval_s,
        popup_delay_s, popup_every_h, updated_by, updated_at)
    VALUES (p_business_id, p_placement,
        COALESCE((p_settings->>'enabled')::boolean, true),
        COALESCE((p_settings->>'max_items')::integer, (d->>'max_items')::integer),
        COALESCE(p_settings->>'rotation', d->>'rotation'),
        COALESCE((p_settings->>'interval_s')::integer, 7),
        COALESCE((p_settings->>'popup_delay_s')::integer, 8),
        COALESCE((p_settings->>'popup_every_h')::integer, 24),
        auth.uid(), now())
    ON CONFLICT (business_id, placement) DO UPDATE SET
        enabled = EXCLUDED.enabled, max_items = EXCLUDED.max_items, rotation = EXCLUDED.rotation,
        interval_s = EXCLUDED.interval_s, popup_delay_s = EXCLUDED.popup_delay_s, popup_every_h = EXCLUDED.popup_every_h,
        updated_by = EXCLUDED.updated_by, updated_at = now();
END;
$$;

-- The placements of a shop, defaults filled in.
CREATE OR REPLACE FUNCTION public.fn_mkt_placements(p_business_id uuid)
RETURNS jsonb
LANGUAGE sql STABLE
SET search_path = ''
AS $$
    SELECT jsonb_object_agg(k, jsonb_build_object(
        'enabled', COALESCE(p.enabled, true),
        'maxItems', COALESCE(p.max_items, (public.fn_mkt_placement(k)->>'max_items')::integer),
        'rotation', COALESCE(p.rotation, public.fn_mkt_placement(k)->>'rotation'),
        'intervalS', COALESCE(p.interval_s, 7),
        'popupDelayS', COALESCE(p.popup_delay_s, 8),
        'popupEveryH', COALESCE(p.popup_every_h, 24)))
    FROM unnest(ARRAY['hero', 'announcement', 'card', 'product', 'video', 'popup', 'category', 'landing']) k
    LEFT JOIN public.marketing_placements p ON p.business_id = p_business_id AND p.placement = k;
$$;

-- ============================================================================================
-- 6. Reports for the Marketing screens (real figures only)
-- ============================================================================================
CREATE OR REPLACE FUNCTION public.marketing_overview(p_business_id uuid, p_days integer DEFAULT 30)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_from date := (now() AT TIME ZONE COALESCE((SELECT timezone FROM public.businesses WHERE id = p_business_id), 'Africa/Nairobi'))::date
                   - (LEAST(GREATEST(p_days, 1), 366) - 1);
BEGIN
    PERFORM public.assert_permission(p_business_id, 'marketing.view', 'marketing.manage');
    RETURN jsonb_build_object(
        'timezone', (SELECT timezone FROM public.businesses WHERE id = p_business_id),
        'counts', (SELECT COALESCE(jsonb_object_agg(s, n), '{}') FROM (
            SELECT public.fn_mkt_status(state, starts_at, ends_at) s, count(*) n
            FROM public.marketing_campaigns WHERE business_id = p_business_id GROUP BY 1) x),
        'totals', (SELECT jsonb_build_object('loads', COALESCE(sum(loads), 0), 'views', COALESCE(sum(views), 0),
                    'clicks', COALESCE(sum(clicks), 0), 'conversions', COALESCE(sum(conversions), 0))
                   FROM public.marketing_ad_daily WHERE business_id = p_business_id AND day >= v_from),
        'orderValue', (SELECT COALESCE(sum(o.total), 0) FROM public.marketing_conversions mc
                       JOIN public.online_orders o ON o.id = mc.order_id
                       WHERE mc.business_id = p_business_id AND mc.at >= v_from
                         AND o.status NOT IN ('cancelled', 'pending_payment', 'payment_failed')),
        'byDay', (SELECT COALESCE(jsonb_agg(jsonb_build_object('day', day, 'views', v, 'clicks', cl) ORDER BY day), '[]')
                  FROM (SELECT day, sum(views) v, sum(clicks) cl FROM public.marketing_ad_daily
                        WHERE business_id = p_business_id AND day >= v_from GROUP BY day) d),
        'from', v_from);
END;
$$;

CREATE OR REPLACE FUNCTION public.marketing_campaign_report(p_campaign_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    c public.marketing_campaigns;
BEGIN
    SELECT * INTO c FROM public.marketing_campaigns WHERE id = p_campaign_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Campaign not found' USING ERRCODE = 'P0002'; END IF;
    PERFORM public.assert_permission(c.business_id, 'marketing.view', 'marketing.manage');
    RETURN jsonb_build_object(
        'byCreative', (SELECT COALESCE(jsonb_agg(jsonb_build_object('creativeId', r.id, 'placement', r.placement,
                        'format', r.format, 'headline', r.headline, 'hidden', r.hidden,
                        'loads', COALESCE(s.loads, 0), 'views', COALESCE(s.views, 0), 'clicks', COALESCE(s.clicks, 0),
                        'conversions', COALESCE(s.conv, 0)) ORDER BY r.position), '[]')
                       FROM public.marketing_creatives r
                       LEFT JOIN (SELECT creative_id, sum(loads) loads, sum(views) views, sum(clicks) clicks, sum(conversions) conv
                                  FROM public.marketing_ad_daily WHERE campaign_id = c.id GROUP BY creative_id) s ON s.creative_id = r.id
                       WHERE r.campaign_id = c.id),
        'byDay', (SELECT COALESCE(jsonb_agg(jsonb_build_object('day', day, 'loads', l, 'views', v, 'clicks', cl, 'conversions', cv) ORDER BY day), '[]')
                  FROM (SELECT day, sum(loads) l, sum(views) v, sum(clicks) cl, sum(conversions) cv
                        FROM public.marketing_ad_daily WHERE campaign_id = c.id GROUP BY day) d),
        'orders', (SELECT jsonb_build_object('count', count(*), 'value', COALESCE(sum(o.total), 0))
                   FROM public.marketing_conversions mc JOIN public.online_orders o ON o.id = mc.order_id
                   WHERE mc.campaign_id = c.id AND o.status NOT IN ('cancelled', 'pending_payment', 'payment_failed')),
        'problems', to_jsonb(public.fn_mkt_campaign_problems(c.id)));
END;
$$;

-- ============================================================================================
-- 7. The public website
-- ============================================================================================
-- One campaign as the website receives it (no draft fields, only visible creatives).
CREATE OR REPLACE FUNCTION public.fn_mkt_public_campaign(p_campaign_id uuid)
RETURNS jsonb
LANGUAGE sql STABLE
SET search_path = ''
AS $$
    SELECT jsonb_build_object(
                'id', c.id, 'name', c.name, 'type', c.campaign_type, 'priority', c.priority,
                'startsAt', c.starts_at, 'endsAt', c.ends_at, 'tone', c.tone,
                'ctaLabel', c.cta_label, 'ctaKind', c.cta_kind, 'ctaTarget', c.cta_target,
                'discount', c.discount_label,
                'promoCode', (SELECT pc.code FROM public.website_promo_codes pc WHERE pc.id = c.promotion_id AND pc.active),
                'products', to_jsonb(c.target_product_ids), 'category', c.target_category,
                'landing', c.landing_slug, 'description', c.description,
                'creatives', (
                    SELECT COALESCE(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
                        'id', r.id, 'placement', r.placement, 'format', r.format,
                        'headline', r.headline, 'body', r.body, 'ctaLabel', r.cta_label,
                        'alt', COALESCE(r.alt_text, m.alt_text), 'textPosition', r.text_position,
                        'autoplay', r.autoplay_muted,
                        'media', CASE WHEN m.id IS NOT NULL THEN jsonb_build_object('url', m.url, 'kind', m.kind, 'w', m.width, 'h', m.height,
                            'fx', COALESCE(r.focal_x, m.focal_x), 'fy', COALESCE(r.focal_y, m.focal_y), 'type', m.mime_type) END,
                        'mobile', CASE WHEN mm.id IS NOT NULL THEN jsonb_build_object('url', mm.url, 'kind', mm.kind, 'w', mm.width, 'h', mm.height,
                            'fx', mm.focal_x, 'fy', mm.focal_y, 'type', mm.mime_type) END,
                        'poster', CASE WHEN pm.id IS NOT NULL THEN jsonb_build_object('url', pm.url, 'w', pm.width, 'h', pm.height) END,
                        'captions', cm.url)) ORDER BY r.position), '[]')
                    FROM public.marketing_creatives r
                    LEFT JOIN public.website_media m ON m.id = r.media_id
                    LEFT JOIN public.website_media mm ON mm.id = r.mobile_media_id
                    LEFT JOIN public.website_media pm ON pm.id = r.poster_media_id
                    LEFT JOIN public.website_media cm ON cm.id = r.captions_media_id
                    WHERE r.campaign_id = c.id AND NOT r.hidden
                      AND (r.media_id IS NULL OR m.id IS NOT NULL)))
    FROM public.marketing_campaigns c WHERE c.id = p_campaign_id;
$$;

-- What a shop's website shows right now: active campaigns with their creatives, the placement
-- settings, and when the answer next changes (so caches never outlive a start or an end).
CREATE OR REPLACE FUNCTION public.get_public_campaigns(p_slug text)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_id uuid;
    v_now timestamptz := now();
    v_next timestamptz;
BEGIN
    SELECT b.id INTO v_id FROM public.businesses b
    WHERE b.website_slug = lower(trim(p_slug)) AND b.deleted_at IS NULL;
    IF NOT FOUND OR NOT (public.fn_website_shop(v_id)->>'open')::boolean THEN
        RETURN NULL;
    END IF;
    SELECT min(t) INTO v_next FROM (
        SELECT starts_at t FROM public.marketing_campaigns WHERE business_id = v_id AND state = 'live' AND starts_at > v_now
        UNION ALL
        SELECT ends_at FROM public.marketing_campaigns WHERE business_id = v_id AND state IN ('live', 'paused') AND ends_at > v_now) x;
    RETURN jsonb_build_object(
        'now', v_now,
        'refreshAt', v_next,
        'placements', public.fn_mkt_placements(v_id),
        'campaigns', COALESCE((
            SELECT jsonb_agg(public.fn_mkt_public_campaign(c.id) ORDER BY c.priority DESC, c.starts_at DESC)
            FROM public.marketing_campaigns c
            WHERE c.business_id = v_id AND public.fn_mkt_status(c.state, c.starts_at, c.ends_at, v_now) = 'active'), '[]'));
END;
$$;

-- The website reports what visitors saw: [{c: creative id, k: load|view|click}], max 40 per call.
-- Each (visit, creative, kind, day) counts once. Creatives not showing on this shop now are ignored.
CREATE OR REPLACE FUNCTION public.track_ad_events(p_slug text, p_visit text, p_events jsonb)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_id uuid;
    v_tz text;
    v_day date;
    e jsonb;
    r record;
    v_new integer;
    v_counted integer := 0;
BEGIN
    IF p_visit IS NULL OR p_visit !~ '^[A-Za-z0-9_-]{16,64}$' OR jsonb_typeof(p_events) <> 'array'
       OR jsonb_array_length(p_events) > 40 THEN
        RETURN 0;
    END IF;
    SELECT b.id, b.timezone INTO v_id, v_tz FROM public.businesses b
    WHERE b.website_slug = lower(trim(p_slug)) AND b.deleted_at IS NULL;
    IF NOT FOUND THEN RETURN 0; END IF;
    IF NOT public.check_rate_limit('adtrack:' || public.request_ip(), 600, 600) THEN
        RETURN 0;
    END IF;
    v_day := (now() AT TIME ZONE COALESCE(v_tz, 'Africa/Nairobi'))::date;
    FOR e IN SELECT * FROM jsonb_array_elements(p_events) LOOP
        CONTINUE WHEN jsonb_typeof(e) <> 'object' OR COALESCE(e->>'k', '') NOT IN ('load', 'view', 'click')
            OR COALESCE(e->>'c', '') !~ '^[0-9a-f-]{36}$';
        SELECT r2.id, r2.campaign_id INTO r FROM public.marketing_creatives r2
        JOIN public.marketing_campaigns c ON c.id = r2.campaign_id
        WHERE r2.id = (e->>'c')::uuid AND r2.business_id = v_id AND NOT r2.hidden
          AND public.fn_mkt_status(c.state, c.starts_at, c.ends_at) = 'active';
        CONTINUE WHEN NOT FOUND;
        INSERT INTO public.marketing_ad_seen (visit, creative_id, kind, day)
        VALUES (p_visit, r.id, e->>'k', v_day) ON CONFLICT DO NOTHING;
        GET DIAGNOSTICS v_new = ROW_COUNT;
        CONTINUE WHEN v_new = 0;
        INSERT INTO public.marketing_ad_daily AS d (creative_id, day, business_id, campaign_id, loads, views, clicks)
        VALUES (r.id, v_day, v_id, r.campaign_id,
            (e->>'k' = 'load')::int, (e->>'k' = 'view')::int, (e->>'k' = 'click')::int)
        ON CONFLICT (creative_id, day) DO UPDATE SET
            loads = d.loads + EXCLUDED.loads, views = d.views + EXCLUDED.views, clicks = d.clicks + EXCLUDED.clicks;
        v_counted := v_counted + 1;
    END LOOP;
    RETURN v_counted;
END;
$$;

-- After placing an order, the website says which visit it came from. The order must be the
-- signed-in customer's own, at this shop, under an hour old, and that visit must have clicked an
-- advert of this shop in the last 24 hours. One advert per order.
CREATE OR REPLACE FUNCTION public.track_ad_conversion(p_slug text, p_visit text, p_order_id uuid)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_id uuid;
    v_tz text;
    o public.online_orders;
    s record;
BEGIN
    IF auth.uid() IS NULL OR p_visit IS NULL OR p_visit !~ '^[A-Za-z0-9_-]{16,64}$' THEN
        RETURN false;
    END IF;
    SELECT b.id, b.timezone INTO v_id, v_tz FROM public.businesses b
    WHERE b.website_slug = lower(trim(p_slug)) AND b.deleted_at IS NULL;
    IF NOT FOUND THEN RETURN false; END IF;
    SELECT * INTO o FROM public.online_orders
    WHERE id = p_order_id AND business_id = v_id AND account_id = auth.uid() AND created_at > now() - interval '1 hour';
    IF NOT FOUND THEN RETURN false; END IF;
    SELECT x.creative_id, r.campaign_id INTO s FROM public.marketing_ad_seen x
    JOIN public.marketing_creatives r ON r.id = x.creative_id AND r.business_id = v_id
    WHERE x.visit = p_visit AND x.kind = 'click' AND x.at > now() - interval '24 hours' AND x.at <= o.created_at
    ORDER BY x.at DESC LIMIT 1;
    IF NOT FOUND THEN RETURN false; END IF;
    INSERT INTO public.marketing_conversions (order_id, business_id, campaign_id, creative_id)
    VALUES (o.id, v_id, s.campaign_id, s.creative_id) ON CONFLICT DO NOTHING;
    IF NOT FOUND THEN RETURN false; END IF;
    INSERT INTO public.marketing_ad_daily AS d (creative_id, day, business_id, campaign_id, conversions)
    VALUES (s.creative_id, (now() AT TIME ZONE COALESCE(v_tz, 'Africa/Nairobi'))::date, v_id, s.campaign_id, 1)
    ON CONFLICT (creative_id, day) DO UPDATE SET conversions = d.conversions + 1;
    RETURN true;
END;
$$;

-- Preview on the real website: a link valid two hours that shows one campaign as if it were
-- running (draft, scheduled or paused alike), on top of what is live. The secret is kept only as a
-- SHA-256 hash, names the shop and the campaign, and the website counts nothing while previewing.
CREATE TABLE IF NOT EXISTS public.marketing_preview_links (
    secret_hash bytea PRIMARY KEY,
    business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    campaign_id uuid NOT NULL REFERENCES public.marketing_campaigns(id) ON DELETE CASCADE,
    created_by uuid,
    expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_marketing_preview_links_business ON public.marketing_preview_links (business_id);

CREATE OR REPLACE FUNCTION public.marketing_preview_link(p_campaign_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    c public.marketing_campaigns;
    v_secret text := encode(extensions.gen_random_bytes(24), 'hex');
    v_expires timestamptz := now() + interval '2 hours';
BEGIN
    SELECT * INTO c FROM public.marketing_campaigns WHERE id = p_campaign_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Campaign not found' USING ERRCODE = 'P0002'; END IF;
    PERFORM public.assert_permission(c.business_id, 'marketing.view', 'marketing.manage');
    IF (SELECT website_slug FROM public.businesses WHERE id = c.business_id) IS NULL THEN
        RAISE EXCEPTION 'Give the shop a web address first (Website > Address & publishing)' USING ERRCODE = '22023';
    END IF;
    DELETE FROM public.marketing_preview_links WHERE business_id = c.business_id AND expires_at < now();
    DELETE FROM public.marketing_preview_links WHERE secret_hash IN (
        SELECT secret_hash FROM public.marketing_preview_links WHERE business_id = c.business_id
        ORDER BY expires_at DESC OFFSET 19);
    INSERT INTO public.marketing_preview_links (secret_hash, business_id, campaign_id, created_by, expires_at)
    VALUES (extensions.digest(v_secret, 'sha256'), c.business_id, c.id, auth.uid(), v_expires);
    RETURN jsonb_build_object('secret', v_secret, 'expiresAt', v_expires,
        'slug', (SELECT website_slug FROM public.businesses WHERE id = c.business_id),
        'host', public.fn_website_home_host(c.business_id),
        'landing', c.landing_slug);
END;
$$;

-- The adverts for a preview link: the live ones plus the previewed campaign as if showing now.
CREATE OR REPLACE FUNCTION public.get_preview_campaigns(p_slug text, p_secret text)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    l public.marketing_preview_links;
    v_live jsonb;
    v_one jsonb;
    c public.marketing_campaigns;
BEGIN
    IF p_secret IS NULL OR p_secret !~ '^[0-9a-f]{48}$' THEN RETURN NULL; END IF;
    SELECT pl.* INTO l FROM public.marketing_preview_links pl
    JOIN public.businesses b ON b.id = pl.business_id
    WHERE pl.secret_hash = extensions.digest(p_secret, 'sha256') AND pl.expires_at > now()
      AND b.deleted_at IS NULL AND b.website_slug = lower(trim(p_slug));
    IF NOT FOUND THEN RETURN NULL; END IF;
    SELECT * INTO c FROM public.marketing_campaigns WHERE id = l.campaign_id AND state <> 'archived';
    IF NOT FOUND THEN RETURN NULL; END IF;
    -- Build the live answer, then put the previewed campaign in with times that make it show.
    v_live := COALESCE(public.get_public_campaigns(p_slug),
        jsonb_build_object('now', now(), 'refreshAt', NULL, 'placements', public.fn_mkt_placements(l.business_id), 'campaigns', '[]'::jsonb));
    v_one := public.fn_mkt_public_campaign(c.id);
    RETURN v_live || jsonb_build_object(
        'refreshAt', NULL,
        'preview', c.id,
        'campaigns', (SELECT COALESCE(jsonb_agg(x), '[]') FROM jsonb_array_elements(v_live->'campaigns') x WHERE x->>'id' <> c.id::text)
                     || jsonb_build_array(v_one || jsonb_build_object('startsAt', now() - interval '1 minute', 'endsAt', NULL, 'priority', 101)));
END;
$$;

-- ============================================================================================
-- 8. Job: history entries for starts and ends; old de-duplication keys removed
-- ============================================================================================
CREATE OR REPLACE FUNCTION public.run_marketing_jobs()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_started integer;
    v_finished integer;
    v_purged integer;
BEGIN
    WITH s AS (
        UPDATE public.marketing_campaigns SET started_logged_at = now()
        WHERE state = 'live' AND started_logged_at IS NULL AND starts_at <= now() AND (ends_at IS NULL OR ends_at > now())
        RETURNING id, business_id)
    INSERT INTO public.marketing_campaign_events (campaign_id, business_id, event, note)
    SELECT id, business_id, 'started', 'Started showing on the website' FROM s;
    GET DIAGNOSTICS v_started = ROW_COUNT;
    WITH f AS (
        UPDATE public.marketing_campaigns SET ended_logged_at = now()
        WHERE state IN ('live', 'paused') AND ended_logged_at IS NULL AND ends_at <= now()
        RETURNING id, business_id)
    INSERT INTO public.marketing_campaign_events (campaign_id, business_id, event, note)
    SELECT id, business_id, 'finished', 'Reached its end date and stopped showing' FROM f;
    GET DIAGNOSTICS v_finished = ROW_COUNT;
    DELETE FROM public.marketing_ad_seen WHERE at < now() - interval '3 days';
    GET DIAGNOSTICS v_purged = ROW_COUNT;
    DELETE FROM public.canva_oauth_states WHERE created_at < now() - interval '1 hour';
    RETURN jsonb_build_object('started', v_started, 'finished', v_finished, 'purged', v_purged);
END;
$$;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
        PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'marketing-jobs';
        PERFORM cron.schedule('marketing-jobs', '*/5 * * * *', $job$SELECT public.run_marketing_jobs()$job$);
    END IF;
END;
$$;

-- ============================================================================================
-- 9. Permissions, plan module, row security, grants
-- ============================================================================================
INSERT INTO public.module_permissions (pattern, module) VALUES ('marketing.%', 'online_store')
ON CONFLICT (pattern) DO UPDATE SET module = EXCLUDED.module;

-- Manager: as 20261126002, plus marketing.view and marketing.manage.
INSERT INTO public.role_default_permissions (role, permissions) VALUES
    ('Manager', ARRAY['accounting.view', 'ai.insights', 'ai.use', 'assets.view', 'bom.create', 'bom.update', 'bom.view', 'business.switch', 'business.view', 'communication.send', 'communication.view', 'complaints.reply', 'complaints.view', 'customers.create', 'customers.debts', 'customers.loyalty', 'customers.manage', 'customers.schedules', 'customers.update', 'customers.view', 'dashboard.view', 'deliveries.assign', 'deliveries.cancel', 'deliveries.complete', 'deliveries.create', 'deliveries.view', 'expenses.create', 'expenses.update', 'expenses.view', 'files.view', 'finance.view', 'home.view', 'inventory.adjust_stock', 'inventory.expiry', 'inventory.receive_stock', 'inventory.request_transfer', 'inventory.stock_count', 'inventory.stock_history', 'inventory.transfer_stock', 'inventory.view', 'inventory.wastage', 'invoices.manage', 'invoices.view', 'loyalty.adjust', 'marketing.manage', 'marketing.view', 'notifications.send', 'notifications.view', 'online_store.view', 'orders.assign_rider', 'orders.complete', 'orders.create', 'orders.update', 'orders.view', 'payments.card', 'payments.cash', 'payments.verify', 'payments.view', 'pettycash.record', 'pos.apply_promotion', 'pos.close_shift', 'pos.create_sale', 'pos.open_shift', 'pos.walkin_customer', 'production.approve', 'production.create', 'production.update', 'production.view', 'products.create', 'products.export', 'products.import', 'products.manage_categories', 'products.update', 'products.view', 'promotions.manage', 'promotions.view', 'referrals.manage', 'referrals.view', 'purchases.approve', 'purchases.create', 'purchases.export', 'purchases.print', 'purchases.request_quote', 'purchases.update', 'purchases.view', 'quotes.manage', 'quotes.view', 'refunds.create', 'reports.customers', 'reports.deliveries', 'reports.inventory', 'reports.profit', 'reports.sales', 'reports.view', 'sales_orders.manage', 'sales_orders.view', 'settings.tax', 'settings.theme', 'settings.update', 'settings.view', 'staff.schedule', 'staff.view', 'supplier_bills.manage', 'suppliers.create', 'suppliers.export', 'suppliers.import', 'suppliers.update', 'suppliers.view'])
ON CONFLICT (role) DO UPDATE SET permissions = EXCLUDED.permissions;

ALTER TABLE public.website_media ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marketing_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marketing_creatives ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marketing_placements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marketing_campaign_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marketing_ad_daily ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marketing_ad_seen ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marketing_conversions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.canva_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.canva_oauth_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marketing_preview_links ENABLE ROW LEVEL SECURITY;

-- A shop on a read-only plan changes nothing here either (20261204001 section 6). Visitor
-- statistics (marketing_ad_daily, marketing_conversions) and Canva sign-in states are housekeeping
-- and stay writable, like website_visit_daily.
DO $$
DECLARE
    t text;
BEGIN
    FOREACH t IN ARRAY ARRAY['website_media', 'marketing_campaigns', 'marketing_creatives', 'marketing_placements',
                             'marketing_campaign_events', 'marketing_preview_links'] LOOP
        EXECUTE format('DROP TRIGGER IF EXISTS trg_zz_plan_read_only ON public.%I', t);
        EXECUTE format('CREATE TRIGGER trg_zz_plan_read_only BEFORE INSERT OR UPDATE OR DELETE ON public.%I
                        FOR EACH ROW EXECUTE FUNCTION public.fn_block_when_read_only()', t);
    END LOOP;
END;
$$;

-- Read only for members; every change goes through the functions above.
DROP POLICY IF EXISTS pol_website_media_select ON public.website_media;
CREATE POLICY pol_website_media_select ON public.website_media FOR SELECT TO authenticated USING (
    deleted_at IS NULL AND public.has_permission(business_id, 'marketing.view', 'marketing.manage', 'business.update'));
DROP POLICY IF EXISTS pol_marketing_campaigns_select ON public.marketing_campaigns;
CREATE POLICY pol_marketing_campaigns_select ON public.marketing_campaigns FOR SELECT TO authenticated USING (
    public.has_permission(business_id, 'marketing.view', 'marketing.manage'));
DROP POLICY IF EXISTS pol_marketing_creatives_select ON public.marketing_creatives;
CREATE POLICY pol_marketing_creatives_select ON public.marketing_creatives FOR SELECT TO authenticated USING (
    public.has_permission(business_id, 'marketing.view', 'marketing.manage'));
DROP POLICY IF EXISTS pol_marketing_placements_select ON public.marketing_placements;
CREATE POLICY pol_marketing_placements_select ON public.marketing_placements FOR SELECT TO authenticated USING (
    public.has_permission(business_id, 'marketing.view', 'marketing.manage'));
DROP POLICY IF EXISTS pol_marketing_events_select ON public.marketing_campaign_events;
CREATE POLICY pol_marketing_events_select ON public.marketing_campaign_events FOR SELECT TO authenticated USING (
    public.has_permission(business_id, 'marketing.view', 'marketing.manage'));
DROP POLICY IF EXISTS pol_marketing_ad_daily_select ON public.marketing_ad_daily;
CREATE POLICY pol_marketing_ad_daily_select ON public.marketing_ad_daily FOR SELECT TO authenticated USING (
    public.has_permission(business_id, 'marketing.view', 'marketing.manage'));
-- marketing_ad_seen, marketing_conversions, canva_*: no policy, server only.

REVOKE ALL ON public.website_media, public.marketing_campaigns, public.marketing_creatives, public.marketing_placements,
    public.marketing_campaign_events, public.marketing_ad_daily, public.marketing_ad_seen, public.marketing_conversions,
    public.canva_connections, public.canva_oauth_states, public.marketing_preview_links FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.website_media, public.marketing_campaigns, public.marketing_creatives, public.marketing_placements,
    public.marketing_campaign_events, public.marketing_ad_daily TO authenticated;
GRANT ALL ON public.website_media, public.marketing_campaigns, public.marketing_creatives, public.marketing_placements,
    public.marketing_campaign_events, public.marketing_ad_daily, public.marketing_ad_seen, public.marketing_conversions,
    public.canva_connections, public.canva_oauth_states, public.marketing_preview_links TO service_role;

DO $$
DECLARE
    f text;
BEGIN
    -- Helpers: server only.
    FOREACH f IN ARRAY ARRAY['fn_valid_timezone(text)', 'fn_business_timezone_guard()', 'fn_mkt_format(text)',
        'fn_mkt_placement(text)', 'fn_mkt_valid_href(text)', 'fn_mkt_status(text, timestamptz, timestamptz, timestamptz)',
        'fn_mkt_local_time(uuid, text)', 'fn_mkt_log(uuid, uuid, text, text)', 'fn_mkt_campaign_problems(uuid)',
        'fn_mkt_check_media(uuid, uuid, text, text)', 'fn_mkt_placements(uuid)', 'fn_mkt_public_campaign(uuid)', 'run_marketing_jobs()'] LOOP
        EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon, authenticated', f);
        EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO service_role', f);
    END LOOP;
    -- Staff: signed in; each checks the permission itself.
    FOREACH f IN ARRAY ARRAY['business_set_timezone(uuid, text)', 'website_media_register(uuid, text, jsonb)',
        'website_media_update(uuid, jsonb)', 'website_media_remove(uuid)', 'marketing_campaign_save(uuid, jsonb, integer)',
        'marketing_campaign_action(uuid, text, text)', 'marketing_campaign_duplicate(uuid)',
        'marketing_creative_save(uuid, jsonb)', 'marketing_creative_remove(uuid)',
        'marketing_placement_save(uuid, text, jsonb)', 'marketing_overview(uuid, integer)',
        'marketing_campaign_report(uuid)', 'track_ad_conversion(text, text, uuid)', 'marketing_preview_link(uuid)'] LOOP
        EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon', f);
        EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated, service_role', f);
    END LOOP;
    -- Visitors.
    FOREACH f IN ARRAY ARRAY['get_public_campaigns(text)', 'get_preview_campaigns(text, text)', 'track_ad_events(text, text, jsonb)'] LOOP
        EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC', f);
        EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO anon, authenticated, service_role', f);
    END LOOP;
END;
$$;
