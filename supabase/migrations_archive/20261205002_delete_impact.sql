-- 20261205002_delete_impact.sql
-- Owner decision 2026-11-25: a delete is never just a swipe. The app first shows what removing a
-- customer, product or supplier would touch, and the person decides. Things that would break the
-- money rules (CLAUDE.md, rule 4) are refused here, whatever app or version asks:
--
--   customer  still owes money, still has wallet money, or has a regular order running
--   product   still has stock (its value would drop out of the stock figures), or a regular
--             order still delivers it
--   supplier  we still owe them on a bill, or an order to them is still open
--   worker    owns the business, is clocked in, or has deliveries not finished
--   branch    is the only one, has people clocked in, stock, or orders not finished; a branch is
--             now closed (deleted_at, records kept), never hard-deleted
--   expense   nothing blocks it; the sheet says where the money goes back to
--
-- delete_impact(kind, id, business) returns { name, blockers: [text], effects: [text] } for the confirm
-- sheet. Blockers say what to do first; effects say what happens and what is kept.

CREATE OR REPLACE FUNCTION public.fn_money_text(p numeric)
RETURNS text
LANGUAGE sql IMMUTABLE
SET search_path = ''
AS $$ SELECT 'KSh ' || to_char(round(COALESCE(p, 0), 2), 'FM999,999,999,990.00') $$;

CREATE OR REPLACE FUNCTION public.fn_delete_blockers(p_kind text, p_id uuid, p_business_id uuid DEFAULT NULL)
RETURNS text[]
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v text[] := '{}';
    c public.customers;
    p public.products;
    n integer;
    m numeric;
    v_emp uuid[];
BEGIN
    IF p_kind = 'customer' THEN
        SELECT * INTO c FROM public.customers WHERE id = p_id;
        IF c.debt_balance > 0 THEN
            v := v || format('Owes %s. Take the payment first.', public.fn_money_text(c.debt_balance));
        END IF;
        IF c.wallet_balance > 0 THEN
            v := v || format('Has %s in their wallet. Pay it back or use it first.', public.fn_money_text(c.wallet_balance));
        END IF;
        SELECT count(*) INTO n FROM public.regular_orders WHERE customer_id = p_id AND status IN ('requested', 'active', 'paused');
        IF n > 0 THEN
            v := v || format('%s regular %s still running. End %s first.', n, CASE WHEN n = 1 THEN 'order is' ELSE 'orders are' END, CASE WHEN n = 1 THEN 'it' ELSE 'them' END);
        END IF;
        SELECT count(*) INTO n FROM public.sales_orders WHERE customer_id = p_id AND status IN ('confirmed', 'part_delivered', 'delivered', 'invoiced');
        IF n > 0 THEN
            v := v || format('%s %s not finished (delivered and paid, or cancelled).', n, CASE WHEN n = 1 THEN 'order is' ELSE 'orders are' END);
        END IF;
    ELSIF p_kind = 'product' THEN
        SELECT * INTO p FROM public.products WHERE id = p_id;
        IF p.stock > 0 THEN
            v := v || format('%s %s still in stock, worth %s at cost. Sell it, or count it to 0 with a reason, first.',
                             trim(to_char(p.stock, 'FM999,999,990.0')), COALESCE(NULLIF(p.unit, ''), 'units'),
                             public.fn_money_text(p.stock * COALESCE(p.cost, 0)));
        END IF;
        SELECT count(*) INTO n FROM public.regular_orders WHERE product_id = p_id AND status IN ('requested', 'active', 'paused');
        IF n > 0 THEN
            v := v || format('%s regular %s still deliver it. End or change %s first.', n, CASE WHEN n = 1 THEN 'order' ELSE 'orders' END, CASE WHEN n = 1 THEN 'it' ELSE 'them' END);
        END IF;
    ELSIF p_kind = 'supplier' THEN
        SELECT COALESCE(sum(balance), 0), count(*) INTO m, n FROM public.supplier_bills
        WHERE supplier_id = p_id AND voided_at IS NULL AND status IN ('needs_check', 'open') AND balance > 0;
        IF m > 0 THEN
            v := v || format('We still owe them %s on %s %s. Pay or settle first.', public.fn_money_text(m), n, CASE WHEN n = 1 THEN 'bill' ELSE 'bills' END);
        END IF;
        SELECT count(*) INTO n FROM public.purchases
        WHERE supplier_id = p_id AND status IN ('Pending', 'RFQ', 'Awaiting approval', 'Ordered', 'Part received');
        IF n > 0 THEN
            v := v || format('%s %s to them still open. Receive or cancel %s first.', n, CASE WHEN n = 1 THEN 'order' ELSE 'orders' END, CASE WHEN n = 1 THEN 'it' ELSE 'them' END);
        END IF;
    ELSIF p_kind = 'worker' THEN
        -- p_id is the person (users.id), p_business_id the branch they are removed from.
        IF EXISTS (SELECT 1 FROM public.tenants t JOIN public.businesses b ON b.tenant_id = t.id
                   WHERE b.id = p_business_id AND t.owner_user_id = p_id)
           OR EXISTS (SELECT 1 FROM public.business_memberships
                      WHERE business_id = p_business_id AND user_id = p_id AND role::text = 'Owner') THEN
            v := v || 'They own the business. The owner can''t be removed.'::text;
        END IF;
        SELECT array_agg(id) INTO v_emp FROM public.employees
        WHERE (user_id = p_id OR id = p_id) AND (business_id = p_business_id OR business_id IS NULL);
        IF EXISTS (SELECT 1 FROM public.shifts WHERE business_id = p_business_id AND employee_id = ANY (v_emp)
                   AND end_time IS NULL AND deleted_at IS NULL) THEN
            v := v || 'They are clocked in. Clock them out first.'::text;
        END IF;
        SELECT (SELECT count(*) FROM public.transactions WHERE business_id = p_business_id AND rider_id = ANY (v_emp)
                AND is_delivery AND deleted_at IS NULL AND delivery_status IN ('assigned', 'out_for_delivery'))
             + (SELECT count(*) FROM public.online_orders WHERE business_id = p_business_id AND rider_id = ANY (v_emp)
                AND status IN ('paid', 'preparing', 'out_for_delivery'))
          INTO n;
        IF n > 0 THEN
            v := v || format('%s %s with them. Give %s to another rider or finish %s first.', n,
                             CASE WHEN n = 1 THEN 'delivery is' ELSE 'deliveries are' END,
                             CASE WHEN n = 1 THEN 'it' ELSE 'them' END, CASE WHEN n = 1 THEN 'it' ELSE 'them' END);
        END IF;
    ELSIF p_kind = 'branch' THEN
        IF NOT EXISTS (SELECT 1 FROM public.businesses o JOIN public.businesses b ON b.tenant_id = o.tenant_id
                       WHERE b.id = p_id AND o.id <> p_id AND o.deleted_at IS NULL) THEN
            v := v || 'It is your only branch. A business needs at least one.'::text;
        END IF;
        SELECT count(*) INTO n FROM public.shifts WHERE business_id = p_id AND end_time IS NULL AND deleted_at IS NULL;
        IF n > 0 THEN
            v := v || format('%s %s still clocked in there. Clock %s out first.', n, CASE WHEN n = 1 THEN 'person is' ELSE 'people are' END, CASE WHEN n = 1 THEN 'them' ELSE 'them' END);
        END IF;
        SELECT count(*), COALESCE(sum(stock * COALESCE(cost, 0)), 0) INTO n, m FROM public.products
        WHERE business_id = p_id AND deleted_at IS NULL AND stock > 0;
        IF n > 0 THEN
            v := v || format('%s %s still %s stock, worth %s at cost. Send it to another branch, or count it to 0 with a reason, first.',
                             n, CASE WHEN n = 1 THEN 'product' ELSE 'products' END, CASE WHEN n = 1 THEN 'has' ELSE 'have' END, public.fn_money_text(m));
        END IF;
        SELECT (SELECT count(*) FROM public.transactions WHERE business_id = p_id AND is_delivery AND deleted_at IS NULL
                AND delivery_status IN ('assigned', 'out_for_delivery'))
             + (SELECT count(*) FROM public.online_orders WHERE business_id = p_id
                AND status IN ('paid', 'preparing', 'out_for_delivery', 'ready_for_pickup'))
             + (SELECT count(*) FROM public.sales_orders WHERE business_id = p_id
                AND status IN ('confirmed', 'part_delivered', 'delivered', 'invoiced'))
          INTO n;
        IF n > 0 THEN
            v := v || format('%s %s not finished. Deliver, or cancel, %s first.', n, CASE WHEN n = 1 THEN 'order is' ELSE 'orders are' END, CASE WHEN n = 1 THEN 'it' ELSE 'them' END);
        END IF;
        SELECT count(*) INTO n FROM public.regular_orders WHERE business_id = p_id AND status IN ('requested', 'active', 'paused');
        IF n > 0 THEN
            v := v || format('%s regular %s still running. End %s first.', n, CASE WHEN n = 1 THEN 'order is' ELSE 'orders are' END, CASE WHEN n = 1 THEN 'it' ELSE 'them' END);
        END IF;
    END IF;
    RETURN v;
END;
$$;
REVOKE ALL ON FUNCTION public.fn_delete_blockers(text, uuid, uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.delete_impact(p_kind text, p_id uuid, p_business_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_business uuid;
    v_name text;
    e text[] := '{}';
    n integer;
    m numeric;
    d timestamptz;
    c public.customers;
    p public.products;
    x public.expenses;
    v_emp uuid[];
    v_lock date;
    v_list text;
BEGIN
    IF p_kind = 'customer' THEN
        SELECT * INTO c FROM public.customers WHERE id = p_id AND deleted_at IS NULL;
        v_business := c.business_id; v_name := c.name;
    ELSIF p_kind = 'product' THEN
        SELECT * INTO p FROM public.products WHERE id = p_id AND deleted_at IS NULL;
        v_business := p.business_id; v_name := p.name;
    ELSIF p_kind = 'supplier' THEN
        SELECT business_id, name INTO v_business, v_name FROM public.suppliers WHERE id = p_id AND deleted_at IS NULL;
    ELSIF p_kind = 'worker' THEN
        SELECT bm.business_id, COALESCE(NULLIF(u.name, ''), u.email) INTO v_business, v_name
        FROM public.business_memberships bm JOIN public.users u ON u.id = bm.user_id
        WHERE bm.user_id = p_id AND bm.business_id = p_business_id;
    ELSIF p_kind = 'branch' THEN
        SELECT id, name INTO v_business, v_name FROM public.businesses WHERE id = p_id AND deleted_at IS NULL;
    ELSIF p_kind = 'expense' THEN
        SELECT * INTO x FROM public.expenses WHERE id = p_id AND deleted_at IS NULL;
        v_business := x.business_id; v_name := x.category || ' ' || public.fn_money_text(x.amount);
    ELSE
        RAISE EXCEPTION 'Unknown kind of record.';
    END IF;
    IF v_business IS NULL THEN
        RAISE EXCEPTION 'That record is not there any more.';
    END IF;
    PERFORM public.assert_business_member(v_business);

    IF p_kind = 'customer' THEN
        SELECT count(*), max(timestamp) INTO n, d FROM public.transactions WHERE customer_id = p_id AND deleted_at IS NULL;
        e := e || CASE WHEN n > 0
                       THEN format('Their %s %s stay in the records and reports under their name (last on %s).', n, CASE WHEN n = 1 THEN 'sale' ELSE 'sales' END, to_char(d AT TIME ZONE 'Africa/Nairobi', 'DD Mon YYYY'))
                       ELSE 'They have no sales.' END;
        IF c.loyalty_points > 0 THEN
            e := e || format('Their %s loyalty points are lost.', c.loyalty_points);
        END IF;
        SELECT count(*) INTO n FROM public.invoices WHERE customer_id = p_id;
        IF n > 0 THEN
            e := e || format('%s %s stay on record.', n, CASE WHEN n = 1 THEN 'invoice' ELSE 'invoices' END);
        END IF;
        SELECT count(*) INTO n FROM public.quotes WHERE customer_id = p_id AND status IN ('draft', 'sent');
        IF n > 0 THEN
            e := e || format('%s open %s for them will no longer show a customer.', n, CASE WHEN n = 1 THEN 'quote' ELSE 'quotes' END);
        END IF;
        e := e || 'They can''t be picked at the till or messaged any more. Their website account (if any) stops working.'::text;
    ELSIF p_kind = 'product' THEN
        SELECT count(DISTINCT ti.transaction_id), COALESCE(sum(ti.quantity), 0) INTO n, m FROM public.transaction_items ti WHERE ti.product_id = p_id;
        e := e || CASE WHEN n > 0 THEN format('Sold in %s %s; those stay in the records and reports.', n, CASE WHEN n = 1 THEN 'sale' ELSE 'sales' END)
                       ELSE 'It has never been sold.' END;
        SELECT count(*) INTO n FROM public.bom_ingredients WHERE product_id = p_id;
        IF n > 0 THEN
            e := e || format('It is an ingredient in %s production %s, which will miss it.', n, CASE WHEN n = 1 THEN 'recipe' ELSE 'recipes' END);
        END IF;
        IF p.show_on_website THEN
            e := e || 'It disappears from your online shop.'::text;
        END IF;
        e := e || 'It can''t be sold or ordered any more.'::text;
    ELSIF p_kind = 'supplier' THEN
        SELECT count(*) INTO n FROM public.purchases WHERE supplier_id = p_id;
        IF n > 0 THEN
            e := e || format('%s past %s stay on record.', n, CASE WHEN n = 1 THEN 'order' ELSE 'orders' END);
        END IF;
        SELECT count(*) INTO n FROM public.products WHERE preferred_supplier_id = p_id AND deleted_at IS NULL;
        IF n > 0 THEN
            e := e || format('%s %s lose their usual supplier.', n, CASE WHEN n = 1 THEN 'product' ELSE 'products' END);
        END IF;
        e := e || 'You can''t order from them any more; their supplier login stops working.'::text;
    ELSIF p_kind = 'worker' THEN
        SELECT array_agg(id) INTO v_emp FROM public.employees
        WHERE (user_id = p_id OR id = p_id) AND (business_id = v_business OR business_id IS NULL);
        SELECT count(*) INTO n FROM public.transactions WHERE business_id = v_business AND staff_id = ANY (v_emp) AND deleted_at IS NULL;
        e := e || CASE WHEN n > 0 THEN format('The %s %s they made stay in the records under their name.', n, CASE WHEN n = 1 THEN 'sale' ELSE 'sales' END)
                       ELSE 'They have made no sales here.' END;
        SELECT COALESCE(sum(balance), 0) INTO m FROM public.fn_rider_pay_items(v_business) WHERE rider_id = ANY (v_emp) AND balance > 0;
        IF m > 0 THEN
            e := e || format('We still owe them %s rider pay. You can still pay it after they are removed.', public.fn_money_text(m));
        END IF;
        e := e || 'Their clock-in hours stay on record.'::text;
        SELECT count(*) INTO n FROM public.business_memberships bm JOIN public.businesses b ON b.id = bm.business_id
        WHERE bm.user_id = p_id AND bm.business_id <> v_business AND b.deleted_at IS NULL
          AND b.tenant_id = (SELECT tenant_id FROM public.businesses WHERE id = v_business);
        e := e || CASE WHEN n > 0 THEN format('They can''t sign in to this branch any more, but keep their place at %s other %s.', n, CASE WHEN n = 1 THEN 'branch' ELSE 'branches' END)
                       ELSE 'They can''t sign in to this business any more.' END;
    ELSIF p_kind = 'branch' THEN
        SELECT count(*), max(timestamp) INTO n, d FROM public.transactions WHERE business_id = p_id AND deleted_at IS NULL;
        e := e || CASE WHEN n > 0 THEN format('Its %s %s and its books are kept, not deleted (last sale %s).', n, CASE WHEN n = 1 THEN 'sale' ELSE 'sales' END, to_char(d AT TIME ZONE 'Africa/Nairobi', 'DD Mon YYYY'))
                       ELSE 'It has no sales. Its records are kept, not deleted.' END;
        SELECT string_agg(method || ' ' || public.fn_money_text(balance), ', ' ORDER BY method), COALESCE(sum(balance), 0)
          INTO v_list, m FROM public.money_assets WHERE business_id = p_id AND balance <> 0;
        IF v_list IS NOT NULL THEN
            e := e || format('Its accounts still show %s (%s). If that money moves, record it before closing.', public.fn_money_text(m), v_list);
        END IF;
        SELECT count(*), COALESCE(sum(debt_balance), 0) INTO n, m FROM public.customers WHERE business_id = p_id AND deleted_at IS NULL AND debt_balance > 0;
        IF n > 0 THEN
            e := e || format('%s %s owe it %s. You can''t collect that in the app once it is closed.', n, CASE WHEN n = 1 THEN 'customer' ELSE 'customers' END, public.fn_money_text(m));
        END IF;
        SELECT COALESCE(sum(balance), 0) INTO m FROM public.supplier_bills WHERE business_id = p_id AND voided_at IS NULL AND status IN ('needs_check', 'open') AND balance > 0;
        IF m > 0 THEN
            e := e || format('It still owes suppliers %s on open bills.', public.fn_money_text(m));
        END IF;
        IF EXISTS (SELECT 1 FROM public.businesses WHERE id = p_id AND NULLIF(website_slug, '') IS NOT NULL) THEN
            e := e || 'Its online shop goes offline.'::text;
        END IF;
        SELECT count(*) INTO n FROM public.business_memberships WHERE business_id = p_id AND status = 'Active' AND role::text <> 'Support';
        e := e || format('%s %s lose access to it. Nobody can sell from it or sign in to it.', n, CASE WHEN n = 1 THEN 'person' ELSE 'people' END);
    ELSIF p_kind = 'expense' THEN
        e := e || format('%s goes back to %s.', public.fn_money_text(x.amount), COALESCE(NULLIF(x.payment_method, ''), 'Cash'));
        SELECT lock_date INTO v_lock FROM public.acc_settings WHERE business_id = v_business;
        e := e || CASE WHEN v_lock IS NOT NULL AND (x.date AT TIME ZONE 'Africa/Nairobi')::date <= v_lock
                       THEN 'The books for that day are closed, so a reversing entry is made today.'
                       ELSE 'Its books entry is taken out.' END;
        IF x.rider_payment THEN
            e := e || 'It was rider pay, so the rider is owed that money again.'::text;
        END IF;
        e := e || 'It stops counting in spending, profit and shift reports.'::text;
    END IF;

    RETURN jsonb_build_object('kind', p_kind, 'name', v_name,
                              'blockers', to_jsonb(public.fn_delete_blockers(p_kind, p_id, v_business)),
                              'effects', to_jsonb(e));
END;
$$;
REVOKE ALL ON FUNCTION public.delete_impact(text, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_impact(text, uuid, uuid) TO authenticated, service_role;

-- The same blockers, enforced when the row is soft-deleted. A merge (merged_into_id set, balances
-- moved to the record kept) is not a delete.
CREATE OR REPLACE FUNCTION public.fn_guard_soft_delete()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_kind text := CASE TG_TABLE_NAME WHEN 'customers' THEN 'customer' WHEN 'products' THEN 'product' ELSE 'supplier' END;
    v_block text[];
BEGIN
    IF OLD.deleted_at IS NOT NULL OR NEW.deleted_at IS NULL THEN
        RETURN NEW;
    END IF;
    IF TG_TABLE_NAME = 'customers' AND (to_jsonb(NEW)->>'merged_into_id') IS NOT NULL THEN
        RETURN NEW;
    END IF;
    v_block := public.fn_delete_blockers(v_kind, NEW.id);
    IF cardinality(v_block) > 0 THEN
        RAISE EXCEPTION '%', v_block[1] USING ERRCODE = 'P0001', HINT = 'delete_blocked';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_customers_guard_delete ON public.customers;
CREATE TRIGGER trg_customers_guard_delete BEFORE UPDATE OF deleted_at ON public.customers
    FOR EACH ROW EXECUTE FUNCTION public.fn_guard_soft_delete();
DROP TRIGGER IF EXISTS trg_products_guard_delete ON public.products;
CREATE TRIGGER trg_products_guard_delete BEFORE UPDATE OF deleted_at ON public.products
    FOR EACH ROW EXECUTE FUNCTION public.fn_guard_soft_delete();
DROP TRIGGER IF EXISTS trg_suppliers_guard_delete ON public.suppliers;
CREATE TRIGGER trg_suppliers_guard_delete BEFORE UPDATE OF deleted_at ON public.suppliers
    FOR EACH ROW EXECUTE FUNCTION public.fn_guard_soft_delete();

-- ---------------------------------------------------------------- workers
-- Removing someone from a branch (their membership row). Support access is the platform's own
-- and is removed by its own functions.
CREATE OR REPLACE FUNCTION public.fn_guard_member_remove()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_block text[];
BEGIN
    IF OLD.role::text = 'Support' OR OLD.status <> 'Active' THEN
        RETURN OLD;
    END IF;
    v_block := public.fn_delete_blockers('worker', OLD.user_id, OLD.business_id);
    IF cardinality(v_block) > 0 THEN
        RAISE EXCEPTION '%', v_block[1] USING ERRCODE = 'P0001', HINT = 'delete_blocked';
    END IF;
    RETURN OLD;
END;
$$;
DROP TRIGGER IF EXISTS trg_memberships_guard_remove ON public.business_memberships;
CREATE TRIGGER trg_memberships_guard_remove BEFORE DELETE ON public.business_memberships
    FOR EACH ROW EXECUTE FUNCTION public.fn_guard_member_remove();

-- ---------------------------------------------------------------- branches
-- A branch was hard-deleted before, which cascaded into its sales, books and stock records.
-- Now it is closed (deleted_at) and everything is kept; nobody signed in can hard-delete one.
DROP POLICY IF EXISTS pol_businesses_delete ON public.businesses;
REVOKE DELETE, TRUNCATE ON public.businesses FROM authenticated, anon;

CREATE OR REPLACE FUNCTION public.fn_guard_branch_close()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_block text[];
BEGIN
    IF OLD.deleted_at IS NOT NULL OR NEW.deleted_at IS NULL THEN
        RETURN NEW;
    END IF;
    IF auth.uid() IS NOT NULL AND NOT public.has_permission(NEW.id, 'business.delete') THEN
        RAISE EXCEPTION 'You don''t have permission to close this branch.' USING ERRCODE = '42501';
    END IF;
    v_block := public.fn_delete_blockers('branch', NEW.id);
    IF cardinality(v_block) > 0 THEN
        RAISE EXCEPTION '%', v_block[1] USING ERRCODE = 'P0001', HINT = 'delete_blocked';
    END IF;
    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_businesses_guard_close ON public.businesses;
CREATE TRIGGER trg_businesses_guard_close BEFORE UPDATE OF deleted_at ON public.businesses
    FOR EACH ROW EXECUTE FUNCTION public.fn_guard_branch_close();

CREATE OR REPLACE FUNCTION public.close_branch(p_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF NOT public.has_permission(p_id, 'business.delete') THEN
        RAISE EXCEPTION 'You don''t have permission to close this branch.' USING ERRCODE = '42501';
    END IF;
    UPDATE public.businesses SET deleted_at = now() WHERE id = p_id AND deleted_at IS NULL;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'That branch is already closed.';
    END IF;
    INSERT INTO public.audit_logs (business_id, user_id, action, table_name, record_id)
    VALUES (p_id, (SELECT id FROM public.users WHERE auth_user_id = auth.uid()), 'branch_closed', 'businesses', p_id::text);
END;
$$;
REVOKE ALL ON FUNCTION public.close_branch(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.close_branch(uuid) TO authenticated, service_role;
