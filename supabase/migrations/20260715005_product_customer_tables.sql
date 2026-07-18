-- =============================================================================
-- 20260715_005_product_customer_tables.sql
-- KayKay's Milk Business Management System
-- Product & Customer Tables: products, customers, customer_ledger, debt_payments
-- =============================================================================
-- Why: Products are the saleable items. Customers are loyalty members.
-- The customer_ledger is an immutable audit trail for all wallet and debt
-- movements. debt_payments tracks repayments against outstanding debts.
-- NOTE: customer_ledger.transaction_id FK to transactions is added via
-- ALTER TABLE in migration 006 (after transactions table is created) to
-- avoid forward-reference dependency issues.
-- Dependencies: 001, 002, 003, 004
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- TABLE: products
-- Saleable items (milk, yogurt, butter etc.) per business.
-- Soft-deletes via deleted_at protect referential integrity — products with
-- sales history cannot be hard-deleted (enforced by trigger in migration 013).
-- The SKU is business-scoped: UNIQUE(business_id, sku).
-- Stock and min_stock use NUMERIC(14,3) to support fractional litre quantities.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.products (
    id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id      UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    name             TEXT NOT NULL CHECK (length(trim(name)) > 0),
    category         TEXT NOT NULL,
    price            NUMERIC(14,2) NOT NULL DEFAULT 0.00 CHECK (price >= 0),
    cost             NUMERIC(14,2) NOT NULL DEFAULT 0.00 CHECK (cost >= 0),
    image            TEXT,
    stock            NUMERIC(14,3) NOT NULL DEFAULT 0.000 CHECK (stock >= 0),
    min_stock        NUMERIC(14,3) NOT NULL DEFAULT 0.000 CHECK (min_stock >= 0),
    unit             TEXT NOT NULL DEFAULT 'Litres',
    sku              TEXT,
    description      TEXT,
    perishable       BOOLEAN NOT NULL DEFAULT TRUE,
    expiry_days      INTEGER CHECK (expiry_days IS NULL OR expiry_days > 0),
    version          INTEGER NOT NULL DEFAULT 1,
    sync_status      public.sync_status NOT NULL DEFAULT 'synced',
    last_modified_by TEXT NOT NULL DEFAULT 'system',
    deleted_at       TIMESTAMPTZ,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (business_id, sku)
);

ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- TABLE: customers
-- Loyalty club members. Tracks points, tier, debt_balance, and wallet_balance.
-- Business rule: a customer cannot simultaneously hold positive wallet balance
-- AND outstanding debt — they are mutually exclusive financial positions.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.customers (
    id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id      UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    name             TEXT NOT NULL CHECK (length(trim(name)) > 0),
    phone            TEXT NOT NULL,
    email            TEXT,
    loyalty_points   INTEGER NOT NULL DEFAULT 0 CHECK (loyalty_points >= 0),
    join_date        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    tier             public.customer_tier NOT NULL DEFAULT 'Bronze',
    purchases_count  INTEGER NOT NULL DEFAULT 0 CHECK (purchases_count >= 0),
    debt_balance     NUMERIC(14,2) NOT NULL DEFAULT 0.00 CHECK (debt_balance >= 0),
    wallet_balance   NUMERIC(14,2) NOT NULL DEFAULT 0.00 CHECK (wallet_balance >= 0),
    description      TEXT,
    version          INTEGER NOT NULL DEFAULT 1,
    sync_status      public.sync_status NOT NULL DEFAULT 'synced',
    last_modified_by TEXT NOT NULL DEFAULT 'system',
    deleted_at       TIMESTAMPTZ,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    -- Business rule: wallet and debt are mutually exclusive balances
    CONSTRAINT chk_not_both_debt_and_wallet CHECK (NOT (debt_balance > 0 AND wallet_balance > 0))
);

ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- TABLE: customer_ledger
-- Immutable, append-only double-entry ledger for all financial movements on
-- a customer account. transaction_id is stored as UUID; the FK constraint to
-- transactions(id) is added in migration 006 once that table is created.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.customer_ledger (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id    UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    customer_id    UUID NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
    type           TEXT NOT NULL CHECK (type IN (
                       'wallet_topup', 'wallet_usage', 'debt_creation',
                       'debt_payment', 'debt_adjustment', 'refund'
                   )),
    amount         NUMERIC(14,2) NOT NULL DEFAULT 0.00,
    wallet_balance NUMERIC(14,2) NOT NULL DEFAULT 0.00,
    debt_balance   NUMERIC(14,2) NOT NULL DEFAULT 0.00,
    recorded_by    TEXT NOT NULL,
    note           TEXT,
    transaction_id UUID,                  -- FK to transactions added in migration 006
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
    -- No updated_at: this table is append-only (ledger integrity)
);

ALTER TABLE public.customer_ledger ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- TABLE: debt_payments
-- Records each repayment instalment a customer makes against their outstanding
-- debt. Separate from customer_ledger to allow easy querying of payment history.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.debt_payments (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id    UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    customer_id    UUID NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
    amount_paid    NUMERIC(14,2) NOT NULL DEFAULT 0.00 CHECK (amount_paid > 0),
    remaining_debt NUMERIC(14,2) NOT NULL DEFAULT 0.00 CHECK (remaining_debt >= 0),
    payment_method TEXT NOT NULL CHECK (payment_method IN ('Cash', 'M-Pesa')),
    recorded_by    TEXT NOT NULL,
    note           TEXT,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
    -- No updated_at: payment records are immutable once created
);

ALTER TABLE public.debt_payments ENABLE ROW LEVEL SECURITY;

COMMIT;
