-- 20260722001_password_reset_functions.sql
-- Fixes Password Reset flow for unauthenticated (anon) users.
-- Provides SECURITY DEFINER functions to check user email, generate OTP, and verify recovery OTP.

BEGIN;

-- 1. Function: request_password_reset_otp
-- Checks if an email belongs to a registered user (case-insensitive in public.users or auth.users),
-- generates a 6-digit recovery OTP, and saves it into public.otps.
CREATE OR REPLACE FUNCTION public.request_password_reset_otp(
    p_email TEXT
)
RETURNS TABLE (
    user_exists BOOLEAN,
    user_name   TEXT,
    otp_code    TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_user_name TEXT;
    v_otp       TEXT;
    v_clean_email TEXT;
BEGIN
    v_clean_email := LOWER(TRIM(p_email));

    -- Check if user exists in public.users (case-insensitive)
    SELECT u.name INTO v_user_name
    FROM public.users u
    WHERE LOWER(TRIM(u.email)) = v_clean_email
    LIMIT 1;

    -- Fallback: check auth.users metadata if not found in public.users
    IF v_user_name IS NULL THEN
        SELECT COALESCE(raw_user_meta_data->>'full_name', raw_user_meta_data->>'name', 'User') INTO v_user_name
        FROM auth.users
        WHERE LOWER(TRIM(email)) = v_clean_email
        LIMIT 1;
    END IF;

    -- If user does not exist in either table, return false
    IF v_user_name IS NULL THEN
        RETURN QUERY SELECT FALSE, NULL::TEXT, NULL::TEXT;
        RETURN;
    END IF;

    -- Generate random 6-digit OTP code
    v_otp := LPAD(FLOOR(RANDOM() * 900000 + 100000)::TEXT, 6, '0');

    -- Save OTP in public.otps table
    INSERT INTO public.otps (email, code, type, expires_at)
    VALUES (v_clean_email, v_otp, 'password_reset', NOW() + INTERVAL '15 minutes')
    ON CONFLICT (email, type) DO UPDATE SET
        code       = EXCLUDED.code,
        expires_at = EXCLUDED.expires_at,
        created_at = NOW();

    RETURN QUERY SELECT TRUE, v_user_name, v_otp;
END;
$$;

GRANT EXECUTE ON FUNCTION public.request_password_reset_otp(TEXT) TO anon, authenticated;

-- 2. Function: verify_password_reset_otp
-- Verifies a password reset OTP, deletes it if valid, and returns success boolean.
CREATE OR REPLACE FUNCTION public.verify_password_reset_otp(
    p_email TEXT,
    p_code  TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_success BOOLEAN := FALSE;
    v_clean_email TEXT;
    v_clean_code TEXT;
BEGIN
    v_clean_email := LOWER(TRIM(p_email));
    v_clean_code  := TRIM(p_code);

    IF EXISTS (
        SELECT 1 FROM public.otps
        WHERE LOWER(TRIM(email)) = v_clean_email
          AND TRIM(code) = v_clean_code
          AND type = 'password_reset'
          AND expires_at > NOW()
    ) THEN
        DELETE FROM public.otps
        WHERE LOWER(TRIM(email)) = v_clean_email
          AND type = 'password_reset';

        v_success := TRUE;
    END IF;

    RETURN v_success;
END;
$$;

GRANT EXECUTE ON FUNCTION public.verify_password_reset_otp(TEXT, TEXT) TO anon, authenticated;

-- 3. Function: update_user_password_by_email
-- Updates encrypted_password for a user in auth.users by email safely.
CREATE OR REPLACE FUNCTION public.update_user_password_by_email(
    p_email TEXT,
    p_new_password TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_clean_email TEXT;
BEGIN
    v_clean_email := LOWER(TRIM(p_email));

    UPDATE auth.users
    SET encrypted_password = crypt(p_new_password, gen_salt('bf')),
        updated_at = NOW()
    WHERE LOWER(TRIM(email)) = v_clean_email;

    RETURN TRUE;
END;
$$;

GRANT EXECUTE ON FUNCTION public.update_user_password_by_email(TEXT, TEXT) TO anon, authenticated;

COMMIT;
