-- VAT needs KRA eTIMS.
-- No sale, quote, order or invoice may carry VAT unless the branch has KRA eTIMS connected,
-- even when the business tax switch is on. The app applies the same rule (useVatPercent);
-- this makes it hold for older apps and sales queued offline too.

-- 1. The rule, in one place.
CREATE OR REPLACE FUNCTION public.vat_allowed(p_business_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
    SELECT COALESCE((SELECT is_tax_enabled FROM public.businesses WHERE id = p_business_id), FALSE)
       AND EXISTS (SELECT 1 FROM public.kra_etims_settings
                   WHERE business_id = p_business_id AND status = 'connected');
$$;
ALTER FUNCTION public.vat_allowed(uuid) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION public.vat_allowed(uuid) TO authenticated, service_role;

-- 2. Tax is off unless someone turns it on, and it can only be turned on with eTIMS connected.
ALTER TABLE public.businesses ALTER COLUMN is_tax_enabled SET DEFAULT false;
UPDATE public.businesses b SET is_tax_enabled = false
WHERE is_tax_enabled
  AND NOT EXISTS (SELECT 1 FROM public.kra_etims_settings k WHERE k.business_id = b.id AND k.status = 'connected');

CREATE OR REPLACE FUNCTION public.fn_tax_needs_etims() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
    IF NEW.is_tax_enabled AND NOT EXISTS (
        SELECT 1 FROM public.kra_etims_settings WHERE business_id = NEW.id AND status = 'connected'
    ) THEN
        NEW.is_tax_enabled := false;
    END IF;
    RETURN NEW;
END;
$$;
ALTER FUNCTION public.fn_tax_needs_etims() OWNER TO postgres;
DROP TRIGGER IF EXISTS trg_tax_needs_etims ON public.businesses;
CREATE TRIGGER trg_tax_needs_etims BEFORE INSERT OR UPDATE OF is_tax_enabled ON public.businesses
    FOR EACH ROW EXECUTE FUNCTION public.fn_tax_needs_etims();

-- 3. Sales: VAT sent without eTIMS is not VAT. The customer already paid final_total, so it
--    stays the same; the amount just counts as part of the price (sales), not VAT owed to KRA.
CREATE OR REPLACE FUNCTION public.fn_sale_vat_needs_etims() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
    IF COALESCE(NEW.tax, 0) > 0 AND NOT public.vat_allowed(NEW.business_id) THEN
        NEW.total := NEW.total + NEW.tax;
        NEW.tax := 0;
    END IF;
    RETURN NEW;
END;
$$;
ALTER FUNCTION public.fn_sale_vat_needs_etims() OWNER TO postgres;
DROP TRIGGER IF EXISTS trg_0_sale_vat_needs_etims ON public.transactions;
CREATE TRIGGER trg_0_sale_vat_needs_etims BEFORE INSERT ON public.transactions
    FOR EACH ROW EXECUTE FUNCTION public.fn_sale_vat_needs_etims();

-- 4. Quotes and orders (invoices copy their order's lines): every line is checked here.
CREATE OR REPLACE FUNCTION "public"."sd_norm_lines"("p_business_id" "uuid", "p_lines" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
    v_el    JSONB;
    v_pos   INTEGER := 0;
    v_out   JSONB := '[]'::JSONB;
    v_pid   UUID;
    v_name  TEXT;
    v_unit  TEXT;
    v_pname TEXT;
    v_punit TEXT;
    v_qty   NUMERIC;
    v_price NUMERIC;
    v_disc  NUMERIC;
    v_vat   NUMERIC;
    v_net   NUMERIC;
    v_tax   NUMERIC;
    v_vat_ok BOOLEAN := public.vat_allowed(p_business_id);
BEGIN
    IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) = 0 THEN
        RAISE EXCEPTION 'Add at least one item.';
    END IF;
    IF jsonb_array_length(p_lines) > 200 THEN
        RAISE EXCEPTION 'A document can have at most 200 items.';
    END IF;
    FOR v_el IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
        v_pos := v_pos + 1;
        v_pid := NULLIF(v_el->>'productId', '')::UUID;
        v_pname := NULL;
        v_punit := NULL;
        IF v_pid IS NOT NULL THEN
            SELECT name, unit INTO v_pname, v_punit FROM public.products
            WHERE id = v_pid AND business_id = p_business_id;
            IF NOT FOUND THEN
                RAISE EXCEPTION 'Item % is not a product of this branch.', v_pos;
            END IF;
        END IF;
        v_name  := left(COALESCE(NULLIF(trim(v_el->>'name'), ''), v_pname, ''), 200);
        v_unit  := left(COALESCE(NULLIF(trim(v_el->>'unit'), ''), v_punit), 20);
        v_qty   := round(COALESCE(NULLIF(v_el->>'quantity', '')::NUMERIC, 0), 3);
        v_price := round(COALESCE(NULLIF(v_el->>'unitPrice', '')::NUMERIC, 0), 2);
        v_disc  := round(COALESCE(NULLIF(v_el->>'discountPct', '')::NUMERIC, 0), 2);
        v_vat   := COALESCE(NULLIF(v_el->>'vatRate', '')::NUMERIC, 0);
        -- No VAT without KRA eTIMS (signed receipts), whatever the app sent.
        IF NOT v_vat_ok THEN
            v_vat := 0;
        END IF;
        IF v_name = '' THEN
            RAISE EXCEPTION 'Item % needs a name.', v_pos;
        ELSIF v_qty <= 0 THEN
            RAISE EXCEPTION '% needs a quantity above zero.', v_name;
        ELSIF v_price < 0 THEN
            RAISE EXCEPTION '% can''t have a price below zero.', v_name;
        ELSIF v_disc < 0 OR v_disc > 100 THEN
            RAISE EXCEPTION 'The discount on % must be between 0 and 100%%.', v_name;
        ELSIF v_vat NOT IN (0, 8, 16) THEN
            RAISE EXCEPTION 'VAT on % must be 0%%, 8%% or 16%%.', v_name;
        END IF;
        v_net := round(v_qty * v_price * (1 - v_disc / 100), 2);
        v_tax := round(v_net * v_vat / 100, 2);
        v_out := v_out || jsonb_build_array(jsonb_build_object(
            'position', v_pos, 'product_id', v_pid, 'name', v_name, 'unit', v_unit,
            'quantity', v_qty, 'unit_price', v_price, 'discount_pct', v_disc, 'vat_rate', v_vat,
            'line_net', v_net, 'line_vat', v_tax, 'line_total', v_net + v_tax));
    END LOOP;
    RETURN v_out;
END;
$$;

ALTER FUNCTION "public"."sd_norm_lines"("p_business_id" "uuid", "p_lines" "jsonb") OWNER TO "postgres";
