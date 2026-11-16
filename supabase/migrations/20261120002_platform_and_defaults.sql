-- =============================================================================
-- 20261120002_platform_and_defaults.sql: what the schema dump leaves out.
-- Supabase-owned places the app uses (sign-up trigger, storage buckets and their rules,
-- scheduled jobs) and the rows the app needs from the start (role defaults).
-- Safe to run again: everything is created or replaced by name.
-- =============================================================================

-- ── Every new sign-in gets a public.users row ────────────────────────────────────────────
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ── Storage buckets ───────────────────────────────────────────────────────────────────────
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types) VALUES
    ('business-files', 'business-files', false, 20971520, '{image/jpeg,image/png,image/webp,image/gif,image/avif,image/heic,image/heif,application/pdf,text/plain,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-powerpoint,application/vnd.openxmlformats-officedocument.presentationml.presentation,application/zip}'),
    ('business-logos', 'business-logos', true, 10485760, '{image/jpeg,image/png,image/webp,image/gif,image/avif,image/heic,image/heif}'),
    ('employee-avatars', 'employee-avatars', true, 10485760, '{image/jpeg,image/png,image/webp,image/gif,image/avif,image/heic,image/heif}'),
    ('expense-receipts', 'expense-receipts', false, 20971520, '{image/jpeg,image/png,image/webp,image/gif,image/avif,image/heic,image/heif,application/pdf,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document}'),
    ('product-images', 'product-images', true, 10485760, '{image/jpeg,image/png,image/webp,image/gif,image/avif,image/heic,image/heif}'),
    ('receipt-exports', 'receipt-exports', false, 20971520, '{image/jpeg,image/png,image/webp,image/gif,image/avif,image/heic,image/heif,application/pdf,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document}')
ON CONFLICT (id) DO UPDATE SET public = EXCLUDED.public, file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

-- ── Who may read and write files ──────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Allow delete for authorized users" ON storage.objects;
CREATE POLICY "Allow delete for authorized users" ON storage.objects AS PERMISSIVE FOR DELETE TO authenticated
    USING (((bucket_id = ANY (ARRAY['business-logos'::text, 'employee-avatars'::text, 'product-images'::text, 'receipt-exports'::text, 'expense-receipts'::text])) AND public.fn_can_write_storage_folder(split_part(name, '/'::text, 1))));
DROP POLICY IF EXISTS "Allow insert for authorized users" ON storage.objects;
CREATE POLICY "Allow insert for authorized users" ON storage.objects AS PERMISSIVE FOR INSERT TO authenticated
    WITH CHECK (((bucket_id = ANY (ARRAY['business-logos'::text, 'employee-avatars'::text, 'product-images'::text, 'receipt-exports'::text, 'expense-receipts'::text])) AND public.fn_can_write_storage_folder(split_part(name, '/'::text, 1))));
DROP POLICY IF EXISTS "Allow select for authorized users" ON storage.objects;
CREATE POLICY "Allow select for authorized users" ON storage.objects AS PERMISSIVE FOR SELECT TO public
    USING (((bucket_id = ANY (ARRAY['business-logos'::text, 'employee-avatars'::text, 'product-images'::text])) OR ((bucket_id = ANY (ARRAY['receipt-exports'::text, 'expense-receipts'::text])) AND (auth.uid() IS NOT NULL) AND public.fn_can_write_storage_folder(split_part(name, '/'::text, 1)))));
DROP POLICY IF EXISTS "Allow update for authorized users" ON storage.objects;
CREATE POLICY "Allow update for authorized users" ON storage.objects AS PERMISSIVE FOR UPDATE TO authenticated
    USING (((bucket_id = ANY (ARRAY['business-logos'::text, 'employee-avatars'::text, 'product-images'::text, 'receipt-exports'::text, 'expense-receipts'::text])) AND public.fn_can_write_storage_folder(split_part(name, '/'::text, 1))))
    WITH CHECK (((bucket_id = ANY (ARRAY['business-logos'::text, 'employee-avatars'::text, 'product-images'::text, 'receipt-exports'::text, 'expense-receipts'::text])) AND public.fn_can_write_storage_folder(split_part(name, '/'::text, 1))));
DROP POLICY IF EXISTS "business-files delete" ON storage.objects;
CREATE POLICY "business-files delete" ON storage.objects AS PERMISSIVE FOR DELETE TO authenticated
    USING (((bucket_id = 'business-files'::text) AND public.fn_storage_folder_permission(split_part(name, '/'::text, 1), VARIADIC ARRAY['files.manage'::text])));
DROP POLICY IF EXISTS "business-files read" ON storage.objects;
CREATE POLICY "business-files read" ON storage.objects AS PERMISSIVE FOR SELECT TO authenticated
    USING (((bucket_id = 'business-files'::text) AND public.fn_storage_folder_permission(split_part(name, '/'::text, 1), VARIADIC ARRAY['files.view'::text, 'files.manage'::text])));
DROP POLICY IF EXISTS "business-files upload" ON storage.objects;
CREATE POLICY "business-files upload" ON storage.objects AS PERMISSIVE FOR INSERT TO authenticated
    WITH CHECK (((bucket_id = 'business-files'::text) AND public.fn_storage_folder_permission(split_part(name, '/'::text, 1), VARIADIC ARRAY['files.manage'::text])));

-- ── Scheduled jobs (pg_cron) ──────────────────────────────────────────────────────────────
SELECT cron.schedule('customer-portal-daily', '0 2 * * *', $job$SELECT public.run_customer_portal_daily()$job$);
SELECT cron.schedule('run-due-backups', '5 * * * *', $job$SELECT public.run_due_backups()$job$);
SELECT cron.schedule('escalate-unaccepted-alerts', '* * * * *', $job$SELECT public.escalate_unaccepted_alerts()$job$);
SELECT cron.schedule('process-schedule-reminders', '* * * * *', $job$SELECT public.flag_due_schedule_reminders()$job$);
SELECT cron.schedule('prune-stale-device-tokens', '17 3 * * *', $job$DELETE FROM public.device_fcm_tokens WHERE updated_at < NOW() - INTERVAL '60 days'$job$);
SELECT cron.schedule('buying-nightly', '15 4 * * *', $job$SELECT public.buying_nightly()$job$);

-- ── Role defaults (mirrors SYSTEM_ROLES in src/utils/permissions.ts; a test compares them) ─
-- Owner and Admin have every permission and need no row.
INSERT INTO public.role_default_permissions (role, permissions) VALUES
    ('Cashier', ARRAY['ai.use', 'business.view', 'complaints.view', 'customers.create', 'customers.debts', 'customers.loyalty', 'customers.schedules', 'customers.view', 'dashboard.view', 'inventory.view', 'notifications.view', 'online_store.view', 'orders.assign_rider', 'orders.create', 'orders.update', 'orders.view', 'payments.airtel', 'payments.card', 'payments.cash', 'payments.mpesa', 'payments.verify', 'pettycash.record', 'pos.cancel_sale', 'pos.close_shift', 'pos.create_sale', 'pos.discount', 'pos.open_shift', 'pos.walkin_customer', 'products.view', 'settings.theme']),
    ('Manager', ARRAY['accounting.view', 'ai.insights', 'ai.use', 'assets.view', 'bom.create', 'bom.update', 'bom.view', 'business.switch', 'business.view', 'communication.send', 'communication.view', 'complaints.reply', 'complaints.view', 'customers.create', 'customers.debts', 'customers.loyalty', 'customers.manage', 'customers.schedules', 'customers.update', 'customers.view', 'dashboard.view', 'deliveries.assign', 'deliveries.cancel', 'deliveries.complete', 'deliveries.create', 'deliveries.view', 'expenses.create', 'expenses.update', 'expenses.view', 'files.view', 'finance.view', 'home.view', 'inventory.adjust_stock', 'inventory.expiry', 'inventory.receive_stock', 'inventory.request_transfer', 'inventory.stock_count', 'inventory.stock_history', 'inventory.transfer_stock', 'inventory.view', 'inventory.wastage', 'invoices.manage', 'invoices.view', 'loyalty.adjust', 'notifications.send', 'notifications.view', 'online_store.view', 'orders.assign_rider', 'orders.complete', 'orders.create', 'orders.update', 'orders.view', 'payments.card', 'payments.cash', 'payments.verify', 'payments.view', 'pettycash.record', 'pos.close_shift', 'pos.create_sale', 'pos.open_shift', 'pos.walkin_customer', 'production.approve', 'production.create', 'production.update', 'production.view', 'products.create', 'products.export', 'products.import', 'products.manage_categories', 'products.update', 'products.view', 'purchases.approve', 'purchases.create', 'purchases.export', 'purchases.print', 'purchases.request_quote', 'purchases.update', 'purchases.view', 'quotes.manage', 'quotes.view', 'refunds.create', 'reports.customers', 'reports.deliveries', 'reports.inventory', 'reports.profit', 'reports.sales', 'reports.view', 'sales_orders.manage', 'sales_orders.view', 'settings.tax', 'settings.theme', 'settings.update', 'settings.view', 'staff.schedule', 'staff.view', 'supplier_bills.manage', 'suppliers.create', 'suppliers.export', 'suppliers.import', 'suppliers.update', 'suppliers.view']),
    ('Rider', ARRAY['ai.use', 'business.view', 'dashboard.view', 'deliveries.cancel', 'deliveries.complete', 'deliveries.delivery_price', 'deliveries.delivery_zones', 'deliveries.view', 'notifications.view', 'settings.theme']),
    ('Supplier', ARRAY['supplier_portal.deliveries', 'supplier_portal.orders', 'supplier_portal.price_requests', 'supplier_portal.statement', 'supplier_portal.update_details'])
ON CONFLICT (role) DO UPDATE SET permissions = EXCLUDED.permissions;

-- Old one-off data fixes are already part of the schema; mark them done.
INSERT INTO public.app_data_conversions (key) VALUES ('loyalty_points_x200') ON CONFLICT (key) DO NOTHING;
