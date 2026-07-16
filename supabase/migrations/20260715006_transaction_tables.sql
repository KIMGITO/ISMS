-- =============================================================================
-- 20260715_006_transaction_tables.sql
-- KayKay's Milk Business Management System
-- Transaction Tables: transactions, transaction_items, credit_payments,
--                     wallet_transactions + customer_ledger FK
-- =============================================================================
-- Why: Transactions are the core sales records. transaction_items are the
-- line items within a transaction. credit_payments tracks credit/debt created
-- at checkout. wallet_transactions is the immutable wallet movement log.
-- This migration also completes the customer_ledger.transaction_id FK that
-- could not be set in migration 005 (forward reference to transactions).
-- The trigger fn_process_completed_transaction runs AFTER INSERT on transactions
-- to atomically handle loyalty points, shifts, debt, and wallet. That trigger
-- is defined in migration 013 (after functions in 012).
-- Dependencies: 001, 002, 003, 004, 005
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- TABLE: transactions
-- POS sale headers. One record per checkout operation. line items are in
-- transaction_items. Soft-deletes for refund/void without data loss.
-- amount_paid + wallet_applied + any_credit = final_total at checkout.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.transactions (
    id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id      UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    total            NUMERIC(14,2) NOT NULL DEFAULT 0.00,
    discount         NUMERIC(14,2) NOT NULL DEFAULT 0.00 CHECK (discount >= 0),
    tax              NUMERIC(14,2) NOT NULL DEFAULT 0.00 CHECK (tax >= 0),
    final_total      NUMERIC(14,2) NOT NULL DEFAULT 0.00,
    amount_paid      NUMERIC(14,2) NOT NULL DEFAULT 0.00 CHECK (amount_paid >= 0),
    wallet_applied   NUMERIC(14,2) NOT NULL DEFAULT 0.00 CHECK (wallet_applied >= 0),
    payment_method   public.payment_method NOT NULL DEFAULT 'Cash',
    customer_id      UUID REFERENCES public.customers(id) ON DELETE SET NULL,
    customer_name    TEXT,
    staff_id         UUID REFERENCES public.employees(id) ON DELETE SET NULL,
    staff_name       TEXT NOT NULL,
    status           public.transaction_status NOT NULL DEFAULT 'Synced',
    timestamp        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    note             TEXT,
    is_delivery      BOOLEAN NOT NULL DEFAULT FALSE,
    delivery_fee     NUMERIC(14,2) NOT NULL DEFAULT 0.00 CHECK (delivery_fee >= 0),
    rider_name       TEXT,
    version          INTEGER NOT NULL DEFAULT 1,
    sync_status      public.sync_status NOT NULL DEFAULT 'synced',
    last_modified_by TEXT NOT NULL DEFAULT 'system',
    deleted_at       TIMESTAMPTZ,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- TABLE: transaction_items
-- Individual line items within a transaction. ON DELETE RESTRICT on product_id
-- prevents product deletion when sales records exist (the hard-delete guard
-- trigger in migration 013 also catches this and converts to soft-delete).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.transaction_items (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    transaction_id      UUID NOT NULL REFERENCES public.transactions(id) ON DELETE CASCADE,
    product_id          UUID NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
    product_name        TEXT NOT NULL,
    unit_price          NUMERIC(14,2) NOT NULL DEFAULT 0.00 CHECK (unit_price >= 0),
    quantity            NUMERIC(14,3) NOT NULL DEFAULT 1.000 CHECK (quantity > 0),
    discount_percentage NUMERIC(5,2) NOT NULL DEFAULT 0.00
                            CHECK (discount_percentage >= 0 AND discount_percentage <= 100),
    line_total          NUMERIC(14,2) NOT NULL DEFAULT 0.00,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
    -- No updated_at or deleted_at: line items are immutable once committed
);

ALTER TABLE public.transaction_items ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- TABLE: credit_payments
-- Debt records created when a customer purchases on credit. Tracks how much
-- is owed vs. paid. The generated `balance` column avoids inconsistency.
-- Uses FIFO settlement via the settle_customer_debt_fifo() SQL function.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.credit_payments (
    id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id    UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    transaction_id UUID REFERENCES public.transactions(id) ON DELETE SET NULL,
    customer_id    UUID NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
    customer_name  TEXT NOT NULL,
    amount_owed    NUMERIC(14,2) NOT NULL DEFAULT 0.00 CHECK (amount_owed >= 0),
    amount_paid    NUMERIC(14,2) NOT NULL DEFAULT 0.00 CHECK (amount_paid >= 0),
    balance        NUMERIC(14,2) GENERATED ALWAYS AS (amount_owed - amount_paid) STORED,
    status         public.credit_status NOT NULL DEFAULT 'Open',
    due_date       TIMESTAMPTZ,
    settled_at     TIMESTAMPTZ,
    note           TEXT,
    recorded_by    TEXT,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.credit_payments ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- TABLE: wallet_transactions
-- Immutable log of every wallet debit and credit for a customer.
-- Append-only (no UPDATE/DELETE policies in migration 014).
-- balance_before and balance_after provide full audit trail.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.wallet_transactions (
    id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id    UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    customer_id    UUID NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
    amount         NUMERIC(14,2) NOT NULL,             -- Negative = debit, positive = credit
    balance_before NUMERIC(14,2) NOT NULL,
    balance_after  NUMERIC(14,2) NOT NULL,
    reason         TEXT NOT NULL,
    transaction_id UUID REFERENCES public.transactions(id) ON DELETE SET NULL,
    recorded_by    TEXT,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
    -- No updated_at: append-only ledger
);

ALTER TABLE public.wallet_transactions ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- Complete the customer_ledger FK that could not be set in migration 005
-- because transactions table did not yet exist.
-- ---------------------------------------------------------------------------

-- 1. Explicitly drop the view before altering the underlying column structure
DROP VIEW IF EXISTS public.v_customer_ledger_detail CASCADE;

-- 2. Alter the text string column type directly into a relational UUID
ALTER TABLE public.customer_ledger 
    ALTER COLUMN transaction_id TYPE UUID USING transaction_id::uuid;

-- 3. Safely apply the Foreign Key constraint (drop first to prevent duplicate errors)
ALTER TABLE public.customer_ledger
    DROP CONSTRAINT IF EXISTS fk_customer_ledger_transaction;

ALTER TABLE public.customer_ledger
    ADD CONSTRAINT fk_customer_ledger_transaction
    FOREIGN KEY (transaction_id)
    REFERENCES public.transactions(id)
    ON DELETE SET NULL;

-- 4. Reconstruct the secure customer ledger detail view
CREATE OR REPLACE VIEW public.v_customer_ledger_detail WITH (security_invoker = true) AS
SELECT
    cl.id,
    cl.business_id,
    cl.customer_id,
    c.name        AS customer_name,
    cl.type,
    cl.amount,
    cl.wallet_balance,
    cl.debt_balance,
    cl.recorded_by,
    cl.note,
    cl.transaction_id,
    t.final_total AS transaction_total,
    t.payment_method,
    cl.created_at
FROM public.customer_ledger cl
JOIN public.customers c ON cl.customer_id = c.id
LEFT JOIN public.transactions t ON cl.transaction_id = t.id;

-- 5. Force API schema compilation update
NOTIFY pgrst, 'reload schema';

COMMIT;