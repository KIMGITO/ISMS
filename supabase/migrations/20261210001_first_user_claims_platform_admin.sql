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
