-- SaaS: support access, part 2 (owner decision 2026-11-24).
--
-- Platform support never sees inside a business on its own. The business Owner allows it from the
-- app, for one branch and a set time (1 to 72 hours); a banner shows on every screen while it is
-- allowed, the Owner can end it at any moment, and it ends by itself when the time is up.
--
-- While allowed, a platform admin can open the branch from the console. That gives them a
-- membership with the role 'Support' that ends with the permission:
--   * Support can set up: products, opening stock, customers, suppliers, settings. Never selling,
--     refunds, payments, expenses, the plan, staff or the owner (fn_support_permissions(); the
--     Roles screen can't widen it).
--   * Support is not staff: no employees row, no staff place on the plan, not in the team list.
--   * Everything Support changes is in the audit trail as "Platform support (<name>)", and the
--     grant, the opening and the end are logged in the business's audit trail and platform_audit.
-- An ended or expired grant stops access at once (get_user_business_ids / has_permission check
-- the end time); a job every 10 minutes also removes the leftover membership rows.

-- ============================================================================================
-- 1. Grants
-- ============================================================================================
CREATE TABLE IF NOT EXISTS public.support_grants (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    granted_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
    granted_by_name text NOT NULL,
    reason text CHECK (reason IS NULL OR length(reason) <= 300),
    starts_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL,
    ended_at timestamptz,
    ended_by_name text,
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK (expires_at > starts_at)
);
CREATE INDEX IF NOT EXISTS idx_support_grants_business ON public.support_grants (business_id, expires_at DESC);
-- Read and changed only through the functions below. No read-only plan check: an owner on an
-- ended plan can still let support in to look (support can't change anything then either);
-- listed with the other housekeeping tables in grants_check.sql.
ALTER TABLE public.support_grants ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.support_grants FROM anon, authenticated;
GRANT ALL ON public.support_grants TO service_role;

ALTER TABLE public.business_memberships
    ADD COLUMN IF NOT EXISTS support_until timestamptz;

-- The open grant of a branch, if any.
CREATE OR REPLACE FUNCTION public.fn_support_grant_open(p_business_id uuid)
RETURNS public.support_grants
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT g.* FROM public.support_grants g
    WHERE g.business_id = p_business_id AND g.ended_at IS NULL AND g.expires_at > now()
    ORDER BY g.expires_at DESC LIMIT 1;
$$;
REVOKE ALL ON FUNCTION public.fn_support_grant_open(uuid) FROM PUBLIC, anon, authenticated;

-- What Support may do. The app has the same list (SUPPORT_PERMISSIONS in src/utils/permissions.ts;
-- npm test checks they match).
CREATE OR REPLACE FUNCTION public.fn_support_permissions()
RETURNS text[]
LANGUAGE sql IMMUTABLE
SET search_path = ''
AS $$
    SELECT ARRAY[
        'home.view', 'dashboard.view', 'notifications.view',
        'business.view', 'business.update',
        'settings.view', 'settings.update', 'settings.theme', 'settings.tax', 'settings.delivery',
        'products.view', 'products.create', 'products.update', 'products.import', 'products.export',
        'products.manage_categories', 'products.manage_tax', 'products.manage_images',
        'inventory.view', 'inventory.receive_stock', 'inventory.adjust_stock', 'inventory.stock_count',
        'inventory.stock_history', 'inventory.expiry', 'inventory.import', 'inventory.export',
        'customers.view', 'customers.create', 'customers.update', 'customers.import', 'customers.export',
        'suppliers.view', 'suppliers.create', 'suppliers.update', 'suppliers.import', 'suppliers.export',
        'deliveries.view', 'deliveries.delivery_zones', 'deliveries.delivery_price',
        'bom.view', 'bom.create', 'bom.update',
        'production.view',
        'online_store.view',
        'reports.view', 'reports.inventory'
    ]::text[];
$$;
REVOKE ALL ON FUNCTION public.fn_support_permissions() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_support_permissions() TO authenticated, service_role;

-- ============================================================================================
-- 2. Access checks: an ended Support membership counts for nothing
-- ============================================================================================
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
      AND bm.status = 'Active'
      AND (bm.support_until IS NULL OR bm.support_until > now());

    v_ids := COALESCE(v_ids, ARRAY[]::UUID[]);
    PERFORM set_config(v_key, v_ids::text, TRUE);
    RETURN v_ids;
END;
$function$;

-- has_permission (20261204001) plus Support: only fn_support_permissions(), and only until the
-- grant ends. Role overrides on the Roles screen don't apply to Support.
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
    v_codes TEXT[];
    v_result BOOLEAN := FALSE;
BEGIN
    IF COALESCE(current_setting('role', TRUE), 'none') NOT IN ('anon', 'authenticated') THEN
        RETURN TRUE;
    END IF;

    v_key := 'isms_hp.k' || md5(COALESCE(auth.uid()::text, '-') || '|' || COALESCE(p_business_id::text, '-')
                                || '|' || array_to_string(p_permissions, ',') || '|' || public.fn_perm_cache_gen());
    v_hit := current_setting(v_key, TRUE);
    IF v_hit IN ('t', 'f') THEN
        RETURN v_hit = 't';
    END IF;

    v_codes := ARRAY(SELECT c FROM unnest(p_permissions) c
                     WHERE public.has_module(p_business_id, public.fn_permission_module(c)));

    IF cardinality(v_codes) = 0 THEN
        v_result := FALSE;
    ELSE
        SELECT bm.role::TEXT INTO v_role
        FROM public.business_memberships bm
        JOIN public.users u ON u.id = bm.user_id
        WHERE u.auth_user_id = auth.uid()
          AND bm.business_id = p_business_id
          AND bm.status = 'Active'
          AND (bm.support_until IS NULL OR bm.support_until > now());

        IF v_role IS NULL THEN
            v_result := FALSE;
        ELSIF v_role = 'Support' THEN
            v_result := v_codes && public.fn_support_permissions();
        ELSIF v_role IN ('Owner', 'Admin', 'Administrator') THEN
            v_result := TRUE;
        ELSE
            FOREACH v_code IN ARRAY v_codes LOOP
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
    END IF;

    PERFORM set_config(v_key, CASE WHEN v_result THEN 't' ELSE 'f' END, TRUE);
    RETURN v_result;
END;
$function$;

-- ============================================================================================
-- 3. Support is not staff
-- ============================================================================================
CREATE OR REPLACE FUNCTION public.fn_membership_sync_employee()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
    IF NEW.status = 'Active' AND NEW.role::text <> 'Support' THEN
        PERFORM public.fn_sync_employee(NEW.business_id, NEW.user_id);
    END IF;
    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_tenant_staff_used(p_tenant_id uuid, p_exclude_user uuid DEFAULT NULL)
RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT count(DISTINCT bm.user_id)::integer
    FROM public.business_memberships bm
    JOIN public.businesses b ON b.id = bm.business_id
    WHERE b.tenant_id = p_tenant_id AND b.deleted_at IS NULL
      AND bm.status = 'Active'
      AND bm.role::text NOT IN ('Owner', 'Rider', 'Supplier', 'Support')
      AND bm.user_id IS DISTINCT FROM p_exclude_user;
$$;
REVOKE ALL ON FUNCTION public.fn_tenant_staff_used(uuid, uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.fn_check_membership_staff_limit()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_tenant uuid;
    r jsonb;
BEGIN
    IF COALESCE(current_setting('role', true), 'none') NOT IN ('anon', 'authenticated')
       OR NEW.status <> 'Active' OR NEW.role::text IN ('Owner', 'Rider', 'Supplier', 'Support') THEN
        RETURN NEW;
    END IF;
    IF TG_OP = 'UPDATE' AND OLD.status = 'Active' AND OLD.role::text NOT IN ('Owner', 'Rider', 'Supplier', 'Support') THEN
        RETURN NEW;  -- already counted
    END IF;
    v_tenant := public.fn_business_tenant(NEW.business_id);
    IF EXISTS (SELECT 1 FROM public.business_memberships bm
               JOIN public.businesses b ON b.id = bm.business_id
               WHERE b.tenant_id = v_tenant AND bm.user_id = NEW.user_id AND bm.id <> NEW.id
                 AND bm.status = 'Active' AND bm.role::text NOT IN ('Owner', 'Rider', 'Supplier', 'Support')) THEN
        RETURN NEW;
    END IF;
    PERFORM 1 FROM public.tenant_subscriptions WHERE tenant_id = v_tenant FOR UPDATE;
    r := public.fn_tenant_plan(v_tenant);
    IF r IS NULL THEN
        RETURN NEW;
    END IF;
    IF public.fn_tenant_staff_used(v_tenant, NEW.user_id) >= (r->>'max_staff')::integer THEN
        RAISE EXCEPTION '%', public.fn_staff_limit_message(r) USING ERRCODE = '42501', HINT = 'plan_limit_staff';
    END IF;
    RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.fn_check_membership_staff_limit() FROM PUBLIC, anon, authenticated;

-- Nobody can make someone Support by hand (Roles, invitations, a direct update): only
-- platform_support_open does, and it runs as the table owner.
CREATE OR REPLACE FUNCTION public.fn_guard_support_role()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
    -- current_user is the table owner inside platform_support_open (SECURITY DEFINER).
    IF current_user IN ('anon', 'authenticated')
       AND (NEW.role::text = 'Support' OR NEW.support_until IS NOT NULL)
       AND (TG_OP = 'INSERT' OR OLD.role IS DISTINCT FROM NEW.role OR OLD.support_until IS DISTINCT FROM NEW.support_until) THEN
        RAISE EXCEPTION 'Platform support access is given from Business settings, not here.' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.fn_guard_support_role() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_guard_support_role ON public.business_memberships;
CREATE TRIGGER trg_guard_support_role BEFORE INSERT OR UPDATE ON public.business_memberships
    FOR EACH ROW EXECUTE FUNCTION public.fn_guard_support_role();

CREATE OR REPLACE FUNCTION public.fn_guard_support_invitation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
    IF NEW.role::text = 'Support' THEN
        RAISE EXCEPTION 'Platform support can''t be invited.' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.fn_guard_support_invitation() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_guard_support_invitation ON public.invitations;
CREATE TRIGGER trg_guard_support_invitation BEFORE INSERT OR UPDATE OF role ON public.invitations
    FOR EACH ROW EXECUTE FUNCTION public.fn_guard_support_invitation();

-- ============================================================================================
-- 4. Names in the records: "Platform support (<name>)"
-- ============================================================================================
CREATE OR REPLACE FUNCTION public.fn_is_support_in(p_business_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.business_memberships bm
        JOIN public.users u ON u.id = bm.user_id
        WHERE u.auth_user_id = auth.uid() AND bm.business_id = p_business_id
          AND bm.status = 'Active' AND bm.role::text = 'Support');
$$;
REVOKE ALL ON FUNCTION public.fn_is_support_in(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.fn_support_label()
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT 'Platform support (' || COALESCE(
        (SELECT NULLIF(btrim(pa.name), '') FROM public.platform_admins pa WHERE pa.auth_user_id = auth.uid()),
        (SELECT NULLIF(btrim(u.name), '') FROM public.users u WHERE u.auth_user_id = auth.uid() LIMIT 1),
        'staff') || ')';
$$;
REVOKE ALL ON FUNCTION public.fn_support_label() FROM PUBLIC, anon, authenticated;

-- The name on records made by the signed-in person (products, stock counts, ...).
CREATE OR REPLACE FUNCTION public.fn_my_display_name(p_business_id uuid)
RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
    v_name TEXT;
BEGIN
    IF public.fn_is_support_in(p_business_id) THEN
        RETURN public.fn_support_label();
    END IF;
    v_name := (public.fn_my_employee(p_business_id)).name;
    IF NULLIF(btrim(COALESCE(v_name, '')), '') IS NULL THEN
        SELECT u.name INTO v_name FROM public.users u WHERE u.auth_user_id = auth.uid();
    END IF;
    RETURN COALESCE(NULLIF(btrim(COALESCE(v_name, '')), ''), 'Staff');
END;
$$;

-- The audit trail row trigger (20261120001), with the Support name and a support flag.
CREATE OR REPLACE FUNCTION public.fn_audit_row_change()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
    v_ignore  TEXT[] := ARRAY['updated_at', 'created_at', 'version', 'sync_status', 'last_modified_by', 'stock', 'search_vector'];
    v_old     JSONB := CASE WHEN TG_OP <> 'INSERT' THEN to_jsonb(OLD) ELSE '{}'::JSONB END;
    v_new     JSONB := CASE WHEN TG_OP <> 'DELETE' THEN to_jsonb(NEW) ELSE '{}'::JSONB END;
    v_row     JSONB := CASE WHEN TG_OP = 'DELETE' THEN v_old ELSE v_new END;
    v_changes JSONB := '{}'::JSONB;
    v_key     TEXT;
    v_action  TEXT;
    v_label   TEXT;
    v_biz     UUID;
    v_support BOOLEAN;
BEGIN
    v_biz := (v_row ->> 'business_id')::UUID;
    IF NOT EXISTS (SELECT 1 FROM public.businesses b WHERE b.id = v_biz) THEN
        RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
    END IF;

    IF TG_OP = 'UPDATE' THEN
        FOR v_key IN SELECT jsonb_object_keys(v_new) LOOP
            CONTINUE WHEN v_key = ANY(v_ignore);
            IF (v_old -> v_key) IS DISTINCT FROM (v_new -> v_key) THEN
                v_changes := v_changes || jsonb_build_object(v_key, jsonb_build_object('from', v_old -> v_key, 'to', v_new -> v_key));
            END IF;
        END LOOP;
        IF v_changes = '{}'::JSONB THEN
            RETURN NEW;
        END IF;
    END IF;

    v_action := CASE
        WHEN TG_OP = 'INSERT' THEN 'CREATE'
        WHEN TG_OP = 'DELETE' THEN 'DELETE'
        WHEN v_changes ? 'deleted_at' AND (v_new ->> 'deleted_at') IS NOT NULL THEN 'DELETE'
        WHEN v_changes ? 'deleted_at' THEN 'RESTORE'
        WHEN v_changes ? 'status' THEN 'STATUS'
        ELSE 'UPDATE'
    END;
    v_label := COALESCE(v_row ->> 'name', v_row ->> 'supplier_name', v_row ->> 'reference_number', v_row ->> 'id');
    v_support := public.fn_is_support_in(v_biz);

    INSERT INTO public.audit_logs (business_id, user_id, action, table_name, record_id, details)
    VALUES (
        v_biz,
        (SELECT u.id FROM public.users u WHERE u.id = auth.uid() OR u.auth_user_id = auth.uid() LIMIT 1),
        v_action,
        TG_TABLE_NAME,
        v_row ->> 'id',
        jsonb_build_object('label', v_label,
                           'by', CASE WHEN v_support THEN public.fn_support_label() ELSE public.fn_audit_actor_name() END)
            || CASE WHEN v_support THEN jsonb_build_object('support', true) ELSE '{}'::JSONB END
            || CASE WHEN TG_OP = 'UPDATE' THEN jsonb_build_object('changes', v_changes) ELSE '{}'::JSONB END
            || CASE WHEN v_action = 'STATUS' THEN jsonb_build_object('status', v_new ->> 'status') ELSE '{}'::JSONB END
    );
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_support_log(p_business_id uuid, p_action text, p_details jsonb)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    INSERT INTO public.audit_logs (business_id, user_id, action, table_name, record_id, details)
    VALUES (p_business_id,
            (SELECT u.id FROM public.users u WHERE u.auth_user_id = auth.uid() LIMIT 1),
            p_action, 'support_grants', p_details ->> 'grant_id', p_details);
    PERFORM public.fn_platform_log(public.fn_business_tenant(p_business_id), lower(p_action),
                                   p_details || jsonb_build_object('business_id', p_business_id));
END;
$$;
REVOKE ALL ON FUNCTION public.fn_support_log(uuid, text, jsonb) FROM PUBLIC, anon, authenticated;

-- ============================================================================================
-- 5. The Owner: allow, see, end
-- ============================================================================================
CREATE OR REPLACE FUNCTION public.fn_require_owner(p_business_id uuid)
RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM public.business_memberships bm JOIN public.users u ON u.id = bm.user_id
        WHERE u.auth_user_id = auth.uid() AND bm.business_id = p_business_id
          AND bm.status = 'Active' AND bm.role = 'Owner') THEN
        RAISE EXCEPTION 'Only the owner of this business can do this.' USING ERRCODE = '42501';
    END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.fn_require_owner(uuid) FROM PUBLIC, anon, authenticated;

-- Ends a branch's open grant and removes Support from it at once.
CREATE OR REPLACE FUNCTION public.fn_support_close(p_business_id uuid, p_by text)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_id uuid;
BEGIN
    UPDATE public.support_grants SET ended_at = now(), ended_by_name = p_by
    WHERE business_id = p_business_id AND ended_at IS NULL AND expires_at > now()
    RETURNING id INTO v_id;
    DELETE FROM public.business_memberships WHERE business_id = p_business_id AND role::text = 'Support';
    RETURN v_id IS NOT NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.fn_support_close(uuid, text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.support_allow(p_business_id uuid, p_hours integer, p_reason text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_name text;
    g public.support_grants;
BEGIN
    PERFORM public.fn_require_owner(p_business_id);
    IF p_hours IS NULL OR p_hours < 1 OR p_hours > 72 THEN
        RAISE EXCEPTION 'Choose between 1 hour and 3 days.' USING ERRCODE = '22023';
    END IF;
    SELECT u.name INTO v_name FROM public.users u WHERE u.auth_user_id = auth.uid() LIMIT 1;
    v_name := COALESCE(NULLIF(btrim(v_name), ''), 'Owner');
    -- A new permission replaces the open one (a longer or shorter time).
    PERFORM public.fn_support_close(p_business_id, v_name);
    INSERT INTO public.support_grants (business_id, granted_by, granted_by_name, reason, expires_at)
    VALUES (p_business_id, (SELECT u.id FROM public.users u WHERE u.auth_user_id = auth.uid() LIMIT 1),
            v_name, NULLIF(btrim(COALESCE(p_reason, '')), ''), now() + make_interval(hours => p_hours))
    RETURNING * INTO g;
    PERFORM public.fn_support_log(p_business_id, 'SUPPORT_ALLOWED',
        jsonb_build_object('grant_id', g.id, 'by', v_name, 'label', 'Platform support allowed',
                           'until', g.expires_at, 'reason', g.reason));
    RETURN public.support_status(p_business_id);
END;
$$;
REVOKE ALL ON FUNCTION public.support_allow(uuid, integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.support_allow(uuid, integer, text) TO authenticated, service_role;

-- The Owner ends it; Support can also leave (ends it the same way).
CREATE OR REPLACE FUNCTION public.support_end(p_business_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_name text;
    v_support boolean := public.fn_is_support_in(p_business_id);
BEGIN
    IF NOT v_support THEN
        PERFORM public.fn_require_owner(p_business_id);
    END IF;
    v_name := CASE WHEN v_support THEN public.fn_support_label()
                   ELSE COALESCE((SELECT NULLIF(btrim(u.name), '') FROM public.users u WHERE u.auth_user_id = auth.uid() LIMIT 1), 'Owner') END;
    IF public.fn_support_close(p_business_id, v_name) THEN
        PERFORM public.fn_support_log(p_business_id, 'SUPPORT_ENDED',
            jsonb_build_object('by', v_name, 'label', 'Platform support ended'));
    END IF;
    RETURN jsonb_build_object('open', false);
END;
$$;
REVOKE ALL ON FUNCTION public.support_end(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.support_end(uuid) TO authenticated, service_role;

-- For the banner: anyone in the branch (Support too) sees whether support may open it.
CREATE OR REPLACE FUNCTION public.support_status(p_business_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    g public.support_grants;
BEGIN
    IF NOT (p_business_id = ANY(public.get_user_business_ids())) THEN
        RAISE EXCEPTION 'You are not in this business.' USING ERRCODE = '42501';
    END IF;
    g := public.fn_support_grant_open(p_business_id);
    IF g.id IS NULL THEN
        RETURN jsonb_build_object('open', false);
    END IF;
    RETURN jsonb_build_object(
        'open', true, 'until', g.expires_at, 'reason', g.reason, 'allowed_by', g.granted_by_name,
        'in_use', EXISTS (SELECT 1 FROM public.business_memberships bm
                          WHERE bm.business_id = p_business_id AND bm.role::text = 'Support'
                            AND bm.status = 'Active' AND bm.support_until > now()),
        'me', public.fn_is_support_in(p_business_id));
END;
$$;
REVOKE ALL ON FUNCTION public.support_status(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.support_status(uuid) TO authenticated, service_role;

-- ============================================================================================
-- 6. The platform admin: see who allowed it, open the branch
-- ============================================================================================
CREATE OR REPLACE FUNCTION public.platform_support_list()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    PERFORM public.fn_require_platform_admin();
    RETURN COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                   'business_id', b.id, 'branch', b.name, 'company', t.name,
                   'until', g.expires_at, 'reason', g.reason, 'allowed_by', g.granted_by_name,
                   'allowed_at', g.starts_at)
               ORDER BY g.expires_at)
        FROM public.support_grants g
        JOIN public.businesses b ON b.id = g.business_id AND b.deleted_at IS NULL
        JOIN public.tenants t ON t.id = b.tenant_id
        WHERE g.ended_at IS NULL AND g.expires_at > now()), '[]'::jsonb);
END;
$$;
REVOKE ALL ON FUNCTION public.platform_support_list() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.platform_support_list() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.platform_support_open(p_business_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    g public.support_grants;
    v_user uuid;
BEGIN
    PERFORM public.fn_require_platform_admin();
    g := public.fn_support_grant_open(p_business_id);
    IF g.id IS NULL THEN
        RAISE EXCEPTION 'The owner hasn''t allowed support for this branch, or the time is up.' USING ERRCODE = '42501';
    END IF;
    SELECT u.id INTO v_user FROM public.users u WHERE u.auth_user_id = auth.uid() LIMIT 1;
    IF v_user IS NULL THEN
        RAISE EXCEPTION 'Your account has no profile yet. Sign in to the app once first.' USING ERRCODE = 'P0002';
    END IF;
    IF EXISTS (SELECT 1 FROM public.business_memberships
               WHERE business_id = p_business_id AND user_id = v_user AND role::text <> 'Support') THEN
        RAISE EXCEPTION 'You are already a member of this branch.' USING ERRCODE = '22023';
    END IF;
    -- Runs as the table owner, so the guard trigger lets it through.
    INSERT INTO public.business_memberships (business_id, user_id, role, status, support_until)
    VALUES (p_business_id, v_user, 'Support', 'Active', g.expires_at)
    ON CONFLICT DO NOTHING;
    UPDATE public.business_memberships SET support_until = g.expires_at, status = 'Active'
    WHERE business_id = p_business_id AND user_id = v_user AND role::text = 'Support';
    PERFORM public.fn_support_log(p_business_id, 'SUPPORT_OPENED',
        jsonb_build_object('grant_id', g.id, 'by', public.fn_support_label(), 'label', 'Platform support opened the branch',
                           'until', g.expires_at));
    RETURN jsonb_build_object('business_id', p_business_id, 'until', g.expires_at);
END;
$$;
REVOKE ALL ON FUNCTION public.platform_support_open(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.platform_support_open(uuid) TO authenticated, service_role;

-- Leftovers: memberships of ended or expired grants. Every 10 minutes.
CREATE OR REPLACE FUNCTION public.run_support_cleanup()
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    n integer;
BEGIN
    DELETE FROM public.business_memberships bm
    WHERE bm.role::text = 'Support'
      AND (bm.support_until IS NULL OR bm.support_until <= now()
           OR (public.fn_support_grant_open(bm.business_id)).id IS NULL);
    GET DIAGNOSTICS n = ROW_COUNT;
    RETURN n;
END;
$$;
REVOKE ALL ON FUNCTION public.run_support_cleanup() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.run_support_cleanup() TO service_role;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
        PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'support-cleanup';
        PERFORM cron.schedule('support-cleanup', '*/10 * * * *', $job$SELECT public.run_support_cleanup()$job$);
    END IF;
END $$;
