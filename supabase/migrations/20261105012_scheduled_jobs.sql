-- =============================================================================
-- 20261105012_scheduled_jobs.sql
-- Why: The nightly backup setting did nothing because no job ran it, and earlier
-- cron blocks were skipped because no migration enabled pg_cron. This enables the
-- extensions, registers those jobs, and adds an hourly job that starts due backups.
-- Backups need two Vault secrets, project_url and service_role_key; until they
-- exist the job logs a warning and starts nothing.
-- Dependencies: 20260819002 (reminders), 20261105010 (customer portal job)
-- =============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

-- Times are Nairobi time. A nightly backup missed at its hour is picked up by a later run the
-- same day. A failed run also sets last_backup_at, so it waits for the next schedule.
CREATE OR REPLACE FUNCTION public.run_due_backups()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_url     TEXT;
    v_key     TEXT;
    v_now     TIMESTAMP := NOW() AT TIME ZONE 'Africa/Nairobi';
    v_started INTEGER := 0;
    v_config  RECORD;
BEGIN
    SELECT decrypted_secret INTO v_url FROM vault.decrypted_secrets WHERE name = 'project_url';
    SELECT decrypted_secret INTO v_key FROM vault.decrypted_secrets WHERE name = 'service_role_key';
    IF v_url IS NULL OR v_key IS NULL THEN
        RAISE WARNING 'run_due_backups: Vault secrets project_url and service_role_key are not set.';
        RETURN 0;
    END IF;

    FOR v_config IN
        SELECT business_id
        FROM public.google_sheets_backup
        WHERE enabled
          AND google_sheet_url IS NOT NULL
          AND google_service_account IS NOT NULL
          AND CASE schedule
                WHEN 'every_12h' THEN
                    -- 11 hours, so an hourly job can't slip a 12-hour cycle by an extra hour.
                    last_backup_at IS NULL OR last_backup_at < NOW() - INTERVAL '11 hours'
                ELSE
                    EXTRACT(HOUR FROM v_now) >= CASE schedule WHEN 'nightly_3am' THEN 3 ELSE 0 END
                    AND (last_backup_at IS NULL
                         OR (last_backup_at AT TIME ZONE 'Africa/Nairobi')::DATE < v_now::DATE)
              END
    LOOP
        PERFORM net.http_post(
            url := v_url || '/functions/v1/backup-config',
            headers := jsonb_build_object(
                'Content-Type', 'application/json',
                'Authorization', 'Bearer ' || v_key
            ),
            body := jsonb_build_object('action', 'run', 'businessId', v_config.business_id),
            timeout_milliseconds := 300000
        );
        v_started := v_started + 1;
    END LOOP;

    RETURN v_started;
END;
$$;

REVOKE ALL ON FUNCTION public.run_due_backups() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.run_due_backups() TO service_role;

DO $$
DECLARE
    v_job RECORD;
BEGIN
    FOR v_job IN
        SELECT * FROM (VALUES
            ('process-schedule-reminders', '*/15 * * * *', 'SELECT public.flag_due_schedule_reminders()'),
            -- 02:00 UTC is 05:00 in Nairobi.
            ('customer-portal-daily', '0 2 * * *', 'SELECT public.run_customer_portal_daily()'),
            ('run-due-backups', '5 * * * *', 'SELECT public.run_due_backups()')
        ) AS jobs(name, schedule, command)
    LOOP
        PERFORM cron.unschedule(j.jobname) FROM cron.job j WHERE j.jobname = v_job.name;
        PERFORM cron.schedule(v_job.name, v_job.schedule, v_job.command);
    END LOOP;
END;
$$;

COMMIT;
