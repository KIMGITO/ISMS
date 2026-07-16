-- =============================================================================
-- 20260715_013_triggers.sql
-- KayKay's Milk Business Management System
-- Triggers
-- =============================================================================
-- Why: Triggers must be created AFTER the functions they call (migration 012)
-- and AFTER the tables they fire on (migrations 003–010). Each trigger is
-- preceded by a DROP IF EXISTS to ensure clean idempotent re-application.
-- Dependencies: 001–012
-- =============================================================================

-- ---------------------------------------------------------------------------
-- SECTION 1: updated_at triggers
-- Applied to all tables that have an updated_at column.
-- Uses the generic fn_set_updated_at() function.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
    tbl TEXT;
    tbls TEXT[] := ARRAY[
        'businesses',
        'branches',
        'users',
        'business_memberships',
        'invitations',
        'role_permissions',
        'employees',
        'products',
        'customers',
        'transactions',
        'credit_payments',
        'shifts',
        'schedules',
        'inventory_adjustments',
        'expense_categories',
        'expenses',
        'suppliers',
        'notifications',
        'notification_preferences',
        'mpesa_transactions',
        'receipt_settings',
        'printer_settings',
        'sms_settings',
        'ai_settings',
        'google_sheets_backup',
        'scheduled_reports',
        'complaints',
        'recipes',
        'production_batches',
        'purchases',
        'business_assets',
        'integration_configurations'
    ];
BEGIN
    FOREACH tbl IN ARRAY tbls LOOP
        EXECUTE format(
            'DROP TRIGGER IF EXISTS trg_%1$s_updated_at ON public.%1$I;
             CREATE TRIGGER trg_%1$s_updated_at
             BEFORE UPDATE ON public.%1$I
             FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();',
            tbl
        );
    END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- SECTION 2: Supabase Auth → public.users sync
-- Fires when a new user signs up via Supabase Auth. Creates the mirrored
-- public.users profile automatically.
-- ---------------------------------------------------------------------------
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ---------------------------------------------------------------------------
-- SECTION 3: Cascade delete public.users → auth.users
-- When a public.users record is deleted (e.g. account removal), also
-- removes the associated Supabase Auth account.
-- ---------------------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_on_public_user_deleted ON public.users;
CREATE TRIGGER trg_on_public_user_deleted
BEFORE DELETE ON public.users
FOR EACH ROW EXECUTE FUNCTION public.fn_on_public_user_deleted();

-- ---------------------------------------------------------------------------
-- SECTION 4: POS checkout — atomic transaction post-processing
-- Fires AFTER INSERT on transactions. Handles loyalty points, shift counters,
-- debt creation, wallet debits/credits, and audit logging atomically.
-- ---------------------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_process_completed_transaction ON public.transactions;
CREATE TRIGGER trg_process_completed_transaction
AFTER INSERT ON public.transactions
FOR EACH ROW EXECUTE FUNCTION public.fn_process_completed_transaction();

-- ---------------------------------------------------------------------------
-- SECTION 5: POS line items — stock deduction and inventory log
-- Fires AFTER INSERT on transaction_items. Decrements product.stock and
-- creates an inventory_adjustments record for each line item sold.
-- ---------------------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_process_transaction_item ON public.transaction_items;
CREATE TRIGGER trg_process_transaction_item
AFTER INSERT ON public.transaction_items
FOR EACH ROW EXECUTE FUNCTION public.fn_process_transaction_item();

-- ---------------------------------------------------------------------------
-- SECTION 6: Low stock notification
-- Fires AFTER UPDATE on products. Sends a notification when stock drops to
-- or below min_stock. Only fires on the threshold-crossing event.
-- ---------------------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_check_low_stock ON public.products;
CREATE TRIGGER trg_check_low_stock
AFTER UPDATE ON public.products
FOR EACH ROW EXECUTE FUNCTION public.fn_check_low_stock();

-- ---------------------------------------------------------------------------
-- SECTION 7: Employee sensitive field audit
-- Fires AFTER UPDATE on employees. Logs PIN and role changes to audit_logs.
-- ---------------------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_employee_sensitive_audit ON public.employees;
CREATE TRIGGER trg_employee_sensitive_audit
AFTER UPDATE ON public.employees
FOR EACH ROW EXECUTE FUNCTION public.fn_employee_sensitive_audit();

-- ---------------------------------------------------------------------------
-- SECTION 8: Product hard-delete guard
-- Fires BEFORE DELETE on products. If the product has sales history,
-- converts the DELETE to a soft-delete (deleted_at = NOW()) and cancels
-- the actual DELETE to protect transaction referential integrity.
-- ---------------------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_trap_product_hard_deletes ON public.products;
CREATE TRIGGER trg_trap_product_hard_deletes
BEFORE DELETE ON public.products
FOR EACH ROW EXECUTE FUNCTION public.fn_trap_product_hard_deletes();

-- ---------------------------------------------------------------------------
-- SECTION 9: Invitation email validation
-- Fires BEFORE INSERT OR UPDATE OF email on invitations. Raises an exception
-- if the email already belongs to a registered user or an active invitation.
-- ---------------------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_check_invitation_email ON public.invitations;
CREATE TRIGGER trg_check_invitation_email
BEFORE INSERT OR UPDATE OF email ON public.invitations
FOR EACH ROW EXECUTE FUNCTION public.fn_check_invitation_email();
