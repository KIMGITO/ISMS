-- SaaS: companies (tenants), plans, modules, limits, trial and the platform admin (2026-11-24).
--
-- Until now the "system creator" was simply the first person ever to become an Owner, and only
-- that person could create businesses, so a second company could never sign up. A branch is a
-- row of `businesses`; branches were grouped only by sharing an Owner.
--
-- Now:
-- * platform_admins: the people who run the platform (the developer). Not tied to any business.
--   is_system_creator() now means "is a platform admin".
-- * tenants: the paying company. Every business row (branch) belongs to one tenant. Existing
--   branches are grouped by their Owner. Stock transfers check "same tenant".
-- * plans + tenant_subscriptions: the plan of each tenant (trial, starter, pro, pro_plus,
--   perpetual), its status, add-ons and per-tenant custom limits set by the platform admin.
-- * Modules: a permission whose module is not in the plan answers FALSE in has_permission, for
--   the Owner too. Background work (books posting, callbacks, cron) does not run as an app role
--   and is not affected, so the books stay complete while a module is locked.
-- * Limits: branches and staff (Owner, riders and suppliers are not staff) are checked in the
--   database when a branch is added or restored, an invitation is made or a member joins.
-- * Read-only: when a trial ends unpaid or a paid period runs out (after grace), writes by app
--   users to the tenant's business tables are refused. Reading and exporting still work.
--   Payment callbacks and other server work still record money (money rule 1).
-- * Trial on/off switch (platform_settings), one trial per person, sign-up requests the
--   platform admin approves (for bank transfers and agreed deals), and platform_* functions for
--   the admin website: change any tenant's plan by hand without payment, add-ons, custom limits,
--   extend a trial, list tenants with counts only.

-- ============================================================================================
-- 1. Platform admins
-- ============================================================================================
CREATE TABLE IF NOT EXISTS public.platform_admins (
    auth_user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    name text,
    created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.platform_admins ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS pol_platform_admins_select ON public.platform_admins;
CREATE POLICY pol_platform_admins_select ON public.platform_admins
    FOR SELECT TO authenticated USING (auth_user_id = (SELECT auth.uid()));
REVOKE ALL ON public.platform_admins FROM anon, authenticated;
GRANT SELECT ON public.platform_admins TO authenticated;
GRANT ALL ON public.platform_admins TO service_role;

CREATE OR REPLACE FUNCTION public.is_platform_admin(p_auth_user_id uuid DEFAULT auth.uid())
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT p_auth_user_id IS NOT NULL
       AND EXISTS (SELECT 1 FROM public.platform_admins pa WHERE pa.auth_user_id = p_auth_user_id);
$$;
REVOKE ALL ON FUNCTION public.is_platform_admin(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_platform_admin(uuid) TO authenticated, service_role;

-- Whoever the old rule treated as the system creator (the first Owner) becomes the first
-- platform admin, so nothing changes for the live system. More are added by SQL only.
INSERT INTO public.platform_admins (auth_user_id, name)
SELECT u.auth_user_id, u.name
FROM public.business_memberships bm
JOIN public.users u ON u.id = bm.user_id
WHERE bm.role = 'Owner' AND u.auth_user_id IS NOT NULL
  AND EXISTS (SELECT 1 FROM auth.users au WHERE au.id = u.auth_user_id)
ORDER BY bm.created_at, bm.id
LIMIT 1
ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION public.is_system_creator(p_auth_user_id uuid DEFAULT auth.uid())
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $$ SELECT public.is_platform_admin(p_auth_user_id); $$;
REVOKE ALL ON FUNCTION public.is_system_creator(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_system_creator(uuid) TO authenticated, service_role;

-- What the platform admin did (plan changes, approvals). Only platform admins read it.
CREATE TABLE IF NOT EXISTS public.platform_audit (
    id bigserial PRIMARY KEY,
    tenant_id uuid,
    action text NOT NULL,
    details jsonb NOT NULL DEFAULT '{}'::jsonb,
    by_auth_user_id uuid DEFAULT auth.uid(),
    created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.platform_audit ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS pol_platform_audit_select ON public.platform_audit;
CREATE POLICY pol_platform_audit_select ON public.platform_audit
    FOR SELECT TO authenticated USING ((SELECT public.is_platform_admin()));
REVOKE ALL ON public.platform_audit FROM anon, authenticated;
GRANT SELECT ON public.platform_audit TO authenticated;
GRANT ALL ON public.platform_audit TO service_role;

CREATE OR REPLACE FUNCTION public.fn_platform_log(p_tenant_id uuid, p_action text, p_details jsonb)
RETURNS void
LANGUAGE sql SECURITY DEFINER
SET search_path = ''
AS $$
    INSERT INTO public.platform_audit (tenant_id, action, details) VALUES (p_tenant_id, p_action, COALESCE(p_details, '{}'::jsonb));
$$;
REVOKE ALL ON FUNCTION public.fn_platform_log(uuid, text, jsonb) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.fn_require_platform_admin()
RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF NOT public.is_platform_admin() THEN
        RAISE EXCEPTION 'Only the platform admin can do this.' USING ERRCODE = '42501';
    END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.fn_require_platform_admin() FROM PUBLIC, anon, authenticated;

-- ============================================================================================
-- 2. Platform settings (one row)
-- ============================================================================================
CREATE TABLE IF NOT EXISTS public.platform_settings (
    id boolean PRIMARY KEY DEFAULT true CHECK (id),
    trial_enabled boolean NOT NULL DEFAULT true,
    trial_days integer NOT NULL DEFAULT 14 CHECK (trial_days BETWEEN 1 AND 90),
    trial_plan text NOT NULL DEFAULT 'trial',
    grace_days integer NOT NULL DEFAULT 7 CHECK (grace_days BETWEEN 0 AND 60),
    read_only_days integer NOT NULL DEFAULT 30 CHECK (read_only_days BETWEEN 0 AND 365),
    platform_domain text CHECK (platform_domain IS NULL OR platform_domain ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$'),
    updated_at timestamptz NOT NULL DEFAULT now(),
    updated_by uuid
);
INSERT INTO public.platform_settings (id) VALUES (true) ON CONFLICT DO NOTHING;
ALTER TABLE public.platform_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS pol_platform_settings_select ON public.platform_settings;
CREATE POLICY pol_platform_settings_select ON public.platform_settings
    FOR SELECT TO authenticated USING (true);
REVOKE ALL ON public.platform_settings FROM anon, authenticated;
GRANT SELECT ON public.platform_settings TO authenticated;
GRANT ALL ON public.platform_settings TO service_role;

-- ============================================================================================
-- 3. Modules and plans
-- ============================================================================================
-- Modules a business can run without. Everything not listed here is core (every plan).
CREATE TABLE IF NOT EXISTS public.plan_modules (
    key text PRIMARY KEY CHECK (key ~ '^[a-z_]+$'),
    name text NOT NULL,
    tier text NOT NULL CHECK (tier IN ('growth', 'advanced')),
    addable boolean NOT NULL DEFAULT false,  -- a Pro tenant can buy it on its own
    sort integer NOT NULL DEFAULT 0
);
INSERT INTO public.plan_modules (key, name, tier, addable, sort) VALUES
    ('buying',         'Buying and suppliers',  'growth',   false, 10),
    ('stock_report',   'Stock report',          'growth',   false, 20),
    ('transfers',      'Branch transfers',      'growth',   false, 30),
    ('deliveries',     'Deliveries and riders', 'growth',   false, 40),
    ('promotions',     'Promotions and points', 'growth',   false, 50),
    ('regular_orders', 'Regular orders',        'growth',   false, 60),
    ('production',     'Production and BOM',    'growth',   false, 70),
    ('quotes',         'Quotes and orders',     'growth',   false, 80),
    ('messaging',      'Bulk messaging',        'growth',   false, 90),
    ('online_store',   'Online store',          'advanced', true,  100),
    ('accounting',     'Books and accounting',  'advanced', true,  110),
    ('ai',             'AI assistant and insights', 'advanced', true, 120),
    ('own_domain',     'Own web address',       'advanced', true,  130)
ON CONFLICT (key) DO UPDATE SET name = EXCLUDED.name, tier = EXCLUDED.tier,
    addable = EXCLUDED.addable, sort = EXCLUDED.sort;

-- Which permissions belong to which module (LIKE patterns; the longest match wins).
CREATE TABLE IF NOT EXISTS public.module_permissions (
    pattern text PRIMARY KEY,
    module text NOT NULL REFERENCES public.plan_modules(key) ON DELETE CASCADE
);
INSERT INTO public.module_permissions (pattern, module) VALUES
    ('suppliers.%', 'buying'), ('purchases.%', 'buying'), ('supplier_bills.%', 'buying'),
    ('supplier_portal.%', 'buying'),
    ('inventory.transfer_stock', 'transfers'), ('inventory.receive_stock', 'transfers'),
    ('inventory.request_transfer', 'transfers'),
    ('deliveries.%', 'deliveries'), ('orders.assign_rider', 'deliveries'),
    ('settings.delivery', 'deliveries'), ('reports.deliveries', 'deliveries'),
    ('promotions.%', 'promotions'), ('referrals.%', 'promotions'), ('loyalty.%', 'promotions'),
    ('customers.loyalty', 'promotions'), ('pos.apply_promotion', 'promotions'),
    ('customers.schedules', 'regular_orders'),
    ('bom.%', 'production'), ('production.%', 'production'),
    ('quotes.%', 'quotes'), ('sales_orders.%', 'quotes'),
    ('communication.%', 'messaging'),
    ('online_store.%', 'online_store'),
    ('accounting.%', 'accounting'),
    ('ai.%', 'ai')
ON CONFLICT (pattern) DO UPDATE SET module = EXCLUDED.module;

CREATE TABLE IF NOT EXISTS public.plans (
    code text PRIMARY KEY CHECK (code ~ '^[a-z0-9_]+$'),
    name text NOT NULL,
    kind text NOT NULL CHECK (kind IN ('trial', 'subscription', 'perpetual')),
    description text,
    monthly_price numeric(14,2) CHECK (monthly_price >= 0),
    annual_price numeric(14,2) CHECK (annual_price >= 0),
    one_time_price numeric(14,2) CHECK (one_time_price >= 0),   -- NULL on perpetual = "ask us"
    max_branches integer NOT NULL CHECK (max_branches >= 1),
    max_staff integer NOT NULL CHECK (max_staff >= 0),
    storage_mb integer NOT NULL CHECK (storage_mb >= 0),
    ai_daily_cap integer NOT NULL DEFAULT 0 CHECK (ai_daily_cap >= 0),
    ai_addon_daily_cap integer NOT NULL DEFAULT 0 CHECK (ai_addon_daily_cap >= 0),
    modules text[] NOT NULL DEFAULT '{}',
    addons_allowed boolean NOT NULL DEFAULT false,
    own_ai_key boolean NOT NULL DEFAULT false,      -- the tenant brings its own AI key
    show_powered_by boolean NOT NULL DEFAULT false, -- small "Powered by" line on the store
    is_public boolean NOT NULL DEFAULT true,
    active boolean NOT NULL DEFAULT true,
    sort integer NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.plans (code, name, kind, description, monthly_price, annual_price, one_time_price,
                          max_branches, max_staff, storage_mb, ai_daily_cap, ai_addon_daily_cap,
                          modules, addons_allowed, own_ai_key, show_powered_by, sort) VALUES
    ('trial', 'Free trial', 'trial', 'Try everything for free.', 0, 0, NULL,
     1, 2, 1024, 20, 0,
     ARRAY['buying','stock_report','transfers','deliveries','promotions','regular_orders','production','quotes','messaging','online_store','accounting','ai'],
     false, false, true, 0),
    ('starter', 'Starter', 'subscription', 'One shop: selling, stock, customers, money and staff.', 3000, 30000, NULL,
     1, 3, 1024, 0, 0, ARRAY[]::text[], false, false, false, 10),
    ('pro', 'Pro', 'subscription', 'Up to 3 branches with buying, deliveries, promotions and more.', 6000, 60000, NULL,
     3, 10, 5120, 0, 50,
     ARRAY['buying','stock_report','transfers','deliveries','promotions','regular_orders','production','quotes','messaging'],
     true, false, true, 20),
    ('pro_plus', 'Pro Plus', 'subscription', 'Everything: online store, books and accounting, AI.', 12000, 120000, NULL,
     10, 30, 20480, 100, 0,
     ARRAY['buying','stock_report','transfers','deliveries','promotions','regular_orders','production','quotes','messaging','online_store','accounting','ai','own_domain'],
     false, false, false, 30),
    ('perpetual', 'Perpetual licence', 'perpetual', 'Pay once. You bring your own AI key and provider accounts; the licence stays ours.', NULL, NULL, NULL,
     10, 30, 5120, 0, 0,
     ARRAY['buying','stock_report','transfers','deliveries','promotions','regular_orders','production','quotes','messaging','online_store','accounting','ai','own_domain'],
     false, true, false, 40)
ON CONFLICT (code) DO NOTHING;

ALTER TABLE public.plan_modules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.module_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.plans ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS pol_plan_modules_select ON public.plan_modules;
CREATE POLICY pol_plan_modules_select ON public.plan_modules FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS pol_module_permissions_select ON public.module_permissions;
CREATE POLICY pol_module_permissions_select ON public.module_permissions FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS pol_plans_select ON public.plans;
CREATE POLICY pol_plans_select ON public.plans FOR SELECT TO authenticated
    USING (active OR (SELECT public.is_platform_admin()));
REVOKE ALL ON public.plan_modules, public.module_permissions, public.plans FROM anon, authenticated;
GRANT SELECT ON public.plan_modules, public.module_permissions, public.plans TO authenticated;
GRANT ALL ON public.plan_modules, public.module_permissions, public.plans TO service_role;

-- ============================================================================================
-- 4. Tenants (the paying company) and their subscription
-- ============================================================================================
CREATE TABLE IF NOT EXISTS public.tenants (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name text NOT NULL CHECK (length(trim(name)) > 0),
    owner_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_tenants_owner ON public.tenants(owner_user_id);

CREATE TABLE IF NOT EXISTS public.tenant_subscriptions (
    tenant_id uuid PRIMARY KEY REFERENCES public.tenants(id) ON DELETE CASCADE,
    plan_code text NOT NULL REFERENCES public.plans(code),
    status text NOT NULL DEFAULT 'trial' CHECK (status IN ('trial', 'active', 'suspended')),
    billing_cycle text NOT NULL DEFAULT 'trial' CHECK (billing_cycle IN ('trial', 'monthly', 'annual', 'one_time', 'manual')),
    started_at timestamptz NOT NULL DEFAULT now(),
    trial_ends_at timestamptz,
    current_period_end timestamptz,     -- NULL = no end (perpetual, or set by hand)
    addons text[] NOT NULL DEFAULT '{}',
    custom_limits jsonb NOT NULL DEFAULT '{}'::jsonb,
    note text,
    updated_at timestamptz NOT NULL DEFAULT now(),
    updated_by uuid
);

ALTER TABLE public.businesses ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES public.tenants(id);
CREATE INDEX IF NOT EXISTS idx_businesses_tenant ON public.businesses(tenant_id);

-- Group the existing branches: one tenant per Owner; a business without an Owner gets its own.
-- Everything that exists today goes on Pro Plus with no end date (the platform admin can move
-- any of them to another plan by hand).
DO $$
DECLARE
    r record;
    v_tenant uuid;
BEGIN
    -- The Owner of each business (the first one, should there be more).
    CREATE TEMP TABLE _owner_of ON COMMIT DROP AS
    SELECT DISTINCT ON (bm.business_id) bm.business_id, bm.user_id
    FROM public.business_memberships bm
    JOIN public.businesses b ON b.id = bm.business_id
    WHERE bm.role = 'Owner' AND bm.status = 'Active' AND b.tenant_id IS NULL
    ORDER BY bm.business_id, bm.created_at, bm.id;

    FOR r IN
        SELECT o.user_id, (array_agg(b.name ORDER BY b.created_at, b.id))[1] AS name
        FROM _owner_of o JOIN public.businesses b ON b.id = o.business_id
        GROUP BY o.user_id
    LOOP
        INSERT INTO public.tenants (name, owner_user_id) VALUES (r.name, r.user_id) RETURNING id INTO v_tenant;
        UPDATE public.businesses SET tenant_id = v_tenant
        WHERE id IN (SELECT business_id FROM _owner_of WHERE user_id = r.user_id);
    END LOOP;

    FOR r IN SELECT id, name FROM public.businesses WHERE tenant_id IS NULL LOOP
        INSERT INTO public.tenants (name) VALUES (r.name) RETURNING id INTO v_tenant;
        UPDATE public.businesses SET tenant_id = v_tenant WHERE id = r.id;
    END LOOP;

    INSERT INTO public.tenant_subscriptions (tenant_id, plan_code, status, billing_cycle, note)
    SELECT t.id, 'pro_plus', 'active', 'manual', 'Existing before plans (2026-11-24)'
    FROM public.tenants t
    ON CONFLICT (tenant_id) DO NOTHING;
END;
$$;

ALTER TABLE public.businesses ALTER COLUMN tenant_id SET NOT NULL;

-- A new tenant starts on the trial plan (create_business_with_owner then sets the real plan).
CREATE OR REPLACE FUNCTION public.fn_tenant_default_subscription()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    s public.platform_settings;
BEGIN
    SELECT * INTO s FROM public.platform_settings WHERE id;
    INSERT INTO public.tenant_subscriptions (tenant_id, plan_code, status, billing_cycle, trial_ends_at)
    VALUES (NEW.id, COALESCE(s.trial_plan, 'trial'), 'trial', 'trial',
            now() + make_interval(days => COALESCE(s.trial_days, 14)))
    ON CONFLICT (tenant_id) DO NOTHING;
    RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.fn_tenant_default_subscription() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_tenant_default_subscription ON public.tenants;
CREATE TRIGGER trg_tenant_default_subscription AFTER INSERT ON public.tenants
    FOR EACH ROW EXECUTE FUNCTION public.fn_tenant_default_subscription();

-- A business inserted without a tenant (seed scripts, tests) gets a tenant of its own; when its
-- Owner joins and already owns a tenant, it moves into that one (fn_business_owner_tenant).
CREATE OR REPLACE FUNCTION public.fn_business_default_tenant()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF NEW.tenant_id IS NULL THEN
        INSERT INTO public.tenants (name) VALUES (NEW.name) RETURNING id INTO NEW.tenant_id;
    END IF;
    RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.fn_business_default_tenant() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_a_business_default_tenant ON public.businesses;
CREATE TRIGGER trg_a_business_default_tenant BEFORE INSERT ON public.businesses
    FOR EACH ROW EXECUTE FUNCTION public.fn_business_default_tenant();

CREATE OR REPLACE FUNCTION public.fn_business_owner_tenant()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_tenant uuid;
    v_owner uuid;
    v_other uuid;
BEGIN
    IF NEW.role <> 'Owner' OR NEW.status <> 'Active' THEN
        RETURN NULL;
    END IF;
    SELECT b.tenant_id INTO v_tenant FROM public.businesses b WHERE b.id = NEW.business_id;
    SELECT t.owner_user_id INTO v_owner FROM public.tenants t WHERE t.id = v_tenant;
    IF v_tenant IS NULL OR v_owner IS NOT NULL THEN
        RETURN NULL;
    END IF;
    SELECT t.id INTO v_other FROM public.tenants t
    WHERE t.owner_user_id = NEW.user_id AND t.id <> v_tenant
    ORDER BY t.created_at LIMIT 1;
    IF v_other IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM public.businesses b WHERE b.tenant_id = v_tenant AND b.id <> NEW.business_id) THEN
        PERFORM set_config('isms.tenant_move', 'on', true);
        UPDATE public.businesses SET tenant_id = v_other WHERE id = NEW.business_id;
        PERFORM set_config('isms.tenant_move', '', true);
        DELETE FROM public.tenants WHERE id = v_tenant;
    ELSE
        UPDATE public.tenants SET owner_user_id = NEW.user_id, updated_at = now() WHERE id = v_tenant;
    END IF;
    RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.fn_business_owner_tenant() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_business_owner_tenant ON public.business_memberships;
CREATE TRIGGER trg_business_owner_tenant AFTER INSERT ON public.business_memberships
    FOR EACH ROW EXECUTE FUNCTION public.fn_business_owner_tenant();

-- Nobody in the app moves a branch to another company.
CREATE OR REPLACE FUNCTION public.fn_business_tenant_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
    IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
       AND COALESCE(current_setting('role', true), 'none') IN ('anon', 'authenticated')
       AND COALESCE(current_setting('isms.tenant_move', true), '') <> 'on'
       AND NOT public.is_platform_admin() THEN
        RAISE EXCEPTION 'A branch can''t be moved to another company.' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.fn_business_tenant_guard() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_business_tenant_guard ON public.businesses;
CREATE TRIGGER trg_business_tenant_guard BEFORE UPDATE OF tenant_id ON public.businesses
    FOR EACH ROW EXECUTE FUNCTION public.fn_business_tenant_guard();

-- Members of any branch see their tenant and its subscription; platform admins see all.
ALTER TABLE public.tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenant_subscriptions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS pol_tenants_select ON public.tenants;
CREATE POLICY pol_tenants_select ON public.tenants FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM public.businesses b
            WHERE b.tenant_id = tenants.id AND b.id = ANY (public.get_user_business_ids()))
    OR (SELECT public.is_platform_admin()));
DROP POLICY IF EXISTS pol_tenant_subscriptions_select ON public.tenant_subscriptions;
CREATE POLICY pol_tenant_subscriptions_select ON public.tenant_subscriptions FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM public.businesses b
            WHERE b.tenant_id = tenant_subscriptions.tenant_id AND b.id = ANY (public.get_user_business_ids()))
    OR (SELECT public.is_platform_admin()));
REVOKE ALL ON public.tenants, public.tenant_subscriptions FROM anon, authenticated;
GRANT SELECT ON public.tenants, public.tenant_subscriptions TO authenticated;
GRANT ALL ON public.tenants, public.tenant_subscriptions TO service_role;

-- Plan answers are kept for the rest of the request; any change to these bumps the counter.
DROP TRIGGER IF EXISTS trg_perm_cache_bump ON public.tenant_subscriptions;
CREATE TRIGGER trg_perm_cache_bump AFTER INSERT OR UPDATE OR DELETE OR TRUNCATE ON public.tenant_subscriptions
  FOR EACH STATEMENT EXECUTE FUNCTION public.fn_perm_cache_bump();
DROP TRIGGER IF EXISTS trg_perm_cache_bump ON public.plans;
CREATE TRIGGER trg_perm_cache_bump AFTER INSERT OR UPDATE OR DELETE OR TRUNCATE ON public.plans
  FOR EACH STATEMENT EXECUTE FUNCTION public.fn_perm_cache_bump();
DROP TRIGGER IF EXISTS trg_perm_cache_bump ON public.module_permissions;
CREATE TRIGGER trg_perm_cache_bump AFTER INSERT OR UPDATE OR DELETE OR TRUNCATE ON public.module_permissions
  FOR EACH STATEMENT EXECUTE FUNCTION public.fn_perm_cache_bump();
DROP TRIGGER IF EXISTS trg_perm_cache_bump ON public.platform_settings;
CREATE TRIGGER trg_perm_cache_bump AFTER INSERT OR UPDATE OR DELETE OR TRUNCATE ON public.platform_settings
  FOR EACH STATEMENT EXECUTE FUNCTION public.fn_perm_cache_bump();
DROP TRIGGER IF EXISTS trg_perm_cache_bump_tenant ON public.businesses;
CREATE TRIGGER trg_perm_cache_bump_tenant AFTER INSERT OR UPDATE OF tenant_id, deleted_at ON public.businesses
  FOR EACH STATEMENT EXECUTE FUNCTION public.fn_perm_cache_bump();

-- ============================================================================================
-- 5. What a tenant's plan allows right now
-- ============================================================================================
CREATE OR REPLACE FUNCTION public.fn_business_tenant(p_business_id uuid)
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $$ SELECT b.tenant_id FROM public.businesses b WHERE b.id = p_business_id; $$;
REVOKE ALL ON FUNCTION public.fn_business_tenant(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_business_tenant(uuid) TO service_role;

-- Status: trial (until trial_ends_at, then read_only), active (until current_period_end, then
-- grace for grace_days, then read_only for read_only_days, then suspended), suspended (by hand).
CREATE OR REPLACE FUNCTION public.fn_tenant_plan(p_tenant_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    s public.tenant_subscriptions;
    p public.plans;
    st public.platform_settings;
    c jsonb;
    v_key text;
    v_hit text;
    v_status text;
    v_mod text[];
    v_addons text[];
    v_cap integer;
    r jsonb;
BEGIN
    IF p_tenant_id IS NULL THEN
        RETURN NULL;
    END IF;
    v_key := 'isms_tp.t' || md5(p_tenant_id::text || '|' || public.fn_perm_cache_gen());
    v_hit := current_setting(v_key, true);
    IF v_hit IS NOT NULL AND v_hit <> '' THEN
        RETURN v_hit::jsonb;
    END IF;

    SELECT * INTO s FROM public.tenant_subscriptions WHERE tenant_id = p_tenant_id;
    IF NOT FOUND THEN
        RETURN NULL;
    END IF;
    SELECT * INTO p FROM public.plans WHERE code = s.plan_code;
    SELECT * INTO st FROM public.platform_settings WHERE id;
    c := COALESCE(s.custom_limits, '{}'::jsonb);

    IF s.status = 'suspended' THEN
        v_status := 'suspended';
    ELSIF s.status = 'trial' THEN
        v_status := CASE WHEN s.trial_ends_at IS NULL OR now() < s.trial_ends_at THEN 'trial' ELSE 'read_only' END;
    ELSIF s.current_period_end IS NULL OR now() <= s.current_period_end THEN
        v_status := 'active';
    ELSIF now() <= s.current_period_end + make_interval(days => COALESCE(st.grace_days, 7)) THEN
        v_status := 'grace';
    ELSIF now() <= s.current_period_end + make_interval(days => COALESCE(st.grace_days, 7) + COALESCE(st.read_only_days, 30)) THEN
        v_status := 'read_only';
    ELSE
        v_status := 'suspended';
    END IF;

    v_addons := CASE WHEN p.addons_allowed
                     THEN ARRAY(SELECT a FROM unnest(s.addons) a
                                WHERE a IN (SELECT m.key FROM public.plan_modules m WHERE m.addable))
                     ELSE ARRAY[]::text[] END;
    v_mod := ARRAY(
        SELECT DISTINCT x FROM (
            SELECT unnest(p.modules) AS x
            UNION ALL SELECT unnest(v_addons)
            UNION ALL SELECT jsonb_array_elements_text(CASE WHEN jsonb_typeof(c->'modules') = 'array' THEN c->'modules' ELSE '[]'::jsonb END)
        ) m WHERE x IN (SELECT key FROM public.plan_modules)
        ORDER BY x);

    v_cap := COALESCE((c->>'ai_daily_cap')::integer,
                      CASE WHEN 'ai' = ANY (v_addons) AND p.ai_addon_daily_cap > 0 THEN p.ai_addon_daily_cap
                           ELSE p.ai_daily_cap END);

    r := jsonb_build_object(
        'tenant_id', p_tenant_id,
        'plan', p.code,
        'plan_name', p.name,
        'kind', p.kind,
        'status', v_status,
        'writable', v_status IN ('trial', 'active', 'grace'),
        'billing_cycle', s.billing_cycle,
        'trial_ends_at', s.trial_ends_at,
        'period_end', s.current_period_end,
        'max_branches', COALESCE((c->>'max_branches')::integer, p.max_branches),
        'max_staff', COALESCE((c->>'max_staff')::integer, p.max_staff),
        'storage_mb', COALESCE((c->>'storage_mb')::integer, p.storage_mb),
        'ai_daily_cap', v_cap,
        'modules', to_jsonb(v_mod),
        'addons', to_jsonb(v_addons),
        'own_ai_key', p.own_ai_key,
        'powered_by', p.show_powered_by AND NOT ('own_domain' = ANY (v_mod)));
    PERFORM set_config(v_key, r::text, true);
    RETURN r;
END;
$$;
REVOKE ALL ON FUNCTION public.fn_tenant_plan(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_tenant_plan(uuid) TO service_role;

-- The module a permission belongs to (NULL = core, every plan).
CREATE OR REPLACE FUNCTION public.fn_permission_module(p_code text)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT mp.module FROM public.module_permissions mp
    WHERE p_code LIKE mp.pattern
    ORDER BY length(mp.pattern) DESC
    LIMIT 1;
$$;
REVOKE ALL ON FUNCTION public.fn_permission_module(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_permission_module(text) TO service_role;

-- Does the business's plan include this module? Core (NULL) always does. Truthful for every
-- caller (edge functions use it with the service role).
CREATE OR REPLACE FUNCTION public.has_module(p_business_id uuid, p_module text)
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    r jsonb;
BEGIN
    IF p_module IS NULL OR p_module = '' THEN
        RETURN true;
    END IF;
    r := public.fn_tenant_plan(public.fn_business_tenant(p_business_id));
    RETURN COALESCE(r->'modules' ? p_module, false);
END;
$$;
REVOKE ALL ON FUNCTION public.has_module(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.has_module(uuid, text) TO service_role;

-- has_permission (20261201005) plus modules: a permission whose module the plan lacks is not
-- granted, to the Owner either. Non-app callers still get TRUE before any lookup, as before.
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

    -- Already answered in this request?
    v_key := 'isms_hp.k' || md5(COALESCE(auth.uid()::text, '-') || '|' || COALESCE(p_business_id::text, '-')
                                || '|' || array_to_string(p_permissions, ',') || '|' || public.fn_perm_cache_gen());
    v_hit := current_setting(v_key, TRUE);
    IF v_hit IN ('t', 'f') THEN
        RETURN v_hit = 't';
    END IF;

    -- Only the permissions whose module is in the plan count.
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
          AND bm.status = 'Active';

        IF v_role IS NULL THEN
            v_result := FALSE;
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

-- Branches of one company: stock transfers, promotions and referrals use this.
CREATE OR REPLACE FUNCTION public.fn_branches_share_owner(p_a uuid, p_b uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.businesses a
        JOIN public.businesses b ON b.tenant_id = a.tenant_id
        WHERE a.id = p_a AND b.id = p_b
    );
$$;

-- ============================================================================================
-- 6. Read-only: no app writes to a tenant's business tables unless its plan is writable
-- ============================================================================================
CREATE OR REPLACE FUNCTION public.fn_plan_read_only_message(p_status text)
RETURNS text
LANGUAGE sql IMMUTABLE
SET search_path = ''
AS $$
    SELECT CASE p_status
        WHEN 'suspended' THEN 'This business is suspended. Contact support to continue.'
        ELSE 'This business is read-only until a plan is chosen. Your records are safe and can still be viewed and exported.'
    END;
$$;

CREATE OR REPLACE FUNCTION public.fn_block_when_read_only()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_business uuid;
    r jsonb;
BEGIN
    IF COALESCE(current_setting('role', true), 'none') NOT IN ('anon', 'authenticated') THEN
        RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
    END IF;
    IF TG_OP = 'DELETE' THEN
        v_business := (to_jsonb(OLD)->>'business_id')::uuid;
    ELSE
        v_business := (to_jsonb(NEW)->>'business_id')::uuid;
    END IF;
    IF v_business IS NOT NULL THEN
        r := public.fn_tenant_plan(public.fn_business_tenant(v_business));
        IF r IS NOT NULL AND NOT (r->>'writable')::boolean THEN
            RAISE EXCEPTION '%', public.fn_plan_read_only_message(r->>'status')
                USING ERRCODE = '42501', HINT = 'plan_read_only';
        END IF;
    END IF;
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;
REVOKE ALL ON FUNCTION public.fn_block_when_read_only() FROM PUBLIC, anon, authenticated;

-- Tables that stay writable while read-only: sign-in and membership housekeeping, the trail,
-- notifications and problem reports. Keep this list in step with grants_check.sql.
DO $$
DECLARE
    t text;
BEGIN
    FOR t IN
        SELECT c.relname
        FROM pg_class c
        JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'business_id' AND NOT a.attisdropped
        WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'r'
          AND c.relname NOT IN ('audit_logs', 'notifications', 'notification_preferences',
                                'business_memberships', 'crash_reports', 'problem_reports')
    LOOP
        EXECUTE format('DROP TRIGGER IF EXISTS trg_zz_plan_read_only ON public.%I', t);
        EXECUTE format('CREATE TRIGGER trg_zz_plan_read_only BEFORE INSERT OR UPDATE OR DELETE ON public.%I '
                       'FOR EACH ROW EXECUTE FUNCTION public.fn_block_when_read_only()', t);
    END LOOP;
END;
$$;

-- ============================================================================================
-- 7. Limits: branches and staff
-- ============================================================================================
-- Staff = active members in any of the tenant's branches, except Owner, riders and suppliers.
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
      AND bm.role NOT IN ('Owner', 'Rider', 'Supplier')
      AND bm.user_id IS DISTINCT FROM p_exclude_user;
$$;
REVOKE ALL ON FUNCTION public.fn_tenant_staff_used(uuid, uuid) FROM PUBLIC, anon, authenticated;

-- Pending invitations that will take a staff place (not for someone already on the staff).
CREATE OR REPLACE FUNCTION public.fn_tenant_staff_pending(p_tenant_id uuid, p_exclude_invitation uuid DEFAULT NULL)
RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT count(DISTINCT lower(COALESCE(NULLIF(i.email, ''), NULLIF(i.phone, ''), i.id::text)))::integer
    FROM public.invitations i
    JOIN public.businesses b ON b.id = i.business_id
    WHERE b.tenant_id = p_tenant_id AND b.deleted_at IS NULL
      AND i.status = 'Pending' AND i.expires_at > now()
      AND i.role NOT IN ('Owner', 'Rider', 'Supplier')
      AND i.id IS DISTINCT FROM p_exclude_invitation
      AND NOT EXISTS (
          SELECT 1 FROM public.business_memberships bm
          JOIN public.businesses b2 ON b2.id = bm.business_id
          JOIN public.users u ON u.id = bm.user_id
          WHERE b2.tenant_id = p_tenant_id AND bm.status = 'Active'
            AND bm.role NOT IN ('Owner', 'Rider', 'Supplier')
            AND i.email IS NOT NULL AND lower(u.email) = lower(i.email));
$$;
REVOKE ALL ON FUNCTION public.fn_tenant_staff_pending(uuid, uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.fn_check_branch_limit()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    r jsonb;
    v_count integer;
BEGIN
    IF COALESCE(current_setting('role', true), 'none') NOT IN ('anon', 'authenticated') THEN
        RETURN NEW;
    END IF;
    IF TG_OP = 'UPDATE' AND NOT (OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS NULL) THEN
        RETURN NEW;
    END IF;
    -- One change at a time per tenant, so two new branches can't both slip in.
    PERFORM 1 FROM public.tenant_subscriptions WHERE tenant_id = NEW.tenant_id FOR UPDATE;
    r := public.fn_tenant_plan(NEW.tenant_id);
    IF r IS NULL THEN
        RETURN NEW;
    END IF;
    IF NOT (r->>'writable')::boolean THEN
        RAISE EXCEPTION '%', public.fn_plan_read_only_message(r->>'status') USING ERRCODE = '42501', HINT = 'plan_read_only';
    END IF;
    SELECT count(*) INTO v_count FROM public.businesses
    WHERE tenant_id = NEW.tenant_id AND deleted_at IS NULL AND id <> NEW.id;
    IF v_count >= (r->>'max_branches')::integer THEN
        RAISE EXCEPTION 'Your plan (%) allows % %. Upgrade to add more.', r->>'plan_name', r->>'max_branches',
            CASE WHEN (r->>'max_branches')::integer = 1 THEN 'branch' ELSE 'branches' END
            USING ERRCODE = '42501', HINT = 'plan_limit_branches';
    END IF;
    RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.fn_check_branch_limit() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_b_branch_limit ON public.businesses;
CREATE TRIGGER trg_b_branch_limit BEFORE INSERT OR UPDATE OF deleted_at ON public.businesses
    FOR EACH ROW EXECUTE FUNCTION public.fn_check_branch_limit();

CREATE OR REPLACE FUNCTION public.fn_staff_limit_message(r jsonb)
RETURNS text
LANGUAGE sql IMMUTABLE
SET search_path = ''
AS $$
    SELECT format('Your plan (%s) allows %s staff (the owner, riders and suppliers don''t count). Upgrade or remove someone first.',
                  r->>'plan_name', r->>'max_staff');
$$;

CREATE OR REPLACE FUNCTION public.fn_check_invitation_staff_limit()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_tenant uuid;
    r jsonb;
BEGIN
    IF COALESCE(current_setting('role', true), 'none') NOT IN ('anon', 'authenticated')
       OR NEW.status <> 'Pending' OR NEW.role IN ('Owner', 'Rider', 'Supplier') THEN
        RETURN NEW;
    END IF;
    IF TG_OP = 'UPDATE' AND OLD.status = 'Pending' AND OLD.role NOT IN ('Owner', 'Rider', 'Supplier') THEN
        RETURN NEW;  -- already holding a place
    END IF;
    -- Someone who may not invite is refused by row security, without learning the plan's limits.
    IF NOT public.has_permission(NEW.business_id, 'staff.invite') THEN
        RETURN NEW;
    END IF;
    v_tenant := public.fn_business_tenant(NEW.business_id);
    -- Someone already on the staff of this company takes no new place.
    IF NEW.email IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.business_memberships bm
        JOIN public.businesses b ON b.id = bm.business_id
        JOIN public.users u ON u.id = bm.user_id
        WHERE b.tenant_id = v_tenant AND bm.status = 'Active'
          AND bm.role NOT IN ('Owner', 'Rider', 'Supplier') AND lower(u.email) = lower(NEW.email)) THEN
        RETURN NEW;
    END IF;
    PERFORM 1 FROM public.tenant_subscriptions WHERE tenant_id = v_tenant FOR UPDATE;
    r := public.fn_tenant_plan(v_tenant);
    IF r IS NULL THEN
        RETURN NEW;
    END IF;
    IF public.fn_tenant_staff_used(v_tenant) + public.fn_tenant_staff_pending(v_tenant, NEW.id)
       >= (r->>'max_staff')::integer THEN
        RAISE EXCEPTION '%', public.fn_staff_limit_message(r) USING ERRCODE = '42501', HINT = 'plan_limit_staff';
    END IF;
    RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.fn_check_invitation_staff_limit() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_invitation_staff_limit ON public.invitations;
CREATE TRIGGER trg_invitation_staff_limit BEFORE INSERT OR UPDATE OF status, role ON public.invitations
    FOR EACH ROW EXECUTE FUNCTION public.fn_check_invitation_staff_limit();

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
       OR NEW.status <> 'Active' OR NEW.role IN ('Owner', 'Rider', 'Supplier') THEN
        RETURN NEW;
    END IF;
    IF TG_OP = 'UPDATE' AND OLD.status = 'Active' AND OLD.role NOT IN ('Owner', 'Rider', 'Supplier') THEN
        RETURN NEW;  -- already counted
    END IF;
    v_tenant := public.fn_business_tenant(NEW.business_id);
    -- Already on the staff of another branch of this company: no new place.
    IF EXISTS (SELECT 1 FROM public.business_memberships bm
               JOIN public.businesses b ON b.id = bm.business_id
               WHERE b.tenant_id = v_tenant AND bm.user_id = NEW.user_id AND bm.id <> NEW.id
                 AND bm.status = 'Active' AND bm.role NOT IN ('Owner', 'Rider', 'Supplier')) THEN
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
DROP TRIGGER IF EXISTS trg_membership_staff_limit ON public.business_memberships;
CREATE TRIGGER trg_membership_staff_limit BEFORE INSERT OR UPDATE OF status, role ON public.business_memberships
    FOR EACH ROW EXECUTE FUNCTION public.fn_check_membership_staff_limit();

-- ============================================================================================
-- 8. Trial claims and sign-up requests
-- ============================================================================================
CREATE TABLE IF NOT EXISTS public.trial_claims (
    auth_user_id uuid PRIMARY KEY,
    email text,
    tenant_id uuid REFERENCES public.tenants(id) ON DELETE SET NULL,
    claimed_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_trial_claims_email ON public.trial_claims (lower(email)) WHERE email IS NOT NULL;
ALTER TABLE public.trial_claims ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS pol_trial_claims_select ON public.trial_claims;
CREATE POLICY pol_trial_claims_select ON public.trial_claims FOR SELECT TO authenticated
    USING (auth_user_id = (SELECT auth.uid()) OR (SELECT public.is_platform_admin()));
REVOKE ALL ON public.trial_claims FROM anon, authenticated;
GRANT SELECT ON public.trial_claims TO authenticated;
GRANT ALL ON public.trial_claims TO service_role;

CREATE TABLE IF NOT EXISTS public.signup_requests (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    auth_user_id uuid NOT NULL,
    email text,
    plan_code text NOT NULL REFERENCES public.plans(code),
    billing_cycle text NOT NULL CHECK (billing_cycle IN ('monthly', 'annual', 'one_time')),
    business_name text NOT NULL CHECK (length(trim(business_name)) > 0),
    phone text,
    message text CHECK (message IS NULL OR length(message) <= 2000),
    addons text[] NOT NULL DEFAULT '{}',
    status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'used', 'cancelled')),
    payment_reference text,
    decided_by uuid,
    decided_at timestamptz,
    decision_note text,
    tenant_id uuid REFERENCES public.tenants(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_signup_requests_user ON public.signup_requests(auth_user_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_signup_requests_one_open ON public.signup_requests(auth_user_id)
    WHERE status IN ('pending', 'approved');
ALTER TABLE public.signup_requests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS pol_signup_requests_select ON public.signup_requests;
CREATE POLICY pol_signup_requests_select ON public.signup_requests FOR SELECT TO authenticated
    USING (auth_user_id = (SELECT auth.uid()) OR (SELECT public.is_platform_admin()));
REVOKE ALL ON public.signup_requests FROM anon, authenticated;
GRANT SELECT ON public.signup_requests TO authenticated;
GRANT ALL ON public.signup_requests TO service_role;

CREATE OR REPLACE FUNCTION public.fn_can_start_trial(p_auth_user_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT COALESCE((SELECT trial_enabled FROM public.platform_settings WHERE id), false)
       AND NOT EXISTS (
           SELECT 1 FROM public.trial_claims tc
           WHERE tc.auth_user_id = p_auth_user_id
              OR lower(tc.email) = (SELECT lower(au.email) FROM auth.users au WHERE au.id = p_auth_user_id));
$$;
REVOKE ALL ON FUNCTION public.fn_can_start_trial(uuid) FROM PUBLIC, anon, authenticated;

-- Where the signed-in person stands before they have a company: can they start a trial, is a
-- request waiting, which plans can they choose.
CREATE OR REPLACE FUNCTION public.my_signup_state()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_uid uuid := auth.uid();
    v_req jsonb;
    s public.platform_settings;
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'Please sign in.' USING ERRCODE = '42501';
    END IF;
    SELECT * INTO s FROM public.platform_settings WHERE id;
    SELECT to_jsonb(r) INTO v_req FROM (
        SELECT id, plan_code, billing_cycle, business_name, status, decision_note, created_at, decided_at
        FROM public.signup_requests
        WHERE auth_user_id = v_uid AND status IN ('pending', 'approved', 'rejected')
        ORDER BY created_at DESC LIMIT 1) r;
    RETURN jsonb_build_object(
        'email_verified', public.account_email_verified(v_uid),
        'owns_company', EXISTS (SELECT 1 FROM public.tenants t JOIN public.users u ON u.id = t.owner_user_id
                                WHERE u.auth_user_id = v_uid),
        'trial_enabled', s.trial_enabled,
        'trial_days', s.trial_days,
        'can_start_trial', public.fn_can_start_trial(v_uid),
        'request', v_req,
        'is_platform_admin', public.is_platform_admin(v_uid));
END;
$$;
REVOKE ALL ON FUNCTION public.my_signup_state() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_signup_state() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.request_business_signup(
    p_plan_code text, p_billing_cycle text, p_business_name text,
    p_phone text DEFAULT NULL, p_message text DEFAULT NULL, p_addons text[] DEFAULT '{}')
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_uid uuid := auth.uid();
    p public.plans;
    v_id uuid;
BEGIN
    IF v_uid IS NULL OR NOT public.account_email_verified(v_uid) THEN
        RAISE EXCEPTION 'Please verify your email first.' USING ERRCODE = '42501';
    END IF;
    SELECT * INTO p FROM public.plans WHERE code = p_plan_code AND active AND is_public;
    IF NOT FOUND OR p.kind = 'trial' THEN
        RAISE EXCEPTION 'Choose one of the plans.';
    END IF;
    IF (p.kind = 'perpetual') <> (p_billing_cycle = 'one_time') OR p_billing_cycle NOT IN ('monthly', 'annual', 'one_time') THEN
        RAISE EXCEPTION 'Choose how you want to pay for this plan.';
    END IF;
    IF EXISTS (SELECT 1 FROM unnest(COALESCE(p_addons, '{}')) a
               WHERE NOT p.addons_allowed OR a NOT IN (SELECT key FROM public.plan_modules WHERE addable)) THEN
        RAISE EXCEPTION 'Add-ons can only be added to the Pro plan.';
    END IF;
    IF EXISTS (SELECT 1 FROM public.signup_requests WHERE auth_user_id = v_uid AND status IN ('pending', 'approved')) THEN
        RAISE EXCEPTION 'You already have a request waiting. Cancel it first to make a new one.';
    END IF;
    INSERT INTO public.signup_requests (auth_user_id, email, plan_code, billing_cycle, business_name, phone, message, addons)
    VALUES (v_uid, (SELECT email FROM auth.users WHERE id = v_uid), p.code, p_billing_cycle,
            trim(p_business_name), NULLIF(trim(COALESCE(p_phone, '')), ''), NULLIF(trim(COALESCE(p_message, '')), ''),
            COALESCE(p_addons, '{}'))
    RETURNING id INTO v_id;
    RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.request_business_signup(text, text, text, text, text, text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_business_signup(text, text, text, text, text, text[]) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.cancel_signup_request(p_request_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    UPDATE public.signup_requests SET status = 'cancelled', updated_at = now()
    WHERE id = p_request_id AND auth_user_id = auth.uid() AND status IN ('pending', 'approved');
    IF NOT FOUND THEN
        RAISE EXCEPTION 'That request can''t be cancelled.';
    END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.cancel_signup_request(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_signup_request(uuid) TO authenticated, service_role;

-- ============================================================================================
-- 9. Creating a business: a new company (trial, approved request, or platform admin) or a new
--    branch of the company the person owns (branch limit applies)
-- ============================================================================================
CREATE OR REPLACE FUNCTION public.can_create_business()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT auth.uid() IS NOT NULL
       AND public.account_email_verified(auth.uid())
       AND (
           public.is_platform_admin(auth.uid())
           OR EXISTS (SELECT 1 FROM public.tenants t JOIN public.users u ON u.id = t.owner_user_id
                      WHERE u.auth_user_id = auth.uid())
           OR EXISTS (SELECT 1 FROM public.signup_requests r
                      WHERE r.auth_user_id = auth.uid() AND r.status = 'approved')
           OR public.fn_can_start_trial(auth.uid())
       );
$$;
REVOKE ALL ON FUNCTION public.can_create_business() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_create_business() TO authenticated, service_role;

DROP FUNCTION IF EXISTS public.create_business_with_owner(text, text, text, text, text, text, text);
CREATE OR REPLACE FUNCTION public.create_business_with_owner(
  p_name text, p_type text, p_country text, p_currency text,
  p_logo_url text, p_description text, p_address text,
  p_plan_code text DEFAULT NULL, p_new_company boolean DEFAULT false)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
    v_business_id UUID;
    v_user_id     UUID;
    v_uid         UUID := auth.uid();
    v_admin       BOOLEAN;
    v_tenant      UUID;
    v_req         public.signup_requests;
    v_plan        public.plans;
    s             public.platform_settings;
BEGIN
    IF NOT public.account_email_verified(v_uid) THEN
        RAISE EXCEPTION 'Please verify your email before creating a business.' USING ERRCODE = '42501';
    END IF;
    PERFORM pg_advisory_xact_lock(hashtext('create_business_with_owner'));

    SELECT id INTO v_user_id FROM public.users WHERE auth_user_id = v_uid;
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'User profile not found. Please complete signup first.';
    END IF;
    v_admin := public.is_platform_admin(v_uid);
    SELECT * INTO s FROM public.platform_settings WHERE id;

    -- A new branch of the company this person owns.
    IF NOT (v_admin AND p_new_company) THEN
        SELECT t.id INTO v_tenant FROM public.tenants t
        WHERE t.owner_user_id = v_user_id ORDER BY t.created_at LIMIT 1;
    END IF;

    IF v_tenant IS NULL THEN
        -- A new company: platform admin (any plan, no payment), an approved request, or a trial.
        IF v_admin THEN
            SELECT * INTO v_plan FROM public.plans WHERE code = COALESCE(p_plan_code, s.trial_plan);
            IF NOT FOUND THEN
                RAISE EXCEPTION 'Unknown plan.';
            END IF;
        ELSE
            SELECT * INTO v_req FROM public.signup_requests
            WHERE auth_user_id = v_uid AND status = 'approved'
            ORDER BY decided_at DESC NULLS LAST LIMIT 1 FOR UPDATE;
            IF FOUND THEN
                SELECT * INTO v_plan FROM public.plans WHERE code = v_req.plan_code;
            ELSIF public.fn_can_start_trial(v_uid) THEN
                SELECT * INTO v_plan FROM public.plans WHERE code = s.trial_plan;
            ELSE
                RAISE EXCEPTION 'Choose a plan to start your business.' USING ERRCODE = '42501', HINT = 'plan_required';
            END IF;
        END IF;

        INSERT INTO public.tenants (name, owner_user_id) VALUES (trim(p_name), v_user_id) RETURNING id INTO v_tenant;
        UPDATE public.tenant_subscriptions SET
            plan_code = v_plan.code,
            status = CASE WHEN v_plan.kind = 'trial' THEN 'trial' ELSE 'active' END,
            billing_cycle = CASE WHEN v_plan.kind = 'trial' THEN 'trial'
                                 WHEN v_req.id IS NOT NULL THEN v_req.billing_cycle
                                 ELSE 'manual' END,
            trial_ends_at = CASE WHEN v_plan.kind = 'trial' THEN now() + make_interval(days => s.trial_days) END,
            current_period_end = CASE WHEN v_req.billing_cycle = 'monthly' THEN now() + interval '1 month'
                                      WHEN v_req.billing_cycle = 'annual' THEN now() + interval '1 year' END,
            addons = COALESCE(v_req.addons, '{}'),
            note = CASE WHEN v_admin THEN 'Created by the platform admin' END,
            updated_at = now(), updated_by = v_uid
        WHERE tenant_id = v_tenant;

        IF v_req.id IS NOT NULL THEN
            UPDATE public.signup_requests SET status = 'used', tenant_id = v_tenant, updated_at = now() WHERE id = v_req.id;
        ELSIF v_plan.kind = 'trial' AND NOT v_admin THEN
            INSERT INTO public.trial_claims (auth_user_id, email, tenant_id)
            VALUES (v_uid, (SELECT email FROM auth.users WHERE id = v_uid), v_tenant);
        END IF;
        PERFORM public.fn_platform_log(v_tenant, 'company_created',
            jsonb_build_object('plan', v_plan.code, 'request', v_req.id, 'by_admin', v_admin));
    END IF;

    INSERT INTO public.businesses
        (name, business_type, country, currency, logo_url, description, address, tenant_id)
    VALUES
        (p_name, p_type, p_country, p_currency, p_logo_url, p_description, p_address, v_tenant)
    RETURNING id INTO v_business_id;

    INSERT INTO public.branches (business_id, name, address)
    VALUES (v_business_id, 'Main branch', p_address);

    INSERT INTO public.business_memberships (business_id, user_id, role, status)
    VALUES (v_business_id, v_user_id, 'Owner', 'Active');

    INSERT INTO public.employees
        (id, business_id, user_id, name, role, email, phone, pin, assigned_branches)
    SELECT
        v_user_id, v_business_id, v_user_id,
        name, 'Owner', email, phone, '0000',
        jsonb_build_array(v_business_id::TEXT)
    FROM public.users
    WHERE id = v_user_id
    ON CONFLICT (id) DO UPDATE SET
        business_id = v_business_id,
        role        = 'Owner';

    RETURN v_business_id;
END;
$$;
REVOKE ALL ON FUNCTION public.create_business_with_owner(text, text, text, text, text, text, text, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_business_with_owner(text, text, text, text, text, text, text, text, boolean) TO authenticated, service_role;

-- ============================================================================================
-- 10. What the app shows: plan, limits and use for the business that is open
-- ============================================================================================
CREATE OR REPLACE FUNCTION public.get_plan_usage(p_business_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_tenant uuid;
    r jsonb;
BEGIN
    PERFORM public.assert_business_member(p_business_id);
    v_tenant := public.fn_business_tenant(p_business_id);
    r := public.fn_tenant_plan(v_tenant);
    IF r IS NULL THEN
        RETURN NULL;
    END IF;
    RETURN r || jsonb_build_object(
        'company_name', (SELECT name FROM public.tenants WHERE id = v_tenant),
        'branches_used', (SELECT count(*) FROM public.businesses WHERE tenant_id = v_tenant AND deleted_at IS NULL),
        'staff_used', public.fn_tenant_staff_used(v_tenant),
        'staff_pending', public.fn_tenant_staff_pending(v_tenant),
        'is_company_owner', EXISTS (SELECT 1 FROM public.tenants t JOIN public.users u ON u.id = t.owner_user_id
                                    WHERE t.id = v_tenant AND u.auth_user_id = auth.uid()));
END;
$$;
REVOKE ALL ON FUNCTION public.get_plan_usage(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_plan_usage(uuid) TO authenticated, service_role;

-- ============================================================================================
-- 11. Platform admin functions (the admin website)
-- ============================================================================================
CREATE OR REPLACE FUNCTION public.platform_update_settings(p_settings jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    r jsonb;
BEGIN
    PERFORM public.fn_require_platform_admin();
    IF EXISTS (SELECT 1 FROM jsonb_object_keys(COALESCE(p_settings, '{}')) k
               WHERE k NOT IN ('trial_enabled', 'trial_days', 'trial_plan', 'grace_days', 'read_only_days', 'platform_domain')) THEN
        RAISE EXCEPTION 'Unknown setting.';
    END IF;
    IF p_settings ? 'trial_plan' AND NOT EXISTS (SELECT 1 FROM public.plans WHERE code = p_settings->>'trial_plan') THEN
        RAISE EXCEPTION 'Unknown plan.';
    END IF;
    UPDATE public.platform_settings SET
        trial_enabled   = COALESCE((p_settings->>'trial_enabled')::boolean, trial_enabled),
        trial_days      = COALESCE((p_settings->>'trial_days')::integer, trial_days),
        trial_plan      = COALESCE(p_settings->>'trial_plan', trial_plan),
        grace_days      = COALESCE((p_settings->>'grace_days')::integer, grace_days),
        read_only_days  = COALESCE((p_settings->>'read_only_days')::integer, read_only_days),
        platform_domain = CASE WHEN p_settings ? 'platform_domain'
                               THEN NULLIF(lower(trim(p_settings->>'platform_domain')), '') ELSE platform_domain END,
        updated_at = now(), updated_by = auth.uid()
    WHERE id
    RETURNING to_jsonb(platform_settings.*) INTO r;
    PERFORM public.fn_platform_log(NULL, 'settings_changed', p_settings);
    RETURN r;
END;
$$;
REVOKE ALL ON FUNCTION public.platform_update_settings(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.platform_update_settings(jsonb) TO authenticated, service_role;

-- Put a tenant on any plan by hand, paid or not. Returns the plan now in force, with a warning
-- when the company is over the new plan's limits (nothing is removed).
CREATE OR REPLACE FUNCTION public.platform_set_plan(
    p_tenant_id uuid, p_plan_code text, p_status text DEFAULT 'active',
    p_billing_cycle text DEFAULT 'manual', p_period_end timestamptz DEFAULT NULL, p_note text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    p public.plans;
    s public.platform_settings;
    r jsonb;
    v_warn text[] := '{}';
    v_branches integer;
BEGIN
    PERFORM public.fn_require_platform_admin();
    SELECT * INTO p FROM public.plans WHERE code = p_plan_code;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Unknown plan.';
    END IF;
    IF p_status NOT IN ('trial', 'active', 'suspended') THEN
        RAISE EXCEPTION 'Status must be trial, active or suspended.';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.tenant_subscriptions WHERE tenant_id = p_tenant_id) THEN
        RAISE EXCEPTION 'Unknown company.';
    END IF;
    SELECT * INTO s FROM public.platform_settings WHERE id;
    UPDATE public.tenant_subscriptions SET
        plan_code = p.code,
        status = p_status,
        billing_cycle = CASE WHEN p_status = 'trial' THEN 'trial' ELSE COALESCE(p_billing_cycle, 'manual') END,
        trial_ends_at = CASE WHEN p_status = 'trial'
                             THEN GREATEST(COALESCE(trial_ends_at, now()), now() + make_interval(days => s.trial_days))
                             ELSE trial_ends_at END,
        current_period_end = CASE WHEN p_status = 'trial' THEN NULL ELSE p_period_end END,
        addons = CASE WHEN p.addons_allowed THEN addons ELSE '{}' END,
        note = COALESCE(p_note, note),
        updated_at = now(), updated_by = auth.uid()
    WHERE tenant_id = p_tenant_id;
    PERFORM public.fn_platform_log(p_tenant_id, 'plan_set',
        jsonb_build_object('plan', p.code, 'status', p_status, 'cycle', p_billing_cycle, 'period_end', p_period_end, 'note', p_note));

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
REVOKE ALL ON FUNCTION public.platform_set_plan(uuid, text, text, text, timestamptz, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.platform_set_plan(uuid, text, text, text, timestamptz, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.platform_set_addons(p_tenant_id uuid, p_addons text[])
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_allowed boolean;
BEGIN
    PERFORM public.fn_require_platform_admin();
    SELECT p.addons_allowed INTO v_allowed
    FROM public.tenant_subscriptions s JOIN public.plans p ON p.code = s.plan_code
    WHERE s.tenant_id = p_tenant_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Unknown company.';
    END IF;
    IF cardinality(COALESCE(p_addons, '{}')) > 0 AND NOT v_allowed THEN
        RAISE EXCEPTION 'Add-ons can only be added to the Pro plan.';
    END IF;
    IF EXISTS (SELECT 1 FROM unnest(COALESCE(p_addons, '{}')) a
               WHERE a NOT IN (SELECT key FROM public.plan_modules WHERE addable)) THEN
        RAISE EXCEPTION 'That module can''t be bought on its own.';
    END IF;
    UPDATE public.tenant_subscriptions
    SET addons = ARRAY(SELECT DISTINCT unnest(COALESCE(p_addons, '{}')) ORDER BY 1),
        updated_at = now(), updated_by = auth.uid()
    WHERE tenant_id = p_tenant_id;
    PERFORM public.fn_platform_log(p_tenant_id, 'addons_set', jsonb_build_object('addons', p_addons));
    RETURN public.fn_tenant_plan(p_tenant_id);
END;
$$;
REVOKE ALL ON FUNCTION public.platform_set_addons(uuid, text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.platform_set_addons(uuid, text[]) TO authenticated, service_role;

-- Custom limits for one company (large businesses): max_branches, max_staff, storage_mb,
-- ai_daily_cap (numbers; null clears) and modules (extra modules, a list). {} clears all.
CREATE OR REPLACE FUNCTION public.platform_set_custom_limits(p_tenant_id uuid, p_limits jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    k text;
BEGIN
    PERFORM public.fn_require_platform_admin();
    FOR k IN SELECT jsonb_object_keys(COALESCE(p_limits, '{}')) LOOP
        IF k NOT IN ('max_branches', 'max_staff', 'storage_mb', 'ai_daily_cap', 'modules') THEN
            RAISE EXCEPTION 'Unknown limit: %', k;
        END IF;
        IF k <> 'modules' AND jsonb_typeof(p_limits->k) NOT IN ('number', 'null') THEN
            RAISE EXCEPTION '% must be a number.', k;
        END IF;
        IF k <> 'modules' AND jsonb_typeof(p_limits->k) = 'number'
           AND ((p_limits->>k)::numeric < CASE WHEN k = 'max_branches' THEN 1 ELSE 0 END
                OR (p_limits->>k)::numeric <> trunc((p_limits->>k)::numeric)) THEN
            RAISE EXCEPTION '% must be a whole number of at least %.', k, CASE WHEN k = 'max_branches' THEN 1 ELSE 0 END;
        END IF;
    END LOOP;
    IF jsonb_typeof(p_limits->'modules') = 'array' AND EXISTS (
        SELECT 1 FROM jsonb_array_elements_text(p_limits->'modules') m
        WHERE m NOT IN (SELECT key FROM public.plan_modules)) THEN
        RAISE EXCEPTION 'Unknown module.';
    END IF;
    UPDATE public.tenant_subscriptions
    SET custom_limits = jsonb_strip_nulls(COALESCE(p_limits, '{}')), updated_at = now(), updated_by = auth.uid()
    WHERE tenant_id = p_tenant_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Unknown company.';
    END IF;
    PERFORM public.fn_platform_log(p_tenant_id, 'custom_limits_set', p_limits);
    RETURN public.fn_tenant_plan(p_tenant_id);
END;
$$;
REVOKE ALL ON FUNCTION public.platform_set_custom_limits(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.platform_set_custom_limits(uuid, jsonb) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.platform_extend_trial(p_tenant_id uuid, p_days integer)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    PERFORM public.fn_require_platform_admin();
    IF p_days IS NULL OR p_days < 1 OR p_days > 90 THEN
        RAISE EXCEPTION 'Extend by 1 to 90 days.';
    END IF;
    UPDATE public.tenant_subscriptions
    SET trial_ends_at = GREATEST(COALESCE(trial_ends_at, now()), now()) + make_interval(days => p_days),
        updated_at = now(), updated_by = auth.uid()
    WHERE tenant_id = p_tenant_id AND status = 'trial';
    IF NOT FOUND THEN
        RAISE EXCEPTION 'That company is not on a trial.';
    END IF;
    PERFORM public.fn_platform_log(p_tenant_id, 'trial_extended', jsonb_build_object('days', p_days));
    RETURN public.fn_tenant_plan(p_tenant_id);
END;
$$;
REVOKE ALL ON FUNCTION public.platform_extend_trial(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.platform_extend_trial(uuid, integer) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.platform_decide_signup(p_request_id uuid, p_approve boolean, p_note text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    PERFORM public.fn_require_platform_admin();
    UPDATE public.signup_requests
    SET status = CASE WHEN p_approve THEN 'approved' ELSE 'rejected' END,
        decided_by = auth.uid(), decided_at = now(), decision_note = p_note, updated_at = now()
    WHERE id = p_request_id AND status = 'pending';
    IF NOT FOUND THEN
        RAISE EXCEPTION 'That request is not waiting for a decision.';
    END IF;
    PERFORM public.fn_platform_log(NULL, CASE WHEN p_approve THEN 'signup_approved' ELSE 'signup_rejected' END,
        jsonb_build_object('request', p_request_id, 'note', p_note));
END;
$$;
REVOKE ALL ON FUNCTION public.platform_decide_signup(uuid, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.platform_decide_signup(uuid, boolean, text) TO authenticated, service_role;

-- Every company with counts only (no sales amounts, customers or products).
CREATE OR REPLACE FUNCTION public.platform_tenants()
RETURNS TABLE (
    tenant_id uuid, name text, owner_name text, owner_email text,
    plan text, plan_name text, status text, trial_ends_at timestamptz, period_end timestamptz,
    addons jsonb, branches integer, max_branches integer, staff integer, max_staff integer,
    created_at timestamptz, last_sale_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    PERFORM public.fn_require_platform_admin();
    RETURN QUERY
    SELECT t.id, t.name, u.name, u.email,
           r->>'plan', r->>'plan_name', r->>'status',
           (r->>'trial_ends_at')::timestamptz, (r->>'period_end')::timestamptz, r->'addons',
           (SELECT count(*)::integer FROM public.businesses b WHERE b.tenant_id = t.id AND b.deleted_at IS NULL),
           (r->>'max_branches')::integer,
           public.fn_tenant_staff_used(t.id), (r->>'max_staff')::integer,
           t.created_at,
           (SELECT max(tx.timestamp) FROM public.transactions tx JOIN public.businesses b ON b.id = tx.business_id
            WHERE b.tenant_id = t.id)
    FROM public.tenants t
    LEFT JOIN public.users u ON u.id = t.owner_user_id
    CROSS JOIN LATERAL (SELECT public.fn_tenant_plan(t.id) AS r) x
    ORDER BY t.created_at DESC;
END;
$$;
REVOKE ALL ON FUNCTION public.platform_tenants() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.platform_tenants() TO authenticated, service_role;
