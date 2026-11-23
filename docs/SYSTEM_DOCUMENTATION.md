---
title: "KayKay's ISMS — System Documentation"
subtitle: "Integrated Shop Management System: staff app, customer website, dial-code ordering and Supabase backend"
version: "1.0.0"
date: "23 November 2026"
---

# KayKay's App — System Documentation

**Integrated Shop Management System (ISMS)** for KayKay's: the staff app (Android, Windows, Linux), the customer website, dial-code ordering, and the Supabase backend that serves them all.

| | |
|---|---|
| Document version | 1.0.0, matching app release v1.0.0 (numbering restarted; earlier releases went up to 7.x) |
| Date | 23 November 2026 |
| Repository | `github.com/KIMGITO/ISMS` (code; to become private) and `github.com/KIMGITO/kaykays-releases` (public: installers and `latest.json`) |
| Product name | KayKay's (package `com.kaykays.app`, desktop identifier `com.isms.app`) |
| Status | Staff app released; customer website, M-Pesa till flow, dial-code ordering and KRA eTIMS built but not yet run against the live providers |

## Contents

1. Introduction
2. System overview
3. Technology stack
4. Repository structure
5. Roles and access control
6. Staff app: screen map
7. Customer website
8. Dial-code (USSD) ordering
9. Payments and M-Pesa
10. Customers, loyalty, wallets and debts
11. Inventory and production
12. Notifications and messaging
13. AI features
14. Receipts and printing
15. Frontend architecture
16. Database design
17. Edge functions reference
18. Security model
19. Local development setup
20. Building and releasing
21. Automatic updates
22. Deployment and operations
23. Testing
24. Known limitations and current status
25. Troubleshooting

Appendices: A. Environment variables and secrets · B. Permission codes · C. Database migrations · D. Glossary

<div class="page-break"></div>

# 1. Introduction

## 1.1 Purpose

This document describes what ISMS does, how it is built, and how to run, deploy and maintain it. It brings together material that was previously spread across the README, the `docs/` folder, the website README and the notifications notes, and checks it against the code as of release v4.2.1 (9 November 2026). Section 1.5 lists what changed since v2.0.0.

## 1.2 Scope

ISMS covers the whole of KayKay's day-to-day operation:

- **Selling** at the counter (full POS and a keyboard-driven Quick Sale screen), by delivery, online through the website, and by dial code from phones without internet.
- **Getting paid** in cash, by card, bank, M-Pesa (prompts and direct till payments), from a customer's wallet, on credit, or with loyalty points.
- **Stock**: products, restocks, wastage, stock counts, expiry and low-stock alerts.
- **Production**: recipes and bills of materials that turn raw milk into finished goods.
- **Customers**: profiles, loyalty tiers and points, wallets, debts, delivery schedules, duplicates and merging, and contact preferences.
- **Staff**: invitations, roles and permissions, shifts and clock-in, schedules, and rider deliveries.
- **Money**: expenses, payments, money assets per payment method, and an audit trail.
- **Communication**: notifications and push alerts for staff; SMS, WhatsApp and email to customers.
- **AI assistance**: a workspace assistant for staff, business analysis, complaint replies, and a restricted shop assistant for customers.
- **Operations**: releases, automatic updates, backups, rate limits and crash reports.

## 1.3 Audience

| Reader | Most useful sections |
|---|---|
| Business owner or manager | 2, 5, 6, 9, 10, 24 |
| Staff trainer | 5, 6, 11, 14 |
| Developer joining the project | 2–4, 15–19, 23 |
| Whoever deploys and operates the system | 18–22, 25, Appendix A |

## 1.4 Conventions

- Screen names and buttons are in **bold**, for example **Payments & Expenses > M-Pesa**.
- File paths, table names, functions and commands are in `code`.
- Money is in Kenyan shillings (Ksh) unless stated. Times for scheduled jobs are Nairobi time (UTC+3).
- "Owner" includes Admin unless a section says otherwise.

## 1.5 What changed since v4.2.1

Sections 6 onward still describe v4.2.1 in places; the table below is the current state. The staff-facing detail is in `docs/USER_GUIDE.md` (v1.0.0).

| Area | Change | Where in code |
|---|---|---|
| Versions | Numbering restarted at 1.0.0; Android version codes from 20000000 | `scripts/`, `.github/workflows/` |
| Database | 82 migrations squashed into `20261120001` + `20261120002`; later files numbered from `20261121001` | `supabase/migrations/` |
| Navigation | Screens grouped (Selling, Customers, Stock, Buying & deliveries, Money, Reports, Team, Admin, You & the app); G-then-letter keys | `src/utils/screens.ts`, `src/utils/shortcuts.ts` |
| Search | `global_search()` finds records by number; new refs EXP/STM/LOG/LDG | `20261202001` |
| Accounting | Double-entry books posted by `acc_post_source`; Finance & Accounting screen | `20261116003`, `AccountingView.tsx` |
| Sales docs | Quotes from POS, credit notes for refunds, sale edit = refund + re-sell, edits audited | `20261117001`, `20261125001` |
| Buying | Purchases with role approval limits, GRN/BILL/RTS, supplier portal, ask-supplier ringing requests | `20261118001`, `20261123001` |
| Transfers | Branch stock transfers at cost, shortages, By product tab | `StockTransfersView.tsx` |
| Payments | Five methods (Airtel added), per-method on/off, Payment Prompts screen | `PaymentPromptView.tsx` |
| Rewards | Promotion and referral codes at till and website, posted to books; points moved to Promotions & Points | `20261126001`–`003` |
| Regular orders | Per-weekday standing orders, delivered = one sale, ringing reminders | `20261130005` |
| Deliveries | Three delivery modes, trips, rider pay owed on the day (`rider_pay` source) | `20261130001`, `20261130004` |
| Shifts | "Still working?" check at 15 h, worked-hours panel | `20261130002` |
| Permissions | Every app permission enforced in RLS/RPCs; edge functions use `requirePermission` | `20261130006` |
| Numbers | Money `numeric(14,2)` shown with 2 decimals; quantities 1 decimal | `20261130007`, `src/utils/money.ts` |
| Operations | Cloudflare hosting, hourly backups to R2, Telegram alerts, DB watchdog, release gates | `docs/DEPLOYMENT_AND_MONITORING.md`, `docs/TO_FINISH.md` |

Which of these migrations are live is tracked in `docs/TO_FINISH.md`.

### Earlier: what changed in v4.2.1

| Area | Change | Section |
|---|---|---|
| Loyalty | New points rule: 2 per Ksh 1 paid, 1 per Ksh 1 of debt repaid, value by tier; points never become money; points report | 10.1 |
| Customers | Invoices for what a customer owes (A5 PDF, numbered, stored) | User guide |
| Customers | Add a customer to a walk-in sale afterwards, so they get the points | 10.8 |
| Credit | A credit sale is a debt, not a payment: "Sold on credit" notification, receipt marked not paid | User guide |
| Receipts | One layout for preview, print, PDF and WhatsApp; points on receipts; real Bluetooth and Wi-Fi printing | 14 |
| Tax | KRA eTIMS signing; VAT only once eTIMS is connected | 14.4 |
| Offline | Paid sales queue on the device and send on reconnect | 15.4 |
| Home | Rebuilt: charts, four key figures on phones, needs attention, full-screen charts | User guide |
| Stock | Stock History screen; categories in their own table | User guide |
| Shifts | Rebuilt end-of-shift report | User guide |
| Navigation | Payments & Expenses screen; grouped More sheet; double-tap hides the bottom bar | User guide |
| Keyboard | Shortcuts on every screen, filtered by role; ? help; table in About | User guide |
| Search | Global search finds features and shortcuts | User guide |
| Settings | Collapsible sections; Invoices section; settings no longer reset | User guide |
| Text | No database IDs shown; customer names capitalised | 10.9 |
| Security | Invitations bound to the invited email; reset codes only to the login email | 18.3 |
| Updates | Signed desktop updates; `.deb` installs update themselves; Android key pinned in CI | 20, 21 |

# 2. System overview

## 2.1 The parts

ISMS is one Supabase project with four ways in:

| Part | Who uses it | Runs on | Built from |
|---|---|---|---|
| Staff app | Owners, managers, cashiers, riders | Android phones and tablets, Windows and Linux PCs | `src/`, wrapped by Capacitor (`android/`) and Tauri (`src-tauri/`) |
| Customer website | Customers | Any static web host (planned domain: kaykays.com) | `website/` |
| Dial-code ordering | Customers on basic phones | Africa's Talking USSD gateway calling an edge function | `supabase/functions/ussd/` |
| Backend | All of the above | Supabase: PostgreSQL, Auth, Storage, Realtime, Edge Functions, `pg_cron` | `supabase/` |

No server of our own is needed. Safaricom, Africa's Talking and the Supabase notification webhook call edge functions directly.

## 2.2 How the parts connect

```text
  Staff app (React)          Customer website (React)        Basic phone
  Android / Windows / Linux   static host                     dials *xxx#
        |                            |                             |
        |  supabase-js (JWT)         |  supabase-js (JWT)          |  Africa's Talking
        v                            v                             v
  +-----------------------------------------------------------------------+
  |                             SUPABASE                                  |
  |  Auth --- PostgreSQL (RLS, RPCs, triggers) --- Realtime --- Storage   |
  |              ^                     |                                  |
  |              |                     | pg_cron: reminders, daily        |
  |              |                     | portal job, hourly backups       |
  |  Edge functions: chat, bi-analyze, complaints, customer-assistant,    |
  |  customer-checkout, mpesa-payments, mpesa-webhook, till-callback,     |
  |  ussd, send-email, send-fcm, sms-config, whatsapp-config, auth-otp,   |
  |  ai-config, backup-config, sync                                       |
  +-----------------------------------------------------------------------+
        |              |              |              |             |
     Safaricom      Firebase      Twilio /       Resend /      AI providers
     Daraja         (push)        WhatsApp       SendGrid      Google Sheets
```

## 2.3 Design principles

1. **The database is the authority.** Prices, stock, points, balances and permissions are calculated and checked in PostgreSQL. The app hides what a role may not use, but the database refuses it regardless.
2. **Money moves through functions, not table writes.** Sales, wallet top-ups, debt payments, point redemptions and M-Pesa results go through `SECURITY DEFINER` functions that check the caller and update every affected balance in one transaction.
3. **Nothing financial is deleted.** Payments and expenses are voided with a reason; hard deletes on products are trapped.
4. **Real time across devices.** Changes reach every open device through Supabase Realtime, so two tills never disagree about stock.
5. **Keep selling when the network drops.** Sales made offline are queued and sent when the connection returns.
6. **Secrets stay on the server.** API keys for M-Pesa, SMS, WhatsApp, email and AI live in Supabase secrets or settings tables that only edge functions read. The app only ever sees masked values.

<div class="page-break"></div>

# 3. Technology stack

| Layer | Technology | Notes |
|---|---|---|
| UI | React 19, TypeScript 5.8 | Single-page app |
| Build | Vite 6 | Staff app on port 3001; website on 5180 |
| Styling | Tailwind CSS 4 | Staff styles in `src/index.css`; website look in `website/src/theme.css` |
| State | Zustand 5 | One store per domain, combined in `appStore.ts` |
| Charts | Recharts 3 | Dashboard and reports |
| Animation | Motion 12 | |
| Icons | lucide-react | |
| PDF | jsPDF 4 | Receipts and exports |
| QR codes | qrcode | Receipts and verification |
| Backend | Supabase (PostgreSQL 15) | RLS on every table |
| Server code | Deno edge functions | One folder per function, shared helpers in `functions/shared/` |
| Scheduling | `pg_cron`, `pg_net` | Registered by migration `20261105012` |
| Desktop | Tauri 2 (Rust) | Windows `.exe`/`.msi`, Linux AppImage/`.deb`; updater plugin |
| Mobile | Capacitor 8 | Android; custom Java plugins for Bluetooth printing and updates |
| Push | Firebase Cloud Messaging | Through `send-fcm` |
| Payments | Safaricom Daraja | STK push and C2B (till) |
| USSD | Africa's Talking | |
| CI/CD | GitHub Actions | `build.yml`, `release-and-deploy.yml` |

**Version pinning rule.** The Tauri npm packages (`@tauri-apps/api`, plugins) must stay on the same minor version as the Rust crates in `src-tauri/Cargo.toml`, or `tauri build` fails. This is why `package.json` pins them with `~`.

<div class="page-break"></div>

# 4. Repository structure

```text
ISMS/
├── src/                      Staff app (React)
│   ├── App.tsx               Shell, navigation, onboarding, tab routing
│   ├── main.tsx              Entry point
│   ├── components/           Shared widgets (ClockBar, GlobalSearch,
│   │                         MpesaPaymentsPanel, DuplicateCustomers, EndShiftModal...)
│   ├── features/             One file per screen (POSView, InventoryView, ...)
│   ├── core/native/          Platform services: Bluetooth, camera, files, printer,
│   │                         notifications, secure storage, updates
│   ├── hooks/                useForm, useOverlay, useDevicePermission...
│   ├── services/             Supabase client, repositories, notifications,
│   │                         printer/, receipt/, invoice/, loyalty/, offline/,
│   │                         upload/, crash reporter
│   ├── stores/               Zustand stores (auth, business, cart, customer,
│   │                         inventory, transactions, notifications, ...)
│   ├── utils/                permissions.ts, screens.ts, shortcuts.ts, phoneUtils,
│   │                         semver, userError...
│   └── test/runTests.ts      Test suite (npm test)
├── website/                  Customer website (separate Vite build)
│   ├── src/pages/            Home, Shop, Product, Cart, Account, Articles...
│   ├── src/seo.ts            Titles, descriptions, structured data
│   └── scripts/prerender.ts  Writes one HTML file per public page
├── supabase/
│   ├── migrations/           40 SQL migrations (see Appendix C)
│   ├── functions/            18 edge functions + shared/
│   └── dev_wipe.sql          Empties every table to start from scratch (opt-in guard)
├── android/                  Capacitor Android project
│   └── app/src/main/java/com/kaykays/app/
│       ├── AppUpdatePlugin.java        Download, verify and install updates
│       └── BluetoothSerialPlugin.java  Classic Bluetooth printers
├── src-tauri/                Tauri desktop shell (Rust)
├── scripts/                  release-version, update-manifest, stamp-version,
│                             sync-notification-sounds
├── .github/workflows/        build.yml, release-and-deploy.yml
├── docs/                     Guides, including this document
├── public/                   Icons, logo, notification sounds
├── capacitor.config.ts
├── vite.config.ts
└── package.json
```

## 4.1 npm scripts

| Command | What it does |
|---|---|
| `npm run dev` | Staff app in the browser at `http://localhost:3001` |
| `npm run tauri:dev` | Staff app in a desktop window with hot reload |
| `npm run android` | Build, sync to Android and assemble a debug APK |
| `npm run android:cap` | Sync sounds, build, and `cap sync android` |
| `npm run build` | Production web bundle in `dist/` |
| `npm run tauri:build` | Desktop installers for the current OS |
| `npm run lint` | TypeScript check of the staff app |
| `npm test` | Run `src/test/runTests.ts` |
| `npm run website:dev` | Website at `http://localhost:5180` |
| `npm run website:build` | Website build and prerender into `website/dist` |
| `npm run website:lint` | TypeScript check of the website |
| `npm run website:deploy` | Publish the website to Cloudflare, blue-green (Worker `kaykays-website`) |
| `npm run app:deploy` | Publish the staff web app to Cloudflare, blue-green (Worker `kaykays-app`) |
| `npm run sounds:sync` | Copy notification sounds into the Android project |

<div class="page-break"></div>

# 5. Roles and access control

## 5.1 Three layers

A role's access is enforced in three places, so hiding a screen is never the only protection:

| Layer | What it does | Where |
|---|---|---|
| App | Hides screens and buttons | `SYSTEM_ROLES` in `src/utils/permissions.ts` |
| Database | Refuses rows and functions, even for direct API calls | `has_permission()`, migration `20261105014` |
| Edge functions | Refuse the call before doing paid or sensitive work | `requirePermission()` in `supabase/functions/shared/cors.ts` |

## 5.2 Roles

| Role | Purpose |
|---|---|
| Owner / Admin | Full control, including settings, API keys, staff and deletion. Bypass permission checks by design. |
| Manager | Runs the business day to day: sales, stock, customers, expenses, staff schedules, reports. No API keys, no deletes of key records. |
| Cashier | Sells, opens and closes shifts, registers customers, takes payments and debt repayments. |
| Rider | Accepts open delivery requests, completes their own deliveries, and adds or prices delivery areas. |
| Supplier | External. Signs in to the supplier portal only (orders, deliveries, price and stock requests, statement, own details). Held in `supplier_accounts`, never in `business_memberships`. |

Other database roles, such as `Sales Staff` and `Viewer`, exist but have no permissions until an Owner grants some.

## 5.3 Who can see what

| Area | Owner, Admin | Manager | Cashier | Rider |
|---|---|---|---|---|
| Own profile, own shifts, clock in | Yes | Yes | Yes | Yes |
| Home (business figures) | Yes | Yes | No | No |
| Sell | Yes | Yes | Yes | No |
| Inventory | Full | Full | View | No |
| Sales history | All | All | Own sales and customers' sales | No |
| Online orders | All | All | View, prepare | Only assigned deliveries |
| Customers | Full | Full, no delete | View, add | Only customers on their deliveries |
| Debts | Yes | Yes | Yes | No |
| Profit | Yes | Yes | No | No |
| Complaints | Reply | Reply | View, log | No |
| Expenses | Yes | Yes, no delete | No | No |
| Staff | Full | View, schedule | No | No |
| Settings, backups, API keys | Yes | Some settings, no keys | No | No |
| Set points or tiers by hand | Yes | Yes | No | No |
| Set wallet or debt balances by hand | Yes | Yes | No | No |
| Deliveries assigned to them | Yes | Yes | Yes, by assigning | Yes |

## 5.4 Changing access

An Owner or Admin can grant or remove any permission per role in the **Roles** screen. Changes save to `role_permissions`, which both the app and the database read, and override the defaults.

To change the defaults themselves, edit `SYSTEM_ROLES` in `src/utils/permissions.ts` and `role_default_permissions` together, in a new migration. `npm test` fails if the two differ (test "Database role permissions match the app").

The full list of permission codes is in Appendix B.

## 5.5 Riders

Open requests are paid or preparing online orders with no rider, and till delivery sales from the last 3 days with no rider. Only the Rider role can accept one, first come first served; the customer's phone stays hidden until then, and the rider can give it back until they start it. Owners and managers with `deliveries.assign` can group deliveries into a trip (`delivery_trips`) with one rider pay. A till sale can also name a rider who has no account; that name is enough for rider pay (`fn_rider_owed` keys it as `name:<lowercase>`), but the delivery won't show under anyone's **Deliveries**.

<div class="page-break"></div>

# 6. Staff app: screen map

How to *use* each screen is in `docs/USER_GUIDE.md` (v1.0.0); this section only maps screens to code. Screens, their groups, search keywords and permissions are defined once in `src/utils/screens.ts`; keyboard shortcuts (including G-then-letter) in `src/utils/shortcuts.ts`; the phone bottom bar order in `src/utils/mobileNav.ts`. `App.tsx` renders the screen whose id matches `activeTab`, wrapped in `SecurityGuard` with the same permissions.

| Screen id | Group | Title | Component (`src/features/`) | Permission (any of) |
|---|---|---|---|---|
| `home` | Reports | Home | `HomeView` | `home.view` |
| `sell` | Selling | Quick Sale | `QuickSaleView` | `pos.create_sale` |
| `pos` | Selling | POS | `POSView` | `pos.create_sale` |
| `sales` | Selling | Sales Log (Sales, Quotes) | `SalesView` | `orders.view` |
| `online-store` | Selling | Online Store | `OnlineStoreView` | `online_store.view` |
| `prompt` | Selling | Payment Prompts | `PaymentPromptView` | `payments.mpesa / payments.airtel` |
| `customers` | Customers | Loyalty | `CustomersView` | `customers.view` |
| `promotions` | Customers | Promotions & Points | `PromotionsView` | `promotions.* / referrals.* / loyalty.*` |
| `regular-orders` | Customers | Regular Orders | `RegularOrdersView` | `customers.view / customers.schedules` |
| `feedback` | Customers | Feedback (incl. Communication) | `CustomerFeedbackView` | `complaints.view` |
| `inventory` | Stock | Inventory | `InventoryView` | `inventory.view` |
| `stock-history` | Stock | Stock History | `StockHistoryView` | `inventory.stock_history` |
| `stock-transfers` | Stock | Stock Transfers | `StockTransfersView` | `inventory.transfer_stock / receive_stock / request_transfer` |
| `production` | Stock | Production & BOM | `ProductionBOMView` | `bom.view` |
| `buying` | Buying & deliveries | Buying (embeds Suppliers) | `BuyingView` | `suppliers.view / purchases.* / supplier_bills.manage` |
| `deliveries` | Buying & deliveries | Deliveries | `RiderDeliveriesView` | `deliveries.view` |
| `money` | Money | Payments & Expenses | `BusinessManagementView section=money` | `payments.* / expenses.*` |
| `petty-cash` | Money | Petty Cash | `PettyCashView` | `pettycash.record` |
| `finance` | Money | Finance & Accounting (embeds FinanceView as Summary) | `AccountingView` | `finance.view / accounting.view` |
| `stock-report` | Reports | Stock Report | `StockReportView` | `reports.* / inventory.stock_history / finance.view` |
| `dashboard` | Team | Shift | `DashboardView` | `dashboard.view` |
| `workers` | Team | Workers (staff and suppliers) | `WorkersView` | `staff.view` |
| `permissions` | Admin | Roles | `PermissionsView` | `staff.roles` |
| `audit` | Admin | Audit Log | `AuditLogView` | `audit.view` |
| `business-management` | Admin | Business Management | `BusinessManagementView` | `business.update` |
| `settings` | Admin | Settings | `SettingsView` | `settings.view` |
| `ai` | You & the app | Assistant | `WorkspaceAssistantView` | `ai.use` |
| `notifications` | You & the app | Notifications | `NotificationsView` | `none` |
| `profile` | You & the app | My Profile | `ProfileView` | `none` |
| `about` | You & the app | About this app | `AboutView` | `none` |

**Aliases.** Old ids `accounting` → `finance` and `suppliers` → `buying` still work through `SCREEN_ALIASES`; they set `screenSection` so the right tab opens. Removed screens (`invoicing`, `assets`) redirect: quotes live in POS and Sales Log, invoices in Loyalty, files are uploaded where they are used.

**Supplier portal.** A signed-in user with a `supplier_accounts` row and no staff membership gets `SupplierPortalView` instead of the staff shell (orders, bills, stock requests). Suppliers are never in `business_memberships`, so `has_permission` never opens staff data to them.

**Shared components.** Every number box is `NumberInput` (quantities with `decimals={QTY_DECIMALS}`), money is shown with `formatMoney`; lists with delete use `SwipeRow`; grouped tabs use `GroupedTabs`. No native `<select>` or checkbox in `src/`.

**Area advisors.** `AreaAdvisor` cards (areas rewards, money, finance) call the `area-advisor` edge function, which reads figures with the user's own RLS; the AI only explains.

# 7. Customer website

## 7.1 What customers can do

The website (`website/`) is a separate Vite build that shares only the Supabase project. Customers can:

- Browse the shop and product pages, read milk guides and articles.
- Create an account by email, or with Google, Apple or a phone number once those are set up.
- Add to cart and pay by M-Pesa prompt, choosing a delivery area.
- See their orders, points (Rewards), schedules, messages and contact preferences under **Account**.
- Set up repeat orders (schedules), send feedback, and contact the shop.
- Ask the shop assistant about products, availability and totals.

Routes: `/`, `/shop`, `/products/...`, `/cart`, `/articles/...`, `/feedback`, `/contact`, `/account`.

## 7.2 How the website reaches data

Customers sign in through Supabase Auth and have no business membership, so staff policies exclude them. They read only their own rows through RLS and write only through database functions such as `place_online_order`, `request_regular_order`, `update_my_profile`, `update_my_account` and `redeem_my_points`. The shop's public data comes from `get_public_storefront`, which returns only what customers should see.

**Never add anon or customer policies on `products` or `businesses`.** A policy can't hide columns, so it would expose `products.cost` and other private fields.

## 7.3 Orders and payment

1. `place_online_order` prices everything on the server; the website's own totals are never trusted. Totals are rounded down to whole shillings because M-Pesa rejects cents.
2. `customer-checkout` (action `pay`) starts an STK push for the customer's own order. It is limited to 6 attempts per 10 minutes per customer.
3. Safaricom calls `mpesa-webhook`, which records the result. Only this callback can mark an order paid.
4. Payment inserts an ordinary `transactions` row, so the usual triggers update stock, loyalty points and money assets.
5. Wrong amounts, second payments and stock shortages are flagged for staff under **Online Store > Orders**.

Refunds are manual: staff handle them in M-Pesa and the POS. Points used on a cancelled order are returned (`fn_refund_order_points`).

## 7.4 Schedules

A daily job, `run_customer_portal_daily` at 05:00 Nairobi time, turns due schedules into unpaid orders and messages the customer, because M-Pesa needs their PIN for each payment. It also cancels orders left unpaid for 48 hours.

## 7.5 Shop assistant

`customer-assistant/logic.ts` answers availability, quantity and total questions in code, from live stock. The language model only sees general guides and the customer's text, never stock or cost figures, and its replies are checked before the customer sees them. Usage is capped per customer (`assistant_usage`, `consume_assistant_quota`).

## 7.6 Search engines and sharing

`website/src/seo.ts` holds each page's title, description and structured data (Store, Product, Article, BreadcrumbList), generated from real business data. `scripts/prerender.ts` writes a separate HTML file per public page at build time, so search engines and link previews see the right content. Cart and account pages are never indexed. Until `VITE_SITE_URL` is set, every page asks search engines not to index it.

Rebuild and upload the site after adding products or guides or changing prices so search results stay current. Customers always see live data either way.

## 7.7 Look and photos

`website/src/theme.css` holds the whole public look: colours, fonts (Italiana and Manrope), buttons and fields. The home page hero is a carousel (`HeroCarousel.tsx`). Visitors whose device asks for reduced motion get a still page. Temporary Unsplash photos in `src/images.ts` carry credits in the footer and are replaced as soon as a product, guide or business has its own image.

## 7.8 Going live

1. Apply the migrations, including `20261105002_security_hardening.sql` and `20261105010_customer_portal.sql`.
2. Set the M-Pesa secrets, starting with `MPESA_ENV=sandbox` (Appendix A).
3. Deploy `customer-checkout`, `mpesa-webhook` and `customer-assistant`.
4. In Supabase Auth, add the website address to the redirect URLs and set up an email provider.
5. In **Online Store > Website**, set the website name to `kaykays`, set the delivery fee or delivery areas, and untick products customers shouldn't see.
6. Add, check and publish the starter guides under **Online Store > Guides**.
7. Fill in the business description, address, phone and email in **Business Management**.
8. Run `npm run website:build` and upload `website/dist`. The host must serve `index.html` for unknown paths; `_redirects` (Netlify, Cloudflare Pages) and `404.html` (GitHub Pages) are included.
9. Make a sandbox payment, then switch to production till credentials and make one small real payment before announcing the site.

To connect kaykays.com: point the domain at the host with HTTPS, set `VITE_SITE_URL=https://kaykays.com`, rebuild and upload, add `https://kaykays.com/account` to the Supabase redirect URLs, and submit `https://kaykays.com/sitemap.xml` in Google Search Console.

## 7.9 Sign-in options

Email works without further setup. The Google button shows by default and explains that it isn't available until set up. For phone and Apple, finish the provider setup, add the option to `VITE_AUTH_PROVIDERS` (for example `google,phone,apple`), and rebuild.

Google and Apple both return customers to `https://<project-ref>.supabase.co/auth/v1/callback`. Customers who sign in with Google, Apple or phone are asked for any missing name and M-Pesa number the first time. Apple's client secret must be renewed every six months, or Apple sign-in stops. The detailed provider steps are in `docs/INTEGRATIONS.md`.

<div class="page-break"></div>

# 8. Dial-code (USSD) ordering

## 8.1 Purpose

Dial-code ordering lets customers without a smartphone or internet order and pay from any phone, through Africa's Talking.

## 8.2 What a caller can do

- Create an account with just their name.
- Order from the first seven products in stock.
- Pay by M-Pesa prompt (the line must have M-Pesa).
- Check their orders, points and balances.

The mobile network supplies the phone number, so it identifies the caller. Someone with a website account under another login gets a separate dial-code account.

## 8.3 How it works

Africa's Talking sends `sessionId`, `serviceCode`, `phoneNumber` and `text` on every step, with each answer so far joined by `*`. The menu is a pure function in `ussd/menu.ts`, so it can be tested without a gateway. Each reply starts with `CON` to continue or `END` to finish. Requests are authorised by `USSD_CALLBACK_TOKEN` in the callback URL and limited to 40 per 10 minutes per phone.

The gateway expects a reply within 10 seconds. Placing an order calls M-Pesa inside that time, so a slow M-Pesa response can show the caller a network error. This must be tested on the live service.

## 8.4 Setting it up

**Sandbox (free):**

1. Create an Africa's Talking account and open the sandbox (username `sandbox`).
2. Generate a token with `openssl rand -hex 32`, then:

   ```bash
   supabase secrets set USSD_CALLBACK_TOKEN=<token> USSD_SHOP_SLUG=kaykays
   supabase functions deploy ussd
   ```

3. Under **USSD > Create Channel**, set the callback to `https://<project-ref>.supabase.co/functions/v1/ussd?token=<token>`.
4. Dial it on the Africa's Talking simulator.

**Live:** request a service code (a shared code such as `*384*123#` is the usual start; approval can take weeks), top up the account, set the same callback on the live channel, and test one order from a real phone.

<div class="page-break"></div>

# 9. Payments and M-Pesa

## 9.1 Payment methods

| Method | Effect |
|---|---|
| Cash, M-Pesa, Airtel Money, Card, Bank | Added to that method's money asset. Each can be switched off per business (`businesses.default_payment_methods`, `payments.configure`); an off method is hidden and its prompts or charges are refused server-side |
| Mobile Wallet | Taken from the customer's wallet balance |
| Credit | Added to the customer's debt; no money asset changes until repaid |
| Points | Taken from the customer's points at the configured value |

Each money asset (`money_assets`) keeps a running balance per business and method. Every change is written to `payment_asset_ledger` with the balance before and after, so the history can always be reconstructed. Expenses reduce the asset they were paid from (`fn_process_expense_asset_update`).

## 9.2 M-Pesa: a till, not a paybill

KayKay's uses an M-Pesa **till** (Buy Goods). A payment a customer sends to a till from their own phone carries **no account number**, so it can't be matched to a customer automatically. The system handles M-Pesa three ways:

| How the customer pays | What happens |
|---|---|
| Online order or dial code | A prompt goes to their phone; the order settles when they pay. |
| Staff press **Send M-Pesa prompt** | A prompt goes to their phone. When they pay, the payment is recorded automatically, against their debt first and then their wallet, or as a walk-in. |
| They pay the till from their own phone | The payment waits under **Paid to the till** until staff choose **Record for customer**, **Already rung up as a sale**, **Walk-in, not a sale**, or **Ignore** with a note. |

## 9.3 The functions involved

| Function | Called by | Role |
|---|---|---|
| `mpesa-payments` | Staff app | `status`, `save_till`, `register` (tell Safaricom where to send till payments), `request` (send a prompt), `check` (ask about a prompt with no answer) |
| `customer-checkout` | Website | Prompt for a customer's own order |
| `mpesa-webhook` | Safaricom | Result of every STK prompt, matched by CheckoutRequestID |
| `till-callback` | Safaricom | Direct till payments (C2B): `?type=validation` and `?type=confirmation` |
| `process_business_payment` | Database | Records a matched payment against debt, then wallet |
| `record_till_payment`, `handle_till_payment` | Database | Queue and resolve direct till payments |
| `log_mpesa_payment` | Database | Logs the payment and raises **Payment Received** (never for a credit sale) |

Safaricom refuses callback URLs containing words like "mpesa", which is why the C2B function is called `till-callback`.

## 9.4 Account numbers

Every customer has an account number from 100001 (a global sequence, kept through merges by `fn_keep_customer_account_number`). It appears on the customer's page and goes out as the account reference on prompts. If the business ever adds a paybill, payments quoting the number can be matched automatically.

## 9.5 Rate limits on prompts

Staff prompts are limited to 60 per hour per person and 600 per day per business; website checkout to 6 per 10 minutes per customer.

## 9.6 Setting up M-Pesa

1. Create an app at developer.safaricom.co.ke and make a sandbox payment first.
2. Apply to go live for the till. Safaricom issues the store number and passkey.
3. Set the secrets:

   ```bash
   supabase secrets set MPESA_ENV=production MPESA_CONSUMER_KEY=... \
     MPESA_CONSUMER_SECRET=... MPESA_SHORTCODE=<store number> \
     MPESA_PARTY_B=<till number> MPESA_PASSKEY=... \
     MPESA_TRANSACTION_TYPE=CustomerBuyGoodsOnline \
     MPESA_CALLBACK_TOKEN=<long random string>
   ```

4. Deploy `mpesa-webhook`, `mpesa-payments` and `till-callback`, and apply migration `20261106001`.
5. In **Payments & Expenses > M-Pesa**, enter the till number and press **Register till with Safaricom**. Each branch with its own till does this once.

Set `MPESA_C2B_SHORTCODE` if Safaricom registers the till under a different short code from `MPESA_SHORTCODE`. In the sandbox, Daraja's test short code is a paybill, so use `CustomerPayBillOnline` and leave `MPESA_PARTY_B` empty.

## 9.7 Voiding

Payments are voided, never deleted (`DELETE` is revoked on the payment tables). A void records who, when and why, and reverses the money asset.

<div class="page-break"></div>

# 10. Customers, loyalty, wallets and debts

## 10.1 Points

The rule since 8 November 2026 (migration `20261108002`):

| Event | Points |
|---|---|
| Paid sale to a registered customer | **2 points per Ksh 1** of goods; delivery fees excluded |
| Credit sale | Nothing when it is made |
| Money paid towards a debt | **1 point per Ksh 1** repaid (`fn_debt_payment_points`) |
| Walk-in sale | Nothing, unless a customer is added afterwards (section 10.8) |

**What a point is worth depends on the tier**, so small customers feel the reward and big spenders can't drain the business:

| Tier | Points per Ksh 1 | Value of one point |
|---|---|---|
| Bronze | 50 | Ksh 0.02 |
| Silver | 100 | Ksh 0.01 |
| Gold | 200 | Ksh 0.005 |

The values are stored in `loyalty_settings.value_bronze`, `value_silver` and `value_gold`, set in **Online Store > Website**, and read through `fn_point_value()`. The app's copy is `src/services/loyalty/pointValue.ts`; a test checks the two agree. The minimum to redeem is 100 points.

**Points are not money.** They never become cash, M-Pesa or wallet balance.

- At the till (`spend_points_at_till`) and online they come off the price as a discount.
- On the customer's page they can only pay off debt, using just the points the debt needs and settling the oldest credit sales first.
- Debt paid with points (`loyalty_redemptions.kind = 'account'`) is taken off Home profit. Till and online redemptions are already netted out of the sale total.
- Points used on a cancelled order come back. A website order must leave at least Ksh 1 to pay by M-Pesa.

Every point earned is logged in `loyalty_points_earned`, which feeds the **Points report** on the Loyalty screen. Balances earned under the old rule (1 point per Ksh 100) were multiplied by 200, once, when the migration ran (`app_data_conversions` records that it ran).

## 10.2 Tiers

Tiers keep the same spending thresholds as before; the point figures are the new equivalents.

| Tier | Total spend | Equivalent points |
|---|---|---|
| Bronze | Ksh 0 – 9,999 | 0 – 19,999 |
| Silver | Ksh 10,000 – 29,999 | 20,000 – 59,999 |
| Gold | Ksh 30,000 and above | 60,000 and above |

`calculate_customer_tier` sets the tier; `fn_raise_customer_tier` only ever raises it automatically. Owners and Managers can set it by hand.

## 10.3 Wallets

A customer can deposit money in advance (`process_wallet_topup`) and spend it at the till (`process_wallet_spend`). Every movement is in `wallet_transactions` and the customer ledger.

## 10.4 Debts

A sale paid by Credit adds to the customer's debt. Repayments (`process_debt_payment`) clear the oldest debts first (`settle_customer_debt_fifo`) and are recorded in `debt_payments` and `credit_payments`. `v_open_debts` lists customers with balances, and a **Debt Due Reminder** notification can be raised.

Balances can't be changed by direct table writes: `fn_guard_customer_balances` refuses them unless they come through the proper function or from an Owner or Manager adjusting by hand.

## 10.5 Duplicate customers and merging

A customer added by staff and the same person signing up online start as two records. They are never linked automatically, because a phone number typed at sign-up isn't proof of who someone is. Staff with `customers.manage` review matches under **Customers > Duplicates** (`find_duplicate_customers`), and are told when a sign-up uses a number already on file (`fn_flag_duplicate_signup`). Pairs that aren't duplicates can be dismissed.

| Data | When merged (`merge_customers`) |
|---|---|
| Debt, wallet, points, purchases | Added together, then wallet money clears debt |
| Sales, payments, ledger, online logins | Move to the kept record |
| Tier | The higher one, or higher still if the combined points earn it |
| Customer type, payment terms, delivery schedule, notes | The kept record's |
| Name, phone, email | Staff choose |
| Order updates | Off if either record turned them off |
| Offers | On if either record agreed |

Each merge is saved in `customer_merges` with both records as they were. There is no undo button. A device still using the old record has its new sales moved to the kept record (`fn_redirect_merged_customer`), and its balance changes refused until it refreshes (`fn_block_merged_customer_balances`).

**Planned:** once SMS codes can verify phone numbers, automatic linking will be added only for one matching individual with no debt or wallet balance. Institutions, numbers on several records, and records with a balance will stay with staff, because numbers get reassigned.

## 10.6 Contact preferences

Customers choose in their website profile, and staff can record the choice on the customer's form. Order updates and reminders are on by default; offers need the customer's agreement. `fn_contact_allowed` is checked by every sending function.

## 10.7 Customer groups

Migration `20261105013` groups customers by customer type, payment terms and delivery rhythm, set on the customer form. The same migration moved tier changes to the server, added point redemption, and allowed sign-ups without an email (phone or dial code). Staff can also pick items to follow in reports (`report_tracked_items`).

## 10.8 Adding a customer to a past sale

Quick sales skip the customer for speed, but the customer still wants the points. **Add customer** on the Quick Sale success banner (F7) or on any receipt (A) puts a paid walk-in sale on a customer's account through `attach_sale_to_customer` (migration `20261108003`). The customer gets what the sale would have earned at the till: the points (2 per Ksh 1, delivery excluded), one more purchase, and a line in the points report.

| Who | Which sales |
|---|---|
| Cashier (`pos.create_sale`) | Their own sales from the last 24 hours |
| Manager (`orders.update` or `customers.loyalty`) | Any sale from the last 30 days |

Only paid sales with no customer yet qualify. Once set, the customer can't be swapped, so points never move between accounts. An offline sale gets the customer on its queued copy and sends both together.

## 10.9 Names and readable text

Customer names are stored and shown with every word capitalised (`fn_capitalize_words` triggers in the database, `customerName()` in the app). Text people read, such as stock history, customer history, invoices and notifications, never carries raw database IDs: sales are named by receipt number (`fn_readable_ids`, migration `20261108004`), and the app tidies older stored text when it loads it.

## 10.10 Promotions and referrals

All promotions live in `website_promo_codes` (the name is kept for the online functions); `origin` is `manual`, `referral_welcome` or `referral_reward`. The till uses the same flow as points: `promo_check` → `promo_reserve` (a 20-minute hold with the discount worked out on the server) → the sale is saved with `promotion_redemption_id` in one transaction → a deferred trigger recomputes from the saved lines and refuses the whole sale on any mismatch → `promo_release` on failure. Sales with a code never go to the offline outbox. Books: Sales gross plus 4050 Promotion discounts; wallet referral rewards post `referral_reward` (6150 / 2100). Referral rewards are idempotent (one per referral and side) and paid by `run_referral_jobs` after a wait period; flagged ones wait for a manager. Detail: `docs/PROMOTIONS_AND_REFERRALS.md`.

## 10.11 Regular orders

`regular_orders` holds customer + product + `day_qty[7]` (Sunday to Saturday); `regular_order_days` holds one-day changes, skips (with a message) and deliveries (`transaction_id`). Tables have no direct grants: everything goes through RPCs. `deliver_regular_orders` makes one sale per customer through `process_customer_transaction` ("on account": wallet first, then debt). Undo is a credit note; a trigger on `credit_note_lines` puts the day back to due. Website requests (`request_regular_order`) need `customers.manage` to approve; staff with `customers.schedules` set orders directly. The older `customer_order_schedules` table is read-only.

<div class="page-break"></div>

# 11. Inventory and production

## 11.1 Stock movements

| Movement | Recorded in | Effect |
|---|---|---|
| Sale | `transaction_items` | Stock down (`fn_process_transaction_item`) |
| Restock | `inventory_adjustments` (Restock) | Stock up |
| Damage or wastage | `inventory_adjustments` (Damage) | Stock down |
| Stock count | `inventory_adjustments` (Reconciliation) | Stock set to the counted figure |
| Purchase from supplier | `purchases`, `purchase_items` | Stock up when received |
| Production batch | `production_batches` | Raw materials down, finished goods up |

`adjust_stock_manually` and `adjust_stock_bulk` check permissions and log who changed what.

## 11.2 Suppliers and purchases

Suppliers (for example raw milk cooperatives) are kept in `suppliers`; a supplier invited with an email also gets a `supplier_accounts` login to the supplier portal.

A purchase moves Pending → RFQ → Awaiting approval → Ordered → Part received → Received (or Cancelled). Each role can have an approval limit (`purchase_approval_limits`); the trigger `fn_purchase_guard` turns an "Ordered" save above the limit into "Awaiting approval". Receiving (`receive_purchase`, GRN-…) adds stock and posts Dr Stock / Cr 2050 goods received not invoiced; the supplier bill (BILL-…) clears that, with input VAT and any price difference; returns (RTS-…) reverse it. The branch that orders pays the supplier. `buying-nightly` refreshes reorder suggestions.

**Branch transfers** (`stock_transfers`) are not sales: send takes stock off at cost (account 1210 in transit), the receiver counts what arrived, and shortages are settled as late, found or written off. Branches must share an active Owner.

**Ask supplier** (`supplier_stock_requests`) sends one chosen supplier a ringing request from a low-stock alert; replies come back as notifications.

## 11.3 Bill of materials and production batches

Recipes turn raw materials (milk) into finished goods (yogurt, mala and so on).

- A **bill of materials** (`bill_of_materials`, `bom_ingredients`) links a finished product to the ingredients and quantities per unit.
- **Creating a batch** (`fn_create_production_batch`) works out what is needed, refuses if stock is short, and deducts the raw materials.
- **Completing a batch** (`fn_complete_production_batch`) adds the finished goods.
- **Cancelling a batch** (`fn_cancel_production_batch`) puts unused raw materials back and records the rest as waste.

All three run atomically in the database, so a failed step changes nothing. The calculations are covered by tests ("BOM Batch Ingredient Requirement & Stock Shortage Calculation", "Batch Cancellation Restocking vs Waste Split Logic").

## 11.4 Assets

`business_assets` records the business's equipment (cooler, motorbike, separator) under the `assets.*` permissions. There is no separate assets screen; files are uploaded where they are used.

<div class="page-break"></div>

# 12. Notifications and messaging

## 12.1 How a notification travels

1. Something happens: a trigger (low stock), a database function (M-Pesa payment), a scheduled job (reminders), or the app (shift closed).
2. A row is inserted into `notifications` with its type, priority, payload and target user or role.
3. The `trg_push_new_notification` trigger (migration 20261109006) calls `send-fcm` through `pg_net`. It reads the Vault secrets `project_url` and `fcm_webhook_secret` (or `service_role_key`). Don't also add a dashboard webhook, or every push arrives twice.
4. `send-fcm` asks `fn_notification_recipients` who should get it, honouring each person's preferences, then pushes through Firebase to their registered devices (`device_fcm_tokens`). Dead tokens are removed automatically.
5. The row's status moves from `pending` to `sent` (or `delivered` when no device token exists).
6. Open apps receive the row through Realtime and show it in the inbox with a sound and a banner.

`send-fcm` only accepts calls carrying the service role key or `FCM_WEBHOOK_SECRET`. The Vault secret the trigger sends must match one of those, or pushes stop. Check `net._http_response` for 401s after a test notification.

Alarms (Shift page) go off at the set time, checked every minute. They ring until Accept, using the ringing tone chosen in Notification settings, which is separate from the notification tone.

## 12.2 Who gets what

`fn_notification_catalog()` is the single list of categories. Each person's choices are stored in `notification_preferences`, so they follow them across devices.

| Category | Who can have it |
|---|---|
| Stock | `inventory.view` |
| Sales reports | `reports.sales` |
| Debts | `customers.debts` |
| Deliveries | `deliveries.view`, and anyone a delivery is assigned to |
| Payments | `payments.view` or `payments.verify` |
| Online store | `online_store.view` |
| AI insights | `ai.insights` |
| Schedules, announcements | Everyone, limited to the role named on the notification |
| Account and security | Everyone; can't be turned off |

Everything is on by default for those who can have it. Pausing turns off everything except account and security alerts.

## 12.3 Notification types

| Type | Source | Priority |
|---|---|---|
| Schedule Reminder | `flag_due_schedule_reminders()` every 15 minutes | high |
| Out Of Stock | `fn_check_low_stock` trigger | critical |
| Stock Almost Finished | `fn_check_low_stock` trigger | high |
| Payment Received | `log_mpesa_payment` | high |
| Custom Notification | App: shift open/close, clock in/out, end-of-shift report | caller sets |
| AI Business Insight, AI Recommendation, AI Risk Alert | AI analysis | medium / high |
| Delivery Assigned, Delivery Completed | Delivery flow | medium |
| Sales Summary, Daily, Weekly, Monthly Report | Report generators | medium |
| Credit Sale | Sale on credit ("Sold on credit"; a debt, not a payment) | medium |
| Debt Due Reminder | App | high |
| Low Cash Balance | Cash drawer monitor | medium |
| Role Invitation | Invitation flow | high |
| Account Activity | Auth and security | medium |
| System Update | Release pipeline | low |
| Business Announcement | Owner broadcast | low |

## 12.4 The notification screens

**Notifications** has a category panel (All Activity, Stock & Inventory, Sales & Reports, Deliveries, Payments, AI Insights, Schedule Reminders, System & Security), tabs for All, Unread, Important and Reminders, search, and delivery status badges.

## 12.5 Android specifics

Android uses notification channels `default`, `alerts` and `shifts`, a monochrome milk-glass status icon (`ic_stat_name`), and amber (`#F59E0B`) as the notification colour. Local reminders are scheduled on the device with `@capacitor/local-notifications`. Twelve notification sounds are bundled and copied into the Android project by `npm run sounds:sync`.

## 12.6 Customer messaging channels

| Channel | Function | Notes |
|---|---|---|
| SMS | `sms-config` (Twilio) | 200 per hour per person, 1,000 per day per business |
| WhatsApp | `whatsapp-config` (Meta Cloud API) | Free text only within 24 hours of the customer's last message; otherwise an approved template whose body is one variable. Delivery reports aren't tracked. |
| Email | `send-email` (Resend or SendGrid) | 30 per hour per person; branded HTML template |
| Website messages | `customer_messages` | `staff_send_customer_message`, `send_customer_message` |

<div class="page-break"></div>

# 13. AI features

## 13.1 Providers

AI calls go through `supabase/functions/shared/ai-runner.ts`, which supports Google Gemini, OpenAI, Anthropic Claude, DeepSeek, Groq, OpenRouter and Hugging Face (the default provider, with token rotation). The Owner chooses the provider and model and enters keys in **Settings**; the `ai-config` function stores them in `ai_settings` and only ever returns masked keys.

## 13.2 Features

| Feature | Function | Permission | What it does |
|---|---|---|---|
| Workspace assistant ("Kim" by default, set by `VITE_AI_NAME`) | `chat` | `ai.use` | Answers questions about catalogue, stock, customers and staff in plain text; can propose actions |
| Business analysis | `bi-analyze` | `ai.insights` or `reports.view` | Turns dashboard figures into a structured report with insights, recommendations and risks |
| Complaints | `complaints` | `complaints.view` | `analyze`, `generate_reply`, `improve_reply`, `analytics` |
| Shop assistant | `customer-assistant` | Public, quota per customer | Restricted answers for website customers (section 7.5) |

## 13.3 Human in the loop

The workspace assistant never changes data on its own. Actions it suggests, such as creating a schedule, adjusting stock or preparing a checkout, go to the **Pending actions** drawer (`pendingActionStore.ts`). A person with the required permission checks the details, edits them if needed, and approves or rejects. The action then runs with that person's permissions, not the AI's.

## 13.4 Limits

AI is limited to 20 requests per minute per person and 500 per day per business. Without a configured provider, AI answers are unavailable and the rest of the app works normally.

<div class="page-break"></div>

# 14. Receipts, printing and KRA eTIMS

## 14.1 One receipt layout

`src/services/receipt/layout.ts` builds a receipt once, as lines, and that one layout feeds the on-screen preview, the ESC/POS print, the PDF and the WhatsApp text. Every copy therefore matches the paper. Change the layout there, never in one output.

Receipt settings (`receipt_settings`, **Settings > Receipts & printing**) control paper width and characters per line, logo, shop details, header and footer text, the barcode (Code 128) and an extra QR code. A receipt shows:

- Items, totals, tax and payment. A credit sale is marked as not paid.
- **Points**: points used and their value, points earned, and the new balance. Points spent at the till are linked to the sale (`link_till_points`, migration `20261107003`), so reprints on any device show them.
- The receipt number (`TXN-XXXXXXXX`), the same everywhere (`formatReceiptNumber` in the app, `fn_receipt_number` in the database).
- A **KRA** section and verification QR only when KRA has actually signed the sale (section 14.4).

Nothing on a receipt is a placeholder: there are no default contact details, made-up AI lines or fake verification links.

## 14.2 Sharing a receipt

The receipt sheet opens from Quick Sale, POS, the Sales Log and customer history, with the customer's phone and email filled in.

| Action | Key | What happens |
|---|---|---|
| Print | P, Ctrl+P | Choose a printer, confirm, print |
| WhatsApp | W | Sends the receipt as monospaced text |
| Email | E | On Android, attaches the PDF to the customer's address |
| PDF | D | Saves or shares a PDF |
| Copy | C | Copies the receipt text |
| Barcode | B | Turns the barcode on or off |
| Add customer | A | Puts a walk-in sale on a customer (section 10.8) |

## 14.3 Printers

`src/services/printer/` holds the print queue, connection manager and ESC/POS generator. Every print goes through the printer picker, which scans and asks for confirmation. There is no simulated printer.

| Device | Bluetooth | Wi-Fi / LAN (port 9100) |
|---|---|---|
| Android | Yes (`BluetoothSerialPlugin.java`, classic serial, with discovery) | Yes (`NetworkPrinterPlugin`) |
| Windows, Linux desktop | — | Yes (Rust commands in `src-tauri/src/lib.rs`) |
| Plain browser | — | — (PDF only) |

QR codes print as raster images; text is folded to printer-safe ASCII. Printer settings are stored per business in `printer_settings`, and **Test print** checks the connection. On Android, pair a Bluetooth printer once in Android settings first.

## 14.4 KRA eTIMS

KRA eTIMS (OSCU) signs each sale with KRA. It is set up per business in **Settings > Receipts & printing > KRA eTIMS** with:

- **System**: KRA test system (sandbox) or KRA live system. Sandbox receipts are marked as not valid.
- **KRA PIN**, **Branch ID** (00 for head office) and **Device serial number** from the eTIMS OSCU approval.
- **Item classification code** for products that have none.
- **Sales without VAT are** Non-VAT (D), Exempt (A) or Zero-rated (C). This is used when the business tax setting is off, and for delivery fees, which the app charges without VAT.

The `kra-etims` edge function checks the details with KRA before saving (`connect`), signs each sale from the stored sale (`sign_sale`), and numbers invoices in sequence (`kra_next_invoice_no`). The communication key KRA issues lives in `kra_etims_secrets`, which no app user can read. Signatures are stored in `kra_etims_receipts`; registered products in `kra_etims_items`.

VAT can only be switched on or changed once eTIMS is connected. An offline sale is signed when it syncs.

**Status:** the function is deployed but has never been run against the KRA sandbox. Endpoint paths, the item code format and the verification QR address follow the specification and must be confirmed in the sandbox before going live.

## 14.5 Tests

"Receipt layout keeps every line inside the paper width", "Receipt shows the KRA block only with a real signature", "Receipt shows points used, earned and the balance", "Code 128 table and checksum", "ESC/POS output starts with init, ends with cut, has only printable text", plus the receipt and customer number formatters.

<div class="page-break"></div>

# 15. Frontend architecture

## 15.1 Layers

```text
  features/*View.tsx        Screens
        |
  components/               Shared widgets
        |
  stores/ (Zustand)         State and actions per domain; appStore.ts combines them
        |
  services/                 repositories.ts, supabaseService.ts, notifications,
        |                   printer, receipt, upload, network, realtime
  core/native/              Platform services (Capacitor / Tauri / browser)
        |
  Supabase client           supabaseClient.ts (auth, RPC, Realtime, Storage)
```

## 15.2 Stores

| Store | Responsibility |
|---|---|
| `authStore` | Sign-in, sign-up, onboarding, memberships, the current employee, shifts |
| `businessStore` | Businesses, branches, switching, business settings |
| `cartStore` | The sale being built: items, quantities, discounts, payment, delivery |
| `transactionStore` | Completed sales and their sync state |
| `inventoryStore` | Products, categories, adjustments, wastage |
| `customerStore` | Customers, wallets, debts, points |
| `extraModulesStore` | Purchases, production, recipes, assets, audit logs, expenses |
| `notificationStore` | Inbox, unread counts, toasts, schedule reminders |
| `pendingActionStore` | AI-proposed actions awaiting approval |
| `uiStore`, `overlayStore` | Active screen, modals, chat history |
| `updateStore` | Update state shown on the About page |
| `systemHealthStore` | Connection and service health |
| `appStore` | One facade over all of the above |

## 15.3 Real time

`realtimeService.ts` subscribes to Supabase Realtime for the current business. When a row changes on another device, such as a sale reducing stock, the relevant store updates and the screen re-renders.

## 15.4 Offline sales

`networkService.ts` tracks whether the device is online. **Paid sales** (Cash, Card, and M-Pesa with a code typed in) made while offline are queued on the device (`src/services/offline/salesOutbox.ts`, local storage key `kaykays.offline.sales.v1`) with status `Offline_Pending`. `transactionStore.syncOfflineSales` sends them when the connection returns and when the app starts.

- **Safe to replay.** A unique index on `(business_id, reference_id)` means a sale sent twice is saved once; the app treats the duplicate as already saved and adds any missing sale lines.
- **Online only:** credit sales, live M-Pesa prompts, and other changes (stock edits, customers, payments, expenses).
- **On screen:** offline items are rose red with a cloud icon, not error-red; the Sales Log tags them **Waiting to sync**, and a strip under the header shows how many are unsent.
- Prices and stock are re-checked by the database when the sale arrives; KRA signing happens then too.

The older `sync` edge function and `offline_sync_queue` table remain for queued sales across restarts and device switches.

## 15.5 Uploads

`services/upload/` follows a ports-and-adapters design: domain entities and ports, a Supabase upload client, an offline upload queue, and a `ProcessUploadUseCase`. Images go to the Storage buckets in section 16.7.

## 15.6 Native layer

`src/core/native/` wraps platform features behind one interface each, so screens don't care whether they run on Android, desktop or in a browser: Bluetooth, camera, device info, files, geolocation, notifications, permissions, printer, secure storage, share, splash screen, status bar and updates.

## 15.7 Errors shown to people

`utils/userError.ts` (`toUserMessage`) turns technical errors into plain sentences and keeps friendly ones as they are, so staff never see stack traces or SQL. Crashes are reported separately (section 22.5).

<div class="page-break"></div>

# 16. Database design

## 16.1 Tenancy

Every business table carries `business_id`. Row-level security policies let a signed-in person reach only rows of businesses they are an active member of (`get_user_business_ids`, `assert_business_member`). Functions that act on a business check membership and permission first (`assert_permission`, `has_permission`).

## 16.2 Tables by area

| Area | Tables |
|---|---|
| Identity and access | `businesses`, `branches`, `users`, `employees`, `business_memberships`, `invitations`, `role_permissions`, `role_default_permissions`, `otps`, `rate_limits`, `supplier_accounts`, `security_events` |
| Products and stock | `products`, `product_categories`, `inventory_adjustments`, `suppliers`, `purchases`, `purchase_items`, `stock_transfers`, `stock_transfer_items`, `supplier_stock_requests` |
| Production | `recipes`, `recipe_ingredients`, `bill_of_materials`, `bom_ingredients`, `production_batches` |
| Sales | `transactions`, `transaction_items`, `offline_sync_queue`, `receipt_verifications`, `kra_etims_receipts`, `kra_etims_items`, `quotes`, `quote_lines`, `sales_orders`, `sales_order_lines`, `sales_deliveries`, `sales_delivery_lines`, `sales_invoices`, `sales_invoice_lines`, `invoice_payments`, `credit_notes`, `credit_note_lines`, `doc_counters` |
| Customers | `customers`, `customer_ledger`, `wallet_transactions`, `debt_payments`, `credit_payments`, `loyalty_settings`, `loyalty_redemptions`, `customer_merges`, `customer_duplicate_dismissals`, `loyalty_points_earned`, `invoices`, `invoice_counters`, `regular_orders`, `regular_order_days`, `regular_order_settings`, `message_variables` |
| Money | `payments`, `money_assets`, `payment_asset_ledger`, `expenses`, `expense_categories`, `business_assets`, `petty_cash_categories`, `rider_pay_links`, `card_payments`, `card_payment_settings`, `card_payment_secrets`, `airtel_transactions`, `airtel_payment_settings`, `airtel_payment_secrets` |
| M-Pesa | `mpesa_settings`, `mpesa_transactions`, `mpesa_till_payments` |
| Online store | `customer_accounts`, `online_orders`, `online_order_items`, `customer_order_schedules`, `customer_messages`, `delivery_zones`, `website_settings`, `website_articles`, `assistant_usage`, `customer_account_stores`, `delivery_trips`, `website_reviews`, `website_product_ideas`, `website_product_idea_votes` |
| Books (accounting) | `acc_accounts`, `acc_entries`, `acc_lines`, `acc_settings`, `acc_post_errors`, `acc_reconciliations` |
| Buying | `buying_settings`, `purchase_approval_limits`, `purchase_quotes`, `purchase_quote_lines`, `purchase_receipts`, `purchase_receipt_lines`, `supplier_bills`, `supplier_payments`, `supplier_returns`, `supplier_return_lines` |
| Promotions and referrals | `website_promo_codes` (all promotions, till and website), `promotion_products`, `promotion_categories`, `promotion_customers`, `promotion_branches`, `promotion_redemptions`, `referral_campaigns`, `referral_codes`, `referrals`, `referral_rewards` |
| Staff operations | `shifts`, `schedules` |
| Notifications | `notifications`, `notification_preferences`, `device_fcm_tokens` |
| Feedback | `complaints`, `complaint_replies` |
| Settings | `receipt_settings`, `printer_settings`, `sms_settings`, `whatsapp_settings`, `ai_settings`, `integration_configurations` (includes the `invoice` defaults), `kra_etims_settings`, `kra_etims_secrets` (server only) |
| Analytics and logs | `audit_logs`, `ai_insights`, `dashboard_analytics_snapshots`, `scheduled_reports`, `report_tracked_items`, `crash_reports`, `problem_reports`, `ops_watchdog_config`, `ops_watchdog_state`, `app_data_conversions` |
| Backups and files | `google_sheets_backup`, `backup_history_logs`, `storage_files` |

## 16.3 Enumerated types

| Type | Values |
|---|---|
| `membership_status` | Active, Pending, Suspended |
| `invitation_status` | Pending, Accepted, Expired, Revoked |
| `customer_tier` | Bronze, Silver, Gold |
| `transaction_status` | Synced, Offline_Pending |
| `inventory_adjustment_type` | Restock, Damage, Reconciliation |
| `shift_status` | Active, Closed |
| `schedule_repeat` | None, Daily, Weekly, Monthly |
| `mpesa_status` | Pending, Completed, Failed |
| `notification_priority` | low, medium, high, critical |
| `notification_action_type` | navigate, url, none |
| `report_schedule_frequency` | daily, weekly, monthly |
| `backup_status` | success, failed, running |
| `sentiment` | positive, neutral, negative |

## 16.4 What happens when a sale is saved

Paid till sales go through `record_till_sale` (credit sales through `process_customer_transaction`), so the sale, its lines, any points spent and any promotion use are saved in one database transaction. Then `fn_process_completed_transaction` runs:

1. **Loyalty**: for a registered customer, adds `fn_sale_points` (2 points per KSh paid, delivery excluded; the wallet-paid part counts as paid) and one purchase.
2. **Shift**: adds the sale to the employee's open shift. The app never writes shift totals itself.
3. **Money asset**: the paid part moves the balance for its method (`money_assets`) with a ledger line.
4. **Debt / wallet**: the wallet pays first; any rest of a credit sale becomes an open debt record and raises `customers.debt_balance`.

`fn_process_transaction_item` reduces stock for each item (logged in `inventory_adjustments`), and `fn_check_low_stock` raises notifications, including the suggested supplier for **Ask supplier**. A deferred trigger then posts the sale to the books through `acc_post_source('sale', …)`: sales, promotion discounts, cost of goods, money or receivables, and rider pay owed (`rider_pay`). A sale whose totals don't equal its lines is refused (`20261201002`).

**Undo** is never a delete: `create_credit_note` refunds (stock back, money/wallet/debt settled, books reversed). Every change to a sale or its lines is logged in `audit_logs` by `trg_audit_sale_change`.

## 16.5 Main database functions

| Area | Functions |
|---|---|
| Business setup | `create_business_with_owner`, `check_owner_exists`, `accept_invitation_with_token`, `get_invitation_by_token` |
| Access | `has_permission`, `fn_user_has_permission`, `assert_permission`, `assert_business_member`, `is_owner_or_admin`, `get_user_business_ids` |
| Sales and payments | `process_customer_transaction`, `process_business_payment`, `void_business_payment`, `get_business_payments`, `get_money_assets` |
| Wallet, debt, points | `process_wallet_topup`, `process_wallet_spend`, `process_debt_payment`, `settle_customer_debt_fifo`, `redeem_customer_points`, `spend_points_at_till`, `refund_till_points`, `link_till_points`, `fn_point_value`, `attach_sale_to_customer`, `issue_invoice` |
| M-Pesa | `log_mpesa_payment`, `record_till_payment`, `handle_till_payment`, `confirm_store_payment_request`, `begin_order_payment`, `confirm_online_order_payment` |
| Stock | `adjust_stock_manually`, `adjust_stock_bulk`, `update_product_category_bulk`, `fn_register_product_category` |
| KRA eTIMS | `kra_next_invoice_no` |
| Readable text | `fn_receipt_number`, `fn_readable_ids`, `fn_capitalize_words` |
| Customers | `find_duplicate_customers`, `dismiss_duplicate_customers`, `merge_customers`, `calculate_customer_tier` |
| Customer portal | `get_public_storefront`, `place_online_order`, `cancel_my_order`, `get_my_rewards`, `redeem_my_points`, `update_my_account`, `get_my_contact_preferences`, `update_my_contact_preferences`, `submit_website_feedback`, `run_customer_portal_daily` |
| Staff portal tools | `staff_update_online_order`, `staff_assign_rider`, `staff_clear_order_attention`, `staff_send_customer_message`, `get_my_deliveries`, `rider_update_delivery` |
| Notifications | `fn_notification_catalog`, `fn_notification_recipients`, `get_my_notification_settings`, `set_my_notification_setting`, `flag_due_schedule_reminders` |
| Security | `otp_issue`, `otp_check`, `otp_confirm_signup`, `check_rate_limit`, `report_crash` |
| Dashboard | `get_business_dashboard_metrics`, `refresh_dashboard_snapshot` |
| Books | `acc_post_source`, `acc_source_ids`, `acc_rebuild_start`, `fn_post_money_asset`, `fn_spending` (profit spending incl. rider pay owed) |
| Sales documents | `record_till_sale`, `create_credit_note`, `mark_quote_sold` |
| Buying | `receive_purchase`, `ask_supplier_for_stock`, `supplier_portal_*` |
| Transfers | `send_stock_transfer`, `approve_stock_transfer`, `cancel_stock_transfer`, `accept_transfer_request`, `decline_transfer_request`, `list_stock_transfers`, `list_stock_transfer_lines` |
| Promotions | `promo_check`, `promo_reserve`, `promo_release`, `run_referral_jobs` |
| Riders and regular orders | `fn_rider_owed`, `list_rider_pay`, `pay_rider`, `remove_rider_payment`, `deliver_regular_orders` |
| Shifts | `confirm_still_on_shift` |
| Search and reports | `global_search`, `stock_period_report` |
| Operations | `run_ops_watchdog`, `revoke_invitation` |
| Backups | `run_due_backups` |

## 16.6 Views

`v_active_customers`, `v_active_products`, `v_active_shifts`, `v_customer_ledger_detail`, `v_daily_sales_summary`, `v_expense_summary`, `v_low_stock_products`, `v_open_debts`, `v_pending_invitations`, `v_product_sales_rank`, `v_team_members`, `v_transaction_summary`, `v_unread_notifications`, `v_upcoming_schedules`.

## 16.7 Storage buckets

| Bucket | Public | Holds |
|---|---|---|
| `product-images` | Yes | Product photos |
| `employee-avatars` | Yes | Staff profile pictures |
| `business-logos` | Yes | Logos and cover images |
| `receipt-exports` | No | Exported receipts |
| `expense-receipts` | No | Photos of expense receipts |

## 16.8 Development scripts

`supabase/dev_wipe.sql` empties every table (and sign-ins and uploaded files) but keeps the schema; it refuses to run until you `SET app.wipe_everything = 'yes, wipe it';`. `supabase db reset` rebuilds the schema too. **Never run either against a database with real data without a backup.**

<div class="page-break"></div>

# 17. Edge functions reference

All functions live in `supabase/functions/<name>/index.ts`. Common helpers in `shared/` handle CORS, the caller's identity, `requirePermission()`, `enforceRateLimit()`, and AI provider calls.

| Function | Caller | Auth | Purpose |
|---|---|---|---|
| `auth-otp` | Apps | Public, rate limited | Issue and check email verification and password reset codes; codes never leave the server |
| `ai-config` | Staff app | Owner | Read and save AI provider settings; returns masked keys |
| `chat` | Staff app | `ai.use` | Workspace assistant |
| `area-advisor` | Staff app | `ai.use` or `ai.insights` + area permission | Advisor cards on Promotions & Points, Payments & Expenses and Finance; reads figures with the caller's RLS, AI only explains |
| `airtel-payments` | Staff app, website | `payments.airtel`; setup `settings.integrations` | Airtel Money prompts and status checks; client secret stays on the server |
| `airtel-callback` | Airtel | Public (`--no-verify-jwt`), per-business token in URL | Prompt result; success only after an Airtel status check |
| `card-payments` | Staff app, website | `payments.card` (or `pos.create_sale` at the till); setup `settings.integrations` | Paystack card charges; secret key stays on the server |
| `card-webhook` | Paystack | Public, Paystack signature | Card payment result, per business |
| `alarm-sync` | Database | Service key or `FCM_WEBHOOK_SECRET` | Copies a reminder to the person's phones so each rings it as a native alarm |
| `accept-alert` | Apps | Signed in | Accepts a ringing alert and stops it ringing on the person's other devices |
| `ops-alert` | Uptime monitor, database, apps | GET public (health check); `report` owner/admin; `crash`, `watchdog`, `test` service key | Health check, and problems, crashes and watchdog results to the developer's Telegram |
| `bi-analyze` | Staff app | `ai.insights` / `reports.view` | Structured business report |
| `complaints` | Staff app | `complaints.view` | Analyse complaints, draft and improve replies |
| `customer-assistant` | Website | Public, quota | Restricted shop assistant |
| `customer-checkout` | Website | Signed-in customer | STK push for own order (`pay`, `check`) |
| `mpesa-payments` | Staff app | `payments.mpesa`, `settings.integrations` | Till setup, registration, prompts, status checks |
| `mpesa-webhook` | Safaricom | Token in URL | STK results |
| `till-callback` | Safaricom | Token in URL | Direct till payments (C2B) |
| `ussd` | Africa's Talking | Token in URL | Dial-code menu |
| `send-email` | Apps | Signed in | Branded emails |
| `send-fcm` | Database webhook | Service role or `FCM_WEBHOOK_SECRET` | Push notifications |
| `sms-config` | Staff app | `communication.send` | Twilio settings and sending |
| `whatsapp-config` | Staff app | `communication.send` | WhatsApp settings and sending |
| `backup-config` | Staff app, `pg_cron` | Owner, service role | Google Sheets backup settings and runs |
| `sync` | Staff app | `pos.create_sale` | Offline sale queue |
| `kra-etims` | Staff app | `settings.integrations` (connect), `pos.create_sale` / `orders.view` (sign) | KRA eTIMS: `status`, `connect`, `disconnect`, `sign_sale` |

Deploy one with `supabase functions deploy <name>`, or all with `supabase functions deploy`.

<div class="page-break"></div>

# 18. Security model

## 18.1 Principles

- **Row-level security on every table.** No table is readable or writable without a policy.
- **Least privilege on functions.** Functions are revoked from `PUBLIC` and granted only to the roles that need them (migration `20261105002`). Service-only functions such as `run_due_backups` are granted to `service_role` alone.
- **Tenant checks inside functions.** Every `SECURITY DEFINER` function confirms the caller belongs to the business and holds the permission before acting.
- **Server-side pricing and balances.** Clients never send totals that are trusted.
- **Secrets on the server.** Provider keys are Supabase secrets or rows only functions read; the app receives masked values.

## 18.2 Inbound calls from providers

Safaricom and Africa's Talking can't sign in, so `mpesa-webhook`, `till-callback` and `ussd` require a secret token in the URL. Treat those URLs as passwords and change the token if one leaks. Restricting by the providers' published IP ranges is a worthwhile later step.

## 18.3 Sign-in codes

`auth-otp` generates six-digit codes with rejection sampling so all 900,000 codes are equally likely, stores them server-side, and limits attempts: 30 per 10 minutes per IP, 15 per hour per email, and 5 wrong guesses per code.

A password reset only looks up the real login email (`auth.users.email`), and an invitation can only be accepted by the account whose login email it was sent to (migration `20261107002`). Before this fix, an invitation token could be used to overwrite another person's profile and reach their account through a reset.

## 18.4 Rate limits

Enforced by `enforceRateLimit` in `supabase/functions/shared/cors.ts`, backed by `rate_limits` and `check_rate_limit`.

| Action | Limit |
|---|---|
| AI (chat, complaints, BI) | 20 per minute per person; 500 per day per business |
| Sign-in codes | 30 per 10 minutes per IP; 15 per hour per email; 5 wrong guesses per code |
| Email | 30 per hour per person |
| SMS | 200 per hour per person; 1,000 per day per business |
| WhatsApp | 200 per hour per person; 1,000 per day per business |
| M-Pesa prompts (staff) | 60 per hour per person; 600 per day per business |
| Website checkout | 6 per 10 minutes per customer |
| Dial code | 40 per 10 minutes per phone |

## 18.5 Audit

`audit_logs` records sensitive actions. Changes to sensitive employee fields are audited by `fn_employee_sensitive_audit`. Customer balance changes outside the proper functions are refused (`fn_guard_customer_balances`).

## 18.6 Devices

Signing keys never enter the repository: the Android key is in `~/.config/kaykays-signing/` and the desktop updater key in `~/.tauri/`. Updates are verified before installing (section 21). Shared terminals can be locked down under **Settings > Local terminal security**.

## 18.7 Known exposures

- Any member can read colleagues' names and contact details from `employees`, because the app needs them for assigning and display.
- Owners and Admins bypass permission checks by design.
- The `.env` file and `my-release.keystore` exist in the working folder. Confirm neither holds live production secrets before the repository is shared further, and keep `.env` out of git.

<div class="page-break"></div>

# 19. Local development setup

## 19.1 Prerequisites

- Node.js 22 (CI uses 22; 20+ works)
- Rust and Cargo, for desktop builds
- Java 21 (Temurin) and the Android SDK, for Android builds
- Supabase CLI, for backend work
- On Linux, the WebKitGTK and related packages Tauri needs (see `build.yml`)

## 19.2 Configure

Copy `.env.example` to `.env` and fill in at least:

```env
VITE_SUPABASE_URL=https://<project-ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<anon key>
VITE_AI_NAME=Kim
VITE_WEBSITE_SLUG=kaykays
```

Only `VITE_` variables reach the browser. Server secrets (M-Pesa, USSD, SMTP, service role key) are set with `supabase secrets set`, never as `VITE_` variables. CI refuses to build an installer without the Supabase URL and key, because it couldn't connect.

## 19.3 Run

```bash
npm install
npm run dev          # staff app, http://localhost:3001
npm run tauri:dev    # staff app in a desktop window
npm run website:dev  # customer website, http://localhost:5180
npm run android      # debug APK on a connected device or emulator
```

## 19.4 Backend changes

```bash
supabase login
supabase link --project-ref <project-ref>
supabase migration new <name>     # write SQL in the new file
supabase db push                  # apply to the linked project
supabase functions deploy <name>
```

Add a new migration for every change; never edit one that has already been applied. When changing role defaults, update `src/utils/permissions.ts` in the same change.

## 19.5 Running Supabase locally on a small machine

On a machine with limited memory, run the local Supabase stack from a scratch copy on separate ports and without Storage, and wait until `supabase start` finishes before running commands against it.

## 19.6 Before committing

```bash
npm run lint
npm run website:lint
npm test
```

CI runs the same checks. A local type check can pass where CI fails if React types are installed higher up the folder tree (for example in `~/node_modules`), so check suspicious results in a copy outside your home folder.

<div class="page-break"></div>

# 20. Building and releasing

## 20.1 Version numbers from commits

`.github/workflows/release-and-deploy.yml` runs on every push to `main`. `scripts/release-version.mjs` reads the commits since the last tag (preview with `node scripts/release-version.mjs`):

| Commit type | Release |
|---|---|
| `feat!:` / `fix!:` or `BREAKING CHANGE` | Major (2.0.0 → 3.0.0) |
| `feat:` | Minor (2.0.0 → 2.1.0) |
| `fix:`, `perf:`, `refactor:` | Patch (2.0.0 → 2.0.1) |
| Anything else (`docs:`, `chore:`, `wip:`, ...) | No release |

Emoji commit prefixes are recognised too. The first release after the reset is `v0.0.0 → v1.0.0`.

## 20.2 Release pipeline

1. Work out the version.
2. Type check and tests.
3. Build Windows (`.exe` and signed `.msi`), Linux (signed AppImage and `.deb`) and Android (signed APK).
4. Only if all of that passed: push the tag, generate `latest.json` (`scripts/update-manifest.mjs`), and publish the GitHub Release.

`build.yml` checks pull requests on all platforms (without update signing) and builds the APK on each push to `main`. It never publishes.

## 20.3 GitHub repository secrets

| Secret | Value |
|---|---|
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` | From the Supabase project |
| `ANDROID_KEYSTORE_BASE64` | `base64 -w0 ~/.config/kaykays-signing/kaykays-release.jks` |
| `ANDROID_KEYSTORE_ALIAS`, `ANDROID_KEYSTORE_PASSWORD` | From `credentials.env` |
| `GOOGLE_SERVICES_JSON` | Contents of `android/app/google-services.json` |
| `TAURI_SIGNING_PRIVATE_KEY` | Contents of `~/.tauri/kaykays-updater.key` |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | Contents of `~/.tauri/kaykays-updater.password` |
| `VITE_UNSPLASH_ACCESS_KEY`, `VITE_AI_NAME` | Optional |
| `RELEASE_TOKEN` | Optional; only if a ruleset stops the built-in token pushing tags |

## 20.4 Android signing

The release key lives outside the repository in `~/.config/kaykays-signing/` (`kaykays-release.jks` and `credentials.env`). **Back this folder up offline. If it is lost, installed apps can't be updated.** To build a signed APK locally:

```bash
set -a; . ~/.config/kaykays-signing/credentials.env; set +a
npm run build && npx cap sync android
cd android && ./gradlew assembleRelease
# output: android/app/build/outputs/apk/release/app-release.apk
```

Release builds use version code 10,000,000 + the version (1.1.0 becomes 10,001,000), which is above any local build's timestamp code, so releases always upgrade a local install.

The release key was replaced after v2.0.0 was built, so phones on v2.0.0 can't install later APKs ("App not installed") and must install the latest APK by hand once. To stop that happening again, CI pins the expected certificate in `android/release-signing-cert.sha256` and fails the release if the APK is signed with any other key.

## 20.5 Desktop signing

The updater key pair is in `~/.tauri/`; its public half is in `src-tauri/tauri.conf.json`. **Back it up with the Android key. If the private key is lost, installed desktop apps refuse every future update and must be reinstalled by hand.** Windows shows a SmartScreen warning until the MSI is signed with a code-signing certificate.

<div class="page-break"></div>

# 21. Automatic updates

Installed apps check `latest.json` (in `KIMGITO/kaykays-releases`, see `MANIFEST_SOURCES` in `src/core/native/updateManifest.ts`) 15 seconds after start, whenever the connection comes back, and every 6 hours. When a newer version exists they send a notification and show a green bar at the top while it downloads.

| Platform | Behaviour |
|---|---|
| Windows, Linux AppImage | The update downloads in the background and is verified against the signing key. **About this app** then shows "Version X is ready" and **Restart and install** (`restartToUpdate`). There is no update bar. |
| Linux `.deb` | Gets the signed `.deb` (`latest.json` lists `linux-x86_64-deb` and `linux-x86_64-appimage` separately). |
| Android | `AppUpdatePlugin.java` downloads the APK, checks its SHA-256, and opens Android's installer. Android always asks to confirm, and the first time asks to allow installs from KayKay's. |

If an update fails, a phone notification says so ("Update failed"), and **About this app** (under More on phones; in the sidebar and Profile on desktop) has **Check for updates**.

**The repository must stay public**, or the apps can't download releases. Version comparison is numeric (`utils/semver.ts`; tested as "App versions compare numerically"), so 2.10.0 is newer than 2.9.0.

Numbering restarted at **1.0.0** on 23 November 2026 (base tag `v0.0.0`; old releases and tags deleted). Desktop installs on 7.x see 1.0.0 as older and must be reinstalled by hand once; Android version codes start at 20000000, so phones on 7.x update normally.

<div class="page-break"></div>

# 22. Deployment and operations

## 22.1 Deploying backend changes

Order matters:

1. Deploy changed edge functions (`npx supabase functions deploy <name>`, with `--no-verify-jwt` for the public ones in section 17).
2. Apply the migrations with `bash scripts/db-push.sh`, then `bash scripts/check-live-grants.sh` (it must list no problems).
3. Release the app by pushing to `main`: **Release and Deploy** builds the apps and **deploy-web** publishes the web app and website to Cloudflare (blue-green; `rollback-web` switches back).
4. Tick the steps in `docs/TO_FINISH.md`. Full details: `docs/DEPLOYMENT_AND_MONITORING.md`, `docs/HOSTING_CLOUDFLARE.md`, `docs/BACKUP_AND_RECOVERY.md`.

## 22.2 Scheduled jobs

`pg_cron` jobs registered by the migrations (times UTC; Nairobi is UTC+3):

| Job | Schedule | Does |
|---|---|---|
| `process-schedule-reminders` | every minute | Due reminders |
| `escalate-unaccepted-alerts` | every minute | Rings ringing alerts again until someone accepts |
| `auto-clock-out` | every minute | "Still working?" at 15 h and the 3-minute close |
| `expire-promotion-holds` | every 5 minutes | Releases promotion holds older than 20 minutes |
| `referral-and-promotion-jobs` | every 10 minutes | `run_referral_jobs` |
| `ring-regular-orders` | every 10 minutes | Rings staff while today's regular orders aren't done |
| `ops-watchdog` | every 10 minutes | `run_ops_watchdog` health checks, alerts via `ops-alert` |
| `run-due-backups` | hourly at :05 | Google Sheets backups |
| `customer-portal-daily` | 02:00 | `run_customer_portal_daily()` |
| `buying-nightly` | 04:15 | Reorder suggestions |
| `prune-cron-history`, `purge-security-data`, `prune-stale-device-tokens` | nightly | Housekeeping |

Check runs in `cron.job_run_details`.

## 22.3 Backups

Each business chooses a Google Sheets backup schedule in **Settings**, in Nairobi time. Automatic runs show in the backup history as `auto`. Backups only start once two Vault secrets exist. Run this in the Supabase SQL editor, using the legacy JWT service role key, because `backup-config` checks for a JWT:

```sql
SELECT vault.create_secret('https://<project-ref>.supabase.co', 'project_url');
SELECT vault.create_secret('<service-role-key>', 'service_role_key');
```

Supabase's own database backups remain the primary recovery path; the Sheets export is a readable copy for the business.

## 22.4 Monitoring

| What | Where |
|---|---|
| Crashes | `crash_reports` table; Owners and Admins read their business's reports |
| Edge function errors | Supabase dashboard > Edge Functions > Logs |
| Scheduled jobs | `cron.job_run_details` |
| Payments needing attention | **Payments & Expenses > M-Pesa > Paid to the till** and **Online Store > Orders** |
| Backups | Backup history in **Settings** |
| Database health | `ops-watchdog` job; problems arrive in Telegram (@kaykays_alerts_bot) |
| Uptime | External monitor calling `GET ops-alert` |
| Database backups | `backup-database` workflow (hourly to Cloudflare R2), weekly `restore-drill` |
| Release gates | `db-checks` and `security` workflows must pass before a release |

## 22.5 Crash reports

`src/services/crashReporter.ts` sends crashes to `crash_reports` through `report_crash`. Emails, phone numbers, IDs and tokens are removed first (tested as "scrubPersonalData removes personal details from crash reports"), and identical crashes are counted rather than stored again.

## 22.6 Routine tasks

| When | Task |
|---|---|
| Daily | Clear the **Paid to the till** queue; check flagged online orders |
| Weekly | Review crash reports and failed backups |
| After a release | Confirm a device updated |
| Every 6 months | Renew the Apple sign-in client secret, if Apple sign-in is on |
| If a callback URL leaks | Change `MPESA_CALLBACK_TOKEN` or `USSD_CALLBACK_TOKEN`, re-register the till, update the Africa's Talking channel |

<div class="page-break"></div>

# 23. Testing

## 23.1 The test suite

`npm test` runs `src/test/runTests.ts` with `tsx`. It covers logic that is easy to get wrong and costly when wrong:

| Area | Tests |
|---|---|
| Formatting | Short IDs, receipt numbers, customer numbers |
| Printing | ESC/POS command streams |
| Errors and privacy | `toUserMessage` keeps friendly text and hides technical text; crash reports are scrubbed of personal details |
| Access | Role permission checks with database overrides; database role defaults match the app |
| Production | BOM ingredient requirements and stock shortages; batch cancellation restock vs waste |
| AI | Pending action store and permission validation; Hugging Face default provider and token rotation |
| Customers | Merge preview matches the database rules; names capitalised; walk-in sale added later earns till points |
| Loyalty | 2 points per Ksh 1 paid, none on credit, delivery excluded; tier values match the database |
| Invoices | Lists every unpaid charge and balances to what is owed; a period covers only that period |
| Receipts | Lines fit the paper; points shown; KRA block only with a real signature; Code 128 |
| Text | No database IDs in stock or history text; notifications carry no IDs and credit sales aren't payments |
| Offline | Sales queue once per reference and are marked pending |
| Home and shifts | Figures, ranges and growth; Kenya time charts; end-of-shift report |
| Shortcuts | Shortcuts and features follow roles; screen access follows roles |
| USSD | Menu registers, orders and checks balances |
| M-Pesa | Prompts accept Kenyan numbers in any common format |
| Navigation | Mobile nav keeps at most 5 slots, Settings off the bar, Sell centred for cashiers |
| Releases | Version from commit types (including emoji); update manifest lists signed installers and the APK; numeric version comparison |
| Services | Email service structure; notification repository initial state |

## 23.2 Database testing

SQL changes for the till flow, merging and security hardening were tested on a scratch PostgreSQL. Before applying a migration to the shared project, run it on a local or scratch database first.

## 23.3 Manual checks before a release

1. Sign in as each role and confirm the screens match section 5.3.
2. Make a cash sale and an M-Pesa sale; check stock, points, shift totals and money assets.
3. Take a debt payment and a wallet top-up.
4. Print a receipt on the Bluetooth printer.
5. Turn the network off, make a sale, turn it on, and confirm it syncs.
6. On the website, place and pay for an order in the sandbox.
7. Confirm a notification arrives as a push on Android.

<div class="page-break"></div>

# 24. Known limitations and current status

## 24.1 Integration status

Every connection except Supabase is optional.

| System | Used for | Without it | Status |
|---|---|---|---|
| Safaricom Daraja | M-Pesa prompts, till payments | Online orders can't be paid | Tested against a mock only |
| Africa's Talking | Dial-code ordering | No dial-code ordering | Tested with simulated requests; real gateway never called |
| WhatsApp Cloud API | Automatic WhatsApp messages | Staff open each chat by hand | Never run against Meta |
| Twilio | SMS from the staff app | Staff use WhatsApp or email | Never run |
| SMS provider in Supabase Auth | Phone sign-in codes | Phone sign-in stays hidden | Never run |
| Google | Website sign-in | Button explains it isn't available | Never run against real Google |
| Apple | Website sign-in | Button hidden | Never run |
| Resend or SendGrid | Email | Sign-in and message emails fail | Never run |
| Google Sheets | Backups | No Sheets backup | Scheduling tested; a real backup hasn't run |
| Firebase | Push notifications | No pushes | Never run end to end |
| AI providers | AI features | AI answers unavailable | Website assistant's model path hasn't run |
| Airtel Africa API | Airtel Money prompts | Airtel payments recorded by hand | Never run against Airtel |
| Paystack | Card payments online and on a reader | Card recorded by hand at the till | Never run end to end |
| Telegram bot | Developer alerts (`ops-alert`) | No alerts | Bot live since 2026-11-15 |
| Cloudflare (Workers, R2) | Web app and website hosting; backups | No web app; no off-site backups | Hosting live; R2 backup secrets not all set |

## 24.2 Functional limits

- **Till payments can't be matched automatically**, because a till carries no account number. Staff assign them from the queue.
- **Refunds of online orders are manual**, in M-Pesa and the POS.
- **Duplicate customers are merged by staff only** until phone numbers can be verified by SMS. There's no undo for a merge.
- **USSD menu shows the first seven products in stock**, and a slow M-Pesa response can exceed the gateway's 10-second limit.
- **WhatsApp delivery isn't confirmed**: a send counts as done once Meta accepts it.
- **Email is limited to 30 per hour per person**, so it doesn't suit large lists.
- **Turning a phone sideways in full-screen Home charts** needs a native Android build with `ScreenOrientationPlugin`; older builds rotate with CSS and chart tooltips may be offset.
- **Home figures over long ranges** can be cut off at 1,000 sales, and product profit uses current prices.
- **Windows shows a SmartScreen warning** until the MSI is code-signed.
- **The delivery fee defaults to 0.** Set delivery areas and prices before launching the website.

## 24.3 Status as of 23 November 2026

- Version numbers restarted: the next release is **v1.0.0** (tag `v0.0.0` is the base). Older installs on 7.x Windows/Linux must be reinstalled by hand once; Android codes start at 20000000 so phones update over 7.x.
- The live database was reset onto the squashed schema (`20261120001`, `20261120002`). Many later migrations are **not on live yet**; `docs/TO_FINISH.md` lists each with the exact push and check steps. Always run `supabase migration list` before assuming a file is live, and use `scripts/db-push.sh`, then `scripts/check-live-grants.sh`.
- Live holds **test data** from `supabase/seed_quick.sql` (two branches, an admin, riders, products, customers). Wipe it with `supabase/dev_wipe.sql` before real use; that also removes the owner's account.
- Several new screens (Regular Orders, Promotions & Points, rider pay, trips, Stock Report, global search) have passed database tests but not yet a click-through in a browser or on a phone.
- **Not yet tested against a live provider:** KRA eTIMS, M-Pesa Daraja, Airtel, Paystack, WhatsApp, SMS, and the others in section 24.1.
- Older files (`APP_DOCUMENTATION.*`, parts of the root and `supabase/` READMEs) describe earlier versions. This document and `docs/USER_GUIDE.md` supersede them.

<div class="page-break"></div>

# 25. Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Installer starts but can't connect | Built without `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` | Set the GitHub secrets and rebuild |
| `tauri build` fails after a dependency update | Tauri npm and crate versions differ | Pin `@tauri-apps/*` to the crates' minor version |
| CI type check fails but local passes | React types found higher up the folder tree locally | Check in a copy outside your home folder |
| Desktop app refuses an update | Signed with a different key, or key secret invalid | Restore `~/.tauri/` key; re-set `TAURI_SIGNING_PRIVATE_KEY` |
| Android build fails at signing | `ANDROID_KEYSTORE_BASE64` isn't valid base64 | Re-create with `base64 -w0` and re-set the secret |
| Android won't install the update | "Install unknown apps" not allowed for KayKay's | Allow it when Android asks |
| No push notifications | Webhook doesn't send the service role key or `FCM_WEBHOOK_SECRET`; or no Firebase config | Fix the webhook header; set `FIREBASE_SERVICE_ACCOUNT` |
| M-Pesa prompt sent but sale not recorded | `mpesa-webhook` not deployed or token mismatch | Deploy it; check `MPESA_CALLBACK_TOKEN` |
| Till payments never appear | Till not registered, or wrong C2B short code | Press **Register till with Safaricom**; set `MPESA_C2B_SHORTCODE` |
| Dial-code callers see a network error | Reply took longer than 10 seconds | Check M-Pesa response time; retry |
| Website shows nothing | Website name not set | Set it to `kaykays` in **Online Store > Website** |
| Website pages 404 on refresh | Host doesn't serve `index.html` for unknown paths | Add a rewrite rule |
| Backups never run | Vault secrets missing | Create `project_url` and `service_role_key` (section 22.3) |
| "Too many requests" | Rate limit reached | Wait; see section 18.4 |
| Sign-up or password reset stopped working | Migrations applied before `auth-otp` was deployed, or old app | Deploy `auth-otp`; update the app |
| Bluetooth printer missing | Not paired in Android settings | Pair it, then reopen printer settings |
| Customer's balance change refused | Record was merged | Refresh the app so it uses the kept record |
| "Not set up on the server" when issuing an invoice | Migration `20261108001` missing | Apply it (`supabase db push`) |
| VAT switch greyed out | KRA eTIMS not connected | Connect it in **Settings > Receipts & printing > KRA eTIMS** |
| Sale shows **Waiting to sync** | Made offline | Reconnect; it sends by itself. Don't ring it up again |
| **Add customer** missing on a receipt | Sale has a customer, isn't paid, or is older than the limit | See section 10.8 |
| A shortcut does nothing | Role can't use that action, or focus is in a text box | Press **?** to see your keys |
| Phone shows "App not installed" for an update | Phone still on v2.0.0 (different signing key) | Uninstall and install the latest APK by hand once |

<div class="page-break"></div>

# Appendix A. Environment variables and secrets

## A.1 App build variables (`.env`, GitHub secrets)

| Variable | Used by | Purpose |
|---|---|---|
| `VITE_SUPABASE_URL` | Staff app, website | Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | Staff app, website | Public anon key |
| `VITE_AI_NAME` | Staff app | Assistant name (default Kim) |
| `VITE_UNSPLASH_ACCESS_KEY` | Staff app | Optional product photo search |
| `VITE_WEBSITE_SLUG` | Website | Which business to show (default `kaykays`) |
| `VITE_SITE_URL` | Website | Live address; empty means "don't index" |
| `VITE_AUTH_PROVIDERS` | Website | Extra sign-in options, e.g. `google,phone,apple` |

## A.2 Edge function secrets (`supabase secrets set`)

| Secret | Purpose |
|---|---|
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | Provided by Supabase to functions |
| `MPESA_ENV` | `sandbox` or `production` |
| `MPESA_CONSUMER_KEY`, `MPESA_CONSUMER_SECRET` | Daraja app credentials |
| `MPESA_SHORTCODE` | Store number (production) or test paybill (sandbox) |
| `MPESA_PARTY_B` | Till number (production); empty in sandbox |
| `MPESA_PASSKEY` | Lipa na M-Pesa passkey |
| `MPESA_TRANSACTION_TYPE` | `CustomerBuyGoodsOnline` (till) or `CustomerPayBillOnline` (sandbox) |
| `MPESA_CALLBACK_TOKEN` | Authorises `mpesa-webhook` and `till-callback` |
| `MPESA_C2B_SHORTCODE` | Optional; short code Safaricom registers for till payments |
| `USSD_CALLBACK_TOKEN` | Authorises `ussd` |
| `USSD_SHOP_SLUG` | Business served by dial code |
| `FIREBASE_SERVICE_ACCOUNT` | Firebase credentials for `send-fcm` |
| `FCM_WEBHOOK_SECRET` | Alternative to the service role key for the webhook |
| `GEMINI_API_KEY` and other provider keys | Optional fallback AI keys |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` | Email delivery |

## A.3 Vault secrets (SQL)

| Name | Value |
|---|---|
| `project_url` | `https://<project-ref>.supabase.co` |
| `service_role_key` | Legacy JWT service role key |

## A.4 Callback URLs

| Provider | URL |
|---|---|
| Safaricom STK | `https://<project-ref>.supabase.co/functions/v1/mpesa-webhook?token=<MPESA_CALLBACK_TOKEN>` |
| Safaricom C2B | `https://<project-ref>.supabase.co/functions/v1/till-callback?type=confirmation&token=<MPESA_CALLBACK_TOKEN>` |
| Africa's Talking | `https://<project-ref>.supabase.co/functions/v1/ussd?token=<USSD_CALLBACK_TOKEN>` |
| Google / Apple sign-in | `https://<project-ref>.supabase.co/auth/v1/callback` |

<div class="page-break"></div>

# Appendix B. Permission codes

Defined in `PERMISSIONS` in `src/utils/permissions.ts` (180 codes, each with a plain description shown on the Roles screen) and mirrored in `role_default_permissions`. Every code the app checks is also enforced by the database (`has_permission` in RLS or the function), and edge functions use `requirePermission`, never a role name. `supabase/tests/permissions/permissions_test.sh` checks both.

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
| Production & Recipes | `production.view`, `production.create`, `production.update`, `production.delete`, `production.approve`, `production.export`, `production.import`, `production.manage`, `bom.view`, `bom.create`, `bom.update`, `bom.delete`, `bom.manage` |
| Expenses & Payments | `expenses.view`, `expenses.create`, `expenses.update`, `expenses.delete`, `expenses.export`, `expenses.manage`, `pettycash.record`, `finance.view`, `accounting.view`, `accounting.manage`, `payments.view`, `payments.verify`, `payments.refund`, `payments.mpesa`, `payments.cash`, `payments.card`, `payments.airtel`, `payments.configure`, `payments.manage` |
| Staff & Roles | `staff.view`, `staff.invite`, `staff.update`, `staff.remove`, `staff.roles`, `users.view`, `users.manage`, `invitations.view`, `invitations.create`, `invitations.delete` |
| Notifications & Alerts | `notifications.view`, `notifications.send`, `notifications.manage`, `communication.view`, `communication.send` |
| Reports & AI | `reports.view`, `reports.sales`, `reports.inventory`, `reports.customers`, `reports.profit`, `reports.expenses`, `reports.tax`, `reports.deliveries`, `reports.export`, `reports.manage`, `ai.use`, `ai.configure`, `ai.insights`, `ai.manage` |
| Files & Audit Logs | `audit.view`, `audit.manage`, `files.view`, `files.manage`, `assets.view`, `assets.manage`, `import.data`, `export.data`, `google.connect` |

# Appendix C. Database migrations

Applied in filename order by `scripts/db-push.sh` (wraps `supabase db push`); run `bash scripts/check-live-grants.sh` after every push. On 16 November 2026 the 82 older files were squashed into the first two below and the live database was reset onto them. Which files are on live is tracked in `docs/TO_FINISH.md`.

| Migration | Contents |
|---|---|
| `20261120001_schema` | The whole schema up to 16 November 2026: 82 older files squashed into one (tables, enums, functions, RLS, books) |
| `20261120002_platform_and_defaults` | What the schema dump leaves out: sign-up trigger, storage buckets and their rules, defaults |
| `20261121001_quote_sold_at_till` | `mark_quote_sold`: a quote sold from the POS cart |
| `20261122001_message_variables` | `message_variables` table and `customer_purchase_stats` for bulk messages |
| `20261123001_supplier_stock_requests` | Ask-supplier requests that ring the supplier; portal answers |
| `20261124001_vat_needs_etims` | VAT allowed only when KRA eTIMS is connected (`vat_allowed`) |
| `20261125001_delivery_modes_sale_edit_log` | `delivery_mode` and `rider_pay` on sales; audit triggers for sale edits |
| `20261126001_promotions` | Promotion codes at till and website, `promo_check/reserve/release` |
| `20261126002_referrals` | Referral campaigns, codes, rewards, `run_referral_jobs` cron |
| `20261126003_promotion_referral_books` | Books for promotion discounts and referral rewards (redefines `acc_post_source`) |
| `20261127001_auto_clock_out` | Server-side clock-out of long shifts (replaced by 20261130002) |
| `20261128001_customer_profile` | Standard customer fields, `fn_normalize_phone`, delivery location parts |
| `20261128002_signed_out_sessions_denied` | Pre-request check refuses tokens of signed-out sessions |
| `20261128003_only_creator_creates_business` | Only the system creator can create a business |
| `20261129001_revoke_invitation` | `revoke_invitation` removes the invite and its orphan sign-up |
| `20261130001_delivery_trips` | `delivery_trips`: several deliveries, one rider pay |
| `20261130002_still_on_shift_check` | "Still working?" question at 15 h, 3-minute auto close |
| `20261130003_stock_period_report` | `stock_period_report`, `list_stock_transfer_lines` |
| `20261130004_rider_pay_bills` | Rider pay owed on the day (`rider_pay` source, account 2010), `pay_rider`, `fn_spending` |
| `20261130005_regular_orders` | `regular_orders`, `regular_order_days`, delivery RPCs, ringing cron |
| `20261130006_permissions_db_level` | Every app permission enforced in RLS/RPCs; missing SELECT grants |
| `20261130007_quantity_one_decimal` | Money columns `numeric(14,2)`, quantity columns one decimal |
| `20261130008_ai_reads_permissions` | AI reads role permissions live; website uses the owner's AI |
| `20261201001_lock_function_grants` | Revoke default EXECUTE; grant functions explicitly (SEC-01) |
| `20261201002_sale_totals_check` | Sale totals must equal their lines |
| `20261201003_ops_watchdog` | `run_ops_watchdog`, health check, Telegram alerts |
| `20261201004_abuse_limits` | `security_events` log of turned-away calls; promo codes can't be guessed |
| `20261201005_permission_cache` | Per-request permission cache for `has_permission` |
| `20261201006_realtime_publication` | Live updates only for tables the apps follow (adds `money_assets`) |
| `20261201007_storage_usage_alert` | File storage usage alert, next to the database size alert |
| `20261202001_record_refs_global_search` | `ref_no` (EXP/STM/LOG/LDG) and `global_search()` |

# Appendix D. Glossary

| Term | Meaning |
|---|---|
| BOM | Bill of materials: the ingredients and quantities that make one unit of a product |
| C2B | Customer to business: an M-Pesa payment the customer starts from their own phone |
| Daraja | Safaricom's M-Pesa API |
| Edge function | Server code running on Supabase, written for Deno |
| FCM | Firebase Cloud Messaging, used for push notifications |
| Money asset | The running balance the business holds per payment method |
| Paybill | An M-Pesa business number where customers enter an account number |
| `pg_cron` | PostgreSQL extension that runs scheduled jobs |
| RLS | Row-level security: PostgreSQL rules deciding which rows each user can reach |
| RPC | A database function called from the app |
| Service role | The Supabase key that bypasses RLS; only ever used on the server |
| `SECURITY DEFINER` | A database function that runs with its owner's rights, after its own checks |
| STK push | An M-Pesa prompt that appears on the customer's phone asking for their PIN |
| Till | An M-Pesa Buy Goods number; payments carry no account number |
| Tenant | One business and its data |
| USSD | Dial codes such as `*384*123#` that work on any phone without internet |
| Walk-in | A sale with no registered customer |
| eTIMS | KRA's electronic tax invoice system; OSCU is the online version used here |
| Invoice | A bill for what a customer owes on credit (not a receipt) |
| Points report | Loyalty summary of points held, earned, used and their cost |
