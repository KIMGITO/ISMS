-- 20260722002_update_user_password_by_email.sql
-- Function to allow logged-out users to complete password reset via RPC.

BEGIN;

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

    -- Update encrypted password in auth.users table using pgcrypto crypt
    UPDATE auth.users
    SET encrypted_password = crypt(p_new_password, gen_salt('bf')),
        updated_at = NOW()
    WHERE LOWER(TRIM(email)) = v_clean_email;

    RETURN TRUE;
END;
$$;

GRANT EXECUTE ON FUNCTION public.update_user_password_by_email(TEXT, TEXT) TO anon, authenticated;

-- Reload PostgREST schema cache to ensure immediate visibility
NOTIFY pgrst, 'reload schema';

COMMIT;
