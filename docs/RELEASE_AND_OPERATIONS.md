# Release and Operations Guide

For whoever builds, signs and deploys KayKay's.

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
| `VITE_UNSPLASH_ACCESS_KEY`, `VITE_AI_NAME` | Optional |

## Installers

`.github/workflows/build.yml` runs type checks and tests, then builds a Windows MSI, Linux AppImage/deb and an Android APK.
Pushing a tag such as `v1.2.0` also publishes them as a GitHub Release and sets the desktop version.
Windows shows a SmartScreen warning until the MSI is signed with a code-signing certificate.

## Deploying backend changes

Order matters:

1. Confirm the notifications webhook sends the service role key or `FCM_WEBHOOK_SECRET`; `send-fcm` rejects anything else.
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
