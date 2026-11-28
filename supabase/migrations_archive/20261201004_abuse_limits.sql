-- Phase 6: notice abuse, and stop promo codes being guessed.
--
-- 1. security_events: one row each time a public function turns a caller away (wrong callback
--    token, bad Paystack signature, IP not on the allow-list, body too large), and the first
--    time in a window that a rate limit blocks a key. Server only; kept 30 days.
-- 2. check_rate_limit records that first block. Behaviour is otherwise unchanged.
-- 3. check_promo_code: at most 20 wrong codes per caller IP per 15 minutes. A wrong code now
--    returns {"error": ...} instead of raising, because raising would also undo the counter.
--    The website reads the new answer (website/src/api.ts checkPromoCode).
-- 4. The Phase 5 watchdog gains two checks, abuse:refused and abuse:rate_limited. The existing
--    checks are kept as they were (renamed ops_watchdog_core_checks) and not rewritten.
-- 5. A daily job deletes events over 30 days old and rate-limit windows over 2 days old.
--
-- Settings (SQL editor):
--   UPDATE ops_watchdog_config SET abuse_refused_threshold = 10, abuse_limited_threshold = 20;

-- 1 ───────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.security_events (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    created_at timestamptz NOT NULL DEFAULT now(),
    kind text NOT NULL,      -- bad_token | bad_signature | ip_not_allowed | too_large | rate_limited
    source text NOT NULL,    -- function name, or the rate-limit key's prefix (otp, mail, promo, ...)
    ip text,
    detail text              -- rate_limited: the key (may hold an email or phone); never a secret
);
CREATE INDEX IF NOT EXISTS security_events_created_at_idx ON public.security_events (created_at);

ALTER TABLE public.security_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.security_events FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, DELETE ON public.security_events TO service_role;

CREATE INDEX IF NOT EXISTS rate_limits_window_start_idx ON public.rate_limits (window_start);

-- Called by edge functions (shared/guard.ts securityEvent). Capped at 1000 rows an hour, so a
-- flood of bad calls can't fill the database.
CREATE OR REPLACE FUNCTION public.log_security_event(p_kind text, p_source text, p_ip text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
    IF NOT public.check_rate_limit('security_events', 1000, 3600) THEN
        RETURN;
    END IF;
    INSERT INTO public.security_events (kind, source, ip)
    VALUES (left(COALESCE(p_kind, '?'), 40), left(COALESCE(p_source, '?'), 40), left(p_ip, 64));
END;
$$;
REVOKE ALL ON FUNCTION public.log_security_event(text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.log_security_event(text, text, text) TO service_role;

-- 2 ───────────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.check_rate_limit(p_key text, p_limit integer, p_window_seconds integer)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
    v_count INTEGER;
BEGIN
    INSERT INTO public.rate_limits AS r (key, window_start, count)
    VALUES (p_key, NOW(), 1)
    ON CONFLICT (key) DO UPDATE SET
        count        = CASE WHEN r.window_start < NOW() - make_interval(secs => p_window_seconds) THEN 1 ELSE r.count + 1 END,
        window_start = CASE WHEN r.window_start < NOW() - make_interval(secs => p_window_seconds) THEN NOW() ELSE r.window_start END
    RETURNING count INTO v_count;

    -- The first refusal in this window is noted for the watchdog (not every one, so a flood
    -- adds one row per key, not thousands). The event cap's own key is left out.
    IF v_count = p_limit + 1 AND p_key <> 'security_events' THEN
        INSERT INTO public.security_events (kind, source, detail)
        VALUES ('rate_limited', left(split_part(p_key, ':', 1), 40), left(p_key, 120));
    END IF;

    RETURN v_count <= p_limit;
END;
$$;
-- Grants unchanged (service_role only, 20261201001); CREATE OR REPLACE keeps them.

-- 3 ───────────────────────────────────────────────────────────────────────────────────────
-- The caller's IP as the API gateway passed it on (first trusted header wins).
CREATE OR REPLACE FUNCTION public.request_ip()
RETURNS text
LANGUAGE sql STABLE
AS $$
    SELECT COALESCE(
        NULLIF(TRIM(split_part(COALESCE(
            current_setting('request.headers', TRUE)::json->>'cf-connecting-ip',
            current_setting('request.headers', TRUE)::json->>'x-real-ip',
            current_setting('request.headers', TRUE)::json->>'x-forwarded-for',
            ''), ',', 1)), ''),
        'unknown');
$$;
REVOKE ALL ON FUNCTION public.request_ip() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.request_ip() TO service_role;

CREATE OR REPLACE FUNCTION public.check_promo_code(p_slug text, p_code text, p_subtotal numeric)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
    v_promo public.website_promo_codes%ROWTYPE;
    v_value NUMERIC;
    v_key text := 'promo:ip:' || public.request_ip();
BEGIN
    IF EXISTS (SELECT 1 FROM public.rate_limits
               WHERE key = v_key AND window_start > NOW() - INTERVAL '15 minutes' AND count >= 20) THEN
        PERFORM public.check_rate_limit(v_key, 20, 900);  -- counts this try; notes the first refusal
        RETURN jsonb_build_object('error', 'Too many wrong codes. Please wait 15 minutes and try again.');
    END IF;

    SELECT pc.* INTO v_promo
    FROM public.website_promo_codes pc
    JOIN public.businesses b ON b.id = pc.business_id
    WHERE b.website_slug = p_slug AND b.deleted_at IS NULL
      AND pc.code = upper(trim(COALESCE(p_code, '')));
    IF NOT FOUND THEN
        PERFORM public.check_rate_limit(v_key, 20, 900);
        RETURN jsonb_build_object('error', 'We don''t recognise that promo code.');
    END IF;

    v_value := public.fn_promo_value(v_promo, COALESCE(p_subtotal, 0), auth.uid());
    RETURN jsonb_build_object(
        'code', v_promo.code,
        'description', v_promo.description,
        'kind', v_promo.kind,
        'value', v_promo.value,
        'saving', v_value
    );
END;
$$;
-- Grants unchanged (anon + authenticated, it is the website's); CREATE OR REPLACE keeps them.

-- 4 ───────────────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.ops_watchdog_config
    ADD COLUMN IF NOT EXISTS abuse_refused_threshold integer NOT NULL DEFAULT 10,  -- per hour
    ADD COLUMN IF NOT EXISTS abuse_limited_threshold integer NOT NULL DEFAULT 20;  -- per hour

DO $$
BEGIN
    IF to_regprocedure('public.ops_watchdog_core_checks()') IS NULL THEN
        ALTER FUNCTION public.ops_watchdog_checks() RENAME TO ops_watchdog_core_checks;
    END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.ops_watchdog_checks()
RETURNS TABLE(check_key text, problem text)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
    c public.ops_watchdog_config;
    v_n integer;
    v_top text;
BEGIN
    RETURN QUERY SELECT * FROM public.ops_watchdog_core_checks();

    SELECT * INTO c FROM public.ops_watchdog_config WHERE id;

    -- Callers turned away by the public functions (wrong token, bad signature, ...).
    SELECT count(*) INTO v_n FROM public.security_events
    WHERE kind <> 'rate_limited' AND created_at > now() - interval '1 hour';
    check_key := 'abuse:refused';
    problem := NULL;
    IF v_n >= c.abuse_refused_threshold THEN
        SELECT string_agg(x.label, ', ') INTO v_top FROM (
            SELECT source || ' ' || kind || ' x' || count(*)
                   || COALESCE(' (IP ' || (array_agg(ip ORDER BY created_at DESC))[1] || ')', '') AS label
            FROM public.security_events
            WHERE kind <> 'rate_limited' AND created_at > now() - interval '1 hour'
            GROUP BY source, kind ORDER BY count(*) DESC LIMIT 3) x;
        problem := v_n || ' calls were refused in the last hour: ' || v_top
            || '. If a callback token leaked, change it (MPESA_CALLBACK_TOKEN / USSD_CALLBACK_TOKEN) and update the provider.';
    END IF;
    RETURN NEXT;

    -- Rate limits that started blocking (one row per key per window).
    SELECT count(*) INTO v_n FROM public.security_events
    WHERE kind = 'rate_limited' AND created_at > now() - interval '1 hour';
    check_key := 'abuse:rate_limited';
    problem := NULL;
    IF v_n >= c.abuse_limited_threshold THEN
        SELECT string_agg(x.label, ', ') INTO v_top FROM (
            SELECT source || ' x' || count(*) AS label
            FROM public.security_events
            WHERE kind = 'rate_limited' AND created_at > now() - interval '1 hour'
            GROUP BY source ORDER BY count(*) DESC LIMIT 3) x;
        problem := v_n || ' callers hit a rate limit in the last hour (' || v_top
            || '). Look at security_events for the keys; it may be a bot or one shop with a busy day.';
    END IF;
    RETURN NEXT;
END;
$$;
REVOKE ALL ON FUNCTION public.ops_watchdog_checks() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ops_watchdog_core_checks() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ops_watchdog_checks() TO service_role;
GRANT EXECUTE ON FUNCTION public.ops_watchdog_core_checks() TO service_role;

-- 5 ───────────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.purge_security_data()
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
    v_events integer;
    v_limits integer;
BEGIN
    DELETE FROM public.security_events WHERE created_at < now() - interval '30 days';
    GET DIAGNOSTICS v_events = ROW_COUNT;
    -- The longest window any limit uses is one day.
    DELETE FROM public.rate_limits WHERE window_start < now() - interval '2 days';
    GET DIAGNOSTICS v_limits = ROW_COUNT;
    RETURN v_events + v_limits;
END;
$$;
REVOKE ALL ON FUNCTION public.purge_security_data() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purge_security_data() TO service_role;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
        PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'purge-security-data';
        PERFORM cron.schedule('purge-security-data', '20 0 * * *', $job$SELECT public.purge_security_data()$job$);
    END IF;
END;
$$;
