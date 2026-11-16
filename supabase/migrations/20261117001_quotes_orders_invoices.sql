-- =============================================================================
-- 20261117001_quotes_orders_invoices.sql
-- Roadmap step 2: quotes -> sales orders -> deliveries and invoices -> payments,
-- and credit notes (for an invoice or a till sale) instead of deleting a sale.
--
--   Quote        QT-2026-0001  draft -> sent -> accepted / declined (expired when
--                              past "valid until"). Accepting makes a sales order
--                              with the quote's prices, even if product prices change.
--   Sales order  SO-2026-0001  confirmed -> part delivered -> delivered -> invoiced
--                              -> paid, or cancelled.
--   Delivery     DN-2026-0001  takes stock out when it happens, at that day's cost.
--   Invoice      INV-2026-0001 money the customer owes, due after the payment terms.
--   Credit note  CN-2026-0001  all or some lines back: less owed on the invoice,
--                              money back, money into the customer's wallet, or less
--                              debt on a till credit sale. Stock can come back too.
--
-- Numbers come from a counter per branch (business row), kind and year, taken in the
-- same transaction as the document, so a number is never skipped.
--
-- Invoice debt is kept apart from till debt (customers.debt_balance): a debt payment
-- on the Loyalty screen never pays an invoice. An invoice payment is recorded with
-- process_business_payment() with no customer, so it lands in "Payments not matched
-- to a sale" and the invoice payment moves it from there to the invoice. A payment
-- already in Payments (an M-Pesa till payment, say) can be used the same way.
--
-- Books (through acc_post_source, never written directly):
--   sales_delivery   Dr Cost of goods sold      Cr Stock
--   sales_invoice    Dr Customers owe us        Cr Sales, Delivery fees, VAT
--   invoice_payment  Dr Payments not matched    Cr Customers owe us
--   credit_note      Dr Sales, VAT              Cr Customers owe us / money / wallet
--                    (+ stock back)  Dr Stock   Cr Cost of goods sold
--
-- Permissions: quotes.view/manage, sales_orders.view/manage, invoices.view/manage,
-- refunds.create (Manager). Anyone who may cancel a sale (pos.cancel_sale, cashiers)
-- may refund a till sale made today.
-- Not in this step: sending invoices and credit notes to KRA eTIMS (the kra-etims
-- function signs till sales only), and a quote link customers can accept online.
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Tables
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.doc_counters (
    business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    kind        TEXT NOT NULL,
    year        INTEGER NOT NULL,
    last_no     INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (business_id, kind, year)
);

CREATE TABLE IF NOT EXISTS public.quotes (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id    UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    number         TEXT NOT NULL,
    customer_id    UUID REFERENCES public.customers(id) ON DELETE SET NULL,
    customer_name  TEXT NOT NULL,
    customer_phone TEXT,
    issue_date     DATE NOT NULL,
    valid_until    DATE NOT NULL,
    status         TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'sent', 'accepted', 'declined')),
    notes          TEXT,
    terms          TEXT,
    delivery_fee   NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (delivery_fee >= 0),
    subtotal       NUMERIC(14,2) NOT NULL DEFAULT 0,
    vat_total      NUMERIC(14,2) NOT NULL DEFAULT 0,
    total          NUMERIC(14,2) NOT NULL DEFAULT 0,
    order_id       UUID,
    sent_at        TIMESTAMPTZ,
    decided_at     TIMESTAMPTZ,
    created_by     TEXT,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (business_id, number)
);

CREATE TABLE IF NOT EXISTS public.quote_lines (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    quote_id     UUID NOT NULL REFERENCES public.quotes(id) ON DELETE CASCADE,
    business_id  UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    position     INTEGER NOT NULL DEFAULT 0,
    product_id   UUID REFERENCES public.products(id) ON DELETE SET NULL,
    name         TEXT NOT NULL,
    unit         TEXT,
    quantity     NUMERIC(14,3) NOT NULL CHECK (quantity > 0),
    unit_price   NUMERIC(14,2) NOT NULL CHECK (unit_price >= 0),
    discount_pct NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (discount_pct >= 0 AND discount_pct <= 100),
    vat_rate     NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (vat_rate IN (0, 8, 16)),
    line_net     NUMERIC(14,2) NOT NULL,
    line_vat     NUMERIC(14,2) NOT NULL,
    line_total   NUMERIC(14,2) NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_quote_lines_quote ON public.quote_lines(quote_id);

CREATE TABLE IF NOT EXISTS public.sales_orders (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id    UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    number         TEXT NOT NULL,
    quote_id       UUID REFERENCES public.quotes(id) ON DELETE SET NULL,
    customer_id    UUID REFERENCES public.customers(id) ON DELETE SET NULL,
    customer_name  TEXT NOT NULL,
    customer_phone TEXT,
    order_date     DATE NOT NULL,
    expected_date  DATE,
    status         TEXT NOT NULL DEFAULT 'confirmed'
                   CHECK (status IN ('confirmed', 'part_delivered', 'delivered', 'invoiced', 'paid', 'cancelled')),
    notes          TEXT,
    terms          TEXT,
    delivery_fee   NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (delivery_fee >= 0),
    subtotal       NUMERIC(14,2) NOT NULL DEFAULT 0,
    vat_total      NUMERIC(14,2) NOT NULL DEFAULT 0,
    total          NUMERIC(14,2) NOT NULL DEFAULT 0,
    created_by     TEXT,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    cancelled_at   TIMESTAMPTZ,
    cancelled_by   TEXT,
    cancel_reason  TEXT,
    UNIQUE (business_id, number)
);
CREATE INDEX IF NOT EXISTS idx_sales_orders_business ON public.sales_orders(business_id, order_date DESC);

DO $$ BEGIN
    ALTER TABLE public.quotes ADD CONSTRAINT quotes_order_fk FOREIGN KEY (order_id) REFERENCES public.sales_orders(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.sales_order_lines (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id      UUID NOT NULL REFERENCES public.sales_orders(id) ON DELETE CASCADE,
    business_id   UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    position      INTEGER NOT NULL DEFAULT 0,
    product_id    UUID REFERENCES public.products(id) ON DELETE SET NULL,
    name          TEXT NOT NULL,
    unit          TEXT,
    quantity      NUMERIC(14,3) NOT NULL CHECK (quantity > 0),
    unit_price    NUMERIC(14,2) NOT NULL CHECK (unit_price >= 0),
    discount_pct  NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (discount_pct >= 0 AND discount_pct <= 100),
    vat_rate      NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (vat_rate IN (0, 8, 16)),
    line_net      NUMERIC(14,2) NOT NULL,
    line_vat      NUMERIC(14,2) NOT NULL,
    line_total    NUMERIC(14,2) NOT NULL,
    qty_delivered NUMERIC(14,3) NOT NULL DEFAULT 0 CHECK (qty_delivered >= 0),
    qty_invoiced  NUMERIC(14,3) NOT NULL DEFAULT 0 CHECK (qty_invoiced >= 0)
);
CREATE INDEX IF NOT EXISTS idx_sales_order_lines_order ON public.sales_order_lines(order_id);

CREATE TABLE IF NOT EXISTS public.sales_deliveries (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id   UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    order_id      UUID NOT NULL REFERENCES public.sales_orders(id) ON DELETE CASCADE,
    number        TEXT NOT NULL,
    delivered_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    delivered_by  TEXT,
    note          TEXT,
    total_cost    NUMERIC(14,2) NOT NULL DEFAULT 0,
    cancelled_at  TIMESTAMPTZ,
    cancelled_by  TEXT,
    cancel_reason TEXT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (business_id, number)
);
CREATE INDEX IF NOT EXISTS idx_sales_deliveries_order ON public.sales_deliveries(order_id);

CREATE TABLE IF NOT EXISTS public.sales_delivery_lines (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    delivery_id   UUID NOT NULL REFERENCES public.sales_deliveries(id) ON DELETE CASCADE,
    business_id   UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    order_line_id UUID NOT NULL REFERENCES public.sales_order_lines(id) ON DELETE CASCADE,
    product_id    UUID REFERENCES public.products(id) ON DELETE SET NULL,
    name          TEXT NOT NULL,
    quantity      NUMERIC(14,3) NOT NULL CHECK (quantity > 0),
    unit_cost     NUMERIC(14,2) NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_sales_delivery_lines_delivery ON public.sales_delivery_lines(delivery_id);
CREATE INDEX IF NOT EXISTS idx_sales_delivery_lines_order_line ON public.sales_delivery_lines(order_line_id);

CREATE TABLE IF NOT EXISTS public.sales_invoices (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id     UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    number          TEXT NOT NULL,
    order_id        UUID REFERENCES public.sales_orders(id) ON DELETE SET NULL,
    customer_id     UUID REFERENCES public.customers(id) ON DELETE SET NULL,
    customer_name   TEXT NOT NULL,
    customer_phone  TEXT,
    issue_date      DATE NOT NULL,
    terms_days      INTEGER NOT NULL DEFAULT 0 CHECK (terms_days BETWEEN 0 AND 365),
    due_date        DATE NOT NULL,
    notes           TEXT,
    subtotal        NUMERIC(14,2) NOT NULL DEFAULT 0,
    vat_total       NUMERIC(14,2) NOT NULL DEFAULT 0,
    delivery_fee    NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (delivery_fee >= 0),
    total           NUMERIC(14,2) NOT NULL DEFAULT 0,
    amount_paid     NUMERIC(14,2) NOT NULL DEFAULT 0,
    amount_credited NUMERIC(14,2) NOT NULL DEFAULT 0,
    amount_refunded NUMERIC(14,2) NOT NULL DEFAULT 0,
    -- What is still owed: credit notes that gave money back don't lower it twice.
    balance         NUMERIC(14,2) GENERATED ALWAYS AS (total - amount_paid - amount_credited + amount_refunded) STORED,
    status          TEXT NOT NULL DEFAULT 'unpaid' CHECK (status IN ('unpaid', 'part_paid', 'paid', 'credited', 'void')),
    created_by      TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    voided_at       TIMESTAMPTZ,
    voided_by       TEXT,
    void_reason     TEXT,
    UNIQUE (business_id, number)
);
CREATE INDEX IF NOT EXISTS idx_sales_invoices_business ON public.sales_invoices(business_id, issue_date DESC);
CREATE INDEX IF NOT EXISTS idx_sales_invoices_customer ON public.sales_invoices(customer_id);
CREATE INDEX IF NOT EXISTS idx_sales_invoices_order ON public.sales_invoices(order_id);

CREATE TABLE IF NOT EXISTS public.sales_invoice_lines (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    invoice_id    UUID NOT NULL REFERENCES public.sales_invoices(id) ON DELETE CASCADE,
    business_id   UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    order_line_id UUID REFERENCES public.sales_order_lines(id) ON DELETE SET NULL,
    position      INTEGER NOT NULL DEFAULT 0,
    product_id    UUID REFERENCES public.products(id) ON DELETE SET NULL,
    name          TEXT NOT NULL,
    unit          TEXT,
    quantity      NUMERIC(14,3) NOT NULL CHECK (quantity > 0),
    unit_price    NUMERIC(14,2) NOT NULL CHECK (unit_price >= 0),
    discount_pct  NUMERIC(5,2) NOT NULL DEFAULT 0,
    vat_rate      NUMERIC(5,2) NOT NULL DEFAULT 0,
    line_net      NUMERIC(14,2) NOT NULL,
    line_vat      NUMERIC(14,2) NOT NULL,
    line_total    NUMERIC(14,2) NOT NULL,
    qty_credited  NUMERIC(14,3) NOT NULL DEFAULT 0 CHECK (qty_credited >= 0)
);
CREATE INDEX IF NOT EXISTS idx_sales_invoice_lines_invoice ON public.sales_invoice_lines(invoice_id);

CREATE TABLE IF NOT EXISTS public.invoice_payments (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    invoice_id  UUID NOT NULL REFERENCES public.sales_invoices(id) ON DELETE CASCADE,
    payment_id  UUID REFERENCES public.payments(id) ON DELETE SET NULL,
    amount      NUMERIC(14,2) NOT NULL CHECK (amount > 0),
    method      TEXT NOT NULL,
    reference   TEXT,
    paid_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    recorded_by TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    voided_at   TIMESTAMPTZ,
    voided_by   TEXT,
    void_reason TEXT
);
CREATE INDEX IF NOT EXISTS idx_invoice_payments_invoice ON public.invoice_payments(invoice_id);
CREATE INDEX IF NOT EXISTS idx_invoice_payments_payment ON public.invoice_payments(payment_id);

CREATE TABLE IF NOT EXISTS public.credit_notes (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id    UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    number         TEXT NOT NULL,
    invoice_id     UUID REFERENCES public.sales_invoices(id) ON DELETE SET NULL,
    transaction_id UUID REFERENCES public.transactions(id) ON DELETE SET NULL,
    customer_id    UUID REFERENCES public.customers(id) ON DELETE SET NULL,
    customer_name  TEXT NOT NULL,
    issue_date     DATE NOT NULL,
    reason         TEXT NOT NULL,
    -- reduce: less owed on the invoice · refund: money back · wallet: into the customer's
    -- wallet · debt: less debt on a till credit sale
    settlement     TEXT NOT NULL CHECK (settlement IN ('reduce', 'refund', 'wallet', 'debt')),
    refund_method  TEXT CHECK (refund_method IS NULL OR refund_method IN ('Cash', 'M-Pesa', 'Airtel Money', 'Card', 'Bank')),
    return_stock   BOOLEAN NOT NULL DEFAULT FALSE,
    subtotal       NUMERIC(14,2) NOT NULL DEFAULT 0,
    vat_total      NUMERIC(14,2) NOT NULL DEFAULT 0,
    total          NUMERIC(14,2) NOT NULL DEFAULT 0,
    cost_total     NUMERIC(14,2) NOT NULL DEFAULT 0,
    created_by     TEXT,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (business_id, number),
    CHECK ((invoice_id IS NULL) <> (transaction_id IS NULL) OR (invoice_id IS NULL AND transaction_id IS NULL))
);
CREATE INDEX IF NOT EXISTS idx_credit_notes_business ON public.credit_notes(business_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_credit_notes_invoice ON public.credit_notes(invoice_id);
CREATE INDEX IF NOT EXISTS idx_credit_notes_transaction ON public.credit_notes(transaction_id);

CREATE TABLE IF NOT EXISTS public.credit_note_lines (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    credit_note_id      UUID NOT NULL REFERENCES public.credit_notes(id) ON DELETE CASCADE,
    business_id         UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    invoice_line_id     UUID REFERENCES public.sales_invoice_lines(id) ON DELETE SET NULL,
    transaction_item_id UUID REFERENCES public.transaction_items(id) ON DELETE SET NULL,
    product_id          UUID REFERENCES public.products(id) ON DELETE SET NULL,
    name                TEXT NOT NULL,
    quantity            NUMERIC(14,3) NOT NULL CHECK (quantity > 0),
    line_net            NUMERIC(14,2) NOT NULL,
    line_vat            NUMERIC(14,2) NOT NULL,
    line_total          NUMERIC(14,2) NOT NULL,
    unit_cost           NUMERIC(14,2) NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_credit_note_lines_note ON public.credit_note_lines(credit_note_id);
CREATE INDEX IF NOT EXISTS idx_credit_note_lines_invoice_line ON public.credit_note_lines(invoice_line_id);
CREATE INDEX IF NOT EXISTS idx_credit_note_lines_item ON public.credit_note_lines(transaction_item_id);

-- Read rules. Every change goes through the functions below.
ALTER TABLE public.doc_counters         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quotes               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quote_lines          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales_orders         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales_order_lines    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales_deliveries     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales_delivery_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales_invoices       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales_invoice_lines  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoice_payments     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.credit_notes         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.credit_note_lines    ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN SELECT * FROM (VALUES
        ('quotes',               '''quotes.view'', ''quotes.manage'''),
        ('quote_lines',          '''quotes.view'', ''quotes.manage'''),
        ('sales_orders',         '''sales_orders.view'', ''sales_orders.manage'''),
        ('sales_order_lines',    '''sales_orders.view'', ''sales_orders.manage'''),
        ('sales_deliveries',     '''sales_orders.view'', ''sales_orders.manage'''),
        ('sales_delivery_lines', '''sales_orders.view'', ''sales_orders.manage'''),
        ('sales_invoices',       '''invoices.view'', ''invoices.manage'''),
        ('sales_invoice_lines',  '''invoices.view'', ''invoices.manage'''),
        ('invoice_payments',     '''invoices.view'', ''invoices.manage'''),
        ('credit_notes',         '''invoices.view'', ''invoices.manage'', ''refunds.create'', ''orders.view'''),
        ('credit_note_lines',    '''invoices.view'', ''invoices.manage'', ''refunds.create'', ''orders.view''')
    ) AS t(tbl, perms) LOOP
        EXECUTE format('DROP POLICY IF EXISTS pol_%1$s_select ON public.%1$I', r.tbl);
        EXECUTE format('CREATE POLICY pol_%1$s_select ON public.%1$I FOR SELECT USING (business_id = ANY(public.get_user_business_ids()) AND public.has_permission(business_id, %2$s))', r.tbl, r.perms);
    END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 2. Helpers
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sd_today()
RETURNS DATE
LANGUAGE sql
STABLE
AS $$
    SELECT (NOW() AT TIME ZONE 'Africa/Nairobi')::DATE;
$$;

-- Next number for a kind of document, e.g. INV-2026-0007. Taken inside the caller's
-- transaction: a document that fails to save gives its number back.
CREATE OR REPLACE FUNCTION public.sd_next_no(p_business_id UUID, p_kind TEXT, p_date DATE DEFAULT NULL)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_year INTEGER := EXTRACT(YEAR FROM COALESCE(p_date, public.sd_today()))::INTEGER;
    v_no   INTEGER;
BEGIN
    INSERT INTO public.doc_counters (business_id, kind, year, last_no)
    VALUES (p_business_id, p_kind, v_year, 1)
    ON CONFLICT (business_id, kind, year) DO UPDATE SET last_no = public.doc_counters.last_no + 1
    RETURNING last_no INTO v_no;
    RETURN p_kind || '-' || v_year || '-' || lpad(v_no::TEXT, 4, '0');
END;
$$;

-- Checks and prices a list of lines from the app:
-- [{productId?, name, unit?, quantity, unitPrice, discountPct?, vatRate?}]
-- Returns the same list with name/unit filled from the product and line_net, line_vat,
-- line_total worked out (prices are before VAT; VAT is added on top, as at the till).
CREATE OR REPLACE FUNCTION public.sd_norm_lines(p_business_id UUID, p_lines JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_el    JSONB;
    v_pos   INTEGER := 0;
    v_out   JSONB := '[]'::JSONB;
    v_pid   UUID;
    v_name  TEXT;
    v_unit  TEXT;
    v_pname TEXT;
    v_punit TEXT;
    v_qty   NUMERIC;
    v_price NUMERIC;
    v_disc  NUMERIC;
    v_vat   NUMERIC;
    v_net   NUMERIC;
    v_tax   NUMERIC;
BEGIN
    IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) = 0 THEN
        RAISE EXCEPTION 'Add at least one item.';
    END IF;
    IF jsonb_array_length(p_lines) > 200 THEN
        RAISE EXCEPTION 'A document can have at most 200 items.';
    END IF;
    FOR v_el IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
        v_pos := v_pos + 1;
        v_pid := NULLIF(v_el->>'productId', '')::UUID;
        v_pname := NULL;
        v_punit := NULL;
        IF v_pid IS NOT NULL THEN
            SELECT name, unit INTO v_pname, v_punit FROM public.products
            WHERE id = v_pid AND business_id = p_business_id;
            IF NOT FOUND THEN
                RAISE EXCEPTION 'Item % is not a product of this branch.', v_pos;
            END IF;
        END IF;
        v_name  := left(COALESCE(NULLIF(trim(v_el->>'name'), ''), v_pname, ''), 200);
        v_unit  := left(COALESCE(NULLIF(trim(v_el->>'unit'), ''), v_punit), 20);
        v_qty   := round(COALESCE(NULLIF(v_el->>'quantity', '')::NUMERIC, 0), 3);
        v_price := round(COALESCE(NULLIF(v_el->>'unitPrice', '')::NUMERIC, 0), 2);
        v_disc  := round(COALESCE(NULLIF(v_el->>'discountPct', '')::NUMERIC, 0), 2);
        v_vat   := COALESCE(NULLIF(v_el->>'vatRate', '')::NUMERIC, 0);
        IF v_name = '' THEN
            RAISE EXCEPTION 'Item % needs a name.', v_pos;
        ELSIF v_qty <= 0 THEN
            RAISE EXCEPTION '% needs a quantity above zero.', v_name;
        ELSIF v_price < 0 THEN
            RAISE EXCEPTION '% can''t have a price below zero.', v_name;
        ELSIF v_disc < 0 OR v_disc > 100 THEN
            RAISE EXCEPTION 'The discount on % must be between 0 and 100%%.', v_name;
        ELSIF v_vat NOT IN (0, 8, 16) THEN
            RAISE EXCEPTION 'VAT on % must be 0%%, 8%% or 16%%.', v_name;
        END IF;
        v_net := round(v_qty * v_price * (1 - v_disc / 100), 2);
        v_tax := round(v_net * v_vat / 100, 2);
        v_out := v_out || jsonb_build_array(jsonb_build_object(
            'position', v_pos, 'product_id', v_pid, 'name', v_name, 'unit', v_unit,
            'quantity', v_qty, 'unit_price', v_price, 'discount_pct', v_disc, 'vat_rate', v_vat,
            'line_net', v_net, 'line_vat', v_tax, 'line_total', v_net + v_tax));
    END LOOP;
    RETURN v_out;
END;
$$;

-- The customer behind a document: the merged-into record if it was merged.
CREATE OR REPLACE FUNCTION public.sd_customer(p_business_id UUID, p_customer_id UUID)
RETURNS public.customers
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_c public.customers%ROWTYPE;
BEGIN
    IF p_customer_id IS NULL THEN
        RETURN NULL;
    END IF;
    SELECT * INTO v_c FROM public.customers WHERE id = p_customer_id AND business_id = p_business_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'That customer was not found in this branch.';
    END IF;
    IF v_c.merged_into_id IS NOT NULL THEN
        SELECT * INTO v_c FROM public.customers WHERE id = v_c.merged_into_id;
    END IF;
    RETURN v_c;
END;
$$;

-- Days to pay from the customer's usual terms (pay now / weekly / monthly).
CREATE OR REPLACE FUNCTION public.sd_terms_days(p_terms TEXT)
RETURNS INTEGER
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT CASE p_terms WHEN 'weekly' THEN 7 WHEN 'monthly' THEN 30 ELSE 0 END;
$$;

-- ---------------------------------------------------------------------------
-- 3. Quotes
-- ---------------------------------------------------------------------------
-- p_doc: {customerId?, customerName, customerPhone?, issueDate?, validUntil?, notes?, terms?,
--         deliveryFee?, lines: [...]}
CREATE OR REPLACE FUNCTION public.save_quote(p_business_id UUID, p_id UUID, p_doc JSONB)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_q     public.quotes%ROWTYPE;
    v_c     public.customers%ROWTYPE;
    v_lines JSONB;
    v_name  TEXT;
    v_issue DATE := COALESCE(NULLIF(p_doc->>'issueDate', '')::DATE, public.sd_today());
    v_valid DATE := COALESCE(NULLIF(p_doc->>'validUntil', '')::DATE, v_issue + 14);
    v_fee   NUMERIC := round(COALESCE(NULLIF(p_doc->>'deliveryFee', '')::NUMERIC, 0), 2);
    v_id    UUID := p_id;
BEGIN
    PERFORM public.assert_business_member(p_business_id);
    PERFORM public.assert_permission(p_business_id, 'quotes.manage');
    v_c := public.sd_customer(p_business_id, NULLIF(p_doc->>'customerId', '')::UUID);
    v_name := COALESCE(NULLIF(trim(p_doc->>'customerName'), ''), v_c.name);
    IF v_name IS NULL THEN
        RAISE EXCEPTION 'Choose or type who the quote is for.';
    END IF;
    IF v_valid < v_issue THEN
        RAISE EXCEPTION '"Valid until" can''t be before the quote date.';
    END IF;
    IF v_fee < 0 THEN
        RAISE EXCEPTION 'The delivery fee can''t be below zero.';
    END IF;
    v_lines := public.sd_norm_lines(p_business_id, p_doc->'lines');

    IF v_id IS NULL THEN
        INSERT INTO public.quotes (business_id, number, customer_id, customer_name, customer_phone, issue_date, valid_until,
                                   notes, terms, delivery_fee, created_by)
        VALUES (p_business_id, public.sd_next_no(p_business_id, 'QT', v_issue), v_c.id, left(v_name, 120),
                left(COALESCE(NULLIF(trim(p_doc->>'customerPhone'), ''), v_c.phone), 30), v_issue, v_valid,
                left(NULLIF(trim(p_doc->>'notes'), ''), 1000), left(NULLIF(trim(p_doc->>'terms'), ''), 1000), v_fee, public.acc_who())
        RETURNING id INTO v_id;
    ELSE
        SELECT * INTO v_q FROM public.quotes WHERE id = v_id AND business_id = p_business_id FOR UPDATE;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'That quote was not found.';
        END IF;
        IF v_q.status NOT IN ('draft', 'sent') THEN
            RAISE EXCEPTION 'An accepted or declined quote can''t be changed.';
        END IF;
        UPDATE public.quotes
        SET customer_id = v_c.id, customer_name = left(v_name, 120),
            customer_phone = left(COALESCE(NULLIF(trim(p_doc->>'customerPhone'), ''), v_c.phone), 30),
            issue_date = v_issue, valid_until = v_valid,
            notes = left(NULLIF(trim(p_doc->>'notes'), ''), 1000), terms = left(NULLIF(trim(p_doc->>'terms'), ''), 1000),
            delivery_fee = v_fee, updated_at = NOW()
        WHERE id = v_id;
        DELETE FROM public.quote_lines WHERE quote_id = v_id;
    END IF;

    INSERT INTO public.quote_lines (quote_id, business_id, position, product_id, name, unit, quantity, unit_price,
                                    discount_pct, vat_rate, line_net, line_vat, line_total)
    SELECT v_id, p_business_id, l.position, l.product_id, l.name, l.unit, l.quantity, l.unit_price,
           l.discount_pct, l.vat_rate, l.line_net, l.line_vat, l.line_total
    FROM jsonb_to_recordset(v_lines) AS l(position INTEGER, product_id UUID, name TEXT, unit TEXT, quantity NUMERIC,
         unit_price NUMERIC, discount_pct NUMERIC, vat_rate NUMERIC, line_net NUMERIC, line_vat NUMERIC, line_total NUMERIC);

    UPDATE public.quotes q
    SET subtotal = s.net, vat_total = s.vat, total = s.net + s.vat + q.delivery_fee
    FROM (SELECT COALESCE(SUM(line_net), 0) AS net, COALESCE(SUM(line_vat), 0) AS vat FROM public.quote_lines WHERE quote_id = v_id) s
    WHERE q.id = v_id;
    RETURN v_id;
END;
$$;

-- sent, declined, or back to draft. Accepting is quote_to_order().
CREATE OR REPLACE FUNCTION public.set_quote_status(p_id UUID, p_status TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_q public.quotes%ROWTYPE;
BEGIN
    SELECT * INTO v_q FROM public.quotes WHERE id = p_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'That quote was not found.';
    END IF;
    PERFORM public.assert_business_member(v_q.business_id);
    PERFORM public.assert_permission(v_q.business_id, 'quotes.manage');
    IF v_q.status = 'accepted' THEN
        RAISE EXCEPTION 'This quote was accepted and is now order-based; change the order instead.';
    END IF;
    IF p_status = 'sent' THEN
        UPDATE public.quotes SET status = 'sent', sent_at = COALESCE(sent_at, NOW()), updated_at = NOW() WHERE id = p_id;
    ELSIF p_status = 'declined' THEN
        UPDATE public.quotes SET status = 'declined', decided_at = NOW(), updated_at = NOW() WHERE id = p_id;
    ELSIF p_status = 'draft' THEN
        UPDATE public.quotes SET status = 'draft', decided_at = NULL, updated_at = NOW() WHERE id = p_id;
    ELSE
        RAISE EXCEPTION 'A quote can be sent, declined or put back to draft.';
    END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_quote(p_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_q public.quotes%ROWTYPE;
BEGIN
    SELECT * INTO v_q FROM public.quotes WHERE id = p_id FOR UPDATE;
    IF NOT FOUND THEN
        RETURN;
    END IF;
    PERFORM public.assert_business_member(v_q.business_id);
    PERFORM public.assert_permission(v_q.business_id, 'quotes.manage');
    IF v_q.status = 'accepted' THEN
        RAISE EXCEPTION 'An accepted quote has an order and can''t be deleted.';
    END IF;
    DELETE FROM public.quotes WHERE id = p_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- 4. Sales orders
-- ---------------------------------------------------------------------------
-- Works out an order's status from what was delivered, invoiced and paid.
CREATE OR REPLACE FUNCTION public.sd_order_refresh(p_order_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_status  TEXT;
    v_ordered NUMERIC;
    v_deliv   NUMERIC;
    v_full_d  BOOLEAN;
    v_full_i  BOOLEAN;
    v_open    NUMERIC;
BEGIN
    SELECT status INTO v_status FROM public.sales_orders WHERE id = p_order_id;
    IF NOT FOUND OR v_status = 'cancelled' THEN
        RETURN;
    END IF;
    SELECT COALESCE(SUM(quantity), 0), COALESCE(SUM(LEAST(qty_delivered, quantity)), 0),
           COALESCE(bool_and(qty_delivered >= quantity), FALSE), COALESCE(bool_and(qty_invoiced >= quantity), FALSE)
    INTO v_ordered, v_deliv, v_full_d, v_full_i
    FROM public.sales_order_lines WHERE order_id = p_order_id;
    SELECT COALESCE(SUM(balance), 0) INTO v_open
    FROM public.sales_invoices WHERE order_id = p_order_id AND status <> 'void';

    v_status := CASE
        WHEN v_full_i AND v_open <= 0 THEN 'paid'
        WHEN v_full_i THEN 'invoiced'
        WHEN v_full_d THEN 'delivered'
        WHEN v_deliv > 0 THEN 'part_delivered'
        ELSE 'confirmed' END;
    UPDATE public.sales_orders SET status = v_status, updated_at = NOW()
    WHERE id = p_order_id AND status IS DISTINCT FROM v_status;
END;
$$;

CREATE OR REPLACE FUNCTION public.sd_order_totals(p_order_id UUID)
RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
    UPDATE public.sales_orders o
    SET subtotal = s.net, vat_total = s.vat, total = s.net + s.vat + o.delivery_fee
    FROM (SELECT COALESCE(SUM(line_net), 0) AS net, COALESCE(SUM(line_vat), 0) AS vat
          FROM public.sales_order_lines WHERE order_id = p_order_id) s
    WHERE o.id = p_order_id;
$$;

-- New order, or change one that nothing was delivered or invoiced on yet.
-- p_doc: {customerId?, customerName, customerPhone?, orderDate?, expectedDate?, notes?, terms?, deliveryFee?, lines}
CREATE OR REPLACE FUNCTION public.save_sales_order(p_business_id UUID, p_id UUID, p_doc JSONB)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_o     public.sales_orders%ROWTYPE;
    v_c     public.customers%ROWTYPE;
    v_lines JSONB;
    v_name  TEXT;
    v_date  DATE := COALESCE(NULLIF(p_doc->>'orderDate', '')::DATE, public.sd_today());
    v_fee   NUMERIC := round(COALESCE(NULLIF(p_doc->>'deliveryFee', '')::NUMERIC, 0), 2);
    v_id    UUID := p_id;
BEGIN
    PERFORM public.assert_business_member(p_business_id);
    PERFORM public.assert_permission(p_business_id, 'sales_orders.manage');
    v_c := public.sd_customer(p_business_id, NULLIF(p_doc->>'customerId', '')::UUID);
    v_name := COALESCE(NULLIF(trim(p_doc->>'customerName'), ''), v_c.name);
    IF v_name IS NULL THEN
        RAISE EXCEPTION 'Choose or type who the order is for.';
    END IF;
    IF v_fee < 0 THEN
        RAISE EXCEPTION 'The delivery fee can''t be below zero.';
    END IF;
    v_lines := public.sd_norm_lines(p_business_id, p_doc->'lines');

    IF v_id IS NULL THEN
        INSERT INTO public.sales_orders (business_id, number, customer_id, customer_name, customer_phone, order_date,
                                         expected_date, notes, terms, delivery_fee, created_by)
        VALUES (p_business_id, public.sd_next_no(p_business_id, 'SO', v_date), v_c.id, left(v_name, 120),
                left(COALESCE(NULLIF(trim(p_doc->>'customerPhone'), ''), v_c.phone), 30), v_date,
                NULLIF(p_doc->>'expectedDate', '')::DATE, left(NULLIF(trim(p_doc->>'notes'), ''), 1000),
                left(NULLIF(trim(p_doc->>'terms'), ''), 1000), v_fee, public.acc_who())
        RETURNING id INTO v_id;
    ELSE
        SELECT * INTO v_o FROM public.sales_orders WHERE id = v_id AND business_id = p_business_id FOR UPDATE;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'That order was not found.';
        END IF;
        IF v_o.status = 'cancelled' THEN
            RAISE EXCEPTION 'A cancelled order can''t be changed.';
        END IF;
        IF EXISTS (SELECT 1 FROM public.sales_order_lines WHERE order_id = v_id AND (qty_delivered > 0 OR qty_invoiced > 0)) THEN
            RAISE EXCEPTION 'Part of this order was delivered or invoiced, so its items can''t be changed.';
        END IF;
        UPDATE public.sales_orders
        SET customer_id = v_c.id, customer_name = left(v_name, 120),
            customer_phone = left(COALESCE(NULLIF(trim(p_doc->>'customerPhone'), ''), v_c.phone), 30),
            order_date = v_date, expected_date = NULLIF(p_doc->>'expectedDate', '')::DATE,
            notes = left(NULLIF(trim(p_doc->>'notes'), ''), 1000), terms = left(NULLIF(trim(p_doc->>'terms'), ''), 1000),
            delivery_fee = v_fee, updated_at = NOW()
        WHERE id = v_id;
        DELETE FROM public.sales_order_lines WHERE order_id = v_id;
    END IF;

    INSERT INTO public.sales_order_lines (order_id, business_id, position, product_id, name, unit, quantity, unit_price,
                                          discount_pct, vat_rate, line_net, line_vat, line_total)
    SELECT v_id, p_business_id, l.position, l.product_id, l.name, l.unit, l.quantity, l.unit_price,
           l.discount_pct, l.vat_rate, l.line_net, l.line_vat, l.line_total
    FROM jsonb_to_recordset(v_lines) AS l(position INTEGER, product_id UUID, name TEXT, unit TEXT, quantity NUMERIC,
         unit_price NUMERIC, discount_pct NUMERIC, vat_rate NUMERIC, line_net NUMERIC, line_vat NUMERIC, line_total NUMERIC);
    PERFORM public.sd_order_totals(v_id);
    RETURN v_id;
END;
$$;

-- The customer said yes: a sales order with the quote's lines and prices.
CREATE OR REPLACE FUNCTION public.quote_to_order(p_quote_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_q  public.quotes%ROWTYPE;
    v_id UUID;
BEGIN
    SELECT * INTO v_q FROM public.quotes WHERE id = p_quote_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'That quote was not found.';
    END IF;
    PERFORM public.assert_business_member(v_q.business_id);
    PERFORM public.assert_permission(v_q.business_id, 'quotes.manage');
    PERFORM public.assert_permission(v_q.business_id, 'sales_orders.manage');
    IF v_q.status = 'accepted' THEN
        RETURN v_q.order_id;
    ELSIF v_q.status = 'declined' THEN
        RAISE EXCEPTION 'This quote was declined. Put it back to draft first.';
    END IF;

    INSERT INTO public.sales_orders (business_id, number, quote_id, customer_id, customer_name, customer_phone, order_date,
                                     notes, terms, delivery_fee, created_by)
    VALUES (v_q.business_id, public.sd_next_no(v_q.business_id, 'SO'), v_q.id, v_q.customer_id, v_q.customer_name,
            v_q.customer_phone, public.sd_today(), v_q.notes, v_q.terms, v_q.delivery_fee, public.acc_who())
    RETURNING id INTO v_id;
    INSERT INTO public.sales_order_lines (order_id, business_id, position, product_id, name, unit, quantity, unit_price,
                                          discount_pct, vat_rate, line_net, line_vat, line_total)
    SELECT v_id, business_id, position, product_id, name, unit, quantity, unit_price, discount_pct, vat_rate,
           line_net, line_vat, line_total
    FROM public.quote_lines WHERE quote_id = v_q.id;
    PERFORM public.sd_order_totals(v_id);
    UPDATE public.quotes SET status = 'accepted', decided_at = NOW(), order_id = v_id, updated_at = NOW() WHERE id = v_q.id;
    RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.cancel_sales_order(p_id UUID, p_reason TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_o public.sales_orders%ROWTYPE;
BEGIN
    SELECT * INTO v_o FROM public.sales_orders WHERE id = p_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'That order was not found.';
    END IF;
    PERFORM public.assert_business_member(v_o.business_id);
    PERFORM public.assert_permission(v_o.business_id, 'sales_orders.manage');
    IF v_o.status = 'cancelled' THEN
        RETURN;
    END IF;
    IF EXISTS (SELECT 1 FROM public.sales_order_lines WHERE order_id = p_id AND (qty_delivered > 0 OR qty_invoiced > 0)) THEN
        RAISE EXCEPTION 'Undo its deliveries and void its invoices first; then the order can be cancelled.';
    END IF;
    UPDATE public.sales_orders
    SET status = 'cancelled', cancelled_at = NOW(), cancelled_by = public.acc_who(),
        cancel_reason = left(NULLIF(trim(p_reason), ''), 300), updated_at = NOW()
    WHERE id = p_id;
END;
$$;

-- Deliver some or all of an order. p_lines: [{lineId, quantity}], or NULL for everything
-- not yet delivered. Takes stock out now and remembers each item's cost.
CREATE OR REPLACE FUNCTION public.deliver_sales_order(p_order_id UUID, p_lines JSONB, p_note TEXT DEFAULT NULL)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_o     public.sales_orders%ROWTYPE;
    v_l     public.sales_order_lines%ROWTYPE;
    v_id    UUID;
    v_no    TEXT;
    v_qty   NUMERIC;
    v_old   NUMERIC;
    v_cost  NUMERIC;
    v_pname TEXT;
    v_count INTEGER := 0;
    v_who   TEXT := public.acc_who();
BEGIN
    SELECT * INTO v_o FROM public.sales_orders WHERE id = p_order_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'That order was not found.';
    END IF;
    PERFORM public.assert_business_member(v_o.business_id);
    PERFORM public.assert_permission(v_o.business_id, 'sales_orders.manage');
    IF v_o.status = 'cancelled' THEN
        RAISE EXCEPTION 'This order was cancelled.';
    END IF;

    v_no := public.sd_next_no(v_o.business_id, 'DN');
    INSERT INTO public.sales_deliveries (business_id, order_id, number, delivered_by, note)
    VALUES (v_o.business_id, v_o.id, v_no, v_who, left(NULLIF(trim(p_note), ''), 500))
    RETURNING id INTO v_id;

    FOR v_l IN SELECT * FROM public.sales_order_lines WHERE order_id = p_order_id ORDER BY position FOR UPDATE LOOP
        IF p_lines IS NULL THEN
            v_qty := GREATEST(v_l.quantity - v_l.qty_delivered, 0);
        ELSE
            SELECT round(COALESCE(SUM(NULLIF(x->>'quantity', '')::NUMERIC), 0), 3) INTO v_qty
            FROM jsonb_array_elements(p_lines) x WHERE x->>'lineId' = v_l.id::TEXT;
        END IF;
        CONTINUE WHEN v_qty <= 0;
        IF v_l.qty_delivered + v_qty > v_l.quantity THEN
            RAISE EXCEPTION 'Only % % of % is left to deliver.', v_l.quantity - v_l.qty_delivered, COALESCE(v_l.unit, ''), v_l.name;
        END IF;
        v_cost := 0;
        IF v_l.product_id IS NOT NULL THEN
            SELECT stock, COALESCE(cost, 0), name INTO v_old, v_cost, v_pname
            FROM public.products WHERE id = v_l.product_id FOR UPDATE;
            IF FOUND THEN
                UPDATE public.products SET stock = GREATEST(0, v_old - v_qty), updated_at = NOW() WHERE id = v_l.product_id;
                INSERT INTO public.inventory_adjustments (business_id, product_id, product_name, type, quantity_adjusted,
                    previous_stock, new_stock, reason, reference_number, staff_name, notes)
                VALUES (v_o.business_id, v_l.product_id, COALESCE(v_pname, v_l.name), 'Reconciliation', -v_qty,
                    v_old, GREATEST(0, v_old - v_qty), 'Sold', v_no, v_who, 'Order ' || v_o.number || ' · ' || v_o.customer_name);
            ELSE
                v_cost := 0;
            END IF;
        END IF;
        INSERT INTO public.sales_delivery_lines (delivery_id, business_id, order_line_id, product_id, name, quantity, unit_cost)
        VALUES (v_id, v_o.business_id, v_l.id, v_l.product_id, v_l.name, v_qty, round(COALESCE(v_cost, 0), 2));
        UPDATE public.sales_order_lines SET qty_delivered = qty_delivered + v_qty WHERE id = v_l.id;
        v_count := v_count + 1;
    END LOOP;

    IF v_count = 0 THEN
        RAISE EXCEPTION 'Nothing is left to deliver on this order.';
    END IF;
    UPDATE public.sales_deliveries d
    SET total_cost = (SELECT COALESCE(round(SUM(quantity * unit_cost), 2), 0) FROM public.sales_delivery_lines WHERE delivery_id = v_id)
    WHERE d.id = v_id;
    PERFORM public.sd_order_refresh(p_order_id);
    RETURN v_id;
END;
$$;

-- Undo a delivery: stock goes back and its entry in the books goes.
CREATE OR REPLACE FUNCTION public.cancel_sales_delivery(p_id UUID, p_reason TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_d   public.sales_deliveries%ROWTYPE;
    v_l   RECORD;
    v_old NUMERIC;
    v_who TEXT := public.acc_who();
BEGIN
    SELECT * INTO v_d FROM public.sales_deliveries WHERE id = p_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'That delivery was not found.';
    END IF;
    PERFORM public.assert_business_member(v_d.business_id);
    PERFORM public.assert_permission(v_d.business_id, 'sales_orders.manage');
    IF v_d.cancelled_at IS NOT NULL THEN
        RETURN;
    END IF;
    PERFORM 1 FROM public.sales_orders WHERE id = v_d.order_id FOR UPDATE;
    FOR v_l IN SELECT * FROM public.sales_delivery_lines WHERE delivery_id = p_id LOOP
        UPDATE public.sales_order_lines SET qty_delivered = GREATEST(qty_delivered - v_l.quantity, 0) WHERE id = v_l.order_line_id;
        IF v_l.product_id IS NOT NULL THEN
            SELECT stock INTO v_old FROM public.products WHERE id = v_l.product_id FOR UPDATE;
            IF FOUND THEN
                UPDATE public.products SET stock = v_old + v_l.quantity, updated_at = NOW() WHERE id = v_l.product_id;
                INSERT INTO public.inventory_adjustments (business_id, product_id, product_name, type, quantity_adjusted,
                    previous_stock, new_stock, reason, reference_number, staff_name)
                VALUES (v_d.business_id, v_l.product_id, v_l.name, 'Restock', v_l.quantity, v_old, v_old + v_l.quantity,
                    'Delivery undone', v_d.number, v_who);
            END IF;
        END IF;
    END LOOP;
    UPDATE public.sales_deliveries
    SET cancelled_at = NOW(), cancelled_by = v_who, cancel_reason = left(NULLIF(trim(p_reason), ''), 300)
    WHERE id = p_id;
    PERFORM public.sd_order_refresh(v_d.order_id);
END;
$$;

-- ---------------------------------------------------------------------------
-- 5. Invoices and payments
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sd_invoice_refresh(p_invoice_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_i       public.sales_invoices%ROWTYPE;
    v_paid    NUMERIC;
    v_cred    NUMERIC;
    v_refund  NUMERIC;
    v_status  TEXT;
    v_balance NUMERIC;
BEGIN
    SELECT * INTO v_i FROM public.sales_invoices WHERE id = p_invoice_id;
    IF NOT FOUND OR v_i.status = 'void' THEN
        RETURN;
    END IF;
    SELECT COALESCE(SUM(amount), 0) INTO v_paid FROM public.invoice_payments WHERE invoice_id = p_invoice_id AND voided_at IS NULL;
    SELECT COALESCE(SUM(total), 0), COALESCE(SUM(total) FILTER (WHERE settlement <> 'reduce'), 0)
    INTO v_cred, v_refund FROM public.credit_notes WHERE invoice_id = p_invoice_id;
    v_balance := v_i.total - v_paid - v_cred + v_refund;
    v_status := CASE
        WHEN v_balance <= 0 AND v_paid = 0 AND v_cred > 0 THEN 'credited'
        WHEN v_balance <= 0 THEN 'paid'
        WHEN v_paid > 0 THEN 'part_paid'
        ELSE 'unpaid' END;
    UPDATE public.sales_invoices
    SET amount_paid = v_paid, amount_credited = v_cred, amount_refunded = v_refund, status = v_status, updated_at = NOW()
    WHERE id = p_invoice_id;
    IF v_i.order_id IS NOT NULL THEN
        PERFORM public.sd_order_refresh(v_i.order_id);
    END IF;
END;
$$;

-- Invoice some or all of an order. p_lines: [{lineId, quantity}], or NULL for everything
-- not yet invoiced. The order's delivery fee goes on its first invoice.
CREATE OR REPLACE FUNCTION public.invoice_sales_order(
    p_order_id UUID, p_lines JSONB, p_issue_date DATE DEFAULT NULL, p_terms_days INTEGER DEFAULT NULL, p_notes TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_o     public.sales_orders%ROWTYPE;
    v_l     public.sales_order_lines%ROWTYPE;
    v_c     public.customers%ROWTYPE;
    v_id    UUID;
    v_qty   NUMERIC;
    v_net   NUMERIC;
    v_vat   NUMERIC;
    v_fee   NUMERIC := 0;
    v_count INTEGER := 0;
    v_issue DATE := COALESCE(p_issue_date, public.sd_today());
    v_terms INTEGER;
BEGIN
    SELECT * INTO v_o FROM public.sales_orders WHERE id = p_order_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'That order was not found.';
    END IF;
    PERFORM public.assert_business_member(v_o.business_id);
    PERFORM public.assert_permission(v_o.business_id, 'invoices.manage');
    IF v_o.status = 'cancelled' THEN
        RAISE EXCEPTION 'This order was cancelled.';
    END IF;
    IF v_o.customer_id IS NOT NULL THEN
        SELECT * INTO v_c FROM public.customers WHERE id = v_o.customer_id;
    END IF;
    v_terms := COALESCE(p_terms_days, public.sd_terms_days(v_c.payment_terms), 0);
    IF v_terms < 0 OR v_terms > 365 THEN
        RAISE EXCEPTION 'Payment terms are 0 to 365 days.';
    END IF;
    IF v_o.delivery_fee > 0 AND NOT EXISTS (
        SELECT 1 FROM public.sales_invoices WHERE order_id = p_order_id AND status <> 'void' AND delivery_fee > 0
    ) THEN
        v_fee := v_o.delivery_fee;
    END IF;

    INSERT INTO public.sales_invoices (business_id, number, order_id, customer_id, customer_name, customer_phone,
                                       issue_date, terms_days, due_date, notes, delivery_fee, created_by)
    VALUES (v_o.business_id, public.sd_next_no(v_o.business_id, 'INV', v_issue), v_o.id, v_o.customer_id, v_o.customer_name,
            v_o.customer_phone, v_issue, v_terms, v_issue + v_terms, left(NULLIF(trim(p_notes), ''), 1000), v_fee, public.acc_who())
    RETURNING id INTO v_id;

    FOR v_l IN SELECT * FROM public.sales_order_lines WHERE order_id = p_order_id ORDER BY position FOR UPDATE LOOP
        IF p_lines IS NULL THEN
            v_qty := GREATEST(v_l.quantity - v_l.qty_invoiced, 0);
        ELSE
            SELECT round(COALESCE(SUM(NULLIF(x->>'quantity', '')::NUMERIC), 0), 3) INTO v_qty
            FROM jsonb_array_elements(p_lines) x WHERE x->>'lineId' = v_l.id::TEXT;
        END IF;
        CONTINUE WHEN v_qty <= 0;
        IF v_l.qty_invoiced + v_qty > v_l.quantity THEN
            RAISE EXCEPTION 'Only % % of % is left to invoice.', v_l.quantity - v_l.qty_invoiced, COALESCE(v_l.unit, ''), v_l.name;
        END IF;
        -- The last part takes what is left, so the parts add up to the order to the cent.
        IF v_l.qty_invoiced + v_qty = v_l.quantity THEN
            SELECT v_l.line_net - COALESCE(SUM(il.line_net), 0), v_l.line_vat - COALESCE(SUM(il.line_vat), 0)
            INTO v_net, v_vat
            FROM public.sales_invoice_lines il JOIN public.sales_invoices i ON i.id = il.invoice_id
            WHERE il.order_line_id = v_l.id AND i.status <> 'void';
        ELSE
            v_net := round(v_l.line_net * v_qty / v_l.quantity, 2);
            v_vat := round(v_l.line_vat * v_qty / v_l.quantity, 2);
        END IF;
        INSERT INTO public.sales_invoice_lines (invoice_id, business_id, order_line_id, position, product_id, name, unit,
            quantity, unit_price, discount_pct, vat_rate, line_net, line_vat, line_total)
        VALUES (v_id, v_o.business_id, v_l.id, v_l.position, v_l.product_id, v_l.name, v_l.unit, v_qty, v_l.unit_price,
            v_l.discount_pct, v_l.vat_rate, v_net, v_vat, v_net + v_vat);
        UPDATE public.sales_order_lines SET qty_invoiced = qty_invoiced + v_qty WHERE id = v_l.id;
        v_count := v_count + 1;
    END LOOP;

    IF v_count = 0 THEN
        RAISE EXCEPTION 'Everything on this order is already invoiced.';
    END IF;
    UPDATE public.sales_invoices i
    SET subtotal = s.net, vat_total = s.vat, total = s.net + s.vat + i.delivery_fee
    FROM (SELECT COALESCE(SUM(line_net), 0) AS net, COALESCE(SUM(line_vat), 0) AS vat FROM public.sales_invoice_lines WHERE invoice_id = v_id) s
    WHERE i.id = v_id;
    PERFORM public.sd_invoice_refresh(v_id);
    RETURN v_id;
END;
$$;

-- An invoice made in error. Its number stays, marked void, so numbers have no gaps.
CREATE OR REPLACE FUNCTION public.void_sales_invoice(p_id UUID, p_reason TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_i public.sales_invoices%ROWTYPE;
    v_l RECORD;
BEGIN
    SELECT * INTO v_i FROM public.sales_invoices WHERE id = p_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'That invoice was not found.';
    END IF;
    PERFORM public.assert_business_member(v_i.business_id);
    PERFORM public.assert_permission(v_i.business_id, 'invoices.manage');
    IF v_i.status = 'void' THEN
        RETURN;
    END IF;
    IF NULLIF(trim(COALESCE(p_reason, '')), '') IS NULL THEN
        RAISE EXCEPTION 'Say why the invoice is void.';
    END IF;
    IF EXISTS (SELECT 1 FROM public.invoice_payments WHERE invoice_id = p_id AND voided_at IS NULL) THEN
        RAISE EXCEPTION 'This invoice has payments. Remove them first, or give a credit note instead.';
    END IF;
    IF EXISTS (SELECT 1 FROM public.credit_notes WHERE invoice_id = p_id) THEN
        RAISE EXCEPTION 'This invoice has a credit note, so it can''t be voided. Credit what is left instead.';
    END IF;
    IF v_i.order_id IS NOT NULL THEN
        PERFORM 1 FROM public.sales_orders WHERE id = v_i.order_id FOR UPDATE;
    END IF;
    FOR v_l IN SELECT * FROM public.sales_invoice_lines WHERE invoice_id = p_id AND order_line_id IS NOT NULL LOOP
        UPDATE public.sales_order_lines SET qty_invoiced = GREATEST(qty_invoiced - v_l.quantity, 0) WHERE id = v_l.order_line_id;
    END LOOP;
    UPDATE public.sales_invoices
    SET status = 'void', voided_at = NOW(), voided_by = public.acc_who(), void_reason = left(trim(p_reason), 300), updated_at = NOW()
    WHERE id = p_id;
    IF v_i.order_id IS NOT NULL THEN
        PERFORM public.sd_order_refresh(v_i.order_id);
    END IF;
END;
$$;

-- Money received for an invoice. Either a new payment (amount, method, reference such as
-- the M-Pesa code), or a payment already in Payments that isn't matched to anything
-- (p_payment_id). The amount can't be more than what is owed.
CREATE OR REPLACE FUNCTION public.record_invoice_payment(
    p_invoice_id UUID, p_amount NUMERIC, p_method TEXT, p_reference TEXT DEFAULT NULL,
    p_paid_at TIMESTAMPTZ DEFAULT NULL, p_payment_id UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_i      public.sales_invoices%ROWTYPE;
    v_py     public.payments%ROWTYPE;
    v_pid    UUID := p_payment_id;
    v_amount NUMERIC := round(COALESCE(p_amount, 0), 2);
    v_used   NUMERIC;
    v_ref    TEXT := NULLIF(upper(trim(COALESCE(p_reference, ''))), '');
    v_id     UUID;
    v_who    TEXT := public.acc_who();
BEGIN
    SELECT * INTO v_i FROM public.sales_invoices WHERE id = p_invoice_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'That invoice was not found.';
    END IF;
    PERFORM public.assert_business_member(v_i.business_id);
    PERFORM public.assert_permission(v_i.business_id, 'invoices.manage');
    IF v_i.status = 'void' THEN
        RAISE EXCEPTION 'This invoice is void.';
    END IF;
    IF v_i.balance <= 0 THEN
        RAISE EXCEPTION 'Nothing is owed on this invoice.';
    END IF;

    IF v_pid IS NULL THEN
        IF v_amount <= 0 THEN
            RAISE EXCEPTION 'Enter an amount above zero.';
        END IF;
        IF v_amount > v_i.balance THEN
            RAISE EXCEPTION 'Only % is owed on this invoice.', to_char(v_i.balance, 'FM999,999,990.00');
        END IF;
        -- A reference already in Payments (the same M-Pesa code) is that payment, not a new one.
        IF v_ref IS NOT NULL THEN
            SELECT id INTO v_pid FROM public.payments WHERE business_id = v_i.business_id AND reference_code = v_ref LIMIT 1;
        END IF;
        IF v_pid IS NULL THEN
            v_pid := public.process_business_payment(
                v_i.business_id, COALESCE(v_ref, 'INV-PAY-' || upper(left(replace(gen_random_uuid()::TEXT, '-', ''), 10))),
                v_amount, p_method, v_i.customer_name, v_i.customer_phone, 'Success', COALESCE(p_paid_at, NOW()),
                NULL, v_i.customer_name, 'walk-in', 'Invoice ' || v_i.number, v_who);
        END IF;
    END IF;

    SELECT * INTO v_py FROM public.payments WHERE id = v_pid AND business_id = v_i.business_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'That payment was not found in this branch.';
    END IF;
    IF v_py.status <> 'Success' THEN
        RAISE EXCEPTION 'Payment % is not a completed payment.', COALESCE(v_py.reference_code, '');
    END IF;
    IF COALESCE(v_py.debt_applied, 0) > 0 OR COALESCE(v_py.wallet_applied, 0) > 0 THEN
        RAISE EXCEPTION 'Payment % already went to a customer''s debt or wallet.', COALESCE(v_py.reference_code, '');
    END IF;
    SELECT COALESCE(SUM(amount), 0) INTO v_used FROM public.invoice_payments WHERE payment_id = v_pid AND voided_at IS NULL;
    IF v_amount <= 0 OR p_payment_id IS NOT NULL THEN
        v_amount := LEAST(v_py.amount - v_used, v_i.balance);
    END IF;
    IF v_amount <= 0 THEN
        RAISE EXCEPTION 'Payment % is already used in full.', COALESCE(v_py.reference_code, '');
    END IF;
    IF v_amount > v_py.amount - v_used THEN
        RAISE EXCEPTION 'Only % of payment % is still free.', to_char(v_py.amount - v_used, 'FM999,999,990.00'), COALESCE(v_py.reference_code, '');
    END IF;
    IF v_amount > v_i.balance THEN
        v_amount := v_i.balance;
    END IF;

    INSERT INTO public.invoice_payments (business_id, invoice_id, payment_id, amount, method, reference, paid_at, recorded_by)
    VALUES (v_i.business_id, v_i.id, v_pid, v_amount, v_py.method, v_py.reference_code, COALESCE(p_paid_at, v_py.date, NOW()), v_who)
    RETURNING id INTO v_id;
    PERFORM public.sd_invoice_refresh(v_i.id);
    RETURN v_id;
END;
$$;

-- Take a payment off an invoice. The money stays in Payments as not matched to a sale;
-- void it there if it never really came in.
CREATE OR REPLACE FUNCTION public.void_invoice_payment(p_id UUID, p_reason TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_p public.invoice_payments%ROWTYPE;
BEGIN
    SELECT * INTO v_p FROM public.invoice_payments WHERE id = p_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'That payment was not found.';
    END IF;
    PERFORM public.assert_business_member(v_p.business_id);
    PERFORM public.assert_permission(v_p.business_id, 'invoices.manage');
    IF v_p.voided_at IS NOT NULL THEN
        RETURN;
    END IF;
    PERFORM 1 FROM public.sales_invoices WHERE id = v_p.invoice_id FOR UPDATE;
    UPDATE public.invoice_payments
    SET voided_at = NOW(), voided_by = public.acc_who(), void_reason = left(NULLIF(trim(p_reason), ''), 300)
    WHERE id = p_id;
    PERFORM public.sd_invoice_refresh(v_p.invoice_id);
END;
$$;

-- A payment that pays an invoice can't be voided in Payments while it does.
CREATE OR REPLACE FUNCTION public.sd_guard_payment_void()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_no TEXT;
BEGIN
    IF NEW.status IS DISTINCT FROM OLD.status AND NEW.status <> 'Success' THEN
        SELECT i.number INTO v_no
        FROM public.invoice_payments ip JOIN public.sales_invoices i ON i.id = ip.invoice_id
        WHERE ip.payment_id = NEW.id AND ip.voided_at IS NULL LIMIT 1;
        IF v_no IS NOT NULL THEN
            RAISE EXCEPTION 'This payment pays invoice %. Take it off the invoice first.', v_no;
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sd_guard_payment_void ON public.payments;
CREATE TRIGGER trg_sd_guard_payment_void BEFORE UPDATE OF status ON public.payments
    FOR EACH ROW EXECUTE FUNCTION public.sd_guard_payment_void();

-- Set how many days a customer gets to pay, from the invoice form.
CREATE OR REPLACE FUNCTION public.set_customer_payment_terms(p_customer_id UUID, p_terms TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_b UUID;
BEGIN
    SELECT business_id INTO v_b FROM public.customers WHERE id = p_customer_id;
    IF v_b IS NULL THEN
        RAISE EXCEPTION 'That customer was not found.';
    END IF;
    PERFORM public.assert_business_member(v_b);
    PERFORM public.assert_permission(v_b, 'invoices.manage');
    IF p_terms NOT IN ('pay_now', 'weekly', 'monthly') THEN
        RAISE EXCEPTION 'Terms are pay now, weekly or monthly.';
    END IF;
    UPDATE public.customers SET payment_terms = p_terms, updated_at = NOW() WHERE id = p_customer_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- 6. Credit notes and refunds
-- ---------------------------------------------------------------------------
-- p_doc: {invoiceId | transactionId, lines: [{invoiceLineId | transactionItemId, quantity}],
--         reason, settlement: reduce|refund|wallet|debt, method?, returnStock?}
CREATE OR REPLACE FUNCTION public.create_credit_note(p_business_id UUID, p_doc JSONB)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_inv_id  UUID := NULLIF(p_doc->>'invoiceId', '')::UUID;
    v_tx_id   UUID := NULLIF(p_doc->>'transactionId', '')::UUID;
    v_set     TEXT := COALESCE(NULLIF(p_doc->>'settlement', ''), 'refund');
    v_method  TEXT := NULLIF(p_doc->>'method', '');
    v_reason  TEXT := left(NULLIF(trim(p_doc->>'reason'), ''), 300);
    v_stock   BOOLEAN := COALESCE((p_doc->>'returnStock')::BOOLEAN, FALSE);
    v_i       public.sales_invoices%ROWTYPE;
    v_t       public.transactions%ROWTYPE;
    v_cust    UUID;
    v_cname   TEXT;
    v_id      UUID;
    v_no      TEXT;
    v_el      JSONB;
    v_il      public.sales_invoice_lines%ROWTYPE;
    v_ti      public.transaction_items%ROWTYPE;
    v_qty     NUMERIC;
    v_done    NUMERIC;
    v_net     NUMERIC;
    v_vat     NUMERIC;
    v_cost    NUMERIC;
    v_factor  NUMERIC;
    v_rate    NUMERIC;
    v_total   NUMERIC;
    v_room    NUMERIC;
    v_old     NUMERIC;
    v_wallet  NUMERIC;
    v_debt    NUMERIC;
    v_cp      RECORD;
    v_who     TEXT := public.acc_who();
BEGIN
    PERFORM public.assert_business_member(p_business_id);
    IF v_reason IS NULL THEN
        RAISE EXCEPTION 'Say why (e.g. returned, damaged, wrong price).';
    END IF;
    IF jsonb_typeof(p_doc->'lines') IS DISTINCT FROM 'array' OR jsonb_array_length(p_doc->'lines') = 0 THEN
        RAISE EXCEPTION 'Tick at least one item to credit.';
    END IF;
    IF v_set NOT IN ('reduce', 'refund', 'wallet', 'debt') THEN
        RAISE EXCEPTION 'Choose how the customer gets it back.';
    END IF;
    IF v_set = 'refund' AND (v_method IS NULL OR v_method NOT IN ('Cash', 'M-Pesa', 'Airtel Money', 'Card', 'Bank')) THEN
        RAISE EXCEPTION 'Choose how the money is given back: Cash, M-Pesa, Airtel Money, Card or Bank.';
    END IF;
    IF v_set <> 'refund' THEN
        v_method := NULL;
    END IF;

    IF v_inv_id IS NOT NULL THEN
        SELECT * INTO v_i FROM public.sales_invoices WHERE id = v_inv_id AND business_id = p_business_id FOR UPDATE;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'That invoice was not found.';
        END IF;
        PERFORM public.assert_permission(p_business_id, 'invoices.manage');
        IF v_i.status = 'void' THEN
            RAISE EXCEPTION 'This invoice is void.';
        END IF;
        IF v_set NOT IN ('reduce', 'refund') THEN
            RAISE EXCEPTION 'An invoice is credited as less owed or as money back.';
        END IF;
        v_cust := v_i.customer_id;
        v_cname := v_i.customer_name;
    ELSIF v_tx_id IS NOT NULL THEN
        SELECT * INTO v_t FROM public.transactions WHERE id = v_tx_id AND business_id = p_business_id FOR UPDATE;
        IF NOT FOUND OR v_t.deleted_at IS NOT NULL THEN
            RAISE EXCEPTION 'That sale was not found.';
        END IF;
        IF NOT public.has_permission(p_business_id, 'refunds.create') THEN
            IF NOT public.has_permission(p_business_id, 'pos.cancel_sale')
               OR (v_t.timestamp AT TIME ZONE 'Africa/Nairobi')::DATE <> public.sd_today() THEN
                RAISE EXCEPTION 'You can refund only today''s sales. Ask a manager for older ones.';
            END IF;
        END IF;
        IF v_set = 'reduce' THEN
            RAISE EXCEPTION 'A till sale is refunded as money back, into the wallet, or off the customer''s debt.';
        END IF;
        IF v_set IN ('wallet', 'debt') AND v_t.customer_id IS NULL THEN
            RAISE EXCEPTION 'This sale has no customer. Give the money back instead.';
        END IF;
        v_cust := v_t.customer_id;
        v_cname := COALESCE(NULLIF(v_t.customer_name, ''), 'Walk-in');
        -- Shares of the cart discount and the VAT rate, as the till worked them out.
        SELECT CASE WHEN SUM(unit_price * quantity * (1 - discount_percentage / 100)) > 0
                    THEN (v_t.total - v_t.discount) / SUM(unit_price * quantity * (1 - discount_percentage / 100)) ELSE 0 END
        INTO v_factor FROM public.transaction_items WHERE transaction_id = v_tx_id;
        v_factor := LEAST(GREATEST(COALESCE(v_factor, 1), 0), 1);
        v_rate := CASE WHEN (v_t.total - v_t.discount) > 0 THEN COALESCE(v_t.tax, 0) / (v_t.total - v_t.discount) ELSE 0 END;
    ELSE
        RAISE EXCEPTION 'Choose the invoice or sale to credit.';
    END IF;

    v_no := public.sd_next_no(p_business_id, 'CN');
    INSERT INTO public.credit_notes (business_id, number, invoice_id, transaction_id, customer_id, customer_name, issue_date,
                                     reason, settlement, refund_method, return_stock, created_by)
    VALUES (p_business_id, v_no, v_inv_id, v_tx_id, v_cust, v_cname, public.sd_today(), v_reason, v_set, v_method, v_stock, v_who)
    RETURNING id INTO v_id;

    FOR v_el IN SELECT * FROM jsonb_array_elements(p_doc->'lines') LOOP
        v_qty := round(COALESCE(NULLIF(v_el->>'quantity', '')::NUMERIC, 0), 3);
        CONTINUE WHEN v_qty <= 0;
        IF v_inv_id IS NOT NULL THEN
            SELECT * INTO v_il FROM public.sales_invoice_lines
            WHERE id = NULLIF(v_el->>'invoiceLineId', '')::UUID AND invoice_id = v_inv_id FOR UPDATE;
            IF NOT FOUND THEN
                RAISE EXCEPTION 'An item is not on this invoice.';
            END IF;
            IF v_il.qty_credited + v_qty > v_il.quantity THEN
                RAISE EXCEPTION 'Only % of % is left to credit.', v_il.quantity - v_il.qty_credited, v_il.name;
            END IF;
            IF v_il.qty_credited + v_qty = v_il.quantity THEN
                SELECT v_il.line_net - COALESCE(SUM(line_net), 0), v_il.line_vat - COALESCE(SUM(line_vat), 0)
                INTO v_net, v_vat FROM public.credit_note_lines WHERE invoice_line_id = v_il.id;
            ELSE
                v_net := round(v_il.line_net * v_qty / v_il.quantity, 2);
                v_vat := round(v_il.line_vat * v_qty / v_il.quantity, 2);
            END IF;
            -- Cost: what the delivered goods cost, else today's cost.
            SELECT CASE WHEN SUM(dl.quantity) > 0 THEN SUM(dl.quantity * dl.unit_cost) / SUM(dl.quantity) END INTO v_cost
            FROM public.sales_delivery_lines dl JOIN public.sales_deliveries d ON d.id = dl.delivery_id
            WHERE dl.order_line_id = v_il.order_line_id AND d.cancelled_at IS NULL;
            IF v_cost IS NULL THEN
                SELECT cost INTO v_cost FROM public.products WHERE id = v_il.product_id;
            END IF;
            INSERT INTO public.credit_note_lines (credit_note_id, business_id, invoice_line_id, product_id, name, quantity,
                                                  line_net, line_vat, line_total, unit_cost)
            VALUES (v_id, p_business_id, v_il.id, v_il.product_id, v_il.name, v_qty, v_net, v_vat, v_net + v_vat,
                    CASE WHEN v_stock AND v_il.product_id IS NOT NULL THEN round(COALESCE(v_cost, 0), 2) ELSE 0 END);
            UPDATE public.sales_invoice_lines SET qty_credited = qty_credited + v_qty WHERE id = v_il.id;
        ELSE
            SELECT * INTO v_ti FROM public.transaction_items
            WHERE id = NULLIF(v_el->>'transactionItemId', '')::UUID AND transaction_id = v_tx_id;
            IF NOT FOUND THEN
                RAISE EXCEPTION 'An item is not on this sale.';
            END IF;
            SELECT COALESCE(SUM(cl.quantity), 0) INTO v_done
            FROM public.credit_note_lines cl WHERE cl.transaction_item_id = v_ti.id;
            IF v_done + v_qty > v_ti.quantity THEN
                RAISE EXCEPTION 'Only % of % is left to refund.', v_ti.quantity - v_done, v_ti.product_name;
            END IF;
            v_net := round(v_ti.unit_price * (1 - v_ti.discount_percentage / 100) * v_factor * v_qty, 2);
            v_vat := round(v_net * v_rate, 2);
            SELECT cost INTO v_cost FROM public.products WHERE id = v_ti.product_id;
            v_cost := COALESCE(v_ti.unit_cost, v_cost, 0);
            INSERT INTO public.credit_note_lines (credit_note_id, business_id, transaction_item_id, product_id, name, quantity,
                                                  line_net, line_vat, line_total, unit_cost)
            VALUES (v_id, p_business_id, v_ti.id, v_ti.product_id, v_ti.product_name, v_qty, v_net, v_vat, v_net + v_vat,
                    CASE WHEN v_stock THEN round(v_cost, 2) ELSE 0 END);
        END IF;
    END LOOP;

    UPDATE public.credit_notes c
    SET subtotal = s.net, vat_total = s.vat, total = s.net + s.vat, cost_total = s.cost
    FROM (SELECT COALESCE(SUM(line_net), 0) AS net, COALESCE(SUM(line_vat), 0) AS vat,
                 COALESCE(round(SUM(quantity * unit_cost), 2), 0) AS cost
          FROM public.credit_note_lines WHERE credit_note_id = v_id) s
    WHERE c.id = v_id
    RETURNING c.total INTO v_total;
    IF COALESCE(v_total, 0) <= 0 THEN
        RAISE EXCEPTION 'Tick at least one item with a quantity to credit.';
    END IF;

    -- How much may come back this way.
    IF v_inv_id IS NOT NULL THEN
        IF v_set = 'reduce' AND v_total > v_i.balance THEN
            RAISE EXCEPTION 'Only % is still owed. Credit the rest as money back.', to_char(GREATEST(v_i.balance, 0), 'FM999,999,990.00');
        ELSIF v_set = 'refund' AND v_total > v_i.amount_paid - v_i.amount_refunded THEN
            RAISE EXCEPTION 'Only % was paid on this invoice and not yet given back. Credit the rest as less owed.',
                to_char(GREATEST(v_i.amount_paid - v_i.amount_refunded, 0), 'FM999,999,990.00');
        END IF;
    ELSE
        SELECT v_t.final_total - CASE WHEN v_t.is_delivery THEN COALESCE(v_t.delivery_fee, 0) ELSE 0 END - COALESCE(SUM(total), 0)
        INTO v_room FROM public.credit_notes WHERE transaction_id = v_tx_id AND id <> v_id;
        IF v_total > v_room + 0.05 THEN
            RAISE EXCEPTION 'Only % of this sale is left to refund.', to_char(GREATEST(v_room, 0), 'FM999,999,990.00');
        END IF;
    END IF;

    -- Settle it.
    IF v_set = 'refund' THEN
        PERFORM public.fn_post_money_asset(p_business_id, v_method, -v_total, 'Refund ' || v_no || ' · ' || v_cname, NULL, NULL, v_who);
    ELSIF v_set = 'wallet' THEN
        SELECT COALESCE(wallet_balance, 0), COALESCE(debt_balance, 0) INTO v_wallet, v_debt
        FROM public.customers WHERE id = v_cust FOR UPDATE;
        UPDATE public.customers SET wallet_balance = v_wallet + v_total, updated_at = NOW() WHERE id = v_cust;
        INSERT INTO public.customer_ledger (business_id, customer_id, type, amount, wallet_balance, debt_balance,
                                            recorded_by, note, reference_id)
        VALUES (p_business_id, v_cust, 'refund', v_total, v_wallet + v_total, v_debt, v_who,
                'Credit note ' || v_no || ' into wallet', 'cn-' || v_id || '-wallet');
    ELSIF v_set = 'debt' THEN
        SELECT * INTO v_cp FROM public.credit_payments
        WHERE transaction_id = v_tx_id AND business_id = p_business_id AND status IN ('Open', 'Partial')
        ORDER BY created_at LIMIT 1 FOR UPDATE;
        IF NOT FOUND OR v_cp.balance < v_total THEN
            RAISE EXCEPTION 'Only % is still owed on this sale. Give the rest back as money or into the wallet.',
                to_char(COALESCE(v_cp.balance, 0), 'FM999,999,990.00');
        END IF;
        UPDATE public.credit_payments
        SET amount_owed = amount_owed - v_total,
            status = CASE WHEN amount_owed - v_total <= amount_paid THEN 'Settled'::public.credit_status ELSE status END,
            settled_at = CASE WHEN amount_owed - v_total <= amount_paid THEN NOW() ELSE settled_at END,
            updated_at = NOW()
        WHERE id = v_cp.id;
        SELECT COALESCE(wallet_balance, 0), COALESCE(debt_balance, 0) INTO v_wallet, v_debt
        FROM public.customers WHERE id = v_cust FOR UPDATE;
        UPDATE public.customers SET debt_balance = GREATEST(v_debt - v_total, 0), updated_at = NOW() WHERE id = v_cust;
        INSERT INTO public.customer_ledger (business_id, customer_id, type, amount, wallet_balance, debt_balance,
                                            recorded_by, note, reference_id, transaction_id)
        VALUES (p_business_id, v_cust, 'refund', v_total, v_wallet, GREATEST(v_debt - v_total, 0), v_who,
                'Credit note ' || v_no || ' taken off debt', 'cn-' || v_id || '-debt', v_tx_id);
    END IF;

    -- Stock back.
    IF v_stock THEN
        FOR v_el IN
            SELECT to_jsonb(cl) FROM public.credit_note_lines cl WHERE cl.credit_note_id = v_id AND cl.product_id IS NOT NULL
        LOOP
            SELECT stock INTO v_old FROM public.products WHERE id = (v_el->>'product_id')::UUID FOR UPDATE;
            IF FOUND THEN
                UPDATE public.products SET stock = v_old + (v_el->>'quantity')::NUMERIC, updated_at = NOW()
                WHERE id = (v_el->>'product_id')::UUID;
                INSERT INTO public.inventory_adjustments (business_id, product_id, product_name, type, quantity_adjusted,
                    previous_stock, new_stock, reason, reference_number, staff_name, notes)
                VALUES (p_business_id, (v_el->>'product_id')::UUID, v_el->>'name', 'Restock', (v_el->>'quantity')::NUMERIC,
                    v_old, v_old + (v_el->>'quantity')::NUMERIC, 'Returned', v_no, v_who, v_reason);
            END IF;
        END LOOP;
    END IF;

    IF v_inv_id IS NOT NULL THEN
        PERFORM public.sd_invoice_refresh(v_inv_id);
    END IF;
    RETURN v_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- 7. Reading
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sd_lines_json(p_table TEXT, p_fk TEXT, p_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v JSONB;
BEGIN
    EXECUTE format('SELECT COALESCE(jsonb_agg(to_jsonb(l) - ''business_id'' ORDER BY l.position), ''[]''::JSONB) FROM public.%I l WHERE l.%I = $1', p_table, p_fk)
    INTO v USING p_id;
    RETURN v;
END;
$$;

-- Everything the Quotes & Invoices screen shows, for one branch: recent and open documents.
CREATE OR REPLACE FUNCTION public.sales_docs(p_business_id UUID, p_since DATE DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_since  DATE := COALESCE(p_since, public.sd_today() - 365);
    v_today  DATE := public.sd_today();
    v_quotes JSONB := '[]'::JSONB;
    v_orders JSONB := '[]'::JSONB;
    v_invs   JSONB := '[]'::JSONB;
    v_cns    JSONB := '[]'::JSONB;
BEGIN
    PERFORM public.assert_business_member(p_business_id);
    IF public.has_permission(p_business_id, 'quotes.view', 'quotes.manage') THEN
        SELECT COALESCE(jsonb_agg(to_jsonb(q) - 'business_id'
                   || jsonb_build_object('expired', q.status IN ('draft', 'sent') AND q.valid_until < v_today,
                                         'order_number', o.number,
                                         'lines', public.sd_lines_json('quote_lines', 'quote_id', q.id))
                   ORDER BY q.created_at DESC), '[]'::JSONB)
        INTO v_quotes
        FROM public.quotes q LEFT JOIN public.sales_orders o ON o.id = q.order_id
        WHERE q.business_id = p_business_id AND (q.issue_date >= v_since OR q.status IN ('draft', 'sent'));
    END IF;
    IF public.has_permission(p_business_id, 'sales_orders.view', 'sales_orders.manage') THEN
        SELECT COALESCE(jsonb_agg(to_jsonb(o) - 'business_id'
                   || jsonb_build_object(
                        'quote_number', q.number,
                        'lines', public.sd_lines_json('sales_order_lines', 'order_id', o.id),
                        'deliveries', (SELECT COALESCE(jsonb_agg(to_jsonb(d) - 'business_id'
                                          || jsonb_build_object('lines', (SELECT COALESCE(jsonb_agg(to_jsonb(dl) - 'business_id'), '[]'::JSONB)
                                                                          FROM public.sales_delivery_lines dl WHERE dl.delivery_id = d.id))
                                          ORDER BY d.delivered_at), '[]'::JSONB)
                                       FROM public.sales_deliveries d WHERE d.order_id = o.id),
                        'invoices', (SELECT COALESCE(jsonb_agg(jsonb_build_object('id', i.id, 'number', i.number, 'total', i.total,
                                          'balance', i.balance, 'status', i.status) ORDER BY i.created_at), '[]'::JSONB)
                                     FROM public.sales_invoices i WHERE i.order_id = o.id))
                   ORDER BY o.created_at DESC), '[]'::JSONB)
        INTO v_orders
        FROM public.sales_orders o LEFT JOIN public.quotes q ON q.id = o.quote_id
        WHERE o.business_id = p_business_id AND (o.order_date >= v_since OR o.status NOT IN ('paid', 'cancelled'));
    END IF;
    IF public.has_permission(p_business_id, 'invoices.view', 'invoices.manage') THEN
        SELECT COALESCE(jsonb_agg(to_jsonb(i) - 'business_id'
                   || jsonb_build_object(
                        'overdue', i.status IN ('unpaid', 'part_paid') AND i.due_date < v_today,
                        'days_late', GREATEST(v_today - i.due_date, 0),
                        'order_number', o.number,
                        'lines', public.sd_lines_json('sales_invoice_lines', 'invoice_id', i.id),
                        'payments', (SELECT COALESCE(jsonb_agg(to_jsonb(p) - 'business_id' ORDER BY p.paid_at), '[]'::JSONB)
                                     FROM public.invoice_payments p WHERE p.invoice_id = i.id),
                        'credit_notes', (SELECT COALESCE(jsonb_agg(jsonb_build_object('id', c.id, 'number', c.number, 'total', c.total,
                                             'settlement', c.settlement) ORDER BY c.created_at), '[]'::JSONB)
                                         FROM public.credit_notes c WHERE c.invoice_id = i.id))
                   ORDER BY i.created_at DESC), '[]'::JSONB)
        INTO v_invs
        FROM public.sales_invoices i LEFT JOIN public.sales_orders o ON o.id = i.order_id
        WHERE i.business_id = p_business_id AND (i.issue_date >= v_since OR i.status IN ('unpaid', 'part_paid'));
    END IF;
    IF public.has_permission(p_business_id, 'invoices.view', 'invoices.manage', 'refunds.create', 'orders.view') THEN
        SELECT COALESCE(jsonb_agg(to_jsonb(c) - 'business_id'
                   || jsonb_build_object(
                        'invoice_number', i.number,
                        'receipt_number', CASE WHEN c.transaction_id IS NOT NULL THEN public.fn_receipt_number(c.transaction_id) END,
                        'lines', (SELECT COALESCE(jsonb_agg(to_jsonb(cl) - 'business_id'), '[]'::JSONB)
                                  FROM public.credit_note_lines cl WHERE cl.credit_note_id = c.id))
                   ORDER BY c.created_at DESC), '[]'::JSONB)
        INTO v_cns
        FROM public.credit_notes c LEFT JOIN public.sales_invoices i ON i.id = c.invoice_id
        WHERE c.business_id = p_business_id AND c.issue_date >= v_since;
    END IF;
    RETURN jsonb_build_object('quotes', v_quotes, 'orders', v_orders, 'invoices', v_invs, 'creditNotes', v_cns);
END;
$$;

-- What each customer owes on invoices, by how late it is.
CREATE OR REPLACE FUNCTION public.invoice_ageing(p_business_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_today DATE := public.sd_today();
    v_rows  JSONB;
BEGIN
    PERFORM public.assert_business_member(p_business_id);
    PERFORM public.assert_permission(p_business_id, 'invoices.view', 'invoices.manage');
    WITH open_inv AS (
        SELECT COALESCE(i.customer_id::TEXT, 'name:' || lower(i.customer_name)) AS k, i.customer_id, i.customer_name,
               i.balance, v_today - i.due_date AS late
        FROM public.sales_invoices i
        WHERE i.business_id = p_business_id AND i.status IN ('unpaid', 'part_paid') AND i.balance > 0
    )
    SELECT COALESCE(jsonb_agg(r ORDER BY (r->>'total')::NUMERIC DESC), '[]'::JSONB) INTO v_rows
    FROM (
        SELECT jsonb_build_object(
            'customerId', MAX(customer_id::TEXT), 'name', MAX(customer_name), 'invoices', COUNT(*),
            'notDue', SUM(balance) FILTER (WHERE late <= 0),
            'd1_30', SUM(balance) FILTER (WHERE late BETWEEN 1 AND 30),
            'd31_60', SUM(balance) FILTER (WHERE late BETWEEN 31 AND 60),
            'd61_90', SUM(balance) FILTER (WHERE late BETWEEN 61 AND 90),
            'd90', SUM(balance) FILTER (WHERE late > 90),
            'total', SUM(balance), 'oldest', MAX(late)) AS r
        FROM open_inv GROUP BY k
    ) x;
    RETURN v_rows;
END;
$$;

-- A till sale's lines for the Refund sheet: what is left to refund and what one unit gives back.
CREATE OR REPLACE FUNCTION public.sale_refund_lines(p_transaction_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_t      public.transactions%ROWTYPE;
    v_factor NUMERIC;
    v_rate   NUMERIC;
    v_lines  JSONB;
    v_done   NUMERIC;
    v_owed   NUMERIC;
BEGIN
    SELECT * INTO v_t FROM public.transactions WHERE id = p_transaction_id;
    IF NOT FOUND OR v_t.deleted_at IS NOT NULL THEN
        RAISE EXCEPTION 'That sale was not found.';
    END IF;
    PERFORM public.assert_business_member(v_t.business_id);
    PERFORM public.assert_permission(v_t.business_id, 'refunds.create', 'pos.cancel_sale');
    SELECT CASE WHEN SUM(unit_price * quantity * (1 - discount_percentage / 100)) > 0
                THEN (v_t.total - v_t.discount) / SUM(unit_price * quantity * (1 - discount_percentage / 100)) ELSE 0 END
    INTO v_factor FROM public.transaction_items WHERE transaction_id = p_transaction_id;
    v_factor := LEAST(GREATEST(COALESCE(v_factor, 1), 0), 1);
    v_rate := CASE WHEN (v_t.total - v_t.discount) > 0 THEN COALESCE(v_t.tax, 0) / (v_t.total - v_t.discount) ELSE 0 END;
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'id', ti.id, 'productId', ti.product_id, 'name', ti.product_name, 'quantity', ti.quantity,
        'left', ti.quantity - COALESCE(c.qty, 0),
        'unitNet', round(ti.unit_price * (1 - ti.discount_percentage / 100) * v_factor, 4),
        'vatRate', round(v_rate * 100, 2)) ORDER BY ti.created_at, ti.id), '[]'::JSONB)
    INTO v_lines
    FROM public.transaction_items ti
    LEFT JOIN (SELECT transaction_item_id, SUM(quantity) AS qty FROM public.credit_note_lines GROUP BY 1) c
        ON c.transaction_item_id = ti.id
    WHERE ti.transaction_id = p_transaction_id;
    SELECT COALESCE(SUM(total), 0) INTO v_done FROM public.credit_notes WHERE transaction_id = p_transaction_id;
    SELECT COALESCE(SUM(balance), 0) INTO v_owed FROM public.credit_payments
    WHERE transaction_id = p_transaction_id AND status IN ('Open', 'Partial');
    RETURN jsonb_build_object(
        'receipt', public.fn_receipt_number(v_t.id), 'customerId', v_t.customer_id, 'customerName', v_t.customer_name,
        'paymentMethod', v_t.payment_method, 'finalTotal', v_t.final_total, 'refunded', v_done, 'owedOnSale', v_owed,
        'today', (v_t.timestamp AT TIME ZONE 'Africa/Nairobi')::DATE = public.sd_today(),
        'fullAccess', public.has_permission(v_t.business_id, 'refunds.create'),
        'lines', v_lines);
END;
$$;

-- Payments in this branch that aren't matched to anything yet, to put on an invoice.
CREATE OR REPLACE FUNCTION public.unmatched_payments(p_business_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v JSONB;
BEGIN
    PERFORM public.assert_business_member(p_business_id);
    PERFORM public.assert_permission(p_business_id, 'invoices.manage');
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'id', p.id, 'reference', p.reference_code, 'amount', p.amount, 'free', p.amount - COALESCE(u.used, 0),
        'method', p.method, 'name', COALESCE(p.customer_name, p.sender_name), 'phone', p.sender_phone, 'date', p.date)
        ORDER BY p.date DESC), '[]'::JSONB) INTO v
    FROM public.payments p
    LEFT JOIN (SELECT payment_id, SUM(amount) AS used FROM public.invoice_payments WHERE voided_at IS NULL GROUP BY payment_id) u
        ON u.payment_id = p.id
    WHERE p.business_id = p_business_id AND p.status = 'Success'
      AND COALESCE(p.debt_applied, 0) = 0 AND COALESCE(p.wallet_applied, 0) = 0
      AND p.amount - COALESCE(u.used, 0) > 0
      AND p.date > NOW() - INTERVAL '120 days'
      AND NOT EXISTS (SELECT 1 FROM public.transactions t WHERE t.business_id = p.business_id AND t.reference_id = p.reference_code)
    LIMIT 200;
    RETURN v;
END;
$$;

-- ---------------------------------------------------------------------------
-- 8. Books: four new kinds of record
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.acc_sales_doc_lines(p_type TEXT, p_id UUID)
RETURNS TABLE (b UUID, d DATE, m TEXT, l JSONB)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_lines JSONB := '[]'::JSONB;
    v_dl    public.sales_deliveries%ROWTYPE;
    v_i     public.sales_invoices%ROWTYPE;
    v_p     public.invoice_payments%ROWTYPE;
    v_c     public.credit_notes%ROWTYPE;
    v_o     TEXT;
    v_party TEXT;
    v_to    UUID;
BEGIN
    IF p_type = 'sales_delivery' THEN
        SELECT * INTO v_dl FROM public.sales_deliveries WHERE id = p_id;
        IF NOT FOUND THEN RETURN; END IF;
        SELECT number || ' · ' || customer_name INTO v_o FROM public.sales_orders WHERE id = v_dl.order_id;
        IF v_dl.cancelled_at IS NULL AND v_dl.total_cost > 0 THEN
            v_lines := public.acc_l(v_lines, public.acc_account(v_dl.business_id, 'cogs'), v_dl.total_cost);
            v_lines := public.acc_l(v_lines, public.acc_account(v_dl.business_id, 'inventory'), -v_dl.total_cost);
        END IF;
        RETURN QUERY SELECT v_dl.business_id, (v_dl.delivered_at AT TIME ZONE 'Africa/Nairobi')::DATE,
            'Delivery ' || v_dl.number || ' (order ' || COALESCE(v_o, '') || ')', v_lines;

    ELSIF p_type = 'sales_invoice' THEN
        SELECT * INTO v_i FROM public.sales_invoices WHERE id = p_id;
        IF NOT FOUND THEN RETURN; END IF;
        IF v_i.status <> 'void' THEN
            v_party := COALESCE(v_i.customer_id::TEXT, 'name:' || lower(v_i.customer_name));
            v_lines := public.acc_l(v_lines, public.acc_account(v_i.business_id, 'receivable'), v_i.total, 'customer', v_party, v_i.customer_name);
            v_lines := public.acc_l(v_lines, public.acc_account(v_i.business_id, 'sales'), -v_i.subtotal);
            v_lines := public.acc_l(v_lines, public.acc_account(v_i.business_id, 'delivery'), -v_i.delivery_fee);
            v_lines := public.acc_l(v_lines, public.acc_account(v_i.business_id, 'vat'), -v_i.vat_total);
        END IF;
        RETURN QUERY SELECT v_i.business_id, v_i.issue_date, 'Invoice ' || v_i.number || ' · ' || v_i.customer_name, v_lines;

    ELSIF p_type = 'invoice_payment' THEN
        SELECT * INTO v_p FROM public.invoice_payments WHERE id = p_id;
        IF NOT FOUND THEN RETURN; END IF;
        SELECT * INTO v_i FROM public.sales_invoices WHERE id = v_p.invoice_id;
        IF v_p.voided_at IS NULL THEN
            v_party := COALESCE(v_i.customer_id::TEXT, 'name:' || lower(v_i.customer_name));
            IF v_p.payment_id IS NOT NULL THEN
                -- The payment itself sits in "not matched"; this moves it to the invoice.
                v_lines := public.acc_l(v_lines, public.acc_account(v_p.business_id, 'unmatched'), v_p.amount);
            ELSE
                v_lines := public.acc_l(v_lines, public.acc_account(v_p.business_id, public.acc_money_key(v_p.method)), v_p.amount);
            END IF;
            v_lines := public.acc_l(v_lines, public.acc_account(v_p.business_id, 'receivable'), -v_p.amount, 'customer', v_party, v_i.customer_name);
        END IF;
        RETURN QUERY SELECT v_p.business_id, (v_p.paid_at AT TIME ZONE 'Africa/Nairobi')::DATE,
            'Invoice ' || v_i.number || ' paid (' || v_p.method || ')' || COALESCE(' · ' || v_p.reference, ''), v_lines;

    ELSIF p_type = 'credit_note' THEN
        SELECT * INTO v_c FROM public.credit_notes WHERE id = p_id;
        IF NOT FOUND THEN RETURN; END IF;
        v_party := COALESCE(v_c.customer_id::TEXT, 'name:' || lower(v_c.customer_name));
        IF v_c.invoice_id IS NOT NULL THEN
            SELECT 'invoice ' || number INTO v_o FROM public.sales_invoices WHERE id = v_c.invoice_id;
        ELSE
            v_o := 'sale ' || public.fn_receipt_number(v_c.transaction_id);
        END IF;
        v_to := CASE v_c.settlement
            WHEN 'refund' THEN public.acc_account(v_c.business_id, public.acc_money_key(v_c.refund_method))
            WHEN 'wallet' THEN public.acc_account(v_c.business_id, 'wallets')
            ELSE public.acc_account(v_c.business_id, 'receivable') END;
        v_lines := public.acc_l(v_lines, public.acc_account(v_c.business_id, 'sales'), v_c.subtotal);
        v_lines := public.acc_l(v_lines, public.acc_account(v_c.business_id, 'vat'), v_c.vat_total);
        IF v_c.settlement = 'refund' THEN
            v_lines := public.acc_l(v_lines, v_to, -v_c.total);
        ELSE
            v_lines := public.acc_l(v_lines, v_to, -v_c.total, 'customer', v_party, v_c.customer_name);
        END IF;
        IF v_c.return_stock AND v_c.cost_total > 0 THEN
            v_lines := public.acc_l(v_lines, public.acc_account(v_c.business_id, 'inventory'), v_c.cost_total);
            v_lines := public.acc_l(v_lines, public.acc_account(v_c.business_id, 'cogs'), -v_c.cost_total);
        END IF;
        RETURN QUERY SELECT v_c.business_id, v_c.issue_date,
            'Credit note ' || v_c.number || ' (' || COALESCE(v_o, '') || ') · ' || v_c.customer_name, v_lines;
    END IF;
END;
$$;

-- Same as 20261116003, plus the four new kinds (worked out in acc_sales_doc_lines).
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

    ELSIF p_type IN ('sales_delivery', 'sales_invoice', 'invoice_payment', 'credit_note') THEN
        -- Quotes & invoices (20261117001).
        SELECT r.b, r.d, r.m, r.l INTO v_b, v_date, v_memo, v_lines FROM public.acc_sales_doc_lines(p_type, p_id) r;
        IF v_b IS NULL THEN RETURN; END IF;

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

-- Deferred, like the rest: a document's lines and totals are final at commit.
DROP TRIGGER IF EXISTS trg_acc_sales_delivery ON public.sales_deliveries;
CREATE CONSTRAINT TRIGGER trg_acc_sales_delivery AFTER INSERT OR UPDATE ON public.sales_deliveries
    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.acc_trg_post('sales_delivery');

DROP TRIGGER IF EXISTS trg_acc_sales_invoice ON public.sales_invoices;
CREATE CONSTRAINT TRIGGER trg_acc_sales_invoice AFTER INSERT OR UPDATE ON public.sales_invoices
    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.acc_trg_post('sales_invoice');

DROP TRIGGER IF EXISTS trg_acc_invoice_payment ON public.invoice_payments;
CREATE CONSTRAINT TRIGGER trg_acc_invoice_payment AFTER INSERT OR UPDATE ON public.invoice_payments
    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.acc_trg_post('invoice_payment');

DROP TRIGGER IF EXISTS trg_acc_credit_note ON public.credit_notes;
CREATE CONSTRAINT TRIGGER trg_acc_credit_note AFTER INSERT OR UPDATE ON public.credit_notes
    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.acc_trg_post('credit_note');

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
    ELSIF p_type = 'sales_delivery' THEN
        RETURN QUERY SELECT id FROM public.sales_deliveries WHERE business_id = p_business_id ORDER BY delivered_at, id OFFSET p_offset LIMIT p_limit;
    ELSIF p_type = 'sales_invoice' THEN
        RETURN QUERY SELECT id FROM public.sales_invoices WHERE business_id = p_business_id ORDER BY created_at, id OFFSET p_offset LIMIT p_limit;
    ELSIF p_type = 'invoice_payment' THEN
        RETURN QUERY SELECT id FROM public.invoice_payments WHERE business_id = p_business_id ORDER BY created_at, id OFFSET p_offset LIMIT p_limit;
    ELSIF p_type = 'credit_note' THEN
        RETURN QUERY SELECT id FROM public.credit_notes WHERE business_id = p_business_id ORDER BY created_at, id OFFSET p_offset LIMIT p_limit;
    END IF;
END;
$$;

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
    UPDATE public.acc_entries e SET reversed_at = NULL
    WHERE e.business_id = p_business_id AND e.reversed_at IS NOT NULL AND e.source_type IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM public.acc_entries r WHERE r.reversal_of = e.id);
    DELETE FROM public.acc_post_errors WHERE business_id = p_business_id;
    RETURN jsonb_build_object('kinds', jsonb_build_array('sale', 'expense', 'cledger', 'payment', 'purchase', 'supplier_payment',
        'stock_adj', 'sales_delivery', 'sales_invoice', 'invoice_payment', 'credit_note'));
END;
$$;

-- What customers owe: the screen's figure now includes open invoices.
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
    ), inv AS (
        SELECT COALESCE(customer_id::TEXT, 'name:' || lower(customer_name)) AS party_id, SUM(balance) AS open
        FROM public.sales_invoices
        WHERE business_id = p_business_id AND status <> 'void'
        GROUP BY 1
    )
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'customerId', b.party_id, 'name', COALESCE(c.name, b.name),
        'phone', c.phone, 'owes', COALESCE(b.owes, 0), 'holds', COALESCE(b.holds, 0),
        'appDebt', COALESCE(c.debt_balance, 0) + COALESCE(inv.open, 0), 'invoices', COALESCE(inv.open, 0),
        'appWallet', COALESCE(c.wallet_balance, 0),
        'lastDate', b.last_date, 'since', b.first_debt
    ) ORDER BY COALESCE(b.owes, 0) DESC), '[]'::JSONB) INTO v_rows
    FROM b
    LEFT JOIN public.customers c ON c.id::TEXT = b.party_id
    LEFT JOIN inv ON inv.party_id = b.party_id
    WHERE round(COALESCE(b.owes, 0), 2) <> 0 OR round(COALESCE(b.holds, 0), 2) <> 0
       OR round(COALESCE(c.debt_balance, 0), 2) <> 0 OR round(COALESCE(c.wallet_balance, 0), 2) <> 0;
    RETURN v_rows;
END;
$$;

-- ---------------------------------------------------------------------------
-- 9. Grants
-- ---------------------------------------------------------------------------
DO $$
DECLARE f TEXT;
BEGIN
    FOREACH f IN ARRAY ARRAY[
        'sd_next_no(UUID, TEXT, DATE)', 'sd_norm_lines(UUID, JSONB)', 'sd_customer(UUID, UUID)',
        'sd_order_refresh(UUID)', 'sd_order_totals(UUID)', 'sd_invoice_refresh(UUID)', 'sd_lines_json(TEXT, TEXT, UUID)',
        'sd_guard_payment_void()', 'acc_sales_doc_lines(TEXT, UUID)'
    ] LOOP
        EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon, authenticated', f);
    END LOOP;
    FOREACH f IN ARRAY ARRAY[
        'save_quote(UUID, UUID, JSONB)', 'set_quote_status(UUID, TEXT)', 'delete_quote(UUID)', 'quote_to_order(UUID)',
        'save_sales_order(UUID, UUID, JSONB)', 'cancel_sales_order(UUID, TEXT)', 'deliver_sales_order(UUID, JSONB, TEXT)',
        'cancel_sales_delivery(UUID, TEXT)', 'invoice_sales_order(UUID, JSONB, DATE, INTEGER, TEXT)',
        'void_sales_invoice(UUID, TEXT)', 'record_invoice_payment(UUID, NUMERIC, TEXT, TEXT, TIMESTAMPTZ, UUID)',
        'void_invoice_payment(UUID, TEXT)', 'set_customer_payment_terms(UUID, TEXT)', 'create_credit_note(UUID, JSONB)',
        'sales_docs(UUID, DATE)', 'invoice_ageing(UUID)', 'unmatched_payments(UUID)', 'sale_refund_lines(UUID)'
    ] LOOP
        EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon', f);
        EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated', f);
    END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 10. Role defaults (mirrors SYSTEM_ROLES in src/utils/permissions.ts; a test compares them)
-- Managers run quotes, orders, invoices and refunds. Cashiers refund today's sales
-- through pos.cancel_sale, which they already have.
-- ---------------------------------------------------------------------------
INSERT INTO public.role_default_permissions (role, permissions) VALUES
    ('Manager', ARRAY['accounting.view', 'ai.insights', 'ai.use', 'assets.view', 'bom.create', 'bom.update', 'bom.view', 'business.switch', 'business.view', 'communication.send', 'communication.view', 'complaints.reply', 'complaints.view', 'customers.create', 'customers.debts', 'customers.loyalty', 'customers.manage', 'customers.schedules', 'customers.update', 'customers.view', 'dashboard.view', 'deliveries.assign', 'deliveries.cancel', 'deliveries.complete', 'deliveries.create', 'deliveries.view', 'expenses.create', 'expenses.update', 'expenses.view', 'files.view', 'finance.view', 'home.view', 'inventory.adjust_stock', 'inventory.expiry', 'inventory.receive_stock', 'inventory.stock_count', 'inventory.stock_history', 'inventory.transfer_stock', 'inventory.view', 'inventory.wastage', 'invoices.manage', 'invoices.view', 'loyalty.adjust', 'notifications.send', 'notifications.view', 'online_store.view', 'orders.assign_rider', 'orders.complete', 'orders.create', 'orders.update', 'orders.view', 'payments.card', 'payments.cash', 'payments.verify', 'payments.view', 'pettycash.record', 'pos.close_shift', 'pos.create_sale', 'pos.open_shift', 'pos.walkin_customer', 'production.approve', 'production.create', 'production.update', 'production.view', 'products.create', 'products.export', 'products.import', 'products.manage_categories', 'products.update', 'products.view', 'purchases.approve', 'purchases.create', 'purchases.export', 'purchases.print', 'purchases.update', 'purchases.view', 'quotes.manage', 'quotes.view', 'refunds.create', 'reports.customers', 'reports.deliveries', 'reports.inventory', 'reports.profit', 'reports.sales', 'reports.view', 'sales_orders.manage', 'sales_orders.view', 'settings.tax', 'settings.theme', 'settings.update', 'settings.view', 'staff.schedule', 'staff.view', 'suppliers.create', 'suppliers.export', 'suppliers.import', 'suppliers.update', 'suppliers.view']),
    ('Cashier', ARRAY['ai.use', 'business.view', 'complaints.view', 'customers.create', 'customers.debts', 'customers.loyalty', 'customers.schedules', 'customers.view', 'dashboard.view', 'inventory.view', 'notifications.view', 'online_store.view', 'orders.assign_rider', 'orders.create', 'orders.update', 'orders.view', 'payments.card', 'payments.cash', 'payments.mpesa', 'payments.airtel', 'payments.verify', 'pettycash.record', 'pos.cancel_sale', 'pos.close_shift', 'pos.create_sale', 'pos.discount', 'pos.open_shift', 'pos.walkin_customer', 'products.view', 'settings.theme']),
    ('Rider', ARRAY['ai.use', 'business.view', 'dashboard.view', 'deliveries.cancel', 'deliveries.complete', 'deliveries.delivery_price', 'deliveries.delivery_zones', 'deliveries.view', 'notifications.view', 'settings.theme'])
ON CONFLICT (role) DO UPDATE SET permissions = EXCLUDED.permissions;

NOTIFY pgrst, 'reload schema';

COMMIT;
