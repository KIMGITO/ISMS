-- =============================================================================
-- 20260708160000_extra_modules.sql
-- KayKay's Milk Business Management System — Extra Modules Schema Parity
-- =============================================================================

-- Add new roles to the employee_role ENUM
-- Note: ALTER TYPE ADD VALUE cannot run inside a multi-statement transaction block in some PG environments.
-- Using ADD VALUE IF NOT EXISTS directly.
ALTER TYPE employee_role ADD VALUE IF NOT EXISTS 'Production Staff';
ALTER TYPE employee_role ADD VALUE IF NOT EXISTS 'Inventory Staff';
ALTER TYPE employee_role ADD VALUE IF NOT EXISTS 'Sales Staff';
ALTER TYPE employee_role ADD VALUE IF NOT EXISTS 'Viewer';
ALTER TYPE employee_role ADD VALUE IF NOT EXISTS 'Administrator';

-- Start schema creation transaction
BEGIN;

-- ---------------------------------------------------------------------------
-- TABLES
-- ---------------------------------------------------------------------------

-- 1. Recipes & BOM
CREATE TABLE IF NOT EXISTS public.recipes (
    id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id      UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    name             TEXT NOT NULL,
    code             TEXT NOT NULL,
    description      TEXT,
    yield_quantity   NUMERIC NOT NULL DEFAULT 1.0,
    yield_unit       TEXT NOT NULL DEFAULT 'Unit',
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Recipe Ingredients
CREATE TABLE IF NOT EXISTS public.recipe_ingredients (
    id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    recipe_id        UUID NOT NULL REFERENCES public.recipes(id) ON DELETE CASCADE,
    name             TEXT NOT NULL,
    quantity         NUMERIC NOT NULL,
    unit             TEXT NOT NULL,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. Production Batches
CREATE TABLE IF NOT EXISTS public.production_batches (
    id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id       UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    recipe_id         UUID REFERENCES public.recipes(id) ON DELETE SET NULL,
    recipe_name       TEXT NOT NULL,
    quantity_produced NUMERIC NOT NULL,
    unit              TEXT NOT NULL,
    status            TEXT NOT NULL DEFAULT 'Pending',
    staff_name        TEXT NOT NULL,
    date              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. Purchases (Bulk Orders)
CREATE TABLE IF NOT EXISTS public.purchases (
    id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id      UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    supplier_name    TEXT NOT NULL,
    total_amount     NUMERIC NOT NULL DEFAULT 0.0,
    status           TEXT NOT NULL DEFAULT 'Pending',
    date             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 5. Purchase Items
CREATE TABLE IF NOT EXISTS public.purchase_items (
    id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    purchase_id      UUID NOT NULL REFERENCES public.purchases(id) ON DELETE CASCADE,
    name             TEXT NOT NULL,
    quantity         NUMERIC NOT NULL,
    unit             TEXT NOT NULL,
    price            NUMERIC NOT NULL,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 6. Business Assets
CREATE TABLE IF NOT EXISTS public.business_assets (
    id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id      UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    name             TEXT NOT NULL,
    code             TEXT NOT NULL,
    serial_number    TEXT,
    value            NUMERIC NOT NULL DEFAULT 0.0,
    status           TEXT NOT NULL DEFAULT 'Active',
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 7. Storage Files
CREATE TABLE IF NOT EXISTS public.storage_files (
    id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id      UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    name             TEXT NOT NULL,
    size             TEXT NOT NULL,
    type             TEXT NOT NULL,
    url              TEXT NOT NULL,
    uploaded_by      TEXT NOT NULL,
    date             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 8. AI Insights
CREATE TABLE IF NOT EXISTS public.ai_insights (
    id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id      UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    title            TEXT NOT NULL,
    content          TEXT NOT NULL,
    type             TEXT NOT NULL DEFAULT 'Insight',
    date             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 9. Payments Ledger (M-Pesa reference and cash registers)
CREATE TABLE IF NOT EXISTS public.payments (
    id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id      UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    reference_code   TEXT NOT NULL,
    amount           NUMERIC NOT NULL,
    method           TEXT NOT NULL,
    sender_name      TEXT NOT NULL,
    sender_phone     TEXT,
    status           TEXT NOT NULL DEFAULT 'Success',
    date             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- ROW LEVEL SECURITY (RLS) POLICIES
-- ---------------------------------------------------------------------------

ALTER TABLE public.recipes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recipe_ingredients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.production_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.business_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.storage_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_insights ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;

-- Recipes Policies
CREATE POLICY pol_recipes_select ON public.recipes
    FOR SELECT USING (business_id = ANY(public.get_user_business_ids()));
CREATE POLICY pol_recipes_all ON public.recipes
    FOR ALL USING (public.is_owner_or_admin(business_id));

-- Recipe Ingredients Policies
CREATE POLICY pol_recipe_ingredients_select ON public.recipe_ingredients
    FOR SELECT USING (EXISTS (SELECT 1 FROM public.recipes r WHERE r.id = recipe_id AND r.business_id = ANY(public.get_user_business_ids())));
CREATE POLICY pol_recipe_ingredients_all ON public.recipe_ingredients
    FOR ALL USING (EXISTS (SELECT 1 FROM public.recipes r WHERE r.id = recipe_id AND public.is_owner_or_admin(r.business_id)));

-- Production Batches Policies
CREATE POLICY pol_production_batches_select ON public.production_batches
    FOR SELECT USING (business_id = ANY(public.get_user_business_ids()));
CREATE POLICY pol_production_batches_all ON public.production_batches
    FOR ALL USING (business_id = ANY(public.get_user_business_ids()));

-- Purchases Policies
CREATE POLICY pol_purchases_select ON public.purchases
    FOR SELECT USING (business_id = ANY(public.get_user_business_ids()));
CREATE POLICY pol_purchases_all ON public.purchases
    FOR ALL USING (business_id = ANY(public.get_user_business_ids()));

-- Purchase Items Policies
CREATE POLICY pol_purchase_items_select ON public.purchase_items
    FOR SELECT USING (EXISTS (SELECT 1 FROM public.purchases p WHERE p.id = purchase_id AND p.business_id = ANY(public.get_user_business_ids())));
CREATE POLICY pol_purchase_items_all ON public.purchase_items
    FOR ALL USING (EXISTS (SELECT 1 FROM public.purchases p WHERE p.id = purchase_id AND p.business_id = ANY(public.get_user_business_ids())));

-- Business Assets Policies
CREATE POLICY pol_business_assets_select ON public.business_assets
    FOR SELECT USING (business_id = ANY(public.get_user_business_ids()));
CREATE POLICY pol_business_assets_all ON public.business_assets
    FOR ALL USING (public.is_owner_or_admin(business_id));

-- Storage Files Policies
CREATE POLICY pol_storage_files_select ON public.storage_files
    FOR SELECT USING (business_id = ANY(public.get_user_business_ids()));
CREATE POLICY pol_storage_files_all ON public.storage_files
    FOR ALL USING (business_id = ANY(public.get_user_business_ids()));

-- AI Insights Policies
CREATE POLICY pol_ai_insights_select ON public.ai_insights
    FOR SELECT USING (business_id = ANY(public.get_user_business_ids()));
CREATE POLICY pol_ai_insights_all ON public.ai_insights
    FOR ALL USING (public.is_owner_or_admin(business_id));

-- Payments Policies
CREATE POLICY pol_payments_select ON public.payments
    FOR SELECT USING (business_id = ANY(public.get_user_business_ids()));
CREATE POLICY pol_payments_all ON public.payments
    FOR ALL USING (business_id = ANY(public.get_user_business_ids()));

-- ---------------------------------------------------------------------------
-- INDEXES
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_recipes_business ON public.recipes(business_id);
CREATE INDEX IF NOT EXISTS idx_recipe_ingredients_recipe ON public.recipe_ingredients(recipe_id);
CREATE INDEX IF NOT EXISTS idx_production_batches_business ON public.production_batches(business_id);
CREATE INDEX IF NOT EXISTS idx_purchases_business ON public.purchases(business_id);
CREATE INDEX IF NOT EXISTS idx_purchase_items_purchase ON public.purchase_items(purchase_id);
CREATE INDEX IF NOT EXISTS idx_business_assets_business ON public.business_assets(business_id);
CREATE INDEX IF NOT EXISTS idx_storage_files_business ON public.storage_files(business_id);
CREATE INDEX IF NOT EXISTS idx_ai_insights_business ON public.ai_insights(business_id);
CREATE INDEX IF NOT EXISTS idx_payments_business ON public.payments(business_id);

COMMIT;
