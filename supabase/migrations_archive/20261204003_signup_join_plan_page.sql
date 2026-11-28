-- 20261204003_signup_join_plan_page.sql
-- SaaS step 5: how people get in (owner decisions 2026-11-24, round 2 and 3).
--
--   * Prices the plan page shows: set-up fee per plan, add-on prices per module, VAT and the
--     payment instructions as platform settings. Nothing is hardcoded in the app.
--   * provider_cost_estimates: what a business pays OTHERS (Safaricom, card company, SMS,
--     domain). Rows the platform admin edits; the app only shows them as estimates.
--   * Plan-change requests from an existing company (signup_requests.kind = 'change'); the
--     platform admin's approval applies the plan.
--   * Join codes: one code per branch (8 letters, expires). Someone signed in enters it, the
--     branch sees a request, and someone with staff.invite lets them in and picks the role.
--     Businesses are never searchable: a wrong code says nothing about any business.
--   * Invitations sent to the signed-in person's verified email can be accepted from the
--     start screen without typing the code.
--   * my_signup_state() also returns those invitations and the person's join requests.

-- ============================================================================================
-- 1. Prices and payment details
-- ============================================================================================
ALTER TABLE public.plans
    ADD COLUMN IF NOT EXISTS setup_fee numeric(14,2) NOT NULL DEFAULT 0 CHECK (setup_fee >= 0);

ALTER TABLE public.plan_modules
    ADD COLUMN IF NOT EXISTS addon_monthly_price numeric(14,2) CHECK (addon_monthly_price >= 0),
    ADD COLUMN IF NOT EXISTS addon_annual_price numeric(14,2) CHECK (addon_annual_price >= 0);

ALTER TABLE public.platform_settings
    ADD COLUMN IF NOT EXISTS vat_percent numeric(5,2) NOT NULL DEFAULT 0 CHECK (vat_percent >= 0 AND vat_percent <= 50),
    ADD COLUMN IF NOT EXISTS payment_instructions text CHECK (payment_instructions IS NULL OR length(payment_instructions) <= 1000),
    ADD COLUMN IF NOT EXISTS terms_url text CHECK (terms_url IS NULL OR terms_url ~ '^https://'),
    ADD COLUMN IF NOT EXISTS contact_text text CHECK (contact_text IS NULL OR length(contact_text) <= 300);

CREATE OR REPLACE FUNCTION public.platform_update_settings(p_settings jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    r jsonb;
BEGIN
    PERFORM public.fn_require_platform_admin();
    IF EXISTS (SELECT 1 FROM jsonb_object_keys(COALESCE(p_settings, '{}')) k
               WHERE k NOT IN ('trial_enabled', 'trial_days', 'trial_plan', 'grace_days', 'read_only_days', 'platform_domain',
                               'vat_percent', 'payment_instructions', 'terms_url', 'contact_text')) THEN
        RAISE EXCEPTION 'Unknown setting.';
    END IF;
    IF p_settings ? 'trial_plan' AND NOT EXISTS (SELECT 1 FROM public.plans WHERE code = p_settings->>'trial_plan') THEN
        RAISE EXCEPTION 'Unknown plan.';
    END IF;
    UPDATE public.platform_settings SET
        trial_enabled   = COALESCE((p_settings->>'trial_enabled')::boolean, trial_enabled),
        trial_days      = COALESCE((p_settings->>'trial_days')::integer, trial_days),
        trial_plan      = COALESCE(p_settings->>'trial_plan', trial_plan),
        grace_days      = COALESCE((p_settings->>'grace_days')::integer, grace_days),
        read_only_days  = COALESCE((p_settings->>'read_only_days')::integer, read_only_days),
        platform_domain = CASE WHEN p_settings ? 'platform_domain'
                               THEN NULLIF(lower(trim(p_settings->>'platform_domain')), '') ELSE platform_domain END,
        vat_percent     = COALESCE((p_settings->>'vat_percent')::numeric, vat_percent),
        payment_instructions = CASE WHEN p_settings ? 'payment_instructions'
                               THEN NULLIF(trim(p_settings->>'payment_instructions'), '') ELSE payment_instructions END,
        terms_url       = CASE WHEN p_settings ? 'terms_url'
                               THEN NULLIF(trim(p_settings->>'terms_url'), '') ELSE terms_url END,
        contact_text    = CASE WHEN p_settings ? 'contact_text'
                               THEN NULLIF(trim(p_settings->>'contact_text'), '') ELSE contact_text END,
        updated_at = now(), updated_by = auth.uid()
    WHERE id
    RETURNING to_jsonb(platform_settings.*) INTO r;
    PERFORM public.fn_platform_log(NULL, 'settings_changed', p_settings);
    RETURN r;
END;
$$;

-- Prices of plans and add-ons (the admin website edits them; the plan page reads them).
CREATE OR REPLACE FUNCTION public.platform_update_plan_prices(
    p_plan_code text, p_monthly numeric, p_annual numeric, p_one_time numeric, p_setup_fee numeric)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    PERFORM public.fn_require_platform_admin();
    UPDATE public.plans SET
        monthly_price = round(p_monthly, 2), annual_price = round(p_annual, 2),
        one_time_price = round(p_one_time, 2), setup_fee = round(COALESCE(p_setup_fee, 0), 2),
        updated_at = now()
    WHERE code = p_plan_code;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Unknown plan.';
    END IF;
    PERFORM public.fn_platform_log(NULL, 'plan_prices', jsonb_build_object('plan', p_plan_code,
        'monthly', p_monthly, 'annual', p_annual, 'one_time', p_one_time, 'setup_fee', p_setup_fee));
END;
$$;
REVOKE ALL ON FUNCTION public.platform_update_plan_prices(text, numeric, numeric, numeric, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.platform_update_plan_prices(text, numeric, numeric, numeric, numeric) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.platform_update_addon_prices(p_module text, p_monthly numeric, p_annual numeric)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    PERFORM public.fn_require_platform_admin();
    UPDATE public.plan_modules SET addon_monthly_price = round(p_monthly, 2), addon_annual_price = round(p_annual, 2)
    WHERE key = p_module AND addable;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'That module can''t be bought as an add-on.';
    END IF;
    PERFORM public.fn_platform_log(NULL, 'addon_prices', jsonb_build_object('module', p_module, 'monthly', p_monthly, 'annual', p_annual));
END;
$$;
REVOKE ALL ON FUNCTION public.platform_update_addon_prices(text, numeric, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.platform_update_addon_prices(text, numeric, numeric) TO authenticated, service_role;

-- ============================================================================================
-- 2. What a business pays others (estimates only)
-- ============================================================================================
-- basis says what the cost is multiplied by on the plan page calculator:
--   percent_mpesa  % of M-Pesa sales a month     percent_card  % of card sales a month
--   per_sms        each SMS sent                 per_month     fixed each month
--   per_year       fixed each year (shown a month as 1/12)       free          no charge
-- needs: the module the cost comes with (NULL = every business).
CREATE TABLE IF NOT EXISTS public.provider_cost_estimates (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    provider text NOT NULL CHECK (length(trim(provider)) > 0),
    item text NOT NULL CHECK (length(trim(item)) > 0),
    basis text NOT NULL CHECK (basis IN ('percent_mpesa', 'percent_card', 'per_sms', 'per_month', 'per_year', 'free')),
    amount numeric(14,2) NOT NULL DEFAULT 0 CHECK (amount >= 0),
    max_amount numeric(14,2) CHECK (max_amount IS NULL OR max_amount >= 0),
    needs text REFERENCES public.plan_modules(key) ON UPDATE CASCADE ON DELETE SET NULL,
    note text CHECK (note IS NULL OR length(note) <= 500),
    checked_on date,
    sort integer NOT NULL DEFAULT 0,
    active boolean NOT NULL DEFAULT true,
    updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.provider_cost_estimates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS pol_provider_cost_estimates_select ON public.provider_cost_estimates;
CREATE POLICY pol_provider_cost_estimates_select ON public.provider_cost_estimates
    FOR SELECT TO authenticated USING (active OR (SELECT public.is_platform_admin()));
REVOKE ALL ON public.provider_cost_estimates FROM anon, authenticated;
GRANT SELECT ON public.provider_cost_estimates TO authenticated;
GRANT ALL ON public.provider_cost_estimates TO service_role;

-- Starting rows. Every figure is a placeholder for the platform admin to check and edit before
-- anyone relies on it (checked_on stays empty until then, and the app says "not checked").
INSERT INTO public.provider_cost_estimates (provider, item, basis, amount, max_amount, needs, note, sort)
SELECT * FROM (VALUES
    ('Safaricom', 'M-Pesa till (Buy Goods) charge', 'percent_mpesa', 0.55::numeric, 200::numeric, NULL::text,
     'Charged by Safaricom on each payment to your till.', 10),
    ('Card company (e.g. Paystack)', 'Card payment charge', 'percent_card', 2.90, NULL, NULL,
     'Only if you take card payments.', 20),
    ('SMS company', 'Each SMS sent', 'per_sms', 0.80, NULL, 'messaging',
     'Only for SMS you send to customers.', 30),
    ('KRA', 'eTIMS receipts', 'free', 0, NULL, NULL,
     'KRA does not charge for eTIMS.', 40),
    ('Domain seller', 'Your own web address (.co.ke)', 'per_year', 1500, NULL, 'own_domain',
     'Only if you want your own address for the online store.', 50)
) AS v(provider, item, basis, amount, max_amount, needs, note, sort)
WHERE NOT EXISTS (SELECT 1 FROM public.provider_cost_estimates)
  AND (v.needs IS NULL OR EXISTS (SELECT 1 FROM public.plan_modules m WHERE m.key = v.needs));

CREATE OR REPLACE FUNCTION public.platform_save_cost_estimate(p_row jsonb)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_id uuid := NULLIF(p_row->>'id', '')::uuid;
BEGIN
    PERFORM public.fn_require_platform_admin();
    IF v_id IS NULL THEN
        INSERT INTO public.provider_cost_estimates (provider, item, basis, amount, max_amount, needs, note, checked_on, sort, active)
        VALUES (trim(p_row->>'provider'), trim(p_row->>'item'), p_row->>'basis',
                round(COALESCE((p_row->>'amount')::numeric, 0), 2), round((p_row->>'max_amount')::numeric, 2),
                NULLIF(p_row->>'needs', ''), NULLIF(trim(p_row->>'note'), ''), (p_row->>'checked_on')::date,
                COALESCE((p_row->>'sort')::integer, 0), COALESCE((p_row->>'active')::boolean, true))
        RETURNING id INTO v_id;
    ELSE
        UPDATE public.provider_cost_estimates SET
            provider = COALESCE(trim(p_row->>'provider'), provider),
            item = COALESCE(trim(p_row->>'item'), item),
            basis = COALESCE(p_row->>'basis', basis),
            amount = COALESCE(round((p_row->>'amount')::numeric, 2), amount),
            max_amount = CASE WHEN p_row ? 'max_amount' THEN round((p_row->>'max_amount')::numeric, 2) ELSE max_amount END,
            needs = CASE WHEN p_row ? 'needs' THEN NULLIF(p_row->>'needs', '') ELSE needs END,
            note = CASE WHEN p_row ? 'note' THEN NULLIF(trim(p_row->>'note'), '') ELSE note END,
            checked_on = CASE WHEN p_row ? 'checked_on' THEN (p_row->>'checked_on')::date ELSE checked_on END,
            sort = COALESCE((p_row->>'sort')::integer, sort),
            active = COALESCE((p_row->>'active')::boolean, active),
            updated_at = now()
        WHERE id = v_id;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'Unknown cost row.';
        END IF;
    END IF;
    PERFORM public.fn_platform_log(NULL, 'cost_estimate_saved', p_row || jsonb_build_object('id', v_id));
    RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.platform_save_cost_estimate(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.platform_save_cost_estimate(jsonb) TO authenticated, service_role;

-- ============================================================================================
-- 3. Sign-up requests: payment reference, and plan changes for an existing company
-- ============================================================================================
ALTER TABLE public.signup_requests
    ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'new' CHECK (kind IN ('new', 'change'));

DROP FUNCTION IF EXISTS public.request_business_signup(text, text, text, text, text, text[]);
CREATE OR REPLACE FUNCTION public.request_business_signup(
    p_plan_code text, p_billing_cycle text, p_business_name text,
    p_phone text DEFAULT NULL, p_message text DEFAULT NULL, p_addons text[] DEFAULT '{}',
    p_payment_reference text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_uid uuid := auth.uid();
    p public.plans;
    v_id uuid;
BEGIN
    IF v_uid IS NULL OR NOT public.account_email_verified(v_uid) THEN
        RAISE EXCEPTION 'Please verify your email first.' USING ERRCODE = '42501';
    END IF;
    IF NOT public.check_rate_limit('signup_request:' || v_uid::text, 10, 86400) THEN
        RAISE EXCEPTION 'Too many requests today. Please try again tomorrow.';
    END IF;
    IF length(trim(COALESCE(p_business_name, ''))) = 0 THEN
        RAISE EXCEPTION 'Enter the business name.';
    END IF;
    SELECT * INTO p FROM public.plans WHERE code = p_plan_code AND active AND is_public;
    IF NOT FOUND OR p.kind = 'trial' THEN
        RAISE EXCEPTION 'Choose one of the plans.';
    END IF;
    IF (p.kind = 'perpetual') <> (p_billing_cycle = 'one_time') OR p_billing_cycle NOT IN ('monthly', 'annual', 'one_time') THEN
        RAISE EXCEPTION 'Choose how you want to pay for this plan.';
    END IF;
    IF EXISTS (SELECT 1 FROM unnest(COALESCE(p_addons, '{}')) a
               WHERE NOT p.addons_allowed OR a NOT IN (SELECT key FROM public.plan_modules WHERE addable)) THEN
        RAISE EXCEPTION 'Add-ons can only be added to the Pro plan.';
    END IF;
    IF EXISTS (SELECT 1 FROM public.signup_requests WHERE auth_user_id = v_uid AND status IN ('pending', 'approved')) THEN
        RAISE EXCEPTION 'You already have a request waiting. Cancel it first to make a new one.';
    END IF;
    INSERT INTO public.signup_requests (auth_user_id, email, plan_code, billing_cycle, business_name, phone, message,
                                        addons, payment_reference, kind)
    VALUES (v_uid, (SELECT email FROM auth.users WHERE id = v_uid), p.code, p_billing_cycle,
            trim(p_business_name), NULLIF(trim(COALESCE(p_phone, '')), ''), NULLIF(trim(COALESCE(p_message, '')), ''),
            COALESCE(p_addons, '{}'), NULLIF(left(trim(COALESCE(p_payment_reference, '')), 60), ''), 'new')
    RETURNING id INTO v_id;
    PERFORM public.fn_platform_log(NULL, 'signup_requested', jsonb_build_object('request', v_id, 'plan', p.code));
    RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.request_business_signup(text, text, text, text, text, text[], text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_business_signup(text, text, text, text, text, text[], text) TO authenticated, service_role;

-- The company owner asks for another plan (or add-ons). The platform admin approves it.
CREATE OR REPLACE FUNCTION public.request_plan_change(
    p_business_id uuid, p_plan_code text, p_billing_cycle text, p_addons text[] DEFAULT '{}',
    p_payment_reference text DEFAULT NULL, p_message text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_uid uuid := auth.uid();
    v_tenant uuid;
    p public.plans;
    v_id uuid;
BEGIN
    v_tenant := public.fn_business_tenant(p_business_id);
    IF v_uid IS NULL OR v_tenant IS NULL OR NOT EXISTS (
        SELECT 1 FROM public.tenants t JOIN public.users u ON u.id = t.owner_user_id
        WHERE t.id = v_tenant AND u.auth_user_id = v_uid) THEN
        RAISE EXCEPTION 'Only the owner of the company can change its plan.' USING ERRCODE = '42501';
    END IF;
    IF NOT public.check_rate_limit('plan_change:' || v_uid::text, 10, 86400) THEN
        RAISE EXCEPTION 'Too many requests today. Please try again tomorrow.';
    END IF;
    SELECT * INTO p FROM public.plans WHERE code = p_plan_code AND active AND is_public;
    IF NOT FOUND OR p.kind = 'trial' THEN
        RAISE EXCEPTION 'Choose one of the plans.';
    END IF;
    IF (p.kind = 'perpetual') <> (p_billing_cycle = 'one_time') OR p_billing_cycle NOT IN ('monthly', 'annual', 'one_time') THEN
        RAISE EXCEPTION 'Choose how you want to pay for this plan.';
    END IF;
    IF EXISTS (SELECT 1 FROM unnest(COALESCE(p_addons, '{}')) a
               WHERE NOT p.addons_allowed OR a NOT IN (SELECT key FROM public.plan_modules WHERE addable)) THEN
        RAISE EXCEPTION 'Add-ons can only be added to the Pro plan.';
    END IF;
    IF EXISTS (SELECT 1 FROM public.signup_requests WHERE auth_user_id = v_uid AND status IN ('pending', 'approved')) THEN
        RAISE EXCEPTION 'You already have a request waiting. Cancel it first to make a new one.';
    END IF;
    INSERT INTO public.signup_requests (auth_user_id, email, plan_code, billing_cycle, business_name, message,
                                        addons, payment_reference, kind, tenant_id)
    VALUES (v_uid, (SELECT email FROM auth.users WHERE id = v_uid), p.code, p_billing_cycle,
            (SELECT name FROM public.tenants WHERE id = v_tenant), NULLIF(trim(COALESCE(p_message, '')), ''),
            COALESCE(p_addons, '{}'), NULLIF(left(trim(COALESCE(p_payment_reference, '')), 60), ''), 'change', v_tenant)
    RETURNING id INTO v_id;
    PERFORM public.fn_platform_log(v_tenant, 'plan_change_requested', jsonb_build_object('request', v_id, 'plan', p.code));
    RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.request_plan_change(uuid, text, text, text[], text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_plan_change(uuid, text, text, text[], text, text) TO authenticated, service_role;

-- The owner's open plan-change request (Business & branches -> plan).
CREATE OR REPLACE FUNCTION public.my_plan_request(p_business_id uuid)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT to_jsonb(r) FROM (
        SELECT id, plan_code, billing_cycle, addons, status, decision_note, payment_reference, created_at, decided_at
        FROM public.signup_requests
        WHERE auth_user_id = auth.uid() AND kind = 'change'
          AND tenant_id = public.fn_business_tenant(p_business_id)
          AND (status = 'pending' OR (status = 'rejected' AND decided_at > now() - interval '30 days'))
        ORDER BY created_at DESC LIMIT 1) r;
$$;
REVOKE ALL ON FUNCTION public.my_plan_request(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_plan_request(uuid) TO authenticated, service_role;

-- Approving a plan change applies it at once (the request is then used).
CREATE OR REPLACE FUNCTION public.platform_decide_signup(p_request_id uuid, p_approve boolean, p_note text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_req public.signup_requests;
BEGIN
    PERFORM public.fn_require_platform_admin();
    SELECT * INTO v_req FROM public.signup_requests WHERE id = p_request_id AND status = 'pending' FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'That request is not waiting for a decision.';
    END IF;
    UPDATE public.signup_requests
    SET status = CASE WHEN NOT p_approve THEN 'rejected' WHEN kind = 'change' THEN 'used' ELSE 'approved' END,
        decided_by = auth.uid(), decided_at = now(), decision_note = p_note, updated_at = now()
    WHERE id = p_request_id;
    IF p_approve AND v_req.kind = 'change' THEN
        PERFORM public.platform_set_plan(v_req.tenant_id, v_req.plan_code, 'active', v_req.billing_cycle,
            CASE v_req.billing_cycle WHEN 'monthly' THEN now() + interval '1 month'
                                     WHEN 'annual' THEN now() + interval '1 year' END,
            p_note);
        PERFORM public.platform_set_addons(v_req.tenant_id, v_req.addons)
        WHERE (SELECT addons_allowed FROM public.plans WHERE code = v_req.plan_code);
    END IF;
    PERFORM public.fn_platform_log(v_req.tenant_id, CASE WHEN p_approve THEN 'signup_approved' ELSE 'signup_rejected' END,
        jsonb_build_object('request', p_request_id, 'kind', v_req.kind, 'note', p_note));
END;
$$;

-- ============================================================================================
-- 4. Join codes and join requests
-- ============================================================================================
CREATE TABLE IF NOT EXISTS public.business_join_codes (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    code text NOT NULL UNIQUE CHECK (code ~ '^[A-HJ-NP-Z2-9]{8}$'),
    created_by uuid,
    expires_at timestamptz NOT NULL,
    revoked_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_join_codes_one_live ON public.business_join_codes(business_id) WHERE revoked_at IS NULL;
ALTER TABLE public.business_join_codes ENABLE ROW LEVEL SECURITY;
-- No direct access: only the functions below.
REVOKE ALL ON public.business_join_codes FROM anon, authenticated;
GRANT ALL ON public.business_join_codes TO service_role;

CREATE TABLE IF NOT EXISTS public.join_requests (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    auth_user_id uuid NOT NULL,
    user_id uuid,
    name text NOT NULL,
    email text,
    phone text,
    status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
    role public.employee_role,
    decided_by uuid,
    decided_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_join_requests_one_open ON public.join_requests(business_id, auth_user_id) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_join_requests_business ON public.join_requests(business_id, status);
ALTER TABLE public.join_requests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS pol_join_requests_select ON public.join_requests;
CREATE POLICY pol_join_requests_select ON public.join_requests FOR SELECT TO authenticated
    USING (auth_user_id = (SELECT auth.uid()) OR public.has_permission(business_id, 'staff.invite'));
REVOKE ALL ON public.join_requests FROM anon, authenticated;
GRANT SELECT ON public.join_requests TO authenticated;
GRANT ALL ON public.join_requests TO service_role;

CREATE OR REPLACE FUNCTION public.fn_new_join_code()
RETURNS text
LANGUAGE plpgsql VOLATILE
SET search_path = ''
AS $$
DECLARE
    v_alpha constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';  -- no I, O, 0, 1
    v_bytes bytea := extensions.gen_random_bytes(8);
    v_code text := '';
BEGIN
    FOR i IN 0..7 LOOP
        v_code := v_code || substr(v_alpha, (get_byte(v_bytes, i) % 32) + 1, 1);
    END LOOP;
    RETURN v_code;
END;
$$;
REVOKE ALL ON FUNCTION public.fn_new_join_code() FROM PUBLIC, anon, authenticated;

-- The branch's live code, or NULL. Only people who may invite staff see it.
CREATE OR REPLACE FUNCTION public.get_join_code(p_business_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF NOT public.has_permission(p_business_id, 'staff.invite') THEN
        RAISE EXCEPTION 'You do not have permission to invite staff.' USING ERRCODE = '42501';
    END IF;
    RETURN (SELECT jsonb_build_object('code', code, 'expires_at', expires_at, 'created_at', created_at)
            FROM public.business_join_codes
            WHERE business_id = p_business_id AND revoked_at IS NULL AND expires_at > now());
END;
$$;
REVOKE ALL ON FUNCTION public.get_join_code(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_join_code(uuid) TO authenticated, service_role;

-- A new code (the old one stops working). p_days 1..30.
CREATE OR REPLACE FUNCTION public.create_join_code(p_business_id uuid, p_days integer DEFAULT 7)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_code text;
    v_try integer := 0;
BEGIN
    IF NOT public.has_permission(p_business_id, 'staff.invite') THEN
        RAISE EXCEPTION 'You do not have permission to invite staff.' USING ERRCODE = '42501';
    END IF;
    IF p_days IS NULL OR p_days < 1 OR p_days > 30 THEN
        RAISE EXCEPTION 'A join code can last 1 to 30 days.';
    END IF;
    UPDATE public.business_join_codes SET revoked_at = now()
    WHERE business_id = p_business_id AND revoked_at IS NULL;
    LOOP
        v_try := v_try + 1;
        v_code := public.fn_new_join_code();
        BEGIN
            INSERT INTO public.business_join_codes (business_id, code, created_by, expires_at)
            VALUES (p_business_id, v_code, auth.uid(), now() + make_interval(days => p_days));
            EXIT;
        EXCEPTION WHEN unique_violation THEN
            IF v_try >= 5 THEN RAISE; END IF;
        END;
    END LOOP;
    RETURN public.get_join_code(p_business_id);
END;
$$;
REVOKE ALL ON FUNCTION public.create_join_code(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_join_code(uuid, integer) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.revoke_join_code(p_business_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF NOT public.has_permission(p_business_id, 'staff.invite') THEN
        RAISE EXCEPTION 'You do not have permission to invite staff.' USING ERRCODE = '42501';
    END IF;
    UPDATE public.business_join_codes SET revoked_at = now()
    WHERE business_id = p_business_id AND revoked_at IS NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.revoke_join_code(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.revoke_join_code(uuid) TO authenticated, service_role;

-- Someone signed in enters a code. Wrong, expired and revoked codes all give the same answer
-- ({error}), and guesses are limited per person and per IP. A right code gives
-- {request_id, business_name}.
CREATE OR REPLACE FUNCTION public.redeem_join_code(p_code text, p_name text DEFAULT NULL, p_phone text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_uid uuid := auth.uid();
    v_code text := upper(regexp_replace(COALESCE(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
    c public.business_join_codes;
    v_user public.users;
    v_req uuid;
BEGIN
    IF v_uid IS NULL OR NOT public.account_email_verified(v_uid) THEN
        RAISE EXCEPTION 'Please verify your email first.' USING ERRCODE = '42501';
    END IF;
    IF NOT public.check_rate_limit('join_code:' || v_uid::text, 10, 900)
       OR NOT public.check_rate_limit('join_code_ip:' || public.request_ip(), 30, 900) THEN
        RAISE EXCEPTION 'Too many tries. Please wait 15 minutes and try again.';
    END IF;
    SELECT * INTO c FROM public.business_join_codes
    WHERE code = v_code AND revoked_at IS NULL AND expires_at > now();
    IF NOT FOUND THEN
        -- Answered, not raised: an error would undo the guess counted above.
        RETURN jsonb_build_object('error', 'That join code is not valid. Ask for a new one.');
    END IF;
    SELECT * INTO v_user FROM public.users WHERE auth_user_id = v_uid;
    IF EXISTS (SELECT 1 FROM public.business_memberships
               WHERE business_id = c.business_id AND user_id = v_user.id AND status = 'Active') THEN
        RAISE EXCEPTION 'You are already in this business.';
    END IF;
    SELECT id INTO v_req FROM public.join_requests
    WHERE business_id = c.business_id AND auth_user_id = v_uid AND status = 'pending';
    IF v_req IS NULL THEN
        INSERT INTO public.join_requests (business_id, auth_user_id, user_id, name, email, phone)
        VALUES (c.business_id, v_uid, v_user.id,
                COALESCE(NULLIF(trim(COALESCE(p_name, '')), ''), NULLIF(trim(v_user.name), ''), 'New team member'),
                (SELECT email FROM auth.users WHERE id = v_uid),
                COALESCE(NULLIF(trim(COALESCE(p_phone, '')), ''), v_user.phone))
        RETURNING id INTO v_req;
    END IF;
    RETURN jsonb_build_object('request_id', v_req,
                              'business_name', (SELECT name FROM public.businesses WHERE id = c.business_id));
END;
$$;
REVOKE ALL ON FUNCTION public.redeem_join_code(text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.redeem_join_code(text, text, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.cancel_join_request(p_request_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    UPDATE public.join_requests SET status = 'cancelled', decided_at = now()
    WHERE id = p_request_id AND auth_user_id = auth.uid() AND status = 'pending';
    IF NOT FOUND THEN
        RAISE EXCEPTION 'That request can''t be cancelled.';
    END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.cancel_join_request(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_join_request(uuid) TO authenticated, service_role;

-- Let them in with a role, or turn them away. Only the Owner gives Owner-level or admin roles.
CREATE OR REPLACE FUNCTION public.decide_join_request(p_request_id uuid, p_approve boolean, p_role text DEFAULT 'Staff')
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    r public.join_requests;
    v_role public.employee_role;
    v_user uuid;
BEGIN
    SELECT * INTO r FROM public.join_requests WHERE id = p_request_id FOR UPDATE;
    IF NOT FOUND OR NOT public.has_permission(r.business_id, 'staff.invite') THEN
        RAISE EXCEPTION 'You do not have permission to add staff.' USING ERRCODE = '42501';
    END IF;
    IF r.status <> 'pending' THEN
        RAISE EXCEPTION 'That request has already been answered.';
    END IF;

    IF NOT p_approve THEN
        UPDATE public.join_requests SET status = 'rejected', decided_by = auth.uid(), decided_at = now() WHERE id = r.id;
        RETURN;
    END IF;

    BEGIN
        v_role := p_role::public.employee_role;
    EXCEPTION WHEN invalid_text_representation THEN
        RAISE EXCEPTION 'Choose a role.';
    END;
    IF v_role = 'Owner' THEN
        RAISE EXCEPTION 'A business has one owner. Choose another role.';
    END IF;
    IF v_role IN ('Admin', 'Administrator') AND NOT EXISTS (
        SELECT 1 FROM public.business_memberships m JOIN public.users u ON u.id = m.user_id
        WHERE m.business_id = r.business_id AND u.auth_user_id = auth.uid() AND m.role = 'Owner' AND m.status = 'Active') THEN
        RAISE EXCEPTION 'Only the owner can make someone an admin.' USING ERRCODE = '42501';
    END IF;

    v_user := r.user_id;
    IF v_user IS NULL THEN
        SELECT id INTO v_user FROM public.users WHERE auth_user_id = r.auth_user_id;
    END IF;
    IF v_user IS NULL THEN
        INSERT INTO public.users (id, auth_user_id, name, email, phone, is_verified)
        VALUES (r.auth_user_id, r.auth_user_id, r.name, r.email, r.phone, true)
        RETURNING id INTO v_user;
    END IF;

    -- The staff limit trigger refuses this when the plan is full.
    INSERT INTO public.business_memberships (business_id, user_id, role, status)
    VALUES (r.business_id, v_user, v_role, 'Active')
    ON CONFLICT (business_id, user_id) DO UPDATE SET role = v_role, status = 'Active';
    PERFORM public.fn_sync_employee(r.business_id, v_user);

    UPDATE public.join_requests
    SET status = 'approved', role = v_role, user_id = v_user, decided_by = auth.uid(), decided_at = now()
    WHERE id = r.id;
END;
$$;
REVOKE ALL ON FUNCTION public.decide_join_request(uuid, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.decide_join_request(uuid, boolean, text) TO authenticated, service_role;

-- ============================================================================================
-- 5. Invitations to my verified email, accepted from the start screen
-- ============================================================================================
CREATE OR REPLACE FUNCTION public.accept_my_invitation(p_invite_id uuid)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_uid uuid := auth.uid();
    v_inv public.invitations;
BEGIN
    IF v_uid IS NULL OR NOT public.account_email_verified(v_uid) THEN
        RAISE EXCEPTION 'Please verify your email first.' USING ERRCODE = '42501';
    END IF;
    SELECT * INTO v_inv FROM public.invitations
    WHERE id = p_invite_id AND status = 'Pending' AND expires_at > now()
      AND lower(trim(email)) = (SELECT lower(trim(email)) FROM auth.users WHERE id = v_uid)
    FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'That invitation has expired or was cancelled. Ask for a new one.';
    END IF;
    PERFORM public.finish_invitation(v_inv.id, v_uid,
        (SELECT name FROM public.users WHERE auth_user_id = v_uid),
        (SELECT phone FROM public.users WHERE auth_user_id = v_uid));
    RETURN v_inv.business_id;
END;
$$;
REVOKE ALL ON FUNCTION public.accept_my_invitation(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.accept_my_invitation(uuid) TO authenticated, service_role;

-- ============================================================================================
-- 6. Where the signed-in person stands (start screen)
-- ============================================================================================
CREATE OR REPLACE FUNCTION public.my_signup_state()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_uid uuid := auth.uid();
    v_email text;
    v_req jsonb;
    s public.platform_settings;
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'Please sign in.' USING ERRCODE = '42501';
    END IF;
    SELECT * INTO s FROM public.platform_settings WHERE id;
    SELECT lower(trim(email)) INTO v_email FROM auth.users WHERE id = v_uid;
    SELECT to_jsonb(r) INTO v_req FROM (
        SELECT id, plan_code, billing_cycle, business_name, status, decision_note, payment_reference, created_at, decided_at
        FROM public.signup_requests
        WHERE auth_user_id = v_uid AND kind = 'new' AND status IN ('pending', 'approved', 'rejected')
        ORDER BY created_at DESC LIMIT 1) r;
    RETURN jsonb_build_object(
        'email_verified', public.account_email_verified(v_uid),
        'owns_company', EXISTS (SELECT 1 FROM public.tenants t JOIN public.users u ON u.id = t.owner_user_id
                                WHERE u.auth_user_id = v_uid),
        'trial_enabled', s.trial_enabled,
        'trial_days', s.trial_days,
        'can_start_trial', public.fn_can_start_trial(v_uid),
        'request', v_req,
        'is_platform_admin', public.is_platform_admin(v_uid),
        -- Invitations only once the email is proven to be theirs.
        'invites', CASE WHEN public.account_email_verified(v_uid) THEN COALESCE((
            SELECT jsonb_agg(jsonb_build_object('id', i.id, 'business_name', b.name, 'role', i.role,
                                                'expires_at', i.expires_at, 'supplier', i.supplier_id IS NOT NULL)
                             ORDER BY i.created_at DESC)
            FROM public.invitations i JOIN public.businesses b ON b.id = i.business_id
            WHERE lower(trim(i.email)) = v_email AND i.status = 'Pending' AND i.expires_at > now()
              AND b.deleted_at IS NULL), '[]'::jsonb) ELSE '[]'::jsonb END,
        'join_requests', COALESCE((
            SELECT jsonb_agg(jsonb_build_object('id', j.id, 'business_name', b.name, 'status', j.status,
                                                'created_at', j.created_at) ORDER BY j.created_at DESC)
            FROM public.join_requests j JOIN public.businesses b ON b.id = j.business_id
            WHERE j.auth_user_id = v_uid
              AND (j.status = 'pending' OR (j.status = 'rejected' AND j.decided_at > now() - interval '14 days'))),
            '[]'::jsonb));
END;
$$;

-- Plan page facts that are not in the plans table (any signed-in person).
CREATE OR REPLACE FUNCTION public.get_plan_page_settings()
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT jsonb_build_object('vat_percent', vat_percent, 'payment_instructions', payment_instructions,
                              'terms_url', terms_url, 'contact_text', contact_text,
                              'trial_enabled', trial_enabled, 'trial_days', trial_days)
    FROM public.platform_settings WHERE id;
$$;
REVOKE ALL ON FUNCTION public.get_plan_page_settings() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_plan_page_settings() TO authenticated, service_role;

-- A read-only or suspended company issues no codes and takes no one in (same rule as every
-- other business table, 20261204001 section 6).
DROP TRIGGER IF EXISTS trg_zz_plan_read_only ON public.business_join_codes;
CREATE TRIGGER trg_zz_plan_read_only BEFORE INSERT OR UPDATE OR DELETE ON public.business_join_codes
    FOR EACH ROW EXECUTE FUNCTION public.fn_block_when_read_only();
DROP TRIGGER IF EXISTS trg_zz_plan_read_only ON public.join_requests;
CREATE TRIGGER trg_zz_plan_read_only BEFORE INSERT OR UPDATE OR DELETE ON public.join_requests
    FOR EACH ROW EXECUTE FUNCTION public.fn_block_when_read_only();
