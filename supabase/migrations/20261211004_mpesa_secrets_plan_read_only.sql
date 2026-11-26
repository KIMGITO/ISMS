-- M-Pesa keys obey read-only plans like every other business table (grants_check.sql rule 6).
-- Edge functions write as service_role, which the trigger lets through.
DROP TRIGGER IF EXISTS trg_zz_plan_read_only ON public.mpesa_payment_secrets;
CREATE TRIGGER trg_zz_plan_read_only BEFORE INSERT OR UPDATE OR DELETE ON public.mpesa_payment_secrets
    FOR EACH ROW EXECUTE FUNCTION public.fn_block_when_read_only();
