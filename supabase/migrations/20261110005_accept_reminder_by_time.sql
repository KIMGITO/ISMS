-- =============================================================================
-- 20261110005_accept_reminder_by_time.sql
-- An accept on the phone is for one ring: the reminder's day AND time.
-- =============================================================================
-- Why: a reminder accepted at 12:07 and then moved to 12:11 the same day must ring again at
-- 12:11. accept_schedule_occurrence matched by day only, so the phone's accept of the 12:07
-- ring could find (or mark done) the 12:11 one. Now it matches the time too, and an accept
-- for a time the reminder no longer has does nothing.
-- =============================================================================

BEGIN;

DROP FUNCTION IF EXISTS public.accept_schedule_occurrence(UUID, DATE);

CREATE OR REPLACE FUNCTION public.accept_schedule_occurrence(p_schedule_id UUID, p_date DATE, p_time TEXT DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_me UUID := (SELECT u.id FROM public.users u WHERE u.auth_user_id = auth.uid());
    v_s public.schedules%ROWTYPE;
    v_n UUID;
    v_time TEXT := NULLIF(left(p_time, 5), '');
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
      AND (v_time IS NULL OR n.payload->>'start_time' = v_time)
      AND n.deleted_at IS NULL
    ORDER BY n.created_at DESC
    LIMIT 1;

    IF v_n IS NOT NULL THEN
        RETURN public.accept_alert(v_n) || jsonb_build_object('notificationId', v_n);
    END IF;

    -- No server row yet (the phone rang first, or was offline). Mark the day done so the server
    -- doesn't ring or escalate it, but only if the reminder still rings at this time.
    UPDATE public.schedules
    SET last_reminded_on = p_date, reminder_sent = TRUE
    WHERE id = p_schedule_id
      AND last_reminded_on IS DISTINCT FROM p_date
      AND (v_time IS NULL OR to_char(start_time, 'HH24:MI') = v_time);

    RETURN jsonb_build_object('accepted', TRUE, 'alreadyAcceptedBy', NULL,
                              'actionTarget', 'dashboard', 'businessId', v_s.business_id,
                              'notificationId', NULL);
END;
$$;
REVOKE ALL ON FUNCTION public.accept_schedule_occurrence(UUID, DATE, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.accept_schedule_occurrence(UUID, DATE, TEXT) TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;
