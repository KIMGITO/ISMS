-- =============================================================================
-- 20261105014_role_enforcement.sql
-- Why: Screens hid things by role, but the database only checked business
-- membership, so any member could read or change anything through the API. Every
-- business table and staff function now checks the same permissions the app does.
-- role_default_permissions mirrors SYSTEM_ROLES in src/utils/permissions.ts; a unit
-- test fails if they differ. role_permissions rows override it per business.
-- Dependencies: 20260715014 (policies), 20261105002 (assert_business_member),
--               20261105010 (customer portal), 20261105013 (groups and loyalty)
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.role_default_permissions (
    role        TEXT PRIMARY KEY,
    permissions TEXT[] NOT NULL
);

ALTER TABLE public.role_default_permissions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.role_default_permissions FROM anon, authenticated;

INSERT INTO public.role_default_permissions (role, permissions) VALUES
    ('Manager', ARRAY['ai.insights', 'ai.use', 'assets.view', 'bom.create', 'bom.update', 'bom.view', 'business.switch', 'business.view', 'communication.send', 'communication.view', 'complaints.reply', 'complaints.view', 'customers.create', 'customers.debts', 'customers.loyalty', 'customers.manage', 'customers.schedules', 'customers.update', 'customers.view', 'dashboard.view', 'deliveries.assign', 'deliveries.cancel', 'deliveries.complete', 'deliveries.create', 'deliveries.view', 'expenses.create', 'expenses.update', 'expenses.view', 'files.view', 'home.view', 'inventory.adjust_stock', 'inventory.expiry', 'inventory.receive_stock', 'inventory.stock_count', 'inventory.stock_history', 'inventory.transfer_stock', 'inventory.view', 'inventory.wastage', 'loyalty.adjust', 'notifications.send', 'notifications.view', 'online_store.view', 'orders.assign_rider', 'orders.complete', 'orders.create', 'orders.update', 'orders.view', 'payments.cash', 'payments.verify', 'payments.view', 'pos.close_shift', 'pos.create_sale', 'pos.open_shift', 'pos.walkin_customer', 'production.approve', 'production.create', 'production.update', 'production.view', 'products.create', 'products.export', 'products.import', 'products.manage_categories', 'products.update', 'products.view', 'purchases.approve', 'purchases.create', 'purchases.export', 'purchases.print', 'purchases.update', 'purchases.view', 'reports.customers', 'reports.deliveries', 'reports.inventory', 'reports.profit', 'reports.sales', 'reports.view', 'settings.tax', 'settings.theme', 'settings.update', 'settings.view', 'staff.schedule', 'staff.view', 'suppliers.create', 'suppliers.export', 'suppliers.import', 'suppliers.update', 'suppliers.view']),
    ('Cashier', ARRAY['ai.use', 'business.view', 'complaints.view', 'customers.create', 'customers.debts', 'customers.loyalty', 'customers.schedules', 'customers.view', 'dashboard.view', 'inventory.view', 'notifications.view', 'online_store.view', 'orders.assign_rider', 'orders.create', 'orders.update', 'orders.view', 'payments.cash', 'payments.mpesa', 'payments.verify', 'pos.cancel_sale', 'pos.close_shift', 'pos.create_sale', 'pos.discount', 'pos.open_shift', 'pos.walkin_customer', 'products.view', 'settings.theme']),
    ('Rider', ARRAY['ai.use', 'business.view', 'dashboard.view', 'deliveries.cancel', 'deliveries.complete', 'deliveries.view', 'notifications.view', 'settings.theme'])
ON CONFLICT (role) DO UPDATE SET permissions = EXCLUDED.permissions;

-- True when the signed-in member's role holds any of these permissions. Backend callers,
-- which aren't anon or authenticated, already passed their own checks.
CREATE OR REPLACE FUNCTION public.has_permission(p_business_id UUID, VARIADIC p_permissions TEXT[])
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_role TEXT;
    v_code TEXT;
    v_granted BOOLEAN;
BEGIN
    IF COALESCE(current_setting('role', TRUE), 'none') NOT IN ('anon', 'authenticated') THEN
        RETURN TRUE;
    END IF;

    SELECT bm.role::TEXT INTO v_role
    FROM public.business_memberships bm
    JOIN public.users u ON u.id = bm.user_id
    WHERE u.auth_user_id = auth.uid()
      AND bm.business_id = p_business_id
      AND bm.status = 'Active';

    IF v_role IS NULL THEN
        RETURN FALSE;
    END IF;
    IF v_role IN ('Owner', 'Admin', 'Administrator') THEN
        RETURN TRUE;
    END IF;

    FOREACH v_code IN ARRAY p_permissions LOOP
        SELECT rp.granted INTO v_granted
        FROM public.role_permissions rp
        WHERE rp.business_id = p_business_id AND rp.role::TEXT = v_role AND rp.permission = v_code;

        IF COALESCE(v_granted, v_code = ANY(
            COALESCE((SELECT d.permissions FROM public.role_default_permissions d WHERE d.role = v_role), '{}')
        )) THEN
            RETURN TRUE;
        END IF;
    END LOOP;

    RETURN FALSE;
END;
$$;

CREATE OR REPLACE FUNCTION public.assert_permission(p_business_id UUID, VARIADIC p_permissions TEXT[])
RETURNS VOID
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF NOT public.has_permission(p_business_id, VARIADIC p_permissions) THEN
        RAISE EXCEPTION 'Your role does not allow this.' USING ERRCODE = '42501';
    END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.is_my_employee(p_employee_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.employees e
        JOIN public.users u ON u.id = e.user_id
        WHERE e.id = p_employee_id AND u.auth_user_id = auth.uid()
    );
$$;

REVOKE ALL ON FUNCTION public.has_permission(UUID, TEXT[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_permission(UUID, TEXT[]) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.assert_permission(UUID, TEXT[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.assert_permission(UUID, TEXT[]) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.is_my_employee(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_my_employee(UUID) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Tables whose rules depend only on permissions. Each list means any one of them;
-- NULL means that action isn't open to clients, so it goes through a function.
-- ---------------------------------------------------------------------------
DO $migration$
DECLARE
    v_rule RECORD;
    v_policy RECORD;
BEGIN
    FOR v_rule IN
        SELECT * FROM (VALUES
            ('products', 'products.view,inventory.view,pos.create_sale', 'products.create', 'products.update,products.delete,inventory.adjust_stock,inventory.manage', 'products.delete'),
            ('customers', 'customers.view', 'customers.create', 'customers.update,customers.delete,customers.debts,customers.loyalty', 'customers.delete'),
            ('customer_ledger', 'customers.view,customers.debts', 'customers.debts,pos.create_sale', NULL, NULL),
            ('debt_payments', 'customers.debts', 'customers.debts,pos.create_sale', NULL, NULL),
            ('credit_payments', 'customers.debts', 'customers.debts,pos.create_sale', 'customers.debts', NULL),
            ('wallet_transactions', 'customers.view,customers.debts', 'customers.debts,pos.create_sale', NULL, NULL),
            ('inventory_adjustments', 'inventory.view,inventory.stock_history', 'inventory.adjust_stock,inventory.wastage', NULL, NULL),
            ('expense_categories', 'expenses.view', 'expenses.create', 'expenses.update', 'expenses.delete'),
            ('expenses', 'expenses.view', 'expenses.create', 'expenses.update,expenses.delete', 'expenses.delete'),
            ('suppliers', 'suppliers.view', 'suppliers.create', 'suppliers.update,suppliers.delete', 'suppliers.delete'),
            ('purchases', 'purchases.view', 'purchases.create', 'purchases.update,purchases.cancel,purchases.approve', 'purchases.cancel'),
            ('mpesa_transactions', 'payments.view,payments.mpesa', NULL, NULL, NULL),
            ('payments', 'payments.view,payments.cash,payments.mpesa', 'payments.cash,payments.mpesa,payments.verify', 'payments.verify,payments.manage', 'payments.manage'),
            ('money_assets', 'payments.view', NULL, NULL, NULL),
            ('payment_asset_ledger', 'payments.view', NULL, NULL, NULL),
            ('integration_configurations', 'settings.integrations', 'settings.integrations', 'settings.integrations', 'settings.integrations'),
            ('recipes', 'bom.view', 'bom.create', 'bom.update', 'bom.delete'),
            ('bill_of_materials', 'bom.view', 'bom.create', 'bom.update', 'bom.delete'),
            ('production_batches', 'production.view', 'production.create', 'production.update,production.approve', 'production.delete'),
            ('business_assets', 'assets.view', 'assets.manage', 'assets.manage', 'assets.manage'),
            ('storage_files', 'files.view,products.view', 'files.manage,products.create,products.update,products.manage_images', 'files.manage', 'files.manage'),
            ('ai_insights', 'ai.insights', 'ai.insights', 'ai.manage', 'ai.manage'),
            ('scheduled_reports', 'reports.view', 'reports.manage', 'reports.manage', 'reports.manage'),
            ('dashboard_analytics_snapshots', 'reports.view,home.view', NULL, NULL, NULL),
            ('complaints', 'complaints.view', 'complaints.view', 'complaints.reply', 'complaints.reply'),
            ('audit_logs', 'audit.view', 'business.view', NULL, NULL),
            ('report_tracked_items', 'reports.view,home.view', 'reports.view,home.view', NULL, 'reports.view,home.view'),
            ('loyalty_redemptions', 'customers.view,customers.loyalty', NULL, NULL, NULL)
        ) AS rules(tbl, can_select, can_insert, can_update, can_delete)
    LOOP
        FOR v_policy IN SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = v_rule.tbl LOOP
            EXECUTE format('DROP POLICY %I ON public.%I', v_policy.policyname, v_rule.tbl);
        END LOOP;

        EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', v_rule.tbl);
        EXECUTE format('REVOKE ALL ON public.%I FROM anon, authenticated', v_rule.tbl);

        EXECUTE format('GRANT SELECT ON public.%I TO authenticated', v_rule.tbl);
        EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT USING (public.has_permission(business_id, VARIADIC %L::TEXT[]))',
                       'pol_' || v_rule.tbl || '_select', v_rule.tbl, '{' || v_rule.can_select || '}');

        IF v_rule.can_insert IS NOT NULL THEN
            EXECUTE format('GRANT INSERT ON public.%I TO authenticated', v_rule.tbl);
            EXECUTE format('CREATE POLICY %I ON public.%I FOR INSERT WITH CHECK (public.has_permission(business_id, VARIADIC %L::TEXT[]))',
                           'pol_' || v_rule.tbl || '_insert', v_rule.tbl, '{' || v_rule.can_insert || '}');
        END IF;
        IF v_rule.can_update IS NOT NULL THEN
            EXECUTE format('GRANT UPDATE ON public.%I TO authenticated', v_rule.tbl);
            EXECUTE format('CREATE POLICY %I ON public.%I FOR UPDATE USING (public.has_permission(business_id, VARIADIC %L::TEXT[])) WITH CHECK (public.has_permission(business_id, VARIADIC %L::TEXT[]))',
                           'pol_' || v_rule.tbl || '_update', v_rule.tbl, '{' || v_rule.can_update || '}', '{' || v_rule.can_update || '}');
        END IF;
        IF v_rule.can_delete IS NOT NULL THEN
            EXECUTE format('GRANT DELETE ON public.%I TO authenticated', v_rule.tbl);
            EXECUTE format('CREATE POLICY %I ON public.%I FOR DELETE USING (public.has_permission(business_id, VARIADIC %L::TEXT[]))',
                           'pol_' || v_rule.tbl || '_delete', v_rule.tbl, '{' || v_rule.can_delete || '}');
        END IF;
    END LOOP;
END;
$migration$;

-- ---------------------------------------------------------------------------
-- Tables whose rules also depend on the row.
-- ---------------------------------------------------------------------------
-- Sales: Cashiers see their own sales and sales on a customer's account, because they
-- handle debts. Whole-business history needs reports.sales or orders.manage.
DROP POLICY IF EXISTS pol_transactions_all ON public.transactions;
REVOKE ALL ON public.transactions, public.transaction_items FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.transactions, public.transaction_items TO authenticated;
CREATE POLICY pol_transactions_select ON public.transactions FOR SELECT USING (
    public.has_permission(business_id, 'reports.sales', 'orders.manage')
    OR (public.has_permission(business_id, 'orders.view', 'pos.create_sale')
        AND (public.is_my_employee(staff_id) OR customer_id IS NOT NULL))
);
CREATE POLICY pol_transactions_insert ON public.transactions FOR INSERT
    WITH CHECK (public.has_permission(business_id, 'pos.create_sale'));
CREATE POLICY pol_transactions_update ON public.transactions FOR UPDATE
    USING (public.has_permission(business_id, 'orders.update'))
    WITH CHECK (public.has_permission(business_id, 'orders.update'));
CREATE POLICY pol_transactions_delete ON public.transactions FOR DELETE
    USING (public.has_permission(business_id, 'orders.cancel'));

DO $migration$
DECLARE
    v_policy RECORD;
BEGIN
    FOR v_policy IN
        SELECT tablename, policyname FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename IN ('transaction_items', 'shifts', 'schedules', 'purchase_items', 'recipe_ingredients',
                            'bom_ingredients', 'complaint_replies', 'online_orders', 'online_order_items',
                            'customer_accounts', 'customer_order_schedules', 'customer_messages')
    LOOP
        EXECUTE format('DROP POLICY %I ON public.%I', v_policy.policyname, v_policy.tablename);
    END LOOP;
END;
$migration$;

CREATE POLICY pol_transaction_items_select ON public.transaction_items FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.transactions t WHERE t.id = transaction_id)
);
CREATE POLICY pol_transaction_items_insert ON public.transaction_items FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM public.transactions t
            WHERE t.id = transaction_id AND public.has_permission(t.business_id, 'pos.create_sale'))
);
CREATE POLICY pol_transaction_items_update ON public.transaction_items FOR UPDATE USING (
    EXISTS (SELECT 1 FROM public.transactions t
            WHERE t.id = transaction_id AND public.has_permission(t.business_id, 'orders.update'))
);
CREATE POLICY pol_transaction_items_delete ON public.transaction_items FOR DELETE USING (
    EXISTS (SELECT 1 FROM public.transactions t
            WHERE t.id = transaction_id AND public.has_permission(t.business_id, 'orders.cancel'))
);

-- Everyone clocks in and sees their own shifts and schedule. Others' need staff permissions.
REVOKE ALL ON public.shifts, public.schedules FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.shifts, public.schedules TO authenticated;
CREATE POLICY pol_shifts_select ON public.shifts FOR SELECT USING (
    public.is_my_employee(employee_id) OR public.has_permission(business_id, 'staff.view', 'staff.schedule')
);
CREATE POLICY pol_shifts_insert ON public.shifts FOR INSERT WITH CHECK (
    public.is_my_employee(employee_id) OR public.has_permission(business_id, 'staff.update')
);
CREATE POLICY pol_shifts_update ON public.shifts FOR UPDATE USING (
    public.is_my_employee(employee_id) OR public.has_permission(business_id, 'staff.update')
);
CREATE POLICY pol_shifts_delete ON public.shifts FOR DELETE USING (
    public.has_permission(business_id, 'staff.update')
);
CREATE POLICY pol_schedules_select ON public.schedules FOR SELECT USING (
    public.is_my_employee(employee_id) OR public.has_permission(business_id, 'staff.view', 'staff.schedule')
);
CREATE POLICY pol_schedules_write ON public.schedules FOR ALL
    USING (public.has_permission(business_id, 'staff.schedule', 'staff.update'))
    WITH CHECK (public.has_permission(business_id, 'staff.schedule', 'staff.update'));

-- Child rows follow their parent.
REVOKE ALL ON public.purchase_items, public.recipe_ingredients, public.bom_ingredients, public.complaint_replies FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.purchase_items, public.recipe_ingredients, public.bom_ingredients, public.complaint_replies TO authenticated;
CREATE POLICY pol_purchase_items_select ON public.purchase_items FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.purchases p WHERE p.id = purchase_id)
);
CREATE POLICY pol_purchase_items_write ON public.purchase_items FOR ALL USING (
    EXISTS (SELECT 1 FROM public.purchases p
            WHERE p.id = purchase_id AND public.has_permission(p.business_id, 'purchases.create', 'purchases.update'))
);
CREATE POLICY pol_recipe_ingredients_select ON public.recipe_ingredients FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.recipes r WHERE r.id = recipe_id)
);
CREATE POLICY pol_recipe_ingredients_write ON public.recipe_ingredients FOR ALL USING (
    EXISTS (SELECT 1 FROM public.recipes r
            WHERE r.id = recipe_id AND public.has_permission(r.business_id, 'bom.create', 'bom.update'))
);
CREATE POLICY pol_bom_ingredients_select ON public.bom_ingredients FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.bill_of_materials b WHERE b.id = bom_id)
);
CREATE POLICY pol_bom_ingredients_write ON public.bom_ingredients FOR ALL USING (
    EXISTS (SELECT 1 FROM public.bill_of_materials b
            WHERE b.id = bom_id AND public.has_permission(b.business_id, 'bom.create', 'bom.update'))
);
CREATE POLICY pol_complaint_replies_select ON public.complaint_replies FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.complaints c WHERE c.id = complaint_id)
);
CREATE POLICY pol_complaint_replies_write ON public.complaint_replies FOR ALL USING (
    EXISTS (SELECT 1 FROM public.complaints c
            WHERE c.id = complaint_id AND public.has_permission(c.business_id, 'complaints.reply'))
);

-- Website data: customers see their own; staff need the Online Store permission.
CREATE POLICY pol_customer_accounts_select ON public.customer_accounts FOR SELECT
    USING (id = auth.uid() OR public.has_permission(business_id, 'online_store.view'));
CREATE POLICY pol_order_schedules_select ON public.customer_order_schedules FOR SELECT
    USING (account_id = auth.uid() OR public.has_permission(business_id, 'online_store.view'));
CREATE POLICY pol_online_orders_select ON public.online_orders FOR SELECT
    USING (account_id = auth.uid() OR public.has_permission(business_id, 'online_store.view'));
CREATE POLICY pol_online_order_items_select ON public.online_order_items FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.online_orders o WHERE o.id = order_id)
);
CREATE POLICY pol_customer_messages_select ON public.customer_messages FOR SELECT
    USING (account_id = auth.uid() OR public.has_permission(business_id, 'online_store.view'));

-- ---------------------------------------------------------------------------
-- Money and points on a customer can only change through a checked route. Functions
-- run as their owner, so this only stops direct writes from a client.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_guard_customer_balances()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
    IF current_user NOT IN ('anon', 'authenticated') THEN
        RETURN NEW;
    END IF;

    IF TG_OP = 'INSERT' THEN
        IF NOT public.has_permission(NEW.business_id, 'loyalty.adjust') THEN
            NEW.loyalty_points := 0;
            NEW.tier := 'Bronze';
        END IF;
        IF NOT public.has_permission(NEW.business_id, 'customers.manage') THEN
            NEW.wallet_balance := 0;
            NEW.debt_balance := 0;
        END IF;
        RETURN NEW;
    END IF;

    IF (NEW.loyalty_points, NEW.tier) IS DISTINCT FROM (OLD.loyalty_points, OLD.tier)
       AND NOT public.has_permission(NEW.business_id, 'loyalty.adjust') THEN
        RAISE EXCEPTION 'Your role does not allow changing points or tiers.' USING ERRCODE = '42501';
    END IF;
    IF (NEW.wallet_balance, NEW.debt_balance) IS DISTINCT FROM (OLD.wallet_balance, OLD.debt_balance)
       AND NOT public.has_permission(NEW.business_id, 'customers.manage') THEN
        RAISE EXCEPTION 'Your role does not allow changing balances.' USING ERRCODE = '42501';
    END IF;
    IF (NEW.name, NEW.phone, NEW.email, NEW.description, NEW.customer_type, NEW.payment_terms, NEW.delivery_frequency)
       IS DISTINCT FROM (OLD.name, OLD.phone, OLD.email, OLD.description, OLD.customer_type, OLD.payment_terms, OLD.delivery_frequency)
       AND NOT public.has_permission(NEW.business_id, 'customers.update') THEN
        RAISE EXCEPTION 'Your role does not allow changing customer details.' USING ERRCODE = '42501';
    END IF;
    IF NEW.deleted_at IS DISTINCT FROM OLD.deleted_at
       AND NOT public.has_permission(NEW.business_id, 'customers.delete') THEN
        RAISE EXCEPTION 'Your role does not allow removing customers.' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_customer_balances ON public.customers;
CREATE TRIGGER trg_guard_customer_balances
BEFORE INSERT OR UPDATE ON public.customers
FOR EACH ROW EXECUTE FUNCTION public.fn_guard_customer_balances();

-- ---------------------------------------------------------------------------
-- Functions: 20261105002 made them check membership; this adds the role check.
-- ---------------------------------------------------------------------------
DO $migration$
DECLARE
    v_target RECORD;
    v_def    TEXT;
BEGIN
    FOR v_target IN
        SELECT p.oid, l.lanname, g.guard
        FROM (VALUES
            ('get_business_dashboard_metrics', 'public.assert_permission(p_business_id, ''home.view'', ''reports.view'')'),
            ('get_business_payments', 'public.assert_permission(p_business_id, ''payments.view'')'),
            ('get_money_assets', 'public.assert_permission(p_business_id, ''payments.view'')'),
            ('update_product_category_bulk', 'public.assert_permission(p_business_id, ''products.update'')'),
            ('fn_create_production_batch', 'public.assert_permission(p_business_id, ''production.create'')'),
            ('process_business_payment', 'public.assert_permission(p_business_id, ''payments.cash'', ''payments.mpesa'', ''payments.verify'')'),
            ('process_customer_transaction', 'public.assert_permission(p_business_id, ''pos.create_sale'')'),
            ('process_debt_payment', 'public.assert_permission(p_business_id, ''customers.debts'', ''payments.cash'')'),
            ('process_wallet_spend', 'public.assert_permission(p_business_id, ''pos.create_sale'', ''customers.debts'')'),
            ('process_wallet_topup', 'public.assert_permission(p_business_id, ''customers.debts'')'),
            ('settle_customer_debt_fifo', 'public.assert_permission(p_business_id, ''customers.debts'')'),
            ('adjust_stock_manually', 'public.assert_permission((SELECT business_id FROM public.products WHERE id = p_product_id), ''inventory.adjust_stock'')'),
            ('fn_cancel_production_batch', 'public.assert_permission((SELECT business_id FROM public.production_batches WHERE id = p_batch_id), ''production.update'')'),
            ('fn_complete_production_batch', 'public.assert_permission((SELECT business_id FROM public.production_batches WHERE id = p_batch_id), ''production.update'')'),
            ('redeem_customer_points', 'public.assert_permission((SELECT business_id FROM public.customers WHERE id = p_customer_id), ''customers.loyalty'')'),
            ('staff_update_online_order', 'public.assert_permission((SELECT business_id FROM public.online_orders WHERE id = p_order_id), ''online_store.view'')'),
            ('staff_clear_order_attention', 'public.assert_permission((SELECT business_id FROM public.online_orders WHERE id = p_order_id), ''online_store.view'')'),
            ('staff_send_customer_message', 'public.assert_permission((SELECT business_id FROM public.customer_accounts WHERE id = p_account_id), ''online_store.view'')'),
            ('staff_mark_customer_messages_read', 'public.assert_permission((SELECT business_id FROM public.customer_accounts WHERE id = p_account_id), ''online_store.view'')')
        ) AS g(name, guard)
        JOIN pg_proc p ON p.proname = g.name
        JOIN pg_namespace n ON n.oid = p.pronamespace AND n.nspname = 'public'
        JOIN pg_language l ON l.oid = p.prolang
    LOOP
        v_def := pg_get_functiondef(v_target.oid);
        IF v_target.lanname = 'plpgsql' THEN
            EXECUTE regexp_replace(v_def, '\mBEGIN\M', 'BEGIN' || E'\n    PERFORM ' || v_target.guard || ';', 'i');
        ELSE
            EXECUTE regexp_replace(v_def, 'AS \$function\$', 'AS $function$' || E'\n    SELECT ' || v_target.guard || ';');
        END IF;
    END LOOP;
END;
$migration$;

-- adjust_stock_bulk takes its products from a JSON list, so it checks each one's business.
DO $migration$
DECLARE
    v_fn RECORD;
BEGIN
    FOR v_fn IN
        SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.proname = 'adjust_stock_bulk'
    LOOP
        EXECUTE regexp_replace(pg_get_functiondef(v_fn.oid), '\mBEGIN\M',
            'BEGIN' || E'\n    PERFORM public.assert_permission(pr.business_id, ''inventory.adjust_stock'') FROM public.products pr WHERE pr.id IN (SELECT (e->>''product_id'')::UUID FROM jsonb_array_elements(p_adjustments) e);', 'i');
    END LOOP;
END;
$migration$;

-- ---------------------------------------------------------------------------
-- Access for a project created after Supabase stopped granting new tables by default.
-- ---------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON
    public.businesses, public.branches, public.users, public.business_memberships, public.invitations,
    public.role_permissions, public.employees, public.notifications, public.notification_preferences,
    public.device_fcm_tokens, public.receipt_settings, public.receipt_verifications, public.printer_settings,
    public.sms_settings, public.ai_settings, public.google_sheets_backup, public.backup_history_logs,
    public.offline_sync_queue
TO authenticated;
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
