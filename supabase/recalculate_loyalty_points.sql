-- Resets loyalty points to what sales history earned: 1 point per Ksh 100, excluding delivery,
-- minus what has been redeemed. Tiers and purchase counts are reset from the same history.
-- Manual adjustments and sign-up bonuses have no record, so they aren't kept.
-- Run it again after the app release, because older app versions still award extra points.
DO $$
DECLARE
    v_spent TEXT := '0';
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema = 'public' AND table_name = 'loyalty_redemptions' AND column_name = 'refunded_at') THEN
        v_spent := '(SELECT COALESCE(SUM(r.points), 0) FROM public.loyalty_redemptions r
                     WHERE r.customer_id = c.id AND r.refunded_at IS NULL)';
    ELSIF to_regclass('public.loyalty_redemptions') IS NOT NULL THEN
        v_spent := '(SELECT COALESCE(SUM(r.points), 0) FROM public.loyalty_redemptions r WHERE r.customer_id = c.id)';
    END IF;

    EXECUTE format($sql$
        WITH history AS (
            SELECT t.customer_id,
                   COUNT(*) AS sales,
                   SUM(GREATEST(0, FLOOR((t.final_total - COALESCE(t.delivery_fee, 0)) / 100))) AS earned
            FROM public.transactions t
            WHERE t.customer_id IS NOT NULL AND t.deleted_at IS NULL
            GROUP BY t.customer_id
        )
        UPDATE public.customers c
        SET loyalty_points = GREATEST(0, COALESCE(h.earned, 0) - %s)::INTEGER,
            purchases_count = COALESCE(h.sales, 0),
            tier = public.calculate_customer_tier(COALESCE(h.earned, 0)::INTEGER)
        FROM public.customers c2
        LEFT JOIN history h ON h.customer_id = c2.id
        WHERE c.id = c2.id AND c.deleted_at IS NULL
    $sql$, v_spent);
END;
$$;
