-- 20261204005_platform_console_plans_page.sql
-- SaaS step 7 (owner decision 2026-11-24, round 4): the platform console lives INSIDE the main
-- app, shown only to platform admins, and customers see the plans and subscribe from a public
-- web page on the platform domain.
--
--   * platform_settings.app_url: where the app opens (the plans page sends people there to sign
--     up, with the plan they picked).
--   * get_public_plans(): what the public plans page shows. Anyone may call it (the website
--     Worker does, with the anon key). Plans, prices, add-ons, trial, VAT, terms and contact
--     only: nothing about any business.
--   * Console reads, all platform admin only and all counts, never sales amounts, customers
--     or products: platform_overview(), platform_tenant_detail(), platform_requests().

-- ============================================================================================
-- 1. Where the app is
-- ============================================================================================
ALTER TABLE public.platform_settings
    ADD COLUMN IF NOT EXISTS app_url text CHECK (app_url IS NULL OR app_url ~ '^https://[^\s/?#]+(/[^\s?#]*)?$');

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
               WHERE k NOT IN ('trial_enabled', 'trial_days', 'trial_plan', 'grace_days', 'read_only_days', 'platform_domain',
                               'vat_percent', 'payment_instructions', 'terms_url', 'contact_text',
                               'platform_name', 'custom_domain_target', 'app_url')) THEN
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
        vat_percent     = COALESCE((p_settings->>'vat_percent')::numeric, vat_percent),
        payment_instructions = CASE WHEN p_settings ? 'payment_instructions'
                               THEN NULLIF(trim(p_settings->>'payment_instructions'), '') ELSE payment_instructions END,
        terms_url       = CASE WHEN p_settings ? 'terms_url'
                               THEN NULLIF(trim(p_settings->>'terms_url'), '') ELSE terms_url END,
        contact_text    = CASE WHEN p_settings ? 'contact_text'
                               THEN NULLIF(trim(p_settings->>'contact_text'), '') ELSE contact_text END,
        platform_name   = CASE WHEN p_settings ? 'platform_name'
                               THEN NULLIF(trim(p_settings->>'platform_name'), '') ELSE platform_name END,
        custom_domain_target = CASE WHEN p_settings ? 'custom_domain_target'
                               THEN NULLIF(lower(trim(p_settings->>'custom_domain_target')), '') ELSE custom_domain_target END,
        app_url         = CASE WHEN p_settings ? 'app_url'
                               THEN NULLIF(rtrim(trim(p_settings->>'app_url'), '/'), '') ELSE app_url END,
        updated_at = now(), updated_by = auth.uid()
    WHERE id
    RETURNING to_jsonb(platform_settings.*) INTO r;
    PERFORM public.fn_platform_log(NULL, 'settings_changed', p_settings);
    RETURN r;
END;
$$;
REVOKE ALL ON FUNCTION public.platform_update_settings(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.platform_update_settings(jsonb) TO authenticated, service_role;

-- ============================================================================================
-- 2. The public plans page
-- ============================================================================================
CREATE OR REPLACE FUNCTION public.get_public_plans()
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT jsonb_build_object(
        'platform_name', s.platform_name,
        'app_url', s.app_url,
        'trial_enabled', s.trial_enabled,
        'trial_days', s.trial_days,
        'vat_percent', s.vat_percent,
        'terms_url', s.terms_url,
        'contact_text', s.contact_text,
        'plans', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                'code', p.code, 'name', p.name, 'kind', p.kind, 'description', p.description,
                'monthly_price', p.monthly_price, 'annual_price', p.annual_price,
                'one_time_price', p.one_time_price, 'setup_fee', p.setup_fee,
                'max_branches', p.max_branches, 'max_staff', p.max_staff, 'storage_mb', p.storage_mb,
                'ai_daily_cap', p.ai_daily_cap, 'addons_allowed', p.addons_allowed,
                'show_powered_by', p.show_powered_by,
                'modules', COALESCE((SELECT jsonb_agg(m.key ORDER BY m.sort) FROM public.plan_modules m
                                     WHERE m.key = ANY (p.modules)), '[]'::jsonb))
                ORDER BY p.sort)
            FROM public.plans p
            WHERE p.active AND p.is_public AND (p.kind <> 'trial')), '[]'::jsonb),
        'modules', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                'key', m.key, 'name', m.name, 'tier', m.tier, 'addable', m.addable,
                'addon_monthly_price', m.addon_monthly_price, 'addon_annual_price', m.addon_annual_price)
                ORDER BY m.sort)
            FROM public.plan_modules m), '[]'::jsonb))
    FROM public.platform_settings s WHERE s.id;
$$;
REVOKE ALL ON FUNCTION public.get_public_plans() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_plans() TO anon, authenticated, service_role;

-- ============================================================================================
-- 3. Console reads (platform admin only; counts, never business figures)
-- ============================================================================================
CREATE OR REPLACE FUNCTION public.platform_overview()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    r jsonb;
BEGIN
    PERFORM public.fn_require_platform_admin();
    SELECT jsonb_build_object(
        'companies', count(*),
        'by_status', COALESCE(jsonb_object_agg(x.status, x.n) FILTER (WHERE x.status IS NOT NULL), '{}'::jsonb),
        'by_plan', (SELECT COALESCE(jsonb_object_agg(y.plan, y.n), '{}'::jsonb) FROM (
                        SELECT public.fn_tenant_plan(t.id)->>'plan' AS plan, count(*) AS n
                        FROM public.tenants t GROUP BY 1) y),
        'trials_ending_7_days', (SELECT count(*) FROM public.tenant_subscriptions
                                 WHERE status = 'trial' AND trial_ends_at BETWEEN now() AND now() + interval '7 days'),
        'requests_waiting', (SELECT count(*) FROM public.signup_requests WHERE status = 'pending'),
        'ai_calls_today', (SELECT COALESCE(sum(calls), 0) FROM public.ai_usage WHERE day = public.fn_ai_today()),
        'ai_refused_today', (SELECT COALESCE(sum(refused), 0) FROM public.ai_usage WHERE day = public.fn_ai_today()),
        'branches', (SELECT count(*) FROM public.businesses WHERE deleted_at IS NULL),
        'active_7_days', (SELECT count(DISTINCT b.tenant_id) FROM public.transactions tx
                          JOIN public.businesses b ON b.id = tx.business_id
                          WHERE tx.timestamp > now() - interval '7 days'))
    INTO r
    FROM (SELECT public.fn_tenant_plan(t.id)->>'status' AS status, count(*) AS n
          FROM public.tenants t GROUP BY 1) x;
    RETURN r;
END;
$$;
REVOKE ALL ON FUNCTION public.platform_overview() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.platform_overview() TO authenticated, service_role;

-- One company: its subscription, its branches (name, website address, counts) and what the
-- platform admin did to it. Sales are a count per branch, never an amount.
CREATE OR REPLACE FUNCTION public.platform_tenant_detail(p_tenant_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    s public.tenant_subscriptions;
BEGIN
    PERFORM public.fn_require_platform_admin();
    SELECT * INTO s FROM public.tenant_subscriptions WHERE tenant_id = p_tenant_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Unknown company.';
    END IF;
    RETURN jsonb_build_object(
        'plan', public.fn_tenant_plan(p_tenant_id),
        'subscription', jsonb_build_object(
            'plan_code', s.plan_code, 'status', s.status, 'billing_cycle', s.billing_cycle,
            'trial_ends_at', s.trial_ends_at, 'period_end', s.current_period_end,
            'addons', to_jsonb(s.addons), 'custom_limits', s.custom_limits, 'note', s.note,
            'started_at', s.started_at),
        'branches', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                'id', b.id, 'name', b.name, 'website_slug', b.website_slug,
                'website_home', public.fn_website_home_host(b.id),
                'staff', (SELECT count(*) FROM public.business_memberships bm
                          WHERE bm.business_id = b.id AND bm.status = 'Active'
                            AND bm.role::text <> 'Support'),
                'sales_30_days', (SELECT count(*) FROM public.transactions tx
                                  WHERE tx.business_id = b.id AND tx.timestamp > now() - interval '30 days'),
                'last_sale_at', (SELECT max(tx.timestamp) FROM public.transactions tx WHERE tx.business_id = b.id))
                ORDER BY b.created_at)
            FROM public.businesses b WHERE b.tenant_id = p_tenant_id AND b.deleted_at IS NULL), '[]'::jsonb),
        'ai_today', (SELECT jsonb_build_object('calls', calls, 'refused', refused) FROM public.ai_usage
                     WHERE tenant_id = p_tenant_id AND day = public.fn_ai_today()),
        'ai_30_days', (SELECT COALESCE(sum(calls), 0) FROM public.ai_usage
                       WHERE tenant_id = p_tenant_id AND day > public.fn_ai_today() - 30),
        'history', COALESCE((
            SELECT jsonb_agg(jsonb_build_object('action', a.action, 'details', a.details, 'at', a.created_at)
                             ORDER BY a.created_at DESC)
            FROM (SELECT * FROM public.platform_audit WHERE tenant_id = p_tenant_id
                  ORDER BY created_at DESC LIMIT 30) a), '[]'::jsonb));
END;
$$;
REVOKE ALL ON FUNCTION public.platform_tenant_detail(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.platform_tenant_detail(uuid) TO authenticated, service_role;

-- Sign-up and plan-change requests, newest first (waiting ones on top), with the asker's name.
CREATE OR REPLACE FUNCTION public.platform_requests(p_include_decided boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    PERFORM public.fn_require_platform_admin();
    RETURN COALESCE((
        SELECT jsonb_agg(to_jsonb(x) ORDER BY (x.status = 'pending') DESC, x.created_at DESC)
        FROM (
            SELECT r.id, r.kind, r.status, r.email, r.phone, r.business_name, r.plan_code,
                   p.name AS plan_name, r.billing_cycle, r.addons, r.payment_reference, r.message,
                   r.decision_note, r.created_at, r.decided_at, r.tenant_id,
                   (SELECT u.name FROM public.users u WHERE u.auth_user_id = r.auth_user_id LIMIT 1) AS person,
                   CASE WHEN r.tenant_id IS NOT NULL THEN public.fn_tenant_plan(r.tenant_id)->>'plan_name' END AS current_plan
            FROM public.signup_requests r
            JOIN public.plans p ON p.code = r.plan_code
            WHERE r.status = 'pending'
               OR (p_include_decided AND r.created_at > now() - interval '90 days')
            ORDER BY r.created_at DESC
            LIMIT 200) x), '[]'::jsonb);
END;
$$;
REVOKE ALL ON FUNCTION public.platform_requests(boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.platform_requests(boolean) TO authenticated, service_role;
