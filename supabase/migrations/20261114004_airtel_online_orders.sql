-- =============================================================================
-- 20261114004_airtel_online_orders.sql
--
-- Website customers can pay for an order with Airtel Money, next to M-Pesa and card.
-- Needs 20261114003 (Airtel Money tables and confirm_airtel_payment).
--
-- 1. An Airtel prompt can belong to a website order (airtel_transactions.online_order_id),
--    and online_orders.payment_method accepts 'Airtel Money'.
-- 2. fn_settle_online_order_airtel settles a paid order the same way the card path does:
--    one sale at the till marked Airtel Money (which adds to the Airtel Money balance through
--    the sale trigger), the order marked paid, a message to the customer and staff told.
--    A wrong amount or a payment on a closed order is flagged for staff, never dropped.
-- 3. confirm_airtel_payment sends order prompts there instead of recording a loose payment.
--    A failed order prompt puts the order back to "payment failed" so the customer can retry,
--    unless another prompt for it is still waiting.
-- 4. website_accepts_airtel(slug) tells the website whether to offer Airtel Money: the method
--    is switched on and the Airtel keys are saved.
-- =============================================================================

BEGIN;

ALTER TABLE public.airtel_transactions
    ADD COLUMN IF NOT EXISTS online_order_id UUID REFERENCES public.online_orders(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_airtel_transactions_order
    ON public.airtel_transactions (online_order_id) WHERE online_order_id IS NOT NULL;

ALTER TABLE public.online_orders DROP CONSTRAINT IF EXISTS online_orders_payment_method_check;
ALTER TABLE public.online_orders
    ADD CONSTRAINT online_orders_payment_method_check
    CHECK (payment_method IS NULL OR payment_method IN ('M-Pesa', 'Card', 'Airtel Money'));

-- Mirrors fn_settle_online_order_card. Returns 'paid' or 'flagged'.
CREATE OR REPLACE FUNCTION public.fn_settle_online_order_airtel(p_airtel_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_req    public.airtel_transactions%ROWTYPE;
    v_order  public.online_orders%ROWTYPE;
    v_tx_id  UUID;
    v_short  TEXT;
    v_reason TEXT;
    v_label  TEXT;
BEGIN
    SELECT * INTO v_req FROM public.airtel_transactions WHERE id = p_airtel_id;
    SELECT * INTO v_order FROM public.online_orders WHERE id = v_req.online_order_id FOR UPDATE;
    IF NOT FOUND THEN
        RETURN 'unknown';
    END IF;
    v_label := 'Airtel Money ' || COALESCE(v_req.airtel_money_id, v_req.reference);

    IF v_req.amount <> v_order.total THEN
        v_reason := format('%s paid %s but the order total is %s.', v_label, v_req.amount, v_order.total);
    ELSIF v_order.status NOT IN ('pending_payment', 'payment_failed') THEN
        v_reason := format('Extra Airtel Money payment %s of %s arrived on an order that was already %s. It may need a refund.',
                           COALESCE(v_req.airtel_money_id, v_req.reference), v_req.amount, v_order.status);
    END IF;

    IF v_reason IS NOT NULL THEN
        UPDATE public.online_orders
        SET needs_attention = TRUE, attention_reason = concat_ws(' ', attention_reason, v_reason)
        WHERE id = v_order.id;
        PERFORM public.fn_notify_staff(v_order.business_id, 'Online payment needs checking',
            'Order #' || v_order.order_number || ': ' || v_reason, jsonb_build_object('orderId', v_order.id));
        RETURN 'flagged';
    END IF;

    SELECT i.product_name INTO v_short
    FROM public.online_order_items i
    JOIN public.products p ON p.id = i.product_id
    WHERE i.order_id = v_order.id AND p.stock < i.quantity
    LIMIT 1;

    INSERT INTO public.transactions
        (business_id, total, discount, tax, final_total, amount_paid, payment_method,
         customer_id, customer_name, staff_name, note, is_delivery, delivery_fee, reference_id)
    SELECT v_order.business_id, v_order.subtotal + v_order.delivery_fee, v_order.discount, 0, v_order.total, v_order.total, 'Airtel Money',
           a.customer_id, v_order.customer_name, 'Website',
           'Online order #' || v_order.order_number || ', ' || v_label,
           v_order.fulfilment = 'delivery', v_order.delivery_fee, 'online-' || v_order.id
    FROM (SELECT 1) one
    LEFT JOIN public.customer_accounts a ON a.id = v_order.account_id
    RETURNING id INTO v_tx_id;

    INSERT INTO public.transaction_items (transaction_id, product_id, product_name, unit_price, quantity, line_total)
    SELECT v_tx_id, product_id, product_name, unit_price, quantity, line_total
    FROM public.online_order_items
    WHERE order_id = v_order.id;

    UPDATE public.online_orders
    SET status = 'paid',
        paid_at = NOW(),
        payment_method = 'Airtel Money',
        payment_reference = COALESCE(v_req.airtel_money_id, v_req.reference),
        transaction_id = v_tx_id,
        needs_attention = v_short IS NOT NULL,
        attention_reason = CASE WHEN v_short IS NOT NULL
            THEN 'Paid, but stock of ' || v_short || ' ran short before payment arrived.' END
    WHERE id = v_order.id;

    PERFORM public.fn_customer_message(v_order.account_id, v_order.id,
        'We received your Airtel Money payment for order #' || v_order.order_number
            || '. Reference: ' || COALESCE(v_req.airtel_money_id, v_req.reference) || '.');
    PERFORM public.fn_notify_staff(v_order.business_id, 'New online order',
        'Order #' || v_order.order_number || ' from ' || v_order.customer_name || ' is paid with Airtel Money.'
            || CASE WHEN v_short IS NOT NULL THEN ' Stock of ' || v_short || ' is short.' ELSE '' END,
        jsonb_build_object('orderId', v_order.id));
    RETURN 'paid';
END;
$$;
REVOKE ALL ON FUNCTION public.fn_settle_online_order_airtel(UUID) FROM PUBLIC, anon, authenticated;

-- Same as 20261114003, plus website orders (section 3 above).
CREATE OR REPLACE FUNCTION public.confirm_airtel_payment(
    p_reference       TEXT,
    p_success         BOOLEAN,
    p_airtel_money_id TEXT,
    p_code            TEXT,
    p_message         TEXT,
    p_raw             JSONB
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_req  public.airtel_transactions%ROWTYPE;
    v_name TEXT;
    v_pid  UUID;
    v_ref  TEXT;
BEGIN
    SELECT * INTO v_req FROM public.airtel_transactions WHERE reference = p_reference FOR UPDATE;
    IF NOT FOUND THEN
        RETURN 'unknown';
    END IF;
    IF v_req.status = 'Completed' OR (v_req.status <> 'Pending' AND NOT p_success) THEN
        RETURN 'duplicate';
    END IF;

    IF NOT p_success THEN
        UPDATE public.airtel_transactions
        SET status = 'Failed', result_code = p_code, result_message = p_message,
            raw = COALESCE(p_raw, raw), updated_at = NOW()
        WHERE id = v_req.id;
        IF v_req.online_order_id IS NOT NULL THEN
            UPDATE public.online_orders SET status = 'payment_failed'
            WHERE id = v_req.online_order_id AND status = 'pending_payment'
              AND NOT EXISTS (SELECT 1 FROM public.mpesa_transactions m
                              WHERE m.online_order_id = v_req.online_order_id AND m.status = 'Pending')
              AND NOT EXISTS (SELECT 1 FROM public.card_payments c
                              WHERE c.online_order_id = v_req.online_order_id AND c.status = 'pending')
              AND NOT EXISTS (SELECT 1 FROM public.airtel_transactions t
                              WHERE t.online_order_id = v_req.online_order_id AND t.status = 'Pending' AND t.id <> v_req.id);
        END IF;
        RETURN 'failed';
    END IF;

    v_ref := COALESCE(NULLIF(trim(p_airtel_money_id), ''), 'AIRTEL-' || v_req.reference);

    IF v_req.online_order_id IS NOT NULL THEN
        UPDATE public.airtel_transactions
        SET status = 'Completed', airtel_money_id = v_ref, result_code = p_code, result_message = p_message,
            raw = COALESCE(p_raw, raw), paid_at = NOW(), updated_at = NOW()
        WHERE id = v_req.id;
        RETURN public.fn_settle_online_order_airtel(v_req.id);
    END IF;

    SELECT name INTO v_name FROM public.customers WHERE id = v_req.customer_id;

    v_pid := public.process_business_payment(
        v_req.business_id, v_ref, v_req.amount, 'Airtel Money',
        COALESCE(v_name, 'Airtel ' || v_req.phone), v_req.phone, 'Success', NOW(),
        v_req.customer_id, v_name,
        CASE WHEN v_req.customer_id IS NULL THEN 'walk-in' ELSE 'customer' END,
        COALESCE(v_req.description, 'Airtel Money prompt'), v_req.requested_by
    );

    UPDATE public.airtel_transactions
    SET status = 'Completed', airtel_money_id = v_ref, result_code = p_code, result_message = p_message,
        raw = COALESCE(p_raw, raw), payment_id = v_pid, paid_at = NOW(), updated_at = NOW()
    WHERE id = v_req.id;

    PERFORM public.fn_notify_staff(v_req.business_id, 'Airtel Money payment received',
        format('Ksh %s from %s (%s).', v_req.amount, COALESCE(v_name, v_req.phone), v_ref),
        jsonb_build_object('paymentId', v_pid));
    RETURN 'recorded';
END;
$$;
REVOKE ALL ON FUNCTION public.confirm_airtel_payment(TEXT, BOOLEAN, TEXT, TEXT, TEXT, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_airtel_payment(TEXT, BOOLEAN, TEXT, TEXT, TEXT, JSONB) TO service_role;

CREATE OR REPLACE FUNCTION public.website_accepts_airtel(p_slug TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.businesses b
        JOIN public.airtel_payment_settings s ON s.business_id = b.id AND s.status = 'connected'
        JOIN public.airtel_payment_secrets k ON k.business_id = b.id
        WHERE b.website_slug = p_slug AND b.deleted_at IS NULL
          AND 'Airtel Money' = ANY(b.default_payment_methods)
    );
$$;
REVOKE ALL ON FUNCTION public.website_accepts_airtel(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.website_accepts_airtel(TEXT) TO anon, authenticated;

COMMIT;
