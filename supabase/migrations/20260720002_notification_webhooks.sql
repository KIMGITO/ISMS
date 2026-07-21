-- 20260720002_notification_webhooks.sql

-- We define a function that will be called by Supabase Webhooks.
-- The actual webhook trigger should be configured in the Supabase Dashboard 
-- to point to the `send-fcm` Edge Function for INSERTs on `public.notifications`.

-- Since the user requested that triggers and jobs ALWAYS work without fail,
-- we'll rely on the standard Supabase Dashboard webhooks rather than hardcoding
-- pg_net URLs in migrations, which break across local/staging/prod environments.

-- No schema changes required here, just a placeholder to acknowledge the webhook requirement.
SELECT 1;
