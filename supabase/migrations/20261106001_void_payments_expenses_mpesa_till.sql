-- =============================================================================
-- 20261106001_void_payments_expenses_mpesa_till.sql
-- Why:
--  * Deleting a payment left money balances and customer debt/wallet changed.
--    Payments are now voided, which reverses every effect and keeps the record.
--  * Editing or removing an expense never returned the money to its balance, and
--    an expense larger than the tracked balance couldn't be saved at all.
--  * Payments rejected Mobile_Wallet even though the app offers it.
--  * Expense categories were fixed in the app. Each business now has its own list.
--  * M-Pesa uses a till. Customers get an account number, staff can send a payment
--    prompt from the app, and money sent straight to the till lands in a queue for
--    staff to assign, because a till payment carries no account number.
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Constraints
-- ---------------------------------------------------------------------------
-- Balances are tracked from when the app started, not from real opening cash, so
-- spending more than the tracked amount must still be recordable. A negative
-- balance shows up on screen instead of blocking the expense.
DO $$
DECLARE c RECORD;
BEGIN
    FOR c IN
        SELECT conname, conrelid::regclass AS tbl FROM pg_constraint
        WHERE contype = 'c' AND (
            (conrelid = 'public.money_assets'::regclass AND pg_get_constraintdef(oid) ILIKE '%balance >=%')
            OR (conrelid = 'public.payments'::regclass AND pg_get_constraintdef(oid) ILIKE '%method%')
            OR (conrelid = 'public.payments'::regclass AND pg_get_constraintdef(oid) ILIKE '%status%')
        )
    LOOP
        EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', c.tbl, c.conname);
    END LOOP;
END $$;

ALTER TABLE public.payments
    ADD CONSTRAINT payments_method_check
        CHECK (method IN ('M-Pesa', 'Cash', 'Card', 'Bank', 'Mobile_Wallet', 'Other')),
    ADD CONSTRAINT payments_status_check
        CHECK (status IN ('Success', 'Pending', 'Failed', 'Voided')),
    ADD COLUMN IF NOT EXISTS voided_at   TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS voided_by   TEXT,
    ADD COLUMN IF NOT EXISTS void_reason TEXT;

-- ---------------------------------------------------------------------------
-- 2. One place that moves a money balance and writes its ledger row
-- ---------------------------------------------------------------------------
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
    v_method   TEXT := CASE WHEN p_method IN ('M-Pesa', 'Cash', 'Card', 'Bank', 'Mobile_Wallet') THEN p_method ELSE 'Other' END;
    v_asset_id UUID;
    v_after    NUMERIC(14,2);
BEGIN
    IF COALESCE(p_delta, 0) = 0 THEN
        RETURN;
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
-- 3. Expenses: recording, editing and removing all keep the balance right
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_process_expense_asset_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_old_active BOOLEAN := TG_OP <> 'INSERT' AND OLD.deleted_at IS NULL;
    v_new_active BOOLEAN := TG_OP <> 'DELETE' AND NEW.deleted_at IS NULL;
    v_changed    BOOLEAN := TG_OP = 'UPDATE' AND (
        NEW.amount IS DISTINCT FROM OLD.amount
        OR NEW.payment_method IS DISTINCT FROM OLD.payment_method
        OR NEW.business_id IS DISTINCT FROM OLD.business_id
    );
BEGIN
    -- Put back what the old version took out.
    IF v_old_active AND (NOT v_new_active OR v_changed) THEN
        PERFORM public.fn_post_money_asset(
            OLD.business_id, COALESCE(OLD.payment_method, 'Cash'), OLD.amount,
            CASE WHEN v_new_active THEN 'Expense changed: ' ELSE 'Expense removed: ' END || OLD.category,
            NULL,
            -- A hard-deleted row can't be referenced.
            CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE OLD.id END,
            CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE NEW.last_modified_by END
        );
    END IF;

    -- Take out what the new version spends.
    IF v_new_active AND (TG_OP = 'INSERT' OR NOT v_old_active OR v_changed) THEN
        PERFORM public.fn_post_money_asset(
            NEW.business_id, COALESCE(NEW.payment_method, 'Cash'), -NEW.amount,
            'Expense: ' || NEW.category, NULL, NEW.id, NEW.staff_name
        );
    END IF;

    RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_process_expense_asset_update ON public.expenses;
CREATE TRIGGER trg_process_expense_asset_update
AFTER INSERT OR UPDATE OR DELETE ON public.expenses
FOR EACH ROW EXECUTE FUNCTION public.fn_process_expense_asset_update();

-- ---------------------------------------------------------------------------
-- 4. Expense categories: every business starts with the usual list and can add its own
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_seed_expense_categories(p_business_id UUID)
RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
    INSERT INTO public.expense_categories (business_id, name, status, is_custom)
    SELECT p_business_id, d.name, 'Enabled', FALSE
    FROM (VALUES ('Rent'), ('Wages'), ('Transport'), ('Utilities'), ('Maintenance'),
                 ('Marketing'), ('Supplies'), ('Other')) AS d(name)
    WHERE NOT EXISTS (
        SELECT 1 FROM public.expense_categories c
        WHERE c.business_id = p_business_id AND lower(c.name) = lower(d.name) AND c.deleted_at IS NULL
    );
$$;

CREATE OR REPLACE FUNCTION public.fn_seed_business_expense_categories()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    PERFORM public.fn_seed_expense_categories(NEW.id);
    RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_seed_expense_categories ON public.businesses;
CREATE TRIGGER trg_seed_expense_categories
AFTER INSERT ON public.businesses
FOR EACH ROW EXECUTE FUNCTION public.fn_seed_business_expense_categories();

SELECT public.fn_seed_expense_categories(id) FROM public.businesses;

REVOKE ALL ON FUNCTION public.fn_seed_expense_categories(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_seed_business_expense_categories() FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. Voiding a payment reverses everything it did
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.void_business_payment(
    p_payment_id UUID,
    p_reason     TEXT,
    p_voided_by  TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_pay        public.payments%ROWTYPE;
    v_wallet     NUMERIC(14,2);
    v_debt       NUMERIC(14,2);
    v_offset     NUMERIC(14,2);
    v_remaining  NUMERIC(14,2);
    v_take       NUMERIC(14,2);
    v_rec        RECORD;
    v_by         TEXT := COALESCE(NULLIF(trim(p_voided_by), ''), 'System');
    v_note       TEXT;
BEGIN
    SELECT * INTO v_pay FROM public.payments WHERE id = p_payment_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Payment not found.';
    END IF;

    PERFORM public.assert_business_member(v_pay.business_id);
    PERFORM public.assert_permission(v_pay.business_id, 'payments.manage');

    IF v_pay.status = 'Voided' THEN
        RETURN;
    END IF;
    IF COALESCE(trim(p_reason), '') = '' THEN
        RAISE EXCEPTION 'Give a reason for voiding this payment.';
    END IF;

    v_note := 'Voided payment ' || v_pay.reference_code || ': ' || trim(p_reason);

    IF v_pay.status = 'Success' THEN
        PERFORM public.fn_post_money_asset(
            v_pay.business_id, v_pay.method, -v_pay.amount, v_note, v_pay.id, NULL, v_by
        );

        IF v_pay.customer_id IS NOT NULL AND (v_pay.debt_applied > 0 OR v_pay.wallet_applied > 0) THEN
            SELECT wallet_balance, debt_balance INTO v_wallet, v_debt
            FROM public.customers WHERE id = v_pay.customer_id FOR UPDATE;

            IF v_wallet < v_pay.wallet_applied THEN
                RAISE EXCEPTION 'This customer has already spent Ksh % of the wallet credit from this payment, so it can''t be voided here. Adjust their balance from the customer screen.',
                    v_pay.wallet_applied - v_wallet;
            END IF;

            v_wallet := v_wallet - v_pay.wallet_applied;
            v_debt   := v_debt + v_pay.debt_applied;
            -- A customer can't hold credit and owe at the same time, so the two net off.
            v_offset := LEAST(v_wallet, v_debt);
            v_wallet := v_wallet - v_offset;
            v_debt   := v_debt - v_offset;

            UPDATE public.customers
            SET wallet_balance = v_wallet, debt_balance = v_debt
            WHERE id = v_pay.customer_id;

            IF v_pay.debt_applied > 0 THEN
                INSERT INTO public.customer_ledger (
                    business_id, customer_id, type, amount, wallet_balance, debt_balance,
                    recorded_by, note, reference_id
                )
                VALUES (
                    v_pay.business_id, v_pay.customer_id, 'debt_adjustment', v_pay.debt_applied,
                    v_wallet, v_debt, v_by, v_note, 'void-' || v_pay.id || '-debt'
                )
                ON CONFLICT (business_id, reference_id) WHERE reference_id IS NOT NULL DO NOTHING;

                -- Reopen credit, most recently paid first.
                v_remaining := v_pay.debt_applied - v_offset;
                FOR v_rec IN
                    SELECT id, amount_paid FROM public.credit_payments
                    WHERE customer_id = v_pay.customer_id AND business_id = v_pay.business_id
                      AND amount_paid > 0
                    ORDER BY updated_at DESC, created_at DESC
                    FOR UPDATE
                LOOP
                    EXIT WHEN v_remaining <= 0;
                    v_take := LEAST(v_remaining, v_rec.amount_paid);
                    v_remaining := v_remaining - v_take;
                    UPDATE public.credit_payments
                    SET amount_paid = amount_paid - v_take,
                        status = CASE WHEN amount_paid - v_take <= 0
                                      THEN 'Open'::public.credit_status
                                      ELSE 'Partial'::public.credit_status END,
                        settled_at = NULL,
                        updated_at = NOW()
                    WHERE id = v_rec.id;
                END LOOP;
            END IF;

            IF v_pay.wallet_applied > 0 THEN
                INSERT INTO public.customer_ledger (
                    business_id, customer_id, type, amount, wallet_balance, debt_balance,
                    recorded_by, note, reference_id
                )
                VALUES (
                    v_pay.business_id, v_pay.customer_id, 'wallet_usage', v_pay.wallet_applied,
                    v_wallet, v_debt, v_by, v_note, 'void-' || v_pay.id || '-wallet'
                )
                ON CONFLICT (business_id, reference_id) WHERE reference_id IS NOT NULL DO NOTHING;
            END IF;
        END IF;
    END IF;

    -- The reference is freed so the same receipt can be recorded correctly again.
    -- reference_id still holds the original.
    UPDATE public.payments
    SET status = 'Voided', voided_at = NOW(), voided_by = v_by, void_reason = trim(p_reason),
        reference_id = COALESCE(reference_id, reference_code),
        reference_code = reference_code || '-VOID-' || to_char(NOW(), 'YYMMDDHH24MISS')
    WHERE id = v_pay.id;

    -- A till payment that was assigned goes back to the queue.
    UPDATE public.mpesa_till_payments
    SET status = 'unclaimed', payment_id = NULL, customer_id = NULL, handled_by = NULL, handled_at = NULL
    WHERE payment_id = v_pay.id;
END;
$$;

-- ---------------------------------------------------------------------------
-- 6. Customer account numbers, used as the M-Pesa account reference
-- ---------------------------------------------------------------------------
CREATE SEQUENCE IF NOT EXISTS public.customer_account_number_seq START 100001;

ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS account_number TEXT;

UPDATE public.customers c
SET account_number = nextval('public.customer_account_number_seq')::TEXT
FROM (SELECT id FROM public.customers WHERE account_number IS NULL ORDER BY created_at, id) o
WHERE c.id = o.id;

ALTER TABLE public.customers
    ALTER COLUMN account_number SET DEFAULT nextval('public.customer_account_number_seq')::TEXT,
    ALTER COLUMN account_number SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_customers_account_number ON public.customers(account_number);

-- The number is printed and shared with customers, so it never changes once given.
CREATE OR REPLACE FUNCTION public.fn_keep_customer_account_number()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF current_user IN ('anon', 'authenticated') OR NEW.account_number IS NULL THEN
            NEW.account_number := nextval('public.customer_account_number_seq')::TEXT;
        END IF;
    ELSE
        NEW.account_number := OLD.account_number;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_keep_customer_account_number ON public.customers;
CREATE TRIGGER trg_keep_customer_account_number
BEFORE INSERT OR UPDATE ON public.customers
FOR EACH ROW EXECUTE FUNCTION public.fn_keep_customer_account_number();

-- ---------------------------------------------------------------------------
-- 7. M-Pesa settings per business, and payment prompts sent from the app
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.mpesa_settings (
    business_id  UUID PRIMARY KEY REFERENCES public.businesses(id) ON DELETE CASCADE,
    till_number  TEXT UNIQUE CHECK (till_number ~ '^[0-9]{5,10}$'),
    registered_at TIMESTAMPTZ,
    updated_by   TEXT,
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.mpesa_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pol_mpesa_settings_select ON public.mpesa_settings;
CREATE POLICY pol_mpesa_settings_select ON public.mpesa_settings FOR SELECT
    USING (public.has_permission(business_id, 'payments.view', 'payments.mpesa', 'settings.integrations'));
DROP POLICY IF EXISTS pol_mpesa_settings_write ON public.mpesa_settings;
CREATE POLICY pol_mpesa_settings_write ON public.mpesa_settings FOR ALL
    USING (public.has_permission(business_id, 'settings.integrations'))
    WITH CHECK (public.has_permission(business_id, 'settings.integrations'));

ALTER TABLE public.mpesa_transactions
    ADD COLUMN IF NOT EXISTS customer_id       UUID REFERENCES public.customers(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS account_reference TEXT,
    ADD COLUMN IF NOT EXISTS description       TEXT,
    ADD COLUMN IF NOT EXISTS requested_by      TEXT,
    ADD COLUMN IF NOT EXISTS payment_id        UUID REFERENCES public.payments(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_mpesa_transactions_business
    ON public.mpesa_transactions(business_id, created_at DESC);

-- Applies Safaricom's answer to a prompt sent from the app. Once per checkout.
CREATE OR REPLACE FUNCTION public.confirm_store_payment_request(
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
    v_req     public.mpesa_transactions%ROWTYPE;
    v_name    TEXT;
    v_pid     UUID;
BEGIN
    SELECT * INTO v_req FROM public.mpesa_transactions
    WHERE checkout_request_id = p_checkout_request_id
      AND online_order_id IS NULL AND business_id IS NOT NULL
    FOR UPDATE;
    IF NOT FOUND THEN
        RETURN 'unknown';
    END IF;
    IF v_req.status = 'Completed' OR (v_req.status <> 'Pending' AND p_result_code <> 0) THEN
        RETURN 'duplicate';
    END IF;

    IF p_result_code <> 0 THEN
        UPDATE public.mpesa_transactions
        SET status = 'Failed', raw_callback = COALESCE(p_raw, raw_callback), updated_at = NOW()
        WHERE id = v_req.id;
        RETURN 'failed';
    END IF;

    IF p_receipt IS NULL THEN
        RAISE EXCEPTION 'A successful M-Pesa result arrived without a receipt number.';
    END IF;

    SELECT name INTO v_name FROM public.customers WHERE id = v_req.customer_id;

    v_pid := public.process_business_payment(
        v_req.business_id, p_receipt, COALESCE(p_amount, v_req.amount), 'M-Pesa',
        COALESCE(v_name, 'M-Pesa ' || v_req.phone), v_req.phone, 'Success', NOW(),
        v_req.customer_id, v_name,
        CASE WHEN v_req.customer_id IS NULL THEN 'walk-in' ELSE 'customer' END,
        COALESCE(v_req.description, 'M-Pesa prompt'), v_req.requested_by
    );

    UPDATE public.mpesa_transactions
    SET status = 'Completed', receipt_number = p_receipt,
        amount = COALESCE(p_amount, amount), mpesa_receipt_timestamp = NOW(),
        raw_callback = p_raw, payment_id = v_pid, updated_at = NOW()
    WHERE id = v_req.id;

    PERFORM public.fn_notify_staff(v_req.business_id, 'M-Pesa payment received',
        format('Ksh %s from %s (%s).', COALESCE(p_amount, v_req.amount), COALESCE(v_name, v_req.phone), p_receipt),
        jsonb_build_object('paymentId', v_pid));
    RETURN 'recorded';
END;
$$;

REVOKE ALL ON FUNCTION public.confirm_store_payment_request(TEXT, INTEGER, NUMERIC, TEXT, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_store_payment_request(TEXT, INTEGER, NUMERIC, TEXT, JSONB) TO service_role;

-- ---------------------------------------------------------------------------
-- 8. Money sent straight to the till
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.mpesa_till_payments (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id    UUID REFERENCES public.businesses(id) ON DELETE CASCADE,
    trans_id       TEXT NOT NULL UNIQUE,
    trans_type     TEXT,
    amount         NUMERIC(14,2) NOT NULL CHECK (amount > 0),
    short_code     TEXT,
    bill_ref       TEXT,
    msisdn         TEXT,
    payer_name     TEXT,
    trans_time     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    status         TEXT NOT NULL DEFAULT 'unclaimed'
                       CHECK (status IN ('unclaimed', 'recorded', 'matched_sale', 'ignored')),
    customer_id    UUID REFERENCES public.customers(id) ON DELETE SET NULL,
    payment_id     UUID REFERENCES public.payments(id) ON DELETE SET NULL,
    handled_by     TEXT,
    handled_at     TIMESTAMPTZ,
    note           TEXT,
    raw            JSONB,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_mpesa_till_payments_business
    ON public.mpesa_till_payments(business_id, status, trans_time DESC);
ALTER TABLE public.mpesa_till_payments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pol_mpesa_till_payments_select ON public.mpesa_till_payments;
CREATE POLICY pol_mpesa_till_payments_select ON public.mpesa_till_payments FOR SELECT
    USING (public.has_permission(business_id, 'payments.view', 'payments.mpesa', 'payments.verify'));

DROP POLICY IF EXISTS pol_mpesa_transactions_select ON public.mpesa_transactions;
CREATE POLICY pol_mpesa_transactions_select ON public.mpesa_transactions FOR SELECT
    USING (public.has_permission(business_id, 'payments.view', 'payments.mpesa'));

-- Called by the till-callback function with Safaricom's confirmation payload.
CREATE OR REPLACE FUNCTION public.record_till_payment(p_raw JSONB)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_trans_id  TEXT := NULLIF(trim(p_raw->>'TransID'), '');
    v_amount    NUMERIC := NULLIF(p_raw->>'TransAmount', '')::NUMERIC;
    v_short     TEXT := NULLIF(trim(p_raw->>'BusinessShortCode'), '');
    v_ref       TEXT := NULLIF(trim(p_raw->>'BillRefNumber'), '');
    v_name      TEXT := NULLIF(trim(concat_ws(' ', p_raw->>'FirstName', p_raw->>'MiddleName', p_raw->>'LastName')), '');
    v_time      TIMESTAMPTZ;
    v_biz       UUID;
    v_cust_id   UUID;
    v_cust_name TEXT;
    v_row_id    UUID;
    v_pid       UUID;
BEGIN
    IF v_trans_id IS NULL OR COALESCE(v_amount, 0) <= 0 THEN
        RAISE EXCEPTION 'Till confirmation is missing TransID or TransAmount.';
    END IF;

    BEGIN
        -- Safaricom sends Nairobi local time as YYYYMMDDHHmmss.
        v_time := COALESCE(to_timestamp(p_raw->>'TransTime', 'YYYYMMDDHH24MISS')::TIMESTAMP AT TIME ZONE 'Africa/Nairobi', NOW());
    EXCEPTION WHEN OTHERS THEN
        v_time := NOW();
    END;

    SELECT business_id INTO v_biz FROM public.mpesa_settings WHERE till_number = v_short;
    IF v_biz IS NULL AND (SELECT count(*) FROM public.mpesa_settings WHERE till_number IS NOT NULL) = 1 THEN
        -- Some tills report the store number here, so a single configured till takes it.
        SELECT business_id INTO v_biz FROM public.mpesa_settings WHERE till_number IS NOT NULL;
    END IF;

    INSERT INTO public.mpesa_till_payments (
        business_id, trans_id, trans_type, amount, short_code, bill_ref, msisdn, payer_name, trans_time, raw
    )
    VALUES (
        v_biz, v_trans_id, p_raw->>'TransactionType', v_amount, v_short, v_ref,
        NULLIF(p_raw->>'MSISDN', ''), v_name, v_time, p_raw
    )
    ON CONFLICT (trans_id) DO NOTHING
    RETURNING id INTO v_row_id;

    IF v_row_id IS NULL THEN
        RETURN 'duplicate';
    END IF;
    IF v_biz IS NULL THEN
        RAISE WARNING 'Till payment % for short code % matches no business', v_trans_id, v_short;
        RETURN 'no_business';
    END IF;

    -- Paybill-style payments carry the account number, so those settle themselves.
    IF v_ref IS NOT NULL THEN
        SELECT id, name INTO v_cust_id, v_cust_name FROM public.customers
        WHERE business_id = v_biz AND deleted_at IS NULL
          AND upper(account_number) = upper(v_ref);
    END IF;

    IF v_cust_id IS NOT NULL THEN
        v_pid := public.process_business_payment(
            v_biz, v_trans_id, v_amount, 'M-Pesa', COALESCE(v_name, v_cust_name),
            p_raw->>'MSISDN', 'Success', v_time, v_cust_id, v_cust_name, 'customer',
            'M-Pesa till payment', 'M-Pesa'
        );
        UPDATE public.mpesa_till_payments
        SET status = 'recorded', customer_id = v_cust_id, payment_id = v_pid,
            handled_by = 'Matched by account number', handled_at = NOW()
        WHERE id = v_row_id;
        PERFORM public.fn_notify_staff(v_biz, 'M-Pesa payment received',
            format('Ksh %s from %s (%s).', v_amount, v_cust_name, v_trans_id),
            jsonb_build_object('paymentId', v_pid));
        RETURN 'recorded';
    END IF;

    PERFORM public.fn_notify_staff(v_biz, 'M-Pesa till payment to assign',
        format('Ksh %s from %s (%s). Open Payments > M-Pesa to assign it.', v_amount, COALESCE(v_name, 'a customer'), v_trans_id),
        jsonb_build_object('tillPaymentId', v_row_id));
    RETURN 'queued';
END;
$$;

REVOKE ALL ON FUNCTION public.record_till_payment(JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_till_payment(JSONB) TO service_role;

-- Staff decide what an unassigned till payment was.
--   customer: pays down their debt, then tops up their wallet
--   walk_in:  money received without a sale or a customer
--   sale:     already rung up as an M-Pesa sale, so the balance isn't counted twice
--   ignore:   a test, a refund or a mistake; needs a note
--   reopen:   puts a sale or ignore decision back in the queue
CREATE OR REPLACE FUNCTION public.handle_till_payment(
    p_till_payment_id UUID,
    p_action          TEXT,
    p_customer_id     UUID DEFAULT NULL,
    p_note            TEXT DEFAULT NULL,
    p_handled_by      TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_row  public.mpesa_till_payments%ROWTYPE;
    v_name TEXT;
    v_pid  UUID;
    v_by   TEXT := COALESCE(NULLIF(trim(p_handled_by), ''), 'Staff');
BEGIN
    SELECT * INTO v_row FROM public.mpesa_till_payments WHERE id = p_till_payment_id FOR UPDATE;
    IF NOT FOUND OR v_row.business_id IS NULL THEN
        RAISE EXCEPTION 'Till payment not found.';
    END IF;

    PERFORM public.assert_business_member(v_row.business_id);
    PERFORM public.assert_permission(v_row.business_id, 'payments.verify', 'payments.mpesa');

    IF p_action = 'reopen' THEN
        IF v_row.status NOT IN ('matched_sale', 'ignored') THEN
            RAISE EXCEPTION 'Only payments marked as a sale or ignored can go back to the queue. Void the payment instead.';
        END IF;
        UPDATE public.mpesa_till_payments
        SET status = 'unclaimed', handled_by = NULL, handled_at = NULL, note = NULL
        WHERE id = v_row.id;
        RETURN NULL;
    END IF;

    IF v_row.status <> 'unclaimed' THEN
        RAISE EXCEPTION 'This payment was already handled by %.', COALESCE(v_row.handled_by, 'someone else');
    END IF;

    IF p_action IN ('customer', 'walk_in') THEN
        IF p_action = 'customer' THEN
            SELECT name INTO v_name FROM public.customers
            WHERE id = p_customer_id AND business_id = v_row.business_id AND deleted_at IS NULL;
            IF v_name IS NULL THEN
                RAISE EXCEPTION 'Choose a customer for this payment.';
            END IF;
        END IF;

        v_pid := public.process_business_payment(
            v_row.business_id, v_row.trans_id, v_row.amount, 'M-Pesa',
            COALESCE(v_row.payer_name, v_name, 'M-Pesa customer'), v_row.msisdn, 'Success', v_row.trans_time,
            CASE WHEN p_action = 'customer' THEN p_customer_id END, v_name,
            CASE WHEN p_action = 'customer' THEN 'customer' ELSE 'walk-in' END,
            COALESCE(NULLIF(trim(p_note), ''), 'M-Pesa till payment'), v_by
        );
        UPDATE public.mpesa_till_payments
        SET status = 'recorded', payment_id = v_pid,
            customer_id = CASE WHEN p_action = 'customer' THEN p_customer_id END,
            handled_by = v_by, handled_at = NOW(), note = NULLIF(trim(p_note), '')
        WHERE id = v_row.id;
        RETURN v_pid;
    END IF;

    IF p_action = 'ignore' AND COALESCE(trim(p_note), '') = '' THEN
        RAISE EXCEPTION 'Say why this payment is being ignored.';
    END IF;
    IF p_action NOT IN ('sale', 'ignore') THEN
        RAISE EXCEPTION 'Unknown action %.', p_action;
    END IF;

    UPDATE public.mpesa_till_payments
    SET status = CASE WHEN p_action = 'sale' THEN 'matched_sale' ELSE 'ignored' END,
        handled_by = v_by, handled_at = NOW(), note = NULLIF(trim(p_note), '')
    WHERE id = v_row.id;
    RETURN NULL;
END;
$$;

-- ---------------------------------------------------------------------------
-- 9. Access
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.void_business_payment(UUID, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.void_business_payment(UUID, TEXT, TEXT) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.handle_till_payment(UUID, TEXT, UUID, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.handle_till_payment(UUID, TEXT, UUID, TEXT, TEXT) TO authenticated, service_role;

GRANT SELECT ON public.mpesa_till_payments TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.mpesa_settings TO authenticated;
GRANT ALL ON public.mpesa_till_payments, public.mpesa_settings TO service_role;
GRANT SELECT ON public.mpesa_transactions TO authenticated;
GRANT USAGE ON SEQUENCE public.customer_account_number_seq TO authenticated, service_role;

-- Payments are voided, never deleted, so the history stays complete.
REVOKE DELETE ON public.payments FROM authenticated;

DO $$
BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.mpesa_till_payments;
EXCEPTION WHEN duplicate_object OR undefined_object THEN NULL;
END $$;
DO $$
BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.mpesa_transactions;
EXCEPTION WHEN duplicate_object OR undefined_object THEN NULL;
END $$;

NOTIFY pgrst, 'reload schema';

COMMIT;
