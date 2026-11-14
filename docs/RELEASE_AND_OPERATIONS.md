# Release and Operations Guide

For whoever builds, signs and deploys KayKay's.

See also [DEPLOYMENT_AND_MONITORING.md](DEPLOYMENT_AND_MONITORING.md) (blue-green web deploys, Slack alerts, problem reports, incidents) and [BACKUP_AND_RECOVERY.md](BACKUP_AND_RECOVERY.md) (backup plan and restores).

## Android signing

The release key lives outside the repository, in `~/.config/kaykays-signing/`:

- `kaykays-release.jks`: the signing key
- `credentials.env`: its path, alias and password

**Back this folder up somewhere safe and offline.** If it is lost, installed apps can no longer be updated.

To build a signed APK locally:

```bash
set -a; . ~/.config/kaykays-signing/credentials.env; set +a
npm run build && npx cap sync android
cd android && ./gradlew assembleRelease
```

The APK is written to `android/app/build/outputs/apk/release/app-release.apk`.

## GitHub repository secrets

| Secret | Value |
|---|---|
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` | From the Supabase project |
| `ANDROID_KEYSTORE_BASE64` | Output of `base64 -w0 ~/.config/kaykays-signing/kaykays-release.jks` |
| `ANDROID_KEYSTORE_ALIAS`, `ANDROID_KEYSTORE_PASSWORD` | From `credentials.env` |
| `GOOGLE_SERVICES_JSON` | Contents of `android/app/google-services.json` |
| `TAURI_SIGNING_PRIVATE_KEY` | Contents of `~/.tauri/kaykays-updater.key` (signs desktop updates) |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | Contents of `~/.tauri/kaykays-updater.password` |
| `VITE_UNSPLASH_ACCESS_KEY`, `VITE_AI_NAME` | Optional |
| `SLACK_WEBHOOK_URL` | Slack incoming webhook for alerts (DEPLOYMENT_AND_MONITORING.md) |
| `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` | Blue-green web deploys to Cloudflare (HOSTING_CLOUDFLARE.md) |
| `VITE_SITE_URL`, `VITE_WEBSITE_SLUG` | Website build: its public address and storefront slug (HOSTING_CLOUDFLARE.md) |
| `SUPABASE_DB_URL`, `BACKUP_PASSPHRASE` | Nightly database backup (BACKUP_AND_RECOVERY.md) |
| `RELEASE_TOKEN` | Optional. Only if a ruleset stops the built-in token pushing tags: a fine-grained token for this repository with Contents read and write |

To set the updater secrets from this machine:

```bash
gh secret set TAURI_SIGNING_PRIVATE_KEY < ~/.tauri/kaykays-updater.key
gh secret set TAURI_SIGNING_PRIVATE_KEY_PASSWORD < ~/.tauri/kaykays-updater.password
```

**Back up `~/.tauri/` with the Android key.** Its public half is in `src-tauri/tauri.conf.json`. If the private key is lost, installed desktop apps refuse every future update and must be reinstalled by hand.

## Releases

`.github/workflows/release-and-deploy.yml` runs on every push to `main`:

1. It works out the version from the commits since the last tag (`scripts/release-version.mjs`; preview with `node scripts/release-version.mjs`).
   `feat!:`/`fix!:` or `BREAKING CHANGE` is major, `feat:` minor, `fix:`/`perf:`/`refactor:` patch. Anything else releases nothing.
2. It runs the type check and tests on Windows, then builds Windows (`.exe` and signed `.msi`), Linux (signed AppImage and `.deb`) and Android (signed APK).
3. Only if all of that passed, it pushes the tag and publishes the GitHub Release with `latest.json`, also pushes `latest.json` to the `update-manifest` branch, and then downloads it and every installer the way apps do (`scripts/verify-update-manifest.mjs`). If that check fails, the run fails. A re-run after a half-finished release continues where it stopped.
4. It deploys the staff web app and the website to Cloudflare, blue-green (`deploy-web.yml`), and posts the result to Slack.

`.github/workflows/build.yml` checks pull requests (all platforms, without update signing) and builds the APK on each push to `main`. It never publishes.

Windows shows a SmartScreen warning until the MSI is signed with a code-signing certificate.

## Automatic updates

Installed apps check for `latest.json` 15 seconds after start, when the connection comes back, and every 6 hours. They try these sources in order (`MANIFEST_SOURCES` in `src/core/native/updateManifest.ts`, the same list as `plugins.updater.endpoints` in `src-tauri/tauri.conf.json`):

1. `https://raw.githubusercontent.com/KIMGITO/kaykays-releases/update-manifest/latest.json`
2. `https://cdn.jsdelivr.net/gh/KIMGITO/kaykays-releases@update-manifest/latest.json`
3. `https://github.com/KIMGITO/kaykays-releases/releases/latest/download/latest.json` (lags behind new releases and sometimes answers 504)
4. The same `update-manifest` and release links in `KIMGITO/ISMS`, the old home, for apps built before the move. They stop answering once `ISMS` is private.

`kaykays-releases` is a public repo with only installers and `latest.json`, so the code repo can be private. CI publishes there when the Actions variable `RELEASES_REPO` is set; see `docs/GOING_PRIVATE.md`.

GitHub's temporary errors (502/504, timeouts, dropped downloads) are retried. A background check that still fails says nothing and tries again in 30 minutes. Every failure shows one standard message with a code (Settings → About shows the code), listed in `src/core/native/updateErrors.ts`:

| Code | Meaning |
|---|---|
| `OFFLINE` | No connection |
| `SERVER_UNAVAILABLE` | GitHub answered 5xx or every source failed (temporary) |
| `NETWORK` | Connection dropped or timed out (temporary) |
| `BAD_MANIFEST` | `latest.json` missing or invalid (temporary) |
| `DOWNLOAD_FAILED` / `CORRUPT_DOWNLOAD` | Installer download broke or didn't match its SHA-256 (temporary) |
| `BAD_SIGNATURE` | Desktop update signature didn't verify |
| `SIGNATURE_MISMATCH` / `NOT_NEWER` / `BAD_APK` | This APK can never install over the app; it isn't downloaded again |
| `NEEDS_PERMISSION` | Android needs "install unknown apps" allowed |
| `INSTALL_FAILED` / `UNKNOWN` | Anything else |

When there is a newer version, a green bar shows at the top while it downloads.

- **Windows and Linux AppImage:** the update is checked against the signing key, then the app restarts after a 15-second countdown. It never restarts while a sale has items; staff can press Later. The `.deb` does not update itself.
- **Android:** the APK is downloaded and checked against its SHA-256, then Android's installer opens. Android always asks to confirm, and the first time asks to allow installs from KayKay's. Releases use version code 10,000,000 + the version (1.1.0 is 10,001,000), above any local build's timestamp code, so they always upgrade.

If an update fails, a red bar says so, and **About this app** (in More on phones, in the sidebar and Profile on desktop) has **Check for updates**. The repository must stay public, or the apps can't download releases.

## Deploying backend changes

Order matters:

1. Confirm the Vault secret `fcm_webhook_secret` (or `service_role_key`) matches `FCM_WEBHOOK_SECRET` (or the service role key) in the function secrets; `send-fcm` rejects anything else. The push trigger sends it.
2. Deploy edge functions, including `auth-otp`.
3. Apply the migrations.
4. Release the app. Older installs lose signup and password reset after step 3.

## Scheduled jobs

`20261105012_scheduled_jobs.sql` enables `pg_cron` and `pg_net` and registers three jobs: schedule reminders every 15 minutes, the customer portal job daily, and `run-due-backups` hourly.

Backups only start once these two Vault secrets exist. Run this in the Supabase SQL editor, using the legacy JWT service role key because `backup-config` checks for a JWT:

```sql
SELECT vault.create_secret('https://<project-ref>.supabase.co', 'project_url');
SELECT vault.create_secret('<service-role-key>', 'service_role_key');
```

Each business chooses its schedule in Settings. Times are Nairobi time. Runs appear in the backup history as `auto`.

## Rate limits

Enforced by `enforceRateLimit` in `supabase/functions/shared/cors.ts`.

| Action | Limit |
|---|---|
| AI (chat, complaints, BI) | 20 per minute per person, 500 per day per business |
| Sign-in codes | 30 per 10 minutes per IP, 15 per hour per email, 5 wrong guesses per code |
| Email | 30 per hour per person |
| SMS | 200 per hour per person, 1000 per day per business |

## Crash reports

Crashes go to the `crash_reports` table through `src/services/crashReporter.ts`. Emails, phone numbers, IDs and tokens are removed first, and identical crashes are counted rather than stored again. Owners and admins can read their own business's reports.

## Quick Sale keyboard shortcuts

| Key | Action |
|---|---|
| Type or scan, then Enter | Add the product (an exact SKU match wins) |
| Up / Down | Move through search results |
| + / - | Change the last item's quantity |
| F1 / F2 / F3 | Finish the sale by Cash / M-Pesa / Card |
| Esc | Clear the search, then the sale |

## Bluetooth printers (Android)

Pair the printer once in Android Bluetooth settings. It then appears under printer settings in the app. The connection is implemented in `android/app/src/main/java/com/kaykays/app/BluetoothSerialPlugin.java`.
