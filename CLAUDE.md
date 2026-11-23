# ISMS project rules

## Money rules (set by the owner, 2026-11-18)

1. **Every money movement is recorded in the app.** If money goes in or out of the business
   (sales, refunds, debt payments, wallet top-ups, supplier payments, rider pay, petty cash,
   expenses, wages), there is a row for it in the database. Nothing is paid "outside" the app,
   and no screen shows money that has no record behind it.
2. **The books and the figures on screen always agree.** One record drives everything: the
   same row moves the Payments screen balance (`money_assets`), posts to the books
   (`acc_post_source`), and is what Home, Finances, shift reports and lists add up. Never
   compute a money figure from a second, separate source that can drift from the books.
3. **New kinds of money movement reuse an existing record type** (expense, supplier payment,
   customer ledger, sale) or add a new `acc_post_source` source type in the same change.
   A feature that moves money is not done until its books entry and money balance are checked
   on a test DB (debits = credits, money balance changed by the same amount).
4. **Changing a money record never silently breaks the link.** Undo by removing (soft-delete,
   which reverses balance and books) and recording again; block edits that would make linked
   records disagree.
5. **Whoever the money goes to doesn't need an account.** Record their name (e.g. the rider
   named at the sale) so the payment is still traceable.

Example: rider pay (`20261130004_rider_pay_bills.sql`). Rider pay is spending on the day it's
owed (books: Rider pay / We owe riders, source `rider_pay`). Paying later is one `expenses` row
with `rider_payment = true` (moves money, clears the debt, never counted as spending again).
Profit figures read `fn_spending()` (server) or `spendingWithRiderPay()` (app); cash figures
(shift report, petty cash, Payments balances) read the raw expenses.

## Number rules (set by the owner, 2026-11-18)

- **Money always has 2 decimal places**, stored and shown: `KSh 1,250.50`, `KSh 100.00`. Use
  `formatMoney` / `formatCurrency` / `roundMoney` from `src/utils/money.ts` (website:
  `website/src/numbers.ts`), never `toFixed`, `Math.round` or `toLocaleString` on an amount.
  Money columns are `numeric(14,2)`. Rates that are not amounts (percent, KSh per point) are exempt.
- **Quantities have at most 1 decimal place**: `2`, `1.5`. Quantity boxes use
  `<NumberInput decimals={QTY_DECIMALS} />`; quantity columns are `numeric(p,1)`
  (`20261130007_quantity_one_decimal.sql`). Recipes state amounts per batch (yield), not per item.

## Finishing rule (set by the owner, 2026-11-23)

Every change that isn't fully live when the work stops gets a numbered **To finish** list, in
`docs/TO_FINISH.md` (newest at the top) and in the reply. Each step is one line:

- what to do, with the exact command, screen or SQL (`npx supabase db push`, then
  `bash scripts/check-live-grants.sh`);
- how to see it worked ("A 'Watchdog test' message should arrive in Telegram");
- **You:** at the start when only the owner can do it (accounts, secrets, payments, devices).

Steps are in the order they must run. Nothing is called done until its steps are ticked; a
ticked item moves to **Done** at the bottom of the file.

Example (Phase 5):
1. Apply the database change: `npx supabase db push`, then `bash scripts/check-live-grants.sh`.
2. Deploy the function: `npx supabase functions deploy ops-alert --no-verify-jwt`.
3. Run `SELECT public.run_ops_watchdog(true);` in the SQL editor. A "Watchdog test" message should arrive in Telegram.
4. **You:** create free UptimeRobot or Better Stack monitors for the web app, the website and the health check, with both Telegram and email as contacts. Then break one on purpose once to see the alert arrive.

## Permission rules (2026-11-18)

Every permission the app checks is also enforced by the database (`has_permission` in RLS or the
function), and edge functions use `requirePermission`, never a role name. A new table with a
policy needs the matching GRANT to `authenticated`, or nobody can read it (the invoices bug).
`supabase/tests/permissions/permissions_test.sh` checks both.
