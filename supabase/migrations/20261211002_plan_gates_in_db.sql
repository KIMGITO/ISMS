-- Admin console controls enforced by the database, not only hidden in the app (2026-11-26).
--   * Marketing (campaigns, adverts) belongs to the Online store module: marketing.* permissions
--     are refused when the plan lacks online_store, to the Owner too (has_permission reads
--     module_permissions).
--   * Stock report (module stock_report) had no permission tied to it, so a lower plan could
--     still call stock_period_report directly. The report now checks the module first.

INSERT INTO public.module_permissions (pattern, module) VALUES ('marketing.%', 'online_store')
ON CONFLICT (pattern) DO UPDATE SET module = EXCLUDED.module;

DO $$
BEGIN
    IF to_regprocedure('public.stock_period_report_core(uuid, timestamptz, timestamptz)') IS NULL THEN
        ALTER FUNCTION public.stock_period_report(uuid, timestamptz, timestamptz) RENAME TO stock_period_report_core;
    END IF;
END $$;
REVOKE ALL ON FUNCTION public.stock_period_report_core(uuid, timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.stock_period_report(p_business_id uuid, p_from timestamptz, p_to timestamptz)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF NOT public.has_module(p_business_id, 'stock_report') THEN
        RAISE EXCEPTION 'The stock report is not on your plan. Upgrade to use it.'
            USING ERRCODE = '42501', HINT = 'plan_module';
    END IF;
    RETURN public.stock_period_report_core(p_business_id, p_from, p_to);
END;
$$;
ALTER FUNCTION public.stock_period_report(uuid, timestamptz, timestamptz) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.stock_period_report(uuid, timestamptz, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.stock_period_report(uuid, timestamptz, timestamptz) TO authenticated, service_role;
