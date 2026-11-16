# Step 5: Inventory valuation, lots, expiry, counts and locations

## Goal

Know what stock is really worth and what it really cost, sell the oldest milk first, never sell expired goods, count stock properly, and know which shelf, fridge or store it is in.

## What we have today

- One stock number per product per branch, and one `cost` that can be overwritten when a purchase is received.
- Stock History logs every change (`inventory_adjustments`), including sales, counts, damage, production and transfers.
- The books' stock value drifts from stock × cost, so step 1 added a "Match stock" button.
- Production (BOM) uses ingredients and makes finished goods, but cost doesn't flow from ingredients to the product.

## What to build

### Costing

- Business setting per product category: **average cost** (default) or **FIFO**.
- Every stock-in creates a cost layer (`stock_layers`: product, quantity left, unit cost, date, source).
- Every stock-out uses up layers (FIFO), or uses the running average, and records the cost on the sale line. `transaction_items.unit_cost` already exists.
- Production: the finished product's cost = the ingredients used + any added labour or overhead. It feeds the product's layer.
- Branch transfers move layers at their cost. That posts Stock between branches through an inter-branch account, so neither branch's books drift.

### Lots and expiry

- Optional per product: track lots or batches with expiry date (milk, yoghurt, medicine).
- Receiving asks for lot and expiry. Production creates a lot.
- Selling picks the lot that expires first (FEFO) unless the cashier chooses.
- Warnings before expiry (3 days, configurable). Expired lots can't be sold and are written off with one tap.
- Recall: find every sale of a lot and its customers.

### Serial numbers

- Optional per product (fridges, phones): one serial per unit, recorded at receiving and on the receipt, and searchable for warranty.

### Stock counts

- Count sessions: full or by category or location, with stock frozen or live.
- Count on the phone with the barcode scanner. Counting blind (not seeing the expected number) is optional.
- Review the differences, approve, then post. A second person can be required for big differences.

### Locations within a branch

- Locations (shop floor, cold room, store, van). Stock per product per location. Moves between locations.
- Riders' vans as locations, so delivery stock is accounted for.

## How it posts to the books

| Event | Debit | Credit |
|---|---|---|
| Sale | Cost of goods sold (layer cost) | Stock |
| Production | Stock (finished) | Stock (ingredients), Labour/overhead applied |
| Transfer out | Stock in transit / Owed by branch X | Stock |
| Transfer in | Stock | Stock in transit / Owed to branch Y |
| Count difference, expiry write-off | Stock losses | Stock (or the reverse) |

When this is done, the books' stock value equals the sum of the layers, and "Match stock" is only needed for opening balances.

## Permissions

Reuse `inventory.*` (`inventory.stock_count`, `inventory.expiry`, `inventory.wastage` already exist). Add `inventory.locations` and `inventory.costing` (Owner/Admin).

## Done when

- Buying milk at 48 then 52, selling some, producing yoghurt and transferring to Westlands leaves stock value, cost of goods and both branches' books equal to a hand calculation.
- An expired lot can't be sold at the till.

## Open questions

- Should cashiers see the lot picker, or is FEFO always automatic?
- Is a "van" location needed now, or later with routes?
