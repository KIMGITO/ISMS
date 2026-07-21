-- =============================================================================
-- 20260719_001_bom_production.sql
-- KayKay's Milk Business Management System
-- Bill of Materials (BOM) for Production Batching & Inventory Backflushing
-- =============================================================================
-- Why: Enables recipe-based production where raw materials (e.g. Milk) are
-- linked to finished goods (e.g. Yogurt) via a Bill of Materials. When a
-- production batch is marked "Completed", a database trigger automatically
-- deducts the required raw material quantities from the products.stock.
-- Dependencies: 001–016 (all prior migrations)
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- TABLE: bill_of_materials
-- BOM header linking a finished good product to its production recipe.
-- Each BOM belongs to a business and references a product (the finished good)
-- and optionally a recipe (for display/reference).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.bill_of_materials (
    id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id    UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    product_id     UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
    recipe_id      UUID REFERENCES public.recipes(id) ON DELETE SET NULL,
    name           TEXT NOT NULL CHECK (length(trim(name)) > 0),
    yield_quantity NUMERIC(14,3) NOT NULL DEFAULT 1.000 CHECK (yield_quantity > 0),
    yield_unit     TEXT NOT NULL DEFAULT 'Unit',
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (business_id, product_id)
);

ALTER TABLE public.bill_of_materials ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- TABLE: bom_ingredients
-- Each row is a raw material (product_id) required by a BOM, with the
-- quantity needed to produce ONE unit of the finished good.
-- waste_percentage allows accounting for typical production loss (e.g. 5%).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.bom_ingredients (
    id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    bom_id            UUID NOT NULL REFERENCES public.bill_of_materials(id) ON DELETE CASCADE,
    product_id        UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
    quantity_required NUMERIC(14,6) NOT NULL CHECK (quantity_required > 0),
    unit              TEXT NOT NULL,
    waste_percentage  NUMERIC(5,2) NOT NULL DEFAULT 0.00 CHECK (waste_percentage >= 0 AND waste_percentage <= 100),
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
    -- No updated_at: ingredient lines are immutable (edit = delete + insert)
);

ALTER TABLE public.bom_ingredients ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- ALTER production_batches: add product_id and bom_id columns
-- These link the batch to the finished good product and the BOM used,
-- enabling the backflushing trigger to look up required raw materials.
-- ---------------------------------------------------------------------------
ALTER TABLE public.production_batches
    ADD COLUMN IF NOT EXISTS product_id UUID REFERENCES public.products(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS bom_id     UUID REFERENCES public.bill_of_materials(id) ON DELETE SET NULL;

-- ---------------------------------------------------------------------------
-- FUNCTION: fn_backflush_inventory_on_batch_complete()
-- Trigger function that fires AFTER INSERT on production_batches when the
-- new batch status is 'Completed'. It:
--   1. Looks up the BOM ingredients via NEW.bom_id
--   2. Calculates required raw material = ingredient.quantity_required * NEW.quantity_produced
--   3. Checks each raw material has sufficient stock
--   4. Deducts the calculated quantity from products.stock
--   5. Raises EXCEPTION if any product has insufficient stock (rolls back the insert)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_backflush_inventory_on_batch_complete()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_ingredient RECORD;
    v_required_qty NUMERIC(14,6);
    v_current_stock NUMERIC(14,3);
BEGIN
    -- Only backflush when status is 'Completed'
    IF NEW.status <> 'Completed' THEN
        RETURN NEW;
    END IF;

    -- Must have a BOM linked to perform backflushing
    IF NEW.bom_id IS NULL THEN
        RAISE EXCEPTION 'Cannot backflush: production batch % has no BOM linked.', NEW.id;
    END IF;

    -- Iterate over each ingredient in the BOM
    FOR v_ingredient IN
        SELECT
            bi.product_id,
            bi.quantity_required,
            bi.waste_percentage,
            p.name AS product_name,
            p.stock
        FROM public.bom_ingredients bi
        JOIN public.products p ON p.id = bi.product_id
        WHERE bi.bom_id = NEW.bom_id
    LOOP
        -- Calculate required quantity including waste
        -- required = quantity_required * (1 + waste_percentage/100) * quantity_produced
        v_required_qty := v_ingredient.quantity_required
                         * (1 + v_ingredient.waste_percentage / 100.0)
                         * NEW.quantity_produced;

        v_current_stock := v_ingredient.stock;

        -- Check sufficient stock
        IF v_current_stock < v_required_qty THEN
            RAISE EXCEPTION 'Insufficient stock for "%": have %, need % (batch %). '
                'Please adjust inventory or reduce batch size.',
                v_ingredient.product_name,
                v_current_stock,
                ROUND(v_required_qty, 3),
                NEW.id;
        END IF;

        -- Deduct from products.stock
        UPDATE public.products
        SET stock = stock - v_required_qty,
            updated_at = NOW()
        WHERE id = v_ingredient.product_id;
    END LOOP;

    RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- TRIGGER: trg_production_batch_backflush
-- Fires AFTER INSERT on production_batches to auto-deduct raw materials
-- when a batch is marked Completed.
-- ---------------------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_production_batch_backflush ON public.production_batches;
CREATE TRIGGER trg_production_batch_backflush
    AFTER INSERT ON public.production_batches
    FOR EACH ROW
    EXECUTE FUNCTION public.fn_backflush_inventory_on_batch_complete();

-- ---------------------------------------------------------------------------
-- RLS POLICIES for bill_of_materials and bom_ingredients
-- Users can see BOMs for their own business.
-- ---------------------------------------------------------------------------
CREATE POLICY "Users can view BOMs for their business"
    ON public.bill_of_materials
    FOR SELECT
    USING (
        business_id IN (
            SELECT bm.business_id
            FROM public.business_memberships bm
            WHERE bm.user_id = auth.uid()
        )
    );

CREATE POLICY "Users can insert BOMs for their business"
    ON public.bill_of_materials
    FOR INSERT
    WITH CHECK (
        business_id IN (
            SELECT bm.business_id
            FROM public.business_memberships bm
            WHERE bm.user_id = auth.uid()
        )
    );

CREATE POLICY "Users can update BOMs for their business"
    ON public.bill_of_materials
    FOR UPDATE
    USING (
        business_id IN (
            SELECT bm.business_id
            FROM public.business_memberships bm
            WHERE bm.user_id = auth.uid()
        )
    );

CREATE POLICY "Users can delete BOMs for their business"
    ON public.bill_of_materials
    FOR DELETE
    USING (
        business_id IN (
            SELECT bm.business_id
            FROM public.business_memberships bm
            WHERE bm.user_id = auth.uid()
        )
    );

CREATE POLICY "Users can view BOM ingredients for their business"
    ON public.bom_ingredients
    FOR SELECT
    USING (
        bom_id IN (
            SELECT bom.id
            FROM public.bill_of_materials bom
            JOIN public.business_memberships bm ON bm.business_id = bom.business_id
            WHERE bm.user_id = auth.uid()
        )
    );

CREATE POLICY "Users can insert BOM ingredients for their business"
    ON public.bom_ingredients
    FOR INSERT
    WITH CHECK (
        bom_id IN (
            SELECT bom.id
            FROM public.bill_of_materials bom
            JOIN public.business_memberships bm ON bm.business_id = bom.business_id
            WHERE bm.user_id = auth.uid()
        )
    );

CREATE POLICY "Users can delete BOM ingredients for their business"
    ON public.bom_ingredients
    FOR DELETE
    USING (
        bom_id IN (
            SELECT bom.id
            FROM public.bill_of_materials bom
            JOIN public.business_memberships bm ON bm.business_id = bom.business_id
            WHERE bm.user_id = auth.uid()
        )
    );

-- ---------------------------------------------------------------------------
-- Add bill_of_materials and bom_ingredients to the updated_at trigger list
-- via the existing DO block pattern (applied in migration 013).
-- We add them individually here since we cannot modify the existing DO block.
-- ---------------------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_bill_of_materials_updated_at ON public.bill_of_materials;
CREATE TRIGGER trg_bill_of_materials_updated_at
    BEFORE UPDATE ON public.bill_of_materials
    FOR EACH ROW
    EXECUTE FUNCTION public.fn_set_updated_at();

COMMIT;