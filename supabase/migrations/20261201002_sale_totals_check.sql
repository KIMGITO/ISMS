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
-- Credit sales still use their own path. Older installed apps still insert directly;
-- direct inserts get the same check once every device has updated (docs/security/threat-register.md, FIN-02).

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
    v_lines numeric;
    v_n     integer;
    v_bad   integer;
    v_tol   numeric;
    v_base  numeric;
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

    -- The money figures must match the items.
    SELECT count(*),
           COALESCE(sum(round(x.unit_price * x.quantity, 2)), 0),
           count(*) FILTER (WHERE x.quantity IS NULL OR x.quantity <= 0 OR x.unit_price IS NULL OR x.unit_price < 0
                            OR COALESCE(x.discount_percentage, 0) < 0 OR COALESCE(x.discount_percentage, 0) > 100)
      INTO v_n, v_lines, v_bad
      FROM jsonb_to_recordset(p_items) AS x(unit_price numeric, quantity numeric, discount_percentage numeric);
    IF v_bad > 0 THEN
        RAISE EXCEPTION 'Each item needs a quantity above 0, a price of 0 or more and a discount from 0 to 100%%.';
    END IF;
    IF v_total IS NULL OR v_final IS NULL OR v_disc < 0 OR v_tax < 0 OR v_fee < 0 THEN
        RAISE EXCEPTION 'This sale is missing its total. Please try again.';
    END IF;
    v_tol := 0.01 * v_n + 0.01;
    IF abs(v_total - v_lines) > v_tol THEN
        RAISE EXCEPTION 'The sale total (KSh %) does not match its items (KSh %). Please check the cart and try again.',
            to_char(v_total, 'FM999,999,999,990.00'), to_char(v_lines, 'FM999,999,999,990.00');
    END IF;
    IF v_disc > v_total + v_tol THEN
        RAISE EXCEPTION 'The discount is more than the sale total.';
    END IF;
    v_base := v_total - v_disc + v_tax;
    IF v_final < v_base - v_tol OR v_final > v_base + v_fee + v_tol THEN
        RAISE EXCEPTION 'The amount to pay (KSh %) does not match the items, discount and VAT (KSh %). Please check the cart and try again.',
            to_char(v_final, 'FM999,999,999,990.00'), to_char(v_base, 'FM999,999,999,990.00');
    END IF;

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
