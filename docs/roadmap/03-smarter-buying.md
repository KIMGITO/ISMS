# Step 3: Smarter buying

## Goal

Know what to order before it runs out, ask suppliers for prices, get orders approved, and match what the supplier bills to what actually arrived.

## What we have today

- Suppliers and purchases (Pending → Ordered → Received / Cancelled), built 2026-11-16.
- `receive_purchase` adds the whole purchase to stock in one go and can update product cost.
- Receiving posts Stock / What we owe suppliers, and supplier payments exist (step 1).
- Low stock shows on the dashboard, but nothing suggests what to order.

## What to build

### Reorder points

- Per product: `reorder_level`, `reorder_quantity` (or "order up to"), preferred supplier, supplier's price and lead time in days.
- A nightly job (pg_cron, like the backups) lists products below their level. It also sends a notification and an optional Telegram alert.
- "Suggested orders" screen groups suggestions by supplier. One tap makes a draft purchase per supplier.
- Optional: suggest the level from average daily sales over the last 30 days × lead time + safety days.

### Quotes from suppliers (RFQ)

- A draft purchase can be sent to one or more suppliers by WhatsApp, SMS or email ("Request for quote").
- Record each supplier's prices. Picking a winner turns that quote into the purchase order, and the others are marked lost.

### Approval

- Business setting: purchases above KSh X need approval.
- Status `Awaiting approval` between draft and ordered. `purchases.approve` approves or rejects with a reason, and the requester is notified.

### Receiving in parts

- Receive line by line, with quantity received, damaged or short. The rest stays open (`Part received`).
- Each receipt is a goods received note (`GRN-…`) and adds only what arrived.

### Supplier bills

- `supplier_bills` (the supplier's invoice number, date, due date, VAT) linked to one or more receipts.
- Three-way check: order vs received vs billed. A difference over a tolerance is flagged before the bill can be approved.
- What we owe suppliers moves from "received" to "billed". Until billed, the amount sits in a "Goods received, not billed" account.
- Bills due this week appear on the Overview. Paying uses the step 1 supplier payment.

### Returns to supplier

- Send damaged or wrong goods back: stock out, and a supplier credit lowers what we owe.

## How it posts to the books

| Event | Debit | Credit |
|---|---|---|
| Goods received (no bill yet) | Stock | Goods received, not billed (new liability 2050) |
| Supplier bill | Goods received, not billed + VAT on purchases (new asset 1300) | What we owe suppliers |
| Price difference on the bill | Stock or Cost of goods sold | Goods received, not billed |
| Return to supplier | What we owe suppliers | Stock |

The VAT return (step 1 VAT tab) then shows VAT on purchases next to VAT on sales.

## Permissions

Reuse `purchases.*` and `suppliers.*`. Add `purchases.request_quote` and `supplier_bills.manage`.

## Done when

- A product below its level shows up in Suggested orders, becomes a purchase, is approved, received in two parts and billed with a price difference. The books end up correct, with VAT on purchases recorded.

## Open questions

- Approval limit per role, or one limit per branch?
- Should the main branch be able to order for other branches (central buying)?
