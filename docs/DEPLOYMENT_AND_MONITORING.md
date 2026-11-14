# Deployment, Alerts and Incidents

How KayKay's goes live without downtime, how the developer hears about problems, and what to do when something breaks. Backups are in [BACKUP_AND_RECOVERY.md](BACKUP_AND_RECOVERY.md). Signing keys and app updates are in [RELEASE_AND_OPERATIONS.md](RELEASE_AND_OPERATIONS.md).

## 1. How a release goes live

```
push to main
  └─ release-and-deploy.yml
       1. version         work out the version from the commits (none → stop quietly)
       2. builds          tests + Windows, Linux, Android, website, in parallel
       3. release         tag, GitHub Release, latest.json, check that apps can update
       4. deploy-web      blue-green for the staff web app and the website (deploy-web.yml)
       5. notify          Slack: "vX.Y.Z is live", or what failed
```

Nothing reaches users until every test and build has passed. A failure in steps 1–2 releases nothing.

### Web app and website: blue-green on Cloudflare

Both are Cloudflare Workers ("kaykays-app" for the staff web app, "kaykays-website" for the shop), deployed by `deploy-web.yml`, which runs `scripts/deploy-web.sh`. Full details and setup: [HOSTING_CLOUDFLARE.md](HOSTING_CLOUDFLARE.md).

| Step | What happens | If it fails |
|---|---|---|
| Build | `npm run build` / `npm run website:build` in CI, then `prepare-cloudflare.mjs` checks Cloudflare's limits | Nothing changed |
| Remember blue | The version taking all traffic now | — |
| Upload green | `wrangler versions upload`: the new version with its own preview URL and **no traffic** | Nothing changed |
| Check green | `scripts/smoke-test-web.mjs`: pages answer, have the app's root, every script and stylesheet loads. The website also checks `/terms` and `/privacy` | Nothing changed. Slack: "never went live" |
| Switch | `wrangler versions deploy <green>@100%`: all traffic moves in one step | Blue keeps serving |
| Check live | The same check against the live address | Traffic goes straight back to blue. Slack: "rolled back" |

Every version stays on Cloudflare. To go back by hand: **Actions → Roll back web → Run workflow** (`rollback-web.yml`), or Cloudflare → Workers & Pages → the Worker → Deployments → Rollback. The next release still goes live normally.

To redeploy the web without a release: **Actions → Deploy web (blue-green) → Run workflow**, or `npm run app:deploy` / `npm run website:deploy` from this machine.

Nothing else deploys to the Workers, so no build reaches users without passing the checks.

### Installed apps (Windows, Linux, Android)

These can't be blue-green in the same way. Android and the desktop updater refuse to install an older version, so **there is no rollback for installed apps, only fixing forward**. What protects them:

- Installers are published only after all builds pass, uploaded as a draft and published in one step.
- Apps switch to the new version only when `latest.json` on the `update-manifest` branch changes, and CI downloads it the way apps do before the run passes.
- Desktop apps never restart while a sale has items. Android always asks before installing.

If a release is bad, push a `fix:` commit. It is released and picked up by apps within 6 hours, or at once from **About this app → Check for updates**.

### Database and edge functions

Supabase has one live database, so changes there can't be switched like the web. Keep every change backward compatible so the old and new app versions both work during the switch:

1. **Expand first.** Add columns, tables and functions; don't rename or drop them in the same release. New columns are nullable or have a default.
2. Deploy edge functions before the app that needs them. A function must still accept what the previous app version sends.
3. Apply migrations before releasing the app that uses them.
4. **Contract later.** Drop old columns only after every device is on a version that no longer uses them (`SELECT app_version, MAX(last_seen_at) FROM crash_reports GROUP BY 1` gives a rough picture).
5. Take a manual backup before any migration that changes or deletes data: **Actions → Back up database → Run workflow**.

## 2. Alerts in Slack

| What | Sent by | When |
|---|---|---|
| Release live | release-and-deploy.yml | Each successful release |
| Release, build or test failed | release-and-deploy.yml, build.yml | Any failure, including pull requests |
| Web deploy failed / rolled back | deploy-web.yml, rollback-web.yml | A failed check, or any rollback |
| Database backup failed | backup-database.yml | A failed or suspicious nightly backup |
| New crash | `ops-alert` function, from the `crash_reports` trigger | First time a crash is seen, then at 10, 100 and 1000 occurrences (at most 30 an hour) |
| Problem report | `ops-alert` function | An owner or admin uses **Report a problem** |
| Site or database down | Uptime monitor (setup below) | Within 5 minutes of going down, and when it is back |

### Problem reports from admins

Owners and admins open **About this app → Report a problem**, choose how bad it is ("We can't work", "Something is wrong", "Small issue or idea"), and describe it. The report:

- is saved in `problem_reports` first, so it isn't lost if Slack is down (`slack_sent` says whether Slack got it);
- is posted to Slack with the business, the reporter's name and role, the app version, platform and screen;
- has emails, phone numbers, IDs and tokens removed on the device first, like crash reports;
- gives the admin a reference such as `PR-4F2A9C` to quote when following up.

Other staff ask their owner or admin to report for them. Limit: 10 reports an hour per person.

To see open reports, in the Supabase SQL editor:

```sql
SELECT reference, severity, summary, created_at, slack_sent
FROM problem_reports WHERE status <> 'resolved' ORDER BY created_at DESC;

UPDATE problem_reports SET status = 'resolved', resolved_at = NOW() WHERE reference = 'PR-XXXXXX';
```

## 3. Setup (once)

### Slack

1. In Slack, create a channel such as `#kaykays-alerts`.
2. Go to <https://api.slack.com/apps> → **Create New App** → From scratch → pick the workspace.
3. **Incoming Webhooks** → turn on → **Add New Webhook to Workspace** → choose the channel → copy the URL.
4. Store it in both places (it is the same URL):
   ```bash
   gh secret set SLACK_WEBHOOK_URL                               # for GitHub Actions
   npx supabase secrets set SLACK_WEBHOOK_URL=<the url>          # for ops-alert
   ```
5. Keep the URL private. Anyone with it can post to the channel. If it leaks, delete the webhook in Slack and make a new one.

### Cloudflare (blue-green deploys)

Secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`, variables `APP_URL` and `WEBSITE_URL`, plus the build settings that used to live on Vercel. Step by step: [HOSTING_CLOUDFLARE.md](HOSTING_CLOUDFLARE.md) section 3.

Until the Cloudflare secrets are set, every release reports **deploy-web failed** in Slack, which is true: the web isn't being deployed.

### Backend

1. Deploy the function: `npx supabase functions deploy ops-alert`.
2. Apply `supabase/migrations/20261114001_problem_reports_ops_alerts.sql`.
3. Crash alerts use the Vault secrets `project_url` and `service_role_key`, the same ones the scheduled backups need (see RELEASE_AND_OPERATIONS.md → Scheduled jobs).
4. Test it:
   ```bash
   curl -s https://<project-ref>.supabase.co/functions/v1/ops-alert            # {"ok":true,...}
   curl -s -X POST https://<project-ref>.supabase.co/functions/v1/ops-alert \
     -H "Authorization: Bearer <service-role-key>" -H "Content-Type: application/json" \
     -d '{"action":"test"}'                                                     # a message in Slack
   ```

### Uptime monitor

GitHub Actions can't watch the site every few minutes within the free 2,000 minutes, and a monitor should not live on the same systems it watches. Use a free outside monitor such as UptimeRobot or Better Stack:

1. Create HTTP monitors, every 5 minutes, for:
   - the staff web app (`APP_URL`), expecting 200;
   - the website (`WEBSITE_URL`) and `WEBSITE_URL/terms`, expecting 200;
   - `https://<project-ref>.supabase.co/functions/v1/ops-alert`, expecting 200 and the keyword `"ok":true`. This one also fails if the database or edge functions are down.
2. Add Slack as the alert contact (both tools have a Slack integration, or use the same webhook URL).
3. Optional: a public status page from the same tool, linked from the website's help page, so owners can check before calling.

## 4. When something breaks

### How bad is it?

| Level | Examples | Respond |
|---|---|---|
| **P1: can't trade** | Sales can't be saved, sign-in fails for everyone, M-Pesa payments not arriving, database down | Now. Roll back the web, tell owners |
| **P2: something is wrong** | One feature broken, a report wrong, receipts not printing | Same day |
| **P3: small** | Wording, layout, ideas | Next release |

Problem reports marked "We can't work" are P1 until shown otherwise.

### First 15 minutes

1. **Is it everyone?** Check the uptime monitor and the Supabase status page (status.supabase.com) and Cloudflare status (cloudflarestatus.com). If the provider is down, there is nothing to roll back. Tell owners and wait.
2. **Did a release just go out?** If the web broke after a deploy, run **Roll back web**. If the database broke after a migration, see BACKUP_AND_RECOVERY.md section 5.
3. **Tell owners.** Sales keep working offline and sync when the connection returns, but credit sales, payments and messages need a connection. Tell them which.
4. **Fix forward** with a `fix:` commit. The pipeline tests it, releases it and checks it before it goes live.
5. **Afterwards**, write three lines in the problem report or a note: what broke, why, what stops it happening again.
