# Step 7: Platform

## Goal

Let each business use only the parts it needs, run several companies or currencies, get any report out, use the app in Swahili, and connect other systems.

## What we have today

- Many branches, each its own business row, switched from the header.
- Every screen is shown or hidden by role permissions only.
- Reports live inside screens (Home, Finances, Accounting). There's no general export.
- English only. KSh only (`businesses.currency` exists but isn't used for amounts).
- Edge functions for payments, AI and alerts, but no public API for others.

## What to build

### 1. Modules on and off ("apps")

- `business_modules` (business, module, on/off). Modules: POS, Online store, Deliveries, Production, Suppliers, Accounting, Payroll, CRM, Projects …
- A switched-off module hides its screens, search results, shortcuts, tour steps and More-sheet entries for everyone. The database refuses its functions too (`assert_module(...)` beside `assert_permission`).
- Settings → Apps page: tiles with a description and a switch. The main branch can set them for all branches.
- Also the place to show which modules a paid plan includes (see the commercial licence).

### 2. Several companies and currencies

- **Company** above branches: a group can own two companies (say the dairy and a shop), each with its own books, KRA PIN and branches.
- Consolidated reports across a company's branches: profit & loss, balance sheet and stock, with inter-branch accounts cancelled out.
- **Currency** per company (KSh default). Foreign-currency suppliers (UGX, TZS, USD): the bill is in their currency, a rate is set on the day, and the difference is booked as exchange gain or loss when paid.

### 3. Reports and export

- One report builder: choose the data (sales lines, expenses, stock moves, journal lines, customers…), columns, filters, grouping and totals.
- Save reports, share them with roles, and schedule them by email or Telegram (daily sales, weekly stock).
- Export CSV and Excel (xlsx) everywhere a list is shown. PDF for statements.
- Accountant access: a read-only role that sees Accounting and reports only.

### 4. Swahili

- Move every screen's text into a translations file (`i18n`), English and Swahili. The language is chosen per person in Profile.
- Receipts, invoices, SMS and USSD in the customer's language.
- Do it screen by screen. A test fails when a new string isn't in both languages.

### 5. Public API and webhooks

- API keys per business (hashed, with scopes like `read:products`, `write:sales`), made by the owner, revocable, with last-used time.
- REST via an edge function: products, stock, customers, sales, invoices. Rate limited and logged in the audit log.
- Webhooks: the business gives a URL and picks events (sale.created, stock.low, payment.received, order.placed). Signed with a secret, retried with backoff, with a delivery log.
- Uses: an accounting firm's system, a delivery partner, a supermarket ordering from the dairy.

## How it posts to the books

Exchange differences post to a new Exchange gain/loss account. Everything else reuses existing sources.

## Permissions

`modules.manage` and `api.manage` (Owner/Admin), `reports.build` (Manager), `company.manage` (Owner).

## Done when

- Switching Payroll off hides it everywhere and the database refuses payroll calls.
- A group with two companies sees consolidated and separate books.
- A saved report arrives by email each Monday.
- The app is fully usable in Swahili.
- A webhook fires on a sale and is retried when the receiver is down.

## Open questions

- Which modules are in which paid plan?
- Who translates and checks the Swahili (dairy and shop words, not literal)?
