-- A module (add-on) with no price set cannot be requested or approved.

CREATE OR REPLACE FUNCTION public.request_module(p_business_id uuid, p_module text, p_note text DEFAULT NULL, p_payment_reference text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_tenant uuid; v_id uuid;
BEGIN
    IF NOT public.has_permission(p_business_id, 'business.update') THEN RAISE EXCEPTION 'Not allowed'; END IF;
    SELECT tenant_id INTO v_tenant FROM public.businesses WHERE id = p_business_id;
    IF NOT EXISTS (SELECT 1 FROM public.plan_modules WHERE key = p_module) THEN RAISE EXCEPTION 'Unknown module'; END IF;
    IF NOT EXISTS (SELECT 1 FROM public.plan_modules WHERE key = p_module AND addable AND addon_monthly_price IS NOT NULL) THEN
        RAISE EXCEPTION 'This module has no price yet and cannot be requested';
    END IF;
    INSERT INTO public.module_requests (tenant_id, business_id, module_key, note, payment_reference)
    VALUES (v_tenant, p_business_id, p_module, NULLIF(trim(p_note), ''), NULLIF(trim(p_payment_reference), ''))
    RETURNING id INTO v_id;
    PERFORM public.fn_platform_log(v_tenant, 'module_requested', jsonb_build_object('module', p_module));
    RETURN v_id;
EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'This module is already requested and waiting';
END;
$$;
REVOKE ALL ON FUNCTION public.request_module(uuid, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_module(uuid, text, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.platform_decide_module_request(p_id uuid, p_approve boolean, p_payment_id uuid DEFAULT NULL, p_note text DEFAULT NULL)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE r public.module_requests;
BEGIN
    IF NOT public.is_platform_admin() THEN RAISE EXCEPTION 'Not allowed'; END IF;
    SELECT * INTO r FROM public.module_requests WHERE id = p_id FOR UPDATE;
    IF r.id IS NULL OR r.status <> 'pending' THEN RAISE EXCEPTION 'Request not waiting'; END IF;
    IF p_approve THEN
        IF NOT EXISTS (SELECT 1 FROM public.plan_modules WHERE key = r.module_key AND addon_monthly_price IS NOT NULL) THEN
            RAISE EXCEPTION 'Set this module''s price first';
        END IF;
        IF NOT EXISTS (SELECT 1 FROM public.platform_payments
                       WHERE id = p_payment_id AND tenant_id = r.tenant_id AND voided_at IS NULL) THEN
            RAISE EXCEPTION 'Record their payment first, then pick it here';
        END IF;
        UPDATE public.tenant_subscriptions
        SET custom_limits = jsonb_set(COALESCE(custom_limits, '{}'::jsonb), '{modules}',
            (SELECT to_jsonb(array_agg(DISTINCT m)) FROM (
                SELECT jsonb_array_elements_text(COALESCE(custom_limits->'modules', '[]'::jsonb)) AS m
                UNION SELECT r.module_key) x))
        WHERE tenant_id = r.tenant_id;
    END IF;
    UPDATE public.module_requests
    SET status = CASE WHEN p_approve THEN 'approved' ELSE 'rejected' END,
        payment_id = CASE WHEN p_approve THEN p_payment_id END,
        decision_note = NULLIF(trim(p_note), ''), decided_by = auth.uid(), decided_at = now()
    WHERE id = p_id;
    PERFORM public.fn_platform_log(r.tenant_id, CASE WHEN p_approve THEN 'module_approved' ELSE 'module_rejected' END,
        jsonb_build_object('module', r.module_key, 'note', NULLIF(trim(p_note), '')));
    RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.platform_decide_module_request(uuid, boolean, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.platform_decide_module_request(uuid, boolean, uuid, text) TO authenticated;
