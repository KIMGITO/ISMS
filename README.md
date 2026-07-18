# 🥛 KayKay's Milk Business Management App (ISMS)

A production-ready, cross-platform enterprise management application engineered for dairy farms, processing plants, and retail outlets. This system features an **online-first, real-time reactive architecture** linking a modern **React SPA** with a **Supabase (PostgreSQL) backend**, compiled into native desktop applications via **Tauri v2** (Windows/Linux) and mobile apps via **Capacitor v8** (Android).

---

## 📂 Codebase & Project Directory Structure

```text
/ISMS
├── android/                   # Capacitor-generated Android Native Gradle Project
├── assets/                    # Shared assets and branding materials
├── capacitor.config.ts        # Capacitor build configuration (Android packages, plugins)
├── package.json               # NPM dependency manifest & project build scripts
├── src-tauri/                 # Tauri v2 Desktop wrapper configuration & Rust workspace
│   ├── capabilities/          # Desktop permission capability configurations
│   ├── src/                   # Rust entry point and window setup handlers
│   └── tauri.conf.json        # Tauri desktop build parameters
├── src/                       # Main React SPA Frontend Application
│   ├── main.tsx               # Frontend bootstrap entry point
│   ├── App.tsx                # Central core viewport container, tab router & shell layout
│   ├── index.css              # Main styling configuration (Tailwind CSS v4 & custom variables)
│   ├── components/            # Reusable UI widgets and layout modules
│   ├── core/                  # Core application configurations
│   ├── data/                  # Static lists and local schema configs
│   ├── hooks/                 # Custom React hooks (device permissions, event alerts)
│   ├── services/              # Core business services and repository abstractions
│   │   ├── ai/                # AI Assistant helper utilities
│   │   ├── backup/            # Data backup managers
│   │   ├── printer/           # Hardware thermal printer wrapper services
│   │   ├── receipt/           # ESC/POS Receipt compiler and styling managers
│   │   ├── networkService.ts  # Real-time online/offline connection state tracking
│   │   ├── repositories.ts    # Database repositories with PostgreSQL real-time replication
│   │   └── supabaseService.ts # Supabase database interaction client routines
│   ├── stores/                # Zustand modular client-side state managers
│   │   ├── appStore.ts        # Unified workspace facade (aggregates all individual stores)
│   │   ├── authStore.ts       # Onboarding, Multi-tenancy, dynamic authentication & shifts
│   │   ├── businessStore.ts   # Tenant businesses and branch routing
│   │   ├── cartStore.ts       # POS transaction cart manipulation routines
│   │   ├── customerStore.ts   # Loyalty profiles, credit balances, and wallets
│   │   ├── extraModulesStore.ts# Purchases, production batches, recipes, assets, audit logs
│   │   ├── inventoryStore.ts  # Catalog register, stock arrivals, and wastage logs
│   │   ├── notificationStore.ts# App-wide notification routing and preferences
│   │   └── uiStore.ts         # User interface global states and chat records
│   ├── types/                 # Custom TypeScript interfaces
│   └── utils/                 # Help utility libraries (phone E.164 verification, permissions logic)
├── supabase/                  # Supabase Database Backend Workspace
│   ├── config.toml            # Supabase Local Development Server configuration
│   ├── migrations/            # Version-controlled SQL migration scripts
│   │   ├── 20260715001_extensions.sql          # Installs extensions (UUID, Crypto, Vector)
│   │   ├── 20260715002_enums.sql               # App-wide custom Postgres types
│   │   ├── 20260715003_core_identity_tables.sql# Businesses, Branches, and Users
│   │   ├── 20260715004_access_control_tables.sql# Memberships, Invitations, Permissions
│   │   ├── 20260715005_product_customer_tables.sql# Products, Customers, Tiers
│   │   ├── 20260715006_transaction_tables.sql  # Sales, Items, Credit Payments
│   │   ├── 20260715007_operations_tables.sql   # Shifts, Adjustments, Categories
│   │   ├── 20260715008_settings_tables.sql     # Receipt, SMS, Printer, AI Settings
│   │   ├── 20260715009_extra_modules_tables.sql# Supplies, Recipes, Assets, Backups
│   │   ├── 20260715010_analytics_log_tables.sql# Audit Logs, Snaps, Feedback, Queues
│   │   ├── 20260715011_indexes.sql             # SQL Query Indexes for performance tuning
│   │   ├── 20260715012_functions.sql           # Database procedures (Stock adjust, logic check)
│   │   ├── 20260715013_triggers.sql            # Table automation triggers
│   │   ├── 20260715014_rls_policies.sql        # Row-Level Security Access Control Policies
│   │   ├── 20260715015_views_realtime.sql      # Database SQL views & Realtime publication setup
│   │   └── 20260715016_storage_setup.sql       # S3 Storage buckets & security policies
│   ├── edge_functions/        # Deno Cloud Functions
│   │   ├── chat/              # Chat endpoint calling Gemini API with database parameters
│   │   ├── twilio-sms/        # Twilio gateway for transactional updates
│   │   └── mpesa-callback/    # Safaricom Daraja API STK push transaction webhook listener
│   ├── dev_reset.sql          # Development database cleanup script
│   └── dev_reset.sql          # Database reset & schema loader script
└── vite.config.ts             # Vite project configuration (React, Tailwind setup)
```

---

## 🛠️ Technology Stack & Architecture

- **Frontend Core**: [React 19](https://react.dev/) SPA built with [Vite 6](https://vite.dev/) and compiled with [TypeScript](https://www.typescriptlang.org/).
- **Styling**: [Tailwind CSS v4](https://tailwindcss.com/) with a dark-mode-first glassmorphism design system.
- **State Management**: [Zustand 5](https://github.com/pmndrs/zustand) implementing modular sub-stores for separated domain logics, combined into a single unified facade API ([appStore.ts](file:///home/dennis/Projects/ISMS/src/stores/appStore.ts)).
- **Database & Realtime Backend**: [Supabase](https://supabase.com/) (PostgreSQL 15) leveraging WebSocket replication (`supabase_realtime`) for instant cross-device updates.
- **Access Control & Safety**: Strict **Row-Level Security (RLS)** in PostgreSQL protecting all tenant operations.
- **Desktop Wrappers**: [Tauri v2](https://v2.tauri.app/) compiling native executable binaries for Windows (`.exe`/`.msi`) and Linux (`.AppImage`/`.deb`).
- **Mobile Wrappers**: [Capacitor v8](https://capacitorjs.com/) mapping Web API calls to Android platform native APIs.
- **Artificial Intelligence**: [Google Gemini 1.5/2.0 API](https://deepmind.google/technologies/gemini/) orchestrated via Supabase Deno-based Edge Functions.

---

## 🚀 Application Core Features & Viewports

The application interface utilizes a tab-based navigation layout managed inside [App.tsx](file:///home/dennis/Projects/ISMS/src/App.tsx).

### 1. POS Checkout (`pos`)
- **Direct Checkouts**: Support for walk-in transactions or searching customer loyalty profiles.
- **Cart Management**: Dynamic quantity adjustment, price override, custom percentage discounts, and tax (VAT) computation.
- **Payment Flexibility**: Settlement options via Cash, Card, Mobile Money, M-Pesa, Credit, or Bank transfers.
- **Offline Safety**: Keeps transactions locally when network drops and pushes them back automatically once connection is recovered.

### 2. Products & Inventory (`inventory`)
- **Product Directory**: Comprehensive inventory management (Name, Category, SKU, Cost, Sale Price, Min Stock Limits).
- **Batch Tracking**: Expiry date logging and alerts for perishable dairy inventory.
- **Wastage Ledger**: Dairy-specific spillage, souring, and processing loss recording.
- **Reconciliation logs**: Tracks manual audits, damages, and restock arrivals.

### 3. Sales & Receipts History (`sales`)
- **Transaction History**: Displays detailed logs of previous transactions, transaction items, and active payment states.
- **PDF Generation**: Local PDF export capabilities for invoice dossiers utilizing `jspdf`.
- **Refund Handler**: Supports transaction reversals and credit adjustments.

### 4. Customers & Loyalty Credit (`customers`)
- **Loyalty Tiering**: Automated tier categorization (Bronze, Silver, Gold) based on total volume of purchases.
- **Wallet System**: Direct client deposits (top-ups) and wallet checkout processing.
- **Credit Debts Manager**: Tracking pending balances, payment allocations (M-Pesa/Cash), and ledger history.
- **Delivery Subscriptions**: Manage delivery schedules for weekly or daily milk distribution routines.

### 5. Analytics & Dashboard (`dashboard`)
- **Visual Auditing**: Interactive [Recharts](https://recharts.org/) metrics tracking sales growth, operational margins, category sales share, and profitability metrics.
- **Risk Monitor**: Low-stock alerts and active credit exposure tracking.

### 6. Workers & Shift Control (`workers`)
- **Shift Recorder**: Handles punch-in/out registers, start/end cash balance reconciliation, and sales auditing.
- **Duty Checklists**: Create and track task assignments for individual staff profiles.

### 7. Centralized Permissions Matrix (`permissions`)
- **Granular RBAC Editor**: Toggle permission states for roles directly from a visual accordion dashboard.
- **Sync Options**: Instantly saves configurations to local cache overrides and syncs settings to Supabase.

### 8. Workspace Assistant (Kim Copilot) (`ai`)
- **Intelligent Sidebar**: Custom-tailored dashboard assistant (default name "Kim") powered by Gemini.
- **Action Triggers**: The assistant can trigger real-time UI operations based on conversation flow:
  - `create_schedule`
  - `adjust_stock`
  - `create_checkout`

### 9. Settings Dashboard (`settings`)
- **Hardware Integration**: Setup thermal printers and test connection parameters.
- **Twilio Configuration**: Manage SMS message credentials and template targets.
- **Auto Backups**: Link database schedules to Google Sheets via service accounts.
- **Device Permission Manager**: Camera, Geolocation, Bluetooth, Notifications, and Storage permissions.

---

## 👥 User Roles & Access Control Matrix (RBAC)

The application defines five system roles configured inside [permissions.ts](file:///home/dennis/Projects/ISMS/src/utils/permissions.ts):

| Role | Scope | Default Permissions |
|---|---|---|
| **Admin** / **Owner** | Master clearance. Full control over settings, billing, financial profiles, and staff registries. | Overrides all system flags. Full access. |
| **Manager** | Operational management. Oversees sales, stock, staff scheduling, expenses, and analytics. | Business views, settings updates, inventory adjustments, POS sales, customer ledger updates, reports view. |
| **Cashier** | Daily point-of-sale operator. Runs shifts and handles client transactions. | POS sales, shift open/close, customer registration, wallet deposits, cash payments verification, and local chat. |
| **Rider** | Logistics and deliveries. Handles route fulfillment and cash-on-delivery tracking. | Order logs view, delivery zones navigation, route status completion, and local chat. |

---

## 🗄️ Database Schema & Storage Buckets (Supabase)

### Database Tables (PostgreSQL)

1. **`businesses`**: Core tenant definitions (Name, Currency, Country, Timezone, Logo).
2. **`branches`**: Physical locations and distribution hubs linking to a parent business.
3. **`users`**: Master credential directory mapping auth state profiles.
4. **`employees`**: Internal business staff profiles containing active shift identifiers and task listings.
5. **`business_memberships`**: Connects users to businesses with specific roles (`Owner`, `Manager`, `Cashier`, etc.).
6. **`invitations`**: Tracks invitations sent to staff members via unique tokens.
7. **`role_permissions`**: Granular role-to-privilege mappings saved to the database.
8. **`products`**: Catalog containing pricing, fat standardization, stock, and min-stock levels.
9. **`customers`**: Profiles tracking client tier details, wallet deposits, and active credit balances.
10. **`transactions`**: Register tracking checkouts, tax values, delivery options, and sync status flags.
11. **`transaction_items`**: Mapping table connecting purchases to specific product models.
12. **`shifts`**: Punch-clock durations, starting cash, closing cash, and employee metrics.
13. **`inventory_adjustments`**: Reconciliation entries (Damage, Wastage, Restocks).
14. **`expenses`**: Register tracking operational costs (Fuel, Cold Room Electricity).
15. **`suppliers`**: Raw milk cooperative vendor profiles.
16. **`notifications`**: Real-time push notification registries.
17. **`receipt_settings`**: Layout parameters (Paper size, QR integration, custom branding).
18. **`sms_settings` / `ai_settings`**: Third-party configuration credentials.
19. **`google_sheets_backup` / `backup_history_logs`**: Sync details for automated cloud spreadsheet backups.

### Database SQL Views

- **`low_stock_products`**: Instantly filters products falling below their minimum stock thresholds.
- **`active_credit_debts`**: Summarizes customers carrying pending debt balances.
- **`expense_category_summary`**: Aggregates business expenses grouped by category.
- **`product_sales_ranking`**: Ranks products by sales velocity and total revenues.
- **`business_statistics`**: Real-time dashboard view providing metrics on total sales, active shifts, and outstanding debts.

### S3 Storage Buckets

- **`product-images`** (Public): Storing product catalog photographs.
- **`employee-avatars`** (Public): User avatar profile pictures.
- **`business-logos`** (Public): Custom enterprise invoices brand markings.
- **`receipt-exports`** (Private): Exported PDF invoice documents.
- **`expense-receipts`** (Private): Receipts uploaded for operational expenses tracking.

---

## 🛠️ Setup & Local Development Instructions

### 1. Prerequisites
Ensure you have the following installed on your machine:
- **Node.js** (v20+ recommended)
- **Rust Compiler** & **Cargo** (For Tauri desktop builds)
- **Android Studio** & **SDK Command Line Tools** (For Capacitor mobile builds)
- **Supabase CLI** (For backend modifications)

### 2. Environment Configuration
Create a `.env` file in the root directory and define the following variables:
```env
VITE_SUPABASE_URL=your_supabase_project_url
VITE_SUPABASE_ANON_KEY=your_supabase_public_anon_key
VITE_AI_NAME=Kim
VITE_UNSPLASH_ACCESS_KEY=optional_unsplash_api_key
GEMINI_API_KEY=your_google_gemini_api_key
```

### 3. Installation
Install dependencies:
```bash
npm install
```

### 4. Running the Dev Servers

#### Run Web Development Server (Vite)
```bash
npm run dev
```
Serves the web application locally on `http://localhost:3001`.

#### Run Desktop Development Server (Tauri)
```bash
npm run tauri:dev
```
Launches a native desktop window running the hot-reloaded React frontend application.

#### Run Android Emulator (Capacitor)
```bash
npm run android
```
Builds the production web bundle, synchronizes assets to the Android folder, compiles the application, and deploys the debug build to a connected emulator or physical device.

---

## 📦 Production Builds & Compilation

### Desktop Packages (Tauri)
Compile native desktop installers for your host operating system:
```bash
npm run tauri:build
```
- **Windows**: Produces NSIS `.exe` installers and `.msi` system packages.
- **Linux**: Produces portable `.AppImage` files and Debian `.deb` packages.

### Mobile Packages (Capacitor)

We provide an automated local build script and a companion signing utility to generate release packages without needing to manually open Android Studio:

#### 1. Compile Unsigned Release APK
Run the multi-platform local builder script:
```bash
./build-local.sh
```
This builds the production React assets, syncs them to the Capacitor Android project, and compiles the unsigned release APK to `release-builds/android/kaykay-release-unsigned.apk`.

#### 2. Align and Sign the Release APK
To install a release build on real Android devices, it must be aligned and signed. Run the interactive signing utility:
```bash
./sign-apk.sh
```
When prompted:
- **Alias**: Enter your key alias (default is `my-key-alias`).
- **Password**: Enter the decryption password for `my-release.keystore`.

The signed and verified release package will be generated at `release-builds/android/kaykay-release-signed.apk`.

#### 3. Deploy and Install on Phone (No ADB Needed)
To install the APK on your device:
1. **Uninstall the old app**: Long-press the existing app icon on your phone's screen and tap **Uninstall** (this clears signature conflicts from previous debug builds).
2. **Send APK**: Share the signed file `release-builds/android/kaykay-release-signed.apk` to your phone via WhatsApp, Google Drive, email, etc.
3. **Install**: Open your phone's File Manager, locate the APK file, and tap it to install the release version directly.

---

## ☁️ Backend Cloud Deployment (Supabase)

### 1. Link Database Instance
Link your local workspace directory to your remote project reference ID:
```bash
supabase link --project-ref your-supabase-project-reference-id
```

### 2. Push Database Migrations
Apply schemas, enums, triggers, RLS, and storage rules:
```bash
supabase db push
```

### 3. Set Edge Function Secrets
```bash
supabase secrets set GEMINI_API_KEY="your-gemini-key"
supabase secrets set TWILIO_ACCOUNT_SID="your-sid"
supabase secrets set TWILIO_AUTH_TOKEN="your-token"
```

### 4. Deploy Edge Functions
```bash
supabase functions deploy chat
supabase functions deploy twilio-sms
supabase functions deploy mpesa-callback
```
