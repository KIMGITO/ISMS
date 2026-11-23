# Test logins (seed_quick.sql)

`supabase/seed_quick.sql` fills an **empty** database with the smallest useful test data:
2 branches, 5 products (stocked in both), 5 customers, 5 riders, the owner and an admin.
No sales or history. It refuses to run on a database that already has a business.

Load it:
- local: in `supabase/config.toml` set `[db.seed] enabled = true` and `sql_paths = ["seed_quick.sql"]`, then `npx supabase db reset`
- linked: `npx supabase db query --linked -f supabase/seed_quick.sql`

## Logins

| Name            | Email                      | Password    | Role  | Branch          |
|-----------------|----------------------------|-------------|-------|-----------------|
| (your account)  | kimanthidennis02@gmail.com | your own (live); `Admin@123` on a blank DB | Owner | Both |
| Grace Wanjiku   | admin@kaykays.test         | `Test1234!` | Admin | Both            |
| Peter Mwangi    | rider1@kaykays.test        | `Test1234!` | Rider | Main            |
| Kevin Odhiambo  | rider2@kaykays.test        | `Test1234!` | Rider | Main            |
| Samuel Kiptoo   | rider3@kaykays.test        | `Test1234!` | Rider | Main            |
| John Mutua      | rider4@kaykays.test        | `Test1234!` | Rider | Westlands       |
| Collins Wafula  | rider5@kaykays.test        | `Test1234!` | Rider | Westlands       |

## Branches

| Branch                  | Address                       | Notes                    |
|-------------------------|-------------------------------|--------------------------|
| Main: the owner's own business (live: "KayKay's"), or KayKay's Milk on a blank DB | Ngong Road | Website slug `kaykays` on a blank DB |
| Same name + " Westlands" | Woodvale Grove, Westlands | Half Main's opening stock |

If the owner has already signed up and made one empty business, the seed keeps that
account and business (it becomes Main) and adds everything else to it. Loaded on live 2026-11-23.

## Products (both branches)

Fresh Milk 1L (KSh 60.00), Mala 500ml (KSh 70.00), Yoghurt Vanilla 500ml (KSh 120.00),
Butter 250g (KSh 280.00), Eggs Tray (30) (KSh 450.00). Shown on the website at Main only.

## Customers

| Name                   | Branch    | Pays            |
|------------------------|-----------|-----------------|
| Achieng Ndungu         | Main      | At the till     |
| Mutua Mwangi           | Main      | At the till     |
| Green Valley Hotel     | Main      | Weekly (credit) |
| Wairimu Kamau          | Westlands | At the till     |
| Westlands Coffee House | Westlands | Weekly (credit) |

The older, larger seed (90 days of sales) is kept as `supabase/seeders-data.s` and
`supabase/seed_extras.sql`; it was written for an older schema and may need fixes before it loads.
