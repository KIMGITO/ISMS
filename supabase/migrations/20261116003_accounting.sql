-- =============================================================================
-- 20261116003_accounting.sql
-- Accounting: chart of accounts, a double-entry journal that keeps itself up to
-- date from sales, expenses, petty cash, customer payments, purchases, supplier
-- payments and stock losses, plus manual entries, a lock date, money and stock
-- checks, and the reports (trial balance, profit & loss, balance sheet, VAT,
-- what customers owe, what we owe suppliers).
--
-- How posting works
--   Every business record that moves money or stock has at most one current
--   journal entry, keyed by (source_type, source_id). acc_post_source() works out
--   the lines the record should have and replaces the entry when they changed.
--   A record removed (deleted_at, cancelled, voided) loses its entry.
--   Entries dated on or before the lock date are never changed: a change is
--   booked as a reversal plus a new entry dated after the lock date.
--   Posting runs in deferred triggers (at commit, after a sale's lines exist).
--   A posting error never blocks the sale or payment: it is saved in
--   acc_post_errors and can be retried from the Accounting screen.
--
-- Signs: every line has debit or credit. Assets and expenses grow with debits;
-- liabilities, equity and income grow with credits.
--
-- New permissions: accounting.view (Manager), accounting.manage (Owner/Admin).
-- New table supplier_payments: paying a supplier lowers the money balance and
-- what we owe them.
-- Dependencies: everything before; fn_post_money_asset (20261116002).
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Tables
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.acc_accounts (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    code        TEXT NOT NULL,
    name        TEXT NOT NULL,
    type        TEXT NOT NULL CHECK (type IN ('asset', 'liability', 'equity', 'income', 'expense')),
    system_key  TEXT,
    description TEXT,
    is_active   BOOLEAN NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (business_id, code)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_acc_accounts_key ON public.acc_accounts(business_id, system_key) WHERE system_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.acc_settings (
    business_id UUID PRIMARY KEY REFERENCES public.businesses(id) ON DELETE CASCADE,
    lock_date   DATE,
    updated_by  TEXT,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.acc_entries (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    no           BIGINT GENERATED ALWAYS AS IDENTITY,
    business_id  UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    entry_date   DATE NOT NULL,
    memo         TEXT NOT NULL DEFAULT '',
    -- NULL source_type = typed by a person (manual entry)
    source_type  TEXT,
    source_id    UUID,
    fingerprint  TEXT,
    reversal_of  UUID REFERENCES public.acc_entries(id) ON DELETE SET NULL,
    reversed_at  TIMESTAMPTZ,
    created_by   TEXT NOT NULL DEFAULT 'System',
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_acc_entries_business_date ON public.acc_entries(business_id, entry_date DESC, no DESC);
CREATE INDEX IF NOT EXISTS idx_acc_entries_source ON public.acc_entries(business_id, source_type, source_id);

CREATE TABLE IF NOT EXISTS public.acc_lines (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    entry_id    UUID NOT NULL REFERENCES public.acc_entries(id) ON DELETE CASCADE,
    business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    account_id  UUID NOT NULL REFERENCES public.acc_accounts(id) ON DELETE CASCADE,
    entry_date  DATE NOT NULL,
    debit       NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (debit >= 0),
    credit      NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (credit >= 0),
    party_type  TEXT CHECK (party_type IN ('customer', 'supplier')),
    party_id    TEXT,
    party_name  TEXT,
    memo        TEXT,
    CHECK (debit = 0 OR credit = 0)
);
CREATE INDEX IF NOT EXISTS idx_acc_lines_account_date ON public.acc_lines(business_id, account_id, entry_date);
CREATE INDEX IF NOT EXISTS idx_acc_lines_entry ON public.acc_lines(entry_id);
CREATE INDEX IF NOT EXISTS idx_acc_lines_party ON public.acc_lines(business_id, party_type, party_id);

CREATE TABLE IF NOT EXISTS public.acc_post_errors (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id UUID REFERENCES public.businesses(id) ON DELETE CASCADE,
    source_type TEXT NOT NULL,
    source_id   UUID NOT NULL,
    message     TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (source_type, source_id)
);

CREATE TABLE IF NOT EXISTS public.acc_reconciliations (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id    UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    account_id     UUID NOT NULL REFERENCES public.acc_accounts(id) ON DELETE CASCADE,
    kind           TEXT NOT NULL DEFAULT 'money' CHECK (kind IN ('money', 'stock')),
    book_balance   NUMERIC(14,2) NOT NULL,
    actual_balance NUMERIC(14,2) NOT NULL,
    app_balance    NUMERIC(14,2),
    difference     NUMERIC(14,2) NOT NULL,
    entry_id       UUID REFERENCES public.acc_entries(id) ON DELETE SET NULL,
    note           TEXT,
    recorded_by    TEXT,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_acc_recon_business ON public.acc_reconciliations(business_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.supplier_payments (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id   UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    supplier_id   UUID REFERENCES public.suppliers(id) ON DELETE SET NULL,
    supplier_name TEXT NOT NULL,
    purchase_id   UUID REFERENCES public.purchases(id) ON DELETE SET NULL,
    amount        NUMERIC(14,2) NOT NULL CHECK (amount > 0),
    method        TEXT NOT NULL CHECK (method IN ('Cash', 'M-Pesa', 'Airtel Money', 'Card', 'Bank')),
    paid_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    reference     TEXT,
    note          TEXT,
    recorded_by   TEXT,
    voided_at     TIMESTAMPTZ,
    voided_by     TEXT,
    void_reason   TEXT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_supplier_payments_business ON public.supplier_payments(business_id, paid_at DESC);
CREATE INDEX IF NOT EXISTS idx_supplier_payments_purchase ON public.supplier_payments(purchase_id);

-- Everything is read and written through the functions below. Members with the
-- permission may read the tables directly too.
ALTER TABLE public.acc_accounts        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.acc_settings        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.acc_entries         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.acc_lines           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.acc_post_errors     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.acc_reconciliations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.supplier_payments   ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE t TEXT;
BEGIN
    FOREACH t IN ARRAY ARRAY['acc_accounts', 'acc_settings', 'acc_entries', 'acc_lines', 'acc_post_errors', 'acc_reconciliations'] LOOP
        EXECUTE format('DROP POLICY IF EXISTS pol_%1$s_select ON public.%1$I', t);
        EXECUTE format('CREATE POLICY pol_%1$s_select ON public.%1$I FOR SELECT USING (business_id = ANY(public.get_user_business_ids()) AND public.has_permission(business_id, ''accounting.view''))', t);
    END LOOP;
END $$;

DROP POLICY IF EXISTS pol_supplier_payments_select ON public.supplier_payments;
CREATE POLICY pol_supplier_payments_select ON public.supplier_payments FOR SELECT
    USING (business_id = ANY(public.get_user_business_ids())
           AND public.has_permission(business_id, 'accounting.view', 'purchases.view'));

-- ---------------------------------------------------------------------------
-- 2. Chart of accounts
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.acc_ensure_accounts(p_business_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM public.businesses WHERE id = p_business_id) THEN
        RETURN;
    END IF;
    INSERT INTO public.acc_accounts (business_id, code, name, type, system_key, description)
    SELECT p_business_id, a.code, a.name, a.type, a.k, a.d
    FROM (VALUES
        ('1000', 'Cash on hand',                    'asset',     'cash',         'Cash in the till and the safe'),
        ('1010', 'M-Pesa',                          'asset',     'mpesa',        'Till, paybill and M-Pesa prompts'),
        ('1015', 'Airtel Money',                    'asset',     'airtel',       'Airtel Money payments'),
        ('1020', 'Bank',                            'asset',     'bank',         'Bank account'),
        ('1030', 'Card payments',                   'asset',     'card',         'Card payments not yet paid out to the bank'),
        ('1100', 'Customers owe us',                'asset',     'receivable',   'Debt from credit sales (receivables)'),
        ('1200', 'Stock',                           'asset',     'inventory',    'Value of goods in stock, at cost'),
        ('1500', 'Equipment & fixed assets',        'asset',     'fixed_assets', 'Fridges, coolers, motorbikes, furniture'),
        ('1510', 'Depreciation so far',             'asset',     'acc_depreciation', 'Value used up on fixed assets (shown as minus)'),
        ('2000', 'We owe suppliers',                'liability', 'payable',      'Purchases received but not yet paid (payables)'),
        ('2100', 'Customer wallet money',           'liability', 'wallets',      'Money customers keep with us in their wallets'),
        ('2150', 'Payments not matched to a sale',  'liability', 'unmatched',    'Walk-in payments received before a sale or customer is known'),
        ('2200', 'VAT to pay KRA',                  'liability', 'vat',          'VAT charged on sales, less VAT paid to KRA'),
        ('2300', 'Loans',                           'liability', 'loans',        'Money borrowed'),
        ('3000', 'Owner''s capital',                'equity',    'capital',      'Money the owner put into the business'),
        ('3050', 'Opening balances',                'equity',    'opening',      'Balances brought in when the books started'),
        ('3100', 'Owner drawings',                  'equity',    'drawings',     'Money the owner took out'),
        ('3900', 'Retained earnings',               'equity',    'retained',     'Profit kept from past years'),
        ('4000', 'Sales',                           'income',    'sales',        'Goods sold, after discounts, without VAT'),
        ('4010', 'Delivery fees',                   'income',    'delivery',     'Delivery charges on sales'),
        ('4900', 'Other income',                    'income',    'other_income', 'Income that is not from sales'),
        ('5000', 'Cost of goods sold',              'expense',   'cogs',         'What the goods sold cost us'),
        ('5100', 'Stock losses & count differences','expense',   'stock_loss',   'Damage, production waste and stock count differences'),
        ('5300', 'Loyalty points used on debt',     'expense',   'loyalty',      'Debt paid with loyalty points instead of money'),
        ('6000', 'General expenses',                'expense',   'expenses',     'Expenses without a category'),
        ('6900', 'Depreciation',                    'expense',   'depreciation', 'Value of fixed assets used up this period'),
        ('6990', 'Cash short or over',              'expense',   'cash_diff',    'Differences found when counting money')
    ) AS a(code, name, type, k, d)
    ON CONFLICT DO NOTHING;
    INSERT INTO public.acc_settings (business_id) VALUES (p_business_id) ON CONFLICT DO NOTHING;
END;
$$;

CREATE OR REPLACE FUNCTION public.acc_account(p_business_id UUID, p_key TEXT)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_id UUID;
BEGIN
    SELECT id INTO v_id FROM public.acc_accounts WHERE business_id = p_business_id AND system_key = p_key;
    IF v_id IS NULL THEN
        PERFORM public.acc_ensure_accounts(p_business_id);
        SELECT id INTO v_id FROM public.acc_accounts WHERE business_id = p_business_id AND system_key = p_key;
    END IF;
    IF v_id IS NULL THEN
        RAISE EXCEPTION 'Account % is missing for business %', p_key, p_business_id;
    END IF;
    RETURN v_id;
END;
$$;

-- Which money account a payment method lands in.
CREATE OR REPLACE FUNCTION public.acc_money_key(p_method TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT CASE p_method
        WHEN 'M-Pesa' THEN 'mpesa' WHEN 'Mobile_Wallet' THEN 'mpesa'
        WHEN 'Airtel Money' THEN 'airtel'
        WHEN 'Bank' THEN 'bank'
        WHEN 'Card' THEN 'card'
        ELSE 'cash' END;
$$;

-- The payment method behind a money account (for money_assets), or NULL.
CREATE OR REPLACE FUNCTION public.acc_key_method(p_key TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT CASE p_key
        WHEN 'cash' THEN 'Cash' WHEN 'mpesa' THEN 'M-Pesa' WHEN 'airtel' THEN 'Airtel Money'
        WHEN 'bank' THEN 'Bank' WHEN 'card' THEN 'Card' ELSE NULL END;
$$;

-- One account per expense category, created the first time the category is used.
CREATE OR REPLACE FUNCTION public.acc_expense_account(p_business_id UUID, p_category TEXT)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_name TEXT := NULLIF(trim(COALESCE(p_category, '')), '');
    v_key  TEXT;
    v_id   UUID;
    v_code INTEGER;
BEGIN
    IF v_name IS NULL OR lower(v_name) IN ('other', 'general') THEN
        RETURN public.acc_account(p_business_id, 'expenses');
    END IF;
    v_key := 'exp:' || lower(v_name);
    SELECT id INTO v_id FROM public.acc_accounts WHERE business_id = p_business_id AND system_key = v_key;
    IF v_id IS NOT NULL THEN
        RETURN v_id;
    END IF;
    PERFORM public.acc_ensure_accounts(p_business_id);
    SELECT COALESCE(MAX(code::INTEGER), 6090) + 10 INTO v_code
    FROM public.acc_accounts
    WHERE business_id = p_business_id AND code ~ '^6[1-8][0-9]{2}$';
    WHILE EXISTS (SELECT 1 FROM public.acc_accounts WHERE business_id = p_business_id AND code = v_code::TEXT) LOOP
        v_code := v_code + 1;
    END LOOP;
    IF v_code > 6899 THEN
        RETURN public.acc_account(p_business_id, 'expenses');
    END IF;
    INSERT INTO public.acc_accounts (business_id, code, name, type, system_key, description)
    VALUES (p_business_id, v_code::TEXT, v_name, 'expense', v_key, 'Expenses in the ' || v_name || ' category')
    ON CONFLICT DO NOTHING
    RETURNING id INTO v_id;
    IF v_id IS NULL THEN
        SELECT id INTO v_id FROM public.acc_accounts WHERE business_id = p_business_id AND system_key = v_key;
    END IF;
    RETURN v_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- 3. Posting
-- ---------------------------------------------------------------------------
-- Adds a line to a list. Positive amount = debit, negative = credit, zero = nothing.
CREATE OR REPLACE FUNCTION public.acc_l(
    p_lines JSONB, p_account UUID, p_amount NUMERIC,
    p_party_type TEXT DEFAULT NULL, p_party_id TEXT DEFAULT NULL, p_party_name TEXT DEFAULT NULL, p_memo TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT CASE WHEN round(COALESCE(p_amount, 0), 2) = 0 THEN p_lines
    ELSE p_lines || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
        'a', p_account, 'v', round(p_amount, 2),
        'pt', p_party_type, 'pi', p_party_id, 'pn', p_party_name, 'm', p_memo)))
    END;
$$;

-- Writes the lines for one record: keeps, replaces or reverses its current entry.
CREATE OR REPLACE FUNCTION public.acc_apply(
    p_business_id UUID, p_type TEXT, p_id UUID, p_date DATE, p_memo TEXT, p_lines JSONB, p_by TEXT DEFAULT 'System'
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_lines  JSONB := COALESCE(p_lines, '[]'::JSONB);
    v_sum    NUMERIC;
    v_fp     TEXT;
    v_cur    public.acc_entries%ROWTYPE;
    v_lock   DATE;
    v_today  DATE := (NOW() AT TIME ZONE 'Africa/Nairobi')::DATE;
    v_date   DATE;
    v_new    UUID;
BEGIN
    SELECT COALESCE(SUM((l->>'v')::NUMERIC), 0) INTO v_sum FROM jsonb_array_elements(v_lines) l;
    IF v_sum <> 0 THEN
        RAISE EXCEPTION 'Entry for % % does not balance (off by %)', p_type, p_id, v_sum;
    END IF;
    v_fp := CASE WHEN jsonb_array_length(v_lines) = 0 THEN NULL ELSE md5(p_date::TEXT || '|' || COALESCE(p_memo, '') || '|' || v_lines::TEXT) END;

    SELECT * INTO v_cur FROM public.acc_entries
    WHERE business_id = p_business_id AND source_type = p_type AND source_id = p_id
      AND reversed_at IS NULL AND reversal_of IS NULL
    ORDER BY created_at DESC LIMIT 1;

    IF FOUND AND v_cur.fingerprint IS NOT DISTINCT FROM v_fp THEN
        RETURN;
    END IF;
    IF NOT FOUND AND v_fp IS NULL THEN
        RETURN;
    END IF;

    SELECT lock_date INTO v_lock FROM public.acc_settings WHERE business_id = p_business_id;

    IF v_cur.id IS NOT NULL THEN
        IF v_lock IS NULL OR v_cur.entry_date > v_lock THEN
            DELETE FROM public.acc_entries WHERE id = v_cur.id;
        ELSE
            -- Locked: book the change as a reversal after the lock date.
            v_date := GREATEST(v_today, v_lock + 1);
            INSERT INTO public.acc_entries (business_id, entry_date, memo, source_type, source_id, reversal_of, created_by)
            VALUES (p_business_id, v_date, 'Reversal of JE-' || v_cur.no || ': ' || v_cur.memo, p_type, p_id, v_cur.id, p_by)
            RETURNING id INTO v_new;
            INSERT INTO public.acc_lines (entry_id, business_id, account_id, entry_date, debit, credit, party_type, party_id, party_name, memo)
            SELECT v_new, business_id, account_id, v_date, credit, debit, party_type, party_id, party_name, memo
            FROM public.acc_lines WHERE entry_id = v_cur.id;
            UPDATE public.acc_entries SET reversed_at = NOW() WHERE id = v_cur.id;
        END IF;
    END IF;

    IF v_fp IS NULL THEN
        RETURN;
    END IF;

    v_date := CASE WHEN v_lock IS NOT NULL AND p_date <= v_lock THEN v_lock + 1 ELSE p_date END;
    INSERT INTO public.acc_entries (business_id, entry_date, memo, source_type, source_id, fingerprint, created_by)
    VALUES (p_business_id, v_date, COALESCE(p_memo, ''), p_type, p_id, v_fp, p_by)
    RETURNING id INTO v_new;

    INSERT INTO public.acc_lines (entry_id, business_id, account_id, entry_date, debit, credit, party_type, party_id, party_name, memo)
    SELECT v_new, p_business_id, (l->>'a')::UUID, v_date,
           GREATEST((l->>'v')::NUMERIC, 0), GREATEST(-(l->>'v')::NUMERIC, 0),
           l->>'pt', l->>'pi', l->>'pn', l->>'m'
    FROM jsonb_array_elements(v_lines) l;
END;
$$;

-- Works out what one business record should post, and posts it.
CREATE OR REPLACE FUNCTION public.acc_post_source(p_type TEXT, p_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_b      UUID;
    v_date   DATE;
    v_memo   TEXT;
    v_lines  JSONB := '[]'::JSONB;
    t        public.transactions%ROWTYPE;
    e        public.expenses%ROWTYPE;
    cl       public.customer_ledger%ROWTYPE;
    py       public.payments%ROWTYPE;
    pu       public.purchases%ROWTYPE;
    sp       public.supplier_payments%ROWTYPE;
    ia       public.inventory_adjustments%ROWTYPE;
    v_cost   NUMERIC;
    v_goods  NUMERIC;
    v_deliv  NUMERIC;
    v_owed   NUMERIC;
    v_money  NUMERIC;
    v_method TEXT;
    v_cname  TEXT;
    v_code   TEXT;
    v_ref    TEXT;
    v_rest   NUMERIC;
    v_party  TEXT;
BEGIN
    IF p_type = 'sale' THEN
        SELECT * INTO t FROM public.transactions WHERE id = p_id;
        IF NOT FOUND THEN RETURN; END IF;
        v_b := t.business_id;
        v_date := (t.timestamp AT TIME ZONE 'Africa/Nairobi')::DATE;
        v_cname := COALESCE(NULLIF(t.customer_name, ''), 'Walk-in');
        v_memo := 'Sale ' || public.fn_receipt_number(t.id) || ' · ' || v_cname;
        IF t.deleted_at IS NULL THEN
            v_deliv := CASE WHEN t.is_delivery THEN COALESCE(t.delivery_fee, 0) ELSE 0 END;
            v_goods := t.final_total - COALESCE(t.tax, 0) - v_deliv;
            IF t.payment_method IN ('Credit_Debt', 'Credit') THEN
                v_money := COALESCE(t.amount_paid, 0);
                v_method := 'Cash';
            ELSE
                v_money := t.final_total - COALESCE(t.wallet_applied, 0);
                v_method := t.payment_method::TEXT;
            END IF;
            v_owed := t.final_total - v_money - COALESCE(t.wallet_applied, 0);
            v_lines := public.acc_l(v_lines, public.acc_account(v_b, public.acc_money_key(v_method)), v_money);
            v_lines := public.acc_l(v_lines, public.acc_account(v_b, 'wallets'), t.wallet_applied, 'customer', t.customer_id::TEXT, v_cname);
            v_lines := public.acc_l(v_lines, public.acc_account(v_b, 'receivable'), v_owed, 'customer', t.customer_id::TEXT, v_cname);
            v_lines := public.acc_l(v_lines, public.acc_account(v_b, 'sales'), -v_goods);
            v_lines := public.acc_l(v_lines, public.acc_account(v_b, 'delivery'), -v_deliv);
            v_lines := public.acc_l(v_lines, public.acc_account(v_b, 'vat'), -COALESCE(t.tax, 0));
            SELECT COALESCE(SUM(ti.quantity * COALESCE(ti.unit_cost, p.cost, 0)), 0) INTO v_cost
            FROM public.transaction_items ti
            LEFT JOIN public.products p ON p.id = ti.product_id
            WHERE ti.transaction_id = t.id;
            v_cost := round(v_cost, 2);
            v_lines := public.acc_l(v_lines, public.acc_account(v_b, 'cogs'), v_cost);
            v_lines := public.acc_l(v_lines, public.acc_account(v_b, 'inventory'), -v_cost);
        END IF;

    ELSIF p_type = 'expense' THEN
        SELECT * INTO e FROM public.expenses WHERE id = p_id;
        IF NOT FOUND THEN RETURN; END IF;
        v_b := e.business_id;
        v_date := (e.date AT TIME ZONE 'Africa/Nairobi')::DATE;
        v_memo := CASE WHEN e.source = 'petty_cash' THEN 'Petty cash: ' ELSE 'Expense: ' END
                  || COALESCE(e.category, 'Other') || COALESCE(' · ' || NULLIF(e.description, ''), '');
        IF e.deleted_at IS NULL AND e.amount > 0 THEN
            v_lines := public.acc_l(v_lines, public.acc_expense_account(v_b, e.category), e.amount);
            v_lines := public.acc_l(v_lines, public.acc_account(v_b, public.acc_money_key(COALESCE(e.payment_method, 'Cash'))), -e.amount);
        END IF;

    ELSIF p_type = 'cledger' THEN
        -- Customer money that is not part of a sale. Rows are never changed once written.
        SELECT * INTO cl FROM public.customer_ledger WHERE id = p_id;
        IF NOT FOUND THEN RETURN; END IF;
        v_b := cl.business_id;
        v_date := (cl.created_at AT TIME ZONE 'Africa/Nairobi')::DATE;
        SELECT name INTO v_cname FROM public.customers WHERE id = cl.customer_id;
        v_cname := COALESCE(v_cname, 'Customer');
        v_party := cl.customer_id::TEXT;
        v_ref := COALESCE(cl.reference_id, '');

        -- Payment method: the payment this row came from, else the note ("… via M-Pesa"), else cash.
        v_method := NULL;
        IF v_ref ~ '^void-[0-9a-f-]{36}-' THEN
            SELECT method INTO v_method FROM public.payments WHERE id = substring(v_ref FROM 6 FOR 36)::UUID;
        ELSIF v_ref ~ '-(debt-payment|wallet-topup)$' THEN
            SELECT method INTO v_method FROM public.payments
            WHERE business_id = cl.business_id AND reference_code = regexp_replace(v_ref, '-(debt-payment|wallet-topup)$', '');
        END IF;
        IF v_method IS NULL THEN
            v_method := COALESCE(substring(cl.note FROM 'via (M-Pesa|Airtel Money|Cash|Card|Bank)'), 'Cash');
        END IF;

        IF cl.type = 'debt_payment' AND v_ref LIKE 'redeem-%' THEN
            v_memo := 'Debt paid with loyalty points · ' || v_cname;
            v_lines := public.acc_l(v_lines, public.acc_account(v_b, 'loyalty'), cl.amount);
            v_lines := public.acc_l(v_lines, public.acc_account(v_b, 'receivable'), -cl.amount, 'customer', v_party, v_cname);
        ELSIF cl.type = 'debt_payment' THEN
            v_memo := 'Debt payment (' || v_method || ') · ' || v_cname;
            v_lines := public.acc_l(v_lines, public.acc_account(v_b, public.acc_money_key(v_method)), cl.amount);
            v_lines := public.acc_l(v_lines, public.acc_account(v_b, 'receivable'), -cl.amount, 'customer', v_party, v_cname);
        ELSIF cl.type = 'wallet_topup' AND v_ref NOT LIKE 'merge-%' THEN
            v_memo := 'Wallet top-up (' || v_method || ') · ' || v_cname;
            v_lines := public.acc_l(v_lines, public.acc_account(v_b, public.acc_money_key(v_method)), cl.amount);
            v_lines := public.acc_l(v_lines, public.acc_account(v_b, 'wallets'), -cl.amount, 'customer', v_party, v_cname);
        ELSIF cl.type = 'wallet_usage' AND cl.transaction_id IS NULL AND v_ref LIKE 'void-%' THEN
            v_memo := 'Voided wallet top-up (' || v_method || ') · ' || v_cname;
            v_lines := public.acc_l(v_lines, public.acc_account(v_b, 'wallets'), cl.amount, 'customer', v_party, v_cname);
            v_lines := public.acc_l(v_lines, public.acc_account(v_b, public.acc_money_key(v_method)), -cl.amount);
        ELSIF cl.type = 'wallet_usage' AND cl.transaction_id IS NULL THEN
            v_memo := 'Wallet money paid debt · ' || v_cname;
            v_lines := public.acc_l(v_lines, public.acc_account(v_b, 'wallets'), cl.amount, 'customer', v_party, v_cname);
            v_lines := public.acc_l(v_lines, public.acc_account(v_b, 'receivable'), -cl.amount, 'customer', v_party, v_cname);
        ELSIF cl.type = 'debt_adjustment' AND v_ref LIKE 'void-%' THEN
            v_memo := 'Voided debt payment (' || v_method || ') · ' || v_cname;
            v_lines := public.acc_l(v_lines, public.acc_account(v_b, 'receivable'), cl.amount, 'customer', v_party, v_cname);
            v_lines := public.acc_l(v_lines, public.acc_account(v_b, public.acc_money_key(v_method)), -cl.amount);
        ELSIF cl.type IN ('debt_adjustment', 'debt_creation') AND cl.transaction_id IS NULL AND v_ref NOT LIKE 'merge-%' THEN
            v_memo := 'Debt added by hand · ' || v_cname;
            v_lines := public.acc_l(v_lines, public.acc_account(v_b, 'receivable'), cl.amount, 'customer', v_party, v_cname);
            v_lines := public.acc_l(v_lines, public.acc_account(v_b, 'opening'), -cl.amount);
        ELSE
            RETURN; -- part of a sale (the sale posts it) or moved between merged customers
        END IF;

    ELSIF p_type = 'payment' THEN
        -- Only the part of a payment that is not applied to a customer's debt or wallet
        -- (those parts post from the customer ledger).
        SELECT * INTO py FROM public.payments WHERE id = p_id;
        IF NOT FOUND THEN RETURN; END IF;
        v_b := py.business_id;
        v_date := (COALESCE(py.date, py.created_at) AT TIME ZONE 'Africa/Nairobi')::DATE;
        v_memo := 'Payment ' || COALESCE(py.reference_code, '') || ' (' || py.method || ') · ' || COALESCE(py.customer_name, py.sender_name, 'Walk-in');
        v_rest := py.amount - COALESCE(py.debt_applied, 0) - COALESCE(py.wallet_applied, 0);
        IF py.status = 'Success' AND v_rest > 0 THEN
            v_lines := public.acc_l(v_lines, public.acc_account(v_b, public.acc_money_key(py.method)), v_rest);
            v_lines := public.acc_l(v_lines, public.acc_account(v_b, 'unmatched'), -v_rest, 'customer', py.customer_id::TEXT, COALESCE(py.customer_name, py.sender_name));
        END IF;

    ELSIF p_type = 'purchase' THEN
        SELECT * INTO pu FROM public.purchases WHERE id = p_id;
        IF NOT FOUND THEN RETURN; END IF;
        v_b := pu.business_id;
        v_date := (COALESCE(pu.received_at, pu.date) AT TIME ZONE 'Africa/Nairobi')::DATE;
        v_code := COALESCE(NULLIF(pu.reference_number, ''), 'PO-' || upper(left(replace(pu.id::TEXT, '-', ''), 8)));
        v_memo := 'Purchase ' || v_code || ' received · ' || COALESCE(pu.supplier_name, 'Supplier');
        IF pu.status = 'Received' AND pu.total_amount > 0 THEN
            v_party := COALESCE(pu.supplier_id::TEXT, 'name:' || lower(trim(COALESCE(pu.supplier_name, ''))));
            v_lines := public.acc_l(v_lines, public.acc_account(v_b, 'inventory'), pu.total_amount);
            v_lines := public.acc_l(v_lines, public.acc_account(v_b, 'payable'), -pu.total_amount, 'supplier', v_party, pu.supplier_name);
        END IF;

    ELSIF p_type = 'supplier_payment' THEN
        SELECT * INTO sp FROM public.supplier_payments WHERE id = p_id;
        IF NOT FOUND THEN RETURN; END IF;
        v_b := sp.business_id;
        v_date := (sp.paid_at AT TIME ZONE 'Africa/Nairobi')::DATE;
        v_memo := 'Paid supplier (' || sp.method || ') · ' || sp.supplier_name || COALESCE(' · ' || NULLIF(sp.reference, ''), '');
        IF sp.voided_at IS NULL THEN
            v_party := COALESCE(sp.supplier_id::TEXT, 'name:' || lower(trim(sp.supplier_name)));
            v_lines := public.acc_l(v_lines, public.acc_account(v_b, 'payable'), sp.amount, 'supplier', v_party, sp.supplier_name);
            v_lines := public.acc_l(v_lines, public.acc_account(v_b, public.acc_money_key(sp.method)), -sp.amount);
        END IF;

    ELSIF p_type = 'stock_adj' THEN
        SELECT * INTO ia FROM public.inventory_adjustments WHERE id = p_id;
        IF NOT FOUND THEN RETURN; END IF;
        v_b := ia.business_id;
        v_date := (ia.timestamp AT TIME ZONE 'Africa/Nairobi')::DATE;
        v_memo := ia.type::TEXT || ': ' || COALESCE(ia.product_name, '') || COALESCE(' · ' || NULLIF(ia.reason, ''), '');
        IF ia.deleted_at IS NULL
           AND (ia.type::TEXT IN ('Damage', 'Production Waste')
                OR (ia.type::TEXT = 'Reconciliation' AND COALESCE(ia.reason, '') <> 'Sold')) THEN
            SELECT COALESCE(cost, 0) INTO v_cost FROM public.products WHERE id = ia.product_id;
            v_cost := round(COALESCE(v_cost, 0) * COALESCE(ia.quantity_adjusted, 0), 2);
            v_lines := public.acc_l(v_lines, public.acc_account(v_b, 'inventory'), v_cost);
            v_lines := public.acc_l(v_lines, public.acc_account(v_b, 'stock_loss'), -v_cost);
        END IF;

    ELSE
        RAISE EXCEPTION 'Unknown source %', p_type;
    END IF;

    IF v_b IS NULL OR NOT EXISTS (SELECT 1 FROM public.businesses WHERE id = v_b) THEN
        RETURN;
    END IF;
    PERFORM public.acc_apply(v_b, p_type, p_id, v_date, v_memo, v_lines);
    DELETE FROM public.acc_post_errors WHERE source_type = p_type AND source_id = p_id;
END;
$$;

-- Trigger: posts at commit; a failure is saved, never blocks the sale.
CREATE OR REPLACE FUNCTION public.acc_trg_post()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    BEGIN
        PERFORM public.acc_post_source(TG_ARGV[0], NEW.id);
    EXCEPTION WHEN OTHERS THEN
        BEGIN
            INSERT INTO public.acc_post_errors (business_id, source_type, source_id, message)
            SELECT NEW.business_id, TG_ARGV[0], NEW.id, SQLERRM
            WHERE EXISTS (SELECT 1 FROM public.businesses WHERE id = NEW.business_id)
            ON CONFLICT (source_type, source_id) DO UPDATE SET message = EXCLUDED.message, created_at = NOW();
        EXCEPTION WHEN OTHERS THEN
            NULL;
        END;
    END;
    RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_acc_sale ON public.transactions;
CREATE CONSTRAINT TRIGGER trg_acc_sale AFTER INSERT OR UPDATE ON public.transactions
    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.acc_trg_post('sale');

DROP TRIGGER IF EXISTS trg_acc_expense ON public.expenses;
CREATE CONSTRAINT TRIGGER trg_acc_expense AFTER INSERT OR UPDATE ON public.expenses
    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.acc_trg_post('expense');

DROP TRIGGER IF EXISTS trg_acc_cledger ON public.customer_ledger;
CREATE CONSTRAINT TRIGGER trg_acc_cledger AFTER INSERT ON public.customer_ledger
    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
    WHEN (NEW.type IN ('debt_payment', 'wallet_topup', 'wallet_usage', 'debt_adjustment', 'debt_creation'))
    EXECUTE FUNCTION public.acc_trg_post('cledger');

DROP TRIGGER IF EXISTS trg_acc_payment ON public.payments;
CREATE CONSTRAINT TRIGGER trg_acc_payment AFTER INSERT OR UPDATE ON public.payments
    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.acc_trg_post('payment');

DROP TRIGGER IF EXISTS trg_acc_purchase ON public.purchases;
CREATE CONSTRAINT TRIGGER trg_acc_purchase AFTER INSERT OR UPDATE ON public.purchases
    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.acc_trg_post('purchase');

DROP TRIGGER IF EXISTS trg_acc_supplier_payment ON public.supplier_payments;
CREATE CONSTRAINT TRIGGER trg_acc_supplier_payment AFTER INSERT OR UPDATE ON public.supplier_payments
    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.acc_trg_post('supplier_payment');

DROP TRIGGER IF EXISTS trg_acc_stock_adj ON public.inventory_adjustments;
CREATE CONSTRAINT TRIGGER trg_acc_stock_adj AFTER INSERT OR UPDATE ON public.inventory_adjustments
    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
    WHEN (NEW.type::TEXT IN ('Damage', 'Production Waste', 'Reconciliation'))
    EXECUTE FUNCTION public.acc_trg_post('stock_adj');

-- ---------------------------------------------------------------------------
-- 4. Rebuilding (all records, in pieces so a big business doesn't time out)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.acc_source_ids(p_business_id UUID, p_type TEXT, p_offset INTEGER, p_limit INTEGER)
RETURNS SETOF UUID
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF p_type = 'sale' THEN
        RETURN QUERY SELECT id FROM public.transactions WHERE business_id = p_business_id ORDER BY timestamp, id OFFSET p_offset LIMIT p_limit;
    ELSIF p_type = 'expense' THEN
        RETURN QUERY SELECT id FROM public.expenses WHERE business_id = p_business_id ORDER BY date, id OFFSET p_offset LIMIT p_limit;
    ELSIF p_type = 'cledger' THEN
        RETURN QUERY SELECT id FROM public.customer_ledger WHERE business_id = p_business_id
            AND type IN ('debt_payment', 'wallet_topup', 'wallet_usage', 'debt_adjustment', 'debt_creation')
            AND (transaction_id IS NULL) ORDER BY created_at, id OFFSET p_offset LIMIT p_limit;
    ELSIF p_type = 'payment' THEN
        RETURN QUERY SELECT id FROM public.payments WHERE business_id = p_business_id ORDER BY created_at, id OFFSET p_offset LIMIT p_limit;
    ELSIF p_type = 'purchase' THEN
        RETURN QUERY SELECT id FROM public.purchases WHERE business_id = p_business_id ORDER BY date, id OFFSET p_offset LIMIT p_limit;
    ELSIF p_type = 'supplier_payment' THEN
        RETURN QUERY SELECT id FROM public.supplier_payments WHERE business_id = p_business_id ORDER BY paid_at, id OFFSET p_offset LIMIT p_limit;
    ELSIF p_type = 'stock_adj' THEN
        RETURN QUERY SELECT id FROM public.inventory_adjustments WHERE business_id = p_business_id
            AND type::TEXT IN ('Damage', 'Production Waste', 'Reconciliation') AND COALESCE(reason, '') <> 'Sold'
            ORDER BY timestamp, id OFFSET p_offset LIMIT p_limit;
    END IF;
END;
$$;

-- Step 1: clear what may be redone (nothing on or before the lock date).
CREATE OR REPLACE FUNCTION public.acc_rebuild_start(p_business_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_lock DATE;
BEGIN
    PERFORM public.assert_business_member(p_business_id);
    PERFORM public.assert_permission(p_business_id, 'accounting.manage');
    PERFORM public.acc_ensure_accounts(p_business_id);
    SELECT lock_date INTO v_lock FROM public.acc_settings WHERE business_id = p_business_id;
    DELETE FROM public.acc_entries
    WHERE business_id = p_business_id AND source_type IS NOT NULL
      AND (v_lock IS NULL OR entry_date > v_lock);
    -- Locked entries whose reversal was just removed count as current again.
    UPDATE public.acc_entries e SET reversed_at = NULL
    WHERE e.business_id = p_business_id AND e.reversed_at IS NOT NULL AND e.source_type IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM public.acc_entries r WHERE r.reversal_of = e.id);
    DELETE FROM public.acc_post_errors WHERE business_id = p_business_id;
    RETURN jsonb_build_object('kinds', jsonb_build_array('sale', 'expense', 'cledger', 'payment', 'purchase', 'supplier_payment', 'stock_adj'));
END;
$$;

-- Step 2: post one piece. Returns how many records it went through (less than
-- p_limit means that kind is done).
CREATE OR REPLACE FUNCTION public.acc_rebuild_chunk(p_business_id UUID, p_type TEXT, p_offset INTEGER, p_limit INTEGER DEFAULT 1500)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_id UUID;
    v_n  INTEGER := 0;
BEGIN
    PERFORM public.assert_business_member(p_business_id);
    PERFORM public.assert_permission(p_business_id, 'accounting.manage');
    FOR v_id IN SELECT * FROM public.acc_source_ids(p_business_id, p_type, p_offset, LEAST(GREATEST(p_limit, 1), 5000)) LOOP
        v_n := v_n + 1;
        BEGIN
            PERFORM public.acc_post_source(p_type, v_id);
        EXCEPTION WHEN OTHERS THEN
            INSERT INTO public.acc_post_errors (business_id, source_type, source_id, message)
            VALUES (p_business_id, p_type, v_id, SQLERRM)
            ON CONFLICT (source_type, source_id) DO UPDATE SET message = EXCLUDED.message, created_at = NOW();
        END;
    END LOOP;
    RETURN v_n;
END;
$$;

CREATE OR REPLACE FUNCTION public.acc_retry_errors(p_business_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_r   RECORD;
    v_ok  INTEGER := 0;
    v_bad INTEGER := 0;
BEGIN
    PERFORM public.assert_business_member(p_business_id);
    PERFORM public.assert_permission(p_business_id, 'accounting.manage');
    FOR v_r IN SELECT * FROM public.acc_post_errors WHERE business_id = p_business_id LOOP
        BEGIN
            PERFORM public.acc_post_source(v_r.source_type, v_r.source_id);
            DELETE FROM public.acc_post_errors WHERE id = v_r.id;
            v_ok := v_ok + 1;
        EXCEPTION WHEN OTHERS THEN
            UPDATE public.acc_post_errors SET message = SQLERRM, created_at = NOW() WHERE id = v_r.id;
            v_bad := v_bad + 1;
        END;
    END LOOP;
    RETURN jsonb_build_object('fixed', v_ok, 'failed', v_bad);
END;
$$;

-- ---------------------------------------------------------------------------
-- 5. Manual entries, accounts, lock date
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.acc_who()
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT COALESCE((SELECT NULLIF(trim(u.name), '') FROM public.users u WHERE u.auth_user_id = auth.uid() LIMIT 1), 'Staff');
$$;

-- Keeps the Payments screen's money balances in step with entries typed by hand
-- (money moved from M-Pesa to the bank, owner's capital paid in, and so on).
CREATE OR REPLACE FUNCTION public.acc_sync_money(p_entry_id UUID, p_sign INTEGER, p_by TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_r RECORD;
BEGIN
    FOR v_r IN
        SELECT l.business_id, public.acc_key_method(a.system_key) AS method, SUM(l.debit - l.credit) AS delta, MAX(e.no) AS no, MAX(e.memo) AS memo
        FROM public.acc_lines l
        JOIN public.acc_accounts a ON a.id = l.account_id
        JOIN public.acc_entries e ON e.id = l.entry_id
        WHERE l.entry_id = p_entry_id AND public.acc_key_method(a.system_key) IS NOT NULL
        GROUP BY l.business_id, a.system_key
    LOOP
        PERFORM public.fn_post_money_asset(v_r.business_id, v_r.method, p_sign * v_r.delta,
            CASE WHEN p_sign > 0 THEN 'Journal JE-' ELSE 'Removed journal JE-' END || v_r.no || ': ' || v_r.memo, NULL, NULL, p_by);
    END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.acc_save_entry(
    p_business_id UUID, p_date DATE, p_memo TEXT, p_lines JSONB, p_entry_id UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_lock  DATE;
    v_by    TEXT := public.acc_who();
    v_id    UUID;
    v_old   public.acc_entries%ROWTYPE;
    v_dr    NUMERIC := 0;
    v_cr    NUMERIC := 0;
    v_l     JSONB;
    v_n     INTEGER := 0;
BEGIN
    PERFORM public.assert_business_member(p_business_id);
    PERFORM public.assert_permission(p_business_id, 'accounting.manage');
    PERFORM public.acc_ensure_accounts(p_business_id);
    IF p_date IS NULL THEN RAISE EXCEPTION 'Choose a date.'; END IF;
    IF COALESCE(trim(p_memo), '') = '' THEN RAISE EXCEPTION 'Say what this entry is for.'; END IF;
    SELECT lock_date INTO v_lock FROM public.acc_settings WHERE business_id = p_business_id;
    IF v_lock IS NOT NULL AND p_date <= v_lock THEN
        RAISE EXCEPTION 'The books are locked up to %. Choose a later date.', to_char(v_lock, 'DD Mon YYYY');
    END IF;

    FOR v_l IN SELECT * FROM jsonb_array_elements(COALESCE(p_lines, '[]'::JSONB)) LOOP
        IF COALESCE((v_l->>'debit')::NUMERIC, 0) < 0 OR COALESCE((v_l->>'credit')::NUMERIC, 0) < 0 THEN
            RAISE EXCEPTION 'Amounts cannot be below zero.';
        END IF;
        IF COALESCE((v_l->>'debit')::NUMERIC, 0) > 0 AND COALESCE((v_l->>'credit')::NUMERIC, 0) > 0 THEN
            RAISE EXCEPTION 'A line is either money in (debit) or money out (credit), not both.';
        END IF;
        IF COALESCE((v_l->>'debit')::NUMERIC, 0) + COALESCE((v_l->>'credit')::NUMERIC, 0) = 0 THEN
            CONTINUE;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM public.acc_accounts WHERE id = (v_l->>'accountId')::UUID AND business_id = p_business_id AND is_active) THEN
            RAISE EXCEPTION 'Choose an account for every line.';
        END IF;
        v_dr := v_dr + round(COALESCE((v_l->>'debit')::NUMERIC, 0), 2);
        v_cr := v_cr + round(COALESCE((v_l->>'credit')::NUMERIC, 0), 2);
        v_n := v_n + 1;
    END LOOP;
    IF v_n < 2 THEN RAISE EXCEPTION 'An entry needs at least two lines.'; END IF;
    IF v_dr <> v_cr THEN
        RAISE EXCEPTION 'Debits (%) and credits (%) must be equal.', v_dr, v_cr;
    END IF;

    IF p_entry_id IS NOT NULL THEN
        SELECT * INTO v_old FROM public.acc_entries WHERE id = p_entry_id AND business_id = p_business_id FOR UPDATE;
        IF NOT FOUND THEN RAISE EXCEPTION 'That entry was not found.'; END IF;
        IF v_old.source_type IS NOT NULL THEN
            RAISE EXCEPTION 'This entry comes from a sale, expense or payment. Change that record instead.';
        END IF;
        IF v_old.reversed_at IS NOT NULL OR v_old.reversal_of IS NOT NULL THEN
            RAISE EXCEPTION 'A reversed entry cannot be changed.';
        END IF;
        IF v_lock IS NOT NULL AND v_old.entry_date <= v_lock THEN
            RAISE EXCEPTION 'This entry is in a locked period. Reverse it instead.';
        END IF;
        PERFORM public.acc_sync_money(v_old.id, -1, v_by);
        DELETE FROM public.acc_lines WHERE entry_id = v_old.id;
        UPDATE public.acc_entries SET entry_date = p_date, memo = trim(p_memo) WHERE id = v_old.id;
        v_id := v_old.id;
    ELSE
        INSERT INTO public.acc_entries (business_id, entry_date, memo, created_by)
        VALUES (p_business_id, p_date, trim(p_memo), v_by)
        RETURNING id INTO v_id;
    END IF;

    INSERT INTO public.acc_lines (entry_id, business_id, account_id, entry_date, debit, credit, memo)
    SELECT v_id, p_business_id, (l->>'accountId')::UUID, p_date,
           round(COALESCE((l->>'debit')::NUMERIC, 0), 2), round(COALESCE((l->>'credit')::NUMERIC, 0), 2),
           NULLIF(trim(COALESCE(l->>'memo', '')), '')
    FROM jsonb_array_elements(p_lines) l
    WHERE COALESCE((l->>'debit')::NUMERIC, 0) + COALESCE((l->>'credit')::NUMERIC, 0) > 0;

    PERFORM public.acc_sync_money(v_id, 1, v_by);
    RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.acc_delete_entry(p_entry_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_e    public.acc_entries%ROWTYPE;
    v_lock DATE;
BEGIN
    SELECT * INTO v_e FROM public.acc_entries WHERE id = p_entry_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'That entry was not found.'; END IF;
    PERFORM public.assert_business_member(v_e.business_id);
    PERFORM public.assert_permission(v_e.business_id, 'accounting.manage');
    IF v_e.source_type IS NOT NULL THEN
        RAISE EXCEPTION 'This entry comes from a sale, expense or payment. Remove that record instead.';
    END IF;
    SELECT lock_date INTO v_lock FROM public.acc_settings WHERE business_id = v_e.business_id;
    IF v_lock IS NOT NULL AND v_e.entry_date <= v_lock THEN
        RAISE EXCEPTION 'This entry is in a locked period. Reverse it instead.';
    END IF;
    IF v_e.reversal_of IS NOT NULL THEN
        UPDATE public.acc_entries SET reversed_at = NULL WHERE id = v_e.reversal_of;
    END IF;
    IF EXISTS (SELECT 1 FROM public.acc_entries WHERE reversal_of = v_e.id) THEN
        RAISE EXCEPTION 'Remove its reversal first.';
    END IF;
    PERFORM public.acc_sync_money(v_e.id, -1, public.acc_who());
    DELETE FROM public.acc_entries WHERE id = v_e.id;
END;
$$;

CREATE OR REPLACE FUNCTION public.acc_reverse_entry(p_entry_id UUID, p_date DATE DEFAULT NULL)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_e    public.acc_entries%ROWTYPE;
    v_lock DATE;
    v_date DATE;
    v_id   UUID;
    v_by   TEXT := public.acc_who();
BEGIN
    SELECT * INTO v_e FROM public.acc_entries WHERE id = p_entry_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'That entry was not found.'; END IF;
    PERFORM public.assert_business_member(v_e.business_id);
    PERFORM public.assert_permission(v_e.business_id, 'accounting.manage');
    IF v_e.source_type IS NOT NULL THEN
        RAISE EXCEPTION 'This entry comes from a sale, expense or payment. Change that record instead.';
    END IF;
    IF v_e.reversed_at IS NOT NULL OR v_e.reversal_of IS NOT NULL THEN
        RAISE EXCEPTION 'This entry is already reversed.';
    END IF;
    SELECT lock_date INTO v_lock FROM public.acc_settings WHERE business_id = v_e.business_id;
    v_date := COALESCE(p_date, (NOW() AT TIME ZONE 'Africa/Nairobi')::DATE);
    IF v_lock IS NOT NULL AND v_date <= v_lock THEN
        RAISE EXCEPTION 'The books are locked up to %. Choose a later date.', to_char(v_lock, 'DD Mon YYYY');
    END IF;
    INSERT INTO public.acc_entries (business_id, entry_date, memo, reversal_of, created_by)
    VALUES (v_e.business_id, v_date, 'Reversal of JE-' || v_e.no || ': ' || v_e.memo, v_e.id, v_by)
    RETURNING id INTO v_id;
    INSERT INTO public.acc_lines (entry_id, business_id, account_id, entry_date, debit, credit, party_type, party_id, party_name, memo)
    SELECT v_id, business_id, account_id, v_date, credit, debit, party_type, party_id, party_name, memo
    FROM public.acc_lines WHERE entry_id = v_e.id;
    UPDATE public.acc_entries SET reversed_at = NOW() WHERE id = v_e.id;
    PERFORM public.acc_sync_money(v_id, 1, v_by);
    RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.acc_save_account(
    p_business_id UUID, p_id UUID, p_code TEXT, p_name TEXT, p_type TEXT, p_description TEXT DEFAULT NULL, p_active BOOLEAN DEFAULT TRUE
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_a  public.acc_accounts%ROWTYPE;
    v_id UUID;
BEGIN
    PERFORM public.assert_business_member(p_business_id);
    PERFORM public.assert_permission(p_business_id, 'accounting.manage');
    PERFORM public.acc_ensure_accounts(p_business_id);
    IF COALESCE(trim(p_code), '') = '' OR COALESCE(trim(p_name), '') = '' THEN
        RAISE EXCEPTION 'An account needs a code and a name.';
    END IF;
    IF p_type NOT IN ('asset', 'liability', 'equity', 'income', 'expense') THEN
        RAISE EXCEPTION 'Choose what kind of account this is.';
    END IF;
    IF EXISTS (SELECT 1 FROM public.acc_accounts WHERE business_id = p_business_id AND code = trim(p_code) AND id IS DISTINCT FROM p_id) THEN
        RAISE EXCEPTION 'Another account already uses code %.', trim(p_code);
    END IF;
    IF p_id IS NULL THEN
        INSERT INTO public.acc_accounts (business_id, code, name, type, description, is_active)
        VALUES (p_business_id, trim(p_code), trim(p_name), p_type, NULLIF(trim(COALESCE(p_description, '')), ''), COALESCE(p_active, TRUE))
        RETURNING id INTO v_id;
        RETURN v_id;
    END IF;
    SELECT * INTO v_a FROM public.acc_accounts WHERE id = p_id AND business_id = p_business_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'That account was not found.'; END IF;
    IF v_a.system_key IS NOT NULL AND v_a.system_key NOT LIKE 'exp:%' AND p_type <> v_a.type THEN
        RAISE EXCEPTION 'The app posts to this account, so its kind cannot change.';
    END IF;
    IF v_a.system_key IS NOT NULL AND NOT COALESCE(p_active, TRUE) THEN
        RAISE EXCEPTION 'The app posts to this account, so it stays on.';
    END IF;
    UPDATE public.acc_accounts
    SET code = trim(p_code), name = trim(p_name), type = p_type,
        description = NULLIF(trim(COALESCE(p_description, '')), ''), is_active = COALESCE(p_active, TRUE), updated_at = NOW()
    WHERE id = p_id;
    RETURN p_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.acc_delete_account(p_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_a public.acc_accounts%ROWTYPE;
BEGIN
    SELECT * INTO v_a FROM public.acc_accounts WHERE id = p_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'That account was not found.'; END IF;
    PERFORM public.assert_business_member(v_a.business_id);
    PERFORM public.assert_permission(v_a.business_id, 'accounting.manage');
    IF v_a.system_key IS NOT NULL THEN
        RAISE EXCEPTION 'The app posts to this account, so it cannot be removed.';
    END IF;
    IF EXISTS (SELECT 1 FROM public.acc_lines WHERE account_id = p_id) THEN
        RAISE EXCEPTION 'This account has entries. Switch it off instead.';
    END IF;
    DELETE FROM public.acc_accounts WHERE id = p_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.acc_set_lock_date(p_business_id UUID, p_date DATE)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    PERFORM public.assert_business_member(p_business_id);
    PERFORM public.assert_permission(p_business_id, 'accounting.manage');
    IF p_date IS NOT NULL AND p_date >= (NOW() AT TIME ZONE 'Africa/Nairobi')::DATE THEN
        RAISE EXCEPTION 'Lock a date before today.';
    END IF;
    PERFORM public.acc_ensure_accounts(p_business_id);
    UPDATE public.acc_settings SET lock_date = p_date, updated_by = public.acc_who(), updated_at = NOW()
    WHERE business_id = p_business_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- 6. Supplier payments
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.record_supplier_payment(
    p_business_id UUID, p_supplier_id UUID, p_supplier_name TEXT, p_purchase_id UUID,
    p_amount NUMERIC, p_method TEXT, p_reference TEXT DEFAULT NULL, p_note TEXT DEFAULT NULL, p_paid_at TIMESTAMPTZ DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_name TEXT := NULLIF(trim(COALESCE(p_supplier_name, '')), '');
    v_by   TEXT := public.acc_who();
    v_id   UUID;
    v_lock DATE;
    v_at   TIMESTAMPTZ := COALESCE(p_paid_at, NOW());
BEGIN
    PERFORM public.assert_business_member(p_business_id);
    PERFORM public.assert_permission(p_business_id, 'accounting.manage', 'purchases.approve');
    IF COALESCE(p_amount, 0) <= 0 THEN RAISE EXCEPTION 'Enter how much was paid.'; END IF;
    IF p_method NOT IN ('Cash', 'M-Pesa', 'Airtel Money', 'Card', 'Bank') THEN
        RAISE EXCEPTION 'Choose Cash, M-Pesa, Airtel Money, Card or Bank.';
    END IF;
    IF p_supplier_id IS NOT NULL THEN
        SELECT name INTO v_name FROM public.suppliers WHERE id = p_supplier_id AND business_id = p_business_id;
        IF NOT FOUND THEN RAISE EXCEPTION 'That supplier was not found.'; END IF;
    END IF;
    IF p_purchase_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.purchases WHERE id = p_purchase_id AND business_id = p_business_id) THEN
        RAISE EXCEPTION 'That purchase was not found.';
    END IF;
    IF v_name IS NULL THEN RAISE EXCEPTION 'Choose the supplier.'; END IF;
    SELECT lock_date INTO v_lock FROM public.acc_settings WHERE business_id = p_business_id;
    IF v_lock IS NOT NULL AND (v_at AT TIME ZONE 'Africa/Nairobi')::DATE <= v_lock THEN
        RAISE EXCEPTION 'The books are locked up to %. Choose a later date.', to_char(v_lock, 'DD Mon YYYY');
    END IF;

    INSERT INTO public.supplier_payments (business_id, supplier_id, supplier_name, purchase_id, amount, method, paid_at, reference, note, recorded_by)
    VALUES (p_business_id, p_supplier_id, v_name, p_purchase_id, round(p_amount, 2), p_method, v_at,
            NULLIF(trim(COALESCE(p_reference, '')), ''), NULLIF(trim(COALESCE(p_note, '')), ''), v_by)
    RETURNING id INTO v_id;

    PERFORM public.fn_post_money_asset(p_business_id, p_method, -round(p_amount, 2), 'Paid supplier ' || v_name, NULL, NULL, v_by);
    RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.void_supplier_payment(p_id UUID, p_reason TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_p  public.supplier_payments%ROWTYPE;
    v_by TEXT := public.acc_who();
BEGIN
    SELECT * INTO v_p FROM public.supplier_payments WHERE id = p_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'That payment was not found.'; END IF;
    PERFORM public.assert_business_member(v_p.business_id);
    PERFORM public.assert_permission(v_p.business_id, 'accounting.manage', 'purchases.approve');
    IF v_p.voided_at IS NOT NULL THEN RETURN; END IF;
    IF COALESCE(trim(p_reason), '') = '' THEN RAISE EXCEPTION 'Give a reason.'; END IF;
    UPDATE public.supplier_payments SET voided_at = NOW(), voided_by = v_by, void_reason = trim(p_reason) WHERE id = p_id;
    PERFORM public.fn_post_money_asset(v_p.business_id, v_p.method, v_p.amount, 'Voided supplier payment to ' || v_p.supplier_name, NULL, NULL, v_by);
END;
$$;

-- ---------------------------------------------------------------------------
-- 7. Reports
-- ---------------------------------------------------------------------------
-- Every account with its balance before p_start, movement in the range, and
-- balance at p_end. The screen builds the trial balance, profit & loss and
-- balance sheet from this.
CREATE OR REPLACE FUNCTION public.acc_report(p_business_id UUID, p_start DATE, p_end DATE)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_accounts JSONB;
    v_settings JSONB;
    v_errors   INTEGER;
BEGIN
    PERFORM public.assert_business_member(p_business_id);
    PERFORM public.assert_permission(p_business_id, 'accounting.view');
    PERFORM public.acc_ensure_accounts(p_business_id);

    SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'id', a.id, 'code', a.code, 'name', a.name, 'type', a.type, 'key', a.system_key,
        'description', a.description, 'active', a.is_active,
        'opening', COALESCE(s.opening, 0), 'debit', COALESCE(s.debit, 0), 'credit', COALESCE(s.credit, 0),
        'closing', COALESCE(s.opening, 0) + COALESCE(s.debit, 0) - COALESCE(s.credit, 0),
        'lines', COALESCE(s.n, 0)
    ) ORDER BY a.code), '[]'::JSONB) INTO v_accounts
    FROM public.acc_accounts a
    LEFT JOIN (
        SELECT l.account_id,
               SUM(l.debit - l.credit) FILTER (WHERE l.entry_date < p_start) AS opening,
               SUM(l.debit) FILTER (WHERE l.entry_date BETWEEN p_start AND p_end) AS debit,
               SUM(l.credit) FILTER (WHERE l.entry_date BETWEEN p_start AND p_end) AS credit,
               COUNT(*) AS n
        FROM public.acc_lines l
        WHERE l.business_id = p_business_id AND l.entry_date <= p_end
        GROUP BY l.account_id
    ) s ON s.account_id = a.id
    WHERE a.business_id = p_business_id;

    SELECT jsonb_build_object('lockDate', lock_date, 'updatedBy', updated_by, 'updatedAt', updated_at) INTO v_settings
    FROM public.acc_settings WHERE business_id = p_business_id;
    SELECT COUNT(*) INTO v_errors FROM public.acc_post_errors WHERE business_id = p_business_id;

    RETURN jsonb_build_object(
        'start', p_start, 'end', p_end,
        'accounts', v_accounts,
        'settings', COALESCE(v_settings, '{}'::JSONB),
        'errors', v_errors,
        'firstDate', (SELECT MIN(entry_date) FROM public.acc_entries WHERE business_id = p_business_id),
        'canManage', public.has_permission(p_business_id, 'accounting.manage')
    );
END;
$$;

-- One account's lines with a running balance.
CREATE OR REPLACE FUNCTION public.acc_ledger(p_account_id UUID, p_start DATE, p_end DATE, p_limit INTEGER DEFAULT 500)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_a       public.acc_accounts%ROWTYPE;
    v_opening NUMERIC;
    v_rows    JSONB;
    v_total   INTEGER;
BEGIN
    SELECT * INTO v_a FROM public.acc_accounts WHERE id = p_account_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'That account was not found.'; END IF;
    PERFORM public.assert_business_member(v_a.business_id);
    PERFORM public.assert_permission(v_a.business_id, 'accounting.view');

    SELECT COALESCE(SUM(debit - credit), 0) INTO v_opening
    FROM public.acc_lines WHERE account_id = p_account_id AND entry_date < p_start;
    SELECT COUNT(*) INTO v_total FROM public.acc_lines WHERE account_id = p_account_id AND entry_date BETWEEN p_start AND p_end;

    -- Newest first; the balance is the running balance after each line.
    SELECT COALESCE(jsonb_agg(q.x ORDER BY q.sort DESC), '[]'::JSONB) INTO v_rows FROM (
        SELECT jsonb_build_object(
            'entryId', e.id, 'no', e.no, 'date', l.entry_date, 'memo', COALESCE(l.memo, e.memo),
            'source', e.source_type, 'sourceId', e.source_id, 'party', l.party_name,
            'debit', l.debit, 'credit', l.credit,
            'balance', v_opening + SUM(l.debit - l.credit) OVER (ORDER BY l.entry_date, e.no, l.id)
        ) AS x, row_number() OVER (ORDER BY l.entry_date, e.no, l.id) AS sort
        FROM public.acc_lines l JOIN public.acc_entries e ON e.id = l.entry_id
        WHERE l.account_id = p_account_id AND l.entry_date BETWEEN p_start AND p_end
    ) q
    WHERE q.sort > v_total - LEAST(GREATEST(p_limit, 1), 2000);

    RETURN jsonb_build_object(
        'account', jsonb_build_object('id', v_a.id, 'code', v_a.code, 'name', v_a.name, 'type', v_a.type, 'key', v_a.system_key),
        'opening', v_opening, 'lines', v_rows, 'total', v_total
    );
END;
$$;

-- The journal: entries in a range, newest first, with their lines.
CREATE OR REPLACE FUNCTION public.acc_journal(
    p_business_id UUID, p_start DATE, p_end DATE, p_search TEXT DEFAULT NULL, p_kind TEXT DEFAULT NULL,
    p_limit INTEGER DEFAULT 100, p_offset INTEGER DEFAULT 0
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_q     TEXT := NULLIF(trim(COALESCE(p_search, '')), '');
    v_no    BIGINT;
    v_rows  JSONB;
    v_total INTEGER;
BEGIN
    PERFORM public.assert_business_member(p_business_id);
    PERFORM public.assert_permission(p_business_id, 'accounting.view');
    IF v_q ~* '^(je-?)?[0-9]+$' THEN
        v_no := regexp_replace(v_q, '\D', '', 'g')::BIGINT;
    END IF;

    WITH f AS (
        SELECT e.* FROM public.acc_entries e
        WHERE e.business_id = p_business_id
          AND (v_no IS NOT NULL OR e.entry_date BETWEEN p_start AND p_end)
          AND (p_kind IS NULL OR (p_kind = 'manual' AND e.source_type IS NULL) OR e.source_type = p_kind)
          AND (v_q IS NULL OR e.no = v_no OR e.memo ILIKE '%' || v_q || '%'
               OR EXISTS (SELECT 1 FROM public.acc_lines l WHERE l.entry_id = e.id AND l.party_name ILIKE '%' || v_q || '%'))
    )
    SELECT (SELECT COUNT(*) FROM f),
           COALESCE((SELECT jsonb_agg(row ORDER BY d DESC, n DESC) FROM (
               SELECT f.entry_date AS d, f.no AS n, jsonb_build_object(
                   'id', f.id, 'no', f.no, 'date', f.entry_date, 'memo', f.memo,
                   'source', f.source_type, 'sourceId', f.source_id,
                   'reversalOf', f.reversal_of, 'reversed', f.reversed_at IS NOT NULL,
                   'by', f.created_by, 'at', f.created_at,
                   'lines', (SELECT jsonb_agg(jsonb_build_object(
                                 'accountId', l.account_id, 'code', a.code, 'account', a.name, 'type', a.type,
                                 'debit', l.debit, 'credit', l.credit, 'party', l.party_name, 'memo', l.memo)
                             ORDER BY l.debit DESC, l.credit)
                             FROM public.acc_lines l JOIN public.acc_accounts a ON a.id = l.account_id
                             WHERE l.entry_id = f.id)
               ) AS row
               FROM f ORDER BY f.entry_date DESC, f.no DESC
               OFFSET GREATEST(p_offset, 0) LIMIT LEAST(GREATEST(p_limit, 1), 500)
           ) x), '[]'::JSONB)
    INTO v_total, v_rows;

    RETURN jsonb_build_object('total', v_total, 'entries', v_rows);
END;
$$;

-- What customers owe and hold (from the books), next to what the customer screen shows.
CREATE OR REPLACE FUNCTION public.acc_receivables(p_business_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_rows JSONB;
BEGIN
    PERFORM public.assert_business_member(p_business_id);
    PERFORM public.assert_permission(p_business_id, 'accounting.view');
    WITH acc AS (
        SELECT id, system_key FROM public.acc_accounts
        WHERE business_id = p_business_id AND system_key IN ('receivable', 'wallets')
    ), b AS (
        SELECT l.party_id,
               MAX(l.party_name) AS name,
               SUM(l.debit - l.credit) FILTER (WHERE acc.system_key = 'receivable') AS owes,
               SUM(l.credit - l.debit) FILTER (WHERE acc.system_key = 'wallets') AS holds,
               MAX(l.entry_date) AS last_date,
               MIN(l.entry_date) FILTER (WHERE acc.system_key = 'receivable' AND l.debit > 0) AS first_debt
        FROM public.acc_lines l JOIN acc ON acc.id = l.account_id
        WHERE l.business_id = p_business_id AND l.party_type = 'customer' AND l.party_id IS NOT NULL
        GROUP BY l.party_id
    )
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'customerId', b.party_id, 'name', COALESCE(c.name, b.name),
        'phone', c.phone, 'owes', COALESCE(b.owes, 0), 'holds', COALESCE(b.holds, 0),
        'appDebt', COALESCE(c.debt_balance, 0), 'appWallet', COALESCE(c.wallet_balance, 0),
        'lastDate', b.last_date, 'since', b.first_debt
    ) ORDER BY COALESCE(b.owes, 0) DESC), '[]'::JSONB) INTO v_rows
    FROM b
    LEFT JOIN public.customers c ON c.id::TEXT = b.party_id
    WHERE round(COALESCE(b.owes, 0), 2) <> 0 OR round(COALESCE(b.holds, 0), 2) <> 0
       OR round(COALESCE(c.debt_balance, 0), 2) <> 0 OR round(COALESCE(c.wallet_balance, 0), 2) <> 0;
    RETURN v_rows;
END;
$$;

-- What we owe each supplier, with each received purchase and what was paid on it.
CREATE OR REPLACE FUNCTION public.acc_payables(p_business_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_rows     JSONB;
    v_payments JSONB;
BEGIN
    PERFORM public.assert_business_member(p_business_id);
    PERFORM public.assert_permission(p_business_id, 'accounting.view', 'purchases.view');

    WITH bills AS (
        SELECT COALESCE(p.supplier_id::TEXT, 'name:' || lower(trim(COALESCE(p.supplier_name, '')))) AS party,
               p.supplier_id, p.supplier_name, p.id, p.total_amount,
               COALESCE(NULLIF(p.reference_number, ''), 'PO-' || upper(left(replace(p.id::TEXT, '-', ''), 8))) AS ref,
               COALESCE(p.received_at, p.date) AS received,
               COALESCE((SELECT SUM(sp.amount) FROM public.supplier_payments sp
                         WHERE sp.purchase_id = p.id AND sp.voided_at IS NULL), 0) AS paid
        FROM public.purchases p
        WHERE p.business_id = p_business_id AND p.status = 'Received'
    ), pays AS (
        SELECT COALESCE(sp.supplier_id::TEXT, 'name:' || lower(trim(sp.supplier_name))) AS party,
               sp.supplier_id, sp.supplier_name, SUM(sp.amount) AS paid,
               SUM(sp.amount) FILTER (WHERE sp.purchase_id IS NULL) AS unlinked
        FROM public.supplier_payments sp
        WHERE sp.business_id = p_business_id AND sp.voided_at IS NULL
        GROUP BY 1, 2, 3
    ), parties AS (
        SELECT party, MAX(supplier_id::TEXT) AS supplier_id, MAX(supplier_name) AS name FROM (
            SELECT party, supplier_id, supplier_name FROM bills
            UNION ALL SELECT party, supplier_id, supplier_name FROM pays
        ) u GROUP BY party
    )
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'party', pa.party, 'supplierId', pa.supplier_id,
        'name', COALESCE(s.name, pa.name, 'Supplier'), 'phone', s.phone,
        'billed', COALESCE((SELECT SUM(total_amount) FROM bills b WHERE b.party = pa.party), 0),
        'paid', COALESCE((SELECT SUM(paid) FROM pays p WHERE p.party = pa.party), 0),
        'owed', COALESCE((SELECT SUM(total_amount) FROM bills b WHERE b.party = pa.party), 0)
                - COALESCE((SELECT SUM(paid) FROM pays p WHERE p.party = pa.party), 0),
        'unlinkedPaid', COALESCE((SELECT SUM(unlinked) FROM pays p WHERE p.party = pa.party), 0),
        'bills', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                    'purchaseId', b.id, 'ref', b.ref, 'received', b.received,
                    'total', b.total_amount, 'paid', b.paid, 'owed', b.total_amount - b.paid)
                    ORDER BY b.received DESC)
                 FROM bills b WHERE b.party = pa.party), '[]'::JSONB)
    ) ORDER BY COALESCE(s.name, pa.name)), '[]'::JSONB) INTO v_rows
    FROM parties pa
    LEFT JOIN public.suppliers s ON s.id::TEXT = pa.supplier_id;

    SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'id', sp.id, 'supplierId', sp.supplier_id, 'supplier', sp.supplier_name, 'purchaseId', sp.purchase_id,
        'amount', sp.amount, 'method', sp.method, 'paidAt', sp.paid_at, 'reference', sp.reference,
        'note', sp.note, 'by', sp.recorded_by, 'voidedAt', sp.voided_at, 'voidReason', sp.void_reason
    ) ORDER BY sp.paid_at DESC), '[]'::JSONB) INTO v_payments
    FROM (SELECT * FROM public.supplier_payments WHERE business_id = p_business_id ORDER BY paid_at DESC LIMIT 300) sp;

    RETURN jsonb_build_object('suppliers', v_rows, 'payments', v_payments,
        'canPay', public.has_permission(p_business_id, 'accounting.manage', 'purchases.approve'));
END;
$$;

-- VAT by month: what sales charged, what was paid to KRA (debits on the VAT account).
CREATE OR REPLACE FUNCTION public.acc_vat(p_business_id UUID, p_start DATE, p_end DATE)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_rows JSONB;
    v_vat  UUID;
    v_s    UUID;
    v_d    UUID;
BEGIN
    PERFORM public.assert_business_member(p_business_id);
    PERFORM public.assert_permission(p_business_id, 'accounting.view');
    v_vat := public.acc_account(p_business_id, 'vat');
    v_s := public.acc_account(p_business_id, 'sales');
    v_d := public.acc_account(p_business_id, 'delivery');
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'month', to_char(m, 'YYYY-MM'),
        'sales', COALESCE(x.sales, 0), 'taxedSales', COALESCE(x.taxed, 0),
        'vatCharged', COALESCE(x.charged, 0), 'vatPaid', COALESCE(x.paid, 0)
    ) ORDER BY m), '[]'::JSONB) INTO v_rows
    FROM generate_series(date_trunc('month', p_start), date_trunc('month', p_end), INTERVAL '1 month') m
    LEFT JOIN (
        SELECT date_trunc('month', l.entry_date) AS mo,
               SUM(l.credit - l.debit) FILTER (WHERE l.account_id IN (v_s, v_d)) AS sales,
               SUM(l.credit - l.debit) FILTER (WHERE l.account_id IN (v_s, v_d)
                   AND EXISTS (SELECT 1 FROM public.acc_lines v WHERE v.entry_id = l.entry_id AND v.account_id = v_vat)) AS taxed,
               SUM(l.credit) FILTER (WHERE l.account_id = v_vat AND e.source_type IS NOT NULL) AS charged,
               SUM(l.debit) FILTER (WHERE l.account_id = v_vat AND e.source_type IS NULL) AS paid
        FROM public.acc_lines l JOIN public.acc_entries e ON e.id = l.entry_id
        WHERE l.business_id = p_business_id AND l.entry_date BETWEEN p_start AND p_end
          AND l.account_id IN (v_vat, v_s, v_d)
        GROUP BY 1
    ) x ON x.mo = m;
    RETURN jsonb_build_object(
        'months', v_rows,
        'taxOn', (SELECT COALESCE(is_tax_enabled, FALSE) FROM public.businesses WHERE id = p_business_id),
        'rate', (SELECT tax_percentage FROM public.businesses WHERE id = p_business_id),
        'owedNow', (SELECT COALESCE(SUM(credit - debit), 0) FROM public.acc_lines WHERE account_id = v_vat)
    );
END;
$$;

-- Money and stock: what the books say, what the app's balances say, recent counts.
CREATE OR REPLACE FUNCTION public.acc_checks(p_business_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_money JSONB;
    v_stock NUMERIC;
    v_books NUMERIC;
    v_recon JSONB;
BEGIN
    PERFORM public.assert_business_member(p_business_id);
    PERFORM public.assert_permission(p_business_id, 'accounting.view');
    PERFORM public.acc_ensure_accounts(p_business_id);

    SELECT jsonb_agg(jsonb_build_object(
        'accountId', a.id, 'code', a.code, 'name', a.name, 'key', a.system_key,
        'method', public.acc_key_method(a.system_key),
        'books', COALESCE((SELECT SUM(debit - credit) FROM public.acc_lines l WHERE l.account_id = a.id), 0),
        'app', (SELECT ma.balance FROM public.money_assets ma
                WHERE ma.business_id = p_business_id AND ma.method = public.acc_key_method(a.system_key))
    ) ORDER BY a.code) INTO v_money
    FROM public.acc_accounts a
    WHERE a.business_id = p_business_id AND public.acc_key_method(a.system_key) IS NOT NULL;

    SELECT COALESCE(SUM(GREATEST(stock, 0) * COALESCE(cost, 0)), 0) INTO v_stock
    FROM public.products WHERE business_id = p_business_id AND deleted_at IS NULL;
    SELECT COALESCE(SUM(debit - credit), 0) INTO v_books
    FROM public.acc_lines WHERE account_id = public.acc_account(p_business_id, 'inventory');

    SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'id', r.id, 'kind', r.kind, 'account', a.name, 'books', r.book_balance, 'actual', r.actual_balance,
        'app', r.app_balance, 'difference', r.difference, 'note', r.note, 'by', r.recorded_by, 'at', r.created_at,
        'entryNo', e.no
    ) ORDER BY r.created_at DESC), '[]'::JSONB) INTO v_recon
    FROM (SELECT * FROM public.acc_reconciliations WHERE business_id = p_business_id ORDER BY created_at DESC LIMIT 50) r
    JOIN public.acc_accounts a ON a.id = r.account_id
    LEFT JOIN public.acc_entries e ON e.id = r.entry_id;

    RETURN jsonb_build_object(
        'money', COALESCE(v_money, '[]'::JSONB),
        'stock', jsonb_build_object('books', round(v_books, 2), 'actual', round(v_stock, 2), 'difference', round(v_stock - v_books, 2)),
        'history', v_recon
    );
END;
$$;

-- Count the money in an account: the books (and the app's balance) are set to what was counted.
CREATE OR REPLACE FUNCTION public.acc_reconcile_money(p_business_id UUID, p_account_id UUID, p_actual NUMERIC, p_note TEXT DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_a      public.acc_accounts%ROWTYPE;
    v_method TEXT;
    v_books  NUMERIC;
    v_app    NUMERIC;
    v_diff   NUMERIC;
    v_entry  UUID;
    v_by     TEXT := public.acc_who();
    v_today  DATE := (NOW() AT TIME ZONE 'Africa/Nairobi')::DATE;
    v_lock   DATE;
BEGIN
    PERFORM public.assert_business_member(p_business_id);
    PERFORM public.assert_permission(p_business_id, 'accounting.manage');
    SELECT * INTO v_a FROM public.acc_accounts WHERE id = p_account_id AND business_id = p_business_id;
    v_method := public.acc_key_method(v_a.system_key);
    IF v_method IS NULL THEN RAISE EXCEPTION 'Choose a money account (cash, M-Pesa, Airtel, bank or card).'; END IF;
    IF p_actual IS NULL THEN RAISE EXCEPTION 'Enter the amount you counted.'; END IF;
    SELECT lock_date INTO v_lock FROM public.acc_settings WHERE business_id = p_business_id;
    IF v_lock IS NOT NULL AND v_today <= v_lock THEN RAISE EXCEPTION 'Today is in a locked period.'; END IF;

    SELECT COALESCE(SUM(debit - credit), 0) INTO v_books FROM public.acc_lines WHERE account_id = p_account_id;
    SELECT balance INTO v_app FROM public.money_assets WHERE business_id = p_business_id AND method = v_method;
    v_diff := round(p_actual - v_books, 2);

    IF v_diff <> 0 THEN
        INSERT INTO public.acc_entries (business_id, entry_date, memo, created_by)
        VALUES (p_business_id, v_today, v_a.name || ' counted: ' || CASE WHEN v_diff > 0 THEN 'more' ELSE 'less' END || ' than the books'
                || COALESCE(' · ' || NULLIF(trim(p_note), ''), ''), v_by)
        RETURNING id INTO v_entry;
        INSERT INTO public.acc_lines (entry_id, business_id, account_id, entry_date, debit, credit)
        VALUES (v_entry, p_business_id, p_account_id, v_today, GREATEST(v_diff, 0), GREATEST(-v_diff, 0)),
               (v_entry, p_business_id, public.acc_account(p_business_id, 'cash_diff'), v_today, GREATEST(-v_diff, 0), GREATEST(v_diff, 0));
    END IF;
    -- The Payments screen balance becomes the counted amount too (not through the entry above,
    -- because the app's balance and the books may have differed before).
    PERFORM public.fn_post_money_asset(p_business_id, v_method, round(p_actual - COALESCE(v_app, 0), 2),
        'Counted: ' || p_actual || COALESCE(' · ' || NULLIF(trim(p_note), ''), ''), NULL, NULL, v_by);

    INSERT INTO public.acc_reconciliations (business_id, account_id, kind, book_balance, actual_balance, app_balance, difference, entry_id, note, recorded_by)
    VALUES (p_business_id, p_account_id, 'money', v_books, p_actual, v_app, v_diff, v_entry, NULLIF(trim(COALESCE(p_note, '')), ''), v_by);

    RETURN jsonb_build_object('difference', v_diff, 'entryId', v_entry);
END;
$$;

-- Set the stock account to what stock is worth now (stock × cost).
CREATE OR REPLACE FUNCTION public.acc_match_stock(p_business_id UUID, p_note TEXT DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_inv    UUID;
    v_books  NUMERIC;
    v_actual NUMERIC;
    v_diff   NUMERIC;
    v_entry  UUID;
    v_by     TEXT := public.acc_who();
    v_today  DATE := (NOW() AT TIME ZONE 'Africa/Nairobi')::DATE;
    v_lock   DATE;
BEGIN
    PERFORM public.assert_business_member(p_business_id);
    PERFORM public.assert_permission(p_business_id, 'accounting.manage');
    SELECT lock_date INTO v_lock FROM public.acc_settings WHERE business_id = p_business_id;
    IF v_lock IS NOT NULL AND v_today <= v_lock THEN RAISE EXCEPTION 'Today is in a locked period.'; END IF;
    v_inv := public.acc_account(p_business_id, 'inventory');
    SELECT COALESCE(SUM(debit - credit), 0) INTO v_books FROM public.acc_lines WHERE account_id = v_inv;
    SELECT round(COALESCE(SUM(GREATEST(stock, 0) * COALESCE(cost, 0)), 0), 2) INTO v_actual
    FROM public.products WHERE business_id = p_business_id AND deleted_at IS NULL;
    v_diff := round(v_actual - v_books, 2);
    IF v_diff <> 0 THEN
        INSERT INTO public.acc_entries (business_id, entry_date, memo, created_by)
        VALUES (p_business_id, v_today, 'Stock value matched to stock on hand'
                || COALESCE(' · ' || NULLIF(trim(p_note), ''), ''), v_by)
        RETURNING id INTO v_entry;
        INSERT INTO public.acc_lines (entry_id, business_id, account_id, entry_date, debit, credit)
        VALUES (v_entry, p_business_id, v_inv, v_today, GREATEST(v_diff, 0), GREATEST(-v_diff, 0)),
               (v_entry, p_business_id, public.acc_account(p_business_id, 'stock_loss'), v_today, GREATEST(-v_diff, 0), GREATEST(v_diff, 0));
    END IF;
    INSERT INTO public.acc_reconciliations (business_id, account_id, kind, book_balance, actual_balance, difference, entry_id, note, recorded_by)
    VALUES (p_business_id, v_inv, 'stock', v_books, v_actual, v_diff, v_entry, NULLIF(trim(COALESCE(p_note, '')), ''), v_by);
    RETURN jsonb_build_object('difference', v_diff, 'entryId', v_entry);
END;
$$;

CREATE OR REPLACE FUNCTION public.acc_errors(p_business_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    PERFORM public.assert_business_member(p_business_id);
    PERFORM public.assert_permission(p_business_id, 'accounting.view');
    RETURN COALESCE((SELECT jsonb_agg(jsonb_build_object('source', source_type, 'sourceId', source_id, 'message', message, 'at', created_at)
                     ORDER BY created_at DESC)
                     FROM (SELECT * FROM public.acc_post_errors WHERE business_id = p_business_id ORDER BY created_at DESC LIMIT 100) x), '[]'::JSONB);
END;
$$;

-- ---------------------------------------------------------------------------
-- 8. Grants: the app calls these; internal helpers stay private.
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.acc_ensure_accounts(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.acc_account(UUID, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.acc_expense_account(UUID, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.acc_apply(UUID, TEXT, UUID, DATE, TEXT, JSONB, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.acc_post_source(TEXT, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.acc_source_ids(UUID, TEXT, INTEGER, INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.acc_sync_money(UUID, INTEGER, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.acc_who() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.acc_trg_post() FROM PUBLIC, anon, authenticated;

DO $$
DECLARE f TEXT;
BEGIN
    FOREACH f IN ARRAY ARRAY[
        'acc_report(UUID, DATE, DATE)', 'acc_ledger(UUID, DATE, DATE, INTEGER)',
        'acc_journal(UUID, DATE, DATE, TEXT, TEXT, INTEGER, INTEGER)', 'acc_receivables(UUID)', 'acc_payables(UUID)',
        'acc_vat(UUID, DATE, DATE)', 'acc_checks(UUID)', 'acc_errors(UUID)',
        'acc_save_entry(UUID, DATE, TEXT, JSONB, UUID)', 'acc_delete_entry(UUID)', 'acc_reverse_entry(UUID, DATE)',
        'acc_save_account(UUID, UUID, TEXT, TEXT, TEXT, TEXT, BOOLEAN)', 'acc_delete_account(UUID)',
        'acc_set_lock_date(UUID, DATE)', 'acc_rebuild_start(UUID)', 'acc_rebuild_chunk(UUID, TEXT, INTEGER, INTEGER)',
        'acc_retry_errors(UUID)', 'acc_reconcile_money(UUID, UUID, NUMERIC, TEXT)', 'acc_match_stock(UUID, TEXT)',
        'record_supplier_payment(UUID, UUID, TEXT, UUID, NUMERIC, TEXT, TEXT, TEXT, TIMESTAMPTZ)',
        'void_supplier_payment(UUID, TEXT)'
    ] LOOP
        EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon', f);
        EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated', f);
    END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 9. Start the books for every business from its history
-- ---------------------------------------------------------------------------
DO $$
DECLARE
    v_b    UUID;
    v_kind TEXT;
    v_id   UUID;
BEGIN
    FOR v_b IN SELECT id FROM public.businesses LOOP
        PERFORM public.acc_ensure_accounts(v_b);
        FOREACH v_kind IN ARRAY ARRAY['sale', 'expense', 'cledger', 'payment', 'purchase', 'supplier_payment', 'stock_adj'] LOOP
            FOR v_id IN SELECT * FROM public.acc_source_ids(v_b, v_kind, 0, 2147483647) LOOP
                BEGIN
                    PERFORM public.acc_post_source(v_kind, v_id);
                EXCEPTION WHEN OTHERS THEN
                    INSERT INTO public.acc_post_errors (business_id, source_type, source_id, message)
                    VALUES (v_b, v_kind, v_id, SQLERRM)
                    ON CONFLICT (source_type, source_id) DO UPDATE SET message = EXCLUDED.message;
                END;
            END LOOP;
        END LOOP;
    END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 10. Role defaults (mirrors SYSTEM_ROLES in src/utils/permissions.ts; a test compares them)
-- Managers can read the books; changing them is for owners and admins unless given.
-- ---------------------------------------------------------------------------
INSERT INTO public.role_default_permissions (role, permissions) VALUES
    ('Manager', ARRAY['accounting.view', 'ai.insights', 'ai.use', 'assets.view', 'bom.create', 'bom.update', 'bom.view', 'business.switch', 'business.view', 'communication.send', 'communication.view', 'complaints.reply', 'complaints.view', 'customers.create', 'customers.debts', 'customers.loyalty', 'customers.manage', 'customers.schedules', 'customers.update', 'customers.view', 'dashboard.view', 'deliveries.assign', 'deliveries.cancel', 'deliveries.complete', 'deliveries.create', 'deliveries.view', 'expenses.create', 'expenses.update', 'expenses.view', 'files.view', 'finance.view', 'home.view', 'inventory.adjust_stock', 'inventory.expiry', 'inventory.receive_stock', 'inventory.stock_count', 'inventory.stock_history', 'inventory.transfer_stock', 'inventory.view', 'inventory.wastage', 'loyalty.adjust', 'notifications.send', 'notifications.view', 'online_store.view', 'orders.assign_rider', 'orders.complete', 'orders.create', 'orders.update', 'orders.view', 'payments.card', 'payments.cash', 'payments.verify', 'payments.view', 'pettycash.record', 'pos.close_shift', 'pos.create_sale', 'pos.open_shift', 'pos.walkin_customer', 'production.approve', 'production.create', 'production.update', 'production.view', 'products.create', 'products.export', 'products.import', 'products.manage_categories', 'products.update', 'products.view', 'purchases.approve', 'purchases.create', 'purchases.export', 'purchases.print', 'purchases.update', 'purchases.view', 'reports.customers', 'reports.deliveries', 'reports.inventory', 'reports.profit', 'reports.sales', 'reports.view', 'settings.tax', 'settings.theme', 'settings.update', 'settings.view', 'staff.schedule', 'staff.view', 'suppliers.create', 'suppliers.export', 'suppliers.import', 'suppliers.update', 'suppliers.view']),
    ('Cashier', ARRAY['ai.use', 'business.view', 'complaints.view', 'customers.create', 'customers.debts', 'customers.loyalty', 'customers.schedules', 'customers.view', 'dashboard.view', 'inventory.view', 'notifications.view', 'online_store.view', 'orders.assign_rider', 'orders.create', 'orders.update', 'orders.view', 'payments.card', 'payments.cash', 'payments.mpesa', 'payments.airtel', 'payments.verify', 'pettycash.record', 'pos.cancel_sale', 'pos.close_shift', 'pos.create_sale', 'pos.discount', 'pos.open_shift', 'pos.walkin_customer', 'products.view', 'settings.theme']),
    ('Rider', ARRAY['ai.use', 'business.view', 'dashboard.view', 'deliveries.cancel', 'deliveries.complete', 'deliveries.delivery_price', 'deliveries.delivery_zones', 'deliveries.view', 'notifications.view', 'settings.theme'])
ON CONFLICT (role) DO UPDATE SET permissions = EXCLUDED.permissions;

NOTIFY pgrst, 'reload schema';

COMMIT;
