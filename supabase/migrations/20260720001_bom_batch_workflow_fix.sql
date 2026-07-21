-- =============================================================================
-- 20260720_001_bom_batch_workflow_fix.sql
-- KayKay's Milk Business Management System
-- Bill of Materials (BOM) & Production Batch Workflow Fixes
-- Atomic Raw Material Deduction, Completion, Cancellation Restocking & Audit Logs
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. EXTEND ENUM: inventory_adjustment_type
-- Add production-specific stock movement types to inventory_adjustment_type
-- ---------------------------------------------------------------------------
ALTER TYPE public.inventory_adjustment_type ADD VALUE IF NOT EXISTS 'Production Consumption';
ALTER TYPE public.inventory_adjustment_type ADD VALUE IF NOT EXISTS 'Production Output';
ALTER TYPE public.inventory_adjustment_type ADD VALUE IF NOT EXISTS 'Production Reversal';
ALTER TYPE public.inventory_adjustment_type ADD VALUE IF NOT EXISTS 'Production Waste';

-- ---------------------------------------------------------------------------
-- 2. ALTER TABLE: inventory_adjustments
-- Add batch_id, reference_number, and notes columns for stock movement auditing
-- ---------------------------------------------------------------------------
ALTER TABLE public.inventory_adjustments
    ADD COLUMN IF NOT EXISTS batch_id         UUID REFERENCES public.production_batches(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS reference_number TEXT,
    ADD COLUMN IF NOT EXISTS notes            TEXT;

CREATE INDEX IF NOT EXISTS idx_inventory_adjustments_batch_id ON public.inventory_adjustments(batch_id);

-- ---------------------------------------------------------------------------
-- 3. ALTER TABLE: production_batches
-- Add reference_number column if missing
-- ---------------------------------------------------------------------------
ALTER TABLE public.production_batches
    ADD COLUMN IF NOT EXISTS reference_number TEXT;

-- ---------------------------------------------------------------------------
-- 4. DROP LEGACY BACKFLUSH TRIGGER
-- Replace trigger-based backflushing with atomic RPC transaction functions
-- ---------------------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_production_batch_backflush ON public.production_batches;
DROP FUNCTION IF EXISTS public.fn_backflush_inventory_on_batch_complete();

-- ---------------------------------------------------------------------------
-- 5. RPC FUNCTION: fn_create_production_batch
-- Creates a production batch and IMMEDIATELY deducts raw materials from inventory
-- in a single atomic transaction.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_create_production_batch(
    p_business_id       UUID,
    p_bom_id            UUID,
    p_recipe_name       TEXT,
    p_quantity_produced NUMERIC(14,3),
    p_unit              TEXT,
    p_status            TEXT,
    p_staff_name        TEXT,
    p_date              TIMESTAMPTZ DEFAULT NOW()
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_bom RECORD;
    v_ingredient RECORD;
    v_required_qty NUMERIC(14,6);
    v_current_stock NUMERIC(14,3);
    v_new_stock NUMERIC(14,3);
    v_finished_good RECORD;
    v_batch_id UUID;
    v_ref_no TEXT;
    v_batch_status TEXT;
    v_result JSONB;
BEGIN
    -- Validate BOM existence
    SELECT * INTO v_bom
    FROM public.bill_of_materials
    WHERE id = p_bom_id AND business_id = p_business_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Bill of Materials with ID "%" does not exist for business "%".', p_bom_id, p_business_id;
    END IF;

    -- Validate quantity
    IF p_quantity_produced <= 0 THEN
        RAISE EXCEPTION 'Quantity produced must be greater than zero.';
    END IF;

    -- Validate Finished Product existence if linked
    IF v_bom.product_id IS NOT NULL THEN
        SELECT id, name, stock INTO v_finished_good
        FROM public.products
        WHERE id = v_bom.product_id;
    END IF;

    -- 1. PRE-CHECK INGREDIENTS STOCK & LOCK ROWS
    FOR v_ingredient IN
        SELECT
            bi.product_id,
            bi.quantity_required,
            bi.waste_percentage,
            bi.unit AS ingredient_unit,
            p.name AS product_name,
            p.stock AS current_stock
        FROM public.bom_ingredients bi
        JOIN public.products p ON p.id = bi.product_id
        WHERE bi.bom_id = p_bom_id
        FOR UPDATE OF p
    LOOP
        v_required_qty := v_ingredient.quantity_required
                         * (1.00 + v_ingredient.waste_percentage / 100.0)
                         * p_quantity_produced;

        IF v_ingredient.current_stock < v_required_qty THEN
            RAISE EXCEPTION 'Insufficient stock for "%": required %, available %.',
                v_ingredient.product_name,
                ROUND(v_required_qty, 3),
                ROUND(v_ingredient.current_stock, 3);
        END IF;
    END LOOP;

    -- Generate Reference Number
    v_ref_no := 'BATCH-' || to_char(COALESCE(p_date, NOW()), 'YYYYMMDD') || '-' || upper(substring(uuid_generate_v4()::text from 1 for 4));
    v_batch_status := COALESCE(p_status, 'In Progress');

    -- Insert Production Batch
    INSERT INTO public.production_batches (
        business_id,
        recipe_name,
        product_id,
        bom_id,
        quantity_produced,
        unit,
        status,
        staff_name,
        reference_number,
        date,
        created_at,
        updated_at
    ) VALUES (
        p_business_id,
        p_recipe_name,
        v_bom.product_id,
        p_bom_id,
        p_quantity_produced,
        p_unit,
        v_batch_status,
        p_staff_name,
        v_ref_no,
        COALESCE(p_date, NOW()),
        NOW(),
        NOW()
    )
    RETURNING id INTO v_batch_id;

    -- 2. DEDUCT RAW MATERIALS & LOG MOVEMENTS
    FOR v_ingredient IN
        SELECT
            bi.product_id,
            bi.quantity_required,
            bi.waste_percentage,
            p.name AS product_name,
            p.stock AS current_stock
        FROM public.bom_ingredients bi
        JOIN public.products p ON p.id = bi.product_id
        WHERE bi.bom_id = p_bom_id
    LOOP
        v_required_qty := v_ingredient.quantity_required
                         * (1.00 + v_ingredient.waste_percentage / 100.0)
                         * p_quantity_produced;

        v_current_stock := v_ingredient.current_stock;
        v_new_stock := v_current_stock - v_required_qty;

        -- Deduct stock
        UPDATE public.products
        SET stock = v_new_stock,
            updated_at = NOW()
        WHERE id = v_ingredient.product_id;

        -- Create Stock Movement Audit Log
        INSERT INTO public.inventory_adjustments (
            business_id,
            product_id,
            product_name,
            type,
            quantity_adjusted,
            previous_stock,
            new_stock,
            timestamp,
            reason,
            staff_name,
            batch_id,
            reference_number,
            notes
        ) VALUES (
            p_business_id,
            v_ingredient.product_id,
            v_ingredient.product_name,
            'Production Consumption'::public.inventory_adjustment_type,
            -v_required_qty,
            v_current_stock,
            v_new_stock,
            NOW(),
            'Production consumption for batch ' || v_ref_no || ' (' || p_recipe_name || ')',
            p_staff_name,
            v_batch_id,
            v_ref_no,
            'Raw material consumed for producing ' || p_quantity_produced || ' ' || p_unit || ' of ' || COALESCE(v_finished_good.name, p_recipe_name)
        );
    END LOOP;

    -- 3. IF DIRECTLY CREATED AS COMPLETED, ADD FINISHED GOOD STOCK
    IF v_batch_status = 'Completed' AND v_bom.product_id IS NOT NULL THEN
        SELECT stock INTO v_current_stock
        FROM public.products
        WHERE id = v_bom.product_id
        FOR UPDATE;

        v_new_stock := v_current_stock + p_quantity_produced;

        UPDATE public.products
        SET stock = v_new_stock,
            updated_at = NOW()
        WHERE id = v_bom.product_id;

        INSERT INTO public.inventory_adjustments (
            business_id,
            product_id,
            product_name,
            type,
            quantity_adjusted,
            previous_stock,
            new_stock,
            timestamp,
            reason,
            staff_name,
            batch_id,
            reference_number,
            notes
        ) VALUES (
            p_business_id,
            v_bom.product_id,
            v_finished_good.name,
            'Production Output'::public.inventory_adjustment_type,
            p_quantity_produced,
            v_current_stock,
            v_new_stock,
            NOW(),
            'Finished goods output for completed batch ' || v_ref_no,
            p_staff_name,
            v_batch_id,
            v_ref_no,
            'Added ' || p_quantity_produced || ' ' || p_unit || ' to inventory.'
        );
    END IF;

    -- Fetch newly created batch row as JSON
    SELECT row_to_json(b)::jsonb INTO v_result
    FROM public.production_batches b
    WHERE b.id = v_batch_id;

    RETURN v_result;
END;
$$;

-- ---------------------------------------------------------------------------
-- 6. RPC FUNCTION: fn_complete_production_batch
-- Marks a production batch as Completed and adds finished product stock to inventory
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_complete_production_batch(
    p_batch_id   UUID,
    p_staff_name TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_batch RECORD;
    v_product RECORD;
    v_current_stock NUMERIC(14,3);
    v_new_stock NUMERIC(14,3);
    v_result JSONB;
BEGIN
    -- Fetch batch and lock row
    SELECT * INTO v_batch
    FROM public.production_batches
    WHERE id = p_batch_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Production batch % not found.', p_batch_id;
    END IF;

    IF v_batch.status = 'Completed' THEN
        RAISE EXCEPTION 'Batch % is already marked as Completed.', COALESCE(v_batch.reference_number, v_batch.id::text);
    END IF;

    IF v_batch.status = 'Cancelled' THEN
        RAISE EXCEPTION 'Cannot complete a cancelled batch (%).', COALESCE(v_batch.reference_number, v_batch.id::text);
    END IF;

    -- Update batch status
    UPDATE public.production_batches
    SET status = 'Completed',
        updated_at = NOW()
    WHERE id = p_batch_id;

    -- Add finished product to inventory if product_id is set
    IF v_batch.product_id IS NOT NULL AND v_batch.quantity_produced > 0 THEN
        SELECT id, name, stock INTO v_product
        FROM public.products
        WHERE id = v_batch.product_id
        FOR UPDATE;

        IF FOUND THEN
            v_current_stock := v_product.stock;
            v_new_stock := v_current_stock + v_batch.quantity_produced;

            UPDATE public.products
            SET stock = v_new_stock,
                updated_at = NOW()
            WHERE id = v_batch.product_id;

            -- Insert Stock Movement Audit Log
            INSERT INTO public.inventory_adjustments (
                business_id,
                product_id,
                product_name,
                type,
                quantity_adjusted,
                previous_stock,
                new_stock,
                timestamp,
                reason,
                staff_name,
                batch_id,
                reference_number,
                notes
            ) VALUES (
                v_batch.business_id,
                v_batch.product_id,
                v_product.name,
                'Production Output'::public.inventory_adjustment_type,
                v_batch.quantity_produced,
                v_current_stock,
                v_new_stock,
                NOW(),
                'Finished goods output for completed batch ' || COALESCE(v_batch.reference_number, v_batch.id::text),
                p_staff_name,
                p_batch_id,
                v_batch.reference_number,
                'Added ' || v_batch.quantity_produced || ' ' || v_batch.unit || ' to finished goods inventory.'
            );
        END IF;
    END IF;

    -- Return updated batch JSON
    SELECT row_to_json(b)::jsonb INTO v_result
    FROM public.production_batches b
    WHERE b.id = p_batch_id;

    RETURN v_result;
END;
$$;

-- ---------------------------------------------------------------------------
-- 7. RPC FUNCTION: fn_cancel_production_batch
-- Cancels a batch and handles raw material restocking and waste logging
-- p_return_items is JSONB array: [{"productId": "uuid", "returnQty": 10.5, "wasteReason": "Damaged"}]
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_cancel_production_batch(
    p_batch_id     UUID,
    p_staff_name   TEXT,
    p_return_items JSONB DEFAULT '[]'::jsonb
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_batch RECORD;
    v_item JSONB;
    v_product_id UUID;
    v_return_qty NUMERIC(14,6);
    v_waste_reason TEXT;
    v_product RECORD;
    v_consumed_qty NUMERIC(14,6);
    v_wasted_qty NUMERIC(14,6);
    v_current_stock NUMERIC(14,3);
    v_new_stock NUMERIC(14,3);
    v_result JSONB;
BEGIN
    -- Fetch batch and lock row
    SELECT * INTO v_batch
    FROM public.production_batches
    WHERE id = p_batch_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Production batch % not found.', p_batch_id;
    END IF;

    IF v_batch.status = 'Cancelled' THEN
        RAISE EXCEPTION 'Batch % is already cancelled.', COALESCE(v_batch.reference_number, v_batch.id::text);
    END IF;

    IF v_batch.status = 'Completed' THEN
        RAISE EXCEPTION 'Cannot cancel an already completed batch (%).', COALESCE(v_batch.reference_number, v_batch.id::text);
    END IF;

    -- Update batch status to Cancelled
    UPDATE public.production_batches
    SET status = 'Cancelled',
        updated_at = NOW()
    WHERE id = p_batch_id;

    -- Process Restocking / Waste items
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_return_items)
    LOOP
        v_product_id := (v_item->>'productId')::UUID;
        v_return_qty := COALESCE((v_item->>'returnQty')::NUMERIC, 0);
        v_waste_reason := COALESCE(v_item->>'wasteReason', 'Production batch cancellation damage');

        IF v_product_id IS NOT NULL THEN
            SELECT id, name, stock INTO v_product
            FROM public.products
            WHERE id = v_product_id
            FOR UPDATE;

            IF FOUND THEN
                -- Calculate original consumed quantity for this ingredient from logs
                SELECT COALESCE(ABS(SUM(quantity_adjusted)), 0) INTO v_consumed_qty
                FROM public.inventory_adjustments
                WHERE batch_id = p_batch_id
                  AND product_id = v_product_id
                  AND type = 'Production Consumption';

                -- Prevent returning more than originally consumed
                IF v_return_qty > v_consumed_qty THEN
                    v_return_qty := v_consumed_qty;
                END IF;

                v_wasted_qty := GREATEST(0, v_consumed_qty - v_return_qty);

                -- 1. RESTOCK QUANTITY
                IF v_return_qty > 0 THEN
                    v_current_stock := v_product.stock;
                    v_new_stock := v_current_stock + v_return_qty;

                    UPDATE public.products
                    SET stock = v_new_stock,
                        updated_at = NOW()
                    WHERE id = v_product_id;

                    INSERT INTO public.inventory_adjustments (
                        business_id,
                        product_id,
                        product_name,
                        type,
                        quantity_adjusted,
                        previous_stock,
                        new_stock,
                        timestamp,
                        reason,
                        staff_name,
                        batch_id,
                        reference_number,
                        notes
                    ) VALUES (
                        v_batch.business_id,
                        v_product_id,
                        v_product.name,
                        'Production Reversal'::public.inventory_adjustment_type,
                        v_return_qty,
                        v_current_stock,
                        v_new_stock,
                        NOW(),
                        'Production reversal for cancelled batch ' || COALESCE(v_batch.reference_number, v_batch.id::text),
                        p_staff_name,
                        p_batch_id,
                        v_batch.reference_number,
                        'Restocked ' || v_return_qty || ' units of raw material to inventory.'
                    );
                END IF;

                -- 2. LOG WASTE QUANTITY (Stock not restored)
                IF v_wasted_qty > 0 THEN
                    SELECT stock INTO v_current_stock FROM public.products WHERE id = v_product_id;

                    INSERT INTO public.inventory_adjustments (
                        business_id,
                        product_id,
                        product_name,
                        type,
                        quantity_adjusted,
                        previous_stock,
                        new_stock,
                        timestamp,
                        reason,
                        staff_name,
                        batch_id,
                        reference_number,
                        notes
                    ) VALUES (
                        v_batch.business_id,
                        v_product_id,
                        v_product.name,
                        'Production Waste'::public.inventory_adjustment_type,
                        -v_wasted_qty,
                        v_current_stock,
                        v_current_stock,
                        NOW(),
                        v_waste_reason,
                        p_staff_name,
                        p_batch_id,
                        v_batch.reference_number,
                        'Recorded ' || v_wasted_qty || ' units as wasted/damaged during batch cancellation.'
                    );
                END IF;
            END IF;
        END IF;
    END LOOP;

    -- Return updated batch JSON
    SELECT row_to_json(b)::jsonb INTO v_result
    FROM public.production_batches b
    WHERE b.id = p_batch_id;

    RETURN v_result;
END;
$$;

COMMIT;
