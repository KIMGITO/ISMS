-- =============================================================================
-- 20261110009_four_payment_methods_cards.sql
--
-- 1. Bug: recording a Bank or Card payment for a customer who owed anything (even KSh 0.20)
--    failed with "Some of the values entered aren't valid". process_business_payment writes a
--    debt_payments row, and debt_payments only accepted Cash and M-Pesa. Payments with no debt
--    skipped that row, which is why it only happened sometimes.
-- 2. Money comes in four ways only: Cash, M-Pesa, Card and Bank. Mobile_Wallet and Other are
--    gone everywhere. Old rows are moved (Mobile_Wallet -> M-Pesa, Other -> Cash) and keep the
--    old value in original_method, and their money balances are added to the new method.
--    Credit (selling on debt) is not a way money comes in and stays.
-- 3. process_business_payment: locks the customer while it works, follows a merged customer to
--    the one it was merged into, settles oldest credit first in a stable order, and refuses
--    unknown methods and statuses with a plain message.
-- 4. Card payments through Paystack: online checkout (any device, or a link/QR the customer
--    opens on their phone) and Paystack card readers. Keys live in card_payment_secrets, which
--    no client can read; only the card-payments and card-webhook edge functions use them.
--    A paid card payment is settled here exactly once, whichever arrives first: the webhook or
--    the app checking.
-- 5. New permission payments.card (Manager, Cashier).
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Move old Mobile_Wallet / Other rows to the four methods
-- ---------------------------------------------------------------------------
ALTER TABLE public.payments     ADD COLUMN IF NOT EXISTS original_method TEXT;
ALTER TABLE public.expenses     ADD COLUMN IF NOT EXISTS original_method TEXT;
ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS original_method TEXT;

-- Drop the old method checks first so the rows can change.
DO $$
DECLARE c RECORD;
BEGIN
    FOR c IN
        SELECT conname, conrelid::regclass AS tbl FROM pg_constraint
        WHERE contype = 'c' AND (
            (conrelid = 'public.payments'::regclass      AND pg_get_constraintdef(oid) ILIKE '%method%')
            OR (conrelid = 'public.money_assets'::regclass  AND pg_get_constraintdef(oid) ILIKE '%method%')
            OR (conrelid = 'public.expenses'::regclass      AND pg_get_constraintdef(oid) ILIKE '%payment_method%')
            OR (conrelid = 'public.debt_payments'::regclass AND pg_get_constraintdef(oid) ILIKE '%payment_method%')
            OR (conrelid = 'public.transactions'::regclass  AND pg_get_constraintdef(oid) ILIKE '%payment_method%')
        )
    LOOP
        EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', c.tbl, c.conname);
    END LOOP;
END $$;

UPDATE public.payments
SET original_method = method,
    method = CASE method WHEN 'Mobile_Wallet' THEN 'M-Pesa' ELSE 'Cash' END
WHERE method NOT IN ('Cash', 'M-Pesa', 'Card', 'Bank');

-- The expense trigger would move each amount between balances; the balances are merged below.
ALTER TABLE public.expenses DISABLE TRIGGER trg_process_expense_asset_update;
UPDATE public.expenses
SET original_method = payment_method,
    payment_method = CASE payment_method WHEN 'Mobile_Wallet' THEN 'M-Pesa' ELSE 'Cash' END
WHERE payment_method IS NOT NULL AND payment_method NOT IN ('Cash', 'M-Pesa', 'Card', 'Bank');
ALTER TABLE public.expenses ENABLE TRIGGER trg_process_expense_asset_update;

UPDATE public.transactions
SET original_method = payment_method::TEXT,
    payment_method = CASE payment_method WHEN 'Mobile_Wallet' THEN 'M-Pesa'::public.payment_method ELSE 'Cash'::public.payment_method END
WHERE payment_method IN ('Mobile_Wallet', 'Other');

UPDATE public.debt_payments
SET payment_method = CASE payment_method WHEN 'Mobile_Wallet' THEN 'M-Pesa' ELSE 'Cash' END
WHERE payment_method NOT IN ('Cash', 'M-Pesa', 'Card', 'Bank');

-- Each old balance is added to its new method, and its history follows it.
DO $$
DECLARE
    r        RECORD;
    v_target TEXT;
    v_id     UUID;
BEGIN
    FOR r IN SELECT * FROM public.money_assets WHERE method NOT IN ('Cash', 'M-Pesa', 'Card', 'Bank') LOOP
        v_target := CASE r.method WHEN 'Mobile_Wallet' THEN 'M-Pesa' ELSE 'Cash' END;

        INSERT INTO public.money_assets (business_id, method, balance, last_payment_at)
        VALUES (r.business_id, v_target, 0, r.last_payment_at)
        ON CONFLICT (business_id, method) DO NOTHING;

        UPDATE public.money_assets
        SET balance = balance + r.balance,
            last_payment_at = GREATEST(last_payment_at, r.last_payment_at),
            updated_at = NOW()
        WHERE business_id = r.business_id AND method = v_target
        RETURNING id INTO v_id;

        UPDATE public.payment_asset_ledger SET asset_id = v_id, method = v_target WHERE asset_id = r.id;
        DELETE FROM public.money_assets WHERE id = r.id;
    END LOOP;
END $$;

ALTER TABLE public.payments
    ADD CONSTRAINT payments_method_check CHECK (method IN ('Cash', 'M-Pesa', 'Card', 'Bank'));
ALTER TABLE public.money_assets
    ADD CONSTRAINT money_assets_method_check CHECK (method IN ('Cash', 'M-Pesa', 'Card', 'Bank'));
ALTER TABLE public.expenses
    ADD CONSTRAINT expenses_payment_method_check CHECK (payment_method IN ('Cash', 'M-Pesa', 'Card', 'Bank'));
ALTER TABLE public.debt_payments
    ADD CONSTRAINT debt_payments_payment_method_check CHECK (payment_method IN ('Cash', 'M-Pesa', 'Card', 'Bank'));
-- The enum keeps its old values (Postgres can't drop them); this stops them being used.
ALTER TABLE public.transactions
    ADD CONSTRAINT transactions_payment_method_check
    CHECK (payment_method IN ('Cash', 'M-Pesa', 'Card', 'Bank', 'Credit_Debt', 'Credit'));

-- One place that moves a balance: an unknown method is refused instead of landing in "Other".
CREATE OR REPLACE FUNCTION public.fn_post_money_asset(
    p_business_id UUID,
    p_method      TEXT,
    p_delta       NUMERIC,
    p_description TEXT,
    p_payment_id  UUID DEFAULT NULL,
    p_expense_id  UUID DEFAULT NULL,
    p_recorded_by TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_method   TEXT := CASE WHEN p_method = 'Mobile_Wallet' THEN 'M-Pesa' WHEN p_method = 'Other' THEN 'Cash' ELSE p_method END;
    v_asset_id UUID;
    v_after    NUMERIC(14,2);
BEGIN
    IF COALESCE(p_delta, 0) = 0 THEN
        RETURN;
    END IF;
    IF v_method IS NULL OR v_method NOT IN ('Cash', 'M-Pesa', 'Card', 'Bank') THEN
        RAISE EXCEPTION 'Choose Cash, M-Pesa, Card or Bank.';
    END IF;

    INSERT INTO public.money_assets (business_id, method, balance)
    VALUES (p_business_id, v_method, p_delta)
    ON CONFLICT (business_id, method)
    DO UPDATE SET balance = money_assets.balance + p_delta, updated_at = NOW()
    RETURNING id, balance INTO v_asset_id, v_after;

    INSERT INTO public.payment_asset_ledger (
        business_id, asset_id, payment_id, expense_id, type, method, amount,
        balance_before, balance_after, description, recorded_by
    )
    VALUES (
        p_business_id, v_asset_id, p_payment_id, p_expense_id,
        CASE WHEN p_delta > 0 THEN 'Credit' ELSE 'Debit' END, v_method, p_delta,
        v_after - p_delta, v_after, p_description, p_recorded_by
    );
END;
$$;
REVOKE ALL ON FUNCTION public.fn_post_money_asset(UUID, TEXT, NUMERIC, TEXT, UUID, UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_post_money_asset(UUID, TEXT, NUMERIC, TEXT, UUID, UUID, TEXT) TO service_role;

-- ---------------------------------------------------------------------------
-- 2. process_business_payment
-- Same signature, so the grants stay. Includes the membership and role guards that
-- 20261105002 and 20261105014 added to the deployed body.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.process_business_payment(
    p_business_id    UUID,
    p_reference_code TEXT,
    p_amount         NUMERIC(14,2),
    p_method         TEXT,
    p_sender_name    TEXT,
    p_sender_phone   TEXT,
    p_status         TEXT DEFAULT 'Success',
    p_date           TIMESTAMPTZ DEFAULT NOW(),
    p_customer_id    UUID DEFAULT NULL,
    p_customer_name  TEXT DEFAULT NULL,
    p_payment_type   TEXT DEFAULT 'walk-in',
    p_description    TEXT DEFAULT NULL,
    p_recorded_by    TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_payment_id     UUID;
    v_amount         NUMERIC(14,2) := round(COALESCE(p_amount, 0), 2);
    v_status         TEXT := COALESCE(p_status, 'Success');
    v_customer_id    UUID := p_customer_id;
    v_merged_into    UUID;
    v_debt_before    NUMERIC(14,2) := 0;
    v_debt_after     NUMERIC(14,2) := 0;
    v_wallet_before  NUMERIC(14,2) := 0;
    v_wallet_after   NUMERIC(14,2) := 0;
    v_debt_applied   NUMERIC(14,2) := 0;
    v_wallet_applied NUMERIC(14,2) := 0;
    v_applied_to     TEXT := 'none';
    v_existing_id    UUID;
    v_by             TEXT := COALESCE(NULLIF(trim(p_recorded_by), ''), 'System');
    v_left           NUMERIC(14,2);
    v_take           NUMERIC(14,2);
    v_rec            RECORD;
BEGIN
    PERFORM public.assert_business_member(p_business_id);
    PERFORM public.assert_permission(p_business_id, 'payments.cash', 'payments.mpesa', 'payments.verify', 'payments.card');

    -- Same business + reference: already recorded, so return it (safe to retry).
    IF p_reference_code IS NOT NULL THEN
        SELECT id INTO v_existing_id
        FROM public.payments
        WHERE business_id = p_business_id AND reference_code = p_reference_code
        LIMIT 1;
        IF v_existing_id IS NOT NULL THEN
            RETURN v_existing_id;
        END IF;
    END IF;

    IF v_amount <= 0 THEN
        RAISE EXCEPTION 'Amount must be greater than zero.';
    END IF;
    IF p_method IS NULL OR p_method NOT IN ('Cash', 'M-Pesa', 'Card', 'Bank') THEN
        RAISE EXCEPTION 'Choose Cash, M-Pesa, Card or Bank.';
    END IF;
    IF v_status NOT IN ('Success', 'Pending', 'Failed') THEN
        RAISE EXCEPTION 'A payment is Success, Pending or Failed.';
    END IF;

    IF v_customer_id IS NOT NULL THEN
        SELECT merged_into_id INTO v_merged_into
        FROM public.customers WHERE id = v_customer_id AND business_id = p_business_id;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'That customer was not found in this business.';
        END IF;
        v_customer_id := COALESCE(v_merged_into, v_customer_id);

        SELECT COALESCE(wallet_balance, 0), COALESCE(debt_balance, 0)
        INTO v_wallet_before, v_debt_before
        FROM public.customers
        WHERE id = v_customer_id AND business_id = p_business_id
        FOR UPDATE;
    END IF;

    -- Debt first, the rest to the wallet.
    IF v_status = 'Success' AND v_customer_id IS NOT NULL THEN
        v_debt_applied   := LEAST(v_debt_before, v_amount);
        v_wallet_applied := v_amount - v_debt_applied;
        v_debt_after     := v_debt_before - v_debt_applied;
        v_wallet_after   := v_wallet_before + v_wallet_applied;
        v_applied_to := CASE
            WHEN v_debt_applied > 0 AND v_wallet_applied > 0 THEN 'mixed'
            WHEN v_debt_applied > 0 THEN 'debt'
            WHEN v_wallet_applied > 0 THEN 'wallet'
            ELSE 'none' END;
    END IF;

    INSERT INTO public.payments (
        business_id, reference_code, amount, method,
        sender_name, sender_phone, status, date,
        customer_id, customer_name, payment_type, description,
        applied_to, debt_applied, wallet_applied, reference_id, recorded_by
    )
    VALUES (
        p_business_id, p_reference_code, v_amount, p_method,
        p_sender_name, p_sender_phone, v_status, COALESCE(p_date, NOW()),
        v_customer_id, COALESCE(p_customer_name, p_sender_name),
        CASE WHEN v_customer_id IS NULL THEN 'walk-in' ELSE COALESCE(p_payment_type, 'customer') END,
        p_description,
        v_applied_to, v_debt_applied, v_wallet_applied,
        p_reference_code, v_by
    )
    RETURNING id INTO v_payment_id;

    IF v_status <> 'Success' THEN
        RETURN v_payment_id;
    END IF;

    PERFORM public.fn_post_money_asset(
        p_business_id, p_method, v_amount,
        COALESCE(p_description, 'Payment: ' || p_reference_code), v_payment_id, NULL, v_by
    );
    UPDATE public.money_assets SET last_payment_at = COALESCE(p_date, NOW())
    WHERE business_id = p_business_id AND method = p_method;

    IF v_customer_id IS NULL OR (v_debt_applied = 0 AND v_wallet_applied = 0) THEN
        RETURN v_payment_id;
    END IF;

    UPDATE public.customers
    SET debt_balance = v_debt_after, wallet_balance = v_wallet_after
    WHERE id = v_customer_id;

    IF v_debt_applied > 0 THEN
        INSERT INTO public.customer_ledger (
            business_id, customer_id, type, amount, wallet_balance,
            debt_balance, recorded_by, note, reference_id
        )
        VALUES (
            p_business_id, v_customer_id, 'debt_payment', v_debt_applied,
            v_wallet_after, v_debt_after, v_by,
            COALESCE(p_description, 'Debt payment via ' || p_method),
            p_reference_code || '-debt-payment'
        )
        ON CONFLICT (business_id, reference_id) WHERE reference_id IS NOT NULL DO NOTHING;

        -- Points for money towards a debt come from this row's trigger.
        INSERT INTO public.debt_payments (
            business_id, customer_id, amount_paid, remaining_debt,
            payment_method, recorded_by, note
        )
        VALUES (
            p_business_id, v_customer_id, v_debt_applied, v_debt_after,
            p_method, v_by, COALESCE(p_description, 'Debt payment via ' || p_method)
        );

        -- Oldest credit first.
        v_left := v_debt_applied;
        FOR v_rec IN
            SELECT id, balance FROM public.credit_payments
            WHERE customer_id = v_customer_id AND business_id = p_business_id
              AND status IN ('Open', 'Partial')
            ORDER BY created_at ASC, id ASC
            FOR UPDATE
        LOOP
            EXIT WHEN v_left <= 0;
            v_take := LEAST(v_left, v_rec.balance);
            v_left := v_left - v_take;
            UPDATE public.credit_payments
            SET amount_paid = amount_paid + v_take,
                status = CASE WHEN amount_paid + v_take >= amount_owed
                              THEN 'Settled'::public.credit_status ELSE 'Partial'::public.credit_status END,
                settled_at = CASE WHEN amount_paid + v_take >= amount_owed THEN NOW() ELSE NULL END,
                updated_at = NOW()
            WHERE id = v_rec.id;
        END LOOP;
    END IF;

    IF v_wallet_applied > 0 THEN
        INSERT INTO public.customer_ledger (
            business_id, customer_id, type, amount, wallet_balance,
            debt_balance, recorded_by, note, reference_id
        )
        VALUES (
            p_business_id, v_customer_id, 'wallet_topup', v_wallet_applied,
            v_wallet_after, v_debt_after, v_by,
            COALESCE(p_description, 'Wallet top-up via ' || p_method),
            p_reference_code || '-wallet-topup'
        )
        ON CONFLICT (business_id, reference_id) WHERE reference_id IS NOT NULL DO NOTHING;
    END IF;

    RETURN v_payment_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- 3. Card payments (Paystack)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.card_payment_settings (
    business_id   UUID PRIMARY KEY REFERENCES public.businesses(id) ON DELETE CASCADE,
    provider      TEXT NOT NULL DEFAULT 'paystack' CHECK (provider IN ('paystack')),
    environment   TEXT NOT NULL DEFAULT 'test' CHECK (environment IN ('test', 'live')),
    -- Online checkout and payment links.
    online_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    -- Paystack card reader in the shop, if the business has one.
    terminal_id   TEXT,
    terminal_name TEXT,
    status        TEXT NOT NULL DEFAULT 'connected' CHECK (status IN ('connected', 'error')),
    last_error    TEXT,
    updated_by    TEXT,
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.card_payment_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS pol_card_settings_select ON public.card_payment_settings;
CREATE POLICY pol_card_settings_select ON public.card_payment_settings FOR SELECT
    USING (public.has_permission(business_id, 'settings.integrations', 'payments.card', 'pos.create_sale', 'payments.view'));
-- Writes go through the card-payments edge function, which checks the key with Paystack first.

CREATE TABLE IF NOT EXISTS public.card_payment_secrets (
    business_id UUID PRIMARY KEY REFERENCES public.businesses(id) ON DELETE CASCADE,
    secret_key  TEXT NOT NULL,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.card_payment_secrets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.card_payment_secrets FROM anon, authenticated;

CREATE TABLE IF NOT EXISTS public.card_payments (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id        UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    -- sale: the till records the sale once paid. payment: recorded as a payment here.
    -- online_order: settles a website order.
    purpose            TEXT NOT NULL CHECK (purpose IN ('sale', 'payment', 'online_order')),
    channel            TEXT NOT NULL CHECK (channel IN ('online', 'terminal')),
    status             TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'success', 'failed', 'cancelled')),
    amount             NUMERIC(14,2) NOT NULL CHECK (amount > 0),
    amount_paid        NUMERIC(14,2),
    currency           TEXT NOT NULL DEFAULT 'KES',
    reference          TEXT NOT NULL UNIQUE,
    provider_reference TEXT,
    authorization_url  TEXT,
    email              TEXT,
    payer_name         TEXT,
    payer_phone        TEXT,
    description        TEXT,
    customer_id        UUID REFERENCES public.customers(id) ON DELETE SET NULL,
    online_order_id    UUID REFERENCES public.online_orders(id) ON DELETE SET NULL,
    transaction_id     UUID REFERENCES public.transactions(id) ON DELETE SET NULL,
    payment_id         UUID REFERENCES public.payments(id) ON DELETE SET NULL,
    card_brand         TEXT,
    card_last4         TEXT CHECK (card_last4 IS NULL OR card_last4 ~ '^[0-9]{4}$'),
    failure_reason     TEXT,
    requested_by       TEXT,
    raw                JSONB,
    paid_at            TIMESTAMPTZ,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_card_payments_business ON public.card_payments (business_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_card_payments_provider_ref ON public.card_payments (provider_reference) WHERE provider_reference IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_card_payments_order ON public.card_payments (online_order_id) WHERE online_order_id IS NOT NULL;
ALTER TABLE public.card_payments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS pol_card_payments_select ON public.card_payments;
CREATE POLICY pol_card_payments_select ON public.card_payments FOR SELECT
    USING (public.has_permission(business_id, 'payments.view', 'payments.card', 'pos.create_sale'));
GRANT SELECT ON public.card_payments, public.card_payment_settings TO authenticated;

ALTER TABLE public.card_payments REPLICA IDENTITY FULL;
DO $$ BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.card_payments;
EXCEPTION WHEN duplicate_object OR undefined_object THEN NULL; END $$;

-- Website orders say how they were paid.
ALTER TABLE public.online_orders
    ADD COLUMN IF NOT EXISTS payment_method    TEXT CHECK (payment_method IS NULL OR payment_method IN ('M-Pesa', 'Card')),
    ADD COLUMN IF NOT EXISTS payment_reference TEXT;

-- Settles a paid website order (card). Mirrors the M-Pesa success path in
-- confirm_online_order_payment. Returns 'paid' or 'flagged'.
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
           a.customer_id, v_order.customer_name, 'Website',
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
REVOKE ALL ON FUNCTION public.fn_settle_online_order_card(UUID) FROM PUBLIC, anon, authenticated;

-- The one place a card result is applied (service role only: the edge functions call it after
-- Paystack confirms). Money taken is never dropped: a success after a cancel still counts.
-- Returns 'paid', 'failed', 'duplicate', 'flagged' or 'unknown'.
CREATE OR REPLACE FUNCTION public.settle_card_payment(
    p_reference          TEXT,
    p_success            BOOLEAN,
    p_amount_paid        NUMERIC,
    p_provider_reference TEXT,
    p_card_brand         TEXT,
    p_card_last4         TEXT,
    p_failure_reason     TEXT,
    p_raw                JSONB
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_card   public.card_payments%ROWTYPE;
    v_pid    UUID;
    v_result TEXT := 'paid';
    v_last4  TEXT := CASE WHEN p_card_last4 ~ '^[0-9]{4}$' THEN p_card_last4 END;
BEGIN
    SELECT * INTO v_card FROM public.card_payments WHERE reference = p_reference FOR UPDATE;
    IF NOT FOUND THEN
        RETURN 'unknown';
    END IF;
    IF v_card.status = 'success' THEN
        RETURN 'duplicate';
    END IF;

    IF NOT p_success THEN
        IF v_card.status = 'pending' THEN
            UPDATE public.card_payments
            SET status = 'failed', failure_reason = left(COALESCE(p_failure_reason, 'Not paid'), 300),
                raw = COALESCE(p_raw, raw), updated_at = NOW()
            WHERE id = v_card.id;
            IF v_card.online_order_id IS NOT NULL THEN
                UPDATE public.online_orders SET status = 'payment_failed'
                WHERE id = v_card.online_order_id AND status = 'pending_payment'
                  AND NOT EXISTS (SELECT 1 FROM public.mpesa_transactions m
                                  WHERE m.online_order_id = v_card.online_order_id AND m.status = 'Pending');
            END IF;
        END IF;
        RETURN 'failed';
    END IF;

    UPDATE public.card_payments
    SET status = 'success',
        amount_paid = round(COALESCE(p_amount_paid, amount), 2),
        provider_reference = COALESCE(p_provider_reference, provider_reference),
        card_brand = COALESCE(initcap(p_card_brand), card_brand),
        card_last4 = COALESCE(v_last4, card_last4),
        failure_reason = NULL,
        raw = COALESCE(p_raw, raw),
        paid_at = NOW(),
        updated_at = NOW()
    WHERE id = v_card.id
    RETURNING * INTO v_card;

    IF v_card.purpose = 'payment' THEN
        v_pid := public.process_business_payment(
            v_card.business_id, v_card.reference, v_card.amount_paid, 'Card',
            COALESCE(v_card.payer_name, 'Card payment'), v_card.payer_phone, 'Success', NOW(),
            v_card.customer_id, NULL,
            CASE WHEN v_card.customer_id IS NULL THEN 'walk-in' ELSE 'customer' END,
            COALESCE(v_card.description, 'Card payment') || COALESCE(' (' || v_card.card_brand || ' •••• ' || v_card.card_last4 || ')', ''),
            v_card.requested_by
        );
        UPDATE public.card_payments SET payment_id = v_pid WHERE id = v_card.id;
    ELSIF v_card.purpose = 'online_order' THEN
        v_result := public.fn_settle_online_order_card(v_card.id);
    END IF;

    IF v_card.purpose <> 'online_order' AND v_card.amount_paid <> v_card.amount THEN
        PERFORM public.fn_notify_staff(v_card.business_id, 'Card payment amount differs',
            format('Card payment %s was for %s but %s was paid.', v_card.reference, v_card.amount, v_card.amount_paid),
            jsonb_build_object('cardPaymentId', v_card.id));
    END IF;

    RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION public.settle_card_payment(TEXT, BOOLEAN, NUMERIC, TEXT, TEXT, TEXT, TEXT, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.settle_card_payment(TEXT, BOOLEAN, NUMERIC, TEXT, TEXT, TEXT, TEXT, JSONB) TO service_role;

-- A paid card sale links to the sale the till recorded for it.
CREATE OR REPLACE FUNCTION public.attach_card_payment_to_sale(p_card_payment_id UUID, p_transaction_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_card public.card_payments%ROWTYPE;
BEGIN
    SELECT * INTO v_card FROM public.card_payments WHERE id = p_card_payment_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Card payment not found.';
    END IF;
    PERFORM public.assert_business_member(v_card.business_id);
    PERFORM public.assert_permission(v_card.business_id, 'pos.create_sale', 'payments.card');
    IF v_card.purpose <> 'sale' OR v_card.status <> 'success' THEN
        RAISE EXCEPTION 'Only a paid card sale can be linked to a sale.';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.transactions WHERE id = p_transaction_id AND business_id = v_card.business_id) THEN
        RAISE EXCEPTION 'Sale not found.';
    END IF;
    UPDATE public.card_payments SET transaction_id = p_transaction_id, updated_at = NOW()
    WHERE id = v_card.id AND transaction_id IS NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.attach_card_payment_to_sale(UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.attach_card_payment_to_sale(UUID, UUID) TO authenticated;

-- Whether the website should offer card at checkout. Says nothing else about the setup.
CREATE OR REPLACE FUNCTION public.website_accepts_cards(p_slug TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.businesses b
        JOIN public.card_payment_settings c ON c.business_id = b.id AND c.online_enabled
        JOIN public.card_payment_secrets k ON k.business_id = b.id
        WHERE b.website_slug = p_slug AND b.deleted_at IS NULL
    );
$$;
REVOKE ALL ON FUNCTION public.website_accepts_cards(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.website_accepts_cards(TEXT) TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. Role defaults (mirrors SYSTEM_ROLES in src/utils/permissions.ts; a test compares them)
-- ---------------------------------------------------------------------------
INSERT INTO public.role_default_permissions (role, permissions) VALUES
    ('Manager', ARRAY['ai.insights', 'ai.use', 'assets.view', 'bom.create', 'bom.update', 'bom.view', 'business.switch', 'business.view', 'communication.send', 'communication.view', 'complaints.reply', 'complaints.view', 'customers.create', 'customers.debts', 'customers.loyalty', 'customers.manage', 'customers.schedules', 'customers.update', 'customers.view', 'dashboard.view', 'deliveries.assign', 'deliveries.cancel', 'deliveries.complete', 'deliveries.create', 'deliveries.view', 'expenses.create', 'expenses.update', 'expenses.view', 'files.view', 'finance.view', 'home.view', 'inventory.adjust_stock', 'inventory.expiry', 'inventory.receive_stock', 'inventory.stock_count', 'inventory.stock_history', 'inventory.transfer_stock', 'inventory.view', 'inventory.wastage', 'loyalty.adjust', 'notifications.send', 'notifications.view', 'online_store.view', 'orders.assign_rider', 'orders.complete', 'orders.create', 'orders.update', 'orders.view', 'payments.card', 'payments.cash', 'payments.verify', 'payments.view', 'pettycash.record', 'pos.close_shift', 'pos.create_sale', 'pos.open_shift', 'pos.walkin_customer', 'production.approve', 'production.create', 'production.update', 'production.view', 'products.create', 'products.export', 'products.import', 'products.manage_categories', 'products.update', 'products.view', 'purchases.approve', 'purchases.create', 'purchases.export', 'purchases.print', 'purchases.update', 'purchases.view', 'reports.customers', 'reports.deliveries', 'reports.inventory', 'reports.profit', 'reports.sales', 'reports.view', 'settings.tax', 'settings.theme', 'settings.update', 'settings.view', 'staff.schedule', 'staff.view', 'suppliers.create', 'suppliers.export', 'suppliers.import', 'suppliers.update', 'suppliers.view']),
    ('Cashier', ARRAY['ai.use', 'business.view', 'complaints.view', 'customers.create', 'customers.debts', 'customers.loyalty', 'customers.schedules', 'customers.view', 'dashboard.view', 'inventory.view', 'notifications.view', 'online_store.view', 'orders.assign_rider', 'orders.create', 'orders.update', 'orders.view', 'payments.card', 'payments.cash', 'payments.mpesa', 'payments.verify', 'pettycash.record', 'pos.cancel_sale', 'pos.close_shift', 'pos.create_sale', 'pos.discount', 'pos.open_shift', 'pos.walkin_customer', 'products.view', 'settings.theme']),
    ('Rider', ARRAY['ai.use', 'business.view', 'dashboard.view', 'deliveries.cancel', 'deliveries.complete', 'deliveries.delivery_price', 'deliveries.delivery_zones', 'deliveries.view', 'notifications.view', 'settings.theme'])
ON CONFLICT (role) DO UPDATE SET permissions = EXCLUDED.permissions;

NOTIFY pgrst, 'reload schema';

COMMIT;
