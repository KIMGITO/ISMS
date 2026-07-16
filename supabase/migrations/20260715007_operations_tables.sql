-- =============================================================================
-- 20260715_007_operations_tables.sql
-- KayKay's Milk Business Management System
-- Operations Tables: shifts, schedules, inventory_adjustments,
--                    expense_categories, expenses, suppliers
--                    + employees.active_shift_id FK backfill
-- =============================================================================
-- Why: Operational tables used during daily business workflow. Shifts track
-- live punch-in/out sessions. Schedules track planned future shifts (separate
-- concept). Inventory adjustments log stock changes. Expense categories and
-- expenses track cost of operations. Suppliers track raw material sources.
-- This migration also adds the employees.active_shift_id FK back-reference
-- that could not be created in migration 004 (shifts did not exist yet).
-- Dependencies: 001, 002, 003, 004, 005, 006
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- TABLE: shifts
-- Live punch-in/punch-out records. One active shift per employee at a time.
-- The trigger fn_process_completed_transaction updates sales_count/sales_total
-- as transactions are inserted.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.shifts (
    id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id      UUID REFERENCES public.businesses(id) ON DELETE CASCADE,
    employee_id      UUID NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
    start_time       TIMESTAMPTZ NOT NULL,
    end_time         TIMESTAMPTZ,
    sales_count      INTEGER NOT NULL DEFAULT 0 CHECK (sales_count >= 0),
    sales_total      NUMERIC(14,2) NOT NULL DEFAULT 0.00 CHECK (sales_total >= 0),
    status           public.shift_status NOT NULL DEFAULT 'Active',
    version          INTEGER NOT NULL DEFAULT 1,
    sync_status      public.sync_status NOT NULL DEFAULT 'synced',
    last_modified_by TEXT NOT NULL DEFAULT 'system',
    deleted_at       TIMESTAMPTZ,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.shifts ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- Backfill: Add the employees.active_shift_id FK now that shifts table exists.
-- This resolves the circular dependency: employees → shifts → employees.
-- ---------------------------------------------------------------------------
-- ✅ FIX: Drop the foreign key first if it already exists from a previous run
ALTER TABLE public.employees
    DROP CONSTRAINT IF EXISTS fk_employees_active_shift;

ALTER TABLE public.employees
    ADD CONSTRAINT fk_employees_active_shift
    FOREIGN KEY (active_shift_id)
    REFERENCES public.shifts(id)
    ON DELETE SET NULL;

-- ---------------------------------------------------------------------------
-- TABLE: schedules
-- Planned future shift scheduling (separate from live shifts). Supports
-- repeating schedules (None / Daily / Weekly). Soft-deleted via deleted_at.
-- Real-time subscription is added in migration 015.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.schedules (
    id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id   UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    employee_id   UUID NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
    title         TEXT NOT NULL DEFAULT '',
    notes         TEXT,
    date          DATE NOT NULL,           -- Calendar date of the scheduled shift
    start_time    TIME NOT NULL,           -- e.g. '09:00'
    end_time      TIME,                    -- e.g. '17:00'
    repeat        public.schedule_repeat NOT NULL DEFAULT 'None',
    color         TEXT NOT NULL DEFAULT '#f59e0b',
    reminder_sent BOOLEAN NOT NULL DEFAULT FALSE,
    created_by    UUID REFERENCES public.employees(id) ON DELETE SET NULL,
    deleted_at    TIMESTAMPTZ,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.schedules ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- TABLE: inventory_adjustments
-- Log of every manual stock change (restock, damage, reconciliation).
-- Also receives automatic entries when products are sold (via trigger
-- fn_process_transaction_item in migration 013).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.inventory_adjustments (
    id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id       UUID REFERENCES public.businesses(id) ON DELETE CASCADE,
    product_id        UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
    product_name      TEXT NOT NULL,
    type              public.inventory_adjustment_type NOT NULL,
    quantity_adjusted NUMERIC(14,3) NOT NULL,
    previous_stock    NUMERIC(14,3) NOT NULL CHECK (previous_stock >= 0),
    new_stock         NUMERIC(14,3) NOT NULL CHECK (new_stock >= 0),
    timestamp         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    reason            TEXT NOT NULL,
    staff_name        TEXT NOT NULL,
    version           INTEGER NOT NULL DEFAULT 1,
    sync_status       public.sync_status NOT NULL DEFAULT 'synced',
    last_modified_by  TEXT NOT NULL DEFAULT 'system',
    deleted_at        TIMESTAMPTZ,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.inventory_adjustments ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- TABLE: expense_categories
-- Named cost categories (Fuel, Supplies, Salaries etc.) per business.
-- Can be enabled, disabled, or archived. The UI manages these via
-- ExpenseCategoryRepository.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.expense_categories (
    id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id      UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    name             TEXT NOT NULL CHECK (length(trim(name)) > 0),
    status           public.expense_category_status NOT NULL DEFAULT 'Enabled',
    is_custom        BOOLEAN NOT NULL DEFAULT FALSE,
    version          INTEGER NOT NULL DEFAULT 1,
    sync_status      public.sync_status NOT NULL DEFAULT 'synced',
    last_modified_by TEXT NOT NULL DEFAULT 'system',
    deleted_at       TIMESTAMPTZ,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (business_id, name)
);

ALTER TABLE public.expense_categories ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- TABLE: expenses
-- Individual cost/expense records logged by staff. Linked to a category.
-- category column stores the category name denormalized for fast display
-- (avoids joins when rendering expense reports).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.expenses (
    id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id      UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    category_id      UUID REFERENCES public.expense_categories(id) ON DELETE SET NULL,
    category         TEXT NOT NULL,
    amount           NUMERIC(14,2) NOT NULL DEFAULT 0.00 CHECK (amount >= 0),
    description      TEXT,
    date             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    staff_name       TEXT NOT NULL,
    receipt_ref      TEXT,
    version          INTEGER NOT NULL DEFAULT 1,
    sync_status      public.sync_status NOT NULL DEFAULT 'synced',
    last_modified_by TEXT NOT NULL DEFAULT 'system',
    deleted_at       TIMESTAMPTZ,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.expenses ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- TABLE: suppliers
-- Raw material suppliers for the dairy operation (e.g. farm milk suppliers).
-- Linked to the products they supply via the product_supplied text field.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.suppliers (
    id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id      UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    name             TEXT NOT NULL CHECK (length(trim(name)) > 0),
    phone            TEXT NOT NULL,
    email            TEXT,
    company          TEXT,
    product_supplied TEXT NOT NULL,
    notes            TEXT,
    version          INTEGER NOT NULL DEFAULT 1,
    sync_status      public.sync_status NOT NULL DEFAULT 'synced',
    last_modified_by TEXT NOT NULL DEFAULT 'system',
    deleted_at       TIMESTAMPTZ,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.suppliers ENABLE ROW LEVEL SECURITY;

COMMIT;