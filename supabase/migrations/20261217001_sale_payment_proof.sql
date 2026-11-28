-- 20261217001_sale_payment_proof
-- ===================================================================
-- Money first (owner, 2026-11-28): "Nothing is confirmed paid when money was not recorded.
-- Record money, then release the goods (or hold), then logs, receipt, stock and books."
--
-- Found: a till sale was born paid. record_till_sale wrote amount_paid = final_total for any
-- method, so one tap on M-Pesa, Airtel or Bank (POS, Quick Sale, a quote sold from the Sales
-- Log, a regular order marked delivered) credited the money balance, posted the books, took
-- the stock and printed a "Paid" receipt with no sign the money had arrived.
--
-- Fix: a staff-recorded sale paid by M-Pesa, Airtel Money or Bank must carry the payment's
-- code (payment_ref). The database refuses the sale without it, a code pays one sale only,
-- and an M-Pesa code that is already in the till queue (Daraja C2B) is matched to the sale
-- and must cover it. Cash is counted in hand; Card already needs an approved charge; Credit
-- is a debt, not money. Online orders are untouched: they settle only on the provider's
-- callback. Money, books and stock still move from the one sale row (money rule 2).
-- Removing a sale gives its till payment back to the queue (money rule 4).

ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS payment_ref text;
COMMENT ON COLUMN public.transactions.payment_ref IS
    'The code of the money that paid this sale (M-Pesa / Airtel transaction code, bank reference). Required for those methods when staff record the sale.';

-- "qk 12 ab-34" -> "QK12AB-34"; empty -> NULL.
CREATE OR REPLACE FUNCTION public.fn_tidy_payment_ref(p_ref text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = public AS $$
    SELECT NULLIF(upper(regexp_replace(COALESCE(p_ref, ''), '\s+', '', 'g')), '');
$$;
GRANT EXECUTE ON FUNCTION public.fn_tidy_payment_ref(text) TO authenticated, service_role;

-- One code pays one live sale.
CREATE UNIQUE INDEX IF NOT EXISTS transactions_payment_ref_uniq
    ON public.transactions (business_id, payment_ref)
    WHERE payment_ref IS NOT NULL AND deleted_at IS NULL;

-- Before a sale row is written: staff-recorded M-Pesa / Airtel / Bank money needs its code.
-- current_user is 'authenticated' for the app's own inserts and record_till_sale (invoker);
-- server-side settlement (online orders on the provider's callback) runs as the owner and is
-- proven by the provider. deliver_regular_orders asks for the check with isms.need_payment_ref.
CREATE OR REPLACE FUNCTION public.fn_sale_needs_payment_ref() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
    v_need boolean := current_user = 'authenticated' OR COALESCE(current_setting('isms.need_payment_ref', true), '') = 'on';
BEGIN
    NEW.payment_ref := public.fn_tidy_payment_ref(COALESCE(NEW.payment_ref, NULLIF(current_setting('isms.payment_ref', true), '')));
    IF NEW.payment_method IN ('M-Pesa', 'Airtel Money', 'Bank') AND COALESCE(NEW.amount_paid, 0) > 0 AND v_need THEN
        IF NEW.payment_ref IS NULL THEN
            RAISE EXCEPTION 'Record the money first: enter the % code of this payment. Not paid yet? Hold the sale.',
                CASE NEW.payment_method WHEN 'Bank' THEN 'bank' ELSE NEW.payment_method::text END;
        END IF;
        IF length(NEW.payment_ref) < 6 OR length(NEW.payment_ref) > 40 OR NEW.payment_ref !~ '^[A-Z0-9/_.-]+$' THEN
            RAISE EXCEPTION 'That payment code doesn''t look right. Check it against the message (letters and numbers, at least 6).';
        END IF;
    END IF;
    IF NEW.payment_ref IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.transactions t
        WHERE t.business_id = NEW.business_id AND t.payment_ref = NEW.payment_ref
          AND t.deleted_at IS NULL AND t.id IS DISTINCT FROM NEW.id) THEN
        RAISE EXCEPTION 'The code % already paid another sale. Check the message again.', NEW.payment_ref;
    END IF;
    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_sale_needs_payment_ref ON public.transactions;
CREATE TRIGGER trg_sale_needs_payment_ref BEFORE INSERT ON public.transactions
    FOR EACH ROW EXECUTE FUNCTION public.fn_sale_needs_payment_ref();

-- The code can't be swapped after the sale is saved (money rule 4: remove and record again).
CREATE OR REPLACE FUNCTION public.fn_sale_payment_ref_fixed() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
    IF NEW.payment_ref IS DISTINCT FROM OLD.payment_ref THEN
        RAISE EXCEPTION 'A sale''s payment code can''t be changed. Remove the sale and record it again.';
    END IF;
    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_sale_payment_ref_fixed ON public.transactions;
CREATE TRIGGER trg_sale_payment_ref_fixed BEFORE UPDATE OF payment_ref ON public.transactions
    FOR EACH ROW EXECUTE FUNCTION public.fn_sale_payment_ref_fixed();

-- After the row exists: an M-Pesa code that already arrived at the till is matched to the sale
-- (no money moves here; the sale row already did that once). It must cover the sale.
CREATE OR REPLACE FUNCTION public.fn_sale_match_till_payment() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_row    public.mpesa_till_payments%ROWTYPE;
    v_left   numeric(14,2);
    v_amt    numeric(14,2);
    v_status text;
    v_by     text := COALESCE(NULLIF(NEW.staff_name, ''), 'Staff');
    v_ref    text := COALESCE(NEW.reference_id, left(NEW.id::text, 8));
BEGIN
    IF NEW.payment_ref IS NULL OR NEW.payment_method <> 'M-Pesa' THEN RETURN NEW; END IF;
    SELECT * INTO v_row FROM public.mpesa_till_payments
    WHERE business_id = NEW.business_id AND upper(trans_id) = NEW.payment_ref
    ORDER BY trans_time DESC LIMIT 1
    FOR UPDATE;
    IF NOT FOUND THEN RETURN NEW; END IF;  -- till not connected to Daraja, or the callback is late
    IF v_row.status NOT IN ('unclaimed', 'under_review', 'partial') THEN
        RAISE EXCEPTION 'The M-Pesa payment % was already used (%). Check the message again.',
            v_row.trans_id, replace(v_row.status, '_', ' ');
    END IF;
    v_left := v_row.amount - v_row.allocated;
    v_amt := round(NEW.final_total, 2);
    IF v_left + 0.004 < v_amt THEN
        RAISE EXCEPTION 'The M-Pesa payment % is KSh %, but this sale is KSh %. Take the rest another way.',
            v_row.trans_id, to_char(v_left, 'FM999,999,990.00'), to_char(v_amt, 'FM999,999,990.00');
    END IF;
    v_status := CASE WHEN v_left - v_amt <= 0 THEN 'matched_sale' ELSE 'partial' END;
    INSERT INTO public.mpesa_till_allocations (business_id, till_payment_id, sale_id, amount, allocated_by)
    VALUES (v_row.business_id, v_row.id, NEW.id, v_amt, v_by);
    INSERT INTO public.mpesa_till_payment_events (business_id, till_payment_id, trans_id, action, previous_status, new_status, amount, sale_id, staff_name, note)
    VALUES (v_row.business_id, v_row.id, v_row.trans_id, 'allocated', v_row.status, v_status, v_amt, NEW.id, v_by, 'Paid sale ' || v_ref);
    UPDATE public.mpesa_till_payments
    SET allocated = allocated + v_amt, status = v_status, sale_id = NEW.id,
        handled_by = v_by, handled_at = now(), note = 'Sale ' || v_ref
    WHERE id = v_row.id;
    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_sale_match_till_payment ON public.transactions;
CREATE TRIGGER trg_sale_match_till_payment AFTER INSERT ON public.transactions
    FOR EACH ROW EXECUTE FUNCTION public.fn_sale_match_till_payment();

-- A removed sale gives its till money back to the queue, so it can pay the sale recorded again.
CREATE OR REPLACE FUNCTION public.fn_sale_release_till_payment() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    a     record;
    v_by  text := COALESCE(NULLIF(NEW.last_modified_by, ''), 'Staff');
BEGIN
    IF OLD.deleted_at IS NOT NULL OR NEW.deleted_at IS NULL THEN RETURN NEW; END IF;
    FOR a IN SELECT * FROM public.mpesa_till_allocations WHERE sale_id = NEW.id AND reversed_at IS NULL FOR UPDATE LOOP
        UPDATE public.mpesa_till_allocations
        SET reversed_at = now(), reversed_by = v_by, reverse_reason = 'Sale removed'
        WHERE id = a.id;
        UPDATE public.mpesa_till_payments p
        SET allocated = GREATEST(p.allocated - a.amount, 0),
            status = CASE WHEN p.status IN ('matched_sale', 'partial')
                          THEN CASE WHEN p.allocated - a.amount > 0 THEN 'partial' ELSE 'unclaimed' END
                          ELSE p.status END,
            sale_id = CASE WHEN p.sale_id = NEW.id THEN NULL ELSE p.sale_id END,
            handled_by = v_by, handled_at = now()
        WHERE p.id = a.till_payment_id;
        INSERT INTO public.mpesa_till_payment_events (business_id, till_payment_id, trans_id, action, amount, sale_id, staff_name, note)
        SELECT p.business_id, p.id, p.trans_id, 'unallocated', a.amount, NEW.id, v_by, 'Sale removed'
        FROM public.mpesa_till_payments p WHERE p.id = a.till_payment_id;
    END LOOP;
    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_sale_release_till_payment ON public.transactions;
CREATE TRIGGER trg_sale_release_till_payment AFTER UPDATE OF deleted_at ON public.transactions
    FOR EACH ROW EXECUTE FUNCTION public.fn_sale_release_till_payment();

-- Till sales: the code travels in p_sale.payment_ref. Otherwise unchanged.
CREATE OR REPLACE FUNCTION public.record_till_sale(p_sale jsonb, p_items jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
    v_id    uuid;
    v_b     uuid := (p_sale->>'business_id')::uuid;
    v_ref   text := NULLIF(p_sale->>'reference_id', '');
    v_total numeric := (p_sale->>'total')::numeric;
    v_disc  numeric := COALESCE((p_sale->>'discount')::numeric, 0);
    v_tax   numeric := COALESCE((p_sale->>'tax')::numeric, 0);
    v_final numeric := (p_sale->>'final_total')::numeric;
    v_pref  text := public.fn_tidy_payment_ref(p_sale->>'payment_ref');
    v_fee   numeric := CASE WHEN COALESCE((p_sale->>'is_delivery')::boolean, false)
                            THEN COALESCE((p_sale->>'delivery_fee')::numeric, 0) ELSE 0 END;
BEGIN
    IF jsonb_typeof(COALESCE(p_items, '[]'::jsonb)) <> 'array' OR jsonb_array_length(COALESCE(p_items, '[]'::jsonb)) = 0 THEN
        RAISE EXCEPTION 'The cart is empty.';
    END IF;

    IF v_ref IS NOT NULL THEN
        SELECT id INTO v_id FROM public.transactions WHERE business_id = v_b AND reference_id = v_ref AND deleted_at IS NULL;
        IF FOUND THEN
            -- Saved before by an older app whose items request never arrived: add them now.
            IF NOT EXISTS (SELECT 1 FROM public.transaction_items WHERE transaction_id = v_id) THEN
                INSERT INTO public.transaction_items (transaction_id, product_id, product_name, unit_price, quantity, discount_percentage, line_total)
                SELECT v_id, x.product_id, COALESCE(x.product_name, 'Item'), x.unit_price, x.quantity, COALESCE(x.discount_percentage, 0),
                       round(x.unit_price * (1 - COALESCE(x.discount_percentage, 0) / 100) * x.quantity, 2)
                FROM jsonb_to_recordset(p_items) AS x(product_id uuid, product_name text, unit_price numeric, quantity numeric, discount_percentage numeric);
            END IF;
            RETURN v_id;
        END IF;
    END IF;

    IF COALESCE(p_sale->>'payment_method', '') IN ('Credit', 'Credit_Debt') THEN
        RAISE EXCEPTION 'Credit sales are saved with process_customer_transaction.';
    END IF;

    PERFORM public.fn_check_sale_totals(v_total, v_disc, v_tax, v_final, v_fee, p_items);

    INSERT INTO public.transactions (id, business_id, total, discount, tax, final_total, amount_paid, wallet_applied,
        payment_method, customer_id, customer_name, staff_id, staff_name, status, timestamp, note, is_delivery,
        delivery_fee, delivery_mode, rider_pay, rider_name, reference_id, promotion_redemption_id, payment_ref)
    VALUES (COALESCE((p_sale->>'id')::uuid, gen_random_uuid()), v_b,
        v_total, v_disc, v_tax, v_final, v_final, 0,
        (p_sale->>'payment_method')::public.payment_method, (p_sale->>'customer_id')::uuid, NULLIF(p_sale->>'customer_name', ''),
        (p_sale->>'staff_id')::uuid, COALESCE(p_sale->>'staff_name', 'Staff'), 'Synced',
        COALESCE((p_sale->>'timestamp')::timestamptz, now()), p_sale->>'note', COALESCE((p_sale->>'is_delivery')::boolean, false),
        COALESCE((p_sale->>'delivery_fee')::numeric, 0),
        CASE WHEN COALESCE((p_sale->>'is_delivery')::boolean, false) THEN COALESCE(p_sale->>'delivery_mode', 'charged') ELSE 'charged' END,
        CASE WHEN COALESCE((p_sale->>'is_delivery')::boolean, false) THEN GREATEST(COALESCE((p_sale->>'rider_pay')::numeric, 0), 0) ELSE 0 END,
        NULLIF(p_sale->>'rider_name', ''), v_ref, (p_sale->>'promotion_redemption_id')::uuid, v_pref)
    RETURNING id INTO v_id;
    INSERT INTO public.transaction_items (transaction_id, product_id, product_name, unit_price, quantity, discount_percentage, line_total)
    SELECT v_id, x.product_id, COALESCE(x.product_name, 'Item'), x.unit_price, x.quantity, COALESCE(x.discount_percentage, 0),
           round(x.unit_price * (1 - COALESCE(x.discount_percentage, 0) / 100) * x.quantity, 2)
    FROM jsonb_to_recordset(p_items) AS x(product_id uuid, product_name text, unit_price numeric, quantity numeric, discount_percentage numeric);
    RETURN v_id;
END;
$function$;


-- Regular orders: M-Pesa / Airtel / Bank days need the payment's code (new last argument).
DROP FUNCTION IF EXISTS public.deliver_regular_orders(uuid, uuid, date, jsonb, text, text, numeric, text, text);
CREATE OR REPLACE FUNCTION public.deliver_regular_orders(
    p_business_id uuid, p_customer_id uuid, p_day date, p_lines jsonb, p_payment_method text,
    p_rider_name text, p_rider_pay numeric, p_reference_id text, p_note text, p_payment_ref text DEFAULT NULL)
    RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
    v_today    date := public.fn_nairobi_today();
    v_by       text := public.fn_my_name();
    v_c        public.customers%ROWTYPE;
    v_line     jsonb;
    v_o        public.regular_orders%ROWTYPE;
    v_p        public.products%ROWTYPE;
    v_qty      numeric(12,3);
    v_items    jsonb := '[]'::jsonb;
    v_done     jsonb := '[]'::jsonb;
    v_subtotal numeric(14,2) := 0;
    v_tax      numeric(14,2) := 0;
    v_final    numeric(14,2);
    v_delivery boolean := FALSE;
    v_tx       uuid;
    v_method   public.payment_method;
    v_ref      text := NULLIF(trim(COALESCE(p_reference_id, '')), '');
    v_note     text;
    v_pref     text := public.fn_tidy_payment_ref(p_payment_ref);
BEGIN
    PERFORM public.assert_permission(p_business_id, 'pos.create_sale');
    IF v_ref IS NULL THEN RAISE EXCEPTION 'Missing reference.'; END IF;

    -- Already recorded (a double tap or a retry after a dropped connection).
    SELECT id INTO v_tx FROM public.transactions
    WHERE business_id = p_business_id AND reference_id = v_ref AND deleted_at IS NULL;
    IF FOUND THEN RETURN v_tx; END IF;

    IF p_day IS NULL OR p_day > v_today THEN RAISE EXCEPTION 'You can only mark today or an earlier day delivered.'; END IF;
    IF p_day < v_today - 31 THEN RAISE EXCEPTION 'That day is too long ago. Record it as a normal sale.'; END IF;
    BEGIN
        v_method := p_payment_method::public.payment_method;
    EXCEPTION WHEN invalid_text_representation THEN
        RAISE EXCEPTION 'Choose how it was paid.';
    END;
    IF v_method NOT IN ('Credit_Debt', 'Cash', 'M-Pesa', 'Airtel Money', 'Card', 'Bank') THEN
        RAISE EXCEPTION 'Choose how it was paid.';
    END IF;
    -- Money first: M-Pesa, Airtel and bank need the payment's code before the day is marked delivered.
    IF v_method IN ('M-Pesa', 'Airtel Money', 'Bank') THEN
        IF v_pref IS NULL THEN
            RAISE EXCEPTION 'Enter the % code of the payment first. Not paid yet? Choose Credit.',
                CASE v_method WHEN 'Bank' THEN 'bank' ELSE v_method::text END;
        END IF;
        PERFORM set_config('isms.payment_ref', v_pref, true);
        PERFORM set_config('isms.need_payment_ref', 'on', true);
    ELSE
        PERFORM set_config('isms.payment_ref', '', true);
    END IF;
    IF COALESCE(p_rider_pay, 0) < 0 THEN RAISE EXCEPTION 'Rider pay can''t be negative.'; END IF;

    SELECT * INTO v_c FROM public.customers WHERE id = p_customer_id AND business_id = p_business_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Customer not found at this branch.'; END IF;
    IF jsonb_typeof(p_lines) IS DISTINCT FROM 'array' OR jsonb_array_length(p_lines) = 0 THEN
        RAISE EXCEPTION 'Nothing to deliver.';
    END IF;

    FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
        v_qty := round(COALESCE((v_line->>'quantity')::numeric, 0), 3);
        CONTINUE WHEN v_qty <= 0;
        IF v_qty > 100000 THEN RAISE EXCEPTION 'Check the quantities.'; END IF;
        SELECT * INTO v_o FROM public.regular_orders
        WHERE id = (v_line->>'orderId')::uuid AND business_id = p_business_id
          AND customer_id = p_customer_id AND deleted_at IS NULL
        FOR UPDATE;
        IF NOT FOUND THEN RAISE EXCEPTION 'Regular order not found for this customer.'; END IF;
        IF v_o.status IN ('requested', 'declined') THEN RAISE EXCEPTION 'That regular order is not approved.'; END IF;
        IF EXISTS (SELECT 1 FROM public.regular_order_days WHERE regular_order_id = v_o.id AND day = p_day AND status = 'delivered') THEN
            RAISE EXCEPTION 'Already marked delivered for that day.';
        END IF;
        SELECT * INTO v_p FROM public.products WHERE id = v_o.product_id AND deleted_at IS NULL;
        IF NOT FOUND THEN RAISE EXCEPTION 'A product on this order was removed.'; END IF;

        v_items := v_items || jsonb_build_array(jsonb_build_object(
            'product_id', v_p.id, 'product_name', v_p.name, 'unit_price', v_p.price,
            'quantity', v_qty, 'discount_percentage', 0));
        v_done := v_done || jsonb_build_array(jsonb_build_object('orderId', v_o.id, 'quantity', v_qty));
        v_subtotal := v_subtotal + round(v_p.price * v_qty, 2);
        v_delivery := v_delivery OR v_o.fulfilment = 'delivery';
    END LOOP;
    IF jsonb_array_length(v_items) = 0 THEN RAISE EXCEPTION 'Enter a quantity to deliver.'; END IF;

    -- VAT exactly as the till: only with KRA eTIMS connected and tax switched on.
    IF public.vat_allowed(p_business_id) THEN
        v_tax := round(v_subtotal * COALESCE((SELECT tax_percentage FROM public.businesses WHERE id = p_business_id), 0) / 100, 2);
    END IF;
    v_final := v_subtotal + v_tax;
    v_note := 'Regular order for ' || to_char(p_day, 'Dy DD Mon') || COALESCE('. ' || NULLIF(trim(COALESCE(p_note, '')), ''), '');

    v_tx := public.process_customer_transaction(
        p_business_id, p_customer_id, v_c.name, NULL, v_by,
        v_subtotal, 0, v_tax, v_final,
        CASE WHEN v_method = 'Credit_Debt' THEN 0 ELSE v_final END,
        v_method, NOW(), v_note,
        v_delivery, 0, NULLIF(trim(COALESCE(p_rider_name, '')), ''), v_ref, v_items,
        'free', CASE WHEN v_delivery THEN COALESCE(p_rider_pay, 0) ELSE 0 END, NULL);

    IF v_delivery THEN
        UPDATE public.transactions SET delivery_status = 'delivered', delivered_at = NOW()
        WHERE id = v_tx AND delivery_status IS DISTINCT FROM 'delivered';
    END IF;

    INSERT INTO public.regular_order_days (business_id, regular_order_id, day, status, quantity, transaction_id, by_name, message)
    SELECT p_business_id, (d->>'orderId')::uuid, p_day, 'delivered', (d->>'quantity')::numeric, v_tx, v_by, NULL
    FROM jsonb_array_elements(v_done) d
    ON CONFLICT (regular_order_id, day) DO UPDATE
    SET status = 'delivered', quantity = EXCLUDED.quantity, transaction_id = EXCLUDED.transaction_id,
        by_name = EXCLUDED.by_name, message = NULL;

    PERFORM set_config('isms.payment_ref', '', true);
    PERFORM set_config('isms.need_payment_ref', '', true);
    PERFORM public.fn_regular_orders_quiet(p_business_id);
    RETURN v_tx;
END;
$$;
REVOKE ALL ON FUNCTION public.deliver_regular_orders(uuid, uuid, date, jsonb, text, text, numeric, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.deliver_regular_orders(uuid, uuid, date, jsonb, text, text, numeric, text, text, text) TO authenticated, service_role;
