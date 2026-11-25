-- Nobody could add a customer from the app (the Owner too): the customers trigger
-- fn_customer_standard -> fn_normalize_phone -> fn_normalize_ke_phone, and
-- 20261201001 left fn_normalize_ke_phone to service_role only, so every app insert
-- failed with "permission denied for function fn_normalize_ke_phone".
-- It only tidies a phone number (no table access), so signed-in users may run it.
GRANT EXECUTE ON FUNCTION public.fn_normalize_ke_phone(text) TO authenticated;
