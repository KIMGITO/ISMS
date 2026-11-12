-- Receipt numbers were the same on many sales. Cash/M-Pesa/Card/Bank sales got the ID
-- "tx-<milliseconds>", stored as the hex of those characters, so every one started 74782d31
-- ("tx-1") and the receipt number (first 8 hex digits) was identical. New sales now get a
-- random ID; for the old ones the number is the last 8 hex digits of their time instead.
-- Must match getShortId() in src/utils/idUtils.ts.

CREATE OR REPLACE FUNCTION public.fn_short_id(p_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
    v_hex TEXT := replace(p_id::TEXT, '-', '');
BEGIN
    IF v_hex ~ '^74782d3[0-9](3[0-9]){12}$' THEN
        RETURN upper(right(lpad(to_hex(convert_from(decode(substr(v_hex, 7), 'hex'), 'UTF8')::BIGINT), 8, '0'), 8));
    END IF;
    RETURN upper(left(v_hex, 8));
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_receipt_number(p_id UUID)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT 'TXN-' || public.fn_short_id(p_id);
$$;

CREATE OR REPLACE FUNCTION public.fn_readable_ids(p_text TEXT)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
    v_out   TEXT := p_text;
    v_match TEXT[];
BEGIN
    IF p_text IS NULL THEN
        RETURN NULL;
    END IF;
    LOOP
        v_match := regexp_match(v_out, '(order #?)([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})', 'i');
        EXIT WHEN v_match IS NULL;
        v_out := replace(v_out, v_match[1] || v_match[2], 'receipt ' || public.fn_receipt_number(v_match[2]::UUID));
    END LOOP;
    LOOP
        v_match := regexp_match(v_out, '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}');
        EXIT WHEN v_match IS NULL;
        v_out := replace(v_out, v_match[1], public.fn_short_id(v_match[1]::UUID));
    END LOOP;
    RETURN v_out;
END;
$$;

-- Stock history written before this kept the repeated number. Each such row was written in
-- the same database transaction as its sale line, so the line's created_at is the same
-- moment: that finds the sale and gives the row its real receipt number.
UPDATE public.inventory_adjustments ia
SET reference_number = public.fn_receipt_number(m.transaction_id)
FROM (
    SELECT DISTINCT ON (ia2.id) ia2.id AS adj_id, ti.transaction_id
    FROM public.inventory_adjustments ia2
    JOIN public.transaction_items ti
      ON ti.product_id = ia2.product_id
     AND ti.created_at = ia2.created_at
     AND ti.quantity = -ia2.quantity_adjusted
    WHERE ia2.reference_number = 'TXN-74782D31'
    ORDER BY ia2.id, ti.transaction_id
) m
WHERE ia.id = m.adj_id;
