-- =============================================================================
-- 20260719_003_bom_backflush_update.sql
-- Fix production batch backflushing to work on UPDATE and add finished goods
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- FUNCTION: fn_backflush_inventory_on_batch_complete()
-- Updated trigger function that fires AFTER INSERT or UPDATE on 
-- production_batches when the batch status changes to 'Completed'. It:
--   1. Checks if status changed to 'Completed' (for UPDATE) or is 'Completed' (for INSERT)
--   2. Looks up the BOM ingredients via NEW.bom_id
--   3. Calculates required raw material = ingredient.quantity_required * NEW.quantity_produced
--   4. Checks each raw material has sufficient stock
--   5. Deducts the calculated quantity from products.stock (raw materials)
--   6. Adds the finished product quantity to products.stock
--   7. Raises EXCEPTION if any product has insufficient stock (rolls back the transaction)
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
    v_is_completing BOOLEAN;
BEGIN
    -- Determine if we should backflush:
    -- For INSERT: backflush if status is 'Completed'
    -- For UPDATE: backflush only if status changed TO 'Completed'
    IF TG_OP = 'INSERT' THEN
        v_is_completing := (NEW.status = 'Completed');
    ELSIF TG_OP = 'UPDATE' THEN
        v_is_completing := (NEW.status = 'Completed' AND OLD.status <> 'Completed');
    ELSE
        RETURN NEW;
    END IF;

    -- If not completing, just return
    IF NOT v_is_completing THEN
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

    -- Add finished product to inventory
    IF NEW.product_id IS NOT NULL AND NEW.quantity_produced > 0 THEN
        -- Check if the product exists first
        IF EXISTS(SELECT 1 FROM public.products WHERE id = NEW.product_id) THEN
            UPDATE public.products
            SET stock = stock + NEW.quantity_produced,
                updated_at = NOW()
            WHERE id = NEW.product_id;
            
            RAISE INFO 'Added % units of finished product % to inventory for batch %', 
                NEW.quantity_produced, NEW.product_id, NEW.id;
        ELSE
            RAISE WARNING 'Finished product % does not exist in products table for batch %', NEW.product_id, NEW.id;
        END IF;
    ELSE
        RAISE WARNING 'Batch % has no product_id (NULL) or zero quantity. Cannot add finished product to inventory.', NEW.id;
    END IF;

    RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- TRIGGER: trg_production_batch_backflush
-- Fires AFTER INSERT or UPDATE on production_batches to auto-deduct raw materials
-- and add finished goods when a batch is marked Completed.
-- ---------------------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_production_batch_backflush ON public.production_batches;
CREATE TRIGGER trg_production_batch_backflush
    AFTER INSERT OR UPDATE ON public.production_batches
    FOR EACH ROW
    EXECUTE FUNCTION public.fn_backflush_inventory_on_batch_complete();

COMMIT;