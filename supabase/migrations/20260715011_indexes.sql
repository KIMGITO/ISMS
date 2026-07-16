-- =============================================================================
-- 20260715_011_indexes.sql
-- KayKay's Milk Business Management System
-- Performance Indexes
-- =============================================================================
-- Why: All tables are now created. Indexes on foreign key columns and commonly
-- filtered columns dramatically improve query performance under load. Using
-- IF NOT EXISTS prevents failures on re-application. Covering indexes on
-- commonly joined paths reduce table scans.
-- Dependencies: 001–010 (all tables must exist before indexing)
-- =============================================================================

-- ---------------------------------------------------------------------------
-- businesses
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_businesses_deleted_at
    ON public.businesses(deleted_at) WHERE deleted_at IS NULL;

-- ---------------------------------------------------------------------------
-- branches
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_branches_business_id
    ON public.branches(business_id);
CREATE INDEX IF NOT EXISTS idx_branches_deleted_at
    ON public.branches(deleted_at) WHERE deleted_at IS NULL;

-- ---------------------------------------------------------------------------
-- users
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_users_auth_user_id
    ON public.users(auth_user_id);
CREATE INDEX IF NOT EXISTS idx_users_email
    ON public.users(email);
CREATE INDEX IF NOT EXISTS idx_users_phone
    ON public.users(phone);

-- ---------------------------------------------------------------------------
-- otps
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_otps_email_type
    ON public.otps(email, type);
CREATE INDEX IF NOT EXISTS idx_otps_expires_at
    ON public.otps(expires_at);

-- ---------------------------------------------------------------------------
-- device_fcm_tokens
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_device_fcm_user_id
    ON public.device_fcm_tokens(user_id);

-- ---------------------------------------------------------------------------
-- business_memberships
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_business_memberships_user_id
    ON public.business_memberships(user_id);
CREATE INDEX IF NOT EXISTS idx_business_memberships_business_id
    ON public.business_memberships(business_id);
CREATE INDEX IF NOT EXISTS idx_business_memberships_status
    ON public.business_memberships(business_id, status)
    WHERE status = 'Active';

-- ---------------------------------------------------------------------------
-- invitations
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_invitations_business_id
    ON public.invitations(business_id);
CREATE INDEX IF NOT EXISTS idx_invitations_token
    ON public.invitations(invitation_token);
CREATE INDEX IF NOT EXISTS idx_invitations_email
    ON public.invitations(email);
CREATE INDEX IF NOT EXISTS idx_invitations_status
    ON public.invitations(status) WHERE status = 'Pending';

-- ---------------------------------------------------------------------------
-- role_permissions
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_role_permissions_business_role
    ON public.role_permissions(business_id, role);

-- ---------------------------------------------------------------------------
-- employees
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_employees_business_id
    ON public.employees(business_id);
CREATE INDEX IF NOT EXISTS idx_employees_user_id
    ON public.employees(user_id);
CREATE INDEX IF NOT EXISTS idx_employees_deleted_at
    ON public.employees(deleted_at) WHERE deleted_at IS NULL;

-- ---------------------------------------------------------------------------
-- products
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_products_business_id
    ON public.products(business_id);
CREATE INDEX IF NOT EXISTS idx_products_deleted_at
    ON public.products(business_id, deleted_at) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_products_category
    ON public.products(business_id, category);
CREATE INDEX IF NOT EXISTS idx_products_sku
    ON public.products(business_id, sku) WHERE sku IS NOT NULL;
-- Trigram index for fast product name search (supports ILIKE '%milk%')
CREATE INDEX IF NOT EXISTS idx_products_name_trgm
    ON public.products USING gin (name gin_trgm_ops);

-- ---------------------------------------------------------------------------
-- customers
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_customers_business_id
    ON public.customers(business_id);
CREATE INDEX IF NOT EXISTS idx_customers_phone
    ON public.customers(business_id, phone);
CREATE INDEX IF NOT EXISTS idx_customers_deleted_at
    ON public.customers(business_id, deleted_at) WHERE deleted_at IS NULL;
-- Trigram index for fast customer name search
CREATE INDEX IF NOT EXISTS idx_customers_name_trgm
    ON public.customers USING gin (name gin_trgm_ops);

-- ---------------------------------------------------------------------------
-- customer_ledger
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_customer_ledger_customer_id
    ON public.customer_ledger(customer_id);
CREATE INDEX IF NOT EXISTS idx_customer_ledger_business_id
    ON public.customer_ledger(business_id);
CREATE INDEX IF NOT EXISTS idx_customer_ledger_transaction_id
    ON public.customer_ledger(transaction_id);
CREATE INDEX IF NOT EXISTS idx_customer_ledger_created_at
    ON public.customer_ledger(created_at DESC);

-- ---------------------------------------------------------------------------
-- debt_payments
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_debt_payments_customer_id
    ON public.debt_payments(customer_id);
CREATE INDEX IF NOT EXISTS idx_debt_payments_business_id
    ON public.debt_payments(business_id);

-- ---------------------------------------------------------------------------
-- transactions
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_transactions_business_id
    ON public.transactions(business_id);
CREATE INDEX IF NOT EXISTS idx_transactions_customer_id
    ON public.transactions(customer_id);
CREATE INDEX IF NOT EXISTS idx_transactions_staff_id
    ON public.transactions(staff_id);
CREATE INDEX IF NOT EXISTS idx_transactions_timestamp
    ON public.transactions(business_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_transactions_deleted_at
    ON public.transactions(business_id, deleted_at) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_transactions_payment_method
    ON public.transactions(business_id, payment_method);

-- ---------------------------------------------------------------------------
-- transaction_items
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_tx_items_transaction_id
    ON public.transaction_items(transaction_id);
CREATE INDEX IF NOT EXISTS idx_tx_items_product_id
    ON public.transaction_items(product_id);

-- ---------------------------------------------------------------------------
-- credit_payments
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_credit_payments_business_id
    ON public.credit_payments(business_id);
CREATE INDEX IF NOT EXISTS idx_credit_payments_customer_id
    ON public.credit_payments(customer_id);
CREATE INDEX IF NOT EXISTS idx_credit_payments_status
    ON public.credit_payments(customer_id, status)
    WHERE status IN ('Open', 'Partial');

-- ---------------------------------------------------------------------------
-- wallet_transactions
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_wallet_tx_business_id
    ON public.wallet_transactions(business_id);
CREATE INDEX IF NOT EXISTS idx_wallet_tx_customer_id
    ON public.wallet_transactions(customer_id);
CREATE INDEX IF NOT EXISTS idx_wallet_tx_transaction_id
    ON public.wallet_transactions(transaction_id);

-- ---------------------------------------------------------------------------
-- shifts
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_shifts_business_id
    ON public.shifts(business_id);
CREATE INDEX IF NOT EXISTS idx_shifts_employee_id
    ON public.shifts(employee_id);
CREATE INDEX IF NOT EXISTS idx_shifts_status
    ON public.shifts(employee_id, status) WHERE status = 'Active';

-- ---------------------------------------------------------------------------
-- schedules
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_schedules_business_id
    ON public.schedules(business_id);
CREATE INDEX IF NOT EXISTS idx_schedules_employee_id
    ON public.schedules(employee_id);
CREATE INDEX IF NOT EXISTS idx_schedules_date
    ON public.schedules(business_id, date);
CREATE INDEX IF NOT EXISTS idx_schedules_deleted_at
    ON public.schedules(deleted_at) WHERE deleted_at IS NULL;

-- ---------------------------------------------------------------------------
-- inventory_adjustments
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_inv_adj_business_id
    ON public.inventory_adjustments(business_id);
CREATE INDEX IF NOT EXISTS idx_inv_adj_product_id
    ON public.inventory_adjustments(product_id);
CREATE INDEX IF NOT EXISTS idx_inv_adj_timestamp
    ON public.inventory_adjustments(business_id, timestamp DESC);

-- ---------------------------------------------------------------------------
-- expense_categories
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_exp_cat_business_id
    ON public.expense_categories(business_id);

-- ---------------------------------------------------------------------------
-- expenses
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_expenses_business_id
    ON public.expenses(business_id);
CREATE INDEX IF NOT EXISTS idx_expenses_date
    ON public.expenses(business_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_expenses_deleted_at
    ON public.expenses(business_id, deleted_at) WHERE deleted_at IS NULL;

-- ---------------------------------------------------------------------------
-- suppliers
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_suppliers_business_id
    ON public.suppliers(business_id);

-- ---------------------------------------------------------------------------
-- notifications
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_notifications_business_id
    ON public.notifications(business_id);
CREATE INDEX IF NOT EXISTS idx_notifications_user_id
    ON public.notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_unread
    ON public.notifications(business_id, read_at)
    WHERE read_at IS NULL AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_notifications_deleted_at
    ON public.notifications(deleted_at) WHERE deleted_at IS NULL;

-- ---------------------------------------------------------------------------
-- mpesa_transactions
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_mpesa_business_id
    ON public.mpesa_transactions(business_id);
CREATE INDEX IF NOT EXISTS idx_mpesa_checkout_request_id
    ON public.mpesa_transactions(checkout_request_id);

-- ---------------------------------------------------------------------------
-- integration_configurations
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_int_config_business_section
    ON public.integration_configurations(business_id, section);

-- ---------------------------------------------------------------------------
-- receipt_verifications
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_receipt_verif_token
    ON public.receipt_verifications(verification_token);
CREATE INDEX IF NOT EXISTS idx_receipt_verif_transaction_id
    ON public.receipt_verifications(transaction_id);

-- ---------------------------------------------------------------------------
-- recipes
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_recipes_business_id
    ON public.recipes(business_id);

-- ---------------------------------------------------------------------------
-- recipe_ingredients
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_recipe_ingredients_recipe_id
    ON public.recipe_ingredients(recipe_id);

-- ---------------------------------------------------------------------------
-- production_batches
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_production_batches_business_id
    ON public.production_batches(business_id);
CREATE INDEX IF NOT EXISTS idx_production_batches_recipe_id
    ON public.production_batches(recipe_id);

-- ---------------------------------------------------------------------------
-- purchases
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_purchases_business_id
    ON public.purchases(business_id);

-- ---------------------------------------------------------------------------
-- purchase_items
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_purchase_items_purchase_id
    ON public.purchase_items(purchase_id);

-- ---------------------------------------------------------------------------
-- business_assets
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_business_assets_business_id
    ON public.business_assets(business_id);

-- ---------------------------------------------------------------------------
-- storage_files
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_storage_files_business_id
    ON public.storage_files(business_id);

-- ---------------------------------------------------------------------------
-- ai_insights
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_ai_insights_business_id
    ON public.ai_insights(business_id);

-- ---------------------------------------------------------------------------
-- payments
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_payments_business_id
    ON public.payments(business_id);

-- ---------------------------------------------------------------------------
-- backup_history_logs
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_backup_logs_business_id
    ON public.backup_history_logs(business_id);
CREATE INDEX IF NOT EXISTS idx_backup_logs_timestamp
    ON public.backup_history_logs(business_id, timestamp DESC);

-- ---------------------------------------------------------------------------
-- scheduled_reports
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_sched_reports_business_id
    ON public.scheduled_reports(business_id);

-- ---------------------------------------------------------------------------
-- dashboard_analytics_snapshots
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_dash_snap_business_date
    ON public.dashboard_analytics_snapshots(business_id, snapshot_date DESC);

-- ---------------------------------------------------------------------------
-- complaints
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_complaints_business_id
    ON public.complaints(business_id);
CREATE INDEX IF NOT EXISTS idx_complaints_deleted_at
    ON public.complaints(deleted_at) WHERE deleted_at IS NULL;

-- ---------------------------------------------------------------------------
-- complaint_replies
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_complaint_replies_complaint_id
    ON public.complaint_replies(complaint_id);

-- ---------------------------------------------------------------------------
-- audit_logs
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_audit_logs_business_id
    ON public.audit_logs(business_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_employee_id
    ON public.audit_logs(employee_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_timestamp
    ON public.audit_logs(business_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action
    ON public.audit_logs(action);

-- ---------------------------------------------------------------------------
-- offline_sync_queue
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_sync_queue_business_id
    ON public.offline_sync_queue(business_id);
CREATE INDEX IF NOT EXISTS idx_sync_queue_unsynced
    ON public.offline_sync_queue(business_id, synced_at)
    WHERE synced_at IS NULL;
