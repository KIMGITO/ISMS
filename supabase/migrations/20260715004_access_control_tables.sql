-- =============================================================================
-- 20260715_004_access_control_tables.sql
-- KayKay's Milk Business Management System
-- Access Control Tables: business_memberships, invitations, role_permissions, employees
-- =============================================================================
-- Why: These tables define who can access which business and with what role.
-- They depend on businesses and users existing first (migration 003).
-- The `employees` table stores operational profile data (PIN, shift, tasks,
-- assigned branches) that the POS and shift system use at runtime.
-- Dependencies: 001, 002, 003
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- TABLE: business_memberships
-- Links users to businesses with a role. The auth system checks this table
-- to determine what a logged-in user can see and do (via get_user_business_ids
-- and is_owner_or_admin helper functions defined in migration 012).
-- UNIQUE(business_id, user_id) prevents duplicate memberships.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.business_memberships (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    user_id     UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    role        public.employee_role NOT NULL DEFAULT 'Staff',
    status      public.membership_status NOT NULL DEFAULT 'Pending',
    joined_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (business_id, user_id)
);

ALTER TABLE public.business_memberships ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- TABLE: invitations
-- Staff invitation records. When an owner invites a staff member, a record
-- is created here with a secure token. The invitee uses the token to sign
-- up and claim their employee profile. Tokens expire after 72 hours.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.invitations (
    id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id      UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    invited_by       UUID REFERENCES public.users(id) ON DELETE SET NULL,
    name             TEXT NOT NULL,
    email            TEXT,
    phone            TEXT,
    role             public.employee_role NOT NULL DEFAULT 'Staff',
    invitation_token TEXT UNIQUE NOT NULL DEFAULT encode(gen_random_bytes(32), 'hex'),
    expires_at       TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '72 hours'),
    accepted_at      TIMESTAMPTZ,
    status           public.invitation_status NOT NULL DEFAULT 'Pending',
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.invitations ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- TABLE: role_permissions
-- Granular permission flags per role per business. Owners can override which
-- features are accessible per role (e.g. Cashier cannot see reports).
-- The PermissionsView in the UI reads and writes to this table.
-- UNIQUE(business_id, role, permission) prevents conflicting grants.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.role_permissions (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    role        public.employee_role NOT NULL,
    permission  TEXT NOT NULL,
    granted     BOOLEAN NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (business_id, role, permission)
);

ALTER TABLE public.role_permissions ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- TABLE: employees
-- Operational profile for each staff member within a business.
-- id is set equal to users.id (and auth.users.id) for zero-join identity
-- resolution. The active_shift_id FK is deferred to avoid circular FK issues
-- with the shifts table (which will be created later). It is added as an
-- ALTER TABLE in migration 007 after shifts is created.
-- tasks and assigned_branches are stored as JSONB arrays for flexibility.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.employees (
    id                UUID PRIMARY KEY,
    business_id       UUID REFERENCES public.businesses(id) ON DELETE CASCADE,
    user_id           UUID REFERENCES public.users(id) ON DELETE SET NULL,
    name              TEXT NOT NULL,
    role              public.employee_role NOT NULL DEFAULT 'Staff',
    email             TEXT,
    phone             TEXT,
    pin               TEXT NOT NULL DEFAULT '0000',
    active_shift_id   UUID,               -- FK added later (migration 007) after shifts table exists
    tasks             JSONB NOT NULL DEFAULT '[]',
    avatar            TEXT,
    assigned_branches JSONB NOT NULL DEFAULT '[]',
    version           INTEGER NOT NULL DEFAULT 1,
    sync_status       public.sync_status NOT NULL DEFAULT 'synced',
    last_modified_by  TEXT NOT NULL DEFAULT 'system',
    deleted_at        TIMESTAMPTZ,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.employees ENABLE ROW LEVEL SECURITY;

COMMIT;
