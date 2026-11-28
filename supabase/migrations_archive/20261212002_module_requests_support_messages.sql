-- 1. Module requests: a business asks for a module; a platform admin approves it only against a
--    recorded (not voided) platform payment, so the money is in the books before access is given
--    (money rule 1). Approval adds the module to the company's own extra modules.
-- 2. Support messages: managers of a business and platform admins write to each other.

CREATE TABLE IF NOT EXISTS public.module_requests (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    module_key text NOT NULL REFERENCES public.plan_modules(key),
    note text CHECK (length(note) <= 500),
    payment_reference text CHECK (length(payment_reference) <= 100),
    status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
    payment_id uuid REFERENCES public.platform_payments(id),
    decision_note text CHECK (length(decision_note) <= 500),
    requested_by uuid DEFAULT auth.uid(),
    decided_by uuid,
    created_at timestamptz NOT NULL DEFAULT now(),
    decided_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS module_requests_one_pending ON public.module_requests (tenant_id, module_key) WHERE status = 'pending';
ALTER TABLE public.module_requests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS module_requests_read ON public.module_requests;
CREATE POLICY module_requests_read ON public.module_requests FOR SELECT TO authenticated
    USING (public.is_platform_admin() OR public.has_permission(business_id, 'business.update'));
GRANT SELECT ON public.module_requests TO authenticated;

CREATE OR REPLACE FUNCTION public.request_module(p_business_id uuid, p_module text, p_note text DEFAULT NULL, p_payment_reference text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_tenant uuid; v_id uuid;
BEGIN
    IF NOT public.has_permission(p_business_id, 'business.update') THEN RAISE EXCEPTION 'Not allowed'; END IF;
    SELECT tenant_id INTO v_tenant FROM public.businesses WHERE id = p_business_id;
    IF NOT EXISTS (SELECT 1 FROM public.plan_modules WHERE key = p_module) THEN RAISE EXCEPTION 'Unknown module'; END IF;
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

CREATE TABLE IF NOT EXISTS public.support_messages (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    from_platform boolean NOT NULL DEFAULT false,
    sender_id uuid DEFAULT auth.uid(),
    sender_name text,
    body text NOT NULL CHECK (length(body) BETWEEN 1 AND 2000),
    created_at timestamptz NOT NULL DEFAULT now(),
    read_at timestamptz
);
CREATE INDEX IF NOT EXISTS support_messages_tenant ON public.support_messages (tenant_id, created_at DESC);
ALTER TABLE public.support_messages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS support_messages_read ON public.support_messages;
CREATE POLICY support_messages_read ON public.support_messages FOR SELECT TO authenticated
    USING (public.is_platform_admin() OR public.has_permission(business_id, 'business.update'));
GRANT SELECT ON public.support_messages TO authenticated;

CREATE OR REPLACE FUNCTION public.send_support_message(p_business_id uuid, p_body text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_tenant uuid; v_id uuid; v_admin boolean := public.is_platform_admin();
BEGIN
    IF NOT (v_admin OR public.has_permission(p_business_id, 'business.update')) THEN RAISE EXCEPTION 'Not allowed'; END IF;
    SELECT tenant_id INTO v_tenant FROM public.businesses WHERE id = p_business_id;
    INSERT INTO public.support_messages (tenant_id, business_id, from_platform, sender_name, body)
    VALUES (v_tenant, p_business_id, v_admin AND NOT public.has_permission(p_business_id, 'business.update'),
            (SELECT COALESCE(u.raw_user_meta_data->>'name', u.email) FROM auth.users u WHERE u.id = auth.uid()), trim(p_body))
    RETURNING id INTO v_id;
    RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.send_support_message(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.send_support_message(uuid, text) TO authenticated;
