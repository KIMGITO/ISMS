-- Problem reports and crash alerts for the developer.
--
-- Owners and admins report a problem from About this app → Report a problem. The ops-alert
-- function saves it here and posts it to the developer's Telegram chat, so a report is
-- never lost when Telegram is down.
--
-- New crashes (and a crash reaching 10, 100 or 1000 occurrences) are also sent to ops-alert,
-- which sends them to Telegram. That uses the same Vault secrets as the scheduled backups,
-- project_url and service_role_key (see 20261105012); without them nothing is sent and
-- crash reports are still saved as before.
-- Needs 20261105003 (crash_reports) and the ops-alert function deployed first.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

CREATE TABLE IF NOT EXISTS public.problem_reports (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    reference    TEXT NOT NULL UNIQUE
                 DEFAULT 'PR-' || upper(substr(replace(gen_random_uuid()::TEXT, '-', ''), 1, 6)),
    business_id  UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    reported_by  UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    reporter     TEXT,
    severity     TEXT NOT NULL CHECK (severity IN ('blocking', 'broken', 'minor')),
    summary      TEXT NOT NULL CHECK (char_length(summary) BETWEEN 1 AND 200),
    details      TEXT CHECK (char_length(details) <= 4000),
    screen       TEXT,
    platform     TEXT,
    app_version  TEXT,
    app_commit   TEXT,
    status       TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'resolved')),
    alert_sent   BOOLEAN NOT NULL DEFAULT FALSE,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    resolved_at  TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_problem_reports_business ON public.problem_reports (business_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_problem_reports_open ON public.problem_reports (created_at DESC) WHERE status <> 'resolved';

-- Owners and admins see their own business's reports. Only ops-alert (service role) writes.
ALTER TABLE public.problem_reports ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS pol_problem_reports_select ON public.problem_reports;
CREATE POLICY pol_problem_reports_select ON public.problem_reports
    FOR SELECT USING (public.is_owner_or_admin(business_id));
REVOKE INSERT, UPDATE, DELETE ON public.problem_reports FROM anon, authenticated;

-- Sends a crash to ops-alert. pg_net queues the request, so report_crash never waits on it,
-- and any error here is swallowed: a crash report must never fail because alerting did.
CREATE OR REPLACE FUNCTION public.fn_alert_crash()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_url TEXT;
    v_key TEXT;
BEGIN
    IF TG_OP = 'UPDATE' AND NEW.occurrences NOT IN (10, 100, 1000) THEN
        RETURN NEW;
    END IF;
    BEGIN
        SELECT decrypted_secret INTO v_url FROM vault.decrypted_secrets WHERE name = 'project_url';
        SELECT decrypted_secret INTO v_key FROM vault.decrypted_secrets WHERE name = 'service_role_key';
        IF v_url IS NULL OR v_key IS NULL THEN
            RETURN NEW;
        END IF;
        PERFORM net.http_post(
            url := v_url || '/functions/v1/ops-alert',
            headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_key),
            body := jsonb_build_object('action', 'crash', 'crashId', NEW.id, 'occurrences', NEW.occurrences),
            timeout_milliseconds := 5000
        );
    EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'fn_alert_crash: %', SQLERRM;
    END;
    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_alert_crash() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_crash_reports_alert ON public.crash_reports;
CREATE TRIGGER trg_crash_reports_alert
    AFTER INSERT OR UPDATE OF occurrences ON public.crash_reports
    FOR EACH ROW EXECUTE FUNCTION public.fn_alert_crash();

NOTIFY pgrst, 'reload schema';

COMMIT;
