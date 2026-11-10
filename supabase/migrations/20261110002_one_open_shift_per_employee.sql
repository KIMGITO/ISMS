-- =============================================================================
-- 20261110002_one_open_shift_per_employee.sql
-- Why:
--   Clocking in only checked the device's own copy, so two phones or two sessions
--   could each open a shift for the same person, and a clock-out on one left the
--   other open. The app now treats the database as the truth; this makes the
--   database refuse a second open shift (the app joins the existing one instead).
-- Dependencies: 20260715007 (shifts)
-- =============================================================================

BEGIN;

-- Close extra open shifts, keeping the newest open one per employee.
-- They end when the next one started, so the hours are not counted twice.
WITH ranked AS (
    SELECT id, start_time,
           ROW_NUMBER() OVER (PARTITION BY employee_id ORDER BY start_time DESC, created_at DESC) AS rn,
           LAG(start_time) OVER (PARTITION BY employee_id ORDER BY start_time DESC, created_at DESC) AS next_start
    FROM public.shifts
    WHERE status = 'Active' AND end_time IS NULL AND deleted_at IS NULL
)
UPDATE public.shifts s
SET status = 'Closed',
    end_time = GREATEST(r.start_time, COALESCE(r.next_start, NOW())),
    updated_at = NOW()
FROM ranked r
WHERE s.id = r.id AND r.rn > 1;

-- A shift marked Closed always has an end time, and an ended shift is Closed.
UPDATE public.shifts SET end_time = COALESCE(updated_at, NOW())
WHERE status = 'Closed' AND end_time IS NULL;
UPDATE public.shifts SET status = 'Closed'
WHERE status = 'Active' AND end_time IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_shifts_one_open_per_employee
    ON public.shifts (employee_id)
    WHERE status = 'Active' AND end_time IS NULL AND deleted_at IS NULL;

COMMIT;
