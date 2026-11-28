-- M-Pesa "payment received" messages (2026-11-28).
--
-- 1. Sent only once the money is confirmed. The till no longer announces an M-Pesa sale when
--    it is saved (nothing had arrived yet). Confirmation is: a completed STK prompt
--    (confirm_store_payment_request), a till payment carrying the sale's receipt number
--    (record_till_payment), or staff matching a till payment to the sale (allocate_till_payment,
--    which also covers link_till_payment_to_sale). The last one sent no message before.
-- 2. Seen only by the person who made the sale (transactions.staff_id), never by the Owner or
--    other staff. A prompt not tied to a sale goes only to whoever sent it (requested_user_id,
--    set by the mpesa-payments function). Older prompts without it send no message.
--    Payments nobody started (paid to a customer's account number, or waiting to be assigned)
--    still go to the team: there is no sale maker, and someone has to act on them.

ALTER TABLE public.mpesa_transactions ADD COLUMN IF NOT EXISTS requested_user_id uuid
    REFERENCES public.users(id) ON DELETE SET NULL;

-- One person's message. No person = no message.
CREATE OR REPLACE FUNCTION public.fn_notify_user(
    p_business_id uuid, p_user_id uuid, p_title text, p_message text, p_payload jsonb
) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
    INSERT INTO public.notifications (business_id, user_id, title, message, type, priority, payload, created_by)
    SELECT p_business_id, p_user_id, p_title, p_message, 'Payment Received', 'medium',
           COALESCE(p_payload, '{}'::jsonb), 'system'
    WHERE p_business_id IS NOT NULL AND p_user_id IS NOT NULL;
$$;
ALTER FUNCTION public.fn_notify_user(uuid, uuid, text, text, jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.fn_notify_user(uuid, uuid, text, text, jsonb) FROM PUBLIC, anon, authenticated;

-- The message for a sale goes to the person who made it. staff_id is the user's id (employees
-- share it); an older employees-only id is followed to its user.
CREATE OR REPLACE FUNCTION public.fn_notify_sale_maker(
    p_sale_id uuid, p_title text, p_message text, p_payload jsonb
) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
    SELECT public.fn_notify_user(t.business_id, COALESCE(u.id, e.user_id), p_title, p_message, p_payload)
    FROM public.transactions t
    LEFT JOIN public.users u ON u.id = t.staff_id
    LEFT JOIN public.employees e ON e.id = t.staff_id
    WHERE t.id = p_sale_id;
$$;
ALTER FUNCTION public.fn_notify_sale_maker(uuid, text, text, jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.fn_notify_sale_maker(uuid, text, text, jsonb) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION "public"."record_till_payment"("p_raw" "jsonb", "p_business_id" "uuid" DEFAULT NULL) RETURNS "text"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
    v_trans_id  TEXT := NULLIF(trim(p_raw->>'TransID'), '');
    v_amount    NUMERIC := NULLIF(p_raw->>'TransAmount', '')::NUMERIC;
    v_short     TEXT := NULLIF(trim(p_raw->>'BusinessShortCode'), '');
    v_ref       TEXT := NULLIF(trim(p_raw->>'BillRefNumber'), '');
    v_name      TEXT := NULLIF(trim(concat_ws(' ', p_raw->>'FirstName', p_raw->>'MiddleName', p_raw->>'LastName')), '');
    v_time      TIMESTAMPTZ;
    v_biz       UUID;
    v_cust_id   UUID;
    v_cust_name TEXT;
    v_row_id    UUID;
    v_pid       UUID;
    v_sale_id   UUID;
    v_sale_ref  TEXT;
    v_matches   INT;
BEGIN
    IF v_trans_id IS NULL OR COALESCE(v_amount, 0) <= 0 THEN
        RAISE EXCEPTION 'Till confirmation is missing TransID or TransAmount.';
    END IF;

    BEGIN
        -- Safaricom sends Nairobi local time as YYYYMMDDHHmmss.
        v_time := COALESCE(to_timestamp(p_raw->>'TransTime', 'YYYYMMDDHH24MISS')::TIMESTAMP AT TIME ZONE 'Africa/Nairobi', NOW());
    EXCEPTION WHEN OTHERS THEN
        v_time := NOW();
    END;

    -- The callback URL's token names the business. Otherwise only an exact till match counts:
    -- a payment to an unknown till never lands on some other business.
    v_biz := p_business_id;
    IF v_biz IS NULL THEN
        SELECT business_id INTO v_biz FROM public.mpesa_settings WHERE till_number = v_short;
    END IF;

    INSERT INTO public.mpesa_till_payments (
        business_id, trans_id, trans_type, amount, short_code, bill_ref, msisdn, payer_name, trans_time, raw
    )
    VALUES (
        v_biz, v_trans_id, p_raw->>'TransactionType', v_amount, v_short, v_ref,
        NULLIF(p_raw->>'MSISDN', ''), v_name, v_time, p_raw
    )
    ON CONFLICT (trans_id) DO NOTHING
    RETURNING id INTO v_row_id;

    IF v_row_id IS NULL THEN
        RETURN 'duplicate';
    END IF;
    IF v_biz IS NULL THEN
        RAISE WARNING 'Till payment % for short code % matches no business', v_trans_id, v_short;
        RETURN 'no_business';
    END IF;

    -- The payer typed a sale's receipt number as the account (paybill): link it only when exactly
    -- one M-Pesa sale has that number and still has room for this amount. Never by amount alone.
    IF v_ref IS NOT NULL THEN
        SELECT count(*), min(t.id::text)::uuid, min(t.reference_id) INTO v_matches, v_sale_id, v_sale_ref
        FROM public.transactions t
        WHERE t.business_id = v_biz AND t.deleted_at IS NULL AND t.payment_method = 'M-Pesa'
          AND upper(t.reference_id) = upper(v_ref)
          AND t.final_total - public.fn_sale_till_linked(t.id) >= v_amount;
        IF v_matches = 1 THEN
            UPDATE public.mpesa_till_payments
            SET status = 'matched_sale', sale_id = v_sale_id,
                handled_by = 'Matched by receipt number', handled_at = NOW(), note = 'Sale ' || v_sale_ref
            WHERE id = v_row_id;
            PERFORM public.fn_notify_sale_maker(v_sale_id, 'M-Pesa payment received',
                format('Ksh %s for sale %s (%s).', v_amount, v_sale_ref, v_trans_id),
                jsonb_build_object('tillPaymentId', v_row_id, 'saleId', v_sale_id));
            RETURN 'matched_sale';
        END IF;
    END IF;

    -- Paybill-style payments carry the account number, so those settle themselves.
    IF v_ref IS NOT NULL THEN
        SELECT id, name INTO v_cust_id, v_cust_name FROM public.customers
        WHERE business_id = v_biz AND deleted_at IS NULL
          AND upper(account_number) = upper(v_ref);
    END IF;

    IF v_cust_id IS NOT NULL THEN
        v_pid := public.process_business_payment(
            v_biz, v_trans_id, v_amount, 'M-Pesa', COALESCE(v_name, v_cust_name),
            p_raw->>'MSISDN', 'Success', v_time, v_cust_id, v_cust_name, 'customer',
            'M-Pesa till payment', 'M-Pesa'
        );
        UPDATE public.mpesa_till_payments
        SET status = 'recorded', customer_id = v_cust_id, payment_id = v_pid,
            handled_by = 'Matched by account number', handled_at = NOW()
        WHERE id = v_row_id;
        PERFORM public.fn_notify_staff(v_biz, 'M-Pesa payment received',
            format('Ksh %s from %s (%s).', v_amount, v_cust_name, v_trans_id),
            jsonb_build_object('paymentId', v_pid));
        RETURN 'recorded';
    END IF;

    PERFORM public.fn_notify_staff(v_biz, 'M-Pesa till payment to assign',
        format('Ksh %s from %s (%s). Open Payments > M-Pesa to assign it.', v_amount, COALESCE(v_name, 'a customer'), v_trans_id),
        jsonb_build_object('tillPaymentId', v_row_id));
    RETURN 'queued';
END;
$$;

ALTER FUNCTION public.record_till_payment(jsonb, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.record_till_payment(jsonb, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_till_payment(jsonb, uuid) TO service_role;

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
    -- Settled earlier from the status query (stand-in receipt): the late callback brings the
    -- real receipt number. Only the reference text changes; no money moves.
    IF v_req.status = 'Completed' AND p_result_code = 0 AND p_receipt IS NOT NULL
       AND p_receipt NOT LIKE 'QRY-%' AND v_req.receipt_number LIKE 'QRY-%' THEN
        UPDATE public.payments SET reference_code = p_receipt
        WHERE id = v_req.payment_id AND reference_code = v_req.receipt_number;
        UPDATE public.mpesa_transactions
        SET receipt_number = p_receipt, raw_callback = p_raw, updated_at = NOW()
        WHERE id = v_req.id;
        RETURN 'receipt_added';
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
                PERFORM public.fn_notify_sale_maker(v_sale.id, 'M-Pesa payment received',
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

    PERFORM public.fn_notify_user(v_req.business_id, v_req.requested_user_id, 'M-Pesa payment received',
        format('Ksh %s from %s (%s).', v_amount, COALESCE(v_name, v_req.phone), p_receipt),
        jsonb_build_object('paymentId', v_pid));
    RETURN 'recorded';
END;
$$;
REVOKE ALL ON FUNCTION public.confirm_store_payment_request(text, integer, numeric, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_store_payment_request(text, integer, numeric, text, jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.allocate_till_payment(
    p_till_payment_id uuid,
    p_sale_id uuid,
    p_amount numeric,
    p_handled_by text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_row    public.mpesa_till_payments%ROWTYPE;
    v_sale   public.transactions%ROWTYPE;
    v_by     text := COALESCE(NULLIF(trim(p_handled_by), ''), 'Staff');
    v_amt    numeric(14,2) := round(p_amount, 2);
    v_left   numeric(14,2);
    v_room   numeric(14,2);
    v_status text;
    v_ref    text;
BEGIN
    SELECT * INTO v_row FROM public.mpesa_till_payments WHERE id = p_till_payment_id FOR UPDATE;
    IF NOT FOUND OR v_row.business_id IS NULL THEN
        RAISE EXCEPTION 'Till payment not found.';
    END IF;
    PERFORM public.assert_business_member(v_row.business_id);
    PERFORM public.assert_permission(v_row.business_id, 'payments.verify', 'payments.mpesa');
    IF v_row.status NOT IN ('unclaimed', 'under_review', 'partial') THEN
        RAISE EXCEPTION 'This payment was already handled by %.', COALESCE(v_row.handled_by, 'someone else');
    END IF;
    IF v_amt IS NULL OR v_amt <= 0 THEN
        RAISE EXCEPTION 'Enter an amount above zero.';
    END IF;
    v_left := v_row.amount - v_row.allocated;
    IF v_amt > v_left THEN
        RAISE EXCEPTION 'Only KSh % of this payment is left to give.', to_char(v_left, 'FM999,999,990.00');
    END IF;

    SELECT * INTO v_sale FROM public.transactions WHERE id = p_sale_id FOR UPDATE;
    IF NOT FOUND OR v_sale.business_id <> v_row.business_id OR v_sale.deleted_at IS NOT NULL THEN
        RAISE EXCEPTION 'Sale not found.';
    END IF;
    IF v_sale.payment_method <> 'M-Pesa' THEN
        RAISE EXCEPTION 'Only a sale paid by M-Pesa can take a till payment. Record it on the customer''s account instead.';
    END IF;
    v_room := v_sale.final_total - public.fn_sale_till_linked(v_sale.id);
    IF v_amt > v_room THEN
        IF v_room <= 0 THEN
            RAISE EXCEPTION 'This sale is already covered by till payments. Choose another sale.';
        END IF;
        RAISE EXCEPTION 'This sale only needs KSh % more.', to_char(v_room, 'FM999,999,990.00');
    END IF;

    v_ref := COALESCE(v_sale.reference_id, left(v_sale.id::text, 8));
    INSERT INTO public.mpesa_till_allocations (business_id, till_payment_id, sale_id, amount, allocated_by)
    VALUES (v_row.business_id, v_row.id, v_sale.id, v_amt, v_by);

    v_status := CASE WHEN v_left - v_amt = 0 THEN 'matched_sale' ELSE 'partial' END;
    INSERT INTO public.mpesa_till_payment_events (business_id, till_payment_id, trans_id, action, previous_status, new_status, amount, sale_id, staff_name, note)
    VALUES (v_row.business_id, v_row.id, v_row.trans_id, 'allocated', v_row.status, v_status, v_amt, v_sale.id, v_by, 'Sale ' || v_ref);

    UPDATE public.mpesa_till_payments
    SET allocated = allocated + v_amt, status = v_status, sale_id = v_sale.id,
        handled_by = v_by, handled_at = now(),
        note = CASE WHEN v_status = 'matched_sale' THEN 'Sale ' || v_ref ELSE note END
    WHERE id = v_row.id;

    PERFORM public.fn_notify_sale_maker(v_sale.id, 'M-Pesa payment received',
        format('Ksh %s for sale %s (%s), matched by %s.', v_amt, v_ref, v_row.trans_id, v_by),
        jsonb_build_object('tillPaymentId', v_row.id, 'saleId', v_sale.id));

    RETURN jsonb_build_object('status', v_status, 'left', v_left - v_amt, 'sale_reference', v_ref);
END;
$$;
REVOKE ALL ON FUNCTION public.allocate_till_payment(uuid, uuid, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.allocate_till_payment(uuid, uuid, numeric, text) TO authenticated, service_role;
