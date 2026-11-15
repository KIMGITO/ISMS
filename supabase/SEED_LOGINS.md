# Test logins (local database only)

These accounts are created when you run `supabase db reset`, which loads
`supabase/seed.sql` and then `supabase/seed_extras.sql` (see `sql_paths` in
`supabase/config.toml`). They exist only in your local database, never in the live one.

## Owner

| Name            | Email                      | Password    | Role  | Branches                   |
|-----------------|----------------------------|-------------|-------|----------------------------|
| Dennis Kimanthi | kimanthidennis02@gmail.com | `Admin@123` | Owner | All three (switch between them) |

## Staff (password for all: `Test1234!`)

| Name           | Email                  | Role              | Branch     | Use it to test                          |
|----------------|------------------------|-------------------|------------|-----------------------------------------|
| Mercy Achieng  | manager@kaykays.test   | Manager           | Main       | Manager rights, reports, some Main sales |
| Brian Otieno   | cashier@kaykays.test   | Cashier           | Main       | Till, sales, customers                  |
| Lucy Wambui    | westlands@kaykays.test | Cashier           | Westlands  | Branch till, receiving transfers        |
| Faith Njeri    | thika@kaykays.test     | Cashier           | Thika Road | Branch till, the transfer still on the way |
| Joseph Kiprono | stock@kaykays.test     | Inventory Manager | Main       | Deliveries, sending stock transfers     |
| Peter Mwangi   | rider@kaykays.test     | Rider             | Main       | Rider screens                           |

## Website shoppers (from seed_extras.sql, password `Test1234!`)

Sign in on the website (Main branch shop, slug `kaykays`) with any of these:

| Email                       |
|-----------------------------|
| achieng.ndungu@example.com  |
| akinyi.kiprono@example.com  |
| chebet.wafula@example.com   |
| mercy.wafula@example.com    |
| muthoni.wafula@example.com  |
| mutua.mwangi@example.com    |
| wafula.odhiambo@example.com |
| wairimu.mwangi@example.com  |

They are Main's most regular customers, so they already have order history.
If the seed changes, see the `customer_accounts` table for the current list.

## Branches

| Branch                   | Address                         | Notes                                   |
|--------------------------|---------------------------------|-----------------------------------------|
| KayKay's Milk (Main)     | Ngong Road, opp. Adams Arcade   | Gets all supplier deliveries; website slug `kaykays` |
| KayKay's Milk Westlands  | Woodvale Grove, Westlands       | One cancelled transfer from Main        |
| KayKay's Milk Thika Road | Roysambu, next to TRM           | One transfer from Main not received yet |

## What seed.sql contains (minimal)

- 6 categories and the same 15 products in every branch.
- About 40 customers: 16 at Main, 10 at each other branch, plus 4 businesses
  (Green Valley Hotel, Tumaini Day School, Westlands Coffee House, Roysambu Bakery)
  that buy on credit most weekdays and pay on Fridays.
- 90 days of sales (about 3,600) paid by M-Pesa, Cash, Card, Bank and credit, with debt repayments.
- Stock transfers from Main to Westlands and Thika Road every Monday and Thursday.

## What seed_extras.sql adds

- Purchases: one per supplier delivery (about 580), plus 3 still open or cancelled.
- Production at Main: recipes for mala and yoghurt made from bulk milk; about 75 batches,
  one spoiled, one in progress now.
- Shifts for every staff member each day, with their sales counted; today's are still open.
- Expenses (rent, wages, power, fuel, ads) and petty cash for every branch, plus opening money balances.
- Website: delivery areas, promo codes `KARIBU10` and `MILK50`, about 60 past online orders,
  and 4 open today (unpaid, paid, being packed, on the way).
- Deliveries: about 100 past ones by the rider, and 4 today (delivered, on the road,
  assigned, and open requests no rider has taken yet).
- Business assets in every branch.

For the minimal data only, remove `"./seed_extras.sql"` from `sql_paths` in `supabase/config.toml`.
