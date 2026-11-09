-- =============================================================================
-- Wallet money always pays debt first, petty cashbook, and the finance report.
--
-- 1. A customer never holds wallet money and debt at the same time. Whenever both are above
--    zero, the wallet pays the debt (oldest credit records first). Covers every path: manual
--    balance edits, merges, payments, and balances left over from before this rule.
-- 2. The part of a credit sale paid from the wallet is a paid sale: it earns 2 points per KSh.
-- 3. Sale lines remember what the goods cost when sold (unit_cost), so profit doesn't move
--    when a product's cost is changed later.
-- 4. Petty cashbook: cashiers record money taken from the till for spending. Each entry is an
--    expense (source 'petty_cash', paid in cash), so it leaves the cash balance like any other.
-- 5. get_finance_report(): every figure for owners, managers and admins, worked out on the
--    server so nothing is capped by how many rows the app downloads.
--
-- New permissions: pettycash.record (Manager, Cashier), finance.view (Manager).
-- Owners and Admins hold every permission already.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Wallet pays debt first
-- -----------------------------------------------------------------------------

-- Moves wallet money onto the customer's debt. Returns the amount moved (0 when nothing to do).
CREATE OR REPLACE FUNCTION public.fn_wallet_pays_debt(p_customer_id UUID, p_recorded_by TEXT DEFAULT 'System')
RETURNS NUMERIC
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
    v_c       RECORD;
    v_amount  NUMERIC(14,2);
    v_left    NUMERIC(14,2);
    v_applied NUMERIC(14,2);
    v_rec     RECORD;
BEGIN
    SELECT id, business_id, COALESCE(wallet_balance, 0) AS wallet, COALESCE(debt_balance, 0) AS debt
    INTO v_c
    FROM public.customers
    WHERE id = p_customer_id AND merged_into_id IS NULL
    FOR UPDATE;

    IF NOT FOUND OR v_c.wallet <= 0 OR v_c.debt <= 0 THEN
        RETURN 0;
    END IF;

    v_amount := LEAST(v_c.wallet, v_c.debt);

    UPDATE public.customers
    SET wallet_balance = v_c.wallet - v_amount,
        debt_balance   = v_c.debt - v_amount
    WHERE id = p_customer_id;

    -- Oldest credit records are settled first, the same as a cash payment towards debt.
    v_left := v_amount;
    FOR v_rec IN
        SELECT id, balance FROM public.credit_payments
        WHERE customer_id = p_customer_id AND business_id = v_c.business_id AND status IN ('Open', 'Partial')
        ORDER BY created_at ASC, id ASC
        FOR UPDATE
    LOOP
        EXIT WHEN v_left <= 0;
        v_applied := LEAST(v_left, v_rec.balance);
        v_left := v_left - v_applied;
        UPDATE public.credit_payments
        SET amount_paid = amount_paid + v_applied,
            status = CASE WHEN amount_paid + v_applied >= amount_owed THEN 'Settled'::public.credit_status ELSE 'Partial'::public.credit_status END,
            settled_at = CASE WHEN amount_paid + v_applied >= amount_owed THEN NOW() ELSE NULL END,
            updated_at = NOW()
        WHERE id = v_rec.id;
    END LOOP;

    INSERT INTO public.wallet_transactions
        (business_id, customer_id, amount, balance_before, balance_after, reason, recorded_by)
    VALUES (v_c.business_id, p_customer_id, -v_amount, v_c.wallet, v_c.wallet - v_amount,
            'Wallet money paid off debt', COALESCE(p_recorded_by, 'System'));

    -- 'wallet_usage', not 'debt_payment': this money already came in when the wallet was topped up.
    INSERT INTO public.customer_ledger
        (business_id, customer_id, type, amount, wallet_balance, debt_balance, recorded_by, note)
    VALUES (v_c.business_id, p_customer_id, 'wallet_usage', v_amount,
            v_c.wallet - v_amount, v_c.debt - v_amount, COALESCE(p_recorded_by, 'System'),
            'Wallet money paid off debt');

    -- Money towards a debt earns 1 point per KSh 1 (wallet top-ups earn nothing when paid in).
    IF FLOOR(v_amount) > 0 THEN
        UPDATE public.customers SET loyalty_points = COALESCE(loyalty_points, 0) + FLOOR(v_amount)::INTEGER
        WHERE id = p_customer_id;
        INSERT INTO public.loyalty_points_earned (business_id, customer_id, points, source, amount)
        VALUES (v_c.business_id, p_customer_id, FLOOR(v_amount)::INTEGER, 'debt_payment', v_amount);
    END IF;

    RETURN v_amount;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_wallet_pays_debt(UUID, TEXT) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.fn_trg_wallet_pays_debt()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
    -- The inner UPDATE fires this again with one side at zero, which does nothing.
    PERFORM public.fn_wallet_pays_debt(NEW.id, 'System');
    RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_wallet_pays_debt ON public.customers;
CREATE TRIGGER trg_wallet_pays_debt
    AFTER INSERT OR UPDATE OF wallet_balance, debt_balance ON public.customers
    FOR EACH ROW
    WHEN (NEW.wallet_balance > 0 AND NEW.debt_balance > 0 AND NEW.merged_into_id IS NULL)
    EXECUTE FUNCTION public.fn_trg_wallet_pays_debt();

-- -----------------------------------------------------------------------------
-- 2. Wallet-paid part of a credit sale earns sale points
-- -----------------------------------------------------------------------------

-- Points for a sale: 2 per KSh 1 paid for goods (delivery excluded). On a credit sale only
-- the part paid from the wallet counts; the rest earns 1 per KSh as the debt is paid.
CREATE OR REPLACE FUNCTION public.fn_sale_points(p_final_total NUMERIC, p_delivery_fee NUMERIC, p_method public.payment_method, p_wallet_applied NUMERIC)
RETURNS INTEGER
LANGUAGE sql IMMUTABLE
AS $$
    SELECT CASE
        WHEN p_method IN ('Credit_Debt', 'Credit') THEN
            GREATEST(0, FLOOR(LEAST(COALESCE(p_wallet_applied, 0), COALESCE(p_final_total, 0) - COALESCE(p_delivery_fee, 0)) * 2))::INTEGER
        ELSE GREATEST(0, FLOOR((COALESCE(p_final_total, 0) - COALESCE(p_delivery_fee, 0)) * 2))::INTEGER
    END;
$$;

CREATE OR REPLACE FUNCTION public.fn_process_completed_transaction() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
    points_earned INTEGER;
    v_debt_amt    NUMERIC(14,2);
    v_asset_id     UUID;
    v_asset_before NUMERIC(14,2);
    v_asset_after  NUMERIC(14,2);
    v_method       TEXT;
BEGIN
    -- 1. Loyalty points (see fn_sale_points)
    IF NEW.customer_id IS NOT NULL THEN
        points_earned := public.fn_sale_points(NEW.final_total, NEW.delivery_fee, NEW.payment_method, NEW.wallet_applied);
        UPDATE public.customers
        SET loyalty_points = COALESCE(loyalty_points, 0) + points_earned,
            purchases_count = purchases_count + 1
        WHERE id = NEW.customer_id;
    END IF;

    -- 2. Shift sales
    IF NEW.staff_id IS NOT NULL THEN
        UPDATE public.shifts
        SET sales_count = sales_count + 1,
            sales_total = sales_total + NEW.final_total
        WHERE employee_id = NEW.staff_id AND status = 'Active' AND deleted_at IS NULL;
    END IF;

    -- 3. Money Asset Tracking
    v_method := CASE
        WHEN NEW.payment_method = 'Mobile_Wallet' THEN 'Mobile_Wallet'
        WHEN NEW.payment_method = 'M-Pesa' THEN 'M-Pesa'
        WHEN NEW.payment_method = 'Card' THEN 'Card'
        WHEN NEW.payment_method = 'Bank' THEN 'Bank'
        WHEN NEW.payment_method = 'Cash' THEN 'Cash'
        ELSE 'Other'
    END;

    IF NEW.payment_method NOT IN ('Credit_Debt', 'Credit') AND NEW.final_total > 0 THEN
        INSERT INTO public.money_assets (business_id, method, balance)
        VALUES (NEW.business_id, v_method, 0)
        ON CONFLICT (business_id, method) DO NOTHING;

        SELECT id, balance INTO v_asset_id, v_asset_before
        FROM public.money_assets
        WHERE business_id = NEW.business_id AND method = v_method;

        v_asset_after := v_asset_before + NEW.final_total;

        UPDATE public.money_assets
        SET balance = v_asset_after,
            last_payment_at = NEW.timestamp,
            updated_at = NOW()
        WHERE id = v_asset_id;

        INSERT INTO public.payment_asset_ledger (
            business_id, asset_id, transaction_id, type, amount,
            balance_before, balance_after, description, method
        )
        VALUES (
            NEW.business_id, v_asset_id, NEW.id, 'Credit', NEW.final_total,
            v_asset_before, v_asset_after, 'POS Sale: ' || NEW.id, v_method
        );
    END IF;

    -- 4. Debt / wallet settlement
    IF NEW.customer_id IS NOT NULL AND NEW.payment_method IN ('Credit_Debt', 'Credit') THEN
        v_debt_amt := NEW.final_total - COALESCE(NEW.amount_paid, 0) - COALESCE(NEW.wallet_applied, 0);
        IF COALESCE(NEW.wallet_applied, 0) > 0 THEN
            UPDATE public.customers SET wallet_balance = wallet_balance - NEW.wallet_applied WHERE id = NEW.customer_id;
        END IF;
        IF v_debt_amt > 0 THEN
            INSERT INTO public.credit_payments (business_id, transaction_id, customer_id, customer_name, amount_owed, amount_paid, status, recorded_by)
            VALUES (NEW.business_id, NEW.id, NEW.customer_id, COALESCE(NEW.customer_name, 'Unknown'), v_debt_amt, 0, 'Open', NEW.staff_name);
            UPDATE public.customers SET debt_balance = debt_balance + v_debt_amt WHERE id = NEW.customer_id;
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_log_sale_points() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
    v_points INTEGER;
    v_amount NUMERIC(14,2);
BEGIN
    IF NEW.customer_id IS NULL THEN
        RETURN NEW;
    END IF;
    v_points := public.fn_sale_points(NEW.final_total, NEW.delivery_fee, NEW.payment_method, NEW.wallet_applied);
    v_amount := CASE WHEN NEW.payment_method IN ('Credit_Debt', 'Credit')
                     THEN LEAST(COALESCE(NEW.wallet_applied, 0), NEW.final_total - COALESCE(NEW.delivery_fee, 0))
                     ELSE NEW.final_total - COALESCE(NEW.delivery_fee, 0) END;
    IF v_points > 0 THEN
        INSERT INTO public.loyalty_points_earned (business_id, customer_id, points, source, amount, transaction_id)
        VALUES (NEW.business_id, NEW.customer_id, v_points, 'sale', v_amount, NEW.id);
    END IF;
    RETURN NEW;
END;
$$;

-- -----------------------------------------------------------------------------
-- 3. Cost of goods at the time of sale
-- -----------------------------------------------------------------------------
ALTER TABLE public.transaction_items ADD COLUMN IF NOT EXISTS unit_cost NUMERIC(14,2);

CREATE OR REPLACE FUNCTION public.fn_set_sale_line_cost() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
    IF NEW.unit_cost IS NULL THEN
        SELECT cost INTO NEW.unit_cost FROM public.products WHERE id = NEW.product_id;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_set_sale_line_cost ON public.transaction_items;
CREATE TRIGGER trg_set_sale_line_cost
    BEFORE INSERT ON public.transaction_items
    FOR EACH ROW EXECUTE FUNCTION public.fn_set_sale_line_cost();

-- -----------------------------------------------------------------------------
-- 4. Petty cashbook
-- -----------------------------------------------------------------------------
ALTER TABLE public.expenses ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'expense';
ALTER TABLE public.expenses ADD COLUMN IF NOT EXISTS employee_id UUID REFERENCES public.employees(id) ON DELETE SET NULL;
ALTER TABLE public.expenses ADD COLUMN IF NOT EXISTS reference_id TEXT;
ALTER TABLE public.expenses ADD COLUMN IF NOT EXISTS removed_by TEXT;
ALTER TABLE public.expenses ADD COLUMN IF NOT EXISTS removed_reason TEXT;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'expenses_source_check') THEN
        ALTER TABLE public.expenses ADD CONSTRAINT expenses_source_check CHECK (source IN ('expense', 'petty_cash'));
    END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_expenses_reference
    ON public.expenses (business_id, reference_id) WHERE reference_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_expenses_petty_cash
    ON public.expenses (business_id, date DESC) WHERE source = 'petty_cash';

-- The signed-in person's employee record in this business.
CREATE OR REPLACE FUNCTION public.fn_my_employee(p_business_id UUID)
RETURNS public.employees
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
    SELECT e.* FROM public.employees e
    JOIN public.users u ON u.id = e.user_id
    WHERE u.auth_user_id = auth.uid() AND e.business_id = p_business_id AND e.deleted_at IS NULL
    LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.fn_my_employee(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_my_employee(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.record_petty_cash(
    p_business_id  UUID,
    p_amount       NUMERIC,
    p_category     TEXT,
    p_description  TEXT,
    p_receipt_ref  TEXT DEFAULT NULL,
    p_reference_id TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
    v_me  public.employees;
    v_row public.expenses;
BEGIN
    PERFORM public.assert_business_member(p_business_id);
    PERFORM public.assert_permission(p_business_id, 'pettycash.record', 'expenses.create');

    IF p_reference_id IS NOT NULL THEN
        SELECT * INTO v_row FROM public.expenses WHERE business_id = p_business_id AND reference_id = p_reference_id;
        IF FOUND THEN
            RETURN jsonb_build_object('id', v_row.id, 'amount', v_row.amount);
        END IF;
    END IF;

    IF COALESCE(p_amount, 0) <= 0 THEN
        RAISE EXCEPTION 'Enter how much was spent.';
    END IF;
    IF p_amount > 1000000 THEN
        RAISE EXCEPTION 'That amount is too large for petty cash. Ask a manager to record it as an expense.';
    END IF;
    IF NULLIF(btrim(COALESCE(p_description, '')), '') IS NULL THEN
        RAISE EXCEPTION 'Say what the money was spent on.';
    END IF;

    v_me := public.fn_my_employee(p_business_id);

    INSERT INTO public.expenses (
        business_id, category, amount, description, date, staff_name, receipt_ref,
        payment_method, source, employee_id, reference_id, last_modified_by
    ) VALUES (
        p_business_id,
        COALESCE(NULLIF(btrim(p_category), ''), 'Petty cash'),
        ROUND(p_amount, 2),
        btrim(p_description),
        NOW(),
        COALESCE(v_me.name, 'Staff'),
        NULLIF(btrim(COALESCE(p_receipt_ref, '')), ''),
        'Cash',
        'petty_cash',
        v_me.id,
        p_reference_id,
        COALESCE(v_me.name, 'Staff')
    )
    RETURNING * INTO v_row;

    RETURN jsonb_build_object('id', v_row.id, 'amount', v_row.amount);
END;
$$;

-- Petty cash entries for a period. Staff who can't see all expenses see only their own.
CREATE OR REPLACE FUNCTION public.list_petty_cash(p_business_id UUID, p_start TIMESTAMPTZ, p_end TIMESTAMPTZ)
RETURNS TABLE (
    id UUID, date TIMESTAMPTZ, category TEXT, description TEXT, amount NUMERIC, staff_name TEXT,
    receipt_ref TEXT, mine BOOLEAN, removed BOOLEAN, removed_by TEXT, removed_reason TEXT
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
    v_me  public.employees;
    v_all BOOLEAN;
BEGIN
    PERFORM public.assert_business_member(p_business_id);
    PERFORM public.assert_permission(p_business_id, 'pettycash.record', 'expenses.view', 'finance.view');
    v_me := public.fn_my_employee(p_business_id);
    v_all := public.has_permission(p_business_id, 'expenses.view', 'finance.view');

    RETURN QUERY
    SELECT e.id, e.date, e.category, e.description, e.amount, e.staff_name, e.receipt_ref,
           (v_me.id IS NOT NULL AND e.employee_id = v_me.id),
           e.deleted_at IS NOT NULL, e.removed_by, e.removed_reason
    FROM public.expenses e
    WHERE e.business_id = p_business_id
      AND e.source = 'petty_cash'
      AND e.date >= p_start AND e.date <= p_end
      AND (v_all OR (v_me.id IS NOT NULL AND e.employee_id = v_me.id))
    ORDER BY e.date DESC
    LIMIT 500;
END;
$$;

-- Takes a petty cash entry back out. The person who recorded it can do this for 24 hours;
-- after that, or for someone else's entry, it needs expenses.delete. The cash goes back.
CREATE OR REPLACE FUNCTION public.remove_petty_cash(p_expense_id UUID, p_reason TEXT)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
    v_row public.expenses;
    v_me  public.employees;
BEGIN
    SELECT * INTO v_row FROM public.expenses WHERE id = p_expense_id AND source = 'petty_cash' FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Entry not found.';
    END IF;
    PERFORM public.assert_business_member(v_row.business_id);
    IF v_row.deleted_at IS NOT NULL THEN
        RETURN;
    END IF;
    IF NULLIF(btrim(COALESCE(p_reason, '')), '') IS NULL THEN
        RAISE EXCEPTION 'Say why this entry is being removed.';
    END IF;

    v_me := public.fn_my_employee(v_row.business_id);
    IF NOT public.has_permission(v_row.business_id, 'expenses.delete') THEN
        IF v_me.id IS NULL OR v_row.employee_id IS DISTINCT FROM v_me.id THEN
            RAISE EXCEPTION 'Only a manager can remove someone else''s entry.' USING ERRCODE = '42501';
        END IF;
        IF v_row.created_at < NOW() - INTERVAL '24 hours' THEN
            RAISE EXCEPTION 'This entry is more than a day old. Ask a manager to remove it.' USING ERRCODE = '42501';
        END IF;
    END IF;

    UPDATE public.expenses
    SET deleted_at = NOW(),
        removed_by = COALESCE(v_me.name, 'Staff'),
        removed_reason = btrim(p_reason),
        last_modified_by = COALESCE(v_me.name, 'Staff')
    WHERE id = p_expense_id;
END;
$$;

REVOKE ALL ON FUNCTION public.record_petty_cash(UUID, NUMERIC, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.list_petty_cash(UUID, TIMESTAMPTZ, TIMESTAMPTZ) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.remove_petty_cash(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_petty_cash(UUID, NUMERIC, TEXT, TEXT, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_petty_cash(UUID, TIMESTAMPTZ, TIMESTAMPTZ) TO authenticated;
GRANT EXECUTE ON FUNCTION public.remove_petty_cash(UUID, TEXT) TO authenticated;

-- -----------------------------------------------------------------------------
-- 5. Finance report
-- -----------------------------------------------------------------------------
-- Figures for [p_start, p_end]. Debts, wallets and unused points are as they stand now.
-- Profit = sales without VAT - cost of goods - expenses - debt paid off with points.
-- (Points used at the till or online already came off the sale's price.)
CREATE OR REPLACE FUNCTION public.get_finance_report(p_business_id UUID, p_start TIMESTAMPTZ, p_end TIMESTAMPTZ)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
    v_sales      JSONB;
    v_methods    JSONB;
    v_cogs       JSONB;
    v_expenses   JSONB;
    v_exp_cats   JSONB;
    v_exp_list   JSONB;
    v_points     JSONB;
    v_money_in   JSONB;
    v_debts      JSONB;
    v_wallets    JSONB;
    v_daily      JSONB;
    v_activity   JSONB;
    v_products   JSONB;
    v_goods      NUMERIC := 0;
    v_cost       NUMERIC := 0;
    v_exp_total  NUMERIC := 0;
    v_pts_debt   NUMERIC := 0;
BEGIN
    PERFORM public.assert_business_member(p_business_id);
    PERFORM public.assert_permission(p_business_id, 'finance.view');

    -- Sales
    SELECT jsonb_build_object(
        'count', COUNT(*),
        'total', COALESCE(SUM(final_total), 0),
        'vat', COALESCE(SUM(tax), 0),
        'delivery', COALESCE(SUM(CASE WHEN is_delivery THEN delivery_fee ELSE 0 END), 0),
        'discounts', COALESCE(SUM(discount), 0),
        'net', COALESCE(SUM(final_total - tax), 0),
        'paid', COALESCE(SUM(final_total) FILTER (WHERE payment_method NOT IN ('Credit_Debt', 'Credit')), 0),
        'credit', COALESCE(SUM(final_total) FILTER (WHERE payment_method IN ('Credit_Debt', 'Credit')), 0),
        'creditCount', COUNT(*) FILTER (WHERE payment_method IN ('Credit_Debt', 'Credit')),
        'walletUsed', COALESCE(SUM(wallet_applied) FILTER (WHERE payment_method IN ('Credit_Debt', 'Credit')), 0),
        'creditOwed', COALESCE(SUM(GREATEST(0, final_total - COALESCE(amount_paid, 0) - COALESCE(wallet_applied, 0)))
                        FILTER (WHERE payment_method IN ('Credit_Debt', 'Credit')), 0)
    ), COALESCE(SUM(final_total - tax), 0)
    INTO v_sales, v_goods
    FROM public.transactions
    WHERE business_id = p_business_id AND deleted_at IS NULL
      AND timestamp >= p_start AND timestamp <= p_end;

    SELECT COALESCE(jsonb_object_agg(m, amt), '{}'::JSONB) INTO v_methods
    FROM (
        SELECT payment_method::TEXT AS m, SUM(final_total) AS amt
        FROM public.transactions
        WHERE business_id = p_business_id AND deleted_at IS NULL
          AND timestamp >= p_start AND timestamp <= p_end
        GROUP BY payment_method
    ) x;

    -- Cost of goods: the cost recorded on the sale line, else the product's cost now
    SELECT jsonb_build_object(
        'total', COALESCE(SUM(ti.quantity * COALESCE(ti.unit_cost, p.cost, 0)), 0),
        'estimatedLines', COUNT(*) FILTER (WHERE ti.unit_cost IS NULL),
        'lines', COUNT(*)
    ), COALESCE(SUM(ti.quantity * COALESCE(ti.unit_cost, p.cost, 0)), 0)
    INTO v_cogs, v_cost
    FROM public.transaction_items ti
    JOIN public.transactions t ON t.id = ti.transaction_id
    LEFT JOIN public.products p ON p.id = ti.product_id
    WHERE t.business_id = p_business_id AND t.deleted_at IS NULL
      AND t.timestamp >= p_start AND t.timestamp <= p_end;

    -- Best and worst products by profit
    SELECT COALESCE(jsonb_agg(row_to_json(x) ORDER BY x.profit DESC), '[]'::JSONB) INTO v_products
    FROM (
        SELECT ti.product_name AS name,
               SUM(ti.quantity) AS qty,
               SUM(ti.line_total) AS revenue,
               SUM(ti.quantity * COALESCE(ti.unit_cost, p.cost, 0)) AS cost,
               SUM(ti.line_total) - SUM(ti.quantity * COALESCE(ti.unit_cost, p.cost, 0)) AS profit
        FROM public.transaction_items ti
        JOIN public.transactions t ON t.id = ti.transaction_id
        LEFT JOIN public.products p ON p.id = ti.product_id
        WHERE t.business_id = p_business_id AND t.deleted_at IS NULL
          AND t.timestamp >= p_start AND t.timestamp <= p_end
        GROUP BY ti.product_name
        ORDER BY 5 DESC
        LIMIT 50
    ) x;

    -- Expenses (petty cash is part of them)
    SELECT jsonb_build_object(
        'total', COALESCE(SUM(amount), 0),
        'pettyCash', COALESCE(SUM(amount) FILTER (WHERE source = 'petty_cash'), 0),
        'pettyCashCount', COUNT(*) FILTER (WHERE source = 'petty_cash'),
        'count', COUNT(*)
    ), COALESCE(SUM(amount), 0)
    INTO v_expenses, v_exp_total
    FROM public.expenses
    WHERE business_id = p_business_id AND deleted_at IS NULL
      AND date >= p_start AND date <= p_end;

    SELECT COALESCE(jsonb_agg(row_to_json(x) ORDER BY x.amount DESC), '[]'::JSONB) INTO v_exp_cats
    FROM (
        SELECT category, SUM(amount) AS amount, COUNT(*) AS count,
               SUM(amount) FILTER (WHERE source = 'petty_cash') AS "pettyCash"
        FROM public.expenses
        WHERE business_id = p_business_id AND deleted_at IS NULL
          AND date >= p_start AND date <= p_end
        GROUP BY category
    ) x;

    SELECT COALESCE(jsonb_agg(row_to_json(x) ORDER BY x.date DESC), '[]'::JSONB) INTO v_exp_list
    FROM (
        SELECT id, date, category, description, amount, staff_name AS "staffName",
               source, payment_method AS method, receipt_ref AS "receiptRef"
        FROM public.expenses
        WHERE business_id = p_business_id AND deleted_at IS NULL
          AND date >= p_start AND date <= p_end
        ORDER BY date DESC
        LIMIT 300
    ) x;

    -- Points: earned, used (and what they cost), and what customers still hold
    SELECT COALESCE(SUM(value), 0) INTO v_pts_debt
    FROM public.loyalty_redemptions
    WHERE business_id = p_business_id AND refunded_at IS NULL AND kind = 'account'
      AND created_at >= p_start AND created_at <= p_end;

    SELECT jsonb_build_object(
        'earned', (SELECT COALESCE(SUM(points), 0) FROM public.loyalty_points_earned
                   WHERE business_id = p_business_id AND created_at >= p_start AND created_at <= p_end),
        'earnedBySource', (SELECT COALESCE(jsonb_object_agg(source, pts), '{}'::JSONB) FROM (
                   SELECT source, SUM(points) AS pts FROM public.loyalty_points_earned
                   WHERE business_id = p_business_id AND created_at >= p_start AND created_at <= p_end
                   GROUP BY source) s),
        'used', (SELECT COALESCE(jsonb_agg(row_to_json(u)), '[]'::JSONB) FROM (
                   SELECT kind, COUNT(*) AS count, SUM(points) AS points, SUM(value) AS value
                   FROM public.loyalty_redemptions
                   WHERE business_id = p_business_id AND refunded_at IS NULL
                     AND created_at >= p_start AND created_at <= p_end
                   GROUP BY kind) u),
        'usedValue', (SELECT COALESCE(SUM(value), 0) FROM public.loyalty_redemptions
                   WHERE business_id = p_business_id AND refunded_at IS NULL
                     AND created_at >= p_start AND created_at <= p_end),
        'debtPaidWithPoints', v_pts_debt,
        'outstandingPoints', (SELECT COALESCE(SUM(loyalty_points), 0) FROM public.customers
                   WHERE business_id = p_business_id AND deleted_at IS NULL AND merged_into_id IS NULL),
        'outstandingValue', (SELECT COALESCE(SUM(loyalty_points * public.fn_point_value(business_id, tier)), 0) FROM public.customers
                   WHERE business_id = p_business_id AND deleted_at IS NULL AND merged_into_id IS NULL)
    ) INTO v_points;

    -- Money that came in. Customer money is counted once, from the customer ledger, which every
    -- payment, debt payment and top-up writes to. Voided payments are left out.
    WITH voided AS (
        SELECT reference_code FROM public.payments
        WHERE business_id = p_business_id AND status = 'Voided'
    ), ledger AS (
        SELECT l.type, l.amount FROM public.customer_ledger l
        WHERE l.business_id = p_business_id
          AND l.created_at >= p_start AND l.created_at <= p_end
          AND l.type IN ('debt_payment', 'wallet_topup')
          AND NOT EXISTS (SELECT 1 FROM voided v
                          WHERE l.reference_id IN (v.reference_code || '-debt-payment', v.reference_code || '-wallet-topup'))
    )
    SELECT jsonb_build_object(
        'sales', COALESCE((v_sales->>'paid')::NUMERIC, 0),
        'debtRepaid', COALESCE((SELECT SUM(amount) FROM ledger WHERE type = 'debt_payment'), 0),
        'walletTopups', COALESCE((SELECT SUM(amount) FROM ledger WHERE type = 'wallet_topup'), 0),
        'otherPayments', COALESCE((SELECT SUM(amount - debt_applied - wallet_applied) FROM public.payments
                          WHERE business_id = p_business_id AND status = 'Success'
                            AND date >= p_start AND date <= p_end), 0)
    ) INTO v_money_in;

    -- Debts as they stand now, with their age
    SELECT jsonb_build_object(
        'outstanding', (SELECT COALESCE(SUM(debt_balance), 0) FROM public.customers
                        WHERE business_id = p_business_id AND deleted_at IS NULL AND merged_into_id IS NULL),
        'debtors', (SELECT COUNT(*) FROM public.customers
                    WHERE business_id = p_business_id AND deleted_at IS NULL AND merged_into_id IS NULL AND debt_balance > 0),
        'aging', (SELECT jsonb_build_object(
                    'week', COALESCE(SUM(balance) FILTER (WHERE created_at >= NOW() - INTERVAL '7 days'), 0),
                    'month', COALESCE(SUM(balance) FILTER (WHERE created_at < NOW() - INTERVAL '7 days' AND created_at >= NOW() - INTERVAL '30 days'), 0),
                    'quarter', COALESCE(SUM(balance) FILTER (WHERE created_at < NOW() - INTERVAL '30 days' AND created_at >= NOW() - INTERVAL '90 days'), 0),
                    'older', COALESCE(SUM(balance) FILTER (WHERE created_at < NOW() - INTERVAL '90 days'), 0))
                  FROM public.credit_payments
                  WHERE business_id = p_business_id AND status IN ('Open', 'Partial')),
        'top', (SELECT COALESCE(jsonb_agg(row_to_json(d)), '[]'::JSONB) FROM (
                  SELECT c.id, c.name, c.phone, c.debt_balance AS owed,
                         (SELECT MIN(cp.created_at) FROM public.credit_payments cp
                          WHERE cp.customer_id = c.id AND cp.status IN ('Open', 'Partial')) AS since
                  FROM public.customers c
                  WHERE c.business_id = p_business_id AND c.deleted_at IS NULL AND c.merged_into_id IS NULL AND c.debt_balance > 0
                  ORDER BY c.debt_balance DESC
                  LIMIT 15) d)
    ) INTO v_debts;

    SELECT jsonb_build_object(
        'held', COALESCE(SUM(wallet_balance), 0),
        'customers', COUNT(*) FILTER (WHERE wallet_balance > 0)
    ) INTO v_wallets
    FROM public.customers
    WHERE business_id = p_business_id AND deleted_at IS NULL AND merged_into_id IS NULL;

    -- Day by day, on the Kenya clock
    WITH days AS (
        SELECT generate_series(
            date_trunc('day', p_start AT TIME ZONE 'Africa/Nairobi'),
            date_trunc('day', p_end AT TIME ZONE 'Africa/Nairobi'),
            INTERVAL '1 day') AS d
        LIMIT 400
    ), s AS (
        SELECT date_trunc('day', t.timestamp AT TIME ZONE 'Africa/Nairobi') AS d,
               SUM(t.final_total - t.tax) AS sales
        FROM public.transactions t
        WHERE t.business_id = p_business_id AND t.deleted_at IS NULL AND t.timestamp >= p_start AND t.timestamp <= p_end
        GROUP BY 1
    ), c AS (
        SELECT date_trunc('day', t.timestamp AT TIME ZONE 'Africa/Nairobi') AS d,
               SUM(ti.quantity * COALESCE(ti.unit_cost, p.cost, 0)) AS cost
        FROM public.transaction_items ti
        JOIN public.transactions t ON t.id = ti.transaction_id
        LEFT JOIN public.products p ON p.id = ti.product_id
        WHERE t.business_id = p_business_id AND t.deleted_at IS NULL AND t.timestamp >= p_start AND t.timestamp <= p_end
        GROUP BY 1
    ), e AS (
        SELECT date_trunc('day', date AT TIME ZONE 'Africa/Nairobi') AS d, SUM(amount) AS expenses
        FROM public.expenses
        WHERE business_id = p_business_id AND deleted_at IS NULL AND date >= p_start AND date <= p_end
        GROUP BY 1
    ), r AS (
        SELECT date_trunc('day', created_at AT TIME ZONE 'Africa/Nairobi') AS d, SUM(value) AS points
        FROM public.loyalty_redemptions
        WHERE business_id = p_business_id AND refunded_at IS NULL AND kind = 'account'
          AND created_at >= p_start AND created_at <= p_end
        GROUP BY 1
    )
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'day', to_char(days.d, 'YYYY-MM-DD'),
        'sales', COALESCE(s.sales, 0),
        'cost', COALESCE(c.cost, 0),
        'expenses', COALESCE(e.expenses, 0),
        'points', COALESCE(r.points, 0),
        'profit', COALESCE(s.sales, 0) - COALESCE(c.cost, 0) - COALESCE(e.expenses, 0) - COALESCE(r.points, 0)
    ) ORDER BY days.d), '[]'::JSONB) INTO v_daily
    FROM days
    LEFT JOIN s ON s.d = days.d
    LEFT JOIN c ON c.d = days.d
    LEFT JOIN e ON e.d = days.d
    LEFT JOIN r ON r.d = days.d;

    -- What happened, newest first
    SELECT COALESCE(jsonb_agg(row_to_json(a) ORDER BY a.at DESC), '[]'::JSONB) INTO v_activity
    FROM (
        (SELECT t.timestamp AS at,
                CASE WHEN t.payment_method IN ('Credit_Debt', 'Credit') THEN 'credit_sale' ELSE 'sale' END AS kind,
                t.final_total AS amount,
                COALESCE(t.wallet_applied, 0) AS wallet,
                t.payment_method::TEXT AS method,
                t.customer_name AS customer,
                t.staff_name AS "by",
                NULL::TEXT AS detail
         FROM public.transactions t
         WHERE t.business_id = p_business_id AND t.deleted_at IS NULL AND t.timestamp >= p_start AND t.timestamp <= p_end
         ORDER BY t.timestamp DESC LIMIT 200)
        UNION ALL
        (SELECT e.date, CASE WHEN e.source = 'petty_cash' THEN 'petty_cash' ELSE 'expense' END, e.amount, 0,
                e.payment_method, NULL, e.staff_name, e.category || COALESCE(': ' || NULLIF(e.description, ''), '')
         FROM public.expenses e
         WHERE e.business_id = p_business_id AND e.deleted_at IS NULL AND e.date >= p_start AND e.date <= p_end
         ORDER BY e.date DESC LIMIT 200)
        UNION ALL
        (SELECT l.created_at, l.type, l.amount, 0, NULL, c.name, l.recorded_by, NULL
         FROM public.customer_ledger l
         JOIN public.customers c ON c.id = l.customer_id
         WHERE l.business_id = p_business_id AND l.created_at >= p_start AND l.created_at <= p_end
           AND (l.type IN ('debt_payment', 'wallet_topup') OR (l.type = 'wallet_usage' AND l.transaction_id IS NULL))
         ORDER BY l.created_at DESC LIMIT 200)
        UNION ALL
        (SELECT r.created_at, 'points_' || r.kind, r.value, 0, NULL, c.name, r.recorded_by, r.points::TEXT
         FROM public.loyalty_redemptions r
         JOIN public.customers c ON c.id = r.customer_id
         WHERE r.business_id = p_business_id AND r.refunded_at IS NULL AND r.created_at >= p_start AND r.created_at <= p_end
         ORDER BY r.created_at DESC LIMIT 200)
        UNION ALL
        (SELECT p.voided_at, 'payment_voided', p.amount, 0, p.method, p.customer_name, p.voided_by, p.void_reason
         FROM public.payments p
         WHERE p.business_id = p_business_id AND p.status = 'Voided' AND p.voided_at >= p_start AND p.voided_at <= p_end
         ORDER BY p.voided_at DESC LIMIT 100)
        ORDER BY 1 DESC
        LIMIT 400
    ) a;

    RETURN jsonb_build_object(
        'start', p_start,
        'end', p_end,
        'sales', v_sales,
        'salesByMethod', v_methods,
        'costOfGoods', v_cogs,
        'expenses', v_expenses,
        'expenseCategories', v_exp_cats,
        'expenseList', v_exp_list,
        'points', v_points,
        'moneyIn', v_money_in,
        'debts', v_debts,
        'wallets', v_wallets,
        'products', v_products,
        'daily', v_daily,
        'activity', v_activity,
        'profit', jsonb_build_object(
            'sales', v_goods,
            'costOfGoods', v_cost,
            'gross', v_goods - v_cost,
            'expenses', v_exp_total,
            'pointsToDebt', v_pts_debt,
            'net', v_goods - v_cost - v_exp_total - v_pts_debt
        )
    );
END;
$$;

REVOKE ALL ON FUNCTION public.get_finance_report(UUID, TIMESTAMPTZ, TIMESTAMPTZ) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_finance_report(UUID, TIMESTAMPTZ, TIMESTAMPTZ) TO authenticated;

-- -----------------------------------------------------------------------------
-- 6. Role defaults (mirrors SYSTEM_ROLES in src/utils/permissions.ts; a test compares them)
-- -----------------------------------------------------------------------------
INSERT INTO public.role_default_permissions (role, permissions) VALUES
    ('Manager', ARRAY['ai.insights', 'ai.use', 'assets.view', 'bom.create', 'bom.update', 'bom.view', 'business.switch', 'business.view', 'communication.send', 'communication.view', 'complaints.reply', 'complaints.view', 'customers.create', 'customers.debts', 'customers.loyalty', 'customers.manage', 'customers.schedules', 'customers.update', 'customers.view', 'dashboard.view', 'deliveries.assign', 'deliveries.cancel', 'deliveries.complete', 'deliveries.create', 'deliveries.view', 'expenses.create', 'expenses.update', 'expenses.view', 'files.view', 'finance.view', 'home.view', 'inventory.adjust_stock', 'inventory.expiry', 'inventory.receive_stock', 'inventory.stock_count', 'inventory.stock_history', 'inventory.transfer_stock', 'inventory.view', 'inventory.wastage', 'loyalty.adjust', 'notifications.send', 'notifications.view', 'online_store.view', 'orders.assign_rider', 'orders.complete', 'orders.create', 'orders.update', 'orders.view', 'payments.cash', 'payments.verify', 'payments.view', 'pettycash.record', 'pos.close_shift', 'pos.create_sale', 'pos.open_shift', 'pos.walkin_customer', 'production.approve', 'production.create', 'production.update', 'production.view', 'products.create', 'products.export', 'products.import', 'products.manage_categories', 'products.update', 'products.view', 'purchases.approve', 'purchases.create', 'purchases.export', 'purchases.print', 'purchases.update', 'purchases.view', 'reports.customers', 'reports.deliveries', 'reports.inventory', 'reports.profit', 'reports.sales', 'reports.view', 'settings.tax', 'settings.theme', 'settings.update', 'settings.view', 'staff.schedule', 'staff.view', 'suppliers.create', 'suppliers.export', 'suppliers.import', 'suppliers.update', 'suppliers.view']),
    ('Cashier', ARRAY['ai.use', 'business.view', 'complaints.view', 'customers.create', 'customers.debts', 'customers.loyalty', 'customers.schedules', 'customers.view', 'dashboard.view', 'inventory.view', 'notifications.view', 'online_store.view', 'orders.assign_rider', 'orders.create', 'orders.update', 'orders.view', 'payments.cash', 'payments.mpesa', 'payments.verify', 'pettycash.record', 'pos.cancel_sale', 'pos.close_shift', 'pos.create_sale', 'pos.discount', 'pos.open_shift', 'pos.walkin_customer', 'products.view', 'settings.theme']),
    ('Rider', ARRAY['ai.use', 'business.view', 'dashboard.view', 'deliveries.cancel', 'deliveries.complete', 'deliveries.view', 'notifications.view', 'settings.theme'])
ON CONFLICT (role) DO UPDATE SET permissions = EXCLUDED.permissions;

-- -----------------------------------------------------------------------------
-- 7. One time: customers holding wallet money and debt now have the wallet pay the debt
-- -----------------------------------------------------------------------------
DO $$
DECLARE
    v_id UUID;
BEGIN
    FOR v_id IN
        SELECT id FROM public.customers
        WHERE wallet_balance > 0 AND debt_balance > 0 AND merged_into_id IS NULL
    LOOP
        PERFORM public.fn_wallet_pays_debt(v_id, 'System');
    END LOOP;
END $$;
