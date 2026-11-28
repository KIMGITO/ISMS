-- An M-Pesa prompt (STK push) can be linked to the sale it is for BEFORE it is sent.
--
-- Money rule 2: like a till payment linked to a sale (20261212005), the link moves no money.
-- The M-Pesa sale already counted its money when it was rung up; the paid prompt is the proof
-- that the money arrived. So a paid, linked prompt makes no second payment row.
--
-- Money rule 1: if the sale was removed, or is already covered, by the time the money arrives,
-- the money is still recorded, as a normal walk-in / customer payment (never lost).
--
-- mpesa_transactions.transaction_id already existed (online orders set it after payment, with
-- online_order_id set). Shop prompts use it for the sale they were sent for.

CREATE INDEX IF NOT EXISTS mpesa_transactions_sale_idx
    ON public.mpesa_transactions (transaction_id)
    WHERE transaction_id IS NOT NULL AND online_order_id IS NULL;

-- Everything already proving a sale's M-Pesa money: linked till payments, plus linked prompts
-- that are paid or still waiting (a waiting prompt holds its room so two can't cover one sale).
CREATE OR REPLACE FUNCTION public.fn_sale_till_linked(p_sale_id uuid) RETURNS numeric
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT (
        COALESCE((SELECT SUM(amount) FROM public.mpesa_till_payments
                  WHERE sale_id = p_sale_id AND status = 'matched_sale'), 0)
      + COALESCE((SELECT SUM(amount) FROM public.mpesa_transactions
                  WHERE transaction_id = p_sale_id AND online_order_id IS NULL
                    AND status IN ('Pending', 'Completed')), 0)
    )::numeric(14,2);
$$;
REVOKE ALL ON FUNCTION public.fn_sale_till_linked(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_sale_till_linked(uuid) TO service_role;

-- Checked by the mpesa-payments function before it asks Safaricom to send the prompt.
-- Returns the sale's receipt number; raises a plain-language reason when it can't be sent.
CREATE OR REPLACE FUNCTION public.check_sale_prompt(
    p_business_id uuid,
    p_sale_id uuid,
    p_amount numeric
) RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_sale public.transactions%ROWTYPE;
    v_room numeric;
BEGIN
    SELECT * INTO v_sale FROM public.transactions WHERE id = p_sale_id;
    IF NOT FOUND OR v_sale.business_id <> p_business_id OR v_sale.deleted_at IS NOT NULL THEN
        RAISE EXCEPTION 'Sale not found.';
    END IF;
    IF v_sale.payment_method <> 'M-Pesa' THEN
        RAISE EXCEPTION 'Only a sale paid by M-Pesa can be paid with a prompt.';
    END IF;
    v_room := v_sale.final_total - public.fn_sale_till_linked(v_sale.id);
    IF v_room < 1 THEN
        RAISE EXCEPTION 'This sale is already paid or has a prompt waiting.';
    END IF;
    IF p_amount > v_room THEN
        RAISE EXCEPTION 'The prompt is more than the sale still needs (KSh %).', to_char(v_room, 'FM999,999,990.00');
    END IF;
    RETURN COALESCE(v_sale.reference_id, left(v_sale.id::text, 8));
END;
$$;
REVOKE ALL ON FUNCTION public.check_sale_prompt(uuid, uuid, numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_sale_prompt(uuid, uuid, numeric) TO service_role;

CREATE OR REPLACE FUNCTION "public"."confirm_store_payment_request"("p_checkout_request_id" "text", "p_result_code" integer, "p_amount" numeric, "p_receipt" "text", "p_raw" "jsonb") RETURNS "text"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
    v_req     public.mpesa_transactions%ROWTYPE;
    v_name    TEXT;
    v_pid     UUID;
    v_amount  NUMERIC;
    v_sale    public.transactions%ROWTYPE;
    v_other   NUMERIC;
BEGIN
    SELECT * INTO v_req FROM public.mpesa_transactions
    WHERE checkout_request_id = p_checkout_request_id
      AND online_order_id IS NULL AND business_id IS NOT NULL
    FOR UPDATE;
    IF NOT FOUND THEN
        RETURN 'unknown';
    END IF;
    IF v_req.status = 'Completed' OR (v_req.status <> 'Pending' AND p_result_code <> 0) THEN
        RETURN 'duplicate';
    END IF;

    IF p_result_code <> 0 THEN
        UPDATE public.mpesa_transactions
        SET status = 'Failed', raw_callback = COALESCE(p_raw, raw_callback), updated_at = NOW()
        WHERE id = v_req.id;
        RETURN 'failed';
    END IF;

    IF p_receipt IS NULL THEN
        RAISE EXCEPTION 'A successful M-Pesa result arrived without a receipt number.';
    END IF;

    v_amount := COALESCE(p_amount, v_req.amount);

    -- Prompt sent for a sale: the sale already counted this money. Only the proof is stored,
    -- as long as the sale still exists and this doesn't take it over its total.
    IF v_req.transaction_id IS NOT NULL THEN
        SELECT * INTO v_sale FROM public.transactions WHERE id = v_req.transaction_id FOR UPDATE;
        IF FOUND AND v_sale.deleted_at IS NULL AND v_sale.payment_method = 'M-Pesa' THEN
            v_other := public.fn_sale_till_linked(v_sale.id) - v_req.amount;
            IF v_other + v_amount <= v_sale.final_total THEN
                UPDATE public.mpesa_transactions
                SET status = 'Completed', receipt_number = p_receipt, amount = v_amount,
                    mpesa_receipt_timestamp = NOW(), raw_callback = p_raw, updated_at = NOW()
                WHERE id = v_req.id;
                PERFORM public.fn_notify_staff(v_req.business_id, 'M-Pesa payment received',
                    format('Ksh %s for sale %s (%s).', v_amount,
                           COALESCE(v_sale.reference_id, left(v_sale.id::text, 8)), p_receipt),
                    jsonb_build_object('saleId', v_sale.id));
                RETURN 'matched_sale';
            END IF;
        END IF;
        -- The sale is gone or already covered: unlink and record the money as a payment below.
        UPDATE public.mpesa_transactions SET transaction_id = NULL WHERE id = v_req.id;
    END IF;

    SELECT name INTO v_name FROM public.customers WHERE id = v_req.customer_id;

    v_pid := public.process_business_payment(
        v_req.business_id, p_receipt, v_amount, 'M-Pesa',
        COALESCE(v_name, 'M-Pesa ' || v_req.phone), v_req.phone, 'Success', NOW(),
        v_req.customer_id, v_name,
        CASE WHEN v_req.customer_id IS NULL THEN 'walk-in' ELSE 'customer' END,
        COALESCE(v_req.description, 'M-Pesa prompt'), v_req.requested_by
    );

    UPDATE public.mpesa_transactions
    SET status = 'Completed', receipt_number = p_receipt,
        amount = v_amount, mpesa_receipt_timestamp = NOW(),
        raw_callback = p_raw, payment_id = v_pid, updated_at = NOW()
    WHERE id = v_req.id;

    PERFORM public.fn_notify_staff(v_req.business_id, 'M-Pesa payment received',
        format('Ksh %s from %s (%s).', v_amount, COALESCE(v_name, v_req.phone), p_receipt),
        jsonb_build_object('paymentId', v_pid));
    RETURN 'recorded';
END;
$$;
REVOKE ALL ON FUNCTION public.confirm_store_payment_request(text, integer, numeric, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_store_payment_request(text, integer, numeric, text, jsonb) TO service_role;
