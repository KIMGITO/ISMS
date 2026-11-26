-- A walk-in payment can be made a customer's payment from the Payments screen.
-- Money rule 4: the link is never edited in place. The walk-in payment is voided (which
-- reverses its money balance and books entry) and recorded again for the customer under the
-- same reference, so it pays their debt first, then tops up their wallet. A till payment or
-- prompt that pointed at the old payment points at the new one.

CREATE OR REPLACE FUNCTION public.assign_payment_to_customer(
    p_payment_id uuid,
    p_customer_id uuid,
    p_by text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_pay  public.payments%ROWTYPE;
    v_name text;
    v_ref  text;
    v_new  uuid;
    v_by   text := COALESCE(NULLIF(trim(p_by), ''), 'Staff');
BEGIN
    SELECT * INTO v_pay FROM public.payments WHERE id = p_payment_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Payment not found.';
    END IF;
    PERFORM public.assert_business_member(v_pay.business_id);
    PERFORM public.assert_permission(v_pay.business_id, 'payments.manage');

    IF v_pay.status <> 'Success' THEN
        RAISE EXCEPTION 'Only a received payment can be given to a customer.';
    END IF;
    IF v_pay.customer_id IS NOT NULL THEN
        RAISE EXCEPTION 'This payment already belongs to a customer. Void it and record it again to change it.';
    END IF;

    SELECT name INTO v_name FROM public.customers
    WHERE id = p_customer_id AND business_id = v_pay.business_id AND deleted_at IS NULL;
    IF v_name IS NULL THEN
        RAISE EXCEPTION 'Choose a customer for this payment.';
    END IF;

    v_ref := v_pay.reference_code;
    PERFORM public.void_business_payment(v_pay.id, 'Moved to customer ' || v_name, v_by);

    v_new := public.process_business_payment(
        v_pay.business_id, v_ref, v_pay.amount, v_pay.method,
        COALESCE(v_pay.sender_name, v_name), v_pay.sender_phone, 'Success', v_pay.date,
        p_customer_id, v_name, 'customer', v_pay.description, v_by
    );

    -- void_business_payment sent a linked till payment back to the queue; it is handled again.
    UPDATE public.mpesa_till_payments
    SET status = 'recorded', payment_id = v_new, customer_id = p_customer_id,
        handled_by = v_by, handled_at = NOW()
    WHERE business_id = v_pay.business_id AND trans_id = v_ref AND status = 'unclaimed';

    UPDATE public.mpesa_transactions SET payment_id = v_new, customer_id = p_customer_id
    WHERE payment_id = v_pay.id;
    UPDATE public.airtel_transactions SET payment_id = v_new, customer_id = p_customer_id
    WHERE payment_id = v_pay.id;

    RETURN v_new;
END;
$$;

REVOKE ALL ON FUNCTION public.assign_payment_to_customer(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.assign_payment_to_customer(uuid, uuid, text) TO authenticated, service_role;
