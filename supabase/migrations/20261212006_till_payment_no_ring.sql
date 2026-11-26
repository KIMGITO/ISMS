-- A till payment nobody has assigned yet no longer rings the phone. It still waits in
-- Payments > Paid to the till and shows as a normal notice, to be assigned when convenient.
CREATE OR REPLACE FUNCTION public.fn_ringing_alert_target(p_type text, p_title text, p_direct boolean) RETURNS text
    LANGUAGE sql IMMUTABLE
    AS $$
    SELECT CASE
        WHEN p_type = 'Schedule Reminder' THEN 'dashboard'
        WHEN p_type = 'Delivery Assigned' AND p_direct THEN 'deliveries'
        WHEN p_type = 'Online Store' AND p_title = 'New delivery' AND p_direct THEN 'deliveries'
        WHEN p_type = 'Online Store' AND p_title IN ('New online order', 'Online payment needs checking', 'Delivery not completed')
            THEN 'online-store'
        ELSE NULL
    END;
$$;

ALTER FUNCTION public.fn_ringing_alert_target(text, text, boolean) OWNER TO postgres;

-- Stop the ones already ringing; the notices themselves stay.
UPDATE public.notifications SET ring = FALSE
WHERE ring AND type = 'Online Store' AND title = 'M-Pesa till payment to assign';
