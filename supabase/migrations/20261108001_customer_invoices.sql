-- Invoices for customers who owe money (credit sales). Numbers come from one counter per
-- business, so two devices can never issue the same invoice number. Each issued invoice is
-- kept exactly as it was sent, so it can be shared again later.

CREATE TABLE IF NOT EXISTS public.invoice_counters (
    business_id  UUID PRIMARY KEY REFERENCES public.businesses(id) ON DELETE CASCADE,
    last_number  INTEGER NOT NULL DEFAULT 0 CHECK (last_number >= 0),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.invoice_counters ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pol_invoice_counters_select ON public.invoice_counters;
CREATE POLICY pol_invoice_counters_select ON public.invoice_counters FOR SELECT
    USING (public.has_permission(business_id, 'customers.debts'));
-- No insert/update policies: only issue_invoice() moves the counter.

CREATE TABLE IF NOT EXISTS public.invoices (
    id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id  UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    customer_id  UUID REFERENCES public.customers(id) ON DELETE SET NULL,
    number       INTEGER NOT NULL CHECK (number > 0),
    invoice_no   TEXT NOT NULL,
    issued_at    DATE NOT NULL,
    due_at       DATE,
    balance_due  NUMERIC(14,2) NOT NULL DEFAULT 0,
    -- The invoice as shown: lines, totals and texts.
    document     JSONB NOT NULL,
    created_by   TEXT,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (business_id, number)
);
ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_invoices_customer ON public.invoices (customer_id, created_at DESC);

DROP POLICY IF EXISTS pol_invoices_select ON public.invoices;
CREATE POLICY pol_invoices_select ON public.invoices FOR SELECT
    USING (public.has_permission(business_id, 'customers.debts'));
-- Rows are written only by issue_invoice() and never edited.

-- Takes the next number and saves the invoice in one step.
CREATE OR REPLACE FUNCTION public.issue_invoice(
    p_business_id UUID,
    p_customer_id UUID,
    p_prefix      TEXT,
    p_issued_at   DATE,
    p_due_at      DATE,
    p_balance_due NUMERIC,
    p_document    JSONB,
    p_created_by  TEXT
)
RETURNS TABLE (id UUID, number INTEGER, invoice_no TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
    v_number INTEGER;
    v_prefix TEXT := upper(regexp_replace(COALESCE(p_prefix, ''), '[^A-Za-z0-9]', '', 'g'));
    v_no     TEXT;
    v_id     UUID;
BEGIN
    PERFORM public.assert_permission(p_business_id, 'customers.debts');

    IF p_customer_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.customers c WHERE c.id = p_customer_id AND c.business_id = p_business_id
    ) THEN
        RAISE EXCEPTION 'That customer is not in this business.' USING ERRCODE = '42501';
    END IF;
    IF p_document IS NULL OR jsonb_typeof(p_document) <> 'object' THEN
        RAISE EXCEPTION 'The invoice is empty.';
    END IF;

    INSERT INTO public.invoice_counters AS c (business_id, last_number)
    VALUES (p_business_id, 1)
    ON CONFLICT (business_id) DO UPDATE SET last_number = c.last_number + 1, updated_at = NOW()
    RETURNING c.last_number INTO v_number;

    v_no := CASE WHEN v_prefix = '' THEN '' ELSE v_prefix || '-' END || lpad(v_number::TEXT, 4, '0');

    INSERT INTO public.invoices (business_id, customer_id, number, invoice_no, issued_at, due_at, balance_due, document, created_by)
    VALUES (p_business_id, p_customer_id, v_number, v_no, COALESCE(p_issued_at, CURRENT_DATE), p_due_at,
            COALESCE(p_balance_due, 0), p_document, left(p_created_by, 120))
    RETURNING invoices.id INTO v_id;

    RETURN QUERY SELECT v_id, v_number, v_no;
END;
$$;

REVOKE ALL ON FUNCTION public.issue_invoice(UUID, UUID, TEXT, DATE, DATE, NUMERIC, JSONB, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.issue_invoice(UUID, UUID, TEXT, DATE, DATE, NUMERIC, JSONB, TEXT) TO authenticated, service_role;

-- A sale on credit is a debt, so its notification belongs with the other debt notices.
CREATE OR REPLACE FUNCTION public.fn_notification_catalog()
RETURNS TABLE (category TEXT, types TEXT[], permissions TEXT[], locked BOOLEAN)
LANGUAGE sql
IMMUTABLE
AS $$
    VALUES
        ('stock', ARRAY['Stock Almost Finished', 'Out Of Stock'], ARRAY['inventory.view'], FALSE),
        ('sales', ARRAY['Sales Summary', 'Daily Report', 'Weekly Report', 'Monthly Report'], ARRAY['reports.sales'], FALSE),
        ('debts', ARRAY['Debt Due Reminder', 'Credit Sale'], ARRAY['customers.debts'], FALSE),
        ('deliveries', ARRAY['Delivery Assigned', 'Delivery Completed'], ARRAY['deliveries.view'], FALSE),
        ('payments', ARRAY['Payment Received', 'Low Cash Balance'], ARRAY['payments.view', 'payments.verify'], FALSE),
        ('online_store', ARRAY['Online Store'], ARRAY['online_store.view'], FALSE),
        ('schedules', ARRAY['Schedule Reminder', 'Scheduled Reminder'], NULL::TEXT[], FALSE),
        ('ai', ARRAY['AI Business Insight', 'AI Recommendation', 'AI Risk Alert'], ARRAY['ai.insights'], FALSE),
        ('announcements', ARRAY['Business Announcement', 'Custom Notification'], NULL::TEXT[], FALSE),
        ('account', ARRAY['Role Invitation', 'Account Activity', 'System Update'], NULL::TEXT[], TRUE);
$$;
