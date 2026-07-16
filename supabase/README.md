# KayKay's Premium Milk: Supabase Production-Ready Backend

This directory houses the complete **Supabase** backend configuration, database schemas, triggers, PL/pgSQL functions, Row-Level Security (RLS) policies, and Deno-compatible Edge Functions.

The architecture is designed to support both the **KayKay's Milk Business Management App** and the future **Customer Portal App** from a single unified Postgres database.

---

## 📂 Directory Structure

```text
/supabase
├── migrations/
│   ├── 20260705000000_init_schema.sql         # Main table structures, keys, constraints, and views
│   ├── 20260705100000_rls_policies.sql         # Comprehensive Row Level Security rules
│   └── 20260705200000_functions_triggers.sql  # PL/pgSQL database logic (stock sync, loyalty, low stock alerts)
├── edge_functions/
│   ├── whatsapp-sender/                       # Dispatches templates via Meta WhatsApp Cloud API
│   ├── twilio-sms/                            # Sends high-speed SMS receipts & delivery tracking
│   ├── send-email/                            # Transactional emails via Resend or SendGrid
│   ├── gemini-copilot/                        # Google Gemini AI demand prediction & logs analysis
│   ├── cloudinary-upload/                     # Offloads secure base64 product asset uploads
│   └── mpesa-callback/                        # Webhook listener for Safaricom Daraja API STK push payments
└── README.md                                  # Setup & Deployment Instructions (This file)
```

---

## 🛠️ Deployment Instructions

Follow these steps to deploy this backend configuration to your live Supabase project.

### 1. Prerequisites
- Install the **Supabase CLI** on your local terminal:
  ```bash
  npm install -g supabase
  ```
- Sign in to your Supabase developer account:
  ```bash
  supabase login
  ```

### 2. Linking Your Project
- Retrieve your **Reference ID** from your Supabase dashboard project settings.
- Link the local repository to your remote Supabase instance:
  ```bash
  supabase link --project-ref your-project-reference-id
  ```

### 3. Deploying the Database Migrations
- Push the migrations (main schema, RLS policies, custom triggers, and procedures) directly to your active Supabase database:
  ```bash
  supabase db push
  ```
- Alternatively, you can copy the contents of the files in `/supabase/migrations/` and execute them directly inside the **SQL Editor** of the online Supabase dashboard.

### 4. Deploying Edge Functions
Configure your environment variables in your remote Supabase project first:
```bash
supabase secrets set WHATSAPP_ACCESS_TOKEN="your-token"
supabase secrets set TWILIO_ACCOUNT_SID="your-sid"
supabase secrets set TWILIO_AUTH_TOKEN="your-token"
supabase secrets set GEMINI_API_KEY="your-gemini-key"
```

Then, deploy each Edge Function to the cloud:
```bash
supabase functions deploy whatsapp-sender
supabase functions deploy twilio-sms
supabase functions deploy send-email
supabase functions deploy gemini-copilot
supabase functions deploy cloudinary-upload
supabase functions deploy mpesa-callback
```

### 5. Configuring Storage Buckets
Create the following private or public storage buckets in the **Storage** panel of your Supabase dashboard:
1. `product-images`: Public bucket for uploading/storing visual products and milk canisters.
2. `user-avatars`: Public bucket for hosting employee profile photos.
3. `business-logos`: Public bucket for loading brand markings.

---

## 🗄️ Database Schema & Relationships

### Core Entity Definitions
1. **`businesses`**: Root tenant table.
2. **`branches`**: Physical distribution outlets (e.g. Karen Hub, Westlands) referencing a parent business.
3. **`employees`**: Registers staff roles (Admin, Owner, Manager, Cashier, Rider), hashed sign-in PINs, assigned branches, and active shifts.
4. **`products`**: Catalog items detailing stock quantities, units, and replenishment min-stock limits.
5. **`customers`**: Client directories recording tier classifications (Bronze, Silver, Gold), loyalty point tallies, and wallet or debit balances.
6. **`transactions` (Orders)**: Master ledger of checkout invoices, timestamps, payment states, and delivery routing.
7. **`transaction_items` (Order Items)**: Join table mapping purchases to distinct products, detailing exact volume count and custom item discount rates.
8. **`shifts`**: Tracking punch-clock durations, registers balance, and shift-scoped sales totals.

---

## 🔒 Row Level Security (RLS)

Every table operates with Row Level Security active. Under standard rules:
- **`SELECT` / Read Operations**: Authorized employees can read details belonging to their tenancy. Public catalog endpoints (e.g. products) allow customer-facing apps to render dairy items cleanly.
- **`INSERT/UPDATE` / Write Operations**: Restricts sensitive data (such as product pricing, staff rosters, and role configurations) to Owners and Managers.
- **Audits**: The `audit_logs` table logs all actions for deep traceability.
