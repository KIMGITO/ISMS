-- =============================================================================
-- 20261116001_suppliers_purchases_assets_files_audit.sql
-- Real screens for Suppliers, Purchases, Assets, Files and the Audit Log.
--
-- The tables and their role rules have existed since July (20260715009 and
-- 20261105014); the app only ever showed placeholder data kept on the device.
-- This adds what the new screens need:
--   1. Purchases: which supplier, a reference number, notes, who received it and when.
--      Each line can name the product it restocks.
--   2. receive_purchase(): marks an order received and adds each linked line to stock
--      (a Restock in Stock History, with the purchase number as its reference). It can
--      also set the product's cost to what was paid.
--   3. Assets: where it is, when it was bought, notes.
--   4. Files: a private "business-files" bucket. Folder = business id. Reading needs
--      files.view, uploading and deleting need files.manage.
--   5. Audit log: changes to suppliers, purchases, assets, files and product details
--      (name, price, cost, category, not every stock movement) are written for the
--      business, with who did it. PIN and role changes now carry the business too, so
--      they show on that business's log.
-- =============================================================================

BEGIN;

-- 1. Purchases ------------------------------------------------------------------

ALTER TABLE public.purchases
    ADD COLUMN IF NOT EXISTS supplier_id      UUID REFERENCES public.suppliers(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS reference_number TEXT,
    ADD COLUMN IF NOT EXISTS notes            TEXT,
    ADD COLUMN IF NOT EXISTS created_by       TEXT,
    ADD COLUMN IF NOT EXISTS received_at      TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS received_by      TEXT;

ALTER TABLE public.purchase_items
    ADD COLUMN IF NOT EXISTS product_id UUID REFERENCES public.products(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_purchases_supplier_id ON public.purchases(supplier_id);
CREATE INDEX IF NOT EXISTS idx_purchases_business_date ON public.purchases(business_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_purchase_items_purchase_id ON public.purchase_items(purchase_id);

-- 2. Receive a purchase into stock ----------------------------------------------

CREATE OR REPLACE FUNCTION public.receive_purchase(
    p_purchase_id  UUID,
    p_staff_name   TEXT,
    p_update_cost  BOOLEAN DEFAULT FALSE
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_purchase  public.purchases%ROWTYPE;
    v_item      RECORD;
    v_old       NUMERIC(14,3);
    v_name      TEXT;
    v_ref       TEXT;
    v_staff     TEXT := COALESCE(NULLIF(trim(p_staff_name), ''), 'Staff');
    v_count     INTEGER := 0;
BEGIN
    SELECT * INTO v_purchase FROM public.purchases WHERE id = p_purchase_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'That purchase was not found.';
    END IF;

    PERFORM public.assert_permission(v_purchase.business_id, 'purchases.update', 'purchases.approve', 'purchases.manage');
    PERFORM public.assert_permission(v_purchase.business_id, 'inventory.receive_stock', 'inventory.adjust_stock');

    IF v_purchase.status = 'Received' THEN
        RAISE EXCEPTION 'This purchase was already received.';
    ELSIF v_purchase.status = 'Cancelled' THEN
        RAISE EXCEPTION 'A cancelled purchase cannot be received.';
    END IF;

    v_ref := COALESCE(NULLIF(v_purchase.reference_number, ''), 'PO-' || upper(left(replace(v_purchase.id::TEXT, '-', ''), 8)));

    FOR v_item IN
        SELECT pi.* FROM public.purchase_items pi
        WHERE pi.purchase_id = p_purchase_id AND pi.product_id IS NOT NULL
    LOOP
        SELECT stock, name INTO v_old, v_name
        FROM public.products
        WHERE id = v_item.product_id AND business_id = v_purchase.business_id AND deleted_at IS NULL
        FOR UPDATE;
        IF NOT FOUND THEN
            CONTINUE; -- product removed since the order was made
        END IF;

        UPDATE public.products
        SET stock = v_old + v_item.quantity,
            cost = CASE WHEN p_update_cost THEN v_item.price ELSE cost END,
            updated_at = NOW()
        WHERE id = v_item.product_id;

        INSERT INTO public.inventory_adjustments
            (business_id, product_id, product_name, type, quantity_adjusted,
             previous_stock, new_stock, reason, staff_name, reference_number, notes)
        VALUES (
            v_purchase.business_id, v_item.product_id, v_name, 'Restock', v_item.quantity,
            v_old, v_old + v_item.quantity,
            'Received from ' || v_purchase.supplier_name, v_staff, v_ref,
            'Purchase ' || v_ref || ' at KSh ' || v_item.price || ' per ' || v_item.unit
        );
        v_count := v_count + 1;
    END LOOP;

    UPDATE public.purchases
    SET status = 'Received', received_at = NOW(), received_by = v_staff,
        reference_number = v_ref, updated_at = NOW()
    WHERE id = p_purchase_id;

    RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.receive_purchase(UUID, TEXT, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.receive_purchase(UUID, TEXT, BOOLEAN) TO authenticated, service_role;

-- 3. Assets ---------------------------------------------------------------------

ALTER TABLE public.business_assets
    ADD COLUMN IF NOT EXISTS location     TEXT,
    ADD COLUMN IF NOT EXISTS purchased_on DATE,
    ADD COLUMN IF NOT EXISTS notes        TEXT;

-- 4. Files ----------------------------------------------------------------------

ALTER TABLE public.storage_files
    ADD COLUMN IF NOT EXISTS storage_path TEXT,
    ADD COLUMN IF NOT EXISTS size_bytes   BIGINT,
    ADD COLUMN IF NOT EXISTS notes        TEXT;

CREATE INDEX IF NOT EXISTS idx_storage_files_business_date ON public.storage_files(business_id, date DESC);

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'business-files', 'business-files', false, 20 * 1024 * 1024,
    ARRAY[
        'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif', 'image/heic', 'image/heif',
        'application/pdf',
        'text/plain', 'text/csv',
        'application/vnd.ms-excel',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.ms-powerpoint',
        'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        'application/zip'
    ]
)
ON CONFLICT (id) DO UPDATE
SET public = false,
    file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

-- TRUE when the signed-in person has one of these permissions in the business named by
-- the first folder of an object path. Anything that isn't a business id is refused.
CREATE OR REPLACE FUNCTION public.fn_storage_folder_permission(p_folder TEXT, VARIADIC p_permissions TEXT[])
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF auth.uid() IS NULL
       OR p_folder !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' THEN
        RETURN FALSE;
    END IF;
    RETURN public.has_permission(p_folder::UUID, VARIADIC p_permissions);
END;
$$;

REVOKE ALL ON FUNCTION public.fn_storage_folder_permission(TEXT, TEXT[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_storage_folder_permission(TEXT, TEXT[]) TO anon, authenticated, service_role;

DROP POLICY IF EXISTS "business-files read" ON storage.objects;
DROP POLICY IF EXISTS "business-files upload" ON storage.objects;
DROP POLICY IF EXISTS "business-files delete" ON storage.objects;

CREATE POLICY "business-files read" ON storage.objects
    FOR SELECT TO authenticated
    USING (bucket_id = 'business-files'
           AND public.fn_storage_folder_permission(split_part(name, '/', 1), 'files.view', 'files.manage'));

CREATE POLICY "business-files upload" ON storage.objects
    FOR INSERT TO authenticated
    WITH CHECK (bucket_id = 'business-files'
                AND public.fn_storage_folder_permission(split_part(name, '/', 1), 'files.manage'));

CREATE POLICY "business-files delete" ON storage.objects
    FOR DELETE TO authenticated
    USING (bucket_id = 'business-files'
           AND public.fn_storage_folder_permission(split_part(name, '/', 1), 'files.manage'));

-- 5. Audit log ------------------------------------------------------------------

-- Who is acting, as a name for the log.
CREATE OR REPLACE FUNCTION public.fn_audit_actor_name()
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT COALESCE((SELECT u.name FROM public.users u WHERE u.id = auth.uid() OR u.auth_user_id = auth.uid() LIMIT 1), 'System');
$$;

-- One trigger for every audited table. Bookkeeping columns, and stock on products
-- (every sale moves it; Stock History already records that), don't count as changes.
CREATE OR REPLACE FUNCTION public.fn_audit_row_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_ignore  TEXT[] := ARRAY['updated_at', 'created_at', 'version', 'sync_status', 'last_modified_by', 'stock', 'search_vector'];
    v_old     JSONB := CASE WHEN TG_OP <> 'INSERT' THEN to_jsonb(OLD) ELSE '{}'::JSONB END;
    v_new     JSONB := CASE WHEN TG_OP <> 'DELETE' THEN to_jsonb(NEW) ELSE '{}'::JSONB END;
    v_row     JSONB := CASE WHEN TG_OP = 'DELETE' THEN v_old ELSE v_new END;
    v_changes JSONB := '{}'::JSONB;
    v_key     TEXT;
    v_action  TEXT;
    v_label   TEXT;
BEGIN
    -- A business being deleted takes its rows with it (products may be soft-deleted on
    -- the way, an UPDATE); there's no log left to write to, and a row pointing at the
    -- vanishing business would stop the delete.
    IF NOT EXISTS (SELECT 1 FROM public.businesses b WHERE b.id = (v_row ->> 'business_id')::UUID) THEN
        RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
    END IF;

    IF TG_OP = 'UPDATE' THEN
        FOR v_key IN SELECT jsonb_object_keys(v_new) LOOP
            CONTINUE WHEN v_key = ANY(v_ignore);
            IF (v_old -> v_key) IS DISTINCT FROM (v_new -> v_key) THEN
                v_changes := v_changes || jsonb_build_object(v_key, jsonb_build_object('from', v_old -> v_key, 'to', v_new -> v_key));
            END IF;
        END LOOP;
        IF v_changes = '{}'::JSONB THEN
            RETURN NEW;
        END IF;
    END IF;

    v_action := CASE
        WHEN TG_OP = 'INSERT' THEN 'CREATE'
        WHEN TG_OP = 'DELETE' THEN 'DELETE'
        WHEN v_changes ? 'deleted_at' AND (v_new ->> 'deleted_at') IS NOT NULL THEN 'DELETE'
        WHEN v_changes ? 'deleted_at' THEN 'RESTORE'
        WHEN v_changes ? 'status' THEN 'STATUS'
        ELSE 'UPDATE'
    END;
    v_label := COALESCE(v_row ->> 'name', v_row ->> 'supplier_name', v_row ->> 'reference_number', v_row ->> 'id');

    INSERT INTO public.audit_logs (business_id, user_id, action, table_name, record_id, details)
    VALUES (
        (v_row ->> 'business_id')::UUID,
        (SELECT u.id FROM public.users u WHERE u.id = auth.uid() OR u.auth_user_id = auth.uid() LIMIT 1),
        v_action,
        TG_TABLE_NAME,
        v_row ->> 'id',
        jsonb_build_object('label', v_label, 'by', public.fn_audit_actor_name())
            || CASE WHEN TG_OP = 'UPDATE' THEN jsonb_build_object('changes', v_changes) ELSE '{}'::JSONB END
            || CASE WHEN v_action = 'STATUS' THEN jsonb_build_object('status', v_new ->> 'status') ELSE '{}'::JSONB END
    );
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

DO $migration$
DECLARE
    v_tbl TEXT;
BEGIN
    FOREACH v_tbl IN ARRAY ARRAY['suppliers', 'purchases', 'business_assets', 'storage_files', 'products'] LOOP
        EXECUTE format('DROP TRIGGER IF EXISTS trg_audit_row_change ON public.%I', v_tbl);
        EXECUTE format('CREATE TRIGGER trg_audit_row_change AFTER INSERT OR UPDATE OR DELETE ON public.%I
                        FOR EACH ROW EXECUTE FUNCTION public.fn_audit_row_change()', v_tbl);
    END LOOP;
END;
$migration$;

-- PIN and role changes: same as before, now with the business and who did it.
CREATE OR REPLACE FUNCTION public.fn_employee_sensitive_audit()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF OLD.pin IS DISTINCT FROM NEW.pin THEN
        INSERT INTO public.audit_logs (business_id, employee_id, action, table_name, record_id, details)
        VALUES (NEW.business_id, NEW.id, 'UPDATE_PIN', 'employees', NEW.id::TEXT,
                jsonb_build_object('label', NEW.name, 'employee_name', NEW.name, 'modifier_role', NEW.role, 'by', public.fn_audit_actor_name()));
    END IF;

    IF OLD.role IS DISTINCT FROM NEW.role THEN
        INSERT INTO public.audit_logs (business_id, employee_id, action, table_name, record_id, details)
        VALUES (NEW.business_id, NEW.id, 'UPDATE_ROLE', 'employees', NEW.id::TEXT,
                jsonb_build_object('label', NEW.name, 'employee_name', NEW.name, 'old_role', OLD.role, 'new_role', NEW.role, 'by', public.fn_audit_actor_name()));
    END IF;

    RETURN NEW;
END;
$$;

CREATE INDEX IF NOT EXISTS idx_audit_logs_business_time ON public.audit_logs(business_id, timestamp DESC);

NOTIFY pgrst, 'reload schema';

COMMIT;
