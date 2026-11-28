-- Messages to many customers: variables the business makes itself, and each customer's
-- buying history for the "last bought" groups and variables.
--
-- message_variables: one value for everybody, such as {offer_ends} = "Sunday". The app
-- adds them next to the built-in ones ({first_name}, {debt}, ...). Keys are lower case
-- letters, digits and _, and can't take the name of a built-in variable (checked in the app).

CREATE TABLE IF NOT EXISTS public.message_variables (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    key         text NOT NULL CHECK (key ~ '^[a-z][a-z0-9_]{1,29}$'),
    label       text NOT NULL CHECK (char_length(label) BETWEEN 1 AND 60),
    value       text NOT NULL DEFAULT '' CHECK (char_length(value) <= 300),
    updated_by  text,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now(),
    UNIQUE (business_id, key)
);

ALTER TABLE public.message_variables ENABLE ROW LEVEL SECURITY;

CREATE POLICY pol_message_variables_select ON public.message_variables FOR SELECT
    USING (business_id = ANY (public.get_user_business_ids())
           AND public.has_permission(business_id, 'communication.view', 'communication.send', 'customers.view'));
CREATE POLICY pol_message_variables_insert ON public.message_variables FOR INSERT
    WITH CHECK (public.has_permission(business_id, 'communication.send'));
CREATE POLICY pol_message_variables_update ON public.message_variables FOR UPDATE
    USING (public.has_permission(business_id, 'communication.send'))
    WITH CHECK (public.has_permission(business_id, 'communication.send'));
CREATE POLICY pol_message_variables_delete ON public.message_variables FOR DELETE
    USING (public.has_permission(business_id, 'communication.send'));

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.message_variables TO authenticated;
GRANT ALL ON TABLE public.message_variables TO service_role;

-- Last purchase, number of purchases and total spent per customer, from the sales
-- themselves (the app only holds recent sales). Runs as the caller, so the usual rules
-- on transactions apply.
CREATE OR REPLACE FUNCTION public.customer_purchase_stats(p_business_id uuid)
RETURNS TABLE (customer_id uuid, last_purchase_at timestamptz, purchases integer, total_spent numeric)
LANGUAGE sql STABLE
SET search_path TO 'public'
AS $$
    SELECT t.customer_id, max(t."timestamp"), count(*)::integer, COALESCE(sum(t.final_total), 0)
    FROM public.transactions t
    WHERE t.business_id = p_business_id
      AND t.customer_id IS NOT NULL
      AND t.deleted_at IS NULL
    GROUP BY t.customer_id;
$$;

REVOKE ALL ON FUNCTION public.customer_purchase_stats(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.customer_purchase_stats(uuid) TO authenticated, service_role;
