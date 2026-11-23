# Phase 9: Multi-tenant and geographic expansion

Date: 2026-11-23. Status: **reviewed and documented; no code change needed today.** Every item below is a design note or an owner decision for when expansion starts. Nothing here is live work.

Checklist: [Phase 9](../ISMS_Production_Readiness_Master_Checklist.md#phase-9-----multi-tenant-and-geographic-expansion). Findings: [threat-register.md](../security/threat-register.md) (EXP-01 to EXP-07). Capacity numbers: [performance.md](performance.md).

This is not legal advice. The data protection points need confirming with a Kenyan data protection adviser before onboarding paying customers.

## 1. How tenants work today

| Part | Today | Verified by |
|---|---|---|
| Tenant | Each **branch is one `businesses` row**. Every business table has `business_id`; row security filters every read and write by it | `permissions_test.sh`, the as-role checks in every DB suite, `grants_check.sql` (all in CI since Phase 7) |
| Branches of one owner | No parent row. Branches belong together when they share an Owner membership (`fn_branches_share_owner`), which is what stock transfers and the branch switcher use | promotions and transfers tests |
| People | One login (`users`) can belong to many businesses (`business_memberships`), with **a role per business**: a cashier at one branch can be a manager at another. Suppliers use `supplier_accounts`, customers the website account; neither gets a membership | permissions tests (cashier in two branches, rider, admin) |
| Permissions | Role defaults (`role_default_permissions`) plus per-business overrides (`role_permissions`, the Roles screen). The app checks them, and the database enforces the same answer (`has_permission`) | `permissions_test.sh`; Phase 8 adds checks that a change counts within the same request |
| Per-business settings | Receipt, payment methods, M-Pesa/Airtel/Paystack keys, VAT/eTIMS, website, loyalty and promotions are all keyed by `business_id` | |
| Usage limits | Per user or per IP (Phase 6: OTP, email, AI, SMS, payments, USSD, promo guesses). **No per-business quota** (EXP-01) | Phase 6 tests |

**Isolation verdict:** sound for many businesses in one database. One gap stays open from Phase 1: there is no dedicated suite that builds two unrelated owners and proves neither can see the other's rows table by table (EXP-02). The grants check and the role tests cover it indirectly.

## 2. Ready for another country? Kenya is built in

| Area | Today | What expansion needs |
|---|---|---|
| Currency | `businesses.currency` exists (default `KES`) but nothing reads it. `formatMoney` prints `KSh` (about 300 call sites). Money is `numeric(14,2)`, which can hold any currency's amounts, UGX and TZS included (they are shown without decimals in practice) | Pass the business's currency into `formatMoney` / `formatCurrency` (one place: a hook that reads the active business), and a per-currency decimals rule for display. **One currency per business**: a business never mixes currencies, so no conversion is needed in the books (EXP-03) |
| Time zone | `businesses.timezone` exists (default `Africa/Nairobi`) but about 40 files hard-code Nairobi for "today", shift days, reports and cron jobs | Same time zone (UTC+3: Uganda, Tanzania) works as is. Rwanda, Burundi or Zambia (UTC+2) would put sales after 23:00 on the wrong day. Before that: one `businessToday()` helper on each side (app and SQL) reading the business's zone, and per-business cron times (EXP-04) |
| Date boundaries | Day, week (starts Monday) and month totals are cut in Nairobi time, in the app (`kenyaToday`, `src/test/kenyaTimezone.ts`) and in SQL (`AT TIME ZONE 'Africa/Nairobi'`) | Covered by unit tests for Kenya; extend the same tests per zone |
| Phone numbers | `normalizePhone` defaults to +254, and `fn_phone_key` (duplicate-customer matching) knows only Kenyan formats | Country code from the business; `fn_phone_key` per country (EXP-05) |
| Payments | M-Pesa (Safaricom Daraja, Kenya), Airtel Money (Kenya), Paystack cards | Each country needs its own provider setup. Airtel and Paystack exist elsewhere; M-Pesa Tanzania (Vodacom) is a different API |
| Tax | VAT only with KRA eTIMS connected (Kenya). Other countries' e-invoicing (URA EFRIS, TRA VFD) differ | A per-country tax adapter behind the same "VAT allowed" switch |
| Language | English only | Swahili first, if the market asks |

## 3. Data protection and residency

| Question | Today | Note |
|---|---|---|
| Which law | Kenya Data Protection Act, 2019. The website privacy policy cites it and names the ODPC for complaints | Each new country brings its own law (e.g. Uganda DPPA 2019, Tanzania PDPA 2022) |
| Registration | The business that runs ISMS (as processor for each shop, and controller for its own customers) likely has to register with the ODPC; each shop using ISMS is a controller of its customers' data | **You:** confirm with an adviser and register if required (EXP-06) |
| Where the data lives | Database, sign-in and files: Supabase **eu-west-3 (Paris)**. Web hosting and backups: Cloudflare (edge; backups in R2). Alerts: Telegram. AI: Hugging Face and other model providers for staff questions | The privacy policy names Supabase but **doesn't say the data is stored outside Kenya** and doesn't list Cloudflare or the AI providers used by the staff assistant. A transfer outside Kenya is allowed with appropriate safeguards and must be disclosed. Update the policy (EXP-06) |
| Must it stay in Kenya? | No local-only rule is known to apply to retail sales and customer records. Kenyan rules reserve local processing for some public-interest data | Get this confirmed in writing before relying on it. If a market requires local storage, that market gets its own project in an allowed region (section 5) |
| Retention | Sales, payments and books: at least 5 years (tax law; stated in the privacy policy). Logs: security events 30 days, rate limits 2 days, scheduler 7 days, phone tokens 60 days. Notifications and the audit log: kept until an admin deletes them | Add a fixed period for notifications (for example 1 year) and for the audit log (for example 2 years) once the owner decides (EXP-07) |
| Deletion requests | The policy promises deletion of what tax law doesn't require. Today a request means manual work: there's no tool that removes a customer's personal details while keeping their sales for tax | An "erase customer" action: blank the name, phone, email and delivery details, keep the sales with "Erased customer", and log it in the audit trail (EXP-07) |
| Closing a business | Soft delete of the business row. No export-then-erase process | Same tool at business level: export the books, then erase personal data after the retention period |

## 4. Regional hosting and disaster recovery

- **Today:** one Supabase project in Paris, Cloudflare in front of the web app and the website. Kenyan users reach Paris in about 150 ms per round trip (a typical figure, not measured here). The app already avoids chatty screens (the Phase 8 fixes), so that is acceptable.
- **Recovery:** Phase 3 (deferred, SEC-02) plans hourly encrypted backups to Cloudflare R2 plus a weekly restore drill. Until it is turned on, the only copy is Supabase's own backup for the plan. A region-wide outage at the provider would stop sales except offline cash sales (outbox), which sync later.
- **Next step for DR:** once backups run, restore one to a project in another region once, and time it. That number is the real RTO for "Paris is down".

## 5. When to split databases, regions or services

Split only when one of these becomes true, not before. One database is simpler, cheaper and easier to keep correct.

| Trigger | Do |
|---|---|
| A market's law requires local storage, or a large customer demands it in a contract | A separate Supabase project in that region for that market (same migrations, same CI, deployed by `db-push.sh` per project) and a directory that sends each business to its project |
| Any of the Phase 8 limits stays above 70% after scaling up compute: average read over 300 ms, till sale over 1 s at peak, connections or Realtime over 70% of the plan, disk over 70% | First tune (Phase 8 method), then larger compute, then a read replica for reports. Split into cells (groups of businesses per project) at about 10,000 businesses (performance.md section 5) |
| Reports slow down the tills | Read replica or a separate reporting store, fed from the books |
| One business's load hurts others (EXP-01) | Per-business quotas first; a dedicated project for that business if it is big enough to pay for it |
| Payments or AI providers differ by country | Separate edge functions per provider (already the pattern), not separate databases |

Each split multiplies migrations, backups, monitoring and secrets. The tools from Phases 5–7 work on one project at a time: `db-push.sh` on whichever project the CLI is linked to, the DB checks in CI on a fresh database, and the watchdog inside each database. The missing piece is a script that runs them for every project in turn.

## 6. Findings

| ID | Sev | Finding | Status |
|---|---|---|---|
| EXP-01 | P3 | No per-business usage quota (AI questions, SMS, emails, API calls); limits are per user or IP, so one business can use the shared AI and SMS budget | Open: add per-business daily caps before opening sign-ups to the public |
| EXP-02 | P3 | No dedicated two-tenant isolation suite (two unrelated owners, every table) | Open (from Phase 1) |
| EXP-03 | P3 | `businesses.currency` is stored but not used; every amount prints KSh | Open: needed before the first non-Kenyan business |
| EXP-04 | P3 | Business days are cut in Nairobi time everywhere; `businesses.timezone` is unused | Open: needed before a business outside UTC+3 |
| EXP-05 | P3 | Phone handling assumes Kenya (+254) | Open: needed before another country |
| EXP-06 | P2 | Privacy policy doesn't disclose storage outside Kenya (EU) or every processor (Cloudflare, AI providers); ODPC registration not confirmed | **You:** adviser review, then update the website privacy page and register if required |
| EXP-07 | P3 | No retention period for notifications and the audit log; no "erase customer" tool for deletion requests | Open: owner to choose periods; build the erase action before the first deletion request |
