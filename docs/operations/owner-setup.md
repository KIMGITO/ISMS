# Owner setup: settings only you can change

These are the account settings that make the system safe to run. Only the owner can change them, because they need the owner's logins. Do them in the order below. Each step says where to click, what to set, and how to check it worked.

Web addresses (Site URL, domain, DNS) and outside services (M-Pesa, Paystack, uptime monitors) are left for later. See [TO_FINISH.md](../TO_FINISH.md).

Menu names in the dashboards change now and then. If a name here doesn't match, use the dashboard's search box with the word in **bold**.

| # | What | Where | Time | Done |
|---|------|-------|------|------|
| 1 | Password rules | Supabase | 2 min | [ ] |
| 2 | Two-step sign-in (MFA) | Supabase | 1 min | [ ] |
| 3 | Remove old accounts | Supabase | 2 min | [ ] |
| 4 | Empty old files | Supabase | 2 min | [ ] |
| 5 | New database password | Supabase | 2 min | [ ] |
| 6 | Plan and spend cap | Supabase | 3 min | [ ] |
| 7 | Backup storage (R2) | Cloudflare | 5 min | [ ] |
| 8 | Backup secrets | GitHub | 5 min | [ ] |
| 9 | Test the backup and the restore | GitHub | 15 min | [ ] |
| 10 | Protect `main` | GitHub | 2 min | [ ] |
| 11 | Dependabot | GitHub | 1 min | [ ] |
| 12 | Spending limit $0 | GitHub | 1 min | [ ] |
| 13 | 2FA on every account | All | 15 min | [ ] |

---

## Supabase

Open <https://supabase.com/dashboard> and choose the ISMS project.

### 1. Password rules

1. Go to **Authentication** → **Sign In / Providers** → **Email**. On some versions of the dashboard it is **Authentication** → **Policies** / **Password security**.
2. Set **Minimum password length** to `8`.
3. Set **Password requirements** to **Letters and digits**.
4. If the switch is offered, turn on **Prevent use of leaked passwords**. It only works on the Pro plan, so on Free leave it off.
5. Click **Save**.

**Check:** on the app's sign-up screen, try the password `abc123`. It should be refused.

### 2. Two-step sign-in (MFA)

1. Go to **Authentication** → **Multi-Factor** (or **MFA**).
2. Turn on **TOTP (App Authenticator)**.
3. Leave **Phone** off. It needs an SMS provider, which isn't set up yet.
4. Click **Save**.

**Check:** the TOTP switch shows as enabled after you reload the page.

### 3. Remove old accounts

The database reset on 2026-11-23 removed all business data. Sign-in accounts may still be listed.

1. Go to **Authentication** → **Users**.
2. For each old account, including the two test accounts that used the seed password (SEC-04/05): click **⋯** → **Delete user**.
3. If you keep an account, open it and click **Sign out user** or **Log out all sessions**. Then use **Send password recovery** to set a new password.

**Check:** the list holds only accounts you mean to keep. Signing in with an old test password fails.

### 4. Empty old files

1. Go to **Storage**.
2. Open each bucket (`business-files`, product pictures and so on).
3. Select the old files and click **Delete**. Delete the files only, never the buckets: the app needs the buckets.

**Check:** each bucket is empty, or holds only files you want to keep.

### 5. New database password

The old database password was exposed during development, so it has to be replaced.

1. Go to **Project Settings** → **Database**.
2. Click **Reset database password**, then **Generate a password**.
3. Copy it into your password manager **now**. Supabase shows it only once.
4. Click **Reset password**.
5. Tell the developer it changed, so they can update their local `.env`.

**Check:** the developer runs `npx supabase migration list --linked`. It should still connect, after one prompt for the new password.

### 6. Plan and spend cap

1. Go to **Organization** (top left) → **Billing**.
2. Note the current plan:
   - **Free:** Supabase makes **no backups you can restore**. Steps 7–9 below are then your only backup. The project also pauses after a week with no use.
   - **Pro ($25 a month):** daily backups you can restore from **Database** → **Backups**, no pausing, and the leaked-password check from step 1.
3. Before the first paying business, click **Change plan** → **Pro**.
4. On Pro, make sure **Spend cap** is **ON**. The bill then can't grow past $25; services slow down instead.
5. Write the plan and the monthly amount in [cost-management.md](../infrastructure/cost-management.md), section 1.
6. After moving to Pro, ask the developer to raise the watchdog limits:
   `UPDATE ops_watchdog_config SET db_size_limit_mb = 8192, storage_limit_mb = 102400;`

**Check:** the Billing page shows the plan you chose and "Spend cap: enabled".

---

## Backups (Cloudflare + GitHub)

Every hour, GitHub makes an encrypted copy of the whole database. It stores the copy in Cloudflare R2, which is outside Supabase, so the copy survives even if Supabase loses the project. Copies are kept like this:

| Copy | Kept for |
|------|----------|
| Hourly | 3 days |
| Daily | 35 days |
| Weekly | 6 months |
| Monthly | 13 months |

Until steps 7–8 are done, the copies are kept only inside GitHub, for a shorter time.

### 7. Backup storage (Cloudflare R2)

1. Open <https://dash.cloudflare.com>, then **R2 Object Storage**. The first time, Cloudflare asks for a card to turn R2 on. The free allowance (10 GB) covers these backups.
2. Click **Create bucket**. Name it exactly `kaykays-backups`, leave the location on **Automatic**, then click **Create**.
3. Go back to R2 → **Manage R2 API Tokens** (or **API** → **Manage API tokens**) → **Create API token**.
   - Permissions: **Object Read & Write**.
   - Specify bucket: **only** `kaykays-backups`.
   - TTL: **Forever**.
4. Click **Create**. Copy the **Access Key ID** and the **Secret Access Key** into your password manager. The secret is shown once.

**Check:** the bucket `kaykays-backups` is listed under R2. It's empty for now.

### 8. Backup secrets (GitHub)

You need two values first:

- **The connection string:** for this project it is
  `postgresql://postgres.orhryivuocsjxkwbhfni:PASSWORD@aws-0-eu-west-3.pooler.supabase.com:5432/postgres`.
  Replace `PASSWORD` with the new password from step 5. Use a password made only of letters and digits: characters like `@ : / ? # %` break the string.
  To find the string in the dashboard instead, it is either under the green **Connect** button at the top of the project page (Method: **Session pooler**) or under **Project Settings** → **Database** → **Connection string** (choose **Session pooler**). Don't use "Direct connection": GitHub can't reach it.
- **The passphrase:** make a long random phrase, for example six random words. **Keep a copy offline** (on paper in a safe place, or in your password manager's secure notes). Without it, no backup can ever be opened, not even by you.

Then on GitHub:

1. Open the ISMS repository → **Settings** → **Secrets and variables** → **Actions**.
2. Click **New repository secret** four times and add:

| Name | Value |
|------|-------|
| `SUPABASE_DB_URL` | the connection string, with the password in it |
| `BACKUP_PASSPHRASE` | the passphrase |
| `R2_ACCESS_KEY_ID` | Access Key ID from step 7 |
| `R2_SECRET_ACCESS_KEY` | Secret Access Key from step 7 |

`CLOUDFLARE_ACCOUNT_ID` is already there; it's used for the web deploys.

**Check:** the four names appear in the secrets list. GitHub never shows the values again, which is normal.

### 9. Test the backup and the restore

1. Open the repository → **Actions** → **Back up database** → **Run workflow** → **Run workflow**.
2. Wait about 2–5 minutes. It should turn **green**, and a Telegram message may arrive.
3. In Cloudflare → R2 → `kaykays-backups`, you should see a new file under `hourly/`.
4. Then go to **Actions** → **Restore drill** → **Run workflow**. This opens the newest backup into a throw-away database and checks that the tables and rows are all there. It doesn't touch live.
5. It should turn **green**.

If either run turns red, open it, click the red step, and send the developer the last lines.

From then on, the backup runs every hour and the restore drill runs every Monday by itself. A failure sends a Telegram alert.

How to restore after a real problem: [BACKUP_AND_RECOVERY.md](../BACKUP_AND_RECOVERY.md).

---

## GitHub safety

### 10. Protect `main`

1. Repository → **Settings** → **Branches** (or **Rules** → **Rulesets**) → **Add branch ruleset** / **Add rule**.
2. Branch name pattern: `main`.
3. Turn on **Block force pushes** and **Restrict deletions**.
4. Leave **Require status checks** **off** for now. It would block the developer's direct pushes. Turn it on only if you switch to pull requests.
5. Click **Create** / **Save**.

**Check:** the developer's `git push --force` to `main` is refused.

### 11. Dependabot

1. Repository → **Settings** → **Code security** (or **Code security and analysis**).
2. Click **Enable** for **Dependabot alerts** and for **Dependabot security updates**.

**Check:** within a day, any security update pull requests appear under **Pull requests**.

### 12. Spending limit $0

1. Click your GitHub profile picture → **Settings** → **Billing and plans** → **Spending limits** (or **Budgets**).
2. Set **Actions** and **Packages** to **$0**.

**Check:** the page shows the $0 limit. GitHub can then never charge for build minutes; it stops the builds instead.

---

## 13. 2FA on every account

Whoever gets into one of these accounts can take the whole system. For each one, turn on two-step sign-in with an **authenticator app** (Google Authenticator, Microsoft Authenticator, Authy or 1Password). Don't rely on SMS. Then **save the backup codes** offline.

| Account | Where |
|---------|-------|
| Supabase | Profile picture → **Account preferences** → **Multi-factor authentication** |
| GitHub | Profile picture → **Settings** → **Password and authentication** → **Two-factor authentication** |
| Cloudflare | Profile → **Authentication** → **Two-Factor Authentication** |
| Google (Gmail) | <https://myaccount.google.com/security> → **2-Step Verification** → **Authenticator** |
| Hugging Face | **Settings** → **Authentication** → **Two-factor authentication** |
| Telegram | **Settings** → **Privacy and Security** → **Two-Step Verification** (a password) |
| DreamHost | **Profile** → **Security** → **Multifactor Authentication** |

**Check:** signing in to each account on a new browser asks for the 6-digit code.

Record each account's email, 2FA method and where the backup codes are kept in [accounts-and-ownership.md](accounts-and-ownership.md). Also record the person who can reach them if you can't (OPS-05).

---

## When you finish

Tell the developer which numbers are done. They will tick the matching steps in [TO_FINISH.md](../TO_FINISH.md):

| Steps here | In TO_FINISH.md |
|------------|-----------------|
| 1–2 | SEC-03/07 |
| 3 | SEC-04/05 |
| 6 | Phase 10 step 3 |
| 7–9 | SEC-02 |
| 10 | Phase 7 step 3 and SEC-09 |
| 11 | Phase 6 step 5 |
| 12 | Phase 10 step 6 |
| 13 | Phase 10 steps 4–5 |
