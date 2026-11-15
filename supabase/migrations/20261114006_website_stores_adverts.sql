-- =============================================================================
-- 20261114006_website_stores_adverts.sql
--
-- The website, laid out like a big grocery shop's: a store picker, advert cards and offer prices.
--
-- 1. Store picker (switch the whole shop to another branch).
--    Each branch is its own business with its own products, prices and stock. Every branch with
--    the same owner and a website name (Online Store > Website) is listed in the storefront as
--    `stores`. Picking one loads that branch's shop. A customer account has one sign-in but now
--    keeps one profile per store in customer_account_stores: that store's customers row (points,
--    history) and delivery area. switch_my_store() moves the account to the store being shopped,
--    so everything that already works from customer_accounts (ordering, points, rewards,
--    messages, reviews, promo codes) works for the chosen store without change.
--    Payments and point refunds now take the customer at the ORDER's store
--    (fn_account_customer), so paying an older order after switching still credits the right
--    branch. Regular orders are built at the store they were set up at.
--
-- 2. Advert cards (Online Store > Adverts): website_settings.ad_cards holds up to 9 cards,
--    { id, kind: 'poster'|'strip', title, body?, kicker?, ctaLabel?, href?, image?, tone?, hidden? }.
--    The CHECK refuses unsafe links and images and over-long text, like the home banner.
--
-- 3. Offer prices: products.website_was_price, the "was" price shown struck through with a
--    "% off" ribbon. Only shown when it is higher than the price.
--
-- Dependencies: 20261105010 (customer portal), 20261111003 (fn_branches_share_owner),
--               20261111004 (storefront), 20261110009 + 20261114004 (card and Airtel settling)
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- Offer prices
-- ---------------------------------------------------------------------------
ALTER TABLE public.products
    ADD COLUMN IF NOT EXISTS website_was_price NUMERIC(14,2);
ALTER TABLE public.products DROP CONSTRAINT IF EXISTS products_website_was_price_check;
ALTER TABLE public.products ADD CONSTRAINT products_website_was_price_check
    CHECK (website_was_price IS NULL OR website_was_price > 0);

-- ---------------------------------------------------------------------------
-- Advert cards
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_valid_ad_cards(p_cards JSONB)
RETURNS BOOLEAN
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
    v_card JSONB;
    v_href TEXT;
    v_image TEXT;
BEGIN
    IF p_cards IS NULL OR jsonb_typeof(p_cards) <> 'array' OR jsonb_array_length(p_cards) > 9 THEN
        RETURN FALSE;
    END IF;
    FOR v_card IN SELECT value FROM jsonb_array_elements(p_cards) LOOP
        IF jsonb_typeof(v_card) <> 'object' THEN RETURN FALSE; END IF;
        IF EXISTS (
            SELECT 1 FROM jsonb_object_keys(v_card) k
            WHERE k NOT IN ('id', 'kind', 'title', 'body', 'kicker', 'ctaLabel', 'href', 'image', 'tone', 'hidden')
        ) THEN RETURN FALSE; END IF;
        IF v_card->>'kind' IS NULL OR v_card->>'kind' NOT IN ('poster', 'strip') THEN RETURN FALSE; END IF;
        IF jsonb_typeof(v_card->'title') IS DISTINCT FROM 'string'
           OR length(trim(v_card->>'title')) NOT BETWEEN 1 AND 60 THEN RETURN FALSE; END IF;
        IF v_card ? 'id' AND (jsonb_typeof(v_card->'id') <> 'string' OR length(v_card->>'id') > 40) THEN RETURN FALSE; END IF;
        IF v_card ? 'body' AND (jsonb_typeof(v_card->'body') <> 'string' OR length(v_card->>'body') > 120) THEN RETURN FALSE; END IF;
        IF v_card ? 'kicker' AND (jsonb_typeof(v_card->'kicker') <> 'string' OR length(v_card->>'kicker') > 30) THEN RETURN FALSE; END IF;
        IF v_card ? 'ctaLabel' AND (jsonb_typeof(v_card->'ctaLabel') <> 'string' OR length(v_card->>'ctaLabel') > 24) THEN RETURN FALSE; END IF;
        IF v_card ? 'hidden' AND jsonb_typeof(v_card->'hidden') <> 'boolean' THEN RETURN FALSE; END IF;
        IF v_card ? 'tone' AND (v_card->>'tone' IS NULL
           OR v_card->>'tone' NOT IN ('ember', 'espresso', 'butter', 'peach', 'sage', 'cream')) THEN RETURN FALSE; END IF;
        IF v_card ? 'href' THEN
            IF jsonb_typeof(v_card->'href') <> 'string' THEN RETURN FALSE; END IF;
            v_href := v_card->>'href';
            -- A page on this site ("/shop?category=Milk", not "//elsewhere") or a secure web address.
            IF length(v_href) > 300
               OR v_href !~ '^(/([A-Za-z0-9._~%!$&''()*+,;=:@/?#-]*)?|https://[A-Za-z0-9.-]+(:[0-9]+)?(/[A-Za-z0-9._~%!$&''()*+,;=:@/?#-]*)?)$'
               OR v_href ~ '^//' THEN
                RETURN FALSE;
            END IF;
        END IF;
        IF v_card ? 'image' THEN
            IF jsonb_typeof(v_card->'image') <> 'string' THEN RETURN FALSE; END IF;
            v_image := v_card->>'image';
            IF length(v_image) > 500
               OR v_image !~ '^(https://[A-Za-z0-9.-]+(:[0-9]+)?/[A-Za-z0-9._~%!$&''()*+,;=:@/?-]*|/hero/[a-z0-9-]+\.(webp|png|jpg))$' THEN
                RETURN FALSE;
            END IF;
        END IF;
    END LOOP;
    RETURN TRUE;
END;
$$;

ALTER TABLE public.website_settings
    ADD COLUMN IF NOT EXISTS ad_cards JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE public.website_settings DROP CONSTRAINT IF EXISTS website_settings_ad_cards_check;
ALTER TABLE public.website_settings ADD CONSTRAINT website_settings_ad_cards_check
    CHECK (public.fn_valid_ad_cards(ad_cards) AND pg_column_size(ad_cards) < 20000);

-- ---------------------------------------------------------------------------
-- One profile per store for each customer account
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.customer_account_stores (
    account_id       UUID NOT NULL REFERENCES public.customer_accounts(id) ON DELETE CASCADE,
    business_id      UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    customer_id      UUID REFERENCES public.customers(id) ON DELETE SET NULL,
    delivery_zone_id UUID REFERENCES public.delivery_zones(id) ON DELETE SET NULL,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (account_id, business_id)
);
CREATE INDEX IF NOT EXISTS idx_customer_account_stores_business ON public.customer_account_stores(business_id);

-- Written only by the functions below; nobody reads it directly.
ALTER TABLE public.customer_account_stores ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.customer_account_stores FROM anon, authenticated;

-- Every account's current store counts as one of its stores.
INSERT INTO public.customer_account_stores (account_id, business_id, customer_id, delivery_zone_id)
SELECT id, business_id, customer_id, delivery_zone_id FROM public.customer_accounts
ON CONFLICT (account_id, business_id) DO NOTHING;

-- The customers row for this account at this store: the current one, or a saved store profile.
CREATE OR REPLACE FUNCTION public.fn_account_customer(p_account_id UUID, p_business_id UUID)
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT COALESCE(
        (SELECT a.customer_id FROM public.customer_accounts a WHERE a.id = p_account_id AND a.business_id = p_business_id),
        (SELECT s.customer_id FROM public.customer_account_stores s WHERE s.account_id = p_account_id AND s.business_id = p_business_id)
    );
$$;
REVOKE ALL ON FUNCTION public.fn_account_customer(UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_account_customer(UUID, UUID) TO service_role;

-- Staff at a branch keep seeing a customer who has since moved to another branch.
CREATE OR REPLACE FUNCTION public.fn_staff_can_see_account(p_account_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.customer_account_stores s
        WHERE s.account_id = p_account_id AND public.has_permission(s.business_id, 'online_store.view')
    );
$$;
REVOKE ALL ON FUNCTION public.fn_staff_can_see_account(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_staff_can_see_account(UUID) TO authenticated;

DROP POLICY IF EXISTS pol_customer_accounts_select ON public.customer_accounts;
CREATE POLICY pol_customer_accounts_select ON public.customer_accounts FOR SELECT
    USING (
        id = auth.uid()
        OR public.has_permission(business_id, 'online_store.view')
        OR public.fn_staff_can_see_account(id)
    );

-- Moves the signed-in customer to the store with this website name. Returns the website name,
-- or NULL when the account isn't set up yet (it is created at that store on sign-up instead).
CREATE OR REPLACE FUNCTION public.switch_my_store(p_slug TEXT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_account  public.customer_accounts%ROWTYPE;
    v_target   UUID;
    v_store    public.customer_account_stores%ROWTYPE;
    v_customer UUID;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Please sign in first.';
    END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended(auth.uid()::TEXT, 0));

    SELECT * INTO v_account FROM public.customer_accounts WHERE id = auth.uid() FOR UPDATE;
    IF NOT FOUND THEN
        RETURN NULL;
    END IF;

    SELECT id INTO v_target FROM public.businesses
    WHERE website_slug = p_slug AND deleted_at IS NULL;
    IF v_target IS NULL THEN
        RAISE EXCEPTION 'This shop is not available.';
    END IF;
    IF v_target = v_account.business_id THEN
        RETURN p_slug;
    END IF;
    IF NOT public.fn_branches_share_owner(v_account.business_id, v_target) THEN
        RAISE EXCEPTION 'You can only switch between branches of the same shop.';
    END IF;

    -- Keep the store being left, so its points and delivery area are there on the way back.
    INSERT INTO public.customer_account_stores (account_id, business_id, customer_id, delivery_zone_id)
    VALUES (v_account.id, v_account.business_id, v_account.customer_id, v_account.delivery_zone_id)
    ON CONFLICT (account_id, business_id) DO UPDATE
    SET customer_id = EXCLUDED.customer_id,
        delivery_zone_id = EXCLUDED.delivery_zone_id,
        updated_at = NOW();

    SELECT * INTO v_store FROM public.customer_account_stores
    WHERE account_id = v_account.id AND business_id = v_target;
    v_customer := v_store.customer_id;

    -- First visit to this store (or its customer was removed): a new customer there. Never
    -- matched to an existing customer by phone, because the phone number is unverified.
    IF v_customer IS NULL OR NOT EXISTS (
        SELECT 1 FROM public.customers WHERE id = v_customer AND deleted_at IS NULL
    ) THEN
        INSERT INTO public.customers (business_id, name, phone, email, description, last_modified_by)
        VALUES (v_target, v_account.name, v_account.phone, v_account.email, 'Website account', 'website')
        RETURNING id INTO v_customer;
        INSERT INTO public.customer_account_stores (account_id, business_id, customer_id)
        VALUES (v_account.id, v_target, v_customer)
        ON CONFLICT (account_id, business_id) DO UPDATE SET customer_id = EXCLUDED.customer_id, updated_at = NOW();
    END IF;

    UPDATE public.customer_accounts
    SET business_id = v_target,
        customer_id = v_customer,
        delivery_zone_id = v_store.delivery_zone_id
    WHERE id = v_account.id;

    RETURN p_slug;
END;
$$;
REVOKE ALL ON FUNCTION public.switch_my_store(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.switch_my_store(TEXT) TO authenticated;

-- ---------------------------------------------------------------------------
-- Functions below are their latest versions with only the store changes marked in comments.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.confirm_online_order_payment(
    p_checkout_request_id TEXT,
    p_result_code         INTEGER,
    p_amount              NUMERIC,
    p_receipt             TEXT,
    p_raw                 JSONB
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_payment public.mpesa_transactions%ROWTYPE;
    v_order   public.online_orders%ROWTYPE;
    v_tx_id   UUID;
    v_short   TEXT;
    v_reason  TEXT;
BEGIN
    SELECT * INTO v_payment FROM public.mpesa_transactions
    WHERE checkout_request_id = p_checkout_request_id AND online_order_id IS NOT NULL
    FOR UPDATE;
    IF NOT FOUND THEN
        RETURN 'unknown';
    END IF;
    -- A status check can mark a row Failed before the customer's success callback arrives,
    -- so only Completed blocks a success. Money received must never be dropped.
    IF v_payment.status = 'Completed' OR (v_payment.status <> 'Pending' AND p_result_code <> 0) THEN
        RETURN 'duplicate';
    END IF;

    SELECT * INTO v_order FROM public.online_orders WHERE id = v_payment.online_order_id FOR UPDATE;

    IF p_result_code <> 0 THEN
        UPDATE public.mpesa_transactions
        SET status = 'Failed', raw_callback = p_raw
        WHERE id = v_payment.id;

        IF v_order.status = 'pending_payment' AND NOT EXISTS (
            SELECT 1 FROM public.mpesa_transactions m
            WHERE m.online_order_id = v_order.id AND m.status = 'Pending' AND m.id <> v_payment.id
        ) THEN
            UPDATE public.online_orders SET status = 'payment_failed' WHERE id = v_order.id;
        END IF;
        RETURN 'failed';
    END IF;

    UPDATE public.mpesa_transactions
    SET status = 'Completed',
        amount = COALESCE(p_amount, amount),
        receipt_number = p_receipt,
        mpesa_receipt_timestamp = NOW(),
        raw_callback = p_raw
    WHERE id = v_payment.id;

    IF COALESCE(p_amount, 0) <> v_order.total THEN
        v_reason := format('M-Pesa receipt %s paid %s but the order total is %s.', p_receipt, p_amount, v_order.total);
    ELSIF v_order.status NOT IN ('pending_payment', 'payment_failed') THEN
        v_reason := format('Extra M-Pesa payment %s of %s arrived on an order that was already %s. It may need a refund.',
                           p_receipt, p_amount, v_order.status);
    END IF;

    IF v_reason IS NOT NULL THEN
        UPDATE public.online_orders
        SET needs_attention = TRUE,
            attention_reason = concat_ws(' ', attention_reason, v_reason)
        WHERE id = v_order.id;
        PERFORM public.fn_notify_staff(v_order.business_id, 'Online payment needs checking',
            'Order #' || v_order.order_number || ': ' || v_reason, jsonb_build_object('orderId', v_order.id));
        RETURN 'flagged';
    END IF;

    SELECT i.product_name INTO v_short
    FROM public.online_order_items i
    JOIN public.products p ON p.id = i.product_id
    WHERE i.order_id = v_order.id AND p.stock < i.quantity
    LIMIT 1;

    INSERT INTO public.transactions
        (business_id, total, discount, tax, final_total, amount_paid, payment_method,
         customer_id, customer_name, staff_name, note, is_delivery, delivery_fee, reference_id)
    SELECT v_order.business_id, v_order.subtotal + v_order.delivery_fee, v_order.discount, 0, v_order.total, v_order.total, 'M-Pesa',
           public.fn_account_customer(a.id, v_order.business_id), v_order.customer_name, 'Website',
           'Online order #' || v_order.order_number || ', M-Pesa ' || COALESCE(p_receipt, ''),
           v_order.fulfilment = 'delivery', v_order.delivery_fee, 'online-' || v_order.id
    FROM (SELECT 1) one
    LEFT JOIN public.customer_accounts a ON a.id = v_order.account_id
    RETURNING id INTO v_tx_id;

    INSERT INTO public.transaction_items (transaction_id, product_id, product_name, unit_price, quantity, line_total)
    SELECT v_tx_id, product_id, product_name, unit_price, quantity, line_total
    FROM public.online_order_items
    WHERE order_id = v_order.id;

    UPDATE public.mpesa_transactions SET transaction_id = v_tx_id WHERE id = v_payment.id;

    UPDATE public.online_orders
    SET status = 'paid',
        paid_at = NOW(),
        mpesa_receipt = p_receipt,
        transaction_id = v_tx_id,
        needs_attention = v_short IS NOT NULL,
        attention_reason = CASE WHEN v_short IS NOT NULL
            THEN 'Paid, but stock of ' || v_short || ' ran short before payment arrived.' END
    WHERE id = v_order.id;

    PERFORM public.fn_customer_message(v_order.account_id, v_order.id,
        'We received your payment for order #' || v_order.order_number || '. M-Pesa receipt: ' || COALESCE(p_receipt, '-') || '.');
    PERFORM public.fn_notify_staff(v_order.business_id, 'New online order',
        'Order #' || v_order.order_number || ' from ' || v_order.customer_name || ' is paid.'
            || CASE WHEN v_short IS NOT NULL THEN ' Stock of ' || v_short || ' is short.' ELSE '' END,
        jsonb_build_object('orderId', v_order.id));

    RETURN 'paid';
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_settle_online_order_card(p_card_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_card   public.card_payments%ROWTYPE;
    v_order  public.online_orders%ROWTYPE;
    v_tx_id  UUID;
    v_short  TEXT;
    v_reason TEXT;
    v_label  TEXT;
BEGIN
    SELECT * INTO v_card FROM public.card_payments WHERE id = p_card_id;
    SELECT * INTO v_order FROM public.online_orders WHERE id = v_card.online_order_id FOR UPDATE;
    IF NOT FOUND THEN
        RETURN 'unknown';
    END IF;
    v_label := 'Card ' || COALESCE(v_card.card_brand || ' ', '') || COALESCE('•••• ' || v_card.card_last4 || ' ', '') || v_card.reference;

    IF COALESCE(v_card.amount_paid, 0) <> v_order.total THEN
        v_reason := format('%s paid %s but the order total is %s.', v_label, v_card.amount_paid, v_order.total);
    ELSIF v_order.status NOT IN ('pending_payment', 'payment_failed') THEN
        v_reason := format('Extra card payment %s of %s arrived on an order that was already %s. It may need a refund.',
                           v_card.reference, v_card.amount_paid, v_order.status);
    END IF;

    IF v_reason IS NOT NULL THEN
        UPDATE public.online_orders
        SET needs_attention = TRUE, attention_reason = concat_ws(' ', attention_reason, v_reason)
        WHERE id = v_order.id;
        PERFORM public.fn_notify_staff(v_order.business_id, 'Online payment needs checking',
            'Order #' || v_order.order_number || ': ' || v_reason, jsonb_build_object('orderId', v_order.id));
        RETURN 'flagged';
    END IF;

    SELECT i.product_name INTO v_short
    FROM public.online_order_items i
    JOIN public.products p ON p.id = i.product_id
    WHERE i.order_id = v_order.id AND p.stock < i.quantity
    LIMIT 1;

    INSERT INTO public.transactions
        (business_id, total, discount, tax, final_total, amount_paid, payment_method,
         customer_id, customer_name, staff_name, note, is_delivery, delivery_fee, reference_id)
    SELECT v_order.business_id, v_order.subtotal + v_order.delivery_fee, v_order.discount, 0, v_order.total, v_order.total, 'Card',
           public.fn_account_customer(a.id, v_order.business_id), v_order.customer_name, 'Website',
           'Online order #' || v_order.order_number || ', ' || v_label,
           v_order.fulfilment = 'delivery', v_order.delivery_fee, 'online-' || v_order.id
    FROM (SELECT 1) one
    LEFT JOIN public.customer_accounts a ON a.id = v_order.account_id
    RETURNING id INTO v_tx_id;

    INSERT INTO public.transaction_items (transaction_id, product_id, product_name, unit_price, quantity, line_total)
    SELECT v_tx_id, product_id, product_name, unit_price, quantity, line_total
    FROM public.online_order_items
    WHERE order_id = v_order.id;

    UPDATE public.card_payments SET transaction_id = v_tx_id WHERE id = v_card.id;

    UPDATE public.online_orders
    SET status = 'paid',
        paid_at = NOW(),
        payment_method = 'Card',
        payment_reference = v_card.reference,
        transaction_id = v_tx_id,
        needs_attention = v_short IS NOT NULL,
        attention_reason = CASE WHEN v_short IS NOT NULL
            THEN 'Paid, but stock of ' || v_short || ' ran short before payment arrived.' END
    WHERE id = v_order.id;

    PERFORM public.fn_customer_message(v_order.account_id, v_order.id,
        'We received your card payment for order #' || v_order.order_number || '. Reference: ' || v_card.reference || '.');
    PERFORM public.fn_notify_staff(v_order.business_id, 'New online order',
        'Order #' || v_order.order_number || ' from ' || v_order.customer_name || ' is paid by card.'
            || CASE WHEN v_short IS NOT NULL THEN ' Stock of ' || v_short || ' is short.' ELSE '' END,
        jsonb_build_object('orderId', v_order.id));
    RETURN 'paid';
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_settle_online_order_airtel(p_airtel_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_req    public.airtel_transactions%ROWTYPE;
    v_order  public.online_orders%ROWTYPE;
    v_tx_id  UUID;
    v_short  TEXT;
    v_reason TEXT;
    v_label  TEXT;
BEGIN
    SELECT * INTO v_req FROM public.airtel_transactions WHERE id = p_airtel_id;
    SELECT * INTO v_order FROM public.online_orders WHERE id = v_req.online_order_id FOR UPDATE;
    IF NOT FOUND THEN
        RETURN 'unknown';
    END IF;
    v_label := 'Airtel Money ' || COALESCE(v_req.airtel_money_id, v_req.reference);

    IF v_req.amount <> v_order.total THEN
        v_reason := format('%s paid %s but the order total is %s.', v_label, v_req.amount, v_order.total);
    ELSIF v_order.status NOT IN ('pending_payment', 'payment_failed') THEN
        v_reason := format('Extra Airtel Money payment %s of %s arrived on an order that was already %s. It may need a refund.',
                           COALESCE(v_req.airtel_money_id, v_req.reference), v_req.amount, v_order.status);
    END IF;

    IF v_reason IS NOT NULL THEN
        UPDATE public.online_orders
        SET needs_attention = TRUE, attention_reason = concat_ws(' ', attention_reason, v_reason)
        WHERE id = v_order.id;
        PERFORM public.fn_notify_staff(v_order.business_id, 'Online payment needs checking',
            'Order #' || v_order.order_number || ': ' || v_reason, jsonb_build_object('orderId', v_order.id));
        RETURN 'flagged';
    END IF;

    SELECT i.product_name INTO v_short
    FROM public.online_order_items i
    JOIN public.products p ON p.id = i.product_id
    WHERE i.order_id = v_order.id AND p.stock < i.quantity
    LIMIT 1;

    INSERT INTO public.transactions
        (business_id, total, discount, tax, final_total, amount_paid, payment_method,
         customer_id, customer_name, staff_name, note, is_delivery, delivery_fee, reference_id)
    SELECT v_order.business_id, v_order.subtotal + v_order.delivery_fee, v_order.discount, 0, v_order.total, v_order.total, 'Airtel Money',
           public.fn_account_customer(a.id, v_order.business_id), v_order.customer_name, 'Website',
           'Online order #' || v_order.order_number || ', ' || v_label,
           v_order.fulfilment = 'delivery', v_order.delivery_fee, 'online-' || v_order.id
    FROM (SELECT 1) one
    LEFT JOIN public.customer_accounts a ON a.id = v_order.account_id
    RETURNING id INTO v_tx_id;

    INSERT INTO public.transaction_items (transaction_id, product_id, product_name, unit_price, quantity, line_total)
    SELECT v_tx_id, product_id, product_name, unit_price, quantity, line_total
    FROM public.online_order_items
    WHERE order_id = v_order.id;

    UPDATE public.online_orders
    SET status = 'paid',
        paid_at = NOW(),
        payment_method = 'Airtel Money',
        payment_reference = COALESCE(v_req.airtel_money_id, v_req.reference),
        transaction_id = v_tx_id,
        needs_attention = v_short IS NOT NULL,
        attention_reason = CASE WHEN v_short IS NOT NULL
            THEN 'Paid, but stock of ' || v_short || ' ran short before payment arrived.' END
    WHERE id = v_order.id;

    PERFORM public.fn_customer_message(v_order.account_id, v_order.id,
        'We received your Airtel Money payment for order #' || v_order.order_number
            || '. Reference: ' || COALESCE(v_req.airtel_money_id, v_req.reference) || '.');
    PERFORM public.fn_notify_staff(v_order.business_id, 'New online order',
        'Order #' || v_order.order_number || ' from ' || v_order.customer_name || ' is paid with Airtel Money.'
            || CASE WHEN v_short IS NOT NULL THEN ' Stock of ' || v_short || ' is short.' ELSE '' END,
        jsonb_build_object('orderId', v_order.id));
    RETURN 'paid';
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_refund_order_points()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF NEW.status = 'cancelled' AND OLD.status <> 'cancelled'
       AND OLD.points_used > 0 AND OLD.points_refunded_at IS NULL THEN
        -- The points go back to the customer at the order's own store.
        UPDATE public.customers c
        SET loyalty_points = c.loyalty_points + OLD.points_used
        WHERE c.id = public.fn_account_customer(OLD.account_id, OLD.business_id);

        UPDATE public.loyalty_redemptions SET refunded_at = NOW() WHERE order_id = OLD.id AND refunded_at IS NULL;
        NEW.points_refunded_at := NOW();
    END IF;
    RETURN NEW;
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
    v_schedule_business UUID;
    v_store    public.customer_account_stores%ROWTYPE;
    v_away     BOOLEAN := FALSE;
BEGIN
    SELECT * INTO v_account FROM public.customer_accounts WHERE id = p_account_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Please finish setting up your account first.';
    END IF;

    -- A regular order belongs to the store it was set up at, even after the customer moves
    -- to another branch: build it there, with that store's customer and delivery area.
    IF p_schedule_id IS NOT NULL THEN
        SELECT business_id INTO v_schedule_business FROM public.customer_order_schedules WHERE id = p_schedule_id;
        IF v_schedule_business IS NOT NULL AND v_schedule_business <> v_account.business_id THEN
            SELECT * INTO v_store FROM public.customer_account_stores
            WHERE account_id = v_account.id AND business_id = v_schedule_business;
            IF NOT FOUND THEN
                RAISE EXCEPTION 'This regular order is for a shop you no longer use. Please set it up again.';
            END IF;
            v_account.business_id := v_schedule_business;
            v_account.customer_id := v_store.customer_id;
            v_account.delivery_zone_id := v_store.delivery_zone_id;
            v_away := TRUE;
        END IF;
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
            IF v_away THEN
                UPDATE public.customer_account_stores SET delivery_zone_id = v_zone.id
                WHERE account_id = v_account.id AND business_id = v_account.business_id;
            ELSE
                UPDATE public.customer_accounts SET delivery_zone_id = v_zone.id WHERE id = v_account.id;
            END IF;
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

CREATE OR REPLACE FUNCTION public.get_public_storefront(p_slug TEXT)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT jsonb_build_object(
        'business', jsonb_build_object(
            'name', b.name,
            'slug', b.website_slug,
            'description', b.description,
            'address', b.address,
            'contactEmail', NULLIF(b.contact_email, ''),
            'contactPhone', NULLIF(b.contact_phone, ''),
            'logoUrl', b.logo_url,
            'coverImageUrl', b.cover_image_url,
            'primaryColor', b.primary_color,
            'currency', b.currency,
            'paymentMethods', to_jsonb(b.default_payment_methods)
        ),
        'settings', jsonb_build_object(
            'deliveryEnabled', COALESCE(s.delivery_enabled, TRUE),
            'deliveryFee', COALESCE(s.delivery_fee, 0),
            'minOrder', COALESCE(s.min_order, 0),
            'assistantEnabled', COALESCE(s.assistant_enabled, TRUE),
            'openingHours', NULLIF(trim(s.opening_hours), ''),
            'whatsapp', NULLIF(trim(s.whatsapp), '')
        ),
        'pages', COALESCE(s.pages, '{}'::jsonb),
        -- Home page slides from Online Store > Home banner; hidden ones never leave the database.
        'heroSlides', COALESCE((
            SELECT jsonb_agg(slide) FROM jsonb_array_elements(s.hero_slides) AS slide
            WHERE COALESCE((slide->>'hidden')::boolean, FALSE) IS FALSE
        ), '[]'::jsonb),
        -- Advert cards from Online Store > Adverts; hidden ones never leave the database.
        'adCards', COALESCE((
            SELECT jsonb_agg(card) FROM jsonb_array_elements(s.ad_cards) AS card
            WHERE COALESCE((card->>'hidden')::boolean, FALSE) IS FALSE
        ), '[]'::jsonb),
        -- Branches customers can switch between: this shop and every other shop with the same
        -- owner that has its website switched on. The website shows a store picker at two or more.
        'stores', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                'slug', x.website_slug,
                'name', x.name,
                'address', x.address,
                'phone', NULLIF(x.contact_phone, ''),
                'logoUrl', x.logo_url,
                'openingHours', NULLIF(trim(xs.opening_hours), '')
            ) ORDER BY x.name)
            FROM public.businesses x
            LEFT JOIN public.website_settings xs ON xs.business_id = x.id
            WHERE x.deleted_at IS NULL
              AND NULLIF(trim(COALESCE(x.website_slug, '')), '') IS NOT NULL
              AND (x.id = b.id OR public.fn_branches_share_owner(b.id, x.id))
        ), '[]'::jsonb),
        'loyalty', jsonb_build_object(
            'enabled', COALESCE(l.points_enabled, TRUE),
            'pointsPerShilling', 2,
            'valueBronze', COALESCE(l.value_bronze, 0.02),
            'valueSilver', COALESCE(l.value_silver, 0.01),
            'valueGold', COALESCE(l.value_gold, 0.005),
            'minRedeem', COALESCE(l.min_redeem_points, 100)
        ),
        'reviews', COALESCE((
            SELECT jsonb_agg(r ORDER BY r->>'createdAt' DESC)
            FROM (
                SELECT jsonb_build_object(
                    'id', rv.id,
                    'productId', rv.product_id,
                    'rating', rv.rating,
                    'title', rv.title,
                    'body', rv.body,
                    'name', rv.display_name,
                    'verified', rv.verified,
                    'featured', rv.featured,
                    'reply', rv.staff_reply,
                    'createdAt', rv.created_at
                ) AS r
                FROM public.website_reviews rv
                WHERE rv.business_id = b.id AND rv.status = 'approved'
                ORDER BY rv.featured DESC, rv.created_at DESC
                LIMIT 300
            ) recent
        ), '[]'::jsonb),
        'promotions', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                'code', pc.code,
                'description', pc.description,
                'kind', pc.kind,
                'value', pc.value,
                'minOrder', pc.min_order,
                'endsAt', pc.ends_at
            ) ORDER BY pc.created_at DESC)
            FROM public.website_promo_codes pc
            WHERE pc.business_id = b.id AND pc.active AND pc.show_on_website
              AND (pc.starts_at IS NULL OR pc.starts_at <= NOW())
              AND (pc.ends_at IS NULL OR pc.ends_at > NOW())
        ), '[]'::jsonb),
        'deliveryZones', COALESCE((
            SELECT jsonb_agg(jsonb_build_object('id', z.id, 'name', z.name, 'fee', z.fee) ORDER BY z.name)
            FROM public.delivery_zones z
            WHERE z.business_id = b.id AND z.active
        ), '[]'::jsonb),
        'branches', COALESCE((
            SELECT jsonb_agg(jsonb_build_object('name', br.name, 'address', br.address) ORDER BY br.name)
            FROM public.branches br
            WHERE br.business_id = b.id AND br.deleted_at IS NULL
        ), '[]'::jsonb),
        'products', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                'id', p.id,
                'name', p.name,
                'category', p.category,
                'price', p.price,
                -- The "was" price for an offer ribbon; only when it is really higher.
                'wasPrice', CASE WHEN p.website_was_price > p.price THEN p.website_was_price END,
                'unit', p.unit,
                'description', p.description,
                'image', p.image,
                'inStock', p.stock > 0
            ) ORDER BY p.category, p.name)
            FROM public.products p
            WHERE p.business_id = b.id
              AND p.deleted_at IS NULL
              AND p.show_on_website
              AND p.price > 0
        ), '[]'::jsonb),
        'articles', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                'id', a.id,
                'slug', a.slug,
                'title', a.title,
                'summary', a.summary,
                'body', a.body,
                'category', a.category,
                'coverImageUrl', a.cover_image_url,
                'publishedAt', a.published_at
            ) ORDER BY a.published_at DESC)
            FROM public.website_articles a
            WHERE a.business_id = b.id AND a.published
        ), '[]'::jsonb)
    )
    FROM public.businesses b
    LEFT JOIN public.website_settings s ON s.business_id = b.id
    LEFT JOIN public.loyalty_settings l ON l.business_id = b.id
    WHERE b.website_slug = p_slug
      AND b.deleted_at IS NULL;
$$;

COMMIT;
