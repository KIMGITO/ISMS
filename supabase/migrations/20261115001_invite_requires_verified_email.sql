-- =============================================================================
-- Security fix (2026-11-15): staff invitations reached people who never proved
-- they own the invited email address
-- =============================================================================
-- Holes closed here:
--   1. pol_invitations_select let anyone read an invitation, code included, when
--      their profile email matched it. Email confirmation is off, so anyone could
--      sign up with the invitee's address, read the code from the table and join.
--      Every staff member could also read every pending code in the business.
--   2. accept_invitation_with_token made the membership Active straight away,
--      before the emailed 6-digit code was entered.
--   3. users.is_verified could be set by the user on their own row, and the code
--      check marked profiles verified by profile email (also user-editable).
--   4. get_invitation_by_token had no limit on guesses.
--   5. An unverified account could create a business.
--
-- After this migration:
--   * Only people who can invite staff (staff.invite) can read invitations.
--   * "Verified" means the account's login email equals users.verified_email,
--     which only the server sets after a correct emailed code.
--   * Entering a code on an unverified account only claims the invitation. The
--     membership turns Active when the emailed code is entered (otp_confirm_signup).
--   * A password reset signs out every session and drops claims made with the
--     old password, so an account squatted on someone's email can't keep them.
--   * Wrong codes are limited to 10 per 15 minutes per network address.
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Verified email: set by the server only
-- ---------------------------------------------------------------------------
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS verified_email TEXT;

-- Accounts already verified keep that status for their current email.
UPDATE public.users SET verified_email = email
WHERE is_verified = TRUE AND verified_email IS NULL;

CREATE OR REPLACE FUNCTION public.fn_users_protect_verified()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
    IF current_user IN ('anon', 'authenticated') THEN
        -- The app can't vouch for an email address; keep what the server set.
        NEW.verified_email := CASE WHEN TG_OP = 'UPDATE' THEN OLD.verified_email ELSE NULL END;
    ELSIF NEW.is_verified IS TRUE
          AND (TG_OP = 'INSERT' OR OLD.is_verified IS NOT TRUE)
          AND NEW.verified_email IS NULL THEN
        -- Server code (seed data, older functions) that marks a row verified
        NEW.verified_email := NEW.email;
    END IF;

    NEW.is_verified := NEW.verified_email IS NOT NULL
        AND LOWER(TRIM(NEW.verified_email)) = LOWER(TRIM(COALESCE(NEW.email, '')));
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_users_protect_verified ON public.users;
CREATE TRIGGER trg_users_protect_verified
BEFORE INSERT OR UPDATE ON public.users
FOR EACH ROW EXECUTE FUNCTION public.fn_users_protect_verified();

-- TRUE when the account's login email is the one it proved with a code.
CREATE OR REPLACE FUNCTION public.account_email_verified(p_auth_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM auth.users au
        JOIN public.users u ON u.auth_user_id = au.id
        WHERE au.id = p_auth_user_id
          AND u.verified_email IS NOT NULL
          AND LOWER(TRIM(u.verified_email)) = LOWER(TRIM(au.email))
    );
$$;

REVOKE ALL ON FUNCTION public.account_email_verified(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.account_email_verified(UUID) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. Invitations: only inviters can read them (and their codes)
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS pol_invitations_select ON public.invitations;
CREATE POLICY pol_invitations_select ON public.invitations
    FOR SELECT USING (public.has_permission(business_id, 'staff.invite'));

-- Who entered the code while their email was still unverified
ALTER TABLE public.invitations
    ADD COLUMN IF NOT EXISTS claimed_by    UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS claimed_at    TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS claimed_name  TEXT,
    ADD COLUMN IF NOT EXISTS claimed_phone TEXT;

-- ---------------------------------------------------------------------------
-- 3. Guess limit for invitation codes
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.invite_guess_key()
RETURNS TEXT
LANGUAGE sql
STABLE
AS $$
    SELECT 'invite:ip:' || COALESCE(
        NULLIF(TRIM(split_part(COALESCE(
            current_setting('request.headers', TRUE)::json->>'cf-connecting-ip',
            current_setting('request.headers', TRUE)::json->>'x-forwarded-for',
            current_setting('request.headers', TRUE)::json->>'x-real-ip',
            ''), ',', 1)), ''),
        'unknown');
$$;

-- TRUE while this address is still under the wrong-code limit
CREATE OR REPLACE FUNCTION public.invite_guesses_left()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT NOT EXISTS (
        SELECT 1 FROM public.rate_limits
        WHERE key = public.invite_guess_key()
          AND window_start > NOW() - INTERVAL '15 minutes'
          AND count >= 10
    );
$$;

REVOKE ALL ON FUNCTION public.invite_guess_key()    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.invite_guesses_left() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_invitation_by_token(p_token TEXT)
RETURNS TABLE (
    id            UUID,
    business_id   UUID,
    business_name TEXT,
    invitee_name  TEXT,
    email         TEXT,
    phone         TEXT,
    role          public.employee_role,
    expires_at    TIMESTAMPTZ,
    status        public.invitation_status
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF NOT public.invite_guesses_left() THEN
        RETURN;
    END IF;

    RETURN QUERY
    SELECT i.id, i.business_id, b.name, i.name, i.email, i.phone, i.role, i.expires_at, i.status
    FROM public.invitations i
    JOIN public.businesses b ON b.id = i.business_id
    WHERE i.invitation_token = p_token
      AND i.status = 'Pending'
      AND i.expires_at > NOW();

    IF NOT FOUND THEN
        PERFORM public.check_rate_limit(public.invite_guess_key(), 1000000, 900);
    END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.get_invitation_by_token(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_invitation_by_token(TEXT) TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. Joining the business: server-only, runs once the email is proven
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.finish_invitation(
    p_invite_id    UUID,
    p_auth_user_id UUID,
    p_name         TEXT,
    p_phone        TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
    v_invite  RECORD;
    v_user_id UUID;
    v_shop    TEXT;
    v_name    TEXT;
BEGIN
    SELECT * INTO v_invite FROM public.invitations WHERE id = p_invite_id FOR UPDATE;
    IF NOT FOUND THEN
        RETURN;
    END IF;

    IF NOT public.account_email_verified(p_auth_user_id)
       OR NOT EXISTS (
           SELECT 1 FROM auth.users
           WHERE id = p_auth_user_id
             AND LOWER(TRIM(email)) = LOWER(TRIM(v_invite.email))
       ) THEN
        RAISE EXCEPTION 'Please verify your email before joining.';
    END IF;

    -- The name they typed, else the one the admin entered. Never the shop name.
    SELECT name INTO v_shop FROM public.businesses WHERE id = v_invite.business_id;
    v_name := NULLIF(TRIM(COALESCE(p_name, '')), '');
    IF v_name IS NULL OR v_name = TRIM(v_shop) THEN
        v_name := COALESCE(NULLIF(TRIM(v_invite.name), ''), v_name, 'Team member');
    END IF;

    SELECT id INTO v_user_id FROM public.users WHERE auth_user_id = p_auth_user_id;

    IF v_user_id IS NULL THEN
        INSERT INTO public.users (id, auth_user_id, name, email, phone, is_verified)
        VALUES (p_auth_user_id, p_auth_user_id, v_name, v_invite.email, p_phone, FALSE)
        RETURNING id INTO v_user_id;
    ELSE
        UPDATE public.users
        SET name = v_name, phone = COALESCE(NULLIF(p_phone, ''), phone), email = v_invite.email
        WHERE id = v_user_id;
    END IF;

    -- The membership trigger creates or refreshes the employee row.
    INSERT INTO public.business_memberships (business_id, user_id, role, status)
    VALUES (v_invite.business_id, v_user_id, v_invite.role, 'Active')
    ON CONFLICT (business_id, user_id) DO UPDATE SET
        role   = v_invite.role,
        status = 'Active';
    PERFORM public.fn_sync_employee(v_invite.business_id, v_user_id);

    -- The code can't be used again.
    DELETE FROM public.invitations WHERE id = v_invite.id;
END;
$$;

REVOKE ALL ON FUNCTION public.finish_invitation(UUID, UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finish_invitation(UUID, UUID, TEXT, TEXT) TO service_role;

-- Returns FALSE for a wrong or expired code (so the guess counter is kept).
-- Returns TRUE once the code is accepted: joined now when the email is verified,
-- otherwise claimed and joined when the emailed code is entered.
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
    v_login_email TEXT;
BEGIN
    IF NOT public.invite_guesses_left() THEN
        RAISE EXCEPTION 'Too many wrong codes. Please wait 15 minutes and try again.';
    END IF;

    SELECT * INTO v_invite
    FROM public.invitations
    WHERE invitation_token = p_token
      AND status = 'Pending'
      AND expires_at > NOW()
    FOR UPDATE;

    IF NOT FOUND THEN
        PERFORM public.check_rate_limit(public.invite_guess_key(), 1000000, 900);
        RETURN FALSE;
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

    IF public.account_email_verified(p_auth_user_id) THEN
        PERFORM public.finish_invitation(v_invite.id, p_auth_user_id, p_name, p_phone);
    ELSE
        UPDATE public.invitations
        SET claimed_by    = p_auth_user_id,
            claimed_at    = NOW(),
            claimed_name  = p_name,
            claimed_phone = p_phone
        WHERE id = v_invite.id;
    END IF;

    RETURN TRUE;
END;
$$;

REVOKE ALL ON FUNCTION public.accept_invitation_with_token(TEXT, UUID, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.accept_invitation_with_token(TEXT, UUID, TEXT, TEXT) TO anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. Correct emailed code: verify this account and finish its claimed invitations
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.otp_confirm_signup(p_email TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_email TEXT := LOWER(TRIM(p_email));
    v_auth  RECORD;
    v_inv   RECORD;
BEGIN
    FOR v_auth IN SELECT id, email FROM auth.users WHERE LOWER(TRIM(email)) = v_email LOOP
        UPDATE auth.users
        SET email_confirmed_at = COALESCE(email_confirmed_at, NOW()),
            raw_app_meta_data  = COALESCE(raw_app_meta_data, '{}') ||
                                 jsonb_build_object('provider', 'email', 'providers', ARRAY['email'])
        WHERE id = v_auth.id;

        UPDATE public.users SET verified_email = v_auth.email WHERE auth_user_id = v_auth.id;

        FOR v_inv IN
            SELECT id, claimed_name, claimed_phone FROM public.invitations
            WHERE claimed_by = v_auth.id
              AND status = 'Pending'
              AND claimed_at > NOW() - INTERVAL '7 days'
        LOOP
            -- One bad invitation must not stop the email being verified.
            BEGIN
                PERFORM public.finish_invitation(v_inv.id, v_auth.id, v_inv.claimed_name, v_inv.claimed_phone);
            EXCEPTION WHEN OTHERS THEN
                RAISE WARNING '[otp_confirm_signup] invitation % not finished: %', v_inv.id, SQLERRM;
            END;
        END LOOP;
    END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.otp_confirm_signup(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.otp_confirm_signup(TEXT) TO service_role;

-- ---------------------------------------------------------------------------
-- 6. After a password reset by emailed code
-- ---------------------------------------------------------------------------
-- The person proved they own the inbox, so the email counts as verified. Whoever
-- had the old password is signed out everywhere, and anything they claimed with it
-- is dropped (the invitee can enter the code again).
CREATE OR REPLACE FUNCTION public.otp_after_password_reset(p_auth_user_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    UPDATE public.invitations
    SET claimed_by = NULL, claimed_at = NULL, claimed_name = NULL, claimed_phone = NULL
    WHERE claimed_by = p_auth_user_id;

    UPDATE public.users u SET verified_email = au.email
    FROM auth.users au
    WHERE au.id = p_auth_user_id AND u.auth_user_id = au.id;

    UPDATE auth.users SET email_confirmed_at = COALESCE(email_confirmed_at, NOW())
    WHERE id = p_auth_user_id;

    BEGIN
        DELETE FROM auth.sessions WHERE user_id = p_auth_user_id;
    EXCEPTION WHEN OTHERS THEN
        RAISE WARNING '[otp_after_password_reset] could not end sessions: %', SQLERRM;
    END;
END;
$$;

REVOKE ALL ON FUNCTION public.otp_after_password_reset(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.otp_after_password_reset(UUID) TO service_role;

-- ---------------------------------------------------------------------------
-- 7. Creating a business needs a verified email
-- ---------------------------------------------------------------------------
DO $migration$
DECLARE
    v_fn RECORD;
    v_guard TEXT := $guard$
    IF NOT public.account_email_verified(auth.uid()) THEN
        RAISE EXCEPTION 'Please verify your email before creating a business.' USING ERRCODE = '42501';
    END IF;$guard$;
BEGIN
    FOR v_fn IN
        SELECT p.oid
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.proname = 'create_business_with_owner'
    LOOP
        IF pg_get_functiondef(v_fn.oid) NOT LIKE '%account_email_verified%' THEN
            EXECUTE regexp_replace(pg_get_functiondef(v_fn.oid), '\mBEGIN\M', 'BEGIN' || v_guard, 'i');
            EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', v_fn.oid::regprocedure);
            EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', v_fn.oid::regprocedure);
        END IF;
    END LOOP;
END;
$migration$;

NOTIFY pgrst, 'reload schema';

COMMIT;
