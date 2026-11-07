-- KRA eTIMS (OSCU) connection per business, and the signature KRA returns for each sale.
-- The communication key KRA issues is a secret: it lives in kra_etims_secrets, which no
-- client role can read. Only the kra-etims edge function (service role) uses it.

CREATE TABLE IF NOT EXISTS public.kra_etims_settings (
    business_id       UUID PRIMARY KEY REFERENCES public.businesses(id) ON DELETE CASCADE,
    environment       TEXT NOT NULL DEFAULT 'sandbox' CHECK (environment IN ('sandbox', 'production')),
    kra_pin           TEXT NOT NULL CHECK (kra_pin ~ '^[A-Z][0-9]{9}[A-Z]$'),
    branch_id         TEXT NOT NULL DEFAULT '00' CHECK (branch_id ~ '^[0-9]{2}$'),
    device_serial     TEXT NOT NULL CHECK (length(trim(device_serial)) > 0),
    taxpayer_name     TEXT,
    sdc_id            TEXT,
    mrc_no            TEXT,
    -- KRA item classification code used when registering products that have none.
    item_class_code   TEXT NOT NULL CHECK (item_class_code ~ '^[0-9]{6,10}$'),
    -- Tax type for sales with no VAT: A exempt, C zero-rated, D non-VAT.
    no_vat_tax_type   TEXT NOT NULL DEFAULT 'D' CHECK (no_vat_tax_type IN ('A', 'C', 'D')),
    status            TEXT NOT NULL DEFAULT 'disconnected' CHECK (status IN ('connected', 'disconnected', 'error')),
    last_error        TEXT,
    connected_at      TIMESTAMPTZ,
    last_invoice_no   INTEGER NOT NULL DEFAULT 0 CHECK (last_invoice_no >= 0),
    updated_by        TEXT,
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.kra_etims_settings ENABLE ROW LEVEL SECURITY;

-- Staff who make sales need to know whether receipts get a KRA section.
DROP POLICY IF EXISTS pol_kra_settings_select ON public.kra_etims_settings;
CREATE POLICY pol_kra_settings_select ON public.kra_etims_settings FOR SELECT
    USING (public.has_permission(business_id, 'settings.view', 'settings.integrations', 'pos.create_sale', 'orders.view'));
-- Writes go through the edge function only (it verifies the details with KRA first).

CREATE TABLE IF NOT EXISTS public.kra_etims_secrets (
    business_id  UUID PRIMARY KEY REFERENCES public.businesses(id) ON DELETE CASCADE,
    cmc_key      TEXT NOT NULL,
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.kra_etims_secrets ENABLE ROW LEVEL SECURITY;
-- No policies: invisible to anon and authenticated.
REVOKE ALL ON public.kra_etims_secrets FROM anon, authenticated;

-- Products registered with eTIMS. item_key is the product id, or 'delivery' for delivery fees.
CREATE TABLE IF NOT EXISTS public.kra_etims_items (
    business_id    UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    item_key       TEXT NOT NULL,
    item_code      TEXT NOT NULL,
    item_class_code TEXT NOT NULL,
    tax_type       TEXT NOT NULL,
    registered_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (business_id, item_key),
    UNIQUE (business_id, item_code)
);
ALTER TABLE public.kra_etims_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS pol_kra_items_select ON public.kra_etims_items;
CREATE POLICY pol_kra_items_select ON public.kra_etims_items FOR SELECT
    USING (public.has_permission(business_id, 'settings.integrations'));

CREATE TABLE IF NOT EXISTS public.kra_etims_receipts (
    transaction_id   UUID PRIMARY KEY REFERENCES public.transactions(id) ON DELETE CASCADE,
    business_id      UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    environment      TEXT NOT NULL CHECK (environment IN ('sandbox', 'production')),
    status           TEXT NOT NULL CHECK (status IN ('pending', 'signed', 'failed')),
    invoice_no       INTEGER,
    kra_pin          TEXT,
    branch_id        TEXT,
    sdc_id           TEXT,
    mrc_no           TEXT,
    rcpt_no          INTEGER,
    tot_rcpt_no      INTEGER,
    internal_data    TEXT,
    rcpt_signature   TEXT,
    signed_at_kra    TEXT,
    qr_url           TEXT,
    attempts         INTEGER NOT NULL DEFAULT 0,
    last_error       TEXT,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (business_id, invoice_no)
);
ALTER TABLE public.kra_etims_receipts ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_kra_receipts_business ON public.kra_etims_receipts(business_id, created_at DESC);

DROP POLICY IF EXISTS pol_kra_receipts_select ON public.kra_etims_receipts;
CREATE POLICY pol_kra_receipts_select ON public.kra_etims_receipts FOR SELECT
    USING (public.has_permission(business_id, 'orders.view', 'pos.create_sale'));

-- eTIMS invoice numbers must run 1, 2, 3... per branch with no reuse.
-- The row lock serialises concurrent sales.
CREATE OR REPLACE FUNCTION public.kra_next_invoice_no(p_business_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_next INTEGER;
BEGIN
    UPDATE public.kra_etims_settings
       SET last_invoice_no = last_invoice_no + 1, updated_at = NOW()
     WHERE business_id = p_business_id
    RETURNING last_invoice_no INTO v_next;
    IF v_next IS NULL THEN
        RAISE EXCEPTION 'KRA eTIMS is not set up for this business.';
    END IF;
    RETURN v_next;
END;
$$;
REVOKE ALL ON FUNCTION public.kra_next_invoice_no(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.kra_next_invoice_no(UUID) TO service_role;
