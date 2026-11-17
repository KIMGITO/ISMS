-- 2026-11-17 Promotions and referrals in the books.
--
-- Till sale with a promotion code (t.promotion_discount, set by the database):
--     Sales (4000)                 credit  goods at the price before the code (VAT out)
--     Promotion discounts (4050)   debit   the code's discount (a minus against sales)
--   so profit is unchanged, and the cost of promotions has its own line in Profit or loss.
--   Referral welcome discounts and used referral reward codes are promotion discounts too.
--   Other discounts (item %, cart discount, points) stay inside Sales as before.
-- Referral wallet credit (referral_rewards.kind = 'wallet'), source 'referral_reward':
--     Referral rewards (6150)      debit   what the credit has cost (less any taken back)
--     Customer wallet money (2100) credit  the customer's wallet
--   Taken back later -> the entry is posted again for the smaller amount (or removed).
-- Points from referrals post nothing when given, like all points: they cost money only when
-- spent (as a discount at the till, or Loyalty points used on debt).
-- Online-shop promo codes stay inside the online order's figures as before.

CREATE OR REPLACE FUNCTION "public"."acc_ensure_accounts"("p_business_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
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
        ('3200', 'Owner''s account between branches', 'equity', 'branches', 'Stock moved between branches of the same owner, at cost. Adds up to zero across all branches'),
        ('4050', 'Promotion discounts', 'income', 'promo_discounts', 'Discounts given with promotion and referral codes at the till. A minus against sales'),
        ('6150', 'Referral rewards', 'expense', 'referral_rewards', 'Wallet credit given to customers for bringing new customers')
    ) AS a(code, name, type, k, d)
    WHERE NOT EXISTS (SELECT 1 FROM public.acc_accounts x WHERE x.business_id = p_business_id AND x.system_key = a.k)
    ON CONFLICT DO NOTHING;
    INSERT INTO public.acc_settings (business_id) VALUES (p_business_id) ON CONFLICT DO NOTHING;
END;
$$;

CREATE OR REPLACE FUNCTION "public"."acc_post_source"("p_type" "text", "p_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $_$
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
            -- Promotion codes (20261126003): sales at the price before the code, the code's
            -- discount on its own line, so the books show what promotions cost.
            v_lines := public.acc_l(v_lines, public.acc_account(v_b, 'sales'), -(v_goods + COALESCE(t.promotion_discount, 0)));
            v_lines := public.acc_l(v_lines, public.acc_account(v_b, 'promo_discounts'), COALESCE(t.promotion_discount, 0));
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
        IF ia.deleted_at IS NULL AND ia.type::TEXT = 'Restock' AND ia.reason = 'Opening stock' THEN
            -- Stock a product started with (20261119001): it was there before the books.
            SELECT COALESCE(cost, 0) INTO v_cost FROM public.products WHERE id = ia.product_id;
            v_cost := round(COALESCE(v_cost, 0) * COALESCE(ia.quantity_adjusted, 0), 2);
            v_lines := public.acc_l(v_lines, public.acc_account(v_b, 'inventory'), v_cost);
            v_lines := public.acc_l(v_lines, public.acc_account(v_b, 'opening'), -v_cost);
        ELSIF ia.deleted_at IS NULL
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

    ELSIF p_type = 'referral_reward' THEN
        -- Referral wallet credit (20261126003).
        SELECT r.b, r.d, r.m, r.l INTO v_b, v_date, v_memo, v_lines FROM public.acc_referral_lines(p_id) r;
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
$_$;

CREATE OR REPLACE FUNCTION "public"."acc_source_ids"("p_business_id" "uuid", "p_type" "text", "p_offset" integer, "p_limit" integer) RETURNS SETOF "uuid"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
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
            AND ((type::TEXT IN ('Damage', 'Production Waste', 'Reconciliation') AND COALESCE(reason, '') <> 'Sold')
                 OR (type::TEXT = 'Restock' AND reason = 'Opening stock'))
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
    ELSIF p_type = 'referral_reward' THEN
        RETURN QUERY SELECT id FROM public.referral_rewards WHERE business_id = p_business_id AND kind = 'wallet' ORDER BY issued_at, id OFFSET p_offset LIMIT p_limit;
    ELSIF p_type = 'transfer_in' THEN
        RETURN QUERY SELECT id FROM public.stock_transfers WHERE to_business_id = p_business_id ORDER BY created_at, id OFFSET p_offset LIMIT p_limit;
    END IF;
END;
$$;

CREATE OR REPLACE FUNCTION "public"."acc_rebuild_start"("p_business_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
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
        'purchase_receipt', 'supplier_bill', 'supplier_return', 'transfer_out', 'transfer_close', 'transfer_in', 'referral_reward'));
END;
$$;

-- The lines for one referral wallet reward.
CREATE OR REPLACE FUNCTION public.acc_referral_lines(p_id uuid) RETURNS TABLE(b uuid, d date, m text, l jsonb)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
    w public.referral_rewards%ROWTYPE;
    v_name text;
    v_amt numeric;
    v_lines jsonb := '[]'::jsonb;
BEGIN
    SELECT * INTO w FROM public.referral_rewards WHERE id = p_id;
    IF NOT FOUND OR w.kind <> 'wallet' THEN RETURN; END IF;
    SELECT name INTO v_name FROM public.customers WHERE id = w.customer_id;
    v_amt := CASE WHEN w.status IN ('issued', 'reversed') THEN w.value - w.reversed_amount ELSE 0 END;
    v_lines := public.acc_l(v_lines, public.acc_account(w.business_id, 'referral_rewards'), v_amt);
    v_lines := public.acc_l(v_lines, public.acc_account(w.business_id, 'wallets'), -v_amt, 'customer', w.customer_id::text, v_name);
    RETURN QUERY SELECT w.business_id, (w.issued_at AT TIME ZONE 'Africa/Nairobi')::date,
        'Referral reward (wallet credit) · ' || COALESCE(v_name, 'Customer'), v_lines;
END;
$$;
REVOKE ALL ON FUNCTION public.acc_referral_lines(uuid) FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_acc_referral_reward ON public.referral_rewards;
CREATE CONSTRAINT TRIGGER trg_acc_referral_reward AFTER INSERT OR UPDATE ON public.referral_rewards
    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.acc_trg_post('referral_reward');

-- The two new accounts for every business now (others get them on first use).
SELECT public.acc_ensure_accounts(id) FROM public.businesses;
