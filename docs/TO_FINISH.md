# To finish

Every change that isn't fully live yet has its steps here, in order. A step marked **You:** needs the owner. The others can be run by the developer (or Claude when asked). When a step is done, tick it and add the date. When every step of an item is ticked, move it to **Done** at the bottom.

Rule: [CLAUDE.md](../CLAUDE.md) → "Finishing rule".

All the owner's account settings (Supabase passwords and MFA, backups, GitHub safety, 2FA), with click-by-click steps: [operations/owner-setup.md](operations/owner-setup.md).

---

## Owner sign-up fails + v7.6 release blocked (2026-11-23)

Sign-up: the cause was the password. Live Supabase Auth needs 8+ characters with a capital, a small letter and a number; the app only checked for 6 characters and hid Supabase's message behind "check your connection". The app now checks the same rule on both sign-up forms (`src/utils/passwordRule.ts`) and shows the password message.

1. [x] Find the cause: the browser console showed `AuthWeakPasswordError` (2026-11-23).
2. [ ] Reload the app (sign out or clear the site data first, to drop the old login from before the reset), then register the owner with a password that has 8+ characters, a capital, a small letter and a number. It should go to the 6-digit code screen, and `SELECT count(*) FROM auth.users;` should return 1.
3. [ ] **You:** decide on the 6 `zip` advisories (RUSTSEC-2026-0367/0368/0369/0429/0545/0548) from `tauri-plugin-updater`. No fixed updater exists yet; the updater checks the signature before unzipping. Either accept them in `src-tauri/.cargo/audit.toml` until a fix ships, or keep releases blocked.
4. [ ] Commit the Deno test fix (`--no-config` in `security.yml`) and the `cookie`/`url` update in `Cargo.lock`, then `git push`. The "Security checks" jobs should pass and "Release and Deploy" should tag and publish.

---

## Phase 10: cost, operations, final readiness (2026-11-23)

Reports: [infrastructure/cost-management.md](infrastructure/cost-management.md), [operations/incident-response.md](operations/incident-response.md), [operations/accounts-and-ownership.md](operations/accounts-and-ownership.md), [production-readiness.md](production-readiness.md#final-readiness-assessment) (final status: **Not Ready**, with the list of what lifts it).

1. [ ] Push the database changes together with Phase 8 step 1 (the repair of `20261201005`, then `bash scripts/db-push.sh`). Afterwards in the SQL editor: `SELECT tablename FROM pg_publication_tables WHERE pubname = 'supabase_realtime' ORDER BY 1;` should list 26 tables including `money_assets` and not `audit_logs`; `SELECT check_key, problem FROM ops_watchdog_checks() WHERE check_key = 'storage:size';` should return one row with an empty problem.
2. [ ] Release the app (`git push`, with Phase 7/8). Then open Payments on two devices and make a cash sale on one: the Cash balance on the other should change within a few seconds without a refresh.
3. [ ] **You:** Supabase → Organization → Billing: confirm the plan. Before the first paying business, move to **Pro** with the **spend cap on** (OPS-06). Then in the SQL editor: `UPDATE ops_watchdog_config SET db_size_limit_mb = 8192, storage_limit_mb = 102400;`. Write the plan and the invoice amount in cost-management.md section 1.
4. [ ] **You:** fill in the "Owner to confirm" cells of [accounts-and-ownership.md](operations/accounts-and-ownership.md): 2FA by authenticator app and backup codes for Supabase, Cloudflare, GitHub, Google, Hugging Face, Telegram and DreamHost; the billing card and email for each; the domain's renewal date with auto-renew on.
5. [ ] **You:** name a backup person who can reach the offline copy and the accounts if you can't (OPS-05), and write down how (password manager emergency access or a sealed copy).
6. [ ] **You:** GitHub → Settings → Billing: spending limit $0 (Actions never charge). Cloudflare → Notifications: a usage-based billing alert once R2 is on (OPS-07).
7. [ ] Before ~20 businesses or any bulk customer email: move email off personal Gmail to a sending service on kaykays.com (SPF/DKIM set at the domain), then change the `SMTP_*` function secrets (OPS-04). A sign-in code should then arrive from the new address.
8. [ ] Each month: refresh the numbers with cost-management.md section 8.

## Phase 9: expansion (2026-11-23)

Report: [deployment/expansion.md](deployment/expansion.md). Nothing to deploy; the other findings are design work for when expansion starts.

1. [ ] **You:** ask a Kenyan data protection adviser two things (EXP-06): does ISMS need to register with the ODPC, and is the privacy policy enough for data stored in the EU (Supabase, Paris) and the processors it uses (Cloudflare, AI providers)? Then update the website's privacy page (`website/src/infoPages.ts` → `privacy`) as advised. The page should name where data is stored and every processor.
2. [ ] **You:** choose how long to keep notifications and the audit log (for example 1 year and 2 years; EXP-07). Then ask for the cleanup job and the "erase customer" tool to be built.

## Phase 8: performance (2026-11-23)

Report: [deployment/performance.md](deployment/performance.md). The database change and the app change are independent of each other; both are safe with old and new app versions.

1. [x] (2026-11-23: live database reset with `supabase db reset --linked`, all data wiped, every migration re-applied from the files; `db-push.sh --check` reports 30 on live and unchanged, `check-live-grants.sh` reports no problems.) **Live has an earlier draft of `20261201005`** (found in Phase 10: no REVOKE on `fn_perm_cache_gen`, no `prune-cron-history` job; the rest works). The file is safe to run twice (tested), so re-apply it: `npx supabase migration repair --status reverted 20261201005 --linked`, then `bash scripts/db-push.sh`. That push also applies Phase 10's `20261201006` and `20261201007`, and it should end with "Live now has every migration in this folder, unchanged, and its access rules are right." Then `SELECT jobname FROM cron.job WHERE jobname = 'prune-cron-history';` should return one row.
2. [ ] Release the app: `git push` (with the Phase 7 push). After the update, open the app on two devices as a cashier and sell one item on the first. On the second, that product's stock should change within about a second, and the browser's Network tab should show no new `products` request.
3. [ ] A week after step 1, in the SQL editor: `SELECT calls, round(mean_exec_time) ms FROM pg_stat_statements WHERE query LIKE '%transaction_items_1%' ORDER BY calls DESC LIMIT 3;` The sales-list averages should be well under the old 650–1,000 ms. Record the numbers in performance.md section 1.

---

## Phase 7: release safety (2026-11-23)

Report: [deployment/release-safety.md](deployment/release-safety.md). From now on push migrations with `bash scripts/db-push.sh`, not a bare `npx supabase db push`.

1. [ ] Push `main`: `git push`. In **Actions → Release and Deploy**, the jobs *Database checks* and *Security checks* should pass (about 5 minutes for the database one). If *Database checks* fails, its log names the migration or test.
2. [ ] Before the next release is due, open a test pull request (any small change) and check *Database checks*, *Security checks* and *Type check and tests* appear on it and pass.
3. [ ] **You:** GitHub → Settings → Branches → add a rule for `main`: block force pushes and deletion. (Requiring checks too would block direct pushes; only add it if you switch to pull requests.) `git push --force` to `main` should then be refused.
4. [ ] **You (optional):** GitHub → Settings → Environments → `production-app` and `production-website` (they appear after the first deploy): add yourself as a required reviewer if you want to approve each web deploy. Delete the old Vercel environments `Production`, `Production – isms`, `Preview – isms`.
5. [ ] Staging (WEB-03, deferred): when it exists, point `.env` at it (REL-01) and rehearse **Actions → Roll back web** there.

## Phase 6: attack resistance (2026-11-23)

Report: [security/phase-6-attack-resistance.md](security/phase-6-attack-resistance.md). Order matters: the new website understands both the old and the new promo check, the old website only the old one.

1. [x] Deploy the website: `npm run website:deploy`. Applying a wrong promo code in the cart should still say "We don't recognise that promo code." (2026-11-23: the live website's script has the new promo check, found in Phase 10.)
2. [x] Apply the database change: `bash scripts/db-push.sh` (it runs the checks and `check-live-grants.sh` itself). It should end with "Live now has every migration in this folder, unchanged, and its access rules are right." (2026-11-23: `20261201004` found on live, identical to the file; `check-live-grants.sh` clean.)
3. [ ] Deploy the edge functions (2026-11-23 Phase 10: all were redeployed at 11:53 Nairobi time, after the Phase 6 commit; only the `curl` check below is left, and `security_events` was still empty) (all of them share the changed `shared/` code; named one by one so the `shared` folder is never deployed as a function): `npx supabase functions deploy accept-alert ai-config airtel-callback airtel-payments alarm-sync area-advisor auth-otp backup-config bi-analyze card-payments card-webhook chat complaints customer-assistant customer-checkout kra-etims mpesa-payments mpesa-webhook ops-alert send-email send-fcm sms-config sync till-callback ussd whatsapp-config`. `config.toml` keeps the no-login ones open. `curl -s -X POST "https://<project-ref>.supabase.co/functions/v1/mpesa-webhook?token=wrong"` should answer `Forbidden`, and `SELECT kind, source FROM security_events ORDER BY id DESC LIMIT 1;` should show `bad_token | mpesa-webhook`.
4. [ ] Push `main`: `git push`. **Actions → Security checks** should pass (npm audit, cargo audit, gitleaks, guard tests). If `cargo audit` fails, update the crate it names or record why it doesn't apply.
5. [ ] **You:** GitHub → Settings → Code security: turn on *Dependabot alerts* and *Dependabot security updates*. Dependabot PRs should appear under Pull requests within a day.
6. [ ] **You (optional):** set the provider IP lists from Safaricom's and Paystack's current docs: `npx supabase secrets set MPESA_ALLOWED_IPS=... PAYSTACK_ALLOWED_IPS=...`. Then make one test payment of each; it should still complete. If it doesn't, unset the list (`npx supabase secrets unset MPESA_ALLOWED_IPS`).
7. [ ] **You:** arrange an independent penetration test before onboarding larger customers. Give the tester the report above and a staging copy, not production.

## Phase 5: monitoring and alerting (2026-11-23)

Commits `225ac53`, `a54baa2`. Report: [operations/monitoring-and-alerting.md](operations/monitoring-and-alerting.md).

1. [x] Apply the database change. (2026-11-23: `20261201003` found already on live by `db-push.sh --check`, identical to the file.)
2. [ ] Deploy the function: `npx supabase functions deploy ops-alert --no-verify-jwt`.
3. [ ] Run `SELECT public.run_ops_watchdog(true);` in the SQL editor. A "Watchdog test" message should arrive in Telegram.
4. [ ] **You:** create free UptimeRobot or Better Stack monitors for the web app, the website and the health check (`https://<project-ref>.supabase.co/functions/v1/ops-alert`, keyword `"ok":true`), with both Telegram and email as contacts. Then break one on purpose once to see the alert arrive. Steps: [DEPLOYMENT_AND_MONITORING.md](DEPLOYMENT_AND_MONITORING.md) → Uptime monitor.
5. [ ] After a month, write the monthly availability (target 99.9%) in the Phase 5 report.

## FIN-02: one-step sale saving (2026-11-23)

Report: [security/phase-2-financial-integrity.md](security/phase-2-financial-integrity.md).

1. [ ] **You:** test one cash sale in `npm run dev`. It should save, and appear in the Sales Log with the right total.
2. [ ] Push `main`: `git push`. The `fix:` commits release a patch version. A "vX.Y.Z is live" message should arrive in Telegram.
3. [ ] Once every device runs the new build, block direct sale inserts (new migration), then `npx supabase db push` and `bash scripts/check-live-grants.sh`.

## SEC-04 / SEC-05: test password on live

1. [ ] **You:** if you did not edit account `abb89fdf…` on 2026-11-22, reset both live passwords in Supabase → Authentication → Users. Never use the seed password on live.
2. [ ] **You:** sign out all sessions for those accounts (same screen). Signing in again with the old password should fail.

## SEC-02: backups (Phase 3, deferred)

1. [ ] **You:** in GitHub → Settings → Secrets, set `SUPABASE_DB_URL`, `BACKUP_PASSPHRASE` (keep an offline copy), `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`.
2. [ ] Run **Actions → Back up database → Run workflow**. It should pass and the backup should be in R2.
3. [ ] Run **Actions → Restore drill → Run workflow**. It should pass.

## SEC-03 / SEC-07: sign-in settings

1. [ ] **You:** in Supabase → Authentication, turn on TOTP MFA, set the password minimum to 8 with letters and digits, and turn on the leaked-password check if the plan allows it. A 6-character password should then be refused.

## SEC-09: protect main

1. [ ] **You:** in GitHub → Settings → Branches, protect `main`: require the checks to pass, no force push. A `git push --force` to `main` should then be refused.

## Phase 4: domain and sign-in addresses

1. [ ] **You:** in Supabase → Authentication → URL Configuration, check the Site URL and Redirect URLs are the live web app addresses (WEB-07). A sign-in link from an email should open the live app.
2. [ ] **You:** when ready, move kaykays.com DNS to Cloudflare (WEB-05), then add SSL and domain expiry checks in the uptime tool.

---

## Done

(nothing yet)
