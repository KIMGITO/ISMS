-- A paid till sale is saved in one step, and its money figures must match its items
-- (security review 2026-11-23, finding FIN-01).
--
-- Before: record_till_sale stored the header totals exactly as the till sent them. A sale
-- could take KSh 200.00 of goods out of stock and book KSh 1.00, with no discount recorded,
-- so the gap showed nowhere. And most paid sales did not use this function at all: the app
-- inserted the header and the items as two requests, so a dropped connection could leave
-- money booked with no items and no stock moved (FIN-02).
--
-- Now record_till_sale checks, within cent rounding:
--   total        = sum of unit price x quantity of the items
--   discount     between 0 and the total
--   final_total  = total - discount + tax, plus up to the delivery fee (charged deliveries)
-- and rejects anything else with a plain message. Quantities must be above 0, prices and
-- discounts not negative. The app sends every paid sale here (same release), so header
-- and items are saved together or not at all.
--
-- A repeat of a sale already saved (same reference_id) returns that sale, as before. If
-- that earlier sale was saved by an older app without its items, the items are added now
-- (what syncOfflineSale did on the client).
--
-- Customer and credit sales (process_customer_transaction, also used by regular orders) get the
-- same check. Older installed apps still insert cash sales directly;
-- direct inserts get the same check once every device has updated (docs/security/threat-register.md, FIN-02).

-- The one check, shared by paid sales (record_till_sale) and customer/credit sales
-- (process_customer_transaction, which regular orders also use). Raises a plain message.
CREATE OR REPLACE FUNCTION public.fn_check_sale_totals(p_total numeric, p_discount numeric, p_tax numeric,
    p_final numeric, p_fee numeric, p_items jsonb)
 RETURNS void
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
DECLARE
    v_lines numeric;
    v_n     integer;
    v_bad   integer;
    v_tol   numeric;
    v_base  numeric;
    v_disc  numeric := COALESCE(p_discount, 0);
    v_tax   numeric := COALESCE(p_tax, 0);
    v_fee   numeric := COALESCE(p_fee, 0);
BEGIN
    IF jsonb_typeof(COALESCE(p_items, '[]'::jsonb)) <> 'array' OR jsonb_array_length(COALESCE(p_items, '[]'::jsonb)) = 0 THEN
        RAISE EXCEPTION 'The cart is empty.';
    END IF;
    SELECT count(*),
           COALESCE(sum(round(x.unit_price * x.quantity, 2)), 0),
           count(*) FILTER (WHERE x.quantity IS NULL OR x.quantity <= 0 OR x.unit_price IS NULL OR x.unit_price < 0
                            OR COALESCE(x.discount_percentage, 0) < 0 OR COALESCE(x.discount_percentage, 0) > 100)
      INTO v_n, v_lines, v_bad
      FROM jsonb_to_recordset(p_items) AS x(unit_price numeric, quantity numeric, discount_percentage numeric);
    IF v_bad > 0 THEN
        RAISE EXCEPTION 'Each item needs a quantity above 0, a price of 0 or more and a discount from 0 to 100%%.';
    END IF;
    IF p_total IS NULL OR p_final IS NULL OR v_disc < 0 OR v_tax < 0 OR v_fee < 0 THEN
        RAISE EXCEPTION 'This sale is missing its total. Please try again.';
    END IF;
    v_tol := 0.01 * v_n + 0.01;
    IF abs(p_total - v_lines) > v_tol THEN
        RAISE EXCEPTION 'The sale total (KSh %) does not match its items (KSh %). Please check the cart and try again.',
            to_char(p_total, 'FM999,999,999,990.00'), to_char(v_lines, 'FM999,999,999,990.00');
    END IF;
    IF v_disc > p_total + v_tol THEN
        RAISE EXCEPTION 'The discount is more than the sale total.';
    END IF;
    v_base := p_total - v_disc + v_tax;
    IF p_final < v_base - v_tol OR p_final > v_base + v_fee + v_tol THEN
        RAISE EXCEPTION 'The amount to pay (KSh %) does not match the items, discount and VAT (KSh %). Please check the cart and try again.',
            to_char(p_final, 'FM999,999,999,990.00'), to_char(v_base, 'FM999,999,999,990.00');
    END IF;
END;
$function$;
REVOKE ALL ON FUNCTION public.fn_check_sale_totals(numeric, numeric, numeric, numeric, numeric, jsonb) FROM PUBLIC, anon;
-- record_till_sale runs as the caller, so signed-in staff need to run the check.
GRANT EXECUTE ON FUNCTION public.fn_check_sale_totals(numeric, numeric, numeric, numeric, numeric, jsonb) TO authenticated, service_role;

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
        delivery_fee, delivery_mode, rider_pay, rider_name, reference_id, promotion_redemption_id)
    VALUES (COALESCE((p_sale->>'id')::uuid, gen_random_uuid()), v_b,
        v_total, v_disc, v_tax, v_final, v_final, 0,
        (p_sale->>'payment_method')::public.payment_method, (p_sale->>'customer_id')::uuid, NULLIF(p_sale->>'customer_name', ''),
        (p_sale->>'staff_id')::uuid, COALESCE(p_sale->>'staff_name', 'Staff'), 'Synced',
        COALESCE((p_sale->>'timestamp')::timestamptz, now()), p_sale->>'note', COALESCE((p_sale->>'is_delivery')::boolean, false),
        COALESCE((p_sale->>'delivery_fee')::numeric, 0),
        CASE WHEN COALESCE((p_sale->>'is_delivery')::boolean, false) THEN COALESCE(p_sale->>'delivery_mode', 'charged') ELSE 'charged' END,
        CASE WHEN COALESCE((p_sale->>'is_delivery')::boolean, false) THEN GREATEST(COALESCE((p_sale->>'rider_pay')::numeric, 0), 0) ELSE 0 END,
        NULLIF(p_sale->>'rider_name', ''), v_ref, (p_sale->>'promotion_redemption_id')::uuid)
    RETURNING id INTO v_id;
    INSERT INTO public.transaction_items (transaction_id, product_id, product_name, unit_price, quantity, discount_percentage, line_total)
    SELECT v_id, x.product_id, COALESCE(x.product_name, 'Item'), x.unit_price, x.quantity, COALESCE(x.discount_percentage, 0),
           round(x.unit_price * (1 - COALESCE(x.discount_percentage, 0) / 100) * x.quantity, 2)
    FROM jsonb_to_recordset(p_items) AS x(product_id uuid, product_name text, unit_price numeric, quantity numeric, discount_percentage numeric);
    RETURN v_id;
END;
$function$;

-- Customer and credit sales: the same check, right after the repeat check. Otherwise unchanged.
CREATE OR REPLACE FUNCTION public.process_customer_transaction(p_business_id uuid, p_customer_id uuid, p_customer_name text, p_staff_id uuid, p_staff_name text, p_total numeric, p_discount numeric, p_tax numeric, p_final_total numeric, p_amount_paid numeric, p_payment_method payment_method, p_timestamp timestamp with time zone, p_note text, p_is_delivery boolean, p_delivery_fee numeric, p_rider_name text, p_reference_id text, p_items jsonb, p_delivery_mode text DEFAULT 'charged'::text, p_rider_pay numeric DEFAULT 0, p_promotion_redemption_id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_tx_id          UUID;
    v_wallet_before  NUMERIC(14,2);
    v_wallet_after   NUMERIC(14,2);
    v_debt_before    NUMERIC(14,2);
    v_debt_after     NUMERIC(14,2);
    v_wallet_used    NUMERIC(14,2);
    v_debt_created   NUMERIC(14,2);
    v_item           JSONB;
    v_line_total     NUMERIC(14,2);
BEGIN
    PERFORM public.assert_permission(p_business_id, 'pos.create_sale');
    PERFORM public.assert_business_member(p_business_id); IF p_customer_id IS NOT NULL THEN PERFORM public.assert_business_member((SELECT business_id FROM public.customers WHERE id = p_customer_id)); END IF; PERFORM public.assert_business_member(pr.business_id) FROM public.products pr WHERE pr.id IN (SELECT (e->>'product_id')::UUID FROM jsonb_array_elements(COALESCE(p_items, '[]'::JSONB)) e WHERE e->>'product_id' IS NOT NULL);
    -- Idempotency check: if this reference_id was already processed, return existing tx
    IF p_reference_id IS NOT NULL THEN
        SELECT id INTO v_tx_id
        FROM public.transactions
        WHERE business_id = p_business_id
          AND reference_id = p_reference_id
          AND deleted_at IS NULL;

        IF FOUND THEN
            RETURN v_tx_id;
        END IF;
    END IF;

    -- The money figures must match the items (20261201002).
    PERFORM public.fn_check_sale_totals(p_total, p_discount, p_tax, p_final_total,
        CASE WHEN COALESCE(p_is_delivery, FALSE) THEN COALESCE(p_delivery_fee, 0) ELSE 0 END, p_items);

    -- Validate customer exists
    IF NOT EXISTS (SELECT 1 FROM public.customers WHERE id = p_customer_id) THEN
        RAISE EXCEPTION 'Customer not found: %', p_customer_id;
    END IF;

    -- Fetch current balances
    SELECT wallet_balance, debt_balance
    INTO v_wallet_before, v_debt_before
    FROM public.customers
    WHERE id = p_customer_id;

    v_wallet_before := COALESCE(v_wallet_before, 0);
    v_debt_before   := COALESCE(v_debt_before, 0);

    -- Compute wallet usage and debt creation
    -- For credit sales: wallet is applied first, remaining becomes debt
    IF p_payment_method IN ('Credit_Debt', 'Credit') THEN
        v_wallet_used  := LEAST(v_wallet_before, p_final_total);
        v_debt_created := GREATEST(0, p_final_total - v_wallet_used);
    ELSE
        v_wallet_used  := 0;
        v_debt_created := 0;
    END IF;

    -- Insert transaction header
    INSERT INTO public.transactions
        (business_id, total, discount, tax, final_total, amount_paid,
         wallet_applied, payment_method, customer_id, customer_name,
         staff_id, staff_name, status, timestamp, note, is_delivery,
         delivery_fee, rider_name, reference_id, delivery_mode, rider_pay, promotion_redemption_id)
    VALUES (
        p_business_id, p_total, p_discount, p_tax, p_final_total,
        p_amount_paid, v_wallet_used, p_payment_method, p_customer_id,
        p_customer_name, p_staff_id, p_staff_name, 'Synced',
        COALESCE(p_timestamp, NOW()), p_note, COALESCE(p_is_delivery, FALSE),
        COALESCE(p_delivery_fee, 0), p_rider_name, p_reference_id,
        CASE WHEN COALESCE(p_is_delivery, FALSE) THEN COALESCE(p_delivery_mode, 'charged') ELSE 'charged' END,
        CASE WHEN COALESCE(p_is_delivery, FALSE) THEN GREATEST(COALESCE(p_rider_pay, 0), 0) ELSE 0 END,
        p_promotion_redemption_id
    )
    RETURNING id INTO v_tx_id;

    -- Insert transaction items
    IF p_items IS NOT NULL AND jsonb_array_length(p_items) > 0 THEN
        FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
        LOOP
            v_line_total := ROUND(
                (COALESCE((v_item->>'unit_price')::NUMERIC, 0) *
                 (1 - COALESCE((v_item->>'discount_percentage')::NUMERIC, 0) / 100)) *
                COALESCE((v_item->>'quantity')::NUMERIC, 1),
                2
            );

            INSERT INTO public.transaction_items
                (transaction_id, product_id, product_name, unit_price,
                 quantity, discount_percentage, line_total)
            VALUES (
                v_tx_id,
                (v_item->>'product_id')::UUID,
                COALESCE(v_item->>'product_name', 'Unknown Product'),
                COALESCE((v_item->>'unit_price')::NUMERIC, 0),
                COALESCE((v_item->>'quantity')::NUMERIC, 1),
                COALESCE((v_item->>'discount_percentage')::NUMERIC, 0),
                v_line_total
            );
        END LOOP;
    END IF;

    -- Apply wallet deduction
    IF v_wallet_used > 0 THEN
        v_wallet_after := GREATEST(0, v_wallet_before - v_wallet_used);

        UPDATE public.customers
        SET wallet_balance = v_wallet_after
        WHERE id = p_customer_id;

        INSERT INTO public.wallet_transactions
            (business_id, customer_id, amount, balance_before, balance_after,
             reason, transaction_id, recorded_by)
        VALUES (
            p_business_id, p_customer_id, -v_wallet_used,
            v_wallet_before, v_wallet_after,
            'Applied to checkout sale', v_tx_id, p_staff_name
        );

        INSERT INTO public.customer_ledger
            (business_id, customer_id, type, amount, wallet_balance, debt_balance,
             recorded_by, note, transaction_id, reference_id)
        VALUES (
            p_business_id, p_customer_id, 'wallet_usage', v_wallet_used,
            v_wallet_after, v_debt_before, p_staff_name,
            'Paid for order ' || v_tx_id::TEXT || ' using wallet credit',
            v_tx_id, 'tx-' || v_tx_id::TEXT || '-wallet-usage'
        )
        ON CONFLICT (business_id, reference_id) WHERE reference_id IS NOT NULL DO NOTHING;
    END IF;

    -- Create debt record if applicable
    IF v_debt_created > 0 THEN
        -- credit record: created by the sale trigger, once per sale

        v_debt_after := v_debt_before + v_debt_created;

        UPDATE public.customers
        SET debt_balance = v_debt_after
        WHERE id = p_customer_id;

        INSERT INTO public.customer_ledger
            (business_id, customer_id, type, amount, wallet_balance, debt_balance,
             recorded_by, note, transaction_id, reference_id)
        VALUES (
            p_business_id, p_customer_id, 'debt_creation', v_debt_created,
            COALESCE(v_wallet_after, v_wallet_before), v_debt_after, p_staff_name,
            'Outstanding balance for order ' || v_tx_id::TEXT || ' charged to debt',
            v_tx_id, 'tx-' || v_tx_id::TEXT || '-debt-creation'
        )
        ON CONFLICT (business_id, reference_id) WHERE reference_id IS NOT NULL DO NOTHING;
    END IF;

    RETURN v_tx_id;
END;
$function$;
