-- ---------------------------------------------------------------------------
-- MIGRATION: 20260918001_update_customer_tier_thresholds
-- Updates customer tier thresholds to match KSh purchase volume milestones.
--   Bronze : 0  – KSh  9,999  (0   – 99  pts)
--   Silver : KSh 10,000 – 29,999 (100 – 299 pts)
--   Gold   : KSh 30,000+        (300+      pts)
-- Rate: 1 loyalty point per KSh 100 spent.
-- Also backfills tier on all existing customers based on current points.
-- ---------------------------------------------------------------------------

-- 1. Replace the tier calculation function with updated thresholds
CREATE OR REPLACE FUNCTION public.calculate_customer_tier(points INTEGER)
RETURNS public.customer_tier
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
    IF points >= 300 THEN
        RETURN 'Gold';
    ELSIF points >= 100 THEN
        RETURN 'Silver';
    ELSE
        RETURN 'Bronze';
    END IF;
END;
$$;

-- 2. Backfill all existing customers so their tier reflects the new thresholds
UPDATE public.customers
SET tier = public.calculate_customer_tier(loyalty_points)
WHERE deleted_at IS NULL;
