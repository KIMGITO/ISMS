# Phase 5: Monitoring and alerting

Date: 2026-11-23. Status: **built and tested on a test database; not yet on live.** The outside uptime monitor needs the owner (an account with UptimeRobot or Better Stack).

How alerts reach Telegram and the setup steps: [DEPLOYMENT_AND_MONITORING.md](../DEPLOYMENT_AND_MONITORING.md). What to do when something breaks: [incident-response.md](incident-response.md).

## 1. Baseline (before this phase)

| What | Watched? |
|---|---|
| Releases, builds, web deploys, rollbacks | Yes, Telegram from GitHub Actions |
| Crashes, problem reports | Yes, `ops-alert` function |
| Hourly backup, restore drill | Built, but backup secrets are unset (Phase 3, deferred), so nothing runs |
| Site or database down | No. `GET ops-alert` health check existed, but no monitor called it |
| Scheduled jobs (11 pg_cron jobs) | No. A failing job was silent |
| Payments stuck waiting for Safaricom / Airtel / Paystack | No |
| Database size, connections | No |
| Edge functions the database calls (pushes, backups, crash alerts) | No |

## 2. What was built

**Database watchdog** (`20261201003_ops_watchdog.sql`). The pg_cron job `ops-watchdog` runs `run_ops_watchdog()` every 10 minutes. It checks:

| Check | Problem when |
|---|---|
| `cron:<job>` | the latest run of a scheduled job (last 24 h) failed |
| `payments:mpesa`, `payments:airtel`, `payments:card` | a payment from the last day is still waiting for the provider after 30 min (callback missing) |
| `edge:calls` | 3 or more calls from the database to edge functions failed in 15 min |
| `db:size` | database over 80% of the plan size (500 MB, Free plan) |
| `db:connections` | over 80% of `max_connections` in use |

Each problem goes to Telegram once, again every 6 hours while it lasts, and a "Fixed" message when it clears. Limits are in `ops_watchdog_config` (one row; e.g. `UPDATE ops_watchdog_config SET db_size_limit_mb = 8192` on the Pro plan). The tables and functions are server-only: no app role can read or call them.

**Health check** (`GET .../functions/v1/ops-alert`). Now also answers **503** when the watchdog hasn't run for 30 minutes, so the outside monitor notices if pg_cron itself stops. It returns only `ok`, `watchdog`, `open_problems` (a count) and `ms`; no details, since it is public.

## 3. Tests (test database `isms-seedtest`, in a rolled-back transaction)

| Test | Result |
|---|---|
| All 13 checks run on a normal database | Pass, all fine |
| Size limit set to 1 MB → problem raised, kept after a second run, "fixed" when set back | Pass |
| Fake failed run of `buying-nightly` → `cron:buying-nightly` problem with the error text | Pass |
| No Vault secrets → warning, not marked as sent, so it retries | Pass |
| `authenticated` calls `run_ops_watchdog` | Refused (permission denied) |
| `grants_check.sql` with the migration applied | No problems |
| `deno check` on `ops-alert` | Pass |
| Telegram delivery of a watchdog message | **Not tested**: needs the live function deployed |
| Stuck-payment check with a real pending payment | Not tested with data (no pending rows on the test DB); query ran |

Logs: edge function logs were searched for secrets, tokens, phones and emails. They log row IDs and error text only. Crash and problem reports already strip personal data on the device.

## 4. Checklist status

| Item | Status |
|---|---|
| External uptime check | **Owner action**: create the monitors in section 5 |
| API and database availability | Done once the monitor calls the health check |
| Latency, error rates, failed requests | Partial: response time from the uptime monitor; edge calls from the database; app-side edge function errors only in Supabase logs (no alert) |
| Database capacity, connections, storage | Done for size and connections; storage bucket size not watched |
| Scheduled jobs, edge function failures | Done (watchdog) |
| Payment callback failures | Done (watchdog). Unmatched till payments (reconciliation) not alerted |
| Backup completion and age | Built (backup workflows alert), waits for Phase 3 |
| Domain and certificate expiry | Cloudflare renews certificates for workers.dev. Add SSL/domain checks in the uptime tool when kaykays.com moves over |
| Independent channels | Telegram, plus email from the uptime tool (set both) |
| Deliberate test alerts | After deploy: `SELECT public.run_ops_watchdog(true);` and pause a monitor |
| Severity, ownership, escalation | Done: [incident-response.md](incident-response.md) |
| Logs useful and without secrets | Reviewed, see section 3 |
| Availability objective | 99.9% a month (about 43 min down). Measured by the uptime monitor's monthly report; not measured yet |

**Exit criteria not met yet**: the monitor is not set up and no alert has been demonstrated on live.

## 5. To finish (in order)

1. Apply the migration: `npx supabase db push`, then `bash scripts/check-live-grants.sh`.
2. Deploy the function: `npx supabase functions deploy ops-alert --no-verify-jwt`.
3. Check Vault has `project_url` and `service_role_key` (crash alerts use the same ones).
4. Test: in the SQL editor `SELECT public.run_ops_watchdog(true);` → a "Watchdog test" message in Telegram.
5. Owner: create the uptime monitors (DEPLOYMENT_AND_MONITORING.md → Uptime monitor), Telegram **and** email as contacts. Pause the app monitor's URL (or point it at a wrong path) once to see the alert arrive, then fix it.
6. After a month, record the monthly availability here.
