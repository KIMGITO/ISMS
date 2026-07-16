-- =============================================================================
-- dev_reset.sql
-- KayKay's Milk — Development Database Reset Script
-- WARNING: This script DESTROYS all user data and rebuilds from scratch.
-- Only run this in development/staging environments. NEVER in production.
-- =============================================================================

BEGIN;

-- Bypass trigger/constraint checks during dropping to prevent dependency deadlocks
SET LOCAL session_replication_role = replica;

-- =============================================================================
-- STEP 1: DROP ALL PUBLICATIONS
-- =============================================================================
DROP PUBLICATION IF EXISTS supabase_realtime;

-- =============================================================================
-- STEP 2: DROP ALL VIEWS
-- =============================================================================
DROP VIEW IF EXISTS public.low_stock_products CASCADE;
DROP VIEW IF EXISTS public.active_credit_debts CASCADE;
DROP VIEW IF EXISTS public.expense_category_summary CASCADE;
DROP VIEW IF EXISTS public.product_sales_ranking CASCADE;
DROP VIEW IF EXISTS public.business_statistics CASCADE;

-- =============================================================================
-- STEP 3: DROP ALL TABLES (in dependency order — children before parents)
-- =============================================================================
DROP TABLE IF EXISTS public.offline_sync_queue             CASCADE;
DROP TABLE IF EXISTS public.audit_logs                     CASCADE;
DROP TABLE IF EXISTS public.complaint_replies              CASCADE;
DROP TABLE IF EXISTS public.complaints                     CASCADE;
DROP TABLE IF EXISTS public.dashboard_analytics_snapshots  CASCADE;
DROP TABLE IF EXISTS public.scheduled_reports              CASCADE;
DROP TABLE IF EXISTS public.backup_history_logs            CASCADE;
DROP TABLE IF EXISTS public.google_sheets_backup           CASCADE;
DROP TABLE IF EXISTS public.ai_settings                    CASCADE;
DROP TABLE IF EXISTS public.sms_settings                   CASCADE;
DROP TABLE IF EXISTS public.printer_settings               CASCADE;
DROP TABLE IF EXISTS public.receipt_verifications          CASCADE;
DROP TABLE IF EXISTS public.receipt_settings               CASCADE;
DROP TABLE IF EXISTS public.mpesa_transactions             CASCADE;
DROP TABLE IF EXISTS public.notification_preferences       CASCADE;
DROP TABLE IF EXISTS public.notifications                  CASCADE;
DROP TABLE IF EXISTS public.suppliers                      CASCADE;
DROP TABLE IF EXISTS public.expenses                       CASCADE;
DROP TABLE IF EXISTS public.expense_categories             CASCADE;
DROP TABLE IF EXISTS public.inventory_adjustments          CASCADE;
DROP TABLE IF EXISTS public.shifts                         CASCADE;
DROP TABLE IF EXISTS public.credit_payments                CASCADE;
DROP TABLE IF EXISTS public.transaction_items              CASCADE;
DROP TABLE IF EXISTS public.transactions                   CASCADE;
DROP TABLE IF EXISTS public.customers                      CASCADE;
DROP TABLE IF EXISTS public.products                       CASCADE;
DROP TABLE IF EXISTS public.employees                      CASCADE;
DROP TABLE IF EXISTS public.role_permissions               CASCADE;
DROP TABLE IF EXISTS public.invitations                    CASCADE;
DROP TABLE IF EXISTS public.business_memberships           CASCADE;
DROP TABLE IF EXISTS public.branches                       CASCADE;
DROP TABLE IF EXISTS public.otps                           CASCADE;
DROP TABLE IF EXISTS public.users                          CASCADE;
DROP TABLE IF EXISTS public.businesses                     CASCADE;

-- Legacy table names from old migrations (safe to drop if they exist)
DROP TABLE IF EXISTS public.inventory                      CASCADE;
DROP TABLE IF EXISTS public.orders                         CASCADE;
DROP TABLE IF EXISTS public.order_items                    CASCADE;
DROP TABLE IF EXISTS public.payment_logs                   CASCADE;
DROP TABLE IF EXISTS public.feedback                       CASCADE;
DROP TABLE IF EXISTS public.staff                          CASCADE;
DROP TABLE IF EXISTS public.settings                       CASCADE;

-- =============================================================================
-- STEP 4: DROP ALL FUNCTIONS AND PROCEDURES
-- =============================================================================
DROP FUNCTION IF EXISTS public.fn_set_updated_at() CASCADE;
DROP FUNCTION IF EXISTS public.fn_process_completed_transaction() CASCADE;
DROP FUNCTION IF EXISTS public.fn_check_low_stock() CASCADE;
DROP FUNCTION IF EXISTS public.fn_employee_sensitive_audit() CASCADE;
DROP FUNCTION IF EXISTS public.fn_expire_invitations() CASCADE;
DROP FUNCTION IF EXISTS public.fn_check_invitation_email() CASCADE;
DROP FUNCTION IF EXISTS public.log_mpesa_payment(TEXT,TEXT,TEXT,NUMERIC,TEXT,TEXT,UUID,JSONB) CASCADE;
DROP FUNCTION IF EXISTS public.adjust_stock_manually(UUID,UUID,TEXT,inventory_adjustment_type,NUMERIC,TEXT) CASCADE;
DROP FUNCTION IF EXISTS public.refresh_dashboard_snapshot(UUID,DATE,TEXT) CASCADE;
DROP FUNCTION IF EXISTS public.get_user_business_ids() CASCADE;
DROP FUNCTION IF EXISTS public.is_owner_or_admin(UUID) CASCADE;
DROP FUNCTION IF EXISTS public.calculate_customer_tier(INTEGER) CASCADE;

-- Onboarding & Token API Functions Fix
DROP FUNCTION IF EXISTS public.check_owner_exists() CASCADE;
DROP FUNCTION IF EXISTS public.get_invitation_by_token(TEXT) CASCADE;
DROP FUNCTION IF EXISTS public.accept_invitation_with_token(TEXT,UUID,TEXT,TEXT) CASCADE;
DROP FUNCTION IF EXISTS public.create_business_with_owner(TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT) CASCADE;
DROP FUNCTION IF EXISTS public.handle_new_user() CASCADE;

-- OTP Functions Fix
DROP FUNCTION IF EXISTS public.save_otp(TEXT,TEXT,TEXT) CASCADE;
DROP FUNCTION IF EXISTS public.verify_signup_otp(TEXT,TEXT) CASCADE;

-- =============================================================================
-- STEP 5: DROP ALL CUSTOM ENUMS
-- =============================================================================
DROP TYPE IF EXISTS public.employee_role                  CASCADE;
DROP TYPE IF EXISTS public.membership_status              CASCADE;
DROP TYPE IF EXISTS public.invitation_status              CASCADE;
DROP TYPE IF EXISTS public.customer_tier                  CASCADE;
DROP TYPE IF EXISTS public.payment_method                 CASCADE;
DROP TYPE IF EXISTS public.transaction_status             CASCADE;
DROP TYPE IF EXISTS public.inventory_adjustment_type      CASCADE;
DROP TYPE IF EXISTS public.shift_status                   CASCADE;
DROP TYPE IF EXISTS public.mpesa_status                   CASCADE;
DROP TYPE IF EXISTS public.sync_status                    CASCADE;
DROP TYPE IF EXISTS public.expense_category_status        CASCADE;
DROP TYPE IF EXISTS public.notification_priority          CASCADE;
DROP TYPE IF EXISTS public.notification_delivery_status   CASCADE;
DROP TYPE IF EXISTS public.notification_action_type       CASCADE;
DROP TYPE IF EXISTS public.report_schedule_frequency      CASCADE;
DROP TYPE IF EXISTS public.backup_status                  CASCADE;
DROP TYPE IF EXISTS public.credit_status                  CASCADE;
DROP TYPE IF EXISTS public.sentiment                      CASCADE;

-- =============================================================================
-- STEP 6: REMOVE STORAGE OBJECTS (Wipe metadata; physical files require API/CLI wipe)
-- =============================================================================
DELETE FROM storage.objects WHERE bucket_id IN ('product-images','business-logos','employee-avatars','receipt-exports','expense-receipts');
DELETE FROM storage.buckets  WHERE id       IN ('product-images','business-logos','employee-avatars','receipt-exports','expense-receipts');

INSERT INTO storage.buckets (id, name, public)
VALUES 
    ('business-logos', 'business-logos', true),
    ('employee-avatars', 'employee-avatars', true),
    ('product-images', 'product-images', true),
    ('receipt-exports', 'receipt-exports', false),
    ('expense-receipts', 'expense-receipts', false)
ON CONFLICT (id) DO NOTHING;

-- Restore normal trigger/constraint behavior before committing
SET LOCAL session_replication_role = DEFAULT;

COMMIT;