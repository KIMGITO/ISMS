# Provider accounts, ownership and recovery

Phase 10, 2026-11-23. Who owns each account ISMS depends on, how to get back in, and where the bills go. **No passwords, recovery codes or keys belong in this file**: they live in the password manager and the offline copy (L4 in [BACKUP_AND_RECOVERY.md](../BACKUP_AND_RECOVERY.md)). Related: [ISMS-AG Ch 13](../../documentation/final/ISMS-System-Administration-Guide/ISMS-AG.md), [cost-management.md](../infrastructure/cost-management.md).

## 1. Accounts

"Owner to confirm" cells can only be filled from the provider's own settings pages. Fill them in, then tick step 1 of Phase 10 in [TO_FINISH.md](../TO_FINISH.md).

| Provider | Account / identifier | What depends on it | Signs in with | 2FA | Billing contact / card | Recovery route |
|---|---|---|---|---|---|---|
| Supabase | Organization `vlukymnpwpupxwlwuspu`, project `kaykays` (ref `orhryivuocsjxkwbhfni`, eu-west-3) | Everything: data, sign-in, files, functions | Owner to confirm (GitHub or email login) | Owner to confirm | Owner to confirm | Login provider's recovery, then Supabase support (dashboard → Support) |
| Cloudflare | Account of `kimanthidennis02` (Workers on `kimanthidennis02.workers.dev`) | Web app, website, future backups (R2), future DNS | Owner's email | Owner to confirm | Owner to confirm | Email reset + 2FA backup codes |
| GitHub | `KIMGITO/ISMS` (owner), `kaykays-releases` (public updates); deploys as `lioDenson` | Code, CI, releases, app auto-update, Actions secrets | Owner to confirm | Owner to confirm | Free plan | 2FA recovery codes; GitHub support |
| Google (Gmail) | Personal account used for SMTP | Sign-in codes, invitations, customer email | Owner's Google account | Owner to confirm | — | Google account recovery (phone, backup codes) |
| Google Firebase | Project holding `FIREBASE_SERVICE_ACCOUNT` and `GOOGLE_SERVICES_JSON` | Push notifications and alarms | Same Google account (owner to confirm) | As Google | Spark (free) | As Google |
| Hugging Face | Accounts behind `HF_TOKEN_A` / `HF_TOKEN_B` | Shared AI assistant | Owner to confirm | Owner to confirm | Free | Email reset |
| Telegram | Bot `@kaykays_alerts_bot` and the alerts chat | Every ops alert | Owner's Telegram (BotFather) | Telegram cloud password: owner to confirm | — | Telegram phone login; a new bot token from BotFather |
| DreamHost | Registrar for `kaykays.com` | Website domain, any domain email | Owner to confirm | Owner to confirm | Owner to confirm, renewal date: owner to confirm | Registrar support; keep auto-renew on |
| Android signing | `my-release.keystore` (post-2.0.0 key) | Every Android update: lose it and installed phones can't update | — | — | — | Offline copy only. There is no other recovery |
| Tauri updater key | `TAURI_SIGNING_PRIVATE_KEY` | Every desktop update | — | — | — | Offline copy only |
| Backups passphrase | `BACKUP_PASSPHRASE` (once set) | Opening any backup | — | — | — | Offline copy only. Without it, backups are useless |
| Unsplash | Developer app (`VITE_UNSPLASH_ACCESS_KEY`) | Picture search only | Owner to confirm | — | Free | Replace the key |

Per-business accounts (M-Pesa Daraja, Airtel, Paystack, KRA eTIMS, Africa's Talking, WhatsApp, Twilio, own AI keys) belong to each business, not to ISMS. Each business owner keeps their own recovery for those.

## 2. Rules

1. **Two ways in for every account above.** 2FA by an authenticator app (not SMS where the provider allows it), and backup codes in the password manager and the offline copy.
2. **One person holds everything today** (the developer is also the platform owner). Name a second trusted person who can reach the offline copy if the owner is unreachable for days, and write the arrangement down (sealed envelope, lawyer, or password-manager emergency access). Until then, a lost phone plus a lost laptop can lock ISMS out of its own accounts (OPS-05).
3. **Billing on a card that won't expire unnoticed**, with the billing email read by the owner. A failed Supabase payment ends in a paused project.
4. **Keys that have no recovery** (Android keystore, Tauri key, backup passphrase) exist in at least two offline places. Check them on the monthly offline-copy day ([BACKUP_AND_RECOVERY.md](../BACKUP_AND_RECOVERY.md) section 4.3).
5. When someone leaves or a device is lost: change that account's password, sign out its sessions, and rotate any token it held (section 3 of [ISMS-AG Ch 13](../../documentation/final/ISMS-System-Administration-Guide/ISMS-AG.md)).
