-- 20260709140000_add_users_insert_policy.sql

-- Add INSERT policy for users table to allow client-side profile creation fallback
DROP POLICY IF EXISTS pol_users_insert ON public.users;
CREATE POLICY pol_users_insert ON public.users 
    FOR INSERT 
    WITH CHECK (auth_user_id = auth.uid());
