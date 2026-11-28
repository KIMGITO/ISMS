-- 2026-11-17 Customer referral program (two-sided), built on promotions (20261126001).
--
-- Pieces, reusing what exists:
--   referral_campaigns  one running campaign per branch: what each side gets, the limits,
--                       the wait before rewards, and fraud settings. Its first-purchase
--                       rules (minimum, products, branches, combine with discounts, dates)
--                       live in a hidden promotion row (origin 'referral_welcome'), so the
--                       till checks a referral with the same engine as any promotion code.
--   referral_codes      one code per customer (e.g. DENNIS482), shared with as many people
--                       as they like. Typed in the till's promotion box.
--   referrals           referrer -> new customer: pending (code applied, sale not yet saved),
--                       qualified (first purchase saved), rewarded, rejected, cancelled, expired.
--   referral_rewards    every reward given, one row per side, never more (unique), with what
--                       it cost. Kinds: amount / percent / free_product (a personal code the
--                       customer uses later), wallet (credit now), points (now), and
--                       discount_at_sale (the new customer's welcome, taken off the sale).
-- Money: wallet credit posts to the books (Referral rewards expense / Customer wallet money);
-- discounts post with the sale (Promotion discounts). See 20261126003.
--
-- Lifecycle at the till: cashier picks the NEW customer, types the referrer's code
--   promo_check / promo_reserve find no promotion, find the referral code, run the referral
--   checks (below) and the welcome rules; reserve also writes the pending referral.
--   Sale commits -> qualified (fraud flags worked out); rewards are given after the
--   campaign's wait (hold_days) if the sale is still whole, by a job every 10 minutes, or at
--   once when hold_days = 0. Flagged referrals wait for a manager when review_flagged.
--   Sale cancelled or refunded before rewards -> cancelled. After rewards -> rewards taken
--   back where still possible (unused codes revoked, unspent wallet credit and points
--   removed) and the referral is cancelled with the flag refunded_after_reward.

-- ============================================================================ campaigns
CREATE TABLE IF NOT EXISTS public.referral_campaigns (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    name text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 80),
    description text CHECK (description IS NULL OR length(description) <= 500),
    active boolean NOT NULL DEFAULT true,
    starts_at timestamptz,
    ends_at timestamptz,
    referrer_kind text NOT NULL CHECK (referrer_kind IN ('amount', 'percent', 'wallet', 'free_product', 'points')),
    referrer_value numeric(14,2) NOT NULL DEFAULT 0 CHECK (referrer_value >= 0),
    referrer_product_id uuid REFERENCES public.products(id) ON DELETE RESTRICT,
    referrer_qty numeric(14,3),
    welcome_kind text NOT NULL CHECK (welcome_kind IN ('amount', 'percent', 'wallet', 'free_product', 'points')),
    welcome_value numeric(14,2) NOT NULL DEFAULT 0 CHECK (welcome_value >= 0),
    welcome_product_id uuid REFERENCES public.products(id) ON DELETE RESTRICT,
    welcome_qty numeric(14,3),
    welcome_promotion_id uuid NOT NULL REFERENCES public.website_promo_codes(id),
    max_per_referrer int CHECK (max_per_referrer IS NULL OR max_per_referrer > 0),
    max_total int CHECK (max_total IS NULL OR max_total > 0),
    max_rewards_per_customer int CHECK (max_rewards_per_customer IS NULL OR max_rewards_per_customer > 0),
    reward_expiry_days int CHECK (reward_expiry_days IS NULL OR reward_expiry_days > 0),
    hold_days int NOT NULL DEFAULT 3 CHECK (hold_days BETWEEN 0 AND 60),
    exclude_existing boolean NOT NULL DEFAULT true,
    new_customer_days int NOT NULL DEFAULT 30 CHECK (new_customer_days BETWEEN 1 AND 365),
    require_phone boolean NOT NULL DEFAULT true,
    review_flagged boolean NOT NULL DEFAULT true,
    created_by text,
    updated_by text,
    archived_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CHECK (ends_at IS NULL OR starts_at IS NULL OR ends_at > starts_at),
    CHECK (archived_at IS NULL OR NOT active),
    CHECK (referrer_kind <> 'free_product' OR (referrer_product_id IS NOT NULL AND referrer_qty > 0)),
    CHECK (welcome_kind <> 'free_product' OR (welcome_product_id IS NOT NULL AND welcome_qty > 0)),
    CHECK (referrer_kind NOT IN ('amount', 'percent', 'wallet', 'points') OR referrer_value > 0),
    CHECK (welcome_kind NOT IN ('amount', 'percent', 'wallet', 'points') OR welcome_value > 0),
    CHECK (referrer_kind <> 'percent' OR referrer_value <= 90),
    CHECK (welcome_kind <> 'percent' OR welcome_value <= 90)
);
-- One running campaign per branch, so a code always means one set of rewards.
CREATE UNIQUE INDEX IF NOT EXISTS uq_referral_campaign_active ON public.referral_campaigns (business_id) WHERE active;

-- ============================================================================ codes
CREATE TABLE IF NOT EXISTS public.referral_codes (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    customer_id uuid NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
    code text NOT NULL CHECK (code ~ '^[A-Z0-9][A-Z0-9-]{2,23}$'),
    status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'revoked')),
    status_reason text,
    status_by text,
    status_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (business_id, code)
);
-- One code per customer that isn't revoked (a revoked code is kept for the record).
CREATE UNIQUE INDEX IF NOT EXISTS uq_referral_code_customer ON public.referral_codes (customer_id) WHERE status <> 'revoked';

-- ============================================================================ referrals
CREATE TABLE IF NOT EXISTS public.referrals (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    campaign_id uuid NOT NULL REFERENCES public.referral_campaigns(id),
    code_id uuid NOT NULL REFERENCES public.referral_codes(id),
    code text NOT NULL,
    referrer_customer_id uuid NOT NULL REFERENCES public.customers(id),
    referred_customer_id uuid NOT NULL REFERENCES public.customers(id),
    status text NOT NULL CHECK (status IN ('pending', 'qualified', 'rewarded', 'rejected', 'cancelled', 'expired')),
    redemption_id uuid REFERENCES public.promotion_redemptions(id),
    transaction_id uuid REFERENCES public.transactions(id) ON DELETE SET NULL,
    purchase_amount numeric(14,2),
    welcome_discount numeric(14,2) NOT NULL DEFAULT 0,
    flags text[] NOT NULL DEFAULT '{}',
    staff_id uuid,
    staff_name text,
    reward_due_at timestamptz,
    qualified_at timestamptz,
    rewarded_at timestamptz,
    ended_at timestamptz,
    end_reason text,
    decided_by text,
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK (referrer_customer_id <> referred_customer_id)
);
-- A new customer is referred once (a cancelled, rejected or expired try doesn't count).
CREATE UNIQUE INDEX IF NOT EXISTS uq_referral_referred ON public.referrals (referred_customer_id)
    WHERE status IN ('pending', 'qualified', 'rewarded');
CREATE UNIQUE INDEX IF NOT EXISTS uq_referral_redemption ON public.referrals (redemption_id) WHERE redemption_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_referrals_referrer ON public.referrals (referrer_customer_id, status);
CREATE INDEX IF NOT EXISTS idx_referrals_business ON public.referrals (business_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_referrals_due ON public.referrals (reward_due_at) WHERE status = 'qualified';

-- ============================================================================ rewards
CREATE TABLE IF NOT EXISTS public.referral_rewards (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    referral_id uuid NOT NULL REFERENCES public.referrals(id),
    campaign_id uuid NOT NULL REFERENCES public.referral_campaigns(id),
    customer_id uuid NOT NULL REFERENCES public.customers(id),
    side text NOT NULL CHECK (side IN ('referrer', 'referred')),
    kind text NOT NULL CHECK (kind IN ('amount', 'percent', 'wallet', 'free_product', 'points', 'discount_at_sale')),
    value numeric(14,2) NOT NULL DEFAULT 0,
    points int NOT NULL DEFAULT 0,
    product_id uuid REFERENCES public.products(id),
    qty numeric(14,3),
    promotion_id uuid REFERENCES public.website_promo_codes(id),
    status text NOT NULL CHECK (status IN ('issued', 'used', 'expired', 'revoked', 'reversed')),
    cost numeric(14,2) NOT NULL DEFAULT 0,       -- money it has cost so far
    reversed_amount numeric(14,2) NOT NULL DEFAULT 0,
    used_transaction_id uuid REFERENCES public.transactions(id) ON DELETE SET NULL,
    expires_at timestamptz,
    issued_at timestamptz NOT NULL DEFAULT now(),
    used_at timestamptz,
    ended_at timestamptz,
    end_reason text,
    issued_by text,
    UNIQUE (referral_id, side)                    -- issuing twice does nothing
);
CREATE INDEX IF NOT EXISTS idx_referral_rewards_customer ON public.referral_rewards (customer_id, status);
CREATE INDEX IF NOT EXISTS idx_referral_rewards_promotion ON public.referral_rewards (promotion_id) WHERE promotion_id IS NOT NULL;

-- Wallet credit and points from referrals are recorded where the app already looks.
ALTER TABLE public.customer_ledger DROP CONSTRAINT IF EXISTS customer_ledger_type_check;
ALTER TABLE public.customer_ledger ADD CONSTRAINT customer_ledger_type_check CHECK (type IN
    ('wallet_topup', 'wallet_usage', 'debt_creation', 'debt_payment', 'debt_adjustment', 'refund', 'referral_reward', 'referral_reversal'));
ALTER TABLE public.loyalty_points_earned DROP CONSTRAINT IF EXISTS loyalty_points_earned_source_check;
ALTER TABLE public.loyalty_points_earned ADD CONSTRAINT loyalty_points_earned_source_check CHECK (source IN ('sale', 'debt_payment', 'referral'));

-- ============================================================================ permissions
-- referrals.view  see campaigns, referrals and costs     referrals.manage  campaigns, approve, reject, suspend
INSERT INTO public.role_default_permissions (role, permissions) VALUES
    ('Manager', ARRAY['accounting.view', 'ai.insights', 'ai.use', 'assets.view', 'bom.create', 'bom.update', 'bom.view', 'business.switch', 'business.view', 'communication.send', 'communication.view', 'complaints.reply', 'complaints.view', 'customers.create', 'customers.debts', 'customers.loyalty', 'customers.manage', 'customers.schedules', 'customers.update', 'customers.view', 'dashboard.view', 'deliveries.assign', 'deliveries.cancel', 'deliveries.complete', 'deliveries.create', 'deliveries.view', 'expenses.create', 'expenses.update', 'expenses.view', 'files.view', 'finance.view', 'home.view', 'inventory.adjust_stock', 'inventory.expiry', 'inventory.receive_stock', 'inventory.request_transfer', 'inventory.stock_count', 'inventory.stock_history', 'inventory.transfer_stock', 'inventory.view', 'inventory.wastage', 'invoices.manage', 'invoices.view', 'loyalty.adjust', 'notifications.send', 'notifications.view', 'online_store.view', 'orders.assign_rider', 'orders.complete', 'orders.create', 'orders.update', 'orders.view', 'payments.card', 'payments.cash', 'payments.verify', 'payments.view', 'pettycash.record', 'pos.apply_promotion', 'pos.close_shift', 'pos.create_sale', 'pos.open_shift', 'pos.walkin_customer', 'production.approve', 'production.create', 'production.update', 'production.view', 'products.create', 'products.export', 'products.import', 'products.manage_categories', 'products.update', 'products.view', 'promotions.manage', 'promotions.view', 'referrals.manage', 'referrals.view', 'purchases.approve', 'purchases.create', 'purchases.export', 'purchases.print', 'purchases.request_quote', 'purchases.update', 'purchases.view', 'quotes.manage', 'quotes.view', 'refunds.create', 'reports.customers', 'reports.deliveries', 'reports.inventory', 'reports.profit', 'reports.sales', 'reports.view', 'sales_orders.manage', 'sales_orders.view', 'settings.tax', 'settings.theme', 'settings.update', 'settings.view', 'staff.schedule', 'staff.view', 'supplier_bills.manage', 'suppliers.create', 'suppliers.export', 'suppliers.import', 'suppliers.update', 'suppliers.view'])
ON CONFLICT (role) DO UPDATE SET permissions = EXCLUDED.permissions;

-- ============================================================================ RLS
ALTER TABLE public.referral_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.referral_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.referrals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.referral_rewards ENABLE ROW LEVEL SECURITY;
-- Read only; every change goes through the functions below.
CREATE POLICY pol_referral_campaigns_select ON public.referral_campaigns FOR SELECT USING (
    public.has_permission(business_id, 'referrals.view', 'referrals.manage'));
CREATE POLICY pol_referral_codes_select ON public.referral_codes FOR SELECT USING (
    public.has_permission(business_id, 'referrals.view', 'referrals.manage', 'customers.view'));
CREATE POLICY pol_referrals_select ON public.referrals FOR SELECT USING (
    public.has_permission(business_id, 'referrals.view', 'referrals.manage'));
CREATE POLICY pol_referral_rewards_select ON public.referral_rewards FOR SELECT USING (
    public.has_permission(business_id, 'referrals.view', 'referrals.manage'));
GRANT SELECT ON public.referral_campaigns, public.referral_codes, public.referrals, public.referral_rewards TO authenticated;
GRANT ALL ON public.referral_campaigns, public.referral_codes, public.referrals, public.referral_rewards TO service_role;

-- ============================================================================ codes share one box
-- Promotion codes and referral codes are typed in the same box: neither may take the other's.
CREATE OR REPLACE FUNCTION public.fn_code_not_taken() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    IF TG_TABLE_NAME = 'website_promo_codes' THEN
        IF EXISTS (SELECT 1 FROM public.referral_codes r WHERE r.business_id = NEW.business_id AND r.code = NEW.code) THEN
            RAISE EXCEPTION 'The code % is a customer''s referral code. Choose another.', NEW.code;
        END IF;
    ELSIF EXISTS (SELECT 1 FROM public.website_promo_codes p WHERE p.business_id = NEW.business_id AND p.code = NEW.code) THEN
        RAISE EXCEPTION 'The code % is already a promotion code.', NEW.code;
    END IF;
    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_promo_code_not_taken ON public.website_promo_codes;
CREATE TRIGGER trg_promo_code_not_taken BEFORE INSERT OR UPDATE OF code ON public.website_promo_codes
    FOR EACH ROW EXECUTE FUNCTION public.fn_code_not_taken();
DROP TRIGGER IF EXISTS trg_referral_code_not_taken ON public.referral_codes;
CREATE TRIGGER trg_referral_code_not_taken BEFORE INSERT OR UPDATE OF code ON public.referral_codes
    FOR EACH ROW EXECUTE FUNCTION public.fn_code_not_taken();

-- ============================================================================ helpers
-- Phones are compared with the existing fn_phone_key (07.. / 7.. / +254.. are the same number).

-- "Bob N." - enough for a customer to recognise a friend, nothing more.
CREATE OR REPLACE FUNCTION public.fn_short_name(p text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
    SELECT CASE WHEN p IS NULL OR trim(p) = '' THEN 'A friend'
        ELSE split_part(trim(p), ' ', 1) || CASE WHEN split_part(trim(p), ' ', 2) <> ''
            THEN ' ' || left(split_part(trim(p), ' ', 2), 1) || '.' ELSE '' END END
$$;

CREATE OR REPLACE FUNCTION public.fn_referral_campaign(p_business_id uuid) RETURNS public.referral_campaigns
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT * FROM public.referral_campaigns WHERE business_id = p_business_id AND active LIMIT 1
$$;

-- The customer's code, made the first time it's needed: first name + 3 digits.
CREATE OR REPLACE FUNCTION public.fn_referral_code_for(p_customer_id uuid) RETURNS public.referral_codes
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
    c   public.customers%ROWTYPE;
    r   public.referral_codes%ROWTYPE;
    v_base text;
    v_code text;
BEGIN
    SELECT * INTO r FROM public.referral_codes WHERE customer_id = p_customer_id AND status <> 'revoked';
    IF FOUND THEN RETURN r; END IF;
    SELECT * INTO c FROM public.customers WHERE id = p_customer_id AND deleted_at IS NULL AND merged_into_id IS NULL;
    IF NOT FOUND THEN RAISE EXCEPTION 'That customer was not found.'; END IF;
    v_base := left(regexp_replace(upper(split_part(trim(c.name), ' ', 1)), '[^A-Z]', '', 'g'), 10);
    IF length(v_base) < 2 THEN v_base := 'FRIEND'; END IF;
    FOR attempt IN 1..60 LOOP
        v_code := v_base || lpad((100 + floor(random() * 900))::int::text, 3, '0');
        IF attempt > 40 THEN v_code := v_base || lpad(floor(random() * 100000)::int::text, 5, '0'); END IF;
        IF NOT EXISTS (SELECT 1 FROM public.referral_codes WHERE business_id = c.business_id AND code = v_code)
           AND NOT EXISTS (SELECT 1 FROM public.website_promo_codes WHERE business_id = c.business_id AND code = v_code) THEN
            INSERT INTO public.referral_codes (business_id, customer_id, code) VALUES (c.business_id, c.id, v_code)
            RETURNING * INTO r;
            RETURN r;
        END IF;
    END LOOP;
    RAISE EXCEPTION 'Could not make a free referral code. Try again.';
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_referral_reward_text(p_kind text, p_value numeric, p_product uuid, p_qty numeric)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_p text;
BEGIN
    SELECT name INTO v_p FROM public.products WHERE id = p_product;
    RETURN CASE p_kind
        WHEN 'amount' THEN public.fn_ksh(p_value) || ' off'
        WHEN 'percent' THEN trim(to_char(p_value, 'FM990.##')) || '% off'
        WHEN 'wallet' THEN public.fn_ksh(p_value) || ' wallet credit'
        WHEN 'points' THEN trim(to_char(p_value, 'FM999,999,990')) || ' points'
        WHEN 'free_product' THEN trim(to_char(p_qty, 'FM999990.###')) || ' ' || COALESCE(v_p, 'item') || ' free'
        ELSE p_kind END;
END;
$$;

-- ============================================================================ the referral check
-- All rules for "this new customer uses that referral code on this cart". Never raises for
-- a rule. On top of the welcome promotion's rules (dates, branch, minimum, products,
-- combine) it checks the code, the campaign's limits and the signs of a fake referral.
CREATE OR REPLACE FUNCTION public.fn_referral_evaluate(
    p_code public.referral_codes, p_business_id uuid, p_customer_id uuid, p_items jsonb,
    p_other_discount numeric DEFAULT 0, p_exclude_redemption uuid DEFAULT NULL, p_exclude_referral uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
    k   public.referral_campaigns%ROWTYPE;
    p   public.website_promo_codes%ROWTYPE;
    a   public.customers%ROWTYPE;   -- referrer
    c   public.customers%ROWTYPE;   -- new customer
    v   jsonb;
    v_n int;
    v_twin text;
BEGIN
    IF p_code.status = 'suspended' THEN
        RETURN public.fn_promo_fail('This referral code is on hold. Ask a manager.');
    ELSIF p_code.status = 'revoked' THEN
        RETURN public.fn_promo_fail('This referral code has been switched off.');
    END IF;
    k := public.fn_referral_campaign(p_code.business_id);
    IF k.id IS NULL THEN
        RETURN public.fn_promo_fail('No referral programme is running just now.');
    END IF;
    SELECT * INTO a FROM public.customers WHERE id = p_code.customer_id;
    IF a.deleted_at IS NOT NULL OR a.merged_into_id IS NOT NULL THEN
        RETURN public.fn_promo_fail('This referral code belongs to a customer who was removed.');
    END IF;
    IF p_customer_id IS NULL THEN
        RETURN public.fn_promo_fail('A referral code is for a new customer. Choose or add the new customer first.');
    END IF;
    SELECT * INTO c FROM public.customers WHERE id = p_customer_id AND deleted_at IS NULL;
    IF NOT FOUND THEN RETURN public.fn_promo_fail('That customer was not found.'); END IF;
    IF c.merged_into_id IS NOT NULL THEN RETURN public.fn_promo_fail('That customer was merged into another.'); END IF;

    -- Not themselves, not a second account of the referrer.
    IF c.id = a.id THEN
        RETURN public.fn_promo_fail('Customers can''t use their own referral code.');
    END IF;
    IF public.fn_phone_key(c.phone) = public.fn_phone_key(a.phone)
       OR (NULLIF(lower(trim(c.email)), '') IS NOT NULL AND lower(trim(c.email)) = lower(trim(a.email))) THEN
        RETURN public.fn_promo_fail(c.name || ' has the same phone or email as the person who referred them.');
    END IF;
    IF k.require_phone AND COALESCE(length(public.fn_phone_key(c.phone)), 0) < 9 THEN
        RETURN public.fn_promo_fail('Add ' || c.name || '''s phone number first: referrals need one.');
    END IF;
    -- Genuinely new: no purchases, and not someone already known under another record.
    SELECT x.name INTO v_twin FROM public.customers x
    WHERE x.business_id = c.business_id AND x.id <> c.id AND x.deleted_at IS NULL
      AND (public.fn_phone_key(x.phone) = public.fn_phone_key(c.phone)
           OR (NULLIF(lower(trim(c.email)), '') IS NOT NULL AND lower(trim(x.email)) = lower(trim(c.email))))
    LIMIT 1;
    IF v_twin IS NOT NULL THEN
        RETURN public.fn_promo_fail('This phone or email already belongs to ' || v_twin || ', so ' || c.name || ' isn''t a new customer.');
    END IF;
    IF EXISTS (SELECT 1 FROM public.transactions t WHERE t.customer_id = c.id AND t.deleted_at IS NULL) THEN
        RETURN public.fn_promo_fail(c.name || ' has bought before, so isn''t a new customer.');
    END IF;
    IF k.exclude_existing AND c.created_at < now() - make_interval(days => k.new_customer_days) THEN
        RETURN public.fn_promo_fail(c.name || ' has been a customer for more than ' || k.new_customer_days || ' days.');
    END IF;
    IF EXISTS (SELECT 1 FROM public.referrals r WHERE r.referred_customer_id = c.id
               AND r.status IN ('pending', 'qualified', 'rewarded') AND r.id IS DISTINCT FROM p_exclude_referral) THEN
        RETURN public.fn_promo_fail(c.name || ' was already referred.');
    END IF;

    -- Limits
    IF k.max_per_referrer IS NOT NULL THEN
        SELECT count(*) INTO v_n FROM public.referrals r
        WHERE r.campaign_id = k.id AND r.referrer_customer_id = a.id AND r.status IN ('pending', 'qualified', 'rewarded')
          AND r.id IS DISTINCT FROM p_exclude_referral;
        IF v_n >= k.max_per_referrer THEN
            RETURN public.fn_promo_fail(public.fn_short_name(a.name) || ' has made the most referrals this programme allows (' || k.max_per_referrer || ').');
        END IF;
    END IF;
    IF k.max_total IS NOT NULL THEN
        SELECT count(*) INTO v_n FROM public.referrals r
        WHERE r.campaign_id = k.id AND r.status IN ('pending', 'qualified', 'rewarded') AND r.id IS DISTINCT FROM p_exclude_referral;
        IF v_n >= k.max_total THEN
            RETURN public.fn_promo_fail('The referral programme is full (' || k.max_total || ' referrals).');
        END IF;
    END IF;

    -- The first purchase: same engine as promotion codes.
    SELECT * INTO p FROM public.website_promo_codes WHERE id = k.welcome_promotion_id;
    v := public.fn_promo_evaluate(p, p_business_id, c.id, p_items, p_other_discount, p_exclude_redemption);
    IF NOT (v->>'ok')::boolean THEN RETURN v; END IF;
    RETURN v || jsonb_build_object('referral', true, 'campaignId', k.id, 'campaignName', k.name,
        'referrer', public.fn_short_name(a.name), 'referrerId', a.id,
        'welcome', public.fn_referral_reward_text(k.welcome_kind, k.welcome_value, k.welcome_product_id, k.welcome_qty),
        'referrerReward', public.fn_referral_reward_text(k.referrer_kind, k.referrer_value, k.referrer_product_id, k.referrer_qty),
        'promotionId', p.id);
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_referral_find_code(p_business_id uuid, p_code text) RETURNS public.referral_codes
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT r.* FROM public.referral_codes r
    LEFT JOIN public.referral_campaigns k ON k.business_id = r.business_id AND k.active
    WHERE r.code = public.fn_promo_norm_code(p_code)
      AND (r.business_id = p_business_id OR EXISTS (SELECT 1 FROM public.promotion_branches pb
           WHERE pb.promotion_id = k.welcome_promotion_id AND pb.business_id = p_business_id))
    ORDER BY (r.business_id = p_business_id) DESC, (r.status = 'active') DESC
    LIMIT 1
$$;

-- ============================================================================ till RPCs, now with referral codes
CREATE OR REPLACE FUNCTION public.promo_check(
    p_business_id uuid, p_code text, p_customer_id uuid, p_items jsonb, p_other_discount numeric DEFAULT 0
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
    p public.website_promo_codes;
    r public.referral_codes;
    v jsonb;
BEGIN
    PERFORM public.assert_business_member(p_business_id);
    PERFORM public.assert_permission(p_business_id, 'pos.apply_promotion');
    IF public.fn_promo_norm_code(p_code) = '' THEN
        RETURN public.fn_promo_fail('Type a code first.');
    END IF;
    p := public.fn_promo_find(p_business_id, p_code);
    IF p.id IS NOT NULL THEN
        v := public.fn_promo_evaluate(p, p_business_id, p_customer_id, p_items, p_other_discount);
        RETURN v || jsonb_build_object('code', p.code, 'name', COALESCE(p.name, p.code), 'promotionId', p.id,
                                       'summary', public.fn_promo_summary(p), 'kind', p.kind);
    END IF;
    r := public.fn_referral_find_code(p_business_id, p_code);
    IF r.id IS NOT NULL THEN
        v := public.fn_referral_evaluate(r, p_business_id, p_customer_id, p_items, p_other_discount);
        RETURN v || jsonb_build_object('code', r.code, 'name', 'Referral', 'referral', true,
            'summary', COALESCE(v->>'welcome', 'Referral'), 'kind', 'referral');
    END IF;
    RETURN public.fn_promo_fail('No promotion uses the code ' || public.fn_promo_norm_code(p_code) || '.');
END;
$$;

CREATE OR REPLACE FUNCTION public.promo_reserve(
    p_business_id uuid, p_code text, p_customer_id uuid, p_items jsonb,
    p_other_discount numeric DEFAULT 0, p_reference_id text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
    p    public.website_promo_codes;
    r    public.referral_codes;
    k    public.referral_campaigns%ROWTYPE;
    v    jsonb;
    e    public.employees;
    v_id uuid;
    v_ref uuid;
BEGIN
    PERFORM public.assert_business_member(p_business_id);
    PERFORM public.assert_permission(p_business_id, 'pos.apply_promotion');
    e := public.fn_my_employee(p_business_id);
    p := public.fn_promo_find(p_business_id, p_code);
    IF p.id IS NULL THEN
        r := public.fn_referral_find_code(p_business_id, p_code);
        IF r.id IS NULL THEN
            RAISE EXCEPTION 'No promotion uses the code %.', public.fn_promo_norm_code(p_code);
        END IF;
        -- One referral at a time per programme: the limits can't be passed by two tills.
        k := public.fn_referral_campaign(r.business_id);
        IF k.id IS NOT NULL THEN PERFORM 1 FROM public.referral_campaigns WHERE id = k.id FOR UPDATE; END IF;
        PERFORM 1 FROM public.referral_codes WHERE id = r.id FOR UPDATE;
        PERFORM 1 FROM public.website_promo_codes WHERE id = k.welcome_promotion_id FOR UPDATE;
        v := public.fn_referral_evaluate(r, p_business_id, p_customer_id, p_items, p_other_discount);
        IF NOT (v->>'ok')::boolean THEN RAISE EXCEPTION '%', v->>'reason'; END IF;
        INSERT INTO public.promotion_redemptions (promotion_id, code, business_id, channel, customer_id, staff_id, staff_name,
            status, discount, subtotal, lines, reference_id, expires_at)
        VALUES (k.welcome_promotion_id, r.code, p_business_id, 'pos', p_customer_id, e.id, e.name, 'reserved',
            (v->>'discount')::numeric, (v->>'subtotal')::numeric, v->'lines', p_reference_id, now() + interval '20 minutes')
        RETURNING id INTO v_id;
        INSERT INTO public.referrals (business_id, campaign_id, code_id, code, referrer_customer_id, referred_customer_id,
            status, redemption_id, staff_id, staff_name)
        VALUES (r.business_id, k.id, r.id, r.code, r.customer_id, p_customer_id, 'pending', v_id, e.id, e.name)
        RETURNING id INTO v_ref;
        RETURN v || jsonb_build_object('redemptionId', v_id, 'referralId', v_ref, 'code', r.code, 'name', 'Referral',
            'summary', v->>'welcome', 'expiresAt', now() + interval '20 minutes');
    END IF;

    PERFORM 1 FROM public.website_promo_codes WHERE id = p.id FOR UPDATE;
    SELECT * INTO p FROM public.website_promo_codes WHERE id = p.id;
    v := public.fn_promo_evaluate(p, p_business_id, p_customer_id, p_items, p_other_discount);
    IF NOT (v->>'ok')::boolean THEN RAISE EXCEPTION '%', v->>'reason'; END IF;
    INSERT INTO public.promotion_redemptions (promotion_id, code, business_id, channel, customer_id, staff_id, staff_name,
        status, discount, subtotal, lines, reference_id, expires_at)
    VALUES (p.id, p.code, p_business_id, 'pos', p_customer_id, e.id, e.name, 'reserved',
        (v->>'discount')::numeric, (v->>'subtotal')::numeric, v->'lines', p_reference_id, now() + interval '20 minutes')
    RETURNING id INTO v_id;
    RETURN v || jsonb_build_object('redemptionId', v_id, 'code', p.code, 'name', COALESCE(p.name, p.code),
                                   'summary', public.fn_promo_summary(p), 'expiresAt', now() + interval '20 minutes');
END;
$$;

CREATE OR REPLACE FUNCTION public.promo_release(p_redemption_id uuid) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.promotion_redemptions%ROWTYPE;
BEGIN
    SELECT * INTO r FROM public.promotion_redemptions WHERE id = p_redemption_id FOR UPDATE;
    IF NOT FOUND THEN RETURN; END IF;
    PERFORM public.assert_business_member(r.business_id);
    PERFORM public.assert_permission(r.business_id, 'pos.apply_promotion');
    UPDATE public.promotion_redemptions SET status = 'released', ended_at = now(), end_reason = 'Sale not completed'
    WHERE id = r.id AND status = 'reserved' AND transaction_id IS NULL;
    UPDATE public.referrals SET status = 'cancelled', ended_at = now(), end_reason = 'Sale not completed'
    WHERE redemption_id = r.id AND status = 'pending';
END;
$$;

-- ============================================================================ rewards: give and take back
-- Gives each side its reward once. Safe to call again: a reward that exists is left alone.
CREATE OR REPLACE FUNCTION public.fn_referral_issue(p_referral_id uuid, p_by text DEFAULT 'System') RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
    f   public.referrals%ROWTYPE;
    k   public.referral_campaigns%ROWTYPE;
    rd  public.promotion_redemptions%ROWTYPE;
    v_side text;
    v_kind text; v_value numeric; v_prod uuid; v_qty numeric; v_cust uuid;
    v_n int;
BEGIN
    SELECT * INTO f FROM public.referrals WHERE id = p_referral_id FOR UPDATE;
    IF NOT FOUND OR f.status <> 'qualified' THEN RETURN; END IF;
    SELECT * INTO k FROM public.referral_campaigns WHERE id = f.campaign_id;
    SELECT * INTO rd FROM public.promotion_redemptions WHERE id = f.redemption_id;
    IF rd.status NOT IN ('redeemed', 'partially_refunded') THEN RETURN; END IF;

    FOREACH v_side IN ARRAY ARRAY['referred', 'referrer'] LOOP
        IF v_side = 'referrer' THEN
            v_kind := k.referrer_kind; v_value := k.referrer_value; v_prod := k.referrer_product_id; v_qty := k.referrer_qty; v_cust := f.referrer_customer_id;
        ELSE
            v_kind := k.welcome_kind; v_value := k.welcome_value; v_prod := k.welcome_product_id; v_qty := k.welcome_qty; v_cust := f.referred_customer_id;
            -- A discount or free item for the new customer was taken off the first sale.
            CONTINUE WHEN v_kind IN ('amount', 'percent', 'free_product');
        END IF;
        CONTINUE WHEN EXISTS (SELECT 1 FROM public.referral_rewards WHERE referral_id = f.id AND referral_rewards.side = v_side);
        IF v_side = 'referrer' AND k.max_rewards_per_customer IS NOT NULL THEN
            SELECT count(*) INTO v_n FROM public.referral_rewards x
            WHERE x.customer_id = v_cust AND x.side = 'referrer' AND x.status NOT IN ('revoked', 'reversed');
            IF v_n >= k.max_rewards_per_customer THEN
                INSERT INTO public.referral_rewards (business_id, referral_id, campaign_id, customer_id, side, kind, value, status, ended_at, end_reason, issued_by)
                VALUES (f.business_id, f.id, k.id, v_cust, v_side, v_kind, v_value, 'revoked', now(), 'Most rewards a customer can get reached', p_by);
                CONTINUE;
            END IF;
        END IF;
        PERFORM public.fn_referral_give(f, k, v_side, v_cust, v_kind, v_value, v_prod, v_qty, p_by);
    END LOOP;
    UPDATE public.referrals SET status = 'rewarded', rewarded_at = now() WHERE id = f.id;
END;
$$;

-- One reward, given the way its kind needs.
CREATE OR REPLACE FUNCTION public.fn_referral_give(
    f public.referrals, k public.referral_campaigns, p_side text, p_cust uuid, p_kind text,
    p_value numeric, p_prod uuid, p_qty numeric, p_by text
) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
    c        public.customers%ROWTYPE;
    v_rid    uuid;
    v_promo  uuid;
    v_code   text;
    v_exp    timestamptz := CASE WHEN k.reward_expiry_days IS NOT NULL THEN now() + make_interval(days => k.reward_expiry_days) END;
    v_other  text;
BEGIN
    SELECT * INTO c FROM public.customers WHERE id = p_cust FOR UPDATE;
    SELECT name INTO v_other FROM public.customers
    WHERE id = CASE WHEN p_side = 'referrer' THEN f.referred_customer_id ELSE f.referrer_customer_id END;

    INSERT INTO public.referral_rewards (business_id, referral_id, campaign_id, customer_id, side, kind, value, points,
        product_id, qty, status, cost, expires_at, issued_by)
    VALUES (c.business_id, f.id, k.id, c.id, p_side, p_kind, CASE WHEN p_kind = 'points' THEN 0 ELSE p_value END,
        CASE WHEN p_kind = 'points' THEN p_value::int ELSE 0 END, p_prod, p_qty, 'issued',
        CASE WHEN p_kind = 'wallet' THEN p_value ELSE 0 END,
        CASE WHEN p_kind IN ('amount', 'percent', 'free_product') THEN v_exp END, p_by)
    ON CONFLICT (referral_id, side) DO NOTHING
    RETURNING id INTO v_rid;
    IF v_rid IS NULL THEN RETURN; END IF;   -- given already

    IF p_kind = 'wallet' THEN
        UPDATE public.customers SET wallet_balance = wallet_balance + p_value WHERE id = c.id;
        INSERT INTO public.wallet_transactions (business_id, customer_id, amount, balance_before, balance_after, reason, recorded_by)
        VALUES (c.business_id, c.id, p_value, c.wallet_balance, c.wallet_balance + p_value,
                'Referral reward (' || public.fn_short_name(v_other) || ')', p_by);
        INSERT INTO public.customer_ledger (business_id, customer_id, type, amount, wallet_balance, debt_balance, recorded_by, note, reference_id)
        VALUES (c.business_id, c.id, 'referral_reward', p_value, c.wallet_balance + p_value, c.debt_balance, p_by,
                'Referral reward: wallet credit', 'referral-' || v_rid::text);
    ELSIF p_kind = 'points' THEN
        IF NOT public.fn_points_on(c.business_id) THEN
            UPDATE public.referral_rewards SET status = 'revoked', ended_at = now(), end_reason = 'Points are switched off' WHERE id = v_rid;
            RETURN;
        END IF;
        UPDATE public.customers SET loyalty_points = loyalty_points + p_value::int WHERE id = c.id;
        INSERT INTO public.loyalty_points_earned (business_id, customer_id, points, source, amount)
        VALUES (c.business_id, c.id, p_value::int, 'referral', 0);
    ELSE
        -- A personal code, used once by this customer at the till.
        v_code := public.fn_promo_new_code(c.business_id, 'RW');
        INSERT INTO public.website_promo_codes (business_id, code, name, description, promo_type, kind, value, min_order,
            starts_at, ends_at, max_uses, once_per_customer, stackable, audience, product_scope, reward_product_id, reward_qty,
            use_pos, use_online, active, origin, created_by, updated_by)
        VALUES (c.business_id, v_code, 'Referral reward', 'Thank you for referring ' || public.fn_short_name(v_other) || '.',
            'customer', CASE p_kind WHEN 'free_product' THEN 'free_items' ELSE p_kind END,
            CASE WHEN p_kind = 'free_product' THEN 0 ELSE p_value END, 0, now(), v_exp, 1, true, false, 'selected', 'all',
            CASE WHEN p_kind = 'free_product' THEN p_prod END, CASE WHEN p_kind = 'free_product' THEN p_qty END,
            true, false, true, 'referral_reward', p_by, p_by)
        RETURNING id INTO v_promo;
        INSERT INTO public.promotion_customers (promotion_id, customer_id) VALUES (v_promo, c.id);
        UPDATE public.referral_rewards SET promotion_id = v_promo WHERE id = v_rid;
    END IF;
END;
$$;

-- Takes a reward back as far as it still can (the sale it came from was undone).
CREATE OR REPLACE FUNCTION public.fn_referral_take_back(p_reward_id uuid, p_reason text, p_by text DEFAULT 'System') RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
    w  public.referral_rewards%ROWTYPE;
    c  public.customers%ROWTYPE;
    v_back numeric;
    v_pts int;
BEGIN
    SELECT * INTO w FROM public.referral_rewards WHERE id = p_reward_id FOR UPDATE;
    IF NOT FOUND OR w.status IN ('revoked', 'reversed', 'expired') THEN RETURN; END IF;
    IF w.kind = 'wallet' THEN
        SELECT * INTO c FROM public.customers WHERE id = w.customer_id FOR UPDATE;
        v_back := LEAST(w.value, c.wallet_balance);       -- what wasn't spent yet
        IF v_back > 0 THEN
            UPDATE public.customers SET wallet_balance = wallet_balance - v_back WHERE id = c.id;
            INSERT INTO public.wallet_transactions (business_id, customer_id, amount, balance_before, balance_after, reason, recorded_by)
            VALUES (c.business_id, c.id, -v_back, c.wallet_balance, c.wallet_balance - v_back, 'Referral reward taken back: ' || p_reason, p_by);
            INSERT INTO public.customer_ledger (business_id, customer_id, type, amount, wallet_balance, debt_balance, recorded_by, note, reference_id)
            VALUES (c.business_id, c.id, 'referral_reversal', v_back, c.wallet_balance - v_back, c.debt_balance, p_by,
                    'Referral reward taken back: ' || p_reason, 'referral-back-' || w.id::text);
        END IF;
        UPDATE public.referral_rewards SET status = 'reversed', reversed_amount = COALESCE(v_back, 0),
            cost = w.value - COALESCE(v_back, 0), ended_at = now(), end_reason = p_reason WHERE id = w.id;
    ELSIF w.kind = 'points' THEN
        SELECT * INTO c FROM public.customers WHERE id = w.customer_id FOR UPDATE;
        v_pts := LEAST(w.points, c.loyalty_points);
        UPDATE public.customers SET loyalty_points = loyalty_points - v_pts WHERE id = c.id;
        UPDATE public.referral_rewards SET status = 'reversed', reversed_amount = v_pts, ended_at = now(), end_reason = p_reason WHERE id = w.id;
    ELSIF w.kind IN ('amount', 'percent', 'free_product') THEN
        IF w.status = 'used' THEN RETURN; END IF;           -- already spent at a sale: the sale keeps it
        UPDATE public.website_promo_codes SET active = false, archived_at = now() WHERE id = w.promotion_id;
        UPDATE public.referral_rewards SET status = 'revoked', ended_at = now(), end_reason = p_reason WHERE id = w.id;
    ELSIF w.kind = 'discount_at_sale' THEN
        UPDATE public.referral_rewards SET status = 'reversed', cost = 0, ended_at = now(), end_reason = p_reason WHERE id = w.id;
    END IF;
END;
$$;

-- ============================================================================ hooks from the sale
-- A sale with a promotion was saved.
CREATE OR REPLACE FUNCTION public.fn_promo_after_redeem(p_redemption_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    rd  public.promotion_redemptions%ROWTYPE;
    t   public.transactions%ROWTYPE;
    f   public.referrals%ROWTYPE;
    k   public.referral_campaigns%ROWTYPE;
    v_flags text[] := '{}';
    v_net numeric;
    v_min numeric;
BEGIN
    SELECT * INTO rd FROM public.promotion_redemptions WHERE id = p_redemption_id;
    SELECT * INTO t FROM public.transactions WHERE id = rd.transaction_id;

    -- A referral reward code was used.
    UPDATE public.referral_rewards SET status = 'used', used_at = now(), used_transaction_id = t.id, cost = rd.discount
    WHERE promotion_id = rd.promotion_id AND status = 'issued';

    -- The first purchase of a referred customer.
    SELECT * INTO f FROM public.referrals WHERE redemption_id = rd.id FOR UPDATE;
    IF NOT FOUND THEN RETURN; END IF;
    IF f.status NOT IN ('pending', 'expired') THEN
        RAISE EXCEPTION 'This referral was already % . Apply the code again.', f.status;
    END IF;
    SELECT * INTO k FROM public.referral_campaigns WHERE id = f.campaign_id;
    SELECT min_order INTO v_min FROM public.website_promo_codes WHERE id = k.welcome_promotion_id;
    v_net := t.final_total - t.tax - t.delivery_fee;

    -- Signs worth a second look (fraud monitoring).
    IF (SELECT count(*) FROM public.referrals x WHERE x.referrer_customer_id = f.referrer_customer_id
        AND x.status IN ('qualified', 'rewarded') AND x.qualified_at > now() - interval '24 hours') >= 2 THEN
        v_flags := array_append(v_flags, 'many_in_a_day');
    END IF;
    IF f.staff_id IS NOT NULL AND (SELECT count(*) FROM public.referrals x WHERE x.referrer_customer_id = f.referrer_customer_id
        AND x.staff_id = f.staff_id AND x.status IN ('qualified', 'rewarded')) >= 2 THEN
        v_flags := array_append(v_flags, 'same_cashier_again');
    END IF;
    IF v_min > 0 AND rd.subtotal < v_min * 1.1 THEN
        v_flags := array_append(v_flags, 'just_over_minimum');
    END IF;
    IF (SELECT created_at FROM public.customers WHERE id = f.referred_customer_id) > now() - interval '15 minutes' THEN
        v_flags := array_append(v_flags, 'added_at_the_till');
    END IF;
    IF EXISTS (SELECT 1 FROM public.customers a JOIN public.customers c ON c.id = f.referred_customer_id
               WHERE a.id = f.referrer_customer_id
                 AND right(public.fn_phone_key(a.phone), 6) = right(public.fn_phone_key(c.phone), 6)) THEN
        v_flags := array_append(v_flags, 'similar_phone');
    END IF;

    UPDATE public.referrals SET status = 'qualified', transaction_id = t.id, purchase_amount = v_net,
        welcome_discount = rd.discount, qualified_at = now(), flags = v_flags,
        reward_due_at = now() + make_interval(days => k.hold_days), ended_at = NULL, end_reason = NULL
    WHERE id = f.id;
    IF rd.discount > 0 THEN
        INSERT INTO public.referral_rewards (business_id, referral_id, campaign_id, customer_id, side, kind, value, status, cost,
            used_at, used_transaction_id, issued_by)
        VALUES (f.business_id, f.id, k.id, f.referred_customer_id, 'referred', 'discount_at_sale', rd.discount, 'used', rd.discount,
            now(), t.id, COALESCE(t.staff_name, 'Till'))
        ON CONFLICT (referral_id, side) DO NOTHING;
    END IF;
    IF k.hold_days = 0 AND NOT (k.review_flagged AND cardinality(v_flags) > 0) THEN
        PERFORM public.fn_referral_issue(f.id, 'Till');
    END IF;
END;
$$;

-- A sale with a promotion was cancelled or refunded.
CREATE OR REPLACE FUNCTION public.fn_promo_after_end(p_redemption_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    rd  public.promotion_redemptions%ROWTYPE;
    f   public.referrals%ROWTYPE;
    w   public.referral_rewards%ROWTYPE;
    v_min numeric;
    v_reason text;
BEGIN
    SELECT * INTO rd FROM public.promotion_redemptions WHERE id = p_redemption_id;
    -- A reward code's sale undone: the code can be used again.
    IF rd.status IN ('cancelled', 'refunded') THEN
        UPDATE public.referral_rewards SET status = 'issued', used_at = NULL, used_transaction_id = NULL, cost = 0
        WHERE promotion_id = rd.promotion_id AND status = 'used' AND used_transaction_id = rd.transaction_id AND kind <> 'discount_at_sale';
    END IF;

    SELECT * INTO f FROM public.referrals WHERE redemption_id = rd.id FOR UPDATE;
    IF NOT FOUND OR f.status NOT IN ('pending', 'qualified', 'rewarded') THEN RETURN; END IF;
    IF rd.status = 'partially_refunded' THEN
        SELECT p.min_order INTO v_min FROM public.referral_campaigns k JOIN public.website_promo_codes p ON p.id = k.welcome_promotion_id
        WHERE k.id = f.campaign_id;
        IF COALESCE(rd.sale_total, 0) - rd.refunded_amount >= COALESCE(v_min, 0) THEN RETURN; END IF;
        v_reason := 'First purchase refunded below the minimum';
    ELSIF rd.status = 'refunded' THEN v_reason := 'First purchase refunded';
    ELSIF rd.status = 'cancelled' THEN v_reason := 'First purchase cancelled';
    ELSE RETURN;
    END IF;
    FOR w IN SELECT * FROM public.referral_rewards WHERE referral_id = f.id LOOP
        PERFORM public.fn_referral_take_back(w.id, v_reason);
    END LOOP;
    UPDATE public.referrals SET status = 'cancelled', ended_at = now(), end_reason = v_reason,
        flags = CASE WHEN f.status = 'rewarded' THEN array_append(flags, 'refunded_after_reward') ELSE flags END
    WHERE id = f.id;
END;
$$;

-- ============================================================================ the timed jobs
-- Rewards that waited long enough; held uses and reward codes that ran out.
CREATE OR REPLACE FUNCTION public.run_referral_jobs() RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
    f  record;
    n  int := 0;
BEGIN
    UPDATE public.promotion_redemptions SET status = 'expired', ended_at = now(), end_reason = 'Hold timed out'
    WHERE status = 'reserved' AND expires_at < now();
    UPDATE public.referrals x SET status = 'expired', ended_at = now(), end_reason = 'The sale was never finished'
    FROM public.promotion_redemptions r
    WHERE x.redemption_id = r.id AND x.status = 'pending' AND r.status IN ('expired', 'released');
    UPDATE public.referral_rewards SET status = 'expired', ended_at = now(), end_reason = 'Not used in time'
    WHERE status = 'issued' AND expires_at IS NOT NULL AND expires_at < now();

    FOR f IN SELECT x.id FROM public.referrals x
             JOIN public.referral_campaigns k ON k.id = x.campaign_id
             JOIN public.referral_codes c ON c.id = x.code_id
             WHERE x.status = 'qualified' AND x.reward_due_at <= now()
               AND c.status = 'active' AND NOT (k.review_flagged AND cardinality(x.flags) > 0)
    LOOP
        PERFORM public.fn_referral_issue(f.id, 'System');
        n := n + 1;
    END LOOP;
    RETURN n;
END;
$$;

DO $do$ BEGIN
    IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
        PERFORM cron.unschedule('expire-promotion-holds') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'expire-promotion-holds');
        PERFORM cron.schedule('referral-and-promotion-jobs', '*/10 * * * *', $job$SELECT public.run_referral_jobs()$job$);
    END IF;
END $do$;

-- ============================================================================ managing
-- p_doc: name, description, active, startsAt, endsAt, referrerKind, referrerValue,
-- referrerProductId, referrerQty, welcomeKind, welcomeValue, welcomeProductId, welcomeQty,
-- minPurchase, maxDiscount, productScope, productIds[], categories[], branchIds[], stackable,
-- maxPerReferrer, maxTotal, maxRewardsPerCustomer, rewardExpiryDays, holdDays,
-- excludeExisting, newCustomerDays, requirePhone, reviewFlagged.
CREATE OR REPLACE FUNCTION public.save_referral_campaign(p_business_id uuid, p_id uuid, p_doc jsonb) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
    d       jsonb := COALESCE(p_doc, '{}'::jsonb);
    k       public.referral_campaigns%ROWTYPE;
    v_by    text;
    v_wk    text := d->>'welcomeKind';
    v_rk    text := d->>'referrerKind';
    v_promo uuid;
    v_id    uuid;
    v_scope text := COALESCE(d->>'productScope', 'all');
    v_active boolean := COALESCE((d->>'active')::boolean, true);
BEGIN
    PERFORM public.assert_business_member(p_business_id);
    PERFORM public.assert_permission(p_business_id, 'referrals.manage');
    v_by := COALESCE((public.fn_my_employee(p_business_id)).name, 'Staff');
    IF NULLIF(trim(COALESCE(d->>'name', '')), '') IS NULL THEN RAISE EXCEPTION 'Give the programme a name.'; END IF;
    IF v_rk NOT IN ('amount', 'percent', 'wallet', 'free_product', 'points') THEN RAISE EXCEPTION 'Choose what the person who refers gets.'; END IF;
    IF v_wk NOT IN ('amount', 'percent', 'wallet', 'free_product', 'points') THEN RAISE EXCEPTION 'Choose what the new customer gets.'; END IF;
    IF v_rk <> 'free_product' AND COALESCE(NULLIF(d->>'referrerValue', '')::numeric, 0) <= 0 THEN RAISE EXCEPTION 'Type how much the person who refers gets.'; END IF;
    IF v_wk <> 'free_product' AND COALESCE(NULLIF(d->>'welcomeValue', '')::numeric, 0) <= 0 THEN RAISE EXCEPTION 'Type how much the new customer gets.'; END IF;
    IF v_rk = 'free_product' AND (NULLIF(d->>'referrerProductId', '') IS NULL OR COALESCE(NULLIF(d->>'referrerQty', '')::numeric, 0) <= 0) THEN
        RAISE EXCEPTION 'Choose the free product and how many for the person who refers.'; END IF;
    IF v_wk = 'free_product' AND (NULLIF(d->>'welcomeProductId', '') IS NULL OR COALESCE(NULLIF(d->>'welcomeQty', '')::numeric, 0) <= 0) THEN
        RAISE EXCEPTION 'Choose the free product and how many for the new customer.'; END IF;
    IF (v_rk = 'percent' AND (d->>'referrerValue')::numeric > 90) OR (v_wk = 'percent' AND (d->>'welcomeValue')::numeric > 90) THEN
        RAISE EXCEPTION 'A percentage is between 1 and 90.'; END IF;
    IF (v_rk = 'points' OR v_wk = 'points') AND NOT public.fn_points_on(p_business_id) THEN
        RAISE EXCEPTION 'Loyalty points are switched off. Switch them on, or choose another reward.'; END IF;
    IF v_scope NOT IN ('all', 'products', 'categories') THEN RAISE EXCEPTION 'Choose what the first purchase must include.'; END IF;

    IF p_id IS NOT NULL THEN
        SELECT * INTO k FROM public.referral_campaigns WHERE id = p_id AND business_id = p_business_id FOR UPDATE;
        IF NOT FOUND THEN RAISE EXCEPTION 'That programme was not found.'; END IF;
        IF k.archived_at IS NOT NULL THEN RAISE EXCEPTION 'That programme was ended. Start a new one.'; END IF;
        v_promo := k.welcome_promotion_id;
    END IF;
    -- Starting a programme ends the one running (one at a time per branch).
    IF v_active THEN
        UPDATE public.referral_campaigns SET active = false, updated_at = now(), updated_by = v_by
        WHERE business_id = p_business_id AND active AND id IS DISTINCT FROM p_id;
    END IF;

    -- The hidden first-purchase rules.
    IF v_promo IS NULL THEN
        INSERT INTO public.website_promo_codes (business_id, code, name, promo_type, kind, value, audience, use_pos, use_online,
            origin, active, created_by)
        VALUES (p_business_id, public.fn_promo_new_code(p_business_id, 'REFW'), 'Referral welcome', 'referral', 'none', 0,
            'referral', true, false, 'referral_welcome', true, v_by)
        RETURNING id INTO v_promo;
    END IF;
    UPDATE public.website_promo_codes SET
        name = 'Referral welcome: ' || trim(d->>'name'),
        kind = CASE v_wk WHEN 'amount' THEN 'amount' WHEN 'percent' THEN 'percent' WHEN 'free_product' THEN 'free_items' ELSE 'none' END,
        value = CASE WHEN v_wk IN ('amount', 'percent') THEN (d->>'welcomeValue')::numeric ELSE 0 END,
        reward_product_id = CASE WHEN v_wk = 'free_product' THEN (d->>'welcomeProductId')::uuid END,
        reward_qty = CASE WHEN v_wk = 'free_product' THEN (d->>'welcomeQty')::numeric END,
        min_order = COALESCE(NULLIF(d->>'minPurchase', '')::numeric, 0),
        max_discount = NULLIF(NULLIF(d->>'maxDiscount', '')::numeric, 0),
        starts_at = NULLIF(d->>'startsAt', '')::timestamptz, ends_at = NULLIF(d->>'endsAt', '')::timestamptz,
        product_scope = v_scope, stackable = COALESCE((d->>'stackable')::boolean, false),
        active = v_active, updated_by = v_by, updated_at = now()
    WHERE id = v_promo;
    DELETE FROM public.promotion_products WHERE promotion_id = v_promo;
    DELETE FROM public.promotion_categories WHERE promotion_id = v_promo;
    DELETE FROM public.promotion_branches WHERE promotion_id = v_promo;
    IF v_scope = 'products' THEN
        INSERT INTO public.promotion_products (promotion_id, product_id)
        SELECT DISTINCT v_promo, pr.id FROM jsonb_array_elements_text(COALESCE(d->'productIds', '[]')) x
        JOIN public.products pr ON pr.id = x::uuid AND pr.business_id = p_business_id;
    ELSIF v_scope = 'categories' THEN
        INSERT INTO public.promotion_categories (promotion_id, category)
        SELECT DISTINCT v_promo, trim(x) FROM jsonb_array_elements_text(COALESCE(d->'categories', '[]')) x WHERE trim(x) <> '';
    END IF;
    INSERT INTO public.promotion_branches (promotion_id, business_id)
    SELECT DISTINCT v_promo, x::uuid FROM jsonb_array_elements_text(COALESCE(d->'branchIds', '[]')) x
    WHERE x::uuid <> p_business_id AND public.fn_branches_share_owner(p_business_id, x::uuid);

    IF p_id IS NULL THEN
        INSERT INTO public.referral_campaigns (business_id, name, welcome_promotion_id, active, created_by,
            referrer_kind, referrer_value, referrer_product_id, referrer_qty, welcome_kind, welcome_value, welcome_product_id, welcome_qty)
        VALUES (p_business_id, trim(d->>'name'), v_promo, false, v_by,
            v_rk, CASE WHEN v_rk = 'free_product' THEN 0 ELSE (d->>'referrerValue')::numeric END,
            CASE WHEN v_rk = 'free_product' THEN (d->>'referrerProductId')::uuid END, CASE WHEN v_rk = 'free_product' THEN (d->>'referrerQty')::numeric END,
            v_wk, CASE WHEN v_wk = 'free_product' THEN 0 ELSE (d->>'welcomeValue')::numeric END,
            CASE WHEN v_wk = 'free_product' THEN (d->>'welcomeProductId')::uuid END, CASE WHEN v_wk = 'free_product' THEN (d->>'welcomeQty')::numeric END)
        RETURNING id INTO v_id;
    ELSE
        v_id := p_id;
    END IF;
    UPDATE public.referral_campaigns SET
        name = trim(d->>'name'), description = NULLIF(trim(COALESCE(d->>'description', '')), ''), active = v_active,
        starts_at = NULLIF(d->>'startsAt', '')::timestamptz, ends_at = NULLIF(d->>'endsAt', '')::timestamptz,
        referrer_kind = v_rk, referrer_value = CASE WHEN v_rk = 'free_product' THEN 0 ELSE (d->>'referrerValue')::numeric END,
        referrer_product_id = CASE WHEN v_rk = 'free_product' THEN (d->>'referrerProductId')::uuid END,
        referrer_qty = CASE WHEN v_rk = 'free_product' THEN (d->>'referrerQty')::numeric END,
        welcome_kind = v_wk, welcome_value = CASE WHEN v_wk = 'free_product' THEN 0 ELSE (d->>'welcomeValue')::numeric END,
        welcome_product_id = CASE WHEN v_wk = 'free_product' THEN (d->>'welcomeProductId')::uuid END,
        welcome_qty = CASE WHEN v_wk = 'free_product' THEN (d->>'welcomeQty')::numeric END,
        max_per_referrer = NULLIF(d->>'maxPerReferrer', '')::int, max_total = NULLIF(d->>'maxTotal', '')::int,
        max_rewards_per_customer = NULLIF(d->>'maxRewardsPerCustomer', '')::int,
        reward_expiry_days = NULLIF(d->>'rewardExpiryDays', '')::int,
        hold_days = COALESCE(NULLIF(d->>'holdDays', '')::int, 3),
        exclude_existing = COALESCE((d->>'excludeExisting')::boolean, true),
        new_customer_days = COALESCE(NULLIF(d->>'newCustomerDays', '')::int, 30),
        require_phone = COALESCE((d->>'requirePhone')::boolean, true),
        review_flagged = COALESCE((d->>'reviewFlagged')::boolean, true),
        updated_by = v_by, updated_at = now()
    WHERE id = v_id;
    RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.end_referral_campaign(p_id uuid) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE k public.referral_campaigns%ROWTYPE;
BEGIN
    SELECT * INTO k FROM public.referral_campaigns WHERE id = p_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'That programme was not found.'; END IF;
    PERFORM public.assert_business_member(k.business_id);
    PERFORM public.assert_permission(k.business_id, 'referrals.manage');
    UPDATE public.referral_campaigns SET active = false, archived_at = now(), updated_at = now() WHERE id = p_id;
    UPDATE public.website_promo_codes SET active = false WHERE id = k.welcome_promotion_id;
END;
$$;

-- Suspend (hold: no new uses, no rewards paid), revoke (for good) or restore a code.
CREATE OR REPLACE FUNCTION public.set_referral_code_status(p_code_id uuid, p_status text, p_reason text) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.referral_codes%ROWTYPE;
BEGIN
    SELECT * INTO r FROM public.referral_codes WHERE id = p_code_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'That referral code was not found.'; END IF;
    PERFORM public.assert_business_member(r.business_id);
    PERFORM public.assert_permission(r.business_id, 'referrals.manage');
    IF p_status NOT IN ('active', 'suspended', 'revoked') THEN RAISE EXCEPTION 'Unknown status %.', p_status; END IF;
    IF r.status = 'revoked' THEN RAISE EXCEPTION 'A revoked code stays revoked. The customer can get a new one.'; END IF;
    IF p_status <> 'active' AND NULLIF(trim(COALESCE(p_reason, '')), '') IS NULL THEN RAISE EXCEPTION 'Say why.'; END IF;
    UPDATE public.referral_codes SET status = p_status, status_reason = NULLIF(trim(p_reason), ''),
        status_by = COALESCE((public.fn_my_employee(r.business_id)).name, 'Staff'), status_at = now()
    WHERE id = r.id;
END;
$$;

-- A manager's call on a qualified referral: pay the rewards now, or refuse them.
CREATE OR REPLACE FUNCTION public.decide_referral(p_referral_id uuid, p_approve boolean, p_reason text DEFAULT NULL) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
    f public.referrals%ROWTYPE;
    w public.referral_rewards%ROWTYPE;
    v_by text;
BEGIN
    SELECT * INTO f FROM public.referrals WHERE id = p_referral_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'That referral was not found.'; END IF;
    PERFORM public.assert_business_member(f.business_id);
    PERFORM public.assert_permission(f.business_id, 'referrals.manage');
    v_by := COALESCE((public.fn_my_employee(f.business_id)).name, 'Staff');
    IF f.status <> 'qualified' THEN RAISE EXCEPTION 'Only a referral waiting for its rewards can be decided (this one is %).', f.status; END IF;
    IF p_approve THEN
        UPDATE public.referrals SET decided_by = v_by WHERE id = f.id;
        PERFORM public.fn_referral_issue(f.id, v_by);
    ELSE
        IF NULLIF(trim(COALESCE(p_reason, '')), '') IS NULL THEN RAISE EXCEPTION 'Say why the rewards are refused.'; END IF;
        FOR w IN SELECT * FROM public.referral_rewards WHERE referral_id = f.id AND kind <> 'discount_at_sale' LOOP
            PERFORM public.fn_referral_take_back(w.id, p_reason, v_by);
        END LOOP;
        UPDATE public.referrals SET status = 'rejected', ended_at = now(), end_reason = trim(p_reason), decided_by = v_by WHERE id = f.id;
    END IF;
END;
$$;

-- ============================================================================ reading
-- A customer's code and how it's doing (staff screen). Makes the code if a programme runs.
CREATE OR REPLACE FUNCTION public.customer_referral(p_customer_id uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
    c public.customers%ROWTYPE;
    r public.referral_codes%ROWTYPE;
    k public.referral_campaigns%ROWTYPE;
BEGIN
    SELECT * INTO c FROM public.customers WHERE id = p_customer_id AND deleted_at IS NULL;
    IF NOT FOUND THEN RAISE EXCEPTION 'That customer was not found.'; END IF;
    PERFORM public.assert_business_member(c.business_id);
    PERFORM public.assert_permission(c.business_id, 'customers.view');
    k := public.fn_referral_campaign(c.business_id);
    SELECT * INTO r FROM public.referral_codes WHERE customer_id = c.id AND status <> 'revoked';
    IF r.id IS NULL AND k.id IS NOT NULL THEN r := public.fn_referral_code_for(c.id); END IF;
    RETURN public.fn_referral_summary(c, r, k);
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_referral_summary(c public.customers, r public.referral_codes, k public.referral_campaigns)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT jsonb_build_object(
        'code', r.code, 'codeId', r.id, 'codeStatus', r.status, 'codeReason', r.status_reason,
        'campaign', CASE WHEN k.id IS NULL THEN NULL ELSE jsonb_build_object('name', k.name, 'endsAt', k.ends_at,
            'youGet', public.fn_referral_reward_text(k.referrer_kind, k.referrer_value, k.referrer_product_id, k.referrer_qty),
            'friendGets', public.fn_referral_reward_text(k.welcome_kind, k.welcome_value, k.welcome_product_id, k.welcome_qty),
            'minPurchase', (SELECT min_order FROM public.website_promo_codes WHERE id = k.welcome_promotion_id)) END,
        'invited', (SELECT count(*) FROM public.referrals x WHERE x.referrer_customer_id = c.id AND x.status <> 'cancelled'),
        'successful', (SELECT count(*) FROM public.referrals x WHERE x.referrer_customer_id = c.id AND x.status = 'rewarded'),
        'pending', (SELECT count(*) FROM public.referrals x WHERE x.referrer_customer_id = c.id AND x.status IN ('pending', 'qualified')),
        'rewardsEarned', (SELECT count(*) FROM public.referral_rewards w WHERE w.customer_id = c.id AND w.side = 'referrer' AND w.status IN ('issued', 'used')),
        'rewardsAvailable', COALESCE((SELECT jsonb_agg(jsonb_build_object('kind', w.kind, 'what',
                public.fn_referral_reward_text(w.kind, CASE WHEN w.kind = 'points' THEN w.points ELSE w.value END, w.product_id, w.qty),
                'code', p.code, 'expiresAt', w.expires_at) ORDER BY w.issued_at DESC)
            FROM public.referral_rewards w LEFT JOIN public.website_promo_codes p ON p.id = w.promotion_id
            WHERE w.customer_id = c.id AND w.side = 'referrer' AND w.status = 'issued' AND w.kind IN ('amount', 'percent', 'free_product')), '[]'),
        'rewardsUsed', (SELECT count(*) FROM public.referral_rewards w WHERE w.customer_id = c.id AND w.side = 'referrer'
            AND (w.status = 'used' OR (w.status = 'issued' AND w.kind IN ('wallet', 'points')))),
        'walletEarned', (SELECT COALESCE(SUM(w.value - w.reversed_amount), 0) FROM public.referral_rewards w
            WHERE w.customer_id = c.id AND w.side = 'referrer' AND w.kind = 'wallet' AND w.status IN ('issued', 'reversed')),
        'pointsEarned', (SELECT COALESCE(SUM(w.points), 0) FROM public.referral_rewards w
            WHERE w.customer_id = c.id AND w.side = 'referrer' AND w.kind = 'points' AND w.status = 'issued'),
        -- Friends by first name and initial only.
        'friends', COALESCE((SELECT jsonb_agg(jsonb_build_object('name', public.fn_short_name(f.name), 'status', x.status, 'at', x.created_at)
                ORDER BY x.created_at DESC)
            FROM (SELECT * FROM public.referrals x WHERE x.referrer_customer_id = c.id AND x.status <> 'cancelled'
                  ORDER BY x.created_at DESC LIMIT 20) x
            JOIN public.customers f ON f.id = x.referred_customer_id), '[]'))
$$;

-- The signed-in website customer's own referral page.
CREATE OR REPLACE FUNCTION public.my_referral(p_slug text) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_b  uuid;
    c    public.customers%ROWTYPE;
    r    public.referral_codes%ROWTYPE;
    k    public.referral_campaigns%ROWTYPE;
BEGIN
    IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Please sign in first.'; END IF;
    SELECT id INTO v_b FROM public.businesses WHERE website_slug = p_slug AND deleted_at IS NULL;
    IF v_b IS NULL THEN RAISE EXCEPTION 'Shop not found.'; END IF;
    SELECT * INTO c FROM public.customers WHERE id = public.fn_account_customer(auth.uid(), v_b) AND deleted_at IS NULL;
    k := public.fn_referral_campaign(v_b);
    IF c.id IS NULL THEN
        RETURN jsonb_build_object('linked', false, 'running', k.id IS NOT NULL);
    END IF;
    SELECT * INTO r FROM public.referral_codes WHERE customer_id = c.id AND status <> 'revoked';
    IF r.id IS NULL AND k.id IS NOT NULL THEN r := public.fn_referral_code_for(c.id); END IF;
    RETURN jsonb_build_object('linked', true, 'running', k.id IS NOT NULL) || public.fn_referral_summary(c, r, k);
END;
$$;

-- Management view of the programme for a period.
CREATE OR REPLACE FUNCTION public.referral_dashboard(p_business_id uuid, p_from date, p_to date) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_from timestamptz := (p_from::timestamp AT TIME ZONE 'Africa/Nairobi');
    v_to   timestamptz := ((p_to + 1)::timestamp AT TIME ZONE 'Africa/Nairobi');
    k      public.referral_campaigns%ROWTYPE;
    v_res  jsonb;
BEGIN
    PERFORM public.assert_business_member(p_business_id);
    PERFORM public.assert_permission(p_business_id, 'referrals.view', 'referrals.manage');
    k := public.fn_referral_campaign(p_business_id);
    WITH x AS (SELECT * FROM public.referrals WHERE business_id = p_business_id AND created_at >= v_from AND created_at < v_to
                  AND NOT (status = 'cancelled' AND end_reason = 'Sale not completed')),
         w AS (SELECT * FROM public.referral_rewards WHERE business_id = p_business_id AND issued_at >= v_from AND issued_at < v_to)
    SELECT jsonb_build_object(
        'campaign', CASE WHEN k.id IS NULL THEN NULL ELSE (to_jsonb(k) - 'business_id') || jsonb_build_object(
            'welcome', (SELECT jsonb_build_object('minPurchase', p.min_order, 'maxDiscount', p.max_discount, 'stackable', p.stackable,
                    'productScope', p.product_scope,
                    'productIds', COALESCE((SELECT jsonb_agg(product_id) FROM public.promotion_products WHERE promotion_id = p.id), '[]'),
                    'categories', COALESCE((SELECT jsonb_agg(category) FROM public.promotion_categories WHERE promotion_id = p.id), '[]'),
                    'branchIds', COALESCE((SELECT jsonb_agg(business_id) FROM public.promotion_branches WHERE promotion_id = p.id), '[]'))
                FROM public.website_promo_codes p WHERE p.id = k.welcome_promotion_id),
            'referrerText', public.fn_referral_reward_text(k.referrer_kind, k.referrer_value, k.referrer_product_id, k.referrer_qty),
            'welcomeText', public.fn_referral_reward_text(k.welcome_kind, k.welcome_value, k.welcome_product_id, k.welcome_qty)) END,
        'counts', (SELECT jsonb_build_object('total', count(*),
            'pending', count(*) FILTER (WHERE status = 'pending'), 'qualified', count(*) FILTER (WHERE status = 'qualified'),
            'rewarded', count(*) FILTER (WHERE status = 'rewarded'), 'rejected', count(*) FILTER (WHERE status = 'rejected'),
            'cancelled', count(*) FILTER (WHERE status = 'cancelled'), 'expired', count(*) FILTER (WHERE status = 'expired'),
            'flagged', count(*) FILTER (WHERE status = 'qualified' AND cardinality(flags) > 0),
            'firstPurchases', COALESCE(SUM(purchase_amount) FILTER (WHERE status IN ('qualified', 'rewarded')), 0)) FROM x),
        'costs', (SELECT jsonb_build_object(
            'wallet', COALESCE(SUM(cost) FILTER (WHERE kind = 'wallet'), 0),
            'welcomeDiscounts', COALESCE(SUM(cost) FILTER (WHERE kind = 'discount_at_sale'), 0),
            'rewardCodesUsed', COALESCE(SUM(cost) FILTER (WHERE kind IN ('amount', 'percent', 'free_product') AND status = 'used'), 0),
            'rewardCodesOpen', count(*) FILTER (WHERE kind IN ('amount', 'percent', 'free_product') AND status = 'issued'),
            'points', COALESCE(SUM(points) FILTER (WHERE kind = 'points' AND status = 'issued'), 0),
            'takenBack', COALESCE(SUM(reversed_amount) FILTER (WHERE kind = 'wallet'), 0),
            'total', COALESCE(SUM(cost), 0)) FROM w),
        -- What referred customers have bought since they came (not extra sales caused by it).
        'referredSales', (SELECT COALESCE(SUM(t.final_total - t.tax - t.delivery_fee), 0) FROM public.transactions t
            JOIN public.referrals y ON y.referred_customer_id = t.customer_id AND y.status IN ('qualified', 'rewarded')
            WHERE y.business_id = p_business_id AND t.deleted_at IS NULL AND t.timestamp >= y.created_at
              AND t.timestamp >= v_from AND t.timestamp < v_to),
        'topReferrers', COALESCE((SELECT jsonb_agg(z ORDER BY (z->>'rewarded')::int DESC, (z->>'referrals')::int DESC) FROM (
            SELECT jsonb_build_object('customerId', a.id, 'name', a.name, 'code', rc.code, 'codeId', rc.id, 'codeStatus', rc.status,
                'referrals', count(*), 'rewarded', count(*) FILTER (WHERE x.status = 'rewarded'),
                'flagged', count(*) FILTER (WHERE cardinality(x.flags) > 0),
                'cost', COALESCE((SELECT SUM(cost) FROM public.referral_rewards w2 WHERE w2.customer_id = a.id AND w2.side = 'referrer'), 0)) AS z
            FROM x JOIN public.customers a ON a.id = x.referrer_customer_id
            LEFT JOIN public.referral_codes rc ON rc.id = x.code_id
            GROUP BY a.id, a.name, rc.code, rc.id, rc.status LIMIT 20) s), '[]'),
        'referrals', COALESCE((SELECT jsonb_agg(z ORDER BY z->>'at' DESC) FROM (
            SELECT jsonb_build_object('id', x.id, 'at', x.created_at, 'status', x.status, 'code', x.code,
                'referrer', a.name, 'referred', c.name, 'purchase', x.purchase_amount, 'welcomeDiscount', x.welcome_discount,
                'flags', to_jsonb(x.flags), 'staff', x.staff_name, 'rewardDueAt', x.reward_due_at, 'endReason', x.end_reason,
                'receipt', CASE WHEN x.transaction_id IS NOT NULL THEN public.fn_receipt_number(x.transaction_id) END,
                'rewards', COALESCE((SELECT jsonb_agg(jsonb_build_object('side', w2.side, 'kind', w2.kind, 'status', w2.status,
                    'what', public.fn_referral_reward_text(CASE WHEN w2.kind = 'discount_at_sale' THEN 'amount' ELSE w2.kind END,
                        CASE WHEN w2.kind = 'points' THEN w2.points ELSE w2.value END, w2.product_id, w2.qty)))
                    FROM public.referral_rewards w2 WHERE w2.referral_id = x.id), '[]')) AS z
            FROM x JOIN public.customers a ON a.id = x.referrer_customer_id JOIN public.customers c ON c.id = x.referred_customer_id
            ORDER BY x.created_at DESC LIMIT 200) s), '[]')
    ) INTO v_res;
    RETURN v_res;
END;
$$;

-- ============================================================================ who may call what
DO $do$
DECLARE f text;
BEGIN
    FOREACH f IN ARRAY ARRAY[
        'public.fn_code_not_taken()', 'public.fn_referral_campaign(uuid)', 'public.fn_referral_code_for(uuid)',
        'public.fn_referral_reward_text(text, numeric, uuid, numeric)',
        'public.fn_referral_evaluate(public.referral_codes, uuid, uuid, jsonb, numeric, uuid, uuid)',
        'public.fn_referral_find_code(uuid, text)', 'public.fn_referral_issue(uuid, text)',
        'public.fn_referral_give(public.referrals, public.referral_campaigns, text, uuid, text, numeric, uuid, numeric, text)',
        'public.fn_referral_take_back(uuid, text, text)', 'public.fn_promo_after_redeem(uuid)', 'public.fn_promo_after_end(uuid)',
        'public.run_referral_jobs()', 'public.fn_referral_summary(public.customers, public.referral_codes, public.referral_campaigns)']
    LOOP
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', f);
        EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', f);
    END LOOP;
    FOREACH f IN ARRAY ARRAY[
        'public.promo_check(uuid, text, uuid, jsonb, numeric)', 'public.promo_reserve(uuid, text, uuid, jsonb, numeric, text)',
        'public.promo_release(uuid)', 'public.save_referral_campaign(uuid, uuid, jsonb)', 'public.end_referral_campaign(uuid)',
        'public.set_referral_code_status(uuid, text, text)', 'public.decide_referral(uuid, boolean, text)',
        'public.customer_referral(uuid)', 'public.my_referral(text)', 'public.referral_dashboard(uuid, date, date)']
    LOOP
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', f);
        EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', f);
    END LOOP;
END $do$;
