# Feature map: what supports what

Updated 2026-11-16. How the app's parts feed each other, what was merged, and what could be merged next.

## The four flows

Everything in the app is one of four flows. Each screen either starts a flow or shows its result.

```
SELL ──────────► MONEY ◄────────── BUY
  │                ▲                 │
  ▼                │                 ▼
CUSTOMERS          └──── STOCK ◄─────┘
```

### 1. Selling

| Screen | What it makes | What it feeds |
|---|---|---|
| Quick Sale | a sale (`transactions` + items) | stock goes down, books (sale + cost of goods), shift totals, Home, Finance, customer points if a customer is added |
| POS | a sale, with customer, discounts, points, wallet, credit | same as Quick Sale, plus customer debt, wallet and points. **Quote** turns the cart into a quote |
| Online Store | website orders (sales with delivery) | same as a sale, plus Deliveries for riders |
| Quotes & Invoices | quote → sales order → deliveries → invoices → payments, credit notes | stock goes down on delivery, books (sales, cost of goods, receivables, VAT), the customer in Loyalty |
| Sales Log | refunds (credit notes) on past sales | stock back, money back or into the wallet, books |
| Deliveries | rider tasks for delivery sales | sale status, rider fees |

### 2. Customers

| Screen | Holds | Fed by |
|---|---|---|
| Loyalty | customers, points, wallet, till debt, debt invoices, invoices from Quotes & Invoices | every sale with a customer, debt payments, wallet top-ups, orders and invoices for a phone number (a new number becomes a customer) |
| Feedback | reviews, complaints | website and staff |

### 3. Money

| Screen | Holds | Fed by / feeds |
|---|---|---|
| Payments & Expenses | money received (cash, M-Pesa, Airtel, card, bank) and expenses | sales, debt payments, invoice payments, supplier payments; feeds the books |
| Payment Prompts | M-Pesa / Airtel prompts to a phone | Payments when paid |
| Petty Cash | money spent from the till | Expenses, books |
| **Finance & Accounting** | Summary (profit, money in and out, debts, wallets, points) and the books (profit & loss, balance sheet, journal, VAT, who owes, money counts, lock) | everything above, posted automatically |

### 4. Stock and buying

| Screen | Holds | Fed by / feeds |
|---|---|---|
| Inventory | products, stock levels, categories | everything that moves stock; opening stock goes to Stock History and the books |
| Stock History | every stock change | sales, restocks, receiving, transfers, wastage, counts, production |
| **Buying** | suppliers, purchases, reorder suggestions, approvals, supplier bills, returns, approval limits | receiving adds stock; bills and payments go to the books; reorder suggests asking a branch before buying |
| Stock Transfers | stock between branches: ask, send, receive, shortages | both branches' stock and books; a new branch can ask for products it doesn't sell yet |
| Production & BOM | recipes, batches | stock in and out |

## Suppliers sign in (Supplier role)

Someone at a supplier gets their own sign-in, tied to one supplier record. They are **not staff**: they never join the business as a member, so no staff table, screen or function opens for them. They see a small app of their own:

| Part (Roles → Supplier) | What they see and do | Default |
|---|---|---|
| Orders | orders placed with them (not drafts or ones waiting for approval), what came and what is still to come; **Confirm** with the day they will deliver | on |
| Price requests | requests sent to them; type their own prices, untick what they can't supply | on |
| Received | goods received notes: what arrived, what was damaged | on |
| Statement | their bills, payments, returns, what is owed to them | on |
| My details | change their phone, email, KRA PIN, M-Pesa till / paybill, bank account | on |
| Their stock | your stock of the products they supply, to plan deliveries | off |

Never: customers, sales, selling prices, profit, staff, other suppliers or other suppliers' prices.

How it works: Buying → Suppliers → ⋯ → **App access** (owner/admin, permission `suppliers.portal`) invites by email. They sign up, verify the email, and **Join team** with the code. The business is told when they confirm an order, send prices or change their payment details; they are told about new orders, price requests and payments. Checked in the database by `supplier_portal_*` functions (20261120001).

## What was merged on 2026-11-16

| Before | Now | Why |
|---|---|---|
| Finances + Accounting (two screens, two different profits) | **Finance & Accounting**: Summary · Books · Who owes · Checks | One place for money. Summary now counts invoices, so both show the same profit |
| Suppliers & Purchases + Buying | **Buying**: Suppliers · Orders (Reorder, Purchases, Approvals) · Bills (Bills, Returns) · Settings | Buying is one job: who, what, approve, receive, pay |
| Quotes & Invoices apart from Loyalty and POS | Orders and invoices link to (or add) the Loyalty customer by phone; Loyalty shows "On invoices" and **New quote**; POS has **Quote** | A business customer is one person across till, points and invoices |

Old screen ids still work: `accounting` opens Finance → Books, `suppliers` opens Buying → Suppliers (G then 3, G then Z, links, saved start screens, the tour).

## Fixed while checking from a fresh business

- Quick Sale and POS sales were booked with no cost of goods (their items are saved after the sale row). Now re-posted when the items arrive; old ones were repaired.
- Starting stock typed in when adding a product never reached Stock History or the books. Now it does ("Opening stock", against Opening balances).
- A new branch could not ask for stock (it had no products to pick). It now picks from the other branch's list.
- Product names showed in lowercase on the new screens.
- All dropdowns and checkboxes use the app's own components (no browser `<select>` or checkbox left in the app).
- Tab rows on phones: groups fit the screen; long rows fade at the edge and keep the chosen tab in view.

## Could be merged next (not done)

| Candidates | Suggestion |
|---|---|
| Loyalty's debt "Invoice" (bill for till debt) and Quotes & Invoices invoices | Two kinds of "invoice". Make the debt bill a statement ("Statement of account") so "invoice" means one thing |
| Payment Prompts, Petty Cash and Payments & Expenses | Prompts and Petty Cash as tabs of Payments & Expenses; cashiers keep their own permissions |
| Stock History and Inventory | Stock History as a tab of Inventory |
| Shift and Home | Shift is already the clock bar; the Shift screen could be a Home card for staff |

## Known gaps

- A manual restock in Inventory (not through a purchase) changes stock but not the books; use Buying → receive, or Finance → Checks → Match stock.
- Refunds are not taken off Home's sales figures.
- KRA eTIMS does not yet sign invoices and credit notes from Quotes & Invoices.
- Website orders cannot be turned into an invoice.

## Database files

The 82 migration files were merged into two on 2026-11-16 (`20261120001_schema.sql`, `20261120002_platform_and_defaults.sql`). A database built from the two matches one built from the 82, object by object. The live database was reset onto them (it held no business data). New changes go in new files after these two.
