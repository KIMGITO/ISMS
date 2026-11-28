-- Unclaimed Payments reconciliation (2026-11-28).
--
-- Builds on 20261212005/007/008. No second ledger: mpesa_till_payments stays the one record of
-- money that arrived at the till. This adds
--   1. allocations: one till payment can prove part of a sale, or be split over several sales
--      (mpesa_till_allocations). Linking still moves no money (money rule 2): the M-Pesa sale
--      already counted its money when it was rung up; an allocation is the proof it arrived.
--   2. statuses: under_review, partial, disputed, reversed (plus the old unclaimed / recorded /
--      matched_sale / ignored). Rows are never deleted.
--   3. an append-only history of every status change and allocation (mpesa_till_payment_events),
--      written by trigger so every path (callback, staff, void) is covered.
--   4. STK exceptions: a paid prompt that was meant for a sale but could not be matched to it.

-- 1. Statuses -------------------------------------------------------------------------------
ALTER TABLE public.mpesa_till_payments DROP CONSTRAINT IF EXISTS mpesa_till_payments_status_check;
ALTER TABLE public.mpesa_till_payments ADD CONSTRAINT mpesa_till_payments_status_check CHECK (status = ANY (ARRAY[
    'unclaimed', 'under_review', 'partial', 'disputed', 'recorded', 'matched_sale', 'ignored', 'reversed'
]));
ALTER TABLE public.mpesa_till_payments ADD COLUMN IF NOT EXISTS allocated numeric(14,2) NOT NULL DEFAULT 0;

-- The money reference never changes once received.
CREATE OR REPLACE FUNCTION public.fn_till_payment_immutable() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
    IF NEW.trans_id IS DISTINCT FROM OLD.trans_id OR NEW.amount IS DISTINCT FROM OLD.amount
       OR NEW.trans_time IS DISTINCT FROM OLD.trans_time OR NEW.msisdn IS DISTINCT FROM OLD.msisdn THEN
        RAISE EXCEPTION 'A received payment''s code, amount, time and phone cannot be changed.';
    END IF;
    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_till_payment_immutable ON public.mpesa_till_payments;
CREATE TRIGGER trg_till_payment_immutable BEFORE UPDATE ON public.mpesa_till_payments
    FOR EACH ROW EXECUTE FUNCTION public.fn_till_payment_immutable();

CREATE OR REPLACE FUNCTION public.fn_till_payment_no_delete() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
    -- A whole business being removed may cascade; a single payment row never goes.
    IF NOT EXISTS (SELECT 1 FROM public.businesses WHERE id = OLD.business_id) THEN RETURN OLD; END IF;
    RAISE EXCEPTION 'Received payments are never deleted. Mark them disputed or reversed instead.';
END;
$$;
DROP TRIGGER IF EXISTS trg_till_payment_no_delete ON public.mpesa_till_payments;
CREATE TRIGGER trg_till_payment_no_delete BEFORE DELETE ON public.mpesa_till_payments
    FOR EACH ROW EXECUTE FUNCTION public.fn_till_payment_no_delete();

-- 2. Allocations ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.mpesa_till_allocations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    till_payment_id uuid NOT NULL REFERENCES public.mpesa_till_payments(id) ON DELETE CASCADE,
    sale_id uuid NOT NULL REFERENCES public.transactions(id) ON DELETE CASCADE,
    amount numeric(14,2) NOT NULL CHECK (amount > 0),
    allocated_by text NOT NULL,
    allocated_by_user uuid DEFAULT auth.uid(),
    allocated_at timestamptz NOT NULL DEFAULT now(),
    reversed_at timestamptz,
    reversed_by text,
    reverse_reason text
);
CREATE INDEX IF NOT EXISTS mpesa_till_alloc_payment_idx ON public.mpesa_till_allocations (till_payment_id) WHERE reversed_at IS NULL;
CREATE INDEX IF NOT EXISTS mpesa_till_alloc_sale_idx ON public.mpesa_till_allocations (sale_id) WHERE reversed_at IS NULL;
ALTER TABLE public.mpesa_till_allocations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS pol_mpesa_till_alloc_select ON public.mpesa_till_allocations;
CREATE POLICY pol_mpesa_till_alloc_select ON public.mpesa_till_allocations FOR SELECT
    USING (public.has_permission(business_id, VARIADIC ARRAY['payments.view', 'payments.mpesa', 'payments.verify']));
REVOKE ALL ON public.mpesa_till_allocations FROM anon, authenticated;
GRANT SELECT ON public.mpesa_till_allocations TO authenticated;
GRANT ALL ON public.mpesa_till_allocations TO service_role;

-- Existing links become allocations of their full amount.
INSERT INTO public.mpesa_till_allocations (business_id, till_payment_id, sale_id, amount, allocated_by, allocated_by_user, allocated_at)
SELECT p.business_id, p.id, p.sale_id, p.amount, COALESCE(p.handled_by, 'Staff'), NULL, COALESCE(p.handled_at, p.created_at)
FROM public.mpesa_till_payments p
WHERE p.status = 'matched_sale' AND p.sale_id IS NOT NULL AND p.business_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM public.mpesa_till_allocations a WHERE a.till_payment_id = p.id);
UPDATE public.mpesa_till_payments p SET allocated = p.amount WHERE p.status = 'matched_sale' AND p.sale_id IS NOT NULL;

-- What a sale's M-Pesa money is proven by: live allocations plus linked prompts (paid or waiting).
CREATE OR REPLACE FUNCTION public.fn_sale_till_linked(p_sale_id uuid) RETURNS numeric
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT (
        COALESCE((SELECT SUM(amount) FROM public.mpesa_till_allocations
                  WHERE sale_id = p_sale_id AND reversed_at IS NULL), 0)
      + COALESCE((SELECT SUM(amount) FROM public.mpesa_transactions
                  WHERE transaction_id = p_sale_id AND online_order_id IS NULL
                    AND status IN ('Pending', 'Completed')), 0)
    )::numeric(14,2);
$$;
REVOKE ALL ON FUNCTION public.fn_sale_till_linked(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_sale_till_linked(uuid) TO service_role;

-- 3. History --------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.mpesa_till_payment_events (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    till_payment_id uuid NOT NULL REFERENCES public.mpesa_till_payments(id) ON DELETE CASCADE,
    trans_id text NOT NULL,
    action text NOT NULL,
    previous_status text,
    new_status text,
    amount numeric(14,2),
    sale_id uuid,
    staff_name text,
    staff_user uuid DEFAULT auth.uid(),
    note text,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS mpesa_till_events_payment_idx ON public.mpesa_till_payment_events (till_payment_id, created_at);
ALTER TABLE public.mpesa_till_payment_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS pol_mpesa_till_events_select ON public.mpesa_till_payment_events;
CREATE POLICY pol_mpesa_till_events_select ON public.mpesa_till_payment_events FOR SELECT
    USING (public.has_permission(business_id, VARIADIC ARRAY['payments.view', 'payments.mpesa', 'payments.verify']));
REVOKE ALL ON public.mpesa_till_payment_events FROM anon, authenticated;
GRANT SELECT ON public.mpesa_till_payment_events TO authenticated;
GRANT ALL ON public.mpesa_till_payment_events TO service_role;

CREATE OR REPLACE FUNCTION public.fn_till_events_append_only() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
    IF TG_OP = 'DELETE' AND NOT EXISTS (SELECT 1 FROM public.businesses WHERE id = OLD.business_id) THEN RETURN OLD; END IF;
    RAISE EXCEPTION 'Payment history cannot be changed.';
END;
$$;
DROP TRIGGER IF EXISTS trg_till_events_append_only ON public.mpesa_till_payment_events;
CREATE TRIGGER trg_till_events_append_only BEFORE UPDATE OR DELETE ON public.mpesa_till_payment_events
    FOR EACH ROW EXECUTE FUNCTION public.fn_till_events_append_only();

-- Every arrival and status change is logged, whatever path made it.
CREATE OR REPLACE FUNCTION public.fn_till_payment_log() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    IF NEW.business_id IS NULL THEN RETURN NEW; END IF;
    IF TG_OP = 'INSERT' THEN
        INSERT INTO public.mpesa_till_payment_events (business_id, till_payment_id, trans_id, action, new_status, amount, staff_name)
        VALUES (NEW.business_id, NEW.id, NEW.trans_id, 'received', NEW.status, NEW.amount, 'M-Pesa');
    ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
        INSERT INTO public.mpesa_till_payment_events (business_id, till_payment_id, trans_id, action, previous_status, new_status, amount, sale_id, staff_name, note)
        VALUES (NEW.business_id, NEW.id, NEW.trans_id, 'status', OLD.status, NEW.status, NEW.amount, NEW.sale_id,
                COALESCE(NEW.handled_by, 'System'), NEW.note);
    END IF;
    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_till_payment_log ON public.mpesa_till_payments;
CREATE TRIGGER trg_till_payment_log AFTER INSERT OR UPDATE ON public.mpesa_till_payments
    FOR EACH ROW EXECUTE FUNCTION public.fn_till_payment_log();

-- A row set to matched_sale with a sale but no allocation (the callback's receipt-number match)
-- gets its allocation here, so every path keeps allocations and sale_id in step.
CREATE OR REPLACE FUNCTION public.fn_till_payment_sync_alloc() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_open numeric;
BEGIN
    IF NEW.status = 'matched_sale' AND NEW.sale_id IS NOT NULL AND NEW.business_id IS NOT NULL THEN
        SELECT COALESCE(SUM(amount), 0) INTO v_open FROM public.mpesa_till_allocations
        WHERE till_payment_id = NEW.id AND reversed_at IS NULL;
        IF v_open < NEW.amount THEN
            INSERT INTO public.mpesa_till_allocations (business_id, till_payment_id, sale_id, amount, allocated_by)
            VALUES (NEW.business_id, NEW.id, NEW.sale_id, NEW.amount - v_open, COALESCE(NEW.handled_by, 'System'));
            UPDATE public.mpesa_till_payments SET allocated = amount WHERE id = NEW.id AND allocated <> amount;
        END IF;
    END IF;
    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_till_payment_sync_alloc ON public.mpesa_till_payments;
CREATE TRIGGER trg_till_payment_sync_alloc AFTER INSERT OR UPDATE OF status, sale_id ON public.mpesa_till_payments
    FOR EACH ROW EXECUTE FUNCTION public.fn_till_payment_sync_alloc();

-- 4. Allocation -----------------------------------------------------------------------------
-- Gives part or all of a waiting till payment to one M-Pesa sale. Both rows are locked, so two
-- staff can't spend the same money twice or push a sale past its total. Never by amount alone:
-- staff choose the sale.
CREATE OR REPLACE FUNCTION public.allocate_till_payment(
    p_till_payment_id uuid,
    p_sale_id uuid,
    p_amount numeric,
    p_handled_by text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_row    public.mpesa_till_payments%ROWTYPE;
    v_sale   public.transactions%ROWTYPE;
    v_by     text := COALESCE(NULLIF(trim(p_handled_by), ''), 'Staff');
    v_amt    numeric(14,2) := round(p_amount, 2);
    v_left   numeric(14,2);
    v_room   numeric(14,2);
    v_status text;
    v_ref    text;
BEGIN
    SELECT * INTO v_row FROM public.mpesa_till_payments WHERE id = p_till_payment_id FOR UPDATE;
    IF NOT FOUND OR v_row.business_id IS NULL THEN
        RAISE EXCEPTION 'Till payment not found.';
    END IF;
    PERFORM public.assert_business_member(v_row.business_id);
    PERFORM public.assert_permission(v_row.business_id, 'payments.verify', 'payments.mpesa');
    IF v_row.status NOT IN ('unclaimed', 'under_review', 'partial') THEN
        RAISE EXCEPTION 'This payment was already handled by %.', COALESCE(v_row.handled_by, 'someone else');
    END IF;
    IF v_amt IS NULL OR v_amt <= 0 THEN
        RAISE EXCEPTION 'Enter an amount above zero.';
    END IF;
    v_left := v_row.amount - v_row.allocated;
    IF v_amt > v_left THEN
        RAISE EXCEPTION 'Only KSh % of this payment is left to give.', to_char(v_left, 'FM999,999,990.00');
    END IF;

    SELECT * INTO v_sale FROM public.transactions WHERE id = p_sale_id FOR UPDATE;
    IF NOT FOUND OR v_sale.business_id <> v_row.business_id OR v_sale.deleted_at IS NOT NULL THEN
        RAISE EXCEPTION 'Sale not found.';
    END IF;
    IF v_sale.payment_method <> 'M-Pesa' THEN
        RAISE EXCEPTION 'Only a sale paid by M-Pesa can take a till payment. Record it on the customer''s account instead.';
    END IF;
    v_room := v_sale.final_total - public.fn_sale_till_linked(v_sale.id);
    IF v_amt > v_room THEN
        IF v_room <= 0 THEN
            RAISE EXCEPTION 'This sale is already covered by till payments. Choose another sale.';
        END IF;
        RAISE EXCEPTION 'This sale only needs KSh % more.', to_char(v_room, 'FM999,999,990.00');
    END IF;

    v_ref := COALESCE(v_sale.reference_id, left(v_sale.id::text, 8));
    INSERT INTO public.mpesa_till_allocations (business_id, till_payment_id, sale_id, amount, allocated_by)
    VALUES (v_row.business_id, v_row.id, v_sale.id, v_amt, v_by);

    v_status := CASE WHEN v_left - v_amt = 0 THEN 'matched_sale' ELSE 'partial' END;
    INSERT INTO public.mpesa_till_payment_events (business_id, till_payment_id, trans_id, action, previous_status, new_status, amount, sale_id, staff_name, note)
    VALUES (v_row.business_id, v_row.id, v_row.trans_id, 'allocated', v_row.status, v_status, v_amt, v_sale.id, v_by, 'Sale ' || v_ref);

    UPDATE public.mpesa_till_payments
    SET allocated = allocated + v_amt, status = v_status, sale_id = v_sale.id,
        handled_by = v_by, handled_at = now(),
        note = CASE WHEN v_status = 'matched_sale' THEN 'Sale ' || v_ref ELSE note END
    WHERE id = v_row.id;

    RETURN jsonb_build_object('status', v_status, 'left', v_left - v_amt, 'sale_reference', v_ref);
END;
$$;
REVOKE ALL ON FUNCTION public.allocate_till_payment(uuid, uuid, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.allocate_till_payment(uuid, uuid, numeric, text) TO authenticated, service_role;

-- The old one-step link = allocate the whole amount.
CREATE OR REPLACE FUNCTION public.link_till_payment_to_sale(
    p_till_payment_id uuid, p_sale_id uuid, p_handled_by text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_row public.mpesa_till_payments%ROWTYPE;
BEGIN
    SELECT * INTO v_row FROM public.mpesa_till_payments WHERE id = p_till_payment_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Till payment not found.'; END IF;
    IF v_row.status NOT IN ('unclaimed', 'under_review', 'partial') THEN
        RAISE EXCEPTION 'This payment was already handled by %.', COALESCE(v_row.handled_by, 'someone else');
    END IF;
    PERFORM public.allocate_till_payment(p_till_payment_id, p_sale_id, v_row.amount - v_row.allocated, p_handled_by);
END;
$$;
REVOKE ALL ON FUNCTION public.link_till_payment_to_sale(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.link_till_payment_to_sale(uuid, uuid, text) TO authenticated, service_role;

-- Review flags. under_review / disputed hold the money out of matching until cleared;
-- reversed = Safaricom reversed it (the row stays, nothing is allocated).
CREATE OR REPLACE FUNCTION public.flag_till_payment(
    p_till_payment_id uuid, p_status text, p_note text, p_handled_by text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_row public.mpesa_till_payments%ROWTYPE;
    v_by  text := COALESCE(NULLIF(trim(p_handled_by), ''), 'Staff');
BEGIN
    SELECT * INTO v_row FROM public.mpesa_till_payments WHERE id = p_till_payment_id FOR UPDATE;
    IF NOT FOUND OR v_row.business_id IS NULL THEN RAISE EXCEPTION 'Till payment not found.'; END IF;
    PERFORM public.assert_business_member(v_row.business_id);
    PERFORM public.assert_permission(v_row.business_id, 'payments.verify', 'payments.mpesa');
    IF p_status NOT IN ('under_review', 'disputed', 'reversed', 'unclaimed') THEN
        RAISE EXCEPTION 'Unknown status %.', p_status;
    END IF;
    IF COALESCE(trim(p_note), '') = '' THEN RAISE EXCEPTION 'Say why.'; END IF;
    IF v_row.status IN ('recorded', 'ignored', 'reversed') THEN
        RAISE EXCEPTION 'This payment is already settled. Void its payment on the Payments screen first.';
    END IF;
    IF p_status = 'unclaimed' AND v_row.status NOT IN ('under_review', 'disputed') THEN
        RAISE EXCEPTION 'Only a payment under review or disputed can be cleared.';
    END IF;
    IF p_status = 'reversed' THEN
        UPDATE public.mpesa_till_allocations
        SET reversed_at = now(), reversed_by = v_by, reverse_reason = trim(p_note)
        WHERE till_payment_id = v_row.id AND reversed_at IS NULL;
        UPDATE public.mpesa_till_payments SET allocated = 0 WHERE id = v_row.id;
    END IF;
    UPDATE public.mpesa_till_payments
    SET status = CASE WHEN p_status = 'unclaimed' AND allocated > 0 THEN 'partial' ELSE p_status END,
        handled_by = v_by, handled_at = now(), note = trim(p_note)
    WHERE id = v_row.id;
END;
$$;
REVOKE ALL ON FUNCTION public.flag_till_payment(uuid, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.flag_till_payment(uuid, text, text, text) TO authenticated, service_role;

-- Under review / disputed should not lose their allocations when flagged; only reopen/reversal do.
CREATE OR REPLACE FUNCTION public.fn_till_payment_unlink_on_reopen() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
    IF NEW.status = OLD.status THEN RETURN NEW; END IF;
    -- A voided customer payment sends the rest back; what was already given to sales stays.
    IF NEW.status = 'unclaimed' AND OLD.status = 'recorded' AND NEW.allocated > 0 THEN
        NEW.status := 'partial';
        RETURN NEW;
    END IF;
    IF NEW.status IN ('unclaimed', 'ignored') AND OLD.status IN ('matched_sale', 'partial') THEN
        UPDATE public.mpesa_till_allocations
        SET reversed_at = now(), reversed_by = COALESCE(NEW.handled_by, 'Staff'), reverse_reason = 'Sent back to the queue'
        WHERE till_payment_id = NEW.id AND reversed_at IS NULL;
        NEW.allocated := 0;
    END IF;
    IF NEW.status NOT IN ('matched_sale', 'partial', 'under_review', 'disputed') OR NEW.allocated = 0 THEN
        IF NEW.status <> 'matched_sale' THEN NEW.sale_id := NULL; END IF;
    END IF;
    RETURN NEW;
END;
$$;

-- handle_till_payment: customer / walk-in now record only what is left, and work from
-- under_review and partial too. Reopen also clears partial, under review and disputed.
CREATE OR REPLACE FUNCTION public.handle_till_payment(
    p_till_payment_id uuid, p_action text, p_customer_id uuid DEFAULT NULL,
    p_note text DEFAULT NULL, p_handled_by text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_row  public.mpesa_till_payments%ROWTYPE;
    v_name TEXT;
    v_pid  UUID;
    v_by   TEXT := COALESCE(NULLIF(trim(p_handled_by), ''), 'Staff');
    v_left numeric(14,2);
BEGIN
    SELECT * INTO v_row FROM public.mpesa_till_payments WHERE id = p_till_payment_id FOR UPDATE;
    IF NOT FOUND OR v_row.business_id IS NULL THEN
        RAISE EXCEPTION 'Till payment not found.';
    END IF;
    PERFORM public.assert_business_member(v_row.business_id);
    PERFORM public.assert_permission(v_row.business_id, 'payments.verify', 'payments.mpesa');

    IF p_action = 'reopen' THEN
        IF v_row.status NOT IN ('matched_sale', 'partial', 'ignored', 'under_review', 'disputed') THEN
            RAISE EXCEPTION 'Only payments linked to a sale, ignored or flagged can go back to the queue. Void the payment instead.';
        END IF;
        UPDATE public.mpesa_till_payments
        SET status = 'unclaimed', handled_by = v_by, handled_at = NULL, note = NULLIF(trim(p_note), '')
        WHERE id = v_row.id;
        RETURN NULL;
    END IF;

    IF v_row.status NOT IN ('unclaimed', 'under_review', 'partial') THEN
        RAISE EXCEPTION 'This payment was already handled by %.', COALESCE(v_row.handled_by, 'someone else');
    END IF;
    v_left := v_row.amount - v_row.allocated;

    IF p_action IN ('customer', 'walk_in') THEN
        IF p_action = 'customer' THEN
            SELECT name INTO v_name FROM public.customers
            WHERE id = p_customer_id AND business_id = v_row.business_id AND deleted_at IS NULL;
            IF v_name IS NULL THEN
                RAISE EXCEPTION 'Choose a customer for this payment.';
            END IF;
        END IF;
        v_pid := public.process_business_payment(
            v_row.business_id, v_row.trans_id, v_left, 'M-Pesa',
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
    IF p_action = 'ignore' AND v_row.allocated > 0 THEN
        RAISE EXCEPTION 'Part of this payment is already given to a sale. Send it back to the queue first.';
    END IF;
    IF p_action NOT IN ('sale', 'ignore') THEN
        RAISE EXCEPTION 'Unknown action %.', p_action;
    END IF;
    IF p_action = 'sale' THEN
        RAISE EXCEPTION 'Choose the sale this payment is for.';
    END IF;

    UPDATE public.mpesa_till_payments
    SET status = 'ignored', handled_by = v_by, handled_at = NOW(), note = NULLIF(trim(p_note), '')
    WHERE id = v_row.id;
    RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.handle_till_payment(uuid, text, uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.handle_till_payment(uuid, text, uuid, text, text) TO authenticated, service_role;

-- void_business_payment sends a linked till payment back to 'unclaimed'; the trigger logs it.

-- 5. Matching suggestions -------------------------------------------------------------------
-- Sales with room left for this payment, with why each is suggested. Room > 0 (partial allowed).
DROP FUNCTION IF EXISTS public.till_payment_sale_candidates(uuid, text, int);
CREATE OR REPLACE FUNCTION public.till_payment_sale_candidates(
    p_till_payment_id uuid, p_search text DEFAULT NULL, p_limit int DEFAULT 30
) RETURNS TABLE (
    sale_id uuid, reference text, created_at timestamptz, customer_name text, customer_phone text,
    total numeric, linked numeric, remaining numeric, same_amount boolean, score int, reasons text[]
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_row   public.mpesa_till_payments%ROWTYPE;
    v_q     text := NULLIF(trim(p_search), '');
    v_left  numeric;
    v_phone text;
BEGIN
    SELECT * INTO v_row FROM public.mpesa_till_payments WHERE id = p_till_payment_id;
    IF NOT FOUND OR v_row.business_id IS NULL THEN
        RAISE EXCEPTION 'Till payment not found.';
    END IF;
    PERFORM public.assert_business_member(v_row.business_id);
    PERFORM public.assert_permission(v_row.business_id, 'payments.verify', 'payments.mpesa');
    v_left := v_row.amount - v_row.allocated;
    v_phone := right(regexp_replace(COALESCE(v_row.msisdn, ''), '\D', '', 'g'), 9);

    RETURN QUERY
    WITH c AS (
        SELECT t.id, COALESCE(t.reference_id, left(t.id::text, 8)) AS ref, t.created_at AS at,
               cu.name AS cname, cu.phone AS cphone, t.final_total AS tot, l.linked AS lk,
               (t.final_total - l.linked) AS room,
               (v_phone <> '' AND length(v_phone) = 9 AND right(regexp_replace(COALESCE(cu.phone, ''), '\D', '', 'g'), 9) = v_phone) AS phone_match,
               (v_row.bill_ref IS NOT NULL AND upper(t.reference_id) = upper(v_row.bill_ref)) AS ref_match,
               (v_row.customer_id IS NOT NULL AND t.customer_id = v_row.customer_id) AS cust_match,
               abs(extract(epoch FROM (t.created_at - v_row.trans_time))) AS gap
        FROM public.transactions t
        LEFT JOIN public.customers cu ON cu.id = t.customer_id
        CROSS JOIN LATERAL (SELECT public.fn_sale_till_linked(t.id) AS linked) l
        WHERE t.business_id = v_row.business_id
          AND t.deleted_at IS NULL
          AND t.payment_method = 'M-Pesa'
          AND t.final_total - l.linked > 0
          AND (v_q IS NOT NULL OR t.created_at BETWEEN v_row.trans_time - interval '3 days' AND v_row.trans_time + interval '1 day')
          AND (v_q IS NULL OR t.reference_id ILIKE '%' || v_q || '%' OR cu.name ILIKE '%' || v_q || '%'
               OR cu.phone ILIKE '%' || v_q || '%' OR t.final_total::text = v_q)
    )
    SELECT c.id, c.ref, c.at, c.cname, c.cphone, c.tot, c.lk, c.room, c.room = v_left,
           (CASE WHEN c.ref_match THEN 100 ELSE 0 END + CASE WHEN c.phone_match THEN 50 ELSE 0 END
            + CASE WHEN c.cust_match THEN 40 ELSE 0 END
            + CASE WHEN c.gap <= 900 THEN 20 WHEN c.gap <= 3600 THEN 10 ELSE 0 END
            + CASE WHEN c.room = v_left THEN 5 ELSE 0 END)::int,
           array_remove(ARRAY[
               CASE WHEN c.ref_match THEN 'Account reference is this receipt' END,
               CASE WHEN c.phone_match THEN 'Sender phone is the sale''s customer' END,
               CASE WHEN c.cust_match THEN 'Same customer' END,
               CASE WHEN c.gap <= 900 THEN 'Within 15 minutes of the payment'
                    WHEN c.gap <= 3600 THEN 'Within an hour of the payment' END,
               CASE WHEN c.room = v_left THEN 'Balance equals what is left' END
           ], NULL)
    FROM c
    ORDER BY 10 DESC, c.gap
    LIMIT LEAST(GREATEST(COALESCE(p_limit, 30), 1), 100);
END;
$$;
REVOKE ALL ON FUNCTION public.till_payment_sale_candidates(uuid, text, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.till_payment_sale_candidates(uuid, text, int) TO authenticated, service_role;

-- 6. STK exceptions -------------------------------------------------------------------------
-- A paid prompt that was sent for a sale but could not prove it (sale removed or covered):
-- confirm_store_payment_request recorded the money as a payment and cleared transaction_id.
-- Mark those so they can be shown and reviewed; mpesa_transactions keeps its own row.
ALTER TABLE public.mpesa_transactions ADD COLUMN IF NOT EXISTS unmatched_sale_id uuid;
ALTER TABLE public.mpesa_transactions ADD COLUMN IF NOT EXISTS exception_resolved_at timestamptz;
ALTER TABLE public.mpesa_transactions ADD COLUMN IF NOT EXISTS exception_resolved_by text;

CREATE OR REPLACE FUNCTION public.fn_stk_mark_exception() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
    IF OLD.transaction_id IS NOT NULL AND NEW.transaction_id IS NULL AND NEW.online_order_id IS NULL THEN
        NEW.unmatched_sale_id := OLD.transaction_id;
    END IF;
    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_stk_mark_exception ON public.mpesa_transactions;
CREATE TRIGGER trg_stk_mark_exception BEFORE UPDATE OF transaction_id ON public.mpesa_transactions
    FOR EACH ROW EXECUTE FUNCTION public.fn_stk_mark_exception();

CREATE OR REPLACE FUNCTION public.stk_payment_exceptions(p_business_id uuid)
RETURNS TABLE (id uuid, receipt_number text, amount numeric, phone text, paid_at timestamptz,
               sale_id uuid, sale_reference text, payment_id uuid, requested_by text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
    PERFORM public.assert_business_member(p_business_id);
    PERFORM public.assert_permission(p_business_id, 'payments.verify', 'payments.mpesa');
    RETURN QUERY
    SELECT m.id, m.receipt_number, m.amount, m.phone, COALESCE(m.mpesa_receipt_timestamp, m.updated_at),
           m.unmatched_sale_id, COALESCE(t.reference_id, left(m.unmatched_sale_id::text, 8)), m.payment_id, m.requested_by
    FROM public.mpesa_transactions m
    LEFT JOIN public.transactions t ON t.id = m.unmatched_sale_id
    WHERE m.business_id = p_business_id AND m.unmatched_sale_id IS NOT NULL
      AND m.status = 'Completed' AND m.exception_resolved_at IS NULL
    ORDER BY m.updated_at DESC
    LIMIT 200;
END;
$$;
REVOKE ALL ON FUNCTION public.stk_payment_exceptions(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.stk_payment_exceptions(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.resolve_stk_exception(p_id uuid, p_note text, p_by text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_m public.mpesa_transactions%ROWTYPE;
BEGIN
    SELECT * INTO v_m FROM public.mpesa_transactions WHERE id = p_id FOR UPDATE;
    IF NOT FOUND OR v_m.business_id IS NULL THEN RAISE EXCEPTION 'Prompt not found.'; END IF;
    PERFORM public.assert_business_member(v_m.business_id);
    PERFORM public.assert_permission(v_m.business_id, 'payments.verify', 'payments.mpesa');
    IF COALESCE(trim(p_note), '') = '' THEN RAISE EXCEPTION 'Say how it was sorted.'; END IF;
    UPDATE public.mpesa_transactions
    SET exception_resolved_at = now(), exception_resolved_by = COALESCE(NULLIF(trim(p_by), ''), 'Staff') || ': ' || trim(p_note)
    WHERE id = p_id;
END;
$$;
REVOKE ALL ON FUNCTION public.resolve_stk_exception(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resolve_stk_exception(uuid, text, text) TO authenticated, service_role;

-- Realtime for the history and allocations so open screens update.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'mpesa_till_allocations') THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.mpesa_till_allocations;
    END IF;
EXCEPTION WHEN undefined_object THEN NULL;
END;
$$;

-- Read-only plans block changes here too, like every business table (20261204001).
DROP TRIGGER IF EXISTS trg_zz_plan_read_only ON public.mpesa_till_allocations;
CREATE TRIGGER trg_zz_plan_read_only BEFORE INSERT OR UPDATE OR DELETE ON public.mpesa_till_allocations
    FOR EACH ROW EXECUTE FUNCTION public.fn_block_when_read_only();
DROP TRIGGER IF EXISTS trg_zz_plan_read_only ON public.mpesa_till_payment_events;
CREATE TRIGGER trg_zz_plan_read_only BEFORE INSERT OR UPDATE OR DELETE ON public.mpesa_till_payment_events
    FOR EACH ROW EXECUTE FUNCTION public.fn_block_when_read_only();
