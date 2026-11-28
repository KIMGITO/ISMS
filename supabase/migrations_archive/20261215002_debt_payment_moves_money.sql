-- Customers > Pay debt moves the money balance (2026-11-28, found by the M-Pesa reconciliation).
--
-- process_debt_payment wrote debt_payments and customer_ledger only. The customer_ledger trigger
-- posted the money account in the books, but money_assets never moved and no payments row was
-- made, so the Payments screen balance fell behind the books for every method (money rule 2).
--
-- It now keeps its own checks (permission, not more than owed; the amount check is
-- process_business_payment's) and records the money through
-- process_business_payment, the same path as till payments and prompts: one payments row moves
-- money_assets, and its '-debt-payment' ledger row posts the books, settles credit oldest first
-- and earns points. Rows recorded before this change are left as they are (live had none).

CREATE OR REPLACE FUNCTION public.process_debt_payment(
    p_business_id uuid, p_customer_id uuid, p_amount numeric, p_method text,
    p_recorded_by text, p_note text, p_reference_id text
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
    v_amount NUMERIC(14,2) := round(COALESCE(p_amount, 0), 2);
    v_ref    TEXT := COALESCE(NULLIF(trim(p_reference_id), ''), 'debt-pay-' || gen_random_uuid());
    v_cust   public.customers%ROWTYPE;
BEGIN
    PERFORM public.assert_permission(p_business_id, 'customers.debts', 'payments.cash');
    PERFORM public.assert_business_member(p_business_id);

    -- Already recorded (old ledger-only rows, or a payment with this reference): safe to retry.
    IF EXISTS (SELECT 1 FROM public.customer_ledger WHERE business_id = p_business_id AND reference_id = v_ref)
       OR EXISTS (SELECT 1 FROM public.payments WHERE business_id = p_business_id AND reference_code = v_ref) THEN
        RETURN;
    END IF;

    SELECT * INTO v_cust FROM public.customers
    WHERE id = p_customer_id AND business_id = p_business_id
    FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Customer not found: %', p_customer_id;
    END IF;
    IF v_cust.merged_into_id IS NOT NULL THEN
        SELECT * INTO v_cust FROM public.customers WHERE id = v_cust.merged_into_id FOR UPDATE;
    END IF;
    IF v_amount > COALESCE(v_cust.debt_balance, 0) THEN
        RAISE EXCEPTION 'Cannot pay off more than outstanding debt.';
    END IF;

    PERFORM public.process_business_payment(
        p_business_id, v_ref, v_amount, p_method, v_cust.name, v_cust.phone, 'Success', NOW(),
        v_cust.id, v_cust.name, 'customer',
        COALESCE(NULLIF(trim(p_note), ''), 'Debt payment via ' || p_method),
        p_recorded_by
    );
END;
$$;

REVOKE ALL ON FUNCTION public.process_debt_payment(uuid, uuid, numeric, text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.process_debt_payment(uuid, uuid, numeric, text, text, text, text) TO authenticated, service_role;
