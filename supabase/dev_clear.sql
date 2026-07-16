-- =============================================================================
-- dev_clear.sql
-- KayKay's Milk — Development Database Data Clearing Script
-- WARNING: This script WIPES ALL USER DATA from the tables but keeps the schema intact.
-- Only run this in development/staging environments. NEVER in production.
-- =============================================================================

BEGIN;

-- Bypass trigger/constraint checks during clearing to prevent dependency deadlocks
SET LOCAL session_replication_role = replica;

-- =============================================================================
-- STEP 1: WIPE STORAGE OBJECTS (Keep buckets intact, only clear uploaded files)
-- =============================================================================
DELETE FROM storage.objects;

-- =============================================================================
-- STEP 2: WIPE ALL PUBLIC TABLES (Defined in migrations)
-- =============================================================================

-- Extra Modules & New Integrations
DELETE FROM public.wallet_transactions;
DELETE FROM public.payments;
DELETE FROM public.ai_insights;
DELETE FROM public.storage_files;
DELETE FROM public.business_assets;
DELETE FROM public.purchase_items;
DELETE FROM public.purchases;
DELETE FROM public.production_batches;
DELETE FROM public.recipe_ingredients;
DELETE FROM public.recipes;

-- Analytics, Logging & Queues
DELETE FROM public.offline_sync_queue;
DELETE FROM public.audit_logs;
DELETE FROM public.complaint_replies;
DELETE FROM public.complaints;
DELETE FROM public.dashboard_analytics_snapshots;
DELETE FROM public.scheduled_reports;
DELETE FROM public.backup_history_logs;
DELETE FROM public.google_sheets_backup;

-- Settings
DELETE FROM public.ai_settings;
DELETE FROM public.sms_settings;
DELETE FROM public.printer_settings;
DELETE FROM public.receipt_verifications;
DELETE FROM public.receipt_settings;
DELETE FROM public.integration_configurations;
DELETE FROM public.notification_preferences;
DELETE FROM public.notifications;
DELETE FROM public.mpesa_transactions;

-- Operations
DELETE FROM public.suppliers;
DELETE FROM public.expenses;
DELETE FROM public.expense_categories;
DELETE FROM public.inventory_adjustments;
DELETE FROM public.schedules;
DELETE FROM public.shifts;

-- Core Business & Identity
DELETE FROM public.credit_payments;
DELETE FROM public.transaction_items;
DELETE FROM public.transactions;
DELETE FROM public.debt_payments;
DELETE FROM public.customer_ledger;
DELETE FROM public.customers;
DELETE FROM public.products;
DELETE FROM public.employees;
DELETE FROM public.role_permissions;
DELETE FROM public.invitations;
DELETE FROM public.business_memberships;
DELETE FROM public.device_fcm_tokens;
DELETE FROM public.otps;
DELETE FROM public.users;
DELETE FROM public.branches;
DELETE FROM public.businesses;

-- =============================================================================
-- STEP 3: WIPE AUTH USERS (Cascades to identities, refresh_tokens, etc.)
-- =============================================================================
DELETE FROM auth.refresh_tokens;
DELETE FROM auth.mfa_factors;
DELETE FROM auth.identities;
DELETE FROM auth.users;

-- Restore normal trigger/constraint behavior before committing
SET LOCAL session_replication_role = DEFAULT;

COMMIT;
