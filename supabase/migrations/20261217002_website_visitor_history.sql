-- 20261217002_website_visitor_history
-- ===================================================================
-- Visit history with cookies (owner, 2026-11-28): "use cookies for statistics so we can store
-- people's visit history".
--
-- The website asks first (Kenya Data Protection Act: statistics cookies need consent). A visitor
-- who accepts gets two first-party cookies: a random visitor id (kept 13 months) and a visit id
-- (ends after 30 minutes without a page). Each page they open is kept here with those ids, so
-- the shop sees unique visitors, returning visitors and each visitor's history. No name, phone,
-- IP address or device is stored; a signed-in customer is linked only by their own account.
-- A visitor who says no is still counted in the anonymous daily totals (website_visit_daily),
-- exactly as before. Rows older than 13 months are removed every night.
--
-- Reverse: SELECT cron.unschedule('website-visit-history-cleanup');
--          DROP FUNCTION record_website_visit(text, text, text, boolean, uuid, uuid, text, boolean),
--                        website_visitor_stats(uuid, integer), run_website_visit_cleanup();
--          DROP TABLE website_visit_history;

CREATE TABLE IF NOT EXISTS public.website_visit_history (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    visitor_id uuid NOT NULL,
    session_id uuid NOT NULL,
    page text NOT NULL CHECK (page IN ('home', 'shop', 'product', 'search', 'cart', 'checkout', 'order', 'account', 'articles', 'contact', 'info', 'campaign', 'other')),
    path text CHECK (path IS NULL OR length(path) <= 200),
    source text NOT NULL CHECK (source IN ('direct', 'search', 'social', 'site', 'inside')),
    landing boolean NOT NULL DEFAULT false,
    customer_user uuid,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS website_visit_history_biz_time_idx ON public.website_visit_history (business_id, created_at DESC);
CREATE INDEX IF NOT EXISTS website_visit_history_visitor_idx ON public.website_visit_history (business_id, visitor_id, created_at DESC);
COMMENT ON TABLE public.website_visit_history IS
    'Pages opened by website visitors who accepted statistics cookies: random visitor and visit ids only, kept 13 months.';
ALTER TABLE public.website_visit_history ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS pol_website_visit_history_select ON public.website_visit_history;
CREATE POLICY pol_website_visit_history_select ON public.website_visit_history FOR SELECT TO authenticated
    USING ((SELECT public.has_permission(business_id, 'business.update')));
REVOKE ALL ON public.website_visit_history FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.website_visit_history TO authenticated;
GRANT ALL ON public.website_visit_history TO service_role;

-- The website records a page. Always adds to the anonymous daily totals; with consent (ids
-- given) also keeps the page in the visitor's history. Never raises for the visitor.
CREATE OR REPLACE FUNCTION public.record_website_visit(
    p_slug text, p_page text, p_source text, p_landing boolean,
    p_visitor uuid, p_session uuid, p_path text, p_consent boolean)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_id uuid;
BEGIN
    IF NOT public.record_website_view(p_slug, p_page, p_source, p_landing) THEN
        RETURN false;
    END IF;
    IF NOT COALESCE(p_consent, false) OR p_visitor IS NULL OR p_session IS NULL THEN
        RETURN true;
    END IF;
    SELECT b.id INTO v_id FROM public.businesses b
    WHERE b.website_slug = lower(trim(p_slug)) AND b.deleted_at IS NULL;
    INSERT INTO public.website_visit_history (business_id, visitor_id, session_id, page, path, source, landing, customer_user)
    VALUES (v_id, p_visitor, p_session, p_page,
            NULLIF(left(regexp_replace(COALESCE(p_path, ''), '[?#].*$', ''), 200), ''),
            CASE WHEN p_landing THEN p_source ELSE 'inside' END, COALESCE(p_landing, false), auth.uid());
    RETURN true;
EXCEPTION WHEN OTHERS THEN
    RETURN false;
END;
$$;
REVOKE ALL ON FUNCTION public.record_website_visit(text, text, text, boolean, uuid, uuid, text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_website_visit(text, text, text, boolean, uuid, uuid, text, boolean) TO anon, authenticated, service_role;

-- Statistics from the history: unique and returning visitors, and the latest visitors' trails.
CREATE OR REPLACE FUNCTION public.website_visitor_stats(p_business_id uuid, p_days integer DEFAULT 30)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_days integer := LEAST(GREATEST(COALESCE(p_days, 30), 1), 365);
    v_from timestamptz := now() - make_interval(days => v_days);
BEGIN
    IF NOT public.has_permission(p_business_id, 'business.update') THEN
        RAISE EXCEPTION 'You do not have permission to see website statistics.';
    END IF;
    RETURN (
        WITH h AS (
            SELECT * FROM public.website_visit_history
            WHERE business_id = p_business_id AND created_at >= v_from
        ), per_visitor AS (
            SELECT visitor_id,
                   count(DISTINCT session_id) AS visits,
                   count(*) AS pages,
                   min(created_at) AS first_seen,
                   max(created_at) AS last_seen,
                   bool_or(customer_user IS NOT NULL) AS signed_in,
                   (SELECT min(created_at) FROM public.website_visit_history o
                    WHERE o.business_id = p_business_id AND o.visitor_id = h.visitor_id) AS ever_first
            FROM h GROUP BY visitor_id
        )
        SELECT jsonb_build_object(
            'visitors', (SELECT count(*) FROM per_visitor),
            'returning', (SELECT count(*) FROM per_visitor WHERE visits > 1 OR ever_first < v_from),
            'cookieVisits', (SELECT count(DISTINCT session_id) FROM h),
            'cookiePages', (SELECT count(*) FROM h),
            'signedIn', (SELECT count(*) FROM per_visitor WHERE signed_in),
            'recent', COALESCE((
                SELECT jsonb_agg(r ORDER BY r->>'lastSeen' DESC)
                FROM (
                    SELECT jsonb_build_object(
                        'visitor', left(p.visitor_id::text, 8),
                        'visits', p.visits, 'pages', p.pages,
                        'firstSeen', p.ever_first, 'lastSeen', p.last_seen, 'signedIn', p.signed_in,
                        'trail', (SELECT jsonb_agg(jsonb_build_object('page', t.page, 'path', t.path, 'at', t.created_at) ORDER BY t.created_at DESC)
                                  FROM (SELECT page, path, created_at FROM h WHERE h.visitor_id = p.visitor_id
                                        ORDER BY created_at DESC LIMIT 8) t)) AS r
                    FROM per_visitor p ORDER BY p.last_seen DESC LIMIT 12) x), '[]'::jsonb)
        )
    );
END;
$$;
REVOKE ALL ON FUNCTION public.website_visitor_stats(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.website_visitor_stats(uuid, integer) TO authenticated, service_role;

-- Kept 13 months, the same as the visitor cookie.
CREATE OR REPLACE FUNCTION public.run_website_visit_cleanup() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_n integer;
BEGIN
    DELETE FROM public.website_visit_history WHERE created_at < now() - interval '13 months';
    GET DIAGNOSTICS v_n = ROW_COUNT;
    RETURN v_n;
END;
$$;
REVOKE ALL ON FUNCTION public.run_website_visit_cleanup() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.run_website_visit_cleanup() TO service_role;

DO $do$ BEGIN
    IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
        PERFORM cron.schedule('website-visit-history-cleanup', '40 3 * * *', $job$SELECT public.run_website_visit_cleanup()$job$);
    END IF;
END $do$;
