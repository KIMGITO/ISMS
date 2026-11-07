-- =============================================================================
-- Points used at the till appear on the sale's receipt
-- =============================================================================
-- spend_points_at_till() records the points as a loyalty_redemptions row and the sale
-- takes their value off as a discount, but nothing tied the two together. So a receipt,
-- and above all a reprint, couldn't say that points paid part of the bill.
-- The app now links the redemption to the sale once the sale is saved.
-- =============================================================================

ALTER TABLE public.loyalty_redemptions
    ADD COLUMN IF NOT EXISTS transaction_id UUID REFERENCES public.transactions(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_loyalty_redemptions_transaction
    ON public.loyalty_redemptions (transaction_id) WHERE transaction_id IS NOT NULL;

-- Links points spent at the till to the sale they paid for. Only an unlinked, unrefunded
-- redemption, and only to a sale of the same business and customer.
CREATE OR REPLACE FUNCTION public.link_till_points(p_redemption_id UUID, p_transaction_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_row public.loyalty_redemptions%ROWTYPE;
BEGIN
    SELECT * INTO v_row FROM public.loyalty_redemptions
    WHERE id = p_redemption_id AND refunded_at IS NULL AND order_id IS NULL AND transaction_id IS NULL
    FOR UPDATE;
    IF NOT FOUND THEN
        RETURN;
    END IF;
    PERFORM public.assert_permission(v_row.business_id, 'customers.loyalty');

    UPDATE public.loyalty_redemptions r
    SET transaction_id = t.id
    FROM public.transactions t
    WHERE r.id = p_redemption_id
      AND t.id = p_transaction_id
      AND t.business_id = v_row.business_id
      AND t.customer_id = v_row.customer_id;
END;
$$;

REVOKE ALL ON FUNCTION public.link_till_points(UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.link_till_points(UUID, UUID) TO authenticated, service_role;
