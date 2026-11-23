# Cost management

Phase 10 of the [production readiness plan](../ISMS_Production_Readiness_Master_Checklist.md#phase-10-----cost-operations-and-final-readiness), 2026-11-23. Status of the whole effort: [production-readiness.md](../production-readiness.md).

## Contents

1. [What ISMS costs today](#1-what-isms-costs-today)
2. [Who pays for what](#2-who-pays-for-what)
3. [Cost per business and per user](#3-cost-per-business-and-per-user)
4. [Cost at each growth stage](#4-cost-at-each-growth-stage)
5. [Budget and usage alerts](#5-budget-and-usage-alerts)
6. [Waste found and fixed](#6-waste-found-and-fixed)
7. [Cost levers to watch](#7-cost-levers-to-watch)
8. [How to refresh these numbers](#8-how-to-refresh-these-numbers)

**How sure each number is.** *Measured* = read from the live database or the providers' CLIs on 2026-11-23. *Owner to confirm* = only the billing pages show it, and this machine can't read them. *List price* = the provider's public price as known in November 2026: check the pricing page before budgeting with it. *Estimate* = worked out from the stated assumptions; it is not a quote.

## 1. What ISMS costs today

Live usage (measured, 2026-11-23): 2 businesses, 3 users, 45 sales; database 37 MB; stored files 3.4 MB (89 files); 14 of 60 database connections in use; 11 scheduled jobs.

| Provider | What ISMS uses | Plan | Monthly cost | Source |
|---|---|---|---|---|
| Supabase | Database, Auth, Storage, Realtime, 25 edge functions | **Free, almost certainly**: the organisation has exactly two active projects (`kaykays`, `FluencyTalks`), the Free limit. **Owner to confirm** in Dashboard → Organization → Billing | $0 | Measured / owner to confirm |
| Cloudflare | Workers static assets (`kaykays-app`, `kaykays-website`); R2 planned for backups | Free (Workers static-asset requests are free and unlimited); R2 not enabled yet | $0 | Measured (wrangler) |
| GitHub | Code, Actions (builds, releases, hourly backup job), releases for app updates | Free, public repository: Actions minutes unlimited | $0 | Measured |
| Email | Sign-in codes, invitations, customer email (`auth-otp`, `send-email`) | Gmail SMTP (`smtp.gmail.com`) on a personal account | $0 | Measured (`.env`) |
| Firebase (FCM) | Push notifications and alarms | Spark (free); FCM itself has no charge | $0 | List price |
| Hugging Face | AI assistant and advisors (`HF_TOKEN_A/B`) | Free credits (about $0.10 a month of inference) | $0 | Earlier measurement |
| Telegram | Ops alerts bot | Free | $0 | — |
| Unsplash | Picture search in the uploader | Free (demo limit 50 requests an hour) | $0 | — |
| Domain `kaykays.com` | Website domain, at DreamHost | Yearly registration | **Owner to confirm** | Owner |
| Google Play / Apple | Not used: Android installs from GitHub releases; no iOS app | — | $0 | — |

**Total today: $0 a month plus the domain.** That is cheap, but it is not a production setup: the Free plan has no restorable backups and pauses a project after a week without traffic ([BACKUP_AND_RECOVERY.md](../BACKUP_AND_RECOVERY.md) → L1, SEC-02).

**Minimum production setup, before the first paying business** (list prices): Supabase Pro **$25/month** (daily backups kept 7 days, no pausing, 8 GB database, 100 GB files, 250 GB egress, $10 compute credit that covers the Micro size). R2 for the hourly backups stays within its free 10 GB ([BACKUP_AND_RECOVERY.md](../BACKUP_AND_RECOVERY.md) section 4.1). Optional: Point-in-time recovery, about $100/month for 7 days, when losing up to a day of sales is not acceptable. **About $25–30 a month in all.**

## 2. Who pays for what

| Cost | Paid by | Why |
|---|---|---|
| Hosting, database, files, email, push, AI on the shared tokens | ISMS (platform) | Shared by every business |
| M-Pesa (Daraja), Airtel Money, Paystack card fees | Each business | Each business connects its own till / account (`*_payment_secrets` per business) |
| SMS and dial code (Africa's Talking), WhatsApp, Twilio | Each business | Each business enters its own keys; Meta and the SMS gateway bill them |
| KRA eTIMS | Each business | Their own eTIMS registration |
| AI on a business's own key (`ai-config`) | That business | Optional; otherwise the shared tokens are used |

So the platform's cost grows with the number of businesses and how busy they are, but message and payment fees never land on ISMS. The exception is email: every business's customer email goes out through the one platform mailbox (see OPS-04 below).

## 3. Cost per business and per user

Assumptions (the same as the [Phase 8 growth plan](../deployment/performance.md#5-growth-plan-planning-scenarios-not-capacity-claims)): 3 devices and 3 users per business, open 12 hours a day; 100 sales a day; about 2.2 KB of database per sale (80 MB a year per business); about 25 MB of files a year per business (logos, product pictures, expense receipts). Estimated per business per month:

| Item | Per business per month | How it is worked out |
|---|---|---|
| Database growth | ~7 MB | 3,000 sales × 2.2 KB |
| Files | ~2 MB | Measured 1.7 MB per business today, plus receipts |
| Realtime messages | ~70,000 | ~8 row changes per sale (sale, lines, stock, money balance) × 3 devices × 3,000 sales |
| Egress (data sent to devices) | ~1.5 GB | ~15 MB per device per day: start-up lists (newest 1,000 sales, products, customers), refreshes, pictures. **The least certain number here; check it on the Supabase usage page after a month of real use** |
| Edge function calls | ~1,500 | Pushes, AI questions, payment prompts and callbacks, email |
| Emails | ~30 | Sign-in codes, invitations, a few customer emails |

What that costs depends on the stage, because Supabase Pro includes a fixed amount of each before it bills extra: see the per-business row in section 4.

## 4. Cost at each growth stage

Planning scenarios, not quotes. Monthly, in US dollars, platform side only, at the list prices in section 1 plus Supabase's published overage rates (compute sizes Small $15 / Large $110 / 2XL $410 a month; extra disk $0.125/GB; extra egress $0.09/GB; Realtime $2.50 per million messages over 5 million and $10 per 1,000 peak connections over 500; edge functions $2 per million over 2 million). Compute sizes follow the Phase 8 growth plan.

| Businesses | Supabase plan and size | Main extras | Platform cost / month | Per business | Per active user |
|---|---|---|---|---|---|
| 10 | Pro, Micro | none (everything within Pro) | **~$25** | ~$2.50 | ~$0.85 |
| 100 | Pro, Small | Realtime ~7 M messages (+$5); email over the free tier of a sending service (+$20) | **~$55** | ~$0.55 | ~$0.20 |
| 1,000 | Pro, Large; PITR | Realtime 70 M messages (+$165) and 3,000 connections (+$25); egress 1.5 TB (+$115); disk 80 GB (+$9); PITR (+$100); email (+$35) | **~$560** (~$680 with a read replica for reports) | ~$0.55–0.70 | ~$0.20 |
| 10,000 | About ten projects of 1,000 ("cells", Phase 8) | As above per cell, plus a directory service and monitoring | **~$6,000–7,000** | ~$0.60–0.70 | ~$0.20 |
| 100,000 | Cells by region | Beyond list-price modelling: at this size prices are negotiated (Supabase Team/Enterprise), and Realtime may be self-hosted | Not modelled; list prices scale to ~$60,000+ | — | — |

What this says:

- **Below ~10 businesses, the cost per business is the Pro plan split few ways.** The first paying business carries $25 a month on its own; price the product with that in mind.
- **From 100 businesses on, about $0.55–0.70 per business per month**, and it stays there. Realtime messages and egress are most of it at 1,000, both driven by how much the app sends to every device after each sale. Cutting those (Broadcast instead of row changes, server-side summaries for Home: PERF-06, PERF-08) is the biggest saving available.
- **People cost more than providers.** A support or on-call person outweighs the provider bill at every stage up to 10,000 businesses.

## 5. Budget and usage alerts

| Where | Alert | State |
|---|---|---|
| Database watchdog (`run_ops_watchdog`, every 10 min, Telegram) | `db:size`: database over 80% of `db_size_limit_mb` (500 MB Free) | Live |
| Database watchdog | `storage:size`: stored files over 80% of `storage_limit_mb` (1 GB Free). **New** (migration `20261201007`) | Built and tested on a test DB, not on live |
| Database watchdog | `db:connections` over 80%; `edge:calls` failing | Live |
| Supabase | **Spend cap** (Pro plan setting, on by default): stops over-plan charges and limits the service instead. Usage emails at 80% / 100% of a quota | Owner, when moving to Pro. Keep the spend cap on until there is a budget for overage |
| Cloudflare | Billing → Notifications: usage-based billing alert (only matters if R2 or Workers paid features are used) | Owner, when R2 is enabled |
| GitHub | Billing → Spending limit $0 (the default) so Actions never charge | Owner to confirm; matters only if the repo goes private |
| Gmail | No alert. Sending stops at Gmail's daily limit (about 500 messages for a personal account) and sign-in codes fail | OPS-04 |

After moving to Pro, change the watchdog's limits in the SQL editor:

```sql
UPDATE ops_watchdog_config SET db_size_limit_mb = 8192, storage_limit_mb = 102400;
```

## 6. Waste found and fixed

Measured on live with `pg_stat_statements` (2026-11-05 to 11-23, 18 days):

| # | Finding | Evidence | Change |
|---|---|---|---|
| OPS-01 | **Payments balances never updated live.** The app follows `money_assets` (the Payments screen balances), but the table was never in the live-update list, so a sale on one till didn't move the balance on another until a refresh (money rule 2) | `pg_publication_tables` on live: 52 tables, no `money_assets` | Migration `20261201006` adds it |
| OPS-02 | **Realtime decoded changes nobody follows.** Realtime's change polling (`realtime.list_changes`) was ~80% of all database time: 1,000,109 calls, 10,551 s of 13,200 s. 27 of the 52 published tables are followed by no screen in the app or website (checked against the code and release v7.5.5). Also, the app opened three unfiltered subscriptions (products, sales, customers for every business the user can see) and ignored their events | Query above; `src/services/realtimeService.ts` | Migration `20261201006` drops the 27 tables; the three no-op subscriptions are removed. Each sale now creates fewer change events to decode and check, and each open app holds three fewer channels |
| PERF-05 | Scheduler log grows ~2,800 rows a day | 19,520 rows on live | Fixed in Phase 8 (`prune-cron-history`, 7 days) |
| PERF-02/03 | App downloaded whole tables and threw them away; product reloads on every sale | Phase 8 | Fixed in Phase 8, not released |

Checked and fine: storage holds only logos, avatars and product pictures (3.4 MB, no orphans worth cleaning yet); the biggest tables are Postgres's own catalog and the scheduler log; minute-by-minute jobs (`auto-clock-out`, reminders, alert escalation) cost about 20 s of database time a day; the backups would stay inside R2's free tier until a compressed dump passes ~70 MB; there are no unused paid add-ons.

## 7. Cost levers to watch

| Lever | When it matters | What to do |
|---|---|---|
| Realtime messages and connections | ~100 businesses | Broadcast from the database for busy lists instead of row changes (PERF-08) |
| Egress | ~100 businesses | Measure it first (Supabase → Usage). Then fewer full-list reloads; keep pictures small (the uploader already compresses) |
| Email volume | When bulk customer email is used, or at ~20 businesses | Move to a sending service on the kaykays.com domain (OPS-04) |
| AI | When businesses use the shared tokens heavily | Per-business usage cap (EXP-01) or ask heavy users to add their own key |
| GitHub Actions minutes | Only if the repository goes private | The hourly backup alone is ~720 runs a month against 2,000 free minutes. Move the backup to Supabase PITR or a Cloudflare cron, or buy minutes ([GOING_PRIVATE.md](../GOING_PRIVATE.md) section 6) |
| Supabase compute size | Phase 8 thresholds (reads over 300 ms, CPU) | Size up only on measurement |

## 8. How to refresh these numbers

Monthly, or before setting prices:

1. **You:** Supabase → Organization → Billing and Usage: plan, invoice, and each quota's usage (database, files, egress, Realtime messages and peak connections, edge calls). Write them in section 1.
2. **You:** Cloudflare → Billing, GitHub → Billing, the domain registrar: the same.
3. Database size and the busiest requests (read-only):

```bash
supabase db query --linked "select pg_size_pretty(pg_database_size(current_database())), (select count(*) from businesses), (select pg_size_pretty(sum((metadata->>'size')::bigint)) from storage.objects)"
supabase db query --linked "select calls, round(total_exec_time::numeric/1000) total_s, left(query, 80) from extensions.pg_stat_statements order by total_exec_time desc limit 10"
```

4. Divide the month's bill by active businesses and users and compare with section 4.
