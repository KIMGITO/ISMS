-- 20261204002_ai_platform_usage.sql
-- The AI is run by the platform, not by each business (SaaS step 4, owner decision 2026-11-24).
--
--   * platform_ai_settings: one row. Provider, model and tuning for every business; the keys
--     stay as server secrets (HF_TOKEN_A..E, GEMINI_API_KEY, ...). Only the platform admin
--     changes it.
--   * A business keeps only its "Assistant instructions" (ai_settings.system_prompt) and the
--     on/off switch. Provider, model and key in ai_settings are used only when the plan says
--     the business brings its own AI key (Perpetual).
--   * ai_usage: AI requests per company per day (Nairobi). fn_ai_use() is called by every
--     edge function before it runs the AI: it refuses when the plan has no AI, when the plan
--     is read-only or suspended, or when today's cap is used up, and counts the request.
--   * get_ai_usage(): what the app shows (used today, the cap, own key or not).

-- ============================================================================================
-- 1. Platform AI settings
-- ============================================================================================
CREATE TABLE IF NOT EXISTS public.platform_ai_settings (
    id boolean PRIMARY KEY DEFAULT true CHECK (id),
    provider text NOT NULL DEFAULT 'huggingface',
    model text NOT NULL DEFAULT 'Qwen/Qwen2.5-72B-Instruct',
    temperature numeric(4,2) NOT NULL DEFAULT 0.7 CHECK (temperature >= 0 AND temperature <= 2),
    max_tokens integer NOT NULL DEFAULT 2048 CHECK (max_tokens BETWEEN 64 AND 32768),
    top_p numeric(4,2) NOT NULL DEFAULT 0.95 CHECK (top_p > 0 AND top_p <= 1),
    top_k integer NOT NULL DEFAULT 40 CHECK (top_k >= 0),
    enabled boolean NOT NULL DEFAULT true,
    updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.platform_ai_settings (id) VALUES (true) ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.platform_ai_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS pol_platform_ai_settings_select ON public.platform_ai_settings;
CREATE POLICY pol_platform_ai_settings_select ON public.platform_ai_settings
    FOR SELECT TO authenticated USING (public.is_platform_admin());
REVOKE ALL ON public.platform_ai_settings FROM anon, authenticated;
GRANT SELECT ON public.platform_ai_settings TO authenticated;
GRANT ALL ON public.platform_ai_settings TO service_role;

CREATE OR REPLACE FUNCTION public.platform_update_ai_settings(p_settings jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    r public.platform_ai_settings;
BEGIN
    PERFORM public.fn_require_platform_admin();
    UPDATE public.platform_ai_settings SET
        provider    = COALESCE(NULLIF(btrim(p_settings->>'provider'), ''), provider),
        model       = COALESCE(NULLIF(btrim(p_settings->>'model'), ''), model),
        temperature = COALESCE((p_settings->>'temperature')::numeric, temperature),
        max_tokens  = COALESCE((p_settings->>'max_tokens')::integer, max_tokens),
        top_p       = COALESCE((p_settings->>'top_p')::numeric, top_p),
        top_k       = COALESCE((p_settings->>'top_k')::integer, top_k),
        enabled     = COALESCE((p_settings->>'enabled')::boolean, enabled),
        updated_at  = now()
    WHERE id
    RETURNING * INTO r;
    PERFORM public.fn_platform_log(NULL, 'ai_settings', p_settings);
    RETURN to_jsonb(r);
END;
$$;
REVOKE ALL ON FUNCTION public.platform_update_ai_settings(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.platform_update_ai_settings(jsonb) TO authenticated, service_role;

-- ============================================================================================
-- 2. Daily use per company
-- ============================================================================================
CREATE TABLE IF NOT EXISTS public.ai_usage (
    tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    day date NOT NULL,
    calls integer NOT NULL DEFAULT 0 CHECK (calls >= 0),
    refused integer NOT NULL DEFAULT 0 CHECK (refused >= 0),
    PRIMARY KEY (tenant_id, day)
);
ALTER TABLE public.ai_usage ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS pol_ai_usage_select ON public.ai_usage;
CREATE POLICY pol_ai_usage_select ON public.ai_usage
    FOR SELECT TO authenticated USING (public.is_platform_admin());
REVOKE ALL ON public.ai_usage FROM anon, authenticated;
GRANT SELECT ON public.ai_usage TO authenticated;
GRANT ALL ON public.ai_usage TO service_role;

CREATE OR REPLACE FUNCTION public.fn_ai_today()
RETURNS date
LANGUAGE sql STABLE
SET search_path = ''
AS $$ SELECT (now() AT TIME ZONE 'Africa/Nairobi')::date $$;

-- Called by edge functions (service role) before each AI request.
-- Returns {allowed, reason, used, cap, own_key}. reason: not_in_plan | read_only | cap_reached.
-- cap 0 with own_key = no cap (the business pays its own provider).
CREATE OR REPLACE FUNCTION public.fn_ai_use(p_business_id uuid, p_count boolean DEFAULT true)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_tenant uuid;
    r jsonb;
    v_cap integer;
    v_own boolean;
    v_used integer;
BEGIN
    v_tenant := public.fn_business_tenant(p_business_id);
    r := public.fn_tenant_plan(v_tenant);
    IF r IS NULL THEN
        RETURN jsonb_build_object('allowed', false, 'reason', 'not_in_plan', 'used', 0, 'cap', 0, 'own_key', false);
    END IF;
    v_cap := COALESCE((r->>'ai_daily_cap')::integer, 0);
    v_own := COALESCE((r->>'own_ai_key')::boolean, false);
    SELECT calls INTO v_used FROM public.ai_usage WHERE tenant_id = v_tenant AND day = public.fn_ai_today();
    v_used := COALESCE(v_used, 0);

    IF NOT COALESCE(r->'modules' ? 'ai', false) THEN
        RETURN jsonb_build_object('allowed', false, 'reason', 'not_in_plan', 'used', v_used, 'cap', v_cap, 'own_key', v_own);
    END IF;
    IF NOT COALESCE((r->>'writable')::boolean, false) THEN
        RETURN jsonb_build_object('allowed', false, 'reason', 'read_only', 'used', v_used, 'cap', v_cap, 'own_key', v_own);
    END IF;
    IF NOT p_count THEN
        RETURN jsonb_build_object('allowed', v_own OR v_cap = 0 OR v_used < v_cap,
                                  'reason', CASE WHEN v_own OR v_cap = 0 OR v_used < v_cap THEN NULL ELSE 'cap_reached' END,
                                  'used', v_used, 'cap', v_cap, 'own_key', v_own);
    END IF;

    -- A cap of 0 on a platform-run plan means the plan has AI but no daily limit was set:
    -- treat it as no cap only for own-key plans; otherwise nothing is allowed.
    IF NOT v_own AND v_cap <= 0 THEN
        RETURN jsonb_build_object('allowed', false, 'reason', 'cap_reached', 'used', v_used, 'cap', 0, 'own_key', false);
    END IF;

    INSERT INTO public.ai_usage AS u (tenant_id, day, calls)
    VALUES (v_tenant, public.fn_ai_today(), 1)
    ON CONFLICT (tenant_id, day) DO UPDATE SET calls = u.calls + 1
        WHERE v_own OR u.calls < v_cap
    RETURNING calls INTO v_used;

    IF v_used IS NULL THEN
        UPDATE public.ai_usage SET refused = refused + 1
        WHERE tenant_id = v_tenant AND day = public.fn_ai_today()
        RETURNING calls INTO v_used;
        RETURN jsonb_build_object('allowed', false, 'reason', 'cap_reached', 'used', v_used, 'cap', v_cap, 'own_key', v_own);
    END IF;
    RETURN jsonb_build_object('allowed', true, 'reason', NULL, 'used', v_used, 'cap', v_cap, 'own_key', v_own);
END;
$$;
REVOKE ALL ON FUNCTION public.fn_ai_use(uuid, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_ai_use(uuid, boolean) TO service_role;

-- The plan facts the AI runner needs (service role): own key or platform AI.
CREATE OR REPLACE FUNCTION public.fn_ai_plan(p_business_id uuid)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT jsonb_build_object(
        'own_key', COALESCE((r->>'own_ai_key')::boolean, false),
        'has_ai', COALESCE(r->'modules' ? 'ai', false),
        'platform', (SELECT to_jsonb(s) FROM public.platform_ai_settings s WHERE s.id))
    FROM (SELECT public.fn_tenant_plan(public.fn_business_tenant(p_business_id)) AS r) x;
$$;
REVOKE ALL ON FUNCTION public.fn_ai_plan(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_ai_plan(uuid) TO service_role;

-- What the app shows under Settings -> Assistant.
CREATE OR REPLACE FUNCTION public.get_ai_usage(p_business_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_tenant uuid;
    r jsonb;
BEGIN
    PERFORM public.assert_business_member(p_business_id);
    v_tenant := public.fn_business_tenant(p_business_id);
    r := public.fn_tenant_plan(v_tenant);
    RETURN jsonb_build_object(
        'has_ai', COALESCE(r->'modules' ? 'ai', false),
        'own_key', COALESCE((r->>'own_ai_key')::boolean, false),
        'cap', COALESCE((r->>'ai_daily_cap')::integer, 0),
        'used', COALESCE((SELECT calls FROM public.ai_usage WHERE tenant_id = v_tenant AND day = public.fn_ai_today()), 0),
        'resets_at', ((public.fn_ai_today() + 1)::timestamp AT TIME ZONE 'Africa/Nairobi'));
END;
$$;
REVOKE ALL ON FUNCTION public.get_ai_usage(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_ai_usage(uuid) TO authenticated, service_role;
