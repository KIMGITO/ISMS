# Incident response

Severity levels and the first 15 minutes are in [DEPLOYMENT_AND_MONITORING.md](../DEPLOYMENT_AND_MONITORING.md) section 4. This page adds who does what (Phase 5) and what to do for the four serious cases (Phase 10). Accounts and recovery routes: [accounts-and-ownership.md](accounts-and-ownership.md).

## Contents

1. [Who](#1-who)
2. [How fast](#2-how-fast)
3. [Escalation](#3-escalation)
4. [Playbooks](#4-playbooks): [account compromise](#41-account-compromise), [data breach](#42-data-breach), [outage](#43-outage), [data loss](#44-data-loss)
5. [Operational responsibilities](#5-operational-responsibilities)
6. [After an incident](#6-after-an-incident)

## 1. Who

| Role | Who | Does |
|---|---|---|
| On call | The developer (Telegram alerts) | Answers every P1 and P2 alert |
| Platform owner | The developer today (same person) | Provider accounts, billing, decisions on breaches and customer notices |
| Business owner | Each shop's owner | Reports problems (About this app → Report a problem), tells their staff, owns their own payment and SMS accounts |
| Providers | Supabase, Cloudflare, Safaricom, Airtel, Paystack | Fix outages on their side; check their status pages first |
| Backup person | **Not named yet** (OPS-05) | Reaches the offline copy and the accounts if the owner can't |

There is one person on call. When they can't respond (travel, no network), say so in advance to owners and who to call instead.

## 2. How fast

| Level | First response | Owners told | Fixed or worked around |
|---|---|---|---|
| P1: can't trade, or data exposed | 15 min | 30 min | 4 h |
| P2: something is wrong | Same day | If it affects them | 2 days |
| P3: small | Next release | No | When planned |

## 3. Escalation

1. Alert in Telegram (watchdog, crash, deploy, uptime monitor) or a "We can't work" report.
2. No answer to a P1 in 15 minutes: the uptime tool's email reaches the same person on a second channel.
3. Provider at fault: open a ticket with the provider (Supabase dashboard → Support; Cloudflare → Support; Safaricom Daraja → support email) and tell owners.
4. A breach or a suspected one (4.2): the platform owner decides on notices the same day; the data protection adviser (EXP-06) is called before anything goes out to the regulator.

## 4. Playbooks

Each one: **stop it, find out how big, put it right, tell people.** Keep a timeline as you go (time, what you saw, what you did): it becomes the incident note and, for a breach, the regulator's report.

### 4.1 Account compromise

Signs: a sign-in you didn't make, a provider's "new login" email, settings or secrets changed, an unexpected deploy, release or migration, odd rows in `audit_logs`.

**A provider account (Supabase, Cloudflare, GitHub, Google, Telegram):**

1. From a clean device, change the password, sign out every other session, and check 2FA is still yours (remove any factor you didn't add).
2. Rotate what that account could read:
   - Supabase: database password; the `service_role` and JWT secret (Settings → API, this signs everyone out, plan it); function secrets (`SMTP_PASS`, `HF_TOKEN_*`, `TELEGRAM_BOT_TOKEN`, `FIREBASE_SERVICE_ACCOUNT`, `MPESA_CALLBACK_TOKEN`); Vault `service_role_key`.
   - GitHub: every Actions secret ([architecture.md](../infrastructure/architecture.md) section 8), personal tokens, deploy keys; check **Actions** for runs you didn't start and **Releases** for files you didn't publish (a forged release reaches every installed app through auto-update: delete it and publish a fixed one).
   - Cloudflare: API tokens; check Workers deployments and roll back (**Actions → Roll back web**).
   - Google: app password for SMTP; Firebase service account key.
3. Look for changes made while they were in: Supabase → Database → migrations list (compare with `bash scripts/db-push.sh`, which refuses if live differs from the files), Auth users added, edge functions redeployed; `check-live-grants.sh`.
4. If data could have been read, it is also a breach: go to 4.2.

**An ISMS user account (owner, admin, cashier):**

1. As the business owner (Workers screen) or in Supabase Auth: suspend the member or reset their password, and sign out all their sessions (sign-out revokes the session on the server).
2. Check what they did: Sales log edits (sale edit log), `audit_logs`, money movements on Payments, refunds, wallet top-ups, stock adjustments. Money rule 4: undo by removing and recording again, never by editing.
3. Owner or admin accounts: once MFA exists (SEC-03), require it again for that person.

### 4.2 Data breach

A breach is personal or business data seen or taken by someone who shouldn't have it: customers' names, phones, debts, sales, staff details, payment records.

1. **Stop the leak.** Close the hole (revoke the token or account, roll back the web, apply a fix migration). Keep evidence: don't delete logs or rows; copy the relevant API and edge-function logs (Supabase → Logs) before their retention ends.
2. **Size it within 24 hours:** which businesses, which kinds of data, how many people, from when to when, and whether it was only possible or actually happened (Logs show which requests were made). SEC-01 / SEC-05 are the worked example.
3. **Tell the regulator.** Kenya's Data Protection Act 2019 (section 43) requires notifying the Data Commissioner (ODPC) **within 72 hours** of becoming aware of a breach that risks harm to people, and telling the people affected without undue delay. ISMS processes data for businesses, so **tell each affected business owner at once** (within 48 hours at most) so they can meet their own duty. Confirm the exact duties with the data protection adviser (EXP-06) before the first real case.
4. **Tell the affected businesses** in plain words: what happened, what data, what we did, what they should do (for example, watch for fake M-Pesa messages to their customers).
5. Rotate any secret in the exposed data (payment keys in `*_payment_secrets`, KRA keys): ask the business to generate new ones with their provider.

### 4.3 Outage

1. **Is it everyone?** Uptime monitor, health check (`GET ops-alert` answers 503 when the watchdog stopped), status.supabase.com, cloudflarestatus.com.
2. **A provider is down:** nothing to roll back. Tell owners: cash and M-Pesa till sales keep working offline and sync later; credit sales, payment prompts, messages and sign-in need the connection.
3. **A release broke it:** web: **Actions → Roll back web**; installed apps: publish a `fix:` release (auto-update); database: fix forward with a new migration ([release-safety.md](../deployment/release-safety.md)).
4. **The project is paused** (Free plan after a week without traffic): Supabase dashboard → Restore project. The fix is the Pro plan (cost-management.md section 1).
5. **Quota reached** (database, files, egress, Realtime, email): the watchdog's `db:size` / `storage:size` alert should come first. Free space (old logs: Admin → log cleanup) or upgrade; for Gmail's daily cap, wait for the reset or switch the SMTP secrets to a sending service (OPS-04).

### 4.4 Data loss

Rows deleted or overwritten by mistake, a bad migration, a lost project.

1. **Stop writes that make it worse:** pause the cron job or the feature, or roll back the release that caused it. Don't restore on top of live yet.
2. **Find the extent:** which tables, which businesses, since when. Soft-deleted rows (`deleted_at`) can be brought back without a restore.
3. **Restore a copy, not live:** the newest good backup into a separate database (`scripts/db-backup.sh restore`, [BACKUP_AND_RECOVERY.md](../BACKUP_AND_RECOVERY.md) section 5), then copy back only the missing rows. A whole-project restore (Supabase backups / PITR) loses everything since the backup point: only for a lost or wrecked project.
4. **Re-check the money afterwards:** books balanced (debits = credits), Payments balances match the books (money rules 2 and 4).
5. Sales made offline during the incident are still on the devices and sync when the database is back.

**Today this playbook can't be followed:** there is no working backup (SEC-02). Setting one up is the first owner action in [production-readiness.md](../production-readiness.md).

## 5. Operational responsibilities

| Task | How often | Who | Where |
|---|---|---|---|
| Answer alerts | As they come | On call | Telegram |
| Push migrations | Each change | Developer | `bash scripts/db-push.sh` (runs `check-live-grants.sh`) |
| Release apps and web | Each change | Developer; CI gates it | [release-safety.md](../deployment/release-safety.md) |
| Check the restore drill passed | Weekly (Mondays) | Developer | Actions → Restore drill |
| Offline copy of backups and keys | Monthly | Platform owner | BACKUP_AND_RECOVERY.md section 4.3 |
| Read provider usage and bills | Monthly | Platform owner | [cost-management.md](../infrastructure/cost-management.md) section 8 |
| Read `pg_stat_statements` for slow requests | Monthly | Developer | [performance.md](../deployment/performance.md) section 6 |
| Review security scans (dependencies, secrets) | Weekly (CI, Mondays) | Developer | Actions → Security |
| Review the threat register and this page | Quarterly | Platform owner + developer | [threat-register.md](../security/threat-register.md) |
| Renew domain, check cards on file | Yearly / when told | Platform owner | accounts-and-ownership.md |
| Staff accounts and roles in each shop | When staff change | Business owner | Workers screen |

## 6. After an incident

Write three lines (what broke, why, what stops it happening again) in the problem report or `docs/operations/incidents.md`. A P1 that the alerts didn't catch means a new watchdog check or monitor. A breach also keeps the timeline, the size and the notices sent.
