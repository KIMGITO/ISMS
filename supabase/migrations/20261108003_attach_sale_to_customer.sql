-- Quick sales are rung up without a customer. This puts a finished walk-in sale on a
-- customer's account afterwards, and gives them what the sale would have earned had they
-- been chosen at the till: the points (same rule as fn_process_completed_transaction,
-- 2 per KSh 1 excluding delivery), one more purchase, and a line in the points report.
--
-- Rules:
--   * Only paid sales with no customer yet. A customer cannot be swapped once set, so
--     points never move between accounts.
--   * Cashiers (pos.create_sale) can do it for their own sales from the last 24 hours.
--   * Managers (orders.update or customers.loyalty) can do it for any sale from the last 30 days.

CREATE OR REPLACE FUNCTION public.attach_sale_to_customer(p_transaction_id UUID, p_customer_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_tx       public.transactions%ROWTYPE;
    v_customer public.customers%ROWTYPE;
    v_manager  BOOLEAN;
    v_points   INTEGER;
BEGIN
    SELECT * INTO v_tx FROM public.transactions
    WHERE id = p_transaction_id AND deleted_at IS NULL
    FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Sale not found.';
    END IF;

    PERFORM public.assert_business_member(v_tx.business_id);
    PERFORM public.assert_permission(v_tx.business_id, 'pos.create_sale', 'orders.update', 'customers.loyalty');

    IF v_tx.customer_id IS NOT NULL THEN
        RAISE EXCEPTION 'This sale is already on %''s account.', COALESCE(v_tx.customer_name, 'a customer');
    END IF;
    IF v_tx.payment_method IN ('Credit_Debt', 'Credit') THEN
        RAISE EXCEPTION 'Credit sales get their customer when they are made.';
    END IF;

    v_manager := public.has_permission(v_tx.business_id, 'orders.update', 'customers.loyalty');
    IF NOT v_manager THEN
        IF NOT public.is_my_employee(v_tx.staff_id) THEN
            RAISE EXCEPTION 'You can only add a customer to your own sales. Ask a manager.' USING ERRCODE = '42501';
        END IF;
        IF v_tx.timestamp < NOW() - INTERVAL '24 hours' THEN
            RAISE EXCEPTION 'This sale is more than a day old. Ask a manager to add the customer.' USING ERRCODE = '42501';
        END IF;
    ELSIF v_tx.timestamp < NOW() - INTERVAL '30 days' THEN
        RAISE EXCEPTION 'Sales older than 30 days cannot be moved to a customer.';
    END IF;

    SELECT * INTO v_customer FROM public.customers
    WHERE id = p_customer_id AND business_id = v_tx.business_id AND deleted_at IS NULL
    FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Customer not found.';
    END IF;

    UPDATE public.transactions
    SET customer_id = v_customer.id,
        customer_name = v_customer.name,
        updated_at = NOW()
    WHERE id = v_tx.id;

    v_points := GREATEST(0, FLOOR((v_tx.final_total - COALESCE(v_tx.delivery_fee, 0)) * 2))::INTEGER;

    UPDATE public.customers
    SET loyalty_points = COALESCE(loyalty_points, 0) + v_points,
        purchases_count = purchases_count + 1
    WHERE id = v_customer.id;

    IF v_points > 0 THEN
        INSERT INTO public.loyalty_points_earned (business_id, customer_id, points, source, amount, transaction_id)
        VALUES (v_tx.business_id, v_customer.id, v_points, 'sale', v_tx.final_total - COALESCE(v_tx.delivery_fee, 0), v_tx.id);
    END IF;

    RETURN jsonb_build_object('points', v_points, 'customerId', v_customer.id, 'customerName', v_customer.name);
END;
$$;

REVOKE ALL ON FUNCTION public.attach_sale_to_customer(UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.attach_sale_to_customer(UUID, UUID) TO authenticated, service_role;
