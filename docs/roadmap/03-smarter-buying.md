# Step 3: Smarter buying

## Goal

Know what to order before it runs out, ask suppliers for prices, get orders approved, and match what the supplier bills to what actually arrived.

## What we have today

- Suppliers and purchases (Pending → Ordered → Received / Cancelled), built 2026-11-16.
- `receive_purchase` adds the whole purchase to stock in one go and can update product cost.
- Receiving posts Stock / What we owe suppliers, and supplier payments exist (step 1).
- Low stock shows on the dashboard, but nothing suggests what to order.
- Stock transfers between branches (built 2026-11-11, migration `20261111003`): send takes stock off the sender ("on the way"), the receiver counts what arrived, a shortage stays on the transfer at cost, and the sender can cancel while it is on the way. The receiver's cost becomes a weighted average.
- Transfers do not reach the books yet: each branch has its own books, and nothing is posted when stock leaves one branch or arrives at another.

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

- Approval limit per role: each role has its own KSh limit (for example Manager 50,000, Owner none). A purchase or transfer above the limit of the person who made it waits for approval.
- Status `Awaiting approval` between draft and ordered. `purchases.approve` approves or rejects with a reason, and the requester is notified.

### Receiving in parts

- Receive line by line, with quantity received, damaged or short. The rest stays open (`Part received`).
- Each receipt is a goods received note (`GRN-…`) and adds only what arrived.

### Supplier bills

- `supplier_bills` (the supplier's invoice number, date, due date, VAT) linked to one or more receipts.
- Three-way check: order vs received vs billed. A difference over a tolerance is flagged before the bill can be approved.
- What we owe suppliers moves from "received" to "billed". Until billed, the amount sits in a "Goods received, not billed" account.
- Bills due this week appear on the Overview. Paying uses the step 1 supplier payment.

### Stock transfers between branches

Transfers become part of buying, not a separate side screen.

- **Suggested orders look at other branches first.** If another branch the same owner runs has more than its reorder level plus the quantity needed, the suggestion is "Transfer from <branch>" instead of "Buy from <supplier>". One tap makes a draft transfer, the same way a draft purchase is made.
- **Transfer requests.** A branch can ask for stock (`Requested`). The sending branch accepts it, which makes the send, or declines with a reason. Both sides are notified.
- **Central buying.** The main branch can make one purchase that covers several branches, with a "for branch" quantity on each line. When the goods arrive at the main branch, the transfers to each branch are drafted automatically. The branch that orders pays the supplier for everything. The other branches' share reaches them as transfers at cost, so what they owe the ordering branch shows in the between-branches account (3200).
- **Receiving uses the same screen as purchases.** Count line by line, with quantities received, damaged or short, and a note (`TRN-…`), so staff learn one way of receiving.
- **Shortages are settled.** A shortage on a transfer is either written off as a loss at the sender, found later (it goes back to the sender's stock), or received late at the receiver. Today it just stays on the transfer.
- **Large transfers can need approval,** using the same per-role limit as purchases.

### Returns to supplier

- Send damaged or wrong goods back: stock out, and a supplier credit lowers what we owe.

## How it posts to the books

| Event | Debit | Credit |
|---|---|---|
| Goods received (no bill yet) | Stock | Goods received, not billed (new liability 2050) |
| Supplier bill | Goods received, not billed + VAT on purchases (new asset 1300) | What we owe suppliers |
| Price difference on the bill | Stock or Cost of goods sold | Goods received, not billed |
| Return to supplier | What we owe suppliers | Stock |
| Transfer sent (sender's books) | Stock on the way to branches (new asset 1210) | Stock |
| Transfer received (receiver's books) | Stock | Owner's account between branches (new 3200) |
| Transfer received (sender's books) | Owner's account between branches (3200) | Stock on the way to branches |
| Transfer cancelled (sender's books) | Stock | Stock on the way to branches |
| Transfer shortage written off (sender's books) | Stock losses | Stock on the way to branches |

The VAT return (step 1 VAT tab) then shows VAT on purchases next to VAT on sales.

Each transfer is valued at the sender's cost, so no profit is made on it. Account 3200 holds what branches owe each other, and when you add the same owner's branches together it nets to zero. Transfers are posted through `acc_post_source()` like everything else. A rebuild also posts the transfers made before this step.

## Permissions

Reuse `purchases.*` and `suppliers.*`. Add `purchases.request_quote` and `supplier_bills.manage`. Transfers keep `inventory.transfer_stock` (send, accept a request) and `inventory.receive_stock` (receive). Add `inventory.request_transfer` so a branch can ask for stock without being able to send any.

## Done when

- A product below its level shows up in Suggested orders, becomes a purchase, is approved, received in two parts and billed with a price difference. The books end up correct, with VAT on purchases recorded.
- A product low at one branch but plentiful at another is suggested as a transfer. It is sent, received short, and the shortage is written off. Both branches' books balance, the stock on the way account goes back to zero, and account 3200 across the two branches adds up to zero.

## Decided

- Approval limits are set per role, not per branch (2026-11-16).
- With central buying, the branch that orders pays the supplier for everything (2026-11-16).

## Built (2026-11-16)

- Migration `20261118001_smarter_buying.sql`; screens: **Buying** (new, G then 5: Reorder, Approvals, Bills, Returns, Settings), **Suppliers & Purchases** (ask for prices, place order, approve, receive in parts, enter bill, return, close), **Stock Transfers** (ask for stock, answer requests, drafts, approval, settle shortages), **Accounting** (bill payments, VAT on purchases).
- Approval is checked in the database, so an older app that saves a purchase as "Ordered" above the limit gets "Awaiting approval".
- Purchases received before this step have no GRN and keep posting Stock / What we owe suppliers directly.
- Not done: the optional Telegram alert for reorders (the Telegram bot is the developer's alert channel, not the business's); in-app notification only.
- Tested on a copy of the seed database: both "Done when" flows, refusals (limits, own approval, receiving too much, paying an unchecked bill), books balance per branch, between-branches account nets to zero, rebuild gives identical balances. Not yet clicked through in a browser.
