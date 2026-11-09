-- The second half of the loyalty points rule (20261108002). That file was applied to the live
-- database while it held only its first half (earning rule, conversion, tier levels), and a
-- migration that has run is never run again, so these parts never reached it:
--   * point values by tier (fn_point_value) and the till, online, account and website uses of them
--   * debt-only redemption on the customer page (no wallet money from points)
--   * the redemption "kind" and the loyalty_points_earned log (the points report and
--     attach_sale_to_customer, 20261108003, need this table)
--   * customer names with every word capitalized
-- Everything here can run again safely, so a database built from scratch, which gets the
-- full 20261108002 first, ends up the same.

-- =============================================================================
-- 6. Points are worth less per point in higher tiers, so small customers feel the reward
--    and big spenders can't drain the business. Per KSh 1: Bronze 50 points (0.02 each),
--    Silver 100 (0.01), Gold 200 (0.005). Each business can change these.
-- =============================================================================
ALTER TABLE public.loyalty_settings
    ADD COLUMN IF NOT EXISTS value_bronze NUMERIC(10,4) NOT NULL DEFAULT 0.02  CHECK (value_bronze > 0),
    ADD COLUMN IF NOT EXISTS value_silver NUMERIC(10,4) NOT NULL DEFAULT 0.01  CHECK (value_silver > 0),
    ADD COLUMN IF NOT EXISTS value_gold   NUMERIC(10,4) NOT NULL DEFAULT 0.005 CHECK (value_gold > 0);

CREATE OR REPLACE FUNCTION public.fn_point_value(p_business_id UUID, p_tier public.customer_tier)
RETURNS NUMERIC
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT COALESCE(
        (SELECT CASE p_tier WHEN 'Gold' THEN s.value_gold WHEN 'Silver' THEN s.value_silver ELSE s.value_bronze END
         FROM public.loyalty_settings s WHERE s.business_id = p_business_id),
        CASE p_tier WHEN 'Gold' THEN 0.005 WHEN 'Silver' THEN 0.01 ELSE 0.02 END
    );
$$;
REVOKE ALL ON FUNCTION public.fn_point_value(UUID, public.customer_tier) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_point_value(UUID, public.customer_tier) TO authenticated, service_role;

-- Where points were used: 'till' (discount on a sale), 'online' (discount on an order),
-- 'account' (paid off debt on the customer's page). Only 'account' costs the business on
-- top of sales, because the other two already lowered the sale's total.
ALTER TABLE public.loyalty_redemptions
    ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'account' CHECK (kind IN ('till', 'online', 'account'));
UPDATE public.loyalty_redemptions SET kind = 'online' WHERE order_id IS NOT NULL AND kind <> 'online';
UPDATE public.loyalty_redemptions SET kind = 'till' WHERE transaction_id IS NOT NULL AND kind <> 'till';
CREATE INDEX IF NOT EXISTS idx_loyalty_redemptions_business_created ON public.loyalty_redemptions (business_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.spend_points_at_till(p_customer_id UUID, p_points INTEGER, p_recorded_by TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_customer public.customers%ROWTYPE;
    v_value_per NUMERIC(10,4);
    v_min INTEGER;
    v_value NUMERIC(14,2);
    v_id UUID;
BEGIN
    SELECT * INTO v_customer FROM public.customers WHERE id = p_customer_id AND deleted_at IS NULL FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Customer not found.';
    END IF;
    PERFORM public.assert_permission(v_customer.business_id, 'customers.loyalty');

    v_value_per := public.fn_point_value(v_customer.business_id, v_customer.tier);
    SELECT min_redeem_points INTO v_min
    FROM public.loyalty_settings WHERE business_id = v_customer.business_id;
    v_min := COALESCE(v_min, 100);

    IF p_points IS NULL OR p_points < v_min THEN
        RAISE EXCEPTION 'You can use points from % points.', v_min;
    END IF;
    IF p_points > v_customer.loyalty_points THEN
        RAISE EXCEPTION 'This customer only has % points.', v_customer.loyalty_points;
    END IF;

    v_value := round(p_points * v_value_per, 2);
    UPDATE public.customers SET loyalty_points = loyalty_points - p_points WHERE id = p_customer_id;
    INSERT INTO public.loyalty_redemptions (business_id, customer_id, points, value, recorded_by, kind)
    VALUES (v_customer.business_id, p_customer_id, p_points, v_value, COALESCE(NULLIF(trim(p_recorded_by), ''), 'Staff'), 'till')
    RETURNING id INTO v_id;

    RETURN jsonb_build_object('redemptionId', v_id, 'value', v_value);
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_build_online_order(
    p_account_id UUID,
    p_items      JSONB,
    p_fulfilment TEXT,
    p_address    TEXT,
    p_notes      TEXT,
    p_schedule_id UUID,
    p_zone_id    UUID DEFAULT NULL,
    p_points     INTEGER DEFAULT 0
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_account  public.customer_accounts%ROWTYPE;
    v_settings public.website_settings%ROWTYPE;
    v_order_id UUID;
    v_line     RECORD;
    v_subtotal NUMERIC(14,2) := 0;
    v_fee      NUMERIC(14,2) := 0;
    v_raw      NUMERIC(14,2);
    v_address  TEXT := NULLIF(trim(COALESCE(p_address, '')), '');
    v_zone     public.delivery_zones%ROWTYPE;
    v_customer public.customers%ROWTYPE;
    v_points   INTEGER := COALESCE(p_points, 0);
    v_point_value NUMERIC(10,4);
    v_min_redeem  INTEGER;
    v_points_value NUMERIC(14,2) := 0;
BEGIN
    SELECT * INTO v_account FROM public.customer_accounts WHERE id = p_account_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Please finish setting up your account first.';
    END IF;

    IF jsonb_typeof(p_items) IS DISTINCT FROM 'array'
       OR jsonb_array_length(p_items) NOT BETWEEN 1 AND 30 THEN
        RAISE EXCEPTION 'Your cart is empty.';
    END IF;

    IF p_fulfilment NOT IN ('delivery', 'pickup') THEN
        RAISE EXCEPTION 'Please choose delivery or pickup.';
    END IF;

    SELECT * INTO v_settings FROM public.website_settings WHERE business_id = v_account.business_id;
    v_settings.delivery_enabled := COALESCE(v_settings.delivery_enabled, TRUE);
    v_settings.delivery_fee := COALESCE(v_settings.delivery_fee, 0);
    v_settings.min_order := COALESCE(v_settings.min_order, 0);

    IF p_fulfilment = 'delivery' THEN
        IF NOT v_settings.delivery_enabled THEN
            RAISE EXCEPTION 'Delivery is not available right now. Please choose pickup.';
        END IF;
        IF v_address IS NULL THEN
            RAISE EXCEPTION 'Please enter your delivery location.';
        END IF;
        v_fee := v_settings.delivery_fee;

        IF EXISTS (SELECT 1 FROM public.delivery_zones z WHERE z.business_id = v_account.business_id AND z.active) THEN
            SELECT * INTO v_zone FROM public.delivery_zones z
            WHERE z.id = COALESCE(p_zone_id, v_account.delivery_zone_id)
              AND z.business_id = v_account.business_id
              AND z.active;
            IF NOT FOUND THEN
                RAISE EXCEPTION 'Please choose your delivery area.';
            END IF;
            v_fee := v_zone.fee;
            -- Scheduled orders reuse the area the customer last chose.
            UPDATE public.customer_accounts SET delivery_zone_id = v_zone.id WHERE id = v_account.id;
        END IF;
    END IF;

    INSERT INTO public.online_orders
        (business_id, account_id, schedule_id, customer_name, customer_phone, fulfilment,
         delivery_address, delivery_zone, notes, subtotal, delivery_fee, total)
    VALUES
        (v_account.business_id, v_account.id, p_schedule_id, v_account.name, v_account.phone, p_fulfilment,
         CASE WHEN p_fulfilment = 'delivery' THEN v_address END, v_zone.name,
         left(NULLIF(trim(COALESCE(p_notes, '')), ''), 500), 0, v_fee, 1)
    RETURNING id INTO v_order_id;

    FOR v_line IN
        SELECT i.product_id, sum(i.quantity) AS quantity,
               p.name, p.unit, p.price, p.stock, p.id AS found_id
        FROM (
            SELECT (e->>'productId')::UUID AS product_id, (e->>'quantity')::NUMERIC(14,3) AS quantity
            FROM jsonb_array_elements(p_items) e
        ) i
        LEFT JOIN public.products p
            ON p.id = i.product_id
           AND p.business_id = v_account.business_id
           AND p.deleted_at IS NULL
           AND p.show_on_website
           AND p.price > 0
        GROUP BY i.product_id, p.name, p.unit, p.price, p.stock, p.id
    LOOP
        IF v_line.found_id IS NULL THEN
            RAISE EXCEPTION 'A product in your cart is no longer available.';
        END IF;
        IF v_line.quantity IS NULL OR v_line.quantity <= 0 OR v_line.quantity > 1000 THEN
            RAISE EXCEPTION 'Please check the amount of %.', v_line.name;
        END IF;
        IF v_line.stock < v_line.quantity THEN
            RAISE EXCEPTION 'We don''t have enough % right now. Please try a smaller amount.', v_line.name;
        END IF;

        INSERT INTO public.online_order_items
            (order_id, product_id, product_name, unit, unit_price, quantity, line_total)
        VALUES
            (v_order_id, v_line.product_id, v_line.name, v_line.unit, v_line.price, v_line.quantity,
             round(v_line.price * v_line.quantity, 2));
        v_subtotal := v_subtotal + round(v_line.price * v_line.quantity, 2);
    END LOOP;

    IF v_subtotal < v_settings.min_order THEN
        RAISE EXCEPTION 'The minimum order is %.', v_settings.min_order;
    END IF;

    v_raw := v_subtotal + v_fee;
    IF floor(v_raw) < 1 THEN
        RAISE EXCEPTION 'Your order total is too small to pay by M-Pesa.';
    END IF;

    IF v_points <> 0 THEN
        SELECT * INTO v_customer FROM public.customers WHERE id = v_account.customer_id FOR UPDATE;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'Please finish setting up your account first.';
        END IF;
        -- Points are worth less per point in higher tiers (fn_point_value).
        v_point_value := public.fn_point_value(v_account.business_id, v_customer.tier);
        SELECT min_redeem_points INTO v_min_redeem
        FROM public.loyalty_settings WHERE business_id = v_account.business_id;
        v_min_redeem := COALESCE(v_min_redeem, 100);

        IF v_points < v_min_redeem THEN
            RAISE EXCEPTION 'You can use points from % points.', v_min_redeem;
        END IF;
        IF v_points > v_customer.loyalty_points THEN
            RAISE EXCEPTION 'You only have % points.', v_customer.loyalty_points;
        END IF;

        v_points_value := round(v_points * v_point_value, 2);
        -- M-Pesa needs at least Ksh 1, and it's what confirms the order.
        IF floor(v_raw - v_points_value) < 1 THEN
            RAISE EXCEPTION 'Points can cover all but the last shilling of an order. Please use fewer points.';
        END IF;

        UPDATE public.customers SET loyalty_points = loyalty_points - v_points WHERE id = v_customer.id;
        INSERT INTO public.loyalty_redemptions (business_id, customer_id, points, value, recorded_by, order_id, kind)
        VALUES (v_account.business_id, v_customer.id, v_points, v_points_value, 'Customer', v_order_id, 'online');
    END IF;

    UPDATE public.online_orders
    SET subtotal = v_subtotal,
        discount = v_raw - floor(v_raw - v_points_value),
        total = floor(v_raw - v_points_value),
        points_used = v_points,
        points_value = v_points_value
    WHERE id = v_order_id;

    RETURN v_order_id;
EXCEPTION
    WHEN invalid_text_representation OR numeric_value_out_of_range THEN
        RAISE EXCEPTION 'Your cart has an invalid item.';
END;
$$;

-- On the customer's page points only pay off debt; they never become wallet money.
-- Only the points the debt needs are used, and the oldest credit sales are settled first.
CREATE OR REPLACE FUNCTION public.fn_redeem_points(p_customer_id UUID, p_points INTEGER, p_recorded_by TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_customer  public.customers%ROWTYPE;
    v_value_per NUMERIC(10,4);
    v_min       INTEGER;
    v_points    INTEGER;
    v_value     NUMERIC(14,2);
    v_debt      NUMERIC(14,2);
    v_left      NUMERIC(14,2);
    v_applied   NUMERIC(14,2);
    v_rec       RECORD;
BEGIN
    SELECT * INTO v_customer FROM public.customers
    WHERE id = p_customer_id AND deleted_at IS NULL
    FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Customer not found.';
    END IF;

    v_value_per := public.fn_point_value(v_customer.business_id, v_customer.tier);
    SELECT min_redeem_points INTO v_min FROM public.loyalty_settings WHERE business_id = v_customer.business_id;
    v_min := COALESCE(v_min, 100);

    IF p_points IS NULL OR p_points < v_min THEN
        RAISE EXCEPTION 'You can redeem from % points.', v_min;
    END IF;
    IF p_points > v_customer.loyalty_points THEN
        RAISE EXCEPTION 'That is more points than the % available.', v_customer.loyalty_points;
    END IF;
    IF COALESCE(v_customer.debt_balance, 0) <= 0 THEN
        RAISE EXCEPTION 'Nothing is owed. Points can come off a purchase at the till instead.';
    END IF;

    -- Use only as many points as the debt needs.
    v_points := LEAST(p_points, CEIL(v_customer.debt_balance / v_value_per)::INTEGER);
    v_value  := LEAST(round(v_points * v_value_per, 2), v_customer.debt_balance);
    v_debt   := v_customer.debt_balance - v_value;

    UPDATE public.customers
    SET loyalty_points = loyalty_points - v_points,
        debt_balance = v_debt
    WHERE id = p_customer_id;

    INSERT INTO public.loyalty_redemptions (business_id, customer_id, points, value, recorded_by, kind)
    VALUES (v_customer.business_id, p_customer_id, v_points, v_value, p_recorded_by, 'account');

    -- Settle the oldest open credit sales, as a money payment would.
    v_left := v_value;
    FOR v_rec IN
        SELECT id, balance FROM public.credit_payments
        WHERE customer_id = p_customer_id AND business_id = v_customer.business_id AND status IN ('Open', 'Partial')
        ORDER BY created_at ASC
    LOOP
        EXIT WHEN v_left <= 0;
        v_applied := LEAST(v_left, v_rec.balance);
        v_left := v_left - v_applied;
        UPDATE public.credit_payments
        SET amount_paid = amount_paid + v_applied,
            status = CASE WHEN amount_paid + v_applied >= amount_owed THEN 'Settled'::public.credit_status ELSE 'Partial'::public.credit_status END,
            settled_at = CASE WHEN amount_paid + v_applied >= amount_owed THEN NOW() ELSE NULL END,
            updated_at = NOW()
        WHERE id = v_rec.id;
    END LOOP;

    INSERT INTO public.customer_ledger
        (business_id, customer_id, type, amount, wallet_balance, debt_balance, recorded_by, note, reference_id)
    VALUES (v_customer.business_id, p_customer_id, 'debt_payment', v_value, v_customer.wallet_balance, v_debt, p_recorded_by,
            v_points || ' loyalty points (not cash)', 'redeem-' || gen_random_uuid());

    RETURN jsonb_build_object('value', v_value, 'toDebt', v_value, 'toWallet', 0,
                              'pointsUsed', v_points, 'points', v_customer.loyalty_points - v_points);
END;
$$;
REVOKE ALL ON FUNCTION public.fn_redeem_points(UUID, INTEGER, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_redeem_points(UUID, INTEGER, TEXT) TO service_role;

CREATE OR REPLACE FUNCTION public.get_my_rewards()
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT jsonb_build_object(
        'points', c.loyalty_points,
        'tier', c.tier,
        'wallet', c.wallet_balance,
        'debt', c.debt_balance,
        'pointValue', public.fn_point_value(c.business_id, c.tier),
        'minRedeem', COALESCE(s.min_redeem_points, 100)
    )
    FROM public.customer_accounts a
    JOIN public.customers c ON c.id = a.customer_id
    LEFT JOIN public.loyalty_settings s ON s.business_id = c.business_id
    WHERE a.id = auth.uid();
$$;

-- =============================================================================
-- 7. Every point earned is written down, for the points report.
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.loyalty_points_earned (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id     UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    customer_id     UUID NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
    points          INTEGER NOT NULL CHECK (points > 0),
    source          TEXT NOT NULL CHECK (source IN ('sale', 'debt_payment')),
    amount          NUMERIC(14,2) NOT NULL DEFAULT 0,
    transaction_id  UUID REFERENCES public.transactions(id) ON DELETE SET NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.loyalty_points_earned ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_loyalty_points_earned_business ON public.loyalty_points_earned (business_id, created_at DESC);
DROP POLICY IF EXISTS pol_loyalty_points_earned_select ON public.loyalty_points_earned;
CREATE POLICY pol_loyalty_points_earned_select ON public.loyalty_points_earned FOR SELECT
    USING (public.has_permission(business_id, 'customers.loyalty', 'loyalty.view', 'reports.sales'));
-- Rows are written only by the triggers below.

DROP POLICY IF EXISTS pol_loyalty_redemptions_report ON public.loyalty_redemptions;
CREATE POLICY pol_loyalty_redemptions_report ON public.loyalty_redemptions FOR SELECT
    USING (public.has_permission(business_id, 'customers.loyalty', 'loyalty.view', 'reports.sales'));

CREATE OR REPLACE FUNCTION public.fn_log_sale_points()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_points INTEGER;
BEGIN
    IF NEW.customer_id IS NULL OR NEW.payment_method IN ('Credit_Debt', 'Credit') THEN
        RETURN NEW;
    END IF;
    v_points := GREATEST(0, FLOOR((NEW.final_total - COALESCE(NEW.delivery_fee, 0)) * 2))::INTEGER;
    IF v_points > 0 THEN
        INSERT INTO public.loyalty_points_earned (business_id, customer_id, points, source, amount, transaction_id)
        VALUES (NEW.business_id, NEW.customer_id, v_points, 'sale', NEW.final_total - COALESCE(NEW.delivery_fee, 0), NEW.id);
    END IF;
    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_log_sale_points ON public.transactions;
CREATE TRIGGER trg_log_sale_points
AFTER INSERT ON public.transactions
FOR EACH ROW EXECUTE FUNCTION public.fn_log_sale_points();

CREATE OR REPLACE FUNCTION public.fn_debt_payment_points()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_points INTEGER;
BEGIN
    IF NEW.customer_id IS NOT NULL AND NEW.amount_paid > 0 THEN
        v_points := FLOOR(NEW.amount_paid)::INTEGER;
        IF v_points > 0 THEN
            UPDATE public.customers
            SET loyalty_points = COALESCE(loyalty_points, 0) + v_points
            WHERE id = NEW.customer_id;
            INSERT INTO public.loyalty_points_earned (business_id, customer_id, points, source, amount)
            VALUES (NEW.business_id, NEW.customer_id, v_points, 'debt_payment', NEW.amount_paid);
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_debt_payment_points ON public.debt_payments;
CREATE TRIGGER trg_debt_payment_points
AFTER INSERT ON public.debt_payments
FOR EACH ROW EXECUTE FUNCTION public.fn_debt_payment_points();

-- =============================================================================
-- 8. Customer names always start each word with a capital letter, however they were typed
--    (in the app, on the website or by import). The rest of each word is left alone.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.fn_capitalize_words(p_text TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT CASE WHEN p_text IS NULL THEN NULL ELSE
        (SELECT string_agg(upper(left(w, 1)) || substr(w, 2), ' ' ORDER BY n)
         FROM regexp_split_to_table(btrim(regexp_replace(p_text, '\s+', ' ', 'g')), ' ') WITH ORDINALITY AS t(w, n)
         WHERE w <> '')
    END;
$$;

CREATE OR REPLACE FUNCTION public.fn_capitalize_customer_name()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF TG_TABLE_NAME = 'customers' THEN
        NEW.name := public.fn_capitalize_words(NEW.name);
    ELSE
        NEW.customer_name := public.fn_capitalize_words(NEW.customer_name);
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_capitalize_customer_name ON public.customers;
CREATE TRIGGER trg_capitalize_customer_name
BEFORE INSERT OR UPDATE OF name ON public.customers
FOR EACH ROW EXECUTE FUNCTION public.fn_capitalize_customer_name();

DROP TRIGGER IF EXISTS trg_capitalize_customer_name ON public.transactions;
CREATE TRIGGER trg_capitalize_customer_name
BEFORE INSERT OR UPDATE OF customer_name ON public.transactions
FOR EACH ROW EXECUTE FUNCTION public.fn_capitalize_customer_name();

DROP TRIGGER IF EXISTS trg_capitalize_customer_name ON public.online_orders;
CREATE TRIGGER trg_capitalize_customer_name
BEFORE INSERT OR UPDATE OF customer_name ON public.online_orders
FOR EACH ROW EXECUTE FUNCTION public.fn_capitalize_customer_name();

UPDATE public.customers SET name = public.fn_capitalize_words(name) WHERE name IS DISTINCT FROM public.fn_capitalize_words(name);
UPDATE public.transactions SET customer_name = public.fn_capitalize_words(customer_name)
WHERE customer_name IS NOT NULL AND customer_name IS DISTINCT FROM public.fn_capitalize_words(customer_name);
UPDATE public.online_orders SET customer_name = public.fn_capitalize_words(customer_name)
WHERE customer_name IS NOT NULL AND customer_name IS DISTINCT FROM public.fn_capitalize_words(customer_name);
