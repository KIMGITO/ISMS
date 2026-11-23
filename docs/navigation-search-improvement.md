# Navigation, global search and operational screens (2026-11-23)

Migration: `supabase/migrations/20261202001_record_refs_global_search.sql` (not on live yet; see `docs/TO_FINISH.md`).

## 1. Existing navigation (before)

- One list, `src/utils/screens.ts`, drives the desktop sidebar, the phone's More sheet, global search and the tour. Each screen has permissions; menus only show screens the role can open (`canOpenScreen`). This already works and was kept.
- The phone bottom bar (`src/utils/mobileNav.ts`) is ordered by role (cashier: Shift, POS, Quick Sale, Sales, Loyalty; owner: Home, Sales, Payments, Inventory, Loyalty). Kept as is: it already puts the most-used screens first.
- Problems: six groups mixed unrelated work. "Selling" held customers, promotions and deliveries; "Business" held Home, Feedback, the Assistant and Business Management; "Team" held the Audit Log and Roles. Inside a group, the order followed the sidebar code, not the work.

## 2. Final navigation hierarchy

Home stays first, on its own. Then:

| Group | Screens |
|---|---|
| Selling | Quick Sale, POS, Sales Log, Online Store, Payment Prompts |
| Customers | Loyalty (customers, debts, wallets), Promotions & Points, Regular Orders, Feedback |
| Stock | Inventory, Stock History, Stock Transfers, Production & BOM |
| Buying & deliveries | Buying (suppliers, purchases), Deliveries |
| Money | Payments & Expenses, Petty Cash, Finance & Accounting |
| Reports | Stock Report (Home is the figures dashboard, shown above the groups) |
| Team | Shift, Workers |
| Admin | Roles, Audit Log, Business Management, Settings |
| You & the app | Assistant, Notifications, My Profile, About this app |

- Everyday work comes first and admin near the end. The same groups and order appear in the sidebar and the More sheet (`screenOrder()`).
- No screen was moved, merged or renamed, and no permission changed. Nothing is nested deeper.

## 3. Global search architecture

- **Two sources, one list.** The app still searches what it already holds (screens, features, shortcuts, products, categories, customers, suppliers, purchases, team, roles, notifications), so those results appear instantly. Records that live on the server come from one database call, `global_search(business, query, limit)`, sent 250 ms after typing stops.
- **Removed:** the search box used to download every expense row each time it opened. Expenses now come from the database search.
- **Security.** `global_search` is `SECURITY INVOKER`, so it runs as the signed-in person and every table's own RLS policy applies: a cashier without `expenses.view` gets no expenses, a rider gets no sales, and one branch never sees another's records. The app also drops any result whose screen the role can't open (`recordDestination`). Signed-out callers can't run it.
- **Performance.** Each kind returns at most 6 rows (20 maximum), best match first, with no N+1 queries. Indexes:
  - the receipt code is matched as a range on `(business_id, fn_short_id(id))`;
  - trigram indexes cover references, payment codes and sale customer names;
  - M-Pesa codes have their own index.

  A search on the test database runs in about 30 ms.
- **Ranking.** An exact reference scores 100, part of a reference 85–90, a name or text match 50–55, an exact amount 45. Groups are ordered by their best result, so an exact receipt or reference number comes first.
- **Empty and failed searches.** Fewer than 2 characters are not searched. While the database answers, the box shows "Searching…", then "Nothing found." Offline, or before the migration, it falls back to the in-app results with no error.

## 4. Searchable entities and fields

| Kind | Found by | Shown |
|---|---|---|
| Sale / receipt | Receipt number in any printed form (TXN-ABCD1234, RCT-2026-ABCD1234, ABCD1234, first 4+ characters), M-Pesa code that paid it, customer, exact amount | Receipt no., customer, date, amount, method, items |
| Delivery | Receipt or order number, customer, rider, a product on it (last 30 days) | Reference, recipient, products with quantity and unit, status, rider |
| Website order | Order number (#123), customer, phone, M-Pesa or payment reference | Order no., customer, items, amount, status |
| Payment | Payment reference / M-Pesa code, payer, phone, exact amount | Reference, payer, amount, method, date, status |
| Expense / petty cash | EXP- reference (or its last digits), what it was for, category, supplier receipt no., amount | Reference, description, amount, category, date |
| Stock movement | STM- reference, the document that moved it (receipt, transfer), product | Reference, product, quantity, type, source, date |
| Customer account entry | LDG- reference, payment code, note | Reference, customer, type, amount, date |
| Journal entry | JE-120, memo | Reference, memo, source, amount, date |
| Audit log entry | LOG- reference, who, what | Reference, what changed, by, date |
| Stock transfer | Transfer reference | Reference, status, date |
| Invoice | Invoice number (existing lookup) | Number, customer, balance |
| Product, category, customer, supplier, purchase, team | As before, from loaded lists (name, SKU, phone, account no., purchase ref…) | As before |

## 5. Reference numbering

- Existing numbers are kept: receipts (TXN-/RCT- from the sale id, already printed on paper), journal entries (JE-n), invoices, orders, quotes, delivery notes, GRNs, transfers, purchases, production batches, website orders (#n), payment codes.
- New, where none existed:
  - **EXP-2026-000123** for expenses (`receipt_ref` is the supplier's paper);
  - **STM-…** for stock movements (`reference_number` is the document that moved the stock);
  - **LOG-…** for audit log entries;
  - **LDG-…** for customer account entries (`reference_id` is a repeat guard).
- How they're made:
  - Set by a database trigger on insert. A value sent by the app is replaced, and a later update can't change it.
  - Unique index. The uuid stays the key for every link.
  - Numbers come from one sequence per kind, like `JE-`. A sequence takes no row lock, so tills saving at once never wait on or deadlock over a counter: a sale writes stock movements and log entries in one transaction. Gaps can appear when a save fails, which is normal for sequences.
  - The year is the Kenyan year the record was made; the number keeps counting.
  - The number is shared across all businesses, so it hints at overall volume (the same as `JE-` today). It doesn't reveal any ids.
- Existing rows were numbered oldest first. That one update ran with the table's triggers paused, so no money balance, books entry, audit entry or `updated_at` changed.
- **No new delivery number.** A till delivery *is* a sale, and its receipt number is what the rider carries on paper, so deliveries use it (website deliveries use their order number). The delivery list used to show "Till sale" instead of a number; it now shows the receipt number.

## 6. Search-to-record navigation and highlighting

- `src/services/recordSearch.ts` handles each result:
  - `recordDestination()` decides the screen, the search target (`uiStore.searchTarget`) and the row to highlight;
  - `describeRecord()` builds the result text.
- Each screen reads its target, opens the right tab, clears filters that would hide the record, and fetches the record on its own when it's older than what the screen has loaded. The rows carry `data-search-id`, and the existing `spotlight()` scrolls the row to the middle and highlights it for about 3 seconds with an amber ring and tint (not colour alone). Nothing about the record changes.

| Result | Lands on |
|---|---|
| Sale | Sales Log; that receipt opens. A sale older than the newest 1,000 is fetched by id. |
| Expense | Payments & Expenses → Expenses, period "All", category cleared; an older one is fetched and added; row highlighted |
| Payment | Payments & Expenses → Payments, filter "all"; row highlighted |
| Stock movement | Stock History, filters cleared, un-hidden; row highlighted; one not loaded opens in its stock receipt |
| Customer account entry | That customer → History, filter "all"; entry highlighted |
| Journal entry | Finance → Journal with that entry open (looked up by JE number on its date) |
| Audit entry | Audit Log with the period widened to include it, filters cleared; also fetched by id if beyond the 500 loaded; row highlighted |
| Delivery | Deliveries, on the tab that holds it (Requests, Mine, History or Trips); otherwise the sale's receipt |
| Website order / transfer | Online Store / Stock Transfers, row highlighted |

Browser back, and the previous search: results open with the app's normal tab navigation, so back works as it does for any screen. The search box clears after opening a result, as before.

## 7. Copying references

`src/components/shared/CopyRef.tsx`: tapping a reference copies all of it. The chip shows a tick and "Copied" for 1.6 s, and screen readers hear "Copied". It has an accessible label ("Copy receipt TXN-…") and a tooltip. Tapping it never opens, swipes or long-presses the row (`data-no-swipe`, stops the event), so the row keeps its own tap for details.

Used on:
- receipt numbers in the Sales Log;
- EXP- on expenses;
- payment references;
- STM- (row on wider screens, and the stock receipt);
- LDG- on customer history;
- JE- in the journal entry sheet;
- LOG- in the audit log;
- delivery and order references.

## 8. Product-first screens

- **Deliveries:**
  - each delivery lists its products as separate lines, with the quantity and unit in bold first ("2 L  Fresh Milk"), above the location and the money;
  - till deliveries now say the unit, from the product;
  - on "Mine", the rider can tick each line as they pack or hand it over, with "2 of 3 checked" and a tick icon plus the word "Checked", so it doesn't rely on colour;
  - "Mark delivered" with lines not ticked asks once: "1 of 3 items not checked. Did Mary get everything?" There's no extra step when everything is ticked;
  - the recipient, location, phone and map link are unchanged.
- **Sales Log:** each row now leads with what was sold ("2 × Milk 500ml, 1 × Bread and 2 more"), then the amount, unit totals and payment method.
- Already product-first and unchanged: Stock History (product, then quantity and unit), the POS and Quick Sale product grids, transfers by product.
- Partial deliveries aren't supported: a delivery is delivered or not delivered as a whole. That's unchanged, so there's no ordered/dispatched/delivered split to show.

## 9. Security considerations

- No RLS policy, grant or constraint was loosened. `global_search` only reads through RLS.
- The new trigger function and sequences are not callable by app roles. `fn_make_ref` is a pure formatter.
- The test suite checks these cases: cashier → no expenses, journal or audit entries; rider → no sales or expenses; branch 2 can't see branch 1's records; signed-out → refused.

## 10. Testing results

- `supabase/tests/search/global_search_test.sh` (new, run on a database built from all migrations), 37 checks covering:
  - references given, replaced, stable and unique, and older rows numbered;
  - 4 parallel sales with distinct references and no deadlock;
  - finding by receipt (logged, printed and partial), expense ref and its last digits, description, stock movement ref, stock by receipt, JE-n and LOG ref;
  - odd characters;
  - deliveries showing the receipt number and product lines;
  - the permission cases above.
- Full database suite (`scripts/run-db-tests.sh`, all 8 suites on a fresh build from the migrations): all passed (promotions 98, referrals 74, numbers 9, AI permissions 10, permissions 37 including the grants check, regular orders 63, sale totals 44, search 37).
- App: `npm run lint`, `npm run website:lint` pass; `npm test` 75 passed (2 new: result destinations and permissions, menu grouping); `vite build` and `npm run website:build` pass.
- Not done: clicking through in a running app or on a phone. Highlighting and copy feedback were not seen on screen.

## Implementation checklist

- [x] Navigation audited and regrouped (sidebar and More sheet), role filtering unchanged
- [x] References EXP/STM/LOG/LDG: column, trigger, unique index, backfill (tested on DB)
- [x] `global_search` with RLS, ranking, limits, indexes (tested on DB)
- [x] Search box merges database results, groups by best match, shows "Searching…"
- [x] Exact landing: sales, expenses, payments, stock, customer accounts, journal, audit, deliveries (tags and targets; type-checked; not clicked through)
- [x] Order and transfer rows tagged for highlighting
- [x] CopyRef on all reference types listed above
- [x] Delivery lines product-first, tick-off check before "Delivered"
- [x] Sales Log rows product-first
- [ ] Migration on live (`docs/TO_FINISH.md`)
- [ ] Clicked through in the app on desktop and phone

## Outstanding issues

1. A rider-payment expense (paying a rider later) is left out of the Expenses list (it's counted as rider pay on the day owed), so search finds it but has no row to highlight.
2. Online Store and Stock Transfers have their own status tabs. If the record is on a tab that isn't open, the highlight finds nothing and the screen just opens.
3. Sale items and products are matched from the newest 1,000 sales loaded in the app; older sales are found by receipt, customer, amount or M-Pesa code through the database.
4. The audit log search by name only looks at `details.label` and `details.by`, not at every changed field.
