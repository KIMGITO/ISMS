-- Phase 10: live updates only for the tables the apps actually follow.
--
-- 1. money_assets was never in the live-update list, so the Payments balances the app follows
--    (subscribeMoneyAssets, MoneyAssetRepository.subscribe) never refreshed on their own after a
--    sale or expense on another device (money rule 2: the screen must match the books).
-- 2. 27 tables were in the list but no app or website screen follows them (checked against the
--    code and release v7.5.5). Realtime still decoded every change to them: on live its change
--    polling was ~80% of all database time (pg_stat_statements, 2026-11-05 to 11-23). Removing
--    them changes no data and no screen. Add a table back here when a screen starts following it.
--
-- destructive-ok: removes tables from the realtime publication only; no table, column or row changes.

DO $$
DECLARE
  t text;
  unused text[] := ARRAY[
    'ai_insights', 'ai_settings', 'audit_logs', 'backup_history_logs', 'branches',
    'business_assets', 'complaint_replies', 'complaints', 'credit_payments', 'customer_ledger',
    'dashboard_analytics_snapshots', 'device_fcm_tokens', 'employees', 'google_sheets_backup',
    'notification_preferences', 'offline_sync_queue', 'printer_settings', 'purchase_items',
    'receipt_settings', 'recipe_ingredients', 'recipes', 'scheduled_reports', 'sms_settings',
    'storage_files', 'suppliers', 'transaction_items', 'wallet_transactions'];
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    RETURN;
  END IF;

  FOREACH t IN ARRAY unused LOOP
    IF EXISTS (SELECT 1 FROM pg_publication_tables
               WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = t) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime DROP TABLE public.%I', t);
    END IF;
  END LOOP;

  IF to_regclass('public.money_assets') IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM pg_publication_tables
       WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'money_assets') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.money_assets;
  END IF;
END $$;
