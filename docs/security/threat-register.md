# Threat register

Every finding from the [production readiness plan](../ISMS_Production_Readiness_Master_Checklist.md), ranked P0 to P3. The Phase 1 report with test evidence is in [security-assessment.md](security-assessment.md), and the system map in [architecture.md](../infrastructure/architecture.md).

Statuses: **Fixed (verified)** · **Fixed in code (deploy pending)** · **Open** · **Owner action** · **Accepted**.

## Summary

| ID | Sev | Title | Status |
|---|---|---|---|
| SEC-01 | P0 | Server-only DB functions callable with the public key (any account's password, money, books, payments) | Fixed (verified on live 2026-11-23) |
| SEC-02 | P1 | No working independent backup; restore never tested on real data | Owner action |
| SEC-03 | P1 | No MFA for owner/admin accounts | Open (owner setting + app work) |
| SEC-04 | P1 | Owner's real email with test password `Admin@123` published in the public repo | Owner action |
| SEC-05 | P1 | Possible use of SEC-01 before the fix cannot be ruled out | Owner action |
| SEC-06 | P2 | `send-email` let any staff member send branded email with any subject, sender name and text, for any shop | Fixed (deployed v35, verified 2026-11-23) |
| SEC-07 | P2 | Server password minimum is 6 characters, with no other rules | Owner action (live), fixed in `config.toml` |
| SEC-08 | P2 | No staging database; preview builds use production | Open |
| SEC-09 | P2 | `main` unprotected; pushes to `main` release and deploy | Owner action |
| SEC-10 | P2 | M-Pesa STK success taken from the callback body (protected only by a URL token); callback token not set live | Open |
| SEC-11 | P2 | Old edge functions `kim-chat`, `shared` still deployed | Fixed (deleted 2026-11-23, owner approved) |
| SEC-12 | P2 | Pre-2.0.0 Android keystore still fetchable from public GitHub history by SHA | Owner action |
| SEC-13 | P2 | No secret or dependency scanning in CI | Open |
| SEC-14 | P3 | Old hard-coded DB password in Git history | Accepted (project gone) |
| SEC-15 | P3 | Callback tokens compared with `!==` (not constant-time) | Open |
| SEC-16 | P3 | Edge functions answer CORS `*` | Accepted |
| SEC-17 | P3 | anon/authenticated had TRUNCATE/TRIGGER/REFERENCES on 14 views | Fixed (verified on live) |
| SEC-18 | P3 | Unused `update_user_password_by_email` still exists | Open |
| SEC-19 | P3 | `http://` on workers.dev returns 200 instead of redirecting | Open (fix with custom domain) |
| SEC-20 | P3 | CSP has no `'wasm-unsafe-eval'`, so the web background remover may be blocked | Open (functional) |

---

## SEC-01 · P0 · Server-only database functions callable with the public key

- **Confidence:** High, confirmed on live by catalog query and by an API call.
- **Component:** Supabase Postgres, `public` schema function grants.
- **Evidence:** On live, `has_function_privilege('anon', …)` was true for 419 of 509 functions; a clean build from the migrations has 134. The extras included `update_user_password_by_email(p_email, p_new_password)` (`SECURITY DEFINER`, no check: it sets any `auth.users` password), `fn_post_money_asset`, `acc_apply`, `settle_card_payment`, `confirm_online_order_payment`, `confirm_store_payment_request`, `confirm_airtel_payment`, `otp_*`, `find_auth_user_by_phone`, `adjust_stock_bulk` and others. `scripts/check-live-grants.sh` reported 294 problems.
- **Attack scenario:** Anyone takes the publishable key from the website, calls `POST /rest/v1/rpc/update_user_password_by_email` with the owner's email, then signs in as owner. Or marks payments paid, posts to the books, or moves money balances of any business.
- **Business impact:** Full takeover of every account and every business, and forged financial records.
- **Root cause:** The live database's default privileges (`ALTER DEFAULT PRIVILEGES` for `postgres` and `supabase_admin`) grant EXECUTE on new functions to anon and authenticated. After the 2026-11-16 reset, every function was recreated and picked up those grants. The tests build a database without those defaults, so they never saw it.
- **Remediation:** Migration `20261201001_lock_function_grants.sql` puts the 285 affected functions back to clean-build grants (service_role kept), and turns off default EXECUTE and table grants for new objects.
- **Verification:** On a copy with live's grants, after the migration all 509 functions matched the clean build and all 288 DB checks passed. On live (2026-11-23): anon 134 / authenticated 353 functions; `update_user_password_by_email` refused for anon (`42501`); public website functions still return 200; `check-live-grants.sh` reports no problems.
- **Residual risk:** Signed-in screens were not clicked through on live (no test login). Rollback grants are saved at `~/isms-backups/2026-11-23-before-grant-lockdown/rollback_grants.sql`. The permanent guard is `permissions_test.sh` plus `check-live-grants.sh`, which should run after every `db push`.

## SEC-02 · P1 · No working independent backup

- **Evidence:** `backup-database.yml` failed 22 out of 22 runs: "Set these repository secrets: SUPABASE_DB_URL BACKUP_PASSPHRASE". The R2 keys are also unset. `restore-drill.yml` has never run. The Supabase plan's backups have not been confirmed.
- **Impact:** A bad migration, a deleted record or a provider incident could not be recovered from our own copy. RPO/RTO are unknown.
- **Owner action:** Set `SUPABASE_DB_URL` (session pooler), `BACKUP_PASSPHRASE` (store it offline as well), `R2_ACCESS_KEY_ID` and `R2_SECRET_ACCESS_KEY` in GitHub. Then run the workflow once by hand and the restore drill once. Also check the Supabase plan's backup/PITR settings. Phase 3 covers the rest.

## SEC-03 · P1 · No MFA for owner/admin accounts

- **Evidence:** No `auth.mfa` calls in the app or website. `[auth.mfa.totp]` is disabled in `config.toml`. Live has 0 `auth.mfa_factors`.
- **Impact:** A guessed or phished owner password gives full control of the business, including money and staff.
- **Remediation:** (1) Owner turns on TOTP MFA in Supabase Auth. (2) App: enroll/verify screens in Profile and a challenge at sign-in. (3) Later, require `aal2` for Owner/Admin in sensitive RPCs once everyone has enrolled. Not built yet, because it changes the sign-in flow and needs device testing.

## SEC-04 · P1 · Owner email + test password in the public repo

- **Evidence:** `supabase/SEED_LOGINS.md` and `supabase/seed.sql` (public repo) list the owner's real Gmail with password `Admin@123`. The live seed was wiped on 2026-11-16, but the owner signed up again.
- **Owner action:** Make sure the live owner password is not `Admin@123` (or any password used in the seed). Consider switching the seed owner to a `@kaykays.test` address.

## SEC-05 · P1 · Possible use of SEC-01 cannot be ruled out

- **Evidence:** The hole existed from about 2026-11-16 to 2026-11-23. Auth's audit log is empty, and the function bypasses Auth, so no trail would exist. One of the 2 live accounts (`abb89fdf…`) was modified at 2026-11-22 14:15 UTC, after its last sign-in on 2026-11-19. That can also be an ordinary profile change.
- **Owner action:** If you did not change that account on 2026-11-22, reset both live passwords and sign out all sessions. Check the Supabase API logs (Logs → API, last 7 days) for `rpc/update_user_password_by_email`, `rpc/fn_post_money_asset`, `rpc/acc_apply` and `rpc/settle_card_payment`. The 2 businesses hold no real customers yet, so the data impact is likely nil.

## SEC-06 · P2 · `send-email` open relay for staff

- **Evidence:** Any active member could send `type` = anything, with their own `subject`, `title`, `brandName` and `primaryColor`, to any address, and pass any `businessId` (30 per hour).
- **Impact:** Phishing sent from the business's own mail server and brand; damage to the sender's reputation.
- **Fix:** Commit `157771f`. App users can send only (a) an invitation that exists, is open, matches the address and belongs to their shop (shop name and role read from the invitation), or (b) a `customer_message` with `communication.send` in that shop. Everything else needs the service key.
- **Verification:** Local run against the seed stack, 13 cases: no login 401; custom subject 403; OTP type 403; fake code 403; wildcard code 400; real code + wrong email 403; other shop's invite 403; own invite passes; rider message 403; other shop message 403; no shop 400; manager own shop passes; service role passes.
- **Deployed** 2026-11-23 (v35, owner approved). Live check: no login → 401; anon key as bearer with OTP type → 403.

## SEC-07 · P2 · Weak server password policy

- **Evidence:** `config.toml` had `minimum_password_length = 6` and no requirements. The app screens ask for 8, but the Auth API accepts 6.
- **Fix:** `config.toml` raised to 8. **Owner action:** live dashboard → Authentication → Providers → Email: minimum 8, letters + digits; turn on leaked-password protection if the plan has it.

## SEC-08 · P2 · No staging database

- **Evidence:** One Supabase project. Cloudflare preview URLs use the production database.
- **Remediation:** Create a second Supabase project (a free tier is enough) as staging, and point preview builds at it. Phase 4/7.

## SEC-09 · P2 · `main` unprotected

- **Evidence:** `GET /branches/main/protection` → "Branch not protected". `release-and-deploy.yml` runs on pushes to `main`.
- **Owner action:** Protect `main`: require the `build.yml` checks to pass and block force pushes.

## SEC-10 · P2 · M-Pesa STK success trusted from the callback body

- **Evidence:** `mpesa-webhook` checks `?token=` against `MPESA_CALLBACK_TOKEN`, then `confirm_online_order_payment` marks the order paid. Airtel, by contrast, re-checks the status with the provider. Amount mismatches are flagged, and duplicates are ignored (`FOR UPDATE`, unique `checkout_request_id`). `MPESA_CALLBACK_TOKEN` is not set live, so every callback is refused right now.
- **Remediation:** After the callback, confirm with Daraja's STK Push Query before marking paid; set a long random token. Test against the Daraja sandbox. Phase 2.

## SEC-11 · P2 · Stale deployed functions

- **Evidence:** `kim-chat` (v14, last updated July) and `shared` are deployed but are not in the repo.
- **Done** 2026-11-23 with owner approval; 26 functions remain, all in the repo.

## SEC-12 · P2 · Old keystore in public history

- **Evidence:** The 2026-11-11 history rewrite removed it from branches, but commit `5ca840b` can still be fetched by SHA on GitHub. Its password is not public.
- **Owner action:** Ask GitHub Support to purge cached objects, or accept the risk if no shipped app was signed with that key.

## SEC-13 · P2 · No scanning in CI

- **Remediation:** Add gitleaks, `npm audit --omit=dev` and the DB test suites to `build.yml`. Phase 6/7.

## SEC-14 · P3 · Old DB password in history

- **Evidence:** `SettingsView` held `postgres.bvyzujgqyvaxqfzhwqnd` + a password until commit `f8f20f6`. That project ref is not in the Supabase account. Accepted.

## SEC-15 · P3 · Non-constant-time token compare

- `mpesa-webhook`, `till-callback` and `ussd` use `!==`. Network timing over HTTPS makes this impractical to exploit. Fix together with SEC-10.

## SEC-16 · P3 · CORS `*` on edge functions

- They authenticate with bearer tokens, not cookies, so CSRF does not apply. Accepted.

## SEC-17 · P3 · Odd view grants

- Removed by `20261201001`, verified on live.

## SEC-18 · P3 · Unused dangerous function

- `update_user_password_by_email` has no callers (`auth-otp` uses `auth.admin.updateUserById`). It is now service-only; drop it in a later migration.

## SEC-19 · P3 · No HTTP→HTTPS redirect on workers.dev

- HSTS covers browsers after their first visit. Turn on "Always Use HTTPS" when the custom domain is attached.

## SEC-20 · P3 · CSP blocks WebAssembly compile for the remote ORT wasm

- Add `'wasm-unsafe-eval'` to `script-src` once the background remover is tested in the hosted web app.
