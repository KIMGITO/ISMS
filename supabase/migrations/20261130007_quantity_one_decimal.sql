-- Quantities have at most one decimal place (owner, 2026-11-18): 2, 1.5, 0.5.
-- Money is already numeric(14,2) everywhere, so it is always stored to the cent. Rates that are
-- not amounts (percentages, loyalty KSh-per-point values) keep their own precision.
--
-- Every quantity column (stock, sale lines, transfers, purchases, recipes, production, regular
-- orders, promotion item counts) becomes numeric(p,1); Postgres rounds anything written to it.
-- Recipes give their ingredients per batch (yield_quantity), so small amounts are written as a
-- batch amount (5 kg salt for 100 loaves), not per item.
-- The three views that read these columns are dropped and made again unchanged.

DO $$
DECLARE
    v_cols TEXT[] := ARRAY[
        'bill_of_materials.yield_quantity',
        'bom_ingredients.quantity_required',
        'credit_note_lines.quantity',
        'inventory_adjustments.quantity_adjusted',
        'inventory_adjustments.previous_stock',
        'inventory_adjustments.new_stock',
        'online_order_items.quantity',
        'production_batches.quantity_produced',
        'products.reorder_qty',
        'products.stock',
        'products.min_stock',
        'products.reorder_level',
        'purchase_items.qty_damaged',
        'purchase_items.qty_received',
        'purchase_items.quantity',
        'purchase_receipt_lines.qty_received',
        'purchase_receipt_lines.qty_damaged',
        'quote_lines.quantity',
        'recipe_ingredients.quantity',
        'recipes.yield_quantity',
        'referral_campaigns.referrer_qty',
        'referral_campaigns.welcome_qty',
        'referral_rewards.qty',
        'regular_order_days.quantity',
        'sales_delivery_lines.quantity',
        'sales_invoice_lines.qty_credited',
        'sales_invoice_lines.quantity',
        'sales_order_lines.qty_invoiced',
        'sales_order_lines.qty_delivered',
        'sales_order_lines.quantity',
        'stock_transfer_items.quantity_written_off',
        'stock_transfer_items.quantity_sent',
        'stock_transfer_items.quantity_received',
        'stock_transfer_items.quantity_requested',
        'stock_transfer_items.quantity_late',
        'stock_transfer_items.quantity_found',
        'supplier_return_lines.quantity',
        'supplier_stock_requests.quantity',
        'transaction_items.quantity',
        'website_promo_codes.reward_qty',
        'website_promo_codes.buy_qty'
    ];
    v_views TEXT[] := ARRAY['v_active_products', 'v_low_stock_products', 'v_product_sales_rank'];
    v_defs  JSONB := '{}'::JSONB;
    v_name  TEXT;
    v_col   TEXT;
    v_tbl   TEXT;
    v_att   TEXT;
    v_prec  INT;
    v_scale INT;
    g       RECORD;
BEGIN
    -- Save each view (definition, options, grants) before dropping it.
    FOREACH v_name IN ARRAY v_views LOOP
        IF to_regclass('public.' || v_name) IS NULL THEN CONTINUE; END IF;
        v_defs := v_defs || jsonb_build_object(v_name, jsonb_build_object(
            'sql', pg_get_viewdef(('public.' || v_name)::regclass, TRUE),
            'opts', (SELECT COALESCE(array_to_string(reloptions, ', '), '') FROM pg_class WHERE oid = ('public.' || v_name)::regclass),
            'grants', (SELECT COALESCE(jsonb_agg(jsonb_build_object('who', grantee, 'what', privilege_type)), '[]'::JSONB)
                       FROM information_schema.role_table_grants
                       WHERE table_schema = 'public' AND table_name = v_name AND grantee <> 'postgres')));
        EXECUTE format('DROP VIEW public.%I', v_name);
    END LOOP;

    FOREACH v_col IN ARRAY v_cols LOOP
        v_tbl := split_part(v_col, '.', 1);
        v_att := split_part(v_col, '.', 2);
        SELECT numeric_precision, numeric_scale INTO v_prec, v_scale
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = v_tbl AND column_name = v_att AND data_type = 'numeric';
        IF NOT FOUND OR v_scale = 1 THEN CONTINUE; END IF;
        -- Same digits before the point (or more), one after it.
        EXECUTE format('ALTER TABLE public.%I ALTER COLUMN %I TYPE NUMERIC(%s,1)',
                       v_tbl, v_att, GREATEST(COALESCE(v_prec, 14) - COALESCE(v_scale, 0) + 1, 14));
    END LOOP;

    FOR v_name IN SELECT jsonb_object_keys(v_defs) LOOP
        EXECUTE format('CREATE VIEW public.%I%s AS %s', v_name,
                       CASE WHEN v_defs -> v_name ->> 'opts' = '' THEN '' ELSE ' WITH (' || (v_defs -> v_name ->> 'opts') || ')' END,
                       v_defs -> v_name ->> 'sql');
        FOR g IN SELECT x ->> 'who' AS who, x ->> 'what' AS what FROM jsonb_array_elements(v_defs -> v_name -> 'grants') x LOOP
            EXECUTE format('GRANT %s ON public.%I TO %I', g.what, v_name, g.who);
        END LOOP;
    END LOOP;
END $$;

-- Regular orders keep an amount per weekday in an array.
ALTER TABLE public.regular_orders
    ALTER COLUMN day_qty TYPE NUMERIC(14,1)[],
    ALTER COLUMN pending_day_qty TYPE NUMERIC(14,1)[];
