-- 20260722003_fix_pgcrypto_schema.sql
-- Fixes search_path and extensions schema qualification for pgcrypto functions (crypt & gen_salt).

BEGIN;

CREATE OR REPLACE FUNCTION public.update_user_password_by_email(
    p_email TEXT,
    p_new_password TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, auth
AS $$
DECLARE
    v_clean_email TEXT;
BEGIN
    v_clean_email := LOWER(TRIM(p_email));

    -- Update encrypted password in auth.users using extensions.crypt and extensions.gen_salt
    UPDATE auth.users
    SET encrypted_password = extensions.crypt(p_new_password, extensions.gen_salt('bf')),
        updated_at = NOW()
    WHERE LOWER(TRIM(email)) = v_clean_email;

    RETURN TRUE;
END;
$$;

GRANT EXECUTE ON FUNCTION public.update_user_password_by_email(TEXT, TEXT) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;
