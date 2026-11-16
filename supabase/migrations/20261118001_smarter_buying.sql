-- =============================================================================
-- 20261118001_smarter_buying.sql
-- Roadmap step 3: smarter buying, and stock transfers in the books.
--
--   Reorder points     Each product can have a reorder level, how much to order, a
--                      preferred supplier, that supplier's price and lead time. The
--                      Buying screen lists what is low, suggests a transfer from a branch
--                      that has plenty before buying, and makes one draft purchase per
--                      supplier. A nightly job sends a "Reorder" notification.
--   Quotes (RFQ)       A draft purchase is sent to several suppliers for prices. Picking
--                      one makes it the order at that supplier's prices; the rest lose.
--   Approval           Each role can have a KSh limit (owner: none). An order above the
--                      limit of the person who placed it waits in "Awaiting approval"
--                      until someone allowed a bigger amount approves it. This is checked
--                      in the database, so older app versions follow it too.
--   Receiving in parts GRN-2026-0001 per delivery: received, damaged, short. Only what
--                      arrived in good order is added to stock. The rest stays open
--                      ("Part received") until it comes or the order is closed.
--   Supplier bills     BILL-2026-0001: the supplier's invoice for one or more deliveries.
--                      Billed vs received at the order price; a difference over the
--                      tolerance waits for a check before it counts.
--   Returns            RTS-2026-0001: goods sent back. Stock out, and we owe less.
--   Transfers          Requests from a branch, drafts, approval, shortages settled
--                      (written off, found, arrived late), central buying (one purchase
--                      for several branches; the other branches' share becomes drafted
--                      transfers when the goods arrive). The branch that orders pays.
--
-- Books (through acc_post_source):
--   purchase_receipt  Dr Stock                         Cr Goods received, not billed (2050)
--   supplier_bill     Dr Goods received, not billed    Cr What we owe suppliers
--                     Dr VAT on purchases (1300)
--                     Dr/Cr Stock for a price difference
--   supplier_return   Dr What we owe suppliers         Cr Stock
--   transfer_out      Dr Stock on the way (1210)       Cr Stock               (sender)
--   transfer_close    Dr Between branches (3200)       Cr Stock on the way    (sender)
--                     Dr Stock (found) / Stock losses (written off)
--   transfer_in       Dr Stock                         Cr Between branches    (receiver)
--   A purchase received before this step (no GRN) still posts Stock / What we owe.
--
-- Permissions: purchases.request_quote, supplier_bills.manage, inventory.request_transfer
-- (all three for Managers). Approval limits and the bill tolerance are set by owners
-- and admins only, so nobody raises their own limit.
-- Dependencies: 20261111003 (transfers), 20261116001 (purchases), 20261116003
-- (accounting), 20261117001 (sd_next_no, acc_post_source with sales documents).
-- =============================================================================

-- A stock history type for goods sent back. ADD VALUE can't share a transaction with
-- code that uses it; the functions below only use it when they run.
ALTER TYPE public.inventory_adjustment_type ADD VALUE IF NOT EXISTS 'Supplier Return';

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Columns and tables
-- ---------------------------------------------------------------------------

-- Reorder settings per product. NULL level = use the low-stock level (min_stock).
ALTER TABLE public.products
    ADD COLUMN IF NOT EXISTS reorder_level         NUMERIC(14,3) CHECK (reorder_level IS NULL OR reorder_level >= 0),
    ADD COLUMN IF NOT EXISTS reorder_qty           NUMERIC(14,3) CHECK (reorder_qty IS NULL OR reorder_qty > 0),
    ADD COLUMN IF NOT EXISTS preferred_supplier_id UUID REFERENCES public.suppliers(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS supplier_price        NUMERIC(14,2) CHECK (supplier_price IS NULL OR supplier_price >= 0),
    ADD COLUMN IF NOT EXISTS lead_time_days        INTEGER CHECK (lead_time_days IS NULL OR lead_time_days BETWEEN 0 AND 365);

CREATE TABLE IF NOT EXISTS public.buying_settings (
    business_id        UUID PRIMARY KEY REFERENCES public.businesses(id) ON DELETE CASCADE,
    bill_tolerance_pct NUMERIC(5,2) NOT NULL DEFAULT 2 CHECK (bill_tolerance_pct BETWEEN 0 AND 50),
    safety_days        INTEGER NOT NULL DEFAULT 3 CHECK (safety_days BETWEEN 0 AND 90),
    updated_by         TEXT,
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- No row for a role = no limit. Owners and admins never need approval.
CREATE TABLE IF NOT EXISTS public.purchase_approval_limits (
    business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    role        TEXT NOT NULL,
    max_amount  NUMERIC(14,2) NOT NULL CHECK (max_amount >= 0),
    updated_by  TEXT,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (business_id, role)
);

-- Purchases: more statuses, who asked, approval, ordered date.
DO $$
DECLARE c TEXT;
BEGIN
    FOR c IN SELECT conname FROM pg_constraint
             WHERE conrelid = 'public.purchases'::regclass AND contype = 'c' AND pg_get_constraintdef(oid) ILIKE '%status%'
    LOOP
        EXECUTE format('ALTER TABLE public.purchases DROP CONSTRAINT %I', c);
    END LOOP;
END $$;
ALTER TABLE public.purchases ADD CONSTRAINT purchases_status_check
    CHECK (status IN ('Pending', 'RFQ', 'Awaiting approval', 'Ordered', 'Part received', 'Received', 'Cancelled'));

ALTER TABLE public.purchases
    ADD COLUMN IF NOT EXISTS requested_by_user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS approved_amount      NUMERIC(14,2),
    ADD COLUMN IF NOT EXISTS approved_by          TEXT,
    ADD COLUMN IF NOT EXISTS approved_at          TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS rejected_by          TEXT,
    ADD COLUMN IF NOT EXISTS rejected_at          TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS reject_reason        TEXT,
    ADD COLUMN IF NOT EXISTS ordered_at           TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS closed_note          TEXT;

-- Lines: what has arrived so far, and which branch a line is for (central buying).
ALTER TABLE public.purchase_items
    ADD COLUMN IF NOT EXISTS qty_received    NUMERIC(14,3) NOT NULL DEFAULT 0 CHECK (qty_received >= 0),
    ADD COLUMN IF NOT EXISTS qty_damaged     NUMERIC(14,3) NOT NULL DEFAULT 0 CHECK (qty_damaged >= 0),
    ADD COLUMN IF NOT EXISTS for_business_id UUID REFERENCES public.businesses(id) ON DELETE SET NULL;

-- Purchases already received count as fully arrived.
UPDATE public.purchase_items pi SET qty_received = pi.quantity
FROM public.purchases p
WHERE p.id = pi.purchase_id AND p.status = 'Received' AND pi.qty_received = 0;

-- Quotes from suppliers for one draft purchase.
CREATE TABLE IF NOT EXISTS public.purchase_quotes (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id   UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    purchase_id   UUID NOT NULL REFERENCES public.purchases(id) ON DELETE CASCADE,
    supplier_id   UUID REFERENCES public.suppliers(id) ON DELETE SET NULL,
    supplier_name TEXT NOT NULL,
    status        TEXT NOT NULL DEFAULT 'asked' CHECK (status IN ('asked', 'priced', 'won', 'lost')),
    sent_via      TEXT,
    delivery_days INTEGER CHECK (delivery_days IS NULL OR delivery_days BETWEEN 0 AND 365),
    note          TEXT,
    total         NUMERIC(14,2) NOT NULL DEFAULT 0,
    asked_by      TEXT,
    asked_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    priced_at     TIMESTAMPTZ,
    UNIQUE (purchase_id, supplier_id)
);
CREATE INDEX IF NOT EXISTS idx_purchase_quotes_purchase ON public.purchase_quotes(purchase_id);

CREATE TABLE IF NOT EXISTS public.purchase_quote_lines (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id      UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    quote_id         UUID NOT NULL REFERENCES public.purchase_quotes(id) ON DELETE CASCADE,
    purchase_item_id UUID NOT NULL REFERENCES public.purchase_items(id) ON DELETE CASCADE,
    unit_price       NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (unit_price >= 0),
    available        BOOLEAN NOT NULL DEFAULT TRUE,
    UNIQUE (quote_id, purchase_item_id)
);

-- Supplier bills (their invoice), one or more deliveries each.
CREATE TABLE IF NOT EXISTS public.supplier_bills (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id         UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    number              TEXT NOT NULL,
    supplier_id         UUID REFERENCES public.suppliers(id) ON DELETE SET NULL,
    supplier_name       TEXT NOT NULL,
    purchase_id         UUID REFERENCES public.purchases(id) ON DELETE SET NULL,
    supplier_invoice_no TEXT,
    bill_date           DATE NOT NULL,
    due_date            DATE NOT NULL,
    subtotal            NUMERIC(14,2) NOT NULL CHECK (subtotal >= 0),
    vat_total           NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (vat_total >= 0),
    total               NUMERIC(14,2) NOT NULL,
    receipts_value      NUMERIC(14,2) NOT NULL DEFAULT 0,
    difference          NUMERIC(14,2) NOT NULL DEFAULT 0,
    status              TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('needs_check', 'open', 'paid', 'void')),
    check_note          TEXT,
    approved_by         TEXT,
    approved_at         TIMESTAMPTZ,
    paid                NUMERIC(14,2) NOT NULL DEFAULT 0,
    balance             NUMERIC(14,2) NOT NULL DEFAULT 0,
    note                TEXT,
    created_by          TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    voided_at           TIMESTAMPTZ,
    voided_by           TEXT,
    void_reason         TEXT,
    UNIQUE (business_id, number)
);
CREATE INDEX IF NOT EXISTS idx_supplier_bills_business ON public.supplier_bills(business_id, bill_date DESC);
CREATE INDEX IF NOT EXISTS idx_supplier_bills_purchase ON public.supplier_bills(purchase_id);

-- Goods received notes. A purchase with one can't be deleted.
CREATE TABLE IF NOT EXISTS public.purchase_receipts (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id    UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    purchase_id    UUID NOT NULL REFERENCES public.purchases(id) ON DELETE RESTRICT,
    number         TEXT NOT NULL,
    received_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    received_by    TEXT,
    note           TEXT,
    total_value    NUMERIC(14,2) NOT NULL DEFAULT 0,
    damaged_value  NUMERIC(14,2) NOT NULL DEFAULT 0,
    bill_id        UUID REFERENCES public.supplier_bills(id) ON DELETE SET NULL,
    UNIQUE (business_id, number)
);
CREATE INDEX IF NOT EXISTS idx_purchase_receipts_purchase ON public.purchase_receipts(purchase_id);
CREATE INDEX IF NOT EXISTS idx_purchase_receipts_bill ON public.purchase_receipts(bill_id);

CREATE TABLE IF NOT EXISTS public.purchase_receipt_lines (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id      UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    receipt_id       UUID NOT NULL REFERENCES public.purchase_receipts(id) ON DELETE CASCADE,
    purchase_item_id UUID REFERENCES public.purchase_items(id) ON DELETE RESTRICT,
    product_id       UUID REFERENCES public.products(id) ON DELETE SET NULL,
    name             TEXT NOT NULL,
    unit             TEXT,
    unit_price       NUMERIC(14,2) NOT NULL DEFAULT 0,
    qty_received     NUMERIC(14,3) NOT NULL DEFAULT 0 CHECK (qty_received >= 0),
    qty_damaged      NUMERIC(14,3) NOT NULL DEFAULT 0 CHECK (qty_damaged >= 0)
);
CREATE INDEX IF NOT EXISTS idx_purchase_receipt_lines_receipt ON public.purchase_receipt_lines(receipt_id);

-- Goods sent back to a supplier.
CREATE TABLE IF NOT EXISTS public.supplier_returns (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id   UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    number        TEXT NOT NULL,
    supplier_id   UUID REFERENCES public.suppliers(id) ON DELETE SET NULL,
    supplier_name TEXT NOT NULL,
    purchase_id   UUID REFERENCES public.purchases(id) ON DELETE SET NULL,
    reason        TEXT NOT NULL,
    total         NUMERIC(14,2) NOT NULL DEFAULT 0,
    created_by    TEXT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (business_id, number)
);
CREATE INDEX IF NOT EXISTS idx_supplier_returns_business ON public.supplier_returns(business_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.supplier_return_lines (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    return_id   UUID NOT NULL REFERENCES public.supplier_returns(id) ON DELETE CASCADE,
    product_id  UUID REFERENCES public.products(id) ON DELETE SET NULL,
    name        TEXT NOT NULL,
    unit        TEXT,
    quantity    NUMERIC(14,3) NOT NULL CHECK (quantity > 0),
    unit_cost   NUMERIC(14,2) NOT NULL CHECK (unit_cost >= 0)
);
CREATE INDEX IF NOT EXISTS idx_supplier_return_lines_return ON public.supplier_return_lines(return_id);

-- Supplier payments can pay one bill.
ALTER TABLE public.supplier_payments
    ADD COLUMN IF NOT EXISTS bill_id UUID REFERENCES public.supplier_bills(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_supplier_payments_bill ON public.supplier_payments(bill_id);

-- Transfers: requests, drafts, approval, shortages settled.
DO $$
DECLARE c TEXT;
BEGIN
    FOR c IN SELECT conname FROM pg_constraint
             WHERE conrelid = 'public.stock_transfers'::regclass AND contype = 'c' AND pg_get_constraintdef(oid) ILIKE '%status%'
    LOOP
        EXECUTE format('ALTER TABLE public.stock_transfers DROP CONSTRAINT %I', c);
    END LOOP;
END $$;
ALTER TABLE public.stock_transfers ADD CONSTRAINT stock_transfers_status_check
    CHECK (status IN ('requested', 'draft', 'awaiting_approval', 'in_transit', 'received', 'cancelled', 'declined'));
ALTER TABLE public.stock_transfers ALTER COLUMN sent_by_name DROP NOT NULL;
ALTER TABLE public.stock_transfers
    ADD COLUMN IF NOT EXISTS requested_by_name TEXT,
    ADD COLUMN IF NOT EXISTS requested_by_user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS requested_at      TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS request_note      TEXT,
    ADD COLUMN IF NOT EXISTS declined_by_name  TEXT,
    ADD COLUMN IF NOT EXISTS declined_at       TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS decline_reason    TEXT,
    ADD COLUMN IF NOT EXISTS approved_by_name  TEXT,
    ADD COLUMN IF NOT EXISTS approved_at       TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS purchase_id       UUID REFERENCES public.purchases(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS settled_at        TIMESTAMPTZ;

ALTER TABLE public.stock_transfer_items
    ADD COLUMN IF NOT EXISTS quantity_requested   NUMERIC(14,3),
    ADD COLUMN IF NOT EXISTS quantity_late        NUMERIC(14,3) NOT NULL DEFAULT 0 CHECK (quantity_late >= 0),
    ADD COLUMN IF NOT EXISTS quantity_found       NUMERIC(14,3) NOT NULL DEFAULT 0 CHECK (quantity_found >= 0),
    ADD COLUMN IF NOT EXISTS quantity_written_off NUMERIC(14,3) NOT NULL DEFAULT 0 CHECK (quantity_written_off >= 0),
    ADD COLUMN IF NOT EXISTS short_note           TEXT;

-- Books: a line can name the other branch.
DO $$
DECLARE c TEXT;
BEGIN
    FOR c IN SELECT conname FROM pg_constraint
             WHERE conrelid = 'public.acc_lines'::regclass AND contype = 'c' AND pg_get_constraintdef(oid) ILIKE '%party_type%'
    LOOP
        EXECUTE format('ALTER TABLE public.acc_lines DROP CONSTRAINT %I', c);
    END LOOP;
END $$;
ALTER TABLE public.acc_lines ADD CONSTRAINT acc_lines_party_type_check
    CHECK (party_type IN ('customer', 'supplier', 'branch'));

-- Read rules. Every change goes through the functions below.
ALTER TABLE public.buying_settings          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_approval_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_quotes          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_quote_lines     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.supplier_bills           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_receipts        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_receipt_lines   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.supplier_returns         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.supplier_return_lines    ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE r RECORD;
BEGIN
    FOR r IN SELECT * FROM (VALUES
        ('buying_settings',          '''purchases.view'''),
        ('purchase_approval_limits', '''purchases.view'''),
        ('purchase_quotes',          '''purchases.view'''),
        ('purchase_quote_lines',     '''purchases.view'''),
        ('supplier_bills',           '''purchases.view'', ''supplier_bills.manage'', ''accounting.view'''),
        ('purchase_receipts',        '''purchases.view'''),
        ('purchase_receipt_lines',   '''purchases.view'''),
        ('supplier_returns',         '''purchases.view'''),
        ('supplier_return_lines',    '''purchases.view''')
    ) AS t(tbl, perms) LOOP
        EXECUTE format('REVOKE ALL ON public.%I FROM anon, authenticated', r.tbl);
        EXECUTE format('GRANT SELECT ON public.%I TO authenticated', r.tbl);
        EXECUTE format('DROP POLICY IF EXISTS pol_%1$s_select ON public.%1$I', r.tbl);
        EXECUTE format('CREATE POLICY pol_%1$s_select ON public.%1$I FOR SELECT USING (business_id = ANY(public.get_user_business_ids()) AND public.has_permission(business_id, %2$s))', r.tbl, r.perms);
    END LOOP;
END $$;

-- Requesting stock lets someone see their branch's transfers.
DROP POLICY IF EXISTS pol_stock_transfers_select ON public.stock_transfers;
CREATE POLICY pol_stock_transfers_select ON public.stock_transfers
    FOR SELECT USING (
        (from_business_id = ANY(public.get_user_business_ids())
            AND public.has_permission(from_business_id, 'inventory.transfer_stock', 'inventory.receive_stock', 'inventory.stock_history', 'inventory.request_transfer'))
        OR (to_business_id = ANY(public.get_user_business_ids())
            AND public.has_permission(to_business_id, 'inventory.transfer_stock', 'inventory.receive_stock', 'inventory.stock_history', 'inventory.request_transfer'))
    );

-- ---------------------------------------------------------------------------
-- 2. Helpers: who is acting, limits, approval
-- ---------------------------------------------------------------------------

-- The signed-in person's role at a branch; NULL when the database itself is acting.
CREATE OR REPLACE FUNCTION public.fn_my_role(p_business_id UUID)
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT bm.role::TEXT
    FROM public.business_memberships bm
    JOIN public.users u ON u.id = bm.user_id
    WHERE u.auth_user_id = auth.uid() AND bm.business_id = p_business_id AND bm.status = 'Active'
    LIMIT 1;
$$;

-- Inside a buying function: the purchase rules below let it change anything.
CREATE OR REPLACE FUNCTION public.fn_buying_ctx()
RETURNS VOID
LANGUAGE sql
AS $$
    SELECT set_config('app.buying', 'on', TRUE);
$$;

CREATE OR REPLACE FUNCTION public.fn_in_buying_ctx()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
AS $$
    SELECT COALESCE(current_setting('app.buying', TRUE), '') = 'on'
        OR COALESCE(current_setting('role', TRUE), 'none') NOT IN ('anon', 'authenticated');
$$;

-- The limit for a role, or NULL for no limit.
CREATE OR REPLACE FUNCTION public.fn_role_limit(p_business_id UUID, p_role TEXT)
RETURNS NUMERIC
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT CASE WHEN p_role IS NULL OR p_role IN ('Owner', 'Admin', 'Administrator') THEN NULL
           ELSE (SELECT max_amount FROM public.purchase_approval_limits WHERE business_id = p_business_id AND role = p_role) END;
$$;

-- TRUE when an amount is above what the signed-in person may order alone.
CREATE OR REPLACE FUNCTION public.fn_needs_approval(p_business_id UUID, p_amount NUMERIC)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_limit NUMERIC;
BEGIN
    IF COALESCE(current_setting('role', TRUE), 'none') NOT IN ('anon', 'authenticated') THEN
        RETURN FALSE;
    END IF;
    v_limit := public.fn_role_limit(p_business_id, public.fn_my_role(p_business_id));
    RETURN v_limit IS NOT NULL AND COALESCE(p_amount, 0) > v_limit;
END;
$$;

-- TRUE when the signed-in person may approve this amount.
CREATE OR REPLACE FUNCTION public.fn_can_approve(p_business_id UUID, p_amount NUMERIC)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_limit NUMERIC;
BEGIN
    IF NOT public.has_permission(p_business_id, 'purchases.approve') THEN
        RETURN FALSE;
    END IF;
    v_limit := public.fn_role_limit(p_business_id, public.fn_my_role(p_business_id));
    RETURN v_limit IS NULL OR COALESCE(p_amount, 0) <= v_limit;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_purchase_ref(p public.purchases)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT COALESCE(NULLIF(p.reference_number, ''), 'PO-' || upper(left(replace(p.id::TEXT, '-', ''), 8)));
$$;

CREATE OR REPLACE FUNCTION public.fn_qty(p NUMERIC)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT trim(to_char(p, 'FM999999990.###'));
$$;

-- A notice for everyone at a branch who may approve, or for one person.
CREATE OR REPLACE FUNCTION public.fn_buying_notify(
    p_business_id UUID, p_user_id UUID, p_type TEXT, p_title TEXT, p_message TEXT, p_target TEXT, p_payload JSONB
)
RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
    INSERT INTO public.notifications (business_id, user_id, title, message, type, priority, action_type, action_target, payload, created_by)
    VALUES (p_business_id, p_user_id, p_title, p_message, p_type, 'high', 'navigate', p_target, COALESCE(p_payload, '{}'::JSONB), 'system');
$$;

-- ---------------------------------------------------------------------------
-- 3. Purchase rules (apply to the app's own writes too, old versions included)
-- ---------------------------------------------------------------------------
-- The app writes drafts itself. Once ordered, anything that moves a purchase on goes
-- through a function. Saving as "Ordered" above the person's limit becomes
-- "Awaiting approval" instead of failing, so an older app keeps working.
CREATE OR REPLACE FUNCTION public.fn_purchase_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF NEW.requested_by_user_id IS NULL THEN
            NEW.requested_by_user_id := public.fn_my_user_id();
        END IF;
    END IF;
    IF public.fn_in_buying_ctx() THEN
        RETURN NEW;
    END IF;

    IF TG_OP = 'INSERT' THEN
        IF NEW.status NOT IN ('Pending', 'Ordered') THEN
            RAISE EXCEPTION 'Save a new purchase as a draft or as ordered.';
        END IF;
        IF NEW.status = 'Ordered' THEN
            IF public.fn_needs_approval(NEW.business_id, NEW.total_amount) THEN
                NEW.status := 'Awaiting approval';
            ELSE
                NEW.ordered_at := NOW();
                NEW.approved_amount := NEW.total_amount;
            END IF;
        END IF;
        RETURN NEW;
    END IF;

    -- UPDATE
    IF OLD.status IN ('Part received', 'Received') OR EXISTS (SELECT 1 FROM public.purchase_receipts r WHERE r.purchase_id = OLD.id) THEN
        IF NEW.status IS DISTINCT FROM OLD.status OR NEW.total_amount IS DISTINCT FROM OLD.total_amount
           OR NEW.supplier_id IS DISTINCT FROM OLD.supplier_id OR NEW.supplier_name IS DISTINCT FROM OLD.supplier_name THEN
            RAISE EXCEPTION 'Goods have arrived on this purchase, so it can''t be changed. Close it, or return goods to the supplier.';
        END IF;
        RETURN NEW;
    END IF;

    IF NEW.status IS DISTINCT FROM OLD.status THEN
        IF NEW.status = 'Cancelled' THEN
            NULL;
        ELSIF NEW.status = 'Pending' AND OLD.status IN ('RFQ', 'Awaiting approval', 'Ordered') THEN
            NULL;
        ELSIF NEW.status = 'Ordered' AND OLD.status = 'Awaiting approval' THEN
            NEW.status := 'Awaiting approval'; -- an edit saved as ordered stays waiting
        ELSIF NEW.status = 'Ordered' AND OLD.status IN ('Pending', 'RFQ') THEN
            IF public.fn_needs_approval(NEW.business_id, NEW.total_amount) THEN
                NEW.status := 'Awaiting approval';
            ELSE
                NEW.ordered_at := NOW();
                NEW.approved_amount := NEW.total_amount;
            END IF;
        ELSIF NEW.status IN ('Part received', 'Received') THEN
            RAISE EXCEPTION 'Receive the goods with Receive, so stock and the books follow.';
        ELSE
            RAISE EXCEPTION 'A purchase can''t go from % to % here.', OLD.status, NEW.status;
        END IF;
    ELSIF NEW.status = 'Ordered' AND NEW.total_amount > COALESCE(OLD.approved_amount, OLD.total_amount) THEN
        -- Made bigger after it was placed: check the limit again.
        IF public.fn_needs_approval(NEW.business_id, NEW.total_amount) THEN
            NEW.status := 'Awaiting approval';
        ELSE
            NEW.approved_amount := NEW.total_amount;
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_purchase_guard ON public.purchases;
CREATE TRIGGER trg_purchase_guard BEFORE INSERT OR UPDATE ON public.purchases
    FOR EACH ROW EXECUTE FUNCTION public.fn_purchase_guard();

-- Tell approvers when a purchase starts waiting.
CREATE OR REPLACE FUNCTION public.fn_purchase_notify()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF NEW.status = 'Awaiting approval' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM NEW.status) THEN
        PERFORM public.fn_buying_notify(
            NEW.business_id, NULL, 'Purchase Approval', 'Purchase needs approval',
            public.fn_purchase_ref(NEW) || ' to ' || NEW.supplier_name || ' for KSh '
                || trim(to_char(NEW.total_amount, 'FM999,999,999,990.00')) || COALESCE(' from ' || NULLIF(NEW.created_by, ''), '')
                || ' is above their limit.',
            'buying', jsonb_build_object('purchaseId', NEW.id));
    END IF;
    RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_purchase_notify ON public.purchases;
CREATE TRIGGER trg_purchase_notify AFTER INSERT OR UPDATE OF status ON public.purchases
    FOR EACH ROW EXECUTE FUNCTION public.fn_purchase_notify();

-- Lines can't change once goods have arrived; a line for another branch must be one
-- that shares an owner with this one.
CREATE OR REPLACE FUNCTION public.fn_purchase_item_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_p public.purchases%ROWTYPE;
BEGIN
    SELECT * INTO v_p FROM public.purchases WHERE id = COALESCE(NEW.purchase_id, OLD.purchase_id);
    IF NOT FOUND THEN
        RETURN COALESCE(NEW, OLD);
    END IF;
    IF NOT public.fn_in_buying_ctx() THEN
        IF v_p.status IN ('Part received', 'Received') THEN
            RAISE EXCEPTION 'Goods have arrived on this purchase, so its items can''t be changed.';
        END IF;
        IF TG_OP <> 'DELETE' THEN
            NEW.qty_received := COALESCE(CASE WHEN TG_OP = 'UPDATE' THEN OLD.qty_received END, 0);
            NEW.qty_damaged := COALESCE(CASE WHEN TG_OP = 'UPDATE' THEN OLD.qty_damaged END, 0);
        END IF;
    END IF;
    IF TG_OP <> 'DELETE' AND NEW.for_business_id IS NOT NULL THEN
        IF NEW.for_business_id = v_p.business_id THEN
            NEW.for_business_id := NULL;
        ELSIF NOT public.fn_branches_share_owner(v_p.business_id, NEW.for_business_id) THEN
            RAISE EXCEPTION 'You can only buy for another branch of this business.';
        END IF;
    END IF;
    RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_purchase_item_guard ON public.purchase_items;
CREATE TRIGGER trg_purchase_item_guard BEFORE INSERT OR UPDATE OR DELETE ON public.purchase_items
    FOR EACH ROW EXECUTE FUNCTION public.fn_purchase_item_guard();

-- ---------------------------------------------------------------------------
-- 4. Settings: approval limits per role, bill tolerance, safety days
-- ---------------------------------------------------------------------------
-- p_limits: [{ "role": "Manager", "max": 50000 }, ...]. A role left out has no limit.
CREATE OR REPLACE FUNCTION public.save_buying_settings(
    p_business_id UUID, p_tolerance_pct NUMERIC, p_safety_days INTEGER, p_limits JSONB
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_by TEXT := public.fn_my_display_name(p_business_id);
    v_el JSONB;
BEGIN
    PERFORM public.assert_business_member(p_business_id);
    IF NOT public.is_owner_or_admin(p_business_id) THEN
        RAISE EXCEPTION 'Only the owner or an admin can set approval limits.';
    END IF;
    INSERT INTO public.buying_settings (business_id, bill_tolerance_pct, safety_days, updated_by, updated_at)
    VALUES (p_business_id, COALESCE(p_tolerance_pct, 2), COALESCE(p_safety_days, 3), v_by, NOW())
    ON CONFLICT (business_id) DO UPDATE
    SET bill_tolerance_pct = EXCLUDED.bill_tolerance_pct, safety_days = EXCLUDED.safety_days,
        updated_by = v_by, updated_at = NOW();

    DELETE FROM public.purchase_approval_limits WHERE business_id = p_business_id;
    FOR v_el IN SELECT * FROM jsonb_array_elements(COALESCE(p_limits, '[]'::JSONB)) LOOP
        CONTINUE WHEN NULLIF(v_el->>'max', '') IS NULL OR COALESCE(v_el->>'role', '') IN ('', 'Owner', 'Admin', 'Administrator');
        IF (v_el->>'max')::NUMERIC < 0 THEN
            RAISE EXCEPTION 'A limit can''t be below zero.';
        END IF;
        INSERT INTO public.purchase_approval_limits (business_id, role, max_amount, updated_by)
        VALUES (p_business_id, v_el->>'role', round((v_el->>'max')::NUMERIC, 2), v_by)
        ON CONFLICT (business_id, role) DO UPDATE SET max_amount = EXCLUDED.max_amount, updated_by = v_by, updated_at = NOW();
    END LOOP;
END;
$$;

-- Reorder settings for many products at once.
-- p_rows: [{ "productId", "level", "qty", "supplierId", "price", "leadDays" }]; null clears.
CREATE OR REPLACE FUNCTION public.save_reorder_settings(p_business_id UUID, p_rows JSONB)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_el JSONB;
    v_n  INTEGER := 0;
    v_by TEXT := public.fn_my_display_name(p_business_id);
BEGIN
    PERFORM public.assert_business_member(p_business_id);
    PERFORM public.assert_permission(p_business_id, 'products.update', 'inventory.manage', 'purchases.create');
    FOR v_el IN SELECT * FROM jsonb_array_elements(COALESCE(p_rows, '[]'::JSONB)) LOOP
        IF NULLIF(v_el->>'supplierId', '') IS NOT NULL AND NOT EXISTS (
            SELECT 1 FROM public.suppliers WHERE id = (v_el->>'supplierId')::UUID AND business_id = p_business_id) THEN
            RAISE EXCEPTION 'That supplier was not found.';
        END IF;
        UPDATE public.products SET
            reorder_level = round(NULLIF(v_el->>'level', '')::NUMERIC, 3),
            reorder_qty = NULLIF(round(NULLIF(v_el->>'qty', '')::NUMERIC, 3), 0),
            preferred_supplier_id = NULLIF(v_el->>'supplierId', '')::UUID,
            supplier_price = round(NULLIF(v_el->>'price', '')::NUMERIC, 2),
            lead_time_days = NULLIF(v_el->>'leadDays', '')::INTEGER,
            last_modified_by = v_by,
            updated_at = NOW()
        WHERE id = (v_el->>'productId')::UUID AND business_id = p_business_id AND deleted_at IS NULL;
        v_n := v_n + 1;
    END LOOP;
    RETURN v_n;
END;
$$;

-- ---------------------------------------------------------------------------
-- 5. Approval
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.approve_purchase(p_id UUID, p_note TEXT DEFAULT NULL)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_p    public.purchases%ROWTYPE;
    v_me   TEXT;
    v_role TEXT;
BEGIN
    SELECT * INTO v_p FROM public.purchases WHERE id = p_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'That purchase was not found.'; END IF;
    PERFORM public.assert_business_member(v_p.business_id);
    IF v_p.status <> 'Awaiting approval' THEN
        RAISE EXCEPTION 'This purchase is not waiting for approval.';
    END IF;
    IF NOT public.fn_can_approve(v_p.business_id, v_p.total_amount) THEN
        RAISE EXCEPTION 'This amount is above what your role can approve. Ask the owner.';
    END IF;
    v_role := public.fn_my_role(v_p.business_id);
    IF v_p.requested_by_user_id = public.fn_my_user_id() AND COALESCE(v_role, '') NOT IN ('Owner', 'Admin', 'Administrator') THEN
        RAISE EXCEPTION 'Someone else has to approve your own purchase.';
    END IF;
    v_me := public.fn_my_display_name(v_p.business_id);
    PERFORM public.fn_buying_ctx();
    UPDATE public.purchases
    SET status = 'Ordered', approved_amount = total_amount, approved_by = v_me, approved_at = NOW(),
        ordered_at = NOW(), rejected_by = NULL, rejected_at = NULL, reject_reason = NULL,
        notes = CASE WHEN NULLIF(trim(COALESCE(p_note, '')), '') IS NULL THEN notes
                     ELSE trim(COALESCE(notes || E'\n', '') || 'Approved: ' || trim(p_note)) END,
        updated_at = NOW()
    WHERE id = p_id;
    IF v_p.requested_by_user_id IS NOT NULL THEN
        PERFORM public.fn_buying_notify(v_p.business_id, v_p.requested_by_user_id, 'Purchase Approval', 'Purchase approved',
            v_me || ' approved ' || public.fn_purchase_ref(v_p) || ' to ' || v_p.supplier_name || '. It is now ordered.',
            'suppliers', jsonb_build_object('purchaseId', v_p.id));
    END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.reject_purchase(p_id UUID, p_reason TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_p  public.purchases%ROWTYPE;
    v_me TEXT;
BEGIN
    SELECT * INTO v_p FROM public.purchases WHERE id = p_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'That purchase was not found.'; END IF;
    PERFORM public.assert_business_member(v_p.business_id);
    PERFORM public.assert_permission(v_p.business_id, 'purchases.approve');
    IF v_p.status <> 'Awaiting approval' THEN
        RAISE EXCEPTION 'This purchase is not waiting for approval.';
    END IF;
    IF NULLIF(trim(COALESCE(p_reason, '')), '') IS NULL THEN
        RAISE EXCEPTION 'Say why it is not approved.';
    END IF;
    v_me := public.fn_my_display_name(v_p.business_id);
    PERFORM public.fn_buying_ctx();
    UPDATE public.purchases
    SET status = 'Pending', rejected_by = v_me, rejected_at = NOW(), reject_reason = trim(p_reason), updated_at = NOW()
    WHERE id = p_id;
    IF v_p.requested_by_user_id IS NOT NULL THEN
        PERFORM public.fn_buying_notify(v_p.business_id, v_p.requested_by_user_id, 'Purchase Approval', 'Purchase not approved',
            v_me || ' did not approve ' || public.fn_purchase_ref(v_p) || ' to ' || v_p.supplier_name || ': ' || trim(p_reason)
                || '. It is back to a draft.',
            'suppliers', jsonb_build_object('purchaseId', v_p.id));
    END IF;
END;
$$;

-- Places a draft: ordered, or waiting for approval when above the limit.
CREATE OR REPLACE FUNCTION public.place_purchase_order(p_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_p      public.purchases%ROWTYPE;
    v_status TEXT;
BEGIN
    SELECT * INTO v_p FROM public.purchases WHERE id = p_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'That purchase was not found.'; END IF;
    PERFORM public.assert_business_member(v_p.business_id);
    PERFORM public.assert_permission(v_p.business_id, 'purchases.create', 'purchases.update');
    IF v_p.status NOT IN ('Pending', 'RFQ') THEN
        RAISE EXCEPTION 'Only a draft can be placed as an order.';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.purchase_items WHERE purchase_id = p_id) THEN
        RAISE EXCEPTION 'Add at least one item first.';
    END IF;
    v_status := CASE WHEN public.fn_needs_approval(v_p.business_id, v_p.total_amount) THEN 'Awaiting approval' ELSE 'Ordered' END;
    PERFORM public.fn_buying_ctx();
    UPDATE public.purchases
    SET status = v_status,
        ordered_at = CASE WHEN v_status = 'Ordered' THEN NOW() END,
        approved_amount = CASE WHEN v_status = 'Ordered' THEN total_amount END,
        updated_at = NOW()
    WHERE id = p_id;
    UPDATE public.purchase_quotes SET status = 'lost' WHERE purchase_id = p_id AND status IN ('asked', 'priced');
    RETURN v_status;
END;
$$;

-- ---------------------------------------------------------------------------
-- 6. Quotes from suppliers
-- ---------------------------------------------------------------------------
-- Records that a draft was sent to these suppliers. The app sends the message.
CREATE OR REPLACE FUNCTION public.ask_supplier_prices(p_purchase_id UUID, p_supplier_ids UUID[], p_via TEXT DEFAULT NULL)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_p  public.purchases%ROWTYPE;
    v_s  public.suppliers%ROWTYPE;
    v_me TEXT;
    v_n  INTEGER := 0;
BEGIN
    SELECT * INTO v_p FROM public.purchases WHERE id = p_purchase_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'That purchase was not found.'; END IF;
    PERFORM public.assert_business_member(v_p.business_id);
    PERFORM public.assert_permission(v_p.business_id, 'purchases.request_quote');
    IF v_p.status NOT IN ('Pending', 'RFQ') THEN
        RAISE EXCEPTION 'Ask for prices on a draft, before it is ordered.';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.purchase_items WHERE purchase_id = p_purchase_id) THEN
        RAISE EXCEPTION 'Add the items you want prices for first.';
    END IF;
    IF COALESCE(array_length(p_supplier_ids, 1), 0) = 0 THEN
        RAISE EXCEPTION 'Choose at least one supplier.';
    END IF;
    v_me := public.fn_my_display_name(v_p.business_id);
    FOR v_s IN SELECT * FROM public.suppliers WHERE id = ANY(p_supplier_ids) AND business_id = v_p.business_id AND deleted_at IS NULL LOOP
        INSERT INTO public.purchase_quotes (business_id, purchase_id, supplier_id, supplier_name, sent_via, asked_by)
        VALUES (v_p.business_id, v_p.id, v_s.id, COALESCE(NULLIF(v_s.company, ''), v_s.name), NULLIF(trim(COALESCE(p_via, '')), ''), v_me)
        ON CONFLICT (purchase_id, supplier_id) DO UPDATE SET sent_via = COALESCE(EXCLUDED.sent_via, public.purchase_quotes.sent_via), asked_at = NOW();
        v_n := v_n + 1;
    END LOOP;
    IF v_n = 0 THEN
        RAISE EXCEPTION 'Those suppliers were not found.';
    END IF;
    PERFORM public.fn_buying_ctx();
    UPDATE public.purchases SET status = 'RFQ', updated_at = NOW() WHERE id = p_purchase_id;
    RETURN v_n;
END;
$$;

-- p_lines: [{ "itemId", "price", "available" }]
CREATE OR REPLACE FUNCTION public.save_supplier_quote(p_quote_id UUID, p_lines JSONB, p_delivery_days INTEGER DEFAULT NULL, p_note TEXT DEFAULT NULL)
RETURNS NUMERIC
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_q     public.purchase_quotes%ROWTYPE;
    v_el    JSONB;
    v_total NUMERIC;
BEGIN
    SELECT * INTO v_q FROM public.purchase_quotes WHERE id = p_quote_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'That quote was not found.'; END IF;
    PERFORM public.assert_business_member(v_q.business_id);
    PERFORM public.assert_permission(v_q.business_id, 'purchases.request_quote');
    IF v_q.status IN ('won', 'lost') THEN
        RAISE EXCEPTION 'A supplier was already chosen for this purchase.';
    END IF;
    FOR v_el IN SELECT * FROM jsonb_array_elements(COALESCE(p_lines, '[]'::JSONB)) LOOP
        IF NOT EXISTS (SELECT 1 FROM public.purchase_items WHERE id = (v_el->>'itemId')::UUID AND purchase_id = v_q.purchase_id) THEN
            RAISE EXCEPTION 'One of the items is not on this purchase. Refresh and try again.';
        END IF;
        IF COALESCE(NULLIF(v_el->>'price', '')::NUMERIC, 0) < 0 THEN
            RAISE EXCEPTION 'A price can''t be below zero.';
        END IF;
        INSERT INTO public.purchase_quote_lines (business_id, quote_id, purchase_item_id, unit_price, available)
        VALUES (v_q.business_id, v_q.id, (v_el->>'itemId')::UUID, round(COALESCE(NULLIF(v_el->>'price', '')::NUMERIC, 0), 2),
                COALESCE((v_el->>'available')::BOOLEAN, TRUE))
        ON CONFLICT (quote_id, purchase_item_id) DO UPDATE SET unit_price = EXCLUDED.unit_price, available = EXCLUDED.available;
    END LOOP;
    SELECT COALESCE(SUM(round(pi.quantity * ql.unit_price, 2)), 0) INTO v_total
    FROM public.purchase_quote_lines ql JOIN public.purchase_items pi ON pi.id = ql.purchase_item_id
    WHERE ql.quote_id = v_q.id AND ql.available;
    UPDATE public.purchase_quotes
    SET status = 'priced', priced_at = NOW(), total = v_total, delivery_days = p_delivery_days,
        note = NULLIF(trim(COALESCE(p_note, '')), '')
    WHERE id = v_q.id;
    RETURN v_total;
END;
$$;

-- The chosen supplier's prices become the order. Items they can't supply are dropped.
-- Then it is placed like any order (approval if above the limit).
CREATE OR REPLACE FUNCTION public.choose_supplier_quote(p_quote_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_q     public.purchase_quotes%ROWTYPE;
    v_p     public.purchases%ROWTYPE;
    v_total NUMERIC;
BEGIN
    SELECT * INTO v_q FROM public.purchase_quotes WHERE id = p_quote_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'That quote was not found.'; END IF;
    PERFORM public.assert_business_member(v_q.business_id);
    PERFORM public.assert_permission(v_q.business_id, 'purchases.request_quote');
    PERFORM public.assert_permission(v_q.business_id, 'purchases.create', 'purchases.update');
    SELECT * INTO v_p FROM public.purchases WHERE id = v_q.purchase_id FOR UPDATE;
    IF v_p.status NOT IN ('Pending', 'RFQ') THEN
        RAISE EXCEPTION 'This purchase was already ordered.';
    END IF;
    IF v_q.status <> 'priced' THEN
        RAISE EXCEPTION 'Enter this supplier''s prices first.';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.purchase_quote_lines WHERE quote_id = v_q.id AND available) THEN
        RAISE EXCEPTION 'This supplier can''t supply any of the items.';
    END IF;

    PERFORM public.fn_buying_ctx();
    DELETE FROM public.purchase_items pi
    WHERE pi.purchase_id = v_p.id
      AND NOT EXISTS (SELECT 1 FROM public.purchase_quote_lines ql WHERE ql.quote_id = v_q.id AND ql.purchase_item_id = pi.id AND ql.available);
    UPDATE public.purchase_items pi SET price = ql.unit_price
    FROM public.purchase_quote_lines ql
    WHERE ql.quote_id = v_q.id AND ql.purchase_item_id = pi.id;
    SELECT COALESCE(SUM(round(quantity * price, 2)), 0) INTO v_total FROM public.purchase_items WHERE purchase_id = v_p.id;

    UPDATE public.purchase_quotes SET status = CASE WHEN id = v_q.id THEN 'won' ELSE 'lost' END
    WHERE purchase_id = v_p.id;
    UPDATE public.purchases
    SET supplier_id = v_q.supplier_id, supplier_name = v_q.supplier_name, total_amount = v_total,
        status = 'Pending', updated_at = NOW()
    WHERE id = v_p.id;
    RETURN public.place_purchase_order(v_p.id);
END;
$$;

-- ---------------------------------------------------------------------------
-- 7. Receiving in parts
-- ---------------------------------------------------------------------------
-- p_lines: [{ "itemId", "received", "damaged" }]. A line left out is not part of this
-- delivery. Only good goods go into stock; damaged ones are noted on the GRN and stay
-- owed by the supplier. Lines bought for another branch are added here, then a draft
-- transfer to that branch is made for what arrived.
CREATE OR REPLACE FUNCTION public.receive_purchase_lines(
    p_purchase_id UUID, p_lines JSONB, p_note TEXT DEFAULT NULL, p_update_cost BOOLEAN DEFAULT FALSE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_p        public.purchases%ROWTYPE;
    v_item     public.purchase_items%ROWTYPE;
    v_prod     public.products%ROWTYPE;
    v_el       JSONB;
    v_rec      NUMERIC;
    v_dmg      NUMERIC;
    v_left     NUMERIC;
    v_me       TEXT;
    v_ref      TEXT;
    v_receipt  UUID;
    v_no       TEXT;
    v_value    NUMERIC := 0;
    v_dvalue   NUMERIC := 0;
    v_lines    INTEGER := 0;
    v_stocked  INTEGER := 0;
    v_open     BOOLEAN;
    v_tr       UUID;
    v_branch   TEXT;
    v_drafts   INTEGER := 0;
BEGIN
    SELECT * INTO v_p FROM public.purchases WHERE id = p_purchase_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'That purchase was not found.'; END IF;
    PERFORM public.assert_business_member(v_p.business_id);
    PERFORM public.assert_permission(v_p.business_id, 'purchases.update', 'purchases.approve', 'purchases.manage');
    PERFORM public.assert_permission(v_p.business_id, 'inventory.receive_stock', 'inventory.adjust_stock');

    IF v_p.status = 'Received' THEN
        RAISE EXCEPTION 'Everything on this purchase has arrived.';
    ELSIF v_p.status = 'Cancelled' THEN
        RAISE EXCEPTION 'A cancelled purchase can''t be received.';
    ELSIF v_p.status IN ('RFQ', 'Awaiting approval') THEN
        RAISE EXCEPTION 'This purchase isn''t ordered yet (%).', CASE v_p.status WHEN 'RFQ' THEN 'asking suppliers for prices' ELSE 'waiting for approval' END;
    ELSIF v_p.status = 'Pending' AND public.fn_needs_approval(v_p.business_id, v_p.total_amount) THEN
        RAISE EXCEPTION 'This purchase is above your limit. Place the order so it can be approved first.';
    END IF;
    IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' THEN
        RAISE EXCEPTION 'Say what arrived.';
    END IF;

    v_me := public.fn_my_display_name(v_p.business_id);
    v_ref := public.fn_purchase_ref(v_p);
    v_no := public.sd_next_no(v_p.business_id, 'GRN');
    INSERT INTO public.purchase_receipts (business_id, purchase_id, number, received_by, note)
    VALUES (v_p.business_id, v_p.id, v_no, v_me, NULLIF(trim(COALESCE(p_note, '')), ''))
    RETURNING id INTO v_receipt;

    PERFORM public.fn_buying_ctx();

    FOR v_item IN
        SELECT pi.* FROM public.purchase_items pi
        WHERE pi.purchase_id = v_p.id
          AND EXISTS (SELECT 1 FROM jsonb_array_elements(p_lines) e WHERE (e->>'itemId')::UUID = pi.id)
        ORDER BY pi.product_id NULLS LAST, pi.id
        FOR UPDATE
    LOOP
        SELECT e INTO v_el FROM jsonb_array_elements(p_lines) e WHERE (e->>'itemId')::UUID = v_item.id LIMIT 1;
        v_rec := round(COALESCE(NULLIF(v_el->>'received', '')::NUMERIC, 0), 3);
        v_dmg := round(COALESCE(NULLIF(v_el->>'damaged', '')::NUMERIC, 0), 3);
        v_left := v_item.quantity - v_item.qty_received;
        IF v_rec < 0 OR v_dmg < 0 THEN
            RAISE EXCEPTION 'Amounts for % can''t be below zero.', v_item.name;
        END IF;
        IF v_rec > v_left THEN
            RAISE EXCEPTION 'Only % % of % is still to come. Receive that, then restock the extra.',
                public.fn_qty(v_left), v_item.unit, v_item.name;
        END IF;
        IF v_rec + v_dmg > v_left THEN
            RAISE EXCEPTION 'For %, good plus damaged is more than the % % still to come.', v_item.name, public.fn_qty(v_left), v_item.unit;
        END IF;
        CONTINUE WHEN v_rec = 0 AND v_dmg = 0;

        INSERT INTO public.purchase_receipt_lines
            (business_id, receipt_id, purchase_item_id, product_id, name, unit, unit_price, qty_received, qty_damaged)
        VALUES (v_p.business_id, v_receipt, v_item.id, v_item.product_id, v_item.name, v_item.unit, v_item.price, v_rec, v_dmg);
        UPDATE public.purchase_items SET qty_received = qty_received + v_rec, qty_damaged = qty_damaged + v_dmg WHERE id = v_item.id;
        v_value := v_value + round(v_rec * v_item.price, 2);
        v_dvalue := v_dvalue + round(v_dmg * v_item.price, 2);
        v_lines := v_lines + 1;

        IF v_rec > 0 AND v_item.product_id IS NOT NULL THEN
            SELECT * INTO v_prod FROM public.products
            WHERE id = v_item.product_id AND business_id = v_p.business_id AND deleted_at IS NULL
            FOR UPDATE;
            IF FOUND THEN
                UPDATE public.products
                SET stock = stock + v_rec,
                    cost = CASE WHEN p_update_cost THEN v_item.price ELSE cost END,
                    updated_at = NOW()
                WHERE id = v_prod.id;
                INSERT INTO public.inventory_adjustments
                    (business_id, product_id, product_name, type, quantity_adjusted,
                     previous_stock, new_stock, reason, staff_name, reference_number, notes)
                VALUES (
                    v_p.business_id, v_prod.id, v_prod.name, 'Restock', v_rec,
                    v_prod.stock, v_prod.stock + v_rec,
                    'Received from ' || v_p.supplier_name, v_me, v_no,
                    'Purchase ' || v_ref || ' at KSh ' || v_item.price || ' per ' || v_item.unit
                        || CASE WHEN v_dmg > 0 THEN ' · ' || public.fn_qty(v_dmg) || ' damaged, not added' ELSE '' END
                );
                v_stocked := v_stocked + 1;

                -- Central buying: what arrived for another branch goes on a draft transfer.
                IF v_item.for_business_id IS NOT NULL AND v_item.for_business_id <> v_p.business_id
                   AND public.fn_branches_share_owner(v_p.business_id, v_item.for_business_id) THEN
                    SELECT id INTO v_tr FROM public.stock_transfers
                    WHERE from_business_id = v_p.business_id AND to_business_id = v_item.for_business_id
                      AND purchase_id = v_p.id AND status = 'draft'
                    LIMIT 1;
                    IF v_tr IS NULL THEN
                        INSERT INTO public.stock_transfers (reference, from_business_id, to_business_id, status, note, sent_by_name, sent_by_user_id, purchase_id)
                        VALUES (
                            'TR-' || to_char(NOW() AT TIME ZONE 'Africa/Nairobi', 'YYMMDD') || '-' || upper(substr(md5(gen_random_uuid()::TEXT), 1, 5)),
                            v_p.business_id, v_item.for_business_id, 'draft', 'Their share of purchase ' || v_ref,
                            v_me, public.fn_my_user_id(), v_p.id)
                        RETURNING id INTO v_tr;
                        v_drafts := v_drafts + 1;
                    END IF;
                    IF EXISTS (SELECT 1 FROM public.stock_transfer_items WHERE transfer_id = v_tr AND from_product_id = v_prod.id) THEN
                        UPDATE public.stock_transfer_items
                        SET quantity_sent = quantity_sent + v_rec, quantity_requested = COALESCE(quantity_requested, 0) + v_rec
                        WHERE transfer_id = v_tr AND from_product_id = v_prod.id;
                    ELSE
                        INSERT INTO public.stock_transfer_items
                            (transfer_id, from_product_id, product_name, sku, unit, category, unit_cost, unit_price, quantity_sent, quantity_requested)
                        VALUES (v_tr, v_prod.id, v_prod.name, v_prod.sku, v_prod.unit, v_prod.category,
                                CASE WHEN p_update_cost THEN v_item.price ELSE v_prod.cost END, v_prod.price, v_rec, v_rec);
                    END IF;
                    v_tr := NULL;
                END IF;
            END IF;
        END IF;
    END LOOP;

    IF v_lines = 0 THEN
        RAISE EXCEPTION 'Enter how much of at least one item arrived.';
    END IF;

    UPDATE public.purchase_receipts SET total_value = v_value, damaged_value = v_dvalue WHERE id = v_receipt;

    SELECT EXISTS (SELECT 1 FROM public.purchase_items WHERE purchase_id = v_p.id AND qty_received < quantity) INTO v_open;
    UPDATE public.purchases
    SET status = CASE WHEN v_open THEN 'Part received' ELSE 'Received' END,
        received_at = NOW(), received_by = v_me, reference_number = v_ref,
        ordered_at = COALESCE(ordered_at, NOW()),
        approved_amount = COALESCE(approved_amount, total_amount),
        updated_at = NOW()
    WHERE id = v_p.id;

    IF v_drafts > 0 THEN
        PERFORM public.fn_buying_notify(v_p.business_id, NULL, 'Stock Transfer', 'Transfers ready to send',
            'Goods for ' || v_drafts || CASE WHEN v_drafts = 1 THEN ' branch' ELSE ' branches' END || ' arrived on ' || v_ref
                || '. Their transfers are drafted on Stock Transfers; check and send them.',
            'stock-transfers', jsonb_build_object('purchaseId', v_p.id));
    END IF;

    RETURN jsonb_build_object('receiptId', v_receipt, 'number', v_no, 'lines', v_lines, 'stocked', v_stocked,
        'value', v_value, 'damagedValue', v_dvalue, 'complete', NOT v_open, 'transfersDrafted', v_drafts);
END;
$$;

-- The old one-tap receive: everything still to come, in good order.
CREATE OR REPLACE FUNCTION public.receive_purchase(
    p_purchase_id  UUID,
    p_staff_name   TEXT,
    p_update_cost  BOOLEAN DEFAULT FALSE
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_lines JSONB;
    v_r     JSONB;
BEGIN
    SELECT COALESCE(jsonb_agg(jsonb_build_object('itemId', id, 'received', quantity - qty_received)), '[]'::JSONB) INTO v_lines
    FROM public.purchase_items WHERE purchase_id = p_purchase_id AND qty_received < quantity;
    IF jsonb_array_length(v_lines) = 0 THEN
        -- Nothing listed: mark it received, as before.
        PERFORM public.assert_permission((SELECT business_id FROM public.purchases WHERE id = p_purchase_id),
            'purchases.update', 'purchases.approve', 'purchases.manage');
        PERFORM public.fn_buying_ctx();
        UPDATE public.purchases SET status = 'Received', received_at = NOW(),
            received_by = COALESCE(NULLIF(trim(p_staff_name), ''), 'Staff'), updated_at = NOW()
        WHERE id = p_purchase_id AND status NOT IN ('Received', 'Cancelled', 'RFQ', 'Awaiting approval');
        RETURN 0;
    END IF;
    v_r := public.receive_purchase_lines(p_purchase_id, v_lines, NULL, p_update_cost);
    RETURN (v_r->>'stocked')::INTEGER;
END;
$$;

-- Nothing more is coming: the purchase is done with what arrived.
CREATE OR REPLACE FUNCTION public.close_purchase(p_id UUID, p_reason TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_p public.purchases%ROWTYPE;
BEGIN
    SELECT * INTO v_p FROM public.purchases WHERE id = p_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'That purchase was not found.'; END IF;
    PERFORM public.assert_business_member(v_p.business_id);
    PERFORM public.assert_permission(v_p.business_id, 'purchases.update', 'purchases.approve', 'purchases.manage');
    IF v_p.status <> 'Part received' THEN
        RAISE EXCEPTION 'Only a part-received purchase can be closed.';
    END IF;
    IF NULLIF(trim(COALESCE(p_reason, '')), '') IS NULL THEN
        RAISE EXCEPTION 'Say why the rest isn''t coming.';
    END IF;
    PERFORM public.fn_buying_ctx();
    UPDATE public.purchases
    SET status = 'Received', closed_note = trim(p_reason), updated_at = NOW()
    WHERE id = p_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- 8. Supplier bills
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_bill_refresh(p_bill_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_paid NUMERIC;
BEGIN
    SELECT COALESCE(SUM(amount), 0) INTO v_paid FROM public.supplier_payments WHERE bill_id = p_bill_id AND voided_at IS NULL;
    UPDATE public.supplier_bills
    SET paid = v_paid,
        balance = GREATEST(total - v_paid, 0),
        status = CASE WHEN status IN ('void', 'needs_check') THEN status
                      WHEN total - v_paid <= 0 THEN 'paid' ELSE 'open' END
    WHERE id = p_bill_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_supplier_payment_bill()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF NEW.bill_id IS NOT NULL THEN
        PERFORM public.fn_bill_refresh(NEW.bill_id);
    END IF;
    IF TG_OP = 'UPDATE' AND OLD.bill_id IS NOT NULL AND OLD.bill_id IS DISTINCT FROM NEW.bill_id THEN
        PERFORM public.fn_bill_refresh(OLD.bill_id);
    END IF;
    RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_supplier_payment_bill ON public.supplier_payments;
CREATE TRIGGER trg_supplier_payment_bill AFTER INSERT OR UPDATE ON public.supplier_payments
    FOR EACH ROW EXECUTE FUNCTION public.fn_supplier_payment_bill();

-- p_doc: { purchaseId, receiptIds: [uuid], supplierInvoiceNo, billDate, dueDate, subtotal,
--          vatTotal, note }. Receipts left out = all not yet billed on that purchase.
CREATE OR REPLACE FUNCTION public.create_supplier_bill(p_business_id UUID, p_doc JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_p        public.purchases%ROWTYPE;
    v_ids      UUID[];
    v_value    NUMERIC;
    v_sub      NUMERIC := round(COALESCE(NULLIF(p_doc->>'subtotal', '')::NUMERIC, -1), 2);
    v_vat      NUMERIC := round(COALESCE(NULLIF(p_doc->>'vatTotal', '')::NUMERIC, 0), 2);
    v_date     DATE := COALESCE(NULLIF(p_doc->>'billDate', '')::DATE, public.sd_today());
    v_due      DATE;
    v_tol      NUMERIC;
    v_diff     NUMERIC;
    v_status   TEXT;
    v_id       UUID;
    v_no       TEXT;
    v_me       TEXT := public.fn_my_display_name(p_business_id);
    v_lock     DATE;
BEGIN
    PERFORM public.assert_business_member(p_business_id);
    PERFORM public.assert_permission(p_business_id, 'supplier_bills.manage');
    SELECT * INTO v_p FROM public.purchases WHERE id = NULLIF(p_doc->>'purchaseId', '')::UUID AND business_id = p_business_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Choose the purchase this bill is for.'; END IF;
    IF v_sub < 0 THEN RAISE EXCEPTION 'Enter the bill amount before VAT.'; END IF;
    IF v_vat < 0 THEN RAISE EXCEPTION 'VAT can''t be below zero.'; END IF;
    v_due := COALESCE(NULLIF(p_doc->>'dueDate', '')::DATE, v_date + 30);
    IF v_due < v_date THEN RAISE EXCEPTION 'The due date can''t be before the bill date.'; END IF;
    SELECT lock_date INTO v_lock FROM public.acc_settings WHERE business_id = p_business_id;
    IF v_lock IS NOT NULL AND v_date <= v_lock THEN
        RAISE EXCEPTION 'The books are locked up to %. Use a later bill date.', to_char(v_lock, 'DD Mon YYYY');
    END IF;

    IF jsonb_typeof(p_doc->'receiptIds') = 'array' AND jsonb_array_length(p_doc->'receiptIds') > 0 THEN
        SELECT array_agg(value::UUID) INTO v_ids FROM jsonb_array_elements_text(p_doc->'receiptIds');
    ELSE
        SELECT array_agg(id) INTO v_ids FROM public.purchase_receipts WHERE purchase_id = v_p.id AND bill_id IS NULL;
    END IF;
    IF COALESCE(array_length(v_ids, 1), 0) = 0 THEN
        RAISE EXCEPTION 'Nothing on this purchase is waiting for a bill. Receive the goods first.';
    END IF;
    IF EXISTS (SELECT 1 FROM unnest(v_ids) i LEFT JOIN public.purchase_receipts r ON r.id = i
               WHERE r.id IS NULL OR r.purchase_id <> v_p.id OR r.bill_id IS NOT NULL) THEN
        RAISE EXCEPTION 'One of those deliveries is already billed or not on this purchase. Refresh and try again.';
    END IF;
    PERFORM 1 FROM public.purchase_receipts WHERE id = ANY(v_ids) FOR UPDATE;
    SELECT COALESCE(SUM(total_value), 0) INTO v_value FROM public.purchase_receipts WHERE id = ANY(v_ids);

    SELECT COALESCE(bill_tolerance_pct, 2) INTO v_tol FROM public.buying_settings WHERE business_id = p_business_id;
    v_tol := COALESCE(v_tol, 2);
    v_diff := v_sub - v_value;
    v_status := CASE WHEN abs(v_diff) > GREATEST(round(v_value * v_tol / 100, 2), 1) THEN 'needs_check' ELSE 'open' END;

    v_no := public.sd_next_no(p_business_id, 'BILL', v_date);
    INSERT INTO public.supplier_bills (
        business_id, number, supplier_id, supplier_name, purchase_id, supplier_invoice_no, bill_date, due_date,
        subtotal, vat_total, total, receipts_value, difference, status, balance, note, created_by
    ) VALUES (
        p_business_id, v_no, v_p.supplier_id, v_p.supplier_name, v_p.id, NULLIF(trim(COALESCE(p_doc->>'supplierInvoiceNo', '')), ''),
        v_date, v_due, v_sub, v_vat, v_sub + v_vat, v_value, v_diff, v_status, v_sub + v_vat,
        NULLIF(trim(COALESCE(p_doc->>'note', '')), ''), v_me
    ) RETURNING id INTO v_id;
    UPDATE public.purchase_receipts SET bill_id = v_id WHERE id = ANY(v_ids);

    IF v_status = 'needs_check' THEN
        PERFORM public.fn_buying_notify(p_business_id, NULL, 'Purchase Approval', 'Supplier bill needs a check',
            v_no || ' from ' || v_p.supplier_name || ' is KSh ' || trim(to_char(v_sub, 'FM999,999,999,990.00'))
                || ' before VAT, but the goods received are worth KSh ' || trim(to_char(v_value, 'FM999,999,999,990.00')) || '.',
            'buying', jsonb_build_object('billId', v_id));
    END IF;
    RETURN jsonb_build_object('id', v_id, 'number', v_no, 'status', v_status, 'difference', v_diff, 'receiptsValue', v_value);
END;
$$;

-- A bill whose amount differs from the goods received counts once someone checks it.
CREATE OR REPLACE FUNCTION public.approve_supplier_bill(p_id UUID, p_note TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_b public.supplier_bills%ROWTYPE;
BEGIN
    SELECT * INTO v_b FROM public.supplier_bills WHERE id = p_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'That bill was not found.'; END IF;
    PERFORM public.assert_business_member(v_b.business_id);
    PERFORM public.assert_permission(v_b.business_id, 'supplier_bills.manage');
    PERFORM public.assert_permission(v_b.business_id, 'purchases.approve');
    IF v_b.status <> 'needs_check' THEN
        RAISE EXCEPTION 'This bill doesn''t need a check.';
    END IF;
    IF NULLIF(trim(COALESCE(p_note, '')), '') IS NULL THEN
        RAISE EXCEPTION 'Say why the difference is right (e.g. the price went up).';
    END IF;
    UPDATE public.supplier_bills
    SET status = 'open', check_note = trim(p_note), approved_by = public.fn_my_display_name(v_b.business_id), approved_at = NOW()
    WHERE id = p_id;
    PERFORM public.fn_bill_refresh(p_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.void_supplier_bill(p_id UUID, p_reason TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_b public.supplier_bills%ROWTYPE;
BEGIN
    SELECT * INTO v_b FROM public.supplier_bills WHERE id = p_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'That bill was not found.'; END IF;
    PERFORM public.assert_business_member(v_b.business_id);
    PERFORM public.assert_permission(v_b.business_id, 'supplier_bills.manage');
    IF v_b.status = 'void' THEN RETURN; END IF;
    IF EXISTS (SELECT 1 FROM public.supplier_payments WHERE bill_id = p_id AND voided_at IS NULL) THEN
        RAISE EXCEPTION 'This bill has payments. Void them first.';
    END IF;
    IF NULLIF(trim(COALESCE(p_reason, '')), '') IS NULL THEN
        RAISE EXCEPTION 'Say why this bill is void.';
    END IF;
    UPDATE public.supplier_bills
    SET status = 'void', voided_at = NOW(), voided_by = public.fn_my_display_name(v_b.business_id), void_reason = trim(p_reason), balance = 0
    WHERE id = p_id;
    UPDATE public.purchase_receipts SET bill_id = NULL WHERE bill_id = p_id;
END;
$$;

-- Pays a bill (or part of it) through the ordinary supplier payment.
CREATE OR REPLACE FUNCTION public.record_bill_payment(
    p_bill_id UUID, p_amount NUMERIC, p_method TEXT, p_reference TEXT DEFAULT NULL, p_note TEXT DEFAULT NULL, p_paid_at TIMESTAMPTZ DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_b  public.supplier_bills%ROWTYPE;
    v_id UUID;
BEGIN
    SELECT * INTO v_b FROM public.supplier_bills WHERE id = p_bill_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'That bill was not found.'; END IF;
    PERFORM public.assert_business_member(v_b.business_id);
    IF v_b.status = 'needs_check' THEN
        RAISE EXCEPTION 'Check this bill first: its amount differs from the goods received.';
    ELSIF v_b.status = 'void' THEN
        RAISE EXCEPTION 'This bill is void.';
    END IF;
    IF round(COALESCE(p_amount, 0), 2) > v_b.balance THEN
        RAISE EXCEPTION 'Only KSh % is left to pay on this bill.', trim(to_char(v_b.balance, 'FM999,999,999,990.00'));
    END IF;
    v_id := public.record_supplier_payment(v_b.business_id, v_b.supplier_id, v_b.supplier_name, v_b.purchase_id,
        p_amount, p_method, COALESCE(NULLIF(trim(COALESCE(p_reference, '')), ''), v_b.supplier_invoice_no),
        COALESCE(NULLIF(trim(COALESCE(p_note, '')), ''), 'Bill ' || v_b.number), p_paid_at);
    UPDATE public.supplier_payments SET bill_id = v_b.id WHERE id = v_id;
    RETURN v_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- 9. Returns to supplier
-- ---------------------------------------------------------------------------
-- p_doc: { supplierId, supplierName, purchaseId, reason, lines: [{ productId, quantity, unitCost? }] }
-- Cost: what this purchase paid for the product, else the product's cost.
CREATE OR REPLACE FUNCTION public.create_supplier_return(p_business_id UUID, p_doc JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_sid    UUID := NULLIF(p_doc->>'supplierId', '')::UUID;
    v_sname  TEXT := NULLIF(trim(COALESCE(p_doc->>'supplierName', '')), '');
    v_pid    UUID := NULLIF(p_doc->>'purchaseId', '')::UUID;
    v_reason TEXT := NULLIF(trim(COALESCE(p_doc->>'reason', '')), '');
    v_p      public.purchases%ROWTYPE;
    v_el     JSONB;
    v_prod   public.products%ROWTYPE;
    v_qty    NUMERIC;
    v_cost   NUMERIC;
    v_total  NUMERIC := 0;
    v_id     UUID;
    v_no     TEXT;
    v_me     TEXT := public.fn_my_display_name(p_business_id);
BEGIN
    PERFORM public.assert_business_member(p_business_id);
    PERFORM public.assert_permission(p_business_id, 'purchases.update', 'purchases.manage', 'purchases.approve');
    PERFORM public.assert_permission(p_business_id, 'inventory.adjust_stock', 'inventory.receive_stock');
    IF v_reason IS NULL THEN RAISE EXCEPTION 'Say why the goods are going back.'; END IF;
    IF v_pid IS NOT NULL THEN
        SELECT * INTO v_p FROM public.purchases WHERE id = v_pid AND business_id = p_business_id;
        IF NOT FOUND THEN RAISE EXCEPTION 'That purchase was not found.'; END IF;
        v_sid := COALESCE(v_sid, v_p.supplier_id);
        v_sname := COALESCE(v_sname, v_p.supplier_name);
    END IF;
    IF v_sid IS NOT NULL THEN
        SELECT COALESCE(NULLIF(company, ''), name) INTO v_sname FROM public.suppliers WHERE id = v_sid AND business_id = p_business_id;
        IF NOT FOUND THEN RAISE EXCEPTION 'That supplier was not found.'; END IF;
    END IF;
    IF v_sname IS NULL THEN RAISE EXCEPTION 'Choose the supplier.'; END IF;
    IF jsonb_typeof(p_doc->'lines') <> 'array' OR jsonb_array_length(p_doc->'lines') = 0 THEN
        RAISE EXCEPTION 'Add what is going back.';
    END IF;

    v_no := public.sd_next_no(p_business_id, 'RTS');
    INSERT INTO public.supplier_returns (business_id, number, supplier_id, supplier_name, purchase_id, reason, created_by)
    VALUES (p_business_id, v_no, v_sid, v_sname, v_pid, v_reason, v_me)
    RETURNING id INTO v_id;

    FOR v_el IN SELECT * FROM jsonb_array_elements(p_doc->'lines') ORDER BY (value->>'productId') LOOP
        SELECT * INTO v_prod FROM public.products
        WHERE id = NULLIF(v_el->>'productId', '')::UUID AND business_id = p_business_id AND deleted_at IS NULL
        FOR UPDATE;
        IF NOT FOUND THEN RAISE EXCEPTION 'One of the products is not in this branch any more.'; END IF;
        v_qty := round(COALESCE(NULLIF(v_el->>'quantity', '')::NUMERIC, 0), 3);
        IF v_qty <= 0 THEN RAISE EXCEPTION 'Enter how much % is going back.', v_prod.name; END IF;
        IF v_qty > v_prod.stock THEN
            RAISE EXCEPTION 'Only % % of % in stock.', public.fn_qty(v_prod.stock), v_prod.unit, v_prod.name;
        END IF;
        v_cost := NULLIF(v_el->>'unitCost', '')::NUMERIC;
        IF v_cost IS NULL AND v_pid IS NOT NULL THEN
            SELECT price INTO v_cost FROM public.purchase_items WHERE purchase_id = v_pid AND product_id = v_prod.id LIMIT 1;
        END IF;
        v_cost := round(COALESCE(v_cost, v_prod.cost, 0), 2);
        IF v_cost < 0 THEN RAISE EXCEPTION 'A cost can''t be below zero.'; END IF;

        INSERT INTO public.supplier_return_lines (business_id, return_id, product_id, name, unit, quantity, unit_cost)
        VALUES (p_business_id, v_id, v_prod.id, v_prod.name, v_prod.unit, v_qty, v_cost);
        UPDATE public.products SET stock = stock - v_qty, updated_at = NOW() WHERE id = v_prod.id;
        INSERT INTO public.inventory_adjustments
            (business_id, product_id, product_name, type, quantity_adjusted, previous_stock, new_stock,
             reason, staff_name, reference_number, notes)
        VALUES (p_business_id, v_prod.id, v_prod.name, 'Supplier Return', -v_qty, v_prod.stock, v_prod.stock - v_qty,
                'Sent back to ' || v_sname, v_me, v_no, v_reason);
        v_total := v_total + round(v_qty * v_cost, 2);
    END LOOP;

    UPDATE public.supplier_returns SET total = v_total WHERE id = v_id;
    RETURN jsonb_build_object('id', v_id, 'number', v_no, 'total', v_total);
END;
$$;

-- ---------------------------------------------------------------------------
-- 10. Transfers: drafts, approval, requests, shortages
-- ---------------------------------------------------------------------------
-- Value at the sender's cost now, for the approval check.
CREATE OR REPLACE FUNCTION public.fn_transfer_value(p_transfer_id UUID)
RETURNS NUMERIC
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT COALESCE(SUM(i.quantity_sent * COALESCE(p.cost, i.unit_cost)), 0)
    FROM public.stock_transfer_items i
    LEFT JOIN public.products p ON p.id = i.from_product_id
    WHERE i.transfer_id = p_transfer_id;
$$;

-- Takes the stock off the sender and puts the transfer on the way. The lines must
-- already name the sender's products.
CREATE OR REPLACE FUNCTION public.fn_transfer_dispatch(p_transfer_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_t       public.stock_transfers%ROWTYPE;
    v_item    public.stock_transfer_items%ROWTYPE;
    v_prod    public.products%ROWTYPE;
    v_to_name TEXT;
    v_from    TEXT;
    v_me      TEXT;
    v_count   INTEGER := 0;
    v_value   NUMERIC := 0;
BEGIN
    SELECT * INTO v_t FROM public.stock_transfers WHERE id = p_transfer_id FOR UPDATE;
    SELECT name INTO v_to_name FROM public.businesses WHERE id = v_t.to_business_id;
    SELECT name INTO v_from FROM public.businesses WHERE id = v_t.from_business_id;
    v_me := public.fn_my_display_name(v_t.from_business_id);

    FOR v_item IN SELECT * FROM public.stock_transfer_items WHERE transfer_id = v_t.id ORDER BY from_product_id LOOP
        SELECT * INTO v_prod FROM public.products
        WHERE id = v_item.from_product_id AND business_id = v_t.from_business_id AND deleted_at IS NULL
        FOR UPDATE;
        IF NOT FOUND THEN
            RAISE EXCEPTION '% is not in this branch any more. Remove it from the transfer.', v_item.product_name;
        END IF;
        IF v_item.quantity_sent > v_prod.stock THEN
            RAISE EXCEPTION 'Only % % of % left here. You can''t send %.',
                public.fn_qty(v_prod.stock), v_prod.unit, v_prod.name, public.fn_qty(v_item.quantity_sent);
        END IF;
        UPDATE public.stock_transfer_items
        SET product_name = v_prod.name, sku = v_prod.sku, unit = v_prod.unit, category = v_prod.category,
            unit_cost = v_prod.cost, unit_price = v_prod.price
        WHERE id = v_item.id;
        UPDATE public.products SET stock = stock - v_item.quantity_sent, updated_at = NOW() WHERE id = v_prod.id;
        INSERT INTO public.inventory_adjustments (
            business_id, product_id, product_name, type, quantity_adjusted, previous_stock, new_stock,
            reason, staff_name, reference_number, notes
        ) VALUES (
            v_t.from_business_id, v_prod.id, v_prod.name, 'Transfer Out', -v_item.quantity_sent,
            v_prod.stock, v_prod.stock - v_item.quantity_sent,
            'Sent to ' || v_to_name, v_me, v_t.reference, v_t.note
        );
        v_count := v_count + 1;
        v_value := v_value + v_item.quantity_sent * v_prod.cost;
    END LOOP;
    IF v_count = 0 THEN
        RAISE EXCEPTION 'Add at least one product to send.';
    END IF;

    UPDATE public.stock_transfers
    SET status = 'in_transit', sent_at = NOW(),
        sent_by_name = COALESCE(sent_by_name, v_me), sent_by_user_id = COALESCE(sent_by_user_id, public.fn_my_user_id()),
        updated_at = NOW()
    WHERE id = v_t.id;

    INSERT INTO public.notifications (business_id, title, message, type, priority, action_type, action_target, payload, created_by)
    VALUES (
        v_t.to_business_id, 'Stock on the way',
        v_from || ' sent ' || v_count || CASE WHEN v_count = 1 THEN ' product' ELSE ' products' END
            || ' (' || v_t.reference || '). Check it when it arrives and confirm what came.',
        'Stock Transfer', 'high', 'navigate', 'stock-transfers',
        jsonb_build_object('transferId', v_t.id, 'reference', v_t.reference), 'system'
    );
    RETURN jsonb_build_object('id', v_t.id, 'reference', v_t.reference, 'status', 'in_transit', 'lines', v_count, 'costValue', ROUND(v_value, 2));
END;
$$;

-- Sends now, or waits for approval when the value is above the sender's limit.
CREATE OR REPLACE FUNCTION public.fn_transfer_go(p_transfer_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_t     public.stock_transfers%ROWTYPE;
    v_value NUMERIC;
    v_to    TEXT;
BEGIN
    SELECT * INTO v_t FROM public.stock_transfers WHERE id = p_transfer_id FOR UPDATE;
    v_value := public.fn_transfer_value(p_transfer_id);
    IF public.fn_needs_approval(v_t.from_business_id, v_value) THEN
        UPDATE public.stock_transfers SET status = 'awaiting_approval', updated_at = NOW() WHERE id = v_t.id;
        SELECT name INTO v_to FROM public.businesses WHERE id = v_t.to_business_id;
        PERFORM public.fn_buying_notify(v_t.from_business_id, NULL, 'Purchase Approval', 'Transfer needs approval',
            v_t.reference || ' to ' || v_to || ' is worth KSh ' || trim(to_char(v_value, 'FM999,999,999,990'))
                || ' at cost, above ' || COALESCE(v_t.sent_by_name, 'the sender') || '''s limit.',
            'stock-transfers', jsonb_build_object('transferId', v_t.id, 'reference', v_t.reference));
        RETURN jsonb_build_object('id', v_t.id, 'reference', v_t.reference, 'status', 'awaiting_approval', 'costValue', ROUND(v_value, 2));
    END IF;
    RETURN public.fn_transfer_dispatch(p_transfer_id);
END;
$$;

-- Same arguments as before (20261111003). Now checks the approval limit first.
-- p_items: [{ "product_id": uuid, "quantity": number }, ...]
CREATE OR REPLACE FUNCTION public.send_stock_transfer(
    p_from_business_id UUID,
    p_to_business_id   UUID,
    p_items            JSONB,
    p_note             TEXT DEFAULT NULL,
    p_reference_id     TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
    v_existing  public.stock_transfers;
    v_transfer  public.stock_transfers;
    v_line      RECORD;
BEGIN
    PERFORM public.assert_business_member(p_from_business_id);
    PERFORM public.assert_permission(p_from_business_id, 'inventory.transfer_stock');

    IF p_reference_id IS NOT NULL THEN
        SELECT * INTO v_existing FROM public.stock_transfers
        WHERE from_business_id = p_from_business_id AND client_reference = p_reference_id;
        IF FOUND THEN
            RETURN jsonb_build_object('id', v_existing.id, 'reference', v_existing.reference, 'status', v_existing.status);
        END IF;
    END IF;

    IF p_to_business_id IS NULL OR p_to_business_id = p_from_business_id THEN
        RAISE EXCEPTION 'Choose the branch the stock is going to.';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.businesses WHERE id = p_to_business_id AND deleted_at IS NULL)
       OR NOT public.fn_branches_share_owner(p_from_business_id, p_to_business_id) THEN
        RAISE EXCEPTION 'You can only send stock to another branch of this business.';
    END IF;
    IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
        RAISE EXCEPTION 'Add at least one product to send.';
    END IF;
    IF jsonb_array_length(p_items) > 200 THEN
        RAISE EXCEPTION 'Send at most 200 products at a time.';
    END IF;
    IF EXISTS (
        SELECT 1 FROM jsonb_array_elements(p_items) e
        LEFT JOIN public.products p ON p.id = (e->>'product_id')::UUID
        WHERE p.id IS NULL OR p.business_id <> p_from_business_id OR p.deleted_at IS NOT NULL
    ) THEN
        RAISE EXCEPTION 'One of the products is not in this branch any more. Refresh and try again.';
    END IF;

    INSERT INTO public.stock_transfers (
        reference, from_business_id, to_business_id, status, note, sent_by_name, sent_by_user_id, client_reference
    ) VALUES (
        'TR-' || to_char(NOW() AT TIME ZONE 'Africa/Nairobi', 'YYMMDD') || '-' || upper(substr(md5(gen_random_uuid()::TEXT), 1, 5)),
        p_from_business_id, p_to_business_id, 'draft',
        NULLIF(btrim(COALESCE(p_note, '')), ''),
        public.fn_my_display_name(p_from_business_id), public.fn_my_user_id(), p_reference_id
    )
    RETURNING * INTO v_transfer;

    FOR v_line IN
        WITH wanted AS (
            SELECT (e->>'product_id')::UUID AS product_id, SUM((e->>'quantity')::NUMERIC) AS qty
            FROM jsonb_array_elements(p_items) e
            GROUP BY 1
        )
        SELECT p.id, p.name, p.sku, p.unit, p.category, p.cost, p.price, w.qty
        FROM wanted w JOIN public.products p ON p.id = w.product_id
        ORDER BY p.id
    LOOP
        IF v_line.qty IS NULL OR v_line.qty <= 0 THEN
            RAISE EXCEPTION 'Enter how much % to send.', v_line.name;
        END IF;
        INSERT INTO public.stock_transfer_items (
            transfer_id, from_product_id, product_name, sku, unit, category, unit_cost, unit_price, quantity_sent, quantity_requested
        ) VALUES (
            v_transfer.id, v_line.id, v_line.name, v_line.sku, v_line.unit, v_line.category,
            v_line.cost, v_line.price, ROUND(v_line.qty, 3), ROUND(v_line.qty, 3)
        );
    END LOOP;

    RETURN public.fn_transfer_go(v_transfer.id);
END;
$$;

-- A drafted transfer (from central buying) sent, with quantities changed if given.
-- p_items: [{ "item_id", "quantity" }]; 0 drops the line.
CREATE OR REPLACE FUNCTION public.send_draft_transfer(p_transfer_id UUID, p_items JSONB DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_t  public.stock_transfers%ROWTYPE;
    v_el JSONB;
BEGIN
    SELECT * INTO v_t FROM public.stock_transfers WHERE id = p_transfer_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Transfer not found.'; END IF;
    PERFORM public.assert_business_member(v_t.from_business_id);
    PERFORM public.assert_permission(v_t.from_business_id, 'inventory.transfer_stock');
    IF v_t.status <> 'draft' THEN
        RAISE EXCEPTION 'Only a draft transfer can be sent this way.';
    END IF;
    FOR v_el IN SELECT * FROM jsonb_array_elements(COALESCE(p_items, '[]'::JSONB)) LOOP
        IF round(COALESCE(NULLIF(v_el->>'quantity', '')::NUMERIC, 0), 3) <= 0 THEN
            DELETE FROM public.stock_transfer_items WHERE id = (v_el->>'item_id')::UUID AND transfer_id = v_t.id;
        ELSE
            UPDATE public.stock_transfer_items SET quantity_sent = round((v_el->>'quantity')::NUMERIC, 3)
            WHERE id = (v_el->>'item_id')::UUID AND transfer_id = v_t.id;
        END IF;
    END LOOP;
    UPDATE public.stock_transfers
    SET sent_by_name = public.fn_my_display_name(v_t.from_business_id), sent_by_user_id = public.fn_my_user_id()
    WHERE id = v_t.id;
    RETURN public.fn_transfer_go(v_t.id);
END;
$$;

CREATE OR REPLACE FUNCTION public.approve_stock_transfer(p_transfer_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_t    public.stock_transfers%ROWTYPE;
    v_role TEXT;
BEGIN
    SELECT * INTO v_t FROM public.stock_transfers WHERE id = p_transfer_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Transfer not found.'; END IF;
    PERFORM public.assert_business_member(v_t.from_business_id);
    IF v_t.status <> 'awaiting_approval' THEN
        RAISE EXCEPTION 'This transfer is not waiting for approval.';
    END IF;
    IF NOT public.fn_can_approve(v_t.from_business_id, public.fn_transfer_value(v_t.id)) THEN
        RAISE EXCEPTION 'This amount is above what your role can approve. Ask the owner.';
    END IF;
    v_role := public.fn_my_role(v_t.from_business_id);
    IF v_t.sent_by_user_id = public.fn_my_user_id() AND COALESCE(v_role, '') NOT IN ('Owner', 'Admin', 'Administrator') THEN
        RAISE EXCEPTION 'Someone else has to approve your own transfer.';
    END IF;
    UPDATE public.stock_transfers
    SET approved_by_name = public.fn_my_display_name(v_t.from_business_id), approved_at = NOW()
    WHERE id = v_t.id;
    RETURN public.fn_transfer_dispatch(v_t.id);
END;
$$;

-- Ask another branch for stock. p_items: [{ "product_id": my product, "quantity" }]
CREATE OR REPLACE FUNCTION public.request_stock_transfer(
    p_to_business_id UUID, p_from_business_id UUID, p_items JSONB, p_note TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_t    public.stock_transfers%ROWTYPE;
    v_line RECORD;
    v_me   TEXT;
    v_name TEXT;
    v_n    INTEGER := 0;
BEGIN
    PERFORM public.assert_business_member(p_to_business_id);
    PERFORM public.assert_permission(p_to_business_id, 'inventory.request_transfer', 'inventory.transfer_stock');
    IF p_from_business_id IS NULL OR p_from_business_id = p_to_business_id
       OR NOT EXISTS (SELECT 1 FROM public.businesses WHERE id = p_from_business_id AND deleted_at IS NULL)
       OR NOT public.fn_branches_share_owner(p_from_business_id, p_to_business_id) THEN
        RAISE EXCEPTION 'You can only ask another branch of this business.';
    END IF;
    IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
        RAISE EXCEPTION 'Add at least one product to ask for.';
    END IF;
    IF jsonb_array_length(p_items) > 200 THEN
        RAISE EXCEPTION 'Ask for at most 200 products at a time.';
    END IF;
    v_me := public.fn_my_display_name(p_to_business_id);

    INSERT INTO public.stock_transfers (
        reference, from_business_id, to_business_id, status, note, requested_by_name, requested_by_user_id, requested_at, request_note
    ) VALUES (
        'TR-' || to_char(NOW() AT TIME ZONE 'Africa/Nairobi', 'YYMMDD') || '-' || upper(substr(md5(gen_random_uuid()::TEXT), 1, 5)),
        p_from_business_id, p_to_business_id, 'requested', NULLIF(btrim(COALESCE(p_note, '')), ''),
        v_me, public.fn_my_user_id(), NOW(), NULLIF(btrim(COALESCE(p_note, '')), '')
    ) RETURNING * INTO v_t;

    FOR v_line IN
        WITH wanted AS (
            SELECT (e->>'product_id')::UUID AS product_id, SUM((e->>'quantity')::NUMERIC) AS qty
            FROM jsonb_array_elements(p_items) e GROUP BY 1
        )
        SELECT p.*, w.qty FROM wanted w
        JOIN public.products p ON p.id = w.product_id AND p.business_id = p_to_business_id AND p.deleted_at IS NULL
    LOOP
        IF v_line.qty IS NULL OR v_line.qty <= 0 THEN
            RAISE EXCEPTION 'Enter how much % you need.', v_line.name;
        END IF;
        INSERT INTO public.stock_transfer_items (
            transfer_id, to_product_id, product_name, sku, unit, category, unit_cost, unit_price, quantity_sent, quantity_requested
        ) VALUES (
            v_t.id, v_line.id, v_line.name, v_line.sku, v_line.unit, v_line.category, 0, v_line.price,
            ROUND(v_line.qty, 3), ROUND(v_line.qty, 3)
        );
        v_n := v_n + 1;
    END LOOP;
    IF v_n = 0 THEN
        RAISE EXCEPTION 'Those products were not found in this branch. Refresh and try again.';
    END IF;

    SELECT name INTO v_name FROM public.businesses WHERE id = p_to_business_id;
    INSERT INTO public.notifications (business_id, title, message, type, priority, action_type, action_target, payload, created_by)
    VALUES (
        p_from_business_id, 'Stock requested',
        v_name || ' is asking for ' || v_n || CASE WHEN v_n = 1 THEN ' product' ELSE ' products' END
            || ' (' || v_t.reference || ')' || COALESCE(': ' || v_t.request_note, '') || '. Send it or decline.',
        'Stock Transfer', 'high', 'navigate', 'stock-transfers',
        jsonb_build_object('transferId', v_t.id, 'reference', v_t.reference), 'system'
    );
    RETURN jsonb_build_object('id', v_t.id, 'reference', v_t.reference, 'status', 'requested', 'lines', v_n);
END;
$$;

-- The asked branch sends what was asked for (or less). Products are matched by SKU,
-- then name, as when receiving. p_items: [{ "item_id", "quantity" }]; 0 drops the line.
CREATE OR REPLACE FUNCTION public.accept_transfer_request(p_transfer_id UUID, p_items JSONB DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_t    public.stock_transfers%ROWTYPE;
    v_item public.stock_transfer_items%ROWTYPE;
    v_src  public.products%ROWTYPE;
    v_el   JSONB;
    v_qty  NUMERIC;
BEGIN
    SELECT * INTO v_t FROM public.stock_transfers WHERE id = p_transfer_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Transfer not found.'; END IF;
    PERFORM public.assert_business_member(v_t.from_business_id);
    PERFORM public.assert_permission(v_t.from_business_id, 'inventory.transfer_stock');
    IF v_t.status <> 'requested' THEN
        RAISE EXCEPTION 'This request was already answered.';
    END IF;

    FOR v_item IN SELECT * FROM public.stock_transfer_items WHERE transfer_id = v_t.id ORDER BY id LOOP
        SELECT e INTO v_el FROM jsonb_array_elements(COALESCE(p_items, '[]'::JSONB)) e WHERE (e->>'item_id')::UUID = v_item.id LIMIT 1;
        v_qty := CASE WHEN v_el IS NULL OR NULLIF(v_el->>'quantity', '') IS NULL THEN v_item.quantity_sent
                      ELSE round((v_el->>'quantity')::NUMERIC, 3) END;
        IF v_qty <= 0 THEN
            DELETE FROM public.stock_transfer_items WHERE id = v_item.id;
            CONTINUE;
        END IF;
        v_src := NULL;
        IF NULLIF(btrim(COALESCE(v_item.sku, '')), '') IS NOT NULL THEN
            SELECT * INTO v_src FROM public.products
            WHERE business_id = v_t.from_business_id AND sku = v_item.sku AND deleted_at IS NULL LIMIT 1;
        END IF;
        IF v_src.id IS NULL THEN
            SELECT * INTO v_src FROM public.products
            WHERE business_id = v_t.from_business_id AND deleted_at IS NULL
              AND lower(btrim(name)) = lower(btrim(v_item.product_name))
            ORDER BY created_at LIMIT 1;
        END IF;
        IF v_src.id IS NULL THEN
            RAISE EXCEPTION '% isn''t a product here. Set its quantity to 0 to send the rest.', v_item.product_name;
        END IF;
        IF lower(btrim(v_src.unit)) <> lower(btrim(v_item.unit)) THEN
            RAISE EXCEPTION '% is counted in % here but in % there. Make the units match first.', v_item.product_name, v_src.unit, v_item.unit;
        END IF;
        UPDATE public.stock_transfer_items
        SET from_product_id = v_src.id, quantity_sent = v_qty, unit_cost = v_src.cost
        WHERE id = v_item.id;
    END LOOP;
    IF NOT EXISTS (SELECT 1 FROM public.stock_transfer_items WHERE transfer_id = v_t.id) THEN
        RAISE EXCEPTION 'Nothing left to send. Decline the request instead.';
    END IF;
    UPDATE public.stock_transfers
    SET status = 'draft', sent_by_name = public.fn_my_display_name(v_t.from_business_id), sent_by_user_id = public.fn_my_user_id()
    WHERE id = v_t.id;
    RETURN public.fn_transfer_go(v_t.id);
END;
$$;

CREATE OR REPLACE FUNCTION public.decline_transfer_request(p_transfer_id UUID, p_reason TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_t  public.stock_transfers%ROWTYPE;
    v_me TEXT;
BEGIN
    SELECT * INTO v_t FROM public.stock_transfers WHERE id = p_transfer_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Transfer not found.'; END IF;
    PERFORM public.assert_business_member(v_t.from_business_id);
    PERFORM public.assert_permission(v_t.from_business_id, 'inventory.transfer_stock');
    IF v_t.status <> 'requested' THEN
        RAISE EXCEPTION 'This request was already answered.';
    END IF;
    IF NULLIF(btrim(COALESCE(p_reason, '')), '') IS NULL THEN
        RAISE EXCEPTION 'Say why, so the branch knows what to do instead.';
    END IF;
    v_me := public.fn_my_display_name(v_t.from_business_id);
    UPDATE public.stock_transfers
    SET status = 'declined', declined_by_name = v_me, declined_at = NOW(), decline_reason = btrim(p_reason), updated_at = NOW()
    WHERE id = v_t.id;
    INSERT INTO public.notifications (business_id, title, message, type, priority, action_type, action_target, payload, created_by)
    SELECT v_t.to_business_id, 'Stock request declined',
           b.name || ' declined ' || v_t.reference || ': ' || btrim(p_reason),
           'Stock Transfer', 'medium', 'navigate', 'stock-transfers',
           jsonb_build_object('transferId', v_t.id, 'reference', v_t.reference), 'system'
    FROM public.businesses b WHERE b.id = v_t.from_business_id;
END;
$$;

-- Cancel: a request (either branch), a draft or one waiting for approval (sender: no
-- stock has moved), or one on the way (sender: stock goes back, as before).
CREATE OR REPLACE FUNCTION public.cancel_stock_transfer(p_transfer_id UUID, p_reason TEXT)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
    v_t       public.stock_transfers;
    v_item    public.stock_transfer_items;
    v_stock   NUMERIC(14,3);
    v_name    TEXT;
    v_me      TEXT;
    v_side    UUID;
BEGIN
    SELECT * INTO v_t FROM public.stock_transfers WHERE id = p_transfer_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Transfer not found.';
    END IF;
    IF v_t.status IN ('cancelled', 'declined') THEN
        RETURN;
    END IF;
    IF v_t.status = 'received' THEN
        RAISE EXCEPTION 'This transfer was already received, so it can''t be cancelled. Send the stock back with a new transfer.';
    END IF;
    IF NULLIF(btrim(COALESCE(p_reason, '')), '') IS NULL THEN
        RAISE EXCEPTION 'Say why this transfer is being cancelled.';
    END IF;

    IF v_t.status = 'requested' THEN
        IF v_t.to_business_id = ANY(public.get_user_business_ids())
           AND public.has_permission(v_t.to_business_id, 'inventory.request_transfer', 'inventory.transfer_stock') THEN
            v_side := v_t.to_business_id;
        ELSE
            PERFORM public.assert_business_member(v_t.from_business_id);
            PERFORM public.assert_permission(v_t.from_business_id, 'inventory.transfer_stock');
            v_side := v_t.from_business_id;
        END IF;
    ELSE
        PERFORM public.assert_business_member(v_t.from_business_id);
        PERFORM public.assert_permission(v_t.from_business_id, 'inventory.transfer_stock');
        v_side := v_t.from_business_id;
    END IF;
    v_me := public.fn_my_display_name(v_side);

    IF v_t.status = 'in_transit' THEN
        FOR v_item IN SELECT * FROM public.stock_transfer_items WHERE transfer_id = v_t.id ORDER BY from_product_id LOOP
            CONTINUE WHEN v_item.from_product_id IS NULL;
            SELECT stock, name INTO v_stock, v_name FROM public.products WHERE id = v_item.from_product_id FOR UPDATE;
            CONTINUE WHEN NOT FOUND;
            UPDATE public.products SET stock = stock + v_item.quantity_sent, updated_at = NOW() WHERE id = v_item.from_product_id;
            INSERT INTO public.inventory_adjustments (
                business_id, product_id, product_name, type, quantity_adjusted, previous_stock, new_stock,
                reason, staff_name, reference_number, notes
            ) VALUES (
                v_t.from_business_id, v_item.from_product_id, v_name, 'Transfer Return', v_item.quantity_sent,
                v_stock, v_stock + v_item.quantity_sent,
                'Transfer cancelled', v_me, v_t.reference, btrim(p_reason)
            );
        END LOOP;
    END IF;

    UPDATE public.stock_transfers
    SET status = 'cancelled', cancelled_by_name = v_me, cancelled_at = NOW(),
        cancel_reason = btrim(p_reason), updated_at = NOW()
    WHERE id = v_t.id;

    -- Tell the other branch, unless nothing ever reached them (a draft never sent).
    IF v_t.status IN ('in_transit', 'requested') THEN
        INSERT INTO public.notifications (business_id, title, message, type, priority, action_type, action_target, payload, created_by)
        SELECT CASE WHEN v_side = v_t.from_business_id THEN v_t.to_business_id ELSE v_t.from_business_id END,
               CASE WHEN v_t.status = 'requested' THEN 'Stock request withdrawn' ELSE 'Transfer cancelled' END,
               b.name || ' cancelled ' || v_t.reference || ': ' || btrim(p_reason),
               'Stock Transfer', 'medium', 'navigate', 'stock-transfers',
               jsonb_build_object('transferId', v_t.id, 'reference', v_t.reference), 'system'
        FROM public.businesses b WHERE b.id = v_side;
    END IF;
END;
$$;

-- What was short when a transfer arrived, settled line by line:
--   late         the receiver got it later: added to their stock      (receiver)
--   found        it never left the sender: back into their stock      (sender)
--   written_off  lost on the way: a stock loss in the sender's books  (sender)
-- p_lines: [{ "item_id", "action", "quantity" }]; quantity left out = all still short.
CREATE OR REPLACE FUNCTION public.settle_transfer_shortage(p_transfer_id UUID, p_lines JSONB, p_note TEXT DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_t      public.stock_transfers%ROWTYPE;
    v_item   public.stock_transfer_items%ROWTYPE;
    v_el     JSONB;
    v_action TEXT;
    v_open   NUMERIC;
    v_qty    NUMERIC;
    v_prod   public.products%ROWTYPE;
    v_from   TEXT;
    v_to     TEXT;
    v_me     TEXT;
    v_cost   NUMERIC;
    v_n      INTEGER := 0;
    v_note   TEXT := NULLIF(btrim(COALESCE(p_note, '')), '');
BEGIN
    SELECT * INTO v_t FROM public.stock_transfers WHERE id = p_transfer_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Transfer not found.'; END IF;
    IF v_t.status <> 'received' THEN
        RAISE EXCEPTION 'Only a received transfer can have its shortage settled.';
    END IF;
    SELECT name INTO v_from FROM public.businesses WHERE id = v_t.from_business_id;
    SELECT name INTO v_to FROM public.businesses WHERE id = v_t.to_business_id;

    FOR v_el IN SELECT * FROM jsonb_array_elements(COALESCE(p_lines, '[]'::JSONB)) LOOP
        SELECT * INTO v_item FROM public.stock_transfer_items WHERE id = (v_el->>'item_id')::UUID AND transfer_id = v_t.id FOR UPDATE;
        IF NOT FOUND THEN RAISE EXCEPTION 'One of the lines is not on this transfer.'; END IF;
        v_action := v_el->>'action';
        v_open := v_item.quantity_sent - COALESCE(v_item.quantity_received, 0) - v_item.quantity_late
                  - v_item.quantity_found - v_item.quantity_written_off;
        v_qty := COALESCE(round(NULLIF(v_el->>'quantity', '')::NUMERIC, 3), v_open);
        CONTINUE WHEN v_qty = 0;
        IF v_qty < 0 OR v_qty > v_open THEN
            RAISE EXCEPTION 'Only % % of % is still short.', public.fn_qty(v_open), v_item.unit, v_item.product_name;
        END IF;

        IF v_action = 'late' THEN
            PERFORM public.assert_business_member(v_t.to_business_id);
            PERFORM public.assert_permission(v_t.to_business_id, 'inventory.receive_stock', 'inventory.transfer_stock');
            v_me := public.fn_my_display_name(v_t.to_business_id);
            SELECT * INTO v_prod FROM public.products WHERE id = v_item.to_product_id AND deleted_at IS NULL FOR UPDATE;
            IF NOT FOUND THEN RAISE EXCEPTION '% is not in this branch any more.', v_item.product_name; END IF;
            v_cost := CASE WHEN v_prod.stock <= 0 THEN v_item.unit_cost
                           ELSE ROUND((v_prod.stock * v_prod.cost + v_qty * v_item.unit_cost) / (v_prod.stock + v_qty), 2) END;
            UPDATE public.products SET stock = stock + v_qty, cost = v_cost, updated_at = NOW() WHERE id = v_prod.id;
            INSERT INTO public.inventory_adjustments (business_id, product_id, product_name, type, quantity_adjusted,
                previous_stock, new_stock, reason, staff_name, reference_number, notes)
            VALUES (v_t.to_business_id, v_prod.id, v_prod.name, 'Transfer In', v_qty, v_prod.stock, v_prod.stock + v_qty,
                'Arrived late from ' || v_from, v_me, v_t.reference, v_note);
            UPDATE public.stock_transfer_items SET quantity_late = quantity_late + v_qty, short_note = COALESCE(v_note, short_note) WHERE id = v_item.id;
        ELSIF v_action = 'found' THEN
            PERFORM public.assert_business_member(v_t.from_business_id);
            PERFORM public.assert_permission(v_t.from_business_id, 'inventory.transfer_stock');
            v_me := public.fn_my_display_name(v_t.from_business_id);
            SELECT * INTO v_prod FROM public.products WHERE id = v_item.from_product_id AND deleted_at IS NULL FOR UPDATE;
            IF NOT FOUND THEN RAISE EXCEPTION '% is not in this branch any more.', v_item.product_name; END IF;
            UPDATE public.products SET stock = stock + v_qty, updated_at = NOW() WHERE id = v_prod.id;
            INSERT INTO public.inventory_adjustments (business_id, product_id, product_name, type, quantity_adjusted,
                previous_stock, new_stock, reason, staff_name, reference_number, notes)
            VALUES (v_t.from_business_id, v_prod.id, v_prod.name, 'Transfer Return', v_qty, v_prod.stock, v_prod.stock + v_qty,
                'Short on transfer to ' || v_to || ', found here', v_me, v_t.reference, v_note);
            UPDATE public.stock_transfer_items SET quantity_found = quantity_found + v_qty, short_note = COALESCE(v_note, short_note) WHERE id = v_item.id;
        ELSIF v_action = 'written_off' THEN
            PERFORM public.assert_business_member(v_t.from_business_id);
            PERFORM public.assert_permission(v_t.from_business_id, 'inventory.transfer_stock');
            PERFORM public.assert_permission(v_t.from_business_id, 'inventory.wastage', 'inventory.adjust_stock');
            UPDATE public.stock_transfer_items SET quantity_written_off = quantity_written_off + v_qty, short_note = COALESCE(v_note, short_note) WHERE id = v_item.id;
        ELSE
            RAISE EXCEPTION 'Choose: arrived late, found, or written off.';
        END IF;
        v_n := v_n + 1;
    END LOOP;
    IF v_n = 0 THEN
        RAISE EXCEPTION 'Nothing to settle.';
    END IF;
    UPDATE public.stock_transfers SET settled_at = NOW(), updated_at = NOW() WHERE id = v_t.id;
    RETURN jsonb_build_object('id', v_t.id, 'settled', v_n);
END;
$$;

-- Same as 20261111003, with the new fields. Lines carry what is still short.
CREATE OR REPLACE FUNCTION public.list_stock_transfers(p_business_id UUID, p_limit INTEGER DEFAULT 100)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
    v_out JSONB;
BEGIN
    PERFORM public.assert_business_member(p_business_id);
    PERFORM public.assert_permission(p_business_id, 'inventory.transfer_stock', 'inventory.receive_stock', 'inventory.stock_history', 'inventory.request_transfer');

    SELECT COALESCE(jsonb_agg(row_data ORDER BY sort_key DESC), '[]'::JSONB) INTO v_out
    FROM (
        SELECT COALESCE(t.requested_at, t.created_at) AS sort_key,
               jsonb_build_object(
                   'id', t.id,
                   'reference', t.reference,
                   'direction', CASE WHEN t.from_business_id = p_business_id THEN 'out' ELSE 'in' END,
                   'fromBusinessId', t.from_business_id,
                   'fromName', bf.name,
                   'toBusinessId', t.to_business_id,
                   'toName', bt.name,
                   'status', t.status,
                   'note', t.note,
                   'sentBy', t.sent_by_name,
                   'sentAt', t.sent_at,
                   'createdAt', t.created_at,
                   'receivedBy', t.received_by_name,
                   'receivedAt', t.received_at,
                   'receiveNote', t.receive_note,
                   'cancelledBy', t.cancelled_by_name,
                   'cancelledAt', t.cancelled_at,
                   'cancelReason', t.cancel_reason,
                   'requestedBy', t.requested_by_name,
                   'requestedAt', t.requested_at,
                   'requestNote', t.request_note,
                   'declinedBy', t.declined_by_name,
                   'declinedAt', t.declined_at,
                   'declineReason', t.decline_reason,
                   'approvedBy', t.approved_by_name,
                   'approvedAt', t.approved_at,
                   'purchaseId', t.purchase_id,
                   'costValue', (SELECT ROUND(SUM(i.quantity_sent * i.unit_cost), 2) FROM public.stock_transfer_items i WHERE i.transfer_id = t.id),
                   'items', COALESCE((
                       SELECT jsonb_agg(jsonb_build_object(
                           'id', i.id,
                           'fromProductId', i.from_product_id,
                           'toProductId', i.to_product_id,
                           'productName', i.product_name,
                           'sku', i.sku,
                           'unit', i.unit,
                           'unitCost', i.unit_cost,
                           'quantityRequested', i.quantity_requested,
                           'quantitySent', i.quantity_sent,
                           'quantityReceived', i.quantity_received,
                           'quantityLate', i.quantity_late,
                           'quantityFound', i.quantity_found,
                           'quantityWrittenOff', i.quantity_written_off,
                           'stillShort', CASE WHEN t.status = 'received'
                               THEN GREATEST(i.quantity_sent - COALESCE(i.quantity_received, 0) - i.quantity_late - i.quantity_found - i.quantity_written_off, 0)
                               ELSE 0 END
                       ) ORDER BY i.product_name)
                       FROM public.stock_transfer_items i WHERE i.transfer_id = t.id
                   ), '[]'::JSONB)
               ) AS row_data
        FROM public.stock_transfers t
        JOIN public.businesses bf ON bf.id = t.from_business_id
        JOIN public.businesses bt ON bt.id = t.to_business_id
        WHERE (t.from_business_id = p_business_id OR t.to_business_id = p_business_id)
          -- A draft is the sender's own business until it is sent.
          AND NOT (t.status = 'draft' AND t.to_business_id = p_business_id)
        ORDER BY COALESCE(t.requested_at, t.created_at) DESC
        LIMIT LEAST(GREATEST(COALESCE(p_limit, 100), 1), 500)
    ) q;

    RETURN v_out;
END;
$$;

-- Branches this one can send to or ask: requesting is enough to see them.
CREATE OR REPLACE FUNCTION public.list_transfer_branches(p_business_id UUID)
RETURNS TABLE (id UUID, name TEXT, address TEXT)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
    PERFORM public.assert_business_member(p_business_id);
    PERFORM public.assert_permission(p_business_id, 'inventory.transfer_stock', 'inventory.receive_stock', 'inventory.request_transfer', 'purchases.create');
    RETURN QUERY
    SELECT b.id, b.name, b.address
    FROM public.businesses b
    WHERE b.id <> p_business_id AND b.deleted_at IS NULL AND public.fn_branches_share_owner(p_business_id, b.id)
    ORDER BY b.name;
END;
$$;

-- ---------------------------------------------------------------------------
-- 11. Books
-- ---------------------------------------------------------------------------
-- Same as 20261116003 plus four accounts.
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
        ('1210', 'Stock on the way to branches',    'asset',     'in_transit',   'Stock sent to another branch and not yet received there, at cost'),
        ('1300', 'VAT on purchases',                'asset',     'vat_input',    'VAT paid on supplier bills, claimed back from KRA'),
        ('1500', 'Equipment & fixed assets',        'asset',     'fixed_assets', 'Fridges, coolers, motorbikes, furniture'),
        ('1510', 'Depreciation so far',             'asset',     'acc_depreciation', 'Value used up on fixed assets (shown as minus)'),
        ('2000', 'We owe suppliers',                'liability', 'payable',      'Supplier bills not yet paid (payables)'),
        ('2050', 'Goods received, not billed',      'liability', 'grni',         'Goods that arrived before the supplier''s bill, at the order price'),
        ('2100', 'Customer wallet money',           'liability', 'wallets',      'Money customers keep with us in their wallets'),
        ('2150', 'Payments not matched to a sale',  'liability', 'unmatched',    'Walk-in payments received before a sale or customer is known'),
        ('2200', 'VAT to pay KRA',                  'liability', 'vat',          'VAT charged on sales, less VAT paid to KRA'),
        ('2300', 'Loans',                           'liability', 'loans',        'Money borrowed'),
        ('3000', 'Owner''s capital',                'equity',    'capital',      'Money the owner put into the business'),
        ('3050', 'Opening balances',                'equity',    'opening',      'Balances brought in when the books started'),
        ('3100', 'Owner drawings',                  'equity',    'drawings',     'Money the owner took out'),
        ('3200', 'Owner''s account between branches','equity',   'branches',     'Stock moved between branches of the same owner, at cost. Adds up to zero across all branches'),
        ('3900', 'Retained earnings',               'equity',    'retained',     'Profit kept from past years'),
        ('4000', 'Sales',                           'income',    'sales',        'Goods sold, after discounts, without VAT'),
        ('4010', 'Delivery fees',                   'income',    'delivery',     'Delivery charges on sales'),
        ('4900', 'Other income',                    'income',    'other_income', 'Income that is not from sales'),
        ('5000', 'Cost of goods sold',              'expense',   'cogs',         'What the goods sold cost us'),
        ('5100', 'Stock losses & count differences','expense',   'stock_loss',   'Damage, production waste, stock count differences and stock lost between branches'),
        ('5300', 'Loyalty points used on debt',     'expense',   'loyalty',      'Debt paid with loyalty points instead of money'),
        ('6000', 'General expenses',                'expense',   'expenses',     'Expenses without a category'),
        ('6900', 'Depreciation',                    'expense',   'depreciation', 'Value of fixed assets used up this period'),
        ('6990', 'Cash short or over',              'expense',   'cash_diff',    'Differences found when counting money')
    ) AS a(code, name, type, k, d)
    WHERE NOT EXISTS (SELECT 1 FROM public.acc_accounts x WHERE x.business_id = p_business_id AND x.system_key = a.k)
    ON CONFLICT DO NOTHING;
    -- A code already taken by a typed account: use the next free one in that hundred.
    INSERT INTO public.acc_accounts (business_id, code, name, type, system_key, description)
    SELECT p_business_id,
           (SELECT MIN(c)::TEXT FROM generate_series(a.code::INTEGER + 1, a.code::INTEGER + 89) c
            WHERE NOT EXISTS (SELECT 1 FROM public.acc_accounts y WHERE y.business_id = p_business_id AND y.code = c::TEXT)),
           a.name, a.type, a.k, a.d
    FROM (VALUES
        ('1210', 'Stock on the way to branches', 'asset', 'in_transit', 'Stock sent to another branch and not yet received there, at cost'),
        ('1300', 'VAT on purchases', 'asset', 'vat_input', 'VAT paid on supplier bills, claimed back from KRA'),
        ('2050', 'Goods received, not billed', 'liability', 'grni', 'Goods that arrived before the supplier''s bill, at the order price'),
        ('3200', 'Owner''s account between branches', 'equity', 'branches', 'Stock moved between branches of the same owner, at cost. Adds up to zero across all branches')
    ) AS a(code, name, type, k, d)
    WHERE NOT EXISTS (SELECT 1 FROM public.acc_accounts x WHERE x.business_id = p_business_id AND x.system_key = a.k)
    ON CONFLICT DO NOTHING;
    INSERT INTO public.acc_settings (business_id) VALUES (p_business_id) ON CONFLICT DO NOTHING;
END;
$$;

-- What each buying and transfer record posts.
CREATE OR REPLACE FUNCTION public.acc_buying_lines(p_type TEXT, p_id UUID)
RETURNS TABLE (b UUID, d DATE, m TEXT, l JSONB)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_lines JSONB := '[]'::JSONB;
    v_r     public.purchase_receipts%ROWTYPE;
    v_bill  public.supplier_bills%ROWTYPE;
    v_ret   public.supplier_returns%ROWTYPE;
    v_t     public.stock_transfers%ROWTYPE;
    v_p     public.purchases%ROWTYPE;
    v_party TEXT;
    v_sent  NUMERIC;
    v_recv  NUMERIC;
    v_found NUMERIC;
    v_wo    NUMERIC;
    v_from  TEXT;
    v_to    TEXT;
BEGIN
    IF p_type = 'purchase_receipt' THEN
        SELECT * INTO v_r FROM public.purchase_receipts WHERE id = p_id;
        IF NOT FOUND THEN RETURN; END IF;
        SELECT * INTO v_p FROM public.purchases WHERE id = v_r.purchase_id;
        v_party := COALESCE(v_p.supplier_id::TEXT, 'name:' || lower(trim(COALESCE(v_p.supplier_name, ''))));
        v_lines := public.acc_l(v_lines, public.acc_account(v_r.business_id, 'inventory'), v_r.total_value);
        v_lines := public.acc_l(v_lines, public.acc_account(v_r.business_id, 'grni'), -v_r.total_value, 'supplier', v_party, v_p.supplier_name);
        RETURN QUERY SELECT v_r.business_id, (v_r.received_at AT TIME ZONE 'Africa/Nairobi')::DATE,
            'Goods received ' || v_r.number || ' (' || public.fn_purchase_ref(v_p) || ') · ' || COALESCE(v_p.supplier_name, 'Supplier'), v_lines;

    ELSIF p_type = 'supplier_bill' THEN
        SELECT * INTO v_bill FROM public.supplier_bills WHERE id = p_id;
        IF NOT FOUND THEN RETURN; END IF;
        IF v_bill.status IN ('open', 'paid') THEN
            v_party := COALESCE(v_bill.supplier_id::TEXT, 'name:' || lower(trim(v_bill.supplier_name)));
            v_lines := public.acc_l(v_lines, public.acc_account(v_bill.business_id, 'grni'), v_bill.receipts_value, 'supplier', v_party, v_bill.supplier_name);
            v_lines := public.acc_l(v_lines, public.acc_account(v_bill.business_id, 'inventory'), v_bill.difference);
            v_lines := public.acc_l(v_lines, public.acc_account(v_bill.business_id, 'vat_input'), v_bill.vat_total);
            v_lines := public.acc_l(v_lines, public.acc_account(v_bill.business_id, 'payable'), -v_bill.total, 'supplier', v_party, v_bill.supplier_name);
        END IF;
        RETURN QUERY SELECT v_bill.business_id, v_bill.bill_date,
            'Supplier bill ' || v_bill.number || COALESCE(' (their ' || v_bill.supplier_invoice_no || ')', '') || ' · ' || v_bill.supplier_name, v_lines;

    ELSIF p_type = 'supplier_return' THEN
        SELECT * INTO v_ret FROM public.supplier_returns WHERE id = p_id;
        IF NOT FOUND THEN RETURN; END IF;
        v_party := COALESCE(v_ret.supplier_id::TEXT, 'name:' || lower(trim(v_ret.supplier_name)));
        v_lines := public.acc_l(v_lines, public.acc_account(v_ret.business_id, 'payable'), v_ret.total, 'supplier', v_party, v_ret.supplier_name);
        v_lines := public.acc_l(v_lines, public.acc_account(v_ret.business_id, 'inventory'), -v_ret.total);
        RETURN QUERY SELECT v_ret.business_id, (v_ret.created_at AT TIME ZONE 'Africa/Nairobi')::DATE,
            'Returned to supplier ' || v_ret.number || ' · ' || v_ret.supplier_name, v_lines;

    ELSIF p_type IN ('transfer_out', 'transfer_close', 'transfer_in') THEN
        SELECT * INTO v_t FROM public.stock_transfers WHERE id = p_id;
        IF NOT FOUND THEN RETURN; END IF;
        SELECT name INTO v_from FROM public.businesses WHERE id = v_t.from_business_id;
        SELECT name INTO v_to FROM public.businesses WHERE id = v_t.to_business_id;
        SELECT round(COALESCE(SUM(quantity_sent * unit_cost), 0), 2),
               round(COALESCE(SUM((COALESCE(quantity_received, 0) + quantity_late) * unit_cost), 0), 2),
               round(COALESCE(SUM(quantity_found * unit_cost), 0), 2),
               round(COALESCE(SUM(quantity_written_off * unit_cost), 0), 2)
        INTO v_sent, v_recv, v_found, v_wo
        FROM public.stock_transfer_items WHERE transfer_id = v_t.id;

        IF p_type = 'transfer_out' THEN
            IF v_t.status IN ('in_transit', 'received') THEN
                v_lines := public.acc_l(v_lines, public.acc_account(v_t.from_business_id, 'in_transit'), v_sent);
                v_lines := public.acc_l(v_lines, public.acc_account(v_t.from_business_id, 'inventory'), -v_sent);
            END IF;
            RETURN QUERY SELECT v_t.from_business_id, (v_t.sent_at AT TIME ZONE 'Africa/Nairobi')::DATE,
                'Transfer ' || v_t.reference || ' sent to ' || COALESCE(v_to, 'branch'), v_lines;
        ELSIF p_type = 'transfer_close' THEN
            IF v_t.status = 'received' THEN
                v_lines := public.acc_l(v_lines, public.acc_account(v_t.from_business_id, 'branches'), v_recv, 'branch', v_t.to_business_id::TEXT, v_to);
                v_lines := public.acc_l(v_lines, public.acc_account(v_t.from_business_id, 'inventory'), v_found);
                v_lines := public.acc_l(v_lines, public.acc_account(v_t.from_business_id, 'stock_loss'), v_wo);
                v_lines := public.acc_l(v_lines, public.acc_account(v_t.from_business_id, 'in_transit'), -(v_recv + v_found + v_wo));
            END IF;
            RETURN QUERY SELECT v_t.from_business_id, (COALESCE(v_t.settled_at, v_t.received_at, v_t.sent_at) AT TIME ZONE 'Africa/Nairobi')::DATE,
                'Transfer ' || v_t.reference || ' received by ' || COALESCE(v_to, 'branch')
                    || CASE WHEN v_found > 0 OR v_wo > 0 THEN ' (shortage settled)' ELSE '' END, v_lines;
        ELSE
            IF v_t.status = 'received' THEN
                v_lines := public.acc_l(v_lines, public.acc_account(v_t.to_business_id, 'inventory'), v_recv);
                v_lines := public.acc_l(v_lines, public.acc_account(v_t.to_business_id, 'branches'), -v_recv, 'branch', v_t.from_business_id::TEXT, v_from);
            END IF;
            RETURN QUERY SELECT v_t.to_business_id, (COALESCE(v_t.settled_at, v_t.received_at, v_t.sent_at) AT TIME ZONE 'Africa/Nairobi')::DATE,
                'Transfer ' || v_t.reference || ' received from ' || COALESCE(v_from, 'branch'), v_lines;
        END IF;
    END IF;
END;
$$;

-- Same as 20261117001. A purchase posts by itself only when it has no goods received
-- notes (received before this step); new ones post through their GRNs and bills.
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
        IF pu.status = 'Received' AND pu.total_amount > 0
           AND NOT EXISTS (SELECT 1 FROM public.purchase_receipts r WHERE r.purchase_id = pu.id) THEN
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

    ELSIF p_type IN ('purchase_receipt', 'supplier_bill', 'supplier_return', 'transfer_out', 'transfer_close', 'transfer_in') THEN
        -- Buying and transfers (20261118001).
        SELECT r.b, r.d, r.m, r.l INTO v_b, v_date, v_memo, v_lines FROM public.acc_buying_lines(p_type, p_id) r;
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

DROP TRIGGER IF EXISTS trg_acc_purchase_receipt ON public.purchase_receipts;
CREATE CONSTRAINT TRIGGER trg_acc_purchase_receipt AFTER INSERT OR UPDATE ON public.purchase_receipts
    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.acc_trg_post('purchase_receipt');

DROP TRIGGER IF EXISTS trg_acc_supplier_bill ON public.supplier_bills;
CREATE CONSTRAINT TRIGGER trg_acc_supplier_bill AFTER INSERT OR UPDATE ON public.supplier_bills
    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.acc_trg_post('supplier_bill');

DROP TRIGGER IF EXISTS trg_acc_supplier_return ON public.supplier_returns;
CREATE CONSTRAINT TRIGGER trg_acc_supplier_return AFTER INSERT OR UPDATE ON public.supplier_returns
    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.acc_trg_post('supplier_return');

-- A transfer posts in two branches' books. Like acc_trg_post, a failure is saved, never
-- blocks the transfer.
CREATE OR REPLACE FUNCTION public.acc_trg_post_transfer()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_kind TEXT;
    v_biz  UUID;
BEGIN
    FOREACH v_kind IN ARRAY ARRAY['transfer_out', 'transfer_close', 'transfer_in'] LOOP
        v_biz := CASE WHEN v_kind = 'transfer_in' THEN NEW.to_business_id ELSE NEW.from_business_id END;
        BEGIN
            PERFORM public.acc_post_source(v_kind, NEW.id);
        EXCEPTION WHEN OTHERS THEN
            BEGIN
                INSERT INTO public.acc_post_errors (business_id, source_type, source_id, message)
                SELECT v_biz, v_kind, NEW.id, SQLERRM
                WHERE EXISTS (SELECT 1 FROM public.businesses WHERE id = v_biz)
                ON CONFLICT (source_type, source_id) DO UPDATE SET message = EXCLUDED.message, created_at = NOW();
            EXCEPTION WHEN OTHERS THEN
                NULL;
            END;
        END;
    END LOOP;
    RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_acc_stock_transfer ON public.stock_transfers;
CREATE CONSTRAINT TRIGGER trg_acc_stock_transfer AFTER INSERT OR UPDATE ON public.stock_transfers
    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.acc_trg_post_transfer();

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
    ELSIF p_type = 'purchase_receipt' THEN
        RETURN QUERY SELECT id FROM public.purchase_receipts WHERE business_id = p_business_id ORDER BY received_at, id OFFSET p_offset LIMIT p_limit;
    ELSIF p_type = 'supplier_bill' THEN
        RETURN QUERY SELECT id FROM public.supplier_bills WHERE business_id = p_business_id ORDER BY created_at, id OFFSET p_offset LIMIT p_limit;
    ELSIF p_type = 'supplier_return' THEN
        RETURN QUERY SELECT id FROM public.supplier_returns WHERE business_id = p_business_id ORDER BY created_at, id OFFSET p_offset LIMIT p_limit;
    ELSIF p_type IN ('transfer_out', 'transfer_close') THEN
        RETURN QUERY SELECT id FROM public.stock_transfers WHERE from_business_id = p_business_id ORDER BY created_at, id OFFSET p_offset LIMIT p_limit;
    ELSIF p_type = 'transfer_in' THEN
        RETURN QUERY SELECT id FROM public.stock_transfers WHERE to_business_id = p_business_id ORDER BY created_at, id OFFSET p_offset LIMIT p_limit;
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
        'stock_adj', 'sales_delivery', 'sales_invoice', 'invoice_payment', 'credit_note',
        'purchase_receipt', 'supplier_bill', 'supplier_return', 'transfer_out', 'transfer_close', 'transfer_in'));
END;
$$;

-- What we owe suppliers: bills (and purchases received before bills existed), less
-- returns and payments. Goods received but not billed are shown apart.
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
               p.supplier_id, p.supplier_name, 'purchase'::TEXT AS kind, p.id AS purchase_id, NULL::UUID AS bill_id,
               public.fn_purchase_ref(p) AS ref, COALESCE(p.received_at, p.date) AS received, NULL::DATE AS due,
               p.total_amount AS total,
               COALESCE((SELECT SUM(sp.amount) FROM public.supplier_payments sp
                         WHERE sp.purchase_id = p.id AND sp.bill_id IS NULL AND sp.voided_at IS NULL), 0) AS paid
        FROM public.purchases p
        WHERE p.business_id = p_business_id AND p.status = 'Received'
          AND NOT EXISTS (SELECT 1 FROM public.purchase_receipts r WHERE r.purchase_id = p.id)
        UNION ALL
        SELECT COALESCE(b.supplier_id::TEXT, 'name:' || lower(trim(b.supplier_name))),
               b.supplier_id, b.supplier_name, 'bill', b.purchase_id, b.id,
               b.number || COALESCE(' · ' || b.supplier_invoice_no, ''), b.bill_date::TIMESTAMPTZ, b.due_date,
               b.total, b.paid
        FROM public.supplier_bills b
        WHERE b.business_id = p_business_id AND b.status IN ('open', 'paid')
    ), rets AS (
        SELECT COALESCE(r.supplier_id::TEXT, 'name:' || lower(trim(r.supplier_name))) AS party,
               r.supplier_id, r.supplier_name, SUM(r.total) AS total
        FROM public.supplier_returns r WHERE r.business_id = p_business_id GROUP BY 1, 2, 3
    ), unbilled AS (
        SELECT COALESCE(p.supplier_id::TEXT, 'name:' || lower(trim(COALESCE(p.supplier_name, '')))) AS party,
               p.supplier_id, p.supplier_name, SUM(r.total_value) AS total
        FROM public.purchase_receipts r JOIN public.purchases p ON p.id = r.purchase_id
        WHERE r.business_id = p_business_id AND r.bill_id IS NULL
        GROUP BY 1, 2, 3
    ), pays AS (
        SELECT COALESCE(sp.supplier_id::TEXT, 'name:' || lower(trim(sp.supplier_name))) AS party,
               sp.supplier_id, sp.supplier_name, SUM(sp.amount) AS paid,
               SUM(sp.amount) FILTER (WHERE sp.purchase_id IS NULL AND sp.bill_id IS NULL) AS unlinked
        FROM public.supplier_payments sp
        WHERE sp.business_id = p_business_id AND sp.voided_at IS NULL
        GROUP BY 1, 2, 3
    ), parties AS (
        SELECT party, MAX(supplier_id::TEXT) AS supplier_id, MAX(supplier_name) AS name FROM (
            SELECT party, supplier_id, supplier_name FROM bills
            UNION ALL SELECT party, supplier_id, supplier_name FROM pays
            UNION ALL SELECT party, supplier_id, supplier_name FROM rets
            UNION ALL SELECT party, supplier_id, supplier_name FROM unbilled
        ) u GROUP BY party
    )
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'party', pa.party, 'supplierId', pa.supplier_id,
        'name', COALESCE(s.name, pa.name, 'Supplier'), 'phone', s.phone,
        'billed', COALESCE((SELECT SUM(total) FROM bills b WHERE b.party = pa.party), 0),
        'returned', COALESCE((SELECT SUM(total) FROM rets r WHERE r.party = pa.party), 0),
        'notBilled', COALESCE((SELECT SUM(total) FROM unbilled n WHERE n.party = pa.party), 0),
        'paid', COALESCE((SELECT SUM(paid) FROM pays p WHERE p.party = pa.party), 0),
        'owed', COALESCE((SELECT SUM(total) FROM bills b WHERE b.party = pa.party), 0)
                - COALESCE((SELECT SUM(total) FROM rets r WHERE r.party = pa.party), 0)
                - COALESCE((SELECT SUM(paid) FROM pays p WHERE p.party = pa.party), 0),
        'unlinkedPaid', COALESCE((SELECT SUM(unlinked) FROM pays p WHERE p.party = pa.party), 0),
        'bills', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                    'kind', b.kind, 'purchaseId', b.purchase_id, 'billId', b.bill_id, 'ref', b.ref,
                    'received', b.received, 'due', b.due,
                    'total', b.total, 'paid', b.paid, 'owed', b.total - b.paid)
                    ORDER BY b.received DESC)
                 FROM bills b WHERE b.party = pa.party), '[]'::JSONB)
    ) ORDER BY COALESCE(s.name, pa.name)), '[]'::JSONB) INTO v_rows
    FROM parties pa
    LEFT JOIN public.suppliers s ON s.id::TEXT = pa.supplier_id;

    SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'id', sp.id, 'supplierId', sp.supplier_id, 'supplier', sp.supplier_name, 'purchaseId', sp.purchase_id, 'billId', sp.bill_id,
        'amount', sp.amount, 'method', sp.method, 'paidAt', sp.paid_at, 'reference', sp.reference,
        'note', sp.note, 'by', sp.recorded_by, 'voidedAt', sp.voided_at, 'voidReason', sp.void_reason
    ) ORDER BY sp.paid_at DESC), '[]'::JSONB) INTO v_payments
    FROM (SELECT * FROM public.supplier_payments WHERE business_id = p_business_id ORDER BY paid_at DESC LIMIT 300) sp;

    RETURN jsonb_build_object('suppliers', v_rows, 'payments', v_payments,
        'canPay', public.has_permission(p_business_id, 'accounting.manage', 'purchases.approve'));
END;
$$;

-- VAT: now with VAT on purchases. What is owed to KRA is VAT charged less VAT on purchases.
CREATE OR REPLACE FUNCTION public.acc_vat(p_business_id UUID, p_start DATE, p_end DATE)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_rows JSONB;
    v_vat  UUID;
    v_in   UUID;
    v_s    UUID;
    v_d    UUID;
    v_out  NUMERIC;
    v_inb  NUMERIC;
BEGIN
    PERFORM public.assert_business_member(p_business_id);
    PERFORM public.assert_permission(p_business_id, 'accounting.view');
    v_vat := public.acc_account(p_business_id, 'vat');
    v_in := public.acc_account(p_business_id, 'vat_input');
    v_s := public.acc_account(p_business_id, 'sales');
    v_d := public.acc_account(p_business_id, 'delivery');
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'month', to_char(m, 'YYYY-MM'),
        'sales', COALESCE(x.sales, 0), 'taxedSales', COALESCE(x.taxed, 0),
        'vatCharged', COALESCE(x.charged, 0), 'vatOnPurchases', COALESCE(x.input, 0), 'vatPaid', COALESCE(x.paid, 0)
    ) ORDER BY m), '[]'::JSONB) INTO v_rows
    FROM generate_series(date_trunc('month', p_start), date_trunc('month', p_end), INTERVAL '1 month') m
    LEFT JOIN (
        SELECT date_trunc('month', l.entry_date) AS mo,
               SUM(l.credit - l.debit) FILTER (WHERE l.account_id IN (v_s, v_d)) AS sales,
               SUM(l.credit - l.debit) FILTER (WHERE l.account_id IN (v_s, v_d)
                   AND EXISTS (SELECT 1 FROM public.acc_lines v WHERE v.entry_id = l.entry_id AND v.account_id = v_vat)) AS taxed,
               SUM(l.credit) FILTER (WHERE l.account_id = v_vat AND e.source_type IS NOT NULL) AS charged,
               SUM(l.debit - l.credit) FILTER (WHERE l.account_id = v_in AND e.source_type IS NOT NULL) AS input,
               SUM(l.debit) FILTER (WHERE l.account_id = v_vat AND e.source_type IS NULL) AS paid
        FROM public.acc_lines l JOIN public.acc_entries e ON e.id = l.entry_id
        WHERE l.business_id = p_business_id AND l.entry_date BETWEEN p_start AND p_end
          AND l.account_id IN (v_vat, v_in, v_s, v_d)
        GROUP BY 1
    ) x ON x.mo = m;
    SELECT COALESCE(SUM(credit - debit), 0) INTO v_out FROM public.acc_lines WHERE account_id = v_vat;
    SELECT COALESCE(SUM(debit - credit), 0) INTO v_inb FROM public.acc_lines WHERE account_id = v_in;
    RETURN jsonb_build_object(
        'months', v_rows,
        'taxOn', (SELECT COALESCE(is_tax_enabled, FALSE) FROM public.businesses WHERE id = p_business_id),
        'rate', (SELECT tax_percentage FROM public.businesses WHERE id = p_business_id),
        'owedNow', v_out - v_inb,
        'chargedNow', v_out,
        'onPurchasesNow', v_inb
    );
END;
$$;

-- ---------------------------------------------------------------------------
-- 12. Reading
-- ---------------------------------------------------------------------------
-- Every product with its reorder settings, what sold in 30 days, what is already on
-- order or on the way, and whether to buy or ask a branch.
CREATE OR REPLACE FUNCTION public.reorder_overview(p_business_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_safety INTEGER;
    v_out    JSONB;
BEGIN
    PERFORM public.assert_business_member(p_business_id);
    PERFORM public.assert_permission(p_business_id, 'purchases.view', 'purchases.create', 'inventory.request_transfer');
    SELECT safety_days INTO v_safety FROM public.buying_settings WHERE business_id = p_business_id;
    v_safety := COALESCE(v_safety, 3);

    WITH prods AS (
        SELECT p.*, COALESCE(p.reorder_level, NULLIF(p.min_stock, 0)) AS lvl
        FROM public.products p
        WHERE p.business_id = p_business_id AND p.deleted_at IS NULL
    ), sold AS (
        SELECT ti.product_id, SUM(ti.quantity) AS qty
        FROM public.transaction_items ti
        JOIN public.transactions t ON t.id = ti.transaction_id
        WHERE t.business_id = p_business_id AND t.deleted_at IS NULL AND t.timestamp >= NOW() - INTERVAL '30 days'
        GROUP BY ti.product_id
    ), ordered AS (
        SELECT pi.product_id, SUM(GREATEST(pi.quantity - pi.qty_received, 0)) AS qty
        FROM public.purchase_items pi JOIN public.purchases pu ON pu.id = pi.purchase_id
        WHERE pu.business_id = p_business_id AND pu.status IN ('Pending', 'RFQ', 'Awaiting approval', 'Ordered', 'Part received')
          AND pi.product_id IS NOT NULL AND (pi.for_business_id IS NULL OR pi.for_business_id = p_business_id)
        GROUP BY pi.product_id
    ), coming AS (
        SELECT p.id AS product_id, SUM(i.quantity_sent) AS qty
        FROM public.stock_transfers t
        JOIN public.stock_transfer_items i ON i.transfer_id = t.id
        JOIN prods p ON i.to_product_id = p.id
             OR (i.to_product_id IS NULL AND ((NULLIF(i.sku, '') IS NOT NULL AND i.sku = p.sku) OR lower(btrim(i.product_name)) = lower(btrim(p.name))))
        WHERE t.to_business_id = p_business_id AND t.status IN ('requested', 'draft', 'awaiting_approval', 'in_transit')
        GROUP BY p.id
    ), calc AS (
        SELECT p.*, COALESCE(s.qty, 0) AS sold30, COALESCE(o.qty, 0) AS on_order, COALESCE(c.qty, 0) AS on_way,
               CASE WHEN p.lvl IS NOT NULL AND p.stock <= p.lvl
                    THEN GREATEST(COALESCE(p.reorder_qty, p.lvl * 2 - p.stock), 0) ELSE 0 END AS want
        FROM prods p
        LEFT JOIN sold s ON s.product_id = p.id
        LEFT JOIN ordered o ON o.product_id = p.id
        LEFT JOIN coming c ON c.product_id = p.id
    )
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'productId', c.id, 'name', c.name, 'unit', c.unit, 'sku', c.sku, 'category', c.category,
        'stock', c.stock, 'cost', c.cost, 'minStock', c.min_stock,
        'reorderLevel', c.reorder_level, 'reorderQty', c.reorder_qty, 'level', c.lvl,
        'supplierId', c.preferred_supplier_id, 'supplierName', (SELECT COALESCE(NULLIF(s.company, ''), s.name) FROM public.suppliers s WHERE s.id = c.preferred_supplier_id),
        'supplierPrice', c.supplier_price, 'leadDays', c.lead_time_days,
        'sold30', c.sold30, 'avgDaily', round(c.sold30 / 30.0, 3),
        'suggestedLevel', CASE WHEN c.sold30 > 0 THEN ceil(c.sold30 / 30.0 * (COALESCE(c.lead_time_days, 3) + v_safety)) END,
        'onOrder', c.on_order, 'onTheWay', c.on_way,
        'low', c.lvl IS NOT NULL AND c.stock <= c.lvl,
        'need', GREATEST(c.want - c.on_order - c.on_way, 0),
        'transferFrom', CASE WHEN c.want - c.on_order - c.on_way > 0 THEN (
            SELECT jsonb_build_object('businessId', b.id, 'name', b.name, 'productId', x.id, 'spare', x.stock - COALESCE(x.reorder_level, NULLIF(x.min_stock, 0), 0))
            FROM public.businesses b
            JOIN public.products x ON x.business_id = b.id AND x.deleted_at IS NULL
                 AND ((NULLIF(c.sku, '') IS NOT NULL AND x.sku = c.sku) OR lower(btrim(x.name)) = lower(btrim(c.name)))
                 AND lower(btrim(x.unit)) = lower(btrim(c.unit))
            WHERE b.id <> p_business_id AND b.deleted_at IS NULL AND public.fn_branches_share_owner(p_business_id, b.id)
              AND x.stock - COALESCE(x.reorder_level, NULLIF(x.min_stock, 0), 0) >= c.want - c.on_order - c.on_way
            ORDER BY x.stock - COALESCE(x.reorder_level, NULLIF(x.min_stock, 0), 0) DESC
            LIMIT 1) END
    ) ORDER BY (c.lvl IS NOT NULL AND c.stock <= c.lvl) DESC, c.name), '[]'::JSONB) INTO v_out
    FROM calc c;

    RETURN jsonb_build_object('products', v_out, 'safetyDays', v_safety);
END;
$$;

-- One draft purchase per supplier from the suggestions.
-- p_lines: [{ "productId", "quantity", "supplierId"? }]
CREATE OR REPLACE FUNCTION public.create_suggested_purchases(p_business_id UUID, p_lines JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_group RECORD;
    v_line  RECORD;
    v_id    UUID;
    v_name  TEXT;
    v_out   JSONB := '[]'::JSONB;
    v_total NUMERIC;
    v_me    TEXT := public.fn_my_display_name(p_business_id);
BEGIN
    PERFORM public.assert_business_member(p_business_id);
    PERFORM public.assert_permission(p_business_id, 'purchases.create');
    IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) = 0 THEN
        RAISE EXCEPTION 'Choose what to order.';
    END IF;

    FOR v_group IN
        SELECT COALESCE(NULLIF(e->>'supplierId', '')::UUID, p.preferred_supplier_id) AS supplier_id
        FROM jsonb_array_elements(p_lines) e
        JOIN public.products p ON p.id = (e->>'productId')::UUID AND p.business_id = p_business_id AND p.deleted_at IS NULL
        GROUP BY 1
    LOOP
        v_name := NULL;
        IF v_group.supplier_id IS NOT NULL THEN
            SELECT COALESCE(NULLIF(company, ''), name) INTO v_name FROM public.suppliers
            WHERE id = v_group.supplier_id AND business_id = p_business_id;
        END IF;
        INSERT INTO public.purchases (business_id, supplier_id, supplier_name, status, notes, created_by, total_amount)
        VALUES (p_business_id, CASE WHEN v_name IS NOT NULL THEN v_group.supplier_id END,
                COALESCE(v_name, 'Supplier to choose'), 'Pending', 'Made from Suggested orders', v_me, 0)
        RETURNING id INTO v_id;
        v_total := 0;
        FOR v_line IN
            SELECT p.id, p.name, p.unit, COALESCE(p.supplier_price, p.cost, 0) AS price, SUM((e->>'quantity')::NUMERIC) AS qty
            FROM jsonb_array_elements(p_lines) e
            JOIN public.products p ON p.id = (e->>'productId')::UUID AND p.business_id = p_business_id AND p.deleted_at IS NULL
            WHERE COALESCE(NULLIF(e->>'supplierId', '')::UUID, p.preferred_supplier_id) IS NOT DISTINCT FROM v_group.supplier_id
            GROUP BY p.id, p.name, p.unit, p.supplier_price, p.cost
        LOOP
            CONTINUE WHEN COALESCE(v_line.qty, 0) <= 0;
            INSERT INTO public.purchase_items (purchase_id, product_id, name, quantity, unit, price)
            VALUES (v_id, v_line.id, v_line.name, round(v_line.qty, 3), COALESCE(NULLIF(v_line.unit, ''), 'pcs'), round(v_line.price, 2));
            v_total := v_total + round(round(v_line.qty, 3) * round(v_line.price, 2), 2);
        END LOOP;
        IF v_total = 0 AND NOT EXISTS (SELECT 1 FROM public.purchase_items WHERE purchase_id = v_id) THEN
            DELETE FROM public.purchases WHERE id = v_id;
            CONTINUE;
        END IF;
        UPDATE public.purchases SET total_amount = v_total WHERE id = v_id;
        v_out := v_out || jsonb_build_array(jsonb_build_object('id', v_id, 'supplierName', COALESCE(v_name, 'Supplier to choose'), 'total', v_total));
    END LOOP;
    IF jsonb_array_length(v_out) = 0 THEN
        RAISE EXCEPTION 'Enter a quantity for at least one product.';
    END IF;
    RETURN v_out;
END;
$$;

-- Everything the Buying screen shows besides the product list.
CREATE OR REPLACE FUNCTION public.buying_overview(p_business_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_role TEXT := public.fn_my_role(p_business_id);
    v_set  public.buying_settings%ROWTYPE;
BEGIN
    PERFORM public.assert_business_member(p_business_id);
    PERFORM public.assert_permission(p_business_id, 'purchases.view', 'supplier_bills.manage', 'purchases.approve');
    SELECT * INTO v_set FROM public.buying_settings WHERE business_id = p_business_id;

    RETURN jsonb_build_object(
        'settings', jsonb_build_object(
            'tolerancePct', COALESCE(v_set.bill_tolerance_pct, 2),
            'safetyDays', COALESCE(v_set.safety_days, 3),
            'limits', COALESCE((SELECT jsonb_agg(jsonb_build_object('role', role, 'max', max_amount) ORDER BY role)
                                FROM public.purchase_approval_limits WHERE business_id = p_business_id), '[]'::JSONB),
            'canEdit', public.is_owner_or_admin(p_business_id),
            'updatedBy', v_set.updated_by, 'updatedAt', v_set.updated_at),
        'myRole', v_role,
        'myLimit', public.fn_role_limit(p_business_id, v_role),
        'approvals', jsonb_build_object(
            'purchases', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                    'id', p.id, 'ref', public.fn_purchase_ref(p), 'supplier', p.supplier_name, 'total', p.total_amount,
                    'by', p.created_by, 'date', p.date, 'mine', p.requested_by_user_id = public.fn_my_user_id(),
                    'canApprove', public.fn_can_approve(p_business_id, p.total_amount),
                    'items', (SELECT jsonb_agg(jsonb_build_object('name', i.name, 'quantity', i.quantity, 'unit', i.unit, 'price', i.price) ORDER BY i.created_at)
                              FROM public.purchase_items i WHERE i.purchase_id = p.id)
                ) ORDER BY p.date)
                FROM public.purchases p WHERE p.business_id = p_business_id AND p.status = 'Awaiting approval'), '[]'::JSONB),
            'transfers', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                    'id', t.id, 'reference', t.reference, 'toName', b.name, 'by', t.sent_by_name, 'createdAt', t.created_at,
                    'value', round(public.fn_transfer_value(t.id), 2),
                    'mine', t.sent_by_user_id = public.fn_my_user_id(),
                    'canApprove', public.fn_can_approve(p_business_id, public.fn_transfer_value(t.id))
                ) ORDER BY t.created_at)
                FROM public.stock_transfers t JOIN public.businesses b ON b.id = t.to_business_id
                WHERE t.from_business_id = p_business_id AND t.status = 'awaiting_approval'), '[]'::JSONB),
            'bills', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                    'id', sb.id, 'number', sb.number, 'supplier', sb.supplier_name, 'subtotal', sb.subtotal,
                    'receiptsValue', sb.receipts_value, 'difference', sb.difference, 'by', sb.created_by
                ) ORDER BY sb.created_at)
                FROM public.supplier_bills sb WHERE sb.business_id = p_business_id AND sb.status = 'needs_check'), '[]'::JSONB)
        ),
        'toBill', COALESCE((SELECT jsonb_agg(x ORDER BY x->>'supplier') FROM (
            SELECT jsonb_build_object(
                'purchaseId', p.id, 'ref', public.fn_purchase_ref(p), 'supplier', p.supplier_name, 'supplierId', p.supplier_id,
                'value', SUM(r.total_value),
                'receipts', jsonb_agg(jsonb_build_object('id', r.id, 'number', r.number, 'receivedAt', r.received_at, 'value', r.total_value) ORDER BY r.received_at)
            ) AS x
            FROM public.purchase_receipts r JOIN public.purchases p ON p.id = r.purchase_id
            WHERE r.business_id = p_business_id AND r.bill_id IS NULL
            GROUP BY p.id
        ) q), '[]'::JSONB),
        'bills', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                'id', sb.id, 'number', sb.number, 'supplier', sb.supplier_name, 'supplierId', sb.supplier_id, 'purchaseId', sb.purchase_id,
                'purchaseRef', (SELECT public.fn_purchase_ref(p) FROM public.purchases p WHERE p.id = sb.purchase_id),
                'supplierInvoiceNo', sb.supplier_invoice_no, 'billDate', sb.bill_date, 'dueDate', sb.due_date,
                'subtotal', sb.subtotal, 'vatTotal', sb.vat_total, 'total', sb.total, 'receiptsValue', sb.receipts_value,
                'difference', sb.difference, 'status', sb.status, 'checkNote', sb.check_note, 'approvedBy', sb.approved_by,
                'paid', sb.paid, 'balance', sb.balance, 'note', sb.note, 'by', sb.created_by, 'voidReason', sb.void_reason,
                'receipts', (SELECT jsonb_agg(r.number ORDER BY r.received_at) FROM public.purchase_receipts r WHERE r.bill_id = sb.id)
            ) ORDER BY sb.bill_date DESC, sb.number DESC)
            FROM (SELECT * FROM public.supplier_bills WHERE business_id = p_business_id ORDER BY bill_date DESC, created_at DESC LIMIT 300) sb), '[]'::JSONB),
        'returns', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                'id', r.id, 'number', r.number, 'supplier', r.supplier_name, 'purchaseId', r.purchase_id, 'reason', r.reason,
                'total', r.total, 'by', r.created_by, 'createdAt', r.created_at,
                'lines', (SELECT jsonb_agg(jsonb_build_object('name', l.name, 'quantity', l.quantity, 'unit', l.unit, 'unitCost', l.unit_cost))
                          FROM public.supplier_return_lines l WHERE l.return_id = r.id)
            ) ORDER BY r.created_at DESC)
            FROM (SELECT * FROM public.supplier_returns WHERE business_id = p_business_id ORDER BY created_at DESC LIMIT 200) r), '[]'::JSONB),
        'dueSoon', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                'id', sb.id, 'number', sb.number, 'supplier', sb.supplier_name, 'dueDate', sb.due_date, 'balance', sb.balance
            ) ORDER BY sb.due_date)
            FROM public.supplier_bills sb
            WHERE sb.business_id = p_business_id AND sb.status = 'open' AND sb.balance > 0
              AND sb.due_date <= public.sd_today() + 7), '[]'::JSONB)
    );
END;
$$;

-- One purchase's deliveries, supplier quotes, bills and returns.
CREATE OR REPLACE FUNCTION public.purchase_details(p_purchase_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_p public.purchases%ROWTYPE;
BEGIN
    SELECT * INTO v_p FROM public.purchases WHERE id = p_purchase_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'That purchase was not found.'; END IF;
    PERFORM public.assert_business_member(v_p.business_id);
    PERFORM public.assert_permission(v_p.business_id, 'purchases.view');
    RETURN jsonb_build_object(
        'receipts', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                'id', r.id, 'number', r.number, 'receivedAt', r.received_at, 'by', r.received_by, 'note', r.note,
                'value', r.total_value, 'damagedValue', r.damaged_value, 'billId', r.bill_id,
                'billNumber', (SELECT b.number FROM public.supplier_bills b WHERE b.id = r.bill_id),
                'lines', (SELECT jsonb_agg(jsonb_build_object('name', l.name, 'unit', l.unit, 'received', l.qty_received, 'damaged', l.qty_damaged, 'price', l.unit_price))
                          FROM public.purchase_receipt_lines l WHERE l.receipt_id = r.id)
            ) ORDER BY r.received_at)
            FROM public.purchase_receipts r WHERE r.purchase_id = v_p.id), '[]'::JSONB),
        'quotes', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                'id', q.id, 'supplierId', q.supplier_id, 'supplier', q.supplier_name, 'status', q.status, 'sentVia', q.sent_via,
                'deliveryDays', q.delivery_days, 'note', q.note, 'total', q.total, 'askedAt', q.asked_at, 'pricedAt', q.priced_at,
                'phone', s.phone, 'email', s.email,
                'lines', COALESCE((SELECT jsonb_agg(jsonb_build_object('itemId', l.purchase_item_id, 'price', l.unit_price, 'available', l.available))
                          FROM public.purchase_quote_lines l WHERE l.quote_id = q.id), '[]'::JSONB)
            ) ORDER BY q.asked_at)
            FROM public.purchase_quotes q LEFT JOIN public.suppliers s ON s.id = q.supplier_id
            WHERE q.purchase_id = v_p.id), '[]'::JSONB),
        'bills', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                'id', b.id, 'number', b.number, 'status', b.status, 'total', b.total, 'balance', b.balance, 'billDate', b.bill_date
            ) ORDER BY b.bill_date) FROM public.supplier_bills b WHERE b.purchase_id = v_p.id), '[]'::JSONB),
        'returns', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', r.id, 'number', r.number, 'total', r.total, 'createdAt', r.created_at))
            FROM public.supplier_returns r WHERE r.purchase_id = v_p.id), '[]'::JSONB),
        'transfers', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', t.id, 'reference', t.reference, 'status', t.status,
                'toName', (SELECT name FROM public.businesses WHERE id = t.to_business_id)))
            FROM public.stock_transfers t WHERE t.purchase_id = v_p.id), '[]'::JSONB),
        'unbilledValue', COALESCE((SELECT SUM(total_value) FROM public.purchase_receipts WHERE purchase_id = v_p.id AND bill_id IS NULL), 0)
    );
END;
$$;

-- ---------------------------------------------------------------------------
-- 13. Nightly: low stock to reorder, and bills coming due
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.buying_nightly()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_r RECORD;
    v_n INTEGER := 0;
BEGIN
    FOR v_r IN
        SELECT p.business_id, COUNT(*) AS low, string_agg(p.name, ', ' ORDER BY p.name) FILTER (WHERE TRUE) AS names
        FROM public.products p
        JOIN public.businesses b ON b.id = p.business_id AND b.deleted_at IS NULL
        WHERE p.deleted_at IS NULL
          AND COALESCE(p.reorder_level, NULLIF(p.min_stock, 0)) IS NOT NULL
          AND p.stock <= COALESCE(p.reorder_level, NULLIF(p.min_stock, 0))
          AND NOT EXISTS (
              SELECT 1 FROM public.purchase_items pi JOIN public.purchases pu ON pu.id = pi.purchase_id
              WHERE pi.product_id = p.id AND pu.status IN ('Pending', 'RFQ', 'Awaiting approval', 'Ordered', 'Part received')
                AND pi.qty_received < pi.quantity)
          AND NOT EXISTS (
              SELECT 1 FROM public.stock_transfer_items i JOIN public.stock_transfers t ON t.id = i.transfer_id
              WHERE t.to_business_id = p.business_id AND t.status IN ('requested', 'draft', 'awaiting_approval', 'in_transit')
                AND (i.to_product_id = p.id OR lower(btrim(i.product_name)) = lower(btrim(p.name))))
        GROUP BY p.business_id
    LOOP
        CONTINUE WHEN EXISTS (
            SELECT 1 FROM public.notifications n
            WHERE n.business_id = v_r.business_id AND n.type = 'Reorder Suggestion' AND n.created_at > NOW() - INTERVAL '20 hours');
        INSERT INTO public.notifications (business_id, title, message, type, priority, action_type, action_target, payload, created_by)
        VALUES (v_r.business_id, 'Time to reorder',
                v_r.low || CASE WHEN v_r.low = 1 THEN ' product is' ELSE ' products are' END || ' at or below the reorder level and not on order: '
                    || left(v_r.names, 160) || CASE WHEN length(v_r.names) > 160 THEN '…' ELSE '' END || '. See Buying → Reorder.',
                'Reorder Suggestion', 'medium', 'navigate', 'buying', jsonb_build_object('count', v_r.low), 'system');
        v_n := v_n + 1;
    END LOOP;

    FOR v_r IN
        SELECT sb.* FROM public.supplier_bills sb
        JOIN public.businesses b ON b.id = sb.business_id AND b.deleted_at IS NULL
        WHERE sb.status = 'open' AND sb.balance > 0 AND sb.due_date <= public.sd_today() + 3
          AND NOT EXISTS (
              SELECT 1 FROM public.notifications n
              WHERE n.business_id = sb.business_id AND n.type = 'Supplier Bill Due'
                AND n.payload->>'billId' = sb.id::TEXT AND n.created_at > NOW() - INTERVAL '6 days')
    LOOP
        INSERT INTO public.notifications (business_id, title, message, type, priority, action_type, action_target, payload, created_by)
        VALUES (v_r.business_id,
                CASE WHEN v_r.due_date < public.sd_today() THEN 'Supplier bill overdue' ELSE 'Supplier bill due soon' END,
                v_r.number || ' from ' || v_r.supplier_name || ': KSh ' || trim(to_char(v_r.balance, 'FM999,999,999,990'))
                    || CASE WHEN v_r.due_date < public.sd_today() THEN ' was due ' ELSE ' is due ' END || to_char(v_r.due_date, 'DD Mon') || '.',
                'Supplier Bill Due', 'high', 'navigate', 'buying', jsonb_build_object('billId', v_r.id), 'system');
        v_n := v_n + 1;
    END LOOP;
    RETURN v_n;
END;
$$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
        RETURN;
    END IF;
    PERFORM cron.unschedule(j.jobname) FROM cron.job j WHERE j.jobname = 'buying-nightly';
    -- 04:15 UTC = 07:15 in Nairobi, before most shops open.
    PERFORM cron.schedule('buying-nightly', '15 4 * * *', 'SELECT public.buying_nightly()');
END;
$$;

-- Notifications: who sees the new kinds.
CREATE OR REPLACE FUNCTION public.fn_notification_catalog()
RETURNS TABLE (category TEXT, types TEXT[], permissions TEXT[], locked BOOLEAN)
LANGUAGE sql
IMMUTABLE
AS $$
    VALUES
        ('stock', ARRAY['Stock Almost Finished', 'Out Of Stock', 'Stock Transfer'], ARRAY['inventory.view'], FALSE),
        ('buying', ARRAY['Reorder Suggestion', 'Supplier Bill Due'], ARRAY['purchases.create', 'supplier_bills.manage'], FALSE),
        ('approvals', ARRAY['Purchase Approval'], ARRAY['purchases.approve'], FALSE),
        ('sales', ARRAY['Sales Summary', 'Daily Report', 'Weekly Report', 'Monthly Report'], ARRAY['reports.sales'], FALSE),
        ('debts', ARRAY['Debt Due Reminder', 'Credit Sale'], ARRAY['customers.debts'], FALSE),
        ('deliveries', ARRAY['Delivery Assigned', 'Delivery Completed'], ARRAY['deliveries.view'], FALSE),
        ('payments', ARRAY['Payment Received', 'Low Cash Balance'], ARRAY['payments.view', 'payments.verify'], FALSE),
        ('online_store', ARRAY['Online Store'], ARRAY['online_store.view'], FALSE),
        ('schedules', ARRAY['Schedule Reminder', 'Scheduled Reminder'], NULL::TEXT[], FALSE),
        ('unaccepted', ARRAY['Alert Not Accepted'], ARRAY['staff.view'], FALSE),
        ('ai', ARRAY['AI Business Insight', 'AI Recommendation', 'AI Risk Alert'], ARRAY['ai.insights'], FALSE),
        ('announcements', ARRAY['Business Announcement', 'Custom Notification'], NULL::TEXT[], FALSE),
        ('account', ARRAY['Role Invitation', 'Account Activity', 'System Update'], NULL::TEXT[], TRUE);
$$;

-- ---------------------------------------------------------------------------
-- 14. Grants
-- ---------------------------------------------------------------------------
DO $$
DECLARE f TEXT;
BEGIN
    FOREACH f IN ARRAY ARRAY[
        'fn_my_role(UUID)', 'fn_buying_ctx()', 'fn_in_buying_ctx()', 'fn_role_limit(UUID, TEXT)', 'fn_needs_approval(UUID, NUMERIC)',
        'fn_can_approve(UUID, NUMERIC)', 'fn_buying_notify(UUID, UUID, TEXT, TEXT, TEXT, TEXT, JSONB)', 'fn_purchase_guard()',
        'fn_purchase_notify()', 'fn_purchase_item_guard()', 'fn_bill_refresh(UUID)', 'fn_supplier_payment_bill()',
        'fn_transfer_value(UUID)', 'fn_transfer_dispatch(UUID)', 'fn_transfer_go(UUID)', 'acc_buying_lines(TEXT, UUID)',
        'acc_trg_post_transfer()', 'buying_nightly()'
    ] LOOP
        EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon, authenticated', f);
    END LOOP;
    FOREACH f IN ARRAY ARRAY[
        'save_buying_settings(UUID, NUMERIC, INTEGER, JSONB)', 'save_reorder_settings(UUID, JSONB)',
        'approve_purchase(UUID, TEXT)', 'reject_purchase(UUID, TEXT)', 'place_purchase_order(UUID)',
        'ask_supplier_prices(UUID, UUID[], TEXT)', 'save_supplier_quote(UUID, JSONB, INTEGER, TEXT)', 'choose_supplier_quote(UUID)',
        'receive_purchase_lines(UUID, JSONB, TEXT, BOOLEAN)', 'receive_purchase(UUID, TEXT, BOOLEAN)', 'close_purchase(UUID, TEXT)',
        'create_supplier_bill(UUID, JSONB)', 'approve_supplier_bill(UUID, TEXT)', 'void_supplier_bill(UUID, TEXT)',
        'record_bill_payment(UUID, NUMERIC, TEXT, TEXT, TEXT, TIMESTAMPTZ)', 'create_supplier_return(UUID, JSONB)',
        'send_stock_transfer(UUID, UUID, JSONB, TEXT, TEXT)', 'send_draft_transfer(UUID, JSONB)', 'approve_stock_transfer(UUID)',
        'request_stock_transfer(UUID, UUID, JSONB, TEXT)', 'accept_transfer_request(UUID, JSONB)', 'decline_transfer_request(UUID, TEXT)',
        'cancel_stock_transfer(UUID, TEXT)', 'settle_transfer_shortage(UUID, JSONB, TEXT)', 'list_stock_transfers(UUID, INTEGER)',
        'list_transfer_branches(UUID)', 'reorder_overview(UUID)', 'create_suggested_purchases(UUID, JSONB)',
        'buying_overview(UUID)', 'purchase_details(UUID)'
    ] LOOP
        EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon', f);
        EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated', f);
    END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 15. Role defaults (mirrors SYSTEM_ROLES in src/utils/permissions.ts; a test compares them)
-- Managers ask suppliers for prices, enter supplier bills and ask other branches for stock.
-- ---------------------------------------------------------------------------
INSERT INTO public.role_default_permissions (role, permissions) VALUES
    ('Manager', ARRAY['accounting.view', 'ai.insights', 'ai.use', 'assets.view', 'bom.create', 'bom.update', 'bom.view', 'business.switch', 'business.view', 'communication.send', 'communication.view', 'complaints.reply', 'complaints.view', 'customers.create', 'customers.debts', 'customers.loyalty', 'customers.manage', 'customers.schedules', 'customers.update', 'customers.view', 'dashboard.view', 'deliveries.assign', 'deliveries.cancel', 'deliveries.complete', 'deliveries.create', 'deliveries.view', 'expenses.create', 'expenses.update', 'expenses.view', 'files.view', 'finance.view', 'home.view', 'inventory.adjust_stock', 'inventory.expiry', 'inventory.receive_stock', 'inventory.request_transfer', 'inventory.stock_count', 'inventory.stock_history', 'inventory.transfer_stock', 'inventory.view', 'inventory.wastage', 'invoices.manage', 'invoices.view', 'loyalty.adjust', 'notifications.send', 'notifications.view', 'online_store.view', 'orders.assign_rider', 'orders.complete', 'orders.create', 'orders.update', 'orders.view', 'payments.card', 'payments.cash', 'payments.verify', 'payments.view', 'pettycash.record', 'pos.close_shift', 'pos.create_sale', 'pos.open_shift', 'pos.walkin_customer', 'production.approve', 'production.create', 'production.update', 'production.view', 'products.create', 'products.export', 'products.import', 'products.manage_categories', 'products.update', 'products.view', 'purchases.approve', 'purchases.create', 'purchases.export', 'purchases.print', 'purchases.request_quote', 'purchases.update', 'purchases.view', 'quotes.manage', 'quotes.view', 'refunds.create', 'reports.customers', 'reports.deliveries', 'reports.inventory', 'reports.profit', 'reports.sales', 'reports.view', 'sales_orders.manage', 'sales_orders.view', 'settings.tax', 'settings.theme', 'settings.update', 'settings.view', 'staff.schedule', 'staff.view', 'supplier_bills.manage', 'suppliers.create', 'suppliers.export', 'suppliers.import', 'suppliers.update', 'suppliers.view']),
    ('Cashier', ARRAY['ai.use', 'business.view', 'complaints.view', 'customers.create', 'customers.debts', 'customers.loyalty', 'customers.schedules', 'customers.view', 'dashboard.view', 'inventory.view', 'notifications.view', 'online_store.view', 'orders.assign_rider', 'orders.create', 'orders.update', 'orders.view', 'payments.card', 'payments.cash', 'payments.mpesa', 'payments.airtel', 'payments.verify', 'pettycash.record', 'pos.cancel_sale', 'pos.close_shift', 'pos.create_sale', 'pos.discount', 'pos.open_shift', 'pos.walkin_customer', 'products.view', 'settings.theme']),
    ('Rider', ARRAY['ai.use', 'business.view', 'dashboard.view', 'deliveries.cancel', 'deliveries.complete', 'deliveries.delivery_price', 'deliveries.delivery_zones', 'deliveries.view', 'notifications.view', 'settings.theme'])
ON CONFLICT (role) DO UPDATE SET permissions = EXCLUDED.permissions;

-- ---------------------------------------------------------------------------
-- 16. New accounts for every business, and transfers made before this step into the books
-- ---------------------------------------------------------------------------
DO $$
DECLARE
    v_b UUID;
    v_t RECORD;
    v_k TEXT;
BEGIN
    FOR v_b IN SELECT id FROM public.businesses WHERE EXISTS (SELECT 1 FROM public.acc_accounts a WHERE a.business_id = businesses.id) LOOP
        PERFORM public.acc_ensure_accounts(v_b);
    END LOOP;
    FOR v_t IN SELECT id, from_business_id, to_business_id FROM public.stock_transfers WHERE status IN ('in_transit', 'received') LOOP
        FOREACH v_k IN ARRAY ARRAY['transfer_out', 'transfer_close', 'transfer_in'] LOOP
            BEGIN
                PERFORM public.acc_post_source(v_k, v_t.id);
            EXCEPTION WHEN OTHERS THEN
                INSERT INTO public.acc_post_errors (business_id, source_type, source_id, message)
                VALUES (CASE WHEN v_k = 'transfer_in' THEN v_t.to_business_id ELSE v_t.from_business_id END, v_k, v_t.id, SQLERRM)
                ON CONFLICT (source_type, source_id) DO UPDATE SET message = EXCLUDED.message, created_at = NOW();
            END;
        END LOOP;
    END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';

COMMIT;
