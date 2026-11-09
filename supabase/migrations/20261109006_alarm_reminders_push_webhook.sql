-- =============================================================================
-- 20261109006_alarm_reminders_push_webhook.sql
-- Shift reminders work like an alarm, and every new notification is pushed to phones.
-- =============================================================================
-- Why:
--  * A reminder is set for one time and should go off at that time. It went off 30 minutes
--    early, and the job only ran every 5 minutes.
--  * No push was ever sent for notifications the server creates (reminders, "not accepted").
--    Pushes relied on a webhook set up by hand in the Supabase dashboard, and the live
--    database has none. This adds it here, so it is part of the code and can't go missing.
--
-- Needs Vault secrets (the same ones the backup job uses):
--    project_url        e.g. https://<ref>.supabase.co
--    service_role_key   the legacy service_role JWT (what send-fcm compares against)
--  or fcm_webhook_secret  the value of the FCM_WEBHOOK_SECRET function secret (used first)
-- Until they exist, notifications are still saved; only the push is skipped, with a warning.
--
-- Do NOT also add a dashboard webhook for notifications, or every push arrives twice.
-- =============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

-- ---------------------------------------------------------------------------
-- PUSH: every new notification goes to send-fcm, which picks the devices.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_push_new_notification()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_url TEXT;
    v_key TEXT;
BEGIN
    SELECT decrypted_secret INTO v_url FROM vault.decrypted_secrets WHERE name = 'project_url';
    SELECT decrypted_secret INTO v_key FROM vault.decrypted_secrets WHERE name = 'fcm_webhook_secret';
    IF v_key IS NULL THEN
        SELECT decrypted_secret INTO v_key FROM vault.decrypted_secrets WHERE name = 'service_role_key';
    END IF;
    IF v_url IS NULL OR v_key IS NULL THEN
        RAISE WARNING 'fn_push_new_notification: Vault secrets project_url and service_role_key (or fcm_webhook_secret) are not set; no push sent.';
        RETURN NULL;
    END IF;

    PERFORM net.http_post(
        url := rtrim(v_url, '/') || '/functions/v1/send-fcm',
        headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'Authorization', 'Bearer ' || v_key
        ),
        body := jsonb_build_object(
            'type', 'INSERT',
            'schema', 'public',
            'table', 'notifications',
            'record', to_jsonb(NEW)
        ),
        timeout_milliseconds := 15000
    );
    RETURN NULL;
EXCEPTION WHEN OTHERS THEN
    -- A push problem must never stop the notification being saved.
    RAISE WARNING 'fn_push_new_notification: %', SQLERRM;
    RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_push_new_notification ON public.notifications;
CREATE TRIGGER trg_push_new_notification
    AFTER INSERT ON public.notifications
    FOR EACH ROW EXECUTE FUNCTION public.fn_push_new_notification();

REVOKE ALL ON FUNCTION public.fn_push_new_notification() FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- ALARMS: go off at the set time (Nairobi), on every day the reminder repeats.
-- A run missed by the scheduler is caught up to 10 minutes late; older ones are skipped,
-- so saving a time that has already passed today doesn't ring.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.flag_due_schedule_reminders()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_now   TIMESTAMP := (NOW() AT TIME ZONE 'Africa/Nairobi');
    v_today DATE := (NOW() AT TIME ZONE 'Africa/Nairobi')::DATE;
    v_grace INTERVAL := INTERVAL '10 minutes';
    v_schedule RECORD;
    v_user_id UUID;
    v_time TEXT;
BEGIN
    FOR v_schedule IN
        SELECT s.id, s.business_id, s.employee_id, s.title, s.start_time, s.notes, s.created_by
        FROM public.schedules s
        WHERE s.deleted_at IS NULL
          AND s.date <= v_today
          AND s.last_reminded_on IS DISTINCT FROM v_today
          AND CASE s.repeat
                  WHEN 'None'    THEN s.date = v_today
                  WHEN 'Daily'   THEN TRUE
                  WHEN 'Weekly'  THEN EXTRACT(DOW FROM s.date) = EXTRACT(DOW FROM v_today)
                  WHEN 'Monthly' THEN EXTRACT(DAY FROM s.date) = EXTRACT(DAY FROM v_today)
                  ELSE FALSE
              END
          AND v_today + date_trunc('minute', s.start_time) <= v_now
          AND v_today + date_trunc('minute', s.start_time) > v_now - v_grace
        FOR UPDATE SKIP LOCKED
    LOOP
        UPDATE public.schedules
        SET last_reminded_on = v_today, reminder_sent = TRUE
        WHERE id = v_schedule.id;

        SELECT e.user_id INTO v_user_id
        FROM public.employees e
        WHERE e.id = v_schedule.employee_id AND e.deleted_at IS NULL;

        -- Same format the app shows: 1:38 PM
        v_time := ltrim(to_char(v_schedule.start_time, 'HH12:MI AM'), '0');

        IF v_user_id IS NOT NULL THEN
            INSERT INTO public.notifications
                (business_id, user_id, title, message, type, priority,
                 action_type, action_target, payload, status)
            VALUES (
                v_schedule.business_id,
                v_user_id,
                COALESCE(NULLIF(v_schedule.title, ''), 'Reminder'),
                'Alarm for ' || v_time
                    || CASE WHEN NULLIF(trim(v_schedule.notes), '') IS NOT NULL
                            THEN '. ' || trim(v_schedule.notes) ELSE '' END,
                'Schedule Reminder',
                'high'::public.notification_priority,
                'navigate'::public.notification_action_type,
                'dashboard',
                jsonb_build_object(
                    'schedule_id', v_schedule.id,
                    'employee_id', v_schedule.employee_id,
                    'shift_date',  to_char(v_today, 'YYYY-MM-DD'),
                    'start_time',  to_char(v_schedule.start_time, 'HH24:MI')
                ),
                'pending'::public.notification_delivery_status
            );
        END IF;
    END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.flag_due_schedule_reminders() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.flag_due_schedule_reminders() TO service_role;

-- Moving the time again today should ring again at the new time.
CREATE OR REPLACE FUNCTION public.fn_schedule_reset_reminder()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.date IS DISTINCT FROM OLD.date
       OR NEW.start_time IS DISTINCT FROM OLD.start_time
       OR NEW.repeat IS DISTINCT FROM OLD.repeat
       OR NEW.employee_id IS DISTINCT FROM OLD.employee_id THEN
        NEW.last_reminded_on := NULL;
        NEW.reminder_sent := FALSE;
    END IF;
    RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- CRON: check every minute, so an alarm is at most a minute late.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
        RETURN;
    END IF;
    PERFORM cron.unschedule(j.jobname) FROM cron.job j WHERE j.jobname = 'process-schedule-reminders';
    PERFORM cron.schedule('process-schedule-reminders', '* * * * *', 'SELECT public.flag_due_schedule_reminders()');
END;
$$;

NOTIFY pgrst, 'reload schema';

COMMIT;
