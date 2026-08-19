-- =============================================================================
-- 20260819_schedule_reminder_cron.sql
-- integrated Shop Management System
-- Schedule Reminder Cron & Employee Presence Tracking
-- =============================================================================
-- Why: 
--   1. Registers a pg_cron job to invoke flag_due_schedule_reminders() every
--      15 minutes so schedule reminders are actually processed.
--   2. Adds a `last_seen_at` column to public.employees for server-side
--      presence tracking (online / away / offline).
-- NOTE: FCM dispatch for Schedule Reminder notifications is handled by the
-- Supabase Dashboard webhook configured in 20260720002_notification_webhooks.sql
-- (INSERT on public.notifications -> send-fcm edge function). No pg_net hardcoded
-- URLs are used here to avoid environment-specific breakage.
-- Dependencies: 012 (flag_due_schedule_reminders), 007 (employees table)
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- PRESENCE: employees.last_seen_at
-- Server-side heartbeat column. Updated by the client every 2 minutes while
-- the app is active. Used to derive online/away/offline status instead of
-- the unreliable navigator.onLine browser API.
-- ---------------------------------------------------------------------------
ALTER TABLE public.employees
    ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ;

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
            $$SELECT public.flag_due_schedule_reminders()$$
        );
    END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- FCM DISPATCH: relies on the Supabase Dashboard webhook documented in
-- 20260720002_notification_webhooks.sql. When the flag_due_schedule_reminders()
-- function creates a notification row (type = 'Schedule Reminder', user_id set),
-- the webhook fires and send-fcm delivers the push to the employee's device.
-- No additional SQL trigger is required here.
-- ---------------------------------------------------------------------------

COMMIT;
