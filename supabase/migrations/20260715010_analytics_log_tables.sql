-- =============================================================================
-- 20260715_010_analytics_log_tables.sql
-- KayKay's Milk Business Management System
-- Analytics & Log Tables: backup_history_logs, scheduled_reports,
--   dashboard_analytics_snapshots, complaints, complaint_replies,
--   audit_logs, offline_sync_queue
-- =============================================================================
-- Why: These tables capture operational metadata — backup run history,
-- automated report schedules, daily analytics snapshots, customer feedback,
-- security audit trails, and the offline sync queue for the PWA/mobile app.
-- audit_logs is append-only by policy (no UPDATE/DELETE in migration 014).
-- offline_sync_queue buffers operations that failed to sync while offline.
-- Dependencies: 001, 002, 003, 004, 005, 006, 007, 008, 009
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- TABLE: backup_history_logs
-- Each time a Google Sheets backup runs (scheduled or manual), a record is
-- inserted here. The backup edge function writes to this table.
-- type distinguishes manual vs. auto backups.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.backup_history_logs (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    timestamp   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    type        TEXT NOT NULL DEFAULT 'auto' CHECK (type IN ('manual', 'auto')),
    status      public.backup_status NOT NULL DEFAULT 'running',
    error       TEXT,
    retries     INTEGER NOT NULL DEFAULT 0 CHECK (retries >= 0),
    details     JSONB NOT NULL DEFAULT '{}',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    -- No updated_at: log records are immutable
);

ALTER TABLE public.backup_history_logs ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- TABLE: scheduled_reports
-- Configurations for automated email/report schedules (daily P&L summary,
-- weekly inventory report etc.). The send-email edge function reads this.
-- recipients is a JSONB array of email addresses.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.scheduled_reports (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    frequency   public.report_schedule_frequency NOT NULL DEFAULT 'daily',
    recipients  JSONB NOT NULL DEFAULT '[]',
    report_type TEXT NOT NULL DEFAULT 'full',
    format      TEXT NOT NULL DEFAULT 'email',
    last_run_at TIMESTAMPTZ,
    next_run_at TIMESTAMPTZ,
    enabled     BOOLEAN NOT NULL DEFAULT TRUE,
    created_by  UUID REFERENCES public.users(id) ON DELETE SET NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.scheduled_reports ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- TABLE: dashboard_analytics_snapshots
-- Pre-computed daily/weekly/monthly analytics summaries. The RPC function
-- refresh_dashboard_snapshot() populates this table. net_profit is a
-- generated column (total_sales - total_expenses) to ensure consistency.
-- UNIQUE(business_id, snapshot_date, timeframe) prevents duplicate snapshots.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.dashboard_analytics_snapshots (
    id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id       UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    snapshot_date     DATE NOT NULL,
    timeframe         TEXT NOT NULL DEFAULT 'daily'
                          CHECK (timeframe IN ('daily', 'weekly', 'monthly')),
    total_sales       NUMERIC(14,2) NOT NULL DEFAULT 0.00,
    total_expenses    NUMERIC(14,2) NOT NULL DEFAULT 0.00,
    net_profit        NUMERIC(14,2) GENERATED ALWAYS AS (total_sales - total_expenses) STORED,
    order_count       INTEGER NOT NULL DEFAULT 0 CHECK (order_count >= 0),
    avg_order_value   NUMERIC(14,2) NOT NULL DEFAULT 0.00,
    top_product_id    UUID REFERENCES public.products(id) ON DELETE SET NULL,
    top_category      TEXT,
    payment_breakdown JSONB NOT NULL DEFAULT '{}',
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (business_id, snapshot_date, timeframe)
);

ALTER TABLE public.dashboard_analytics_snapshots ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- TABLE: complaints
-- Customer feedback and complaints submitted via the CustomerFeedbackView
-- or the public complaints edge function. Soft-deleted via deleted_at.
-- sentiment is auto-classified (positive/neutral/negative).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.complaints (
    id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id      UUID REFERENCES public.businesses(id) ON DELETE CASCADE,
    customer_name    TEXT NOT NULL,
    rating           INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
    comment          TEXT NOT NULL,
    timestamp        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    resolved         BOOLEAN NOT NULL DEFAULT FALSE,
    sentiment        public.sentiment NOT NULL DEFAULT 'neutral',
    branch           TEXT,
    version          INTEGER NOT NULL DEFAULT 1,
    sync_status      public.sync_status NOT NULL DEFAULT 'synced',
    last_modified_by TEXT NOT NULL DEFAULT 'system',
    deleted_at       TIMESTAMPTZ,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.complaints ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- TABLE: complaint_replies
-- Staff responses to complaints. Threaded reply model under a complaint.
-- author is the staff name; role is their position at reply time.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.complaint_replies (
    id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    complaint_id UUID NOT NULL REFERENCES public.complaints(id) ON DELETE CASCADE,
    author       TEXT NOT NULL,
    role         TEXT NOT NULL,
    message      TEXT NOT NULL,
    timestamp    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
    -- No updated_at or deleted_at: replies are append-only
);

ALTER TABLE public.complaint_replies ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- TABLE: audit_logs
-- Security audit trail for all sensitive operations (transaction creation,
-- PIN changes, role changes, stock adjustments). Append-only — no UPDATE or
-- DELETE policies are granted in migration 014.
-- employee_id and user_id are nullable to support system-level operations.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.audit_logs (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID REFERENCES public.businesses(id) ON DELETE SET NULL,
    employee_id UUID REFERENCES public.employees(id) ON DELETE SET NULL,
    user_id     UUID REFERENCES public.users(id) ON DELETE SET NULL,
    action      TEXT NOT NULL,
    table_name  TEXT,
    record_id   TEXT,
    details     JSONB NOT NULL DEFAULT '{}',
    ip_address  TEXT,
    user_agent  TEXT,
    timestamp   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    -- No updated_at: audit logs are immutable
);

ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- TABLE: offline_sync_queue
-- Buffers operations (INSERT/UPDATE/DELETE) that the PWA/mobile client
-- could not immediately sync to the server (offline mode). The sync edge
-- function processes and clears entries from this queue.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.offline_sync_queue (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id     UUID REFERENCES public.businesses(id) ON DELETE CASCADE,
    device_id       TEXT,
    table_name      TEXT NOT NULL,
    record_id       TEXT NOT NULL,
    operation       TEXT NOT NULL CHECK (operation IN ('INSERT', 'UPDATE', 'DELETE')),
    payload         JSONB NOT NULL DEFAULT '{}',
    attempts        INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    max_attempts    INTEGER NOT NULL DEFAULT 5 CHECK (max_attempts > 0),
    last_attempt_at TIMESTAMPTZ,
    synced_at       TIMESTAMPTZ,
    error           TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    -- No updated_at: queue entries are managed by the sync engine
);

ALTER TABLE public.offline_sync_queue ENABLE ROW LEVEL SECURITY;

COMMIT;
