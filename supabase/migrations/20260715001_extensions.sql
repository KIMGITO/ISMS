-- =============================================================================
-- 20260715_001_extensions.sql
-- KayKay's Milk Business Management System
-- Extensions & Schema Access
-- =============================================================================
-- Why: uuid-ossp provides uuid_generate_v4(), pgcrypto provides gen_random_bytes()
-- and gen_random_uuid(), pg_trgm enables trigram similarity search on product/customer
-- names. These must be loaded first; every other migration depends on them.
-- Dependencies: None
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- Create a wrapper function in public schema for uuid_generate_v4 to avoid search_path issues
CREATE OR REPLACE FUNCTION public.uuid_generate_v4()
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
AS $$
  SELECT extensions.uuid_generate_v4();
$$;

-- Create a wrapper function in public schema for gen_random_bytes to avoid search_path issues
CREATE OR REPLACE FUNCTION public.gen_random_bytes(how_many integer)
RETURNS bytea
LANGUAGE sql
SECURITY DEFINER
AS $$
  SELECT extensions.gen_random_bytes(how_many);
$$;

-- Grant schema usage to Supabase built-in roles
GRANT USAGE ON SCHEMA public TO anon, authenticated;
