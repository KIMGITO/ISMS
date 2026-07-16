-- =============================================================================
-- 20260715_009_extra_modules_tables.sql
-- KayKay's Milk Business Management System
-- Extra Module Tables: recipes, recipe_ingredients, production_batches,
--   purchases, purchase_items, business_assets, storage_files,
--   ai_insights, payments
-- =============================================================================
-- Why: These tables support advanced business operations beyond basic POS:
-- production/manufacturing (recipes + batches), procurement (purchases),
-- asset management, cloud file storage catalog, AI-generated insights,
-- and a payment reference ledger (for M-Pesa and cash registers).
-- These were originally in a separate migration (extra_modules) but belong
-- in the clean baseline.
-- Dependencies: 001, 002, 003, 004, 005, 006, 007, 008
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- TABLE: recipes
-- Bill-of-materials recipes for dairy production (e.g. yogurt, butter).
-- code is a short human-readable identifier (e.g. YGT-001).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.recipes (
    id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id    UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    name           TEXT NOT NULL CHECK (length(trim(name)) > 0),
    code           TEXT NOT NULL,
    description    TEXT,
    yield_quantity NUMERIC(14,3) NOT NULL DEFAULT 1.000 CHECK (yield_quantity > 0),
    yield_unit     TEXT NOT NULL DEFAULT 'Unit',
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.recipes ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- TABLE: recipe_ingredients
-- Ingredient lines within a recipe. Quantity and unit are free-form.
-- CASCADE delete ensures ingredients are removed with the recipe.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.recipe_ingredients (
    id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    recipe_id  UUID NOT NULL REFERENCES public.recipes(id) ON DELETE CASCADE,
    name       TEXT NOT NULL,
    quantity   NUMERIC(14,3) NOT NULL CHECK (quantity > 0),
    unit       TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    -- No updated_at: ingredients are immutable; edit means delete+insert
);

ALTER TABLE public.recipe_ingredients ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- TABLE: production_batches
-- Records of manufacturing runs using a recipe. Tracks quantity produced,
-- the recipe used (with denormalized name for display after recipe deletion),
-- status (Pending → In Progress → Completed), and the staff responsible.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.production_batches (
    id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id       UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    recipe_id         UUID REFERENCES public.recipes(id) ON DELETE SET NULL,
    recipe_name       TEXT NOT NULL,
    quantity_produced NUMERIC(14,3) NOT NULL CHECK (quantity_produced > 0),
    unit              TEXT NOT NULL,
    status            TEXT NOT NULL DEFAULT 'Pending'
                          CHECK (status IN ('Pending', 'In Progress', 'Completed', 'Cancelled')),
    staff_name        TEXT NOT NULL,
    date              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.production_batches ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- TABLE: purchases
-- Bulk procurement orders from suppliers. One purchase = one supplier order.
-- Items are line-itemed in purchase_items. status tracks order lifecycle.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.purchases (
    id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id   UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    supplier_name TEXT NOT NULL,
    total_amount  NUMERIC(14,2) NOT NULL DEFAULT 0.00 CHECK (total_amount >= 0),
    status        TEXT NOT NULL DEFAULT 'Pending'
                      CHECK (status IN ('Pending', 'Ordered', 'Received', 'Cancelled')),
    date          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.purchases ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- TABLE: purchase_items
-- Line items in a purchase order. price is the per-unit cost at time of order.
-- CASCADE delete removes items when the purchase order is deleted.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.purchase_items (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    purchase_id UUID NOT NULL REFERENCES public.purchases(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    quantity    NUMERIC(14,3) NOT NULL CHECK (quantity > 0),
    unit        TEXT NOT NULL,
    price       NUMERIC(14,2) NOT NULL CHECK (price >= 0),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    -- No updated_at: purchase line items are immutable once committed
);

ALTER TABLE public.purchase_items ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- TABLE: business_assets
-- Physical assets owned by the business (vehicles, equipment, coolers).
-- code is a short internal asset code. serial_number is optional.
-- value is the current book value (KES). status tracks asset condition.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.business_assets (
    id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id   UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    name          TEXT NOT NULL CHECK (length(trim(name)) > 0),
    code          TEXT NOT NULL,
    serial_number TEXT,
    value         NUMERIC(14,2) NOT NULL DEFAULT 0.00 CHECK (value >= 0),
    status        TEXT NOT NULL DEFAULT 'Active'
                      CHECK (status IN ('Active', 'Under Repair', 'Disposed', 'Sold')),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.business_assets ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- TABLE: storage_files
-- Catalog of files uploaded via Cloudinary/Supabase Storage. Tracks file
-- metadata (name, size, MIME type, URL) and the employee who uploaded it.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.storage_files (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    size        TEXT NOT NULL,
    type        TEXT NOT NULL,
    url         TEXT NOT NULL,
    uploaded_by TEXT NOT NULL,
    date        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    -- No updated_at: file records are immutable (re-upload = new record)
);

ALTER TABLE public.storage_files ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- TABLE: ai_insights
-- AI-generated business insights stored from the Gemini copilot edge function.
-- type categorizes the insight (Insight, Recommendation, Risk Alert, etc.).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ai_insights (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    title       TEXT NOT NULL,
    content     TEXT NOT NULL,
    type        TEXT NOT NULL DEFAULT 'Insight',
    date        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    -- No updated_at: insights are append-only
);

ALTER TABLE public.ai_insights ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- TABLE: payments
-- High-level payment reference ledger for manual payment recording (M-Pesa,
-- cash, card, bank). Reference code is the M-Pesa transaction ID or a
-- manual reference number. This is distinct from mpesa_transactions which
-- tracks STK push API state.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.payments (
    id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id    UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    reference_code TEXT NOT NULL,
    amount         NUMERIC(14,2) NOT NULL CHECK (amount > 0),
    method         TEXT NOT NULL CHECK (method IN ('M-Pesa', 'Cash', 'Card', 'Bank', 'Other')),
    sender_name    TEXT NOT NULL,
    sender_phone   TEXT,
    status         TEXT NOT NULL DEFAULT 'Success'
                       CHECK (status IN ('Success', 'Pending', 'Failed')),
    date           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
    -- No updated_at: payment records are append-only
);

ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;

COMMIT;
