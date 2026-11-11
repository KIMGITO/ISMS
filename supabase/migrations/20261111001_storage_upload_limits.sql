-- =============================================================================
-- 20261111001_storage_upload_limits.sql
-- Closes the open upload rules found in the 2026-11-11 security audit.
--
-- Before: any signed-in account, including a customer who signed up on the website,
-- could put any file of any size into the public buckets under "global/" or their own
-- user-id folder, overwrite other people's "global/" files, and read "global/" files in
-- the private receipt buckets.
--
-- After:
--   * "global/" is gone (the app only used it as a fallback when nobody was signed in,
--     and no file lives there).
--   * A business folder (<business id>/...) is writable only by that business's members,
--     as before.
--   * Your own folder (<your user id>/...) is writable only by staff and by owners who
--     haven't created their business yet, never by website customers.
--   * Each bucket takes only the file types the app sends, with a size cap:
--       logos / avatars / product photos: JPG, PNG, WebP, GIF, AVIF, HEIC, 10 MB
--         (no SVG, which can carry scripts). Unsplash picks are downloaded from
--         images.unsplash.com and stored as JPEG, WebP or AVIF, so they pass.
--       receipt exports / expense receipts: those images plus PDF, CSV, Excel, Word, 20 MB.
--
-- Files already stored are untouched (all are WebP images under 1 MB as of today).
-- =============================================================================

-- 1. File types and sizes per bucket -----------------------------------------

UPDATE storage.buckets
SET file_size_limit = 10 * 1024 * 1024,
    allowed_mime_types = ARRAY[
        'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif', 'image/heic', 'image/heif'
    ]
WHERE id IN ('business-logos', 'employee-avatars', 'product-images');

UPDATE storage.buckets
SET file_size_limit = 20 * 1024 * 1024,
    allowed_mime_types = ARRAY[
        'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif', 'image/heic', 'image/heif',
        'application/pdf',
        'text/csv',
        'application/vnd.ms-excel',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    ]
WHERE id IN ('receipt-exports', 'expense-receipts');

-- 2. Who may write to a folder -------------------------------------------------

-- TRUE when the signed-in person may write under the first folder of an object path.
-- Business folder: members of that business. Own user-id folder: anyone who isn't a
-- website customer, or who also belongs to a business (staff who shop with us too).
CREATE OR REPLACE FUNCTION public.fn_can_write_storage_folder(p_folder TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_folder UUID;
    v_businesses UUID[];
BEGIN
    IF auth.uid() IS NULL
       OR p_folder !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' THEN
        RETURN FALSE;
    END IF;
    v_folder := p_folder::UUID;
    v_businesses := public.get_user_business_ids();

    IF v_folder = ANY(v_businesses) THEN
        RETURN TRUE;
    END IF;

    IF v_folder = auth.uid() THEN
        RETURN cardinality(v_businesses) > 0
            OR NOT EXISTS (SELECT 1 FROM public.customer_accounts WHERE id = auth.uid());
    END IF;

    RETURN FALSE;
END;
$$;

-- anon too: Postgres checks the right to call a function when it plans the policy, even
-- where the public-bucket branch means it never runs. It returns FALSE without a login.
REVOKE ALL ON FUNCTION public.fn_can_write_storage_folder(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_can_write_storage_folder(TEXT) TO anon, authenticated, service_role;

-- 3. Policies --------------------------------------------------------------------

DROP POLICY IF EXISTS "Allow select for authorized users" ON storage.objects;
DROP POLICY IF EXISTS "Allow insert for authorized users" ON storage.objects;
DROP POLICY IF EXISTS "Allow update for authorized users" ON storage.objects;
DROP POLICY IF EXISTS "Allow delete for authorized users" ON storage.objects;

-- Public buckets are readable by anyone (that's how the website shows photos).
-- Private buckets: your business's folder, or your own.
CREATE POLICY "Allow select for authorized users" ON storage.objects
    FOR SELECT
    USING (
        bucket_id IN ('business-logos', 'employee-avatars', 'product-images')
        OR (
            bucket_id IN ('receipt-exports', 'expense-receipts')
            AND auth.uid() IS NOT NULL
            AND public.fn_can_write_storage_folder(split_part(name, '/', 1))
        )
    );

CREATE POLICY "Allow insert for authorized users" ON storage.objects
    FOR INSERT
    TO authenticated
    WITH CHECK (
        bucket_id IN ('business-logos', 'employee-avatars', 'product-images', 'receipt-exports', 'expense-receipts')
        AND public.fn_can_write_storage_folder(split_part(name, '/', 1))
    );

CREATE POLICY "Allow update for authorized users" ON storage.objects
    FOR UPDATE
    TO authenticated
    USING (
        bucket_id IN ('business-logos', 'employee-avatars', 'product-images', 'receipt-exports', 'expense-receipts')
        AND public.fn_can_write_storage_folder(split_part(name, '/', 1))
    )
    WITH CHECK (
        bucket_id IN ('business-logos', 'employee-avatars', 'product-images', 'receipt-exports', 'expense-receipts')
        AND public.fn_can_write_storage_folder(split_part(name, '/', 1))
    );

CREATE POLICY "Allow delete for authorized users" ON storage.objects
    FOR DELETE
    TO authenticated
    USING (
        bucket_id IN ('business-logos', 'employee-avatars', 'product-images', 'receipt-exports', 'expense-receipts')
        AND public.fn_can_write_storage_folder(split_part(name, '/', 1))
    );
