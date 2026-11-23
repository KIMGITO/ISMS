# Production readiness

**Classification (2026-11-23): Not Ready.** The P0 found is fixed and verified, but there is no working backup (SEC-02), no MFA (SEC-03), no staging database, and payment providers are untested end to end.

Plan and checklist: [ISMS_Production_Readiness_Master_Checklist.md](ISMS_Production_Readiness_Master_Checklist.md).

## Phase status

| Phase | Status | Report |
|---|---|---|
| 0. Discovery and architecture | Done | [infrastructure/architecture.md](infrastructure/architecture.md) |
| 1. Security and data isolation | In progress: P0 fixed; P1 open (owner actions) | [security/security-assessment.md](security/security-assessment.md) |
| 2. Financial and inventory integrity | Not started (partly reviewed in Phase 1) | |
| 3. Backup and recovery | Blocked: backup secrets unset | [BACKUP_AND_RECOVERY.md](BACKUP_AND_RECOVERY.md) |
| 4. Cloudflare deployment | Mostly built (Workers + blue-green live); no staging DB, no custom domain | [HOSTING_CLOUDFLARE.md](HOSTING_CLOUDFLARE.md) |
| 5. Monitoring and alerting | Partial (Telegram alerts); no uptime monitor | [DEPLOYMENT_AND_MONITORING.md](DEPLOYMENT_AND_MONITORING.md) |
| 6–10 | Not started | |

## Open risks

See [security/threat-register.md](security/threat-register.md). P1s: SEC-02 backups, SEC-03 MFA, SEC-04 public test password, SEC-05 possible use of SEC-01 before it was fixed.

## Owner actions, in order

1. **SEC-05 / SEC-04:** if you did not edit account `abb89fdf…` on 2026-11-22, reset both live passwords and sign out all sessions. Never use the seed password on live.
2. **SEC-02:** in GitHub → Settings → Secrets, set `SUPABASE_DB_URL`, `BACKUP_PASSPHRASE` (keep an offline copy), `R2_ACCESS_KEY_ID` and `R2_SECRET_ACCESS_KEY`. Run *Backup database* once, then *Restore drill*.
3. **SEC-03 / SEC-07:** in Supabase → Authentication: TOTP MFA on, password minimum 8 with letters and digits, leaked-password check if the plan allows it.
4. **SEC-09:** protect `main` (require checks, no force push).
5. Approve: deploy `send-email`; delete the old `kim-chat` and `shared` functions.
6. After any `supabase db push`, run `bash scripts/check-live-grants.sh`.

## Documentation map

| Topic | Document |
|---|---|
| Architecture, inventory, secrets names | [infrastructure/architecture.md](infrastructure/architecture.md) |
| Security assessment (Phase 0–1) | [security/security-assessment.md](security/security-assessment.md) |
| Threat register | [security/threat-register.md](security/threat-register.md) |
| Roles and permissions | [ROLES_AND_ACCESS.md](ROLES_AND_ACCESS.md) |
| Backup and recovery | [BACKUP_AND_RECOVERY.md](BACKUP_AND_RECOVERY.md) |
| Deployment, alerts, incidents | [DEPLOYMENT_AND_MONITORING.md](DEPLOYMENT_AND_MONITORING.md) |
| Cloudflare hosting | [HOSTING_CLOUDFLARE.md](HOSTING_CLOUDFLARE.md) |
| Releases and operations | [RELEASE_AND_OPERATIONS.md](RELEASE_AND_OPERATIONS.md) |
| Integrations | [INTEGRATIONS.md](INTEGRATIONS.md) |

The existing files under `docs/` stay where they are, so there are no duplicates. The new files follow the checklist's paths and link to them.
