-- ============================================================
-- Migration: Create schedules table for planned shift scheduling
-- ============================================================
-- This is SEPARATE from the `shifts` table which tracks live
-- punch-in/punch-out sessions. The `schedules` table stores
-- planned future shifts with title, notes, repeat, color etc.
-- ============================================================

-- Repeat type enum
DO $$ BEGIN
  CREATE TYPE schedule_repeat AS ENUM ('None', 'Daily', 'Weekly');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============================================================
-- TABLE: schedules
-- ============================================================
CREATE TABLE IF NOT EXISTS public.schedules (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id     UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    employee_id     UUID NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
    title           TEXT NOT NULL DEFAULT '',
    notes           TEXT,
    date            DATE NOT NULL,               -- The calendar date of the schedule
    start_time      TIME NOT NULL,               -- e.g. '09:00'
    end_time        TIME,                        -- e.g. '17:00'
    repeat          schedule_repeat NOT NULL DEFAULT 'None',
    color           TEXT NOT NULL DEFAULT '#f59e0b',
    reminder_sent   BOOLEAN NOT NULL DEFAULT FALSE,
    created_by      UUID REFERENCES public.employees(id),
    deleted_at      TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_schedules_business_id  ON public.schedules(business_id);
CREATE INDEX IF NOT EXISTS idx_schedules_employee_id  ON public.schedules(employee_id);
CREATE INDEX IF NOT EXISTS idx_schedules_date         ON public.schedules(date);
CREATE INDEX IF NOT EXISTS idx_schedules_deleted_at   ON public.schedules(deleted_at);

-- Auto-update updated_at on row change
CREATE OR REPLACE FUNCTION public.update_schedules_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_schedules_updated_at ON public.schedules;
CREATE TRIGGER trg_schedules_updated_at
  BEFORE UPDATE ON public.schedules
  FOR EACH ROW EXECUTE FUNCTION public.update_schedules_updated_at();

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================
ALTER TABLE public.schedules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pol_schedules_all ON public.schedules;
CREATE POLICY pol_schedules_all ON public.schedules
  FOR ALL
  USING (business_id = ANY(public.get_user_business_ids()));

-- ============================================================
-- REAL-TIME: Add schedules to Supabase publication
-- ============================================================
-- This allows the JS client to subscribe via supabase.channel()
ALTER PUBLICATION supabase_realtime ADD TABLE public.schedules;

-- ============================================================
-- REMINDER: Function to mark schedules for today as reminders
-- Called by a pg_cron job or Supabase Edge Function cron
-- ============================================================
CREATE OR REPLACE FUNCTION public.flag_due_schedule_reminders()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  -- Mark all schedules for today (and repeating ones) that haven't been reminded
  UPDATE public.schedules
  SET reminder_sent = TRUE
  WHERE reminder_sent = FALSE
    AND deleted_at IS NULL
    AND (
      date = CURRENT_DATE
      OR (repeat = 'Daily' AND date <= CURRENT_DATE)
      OR (repeat = 'Weekly' AND date <= CURRENT_DATE AND EXTRACT(DOW FROM date) = EXTRACT(DOW FROM CURRENT_DATE))
    );
END;
$$;

-- ============================================================
-- CONVENIENCE VIEW: Non-deleted active schedules
-- ============================================================
CREATE OR REPLACE VIEW public.active_schedules AS
  SELECT * FROM public.schedules WHERE deleted_at IS NULL;
