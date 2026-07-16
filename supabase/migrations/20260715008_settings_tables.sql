-- =============================================================================
-- 20260715_008_settings_tables.sql
-- KayKay's Milk Business Management System
-- Settings & Integration Tables:
--   mpesa_transactions, notifications, notification_preferences,
--   integration_configurations, receipt_settings, receipt_verifications,
--   printer_settings, sms_settings, ai_settings, google_sheets_backup
-- =============================================================================
-- Why: These tables store per-business configuration and integration state.
-- Each has at most one row per business (enforced with UNIQUE or UNIQUE
-- constraint on the FK). The M-Pesa table tracks STK push callbacks.
-- All settings tables use UNIQUE(business_id) to enforce single-row config.
-- Dependencies: 001, 002, 003, 004, 005, 006, 007
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- TABLE: mpesa_transactions
-- Tracks M-Pesa STK push requests and their callback results. The edge
-- function mpesa-callback writes here via the log_mpesa_payment() RPC.
-- UNIQUE on checkout_request_id prevents duplicate callback insertions.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.mpesa_transactions (
    id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id             UUID REFERENCES public.businesses(id) ON DELETE SET NULL,
    transaction_id          UUID REFERENCES public.transactions(id) ON DELETE SET NULL,
    checkout_request_id     TEXT UNIQUE NOT NULL,
    merchant_request_id     TEXT NOT NULL,
    phone                   TEXT NOT NULL,
    amount                  NUMERIC(14,2) NOT NULL CHECK (amount > 0),
    status                  public.mpesa_status NOT NULL DEFAULT 'Pending',
    receipt_number          TEXT,
    mpesa_receipt_timestamp TIMESTAMPTZ,
    raw_callback            JSONB,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.mpesa_transactions ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- TABLE: notifications
-- In-app push and display notifications. Can target a user_id or a role.
-- The fn_check_low_stock trigger writes here when stock drops low.
-- The log_mpesa_payment function writes here on M-Pesa results.
-- Soft-deleted via deleted_at.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.notifications (
    id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id      UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    user_id          UUID REFERENCES public.users(id) ON DELETE SET NULL,
    role             TEXT,
    title            TEXT NOT NULL,
    message          TEXT NOT NULL,
    type             TEXT NOT NULL DEFAULT 'Custom Notification',
    priority         public.notification_priority NOT NULL DEFAULT 'medium',
    action_type      public.notification_action_type NOT NULL DEFAULT 'none',
    action_target    TEXT NOT NULL DEFAULT 'none',
    payload          JSONB NOT NULL DEFAULT '{}',
    read_at          TIMESTAMPTZ,
    clicked_at       TIMESTAMPTZ,
    expires_at       TIMESTAMPTZ,
    sent_at          TIMESTAMPTZ,
    delivered_at     TIMESTAMPTZ,
    archived_at      TIMESTAMPTZ,
    status           public.notification_delivery_status NOT NULL DEFAULT 'pending',
    created_by       TEXT NOT NULL DEFAULT 'system',
    version          INTEGER NOT NULL DEFAULT 1,
    sync_status      public.sync_status NOT NULL DEFAULT 'synced',
    last_modified_by TEXT NOT NULL DEFAULT 'system',
    deleted_at       TIMESTAMPTZ,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- TABLE: notification_preferences
-- Per-user, per-category opt-in/opt-out for notification types.
-- UNIQUE(business_id, user_id, category) prevents duplicate preference rows.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.notification_preferences (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    user_id     UUID REFERENCES public.users(id) ON DELETE CASCADE,
    category    TEXT NOT NULL,
    enabled     BOOLEAN NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (business_id, user_id, category)
);

ALTER TABLE public.notification_preferences ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- TABLE: integration_configurations
-- Generic key-value JSONB store for all integration settings (Twilio, Mpesa,
-- Cloudinary, AI, etc.). Each row is a section within a business.
-- UNIQUE(business_id, section) enforces one config object per integration.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.integration_configurations (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    section     TEXT NOT NULL,
    payload     JSONB NOT NULL DEFAULT '{}',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (business_id, section)
);

ALTER TABLE public.integration_configurations ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- TABLE: receipt_settings
-- Per-business receipt/invoice configuration. UNIQUE on business_id enforces
-- a single settings row per business.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.receipt_settings (
    id                     UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id            UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE UNIQUE,
    logo_url               TEXT,
    business_name          TEXT,
    address                TEXT,
    phone                  TEXT,
    email                  TEXT,
    website                TEXT,
    pin_number             TEXT,
    registration_number    TEXT,
    social_media           TEXT,
    header_message         TEXT,
    footer_message         TEXT,
    terms_and_conditions   TEXT,
    return_policy          TEXT,
    thank_you_message      TEXT,
    receipt_prefix         TEXT NOT NULL DEFAULT 'KKM',
    receipt_number_format  TEXT NOT NULL DEFAULT 'PREFIX-YYYY-INCREMENT',
    paper_width            TEXT NOT NULL DEFAULT '80mm',
    currency_format        TEXT NOT NULL DEFAULT 'KSh',
    date_format            TEXT NOT NULL DEFAULT 'DD/MM/YYYY',
    time_format            TEXT NOT NULL DEFAULT '24h',
    is_tax_enabled         BOOLEAN NOT NULL DEFAULT TRUE,
    tax_percentage         NUMERIC(5,2) NOT NULL DEFAULT 16.00
                               CHECK (tax_percentage >= 0 AND tax_percentage <= 100),
    qr_code_option         TEXT NOT NULL DEFAULT 'verification_url',
    custom_qr_url          TEXT,
    template_type          TEXT NOT NULL DEFAULT 'milk_shop',
    show_ai_recommendation BOOLEAN NOT NULL DEFAULT FALSE,
    created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.receipt_settings ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- TABLE: receipt_verifications
-- Verification records for printed receipts. Customers can scan a QR code
-- to verify a receipt is genuine. Token is a random hex string.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.receipt_verifications (
    id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    transaction_id     UUID NOT NULL REFERENCES public.transactions(id) ON DELETE CASCADE,
    business_id        UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    receipt_number     TEXT NOT NULL,
    verification_token TEXT UNIQUE NOT NULL DEFAULT encode(gen_random_bytes(16), 'hex'),
    verified_at        TIMESTAMPTZ,
    verification_ip    TEXT,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
    -- No updated_at: verification records are immutable
);

ALTER TABLE public.receipt_verifications ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- TABLE: printer_settings
-- Bluetooth/USB thermal printer configuration per business.
-- UNIQUE on business_id enforces single settings row.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.printer_settings (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id         UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE UNIQUE,
    default_printer_id  TEXT,
    paper_width         TEXT NOT NULL DEFAULT '80mm',
    characters_per_line INTEGER NOT NULL DEFAULT 48 CHECK (characters_per_line > 0),
    is_auto_cut_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    print_density       INTEGER NOT NULL DEFAULT 3 CHECK (print_density BETWEEN 1 AND 5),
    copies              INTEGER NOT NULL DEFAULT 1 CHECK (copies > 0),
    print_logo          BOOLEAN NOT NULL DEFAULT TRUE,
    print_qr_code       BOOLEAN NOT NULL DEFAULT TRUE,
    print_barcode       BOOLEAN NOT NULL DEFAULT TRUE,
    connection_timeout  INTEGER NOT NULL DEFAULT 5000 CHECK (connection_timeout > 0),
    auto_reconnect      BOOLEAN NOT NULL DEFAULT TRUE,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.printer_settings ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- TABLE: sms_settings
-- Twilio SMS gateway configuration per business. UNIQUE on business_id.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.sms_settings (
    id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id           UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE UNIQUE,
    provider              TEXT NOT NULL DEFAULT 'twilio',
    default_country       TEXT NOT NULL DEFAULT 'KE',
    messaging_service_sid TEXT,
    owner_phone_number    TEXT,
    enabled               BOOLEAN NOT NULL DEFAULT FALSE,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.sms_settings ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- TABLE: ai_settings
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ai_settings (
    id                   UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id          UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE UNIQUE,
    enabled              BOOLEAN NOT NULL DEFAULT TRUE,
    
    -- Routing Engine Layout Fields
    provider             TEXT NOT NULL DEFAULT 'huggingface',
    api_key              TEXT DEFAULT '',
    model                TEXT NOT NULL DEFAULT 'Qwen/Qwen2.5-72B-Instruct',
    temperature          NUMERIC(3,2) NOT NULL DEFAULT 0.50,
    max_tokens           INTEGER NOT NULL DEFAULT 1024 CHECK (max_tokens > 0),
    top_p                NUMERIC(3,2) NOT NULL DEFAULT 0.90,
    top_k                INTEGER NOT NULL DEFAULT 40,
    
    -- Diagnostic Behavioral Modifiers
    thinking_enabled     BOOLEAN NOT NULL DEFAULT FALSE,
    structured_output    BOOLEAN NOT NULL DEFAULT FALSE,
    system_prompt        TEXT DEFAULT '',
    
    -- Legacy Workspace Dashboard Preferences 
    language             TEXT NOT NULL DEFAULT 'en',
    tone                 TEXT NOT NULL DEFAULT 'professional',
    auto_insights        BOOLEAN NOT NULL DEFAULT TRUE,
    auto_stock_alerts    BOOLEAN NOT NULL DEFAULT TRUE,
    auto_pricing_suggest BOOLEAN NOT NULL DEFAULT FALSE,
    context_window_days  INTEGER NOT NULL DEFAULT 30 CHECK (context_window_days > 0),
    
    -- System Audit Timestamps
    created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.ai_settings ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- TABLE: google_sheets_backup
-- Configuration for the automated Google Sheets data backup system.
-- UNIQUE on business_id. google_service_account stores the SA JSON credentials.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.google_sheets_backup (
    id                     UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id            UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE UNIQUE,
    google_sheet_url       TEXT,
    google_service_account TEXT,
    schedule               TEXT NOT NULL DEFAULT 'nightly_12am',
    enabled                BOOLEAN NOT NULL DEFAULT FALSE,
    last_backup_at         TIMESTAMPTZ,
    last_backup_status     public.backup_status,
    last_backup_error      TEXT,
    created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.google_sheets_backup ENABLE ROW LEVEL SECURITY;

COMMIT;
