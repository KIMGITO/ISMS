-- Signing out must end access everywhere, at once.
--
-- Supabase access tokens are self-contained: after sign-out the token kept
-- working against the database until it expired (up to jwt_expiry = 1 hour).
-- Sign-out deletes the row in auth.sessions, so every request from a signed-in
-- role now checks that its session row still exists.
--
--   * API (tables + RPC): PostgREST runs public.check_request_session() before
--     every request; a dead session gets HTTP 401 {"code":"session_revoked"}.
--   * File storage: a restrictive policy on storage.objects.
--   * Edge functions already use auth.getUser(), which refuses dead sessions.

CREATE OR REPLACE FUNCTION public.session_is_live()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT CASE
    -- Only signed-in users have a session to check (anon / service_role pass).
    WHEN coalesce(auth.jwt() ->> 'role', '') <> 'authenticated' THEN true
    -- Every token the Auth server issues carries its session id.
    WHEN coalesce(auth.jwt() ->> 'session_id', '') = '' THEN false
    ELSE EXISTS (
      SELECT 1
      FROM auth.sessions s
      WHERE s.id::text = auth.jwt() ->> 'session_id'
        AND (s.not_after IS NULL OR s.not_after > now())
    )
  END;
$$;

REVOKE ALL ON FUNCTION public.session_is_live() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.session_is_live() TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.check_request_session()
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT public.session_is_live() THEN
    RAISE SQLSTATE 'PGRST' USING
      message = json_build_object(
        'code', 'session_revoked',
        'message', 'You are signed out. Please sign in again.'
      )::text,
      detail = json_build_object(
        'status', 401,
        'headers', json_build_object('WWW-Authenticate', 'Bearer error="invalid_token"')
      )::text;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.check_request_session() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.check_request_session() TO anon, authenticated, service_role;

ALTER ROLE authenticator SET pgrst.db_pre_request = 'public.check_request_session';
NOTIFY pgrst, 'reload config';

-- File storage: a dead session can't read, upload, change or delete files.
DROP POLICY IF EXISTS "signed-in session must be live" ON storage.objects;
CREATE POLICY "signed-in session must be live" ON storage.objects
  AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT public.session_is_live()))
  WITH CHECK ((SELECT public.session_is_live()));
