-- Only the person who set up the system can create businesses.
--
-- The system creator is whoever holds the first Owner membership ever made
-- (the first person to register and set up a business). Everyone else joins
-- by invitation and can never create a business or become an Owner.
--
-- Closes three gaps:
--   * create_business_with_owner allowed any Owner (an invite as Owner made one).
--   * Any signed-in user could insert a row into businesses directly.
--   * Owners/Admins could invite someone as Owner, or write an Owner membership.

CREATE OR REPLACE FUNCTION public.is_system_creator(p_auth_user_id uuid DEFAULT auth.uid())
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.users u
    WHERE u.auth_user_id = p_auth_user_id
      AND u.id = (
        SELECT bm.user_id
        FROM public.business_memberships bm
        WHERE bm.role = 'Owner'
        ORDER BY bm.created_at, bm.id
        LIMIT 1
      )
  );
$$;

REVOKE ALL ON FUNCTION public.is_system_creator(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_system_creator(uuid) TO authenticated, service_role;

-- True only for a verified account that is setting the system up for the first
-- time, or for the system creator.
CREATE OR REPLACE FUNCTION public.can_create_business()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT auth.uid() IS NOT NULL
     AND public.account_email_verified(auth.uid())
     AND (
       NOT EXISTS (SELECT 1 FROM public.business_memberships WHERE role = 'Owner')
       OR public.is_system_creator(auth.uid())
     );
$$;

REVOKE ALL ON FUNCTION public.can_create_business() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_create_business() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.create_business_with_owner(
  p_name text, p_type text, p_country text, p_currency text,
  p_logo_url text, p_description text, p_address text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
    v_business_id UUID;
    v_user_id     UUID;
BEGIN
    IF NOT public.account_email_verified(auth.uid()) THEN
        RAISE EXCEPTION 'Please verify your email before creating a business.' USING ERRCODE = '42501';
    END IF;
    -- Serialise first-time setup so two people can't both become the creator.
    PERFORM pg_advisory_xact_lock(hashtext('create_business_with_owner'));
    IF NOT public.can_create_business() THEN
        RAISE EXCEPTION 'Only the person who set up this system can create a business. Ask them to invite you.' USING ERRCODE = '42501';
    END IF;

    SELECT id INTO v_user_id
    FROM public.users
    WHERE auth_user_id = auth.uid();

    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'User profile not found. Please complete signup first.';
    END IF;

    INSERT INTO public.businesses
        (name, business_type, country, currency, logo_url, description, address)
    VALUES
        (p_name, p_type, p_country, p_currency, p_logo_url, p_description, p_address)
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

-- Businesses are only made through create_business_with_owner.
DROP POLICY IF EXISTS "pol_businesses_insert" ON public.businesses;
CREATE POLICY "pol_businesses_insert" ON public.businesses
  FOR INSERT WITH CHECK ((SELECT public.can_create_business()));

-- Nobody is invited as Owner.
CREATE OR REPLACE FUNCTION public.fn_invitation_not_owner()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.role = 'Owner' THEN
    RAISE EXCEPTION 'Nobody can be invited as Owner.' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_invitation_not_owner ON public.invitations;
CREATE TRIGGER trg_invitation_not_owner
  BEFORE INSERT OR UPDATE OF role ON public.invitations
  FOR EACH ROW EXECUTE FUNCTION public.fn_invitation_not_owner();

-- The app can't make anyone an Owner; only create_business_with_owner does
-- (it runs as the function owner, not as the signed-in user).
CREATE OR REPLACE FUNCTION public.fn_membership_owner_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF current_user IN ('authenticated', 'anon')
     AND NEW.role = 'Owner'
     AND (TG_OP = 'INSERT' OR OLD.role IS DISTINCT FROM 'Owner') THEN
    RAISE EXCEPTION 'Nobody can be made an Owner.' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_membership_owner_guard ON public.business_memberships;
CREATE TRIGGER trg_membership_owner_guard
  BEFORE INSERT OR UPDATE OF role ON public.business_memberships
  FOR EACH ROW EXECUTE FUNCTION public.fn_membership_owner_guard();

NOTIFY pgrst, 'reload schema';
