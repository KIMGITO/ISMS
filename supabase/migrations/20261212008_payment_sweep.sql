-- M-Pesa results no longer depend on Safaricom's callback arriving.
--
-- 1. payment-sweep (edge function, every 2 minutes) settles prompts whose callback is overdue
--    from Safaricom's status query. A paid prompt is recorded with a stand-in receipt
--    "QRY-<checkout id>", since the query carries no receipt number. Money rule 1: the money is
--    recorded within minutes even if the callback is lost.
-- 2. If the real callback arrives later, the stand-in is replaced by the real receipt on the
--    prompt and on its payment row (only the reference text changes, no money moves).
-- 3. On sandbox it also registers the till again, because the shared sandbox short codes go to
--    whichever developer registered last.
--
-- Builds on 20261212007 (confirm_store_payment_request with sale-linked prompts).

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

-- Calls payment-sweep only when there is something to do: a prompt waiting over a minute, or a
-- sandbox till whose registration is due again.
CREATE OR REPLACE FUNCTION public.run_payment_sweep() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_url text;
    v_key text;
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM public.mpesa_transactions
        WHERE status = 'Pending' AND checkout_request_id IS NOT NULL
          AND created_at < now() - interval '60 seconds'
          AND created_at > now() - interval '1 day'
    ) AND NOT EXISTS (
        SELECT 1 FROM public.mpesa_settings m
        JOIN public.mpesa_payment_secrets s ON s.business_id = m.business_id
        WHERE s.environment = 'sandbox' AND m.registered_at IS NOT NULL
          AND m.registered_at < now() - interval '4 minutes'
    ) THEN
        RETURN;
    END IF;

    SELECT decrypted_secret INTO v_url FROM vault.decrypted_secrets WHERE name = 'project_url';
    SELECT decrypted_secret INTO v_key FROM vault.decrypted_secrets WHERE name = 'service_role_key';
    IF v_url IS NULL OR v_key IS NULL THEN
        RAISE WARNING 'run_payment_sweep: Vault secrets project_url and service_role_key are not set.';
        RETURN;
    END IF;

    PERFORM net.http_post(
        url := rtrim(v_url, '/') || '/functions/v1/payment-sweep',
        headers := jsonb_build_object('Content-Type', 'application/json',
                                      'Authorization', 'Bearer ' || v_key, 'apikey', v_key),
        body := '{}'::jsonb,
        timeout_milliseconds := 55000
    );
END;
$$;
REVOKE ALL ON FUNCTION public.run_payment_sweep() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.run_payment_sweep() TO service_role;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
        EXECUTE $q$SELECT cron.unschedule('payment-sweep') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'payment-sweep')$q$;
        PERFORM cron.schedule('payment-sweep', '*/2 * * * *', 'SELECT public.run_payment_sweep()');
    END IF;
END;
$$;
