-- 20261204004_website_addresses.sql
-- SaaS step 6: one website for every business, chosen by its address (owner decisions 2026-11-24).
--
--   * Each shop (a branch with a website name, businesses.website_slug) lives at
--     <website name>.<platform domain>. Never a path. The platform domain is a platform setting.
--   * A shop can change its website name twice a year. The old address sends visitors to the new
--     one for 90 days, and no other shop can take it in that time. Platform words (www, admin,
--     app, api...) can't be taken.
--   * Own web address (module own_domain: a Pro add-on, included in Pro Plus): one per shop,
--     added through Cloudflare for SaaS by the website-domain edge function. Once it is active
--     the subdomain sends visitors to it.
--   * The public shop only opens when the company's plan has the Online store and isn't
--     suspended. Read-only companies keep their shop visible but take no orders.
--   * resolve_website_host(host): the one question the website Worker asks for every address.
--     An unknown address says nothing about any business.
--   * "Powered by" shows on plans with show_powered_by and no own domain (Pro), never on Pro Plus.

-- ============================================================================================
-- 1. Platform settings for addresses
-- ============================================================================================
ALTER TABLE public.platform_settings
    ADD COLUMN IF NOT EXISTS platform_name text CHECK (platform_name IS NULL OR length(trim(platform_name)) BETWEEN 1 AND 60),
    -- Where an own domain points its CNAME (the Cloudflare for SaaS fallback origin).
    -- NULL = customers.<platform domain>.
    ADD COLUMN IF NOT EXISTS custom_domain_target text CHECK (custom_domain_target IS NULL OR custom_domain_target ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$');

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
                               'platform_name', 'custom_domain_target')) THEN
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
        updated_at = now(), updated_by = auth.uid()
    WHERE id
    RETURNING to_jsonb(platform_settings.*) INTO r;
    PERFORM public.fn_platform_log(NULL, 'settings_changed', p_settings);
    RETURN r;
END;
$$;
REVOKE ALL ON FUNCTION public.platform_update_settings(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.platform_update_settings(jsonb) TO authenticated, service_role;

-- Normalises a typed address: "HTTPS://Shop.co.ke/path" -> "shop.co.ke". NULL when it isn't one.
CREATE OR REPLACE FUNCTION public.fn_clean_hostname(p_host text)
RETURNS text
LANGUAGE sql IMMUTABLE
SET search_path = ''
AS $$
    SELECT CASE WHEN h ~ '^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$' AND length(h) <= 253 THEN h END
    FROM (SELECT rtrim(split_part(split_part(regexp_replace(lower(trim(COALESCE(p_host, ''))), '^[a-z]+://', ''),
                                             '/', 1), ':', 1), '.') AS h) x;
$$;
REVOKE ALL ON FUNCTION public.fn_clean_hostname(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_clean_hostname(text) TO service_role;

-- ============================================================================================
-- 2. Website names: reserved words, two changes a year, 90-day redirects
-- ============================================================================================
CREATE OR REPLACE FUNCTION public.fn_reserved_website_slug(p_slug text)
RETURNS boolean
LANGUAGE sql IMMUTABLE
SET search_path = ''
AS $$
    SELECT p_slug = ANY (ARRAY[
        'www', 'app', 'apps', 'admin', 'api', 'auth', 'login', 'signup', 'account', 'accounts',
        'mail', 'email', 'smtp', 'imap', 'pop', 'ftp', 'ns1', 'ns2', 'dns', 'mx',
        'help', 'support', 'status', 'docs', 'blog', 'news', 'about', 'pricing', 'terms', 'privacy',
        'cdn', 'static', 'assets', 'media', 'files', 'img', 'images', 'customers', 'customer',
        'dev', 'staging', 'test', 'preview', 'demo', 'internal', 'platform', 'billing', 'pay', 'payments',
        'webhook', 'webhooks', 'shop', 'store', 'stores', 'my', 'dashboard', 'console', 'root']);
$$;
REVOKE ALL ON FUNCTION public.fn_reserved_website_slug(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_reserved_website_slug(text) TO service_role;

CREATE TABLE IF NOT EXISTS public.website_slug_history (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    old_slug text NOT NULL,
    new_slug text,
    changed_at timestamptz NOT NULL DEFAULT now(),
    redirect_until timestamptz NOT NULL DEFAULT now() + interval '90 days',
    changed_by uuid
);
CREATE INDEX IF NOT EXISTS idx_website_slug_history_old ON public.website_slug_history(old_slug, redirect_until DESC);
CREATE INDEX IF NOT EXISTS idx_website_slug_history_business ON public.website_slug_history(business_id, changed_at DESC);
ALTER TABLE public.website_slug_history ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.website_slug_history FROM anon, authenticated;
GRANT ALL ON public.website_slug_history TO service_role;

CREATE OR REPLACE FUNCTION public.fn_website_slug_guard()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_app boolean := COALESCE(current_setting('role', true), 'none') IN ('anon', 'authenticated')
                     AND NOT public.is_platform_admin();
    v_count integer;
    v_next timestamptz;
BEGIN
    NEW.website_slug := NULLIF(lower(trim(COALESCE(NEW.website_slug, ''))), '');
    IF TG_OP = 'UPDATE' AND NEW.website_slug IS NOT DISTINCT FROM OLD.website_slug THEN
        RETURN NEW;
    END IF;

    IF NEW.website_slug IS NOT NULL THEN
        IF length(NEW.website_slug) < 3 OR length(NEW.website_slug) > 40 THEN
            RAISE EXCEPTION 'A website name has 3 to 40 letters, numbers or dashes.';
        END IF;
        IF public.fn_reserved_website_slug(NEW.website_slug) THEN
            RAISE EXCEPTION 'That website name is kept for the platform. Please choose another.';
        END IF;
        IF EXISTS (SELECT 1 FROM public.website_slug_history h
                   WHERE h.old_slug = NEW.website_slug AND h.redirect_until > now() AND h.business_id <> NEW.id) THEN
            RAISE EXCEPTION 'Another shop used that website name recently. Please choose another.';
        END IF;
    END IF;

    IF TG_OP = 'UPDATE' AND OLD.website_slug IS NOT NULL THEN
        IF v_app THEN
            SELECT count(*), min(changed_at) + interval '365 days' INTO v_count, v_next
            FROM public.website_slug_history
            WHERE business_id = NEW.id AND changed_at > now() - interval '365 days';
            IF v_count >= 2 THEN
                RAISE EXCEPTION 'The website name can be changed twice a year. The next change is possible from %.',
                    to_char(v_next AT TIME ZONE 'Africa/Nairobi', 'DD Mon YYYY');
            END IF;
        END IF;
        -- Taking back its own old name ends that redirect.
        DELETE FROM public.website_slug_history
        WHERE business_id = NEW.id AND old_slug = NEW.website_slug AND redirect_until > now();
        INSERT INTO public.website_slug_history (business_id, old_slug, new_slug, changed_by)
        VALUES (NEW.id, OLD.website_slug, NEW.website_slug, auth.uid());
    END IF;
    RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.fn_website_slug_guard() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_website_slug_guard ON public.businesses;
CREATE TRIGGER trg_website_slug_guard BEFORE INSERT OR UPDATE OF website_slug ON public.businesses
    FOR EACH ROW EXECUTE FUNCTION public.fn_website_slug_guard();

-- ============================================================================================
-- 3. Own web addresses (one per shop; Cloudflare for SaaS does the certificate)
-- ============================================================================================
CREATE TABLE IF NOT EXISTS public.website_domains (
    business_id uuid PRIMARY KEY REFERENCES public.businesses(id) ON DELETE CASCADE,
    hostname text NOT NULL UNIQUE CHECK (public.fn_clean_hostname(hostname) = hostname),
    status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'failed')),
    cf_hostname_id text,
    -- Records the shop must add at its domain company: [{type, name, value}]
    dns_records jsonb NOT NULL DEFAULT '[]'::jsonb,
    last_error text,
    checked_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    created_by uuid
);
ALTER TABLE public.website_domains ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS pol_website_domains_select ON public.website_domains;
CREATE POLICY pol_website_domains_select ON public.website_domains FOR SELECT TO authenticated
    USING ((SELECT public.is_owner_or_admin(business_id)));
REVOKE ALL ON public.website_domains FROM anon, authenticated;
GRANT SELECT ON public.website_domains TO authenticated;
GRANT ALL ON public.website_domains TO service_role;

-- Step 1 of adding an own address (the edge function then registers it with Cloudflare).
-- Returns the clean address and the Cloudflare id of the one it replaces, to remove there.
CREATE OR REPLACE FUNCTION public.website_domain_start(p_business_id uuid, p_hostname text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_host text := public.fn_clean_hostname(p_hostname);
    v_domain text;
    v_old public.website_domains;
BEGIN
    IF NOT public.is_owner_or_admin(p_business_id) THEN
        RAISE EXCEPTION 'Only the owner or an admin can change the web address.';
    END IF;
    IF NOT public.has_module(p_business_id, 'own_domain') THEN
        RAISE EXCEPTION 'Your plan does not include your own web address. It comes with Pro Plus, or as an add-on to Pro.'
            USING HINT = 'plan_module';
    END IF;
    IF v_host IS NULL THEN
        RAISE EXCEPTION 'That is not a web address. Type it like shop.example.co.ke';
    END IF;
    SELECT platform_domain INTO v_domain FROM public.platform_settings WHERE id;
    IF v_domain IS NOT NULL AND (v_host = v_domain OR v_host LIKE '%.' || v_domain) THEN
        RAISE EXCEPTION 'That address belongs to the platform. Use your own domain.';
    END IF;
    IF EXISTS (SELECT 1 FROM public.website_domains WHERE hostname = v_host AND business_id <> p_business_id) THEN
        RAISE EXCEPTION 'That address is already in use by another shop.';
    END IF;

    SELECT * INTO v_old FROM public.website_domains WHERE business_id = p_business_id;
    IF FOUND AND v_old.hostname = v_host THEN
        RETURN jsonb_build_object('hostname', v_host, 'old_cf_id', NULL, 'cf_id', v_old.cf_hostname_id);
    END IF;
    DELETE FROM public.website_domains WHERE business_id = p_business_id;
    INSERT INTO public.website_domains (business_id, hostname, created_by) VALUES (p_business_id, v_host, auth.uid());
    RETURN jsonb_build_object('hostname', v_host, 'old_cf_id', v_old.cf_hostname_id, 'cf_id', NULL);
END;
$$;
REVOKE ALL ON FUNCTION public.website_domain_start(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.website_domain_start(uuid, text) TO authenticated, service_role;

-- Removes the shop's own address. Returns the Cloudflare id to remove there.
CREATE OR REPLACE FUNCTION public.website_domain_remove(p_business_id uuid)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_cf text;
BEGIN
    IF NOT public.is_owner_or_admin(p_business_id) THEN
        RAISE EXCEPTION 'Only the owner or an admin can change the web address.';
    END IF;
    DELETE FROM public.website_domains WHERE business_id = p_business_id RETURNING cf_hostname_id INTO v_cf;
    RETURN v_cf;
END;
$$;
REVOKE ALL ON FUNCTION public.website_domain_remove(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.website_domain_remove(uuid) TO authenticated, service_role;

-- ============================================================================================
-- 4. Is the shop open? And which shop is at this address?
-- ============================================================================================
-- {open, orders_open, powered_by, own_domain} for a branch, from its company's plan.
CREATE OR REPLACE FUNCTION public.fn_website_shop(p_business_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    r jsonb := public.fn_tenant_plan(public.fn_business_tenant(p_business_id));
    v_open boolean;
BEGIN
    IF r IS NULL THEN
        RETURN jsonb_build_object('open', false, 'orders_open', false, 'powered_by', false, 'own_domain', false);
    END IF;
    v_open := (r->'modules' ? 'online_store') AND r->>'status' <> 'suspended';
    RETURN jsonb_build_object(
        'open', v_open,
        'orders_open', v_open AND COALESCE((r->>'writable')::boolean, false),
        'powered_by', COALESCE((r->>'powered_by')::boolean, false),
        'own_domain', r->'modules' ? 'own_domain');
END;
$$;
REVOKE ALL ON FUNCTION public.fn_website_shop(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_website_shop(uuid) TO service_role;

-- The address a shop is shown at: its active own domain (plan allowing), else its subdomain.
CREATE OR REPLACE FUNCTION public.fn_website_home_host(p_business_id uuid)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT COALESCE(
        (SELECT d.hostname FROM public.website_domains d
         WHERE d.business_id = b.id AND d.status = 'active'
           AND public.has_module(b.id, 'own_domain')),
        CASE WHEN s.platform_domain IS NOT NULL AND b.website_slug IS NOT NULL
             THEN b.website_slug || '.' || s.platform_domain END)
    FROM public.businesses b CROSS JOIN public.platform_settings s
    WHERE b.id = p_business_id AND s.id;
$$;
REVOKE ALL ON FUNCTION public.fn_website_home_host(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_website_home_host(uuid) TO service_role;

-- The website Worker asks this for every address it serves (cached for a minute there).
--   {kind:'none'}                     nothing here (says nothing about any business)
--   {kind:'platform'}                 the platform's own address (www or bare domain)
--   {kind:'redirect', host}           send the visitor to this address (301)
--   {kind:'closed', name}             a shop whose plan has no online store now
--   {kind:'shop', slug, host, ...}    serve this shop
CREATE OR REPLACE FUNCTION public.resolve_website_host(p_host text)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_host text := public.fn_clean_hostname(p_host);
    st public.platform_settings;
    v_sub text;
    v_id uuid;
    v_name text;
    v_slug text;
    v_home text;
    v_shop jsonb;
BEGIN
    IF v_host IS NULL THEN
        RETURN jsonb_build_object('kind', 'none');
    END IF;
    SELECT * INTO st FROM public.platform_settings WHERE id;

    IF st.platform_domain IS NOT NULL AND (v_host = st.platform_domain OR v_host = 'www.' || st.platform_domain) THEN
        RETURN jsonb_build_object('kind', 'platform');
    END IF;

    IF st.platform_domain IS NOT NULL AND right(v_host, length(st.platform_domain) + 1) = '.' || st.platform_domain THEN
        v_sub := left(v_host, length(v_host) - length(st.platform_domain) - 1);
        IF position('.' IN v_sub) > 0 THEN
            RETURN jsonb_build_object('kind', 'none');
        END IF;
        SELECT b.id, b.name, b.website_slug INTO v_id, v_name, v_slug
        FROM public.businesses b WHERE b.website_slug = v_sub AND b.deleted_at IS NULL;
        IF NOT FOUND THEN
            -- An old name within its 90 days: send visitors to where the shop is now.
            SELECT h.business_id INTO v_id FROM public.website_slug_history h
            JOIN public.businesses b ON b.id = h.business_id AND b.deleted_at IS NULL
            WHERE h.old_slug = v_sub AND h.redirect_until > now()
            ORDER BY h.changed_at DESC LIMIT 1;
            v_home := CASE WHEN v_id IS NOT NULL THEN public.fn_website_home_host(v_id) END;
            IF v_home IS NOT NULL AND (public.fn_website_shop(v_id)->>'open')::boolean THEN
                RETURN jsonb_build_object('kind', 'redirect', 'host', v_home);
            END IF;
            RETURN jsonb_build_object('kind', 'none');
        END IF;
    ELSE
        SELECT b.id, b.name, b.website_slug INTO v_id, v_name, v_slug
        FROM public.website_domains d
        JOIN public.businesses b ON b.id = d.business_id AND b.deleted_at IS NULL
        WHERE d.hostname = v_host AND d.status = 'active';
        IF NOT FOUND THEN
            RETURN jsonb_build_object('kind', 'none');
        END IF;
    END IF;

    v_shop := public.fn_website_shop(v_id);
    IF v_slug IS NULL OR NOT (v_shop->>'open')::boolean THEN
        RETURN jsonb_build_object('kind', 'closed', 'name', v_name);
    END IF;
    v_home := public.fn_website_home_host(v_id);
    IF v_home IS NOT NULL AND v_home <> v_host THEN
        RETURN jsonb_build_object('kind', 'redirect', 'host', v_home);
    END IF;
    RETURN jsonb_build_object(
        'kind', 'shop',
        'slug', v_slug,
        'host', COALESCE(v_home, v_host),
        'powered_by', (v_shop->>'powered_by')::boolean,
        'orders_open', (v_shop->>'orders_open')::boolean,
        'platform_name', st.platform_name,
        'platform_url', CASE WHEN st.platform_domain IS NOT NULL THEN 'https://' || st.platform_domain END);
END;
$$;
REVOKE ALL ON FUNCTION public.resolve_website_host(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_website_host(text) TO anon, authenticated, service_role;

-- ============================================================================================
-- 5. The public shop only opens on a plan with the Online store
-- ============================================================================================
ALTER FUNCTION public.get_public_storefront(text) RENAME TO fn_public_storefront_data;
REVOKE ALL ON FUNCTION public.fn_public_storefront_data(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_public_storefront_data(text) TO service_role;

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
    RETURN v_data || jsonb_build_object('site', jsonb_build_object(
        'ordersOpen', (v_shop->>'orders_open')::boolean,
        'poweredBy', (v_shop->>'powered_by')::boolean,
        'platformName', st.platform_name,
        'platformUrl', CASE WHEN st.platform_domain IS NOT NULL THEN 'https://' || st.platform_domain END,
        'host', public.fn_website_home_host(v_id)));
END;
$$;
REVOKE ALL ON FUNCTION public.get_public_storefront(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_storefront(text) TO anon, authenticated, service_role;

-- No online order for a shop whose plan has no online store, whoever calls.
CREATE OR REPLACE FUNCTION public.fn_online_order_needs_store()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF NOT (public.fn_website_shop(NEW.business_id)->>'orders_open')::boolean THEN
        RAISE EXCEPTION 'This shop is not taking online orders right now.' USING HINT = 'plan_module';
    END IF;
    RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.fn_online_order_needs_store() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_online_order_needs_store ON public.online_orders;
CREATE TRIGGER trg_online_order_needs_store BEFORE INSERT ON public.online_orders
    FOR EACH ROW EXECUTE FUNCTION public.fn_online_order_needs_store();

-- ============================================================================================
-- 6. What the app's Online Store screen shows about the address
-- ============================================================================================
CREATE OR REPLACE FUNCTION public.website_address_info(p_business_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    b public.businesses;
    st public.platform_settings;
    d public.website_domains;
    v_shop jsonb;
    v_count integer;
    v_next timestamptz;
BEGIN
    IF NOT public.is_owner_or_admin(p_business_id) THEN
        RAISE EXCEPTION 'Only the owner or an admin can see the web address settings.';
    END IF;
    SELECT * INTO b FROM public.businesses WHERE id = p_business_id;
    SELECT * INTO st FROM public.platform_settings WHERE id;
    SELECT * INTO d FROM public.website_domains WHERE business_id = p_business_id;
    v_shop := public.fn_website_shop(p_business_id);
    SELECT count(*), min(changed_at) + interval '365 days' INTO v_count, v_next
    FROM public.website_slug_history
    WHERE business_id = p_business_id AND changed_at > now() - interval '365 days';

    RETURN jsonb_build_object(
        'slug', b.website_slug,
        'platform_domain', st.platform_domain,
        'address', CASE WHEN b.website_slug IS NOT NULL AND st.platform_domain IS NOT NULL
                        THEN b.website_slug || '.' || st.platform_domain END,
        'home', public.fn_website_home_host(p_business_id),
        'open', (v_shop->>'open')::boolean,
        'orders_open', (v_shop->>'orders_open')::boolean,
        'changes_left', CASE WHEN b.website_slug IS NULL THEN NULL ELSE greatest(0, 2 - v_count) END,
        'next_change_at', CASE WHEN v_count >= 2 THEN v_next END,
        'old_names', COALESCE((SELECT jsonb_agg(jsonb_build_object('slug', h.old_slug, 'until', h.redirect_until)
                                                ORDER BY h.changed_at DESC)
                               FROM public.website_slug_history h
                               WHERE h.business_id = p_business_id AND h.redirect_until > now()), '[]'::jsonb),
        'own_domain_allowed', (v_shop->>'own_domain')::boolean,
        'domain_target', COALESCE(st.custom_domain_target,
                                  CASE WHEN st.platform_domain IS NOT NULL THEN 'customers.' || st.platform_domain END),
        'domain', CASE WHEN d.business_id IS NULL THEN NULL ELSE jsonb_build_object(
            'hostname', d.hostname, 'status', d.status, 'dns_records', d.dns_records,
            'last_error', d.last_error, 'checked_at', d.checked_at) END);
END;
$$;
REVOKE ALL ON FUNCTION public.website_address_info(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.website_address_info(uuid) TO authenticated, service_role;

-- ============================================================================================
-- 7. Read-only companies: same rule as every other business table (20261204001 section 6)
-- ============================================================================================
DROP TRIGGER IF EXISTS trg_zz_plan_read_only ON public.website_slug_history;
CREATE TRIGGER trg_zz_plan_read_only BEFORE INSERT OR UPDATE OR DELETE ON public.website_slug_history
    FOR EACH ROW EXECUTE FUNCTION public.fn_block_when_read_only();
DROP TRIGGER IF EXISTS trg_zz_plan_read_only ON public.website_domains;
CREATE TRIGGER trg_zz_plan_read_only BEFORE INSERT OR UPDATE OR DELETE ON public.website_domains
    FOR EACH ROW EXECUTE FUNCTION public.fn_block_when_read_only();
