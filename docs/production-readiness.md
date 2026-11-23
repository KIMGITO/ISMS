# Production readiness

**Classification (2026-11-23): Not Ready.** The P0 found is fixed and verified, but there is no working backup (SEC-02), no MFA (SEC-03), no staging database, and payment providers are untested end to end.

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
| 5. Monitoring and alerting | Built: database watchdog + health check, tested on a test DB; not on live; uptime monitor needs the owner | [operations/monitoring-and-alerting.md](operations/monitoring-and-alerting.md) |
| 6. Network, API and attack resistance | Built: callback hardening, body caps, promo guess limit, abuse alerts, CI scans; tested on a test DB; not on live; pen test needs the owner | [security/phase-6-attack-resistance.md](security/phase-6-attack-resistance.md) |
| 7. CI/CD and release safety | Built: DB checks + security checks gate every release, `db-push.sh` gates live migrations; first CI run on next push; staging and branch protection need the owner | [deployment/release-safety.md](deployment/release-safety.md) |
| 8–10 | Not started | |

## Open risks

See [security/threat-register.md](security/threat-register.md). P1s: SEC-02 backups, SEC-03 MFA, SEC-04 public test password, SEC-05 possible use of SEC-01 before it was fixed.

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

## Documentation map

| Topic | Document |
|---|---|
| Architecture, inventory, secrets names | [infrastructure/architecture.md](infrastructure/architecture.md) |
| Security assessment (Phase 0–1) | [security/security-assessment.md](security/security-assessment.md) |
| Threat register | [security/threat-register.md](security/threat-register.md) |
| Financial integrity (Phase 2) | [security/phase-2-financial-integrity.md](security/phase-2-financial-integrity.md) |
| Attack resistance (Phase 6) | [security/phase-6-attack-resistance.md](security/phase-6-attack-resistance.md) |
| Roles and permissions | [ROLES_AND_ACCESS.md](ROLES_AND_ACCESS.md) |
| Backup and recovery | [BACKUP_AND_RECOVERY.md](BACKUP_AND_RECOVERY.md) |
| Deployment, alerts, incidents | [DEPLOYMENT_AND_MONITORING.md](DEPLOYMENT_AND_MONITORING.md); Phase 5: [operations/monitoring-and-alerting.md](operations/monitoring-and-alerting.md), [operations/incident-response.md](operations/incident-response.md) |
| Cloudflare hosting | [HOSTING_CLOUDFLARE.md](HOSTING_CLOUDFLARE.md), Phase 4: [deployment/cloudflare-deployment.md](deployment/cloudflare-deployment.md) |
| Release pipeline, migrations to live, rollback vs recovery (Phase 7) | [deployment/release-safety.md](deployment/release-safety.md) |
| Releases and operations | [RELEASE_AND_OPERATIONS.md](RELEASE_AND_OPERATIONS.md) |
| Integrations | [INTEGRATIONS.md](INTEGRATIONS.md) |

The existing files under `docs/` stay where they are, so there are no duplicates. The new files follow the checklist's paths and link to them.
