-- =============================================================================
-- 20261109004_schedule_reminders_ringing_alerts.sql
-- Schedule reminders that repeat, ringing alerts that need Accept, and a notice
-- to managers when nobody accepts.
-- =============================================================================
-- Why:
--  * Reminders went out once per schedule ever, because reminder_sent was never reset, so a
--    daily shift reminded on day one only. Monthly repeats were never reminded. The check ran
--    on the server's UTC date and fired at the start of the day, not before the shift.
--  * Reminders and urgent alerts should ring until someone accepts them, and managers should
--    hear about alerts nobody accepted.
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- SCHEDULES: remember the last day reminded, not just "reminded once".
-- ---------------------------------------------------------------------------
ALTER TABLE public.schedules ADD COLUMN IF NOT EXISTS last_reminded_on DATE;

-- Moving a shift's day or time means it should be reminded again.
CREATE OR REPLACE FUNCTION public.fn_schedule_reset_reminder()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.date IS DISTINCT FROM OLD.date
       OR NEW.start_time IS DISTINCT FROM OLD.start_time
       OR NEW.repeat IS DISTINCT FROM OLD.repeat
       OR NEW.employee_id IS DISTINCT FROM OLD.employee_id THEN
        NEW.last_reminded_on := NULL;
        NEW.reminder_sent := FALSE;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_schedule_reset_reminder ON public.schedules;
CREATE TRIGGER trg_schedule_reset_reminder
    BEFORE UPDATE ON public.schedules
    FOR EACH ROW EXECUTE FUNCTION public.fn_schedule_reset_reminder();

-- Reminds each person 30 minutes before a shift starts, in Nairobi time, on every day the
-- shift repeats. A shift created less than 30 minutes ahead is reminded straight away.
CREATE OR REPLACE FUNCTION public.flag_due_schedule_reminders()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_now   TIMESTAMP := (NOW() AT TIME ZONE 'Africa/Nairobi');
    v_today DATE := (NOW() AT TIME ZONE 'Africa/Nairobi')::DATE;
    v_lead  INTERVAL := INTERVAL '30 minutes';
    v_schedule RECORD;
    v_user_id UUID;
BEGIN
    FOR v_schedule IN
        SELECT s.id, s.business_id, s.employee_id, s.title, s.start_time, s.end_time
        FROM public.schedules s
        WHERE s.deleted_at IS NULL
          AND s.date <= v_today
          AND s.last_reminded_on IS DISTINCT FROM v_today
          AND CASE s.repeat
                  WHEN 'None'    THEN s.date = v_today
                  WHEN 'Daily'   THEN TRUE
                  WHEN 'Weekly'  THEN EXTRACT(DOW FROM s.date) = EXTRACT(DOW FROM v_today)
                  WHEN 'Monthly' THEN EXTRACT(DAY FROM s.date) = EXTRACT(DAY FROM v_today)
                  ELSE FALSE
              END
          AND v_today + s.start_time - v_lead <= v_now
          AND v_today + s.start_time > v_now
        FOR UPDATE SKIP LOCKED
    LOOP
        UPDATE public.schedules
        SET last_reminded_on = v_today, reminder_sent = TRUE
        WHERE id = v_schedule.id;

        SELECT e.user_id INTO v_user_id
        FROM public.employees e
        WHERE e.id = v_schedule.employee_id AND e.deleted_at IS NULL;

        IF v_user_id IS NOT NULL THEN
            INSERT INTO public.notifications
                (business_id, user_id, title, message, type, priority,
                 action_type, action_target, payload, status)
            VALUES (
                v_schedule.business_id,
                v_user_id,
                COALESCE(NULLIF(v_schedule.title, ''), 'Shift') || ' at ' || to_char(v_schedule.start_time, 'HH24:MI'),
                'Your shift starts at ' || to_char(v_schedule.start_time, 'HH24:MI')
                    || CASE WHEN v_schedule.end_time IS NOT NULL
                            THEN ' and ends at ' || to_char(v_schedule.end_time, 'HH24:MI') ELSE '' END
                    || ' today.',
                'Schedule Reminder',
                'high'::public.notification_priority,
                'navigate'::public.notification_action_type,
                'dashboard',
                jsonb_build_object(
                    'schedule_id', v_schedule.id,
                    'employee_id', v_schedule.employee_id,
                    'shift_date',  to_char(v_today, 'YYYY-MM-DD'),
                    'start_time',  to_char(v_schedule.start_time, 'HH24:MI')
                ),
                'pending'::public.notification_delivery_status
            );
        END IF;
    END LOOP;
END;
$$;

-- ---------------------------------------------------------------------------
-- NOTIFICATIONS: ringing alerts
-- ring: keeps ringing on the person's devices until someone accepts it.
-- accepted_at / accepted_by: who accepted. One accept covers everyone it went to.
-- escalated_at: when managers were told nobody accepted it.
-- ---------------------------------------------------------------------------
ALTER TABLE public.notifications
    ADD COLUMN IF NOT EXISTS ring         BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS accepted_at  TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS accepted_by  UUID REFERENCES public.users(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS escalated_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_notifications_ringing
    ON public.notifications(business_id, created_at)
    WHERE ring AND accepted_at IS NULL AND deleted_at IS NULL;

-- Which alerts ring, and the screen Accept opens. Kept in one place so every function that
-- writes notifications gets the same behaviour without being changed.
CREATE OR REPLACE FUNCTION public.fn_ringing_alert_target(p_type TEXT, p_title TEXT, p_direct BOOLEAN)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT CASE
        WHEN p_type = 'Schedule Reminder' THEN 'dashboard'
        WHEN p_type = 'Delivery Assigned' AND p_direct THEN 'deliveries'
        WHEN p_type = 'Online Store' AND p_title = 'New delivery' AND p_direct THEN 'deliveries'
        WHEN p_type = 'Online Store' AND p_title IN ('New online order', 'Online payment needs checking', 'Delivery not completed')
            THEN 'online-store'
        WHEN p_type = 'Online Store' AND p_title = 'M-Pesa till payment to assign' THEN 'money'
        ELSE NULL
    END;
$$;

CREATE OR REPLACE FUNCTION public.fn_mark_ringing_alert()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_target TEXT := public.fn_ringing_alert_target(NEW.type, NEW.title, NEW.user_id IS NOT NULL);
BEGIN
    IF v_target IS NOT NULL THEN
        NEW.ring := TRUE;
        NEW.action_type := 'navigate'::public.notification_action_type;
        IF NEW.action_target IS NULL OR NEW.action_target IN ('none', '', 'schedules') THEN
            NEW.action_target := v_target;
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_mark_ringing_alert ON public.notifications;
CREATE TRIGGER trg_mark_ringing_alert
    BEFORE INSERT ON public.notifications
    FOR EACH ROW EXECUTE FUNCTION public.fn_mark_ringing_alert();

-- Whether a person is one of the people an alert went to.
CREATE OR REPLACE FUNCTION public.fn_is_alert_recipient(p_notification public.notifications, p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT p_user_id = ANY(public.fn_notification_recipients(
        p_notification.business_id, p_notification.user_id, p_notification.role, p_notification.type));
$$;

-- Alerts still ringing for the caller. Older than 12 hours stops ringing; it stays in the inbox.
CREATE OR REPLACE FUNCTION public.get_my_ringing_alerts(p_business_id UUID)
RETURNS TABLE (id UUID, title TEXT, message TEXT, type TEXT, action_target TEXT, created_at TIMESTAMPTZ)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT n.id, n.title, n.message, n.type, n.action_target, n.created_at
    FROM public.notifications n
    WHERE n.business_id = p_business_id
      AND p_business_id = ANY(public.get_user_business_ids())
      AND n.ring AND n.accepted_at IS NULL AND n.deleted_at IS NULL
      AND n.created_at > NOW() - INTERVAL '12 hours'
      AND public.fn_is_alert_recipient(n, (SELECT u.id FROM public.users u WHERE u.auth_user_id = auth.uid()))
    ORDER BY n.created_at;
$$;

-- Accepts an alert for everyone it went to. Returns the screen to open and who already
-- accepted it, so a second person tapping Accept is told rather than shown an error.
CREATE OR REPLACE FUNCTION public.accept_alert(p_notification_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_n public.notifications%ROWTYPE;
    v_by TEXT;
    v_me UUID := (SELECT u.id FROM public.users u WHERE u.auth_user_id = auth.uid());
BEGIN
    SELECT * INTO v_n FROM public.notifications WHERE id = p_notification_id AND deleted_at IS NULL FOR UPDATE;
    IF NOT FOUND OR NOT (v_n.business_id = ANY(public.get_user_business_ids())) THEN
        RAISE EXCEPTION 'That alert was not found.';
    END IF;
    IF v_me IS NULL OR NOT public.fn_is_alert_recipient(v_n, v_me) THEN
        RAISE EXCEPTION 'That alert was not sent to you.' USING ERRCODE = '42501';
    END IF;

    IF v_n.accepted_at IS NULL THEN
        UPDATE public.notifications
        SET accepted_at = NOW(), accepted_by = v_me,
            read_at = COALESCE(read_at, NOW()), clicked_at = COALESCE(clicked_at, NOW())
        WHERE id = v_n.id;
        RETURN jsonb_build_object('accepted', TRUE, 'alreadyAcceptedBy', NULL,
                                  'actionTarget', v_n.action_target, 'businessId', v_n.business_id);
    END IF;

    SELECT name INTO v_by FROM public.users WHERE id = v_n.accepted_by;
    RETURN jsonb_build_object('accepted', FALSE,
                              'alreadyAcceptedBy', CASE WHEN v_n.accepted_by = v_me THEN 'you' ELSE COALESCE(v_by, 'someone') END,
                              'actionTarget', v_n.action_target, 'businessId', v_n.business_id);
END;
$$;

-- Tells managers about alerts nobody accepted within 15 minutes. Runs every minute.
CREATE OR REPLACE FUNCTION public.escalate_unaccepted_alerts()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_n RECORD;
    v_who TEXT;
    v_count INTEGER := 0;
BEGIN
    FOR v_n IN
        SELECT n.* FROM public.notifications n
        WHERE n.ring AND n.accepted_at IS NULL AND n.escalated_at IS NULL AND n.deleted_at IS NULL
          AND n.created_at < NOW() - INTERVAL '15 minutes'
          AND n.created_at > NOW() - INTERVAL '12 hours'
        FOR UPDATE SKIP LOCKED
    LOOP
        UPDATE public.notifications SET escalated_at = NOW() WHERE id = v_n.id;

        IF v_n.user_id IS NOT NULL THEN
            SELECT name INTO v_who FROM public.users WHERE id = v_n.user_id;
            v_who := COALESCE(v_who, 'A team member') || ' hasn''t';
        ELSE
            v_who := 'Nobody has';
        END IF;

        INSERT INTO public.notifications
            (business_id, title, message, type, priority, action_type, action_target, payload, created_by)
        VALUES (
            v_n.business_id,
            'Alert not accepted',
            v_who || ' accepted "' || v_n.title || '" from '
                || to_char(v_n.created_at AT TIME ZONE 'Africa/Nairobi', 'HH24:MI') || '.',
            'Alert Not Accepted',
            'high'::public.notification_priority,
            'navigate'::public.notification_action_type,
            v_n.action_target,
            jsonb_build_object('notificationId', v_n.id, 'userId', v_n.user_id),
            'system'
        );
        v_count := v_count + 1;
    END LOOP;
    RETURN v_count;
END;
$$;

-- ---------------------------------------------------------------------------
-- NOTIFICATION SETTINGS: managers can switch off "not accepted" notices.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_notification_catalog()
RETURNS TABLE (category TEXT, types TEXT[], permissions TEXT[], locked BOOLEAN)
LANGUAGE sql
IMMUTABLE
AS $$
    VALUES
        ('stock', ARRAY['Stock Almost Finished', 'Out Of Stock'], ARRAY['inventory.view'], FALSE),
        ('sales', ARRAY['Sales Summary', 'Daily Report', 'Weekly Report', 'Monthly Report'], ARRAY['reports.sales'], FALSE),
        ('debts', ARRAY['Debt Due Reminder', 'Credit Sale'], ARRAY['customers.debts'], FALSE),
        ('deliveries', ARRAY['Delivery Assigned', 'Delivery Completed'], ARRAY['deliveries.view'], FALSE),
        ('payments', ARRAY['Payment Received', 'Low Cash Balance'], ARRAY['payments.view', 'payments.verify'], FALSE),
        ('online_store', ARRAY['Online Store'], ARRAY['online_store.view'], FALSE),
        ('schedules', ARRAY['Schedule Reminder', 'Scheduled Reminder'], NULL::TEXT[], FALSE),
        ('unaccepted', ARRAY['Alert Not Accepted'], ARRAY['staff.view'], FALSE),
        ('ai', ARRAY['AI Business Insight', 'AI Recommendation', 'AI Risk Alert'], ARRAY['ai.insights'], FALSE),
        ('announcements', ARRAY['Business Announcement', 'Custom Notification'], NULL::TEXT[], FALSE),
        ('account', ARRAY['Role Invitation', 'Account Activity', 'System Update'], NULL::TEXT[], TRUE);
$$;

-- ---------------------------------------------------------------------------
-- CRON
-- ---------------------------------------------------------------------------
DO $$
DECLARE
    v_job RECORD;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
        RETURN;
    END IF;
    FOR v_job IN
        SELECT * FROM (VALUES
            ('process-schedule-reminders', '*/5 * * * *', 'SELECT public.flag_due_schedule_reminders()'),
            ('escalate-unaccepted-alerts', '* * * * *', 'SELECT public.escalate_unaccepted_alerts()')
        ) AS jobs(name, schedule, command)
    LOOP
        PERFORM cron.unschedule(j.jobname) FROM cron.job j WHERE j.jobname = v_job.name;
        PERFORM cron.schedule(v_job.name, v_job.schedule, v_job.command);
    END LOOP;
END;
$$;

-- ---------------------------------------------------------------------------
-- ACCESS
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.flag_due_schedule_reminders() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.escalate_unaccepted_alerts() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_is_alert_recipient(public.notifications, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_my_ringing_alerts(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.accept_alert(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_ringing_alerts(UUID), public.accept_alert(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.flag_due_schedule_reminders(), public.escalate_unaccepted_alerts() TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
