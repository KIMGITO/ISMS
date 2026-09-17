-- =============================================================================
-- 20260917001_performance_optimization.sql
-- Optimization for Bulk Operations and Concurrency Control
-- =============================================================================

BEGIN;

-- 1. Optimized Bulk Category Update
CREATE OR REPLACE FUNCTION public.update_product_category_bulk(
    p_business_id UUID,
    p_old_category TEXT,
    p_new_category TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    UPDATE public.products
    SET category = p_new_category
    WHERE business_id = p_business_id
      AND category = p_old_category
      AND deleted_at IS NULL;
END;
$$;

-- 2. Enhanced adjust_stock_manually with Row Locking
CREATE OR REPLACE FUNCTION public.adjust_stock_manually(
    p_product_id  UUID,
    p_employee_id UUID,
    p_staff_name  TEXT,
    p_adj_type    public.inventory_adjustment_type,
    p_quantity    NUMERIC(14,3),
    p_reason      TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_old_stock NUMERIC(14,3);
    v_new_stock NUMERIC(14,3);
    v_biz_id    UUID;
    v_prod_name TEXT;
BEGIN
    SELECT stock, business_id, name
    INTO v_old_stock, v_biz_id, v_prod_name
    FROM public.products
    WHERE id = p_product_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Product not found: %', p_product_id;
    END IF;

    v_new_stock := CASE
        WHEN p_adj_type = 'Restock'        THEN v_old_stock + p_quantity
        WHEN p_adj_type = 'Damage'         THEN GREATEST(0, v_old_stock - p_quantity)
        WHEN p_adj_type = 'Reconciliation' THEN p_quantity
        ELSE v_old_stock
    END;

    UPDATE public.products
    SET stock = v_new_stock,
        updated_at = NOW()
    WHERE id = p_product_id;

    INSERT INTO public.inventory_adjustments
        (business_id, product_id, product_name, type, quantity_adjusted,
         previous_stock, new_stock, reason, staff_name)
    VALUES (
        v_biz_id,
        p_product_id,
        v_prod_name,
        p_adj_type,
        CASE
            WHEN p_adj_type = 'Restock'        THEN p_quantity
            WHEN p_adj_type = 'Damage'         THEN -p_quantity
            ELSE v_new_stock - v_old_stock
        END,
        v_old_stock,
        v_new_stock,
        p_reason,
        p_staff_name
    );
END;
$$;

-- 3. Bulk Stock Adjustment RPC
CREATE OR REPLACE FUNCTION public.adjust_stock_bulk(
    p_adjustments JSONB,
    p_employee_id UUID,
    p_staff_name  TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_adj         JSONB;
    v_product_id  UUID;
    v_adj_type    public.inventory_adjustment_type;
    v_quantity    NUMERIC(14,3);
    v_reason      TEXT;
    v_old_stock   NUMERIC(14,3);
    v_new_stock   NUMERIC(14,3);
    v_biz_id      UUID;
    v_prod_name   TEXT;
BEGIN
    FOR v_adj IN SELECT * FROM jsonb_array_elements(p_adjustments)
    LOOP
        v_product_id := (v_adj->>'product_id')::UUID;
        v_adj_type   := (v_adj->>'type')::public.inventory_adjustment_type;
        v_quantity   := (v_adj->>'quantity')::NUMERIC;
        v_reason     := v_adj->>'reason';

        SELECT stock, business_id, name
        INTO v_old_stock, v_biz_id, v_prod_name
        FROM public.products
        WHERE id = v_product_id
        FOR UPDATE;

        IF FOUND THEN
            v_new_stock := CASE
                WHEN v_adj_type = 'Restock'        THEN v_old_stock + v_quantity
                WHEN v_adj_type = 'Damage'         THEN GREATEST(0, v_old_stock - v_quantity)
                WHEN v_adj_type = 'Reconciliation' THEN v_quantity
                ELSE v_old_stock
            END;

            UPDATE public.products
            SET stock = v_new_stock,
                updated_at = NOW()
            WHERE id = v_product_id;

            INSERT INTO public.inventory_adjustments
                (business_id, product_id, product_name, type, quantity_adjusted,
                 previous_stock, new_stock, reason, staff_name)
            VALUES (
                v_biz_id,
                v_product_id,
                v_prod_name,
                v_adj_type,
                CASE
                    WHEN v_adj_type = 'Restock'        THEN v_quantity
                    WHEN v_adj_type = 'Damage'         THEN -v_quantity
                    ELSE v_new_stock - v_old_stock
                END,
                v_old_stock,
                v_new_stock,
                v_reason,
                p_staff_name
            );
        END IF;
    END LOOP;
END;
$$;

-- 4. Optimized fn_process_transaction_item with Row Locking
CREATE OR REPLACE FUNCTION public.fn_process_transaction_item()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_old_stock   NUMERIC(14,3);
    v_new_stock   NUMERIC(14,3);
    v_prod_name   TEXT;
    v_business_id UUID;
    v_staff_name  TEXT;
BEGIN
    SELECT business_id, staff_name
    INTO v_business_id, v_staff_name
    FROM public.transactions
    WHERE id = NEW.transaction_id;

    SELECT stock, name
    INTO v_old_stock, v_prod_name
    FROM public.products
    WHERE id = NEW.product_id
    FOR UPDATE;

    v_new_stock := GREATEST(0, v_old_stock - NEW.quantity);

    UPDATE public.products
    SET stock = v_new_stock,
        updated_at = NOW()
    WHERE id = NEW.product_id;

    INSERT INTO public.inventory_adjustments
        (business_id, product_id, product_name, type, quantity_adjusted,
         previous_stock, new_stock, reason, staff_name)
    VALUES (
        v_business_id,
        NEW.product_id,
        COALESCE(v_prod_name, NEW.product_name),
        'Reconciliation',
        -NEW.quantity,
        v_old_stock,
        v_new_stock,
        'Sold via order #' || NEW.transaction_id::TEXT,
        COALESCE(v_staff_name, 'System')
    );

    RETURN NEW;
END;
$$;

COMMIT;
