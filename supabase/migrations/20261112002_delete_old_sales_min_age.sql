-- =============================================================================
-- 20261112002_delete_old_sales_min_age.sql
-- Why:
--   Owners and admins can now delete sales from the sales log (swipe a sale left on a
--   phone), but only sales older than 90 days. Stock history entries can be deleted
--   once they are older than 3 days. The database enforces both ages, whatever the
--   app sends: newer rows are skipped, not deleted.
--
--   Deleting a sale removes the sale and its line items (and its KRA receipt record and
--   receipt check). Payments, wallet, customer ledger, M-Pesa and points records stay;
--   they only lose the link to the sale. Stock is not put back. Sales reports for those
--   days drop the deleted sales.
-- Dependencies: 20261112001 (delete_log_entries, log_sizes)
-- =============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.delete_log_entries(
    p_business_id UUID,
    p_log         TEXT,
    p_ids         UUID[] DEFAULT NULL,
    p_before      TIMESTAMPTZ DEFAULT NULL
) RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
    v_table    TEXT;
    v_time     TEXT;
    v_min_days INTEGER;
    v_cutoff   TIMESTAMPTZ;
    v_count    INTEGER;
BEGIN
    IF public.is_owner_or_admin(p_business_id) IS NOT TRUE THEN
        RAISE EXCEPTION 'Only an owner or admin can delete logs.' USING ERRCODE = '42501';
    END IF;

    -- min_days: rows must be at least this old to be deleted.
    SELECT t.tbl, t.col, t.min_days INTO v_table, v_time, v_min_days
    FROM (VALUES
        ('sales',         'transactions',          'timestamp',    90),
        ('stock',         'inventory_adjustments', 'timestamp',    3),
        ('points_used',   'loyalty_redemptions',   'created_at',   0),
        ('points_earned', 'loyalty_points_earned', 'created_at',   0),
        ('audit',         'audit_logs',            'timestamp',    0),
        ('backups',       'backup_history_logs',   'timestamp',    0),
        ('crashes',       'crash_reports',         'last_seen_at', 0)
    ) AS t(name, tbl, col, min_days)
    WHERE t.name = p_log;

    IF v_table IS NULL THEN
        RAISE EXCEPTION 'Unknown log: %', p_log;
    END IF;

    v_cutoff := CASE WHEN v_min_days > 0 THEN NOW() - make_interval(days => v_min_days) ELSE 'infinity'::timestamptz END;

    IF p_ids IS NOT NULL THEN
        IF cardinality(p_ids) = 0 THEN
            RETURN 0;
        END IF;
        EXECUTE format('DELETE FROM public.%I WHERE business_id = $1 AND id = ANY($2) AND %I < $3', v_table, v_time)
            USING p_business_id, p_ids, v_cutoff;
    ELSIF p_before IS NOT NULL THEN
        EXECUTE format('DELETE FROM public.%I WHERE business_id = $1 AND %I < $2', v_table, v_time)
            USING p_business_id, LEAST(p_before, v_cutoff);
    ELSE
        RAISE EXCEPTION 'Choose which entries to delete.';
    END IF;

    GET DIAGNOSTICS v_count = ROW_COUNT;
    RETURN v_count;
END;
$$;

DROP FUNCTION IF EXISTS public.log_sizes(UUID);
CREATE FUNCTION public.log_sizes(p_business_id UUID)
RETURNS TABLE (log TEXT, row_count BIGINT, oldest TIMESTAMPTZ)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
    IF public.is_owner_or_admin(p_business_id) IS NOT TRUE THEN
        RAISE EXCEPTION 'Only an owner or admin can see this.' USING ERRCODE = '42501';
    END IF;

    RETURN QUERY
    SELECT 'sales', COUNT(*), MIN(timestamp) FROM public.transactions WHERE business_id = p_business_id
    UNION ALL
    SELECT 'stock', COUNT(*), MIN(timestamp) FROM public.inventory_adjustments WHERE business_id = p_business_id
    UNION ALL
    SELECT 'points_used', COUNT(*), MIN(created_at) FROM public.loyalty_redemptions WHERE business_id = p_business_id
    UNION ALL
    SELECT 'points_earned', COUNT(*), MIN(created_at) FROM public.loyalty_points_earned WHERE business_id = p_business_id
    UNION ALL
    SELECT 'audit', COUNT(*), MIN(timestamp) FROM public.audit_logs WHERE business_id = p_business_id
    UNION ALL
    SELECT 'backups', COUNT(*), MIN(timestamp) FROM public.backup_history_logs WHERE business_id = p_business_id
    UNION ALL
    SELECT 'crashes', COUNT(*), MIN(last_seen_at) FROM public.crash_reports WHERE business_id = p_business_id;
END;
$$;

REVOKE ALL ON FUNCTION public.delete_log_entries(UUID, TEXT, UUID[], TIMESTAMPTZ) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_log_entries(UUID, TEXT, UUID[], TIMESTAMPTZ) TO authenticated;
REVOKE ALL ON FUNCTION public.log_sizes(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.log_sizes(UUID) TO authenticated;

COMMIT;
