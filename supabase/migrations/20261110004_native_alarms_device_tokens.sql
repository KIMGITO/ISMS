-- =============================================================================
-- 20261110004_native_alarms_device_tokens.sql
-- Reminders become real alarms on the phone, and push tokens belong to one person.
-- =============================================================================
-- Why:
--  * A reminder only rang if the server pushed at that exact minute. A phone that was offline,
--    dozing, or missing a token stayed silent. Now each reminder is copied to its person's
--    phone ahead of time, and Android's AlarmManager rings it there, with or without internet.
--    The server's push at the alarm time stays as the backup for phones that never got the copy.
--  * Push tokens were saved per (person, token) and never moved. When someone else signed in on
--    the same phone, the old person's notifications kept arriving there. RLS also stopped the
--    app from removing the old row.
--
-- Adds:
--  register_device_token / unregister_device_token   one owner per token, removed on sign-out
--  get_my_alarms()                                   the reminders this person's phone should ring
--  accept_schedule_occurrence(schedule, date)        Accept on the phone's own alarm
--  trg_schedule_alarm_sync                           tells the person's phones when a reminder changes
--  daily cleanup of tokens no phone has refreshed in 60 days
--
-- Needs the alarm-sync edge function deployed (same Vault secrets as send-fcm).
-- =============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

-- ---------------------------------------------------------------------------
-- Who a schedule belongs to. employee_id is normally an employees.id; older rows can hold the
-- user id itself. Same lookup the reminder cron uses, plus that fallback.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_schedule_user(p_employee_id UUID)
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT COALESCE(
        (SELECT e.user_id FROM public.employees e WHERE e.id = p_employee_id AND e.deleted_at IS NULL),
        (SELECT u.id FROM public.users u WHERE u.id = p_employee_id)
    );
$$;
REVOKE ALL ON FUNCTION public.fn_schedule_user(UUID) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- DEVICE TOKENS
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.register_device_token(p_token TEXT, p_platform TEXT DEFAULT 'android', p_sound TEXT DEFAULT NULL)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_me UUID := (SELECT u.id FROM public.users u WHERE u.auth_user_id = auth.uid());
BEGIN
    IF v_me IS NULL THEN
        RAISE EXCEPTION 'Please sign in again.' USING ERRCODE = '42501';
    END IF;
    IF p_token IS NULL OR length(p_token) < 20 OR length(p_token) > 4096 THEN
        RAISE EXCEPTION 'That device token is not valid.';
    END IF;

    -- A token is one phone. Whoever registers it now is its only owner.
    DELETE FROM public.device_fcm_tokens WHERE device_token = p_token AND user_id <> v_me;

    INSERT INTO public.device_fcm_tokens (user_id, device_token, device_type, sound, updated_at)
    VALUES (v_me, p_token, left(COALESCE(p_platform, 'android'), 20),
            COALESCE(NULLIF(left(p_sound, 60), ''), 'beep'), NOW())   -- 'beep' is the column default
    ON CONFLICT (user_id, device_token) DO UPDATE
        SET device_type = EXCLUDED.device_type,
            sound = CASE WHEN NULLIF(p_sound, '') IS NULL THEN public.device_fcm_tokens.sound ELSE EXCLUDED.sound END,
            updated_at = NOW();
END;
$$;

CREATE OR REPLACE FUNCTION public.unregister_device_token(p_token TEXT)
RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
    DELETE FROM public.device_fcm_tokens
    WHERE device_token = p_token
      AND user_id = (SELECT u.id FROM public.users u WHERE u.auth_user_id = auth.uid());
$$;

REVOKE ALL ON FUNCTION public.register_device_token(TEXT, TEXT, TEXT), public.unregister_device_token(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.register_device_token(TEXT, TEXT, TEXT), public.unregister_device_token(TEXT) TO authenticated;

-- ---------------------------------------------------------------------------
-- ALARMS FOR THIS PHONE
-- Every reminder set for the signed-in person, in every business they are active in.
-- Times are Nairobi wall-clock times, as the reminder cron uses.
-- One-off reminders that are already over are left out.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_my_alarms()
RETURNS TABLE (
    id UUID,
    business_id UUID,
    title TEXT,
    notes TEXT,
    date DATE,
    start_time TEXT,
    repeat TEXT,
    last_reminded_on DATE,
    updated_at TIMESTAMPTZ,
    user_id UUID
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    WITH me AS (SELECT u.id FROM public.users u WHERE u.auth_user_id = auth.uid())
    SELECT s.id, s.business_id, COALESCE(NULLIF(s.title, ''), 'Reminder'), s.notes, s.date,
           to_char(s.start_time, 'HH24:MI'), s.repeat::TEXT, s.last_reminded_on, s.updated_at, me.id
    FROM public.schedules s, me
    WHERE s.deleted_at IS NULL
      AND public.fn_schedule_user(s.employee_id) = me.id
      AND s.business_id = ANY(public.get_user_business_ids())
      AND (s.repeat::TEXT <> 'None' OR s.date >= (NOW() AT TIME ZONE 'Africa/Nairobi')::DATE - 1)
    ORDER BY s.date, s.start_time;
$$;
REVOKE ALL ON FUNCTION public.get_my_alarms() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_alarms() TO authenticated;

-- ---------------------------------------------------------------------------
-- ACCEPT ON THE PHONE
-- The phone's alarm knows its schedule and day, not the server's notification row (the row may
-- not exist yet, or the phone may have been offline). If the row exists it is accepted as usual.
-- If not, the day is marked as done, so the server never rings or escalates it.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.accept_schedule_occurrence(p_schedule_id UUID, p_date DATE)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_me UUID := (SELECT u.id FROM public.users u WHERE u.auth_user_id = auth.uid());
    v_s public.schedules%ROWTYPE;
    v_n UUID;
BEGIN
    SELECT * INTO v_s FROM public.schedules WHERE id = p_schedule_id;
    IF NOT FOUND OR v_me IS NULL OR public.fn_schedule_user(v_s.employee_id) IS DISTINCT FROM v_me
       OR NOT (v_s.business_id = ANY(public.get_user_business_ids())) THEN
        RAISE EXCEPTION 'That reminder was not found.' USING ERRCODE = '42501';
    END IF;

    SELECT n.id INTO v_n
    FROM public.notifications n
    WHERE n.type = 'Schedule Reminder'
      AND n.user_id = v_me
      AND n.payload->>'schedule_id' = p_schedule_id::TEXT
      AND n.payload->>'shift_date' = to_char(p_date, 'YYYY-MM-DD')
      AND n.deleted_at IS NULL
    ORDER BY n.created_at DESC
    LIMIT 1;

    IF v_n IS NOT NULL THEN
        RETURN public.accept_alert(v_n) || jsonb_build_object('notificationId', v_n);
    END IF;

    UPDATE public.schedules
    SET last_reminded_on = p_date, reminder_sent = TRUE
    WHERE id = p_schedule_id AND last_reminded_on IS DISTINCT FROM p_date;

    RETURN jsonb_build_object('accepted', TRUE, 'alreadyAcceptedBy', NULL,
                              'actionTarget', 'dashboard', 'businessId', v_s.business_id,
                              'notificationId', NULL);
END;
$$;
REVOKE ALL ON FUNCTION public.accept_schedule_occurrence(UUID, DATE) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.accept_schedule_occurrence(UUID, DATE) TO authenticated;

-- ---------------------------------------------------------------------------
-- SYNC: when a reminder is created, changed, moved to someone else or deleted, the alarm-sync
-- function tells the phones of the person it was for and the person it is for now.
-- The cron marking a day as rung (last_reminded_on) is not a change the phone needs.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_schedule_alarm_sync()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_url TEXT;
    v_key TEXT;
    v_id UUID := COALESCE(NEW.id, OLD.id);
    v_users UUID[];
BEGIN
    IF TG_OP = 'UPDATE'
       AND NEW.title IS NOT DISTINCT FROM OLD.title
       AND NEW.notes IS NOT DISTINCT FROM OLD.notes
       AND NEW.date IS NOT DISTINCT FROM OLD.date
       AND NEW.start_time IS NOT DISTINCT FROM OLD.start_time
       AND NEW.repeat IS NOT DISTINCT FROM OLD.repeat
       AND NEW.employee_id IS NOT DISTINCT FROM OLD.employee_id
       AND NEW.deleted_at IS NOT DISTINCT FROM OLD.deleted_at THEN
        RETURN NULL;
    END IF;

    v_users := ARRAY(
        SELECT DISTINCT x FROM unnest(ARRAY[
            CASE WHEN TG_OP <> 'INSERT' THEN public.fn_schedule_user(OLD.employee_id) END,
            CASE WHEN TG_OP <> 'DELETE' THEN public.fn_schedule_user(NEW.employee_id) END
        ]) AS x WHERE x IS NOT NULL);
    IF cardinality(v_users) = 0 THEN
        RETURN NULL;
    END IF;

    SELECT decrypted_secret INTO v_url FROM vault.decrypted_secrets WHERE name = 'project_url';
    SELECT decrypted_secret INTO v_key FROM vault.decrypted_secrets WHERE name = 'fcm_webhook_secret';
    IF v_key IS NULL THEN
        SELECT decrypted_secret INTO v_key FROM vault.decrypted_secrets WHERE name = 'service_role_key';
    END IF;
    IF v_url IS NULL OR v_key IS NULL THEN
        RAISE WARNING 'fn_schedule_alarm_sync: Vault secrets are not set; phones pick the change up when the app opens.';
        RETURN NULL;
    END IF;

    PERFORM net.http_post(
        url := rtrim(v_url, '/') || '/functions/v1/alarm-sync',
        headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_key),
        body := jsonb_build_object('schedule_id', v_id, 'user_ids', to_jsonb(v_users)),
        timeout_milliseconds := 15000
    );
    RETURN NULL;
EXCEPTION WHEN OTHERS THEN
    -- Saving the reminder matters more than telling the phone straight away.
    RAISE WARNING 'fn_schedule_alarm_sync: %', SQLERRM;
    RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.fn_schedule_alarm_sync() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_schedule_alarm_sync ON public.schedules;
CREATE TRIGGER trg_schedule_alarm_sync
    AFTER INSERT OR UPDATE OR DELETE ON public.schedules
    FOR EACH ROW EXECUTE FUNCTION public.fn_schedule_alarm_sync();

-- ---------------------------------------------------------------------------
-- CLEANUP: a token no phone has refreshed in 60 days belongs to an uninstalled app.
-- The app refreshes its token every time it opens.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
        RETURN;
    END IF;
    PERFORM cron.unschedule(j.jobname) FROM cron.job j WHERE j.jobname = 'prune-stale-device-tokens';
    PERFORM cron.schedule('prune-stale-device-tokens', '17 3 * * *',
        $job$DELETE FROM public.device_fcm_tokens WHERE updated_at < NOW() - INTERVAL '60 days'$job$);
END;
$$;

NOTIFY pgrst, 'reload schema';

COMMIT;
