-- People were shown database IDs: stock history said "Sold via order #3f2a9c1e-…" and a
-- customer's wallet history "Paid for order 3f2a9c1e-… using wallet credit".
-- Sales are now referred to by their receipt number as the Sales Log shows it (TXN-3F2A9C1E).

-- Receipt number for a sale, the same as formatReceiptNumber() in the app.
CREATE OR REPLACE FUNCTION public.fn_receipt_number(p_id UUID)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT 'TXN-' || upper(left(replace(p_id::TEXT, '-', ''), 8));
$$;

-- Replaces "order <uuid>" / "order #<uuid>" with "receipt TXN-…", and any other full ID
-- with its short form, so no text people read carries a raw ID.
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
        v_match := regexp_match(v_out, '([0-9a-fA-F]{8})-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}');
        EXIT WHEN v_match IS NULL;
        v_out := regexp_replace(v_out, '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}', upper(v_match[1]));
    END LOOP;
    RETURN v_out;
END;
$$;

-- 1. Stock leaving with a sale: reason "Sold", the receipt number as the reference.
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
         previous_stock, new_stock, reason, reference_number, staff_name)
    VALUES (
        v_business_id,
        NEW.product_id,
        COALESCE(v_prod_name, NEW.product_name),
        'Reconciliation',
        -NEW.quantity,
        v_old_stock,
        v_new_stock,
        'Sold',
        public.fn_receipt_number(NEW.transaction_id),
        COALESCE(v_staff_name, 'System')
    );

    RETURN NEW;
END;
$$;

-- 2. Notes on a customer's history are tidied as they are written, whichever function writes them.
CREATE OR REPLACE FUNCTION public.fn_customer_ledger_readable_note()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
    NEW.note := public.fn_readable_ids(NEW.note);
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_customer_ledger_readable_note ON public.customer_ledger;
CREATE TRIGGER trg_customer_ledger_readable_note
BEFORE INSERT OR UPDATE OF note ON public.customer_ledger
FOR EACH ROW EXECUTE FUNCTION public.fn_customer_ledger_readable_note();

-- 3. Rows already written.
UPDATE public.inventory_adjustments
SET reference_number = COALESCE(reference_number,
        public.fn_receipt_number((regexp_match(reason, '([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})'))[1]::UUID)),
    reason = 'Sold'
WHERE reason ~* '^Sold via order #?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';

UPDATE public.inventory_adjustments
SET reason = public.fn_readable_ids(reason), notes = public.fn_readable_ids(notes)
WHERE reason ~* '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
   OR notes  ~* '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';

UPDATE public.customer_ledger
SET note = public.fn_readable_ids(note)
WHERE note ~* '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
