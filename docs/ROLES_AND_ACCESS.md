# Roles and access

Each role's access is enforced in three places, so hiding a screen is never the only protection:

| Layer | What it does | Where |
|---|---|---|
| App | Hides screens and buttons | `SYSTEM_ROLES` in `src/utils/permissions.ts` |
| Database | Refuses rows and functions, even for direct API calls | `has_permission()` in migration `20261105014` |
| Edge functions | Refuse the call before doing paid or sensitive work | `requirePermission()` in `supabase/functions/shared/cors.ts` |

## Who can see what

| Area | Owner, Admin | Manager | Cashier | Rider |
|---|---|---|---|---|
| Own profile, own shifts, clock in | Yes | Yes | Yes | Yes |
| Home (business figures) | Yes | Yes | No | No |
| Sell | Yes | Yes | Yes | No |
| Inventory | Full | Full | View | No |
| Sales history | All | All | Own sales and customers' sales | No |
| Online orders | All | All | View, prepare | No, only assigned deliveries |
| Customers | Full | Full, no delete | View, add | No, only customers on their deliveries |
| Debts | Yes | Yes | Yes | No |
| Profit | Yes | Yes | No | No |
| Complaints | Reply | Reply | View, log | No |
| Expenses | Yes | Yes, no delete | No | No |
| Staff | Full | View, schedule | No | No |
| Settings, backups, API keys | Yes | Some settings, no keys | No | No |
| Set points or tiers by hand | Yes | Yes | No | No |
| Set wallet or debt balances by hand | Yes | Yes | No | No |
| Deliveries assigned to them | Yes | Yes | Yes, by assigning | Yes |

## Changing access

An Owner or Admin can grant or remove a permission per role in the Permissions screen. It saves to `role_permissions`, which the app and the database both read, and it overrides the defaults.

To change the defaults, edit `SYSTEM_ROLES` and `role_default_permissions` together, in a new migration. `npm test` fails if the two differ.

Only Owner, Admin, Administrator, Manager, Cashier and Rider have defined access. The other database roles, such as `Sales Staff` and `Viewer`, have none until an Owner grants it.

## Riders

A rider only gets deliveries through `get_my_deliveries`, which returns what's needed for the job: name, phone, location, items and amount, for that rider's own deliveries. Staff assign online orders in **Online Store**. Till sales link to a rider when the rider is chosen by name.

Deliveries named with a typed-in rider name aren't linked to any account, so nobody sees them in **My Deliveries**.

## Loyalty points

- Customers with a registered account earn 1 point per Ksh 100 spent, excluding delivery. Walk-in sales earn nothing.
- One point is worth Ksh 1, redeemable from 100 points. This follows [Naivas's rate](https://corporate.naivas.info/loyalty-programme/) of about 1%. Change the value and minimum in **Online Store > Settings**.
- Points can come off a till sale or website order, or be moved onto the account. They can't be exchanged for cash.
- Points used on a cancelled order come back. A website order must leave at least Ksh 1 to pay by M-Pesa.

To reset balances from sales history, run `supabase/recalculate_loyalty_points.sql`. Older app versions still award extra points, so run it once more after everyone has updated.

## Duplicate customers

A customer added by staff and the same person signing up online start as two records. They are never linked automatically, because a phone number typed at sign-up isn't proof of who someone is. Staff with `customers.manage` review matches under **Customers > Duplicates**, and they are told when a sign-up uses a number already on file.

| Data | When merged |
|---|---|
| Debt, wallet, points, purchases | Added together, then wallet money clears debt |
| Sales, payments, ledger, online logins | Move to the kept record |
| Tier | The higher one, or higher if the combined points earn it |
| Customer type, payment terms, delivery schedule, notes | The kept record's |
| Name, phone, email | Staff choose |
| Order updates | Off if either record turned them off |
| Offers | On if either record agreed |

Each merge is saved in `customer_merges` with both records as they were. There's no undo button. A device still using the old record has its new sales moved to the kept record, and its payments are refused until it refreshes. Automatic linking can be added once SMS codes can verify phone numbers.

## Customer messages

Customers choose in their website profile, and staff can record the choice on the customer's form. Order updates and reminders are on by default. Offers need the customer's agreement. The Communication Center asks what kind of message is being sent and skips anyone who hasn't agreed. The SMS, WhatsApp and email functions check again.

## Known limits

- Any member can read colleagues' names and contact details from `employees`, because the app needs them for assigning and display.
- Owners and Admins bypass permission checks by design.
