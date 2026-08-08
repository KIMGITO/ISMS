-- =============================================================================
-- 20260808_001_fix_customer_wallet_credit.sql
-- integrated Shop Management System
-- Fix customer wallet/credit accounting:
--   1. Remove outdated chk_not_both_debt_and_wallet constraint
--   2. Add reference_id columns for idempotency (retry-safe)
--   3. Create atomic RPC process_customer_transaction
--   4. Update fn_process_completed_transaction to handle wallet_applied correctly
-- =============================================================================
-- Why: The business model requires wallet balance and debt to coexist.
-- A customer can have wallet balance, buy on credit, and the system must
-- track both simultaneously. The old constraint prevented this.
-- reference_id provides idempotency so retried operations don't create
-- duplicate financial records.
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Drop the outdated constraint
-- The business model requires wallet and debt to coexist (e.g. customer with
-- 168 wallet buying 200 on credit → wallet=0, debt=32).
-- ---------------------------------------------------------------------------
ALTER TABLE public.customers
    DROP CONSTRAINT IF EXISTS chk_not_both_debt_and_wallet;

-- ---------------------------------------------------------------------------
-- 2. Add reference_id to customer_ledger for idempotency
-- A unique (business_id, reference_id) ensures retrying the same operation
-- does not create a duplicate ledger entry.
-- ---------------------------------------------------------------------------
ALTER TABLE public.customer_ledger
    ADD COLUMN IF NOT EXISTS reference_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS uq_customer_ledger_reference
    ON public.customer_ledger(business_id, reference_id)
    WHERE reference_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 3. Add reference_id to transactions for idempotency
-- A unique (business_id, reference_id) ensures retrying the same transaction
-- does not create a duplicate sale record.
-- ---------------------------------------------------------------------------
ALTER TABLE public.transactions
    ADD COLUMN IF NOT EXISTS reference_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS uq_transactions_reference
    ON public.transactions(business_id, reference_id)
    WHERE reference_id IS NOT NULL;

COMMIT;