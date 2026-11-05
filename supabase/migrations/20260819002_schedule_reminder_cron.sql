-- =============================================================================
-- 20260819002_schedule_reminder_cron.sql
-- integrated Shop Management System
-- Schedule Reminder Cron
-- =============================================================================
-- Why: Registers a pg_cron job to invoke flag_due_schedule_reminders() every
-- 15 minutes so schedule reminders are actually processed.
-- NOTE: FCM dispatch relies on a Supabase Dashboard webhook, configured by hand:
-- INSERT on public.notifications -> send-fcm edge function. Hardcoded pg_net URLs
-- are avoided here because they break across local/staging/prod environments.
-- Dependencies: 012 (flag_due_schedule_reminders)
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- CRON: process-schedule-reminders
-- Invokes flag_due_schedule_reminders() every 15 minutes. If pg_cron is not
-- available (e.g. hosted Supabase free tier), this block is a no-op and an
-- external scheduler / Edge Function must invoke the RPC instead.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_extension WHERE extname = 'pg_cron'
    ) THEN
        -- idempotent registration: drop if already exists, then re-register
        PERFORM cron.unschedule('process-schedule-reminders')
        WHERE EXISTS (
            SELECT 1 FROM cron.job WHERE jobname = 'process-schedule-reminders'
        );

        PERFORM cron.schedule(
            'process-schedule-reminders',
            '*/15 * * * *',
            $cron$SELECT public.flag_due_schedule_reminders()$cron$
        );
    END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- FCM DISPATCH: relies on the Supabase Dashboard webhook described above. When the flag_due_schedule_reminders()
-- function creates a notification row (type = 'Schedule Reminder', user_id set),
-- the webhook fires and send-fcm delivers the push to the employee's device.
-- No additional SQL trigger is required here.
-- ---------------------------------------------------------------------------

COMMIT;
