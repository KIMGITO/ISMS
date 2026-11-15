# Backup and Recovery Plan

What KayKay's backs up, where, how often, how long it is kept, and how to restore it. Deployment and alerts are in [DEPLOYMENT_AND_MONITORING.md](DEPLOYMENT_AND_MONITORING.md).

## 1. Targets

| | Target | Means |
|---|---|---|
| **RPO** (most data that can be lost) | 24 hours, or 0 with Supabase PITR | Nightly dump. Sales made offline are still on the device and sync after a restore |
| **RTO** (time to be working again) | 4 hours for a full restore, 30 minutes for a web rollback | Section 5 |
| **Proof** | A restore drill every month | Section 6 |

## 2. What must be protected

| # | Item | Holds | Where it lives | Backed up by | Lost means |
|---|---|---|---|---|---|
| 1 | **Database** | Every business's sales, stock, customers, staff, payments, settings, auth users | Supabase Postgres | L1 + L2 + L3 below | Everything |
| 2 | **Storage files** | Business logos (`business-logos` bucket) | Supabase Storage | Monthly manual copy (section 4.4) | Logos re-uploaded by hand |
| 3 | **Android signing key** | `~/.config/kaykays-signing/` (keystore + `credentials.env`) | Developer's machine, GitHub secret | Offline copy (L4) | Installed phones can never update; every phone must reinstall |
| 4 | **Desktop update key** | `~/.tauri/kaykays-updater.key` + `.password` | Developer's machine, GitHub secret | Offline copy (L4) | Installed desktops refuse every update |
| 5 | **Backup passphrase** | `BACKUP_PASSPHRASE` | GitHub secret | Offline copy (L4), password manager | Every L2 backup becomes unreadable |
| 6 | **Secrets and config** | GitHub secrets and variables, Supabase function secrets, Vault secrets, Cloudflare account and API token | Those services | Names listed in RELEASE_AND_OPERATIONS.md and DEPLOYMENT_AND_MONITORING.md; values in a password manager (L4) | Hours of re-issuing keys (M-Pesa, Paystack, KRA, SMS, AI, Firebase) |
| 7 | **Source code** | This repository | GitHub (private) | Every clone, plus the monthly offline copy | Rebuild from a clone |
| 8 | **Releases** | Installers and `latest.json` | `KIMGITO/kaykays-releases` | GitHub; can be rebuilt from a tag | Rebuilt by re-running the release |

## 3. Backup layers

| Layer | What | How often | Kept | Where | Who |
|---|---|---|---|---|---|
| **L1** Supabase project backups | Whole database | Daily (Pro plan); continuous with the PITR add-on | 7 days on Pro (Free plan: none you can restore) | Supabase | Automatic |
| **L2** Nightly encrypted dump | Roles, schema and data (`backup-database.yml`) | 03:30 Nairobi every night, and by hand before risky migrations | Daily 14 days; Sunday's 90 days | GitHub Actions artifacts of this repo, AES-256 encrypted | Automatic; Telegram on failure |
| **L3** Per-business Google Sheets | One business's sales, stock, customers, debts, wallet | The owner's schedule (Settings → Backup) | In the owner's sheet | The business's Google Drive | Each owner |
| **L4** Offline copy | Latest Sunday L2 backup, the signing keys, the passphrase, a code bundle | First Monday of each month | 12 months | Encrypted USB drive kept off-site, plus a password manager for the passphrase and secrets | Developer |

Why several layers: L1 is quickest but sits with the same provider as the database. L2 is outside Supabase and survives losing the project or the account. L3 lets an owner keep working from their own records. L4 survives losing GitHub access too.

**Check the Supabase plan.** On the Free plan there is no L1 and the project pauses after a week without use. For a paid product, Pro (daily backups) is the minimum. Add PITR if losing a day of credit sales and payments is not acceptable.

## 4. Setting up

### 4.1 Nightly dump (L2)

1. Supabase dashboard → **Connect** → **Session pooler** → copy the connection string and fill in the database password. (GitHub runners have no IPv6, so the direct connection does not work.)
2. Make a passphrase: `openssl rand -base64 32`. **Save it in the password manager and in L4 first.**
3. Store both:
   ```bash
   gh secret set SUPABASE_DB_URL
   gh secret set BACKUP_PASSPHRASE
   ```
4. Run **Actions → Back up database → Run workflow** once and check it is green. Then do the restore drill (section 6) once, so you know the backup opens.

Each run checks that the dump contains the core tables, is not suspiciously small, and opens with the passphrase, before keeping it. Each backup also records the code commit and latest migration, so you know which app version it matches.

Storage cost: artifacts count towards the private repository's 500 MB free storage. Each backup is roughly the size of the database compressed; about 27 copies are kept at any time (14 daily plus up to 13 weekly). If the database grows past ~15 MB compressed, shorten the retention or move L2 to a cloud bucket.

### 4.2 Owner backups (L3)

Owners and admins set this up in **Settings → Backup** with a Google Sheet and service account. Runs need the Vault secrets `project_url` and `service_role_key` (RELEASE_AND_OPERATIONS.md → Scheduled jobs). Each run appears in the backup history.

### 4.3 Offline copy (L4), monthly

```bash
# 1. Latest Sunday backup
gh run list --workflow backup-database.yml --limit 10
gh run download <run-id> --dir ~/kaykays-offline/db/

# 2. Keys
cp -r ~/.config/kaykays-signing ~/.tauri ~/kaykays-offline/keys/

# 3. Code
git bundle create ~/kaykays-offline/isms-$(date +%Y%m%d).bundle --all
```

Copy `~/kaykays-offline` to the encrypted USB drive, then delete the keys from the folder. Check the drive opens before putting it away.

### 4.4 Storage files

Logos are small and change rarely. Monthly, with the Supabase CLI logged in and linked:

```bash
npx supabase storage cp -r ss:///business-logos ~/kaykays-offline/storage/business-logos --experimental
```

## 5. Restoring

**Before restoring anything, stop and take a fresh backup of the current state** (Run workflow on *Back up database*), even if it is broken. A restore you need to undo is common.

### 5.1 Open an L2 backup

```bash
gh run download <run-id> --dir restore/
cd restore/kaykays-db-*/
sha256sum -c *.sha256
gpg -d kaykays-db-*.tar.gz.gpg | tar -xzf -     # asks for BACKUP_PASSPHRASE
# roles.sql, schema.sql, data.sql, code-commit.txt, latest-migration-in-repo.txt, taken-at.txt
```

### 5.2 Whole database lost or corrupted

1. Fastest if available: **L1**. Supabase → Database → Backups → restore (or PITR to a time just before the problem). The project is offline for minutes to an hour, depending on size.
2. Otherwise, **L2 into a new project**:
   ```bash
   psql --single-transaction --variable ON_ERROR_STOP=1 \
     --file roles.sql --file schema.sql \
     --command 'SET session_replication_role = replica' \
     --file data.sql \
     --dbname "<new project's session pooler URL>"
   ```
   Then: deploy every edge function, set the function secrets, Vault secrets and storage bucket again, copy the logos back, and point the apps at the new project (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` secrets, then a `fix:` release, which also redeploys the web on Cloudflare). Installed apps on the old address need that release. **If you can, restore into the same project instead** so apps don't need a new release.
3. Tell owners what time the data goes back to. Offline sales still waiting on devices sync on their own. Payments made after the backup can be found again from M-Pesa and Paystack statements.

### 5.3 One business, one table, or a few rows wrong

Don't restore over live data. Restore the L2 backup into a scratch database (a free Supabase project, or `npx supabase start` locally), find the rows, and copy just those back with an `INSERT … ON CONFLICT` you have checked. For one business, the owner's L3 sheet is often enough to see what the numbers were.

### 5.4 Keys lost

- Android key: restore `~/.config/kaykays-signing/` from L4, then `gh secret set ANDROID_KEYSTORE_BASE64` again. The certificate must match `android/release-signing-cert.sha256`.
- Desktop key: restore `~/.tauri/` from L4, then set `TAURI_SIGNING_PRIVATE_KEY` and its password again.
- If a key is truly gone, see RELEASE_AND_OPERATIONS.md: every device must reinstall by hand.

## 6. Restore drill (monthly, about 30 minutes)

A backup that has never been restored is a hope, not a backup.

1. Download last night's L2 backup and open it (5.1).
2. Restore it into a scratch database (5.3).
3. Check: the number of businesses, and for one business the last sale's time and total match the live app as of `taken-at.txt`.
4. Note the date and result at the bottom of this file. If anything failed, fix it before anything else.

| Date | Backup | Result | By |
|---|---|---|---|
| | | | |

## 7. Who does what

| Task | Who |
|---|---|
| Watch Telegram for backup failures; rerun or fix the same day | Developer |
| Monthly L4 copy and restore drill | Developer |
| Keep Supabase on a plan with backups | Developer |
| Set up and check their own Google Sheets backup | Each business owner |
| Report missing or wrong data quickly (Report a problem) | Owners and admins |
