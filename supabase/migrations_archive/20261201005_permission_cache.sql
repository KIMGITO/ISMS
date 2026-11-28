-- Phase 8: faster row security. Same answers, worked out once per request instead of once per row.
--
-- Row security calls has_permission(business_id, ...) and fn_can_see_notification(...) for every
-- row a query looks at, and each call does 2-4 lookups. On live (2026-11-23) the sales list with
-- its lines took 0.65-1 s on average for 45 sales; on a branch with 50,000 sales a cashier waited
-- 1.7 s for it (docs/deployment/performance.md).
--
-- Each answer is now kept for the rest of the current transaction (set_config(..., true)).
-- PostgREST runs every API request in its own transaction, so the memory never outlives one
-- request: a permission change or a removed member takes effect on the next request, as before.
-- The key holds the signed-in user, so switching user inside one transaction (tests) is safe.
-- Any change to memberships, users or permissions in the same transaction (create a business,
-- accept an invite, edit Roles) bumps a counter that is part of every key, so nothing stale is
-- ever read back.
-- Callers that are not anon/authenticated (service role, SECURITY DEFINER code run as owner)
-- still return TRUE before any lookup, unchanged.
-- Also: an index for the notification list (newest first per business).

-- The counter: part of every cache key; bumped by any write to the tables the answers read.
CREATE OR REPLACE FUNCTION public.fn_perm_cache_gen()
 RETURNS text
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $$ SELECT COALESCE(NULLIF(current_setting('isms_hp.gen', TRUE), ''), '0') $$;
-- Called only from the SECURITY DEFINER functions below (as their owner), as on live by default.
REVOKE ALL ON FUNCTION public.fn_perm_cache_gen() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.fn_perm_cache_bump()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $$
BEGIN
    -- Runs as whoever made the change (e.g. a manager on the Roles screen), so it reads the
    -- counter itself rather than calling fn_perm_cache_gen(), which they can't execute.
    PERFORM set_config('isms_hp.gen',
        (COALESCE(NULLIF(current_setting('isms_hp.gen', TRUE), ''), '0')::bigint + 1)::text, TRUE);
    RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.fn_perm_cache_bump() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_perm_cache_bump ON public.business_memberships;
CREATE TRIGGER trg_perm_cache_bump AFTER INSERT OR UPDATE OR DELETE OR TRUNCATE ON public.business_memberships
  FOR EACH STATEMENT EXECUTE FUNCTION public.fn_perm_cache_bump();
DROP TRIGGER IF EXISTS trg_perm_cache_bump ON public.role_permissions;
CREATE TRIGGER trg_perm_cache_bump AFTER INSERT OR UPDATE OR DELETE OR TRUNCATE ON public.role_permissions
  FOR EACH STATEMENT EXECUTE FUNCTION public.fn_perm_cache_bump();
DROP TRIGGER IF EXISTS trg_perm_cache_bump ON public.role_default_permissions;
CREATE TRIGGER trg_perm_cache_bump AFTER INSERT OR UPDATE OR DELETE OR TRUNCATE ON public.role_default_permissions
  FOR EACH STATEMENT EXECUTE FUNCTION public.fn_perm_cache_bump();
DROP TRIGGER IF EXISTS trg_perm_cache_bump ON public.users;
CREATE TRIGGER trg_perm_cache_bump AFTER INSERT OR UPDATE OR DELETE OR TRUNCATE ON public.users
  FOR EACH STATEMENT EXECUTE FUNCTION public.fn_perm_cache_bump();

-- My active businesses (used by many policies as business_id = ANY(get_user_business_ids())).
CREATE OR REPLACE FUNCTION public.get_user_business_ids()
 RETURNS uuid[]
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_ids UUID[];
    v_key TEXT;
    v_hit TEXT;
BEGIN
    v_key := 'isms_hp.b' || md5(COALESCE(auth.uid()::text, '-') || '|' || public.fn_perm_cache_gen());
    v_hit := current_setting(v_key, TRUE);
    IF v_hit IS NOT NULL AND v_hit <> '' THEN
        RETURN v_hit::uuid[];
    END IF;

    SELECT array_agg(bm.business_id)
    INTO v_ids
    FROM public.business_memberships bm
    JOIN public.users u ON bm.user_id = u.id
    WHERE u.auth_user_id = auth.uid()
      AND bm.status = 'Active';

    v_ids := COALESCE(v_ids, ARRAY[]::UUID[]);
    PERFORM set_config(v_key, v_ids::text, TRUE);
    RETURN v_ids;
END;
$function$;

CREATE OR REPLACE FUNCTION public.has_permission(p_business_id uuid, VARIADIC p_permissions text[])
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_role TEXT;
    v_code TEXT;
    v_granted BOOLEAN;
    v_key TEXT;
    v_hit TEXT;
    v_result BOOLEAN := FALSE;
BEGIN
    IF COALESCE(current_setting('role', TRUE), 'none') NOT IN ('anon', 'authenticated') THEN
        RETURN TRUE;
    END IF;

    -- Already answered in this request?
    v_key := 'isms_hp.k' || md5(COALESCE(auth.uid()::text, '-') || '|' || COALESCE(p_business_id::text, '-')
                                || '|' || array_to_string(p_permissions, ',') || '|' || public.fn_perm_cache_gen());
    v_hit := current_setting(v_key, TRUE);
    IF v_hit IN ('t', 'f') THEN
        RETURN v_hit = 't';
    END IF;

    SELECT bm.role::TEXT INTO v_role
    FROM public.business_memberships bm
    JOIN public.users u ON u.id = bm.user_id
    WHERE u.auth_user_id = auth.uid()
      AND bm.business_id = p_business_id
      AND bm.status = 'Active';

    IF v_role IS NULL THEN
        v_result := FALSE;
    ELSIF v_role IN ('Owner', 'Admin', 'Administrator') THEN
        v_result := TRUE;
    ELSE
        FOREACH v_code IN ARRAY p_permissions LOOP
            SELECT rp.granted INTO v_granted
            FROM public.role_permissions rp
            WHERE rp.business_id = p_business_id AND rp.role::TEXT = v_role AND rp.permission = v_code;

            IF COALESCE(v_granted, v_code = ANY(
                COALESCE((SELECT d.permissions FROM public.role_default_permissions d WHERE d.role = v_role), '{}')
            )) THEN
                v_result := TRUE;
                EXIT;
            END IF;
        END LOOP;
    END IF;

    PERFORM set_config(v_key, CASE WHEN v_result THEN 't' ELSE 'f' END, TRUE);
    RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_can_see_notification(p_business_id uuid, p_user_id uuid, p_role text, p_type text, p_created_at timestamp with time zone)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_me     UUID;
    v_role   TEXT;
    v_joined TIMESTAMPTZ;
    v_perms  TEXT[];
    v_gated  BOOLEAN;
    v_key    TEXT;
    v_hit    TEXT;
    v_ok     BOOLEAN;
BEGIN
    -- Who I am in this business: looked up once per request.
    v_key := 'isms_cn.m' || md5(COALESCE(auth.uid()::text, '-') || '|' || COALESCE(p_business_id::text, '-')
                                || '|' || public.fn_perm_cache_gen());
    v_hit := current_setting(v_key, TRUE);
    IF v_hit IS NOT NULL AND v_hit <> '' THEN
        IF v_hit = '-' THEN
            RETURN FALSE;
        END IF;
        v_me := split_part(v_hit, '|', 1)::uuid;
        v_role := split_part(v_hit, '|', 2);
        v_joined := NULLIF(split_part(v_hit, '|', 3), '')::timestamptz;
    ELSE
        SELECT u.id, m.role::TEXT, m.joined_at INTO v_me, v_role, v_joined
        FROM public.users u
        JOIN public.business_memberships m ON m.user_id = u.id
        WHERE u.auth_user_id = auth.uid() AND m.business_id = p_business_id AND m.status = 'Active';
        PERFORM set_config(v_key,
            CASE WHEN v_me IS NULL THEN '-' ELSE v_me::text || '|' || v_role || '|' || COALESCE(v_joined::text, '') END,
            TRUE);
    END IF;

    IF v_me IS NULL THEN
        RETURN FALSE;
    END IF;
    IF p_user_id IS NOT NULL THEN
        RETURN p_user_id = v_me;
    END IF;
    IF p_created_at < v_joined THEN
        RETURN FALSE;
    END IF;

    -- Whether my role may see this kind of notification: once per type per request.
    v_key := 'isms_cn.t' || md5(v_me::text || '|' || p_business_id::text || '|' || COALESCE(p_type, '-')
                                || '|' || COALESCE(p_role, '-') || '|' || public.fn_perm_cache_gen());
    v_hit := current_setting(v_key, TRUE);
    IF v_hit IN ('t', 'f') THEN
        RETURN v_hit = 't';
    END IF;

    SELECT c.permissions, TRUE INTO v_perms, v_gated
    FROM public.fn_notification_catalog() c
    WHERE p_type = ANY(c.types) AND c.permissions IS NOT NULL
    LIMIT 1;

    IF v_gated THEN
        v_ok := public.fn_user_has_permission(p_business_id, v_me, v_perms);
    ELSE
        v_ok := p_role IS NULL OR v_role ILIKE p_role;
    END IF;
    PERFORM set_config(v_key, CASE WHEN v_ok THEN 't' ELSE 'f' END, TRUE);
    RETURN v_ok;
END;
$function$;

-- The notification list: newest first within one business.
CREATE INDEX IF NOT EXISTS idx_notifications_business_created
  ON public.notifications (business_id, created_at DESC) WHERE deleted_at IS NULL;

-- Policies that test business_id = ANY(get_user_business_ids()): wrap the call in (SELECT ...)
-- so Postgres runs it once per query instead of once per row (where an OR keeps it out of the
-- index condition, e.g. notifications). Same function, same answer.
DO $$
DECLARE
    r record;
    v_using text;
    v_check text;
    v_n int := 0;
BEGIN
    FOR r IN
        SELECT schemaname, tablename, policyname, qual, with_check
        FROM pg_policies
        WHERE schemaname IN ('public', 'storage')
          AND (COALESCE(qual, '') || COALESCE(with_check, '')) ~ '(?<!SELECT )get_user_business_ids\(\)'
    LOOP
        v_using := regexp_replace(r.qual, '(?<!SELECT )get_user_business_ids\(\)', '(SELECT get_user_business_ids())::uuid[]', 'g');
        v_check := regexp_replace(r.with_check, '(?<!SELECT )get_user_business_ids\(\)', '(SELECT get_user_business_ids())::uuid[]', 'g');
        EXECUTE format('ALTER POLICY %I ON %I.%I', r.policyname, r.schemaname, r.tablename)
             || CASE WHEN v_using IS NOT NULL THEN format(' USING (%s)', v_using) ELSE '' END
             || CASE WHEN v_check IS NOT NULL THEN format(' WITH CHECK (%s)', v_check) ELSE '' END;
        v_n := v_n + 1;
    END LOOP;
    RAISE NOTICE 'Policies now asking get_user_business_ids() once per query: %', v_n;
END;
$$;

-- pg_cron writes a row for every job run (about 2,800 a day here: 3.5 MB a week, ~180 MB a year
-- on a database of 37 MB). Keep a week, which is what the watchdog and anyone debugging need.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
        PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'prune-cron-history';
        PERFORM cron.schedule('prune-cron-history', '40 0 * * *', $job$DELETE FROM cron.job_run_details WHERE end_time < now() - interval '7 days'$job$);
    END IF;
END;
$$;
