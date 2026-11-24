-- Records the books and reports stand on are kept (2026-11-24, owner's decision).
--
-- 1. Settings > Old records could delete the audit trail, sales older than 3 months, stock
--    history older than 3 days and "who used points". Each of those breaks a rule:
--    - the audit trail is the record of who changed what; one that can be deleted proves nothing;
--    - sales, damage / waste / count differences / opening stock (stock_adj in the books) and
--      points used (a discount profit figures read) are money: deleting them makes past reports
--      and the books disagree (money rule 2).
--    delete_log_entries() now only clears logs that carry no money and no audit value:
--    points earned (points are never cash; balances stay), backup runs and crash reports.
-- 2. The audit trail is append-only in the database: no role can delete or edit an entry. The one
--    change allowed is the database itself blanking a link when the business, person or user it
--    points at is removed (the ON DELETE SET NULL foreign keys).
-- 3. Sales cannot be deleted by anyone signed in. A sale is undone by voiding it (deleted_at),
--    which reverses stock, money and books (money rule 4). The direct DELETE policy that
--    orders.cancel gave is dropped and the DELETE grant revoked. How long sales are kept, and
--    whether very old ones are ever archived, is a separate decision (docs/TO_FINISH.md).
-- 4. New permission support.report (About > Report a problem): checked by the ops-alert function
--    with has_permission instead of the role names Owner/Admin. Owners and admins hold every
--    permission; other roles get it only when the owner ticks it in Roles.

-- ---------------------------------------------------------------- 1. old records cleanup
CREATE OR REPLACE FUNCTION public.delete_log_entries(
    p_business_id uuid, p_log text, p_ids uuid[] DEFAULT NULL::uuid[], p_before timestamptz DEFAULT NULL::timestamptz)
RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
AS $_$
DECLARE
    v_table TEXT;
    v_time  TEXT;
    v_count INTEGER;
BEGIN
    IF public.is_owner_or_admin(p_business_id) IS NOT TRUE THEN
        RAISE EXCEPTION 'Only an owner or admin can delete logs.' USING ERRCODE = '42501';
    END IF;

    IF p_log IN ('sales', 'stock', 'points_used', 'audit') THEN
        RAISE EXCEPTION 'This record is kept for the books and the audit trail, so it can''t be deleted.'
            USING ERRCODE = '42501';
    END IF;

    SELECT t.tbl, t.col INTO v_table, v_time
    FROM (VALUES
        ('points_earned', 'loyalty_points_earned', 'created_at'),
        ('backups',       'backup_history_logs',   'timestamp'),
        ('crashes',       'crash_reports',         'last_seen_at')
    ) AS t(name, tbl, col)
    WHERE t.name = p_log;

    IF v_table IS NULL THEN
        RAISE EXCEPTION 'Unknown log: %', p_log;
    END IF;

    IF p_ids IS NOT NULL THEN
        IF cardinality(p_ids) = 0 THEN
            RETURN 0;
        END IF;
        EXECUTE format('DELETE FROM public.%I WHERE business_id = $1 AND id = ANY($2)', v_table)
            USING p_business_id, p_ids;
    ELSIF p_before IS NOT NULL THEN
        EXECUTE format('DELETE FROM public.%I WHERE business_id = $1 AND %I < $2', v_table, v_time)
            USING p_business_id, p_before;
    ELSE
        RAISE EXCEPTION 'Choose which entries to delete.';
    END IF;

    GET DIAGNOSTICS v_count = ROW_COUNT;
    RETURN v_count;
END;
$_$;
ALTER FUNCTION public.delete_log_entries(uuid, text, uuid[], timestamptz) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.delete_log_entries(uuid, text, uuid[], timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_log_entries(uuid, text, uuid[], timestamptz) TO authenticated, service_role;

-- Sizes of the logs that can still be cleared.
CREATE OR REPLACE FUNCTION public.log_sizes(p_business_id uuid)
RETURNS TABLE(log text, row_count bigint, oldest timestamptz)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
AS $$
BEGIN
    IF public.is_owner_or_admin(p_business_id) IS NOT TRUE THEN
        RAISE EXCEPTION 'Only an owner or admin can see this.' USING ERRCODE = '42501';
    END IF;

    RETURN QUERY
    SELECT 'points_earned', COUNT(*), MIN(created_at) FROM public.loyalty_points_earned WHERE business_id = p_business_id
    UNION ALL
    SELECT 'backups', COUNT(*), MIN(timestamp) FROM public.backup_history_logs WHERE business_id = p_business_id
    UNION ALL
    SELECT 'crashes', COUNT(*), MIN(last_seen_at) FROM public.crash_reports WHERE business_id = p_business_id;
END;
$$;
ALTER FUNCTION public.log_sizes(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.log_sizes(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.log_sizes(uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------- 2. audit trail is append-only
CREATE OR REPLACE FUNCTION public.fn_audit_logs_append_only()
RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'Audit log entries can''t be deleted.' USING ERRCODE = '42501';
    END IF;
    -- Only a link being blanked by its foreign key (the business, person or user was removed).
    IF (to_jsonb(NEW) - ARRAY['business_id', 'employee_id', 'user_id'])
           IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['business_id', 'employee_id', 'user_id'])
       OR (NEW.business_id IS DISTINCT FROM OLD.business_id AND NEW.business_id IS NOT NULL)
       OR (NEW.employee_id IS DISTINCT FROM OLD.employee_id AND NEW.employee_id IS NOT NULL)
       OR (NEW.user_id     IS DISTINCT FROM OLD.user_id     AND NEW.user_id     IS NOT NULL) THEN
        RAISE EXCEPTION 'Audit log entries can''t be changed.' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
END;
$$;
ALTER FUNCTION public.fn_audit_logs_append_only() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.fn_audit_logs_append_only() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_audit_logs_append_only ON public.audit_logs;
CREATE TRIGGER trg_audit_logs_append_only BEFORE UPDATE OR DELETE ON public.audit_logs
    FOR EACH ROW EXECUTE FUNCTION public.fn_audit_logs_append_only();

-- TRUNCATE skips row triggers, so nobody but the database owner may truncate it.
REVOKE TRUNCATE ON public.audit_logs FROM authenticated, anon, service_role;

-- ---------------------------------------------------------------- 3. sales are voided, never deleted
DROP POLICY IF EXISTS pol_transactions_delete ON public.transactions;
REVOKE DELETE, TRUNCATE ON public.transactions FROM authenticated, anon;
