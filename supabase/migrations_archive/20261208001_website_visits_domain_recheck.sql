-- 20261208001_website_visits_domain_recheck.sql
-- Website engine, phase 7 (docs/roadmap/website-engine-audit.md).
--
--   * A private visit counter. The website tells the database "a page of this kind was opened,
--     the visitor came from this kind of place". Only daily totals per shop are kept: no IP, no
--     visitor id, no cookie, no full address, no device. The website stores nothing in the browser
--     for it. Rate-limited per IP address (the limiter keeps the address only for its 10-minute
--     window, as for every other public call), bots and previews are not counted.
--     A "visit" is a page opened from outside the website (or typed in); every other page opened
--     while browsing is a view. Unique visitors are not counted: that needs an identifier.
--   * Statistics read the totals (website_stats gains views, visits, where visits came from and
--     which pages are opened). Days are the shop's own days, the same for orders and visits.
--   * The counter can be pushed up on purpose by someone calling it directly, as any public
--     counter can; the per-IP limit bounds that, and the screen calls them counts, not facts
--     about people.
--   * Own web addresses are checked again every night. One that stopped working (DNS moved,
--     certificate lost) goes back to "waiting", so the shop's subdomain stops sending visitors
--     to a dead address; one that started working goes live without anybody pressing Check now.
--
-- Reverse: SELECT cron.unschedule('website-domain-recheck');
--          DROP FUNCTION record_website_view(text, text, text, boolean), website_domains_recheck();
--          DROP TABLE website_visit_daily;
--          restore website_stats from 20261206002.

-- ============================================================================================
-- 1. Daily totals
-- ============================================================================================
-- Page kinds: keep in step with VISIT_PAGES in website/src/engine/visits.ts; sources with
-- VISIT_SOURCES (src/test/websiteEngineTests.ts compares them).
CREATE TABLE IF NOT EXISTS public.website_visit_daily (
    business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    day date NOT NULL,
    page text NOT NULL CHECK (page IN ('home', 'shop', 'product', 'search', 'cart', 'checkout', 'order', 'account', 'articles', 'contact', 'info', 'campaign', 'other')),
    source text NOT NULL CHECK (source IN ('direct', 'search', 'social', 'site', 'inside')),
    views integer NOT NULL DEFAULT 0 CHECK (views >= 0),
    PRIMARY KEY (business_id, day, page, source)
);
COMMENT ON TABLE public.website_visit_daily IS
    'Pages opened on a shop''s website per day, by page kind and where the visitor came from (inside = browsing within the website). Totals only: nothing about the visitor.';
ALTER TABLE public.website_visit_daily ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS pol_website_visit_daily_select ON public.website_visit_daily;
CREATE POLICY pol_website_visit_daily_select ON public.website_visit_daily FOR SELECT TO authenticated
    USING ((SELECT public.has_permission(business_id, 'business.update')));
REVOKE ALL ON public.website_visit_daily FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.website_visit_daily TO authenticated;
GRANT ALL ON public.website_visit_daily TO service_role;

-- The shop's own day (businesses.timezone when the shop has one, else Nairobi).
CREATE OR REPLACE FUNCTION public.fn_shop_today(p_business_id uuid)
RETURNS date
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT (now() AT TIME ZONE COALESCE(
        (SELECT NULLIF(to_jsonb(b)->>'timezone', '') FROM public.businesses b WHERE b.id = p_business_id),
        'Africa/Nairobi'))::date;
$$;
REVOKE ALL ON FUNCTION public.fn_shop_today(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_shop_today(uuid) TO service_role;

-- ============================================================================================
-- 2. The website counts a page (anyone; the shop comes from its web name, as every public call)
-- ============================================================================================
-- Returns true when counted. Anything unexpected is ignored, never an error the visitor sees.
CREATE OR REPLACE FUNCTION public.record_website_view(p_slug text, p_page text, p_source text, p_landing boolean)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_id uuid;
    v_source text;
BEGIN
    IF p_page IS NULL OR p_page NOT IN ('home', 'shop', 'product', 'search', 'cart', 'checkout', 'order', 'account', 'articles', 'contact', 'info', 'campaign', 'other') THEN
        RETURN false;
    END IF;
    -- Browsing within the website is one source; where a visit came from only counts on landing.
    v_source := CASE WHEN p_landing THEN p_source ELSE 'inside' END;
    IF v_source IS NULL OR v_source NOT IN ('direct', 'search', 'social', 'site', 'inside') THEN
        RETURN false;
    END IF;
    SELECT b.id INTO v_id FROM public.businesses b
    WHERE b.website_slug = lower(trim(p_slug)) AND b.deleted_at IS NULL;
    IF NOT FOUND OR NOT (public.fn_website_shop(v_id)->>'open')::boolean THEN
        RETURN false;
    END IF;
    IF NOT public.check_rate_limit('webview:' || public.request_ip(), 300, 600) THEN
        RETURN false;
    END IF;
    INSERT INTO public.website_visit_daily AS d (business_id, day, page, source, views)
    VALUES (v_id, public.fn_shop_today(v_id), p_page, v_source, 1)
    ON CONFLICT (business_id, day, page, source) DO UPDATE SET views = d.views + 1;
    RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.record_website_view(text, text, text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_website_view(text, text, text, boolean) TO anon, authenticated, service_role;

-- ============================================================================================
-- 3. Statistics: orders (as before) plus pages opened and visits
-- ============================================================================================
CREATE OR REPLACE FUNCTION public.website_stats(p_business_id uuid, p_days integer DEFAULT 30)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_days integer := LEAST(GREATEST(COALESCE(p_days, 30), 1), 365);
    v_tz text;
    v_today date;
    v_first date;
    v_from timestamptz;
BEGIN
    IF NOT public.has_permission(p_business_id, 'business.update') THEN
        RAISE EXCEPTION 'You do not have permission to see website statistics.';
    END IF;
    SELECT COALESCE(NULLIF(to_jsonb(b)->>'timezone', ''), 'Africa/Nairobi') INTO v_tz
    FROM public.businesses b WHERE b.id = p_business_id;
    v_today := (now() AT TIME ZONE v_tz)::date;
    v_first := v_today - (v_days - 1);
    v_from := v_first::timestamp AT TIME ZONE v_tz;
    RETURN jsonb_build_object(
        'days', v_days,
        'orders', (SELECT count(*) FROM public.online_orders WHERE business_id = p_business_id AND created_at >= v_from),
        'paidOrders', (SELECT count(*) FROM public.online_orders WHERE business_id = p_business_id AND created_at >= v_from AND paid_at IS NOT NULL),
        'revenue', (SELECT COALESCE(sum(total), 0)::numeric(14,2) FROM public.online_orders WHERE business_id = p_business_id AND created_at >= v_from AND paid_at IS NOT NULL),
        'views', (SELECT COALESCE(sum(views), 0) FROM public.website_visit_daily WHERE business_id = p_business_id AND day >= v_first),
        'visits', (SELECT COALESCE(sum(views), 0) FROM public.website_visit_daily WHERE business_id = p_business_id AND day >= v_first AND source <> 'inside'),
        'byDay', COALESCE((
            SELECT jsonb_agg(jsonb_build_object('day', g.day, 'orders', COALESCE(o.orders, 0), 'revenue', COALESCE(o.revenue, 0), 'visits', COALESCE(v.visits, 0)) ORDER BY g.day)
            FROM generate_series(v_first, v_today, interval '1 day') g(day)
            LEFT JOIN (
                SELECT (o.created_at AT TIME ZONE v_tz)::date AS day,
                       count(*) AS orders,
                       COALESCE(sum(o.total) FILTER (WHERE o.paid_at IS NOT NULL), 0)::numeric(14,2) AS revenue
                FROM public.online_orders o
                WHERE o.business_id = p_business_id AND o.created_at >= v_from
                GROUP BY 1) o ON o.day = g.day::date
            LEFT JOIN (
                SELECT d.day, sum(d.views) AS visits
                FROM public.website_visit_daily d
                WHERE d.business_id = p_business_id AND d.day >= v_first AND d.source <> 'inside'
                GROUP BY d.day) v ON v.day = g.day::date), '[]'::jsonb),
        'sources', COALESCE((
            SELECT jsonb_agg(jsonb_build_object('source', s.source, 'visits', s.visits) ORDER BY s.visits DESC, s.source)
            FROM (SELECT source, sum(views) AS visits FROM public.website_visit_daily
                  WHERE business_id = p_business_id AND day >= v_first AND source <> 'inside'
                  GROUP BY source) s), '[]'::jsonb),
        'pages', COALESCE((
            SELECT jsonb_agg(jsonb_build_object('page', p.page, 'views', p.views) ORDER BY p.views DESC, p.page)
            FROM (SELECT page, sum(views) AS views FROM public.website_visit_daily
                  WHERE business_id = p_business_id AND day >= v_first
                  GROUP BY page) p), '[]'::jsonb),
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
        'visitsCounted', TRUE,
        'countingSince', (SELECT min(day) FROM public.website_visit_daily WHERE business_id = p_business_id));
END;
$$;
REVOKE ALL ON FUNCTION public.website_stats(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.website_stats(uuid, integer) TO authenticated, service_role;

-- ============================================================================================
-- 4. Own web addresses checked every night (website-domain, action recheck_all)
-- ============================================================================================
CREATE OR REPLACE FUNCTION public.website_domains_recheck()
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_url text;
    v_key text;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM public.website_domains WHERE cf_hostname_id IS NOT NULL) THEN
        RETURN;
    END IF;
    SELECT decrypted_secret INTO v_url FROM vault.decrypted_secrets WHERE name = 'project_url';
    SELECT decrypted_secret INTO v_key FROM vault.decrypted_secrets WHERE name = 'service_role_key';
    IF v_url IS NULL OR v_key IS NULL THEN
        RAISE WARNING 'website_domains_recheck: Vault secrets project_url and service_role_key are not set; addresses not checked.';
        RETURN;
    END IF;
    PERFORM net.http_post(
        url := rtrim(v_url, '/') || '/functions/v1/website-domain',
        headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_key),
        body := jsonb_build_object('action', 'recheck_all'),
        timeout_milliseconds := 60000);
END;
$$;
REVOKE ALL ON FUNCTION public.website_domains_recheck() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.website_domains_recheck() TO service_role;

DO $do$ BEGIN
    IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
        PERFORM cron.schedule('website-domain-recheck', '20 3 * * *', $job$SELECT public.website_domains_recheck()$job$);
    END IF;
END $do$;
