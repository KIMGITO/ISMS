-- =============================================================================
-- Security fix (audit 2026-11-07): invitation acceptance could take over accounts
-- =============================================================================
-- accept_invitation_with_token() is callable without a login (sign-up calls it right
-- after supabase.auth.signUp, possibly before a session exists) and trusted the
-- p_auth_user_id it was given. Anyone holding ANY valid invitation token (any business
-- owner can create one) could pass someone else's user id and overwrite that person's
-- profile email, name, phone and employee role. otp_lookup_user() also matched the
-- profile email, so a password reset for the attacker's address then reached the
-- victim's account.
--
-- Fix:
--   1. The account must be the one the invitation was sent to: its login email in
--      auth.users must equal the invitation's email. When the caller is logged in,
--      it must also be that same account.
--   2. Password-reset lookup matches only the real login email (auth.users.email).
-- =============================================================================

CREATE OR REPLACE FUNCTION public.accept_invitation_with_token(
    p_token        TEXT,
    p_auth_user_id UUID,
    p_name         TEXT,
    p_phone        TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
    v_invite      RECORD;
    v_user_id     UUID;
    v_login_email TEXT;
BEGIN
    SELECT * INTO v_invite
    FROM public.invitations
    WHERE invitation_token = p_token
      AND status = 'Pending'
      AND expires_at > NOW();

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Invalid, expired, or already accepted invitation.';
    END IF;

    -- A logged-in caller can only accept for their own account
    IF auth.uid() IS NOT NULL AND auth.uid() <> p_auth_user_id THEN
        RAISE EXCEPTION 'This invitation belongs to a different account.';
    END IF;

    -- The account must be the one the invitation was sent to
    SELECT email INTO v_login_email FROM auth.users WHERE id = p_auth_user_id;
    IF v_login_email IS NULL
       OR LOWER(TRIM(v_login_email)) <> LOWER(TRIM(v_invite.email)) THEN
        RAISE EXCEPTION 'This invitation belongs to a different account.';
    END IF;

    -- Find or create the public.users profile
    SELECT id INTO v_user_id
    FROM public.users
    WHERE auth_user_id = p_auth_user_id;

    IF v_user_id IS NULL THEN
        INSERT INTO public.users (id, auth_user_id, name, email, phone, is_verified)
        VALUES (p_auth_user_id, p_auth_user_id, p_name, v_invite.email, p_phone, FALSE)
        RETURNING id INTO v_user_id;
    ELSE
        UPDATE public.users
        SET name = p_name, phone = p_phone, email = v_invite.email
        WHERE id = v_user_id;
    END IF;

    -- Activate business membership
    INSERT INTO public.business_memberships (business_id, user_id, role, status)
    VALUES (v_invite.business_id, v_user_id, v_invite.role, 'Active')
    ON CONFLICT (business_id, user_id) DO UPDATE SET
        role   = v_invite.role,
        status = 'Active';

    -- Create or update employee profile
    INSERT INTO public.employees
        (id, business_id, user_id, name, role, email, phone, pin, assigned_branches)
    VALUES (
        v_user_id,
        v_invite.business_id,
        v_user_id,
        p_name,
        v_invite.role,
        v_invite.email,
        p_phone,
        '0000',
        jsonb_build_array(v_invite.business_id::TEXT)
    )
    ON CONFLICT (id) DO UPDATE SET
        name  = p_name,
        role  = v_invite.role,
        email = v_invite.email,
        phone = p_phone;

    -- Mark invitation as accepted
    UPDATE public.invitations
    SET status = 'Accepted', accepted_at = NOW()
    WHERE id = v_invite.id;

    RETURN TRUE;
END;
$$;

-- Same callers as before (sign-up may run before a session exists)
REVOKE ALL ON FUNCTION public.accept_invitation_with_token(TEXT, UUID, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.accept_invitation_with_token(TEXT, UUID, TEXT, TEXT) TO anon, authenticated, service_role;

-- Password reset: only the real login email identifies an account. A profile email can
-- be edited, so it must never decide where a reset code for an account goes.
CREATE OR REPLACE FUNCTION public.otp_lookup_user(p_email TEXT)
RETURNS TABLE (auth_user_id UUID, user_name TEXT)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
    SELECT au.id,
           COALESCE(u.name, au.raw_user_meta_data->>'name', au.raw_user_meta_data->>'full_name', 'User')
    FROM auth.users au
    LEFT JOIN public.users u ON u.auth_user_id = au.id
    WHERE LOWER(TRIM(au.email)) = LOWER(TRIM(p_email))
    LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.otp_lookup_user(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.otp_lookup_user(TEXT) TO service_role;
