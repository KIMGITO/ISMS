-- Daraja callbacks are kept before they are processed (2026-11-28).
--
-- Found in the Daraja audit:
--   1. A callback whose processing threw (any database error) was answered 500 and kept nowhere
--      but a log line without its payload. Safaricom does not reliably resend STK or C2B
--      callbacks, so that money had no record.
--   2. The prompt row is saved after Safaricom accepts the STK push, so a fast callback could
--      arrive first, find nothing ("unknown") and be dropped.
--   3. Disconnecting and reconnecting M-Pesa deleted the business's callback token and made a
--      new one, so the till URLs already registered with Safaricom were refused (403) forever.
--      Live tills can't simply be registered again.
--   4. An online order settled from the status query kept its stand-in "QRY-" receipt even when
--      the real callback came later (only in-store prompts swapped it).
--
-- Fix: every callback is first stored in daraja_callbacks (one row per CheckoutRequestID / TransID),
-- then processed in a sub-transaction. A failure or an unmatched prompt stays on the row and
-- payment-sweep retries it. The callback token now lives in its own table and survives a
-- disconnect. Money still moves only through the existing functions (confirm_online_order_payment,
-- confirm_store_payment_request, record_till_payment), so the books are unchanged (money rule 2).

-- 1. Stable callback token per business -----------------------------------------------------
CREATE TABLE IF NOT EXISTS public.mpesa_callback_tokens (
    business_id uuid PRIMARY KEY REFERENCES public.businesses(id) ON DELETE CASCADE,
    token       text NOT NULL UNIQUE CHECK (token ~ '^[0-9a-f]{48}$'),
    created_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.mpesa_callback_tokens ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.mpesa_callback_tokens FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.mpesa_callback_tokens TO service_role;

INSERT INTO public.mpesa_callback_tokens (business_id, token)
SELECT business_id, callback_token FROM public.mpesa_payment_secrets
ON CONFLICT (business_id) DO NOTHING;

-- Reconnecting reuses the business's token, so URLs registered earlier keep working.
CREATE OR REPLACE FUNCTION public.fn_mpesa_keep_token() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_token text;
BEGIN
    SELECT token INTO v_token FROM public.mpesa_callback_tokens WHERE business_id = NEW.business_id;
    IF v_token IS NOT NULL THEN
        NEW.callback_token := v_token;
    END IF;
    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_mpesa_keep_token ON public.mpesa_payment_secrets;
CREATE TRIGGER trg_mpesa_keep_token BEFORE INSERT ON public.mpesa_payment_secrets
    FOR EACH ROW EXECUTE FUNCTION public.fn_mpesa_keep_token();

CREATE OR REPLACE FUNCTION public.fn_mpesa_save_token() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    INSERT INTO public.mpesa_callback_tokens (business_id, token)
    VALUES (NEW.business_id, NEW.callback_token)
    ON CONFLICT (business_id) DO UPDATE SET token = EXCLUDED.token;
    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_mpesa_save_token ON public.mpesa_payment_secrets;
CREATE TRIGGER trg_mpesa_save_token AFTER INSERT OR UPDATE OF callback_token ON public.mpesa_payment_secrets
    FOR EACH ROW EXECUTE FUNCTION public.fn_mpesa_save_token();

-- The business a callback URL's token belongs to (even while M-Pesa is disconnected:
-- money that arrives must still be recorded).
CREATE OR REPLACE FUNCTION public.fn_mpesa_business_by_token(p_token text) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT business_id FROM public.mpesa_callback_tokens
    WHERE p_token ~ '^[0-9a-f]{48}$' AND token = p_token;
$$;
REVOKE ALL ON FUNCTION public.fn_mpesa_business_by_token(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_mpesa_business_by_token(text) TO service_role;

-- 2. Callback inbox ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.daraja_callbacks (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id      uuid REFERENCES public.businesses(id) ON DELETE CASCADE,
    kind             text NOT NULL CHECK (kind IN ('stk', 'c2b_confirmation', 'c2b_validation')),
    -- CheckoutRequestID (stk) or TransID (c2b). Null only for a payload too broken to read.
    dedupe_key       text,
    payload          jsonb NOT NULL,
    -- received: stored, not processed yet | processed: done (see result)
    -- unmatched: no prompt with this CheckoutRequestID yet (retried) | failed: processing threw (retried)
    -- rejected: never processed (malformed, another business's prompt, or retried for 3 days)
    status           text NOT NULL DEFAULT 'received'
                     CHECK (status IN ('received', 'processed', 'unmatched', 'failed', 'rejected')),
    result           text,
    error            text,
    attempts         int NOT NULL DEFAULT 0,
    deliveries       int NOT NULL DEFAULT 1,
    received_at      timestamptz NOT NULL DEFAULT now(),
    last_received_at timestamptz NOT NULL DEFAULT now(),
    next_try_at      timestamptz NOT NULL DEFAULT now(),
    processed_at     timestamptz,
    UNIQUE (kind, dedupe_key)
);
CREATE INDEX IF NOT EXISTS daraja_callbacks_retry_idx ON public.daraja_callbacks (next_try_at)
    WHERE status IN ('received', 'unmatched', 'failed');
CREATE INDEX IF NOT EXISTS daraja_callbacks_business_idx ON public.daraja_callbacks (business_id, kind, received_at DESC);
ALTER TABLE public.daraja_callbacks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.daraja_callbacks FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.daraja_callbacks TO service_role;

-- Stores a callback. A repeat delivery only counts up. Returns the row id and its status.
CREATE OR REPLACE FUNCTION public.daraja_callback_receive(p_kind text, p_business_id uuid, p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_key    text;
    v_id     uuid;
    v_status text;
    v_result text;
    v_new    boolean;
BEGIN
    v_key := NULLIF(trim(CASE WHEN p_kind = 'stk'
        THEN p_payload #>> '{Body,stkCallback,CheckoutRequestID}'
        ELSE p_payload ->> 'TransID' END), '');

    INSERT INTO public.daraja_callbacks (business_id, kind, dedupe_key, payload, status, error)
    VALUES (p_business_id, p_kind, v_key, p_payload,
            CASE WHEN v_key IS NULL THEN 'rejected' ELSE 'received' END,
            CASE WHEN v_key IS NULL THEN 'Payload has no CheckoutRequestID / TransID.' END)
    ON CONFLICT (kind, dedupe_key) DO UPDATE
        SET deliveries = daraja_callbacks.deliveries + 1, last_received_at = now()
    RETURNING id, status, result, (xmax = 0) INTO v_id, v_status, v_result, v_new;

    RETURN jsonb_build_object('id', v_id, 'status', v_status, 'result', v_result,
                              'duplicate', NOT v_new, 'key', v_key);
END;
$$;
REVOKE ALL ON FUNCTION public.daraja_callback_receive(text, uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.daraja_callback_receive(text, uuid, jsonb) TO service_role;

-- An online order first settled from the status query gets the real receipt from the late callback.
-- Only the reference text changes; no money moves.
CREATE OR REPLACE FUNCTION public.fn_online_order_real_receipt(p_checkout_request_id text, p_receipt text, p_raw jsonb)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_pay public.mpesa_transactions%ROWTYPE;
BEGIN
    IF p_receipt IS NULL OR p_receipt LIKE 'QRY-%' THEN RETURN false; END IF;
    SELECT * INTO v_pay FROM public.mpesa_transactions
    WHERE checkout_request_id = p_checkout_request_id AND online_order_id IS NOT NULL
      AND status = 'Completed' AND receipt_number LIKE 'QRY-%'
    FOR UPDATE;
    IF NOT FOUND THEN RETURN false; END IF;
    UPDATE public.mpesa_transactions
    SET receipt_number = p_receipt, raw_callback = p_raw, updated_at = now()
    WHERE id = v_pay.id;
    UPDATE public.online_orders SET mpesa_receipt = p_receipt
    WHERE id = v_pay.online_order_id AND mpesa_receipt = v_pay.receipt_number;
    RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.fn_online_order_real_receipt(text, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_online_order_real_receipt(text, text, jsonb) TO service_role;

-- Processes one stored callback through the existing money functions. Never raises: an error
-- rolls back only this attempt and is kept on the row for the next try.
CREATE OR REPLACE FUNCTION public.daraja_callback_process(p_id uuid) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_row      public.daraja_callbacks%ROWTYPE;
    v_cb       jsonb;
    v_items    jsonb;
    v_code     int;
    v_amount   numeric;
    v_receipt  text;
    v_owner    uuid;
    v_result   text;
    v_err      text;
BEGIN
    SELECT * INTO v_row FROM public.daraja_callbacks WHERE id = p_id FOR UPDATE SKIP LOCKED;
    IF NOT FOUND THEN RETURN 'busy'; END IF;
    IF v_row.status IN ('processed', 'rejected') THEN RETURN v_row.result; END IF;

    BEGIN
        IF v_row.kind = 'c2b_validation' THEN
            v_result := 'accepted';

        ELSIF v_row.kind = 'c2b_confirmation' THEN
            -- Safaricom sends missing names as "" (record_till_payment would join them with
            -- double spaces); the stored payload keeps the original.
            v_result := public.record_till_payment(
                v_row.payload - COALESCE((SELECT array_agg(k) FROM jsonb_each_text(v_row.payload) e(k, v)
                                          WHERE k IN ('FirstName', 'MiddleName', 'LastName') AND trim(v) = ''), '{}'::text[]),
                v_row.business_id);

        ELSE
            v_cb := v_row.payload #> '{Body,stkCallback}';
            v_code := (v_cb ->> 'ResultCode')::int;
            IF v_code IS NULL THEN
                RAISE EXCEPTION 'STK callback has no ResultCode.';
            END IF;
            v_items := COALESCE(v_cb #> '{CallbackMetadata,Item}', '[]'::jsonb);
            SELECT NULLIF(i->>'Value', '')::numeric INTO v_amount
                FROM jsonb_array_elements(v_items) i WHERE i->>'Name' = 'Amount' LIMIT 1;
            SELECT NULLIF(i->>'Value', '') INTO v_receipt
                FROM jsonb_array_elements(v_items) i WHERE i->>'Name' = 'MpesaReceiptNumber' LIMIT 1;

            -- A business's token only settles that business's own prompts.
            SELECT business_id INTO v_owner FROM public.mpesa_transactions
            WHERE checkout_request_id = v_row.dedupe_key;
            IF v_owner IS NOT NULL AND v_owner IS DISTINCT FROM v_row.business_id THEN
                v_result := 'wrong_business';
            ELSIF v_code = 0 AND public.fn_online_order_real_receipt(v_row.dedupe_key, v_receipt, v_row.payload) THEN
                v_result := 'receipt_added';
            ELSE
                v_result := public.confirm_online_order_payment(v_row.dedupe_key, v_code, v_amount, v_receipt, v_row.payload);
                IF v_result = 'unknown' THEN
                    v_result := public.confirm_store_payment_request(v_row.dedupe_key, v_code, v_amount, v_receipt, v_row.payload);
                END IF;
            END IF;
        END IF;
    EXCEPTION WHEN OTHERS THEN
        v_err := SQLERRM;
    END;

    IF v_err IS NOT NULL THEN
        UPDATE public.daraja_callbacks
        SET status = 'failed', error = left(v_err, 1000), attempts = attempts + 1,
            next_try_at = now() + make_interval(mins => least(power(2, attempts)::int, 60))
        WHERE id = p_id;
        RAISE WARNING 'Daraja callback % (% %) failed: %', p_id, v_row.kind, v_row.dedupe_key, v_err;
        RETURN 'failed';
    END IF;

    IF v_result = 'unknown' THEN
        -- The prompt row may not be saved yet (the callback beat it), so try again shortly.
        UPDATE public.daraja_callbacks
        SET status = 'unmatched', result = v_result, error = NULL, attempts = attempts + 1,
            next_try_at = now() + make_interval(mins => least(attempts + 1, 30))
        WHERE id = p_id;
    ELSIF v_result = 'wrong_business' THEN
        UPDATE public.daraja_callbacks
        SET status = 'rejected', result = v_result, error = 'Token belongs to another business.',
            attempts = attempts + 1, processed_at = now()
        WHERE id = p_id;
    ELSE
        UPDATE public.daraja_callbacks
        SET status = 'processed', result = v_result, error = NULL, attempts = attempts + 1, processed_at = now()
        WHERE id = p_id;
    END IF;
    RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION public.daraja_callback_process(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.daraja_callback_process(uuid) TO service_role;

-- Called by payment-sweep: retries stored callbacks that are due, for up to 3 days. Older ones
-- are marked rejected (the row, payload and last error stay) so they leave the retry index.
CREATE OR REPLACE FUNCTION public.daraja_callback_retry(p_limit int DEFAULT 50) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_id   uuid;
    v_res  text;
    v_out  jsonb := '{}'::jsonb;
BEGIN
    UPDATE public.daraja_callbacks
    SET status = 'rejected', error = left('Gave up after 3 days. ' || COALESCE(error, result, ''), 1000)
    WHERE status IN ('received', 'unmatched', 'failed') AND received_at <= now() - interval '3 days';

    FOR v_id IN
        SELECT id FROM public.daraja_callbacks
        WHERE status IN ('received', 'unmatched', 'failed') AND next_try_at <= now()
        ORDER BY next_try_at
        LIMIT p_limit
    LOOP
        v_res := COALESCE(public.daraja_callback_process(v_id), 'null');
        v_out := jsonb_set(v_out, ARRAY[v_res], to_jsonb(COALESCE((v_out ->> v_res)::int, 0) + 1));
    END LOOP;
    RETURN v_out;
END;
$$;
REVOKE ALL ON FUNCTION public.daraja_callback_retry(int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.daraja_callback_retry(int) TO service_role;
