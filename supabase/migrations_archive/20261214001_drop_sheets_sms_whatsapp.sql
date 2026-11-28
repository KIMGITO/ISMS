-- Remove the Google Sheets backup (replaced by Settings -> Export data, run on demand in the
-- app) and the Twilio SMS and WhatsApp Cloud API connections. Their edge functions
-- (backup-config, sms-config, whatsapp-config) are removed in the same change.
-- backup_history_logs stays: log cleanup and retention still read it, and old rows are history.

DO $$
BEGIN
  -- Two steps: cron.job can only be named once we know the cron schema exists.
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'run-due-backups') THEN
      PERFORM cron.unschedule('run-due-backups');
    END IF;
  END IF;
END $$;

DROP FUNCTION IF EXISTS public.run_due_backups();

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['google_sheets_backup', 'sms_settings', 'whatsapp_settings'] LOOP
    IF EXISTS (SELECT 1 FROM pg_publication_tables
               WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = t) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime DROP TABLE public.%I', t);
    END IF;
    EXECUTE format('DROP TABLE IF EXISTS public.%I CASCADE', t);
  END LOOP;
END $$;
