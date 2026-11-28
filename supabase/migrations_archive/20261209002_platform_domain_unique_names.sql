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
