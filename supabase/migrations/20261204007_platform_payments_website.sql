-- Platform console, support access, billing, website engine, marketing, M-Pesa per business, till payments, reconciliation, Daraja inbox.
-- Merged on 2026-11-28 from these files, in this order (each section keeps its own notes):
--   20261204007_support_access.sql
--   20261204008_general_wording.sql
--   20261205001_platform_home_billing_ai.sql
--   20261205002_delete_impact.sql
--   20261206001_website_brand.sql
--   20261206002_website_drafts_publish.sql
--   20261207001_marketing_campaigns.sql
--   20261208001_website_visits_domain_recheck.sql
--   20261209001_customer_phone_helper_grant.sql
--   20261209002_platform_domain_unique_names.sql
--   20261210001_first_user_claims_platform_admin.sql
--   20261211001_mpesa_per_business.sql
--   20261211002_plan_gates_in_db.sql
--   20261211003_storage_quota_all_buckets.sql
--   20261211004_mpesa_secrets_plan_read_only.sql
--   20261212001_storage_usage_visible.sql
--   20261212002_module_requests_support_messages.sql
--   20261212003_module_price_required.sql
--   20261212004_payment_assign_customer.sql
--   20261212005_till_payment_sale_link.sql
--   20261212006_till_payment_no_ring.sql
--   20261212007_stk_prompt_sale_link.sql
--   20261212008_payment_sweep.sql
--   20261213001_unclaimed_reconciliation.sql
--   20261214001_drop_sheets_sms_whatsapp.sql
--   20261214002_mpesa_received_confirmed_sale_maker.sql
--   20261215001_daraja_callback_inbox.sql
--   20261215002_debt_payment_moves_money.sql
--   20261216001_website_more_fonts_designs.sql

-- ===================================================================
-- 20261204007_support_access
-- ===================================================================
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

-- ===================================================================
-- 20261204008_general_wording
-- ===================================================================
-- The app serves any kind of shop, so a new website guide no longer starts in a dairy category.
-- Existing guides keep the category their shop gave them.
ALTER TABLE public.website_articles ALTER COLUMN category SET DEFAULT 'Guides';

-- ===================================================================
-- 20261205001_platform_home_billing_ai
-- ===================================================================
-- 20261205001_platform_home_ai_uses.sql
-- Owner decisions 2026-11-25:
--
--   1. The platform sets up the AI (provider, model, keys, tuning) for every company, own-key
--      plans included. A business only switches the AI on or off, per use: the in-app assistant,
--      Home and area insights, the website shop assistant, and drafting customer messages and
--      replies. ai_settings.uses holds the switches ({"website": false} = off; missing = on).
--      A trigger refuses any change to the set-up columns that doesn't come from the server
--      (edge functions) or a platform admin.
--   2. Billing: payments decide the paid-up date; nobody types it (section 3).
--   3. The console's Home page: platform_home_stats() (plans, add-ons, expected income, growth,
--      resource use) and platform_running_costs (what running the platform costs us each month,
--      for break-even). Counts and our own prices only: never a business's sales amounts.

-- ============================================================================================
-- 1. AI: per-use switches; set-up is the platform's
-- ============================================================================================
ALTER TABLE public.ai_settings ADD COLUMN IF NOT EXISTS uses jsonb NOT NULL DEFAULT '{}'::jsonb;
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ai_settings_uses_object') THEN
        ALTER TABLE public.ai_settings ADD CONSTRAINT ai_settings_uses_object CHECK (jsonb_typeof(uses) = 'object');
    END IF;
END $$;

CREATE OR REPLACE FUNCTION public.fn_ai_settings_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
    -- Edge functions (service role) and platform admins set the AI up; owners and admins of a
    -- business only change the switches and the instructions.
    IF current_user NOT IN ('authenticated', 'anon') OR public.is_platform_admin() THEN
        RETURN NEW;
    END IF;
    IF TG_OP = 'INSERT' THEN
        IF NEW.api_key IS DISTINCT FROM '' AND NEW.api_key IS NOT NULL THEN
            RAISE EXCEPTION 'The AI is set up by the platform.' USING ERRCODE = '42501';
        END IF;
        NEW.provider := 'huggingface';
        NEW.model := 'Qwen/Qwen2.5-72B-Instruct';
        RETURN NEW;
    END IF;
    IF NEW.provider IS DISTINCT FROM OLD.provider
       OR NEW.api_key IS DISTINCT FROM OLD.api_key
       OR NEW.model IS DISTINCT FROM OLD.model
       OR NEW.temperature IS DISTINCT FROM OLD.temperature
       OR NEW.max_tokens IS DISTINCT FROM OLD.max_tokens
       OR NEW.top_p IS DISTINCT FROM OLD.top_p
       OR NEW.top_k IS DISTINCT FROM OLD.top_k
       OR NEW.business_id IS DISTINCT FROM OLD.business_id THEN
        RAISE EXCEPTION 'The AI is set up by the platform.' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_ai_settings_guard ON public.ai_settings;
CREATE TRIGGER trg_ai_settings_guard BEFORE INSERT OR UPDATE ON public.ai_settings
    FOR EACH ROW EXECUTE FUNCTION public.fn_ai_settings_guard();

-- The platform admin sets the provider, model and key of a company on an own-key plan
-- (Perpetual), for every branch of it. p_api_key NULL or '' keeps the saved key.
CREATE OR REPLACE FUNCTION public.platform_set_company_ai(p_tenant_id uuid, p_provider text, p_model text, p_api_key text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_provider text := lower(btrim(COALESCE(p_provider, '')));
    v_model text := btrim(COALESCE(p_model, ''));
    v_key text := btrim(COALESCE(p_api_key, ''));
    v_n integer;
BEGIN
    PERFORM public.fn_require_platform_admin();
    IF NOT EXISTS (SELECT 1 FROM public.tenants WHERE id = p_tenant_id) THEN
        RAISE EXCEPTION 'Unknown company.';
    END IF;
    IF v_provider NOT IN ('huggingface', 'gemini', 'openai', 'anthropic', 'deepseek', 'groq', 'openrouter') THEN
        RAISE EXCEPTION 'Unknown AI provider.';
    END IF;
    IF v_model = '' OR v_model ~ '\s' THEN
        RAISE EXCEPTION 'Enter the model name, without spaces.';
    END IF;
    IF v_key ~ '\s' THEN
        RAISE EXCEPTION 'That key has spaces in it. Paste it again.';
    END IF;

    INSERT INTO public.ai_settings (business_id, provider, model, api_key)
    SELECT b.id, v_provider, v_model, v_key
    FROM public.businesses b
    WHERE b.tenant_id = p_tenant_id AND b.deleted_at IS NULL
    ON CONFLICT (business_id) DO UPDATE SET
        provider = EXCLUDED.provider,
        model = EXCLUDED.model,
        api_key = CASE WHEN v_key = '' AND public.ai_settings.provider = EXCLUDED.provider
                       THEN public.ai_settings.api_key ELSE v_key END,
        updated_at = now();
    GET DIAGNOSTICS v_n = ROW_COUNT;
    PERFORM public.fn_platform_log(p_tenant_id, 'company_ai', jsonb_build_object('provider', v_provider, 'model', v_model, 'new_key', v_key <> ''));
    RETURN jsonb_build_object('branches', v_n);
END;
$$;
REVOKE ALL ON FUNCTION public.platform_set_company_ai(uuid, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.platform_set_company_ai(uuid, text, text, text) TO authenticated, service_role;

-- What the console shows of a company's own AI set-up: never the key, only whether one is saved.
CREATE OR REPLACE FUNCTION public.platform_company_ai(p_tenant_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    PERFORM public.fn_require_platform_admin();
    RETURN (
        SELECT jsonb_build_object('provider', a.provider, 'model', a.model,
                                  'has_key', COALESCE(a.api_key, '') <> '',
                                  'key_end', CASE WHEN length(COALESCE(a.api_key, '')) > 8 THEN right(a.api_key, 4) END)
        FROM public.ai_settings a JOIN public.businesses b ON b.id = a.business_id
        WHERE b.tenant_id = p_tenant_id AND b.deleted_at IS NULL
        ORDER BY (COALESCE(a.api_key, '') <> '') DESC, a.updated_at DESC
        LIMIT 1);
END;
$$;
REVOKE ALL ON FUNCTION public.platform_company_ai(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.platform_company_ai(uuid) TO authenticated, service_role;

-- ============================================================================================
-- 2. What running the platform costs us (for break-even)
-- ============================================================================================
-- kind: fixed        = the same each month whatever the number of companies
--       per_company  = for each paying company each month (support, shared AI, hosting share)
--       share        = a percent of income (fee collection, bad debt)
-- per:  month | year (a yearly amount counts as 1/12 a month). Ignored for share.
CREATE TABLE IF NOT EXISTS public.platform_running_costs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    item text NOT NULL CHECK (length(btrim(item)) BETWEEN 1 AND 120),
    kind text NOT NULL DEFAULT 'fixed' CHECK (kind IN ('fixed', 'per_company', 'share')),
    per text NOT NULL DEFAULT 'month' CHECK (per IN ('month', 'year')),
    amount numeric(14,2) NOT NULL DEFAULT 0 CHECK (amount >= 0),
    note text CHECK (note IS NULL OR length(note) <= 500),
    active boolean NOT NULL DEFAULT true,
    sort integer NOT NULL DEFAULT 0,
    updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.platform_running_costs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS pol_platform_running_costs_select ON public.platform_running_costs;
CREATE POLICY pol_platform_running_costs_select ON public.platform_running_costs
    FOR SELECT TO authenticated USING ((SELECT public.is_platform_admin()));
REVOKE ALL ON public.platform_running_costs FROM anon, authenticated;
GRANT SELECT ON public.platform_running_costs TO authenticated;
GRANT ALL ON public.platform_running_costs TO service_role;

-- Starting figures: the estimates in ISMS-CLF Tables 11.2 and 11.3 (2026-11-24). The platform
-- admin replaces them with the real bills.
INSERT INTO public.platform_running_costs (item, kind, per, amount, note, sort)
SELECT * FROM (VALUES
    ('Supabase Pro', 'fixed', 'month', 3225.00, 'Estimate (USD 25). Replace with the real bill.', 10),
    ('Email sending service', 'fixed', 'month', 2580.00, 'Estimate. Replace with the real bill.', 20),
    ('Domain', 'fixed', 'year', 3000.00, 'Estimate. Replace with the renewal price.', 30),
    ('Windows code-signing certificate', 'fixed', 'year', 50000.00, 'Estimate; not bought yet.', 40),
    ('Tools, backup storage, monitoring', 'fixed', 'month', 1500.00, 'Estimate.', 50),
    ('Bookkeeping', 'fixed', 'month', 5000.00, 'Estimate.', 60),
    ('Legal set-up (spread)', 'fixed', 'month', 5000.00, 'Estimate.', 70),
    ('Maintenance and development time', 'fixed', 'month', 60000.00, 'Estimate: the owner''s own time.', 80),
    ('Hosting share', 'per_company', 'month', 100.00, 'Estimate per paying company.', 110),
    ('Shared AI', 'per_company', 'month', 100.00, 'Estimate per paying company.', 120),
    ('Support time', 'per_company', 'month', 1500.00, 'Estimate per paying company.', 130),
    ('Fee collection', 'share', 'month', 1.50, 'Percent of income.', 210),
    ('Bad debt', 'share', 'month', 5.00, 'Percent of income.', 220)
) v(item, kind, per, amount, note, sort)
WHERE NOT EXISTS (SELECT 1 FROM public.platform_running_costs);

CREATE OR REPLACE FUNCTION public.platform_save_running_cost(p_row jsonb)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_id uuid := NULLIF(p_row->>'id', '')::uuid;
BEGIN
    PERFORM public.fn_require_platform_admin();
    IF COALESCE((p_row->>'delete')::boolean, false) THEN
        DELETE FROM public.platform_running_costs WHERE id = v_id;
        PERFORM public.fn_platform_log(NULL, 'running_cost_deleted', jsonb_build_object('id', v_id));
        RETURN v_id;
    END IF;
    IF v_id IS NULL THEN
        INSERT INTO public.platform_running_costs (item, kind, per, amount, note, active, sort)
        VALUES (btrim(p_row->>'item'), COALESCE(p_row->>'kind', 'fixed'), COALESCE(p_row->>'per', 'month'),
                round(COALESCE((p_row->>'amount')::numeric, 0), 2), NULLIF(btrim(p_row->>'note'), ''),
                COALESCE((p_row->>'active')::boolean, true), COALESCE((p_row->>'sort')::integer, 0))
        RETURNING id INTO v_id;
    ELSE
        UPDATE public.platform_running_costs SET
            item = COALESCE(btrim(p_row->>'item'), item),
            kind = COALESCE(p_row->>'kind', kind),
            per = COALESCE(p_row->>'per', per),
            amount = COALESCE(round((p_row->>'amount')::numeric, 2), amount),
            note = CASE WHEN p_row ? 'note' THEN NULLIF(btrim(p_row->>'note'), '') ELSE note END,
            active = COALESCE((p_row->>'active')::boolean, active),
            sort = COALESCE((p_row->>'sort')::integer, sort),
            updated_at = now()
        WHERE id = v_id;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'Unknown cost.';
        END IF;
    END IF;
    PERFORM public.fn_platform_log(NULL, 'running_cost', p_row);
    RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.platform_save_running_cost(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.platform_save_running_cost(jsonb) TO authenticated, service_role;

-- ============================================================================================
-- 3. Billing: payments decide the paid-up date (owner decision 2026-11-25)
-- ============================================================================================
-- Nobody types a paid-up date. The platform admin records each payment (amount, method,
-- reference or who received the cash, date paid); the days it buys are the amount divided by
-- the company's daily rate, and the paid-up date is the end of the last payment's days.
--
-- The rate: the price agreed with the company (agreed_price), or the plan's list price plus its
-- add-ons. agreed_price is per month for monthly and yearly payers, and the whole price for a
-- one-time licence. A monthly payer's day costs 12/365 of a month; a yearly payer's 1/365 of a
-- year. "Free" (billing_cycle manual) has no end date and takes no payments.
-- Payments are never deleted: a wrong one is voided with a reason, and the dates are worked out
-- again from the rest.
ALTER TABLE public.tenant_subscriptions
    ADD COLUMN IF NOT EXISTS agreed_price numeric(14,2) CHECK (agreed_price IS NULL OR agreed_price >= 0),
    ADD COLUMN IF NOT EXISTS agreed_note text CHECK (agreed_note IS NULL OR length(agreed_note) <= 500),
    -- Paid-up date typed by hand before payments were recorded (kept, so no paid time is lost);
    -- recorded payments add their days after it.
    ADD COLUMN IF NOT EXISTS paid_before date;

-- Companies set up before this change: their typed date becomes paid_before. "By hand" with a
-- date was a paid plan, so it becomes monthly; "by hand" with no end date becomes Free.
UPDATE public.tenant_subscriptions
SET paid_before = (current_period_end AT TIME ZONE 'Africa/Nairobi')::date,
    billing_cycle = CASE WHEN billing_cycle = 'manual' THEN 'monthly' ELSE billing_cycle END
WHERE paid_before IS NULL AND current_period_end IS NOT NULL
  AND billing_cycle IN ('monthly', 'annual', 'manual');

CREATE TABLE IF NOT EXISTS public.platform_payments (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid REFERENCES public.tenants(id) ON DELETE RESTRICT,
    request_id uuid REFERENCES public.signup_requests(id) ON DELETE RESTRICT,
    paid_on date NOT NULL,
    amount numeric(14,2) NOT NULL CHECK (amount > 0),
    method text NOT NULL CHECK (method IN ('M-Pesa', 'Airtel Money', 'Cash', 'Bank', 'Card')),
    reference text CHECK (reference IS NULL OR length(reference) BETWEEN 3 AND 80),
    received_by text CHECK (received_by IS NULL OR length(received_by) BETWEEN 2 AND 80),
    plan_code text NOT NULL REFERENCES public.plans(code),
    billing_cycle text NOT NULL CHECK (billing_cycle IN ('monthly', 'annual', 'one_time')),
    -- The whole price of a one-time licence when it was recorded.
    full_price numeric(14,2),
    days integer CHECK (days IS NULL OR days >= 0),
    period_from date,
    period_to date,
    note text CHECK (note IS NULL OR length(note) <= 500),
    recorded_by uuid,
    created_at timestamptz NOT NULL DEFAULT now(),
    voided_at timestamptz,
    voided_by uuid,
    void_reason text,
    CHECK (tenant_id IS NOT NULL OR request_id IS NOT NULL),
    CHECK (method = 'Cash' OR reference IS NOT NULL),
    CHECK (method <> 'Cash' OR received_by IS NOT NULL),
    CHECK (voided_at IS NULL OR length(btrim(COALESCE(void_reason, ''))) >= 3)
);
CREATE INDEX IF NOT EXISTS idx_platform_payments_tenant ON public.platform_payments(tenant_id, paid_on);
CREATE INDEX IF NOT EXISTS idx_platform_payments_request ON public.platform_payments(request_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_platform_payments_reference
    ON public.platform_payments(method, upper(reference)) WHERE reference IS NOT NULL AND voided_at IS NULL;
ALTER TABLE public.platform_payments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS pol_platform_payments_select ON public.platform_payments;
CREATE POLICY pol_platform_payments_select ON public.platform_payments
    FOR SELECT TO authenticated USING ((SELECT public.is_platform_admin()));
REVOKE ALL ON public.platform_payments FROM anon, authenticated;
GRANT SELECT ON public.platform_payments TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.platform_payments TO service_role;

-- Payments are kept: only the void columns and the worked-out dates may change.
CREATE OR REPLACE FUNCTION public.fn_platform_payments_keep()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'Payments are kept. Void it instead.' USING ERRCODE = '42501';
    END IF;
    IF NEW.amount IS DISTINCT FROM OLD.amount OR NEW.paid_on IS DISTINCT FROM OLD.paid_on
       OR NEW.method IS DISTINCT FROM OLD.method OR NEW.reference IS DISTINCT FROM OLD.reference
       OR NEW.received_by IS DISTINCT FROM OLD.received_by OR NEW.created_at IS DISTINCT FROM OLD.created_at
       OR (OLD.voided_at IS NOT NULL AND NEW.voided_at IS DISTINCT FROM OLD.voided_at) THEN
        RAISE EXCEPTION 'A recorded payment can''t be changed. Void it and record it again.' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_platform_payments_keep ON public.platform_payments;
CREATE TRIGGER trg_platform_payments_keep BEFORE UPDATE OR DELETE ON public.platform_payments
    FOR EACH ROW EXECUTE FUNCTION public.fn_platform_payments_keep();

CREATE OR REPLACE FUNCTION public.fn_platform_today()
RETURNS date
LANGUAGE sql STABLE
SET search_path = ''
AS $$ SELECT (now() AT TIME ZONE 'Africa/Nairobi')::date $$;

-- The price of a plan for one company: per month, per year, the whole one-time price, and a day.
CREATE OR REPLACE FUNCTION public.fn_platform_rate(p_plan_code text, p_cycle text, p_addons text[], p_agreed numeric)
RETURNS jsonb
LANGUAGE plpgsql STABLE
SET search_path = ''
AS $$
DECLARE
    p public.plans;
    v_list_month numeric;
    v_list_year numeric;
    v_month numeric;
    v_year numeric;
BEGIN
    SELECT * INTO p FROM public.plans WHERE code = p_plan_code;
    IF NOT FOUND THEN
        RETURN NULL;
    END IF;
    v_list_month := p.monthly_price + COALESCE((SELECT sum(m.addon_monthly_price) FROM public.plan_modules m
                                                WHERE m.key = ANY (COALESCE(p_addons, '{}'))), 0);
    v_list_year := p.annual_price + COALESCE((SELECT sum(m.addon_annual_price) FROM public.plan_modules m
                                              WHERE m.key = ANY (COALESCE(p_addons, '{}'))), 0);
    IF p_cycle = 'one_time' THEN
        RETURN jsonb_build_object('cycle', 'one_time', 'list_price', p.one_time_price,
                                  'full_price', COALESCE(p_agreed, p.one_time_price), 'agreed', p_agreed IS NOT NULL);
    END IF;
    v_month := COALESCE(p_agreed, v_list_month);
    v_year := CASE WHEN p_agreed IS NOT NULL THEN p_agreed * 12 ELSE v_list_year END;
    RETURN jsonb_build_object(
        'cycle', p_cycle,
        'list_month', round(v_list_month, 2),
        'list_year', round(v_list_year, 2),
        'month', round(v_month, 2),
        'year', round(v_year, 2),
        'agreed', p_agreed IS NOT NULL,
        'day', CASE p_cycle WHEN 'annual' THEN v_year / 365 WHEN 'monthly' THEN v_month * 12 / 365 END);
END;
$$;
REVOKE ALL ON FUNCTION public.fn_platform_rate(text, text, text[], numeric) FROM PUBLIC, anon, authenticated;

-- Works the paid-up date out again from the payments still standing, in the order they were paid.
-- A company's days start when it was created (or the first payment, if later) and run on
-- without gaps; a payment made after the paid-up date has passed starts on the day it was paid.
CREATE OR REPLACE FUNCTION public.fn_platform_rechain(p_tenant_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    s public.tenant_subscriptions;
    t public.tenants;
    x record;
    v_next date;
    v_from date;
    v_paid numeric := 0;
    v_full numeric;
    v_any boolean := false;
BEGIN
    SELECT * INTO s FROM public.tenant_subscriptions WHERE tenant_id = p_tenant_id FOR UPDATE;
    SELECT * INTO t FROM public.tenants WHERE id = p_tenant_id;
    IF NOT FOUND OR s.billing_cycle IN ('trial', 'manual') THEN
        RETURN;
    END IF;

    IF s.billing_cycle = 'one_time' THEN
        v_full := (public.fn_platform_rate(s.plan_code, 'one_time', s.addons, s.agreed_price)->>'full_price')::numeric;
        SELECT COALESCE(sum(amount), 0) INTO v_paid FROM public.platform_payments
        WHERE tenant_id = p_tenant_id AND voided_at IS NULL AND billing_cycle = 'one_time';
        UPDATE public.tenant_subscriptions SET
            current_period_end = CASE WHEN v_full IS NOT NULL AND v_paid >= v_full THEN NULL
                                      ELSE COALESCE(current_period_end, now()) END,
            updated_at = now()
        WHERE tenant_id = p_tenant_id;
        RETURN;
    END IF;

    v_next := GREATEST((t.created_at AT TIME ZONE 'Africa/Nairobi')::date, COALESCE(s.paid_before, '-infinity'::date));
    FOR x IN SELECT * FROM public.platform_payments
             WHERE tenant_id = p_tenant_id AND voided_at IS NULL AND billing_cycle <> 'one_time'
             ORDER BY paid_on, created_at
    LOOP
        v_any := true;
        v_from := GREATEST(v_next, x.paid_on);
        UPDATE public.platform_payments
        SET period_from = v_from, period_to = v_from + GREATEST(x.days, 0) - 1
        WHERE id = x.id;
        v_next := v_from + GREATEST(x.days, 0);
    END LOOP;

    UPDATE public.tenant_subscriptions SET
        -- Paid up to the end of the last paid day, Nairobi time. No payment yet: owed from today.
        current_period_end = CASE WHEN v_any THEN (v_next::timestamp AT TIME ZONE 'Africa/Nairobi')
                                  WHEN s.paid_before IS NOT NULL THEN (s.paid_before::timestamp AT TIME ZONE 'Africa/Nairobi')
                                  ELSE LEAST(COALESCE(current_period_end, now()), now()) END,
        updated_at = now()
    WHERE tenant_id = p_tenant_id;
END;
$$;
REVOKE ALL ON FUNCTION public.fn_platform_rechain(uuid) FROM PUBLIC, anon, authenticated;

-- What a payment would buy, before it is recorded.
CREATE OR REPLACE FUNCTION public.platform_payment_preview(p_tenant_id uuid, p_amount numeric, p_paid_on date DEFAULT NULL, p_request_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    s public.tenant_subscriptions;
    q public.signup_requests;
    v_plan text;
    v_cycle text;
    v_rate jsonb;
    v_days integer;
    v_start date;
    v_paid_on date := COALESCE(p_paid_on, public.fn_platform_today());
    v_paid numeric;
BEGIN
    PERFORM public.fn_require_platform_admin();
    IF p_tenant_id IS NOT NULL THEN
        SELECT * INTO s FROM public.tenant_subscriptions WHERE tenant_id = p_tenant_id;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'Unknown company.';
        END IF;
        v_plan := s.plan_code; v_cycle := s.billing_cycle;
        v_rate := public.fn_platform_rate(s.plan_code, s.billing_cycle, s.addons, s.agreed_price);
    ELSE
        SELECT * INTO q FROM public.signup_requests WHERE id = p_request_id;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'Unknown request.';
        END IF;
        v_plan := q.plan_code; v_cycle := q.billing_cycle;
        v_rate := public.fn_platform_rate(q.plan_code, q.billing_cycle, q.addons, NULL);
    END IF;
    IF v_cycle IN ('trial', 'manual') THEN
        RAISE EXCEPTION 'This company has no paid plan. Choose its plan and how it pays first.';
    END IF;

    IF v_cycle = 'one_time' THEN
        SELECT COALESCE(sum(amount), 0) INTO v_paid FROM public.platform_payments
        WHERE ((p_tenant_id IS NOT NULL AND tenant_id = p_tenant_id) OR (p_request_id IS NOT NULL AND request_id = p_request_id))
          AND voided_at IS NULL;
        RETURN jsonb_build_object('plan', v_plan, 'cycle', v_cycle, 'rate', v_rate,
            'paid_before', v_paid, 'still_owed', GREATEST((v_rate->>'full_price')::numeric - v_paid - COALESCE(p_amount, 0), 0));
    END IF;
    IF (v_rate->>'day')::numeric IS NULL OR (v_rate->>'day')::numeric <= 0 THEN
        RAISE EXCEPTION 'This plan has no price for that way of paying. Set an agreed price.';
    END IF;

    -- From the whole amounts, so a full month or year is never a day short through rounding.
    v_days := floor(COALESCE(p_amount, 0) * 365
                    / CASE v_cycle WHEN 'annual' THEN (v_rate->>'year')::numeric ELSE (v_rate->>'month')::numeric * 12 END);
    v_start := GREATEST(v_paid_on,
                        CASE WHEN s.current_period_end IS NOT NULL
                             THEN (s.current_period_end AT TIME ZONE 'Africa/Nairobi')::date END,
                        CASE WHEN p_tenant_id IS NULL THEN public.fn_platform_today() END);
    RETURN jsonb_build_object(
        'plan', v_plan, 'cycle', v_cycle, 'rate', v_rate,
        'days', v_days,
        'from', v_start,
        'to', v_start + v_days - 1,
        'whole_months', CASE WHEN v_cycle = 'monthly' THEN floor(COALESCE(p_amount, 0) / NULLIF((v_rate->>'month')::numeric, 0)) END,
        'whole_years', CASE WHEN v_cycle = 'annual' THEN floor(COALESCE(p_amount, 0) / NULLIF((v_rate->>'year')::numeric, 0)) END,
        'paid_up_now', s.current_period_end);
END;
$$;
REVOKE ALL ON FUNCTION public.platform_payment_preview(uuid, numeric, date, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.platform_payment_preview(uuid, numeric, date, uuid) TO authenticated, service_role;

-- Record a payment from a company (tenant_id) or for a waiting request (request_id).
CREATE OR REPLACE FUNCTION public.platform_record_payment(p_row jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_tenant uuid := NULLIF(p_row->>'tenant_id', '')::uuid;
    v_request uuid := NULLIF(p_row->>'request_id', '')::uuid;
    v_amount numeric := round((p_row->>'amount')::numeric, 2);
    v_paid_on date := COALESCE((p_row->>'paid_on')::date, public.fn_platform_today());
    v_method text := p_row->>'method';
    v_ref text := NULLIF(btrim(p_row->>'reference'), '');
    v_by text := NULLIF(btrim(p_row->>'received_by'), '');
    v_prev jsonb;
    v_id uuid;
    q public.signup_requests;
BEGIN
    PERFORM public.fn_require_platform_admin();
    IF v_amount IS NULL OR v_amount <= 0 THEN
        RAISE EXCEPTION 'Enter the amount paid.';
    END IF;
    IF v_paid_on > public.fn_platform_today() THEN
        RAISE EXCEPTION 'The payment date can''t be in the future.';
    END IF;
    IF v_paid_on < public.fn_platform_today() - 90 THEN
        RAISE EXCEPTION 'That date is more than 90 days ago.';
    END IF;
    IF v_method IS NULL OR v_method NOT IN ('M-Pesa', 'Airtel Money', 'Cash', 'Bank', 'Card') THEN
        RAISE EXCEPTION 'Choose how they paid.';
    END IF;
    IF v_method <> 'Cash' AND v_ref IS NULL THEN
        RAISE EXCEPTION 'Enter the payment code or bank reference.';
    END IF;
    IF v_method = 'Cash' AND v_by IS NULL THEN
        RAISE EXCEPTION 'Enter who received the cash.';
    END IF;
    IF v_ref IS NOT NULL AND EXISTS (SELECT 1 FROM public.platform_payments WHERE method = v_method
                                     AND upper(reference) = upper(v_ref) AND voided_at IS NULL) THEN
        RAISE EXCEPTION 'That payment code is already recorded.';
    END IF;
    IF v_tenant IS NULL AND v_request IS NOT NULL THEN
        SELECT * INTO q FROM public.signup_requests WHERE id = v_request;
        IF NOT FOUND OR q.status <> 'pending' THEN
            RAISE EXCEPTION 'That request is not waiting for a decision.';
        END IF;
        v_tenant := q.tenant_id;  -- a plan change belongs to an existing company
    END IF;
    IF v_tenant IS NOT NULL AND v_request IS NULL
       AND (SELECT billing_cycle FROM public.tenant_subscriptions WHERE tenant_id = v_tenant) IN ('trial', 'manual') THEN
        RAISE EXCEPTION 'This company has no paid plan. Choose its plan and how it pays first.';
    END IF;

    -- A request's payment is priced on the requested plan; a company's on its current one.
    IF v_request IS NOT NULL THEN
        v_prev := public.platform_payment_preview(NULL, v_amount, v_paid_on, v_request);
    ELSE
        v_prev := public.platform_payment_preview(v_tenant, v_amount, v_paid_on, NULL);
    END IF;
    IF v_prev->>'cycle' <> 'one_time' AND (v_prev->>'days')::integer < 1 THEN
        RAISE EXCEPTION 'That amount buys less than a day.';
    END IF;

    INSERT INTO public.platform_payments (tenant_id, request_id, paid_on, amount, method, reference, received_by,
                                          plan_code, billing_cycle, full_price, days, note, recorded_by)
    VALUES (CASE WHEN v_request IS NULL THEN v_tenant END, v_request, v_paid_on, v_amount, v_method, v_ref, v_by,
            v_prev->>'plan', v_prev->>'cycle', (v_prev->'rate'->>'full_price')::numeric,
            (v_prev->>'days')::integer, NULLIF(btrim(p_row->>'note'), ''), auth.uid())
    RETURNING id INTO v_id;

    IF v_request IS NULL THEN
        PERFORM public.fn_platform_rechain(v_tenant);
    END IF;
    PERFORM public.fn_platform_log(v_tenant, 'payment_recorded',
        jsonb_build_object('payment', v_id, 'amount', v_amount, 'method', v_method, 'reference', v_ref,
                           'days', v_prev->'days', 'request', v_request));
    RETURN jsonb_build_object('id', v_id, 'preview', v_prev,
                              'paid_up_to', (SELECT current_period_end FROM public.tenant_subscriptions WHERE tenant_id = v_tenant));
END;
$$;
REVOKE ALL ON FUNCTION public.platform_record_payment(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.platform_record_payment(jsonb) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.platform_void_payment(p_payment_id uuid, p_reason text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    x public.platform_payments;
BEGIN
    PERFORM public.fn_require_platform_admin();
    IF length(btrim(COALESCE(p_reason, ''))) < 3 THEN
        RAISE EXCEPTION 'Say why it is voided.';
    END IF;
    SELECT * INTO x FROM public.platform_payments WHERE id = p_payment_id FOR UPDATE;
    IF NOT FOUND OR x.voided_at IS NOT NULL THEN
        RAISE EXCEPTION 'That payment is not standing.';
    END IF;
    UPDATE public.platform_payments SET voided_at = now(), voided_by = auth.uid(), void_reason = btrim(p_reason)
    WHERE id = p_payment_id;
    IF x.tenant_id IS NOT NULL THEN
        PERFORM public.fn_platform_rechain(x.tenant_id);
    END IF;
    PERFORM public.fn_platform_log(x.tenant_id, 'payment_voided',
        jsonb_build_object('payment', p_payment_id, 'amount', x.amount, 'reason', btrim(p_reason)));
    RETURN jsonb_build_object('paid_up_to', (SELECT current_period_end FROM public.tenant_subscriptions WHERE tenant_id = x.tenant_id));
END;
$$;
REVOKE ALL ON FUNCTION public.platform_void_payment(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.platform_void_payment(uuid, text) TO authenticated, service_role;

-- Change a company's plan, how it pays and the agreed price. The paid-up date is never set here:
-- it comes from payments. Days already paid keep their dates.
CREATE OR REPLACE FUNCTION public.platform_change_plan(p_tenant_id uuid, p_plan_code text, p_cycle text,
                                                        p_agreed_price numeric DEFAULT NULL, p_agreed_note text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    p public.plans;
    s public.tenant_subscriptions;
    st public.platform_settings;
    v_cycle text;
    v_rate jsonb;
    r jsonb;
    v_warn text[] := '{}';
    v_branches integer;
BEGIN
    PERFORM public.fn_require_platform_admin();
    SELECT * INTO p FROM public.plans WHERE code = p_plan_code;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Unknown plan.';
    END IF;
    SELECT * INTO s FROM public.tenant_subscriptions WHERE tenant_id = p_tenant_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Unknown company.';
    END IF;
    SELECT * INTO st FROM public.platform_settings WHERE id;
    IF p_agreed_price IS NOT NULL AND p_agreed_price < 0 THEN
        RAISE EXCEPTION 'The agreed price can''t be below zero.';
    END IF;

    v_cycle := CASE WHEN p.kind = 'trial' THEN 'trial'
                    WHEN p.kind = 'perpetual' THEN 'one_time'
                    ELSE p_cycle END;
    IF v_cycle NOT IN ('trial', 'monthly', 'annual', 'one_time', 'manual') THEN
        RAISE EXCEPTION 'Choose monthly, yearly, once or free.';
    END IF;
    IF p.kind = 'subscription' AND v_cycle = 'one_time' THEN
        RAISE EXCEPTION 'This plan is paid monthly or yearly.';
    END IF;
    IF v_cycle IN ('monthly', 'annual', 'one_time') THEN
        v_rate := public.fn_platform_rate(p.code, v_cycle,
                                          CASE WHEN p.addons_allowed THEN s.addons ELSE '{}' END, round(p_agreed_price, 2));
        IF (v_cycle = 'one_time' AND (v_rate->>'full_price') IS NULL)
           OR (v_cycle <> 'one_time' AND COALESCE((v_rate->>'day')::numeric, 0) <= 0) THEN
            RAISE EXCEPTION 'This plan has no list price for that. Enter the agreed price.';
        END IF;
    END IF;

    UPDATE public.tenant_subscriptions SET
        plan_code = p.code,
        status = CASE WHEN v_cycle = 'trial' THEN 'trial' WHEN status = 'suspended' THEN 'suspended' ELSE 'active' END,
        billing_cycle = v_cycle,
        trial_ends_at = CASE WHEN v_cycle = 'trial'
                             THEN GREATEST(COALESCE(trial_ends_at, now()), now() + make_interval(days => st.trial_days))
                             ELSE trial_ends_at END,
        -- Free: no end. Coming off a trial or Free: owed from now until a payment is recorded.
        current_period_end = CASE WHEN v_cycle IN ('trial', 'manual') THEN NULL
                                  WHEN s.billing_cycle IN ('trial', 'manual') THEN now()
                                  ELSE current_period_end END,
        agreed_price = CASE WHEN v_cycle IN ('trial', 'manual') THEN NULL ELSE round(p_agreed_price, 2) END,
        paid_before = CASE WHEN v_cycle IN ('trial', 'manual') THEN NULL ELSE paid_before END,
        agreed_note = CASE WHEN v_cycle IN ('trial', 'manual') THEN NULL ELSE NULLIF(btrim(p_agreed_note), '') END,
        addons = CASE WHEN p.addons_allowed THEN addons ELSE '{}' END,
        updated_at = now(), updated_by = auth.uid()
    WHERE tenant_id = p_tenant_id;
    IF v_cycle IN ('monthly', 'annual', 'one_time')
       AND EXISTS (SELECT 1 FROM public.platform_payments WHERE tenant_id = p_tenant_id AND voided_at IS NULL) THEN
        PERFORM public.fn_platform_rechain(p_tenant_id);
    END IF;
    PERFORM public.fn_platform_log(p_tenant_id, 'plan_set',
        jsonb_build_object('plan', p.code, 'cycle', v_cycle, 'agreed_price', p_agreed_price, 'note', p_agreed_note));

    r := public.fn_tenant_plan(p_tenant_id);
    SELECT count(*) INTO v_branches FROM public.businesses WHERE tenant_id = p_tenant_id AND deleted_at IS NULL;
    IF v_branches > (r->>'max_branches')::integer THEN
        v_warn := v_warn || format('%s branches open; the plan allows %s.', v_branches, r->>'max_branches');
    END IF;
    IF public.fn_tenant_staff_used(p_tenant_id) > (r->>'max_staff')::integer THEN
        v_warn := v_warn || format('%s staff; the plan allows %s.', public.fn_tenant_staff_used(p_tenant_id), r->>'max_staff');
    END IF;
    RETURN r || jsonb_build_object('warnings', to_jsonb(v_warn));
END;
$$;
REVOKE ALL ON FUNCTION public.platform_change_plan(uuid, text, text, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.platform_change_plan(uuid, text, text, numeric, text) TO authenticated, service_role;

-- Suspend or let a company back in. Letting it back in never adds paid days.
CREATE OR REPLACE FUNCTION public.platform_set_suspended(p_tenant_id uuid, p_suspended boolean, p_reason text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    PERFORM public.fn_require_platform_admin();
    IF p_suspended AND length(btrim(COALESCE(p_reason, ''))) < 3 THEN
        RAISE EXCEPTION 'Say why the company is suspended.';
    END IF;
    UPDATE public.tenant_subscriptions SET
        status = CASE WHEN p_suspended THEN 'suspended'
                      WHEN billing_cycle = 'trial' THEN 'trial' ELSE 'active' END,
        updated_at = now(), updated_by = auth.uid()
    WHERE tenant_id = p_tenant_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Unknown company.';
    END IF;
    PERFORM public.fn_platform_log(p_tenant_id, CASE WHEN p_suspended THEN 'suspended' ELSE 'unsuspended' END,
                                   jsonb_build_object('reason', NULLIF(btrim(p_reason), '')));
    RETURN public.fn_tenant_plan(p_tenant_id);
END;
$$;
REVOKE ALL ON FUNCTION public.platform_set_suspended(uuid, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.platform_set_suspended(uuid, boolean, text) TO authenticated, service_role;

-- The old setter took a typed paid-up date. Only the platform admin could call it; now nobody can.
REVOKE EXECUTE ON FUNCTION public.platform_set_plan(uuid, text, text, text, timestamptz, text) FROM authenticated;

-- Approving a paid request needs its payment recorded first; the paid days come from it.
CREATE OR REPLACE FUNCTION public.platform_decide_signup(p_request_id uuid, p_approve boolean, p_note text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_req public.signup_requests;
    v_kind text;
BEGIN
    PERFORM public.fn_require_platform_admin();
    SELECT * INTO v_req FROM public.signup_requests WHERE id = p_request_id AND status = 'pending' FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'That request is not waiting for a decision.';
    END IF;
    SELECT kind INTO v_kind FROM public.plans WHERE code = v_req.plan_code;
    IF p_approve AND v_kind <> 'trial'
       AND NOT EXISTS (SELECT 1 FROM public.platform_payments WHERE request_id = p_request_id AND voided_at IS NULL) THEN
        RAISE EXCEPTION 'Record their payment first. The paid days come from it.' USING HINT = 'payment_required';
    END IF;
    UPDATE public.signup_requests
    SET status = CASE WHEN NOT p_approve THEN 'rejected' WHEN kind = 'change' THEN 'used' ELSE 'approved' END,
        decided_by = auth.uid(), decided_at = now(), decision_note = p_note, updated_at = now()
    WHERE id = p_request_id;
    IF NOT p_approve THEN
        -- Money taken for a turned-down request stays on record, voided, so it can be refunded.
        UPDATE public.platform_payments SET voided_at = now(), voided_by = auth.uid(),
               void_reason = 'Request turned down' || COALESCE(': ' || NULLIF(btrim(p_note), ''), '')
        WHERE request_id = p_request_id AND voided_at IS NULL;
    END IF;
    IF p_approve AND v_req.kind = 'change' THEN
        PERFORM public.platform_change_plan(v_req.tenant_id, v_req.plan_code, v_req.billing_cycle, NULL, NULL);
        PERFORM public.platform_set_addons(v_req.tenant_id, v_req.addons)
        WHERE (SELECT addons_allowed FROM public.plans WHERE code = v_req.plan_code);
        UPDATE public.platform_payments SET tenant_id = v_req.tenant_id
        WHERE request_id = p_request_id AND voided_at IS NULL;
        PERFORM public.fn_platform_rechain(v_req.tenant_id);
    END IF;
    PERFORM public.fn_platform_log(v_req.tenant_id, CASE WHEN p_approve THEN 'signup_approved' ELSE 'signup_rejected' END,
        jsonb_build_object('request', p_request_id, 'kind', v_req.kind, 'note', p_note));
END;
$$;

-- A new company made from an approved request: its request's payments become its own, and the
-- paid-up date comes from them (not a free month or year).
CREATE OR REPLACE FUNCTION public.fn_signup_request_used()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF NEW.status = 'used' AND NEW.tenant_id IS NOT NULL AND OLD.status IS DISTINCT FROM 'used' THEN
        UPDATE public.platform_payments SET tenant_id = NEW.tenant_id
        WHERE request_id = NEW.id AND tenant_id IS NULL AND voided_at IS NULL;
        IF FOUND THEN
            PERFORM public.fn_platform_rechain(NEW.tenant_id);
        END IF;
    END IF;
    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_signup_request_used ON public.signup_requests;
CREATE TRIGGER trg_signup_request_used AFTER UPDATE OF status, tenant_id ON public.signup_requests
    FOR EACH ROW EXECUTE FUNCTION public.fn_signup_request_used();

-- The money screen: payments (newest first) and who owes.
CREATE OR REPLACE FUNCTION public.platform_billing()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_month date := date_trunc('month', public.fn_platform_today())::date;
BEGIN
    PERFORM public.fn_require_platform_admin();
    RETURN jsonb_build_object(
        'received_this_month', (SELECT COALESCE(sum(amount), 0) FROM public.platform_payments
                                WHERE voided_at IS NULL AND paid_on >= v_month),
        'received_last_month', (SELECT COALESCE(sum(amount), 0) FROM public.platform_payments
                                WHERE voided_at IS NULL AND paid_on >= (v_month - interval '1 month')::date AND paid_on < v_month),
        'payments', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                'id', x.id, 'tenant_id', x.tenant_id, 'request_id', x.request_id,
                'company', COALESCE(t.name, q.business_name), 'paid_on', x.paid_on, 'amount', x.amount,
                'method', x.method, 'reference', x.reference, 'received_by', x.received_by,
                'plan', x.plan_code, 'cycle', x.billing_cycle, 'days', x.days,
                'period_from', x.period_from, 'period_to', x.period_to, 'note', x.note,
                'voided_at', x.voided_at, 'void_reason', x.void_reason, 'created_at', x.created_at)
                ORDER BY x.paid_on DESC, x.created_at DESC)
            FROM (SELECT * FROM public.platform_payments ORDER BY paid_on DESC, created_at DESC LIMIT 300) x
            LEFT JOIN public.tenants t ON t.id = x.tenant_id
            LEFT JOIN public.signup_requests q ON q.id = x.request_id), '[]'::jsonb),
        'companies', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                'tenant_id', t.id, 'name', t.name, 'plan', s.plan_code, 'cycle', s.billing_cycle,
                'status', pl->>'status', 'paid_up_to', s.current_period_end,
                'agreed_price', s.agreed_price, 'rate', public.fn_platform_rate(s.plan_code, s.billing_cycle, s.addons, s.agreed_price),
                'paid_total', (SELECT COALESCE(sum(amount), 0) FROM public.platform_payments p
                               WHERE p.tenant_id = t.id AND p.voided_at IS NULL),
                'last_paid_on', (SELECT max(paid_on) FROM public.platform_payments p WHERE p.tenant_id = t.id AND p.voided_at IS NULL))
                ORDER BY s.current_period_end NULLS LAST)
            FROM public.tenants t JOIN public.tenant_subscriptions s ON s.tenant_id = t.id
            CROSS JOIN LATERAL (SELECT public.fn_tenant_plan(t.id) AS pl) z
            WHERE s.billing_cycle IN ('monthly', 'annual', 'one_time')), '[]'::jsonb));
END;
$$;
REVOKE ALL ON FUNCTION public.platform_billing() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.platform_billing() TO authenticated, service_role;

-- ============================================================================================
-- 4. The console's Home page
-- ============================================================================================
-- "Expected each month" is what today's paying companies owe us a month at today's prices:
-- the agreed price, or else monthly plans at the monthly price and annual plans at a twelfth of
-- the annual price, plus their add-ons the same way. Trials, Free and one-time licences add
-- nothing. "Received" is the payments recorded (section 3).
-- Growth is by month of sign-up; the platform keeps no history of past prices.
CREATE OR REPLACE FUNCTION public.platform_home_stats(p_months integer DEFAULT 12)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_months integer := LEAST(GREATEST(COALESCE(p_months, 12), 3), 36);
    v_from date := (date_trunc('month', now() AT TIME ZONE 'Africa/Nairobi') - make_interval(months => v_months - 1))::date;
    v_files bigint := 0;
    r jsonb;
BEGIN
    PERFORM public.fn_require_platform_admin();

    BEGIN
        EXECUTE $q$SELECT COALESCE(sum((metadata->>'size')::bigint), 0) FROM storage.objects$q$ INTO v_files;
    EXCEPTION WHEN OTHERS THEN
        v_files := NULL;
    END;

    WITH t AS (
        SELECT tn.id, tn.name, tn.created_at, s.started_at, s.billing_cycle, s.agreed_price, public.fn_tenant_plan(tn.id) AS pl
        FROM public.tenants tn JOIN public.tenant_subscriptions s ON s.tenant_id = tn.id
    ), tp AS (
        SELECT t.*, p.code, p.name AS plan_name, p.kind, p.monthly_price, p.annual_price, p.one_time_price,
               t.pl->>'status' AS status,
               (t.pl->>'status') IN ('active', 'grace') AND p.kind = 'subscription'
                   AND t.billing_cycle IN ('monthly', 'annual') AS paying,
               -- What they pay a month: the agreed price, or the list price.
               CASE WHEN (t.pl->>'status') IN ('active', 'grace') AND p.kind = 'subscription' THEN
                   CASE t.billing_cycle
                       WHEN 'annual' THEN COALESCE(t.agreed_price, COALESCE(p.annual_price, 0) / 12)
                       WHEN 'monthly' THEN COALESCE(t.agreed_price, COALESCE(p.monthly_price, 0))
                       ELSE 0 END
               ELSE 0 END AS plan_month,
               -- The list price a month, to show what agreed prices give away.
               CASE WHEN (t.pl->>'status') IN ('active', 'grace') AND p.kind = 'subscription' THEN
                   CASE t.billing_cycle
                       WHEN 'annual' THEN COALESCE(p.annual_price, 0) / 12
                       WHEN 'monthly' THEN COALESCE(p.monthly_price, 0)
                       ELSE 0 END
               ELSE 0 END AS list_month,
               ARRAY(SELECT jsonb_array_elements_text(t.pl->'addons')) AS addons,
               (SELECT count(*) FROM public.businesses b WHERE b.tenant_id = t.id AND b.deleted_at IS NULL) AS branches,
               (SELECT count(DISTINCT bm.user_id) FROM public.business_memberships bm
                  JOIN public.businesses b ON b.id = bm.business_id
                 WHERE b.tenant_id = t.id AND b.deleted_at IS NULL AND bm.status = 'Active') AS staff,
               COALESCE((t.pl->>'max_branches')::integer, 0) AS max_branches,
               COALESCE((t.pl->>'max_staff')::integer, 0) AS max_staff,
               COALESCE((t.pl->>'storage_mb')::integer, 0) AS storage_mb,
               COALESCE((t.pl->>'ai_daily_cap')::integer, 0) AS ai_cap,
               COALESCE((SELECT calls FROM public.ai_usage u WHERE u.tenant_id = t.id AND u.day = public.fn_ai_today()), 0) AS ai_today,
               COALESCE((SELECT sum(calls) FROM public.ai_usage u WHERE u.tenant_id = t.id AND u.day > public.fn_ai_today() - 30), 0) AS ai_30
        FROM t JOIN public.plans p ON p.code = t.pl->>'plan'
    ), ad AS (
        SELECT m.key, m.name, count(*) AS companies,
               sum(CASE WHEN tp.paying AND tp.agreed_price IS NULL THEN
                       CASE tp.billing_cycle WHEN 'annual' THEN COALESCE(m.addon_annual_price, 0) / 12
                                             ELSE COALESCE(m.addon_monthly_price, 0) END
                   ELSE 0 END) AS month_value
        FROM tp CROSS JOIN LATERAL unnest(tp.addons) a(key)
        JOIN public.plan_modules m ON m.key = a.key
        GROUP BY m.key, m.name, m.sort ORDER BY m.sort
    ), addon_by_tenant AS (
        SELECT tp.id,
               sum(CASE WHEN tp.paying AND tp.agreed_price IS NULL THEN
                       CASE tp.billing_cycle WHEN 'annual' THEN COALESCE(m.addon_annual_price, 0) / 12
                                             ELSE COALESCE(m.addon_monthly_price, 0) END
                   ELSE 0 END) AS v
        FROM tp CROSS JOIN LATERAL unnest(tp.addons) a(key)
        JOIN public.plan_modules m ON m.key = a.key
        GROUP BY tp.id
    ), months AS (
        SELECT generate_series(v_from, (date_trunc('month', now() AT TIME ZONE 'Africa/Nairobi'))::date, interval '1 month')::date AS m
    )
    SELECT jsonb_build_object(
        'as_of', now(),
        'companies', (SELECT count(*) FROM tp),
        'paying', (SELECT count(*) FROM tp WHERE paying),
        'by_status', (SELECT COALESCE(jsonb_object_agg(status, n), '{}'::jsonb) FROM (SELECT status, count(*) n FROM tp GROUP BY status) x),
        'expected_month', round((SELECT COALESCE(sum(plan_month), 0) FROM tp) + (SELECT COALESCE(sum(v), 0) FROM addon_by_tenant), 2),
        'agreed_companies', (SELECT count(*) FROM tp WHERE paying AND agreed_price IS NOT NULL),
        'given_off_month', round((SELECT COALESCE(sum(GREATEST(list_month - plan_month, 0)), 0) FROM tp WHERE paying AND agreed_price IS NOT NULL), 2),
        'free_companies', (SELECT count(*) FROM tp WHERE billing_cycle = 'manual'),
        'received_this_month', (SELECT COALESCE(sum(amount), 0) FROM public.platform_payments
                                WHERE voided_at IS NULL AND paid_on >= date_trunc('month', public.fn_platform_today())::date),
        'owing', (SELECT count(*) FROM tp WHERE status IN ('grace', 'read_only') AND billing_cycle IN ('monthly', 'annual', 'one_time')),
        'plans', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                'code', p.code, 'name', p.name, 'kind', p.kind,
                'companies', (SELECT count(*) FROM tp WHERE tp.code = p.code),
                'paying', (SELECT count(*) FROM tp WHERE tp.code = p.code AND tp.paying),
                'month_value', round((SELECT COALESCE(sum(plan_month), 0) FROM tp WHERE tp.code = p.code), 2)) ORDER BY p.sort)
            FROM public.plans p), '[]'::jsonb),
        'addons', COALESCE((SELECT jsonb_agg(jsonb_build_object('key', key, 'name', name, 'companies', companies,
                                                                  'month_value', round(month_value, 2))) FROM ad), '[]'::jsonb),
        'one_time', COALESCE((SELECT jsonb_agg(jsonb_build_object('plan', plan_name, 'companies', n, 'price', price))
                              FROM (SELECT plan_name, count(*) n, max(one_time_price) price FROM tp
                                    WHERE kind = 'perpetual' AND status IN ('active', 'grace') GROUP BY plan_name) x), '[]'::jsonb),
        'growth', (
            SELECT jsonb_agg(jsonb_build_object(
                'month', to_char(mo.m, 'YYYY-MM'),
                'new_companies', (SELECT count(*) FROM tp WHERE (tp.created_at AT TIME ZONE 'Africa/Nairobi')::date >= mo.m
                                                           AND (tp.created_at AT TIME ZONE 'Africa/Nairobi')::date < (mo.m + interval '1 month')::date),
                'companies', (SELECT count(*) FROM tp WHERE (tp.created_at AT TIME ZONE 'Africa/Nairobi')::date < (mo.m + interval '1 month')::date),
                'branches', (SELECT count(*) FROM public.businesses b WHERE b.deleted_at IS NULL
                               AND (b.created_at AT TIME ZONE 'Africa/Nairobi')::date < (mo.m + interval '1 month')::date),
                'expected_month', round(COALESCE((SELECT sum(tp.plan_month + COALESCE(abt.v, 0)) FROM tp LEFT JOIN addon_by_tenant abt ON abt.id = tp.id
                                                  WHERE tp.paying AND (tp.started_at AT TIME ZONE 'Africa/Nairobi')::date < (mo.m + interval '1 month')::date), 0), 2),
                'received', (SELECT COALESCE(sum(amount), 0) FROM public.platform_payments pp WHERE pp.voided_at IS NULL
                               AND pp.paid_on >= mo.m AND pp.paid_on < (mo.m + interval '1 month')::date),
                'sales', (SELECT count(*) FROM public.transactions tx WHERE tx.timestamp >= (mo.m::timestamp AT TIME ZONE 'Africa/Nairobi')
                                                                       AND tx.timestamp < ((mo.m + interval '1 month')::timestamp AT TIME ZONE 'Africa/Nairobi')),
                'ai_calls', (SELECT COALESCE(sum(calls), 0) FROM public.ai_usage u WHERE u.day >= mo.m AND u.day < (mo.m + interval '1 month')::date)
            ) ORDER BY mo.m)
            FROM months mo),
        'usage', jsonb_build_object(
            'branches', (SELECT COALESCE(sum(branches), 0) FROM tp),
            'branches_allowed', (SELECT COALESCE(sum(max_branches), 0) FROM tp),
            'staff', (SELECT COALESCE(sum(staff), 0) FROM tp),
            'staff_allowed', (SELECT COALESCE(sum(max_staff), 0) FROM tp),
            'ai_today', (SELECT COALESCE(sum(ai_today), 0) FROM tp),
            'ai_cap_today', (SELECT COALESCE(sum(ai_cap), 0) FROM tp WHERE status IN ('trial', 'active', 'grace')),
            'ai_30_days', (SELECT COALESCE(sum(ai_30), 0) FROM tp),
            'database_bytes', pg_database_size(current_database()),
            'files_bytes', v_files,
            'storage_allowed_mb', (SELECT COALESCE(sum(storage_mb), 0) FROM tp WHERE status IN ('trial', 'active', 'grace'))),
        'busiest', COALESCE((
            SELECT jsonb_agg(x ORDER BY (x->>'load')::numeric DESC) FROM (
                SELECT jsonb_build_object('tenant_id', id, 'name', name, 'plan', plan_name, 'status', status,
                                          'branches', branches, 'max_branches', max_branches,
                                          'staff', staff, 'max_staff', max_staff,
                                          'ai_today', ai_today, 'ai_cap', ai_cap, 'ai_30', ai_30,
                                          'load', round(GREATEST(branches::numeric / NULLIF(max_branches, 0),
                                                                 staff::numeric / NULLIF(max_staff, 0),
                                                                 ai_today::numeric / NULLIF(ai_cap, 0), 0) * 100)) AS x
                FROM tp ORDER BY GREATEST(branches::numeric / NULLIF(max_branches, 0), staff::numeric / NULLIF(max_staff, 0),
                                          ai_today::numeric / NULLIF(ai_cap, 0), 0) DESC NULLS LAST
                LIMIT 8) y), '[]'::jsonb),
        'costs', jsonb_build_object(
            'fixed_month', round((SELECT COALESCE(sum(CASE per WHEN 'year' THEN amount / 12 ELSE amount END), 0)
                                  FROM public.platform_running_costs WHERE active AND kind = 'fixed'), 2),
            'per_company_month', round((SELECT COALESCE(sum(CASE per WHEN 'year' THEN amount / 12 ELSE amount END), 0)
                                        FROM public.platform_running_costs WHERE active AND kind = 'per_company'), 2),
            'share_percent', (SELECT COALESCE(sum(amount), 0) FROM public.platform_running_costs WHERE active AND kind = 'share'))
    ) INTO r;
    RETURN r;
END;
$$;
REVOKE ALL ON FUNCTION public.platform_home_stats(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.platform_home_stats(integer) TO authenticated, service_role;

-- ===================================================================
-- 20261205002_delete_impact
-- ===================================================================
-- 20261205002_delete_impact.sql
-- Owner decision 2026-11-25: a delete is never just a swipe. The app first shows what removing a
-- customer, product or supplier would touch, and the person decides. Things that would break the
-- money rules (CLAUDE.md, rule 4) are refused here, whatever app or version asks:
--
--   customer  still owes money, still has wallet money, or has a regular order running
--   product   still has stock (its value would drop out of the stock figures), or a regular
--             order still delivers it
--   supplier  we still owe them on a bill, or an order to them is still open
--   worker    owns the business, is clocked in, or has deliveries not finished
--   branch    is the only one, has people clocked in, stock, or orders not finished; a branch is
--             now closed (deleted_at, records kept), never hard-deleted
--   expense   nothing blocks it; the sheet says where the money goes back to
--
-- delete_impact(kind, id, business) returns { name, blockers: [text], effects: [text] } for the confirm
-- sheet. Blockers say what to do first; effects say what happens and what is kept.

CREATE OR REPLACE FUNCTION public.fn_money_text(p numeric)
RETURNS text
LANGUAGE sql IMMUTABLE
SET search_path = ''
AS $$ SELECT 'KSh ' || to_char(round(COALESCE(p, 0), 2), 'FM999,999,999,990.00') $$;

CREATE OR REPLACE FUNCTION public.fn_delete_blockers(p_kind text, p_id uuid, p_business_id uuid DEFAULT NULL)
RETURNS text[]
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v text[] := '{}';
    c public.customers;
    p public.products;
    n integer;
    m numeric;
    v_emp uuid[];
BEGIN
    IF p_kind = 'customer' THEN
        SELECT * INTO c FROM public.customers WHERE id = p_id;
        IF c.debt_balance > 0 THEN
            v := v || format('Owes %s. Take the payment first.', public.fn_money_text(c.debt_balance));
        END IF;
        IF c.wallet_balance > 0 THEN
            v := v || format('Has %s in their wallet. Pay it back or use it first.', public.fn_money_text(c.wallet_balance));
        END IF;
        SELECT count(*) INTO n FROM public.regular_orders WHERE customer_id = p_id AND status IN ('requested', 'active', 'paused');
        IF n > 0 THEN
            v := v || format('%s regular %s still running. End %s first.', n, CASE WHEN n = 1 THEN 'order is' ELSE 'orders are' END, CASE WHEN n = 1 THEN 'it' ELSE 'them' END);
        END IF;
        SELECT count(*) INTO n FROM public.sales_orders WHERE customer_id = p_id AND status IN ('confirmed', 'part_delivered', 'delivered', 'invoiced');
        IF n > 0 THEN
            v := v || format('%s %s not finished (delivered and paid, or cancelled).', n, CASE WHEN n = 1 THEN 'order is' ELSE 'orders are' END);
        END IF;
    ELSIF p_kind = 'product' THEN
        SELECT * INTO p FROM public.products WHERE id = p_id;
        IF p.stock > 0 THEN
            v := v || format('%s %s still in stock, worth %s at cost. Sell it, or count it to 0 with a reason, first.',
                             trim(to_char(p.stock, 'FM999,999,990.0')), COALESCE(NULLIF(p.unit, ''), 'units'),
                             public.fn_money_text(p.stock * COALESCE(p.cost, 0)));
        END IF;
        SELECT count(*) INTO n FROM public.regular_orders WHERE product_id = p_id AND status IN ('requested', 'active', 'paused');
        IF n > 0 THEN
            v := v || format('%s regular %s still deliver it. End or change %s first.', n, CASE WHEN n = 1 THEN 'order' ELSE 'orders' END, CASE WHEN n = 1 THEN 'it' ELSE 'them' END);
        END IF;
    ELSIF p_kind = 'supplier' THEN
        SELECT COALESCE(sum(balance), 0), count(*) INTO m, n FROM public.supplier_bills
        WHERE supplier_id = p_id AND voided_at IS NULL AND status IN ('needs_check', 'open') AND balance > 0;
        IF m > 0 THEN
            v := v || format('We still owe them %s on %s %s. Pay or settle first.', public.fn_money_text(m), n, CASE WHEN n = 1 THEN 'bill' ELSE 'bills' END);
        END IF;
        SELECT count(*) INTO n FROM public.purchases
        WHERE supplier_id = p_id AND status IN ('Pending', 'RFQ', 'Awaiting approval', 'Ordered', 'Part received');
        IF n > 0 THEN
            v := v || format('%s %s to them still open. Receive or cancel %s first.', n, CASE WHEN n = 1 THEN 'order' ELSE 'orders' END, CASE WHEN n = 1 THEN 'it' ELSE 'them' END);
        END IF;
    ELSIF p_kind = 'worker' THEN
        -- p_id is the person (users.id), p_business_id the branch they are removed from.
        IF EXISTS (SELECT 1 FROM public.tenants t JOIN public.businesses b ON b.tenant_id = t.id
                   WHERE b.id = p_business_id AND t.owner_user_id = p_id)
           OR EXISTS (SELECT 1 FROM public.business_memberships
                      WHERE business_id = p_business_id AND user_id = p_id AND role::text = 'Owner') THEN
            v := v || 'They own the business. The owner can''t be removed.'::text;
        END IF;
        SELECT array_agg(id) INTO v_emp FROM public.employees
        WHERE (user_id = p_id OR id = p_id) AND (business_id = p_business_id OR business_id IS NULL);
        IF EXISTS (SELECT 1 FROM public.shifts WHERE business_id = p_business_id AND employee_id = ANY (v_emp)
                   AND end_time IS NULL AND deleted_at IS NULL) THEN
            v := v || 'They are clocked in. Clock them out first.'::text;
        END IF;
        SELECT (SELECT count(*) FROM public.transactions WHERE business_id = p_business_id AND rider_id = ANY (v_emp)
                AND is_delivery AND deleted_at IS NULL AND delivery_status IN ('assigned', 'out_for_delivery'))
             + (SELECT count(*) FROM public.online_orders WHERE business_id = p_business_id AND rider_id = ANY (v_emp)
                AND status IN ('paid', 'preparing', 'out_for_delivery'))
          INTO n;
        IF n > 0 THEN
            v := v || format('%s %s with them. Give %s to another rider or finish %s first.', n,
                             CASE WHEN n = 1 THEN 'delivery is' ELSE 'deliveries are' END,
                             CASE WHEN n = 1 THEN 'it' ELSE 'them' END, CASE WHEN n = 1 THEN 'it' ELSE 'them' END);
        END IF;
    ELSIF p_kind = 'branch' THEN
        IF NOT EXISTS (SELECT 1 FROM public.businesses o JOIN public.businesses b ON b.tenant_id = o.tenant_id
                       WHERE b.id = p_id AND o.id <> p_id AND o.deleted_at IS NULL) THEN
            v := v || 'It is your only branch. A business needs at least one.'::text;
        END IF;
        SELECT count(*) INTO n FROM public.shifts WHERE business_id = p_id AND end_time IS NULL AND deleted_at IS NULL;
        IF n > 0 THEN
            v := v || format('%s %s still clocked in there. Clock %s out first.', n, CASE WHEN n = 1 THEN 'person is' ELSE 'people are' END, CASE WHEN n = 1 THEN 'them' ELSE 'them' END);
        END IF;
        SELECT count(*), COALESCE(sum(stock * COALESCE(cost, 0)), 0) INTO n, m FROM public.products
        WHERE business_id = p_id AND deleted_at IS NULL AND stock > 0;
        IF n > 0 THEN
            v := v || format('%s %s still %s stock, worth %s at cost. Send it to another branch, or count it to 0 with a reason, first.',
                             n, CASE WHEN n = 1 THEN 'product' ELSE 'products' END, CASE WHEN n = 1 THEN 'has' ELSE 'have' END, public.fn_money_text(m));
        END IF;
        SELECT (SELECT count(*) FROM public.transactions WHERE business_id = p_id AND is_delivery AND deleted_at IS NULL
                AND delivery_status IN ('assigned', 'out_for_delivery'))
             + (SELECT count(*) FROM public.online_orders WHERE business_id = p_id
                AND status IN ('paid', 'preparing', 'out_for_delivery', 'ready_for_pickup'))
             + (SELECT count(*) FROM public.sales_orders WHERE business_id = p_id
                AND status IN ('confirmed', 'part_delivered', 'delivered', 'invoiced'))
          INTO n;
        IF n > 0 THEN
            v := v || format('%s %s not finished. Deliver, or cancel, %s first.', n, CASE WHEN n = 1 THEN 'order is' ELSE 'orders are' END, CASE WHEN n = 1 THEN 'it' ELSE 'them' END);
        END IF;
        SELECT count(*) INTO n FROM public.regular_orders WHERE business_id = p_id AND status IN ('requested', 'active', 'paused');
        IF n > 0 THEN
            v := v || format('%s regular %s still running. End %s first.', n, CASE WHEN n = 1 THEN 'order is' ELSE 'orders are' END, CASE WHEN n = 1 THEN 'it' ELSE 'them' END);
        END IF;
    END IF;
    RETURN v;
END;
$$;
REVOKE ALL ON FUNCTION public.fn_delete_blockers(text, uuid, uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.delete_impact(p_kind text, p_id uuid, p_business_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_business uuid;
    v_name text;
    e text[] := '{}';
    n integer;
    m numeric;
    d timestamptz;
    c public.customers;
    p public.products;
    x public.expenses;
    v_emp uuid[];
    v_lock date;
    v_list text;
BEGIN
    IF p_kind = 'customer' THEN
        SELECT * INTO c FROM public.customers WHERE id = p_id AND deleted_at IS NULL;
        v_business := c.business_id; v_name := c.name;
    ELSIF p_kind = 'product' THEN
        SELECT * INTO p FROM public.products WHERE id = p_id AND deleted_at IS NULL;
        v_business := p.business_id; v_name := p.name;
    ELSIF p_kind = 'supplier' THEN
        SELECT business_id, name INTO v_business, v_name FROM public.suppliers WHERE id = p_id AND deleted_at IS NULL;
    ELSIF p_kind = 'worker' THEN
        SELECT bm.business_id, COALESCE(NULLIF(u.name, ''), u.email) INTO v_business, v_name
        FROM public.business_memberships bm JOIN public.users u ON u.id = bm.user_id
        WHERE bm.user_id = p_id AND bm.business_id = p_business_id;
    ELSIF p_kind = 'branch' THEN
        SELECT id, name INTO v_business, v_name FROM public.businesses WHERE id = p_id AND deleted_at IS NULL;
    ELSIF p_kind = 'expense' THEN
        SELECT * INTO x FROM public.expenses WHERE id = p_id AND deleted_at IS NULL;
        v_business := x.business_id; v_name := x.category || ' ' || public.fn_money_text(x.amount);
    ELSE
        RAISE EXCEPTION 'Unknown kind of record.';
    END IF;
    IF v_business IS NULL THEN
        RAISE EXCEPTION 'That record is not there any more.';
    END IF;
    PERFORM public.assert_business_member(v_business);

    IF p_kind = 'customer' THEN
        SELECT count(*), max(timestamp) INTO n, d FROM public.transactions WHERE customer_id = p_id AND deleted_at IS NULL;
        e := e || CASE WHEN n > 0
                       THEN format('Their %s %s stay in the records and reports under their name (last on %s).', n, CASE WHEN n = 1 THEN 'sale' ELSE 'sales' END, to_char(d AT TIME ZONE 'Africa/Nairobi', 'DD Mon YYYY'))
                       ELSE 'They have no sales.' END;
        IF c.loyalty_points > 0 THEN
            e := e || format('Their %s loyalty points are lost.', c.loyalty_points);
        END IF;
        SELECT count(*) INTO n FROM public.invoices WHERE customer_id = p_id;
        IF n > 0 THEN
            e := e || format('%s %s stay on record.', n, CASE WHEN n = 1 THEN 'invoice' ELSE 'invoices' END);
        END IF;
        SELECT count(*) INTO n FROM public.quotes WHERE customer_id = p_id AND status IN ('draft', 'sent');
        IF n > 0 THEN
            e := e || format('%s open %s for them will no longer show a customer.', n, CASE WHEN n = 1 THEN 'quote' ELSE 'quotes' END);
        END IF;
        e := e || 'They can''t be picked at the till or messaged any more. Their website account (if any) stops working.'::text;
    ELSIF p_kind = 'product' THEN
        SELECT count(DISTINCT ti.transaction_id), COALESCE(sum(ti.quantity), 0) INTO n, m FROM public.transaction_items ti WHERE ti.product_id = p_id;
        e := e || CASE WHEN n > 0 THEN format('Sold in %s %s; those stay in the records and reports.', n, CASE WHEN n = 1 THEN 'sale' ELSE 'sales' END)
                       ELSE 'It has never been sold.' END;
        SELECT count(*) INTO n FROM public.bom_ingredients WHERE product_id = p_id;
        IF n > 0 THEN
            e := e || format('It is an ingredient in %s production %s, which will miss it.', n, CASE WHEN n = 1 THEN 'recipe' ELSE 'recipes' END);
        END IF;
        IF p.show_on_website THEN
            e := e || 'It disappears from your online shop.'::text;
        END IF;
        e := e || 'It can''t be sold or ordered any more.'::text;
    ELSIF p_kind = 'supplier' THEN
        SELECT count(*) INTO n FROM public.purchases WHERE supplier_id = p_id;
        IF n > 0 THEN
            e := e || format('%s past %s stay on record.', n, CASE WHEN n = 1 THEN 'order' ELSE 'orders' END);
        END IF;
        SELECT count(*) INTO n FROM public.products WHERE preferred_supplier_id = p_id AND deleted_at IS NULL;
        IF n > 0 THEN
            e := e || format('%s %s lose their usual supplier.', n, CASE WHEN n = 1 THEN 'product' ELSE 'products' END);
        END IF;
        e := e || 'You can''t order from them any more; their supplier login stops working.'::text;
    ELSIF p_kind = 'worker' THEN
        SELECT array_agg(id) INTO v_emp FROM public.employees
        WHERE (user_id = p_id OR id = p_id) AND (business_id = v_business OR business_id IS NULL);
        SELECT count(*) INTO n FROM public.transactions WHERE business_id = v_business AND staff_id = ANY (v_emp) AND deleted_at IS NULL;
        e := e || CASE WHEN n > 0 THEN format('The %s %s they made stay in the records under their name.', n, CASE WHEN n = 1 THEN 'sale' ELSE 'sales' END)
                       ELSE 'They have made no sales here.' END;
        SELECT COALESCE(sum(balance), 0) INTO m FROM public.fn_rider_pay_items(v_business) WHERE rider_id = ANY (v_emp) AND balance > 0;
        IF m > 0 THEN
            e := e || format('We still owe them %s rider pay. You can still pay it after they are removed.', public.fn_money_text(m));
        END IF;
        e := e || 'Their clock-in hours stay on record.'::text;
        SELECT count(*) INTO n FROM public.business_memberships bm JOIN public.businesses b ON b.id = bm.business_id
        WHERE bm.user_id = p_id AND bm.business_id <> v_business AND b.deleted_at IS NULL
          AND b.tenant_id = (SELECT tenant_id FROM public.businesses WHERE id = v_business);
        e := e || CASE WHEN n > 0 THEN format('They can''t sign in to this branch any more, but keep their place at %s other %s.', n, CASE WHEN n = 1 THEN 'branch' ELSE 'branches' END)
                       ELSE 'They can''t sign in to this business any more.' END;
    ELSIF p_kind = 'branch' THEN
        SELECT count(*), max(timestamp) INTO n, d FROM public.transactions WHERE business_id = p_id AND deleted_at IS NULL;
        e := e || CASE WHEN n > 0 THEN format('Its %s %s and its books are kept, not deleted (last sale %s).', n, CASE WHEN n = 1 THEN 'sale' ELSE 'sales' END, to_char(d AT TIME ZONE 'Africa/Nairobi', 'DD Mon YYYY'))
                       ELSE 'It has no sales. Its records are kept, not deleted.' END;
        SELECT string_agg(method || ' ' || public.fn_money_text(balance), ', ' ORDER BY method), COALESCE(sum(balance), 0)
          INTO v_list, m FROM public.money_assets WHERE business_id = p_id AND balance <> 0;
        IF v_list IS NOT NULL THEN
            e := e || format('Its accounts still show %s (%s). If that money moves, record it before closing.', public.fn_money_text(m), v_list);
        END IF;
        SELECT count(*), COALESCE(sum(debt_balance), 0) INTO n, m FROM public.customers WHERE business_id = p_id AND deleted_at IS NULL AND debt_balance > 0;
        IF n > 0 THEN
            e := e || format('%s %s owe it %s. You can''t collect that in the app once it is closed.', n, CASE WHEN n = 1 THEN 'customer' ELSE 'customers' END, public.fn_money_text(m));
        END IF;
        SELECT COALESCE(sum(balance), 0) INTO m FROM public.supplier_bills WHERE business_id = p_id AND voided_at IS NULL AND status IN ('needs_check', 'open') AND balance > 0;
        IF m > 0 THEN
            e := e || format('It still owes suppliers %s on open bills.', public.fn_money_text(m));
        END IF;
        IF EXISTS (SELECT 1 FROM public.businesses WHERE id = p_id AND NULLIF(website_slug, '') IS NOT NULL) THEN
            e := e || 'Its online shop goes offline.'::text;
        END IF;
        SELECT count(*) INTO n FROM public.business_memberships WHERE business_id = p_id AND status = 'Active' AND role::text <> 'Support';
        e := e || format('%s %s lose access to it. Nobody can sell from it or sign in to it.', n, CASE WHEN n = 1 THEN 'person' ELSE 'people' END);
    ELSIF p_kind = 'expense' THEN
        e := e || format('%s goes back to %s.', public.fn_money_text(x.amount), COALESCE(NULLIF(x.payment_method, ''), 'Cash'));
        SELECT lock_date INTO v_lock FROM public.acc_settings WHERE business_id = v_business;
        e := e || CASE WHEN v_lock IS NOT NULL AND (x.date AT TIME ZONE 'Africa/Nairobi')::date <= v_lock
                       THEN 'The books for that day are closed, so a reversing entry is made today.'
                       ELSE 'Its books entry is taken out.' END;
        IF x.rider_payment THEN
            e := e || 'It was rider pay, so the rider is owed that money again.'::text;
        END IF;
        e := e || 'It stops counting in spending, profit and shift reports.'::text;
    END IF;

    RETURN jsonb_build_object('kind', p_kind, 'name', v_name,
                              'blockers', to_jsonb(public.fn_delete_blockers(p_kind, p_id, v_business)),
                              'effects', to_jsonb(e));
END;
$$;
REVOKE ALL ON FUNCTION public.delete_impact(text, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_impact(text, uuid, uuid) TO authenticated, service_role;

-- The same blockers, enforced when the row is soft-deleted. A merge (merged_into_id set, balances
-- moved to the record kept) is not a delete.
CREATE OR REPLACE FUNCTION public.fn_guard_soft_delete()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_kind text := CASE TG_TABLE_NAME WHEN 'customers' THEN 'customer' WHEN 'products' THEN 'product' ELSE 'supplier' END;
    v_block text[];
BEGIN
    IF OLD.deleted_at IS NOT NULL OR NEW.deleted_at IS NULL THEN
        RETURN NEW;
    END IF;
    IF TG_TABLE_NAME = 'customers' AND (to_jsonb(NEW)->>'merged_into_id') IS NOT NULL THEN
        RETURN NEW;
    END IF;
    v_block := public.fn_delete_blockers(v_kind, NEW.id);
    IF cardinality(v_block) > 0 THEN
        RAISE EXCEPTION '%', v_block[1] USING ERRCODE = 'P0001', HINT = 'delete_blocked';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_customers_guard_delete ON public.customers;
CREATE TRIGGER trg_customers_guard_delete BEFORE UPDATE OF deleted_at ON public.customers
    FOR EACH ROW EXECUTE FUNCTION public.fn_guard_soft_delete();
DROP TRIGGER IF EXISTS trg_products_guard_delete ON public.products;
CREATE TRIGGER trg_products_guard_delete BEFORE UPDATE OF deleted_at ON public.products
    FOR EACH ROW EXECUTE FUNCTION public.fn_guard_soft_delete();
DROP TRIGGER IF EXISTS trg_suppliers_guard_delete ON public.suppliers;
CREATE TRIGGER trg_suppliers_guard_delete BEFORE UPDATE OF deleted_at ON public.suppliers
    FOR EACH ROW EXECUTE FUNCTION public.fn_guard_soft_delete();

-- ---------------------------------------------------------------- workers
-- Removing someone from a branch (their membership row). Support access is the platform's own
-- and is removed by its own functions.
CREATE OR REPLACE FUNCTION public.fn_guard_member_remove()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_block text[];
BEGIN
    IF OLD.role::text = 'Support' OR OLD.status <> 'Active' THEN
        RETURN OLD;
    END IF;
    v_block := public.fn_delete_blockers('worker', OLD.user_id, OLD.business_id);
    IF cardinality(v_block) > 0 THEN
        RAISE EXCEPTION '%', v_block[1] USING ERRCODE = 'P0001', HINT = 'delete_blocked';
    END IF;
    RETURN OLD;
END;
$$;
DROP TRIGGER IF EXISTS trg_memberships_guard_remove ON public.business_memberships;
CREATE TRIGGER trg_memberships_guard_remove BEFORE DELETE ON public.business_memberships
    FOR EACH ROW EXECUTE FUNCTION public.fn_guard_member_remove();

-- ---------------------------------------------------------------- branches
-- A branch was hard-deleted before, which cascaded into its sales, books and stock records.
-- Now it is closed (deleted_at) and everything is kept; nobody signed in can hard-delete one.
DROP POLICY IF EXISTS pol_businesses_delete ON public.businesses;
REVOKE DELETE, TRUNCATE ON public.businesses FROM authenticated, anon;

CREATE OR REPLACE FUNCTION public.fn_guard_branch_close()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_block text[];
BEGIN
    IF OLD.deleted_at IS NOT NULL OR NEW.deleted_at IS NULL THEN
        RETURN NEW;
    END IF;
    IF auth.uid() IS NOT NULL AND NOT public.has_permission(NEW.id, 'business.delete') THEN
        RAISE EXCEPTION 'You don''t have permission to close this branch.' USING ERRCODE = '42501';
    END IF;
    v_block := public.fn_delete_blockers('branch', NEW.id);
    IF cardinality(v_block) > 0 THEN
        RAISE EXCEPTION '%', v_block[1] USING ERRCODE = 'P0001', HINT = 'delete_blocked';
    END IF;
    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_businesses_guard_close ON public.businesses;
CREATE TRIGGER trg_businesses_guard_close BEFORE UPDATE OF deleted_at ON public.businesses
    FOR EACH ROW EXECUTE FUNCTION public.fn_guard_branch_close();

CREATE OR REPLACE FUNCTION public.close_branch(p_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF NOT public.has_permission(p_id, 'business.delete') THEN
        RAISE EXCEPTION 'You don''t have permission to close this branch.' USING ERRCODE = '42501';
    END IF;
    UPDATE public.businesses SET deleted_at = now() WHERE id = p_id AND deleted_at IS NULL;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'That branch is already closed.';
    END IF;
    INSERT INTO public.audit_logs (business_id, user_id, action, table_name, record_id)
    VALUES (p_id, (SELECT id FROM public.users WHERE auth_user_id = auth.uid()), 'branch_closed', 'businesses', p_id::text);
END;
$$;
REVOKE ALL ON FUNCTION public.close_branch(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.close_branch(uuid) TO authenticated, service_role;

-- ===================================================================
-- 20261206001_website_brand
-- ===================================================================
-- 20261206001_website_brand.sql
-- Website engine, phase 2: the shop's brand profile (docs/roadmap/website-engine-audit.md).
--
--   * One brand per shop (a businesses row with a website). Owner decision 2026-11-25.
--   * One record per fact: name, description, logo, primary and secondary colour, address and
--     contacts stay on businesses (receipts and the app use them too). website_brand holds the
--     rest: industry, personality, tone, story, fonts, styles, logo variants, socials, hours.
--   * website_brand_save() writes both in one transaction, checked by business.update.
--   * Fonts come from an allow-list only; colours are #rrggbb; the page background must be
--     light (dark text sits on it everywhere). No free CSS or HTML anywhere.
--   * Existing shops get design_preset 'original' so their website looks exactly as before
--     until someone changes the design. New shops get the look their industry and
--     personality suggest (website/src/engine/presets.ts).
--   * Until drafts exist (phase 5) the public website reads this table directly.
--
-- Reverse: DROP FUNCTION website_brand_save, fn_website_brand_public, fn_valid_*;
--          DROP TABLE website_brand; restore get_public_storefront from 20261204004.

-- ============================================================================================
-- 1. Value rules (shared by the table checks and the save function)
-- ============================================================================================
CREATE OR REPLACE FUNCTION public.fn_website_fonts()
RETURNS text[]
LANGUAGE sql IMMUTABLE
SET search_path = ''
AS $$
    -- Keep in step with FONTS in website/src/engine/brand.ts.
    SELECT ARRAY['Poppins', 'Inter', 'DM Sans', 'Manrope', 'Work Sans', 'Nunito Sans', 'Outfit',
                 'Archivo', 'Space Grotesk', 'IBM Plex Sans', 'Lora', 'Playfair Display',
                 'Cormorant Garamond', 'Fraunces', 'Source Serif 4'];
$$;

-- WCAG relative luminance of #rrggbb (0 = black, 1 = white).
CREATE OR REPLACE FUNCTION public.fn_hex_luminance(p_hex text)
RETURNS numeric
LANGUAGE plpgsql IMMUTABLE
SET search_path = ''
AS $$
DECLARE
    c numeric[] := ARRAY[]::numeric[];
    v numeric;
    i integer;
BEGIN
    IF p_hex IS NULL OR p_hex !~* '^#[0-9a-f]{6}$' THEN
        RETURN NULL;
    END IF;
    FOR i IN 0..2 LOOP
        v := ('x' || substr(p_hex, 2 + i * 2, 2))::bit(8)::integer / 255.0;
        c := c || CASE WHEN v <= 0.03928 THEN v / 12.92 ELSE power((v + 0.055) / 1.055, 2.4) END;
    END LOOP;
    RETURN 0.2126 * c[1] + 0.7152 * c[2] + 0.0722 * c[3];
END;
$$;

-- {"instagram": "https://..."}: known networks only, https addresses.
CREATE OR REPLACE FUNCTION public.fn_valid_social_links(p jsonb)
RETURNS boolean
LANGUAGE sql IMMUTABLE
SET search_path = ''
AS $$
    SELECT jsonb_typeof(p) = 'object'
       AND NOT EXISTS (
           SELECT 1 FROM jsonb_each(p) e
           WHERE e.key NOT IN ('facebook', 'instagram', 'tiktok', 'x', 'youtube', 'linkedin')
              OR jsonb_typeof(e.value) <> 'string'
              OR e.value #>> '{}' !~ '^https://[^\s<>"]+$'
              OR length(e.value #>> '{}') > 300);
$$;

-- [{"day":0,"open":"08:00","close":"18:00"}]: day 0 = Monday ... 6 = Sunday; a missing day is closed.
CREATE OR REPLACE FUNCTION public.fn_valid_opening_hours(p jsonb)
RETURNS boolean
LANGUAGE sql IMMUTABLE
SET search_path = ''
AS $$
    SELECT jsonb_typeof(p) = 'array'
       AND jsonb_array_length(p) <= 14
       AND NOT EXISTS (
           SELECT 1 FROM jsonb_array_elements(p) h
           WHERE jsonb_typeof(h) <> 'object'
              OR (h->>'day') !~ '^[0-6]$'
              OR (h->>'open') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
              OR (h->>'close') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$|^24:00$'
              OR (h->>'close') <= (h->>'open'));
$$;

REVOKE ALL ON FUNCTION public.fn_website_fonts(), public.fn_hex_luminance(text),
    public.fn_valid_social_links(jsonb), public.fn_valid_opening_hours(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_website_fonts(), public.fn_hex_luminance(text),
    public.fn_valid_social_links(jsonb), public.fn_valid_opening_hours(jsonb) TO authenticated, service_role;

-- ============================================================================================
-- 2. The brand table
-- ============================================================================================
CREATE TABLE IF NOT EXISTS public.website_brand (
    business_id uuid PRIMARY KEY REFERENCES public.businesses(id) ON DELETE CASCADE,
    -- What the business is and how it presents itself. Drives the default design.
    industry text NOT NULL DEFAULT 'general_retail' CHECK (industry IN (
        'food_grocery', 'restaurant', 'beauty', 'fashion', 'electronics', 'pharmacy', 'hardware',
        'professional_services', 'logistics', 'general_retail', 'other')),
    personality text CHECK (personality IS NULL OR personality IN (
        'premium', 'friendly', 'bold', 'classic', 'minimal', 'natural', 'technical', 'playful')),
    tone text NOT NULL DEFAULT 'warm' CHECK (tone IN ('warm', 'formal', 'confident', 'playful', 'plain')),
    -- NULL = from industry and personality; 'original' = the website's look before phase 2.
    design_preset text CHECK (design_preset IS NULL OR design_preset IN (
        'original', 'premium', 'friendly', 'bold', 'classic', 'minimal', 'natural', 'technical', 'playful')),
    tagline text CHECK (tagline IS NULL OR length(tagline) <= 120),
    story text CHECK (story IS NULL OR length(story) <= 4000),
    mission text CHECK (mission IS NULL OR length(mission) <= 500),
    audience text CHECK (audience IS NULL OR length(audience) <= 500),
    positioning text CHECK (positioning IS NULL OR length(positioning) <= 500),
    guidelines text CHECK (guidelines IS NULL OR length(guidelines) <= 2000),
    -- Colours beyond businesses.primary_color / secondary_color.
    accent_color text CHECK (accent_color IS NULL OR accent_color ~* '^#[0-9a-f]{6}$'),
    background_color text CHECK (background_color IS NULL OR (background_color ~* '^#[0-9a-f]{6}$'
                                 AND public.fn_hex_luminance(background_color) >= 0.75)),
    -- Type. NULL = from the preset.
    heading_font text CHECK (heading_font IS NULL OR heading_font = ANY (public.fn_website_fonts())),
    body_font text CHECK (body_font IS NULL OR body_font = ANY (public.fn_website_fonts())),
    heading_weight smallint CHECK (heading_weight IS NULL OR heading_weight IN (400, 500, 600, 700, 800)),
    -- Shapes and imagery. NULL = from the preset.
    corner_style text CHECK (corner_style IS NULL OR corner_style IN ('square', 'soft', 'round')),
    button_style text CHECK (button_style IS NULL OR button_style IN ('solid', 'outline', 'pill')),
    density text CHECK (density IS NULL OR density IN ('compact', 'comfortable', 'airy')),
    -- 'cutout' = product on a plain background, shown whole; 'photo' = photograph filling its frame.
    image_style text CHECK (image_style IS NULL OR image_style IN ('cutout', 'photo')),
    image_ratio text CHECK (image_ratio IS NULL OR image_ratio IN ('square', 'portrait', 'landscape')),
    -- Logo variants (the main logo is businesses.logo_url).
    logo_light_url text CHECK (logo_light_url IS NULL OR (logo_light_url ~ '^https://[^\s<>"]+$' AND length(logo_light_url) <= 1000)),
    logo_mark_url text CHECK (logo_mark_url IS NULL OR (logo_mark_url ~ '^https://[^\s<>"]+$' AND length(logo_mark_url) <= 1000)),
    favicon_url text CHECK (favicon_url IS NULL OR (favicon_url ~ '^https://[^\s<>"]+$' AND length(favicon_url) <= 1000)),
    social_links jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (public.fn_valid_social_links(social_links)),
    opening_hours jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (public.fn_valid_opening_hours(opening_hours)),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    updated_by uuid
);

ALTER TABLE public.website_brand ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS pol_website_brand_select ON public.website_brand;
CREATE POLICY pol_website_brand_select ON public.website_brand FOR SELECT TO authenticated
    USING (business_id = ANY (public.get_user_business_ids()));
-- Writes only through website_brand_save (one transaction with businesses).
REVOKE ALL ON public.website_brand FROM anon, authenticated;
GRANT SELECT ON public.website_brand TO authenticated;
GRANT ALL ON public.website_brand TO service_role;

DROP TRIGGER IF EXISTS trg_website_brand_updated_at ON public.website_brand;
CREATE TRIGGER trg_website_brand_updated_at BEFORE UPDATE ON public.website_brand
    FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();
DROP TRIGGER IF EXISTS trg_zz_plan_read_only ON public.website_brand;
CREATE TRIGGER trg_zz_plan_read_only BEFORE INSERT OR UPDATE OR DELETE ON public.website_brand
    FOR EACH ROW EXECUTE FUNCTION public.fn_block_when_read_only();

-- A first guess at the industry from the free-text business type and name.
CREATE OR REPLACE FUNCTION public.fn_guess_industry(p_type text, p_name text)
RETURNS text
LANGUAGE sql IMMUTABLE
SET search_path = ''
AS $$
    SELECT CASE
        WHEN t ~ '(dairy|milk|grocer|supermarket|food|bakery|butcher|farm|fruit|vegetable|mini ?mart)' THEN 'food_grocery'
        WHEN t ~ '(restaurant|cafe|café|hotel|eatery|kitchen|grill|bar\b|coffee)' THEN 'restaurant'
        WHEN t ~ '(beauty|salon|spa|cosmetic|skin|hair|barber|nail|perfume)' THEN 'beauty'
        WHEN t ~ '(fashion|cloth|boutique|apparel|shoe|wear)' THEN 'fashion'
        WHEN t ~ '(electronic|phone|computer|gadget|tech|appliance)' THEN 'electronics'
        WHEN t ~ '(pharma|chemist|clinic|medical|drug)' THEN 'pharmacy'
        WHEN t ~ '(hardware|construction|building|tools|paint)' THEN 'hardware'
        WHEN t ~ '(logistic|courier|transport|delivery|freight|haulage|moving)' THEN 'logistics'
        WHEN t ~ '(consult|law|legal|account|agency|service|studio|design|insurance)' THEN 'professional_services'
        ELSE 'general_retail' END
    FROM (SELECT lower(COALESCE(p_type, '') || ' ' || COALESCE(p_name, '')) AS t) x;
$$;
REVOKE ALL ON FUNCTION public.fn_guess_industry(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_guess_industry(text, text) TO service_role;

-- Existing shops keep today's look. Rows are added for every live business so the Brand screen
-- always has one; a business created later gets its row on first save.
INSERT INTO public.website_brand (business_id, industry, design_preset)
SELECT b.id, public.fn_guess_industry(b.business_type, b.name), 'original'
FROM public.businesses b
WHERE b.deleted_at IS NULL
ON CONFLICT (business_id) DO NOTHING;

-- ============================================================================================
-- 3. Saving the brand (both tables, one transaction)
-- ============================================================================================
CREATE OR REPLACE FUNCTION public.website_brand_save(p_business_id uuid, p_brand jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    -- Keys that live on businesses; everything else is a website_brand column.
    v_biz_keys text[] := ARRAY['description', 'logo_url', 'primary_color', 'secondary_color'];
    v_brand_keys text[] := ARRAY['industry', 'personality', 'tone', 'design_preset', 'tagline', 'story',
        'mission', 'audience', 'positioning', 'guidelines', 'accent_color', 'background_color',
        'heading_font', 'body_font', 'heading_weight', 'corner_style', 'button_style', 'density',
        'image_style', 'image_ratio', 'logo_light_url', 'logo_mark_url', 'favicon_url',
        'social_links', 'opening_hours'];
    v_key text;
    v_txt jsonb := '{}'::jsonb;
    r public.website_brand;
BEGIN
    IF NOT public.has_permission(p_business_id, 'business.update') THEN
        RAISE EXCEPTION 'You do not have permission to change the website brand.';
    END IF;
    IF jsonb_typeof(COALESCE(p_brand, 'null'::jsonb)) <> 'object' THEN
        RAISE EXCEPTION 'Nothing to save.';
    END IF;
    FOR v_key IN SELECT jsonb_object_keys(p_brand) LOOP
        IF NOT (v_key = ANY (v_biz_keys) OR v_key = ANY (v_brand_keys)) THEN
            RAISE EXCEPTION 'Unknown brand setting: %', v_key;
        END IF;
    END LOOP;

    -- Text: trimmed, empty = not set.
    SELECT COALESCE(jsonb_object_agg(e.key, CASE WHEN jsonb_typeof(e.value) = 'string'
                                               THEN to_jsonb(NULLIF(trim(e.value #>> '{}'), ''))
                                               ELSE e.value END), '{}'::jsonb)
    INTO v_txt FROM jsonb_each(p_brand) e;

    -- Clear messages for the rules people are most likely to hit.
    IF v_txt ? 'primary_color' AND v_txt->>'primary_color' IS NOT NULL AND v_txt->>'primary_color' !~* '^#[0-9a-f]{6}$' THEN
        RAISE EXCEPTION 'Colours are written like #1f6feb.';
    END IF;
    IF v_txt ? 'secondary_color' AND v_txt->>'secondary_color' IS NOT NULL AND v_txt->>'secondary_color' !~* '^#[0-9a-f]{6}$' THEN
        RAISE EXCEPTION 'Colours are written like #1f6feb.';
    END IF;
    IF v_txt->>'background_color' IS NOT NULL AND COALESCE(public.fn_hex_luminance(v_txt->>'background_color'), 0) < 0.75 THEN
        RAISE EXCEPTION 'Pick a light page background. Text on a dark background is hard to read on this website.';
    END IF;
    IF v_txt->>'logo_url' IS NOT NULL AND (v_txt->>'logo_url' !~ '^https://[^\s<>"]+$' OR length(v_txt->>'logo_url') > 1000) THEN
        RAISE EXCEPTION 'The logo must be an uploaded picture.';
    END IF;

    UPDATE public.businesses SET
        description     = CASE WHEN v_txt ? 'description' THEN v_txt->>'description' ELSE description END,
        logo_url        = CASE WHEN v_txt ? 'logo_url' THEN v_txt->>'logo_url' ELSE logo_url END,
        primary_color   = CASE WHEN v_txt ? 'primary_color' THEN lower(v_txt->>'primary_color') ELSE primary_color END,
        secondary_color = CASE WHEN v_txt ? 'secondary_color' THEN lower(v_txt->>'secondary_color') ELSE secondary_color END
    WHERE id = p_business_id AND deleted_at IS NULL
      AND (v_txt ?| v_biz_keys);

    INSERT INTO public.website_brand (business_id) VALUES (p_business_id) ON CONFLICT (business_id) DO NOTHING;
    UPDATE public.website_brand w SET
        industry        = CASE WHEN v_txt ? 'industry' THEN COALESCE(v_txt->>'industry', 'general_retail') ELSE w.industry END,
        personality     = CASE WHEN v_txt ? 'personality' THEN v_txt->>'personality' ELSE w.personality END,
        tone            = CASE WHEN v_txt ? 'tone' THEN COALESCE(v_txt->>'tone', 'warm') ELSE w.tone END,
        design_preset   = CASE WHEN v_txt ? 'design_preset' THEN v_txt->>'design_preset' ELSE w.design_preset END,
        tagline         = CASE WHEN v_txt ? 'tagline' THEN v_txt->>'tagline' ELSE w.tagline END,
        story           = CASE WHEN v_txt ? 'story' THEN v_txt->>'story' ELSE w.story END,
        mission         = CASE WHEN v_txt ? 'mission' THEN v_txt->>'mission' ELSE w.mission END,
        audience        = CASE WHEN v_txt ? 'audience' THEN v_txt->>'audience' ELSE w.audience END,
        positioning     = CASE WHEN v_txt ? 'positioning' THEN v_txt->>'positioning' ELSE w.positioning END,
        guidelines      = CASE WHEN v_txt ? 'guidelines' THEN v_txt->>'guidelines' ELSE w.guidelines END,
        accent_color    = CASE WHEN v_txt ? 'accent_color' THEN lower(v_txt->>'accent_color') ELSE w.accent_color END,
        background_color= CASE WHEN v_txt ? 'background_color' THEN lower(v_txt->>'background_color') ELSE w.background_color END,
        heading_font    = CASE WHEN v_txt ? 'heading_font' THEN v_txt->>'heading_font' ELSE w.heading_font END,
        body_font       = CASE WHEN v_txt ? 'body_font' THEN v_txt->>'body_font' ELSE w.body_font END,
        heading_weight  = CASE WHEN v_txt ? 'heading_weight' THEN (v_txt->>'heading_weight')::smallint ELSE w.heading_weight END,
        corner_style    = CASE WHEN v_txt ? 'corner_style' THEN v_txt->>'corner_style' ELSE w.corner_style END,
        button_style    = CASE WHEN v_txt ? 'button_style' THEN v_txt->>'button_style' ELSE w.button_style END,
        density         = CASE WHEN v_txt ? 'density' THEN v_txt->>'density' ELSE w.density END,
        image_style     = CASE WHEN v_txt ? 'image_style' THEN v_txt->>'image_style' ELSE w.image_style END,
        image_ratio     = CASE WHEN v_txt ? 'image_ratio' THEN v_txt->>'image_ratio' ELSE w.image_ratio END,
        logo_light_url  = CASE WHEN v_txt ? 'logo_light_url' THEN v_txt->>'logo_light_url' ELSE w.logo_light_url END,
        logo_mark_url   = CASE WHEN v_txt ? 'logo_mark_url' THEN v_txt->>'logo_mark_url' ELSE w.logo_mark_url END,
        favicon_url     = CASE WHEN v_txt ? 'favicon_url' THEN v_txt->>'favicon_url' ELSE w.favicon_url END,
        social_links    = CASE WHEN v_txt ? 'social_links' THEN COALESCE(v_txt->'social_links', '{}'::jsonb) ELSE w.social_links END,
        opening_hours   = CASE WHEN v_txt ? 'opening_hours' THEN COALESCE(v_txt->'opening_hours', '[]'::jsonb) ELSE w.opening_hours END,
        updated_by      = auth.uid()
    WHERE w.business_id = p_business_id
    RETURNING w.* INTO r;
    RETURN to_jsonb(r);
END;
$$;
REVOKE ALL ON FUNCTION public.website_brand_save(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.website_brand_save(uuid, jsonb) TO authenticated, service_role;

-- ============================================================================================
-- 4. The public part of the brand, added to the storefront
-- ============================================================================================
-- Internal notes (audience, positioning, guidelines, tone) never leave the database.
CREATE OR REPLACE FUNCTION public.fn_website_brand_public(p_business_id uuid)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT jsonb_strip_nulls(jsonb_build_object(
        'industry', COALESCE(w.industry, public.fn_guess_industry(b.business_type, b.name)),
        'personality', w.personality,
        'designPreset', w.design_preset,
        'tagline', w.tagline,
        'story', w.story,
        'mission', w.mission,
        'secondaryColor', CASE WHEN b.secondary_color ~* '^#[0-9a-f]{6}$' THEN lower(b.secondary_color) END,
        'accentColor', w.accent_color,
        'backgroundColor', w.background_color,
        'headingFont', w.heading_font,
        'bodyFont', w.body_font,
        'headingWeight', w.heading_weight,
        'cornerStyle', w.corner_style,
        'buttonStyle', w.button_style,
        'density', w.density,
        'imageStyle', w.image_style,
        'imageRatio', w.image_ratio,
        'logoLightUrl', w.logo_light_url,
        'logoMarkUrl', w.logo_mark_url,
        'faviconUrl', w.favicon_url,
        'socialLinks', NULLIF(w.social_links, '{}'::jsonb),
        'openingHours', NULLIF(w.opening_hours, '[]'::jsonb)))
    FROM public.businesses b
    LEFT JOIN public.website_brand w ON w.business_id = b.id
    WHERE b.id = p_business_id;
$$;
REVOKE ALL ON FUNCTION public.fn_website_brand_public(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_website_brand_public(uuid) TO service_role;

-- Same as 20261204004, plus 'brand'.
CREATE OR REPLACE FUNCTION public.get_public_storefront(p_slug text)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_id uuid;
    v_shop jsonb;
    v_data jsonb;
    st public.platform_settings;
BEGIN
    SELECT b.id INTO v_id FROM public.businesses b
    WHERE b.website_slug = lower(trim(p_slug)) AND b.deleted_at IS NULL;
    IF NOT FOUND THEN
        RETURN NULL;
    END IF;
    v_shop := public.fn_website_shop(v_id);
    IF NOT (v_shop->>'open')::boolean THEN
        RETURN NULL;
    END IF;
    v_data := public.fn_public_storefront_data(lower(trim(p_slug)));
    IF v_data IS NULL THEN
        RETURN NULL;
    END IF;
    SELECT * INTO st FROM public.platform_settings WHERE id;
    RETURN v_data || jsonb_build_object(
        'brand', public.fn_website_brand_public(v_id),
        'site', jsonb_build_object(
            'ordersOpen', (v_shop->>'orders_open')::boolean,
            'poweredBy', (v_shop->>'powered_by')::boolean,
            'platformName', st.platform_name,
            'platformUrl', CASE WHEN st.platform_domain IS NOT NULL THEN 'https://' || st.platform_domain END,
            'host', public.fn_website_home_host(v_id)));
END;
$$;
REVOKE ALL ON FUNCTION public.get_public_storefront(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_storefront(text) TO anon, authenticated, service_role;

-- ===================================================================
-- 20261206002_website_drafts_publish
-- ===================================================================
-- 20261206002_website_drafts_publish.sql
-- Website engine, phases 4 and 5: the Website workspace saves into a draft; Publish puts the
-- draft live and keeps a numbered version; any version can be put back (docs/roadmap/website-engine-audit.md).
--
--   * The draft is one document per shop: brand, home page arrangement, banner slides, adverts,
--     pages, menu, search engine text and contact details. Nothing a visitor sees changes until
--     Publish.
--   * The live tables stay the single record of what is published (website_brand, businesses,
--     website_settings), so get_public_storefront, receipts and old readers keep working, and no
--     existing content moves anywhere. The draft starts as a copy of what is live.
--   * Publish and Put back go through fn_website_apply, the only writer of the design columns.
--     Direct writes to those columns are taken away from the app (old app versions get a clear
--     refusal instead of being overwritten by the next publish). Delivery fee, minimum order
--     and the assistant switch stay directly editable: they are shop operations, not design.
--   * A draft is checked when saved, by applying it inside a sub-transaction that is always
--     rolled back, so a draft can never hold something Publish would refuse, and the preview
--     never shows content the live site could not.
--   * Preview: a member who may change the website gets a link that works for two hours. The
--     link's secret is stored only as a SHA-256 hash, names the shop itself and works only on
--     that shop's own address. The tenant always comes from the secret, never from the caller.
--   * Every check is has_permission(business, 'business.update'), the same as the brand.
--
-- Reverse: DROP FUNCTION website_draft_get, website_draft_save, website_draft_discard,
--          website_publish, website_rollback, website_preview_link, get_preview_storefront,
--          website_stats, fn_website_apply, fn_website_live_document, fn_website_brand_shape,
--          fn_valid_home, fn_valid_navigation, fn_valid_seo;
--          DROP TABLE website_preview_links, website_published, website_versions, website_drafts;
--          ALTER TABLE website_settings DROP COLUMN home, navigation, seo;
--          GRANT INSERT, UPDATE, DELETE ON website_settings TO authenticated;
--          GRANT EXECUTE ON FUNCTION website_brand_save(uuid, jsonb) TO authenticated;
--          restore fn_website_brand_public and get_public_storefront from 20261206001.

-- ============================================================================================
-- 1. New design settings: home page arrangement, header menu, search engine text
-- ============================================================================================
-- Section kinds: keep in step with SECTION_KINDS in website/src/engine/layout.ts
-- (src/test/websiteEngineTests.ts compares the two).
CREATE OR REPLACE FUNCTION public.fn_valid_home(p jsonb)
RETURNS boolean
LANGUAGE sql IMMUTABLE
SET search_path = ''
AS $$
    SELECT p IS NULL OR jsonb_typeof(p) = 'null' OR (
        jsonb_typeof(p) = 'array' AND jsonb_array_length(p) <= 24
        AND NOT EXISTS (
            SELECT 1 FROM jsonb_array_elements(p) e
            WHERE jsonb_typeof(e) <> 'object'
               OR NOT (COALESCE(e->>'kind', '') = ANY (ARRAY['hero', 'categories', 'adverts', 'strip', 'strip2',
                      'promotions', 'offers', 'products', 'reviewed', 'aisles', 'story', 'trust', 'testimonials',
                      'recent', 'guides', 'visit', 'contact']))
               OR (e ? 'variant' AND (jsonb_typeof(e->'variant') <> 'string' OR length(e->>'variant') > 20))
               OR (e ? 'title' AND jsonb_typeof(e->'title') <> 'null'
                   AND (jsonb_typeof(e->'title') <> 'string' OR length(e->>'title') > 60))
               OR (e ? 'hidden' AND jsonb_typeof(e->'hidden') <> 'boolean')
               OR EXISTS (SELECT 1 FROM jsonb_object_keys(e) k WHERE k NOT IN ('kind', 'variant', 'title', 'hidden'))));
$$;

-- A menu link goes to a page of this website (/path) or to an https address. Nothing else:
-- no javascript:, no protocol-relative //host, no spaces or quotes.
CREATE OR REPLACE FUNCTION public.fn_valid_link(p text)
RETURNS boolean
LANGUAGE sql IMMUTABLE
SET search_path = ''
AS $$
    SELECT p IS NOT NULL AND length(p) <= 300
       AND (p ~ '^/([A-Za-z0-9_~%+=&?.#-][A-Za-z0-9/_~%+=&?.#-]*)?$' OR p ~ '^https://[A-Za-z0-9.-]+(/[^\s<>"'']*)?$');
$$;

CREATE OR REPLACE FUNCTION public.fn_valid_navigation(p jsonb)
RETURNS boolean
LANGUAGE sql IMMUTABLE
SET search_path = ''
AS $$
    SELECT p IS NULL OR jsonb_typeof(p) = 'null' OR (
        jsonb_typeof(p) = 'object'
        AND NOT EXISTS (SELECT 1 FROM jsonb_object_keys(p) k WHERE k <> 'header')
        AND jsonb_typeof(p->'header') = 'array'
        AND jsonb_array_length(p->'header') <= 8
        AND NOT EXISTS (
            SELECT 1 FROM jsonb_array_elements(p->'header') e
            WHERE jsonb_typeof(e) <> 'object'
               OR jsonb_typeof(e->'label') IS DISTINCT FROM 'string'
               OR length(trim(e->>'label')) NOT BETWEEN 1 AND 30
               OR NOT public.fn_valid_link(e->>'href')
               OR EXISTS (SELECT 1 FROM jsonb_object_keys(e) k WHERE k NOT IN ('label', 'href'))));
$$;

CREATE OR REPLACE FUNCTION public.fn_valid_seo(p jsonb)
RETURNS boolean
LANGUAGE sql IMMUTABLE
SET search_path = ''
AS $$
    SELECT p IS NULL OR jsonb_typeof(p) = 'null' OR (
        jsonb_typeof(p) = 'object'
        AND NOT EXISTS (SELECT 1 FROM jsonb_object_keys(p) k WHERE k NOT IN ('title', 'description', 'shareImage'))
        AND (NOT p ? 'title' OR (jsonb_typeof(p->'title') = 'string' AND length(p->>'title') <= 70))
        AND (NOT p ? 'description' OR (jsonb_typeof(p->'description') = 'string' AND length(p->>'description') <= 170))
        AND (NOT p ? 'shareImage' OR (jsonb_typeof(p->'shareImage') = 'string'
             AND p->>'shareImage' ~ '^https://[^\s<>"]+$' AND length(p->>'shareImage') <= 1000)));
$$;

-- Page text: page ids only, text only.
CREATE OR REPLACE FUNCTION public.fn_valid_pages(p jsonb)
RETURNS boolean
LANGUAGE sql IMMUTABLE
SET search_path = ''
AS $$
    SELECT jsonb_typeof(p) = 'object' AND NOT EXISTS (
        SELECT 1 FROM jsonb_each(p) e
        WHERE e.key !~ '^[a-z0-9-]{1,40}$' OR jsonb_typeof(e.value) <> 'string' OR length(e.value #>> '{}') > 60000);
$$;

GRANT EXECUTE ON FUNCTION public.fn_valid_home(jsonb), public.fn_valid_link(text), public.fn_valid_navigation(jsonb),
    public.fn_valid_seo(jsonb), public.fn_valid_pages(jsonb) TO authenticated, service_role;

ALTER TABLE public.website_settings
    ADD COLUMN IF NOT EXISTS home jsonb,
    ADD COLUMN IF NOT EXISTS navigation jsonb,
    ADD COLUMN IF NOT EXISTS seo jsonb;
ALTER TABLE public.website_settings DROP CONSTRAINT IF EXISTS website_settings_home_check;
ALTER TABLE public.website_settings ADD CONSTRAINT website_settings_home_check CHECK (public.fn_valid_home(home));
ALTER TABLE public.website_settings DROP CONSTRAINT IF EXISTS website_settings_navigation_check;
ALTER TABLE public.website_settings ADD CONSTRAINT website_settings_navigation_check CHECK (public.fn_valid_navigation(navigation));
ALTER TABLE public.website_settings DROP CONSTRAINT IF EXISTS website_settings_seo_check;
ALTER TABLE public.website_settings ADD CONSTRAINT website_settings_seo_check CHECK (public.fn_valid_seo(seo));
-- NOT VALID: shops saved before this rule keep working; every new write is checked.
ALTER TABLE public.website_settings DROP CONSTRAINT IF EXISTS website_settings_page_text_check;
ALTER TABLE public.website_settings ADD CONSTRAINT website_settings_page_text_check CHECK (public.fn_valid_pages(pages)) NOT VALID;

-- Design columns are written only by Publish / Put back. Shop operations stay editable.
-- business_id is in the UPDATE list because an upsert sets every column it sends; the row
-- policy still limits it to shops the user may change.
REVOKE INSERT, UPDATE, DELETE ON public.website_settings FROM authenticated;
GRANT INSERT (business_id, delivery_enabled, delivery_fee, min_order, assistant_enabled) ON public.website_settings TO authenticated;
GRANT UPDATE (business_id, delivery_enabled, delivery_fee, min_order, assistant_enabled) ON public.website_settings TO authenticated;
-- The brand too: it goes live only by publishing.
REVOKE EXECUTE ON FUNCTION public.website_brand_save(uuid, jsonb) FROM authenticated;

-- ============================================================================================
-- 2. Tables: the draft, published versions, the pointer to the live one, preview links
-- ============================================================================================
CREATE TABLE IF NOT EXISTS public.website_drafts (
    business_id uuid PRIMARY KEY REFERENCES public.businesses(id) ON DELETE CASCADE,
    document jsonb NOT NULL CHECK (jsonb_typeof(document) = 'object' AND pg_column_size(document) < 600000),
    -- Goes up by one on every save; a save names the revision it started from, so two people
    -- editing at once cannot silently overwrite each other.
    revision integer NOT NULL DEFAULT 1,
    updated_by uuid,
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.website_versions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    number integer NOT NULL,
    -- 'start' = how the website was before its first publish; 'publish'; 'rollback' = put back.
    kind text NOT NULL CHECK (kind IN ('start', 'publish', 'rollback')),
    note text CHECK (note IS NULL OR length(note) <= 200),
    document jsonb NOT NULL CHECK (jsonb_typeof(document) = 'object'),
    created_by uuid,
    created_by_name text,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (business_id, number)
);
CREATE INDEX IF NOT EXISTS website_versions_business_idx ON public.website_versions (business_id, number DESC);

CREATE TABLE IF NOT EXISTS public.website_published (
    business_id uuid PRIMARY KEY REFERENCES public.businesses(id) ON DELETE CASCADE,
    version_id uuid NOT NULL REFERENCES public.website_versions(id),
    published_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.website_preview_links (
    secret_hash bytea PRIMARY KEY,
    business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    created_by uuid,
    expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS website_preview_links_business_idx ON public.website_preview_links (business_id);

ALTER TABLE public.website_drafts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.website_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.website_published ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.website_preview_links ENABLE ROW LEVEL SECURITY;
-- Reads and writes go through the functions below. Version history is readable by the people
-- who may publish (the history list in the app); nothing is writable directly.
REVOKE ALL ON public.website_drafts, public.website_versions, public.website_published, public.website_preview_links FROM anon, authenticated;
GRANT ALL ON public.website_drafts, public.website_versions, public.website_published, public.website_preview_links TO service_role;
GRANT SELECT (id, business_id, number, kind, note, created_by_name, created_at) ON public.website_versions TO authenticated;
DROP POLICY IF EXISTS pol_website_versions_select ON public.website_versions;
CREATE POLICY pol_website_versions_select ON public.website_versions FOR SELECT TO authenticated
    USING (public.has_permission(business_id, 'business.update'));

-- A shop on a read-only plan changes nothing here either (20261204001 section 6).
DROP TRIGGER IF EXISTS trg_zz_plan_read_only ON public.website_drafts;
CREATE TRIGGER trg_zz_plan_read_only BEFORE INSERT OR UPDATE OR DELETE ON public.website_drafts
    FOR EACH ROW EXECUTE FUNCTION public.fn_block_when_read_only();
DROP TRIGGER IF EXISTS trg_zz_plan_read_only ON public.website_versions;
CREATE TRIGGER trg_zz_plan_read_only BEFORE INSERT OR UPDATE OR DELETE ON public.website_versions
    FOR EACH ROW EXECUTE FUNCTION public.fn_block_when_read_only();
DROP TRIGGER IF EXISTS trg_zz_plan_read_only ON public.website_published;
CREATE TRIGGER trg_zz_plan_read_only BEFORE INSERT OR UPDATE OR DELETE ON public.website_published
    FOR EACH ROW EXECUTE FUNCTION public.fn_block_when_read_only();
DROP TRIGGER IF EXISTS trg_zz_plan_read_only ON public.website_preview_links;
CREATE TRIGGER trg_zz_plan_read_only BEFORE INSERT OR UPDATE OR DELETE ON public.website_preview_links
    FOR EACH ROW EXECUTE FUNCTION public.fn_block_when_read_only();

-- ============================================================================================
-- 3. The website as one document: what is live now, and putting a document live
-- ============================================================================================
-- Every brand key, so a draft and the live website compare field by field.
CREATE OR REPLACE FUNCTION public.fn_website_live_document(p_business_id uuid)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT jsonb_build_object(
        'brand', jsonb_build_object(
                'industry', public.fn_guess_industry(b.business_type, b.name), 'personality', NULL, 'tone', 'warm',
                'design_preset', NULL, 'tagline', NULL, 'story', NULL, 'mission', NULL, 'audience', NULL,
                'positioning', NULL, 'guidelines', NULL, 'accent_color', NULL, 'background_color', NULL,
                'heading_font', NULL, 'body_font', NULL, 'heading_weight', NULL, 'corner_style', NULL,
                'button_style', NULL, 'density', NULL, 'image_style', NULL, 'image_ratio', NULL,
                'logo_light_url', NULL, 'logo_mark_url', NULL, 'favicon_url', NULL,
                'social_links', '{}'::jsonb, 'opening_hours', '[]'::jsonb)
            || COALESCE(to_jsonb(w) - ARRAY['business_id', 'created_at', 'updated_at', 'updated_by'], '{}'::jsonb)
            || jsonb_build_object(
                'description', NULLIF(b.description, ''), 'logo_url', NULLIF(b.logo_url, ''),
                'primary_color', NULLIF(b.primary_color, ''), 'secondary_color', NULLIF(b.secondary_color, '')),
        'home', COALESCE(s.home, 'null'::jsonb),
        'heroSlides', COALESCE(s.hero_slides, '[]'::jsonb),
        'adCards', COALESCE(s.ad_cards, '[]'::jsonb),
        'pages', COALESCE(s.pages, '{}'::jsonb),
        'navigation', COALESCE(s.navigation, 'null'::jsonb),
        'seo', COALESCE(s.seo, 'null'::jsonb),
        'contact', jsonb_build_object('openingHours', NULLIF(trim(s.opening_hours), ''), 'whatsapp', NULLIF(trim(s.whatsapp), '')))
    FROM public.businesses b
    LEFT JOIN public.website_brand w ON w.business_id = b.id
    LEFT JOIN public.website_settings s ON s.business_id = b.id
    WHERE b.id = p_business_id;
$$;
REVOKE ALL ON FUNCTION public.fn_website_live_document(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_website_live_document(uuid) TO service_role;

-- A document as received: only known parts, brand keys only the known ones. Parts not sent
-- are taken from the open draft (p_onto_draft) or else from the live website.
CREATE OR REPLACE FUNCTION public.fn_website_clean_document(p_business_id uuid, p_doc jsonb, p_onto_draft boolean DEFAULT FALSE)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_live jsonb := public.fn_website_live_document(p_business_id);
    v_base jsonb;
    v_key text;
BEGIN
    v_base := CASE WHEN p_onto_draft THEN (SELECT document FROM public.website_drafts WHERE business_id = p_business_id) END;
    -- A draft saved before a new part existed gets that part from the live website.
    v_base := v_live || COALESCE(v_base, '{}'::jsonb);
    IF jsonb_typeof(COALESCE(p_doc, 'null'::jsonb)) <> 'object' THEN
        RAISE EXCEPTION 'Nothing to save.';
    END IF;
    FOR v_key IN SELECT jsonb_object_keys(p_doc) LOOP
        IF NOT v_live ? v_key THEN
            RAISE EXCEPTION 'Unknown website part: %', v_key;
        END IF;
    END LOOP;
    IF p_doc ? 'brand' THEN
        IF jsonb_typeof(p_doc->'brand') <> 'object' THEN
            RAISE EXCEPTION 'The brand must be a set of fields.';
        END IF;
        FOR v_key IN SELECT jsonb_object_keys(p_doc->'brand') LOOP
            IF NOT (v_live->'brand') ? v_key THEN
                RAISE EXCEPTION 'Unknown brand setting: %', v_key;
            END IF;
        END LOOP;
        p_doc := jsonb_set(p_doc, '{brand}', (v_live->'brand') || (v_base->'brand') || (p_doc->'brand'));
    END IF;
    IF p_doc ? 'contact' THEN
        IF jsonb_typeof(p_doc->'contact') <> 'object'
           OR EXISTS (SELECT 1 FROM jsonb_object_keys(p_doc->'contact') k WHERE k NOT IN ('openingHours', 'whatsapp')) THEN
            RAISE EXCEPTION 'Contact details hold opening hours and a WhatsApp number only.';
        END IF;
        p_doc := jsonb_set(p_doc, '{contact}', (v_live->'contact') || (v_base->'contact') || (p_doc->'contact'));
    END IF;
    RETURN v_base || p_doc;
END;
$$;
DROP FUNCTION IF EXISTS public.fn_website_clean_document(uuid, jsonb);
REVOKE ALL ON FUNCTION public.fn_website_clean_document(uuid, jsonb, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_website_clean_document(uuid, jsonb, boolean) TO service_role;

-- Puts a whole document live. The only writer of the design columns. Every value is checked by
-- website_brand_save and the table checks; anything wrong stops the whole change.
CREATE OR REPLACE FUNCTION public.fn_website_apply(p_business_id uuid, p_doc jsonb)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_slides jsonb := COALESCE(NULLIF(p_doc->'heroSlides', 'null'::jsonb), '[]'::jsonb);
    v_cards jsonb := COALESCE(NULLIF(p_doc->'adCards', 'null'::jsonb), '[]'::jsonb);
    v_pages jsonb := COALESCE(NULLIF(p_doc->'pages', 'null'::jsonb), '{}'::jsonb);
BEGIN
    IF NOT public.has_permission(p_business_id, 'business.update') THEN
        RAISE EXCEPTION 'You do not have permission to change the website.';
    END IF;
    -- Clear messages for what the table checks would otherwise refuse with a constraint name.
    IF NOT public.fn_valid_home(p_doc->'home') THEN
        RAISE EXCEPTION 'The home page arrangement has a section the website does not know.';
    END IF;
    IF NOT public.fn_valid_navigation(p_doc->'navigation') THEN
        RAISE EXCEPTION 'A menu link is not allowed. Links go to a page of this website (starting with /) or a secure web address (https), with a name of up to 30 letters, and at most 8 links.';
    END IF;
    IF NOT public.fn_valid_seo(p_doc->'seo') THEN
        RAISE EXCEPTION 'Search engine text is too long: up to 70 letters for the title and 170 for the description. The sharing picture must be uploaded.';
    END IF;
    IF NOT public.fn_valid_pages(v_pages) THEN
        RAISE EXCEPTION 'A page has text the website cannot show.';
    END IF;

    PERFORM public.website_brand_save(p_business_id, p_doc->'brand');

    INSERT INTO public.website_settings (business_id) VALUES (p_business_id) ON CONFLICT (business_id) DO NOTHING;
    UPDATE public.website_settings SET
        hero_slides   = v_slides,
        ad_cards      = v_cards,
        pages         = v_pages,
        home          = NULLIF(p_doc->'home', 'null'::jsonb),
        navigation    = NULLIF(p_doc->'navigation', 'null'::jsonb),
        seo           = NULLIF(p_doc->'seo', 'null'::jsonb),
        opening_hours = NULLIF(trim(p_doc#>>'{contact,openingHours}'), ''),
        whatsapp      = NULLIF(trim(p_doc#>>'{contact,whatsapp}'), '')
    WHERE business_id = p_business_id;
END;
$$;
REVOKE ALL ON FUNCTION public.fn_website_apply(uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_website_apply(uuid, jsonb) TO service_role;

-- Checks a document by putting it live inside a sub-transaction that is always undone.
-- Returns NULL when the document is fine, else the reason it would be refused.
CREATE OR REPLACE FUNCTION public.fn_website_check_document(p_business_id uuid, p_doc jsonb)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    BEGIN
        PERFORM public.fn_website_apply(p_business_id, p_doc);
        RAISE EXCEPTION USING ERRCODE = 'P0901', MESSAGE = 'website-check-ok';
    EXCEPTION
        WHEN SQLSTATE 'P0901' THEN
            RETURN NULL;
        WHEN check_violation THEN
            RETURN CASE
                WHEN SQLERRM LIKE '%hero_slides%' THEN 'A banner slide has a value the website cannot show. Check its link and picture.'
                WHEN SQLERRM LIKE '%ad_cards%' THEN 'An advert has a value the website cannot show. Check its link and picture.'
                WHEN SQLERRM LIKE '%hours%' THEN 'The WhatsApp number may hold digits, spaces and a leading + only, and opening hours up to 500 letters.'
                WHEN SQLERRM LIKE '%font%' THEN 'That font is not on the website''s list of fonts.'
                ELSE 'A website setting has a value that is not allowed. Check the colours, fonts and pictures.' END;
        WHEN OTHERS THEN
            RETURN SQLERRM;
    END;
END;
$$;
REVOKE ALL ON FUNCTION public.fn_website_check_document(uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_website_check_document(uuid, jsonb) TO service_role;

-- ============================================================================================
-- 4. The draft: read, save, discard
-- ============================================================================================
CREATE OR REPLACE FUNCTION public.fn_website_published_info(p_business_id uuid)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT jsonb_build_object('number', v.number, 'at', p.published_at, 'by', v.created_by_name, 'kind', v.kind)
    FROM public.website_published p
    JOIN public.website_versions v ON v.id = p.version_id
    WHERE p.business_id = p_business_id;
$$;
REVOKE ALL ON FUNCTION public.fn_website_published_info(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_website_published_info(uuid) TO service_role;

-- The draft (or, when there is none, what is live), whether it differs from the live website,
-- and the published version.
CREATE OR REPLACE FUNCTION public.website_draft_get(p_business_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_live jsonb;
    d public.website_drafts;
BEGIN
    IF NOT public.has_permission(p_business_id, 'business.update') THEN
        RAISE EXCEPTION 'You do not have permission to change the website.';
    END IF;
    v_live := public.fn_website_live_document(p_business_id);
    IF v_live IS NULL THEN
        RAISE EXCEPTION 'Shop not found.';
    END IF;
    SELECT * INTO d FROM public.website_drafts WHERE business_id = p_business_id;
    RETURN jsonb_build_object(
        'document', COALESCE(d.document, v_live),
        'revision', COALESCE(d.revision, 0),
        'changed', d.document IS NOT NULL AND d.document IS DISTINCT FROM v_live,
        'savedAt', d.updated_at,
        'savedBy', (SELECT u.name FROM public.users u WHERE u.auth_user_id = d.updated_by LIMIT 1),
        'published', public.fn_website_published_info(p_business_id));
END;
$$;
REVOKE ALL ON FUNCTION public.website_draft_get(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.website_draft_get(uuid) TO authenticated, service_role;

-- Saves the draft. p_base_revision is the revision the editor loaded; if someone saved since,
-- nothing is saved and the caller is told to reload. Returns the new revision.
CREATE OR REPLACE FUNCTION public.website_draft_save(p_business_id uuid, p_document jsonb, p_base_revision integer)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_doc jsonb;
    v_current integer;
    v_problem text;
BEGIN
    IF NOT public.has_permission(p_business_id, 'business.update') THEN
        RAISE EXCEPTION 'You do not have permission to change the website.';
    END IF;
    IF pg_column_size(p_document) > 600000 THEN
        RAISE EXCEPTION 'The website is too large to save. Remove some pictures or page text.';
    END IF;
    -- One save at a time per shop.
    PERFORM pg_advisory_xact_lock(hashtextextended('website:' || p_business_id::text, 0));
    SELECT revision INTO v_current FROM public.website_drafts WHERE business_id = p_business_id;
    IF COALESCE(v_current, 0) <> COALESCE(p_base_revision, -1) THEN
        RAISE EXCEPTION 'Someone else saved the website since you opened it. Reload to see their changes, then make yours again.';
    END IF;
    v_doc := public.fn_website_clean_document(p_business_id, p_document, TRUE);
    v_problem := public.fn_website_check_document(p_business_id, v_doc);
    IF v_problem IS NOT NULL THEN
        RAISE EXCEPTION '%', v_problem;
    END IF;
    INSERT INTO public.website_drafts AS d (business_id, document, revision, updated_by, updated_at)
    VALUES (p_business_id, v_doc, 1, auth.uid(), now())
    ON CONFLICT (business_id) DO UPDATE
        SET document = EXCLUDED.document, revision = d.revision + 1, updated_by = auth.uid(), updated_at = now();
    RETURN jsonb_build_object(
        'revision', (SELECT revision FROM public.website_drafts WHERE business_id = p_business_id),
        'changed', v_doc IS DISTINCT FROM public.fn_website_live_document(p_business_id));
END;
$$;
REVOKE ALL ON FUNCTION public.website_draft_save(uuid, jsonb, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.website_draft_save(uuid, jsonb, integer) TO authenticated, service_role;

-- Throws the draft away: the editor shows the live website again.
CREATE OR REPLACE FUNCTION public.website_draft_discard(p_business_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF NOT public.has_permission(p_business_id, 'business.update') THEN
        RAISE EXCEPTION 'You do not have permission to change the website.';
    END IF;
    DELETE FROM public.website_drafts WHERE business_id = p_business_id;
END;
$$;
REVOKE ALL ON FUNCTION public.website_draft_discard(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.website_draft_discard(uuid) TO authenticated, service_role;

-- ============================================================================================
-- 5. Publish and put back
-- ============================================================================================
CREATE OR REPLACE FUNCTION public.fn_website_record_version(p_business_id uuid, p_kind text, p_note text)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_number integer;
    v_id uuid;
BEGIN
    SELECT COALESCE(max(number), 0) + 1 INTO v_number FROM public.website_versions WHERE business_id = p_business_id;
    INSERT INTO public.website_versions (business_id, number, kind, note, document, created_by, created_by_name)
    VALUES (p_business_id, v_number, p_kind, NULLIF(left(trim(COALESCE(p_note, '')), 200), ''),
            public.fn_website_live_document(p_business_id), auth.uid(),
            (SELECT u.name FROM public.users u WHERE u.auth_user_id = auth.uid() LIMIT 1))
    RETURNING id INTO v_id;
    INSERT INTO public.website_published (business_id, version_id, published_at) VALUES (p_business_id, v_id, now())
    ON CONFLICT (business_id) DO UPDATE SET version_id = EXCLUDED.version_id, published_at = now();
    RETURN v_number;
END;
$$;
REVOKE ALL ON FUNCTION public.fn_website_record_version(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_website_record_version(uuid, text, text) TO service_role;

-- Puts the draft live. The first publish also keeps how the website was before, as version 1,
-- so even the very first change can be undone. Returns the new version number.
CREATE OR REPLACE FUNCTION public.website_publish(p_business_id uuid, p_base_revision integer, p_note text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    d public.website_drafts;
    v_number integer;
BEGIN
    IF NOT public.has_permission(p_business_id, 'business.update') THEN
        RAISE EXCEPTION 'You do not have permission to publish the website.';
    END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended('website:' || p_business_id::text, 0));
    SELECT * INTO d FROM public.website_drafts WHERE business_id = p_business_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'There are no changes to publish.';
    END IF;
    IF d.revision <> COALESCE(p_base_revision, -1) THEN
        RAISE EXCEPTION 'Someone else saved the website since you opened it. Reload to see their changes before publishing.';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.website_versions WHERE business_id = p_business_id) THEN
        PERFORM public.fn_website_record_version(p_business_id, 'start', 'How the website was before the first publish');
    END IF;
    PERFORM public.fn_website_apply(p_business_id, d.document);
    v_number := public.fn_website_record_version(p_business_id, 'publish', p_note);
    DELETE FROM public.website_drafts WHERE business_id = p_business_id;
    RETURN jsonb_build_object('number', v_number);
END;
$$;
REVOKE ALL ON FUNCTION public.website_publish(uuid, integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.website_publish(uuid, integer, text) TO authenticated, service_role;

-- Puts an older version live again, as a new version (history is never rewritten). An open
-- draft is thrown away, because it was based on what is being replaced.
CREATE OR REPLACE FUNCTION public.website_rollback(p_business_id uuid, p_version_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v public.website_versions;
    v_number integer;
BEGIN
    IF NOT public.has_permission(p_business_id, 'business.update') THEN
        RAISE EXCEPTION 'You do not have permission to publish the website.';
    END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended('website:' || p_business_id::text, 0));
    -- The version must belong to this shop: the shop comes from the caller's permission check
    -- above, and the version is looked up within it.
    SELECT * INTO v FROM public.website_versions WHERE id = p_version_id AND business_id = p_business_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'That version was not found.';
    END IF;
    PERFORM public.fn_website_apply(p_business_id, public.fn_website_clean_document(p_business_id, v.document));
    v_number := public.fn_website_record_version(p_business_id, 'rollback', 'Put back version ' || v.number);
    DELETE FROM public.website_drafts WHERE business_id = p_business_id;
    RETURN jsonb_build_object('number', v_number);
END;
$$;
REVOKE ALL ON FUNCTION public.website_rollback(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.website_rollback(uuid, uuid) TO authenticated, service_role;

-- ============================================================================================
-- 6. The storefront: public (live) and preview (draft)
-- ============================================================================================
-- The public brand from a brand document (live or draft). Internal notes never leave.
CREATE OR REPLACE FUNCTION public.fn_website_brand_shape(p jsonb)
RETURNS jsonb
LANGUAGE sql IMMUTABLE
SET search_path = ''
AS $$
    SELECT jsonb_strip_nulls(jsonb_build_object(
        'industry', p->>'industry',
        'personality', p->>'personality',
        'designPreset', p->>'design_preset',
        'tagline', p->>'tagline',
        'story', p->>'story',
        'mission', p->>'mission',
        'secondaryColor', CASE WHEN p->>'secondary_color' ~* '^#[0-9a-f]{6}$' THEN lower(p->>'secondary_color') END,
        'accentColor', p->>'accent_color',
        'backgroundColor', p->>'background_color',
        'headingFont', p->>'heading_font',
        'bodyFont', p->>'body_font',
        'headingWeight', p->'heading_weight',
        'cornerStyle', p->>'corner_style',
        'buttonStyle', p->>'button_style',
        'density', p->>'density',
        'imageStyle', p->>'image_style',
        'imageRatio', p->>'image_ratio',
        'logoLightUrl', p->>'logo_light_url',
        'logoMarkUrl', p->>'logo_mark_url',
        'faviconUrl', p->>'favicon_url',
        'socialLinks', NULLIF(p->'social_links', '{}'::jsonb),
        'openingHours', NULLIF(p->'opening_hours', '[]'::jsonb)));
$$;
GRANT EXECUTE ON FUNCTION public.fn_website_brand_shape(jsonb) TO service_role;

-- Same as 20261206001, now built from the live document so live and preview share one shape.
CREATE OR REPLACE FUNCTION public.fn_website_brand_public(p_business_id uuid)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT public.fn_website_brand_shape(public.fn_website_live_document(p_business_id)->'brand');
$$;
REVOKE ALL ON FUNCTION public.fn_website_brand_public(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_website_brand_public(uuid) TO service_role;

-- Same as 20261206001, plus 'home', 'navigation' and 'seo'.
CREATE OR REPLACE FUNCTION public.get_public_storefront(p_slug text)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_id uuid;
    v_shop jsonb;
    v_data jsonb;
    s public.website_settings;
    st public.platform_settings;
BEGIN
    SELECT b.id INTO v_id FROM public.businesses b
    WHERE b.website_slug = lower(trim(p_slug)) AND b.deleted_at IS NULL;
    IF NOT FOUND THEN
        RETURN NULL;
    END IF;
    v_shop := public.fn_website_shop(v_id);
    IF NOT (v_shop->>'open')::boolean THEN
        RETURN NULL;
    END IF;
    v_data := public.fn_public_storefront_data(lower(trim(p_slug)));
    IF v_data IS NULL THEN
        RETURN NULL;
    END IF;
    SELECT * INTO s FROM public.website_settings WHERE business_id = v_id;
    SELECT * INTO st FROM public.platform_settings WHERE id;
    RETURN v_data || jsonb_strip_nulls(jsonb_build_object(
        'home', s.home,
        'navigation', s.navigation,
        'seo', s.seo)) || jsonb_build_object(
        'brand', public.fn_website_brand_public(v_id),
        'site', jsonb_build_object(
            'ordersOpen', (v_shop->>'orders_open')::boolean,
            'poweredBy', (v_shop->>'powered_by')::boolean,
            'platformName', st.platform_name,
            'platformUrl', CASE WHEN st.platform_domain IS NOT NULL THEN 'https://' || st.platform_domain END,
            'host', public.fn_website_home_host(v_id)));
END;
$$;
REVOKE ALL ON FUNCTION public.get_public_storefront(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_storefront(text) TO anon, authenticated, service_role;

-- A preview link for the draft, valid two hours. Returns the secret once; only its hash is kept.
CREATE OR REPLACE FUNCTION public.website_preview_link(p_business_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_secret text := encode(extensions.gen_random_bytes(24), 'hex');
    v_expires timestamptz := now() + interval '2 hours';
BEGIN
    IF NOT public.has_permission(p_business_id, 'business.update') THEN
        RAISE EXCEPTION 'You do not have permission to change the website.';
    END IF;
    IF (SELECT website_slug FROM public.businesses WHERE id = p_business_id) IS NULL THEN
        RAISE EXCEPTION 'Choose a web address for the shop first (Domains and publishing).';
    END IF;
    -- Only this shop's rows: another shop's rows may be locked by a read-only plan.
    DELETE FROM public.website_preview_links WHERE business_id = p_business_id AND expires_at < now();
    -- At most 20 open links per shop: the oldest go.
    DELETE FROM public.website_preview_links WHERE secret_hash IN (
        SELECT secret_hash FROM public.website_preview_links WHERE business_id = p_business_id
        ORDER BY expires_at DESC OFFSET 19);
    INSERT INTO public.website_preview_links (secret_hash, business_id, created_by, expires_at)
    VALUES (extensions.digest(v_secret, 'sha256'), p_business_id, auth.uid(), v_expires);
    RETURN jsonb_build_object(
        'secret', v_secret,
        'expiresAt', v_expires,
        'slug', (SELECT website_slug FROM public.businesses WHERE id = p_business_id),
        'host', public.fn_website_home_host(p_business_id));
END;
$$;
REVOKE ALL ON FUNCTION public.website_preview_link(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.website_preview_link(uuid) TO authenticated, service_role;

-- The storefront with the draft in place of the live design, for a valid preview secret on the
-- shop's own address (p_slug). Works before the shop is open online, so it can be prepared.
-- Products, prices, stock and reviews are the live ones: only the design is drafted.
CREATE OR REPLACE FUNCTION public.get_preview_storefront(p_slug text, p_secret text)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_id uuid;
    v_doc jsonb;
    v_data jsonb;
    v_shop jsonb;
    st public.platform_settings;
BEGIN
    IF p_secret IS NULL OR p_secret !~ '^[0-9a-f]{48}$' THEN
        RETURN NULL;
    END IF;
    SELECT l.business_id INTO v_id
    FROM public.website_preview_links l
    JOIN public.businesses b ON b.id = l.business_id
    WHERE l.secret_hash = extensions.digest(p_secret, 'sha256')
      AND l.expires_at > now()
      AND b.deleted_at IS NULL
      AND b.website_slug = lower(trim(p_slug));
    IF NOT FOUND THEN
        RETURN NULL;
    END IF;
    v_data := public.fn_public_storefront_data(lower(trim(p_slug)));
    IF v_data IS NULL THEN
        RETURN NULL;
    END IF;
    v_doc := COALESCE((SELECT document FROM public.website_drafts WHERE business_id = v_id),
                      public.fn_website_live_document(v_id));
    v_shop := public.fn_website_shop(v_id);
    SELECT * INTO st FROM public.platform_settings WHERE id;
    RETURN v_data || jsonb_build_object(
        'business', (v_data->'business') || jsonb_build_object(
            'description', v_doc#>>'{brand,description}',
            'logoUrl', v_doc#>>'{brand,logo_url}',
            'primaryColor', v_doc#>>'{brand,primary_color}'),
        'settings', (v_data->'settings') || jsonb_build_object(
            'openingHours', v_doc#>>'{contact,openingHours}',
            'whatsapp', v_doc#>>'{contact,whatsapp}'),
        'pages', v_doc->'pages',
        'heroSlides', COALESCE((SELECT jsonb_agg(x) FROM jsonb_array_elements(v_doc->'heroSlides') x
                                WHERE COALESCE((x->>'hidden')::boolean, FALSE) IS FALSE), '[]'::jsonb),
        'adCards', COALESCE((SELECT jsonb_agg(x) FROM jsonb_array_elements(v_doc->'adCards') x
                             WHERE COALESCE((x->>'hidden')::boolean, FALSE) IS FALSE), '[]'::jsonb),
        'brand', public.fn_website_brand_shape(v_doc->'brand'),
        'site', jsonb_build_object(
            'ordersOpen', FALSE,
            'poweredBy', (v_shop->>'powered_by')::boolean,
            'platformName', st.platform_name,
            'platformUrl', CASE WHEN st.platform_domain IS NOT NULL THEN 'https://' || st.platform_domain END,
            'host', public.fn_website_home_host(v_id),
            'preview', TRUE))
        || jsonb_strip_nulls(jsonb_build_object(
            'home', NULLIF(v_doc->'home', 'null'::jsonb),
            'navigation', NULLIF(v_doc->'navigation', 'null'::jsonb),
            'seo', NULLIF(v_doc->'seo', 'null'::jsonb)));
END;
$$;
REVOKE ALL ON FUNCTION public.get_preview_storefront(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_preview_storefront(text, text) TO anon, authenticated, service_role;

-- ============================================================================================
-- 7. Statistics from real records only: website orders. Visits are not counted yet.
-- ============================================================================================
CREATE OR REPLACE FUNCTION public.website_stats(p_business_id uuid, p_days integer DEFAULT 30)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_days integer := LEAST(GREATEST(COALESCE(p_days, 30), 1), 365);
    v_from timestamptz;
BEGIN
    IF NOT public.has_permission(p_business_id, 'business.update') THEN
        RAISE EXCEPTION 'You do not have permission to see website statistics.';
    END IF;
    v_from := date_trunc('day', now()) - make_interval(days => v_days - 1);
    RETURN jsonb_build_object(
        'days', v_days,
        'orders', (SELECT count(*) FROM public.online_orders WHERE business_id = p_business_id AND created_at >= v_from),
        'paidOrders', (SELECT count(*) FROM public.online_orders WHERE business_id = p_business_id AND created_at >= v_from AND paid_at IS NOT NULL),
        'revenue', (SELECT COALESCE(sum(total), 0)::numeric(14,2) FROM public.online_orders WHERE business_id = p_business_id AND created_at >= v_from AND paid_at IS NOT NULL),
        'byDay', COALESCE((
            SELECT jsonb_agg(jsonb_build_object('day', d.day, 'orders', d.orders, 'revenue', d.revenue) ORDER BY d.day)
            FROM (
                SELECT g.day::date AS day,
                       count(o.id) AS orders,
                       COALESCE(sum(o.total) FILTER (WHERE o.paid_at IS NOT NULL), 0)::numeric(14,2) AS revenue
                FROM generate_series(v_from, date_trunc('day', now()), interval '1 day') g(day)
                LEFT JOIN public.online_orders o
                    ON o.business_id = p_business_id AND o.created_at >= g.day AND o.created_at < g.day + interval '1 day'
                GROUP BY g.day) d), '[]'::jsonb),
        'topProducts', COALESCE((
            SELECT jsonb_agg(jsonb_build_object('name', t.name, 'quantity', t.quantity) ORDER BY t.quantity DESC, t.name)
            FROM (
                SELECT i.product_name AS name, round(sum(i.quantity), 1) AS quantity
                FROM public.online_order_items i
                JOIN public.online_orders o ON o.id = i.order_id
                WHERE o.business_id = p_business_id AND o.created_at >= v_from AND o.paid_at IS NOT NULL
                GROUP BY i.product_name
                ORDER BY sum(i.quantity) DESC, i.product_name
                LIMIT 5) t), '[]'::jsonb),
        'visitsCounted', FALSE);
END;
$$;
REVOKE ALL ON FUNCTION public.website_stats(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.website_stats(uuid, integer) TO authenticated, service_role;

-- ===================================================================
-- 20261207001_marketing_campaigns
-- ===================================================================
-- 20261207001_marketing_campaigns.sql
-- Marketing & advertising: campaigns, their creatives, website placements, a shared media
-- library (pictures and videos), scheduling in the shop's own time zone, publication history and
-- real advert statistics (loaded / seen / clicked / order placed). Plan: docs/MARKETING_AND_ADVERTISING.md.
--
--   * A campaign holds the schedule, status, priority and call to action. Its creatives (one per
--     placement: home banner, announcement bar, cards, product promotion, video, pop-up, category
--     banner, campaign page) share that schedule and status.
--   * Whether a campaign is showing is worked out from the clock every time it is read
--     (fn_mkt_status): never before its start, never after its end, with no job that has to run
--     on time. A job every 5 minutes only writes "started"/"ended" into the history.
--   * Visitors read adverts only through get_public_campaigns(slug); the shop comes from the
--     address, never from the caller. Drafts, paused, ended and archived campaigns are never in it.
--   * Every change goes through the functions below (has_permission marketing.manage); members with
--     marketing.view may read. Pictures and videos live in the public bucket website-media under
--     the shop's own folder and are registered in website_media, which checks the stored file's
--     real size and type.
--   * Statistics: "loaded" (on the page), "seen" (half visible for a second), "clicked", and
--     "order" (an online order placed by the signed-in customer who clicked, within 24 hours).
--     Each is counted once per visit, creative and day. A visit is a random id kept in the
--     browser tab; nothing personal is stored.
--   * Order values in the reports are read from online_orders at report time, never copied.
--
-- Reverse: SELECT cron.unschedule('marketing-jobs'); DROP FUNCTION <every function below>;
--          DROP TABLE marketing_conversions, marketing_ad_seen, marketing_ad_daily,
--          marketing_preview_links, marketing_campaign_events, marketing_creatives, marketing_placements, marketing_campaigns,
--          website_media, canva_oauth_states, canva_connections;
--          ALTER TABLE businesses DROP COLUMN timezone; DELETE FROM storage.buckets WHERE id = 'website-media';
--          DELETE FROM module_permissions WHERE pattern = 'marketing.%'; restore Manager defaults from 20261126002.

-- ============================================================================================
-- 1. The shop's time zone (schedules are typed in it)
-- ============================================================================================
ALTER TABLE public.businesses ADD COLUMN IF NOT EXISTS timezone text NOT NULL DEFAULT 'Africa/Nairobi';

CREATE OR REPLACE FUNCTION public.fn_valid_timezone(p text)
RETURNS boolean
LANGUAGE sql STABLE
SET search_path = ''
AS $$
    SELECT p IS NOT NULL AND EXISTS (SELECT 1 FROM pg_catalog.pg_timezone_names WHERE name = p);
$$;

CREATE OR REPLACE FUNCTION public.fn_business_timezone_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
    IF NOT public.fn_valid_timezone(NEW.timezone) THEN
        RAISE EXCEPTION 'Unknown time zone %', NEW.timezone USING ERRCODE = '22023';
    END IF;
    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_business_timezone_guard ON public.businesses;
CREATE TRIGGER trg_business_timezone_guard BEFORE INSERT OR UPDATE OF timezone ON public.businesses
    FOR EACH ROW EXECUTE FUNCTION public.fn_business_timezone_guard();

CREATE OR REPLACE FUNCTION public.business_set_timezone(p_business_id uuid, p_timezone text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    PERFORM public.assert_permission(p_business_id, 'business.update', 'marketing.manage');
    IF NOT public.fn_valid_timezone(p_timezone) THEN
        RAISE EXCEPTION 'Unknown time zone %', p_timezone USING ERRCODE = '22023';
    END IF;
    UPDATE public.businesses SET timezone = p_timezone WHERE id = p_business_id;
END;
$$;

-- ============================================================================================
-- 2. Media library (pictures, videos, captions) shared by adverts and the website
-- ============================================================================================
CREATE TABLE IF NOT EXISTS public.website_media (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    kind text NOT NULL CHECK (kind IN ('image', 'video', 'captions')),
    path text NOT NULL CHECK (length(path) <= 300),
    url text NOT NULL CHECK (url ~ '^https?://' AND length(url) <= 600),
    mime_type text NOT NULL,
    bytes bigint NOT NULL CHECK (bytes > 0),
    width integer CHECK (width BETWEEN 1 AND 8000),
    height integer CHECK (height BETWEEN 1 AND 8000),
    duration_ms integer CHECK (duration_ms BETWEEN 0 AND 600000),
    title text CHECK (length(title) <= 120),
    alt_text text CHECK (length(alt_text) <= 250),
    folder text CHECK (length(folder) <= 60),
    focal_x numeric(5,2) NOT NULL DEFAULT 50 CHECK (focal_x BETWEEN 0 AND 100),
    focal_y numeric(5,2) NOT NULL DEFAULT 50 CHECK (focal_y BETWEEN 0 AND 100),
    source text NOT NULL DEFAULT 'upload' CHECK (source IN ('upload', 'canva')),
    canva_design_id text CHECK (length(canva_design_id) <= 64),
    created_by uuid,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    deleted_at timestamptz,
    UNIQUE (path),
    CHECK (kind <> 'image' OR (width IS NOT NULL AND height IS NOT NULL)),
    CHECK (kind <> 'video' OR (width IS NOT NULL AND height IS NOT NULL AND duration_ms IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS idx_website_media_business ON public.website_media (business_id, created_at DESC) WHERE deleted_at IS NULL;

-- Files: public bucket (adverts are public), writes only into a shop's own folder by people who
-- may manage marketing or the website. Size and type limits are also enforced by the bucket.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types) VALUES
    ('website-media', 'website-media', true, 52428800,
     '{image/jpeg,image/png,image/webp,image/avif,image/gif,video/mp4,video/webm,text/vtt}')
ON CONFLICT (id) DO UPDATE SET public = EXCLUDED.public, file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "website-media upload" ON storage.objects;
CREATE POLICY "website-media upload" ON storage.objects AS PERMISSIVE FOR INSERT TO authenticated
    WITH CHECK (bucket_id = 'website-media'
        AND public.fn_storage_folder_permission(split_part(name, '/', 1), VARIADIC ARRAY['marketing.manage', 'business.update']));
DROP POLICY IF EXISTS "website-media delete" ON storage.objects;
CREATE POLICY "website-media delete" ON storage.objects AS PERMISSIVE FOR DELETE TO authenticated
    USING (bucket_id = 'website-media'
        AND public.fn_storage_folder_permission(split_part(name, '/', 1), VARIADIC ARRAY['marketing.manage', 'business.update']));
DROP POLICY IF EXISTS "website-media read" ON storage.objects;
CREATE POLICY "website-media read" ON storage.objects AS PERMISSIVE FOR SELECT TO anon, authenticated
    USING (bucket_id = 'website-media');

-- ============================================================================================
-- 3. Campaigns, creatives, placements, history
-- ============================================================================================
CREATE TABLE IF NOT EXISTS public.marketing_campaigns (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 80),
    description text CHECK (length(description) <= 500),
    campaign_type text NOT NULL DEFAULT 'other' CHECK (campaign_type IN ('seasonal', 'discount', 'flash_sale',
        'brand_awareness', 'black_friday', 'christmas', 'new_product', 'clearance', 'event', 'other')),
    objective text NOT NULL DEFAULT 'sales' CHECK (objective IN ('awareness', 'traffic', 'sales', 'product_launch', 'engagement', 'store_visits')),
    -- What staff decided. What visitors see also depends on the clock: fn_mkt_status.
    state text NOT NULL DEFAULT 'draft' CHECK (state IN ('draft', 'live', 'paused', 'ended', 'archived')),
    starts_at timestamptz NOT NULL,
    ends_at timestamptz,
    priority integer NOT NULL DEFAULT 50 CHECK (priority BETWEEN 1 AND 100),
    cta_label text CHECK (length(cta_label) <= 30),
    cta_kind text NOT NULL DEFAULT 'none' CHECK (cta_kind IN ('none', 'link', 'product', 'category', 'landing', 'promo_code', 'whatsapp')),
    cta_target text CHECK (length(cta_target) <= 300),
    discount_label text CHECK (length(discount_label) <= 40),
    promotion_id uuid REFERENCES public.website_promo_codes(id) ON DELETE SET NULL,
    target_product_ids uuid[] NOT NULL DEFAULT '{}' CHECK (cardinality(target_product_ids) <= 24),
    target_category text CHECK (length(target_category) <= 80),
    landing_slug text CHECK (landing_slug ~ '^[a-z0-9]([a-z0-9-]{0,48}[a-z0-9])?$'),
    tone text NOT NULL DEFAULT 'brand' CHECK (tone IN ('brand', 'dark', 'light')),
    revision integer NOT NULL DEFAULT 1,
    started_logged_at timestamptz,
    ended_logged_at timestamptz,
    published_at timestamptz,
    created_by uuid,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CHECK (ends_at IS NULL OR ends_at > starts_at),
    UNIQUE (business_id, landing_slug)
);
CREATE INDEX IF NOT EXISTS idx_marketing_campaigns_live ON public.marketing_campaigns (business_id, starts_at, ends_at) WHERE state = 'live';
CREATE INDEX IF NOT EXISTS idx_marketing_campaigns_business ON public.marketing_campaigns (business_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS public.marketing_creatives (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id uuid NOT NULL REFERENCES public.marketing_campaigns(id) ON DELETE CASCADE,
    business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    placement text NOT NULL CHECK (placement IN ('hero', 'announcement', 'card', 'product', 'video', 'popup', 'category', 'landing')),
    format text NOT NULL CHECK (format IN ('hero_16x9', 'wide_3x1', 'card_4x5', 'square_1x1', 'story_9x16', 'video_16x9', 'video_9x16', 'text')),
    media_id uuid REFERENCES public.website_media(id),
    mobile_media_id uuid REFERENCES public.website_media(id),
    poster_media_id uuid REFERENCES public.website_media(id),
    captions_media_id uuid REFERENCES public.website_media(id),
    headline text CHECK (length(headline) <= 90),
    body text CHECK (length(body) <= 200),
    cta_label text CHECK (length(cta_label) <= 30),
    alt_text text CHECK (length(alt_text) <= 250),
    focal_x numeric(5,2) CHECK (focal_x BETWEEN 0 AND 100),
    focal_y numeric(5,2) CHECK (focal_y BETWEEN 0 AND 100),
    text_position text NOT NULL DEFAULT 'left' CHECK (text_position IN ('left', 'center', 'right', 'none')),
    autoplay_muted boolean NOT NULL DEFAULT false,
    hidden boolean NOT NULL DEFAULT false,
    position integer NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_marketing_creatives_campaign ON public.marketing_creatives (campaign_id, position);
CREATE INDEX IF NOT EXISTS idx_marketing_creatives_media ON public.marketing_creatives (media_id);

-- Per shop, per placement: on/off and how many adverts share it. No row = the defaults in fn_mkt_placement.
CREATE TABLE IF NOT EXISTS public.marketing_placements (
    business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    placement text NOT NULL CHECK (placement IN ('hero', 'announcement', 'card', 'product', 'video', 'popup', 'category', 'landing')),
    enabled boolean NOT NULL DEFAULT true,
    max_items integer NOT NULL CHECK (max_items BETWEEN 1 AND 6),
    rotation text NOT NULL DEFAULT 'priority' CHECK (rotation IN ('priority', 'rotate')),
    interval_s integer NOT NULL DEFAULT 7 CHECK (interval_s BETWEEN 4 AND 30),
    popup_delay_s integer NOT NULL DEFAULT 8 CHECK (popup_delay_s BETWEEN 3 AND 120),
    popup_every_h integer NOT NULL DEFAULT 24 CHECK (popup_every_h BETWEEN 6 AND 720),
    updated_by uuid,
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (business_id, placement)
);

CREATE TABLE IF NOT EXISTS public.marketing_campaign_events (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    campaign_id uuid NOT NULL REFERENCES public.marketing_campaigns(id) ON DELETE CASCADE,
    business_id uuid NOT NULL,
    event text NOT NULL CHECK (event IN ('created', 'edited', 'published', 'unpublished', 'paused', 'resumed',
        'ended', 'archived', 'restored', 'duplicated', 'started', 'finished', 'creative_added', 'creative_changed', 'creative_removed')),
    note text CHECK (length(note) <= 300),
    actor uuid,
    at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_marketing_events_campaign ON public.marketing_campaign_events (campaign_id, at DESC);
CREATE INDEX IF NOT EXISTS idx_marketing_events_business ON public.marketing_campaign_events (business_id, at DESC);

-- Statistics: one row per creative per day; raw "seen once per visit" keys kept 3 days for de-duplication.
CREATE TABLE IF NOT EXISTS public.marketing_ad_daily (
    creative_id uuid NOT NULL REFERENCES public.marketing_creatives(id) ON DELETE CASCADE,
    day date NOT NULL,
    business_id uuid NOT NULL,
    campaign_id uuid NOT NULL,
    loads integer NOT NULL DEFAULT 0,
    views integer NOT NULL DEFAULT 0,
    clicks integer NOT NULL DEFAULT 0,
    conversions integer NOT NULL DEFAULT 0,
    PRIMARY KEY (creative_id, day)
);
CREATE INDEX IF NOT EXISTS idx_marketing_ad_daily_campaign ON public.marketing_ad_daily (campaign_id, day);
CREATE INDEX IF NOT EXISTS idx_marketing_ad_daily_business ON public.marketing_ad_daily (business_id, day);

CREATE TABLE IF NOT EXISTS public.marketing_ad_seen (
    visit text NOT NULL,
    creative_id uuid NOT NULL,
    kind text NOT NULL CHECK (kind IN ('load', 'view', 'click')),
    day date NOT NULL,
    at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (visit, creative_id, kind, day)
);
CREATE INDEX IF NOT EXISTS idx_marketing_ad_seen_at ON public.marketing_ad_seen (at);

-- One order counts for at most one advert (the last one clicked in that visit).
CREATE TABLE IF NOT EXISTS public.marketing_conversions (
    order_id uuid PRIMARY KEY REFERENCES public.online_orders(id) ON DELETE CASCADE,
    business_id uuid NOT NULL,
    campaign_id uuid NOT NULL REFERENCES public.marketing_campaigns(id) ON DELETE CASCADE,
    creative_id uuid NOT NULL REFERENCES public.marketing_creatives(id) ON DELETE CASCADE,
    at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_marketing_conversions_campaign ON public.marketing_conversions (campaign_id);

-- Canva: one connection per person (Canva accounts belong to people, not shops). Tokens are
-- encrypted by the canva-connect function before they get here; only that function reads them.
CREATE TABLE IF NOT EXISTS public.canva_connections (
    user_id uuid PRIMARY KEY,
    canva_user_id text,
    canva_team_id text,
    display_name text,
    access_token_enc text NOT NULL,
    refresh_token_enc text NOT NULL,
    access_expires_at timestamptz NOT NULL,
    scopes text,
    connected_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.canva_oauth_states (
    state text PRIMARY KEY,
    user_id uuid NOT NULL,
    business_id uuid NOT NULL,
    verifier_enc text NOT NULL,
    return_to text,
    created_at timestamptz NOT NULL DEFAULT now()
);

-- ============================================================================================
-- 4. Rules shared by the app (src/features/marketing/rules.ts, same numbers; compared by tests)
-- ============================================================================================
-- Formats: the shape a picture is shown in. ratio = width / height.
CREATE OR REPLACE FUNCTION public.fn_mkt_format(p_format text)
RETURNS jsonb
LANGUAGE sql IMMUTABLE
SET search_path = ''
AS $$
    SELECT CASE p_format
        WHEN 'hero_16x9'  THEN '{"ratio":1.7778,"min_width":1280,"media":"image"}'
        WHEN 'wide_3x1'   THEN '{"ratio":3.0,"min_width":1200,"media":"image"}'
        WHEN 'card_4x5'   THEN '{"ratio":0.8,"min_width":600,"media":"image"}'
        WHEN 'square_1x1' THEN '{"ratio":1.0,"min_width":600,"media":"image"}'
        WHEN 'story_9x16' THEN '{"ratio":0.5625,"min_width":720,"media":"image"}'
        WHEN 'video_16x9' THEN '{"ratio":1.7778,"min_width":640,"media":"video"}'
        WHEN 'video_9x16' THEN '{"ratio":0.5625,"min_width":360,"media":"video"}'
        WHEN 'text'       THEN '{"media":"none"}'
    END::jsonb;
$$;

-- Placements: which formats each takes, and its defaults.
CREATE OR REPLACE FUNCTION public.fn_mkt_placement(p_placement text)
RETURNS jsonb
LANGUAGE sql IMMUTABLE
SET search_path = ''
AS $$
    SELECT CASE p_placement
        WHEN 'hero'         THEN '{"formats":["hero_16x9","video_16x9"],"mobile":["hero_16x9","card_4x5","square_1x1","story_9x16"],"max_items":3,"rotation":"rotate"}'
        WHEN 'announcement' THEN '{"formats":["text"],"mobile":[],"max_items":1,"rotation":"rotate"}'
        WHEN 'card'         THEN '{"formats":["card_4x5","square_1x1"],"mobile":[],"max_items":3,"rotation":"priority"}'
        WHEN 'product'      THEN '{"formats":["text","square_1x1","card_4x5"],"mobile":[],"max_items":1,"rotation":"priority"}'
        WHEN 'video'        THEN '{"formats":["video_16x9","video_9x16"],"mobile":["video_9x16"],"max_items":1,"rotation":"priority"}'
        WHEN 'popup'        THEN '{"formats":["square_1x1","card_4x5","text"],"mobile":[],"max_items":1,"rotation":"priority"}'
        WHEN 'category'     THEN '{"formats":["wide_3x1"],"mobile":["wide_3x1","square_1x1","card_4x5"],"max_items":1,"rotation":"rotate"}'
        WHEN 'landing'      THEN '{"formats":["hero_16x9","wide_3x1","square_1x1","card_4x5","video_16x9","video_9x16","text"],"mobile":["card_4x5","square_1x1","story_9x16","video_9x16"],"max_items":6,"rotation":"priority"}'
    END::jsonb;
$$;

-- A call to action goes to a page of this website or to an https address. Nothing else.
CREATE OR REPLACE FUNCTION public.fn_mkt_valid_href(p text)
RETURNS boolean
LANGUAGE sql IMMUTABLE
SET search_path = ''
AS $$
    SELECT p IS NOT NULL AND length(p) <= 300 AND p !~ '[\s"''<>\\]'
       AND ((p ~ '^/' AND p !~ '^//') OR p ~* '^https://[a-z0-9.-]+\.[a-z]{2,}(/|$|\?|#)');
$$;

-- What visitors see now: draft | scheduled | active | paused | completed | archived.
CREATE OR REPLACE FUNCTION public.fn_mkt_status(p_state text, p_starts timestamptz, p_ends timestamptz, p_now timestamptz DEFAULT now())
RETURNS text
LANGUAGE sql IMMUTABLE
SET search_path = ''
AS $$
    SELECT CASE
        WHEN p_state = 'archived' THEN 'archived'
        WHEN p_state = 'draft' THEN 'draft'
        WHEN p_state = 'ended' THEN 'completed'
        WHEN p_ends IS NOT NULL AND p_now >= p_ends THEN 'completed'
        WHEN p_state = 'paused' THEN 'paused'
        WHEN p_now < p_starts THEN 'scheduled'
        ELSE 'active'
    END;
$$;

-- Local time typed in the app ('2026-11-27T08:00') to an instant, in the shop's time zone.
CREATE OR REPLACE FUNCTION public.fn_mkt_local_time(p_business_id uuid, p_local text)
RETURNS timestamptz
LANGUAGE plpgsql STABLE
SET search_path = ''
AS $$
DECLARE
    v_tz text;
BEGIN
    IF p_local IS NULL OR btrim(p_local) = '' THEN
        RETURN NULL;
    END IF;
    IF p_local !~ '^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2})?$' THEN
        RAISE EXCEPTION 'Dates must look like 2026-11-27 08:00' USING ERRCODE = '22023';
    END IF;
    SELECT timezone INTO v_tz FROM public.businesses WHERE id = p_business_id;
    RETURN (replace(p_local, 'T', ' ')::timestamp) AT TIME ZONE COALESCE(v_tz, 'Africa/Nairobi');
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_mkt_log(p_campaign uuid, p_business uuid, p_event text, p_note text DEFAULT NULL)
RETURNS void
LANGUAGE sql
SET search_path = ''
AS $$
    INSERT INTO public.marketing_campaign_events (campaign_id, business_id, event, note, actor)
    VALUES (p_campaign, p_business, p_event, left(p_note, 300), auth.uid());
$$;

-- Problems that stop a campaign going live (empty array = fine). Also used by the app.
CREATE OR REPLACE FUNCTION public.fn_mkt_campaign_problems(p_campaign_id uuid)
RETURNS text[]
LANGUAGE plpgsql STABLE
SET search_path = ''
AS $$
DECLARE
    c public.marketing_campaigns;
    v text[] := '{}';
BEGIN
    SELECT * INTO c FROM public.marketing_campaigns WHERE id = p_campaign_id;
    IF NOT EXISTS (SELECT 1 FROM public.marketing_creatives WHERE campaign_id = c.id AND NOT hidden) THEN
        v := array_append(v, 'Add at least one creative (a banner, card, video or message).');
    END IF;
    IF c.ends_at IS NOT NULL AND c.ends_at <= now() THEN
        v := array_append(v, 'The end date has already passed.');
    END IF;
    IF c.cta_kind NOT IN ('none', 'promo_code', 'whatsapp') AND COALESCE(c.cta_target, '') = '' AND c.cta_kind <> 'landing' THEN
        v := array_append(v, 'Choose where the button goes.');
    END IF;
    IF c.cta_kind = 'landing' AND c.landing_slug IS NULL THEN
        v := array_append(v, 'Give the campaign page a web address first.');
    END IF;
    IF c.cta_kind = 'promo_code' AND c.promotion_id IS NULL THEN
        v := array_append(v, 'Choose the promotion code the button shows.');
    END IF;
    IF EXISTS (SELECT 1 FROM public.marketing_creatives r
               WHERE r.campaign_id = c.id AND NOT r.hidden AND r.placement = 'product'
                 AND cardinality(c.target_product_ids) = 0 AND c.target_category IS NULL) THEN
        v := array_append(v, 'A product promotion needs the products or the category it is shown on.');
    END IF;
    -- Two pop-ups at the same time with the same priority would take turns at random: refuse.
    IF EXISTS (SELECT 1 FROM public.marketing_creatives r WHERE r.campaign_id = c.id AND NOT r.hidden AND r.placement = 'popup')
       AND EXISTS (
        SELECT 1 FROM public.marketing_campaigns o
        JOIN public.marketing_creatives orr ON orr.campaign_id = o.id AND NOT orr.hidden AND orr.placement = 'popup'
        WHERE o.business_id = c.business_id AND o.id <> c.id AND o.state IN ('live', 'paused')
          AND o.priority = c.priority
          AND (o.ends_at IS NULL OR o.ends_at > c.starts_at)
          AND (c.ends_at IS NULL OR c.ends_at > o.starts_at)
          AND (o.ends_at IS NULL OR o.ends_at > now())) THEN
        v := array_append(v, 'Another campaign has a pop-up at the same time with the same priority. Change the priority of one of them.');
    END IF;
    RETURN v;
END;
$$;

-- A creative's media must exist in this shop, be the right kind, and be sharp enough for its format.
CREATE OR REPLACE FUNCTION public.fn_mkt_check_media(p_business uuid, p_media uuid, p_format text, p_what text)
RETURNS void
LANGUAGE plpgsql STABLE
SET search_path = ''
AS $$
DECLARE
    m public.website_media;
    f jsonb := public.fn_mkt_format(p_format);
BEGIN
    IF p_media IS NULL THEN
        RETURN;
    END IF;
    SELECT * INTO m FROM public.website_media WHERE id = p_media AND business_id = p_business AND deleted_at IS NULL;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'The % is not in this shop''s media library', p_what USING ERRCODE = '22023';
    END IF;
    IF p_what = 'poster picture' THEN
        IF m.kind <> 'image' THEN RAISE EXCEPTION 'The poster must be a picture' USING ERRCODE = '22023'; END IF;
        RETURN;
    END IF;
    IF p_what = 'captions file' THEN
        IF m.kind <> 'captions' THEN RAISE EXCEPTION 'Captions must be a .vtt file' USING ERRCODE = '22023'; END IF;
        RETURN;
    END IF;
    IF f->>'media' = 'none' THEN
        RAISE EXCEPTION 'A text-only creative has no picture' USING ERRCODE = '22023';
    END IF;
    IF m.kind <> f->>'media' THEN
        RAISE EXCEPTION 'This format needs a %', CASE f->>'media' WHEN 'video' THEN 'video' ELSE 'picture' END USING ERRCODE = '22023';
    END IF;
    -- Half the recommended width is the floor; below it the advert would look blurred.
    IF m.width < (f->>'min_width')::integer / 2 THEN
        RAISE EXCEPTION 'The % is too small for this format (% px wide; at least % px, ideally %)',
            p_what, m.width, (f->>'min_width')::integer / 2, f->>'min_width' USING ERRCODE = '22023';
    END IF;
END;
$$;

-- ============================================================================================
-- 5. Staff functions
-- ============================================================================================
-- Register an uploaded file. The size and type come from the stored file itself, not the caller.
CREATE OR REPLACE FUNCTION public.website_media_register(p_business_id uuid, p_path text, p_meta jsonb DEFAULT '{}')
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    o record;
    v_mime text;
    v_bytes bigint;
    v_kind text;
    v_id uuid;
    v_used bigint;
    v_quota bigint;
    v_w integer := NULLIF(p_meta->>'width', '')::integer;
    v_h integer := NULLIF(p_meta->>'height', '')::integer;
    v_d integer := NULLIF(p_meta->>'duration_ms', '')::integer;
    v_url text;
BEGIN
    PERFORM public.assert_permission(p_business_id, 'marketing.manage', 'business.update');
    IF p_path IS NULL OR split_part(p_path, '/', 1) <> p_business_id::text OR p_path ~ '\.\.' THEN
        RAISE EXCEPTION 'That file is not in this shop''s folder' USING ERRCODE = '42501';
    END IF;
    SELECT * INTO o FROM storage.objects WHERE bucket_id = 'website-media' AND name = p_path;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'The upload did not finish. Try again.' USING ERRCODE = 'P0002';
    END IF;
    v_mime := lower(COALESCE(o.metadata->>'mimetype', ''));
    v_bytes := COALESCE((o.metadata->>'size')::bigint, 0);
    v_kind := CASE
        WHEN v_mime IN ('image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/gif') THEN 'image'
        WHEN v_mime IN ('video/mp4', 'video/webm') THEN 'video'
        WHEN v_mime = 'text/vtt' THEN 'captions' END;
    IF v_kind IS NULL THEN
        RAISE EXCEPTION 'That kind of file is not accepted (%). Use JPG, PNG, WebP, AVIF, GIF, MP4, WebM or VTT.', v_mime USING ERRCODE = '22023';
    END IF;
    IF (v_kind = 'image' AND v_bytes > 10485760) OR (v_kind = 'video' AND v_bytes > 52428800) OR (v_kind = 'captions' AND v_bytes > 204800) THEN
        RAISE EXCEPTION 'That file is too large (pictures up to 10 MB, videos up to 50 MB, captions up to 200 KB)' USING ERRCODE = '22023';
    END IF;
    IF v_kind IN ('image', 'video') AND (v_w IS NULL OR v_h IS NULL OR v_w NOT BETWEEN 16 AND 8000 OR v_h NOT BETWEEN 16 AND 8000) THEN
        RAISE EXCEPTION 'The picture size could not be read' USING ERRCODE = '22023';
    END IF;
    IF v_kind = 'video' AND (v_d IS NULL OR v_d NOT BETWEEN 1000 AND 180000) THEN
        RAISE EXCEPTION 'Videos must be between 1 second and 3 minutes long' USING ERRCODE = '22023';
    END IF;
    -- The plan's storage allowance covers this library.
    v_quota := NULLIF(public.fn_tenant_plan(public.fn_business_tenant(p_business_id))->>'storage_mb', '')::bigint * 1048576;
    IF v_quota IS NOT NULL AND v_quota > 0 THEN
        SELECT COALESCE(sum(m.bytes), 0) INTO v_used FROM public.website_media m
        JOIN public.businesses b ON b.id = m.business_id
        WHERE b.tenant_id = (SELECT tenant_id FROM public.businesses WHERE id = p_business_id) AND m.deleted_at IS NULL;
        IF v_used + v_bytes > v_quota THEN
            RAISE EXCEPTION 'Your plan''s storage is full (% MB). Remove unused media or change plan.', v_quota / 1048576 USING ERRCODE = '53100';
        END IF;
    END IF;
    v_url := NULLIF(p_meta->>'url', '');
    IF v_url IS NULL OR v_url !~ ('^https?://[^/]+/storage/v1/object/public/website-media/' || replace(p_path, '.', '\.') || '$') THEN
        RAISE EXCEPTION 'The file address does not match the upload' USING ERRCODE = '22023';
    END IF;
    INSERT INTO public.website_media (business_id, kind, path, url, mime_type, bytes, width, height, duration_ms,
        title, alt_text, folder, source, canva_design_id, created_by)
    VALUES (p_business_id, v_kind, p_path, v_url, v_mime, v_bytes,
        CASE WHEN v_kind <> 'captions' THEN v_w END, CASE WHEN v_kind <> 'captions' THEN v_h END,
        CASE WHEN v_kind = 'video' THEN v_d END,
        left(NULLIF(btrim(p_meta->>'title'), ''), 120), left(NULLIF(btrim(p_meta->>'alt_text'), ''), 250),
        left(NULLIF(btrim(p_meta->>'folder'), ''), 60),
        CASE WHEN p_meta->>'source' = 'canva' THEN 'canva' ELSE 'upload' END,
        left(NULLIF(p_meta->>'canva_design_id', ''), 64), auth.uid())
    RETURNING id INTO v_id;
    RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.website_media_update(p_media_id uuid, p_meta jsonb)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    m public.website_media;
BEGIN
    SELECT * INTO m FROM public.website_media WHERE id = p_media_id AND deleted_at IS NULL;
    IF NOT FOUND THEN RAISE EXCEPTION 'Media not found' USING ERRCODE = 'P0002'; END IF;
    PERFORM public.assert_permission(m.business_id, 'marketing.manage', 'business.update');
    UPDATE public.website_media SET
        title = CASE WHEN p_meta ? 'title' THEN left(NULLIF(btrim(p_meta->>'title'), ''), 120) ELSE title END,
        alt_text = CASE WHEN p_meta ? 'alt_text' THEN left(NULLIF(btrim(p_meta->>'alt_text'), ''), 250) ELSE alt_text END,
        folder = CASE WHEN p_meta ? 'folder' THEN left(NULLIF(btrim(p_meta->>'folder'), ''), 60) ELSE folder END,
        focal_x = CASE WHEN p_meta ? 'focal_x' THEN (p_meta->>'focal_x')::numeric ELSE focal_x END,
        focal_y = CASE WHEN p_meta ? 'focal_y' THEN (p_meta->>'focal_y')::numeric ELSE focal_y END,
        updated_at = now()
    WHERE id = p_media_id;
END;
$$;

-- Removes media no creative uses. Returns the stored path when the file itself may be deleted
-- (nothing ever referred to it), else NULL (kept for the history of past campaigns).
CREATE OR REPLACE FUNCTION public.website_media_remove(p_media_id uuid)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    m public.website_media;
    v_ref boolean;
BEGIN
    SELECT * INTO m FROM public.website_media WHERE id = p_media_id AND deleted_at IS NULL;
    IF NOT FOUND THEN RAISE EXCEPTION 'Media not found' USING ERRCODE = 'P0002'; END IF;
    PERFORM public.assert_permission(m.business_id, 'marketing.manage', 'business.update');
    IF EXISTS (SELECT 1 FROM public.marketing_creatives r JOIN public.marketing_campaigns c ON c.id = r.campaign_id
               WHERE c.state <> 'archived' AND p_media_id IN (r.media_id, r.mobile_media_id, r.poster_media_id, r.captions_media_id)) THEN
        RAISE EXCEPTION 'A campaign still uses this. Replace it in the campaign first.' USING ERRCODE = '23503';
    END IF;
    v_ref := EXISTS (SELECT 1 FROM public.marketing_creatives r
                     WHERE p_media_id IN (r.media_id, r.mobile_media_id, r.poster_media_id, r.captions_media_id));
    IF v_ref THEN
        UPDATE public.website_media SET deleted_at = now(), updated_at = now() WHERE id = p_media_id;
        RETURN NULL;
    END IF;
    DELETE FROM public.website_media WHERE id = p_media_id;
    RETURN m.path;
END;
$$;

-- Create (p_campaign->>'id' empty) or change a campaign. Times are local to the shop.
CREATE OR REPLACE FUNCTION public.marketing_campaign_save(p_business_id uuid, p_campaign jsonb, p_base_revision integer DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    c public.marketing_campaigns;
    v_id uuid := NULLIF(p_campaign->>'id', '')::uuid;
    v_starts timestamptz;
    v_ends timestamptz;
    v_products uuid[];
    v_kind text := COALESCE(NULLIF(p_campaign->>'cta_kind', ''), 'none');
    v_target text := NULLIF(btrim(p_campaign->>'cta_target'), '');
    v_promo uuid := NULLIF(p_campaign->>'promotion_id', '')::uuid;
    k text;
BEGIN
    PERFORM public.assert_permission(p_business_id, 'marketing.manage');
    FOR k IN SELECT jsonb_object_keys(p_campaign) LOOP
        IF k NOT IN ('id', 'name', 'description', 'campaign_type', 'objective', 'starts_local', 'ends_local', 'priority',
                     'cta_label', 'cta_kind', 'cta_target', 'discount_label', 'promotion_id', 'target_product_ids',
                     'target_category', 'landing_slug', 'tone') THEN
            RAISE EXCEPTION 'Unknown campaign setting %', k USING ERRCODE = '22023';
        END IF;
    END LOOP;
    v_starts := public.fn_mkt_local_time(p_business_id, p_campaign->>'starts_local');
    v_ends := public.fn_mkt_local_time(p_business_id, p_campaign->>'ends_local');
    IF v_starts IS NULL THEN
        RAISE EXCEPTION 'Choose when the campaign starts' USING ERRCODE = '22023';
    END IF;
    IF v_ends IS NOT NULL AND v_ends <= v_starts THEN
        RAISE EXCEPTION 'The campaign must end after it starts' USING ERRCODE = '22023';
    END IF;
    -- Destination checks
    IF v_kind = 'link' AND NOT public.fn_mkt_valid_href(v_target) THEN
        RAISE EXCEPTION 'The button link must be a page of your website (/shop) or an https:// address' USING ERRCODE = '22023';
    END IF;
    IF v_kind = 'product' AND (v_target IS NULL OR NOT EXISTS (
            SELECT 1 FROM public.products WHERE id::text = v_target AND business_id = p_business_id)) THEN
        RAISE EXCEPTION 'Choose a product of this shop for the button' USING ERRCODE = '22023';
    END IF;
    IF v_kind NOT IN ('link', 'product', 'category') THEN
        v_target := NULL;
    END IF;
    IF v_promo IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.website_promo_codes WHERE id = v_promo AND business_id = p_business_id) THEN
        RAISE EXCEPTION 'That promotion code is not this shop''s' USING ERRCODE = '22023';
    END IF;
    SELECT COALESCE(array_agg(DISTINCT x::uuid), '{}') INTO v_products
    FROM jsonb_array_elements_text(COALESCE(p_campaign->'target_product_ids', '[]')) x;
    IF EXISTS (SELECT 1 FROM unnest(v_products) pid WHERE NOT EXISTS (
            SELECT 1 FROM public.products p WHERE p.id = pid AND p.business_id = p_business_id)) THEN
        RAISE EXCEPTION 'Some chosen products are not this shop''s' USING ERRCODE = '22023';
    END IF;

    IF v_id IS NULL THEN
        INSERT INTO public.marketing_campaigns (business_id, name, starts_at, created_by)
        VALUES (p_business_id, COALESCE(NULLIF(btrim(p_campaign->>'name'), ''), 'x'), v_starts, auth.uid())
        RETURNING * INTO c;
        PERFORM public.fn_mkt_log(c.id, p_business_id, 'created');
    ELSE
        SELECT * INTO c FROM public.marketing_campaigns WHERE id = v_id AND business_id = p_business_id FOR UPDATE;
        IF NOT FOUND THEN RAISE EXCEPTION 'Campaign not found' USING ERRCODE = 'P0002'; END IF;
        IF c.state = 'archived' THEN RAISE EXCEPTION 'Restore the campaign before changing it' USING ERRCODE = '22023'; END IF;
        IF p_base_revision IS NOT NULL AND p_base_revision <> c.revision THEN
            RAISE EXCEPTION 'Someone else saved this campaign. Reload it and make your change again.' USING ERRCODE = '40001';
        END IF;
        PERFORM public.fn_mkt_log(c.id, p_business_id, 'edited');
    END IF;

    UPDATE public.marketing_campaigns SET
        name = btrim(p_campaign->>'name'),
        description = NULLIF(btrim(p_campaign->>'description'), ''),
        campaign_type = COALESCE(NULLIF(p_campaign->>'campaign_type', ''), 'other'),
        objective = COALESCE(NULLIF(p_campaign->>'objective', ''), 'sales'),
        starts_at = v_starts,
        ends_at = v_ends,
        priority = COALESCE(NULLIF(p_campaign->>'priority', '')::integer, 50),
        cta_label = NULLIF(btrim(p_campaign->>'cta_label'), ''),
        cta_kind = v_kind,
        cta_target = v_target,
        discount_label = NULLIF(btrim(p_campaign->>'discount_label'), ''),
        promotion_id = v_promo,
        target_product_ids = v_products,
        target_category = NULLIF(btrim(p_campaign->>'target_category'), ''),
        landing_slug = NULLIF(lower(btrim(p_campaign->>'landing_slug')), ''),
        tone = COALESCE(NULLIF(p_campaign->>'tone', ''), 'brand'),
        -- A changed schedule is announced again by the job.
        started_logged_at = CASE WHEN v_starts IS DISTINCT FROM c.starts_at THEN NULL ELSE c.started_logged_at END,
        ended_logged_at = CASE WHEN v_ends IS DISTINCT FROM c.ends_at THEN NULL ELSE c.ended_logged_at END,
        revision = c.revision + CASE WHEN v_id IS NULL THEN 0 ELSE 1 END,
        updated_at = now()
    WHERE id = c.id;
    RETURN c.id;
EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'Another campaign already uses that page address' USING ERRCODE = '23505';
END;
$$;

-- publish | unpublish | pause | resume | end | archive | restore
CREATE OR REPLACE FUNCTION public.marketing_campaign_action(p_campaign_id uuid, p_action text, p_note text DEFAULT NULL)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    c public.marketing_campaigns;
    v_status text;
    v_problems text[];
BEGIN
    SELECT * INTO c FROM public.marketing_campaigns WHERE id = p_campaign_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Campaign not found' USING ERRCODE = 'P0002'; END IF;
    PERFORM public.assert_permission(c.business_id, 'marketing.manage');
    v_status := public.fn_mkt_status(c.state, c.starts_at, c.ends_at);

    IF p_action = 'publish' THEN
        IF c.state NOT IN ('draft') THEN RAISE EXCEPTION 'Only a draft can be published' USING ERRCODE = '22023'; END IF;
        v_problems := public.fn_mkt_campaign_problems(c.id);
        IF cardinality(v_problems) > 0 THEN
            RAISE EXCEPTION '%', array_to_string(v_problems, ' ') USING ERRCODE = '22023';
        END IF;
        UPDATE public.marketing_campaigns SET state = 'live', published_at = now(), updated_at = now(), revision = revision + 1 WHERE id = c.id;
        PERFORM public.fn_mkt_log(c.id, c.business_id, 'published',
            CASE WHEN c.starts_at > now() THEN 'Scheduled' ELSE 'Showing now' END);
    ELSIF p_action = 'unpublish' THEN
        IF c.state NOT IN ('live', 'paused') OR v_status = 'completed' THEN
            RAISE EXCEPTION 'Only a published campaign that has not finished can go back to draft' USING ERRCODE = '22023';
        END IF;
        UPDATE public.marketing_campaigns SET state = 'draft', updated_at = now(), revision = revision + 1 WHERE id = c.id;
        PERFORM public.fn_mkt_log(c.id, c.business_id, 'unpublished', p_note);
    ELSIF p_action = 'pause' THEN
        IF v_status NOT IN ('active', 'scheduled') THEN RAISE EXCEPTION 'Only a running or scheduled campaign can be paused' USING ERRCODE = '22023'; END IF;
        UPDATE public.marketing_campaigns SET state = 'paused', updated_at = now(), revision = revision + 1 WHERE id = c.id;
        PERFORM public.fn_mkt_log(c.id, c.business_id, 'paused', p_note);
    ELSIF p_action = 'resume' THEN
        IF v_status <> 'paused' THEN RAISE EXCEPTION 'Only a paused campaign can be resumed' USING ERRCODE = '22023'; END IF;
        v_problems := public.fn_mkt_campaign_problems(c.id);
        IF cardinality(v_problems) > 0 THEN
            RAISE EXCEPTION '%', array_to_string(v_problems, ' ') USING ERRCODE = '22023';
        END IF;
        UPDATE public.marketing_campaigns SET state = 'live', updated_at = now(), revision = revision + 1 WHERE id = c.id;
        PERFORM public.fn_mkt_log(c.id, c.business_id, 'resumed', p_note);
    ELSIF p_action = 'end' THEN
        IF v_status NOT IN ('active', 'scheduled', 'paused') THEN RAISE EXCEPTION 'This campaign is not running' USING ERRCODE = '22023'; END IF;
        UPDATE public.marketing_campaigns SET state = 'ended',
            ends_at = CASE WHEN ends_at IS NULL OR ends_at > now() THEN GREATEST(now(), starts_at + interval '1 second') ELSE ends_at END,
            ended_logged_at = now(), updated_at = now(), revision = revision + 1 WHERE id = c.id;
        PERFORM public.fn_mkt_log(c.id, c.business_id, 'ended', p_note);
    ELSIF p_action = 'archive' THEN
        IF v_status IN ('active', 'scheduled', 'paused') THEN RAISE EXCEPTION 'End the campaign before archiving it' USING ERRCODE = '22023'; END IF;
        UPDATE public.marketing_campaigns SET state = 'archived', updated_at = now(), revision = revision + 1 WHERE id = c.id;
        PERFORM public.fn_mkt_log(c.id, c.business_id, 'archived', p_note);
    ELSIF p_action = 'restore' THEN
        IF c.state <> 'archived' THEN RAISE EXCEPTION 'Only an archived campaign can be restored' USING ERRCODE = '22023'; END IF;
        UPDATE public.marketing_campaigns SET state = CASE WHEN published_at IS NULL THEN 'draft' ELSE 'ended' END,
            updated_at = now(), revision = revision + 1 WHERE id = c.id;
        PERFORM public.fn_mkt_log(c.id, c.business_id, 'restored', p_note);
    ELSE
        RAISE EXCEPTION 'Unknown action %', p_action USING ERRCODE = '22023';
    END IF;
    SELECT * INTO c FROM public.marketing_campaigns WHERE id = p_campaign_id;
    RETURN public.fn_mkt_status(c.state, c.starts_at, c.ends_at);
END;
$$;

-- Copy as a new draft (same creatives, schedule moved to start tomorrow at the same time of day
-- when the original has already started).
CREATE OR REPLACE FUNCTION public.marketing_campaign_duplicate(p_campaign_id uuid)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    c public.marketing_campaigns;
    v_id uuid;
    v_shift interval := interval '0';
BEGIN
    SELECT * INTO c FROM public.marketing_campaigns WHERE id = p_campaign_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Campaign not found' USING ERRCODE = 'P0002'; END IF;
    PERFORM public.assert_permission(c.business_id, 'marketing.manage');
    IF c.starts_at < now() THEN
        v_shift := (date_trunc('day', now()) + interval '1 day' + (c.starts_at - date_trunc('day', c.starts_at))) - c.starts_at;
    END IF;
    INSERT INTO public.marketing_campaigns (business_id, name, description, campaign_type, objective, state,
        starts_at, ends_at, priority, cta_label, cta_kind, cta_target, discount_label, promotion_id,
        target_product_ids, target_category, landing_slug, tone, created_by)
    VALUES (c.business_id, left('Copy of ' || c.name, 80), c.description, c.campaign_type, c.objective, 'draft',
        c.starts_at + v_shift, c.ends_at + v_shift, c.priority, c.cta_label, c.cta_kind, c.cta_target, c.discount_label,
        c.promotion_id, c.target_product_ids, c.target_category, NULL, c.tone, auth.uid())
    RETURNING id INTO v_id;
    INSERT INTO public.marketing_creatives (campaign_id, business_id, placement, format, media_id, mobile_media_id,
        poster_media_id, captions_media_id, headline, body, cta_label, alt_text, focal_x, focal_y, text_position,
        autoplay_muted, hidden, position)
    SELECT v_id, r.business_id, r.placement, r.format, r.media_id, r.mobile_media_id, r.poster_media_id,
        r.captions_media_id, r.headline, r.body, r.cta_label, r.alt_text, r.focal_x, r.focal_y, r.text_position,
        r.autoplay_muted, r.hidden, r.position
    FROM public.marketing_creatives r
    WHERE r.campaign_id = c.id AND NOT r.hidden
      -- Creatives whose media was removed from the library are left out of the copy.
      AND NOT EXISTS (SELECT 1 FROM public.website_media m
                      WHERE m.deleted_at IS NOT NULL AND m.id IN (r.media_id, r.mobile_media_id, r.poster_media_id, r.captions_media_id));
    PERFORM public.fn_mkt_log(v_id, c.business_id, 'duplicated', 'From ' || c.name);
    RETURN v_id;
END;
$$;

-- Add (no id) or change a creative of a campaign.
CREATE OR REPLACE FUNCTION public.marketing_creative_save(p_campaign_id uuid, p_creative jsonb)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    c public.marketing_campaigns;
    v_id uuid := NULLIF(p_creative->>'id', '')::uuid;
    v_placement text := p_creative->>'placement';
    v_format text := p_creative->>'format';
    v_pl jsonb := public.fn_mkt_placement(p_creative->>'placement');
    v_media uuid := NULLIF(p_creative->>'media_id', '')::uuid;
    v_mobile uuid := NULLIF(p_creative->>'mobile_media_id', '')::uuid;
    v_poster uuid := NULLIF(p_creative->>'poster_media_id', '')::uuid;
    v_captions uuid := NULLIF(p_creative->>'captions_media_id', '')::uuid;
    v_mobile_format text;
    v_count integer;
    k text;
BEGIN
    SELECT * INTO c FROM public.marketing_campaigns WHERE id = p_campaign_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Campaign not found' USING ERRCODE = 'P0002'; END IF;
    PERFORM public.assert_permission(c.business_id, 'marketing.manage');
    IF c.state = 'archived' THEN RAISE EXCEPTION 'Restore the campaign before changing it' USING ERRCODE = '22023'; END IF;
    FOR k IN SELECT jsonb_object_keys(p_creative) LOOP
        IF k NOT IN ('id', 'placement', 'format', 'media_id', 'mobile_media_id', 'poster_media_id', 'captions_media_id',
                     'headline', 'body', 'cta_label', 'alt_text', 'focal_x', 'focal_y', 'text_position', 'autoplay_muted',
                     'hidden', 'position', 'mobile_format') THEN
            RAISE EXCEPTION 'Unknown creative setting %', k USING ERRCODE = '22023';
        END IF;
    END LOOP;
    IF v_pl IS NULL THEN RAISE EXCEPTION 'Unknown placement %', v_placement USING ERRCODE = '22023'; END IF;
    IF NOT (v_pl->'formats' ? v_format) THEN
        RAISE EXCEPTION 'The % placement does not take the % format', v_placement, v_format USING ERRCODE = '22023';
    END IF;
    IF v_format = 'text' THEN
        IF COALESCE(btrim(p_creative->>'headline'), '') = '' THEN
            RAISE EXCEPTION 'A text-only creative needs its message' USING ERRCODE = '22023';
        END IF;
        v_media := NULL; v_mobile := NULL; v_poster := NULL; v_captions := NULL;
    ELSIF v_media IS NULL THEN
        RAISE EXCEPTION 'Choose the picture or video for this creative' USING ERRCODE = '22023';
    END IF;
    PERFORM public.fn_mkt_check_media(c.business_id, v_media, v_format, CASE WHEN v_format LIKE 'video%' THEN 'video' ELSE 'picture' END);
    IF v_mobile IS NOT NULL THEN
        v_mobile_format := COALESCE(NULLIF(p_creative->>'mobile_format', ''), (v_pl->'mobile'->>0));
        IF NOT (v_pl->'mobile' ? v_mobile_format) THEN
            RAISE EXCEPTION 'The % placement has no phone version in that format', v_placement USING ERRCODE = '22023';
        END IF;
        PERFORM public.fn_mkt_check_media(c.business_id, v_mobile, v_mobile_format, 'phone version');
    END IF;
    IF v_format LIKE 'video%' THEN
        IF v_poster IS NULL THEN
            RAISE EXCEPTION 'A video needs a cover picture, shown until it plays' USING ERRCODE = '22023';
        END IF;
        PERFORM public.fn_mkt_check_media(c.business_id, v_poster, v_format, 'poster picture');
        PERFORM public.fn_mkt_check_media(c.business_id, v_captions, v_format, 'captions file');
    ELSE
        v_poster := NULL; v_captions := NULL;
    END IF;
    IF COALESCE((p_creative->>'autoplay_muted')::boolean, false) AND v_format NOT LIKE 'video%' THEN
        RAISE EXCEPTION 'Only videos can play by themselves' USING ERRCODE = '22023';
    END IF;
    IF v_media IS NOT NULL AND COALESCE(btrim(p_creative->>'alt_text'), '') = ''
       AND NOT EXISTS (SELECT 1 FROM public.website_media WHERE id = v_media AND alt_text IS NOT NULL) THEN
        RAISE EXCEPTION 'Describe the picture for people who cannot see it (picture description)' USING ERRCODE = '22023';
    END IF;

    IF v_id IS NULL THEN
        SELECT count(*) INTO v_count FROM public.marketing_creatives WHERE campaign_id = c.id;
        IF v_count >= 20 THEN RAISE EXCEPTION 'A campaign can have up to 20 creatives' USING ERRCODE = '22023'; END IF;
        INSERT INTO public.marketing_creatives (campaign_id, business_id, placement, format, position)
        VALUES (c.id, c.business_id, v_placement, v_format, v_count)
        RETURNING id INTO v_id;
        PERFORM public.fn_mkt_log(c.id, c.business_id, 'creative_added', v_placement);
    ELSE
        IF NOT EXISTS (SELECT 1 FROM public.marketing_creatives WHERE id = v_id AND campaign_id = c.id) THEN
            RAISE EXCEPTION 'Creative not found' USING ERRCODE = 'P0002';
        END IF;
        PERFORM public.fn_mkt_log(c.id, c.business_id, 'creative_changed', v_placement);
    END IF;
    UPDATE public.marketing_creatives SET
        placement = v_placement, format = v_format,
        media_id = v_media, mobile_media_id = v_mobile, poster_media_id = v_poster, captions_media_id = v_captions,
        headline = NULLIF(btrim(p_creative->>'headline'), ''),
        body = NULLIF(btrim(p_creative->>'body'), ''),
        cta_label = NULLIF(btrim(p_creative->>'cta_label'), ''),
        alt_text = NULLIF(btrim(p_creative->>'alt_text'), ''),
        focal_x = NULLIF(p_creative->>'focal_x', '')::numeric,
        focal_y = NULLIF(p_creative->>'focal_y', '')::numeric,
        text_position = COALESCE(NULLIF(p_creative->>'text_position', ''), 'left'),
        autoplay_muted = COALESCE((p_creative->>'autoplay_muted')::boolean, false),
        hidden = COALESCE((p_creative->>'hidden')::boolean, false),
        position = COALESCE(NULLIF(p_creative->>'position', '')::integer, position),
        updated_at = now()
    WHERE id = v_id;
    UPDATE public.marketing_campaigns SET revision = revision + 1, updated_at = now() WHERE id = c.id;
    RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.marketing_creative_remove(p_creative_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    r public.marketing_creatives;
    c public.marketing_campaigns;
BEGIN
    SELECT * INTO r FROM public.marketing_creatives WHERE id = p_creative_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Creative not found' USING ERRCODE = 'P0002'; END IF;
    SELECT * INTO c FROM public.marketing_campaigns WHERE id = r.campaign_id FOR UPDATE;
    PERFORM public.assert_permission(c.business_id, 'marketing.manage');
    IF c.state = 'archived' THEN RAISE EXCEPTION 'Restore the campaign before changing it' USING ERRCODE = '22023'; END IF;
    -- A creative with statistics is hidden, not deleted, so the figures stay true.
    IF EXISTS (SELECT 1 FROM public.marketing_ad_daily WHERE creative_id = r.id)
       OR EXISTS (SELECT 1 FROM public.marketing_conversions WHERE creative_id = r.id) THEN
        UPDATE public.marketing_creatives SET hidden = true, updated_at = now() WHERE id = r.id;
    ELSE
        DELETE FROM public.marketing_creatives WHERE id = r.id;
    END IF;
    IF c.state IN ('live', 'paused') AND NOT EXISTS (SELECT 1 FROM public.marketing_creatives WHERE campaign_id = c.id AND NOT hidden) THEN
        RAISE EXCEPTION 'A published campaign needs at least one creative. Pause or end it instead.' USING ERRCODE = '22023';
    END IF;
    UPDATE public.marketing_campaigns SET revision = revision + 1, updated_at = now() WHERE id = c.id;
    PERFORM public.fn_mkt_log(c.id, c.business_id, 'creative_removed', r.placement);
END;
$$;

CREATE OR REPLACE FUNCTION public.marketing_placement_save(p_business_id uuid, p_placement text, p_settings jsonb)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    d jsonb := public.fn_mkt_placement(p_placement);
BEGIN
    PERFORM public.assert_permission(p_business_id, 'marketing.manage');
    IF d IS NULL THEN RAISE EXCEPTION 'Unknown placement %', p_placement USING ERRCODE = '22023'; END IF;
    -- One pop-up at a time, always.
    IF p_placement = 'popup' AND COALESCE((p_settings->>'max_items')::integer, 1) <> 1 THEN
        RAISE EXCEPTION 'Only one pop-up is ever shown at a time' USING ERRCODE = '22023';
    END IF;
    INSERT INTO public.marketing_placements AS p (business_id, placement, enabled, max_items, rotation, interval_s,
        popup_delay_s, popup_every_h, updated_by, updated_at)
    VALUES (p_business_id, p_placement,
        COALESCE((p_settings->>'enabled')::boolean, true),
        COALESCE((p_settings->>'max_items')::integer, (d->>'max_items')::integer),
        COALESCE(p_settings->>'rotation', d->>'rotation'),
        COALESCE((p_settings->>'interval_s')::integer, 7),
        COALESCE((p_settings->>'popup_delay_s')::integer, 8),
        COALESCE((p_settings->>'popup_every_h')::integer, 24),
        auth.uid(), now())
    ON CONFLICT (business_id, placement) DO UPDATE SET
        enabled = EXCLUDED.enabled, max_items = EXCLUDED.max_items, rotation = EXCLUDED.rotation,
        interval_s = EXCLUDED.interval_s, popup_delay_s = EXCLUDED.popup_delay_s, popup_every_h = EXCLUDED.popup_every_h,
        updated_by = EXCLUDED.updated_by, updated_at = now();
END;
$$;

-- The placements of a shop, defaults filled in.
CREATE OR REPLACE FUNCTION public.fn_mkt_placements(p_business_id uuid)
RETURNS jsonb
LANGUAGE sql STABLE
SET search_path = ''
AS $$
    SELECT jsonb_object_agg(k, jsonb_build_object(
        'enabled', COALESCE(p.enabled, true),
        'maxItems', COALESCE(p.max_items, (public.fn_mkt_placement(k)->>'max_items')::integer),
        'rotation', COALESCE(p.rotation, public.fn_mkt_placement(k)->>'rotation'),
        'intervalS', COALESCE(p.interval_s, 7),
        'popupDelayS', COALESCE(p.popup_delay_s, 8),
        'popupEveryH', COALESCE(p.popup_every_h, 24)))
    FROM unnest(ARRAY['hero', 'announcement', 'card', 'product', 'video', 'popup', 'category', 'landing']) k
    LEFT JOIN public.marketing_placements p ON p.business_id = p_business_id AND p.placement = k;
$$;

-- ============================================================================================
-- 6. Reports for the Marketing screens (real figures only)
-- ============================================================================================
CREATE OR REPLACE FUNCTION public.marketing_overview(p_business_id uuid, p_days integer DEFAULT 30)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_from date := (now() AT TIME ZONE COALESCE((SELECT timezone FROM public.businesses WHERE id = p_business_id), 'Africa/Nairobi'))::date
                   - (LEAST(GREATEST(p_days, 1), 366) - 1);
BEGIN
    PERFORM public.assert_permission(p_business_id, 'marketing.view', 'marketing.manage');
    RETURN jsonb_build_object(
        'timezone', (SELECT timezone FROM public.businesses WHERE id = p_business_id),
        'counts', (SELECT COALESCE(jsonb_object_agg(s, n), '{}') FROM (
            SELECT public.fn_mkt_status(state, starts_at, ends_at) s, count(*) n
            FROM public.marketing_campaigns WHERE business_id = p_business_id GROUP BY 1) x),
        'totals', (SELECT jsonb_build_object('loads', COALESCE(sum(loads), 0), 'views', COALESCE(sum(views), 0),
                    'clicks', COALESCE(sum(clicks), 0), 'conversions', COALESCE(sum(conversions), 0))
                   FROM public.marketing_ad_daily WHERE business_id = p_business_id AND day >= v_from),
        'orderValue', (SELECT COALESCE(sum(o.total), 0) FROM public.marketing_conversions mc
                       JOIN public.online_orders o ON o.id = mc.order_id
                       WHERE mc.business_id = p_business_id AND mc.at >= v_from
                         AND o.status NOT IN ('cancelled', 'pending_payment', 'payment_failed')),
        'byDay', (SELECT COALESCE(jsonb_agg(jsonb_build_object('day', day, 'views', v, 'clicks', cl) ORDER BY day), '[]')
                  FROM (SELECT day, sum(views) v, sum(clicks) cl FROM public.marketing_ad_daily
                        WHERE business_id = p_business_id AND day >= v_from GROUP BY day) d),
        'from', v_from);
END;
$$;

CREATE OR REPLACE FUNCTION public.marketing_campaign_report(p_campaign_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    c public.marketing_campaigns;
BEGIN
    SELECT * INTO c FROM public.marketing_campaigns WHERE id = p_campaign_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Campaign not found' USING ERRCODE = 'P0002'; END IF;
    PERFORM public.assert_permission(c.business_id, 'marketing.view', 'marketing.manage');
    RETURN jsonb_build_object(
        'byCreative', (SELECT COALESCE(jsonb_agg(jsonb_build_object('creativeId', r.id, 'placement', r.placement,
                        'format', r.format, 'headline', r.headline, 'hidden', r.hidden,
                        'loads', COALESCE(s.loads, 0), 'views', COALESCE(s.views, 0), 'clicks', COALESCE(s.clicks, 0),
                        'conversions', COALESCE(s.conv, 0)) ORDER BY r.position), '[]')
                       FROM public.marketing_creatives r
                       LEFT JOIN (SELECT creative_id, sum(loads) loads, sum(views) views, sum(clicks) clicks, sum(conversions) conv
                                  FROM public.marketing_ad_daily WHERE campaign_id = c.id GROUP BY creative_id) s ON s.creative_id = r.id
                       WHERE r.campaign_id = c.id),
        'byDay', (SELECT COALESCE(jsonb_agg(jsonb_build_object('day', day, 'loads', l, 'views', v, 'clicks', cl, 'conversions', cv) ORDER BY day), '[]')
                  FROM (SELECT day, sum(loads) l, sum(views) v, sum(clicks) cl, sum(conversions) cv
                        FROM public.marketing_ad_daily WHERE campaign_id = c.id GROUP BY day) d),
        'orders', (SELECT jsonb_build_object('count', count(*), 'value', COALESCE(sum(o.total), 0))
                   FROM public.marketing_conversions mc JOIN public.online_orders o ON o.id = mc.order_id
                   WHERE mc.campaign_id = c.id AND o.status NOT IN ('cancelled', 'pending_payment', 'payment_failed')),
        'problems', to_jsonb(public.fn_mkt_campaign_problems(c.id)));
END;
$$;

-- ============================================================================================
-- 7. The public website
-- ============================================================================================
-- One campaign as the website receives it (no draft fields, only visible creatives).
CREATE OR REPLACE FUNCTION public.fn_mkt_public_campaign(p_campaign_id uuid)
RETURNS jsonb
LANGUAGE sql STABLE
SET search_path = ''
AS $$
    SELECT jsonb_build_object(
                'id', c.id, 'name', c.name, 'type', c.campaign_type, 'priority', c.priority,
                'startsAt', c.starts_at, 'endsAt', c.ends_at, 'tone', c.tone,
                'ctaLabel', c.cta_label, 'ctaKind', c.cta_kind, 'ctaTarget', c.cta_target,
                'discount', c.discount_label,
                'promoCode', (SELECT pc.code FROM public.website_promo_codes pc WHERE pc.id = c.promotion_id AND pc.active),
                'products', to_jsonb(c.target_product_ids), 'category', c.target_category,
                'landing', c.landing_slug, 'description', c.description,
                'creatives', (
                    SELECT COALESCE(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
                        'id', r.id, 'placement', r.placement, 'format', r.format,
                        'headline', r.headline, 'body', r.body, 'ctaLabel', r.cta_label,
                        'alt', COALESCE(r.alt_text, m.alt_text), 'textPosition', r.text_position,
                        'autoplay', r.autoplay_muted,
                        'media', CASE WHEN m.id IS NOT NULL THEN jsonb_build_object('url', m.url, 'kind', m.kind, 'w', m.width, 'h', m.height,
                            'fx', COALESCE(r.focal_x, m.focal_x), 'fy', COALESCE(r.focal_y, m.focal_y), 'type', m.mime_type) END,
                        'mobile', CASE WHEN mm.id IS NOT NULL THEN jsonb_build_object('url', mm.url, 'kind', mm.kind, 'w', mm.width, 'h', mm.height,
                            'fx', mm.focal_x, 'fy', mm.focal_y, 'type', mm.mime_type) END,
                        'poster', CASE WHEN pm.id IS NOT NULL THEN jsonb_build_object('url', pm.url, 'w', pm.width, 'h', pm.height) END,
                        'captions', cm.url)) ORDER BY r.position), '[]')
                    FROM public.marketing_creatives r
                    LEFT JOIN public.website_media m ON m.id = r.media_id
                    LEFT JOIN public.website_media mm ON mm.id = r.mobile_media_id
                    LEFT JOIN public.website_media pm ON pm.id = r.poster_media_id
                    LEFT JOIN public.website_media cm ON cm.id = r.captions_media_id
                    WHERE r.campaign_id = c.id AND NOT r.hidden
                      AND (r.media_id IS NULL OR m.id IS NOT NULL)))
    FROM public.marketing_campaigns c WHERE c.id = p_campaign_id;
$$;

-- What a shop's website shows right now: active campaigns with their creatives, the placement
-- settings, and when the answer next changes (so caches never outlive a start or an end).
CREATE OR REPLACE FUNCTION public.get_public_campaigns(p_slug text)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_id uuid;
    v_now timestamptz := now();
    v_next timestamptz;
BEGIN
    SELECT b.id INTO v_id FROM public.businesses b
    WHERE b.website_slug = lower(trim(p_slug)) AND b.deleted_at IS NULL;
    IF NOT FOUND OR NOT (public.fn_website_shop(v_id)->>'open')::boolean THEN
        RETURN NULL;
    END IF;
    SELECT min(t) INTO v_next FROM (
        SELECT starts_at t FROM public.marketing_campaigns WHERE business_id = v_id AND state = 'live' AND starts_at > v_now
        UNION ALL
        SELECT ends_at FROM public.marketing_campaigns WHERE business_id = v_id AND state IN ('live', 'paused') AND ends_at > v_now) x;
    RETURN jsonb_build_object(
        'now', v_now,
        'refreshAt', v_next,
        'placements', public.fn_mkt_placements(v_id),
        'campaigns', COALESCE((
            SELECT jsonb_agg(public.fn_mkt_public_campaign(c.id) ORDER BY c.priority DESC, c.starts_at DESC)
            FROM public.marketing_campaigns c
            WHERE c.business_id = v_id AND public.fn_mkt_status(c.state, c.starts_at, c.ends_at, v_now) = 'active'), '[]'));
END;
$$;

-- The website reports what visitors saw: [{c: creative id, k: load|view|click}], max 40 per call.
-- Each (visit, creative, kind, day) counts once. Creatives not showing on this shop now are ignored.
CREATE OR REPLACE FUNCTION public.track_ad_events(p_slug text, p_visit text, p_events jsonb)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_id uuid;
    v_tz text;
    v_day date;
    e jsonb;
    r record;
    v_new integer;
    v_counted integer := 0;
BEGIN
    IF p_visit IS NULL OR p_visit !~ '^[A-Za-z0-9_-]{16,64}$' OR jsonb_typeof(p_events) <> 'array'
       OR jsonb_array_length(p_events) > 40 THEN
        RETURN 0;
    END IF;
    SELECT b.id, b.timezone INTO v_id, v_tz FROM public.businesses b
    WHERE b.website_slug = lower(trim(p_slug)) AND b.deleted_at IS NULL;
    IF NOT FOUND THEN RETURN 0; END IF;
    IF NOT public.check_rate_limit('adtrack:' || public.request_ip(), 600, 600) THEN
        RETURN 0;
    END IF;
    v_day := (now() AT TIME ZONE COALESCE(v_tz, 'Africa/Nairobi'))::date;
    FOR e IN SELECT * FROM jsonb_array_elements(p_events) LOOP
        CONTINUE WHEN jsonb_typeof(e) <> 'object' OR COALESCE(e->>'k', '') NOT IN ('load', 'view', 'click')
            OR COALESCE(e->>'c', '') !~ '^[0-9a-f-]{36}$';
        SELECT r2.id, r2.campaign_id INTO r FROM public.marketing_creatives r2
        JOIN public.marketing_campaigns c ON c.id = r2.campaign_id
        WHERE r2.id = (e->>'c')::uuid AND r2.business_id = v_id AND NOT r2.hidden
          AND public.fn_mkt_status(c.state, c.starts_at, c.ends_at) = 'active';
        CONTINUE WHEN NOT FOUND;
        INSERT INTO public.marketing_ad_seen (visit, creative_id, kind, day)
        VALUES (p_visit, r.id, e->>'k', v_day) ON CONFLICT DO NOTHING;
        GET DIAGNOSTICS v_new = ROW_COUNT;
        CONTINUE WHEN v_new = 0;
        INSERT INTO public.marketing_ad_daily AS d (creative_id, day, business_id, campaign_id, loads, views, clicks)
        VALUES (r.id, v_day, v_id, r.campaign_id,
            (e->>'k' = 'load')::int, (e->>'k' = 'view')::int, (e->>'k' = 'click')::int)
        ON CONFLICT (creative_id, day) DO UPDATE SET
            loads = d.loads + EXCLUDED.loads, views = d.views + EXCLUDED.views, clicks = d.clicks + EXCLUDED.clicks;
        v_counted := v_counted + 1;
    END LOOP;
    RETURN v_counted;
END;
$$;

-- After placing an order, the website says which visit it came from. The order must be the
-- signed-in customer's own, at this shop, under an hour old, and that visit must have clicked an
-- advert of this shop in the last 24 hours. One advert per order.
CREATE OR REPLACE FUNCTION public.track_ad_conversion(p_slug text, p_visit text, p_order_id uuid)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_id uuid;
    v_tz text;
    o public.online_orders;
    s record;
BEGIN
    IF auth.uid() IS NULL OR p_visit IS NULL OR p_visit !~ '^[A-Za-z0-9_-]{16,64}$' THEN
        RETURN false;
    END IF;
    SELECT b.id, b.timezone INTO v_id, v_tz FROM public.businesses b
    WHERE b.website_slug = lower(trim(p_slug)) AND b.deleted_at IS NULL;
    IF NOT FOUND THEN RETURN false; END IF;
    SELECT * INTO o FROM public.online_orders
    WHERE id = p_order_id AND business_id = v_id AND account_id = auth.uid() AND created_at > now() - interval '1 hour';
    IF NOT FOUND THEN RETURN false; END IF;
    SELECT x.creative_id, r.campaign_id INTO s FROM public.marketing_ad_seen x
    JOIN public.marketing_creatives r ON r.id = x.creative_id AND r.business_id = v_id
    WHERE x.visit = p_visit AND x.kind = 'click' AND x.at > now() - interval '24 hours' AND x.at <= o.created_at
    ORDER BY x.at DESC LIMIT 1;
    IF NOT FOUND THEN RETURN false; END IF;
    INSERT INTO public.marketing_conversions (order_id, business_id, campaign_id, creative_id)
    VALUES (o.id, v_id, s.campaign_id, s.creative_id) ON CONFLICT DO NOTHING;
    IF NOT FOUND THEN RETURN false; END IF;
    INSERT INTO public.marketing_ad_daily AS d (creative_id, day, business_id, campaign_id, conversions)
    VALUES (s.creative_id, (now() AT TIME ZONE COALESCE(v_tz, 'Africa/Nairobi'))::date, v_id, s.campaign_id, 1)
    ON CONFLICT (creative_id, day) DO UPDATE SET conversions = d.conversions + 1;
    RETURN true;
END;
$$;

-- Preview on the real website: a link valid two hours that shows one campaign as if it were
-- running (draft, scheduled or paused alike), on top of what is live. The secret is kept only as a
-- SHA-256 hash, names the shop and the campaign, and the website counts nothing while previewing.
CREATE TABLE IF NOT EXISTS public.marketing_preview_links (
    secret_hash bytea PRIMARY KEY,
    business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    campaign_id uuid NOT NULL REFERENCES public.marketing_campaigns(id) ON DELETE CASCADE,
    created_by uuid,
    expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_marketing_preview_links_business ON public.marketing_preview_links (business_id);

CREATE OR REPLACE FUNCTION public.marketing_preview_link(p_campaign_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    c public.marketing_campaigns;
    v_secret text := encode(extensions.gen_random_bytes(24), 'hex');
    v_expires timestamptz := now() + interval '2 hours';
BEGIN
    SELECT * INTO c FROM public.marketing_campaigns WHERE id = p_campaign_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Campaign not found' USING ERRCODE = 'P0002'; END IF;
    PERFORM public.assert_permission(c.business_id, 'marketing.view', 'marketing.manage');
    IF (SELECT website_slug FROM public.businesses WHERE id = c.business_id) IS NULL THEN
        RAISE EXCEPTION 'Give the shop a web address first (Website > Address & publishing)' USING ERRCODE = '22023';
    END IF;
    DELETE FROM public.marketing_preview_links WHERE business_id = c.business_id AND expires_at < now();
    DELETE FROM public.marketing_preview_links WHERE secret_hash IN (
        SELECT secret_hash FROM public.marketing_preview_links WHERE business_id = c.business_id
        ORDER BY expires_at DESC OFFSET 19);
    INSERT INTO public.marketing_preview_links (secret_hash, business_id, campaign_id, created_by, expires_at)
    VALUES (extensions.digest(v_secret, 'sha256'), c.business_id, c.id, auth.uid(), v_expires);
    RETURN jsonb_build_object('secret', v_secret, 'expiresAt', v_expires,
        'slug', (SELECT website_slug FROM public.businesses WHERE id = c.business_id),
        'host', public.fn_website_home_host(c.business_id),
        'landing', c.landing_slug);
END;
$$;

-- The adverts for a preview link: the live ones plus the previewed campaign as if showing now.
CREATE OR REPLACE FUNCTION public.get_preview_campaigns(p_slug text, p_secret text)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    l public.marketing_preview_links;
    v_live jsonb;
    v_one jsonb;
    c public.marketing_campaigns;
BEGIN
    IF p_secret IS NULL OR p_secret !~ '^[0-9a-f]{48}$' THEN RETURN NULL; END IF;
    SELECT pl.* INTO l FROM public.marketing_preview_links pl
    JOIN public.businesses b ON b.id = pl.business_id
    WHERE pl.secret_hash = extensions.digest(p_secret, 'sha256') AND pl.expires_at > now()
      AND b.deleted_at IS NULL AND b.website_slug = lower(trim(p_slug));
    IF NOT FOUND THEN RETURN NULL; END IF;
    SELECT * INTO c FROM public.marketing_campaigns WHERE id = l.campaign_id AND state <> 'archived';
    IF NOT FOUND THEN RETURN NULL; END IF;
    -- Build the live answer, then put the previewed campaign in with times that make it show.
    v_live := COALESCE(public.get_public_campaigns(p_slug),
        jsonb_build_object('now', now(), 'refreshAt', NULL, 'placements', public.fn_mkt_placements(l.business_id), 'campaigns', '[]'::jsonb));
    v_one := public.fn_mkt_public_campaign(c.id);
    RETURN v_live || jsonb_build_object(
        'refreshAt', NULL,
        'preview', c.id,
        'campaigns', (SELECT COALESCE(jsonb_agg(x), '[]') FROM jsonb_array_elements(v_live->'campaigns') x WHERE x->>'id' <> c.id::text)
                     || jsonb_build_array(v_one || jsonb_build_object('startsAt', now() - interval '1 minute', 'endsAt', NULL, 'priority', 101)));
END;
$$;

-- ============================================================================================
-- 8. Job: history entries for starts and ends; old de-duplication keys removed
-- ============================================================================================
CREATE OR REPLACE FUNCTION public.run_marketing_jobs()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_started integer;
    v_finished integer;
    v_purged integer;
BEGIN
    WITH s AS (
        UPDATE public.marketing_campaigns SET started_logged_at = now()
        WHERE state = 'live' AND started_logged_at IS NULL AND starts_at <= now() AND (ends_at IS NULL OR ends_at > now())
        RETURNING id, business_id)
    INSERT INTO public.marketing_campaign_events (campaign_id, business_id, event, note)
    SELECT id, business_id, 'started', 'Started showing on the website' FROM s;
    GET DIAGNOSTICS v_started = ROW_COUNT;
    WITH f AS (
        UPDATE public.marketing_campaigns SET ended_logged_at = now()
        WHERE state IN ('live', 'paused') AND ended_logged_at IS NULL AND ends_at <= now()
        RETURNING id, business_id)
    INSERT INTO public.marketing_campaign_events (campaign_id, business_id, event, note)
    SELECT id, business_id, 'finished', 'Reached its end date and stopped showing' FROM f;
    GET DIAGNOSTICS v_finished = ROW_COUNT;
    DELETE FROM public.marketing_ad_seen WHERE at < now() - interval '3 days';
    GET DIAGNOSTICS v_purged = ROW_COUNT;
    DELETE FROM public.canva_oauth_states WHERE created_at < now() - interval '1 hour';
    RETURN jsonb_build_object('started', v_started, 'finished', v_finished, 'purged', v_purged);
END;
$$;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
        PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'marketing-jobs';
        PERFORM cron.schedule('marketing-jobs', '*/5 * * * *', $job$SELECT public.run_marketing_jobs()$job$);
    END IF;
END;
$$;

-- ============================================================================================
-- 9. Permissions, plan module, row security, grants
-- ============================================================================================
INSERT INTO public.module_permissions (pattern, module) VALUES ('marketing.%', 'online_store')
ON CONFLICT (pattern) DO UPDATE SET module = EXCLUDED.module;

-- Manager: as 20261126002, plus marketing.view and marketing.manage.
INSERT INTO public.role_default_permissions (role, permissions) VALUES
    ('Manager', ARRAY['accounting.view', 'ai.insights', 'ai.use', 'assets.view', 'bom.create', 'bom.update', 'bom.view', 'business.switch', 'business.view', 'communication.send', 'communication.view', 'complaints.reply', 'complaints.view', 'customers.create', 'customers.debts', 'customers.loyalty', 'customers.manage', 'customers.schedules', 'customers.update', 'customers.view', 'dashboard.view', 'deliveries.assign', 'deliveries.cancel', 'deliveries.complete', 'deliveries.create', 'deliveries.view', 'expenses.create', 'expenses.update', 'expenses.view', 'files.view', 'finance.view', 'home.view', 'inventory.adjust_stock', 'inventory.expiry', 'inventory.receive_stock', 'inventory.request_transfer', 'inventory.stock_count', 'inventory.stock_history', 'inventory.transfer_stock', 'inventory.view', 'inventory.wastage', 'invoices.manage', 'invoices.view', 'loyalty.adjust', 'marketing.manage', 'marketing.view', 'notifications.send', 'notifications.view', 'online_store.view', 'orders.assign_rider', 'orders.complete', 'orders.create', 'orders.update', 'orders.view', 'payments.card', 'payments.cash', 'payments.verify', 'payments.view', 'pettycash.record', 'pos.apply_promotion', 'pos.close_shift', 'pos.create_sale', 'pos.open_shift', 'pos.walkin_customer', 'production.approve', 'production.create', 'production.update', 'production.view', 'products.create', 'products.export', 'products.import', 'products.manage_categories', 'products.update', 'products.view', 'promotions.manage', 'promotions.view', 'referrals.manage', 'referrals.view', 'purchases.approve', 'purchases.create', 'purchases.export', 'purchases.print', 'purchases.request_quote', 'purchases.update', 'purchases.view', 'quotes.manage', 'quotes.view', 'refunds.create', 'reports.customers', 'reports.deliveries', 'reports.inventory', 'reports.profit', 'reports.sales', 'reports.view', 'sales_orders.manage', 'sales_orders.view', 'settings.tax', 'settings.theme', 'settings.update', 'settings.view', 'staff.schedule', 'staff.view', 'supplier_bills.manage', 'suppliers.create', 'suppliers.export', 'suppliers.import', 'suppliers.update', 'suppliers.view'])
ON CONFLICT (role) DO UPDATE SET permissions = EXCLUDED.permissions;

ALTER TABLE public.website_media ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marketing_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marketing_creatives ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marketing_placements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marketing_campaign_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marketing_ad_daily ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marketing_ad_seen ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marketing_conversions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.canva_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.canva_oauth_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marketing_preview_links ENABLE ROW LEVEL SECURITY;

-- A shop on a read-only plan changes nothing here either (20261204001 section 6). Visitor
-- statistics (marketing_ad_daily, marketing_conversions) and Canva sign-in states are housekeeping
-- and stay writable, like website_visit_daily.
DO $$
DECLARE
    t text;
BEGIN
    FOREACH t IN ARRAY ARRAY['website_media', 'marketing_campaigns', 'marketing_creatives', 'marketing_placements',
                             'marketing_campaign_events', 'marketing_preview_links'] LOOP
        EXECUTE format('DROP TRIGGER IF EXISTS trg_zz_plan_read_only ON public.%I', t);
        EXECUTE format('CREATE TRIGGER trg_zz_plan_read_only BEFORE INSERT OR UPDATE OR DELETE ON public.%I
                        FOR EACH ROW EXECUTE FUNCTION public.fn_block_when_read_only()', t);
    END LOOP;
END;
$$;

-- Read only for members; every change goes through the functions above.
DROP POLICY IF EXISTS pol_website_media_select ON public.website_media;
CREATE POLICY pol_website_media_select ON public.website_media FOR SELECT TO authenticated USING (
    deleted_at IS NULL AND public.has_permission(business_id, 'marketing.view', 'marketing.manage', 'business.update'));
DROP POLICY IF EXISTS pol_marketing_campaigns_select ON public.marketing_campaigns;
CREATE POLICY pol_marketing_campaigns_select ON public.marketing_campaigns FOR SELECT TO authenticated USING (
    public.has_permission(business_id, 'marketing.view', 'marketing.manage'));
DROP POLICY IF EXISTS pol_marketing_creatives_select ON public.marketing_creatives;
CREATE POLICY pol_marketing_creatives_select ON public.marketing_creatives FOR SELECT TO authenticated USING (
    public.has_permission(business_id, 'marketing.view', 'marketing.manage'));
DROP POLICY IF EXISTS pol_marketing_placements_select ON public.marketing_placements;
CREATE POLICY pol_marketing_placements_select ON public.marketing_placements FOR SELECT TO authenticated USING (
    public.has_permission(business_id, 'marketing.view', 'marketing.manage'));
DROP POLICY IF EXISTS pol_marketing_events_select ON public.marketing_campaign_events;
CREATE POLICY pol_marketing_events_select ON public.marketing_campaign_events FOR SELECT TO authenticated USING (
    public.has_permission(business_id, 'marketing.view', 'marketing.manage'));
DROP POLICY IF EXISTS pol_marketing_ad_daily_select ON public.marketing_ad_daily;
CREATE POLICY pol_marketing_ad_daily_select ON public.marketing_ad_daily FOR SELECT TO authenticated USING (
    public.has_permission(business_id, 'marketing.view', 'marketing.manage'));
-- marketing_ad_seen, marketing_conversions, canva_*: no policy, server only.

REVOKE ALL ON public.website_media, public.marketing_campaigns, public.marketing_creatives, public.marketing_placements,
    public.marketing_campaign_events, public.marketing_ad_daily, public.marketing_ad_seen, public.marketing_conversions,
    public.canva_connections, public.canva_oauth_states, public.marketing_preview_links FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.website_media, public.marketing_campaigns, public.marketing_creatives, public.marketing_placements,
    public.marketing_campaign_events, public.marketing_ad_daily TO authenticated;
GRANT ALL ON public.website_media, public.marketing_campaigns, public.marketing_creatives, public.marketing_placements,
    public.marketing_campaign_events, public.marketing_ad_daily, public.marketing_ad_seen, public.marketing_conversions,
    public.canva_connections, public.canva_oauth_states, public.marketing_preview_links TO service_role;

DO $$
DECLARE
    f text;
BEGIN
    -- Helpers: server only.
    FOREACH f IN ARRAY ARRAY['fn_valid_timezone(text)', 'fn_business_timezone_guard()', 'fn_mkt_format(text)',
        'fn_mkt_placement(text)', 'fn_mkt_valid_href(text)', 'fn_mkt_status(text, timestamptz, timestamptz, timestamptz)',
        'fn_mkt_local_time(uuid, text)', 'fn_mkt_log(uuid, uuid, text, text)', 'fn_mkt_campaign_problems(uuid)',
        'fn_mkt_check_media(uuid, uuid, text, text)', 'fn_mkt_placements(uuid)', 'fn_mkt_public_campaign(uuid)', 'run_marketing_jobs()'] LOOP
        EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon, authenticated', f);
        EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO service_role', f);
    END LOOP;
    -- Staff: signed in; each checks the permission itself.
    FOREACH f IN ARRAY ARRAY['business_set_timezone(uuid, text)', 'website_media_register(uuid, text, jsonb)',
        'website_media_update(uuid, jsonb)', 'website_media_remove(uuid)', 'marketing_campaign_save(uuid, jsonb, integer)',
        'marketing_campaign_action(uuid, text, text)', 'marketing_campaign_duplicate(uuid)',
        'marketing_creative_save(uuid, jsonb)', 'marketing_creative_remove(uuid)',
        'marketing_placement_save(uuid, text, jsonb)', 'marketing_overview(uuid, integer)',
        'marketing_campaign_report(uuid)', 'track_ad_conversion(text, text, uuid)', 'marketing_preview_link(uuid)'] LOOP
        EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon', f);
        EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated, service_role', f);
    END LOOP;
    -- Visitors.
    FOREACH f IN ARRAY ARRAY['get_public_campaigns(text)', 'get_preview_campaigns(text, text)', 'track_ad_events(text, text, jsonb)'] LOOP
        EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC', f);
        EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO anon, authenticated, service_role', f);
    END LOOP;
END;
$$;

-- ===================================================================
-- 20261208001_website_visits_domain_recheck
-- ===================================================================
-- 20261208001_website_visits_domain_recheck.sql
-- Website engine, phase 7 (docs/roadmap/website-engine-audit.md).
--
--   * A private visit counter. The website tells the database "a page of this kind was opened,
--     the visitor came from this kind of place". Only daily totals per shop are kept: no IP, no
--     visitor id, no cookie, no full address, no device. The website stores nothing in the browser
--     for it. Rate-limited per IP address (the limiter keeps the address only for its 10-minute
--     window, as for every other public call), bots and previews are not counted.
--     A "visit" is a page opened from outside the website (or typed in); every other page opened
--     while browsing is a view. Unique visitors are not counted: that needs an identifier.
--   * Statistics read the totals (website_stats gains views, visits, where visits came from and
--     which pages are opened). Days are the shop's own days, the same for orders and visits.
--   * The counter can be pushed up on purpose by someone calling it directly, as any public
--     counter can; the per-IP limit bounds that, and the screen calls them counts, not facts
--     about people.
--   * Own web addresses are checked again every night. One that stopped working (DNS moved,
--     certificate lost) goes back to "waiting", so the shop's subdomain stops sending visitors
--     to a dead address; one that started working goes live without anybody pressing Check now.
--
-- Reverse: SELECT cron.unschedule('website-domain-recheck');
--          DROP FUNCTION record_website_view(text, text, text, boolean), website_domains_recheck();
--          DROP TABLE website_visit_daily;
--          restore website_stats from 20261206002.

-- ============================================================================================
-- 1. Daily totals
-- ============================================================================================
-- Page kinds: keep in step with VISIT_PAGES in website/src/engine/visits.ts; sources with
-- VISIT_SOURCES (src/test/websiteEngineTests.ts compares them).
CREATE TABLE IF NOT EXISTS public.website_visit_daily (
    business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    day date NOT NULL,
    page text NOT NULL CHECK (page IN ('home', 'shop', 'product', 'search', 'cart', 'checkout', 'order', 'account', 'articles', 'contact', 'info', 'campaign', 'other')),
    source text NOT NULL CHECK (source IN ('direct', 'search', 'social', 'site', 'inside')),
    views integer NOT NULL DEFAULT 0 CHECK (views >= 0),
    PRIMARY KEY (business_id, day, page, source)
);
COMMENT ON TABLE public.website_visit_daily IS
    'Pages opened on a shop''s website per day, by page kind and where the visitor came from (inside = browsing within the website). Totals only: nothing about the visitor.';
ALTER TABLE public.website_visit_daily ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS pol_website_visit_daily_select ON public.website_visit_daily;
CREATE POLICY pol_website_visit_daily_select ON public.website_visit_daily FOR SELECT TO authenticated
    USING ((SELECT public.has_permission(business_id, 'business.update')));
REVOKE ALL ON public.website_visit_daily FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.website_visit_daily TO authenticated;
GRANT ALL ON public.website_visit_daily TO service_role;

-- The shop's own day (businesses.timezone when the shop has one, else Nairobi).
CREATE OR REPLACE FUNCTION public.fn_shop_today(p_business_id uuid)
RETURNS date
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT (now() AT TIME ZONE COALESCE(
        (SELECT NULLIF(to_jsonb(b)->>'timezone', '') FROM public.businesses b WHERE b.id = p_business_id),
        'Africa/Nairobi'))::date;
$$;
REVOKE ALL ON FUNCTION public.fn_shop_today(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_shop_today(uuid) TO service_role;

-- ============================================================================================
-- 2. The website counts a page (anyone; the shop comes from its web name, as every public call)
-- ============================================================================================
-- Returns true when counted. Anything unexpected is ignored, never an error the visitor sees.
CREATE OR REPLACE FUNCTION public.record_website_view(p_slug text, p_page text, p_source text, p_landing boolean)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_id uuid;
    v_source text;
BEGIN
    IF p_page IS NULL OR p_page NOT IN ('home', 'shop', 'product', 'search', 'cart', 'checkout', 'order', 'account', 'articles', 'contact', 'info', 'campaign', 'other') THEN
        RETURN false;
    END IF;
    -- Browsing within the website is one source; where a visit came from only counts on landing.
    v_source := CASE WHEN p_landing THEN p_source ELSE 'inside' END;
    IF v_source IS NULL OR v_source NOT IN ('direct', 'search', 'social', 'site', 'inside') THEN
        RETURN false;
    END IF;
    SELECT b.id INTO v_id FROM public.businesses b
    WHERE b.website_slug = lower(trim(p_slug)) AND b.deleted_at IS NULL;
    IF NOT FOUND OR NOT (public.fn_website_shop(v_id)->>'open')::boolean THEN
        RETURN false;
    END IF;
    IF NOT public.check_rate_limit('webview:' || public.request_ip(), 300, 600) THEN
        RETURN false;
    END IF;
    INSERT INTO public.website_visit_daily AS d (business_id, day, page, source, views)
    VALUES (v_id, public.fn_shop_today(v_id), p_page, v_source, 1)
    ON CONFLICT (business_id, day, page, source) DO UPDATE SET views = d.views + 1;
    RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.record_website_view(text, text, text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_website_view(text, text, text, boolean) TO anon, authenticated, service_role;

-- ============================================================================================
-- 3. Statistics: orders (as before) plus pages opened and visits
-- ============================================================================================
CREATE OR REPLACE FUNCTION public.website_stats(p_business_id uuid, p_days integer DEFAULT 30)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_days integer := LEAST(GREATEST(COALESCE(p_days, 30), 1), 365);
    v_tz text;
    v_today date;
    v_first date;
    v_from timestamptz;
BEGIN
    IF NOT public.has_permission(p_business_id, 'business.update') THEN
        RAISE EXCEPTION 'You do not have permission to see website statistics.';
    END IF;
    SELECT COALESCE(NULLIF(to_jsonb(b)->>'timezone', ''), 'Africa/Nairobi') INTO v_tz
    FROM public.businesses b WHERE b.id = p_business_id;
    v_today := (now() AT TIME ZONE v_tz)::date;
    v_first := v_today - (v_days - 1);
    v_from := v_first::timestamp AT TIME ZONE v_tz;
    RETURN jsonb_build_object(
        'days', v_days,
        'orders', (SELECT count(*) FROM public.online_orders WHERE business_id = p_business_id AND created_at >= v_from),
        'paidOrders', (SELECT count(*) FROM public.online_orders WHERE business_id = p_business_id AND created_at >= v_from AND paid_at IS NOT NULL),
        'revenue', (SELECT COALESCE(sum(total), 0)::numeric(14,2) FROM public.online_orders WHERE business_id = p_business_id AND created_at >= v_from AND paid_at IS NOT NULL),
        'views', (SELECT COALESCE(sum(views), 0) FROM public.website_visit_daily WHERE business_id = p_business_id AND day >= v_first),
        'visits', (SELECT COALESCE(sum(views), 0) FROM public.website_visit_daily WHERE business_id = p_business_id AND day >= v_first AND source <> 'inside'),
        'byDay', COALESCE((
            SELECT jsonb_agg(jsonb_build_object('day', g.day, 'orders', COALESCE(o.orders, 0), 'revenue', COALESCE(o.revenue, 0), 'visits', COALESCE(v.visits, 0)) ORDER BY g.day)
            FROM generate_series(v_first, v_today, interval '1 day') g(day)
            LEFT JOIN (
                SELECT (o.created_at AT TIME ZONE v_tz)::date AS day,
                       count(*) AS orders,
                       COALESCE(sum(o.total) FILTER (WHERE o.paid_at IS NOT NULL), 0)::numeric(14,2) AS revenue
                FROM public.online_orders o
                WHERE o.business_id = p_business_id AND o.created_at >= v_from
                GROUP BY 1) o ON o.day = g.day::date
            LEFT JOIN (
                SELECT d.day, sum(d.views) AS visits
                FROM public.website_visit_daily d
                WHERE d.business_id = p_business_id AND d.day >= v_first AND d.source <> 'inside'
                GROUP BY d.day) v ON v.day = g.day::date), '[]'::jsonb),
        'sources', COALESCE((
            SELECT jsonb_agg(jsonb_build_object('source', s.source, 'visits', s.visits) ORDER BY s.visits DESC, s.source)
            FROM (SELECT source, sum(views) AS visits FROM public.website_visit_daily
                  WHERE business_id = p_business_id AND day >= v_first AND source <> 'inside'
                  GROUP BY source) s), '[]'::jsonb),
        'pages', COALESCE((
            SELECT jsonb_agg(jsonb_build_object('page', p.page, 'views', p.views) ORDER BY p.views DESC, p.page)
            FROM (SELECT page, sum(views) AS views FROM public.website_visit_daily
                  WHERE business_id = p_business_id AND day >= v_first
                  GROUP BY page) p), '[]'::jsonb),
        'topProducts', COALESCE((
            SELECT jsonb_agg(jsonb_build_object('name', t.name, 'quantity', t.quantity) ORDER BY t.quantity DESC, t.name)
            FROM (
                SELECT i.product_name AS name, round(sum(i.quantity), 1) AS quantity
                FROM public.online_order_items i
                JOIN public.online_orders o ON o.id = i.order_id
                WHERE o.business_id = p_business_id AND o.created_at >= v_from AND o.paid_at IS NOT NULL
                GROUP BY i.product_name
                ORDER BY sum(i.quantity) DESC, i.product_name
                LIMIT 5) t), '[]'::jsonb),
        'visitsCounted', TRUE,
        'countingSince', (SELECT min(day) FROM public.website_visit_daily WHERE business_id = p_business_id));
END;
$$;
REVOKE ALL ON FUNCTION public.website_stats(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.website_stats(uuid, integer) TO authenticated, service_role;

-- ============================================================================================
-- 4. Own web addresses checked every night (website-domain, action recheck_all)
-- ============================================================================================
CREATE OR REPLACE FUNCTION public.website_domains_recheck()
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_url text;
    v_key text;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM public.website_domains WHERE cf_hostname_id IS NOT NULL) THEN
        RETURN;
    END IF;
    SELECT decrypted_secret INTO v_url FROM vault.decrypted_secrets WHERE name = 'project_url';
    SELECT decrypted_secret INTO v_key FROM vault.decrypted_secrets WHERE name = 'service_role_key';
    IF v_url IS NULL OR v_key IS NULL THEN
        RAISE WARNING 'website_domains_recheck: Vault secrets project_url and service_role_key are not set; addresses not checked.';
        RETURN;
    END IF;
    PERFORM net.http_post(
        url := rtrim(v_url, '/') || '/functions/v1/website-domain',
        headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_key),
        body := jsonb_build_object('action', 'recheck_all'),
        timeout_milliseconds := 60000);
END;
$$;
REVOKE ALL ON FUNCTION public.website_domains_recheck() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.website_domains_recheck() TO service_role;

DO $do$ BEGIN
    IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
        PERFORM cron.schedule('website-domain-recheck', '20 3 * * *', $job$SELECT public.website_domains_recheck()$job$);
    END IF;
END $do$;

-- ===================================================================
-- 20261209001_customer_phone_helper_grant
-- ===================================================================
-- Nobody could add a customer from the app (the Owner too): the customers trigger
-- fn_customer_standard -> fn_normalize_phone -> fn_normalize_ke_phone, and
-- 20261201001 left fn_normalize_ke_phone to service_role only, so every app insert
-- failed with "permission denied for function fn_normalize_ke_phone".
-- It only tidies a phone number (no table access), so signed-in users may run it.
GRANT EXECUTE ON FUNCTION public.fn_normalize_ke_phone(text) TO authenticated;

-- ===================================================================
-- 20261209002_platform_domain_unique_names
-- ===================================================================
-- Platform domain interlockingblockbuilders.co.ke, and no two businesses with look-alike names.
--   * Shops:  <website name>.interlockingblockbuilders.co.ke   (resolve_website_host, 20261204004)
--   * App:    <website name>-app.interlockingblockbuilders.co.ke (app locks to that business,
--             src/utils/tenantHost.ts; RLS still decides access)
--   * Names:  "Acme Ltd", "ACME limited" and "A.C.M.E" are the same name: the second is refused.
--             Website names "acme-shop" and "acmeshop" are the same name too.

UPDATE public.platform_settings SET
    platform_domain = 'interlockingblockbuilders.co.ke',
    app_url = 'https://app.interlockingblockbuilders.co.ke'
WHERE id;

-- "The ACME Enterprises Ltd." -> "acme"
CREATE OR REPLACE FUNCTION public.fn_business_name_key(p_name text)
RETURNS text
LANGUAGE sql IMMUTABLE
SET search_path = ''
AS $$
    SELECT regexp_replace(
        regexp_replace(
            ' ' || regexp_replace(lower(COALESCE(p_name, '')), '[^a-z0-9]+', ' ', 'g') || ' ',
            ' (the|ltd|limited|co|company|enterprises?|inc|plc|llc|group|kenya|ke|and|shop|store|stores) ', ' ', 'g'),
        '[^a-z0-9]', '', 'g');
$$;
REVOKE ALL ON FUNCTION public.fn_business_name_key(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_business_name_key(text) TO authenticated, service_role;

-- One registered business (tenant) per name.
CREATE OR REPLACE FUNCTION public.fn_tenant_name_unique()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE v_key text := public.fn_business_name_key(NEW.name);
BEGIN
    IF TG_OP = 'UPDATE' AND public.fn_business_name_key(OLD.name) = v_key THEN RETURN NEW; END IF;
    IF length(v_key) < 2 THEN
        RAISE EXCEPTION 'Please give the business a fuller name.';
    END IF;
    PERFORM pg_advisory_xact_lock(hashtext('tenant_name:' || v_key));
    IF EXISTS (SELECT 1 FROM public.tenants t
               WHERE t.id <> NEW.id AND public.fn_business_name_key(t.name) = v_key) THEN
        RAISE EXCEPTION 'A business with this name (or one very like it) is already registered. Please choose another name.';
    END IF;
    RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.fn_tenant_name_unique() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_tenant_name_unique ON public.tenants;
CREATE TRIGGER trg_tenant_name_unique BEFORE INSERT OR UPDATE OF name ON public.tenants
    FOR EACH ROW EXECUTE FUNCTION public.fn_tenant_name_unique();

-- Businesses of different tenants may not share a look-alike name or website name either
-- (branches of the same tenant may).
CREATE OR REPLACE FUNCTION public.fn_business_name_unique()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE v_key text := public.fn_business_name_key(NEW.name);
BEGIN
    IF NEW.deleted_at IS NOT NULL THEN RETURN NEW; END IF;
    PERFORM pg_advisory_xact_lock(hashtext('business_name:' || v_key));
    IF EXISTS (SELECT 1 FROM public.businesses b
               WHERE b.id <> NEW.id AND b.deleted_at IS NULL
                 AND b.tenant_id IS DISTINCT FROM NEW.tenant_id
                 AND public.fn_business_name_key(b.name) = v_key) THEN
        RAISE EXCEPTION 'A business with this name (or one very like it) is already registered. Please choose another name.';
    END IF;
    IF NEW.website_slug IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.businesses b
        WHERE b.id <> NEW.id AND b.website_slug IS NOT NULL
          AND replace(b.website_slug, '-', '') = replace(NEW.website_slug, '-', '')) THEN
        RAISE EXCEPTION 'That website name is too like another shop''s. Please choose another.';
    END IF;
    RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.fn_business_name_unique() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_business_name_unique ON public.businesses;
CREATE TRIGGER trg_business_name_unique BEFORE INSERT OR UPDATE OF name, website_slug, tenant_id, deleted_at
    ON public.businesses FOR EACH ROW EXECUTE FUNCTION public.fn_business_name_unique();

-- Lets the sign-up screen say "taken" before submitting.
CREATE OR REPLACE FUNCTION public.business_name_available(p_name text)
RETURNS boolean
LANGUAGE sql STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT length(public.fn_business_name_key(p_name)) >= 2
       AND NOT EXISTS (SELECT 1 FROM public.tenants t
                       WHERE public.fn_business_name_key(t.name) = public.fn_business_name_key(p_name));
$$;
REVOKE ALL ON FUNCTION public.business_name_available(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.business_name_available(text) TO authenticated, service_role;

-- <name>-app.<domain> is a business's staff app, so no website name may end in "-app"
-- (website/worker/hosts.ts isAppHost). Same list as 20261204004, plus that rule.
CREATE OR REPLACE FUNCTION public.fn_reserved_website_slug(p_slug text)
RETURNS boolean
LANGUAGE sql IMMUTABLE
SET search_path = ''
AS $$
    SELECT p_slug LIKE '%-app' OR p_slug = ANY (ARRAY[
        'www', 'app', 'apps', 'admin', 'api', 'auth', 'login', 'signup', 'account', 'accounts',
        'mail', 'email', 'smtp', 'imap', 'pop', 'ftp', 'ns1', 'ns2', 'dns', 'mx',
        'help', 'support', 'status', 'docs', 'blog', 'news', 'about', 'pricing', 'terms', 'privacy',
        'cdn', 'static', 'assets', 'media', 'files', 'img', 'images', 'customers', 'customer',
        'dev', 'staging', 'test', 'preview', 'demo', 'internal', 'platform', 'billing', 'pay', 'payments',
        'webhook', 'webhooks', 'shop', 'store', 'stores', 'my', 'dashboard', 'console', 'root']);
$$;
REVOKE ALL ON FUNCTION public.fn_reserved_website_slug(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_reserved_website_slug(text) TO service_role;

-- ===================================================================
-- 20261210001_first_user_claims_platform_admin
-- ===================================================================
-- First person to sign up is offered the platform admin role, once.
-- * platform_admin_claimable(): true only while there is no platform admin at all.
-- * claim_platform_admin(name): the caller becomes the first admin; refused once anyone is.
-- * Locked after that: the app can never add, change or remove admins (no grants), and a
--   trigger refuses changing an admin's account or removing the last admin, even by SQL.
--   More admins are still added by SQL (service role) only.

CREATE OR REPLACE FUNCTION public.platform_admin_claimable()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $$ SELECT auth.uid() IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.platform_admins); $$;
REVOKE ALL ON FUNCTION public.platform_admin_claimable() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.platform_admin_claimable() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.claim_platform_admin(p_name text DEFAULT NULL)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_uid uuid := auth.uid();
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'Sign in first' USING ERRCODE = '42501';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM auth.users au WHERE au.id = v_uid AND au.email_confirmed_at IS NOT NULL) THEN
        RAISE EXCEPTION 'Verify your email first' USING ERRCODE = '42501';
    END IF;
    -- One claim at a time, so two first sign-ups can't both win.
    PERFORM pg_advisory_xact_lock(hashtext('claim_platform_admin'));
    IF EXISTS (SELECT 1 FROM public.platform_admins) THEN
        RAISE EXCEPTION 'The platform admin is already set' USING ERRCODE = '42501';
    END IF;
    INSERT INTO public.platform_admins (auth_user_id, name)
    VALUES (v_uid, NULLIF(btrim(coalesce(p_name, '')), ''));
    RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.claim_platform_admin(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.claim_platform_admin(text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.fn_platform_admins_lock()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
    IF TG_OP = 'UPDATE' AND NEW.auth_user_id IS DISTINCT FROM OLD.auth_user_id THEN
        RAISE EXCEPTION 'A platform admin''s account can''t be changed' USING ERRCODE = '42501';
    END IF;
    IF TG_OP = 'DELETE'
       AND NOT EXISTS (SELECT 1 FROM public.platform_admins WHERE auth_user_id <> OLD.auth_user_id)
       AND EXISTS (SELECT 1 FROM auth.users WHERE id = OLD.auth_user_id) THEN
        RAISE EXCEPTION 'The last platform admin can''t be removed' USING ERRCODE = '42501';
    END IF;
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;
DROP TRIGGER IF EXISTS trg_platform_admins_lock ON public.platform_admins;
CREATE TRIGGER trg_platform_admins_lock
    BEFORE UPDATE OR DELETE ON public.platform_admins
    FOR EACH ROW EXECUTE FUNCTION public.fn_platform_admins_lock();

REVOKE INSERT, UPDATE, DELETE ON public.platform_admins FROM anon, authenticated;

-- ===================================================================
-- 20261211001_mpesa_per_business
-- ===================================================================
-- Each business connects its own Safaricom Daraja app (keys, short code, passkey).
-- Prompts go to that business's own till, and every callback URL carries a token that
-- names the business. Keys are readable only by edge functions (service_role).

CREATE TABLE IF NOT EXISTS public.mpesa_payment_secrets (
    business_id      uuid PRIMARY KEY REFERENCES public.businesses(id) ON DELETE CASCADE,
    environment      text NOT NULL DEFAULT 'sandbox' CHECK (environment IN ('sandbox', 'production')),
    consumer_key     text NOT NULL CHECK (length(consumer_key) BETWEEN 10 AND 200),
    consumer_secret  text NOT NULL CHECK (length(consumer_secret) BETWEEN 10 AND 200),
    passkey          text NOT NULL CHECK (length(passkey) BETWEEN 10 AND 200),
    -- Short code that signs prompts: the paybill, or the store number of a Buy Goods till.
    shortcode        text NOT NULL CHECK (shortcode ~ '^[0-9]{5,10}$'),
    -- Buy Goods: the till that receives the money (differs from the store number). Paybill: null.
    party_b          text CHECK (party_b IS NULL OR party_b ~ '^[0-9]{5,10}$'),
    transaction_type text NOT NULL DEFAULT 'CustomerBuyGoodsOnline'
                     CHECK (transaction_type IN ('CustomerBuyGoodsOnline', 'CustomerPayBillOnline')),
    callback_token   text NOT NULL UNIQUE DEFAULT encode(extensions.gen_random_bytes(24), 'hex'),
    updated_at       timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.mpesa_payment_secrets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.mpesa_payment_secrets FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.mpesa_payment_secrets TO service_role;

DROP FUNCTION IF EXISTS public.record_till_payment(jsonb);

CREATE OR REPLACE FUNCTION "public"."record_till_payment"("p_raw" "jsonb", "p_business_id" "uuid" DEFAULT NULL) RETURNS "text"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
    v_trans_id  TEXT := NULLIF(trim(p_raw->>'TransID'), '');
    v_amount    NUMERIC := NULLIF(p_raw->>'TransAmount', '')::NUMERIC;
    v_short     TEXT := NULLIF(trim(p_raw->>'BusinessShortCode'), '');
    v_ref       TEXT := NULLIF(trim(p_raw->>'BillRefNumber'), '');
    v_name      TEXT := NULLIF(trim(concat_ws(' ', p_raw->>'FirstName', p_raw->>'MiddleName', p_raw->>'LastName')), '');
    v_time      TIMESTAMPTZ;
    v_biz       UUID;
    v_cust_id   UUID;
    v_cust_name TEXT;
    v_row_id    UUID;
    v_pid       UUID;
BEGIN
    IF v_trans_id IS NULL OR COALESCE(v_amount, 0) <= 0 THEN
        RAISE EXCEPTION 'Till confirmation is missing TransID or TransAmount.';
    END IF;

    BEGIN
        -- Safaricom sends Nairobi local time as YYYYMMDDHHmmss.
        v_time := COALESCE(to_timestamp(p_raw->>'TransTime', 'YYYYMMDDHH24MISS')::TIMESTAMP AT TIME ZONE 'Africa/Nairobi', NOW());
    EXCEPTION WHEN OTHERS THEN
        v_time := NOW();
    END;

    -- The callback URL's token names the business. Otherwise only an exact till match counts:
    -- a payment to an unknown till never lands on some other business.
    v_biz := p_business_id;
    IF v_biz IS NULL THEN
        SELECT business_id INTO v_biz FROM public.mpesa_settings WHERE till_number = v_short;
    END IF;

    INSERT INTO public.mpesa_till_payments (
        business_id, trans_id, trans_type, amount, short_code, bill_ref, msisdn, payer_name, trans_time, raw
    )
    VALUES (
        v_biz, v_trans_id, p_raw->>'TransactionType', v_amount, v_short, v_ref,
        NULLIF(p_raw->>'MSISDN', ''), v_name, v_time, p_raw
    )
    ON CONFLICT (trans_id) DO NOTHING
    RETURNING id INTO v_row_id;

    IF v_row_id IS NULL THEN
        RETURN 'duplicate';
    END IF;
    IF v_biz IS NULL THEN
        RAISE WARNING 'Till payment % for short code % matches no business', v_trans_id, v_short;
        RETURN 'no_business';
    END IF;

    -- Paybill-style payments carry the account number, so those settle themselves.
    IF v_ref IS NOT NULL THEN
        SELECT id, name INTO v_cust_id, v_cust_name FROM public.customers
        WHERE business_id = v_biz AND deleted_at IS NULL
          AND upper(account_number) = upper(v_ref);
    END IF;

    IF v_cust_id IS NOT NULL THEN
        v_pid := public.process_business_payment(
            v_biz, v_trans_id, v_amount, 'M-Pesa', COALESCE(v_name, v_cust_name),
            p_raw->>'MSISDN', 'Success', v_time, v_cust_id, v_cust_name, 'customer',
            'M-Pesa till payment', 'M-Pesa'
        );
        UPDATE public.mpesa_till_payments
        SET status = 'recorded', customer_id = v_cust_id, payment_id = v_pid,
            handled_by = 'Matched by account number', handled_at = NOW()
        WHERE id = v_row_id;
        PERFORM public.fn_notify_staff(v_biz, 'M-Pesa payment received',
            format('Ksh %s from %s (%s).', v_amount, v_cust_name, v_trans_id),
            jsonb_build_object('paymentId', v_pid));
        RETURN 'recorded';
    END IF;

    PERFORM public.fn_notify_staff(v_biz, 'M-Pesa till payment to assign',
        format('Ksh %s from %s (%s). Open Payments > M-Pesa to assign it.', v_amount, COALESCE(v_name, 'a customer'), v_trans_id),
        jsonb_build_object('tillPaymentId', v_row_id));
    RETURN 'queued';
END;
$$;


ALTER FUNCTION public.record_till_payment(jsonb, uuid) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.record_till_payment(jsonb, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_till_payment(jsonb, uuid) TO service_role;

-- ===================================================================
-- 20261211002_plan_gates_in_db
-- ===================================================================
-- Admin console controls enforced by the database, not only hidden in the app (2026-11-26).
--   * Marketing (campaigns, adverts) belongs to the Online store module: marketing.* permissions
--     are refused when the plan lacks online_store, to the Owner too (has_permission reads
--     module_permissions).
--   * Stock report (module stock_report) had no permission tied to it, so a lower plan could
--     still call stock_period_report directly. The report now checks the module first.

INSERT INTO public.module_permissions (pattern, module) VALUES ('marketing.%', 'online_store')
ON CONFLICT (pattern) DO UPDATE SET module = EXCLUDED.module;

DO $$
BEGIN
    IF to_regprocedure('public.stock_period_report_core(uuid, timestamptz, timestamptz)') IS NULL THEN
        ALTER FUNCTION public.stock_period_report(uuid, timestamptz, timestamptz) RENAME TO stock_period_report_core;
    END IF;
END $$;
REVOKE ALL ON FUNCTION public.stock_period_report_core(uuid, timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.stock_period_report(p_business_id uuid, p_from timestamptz, p_to timestamptz)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF NOT public.has_module(p_business_id, 'stock_report') THEN
        RAISE EXCEPTION 'The stock report is not on your plan. Upgrade to use it.'
            USING ERRCODE = '42501', HINT = 'plan_module';
    END IF;
    RETURN public.stock_period_report_core(p_business_id, p_from, p_to);
END;
$$;
ALTER FUNCTION public.stock_period_report(uuid, timestamptz, timestamptz) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.stock_period_report(uuid, timestamptz, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.stock_period_report(uuid, timestamptz, timestamptz) TO authenticated, service_role;

-- ===================================================================
-- 20261211003_storage_quota_all_buckets
-- ===================================================================
-- The plan's storage allowance (storage_mb) now covers every bucket a business uploads to
-- (business files, product pictures, logos, receipts, exports, website media), not only the
-- website media library. Usage = all stored objects whose first folder is one of the
-- company's branches. A new upload is refused once usage has reached the allowance.
-- Folders that are a user id (profile pictures) are not counted.

CREATE OR REPLACE FUNCTION public.fn_tenant_storage_used(p_tenant uuid)
RETURNS bigint
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT COALESCE(sum((o.metadata->>'size')::bigint), 0)
    FROM storage.objects o
    WHERE split_part(o.name, '/', 1) IN (SELECT b.id::text FROM public.businesses b WHERE b.tenant_id = p_tenant);
$$;
REVOKE ALL ON FUNCTION public.fn_tenant_storage_used(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_tenant_storage_used(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.fn_storage_quota_ok(p_folder text)
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_tenant uuid;
    v_quota bigint;
BEGIN
    IF p_folder !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' THEN
        RETURN true;
    END IF;
    SELECT tenant_id INTO v_tenant FROM public.businesses WHERE id = p_folder::uuid;
    IF v_tenant IS NULL THEN
        RETURN true;  -- not a business folder (e.g. a user's own picture)
    END IF;
    v_quota := NULLIF(public.fn_tenant_plan(v_tenant)->>'storage_mb', '')::bigint * 1048576;
    IF v_quota IS NULL OR v_quota <= 0 THEN
        RETURN true;  -- no limit on this plan
    END IF;
    RETURN public.fn_tenant_storage_used(v_tenant) < v_quota;
END;
$$;
REVOKE ALL ON FUNCTION public.fn_storage_quota_ok(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_storage_quota_ok(text) TO authenticated, service_role;

-- Restrictive: applies on top of each bucket's own upload policy.
DROP POLICY IF EXISTS "plan storage allowance" ON storage.objects;
CREATE POLICY "plan storage allowance" ON storage.objects AS RESTRICTIVE FOR INSERT TO authenticated
    WITH CHECK (public.fn_storage_quota_ok(split_part(name, '/', 1)));

-- Usage for the app / console to show (own company only).
CREATE OR REPLACE FUNCTION public.my_storage_usage(p_business_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_tenant uuid;
BEGIN
    IF NOT (p_business_id = ANY(public.get_user_business_ids())) THEN
        RAISE EXCEPTION 'Not your business' USING ERRCODE = '42501';
    END IF;
    v_tenant := public.fn_business_tenant(p_business_id);
    RETURN jsonb_build_object(
        'used_bytes', public.fn_tenant_storage_used(v_tenant),
        'quota_mb', NULLIF(public.fn_tenant_plan(v_tenant)->>'storage_mb', '')::bigint);
END;
$$;
REVOKE ALL ON FUNCTION public.my_storage_usage(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_storage_usage(uuid) TO authenticated, service_role;

-- ===================================================================
-- 20261211004_mpesa_secrets_plan_read_only
-- ===================================================================
-- M-Pesa keys obey read-only plans like every other business table (grants_check.sql rule 6).
-- Edge functions write as service_role, which the trigger lets through.
DROP TRIGGER IF EXISTS trg_zz_plan_read_only ON public.mpesa_payment_secrets;
CREATE TRIGGER trg_zz_plan_read_only BEFORE INSERT OR UPDATE OR DELETE ON public.mpesa_payment_secrets
    FOR EACH ROW EXECUTE FUNCTION public.fn_block_when_read_only();

-- ===================================================================
-- 20261212001_storage_usage_visible
-- ===================================================================
-- Storage used / allowed, readable by platform admins (any company) and by people who can
-- manage the business (their own company). Reads the same figures the upload check uses
-- (fn_tenant_storage_used, fn_tenant_plan storage_mb), so the screen and the block agree.

CREATE OR REPLACE FUNCTION public.tenant_storage_usage(p_tenant_id uuid DEFAULT NULL, p_business_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_tenant uuid := p_tenant_id;
    v_mb bigint;
BEGIN
    IF v_tenant IS NULL AND p_business_id IS NOT NULL THEN
        SELECT tenant_id INTO v_tenant FROM public.businesses WHERE id = p_business_id;
    END IF;
    IF v_tenant IS NULL THEN
        RAISE EXCEPTION 'Company not found';
    END IF;
    IF NOT (
        public.is_platform_admin()
        OR (p_business_id IS NOT NULL
            AND public.has_permission(p_business_id, 'business.update')
            AND EXISTS (SELECT 1 FROM public.businesses b WHERE b.id = p_business_id AND b.tenant_id = v_tenant))
    ) THEN
        RAISE EXCEPTION 'Not allowed';
    END IF;
    v_mb := NULLIF(public.fn_tenant_plan(v_tenant)->>'storage_mb', '')::bigint;
    RETURN jsonb_build_object(
        'used_bytes', public.fn_tenant_storage_used(v_tenant),
        'quota_bytes', CASE WHEN v_mb IS NULL OR v_mb <= 0 THEN NULL ELSE v_mb * 1048576 END
    );
END;
$$;
REVOKE ALL ON FUNCTION public.tenant_storage_usage(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tenant_storage_usage(uuid, uuid) TO authenticated;

-- ===================================================================
-- 20261212002_module_requests_support_messages
-- ===================================================================
-- 1. Module requests: a business asks for a module; a platform admin approves it only against a
--    recorded (not voided) platform payment, so the money is in the books before access is given
--    (money rule 1). Approval adds the module to the company's own extra modules.
-- 2. Support messages: managers of a business and platform admins write to each other.

CREATE TABLE IF NOT EXISTS public.module_requests (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    module_key text NOT NULL REFERENCES public.plan_modules(key),
    note text CHECK (length(note) <= 500),
    payment_reference text CHECK (length(payment_reference) <= 100),
    status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
    payment_id uuid REFERENCES public.platform_payments(id),
    decision_note text CHECK (length(decision_note) <= 500),
    requested_by uuid DEFAULT auth.uid(),
    decided_by uuid,
    created_at timestamptz NOT NULL DEFAULT now(),
    decided_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS module_requests_one_pending ON public.module_requests (tenant_id, module_key) WHERE status = 'pending';
ALTER TABLE public.module_requests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS module_requests_read ON public.module_requests;
CREATE POLICY module_requests_read ON public.module_requests FOR SELECT TO authenticated
    USING (public.is_platform_admin() OR public.has_permission(business_id, 'business.update'));
GRANT SELECT ON public.module_requests TO authenticated;

CREATE OR REPLACE FUNCTION public.request_module(p_business_id uuid, p_module text, p_note text DEFAULT NULL, p_payment_reference text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_tenant uuid; v_id uuid;
BEGIN
    IF NOT public.has_permission(p_business_id, 'business.update') THEN RAISE EXCEPTION 'Not allowed'; END IF;
    SELECT tenant_id INTO v_tenant FROM public.businesses WHERE id = p_business_id;
    IF NOT EXISTS (SELECT 1 FROM public.plan_modules WHERE key = p_module) THEN RAISE EXCEPTION 'Unknown module'; END IF;
    INSERT INTO public.module_requests (tenant_id, business_id, module_key, note, payment_reference)
    VALUES (v_tenant, p_business_id, p_module, NULLIF(trim(p_note), ''), NULLIF(trim(p_payment_reference), ''))
    RETURNING id INTO v_id;
    PERFORM public.fn_platform_log(v_tenant, 'module_requested', jsonb_build_object('module', p_module));
    RETURN v_id;
EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'This module is already requested and waiting';
END;
$$;
REVOKE ALL ON FUNCTION public.request_module(uuid, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_module(uuid, text, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.platform_decide_module_request(p_id uuid, p_approve boolean, p_payment_id uuid DEFAULT NULL, p_note text DEFAULT NULL)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE r public.module_requests;
BEGIN
    IF NOT public.is_platform_admin() THEN RAISE EXCEPTION 'Not allowed'; END IF;
    SELECT * INTO r FROM public.module_requests WHERE id = p_id FOR UPDATE;
    IF r.id IS NULL OR r.status <> 'pending' THEN RAISE EXCEPTION 'Request not waiting'; END IF;
    IF p_approve THEN
        IF NOT EXISTS (SELECT 1 FROM public.platform_payments
                       WHERE id = p_payment_id AND tenant_id = r.tenant_id AND voided_at IS NULL) THEN
            RAISE EXCEPTION 'Record their payment first, then pick it here';
        END IF;
        UPDATE public.tenant_subscriptions
        SET custom_limits = jsonb_set(COALESCE(custom_limits, '{}'::jsonb), '{modules}',
            (SELECT to_jsonb(array_agg(DISTINCT m)) FROM (
                SELECT jsonb_array_elements_text(COALESCE(custom_limits->'modules', '[]'::jsonb)) AS m
                UNION SELECT r.module_key) x))
        WHERE tenant_id = r.tenant_id;
    END IF;
    UPDATE public.module_requests
    SET status = CASE WHEN p_approve THEN 'approved' ELSE 'rejected' END,
        payment_id = CASE WHEN p_approve THEN p_payment_id END,
        decision_note = NULLIF(trim(p_note), ''), decided_by = auth.uid(), decided_at = now()
    WHERE id = p_id;
    PERFORM public.fn_platform_log(r.tenant_id, CASE WHEN p_approve THEN 'module_approved' ELSE 'module_rejected' END,
        jsonb_build_object('module', r.module_key, 'note', NULLIF(trim(p_note), '')));
    RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.platform_decide_module_request(uuid, boolean, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.platform_decide_module_request(uuid, boolean, uuid, text) TO authenticated;

CREATE TABLE IF NOT EXISTS public.support_messages (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    from_platform boolean NOT NULL DEFAULT false,
    sender_id uuid DEFAULT auth.uid(),
    sender_name text,
    body text NOT NULL CHECK (length(body) BETWEEN 1 AND 2000),
    created_at timestamptz NOT NULL DEFAULT now(),
    read_at timestamptz
);
CREATE INDEX IF NOT EXISTS support_messages_tenant ON public.support_messages (tenant_id, created_at DESC);
ALTER TABLE public.support_messages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS support_messages_read ON public.support_messages;
CREATE POLICY support_messages_read ON public.support_messages FOR SELECT TO authenticated
    USING (public.is_platform_admin() OR public.has_permission(business_id, 'business.update'));
GRANT SELECT ON public.support_messages TO authenticated;

CREATE OR REPLACE FUNCTION public.send_support_message(p_business_id uuid, p_body text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_tenant uuid; v_id uuid; v_admin boolean := public.is_platform_admin();
BEGIN
    IF NOT (v_admin OR public.has_permission(p_business_id, 'business.update')) THEN RAISE EXCEPTION 'Not allowed'; END IF;
    SELECT tenant_id INTO v_tenant FROM public.businesses WHERE id = p_business_id;
    INSERT INTO public.support_messages (tenant_id, business_id, from_platform, sender_name, body)
    VALUES (v_tenant, p_business_id, v_admin AND NOT public.has_permission(p_business_id, 'business.update'),
            (SELECT COALESCE(u.raw_user_meta_data->>'name', u.email) FROM auth.users u WHERE u.id = auth.uid()), trim(p_body))
    RETURNING id INTO v_id;
    RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.send_support_message(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.send_support_message(uuid, text) TO authenticated;

-- ===================================================================
-- 20261212003_module_price_required
-- ===================================================================
-- A module (add-on) with no price set cannot be requested or approved.

CREATE OR REPLACE FUNCTION public.request_module(p_business_id uuid, p_module text, p_note text DEFAULT NULL, p_payment_reference text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_tenant uuid; v_id uuid;
BEGIN
    IF NOT public.has_permission(p_business_id, 'business.update') THEN RAISE EXCEPTION 'Not allowed'; END IF;
    SELECT tenant_id INTO v_tenant FROM public.businesses WHERE id = p_business_id;
    IF NOT EXISTS (SELECT 1 FROM public.plan_modules WHERE key = p_module) THEN RAISE EXCEPTION 'Unknown module'; END IF;
    IF NOT EXISTS (SELECT 1 FROM public.plan_modules WHERE key = p_module AND addable AND addon_monthly_price IS NOT NULL) THEN
        RAISE EXCEPTION 'This module has no price yet and cannot be requested';
    END IF;
    INSERT INTO public.module_requests (tenant_id, business_id, module_key, note, payment_reference)
    VALUES (v_tenant, p_business_id, p_module, NULLIF(trim(p_note), ''), NULLIF(trim(p_payment_reference), ''))
    RETURNING id INTO v_id;
    PERFORM public.fn_platform_log(v_tenant, 'module_requested', jsonb_build_object('module', p_module));
    RETURN v_id;
EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'This module is already requested and waiting';
END;
$$;
REVOKE ALL ON FUNCTION public.request_module(uuid, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_module(uuid, text, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.platform_decide_module_request(p_id uuid, p_approve boolean, p_payment_id uuid DEFAULT NULL, p_note text DEFAULT NULL)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE r public.module_requests;
BEGIN
    IF NOT public.is_platform_admin() THEN RAISE EXCEPTION 'Not allowed'; END IF;
    SELECT * INTO r FROM public.module_requests WHERE id = p_id FOR UPDATE;
    IF r.id IS NULL OR r.status <> 'pending' THEN RAISE EXCEPTION 'Request not waiting'; END IF;
    IF p_approve THEN
        IF NOT EXISTS (SELECT 1 FROM public.plan_modules WHERE key = r.module_key AND addon_monthly_price IS NOT NULL) THEN
            RAISE EXCEPTION 'Set this module''s price first';
        END IF;
        IF NOT EXISTS (SELECT 1 FROM public.platform_payments
                       WHERE id = p_payment_id AND tenant_id = r.tenant_id AND voided_at IS NULL) THEN
            RAISE EXCEPTION 'Record their payment first, then pick it here';
        END IF;
        UPDATE public.tenant_subscriptions
        SET custom_limits = jsonb_set(COALESCE(custom_limits, '{}'::jsonb), '{modules}',
            (SELECT to_jsonb(array_agg(DISTINCT m)) FROM (
                SELECT jsonb_array_elements_text(COALESCE(custom_limits->'modules', '[]'::jsonb)) AS m
                UNION SELECT r.module_key) x))
        WHERE tenant_id = r.tenant_id;
    END IF;
    UPDATE public.module_requests
    SET status = CASE WHEN p_approve THEN 'approved' ELSE 'rejected' END,
        payment_id = CASE WHEN p_approve THEN p_payment_id END,
        decision_note = NULLIF(trim(p_note), ''), decided_by = auth.uid(), decided_at = now()
    WHERE id = p_id;
    PERFORM public.fn_platform_log(r.tenant_id, CASE WHEN p_approve THEN 'module_approved' ELSE 'module_rejected' END,
        jsonb_build_object('module', r.module_key, 'note', NULLIF(trim(p_note), '')));
    RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.platform_decide_module_request(uuid, boolean, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.platform_decide_module_request(uuid, boolean, uuid, text) TO authenticated;

-- ===================================================================
-- 20261212004_payment_assign_customer
-- ===================================================================
-- A walk-in payment can be made a customer's payment from the Payments screen.
-- Money rule 4: the link is never edited in place. The walk-in payment is voided (which
-- reverses its money balance and books entry) and recorded again for the customer under the
-- same reference, so it pays their debt first, then tops up their wallet. A till payment or
-- prompt that pointed at the old payment points at the new one.

CREATE OR REPLACE FUNCTION public.assign_payment_to_customer(
    p_payment_id uuid,
    p_customer_id uuid,
    p_by text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_pay  public.payments%ROWTYPE;
    v_name text;
    v_ref  text;
    v_new  uuid;
    v_by   text := COALESCE(NULLIF(trim(p_by), ''), 'Staff');
BEGIN
    SELECT * INTO v_pay FROM public.payments WHERE id = p_payment_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Payment not found.';
    END IF;
    PERFORM public.assert_business_member(v_pay.business_id);
    PERFORM public.assert_permission(v_pay.business_id, 'payments.manage');

    IF v_pay.status <> 'Success' THEN
        RAISE EXCEPTION 'Only a received payment can be given to a customer.';
    END IF;
    IF v_pay.customer_id IS NOT NULL THEN
        RAISE EXCEPTION 'This payment already belongs to a customer. Void it and record it again to change it.';
    END IF;

    SELECT name INTO v_name FROM public.customers
    WHERE id = p_customer_id AND business_id = v_pay.business_id AND deleted_at IS NULL;
    IF v_name IS NULL THEN
        RAISE EXCEPTION 'Choose a customer for this payment.';
    END IF;

    v_ref := v_pay.reference_code;
    PERFORM public.void_business_payment(v_pay.id, 'Moved to customer ' || v_name, v_by);

    v_new := public.process_business_payment(
        v_pay.business_id, v_ref, v_pay.amount, v_pay.method,
        COALESCE(v_pay.sender_name, v_name), v_pay.sender_phone, 'Success', v_pay.date,
        p_customer_id, v_name, 'customer', v_pay.description, v_by
    );

    -- void_business_payment sent a linked till payment back to the queue; it is handled again.
    UPDATE public.mpesa_till_payments
    SET status = 'recorded', payment_id = v_new, customer_id = p_customer_id,
        handled_by = v_by, handled_at = NOW()
    WHERE business_id = v_pay.business_id AND trans_id = v_ref AND status = 'unclaimed';

    UPDATE public.mpesa_transactions SET payment_id = v_new, customer_id = p_customer_id
    WHERE payment_id = v_pay.id;
    UPDATE public.airtel_transactions SET payment_id = v_new, customer_id = p_customer_id
    WHERE payment_id = v_pay.id;

    RETURN v_new;
END;
$$;

REVOKE ALL ON FUNCTION public.assign_payment_to_customer(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.assign_payment_to_customer(uuid, uuid, text) TO authenticated, service_role;

-- ===================================================================
-- 20261212005_till_payment_sale_link
-- ===================================================================
-- A till (C2B) payment can be linked to the exact sale it paid for.
-- Before this, "Already rung up as a sale" only changed the status: nothing said WHICH sale,
-- so a till payment never showed against a sale and could be "used" by two sales.
--
-- Money rule 2: linking moves no money. The sale already counted its M-Pesa money when it was
-- rung up (amount_paid, books, Payments balance); the link is the proof that the money arrived.
-- So only M-Pesa sales can be linked, and the till payments linked to one sale can never add up
-- to more than its total (no amount guessing, no overpayment).

ALTER TABLE public.mpesa_till_payments
    ADD COLUMN IF NOT EXISTS sale_id uuid REFERENCES public.transactions(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS mpesa_till_payments_sale_idx ON public.mpesa_till_payments (sale_id) WHERE sale_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS mpesa_till_payments_queue_idx ON public.mpesa_till_payments (business_id, status, trans_time DESC);

-- Back to the queue = no longer linked (handle_till_payment 'reopen').
CREATE OR REPLACE FUNCTION public.fn_till_payment_unlink_on_reopen() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
    IF NEW.status <> 'matched_sale' THEN
        NEW.sale_id := NULL;
    END IF;
    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_till_payment_unlink ON public.mpesa_till_payments;
CREATE TRIGGER trg_till_payment_unlink BEFORE UPDATE OF status ON public.mpesa_till_payments
    FOR EACH ROW EXECUTE FUNCTION public.fn_till_payment_unlink_on_reopen();

-- How much of a sale's total is already proven by linked till payments.
CREATE OR REPLACE FUNCTION public.fn_sale_till_linked(p_sale_id uuid) RETURNS numeric
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT COALESCE(SUM(amount), 0)::numeric(14,2) FROM public.mpesa_till_payments
    WHERE sale_id = p_sale_id AND status = 'matched_sale';
$$;
REVOKE ALL ON FUNCTION public.fn_sale_till_linked(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_sale_till_linked(uuid) TO service_role;

-- Sales a till payment could belong to: this business's M-Pesa sales with room left,
-- newest first, nearest in time to the payment. Search by receipt number or customer.
CREATE OR REPLACE FUNCTION public.till_payment_sale_candidates(
    p_till_payment_id uuid,
    p_search text DEFAULT NULL,
    p_limit int DEFAULT 30
) RETURNS TABLE (
    sale_id uuid, reference text, created_at timestamptz, customer_name text,
    total numeric, linked numeric, remaining numeric, same_amount boolean
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_row public.mpesa_till_payments%ROWTYPE;
    v_q   text := NULLIF(trim(p_search), '');
BEGIN
    SELECT * INTO v_row FROM public.mpesa_till_payments WHERE id = p_till_payment_id;
    IF NOT FOUND OR v_row.business_id IS NULL THEN
        RAISE EXCEPTION 'Till payment not found.';
    END IF;
    PERFORM public.assert_business_member(v_row.business_id);
    PERFORM public.assert_permission(v_row.business_id, 'payments.verify', 'payments.mpesa');

    RETURN QUERY
    SELECT t.id, COALESCE(t.reference_id, left(t.id::text, 8)), t.created_at, c.name,
           t.final_total, l.linked, (t.final_total - l.linked),
           (t.final_total - l.linked) = v_row.amount
    FROM public.transactions t
    LEFT JOIN public.customers c ON c.id = t.customer_id
    CROSS JOIN LATERAL (SELECT public.fn_sale_till_linked(t.id) AS linked) l
    WHERE t.business_id = v_row.business_id
      AND t.deleted_at IS NULL
      AND t.payment_method = 'M-Pesa'
      AND t.final_total - l.linked >= v_row.amount
      AND (v_q IS NOT NULL OR t.created_at BETWEEN v_row.trans_time - interval '3 days' AND v_row.trans_time + interval '1 day')
      AND (v_q IS NULL OR t.reference_id ILIKE '%' || v_q || '%' OR c.name ILIKE '%' || v_q || '%'
           OR t.final_total::text = v_q)
    ORDER BY abs(extract(epoch FROM (t.created_at - v_row.trans_time)))
    LIMIT LEAST(GREATEST(COALESCE(p_limit, 30), 1), 100);
END;
$$;
REVOKE ALL ON FUNCTION public.till_payment_sale_candidates(uuid, text, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.till_payment_sale_candidates(uuid, text, int) TO authenticated, service_role;

-- Links one waiting till payment to one sale. Locks both rows so two cashiers can't
-- link the same money twice or push a sale over its total.
CREATE OR REPLACE FUNCTION public.link_till_payment_to_sale(
    p_till_payment_id uuid,
    p_sale_id uuid,
    p_handled_by text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_row  public.mpesa_till_payments%ROWTYPE;
    v_sale public.transactions%ROWTYPE;
    v_by   text := COALESCE(NULLIF(trim(p_handled_by), ''), 'Staff');
BEGIN
    SELECT * INTO v_row FROM public.mpesa_till_payments WHERE id = p_till_payment_id FOR UPDATE;
    IF NOT FOUND OR v_row.business_id IS NULL THEN
        RAISE EXCEPTION 'Till payment not found.';
    END IF;
    PERFORM public.assert_business_member(v_row.business_id);
    PERFORM public.assert_permission(v_row.business_id, 'payments.verify', 'payments.mpesa');
    IF v_row.status <> 'unclaimed' THEN
        RAISE EXCEPTION 'This payment was already handled by %.', COALESCE(v_row.handled_by, 'someone else');
    END IF;

    SELECT * INTO v_sale FROM public.transactions WHERE id = p_sale_id FOR UPDATE;
    IF NOT FOUND OR v_sale.business_id <> v_row.business_id OR v_sale.deleted_at IS NOT NULL THEN
        RAISE EXCEPTION 'Sale not found.';
    END IF;
    IF v_sale.payment_method <> 'M-Pesa' THEN
        RAISE EXCEPTION 'Only a sale paid by M-Pesa can take a till payment. Record it as a customer or walk-in payment instead.';
    END IF;
    IF public.fn_sale_till_linked(v_sale.id) + v_row.amount > v_sale.final_total THEN
        RAISE EXCEPTION 'This sale is already covered by till payments. Choose another sale.';
    END IF;

    UPDATE public.mpesa_till_payments
    SET status = 'matched_sale', sale_id = v_sale.id, handled_by = v_by, handled_at = NOW(),
        note = 'Sale ' || COALESCE(v_sale.reference_id, left(v_sale.id::text, 8))
    WHERE id = v_row.id;
END;
$$;
REVOKE ALL ON FUNCTION public.link_till_payment_to_sale(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.link_till_payment_to_sale(uuid, uuid, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION "public"."record_till_payment"("p_raw" "jsonb", "p_business_id" "uuid" DEFAULT NULL) RETURNS "text"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
    v_trans_id  TEXT := NULLIF(trim(p_raw->>'TransID'), '');
    v_amount    NUMERIC := NULLIF(p_raw->>'TransAmount', '')::NUMERIC;
    v_short     TEXT := NULLIF(trim(p_raw->>'BusinessShortCode'), '');
    v_ref       TEXT := NULLIF(trim(p_raw->>'BillRefNumber'), '');
    v_name      TEXT := NULLIF(trim(concat_ws(' ', p_raw->>'FirstName', p_raw->>'MiddleName', p_raw->>'LastName')), '');
    v_time      TIMESTAMPTZ;
    v_biz       UUID;
    v_cust_id   UUID;
    v_cust_name TEXT;
    v_row_id    UUID;
    v_pid       UUID;
    v_sale_id   UUID;
    v_sale_ref  TEXT;
    v_matches   INT;
BEGIN
    IF v_trans_id IS NULL OR COALESCE(v_amount, 0) <= 0 THEN
        RAISE EXCEPTION 'Till confirmation is missing TransID or TransAmount.';
    END IF;

    BEGIN
        -- Safaricom sends Nairobi local time as YYYYMMDDHHmmss.
        v_time := COALESCE(to_timestamp(p_raw->>'TransTime', 'YYYYMMDDHH24MISS')::TIMESTAMP AT TIME ZONE 'Africa/Nairobi', NOW());
    EXCEPTION WHEN OTHERS THEN
        v_time := NOW();
    END;

    -- The callback URL's token names the business. Otherwise only an exact till match counts:
    -- a payment to an unknown till never lands on some other business.
    v_biz := p_business_id;
    IF v_biz IS NULL THEN
        SELECT business_id INTO v_biz FROM public.mpesa_settings WHERE till_number = v_short;
    END IF;

    INSERT INTO public.mpesa_till_payments (
        business_id, trans_id, trans_type, amount, short_code, bill_ref, msisdn, payer_name, trans_time, raw
    )
    VALUES (
        v_biz, v_trans_id, p_raw->>'TransactionType', v_amount, v_short, v_ref,
        NULLIF(p_raw->>'MSISDN', ''), v_name, v_time, p_raw
    )
    ON CONFLICT (trans_id) DO NOTHING
    RETURNING id INTO v_row_id;

    IF v_row_id IS NULL THEN
        RETURN 'duplicate';
    END IF;
    IF v_biz IS NULL THEN
        RAISE WARNING 'Till payment % for short code % matches no business', v_trans_id, v_short;
        RETURN 'no_business';
    END IF;

    -- The payer typed a sale's receipt number as the account (paybill): link it only when exactly
    -- one M-Pesa sale has that number and still has room for this amount. Never by amount alone.
    IF v_ref IS NOT NULL THEN
        SELECT count(*), min(t.id::text)::uuid, min(t.reference_id) INTO v_matches, v_sale_id, v_sale_ref
        FROM public.transactions t
        WHERE t.business_id = v_biz AND t.deleted_at IS NULL AND t.payment_method = 'M-Pesa'
          AND upper(t.reference_id) = upper(v_ref)
          AND t.final_total - public.fn_sale_till_linked(t.id) >= v_amount;
        IF v_matches = 1 THEN
            UPDATE public.mpesa_till_payments
            SET status = 'matched_sale', sale_id = v_sale_id,
                handled_by = 'Matched by receipt number', handled_at = NOW(), note = 'Sale ' || v_sale_ref
            WHERE id = v_row_id;
            PERFORM public.fn_notify_staff(v_biz, 'M-Pesa payment received',
                format('Ksh %s for sale %s (%s).', v_amount, v_sale_ref, v_trans_id),
                jsonb_build_object('tillPaymentId', v_row_id, 'saleId', v_sale_id));
            RETURN 'matched_sale';
        END IF;
    END IF;

    -- Paybill-style payments carry the account number, so those settle themselves.
    IF v_ref IS NOT NULL THEN
        SELECT id, name INTO v_cust_id, v_cust_name FROM public.customers
        WHERE business_id = v_biz AND deleted_at IS NULL
          AND upper(account_number) = upper(v_ref);
    END IF;

    IF v_cust_id IS NOT NULL THEN
        v_pid := public.process_business_payment(
            v_biz, v_trans_id, v_amount, 'M-Pesa', COALESCE(v_name, v_cust_name),
            p_raw->>'MSISDN', 'Success', v_time, v_cust_id, v_cust_name, 'customer',
            'M-Pesa till payment', 'M-Pesa'
        );
        UPDATE public.mpesa_till_payments
        SET status = 'recorded', customer_id = v_cust_id, payment_id = v_pid,
            handled_by = 'Matched by account number', handled_at = NOW()
        WHERE id = v_row_id;
        PERFORM public.fn_notify_staff(v_biz, 'M-Pesa payment received',
            format('Ksh %s from %s (%s).', v_amount, v_cust_name, v_trans_id),
            jsonb_build_object('paymentId', v_pid));
        RETURN 'recorded';
    END IF;

    PERFORM public.fn_notify_staff(v_biz, 'M-Pesa till payment to assign',
        format('Ksh %s from %s (%s). Open Payments > M-Pesa to assign it.', v_amount, COALESCE(v_name, 'a customer'), v_trans_id),
        jsonb_build_object('tillPaymentId', v_row_id));
    RETURN 'queued';
END;
$$;

ALTER FUNCTION public.record_till_payment(jsonb, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.record_till_payment(jsonb, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_till_payment(jsonb, uuid) TO service_role;

-- ===================================================================
-- 20261212006_till_payment_no_ring
-- ===================================================================
-- A till payment nobody has assigned yet no longer rings the phone. It still waits in
-- Payments > Paid to the till and shows as a normal notice, to be assigned when convenient.
CREATE OR REPLACE FUNCTION public.fn_ringing_alert_target(p_type text, p_title text, p_direct boolean) RETURNS text
    LANGUAGE sql IMMUTABLE
    AS $$
    SELECT CASE
        WHEN p_type = 'Schedule Reminder' THEN 'dashboard'
        WHEN p_type = 'Delivery Assigned' AND p_direct THEN 'deliveries'
        WHEN p_type = 'Online Store' AND p_title = 'New delivery' AND p_direct THEN 'deliveries'
        WHEN p_type = 'Online Store' AND p_title IN ('New online order', 'Online payment needs checking', 'Delivery not completed')
            THEN 'online-store'
        ELSE NULL
    END;
$$;

ALTER FUNCTION public.fn_ringing_alert_target(text, text, boolean) OWNER TO postgres;

-- Stop the ones already ringing; the notices themselves stay.
UPDATE public.notifications SET ring = FALSE
WHERE ring AND type = 'Online Store' AND title = 'M-Pesa till payment to assign';

-- ===================================================================
-- 20261212007_stk_prompt_sale_link
-- ===================================================================
-- An M-Pesa prompt (STK push) can be linked to the sale it is for BEFORE it is sent.
--
-- Money rule 2: like a till payment linked to a sale (20261212005), the link moves no money.
-- The M-Pesa sale already counted its money when it was rung up; the paid prompt is the proof
-- that the money arrived. So a paid, linked prompt makes no second payment row.
--
-- Money rule 1: if the sale was removed, or is already covered, by the time the money arrives,
-- the money is still recorded, as a normal walk-in / customer payment (never lost).
--
-- mpesa_transactions.transaction_id already existed (online orders set it after payment, with
-- online_order_id set). Shop prompts use it for the sale they were sent for.

CREATE INDEX IF NOT EXISTS mpesa_transactions_sale_idx
    ON public.mpesa_transactions (transaction_id)
    WHERE transaction_id IS NOT NULL AND online_order_id IS NULL;

-- Everything already proving a sale's M-Pesa money: linked till payments, plus linked prompts
-- that are paid or still waiting (a waiting prompt holds its room so two can't cover one sale).
CREATE OR REPLACE FUNCTION public.fn_sale_till_linked(p_sale_id uuid) RETURNS numeric
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT (
        COALESCE((SELECT SUM(amount) FROM public.mpesa_till_payments
                  WHERE sale_id = p_sale_id AND status = 'matched_sale'), 0)
      + COALESCE((SELECT SUM(amount) FROM public.mpesa_transactions
                  WHERE transaction_id = p_sale_id AND online_order_id IS NULL
                    AND status IN ('Pending', 'Completed')), 0)
    )::numeric(14,2);
$$;
REVOKE ALL ON FUNCTION public.fn_sale_till_linked(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_sale_till_linked(uuid) TO service_role;

-- Checked by the mpesa-payments function before it asks Safaricom to send the prompt.
-- Returns the sale's receipt number; raises a plain-language reason when it can't be sent.
CREATE OR REPLACE FUNCTION public.check_sale_prompt(
    p_business_id uuid,
    p_sale_id uuid,
    p_amount numeric
) RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_sale public.transactions%ROWTYPE;
    v_room numeric;
BEGIN
    SELECT * INTO v_sale FROM public.transactions WHERE id = p_sale_id;
    IF NOT FOUND OR v_sale.business_id <> p_business_id OR v_sale.deleted_at IS NOT NULL THEN
        RAISE EXCEPTION 'Sale not found.';
    END IF;
    IF v_sale.payment_method <> 'M-Pesa' THEN
        RAISE EXCEPTION 'Only a sale paid by M-Pesa can be paid with a prompt.';
    END IF;
    v_room := v_sale.final_total - public.fn_sale_till_linked(v_sale.id);
    IF v_room < 1 THEN
        RAISE EXCEPTION 'This sale is already paid or has a prompt waiting.';
    END IF;
    IF p_amount > v_room THEN
        RAISE EXCEPTION 'The prompt is more than the sale still needs (KSh %).', to_char(v_room, 'FM999,999,990.00');
    END IF;
    RETURN COALESCE(v_sale.reference_id, left(v_sale.id::text, 8));
END;
$$;
REVOKE ALL ON FUNCTION public.check_sale_prompt(uuid, uuid, numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_sale_prompt(uuid, uuid, numeric) TO service_role;

CREATE OR REPLACE FUNCTION "public"."confirm_store_payment_request"("p_checkout_request_id" "text", "p_result_code" integer, "p_amount" numeric, "p_receipt" "text", "p_raw" "jsonb") RETURNS "text"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
    v_req     public.mpesa_transactions%ROWTYPE;
    v_name    TEXT;
    v_pid     UUID;
    v_amount  NUMERIC;
    v_sale    public.transactions%ROWTYPE;
    v_other   NUMERIC;
BEGIN
    SELECT * INTO v_req FROM public.mpesa_transactions
    WHERE checkout_request_id = p_checkout_request_id
      AND online_order_id IS NULL AND business_id IS NOT NULL
    FOR UPDATE;
    IF NOT FOUND THEN
        RETURN 'unknown';
    END IF;
    IF v_req.status = 'Completed' OR (v_req.status <> 'Pending' AND p_result_code <> 0) THEN
        RETURN 'duplicate';
    END IF;

    IF p_result_code <> 0 THEN
        UPDATE public.mpesa_transactions
        SET status = 'Failed', raw_callback = COALESCE(p_raw, raw_callback), updated_at = NOW()
        WHERE id = v_req.id;
        RETURN 'failed';
    END IF;

    IF p_receipt IS NULL THEN
        RAISE EXCEPTION 'A successful M-Pesa result arrived without a receipt number.';
    END IF;

    v_amount := COALESCE(p_amount, v_req.amount);

    -- Prompt sent for a sale: the sale already counted this money. Only the proof is stored,
    -- as long as the sale still exists and this doesn't take it over its total.
    IF v_req.transaction_id IS NOT NULL THEN
        SELECT * INTO v_sale FROM public.transactions WHERE id = v_req.transaction_id FOR UPDATE;
        IF FOUND AND v_sale.deleted_at IS NULL AND v_sale.payment_method = 'M-Pesa' THEN
            v_other := public.fn_sale_till_linked(v_sale.id) - v_req.amount;
            IF v_other + v_amount <= v_sale.final_total THEN
                UPDATE public.mpesa_transactions
                SET status = 'Completed', receipt_number = p_receipt, amount = v_amount,
                    mpesa_receipt_timestamp = NOW(), raw_callback = p_raw, updated_at = NOW()
                WHERE id = v_req.id;
                PERFORM public.fn_notify_staff(v_req.business_id, 'M-Pesa payment received',
                    format('Ksh %s for sale %s (%s).', v_amount,
                           COALESCE(v_sale.reference_id, left(v_sale.id::text, 8)), p_receipt),
                    jsonb_build_object('saleId', v_sale.id));
                RETURN 'matched_sale';
            END IF;
        END IF;
        -- The sale is gone or already covered: unlink and record the money as a payment below.
        UPDATE public.mpesa_transactions SET transaction_id = NULL WHERE id = v_req.id;
    END IF;

    SELECT name INTO v_name FROM public.customers WHERE id = v_req.customer_id;

    v_pid := public.process_business_payment(
        v_req.business_id, p_receipt, v_amount, 'M-Pesa',
        COALESCE(v_name, 'M-Pesa ' || v_req.phone), v_req.phone, 'Success', NOW(),
        v_req.customer_id, v_name,
        CASE WHEN v_req.customer_id IS NULL THEN 'walk-in' ELSE 'customer' END,
        COALESCE(v_req.description, 'M-Pesa prompt'), v_req.requested_by
    );

    UPDATE public.mpesa_transactions
    SET status = 'Completed', receipt_number = p_receipt,
        amount = v_amount, mpesa_receipt_timestamp = NOW(),
        raw_callback = p_raw, payment_id = v_pid, updated_at = NOW()
    WHERE id = v_req.id;

    PERFORM public.fn_notify_staff(v_req.business_id, 'M-Pesa payment received',
        format('Ksh %s from %s (%s).', v_amount, COALESCE(v_name, v_req.phone), p_receipt),
        jsonb_build_object('paymentId', v_pid));
    RETURN 'recorded';
END;
$$;
REVOKE ALL ON FUNCTION public.confirm_store_payment_request(text, integer, numeric, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_store_payment_request(text, integer, numeric, text, jsonb) TO service_role;

-- ===================================================================
-- 20261212008_payment_sweep
-- ===================================================================
-- M-Pesa results no longer depend on Safaricom's callback arriving.
--
-- 1. payment-sweep (edge function, every 2 minutes) settles prompts whose callback is overdue
--    from Safaricom's status query. A paid prompt is recorded with a stand-in receipt
--    "QRY-<checkout id>", since the query carries no receipt number. Money rule 1: the money is
--    recorded within minutes even if the callback is lost.
-- 2. If the real callback arrives later, the stand-in is replaced by the real receipt on the
--    prompt and on its payment row (only the reference text changes, no money moves).
-- 3. On sandbox it also registers the till again, because the shared sandbox short codes go to
--    whichever developer registered last.
--
-- Builds on 20261212007 (confirm_store_payment_request with sale-linked prompts).

CREATE OR REPLACE FUNCTION "public"."confirm_store_payment_request"("p_checkout_request_id" "text", "p_result_code" integer, "p_amount" numeric, "p_receipt" "text", "p_raw" "jsonb") RETURNS "text"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
    v_req     public.mpesa_transactions%ROWTYPE;
    v_name    TEXT;
    v_pid     UUID;
    v_amount  NUMERIC;
    v_sale    public.transactions%ROWTYPE;
    v_other   NUMERIC;
BEGIN
    SELECT * INTO v_req FROM public.mpesa_transactions
    WHERE checkout_request_id = p_checkout_request_id
      AND online_order_id IS NULL AND business_id IS NOT NULL
    FOR UPDATE;
    IF NOT FOUND THEN
        RETURN 'unknown';
    END IF;
    -- Settled earlier from the status query (stand-in receipt): the late callback brings the
    -- real receipt number. Only the reference text changes; no money moves.
    IF v_req.status = 'Completed' AND p_result_code = 0 AND p_receipt IS NOT NULL
       AND p_receipt NOT LIKE 'QRY-%' AND v_req.receipt_number LIKE 'QRY-%' THEN
        UPDATE public.payments SET reference_code = p_receipt
        WHERE id = v_req.payment_id AND reference_code = v_req.receipt_number;
        UPDATE public.mpesa_transactions
        SET receipt_number = p_receipt, raw_callback = p_raw, updated_at = NOW()
        WHERE id = v_req.id;
        RETURN 'receipt_added';
    END IF;
    IF v_req.status = 'Completed' OR (v_req.status <> 'Pending' AND p_result_code <> 0) THEN
        RETURN 'duplicate';
    END IF;

    IF p_result_code <> 0 THEN
        UPDATE public.mpesa_transactions
        SET status = 'Failed', raw_callback = COALESCE(p_raw, raw_callback), updated_at = NOW()
        WHERE id = v_req.id;
        RETURN 'failed';
    END IF;

    IF p_receipt IS NULL THEN
        RAISE EXCEPTION 'A successful M-Pesa result arrived without a receipt number.';
    END IF;

    v_amount := COALESCE(p_amount, v_req.amount);

    -- Prompt sent for a sale: the sale already counted this money. Only the proof is stored,
    -- as long as the sale still exists and this doesn't take it over its total.
    IF v_req.transaction_id IS NOT NULL THEN
        SELECT * INTO v_sale FROM public.transactions WHERE id = v_req.transaction_id FOR UPDATE;
        IF FOUND AND v_sale.deleted_at IS NULL AND v_sale.payment_method = 'M-Pesa' THEN
            v_other := public.fn_sale_till_linked(v_sale.id) - v_req.amount;
            IF v_other + v_amount <= v_sale.final_total THEN
                UPDATE public.mpesa_transactions
                SET status = 'Completed', receipt_number = p_receipt, amount = v_amount,
                    mpesa_receipt_timestamp = NOW(), raw_callback = p_raw, updated_at = NOW()
                WHERE id = v_req.id;
                PERFORM public.fn_notify_staff(v_req.business_id, 'M-Pesa payment received',
                    format('Ksh %s for sale %s (%s).', v_amount,
                           COALESCE(v_sale.reference_id, left(v_sale.id::text, 8)), p_receipt),
                    jsonb_build_object('saleId', v_sale.id));
                RETURN 'matched_sale';
            END IF;
        END IF;
        -- The sale is gone or already covered: unlink and record the money as a payment below.
        UPDATE public.mpesa_transactions SET transaction_id = NULL WHERE id = v_req.id;
    END IF;

    SELECT name INTO v_name FROM public.customers WHERE id = v_req.customer_id;

    v_pid := public.process_business_payment(
        v_req.business_id, p_receipt, v_amount, 'M-Pesa',
        COALESCE(v_name, 'M-Pesa ' || v_req.phone), v_req.phone, 'Success', NOW(),
        v_req.customer_id, v_name,
        CASE WHEN v_req.customer_id IS NULL THEN 'walk-in' ELSE 'customer' END,
        COALESCE(v_req.description, 'M-Pesa prompt'), v_req.requested_by
    );

    UPDATE public.mpesa_transactions
    SET status = 'Completed', receipt_number = p_receipt,
        amount = v_amount, mpesa_receipt_timestamp = NOW(),
        raw_callback = p_raw, payment_id = v_pid, updated_at = NOW()
    WHERE id = v_req.id;

    PERFORM public.fn_notify_staff(v_req.business_id, 'M-Pesa payment received',
        format('Ksh %s from %s (%s).', v_amount, COALESCE(v_name, v_req.phone), p_receipt),
        jsonb_build_object('paymentId', v_pid));
    RETURN 'recorded';
END;
$$;
REVOKE ALL ON FUNCTION public.confirm_store_payment_request(text, integer, numeric, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_store_payment_request(text, integer, numeric, text, jsonb) TO service_role;

-- Calls payment-sweep only when there is something to do: a prompt waiting over a minute, or a
-- sandbox till whose registration is due again.
CREATE OR REPLACE FUNCTION public.run_payment_sweep() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_url text;
    v_key text;
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM public.mpesa_transactions
        WHERE status = 'Pending' AND checkout_request_id IS NOT NULL
          AND created_at < now() - interval '60 seconds'
          AND created_at > now() - interval '1 day'
    ) AND NOT EXISTS (
        SELECT 1 FROM public.mpesa_settings m
        JOIN public.mpesa_payment_secrets s ON s.business_id = m.business_id
        WHERE s.environment = 'sandbox' AND m.registered_at IS NOT NULL
          AND m.registered_at < now() - interval '4 minutes'
    ) THEN
        RETURN;
    END IF;

    SELECT decrypted_secret INTO v_url FROM vault.decrypted_secrets WHERE name = 'project_url';
    SELECT decrypted_secret INTO v_key FROM vault.decrypted_secrets WHERE name = 'service_role_key';
    IF v_url IS NULL OR v_key IS NULL THEN
        RAISE WARNING 'run_payment_sweep: Vault secrets project_url and service_role_key are not set.';
        RETURN;
    END IF;

    PERFORM net.http_post(
        url := rtrim(v_url, '/') || '/functions/v1/payment-sweep',
        headers := jsonb_build_object('Content-Type', 'application/json',
                                      'Authorization', 'Bearer ' || v_key, 'apikey', v_key),
        body := '{}'::jsonb,
        timeout_milliseconds := 55000
    );
END;
$$;
REVOKE ALL ON FUNCTION public.run_payment_sweep() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.run_payment_sweep() TO service_role;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
        EXECUTE $q$SELECT cron.unschedule('payment-sweep') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'payment-sweep')$q$;
        PERFORM cron.schedule('payment-sweep', '*/2 * * * *', 'SELECT public.run_payment_sweep()');
    END IF;
END;
$$;

-- ===================================================================
-- 20261213001_unclaimed_reconciliation
-- ===================================================================
-- Unclaimed Payments reconciliation (2026-11-28).
--
-- Builds on 20261212005/007/008. No second ledger: mpesa_till_payments stays the one record of
-- money that arrived at the till. This adds
--   1. allocations: one till payment can prove part of a sale, or be split over several sales
--      (mpesa_till_allocations). Linking still moves no money (money rule 2): the M-Pesa sale
--      already counted its money when it was rung up; an allocation is the proof it arrived.
--   2. statuses: under_review, partial, disputed, reversed (plus the old unclaimed / recorded /
--      matched_sale / ignored). Rows are never deleted.
--   3. an append-only history of every status change and allocation (mpesa_till_payment_events),
--      written by trigger so every path (callback, staff, void) is covered.
--   4. STK exceptions: a paid prompt that was meant for a sale but could not be matched to it.

-- 1. Statuses -------------------------------------------------------------------------------
ALTER TABLE public.mpesa_till_payments DROP CONSTRAINT IF EXISTS mpesa_till_payments_status_check;
ALTER TABLE public.mpesa_till_payments ADD CONSTRAINT mpesa_till_payments_status_check CHECK (status = ANY (ARRAY[
    'unclaimed', 'under_review', 'partial', 'disputed', 'recorded', 'matched_sale', 'ignored', 'reversed'
]));
ALTER TABLE public.mpesa_till_payments ADD COLUMN IF NOT EXISTS allocated numeric(14,2) NOT NULL DEFAULT 0;

-- The money reference never changes once received.
CREATE OR REPLACE FUNCTION public.fn_till_payment_immutable() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
    IF NEW.trans_id IS DISTINCT FROM OLD.trans_id OR NEW.amount IS DISTINCT FROM OLD.amount
       OR NEW.trans_time IS DISTINCT FROM OLD.trans_time OR NEW.msisdn IS DISTINCT FROM OLD.msisdn THEN
        RAISE EXCEPTION 'A received payment''s code, amount, time and phone cannot be changed.';
    END IF;
    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_till_payment_immutable ON public.mpesa_till_payments;
CREATE TRIGGER trg_till_payment_immutable BEFORE UPDATE ON public.mpesa_till_payments
    FOR EACH ROW EXECUTE FUNCTION public.fn_till_payment_immutable();

CREATE OR REPLACE FUNCTION public.fn_till_payment_no_delete() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
    -- A whole business being removed may cascade; a single payment row never goes.
    IF NOT EXISTS (SELECT 1 FROM public.businesses WHERE id = OLD.business_id) THEN RETURN OLD; END IF;
    RAISE EXCEPTION 'Received payments are never deleted. Mark them disputed or reversed instead.';
END;
$$;
DROP TRIGGER IF EXISTS trg_till_payment_no_delete ON public.mpesa_till_payments;
CREATE TRIGGER trg_till_payment_no_delete BEFORE DELETE ON public.mpesa_till_payments
    FOR EACH ROW EXECUTE FUNCTION public.fn_till_payment_no_delete();

-- 2. Allocations ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.mpesa_till_allocations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    till_payment_id uuid NOT NULL REFERENCES public.mpesa_till_payments(id) ON DELETE CASCADE,
    sale_id uuid NOT NULL REFERENCES public.transactions(id) ON DELETE CASCADE,
    amount numeric(14,2) NOT NULL CHECK (amount > 0),
    allocated_by text NOT NULL,
    allocated_by_user uuid DEFAULT auth.uid(),
    allocated_at timestamptz NOT NULL DEFAULT now(),
    reversed_at timestamptz,
    reversed_by text,
    reverse_reason text
);
CREATE INDEX IF NOT EXISTS mpesa_till_alloc_payment_idx ON public.mpesa_till_allocations (till_payment_id) WHERE reversed_at IS NULL;
CREATE INDEX IF NOT EXISTS mpesa_till_alloc_sale_idx ON public.mpesa_till_allocations (sale_id) WHERE reversed_at IS NULL;
ALTER TABLE public.mpesa_till_allocations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS pol_mpesa_till_alloc_select ON public.mpesa_till_allocations;
CREATE POLICY pol_mpesa_till_alloc_select ON public.mpesa_till_allocations FOR SELECT
    USING (public.has_permission(business_id, VARIADIC ARRAY['payments.view', 'payments.mpesa', 'payments.verify']));
REVOKE ALL ON public.mpesa_till_allocations FROM anon, authenticated;
GRANT SELECT ON public.mpesa_till_allocations TO authenticated;
GRANT ALL ON public.mpesa_till_allocations TO service_role;

-- Existing links become allocations of their full amount.
INSERT INTO public.mpesa_till_allocations (business_id, till_payment_id, sale_id, amount, allocated_by, allocated_by_user, allocated_at)
SELECT p.business_id, p.id, p.sale_id, p.amount, COALESCE(p.handled_by, 'Staff'), NULL, COALESCE(p.handled_at, p.created_at)
FROM public.mpesa_till_payments p
WHERE p.status = 'matched_sale' AND p.sale_id IS NOT NULL AND p.business_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM public.mpesa_till_allocations a WHERE a.till_payment_id = p.id);
UPDATE public.mpesa_till_payments p SET allocated = p.amount WHERE p.status = 'matched_sale' AND p.sale_id IS NOT NULL;

-- What a sale's M-Pesa money is proven by: live allocations plus linked prompts (paid or waiting).
CREATE OR REPLACE FUNCTION public.fn_sale_till_linked(p_sale_id uuid) RETURNS numeric
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT (
        COALESCE((SELECT SUM(amount) FROM public.mpesa_till_allocations
                  WHERE sale_id = p_sale_id AND reversed_at IS NULL), 0)
      + COALESCE((SELECT SUM(amount) FROM public.mpesa_transactions
                  WHERE transaction_id = p_sale_id AND online_order_id IS NULL
                    AND status IN ('Pending', 'Completed')), 0)
    )::numeric(14,2);
$$;
REVOKE ALL ON FUNCTION public.fn_sale_till_linked(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_sale_till_linked(uuid) TO service_role;

-- 3. History --------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.mpesa_till_payment_events (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    till_payment_id uuid NOT NULL REFERENCES public.mpesa_till_payments(id) ON DELETE CASCADE,
    trans_id text NOT NULL,
    action text NOT NULL,
    previous_status text,
    new_status text,
    amount numeric(14,2),
    sale_id uuid,
    staff_name text,
    staff_user uuid DEFAULT auth.uid(),
    note text,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS mpesa_till_events_payment_idx ON public.mpesa_till_payment_events (till_payment_id, created_at);
ALTER TABLE public.mpesa_till_payment_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS pol_mpesa_till_events_select ON public.mpesa_till_payment_events;
CREATE POLICY pol_mpesa_till_events_select ON public.mpesa_till_payment_events FOR SELECT
    USING (public.has_permission(business_id, VARIADIC ARRAY['payments.view', 'payments.mpesa', 'payments.verify']));
REVOKE ALL ON public.mpesa_till_payment_events FROM anon, authenticated;
GRANT SELECT ON public.mpesa_till_payment_events TO authenticated;
GRANT ALL ON public.mpesa_till_payment_events TO service_role;

CREATE OR REPLACE FUNCTION public.fn_till_events_append_only() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
    IF TG_OP = 'DELETE' AND NOT EXISTS (SELECT 1 FROM public.businesses WHERE id = OLD.business_id) THEN RETURN OLD; END IF;
    RAISE EXCEPTION 'Payment history cannot be changed.';
END;
$$;
DROP TRIGGER IF EXISTS trg_till_events_append_only ON public.mpesa_till_payment_events;
CREATE TRIGGER trg_till_events_append_only BEFORE UPDATE OR DELETE ON public.mpesa_till_payment_events
    FOR EACH ROW EXECUTE FUNCTION public.fn_till_events_append_only();

-- Every arrival and status change is logged, whatever path made it.
CREATE OR REPLACE FUNCTION public.fn_till_payment_log() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    IF NEW.business_id IS NULL THEN RETURN NEW; END IF;
    IF TG_OP = 'INSERT' THEN
        INSERT INTO public.mpesa_till_payment_events (business_id, till_payment_id, trans_id, action, new_status, amount, staff_name)
        VALUES (NEW.business_id, NEW.id, NEW.trans_id, 'received', NEW.status, NEW.amount, 'M-Pesa');
    ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
        INSERT INTO public.mpesa_till_payment_events (business_id, till_payment_id, trans_id, action, previous_status, new_status, amount, sale_id, staff_name, note)
        VALUES (NEW.business_id, NEW.id, NEW.trans_id, 'status', OLD.status, NEW.status, NEW.amount, NEW.sale_id,
                COALESCE(NEW.handled_by, 'System'), NEW.note);
    END IF;
    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_till_payment_log ON public.mpesa_till_payments;
CREATE TRIGGER trg_till_payment_log AFTER INSERT OR UPDATE ON public.mpesa_till_payments
    FOR EACH ROW EXECUTE FUNCTION public.fn_till_payment_log();

-- A row set to matched_sale with a sale but no allocation (the callback's receipt-number match)
-- gets its allocation here, so every path keeps allocations and sale_id in step.
CREATE OR REPLACE FUNCTION public.fn_till_payment_sync_alloc() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_open numeric;
BEGIN
    IF NEW.status = 'matched_sale' AND NEW.sale_id IS NOT NULL AND NEW.business_id IS NOT NULL THEN
        SELECT COALESCE(SUM(amount), 0) INTO v_open FROM public.mpesa_till_allocations
        WHERE till_payment_id = NEW.id AND reversed_at IS NULL;
        IF v_open < NEW.amount THEN
            INSERT INTO public.mpesa_till_allocations (business_id, till_payment_id, sale_id, amount, allocated_by)
            VALUES (NEW.business_id, NEW.id, NEW.sale_id, NEW.amount - v_open, COALESCE(NEW.handled_by, 'System'));
            UPDATE public.mpesa_till_payments SET allocated = amount WHERE id = NEW.id AND allocated <> amount;
        END IF;
    END IF;
    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_till_payment_sync_alloc ON public.mpesa_till_payments;
CREATE TRIGGER trg_till_payment_sync_alloc AFTER INSERT OR UPDATE OF status, sale_id ON public.mpesa_till_payments
    FOR EACH ROW EXECUTE FUNCTION public.fn_till_payment_sync_alloc();

-- 4. Allocation -----------------------------------------------------------------------------
-- Gives part or all of a waiting till payment to one M-Pesa sale. Both rows are locked, so two
-- staff can't spend the same money twice or push a sale past its total. Never by amount alone:
-- staff choose the sale.
CREATE OR REPLACE FUNCTION public.allocate_till_payment(
    p_till_payment_id uuid,
    p_sale_id uuid,
    p_amount numeric,
    p_handled_by text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_row    public.mpesa_till_payments%ROWTYPE;
    v_sale   public.transactions%ROWTYPE;
    v_by     text := COALESCE(NULLIF(trim(p_handled_by), ''), 'Staff');
    v_amt    numeric(14,2) := round(p_amount, 2);
    v_left   numeric(14,2);
    v_room   numeric(14,2);
    v_status text;
    v_ref    text;
BEGIN
    SELECT * INTO v_row FROM public.mpesa_till_payments WHERE id = p_till_payment_id FOR UPDATE;
    IF NOT FOUND OR v_row.business_id IS NULL THEN
        RAISE EXCEPTION 'Till payment not found.';
    END IF;
    PERFORM public.assert_business_member(v_row.business_id);
    PERFORM public.assert_permission(v_row.business_id, 'payments.verify', 'payments.mpesa');
    IF v_row.status NOT IN ('unclaimed', 'under_review', 'partial') THEN
        RAISE EXCEPTION 'This payment was already handled by %.', COALESCE(v_row.handled_by, 'someone else');
    END IF;
    IF v_amt IS NULL OR v_amt <= 0 THEN
        RAISE EXCEPTION 'Enter an amount above zero.';
    END IF;
    v_left := v_row.amount - v_row.allocated;
    IF v_amt > v_left THEN
        RAISE EXCEPTION 'Only KSh % of this payment is left to give.', to_char(v_left, 'FM999,999,990.00');
    END IF;

    SELECT * INTO v_sale FROM public.transactions WHERE id = p_sale_id FOR UPDATE;
    IF NOT FOUND OR v_sale.business_id <> v_row.business_id OR v_sale.deleted_at IS NOT NULL THEN
        RAISE EXCEPTION 'Sale not found.';
    END IF;
    IF v_sale.payment_method <> 'M-Pesa' THEN
        RAISE EXCEPTION 'Only a sale paid by M-Pesa can take a till payment. Record it on the customer''s account instead.';
    END IF;
    v_room := v_sale.final_total - public.fn_sale_till_linked(v_sale.id);
    IF v_amt > v_room THEN
        IF v_room <= 0 THEN
            RAISE EXCEPTION 'This sale is already covered by till payments. Choose another sale.';
        END IF;
        RAISE EXCEPTION 'This sale only needs KSh % more.', to_char(v_room, 'FM999,999,990.00');
    END IF;

    v_ref := COALESCE(v_sale.reference_id, left(v_sale.id::text, 8));
    INSERT INTO public.mpesa_till_allocations (business_id, till_payment_id, sale_id, amount, allocated_by)
    VALUES (v_row.business_id, v_row.id, v_sale.id, v_amt, v_by);

    v_status := CASE WHEN v_left - v_amt = 0 THEN 'matched_sale' ELSE 'partial' END;
    INSERT INTO public.mpesa_till_payment_events (business_id, till_payment_id, trans_id, action, previous_status, new_status, amount, sale_id, staff_name, note)
    VALUES (v_row.business_id, v_row.id, v_row.trans_id, 'allocated', v_row.status, v_status, v_amt, v_sale.id, v_by, 'Sale ' || v_ref);

    UPDATE public.mpesa_till_payments
    SET allocated = allocated + v_amt, status = v_status, sale_id = v_sale.id,
        handled_by = v_by, handled_at = now(),
        note = CASE WHEN v_status = 'matched_sale' THEN 'Sale ' || v_ref ELSE note END
    WHERE id = v_row.id;

    RETURN jsonb_build_object('status', v_status, 'left', v_left - v_amt, 'sale_reference', v_ref);
END;
$$;
REVOKE ALL ON FUNCTION public.allocate_till_payment(uuid, uuid, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.allocate_till_payment(uuid, uuid, numeric, text) TO authenticated, service_role;

-- The old one-step link = allocate the whole amount.
CREATE OR REPLACE FUNCTION public.link_till_payment_to_sale(
    p_till_payment_id uuid, p_sale_id uuid, p_handled_by text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_row public.mpesa_till_payments%ROWTYPE;
BEGIN
    SELECT * INTO v_row FROM public.mpesa_till_payments WHERE id = p_till_payment_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Till payment not found.'; END IF;
    IF v_row.status NOT IN ('unclaimed', 'under_review', 'partial') THEN
        RAISE EXCEPTION 'This payment was already handled by %.', COALESCE(v_row.handled_by, 'someone else');
    END IF;
    PERFORM public.allocate_till_payment(p_till_payment_id, p_sale_id, v_row.amount - v_row.allocated, p_handled_by);
END;
$$;
REVOKE ALL ON FUNCTION public.link_till_payment_to_sale(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.link_till_payment_to_sale(uuid, uuid, text) TO authenticated, service_role;

-- Review flags. under_review / disputed hold the money out of matching until cleared;
-- reversed = Safaricom reversed it (the row stays, nothing is allocated).
CREATE OR REPLACE FUNCTION public.flag_till_payment(
    p_till_payment_id uuid, p_status text, p_note text, p_handled_by text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_row public.mpesa_till_payments%ROWTYPE;
    v_by  text := COALESCE(NULLIF(trim(p_handled_by), ''), 'Staff');
BEGIN
    SELECT * INTO v_row FROM public.mpesa_till_payments WHERE id = p_till_payment_id FOR UPDATE;
    IF NOT FOUND OR v_row.business_id IS NULL THEN RAISE EXCEPTION 'Till payment not found.'; END IF;
    PERFORM public.assert_business_member(v_row.business_id);
    PERFORM public.assert_permission(v_row.business_id, 'payments.verify', 'payments.mpesa');
    IF p_status NOT IN ('under_review', 'disputed', 'reversed', 'unclaimed') THEN
        RAISE EXCEPTION 'Unknown status %.', p_status;
    END IF;
    IF COALESCE(trim(p_note), '') = '' THEN RAISE EXCEPTION 'Say why.'; END IF;
    IF v_row.status IN ('recorded', 'ignored', 'reversed') THEN
        RAISE EXCEPTION 'This payment is already settled. Void its payment on the Payments screen first.';
    END IF;
    IF p_status = 'unclaimed' AND v_row.status NOT IN ('under_review', 'disputed') THEN
        RAISE EXCEPTION 'Only a payment under review or disputed can be cleared.';
    END IF;
    IF p_status = 'reversed' THEN
        UPDATE public.mpesa_till_allocations
        SET reversed_at = now(), reversed_by = v_by, reverse_reason = trim(p_note)
        WHERE till_payment_id = v_row.id AND reversed_at IS NULL;
        UPDATE public.mpesa_till_payments SET allocated = 0 WHERE id = v_row.id;
    END IF;
    UPDATE public.mpesa_till_payments
    SET status = CASE WHEN p_status = 'unclaimed' AND allocated > 0 THEN 'partial' ELSE p_status END,
        handled_by = v_by, handled_at = now(), note = trim(p_note)
    WHERE id = v_row.id;
END;
$$;
REVOKE ALL ON FUNCTION public.flag_till_payment(uuid, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.flag_till_payment(uuid, text, text, text) TO authenticated, service_role;

-- Under review / disputed should not lose their allocations when flagged; only reopen/reversal do.
CREATE OR REPLACE FUNCTION public.fn_till_payment_unlink_on_reopen() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
    IF NEW.status = OLD.status THEN RETURN NEW; END IF;
    -- A voided customer payment sends the rest back; what was already given to sales stays.
    IF NEW.status = 'unclaimed' AND OLD.status = 'recorded' AND NEW.allocated > 0 THEN
        NEW.status := 'partial';
        RETURN NEW;
    END IF;
    IF NEW.status IN ('unclaimed', 'ignored') AND OLD.status IN ('matched_sale', 'partial') THEN
        UPDATE public.mpesa_till_allocations
        SET reversed_at = now(), reversed_by = COALESCE(NEW.handled_by, 'Staff'), reverse_reason = 'Sent back to the queue'
        WHERE till_payment_id = NEW.id AND reversed_at IS NULL;
        NEW.allocated := 0;
    END IF;
    IF NEW.status NOT IN ('matched_sale', 'partial', 'under_review', 'disputed') OR NEW.allocated = 0 THEN
        IF NEW.status <> 'matched_sale' THEN NEW.sale_id := NULL; END IF;
    END IF;
    RETURN NEW;
END;
$$;

-- handle_till_payment: customer / walk-in now record only what is left, and work from
-- under_review and partial too. Reopen also clears partial, under review and disputed.
CREATE OR REPLACE FUNCTION public.handle_till_payment(
    p_till_payment_id uuid, p_action text, p_customer_id uuid DEFAULT NULL,
    p_note text DEFAULT NULL, p_handled_by text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_row  public.mpesa_till_payments%ROWTYPE;
    v_name TEXT;
    v_pid  UUID;
    v_by   TEXT := COALESCE(NULLIF(trim(p_handled_by), ''), 'Staff');
    v_left numeric(14,2);
BEGIN
    SELECT * INTO v_row FROM public.mpesa_till_payments WHERE id = p_till_payment_id FOR UPDATE;
    IF NOT FOUND OR v_row.business_id IS NULL THEN
        RAISE EXCEPTION 'Till payment not found.';
    END IF;
    PERFORM public.assert_business_member(v_row.business_id);
    PERFORM public.assert_permission(v_row.business_id, 'payments.verify', 'payments.mpesa');

    IF p_action = 'reopen' THEN
        IF v_row.status NOT IN ('matched_sale', 'partial', 'ignored', 'under_review', 'disputed') THEN
            RAISE EXCEPTION 'Only payments linked to a sale, ignored or flagged can go back to the queue. Void the payment instead.';
        END IF;
        UPDATE public.mpesa_till_payments
        SET status = 'unclaimed', handled_by = v_by, handled_at = NULL, note = NULLIF(trim(p_note), '')
        WHERE id = v_row.id;
        RETURN NULL;
    END IF;

    IF v_row.status NOT IN ('unclaimed', 'under_review', 'partial') THEN
        RAISE EXCEPTION 'This payment was already handled by %.', COALESCE(v_row.handled_by, 'someone else');
    END IF;
    v_left := v_row.amount - v_row.allocated;

    IF p_action IN ('customer', 'walk_in') THEN
        IF p_action = 'customer' THEN
            SELECT name INTO v_name FROM public.customers
            WHERE id = p_customer_id AND business_id = v_row.business_id AND deleted_at IS NULL;
            IF v_name IS NULL THEN
                RAISE EXCEPTION 'Choose a customer for this payment.';
            END IF;
        END IF;
        v_pid := public.process_business_payment(
            v_row.business_id, v_row.trans_id, v_left, 'M-Pesa',
            COALESCE(v_row.payer_name, v_name, 'M-Pesa customer'), v_row.msisdn, 'Success', v_row.trans_time,
            CASE WHEN p_action = 'customer' THEN p_customer_id END, v_name,
            CASE WHEN p_action = 'customer' THEN 'customer' ELSE 'walk-in' END,
            COALESCE(NULLIF(trim(p_note), ''), 'M-Pesa till payment'), v_by
        );
        UPDATE public.mpesa_till_payments
        SET status = 'recorded', payment_id = v_pid,
            customer_id = CASE WHEN p_action = 'customer' THEN p_customer_id END,
            handled_by = v_by, handled_at = NOW(), note = NULLIF(trim(p_note), '')
        WHERE id = v_row.id;
        RETURN v_pid;
    END IF;

    IF p_action = 'ignore' AND COALESCE(trim(p_note), '') = '' THEN
        RAISE EXCEPTION 'Say why this payment is being ignored.';
    END IF;
    IF p_action = 'ignore' AND v_row.allocated > 0 THEN
        RAISE EXCEPTION 'Part of this payment is already given to a sale. Send it back to the queue first.';
    END IF;
    IF p_action NOT IN ('sale', 'ignore') THEN
        RAISE EXCEPTION 'Unknown action %.', p_action;
    END IF;
    IF p_action = 'sale' THEN
        RAISE EXCEPTION 'Choose the sale this payment is for.';
    END IF;

    UPDATE public.mpesa_till_payments
    SET status = 'ignored', handled_by = v_by, handled_at = NOW(), note = NULLIF(trim(p_note), '')
    WHERE id = v_row.id;
    RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.handle_till_payment(uuid, text, uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.handle_till_payment(uuid, text, uuid, text, text) TO authenticated, service_role;

-- void_business_payment sends a linked till payment back to 'unclaimed'; the trigger logs it.

-- 5. Matching suggestions -------------------------------------------------------------------
-- Sales with room left for this payment, with why each is suggested. Room > 0 (partial allowed).
DROP FUNCTION IF EXISTS public.till_payment_sale_candidates(uuid, text, int);
CREATE OR REPLACE FUNCTION public.till_payment_sale_candidates(
    p_till_payment_id uuid, p_search text DEFAULT NULL, p_limit int DEFAULT 30
) RETURNS TABLE (
    sale_id uuid, reference text, created_at timestamptz, customer_name text, customer_phone text,
    total numeric, linked numeric, remaining numeric, same_amount boolean, score int, reasons text[]
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_row   public.mpesa_till_payments%ROWTYPE;
    v_q     text := NULLIF(trim(p_search), '');
    v_left  numeric;
    v_phone text;
BEGIN
    SELECT * INTO v_row FROM public.mpesa_till_payments WHERE id = p_till_payment_id;
    IF NOT FOUND OR v_row.business_id IS NULL THEN
        RAISE EXCEPTION 'Till payment not found.';
    END IF;
    PERFORM public.assert_business_member(v_row.business_id);
    PERFORM public.assert_permission(v_row.business_id, 'payments.verify', 'payments.mpesa');
    v_left := v_row.amount - v_row.allocated;
    v_phone := right(regexp_replace(COALESCE(v_row.msisdn, ''), '\D', '', 'g'), 9);

    RETURN QUERY
    WITH c AS (
        SELECT t.id, COALESCE(t.reference_id, left(t.id::text, 8)) AS ref, t.created_at AS at,
               cu.name AS cname, cu.phone AS cphone, t.final_total AS tot, l.linked AS lk,
               (t.final_total - l.linked) AS room,
               (v_phone <> '' AND length(v_phone) = 9 AND right(regexp_replace(COALESCE(cu.phone, ''), '\D', '', 'g'), 9) = v_phone) AS phone_match,
               (v_row.bill_ref IS NOT NULL AND upper(t.reference_id) = upper(v_row.bill_ref)) AS ref_match,
               (v_row.customer_id IS NOT NULL AND t.customer_id = v_row.customer_id) AS cust_match,
               abs(extract(epoch FROM (t.created_at - v_row.trans_time))) AS gap
        FROM public.transactions t
        LEFT JOIN public.customers cu ON cu.id = t.customer_id
        CROSS JOIN LATERAL (SELECT public.fn_sale_till_linked(t.id) AS linked) l
        WHERE t.business_id = v_row.business_id
          AND t.deleted_at IS NULL
          AND t.payment_method = 'M-Pesa'
          AND t.final_total - l.linked > 0
          AND (v_q IS NOT NULL OR t.created_at BETWEEN v_row.trans_time - interval '3 days' AND v_row.trans_time + interval '1 day')
          AND (v_q IS NULL OR t.reference_id ILIKE '%' || v_q || '%' OR cu.name ILIKE '%' || v_q || '%'
               OR cu.phone ILIKE '%' || v_q || '%' OR t.final_total::text = v_q)
    )
    SELECT c.id, c.ref, c.at, c.cname, c.cphone, c.tot, c.lk, c.room, c.room = v_left,
           (CASE WHEN c.ref_match THEN 100 ELSE 0 END + CASE WHEN c.phone_match THEN 50 ELSE 0 END
            + CASE WHEN c.cust_match THEN 40 ELSE 0 END
            + CASE WHEN c.gap <= 900 THEN 20 WHEN c.gap <= 3600 THEN 10 ELSE 0 END
            + CASE WHEN c.room = v_left THEN 5 ELSE 0 END)::int,
           array_remove(ARRAY[
               CASE WHEN c.ref_match THEN 'Account reference is this receipt' END,
               CASE WHEN c.phone_match THEN 'Sender phone is the sale''s customer' END,
               CASE WHEN c.cust_match THEN 'Same customer' END,
               CASE WHEN c.gap <= 900 THEN 'Within 15 minutes of the payment'
                    WHEN c.gap <= 3600 THEN 'Within an hour of the payment' END,
               CASE WHEN c.room = v_left THEN 'Balance equals what is left' END
           ], NULL)
    FROM c
    ORDER BY 10 DESC, c.gap
    LIMIT LEAST(GREATEST(COALESCE(p_limit, 30), 1), 100);
END;
$$;
REVOKE ALL ON FUNCTION public.till_payment_sale_candidates(uuid, text, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.till_payment_sale_candidates(uuid, text, int) TO authenticated, service_role;

-- 6. STK exceptions -------------------------------------------------------------------------
-- A paid prompt that was sent for a sale but could not prove it (sale removed or covered):
-- confirm_store_payment_request recorded the money as a payment and cleared transaction_id.
-- Mark those so they can be shown and reviewed; mpesa_transactions keeps its own row.
ALTER TABLE public.mpesa_transactions ADD COLUMN IF NOT EXISTS unmatched_sale_id uuid;
ALTER TABLE public.mpesa_transactions ADD COLUMN IF NOT EXISTS exception_resolved_at timestamptz;
ALTER TABLE public.mpesa_transactions ADD COLUMN IF NOT EXISTS exception_resolved_by text;

CREATE OR REPLACE FUNCTION public.fn_stk_mark_exception() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
    IF OLD.transaction_id IS NOT NULL AND NEW.transaction_id IS NULL AND NEW.online_order_id IS NULL THEN
        NEW.unmatched_sale_id := OLD.transaction_id;
    END IF;
    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_stk_mark_exception ON public.mpesa_transactions;
CREATE TRIGGER trg_stk_mark_exception BEFORE UPDATE OF transaction_id ON public.mpesa_transactions
    FOR EACH ROW EXECUTE FUNCTION public.fn_stk_mark_exception();

CREATE OR REPLACE FUNCTION public.stk_payment_exceptions(p_business_id uuid)
RETURNS TABLE (id uuid, receipt_number text, amount numeric, phone text, paid_at timestamptz,
               sale_id uuid, sale_reference text, payment_id uuid, requested_by text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
    PERFORM public.assert_business_member(p_business_id);
    PERFORM public.assert_permission(p_business_id, 'payments.verify', 'payments.mpesa');
    RETURN QUERY
    SELECT m.id, m.receipt_number, m.amount, m.phone, COALESCE(m.mpesa_receipt_timestamp, m.updated_at),
           m.unmatched_sale_id, COALESCE(t.reference_id, left(m.unmatched_sale_id::text, 8)), m.payment_id, m.requested_by
    FROM public.mpesa_transactions m
    LEFT JOIN public.transactions t ON t.id = m.unmatched_sale_id
    WHERE m.business_id = p_business_id AND m.unmatched_sale_id IS NOT NULL
      AND m.status = 'Completed' AND m.exception_resolved_at IS NULL
    ORDER BY m.updated_at DESC
    LIMIT 200;
END;
$$;
REVOKE ALL ON FUNCTION public.stk_payment_exceptions(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.stk_payment_exceptions(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.resolve_stk_exception(p_id uuid, p_note text, p_by text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_m public.mpesa_transactions%ROWTYPE;
BEGIN
    SELECT * INTO v_m FROM public.mpesa_transactions WHERE id = p_id FOR UPDATE;
    IF NOT FOUND OR v_m.business_id IS NULL THEN RAISE EXCEPTION 'Prompt not found.'; END IF;
    PERFORM public.assert_business_member(v_m.business_id);
    PERFORM public.assert_permission(v_m.business_id, 'payments.verify', 'payments.mpesa');
    IF COALESCE(trim(p_note), '') = '' THEN RAISE EXCEPTION 'Say how it was sorted.'; END IF;
    UPDATE public.mpesa_transactions
    SET exception_resolved_at = now(), exception_resolved_by = COALESCE(NULLIF(trim(p_by), ''), 'Staff') || ': ' || trim(p_note)
    WHERE id = p_id;
END;
$$;
REVOKE ALL ON FUNCTION public.resolve_stk_exception(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resolve_stk_exception(uuid, text, text) TO authenticated, service_role;

-- Realtime for the history and allocations so open screens update.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'mpesa_till_allocations') THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.mpesa_till_allocations;
    END IF;
EXCEPTION WHEN undefined_object THEN NULL;
END;
$$;

-- Read-only plans block changes here too, like every business table (20261204001).
DROP TRIGGER IF EXISTS trg_zz_plan_read_only ON public.mpesa_till_allocations;
CREATE TRIGGER trg_zz_plan_read_only BEFORE INSERT OR UPDATE OR DELETE ON public.mpesa_till_allocations
    FOR EACH ROW EXECUTE FUNCTION public.fn_block_when_read_only();
DROP TRIGGER IF EXISTS trg_zz_plan_read_only ON public.mpesa_till_payment_events;
CREATE TRIGGER trg_zz_plan_read_only BEFORE INSERT OR UPDATE OR DELETE ON public.mpesa_till_payment_events
    FOR EACH ROW EXECUTE FUNCTION public.fn_block_when_read_only();

-- ===================================================================
-- 20261214001_drop_sheets_sms_whatsapp
-- ===================================================================
-- Remove the Google Sheets backup (replaced by Settings -> Export data, run on demand in the
-- app) and the Twilio SMS and WhatsApp Cloud API connections. Their edge functions
-- (backup-config, sms-config, whatsapp-config) are removed in the same change.
-- backup_history_logs stays: log cleanup and retention still read it, and old rows are history.
-- destructive-ok: these tables belonged to the removed Google Sheets backup, Twilio SMS and WhatsApp connections; no app version left reads them (their screens and edge functions are gone).

DO $$
BEGIN
  -- Two steps: cron.job can only be named once we know the cron schema exists.
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'run-due-backups') THEN
      PERFORM cron.unschedule('run-due-backups');
    END IF;
  END IF;
END $$;

DROP FUNCTION IF EXISTS public.run_due_backups();

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['google_sheets_backup', 'sms_settings', 'whatsapp_settings'] LOOP
    IF EXISTS (SELECT 1 FROM pg_publication_tables
               WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = t) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime DROP TABLE public.%I', t);
    END IF;
    EXECUTE format('DROP TABLE IF EXISTS public.%I CASCADE', t);
  END LOOP;
END $$;

-- ===================================================================
-- 20261214002_mpesa_received_confirmed_sale_maker
-- ===================================================================
-- M-Pesa "payment received" messages (2026-11-28).
--
-- 1. Sent only once the money is confirmed. The till no longer announces an M-Pesa sale when
--    it is saved (nothing had arrived yet). Confirmation is: a completed STK prompt
--    (confirm_store_payment_request), a till payment carrying the sale's receipt number
--    (record_till_payment), or staff matching a till payment to the sale (allocate_till_payment,
--    which also covers link_till_payment_to_sale). The last one sent no message before.
-- 2. Seen only by the person who made the sale (transactions.staff_id), never by the Owner or
--    other staff. A prompt not tied to a sale goes only to whoever sent it (requested_user_id,
--    set by the mpesa-payments function). Older prompts without it send no message.
--    Payments nobody started (paid to a customer's account number, or waiting to be assigned)
--    still go to the team: there is no sale maker, and someone has to act on them.

ALTER TABLE public.mpesa_transactions ADD COLUMN IF NOT EXISTS requested_user_id uuid
    REFERENCES public.users(id) ON DELETE SET NULL;

-- One person's message. No person = no message.
CREATE OR REPLACE FUNCTION public.fn_notify_user(
    p_business_id uuid, p_user_id uuid, p_title text, p_message text, p_payload jsonb
) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
    INSERT INTO public.notifications (business_id, user_id, title, message, type, priority, payload, created_by)
    SELECT p_business_id, p_user_id, p_title, p_message, 'Payment Received', 'medium',
           COALESCE(p_payload, '{}'::jsonb), 'system'
    WHERE p_business_id IS NOT NULL AND p_user_id IS NOT NULL;
$$;
ALTER FUNCTION public.fn_notify_user(uuid, uuid, text, text, jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.fn_notify_user(uuid, uuid, text, text, jsonb) FROM PUBLIC, anon, authenticated;

-- The message for a sale goes to the person who made it. staff_id is the user's id (employees
-- share it); an older employees-only id is followed to its user.
CREATE OR REPLACE FUNCTION public.fn_notify_sale_maker(
    p_sale_id uuid, p_title text, p_message text, p_payload jsonb
) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
    SELECT public.fn_notify_user(t.business_id, COALESCE(u.id, e.user_id), p_title, p_message, p_payload)
    FROM public.transactions t
    LEFT JOIN public.users u ON u.id = t.staff_id
    LEFT JOIN public.employees e ON e.id = t.staff_id
    WHERE t.id = p_sale_id;
$$;
ALTER FUNCTION public.fn_notify_sale_maker(uuid, text, text, jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.fn_notify_sale_maker(uuid, text, text, jsonb) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION "public"."record_till_payment"("p_raw" "jsonb", "p_business_id" "uuid" DEFAULT NULL) RETURNS "text"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
    v_trans_id  TEXT := NULLIF(trim(p_raw->>'TransID'), '');
    v_amount    NUMERIC := NULLIF(p_raw->>'TransAmount', '')::NUMERIC;
    v_short     TEXT := NULLIF(trim(p_raw->>'BusinessShortCode'), '');
    v_ref       TEXT := NULLIF(trim(p_raw->>'BillRefNumber'), '');
    v_name      TEXT := NULLIF(trim(concat_ws(' ', p_raw->>'FirstName', p_raw->>'MiddleName', p_raw->>'LastName')), '');
    v_time      TIMESTAMPTZ;
    v_biz       UUID;
    v_cust_id   UUID;
    v_cust_name TEXT;
    v_row_id    UUID;
    v_pid       UUID;
    v_sale_id   UUID;
    v_sale_ref  TEXT;
    v_matches   INT;
BEGIN
    IF v_trans_id IS NULL OR COALESCE(v_amount, 0) <= 0 THEN
        RAISE EXCEPTION 'Till confirmation is missing TransID or TransAmount.';
    END IF;

    BEGIN
        -- Safaricom sends Nairobi local time as YYYYMMDDHHmmss.
        v_time := COALESCE(to_timestamp(p_raw->>'TransTime', 'YYYYMMDDHH24MISS')::TIMESTAMP AT TIME ZONE 'Africa/Nairobi', NOW());
    EXCEPTION WHEN OTHERS THEN
        v_time := NOW();
    END;

    -- The callback URL's token names the business. Otherwise only an exact till match counts:
    -- a payment to an unknown till never lands on some other business.
    v_biz := p_business_id;
    IF v_biz IS NULL THEN
        SELECT business_id INTO v_biz FROM public.mpesa_settings WHERE till_number = v_short;
    END IF;

    INSERT INTO public.mpesa_till_payments (
        business_id, trans_id, trans_type, amount, short_code, bill_ref, msisdn, payer_name, trans_time, raw
    )
    VALUES (
        v_biz, v_trans_id, p_raw->>'TransactionType', v_amount, v_short, v_ref,
        NULLIF(p_raw->>'MSISDN', ''), v_name, v_time, p_raw
    )
    ON CONFLICT (trans_id) DO NOTHING
    RETURNING id INTO v_row_id;

    IF v_row_id IS NULL THEN
        RETURN 'duplicate';
    END IF;
    IF v_biz IS NULL THEN
        RAISE WARNING 'Till payment % for short code % matches no business', v_trans_id, v_short;
        RETURN 'no_business';
    END IF;

    -- The payer typed a sale's receipt number as the account (paybill): link it only when exactly
    -- one M-Pesa sale has that number and still has room for this amount. Never by amount alone.
    IF v_ref IS NOT NULL THEN
        SELECT count(*), min(t.id::text)::uuid, min(t.reference_id) INTO v_matches, v_sale_id, v_sale_ref
        FROM public.transactions t
        WHERE t.business_id = v_biz AND t.deleted_at IS NULL AND t.payment_method = 'M-Pesa'
          AND upper(t.reference_id) = upper(v_ref)
          AND t.final_total - public.fn_sale_till_linked(t.id) >= v_amount;
        IF v_matches = 1 THEN
            UPDATE public.mpesa_till_payments
            SET status = 'matched_sale', sale_id = v_sale_id,
                handled_by = 'Matched by receipt number', handled_at = NOW(), note = 'Sale ' || v_sale_ref
            WHERE id = v_row_id;
            PERFORM public.fn_notify_sale_maker(v_sale_id, 'M-Pesa payment received',
                format('Ksh %s for sale %s (%s).', v_amount, v_sale_ref, v_trans_id),
                jsonb_build_object('tillPaymentId', v_row_id, 'saleId', v_sale_id));
            RETURN 'matched_sale';
        END IF;
    END IF;

    -- Paybill-style payments carry the account number, so those settle themselves.
    IF v_ref IS NOT NULL THEN
        SELECT id, name INTO v_cust_id, v_cust_name FROM public.customers
        WHERE business_id = v_biz AND deleted_at IS NULL
          AND upper(account_number) = upper(v_ref);
    END IF;

    IF v_cust_id IS NOT NULL THEN
        v_pid := public.process_business_payment(
            v_biz, v_trans_id, v_amount, 'M-Pesa', COALESCE(v_name, v_cust_name),
            p_raw->>'MSISDN', 'Success', v_time, v_cust_id, v_cust_name, 'customer',
            'M-Pesa till payment', 'M-Pesa'
        );
        UPDATE public.mpesa_till_payments
        SET status = 'recorded', customer_id = v_cust_id, payment_id = v_pid,
            handled_by = 'Matched by account number', handled_at = NOW()
        WHERE id = v_row_id;
        PERFORM public.fn_notify_staff(v_biz, 'M-Pesa payment received',
            format('Ksh %s from %s (%s).', v_amount, v_cust_name, v_trans_id),
            jsonb_build_object('paymentId', v_pid));
        RETURN 'recorded';
    END IF;

    PERFORM public.fn_notify_staff(v_biz, 'M-Pesa till payment to assign',
        format('Ksh %s from %s (%s). Open Payments > M-Pesa to assign it.', v_amount, COALESCE(v_name, 'a customer'), v_trans_id),
        jsonb_build_object('tillPaymentId', v_row_id));
    RETURN 'queued';
END;
$$;

ALTER FUNCTION public.record_till_payment(jsonb, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.record_till_payment(jsonb, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_till_payment(jsonb, uuid) TO service_role;

CREATE OR REPLACE FUNCTION "public"."confirm_store_payment_request"("p_checkout_request_id" "text", "p_result_code" integer, "p_amount" numeric, "p_receipt" "text", "p_raw" "jsonb") RETURNS "text"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
    v_req     public.mpesa_transactions%ROWTYPE;
    v_name    TEXT;
    v_pid     UUID;
    v_amount  NUMERIC;
    v_sale    public.transactions%ROWTYPE;
    v_other   NUMERIC;
BEGIN
    SELECT * INTO v_req FROM public.mpesa_transactions
    WHERE checkout_request_id = p_checkout_request_id
      AND online_order_id IS NULL AND business_id IS NOT NULL
    FOR UPDATE;
    IF NOT FOUND THEN
        RETURN 'unknown';
    END IF;
    -- Settled earlier from the status query (stand-in receipt): the late callback brings the
    -- real receipt number. Only the reference text changes; no money moves.
    IF v_req.status = 'Completed' AND p_result_code = 0 AND p_receipt IS NOT NULL
       AND p_receipt NOT LIKE 'QRY-%' AND v_req.receipt_number LIKE 'QRY-%' THEN
        UPDATE public.payments SET reference_code = p_receipt
        WHERE id = v_req.payment_id AND reference_code = v_req.receipt_number;
        UPDATE public.mpesa_transactions
        SET receipt_number = p_receipt, raw_callback = p_raw, updated_at = NOW()
        WHERE id = v_req.id;
        RETURN 'receipt_added';
    END IF;
    IF v_req.status = 'Completed' OR (v_req.status <> 'Pending' AND p_result_code <> 0) THEN
        RETURN 'duplicate';
    END IF;

    IF p_result_code <> 0 THEN
        UPDATE public.mpesa_transactions
        SET status = 'Failed', raw_callback = COALESCE(p_raw, raw_callback), updated_at = NOW()
        WHERE id = v_req.id;
        RETURN 'failed';
    END IF;

    IF p_receipt IS NULL THEN
        RAISE EXCEPTION 'A successful M-Pesa result arrived without a receipt number.';
    END IF;

    v_amount := COALESCE(p_amount, v_req.amount);

    -- Prompt sent for a sale: the sale already counted this money. Only the proof is stored,
    -- as long as the sale still exists and this doesn't take it over its total.
    IF v_req.transaction_id IS NOT NULL THEN
        SELECT * INTO v_sale FROM public.transactions WHERE id = v_req.transaction_id FOR UPDATE;
        IF FOUND AND v_sale.deleted_at IS NULL AND v_sale.payment_method = 'M-Pesa' THEN
            v_other := public.fn_sale_till_linked(v_sale.id) - v_req.amount;
            IF v_other + v_amount <= v_sale.final_total THEN
                UPDATE public.mpesa_transactions
                SET status = 'Completed', receipt_number = p_receipt, amount = v_amount,
                    mpesa_receipt_timestamp = NOW(), raw_callback = p_raw, updated_at = NOW()
                WHERE id = v_req.id;
                PERFORM public.fn_notify_sale_maker(v_sale.id, 'M-Pesa payment received',
                    format('Ksh %s for sale %s (%s).', v_amount,
                           COALESCE(v_sale.reference_id, left(v_sale.id::text, 8)), p_receipt),
                    jsonb_build_object('saleId', v_sale.id));
                RETURN 'matched_sale';
            END IF;
        END IF;
        -- The sale is gone or already covered: unlink and record the money as a payment below.
        UPDATE public.mpesa_transactions SET transaction_id = NULL WHERE id = v_req.id;
    END IF;

    SELECT name INTO v_name FROM public.customers WHERE id = v_req.customer_id;

    v_pid := public.process_business_payment(
        v_req.business_id, p_receipt, v_amount, 'M-Pesa',
        COALESCE(v_name, 'M-Pesa ' || v_req.phone), v_req.phone, 'Success', NOW(),
        v_req.customer_id, v_name,
        CASE WHEN v_req.customer_id IS NULL THEN 'walk-in' ELSE 'customer' END,
        COALESCE(v_req.description, 'M-Pesa prompt'), v_req.requested_by
    );

    UPDATE public.mpesa_transactions
    SET status = 'Completed', receipt_number = p_receipt,
        amount = v_amount, mpesa_receipt_timestamp = NOW(),
        raw_callback = p_raw, payment_id = v_pid, updated_at = NOW()
    WHERE id = v_req.id;

    PERFORM public.fn_notify_user(v_req.business_id, v_req.requested_user_id, 'M-Pesa payment received',
        format('Ksh %s from %s (%s).', v_amount, COALESCE(v_name, v_req.phone), p_receipt),
        jsonb_build_object('paymentId', v_pid));
    RETURN 'recorded';
END;
$$;
REVOKE ALL ON FUNCTION public.confirm_store_payment_request(text, integer, numeric, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_store_payment_request(text, integer, numeric, text, jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.allocate_till_payment(
    p_till_payment_id uuid,
    p_sale_id uuid,
    p_amount numeric,
    p_handled_by text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_row    public.mpesa_till_payments%ROWTYPE;
    v_sale   public.transactions%ROWTYPE;
    v_by     text := COALESCE(NULLIF(trim(p_handled_by), ''), 'Staff');
    v_amt    numeric(14,2) := round(p_amount, 2);
    v_left   numeric(14,2);
    v_room   numeric(14,2);
    v_status text;
    v_ref    text;
BEGIN
    SELECT * INTO v_row FROM public.mpesa_till_payments WHERE id = p_till_payment_id FOR UPDATE;
    IF NOT FOUND OR v_row.business_id IS NULL THEN
        RAISE EXCEPTION 'Till payment not found.';
    END IF;
    PERFORM public.assert_business_member(v_row.business_id);
    PERFORM public.assert_permission(v_row.business_id, 'payments.verify', 'payments.mpesa');
    IF v_row.status NOT IN ('unclaimed', 'under_review', 'partial') THEN
        RAISE EXCEPTION 'This payment was already handled by %.', COALESCE(v_row.handled_by, 'someone else');
    END IF;
    IF v_amt IS NULL OR v_amt <= 0 THEN
        RAISE EXCEPTION 'Enter an amount above zero.';
    END IF;
    v_left := v_row.amount - v_row.allocated;
    IF v_amt > v_left THEN
        RAISE EXCEPTION 'Only KSh % of this payment is left to give.', to_char(v_left, 'FM999,999,990.00');
    END IF;

    SELECT * INTO v_sale FROM public.transactions WHERE id = p_sale_id FOR UPDATE;
    IF NOT FOUND OR v_sale.business_id <> v_row.business_id OR v_sale.deleted_at IS NOT NULL THEN
        RAISE EXCEPTION 'Sale not found.';
    END IF;
    IF v_sale.payment_method <> 'M-Pesa' THEN
        RAISE EXCEPTION 'Only a sale paid by M-Pesa can take a till payment. Record it on the customer''s account instead.';
    END IF;
    v_room := v_sale.final_total - public.fn_sale_till_linked(v_sale.id);
    IF v_amt > v_room THEN
        IF v_room <= 0 THEN
            RAISE EXCEPTION 'This sale is already covered by till payments. Choose another sale.';
        END IF;
        RAISE EXCEPTION 'This sale only needs KSh % more.', to_char(v_room, 'FM999,999,990.00');
    END IF;

    v_ref := COALESCE(v_sale.reference_id, left(v_sale.id::text, 8));
    INSERT INTO public.mpesa_till_allocations (business_id, till_payment_id, sale_id, amount, allocated_by)
    VALUES (v_row.business_id, v_row.id, v_sale.id, v_amt, v_by);

    v_status := CASE WHEN v_left - v_amt = 0 THEN 'matched_sale' ELSE 'partial' END;
    INSERT INTO public.mpesa_till_payment_events (business_id, till_payment_id, trans_id, action, previous_status, new_status, amount, sale_id, staff_name, note)
    VALUES (v_row.business_id, v_row.id, v_row.trans_id, 'allocated', v_row.status, v_status, v_amt, v_sale.id, v_by, 'Sale ' || v_ref);

    UPDATE public.mpesa_till_payments
    SET allocated = allocated + v_amt, status = v_status, sale_id = v_sale.id,
        handled_by = v_by, handled_at = now(),
        note = CASE WHEN v_status = 'matched_sale' THEN 'Sale ' || v_ref ELSE note END
    WHERE id = v_row.id;

    PERFORM public.fn_notify_sale_maker(v_sale.id, 'M-Pesa payment received',
        format('Ksh %s for sale %s (%s), matched by %s.', v_amt, v_ref, v_row.trans_id, v_by),
        jsonb_build_object('tillPaymentId', v_row.id, 'saleId', v_sale.id));

    RETURN jsonb_build_object('status', v_status, 'left', v_left - v_amt, 'sale_reference', v_ref);
END;
$$;
REVOKE ALL ON FUNCTION public.allocate_till_payment(uuid, uuid, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.allocate_till_payment(uuid, uuid, numeric, text) TO authenticated, service_role;

-- ===================================================================
-- 20261215001_daraja_callback_inbox
-- ===================================================================
-- Daraja callbacks are kept before they are processed (2026-11-28).
--
-- Found in the Daraja audit:
--   1. A callback whose processing threw (any database error) was answered 500 and kept nowhere
--      but a log line without its payload. Safaricom does not reliably resend STK or C2B
--      callbacks, so that money had no record.
--   2. The prompt row is saved after Safaricom accepts the STK push, so a fast callback could
--      arrive first, find nothing ("unknown") and be dropped.
--   3. Disconnecting and reconnecting M-Pesa deleted the business's callback token and made a
--      new one, so the till URLs already registered with Safaricom were refused (403) forever.
--      Live tills can't simply be registered again.
--   4. An online order settled from the status query kept its stand-in "QRY-" receipt even when
--      the real callback came later (only in-store prompts swapped it).
--
-- Fix: every callback is first stored in daraja_callbacks (one row per CheckoutRequestID / TransID),
-- then processed in a sub-transaction. A failure or an unmatched prompt stays on the row and
-- payment-sweep retries it. The callback token now lives in its own table and survives a
-- disconnect. Money still moves only through the existing functions (confirm_online_order_payment,
-- confirm_store_payment_request, record_till_payment), so the books are unchanged (money rule 2).

-- 1. Stable callback token per business -----------------------------------------------------
CREATE TABLE IF NOT EXISTS public.mpesa_callback_tokens (
    business_id uuid PRIMARY KEY REFERENCES public.businesses(id) ON DELETE CASCADE,
    token       text NOT NULL UNIQUE CHECK (token ~ '^[0-9a-f]{48}$'),
    created_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.mpesa_callback_tokens ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.mpesa_callback_tokens FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.mpesa_callback_tokens TO service_role;

INSERT INTO public.mpesa_callback_tokens (business_id, token)
SELECT business_id, callback_token FROM public.mpesa_payment_secrets
ON CONFLICT (business_id) DO NOTHING;

-- Reconnecting reuses the business's token, so URLs registered earlier keep working.
CREATE OR REPLACE FUNCTION public.fn_mpesa_keep_token() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_token text;
BEGIN
    SELECT token INTO v_token FROM public.mpesa_callback_tokens WHERE business_id = NEW.business_id;
    IF v_token IS NOT NULL THEN
        NEW.callback_token := v_token;
    END IF;
    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_mpesa_keep_token ON public.mpesa_payment_secrets;
CREATE TRIGGER trg_mpesa_keep_token BEFORE INSERT ON public.mpesa_payment_secrets
    FOR EACH ROW EXECUTE FUNCTION public.fn_mpesa_keep_token();

CREATE OR REPLACE FUNCTION public.fn_mpesa_save_token() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    INSERT INTO public.mpesa_callback_tokens (business_id, token)
    VALUES (NEW.business_id, NEW.callback_token)
    ON CONFLICT (business_id) DO UPDATE SET token = EXCLUDED.token;
    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_mpesa_save_token ON public.mpesa_payment_secrets;
CREATE TRIGGER trg_mpesa_save_token AFTER INSERT OR UPDATE OF callback_token ON public.mpesa_payment_secrets
    FOR EACH ROW EXECUTE FUNCTION public.fn_mpesa_save_token();

-- The business a callback URL's token belongs to (even while M-Pesa is disconnected:
-- money that arrives must still be recorded).
CREATE OR REPLACE FUNCTION public.fn_mpesa_business_by_token(p_token text) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT business_id FROM public.mpesa_callback_tokens
    WHERE p_token ~ '^[0-9a-f]{48}$' AND token = p_token;
$$;
REVOKE ALL ON FUNCTION public.fn_mpesa_business_by_token(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_mpesa_business_by_token(text) TO service_role;

-- 2. Callback inbox ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.daraja_callbacks (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id      uuid REFERENCES public.businesses(id) ON DELETE CASCADE,
    kind             text NOT NULL CHECK (kind IN ('stk', 'c2b_confirmation', 'c2b_validation')),
    -- CheckoutRequestID (stk) or TransID (c2b). Null only for a payload too broken to read.
    dedupe_key       text,
    payload          jsonb NOT NULL,
    -- received: stored, not processed yet | processed: done (see result)
    -- unmatched: no prompt with this CheckoutRequestID yet (retried) | failed: processing threw (retried)
    -- rejected: never processed (malformed, another business's prompt, or retried for 3 days)
    status           text NOT NULL DEFAULT 'received'
                     CHECK (status IN ('received', 'processed', 'unmatched', 'failed', 'rejected')),
    result           text,
    error            text,
    attempts         int NOT NULL DEFAULT 0,
    deliveries       int NOT NULL DEFAULT 1,
    received_at      timestamptz NOT NULL DEFAULT now(),
    last_received_at timestamptz NOT NULL DEFAULT now(),
    next_try_at      timestamptz NOT NULL DEFAULT now(),
    processed_at     timestamptz,
    UNIQUE (kind, dedupe_key)
);
CREATE INDEX IF NOT EXISTS daraja_callbacks_retry_idx ON public.daraja_callbacks (next_try_at)
    WHERE status IN ('received', 'unmatched', 'failed');
CREATE INDEX IF NOT EXISTS daraja_callbacks_business_idx ON public.daraja_callbacks (business_id, kind, received_at DESC);
ALTER TABLE public.daraja_callbacks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.daraja_callbacks FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.daraja_callbacks TO service_role;

-- Stores a callback. A repeat delivery only counts up. Returns the row id and its status.
CREATE OR REPLACE FUNCTION public.daraja_callback_receive(p_kind text, p_business_id uuid, p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_key    text;
    v_id     uuid;
    v_status text;
    v_result text;
    v_new    boolean;
BEGIN
    v_key := NULLIF(trim(CASE WHEN p_kind = 'stk'
        THEN p_payload #>> '{Body,stkCallback,CheckoutRequestID}'
        ELSE p_payload ->> 'TransID' END), '');

    INSERT INTO public.daraja_callbacks (business_id, kind, dedupe_key, payload, status, error)
    VALUES (p_business_id, p_kind, v_key, p_payload,
            CASE WHEN v_key IS NULL THEN 'rejected' ELSE 'received' END,
            CASE WHEN v_key IS NULL THEN 'Payload has no CheckoutRequestID / TransID.' END)
    ON CONFLICT (kind, dedupe_key) DO UPDATE
        SET deliveries = daraja_callbacks.deliveries + 1, last_received_at = now()
    RETURNING id, status, result, (xmax = 0) INTO v_id, v_status, v_result, v_new;

    RETURN jsonb_build_object('id', v_id, 'status', v_status, 'result', v_result,
                              'duplicate', NOT v_new, 'key', v_key);
END;
$$;
REVOKE ALL ON FUNCTION public.daraja_callback_receive(text, uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.daraja_callback_receive(text, uuid, jsonb) TO service_role;

-- An online order first settled from the status query gets the real receipt from the late callback.
-- Only the reference text changes; no money moves.
CREATE OR REPLACE FUNCTION public.fn_online_order_real_receipt(p_checkout_request_id text, p_receipt text, p_raw jsonb)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_pay public.mpesa_transactions%ROWTYPE;
BEGIN
    IF p_receipt IS NULL OR p_receipt LIKE 'QRY-%' THEN RETURN false; END IF;
    SELECT * INTO v_pay FROM public.mpesa_transactions
    WHERE checkout_request_id = p_checkout_request_id AND online_order_id IS NOT NULL
      AND status = 'Completed' AND receipt_number LIKE 'QRY-%'
    FOR UPDATE;
    IF NOT FOUND THEN RETURN false; END IF;
    UPDATE public.mpesa_transactions
    SET receipt_number = p_receipt, raw_callback = p_raw, updated_at = now()
    WHERE id = v_pay.id;
    UPDATE public.online_orders SET mpesa_receipt = p_receipt
    WHERE id = v_pay.online_order_id AND mpesa_receipt = v_pay.receipt_number;
    RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.fn_online_order_real_receipt(text, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_online_order_real_receipt(text, text, jsonb) TO service_role;

-- Processes one stored callback through the existing money functions. Never raises: an error
-- rolls back only this attempt and is kept on the row for the next try.
CREATE OR REPLACE FUNCTION public.daraja_callback_process(p_id uuid) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_row      public.daraja_callbacks%ROWTYPE;
    v_cb       jsonb;
    v_items    jsonb;
    v_code     int;
    v_amount   numeric;
    v_receipt  text;
    v_owner    uuid;
    v_result   text;
    v_err      text;
BEGIN
    SELECT * INTO v_row FROM public.daraja_callbacks WHERE id = p_id FOR UPDATE SKIP LOCKED;
    IF NOT FOUND THEN RETURN 'busy'; END IF;
    IF v_row.status IN ('processed', 'rejected') THEN RETURN v_row.result; END IF;

    BEGIN
        IF v_row.kind = 'c2b_validation' THEN
            v_result := 'accepted';

        ELSIF v_row.kind = 'c2b_confirmation' THEN
            -- Safaricom sends missing names as "" (record_till_payment would join them with
            -- double spaces); the stored payload keeps the original.
            v_result := public.record_till_payment(
                v_row.payload - COALESCE((SELECT array_agg(k) FROM jsonb_each_text(v_row.payload) e(k, v)
                                          WHERE k IN ('FirstName', 'MiddleName', 'LastName') AND trim(v) = ''), '{}'::text[]),
                v_row.business_id);

        ELSE
            v_cb := v_row.payload #> '{Body,stkCallback}';
            v_code := (v_cb ->> 'ResultCode')::int;
            IF v_code IS NULL THEN
                RAISE EXCEPTION 'STK callback has no ResultCode.';
            END IF;
            v_items := COALESCE(v_cb #> '{CallbackMetadata,Item}', '[]'::jsonb);
            SELECT NULLIF(i->>'Value', '')::numeric INTO v_amount
                FROM jsonb_array_elements(v_items) i WHERE i->>'Name' = 'Amount' LIMIT 1;
            SELECT NULLIF(i->>'Value', '') INTO v_receipt
                FROM jsonb_array_elements(v_items) i WHERE i->>'Name' = 'MpesaReceiptNumber' LIMIT 1;

            -- A business's token only settles that business's own prompts.
            SELECT business_id INTO v_owner FROM public.mpesa_transactions
            WHERE checkout_request_id = v_row.dedupe_key;
            IF v_owner IS NOT NULL AND v_owner IS DISTINCT FROM v_row.business_id THEN
                v_result := 'wrong_business';
            ELSIF v_code = 0 AND public.fn_online_order_real_receipt(v_row.dedupe_key, v_receipt, v_row.payload) THEN
                v_result := 'receipt_added';
            ELSE
                v_result := public.confirm_online_order_payment(v_row.dedupe_key, v_code, v_amount, v_receipt, v_row.payload);
                IF v_result = 'unknown' THEN
                    v_result := public.confirm_store_payment_request(v_row.dedupe_key, v_code, v_amount, v_receipt, v_row.payload);
                END IF;
            END IF;
        END IF;
    EXCEPTION WHEN OTHERS THEN
        v_err := SQLERRM;
    END;

    IF v_err IS NOT NULL THEN
        UPDATE public.daraja_callbacks
        SET status = 'failed', error = left(v_err, 1000), attempts = attempts + 1,
            next_try_at = now() + make_interval(mins => least(power(2, attempts)::int, 60))
        WHERE id = p_id;
        RAISE WARNING 'Daraja callback % (% %) failed: %', p_id, v_row.kind, v_row.dedupe_key, v_err;
        RETURN 'failed';
    END IF;

    IF v_result = 'unknown' THEN
        -- The prompt row may not be saved yet (the callback beat it), so try again shortly.
        UPDATE public.daraja_callbacks
        SET status = 'unmatched', result = v_result, error = NULL, attempts = attempts + 1,
            next_try_at = now() + make_interval(mins => least(attempts + 1, 30))
        WHERE id = p_id;
    ELSIF v_result = 'wrong_business' THEN
        UPDATE public.daraja_callbacks
        SET status = 'rejected', result = v_result, error = 'Token belongs to another business.',
            attempts = attempts + 1, processed_at = now()
        WHERE id = p_id;
    ELSE
        UPDATE public.daraja_callbacks
        SET status = 'processed', result = v_result, error = NULL, attempts = attempts + 1, processed_at = now()
        WHERE id = p_id;
    END IF;
    RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION public.daraja_callback_process(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.daraja_callback_process(uuid) TO service_role;

-- Called by payment-sweep: retries stored callbacks that are due, for up to 3 days. Older ones
-- are marked rejected (the row, payload and last error stay) so they leave the retry index.
CREATE OR REPLACE FUNCTION public.daraja_callback_retry(p_limit int DEFAULT 50) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_id   uuid;
    v_res  text;
    v_out  jsonb := '{}'::jsonb;
BEGIN
    UPDATE public.daraja_callbacks
    SET status = 'rejected', error = left('Gave up after 3 days. ' || COALESCE(error, result, ''), 1000)
    WHERE status IN ('received', 'unmatched', 'failed') AND received_at <= now() - interval '3 days';

    FOR v_id IN
        SELECT id FROM public.daraja_callbacks
        WHERE status IN ('received', 'unmatched', 'failed') AND next_try_at <= now()
        ORDER BY next_try_at
        LIMIT p_limit
    LOOP
        v_res := COALESCE(public.daraja_callback_process(v_id), 'null');
        v_out := jsonb_set(v_out, ARRAY[v_res], to_jsonb(COALESCE((v_out ->> v_res)::int, 0) + 1));
    END LOOP;
    RETURN v_out;
END;
$$;
REVOKE ALL ON FUNCTION public.daraja_callback_retry(int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.daraja_callback_retry(int) TO service_role;

-- ===================================================================
-- 20261215002_debt_payment_moves_money
-- ===================================================================
-- Customers > Pay debt moves the money balance (2026-11-28, found by the M-Pesa reconciliation).
--
-- process_debt_payment wrote debt_payments and customer_ledger only. The customer_ledger trigger
-- posted the money account in the books, but money_assets never moved and no payments row was
-- made, so the Payments screen balance fell behind the books for every method (money rule 2).
--
-- It now keeps its own checks (permission, not more than owed; the amount check is
-- process_business_payment's) and records the money through
-- process_business_payment, the same path as till payments and prompts: one payments row moves
-- money_assets, and its '-debt-payment' ledger row posts the books, settles credit oldest first
-- and earns points. Rows recorded before this change are left as they are (live had none).

CREATE OR REPLACE FUNCTION public.process_debt_payment(
    p_business_id uuid, p_customer_id uuid, p_amount numeric, p_method text,
    p_recorded_by text, p_note text, p_reference_id text
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
    v_amount NUMERIC(14,2) := round(COALESCE(p_amount, 0), 2);
    v_ref    TEXT := COALESCE(NULLIF(trim(p_reference_id), ''), 'debt-pay-' || gen_random_uuid());
    v_cust   public.customers%ROWTYPE;
BEGIN
    PERFORM public.assert_permission(p_business_id, 'customers.debts', 'payments.cash');
    PERFORM public.assert_business_member(p_business_id);

    -- Already recorded (old ledger-only rows, or a payment with this reference): safe to retry.
    IF EXISTS (SELECT 1 FROM public.customer_ledger WHERE business_id = p_business_id AND reference_id = v_ref)
       OR EXISTS (SELECT 1 FROM public.payments WHERE business_id = p_business_id AND reference_code = v_ref) THEN
        RETURN;
    END IF;

    SELECT * INTO v_cust FROM public.customers
    WHERE id = p_customer_id AND business_id = p_business_id
    FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Customer not found: %', p_customer_id;
    END IF;
    IF v_cust.merged_into_id IS NOT NULL THEN
        SELECT * INTO v_cust FROM public.customers WHERE id = v_cust.merged_into_id FOR UPDATE;
    END IF;
    IF v_amount > COALESCE(v_cust.debt_balance, 0) THEN
        RAISE EXCEPTION 'Cannot pay off more than outstanding debt.';
    END IF;

    PERFORM public.process_business_payment(
        p_business_id, v_ref, v_amount, p_method, v_cust.name, v_cust.phone, 'Success', NOW(),
        v_cust.id, v_cust.name, 'customer',
        COALESCE(NULLIF(trim(p_note), ''), 'Debt payment via ' || p_method),
        p_recorded_by
    );
END;
$$;

REVOKE ALL ON FUNCTION public.process_debt_payment(uuid, uuid, numeric, text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.process_debt_payment(uuid, uuid, numeric, text, text, text, text) TO authenticated, service_role;

-- ===================================================================
-- 20261216001_website_more_fonts_designs
-- ===================================================================
-- 20261216001_website_more_fonts_designs.sql
-- Website design rebuild (2026-11-28): more fonts and five designs made for one kind of business.
--
--   * fn_website_fonts() gains 17 Google fonts (website/src/engine/brand.ts FONTS). Four are
--     display faces the website uses for headings only (Syne, Bebas Neue, DM Serif Display,
--     Abril Fatface); the database allows them in both columns and the website falls back to the
--     design's text font if one is chosen for text.
--   * personality and design_preset accept 'fresh', 'editorial', 'care', 'workshop', 'bistro'
--     (website/src/engine/presets.ts).
--   * Colour sets need no change: they fill the existing colour columns.
--   * No data changes. Shops with design_preset 'original' look exactly as before.
--
-- Reverse: restore fn_website_fonts() and the two checks from 20261206001 (only if no row uses
--          the new values: UPDATE website_brand SET ... = NULL first).

CREATE OR REPLACE FUNCTION public.fn_website_fonts()
RETURNS text[]
LANGUAGE sql IMMUTABLE
SET search_path = ''
AS $$
    -- Keep in step with FONTS in website/src/engine/brand.ts.
    SELECT ARRAY['Poppins', 'Inter', 'DM Sans', 'Manrope', 'Work Sans', 'Nunito Sans', 'Outfit',
                 'Archivo', 'Space Grotesk', 'IBM Plex Sans', 'Lora', 'Playfair Display',
                 'Cormorant Garamond', 'Fraunces', 'Source Serif 4',
                 'Plus Jakarta Sans', 'Figtree', 'Sora', 'Lexend', 'Rubik', 'Montserrat', 'Raleway',
                 'Josefin Sans', 'Barlow', 'Bricolage Grotesque', 'Syne', 'Bebas Neue',
                 'DM Serif Display', 'Libre Baskerville', 'EB Garamond', 'Merriweather', 'Abril Fatface'];
$$;

ALTER TABLE public.website_brand DROP CONSTRAINT IF EXISTS website_brand_personality_check;
ALTER TABLE public.website_brand ADD CONSTRAINT website_brand_personality_check CHECK (personality IS NULL OR personality IN (
    'premium', 'friendly', 'bold', 'classic', 'minimal', 'natural', 'technical', 'playful',
    'fresh', 'editorial', 'care', 'workshop', 'bistro'));

ALTER TABLE public.website_brand DROP CONSTRAINT IF EXISTS website_brand_design_preset_check;
ALTER TABLE public.website_brand ADD CONSTRAINT website_brand_design_preset_check CHECK (design_preset IS NULL OR design_preset IN (
    'original', 'premium', 'friendly', 'bold', 'classic', 'minimal', 'natural', 'technical', 'playful',
    'fresh', 'editorial', 'care', 'workshop', 'bistro'));
