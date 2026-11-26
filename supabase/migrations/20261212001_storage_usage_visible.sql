-- Storage used / allowed, readable by platform admins (any company) and by people who can
-- manage the business (their own company). Reads the same figures the upload check uses
-- (fn_tenant_storage_used, fn_tenant_plan storage_mb), so the screen and the block agree.

CREATE OR REPLACE FUNCTION public.tenant_storage_usage(p_tenant_id uuid DEFAULT NULL, p_business_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_tenant uuid := p_tenant_id;
    v_mb bigint;
BEGIN
    IF v_tenant IS NULL AND p_business_id IS NOT NULL THEN
        SELECT tenant_id INTO v_tenant FROM public.businesses WHERE id = p_business_id;
    END IF;
    IF v_tenant IS NULL THEN
        RAISE EXCEPTION 'Company not found';
    END IF;
    IF NOT (
        public.is_platform_admin()
        OR (p_business_id IS NOT NULL
            AND public.has_permission(p_business_id, 'business.update')
            AND EXISTS (SELECT 1 FROM public.businesses b WHERE b.id = p_business_id AND b.tenant_id = v_tenant))
    ) THEN
        RAISE EXCEPTION 'Not allowed';
    END IF;
    v_mb := NULLIF(public.fn_tenant_plan(v_tenant)->>'storage_mb', '')::bigint;
    RETURN jsonb_build_object(
        'used_bytes', public.fn_tenant_storage_used(v_tenant),
        'quota_bytes', CASE WHEN v_mb IS NULL OR v_mb <= 0 THEN NULL ELSE v_mb * 1048576 END
    );
END;
$$;
REVOKE ALL ON FUNCTION public.tenant_storage_usage(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tenant_storage_usage(uuid, uuid) TO authenticated;
