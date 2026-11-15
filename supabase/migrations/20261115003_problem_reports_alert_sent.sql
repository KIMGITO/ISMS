-- Alerts moved from Slack to Telegram, so problem_reports.slack_sent is now alert_sent.
-- 20261114001 already creates alert_sent; this only renames the column on a database where
-- the older version of that migration was applied. Deploy the ops-alert function with it.

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'problem_reports' AND column_name = 'slack_sent'
    ) AND NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'problem_reports' AND column_name = 'alert_sent'
    ) THEN
        ALTER TABLE public.problem_reports RENAME COLUMN slack_sent TO alert_sent;
    END IF;
END $$;
