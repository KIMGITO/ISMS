-- The assistant reads what a person may do from the database on every message, using the
-- same rule as has_permission: a saved row on the Roles screen wins, otherwise the role's
-- default. Before this, the chat function read only saved rows (so a role never saved had
-- nothing) and offered a fixed list of 12 tasks, so it refused things the Roles screen allowed.

CREATE OR REPLACE FUNCTION public.my_permissions(p_business_id uuid)
RETURNS TABLE (member_role text, full_access boolean, codes text[])
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
    v_role text;
BEGIN
    SELECT bm.role::text INTO v_role
    FROM public.business_memberships bm
    JOIN public.users u ON u.id = bm.user_id
    WHERE u.auth_user_id = auth.uid()
      AND bm.business_id = p_business_id
      AND bm.status = 'Active';

    IF v_role IS NULL THEN
        RETURN;
    END IF;
    IF v_role IN ('Owner', 'Admin', 'Administrator') THEN
        RETURN QUERY SELECT v_role, true, ARRAY[]::text[];
        RETURN;
    END IF;

    RETURN QUERY
    SELECT v_role, false, COALESCE(array_agg(s.code ORDER BY s.code), ARRAY[]::text[])
    FROM (
        SELECT rp.permission AS code
        FROM public.role_permissions rp
        WHERE rp.business_id = p_business_id AND rp.role::text = v_role AND rp.granted
        UNION
        SELECT d.code
        FROM public.role_default_permissions r, unnest(r.permissions) AS d(code)
        WHERE r.role = v_role
          AND NOT EXISTS (
              SELECT 1 FROM public.role_permissions rp
              WHERE rp.business_id = p_business_id AND rp.role::text = v_role AND rp.permission = d.code
          )
    ) s;
END;
$$;

REVOKE ALL ON FUNCTION public.my_permissions(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_permissions(uuid) TO authenticated, service_role;

-- Which business's AI settings to use. A branch that never saved its own uses the ones
-- the owner saved on another branch, so the website and app of every branch run on the
-- AI the owner chose instead of the built-in default.
CREATE OR REPLACE FUNCTION public.fn_ai_settings_business(p_business_id uuid)
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
    SELECT COALESCE(
        (SELECT s.business_id FROM public.ai_settings s WHERE s.business_id = p_business_id),
        (SELECT s.business_id
         FROM public.ai_settings s
         JOIN public.businesses b ON b.id = s.business_id AND b.deleted_at IS NULL
         WHERE s.business_id <> p_business_id
           AND public.fn_branches_share_owner(p_business_id, s.business_id)
         ORDER BY s.updated_at DESC
         LIMIT 1),
        p_business_id
    );
$$;

REVOKE ALL ON FUNCTION public.fn_ai_settings_business(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_ai_settings_business(uuid) TO service_role;
