-- 2026-11-17 Promotion codes for the till and the online shop, in one place.
--
-- The online shop already had promo codes (website_promo_codes). That table is now the one
-- promotions table for both channels; its name is kept because the online shop's functions
-- use it. A promotion is:
--   kind       what it gives:  percent | amount | free_items (some units of one product free)
--                              | none (only used by referral welcome rows, 20261126002)
--   promo_type what staff picked (percentage, fixed, buy_x_get_y, free_product, min_spend,
--              customer, first_purchase, referral). It only presets the fields; the rules
--              below are generic, so no campaign has code of its own.
--   audience   everyone | selected (promotion_customers) | first_purchase | referral
--   scope      all products | chosen products (promotion_products) | categories (promotion_categories)
--   branches   always its own branch; promotion_branches adds sister branches (same owner)
--   limits     starts/ends, min_order (on the items the promotion covers), max_discount,
--              max_uses (all channels, all branches), once_per_customer, stackable.
--
-- Till flow (same shape as loyalty points at the till):
--   promo_check    preview only, never changes anything; returns ok/reason/discount.
--   promo_reserve  locks the promotion, checks again, holds one use for 20 minutes and
--                  returns the server's discount. The till uses that number, never its own.
--   sale           saved with transactions.promotion_redemption_id, in ONE database
--                  transaction (record_till_sale, or process_customer_transaction for
--                  credit). A deferred trigger then works the discount out again from the
--                  sale's own items and refuses the whole sale if it differs or the rules
--                  no longer pass. So the sale and its redemption commit together or not at all.
--   promo_release  the sale failed: the hold is given back at once (or it times out).
-- Cancelled sale -> redemption 'cancelled'; fully refunded -> 'refunded'; both free the use.
-- Partly refunded -> 'partially_refunded' (still a use). Online orders write a redemption
-- too (trigger), so limits and reports cover both channels.

-- ============================================================================ promotions
ALTER TABLE public.website_promo_codes
    ADD COLUMN IF NOT EXISTS name text,
    ADD COLUMN IF NOT EXISTS promo_type text NOT NULL DEFAULT 'percentage',
    ADD COLUMN IF NOT EXISTS max_discount numeric(14,2),
    ADD COLUMN IF NOT EXISTS audience text NOT NULL DEFAULT 'everyone',
    ADD COLUMN IF NOT EXISTS product_scope text NOT NULL DEFAULT 'all',
    ADD COLUMN IF NOT EXISTS buy_qty numeric(14,3),
    ADD COLUMN IF NOT EXISTS reward_product_id uuid REFERENCES public.products(id) ON DELETE RESTRICT,
    ADD COLUMN IF NOT EXISTS reward_qty numeric(14,3),
    ADD COLUMN IF NOT EXISTS stackable boolean NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS use_pos boolean NOT NULL DEFAULT true,
    ADD COLUMN IF NOT EXISTS use_online boolean NOT NULL DEFAULT true,
    -- manual: made by staff. referral_welcome: the hidden rules of a referral campaign's
    -- first purchase (never typed). referral_reward: a referrer's personal reward code.
    ADD COLUMN IF NOT EXISTS origin text NOT NULL DEFAULT 'manual',
    ADD COLUMN IF NOT EXISTS archived_at timestamptz,
    ADD COLUMN IF NOT EXISTS updated_by text;

-- Codes made for the online shop before this stay online-only, and stay as they were.
UPDATE public.website_promo_codes SET use_pos = false, name = COALESCE(name, code)
WHERE promo_type = 'percentage' AND name IS NULL;

COMMENT ON TABLE public.website_promo_codes IS
    'All promotions (till and online shop). Name kept from when only the website had codes.';

ALTER TABLE public.website_promo_codes
    DROP CONSTRAINT IF EXISTS website_promo_codes_kind_check,
    DROP CONSTRAINT IF EXISTS website_promo_codes_value_check,
    DROP CONSTRAINT IF EXISTS website_promo_codes_description_check;
ALTER TABLE public.website_promo_codes
    ADD CONSTRAINT website_promo_codes_kind_check CHECK (kind IN ('percent', 'amount', 'free_items', 'none')),
    ADD CONSTRAINT website_promo_codes_value_check CHECK (kind IN ('free_items', 'none') OR value > 0),
    ADD CONSTRAINT website_promo_codes_description_check CHECK (description IS NULL OR length(description) <= 500),
    ADD CONSTRAINT promo_type_check CHECK (promo_type IN ('percentage', 'fixed', 'buy_x_get_y', 'free_product',
        'min_spend', 'customer', 'first_purchase', 'referral')),
    ADD CONSTRAINT promo_audience_check CHECK (audience IN ('everyone', 'selected', 'first_purchase', 'referral')),
    ADD CONSTRAINT promo_scope_check CHECK (product_scope IN ('all', 'products', 'categories')),
    ADD CONSTRAINT promo_max_discount_check CHECK (max_discount IS NULL OR max_discount > 0),
    ADD CONSTRAINT promo_free_items_check CHECK (kind <> 'free_items'
        OR (reward_product_id IS NOT NULL AND reward_qty > 0)),
    ADD CONSTRAINT promo_buy_qty_check CHECK (buy_qty IS NULL OR buy_qty > 0),
    ADD CONSTRAINT promo_none_check CHECK (kind <> 'none' OR audience = 'referral'),
    ADD CONSTRAINT promo_channel_check CHECK (use_pos OR use_online),
    -- The online shop works out codes on the order subtotal only.
    ADD CONSTRAINT promo_online_check CHECK (NOT use_online
        OR (kind IN ('percent', 'amount') AND audience = 'everyone' AND product_scope = 'all')),
    ADD CONSTRAINT promo_show_online_check CHECK (NOT show_on_website OR use_online),
    ADD CONSTRAINT promo_archived_check CHECK (archived_at IS NULL OR NOT active),
    ADD CONSTRAINT promo_origin_check CHECK (origin IN ('manual', 'referral_welcome', 'referral_reward')),
    ADD CONSTRAINT promo_name_check CHECK (name IS NULL OR length(trim(name)) BETWEEN 1 AND 80);

CREATE INDEX IF NOT EXISTS idx_promotions_business_active
    ON public.website_promo_codes (business_id) WHERE archived_at IS NULL;

-- What a promotion covers, who may use it, and where.
CREATE TABLE IF NOT EXISTS public.promotion_products (
    promotion_id uuid NOT NULL REFERENCES public.website_promo_codes(id) ON DELETE CASCADE,
    product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
    PRIMARY KEY (promotion_id, product_id)
);
CREATE INDEX IF NOT EXISTS idx_promotion_products_product ON public.promotion_products (product_id);

CREATE TABLE IF NOT EXISTS public.promotion_categories (
    promotion_id uuid NOT NULL REFERENCES public.website_promo_codes(id) ON DELETE CASCADE,
    category text NOT NULL CHECK (length(trim(category)) > 0),
    PRIMARY KEY (promotion_id, category)
);

CREATE TABLE IF NOT EXISTS public.promotion_customers (
    promotion_id uuid NOT NULL REFERENCES public.website_promo_codes(id) ON DELETE CASCADE,
    customer_id uuid NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (promotion_id, customer_id)
);
CREATE INDEX IF NOT EXISTS idx_promotion_customers_customer ON public.promotion_customers (customer_id);

CREATE TABLE IF NOT EXISTS public.promotion_branches (
    promotion_id uuid NOT NULL REFERENCES public.website_promo_codes(id) ON DELETE CASCADE,
    business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    PRIMARY KEY (promotion_id, business_id)
);
CREATE INDEX IF NOT EXISTS idx_promotion_branches_business ON public.promotion_branches (business_id);

-- ============================================================================ redemptions
CREATE TABLE IF NOT EXISTS public.promotion_redemptions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    promotion_id uuid NOT NULL REFERENCES public.website_promo_codes(id),
    code text NOT NULL,
    business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    channel text NOT NULL CHECK (channel IN ('pos', 'online')),
    transaction_id uuid REFERENCES public.transactions(id) ON DELETE SET NULL,
    order_id uuid REFERENCES public.online_orders(id) ON DELETE SET NULL,
    customer_id uuid REFERENCES public.customers(id) ON DELETE SET NULL,
    account_id uuid,
    staff_id uuid,
    staff_name text,
    status text NOT NULL CHECK (status IN ('reserved', 'redeemed', 'released', 'expired', 'cancelled',
        'refunded', 'partially_refunded')),
    discount numeric(14,2) NOT NULL CHECK (discount >= 0),
    subtotal numeric(14,2) NOT NULL DEFAULT 0,
    sale_total numeric(14,2),
    refunded_amount numeric(14,2) NOT NULL DEFAULT 0,
    lines jsonb NOT NULL DEFAULT '[]'::jsonb,
    reference_id text,
    reserved_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz,
    redeemed_at timestamptz,
    ended_at timestamptz,
    end_reason text,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_promotion_redemptions_tx ON public.promotion_redemptions (transaction_id) WHERE transaction_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_promotion_redemptions_order ON public.promotion_redemptions (order_id) WHERE order_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_promotion_redemptions_promo ON public.promotion_redemptions (promotion_id, status);
CREATE INDEX IF NOT EXISTS idx_promotion_redemptions_business ON public.promotion_redemptions (business_id, redeemed_at DESC);
CREATE INDEX IF NOT EXISTS idx_promotion_redemptions_customer ON public.promotion_redemptions (customer_id) WHERE customer_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_promotion_redemptions_held ON public.promotion_redemptions (expires_at) WHERE status = 'reserved';

ALTER TABLE public.transactions
    ADD COLUMN IF NOT EXISTS promotion_redemption_id uuid REFERENCES public.promotion_redemptions(id),
    ADD COLUMN IF NOT EXISTS promotion_code text,
    ADD COLUMN IF NOT EXISTS promotion_discount numeric(14,2) NOT NULL DEFAULT 0;
CREATE UNIQUE INDEX IF NOT EXISTS uq_transactions_promotion ON public.transactions (promotion_redemption_id) WHERE promotion_redemption_id IS NOT NULL;
COMMENT ON COLUMN public.transactions.promotion_discount IS
    'Part of discount that came from a promotion code; set by the database from the redemption, never by the app.';

-- ============================================================================ permissions
-- promotions.view   dashboard and lists          promotions.manage  create, edit, switch off, archive
-- pos.apply_promotion  type a code at the till
INSERT INTO public.role_default_permissions (role, permissions) VALUES
    ('Cashier', ARRAY['ai.use', 'business.view', 'complaints.view', 'customers.create', 'customers.debts', 'customers.loyalty', 'customers.schedules', 'customers.view', 'dashboard.view', 'inventory.view', 'notifications.view', 'online_store.view', 'orders.assign_rider', 'orders.create', 'orders.update', 'orders.view', 'payments.airtel', 'payments.card', 'payments.cash', 'payments.mpesa', 'payments.verify', 'pettycash.record', 'pos.apply_promotion', 'pos.cancel_sale', 'pos.close_shift', 'pos.create_sale', 'pos.discount', 'pos.open_shift', 'pos.walkin_customer', 'products.view', 'settings.theme'])
ON CONFLICT (role) DO UPDATE SET permissions = EXCLUDED.permissions;
INSERT INTO public.role_default_permissions (role, permissions) VALUES
    ('Manager', ARRAY['accounting.view', 'ai.insights', 'ai.use', 'assets.view', 'bom.create', 'bom.update', 'bom.view', 'business.switch', 'business.view', 'communication.send', 'communication.view', 'complaints.reply', 'complaints.view', 'customers.create', 'customers.debts', 'customers.loyalty', 'customers.manage', 'customers.schedules', 'customers.update', 'customers.view', 'dashboard.view', 'deliveries.assign', 'deliveries.cancel', 'deliveries.complete', 'deliveries.create', 'deliveries.view', 'expenses.create', 'expenses.update', 'expenses.view', 'files.view', 'finance.view', 'home.view', 'inventory.adjust_stock', 'inventory.expiry', 'inventory.receive_stock', 'inventory.request_transfer', 'inventory.stock_count', 'inventory.stock_history', 'inventory.transfer_stock', 'inventory.view', 'inventory.wastage', 'invoices.manage', 'invoices.view', 'loyalty.adjust', 'notifications.send', 'notifications.view', 'online_store.view', 'orders.assign_rider', 'orders.complete', 'orders.create', 'orders.update', 'orders.view', 'payments.card', 'payments.cash', 'payments.verify', 'payments.view', 'pettycash.record', 'pos.apply_promotion', 'pos.close_shift', 'pos.create_sale', 'pos.open_shift', 'pos.walkin_customer', 'production.approve', 'production.create', 'production.update', 'production.view', 'products.create', 'products.export', 'products.import', 'products.manage_categories', 'products.update', 'products.view', 'promotions.manage', 'promotions.view', 'purchases.approve', 'purchases.create', 'purchases.export', 'purchases.print', 'purchases.request_quote', 'purchases.update', 'purchases.view', 'quotes.manage', 'quotes.view', 'refunds.create', 'reports.customers', 'reports.deliveries', 'reports.inventory', 'reports.profit', 'reports.sales', 'reports.view', 'sales_orders.manage', 'sales_orders.view', 'settings.tax', 'settings.theme', 'settings.update', 'settings.view', 'staff.schedule', 'staff.view', 'supplier_bills.manage', 'suppliers.create', 'suppliers.export', 'suppliers.import', 'suppliers.update', 'suppliers.view'])
ON CONFLICT (role) DO UPDATE SET permissions = EXCLUDED.permissions;

-- ============================================================================ RLS
ALTER TABLE public.promotion_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.promotion_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.promotion_customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.promotion_branches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.promotion_redemptions ENABLE ROW LEVEL SECURITY;

-- Promotions: staff of the branch read them; only promotions.manage writes (the app writes
-- through save_promotion / set_promotion_status, which check the same).
DROP POLICY IF EXISTS pol_promo_codes_write ON public.website_promo_codes;
CREATE POLICY pol_promo_codes_write ON public.website_promo_codes
    USING (public.has_permission(business_id, 'promotions.manage'))
    WITH CHECK (public.has_permission(business_id, 'promotions.manage'));

CREATE POLICY pol_promotion_products_select ON public.promotion_products FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.website_promo_codes p WHERE p.id = promotion_id AND p.business_id = ANY (public.get_user_business_ids())));
CREATE POLICY pol_promotion_categories_select ON public.promotion_categories FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.website_promo_codes p WHERE p.id = promotion_id AND p.business_id = ANY (public.get_user_business_ids())));
CREATE POLICY pol_promotion_customers_select ON public.promotion_customers FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.website_promo_codes p WHERE p.id = promotion_id
            AND public.has_permission(p.business_id, 'promotions.view', 'promotions.manage')));
CREATE POLICY pol_promotion_branches_select ON public.promotion_branches FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.website_promo_codes p WHERE p.id = promotion_id AND p.business_id = ANY (public.get_user_business_ids())));
-- Redemptions are written only by the functions below.
CREATE POLICY pol_promotion_redemptions_select ON public.promotion_redemptions FOR SELECT USING (
    public.has_permission(business_id, 'promotions.view', 'promotions.manage'));

GRANT SELECT ON public.promotion_products, public.promotion_categories, public.promotion_customers,
    public.promotion_branches, public.promotion_redemptions TO authenticated;
GRANT ALL ON public.promotion_products, public.promotion_categories, public.promotion_customers,
    public.promotion_branches, public.promotion_redemptions TO service_role;

-- ============================================================================ helpers
CREATE OR REPLACE FUNCTION public.fn_ksh(p numeric) RETURNS text LANGUAGE sql IMMUTABLE AS $$
    SELECT 'KSh ' || replace(to_char(round(COALESCE(p, 0), 2), 'FM999,999,999,990.00'), '.00', '')
$$;

CREATE OR REPLACE FUNCTION public.fn_promo_norm_code(p text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
    SELECT upper(regexp_replace(COALESCE(p, ''), '\s', '', 'g'))
$$;

-- Does this redemption use up one of the promotion's uses right now?
CREATE OR REPLACE FUNCTION public.fn_promo_counts(p_status text, p_expires timestamptz) RETURNS boolean
LANGUAGE sql STABLE AS $$
    SELECT p_status IN ('redeemed', 'partially_refunded') OR (p_status = 'reserved' AND p_expires > now())
$$;

CREATE OR REPLACE FUNCTION public.fn_promo_fail(p_reason text, p_hint text DEFAULT NULL) RETURNS jsonb
LANGUAGE sql IMMUTABLE AS $$
    SELECT jsonb_build_object('ok', false, 'reason', p_reason) || CASE WHEN p_hint IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('hint', p_hint) END
$$;

CREATE OR REPLACE FUNCTION public.fn_promo_when(p timestamptz) RETURNS text LANGUAGE sql STABLE AS $$
    SELECT to_char(p AT TIME ZONE 'Africa/Nairobi', 'FMDD Mon YYYY, HH24:MI')
$$;

-- active | off | scheduled | expired | used_up | archived
CREATE OR REPLACE FUNCTION public.fn_promo_status(p public.website_promo_codes) RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
    IF p.archived_at IS NOT NULL THEN RETURN 'archived'; END IF;
    IF NOT p.active THEN RETURN 'off'; END IF;
    IF p.ends_at IS NOT NULL AND p.ends_at <= now() THEN RETURN 'expired'; END IF;
    IF p.starts_at IS NOT NULL AND p.starts_at > now() THEN RETURN 'scheduled'; END IF;
    IF p.max_uses IS NOT NULL AND (SELECT count(*) FROM public.promotion_redemptions r
        WHERE r.promotion_id = p.id AND public.fn_promo_counts(r.status, r.expires_at)) >= p.max_uses THEN
        RETURN 'used_up';
    END IF;
    RETURN 'active';
END;
$$;

-- The employee row of whoever is signed in, at this branch.
CREATE OR REPLACE FUNCTION public.fn_my_employee(p_business_id uuid) RETURNS public.employees
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT e.* FROM public.employees e JOIN public.users u ON u.id = e.user_id
    WHERE u.auth_user_id = auth.uid() AND e.business_id = p_business_id AND e.deleted_at IS NULL
    LIMIT 1
$$;

-- A code typed at the till: this branch's own promotion first, then a sister branch's
-- promotion that was switched on here. System rows (referral welcome) are never typed.
CREATE OR REPLACE FUNCTION public.fn_promo_find(p_business_id uuid, p_code text) RETURNS public.website_promo_codes
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT p.* FROM public.website_promo_codes p
    WHERE p.code = public.fn_promo_norm_code(p_code) AND p.origin <> 'referral_welcome'
      AND (p.business_id = p_business_id
           OR EXISTS (SELECT 1 FROM public.promotion_branches pb WHERE pb.promotion_id = p.id AND pb.business_id = p_business_id))
    ORDER BY (p.business_id = p_business_id) DESC, p.created_at DESC
    LIMIT 1
$$;

-- A new random code: PREFIX + 6 letters/digits that are easy to read out (no 0/O, 1/I).
CREATE OR REPLACE FUNCTION public.fn_promo_new_code(p_business_id uuid, p_prefix text DEFAULT '') RETURNS text
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_chars text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    v_prefix text := left(regexp_replace(upper(COALESCE(p_prefix, '')), '[^A-Z0-9]', '', 'g'), 12);
    v_code text;
    i int;
BEGIN
    FOR attempt IN 1..50 LOOP
        v_code := v_prefix;
        FOR i IN 1..6 LOOP
            v_code := v_code || substr(v_chars, 1 + floor(random() * length(v_chars))::int, 1);
        END LOOP;
        IF NOT EXISTS (SELECT 1 FROM public.website_promo_codes WHERE business_id = p_business_id AND code = v_code) THEN
            RETURN v_code;
        END IF;
    END LOOP;
    RAISE EXCEPTION 'Could not make a free code. Try again.';
END;
$$;

-- ============================================================================ the rules engine
-- Works out one promotion on one cart. Never raises for a rule: returns
--   {ok:false, reason, hint?}  or  {ok:true, discount, subtotal, eligible, lines[], note?}
-- p_items: [{product_id, quantity, unit_price, discount_percentage, product_name?}] as sold.
-- p_other_discount: cart discount and points already taken off (for "can't combine").
-- p_exclude: a redemption not to count as a use (the one being finished).
CREATE OR REPLACE FUNCTION public.fn_promo_evaluate(
    p public.website_promo_codes, p_business_id uuid, p_customer_id uuid, p_items jsonb,
    p_other_discount numeric DEFAULT 0, p_exclude uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_cust   public.customers%ROWTYPE;
    v_items  jsonb;
    v_bad    boolean;
    v_used   int;
    v_cart   numeric;
    v_base   numeric;
    v_q      numeric;
    v_disc_lines boolean;
    v_d      numeric := 0;
    v_note   text;
    v_rqty   numeric;
    v_rnet   numeric;
    v_rname  text;
    v_sets   numeric;
    v_earned numeric;
    v_free   numeric;
    v_reward_elig boolean;
    v_lines  jsonb := '[]'::jsonb;
    v_names  text;
BEGIN
    IF p.id IS NULL THEN
        RETURN public.fn_promo_fail('No promotion uses that code.');
    END IF;
    IF p.archived_at IS NOT NULL THEN
        RETURN public.fn_promo_fail('This promotion has been archived.');
    END IF;
    IF NOT p.active THEN
        RETURN public.fn_promo_fail('This promotion is switched off.');
    END IF;
    IF NOT p.use_pos THEN
        RETURN public.fn_promo_fail('This code is for the online shop only.');
    END IF;
    IF p.starts_at IS NOT NULL AND p.starts_at > now() THEN
        RETURN public.fn_promo_fail('This promotion starts on ' || public.fn_promo_when(p.starts_at) || '.');
    END IF;
    IF p.ends_at IS NOT NULL AND p.ends_at <= now() THEN
        RETURN public.fn_promo_fail('This promotion ended on ' || public.fn_promo_when(p.ends_at) || '.');
    END IF;
    IF p.business_id <> p_business_id AND NOT EXISTS (
        SELECT 1 FROM public.promotion_branches pb WHERE pb.promotion_id = p.id AND pb.business_id = p_business_id) THEN
        RETURN public.fn_promo_fail('This promotion is not on at this branch.');
    END IF;

    IF p.max_uses IS NOT NULL THEN
        SELECT count(*) INTO v_used FROM public.promotion_redemptions r
        WHERE r.promotion_id = p.id AND r.id IS DISTINCT FROM p_exclude AND public.fn_promo_counts(r.status, r.expires_at);
        IF v_used >= p.max_uses THEN
            RETURN public.fn_promo_fail('This promotion has been fully used (' || p.max_uses || ' of ' || p.max_uses || ').');
        END IF;
    END IF;

    -- Who is buying
    IF p_customer_id IS NOT NULL THEN
        SELECT * INTO v_cust FROM public.customers WHERE id = p_customer_id AND deleted_at IS NULL;
        IF NOT FOUND THEN
            RETURN public.fn_promo_fail('That customer was not found.');
        END IF;
    END IF;
    IF p.audience <> 'everyone' OR p.once_per_customer THEN
        IF p_customer_id IS NULL THEN
            RETURN public.fn_promo_fail(CASE p.audience
                WHEN 'selected' THEN 'This code is for particular customers. Choose the customer first.'
                WHEN 'first_purchase' THEN 'This code is for a new customer''s first purchase. Choose the customer first.'
                WHEN 'referral' THEN 'A referral code needs the new customer. Choose or add the customer first.'
                ELSE 'This code can be used once per customer. Choose the customer first.' END);
        END IF;
        IF p.audience = 'selected' AND NOT EXISTS (
            SELECT 1 FROM public.promotion_customers pc WHERE pc.promotion_id = p.id AND pc.customer_id = p_customer_id) THEN
            RETURN public.fn_promo_fail(v_cust.name || ' can''t use this code: it was given to other customers.');
        END IF;
        IF p.audience IN ('first_purchase', 'referral') AND EXISTS (
            SELECT 1 FROM public.transactions t WHERE t.customer_id = p_customer_id AND t.deleted_at IS NULL
              AND (p_exclude IS NULL OR t.promotion_redemption_id IS DISTINCT FROM p_exclude)) THEN  -- not the sale being saved
            RETURN public.fn_promo_fail('This code is for a first purchase, and ' || v_cust.name || ' has bought before.');
        END IF;
        IF p.once_per_customer AND EXISTS (
            SELECT 1 FROM public.promotion_redemptions r
            WHERE r.promotion_id = p.id AND r.customer_id = p_customer_id AND r.id IS DISTINCT FROM p_exclude
              AND public.fn_promo_counts(r.status, r.expires_at)) THEN
            RETURN public.fn_promo_fail(v_cust.name || ' has already used this code.');
        END IF;
    END IF;

    -- The cart, line by line, with what each line costs after its own discount.
    SELECT jsonb_agg(jsonb_build_object(
               'id', x.product_id, 'name', COALESCE(pr.name, x.product_name, 'Item'), 'cat', pr.category,
               'q', x.quantity, 'dp', COALESCE(x.discount_percentage, 0),
               'net', round(x.unit_price * x.quantity * (1 - COALESCE(x.discount_percentage, 0) / 100), 2),
               'elig', (p.product_scope = 'all'
                        OR (p.product_scope = 'products' AND EXISTS (SELECT 1 FROM public.promotion_products pp
                             WHERE pp.promotion_id = p.id AND pp.product_id = x.product_id))
                        OR (p.product_scope = 'categories' AND EXISTS (SELECT 1 FROM public.promotion_categories pc
                             WHERE pc.promotion_id = p.id AND lower(pc.category) = lower(pr.category))))
           ) ORDER BY ord),
           bool_or(x.product_id IS NULL OR x.quantity IS NULL OR x.quantity <= 0 OR x.unit_price IS NULL OR x.unit_price < 0
                   OR COALESCE(x.discount_percentage, 0) NOT BETWEEN 0 AND 100)
    INTO v_items, v_bad
    FROM ROWS FROM (jsonb_to_recordset(COALESCE(p_items, '[]'::jsonb))
             AS (product_id uuid, quantity numeric, unit_price numeric, discount_percentage numeric, product_name text))
         WITH ORDINALITY AS x(product_id, quantity, unit_price, discount_percentage, product_name, ord)
    LEFT JOIN public.products pr ON pr.id = x.product_id;
    IF v_items IS NULL THEN
        RETURN public.fn_promo_fail('Add items to the cart first.');
    END IF;
    IF v_bad THEN
        RETURN public.fn_promo_fail('An item in the cart has a wrong quantity or price.');
    END IF;

    SELECT COALESCE(SUM((e->>'net')::numeric), 0),
           COALESCE(SUM((e->>'net')::numeric) FILTER (WHERE (e->>'elig')::boolean), 0),
           COALESCE(SUM((e->>'q')::numeric) FILTER (WHERE (e->>'elig')::boolean), 0),
           COALESCE(bool_or((e->>'dp')::numeric > 0), false)
    INTO v_cart, v_base, v_q, v_disc_lines
    FROM jsonb_array_elements(v_items) e;

    IF v_base <= 0 THEN
        SELECT string_agg(n, ', ') INTO v_names FROM (
            SELECT pr.name AS n FROM public.promotion_products pp JOIN public.products pr ON pr.id = pp.product_id
            WHERE pp.promotion_id = p.id
            UNION ALL SELECT pc.category FROM public.promotion_categories pc WHERE pc.promotion_id = p.id
            ORDER BY 1 LIMIT 6) s;
        RETURN public.fn_promo_fail('None of the items in the cart are part of this promotion.',
            CASE WHEN v_names IS NOT NULL THEN 'It covers: ' || v_names || '.' END);
    END IF;

    IF NOT p.stackable AND (v_disc_lines OR COALESCE(p_other_discount, 0) > 0.004) THEN
        RETURN public.fn_promo_fail('This promotion can''t be combined with other discounts.',
            'Remove the other discount (item %, cart discount or points) first.');
    END IF;

    IF v_base < p.min_order THEN
        RETURN public.fn_promo_fail('Spend at least ' || public.fn_ksh(p.min_order)
            || CASE WHEN p.product_scope <> 'all' THEN ' on the promotion''s items' ELSE '' END
            || ' to use this code. The cart has ' || public.fn_ksh(v_base) || '.',
            'Add ' || public.fn_ksh(p.min_order - v_base) || ' more.');
    END IF;

    -- What it gives
    IF p.kind = 'percent' THEN
        v_d := round(v_base * p.value / 100, 2);
    ELSIF p.kind = 'amount' THEN
        v_d := LEAST(p.value, v_base);
    ELSIF p.kind = 'free_items' THEN
        SELECT COALESCE(SUM((e->>'q')::numeric), 0), COALESCE(SUM((e->>'net')::numeric), 0), bool_or((e->>'elig')::boolean)
        INTO v_rqty, v_rnet, v_reward_elig
        FROM jsonb_array_elements(v_items) e WHERE e->>'id' = p.reward_product_id::text;
        SELECT name INTO v_rname FROM public.products WHERE id = p.reward_product_id;
        v_rname := COALESCE(v_rname, 'the free item');
        IF p.buy_qty IS NOT NULL THEN
            -- Buy X get Y: every buy_qty of the covered items earns reward_qty free. When the
            -- free item is itself covered, a set is buy_qty + reward_qty of them.
            IF COALESCE(v_reward_elig, false) THEN
                v_sets := floor(v_q / (p.buy_qty + p.reward_qty));
                IF v_sets = 0 AND v_q >= p.buy_qty THEN
                    RETURN public.fn_promo_fail('Add ' || trim(to_char(p.buy_qty + p.reward_qty - v_q, 'FM999990.###')) || ' more ' || v_rname || ': it''s free with this code.');
                END IF;
            ELSE
                v_sets := floor(v_q / p.buy_qty);
            END IF;
            IF v_sets = 0 THEN
                RETURN public.fn_promo_fail('Buy at least ' || trim(to_char(p.buy_qty, 'FM999990.###')) || ' of the promotion''s items to get '
                    || trim(to_char(p.reward_qty, 'FM999990.###')) || ' ' || v_rname || ' free. The cart has ' || trim(to_char(v_q, 'FM999990.###')) || '.');
            END IF;
            v_earned := v_sets * p.reward_qty;
        ELSE
            v_earned := p.reward_qty;
        END IF;
        IF COALESCE(v_rqty, 0) <= 0 THEN
            RETURN public.fn_promo_fail('Add ' || trim(to_char(v_earned, 'FM999990.###')) || ' ' || v_rname || ' to the cart: it''s free with this code.');
        END IF;
        v_free := LEAST(v_earned, v_rqty);
        v_d := round(v_rnet / v_rqty * v_free, 2);
        IF v_free < v_earned THEN
            v_note := 'Add ' || trim(to_char(v_earned - v_free, 'FM999990.###')) || ' more ' || v_rname || ': also free.';
        END IF;
    END IF;

    IF p.kind <> 'none' AND v_d <= 0 THEN
        RETURN public.fn_promo_fail('This promotion gives nothing off this cart.');
    END IF;
    IF p.max_discount IS NOT NULL AND v_d > p.max_discount THEN
        v_d := p.max_discount;
        v_note := 'Capped at the ' || public.fn_ksh(p.max_discount) || ' most this promotion gives.';
    END IF;
    v_d := LEAST(v_d, v_cart);

    -- Share the discount over the lines it came from (for the per-product report).
    IF v_d > 0 THEN
        WITH t AS (
            SELECT e, (e->>'net')::numeric AS net,
                   row_number() OVER (ORDER BY (e->>'net')::numeric DESC) AS rn
            FROM jsonb_array_elements(v_items) e
            WHERE CASE WHEN p.kind = 'free_items' THEN e->>'id' = p.reward_product_id::text ELSE (e->>'elig')::boolean END
        ), s AS (SELECT SUM(net) AS tot FROM t),
        a AS (SELECT t.e, t.rn, CASE WHEN s.tot > 0 THEN round(v_d * t.net / s.tot, 2) ELSE 0 END AS share FROM t, s),
        f AS (SELECT SUM(share) AS ss FROM a)
        SELECT jsonb_agg(jsonb_build_object('productId', a.e->>'id', 'name', a.e->>'name', 'category', a.e->>'cat',
                   'quantity', (a.e->>'q')::numeric, 'net', (a.e->>'net')::numeric,
                   'discount', a.share + CASE WHEN a.rn = 1 THEN v_d - f.ss ELSE 0 END) ORDER BY a.rn)
        INTO v_lines FROM a, f;
    END IF;

    RETURN jsonb_build_object('ok', true, 'discount', v_d, 'subtotal', v_cart, 'eligible', v_base,
                              'lines', COALESCE(v_lines, '[]'::jsonb))
           || CASE WHEN v_note IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('note', v_note) END;
END;
$$;

-- What the till shows about a promotion.
CREATE OR REPLACE FUNCTION public.fn_promo_summary(p public.website_promo_codes) RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_r text;
BEGIN
    SELECT name INTO v_r FROM public.products WHERE id = p.reward_product_id;
    RETURN CASE p.kind
        WHEN 'percent' THEN trim(to_char(p.value, 'FM990.##')) || '% off'
        WHEN 'amount' THEN public.fn_ksh(p.value) || ' off'
        WHEN 'free_items' THEN CASE WHEN p.buy_qty IS NOT NULL
            THEN 'Buy ' || trim(to_char(p.buy_qty, 'FM999990.###')) || ', get ' || trim(to_char(p.reward_qty, 'FM999990.###')) || ' ' || COALESCE(v_r, 'item') || ' free'
            ELSE trim(to_char(p.reward_qty, 'FM999990.###')) || ' ' || COALESCE(v_r, 'item') || ' free' END
        ELSE 'Referral' END
        || CASE WHEN p.min_order > 0 THEN ' on ' || public.fn_ksh(p.min_order) || ' or more' ELSE '' END;
END;
$$;

-- ============================================================================ till RPCs
-- Preview: is the code good for this cart, and what does it take off? Changes nothing.
CREATE OR REPLACE FUNCTION public.promo_check(
    p_business_id uuid, p_code text, p_customer_id uuid, p_items jsonb, p_other_discount numeric DEFAULT 0
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
    p public.website_promo_codes;
    v jsonb;
BEGIN
    PERFORM public.assert_business_member(p_business_id);
    PERFORM public.assert_permission(p_business_id, 'pos.apply_promotion');
    IF public.fn_promo_norm_code(p_code) = '' THEN
        RETURN public.fn_promo_fail('Type a code first.');
    END IF;
    p := public.fn_promo_find(p_business_id, p_code);
    IF p.id IS NULL THEN
        RETURN public.fn_promo_fail('No promotion uses the code ' || public.fn_promo_norm_code(p_code) || '.');
    END IF;
    v := public.fn_promo_evaluate(p, p_business_id, p_customer_id, p_items, p_other_discount);
    RETURN v || jsonb_build_object('code', p.code, 'name', COALESCE(p.name, p.code), 'promotionId', p.id,
                                   'summary', public.fn_promo_summary(p), 'kind', p.kind);
END;
$$;

-- Hold one use of the code for this sale and return the server's discount.
CREATE OR REPLACE FUNCTION public.promo_reserve(
    p_business_id uuid, p_code text, p_customer_id uuid, p_items jsonb,
    p_other_discount numeric DEFAULT 0, p_reference_id text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
    p   public.website_promo_codes;
    v   jsonb;
    e   public.employees;
    v_id uuid;
BEGIN
    PERFORM public.assert_business_member(p_business_id);
    PERFORM public.assert_permission(p_business_id, 'pos.apply_promotion');
    p := public.fn_promo_find(p_business_id, p_code);
    IF p.id IS NULL THEN
        RAISE EXCEPTION 'No promotion uses the code %.', public.fn_promo_norm_code(p_code);
    END IF;
    -- One till at a time per promotion, so two sales can't both take its last use.
    PERFORM 1 FROM public.website_promo_codes WHERE id = p.id FOR UPDATE;
    SELECT * INTO p FROM public.website_promo_codes WHERE id = p.id;
    v := public.fn_promo_evaluate(p, p_business_id, p_customer_id, p_items, p_other_discount);
    IF NOT (v->>'ok')::boolean THEN
        RAISE EXCEPTION '%', v->>'reason';
    END IF;
    e := public.fn_my_employee(p_business_id);
    INSERT INTO public.promotion_redemptions (promotion_id, code, business_id, channel, customer_id, staff_id, staff_name,
        status, discount, subtotal, lines, reference_id, expires_at)
    VALUES (p.id, p.code, p_business_id, 'pos', p_customer_id, e.id, e.name, 'reserved',
        (v->>'discount')::numeric, (v->>'subtotal')::numeric, v->'lines', p_reference_id, now() + interval '20 minutes')
    RETURNING id INTO v_id;
    RETURN v || jsonb_build_object('redemptionId', v_id, 'code', p.code, 'name', COALESCE(p.name, p.code),
                                   'summary', public.fn_promo_summary(p), 'expiresAt', now() + interval '20 minutes');
END;
$$;

-- The sale didn't happen: give the held use back now.
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
END;
$$;

-- ============================================================================ limits, at every write
-- Whatever writes a use (till, online shop, a finished hold), the promotion row is locked
-- and the limits are checked again, so two at once can't go over.
CREATE OR REPLACE FUNCTION public.fn_promo_redemption_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE p public.website_promo_codes%ROWTYPE;
BEGIN
    IF NOT public.fn_promo_counts(NEW.status, NEW.expires_at) THEN RETURN NEW; END IF;
    IF TG_OP = 'UPDATE' AND public.fn_promo_counts(OLD.status, OLD.expires_at) THEN RETURN NEW; END IF;
    SELECT * INTO p FROM public.website_promo_codes WHERE id = NEW.promotion_id FOR UPDATE;
    IF p.max_uses IS NOT NULL AND (SELECT count(*) FROM public.promotion_redemptions r
        WHERE r.promotion_id = p.id AND r.id <> NEW.id AND public.fn_promo_counts(r.status, r.expires_at)) >= p.max_uses THEN
        RAISE EXCEPTION 'This promotion has been fully used (% of %).', p.max_uses, p.max_uses;
    END IF;
    IF p.once_per_customer AND NEW.customer_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.promotion_redemptions r
        WHERE r.promotion_id = p.id AND r.id <> NEW.id AND r.customer_id = NEW.customer_id
          AND public.fn_promo_counts(r.status, r.expires_at)) THEN
        RAISE EXCEPTION 'This customer has already used the code %.', p.code;
    END IF;
    IF p.once_per_customer AND NEW.account_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.promotion_redemptions r
        WHERE r.promotion_id = p.id AND r.id <> NEW.id AND r.account_id = NEW.account_id
          AND public.fn_promo_counts(r.status, r.expires_at)) THEN
        RAISE EXCEPTION 'You have already used that promo code.';
    END IF;
    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_promo_redemption_guard ON public.promotion_redemptions;
CREATE TRIGGER trg_promo_redemption_guard BEFORE INSERT OR UPDATE OF status ON public.promotion_redemptions
    FOR EACH ROW EXECUTE FUNCTION public.fn_promo_redemption_guard();

-- ============================================================================ the sale and its redemption
-- Before a sale is written: the promotion part of the discount is copied from the hold, so
-- the app can't claim a different one, and the link can't be moved later.
CREATE OR REPLACE FUNCTION public.fn_sale_promotion_stamp() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.promotion_redemptions%ROWTYPE;
BEGIN
    IF TG_OP = 'UPDATE' THEN
        IF NEW.promotion_redemption_id IS DISTINCT FROM OLD.promotion_redemption_id
           OR NEW.promotion_discount IS DISTINCT FROM OLD.promotion_discount
           OR NEW.promotion_code IS DISTINCT FROM OLD.promotion_code THEN
            RAISE EXCEPTION 'A sale''s promotion can''t be changed after the sale. Refund it and sell again.';
        END IF;
        RETURN NEW;
    END IF;
    IF NEW.promotion_redemption_id IS NULL THEN
        NEW.promotion_code := NULL;
        NEW.promotion_discount := 0;
        RETURN NEW;
    END IF;
    SELECT * INTO r FROM public.promotion_redemptions WHERE id = NEW.promotion_redemption_id;
    IF NOT FOUND OR r.business_id <> NEW.business_id OR r.channel <> 'pos' THEN
        RAISE EXCEPTION 'That promotion hold is not for this branch. Apply the code again.';
    END IF;
    NEW.promotion_code := r.code;
    NEW.promotion_discount := r.discount;
    IF NEW.discount + 0.009 < r.discount THEN
        RAISE EXCEPTION 'The sale''s discount (%) is less than the promotion''s (%).', NEW.discount, r.discount;
    END IF;
    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_0_sale_promotion_stamp ON public.transactions;
CREATE TRIGGER trg_0_sale_promotion_stamp BEFORE INSERT OR UPDATE ON public.transactions
    FOR EACH ROW EXECUTE FUNCTION public.fn_sale_promotion_stamp();

-- Hook for the referral program (20261126002) to run when a promotion sale is final.
CREATE OR REPLACE FUNCTION public.fn_promo_after_redeem(p_redemption_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$ BEGIN RETURN; END; $$;
CREATE OR REPLACE FUNCTION public.fn_promo_after_end(p_redemption_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$ BEGIN RETURN; END; $$;

-- When the sale commits (its items are written by then): work the promotion out again from
-- what was actually sold and finish the redemption, or refuse the whole sale.
CREATE OR REPLACE FUNCTION public.fn_sale_promotion_commit() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    r       public.promotion_redemptions%ROWTYPE;
    p       public.website_promo_codes%ROWTYPE;
    t       public.transactions%ROWTYPE;
    v_items jsonb;
    v_line  numeric;
    v_other numeric;
    v       jsonb;
BEGIN
    SELECT * INTO t FROM public.transactions WHERE id = NEW.id;
    IF NOT FOUND OR t.promotion_redemption_id IS NULL THEN RETURN NULL; END IF;
    SELECT * INTO r FROM public.promotion_redemptions WHERE id = t.promotion_redemption_id FOR UPDATE;
    IF r.transaction_id = t.id AND r.status <> 'reserved' THEN RETURN NULL; END IF; -- already done
    IF r.transaction_id IS NOT NULL AND r.transaction_id <> t.id THEN
        RAISE EXCEPTION 'That promotion was already used on another sale.';
    END IF;
    IF r.status NOT IN ('reserved', 'expired') THEN
        RAISE EXCEPTION 'The promotion hold was given back. Apply the code again.';
    END IF;
    SELECT * INTO p FROM public.website_promo_codes WHERE id = r.promotion_id FOR UPDATE;

    SELECT jsonb_agg(jsonb_build_object('product_id', product_id, 'quantity', quantity, 'unit_price', unit_price,
                                        'discount_percentage', discount_percentage, 'product_name', product_name)),
           COALESCE(SUM(round(unit_price * quantity * discount_percentage / 100, 2)), 0)
    INTO v_items, v_line
    FROM public.transaction_items WHERE transaction_id = t.id;
    v_other := round(t.discount - v_line - r.discount, 2);
    IF v_other < -0.05 THEN
        RAISE EXCEPTION 'The sale''s discount doesn''t include the promotion''s %.', public.fn_ksh(r.discount);
    END IF;

    v := public.fn_promo_evaluate(p, t.business_id, t.customer_id, v_items, GREATEST(v_other, 0), r.id);
    IF NOT (v->>'ok')::boolean THEN
        RAISE EXCEPTION 'Promotion %: %', p.code, v->>'reason';
    END IF;
    IF abs((v->>'discount')::numeric - r.discount) > 0.01 THEN
        RAISE EXCEPTION 'The cart changed after % was applied (it now gives %, not %). Apply the code again.',
            p.code, public.fn_ksh((v->>'discount')::numeric), public.fn_ksh(r.discount);
    END IF;

    UPDATE public.promotion_redemptions
    SET status = 'redeemed', transaction_id = t.id, customer_id = t.customer_id,
        staff_id = COALESCE(t.staff_id, staff_id), staff_name = COALESCE(t.staff_name, staff_name),
        sale_total = t.final_total, subtotal = (v->>'subtotal')::numeric, lines = v->'lines',
        redeemed_at = now(), expires_at = NULL
    WHERE id = r.id;
    PERFORM public.fn_promo_after_redeem(r.id);
    RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS trg_sale_promotion_commit ON public.transactions;
CREATE CONSTRAINT TRIGGER trg_sale_promotion_commit AFTER INSERT ON public.transactions
    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN (NEW.promotion_redemption_id IS NOT NULL)
    EXECUTE FUNCTION public.fn_sale_promotion_commit();

-- A cancelled (deleted) sale gives its use back.
CREATE OR REPLACE FUNCTION public.fn_sale_promotion_cancel() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid := CASE WHEN TG_OP = 'DELETE' THEN OLD.promotion_redemption_id ELSE NEW.promotion_redemption_id END;
BEGIN
    IF v_id IS NULL THEN RETURN NULL; END IF;
    UPDATE public.promotion_redemptions
    SET status = 'cancelled', ended_at = now(), end_reason = 'Sale cancelled'
    WHERE id = v_id AND status IN ('reserved', 'expired', 'redeemed', 'partially_refunded');
    IF FOUND THEN PERFORM public.fn_promo_after_end(v_id); END IF;
    RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS trg_sale_promotion_cancel ON public.transactions;
CREATE TRIGGER trg_sale_promotion_cancel AFTER UPDATE OF deleted_at ON public.transactions
    FOR EACH ROW WHEN (OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL AND NEW.promotion_redemption_id IS NOT NULL)
    EXECUTE FUNCTION public.fn_sale_promotion_cancel();
DROP TRIGGER IF EXISTS trg_sale_promotion_delete ON public.transactions;
CREATE TRIGGER trg_sale_promotion_delete AFTER DELETE ON public.transactions
    FOR EACH ROW WHEN (OLD.promotion_redemption_id IS NOT NULL)
    EXECUTE FUNCTION public.fn_sale_promotion_cancel();

-- Refunds (credit notes against the sale): all of it back frees the use; part keeps it.
CREATE OR REPLACE FUNCTION public.fn_sale_promotion_refund() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_rid  uuid;
    v_tot  numeric;
    v_back numeric;
    v_new  text;
BEGIN
    SELECT promotion_redemption_id, final_total INTO v_rid, v_tot FROM public.transactions WHERE id = NEW.transaction_id;
    IF v_rid IS NULL THEN RETURN NULL; END IF;
    SELECT COALESCE(SUM(total), 0) INTO v_back FROM public.credit_notes WHERE transaction_id = NEW.transaction_id;
    v_new := CASE WHEN v_back >= v_tot - 0.01 THEN 'refunded' WHEN v_back > 0 THEN 'partially_refunded' ELSE 'redeemed' END;
    UPDATE public.promotion_redemptions
    SET refunded_amount = v_back, status = v_new,
        ended_at = CASE WHEN v_new = 'refunded' THEN now() ELSE ended_at END,
        end_reason = CASE WHEN v_new = 'refunded' THEN 'Sale refunded' ELSE end_reason END
    WHERE id = v_rid AND status IN ('redeemed', 'partially_refunded');
    IF FOUND THEN PERFORM public.fn_promo_after_end(v_rid); END IF;
    RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS trg_sale_promotion_refund ON public.credit_notes;
CREATE TRIGGER trg_sale_promotion_refund AFTER INSERT OR UPDATE OF total ON public.credit_notes
    FOR EACH ROW WHEN (NEW.transaction_id IS NOT NULL) EXECUTE FUNCTION public.fn_sale_promotion_refund();

-- ============================================================================ online shop
-- Online orders write a redemption as well, so limits and reports see both channels.
CREATE OR REPLACE FUNCTION public.fn_order_promotion_sync() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    IF NEW.promo_code_id IS NULL THEN RETURN NULL; END IF;
    IF NOT EXISTS (SELECT 1 FROM public.promotion_redemptions WHERE order_id = NEW.id) THEN
        INSERT INTO public.promotion_redemptions (promotion_id, code, business_id, channel, order_id, account_id,
            customer_id, status, discount, subtotal, sale_total, redeemed_at, ended_at, end_reason)
        VALUES (NEW.promo_code_id, COALESCE(NEW.promo_code, ''), NEW.business_id, 'online', NEW.id, NEW.account_id,
            (SELECT a.customer_id FROM public.customer_accounts a WHERE a.id = NEW.account_id),
            CASE WHEN NEW.status = 'cancelled' THEN 'cancelled' ELSE 'redeemed' END,
            NEW.promo_value, NEW.subtotal, NEW.total, now(),
            CASE WHEN NEW.status = 'cancelled' THEN now() END,
            CASE WHEN NEW.status = 'cancelled' THEN 'Order cancelled' END);
    ELSIF NEW.status = 'cancelled' THEN
        UPDATE public.promotion_redemptions SET status = 'cancelled', ended_at = now(), end_reason = 'Order cancelled'
        WHERE order_id = NEW.id AND status IN ('redeemed', 'partially_refunded');
    ELSE
        UPDATE public.promotion_redemptions SET discount = NEW.promo_value, sale_total = NEW.total
        WHERE order_id = NEW.id AND status = 'redeemed' AND (discount <> NEW.promo_value OR sale_total IS DISTINCT FROM NEW.total);
    END IF;
    RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS trg_order_promotion_sync ON public.online_orders;
CREATE TRIGGER trg_order_promotion_sync AFTER INSERT OR UPDATE OF promo_code_id, status, promo_value ON public.online_orders
    FOR EACH ROW EXECUTE FUNCTION public.fn_order_promotion_sync();

-- Orders placed before this.
INSERT INTO public.promotion_redemptions (promotion_id, code, business_id, channel, order_id, account_id, status,
    discount, subtotal, sale_total, redeemed_at, created_at)
SELECT o.promo_code_id, COALESCE(o.promo_code, ''), o.business_id, 'online', o.id, o.account_id,
       CASE WHEN o.status = 'cancelled' THEN 'cancelled' ELSE 'redeemed' END,
       o.promo_value, o.subtotal, o.total, o.created_at, o.created_at
FROM public.online_orders o
WHERE o.promo_code_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.promotion_redemptions r WHERE r.order_id = o.id);

-- The online shop's own check: same table, now with the till-only, archive, cap and the
-- shared use count.
CREATE OR REPLACE FUNCTION public.fn_promo_value(p_promo public.website_promo_codes, p_subtotal numeric, p_account_id uuid)
RETURNS numeric LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uses integer;
BEGIN
    IF p_promo.archived_at IS NOT NULL OR p_promo.origin <> 'manual' OR NOT p_promo.active
       OR (p_promo.starts_at IS NOT NULL AND now() < p_promo.starts_at) THEN
        RAISE EXCEPTION 'That promo code isn''t active yet.';
    END IF;
    IF NOT p_promo.use_online THEN
        RAISE EXCEPTION 'That code can only be used in our shop.';
    END IF;
    IF p_promo.ends_at IS NOT NULL AND now() >= p_promo.ends_at THEN
        RAISE EXCEPTION 'That promo code has expired.';
    END IF;
    IF p_subtotal < p_promo.min_order THEN
        RAISE EXCEPTION 'That code needs an order of at least % in products.', p_promo.min_order;
    END IF;
    IF p_promo.max_uses IS NOT NULL THEN
        SELECT count(*) INTO v_uses FROM public.promotion_redemptions r
        WHERE r.promotion_id = p_promo.id AND public.fn_promo_counts(r.status, r.expires_at);
        IF v_uses >= p_promo.max_uses THEN
            RAISE EXCEPTION 'That promo code has been fully used.';
        END IF;
    END IF;
    IF p_account_id IS NOT NULL AND p_promo.once_per_customer AND EXISTS (
        SELECT 1 FROM public.promotion_redemptions r
        WHERE r.promotion_id = p_promo.id AND r.account_id = p_account_id AND public.fn_promo_counts(r.status, r.expires_at)
    ) THEN
        RAISE EXCEPTION 'You have already used that promo code.';
    END IF;
    RETURN LEAST(p_subtotal, COALESCE(p_promo.max_discount, p_subtotal),
        CASE WHEN p_promo.kind = 'percent' THEN round(p_subtotal * p_promo.value / 100, 2) ELSE p_promo.value END);
END;
$$;

-- ============================================================================ till sale in one go
-- A paid sale with a promotion: header and items in one database transaction, so the
-- deferred check above sees the items. Runs as the caller: the same row rules as the app's
-- own inserts apply (pos.create_sale).
CREATE OR REPLACE FUNCTION public.record_till_sale(p_sale jsonb, p_items jsonb) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = public AS $$
DECLARE
    v_id  uuid;
    v_b   uuid := (p_sale->>'business_id')::uuid;
    v_ref text := NULLIF(p_sale->>'reference_id', '');
BEGIN
    IF v_ref IS NOT NULL THEN
        SELECT id INTO v_id FROM public.transactions WHERE business_id = v_b AND reference_id = v_ref AND deleted_at IS NULL;
        IF FOUND THEN RETURN v_id; END IF;
    END IF;
    IF COALESCE(p_sale->>'payment_method', '') IN ('Credit', 'Credit_Debt') THEN
        RAISE EXCEPTION 'Credit sales are saved with process_customer_transaction.';
    END IF;
    IF jsonb_array_length(COALESCE(p_items, '[]'::jsonb)) = 0 THEN
        RAISE EXCEPTION 'The cart is empty.';
    END IF;
    INSERT INTO public.transactions (id, business_id, total, discount, tax, final_total, amount_paid, wallet_applied,
        payment_method, customer_id, customer_name, staff_id, staff_name, status, timestamp, note, is_delivery,
        delivery_fee, delivery_mode, rider_pay, rider_name, reference_id, promotion_redemption_id)
    VALUES (COALESCE((p_sale->>'id')::uuid, gen_random_uuid()), v_b,
        (p_sale->>'total')::numeric, COALESCE((p_sale->>'discount')::numeric, 0), COALESCE((p_sale->>'tax')::numeric, 0),
        (p_sale->>'final_total')::numeric, (p_sale->>'final_total')::numeric, 0,
        (p_sale->>'payment_method')::public.payment_method, (p_sale->>'customer_id')::uuid, NULLIF(p_sale->>'customer_name', ''),
        (p_sale->>'staff_id')::uuid, COALESCE(p_sale->>'staff_name', 'Staff'), 'Synced',
        COALESCE((p_sale->>'timestamp')::timestamptz, now()), p_sale->>'note', COALESCE((p_sale->>'is_delivery')::boolean, false),
        COALESCE((p_sale->>'delivery_fee')::numeric, 0),
        CASE WHEN COALESCE((p_sale->>'is_delivery')::boolean, false) THEN COALESCE(p_sale->>'delivery_mode', 'charged') ELSE 'charged' END,
        CASE WHEN COALESCE((p_sale->>'is_delivery')::boolean, false) THEN GREATEST(COALESCE((p_sale->>'rider_pay')::numeric, 0), 0) ELSE 0 END,
        NULLIF(p_sale->>'rider_name', ''), v_ref, (p_sale->>'promotion_redemption_id')::uuid)
    RETURNING id INTO v_id;
    INSERT INTO public.transaction_items (transaction_id, product_id, product_name, unit_price, quantity, discount_percentage, line_total)
    SELECT v_id, x.product_id, COALESCE(x.product_name, 'Item'), x.unit_price, x.quantity, COALESCE(x.discount_percentage, 0),
           round(x.unit_price * (1 - COALESCE(x.discount_percentage, 0) / 100) * x.quantity, 2)
    FROM jsonb_to_recordset(p_items) AS x(product_id uuid, product_name text, unit_price numeric, quantity numeric, discount_percentage numeric);
    RETURN v_id;
END;
$$;

-- ============================================================================ managing promotions
-- One call saves a promotion with what it covers, who and where. p_doc keys (camelCase):
-- name, code, description, promoType, kind, value, maxDiscount, minOrder, startsAt, endsAt,
-- maxUses, oncePerCustomer, stackable, audience, productScope, productIds[], categories[],
-- customerIds[], branchIds[], buyQty, rewardProductId, rewardQty, usePos, useOnline,
-- showOnWebsite, active.
CREATE OR REPLACE FUNCTION public.save_promotion(p_business_id uuid, p_id uuid, p_doc jsonb) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
    d        jsonb := COALESCE(p_doc, '{}'::jsonb);
    v_type   text := COALESCE(d->>'promoType', 'percentage');
    v_kind   text := d->>'kind';
    v_aud    text := COALESCE(d->>'audience', 'everyone');
    v_scope  text := COALESCE(d->>'productScope', 'all');
    v_code   text := public.fn_promo_norm_code(d->>'code');
    v_name   text := NULLIF(trim(COALESCE(d->>'name', '')), '');
    v_value  numeric := COALESCE(NULLIF(d->>'value', '')::numeric, 0);
    v_min    numeric := COALESCE(NULLIF(d->>'minOrder', '')::numeric, 0);
    v_maxd   numeric := NULLIF(d->>'maxDiscount', '')::numeric;
    v_uses   int := NULLIF(d->>'maxUses', '')::int;
    v_start  timestamptz := NULLIF(d->>'startsAt', '')::timestamptz;
    v_end    timestamptz := NULLIF(d->>'endsAt', '')::timestamptz;
    v_buy    numeric := NULLIF(d->>'buyQty', '')::numeric;
    v_rprod  uuid := NULLIF(d->>'rewardProductId', '')::uuid;
    v_rqty   numeric := NULLIF(d->>'rewardQty', '')::numeric;
    v_pos    boolean := COALESCE((d->>'usePos')::boolean, true);
    v_online boolean := COALESCE((d->>'useOnline')::boolean, false);
    v_show   boolean := COALESCE((d->>'showOnWebsite')::boolean, false);
    v_by     text;
    v_old    public.website_promo_codes%ROWTYPE;
    v_id     uuid;
    v_n      int;
BEGIN
    PERFORM public.assert_business_member(p_business_id);
    PERFORM public.assert_permission(p_business_id, 'promotions.manage');
    v_by := COALESCE((public.fn_my_employee(p_business_id)).name, 'Staff');

    IF p_id IS NOT NULL THEN
        SELECT * INTO v_old FROM public.website_promo_codes WHERE id = p_id AND business_id = p_business_id FOR UPDATE;
        IF NOT FOUND THEN RAISE EXCEPTION 'That promotion was not found at this branch.'; END IF;
        IF v_old.origin <> 'manual' THEN RAISE EXCEPTION 'Referral codes and rewards are managed in Promotions → Referrals.'; END IF;
        IF v_old.archived_at IS NOT NULL THEN RAISE EXCEPTION 'Restore the promotion before changing it.'; END IF;
    END IF;

    -- What each type means. The type only presets the generic fields.
    IF v_type = 'referral' THEN
        RAISE EXCEPTION 'Referral codes belong to customers: set them up in Promotions → Referrals.';
    ELSIF v_type = 'percentage' THEN v_kind := 'percent';
    ELSIF v_type = 'fixed' THEN v_kind := 'amount';
    ELSIF v_type = 'buy_x_get_y' THEN
        v_kind := 'free_items';
        IF v_buy IS NULL OR v_buy <= 0 THEN RAISE EXCEPTION 'Say how many the customer must buy.'; END IF;
    ELSIF v_type = 'free_product' THEN v_kind := 'free_items'; v_buy := NULL;
    ELSIF v_type = 'min_spend' THEN
        IF v_min <= 0 THEN RAISE EXCEPTION 'Say how much the customer must spend.'; END IF;
    ELSIF v_type = 'customer' THEN v_aud := 'selected';
    ELSIF v_type = 'first_purchase' THEN v_aud := 'first_purchase';
    ELSE RAISE EXCEPTION 'Unknown promotion type %.', v_type;
    END IF;
    IF v_kind IS NULL OR v_kind NOT IN ('percent', 'amount', 'free_items') THEN
        RAISE EXCEPTION 'Choose what the promotion gives: a percentage, an amount or free items.';
    END IF;
    IF v_aud NOT IN ('everyone', 'selected', 'first_purchase') THEN RAISE EXCEPTION 'Choose who can use the code.'; END IF;
    IF v_scope NOT IN ('all', 'products', 'categories') THEN RAISE EXCEPTION 'Choose what the promotion covers.'; END IF;
    IF v_kind <> 'free_items' THEN v_buy := NULL; v_rprod := NULL; v_rqty := NULL; END IF;

    IF v_name IS NULL THEN RAISE EXCEPTION 'Give the promotion a name.'; END IF;
    IF length(v_name) > 80 THEN RAISE EXCEPTION 'Keep the name under 80 characters.'; END IF;
    IF v_code = '' THEN v_code := public.fn_promo_new_code(p_business_id); END IF;
    IF v_code !~ '^[A-Z0-9][A-Z0-9-]{2,23}$' THEN
        RAISE EXCEPTION 'A code is 3 to 24 letters, numbers or dashes, starting with a letter or number.';
    END IF;
    IF v_kind = 'percent' AND (v_value <= 0 OR v_value > 90) THEN RAISE EXCEPTION 'A percentage is between 1 and 90.'; END IF;
    IF v_kind = 'amount' AND v_value <= 0 THEN RAISE EXCEPTION 'Type the amount off.'; END IF;
    IF v_kind = 'free_items' THEN
        IF v_rprod IS NULL OR NOT EXISTS (SELECT 1 FROM public.products WHERE id = v_rprod AND business_id = p_business_id) THEN
            RAISE EXCEPTION 'Choose the free product.';
        END IF;
        IF v_rqty IS NULL OR v_rqty <= 0 THEN RAISE EXCEPTION 'Say how many are free.'; END IF;
        v_value := 0;
    END IF;
    IF v_min < 0 THEN RAISE EXCEPTION 'The minimum purchase can''t be below zero.'; END IF;
    IF v_maxd IS NOT NULL AND v_maxd <= 0 THEN v_maxd := NULL; END IF;
    IF v_uses IS NOT NULL AND v_uses <= 0 THEN RAISE EXCEPTION 'The number of uses must be at least 1, or left empty for no limit.'; END IF;
    IF v_start IS NOT NULL AND v_end IS NOT NULL AND v_end <= v_start THEN RAISE EXCEPTION 'The end must be after the start.'; END IF;
    IF v_online AND (v_kind NOT IN ('percent', 'amount') OR v_aud <> 'everyone' OR v_scope <> 'all') THEN
        RAISE EXCEPTION 'The online shop takes only percentage or amount codes for everyone on all products.';
    END IF;
    IF NOT v_pos AND NOT v_online THEN RAISE EXCEPTION 'Choose where the code works: at the till, online, or both.'; END IF;
    IF NOT v_online THEN v_show := false; END IF;
    IF v_scope = 'products' AND jsonb_array_length(COALESCE(d->'productIds', '[]')) = 0 THEN RAISE EXCEPTION 'Choose the products it covers.'; END IF;
    IF v_scope = 'categories' AND jsonb_array_length(COALESCE(d->'categories', '[]')) = 0 THEN RAISE EXCEPTION 'Choose the categories it covers.'; END IF;
    IF v_aud = 'selected' AND jsonb_array_length(COALESCE(d->'customerIds', '[]')) = 0 THEN RAISE EXCEPTION 'Choose the customers who can use it.'; END IF;

    -- Codes are unique at this branch and at every branch it is switched on.
    IF EXISTS (SELECT 1 FROM public.website_promo_codes WHERE business_id = p_business_id AND code = v_code AND id IS DISTINCT FROM p_id) THEN
        RAISE EXCEPTION 'The code % is already used here. Choose another.', v_code;
    END IF;
    SELECT count(*) INTO v_n FROM jsonb_array_elements_text(COALESCE(d->'branchIds', '[]')) bid
    WHERE bid::uuid <> p_business_id AND (
        NOT public.fn_branches_share_owner(p_business_id, bid::uuid)
        OR EXISTS (SELECT 1 FROM public.website_promo_codes x WHERE x.business_id = bid::uuid AND x.code = v_code)
        OR EXISTS (SELECT 1 FROM public.promotion_branches pb JOIN public.website_promo_codes x ON x.id = pb.promotion_id
                   WHERE pb.business_id = bid::uuid AND x.code = v_code AND x.id IS DISTINCT FROM p_id));
    IF v_n > 0 THEN
        RAISE EXCEPTION 'The code % is already used at one of the chosen branches, or a branch isn''t yours.', v_code;
    END IF;

    IF p_id IS NULL THEN
        INSERT INTO public.website_promo_codes (business_id, code, name, description, promo_type, kind, value, min_order,
            max_discount, starts_at, ends_at, max_uses, once_per_customer, stackable, audience, product_scope, buy_qty,
            reward_product_id, reward_qty, use_pos, use_online, show_on_website, active, created_by, updated_by)
        VALUES (p_business_id, v_code, v_name, NULLIF(trim(COALESCE(d->>'description', '')), ''), v_type, v_kind, v_value, v_min,
            v_maxd, v_start, v_end, v_uses, COALESCE((d->>'oncePerCustomer')::boolean, false), COALESCE((d->>'stackable')::boolean, false),
            v_aud, v_scope, v_buy, v_rprod, v_rqty, v_pos, v_online, v_show, COALESCE((d->>'active')::boolean, true), v_by, v_by)
        RETURNING id INTO v_id;
    ELSE
        v_id := p_id;
        UPDATE public.website_promo_codes SET code = v_code, name = v_name,
            description = NULLIF(trim(COALESCE(d->>'description', '')), ''), promo_type = v_type, kind = v_kind,
            value = v_value, min_order = v_min, max_discount = v_maxd, starts_at = v_start, ends_at = v_end,
            max_uses = v_uses, once_per_customer = COALESCE((d->>'oncePerCustomer')::boolean, false),
            stackable = COALESCE((d->>'stackable')::boolean, false), audience = v_aud, product_scope = v_scope,
            buy_qty = v_buy, reward_product_id = v_rprod, reward_qty = v_rqty, use_pos = v_pos, use_online = v_online,
            show_on_website = v_show, active = COALESCE((d->>'active')::boolean, active), updated_by = v_by, updated_at = now()
        WHERE id = v_id;
    END IF;

    DELETE FROM public.promotion_products WHERE promotion_id = v_id;
    DELETE FROM public.promotion_categories WHERE promotion_id = v_id;
    DELETE FROM public.promotion_customers WHERE promotion_id = v_id;
    DELETE FROM public.promotion_branches WHERE promotion_id = v_id;
    IF v_scope = 'products' THEN
        INSERT INTO public.promotion_products (promotion_id, product_id)
        SELECT DISTINCT v_id, pr.id FROM jsonb_array_elements_text(d->'productIds') x JOIN public.products pr ON pr.id = x::uuid
        WHERE pr.business_id = p_business_id;
    ELSIF v_scope = 'categories' THEN
        INSERT INTO public.promotion_categories (promotion_id, category)
        SELECT DISTINCT v_id, trim(x) FROM jsonb_array_elements_text(d->'categories') x WHERE trim(x) <> '';
    END IF;
    IF v_aud = 'selected' THEN
        INSERT INTO public.promotion_customers (promotion_id, customer_id)
        SELECT DISTINCT v_id, c.id FROM jsonb_array_elements_text(d->'customerIds') x JOIN public.customers c ON c.id = x::uuid
        WHERE c.business_id = p_business_id AND c.deleted_at IS NULL;
    END IF;
    INSERT INTO public.promotion_branches (promotion_id, business_id)
    SELECT DISTINCT v_id, x::uuid FROM jsonb_array_elements_text(COALESCE(d->'branchIds', '[]')) x WHERE x::uuid <> p_business_id;
    RETURN v_id;
END;
$$;

-- Switch on or off, archive (keeps every record; the code stops working) or restore.
CREATE OR REPLACE FUNCTION public.set_promotion_status(p_id uuid, p_action text) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE p public.website_promo_codes%ROWTYPE;
BEGIN
    SELECT * INTO p FROM public.website_promo_codes WHERE id = p_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'That promotion was not found.'; END IF;
    PERFORM public.assert_business_member(p.business_id);
    PERFORM public.assert_permission(p.business_id, 'promotions.manage');
    IF p.origin <> 'manual' THEN
        RAISE EXCEPTION 'Referral codes and rewards are managed in Promotions → Referrals.';
    END IF;
    IF p_action = 'activate' THEN
        IF p.archived_at IS NOT NULL THEN RAISE EXCEPTION 'Restore the promotion first.'; END IF;
        UPDATE public.website_promo_codes SET active = true, updated_at = now() WHERE id = p_id;
    ELSIF p_action = 'deactivate' THEN
        UPDATE public.website_promo_codes SET active = false, updated_at = now() WHERE id = p_id;
    ELSIF p_action = 'archive' THEN
        UPDATE public.website_promo_codes SET active = false, show_on_website = false, archived_at = now(), updated_at = now() WHERE id = p_id;
    ELSIF p_action = 'restore' THEN
        UPDATE public.website_promo_codes SET archived_at = NULL, updated_at = now() WHERE id = p_id;
    ELSE
        RAISE EXCEPTION 'Unknown action %.', p_action;
    END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.promo_generate_code(p_business_id uuid, p_prefix text DEFAULT '') RETURNS text
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
BEGIN
    PERFORM public.assert_business_member(p_business_id);
    PERFORM public.assert_permission(p_business_id, 'promotions.manage');
    RETURN public.fn_promo_new_code(p_business_id, p_prefix);
END;
$$;

-- Every promotion of this branch (and ones shared to it) with its rules and use so far.
CREATE OR REPLACE FUNCTION public.promotions_list(p_business_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
    PERFORM public.assert_business_member(p_business_id);
    PERFORM public.assert_permission(p_business_id, 'promotions.view', 'promotions.manage');
    RETURN COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
            'id', p.id, 'code', p.code, 'name', COALESCE(p.name, p.code), 'description', p.description,
            'promoType', p.promo_type, 'kind', p.kind, 'value', p.value, 'maxDiscount', p.max_discount,
            'minOrder', p.min_order, 'startsAt', p.starts_at, 'endsAt', p.ends_at, 'maxUses', p.max_uses,
            'oncePerCustomer', p.once_per_customer, 'stackable', p.stackable, 'audience', p.audience,
            'productScope', p.product_scope, 'buyQty', p.buy_qty, 'rewardProductId', p.reward_product_id,
            'rewardQty', p.reward_qty, 'usePos', p.use_pos, 'useOnline', p.use_online, 'showOnWebsite', p.show_on_website,
            'active', p.active, 'archivedAt', p.archived_at, 'createdAt', p.created_at, 'createdBy', p.created_by,
            'ownBranch', p.business_id = p_business_id, 'origin', p.origin,
            'status', public.fn_promo_status(p), 'summary', public.fn_promo_summary(p),
            'productIds', COALESCE((SELECT jsonb_agg(product_id) FROM public.promotion_products WHERE promotion_id = p.id), '[]'),
            'categories', COALESCE((SELECT jsonb_agg(category) FROM public.promotion_categories WHERE promotion_id = p.id), '[]'),
            'customerIds', COALESCE((SELECT jsonb_agg(customer_id) FROM public.promotion_customers WHERE promotion_id = p.id), '[]'),
            'branchIds', COALESCE((SELECT jsonb_agg(business_id) FROM public.promotion_branches WHERE promotion_id = p.id), '[]'),
            'uses', (SELECT count(*) FROM public.promotion_redemptions r WHERE r.promotion_id = p.id AND r.status IN ('redeemed', 'partially_refunded')),
            'held', (SELECT count(*) FROM public.promotion_redemptions r WHERE r.promotion_id = p.id AND r.status = 'reserved' AND r.expires_at > now()),
            'discountGiven', (SELECT COALESCE(SUM(discount), 0) FROM public.promotion_redemptions r WHERE r.promotion_id = p.id AND r.status IN ('redeemed', 'partially_refunded'))
        ) ORDER BY p.archived_at NULLS FIRST, p.created_at DESC)
        FROM public.website_promo_codes p
        WHERE p.origin = 'manual' AND (p.business_id = p_business_id
              OR EXISTS (SELECT 1 FROM public.promotion_branches pb WHERE pb.promotion_id = p.id AND pb.business_id = p_business_id))
    ), '[]'::jsonb);
END;
$$;

-- Uses of one promotion, newest first.
CREATE OR REPLACE FUNCTION public.promotion_redemptions_list(p_promotion_id uuid, p_limit int DEFAULT 100) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_b uuid;
BEGIN
    SELECT business_id INTO v_b FROM public.website_promo_codes WHERE id = p_promotion_id;
    IF v_b IS NULL THEN RAISE EXCEPTION 'That promotion was not found.'; END IF;
    PERFORM public.assert_business_member(v_b);
    PERFORM public.assert_permission(v_b, 'promotions.view', 'promotions.manage');
    RETURN COALESCE((
        SELECT jsonb_agg(x ORDER BY x->>'at' DESC) FROM (
            SELECT jsonb_build_object('id', r.id, 'at', COALESCE(r.redeemed_at, r.reserved_at), 'status', r.status,
                'channel', r.channel, 'discount', r.discount, 'saleTotal', r.sale_total, 'refunded', r.refunded_amount,
                'customer', c.name, 'staff', r.staff_name, 'branch', b.name, 'endReason', r.end_reason,
                'receipt', CASE WHEN r.transaction_id IS NOT NULL THEN public.fn_receipt_number(r.transaction_id) END,
                'order', o.order_number) AS x
            FROM public.promotion_redemptions r
            LEFT JOIN public.customers c ON c.id = r.customer_id
            LEFT JOIN public.businesses b ON b.id = r.business_id
            LEFT JOIN public.online_orders o ON o.id = r.order_id
            WHERE r.promotion_id = p_promotion_id AND r.status NOT IN ('released')
            ORDER BY COALESCE(r.redeemed_at, r.reserved_at) DESC
            LIMIT LEAST(GREATEST(p_limit, 1), 500)) s
    ), '[]'::jsonb);
END;
$$;

-- ============================================================================ dashboard
-- Figures for one branch and period. Sales "with a promotion" are not extra sales the
-- promotion caused: they are sales where a code was used. Gross = before any discount;
-- net = after all discounts, without VAT and delivery.
CREATE OR REPLACE FUNCTION public.promotion_dashboard(p_business_id uuid, p_from date, p_to date) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_from timestamptz := (p_from::timestamp AT TIME ZONE 'Africa/Nairobi');
    v_to   timestamptz := ((p_to + 1)::timestamp AT TIME ZONE 'Africa/Nairobi');
    v_res  jsonb;
BEGIN
    PERFORM public.assert_business_member(p_business_id);
    PERFORM public.assert_permission(p_business_id, 'promotions.view', 'promotions.manage');
    IF p_to < p_from THEN RAISE EXCEPTION 'The end date is before the start date.'; END IF;

    WITH u AS (   -- uses in the period, with what the sale was worth
        SELECT r.*, p.name AS promo_name,
               CASE WHEN r.channel = 'pos' THEN t.total ELSE o.subtotal END AS gross,
               CASE WHEN r.channel = 'pos' THEN GREATEST(t.discount - r.discount, 0) ELSE COALESCE(o.points_value, 0) END AS other_disc,
               CASE WHEN r.channel = 'pos' THEN t.final_total - t.tax - t.delivery_fee ELSE o.subtotal - r.discount - COALESCE(o.points_value, 0) END AS net
        FROM public.promotion_redemptions r
        JOIN public.website_promo_codes p ON p.id = r.promotion_id
        LEFT JOIN public.transactions t ON t.id = r.transaction_id
        LEFT JOIN public.online_orders o ON o.id = r.order_id
        WHERE r.business_id = p_business_id AND r.redeemed_at >= v_from AND r.redeemed_at < v_to
          AND r.status IN ('redeemed', 'partially_refunded', 'refunded')
    ), live AS (SELECT * FROM u WHERE status IN ('redeemed', 'partially_refunded')),
    plain AS (    -- till sales without a code, to compare the average sale
        SELECT count(*) AS n, COALESCE(AVG(t.final_total - t.tax - t.delivery_fee), 0) AS avg_net
        FROM public.transactions t
        WHERE t.business_id = p_business_id AND t.deleted_at IS NULL AND t.promotion_redemption_id IS NULL
          AND t.timestamp >= v_from AND t.timestamp < v_to
    ), promos AS (
        SELECT p.*, public.fn_promo_status(p) AS st FROM public.website_promo_codes p
        WHERE p.origin = 'manual' AND p.business_id = p_business_id
    )
    SELECT jsonb_build_object(
        'counts', (SELECT jsonb_build_object(
            'total', count(*), 'active', count(*) FILTER (WHERE st = 'active'),
            'scheduled', count(*) FILTER (WHERE st = 'scheduled'), 'expired', count(*) FILTER (WHERE st IN ('expired', 'used_up')),
            'off', count(*) FILTER (WHERE st = 'off'), 'archived', count(*) FILTER (WHERE st = 'archived')) FROM promos),
        'totals', (SELECT jsonb_build_object(
            'redemptions', count(*), 'discount', COALESCE(SUM(discount), 0),
            'grossSales', COALESCE(SUM(gross), 0), 'otherDiscounts', COALESCE(SUM(other_disc), 0),
            'netSales', COALESCE(SUM(net), 0), 'avgNet', COALESCE(AVG(net), 0),
            'customers', count(DISTINCT COALESCE(customer_id::text, account_id::text))) FROM live),
        'refunds', (SELECT jsonb_build_object('count', count(*) FILTER (WHERE status = 'refunded'),
            'partial', count(*) FILTER (WHERE status = 'partially_refunded'),
            'amount', COALESCE(SUM(refunded_amount), 0)) FROM u),
        'withoutPromotion', (SELECT jsonb_build_object('sales', n, 'avgNet', avg_net) FROM plain),
        'byPromotion', COALESCE((SELECT jsonb_agg(x ORDER BY (x->>'uses')::int DESC, (x->>'netSales')::numeric DESC) FROM (
            SELECT jsonb_build_object('promotionId', promotion_id, 'code', max(code), 'name', max(promo_name),
                'uses', count(*), 'discount', SUM(discount), 'grossSales', SUM(gross), 'netSales', SUM(net),
                'netPerShilling', CASE WHEN SUM(discount) > 0 THEN round(SUM(net) / SUM(discount), 2) END,
                'discountShare', CASE WHEN SUM(gross) > 0 THEN round(SUM(discount) * 100 / SUM(gross), 1) END) AS x
            FROM live GROUP BY promotion_id) s), '[]'),
        'byProduct', COALESCE((SELECT jsonb_agg(x ORDER BY (x->>'discount')::numeric DESC) FROM (
            SELECT jsonb_build_object('productId', l->>'productId', 'name', max(l->>'name'), 'category', max(l->>'category'),
                'quantity', SUM((l->>'quantity')::numeric), 'net', SUM((l->>'net')::numeric),
                'discount', SUM((l->>'discount')::numeric), 'uses', count(DISTINCT live.id)) AS x
            FROM live, jsonb_array_elements(live.lines) l
            GROUP BY l->>'productId' LIMIT 50) s), '[]'),
        'byDay', COALESCE((SELECT jsonb_agg(x ORDER BY x->>'date') FROM (
            SELECT jsonb_build_object('date', (redeemed_at AT TIME ZONE 'Africa/Nairobi')::date, 'uses', count(*),
                'discount', SUM(discount), 'netSales', SUM(net)) AS x
            FROM live GROUP BY (redeemed_at AT TIME ZONE 'Africa/Nairobi')::date) s), '[]')
    ) INTO v_res;
    RETURN v_res;
END;
$$;

-- ============================================================================ credit sales carry the promotion
DROP FUNCTION IF EXISTS public.process_customer_transaction(uuid, uuid, text, uuid, text, numeric, numeric, numeric, numeric, numeric, public.payment_method, timestamptz, text, boolean, numeric, text, text, jsonb, text, numeric);

CREATE FUNCTION "public"."process_customer_transaction"("p_business_id" "uuid", "p_customer_id" "uuid", "p_customer_name" "text", "p_staff_id" "uuid", "p_staff_name" "text", "p_total" numeric, "p_discount" numeric, "p_tax" numeric, "p_final_total" numeric, "p_amount_paid" numeric, "p_payment_method" "public"."payment_method", "p_timestamp" timestamp with time zone, "p_note" "text", "p_is_delivery" boolean, "p_delivery_fee" numeric, "p_rider_name" "text", "p_reference_id" "text", "p_items" "jsonb", "p_delivery_mode" "text" DEFAULT 'charged', "p_rider_pay" numeric DEFAULT 0, "p_promotion_redemption_id" "uuid" DEFAULT NULL) RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
    v_tx_id          UUID;
    v_wallet_before  NUMERIC(14,2);
    v_wallet_after   NUMERIC(14,2);
    v_debt_before    NUMERIC(14,2);
    v_debt_after     NUMERIC(14,2);
    v_wallet_used    NUMERIC(14,2);
    v_debt_created   NUMERIC(14,2);
    v_item           JSONB;
    v_line_total     NUMERIC(14,2);
BEGIN
    PERFORM public.assert_permission(p_business_id, 'pos.create_sale');
    PERFORM public.assert_business_member(p_business_id); IF p_customer_id IS NOT NULL THEN PERFORM public.assert_business_member((SELECT business_id FROM public.customers WHERE id = p_customer_id)); END IF; PERFORM public.assert_business_member(pr.business_id) FROM public.products pr WHERE pr.id IN (SELECT (e->>'product_id')::UUID FROM jsonb_array_elements(COALESCE(p_items, '[]'::JSONB)) e WHERE e->>'product_id' IS NOT NULL);
    -- Idempotency check: if this reference_id was already processed, return existing tx
    IF p_reference_id IS NOT NULL THEN
        SELECT id INTO v_tx_id
        FROM public.transactions
        WHERE business_id = p_business_id
          AND reference_id = p_reference_id
          AND deleted_at IS NULL;

        IF FOUND THEN
            RETURN v_tx_id;
        END IF;
    END IF;

    -- Validate customer exists
    IF NOT EXISTS (SELECT 1 FROM public.customers WHERE id = p_customer_id) THEN
        RAISE EXCEPTION 'Customer not found: %', p_customer_id;
    END IF;

    -- Fetch current balances
    SELECT wallet_balance, debt_balance
    INTO v_wallet_before, v_debt_before
    FROM public.customers
    WHERE id = p_customer_id;

    v_wallet_before := COALESCE(v_wallet_before, 0);
    v_debt_before   := COALESCE(v_debt_before, 0);

    -- Compute wallet usage and debt creation
    -- For credit sales: wallet is applied first, remaining becomes debt
    IF p_payment_method IN ('Credit_Debt', 'Credit') THEN
        v_wallet_used  := LEAST(v_wallet_before, p_final_total);
        v_debt_created := GREATEST(0, p_final_total - v_wallet_used);
    ELSE
        v_wallet_used  := 0;
        v_debt_created := 0;
    END IF;

    -- Insert transaction header
    INSERT INTO public.transactions
        (business_id, total, discount, tax, final_total, amount_paid,
         wallet_applied, payment_method, customer_id, customer_name,
         staff_id, staff_name, status, timestamp, note, is_delivery,
         delivery_fee, rider_name, reference_id, delivery_mode, rider_pay, promotion_redemption_id)
    VALUES (
        p_business_id, p_total, p_discount, p_tax, p_final_total,
        p_amount_paid, v_wallet_used, p_payment_method, p_customer_id,
        p_customer_name, p_staff_id, p_staff_name, 'Synced',
        COALESCE(p_timestamp, NOW()), p_note, COALESCE(p_is_delivery, FALSE),
        COALESCE(p_delivery_fee, 0), p_rider_name, p_reference_id,
        CASE WHEN COALESCE(p_is_delivery, FALSE) THEN COALESCE(p_delivery_mode, 'charged') ELSE 'charged' END,
        CASE WHEN COALESCE(p_is_delivery, FALSE) THEN GREATEST(COALESCE(p_rider_pay, 0), 0) ELSE 0 END,
        p_promotion_redemption_id
    )
    RETURNING id INTO v_tx_id;

    -- Insert transaction items
    IF p_items IS NOT NULL AND jsonb_array_length(p_items) > 0 THEN
        FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
        LOOP
            v_line_total := ROUND(
                (COALESCE((v_item->>'unit_price')::NUMERIC, 0) *
                 (1 - COALESCE((v_item->>'discount_percentage')::NUMERIC, 0) / 100)) *
                COALESCE((v_item->>'quantity')::NUMERIC, 1),
                2
            );

            INSERT INTO public.transaction_items
                (transaction_id, product_id, product_name, unit_price,
                 quantity, discount_percentage, line_total)
            VALUES (
                v_tx_id,
                (v_item->>'product_id')::UUID,
                COALESCE(v_item->>'product_name', 'Unknown Product'),
                COALESCE((v_item->>'unit_price')::NUMERIC, 0),
                COALESCE((v_item->>'quantity')::NUMERIC, 1),
                COALESCE((v_item->>'discount_percentage')::NUMERIC, 0),
                v_line_total
            );
        END LOOP;
    END IF;

    -- Apply wallet deduction
    IF v_wallet_used > 0 THEN
        v_wallet_after := GREATEST(0, v_wallet_before - v_wallet_used);

        UPDATE public.customers
        SET wallet_balance = v_wallet_after
        WHERE id = p_customer_id;

        INSERT INTO public.wallet_transactions
            (business_id, customer_id, amount, balance_before, balance_after,
             reason, transaction_id, recorded_by)
        VALUES (
            p_business_id, p_customer_id, -v_wallet_used,
            v_wallet_before, v_wallet_after,
            'Applied to checkout sale', v_tx_id, p_staff_name
        );

        INSERT INTO public.customer_ledger
            (business_id, customer_id, type, amount, wallet_balance, debt_balance,
             recorded_by, note, transaction_id, reference_id)
        VALUES (
            p_business_id, p_customer_id, 'wallet_usage', v_wallet_used,
            v_wallet_after, v_debt_before, p_staff_name,
            'Paid for order ' || v_tx_id::TEXT || ' using wallet credit',
            v_tx_id, 'tx-' || v_tx_id::TEXT || '-wallet-usage'
        )
        ON CONFLICT (business_id, reference_id) WHERE reference_id IS NOT NULL DO NOTHING;
    END IF;

    -- Create debt record if applicable
    IF v_debt_created > 0 THEN
        -- credit record: created by the sale trigger, once per sale

        v_debt_after := v_debt_before + v_debt_created;

        UPDATE public.customers
        SET debt_balance = v_debt_after
        WHERE id = p_customer_id;

        INSERT INTO public.customer_ledger
            (business_id, customer_id, type, amount, wallet_balance, debt_balance,
             recorded_by, note, transaction_id, reference_id)
        VALUES (
            p_business_id, p_customer_id, 'debt_creation', v_debt_created,
            COALESCE(v_wallet_after, v_wallet_before), v_debt_after, p_staff_name,
            'Outstanding balance for order ' || v_tx_id::TEXT || ' charged to debt',
            v_tx_id, 'tx-' || v_tx_id::TEXT || '-debt-creation'
        )
        ON CONFLICT (business_id, reference_id) WHERE reference_id IS NOT NULL DO NOTHING;
    END IF;

    RETURN v_tx_id;
END;
$$;

ALTER FUNCTION public.process_customer_transaction(uuid, uuid, text, uuid, text, numeric, numeric, numeric, numeric, numeric, public.payment_method, timestamptz, text, boolean, numeric, text, text, jsonb, text, numeric, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.process_customer_transaction(uuid, uuid, text, uuid, text, numeric, numeric, numeric, numeric, numeric, public.payment_method, timestamptz, text, boolean, numeric, text, text, jsonb, text, numeric, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.process_customer_transaction(uuid, uuid, text, uuid, text, numeric, numeric, numeric, numeric, numeric, public.payment_method, timestamptz, text, boolean, numeric, text, text, jsonb, text, numeric, uuid) TO authenticated, service_role;

-- ============================================================================ held uses time out
DO $do$ BEGIN
    IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
        PERFORM cron.schedule('expire-promotion-holds', '*/5 * * * *',
            $job$UPDATE public.promotion_redemptions SET status = 'expired', ended_at = now(), end_reason = 'Hold timed out'
                 WHERE status = 'reserved' AND expires_at < now()$job$);
    END IF;
END $do$;

-- ============================================================================ who may call what
DO $do$
DECLARE f text;
BEGIN
    -- Internal: only other database functions use these.
    FOREACH f IN ARRAY ARRAY[
        'public.fn_promo_status(public.website_promo_codes)', 'public.fn_my_employee(uuid)', 'public.fn_promo_find(uuid, text)',
        'public.fn_promo_new_code(uuid, text)', 'public.fn_promo_evaluate(public.website_promo_codes, uuid, uuid, jsonb, numeric, uuid)',
        'public.fn_promo_summary(public.website_promo_codes)', 'public.fn_promo_redemption_guard()', 'public.fn_sale_promotion_stamp()',
        'public.fn_sale_promotion_commit()', 'public.fn_sale_promotion_cancel()', 'public.fn_sale_promotion_refund()',
        'public.fn_order_promotion_sync()', 'public.fn_promo_after_redeem(uuid)', 'public.fn_promo_after_end(uuid)']
    LOOP
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', f);
        EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', f);
    END LOOP;
    -- Called by the app; each checks the signed-in person's permission itself.
    FOREACH f IN ARRAY ARRAY[
        'public.promo_check(uuid, text, uuid, jsonb, numeric)', 'public.promo_reserve(uuid, text, uuid, jsonb, numeric, text)',
        'public.promo_release(uuid)', 'public.record_till_sale(jsonb, jsonb)', 'public.save_promotion(uuid, uuid, jsonb)',
        'public.set_promotion_status(uuid, text)', 'public.promo_generate_code(uuid, text)', 'public.promotions_list(uuid)',
        'public.promotion_redemptions_list(uuid, integer)', 'public.promotion_dashboard(uuid, date, date)']
    LOOP
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', f);
        EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', f);
    END LOOP;
END $do$;
