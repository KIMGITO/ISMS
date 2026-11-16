# Roadmap: matching Odoo

Agreed on 2026-11-16. The aim is for KayKay's to do what Odoo does for a Kenyan shop, dairy or small producer, without the complexity. Build one step at a time, in this order. Each step gets its own migration, screen and tests.

| # | Step | Status | File |
|---|------|--------|------|
| 1 | Accounting (double-entry books) | Built 2026-11-16 (`32bbefc`), migration `20261116003` not yet applied | — |
| 2 | Quotes → sales orders → invoices, credit notes and refunds | Next | [02-quotes-orders-invoices.md](02-quotes-orders-invoices.md) |
| 3 | Smarter buying: quotes from suppliers, purchase orders with approval, reorder points, supplier bills | Planned | [03-smarter-buying.md](03-smarter-buying.md) |
| 4 | HR and payroll (Kenya) | Planned | [04-hr-payroll.md](04-hr-payroll.md) |
| 5 | Inventory valuation, lots, expiry, counts, locations | Planned | [05-inventory-valuation.md](05-inventory-valuation.md) |
| 6 | CRM pipeline and campaigns | Planned | [06-crm-pipeline.md](06-crm-pipeline.md) |
| 7 | Platform: modules on/off, multi-company and currency, reports, Swahili, API | Planned | [07-platform.md](07-platform.md) |
| 8 | Projects, timesheets, helpdesk | Low priority | [08-projects-helpdesk.md](08-projects-helpdesk.md) |

## Rules every step follows

- **Money goes through the books.** Anything that moves money or stock adds a source type to `acc_post_source()` (see `supabase/migrations/20261116003_accounting.sql`), so its journal entry is created, replaced or reversed automatically. Never write `acc_entries` directly from a feature.
- **The database is the truth.** Totals, numbers and statuses are worked out in SQL functions, not on the phone (the same rule as clock-in and the offline outbox).
- **One permission to read, one to change.** For example `sales_orders.view` / `sales_orders.manage`. Add them to `SYSTEM_ROLES` and re-insert `role_default_permissions` in the same migration, because the parity test reads the newest one.
- **Wiring for every new screen:** `screens.ts` (with a G key), `uiStore` tab type, `App.tsx` (sidebar, More sheet, tour step, render), `mobileNav.ts`, search features with `data-shortcut` targets, and an entry in the shortcut test's file list.
- **Branch = business row.** Anything per branch resets through `onBranchChange()`.
- **Plain words on screen.** Say "What we owe suppliers", not "Accounts payable".

## Still open from before (not a roadmap step)

- Test M-Pesa (Daraja) and KRA eTIMS against their sandboxes.
- Test ringing alerts and the background remover on a phone and on Windows.
- Wipe the seed test data from the live database before real customers use it.
