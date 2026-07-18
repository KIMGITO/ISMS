-- =============================================================================
-- 20260715_015_views_realtime.sql
-- KayKay's Milk Business Management System
-- Database Views & Realtime Publications
-- =============================================================================
-- Why: This is the final migration and completes the schema.
--
-- VIEWS: Pre-joined, read-optimized projections used by the app's reporting
-- and dashboard screens. Views execute as SECURITY INVOKER — RLS still applies.
--
-- REALTIME: Supabase uses PostgreSQL's logical replication publication named
-- "supabase_realtime" to broadcast row-level change events to subscribed
-- clients. Every table that the React app subscribes to via
-- supabase.channel().on('postgres_changes', ...) MUST be added to this
-- publication, otherwise the client never receives change events.
--
-- Tables currently subscribed by the app (realtimeService.ts):
--   products, transactions, customers, notifications,
--   integration_configurations, businesses
-- Additional tables subscribed by individual stores:
--   transactions (transactionStore.ts)
--   customers    (customerStore.ts)
--   products, inventory_adjustments (inventoryStore.ts)
--   schedules    (DashboardView.tsx)
--   employees, business_memberships, role_permissions (authStore.ts)
--   shifts       (shift management)
--   notifications (notificationRepository.ts)
--
-- ALL tables that could receive live UI updates are included so you never
-- need to edit this migration again when adding a new subscription.
--
-- Dependencies: 001–014 (all tables, functions, triggers, policies)
-- =============================================================================

-- ---------------------------------------------------------------------------
-- SECTION 1: VIEWS
-- ---------------------------------------------------------------------------

-- ---
-- VIEW: v_active_customers
-- Returns non-deleted customers with their business name.
-- Used by CustomerReport and the Customers search screen.
-- ---
CREATE OR REPLACE VIEW public.v_active_customers WITH (security_invoker = true) AS
SELECT
    c.id,
    c.business_id,
    b.name AS business_name,
    c.name,
    c.phone,
    c.email,
    c.loyalty_points,
    c.tier,
    c.purchases_count,
    c.debt_balance,
    c.wallet_balance,
    c.join_date,
    c.created_at,
    c.description
FROM public.customers c
JOIN public.businesses b ON c.business_id = b.id
WHERE c.deleted_at IS NULL;

-- ---
-- VIEW: v_active_products
-- Returns non-deleted products with a flag for low/out-of-stock status.
-- Used by the POS product grid and the InventoryView.
-- ---
CREATE OR REPLACE VIEW public.v_active_products WITH (security_invoker = true) AS
SELECT
    p.id,
    p.business_id,
    p.name,
    p.category,
    p.price,
    p.cost,
    p.image,
    p.stock,
    p.min_stock,
    p.unit,
    p.sku,
    p.description,
    p.perishable,
    p.expiry_days,
    CASE
        WHEN p.stock = 0         THEN 'out_of_stock'
        WHEN p.stock <= p.min_stock THEN 'low_stock'
        ELSE 'ok'
    END AS stock_status,
    p.created_at,
    p.updated_at
FROM public.products p
WHERE p.deleted_at IS NULL;

-- ---
-- VIEW: v_transaction_summary
-- Joins transactions with customer name and staff name for list views.
-- Used by SalesView, ShiftReport, and customer debt screens.
-- ---
CREATE OR REPLACE VIEW public.v_transaction_summary WITH (security_invoker = true) AS
SELECT
    t.id,
    t.business_id,
    t.final_total,
    t.discount,
    t.tax,
    t.amount_paid,
    t.wallet_applied,
    t.payment_method,
    t.customer_id,
    COALESCE(c.name, t.customer_name) AS customer_name,
    t.staff_id,
    t.staff_name,
    t.status,
    t.timestamp,
    t.note,
    t.is_delivery,
    t.delivery_fee,
    t.rider_name,
    t.created_at
FROM public.transactions t
LEFT JOIN public.customers c ON t.customer_id = c.id
WHERE t.deleted_at IS NULL;

-- ---
-- VIEW: v_open_debts
-- All unresolved credit (Open or Partial) with customer and business context.
-- Used by the Debt Management screen.
-- ---
CREATE OR REPLACE VIEW public.v_open_debts WITH (security_invoker = true) AS
SELECT
    cp.id,
    cp.business_id,
    cp.customer_id,
    cp.customer_name,
    cp.amount_owed,
    cp.amount_paid,
    cp.balance,
    cp.status,
    cp.due_date,
    cp.created_at,
    c.phone AS customer_phone,
    c.tier  AS customer_tier
FROM public.credit_payments cp
LEFT JOIN public.customers c ON cp.customer_id = c.id
WHERE cp.status IN ('Open', 'Partial');

-- ---
-- VIEW: v_active_shifts
-- All currently active shifts joined with employee name and business name.
-- Used by the ShiftView and punch-in/out controls.
-- ---
CREATE OR REPLACE VIEW public.v_active_shifts WITH (security_invoker = true) AS
SELECT
    s.id,
    s.business_id,
    b.name AS business_name,
    s.employee_id,
    e.name AS employee_name,
    e.role AS employee_role,
    s.start_time,
    s.end_time,
    s.sales_count,
    s.sales_total,
    s.status,
    s.created_at
FROM public.shifts s
JOIN public.businesses b ON s.business_id = b.id
JOIN public.employees  e ON s.employee_id = e.id
WHERE s.status = 'Active'
  AND s.deleted_at IS NULL;

-- ---
-- VIEW: v_upcoming_schedules
-- Future schedules for the next 14 days joined with employee names.
-- Used by the ScheduleView calendar.
-- ---
CREATE OR REPLACE VIEW public.v_upcoming_schedules WITH (security_invoker = true) AS
SELECT
    sc.id,
    sc.business_id,
    sc.employee_id,
    e.name   AS employee_name,
    e.role   AS employee_role,
    e.avatar AS employee_avatar,
    sc.title,
    sc.notes,
    sc.date,
    sc.start_time,
    sc.end_time,
    sc.repeat,
    sc.color,
    sc.reminder_sent,
    sc.created_at
FROM public.schedules sc
JOIN public.employees e ON sc.employee_id = e.id
WHERE sc.deleted_at IS NULL
  AND sc.date >= CURRENT_DATE
  AND sc.date <= CURRENT_DATE + INTERVAL '14 days';

-- ---
-- VIEW: v_unread_notifications
-- All unread, unarchived, non-expired notifications for the active session.
-- Used by the NotificationBell and NotificationView.
-- ---
CREATE OR REPLACE VIEW public.v_unread_notifications WITH (security_invoker = true) AS
SELECT
    n.id,
    n.business_id,
    n.user_id,
    n.role,
    n.title,
    n.message,
    n.type,
    n.priority,
    n.action_type,
    n.action_target,
    n.payload,
    n.created_at,
    n.expires_at,
    n.status
FROM public.notifications n
WHERE n.read_at IS NULL
  AND n.archived_at IS NULL
  AND n.deleted_at IS NULL
  AND (n.expires_at IS NULL OR n.expires_at > NOW());

-- ---
-- VIEW: v_team_members
-- All active staff members with their business and auth profile joined.
-- Used by the EmployeeManagementView.
-- ---
CREATE OR REPLACE VIEW public.v_team_members WITH (security_invoker = true) AS
SELECT
    bm.id           AS membership_id,
    bm.business_id,
    bm.role,
    bm.status,
    bm.joined_at,
    u.id            AS user_id,
    u.name,
    u.email,
    u.phone,
    u.avatar,
    u.is_verified,
    e.active_shift_id,
    e.tasks,
    e.assigned_branches
FROM public.business_memberships bm
JOIN public.users     u ON bm.user_id     = u.id
LEFT JOIN public.employees e ON e.user_id = u.id AND e.business_id = bm.business_id
WHERE bm.status = 'Active';

-- ---
-- VIEW: v_low_stock_products
-- Products at or below their minimum stock threshold (non-deleted only).
-- Used by the low-stock notification badge and inventory alerts.
-- ---
CREATE OR REPLACE VIEW public.v_low_stock_products WITH (security_invoker = true) AS
SELECT
    p.id,
    p.business_id,
    p.name,
    p.category,
    p.stock,
    p.min_stock,
    p.unit,
    p.price,
    CASE WHEN p.stock = 0 THEN 'out_of_stock' ELSE 'low_stock' END AS alert_level
FROM public.products p
WHERE p.deleted_at IS NULL
  AND p.stock <= p.min_stock;

-- ---
-- VIEW: v_expense_summary
-- Aggregated expense totals per category per business for the reporting period.
-- Used by the Expense Analytics screen.
-- ---
CREATE OR REPLACE VIEW public.v_expense_summary WITH (security_invoker = true) AS
SELECT
    e.business_id,
    e.category,
    DATE_TRUNC('month', e.date) AS month,
    SUM(e.amount)               AS total_amount,
    COUNT(*)                    AS count
FROM public.expenses e
WHERE e.deleted_at IS NULL
GROUP BY e.business_id, e.category, DATE_TRUNC('month', e.date);

-- ---
-- VIEW: v_daily_sales_summary
-- Daily revenue rolled up from transactions.
-- Used by the Sales Graph on the Dashboard.
-- ---
CREATE OR REPLACE VIEW public.v_daily_sales_summary WITH (security_invoker = true) AS
SELECT
    t.business_id,
    DATE_TRUNC('day', t.timestamp)::DATE AS sale_date,
    COUNT(*)                             AS order_count,
    SUM(t.final_total)                   AS total_revenue,
    SUM(t.discount)                      AS total_discount,
    SUM(CASE WHEN t.is_delivery THEN 1 ELSE 0 END) AS delivery_count
FROM public.transactions t
WHERE t.deleted_at IS NULL
GROUP BY t.business_id, DATE_TRUNC('day', t.timestamp)::DATE;

-- ---
-- VIEW: v_product_sales_rank
-- Top-selling products ranked by quantity sold (all time).
-- Used by the Top Products widget on the Dashboard.
-- ---
CREATE OR REPLACE VIEW public.v_product_sales_rank WITH (security_invoker = true) AS
SELECT
    t.business_id,
    ti.product_id,
    ti.product_name,
    SUM(ti.quantity)    AS total_qty_sold,
    SUM(ti.line_total)  AS total_revenue,
    COUNT(DISTINCT ti.transaction_id) AS order_count,
    RANK() OVER (
        PARTITION BY t.business_id
        ORDER BY SUM(ti.quantity) DESC
    ) AS rank
FROM public.transaction_items ti
JOIN public.transactions t ON ti.transaction_id = t.id
WHERE t.deleted_at IS NULL
GROUP BY t.business_id, ti.product_id, ti.product_name;

-- ---
-- VIEW: v_customer_ledger_detail
-- Customer ledger entries joined with the original transaction for context.
-- Used by the CustomerDebtView ledger table.
-- ---
CREATE OR REPLACE VIEW public.v_customer_ledger_detail WITH (security_invoker = true) AS
SELECT
    cl.id,
    cl.business_id,
    cl.customer_id,
    c.name        AS customer_name,
    cl.type,
    cl.amount,
    cl.wallet_balance,
    cl.debt_balance,
    cl.recorded_by,
    cl.note,
    cl.transaction_id,
    t.final_total AS transaction_total,
    t.payment_method,
    cl.created_at
FROM public.customer_ledger cl
JOIN public.customers c ON cl.customer_id = c.id
LEFT JOIN public.transactions t ON cl.transaction_id = t.id;

-- ---
-- VIEW: v_pending_invitations
-- All pending, non-expired invitations with business name.
-- Used by the InvitationsView management panel.
-- ---
CREATE OR REPLACE VIEW public.v_pending_invitations WITH (security_invoker = true) AS
SELECT
    i.id,
    i.business_id,
    b.name AS business_name,
    i.name,
    i.email,
    i.phone,
    i.role,
    i.expires_at,
    i.created_at,
    i.status
FROM public.invitations i
JOIN public.businesses b ON i.business_id = b.id
WHERE i.status = 'Pending'
  AND i.expires_at > NOW();

-- ---------------------------------------------------------------------------
-- SECTION 2: REALTIME PUBLICATIONS
-- ---------------------------------------------------------------------------
-- Supabase creates the "supabase_realtime" publication automatically.
-- We add each table that needs live UI updates individually with
-- ALTER PUBLICATION ... ADD TABLE. Using individual ADD TABLE statements
-- (not SET TABLE) avoids accidentally removing tables added by other means.
-- Any table NOT in this publication will NOT trigger client-side events
-- even if the client subscribes to it — it silently receives no events.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  t text;
  tables_to_add text[] := ARRAY[
    'public.businesses', 'public.branches', 'public.users',
    'public.business_memberships', 'public.invitations', 'public.role_permissions', 'public.employees',
    'public.products', 'public.customers', 'public.customer_ledger', 'public.debt_payments',
    'public.transactions', 'public.transaction_items', 'public.credit_payments', 'public.wallet_transactions',
    'public.shifts', 'public.schedules', 'public.inventory_adjustments', 'public.expense_categories', 'public.expenses', 'public.suppliers',
    'public.notifications', 'public.notification_preferences', 'public.integration_configurations', 'public.mpesa_transactions', 'public.receipt_settings', 'public.printer_settings', 'public.sms_settings', 'public.ai_settings', 'public.google_sheets_backup',
    'public.recipes', 'public.recipe_ingredients', 'public.production_batches', 'public.purchases', 'public.purchase_items', 'public.business_assets', 'public.storage_files', 'public.ai_insights', 'public.payments',
    'public.backup_history_logs', 'public.scheduled_reports', 'public.dashboard_analytics_snapshots', 'public.complaints', 'public.complaint_replies', 'public.audit_logs', 'public.offline_sync_queue',
    'public.device_fcm_tokens'
  ];
BEGIN
  -- Create publication if it doesn't exist
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    CREATE PUBLICATION supabase_realtime;
  END IF;

  FOREACH t IN ARRAY tables_to_add LOOP
    -- Check if the table exists first to avoid database errors
    IF EXISTS (
      SELECT 1 FROM pg_class c
      JOIN pg_namespace n ON c.relnamespace = n.oid
      WHERE n.nspname || '.' || c.relname = t
    ) THEN
      -- Check if table is already in the publication
      IF NOT EXISTS (
        SELECT 1 
        FROM pg_publication_rel pr
        JOIN pg_class c ON pr.prrelid = c.oid
        JOIN pg_namespace n ON c.relnamespace = n.oid
        WHERE pr.prpubid = (SELECT oid FROM pg_publication WHERE pubname = 'supabase_realtime')
          AND n.nspname || '.' || c.relname = t
      ) THEN
        BEGIN
          EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE ' || t;
        EXCEPTION
          WHEN duplicate_object THEN
            NULL;
          WHEN others THEN
            NULL;
        END;
      END IF;
    END IF;
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- SECTION 3: GRANT SELECT ON VIEWS to authenticated role
-- ---------------------------------------------------------------------------
GRANT SELECT ON public.v_active_customers           TO authenticated;
GRANT SELECT ON public.v_active_products            TO authenticated;
GRANT SELECT ON public.v_transaction_summary        TO authenticated;
GRANT SELECT ON public.v_open_debts                 TO authenticated;
GRANT SELECT ON public.v_active_shifts              TO authenticated;
GRANT SELECT ON public.v_upcoming_schedules         TO authenticated;
GRANT SELECT ON public.v_unread_notifications       TO authenticated;
GRANT SELECT ON public.v_team_members               TO authenticated;
GRANT SELECT ON public.v_low_stock_products         TO authenticated;
GRANT SELECT ON public.v_expense_summary            TO authenticated;
GRANT SELECT ON public.v_daily_sales_summary        TO authenticated;
GRANT SELECT ON public.v_product_sales_rank         TO authenticated;
GRANT SELECT ON public.v_customer_ledger_detail     TO authenticated;
GRANT SELECT ON public.v_pending_invitations        TO authenticated;

-- ---------------------------------------------------------------------------
-- SECTION 4: GRANT EXECUTE ON RPCs to authenticated and anon roles
-- ---------------------------------------------------------------------------

-- Anon-accessible RPCs (needed before a user is logged in)
GRANT EXECUTE ON FUNCTION public.check_owner_exists()                  TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_invitation_by_token(TEXT)          TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_otp(TEXT, TEXT, TEXT)            TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.verify_signup_otp(TEXT, TEXT)         TO anon, authenticated;

-- Authenticated-only RPCs
GRANT EXECUTE ON FUNCTION public.get_user_business_ids()               TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_owner_or_admin(UUID)               TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_business_with_owner(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.accept_invitation_with_token(TEXT, UUID, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.adjust_stock_manually(UUID, UUID, TEXT, public.inventory_adjustment_type, NUMERIC, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.settle_customer_debt_fifo(UUID, UUID, NUMERIC, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_dashboard_snapshot(UUID, DATE, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_business_dashboard_metrics(UUID, TIMESTAMPTZ, TIMESTAMPTZ) TO authenticated;
GRANT EXECUTE ON FUNCTION public.log_mpesa_payment(TEXT, TEXT, TEXT, NUMERIC, TEXT, TEXT, UUID, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.flag_due_schedule_reminders()         TO authenticated;
GRANT EXECUTE ON FUNCTION public.calculate_customer_tier(INTEGER)      TO authenticated;
