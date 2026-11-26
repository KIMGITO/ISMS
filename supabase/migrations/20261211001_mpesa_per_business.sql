-- Each business connects its own Safaricom Daraja app (keys, short code, passkey).
-- Prompts go to that business's own till, and every callback URL carries a token that
-- names the business. Keys are readable only by edge functions (service_role).

CREATE TABLE IF NOT EXISTS public.mpesa_payment_secrets (
    business_id      uuid PRIMARY KEY REFERENCES public.businesses(id) ON DELETE CASCADE,
    environment      text NOT NULL DEFAULT 'sandbox' CHECK (environment IN ('sandbox', 'production')),
    consumer_key     text NOT NULL CHECK (length(consumer_key) BETWEEN 10 AND 200),
    consumer_secret  text NOT NULL CHECK (length(consumer_secret) BETWEEN 10 AND 200),
    passkey          text NOT NULL CHECK (length(passkey) BETWEEN 10 AND 200),
    -- Short code that signs prompts: the paybill, or the store number of a Buy Goods till.
    shortcode        text NOT NULL CHECK (shortcode ~ '^[0-9]{5,10}$'),
    -- Buy Goods: the till that receives the money (differs from the store number). Paybill: null.
    party_b          text CHECK (party_b IS NULL OR party_b ~ '^[0-9]{5,10}$'),
    transaction_type text NOT NULL DEFAULT 'CustomerBuyGoodsOnline'
                     CHECK (transaction_type IN ('CustomerBuyGoodsOnline', 'CustomerPayBillOnline')),
    callback_token   text NOT NULL UNIQUE DEFAULT encode(extensions.gen_random_bytes(24), 'hex'),
    updated_at       timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.mpesa_payment_secrets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.mpesa_payment_secrets FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.mpesa_payment_secrets TO service_role;

DROP FUNCTION IF EXISTS public.record_till_payment(jsonb);

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
