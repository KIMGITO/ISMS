---
title: ISMS Technical Documentation
short_title: ISMS Technical Documentation (ISMS-TD)
software: KayKay's Integrated Shop Management System (ISMS)
description: Architecture, implementation, integrations, deployment, configuration, reliability and maintenance of the ISMS staff app, customer website, dial-code ordering and Supabase backend.
doc_id: ISMS-TD
version: "1.1"
software_release: "1.0.1"
status: Draft for review
created: 24 November 2026
date: 24 November 2026
classification: Internal: technical
organisation: KayKay's
author: Dennis Kimanthi Gitonga, Codensons
contact: kimanthidennis02@gmail.com; codensons@gmail.com
---

# Document Control

| Item | Value |
|---|---|
| Document title | ISMS Technical Documentation |
| Document identifier | ISMS-TD |
| Version | 1.1 |
| Status | Draft for review |
| Software release described | ISMS 1.0.1 (repository `main`, 24 November 2026) |
| Created | 24 November 2026 |
| Last updated | 24 November 2026 |
| Document owner | Dennis Kimanthi Gitonga, Codensons |
| Contact | kimanthidennis02@gmail.com (developer); codensons@gmail.com (company) |
| Related documents | ISMS-UG System User Guide; ISMS-AG System Administration Guide |
| Source file | `documentation/final/ISMS-Technical-Documentation/ISMS-TD.md` |

# Version History

| Version | Date | Description |
|---|---|---|
| 1.1 | 24 November 2026 | Document owner named (Dennis Kimanthi Gitonga, Codensons). Updated for the owner's decisions: the audit trail, sales, stock history and points used can no longer be deleted; one receipt number format (`TXN-`) everywhere; points settings only on Promotions & Points; Report a problem needs the `support.report` permission. |
| 1.0 | 24 November 2026 | First issue. Restructured from `docs/SYSTEM_DOCUMENTATION.md` (1.0.0) with the release, hosting, integration, notification, performance, testing and phase documents. Counts, schedules, update flow and version-code formula re-verified against the code. |

# Table of Contents

<!-- TOC -->

# List of Figures

<!-- LIST OF FIGURES -->

# List of Tables

<!-- LIST OF TABLES -->

# Part I: Technical Overview

# Chapter 1: Introduction

## 1.1 Purpose

This document describes how ISMS is built and how to develop, deploy, configure and maintain it. It is the technical reference for the system; how to use the screens is in ISMS-UG, and administrative duties are in ISMS-AG.

## 1.2 Scope

ISMS is one Supabase project with four ways in: the staff app (Android, Windows, Linux and web), the customer website, the supplier view of the staff app, and dial-code (USSD) ordering. This document covers all four and the backend that serves them, at release 1.0.1.

## 1.3 Audience

Developers joining the project, and technical staff who deploy, operate or audit the system.

## 1.4 Conventions

**Table 1.1:** Conventions

| Convention | Meaning |
|---|---|
| `code` | File paths, tables, functions, commands, environment variables |
| **Bold** | Screens, tabs and buttons as named in the app |
| Times | Scheduled jobs in UTC; business days and reports in Nairobi time (UTC+3) |
| Money | Kenyan shillings, `numeric(14,2)`, always shown with two decimals |
| Owner | Includes Admin unless a section says otherwise |
| `<project-ref>` | The Supabase project reference (real identifiers are not reproduced) |

## 1.5 Verification basis

Statements in this document were checked against the repository on 24 November 2026: `package.json`, `src/`, `supabase/migrations/` (32 files), `supabase/functions/` (27 functions), `.github/workflows/` and `scripts/`. The live migration history was read (read-only) and lists the first 31 migrations as applied; `20261203001` was added afterwards and is not yet on live. Where a statement could not be verified, it is marked as requiring confirmation. The audit trail of this restructuring is in `documentation/audit/`.

# Chapter 2: System Architecture

## 2.1 System context

![Figure 2.1: System context: who uses ISMS and which external systems it exchanges data with](diagrams/system-context.svg)

[Figure 2.1](#f-2-1) shows the people and systems around ISMS. No server of the project's own is needed: payment providers, the USSD gateway and the database's own webhooks call Supabase edge functions directly.

**Table 2.1:** The parts of ISMS

| Part | Users | Runs on | Built from |
|---|---|---|---|
| Staff app | Owners, admins, managers, cashiers, riders | Android (Capacitor), Windows and Linux (Tauri), web (Cloudflare Workers) | `src/`, `android/`, `src-tauri/` |
| Customer website | Customers | Cloudflare Workers, blue-green | `website/` |
| Supplier view | Suppliers | The staff app, separate shell | `src/features/SupplierPortalView.tsx` |
| Dial-code ordering | Customers on basic phones | Africa's Talking calling an edge function | `supabase/functions/ussd/` |
| Backend | All of the above | Supabase: PostgreSQL 17, Auth, Storage, Realtime, Edge Functions, `pg_cron` | `supabase/` |

## 2.2 Logical architecture

![Figure 2.2: Logical architecture: clients, Supabase services and the database layer](diagrams/architecture.svg)

Clients reach the database through PostgREST (tables and RPC), subscribe to changes through Realtime, store files in Storage, and call edge functions for work that needs secrets or outside providers ([Figure 2.2](#f-2-2)).

## 2.3 Design principles

1. **The database is the authority.** Prices, stock, points, balances and permissions are calculated and checked in PostgreSQL. The app hides what a role may not use; the database refuses it regardless.
2. **Money moves through functions, not table writes.** Sales, top-ups, debt payments, point redemptions and payment results go through `SECURITY DEFINER` functions that check the caller and update every affected balance in one transaction.
3. **One record drives every figure.** The same row moves the payment balance (`money_assets`), posts to the books (`acc_post_source`) and feeds every report ([Section 10.1](#s-10-1)).
4. **Nothing financial is deleted, and the audit trail is append-only.** Payments and expenses are voided with a reason; sales are refunded with credit notes. Nobody signed in can delete a sale (no DELETE grant or policy on `transactions`), and `trg_audit_logs_append_only` refuses every delete or edit of `audit_logs` (`20261203001`).
5. **Real time across devices.** Changes reach every open device through Realtime.
6. **Keep selling when the network drops.** Paid sales made offline are queued and sent when the connection returns.
7. **Secrets stay on the server.** Provider keys live in Supabase secrets or server-only tables; the app sees masked values.

# Chapter 3: Technology Stack

**Table 3.1:** Technology stack

| Layer | Technology | Notes |
|---|---|---|
| UI | React 19, TypeScript 5.8 | Single-page app |
| Build | Vite 6 | Staff app on port 3001; website on 5180 |
| Styling | Tailwind CSS 4 | Staff styles in `src/index.css`; website look in `website/src/theme.css` |
| State | Zustand 5 | One store per domain, combined in `appStore.ts` |
| Charts | Recharts 3 | Home and reports |
| Animation | Motion 12 | |
| Icons | lucide-react | |
| PDF and QR | jsPDF 4, qrcode | Receipts, invoices, exports |
| Backend | Supabase (PostgreSQL 17) | Row-level security on every table |
| Server code | Deno edge functions | One folder per function; shared helpers in `functions/shared/` |
| Scheduling | `pg_cron`, `pg_net` | [Section 11.12](#s-11-12) |
| Desktop | Tauri 2 (Rust) | Windows `.exe`/`.msi`, Linux AppImage/`.deb`; updater plugin |
| Mobile | Capacitor 8 | Android; Java plugins for Bluetooth printing and updates |
| Push | Firebase Cloud Messaging | Through `send-fcm` |
| Payments | Safaricom Daraja, Airtel Africa, Paystack | M-Pesa prompts and till; Airtel Money prompts; cards |
| USSD | Africa's Talking | |
| Web hosting | Cloudflare Workers (static assets), R2 | Web app and website; backup storage |
| CI/CD | GitHub Actions | [Section 15.3](#s-15-3) |
| Alerts | Telegram bot | Through `ops-alert` |

**Version pinning.** The Tauri npm packages (`@tauri-apps/api` and plugins) must stay on the same minor version as the Rust crates in `src-tauri/Cargo.toml`, or `tauri build` fails; `package.json` pins them. CI pins the Rust toolchain because a newer Rust breaks the ONNX runtime crate on Windows.

# Chapter 4: Application Structure

## 4.1 Repository layout

```text
ISMS/
├── src/                  Staff app (React)
│   ├── App.tsx           Shell, navigation, onboarding, screen routing
│   ├── components/       Shared widgets (shared/, receipts/, invoices/, loyalty/, payments/ ...)
│   ├── features/         One file per screen (33 views, plus home/)
│   ├── core/native/      Platform adapters: Bluetooth, camera, files, printer, updates ...
│   ├── hooks/            useForm, useOverlay, useDevicePermission ...
│   ├── services/         Supabase client, repositories, receipt/, printer/, offline/, upload/ ...
│   ├── stores/           Zustand stores
│   ├── utils/            permissions.ts, screens.ts, shortcuts.ts, money.ts, mobileNav.ts ...
│   └── test/runTests.ts  Unit tests (npm test)
├── website/              Customer website (separate Vite build, prerendered)
├── supabase/
│   ├── migrations/       32 SQL migrations (Appendix B)
│   ├── functions/        27 edge functions + shared/
│   ├── tests/            Database test suites (see 21.2)
│   ├── seed_quick.sql    Test data
│   └── dev_wipe.sql      Empties every table (guarded)
├── android/              Capacitor Android project and Java plugins
├── src-tauri/            Tauri desktop shell (Rust)
├── scripts/              Release, deploy, database push, backup and check scripts
├── .github/workflows/    8 workflows (see 15.3)
├── docs/                 Working documents, reports and plans
└── documentation/        This documentation set, its sources and build tools
```

## 4.2 npm scripts

**Table 4.1:** npm scripts

| Command | What it does |
|---|---|
| `npm run dev` | Staff app in the browser at `http://localhost:3001` |
| `npm run tauri:dev` | Staff app in a desktop window with hot reload |
| `npm run android` | Build, sync to Android and assemble a debug APK |
| `npm run build` | Production web bundle in `dist/` |
| `npm run tauri:build` | Desktop installers for the current operating system |
| `npm run lint` | TypeScript check of the staff app |
| `npm test` | Unit tests (`src/test/runTests.ts`) |
| `npm run website:dev` / `website:build` / `website:lint` | Website development, build with prerender, type check |
| `npm run app:deploy` / `website:deploy` | Blue-green deploy to Cloudflare |
| `npm run sounds:sync` | Copy notification sounds into the Android project |

## 4.3 Scripts

**Table 4.2:** Operational scripts in `scripts/`

| Script | Purpose |
|---|---|
| `db-push.sh` | The only way to apply migrations to live ([Section 15.4](#s-15-4)) |
| `check-live-grants.sh` | Read-only check of live function and table grants |
| `check-migrations.mjs` | Migration naming, ordering and destructive-change rules |
| `run-db-tests.sh` | Builds a test database once and runs every database suite |
| `db-backup.sh` | List, download, open and restore encrypted backups |
| `deploy-web.sh`, `prepare-cloudflare.mjs`, `smoke-test-web.mjs` | Blue-green web deploy and its checks |
| `release-version.mjs`, `update-manifest.mjs`, `verify-update-manifest.mjs`, `stamp-version.mjs`, `app-version.mjs` | Versions, update manifest and its verification |
| `perf/` | Repeatable query timings and load tests |

# Chapter 5: Development Environment

## 5.1 Prerequisites

- Node.js 22 (CI uses 22).
- Rust and Cargo, for desktop builds; on Linux, the WebKitGTK packages Tauri needs (`scripts/install-linux-deps.sh`).
- Java 21 and the Android SDK, for Android builds.
- Supabase CLI and Docker, for database work and tests.

## 5.2 Configuration

Copy `.env.example` to `.env` and set at least `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_AI_NAME` and `VITE_WEBSITE_SLUG`. Only `VITE_` variables reach the browser; server secrets are set with `supabase secrets set` ([Chapter 16](#ch-16)).

> **Warning:** The development `.env` points at the live database (finding REL-01). Anything saved while testing locally (sales, clock-ins, stock changes) is written to live. Run destructive scripts only against a local database until a staging project exists.

## 5.3 Running

```bash
npm install
npm run dev          # staff app, http://localhost:3001
npm run tauri:dev    # staff app in a desktop window
npm run website:dev  # customer website, http://localhost:5180
npm run android      # debug APK on a connected device or emulator
```

## 5.4 Before committing

Run `npm run lint`, `npm run website:lint` and `npm test`. CI runs the same checks. A local type check can pass where CI fails if React types are installed higher up the folder tree (for example in `~/node_modules`); check suspicious results in a copy outside the home folder.

# Part II: Application Implementation

# Chapter 6: Frontend Architecture

## 6.1 Layers

![Figure 6.1: Staff app layers; arrows point to the layer depended on](diagrams/frontend-layers.svg)

**Table 6.1:** Frontend layers

| Layer | Folder | Responsibility |
|---|---|---|
| Shell | `App.tsx` | Sign-in screens, navigation, routing, onboarding, guarded screens |
| Screens | `features/` | One view per screen |
| Shared widgets | `components/` | Forms, sheets, receipts, invoices, search, payment panels |
| State | `stores/` | Zustand stores per domain, combined by `appStore.ts` |
| Services | `services/` | Repositories, Supabase calls, receipt and printer, offline outbox, realtime, uploads, crash reporter |
| Platform | `core/native/` | One interface per device feature for Android, desktop and browser |

## 6.2 Stores

**Table 6.2:** Zustand stores

| Store | Responsibility |
|---|---|
| `authStore` | Sign-in, sign-up, onboarding, memberships, current employee, shifts |
| `businessStore` | Businesses, branches, switching, settings |
| `cartStore` | The sale being built |
| `transactionStore` | Completed sales and their sync state; offline sync |
| `inventoryStore` | Products, categories, adjustments |
| `customerStore` | Customers, wallets, debts, points |
| `extraModulesStore` | Purchases, production, recipes, assets, audit logs, expenses |
| `notificationStore` | Inbox, unread counts, toasts, reminders |
| `pendingActionStore` | Assistant-proposed actions awaiting approval |
| `uiStore`, `overlayStore` | Active screen, modals, chat history |
| `updateStore` | Update state on the About page |
| `systemHealthStore` | Connection and service health |

## 6.3 Screen map

Screens, groups, descriptions, search keywords and permissions are defined once in `src/utils/screens.ts` (`SCREEN_BY_ID`). The sidebar and the phone menu read titles and descriptions from it. Keyboard shortcuts are in `src/utils/shortcuts.ts`; the phone bottom bar order in `src/utils/mobileNav.ts`. `App.tsx` renders the screen whose id matches `activeTab`, wrapped in `SecurityGuard` with the same permissions.

**Table 6.3:** Screen map

| Id | Group | Title | Component | Permission (any of) |
|---|---|---|---|---|
| `home` | Reports | Home | `HomeView` | `home.view` |
| `sell` | Selling | Quick Sale | `QuickSaleView` | `pos.create_sale` |
| `pos` | Selling | POS | `POSView` | `pos.create_sale` |
| `sales` | Selling | Sales Log | `SalesView` | `orders.view` |
| `online-store` | Selling | Online Store | `OnlineStoreView` | `online_store.view` |
| `prompt` | Selling | Payment Prompts | `PaymentPromptView` | `payments.mpesa`, `payments.airtel` |
| `customers` | Customers | Customers | `CustomersView` | `customers.view` |
| `promotions` | Customers | Promotions & Points | `PromotionsView` | `promotions.*`, `referrals.*`, `loyalty.view`, `loyalty.configure`, `customers.loyalty` |
| `regular-orders` | Customers | Regular Orders | `RegularOrdersView` | `customers.view`, `customers.schedules`, `pos.create_sale` |
| `feedback` | Customers | Feedback | `CustomerFeedbackView` | `complaints.view` |
| `inventory` | Stock | Inventory | `InventoryView` | `inventory.view` |
| `stock-history` | Stock | Stock History | `StockHistoryView` | `inventory.stock_history` |
| `stock-transfers` | Stock | Stock Transfers | `StockTransfersView` | `inventory.transfer_stock`, `receive_stock`, `request_transfer` |
| `production` | Stock | Production & BOM | `ProductionBOMView` | `bom.view` |
| `buying` | Buying & deliveries | Buying | `BuyingView` | `suppliers.view`, `purchases.*`, `supplier_bills.manage` |
| `deliveries` | Buying & deliveries | Deliveries | `RiderDeliveriesView` | `deliveries.view` |
| `money` | Money | Payments & Expenses | `BusinessManagementView` (money section) | `payments.*`, `expenses.view`, `expenses.create` |
| `petty-cash` | Money | Petty Cash | `PettyCashView` | `pettycash.record` |
| `finance` | Money | Finance & Accounting | `AccountingView` | `finance.view`, `accounting.view` |
| `stock-report` | Reports | Stock Report | `StockReportView` | `reports.*`, `inventory.stock_history`, `finance.view` |
| `dashboard` | Team | Shift | `DashboardView` | `dashboard.view` |
| `workers` | Team | Workers | `WorkersView` | `staff.view` |
| `permissions` | Admin | Roles | `PermissionsView` | `staff.roles` |
| `audit` | Admin | Audit Log | `AuditLogView` | `audit.view` |
| `business-management` | Admin | Business Management | `BusinessManagementView` | `business.update` |
| `settings` | Admin | Settings | `SettingsView` | `settings.view` |
| `ai` | You & the app | Assistant | `WorkspaceAssistantView` | `ai.use` |
| `notifications` | You & the app | Notifications | `NotificationsView` | none |
| `profile` | You & the app | My Profile | `ProfileView` | none |
| `about` | You & the app | About this app | `AboutView` | none |

**Aliases.** Old ids `accounting` → `finance` and `suppliers` → `buying` still work through `SCREEN_ALIASES`. Removed screens (`invoicing`, `assets`) redirect: quotes live in POS and Sales Log, invoices on the customer's page.

**Supplier view.** A signed-in user with a `supplier_accounts` row and no staff membership gets `SupplierPortalView` instead of the staff shell. Suppliers are never in `business_memberships`, so `has_permission` never opens staff data to them.

## 6.4 Shared components and UI rules

- Every number box is `NumberInput`; quantities use `decimals={QTY_DECIMALS}`. Money is shown with `formatMoney` / `formatCurrency` from `src/utils/money.ts`, never `toFixed` or `toLocaleString`.
- Forms that open over a screen use `FormSheet` (`components/shared/FormSheet.tsx`): a bottom sheet on phones, a centred card with a fixed footer on desktop.
- Lists with delete use `SwipeRow`; grouped tabs use `GroupedTabs`. No native `<select>` or checkbox in `src/`.
- The draggable assistant button (`FloatingButton`) shows a short motion hint for its first seconds on a page.
- Container queries (`@container`, `@md:`) adapt panels such as receipt settings to their own width.

## 6.5 Real time

`realtimeService.ts` subscribes to Supabase Realtime for the current business. When a row changes on another device, the relevant store updates. Only tables a screen follows are in the `supabase_realtime` publication (`20261201006`).

## 6.6 Offline sales

![Figure 6.2: Offline sales outbox](diagrams/offline-outbox.svg)

`networkService.ts` tracks connectivity. **Paid sales** (cash, card, and M-Pesa with a typed code) made offline are queued on the device (`src/services/offline/salesOutbox.ts`, local storage key `kaykays.offline.sales.v1`) with status `Offline_Pending`. `transactionStore.syncOfflineSales` sends them on reconnect and at start-up ([Figure 6.2](#f-6-2)).

- **Safe to replay.** A unique index on `(business_id, reference_id)` means a sale sent twice is saved once.
- **Online only:** credit sales, live prompts, promotion codes, and every non-sale change.
- **On screen:** offline items are rose red with a cloud icon, not error red; the Sales Log tags them **Waiting to sync**.
- Prices, stock and totals are re-checked when the sale arrives; KRA signing happens then.

## 6.7 Platform layer and errors

`src/core/native/` wraps Bluetooth, camera, device info, files, geolocation, notifications, permissions, printer, secure storage, share, splash screen, status bar and updates. `utils/userError.ts` (`toUserMessage`) turns technical errors into plain sentences, so staff never see stack traces or SQL.

## 6.8 Customer website

The website (`website/`) is a separate Vite build sharing only the Supabase project. Routes: `/`, `/shop`, `/products/…`, `/cart`, `/articles/…`, `/feedback`, `/contact`, `/account`, plus info pages such as `/terms` and `/privacy`. `website/src/seo.ts` holds titles, descriptions and structured data; `scripts/prerender.ts` writes one HTML file per public page so search engines and link previews see real content. Until `VITE_SITE_URL` is set, every page asks search engines not to index it. `website/src/theme.css` holds the look.

# Chapter 7: Backend Architecture

## 7.1 Components

**Table 7.1:** Backend components

| Component | Role |
|---|---|
| PostgreSQL 17 | All data; business rules in functions and triggers; row-level security |
| PostgREST | Table and RPC API used by both apps |
| Auth | Email sign-in, OAuth for the website, sessions (JWT) |
| Realtime | Change streams to open apps |
| Storage | Six buckets ([Chapter 14](#ch-14)) |
| Edge functions | 27 Deno functions for secrets, providers, AI and alerts ([Chapter 13](#ch-13)) |
| `pg_cron`, `pg_net` | 13 scheduled jobs; calls from the database to edge functions |
| Vault | `project_url`, `service_role_key` (and the push webhook secret) for database-initiated calls |

## 7.2 Shared edge-function helpers

`supabase/functions/shared/` provides CORS handling, the caller's identity, `requirePermission()` (permission codes, never role names), `enforceRateLimit()`, body-size caps, constant-time token comparison and the AI runner.

# Chapter 8: Database Architecture

## 8.1 Tenancy

Every business table carries `business_id`. Row-level security lets a signed-in person reach only rows of businesses they are an active member of (`get_user_business_ids`, `assert_business_member`). Functions acting on a business check membership and permission first (`assert_permission`, `has_permission`), with a per-request permission cache (`20261201005`).

## 8.2 Size

The migrations create 145 tables and 14 views in the `public` schema.

## 8.3 Tables by area

**Table 8.1:** Main tables by area

| Area | Tables |
|---|---|
| Identity and access | `businesses`, `branches`, `users`, `employees`, `business_memberships`, `invitations`, `role_permissions`, `role_default_permissions`, `otps`, `rate_limits`, `supplier_accounts`, `security_events` |
| Products and stock | `products`, `product_categories`, `inventory_adjustments`, `suppliers`, `purchases`, `purchase_items`, `stock_transfers`, `stock_transfer_items`, `supplier_stock_requests` |
| Production | `recipes`, `recipe_ingredients`, `bill_of_materials`, `bom_ingredients`, `production_batches` |
| Sales | `transactions`, `transaction_items`, `offline_sync_queue`, `receipt_verifications`, `kra_etims_receipts`, `kra_etims_items`, `quotes`, `quote_lines`, `sales_orders`, `sales_order_lines`, `sales_deliveries`, `sales_delivery_lines`, `sales_invoices`, `sales_invoice_lines`, `invoice_payments`, `credit_notes`, `credit_note_lines`, `doc_counters` |
| Customers | `customers`, `customer_ledger`, `wallet_transactions`, `debt_payments`, `credit_payments`, `loyalty_settings`, `loyalty_redemptions`, `loyalty_points_earned`, `customer_merges`, `customer_duplicate_dismissals`, `invoices`, `invoice_counters`, `regular_orders`, `regular_order_days`, `regular_order_settings`, `message_variables` |
| Money | `payments`, `money_assets`, `payment_asset_ledger`, `expenses`, `expense_categories`, `petty_cash_categories`, `rider_pay_links`, `business_assets`, `card_payments`, `card_payment_settings`, `card_payment_secrets`, `airtel_transactions`, `airtel_payment_settings`, `airtel_payment_secrets` |
| M-Pesa | `mpesa_settings`, `mpesa_transactions`, `mpesa_till_payments` |
| Online store | `customer_accounts`, `online_orders`, `online_order_items`, `customer_order_schedules`, `customer_messages`, `delivery_zones`, `delivery_trips`, `website_settings`, `website_articles`, `website_reviews`, `website_product_ideas`, `website_product_idea_votes`, `assistant_usage`, `customer_account_stores` |
| Books | `acc_accounts`, `acc_entries`, `acc_lines`, `acc_settings`, `acc_post_errors`, `acc_reconciliations` |
| Buying | `buying_settings`, `purchase_approval_limits`, `purchase_quotes`, `purchase_quote_lines`, `purchase_receipts`, `purchase_receipt_lines`, `supplier_bills`, `supplier_payments`, `supplier_returns`, `supplier_return_lines` |
| Promotions | `website_promo_codes` (all promotions), `promotion_products`, `promotion_categories`, `promotion_customers`, `promotion_branches`, `promotion_redemptions`, `referral_campaigns`, `referral_codes`, `referrals`, `referral_rewards` |
| Staff, notifications, feedback | `shifts`, `schedules`, `notifications`, `notification_preferences`, `device_fcm_tokens`, `complaints`, `complaint_replies` |
| Settings | `receipt_settings`, `printer_settings`, `sms_settings`, `whatsapp_settings`, `ai_settings`, `integration_configurations`, `kra_etims_settings`, `kra_etims_secrets` (server only) |
| Logs and operations | `audit_logs`, `ai_insights`, `dashboard_analytics_snapshots`, `scheduled_reports`, `report_tracked_items`, `crash_reports`, `problem_reports`, `ops_watchdog_config`, `ops_watchdog_state`, `app_data_conversions`, `google_sheets_backup`, `backup_history_logs`, `storage_files` |

## 8.4 Enumerated types

**Table 8.2:** Enumerated types

| Type | Values |
|---|---|
| `membership_status` | Active, Pending, Suspended |
| `invitation_status` | Pending, Accepted, Expired, Revoked |
| `customer_tier` | Bronze, Silver, Gold |
| `transaction_status` | Synced, Offline_Pending |
| `inventory_adjustment_type` | Restock, Damage, Reconciliation |
| `shift_status` | Active, Closed |
| `mpesa_status` | Pending, Completed, Failed |
| `notification_priority` | low, medium, high, critical |

## 8.5 Views

`v_active_customers`, `v_active_products`, `v_active_shifts`, `v_customer_ledger_detail`, `v_daily_sales_summary`, `v_expense_summary`, `v_low_stock_products`, `v_open_debts`, `v_pending_invitations`, `v_product_sales_rank`, `v_team_members`, `v_transaction_summary`, `v_unread_notifications`, `v_upcoming_schedules`.

## 8.6 Migrations

On 16 November 2026 the 82 older migration files were squashed into `20261120001_schema` and `20261120002_platform_and_defaults`, and the live database was reset onto them. Later changes are numbered from `20261121001`. The full list is in [Appendix B](#app-b). Add a new migration for every change; never edit one that has been applied.

# Chapter 9: Authentication and Authorization

## 9.1 Sign-in

Staff sign in with email and password through Supabase Auth. Codes for email verification and password reset are issued and checked only by the `auth-otp` function: six digits with rejection sampling (all 900,000 equally likely), stored server-side, limited to 30 per 10 minutes per IP, 15 per hour per email and 5 wrong guesses per code. A reset looks up only the real login email.

## 9.2 Verified email and invitations

Only `users.verified_email`, set by the server's sign-up and reset codes, counts as verified. An unverified user can only claim an invitation, which completes after the email is confirmed; an invitation can only be accepted by the account whose login email it was sent to. Only the system creator can create a business (`20261128003`). Revoking an invitation removes the invite and any orphan sign-up (`20261129001`).

## 9.3 Three layers of authorization

**Table 9.1:** Where permissions are enforced

| Layer | What it does | Where |
|---|---|---|
| App | Hides screens and buttons | `SYSTEM_ROLES` in `src/utils/permissions.ts`; screen permissions in `src/utils/screens.ts` |
| Database | Refuses rows and functions, even for direct API calls | `has_permission()` in RLS and functions (`20261130006`), cached per request (`20261201005`) |
| Edge functions | Refuse the call before paid or sensitive work | `requirePermission()` in `supabase/functions/shared/` |

Business overrides are saved in `role_permissions`, which all three read. The defaults are `SYSTEM_ROLES` and `role_default_permissions`, which a unit test keeps identical. Owner and Admin hold every permission. The role matrix is in ISMS-AG Chapter 3; the 188 permission codes are in [Appendix A](#app-a).

## 9.4 Sessions

Sign-out revokes the session on the server; a pre-request check refuses tokens of sessions that signed out (`20261128002`).

## 9.5 Function grants

Execute rights are revoked from `PUBLIC` and granted explicitly (`20261201001`, finding SEC-01). Service-only functions are granted to `service_role` alone. A new table with a policy also needs its `GRANT` to `authenticated`, or nobody can read it. `scripts/check-live-grants.sh` checks the live grants after every push; `supabase/tests/permissions/permissions_test.sh` checks both the grants and the role matrix.

## 9.6 Rate limits

Enforced by `enforceRateLimit` (backed by `rate_limits` and `check_rate_limit`).

**Table 9.2:** Rate limits

| Action | Limit |
|---|---|
| AI (chat, complaints, analysis) | 20 per minute per person; 500 per day per business |
| Sign-in codes | 30 per 10 minutes per IP; 15 per hour per email; 5 wrong guesses per code |
| Email | 30 per hour per person |
| SMS, WhatsApp | 200 per hour per person; 1,000 per day per business |
| M-Pesa prompts (staff) | 60 per hour per person; 600 per day per business |
| Website checkout | 6 per 10 minutes per customer |
| Dial code | 40 per 10 minutes per phone |
| Problem reports | 10 per hour per person |

Promotion code checks are also rate limited so codes cannot be guessed; refused calls to public functions are written to `security_events` (`20261201004`).

## 9.7 Inbound provider calls

Safaricom, Airtel and Africa's Talking cannot sign in, so their callbacks require a secret token in the URL, compared in constant time; Paystack webhooks are verified by signature. Treat the callback URLs as passwords.

# Chapter 10: Data Relationships and Integrity

## 10.1 Money and number rules

These rules are set by the owner and every change must keep them:

1. **Every money movement is recorded.** Sales, refunds, debt payments, wallet top-ups, supplier payments, rider pay, petty cash, expenses and wages each have a row. No screen shows money with no record behind it.
2. **The books and the figures on screen agree.** The same row moves the balance (`money_assets`), posts to the books (`acc_post_source`) and is what Home, Finance, shift reports and lists add up. Never compute a money figure from a second source that can drift.
3. **New kinds of money movement reuse an existing record type** (expense, supplier payment, customer ledger, sale) or add a new `acc_post_source` source type in the same change. A money feature is not done until its books entry and balance are checked on a test database (debits equal credits; balance moved by the same amount).
4. **Changing a money record never breaks the link.** Undo by soft-deleting (which reverses balance and books) and recording again; block edits that would make linked records disagree.
5. **The payee does not need an account.** Record their name so the payment is traceable.
6. **Money has two decimals**, stored (`numeric(14,2)`) and shown; use `formatMoney`, `formatCurrency` and `roundMoney`. **Quantities have at most one decimal** (`numeric(p,1)`, `20261130007`). Recipes state amounts per batch.

Example: rider pay is spending on the day it is owed (books: Rider pay / We owe riders, source `rider_pay`). Paying later is one `expenses` row with `rider_payment = true`, which moves money and clears the debt without being counted as spending again. Profit figures read `fn_spending()` (server) or `spendingWithRiderPay()` (app); cash figures read the raw expenses.

## 10.2 What happens when a sale is saved

![Figure 10.1: Data flow when a till sale is completed](diagrams/sale-dataflow.svg)

Paid till sales go through `record_till_sale` in one request (finding FIN-02); credit sales through `process_customer_transaction`. The sale, its lines, any points spent and any promotion use are saved in one database transaction ([Figure 10.1](#f-10-1)). Then:

1. `fn_process_completed_transaction` adds points (`fn_sale_points`: 2 per KSh paid, delivery excluded), one purchase, the sale to the employee's open shift, the paid part to the method's money asset with a ledger line, and any unpaid part of a credit sale as debt (wallet first).
2. `fn_process_transaction_item` reduces stock per line (logged in `inventory_adjustments`); `fn_check_low_stock` raises notifications, including the suggested supplier.
3. A deferred trigger posts the sale to the books through `acc_post_source('sale', …)`: sales, promotion discounts, cost of goods, money or receivables, and rider pay owed.
4. A sale whose totals do not equal its lines is refused (`20261201002`).

**Undo** is never a delete: `create_credit_note` refunds (stock back, money, wallet or debt settled, books reversed). Every change to a sale or its lines is logged in `audit_logs` by `trg_audit_sale_change`.

## 10.3 Balance guards

- `fn_guard_customer_balances` refuses direct changes to customer balances unless they come through the proper function or an Owner or Manager adjusting by hand.
- `DELETE` is revoked on payment tables; payments are voided with who, when and why, reversing the money asset.
- Hard deletes on products are trapped.
- Merged customers: new sales from a stale device move to the kept record (`fn_redirect_merged_customer`); its balance changes are refused until it refreshes (`fn_block_merged_customer_balances`).

## 10.4 Readable references

Text people read never carries raw database IDs. Sales are named by receipt number (`fn_receipt_number`: `TXN-` and the first 8 characters of the sale id, the same in the app, on printed receipts, in logs and in the books; `formatReceiptNo` in the app returns the same). Other records carry `ref_no` values (`EXP-`, `STM-`, `LOG-`, `LDG-`, `20261202001`) and document numbers (`INV-`, `QT-`, `CN-`, `GRN-`, `BILL-`, `RTS-`, `JE-`). Customer names are stored with each word capitalised (`fn_capitalize_words`).

# Chapter 11: Application Services and Business Logic

## 11.1 Feature dependencies

The four core flows are selling (POS, Quick Sale, website, dial code), getting paid (methods, prompts, till queue, wallet, credit, points), stock (adjustments, purchases, transfers, production) and the books, which every other flow posts to. Features merged into one place on 16 November 2026: Finance with Accounting, Buying with Suppliers; quotes moved into POS and Sales Log; invoices onto the customer's page; suppliers are invited from Workers.

## 11.2 Accounting

Double-entry books are posted automatically by `acc_post_source` for every sale, refund, payment, expense, purchase, stock change, transfer, promotion and referral reward. Posting errors are kept in `acc_post_errors`. Reconciliation records (counts of money and stock) are in `acc_reconciliations`. Locked months redirect later changes into the open month. `acc_rebuild_start` rebuilds the books from the source records.

## 11.3 Payments

**Table 11.1:** Payment methods and their effect

| Method | Effect |
|---|---|
| Cash, M-Pesa, Airtel Money, Card, Bank | Added to that method's money asset. Each can be switched off per business (`businesses.default_payment_methods`, `payments.configure`); an off method is hidden and its prompts or charges are refused server-side |
| Mobile Wallet | Taken from the customer's wallet |
| Credit | Added to the customer's debt; no money asset changes until repaid |
| Points | Taken from the customer's points at the tier value; a discount |

Each money asset keeps a running balance per business and method; every change is written to `payment_asset_ledger` with the balance before and after. Expenses reduce the asset they were paid from.

![Figure 11.1: Life cycle of a direct till (C2B) payment](diagrams/till-payments.svg)

**M-Pesa till.** A payment sent to the till from the customer's own phone carries no account number. `till-callback` records it with `record_till_payment`; it waits as **unclaimed** until staff resolve it with `handle_till_payment` ([Figure 11.1](#f-11-1)). Prompts sent by staff are matched by CheckoutRequestID and recorded through `process_business_payment` (debt first, then wallet, or walk-in). Every customer has an account number from 100001, sent as the account reference on prompts.

## 11.4 Customers, points and tiers

**Table 11.2:** Points rule (`20261108002`)

| Event | Points |
|---|---|
| Paid sale to a registered customer | 2 per KSh 1 of goods; delivery excluded |
| Credit sale | None when made |
| Debt repaid | 1 per KSh 1 (`fn_debt_payment_points`) |
| Walk-in sale | None, unless a customer is attached later (`attach_sale_to_customer`) |

Point values by tier are stored in `loyalty_settings` (`value_bronze`, `value_silver`, `value_gold`: 50, 100 and 200 points per KSh 1) and read through `fn_point_value()`; the app's copy is `src/services/loyalty/pointValue.ts`, kept equal by a test. The minimum to redeem is 100 points. Tiers (Bronze from KSh 0, Silver from KSh 10,000, Gold from KSh 30,000 spent) are set by `calculate_customer_tier` and only ever raised automatically. Points never become money: they come off a price (`spend_points_at_till`) or pay debt on the customer's page; debt paid with points is taken off profit. Points can be switched off per business.

**Attaching a customer later.** Cashiers (`pos.create_sale`) for their own paid sales from the last 24 hours; managers (`orders.update` or `customers.loyalty`) for any paid sale from the last 30 days. Once set, the customer cannot be swapped.

## 11.5 Wallets, debts and invoices

Wallet deposits (`process_wallet_topup`) pay any debt first; spending uses `process_wallet_spend`. Debt repayments (`process_debt_payment`) clear the oldest debts first (`settle_customer_debt_fifo`). Invoices (`issue_invoice`) list unpaid credit sales at the price sold, numbered per business.

**Duplicate customers** are never linked automatically, because a phone number typed at sign-up is not proof of identity. `find_duplicate_customers` lists candidates; `merge_customers` adds debts, wallets, points and purchases together, moves sales, payments, ledger and logins to the kept record, keeps the higher tier, and records both records in `customer_merges`. There is no undo.

## 11.6 Promotions and referrals

All promotions live in `website_promo_codes` (`origin` = `manual`, `referral_welcome` or `referral_reward`). At the till: `promo_check` → `promo_reserve` (a 20-minute hold, discount worked out on the server) → the sale is saved with `promotion_redemption_id` in one transaction → a deferred trigger recomputes from the saved lines and refuses the sale on any mismatch → `promo_release` on failure. Sales with a code never go to the offline outbox. Books: promotion discounts to account 4050; wallet referral rewards post source `referral_reward`. Referral rewards are idempotent and paid by `run_referral_jobs` after a wait; flagged ones wait for a manager.

## 11.7 Regular orders

`regular_orders` holds customer, product and `day_qty[7]` (Sunday to Saturday); `regular_order_days` holds one-day changes, skips and deliveries. The tables have no direct grants: everything goes through RPCs. `deliver_regular_orders` makes one sale per customer through `process_customer_transaction` (wallet first, then debt). Undo is a credit note; a trigger puts the day back to due. Website requests (`request_regular_order`) need `customers.manage` to approve.

## 11.8 Inventory, buying, transfers and production

**Table 11.3:** Stock movements

| Movement | Recorded in | Effect |
|---|---|---|
| Sale | `transaction_items` | Stock down |
| Restock, damage, count | `inventory_adjustments` (Restock, Damage, Reconciliation) | Up, down, set |
| Purchase received | `purchase_receipts` (`receive_purchase`, `GRN-`) | Up; posts Dr Stock / Cr 2050 goods received not invoiced |
| Transfer | `stock_transfers` | Out at cost to 1210 in transit; in when received |
| Production batch | `production_batches` | Raw materials down, finished goods up |

Purchases move Pending → RFQ → Awaiting approval → Ordered → Part received → Received (or Cancelled); `fn_purchase_guard` turns an "Ordered" save above the role's `purchase_approval_limits` into "Awaiting approval". Supplier bills (`BILL-`) clear goods received with input VAT and price differences; returns (`RTS-`) reverse them. Transfers need both branches to share an active owner; shortages are settled as late, found or written off. Production batches are created, completed and cancelled atomically (`fn_create_production_batch`, `fn_complete_production_batch`, `fn_cancel_production_batch`). **Ask supplier** (`supplier_stock_requests`, `ask_supplier_for_stock`) rings one chosen supplier.

## 11.9 Deliveries and riders

Open requests are paid or preparing online orders with no rider, and till delivery sales from the last 3 days with no rider. Only the Rider role accepts, first come first served; the customer's phone is hidden until then. Owners and managers with `deliveries.assign` group deliveries into `delivery_trips` with one rider pay. A till sale can name a rider with no account; `fn_rider_owed` keys that as `name:<lowercase>`. Three delivery modes are stored on the sale (`delivery_mode`): on the bill, pay the rider, or free; `rider_pay` is owed on the day (`20261130004`).

## 11.10 Notifications

![Figure 11.2: Notification pipeline from event to device](diagrams/notifications.svg)

1. An event (trigger, database function, scheduled job or the app) inserts a row into `notifications` with type, priority, payload and target ([Figure 11.2](#f-11-2)).
2. `trg_push_new_notification` calls `send-fcm` through `pg_net` with the Vault secrets. Do not also add a dashboard webhook, or every push arrives twice.
3. `send-fcm` asks `fn_notification_recipients` who should get it, honouring `notification_preferences`, and pushes through Firebase to `device_fcm_tokens`; dead tokens are removed.
4. Open apps receive the row through Realtime and show it with a sound and a banner.

`fn_notification_catalog()` is the single list of categories (stock, sales reports, debts, deliveries, payments, online store, AI insights, schedules and announcements, account and security). Account and security alerts cannot be turned off. **Ringing alerts** (reminders, supplier requests, regular orders) are copied to each of the person's phones by `alarm-sync` as native alarms, re-rung by `escalate-unaccepted-alerts` until accepted, and stopped everywhere by `accept-alert`. Android uses the channels `default`, `alerts` and `shifts`.

## 11.11 Receipts and printing

`src/services/receipt/layout.ts` builds a receipt once, as lines, for the preview, ESC/POS print, PDF and WhatsApp text; change the layout there, never in one output. Receipt settings are in `receipt_settings`. A KRA section appears only when KRA actually signed the sale. `src/services/printer/` holds the print queue, connection manager and ESC/POS generator; every print goes through the printer picker.

**Table 11.4:** Printing support

| Device | Bluetooth | Wi-Fi / LAN (port 9100) |
|---|---|---|
| Android | Yes (`BluetoothSerialPlugin.java`) | Yes (`NetworkPrinterPlugin`) |
| Windows, Linux | — | Yes (Rust commands in `src-tauri/src/lib.rs`) |
| Browser | — | — (PDF only) |

## 11.12 Scheduled jobs

**Table 11.5:** `pg_cron` jobs (times UTC)

| Job | Schedule | Does |
|---|---|---|
| `process-schedule-reminders` | every minute | Due reminders |
| `escalate-unaccepted-alerts` | every minute | Re-rings alerts until accepted |
| `auto-clock-out` | every minute | "Still working?" at 15 h; 3-minute close |
| `expire-promotion-holds` | every 5 minutes | Releases holds older than 20 minutes |
| `referral-and-promotion-jobs` | every 10 minutes | `run_referral_jobs` |
| `ring-regular-orders` | every 10 minutes | Rings staff while today's regular orders are not done |
| `ops-watchdog` | every 10 minutes | `run_ops_watchdog` health checks |
| `run-due-backups` | hourly at :05 | Google Sheets backups |
| `customer-portal-daily` | 02:00 | Due website schedules become orders; unpaid orders over 48 h cancelled |
| `buying-nightly` | 04:15 | Reorder suggestions |
| `purge-security-data` | 00:20 | Housekeeping |
| `prune-cron-history` | 00:40 | Housekeeping |
| `prune-stale-device-tokens` | 03:17 | Housekeeping |

Runs are recorded in `cron.job_run_details`.

## 11.13 Global search

`global_search()` (`20261202001`) finds sales, payments, expenses, stock changes, journal entries, audit lines, ledger lines and deliveries by their reference, with the caller's own row security. The app adds screens, settings, shortcuts, products and customers. Picking a result opens the screen with the row highlighted.

# Part III: Integrations and Infrastructure

# Chapter 12: External Integrations

## 12.1 Integration status

Every connection except Supabase is optional.

**Table 12.1:** Integrations and their status at 24 November 2026

| System | Used for | Without it | Status |
|---|---|---|---|
| Safaricom Daraja | M-Pesa prompts, till payments | Online orders cannot be paid | Tested against a mock only |
| Airtel Africa | Airtel Money prompts | Recorded by hand | Never run against Airtel |
| Paystack | Card payments | Recorded by hand | Never run end to end |
| KRA eTIMS (OSCU) | Signing sales | No VAT | Deployed; never run against the KRA sandbox |
| Africa's Talking | Dial-code ordering | No dial-code ordering | Simulated requests only |
| WhatsApp Cloud API | Automatic WhatsApp | Staff open each chat by hand | Never run against Meta |
| Twilio | SMS | WhatsApp or email | Never run |
| Email (SMTP; Resend or SendGrid optional) | Sign-in codes, invitations, messages | Sign-in emails fail | Through one personal mailbox (OPS-04) |
| Firebase | Push notifications and alarms | No pushes | Never run end to end |
| AI providers | Assistant, analysis, advisors | AI unavailable | Hugging Face in use |
| Google Sheets | Business backups | No Sheets backup | Scheduling tested; real backup not run |
| Google, Apple, phone sign-in | Website sign-in | Buttons hidden or explain | Never run |
| Telegram | Operator alerts | No alerts | Live since 15 November 2026 |
| Cloudflare Workers, R2 | Hosting; backups | No web app; no off-site backup | Hosting live; R2 secrets not set |

## 12.2 M-Pesa (Daraja)

**Table 12.2:** Functions in the M-Pesa flow

| Function | Called by | Role |
|---|---|---|
| `mpesa-payments` | Staff app | `status`, `save_till`, `register` (C2B URLs), `request` (prompt), `check` |
| `customer-checkout` | Website | Prompt for a customer's own order |
| `mpesa-webhook` | Safaricom | Result of every prompt, matched by CheckoutRequestID |
| `till-callback` | Safaricom | Direct till payments: `?type=validation` and `?type=confirmation` |
| `process_business_payment` | Database | Records a matched payment against debt, then wallet |
| `record_till_payment`, `handle_till_payment` | Database | Queue and resolve till payments |
| `log_mpesa_payment` | Database | Logs the payment and raises **Payment Received** (never for a credit sale) |

Safaricom refuses callback URLs containing words like "mpesa", hence the name `till-callback`. In the sandbox, Daraja's test short code is a paybill: use `CustomerPayBillOnline` and leave `MPESA_PARTY_B` empty. Set `MPESA_C2B_SHORTCODE` if Safaricom registers the till under a different short code. Website totals are rounded down to whole shillings because M-Pesa rejects cents.

> **Note:** M-Pesa success is currently taken from the callback body, protected by the URL token; a status double-check with Daraja is an open finding (SEC-10).

## 12.3 KRA eTIMS

The `kra-etims` function checks the details with KRA before saving (`connect`), signs each sale from the stored sale (`sign_sale`), numbers invoices in sequence (`kra_next_invoice_no`) and supports `status` and `disconnect`. The communication key is kept in `kra_etims_secrets`, which no app user can read; signatures in `kra_etims_receipts`; registered items in `kra_etims_items`. VAT can be switched on only once eTIMS is connected (`vat_allowed`, `20261124001`). Endpoint paths, the item code format and the verification QR address follow the specification and **require confirmation** in the KRA sandbox.

## 12.4 Dial-code ordering (USSD)

Africa's Talking sends `sessionId`, `serviceCode`, `phoneNumber` and `text` (answers joined by `*`) on each step. The menu is a pure function in `ussd/menu.ts`, tested without a gateway; replies start with `CON` (continue) or `END`. Requests are authorised by `USSD_CALLBACK_TOKEN` in the callback URL and limited to 40 per 10 minutes per phone. Callers can create an account with their name, order from the first seven products in stock, pay by M-Pesa prompt and check orders, points and balances.

> **Note:** The gateway expects a reply within 10 seconds. Placing an order calls M-Pesa inside that time, so a slow response can show the caller a network error. This must be tested on the live service.

## 12.5 Messaging

**Table 12.3:** Customer messaging channels

| Channel | Function | Notes |
|---|---|---|
| SMS | `sms-config` (Twilio) | Per-business account |
| WhatsApp | `whatsapp-config` (Meta Cloud API) | Free text only within 24 hours of the customer's last message; otherwise an approved template. Delivery not confirmed |
| Email | `send-email` | Branded template; staff can send only fixed kinds of email for their own business (SEC-06 fixed) |
| Website messages | `customer_messages` | `staff_send_customer_message`, `send_customer_message` |

`fn_contact_allowed` is checked by every sending function: order updates and reminders are on by default; offers need the customer's agreement.

## 12.6 Customer website data access

Customers sign in through Supabase Auth and have no business membership, so staff policies exclude them. They read only their own rows and write only through functions such as `place_online_order`, `request_regular_order`, `update_my_profile`, `update_my_account` and `redeem_my_points`. Public shop data comes from `get_public_storefront`, which returns only what customers should see.

> **Warning:** Never add anonymous or customer policies on `products` or `businesses`. A policy cannot hide columns, so it would expose `products.cost` and other private fields.

`place_online_order` prices everything on the server. Payment inserts an ordinary `transactions` row, so the usual triggers update stock, points and money. Wrong amounts, second payments and stock shortages are flagged for staff. Refunds of online orders are manual.

## 12.7 AI

`supabase/functions/shared/ai-runner.ts` supports Google Gemini, OpenAI, Anthropic, DeepSeek, Groq, OpenRouter and Hugging Face (the default, with token rotation across `HF_TOKEN_A` / `HF_TOKEN_B`). Retired models are swapped automatically. The owner chooses the provider and model in **Settings**; `ai-config` stores them in `ai_settings` and returns masked keys only.

**Table 12.4:** AI features

| Feature | Function | Permission | Behaviour |
|---|---|---|---|
| Assistant (name from `VITE_AI_NAME`, default "Kim") | `chat` | `ai.use` | Answers about catalogue, stock, customers and staff; proposes actions as cards in the chat; reads role permissions live |
| Business analysis | `bi-analyze` | `ai.insights` or `reports.view` | Structured report with insights, recommendations and risks |
| Area advisors | `area-advisor` | `ai.use` or `ai.insights` plus the area's permission | Reads figures with the caller's own row security; only explains |
| Complaints | `complaints` | `complaints.view` | Analyse, draft and improve replies |
| Shop assistant | `customer-assistant` | Public, quota per customer | Availability and totals answered in code from live stock; the model never sees stock or cost figures |

Proposed actions never run on their own: a person with the required permission approves them, and they run with that person's permissions (`pendingActionStore.ts`).

# Chapter 13: API Documentation

## 13.1 Conventions

Clients call PostgREST with the user's JWT: tables through row-level security, and business operations as RPCs (`supabase.rpc('<name>', {...})`). Edge functions are called at `https://<project-ref>.supabase.co/functions/v1/<name>`, with the user's JWT unless stated, a JSON body with an `action` field where a function has several, and JSON replies. Request bodies of public functions are size-capped.

## 13.2 Edge functions

**Table 13.1:** Edge functions

| Function | Caller | Authorisation | Purpose |
|---|---|---|---|
| `auth-otp` | Apps | Public, rate limited | Issue and check sign-up and reset codes |
| `ai-config` | Staff app | Owner | Read and save AI settings; masked keys |
| `chat` | Staff app | `ai.use` | Assistant |
| `area-advisor` | Staff app | `ai.use` / `ai.insights` + area permission | Advisor cards |
| `bi-analyze` | Staff app | `ai.insights` / `reports.view` | Business analysis |
| `complaints` | Staff app | `complaints.view` | Complaint analysis and replies |
| `customer-assistant` | Website | Public, quota | Shop assistant |
| `customer-checkout` | Website | Signed-in customer | Prompt for own order (`pay`, `check`) |
| `mpesa-payments` | Staff app | `payments.mpesa`; setup `settings.integrations` | Till setup, registration, prompts, checks |
| `mpesa-webhook` | Safaricom | Token in URL | Prompt results |
| `till-callback` | Safaricom | Token in URL | Till payments |
| `airtel-payments` | Staff app, website | `payments.airtel`; setup `settings.integrations` | Airtel prompts and status |
| `airtel-callback` | Airtel | Per-business token in URL | Prompt result; success only after a status check |
| `card-payments` | Staff app, website | `payments.card` (or `pos.create_sale`); setup `settings.integrations` | Paystack charges |
| `card-webhook` | Paystack | Paystack signature | Card result |
| `kra-etims` | Staff app | `settings.integrations` (connect); `pos.create_sale` / `orders.view` (sign) | KRA eTIMS |
| `ussd` | Africa's Talking | Token in URL | Dial-code menu |
| `send-email` | Apps | Signed in | Branded email |
| `send-fcm` | Database trigger | Service role or `FCM_WEBHOOK_SECRET` | Push notifications |
| `alarm-sync` | Database | Service role or `FCM_WEBHOOK_SECRET` | Ringing alarms to phones |
| `accept-alert` | Apps | Signed in | Accept a ringing alert everywhere |
| `sms-config` | Staff app | `communication.send` | Twilio settings and sending |
| `whatsapp-config` | Staff app | `communication.send` | WhatsApp settings and sending |
| `backup-config` | Staff app, `pg_cron` | Owner; service role | Google Sheets backups |
| `sync` | Staff app | `pos.create_sale` | Older offline queue across restarts |
| `ops-alert` | Monitor, database, apps | GET public (health); `report` needs `support.report`; `crash`, `watchdog`, `test` service role | Health check and alerts to Telegram |

Public functions are deployed with `--no-verify-jwt`.

## 13.3 Main database functions (RPC)

**Table 13.2:** Main database functions by area

| Area | Functions |
|---|---|
| Business setup | `create_business_with_owner`, `accept_invitation_with_token`, `get_invitation_by_token`, `revoke_invitation` |
| Access | `has_permission`, `assert_permission`, `assert_business_member`, `is_owner_or_admin`, `get_user_business_ids` |
| Sales | `record_till_sale`, `process_customer_transaction`, `create_credit_note`, `mark_quote_sold`, `attach_sale_to_customer` |
| Payments | `process_business_payment`, `void_business_payment`, `get_business_payments`, `get_money_assets` |
| Wallet, debt, points | `process_wallet_topup`, `process_wallet_spend`, `process_debt_payment`, `settle_customer_debt_fifo`, `redeem_customer_points`, `spend_points_at_till`, `refund_till_points`, `link_till_points`, `fn_point_value`, `issue_invoice` |
| M-Pesa | `log_mpesa_payment`, `record_till_payment`, `handle_till_payment`, `begin_order_payment`, `confirm_online_order_payment` |
| Stock | `adjust_stock_manually`, `adjust_stock_bulk`, `receive_purchase`, `ask_supplier_for_stock`, `send_stock_transfer`, `approve_stock_transfer`, `cancel_stock_transfer`, `stock_period_report` |
| Customers | `find_duplicate_customers`, `dismiss_duplicate_customers`, `merge_customers`, `calculate_customer_tier` |
| Website | `get_public_storefront`, `place_online_order`, `cancel_my_order`, `get_my_rewards`, `redeem_my_points`, `update_my_account`, `submit_website_feedback`, `run_customer_portal_daily` |
| Deliveries | `staff_update_online_order`, `staff_assign_rider`, `get_my_deliveries`, `rider_update_delivery`, `fn_rider_owed`, `list_rider_pay`, `pay_rider`, `remove_rider_payment` |
| Promotions | `promo_check`, `promo_reserve`, `promo_release`, `run_referral_jobs` |
| Regular orders, shifts | `deliver_regular_orders`, `request_regular_order`, `confirm_still_on_shift` |
| Books | `acc_post_source`, `acc_source_ids`, `acc_rebuild_start`, `fn_post_money_asset`, `fn_spending` |
| Notifications | `fn_notification_catalog`, `fn_notification_recipients`, `get_my_notification_settings`, `set_my_notification_setting` |
| Security and operations | `otp_issue`, `otp_check`, `otp_confirm_signup`, `check_rate_limit`, `report_crash`, `run_ops_watchdog`, `run_due_backups`, `global_search` |

# Chapter 14: File and Media Management

**Table 14.1:** Storage buckets

| Bucket | Public | Holds |
|---|---|---|
| `product-images` | Yes | Product photos |
| `employee-avatars` | Yes | Staff profile pictures |
| `business-logos` | Yes | Logos and cover images |
| `business-files` | No | Files attached to business records (suppliers, assets) |
| `receipt-exports` | No | Exported receipts |
| `expense-receipts` | No | Photos of expense receipts |

`services/upload/` follows a ports-and-adapters design with an offline upload queue. Product photos come from the camera, webcam, a file, or an Unsplash search (`VITE_UNSPLASH_ACCESS_KEY`). Products with no photo show a standard stock image. The **background remover** runs on Android with ML Kit, on desktop with a native ONNX runtime, and in the browser with WebGPU/WASM; the web build loads its 26 MB runtime from jsDelivr because Cloudflare limits files to 25 MiB.

# Chapter 15: Hosting and Deployment Architecture

## 15.1 Deployment view

![Figure 15.1: Deployment view: where each artefact is built, stored and run](diagrams/deployment.svg)

**Table 15.1:** What runs where

| Part | Where | Configuration |
|---|---|---|
| Staff web app | Cloudflare Worker `kaykays-app` | `wrangler.jsonc`, `public/_headers` |
| Customer website | Cloudflare Worker `kaykays-website` | `website/wrangler.jsonc`, `website/public/_headers` |
| Database, sign-in, functions, storage | Supabase | `supabase/` |
| Installers and `latest.json` | Public releases repository (GitHub Releases) | `release-and-deploy.yml` |
| Backups | Cloudflare R2 bucket `kaykays-backups` | `backup-database.yml` |

## 15.2 Web hosting (blue-green)

Both Workers serve static files only; unknown paths get `index.html`. `scripts/deploy-web.sh <app|website>`:

1. builds and checks Cloudflare's limits (`prepare-cloudflare.mjs`);
2. notes the version taking all traffic (blue);
3. uploads the new version (green) with no traffic and its own preview URL;
4. smoke-tests green (`smoke-test-web.mjs`: pages answer, every script and stylesheet loads; the website also checks `/terms` and `/privacy`);
5. switches all traffic to green in one step;
6. checks the live address and switches straight back to blue if it fails.

Exit codes: 0 live, 1 nothing changed, 2 rolled back, 3 rollback failed. Every version is kept; **Actions > Roll back web** returns to an earlier one. The security headers (CSP, HSTS, frame and referrer rules) are in the `_headers` files. Setup, domains and limits: `docs/HOSTING_CLOUDFLARE.md`.

## 15.3 CI/CD pipeline

![Figure 15.2: Release pipeline](diagrams/release-pipeline.svg)

**Table 15.2:** GitHub Actions workflows

| Workflow | Trigger | Does |
|---|---|---|
| `release-and-deploy.yml` | Push to `main` | Version, database checks, security checks, tests and builds, release, web deploy, Telegram ([Figure 15.2](#f-15-2)) |
| `build.yml` | Pull requests | Type checks, tests, website build, desktop and Android builds; never publishes |
| `db-checks.yml` | Pull requests; called by release | Migration rules, fresh database from all migrations, every database suite |
| `security.yml` | Called by release; Mondays | Dependency and secret scans |
| `deploy-web.yml` | After a release, or by hand from `main` | Blue-green deploy of both sites |
| `rollback-web.yml` | By hand | Return a site to an earlier version |
| `backup-database.yml` | Hourly | Encrypted dump to R2 |
| `restore-drill.yml` | Mondays | Restore the newest backup and check row counts |

**Versions from commits** (`scripts/release-version.mjs`): `feat!:`/`fix!:` or `BREAKING CHANGE` is major; `feat:` minor; `fix:`, `perf:`, `refactor:` patch; anything else releases nothing. Emoji prefixes are recognised. Numbering restarted at 1.0.0 on 23 November 2026 (base tag `v0.0.0`); the current release is 1.0.1. Nothing reaches users until every check and build has passed.

## 15.4 Applying database changes

`bash scripts/db-push.sh` is the only way to push migrations. It stops when a migration file has uncommitted changes, `check-migrations.mjs` finds an error, the live text of an applied migration differs from its file (`DIFFERS`) or live has a migration the folder lacks (`LIVE-ONLY`), or a database test fails. It then shows the dry run, asks for `yes`, pushes, runs `check-live-grants.sh` and checks every file is on live unchanged. `--check` changes nothing.

`check-migrations.mjs` refuses bad names, duplicate versions, a new file that sorts before one already on `main`, a deleted migration, and a drop, rename, type change or `TRUNCATE` without a `-- destructive-ok: <reason>` line.

**Order:** deploy changed edge functions first, then apply migrations, then release the app. Expand first (add, never rename or drop in the same release; new columns nullable or defaulted) and contract later, so old and new app versions both work.

## 15.5 Signing

- **Android:** the release key is outside the repository in `~/.config/kaykays-signing/`. CI pins the expected certificate (`android/release-signing-cert.sha256`) and fails a release signed with any other key. Release version codes are 20,000,000 + major × 100,000 + minor × 1,000 + patch (1.0.0 = 20,100,000).
- **Desktop:** the updater key pair is in `~/.tauri/`; its public half is in `src-tauri/tauri.conf.json`. Windows shows a SmartScreen warning until the MSI is code-signed.

If either private key is lost, installed apps cannot update and must be reinstalled by hand. Both must be in the offline copy (ISMS-AG Chapter 12).

## 15.6 Automatic updates

Installed apps fetch `latest.json` 15 seconds after start, when the connection returns, and every 6 hours, trying the sources in `MANIFEST_SOURCES` (`src/core/native/updateManifest.ts`, the same list as the Tauri updater endpoints): the releases repository's `update-manifest` branch, a jsDelivr mirror, the GitHub latest-release link, and the old repository for apps built before the move.

**Table 15.3:** Update behaviour by platform

| Platform | Behaviour |
|---|---|
| Windows, Linux AppImage | Downloads in the background and verifies the signature; **About this app** shows **Restart and install** (`restartToUpdate`). There is no update bar |
| Linux `.deb` | Gets the signed `.deb` listed separately in `latest.json` |
| Android | `AppUpdatePlugin.java` downloads the APK, checks its SHA-256 and opens Android's installer |

Failures carry a code from `src/core/native/updateErrors.ts` (`OFFLINE`, `SERVER_UNAVAILABLE`, `NETWORK`, `BAD_MANIFEST`, `DOWNLOAD_FAILED`, `CORRUPT_DOWNLOAD`, `BAD_SIGNATURE`, `SIGNATURE_MISMATCH`, `NOT_NEWER`, `BAD_APK`, `NEEDS_PERMISSION`, `INSTALL_FAILED`, `UNKNOWN`). Version comparison is numeric (`utils/semver.ts`). Desktop installs on 7.x see 1.0.0 as older and must be reinstalled by hand once.

# Chapter 16: Environment Configuration

## 16.1 App build variables

**Table 16.1:** Build variables (`.env`, GitHub secrets)

| Variable | Used by | Purpose |
|---|---|---|
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` | App, website | Supabase project and public key; CI refuses to build without them |
| `VITE_AI_NAME` | App | Assistant name (default Kim) |
| `VITE_UNSPLASH_ACCESS_KEY` | App | Optional photo search |
| `VITE_WEBSITE_SLUG` | Website | Which business to show (default `kaykays`) |
| `VITE_SITE_URL` | Website | Live address; empty means "do not index" |
| `VITE_AUTH_PROVIDERS` | Website | Extra sign-in options, e.g. `google,phone,apple` |
| `VITE_ORT_WASM_FROM_CDN` | Web build | Load the background-remover runtime from jsDelivr |

## 16.2 Edge function secrets

Set with `npx supabase secrets set NAME=value`.

**Table 16.2:** Edge function secrets

| Secret | Purpose |
|---|---|
| `MPESA_ENV` | `sandbox` or `production` |
| `MPESA_CONSUMER_KEY`, `MPESA_CONSUMER_SECRET`, `MPESA_PASSKEY` | Daraja app credentials |
| `MPESA_SHORTCODE`, `MPESA_PARTY_B`, `MPESA_C2B_SHORTCODE` | Store number, till number, optional C2B short code |
| `MPESA_TRANSACTION_TYPE` | `CustomerBuyGoodsOnline` (till) or `CustomerPayBillOnline` (sandbox) |
| `MPESA_CALLBACK_TOKEN` | Authorises `mpesa-webhook` and `till-callback` |
| `MPESA_CALLBACK_URL`, `MPESA_C2B_CALLBACK_URL`, `MPESA_BASE_URL` | Optional overrides |
| `USSD_CALLBACK_TOKEN`, `USSD_SHOP_SLUG` | Dial-code authorisation and business |
| `FIREBASE_SERVICE_ACCOUNT`, `FCM_WEBHOOK_SECRET` | Push notifications |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` | Email delivery |
| `RESEND_API_KEY`, `SENDER_EMAIL`, `EMAIL_LOGO_URL`, `APP_DOWNLOAD_URL` | Optional email provider, sender, logo and download link |
| `HF_TOKEN_A`, `HF_TOKEN_B`, `GEMINI_API_KEY`, `OPENROUTER_API_KEY` | Platform AI keys and fallbacks |
| `KRA_ETIMS_SANDBOX_URL`, `KRA_ETIMS_PRODUCTION_URL` | Optional KRA endpoint overrides |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` | Operator alerts |

Per-business provider keys (Airtel, Paystack, KRA, Twilio, WhatsApp, the business's own AI key) are stored in server-only settings tables through their configuration functions, not as platform secrets.

## 16.3 Vault secrets

Database-initiated calls (backups, pushes, alarms, crash alerts, watchdog) need, in the SQL editor:

```sql
SELECT vault.create_secret('https://<project-ref>.supabase.co', 'project_url');
SELECT vault.create_secret('<legacy JWT service role key>', 'service_role_key');
```

The push trigger's secret must match `FCM_WEBHOOK_SECRET` or the service role key, or pushes stop; check `net._http_response` for 401 responses after a test notification.

## 16.4 Callback URLs

**Table 16.3:** Provider callback URLs

| Provider | URL |
|---|---|
| Safaricom prompts | `…/functions/v1/mpesa-webhook?token=<MPESA_CALLBACK_TOKEN>` |
| Safaricom till | `…/functions/v1/till-callback?type=confirmation&token=<MPESA_CALLBACK_TOKEN>` |
| Africa's Talking | `…/functions/v1/ussd?token=<USSD_CALLBACK_TOKEN>` |
| Google and Apple sign-in | `…/auth/v1/callback` |

`…` is `https://<project-ref>.supabase.co`.

## 16.5 GitHub repository secrets and variables

**Table 16.4:** GitHub secrets and variables

| Name | Purpose |
|---|---|
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_AI_NAME`, `VITE_UNSPLASH_ACCESS_KEY`, `VITE_SITE_URL`, `VITE_WEBSITE_SLUG` | App and website builds |
| `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_ALIAS`, `ANDROID_KEYSTORE_PASSWORD`, `GOOGLE_SERVICES_JSON` | Android signing and Firebase |
| `TAURI_SIGNING_PRIVATE_KEY`, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | Desktop update signing |
| `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` | Web deploys and R2 |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` | Pipeline alerts |
| `SUPABASE_DB_URL`, `BACKUP_PASSPHRASE`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` | Backups and restore drill (not yet set) |
| `RELEASE_TOKEN` | Optional, if a ruleset stops the built-in token pushing tags |
| Variables `APP_URL`, `WEBSITE_URL`, `RELEASES_REPO`, `VITE_AUTH_PROVIDERS` | Live addresses for checks; releases repository; sign-in options |

# Part IV: Reliability and Maintenance

# Chapter 17: Logging and Monitoring

**Table 17.1:** Monitoring sources

| What | Where |
|---|---|
| Crashes | `crash_reports` via `report_crash` (`src/services/crashReporter.ts`); personal data scrubbed on the device; identical crashes counted |
| Problem reports | `problem_reports`, then Telegram |
| Edge function errors | Supabase dashboard > Edge Functions > Logs |
| Scheduled jobs | `cron.job_run_details`; the watchdog alerts on failures |
| Database health | `run_ops_watchdog` every 10 minutes: failed jobs, payments stuck over 30 minutes, database over 80% of plan size, connections over 80%, storage usage, failing database-to-function calls |
| Uptime | An outside monitor calling `GET ops-alert` (returns 503 if the watchdog has not run for 30 minutes); **not yet set up** |
| Refused calls | `security_events` |
| Releases, deploys, backups | GitHub Actions, with Telegram alerts |

Watchdog limits are in `ops_watchdog_config` (one row). The watchdog tables and functions are server-only. Logs were reviewed for secrets: edge functions log row IDs and error text only. Alert routing and the operator's duties are in ISMS-AG Chapter 10.

# Chapter 18: Error Handling

## 18.1 In the app

- `toUserMessage` turns technical errors into plain sentences; friendly server messages pass through.
- Offline states are shown in rose red, never as errors.
- Errors say what happened, then what to do.

## 18.2 On the server

- Functions raise clear, user-readable exceptions on permission, membership, stock and total checks; the whole transaction rolls back.
- Book postings that fail are kept in `acc_post_errors` rather than blocking the sale.
- Edge functions return JSON errors with HTTP status codes; providers' temporary failures are retried by the app where safe (updates retry 5xx and timeouts).

## 18.3 Troubleshooting for developers

**Table 18.1:** Developer troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Installer starts but cannot connect | Built without the Supabase URL and key | Set the GitHub secrets and rebuild |
| `tauri build` fails after an update | Tauri npm and crate versions differ | Pin `@tauri-apps/*` to the crates' minor version |
| CI type check fails, local passes | React types found higher up the folder tree | Check in a copy outside the home folder |
| Desktop app refuses an update | Signed with another key, or key secret invalid | Restore `~/.tauri/`; set `TAURI_SIGNING_PRIVATE_KEY` again |
| Android build fails at signing | `ANDROID_KEYSTORE_BASE64` not valid base64 | Re-create with `base64 -w0` |
| No push notifications | Vault push secret does not match `FCM_WEBHOOK_SECRET` or the service key; or no Firebase account | Fix the secret; set `FIREBASE_SERVICE_ACCOUNT`; check `net._http_response` |
| Prompt sent but sale not recorded | `mpesa-webhook` not deployed, or token mismatch | Deploy it; check `MPESA_CALLBACK_TOKEN` |
| Backups never run | Vault secrets missing | [Section 16.3](#s-16-3) |
| Website pages 404 on refresh | Host does not serve `index.html` for unknown paths | Workers use single-page fallback; check `wrangler.jsonc` |
| `/terms` 404 after deploy | Prerender could not reach the storefront | Check `VITE_SUPABASE_*` and `VITE_WEBSITE_SLUG` |
| `db-push.sh` reports `DIFFERS` | Live ran a different text of a migration | Put the change in a new migration, or repair as in `docs/deployment/release-safety.md` |
| "Not set up on the server" | A function the app calls is missing on live | Apply the migrations with `db-push.sh` |

# Chapter 19: Backup and Recovery

The backup design has four layers: the provider's own backups, an hourly encrypted `pg_dump` to Cloudflare R2 (`backup-database.yml`, retention hourly 3 days, daily 35 days, weekly 6 months, monthly 13 months), a per-business Google Sheets export, and a monthly offline copy. `scripts/db-backup.sh` lists, downloads, verifies and restores copies into a separate local Supabase that has scheduled jobs and Vault keys removed. `restore-drill.yml` proves the newest backup every Monday.

There are no down-migrations: a bad migration is fixed with a new one; lost data is restored from a copy and only the missing rows are copied back. Targets, setup and restore procedures are in ISMS-AG Chapter 12.

> **Important:** The hourly backup has never run, because its secrets are not set (SEC-02).

# Chapter 20: Performance and Scalability

## 20.1 Measurements

A sales list taking about a second for 45 sales on live showed that the cost was in row security, not data. After the per-request permission cache (`20261201005`), the busiest reads became two to four times faster; for example the cashier's sales list (1,000 sales) went from 1,682 ms to about 600–725 ms on a local copy.

## 20.2 Load test

At 10 concurrent clients the system sustained about 41 transactions a second, roughly 100 times a busy shop, with the books balanced in every run. Logins were not load-tested.

## 20.3 Fixes in the app

The app no longer downloads full lists only to discard them; product changes are merged in place rather than reloading every product on every device; lists read past the 1,000-row page limit. Realtime publishes only tables a screen follows.

## 20.4 Growth and expansion

Each business is a tenant in one database, isolated by `business_id` and row security. Kenya is built in: currency (always KSh), Nairobi business days, +254 phone handling, M-Pesa, Airtel and KRA. Another country would need those changes first (findings EXP-03 to EXP-05). There is no per-business usage quota yet (EXP-01). Repeat the measurements with `scripts/perf/`.

**Table 20.1:** Open performance findings

| ID | Finding |
|---|---|
| PERF-06 | Home and charts computed from the newest 1,000 sales |
| PERF-07 | The web app is one 3.4 MB script |
| PERF-08 | About 25 live subscriptions per app; `users` followed without a filter |

# Chapter 21: Testing and Quality Assurance

## 21.1 Unit tests

`npm test` runs `src/test/runTests.ts` with `tsx`: 75 tests on 24 November 2026, all passing. They cover formatting and receipt numbers, receipt layout and ESC/POS output, Code 128, user-facing error text, crash report scrubbing, role permissions and their database defaults, BOM and batch calculations, the assistant's pending actions, AI provider rotation, customer merge rules, points and tier values, invoices, readable text, the offline queue, Home and shift figures, worked hours, the stock report, regular orders, shortcuts and screen access, the dial-code menu, phone number formats, mobile navigation, release versions and the update manifest, Paystack webhook signatures, and list paging.

## 21.2 Database tests

`scripts/run-db-tests.sh` builds a fresh database from every migration (`supabase db start`) and runs the suites in `supabase/tests/`: permissions and grants (including the assistant's permissions), numbers, promotions, referrals, regular orders, sale totals and global search. The suites sign in as each role and check access rules, money and books. CI runs them on every pull request and before every release.

## 21.3 Manual checks before a release

1. Sign in as each role and confirm the screens match ISMS-UG Appendix B.
2. Make a cash sale and an M-Pesa sale; check stock, points, shift totals, money balances and the books.
3. Take a debt payment and a wallet top-up.
4. Print a receipt on a Bluetooth printer.
5. Go offline, make a sale, reconnect, and confirm it syncs once.
6. Place and pay for a website order in the sandbox.
7. Confirm a push notification arrives on Android.

> **Note:** Several screens (Regular Orders, Promotions & Points, rider pay, trips, Stock Report, global search) have passed database tests but have not had a recorded click-through on a phone.

# Part V: Technical References

# Chapter 22: Development and Maintenance Procedures

## 22.1 Project rules

- Money, number and integrity rules: [Section 10.1](#s-10-1).
- **Permission rule:** every permission the app checks is also enforced by the database, and edge functions use `requirePermission`, never a role name. A new table with a policy needs the matching `GRANT` to `authenticated`.
- **Finishing rule:** every change that is not fully live when work stops gets numbered steps in `docs/TO_FINISH.md` (newest at the top): what to do with the exact command, how to see it worked, and **You:** for steps only the owner can do.

## 22.2 Changing the backend

```bash
npx supabase migration new <name>        # write SQL in the new file
bash scripts/run-db-tests.sh             # database suites on a fresh database
npx supabase functions deploy <name>     # changed functions first (--no-verify-jwt for public ones)
bash scripts/db-push.sh                  # migrations to live, then grants check
```

## 22.3 Releasing

Commit with a conventional prefix and push to `main`. The pipeline decides the version, runs every gate, publishes installers and `latest.json`, and deploys both sites. For a bad release, push a `fix:` commit (installed apps cannot roll back); the web can roll back at once.

## 22.4 Changing default role permissions

Edit `SYSTEM_ROLES` in `src/utils/permissions.ts` and `role_default_permissions` together, in a new migration. `npm test` fails if the two differ. A business's own changes made on the Roles screen are kept in `role_permissions` and override the defaults.

## 22.5 Writing text in the app

- Use the screen names from `src/utils/screens.ts` everywhere.
- **Sign in / Sign out**, not "log in". **Code** for emailed codes. **Recipe** for a BOM in messages.
- Confirm with **Saved / Deleted / Added**; no "successfully" and no exclamation marks.
- Errors say what happened, then what to do.
- No database IDs, developer words or placeholder data in text people read; short descriptions.

## 22.6 Repository hygiene

- `supabase/dev_wipe.sql` empties every table (and sign-ins and files) and refuses to run until `SET app.wipe_everything = 'yes, wipe it';`. Never run it against real data without a backup.
- Keep `.env` out of git; signing keys never enter the repository.

# Chapter 23: Known Limitations

## 23.1 Functional limits

- Till payments cannot be matched automatically (a till carries no account number).
- Refunds of online orders are manual.
- Duplicate customers are merged by staff only, with no undo.
- The dial-code menu shows the first seven products in stock, and a slow M-Pesa reply can exceed the gateway's 10-second limit.
- WhatsApp delivery is not confirmed; email is limited to 30 per hour per person.
- Home figures over long ranges can be cut off at 1,000 sales; product profit uses current prices.
- Rotating full-screen Home charts needs a native Android build with the orientation plugin.
- Windows shows a SmartScreen warning until the MSI is code-signed.
- The delivery fee defaults to zero.

## 23.2 Provider and integration limits

No payment or tax integration has yet been run against the real provider or its sandbox ([Table 12.1](#t-12-1)). All email goes through one personal mailbox with a daily cap (OPS-04).

## 23.3 Readiness

At 23 November 2026 the platform was assessed **Not Ready** for paying businesses: no working independent backup (SEC-02), no two-step sign-in for owners and admins (SEC-03), a published test password (SEC-04/05), the database very likely on the free plan (OPS-06), and no uptime monitor. The development environment uses the live database (REL-01), and the live database holds test data that must be wiped before real use. The code repository must stay public until the releases-repository move is complete (`docs/GOING_PRIVATE.md`). Details: `docs/security/threat-register.md`.

## 23.4 Not built

The roadmap in `docs/roadmap/` lists HR and payroll, inventory valuation with lots and expiry, a CRM pipeline, platform features, and projects and helpdesk. These are plans and are not part of release 1.0.1.

# Chapter 24: Technical Glossary

**Table 24.1:** Technical glossary

| Term | Meaning |
|---|---|
| BOM | Bill of materials: ingredients and amounts for one batch |
| Blue-green | Deploy a new version beside the old, check it, then switch all traffic |
| C2B | Customer to business: an M-Pesa payment the customer starts |
| Daraja | Safaricom's M-Pesa API |
| Edge function | Deno server code running on Supabase |
| eTIMS / OSCU | KRA's electronic tax invoice system / its online sales control unit |
| FCM | Firebase Cloud Messaging |
| Money asset | The running balance held per payment method |
| `pg_cron` | PostgreSQL extension that runs scheduled jobs |
| RLS | Row-level security |
| RPC | A database function called from the app |
| Service role | The Supabase key that bypasses RLS; server only |
| `SECURITY DEFINER` | A function that runs with its owner's rights after its own checks |
| STK push | An M-Pesa prompt on the customer's phone |
| Tenant | One business and its data |
| Till | An M-Pesa Buy Goods number; payments carry no account number |
| USSD | Dial codes that work on any phone without internet |

# Appendix A: Permission Codes

Defined in `PERMISSIONS` in `src/utils/permissions.ts` (188 codes, each with a plain description shown on the Roles screen) and mirrored in `role_default_permissions`.

**Table A.1:** Permission codes by group

| Group | Codes |
|---|---|
| Screens | `home.view`, `dashboard.view`, `complaints.view`, `online_store.view`, `complaints.reply`, `staff.schedule` |
| Business & Settings | `business.view`, `business.create`, `business.update`, `business.delete`, `business.switch`, `business.view_all`, `settings.view`, `settings.update`, `settings.theme`, `settings.tax`, `settings.delivery`, `settings.integrations`, `settings.storage`, `settings.security` |
| Products & Inventory | `products.view`, `products.create`, `products.update`, `products.delete`, `products.import`, `products.export`, `products.manage_categories`, `products.manage_discounts`, `products.manage_tax`, `products.manage_images`, `inventory.view`, `inventory.receive_stock`, `inventory.adjust_stock`, `inventory.transfer_stock`, `inventory.request_transfer`, `inventory.stock_count`, `inventory.stock_history`, `inventory.wastage`, `inventory.expiry`, `inventory.import`, `inventory.export`, `inventory.manage` |
| POS & Checkout | `pos.open_shift`, `pos.close_shift`, `pos.create_sale`, `pos.cancel_sale`, `pos.refund`, `refunds.create`, `pos.discount`, `pos.override_price`, `pos.walkin_customer`, `pos.manage`, `pos.apply_promotion` |
| Quotes & Invoices | `quotes.view`, `quotes.manage`, `sales_orders.view`, `sales_orders.manage`, `invoices.view`, `invoices.manage` |
| Promotions & Referrals | `promotions.view`, `promotions.manage`, `referrals.view`, `referrals.manage` |
| Customers & Loyalty | `customers.view`, `customers.create`, `customers.update`, `customers.delete`, `customers.import`, `customers.export`, `customers.debts`, `customers.loyalty`, `customers.schedules`, `customers.manage`, `loyalty.view`, `loyalty.configure`, `loyalty.adjust` |
| Orders & Deliveries | `orders.view`, `orders.create`, `orders.update`, `orders.cancel`, `orders.complete`, `orders.assign_rider`, `orders.manage`, `deliveries.view`, `deliveries.create`, `deliveries.assign`, `deliveries.complete`, `deliveries.cancel`, `deliveries.delivery_price`, `deliveries.delivery_zones`, `deliveries.manage` |
| Suppliers & Purchases | `suppliers.view`, `suppliers.create`, `suppliers.update`, `suppliers.delete`, `suppliers.import`, `suppliers.export`, `suppliers.manage`, `purchases.view`, `purchases.create`, `purchases.update`, `purchases.cancel`, `purchases.approve`, `purchases.export`, `purchases.import`, `purchases.print`, `purchases.manage`, `purchases.request_quote`, `supplier_bills.manage`, `suppliers.portal` |
| Supplier view | `supplier_portal.deliveries`, `supplier_portal.orders`, `supplier_portal.price_requests`, `supplier_portal.statement`, `supplier_portal.stock_requests`, `supplier_portal.update_details` |
| Production & Recipes | `production.view`, `production.create`, `production.update`, `production.delete`, `production.approve`, `production.export`, `production.import`, `production.manage`, `bom.view`, `bom.create`, `bom.update`, `bom.delete`, `bom.manage` |
| Expenses & Payments | `expenses.view`, `expenses.create`, `expenses.update`, `expenses.delete`, `expenses.export`, `expenses.manage`, `pettycash.record`, `finance.view`, `accounting.view`, `accounting.manage`, `payments.view`, `payments.verify`, `payments.refund`, `payments.mpesa`, `payments.cash`, `payments.card`, `payments.airtel`, `payments.configure`, `payments.manage` |
| Staff & Roles | `staff.view`, `staff.invite`, `staff.update`, `staff.remove`, `staff.roles`, `users.view`, `users.manage`, `invitations.view`, `invitations.create`, `invitations.delete` |
| Notifications | `notifications.view`, `notifications.send`, `notifications.manage`, `communication.view`, `communication.send` |
| Reports & AI | `reports.view`, `reports.sales`, `reports.inventory`, `reports.customers`, `reports.profit`, `reports.expenses`, `reports.tax`, `reports.deliveries`, `reports.export`, `reports.manage`, `ai.use`, `ai.configure`, `ai.insights`, `ai.manage` |
| Files & Audit | `audit.view`, `audit.manage`, `files.view`, `files.manage`, `assets.view`, `assets.manage`, `import.data`, `export.data`, `google.connect` |

# Appendix B: Database Migrations

Applied in filename order by `scripts/db-push.sh`. All 31 are recorded as applied on live (read-only check, 24 November 2026); whether each live text equals its file is checked by `scripts/db-push.sh --check`.

**Table B.1:** Migrations

| Migration | Contents |
|---|---|
| `20261120001_schema` | Whole schema to 16 November 2026 (82 files squashed) |
| `20261120002_platform_and_defaults` | Sign-up trigger, storage buckets and rules, defaults |
| `20261121001_quote_sold_at_till` | `mark_quote_sold` |
| `20261122001_message_variables` | Bulk message variables |
| `20261123001_supplier_stock_requests` | Ask-supplier ringing requests |
| `20261124001_vat_needs_etims` | VAT only with KRA eTIMS |
| `20261125001_delivery_modes_sale_edit_log` | Delivery modes, rider pay on sales, sale edit audit |
| `20261126001_promotions` | Promotion codes at till and website |
| `20261126002_referrals` | Referral campaigns and rewards |
| `20261126003_promotion_referral_books` | Books for promotions and referral rewards |
| `20261127001_auto_clock_out` | Server-side clock-out (replaced by 20261130002) |
| `20261128001_customer_profile` | Standard customer fields, phone normalisation |
| `20261128002_signed_out_sessions_denied` | Signed-out tokens refused |
| `20261128003_only_creator_creates_business` | Only the system creator creates a business |
| `20261129001_revoke_invitation` | Revoke removes invite and orphan sign-up |
| `20261130001_delivery_trips` | Trips: several deliveries, one rider pay |
| `20261130002_still_on_shift_check` | "Still working?" at 15 hours |
| `20261130003_stock_period_report` | Stock report, transfer lines |
| `20261130004_rider_pay_bills` | Rider pay owed on the day, `pay_rider`, `fn_spending` |
| `20261130005_regular_orders` | Regular orders and ringing |
| `20261130006_permissions_db_level` | Every app permission enforced in the database |
| `20261130007_quantity_one_decimal` | Money two decimals, quantities one |
| `20261130008_ai_reads_permissions` | Assistant reads permissions live |
| `20261201001_lock_function_grants` | Explicit function grants (SEC-01) |
| `20261201002_sale_totals_check` | Sale totals must equal lines |
| `20261201003_ops_watchdog` | Watchdog and health check |
| `20261201004_abuse_limits` | Security log; promo guess limit |
| `20261201005_permission_cache` | Per-request permission cache |
| `20261201006_realtime_publication` | Realtime only for followed tables |
| `20261201007_storage_usage_alert` | Storage usage alert |
| `20261202001_record_refs_global_search` | Record references and `global_search()` |
| `20261203001_keep_records` | Audit trail append-only; sales, stock history and points used cannot be deleted; Old records clears only points earned, backup runs and crash reports (requires confirmation that it is applied on live) |

# Appendix C: Source Documents

**Table C.1:** Working documents kept in the repository

| Document | Use |
|---|---|
| `docs/TO_FINISH.md` | Steps still to do on the live system |
| `docs/HOSTING_CLOUDFLARE.md` | Domain move steps (section 3.5) |
| `docs/deployment/release-safety.md` | Repairing a migration that `db-push.sh` reports as `DIFFERS` |
| `docs/GOING_PRIVATE.md` | Plan for making the code repository private |
| `docs/security/threat-register.md` | Every security finding and its status |
| `docs/infrastructure/cost-management.md` | Cost model and levers |
| `docs/roadmap/` | Planned modules (not built) |

# Appendix D: Change History of the System

**Table D.1:** Main changes since release 4.2.1 (old numbering)

| Area | Change |
|---|---|
| Versions | Numbering restarted at 1.0.0 (23 November 2026); Android codes from 20,000,000 |
| Database | 82 migrations squashed (16 November 2026) |
| Navigation | Screens grouped; one screen registry; G-then-letter keys; screen names unified (24 November 2026) |
| Search | `global_search()` finds records by number |
| Accounting | Double-entry books posted automatically; Finance & Accounting screen |
| Sales documents | Quotes, credit notes, sale edit as refund and re-sell, edits audited |
| Buying | Approval limits, GRN/BILL/RTS, supplier view, ask-supplier requests |
| Transfers | Branch transfers at cost with shortages |
| Payments | Five methods with on/off switches; Payment Prompts screen |
| Rewards | Promotion and referral codes at till and website |
| Regular orders, deliveries, shifts | Per-weekday orders; delivery modes and trips; "Still working?" |
| Security and operations | Permissions in the database; explicit grants; sale totals check; watchdog; Cloudflare hosting; release gates |

Earlier, in release 4.2.1: the points rule, invoices, attaching a customer to a walk-in sale, one receipt layout with real printing, KRA eTIMS signing, the offline sales queue, the rebuilt Home and shift report, and invitations bound to the invited email.
