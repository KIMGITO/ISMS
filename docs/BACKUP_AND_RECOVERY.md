# Backup and Recovery Plan

What KayKay's backs up, where, how often, how long it is kept, and how to restore it. Deployment and alerts are in [ISMS-TD Ch 15 and 17](../documentation/final/ISMS-Technical-Documentation/ISMS-TD.md).

## 1. Targets

| | Target | Means |
|---|---|---|
| **RPO** (most data that can be lost) | 1 hour, or minutes with Supabase PITR | Hourly dump. Sales made offline are still on the device and sync after a restore |
| **RTO** (time to be working again) | 4 hours for a full restore, 30 minutes for a web rollback | Section 5 |
| **Proof** | An automatic restore drill every Monday, plus a hands-on one every month | Section 6 |

## 2. What must be protected

| # | Item | Holds | Where it lives | Backed up by | Lost means |
|---|---|---|---|---|---|
| 1 | **Database** | Every business's sales, stock, customers, staff, payments, settings, auth users | Supabase Postgres | L1 + L2 + L3 below | Everything |
| 2 | **Storage files** | Business logos (`business-logos` bucket) | Supabase Storage | Monthly manual copy (section 4.4) | Logos re-uploaded by hand |
| 3 | **Android signing key** | `~/.config/kaykays-signing/` (keystore + `credentials.env`) | Developer's machine, GitHub secret | Offline copy (L4) | Installed phones can never update; every phone must reinstall |
| 4 | **Desktop update key** | `~/.tauri/kaykays-updater.key` + `.password` | Developer's machine, GitHub secret | Offline copy (L4) | Installed desktops refuse every update |
| 5 | **Backup passphrase** | `BACKUP_PASSPHRASE` | GitHub secret | Offline copy (L4), password manager | Every L2 backup becomes unreadable |
| 6 | **Secrets and config** | GitHub secrets and variables, Supabase function secrets, Vault secrets, Cloudflare account and API token | Those services | Names listed in ISMS-TD Ch 15 and 16 and ISMS-TD Ch 15 and 17; values in a password manager (L4) | Hours of re-issuing keys (M-Pesa, Paystack, KRA, SMS, AI, Firebase) |
| 7 | **Source code** | This repository | GitHub (private) | Every clone, plus the monthly offline copy | Rebuild from a clone |
| 8 | **Releases** | Installers and `latest.json` | `KIMGITO/kaykays-releases` | GitHub; can be rebuilt from a tag | Rebuilt by re-running the release |

## 3. Backup layers

| Layer | What | How often | Kept | Where | Who |
|---|---|---|---|---|---|
| **L1** Supabase project backups | Whole database | Daily (Pro plan); continuous with the PITR add-on | 7 days on Pro (Free plan: none you can restore) | Supabase | Automatic |
| **L2** Hourly encrypted dump | Roles, schema and data (`backup-database.yml`) | Every hour at :17, and by hand before risky migrations | Hourly 3 days; daily (03:xx Nairobi) 35 days; Sunday's 6 months; the 1st's 13 months | Cloudflare R2 bucket `kaykays-backups` (private), AES-256 encrypted. Fallback without R2: run artifacts (hourly 3 d, daily 14 d, Sunday 90 d) | Automatic; Telegram on failure (once, then daily); restore drill every Monday |
| **L3** Per-business Google Sheets | One business's sales, stock, customers, debts, wallet | The owner's schedule (Settings → Backup) | In the owner's sheet | The business's Google Drive | Each owner |
| **L4** Offline copy | Latest Sunday L2 backup, the signing keys, the passphrase, a code bundle | First Monday of each month | 12 months | Encrypted USB drive kept off-site, plus a password manager for the passphrase and secrets | Developer |

Why several layers: L1 is quickest but sits with the same provider as the database. L2 is outside Supabase and survives losing the project or the account; it lives in Cloudflare, not GitHub, because this repository is public and anyone signed in to GitHub can download a public repository's run artifacts. L3 lets an owner keep working from their own records. L4 survives losing GitHub access too.

**Check the Supabase plan.** On the Free plan there is no L1 and the project pauses after a week without use. For a paid product, Pro (daily backups) is the minimum. Add PITR if losing a day of credit sales and payments is not acceptable.

## 4. Setting up

### 4.1 Hourly dump (L2)

1. Supabase dashboard → **Connect** → **Session pooler** → copy the connection string and fill in the database password. (GitHub runners have no IPv6, so the direct connection does not work.)
2. Make a passphrase: `openssl rand -base64 32`. **Save it in the password manager and in L4 first.**
3. Cloudflare dashboard → **R2** → **Create bucket** `kaykays-backups` (leave public access off). Then **R2 → Manage API tokens → Create API token**: *Object Read & Write*, applied to that bucket only. Copy the Access Key ID and Secret Access Key.
4. Store them (CLOUDFLARE_ACCOUNT_ID is already set for web deploys):
   ```bash
   gh secret set SUPABASE_DB_URL
   gh secret set BACKUP_PASSPHRASE
   gh secret set R2_ACCESS_KEY_ID
   gh secret set R2_SECRET_ACCESS_KEY
   ```
5. Run **Actions → Back up database → Run workflow** once and check it is green, then **Actions → Restore drill → Run workflow** to prove it comes back.
6. On the developer's machine, put the same values in `~/.config/kaykays-backup/env` (`chmod 600`), so `scripts/db-backup.sh` can reach the backups:
   ```bash
   BACKUP_PASSPHRASE='...'            # or leave out and type it when asked
   R2_ACCESS_KEY_ID='...'
   R2_SECRET_ACCESS_KEY='...'
   CLOUDFLARE_ACCOUNT_ID='...'
   ```

Each run checks that the dump contains the core tables, is not suspiciously small, and opens with the passphrase, before keeping it. Each backup also records the code commit, the latest migration and the row count of every table, so you know which app version it matches and the restore can prove nothing went missing.

Before a risky migration, take one by hand and keep it long: **Run workflow** with *tier* = `monthly`, or `scripts/db-backup.sh now`.

Cost: GitHub Actions minutes are free for public repositories. R2's free tier is 10 GB with no download fees; about 72 hourly + 35 daily + 26 weekly + 13 monthly copies are kept, so it stays free until a compressed backup passes ~70 MB.

### 4.2 Owner backups (L3)

Owners and admins set this up in **Settings → Backup** with a Google Sheet and service account. Runs need the Vault secrets `project_url` and `service_role_key` (ISMS-TD Ch 15 and 16 → Scheduled jobs). Each run appears in the backup history.

### 4.3 Offline copy (L4), monthly

```bash
# 1. Latest Sunday backup
scripts/db-backup.sh list weekly
(cd ~/kaykays-offline/db && KAYKAYS_BACKUP_HOME=$PWD ../../Projects/ISMS/scripts/db-backup.sh get <name>)
# or copy the encrypted file itself from R2 (dashboard → R2 → kaykays-backups → weekly/)

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

### 5.1 Open an L2 backup: `scripts/db-backup.sh`

The developer's tool (needs Docker, gpg and the Supabase CLI; settings from 4.1 step 6). The weekly drill runs the same commands, so if the drill is green this works.

```bash
scripts/db-backup.sh list                    # every backup, newest first, with its tier
scripts/db-backup.sh get latest              # download, check the checksum, open into ~/kaykays-backups/<name>/
scripts/db-backup.sh restore latest          # ...and load it into a private local Supabase
scripts/db-backup.sh restore kaykays-db-20261201-0017      # a particular hour
scripts/db-backup.sh restore /media/usb/kaykays-db-....tar.gz.gpg   # a file from the offline copy
```

`restore` starts a separate local Supabase (`kaykays-restore`, its own ports, never your development stack), loads roles, schema and data, removes scheduled jobs and Vault keys so the copy can never call M-Pesa, Telegram or the live functions, and checks every table has exactly the rows the backup recorded. Then:

| To | Use |
|---|---|
| Browse and edit tables, run SQL | Studio at http://127.0.0.1:55423 |
| Connect a SQL tool (DBeaver, TablePlus, Excel via ODBC) | `postgresql://postgres:postgres@127.0.0.1:55422/postgres` |
| SQL prompt | `scripts/db-backup.sh psql` |
| Save one table as CSV | `scripts/db-backup.sh psql -c "\copy (SELECT * FROM transactions WHERE business_id = '...') TO STDOUT CSV HEADER" > sales.csv` |
| See which app version it matches | `~/kaykays-backups/<name>/code-commit.txt`, `latest-migration-in-repo.txt`, `taken-at.txt` |
| Finish (delete the copy) | `scripts/db-backup.sh stop`, then delete `~/kaykays-backups/<name>/`: it holds customers' data unencrypted |

Without the tool: download `<tier>/<name>.tar.gz.gpg` and `.sha256` from the R2 dashboard, then `sha256sum -c <name>.sha256 && gpg -d <name>.tar.gz.gpg | tar -xzf -`. The folder holds `roles.sql`, `schema.sql`, `data.sql`, `row-counts.tsv`, `code-commit.txt`, `latest-migration-in-repo.txt`, `taken-at.txt`.

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

Don't restore over live data. Restore the L2 backup from just before the mistake with `scripts/db-backup.sh restore <name>` (5.1), find the rows, and copy just those back with an `INSERT … ON CONFLICT` you have checked. For one business, the owner's L3 sheet is often enough to see what the numbers were.

### 5.4 Keys lost

- Android key: restore `~/.config/kaykays-signing/` from L4, then `gh secret set ANDROID_KEYSTORE_BASE64` again. The certificate must match `android/release-signing-cert.sha256`.
- Desktop key: restore `~/.tauri/` from L4, then set `TAURI_SIGNING_PRIVATE_KEY` and its password again.
- If a key is truly gone, see ISMS-TD Ch 15 and 16: every device must reinstall by hand.

## 6. Restore drill (monthly, about 30 minutes)

A backup that has never been restored is a hope, not a backup.

**Automatic, every Monday:** the *Restore drill* workflow downloads the newest backup, restores it on a clean runner with `scripts/db-backup.sh restore`, checks every table's row count against the backup, and fails if the newest backup is more than 26 hours old. Failure goes to Telegram.

**By hand, monthly:**

1. `scripts/db-backup.sh restore latest` (5.1).
2. Check: the number of businesses, and for one business the last sale's time and total match the live app as of `taken-at.txt`.
3. Note the date and result at the bottom of this file. If anything failed, fix it before anything else.

| Date | Backup | Result | By |
|---|---|---|---|
| | | | |

## 7. Who does what

| Task | Who |
|---|---|
| Watch Telegram for backup and drill failures; fix the same day | Developer |
| Monthly L4 copy and restore drill | Developer |
| Keep Supabase on a plan with backups | Developer |
| Set up and check their own Google Sheets backup | Each business owner |
| Report missing or wrong data quickly (Report a problem) | Owners and admins |
