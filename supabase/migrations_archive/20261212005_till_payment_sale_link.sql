-- A till (C2B) payment can be linked to the exact sale it paid for.
-- Before this, "Already rung up as a sale" only changed the status: nothing said WHICH sale,
-- so a till payment never showed against a sale and could be "used" by two sales.
--
-- Money rule 2: linking moves no money. The sale already counted its M-Pesa money when it was
-- rung up (amount_paid, books, Payments balance); the link is the proof that the money arrived.
-- So only M-Pesa sales can be linked, and the till payments linked to one sale can never add up
-- to more than its total (no amount guessing, no overpayment).

ALTER TABLE public.mpesa_till_payments
    ADD COLUMN IF NOT EXISTS sale_id uuid REFERENCES public.transactions(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS mpesa_till_payments_sale_idx ON public.mpesa_till_payments (sale_id) WHERE sale_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS mpesa_till_payments_queue_idx ON public.mpesa_till_payments (business_id, status, trans_time DESC);

-- Back to the queue = no longer linked (handle_till_payment 'reopen').
CREATE OR REPLACE FUNCTION public.fn_till_payment_unlink_on_reopen() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
    IF NEW.status <> 'matched_sale' THEN
        NEW.sale_id := NULL;
    END IF;
    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_till_payment_unlink ON public.mpesa_till_payments;
CREATE TRIGGER trg_till_payment_unlink BEFORE UPDATE OF status ON public.mpesa_till_payments
    FOR EACH ROW EXECUTE FUNCTION public.fn_till_payment_unlink_on_reopen();

-- How much of a sale's total is already proven by linked till payments.
CREATE OR REPLACE FUNCTION public.fn_sale_till_linked(p_sale_id uuid) RETURNS numeric
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT COALESCE(SUM(amount), 0)::numeric(14,2) FROM public.mpesa_till_payments
    WHERE sale_id = p_sale_id AND status = 'matched_sale';
$$;
REVOKE ALL ON FUNCTION public.fn_sale_till_linked(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_sale_till_linked(uuid) TO service_role;

-- Sales a till payment could belong to: this business's M-Pesa sales with room left,
-- newest first, nearest in time to the payment. Search by receipt number or customer.
CREATE OR REPLACE FUNCTION public.till_payment_sale_candidates(
    p_till_payment_id uuid,
    p_search text DEFAULT NULL,
    p_limit int DEFAULT 30
) RETURNS TABLE (
    sale_id uuid, reference text, created_at timestamptz, customer_name text,
    total numeric, linked numeric, remaining numeric, same_amount boolean
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_row public.mpesa_till_payments%ROWTYPE;
    v_q   text := NULLIF(trim(p_search), '');
BEGIN
    SELECT * INTO v_row FROM public.mpesa_till_payments WHERE id = p_till_payment_id;
    IF NOT FOUND OR v_row.business_id IS NULL THEN
        RAISE EXCEPTION 'Till payment not found.';
    END IF;
    PERFORM public.assert_business_member(v_row.business_id);
    PERFORM public.assert_permission(v_row.business_id, 'payments.verify', 'payments.mpesa');

    RETURN QUERY
    SELECT t.id, COALESCE(t.reference_id, left(t.id::text, 8)), t.created_at, c.name,
           t.final_total, l.linked, (t.final_total - l.linked),
           (t.final_total - l.linked) = v_row.amount
    FROM public.transactions t
    LEFT JOIN public.customers c ON c.id = t.customer_id
    CROSS JOIN LATERAL (SELECT public.fn_sale_till_linked(t.id) AS linked) l
    WHERE t.business_id = v_row.business_id
      AND t.deleted_at IS NULL
      AND t.payment_method = 'M-Pesa'
      AND t.final_total - l.linked >= v_row.amount
      AND (v_q IS NOT NULL OR t.created_at BETWEEN v_row.trans_time - interval '3 days' AND v_row.trans_time + interval '1 day')
      AND (v_q IS NULL OR t.reference_id ILIKE '%' || v_q || '%' OR c.name ILIKE '%' || v_q || '%'
           OR t.final_total::text = v_q)
    ORDER BY abs(extract(epoch FROM (t.created_at - v_row.trans_time)))
    LIMIT LEAST(GREATEST(COALESCE(p_limit, 30), 1), 100);
END;
$$;
REVOKE ALL ON FUNCTION public.till_payment_sale_candidates(uuid, text, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.till_payment_sale_candidates(uuid, text, int) TO authenticated, service_role;

-- Links one waiting till payment to one sale. Locks both rows so two cashiers can't
-- link the same money twice or push a sale over its total.
CREATE OR REPLACE FUNCTION public.link_till_payment_to_sale(
    p_till_payment_id uuid,
    p_sale_id uuid,
    p_handled_by text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_row  public.mpesa_till_payments%ROWTYPE;
    v_sale public.transactions%ROWTYPE;
    v_by   text := COALESCE(NULLIF(trim(p_handled_by), ''), 'Staff');
BEGIN
    SELECT * INTO v_row FROM public.mpesa_till_payments WHERE id = p_till_payment_id FOR UPDATE;
    IF NOT FOUND OR v_row.business_id IS NULL THEN
        RAISE EXCEPTION 'Till payment not found.';
    END IF;
    PERFORM public.assert_business_member(v_row.business_id);
    PERFORM public.assert_permission(v_row.business_id, 'payments.verify', 'payments.mpesa');
    IF v_row.status <> 'unclaimed' THEN
        RAISE EXCEPTION 'This payment was already handled by %.', COALESCE(v_row.handled_by, 'someone else');
    END IF;

    SELECT * INTO v_sale FROM public.transactions WHERE id = p_sale_id FOR UPDATE;
    IF NOT FOUND OR v_sale.business_id <> v_row.business_id OR v_sale.deleted_at IS NOT NULL THEN
        RAISE EXCEPTION 'Sale not found.';
    END IF;
    IF v_sale.payment_method <> 'M-Pesa' THEN
        RAISE EXCEPTION 'Only a sale paid by M-Pesa can take a till payment. Record it as a customer or walk-in payment instead.';
    END IF;
    IF public.fn_sale_till_linked(v_sale.id) + v_row.amount > v_sale.final_total THEN
        RAISE EXCEPTION 'This sale is already covered by till payments. Choose another sale.';
    END IF;

    UPDATE public.mpesa_till_payments
    SET status = 'matched_sale', sale_id = v_sale.id, handled_by = v_by, handled_at = NOW(),
        note = 'Sale ' || COALESCE(v_sale.reference_id, left(v_sale.id::text, 8))
    WHERE id = v_row.id;
END;
$$;
REVOKE ALL ON FUNCTION public.link_till_payment_to_sale(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.link_till_payment_to_sale(uuid, uuid, text) TO authenticated, service_role;

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
            PERFORM public.fn_notify_staff(v_biz, 'M-Pesa payment received',
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
