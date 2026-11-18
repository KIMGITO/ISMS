-- Daily / monthly stock report, and transfer lines by date.
--
-- stock_period_report: for one branch and a time range, per product:
--   opening and closing stock (read from the stock log, which records every change with the
--   stock before and after, sales included), what came in and went out by kind, and the sales
--   grouped by customer, payment method and delivery. Plus who owes money now.
-- list_stock_transfer_lines: every product line sent or received in a date range, so the
--   transfers screen can show transfers per product, per branch, per day.
--
-- Read only. Both check membership and permission like the screens that call them.

CREATE OR REPLACE FUNCTION public.stock_period_report(p_business_id uuid, p_from timestamptz, p_to timestamptz)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
    v_products jsonb;
    v_sales jsonb;
    v_debts jsonb;
BEGIN
    PERFORM public.assert_business_member(p_business_id);
    PERFORM public.assert_permission(p_business_id, 'reports.inventory', 'reports.view', 'reports.sales', 'inventory.stock_history', 'finance.view');
    IF p_from IS NULL OR p_to IS NULL OR p_to <= p_from THEN
        RAISE EXCEPTION 'Pick a start that is before the end.';
    END IF;
    IF p_to - p_from > interval '400 days' THEN
        RAISE EXCEPTION 'Pick at most a year at a time.';
    END IF;

    -- Per product. Every change is measured as new_stock - previous_stock, so the parts add up
    -- to closing - opening; whatever no kind explains (sales logged, stock counts) is the rest.
    WITH adj AS (
        SELECT a.product_id, a.type::text AS kind, COALESCE(a.reason, '') AS reason,
               (a.new_stock - a.previous_stock) AS delta
        FROM public.inventory_adjustments a
        WHERE a.business_id = p_business_id AND a.timestamp >= p_from AND a.timestamp < p_to
    ),
    moves AS (
        SELECT product_id,
            SUM(delta) FILTER (WHERE kind = 'Restock' AND reason <> 'Returned') AS received,
            SUM(delta) FILTER (WHERE kind = 'Restock' AND reason = 'Returned') AS returned,
            SUM(delta) FILTER (WHERE kind = 'Transfer In') AS from_branches,
            SUM(delta) FILTER (WHERE kind IN ('Transfer Out', 'Transfer Return')) AS to_branches,
            SUM(delta) FILTER (WHERE kind = 'Production Output' OR (kind = 'Production Reversal' AND delta < 0)) AS made,
            SUM(delta) FILTER (WHERE kind = 'Production Consumption' OR (kind = 'Production Reversal' AND delta > 0)) AS used,
            SUM(delta) FILTER (WHERE kind IN ('Damage', 'Production Waste')) AS waste,
            SUM(delta) FILTER (WHERE kind = 'Supplier Return') AS to_supplier,
            SUM(delta) FILTER (WHERE kind = 'Reconciliation' AND reason = 'Sold') AS sold_logged,
            SUM(delta) FILTER (WHERE kind = 'Reconciliation' AND reason <> 'Sold') AS counted,
            COUNT(*) AS changes
        FROM adj GROUP BY product_id
    )
    SELECT COALESCE(jsonb_agg(row ORDER BY row->>'name'), '[]'::jsonb) INTO v_products
    FROM (
        SELECT jsonb_build_object(
            'id', p.id,
            'name', p.name,
            'unit', COALESCE(p.unit, ''),
            'price', p.price,
            'stockNow', p.stock,
            'opening', COALESCE(
                (SELECT a.new_stock FROM public.inventory_adjustments a
                  WHERE a.product_id = p.id AND a.timestamp < p_from ORDER BY a.timestamp DESC, a.created_at DESC LIMIT 1),
                (SELECT a.previous_stock FROM public.inventory_adjustments a
                  WHERE a.product_id = p.id AND a.timestamp >= p_from ORDER BY a.timestamp, a.created_at LIMIT 1),
                p.stock),
            'closing', COALESCE(
                (SELECT a.new_stock FROM public.inventory_adjustments a
                  WHERE a.product_id = p.id AND a.timestamp < p_to ORDER BY a.timestamp DESC, a.created_at DESC LIMIT 1),
                (SELECT a.previous_stock FROM public.inventory_adjustments a
                  WHERE a.product_id = p.id AND a.timestamp >= p_to ORDER BY a.timestamp, a.created_at LIMIT 1),
                p.stock),
            'received', COALESCE(m.received, 0),
            'returned', COALESCE(m.returned, 0),
            'fromBranches', COALESCE(m.from_branches, 0),
            'toBranches', COALESCE(-m.to_branches, 0),
            'made', COALESCE(m.made, 0),
            'used', COALESCE(-m.used, 0),
            'waste', COALESCE(-m.waste, 0),
            'toSupplier', COALESCE(-m.to_supplier, 0),
            'soldLogged', COALESCE(-m.sold_logged, 0),
            'counted', COALESCE(m.counted, 0),
            'changes', COALESCE(m.changes, 0)
        ) AS row
        FROM public.products p
        LEFT JOIN moves m ON m.product_id = p.id
        WHERE p.business_id = p_business_id
          AND (p.deleted_at IS NULL OR m.product_id IS NOT NULL)
    ) q;

    -- Sales in the range, grouped. Each line gets its share of what the sale charged (less any
    -- delivery fee), so discounts are spread fairly and the lines add up to the sale.
    WITH lines AS (
        SELECT t.id AS tx_id, t.customer_id, t.customer_name, t.payment_method::text AS method, t.is_delivery,
               ti.product_id, ti.quantity,
               COALESCE(ti.line_total, 0) AS line_total,
               GREATEST(t.final_total - CASE WHEN t.is_delivery THEN COALESCE(t.delivery_fee, 0) ELSE 0 END, 0) AS charged,
               SUM(COALESCE(ti.line_total, 0)) OVER (PARTITION BY t.id) AS tx_lines,
               COUNT(*) OVER (PARTITION BY t.id) AS tx_count
        FROM public.transactions t
        JOIN public.transaction_items ti ON ti.transaction_id = t.id
        WHERE t.business_id = p_business_id AND t.deleted_at IS NULL
          AND t.timestamp >= p_from AND t.timestamp < p_to
    )
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'productId', g.product_id,
        'customerId', g.customer_id,
        'customerName', g.customer_name,
        'customerType', g.customer_type,
        'method', g.method,
        'delivery', g.is_delivery,
        'qty', g.qty,
        'value', g.value,
        'sales', g.sales
    )), '[]'::jsonb) INTO v_sales
    FROM (
        SELECT l.product_id, l.customer_id,
               COALESCE(c.name, NULLIF(TRIM(l.customer_name), '')) AS customer_name,
               c.customer_type, l.method, l.is_delivery,
               SUM(l.quantity) AS qty,
               ROUND(SUM(CASE WHEN l.tx_lines > 0 THEN l.charged * l.line_total / l.tx_lines ELSE l.charged / l.tx_count END), 2) AS value,
               COUNT(DISTINCT l.tx_id) AS sales
        FROM lines l
        LEFT JOIN public.customers c ON c.id = l.customer_id
        GROUP BY l.product_id, l.customer_id, COALESCE(c.name, NULLIF(TRIM(l.customer_name), '')), c.customer_type, l.method, l.is_delivery
    ) g;

    -- Who owes money now (not as at the end of the range: debts are not logged per day).
    SELECT COALESCE(jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'owes', c.debt_balance) ORDER BY c.debt_balance DESC), '[]'::jsonb)
    INTO v_debts
    FROM public.customers c
    WHERE c.business_id = p_business_id AND c.deleted_at IS NULL AND c.debt_balance > 0;

    RETURN jsonb_build_object('products', v_products, 'sales', v_sales, 'debts', v_debts);
END;
$$;

ALTER FUNCTION public.stock_period_report(uuid, timestamptz, timestamptz) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.stock_period_report(uuid, timestamptz, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.stock_period_report(uuid, timestamptz, timestamptz) TO authenticated;


CREATE OR REPLACE FUNCTION public.list_stock_transfer_lines(p_business_id uuid, p_from timestamptz, p_to timestamptz)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
    v_out jsonb;
BEGIN
    PERFORM public.assert_business_member(p_business_id);
    PERFORM public.assert_permission(p_business_id, 'inventory.transfer_stock', 'inventory.receive_stock', 'inventory.stock_history', 'inventory.request_transfer');
    IF p_from IS NULL OR p_to IS NULL OR p_to <= p_from THEN
        RAISE EXCEPTION 'Pick a start that is before the end.';
    END IF;

    -- Only stock that actually moved: sent (on the way or received). Asked-for, drafts,
    -- declined and cancelled transfers moved nothing.
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'transferId', t.id,
        'reference', t.reference,
        'status', t.status,
        'direction', CASE WHEN t.from_business_id = p_business_id THEN 'out' ELSE 'in' END,
        'otherBranch', CASE WHEN t.from_business_id = p_business_id THEN bt.name ELSE bf.name END,
        'sentAt', t.sent_at,
        'receivedAt', t.received_at,
        'productName', i.product_name,
        'sku', i.sku,
        'unit', i.unit,
        'unitCost', i.unit_cost,
        'quantitySent', i.quantity_sent,
        'quantityReceived', i.quantity_received
    ) ORDER BY t.sent_at DESC, i.product_name), '[]'::jsonb) INTO v_out
    FROM public.stock_transfers t
    JOIN public.stock_transfer_items i ON i.transfer_id = t.id
    JOIN public.businesses bf ON bf.id = t.from_business_id
    JOIN public.businesses bt ON bt.id = t.to_business_id
    WHERE (t.from_business_id = p_business_id OR t.to_business_id = p_business_id)
      AND t.status IN ('in_transit', 'received')
      AND t.sent_at >= p_from AND t.sent_at < p_to;

    RETURN v_out;
END;
$$;

ALTER FUNCTION public.list_stock_transfer_lines(uuid, timestamptz, timestamptz) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.list_stock_transfer_lines(uuid, timestamptz, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_stock_transfer_lines(uuid, timestamptz, timestamptz) TO authenticated;
