-- =============================================================================
-- 20261116002_business_delete_cascade.sql
-- Deleting a whole business failed.
--
-- Deleting a business removes its rows with it (ON DELETE CASCADE). Triggers on those
-- rows still ran as if each row were removed on its own: a removed expense "put the
-- money back" by writing to money_assets and payment_asset_ledger for the business
-- being deleted, and the database refused because that business is already gone.
--
-- Fix: money posting does nothing when the business no longer exists. A business that
-- is being deleted has no balances left to keep.
-- =============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.fn_post_money_asset(p_business_id uuid, p_method text, p_delta numeric, p_description text, p_payment_id uuid DEFAULT NULL::uuid, p_expense_id uuid DEFAULT NULL::uuid, p_recorded_by text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_method   TEXT := CASE WHEN p_method = 'Mobile_Wallet' THEN 'M-Pesa' WHEN p_method = 'Other' THEN 'Cash' ELSE p_method END;
    v_asset_id UUID;
    v_after    NUMERIC(14,2);
BEGIN
    IF COALESCE(p_delta, 0) = 0 THEN
        RETURN;
    END IF;
    -- The business is being deleted along with this row: nothing to post to.
    IF NOT EXISTS (SELECT 1 FROM public.businesses b WHERE b.id = p_business_id) THEN
        RETURN;
    END IF;
    IF v_method IS NULL OR v_method NOT IN ('Cash', 'M-Pesa', 'Airtel Money', 'Card', 'Bank') THEN
        RAISE EXCEPTION 'Choose Cash, M-Pesa, Airtel Money, Card or Bank.';
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
$function$;

COMMIT;
