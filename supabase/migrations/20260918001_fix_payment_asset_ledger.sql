-- =============================================================================
-- 20260918001_fix_payment_asset_ledger.sql
-- Fixes missing columns in payment_asset_ledger and money_assets constraints
-- to resolve 400 (missing column) and 23502 (NOT NULL violation) errors.
-- =============================================================================

BEGIN;

-- 1. FIX money_assets constraints and types
-- Update check constraint to include Mobile_Wallet if it was missing
ALTER TABLE public.money_assets DROP CONSTRAINT IF EXISTS money_assets_method_check;
ALTER TABLE public.money_assets ADD CONSTRAINT money_assets_method_check 
    CHECK (method IN ('M-Pesa', 'Cash', 'Card', 'Bank', 'Other', 'Mobile_Wallet'));

-- 2. FIX payment_asset_ledger table
-- Add missing columns that were skipped by CREATE TABLE IF NOT EXISTS
DO $$ 
BEGIN
    -- Add asset_id (initially nullable for backfill)
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='payment_asset_ledger' AND column_name='asset_id') THEN
        ALTER TABLE public.payment_asset_ledger ADD COLUMN asset_id UUID REFERENCES public.money_assets(id) ON DELETE CASCADE;
    END IF;

    -- Add transaction_id
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='payment_asset_ledger' AND column_name='transaction_id') THEN
        ALTER TABLE public.payment_asset_ledger ADD COLUMN transaction_id UUID REFERENCES public.transactions(id) ON DELETE SET NULL;
    END IF;

    -- Add expense_id
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='payment_asset_ledger' AND column_name='expense_id') THEN
        ALTER TABLE public.payment_asset_ledger ADD COLUMN expense_id UUID REFERENCES public.expenses(id) ON DELETE SET NULL;
    END IF;

    -- Add type
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='payment_asset_ledger' AND column_name='type') THEN
        ALTER TABLE public.payment_asset_ledger ADD COLUMN type TEXT CHECK (type IN ('Credit', 'Debit'));
    END IF;

    -- Add description
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='payment_asset_ledger' AND column_name='description') THEN
        ALTER TABLE public.payment_asset_ledger ADD COLUMN description TEXT;
    END IF;

    -- Make payment_id nullable (as it is not used for all ledger entries now)
    ALTER TABLE public.payment_asset_ledger ALTER COLUMN payment_id DROP NOT NULL;
END $$;

-- 3. Backfill existing data
-- Set type based on amount (positive = Credit, negative = Debit)
UPDATE public.payment_asset_ledger SET type = 'Credit' WHERE type IS NULL AND amount > 0;
UPDATE public.payment_asset_ledger SET type = 'Debit' WHERE type IS NULL AND amount < 0;
UPDATE public.payment_asset_ledger SET type = 'Credit' WHERE type IS NULL;
ALTER TABLE public.payment_asset_ledger ALTER COLUMN type SET NOT NULL;

-- Backfill asset_id
DO $$ 
BEGIN
    -- Ensure all referenced methods exist in money_assets for each business to prevent 23502 errors
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='payment_asset_ledger' AND column_name='method') THEN
        INSERT INTO public.money_assets (business_id, method, balance)
        SELECT DISTINCT business_id, method, 0
        FROM public.payment_asset_ledger
        ON CONFLICT (business_id, method) DO NOTHING;

        -- Update asset_id
        UPDATE public.payment_asset_ledger pal
        SET asset_id = ma.id
        FROM public.money_assets ma
        WHERE pal.asset_id IS NULL 
          AND pal.business_id = ma.business_id 
          AND pal.method = ma.method;
    END IF;
END $$;

-- Update the amount check constraint
ALTER TABLE public.payment_asset_ledger DROP CONSTRAINT IF EXISTS payment_asset_ledger_amount_check;
ALTER TABLE public.payment_asset_ledger ADD CONSTRAINT payment_asset_ledger_amount_check CHECK (amount <> 0);

-- Final column enforcement
-- If there are still NULL asset_ids, we must handle them before setting NOT NULL
-- This fallback ensures no records are left orphaned during migration
UPDATE public.payment_asset_ledger SET asset_id = (
    SELECT id FROM public.money_assets ma 
    WHERE ma.business_id = payment_asset_ledger.business_id 
    LIMIT 1
) WHERE asset_id IS NULL;

-- Only set NOT NULL if asset_id column is now fully populated
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM public.payment_asset_ledger WHERE asset_id IS NULL) THEN
        ALTER TABLE public.payment_asset_ledger ALTER COLUMN asset_id SET NOT NULL;
    END IF;
END $$;

-- 4. Reload schema for PostgREST
NOTIFY pgrst, 'reload schema';

COMMIT;
