# Production readiness

**Classification (2026-11-23, after Phase 10): Not Ready.** The P0 found is fixed and verified, but there is no working backup (SEC-02), no MFA (SEC-03), the database is very likely on Supabase's Free plan (OPS-06), most fixes from Phases 5–10 are not live yet, and payment providers are untested end to end. The reasons and the way out are in [Final readiness assessment](#final-readiness-assessment).

Plan and checklist: [ISMS_Production_Readiness_Master_Checklist.md](ISMS_Production_Readiness_Master_Checklist.md).

Everything left to do, step by step: [TO_FINISH.md](TO_FINISH.md).

## Phase status

| Phase | Status | Report |
|---|---|---|
| 0. Discovery and architecture | Done | [infrastructure/architecture.md](infrastructure/architecture.md) |
| 1. Security and data isolation | In progress: P0 fixed; P1 open (owner actions) | [security/security-assessment.md](security/security-assessment.md) |
| 2. Financial and inventory integrity | In progress: FIN-01 live; FIN-02 waits for the app release; SEC-10 open | [security/phase-2-financial-integrity.md](security/phase-2-financial-integrity.md) |
| 3. Backup and recovery | Blocked: backup secrets unset | [BACKUP_AND_RECOVERY.md](BACKUP_AND_RECOVERY.md) |
| 4. Cloudflare deployment | Production verified; staging deferred; domain and Auth URLs need the owner | [deployment/cloudflare-deployment.md](deployment/cloudflare-deployment.md) |
| 5. Monitoring and alerting | Database watchdog live (every 10 min); health check and `ops-alert` deployed; test alert and uptime monitor need the owner | [operations/monitoring-and-alerting.md](operations/monitoring-and-alerting.md) |
| 6. Network, API and attack resistance | Built: callback hardening, body caps, promo guess limit, abuse alerts, CI scans. Database change, website and edge functions live (found in Phase 10); CI scans start with the next push; pen test needs the owner | [security/phase-6-attack-resistance.md](security/phase-6-attack-resistance.md) |
| 7. CI/CD and release safety | Built: DB checks + security checks gate every release, `db-push.sh` gates live migrations; first CI run on next push; staging and branch protection need the owner | [deployment/release-safety.md](deployment/release-safety.md) |
| 8. Performance and growth | Measured and fixed in code: row-security cache (reads 2–4× faster, load-test throughput 2×), no more discarded full downloads, product changes merged in place, lists past 1,000 rows; repeatable load tests; growth plan. Live has an earlier draft of the migration (re-apply); app not released | [deployment/performance.md](deployment/performance.md) |
| 9. Multi-tenant and expansion | Reviewed: isolation sound; Kenya built in (currency, time zone, phone, payments, tax) with the changes listed; privacy policy needs EU hosting disclosure and adviser review | [deployment/expansion.md](deployment/expansion.md) |
| 10. Cost, operations, final readiness | Done in code and docs; DB changes not live. $0/month today, ~$25–30 minimum production, ~$0.55–0.70 per business from 100 businesses. Waste fixed (Realtime list, `money_assets` live updates, storage alert). Playbooks for compromise, breach, outage, data loss. Account details and backup person need the owner | [infrastructure/cost-management.md](infrastructure/cost-management.md), [operations/incident-response.md](operations/incident-response.md), [operations/accounts-and-ownership.md](operations/accounts-and-ownership.md) |

## Final readiness assessment

Date: 2026-11-23, at the end of Phase 10. The rule: a status needs evidence (tests, live checks, provider settings seen), not finished code.

### Result: Not Ready

ISMS should not take on paying businesses yet. The code is in good shape and well tested; what is missing is mostly on the providers' side and in getting the work of Phases 5–10 live.

### Evidence by area

| Area | Evidence for | Against (open) | Verdict |
|---|---|---|---|
| Tenant isolation and permissions | Row security on every table by `business_id`; `has_permission` in RLS and functions; 7 DB suites, 335 checks pass from a clean build (2026-11-23); `check-live-grants.sh` clean on live; SEC-01 (P0) fixed and verified on live | Branch-level permission tests; SEC-05 (possible use before the fix) unchecked | Strong |
| Money and stock integrity | Sale totals checked on live (FIN-01); one-step sale saving (FIN-02); books balance in every load-test run (0 failures over 6,417 units) | FIN-02 needs the app release; older apps until retired | Good, pending release |
| Accounts and sign-in | Session revocation on sign-out; OTP codes; invite rules | **No MFA (SEC-03, P1)**; live password policy 6 characters (SEC-07); public test password (SEC-04, P1) | Not ready |
| Backup and recovery | Hourly encrypted dump, retention tiers and weekly restore drill written and built | **Never ran: secrets unset (SEC-02, P1)**; Free plan has no restorable backups (OPS-06); RPO/RTO unmeasured | Not ready |
| Availability and monitoring | Blue-green web deploys verified on live; Telegram alerts live; watchdog running on live every 10 min | No uptime monitor; test alert not yet seen; Free plan pauses idle projects | Partly |
| Release safety | CI gates on DB checks and security scans; `db-push.sh` refuses if live differs | First CI run on next push; no staging (REL-01: dev uses the live DB); `main` unprotected (SEC-09) | Partly |
| Attack resistance | Callback tokens, body caps, promo guess limit, abuse alerts, dependency scan (0 advisories); on live | Wrong-token check not yet run on live; M-Pesa STK status not double-checked with Daraja (SEC-10); no pen test | Partly |
| Payments and tax | Code for M-Pesa, Airtel, Paystack, KRA eTIMS | **None tested against the real providers or their sandboxes**; `MPESA_CALLBACK_TOKEN` unset | Not ready |
| Performance | Load-tested: 41 transactions/s at 10 clients, ~100× a busy shop; reads 2–4× faster with the cache (live) | App fixes not released; logins not load-tested | Good, pending deploy |
| Cost and operations | Costs modelled to 10,000 businesses; waste fixed; playbooks and duties written | One person holds everything (OPS-05); billing, 2FA and spend caps unconfirmed; all email via one Gmail (OPS-04) | Partly |
| Legal and data protection | Privacy policy and Terms exist | EU hosting not disclosed; ODPC registration unknown (EXP-06) | Not ready |

### Accepted exceptions (owner-approved, stay accepted)

SEC-14 (old DB password in Git history; that project is gone), SEC-16 (edge functions answer CORS `*`; they check tokens and permissions themselves), SEC-26 (no per-IP limit in front of Supabase; per-function caps, re-assess with the domain). The items in [Deferred: revisit later](#deferred-revisit-later) are postponed, not accepted: they still count against the status.

### What it takes to reach the next status

**Conditionally Ready** (a few real businesses, owner watching closely), all of:

1. Supabase on Pro with the spend cap on (OPS-06), and the hourly backup running with one restore drill passed (SEC-02).
2. SEC-04 / SEC-05 checked and passwords reset; MFA available and on for every owner and admin (SEC-03); password policy raised (SEC-07).
3. Live matching the migration files: `20261201005` re-applied (live has an earlier draft) and `20261201006`–`007` pushed through `db-push.sh`; the 25 unpushed commits pushed so the app is released (FIN-02, PERF-02 to 04) and CI runs its new gates: [TO_FINISH.md](TO_FINISH.md) Phases 6–10.
4. Uptime monitors on, and a test alert seen in Telegram and by email.
5. The payment methods the first businesses will use tested end to end in the provider's sandbox, then once with real money (M-Pesa first; `MPESA_CALLBACK_TOKEN` set).
6. 2FA on every provider account and a backup person named (OPS-05).

**Production Ready** adds: a staging database with one rollback rehearsed there (REL-01), `main` protected (SEC-09), SEC-10 fixed, privacy policy reviewed and ODPC position confirmed (EXP-06), email moved off personal Gmail (OPS-04), a restore drill with a measured RPO/RTO, and an outside security test.

**Enterprise Ready** is not a goal at this stage: it would need SSO, audit exports, an SLA backed by more than one on-call person, and regional cells (Phase 8 growth plan).

## Open risks

See [security/threat-register.md](security/threat-register.md). P1s: SEC-02 backups, SEC-03 MFA, SEC-04 public test password, SEC-05 possible use of SEC-01 before it was fixed, FIN-02 until older apps are retired. Phase 10 added OPS-01 to OPS-07 (two P2 owner actions: OPS-05 single account holder, OPS-06 Free plan; OPS-04 Gmail for all email).

## Deferred: revisit later

The owner chose on 2026-11-23 to skip these for now and come back to them. They remain open risks, and the overall status can't rise above **Not Ready** while the P1s here are open.

| Item | Sev | What is left | Where it is written up |
|---|---|---|---|
| MFA for owner/admin (SEC-03) | P1 | Turn on TOTP in Supabase Auth; build enrolment in Profile plus a code prompt at sign-in; later require it for Owner/Admin | [threat-register.md#sec-03](security/threat-register.md#sec-03--p1--no-mfa-for-owneradmin-accounts) |
| Phase 3, backup and recovery (SEC-02) | P1 | Redo as a whole phase: set backup secrets, first hourly backup, restore drill, measure RPO/RTO, check Supabase plan backups/PITR, storage files | [BACKUP_AND_RECOVERY.md](BACKUP_AND_RECOVERY.md), checklist Phase 3 |
| Public test password / possible misuse (SEC-04, SEC-05) | P1 | Owner checks account `abb89fdf…` and the live passwords | [threat-register.md](security/threat-register.md) |
| One-step sale saving released (FIN-02) | P1 | Test one cash sale in `npm run dev`, push `main` (patch release); later block direct sale inserts once every device has updated | [phase-2-financial-integrity.md](security/phase-2-financial-integrity.md#5-deployment-order) |
| M-Pesa STK status check (SEC-10) | P2 | Query Daraja before marking an order paid; needs sandbox keys | [threat-register.md](security/threat-register.md) |
| Staging environment (WEB-03 / SEC-08) | P2 | Free Supabase `kaykays-staging` plus staging Workers; rollback rehearsal there | [cloudflare-deployment.md](deployment/cloudflare-deployment.md#5-deferred-and-owner-actions) |
| Rest of Phase 1 | — | Branch-level permission tests; review of input validation/XSS; logs and error messages; live Auth redirect URLs | checklist Phase 1 |
| Rest of Phase 2 | — | Audit histories and correction/reversal workflows | checklist Phase 2 |

## Owner actions, in order

1. **SEC-05 / SEC-04:** if you did not edit account `abb89fdf…` on 2026-11-22, reset both live passwords and sign out all sessions. Never use the seed password on live.
2. **SEC-02:** in GitHub → Settings → Secrets, set `SUPABASE_DB_URL`, `BACKUP_PASSPHRASE` (keep an offline copy), `R2_ACCESS_KEY_ID` and `R2_SECRET_ACCESS_KEY`. Run *Backup database* once, then *Restore drill*.
3. **SEC-03 / SEC-07:** in Supabase → Authentication: TOTP MFA on, password minimum 8 with letters and digits, leaked-password check if the plan allows it.
4. **SEC-09:** protect `main` (require checks, no force push).
5. **Phase 4:** check Supabase Auth URL Configuration (WEB-07); enable R2 when redoing Phase 3; move kaykays.com DNS to Cloudflare when ready (WEB-05).
6. **Phase 5:** after `db push` + `functions deploy ops-alert`, run `SELECT public.run_ops_watchdog(true);` and create the uptime monitors ([monitoring-and-alerting.md](operations/monitoring-and-alerting.md) section 5).
7. Push migrations with `bash scripts/db-push.sh` (it runs `check-live-grants.sh` after the push), never a bare `supabase db push`.
8. **Phase 10:** move Supabase to Pro with the spend cap on before the first paying business (OPS-06); fill in [accounts-and-ownership.md](operations/accounts-and-ownership.md) (2FA, billing, recovery) and name a backup person (OPS-05).
9. **EXP-06:** have a data protection adviser review the privacy policy (EU hosting, processors) and confirm whether ISMS must register with the ODPC.

## Documentation map

| Topic | Document |
|---|---|
| Architecture, inventory, secrets names | [infrastructure/architecture.md](infrastructure/architecture.md) |
| Security assessment (Phase 0–1) | [security/security-assessment.md](security/security-assessment.md) |
| Threat register | [security/threat-register.md](security/threat-register.md) |
| Financial integrity (Phase 2) | [security/phase-2-financial-integrity.md](security/phase-2-financial-integrity.md) |
| Attack resistance (Phase 6) | [security/phase-6-attack-resistance.md](security/phase-6-attack-resistance.md) |
| Performance and growth (Phase 8) | [deployment/performance.md](deployment/performance.md) |
| Expansion: tenants, countries, data protection (Phase 9) | [deployment/expansion.md](deployment/expansion.md) |
| Roles and permissions | [ROLES_AND_ACCESS.md](ROLES_AND_ACCESS.md) |
| Backup and recovery | [BACKUP_AND_RECOVERY.md](BACKUP_AND_RECOVERY.md) |
| Deployment, alerts, incidents | [DEPLOYMENT_AND_MONITORING.md](DEPLOYMENT_AND_MONITORING.md); Phase 5: [operations/monitoring-and-alerting.md](operations/monitoring-and-alerting.md), [operations/incident-response.md](operations/incident-response.md) |
| Cloudflare hosting | [HOSTING_CLOUDFLARE.md](HOSTING_CLOUDFLARE.md), Phase 4: [deployment/cloudflare-deployment.md](deployment/cloudflare-deployment.md) |
| Release pipeline, migrations to live, rollback vs recovery (Phase 7) | [deployment/release-safety.md](deployment/release-safety.md) |
| Releases and operations | [RELEASE_AND_OPERATIONS.md](RELEASE_AND_OPERATIONS.md) |
| Costs, budgets, usage alerts (Phase 10) | [infrastructure/cost-management.md](infrastructure/cost-management.md) |
| Incident playbooks, operational duties (Phase 10) | [operations/incident-response.md](operations/incident-response.md) |
| Provider accounts, ownership, recovery (Phase 10) | [operations/accounts-and-ownership.md](operations/accounts-and-ownership.md) |
| Integrations | [INTEGRATIONS.md](INTEGRATIONS.md) |

The existing files under `docs/` stay where they are, so there are no duplicates. The new files follow the checklist's paths and link to them.
