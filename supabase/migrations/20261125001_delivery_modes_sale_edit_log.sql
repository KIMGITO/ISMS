-- 2026-11-17 POS: how delivery is paid, what the rider earns, and every change to a sale is logged.
--
-- 1. Three ways a delivery is paid (transactions.delivery_mode):
--      charged        the fee is on our bill: the customer pays us now or later (weekly /
--                     monthly accounts), and the shop pays the rider.
--      rider_collects the customer pays the rider the fee in cash on delivery; the rider keeps
--                     it (and brings back any cash for the goods). Not on our bill.
--      free           the customer isn't charged; the shop pays the rider from its own money.
--    delivery_fee stays what the customer pays THE SHOP for delivery (0 unless 'charged'), so
--    final_total, points, refunds and the books (delivery income) keep working unchanged.
--    transactions.rider_pay is what the rider earns for the delivery. The shop owes it for
--    'charged' and 'free'; it is booked as an expense when the rider is paid, not at the sale.
-- 2. Riders see the mode and their pay in their list (fn_delivery_rows), so they know what to
--    collect and who pays them.
-- 3. Sale edits are logged: any change to a sale or its items after it was made goes to
--    audit_logs (Audit screen, and the sale's own history in the Sales Log). Delivery
--    progress by riders (rider_id, delivery_status, delivered_at) is not an edit and is
--    left out; so are sync columns.

ALTER TABLE public.transactions
    ADD COLUMN IF NOT EXISTS delivery_mode TEXT NOT NULL DEFAULT 'charged',
    ADD COLUMN IF NOT EXISTS rider_pay NUMERIC(14,2) NOT NULL DEFAULT 0;
DO $$ BEGIN
    ALTER TABLE public.transactions ADD CONSTRAINT transactions_delivery_mode_check
        CHECK (delivery_mode IN ('charged', 'rider_collects', 'free'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
    ALTER TABLE public.transactions ADD CONSTRAINT transactions_rider_pay_check CHECK (rider_pay >= 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
COMMENT ON COLUMN public.transactions.delivery_mode IS
    'charged: fee on our bill, shop pays the rider. rider_collects: customer pays the rider in cash, rider keeps it. free: customer not charged, shop pays the rider.';
COMMENT ON COLUMN public.transactions.rider_pay IS
    'What the rider earns for this delivery. Owed by the shop unless delivery_mode = rider_collects.';

-- Deliveries made before this: the fee was on the bill and riders price their own areas.
-- (Before the edit-log trigger below exists, so it isn't logged as an edit.)
UPDATE public.transactions SET rider_pay = delivery_fee
WHERE is_delivery AND delivery_fee > 0 AND rider_pay = 0;

-- ---------------------------------------------------------------- credit sales carry the mode and rider pay
DROP FUNCTION IF EXISTS public.process_customer_transaction("p_business_id" "uuid", "p_customer_id" "uuid", "p_customer_name" "text", "p_staff_id" "uuid", "p_staff_name" "text", "p_total" numeric, "p_discount" numeric, "p_tax" numeric, "p_final_total" numeric, "p_amount_paid" numeric, "p_payment_method" "public"."payment_method", "p_timestamp" timestamp with time zone, "p_note" "text", "p_is_delivery" boolean, "p_delivery_fee" numeric, "p_rider_name" "text", "p_reference_id" "text", "p_items" "jsonb");

CREATE FUNCTION "public"."process_customer_transaction"("p_business_id" "uuid", "p_customer_id" "uuid", "p_customer_name" "text", "p_staff_id" "uuid", "p_staff_name" "text", "p_total" numeric, "p_discount" numeric, "p_tax" numeric, "p_final_total" numeric, "p_amount_paid" numeric, "p_payment_method" "public"."payment_method", "p_timestamp" timestamp with time zone, "p_note" "text", "p_is_delivery" boolean, "p_delivery_fee" numeric, "p_rider_name" "text", "p_reference_id" "text", "p_items" "jsonb", "p_delivery_mode" "text" DEFAULT 'charged', "p_rider_pay" numeric DEFAULT 0) RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
    v_tx_id          UUID;
    v_wallet_before  NUMERIC(14,2);
    v_wallet_after   NUMERIC(14,2);
    v_debt_before    NUMERIC(14,2);
    v_debt_after     NUMERIC(14,2);
    v_wallet_used    NUMERIC(14,2);
    v_debt_created   NUMERIC(14,2);
    v_item           JSONB;
    v_line_total     NUMERIC(14,2);
BEGIN
    PERFORM public.assert_permission(p_business_id, 'pos.create_sale');
    PERFORM public.assert_business_member(p_business_id); IF p_customer_id IS NOT NULL THEN PERFORM public.assert_business_member((SELECT business_id FROM public.customers WHERE id = p_customer_id)); END IF; PERFORM public.assert_business_member(pr.business_id) FROM public.products pr WHERE pr.id IN (SELECT (e->>'product_id')::UUID FROM jsonb_array_elements(COALESCE(p_items, '[]'::JSONB)) e WHERE e->>'product_id' IS NOT NULL);
    -- Idempotency check: if this reference_id was already processed, return existing tx
    IF p_reference_id IS NOT NULL THEN
        SELECT id INTO v_tx_id
        FROM public.transactions
        WHERE business_id = p_business_id
          AND reference_id = p_reference_id
          AND deleted_at IS NULL;

        IF FOUND THEN
            RETURN v_tx_id;
        END IF;
    END IF;

    -- Validate customer exists
    IF NOT EXISTS (SELECT 1 FROM public.customers WHERE id = p_customer_id) THEN
        RAISE EXCEPTION 'Customer not found: %', p_customer_id;
    END IF;

    -- Fetch current balances
    SELECT wallet_balance, debt_balance
    INTO v_wallet_before, v_debt_before
    FROM public.customers
    WHERE id = p_customer_id;

    v_wallet_before := COALESCE(v_wallet_before, 0);
    v_debt_before   := COALESCE(v_debt_before, 0);

    -- Compute wallet usage and debt creation
    -- For credit sales: wallet is applied first, remaining becomes debt
    IF p_payment_method IN ('Credit_Debt', 'Credit') THEN
        v_wallet_used  := LEAST(v_wallet_before, p_final_total);
        v_debt_created := GREATEST(0, p_final_total - v_wallet_used);
    ELSE
        v_wallet_used  := 0;
        v_debt_created := 0;
    END IF;

    -- Insert transaction header
    INSERT INTO public.transactions
        (business_id, total, discount, tax, final_total, amount_paid,
         wallet_applied, payment_method, customer_id, customer_name,
         staff_id, staff_name, status, timestamp, note, is_delivery,
         delivery_fee, rider_name, reference_id, delivery_mode, rider_pay)
    VALUES (
        p_business_id, p_total, p_discount, p_tax, p_final_total,
        p_amount_paid, v_wallet_used, p_payment_method, p_customer_id,
        p_customer_name, p_staff_id, p_staff_name, 'Synced',
        COALESCE(p_timestamp, NOW()), p_note, COALESCE(p_is_delivery, FALSE),
        COALESCE(p_delivery_fee, 0), p_rider_name, p_reference_id,
        CASE WHEN COALESCE(p_is_delivery, FALSE) THEN COALESCE(p_delivery_mode, 'charged') ELSE 'charged' END,
        CASE WHEN COALESCE(p_is_delivery, FALSE) THEN GREATEST(COALESCE(p_rider_pay, 0), 0) ELSE 0 END
    )
    RETURNING id INTO v_tx_id;

    -- Insert transaction items
    IF p_items IS NOT NULL AND jsonb_array_length(p_items) > 0 THEN
        FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
        LOOP
            v_line_total := ROUND(
                (COALESCE((v_item->>'unit_price')::NUMERIC, 0) *
                 (1 - COALESCE((v_item->>'discount_percentage')::NUMERIC, 0) / 100)) *
                COALESCE((v_item->>'quantity')::NUMERIC, 1),
                2
            );

            INSERT INTO public.transaction_items
                (transaction_id, product_id, product_name, unit_price,
                 quantity, discount_percentage, line_total)
            VALUES (
                v_tx_id,
                (v_item->>'product_id')::UUID,
                COALESCE(v_item->>'product_name', 'Unknown Product'),
                COALESCE((v_item->>'unit_price')::NUMERIC, 0),
                COALESCE((v_item->>'quantity')::NUMERIC, 1),
                COALESCE((v_item->>'discount_percentage')::NUMERIC, 0),
                v_line_total
            );
        END LOOP;
    END IF;

    -- Apply wallet deduction
    IF v_wallet_used > 0 THEN
        v_wallet_after := GREATEST(0, v_wallet_before - v_wallet_used);

        UPDATE public.customers
        SET wallet_balance = v_wallet_after
        WHERE id = p_customer_id;

        INSERT INTO public.wallet_transactions
            (business_id, customer_id, amount, balance_before, balance_after,
             reason, transaction_id, recorded_by)
        VALUES (
            p_business_id, p_customer_id, -v_wallet_used,
            v_wallet_before, v_wallet_after,
            'Applied to checkout sale', v_tx_id, p_staff_name
        );

        INSERT INTO public.customer_ledger
            (business_id, customer_id, type, amount, wallet_balance, debt_balance,
             recorded_by, note, transaction_id, reference_id)
        VALUES (
            p_business_id, p_customer_id, 'wallet_usage', v_wallet_used,
            v_wallet_after, v_debt_before, p_staff_name,
            'Paid for order ' || v_tx_id::TEXT || ' using wallet credit',
            v_tx_id, 'tx-' || v_tx_id::TEXT || '-wallet-usage'
        )
        ON CONFLICT (business_id, reference_id) WHERE reference_id IS NOT NULL DO NOTHING;
    END IF;

    -- Create debt record if applicable
    IF v_debt_created > 0 THEN
        -- credit record: created by the sale trigger, once per sale

        v_debt_after := v_debt_before + v_debt_created;

        UPDATE public.customers
        SET debt_balance = v_debt_after
        WHERE id = p_customer_id;

        INSERT INTO public.customer_ledger
            (business_id, customer_id, type, amount, wallet_balance, debt_balance,
             recorded_by, note, transaction_id, reference_id)
        VALUES (
            p_business_id, p_customer_id, 'debt_creation', v_debt_created,
            COALESCE(v_wallet_after, v_wallet_before), v_debt_after, p_staff_name,
            'Outstanding balance for order ' || v_tx_id::TEXT || ' charged to debt',
            v_tx_id, 'tx-' || v_tx_id::TEXT || '-debt-creation'
        )
        ON CONFLICT (business_id, reference_id) WHERE reference_id IS NOT NULL DO NOTHING;
    END IF;

    RETURN v_tx_id;
END;
$$;

ALTER FUNCTION public.process_customer_transaction("p_business_id" "uuid", "p_customer_id" "uuid", "p_customer_name" "text", "p_staff_id" "uuid", "p_staff_name" "text", "p_total" numeric, "p_discount" numeric, "p_tax" numeric, "p_final_total" numeric, "p_amount_paid" numeric, "p_payment_method" "public"."payment_method", "p_timestamp" timestamp with time zone, "p_note" "text", "p_is_delivery" boolean, "p_delivery_fee" numeric, "p_rider_name" "text", "p_reference_id" "text", "p_items" "jsonb", "p_delivery_mode" "text", "p_rider_pay" numeric) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.process_customer_transaction("p_business_id" "uuid", "p_customer_id" "uuid", "p_customer_name" "text", "p_staff_id" "uuid", "p_staff_name" "text", "p_total" numeric, "p_discount" numeric, "p_tax" numeric, "p_final_total" numeric, "p_amount_paid" numeric, "p_payment_method" "public"."payment_method", "p_timestamp" timestamp with time zone, "p_note" "text", "p_is_delivery" boolean, "p_delivery_fee" numeric, "p_rider_name" "text", "p_reference_id" "text", "p_items" "jsonb", "p_delivery_mode" "text", "p_rider_pay" numeric) FROM PUBLIC;
GRANT ALL ON FUNCTION public.process_customer_transaction("p_business_id" "uuid", "p_customer_id" "uuid", "p_customer_name" "text", "p_staff_id" "uuid", "p_staff_name" "text", "p_total" numeric, "p_discount" numeric, "p_tax" numeric, "p_final_total" numeric, "p_amount_paid" numeric, "p_payment_method" "public"."payment_method", "p_timestamp" timestamp with time zone, "p_note" "text", "p_is_delivery" boolean, "p_delivery_fee" numeric, "p_rider_name" "text", "p_reference_id" "text", "p_items" "jsonb", "p_delivery_mode" "text", "p_rider_pay" numeric) TO authenticated;
GRANT ALL ON FUNCTION public.process_customer_transaction("p_business_id" "uuid", "p_customer_id" "uuid", "p_customer_name" "text", "p_staff_id" "uuid", "p_staff_name" "text", "p_total" numeric, "p_discount" numeric, "p_tax" numeric, "p_final_total" numeric, "p_amount_paid" numeric, "p_payment_method" "public"."payment_method", "p_timestamp" timestamp with time zone, "p_note" "text", "p_is_delivery" boolean, "p_delivery_fee" numeric, "p_rider_name" "text", "p_reference_id" "text", "p_items" "jsonb", "p_delivery_mode" "text", "p_rider_pay" numeric) TO service_role;

-- ---------------------------------------------------------------- riders see what to collect and who pays them
DROP FUNCTION IF EXISTS public.fn_delivery_rows(uuid);

CREATE FUNCTION "public"."fn_delivery_rows"("p_business_id" "uuid") RETURNS TABLE("source" "text", "id" "uuid", "reference" "text", "customer_name" "text", "customer_phone" "text", "address" "text", "area" "text", "notes" "text", "amount" numeric, "delivery_fee" numeric, "status" "text", "assigned_at" timestamp with time zone, "delivered_at" timestamp with time zone, "created_at" timestamp with time zone, "items" "text", "payment" "text", "balance_due" numeric, "rider_id" "uuid", "is_open" boolean, "delivery_mode" "text", "rider_pay" numeric)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
    SELECT 'online', o.id, '#' || o.order_number,
           o.customer_name, o.customer_phone,
           o.delivery_address, o.delivery_zone, o.notes,
           o.total, o.delivery_fee,
           CASE o.status
               WHEN 'out_for_delivery' THEN 'out_for_delivery'
               WHEN 'completed' THEN 'delivered'
               WHEN 'cancelled' THEN 'failed'
               ELSE 'assigned'
           END,
           COALESCE(o.rider_assigned_at, o.created_at), o.delivered_at, o.created_at,
           (SELECT string_agg(i.quantity::FLOAT8 || ' ' || i.unit || ' ' || i.product_name, ', ')
            FROM public.online_order_items i WHERE i.order_id = o.id),
           'Paid online (M-Pesa)', 0::NUMERIC,
           o.rider_id,
           o.rider_id IS NULL AND o.status IN ('paid', 'preparing'),
           -- Website orders: paid online with the fee; the shop pays the rider.
           'charged'::TEXT, o.delivery_fee
    FROM public.online_orders o
    WHERE o.business_id = p_business_id AND o.fulfilment = 'delivery'
      AND (o.rider_id IS NOT NULL OR o.status IN ('paid', 'preparing'))
    UNION ALL
    SELECT 'sale', t.id, 'Till sale', COALESCE(c.name, t.customer_name, 'Walk-in customer'), c.phone,
           -- The till saves the location as "Deliver to: <place>." at the start of the note.
           NULLIF(trim(substring(t.note FROM '^Deliver to: ([^.]*)')), ''), NULL,
           NULLIF(trim(regexp_replace(COALESCE(t.note, ''), '^Deliver to: [^.]*\.?\s*', '')), ''),
           t.final_total, t.delivery_fee,
           COALESCE(t.delivery_status, 'assigned'),
           t.timestamp, t.delivered_at, t.timestamp,
           (SELECT string_agg(i.quantity::FLOAT8 || ' ' || i.product_name, ', ')
            FROM public.transaction_items i WHERE i.transaction_id = t.id),
           t.payment_method::TEXT,
           GREATEST(t.final_total - t.amount_paid - t.wallet_applied, 0),
           t.rider_id,
           t.rider_id IS NULL,
           t.delivery_mode, t.rider_pay
    FROM public.transactions t
    LEFT JOIN public.customers c ON c.id = t.customer_id
    WHERE t.business_id = p_business_id AND t.is_delivery AND t.deleted_at IS NULL
      AND (t.rider_id IS NOT NULL
           OR (NULLIF(trim(COALESCE(t.rider_name, '')), '') IS NULL
               AND COALESCE(t.delivery_status, 'assigned') = 'assigned'
               AND t.timestamp > NOW() - INTERVAL '3 days'));
$$;

ALTER FUNCTION public.fn_delivery_rows(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.fn_delivery_rows(uuid) FROM PUBLIC;

-- ---------------------------------------------------------------- sale edit log
CREATE OR REPLACE FUNCTION public.fn_audit_sale_change() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
    -- Bookkeeping and the rider's delivery progress are not edits.
    v_ignore   TEXT[] := ARRAY['updated_at', 'created_at', 'version', 'sync_status', 'last_modified_by', 'status'];
    v_delivery TEXT[] := ARRAY['rider_id', 'rider_name', 'delivery_status', 'delivered_at'];
    v_old      JSONB := to_jsonb(OLD);
    v_new      JSONB := CASE WHEN TG_OP = 'UPDATE' THEN to_jsonb(NEW) ELSE '{}'::JSONB END;
    v_changes  JSONB := '{}'::JSONB;
    v_key      TEXT;
    v_action   TEXT;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM public.businesses b WHERE b.id = OLD.business_id) THEN
        RETURN NULL;
    END IF;
    IF TG_OP = 'UPDATE' THEN
        FOR v_key IN SELECT jsonb_object_keys(v_new) LOOP
            CONTINUE WHEN v_key = ANY(v_ignore);
            IF (v_old -> v_key) IS DISTINCT FROM (v_new -> v_key) THEN
                v_changes := v_changes || jsonb_build_object(v_key, jsonb_build_object('from', v_old -> v_key, 'to', v_new -> v_key));
            END IF;
        END LOOP;
        -- Nothing changed, or only a rider taking / moving the delivery along.
        IF v_changes = '{}'::JSONB
           OR NOT EXISTS (SELECT 1 FROM jsonb_object_keys(v_changes) k WHERE k <> ALL(v_delivery)) THEN
            RETURN NULL;
        END IF;
    END IF;

    v_action := CASE
        WHEN TG_OP = 'DELETE' THEN 'DELETE'
        WHEN v_changes ? 'deleted_at' AND (v_new ->> 'deleted_at') IS NOT NULL THEN 'DELETE'
        WHEN v_changes ? 'deleted_at' THEN 'RESTORE'
        ELSE 'UPDATE'
    END;

    INSERT INTO public.audit_logs (business_id, user_id, action, table_name, record_id, details)
    VALUES (
        OLD.business_id,
        (SELECT u.id FROM public.users u WHERE u.id = auth.uid() OR u.auth_user_id = auth.uid() LIMIT 1),
        v_action,
        'transactions',
        OLD.id::TEXT,
        jsonb_build_object('label', 'Sale ' || public.fn_receipt_number(OLD.id), 'by', public.fn_audit_actor_name())
            || CASE WHEN TG_OP = 'UPDATE' THEN jsonb_build_object('changes', v_changes) ELSE '{}'::JSONB END
    );
    RETURN NULL;
END;
$$;
ALTER FUNCTION public.fn_audit_sale_change() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.fn_audit_sale_change() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_audit_sale_change ON public.transactions;
CREATE TRIGGER trg_audit_sale_change
    AFTER UPDATE OR DELETE ON public.transactions
    FOR EACH ROW EXECUTE FUNCTION public.fn_audit_sale_change();

-- Items: a line changed, taken out, or added after the sale was made. Lines written with the
-- sale itself (same minute) are the sale, not an edit.
CREATE OR REPLACE FUNCTION public.fn_audit_sale_item_change() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
    v_tx_id   UUID;
    v_sale    public.transactions%ROWTYPE;
    v_changes JSONB := '{}'::JSONB;
    v_what    TEXT;
BEGIN
    IF TG_OP = 'DELETE' THEN v_tx_id := OLD.transaction_id; ELSE v_tx_id := NEW.transaction_id; END IF;
    SELECT * INTO v_sale FROM public.transactions WHERE id = v_tx_id;
    IF NOT FOUND THEN
        RETURN NULL; -- the sale itself is going; its own row logs that
    END IF;
    IF TG_OP = 'INSERT' AND v_sale.created_at > NOW() - INTERVAL '1 minute' THEN
        RETURN NULL;
    END IF;

    IF TG_OP = 'UPDATE' THEN
        IF OLD.quantity IS DISTINCT FROM NEW.quantity THEN
            v_changes := v_changes || jsonb_build_object(NEW.product_name || ' quantity', jsonb_build_object('from', OLD.quantity, 'to', NEW.quantity));
        END IF;
        IF OLD.unit_price IS DISTINCT FROM NEW.unit_price THEN
            v_changes := v_changes || jsonb_build_object(NEW.product_name || ' price', jsonb_build_object('from', OLD.unit_price, 'to', NEW.unit_price));
        END IF;
        IF OLD.discount_percentage IS DISTINCT FROM NEW.discount_percentage THEN
            v_changes := v_changes || jsonb_build_object(NEW.product_name || ' discount %', jsonb_build_object('from', OLD.discount_percentage, 'to', NEW.discount_percentage));
        END IF;
        IF OLD.product_id IS DISTINCT FROM NEW.product_id OR OLD.product_name IS DISTINCT FROM NEW.product_name THEN
            v_changes := v_changes || jsonb_build_object('item', jsonb_build_object('from', OLD.product_name, 'to', NEW.product_name));
        END IF;
        IF OLD.line_total IS DISTINCT FROM NEW.line_total THEN
            v_changes := v_changes || jsonb_build_object(NEW.product_name || ' line total', jsonb_build_object('from', OLD.line_total, 'to', NEW.line_total));
        END IF;
        IF v_changes = '{}'::JSONB THEN
            RETURN NULL;
        END IF;
    ELSIF TG_OP = 'INSERT' THEN
        v_what := NEW.quantity::FLOAT8 || ' × ' || NEW.product_name || ' at ' || NEW.unit_price;
        v_changes := jsonb_build_object('item added', jsonb_build_object('from', NULL, 'to', v_what));
    ELSE
        v_what := OLD.quantity::FLOAT8 || ' × ' || OLD.product_name || ' at ' || OLD.unit_price;
        v_changes := jsonb_build_object('item removed', jsonb_build_object('from', v_what, 'to', NULL));
    END IF;

    INSERT INTO public.audit_logs (business_id, user_id, action, table_name, record_id, details)
    VALUES (
        v_sale.business_id,
        (SELECT u.id FROM public.users u WHERE u.id = auth.uid() OR u.auth_user_id = auth.uid() LIMIT 1),
        'UPDATE',
        'transactions',
        v_sale.id::TEXT,
        jsonb_build_object('label', 'Sale ' || public.fn_receipt_number(v_sale.id), 'by', public.fn_audit_actor_name(), 'changes', v_changes)
    );
    RETURN NULL;
END;
$$;
ALTER FUNCTION public.fn_audit_sale_item_change() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.fn_audit_sale_item_change() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_audit_sale_item_change ON public.transaction_items;
CREATE TRIGGER trg_audit_sale_item_change
    AFTER INSERT OR UPDATE OR DELETE ON public.transaction_items
    FOR EACH ROW EXECUTE FUNCTION public.fn_audit_sale_item_change();

-- Sale history is read by sale id (Sales Log → a sale → Changes).
CREATE INDEX IF NOT EXISTS idx_audit_logs_record ON public.audit_logs (business_id, table_name, record_id);
