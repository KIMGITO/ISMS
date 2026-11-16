-- =============================================================================
-- dev_wipe.sql: empty a database to start a business from scratch.
-- Replaces dev_clear.sql and dev_reset.sql (both from an old schema; they missed the
-- accounting, invoicing, buying and transfer tables).
--
-- Keeps the schema, migrations, role defaults and storage buckets. Removes every business,
-- branch, product, customer, sale, document, entry in the books and sign-in, so the first
-- owner signs up again and creates the business. Uploaded files stay until you empty the
-- buckets in the Supabase dashboard (Storage); SQL is not allowed to delete them.
--
-- It refuses to run unless you opt in for this session first:
--   SET app.wipe_everything = 'yes, wipe it';
--   \i supabase/dev_wipe.sql
-- Take a backup first (Back up database workflow, or supabase db dump).
-- To rebuild the schema as well, use `supabase db reset` instead.
-- =============================================================================

DO $$
DECLARE
    -- Lists the app reads, not data people typed in.
    v_keep TEXT[] := ARRAY['role_default_permissions', 'schema_migrations'];
    v_list TEXT;
BEGIN
    IF current_setting('app.wipe_everything', TRUE) IS DISTINCT FROM 'yes, wipe it' THEN
        RAISE EXCEPTION 'Refusing to wipe. Run: SET app.wipe_everything = ''yes, wipe it''; then this file again.';
    END IF;

    SELECT string_agg(format('%I.%I', schemaname, tablename), ', ')
    INTO v_list
    FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> ALL (v_keep);

    IF v_list IS NOT NULL THEN
        EXECUTE 'TRUNCATE ' || v_list || ' RESTART IDENTITY CASCADE';
    END IF;

    -- Every sign-in. Uploaded files (logos, product photos, business files) can't be removed
    -- from SQL (Supabase blocks it); empty the buckets in the dashboard under Storage.
    DELETE FROM auth.users;

    RAISE NOTICE 'Wiped. Empty the Storage buckets in the dashboard, then sign up as the owner and create the business.';
END;
$$;
