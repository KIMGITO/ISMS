-- "Still working?" before the 15-hour auto clock-out.
--
-- At 15 hours on shift the person is asked (notification + a question on their screen).
-- "Still working" keeps the shift open and asks again 2 hours later. No answer within
-- 3 minutes: the shift is closed and marked as closed automatically, the owners get the shift
-- report and the person is told. The shift ends when the question became due (15 h after
-- clock-in, or 2 h after the last "still working"), not when the 3 minutes ran out, so time
-- nobody vouched for is not counted.
--
-- Replaces auto_clock_out_long_shifts() from 20261127001 and runs it every minute.

ALTER TABLE public.shifts
    ADD COLUMN IF NOT EXISTS still_on_asked_at timestamptz,
    ADD COLUMN IF NOT EXISTS still_on_confirmed_at timestamptz,
    ADD COLUMN IF NOT EXISTS closed_automatically boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.shifts.still_on_asked_at IS 'When "Still working?" was asked and not yet answered; cleared by confirm_still_on_shift.';
COMMENT ON COLUMN public.shifts.still_on_confirmed_at IS 'Last time the person answered "Still working"; the next question is due 2 hours later.';
COMMENT ON COLUMN public.shifts.closed_automatically IS 'The shift was closed by the database because nobody answered "Still working?".';

UPDATE public.shifts SET closed_automatically = true
 WHERE last_modified_by = 'auto-clock-out' AND NOT closed_automatically;

-- When the next "Still working?" is due for an open shift.
CREATE OR REPLACE FUNCTION public.fn_still_on_due(p_start timestamptz, p_confirmed timestamptz) RETURNS timestamptz
    LANGUAGE sql IMMUTABLE AS $$
    SELECT COALESCE(p_confirmed + interval '2 hours', p_start + interval '15 hours');
$$;

CREATE OR REPLACE FUNCTION public.confirm_still_on_shift(p_shift_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
AS $$
DECLARE
    v_s public.shifts;
BEGIN
    SELECT * INTO v_s FROM public.shifts WHERE id = p_shift_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'That shift was not found.';
    END IF;
    IF NOT (public.is_my_employee(v_s.employee_id) OR public.has_permission(v_s.business_id, 'staff.update')) THEN
        RAISE EXCEPTION 'This is not your shift.' USING ERRCODE = '42501';
    END IF;
    IF v_s.status <> 'Active' OR v_s.end_time IS NOT NULL THEN
        RAISE EXCEPTION 'This shift has already ended. Clock in again to start a new one.';
    END IF;
    UPDATE public.shifts SET still_on_asked_at = NULL, still_on_confirmed_at = now() WHERE id = p_shift_id;
END;
$$;
ALTER FUNCTION public.confirm_still_on_shift(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.confirm_still_on_shift(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.confirm_still_on_shift(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.auto_clock_out_long_shifts() RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
AS $$
DECLARE
    v_s record;
    v_end timestamptz;
    v_hours text;
    v_text text;
    v_n int := 0;
BEGIN
    -- 1. No answer within 3 minutes: close the shift.
    FOR v_s IN
        SELECT s.id, s.business_id, s.employee_id, s.start_time, s.still_on_asked_at, s.still_on_confirmed_at, e.name, e.user_id
        FROM public.shifts s
        LEFT JOIN public.employees e ON e.id = s.employee_id
        WHERE s.status = 'Active' AND s.end_time IS NULL AND s.deleted_at IS NULL
          AND s.still_on_asked_at <= now() - interval '3 minutes'
        ORDER BY s.start_time
        FOR UPDATE OF s SKIP LOCKED
    LOOP
        v_end := LEAST(v_s.still_on_asked_at, public.fn_still_on_due(v_s.start_time, v_s.still_on_confirmed_at));
        v_end := GREATEST(v_end, v_s.start_time);

        -- Same guard as a normal clock-out: only a still-open shift is closed.
        UPDATE public.shifts
           SET status = 'Closed', end_time = v_end, closed_automatically = true,
               still_on_asked_at = NULL, last_modified_by = 'auto-clock-out'
         WHERE id = v_s.id AND status = 'Active' AND end_time IS NULL;
        IF NOT FOUND THEN CONTINUE; END IF;
        UPDATE public.employees SET active_shift_id = NULL WHERE id = v_s.employee_id AND active_shift_id = v_s.id;

        v_hours := floor(extract(epoch FROM (v_end - v_s.start_time)) / 3600)::int || 'h '
                || (floor(extract(epoch FROM (v_end - v_s.start_time)) / 60)::int % 60) || 'm';
        v_text := public.fn_shift_report_text(v_s.id, v_end,
            '_Clocked out automatically: ' || COALESCE(v_s.name, 'Staff') || ' did not answer "Still working?" within 3 minutes._');

        INSERT INTO public.notifications (business_id, role, title, message, type, priority, payload, created_by)
        VALUES (v_s.business_id, 'Owner',
                'Shift ended: ' || COALESCE(v_s.name, 'Staff') || ' (automatic)',
                COALESCE(v_s.name, 'Staff') || ' did not answer "Still working?", so the shift was closed automatically after ' || v_hours || '.',
                'Custom Notification', 'high',
                jsonb_build_object('reportText', v_text, 'employeeName', COALESCE(v_s.name, 'Staff'),
                                   'employeeId', v_s.employee_id, 'closedAt', v_end, 'autoClockOut', true),
                'system');

        IF v_s.user_id IS NOT NULL THEN
            INSERT INTO public.notifications (business_id, user_id, title, message, type, priority, payload, created_by)
            VALUES (v_s.business_id, v_s.user_id, 'You were clocked out automatically',
                    'Nobody answered "Still working?", so your shift was closed at '
                        || lower(to_char(v_end AT TIME ZONE 'Africa/Nairobi', 'FMHH12:MI am')) || ' (' || v_hours || '). Your report went to the owners.',
                    'Custom Notification', 'high',
                    jsonb_build_object('reportText', v_text, 'employeeName', COALESCE(v_s.name, 'Staff'), 'autoClockOut', true, 'shiftId', v_s.id),
                    'system');
        END IF;
        v_n := v_n + 1;
    END LOOP;

    -- 2. Due: ask "Still working?".
    FOR v_s IN
        SELECT s.id, s.business_id, s.start_time, e.name, e.user_id
        FROM public.shifts s
        LEFT JOIN public.employees e ON e.id = s.employee_id
        WHERE s.status = 'Active' AND s.end_time IS NULL AND s.deleted_at IS NULL
          AND s.still_on_asked_at IS NULL
          AND public.fn_still_on_due(s.start_time, s.still_on_confirmed_at) <= now()
        FOR UPDATE OF s SKIP LOCKED
    LOOP
        UPDATE public.shifts SET still_on_asked_at = now() WHERE id = v_s.id AND still_on_asked_at IS NULL;
        IF v_s.user_id IS NOT NULL THEN
            v_hours := floor(extract(epoch FROM (now() - v_s.start_time)) / 3600)::int || ' hours';
            INSERT INTO public.notifications (business_id, user_id, title, message, type, priority, payload, created_by)
            VALUES (v_s.business_id, v_s.user_id, 'Still working?',
                    'You have been clocked in for ' || v_hours || '. Open the app and tap "Still working" within 3 minutes, or you will be clocked out.',
                    'Custom Notification', 'critical',
                    jsonb_build_object('stillOnShift', true, 'shiftId', v_s.id),
                    'system');
        END IF;
    END LOOP;
    RETURN v_n;
END;
$$;

REVOKE ALL ON FUNCTION public.auto_clock_out_long_shifts() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.auto_clock_out_long_shifts() TO service_role;

-- Every minute, so the 3 minutes really are about 3 (scheduling the same name replaces the job).
DO $do$ BEGIN
    IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
        PERFORM cron.schedule('auto-clock-out', '* * * * *', $job$SELECT public.auto_clock_out_long_shifts()$job$);
    END IF;
END $do$;
