-- =============================================================================
-- 20260715_014_rls_policies.sql
-- KayKay's Milk Business Management System
-- Row Level Security Policies
-- =============================================================================
-- Why: RLS policies must be defined AFTER the helper functions they reference
-- (get_user_business_ids, is_owner_or_admin — defined in migration 012) and
-- AFTER all tables exist (migrations 003–010). Each policy group is preceded
-- by DROP IF EXISTS to allow idempotent re-application.
--
-- Policy Naming Convention: pol_<table>_<action>
--   - SELECT policies use USING clause
--   - INSERT policies use WITH CHECK clause
--   - ALL (INSERT+UPDATE+DELETE) policies use USING clause
--
-- Security Levels:
--   - Public data (receipt verification tokens): USING (TRUE) for SELECT
--   - Member data: USING (business_id = ANY(get_user_business_ids()))
--   - Owner/Admin write: USING (is_owner_or_admin(business_id))
--   - Personal data: USING (auth_user_id = auth.uid())
--   - Append-only (audit_logs, wallet_transactions): SELECT + INSERT only
--
-- Dependencies: 001–013
-- =============================================================================

-- ---------------------------------------------------------------------------
-- businesses
-- SELECT: members of the business
-- INSERT: any authenticated user (creating their first business)
-- UPDATE/DELETE: Owner or Admin only
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS pol_businesses_select ON public.businesses;
CREATE POLICY pol_businesses_select ON public.businesses
    FOR SELECT USING (id = ANY(public.get_user_business_ids()));

DROP POLICY IF EXISTS pol_businesses_insert ON public.businesses;
CREATE POLICY pol_businesses_insert ON public.businesses
    FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS pol_businesses_update ON public.businesses;
CREATE POLICY pol_businesses_update ON public.businesses
    FOR UPDATE USING (public.is_owner_or_admin(id));

DROP POLICY IF EXISTS pol_businesses_delete ON public.businesses;
CREATE POLICY pol_businesses_delete ON public.businesses
    FOR DELETE USING (public.is_owner_or_admin(id));

-- ---------------------------------------------------------------------------
-- branches
-- SELECT: any business member
-- ALL write: Owner or Admin only
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS pol_branches_select ON public.branches;
CREATE POLICY pol_branches_select ON public.branches
    FOR SELECT USING (business_id = ANY(public.get_user_business_ids()));

DROP POLICY IF EXISTS pol_branches_write ON public.branches;
CREATE POLICY pol_branches_write ON public.branches
    FOR ALL USING (public.is_owner_or_admin(business_id));

-- ---------------------------------------------------------------------------
-- users
-- SELECT: own profile OR teammates (members of same businesses)
-- INSERT: own profile (set during auth flow)
-- UPDATE: own profile only
-- DELETE: handled by system/trigger only
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS pol_users_select_own ON public.users;
CREATE POLICY pol_users_select_own ON public.users
    FOR SELECT USING (auth_user_id = auth.uid());

DROP POLICY IF EXISTS pol_users_select_team ON public.users;
CREATE POLICY pol_users_select_team ON public.users
    FOR SELECT USING (
        id IN (
            SELECT user_id FROM public.business_memberships
            WHERE business_id = ANY(public.get_user_business_ids())
        )
    );

DROP POLICY IF EXISTS pol_users_insert ON public.users;
CREATE POLICY pol_users_insert ON public.users
    FOR INSERT WITH CHECK (auth_user_id = auth.uid());

DROP POLICY IF EXISTS pol_users_update_own ON public.users;
CREATE POLICY pol_users_update_own ON public.users
    FOR UPDATE USING (auth_user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- otps
-- ALL: only the user whose email matches the OTP can access it.
-- Also allows system-level access via SECURITY DEFINER functions.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS pol_otps_all ON public.otps;
CREATE POLICY pol_otps_all ON public.otps
    FOR ALL USING (
        email = (
            SELECT email FROM public.users
            WHERE auth_user_id = auth.uid()
        )
    );

-- ---------------------------------------------------------------------------
-- device_fcm_tokens
-- Full CRUD: own tokens only
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS pol_device_fcm_select ON public.device_fcm_tokens;
CREATE POLICY pol_device_fcm_select ON public.device_fcm_tokens
    FOR SELECT USING (
        user_id IN (SELECT id FROM public.users WHERE auth_user_id = auth.uid())
    );

DROP POLICY IF EXISTS pol_device_fcm_insert ON public.device_fcm_tokens;
CREATE POLICY pol_device_fcm_insert ON public.device_fcm_tokens
    FOR INSERT WITH CHECK (
        user_id IN (SELECT id FROM public.users WHERE auth_user_id = auth.uid())
    );

DROP POLICY IF EXISTS pol_device_fcm_update ON public.device_fcm_tokens;
CREATE POLICY pol_device_fcm_update ON public.device_fcm_tokens
    FOR UPDATE USING (
        user_id IN (SELECT id FROM public.users WHERE auth_user_id = auth.uid())
    );

DROP POLICY IF EXISTS pol_device_fcm_delete ON public.device_fcm_tokens;
CREATE POLICY pol_device_fcm_delete ON public.device_fcm_tokens
    FOR DELETE USING (
        user_id IN (SELECT id FROM public.users WHERE auth_user_id = auth.uid())
    );

-- ---------------------------------------------------------------------------
-- business_memberships
-- SELECT: members of the business
-- ALL write: Owner or Admin only
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS pol_memberships_select ON public.business_memberships;
CREATE POLICY pol_memberships_select ON public.business_memberships
    FOR SELECT USING (business_id = ANY(public.get_user_business_ids()));

DROP POLICY IF EXISTS pol_memberships_write ON public.business_memberships;
CREATE POLICY pol_memberships_write ON public.business_memberships
    FOR ALL USING (public.is_owner_or_admin(business_id));

-- ---------------------------------------------------------------------------
-- invitations
-- SELECT: business members OR matching invitee's own email
-- ALL write: Owner or Admin only
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS pol_invitations_select ON public.invitations;
CREATE POLICY pol_invitations_select ON public.invitations
    FOR SELECT USING (
        business_id = ANY(public.get_user_business_ids())
        OR email = (SELECT email FROM public.users WHERE auth_user_id = auth.uid())
    );

DROP POLICY IF EXISTS pol_invitations_write ON public.invitations;
CREATE POLICY pol_invitations_write ON public.invitations
    FOR ALL USING (public.is_owner_or_admin(business_id));

-- ---------------------------------------------------------------------------
-- role_permissions
-- SELECT: any business member
-- ALL write: Owner or Admin only
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS pol_role_perms_select ON public.role_permissions;
CREATE POLICY pol_role_perms_select ON public.role_permissions
    FOR SELECT USING (business_id = ANY(public.get_user_business_ids()));

DROP POLICY IF EXISTS pol_role_perms_write ON public.role_permissions;
CREATE POLICY pol_role_perms_write ON public.role_permissions
    FOR ALL USING (public.is_owner_or_admin(business_id));

-- ---------------------------------------------------------------------------
-- employees
-- SELECT: any business member
-- ALL write: Owner or Admin only
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS pol_employees_select ON public.employees;
CREATE POLICY pol_employees_select ON public.employees
    FOR SELECT USING (business_id = ANY(public.get_user_business_ids()));

DROP POLICY IF EXISTS pol_employees_write ON public.employees;
CREATE POLICY pol_employees_write ON public.employees
    FOR ALL USING (public.is_owner_or_admin(business_id));

-- ---------------------------------------------------------------------------
-- products
-- SELECT: any business member (only non-deleted)
-- ALL write: any business member (soft-delete is controlled by app layer)
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS pol_products_select ON public.products;
CREATE POLICY pol_products_select ON public.products
    FOR SELECT USING (
        business_id = ANY(public.get_user_business_ids())
        AND deleted_at IS NULL
    );

DROP POLICY IF EXISTS pol_products_write ON public.products;
CREATE POLICY pol_products_write ON public.products
    FOR ALL USING (business_id = ANY(public.get_user_business_ids()));

-- ---------------------------------------------------------------------------
-- customers
-- ALL: any business member
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS pol_customers_all ON public.customers;
CREATE POLICY pol_customers_all ON public.customers
    FOR ALL USING (business_id = ANY(public.get_user_business_ids()));

-- ---------------------------------------------------------------------------
-- customer_ledger
-- ALL: any business member (append-only enforced by app layer)
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS pol_customer_ledger_all ON public.customer_ledger;
CREATE POLICY pol_customer_ledger_all ON public.customer_ledger
    FOR ALL USING (business_id = ANY(public.get_user_business_ids()));

-- ---------------------------------------------------------------------------
-- debt_payments
-- ALL: any business member
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS pol_debt_payments_all ON public.debt_payments;
CREATE POLICY pol_debt_payments_all ON public.debt_payments
    FOR ALL USING (business_id = ANY(public.get_user_business_ids()));

-- ---------------------------------------------------------------------------
-- transactions
-- ALL: any business member
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS pol_transactions_all ON public.transactions;
CREATE POLICY pol_transactions_all ON public.transactions
    FOR ALL USING (business_id = ANY(public.get_user_business_ids()));

-- ---------------------------------------------------------------------------
-- transaction_items
-- ALL: any member of the business the transaction belongs to
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS pol_tx_items_all ON public.transaction_items;
CREATE POLICY pol_tx_items_all ON public.transaction_items
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM public.transactions t
            WHERE t.id = transaction_id
              AND t.business_id = ANY(public.get_user_business_ids())
        )
    );

-- ---------------------------------------------------------------------------
-- credit_payments
-- ALL: any business member
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS pol_credit_payments_all ON public.credit_payments;
CREATE POLICY pol_credit_payments_all ON public.credit_payments
    FOR ALL USING (business_id = ANY(public.get_user_business_ids()));

-- ---------------------------------------------------------------------------
-- wallet_transactions
-- SELECT and INSERT only: immutable ledger (no UPDATE/DELETE)
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS pol_wallet_transactions_select ON public.wallet_transactions;
CREATE POLICY pol_wallet_transactions_select ON public.wallet_transactions
    FOR SELECT USING (business_id = ANY(public.get_user_business_ids()));

DROP POLICY IF EXISTS pol_wallet_transactions_insert ON public.wallet_transactions;
CREATE POLICY pol_wallet_transactions_insert ON public.wallet_transactions
    FOR INSERT WITH CHECK (business_id = ANY(public.get_user_business_ids()));

-- ---------------------------------------------------------------------------
-- shifts
-- ALL: any business member
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS pol_shifts_all ON public.shifts;
CREATE POLICY pol_shifts_all ON public.shifts
    FOR ALL USING (business_id = ANY(public.get_user_business_ids()));

-- ---------------------------------------------------------------------------
-- schedules
-- ALL: any business member
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS pol_schedules_all ON public.schedules;
CREATE POLICY pol_schedules_all ON public.schedules
    FOR ALL USING (business_id = ANY(public.get_user_business_ids()));

-- ---------------------------------------------------------------------------
-- inventory_adjustments
-- ALL: any business member
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS pol_inv_adj_all ON public.inventory_adjustments;
CREATE POLICY pol_inv_adj_all ON public.inventory_adjustments
    FOR ALL USING (business_id = ANY(public.get_user_business_ids()));

-- ---------------------------------------------------------------------------
-- expense_categories
-- SELECT: any business member
-- ALL write: Owner or Admin only
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS pol_exp_cat_select ON public.expense_categories;
CREATE POLICY pol_exp_cat_select ON public.expense_categories
    FOR SELECT USING (business_id = ANY(public.get_user_business_ids()));

DROP POLICY IF EXISTS pol_exp_cat_write ON public.expense_categories;
CREATE POLICY pol_exp_cat_write ON public.expense_categories
    FOR ALL USING (public.is_owner_or_admin(business_id));

-- ---------------------------------------------------------------------------
-- expenses
-- SELECT: any business member
-- ALL write: Owner or Admin only
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS pol_expenses_select ON public.expenses;
CREATE POLICY pol_expenses_select ON public.expenses
    FOR SELECT USING (business_id = ANY(public.get_user_business_ids()));

DROP POLICY IF EXISTS pol_expenses_write ON public.expenses;
CREATE POLICY pol_expenses_write ON public.expenses
    FOR ALL USING (public.is_owner_or_admin(business_id));

-- ---------------------------------------------------------------------------
-- suppliers
-- SELECT: any business member
-- ALL write: Owner or Admin only
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS pol_suppliers_select ON public.suppliers;
CREATE POLICY pol_suppliers_select ON public.suppliers
    FOR SELECT USING (business_id = ANY(public.get_user_business_ids()));

DROP POLICY IF EXISTS pol_suppliers_write ON public.suppliers;
CREATE POLICY pol_suppliers_write ON public.suppliers
    FOR ALL USING (public.is_owner_or_admin(business_id));

-- ---------------------------------------------------------------------------
-- mpesa_transactions
-- ALL: any business member
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS pol_mpesa_all ON public.mpesa_transactions;
CREATE POLICY pol_mpesa_all ON public.mpesa_transactions
    FOR ALL USING (business_id = ANY(public.get_user_business_ids()));

-- ---------------------------------------------------------------------------
-- notifications
-- SELECT: any business member (non-deleted only)
-- ALL write: any business member
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS pol_notifications_select ON public.notifications;
CREATE POLICY pol_notifications_select ON public.notifications
    FOR SELECT USING (
        business_id = ANY(public.get_user_business_ids())
        AND deleted_at IS NULL
    );

DROP POLICY IF EXISTS pol_notifications_write ON public.notifications;
CREATE POLICY pol_notifications_write ON public.notifications
    FOR ALL USING (business_id = ANY(public.get_user_business_ids()));

-- ---------------------------------------------------------------------------
-- notification_preferences
-- ALL: any business member
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS pol_notif_pref_all ON public.notification_preferences;
CREATE POLICY pol_notif_pref_all ON public.notification_preferences
    FOR ALL USING (business_id = ANY(public.get_user_business_ids()));

-- ---------------------------------------------------------------------------
-- integration_configurations
-- SELECT: any business member
-- ALL write: Owner or Admin only
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS pol_int_config_select ON public.integration_configurations;
CREATE POLICY pol_int_config_select ON public.integration_configurations
    FOR SELECT USING (business_id = ANY(public.get_user_business_ids()));

DROP POLICY IF EXISTS pol_int_config_write ON public.integration_configurations;
CREATE POLICY pol_int_config_write ON public.integration_configurations
    FOR ALL USING (public.is_owner_or_admin(business_id));

-- ---------------------------------------------------------------------------
-- receipt_settings
-- SELECT: any business member
-- ALL write: Owner or Admin only
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS pol_receipt_settings_select ON public.receipt_settings;
CREATE POLICY pol_receipt_settings_select ON public.receipt_settings
    FOR SELECT USING (business_id = ANY(public.get_user_business_ids()));

DROP POLICY IF EXISTS pol_receipt_settings_write ON public.receipt_settings;
CREATE POLICY pol_receipt_settings_write ON public.receipt_settings
    FOR ALL USING (public.is_owner_or_admin(business_id));

-- ---------------------------------------------------------------------------
-- receipt_verifications
-- SELECT: public (anyone can verify a receipt — customer-facing)
-- ALL write: any business member
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS pol_receipt_verif_select ON public.receipt_verifications;
CREATE POLICY pol_receipt_verif_select ON public.receipt_verifications
    FOR SELECT USING (TRUE);

DROP POLICY IF EXISTS pol_receipt_verif_write ON public.receipt_verifications;
CREATE POLICY pol_receipt_verif_write ON public.receipt_verifications
    FOR ALL USING (business_id = ANY(public.get_user_business_ids()));

-- ---------------------------------------------------------------------------
-- printer_settings
-- SELECT: any business member
-- ALL write: Owner or Admin only
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS pol_printer_settings_select ON public.printer_settings;
CREATE POLICY pol_printer_settings_select ON public.printer_settings
    FOR SELECT USING (business_id = ANY(public.get_user_business_ids()));

DROP POLICY IF EXISTS pol_printer_settings_write ON public.printer_settings;
CREATE POLICY pol_printer_settings_write ON public.printer_settings
    FOR ALL USING (public.is_owner_or_admin(business_id));

-- ---------------------------------------------------------------------------
-- sms_settings
-- SELECT: any business member
-- ALL write: Owner or Admin only
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS pol_sms_settings_select ON public.sms_settings;
CREATE POLICY pol_sms_settings_select ON public.sms_settings
    FOR SELECT USING (business_id = ANY(public.get_user_business_ids()));

DROP POLICY IF EXISTS pol_sms_settings_write ON public.sms_settings;
CREATE POLICY pol_sms_settings_write ON public.sms_settings
    FOR ALL USING (public.is_owner_or_admin(business_id));

-- ---------------------------------------------------------------------------
-- ai_settings
-- SELECT: any business member
-- ALL write: Owner or Admin only
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS pol_ai_settings_select ON public.ai_settings;
CREATE POLICY pol_ai_settings_select ON public.ai_settings
    FOR SELECT USING (business_id = ANY(public.get_user_business_ids()));

DROP POLICY IF EXISTS pol_ai_settings_write ON public.ai_settings;
CREATE POLICY pol_ai_settings_write ON public.ai_settings
    FOR ALL USING (public.is_owner_or_admin(business_id));

-- ---------------------------------------------------------------------------
-- google_sheets_backup
-- SELECT: any business member
-- ALL write: Owner or Admin only
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS pol_gsheets_select ON public.google_sheets_backup;
CREATE POLICY pol_gsheets_select ON public.google_sheets_backup
    FOR SELECT USING (business_id = ANY(public.get_user_business_ids()));

DROP POLICY IF EXISTS pol_gsheets_write ON public.google_sheets_backup;
CREATE POLICY pol_gsheets_write ON public.google_sheets_backup
    FOR ALL USING (public.is_owner_or_admin(business_id));

-- ---------------------------------------------------------------------------
-- recipes
-- SELECT: any business member
-- ALL write: Owner or Admin only
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS pol_recipes_select ON public.recipes;
CREATE POLICY pol_recipes_select ON public.recipes
    FOR SELECT USING (business_id = ANY(public.get_user_business_ids()));

DROP POLICY IF EXISTS pol_recipes_write ON public.recipes;
CREATE POLICY pol_recipes_write ON public.recipes
    FOR ALL USING (public.is_owner_or_admin(business_id));

-- ---------------------------------------------------------------------------
-- recipe_ingredients
-- SELECT: any member of the business the recipe belongs to
-- ALL write: Owner or Admin of the business the recipe belongs to
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS pol_recipe_ingredients_select ON public.recipe_ingredients;
CREATE POLICY pol_recipe_ingredients_select ON public.recipe_ingredients
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM public.recipes r
            WHERE r.id = recipe_id
              AND r.business_id = ANY(public.get_user_business_ids())
        )
    );

DROP POLICY IF EXISTS pol_recipe_ingredients_write ON public.recipe_ingredients;
CREATE POLICY pol_recipe_ingredients_write ON public.recipe_ingredients
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM public.recipes r
            WHERE r.id = recipe_id
              AND public.is_owner_or_admin(r.business_id)
        )
    );

-- ---------------------------------------------------------------------------
-- production_batches
-- ALL: any business member
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS pol_production_batches_all ON public.production_batches;
CREATE POLICY pol_production_batches_all ON public.production_batches
    FOR ALL USING (business_id = ANY(public.get_user_business_ids()));

-- ---------------------------------------------------------------------------
-- purchases
-- ALL: any business member
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS pol_purchases_all ON public.purchases;
CREATE POLICY pol_purchases_all ON public.purchases
    FOR ALL USING (business_id = ANY(public.get_user_business_ids()));

-- ---------------------------------------------------------------------------
-- purchase_items
-- ALL: any member of the business the purchase belongs to
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS pol_purchase_items_all ON public.purchase_items;
CREATE POLICY pol_purchase_items_all ON public.purchase_items
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM public.purchases p
            WHERE p.id = purchase_id
              AND p.business_id = ANY(public.get_user_business_ids())
        )
    );

-- ---------------------------------------------------------------------------
-- business_assets
-- SELECT: any business member
-- ALL write: Owner or Admin only
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS pol_business_assets_select ON public.business_assets;
CREATE POLICY pol_business_assets_select ON public.business_assets
    FOR SELECT USING (business_id = ANY(public.get_user_business_ids()));

DROP POLICY IF EXISTS pol_business_assets_write ON public.business_assets;
CREATE POLICY pol_business_assets_write ON public.business_assets
    FOR ALL USING (public.is_owner_or_admin(business_id));

-- ---------------------------------------------------------------------------
-- storage_files
-- ALL: any business member
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS pol_storage_files_all ON public.storage_files;
CREATE POLICY pol_storage_files_all ON public.storage_files
    FOR ALL USING (business_id = ANY(public.get_user_business_ids()));

-- ---------------------------------------------------------------------------
-- ai_insights
-- SELECT: any business member
-- ALL write: Owner or Admin only (AI generates, not staff)
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS pol_ai_insights_select ON public.ai_insights;
CREATE POLICY pol_ai_insights_select ON public.ai_insights
    FOR SELECT USING (business_id = ANY(public.get_user_business_ids()));

DROP POLICY IF EXISTS pol_ai_insights_write ON public.ai_insights;
CREATE POLICY pol_ai_insights_write ON public.ai_insights
    FOR ALL USING (public.is_owner_or_admin(business_id));

-- ---------------------------------------------------------------------------
-- payments
-- ALL: any business member
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS pol_payments_all ON public.payments;
CREATE POLICY pol_payments_all ON public.payments
    FOR ALL USING (business_id = ANY(public.get_user_business_ids()));

-- ---------------------------------------------------------------------------
-- backup_history_logs
-- SELECT only: any business member (logs are read-only)
-- INSERT: SECURITY DEFINER functions only (no client INSERT needed)
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS pol_backup_logs_select ON public.backup_history_logs;
-- CREATE POLICY pol_backup_logs_select ON public.backup_history_logs
--     FOR SELECT USING (business_id = ANY(public.get_user_business_ids()));

ALTER TABLE backup_history_logs ENABLE ROW LEVEL SECURITY;
-- Allow all operations for authenticated users
CREATE POLICY "backup_logs_all" ON backup_history_logs
FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ---------------------------------------------------------------------------
-- scheduled_reports
-- SELECT: any business member
-- ALL write: Owner or Admin only
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS pol_sched_reports_select ON public.scheduled_reports;
CREATE POLICY pol_sched_reports_select ON public.scheduled_reports
    FOR SELECT USING (business_id = ANY(public.get_user_business_ids()));

DROP POLICY IF EXISTS pol_sched_reports_write ON public.scheduled_reports;
CREATE POLICY pol_sched_reports_write ON public.scheduled_reports
    FOR ALL USING (public.is_owner_or_admin(business_id));

-- ---------------------------------------------------------------------------
-- dashboard_analytics_snapshots
-- SELECT only: any business member (populated by server-side RPC)
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS pol_dash_snap_select ON public.dashboard_analytics_snapshots;
CREATE POLICY pol_dash_snap_select ON public.dashboard_analytics_snapshots
    FOR SELECT USING (business_id = ANY(public.get_user_business_ids()));

-- ---------------------------------------------------------------------------
-- complaints
-- ALL: any business member
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS pol_complaints_all ON public.complaints;
CREATE POLICY pol_complaints_all ON public.complaints
    FOR ALL USING (business_id = ANY(public.get_user_business_ids()));

-- ---------------------------------------------------------------------------
-- complaint_replies
-- ALL: any member of the business the complaint belongs to
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS pol_complaint_replies_all ON public.complaint_replies;
CREATE POLICY pol_complaint_replies_all ON public.complaint_replies
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM public.complaints c
            WHERE c.id = complaint_id
              AND c.business_id = ANY(public.get_user_business_ids())
        )
    );

-- ---------------------------------------------------------------------------
-- audit_logs
-- SELECT and INSERT only: append-only security audit trail
-- No UPDATE or DELETE policies — data is immutable once written
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS pol_audit_logs_select ON public.audit_logs;
CREATE POLICY pol_audit_logs_select ON public.audit_logs
    FOR SELECT USING (business_id = ANY(public.get_user_business_ids()));

DROP POLICY IF EXISTS pol_audit_logs_insert ON public.audit_logs;
CREATE POLICY pol_audit_logs_insert ON public.audit_logs
    FOR INSERT WITH CHECK (business_id = ANY(public.get_user_business_ids()));

-- ---------------------------------------------------------------------------
-- offline_sync_queue
-- ALL: any business member
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS pol_sync_queue_all ON public.offline_sync_queue;
CREATE POLICY pol_sync_queue_all ON public.offline_sync_queue
    FOR ALL USING (business_id = ANY(public.get_user_business_ids()));
