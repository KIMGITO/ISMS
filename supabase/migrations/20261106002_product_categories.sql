-- =============================================================================
-- 20261106002_product_categories.sql
-- Why: product categories only existed as the category text on products, so a
-- new category disappeared as soon as products synced, before anything used it.
-- They now live in their own table. Any category a product uses is added
-- automatically, so existing data and older app versions keep working.
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.product_categories (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    name        TEXT NOT NULL CHECK (length(trim(name)) > 0 AND length(name) <= 60),
    created_by  TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_product_categories_name
    ON public.product_categories (business_id, lower(trim(name)));

ALTER TABLE public.product_categories ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pol_product_categories_select ON public.product_categories;
CREATE POLICY pol_product_categories_select ON public.product_categories FOR SELECT
    USING (public.has_permission(business_id, 'products.view', 'inventory.view', 'pos.create_sale'));

DROP POLICY IF EXISTS pol_product_categories_insert ON public.product_categories;
CREATE POLICY pol_product_categories_insert ON public.product_categories FOR INSERT
    WITH CHECK (public.has_permission(business_id, 'products.manage_categories', 'products.create'));

DROP POLICY IF EXISTS pol_product_categories_update ON public.product_categories;
CREATE POLICY pol_product_categories_update ON public.product_categories FOR UPDATE
    USING (public.has_permission(business_id, 'products.manage_categories'))
    WITH CHECK (public.has_permission(business_id, 'products.manage_categories'));

DROP POLICY IF EXISTS pol_product_categories_delete ON public.product_categories;
CREATE POLICY pol_product_categories_delete ON public.product_categories FOR DELETE
    USING (public.has_permission(business_id, 'products.manage_categories'));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.product_categories TO authenticated;
GRANT ALL ON public.product_categories TO service_role;

-- Every category already in use becomes a row.
INSERT INTO public.product_categories (business_id, name, created_by)
SELECT DISTINCT ON (business_id, lower(trim(category))) business_id, trim(category), 'system'
FROM public.products
WHERE deleted_at IS NULL AND length(trim(COALESCE(category, ''))) > 0
ORDER BY business_id, lower(trim(category)), created_at
ON CONFLICT DO NOTHING;

-- A product saved with a new category name adds it to the list.
CREATE OR REPLACE FUNCTION public.fn_register_product_category()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF length(trim(COALESCE(NEW.category, ''))) > 0 THEN
        INSERT INTO public.product_categories (business_id, name, created_by)
        VALUES (NEW.business_id, trim(NEW.category), 'product')
        ON CONFLICT DO NOTHING;
    END IF;
    RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_register_product_category() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_register_product_category ON public.products;
CREATE TRIGGER trg_register_product_category
AFTER INSERT OR UPDATE OF category ON public.products
FOR EACH ROW EXECUTE FUNCTION public.fn_register_product_category();

DO $$
BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.product_categories;
EXCEPTION WHEN duplicate_object OR undefined_object THEN NULL;
END $$;

NOTIFY pgrst, 'reload schema';

COMMIT;
