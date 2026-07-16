-- =============================================================================
-- 20260715_003_core_identity_tables.sql
-- KayKay's Milk Business Management System
-- Core Identity Tables: businesses, branches, users, otps, device_fcm_tokens
-- =============================================================================
-- Why: These are the root entities. Every other table in the system either
-- references businesses(id) or users(id). They must be created first.
-- The `users` table mirrors Supabase Auth's auth.users and is linked via
-- auth_user_id. Businesses are the top-level tenant container.
-- Dependencies: 001_extensions.sql, 002_enums.sql
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- TABLE: businesses
-- Root tenant entity. All data is scoped to a business via business_id FK.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.businesses (
    id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name                    TEXT NOT NULL CHECK (length(trim(name)) > 0),
    business_type           TEXT NOT NULL DEFAULT 'Retail',
    country                 TEXT NOT NULL DEFAULT 'Kenya',
    currency                TEXT NOT NULL DEFAULT 'Ksh',
    timezone                TEXT NOT NULL DEFAULT 'Africa/Nairobi',
    default_payment_methods TEXT[] NOT NULL DEFAULT ARRAY['Cash', 'M-Pesa'],
    description             TEXT,
    address                 TEXT,
    logo_url                TEXT,
    cover_image_url         TEXT,
    contact_email           TEXT CHECK (
                                contact_email IS NULL
                                OR contact_email = ''
                                OR contact_email ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$'
                            ),
    contact_phone           TEXT CHECK (
                                contact_phone IS NULL
                                OR contact_phone = ''
                                OR contact_phone ~* '^\+[1-9]\d{1,14}$'
                            ),
    primary_color           TEXT,
    secondary_color         TEXT,
    version                 INTEGER NOT NULL DEFAULT 1,
    sync_status             public.sync_status NOT NULL DEFAULT 'synced',
    last_modified_by        TEXT NOT NULL DEFAULT 'system',
    deleted_at              TIMESTAMPTZ,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.businesses ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- TABLE: branches
-- Physical or logical locations within a business (e.g. Main branch, CBD).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.branches (
    id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id      UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    name             TEXT NOT NULL CHECK (length(trim(name)) > 0),
    address          TEXT,
    version          INTEGER NOT NULL DEFAULT 1,
    sync_status      public.sync_status NOT NULL DEFAULT 'synced',
    last_modified_by TEXT NOT NULL DEFAULT 'system',
    deleted_at       TIMESTAMPTZ,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.branches ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- TABLE: users
-- Application user profile. The id is set to the Supabase Auth user UUID
-- so there is a guaranteed 1-to-1 match without needing a separate join.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.users (
    id             UUID PRIMARY KEY,        -- Matches auth.users.id directly
    auth_user_id   UUID UNIQUE,             -- Also stored for backward-compat queries
    name           TEXT NOT NULL,
    email          TEXT UNIQUE,
    phone          TEXT UNIQUE,
    avatar         TEXT,
    is_verified    BOOLEAN NOT NULL DEFAULT FALSE,
    phone_verified BOOLEAN NOT NULL DEFAULT FALSE,
    pin            TEXT,                    -- Legacy PIN field (deprecated for Supabase Auth)
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- TABLE: otps
-- Transient email OTP codes for signup verification and password reset.
-- UNIQUE(email, type) ensures at most one active OTP per email per flow.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.otps (
    id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email      TEXT NOT NULL,
    code       TEXT NOT NULL,
    type       TEXT NOT NULL CHECK (type IN ('signup', 'password_reset')),
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (email, type)
);

ALTER TABLE public.otps ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- TABLE: device_fcm_tokens
-- Firebase Cloud Messaging push tokens per user device. Used by the
-- send-fcm edge function to send push notifications.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.device_fcm_tokens (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    device_token TEXT NOT NULL,
    device_type  TEXT,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (user_id, device_token)
);

ALTER TABLE public.device_fcm_tokens ENABLE ROW LEVEL SECURITY;

COMMIT;
