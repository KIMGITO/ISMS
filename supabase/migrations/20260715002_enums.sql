-- =============================================================================
-- 20260715_002_enums.sql
-- KayKay's Milk Business Management System
-- Custom Enum Types
-- =============================================================================
-- Why: All enum types must exist before any table column references them.
-- Using DO blocks with EXCEPTION guards ensures idempotent re-application.
-- Dependencies: 001_extensions.sql
-- =============================================================================

-- Employee roles — covers all staff levels including extra module roles
DO $$ BEGIN
  CREATE TYPE public.employee_role AS ENUM (
    'Owner',
    'Admin',
    'Administrator',
    'Manager',
    'Cashier',
    'Inventory Manager',
    'Inventory Staff',
    'Sales Staff',
    'Production Staff',
    'Rider',
    'Staff',
    'Viewer'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Business membership lifecycle
DO $$ BEGIN
  CREATE TYPE public.membership_status AS ENUM ('Active', 'Pending', 'Suspended');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Staff invitation lifecycle
DO $$ BEGIN
  CREATE TYPE public.invitation_status AS ENUM ('Pending', 'Accepted', 'Expired', 'Revoked');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Customer loyalty tier
DO $$ BEGIN
  CREATE TYPE public.customer_tier AS ENUM ('Bronze', 'Silver', 'Gold');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- All supported payment methods in the POS
DO $$ BEGIN
  CREATE TYPE public.payment_method AS ENUM (
    'Cash',
    'Card',
    'Mobile_Wallet',
    'M-Pesa',
    'Credit_Debt',
    'Bank',
    'Credit',
    'Other'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Transaction sync state
DO $$ BEGIN
  CREATE TYPE public.transaction_status AS ENUM ('Synced', 'Offline_Pending');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Inventory adjustment categories
DO $$ BEGIN
  CREATE TYPE public.inventory_adjustment_type AS ENUM ('Restock', 'Damage', 'Reconciliation');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Staff shift state
DO $$ BEGIN
  CREATE TYPE public.shift_status AS ENUM ('Active', 'Closed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Planned schedule recurrence
DO $$ BEGIN
  CREATE TYPE public.schedule_repeat AS ENUM ('None', 'Daily', 'Weekly', 'Monthly');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- M-Pesa STK push result
DO $$ BEGIN
  CREATE TYPE public.mpesa_status AS ENUM ('Pending', 'Completed', 'Failed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Generic online/offline sync flag
DO $$ BEGIN
  CREATE TYPE public.sync_status AS ENUM ('synced', 'pending');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Expense category lifecycle
DO $$ BEGIN
  CREATE TYPE public.expense_category_status AS ENUM ('Enabled', 'Disabled', 'Archived');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Notification urgency
DO $$ BEGIN
  CREATE TYPE public.notification_priority AS ENUM ('low', 'medium', 'high', 'critical');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Notification delivery outcome
DO $$ BEGIN
  CREATE TYPE public.notification_delivery_status AS ENUM ('pending', 'delivered', 'failed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Notification action behavior
DO $$ BEGIN
  CREATE TYPE public.notification_action_type AS ENUM ('navigate', 'url', 'none');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Scheduled report frequency
DO $$ BEGIN
  CREATE TYPE public.report_schedule_frequency AS ENUM ('daily', 'weekly', 'monthly');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Backup run outcome
DO $$ BEGIN
  CREATE TYPE public.backup_status AS ENUM ('success', 'failed', 'running');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Customer debt/credit lifecycle
DO $$ BEGIN
  CREATE TYPE public.credit_status AS ENUM (
    'Open',
    'Partial',
    'Settled',
    'Overdue',
    'Written_Off'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Complaint sentiment classification
DO $$ BEGIN
  CREATE TYPE public.sentiment AS ENUM ('positive', 'neutral', 'negative');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
