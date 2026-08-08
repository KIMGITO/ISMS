# ISMS — Milk Business Management System

## Application Documentation

**Version:** 1.0.0
**Platform:** Cross-Platform (Web / Desktop / Android)
**Release Type:** Production-Ready Enterprise Application

---

## 1. Overview

ISMS (Inventory & Sales Management System) is a **production-ready, cross-platform enterprise management application** purpose-built for **dairy farms, milk processing plants, and retail dairy outlets**. It delivers an **online-first, real-time reactive architecture** that synchronizes business operations across every device in the organization instantly.

The application couples a modern **React SPA** frontend with a **Supabase (PostgreSQL) real-time backend**, wrapped into native desktop applications via **Tauri v2** (Windows/Linux) and mobile apps via **Capacitor v8** (Android). It is designed specifically to handle the unique operational challenges of the Kenyan dairy industry — including perishable inventory, M-Pesa digital payments, cold-chain logistics, and multi-branch distribution.

---

## 2. Core Purpose

ISMS is engineered to unify the entire dairy business lifecycle into a single connected platform:

- **Manage Point-of-Sale (POS) operations** with full cart, discount, and tax handling.
- **Track perishable dairy inventory** with batch/expiry monitoring and spoilage logging.
- **Run customer loyalty programs** with tiering, wallet deposits, and credit management.
- **Coordinate field operations** including riders, delivery routes, and shift management.
- **Deliver executive analytics** with AI-assisted business intelligence reporting.
- **Enforce strict access control** via row-level security (RLS) and role-based permissions.

---

## 3. Technology Stack

| Category | Technology | Purpose |
|----------|-----------|---------|
| **Frontend Framework** | React 19 + TypeScript | Core SPA user interface |
| **Build Tool** | Vite 6 | Fast bundling and dev server |
| **Styling** | Tailwind CSS v4 | Utility-first design system |
| **State Management** | Zustand 5 | Modular, reactive state stores |
| **Backend / Database** | Supabase (PostgreSQL 15) | Cloud data + realtime replication |
| **Realtime Sync** | Supabase Realtime (WebSocket) | Instant cross-device updates |
| **Desktop Wrapper** | Tauri v2 (Rust) | Native Windows/Linux executables |
| **Mobile Wrapper** | Capacitor v8 | Android native packaging |
| **AI Engine** | Google Gemini via Edge Functions | Business intelligence & assistant |
| **Charts** | Recharts | Interactive data visualizations |
| **PDF Export** | jsPDF | Invoice and report generation |
| **QR Codes** | qrcode | Receipt and product encoding |
| **Icons** | lucide-react | Modern iconography |
| **Animations** | motion | UI transitions and micro-interactions |

---

## 4. Feature Modules

The application is organized into 17 feature viewports, navigated via a tab-based shell.

### 4.1 POS Checkout (`POSView`)
The heart of daily sales operations:
- **Walk-in and Loyalty Transactions** — Process sales against registered customer profiles or as anonymous walk-ins.
- **Cart Management** — Dynamic quantity adjustment, line-item percentage discounts, and VAT computation.
- **Payment Flexibility** — Cash, M-Pesa, Card, Bank Transfer, Mobile Wallet, and Credit/Debt settlement.
- **Delivery Support** — Mark orders as deliveries with rider assignment and delivery fee shortcuts (KSh 0/150/250).
- **Credit Sale Handling** — Atomic database processing for wallet deduction and debt creation.
- **Real-Time Stock Deduction** — Inventory updated the moment a sale is completed.

### 4.2 Inventory Management (`InventoryView`)
Full dairy stock pipeline control:
- **Product Directory** — Name, category, SKU, cost price, sale price, unit, and minimum stock thresholds.
- **Expiry & Batch Tracking** — Perishable flags, expiry days, and shelf-life risk alerts for dairy items.
- **Wastage Ledger** — Record spillage, souring, and processing losses.
- **Reconciliation Logs** — Manual audits, damages, and restock arrivals tracking.
- **Low-Stock Detection** — Visual alerts when stock falls below the configured safety buffer.

### 4.3 Sales & Receipt History (`SalesView`)
Complete transaction audit trail:
- **Transaction Logs** — Detailed history of every sale with items, quantities, and payment states.
- **PDF Export** — Generate professional invoice PDFs (via jsPDF) for any transaction.
- **Refund Handling** — Support transaction reversals and credit adjustments.
- **Item-Level Detail** — Product names, unit prices, quantities, and discount snapshots preserved.

### 4.4 Customers & Loyalty (`CustomersView`)
Membership and financial profile management:
- **Loyalty Tiering** — Automatic Bronze, Silver, and Gold classification based on purchase volume.
- **Wallet System** — Client deposits (top-ups) and wallet-based checkout processing.
- **Credit / Debt Manager** — Track pending balances, payment allocations (M-Pesa/Cash), and ledger history.
- **Loyalty Points** — Award points on purchases and redeem against future orders.
- **Delivery Subscriptions** — Schedule recurring daily/weekly milk deliveries.

### 4.5 Executive Analytics (`BusinessDashboard`)
AI-enhanced decision support:
- **KPI Deck** — Gross sales, estimated net profit, inventory valuation, and loyalty customer index.
- **Financial Matrix** — Revenue ledger, COGS, delivery payouts, wages, and overhead tracking.
- **Payment Mix** — M-Pesa vs Cash vs Card vs Bank settlement breakdown with pie charts.
- **Sales Trajectory** — Area charts comparing revenue, expenses, and net profit over time.
- **Inventory Pipeline** — Restock recommendations, top sellers, and slow-moving stock ranking.
- **Branch Performance** — Multi-branch revenue comparison and growth indicators.
- **Staff Metrics** — Active shifts, checkout velocity, and task completion rates.
- **AI Advisory (bi-analyze)** — Deep corporate analysis generating executive summaries, insights, risks, opportunities, and actionable recommendations. Supports direct Q&A ("How can I improve profits?").

### 4.6 Workers & Shift Control (`WorkersView`)
Workforce management:
- **Shift Recorder** — Punch-in/out registers with start/end cash balance reconciliation.
- **Task Checklists** — Create and track duty assignments for individual staff profiles.
- **Sales Auditing** — Per-shift sales totals and performance metrics.

### 4.7 Permissions & RBAC (`PermissionsView`)
Granular access control:
- **Visual Accordion Editor** — Toggle role permission states directly from the dashboard.
- **Granular Codes** — Permission codes such as `pos.create_sale`, `bom.view`, etc.
- **Instant Sync** — Save configurations to cache and push to Supabase in real time.

### 4.8 AI Workspace Assistant (`WorkspaceAssistantView`)
Intelligent copilot:
- **Chat Interface** — Conversational AI assistant (default name "Kim") powered by Gemini.
- **Action Triggers** — The assistant can execute real-time operations from conversation:
  - `create_schedule`
  - `adjust_stock`
  - `create_checkout`

### 4.9 Business Management (`BusinessManagementView`)
Tenant and brand administration:
- **Business Profiles** — Name, logo, currency, country, timezone configuration.
- **Branch Setup** — Manage physical locations and distribution hubs.
- **Business Type Selection** — Choose from predefined types or enter a custom type (e.g., Butchery, Logistics).

### 4.10 Production & BOM (`ProductionBOMView`)
Manufacturing oversight:
- **Bill of Materials** — Define recipes and production inputs.
- **Production Batches** — Log batch production with quantity and status tracking.
- **Recipe Management** — Associate products with their production recipes.

### 4.11 Communication Center (`CommunicationCenterView`)
Business messaging hub:
- **SMS Dispatch** — Send transactional updates via Twilio gateway.
- **Customer Communications** — Targeted messaging to customer segments.
- **Notification Logs** — Track all outbound communications.

### 4.12 Customer Feedback (`CustomerFeedbackView`)
Voice-of-customer management:
- **Review Collection** — Gather ratings and comments.
- **Sentiment Analysis** — Classify feedback as positive, neutral, or negative.
- **Complaint Tracking** — Manage open vs resolved SLA cases.

### 4.13 Notifications Center (`NotificationsView`)
Alert management:
- **Push Notifications** — Payment received, delivery assigned, and shift alerts.
- **Real-Time Alerts** — System-wide event broadcasts via Supabase realtime.

### 4.14 Settings Dashboard (`SettingsView`)
System configuration:
- **Thermal Printer Setup** — Configure ESC/POS hardware and test connections.
- **SMS Configuration** — Twilio credentials and message templates.
- **Receipt Settings** — Paper size, QR integration, barcode display, and tax breakdown.
- **Auto Backups** — Sync database schedules to Google Sheets.
- **Device Permissions** — Camera, geolocation, Bluetooth, notifications, storage.

### 4.15 Profile View (`ProfileView`)
User account management:
- **Profile Editing** — Name, avatar, contact details.
- **Preferences** — App appearance and notification preferences.

### 4.16 Home & Dashboard (`HomeView`, `DashboardView`)
Entry points and overview:
- **Home View** — Quick navigation and recent activity.
- **Dashboard** — High-level operational at-a-glance metrics.

---

## 5. User Roles & Access Control Matrix

| Role | Scope | Default Permissions |
|------|-------|---------------------|
| **Owner / Admin** | Master clearance. Full control over settings, billing, financial profiles, and staff registries. | Overrides all system flags. Full access. |
| **Manager** | Operational management. Oversees sales, stock, staff scheduling, expenses, and analytics. | Business views, settings updates, inventory adjustments, POS sales, customer ledger updates, reports. |
| **Cashier** | Daily point-of-sale operator. Runs shifts and handles client transactions. | POS sales, shift open/close, customer registration, wallet deposits, cash payment verification, local chat. |
| **Rider** | Logistics and deliveries. Handles route fulfillment and cash-on-delivery tracking. | Order log view, delivery zone navigation, route status completion, local chat. |

All data access is enforced server-side via **PostgreSQL Row-Level Security (RLS)** policies tied to tenant business memberships.

---

## 6. Architecture & Data Flow

### 6.1 Frontend Architecture
- **Modular Zustand Stores** — Each domain has its own store:
  - `appStore` — Unified workspace facade aggregating all stores.
  - `authStore` — Onboarding, multi-tenancy, authentication, shifts.
  - `businessStore` — Tenant businesses and branch routing.
  - `cartStore` — POS cart manipulation and checkout.
  - `customerStore` — Loyalty profiles, credit, wallets.
  - `inventoryStore` — Catalog, stock arrivals, wastage.
  - `transactionStore` — Transaction and debt-payment records.
  - `notificationStore` — App-wide notification routing.
  - `extraModulesStore` — Purchases, production, recipes, assets, audits.
  - `uiStore` — Global UI state and chat records.

- **Repository Layer** — `services/repositories.ts` abstracts all database reads/writes with real-time subscription callbacks.

### 6.2 Realtime Data Flow
1. User performs an action (e.g., a POS checkout).
2. The frontend store calls the appropriate repository method.
3. Repository writes to Supabase (PostgreSQL).
4. Supabase Realtime broadcasts the change via WebSocket.
5. All connected devices receive the event and update their local Zustand stores instantly.

### 6.3 AI Pipeline
1. Dashboard collects local metrics (sales, expenses, inventory, customers, staff).
2. Frontend invokes the `bi-analyze` Supabase Edge Function with the full metrics payload.
3. Edge function loads AI settings for the tenant.
4. Calls the configured AI provider (Gemini, HuggingFace, OpenRouter, etc.) with the metrics.
5. Parses the structured JSON response (with robust malformed-JSON repair) and returns the executive report.
6. Dashboard renders the analysis — key insights, risks, opportunities, and a suggested-action checklist.

---

## 7. Database Schema

### Core Tables
| Table | Purpose |
|-------|---------|
| `businesses` | Tenant definitions (name, currency, country, timezone, logo) |
| `branches` | Physical locations and distribution hubs |
| `users` | Master credential directory |
| `employees` | Staff profiles with shift identifiers and tasks |
| `business_memberships` | User-to-business role assignments |
| `invitations` | Staff invitation tokens |
| `role_permissions` | Role-to-privilege mappings |
| `products` | Catalog with pricing, stock, min-stock, category |
| `customers` | Profiles with tier, wallet, credit balance |
| `transactions` | Checkout registers (totals, tax, delivery flags) |
| `transaction_items` | Line items with product snapshots (name, unit price, qty) |
| `shifts` | Punch-clock durations and cash reconciliation |
| `inventory_adjustments` | Wastage and restock records |
| `expenses` | Operational cost tracking |
| `suppliers` | Raw milk vendor profiles |
| `notifications` | Push notification registry |
| `receipt_settings` | Receipt layout and branding |
| `sms_settings` / `ai_settings` | Third-party provider credentials |
| `google_sheets_backup` | Cloud spreadsheet backup sync |

### SQL Views
- `low_stock_products` — Products below safety thresholds.
- `active_credit_debts` — Customers with pending balances.
- `expense_category_summary` — Expenses grouped by category.
- `product_sales_ranking` — Products ranked by velocity and revenue.
- `business_statistics` — Real-time dashboard KPIs.

---

## 8. Getting Started

### 8.1 Prerequisites
- **Node.js** v20+
- **Rust Compiler** & **Cargo** (for Tauri desktop builds)
- **Android Studio** & SDK Tools (for Capacitor mobile builds)
- **Supabase CLI** (for backend management)

### 8.2 Environment Configuration
Create a `.env` file in the project root:
```env
VITE_SUPABASE_URL=your_supabase_project_url
VITE_SUPABASE_ANON_KEY=your_supabase_public_anon_key
VITE_AI_NAME=Kim
VITE_UNSPLASH_ACCESS_KEY=optional_unsplash_api_key
GEMINI_API_KEY=your_google_gemini_api_key
```

### 8.3 Installation
```bash
npm install
```

### 8.4 Running Development Servers
- **Web (Vite):** `npm run dev` → http://localhost:3001
- **Desktop (Tauri):** `npm run tauri:dev`
- **Android Emulator (Capacitor):** `npm run android`

---

## 9. Production Builds

### Desktop (Tauri)
```bash
npm run tauri:build
```
- Windows: NSIS `.exe` installers + `.msi` packages.
- Linux: `.AppImage` + `.deb` packages.

### Mobile (Capacitor)
```bash
./build-local.sh        # Compile unsigned release APK
./sign-apk.sh           # Align and sign the release APK
```
- The signed APK lands at `release-builds/android/isms-release-signed.apk`.
- Install directly on a phone by sharing the APK file and tapping it in the File Manager.

---

## 10. Backend Deployment (Supabase)

```bash
supabase link --project-ref your-project-ref-id
supabase db push
supabase secrets set GEMINI_API_KEY="your-gemini-key"
supabase functions deploy bi-analyze
supabase functions deploy chat
supabase functions deploy mpesa-callback
```

---

## 11. Security & Compliance

- **Row-Level Security (RLS)** — Every tenant's data is isolated behind PostgreSQL policies.
- **Role-Based Access Control (RBAC)** — Granular permission codes gate each operation.
- **Multi-Tenancy** — Businesses and branches are fully isolated.
- **Real-Time Intent** — Online-first architecture requires active connection for critical ops (e.g., live sales processing).
- **Atomic Transactions** — Credit sales use single database procedures to prevent inconsistent wallet/debt states.

---

## 12. Conclusion

ISMS is a modern, enterprise-grade dairy business management platform that combines real-time operations, deep analytics, AI-assisted decision making, and robust multi-tenant security into a unified cross-platform experience. It is engineered to help Kenyan dairy businesses — from single retail outlets to multi-branch processing enterprises — operate more efficiently, track profitability, retain customers, and make smarter data-driven decisions.