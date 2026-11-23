# Phase 8: Performance and growth capacity

Date: 2026-11-23. Status: **measured, three bottlenecks fixed in code, migration `20261201005` and the app changes not live yet** ([TO_FINISH.md](../TO_FINISH.md) → Phase 8).

Checklist: [Phase 8](../ISMS_Production_Readiness_Master_Checklist.md#phase-8-----performance-and-growth-capacity). Findings: [threat-register.md](../security/threat-register.md) (PERF-01 to PERF-08).

The numbers below come from two places:

- **Live** (read-only, `pg_stat_statements` since 2026-11-05): one business, 45 sales, 37 MB. It shows which requests are frequent and slow, not how the system behaves under load.
- **A local copy built from the migrations** (`perf_test`, CLI Postgres 17 on a 4-core laptop that was also running other databases). One busy branch with **50,000 sales (150,000 lines), 2,000 products, 2,000 customers, 30,000 stock movements**, plus 9 smaller businesses (140,000 sales in all). Treat absolute numbers as indicative. Before/after comparisons on the same machine are reliable.

## 1. Baseline

### Live, most expensive requests (2026-11-05 to 11-23)

| Request | Calls | Average | Worst |
|---|---|---|---|
| Role permissions for a business (every screen) | 3,967 | 63 ms | 1.4 s |
| Session check (every API request) | 56,816 | 2.5 ms | 0.14 s |
| Sales list with lines and products | 30 | **1,026 ms** | 5.8 s |
| Same, paged (`fetchTransactions`) | 40 | 653 ms | 2.0 s |
| Stock history | 54 | 316 ms | 2.4 s |
| Notifications | 1,137 | 15 ms | 1.3 s |

A sales list taking a second for 45 sales was the first sign: the cost is in row security, not in the data. Error rate: the API logs show no 5xx pattern; Phase 5's watchdog and health check now alert on errors.

### Local copy, the busiest reads (median of 3, ms)

| Query | Before: owner / cashier | After: owner / cashier |
|---|---|---|
| Sales list with lines and products (1,000 sales) | 427 / **1,682** | 348 / 604–725 |
| Last 50 sales with lines | 19 / 75 | 14 / 28–35 |
| Products (till) | 87 / 218 | 34–47 / 34–41 |
| Customers | 87 / 99 | 45–55 / 48–65 |
| Stock history | 55 / 98 | 40–49 / 39–43 |
| Notifications (100 newest) | 389 / 451 | 130 / 207–240 |

Repeat: `bash scripts/perf/queries.sh` (section 6).

## 2. Load test

`bash scripts/perf/load-test.sh`. Tills work as fast as they can, so 10 clients is far more load than 10 cashiers (a real till makes a sale every 30 s or so). **mix** = 6 till sales (`record_till_sale`, 3 lines, stock + books) : 3 cashier reads : 1 M-Pesa till callback (`record_till_payment`). **hot** = every sale sells the same 5 products.

| Test | Clients | Before: per s | Before: sale / read / callback ms | After: per s | After: sale / read / callback ms |
|---|---|---|---|---|---|
| mix | 1 | 13.9 | 60 / 118 / 43 | **30.5** | 30 / 42 / 19 |
| mix | 10 | 19.3 | 727 / 237 / 61 | **41.2** | 365 / 59 / 25 |
| mix | 25 | 27.7 | 1,319 / 300 / 26 | **47.9** | 814 / 66 / 20 |
| mix | 50 | 24.1 | 3,169 / 450 / 48 | 38.9 | 2,024 / 179 / 74 |
| hot | 1 / 10 / 25 / 50 | 36 / 29 / 32 / 28 | | 33 / 35 / 33 / 27 | 31 / 283 / 766 / 1,844 |

Every run: **0 failed transactions**, every sale's lines add up to its total, stock went down by exactly the units sold (6,417 of 6,417), every books entry balanced, every till payment recorded.

**Sales in one branch queue behind each other, by design.** Every cash sale moves the branch's Cash balance (`money_assets`, money rule 2), and that row stays locked until the sale commits. One branch therefore tops out at about 20–30 sales per second, whatever the number of tills. That is about 100 times what a busy 10-till shop needs (one sale every few seconds), so it is not a limit in practice. **Different businesses don't queue:** sales spread over 9 businesses reached **96 per second** at 25 clients (`cross` test, section 6). That figure was limited by this laptop's 4 cores.

A sale costs about 2.2 KB of database space (sale, lines, stock history, books, payment ledger, indexes). Its database time grows with its lines: about 100 ms for 1 line and 180–280 ms for 60, including the books posting at commit.

## 3. What was slow and what changed

| # | Finding | Change | Effect |
|---|---|---|---|
| PERF-01 | Row security asked `has_permission()`, `fn_can_see_notification()` and `get_user_business_ids()` again for every row, at 2–4 lookups each (188 policies use `has_permission`) | Migration `20261201005_permission_cache.sql`: each answer is kept for the rest of the request (`set_config(..., true)`). The 57 policies that test `business_id = ANY(get_user_business_ids())` now ask once per query (`(SELECT ...)`). Plus an index for the notification list | Reads 2–4× faster (tables above); load test throughput doubled |
| PERF-02 | **The app downloaded every sale with its lines and products (up to 50,000 sales, about 160 MB for a busy branch) at start, on refresh and after offline sales, then threw it away** (`fetchTransactions` → an empty `setAll`). App.tsx did the same with every product and every customer | Removed. Refresh now reloads the lists the screens show | One busy branch: from about 160 MB per start to 3.2 MB (the 1,000 newest sales) |
| PERF-03 | **Every product change made every open device download every product again.** Every sale changes stock, so 10 tills meant about one full reload per second on every device (1.26 MB for 2,000 products) | The change already carries the row: it is merged into the list in place (`liveList`). The full list is read only at start and on refresh | Per sale: from (devices × whole product list) to nothing extra |
| PERF-04 | **Products and customers stopped at 1,000 rows** (the API's cap): a shop with 1,500 products saw only the first 1,000 by name at the till and in stock. A credit sale read *every* customer to find one wallet balance, and missed anyone past the 1,000th (wallet not applied) | `allPages()` reads every page; the credit sale reads just its customer | Correct at any size |
| PERF-05 | The scheduler's run log (`cron.job_run_details`) grows by about 2,800 rows a day (about 180 MB a year) and was never cleaned | Daily `prune-cron-history`, keeps 7 days (the watchdog reads 1 day) | Flat |

How the cache stays correct (PERF-01): the key includes the signed-in user. Any write to memberships, users or permissions in the same transaction bumps a counter that is part of every key, so creating a business, accepting an invite or editing Roles is seen at once. PostgREST runs each API request in its own transaction, so nothing outlives one request. A removed member loses access on their next request, as before. Three new checks in `permissions_test.sh` cover this (a new grant counts in the same request, a suspended member loses access in the same request, and nothing is kept for the next). The cache lives in session settings that API clients can't write: PostgREST exposes only the `public` schema, and no public function sets a setting named by its caller.

## 4. Checklist review

| Item | Result |
|---|---|
| Response-time and error baselines | Section 1. The live API has too little traffic for a load baseline; the local copy is the load baseline |
| Slow queries, missing indexes | All hot queries use indexes. The time was row security (PERF-01). Added `idx_notifications_business_created` |
| Pagination, large reads | PERF-02 and PERF-04 fixed. Sales screens show the newest 1,000 (now explicit); older sales are in Sales log search and reports. Home charts compute from those 1,000 (see PERF-06). Expenses, stock movements and payments lists also show the newest 1,000 (newest first) |
| N+1 and realtime | PERF-03 fixed. A sale's own change refetches only that sale (already so). About 25 live subscriptions per open app share one connection. `users` is followed without a filter (rare writes; left as is, PERF-08) |
| Connection pooling | Edge functions use the HTTP API only (no direct Postgres connections). Live: 14 of 60 connections in use. Supavisor runs in transaction mode |
| Large tables, retention | Sales, lines, books and stock history are kept (tax law: at least 5 years). Cleaned: security events 30 days, rate limits 2 days, phone tokens 60 days, scheduler log 7 days (new). Not cleaned: notifications, audit log (admins delete by hand) |
| Bundle and assets | One 3.4 MB script (956 KB compressed) holds every screen; 26 MB background-remover engine loads only when used. `/assets/*` is cached for a year (immutable). Desktop and Android apps carry the files, so only the web app's first visit pays (PERF-07) |
| Caching | Static files: cached at Cloudflare and in the browser. API answers are private per user and are not cached anywhere; that stays so. The public website catalog could be cached at the edge if it gets busy (no need yet) |
| Queues and background work | Offline sales outbox (device), pg_cron jobs (watchdog, reminders, referrals, backups), pg_net for push and alerts, KRA signing retried on reconnect. Payment callbacks are idempotent (`ON CONFLICT (trans_id)`). No need for a separate queue at this size |
| Load tests in isolation | `scripts/perf/` against a local copy; never live |
| Concurrent logins, sales, stock, callbacks | Sales, stock, books and callbacks: section 2. **Logins not load-tested:** the local copy has no Auth server. Each request's session check is cheap (2.5 ms average on live) |
| Throughput, latency, errors, resources | Section 2; CPU-bound on 4 cores |
| Scale only on evidence | Section 5 |

## 5. Growth plan (planning scenarios, not capacity claims)

Assumptions per business: 3 devices open 12 h a day, 100 sales a day (busy hour = 3× average), 2.2 KB per sale, about 0.06 background requests per second per open device. "Peak requests" counts API calls in the busy hour.

| Businesses | Peak API requests/s | Live connections | New sales data per year | What to do, and when |
|---|---|---|---|---|
| 10 | ~2 | 30 | ~0.8 GB | Current setup. **Move to a paid Supabase plan before the database nears 500 MB** (free plan limit; at 10 busy shops that is about 6 months). Turn on the backups (SEC-02) |
| 100 | ~20 | 300 | ~8 GB | Paid plan, Small–Medium compute. Check the plan's Realtime connection quota (300 open apps). Server-side summaries for Home charts (PERF-06). Watch `pg_stat_statements` monthly |
| 1,000 | ~200 | 3,000 | ~80 GB | Larger compute and disk. Realtime: raise the quota or move busy lists from row changes to Broadcast. Partition or archive sales, lines and books by year. Read replica for reports. Split the web bundle (PERF-07) |
| 10,000 | ~2,000 | 30,000 | ~800 GB | One database is the risk. Split into several projects ("cells"), each holding a group of businesses, with a small directory that says which cell a business lives in. Reports in a separate warehouse |
| 100,000 | ~20,000 | 300,000 | ~8 TB | Cells by region, automated provisioning and migrations per cell, Realtime replaced or self-hosted |

What decides each step is measured, not guessed. Run `queries.sh` and `load-test.sh` on a copy of the real data (or the seed at the real size) and act when a number crosses a limit: an average read over 300 ms, a till sale over 1 s at the expected peak, connections or Realtime above 70% of the plan, or the database above 70% of its disk.

## 6. How to repeat

```bash
C=supabase_db_isms-seedtest bash supabase/tests/promotions/rebuild.sh   # promo_test from the migrations
docker exec -i $C psql -U supabase_admin -d postgres -c "DROP DATABASE IF EXISTS perf_test WITH (FORCE)" -c "CREATE DATABASE perf_test TEMPLATE promo_test"
docker exec -i $C psql -U supabase_admin -d perf_test < scripts/perf/seed.sql     # ~1 min; -v sales=100000 for more
docker exec -i $C psql -U supabase_admin -d postgres -c "CREATE DATABASE perf_tpl TEMPLATE perf_test"
bash scripts/perf/queries.sh                         # busiest reads, as owner and cashier
bash scripts/perf/load-test.sh                       # fresh perf_test from perf_tpl each time
MIGRATION=supabase/migrations/<file>.sql bash scripts/perf/load-test.sh   # compare a change
```

Since migration `20261201005` is in the folder, a rebuilt `perf_tpl` already includes it. To compare against the old functions, build the template from the commit before it.

## 7. Findings

| ID | Sev | Finding | Status |
|---|---|---|---|
| PERF-01 | P2 | Row-security functions evaluated per row | Fixed in code (migration 20261201005), not live |
| PERF-02 | P2 | Full sales/products/customers downloads thrown away | Fixed in code (app), not released |
| PERF-03 | P2 | Every product change reloads every product on every device | Fixed in code (app), not released |
| PERF-04 | P2 | Products, customers and credit-sale wallet lookup cut off at 1,000 rows | Fixed in code (app), not released |
| PERF-05 | P3 | Scheduler log never cleaned | Fixed in code (migration 20261201005), not live |
| PERF-06 | P3 | Home and charts compute from the newest 1,000 sales in the app; a busy branch's month is more than that | Open: move totals to server-side summaries before ~100 businesses |
| PERF-07 | P3 | Web app is one 3.4 MB script | Open: split by screen before the web app is the main channel |
| PERF-08 | P3 | ~25 live subscriptions per open app; `users` followed without a filter | Open: watch Realtime quota; revisit at 100 businesses |
