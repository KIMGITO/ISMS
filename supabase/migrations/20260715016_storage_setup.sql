-- =============================================================================
-- 20260715016_storage_setup.sql
-- KayKay's Milk Storage Configuration & RLS Setup
-- =============================================================================

-- 1. Create buckets if they do not exist
INSERT INTO storage.buckets (id, name, public)
VALUES 
    ('business-logos', 'business-logos', true),
    ('employee-avatars', 'employee-avatars', true),
    ('product-images', 'product-images', true),
    ('receipt-exports', 'receipt-exports', false),
    ('expense-receipts', 'expense-receipts', false)
ON CONFLICT (id) DO UPDATE 
SET public = EXCLUDED.public;

-- 2. Drop existing policies on storage.objects to avoid conflicts
DROP POLICY IF EXISTS "Allow select for authorized users" ON storage.objects;
DROP POLICY IF EXISTS "Allow insert for authorized users" ON storage.objects;
DROP POLICY IF EXISTS "Allow update for authorized users" ON storage.objects;
DROP POLICY IF EXISTS "Allow delete for authorized users" ON storage.objects;

-- 3. Enable RLS on storage.objects
-- ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;

-- 4. Define policies on storage.objects

-- SELECT policy:
-- - Public buckets can be read by anyone (unauthenticated/authenticated).
-- - Private buckets can be read if the prefix segment is in get_user_business_ids() or equals auth.uid() or is 'global'.
CREATE POLICY "Allow select for authorized users" ON storage.objects
    FOR SELECT
    USING (
        bucket_id IN ('business-logos', 'employee-avatars', 'product-images')
        OR (
            bucket_id IN ('receipt-exports', 'expense-receipts')
            AND (
                CASE 
                    WHEN split_part(name, '/', 1) ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' THEN
                        (split_part(name, '/', 1))::uuid = ANY(public.get_user_business_ids()) OR (split_part(name, '/', 1))::uuid = auth.uid()
                    WHEN split_part(name, '/', 1) = 'global' THEN true
                    ELSE false
                END
            )
        )
    );

-- INSERT policy:
-- - Allows inserting files if the path prefix matches a business they belong to, or their user ID, or is 'global'.
CREATE POLICY "Allow insert for authorized users" ON storage.objects
    FOR INSERT
    TO authenticated
    WITH CHECK (
        bucket_id IN ('business-logos', 'employee-avatars', 'product-images', 'receipt-exports', 'expense-receipts')
        AND (
            CASE 
                WHEN split_part(name, '/', 1) ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' THEN
                    (split_part(name, '/', 1))::uuid = ANY(public.get_user_business_ids()) OR (split_part(name, '/', 1))::uuid = auth.uid()
                WHEN split_part(name, '/', 1) = 'global' THEN true
                ELSE false
            END
        )
    );

-- UPDATE policy:
-- - Allows updating files if the path prefix matches a business they belong to, or their user ID, or is 'global'.
CREATE POLICY "Allow update for authorized users" ON storage.objects
    FOR UPDATE
    TO authenticated
    USING (
        bucket_id IN ('business-logos', 'employee-avatars', 'product-images', 'receipt-exports', 'expense-receipts')
        AND (
            CASE 
                WHEN split_part(name, '/', 1) ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' THEN
                    (split_part(name, '/', 1))::uuid = ANY(public.get_user_business_ids()) OR (split_part(name, '/', 1))::uuid = auth.uid()
                WHEN split_part(name, '/', 1) = 'global' THEN true
                ELSE false
            END
        )
    );

-- DELETE policy:
-- - Allows deleting files if the path prefix matches a business they belong to, or their user ID, or is 'global'.
CREATE POLICY "Allow delete for authorized users" ON storage.objects
    FOR DELETE
    TO authenticated
    USING (
        bucket_id IN ('business-logos', 'employee-avatars', 'product-images', 'receipt-exports', 'expense-receipts')
        AND (
            CASE 
                WHEN split_part(name, '/', 1) ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' THEN
                    (split_part(name, '/', 1))::uuid = ANY(public.get_user_business_ids()) OR (split_part(name, '/', 1))::uuid = auth.uid()
                WHEN split_part(name, '/', 1) = 'global' THEN true
                ELSE false
            END
        )
    );
