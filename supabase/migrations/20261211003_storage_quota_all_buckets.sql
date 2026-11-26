-- The plan's storage allowance (storage_mb) now covers every bucket a business uploads to
-- (business files, product pictures, logos, receipts, exports, website media), not only the
-- website media library. Usage = all stored objects whose first folder is one of the
-- company's branches. A new upload is refused once usage has reached the allowance.
-- Folders that are a user id (profile pictures) are not counted.

CREATE OR REPLACE FUNCTION public.fn_tenant_storage_used(p_tenant uuid)
RETURNS bigint
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT COALESCE(sum((o.metadata->>'size')::bigint), 0)
    FROM storage.objects o
    WHERE split_part(o.name, '/', 1) IN (SELECT b.id::text FROM public.businesses b WHERE b.tenant_id = p_tenant);
$$;
REVOKE ALL ON FUNCTION public.fn_tenant_storage_used(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_tenant_storage_used(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.fn_storage_quota_ok(p_folder text)
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_tenant uuid;
    v_quota bigint;
BEGIN
    IF p_folder !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' THEN
        RETURN true;
    END IF;
    SELECT tenant_id INTO v_tenant FROM public.businesses WHERE id = p_folder::uuid;
    IF v_tenant IS NULL THEN
        RETURN true;  -- not a business folder (e.g. a user's own picture)
    END IF;
    v_quota := NULLIF(public.fn_tenant_plan(v_tenant)->>'storage_mb', '')::bigint * 1048576;
    IF v_quota IS NULL OR v_quota <= 0 THEN
        RETURN true;  -- no limit on this plan
    END IF;
    RETURN public.fn_tenant_storage_used(v_tenant) < v_quota;
END;
$$;
REVOKE ALL ON FUNCTION public.fn_storage_quota_ok(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_storage_quota_ok(text) TO authenticated, service_role;

-- Restrictive: applies on top of each bucket's own upload policy.
DROP POLICY IF EXISTS "plan storage allowance" ON storage.objects;
CREATE POLICY "plan storage allowance" ON storage.objects AS RESTRICTIVE FOR INSERT TO authenticated
    WITH CHECK (public.fn_storage_quota_ok(split_part(name, '/', 1)));

-- Usage for the app / console to show (own company only).
CREATE OR REPLACE FUNCTION public.my_storage_usage(p_business_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_tenant uuid;
BEGIN
    IF NOT (p_business_id = ANY(public.get_user_business_ids())) THEN
        RAISE EXCEPTION 'Not your business' USING ERRCODE = '42501';
    END IF;
    v_tenant := public.fn_business_tenant(p_business_id);
    RETURN jsonb_build_object(
        'used_bytes', public.fn_tenant_storage_used(v_tenant),
        'quota_mb', NULLIF(public.fn_tenant_plan(v_tenant)->>'storage_mb', '')::bigint);
END;
$$;
REVOKE ALL ON FUNCTION public.my_storage_usage(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_storage_usage(uuid) TO authenticated, service_role;
