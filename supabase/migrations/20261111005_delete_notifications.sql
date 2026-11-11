-- Deleting notifications never reached the database, so they came back on the next load.
--
-- A delete sets deleted_at. The app's update goes through PostgREST, which returns the
-- changed row, so Postgres also checks the new row against the SELECT policy, and that
-- policy hides rows with deleted_at set. Every delete was refused (42501); the app had
-- already hidden the row and only logged the error.
--
-- This function does the soft delete itself, for notifications the caller can see
-- (same rule as the SELECT policy), and returns how many it deleted.

BEGIN;

CREATE OR REPLACE FUNCTION public.delete_my_notifications(p_ids UUID[])
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_count INTEGER;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Sign in first.' USING ERRCODE = '42501';
    END IF;

    UPDATE public.notifications n
    SET deleted_at = NOW()
    WHERE n.id = ANY(p_ids)
      AND n.deleted_at IS NULL
      AND n.business_id = ANY(public.get_user_business_ids())
      AND public.fn_can_see_notification(n.business_id, n.user_id, n.role, n.type, n.created_at);
    GET DIAGNOSTICS v_count = ROW_COUNT;
    RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.delete_my_notifications(UUID[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_my_notifications(UUID[]) TO authenticated, service_role;

COMMIT;
