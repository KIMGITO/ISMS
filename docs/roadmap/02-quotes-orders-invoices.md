# Step 2: Quotes → sales orders → invoices, credit notes and refunds

## Goal

Sell to businesses and big customers the way they buy: send a quote, turn it into an order when they accept, deliver all of it or in parts, invoice, and get paid later. Undo a sale properly with a credit note or refund instead of deleting it.

## What we have today

- Every sale is an instant till sale (`transactions`). Credit sales create debt (`credit_payments`).
- "Customer invoices" are statements of a customer's debt (built 2026-11-08), not invoices for a sale.
- Voiding a sale sets `deleted_at`. The books reverse it, but there is no credit note document and no partial refund.
- Online orders exist (`online_orders`) but go straight to a sale.

## What to build

### Documents and their life

```
Quote (draft → sent → accepted / declined / expired)
  └─ Sales order (confirmed → part delivered → delivered → invoiced → paid, or cancelled)
       ├─ Deliveries (one or more; each takes stock out)
       └─ Invoices (one or more; each becomes money owed)
            └─ Credit notes (all or some lines back; money back or less owed)
```

### Tables

- `quotes`, `quote_lines`: customer, valid until, lines (product, quantity, price, discount, VAT), notes, terms, status.
- `sales_orders`, `sales_order_lines`: from a quote or new; quantity ordered, delivered and invoiced per line.
- `sales_invoices`, `sales_invoice_lines`: number `INV-2026-0001` (per branch, no gaps), due date, payment terms (cash, 7, 14, 30 days).
- `credit_notes`, `credit_note_lines`: against an invoice or a till sale; reason; returns stock or not.
- `invoice_payments`: money received against an invoice. It reuses `process_business_payment` so M-Pesa, Airtel, card and bank all work.

### Rules

- A delivery takes stock out at that moment and records `unit_cost`, like a till sale.
- Numbers come from a per-branch counter in the database, never from the phone.
- An accepted quote's prices are kept even if product prices change later.
- Invoices sent to KRA eTIMS use the existing `kra-etims` function. A credit note sends a credit note to KRA.
- A refund of a till sale makes a credit note plus money out (cash, M-Pesa B2C later). It never deletes the sale.

### Screens

- **Sales → Quotes, Orders, Invoices** tabs, with filters by status and customer.
- Build a quote from the cart (same product picker as POS).
- Share a quote or invoice as PDF or WhatsApp, reusing the invoice look (logo, stamp, QR).
- Customer page: open invoices, what they owe by invoice, and ageing (not yet due, 1–30, 31–60, 61–90, 90+ days late).
- Sales Log: "Refund" on a sale opens a credit note with the lines ticked.

## How it posts to the books

| Event | Debit | Credit |
|---|---|---|
| Delivery | Cost of goods sold | Stock |
| Invoice | Customers owe us | Sales, Delivery fees, VAT to pay KRA |
| Invoice payment | Cash / M-Pesa / Bank … | Customers owe us |
| Credit note | Sales, VAT | Customers owe us (or money out for a refund) |
| Credit note with stock back | Stock | Cost of goods sold |

A quote or order posts nothing. New source types: `sales_delivery`, `sales_invoice`, `invoice_payment`, `credit_note`.

## Permissions

`quotes.view`, `quotes.manage`, `sales_orders.view`, `sales_orders.manage`, `invoices.view`, `invoices.manage`, `refunds.create` (Manager by default; Cashier can refund same-day till sales only).

## Done when

- A quote can be sent, accepted, delivered in two parts, invoiced, paid by M-Pesa, and part of it credited. The books, stock and customer balance are all right at every step.
- Invoice numbers have no gaps per branch.
- Refunding a till sale leaves the sale in the Sales Log with a linked credit note.

## Open questions

- Should till credit sales also create an invoice automatically, or stay as they are?
- Payment terms per customer (default 0 days) or per invoice only?
- Do we need customer-facing approval of quotes on the website (a "view and accept" link)?

## Decisions taken when building (2026-11-17)

- Till credit sales stay as they are; no automatic invoice.
- Payment terms come from the customer's existing setting (pay now / weekly / monthly = 0 / 7 / 30 days) and can be changed per invoice, with an option to save them on the customer.
- Invoice debt is kept apart from till debt (`customers.debt_balance`). An invoice payment goes through `process_business_payment` with no customer, lands in "Payments not matched to a sale", and the invoice payment moves it to the invoice. A payment already in Payments (an M-Pesa till payment) can be used instead; typing an M-Pesa code that is already recorded reuses it.
- Credit notes are final (no void). A till sale can be refunded as money back, into the wallet, or off the debt that sale left. Cashiers (`pos.cancel_sale`) can refund only today's sales.

## Left for later

- KRA eTIMS for invoices and credit notes: the `kra-etims` function and `kra_etims_receipts` are keyed by till sale.
- A quote link customers can accept on the website.
- Refunds of till sales don't yet lower the Home dashboard and Finances sales figures (the books are right).
