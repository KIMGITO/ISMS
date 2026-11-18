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
