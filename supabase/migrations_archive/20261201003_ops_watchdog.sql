-- Phase 5: the database checks itself every 10 minutes and tells Telegram (through the
-- ops-alert function) when something is wrong, and again when it is fixed.
--
-- Checks (ops_watchdog_checks):
--   cron:<job>        a scheduled job's latest run failed
--   payments:mpesa    M-Pesa prompts with no answer from Safaricom after N minutes
--   payments:airtel   the same for Airtel Money
--   payments:card     card payments with no answer from Paystack
--   edge:calls        calls from the database to edge functions failing (pg_net)
--   db:size           database over 80% of the plan's size
--   db:connections    connections over 80% of the maximum
--
-- A problem is sent once, then again every realert_hours while it lasts; "fixed" is sent when
-- it clears. Each run stamps ops_watchdog_config.last_run_at; the public health check
-- (GET ops-alert) answers 503 when that is over 30 minutes old, so the outside uptime monitor
-- also notices if this job itself stops.
--
-- Settings (SQL editor): UPDATE ops_watchdog_config SET db_size_limit_mb = 8192;  -- Pro plan
-- Test on purpose:       SELECT public.run_ops_watchdog(true);  -- sends every current check

CREATE TABLE IF NOT EXISTS public.ops_watchdog_config (
    id boolean PRIMARY KEY DEFAULT true CHECK (id),
    db_size_limit_mb integer NOT NULL DEFAULT 500,       -- Supabase Free plan
    payment_stuck_minutes integer NOT NULL DEFAULT 30,
    edge_failures_threshold integer NOT NULL DEFAULT 3,  -- failed calls in 15 minutes
    realert_hours integer NOT NULL DEFAULT 6,
    last_run_at timestamptz
);
INSERT INTO public.ops_watchdog_config (id) VALUES (true) ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS public.ops_watchdog_state (
    check_key text PRIMARY KEY,
    problem text,                 -- NULL when fine
    first_seen_at timestamptz,
    last_alerted_at timestamptz,
    updated_at timestamptz NOT NULL DEFAULT now()
);

-- Server only: no app role reads or writes these.
ALTER TABLE public.ops_watchdog_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ops_watchdog_state ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ops_watchdog_config, public.ops_watchdog_state FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.ops_watchdog_config, public.ops_watchdog_state TO service_role;


CREATE OR REPLACE FUNCTION public.ops_watchdog_checks()
RETURNS TABLE(check_key text, problem text)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
    c public.ops_watchdog_config;
    v_n integer;
    v_oldest timestamptz;
    v_msg text;
    v_size bigint;
    v_max integer;
BEGIN
    SELECT * INTO c FROM public.ops_watchdog_config WHERE id;

    -- Scheduled jobs: the latest run of each active job, if it failed in the last day.
    IF to_regclass('cron.job_run_details') IS NOT NULL THEN
        RETURN QUERY
        SELECT 'cron:' || j.jobname,
               CASE WHEN d.status = 'failed'
                    THEN 'Scheduled job "' || j.jobname || '" failed at '
                         || to_char(d.end_time AT TIME ZONE 'Africa/Nairobi', 'DD Mon HH24:MI')
                         || ': ' || left(COALESCE(d.return_message, '(no message)'), 200)
               END
        FROM cron.job j
        LEFT JOIN LATERAL (
            SELECT r.status, r.end_time, r.return_message
            FROM cron.job_run_details r
            WHERE r.jobid = j.jobid AND r.start_time > now() - interval '1 day'
            ORDER BY r.start_time DESC LIMIT 1
        ) d ON true
        WHERE j.active AND j.jobname IS NOT NULL;
    END IF;

    -- Payments waiting for the provider's answer (callback) for too long. Only the last day,
    -- so an abandoned prompt doesn't ring forever.
    SELECT count(*), min(created_at) INTO v_n, v_oldest FROM public.mpesa_transactions
    WHERE status = 'Pending'
      AND created_at < now() - make_interval(mins => c.payment_stuck_minutes)
      AND created_at > now() - interval '1 day';
    check_key := 'payments:mpesa';
    problem := CASE WHEN v_n > 0 THEN v_n || ' M-Pesa prompt(s) have had no answer from Safaricom for over '
        || c.payment_stuck_minutes || ' min (oldest ' || to_char(v_oldest AT TIME ZONE 'Africa/Nairobi', 'DD Mon HH24:MI')
        || '). Check mpesa-webhook logs and the callback URL.' END;
    RETURN NEXT;

    SELECT count(*), min(created_at) INTO v_n, v_oldest FROM public.airtel_transactions
    WHERE status = 'Pending'
      AND created_at < now() - make_interval(mins => c.payment_stuck_minutes)
      AND created_at > now() - interval '1 day';
    check_key := 'payments:airtel';
    problem := CASE WHEN v_n > 0 THEN v_n || ' Airtel Money payment(s) have had no answer for over '
        || c.payment_stuck_minutes || ' min (oldest ' || to_char(v_oldest AT TIME ZONE 'Africa/Nairobi', 'DD Mon HH24:MI')
        || '). Check airtel-callback logs.' END;
    RETURN NEXT;

    SELECT count(*), min(created_at) INTO v_n, v_oldest FROM public.card_payments
    WHERE status = 'pending'
      AND created_at < now() - make_interval(mins => c.payment_stuck_minutes)
      AND created_at > now() - interval '1 day';
    check_key := 'payments:card';
    problem := CASE WHEN v_n > 0 THEN v_n || ' card payment(s) have had no answer from Paystack for over '
        || c.payment_stuck_minutes || ' min (oldest ' || to_char(v_oldest AT TIME ZONE 'Africa/Nairobi', 'DD Mon HH24:MI')
        || '). Check card-webhook logs.' END;
    RETURN NEXT;

    -- Calls the database makes to edge functions (pushes, backups, crash alerts, rings).
    check_key := 'edge:calls';
    problem := NULL;
    IF to_regclass('net._http_response') IS NOT NULL THEN
        SELECT count(*),
               max(COALESCE(status_code::text, '') || ' ' || left(COALESCE(error_msg, content::text, ''), 120))
        INTO v_n, v_msg
        FROM net._http_response
        WHERE created > now() - interval '15 minutes'
          AND (status_code >= 500 OR error_msg IS NOT NULL OR timed_out);
        IF v_n >= c.edge_failures_threshold THEN
            problem := v_n || ' calls from the database to edge functions failed in the last 15 min. Example: '
                || trim(v_msg) || '. Check Edge Functions → Logs.';
        END IF;
    END IF;
    RETURN NEXT;

    v_size := pg_database_size(current_database());
    check_key := 'db:size';
    problem := CASE WHEN v_size > c.db_size_limit_mb::bigint * 1024 * 1024 * 0.8
        THEN 'Database is ' || pg_size_pretty(v_size) || ', over 80% of the ' || c.db_size_limit_mb
             || ' MB plan limit. Delete old logs or upgrade the plan.' END;
    RETURN NEXT;

    SELECT count(*) INTO v_n FROM pg_stat_activity;
    v_max := current_setting('max_connections')::integer;
    check_key := 'db:connections';
    problem := CASE WHEN v_n >= v_max * 0.8
        THEN v_n || ' of ' || v_max || ' database connections in use.' END;
    RETURN NEXT;
END;
$$;


-- p_send_all: send every check now, fine or not (to test the alert path on purpose).
CREATE OR REPLACE FUNCTION public.run_ops_watchdog(p_send_all boolean DEFAULT false)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
    c public.ops_watchdog_config;
    r record;
    v_prev public.ops_watchdog_state;
    v_problems jsonb := '[]'::jsonb;
    v_fixed jsonb := '[]'::jsonb;
    v_alert_keys text[] := '{}';
    v_url text;
    v_key text;
BEGIN
    UPDATE public.ops_watchdog_config SET last_run_at = now() WHERE id RETURNING * INTO c;

    FOR r IN SELECT * FROM public.ops_watchdog_checks() LOOP
        SELECT * INTO v_prev FROM public.ops_watchdog_state s WHERE s.check_key = r.check_key;

        IF r.problem IS NOT NULL AND (
               p_send_all OR v_prev.problem IS NULL OR v_prev.last_alerted_at IS NULL
               OR v_prev.last_alerted_at < now() - make_interval(hours => c.realert_hours)) THEN
            v_problems := v_problems || jsonb_build_object('key', r.check_key, 'problem', r.problem,
                'since', COALESCE(v_prev.first_seen_at, now()));
            v_alert_keys := v_alert_keys || r.check_key;
        ELSIF r.problem IS NULL AND v_prev.problem IS NOT NULL THEN
            v_fixed := v_fixed || jsonb_build_object('key', r.check_key, 'problem', v_prev.problem,
                'since', v_prev.first_seen_at);
        END IF;

        INSERT INTO public.ops_watchdog_state AS s (check_key, problem, first_seen_at, updated_at)
        VALUES (r.check_key, r.problem, CASE WHEN r.problem IS NOT NULL THEN now() END, now())
        ON CONFLICT (check_key) DO UPDATE SET
            problem = EXCLUDED.problem,
            first_seen_at = CASE WHEN EXCLUDED.problem IS NULL THEN NULL
                                 ELSE COALESCE(s.first_seen_at, now()) END,
            last_alerted_at = CASE WHEN EXCLUDED.problem IS NULL THEN NULL ELSE s.last_alerted_at END,
            updated_at = now();
    END LOOP;

    IF jsonb_array_length(v_problems) = 0 AND jsonb_array_length(v_fixed) = 0 AND NOT p_send_all THEN
        RETURN 0;
    END IF;

    SELECT decrypted_secret INTO v_url FROM vault.decrypted_secrets WHERE name = 'project_url';
    SELECT decrypted_secret INTO v_key FROM vault.decrypted_secrets WHERE name = 'service_role_key';
    IF v_url IS NULL OR v_key IS NULL THEN
        -- Not marked as alerted, so it is sent once the secrets are set.
        RAISE WARNING 'run_ops_watchdog: Vault secrets project_url and service_role_key are not set; % problem(s) not sent.',
            jsonb_array_length(v_problems);
        RETURN 0;
    END IF;

    PERFORM net.http_post(
        url := rtrim(v_url, '/') || '/functions/v1/ops-alert',
        headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_key),
        body := jsonb_build_object('action', 'watchdog', 'problems', v_problems, 'fixed', v_fixed,
                                   'test', p_send_all),
        timeout_milliseconds := 15000
    );

    UPDATE public.ops_watchdog_state SET last_alerted_at = now() WHERE check_key = ANY (v_alert_keys);
    RETURN jsonb_array_length(v_problems) + jsonb_array_length(v_fixed);
END;
$$;

REVOKE ALL ON FUNCTION public.ops_watchdog_checks() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.run_ops_watchdog(boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ops_watchdog_checks() TO service_role;
GRANT EXECUTE ON FUNCTION public.run_ops_watchdog(boolean) TO service_role;

-- The health check reads only this: when the watchdog last ran (no details, it is public).
CREATE OR REPLACE FUNCTION public.ops_watchdog_heartbeat()
RETURNS jsonb
LANGUAGE sql SECURITY DEFINER STABLE
SET search_path TO 'public'
AS $$
    SELECT jsonb_build_object(
        'last_run_at', (SELECT last_run_at FROM public.ops_watchdog_config WHERE id),
        'open_problems', (SELECT count(*) FROM public.ops_watchdog_state WHERE problem IS NOT NULL));
$$;
REVOKE ALL ON FUNCTION public.ops_watchdog_heartbeat() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ops_watchdog_heartbeat() TO service_role;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
        PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'ops-watchdog';
        PERFORM cron.schedule('ops-watchdog', '*/10 * * * *', $job$SELECT public.run_ops_watchdog()$job$);
    END IF;
END;
$$;
