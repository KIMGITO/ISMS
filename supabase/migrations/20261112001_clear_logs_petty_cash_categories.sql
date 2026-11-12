-- =============================================================================
-- 20261112001_clear_logs_petty_cash_categories.sql
-- Why:
--   1. Logs that only ever grow (stock history, points used, points earned, audit
--      trail, backup runs, crash reports) can now be deleted by an Owner or Admin:
--      chosen rows, or everything older than a date. Deleting a log never changes
--      stock, points balances or money; it only removes the record of it.
--   2. Petty cash "Spent on" choices are kept per business. Admins add, rename and
--      remove them. Renaming also renames past petty cash entries so the book and
--      Finances still group them together.
-- Dependencies: 20261105014 (has_permission), 20261109005 (petty cash)
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Deleting logs
-- ---------------------------------------------------------------------------

-- p_log names the log; p_ids deletes those rows, otherwise p_before deletes every row
-- older than it ('infinity' for all). Returns how many rows went.
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
    v_table TEXT;
    v_time  TEXT;
    v_count INTEGER;
BEGIN
    IF NOT public.is_owner_or_admin(p_business_id) THEN
        RAISE EXCEPTION 'Only an owner or admin can delete logs.' USING ERRCODE = '42501';
    END IF;

    SELECT t.tbl, t.col INTO v_table, v_time
    FROM (VALUES
        ('stock',         'inventory_adjustments', 'timestamp'),
        ('points_used',   'loyalty_redemptions',   'created_at'),
        ('points_earned', 'loyalty_points_earned', 'created_at'),
        ('audit',         'audit_logs',            'timestamp'),
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
$$;

-- How many rows each log holds, and the oldest one, for the "Clear old records" panel.
CREATE OR REPLACE FUNCTION public.log_sizes(p_business_id UUID)
RETURNS TABLE (log TEXT, row_count BIGINT, oldest TIMESTAMPTZ)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
    IF NOT public.is_owner_or_admin(p_business_id) THEN
        RAISE EXCEPTION 'Only an owner or admin can see this.' USING ERRCODE = '42501';
    END IF;

    RETURN QUERY
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

-- ---------------------------------------------------------------------------
-- 2. Petty cash "Spent on" categories
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.petty_cash_categories (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    name        TEXT NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 40),
    sort_order  INTEGER NOT NULL DEFAULT 0,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_petty_cash_categories_name
    ON public.petty_cash_categories (business_id, lower(btrim(name)));

ALTER TABLE public.petty_cash_categories ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pol_petty_cash_categories_select ON public.petty_cash_categories;
CREATE POLICY pol_petty_cash_categories_select ON public.petty_cash_categories
    FOR SELECT USING (business_id = ANY(public.get_user_business_ids()));

-- Changes go through the functions below (admins only).
REVOKE INSERT, UPDATE, DELETE ON public.petty_cash_categories FROM anon, authenticated;
GRANT SELECT ON public.petty_cash_categories TO authenticated;

CREATE OR REPLACE FUNCTION public.fn_seed_petty_cash_categories(p_business_id UUID)
RETURNS VOID
LANGUAGE sql SECURITY DEFINER
SET search_path TO 'public'
AS $$
    INSERT INTO public.petty_cash_categories (business_id, name, sort_order)
    SELECT p_business_id, c.name, c.ord
    FROM unnest(ARRAY['Transport', 'Cleaning', 'Food & tea', 'Repairs', 'Supplies', 'Airtime', 'Other'])
         WITH ORDINALITY AS c(name, ord)
    WHERE NOT EXISTS (SELECT 1 FROM public.petty_cash_categories WHERE business_id = p_business_id);
$$;
REVOKE ALL ON FUNCTION public.fn_seed_petty_cash_categories(UUID) FROM PUBLIC, anon, authenticated;

-- Every business starts with the usual list.
SELECT public.fn_seed_petty_cash_categories(b.id) FROM public.businesses b;

CREATE OR REPLACE FUNCTION public.fn_trg_seed_petty_cash_categories()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
    PERFORM public.fn_seed_petty_cash_categories(NEW.id);
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_seed_petty_cash_categories ON public.businesses;
CREATE TRIGGER trg_seed_petty_cash_categories
AFTER INSERT ON public.businesses
FOR EACH ROW EXECUTE FUNCTION public.fn_trg_seed_petty_cash_categories();

-- Add (p_id NULL) or rename (p_id set). A rename also renames past petty cash entries.
CREATE OR REPLACE FUNCTION public.save_petty_cash_category(p_business_id UUID, p_id UUID, p_name TEXT)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
    v_name TEXT := btrim(COALESCE(p_name, ''));
    v_old  TEXT;
    v_id   UUID;
BEGIN
    IF NOT public.is_owner_or_admin(p_business_id) THEN
        RAISE EXCEPTION 'Only an owner or admin can change these.' USING ERRCODE = '42501';
    END IF;
    IF length(v_name) = 0 THEN
        RAISE EXCEPTION 'Type a name.';
    END IF;
    IF length(v_name) > 40 THEN
        RAISE EXCEPTION 'Keep the name under 40 letters.';
    END IF;
    IF EXISTS (
        SELECT 1 FROM public.petty_cash_categories
        WHERE business_id = p_business_id AND lower(btrim(name)) = lower(v_name) AND id IS DISTINCT FROM p_id
    ) THEN
        RAISE EXCEPTION '"%" is already on the list.', v_name;
    END IF;

    IF p_id IS NULL THEN
        INSERT INTO public.petty_cash_categories (business_id, name, sort_order)
        VALUES (
            p_business_id, v_name,
            COALESCE((SELECT MAX(sort_order) + 1 FROM public.petty_cash_categories WHERE business_id = p_business_id), 1)
        )
        RETURNING id INTO v_id;
        RETURN v_id;
    END IF;

    SELECT name INTO v_old FROM public.petty_cash_categories WHERE id = p_id AND business_id = p_business_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'That choice is no longer there.';
    END IF;

    UPDATE public.petty_cash_categories SET name = v_name WHERE id = p_id;
    UPDATE public.expenses
    SET category = v_name
    WHERE business_id = p_business_id AND source = 'petty_cash' AND category = v_old;
    RETURN p_id;
END;
$$;

-- Removing a choice leaves past entries as they were.
CREATE OR REPLACE FUNCTION public.delete_petty_cash_category(p_business_id UUID, p_id UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
    IF NOT public.is_owner_or_admin(p_business_id) THEN
        RAISE EXCEPTION 'Only an owner or admin can change these.' USING ERRCODE = '42501';
    END IF;
    IF (SELECT COUNT(*) FROM public.petty_cash_categories WHERE business_id = p_business_id) <= 1 THEN
        RAISE EXCEPTION 'Keep at least one choice.';
    END IF;
    DELETE FROM public.petty_cash_categories WHERE id = p_id AND business_id = p_business_id;
END;
$$;

REVOKE ALL ON FUNCTION public.save_petty_cash_category(UUID, UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_petty_cash_category(UUID, UUID, TEXT) TO authenticated;
REVOKE ALL ON FUNCTION public.delete_petty_cash_category(UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_petty_cash_category(UUID, UUID) TO authenticated;

COMMIT;
