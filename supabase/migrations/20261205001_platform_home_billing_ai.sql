-- 20261205001_platform_home_ai_uses.sql
-- Owner decisions 2026-11-25:
--
--   1. The platform sets up the AI (provider, model, keys, tuning) for every company, own-key
--      plans included. A business only switches the AI on or off, per use: the in-app assistant,
--      Home and area insights, the website shop assistant, and drafting customer messages and
--      replies. ai_settings.uses holds the switches ({"website": false} = off; missing = on).
--      A trigger refuses any change to the set-up columns that doesn't come from the server
--      (edge functions) or a platform admin.
--   2. Billing: payments decide the paid-up date; nobody types it (section 3).
--   3. The console's Home page: platform_home_stats() (plans, add-ons, expected income, growth,
--      resource use) and platform_running_costs (what running the platform costs us each month,
--      for break-even). Counts and our own prices only: never a business's sales amounts.

-- ============================================================================================
-- 1. AI: per-use switches; set-up is the platform's
-- ============================================================================================
ALTER TABLE public.ai_settings ADD COLUMN IF NOT EXISTS uses jsonb NOT NULL DEFAULT '{}'::jsonb;
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ai_settings_uses_object') THEN
        ALTER TABLE public.ai_settings ADD CONSTRAINT ai_settings_uses_object CHECK (jsonb_typeof(uses) = 'object');
    END IF;
END $$;

CREATE OR REPLACE FUNCTION public.fn_ai_settings_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
    -- Edge functions (service role) and platform admins set the AI up; owners and admins of a
    -- business only change the switches and the instructions.
    IF current_user NOT IN ('authenticated', 'anon') OR public.is_platform_admin() THEN
        RETURN NEW;
    END IF;
    IF TG_OP = 'INSERT' THEN
        IF NEW.api_key IS DISTINCT FROM '' AND NEW.api_key IS NOT NULL THEN
            RAISE EXCEPTION 'The AI is set up by the platform.' USING ERRCODE = '42501';
        END IF;
        NEW.provider := 'huggingface';
        NEW.model := 'Qwen/Qwen2.5-72B-Instruct';
        RETURN NEW;
    END IF;
    IF NEW.provider IS DISTINCT FROM OLD.provider
       OR NEW.api_key IS DISTINCT FROM OLD.api_key
       OR NEW.model IS DISTINCT FROM OLD.model
       OR NEW.temperature IS DISTINCT FROM OLD.temperature
       OR NEW.max_tokens IS DISTINCT FROM OLD.max_tokens
       OR NEW.top_p IS DISTINCT FROM OLD.top_p
       OR NEW.top_k IS DISTINCT FROM OLD.top_k
       OR NEW.business_id IS DISTINCT FROM OLD.business_id THEN
        RAISE EXCEPTION 'The AI is set up by the platform.' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_ai_settings_guard ON public.ai_settings;
CREATE TRIGGER trg_ai_settings_guard BEFORE INSERT OR UPDATE ON public.ai_settings
    FOR EACH ROW EXECUTE FUNCTION public.fn_ai_settings_guard();

-- The platform admin sets the provider, model and key of a company on an own-key plan
-- (Perpetual), for every branch of it. p_api_key NULL or '' keeps the saved key.
CREATE OR REPLACE FUNCTION public.platform_set_company_ai(p_tenant_id uuid, p_provider text, p_model text, p_api_key text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_provider text := lower(btrim(COALESCE(p_provider, '')));
    v_model text := btrim(COALESCE(p_model, ''));
    v_key text := btrim(COALESCE(p_api_key, ''));
    v_n integer;
BEGIN
    PERFORM public.fn_require_platform_admin();
    IF NOT EXISTS (SELECT 1 FROM public.tenants WHERE id = p_tenant_id) THEN
        RAISE EXCEPTION 'Unknown company.';
    END IF;
    IF v_provider NOT IN ('huggingface', 'gemini', 'openai', 'anthropic', 'deepseek', 'groq', 'openrouter') THEN
        RAISE EXCEPTION 'Unknown AI provider.';
    END IF;
    IF v_model = '' OR v_model ~ '\s' THEN
        RAISE EXCEPTION 'Enter the model name, without spaces.';
    END IF;
    IF v_key ~ '\s' THEN
        RAISE EXCEPTION 'That key has spaces in it. Paste it again.';
    END IF;

    INSERT INTO public.ai_settings (business_id, provider, model, api_key)
    SELECT b.id, v_provider, v_model, v_key
    FROM public.businesses b
    WHERE b.tenant_id = p_tenant_id AND b.deleted_at IS NULL
    ON CONFLICT (business_id) DO UPDATE SET
        provider = EXCLUDED.provider,
        model = EXCLUDED.model,
        api_key = CASE WHEN v_key = '' AND public.ai_settings.provider = EXCLUDED.provider
                       THEN public.ai_settings.api_key ELSE v_key END,
        updated_at = now();
    GET DIAGNOSTICS v_n = ROW_COUNT;
    PERFORM public.fn_platform_log(p_tenant_id, 'company_ai', jsonb_build_object('provider', v_provider, 'model', v_model, 'new_key', v_key <> ''));
    RETURN jsonb_build_object('branches', v_n);
END;
$$;
REVOKE ALL ON FUNCTION public.platform_set_company_ai(uuid, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.platform_set_company_ai(uuid, text, text, text) TO authenticated, service_role;

-- What the console shows of a company's own AI set-up: never the key, only whether one is saved.
CREATE OR REPLACE FUNCTION public.platform_company_ai(p_tenant_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    PERFORM public.fn_require_platform_admin();
    RETURN (
        SELECT jsonb_build_object('provider', a.provider, 'model', a.model,
                                  'has_key', COALESCE(a.api_key, '') <> '',
                                  'key_end', CASE WHEN length(COALESCE(a.api_key, '')) > 8 THEN right(a.api_key, 4) END)
        FROM public.ai_settings a JOIN public.businesses b ON b.id = a.business_id
        WHERE b.tenant_id = p_tenant_id AND b.deleted_at IS NULL
        ORDER BY (COALESCE(a.api_key, '') <> '') DESC, a.updated_at DESC
        LIMIT 1);
END;
$$;
REVOKE ALL ON FUNCTION public.platform_company_ai(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.platform_company_ai(uuid) TO authenticated, service_role;

-- ============================================================================================
-- 2. What running the platform costs us (for break-even)
-- ============================================================================================
-- kind: fixed        = the same each month whatever the number of companies
--       per_company  = for each paying company each month (support, shared AI, hosting share)
--       share        = a percent of income (fee collection, bad debt)
-- per:  month | year (a yearly amount counts as 1/12 a month). Ignored for share.
CREATE TABLE IF NOT EXISTS public.platform_running_costs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    item text NOT NULL CHECK (length(btrim(item)) BETWEEN 1 AND 120),
    kind text NOT NULL DEFAULT 'fixed' CHECK (kind IN ('fixed', 'per_company', 'share')),
    per text NOT NULL DEFAULT 'month' CHECK (per IN ('month', 'year')),
    amount numeric(14,2) NOT NULL DEFAULT 0 CHECK (amount >= 0),
    note text CHECK (note IS NULL OR length(note) <= 500),
    active boolean NOT NULL DEFAULT true,
    sort integer NOT NULL DEFAULT 0,
    updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.platform_running_costs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS pol_platform_running_costs_select ON public.platform_running_costs;
CREATE POLICY pol_platform_running_costs_select ON public.platform_running_costs
    FOR SELECT TO authenticated USING ((SELECT public.is_platform_admin()));
REVOKE ALL ON public.platform_running_costs FROM anon, authenticated;
GRANT SELECT ON public.platform_running_costs TO authenticated;
GRANT ALL ON public.platform_running_costs TO service_role;

-- Starting figures: the estimates in ISMS-CLF Tables 11.2 and 11.3 (2026-11-24). The platform
-- admin replaces them with the real bills.
INSERT INTO public.platform_running_costs (item, kind, per, amount, note, sort)
SELECT * FROM (VALUES
    ('Supabase Pro', 'fixed', 'month', 3225.00, 'Estimate (USD 25). Replace with the real bill.', 10),
    ('Email sending service', 'fixed', 'month', 2580.00, 'Estimate. Replace with the real bill.', 20),
    ('Domain', 'fixed', 'year', 3000.00, 'Estimate. Replace with the renewal price.', 30),
    ('Windows code-signing certificate', 'fixed', 'year', 50000.00, 'Estimate; not bought yet.', 40),
    ('Tools, backup storage, monitoring', 'fixed', 'month', 1500.00, 'Estimate.', 50),
    ('Bookkeeping', 'fixed', 'month', 5000.00, 'Estimate.', 60),
    ('Legal set-up (spread)', 'fixed', 'month', 5000.00, 'Estimate.', 70),
    ('Maintenance and development time', 'fixed', 'month', 60000.00, 'Estimate: the owner''s own time.', 80),
    ('Hosting share', 'per_company', 'month', 100.00, 'Estimate per paying company.', 110),
    ('Shared AI', 'per_company', 'month', 100.00, 'Estimate per paying company.', 120),
    ('Support time', 'per_company', 'month', 1500.00, 'Estimate per paying company.', 130),
    ('Fee collection', 'share', 'month', 1.50, 'Percent of income.', 210),
    ('Bad debt', 'share', 'month', 5.00, 'Percent of income.', 220)
) v(item, kind, per, amount, note, sort)
WHERE NOT EXISTS (SELECT 1 FROM public.platform_running_costs);

CREATE OR REPLACE FUNCTION public.platform_save_running_cost(p_row jsonb)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_id uuid := NULLIF(p_row->>'id', '')::uuid;
BEGIN
    PERFORM public.fn_require_platform_admin();
    IF COALESCE((p_row->>'delete')::boolean, false) THEN
        DELETE FROM public.platform_running_costs WHERE id = v_id;
        PERFORM public.fn_platform_log(NULL, 'running_cost_deleted', jsonb_build_object('id', v_id));
        RETURN v_id;
    END IF;
    IF v_id IS NULL THEN
        INSERT INTO public.platform_running_costs (item, kind, per, amount, note, active, sort)
        VALUES (btrim(p_row->>'item'), COALESCE(p_row->>'kind', 'fixed'), COALESCE(p_row->>'per', 'month'),
                round(COALESCE((p_row->>'amount')::numeric, 0), 2), NULLIF(btrim(p_row->>'note'), ''),
                COALESCE((p_row->>'active')::boolean, true), COALESCE((p_row->>'sort')::integer, 0))
        RETURNING id INTO v_id;
    ELSE
        UPDATE public.platform_running_costs SET
            item = COALESCE(btrim(p_row->>'item'), item),
            kind = COALESCE(p_row->>'kind', kind),
            per = COALESCE(p_row->>'per', per),
            amount = COALESCE(round((p_row->>'amount')::numeric, 2), amount),
            note = CASE WHEN p_row ? 'note' THEN NULLIF(btrim(p_row->>'note'), '') ELSE note END,
            active = COALESCE((p_row->>'active')::boolean, active),
            sort = COALESCE((p_row->>'sort')::integer, sort),
            updated_at = now()
        WHERE id = v_id;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'Unknown cost.';
        END IF;
    END IF;
    PERFORM public.fn_platform_log(NULL, 'running_cost', p_row);
    RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.platform_save_running_cost(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.platform_save_running_cost(jsonb) TO authenticated, service_role;

-- ============================================================================================
-- 3. Billing: payments decide the paid-up date (owner decision 2026-11-25)
-- ============================================================================================
-- Nobody types a paid-up date. The platform admin records each payment (amount, method,
-- reference or who received the cash, date paid); the days it buys are the amount divided by
-- the company's daily rate, and the paid-up date is the end of the last payment's days.
--
-- The rate: the price agreed with the company (agreed_price), or the plan's list price plus its
-- add-ons. agreed_price is per month for monthly and yearly payers, and the whole price for a
-- one-time licence. A monthly payer's day costs 12/365 of a month; a yearly payer's 1/365 of a
-- year. "Free" (billing_cycle manual) has no end date and takes no payments.
-- Payments are never deleted: a wrong one is voided with a reason, and the dates are worked out
-- again from the rest.
ALTER TABLE public.tenant_subscriptions
    ADD COLUMN IF NOT EXISTS agreed_price numeric(14,2) CHECK (agreed_price IS NULL OR agreed_price >= 0),
    ADD COLUMN IF NOT EXISTS agreed_note text CHECK (agreed_note IS NULL OR length(agreed_note) <= 500),
    -- Paid-up date typed by hand before payments were recorded (kept, so no paid time is lost);
    -- recorded payments add their days after it.
    ADD COLUMN IF NOT EXISTS paid_before date;

-- Companies set up before this change: their typed date becomes paid_before. "By hand" with a
-- date was a paid plan, so it becomes monthly; "by hand" with no end date becomes Free.
UPDATE public.tenant_subscriptions
SET paid_before = (current_period_end AT TIME ZONE 'Africa/Nairobi')::date,
    billing_cycle = CASE WHEN billing_cycle = 'manual' THEN 'monthly' ELSE billing_cycle END
WHERE paid_before IS NULL AND current_period_end IS NOT NULL
  AND billing_cycle IN ('monthly', 'annual', 'manual');

CREATE TABLE IF NOT EXISTS public.platform_payments (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid REFERENCES public.tenants(id) ON DELETE RESTRICT,
    request_id uuid REFERENCES public.signup_requests(id) ON DELETE RESTRICT,
    paid_on date NOT NULL,
    amount numeric(14,2) NOT NULL CHECK (amount > 0),
    method text NOT NULL CHECK (method IN ('M-Pesa', 'Airtel Money', 'Cash', 'Bank', 'Card')),
    reference text CHECK (reference IS NULL OR length(reference) BETWEEN 3 AND 80),
    received_by text CHECK (received_by IS NULL OR length(received_by) BETWEEN 2 AND 80),
    plan_code text NOT NULL REFERENCES public.plans(code),
    billing_cycle text NOT NULL CHECK (billing_cycle IN ('monthly', 'annual', 'one_time')),
    -- The whole price of a one-time licence when it was recorded.
    full_price numeric(14,2),
    days integer CHECK (days IS NULL OR days >= 0),
    period_from date,
    period_to date,
    note text CHECK (note IS NULL OR length(note) <= 500),
    recorded_by uuid,
    created_at timestamptz NOT NULL DEFAULT now(),
    voided_at timestamptz,
    voided_by uuid,
    void_reason text,
    CHECK (tenant_id IS NOT NULL OR request_id IS NOT NULL),
    CHECK (method = 'Cash' OR reference IS NOT NULL),
    CHECK (method <> 'Cash' OR received_by IS NOT NULL),
    CHECK (voided_at IS NULL OR length(btrim(COALESCE(void_reason, ''))) >= 3)
);
CREATE INDEX IF NOT EXISTS idx_platform_payments_tenant ON public.platform_payments(tenant_id, paid_on);
CREATE INDEX IF NOT EXISTS idx_platform_payments_request ON public.platform_payments(request_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_platform_payments_reference
    ON public.platform_payments(method, upper(reference)) WHERE reference IS NOT NULL AND voided_at IS NULL;
ALTER TABLE public.platform_payments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS pol_platform_payments_select ON public.platform_payments;
CREATE POLICY pol_platform_payments_select ON public.platform_payments
    FOR SELECT TO authenticated USING ((SELECT public.is_platform_admin()));
REVOKE ALL ON public.platform_payments FROM anon, authenticated;
GRANT SELECT ON public.platform_payments TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.platform_payments TO service_role;

-- Payments are kept: only the void columns and the worked-out dates may change.
CREATE OR REPLACE FUNCTION public.fn_platform_payments_keep()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'Payments are kept. Void it instead.' USING ERRCODE = '42501';
    END IF;
    IF NEW.amount IS DISTINCT FROM OLD.amount OR NEW.paid_on IS DISTINCT FROM OLD.paid_on
       OR NEW.method IS DISTINCT FROM OLD.method OR NEW.reference IS DISTINCT FROM OLD.reference
       OR NEW.received_by IS DISTINCT FROM OLD.received_by OR NEW.created_at IS DISTINCT FROM OLD.created_at
       OR (OLD.voided_at IS NOT NULL AND NEW.voided_at IS DISTINCT FROM OLD.voided_at) THEN
        RAISE EXCEPTION 'A recorded payment can''t be changed. Void it and record it again.' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_platform_payments_keep ON public.platform_payments;
CREATE TRIGGER trg_platform_payments_keep BEFORE UPDATE OR DELETE ON public.platform_payments
    FOR EACH ROW EXECUTE FUNCTION public.fn_platform_payments_keep();

CREATE OR REPLACE FUNCTION public.fn_platform_today()
RETURNS date
LANGUAGE sql STABLE
SET search_path = ''
AS $$ SELECT (now() AT TIME ZONE 'Africa/Nairobi')::date $$;

-- The price of a plan for one company: per month, per year, the whole one-time price, and a day.
CREATE OR REPLACE FUNCTION public.fn_platform_rate(p_plan_code text, p_cycle text, p_addons text[], p_agreed numeric)
RETURNS jsonb
LANGUAGE plpgsql STABLE
SET search_path = ''
AS $$
DECLARE
    p public.plans;
    v_list_month numeric;
    v_list_year numeric;
    v_month numeric;
    v_year numeric;
BEGIN
    SELECT * INTO p FROM public.plans WHERE code = p_plan_code;
    IF NOT FOUND THEN
        RETURN NULL;
    END IF;
    v_list_month := p.monthly_price + COALESCE((SELECT sum(m.addon_monthly_price) FROM public.plan_modules m
                                                WHERE m.key = ANY (COALESCE(p_addons, '{}'))), 0);
    v_list_year := p.annual_price + COALESCE((SELECT sum(m.addon_annual_price) FROM public.plan_modules m
                                              WHERE m.key = ANY (COALESCE(p_addons, '{}'))), 0);
    IF p_cycle = 'one_time' THEN
        RETURN jsonb_build_object('cycle', 'one_time', 'list_price', p.one_time_price,
                                  'full_price', COALESCE(p_agreed, p.one_time_price), 'agreed', p_agreed IS NOT NULL);
    END IF;
    v_month := COALESCE(p_agreed, v_list_month);
    v_year := CASE WHEN p_agreed IS NOT NULL THEN p_agreed * 12 ELSE v_list_year END;
    RETURN jsonb_build_object(
        'cycle', p_cycle,
        'list_month', round(v_list_month, 2),
        'list_year', round(v_list_year, 2),
        'month', round(v_month, 2),
        'year', round(v_year, 2),
        'agreed', p_agreed IS NOT NULL,
        'day', CASE p_cycle WHEN 'annual' THEN v_year / 365 WHEN 'monthly' THEN v_month * 12 / 365 END);
END;
$$;
REVOKE ALL ON FUNCTION public.fn_platform_rate(text, text, text[], numeric) FROM PUBLIC, anon, authenticated;

-- Works the paid-up date out again from the payments still standing, in the order they were paid.
-- A company's days start when it was created (or the first payment, if later) and run on
-- without gaps; a payment made after the paid-up date has passed starts on the day it was paid.
CREATE OR REPLACE FUNCTION public.fn_platform_rechain(p_tenant_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    s public.tenant_subscriptions;
    t public.tenants;
    x record;
    v_next date;
    v_from date;
    v_paid numeric := 0;
    v_full numeric;
    v_any boolean := false;
BEGIN
    SELECT * INTO s FROM public.tenant_subscriptions WHERE tenant_id = p_tenant_id FOR UPDATE;
    SELECT * INTO t FROM public.tenants WHERE id = p_tenant_id;
    IF NOT FOUND OR s.billing_cycle IN ('trial', 'manual') THEN
        RETURN;
    END IF;

    IF s.billing_cycle = 'one_time' THEN
        v_full := (public.fn_platform_rate(s.plan_code, 'one_time', s.addons, s.agreed_price)->>'full_price')::numeric;
        SELECT COALESCE(sum(amount), 0) INTO v_paid FROM public.platform_payments
        WHERE tenant_id = p_tenant_id AND voided_at IS NULL AND billing_cycle = 'one_time';
        UPDATE public.tenant_subscriptions SET
            current_period_end = CASE WHEN v_full IS NOT NULL AND v_paid >= v_full THEN NULL
                                      ELSE COALESCE(current_period_end, now()) END,
            updated_at = now()
        WHERE tenant_id = p_tenant_id;
        RETURN;
    END IF;

    v_next := GREATEST((t.created_at AT TIME ZONE 'Africa/Nairobi')::date, COALESCE(s.paid_before, '-infinity'::date));
    FOR x IN SELECT * FROM public.platform_payments
             WHERE tenant_id = p_tenant_id AND voided_at IS NULL AND billing_cycle <> 'one_time'
             ORDER BY paid_on, created_at
    LOOP
        v_any := true;
        v_from := GREATEST(v_next, x.paid_on);
        UPDATE public.platform_payments
        SET period_from = v_from, period_to = v_from + GREATEST(x.days, 0) - 1
        WHERE id = x.id;
        v_next := v_from + GREATEST(x.days, 0);
    END LOOP;

    UPDATE public.tenant_subscriptions SET
        -- Paid up to the end of the last paid day, Nairobi time. No payment yet: owed from today.
        current_period_end = CASE WHEN v_any THEN (v_next::timestamp AT TIME ZONE 'Africa/Nairobi')
                                  WHEN s.paid_before IS NOT NULL THEN (s.paid_before::timestamp AT TIME ZONE 'Africa/Nairobi')
                                  ELSE LEAST(COALESCE(current_period_end, now()), now()) END,
        updated_at = now()
    WHERE tenant_id = p_tenant_id;
END;
$$;
REVOKE ALL ON FUNCTION public.fn_platform_rechain(uuid) FROM PUBLIC, anon, authenticated;

-- What a payment would buy, before it is recorded.
CREATE OR REPLACE FUNCTION public.platform_payment_preview(p_tenant_id uuid, p_amount numeric, p_paid_on date DEFAULT NULL, p_request_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    s public.tenant_subscriptions;
    q public.signup_requests;
    v_plan text;
    v_cycle text;
    v_rate jsonb;
    v_days integer;
    v_start date;
    v_paid_on date := COALESCE(p_paid_on, public.fn_platform_today());
    v_paid numeric;
BEGIN
    PERFORM public.fn_require_platform_admin();
    IF p_tenant_id IS NOT NULL THEN
        SELECT * INTO s FROM public.tenant_subscriptions WHERE tenant_id = p_tenant_id;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'Unknown company.';
        END IF;
        v_plan := s.plan_code; v_cycle := s.billing_cycle;
        v_rate := public.fn_platform_rate(s.plan_code, s.billing_cycle, s.addons, s.agreed_price);
    ELSE
        SELECT * INTO q FROM public.signup_requests WHERE id = p_request_id;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'Unknown request.';
        END IF;
        v_plan := q.plan_code; v_cycle := q.billing_cycle;
        v_rate := public.fn_platform_rate(q.plan_code, q.billing_cycle, q.addons, NULL);
    END IF;
    IF v_cycle IN ('trial', 'manual') THEN
        RAISE EXCEPTION 'This company has no paid plan. Choose its plan and how it pays first.';
    END IF;

    IF v_cycle = 'one_time' THEN
        SELECT COALESCE(sum(amount), 0) INTO v_paid FROM public.platform_payments
        WHERE ((p_tenant_id IS NOT NULL AND tenant_id = p_tenant_id) OR (p_request_id IS NOT NULL AND request_id = p_request_id))
          AND voided_at IS NULL;
        RETURN jsonb_build_object('plan', v_plan, 'cycle', v_cycle, 'rate', v_rate,
            'paid_before', v_paid, 'still_owed', GREATEST((v_rate->>'full_price')::numeric - v_paid - COALESCE(p_amount, 0), 0));
    END IF;
    IF (v_rate->>'day')::numeric IS NULL OR (v_rate->>'day')::numeric <= 0 THEN
        RAISE EXCEPTION 'This plan has no price for that way of paying. Set an agreed price.';
    END IF;

    -- From the whole amounts, so a full month or year is never a day short through rounding.
    v_days := floor(COALESCE(p_amount, 0) * 365
                    / CASE v_cycle WHEN 'annual' THEN (v_rate->>'year')::numeric ELSE (v_rate->>'month')::numeric * 12 END);
    v_start := GREATEST(v_paid_on,
                        CASE WHEN s.current_period_end IS NOT NULL
                             THEN (s.current_period_end AT TIME ZONE 'Africa/Nairobi')::date END,
                        CASE WHEN p_tenant_id IS NULL THEN public.fn_platform_today() END);
    RETURN jsonb_build_object(
        'plan', v_plan, 'cycle', v_cycle, 'rate', v_rate,
        'days', v_days,
        'from', v_start,
        'to', v_start + v_days - 1,
        'whole_months', CASE WHEN v_cycle = 'monthly' THEN floor(COALESCE(p_amount, 0) / NULLIF((v_rate->>'month')::numeric, 0)) END,
        'whole_years', CASE WHEN v_cycle = 'annual' THEN floor(COALESCE(p_amount, 0) / NULLIF((v_rate->>'year')::numeric, 0)) END,
        'paid_up_now', s.current_period_end);
END;
$$;
REVOKE ALL ON FUNCTION public.platform_payment_preview(uuid, numeric, date, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.platform_payment_preview(uuid, numeric, date, uuid) TO authenticated, service_role;

-- Record a payment from a company (tenant_id) or for a waiting request (request_id).
CREATE OR REPLACE FUNCTION public.platform_record_payment(p_row jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_tenant uuid := NULLIF(p_row->>'tenant_id', '')::uuid;
    v_request uuid := NULLIF(p_row->>'request_id', '')::uuid;
    v_amount numeric := round((p_row->>'amount')::numeric, 2);
    v_paid_on date := COALESCE((p_row->>'paid_on')::date, public.fn_platform_today());
    v_method text := p_row->>'method';
    v_ref text := NULLIF(btrim(p_row->>'reference'), '');
    v_by text := NULLIF(btrim(p_row->>'received_by'), '');
    v_prev jsonb;
    v_id uuid;
    q public.signup_requests;
BEGIN
    PERFORM public.fn_require_platform_admin();
    IF v_amount IS NULL OR v_amount <= 0 THEN
        RAISE EXCEPTION 'Enter the amount paid.';
    END IF;
    IF v_paid_on > public.fn_platform_today() THEN
        RAISE EXCEPTION 'The payment date can''t be in the future.';
    END IF;
    IF v_paid_on < public.fn_platform_today() - 90 THEN
        RAISE EXCEPTION 'That date is more than 90 days ago.';
    END IF;
    IF v_method IS NULL OR v_method NOT IN ('M-Pesa', 'Airtel Money', 'Cash', 'Bank', 'Card') THEN
        RAISE EXCEPTION 'Choose how they paid.';
    END IF;
    IF v_method <> 'Cash' AND v_ref IS NULL THEN
        RAISE EXCEPTION 'Enter the payment code or bank reference.';
    END IF;
    IF v_method = 'Cash' AND v_by IS NULL THEN
        RAISE EXCEPTION 'Enter who received the cash.';
    END IF;
    IF v_ref IS NOT NULL AND EXISTS (SELECT 1 FROM public.platform_payments WHERE method = v_method
                                     AND upper(reference) = upper(v_ref) AND voided_at IS NULL) THEN
        RAISE EXCEPTION 'That payment code is already recorded.';
    END IF;
    IF v_tenant IS NULL AND v_request IS NOT NULL THEN
        SELECT * INTO q FROM public.signup_requests WHERE id = v_request;
        IF NOT FOUND OR q.status <> 'pending' THEN
            RAISE EXCEPTION 'That request is not waiting for a decision.';
        END IF;
        v_tenant := q.tenant_id;  -- a plan change belongs to an existing company
    END IF;
    IF v_tenant IS NOT NULL AND v_request IS NULL
       AND (SELECT billing_cycle FROM public.tenant_subscriptions WHERE tenant_id = v_tenant) IN ('trial', 'manual') THEN
        RAISE EXCEPTION 'This company has no paid plan. Choose its plan and how it pays first.';
    END IF;

    -- A request's payment is priced on the requested plan; a company's on its current one.
    IF v_request IS NOT NULL THEN
        v_prev := public.platform_payment_preview(NULL, v_amount, v_paid_on, v_request);
    ELSE
        v_prev := public.platform_payment_preview(v_tenant, v_amount, v_paid_on, NULL);
    END IF;
    IF v_prev->>'cycle' <> 'one_time' AND (v_prev->>'days')::integer < 1 THEN
        RAISE EXCEPTION 'That amount buys less than a day.';
    END IF;

    INSERT INTO public.platform_payments (tenant_id, request_id, paid_on, amount, method, reference, received_by,
                                          plan_code, billing_cycle, full_price, days, note, recorded_by)
    VALUES (CASE WHEN v_request IS NULL THEN v_tenant END, v_request, v_paid_on, v_amount, v_method, v_ref, v_by,
            v_prev->>'plan', v_prev->>'cycle', (v_prev->'rate'->>'full_price')::numeric,
            (v_prev->>'days')::integer, NULLIF(btrim(p_row->>'note'), ''), auth.uid())
    RETURNING id INTO v_id;

    IF v_request IS NULL THEN
        PERFORM public.fn_platform_rechain(v_tenant);
    END IF;
    PERFORM public.fn_platform_log(v_tenant, 'payment_recorded',
        jsonb_build_object('payment', v_id, 'amount', v_amount, 'method', v_method, 'reference', v_ref,
                           'days', v_prev->'days', 'request', v_request));
    RETURN jsonb_build_object('id', v_id, 'preview', v_prev,
                              'paid_up_to', (SELECT current_period_end FROM public.tenant_subscriptions WHERE tenant_id = v_tenant));
END;
$$;
REVOKE ALL ON FUNCTION public.platform_record_payment(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.platform_record_payment(jsonb) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.platform_void_payment(p_payment_id uuid, p_reason text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    x public.platform_payments;
BEGIN
    PERFORM public.fn_require_platform_admin();
    IF length(btrim(COALESCE(p_reason, ''))) < 3 THEN
        RAISE EXCEPTION 'Say why it is voided.';
    END IF;
    SELECT * INTO x FROM public.platform_payments WHERE id = p_payment_id FOR UPDATE;
    IF NOT FOUND OR x.voided_at IS NOT NULL THEN
        RAISE EXCEPTION 'That payment is not standing.';
    END IF;
    UPDATE public.platform_payments SET voided_at = now(), voided_by = auth.uid(), void_reason = btrim(p_reason)
    WHERE id = p_payment_id;
    IF x.tenant_id IS NOT NULL THEN
        PERFORM public.fn_platform_rechain(x.tenant_id);
    END IF;
    PERFORM public.fn_platform_log(x.tenant_id, 'payment_voided',
        jsonb_build_object('payment', p_payment_id, 'amount', x.amount, 'reason', btrim(p_reason)));
    RETURN jsonb_build_object('paid_up_to', (SELECT current_period_end FROM public.tenant_subscriptions WHERE tenant_id = x.tenant_id));
END;
$$;
REVOKE ALL ON FUNCTION public.platform_void_payment(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.platform_void_payment(uuid, text) TO authenticated, service_role;

-- Change a company's plan, how it pays and the agreed price. The paid-up date is never set here:
-- it comes from payments. Days already paid keep their dates.
CREATE OR REPLACE FUNCTION public.platform_change_plan(p_tenant_id uuid, p_plan_code text, p_cycle text,
                                                        p_agreed_price numeric DEFAULT NULL, p_agreed_note text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    p public.plans;
    s public.tenant_subscriptions;
    st public.platform_settings;
    v_cycle text;
    v_rate jsonb;
    r jsonb;
    v_warn text[] := '{}';
    v_branches integer;
BEGIN
    PERFORM public.fn_require_platform_admin();
    SELECT * INTO p FROM public.plans WHERE code = p_plan_code;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Unknown plan.';
    END IF;
    SELECT * INTO s FROM public.tenant_subscriptions WHERE tenant_id = p_tenant_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Unknown company.';
    END IF;
    SELECT * INTO st FROM public.platform_settings WHERE id;
    IF p_agreed_price IS NOT NULL AND p_agreed_price < 0 THEN
        RAISE EXCEPTION 'The agreed price can''t be below zero.';
    END IF;

    v_cycle := CASE WHEN p.kind = 'trial' THEN 'trial'
                    WHEN p.kind = 'perpetual' THEN 'one_time'
                    ELSE p_cycle END;
    IF v_cycle NOT IN ('trial', 'monthly', 'annual', 'one_time', 'manual') THEN
        RAISE EXCEPTION 'Choose monthly, yearly, once or free.';
    END IF;
    IF p.kind = 'subscription' AND v_cycle = 'one_time' THEN
        RAISE EXCEPTION 'This plan is paid monthly or yearly.';
    END IF;
    IF v_cycle IN ('monthly', 'annual', 'one_time') THEN
        v_rate := public.fn_platform_rate(p.code, v_cycle,
                                          CASE WHEN p.addons_allowed THEN s.addons ELSE '{}' END, round(p_agreed_price, 2));
        IF (v_cycle = 'one_time' AND (v_rate->>'full_price') IS NULL)
           OR (v_cycle <> 'one_time' AND COALESCE((v_rate->>'day')::numeric, 0) <= 0) THEN
            RAISE EXCEPTION 'This plan has no list price for that. Enter the agreed price.';
        END IF;
    END IF;

    UPDATE public.tenant_subscriptions SET
        plan_code = p.code,
        status = CASE WHEN v_cycle = 'trial' THEN 'trial' WHEN status = 'suspended' THEN 'suspended' ELSE 'active' END,
        billing_cycle = v_cycle,
        trial_ends_at = CASE WHEN v_cycle = 'trial'
                             THEN GREATEST(COALESCE(trial_ends_at, now()), now() + make_interval(days => st.trial_days))
                             ELSE trial_ends_at END,
        -- Free: no end. Coming off a trial or Free: owed from now until a payment is recorded.
        current_period_end = CASE WHEN v_cycle IN ('trial', 'manual') THEN NULL
                                  WHEN s.billing_cycle IN ('trial', 'manual') THEN now()
                                  ELSE current_period_end END,
        agreed_price = CASE WHEN v_cycle IN ('trial', 'manual') THEN NULL ELSE round(p_agreed_price, 2) END,
        paid_before = CASE WHEN v_cycle IN ('trial', 'manual') THEN NULL ELSE paid_before END,
        agreed_note = CASE WHEN v_cycle IN ('trial', 'manual') THEN NULL ELSE NULLIF(btrim(p_agreed_note), '') END,
        addons = CASE WHEN p.addons_allowed THEN addons ELSE '{}' END,
        updated_at = now(), updated_by = auth.uid()
    WHERE tenant_id = p_tenant_id;
    IF v_cycle IN ('monthly', 'annual', 'one_time')
       AND EXISTS (SELECT 1 FROM public.platform_payments WHERE tenant_id = p_tenant_id AND voided_at IS NULL) THEN
        PERFORM public.fn_platform_rechain(p_tenant_id);
    END IF;
    PERFORM public.fn_platform_log(p_tenant_id, 'plan_set',
        jsonb_build_object('plan', p.code, 'cycle', v_cycle, 'agreed_price', p_agreed_price, 'note', p_agreed_note));

    r := public.fn_tenant_plan(p_tenant_id);
    SELECT count(*) INTO v_branches FROM public.businesses WHERE tenant_id = p_tenant_id AND deleted_at IS NULL;
    IF v_branches > (r->>'max_branches')::integer THEN
        v_warn := v_warn || format('%s branches open; the plan allows %s.', v_branches, r->>'max_branches');
    END IF;
    IF public.fn_tenant_staff_used(p_tenant_id) > (r->>'max_staff')::integer THEN
        v_warn := v_warn || format('%s staff; the plan allows %s.', public.fn_tenant_staff_used(p_tenant_id), r->>'max_staff');
    END IF;
    RETURN r || jsonb_build_object('warnings', to_jsonb(v_warn));
END;
$$;
REVOKE ALL ON FUNCTION public.platform_change_plan(uuid, text, text, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.platform_change_plan(uuid, text, text, numeric, text) TO authenticated, service_role;

-- Suspend or let a company back in. Letting it back in never adds paid days.
CREATE OR REPLACE FUNCTION public.platform_set_suspended(p_tenant_id uuid, p_suspended boolean, p_reason text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    PERFORM public.fn_require_platform_admin();
    IF p_suspended AND length(btrim(COALESCE(p_reason, ''))) < 3 THEN
        RAISE EXCEPTION 'Say why the company is suspended.';
    END IF;
    UPDATE public.tenant_subscriptions SET
        status = CASE WHEN p_suspended THEN 'suspended'
                      WHEN billing_cycle = 'trial' THEN 'trial' ELSE 'active' END,
        updated_at = now(), updated_by = auth.uid()
    WHERE tenant_id = p_tenant_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Unknown company.';
    END IF;
    PERFORM public.fn_platform_log(p_tenant_id, CASE WHEN p_suspended THEN 'suspended' ELSE 'unsuspended' END,
                                   jsonb_build_object('reason', NULLIF(btrim(p_reason), '')));
    RETURN public.fn_tenant_plan(p_tenant_id);
END;
$$;
REVOKE ALL ON FUNCTION public.platform_set_suspended(uuid, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.platform_set_suspended(uuid, boolean, text) TO authenticated, service_role;

-- The old setter took a typed paid-up date. Only the platform admin could call it; now nobody can.
REVOKE EXECUTE ON FUNCTION public.platform_set_plan(uuid, text, text, text, timestamptz, text) FROM authenticated;

-- Approving a paid request needs its payment recorded first; the paid days come from it.
CREATE OR REPLACE FUNCTION public.platform_decide_signup(p_request_id uuid, p_approve boolean, p_note text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_req public.signup_requests;
    v_kind text;
BEGIN
    PERFORM public.fn_require_platform_admin();
    SELECT * INTO v_req FROM public.signup_requests WHERE id = p_request_id AND status = 'pending' FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'That request is not waiting for a decision.';
    END IF;
    SELECT kind INTO v_kind FROM public.plans WHERE code = v_req.plan_code;
    IF p_approve AND v_kind <> 'trial'
       AND NOT EXISTS (SELECT 1 FROM public.platform_payments WHERE request_id = p_request_id AND voided_at IS NULL) THEN
        RAISE EXCEPTION 'Record their payment first. The paid days come from it.' USING HINT = 'payment_required';
    END IF;
    UPDATE public.signup_requests
    SET status = CASE WHEN NOT p_approve THEN 'rejected' WHEN kind = 'change' THEN 'used' ELSE 'approved' END,
        decided_by = auth.uid(), decided_at = now(), decision_note = p_note, updated_at = now()
    WHERE id = p_request_id;
    IF NOT p_approve THEN
        -- Money taken for a turned-down request stays on record, voided, so it can be refunded.
        UPDATE public.platform_payments SET voided_at = now(), voided_by = auth.uid(),
               void_reason = 'Request turned down' || COALESCE(': ' || NULLIF(btrim(p_note), ''), '')
        WHERE request_id = p_request_id AND voided_at IS NULL;
    END IF;
    IF p_approve AND v_req.kind = 'change' THEN
        PERFORM public.platform_change_plan(v_req.tenant_id, v_req.plan_code, v_req.billing_cycle, NULL, NULL);
        PERFORM public.platform_set_addons(v_req.tenant_id, v_req.addons)
        WHERE (SELECT addons_allowed FROM public.plans WHERE code = v_req.plan_code);
        UPDATE public.platform_payments SET tenant_id = v_req.tenant_id
        WHERE request_id = p_request_id AND voided_at IS NULL;
        PERFORM public.fn_platform_rechain(v_req.tenant_id);
    END IF;
    PERFORM public.fn_platform_log(v_req.tenant_id, CASE WHEN p_approve THEN 'signup_approved' ELSE 'signup_rejected' END,
        jsonb_build_object('request', p_request_id, 'kind', v_req.kind, 'note', p_note));
END;
$$;

-- A new company made from an approved request: its request's payments become its own, and the
-- paid-up date comes from them (not a free month or year).
CREATE OR REPLACE FUNCTION public.fn_signup_request_used()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF NEW.status = 'used' AND NEW.tenant_id IS NOT NULL AND OLD.status IS DISTINCT FROM 'used' THEN
        UPDATE public.platform_payments SET tenant_id = NEW.tenant_id
        WHERE request_id = NEW.id AND tenant_id IS NULL AND voided_at IS NULL;
        IF FOUND THEN
            PERFORM public.fn_platform_rechain(NEW.tenant_id);
        END IF;
    END IF;
    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_signup_request_used ON public.signup_requests;
CREATE TRIGGER trg_signup_request_used AFTER UPDATE OF status, tenant_id ON public.signup_requests
    FOR EACH ROW EXECUTE FUNCTION public.fn_signup_request_used();

-- The money screen: payments (newest first) and who owes.
CREATE OR REPLACE FUNCTION public.platform_billing()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_month date := date_trunc('month', public.fn_platform_today())::date;
BEGIN
    PERFORM public.fn_require_platform_admin();
    RETURN jsonb_build_object(
        'received_this_month', (SELECT COALESCE(sum(amount), 0) FROM public.platform_payments
                                WHERE voided_at IS NULL AND paid_on >= v_month),
        'received_last_month', (SELECT COALESCE(sum(amount), 0) FROM public.platform_payments
                                WHERE voided_at IS NULL AND paid_on >= (v_month - interval '1 month')::date AND paid_on < v_month),
        'payments', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                'id', x.id, 'tenant_id', x.tenant_id, 'request_id', x.request_id,
                'company', COALESCE(t.name, q.business_name), 'paid_on', x.paid_on, 'amount', x.amount,
                'method', x.method, 'reference', x.reference, 'received_by', x.received_by,
                'plan', x.plan_code, 'cycle', x.billing_cycle, 'days', x.days,
                'period_from', x.period_from, 'period_to', x.period_to, 'note', x.note,
                'voided_at', x.voided_at, 'void_reason', x.void_reason, 'created_at', x.created_at)
                ORDER BY x.paid_on DESC, x.created_at DESC)
            FROM (SELECT * FROM public.platform_payments ORDER BY paid_on DESC, created_at DESC LIMIT 300) x
            LEFT JOIN public.tenants t ON t.id = x.tenant_id
            LEFT JOIN public.signup_requests q ON q.id = x.request_id), '[]'::jsonb),
        'companies', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                'tenant_id', t.id, 'name', t.name, 'plan', s.plan_code, 'cycle', s.billing_cycle,
                'status', pl->>'status', 'paid_up_to', s.current_period_end,
                'agreed_price', s.agreed_price, 'rate', public.fn_platform_rate(s.plan_code, s.billing_cycle, s.addons, s.agreed_price),
                'paid_total', (SELECT COALESCE(sum(amount), 0) FROM public.platform_payments p
                               WHERE p.tenant_id = t.id AND p.voided_at IS NULL),
                'last_paid_on', (SELECT max(paid_on) FROM public.platform_payments p WHERE p.tenant_id = t.id AND p.voided_at IS NULL))
                ORDER BY s.current_period_end NULLS LAST)
            FROM public.tenants t JOIN public.tenant_subscriptions s ON s.tenant_id = t.id
            CROSS JOIN LATERAL (SELECT public.fn_tenant_plan(t.id) AS pl) z
            WHERE s.billing_cycle IN ('monthly', 'annual', 'one_time')), '[]'::jsonb));
END;
$$;
REVOKE ALL ON FUNCTION public.platform_billing() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.platform_billing() TO authenticated, service_role;

-- ============================================================================================
-- 4. The console's Home page
-- ============================================================================================
-- "Expected each month" is what today's paying companies owe us a month at today's prices:
-- the agreed price, or else monthly plans at the monthly price and annual plans at a twelfth of
-- the annual price, plus their add-ons the same way. Trials, Free and one-time licences add
-- nothing. "Received" is the payments recorded (section 3).
-- Growth is by month of sign-up; the platform keeps no history of past prices.
CREATE OR REPLACE FUNCTION public.platform_home_stats(p_months integer DEFAULT 12)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_months integer := LEAST(GREATEST(COALESCE(p_months, 12), 3), 36);
    v_from date := (date_trunc('month', now() AT TIME ZONE 'Africa/Nairobi') - make_interval(months => v_months - 1))::date;
    v_files bigint := 0;
    r jsonb;
BEGIN
    PERFORM public.fn_require_platform_admin();

    BEGIN
        EXECUTE $q$SELECT COALESCE(sum((metadata->>'size')::bigint), 0) FROM storage.objects$q$ INTO v_files;
    EXCEPTION WHEN OTHERS THEN
        v_files := NULL;
    END;

    WITH t AS (
        SELECT tn.id, tn.name, tn.created_at, s.started_at, s.billing_cycle, s.agreed_price, public.fn_tenant_plan(tn.id) AS pl
        FROM public.tenants tn JOIN public.tenant_subscriptions s ON s.tenant_id = tn.id
    ), tp AS (
        SELECT t.*, p.code, p.name AS plan_name, p.kind, p.monthly_price, p.annual_price, p.one_time_price,
               t.pl->>'status' AS status,
               (t.pl->>'status') IN ('active', 'grace') AND p.kind = 'subscription'
                   AND t.billing_cycle IN ('monthly', 'annual') AS paying,
               -- What they pay a month: the agreed price, or the list price.
               CASE WHEN (t.pl->>'status') IN ('active', 'grace') AND p.kind = 'subscription' THEN
                   CASE t.billing_cycle
                       WHEN 'annual' THEN COALESCE(t.agreed_price, COALESCE(p.annual_price, 0) / 12)
                       WHEN 'monthly' THEN COALESCE(t.agreed_price, COALESCE(p.monthly_price, 0))
                       ELSE 0 END
               ELSE 0 END AS plan_month,
               -- The list price a month, to show what agreed prices give away.
               CASE WHEN (t.pl->>'status') IN ('active', 'grace') AND p.kind = 'subscription' THEN
                   CASE t.billing_cycle
                       WHEN 'annual' THEN COALESCE(p.annual_price, 0) / 12
                       WHEN 'monthly' THEN COALESCE(p.monthly_price, 0)
                       ELSE 0 END
               ELSE 0 END AS list_month,
               ARRAY(SELECT jsonb_array_elements_text(t.pl->'addons')) AS addons,
               (SELECT count(*) FROM public.businesses b WHERE b.tenant_id = t.id AND b.deleted_at IS NULL) AS branches,
               (SELECT count(DISTINCT bm.user_id) FROM public.business_memberships bm
                  JOIN public.businesses b ON b.id = bm.business_id
                 WHERE b.tenant_id = t.id AND b.deleted_at IS NULL AND bm.status = 'Active') AS staff,
               COALESCE((t.pl->>'max_branches')::integer, 0) AS max_branches,
               COALESCE((t.pl->>'max_staff')::integer, 0) AS max_staff,
               COALESCE((t.pl->>'storage_mb')::integer, 0) AS storage_mb,
               COALESCE((t.pl->>'ai_daily_cap')::integer, 0) AS ai_cap,
               COALESCE((SELECT calls FROM public.ai_usage u WHERE u.tenant_id = t.id AND u.day = public.fn_ai_today()), 0) AS ai_today,
               COALESCE((SELECT sum(calls) FROM public.ai_usage u WHERE u.tenant_id = t.id AND u.day > public.fn_ai_today() - 30), 0) AS ai_30
        FROM t JOIN public.plans p ON p.code = t.pl->>'plan'
    ), ad AS (
        SELECT m.key, m.name, count(*) AS companies,
               sum(CASE WHEN tp.paying AND tp.agreed_price IS NULL THEN
                       CASE tp.billing_cycle WHEN 'annual' THEN COALESCE(m.addon_annual_price, 0) / 12
                                             ELSE COALESCE(m.addon_monthly_price, 0) END
                   ELSE 0 END) AS month_value
        FROM tp CROSS JOIN LATERAL unnest(tp.addons) a(key)
        JOIN public.plan_modules m ON m.key = a.key
        GROUP BY m.key, m.name, m.sort ORDER BY m.sort
    ), addon_by_tenant AS (
        SELECT tp.id,
               sum(CASE WHEN tp.paying AND tp.agreed_price IS NULL THEN
                       CASE tp.billing_cycle WHEN 'annual' THEN COALESCE(m.addon_annual_price, 0) / 12
                                             ELSE COALESCE(m.addon_monthly_price, 0) END
                   ELSE 0 END) AS v
        FROM tp CROSS JOIN LATERAL unnest(tp.addons) a(key)
        JOIN public.plan_modules m ON m.key = a.key
        GROUP BY tp.id
    ), months AS (
        SELECT generate_series(v_from, (date_trunc('month', now() AT TIME ZONE 'Africa/Nairobi'))::date, interval '1 month')::date AS m
    )
    SELECT jsonb_build_object(
        'as_of', now(),
        'companies', (SELECT count(*) FROM tp),
        'paying', (SELECT count(*) FROM tp WHERE paying),
        'by_status', (SELECT COALESCE(jsonb_object_agg(status, n), '{}'::jsonb) FROM (SELECT status, count(*) n FROM tp GROUP BY status) x),
        'expected_month', round((SELECT COALESCE(sum(plan_month), 0) FROM tp) + (SELECT COALESCE(sum(v), 0) FROM addon_by_tenant), 2),
        'agreed_companies', (SELECT count(*) FROM tp WHERE paying AND agreed_price IS NOT NULL),
        'given_off_month', round((SELECT COALESCE(sum(GREATEST(list_month - plan_month, 0)), 0) FROM tp WHERE paying AND agreed_price IS NOT NULL), 2),
        'free_companies', (SELECT count(*) FROM tp WHERE billing_cycle = 'manual'),
        'received_this_month', (SELECT COALESCE(sum(amount), 0) FROM public.platform_payments
                                WHERE voided_at IS NULL AND paid_on >= date_trunc('month', public.fn_platform_today())::date),
        'owing', (SELECT count(*) FROM tp WHERE status IN ('grace', 'read_only') AND billing_cycle IN ('monthly', 'annual', 'one_time')),
        'plans', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                'code', p.code, 'name', p.name, 'kind', p.kind,
                'companies', (SELECT count(*) FROM tp WHERE tp.code = p.code),
                'paying', (SELECT count(*) FROM tp WHERE tp.code = p.code AND tp.paying),
                'month_value', round((SELECT COALESCE(sum(plan_month), 0) FROM tp WHERE tp.code = p.code), 2)) ORDER BY p.sort)
            FROM public.plans p), '[]'::jsonb),
        'addons', COALESCE((SELECT jsonb_agg(jsonb_build_object('key', key, 'name', name, 'companies', companies,
                                                                  'month_value', round(month_value, 2))) FROM ad), '[]'::jsonb),
        'one_time', COALESCE((SELECT jsonb_agg(jsonb_build_object('plan', plan_name, 'companies', n, 'price', price))
                              FROM (SELECT plan_name, count(*) n, max(one_time_price) price FROM tp
                                    WHERE kind = 'perpetual' AND status IN ('active', 'grace') GROUP BY plan_name) x), '[]'::jsonb),
        'growth', (
            SELECT jsonb_agg(jsonb_build_object(
                'month', to_char(mo.m, 'YYYY-MM'),
                'new_companies', (SELECT count(*) FROM tp WHERE (tp.created_at AT TIME ZONE 'Africa/Nairobi')::date >= mo.m
                                                           AND (tp.created_at AT TIME ZONE 'Africa/Nairobi')::date < (mo.m + interval '1 month')::date),
                'companies', (SELECT count(*) FROM tp WHERE (tp.created_at AT TIME ZONE 'Africa/Nairobi')::date < (mo.m + interval '1 month')::date),
                'branches', (SELECT count(*) FROM public.businesses b WHERE b.deleted_at IS NULL
                               AND (b.created_at AT TIME ZONE 'Africa/Nairobi')::date < (mo.m + interval '1 month')::date),
                'expected_month', round(COALESCE((SELECT sum(tp.plan_month + COALESCE(abt.v, 0)) FROM tp LEFT JOIN addon_by_tenant abt ON abt.id = tp.id
                                                  WHERE tp.paying AND (tp.started_at AT TIME ZONE 'Africa/Nairobi')::date < (mo.m + interval '1 month')::date), 0), 2),
                'received', (SELECT COALESCE(sum(amount), 0) FROM public.platform_payments pp WHERE pp.voided_at IS NULL
                               AND pp.paid_on >= mo.m AND pp.paid_on < (mo.m + interval '1 month')::date),
                'sales', (SELECT count(*) FROM public.transactions tx WHERE tx.timestamp >= (mo.m::timestamp AT TIME ZONE 'Africa/Nairobi')
                                                                       AND tx.timestamp < ((mo.m + interval '1 month')::timestamp AT TIME ZONE 'Africa/Nairobi')),
                'ai_calls', (SELECT COALESCE(sum(calls), 0) FROM public.ai_usage u WHERE u.day >= mo.m AND u.day < (mo.m + interval '1 month')::date)
            ) ORDER BY mo.m)
            FROM months mo),
        'usage', jsonb_build_object(
            'branches', (SELECT COALESCE(sum(branches), 0) FROM tp),
            'branches_allowed', (SELECT COALESCE(sum(max_branches), 0) FROM tp),
            'staff', (SELECT COALESCE(sum(staff), 0) FROM tp),
            'staff_allowed', (SELECT COALESCE(sum(max_staff), 0) FROM tp),
            'ai_today', (SELECT COALESCE(sum(ai_today), 0) FROM tp),
            'ai_cap_today', (SELECT COALESCE(sum(ai_cap), 0) FROM tp WHERE status IN ('trial', 'active', 'grace')),
            'ai_30_days', (SELECT COALESCE(sum(ai_30), 0) FROM tp),
            'database_bytes', pg_database_size(current_database()),
            'files_bytes', v_files,
            'storage_allowed_mb', (SELECT COALESCE(sum(storage_mb), 0) FROM tp WHERE status IN ('trial', 'active', 'grace'))),
        'busiest', COALESCE((
            SELECT jsonb_agg(x ORDER BY (x->>'load')::numeric DESC) FROM (
                SELECT jsonb_build_object('tenant_id', id, 'name', name, 'plan', plan_name, 'status', status,
                                          'branches', branches, 'max_branches', max_branches,
                                          'staff', staff, 'max_staff', max_staff,
                                          'ai_today', ai_today, 'ai_cap', ai_cap, 'ai_30', ai_30,
                                          'load', round(GREATEST(branches::numeric / NULLIF(max_branches, 0),
                                                                 staff::numeric / NULLIF(max_staff, 0),
                                                                 ai_today::numeric / NULLIF(ai_cap, 0), 0) * 100)) AS x
                FROM tp ORDER BY GREATEST(branches::numeric / NULLIF(max_branches, 0), staff::numeric / NULLIF(max_staff, 0),
                                          ai_today::numeric / NULLIF(ai_cap, 0), 0) DESC NULLS LAST
                LIMIT 8) y), '[]'::jsonb),
        'costs', jsonb_build_object(
            'fixed_month', round((SELECT COALESCE(sum(CASE per WHEN 'year' THEN amount / 12 ELSE amount END), 0)
                                  FROM public.platform_running_costs WHERE active AND kind = 'fixed'), 2),
            'per_company_month', round((SELECT COALESCE(sum(CASE per WHEN 'year' THEN amount / 12 ELSE amount END), 0)
                                        FROM public.platform_running_costs WHERE active AND kind = 'per_company'), 2),
            'share_percent', (SELECT COALESCE(sum(amount), 0) FROM public.platform_running_costs WHERE active AND kind = 'share'))
    ) INTO r;
    RETURN r;
END;
$$;
REVOKE ALL ON FUNCTION public.platform_home_stats(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.platform_home_stats(integer) TO authenticated, service_role;
