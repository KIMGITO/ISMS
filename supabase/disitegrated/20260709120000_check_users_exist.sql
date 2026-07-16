-- 20260709120000_check_users_exist.sql
-- Redefine check_owner_exists() to check if at least one user exists in public.users.
-- This ensures that if any user exists in the system, Owner Registration is bypassed.

CREATE OR REPLACE FUNCTION public.check_owner_exists()
RETURNS BOOLEAN AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM public.users
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.check_owner_exists TO anon, authenticated;
