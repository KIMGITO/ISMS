-- Auto clock-out: a shift left open for 15 hours is closed by the database (no phone needs
-- to be on) and the owners get the same shift report a normal clock-out sends, marked as
-- automatic. The person whose shift it was is told too.
--
-- The report mirrors shiftReportText() in src/services/shiftReport.ts: summary per product,
-- money in per method, cash to hand over, needs attention, closing balances, then details.
-- The shift ends at start + 15 hours, so the report covers exactly that window.

CREATE OR REPLACE FUNCTION public.fn_ksh(p numeric) RETURNS text
    LANGUAGE sql IMMUTABLE AS $$
    SELECT 'KSh ' || trim(to_char(round(COALESCE(p, 0)), 'FM999,999,999,990'));
$$;

CREATE OR REPLACE FUNCTION public.fn_qty(p numeric, p_unit text) RETURNS text
    LANGUAGE sql IMMUTABLE AS $$
    SELECT trim(trailing '.' FROM trim(trailing '0' FROM round(COALESCE(p, 0), 2)::text))
        || CASE WHEN COALESCE(p_unit, '') <> '' THEN ' ' || p_unit ELSE '' END;
$$;

CREATE OR REPLACE FUNCTION public.fn_shift_report_text(p_shift_id uuid, p_end timestamptz, p_note text DEFAULT NULL)
RETURNS text
    LANGUAGE plpgsql VOLATILE SECURITY DEFINER
    SET search_path TO 'public'
AS $$
DECLARE
    v_s public.shifts;
    v_name text;
    v_lines text[] := ARRAY[]::text[];
    v_r record;
    v_first boolean := true;
    v_mins int;
    v_tz constant text := 'Africa/Nairobi';
    v_cash numeric := 0; v_credit numeric := 0; v_cash_debt numeric := 0; v_cash_exp numeric := 0;
    v_money_total numeric := 0; v_expected numeric; v_exp_total numeric := 0; v_debt_total numeric := 0;
    v_till numeric;
    v_attention text[] := ARRAY[]::text[];
BEGIN
    SELECT * INTO v_s FROM public.shifts WHERE id = p_shift_id;
    IF NOT FOUND THEN RETURN NULL; END IF;
    SELECT name INTO v_name FROM public.employees WHERE id = v_s.employee_id;
    v_name := COALESCE(v_name, 'Staff');
    v_mins := GREATEST(0, round(extract(epoch FROM (p_end - v_s.start_time)) / 60));

    -- Sales by this person in the window, with each product's share of the sale's final total.
    CREATE TEMP TABLE IF NOT EXISTS _sr_sales (id uuid, final_total numeric, method text) ON COMMIT DROP;
    CREATE TEMP TABLE IF NOT EXISTS _sr_lines (product_id uuid, name text, qty numeric, share numeric, method text) ON COMMIT DROP;
    TRUNCATE _sr_sales; TRUNCATE _sr_lines;

    INSERT INTO _sr_sales
    SELECT t.id, t.final_total, t.payment_method::text
    FROM public.transactions t
    WHERE t.business_id = v_s.business_id AND t.staff_id = v_s.employee_id AND t.deleted_at IS NULL
      AND t."timestamp" BETWEEN v_s.start_time AND p_end;

    INSERT INTO _sr_lines
    SELECT i.product_id, i.product_name, i.quantity,
           CASE WHEN sum(i.unit_price * i.quantity * (1 - i.discount_percentage / 100)) OVER w > 0
                THEN s.final_total * (i.unit_price * i.quantity * (1 - i.discount_percentage / 100))
                     / sum(i.unit_price * i.quantity * (1 - i.discount_percentage / 100)) OVER w
                ELSE s.final_total / count(*) OVER w END,
           s.method
    FROM _sr_sales s JOIN public.transaction_items i ON i.transaction_id = s.id
    WINDOW w AS (PARTITION BY s.id);

    SELECT COALESCE(sum(final_total) FILTER (WHERE method = 'Cash'), 0),
           COALESCE(sum(final_total) FILTER (WHERE method IN ('Credit', 'Credit_Debt')), 0)
      INTO v_cash, v_credit FROM _sr_sales;
    SELECT COALESCE(sum(amount_paid) FILTER (WHERE payment_method = 'Cash'), 0), COALESCE(sum(amount_paid), 0)
      INTO v_cash_debt, v_debt_total
      FROM public.debt_payments
     WHERE business_id = v_s.business_id AND recorded_by = v_name AND created_at BETWEEN v_s.start_time AND p_end;
    SELECT COALESCE(sum(amount) FILTER (WHERE COALESCE(payment_method, 'Cash') = 'Cash'), 0), COALESCE(sum(amount), 0)
      INTO v_cash_exp, v_exp_total
      FROM public.expenses
     WHERE business_id = v_s.business_id AND deleted_at IS NULL AND COALESCE(created_at, date) BETWEEN v_s.start_time AND p_end;
    v_expected := round(v_cash + v_cash_debt - v_cash_exp, 2);

    v_lines := v_lines || ('*Shift report: ' || v_name || '*');
    v_lines := v_lines || (to_char(p_end AT TIME ZONE v_tz, 'Dy, FMDD Mon YYYY') || ', '
        || lower(to_char(v_s.start_time AT TIME ZONE v_tz, 'FMHH12:MI am')) || ' – '
        || lower(to_char(p_end AT TIME ZONE v_tz, 'FMHH12:MI am')) || ' ('
        || CASE WHEN v_mins >= 60 THEN (v_mins / 60) || 'h ' || (v_mins % 60) || 'm' ELSE v_mins || 'm' END || ')');
    IF p_note IS NOT NULL THEN v_lines := v_lines || p_note; END IF;

    -- Summary per product
    v_lines := v_lines || ARRAY['', '*Summary*'];
    FOR v_r IN
        SELECT l.name, COALESCE(p.unit, '') AS unit, sum(l.qty) AS sold, sum(l.share) AS earned, count(*) AS sales,
               sum(l.share) FILTER (WHERE l.method = 'Cash') AS cash,
               sum(l.share) FILTER (WHERE l.method = 'M-Pesa') AS till,
               sum(l.share) FILTER (WHERE l.method NOT IN ('Cash', 'M-Pesa', 'Credit', 'Credit_Debt')) AS other,
               sum(l.share) FILTER (WHERE l.method IN ('Credit', 'Credit_Debt')) AS credit
        FROM _sr_lines l LEFT JOIN public.products p ON p.id = l.product_id
        GROUP BY l.product_id, l.name, p.unit ORDER BY earned DESC
    LOOP
        IF NOT v_first THEN v_lines := v_lines || ''::text; END IF;
        v_first := false;
        v_lines := v_lines || v_r.name;
        v_lines := v_lines || ('- Sales: ' || fn_ksh(v_r.earned) || ' from ' || v_r.sales || CASE WHEN v_r.sales = 1 THEN ' sale' ELSE ' sales' END
            || ' (' || fn_qty(v_r.sold, v_r.unit) || ')');
        v_lines := v_lines || ('- Money taken in: ' || fn_ksh(COALESCE(v_r.cash, 0) + COALESCE(v_r.till, 0) + COALESCE(v_r.other, 0))
            || COALESCE(' (' || NULLIF(concat_ws(', ',
                   CASE WHEN COALESCE(v_r.cash, 0) <> 0 THEN 'cash ' || fn_ksh(v_r.cash) END,
                   CASE WHEN COALESCE(v_r.till, 0) <> 0 THEN 'till ' || fn_ksh(v_r.till) END,
                   CASE WHEN COALESCE(v_r.other, 0) <> 0 THEN 'other ' || fn_ksh(v_r.other) END), '') || ')', ''));
        IF COALESCE(v_r.credit, 0) <> 0 THEN v_lines := v_lines || ('- On credit: ' || fn_ksh(v_r.credit)); END IF;
    END LOOP;
    IF v_first THEN v_lines := v_lines || 'No sales this shift.'::text; END IF;

    -- Amount made: Cash, then till, then the rest by size
    v_lines := v_lines || ARRAY['', '*Amount made today*'];
    FOR v_r IN
        WITH m AS (
            SELECT method, final_total AS sales, 0::numeric AS debt FROM _sr_sales WHERE method NOT IN ('Credit', 'Credit_Debt')
            UNION ALL
            SELECT payment_method, 0, amount_paid FROM public.debt_payments
             WHERE business_id = v_s.business_id AND recorded_by = v_name AND created_at BETWEEN v_s.start_time AND p_end
            UNION ALL SELECT 'Cash', 0, 0 UNION ALL SELECT 'M-Pesa', 0, 0
        )
        SELECT method, sum(sales + debt) AS total, sum(debt) AS debt FROM m GROUP BY method
        ORDER BY CASE method WHEN 'Cash' THEN 0 WHEN 'M-Pesa' THEN 1 ELSE 2 END, total DESC
    LOOP
        v_lines := v_lines || ('- ' || CASE WHEN v_r.method = 'M-Pesa' THEN 'Till (M-Pesa)' ELSE v_r.method END || ': ' || fn_ksh(v_r.total)
            || CASE WHEN v_r.debt <> 0 THEN ' (incl. ' || fn_ksh(v_r.debt) || ' debt repaid)' ELSE '' END);
        v_money_total := v_money_total + v_r.total;
        IF v_r.method = 'M-Pesa' THEN v_till := v_r.total; END IF;
    END LOOP;
    v_lines := v_lines || ('- Total: ' || fn_ksh(v_money_total) || CASE WHEN v_credit <> 0 THEN ', plus ' || fn_ksh(v_credit) || ' on credit' ELSE '' END);
    IF v_cash_exp <> 0 THEN v_lines := v_lines || ('- Cash spent: ' || fn_ksh(v_cash_exp)); END IF;
    v_lines := v_lines || ('- Cash to hand over: ' || fn_ksh(v_expected));

    -- Needs attention: uncounted cash and stock running low on things sold
    IF v_expected > 0 THEN v_attention := v_attention || 'Cash in the drawer was not counted'::text; END IF;
    FOR v_r IN
        SELECT DISTINCT p.name, p.stock, p.unit, p.stock <= 0 AS out
        FROM _sr_lines l JOIN public.products p ON p.id = l.product_id
        WHERE p.stock <= 0 OR (p.min_stock > 0 AND p.stock <= p.min_stock)
        ORDER BY out DESC, p.stock
    LOOP
        v_attention := v_attention || CASE WHEN v_r.out THEN v_r.name || ' is out of stock'
                                           ELSE v_r.name || ' is running low (' || fn_qty(v_r.stock, v_r.unit) || ' left)' END;
    END LOOP;
    IF array_length(v_attention, 1) > 0 THEN
        v_lines := v_lines || ARRAY['', '*Needs attention*'];
        FOR i IN 1 .. array_length(v_attention, 1) LOOP v_lines := v_lines || ('- ' || v_attention[i]); END LOOP;
    END IF;

    v_lines := v_lines || ARRAY['', '*Closing balances*'];
    v_lines := v_lines || ('- Cash in drawer: ' || fn_ksh(v_expected) || ' (expected, not counted)');
    IF v_till IS NOT NULL THEN v_lines := v_lines || ('- Till (M-Pesa) received: ' || fn_ksh(v_till)); END IF;
    FOR v_r IN
        SELECT p.name, p.stock, p.unit, sum(l.share) AS earned
        FROM _sr_lines l JOIN public.products p ON p.id = l.product_id
        GROUP BY p.id, p.name, p.stock, p.unit ORDER BY earned DESC
    LOOP
        v_lines := v_lines || ('- ' || v_r.name || ': ' || fn_qty(v_r.stock, v_r.unit) || ' left');
    END LOOP;

    -- Details
    IF v_credit <> 0 THEN
        v_lines := v_lines || ARRAY['', ('*Credit given (' || fn_ksh(v_credit) || ')*')];
        FOR v_r IN
            WITH cs AS (
                SELECT s.id, s.final_total, COALESCE(t.customer_id::text, t.customer_name, 'unknown') AS who,
                       COALESCE(t.customer_name, c.name, 'Unknown customer') AS name, c.debt_balance
                FROM _sr_sales s JOIN public.transactions t ON t.id = s.id LEFT JOIN public.customers c ON c.id = t.customer_id
                WHERE s.method IN ('Credit', 'Credit_Debt')
            )
            SELECT max(cs.name) AS name, sum(cs.final_total) AS amount, max(cs.debt_balance) AS owes,
                   (SELECT string_agg(fn_qty(i.quantity, '') || ' × ' || i.product_name, ', ')
                      FROM public.transaction_items i JOIN cs c2 ON c2.id = i.transaction_id WHERE c2.who = cs.who) AS items
            FROM cs GROUP BY cs.who
        LOOP
            v_lines := v_lines || ('- ' || v_r.name || ': ' || fn_ksh(v_r.amount) || ' (' || COALESCE(v_r.items, '') || ') | now owes ' || fn_ksh(v_r.owes));
        END LOOP;
    END IF;

    IF v_debt_total <> 0 THEN
        v_lines := v_lines || ARRAY['', ('*Debt repaid (' || fn_ksh(v_debt_total) || ')*')];
        FOR v_r IN
            SELECT COALESCE(c.name, 'Unknown customer') AS name, d.amount_paid, d.payment_method, d.remaining_debt
            FROM public.debt_payments d LEFT JOIN public.customers c ON c.id = d.customer_id
            WHERE d.business_id = v_s.business_id AND d.recorded_by = v_name AND d.created_at BETWEEN v_s.start_time AND p_end
            ORDER BY d.created_at
        LOOP
            v_lines := v_lines || ('- ' || v_r.name || ': ' || fn_ksh(v_r.amount_paid) || ' by '
                || CASE WHEN v_r.payment_method = 'M-Pesa' THEN 'Till (M-Pesa)' ELSE v_r.payment_method END
                || ' | still owes ' || fn_ksh(v_r.remaining_debt));
        END LOOP;
    END IF;

    IF v_exp_total <> 0 THEN
        v_lines := v_lines || ARRAY['', ('*Expenses (' || fn_ksh(v_exp_total) || ')*')];
        FOR v_r IN
            SELECT category, amount, COALESCE(payment_method, 'Cash') AS method, description
            FROM public.expenses
            WHERE business_id = v_s.business_id AND deleted_at IS NULL AND COALESCE(created_at, date) BETWEEN v_s.start_time AND p_end
            ORDER BY COALESCE(created_at, date)
        LOOP
            v_lines := v_lines || ('- ' || v_r.category || ': ' || fn_ksh(v_r.amount) || ' ('
                || CASE WHEN v_r.method = 'M-Pesa' THEN 'Till (M-Pesa)' ELSE v_r.method END || ')'
                || CASE WHEN COALESCE(v_r.description, '') <> '' THEN ', ' || v_r.description ELSE '' END);
        END LOOP;
    END IF;

    RETURN array_to_string(v_lines, E'\n');
END;
$$;

CREATE OR REPLACE FUNCTION public.auto_clock_out_long_shifts() RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
AS $$
DECLARE
    v_s record;
    v_end timestamptz;
    v_text text;
    v_n int := 0;
BEGIN
    FOR v_s IN
        SELECT s.id, s.business_id, s.employee_id, s.start_time, e.name, e.user_id
        FROM public.shifts s
        LEFT JOIN public.employees e ON e.id = s.employee_id
        WHERE s.status = 'Active' AND s.end_time IS NULL AND s.deleted_at IS NULL
          AND s.start_time <= now() - interval '15 hours'
        ORDER BY s.start_time
        FOR UPDATE OF s SKIP LOCKED
    LOOP
        v_end := v_s.start_time + interval '15 hours';

        -- Same guard as a normal clock-out: only a still-open shift is closed.
        UPDATE public.shifts SET status = 'Closed', end_time = v_end, last_modified_by = 'auto-clock-out'
         WHERE id = v_s.id AND status = 'Active' AND end_time IS NULL;
        IF NOT FOUND THEN CONTINUE; END IF;
        UPDATE public.employees SET active_shift_id = NULL WHERE id = v_s.employee_id AND active_shift_id = v_s.id;

        v_text := public.fn_shift_report_text(v_s.id, v_end,
            '_Clocked out automatically after 15 hours: ' || COALESCE(v_s.name, 'Staff') || ' did not clock out._');

        INSERT INTO public.notifications (business_id, role, title, message, type, priority, payload, created_by)
        VALUES (v_s.business_id, 'Owner',
                'Shift ended: ' || COALESCE(v_s.name, 'Staff') || ' (automatic)',
                COALESCE(v_s.name, 'Staff') || ' did not clock out, so the shift was closed automatically after 15 hours.',
                'Custom Notification', 'high',
                jsonb_build_object('reportText', v_text, 'employeeName', COALESCE(v_s.name, 'Staff'),
                                   'employeeId', v_s.employee_id, 'closedAt', v_end, 'autoClockOut', true),
                'system');

        -- Tell the person too, so they know why their clock bar is off.
        IF v_s.user_id IS NOT NULL THEN
            INSERT INTO public.notifications (business_id, user_id, title, message, type, priority, payload, created_by)
            VALUES (v_s.business_id, v_s.user_id, 'You were clocked out',
                    'You did not clock out, so your shift was closed automatically after 15 hours. Your report went to the owners.',
                    'Custom Notification', 'medium',
                    jsonb_build_object('reportText', v_text, 'employeeName', COALESCE(v_s.name, 'Staff'), 'autoClockOut', true),
                    'system');
        END IF;
        v_n := v_n + 1;
    END LOOP;
    RETURN v_n;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_shift_report_text(uuid, timestamptz, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.auto_clock_out_long_shifts() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_shift_report_text(uuid, timestamptz, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.auto_clock_out_long_shifts() TO service_role;

DO $do$ BEGIN
    IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
        PERFORM cron.schedule('auto-clock-out', '*/5 * * * *', $job$SELECT public.auto_clock_out_long_shifts()$job$);
    END IF;
END $do$;
