# Promotions & Referrals

Updated 2026-11-17. Promotion codes for the till and the website, and a two-sided customer referral programme, in one screen: **Promotions & Referrals** (sidebar, Selling group; `G` then `%`).

Migrations: `20261126001_promotions.sql`, `20261126002_referrals.sql`, `20261126003_promotion_referral_books.sql` (in that order; none is on the live database yet).

---

## 1. What it is for

| Goal | How |
|---|---|
| Attract new customers | First-purchase codes; the referral programme |
| Bring customers back | Codes for chosen customers; referral reward codes for the next visit |
| Sell more of chosen products, clear slow movers | Codes that cover chosen products or categories; Buy X get Y; free product |
| Reward loyal customers | Codes for chosen customers; referral rewards (wallet, points, discount, free product) |
| Time-limited campaigns | Start and end date/time on every promotion and programme |
| Know what it cost and what worked | Overview (promotions) and Referrals dashboards; separate lines in the books |

## 2. Promotion types

Staff pick a type; the type only presets fields. Underneath, every promotion is the same generic record, so no campaign has code of its own.

| Type | What the customer gets | Generic fields it sets |
|---|---|---|
| Percentage off | e.g. MILK10: 10% off | kind `percent`, value 10 |
| Amount off | e.g. SAVE100: KSh 100 off | kind `amount`, value 100 |
| Spend and save | Spend KSh 1,000, get KSh 100 (or %) off | `percent`/`amount` + minimum purchase (required) |
| Buy X, get Y free | Buy 2 × 1 L, get 1 × 500 ml free | kind `free_items`, buy qty, free product + qty, products covered = what must be bought |
| Free product | A free item once the conditions are met | kind `free_items`, free product + qty, usually a minimum |
| For chosen customers | Only the customers picked can use it | audience `selected` + customer list |
| First purchase | For a customer who has never bought | audience `first_purchase` |
| Referral | See section 6 | lives in the Referrals tab, not here |

Every promotion also has: name, code (typed or generated, 3–24 letters/digits/dashes, **unique per branch and case-insensitive**: `milk10`, ` MILK 10 ` and `MILK10` are the same), description, start/end, minimum purchase, most-off cap (percent types), total uses, once per customer, can/can't combine with other discounts, products or categories covered, works at the till and/or online, shown on the website, sister branches where it also works, active/off/archived.

**Online shop limits.** The website works codes out on the order subtotal only, so a code can be used online only if it is a percentage or amount, for anyone, on all products. The editor greys the switch out otherwise and the database refuses it.

**Statuses** (worked out, not stored): Active, Scheduled (start in the future), Ended (past the end), Used up (limit reached), Off (switched off), Archived (kept for the record; the code no longer works).

## 3. How the discount is worked out

All in the database function `fn_promo_evaluate`. The app never calculates a discount itself; it shows what the server returns.

1. Each cart line's **net** = unit price × quantity × (1 − line discount %), as it will be sold.
2. **Covered lines** = all lines, or those of the chosen products/categories. **Eligible amount** = sum of covered lines' net.
3. Checks, in this order, each with its own message to the cashier: code exists → not archived → switched on → works at the till → started → not ended → on at this branch → uses left → customer chosen when needed → customer allowed (chosen list, never bought for first-purchase, not used before for once-per-customer) → cart has items → something in the cart is covered → can combine (no item %, cart discount or points unless allowed) → eligible amount ≥ minimum.
4. What it gives:
   * percent: eligible × % (rounded to the cent)
   * amount: the amount, never more than the eligible amount
   * free items: the free product must be in the cart (the till says "Add 1 Milk 500 ml: it's free with this code"). Buy X get Y: every *X* covered units earn *Y* free; when the free product is itself covered, a set is *X + Y* of them. Discount = free units × that line's net unit price.
5. Most-off cap applies; the discount is never more than the cart.
6. The discount is shared over the lines it came from (kept for the per-product report).

Example: cart 2 × Milk 1 L @ 100 + 1 × Bread @ 50 (subtotal 250); MILK10 = 10% on category Milk → eligible 200 → **discount 20 → pay 230** (plus VAT/delivery if any).

## 4. At the till (POS)

* The **Promotion or referral code** box sits above the totals in the cart (cashiers need `pos.apply_promotion`; on by default for Cashier and Manager).
* **Apply** asks the server (`promo_check`). Valid: a green line with the code, what it gives and any note ("Capped at…", "Add 1 more: also free"). Not valid: the reason in red, and a hint where useful ("Add KSh 150 more").
* The summary shows **Subtotal**, **Discount** (item % and cart discount), **Promotion CODE −KSh x** (or **Referral CODE**), points, VAT, delivery and **Final Total**.
* Change the cart, customer or other discounts and the code is checked again within a moment. If it stops being valid the discount drops out and the reason shows; **Complete sale** is refused until the code is removed or the cart fixed.
* **×** removes the code. Only one code per sale.
* Codes need the internet; the box is disabled offline and a sale with a code is never queued offline.
* On the receipt the code has its own line: `Code MILK10  -20.00`.

What happens on **Complete sale**:

1. `promo_reserve` locks the promotion, checks everything again, and holds one use for 20 minutes. It returns the discount; if it differs from what was shown, nothing is charged and the cashier is told the new figure.
2. The sale is saved **with the hold's id** in one database transaction: `record_till_sale` for paid sales, `process_customer_transaction` for credit sales. Header and items go together.
3. When that transaction commits, a database check (`trg_sale_promotion_commit`) works the promotion out again **from the items actually saved**. If the rules no longer pass, or the discount isn't the held one, the **whole sale is refused**. Otherwise the use becomes *redeemed*, linked to the sale, customer, cashier and branch.
4. If the sale fails, the hold is given back at once (`promo_release`); if the app dies, it times out after 20 minutes.

## 5. Uses, cancellations and refunds

`promotion_redemptions` holds every use (till and online): promotion, code, sale or online order, customer, cashier, branch, discount, cart subtotal, what the sale came to, per-line discount, status and times.

| Status | Meaning | Counts as a use? |
|---|---|---|
| reserved | held at a till, sale not saved yet (20 min) | yes, until it times out |
| redeemed | sale saved | yes |
| partially_refunded | part of the sale refunded | yes |
| refunded | whole sale refunded | **no** (the use is freed) |
| cancelled | sale cancelled (deleted) or online order cancelled | **no** |
| released / expired | sale never happened | **no** |

Limits (total uses, once per customer) are checked under a lock **every time a use is written**, by the till, the website or a finished hold, so two tills can't both take the last use. Tested with six tills at once on a one-use code: exactly one got it.

A sale's promotion can't be changed after the sale; refund it and sell again.

## 6. Referral programme

Two-sided: when a new customer makes a first qualifying purchase with an existing customer's code, **both** get a reward.

### Codes

* One code per customer, made from the first name plus three digits (e.g. `DENNIS482`) the first time it is needed while a programme runs. It is shown on the customer's **Loyalty** page (with WhatsApp, SMS and Copy buttons) and on their **website account → Rewards → Invite friends**.
* A code can be shared with any number of people and used by many new customers. Each new customer can be referred only once.
* Promotion codes and referral codes share the till's box; neither can take the other's code.
* Managers can **hold** a code (no new referrals, no rewards paid until it works again) or **revoke** it for good, always with a reason.

### Rewards (set separately for each side)

| Reward | Referrer gets it… | New customer gets it… |
|---|---|---|
| Amount off / percentage off | as a personal one-use code for their next visit (`RW…`) | off the first sale itself |
| Free product | as a personal one-use code | on the first sale (the item must be in the cart) |
| Wallet credit | added to their wallet when rewards are given | added after the first sale, when rewards are given |
| Loyalty points | added when rewards are given | added when rewards are given |

Reward codes can expire (`reward expiry days`). Points rewards need points switched on.

### Programme settings

Name, start/end, the two rewards, **first purchase at least** (KSh), what the first purchase must include (anything / products / categories), sister branches where codes work, combine with other discounts, **wait before rewards** (days, default 3, guards against buy-then-refund), referrals per referrer, referrals in total, rewards per customer ever, "new" means added within N days, new customer needs a phone number, a manager checks flagged referrals. One programme runs per branch; starting a new one ends the running one.

### Lifecycle

```
code typed at the till ──► PENDING (hold on the sale, 20 min)
        │ sale saved                    │ sale not finished
        ▼                               ▼
    QUALIFIED ──── wait over, not flagged ──► REWARDED
        │   (or a manager approves)            │
        │ manager refuses ──► REJECTED          │ first sale refunded / cancelled
        │ sale refunded / cancelled             ▼
        ▼                               CANCELLED (rewards taken back)
    CANCELLED                     EXPIRED (hold timed out)
```

* Rewards are given by `fn_referral_issue`, once per side (unique per referral and side: running it twice gives nothing extra). A job every 10 minutes (`run_referral_jobs`) pays referrals whose wait is over, expires old holds and expires unused reward codes.
* **Taking back** after a refund or cancellation: unused reward codes are switched off; wallet credit and points are taken back as far as the customer hasn't spent them; the referral is marked `refunded_after_reward`. A partial refund only cancels the referral if what is left is below the minimum.

### Fraud rules

Refused at the till (with the reason):

* using your own code; the new customer having the same phone (in any format: 07…, 7…, +254…) or email as the referrer
* the new customer's phone or email belonging to any other customer (a second record of a known person)
* a customer who has bought before; one added more than *N* days ago (when "only customers added recently" is on)
* no phone number (when required); a customer already referred
* over the per-referrer or total limits; a held or revoked code; no programme running

Flagged for a manager (rewards wait when "a manager checks flagged referrals" is on): many referrals by the same referrer in a day, the same cashier again for the same referrer, a first purchase just over the minimum, the customer added at the till minutes before, a phone close to the referrer's, and (after the fact) refunded after reward.

What this can't catch: there is no SMS verification yet, so a cashier who invents a new customer with a real but unrelated phone number and pays for a purchase can still create a referral. The wait, the flags, the per-referrer limit, the cashier's name on every referral and the manager review are the controls until SMS one-time codes exist.

## 7. Dashboards

**Overview** (promotions; `promotions.view`), for 7/30/90 days or this month:

* Times used, customers, **discounts given**, **gross** on those sales (before any discount), **net** (after all discounts, without VAT and delivery).
* Active, scheduled, ended/used up, all (off, archived).
* A note that these are *sales where a code was used, not extra sales caused by it*, with the average sale with a code vs. without one. Refunds are counted apart.
* Most used codes; best return on discount (net sales per KSh 1 off); by product (till sales); by day.

**Referrals** (`referrals.view`): the running programme in one line; referrals, waiting (and flagged), **rewards cost** (wallet + discounts), what referred customers have bought since; a **To check** list with Approve / Refuse; all referrals; top referrers with hold/revoke. Points given and unused reward codes are listed apart, because they cost money only when used.

## 8. Accounting

Everything posts automatically and survives **Rebuild the books**:

| Event | Debit | Credit |
|---|---|---|
| Till sale with a code (incl. referral welcome discount, reward codes) | Money / receivable as before; **4050 Promotion discounts** (the code's discount) | **4000 Sales** at the price before the code; VAT, delivery as before |
| Referral wallet credit | **6150 Referral rewards** | **2100 Customer wallet money** (the customer) |
| Wallet credit taken back after a refund | the entry is posted again for what it finally cost (or removed) | |
| Referral points | nothing when given (like all points); they cost money when spent at the till (a discount) or on debt (5300) | |
| Refund of a sale with a code | credit note as before, at the net prices the customer paid | |

Profit is unchanged by the split: sales go up by the discount and Promotion discounts (an income-type account with a debit balance, shown as a minus against sales) take it off again, so Profit or loss shows what promotions cost. Other discounts (item %, cart discount, points) stay inside Sales as before. Online-shop promo codes stay inside the online order's figures as before.

## 9. Permissions

| Permission | Owner / Admin | Manager | Cashier | Others |
|---|---|---|---|---|
| `pos.apply_promotion` type a code at the till | ✓ | ✓ | ✓ | – |
| `promotions.view` dashboard, list, uses | ✓ | ✓ | – | – |
| `promotions.manage` create, edit, switch on/off, archive | ✓ | ✓ | – | – |
| `referrals.view` referrals, top referrers, costs | ✓ | ✓ | – | – |
| `referrals.manage` programme, approve/refuse, hold/revoke codes | ✓ | ✓ | – | – |

Owners change any of these per branch in **Roles**, like every other permission. Customers' own codes are shown to staff with `customers.view`.

## 10. Database design

| Object | What it holds |
|---|---|
| `website_promo_codes` (existing, extended) | every promotion. New columns: name, promo_type, max_discount, audience, product_scope, buy_qty, reward_product_id, reward_qty, stackable, use_pos, use_online, origin (`manual` / `referral_welcome` / `referral_reward`), archived_at, updated_by. The name is kept because the online shop's functions use it. |
| `promotion_products`, `promotion_categories` | what a promotion covers |
| `promotion_customers` | who may use a `selected` promotion |
| `promotion_branches` | sister branches where it also works (same owner) |
| `promotion_redemptions` | every use, both channels, with status history |
| `transactions.promotion_redemption_id`, `promotion_code`, `promotion_discount` | the sale's code; code and discount are stamped by the database from the hold |
| `referral_campaigns` | the programme and its rules; its first-purchase rules live in a hidden promotion (`welcome_promotion_id`) |
| `referral_codes` | one active code per customer; active / suspended / revoked with reason, who and when |
| `referrals` | referrer, new customer, code, programme, status, first sale, purchase amount, welcome discount, flags, cashier, dates |
| `referral_rewards` | each reward given (one per side): kind, value/points/product, reward code, status (issued / used / expired / revoked / reversed), what it cost, what was taken back, dates, who |
| `customer_ledger` types `referral_reward`, `referral_reversal`; `loyalty_points_earned.source = 'referral'` | where wallet credit and points from referrals show in the customer's history |

Money is `numeric(14,2)`. Foreign keys on every link; uses and referrals are never deleted (promotions are archived, not deleted). Row-level security: staff read with the permissions above; **nobody writes these tables directly** (only through the functions, which check permissions themselves).

Main functions: `promo_check`, `promo_reserve`, `promo_release`, `record_till_sale`, `save_promotion`, `set_promotion_status`, `promo_generate_code`, `promotions_list`, `promotion_redemptions_list`, `promotion_dashboard`, `save_referral_campaign`, `end_referral_campaign`, `decide_referral`, `set_referral_code_status`, `customer_referral`, `my_referral` (website), `referral_dashboard`. Internal: `fn_promo_evaluate`, `fn_referral_evaluate`, `fn_referral_issue`, `fn_referral_take_back`, `run_referral_jobs`, `acc_referral_lines`.

## 11. App files

| File | Part |
|---|---|
| `src/services/promotions.ts` | typed calls for everything above, the till helpers, labels |
| `src/features/PromotionsView.tsx` | the screen: Overview, Promotions (list, editor, detail with uses), Referrals (programme editor, review queue, top referrers) |
| `src/features/POSView.tsx`, `src/stores/cartStore.ts`, `src/services/supabaseService.ts` | the code box, hold → sale → release, saving a sale with a code |
| `src/components/loyalty/CustomerReferralCard.tsx` | a customer's code and sharing on their Loyalty page |
| `website/src/pages/ReferralPanel.tsx` | Invite friends in the website account |
| `src/services/receipt/*` | the code's line on receipts |
| Online Store | its old Promotions tab was removed: codes are managed in one place now |

## 12. Tests

**Database** (`supabase/tests/promotions/`, run against a Postgres built from the migrations, signing in as owner/manager/cashier/rider so row-level security applies). 98 promotion checks and 74 referral and accounting checks, all passing on 2026-11-17:

* valid code; invalid code; any case; expired; not started; switched off; archived; online-only at the till and till-only online
* limit reached; hold → release → free again; timed-out hold frees the use; **six tills at once on a one-use code: exactly one**
* minimum not met; product not covered; customer not chosen / no customer; first purchase by an old customer; once per customer
* can't combine with item % or cart discount
* percent, amount (never above the cart), cap, buy 2 get 1 (incl. "add one more"), free product
* sale with a code: saved, redemption linked, code and discount stamped, final total right; the same hold on a second sale refused; tampered cart refused **and the whole sale rolled back**; discount smaller than the code's refused; released hold refused; the app can't set the promotion discount itself; a sale's code can't be changed later
* credit sale with and without a code; sales without a code unchanged (both the RPC and the app's direct insert)
* cancelled sale frees the use; part refund keeps it; full refund frees it (through the real credit-note function)
* unauthorized: rider and cashier can't create promotions, see dashboards, or write the tables
* referrals: self-referral; same phone in another format; no phone; existing customer; duplicate of another customer; bought before; minimum; welcome discount; referrer wallet credit once; issuing twice gives nothing; ledger row; re-referral refused; refund after reward takes it back; wait period; cancel before reward; flagged → approve / refuse; hold a code; per-referrer and total limits (two tills at once); free-product reward code only for the referrer, once; website view shows friends by first name only and no phone numbers; dashboard costs
* books: Promotion discounts and Sales on a code sale, Referral rewards and wallet entries, reversal after refund, every entry balanced, no posting errors

**App** (`npm test`, all passing): roles in the app match the database defaults; every permission the new functions check exists in the app; cashiers can't find promotion management; the receipt names the code apart from other discounts and fits the paper; the referral share text. Typecheck and both production builds pass.

**Not tested yet:** the screens in a browser or on a phone, the website panel against a live account, and the 10-minute job under pg_cron on the real database.

## 13. Going live

1. Apply the three migrations in order (`supabase db push`), after a backup.
2. Release the app and website (the POS sends the new parameters only when a code is used, so older app versions keep working with the new database).
3. Owner: check **Roles** (Manager has promotion and referral management by default; switch off what you don't want).
4. Create a first promotion; try it at a till on a test sale; refund it and see the use freed.
5. Start a referral programme with a wait of a few days and manager review on; watch **Referrals → To check** the first weeks.
