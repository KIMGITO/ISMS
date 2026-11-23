-- Phase 10: usage alert for file storage, next to the database size alert (db:size).
--
-- Pictures, logos, receipts and business files live in Supabase Storage, which has its own plan
-- limit (Free: 1 GB; Pro: 100 GB included, then billed per GB). Nothing warned before it filled.
-- New watchdog check storage:size: files over 80% of storage_limit_mb.
--
-- Settings (SQL editor): UPDATE ops_watchdog_config SET storage_limit_mb = 102400;  -- Pro plan
-- Like 20261201004, the existing checks are kept as they are (renamed ops_watchdog_abuse_checks)
-- and called first.

ALTER TABLE public.ops_watchdog_config
    ADD COLUMN IF NOT EXISTS storage_limit_mb integer NOT NULL DEFAULT 1024;  -- Supabase Free plan

DO $$
BEGIN
    IF to_regprocedure('public.ops_watchdog_abuse_checks()') IS NULL THEN
        ALTER FUNCTION public.ops_watchdog_checks() RENAME TO ops_watchdog_abuse_checks;
    END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.ops_watchdog_checks()
RETURNS TABLE(check_key text, problem text)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
    c public.ops_watchdog_config;
    v_size bigint;
BEGIN
    RETURN QUERY SELECT * FROM public.ops_watchdog_abuse_checks();

    SELECT * INTO c FROM public.ops_watchdog_config WHERE id;

    check_key := 'storage:size';
    problem := NULL;
    IF to_regclass('storage.objects') IS NOT NULL THEN
        BEGIN
            EXECUTE $q$SELECT COALESCE(sum((metadata->>'size')::bigint), 0) FROM storage.objects$q$
                INTO v_size;
            IF v_size > c.storage_limit_mb::bigint * 1024 * 1024 * 0.8 THEN
                problem := 'Stored files are ' || pg_size_pretty(v_size) || ', over 80% of the '
                    || c.storage_limit_mb || ' MB plan limit. Delete old files or upgrade the plan.';
            END IF;
        EXCEPTION WHEN insufficient_privilege THEN
            problem := 'The watchdog cannot read storage.objects to measure stored files.';
        END;
    END IF;
    RETURN NEXT;
END;
$$;
REVOKE ALL ON FUNCTION public.ops_watchdog_checks() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ops_watchdog_abuse_checks() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ops_watchdog_checks() TO service_role;
GRANT EXECUTE ON FUNCTION public.ops_watchdog_abuse_checks() TO service_role;
