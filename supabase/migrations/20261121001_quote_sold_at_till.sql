-- Quotes are now made from the POS cart and sold from it: "Sell in POS" loads a quote into
-- the cart, and when that sale goes through the quote is marked accepted and linked to the
-- sale. The separate Quotes & Invoices screen is gone; its tables stay for old documents.

ALTER TABLE public.quotes ADD COLUMN IF NOT EXISTS transaction_id uuid;

CREATE OR REPLACE FUNCTION public.mark_quote_sold(p_id uuid, p_transaction_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
    v_q public.quotes%ROWTYPE;
BEGIN
    SELECT * INTO v_q FROM public.quotes WHERE id = p_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'That quote was not found.';
    END IF;
    PERFORM public.assert_business_member(v_q.business_id);
    PERFORM public.assert_permission(v_q.business_id, 'pos.create_sale');
    IF v_q.status = 'accepted' THEN
        RETURN; -- already sold (a retry after a dropped connection)
    END IF;
    UPDATE public.quotes
       SET status = 'accepted', decided_at = NOW(), transaction_id = p_transaction_id, updated_at = NOW()
     WHERE id = p_id;
END;
$$;

REVOKE ALL ON FUNCTION public.mark_quote_sold(uuid, uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.mark_quote_sold(uuid, uuid) TO authenticated;
