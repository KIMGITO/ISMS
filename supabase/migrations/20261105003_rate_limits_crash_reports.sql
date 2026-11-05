-- 20261105003_rate_limits_crash_reports.sql
-- Shared rate limiting for edge functions, and privacy-limited crash reports from the apps.

BEGIN;

-- ---------------------------------------------------------------------------
-- Rate limits: fixed-window counters, reachable only from edge functions.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.rate_limits (
    key          TEXT PRIMARY KEY,
    window_start TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    count        INTEGER NOT NULL DEFAULT 0
);

ALTER TABLE public.rate_limits ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.check_rate_limit(p_key TEXT, p_limit INTEGER, p_window_seconds INTEGER)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_count INTEGER;
BEGIN
    INSERT INTO public.rate_limits AS r (key, window_start, count)
    VALUES (p_key, NOW(), 1)
    ON CONFLICT (key) DO UPDATE SET
        count        = CASE WHEN r.window_start < NOW() - make_interval(secs => p_window_seconds) THEN 1 ELSE r.count + 1 END,
        window_start = CASE WHEN r.window_start < NOW() - make_interval(secs => p_window_seconds) THEN NOW() ELSE r.window_start END
    RETURNING count INTO v_count;

    RETURN v_count <= p_limit;
END;
$$;

REVOKE ALL ON FUNCTION public.check_rate_limit(TEXT, INTEGER, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_rate_limit(TEXT, INTEGER, INTEGER) TO service_role;

-- ---------------------------------------------------------------------------
-- Crash reports: identical crashes are counted, not stored again.
-- Owners and admins read their own business's reports.
-- Reports sent before login have no business and are visible only to service_role.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.crash_reports (
    id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id    UUID REFERENCES public.businesses(id) ON DELETE CASCADE,
    fingerprint    TEXT NOT NULL,
    message        TEXT NOT NULL,
    stack          TEXT,
    screen         TEXT,
    platform       TEXT,
    app_version    TEXT,
    occurrences    INTEGER NOT NULL DEFAULT 1,
    first_seen_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_crash_reports_fingerprint
    ON public.crash_reports (COALESCE(business_id, '00000000-0000-0000-0000-000000000000'::UUID), fingerprint);

ALTER TABLE public.crash_reports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pol_crash_reports_select ON public.crash_reports;
CREATE POLICY pol_crash_reports_select ON public.crash_reports
    FOR SELECT USING (public.is_owner_or_admin(business_id));

-- Open to anon because crashes also happen on the login screen. Sizes are capped here, and
-- the row count cannot grow past 2000 unattributed reports, so it can't be used to fill the database.
CREATE OR REPLACE FUNCTION public.report_crash(
    p_fingerprint TEXT,
    p_message     TEXT,
    p_stack       TEXT,
    p_screen      TEXT,
    p_platform    TEXT,
    p_app_version TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_business_id UUID := (public.get_user_business_ids())[1];
BEGIN
    IF v_business_id IS NULL AND (SELECT COUNT(*) FROM public.crash_reports WHERE business_id IS NULL) >= 2000 THEN
        RETURN;
    END IF;

    INSERT INTO public.crash_reports (business_id, fingerprint, message, stack, screen, platform, app_version)
    VALUES (v_business_id, LEFT(p_fingerprint, 64), LEFT(p_message, 500), LEFT(p_stack, 4000),
            LEFT(p_screen, 64), LEFT(p_platform, 32), LEFT(p_app_version, 32))
    ON CONFLICT (COALESCE(business_id, '00000000-0000-0000-0000-000000000000'::UUID), fingerprint)
    DO UPDATE SET occurrences = public.crash_reports.occurrences + 1, last_seen_at = NOW();
END;
$$;

REVOKE ALL ON FUNCTION public.report_crash(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.report_crash(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) TO anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- The backup config holds a Google service account private key.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS pol_gsheets_select ON public.google_sheets_backup;
CREATE POLICY pol_gsheets_select ON public.google_sheets_backup
    FOR SELECT USING (public.is_owner_or_admin(business_id));

NOTIFY pgrst, 'reload schema';

COMMIT;
