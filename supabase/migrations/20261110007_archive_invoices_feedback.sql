-- =============================================================================
-- 20261110007_archive_invoices_feedback.sql
-- Archive and delete for lists that keep growing: invoices sent, customer feedback.
-- =============================================================================
-- Why: invoices sent and feedback pile up. Staff can now archive one (hidden from the
-- main list, still kept and viewable under "Archived") or delete it for good.
--   - invoices: rows were insert-only. Archiving and deleting go through the two
--     functions below, which check 'customers.debts' like issue_invoice(). Deleting an
--     invoice never reuses its number; the counter only moves forward.
--   - complaints: archiving is a normal update, allowed by the existing update policy
--     ('complaints.reply'). Delete stays the existing soft delete (deleted_at).
-- Dependencies: 20261108001 (customer invoices), 20261105014 (role enforcement)
-- =============================================================================

BEGIN;

ALTER TABLE public.invoices   ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;
ALTER TABLE public.complaints ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_invoices_customer_live
    ON public.invoices (customer_id, number DESC) WHERE archived_at IS NULL;

-- Archive (p_archived = true) or bring back (false) one invoice.
CREATE OR REPLACE FUNCTION public.set_invoice_archived(p_invoice_id UUID, p_archived BOOLEAN)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_business UUID;
BEGIN
    SELECT business_id INTO v_business FROM public.invoices WHERE id = p_invoice_id;
    IF v_business IS NULL THEN
        RAISE EXCEPTION 'That invoice was not found.' USING ERRCODE = 'P0002';
    END IF;
    PERFORM public.assert_permission(v_business, 'customers.debts');

    UPDATE public.invoices
       SET archived_at = CASE WHEN p_archived THEN COALESCE(archived_at, NOW()) ELSE NULL END
     WHERE id = p_invoice_id;
END;
$$;

-- Deletes one invoice for good. What the customer owes is not changed: invoices are
-- only copies of the debt as it stood when sent.
CREATE OR REPLACE FUNCTION public.delete_invoice(p_invoice_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_business UUID;
BEGIN
    SELECT business_id INTO v_business FROM public.invoices WHERE id = p_invoice_id;
    IF v_business IS NULL THEN
        RETURN; -- already gone
    END IF;
    PERFORM public.assert_permission(v_business, 'customers.debts');

    DELETE FROM public.invoices WHERE id = p_invoice_id;
END;
$$;

REVOKE ALL ON FUNCTION public.set_invoice_archived(UUID, BOOLEAN) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.delete_invoice(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_invoice_archived(UUID, BOOLEAN) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.delete_invoice(UUID) TO authenticated, service_role;

COMMIT;
