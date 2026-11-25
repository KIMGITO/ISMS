# To finish

Every change that isn't fully live yet has its steps here, in order. A step marked **You:** needs the owner. The others can be run by the developer (or Claude when asked). When a step is done, tick it and add the date. When every step of an item is ticked, move it to **Done** at the bottom.

Rule: [CLAUDE.md](../CLAUDE.md) → "Finishing rule".

All the owner's account settings (Supabase passwords and MFA, backups, GitHub safety, 2FA), with click-by-click steps: [operations/owner-setup.md](operations/owner-setup.md).

---

## Debian package, console Home and Money, AI switches, delete checks (2026-11-25)

Linux: the .deb installed its program as `/usr/bin/app` with an `app.png` icon (names that clash with other packages) and had no description, licence or release notes, so Software showed nothing and warned "proprietary, may change without oversight". It now installs `/usr/bin/denso` with an AppStream file (`src-tauri/linux/com.isms.app.metainfo.xml`: summary, description, licence link, homepage, this release's notes) and the licence under `/usr/share/doc/denso/copyright`; the release fails if the .deb lacks them. The Windows .exe is now `denso.exe`. Platform console: new Home (money by month, where it comes from, growth, break-even against **Our running costs**, resources in use, busiest companies, activity), new **Money** (record payments; the paid-up date is worked out from the amount and the plan's or agreed price, never typed; payments can only be voided with a reason; approving a paid request needs its payment first; "Free" has no end date), suspend needs a reason, a bottom bar on phones. Stat tiles everywhere use Home's plain figure style. Businesses no longer set an AI provider, key or model: Settings > AI is on/off per use (assistant, insights, website, messages) plus instructions; own-key companies get their key set by the platform admin. Deleting a customer, product, supplier or expense, removing a worker, or closing a branch shows what it affects first, and the database refuses it while money is owed, wallet money or stock remains, orders or deliveries are open, someone is clocked in, or it would remove the owner or the last branch. A branch used to be hard-deleted, which wiped its sales, books and stock records; it is now closed (hidden, records kept) and nobody signed in can hard-delete one. Migrations `20261205001_platform_home_billing_ai.sql` and `20261205002_delete_impact.sql`; all 18 database suites pass; the console was checked in a browser with sample data, not with live data.

1. [ ] Apply the database changes: `bash scripts/db-push.sh`, then `bash scripts/check-live-grants.sh` (no problems listed). Existing companies keep their paid-up dates; new payments carry on from them.
2. [ ] Deploy the AI functions: `npx supabase functions deploy ai-config chat complaints customer-assistant bi-analyze area-advisor`. Settings > AI should show only switches and instructions; switching "Shop assistant on your website" off should make the website chat answer without the AI.
3. [ ] **You:** in the console, open **Our running costs** and replace the estimates with your real bills (Supabase, email, domain, your time). Home's break-even uses them.
4. [ ] **You:** check each paying company in Companies: how it pays and any agreed price. Paid-up dates typed before this change are kept (a "by hand" company with a date becomes Monthly; one with no date becomes Free). From now on record each payment under Money; its days start after the kept date.
5. [ ] Release the app (`git push`). Install the new .deb on Debian with `sudo apt install ./Denso-<version>-linux-amd64.deb`: it should install, and Software should show the description, licence link and "What's new". The menu entry should start Denso.
6. [ ] On a phone: the console shows the bottom bar (Home, Requests, Companies, Money, More); swiping a customer with debt and tapping Delete shows "Do this first" with Delete off; removing a worker who is clocked in, or closing a branch that still has stock, shows the same.
7. [ ] **You:** decide whether to buy a Windows code-signing certificate (SmartScreen says "unknown publisher" until the installer is signed) and whether to host an apt repository so Debian updates through Software (needs a signing key). Both are listed under Other devices below.

Other devices (checked 2026-11-25): Windows shows SmartScreen "Windows protected your PC" because the installer is not code-signed; Android warns "install unknown apps" for any APK outside the Play Store; Linux Software always labels paid software "Proprietary". These are expected for direct downloads; only the certificate, the Play Store or an apt repository remove them.

---

## Sign-up screens fit phones, Back works, no code for a taken email (2026-11-24)

Sign-in/Start/plan screens, the Platform console and the supplier portal scroll and stay below the status bar (they used `env()`, 0 on many Android phones, and centred tall forms off the top). Create account has "Already have an account? Sign in"; the Sign in / Create account / Join team bar always shows. Phone Back closes the console and steps back through sign-in, plans and the Start screen. Create account with an email that already has an account now says so (Supabase hid it as a stand-in user) and the old "business already has an owner" block is gone; `auth-otp` sends no sign-up code to an email already verified. Emails show the app mark drawn in HTML instead of the old KayKays logo picture. App tests pass; not tried on a phone.

1. [ ] Deploy the functions: `npx supabase functions deploy auth-otp send-email` (`config.toml` keeps auth-otp open to signed-out visitors). Create account with an email that already has an account: the form should say "This email already has an account" and no code email should arrive.
2. [ ] Create account with a new email. The code email should show an amber square with a dark "D" at the top (drawn in HTML, no picture, so it shows even with images off), not the old KayKays picture.
3. [ ] Release the app (`git push`). On an Android phone: the Start screen and plan list scroll to the top with the logo below the status bar; the Platform console header sits below the status bar; phone Back on the console returns to the app, and on Create account returns to Sign in.

---

## Retention and erasing a customer (2026-11-24)

Owner: keep records as Kenyan law demands. Money records and the audit trail 7 years (Tax Procedures Act 5, Companies Act 7); a nightly job removes notifications after 1 year, website chat after 2, crash reports after 90 days, backup run log after 1 year, audit entries after 7. Customers > profile > **Erase personal details** (`customers.erase`, Data Protection Act s.40), refused while debt or wallet money remains. Website privacy page names EU hosting, Cloudflare, the periods and erasure. Migration `20261203002_retention_and_erasure.sql`; `records/retention_erasure_test.sh` 23 passed; not clicked through in the app.

1. [ ] Apply the database change (with `20261203001` above): `bash scripts/db-push.sh`, then `bash scripts/check-live-grants.sh` (no problems listed).
2. [ ] In the SQL editor: `select jobname, schedule from cron.job where jobname = 'data-retention';` should return one row `30 0 * * *`, and `select public.run_data_retention();` should return counts, not an error.
3. [ ] Deploy the website: `npm run website:deploy`. The privacy page should say "at least seven years" and name Cloudflare.
4. [ ] Release the app (`git push`). As an owner, a customer with no debt and an empty wallet should show **Erase personal details** at the bottom of their profile; erasing a test customer should remove them from Customers while their sales stay in the Sales Log.
5. [ ] **You:** ask a data protection adviser whether the business must register with the ODPC (EXP-06). Registration is your step; the app cannot do it.

---

## Records kept, one receipt number, points in one place, owner named (2026-11-24)

Gaps G-01 to G-08 from `documentation/audit/04-outstanding-gaps-and-clarifications.md`. The audit trail is append-only; sales, stock history and points used can't be deleted (Settings > Old records clears only points earned, backup runs and crash reports); receipts show `TXN-…` everywhere; points settings only on Promotions & Points; Report a problem needs `support.report`; README, LICENSE, TERMS and the three documents name Dennis Kimanthi Gitonga, Codensons. Migration `20261203001_keep_records.sql`. All 9 database suites (incl. the new `records/keep_records_test.sh`) and the app tests pass; not clicked through in the app.

1. [ ] Apply the database change: `bash scripts/db-push.sh`, then `bash scripts/check-live-grants.sh` (no problems listed).
2. [ ] Check it on live in the SQL editor: `select count(*) from pg_trigger where tgname = 'trg_audit_logs_append_only';` should return 1, and `select count(*) from pg_policies where policyname = 'pol_transactions_delete';` should return 0.
3. [ ] Deploy the function: `npx supabase functions deploy ops-alert --no-verify-jwt`. About this app > Report a problem should still send for an owner (a Telegram message arrives).
4. [ ] Commit and release the app (`bash release.sh`). Settings > Old records should list only three logs, and a printed receipt should show `TXN-…`.
5. [x] **You:** decide how long sales are kept. (2026-11-24: owner decided sales are kept for at least 5 years, the Kenyan tax record period. Nothing is removed today, so nothing to deploy.)
6. [ ] **You:** review the three documents (each folder in `documentation/final/` has .md, .docx and .pdf), then set `status: Approved` in each front matter and rebuild: `python3 documentation/tools/build_docs.py all`.

---

## Documentation set restructured; UI fixes and wording (2026-11-24)

Three new documents in `documentation/` (User Guide ISMS-UG, Technical Documentation ISMS-TD, Administration Guide ISMS-AG), with Markdown, DOCX and PDF, re-captured screenshots, and the audit, migration map, QA report and gaps list in `documentation/audit/`. The app also has the form, receipt-settings, screen-name, wording and "ask the admin" fixes of 24 November (uncommitted).

1. [x] **You:** answer the owner decisions G-01 to G-08 (2026-11-24; G-03 approval still open; sales retention decided: at least 5 years, see the item above).
2. [ ] **You:** document owner named (2026-11-24: Dennis Kimanthi Gitonga, Codensons); still to do: set `status: Approved` and `author:` in each document's front matter and rebuild: `python3 documentation/tools/build_docs.py all`. The cover should show the owner and "Approved".
3. [ ] Deploy the three edge functions whose wording changed: `npx supabase functions deploy chat --no-verify-jwt`, then the same for `bi-analyze` and `area-advisor`. The assistant should say "ask the admin", not "ask the owner".
4. [ ] Commit the app changes and the documentation, then release (`git push`). About this app should show the new version, and the sidebar should show **Customers**, **Roles** and **Workers**.
5. [ ] Optional: a migration changing the two database messages "Ask the owner." (in `20261120001_schema.sql`) to "Ask the admin.", pushed with `bash scripts/db-push.sh`.
6. [ ] Check that every live migration text equals its file: `bash scripts/db-push.sh --check` (no `DIFFERS`), then tick the older steps above that are already live.

---

## Navigation, global search, references, deliveries (2026-11-23)

Regrouped menus, one search across sales/payments/expenses/stock/books/audit/deliveries with exact landing and highlight, EXP/STM/LOG/LDG references, copyable references, product-first deliveries. Migration `20261202001_record_refs_global_search.sql`. Details: [ISMS-TD Ch 11.13](../documentation/final/ISMS-Technical-Documentation/ISMS-TD.md). DB suite, 75 app tests and both builds pass; not clicked through in the app.

1. [ ] Apply the database change: `bash scripts/db-push.sh`, then `bash scripts/check-live-grants.sh` (no problems listed).
2. [ ] Check it on live in the SQL editor: `select ref_no from expenses order by created_at desc limit 3;` should show `EXP-2026-…`, and `select jsonb_array_length(global_search('<your business id>', 'TXN'));` should return a number, not an error.
3. [ ] Commit and release the app (`bash release.sh`).
4. [ ] **You:** in the app, search a receipt number, an `EXP-` number and a `JE-` number. Each should open its screen with that row glowing amber (the journal one opens the entry).
5. [ ] **You:** tap a reference chip (e.g. a receipt number in the Sales Log). It should show "Copied", and pasting it elsewhere gives the full number. The row itself should not open.
6. [ ] **You:** as a rider on a phone, open a delivery under Mine. Products should be listed first with quantities. Tick some, press "Mark delivered": it should ask "… items not checked" once.
7. [ ] **You:** look over the new menu groups (sidebar and the phone's More sheet) and say if anything should sit elsewhere.

---

## UI wording cleanup + update bar removed (2026-11-23)

Text-only changes across the app and website, and the top update bar removed (updates show only in About this app). Details: [ISMS-TD Ch 22.5](../documentation/final/ISMS-Technical-Documentation/ISMS-TD.md). Type checks, 73 tests and both builds pass.

1. [ ] Commit and release the app (`bash release.sh`, as usual). The new version should appear in About this app → Updates on an installed copy.
2. [ ] **You:** on the desktop app, when an update has downloaded, open About this app and press "Restart and install". The app should reopen on the new version. No bar should appear at the top while it downloads.
3. [ ] **You:** walk the tour once (My Profile → Take the tour again) on a phone and check no step is cut off.
4. [ ] **You:** decide whether to remove the "Switch offline mode" entry from search (see Outstanding in the audit doc).

---

## Quick test data: seed_quick.sql (2026-11-23)

`supabase/seed_quick.sql`: 2 branches, owner + admin, 5 riders, 5 products in both branches, 5 customers. Checked on a scratch copy of the current schema (all counts right; owner is the system creator). Logins: [supabase/SEED_LOGINS.md](../supabase/SEED_LOGINS.md).

1. [x] Loaded on live with `npx supabase db query --linked -f supabase/seed_quick.sql`, keeping the owner's account and business "KayKay's" as Main; added "KayKay's Westlands". Backup from before: `/home/dennis/isms-backups/2026-11-23-before-seed-quick/data.sql` (2026-11-23).
2. [x] `admin@kaykays.test` and `rider1@kaykays.test` sign in on live (password grant OK) (2026-11-23).
3. [ ] **You:** open the app as owner, switch between both branches: 5 products and the customers should show in each; riders should appear when assigning a delivery.
4. [ ] Before real customers use live: wipe the test data (`supabase/dev_wipe.sql`). That also removes your own account and business.

---

## Version numbers start again at 1.0.0 (2026-11-23)

The old v7.x releases and tags are removed from both repos (KIMGITO/ISMS and KIMGITO/kaykays-releases); the tag `v0.0.0` marks the restart, so the next release is exactly **1.0.0**. The website now shows the same version in its footer. Android version codes start at 20100000 (old ones were 107xxxxx), so phones update in place.

1. [x] Remove the old releases, tags and `update-manifest` branches; push the `v0.0.0` tag (2026-11-23).
2. [ ] `git push`. "Release and Deploy" should show `v0.0.0 -> v1.0.0 (major)` and publish v1.0.0 in kaykays-releases; `https://raw.githubusercontent.com/KIMGITO/kaykays-releases/update-manifest/latest.json` should say `"version": "1.0.0"`.
3. [ ] Open the website: the footer should end with `v1.0.0`. In the app, About should show 1.0.0.
4. [ ] **You:** on each Windows/Linux PC with a 7.x app, uninstall it and install 1.0.0 from the releases page (7.x won't auto-update to a lower number). Android phones update over the old app.

---

## Owner sign-up fails + v7.6 release blocked (2026-11-23)

Sign-up: the cause was the password. Live Supabase Auth needs 8+ characters with a capital, a small letter and a number; the app only checked for 6 characters and hid Supabase's message behind "check your connection". The app now checks the same rule on both sign-up forms (`src/utils/passwordRule.ts`) and shows the password message.

1. [x] Find the cause: the browser console showed `AuthWeakPasswordError` (2026-11-23).
2. [ ] Reload the app (sign out or clear the site data first, to drop the old login from before the reset), then register the owner with a password that has 8+ characters, a capital, a small letter and a number. It should go to the 6-digit code screen, and `SELECT count(*) FROM auth.users;` should return 1.
3. [x] Fix the 6 `zip` advisories (RUSTSEC-2026-0367/0368/0369/0429/0545/0548): `tauri-plugin-updater` 2.14.1 uses `zip` 9 (pinned 9.4.2). This needs Tauri 2.12, so `tauri` went 2.11.5 → 2.12.5 and npm `@tauri-apps/api` 2.12.4, `@tauri-apps/cli` 2.12.4, `@tauri-apps/plugin-updater` 2.14.1 (exact pins, every version at least two weeks old). `cargo audit` shows 0 vulnerabilities and `cargo check` + `tsc` pass on Linux (2026-11-23). The Windows build was not tried locally.
4. [ ] Commit `package.json`, `package-lock.json` and `src-tauri/Cargo.lock`, then `git push`. The "Security checks" jobs should pass and "Release and Deploy" should build Windows/Android/Linux, then tag and publish.
5. [ ] **You:** install the new release on Windows over the old one. The in-app update should download, install and restart on the new version (this is the code path that unzips with `zip` 9).

---

## Phase 10: cost, operations, final readiness (2026-11-23)

Reports: [infrastructure/cost-management.md](infrastructure/cost-management.md), [ISMS-AG Ch 13](../documentation/final/ISMS-System-Administration-Guide/ISMS-AG.md), [operations/accounts-and-ownership.md](operations/accounts-and-ownership.md), [ISMS-TD Ch 23](../documentation/final/ISMS-Technical-Documentation/ISMS-TD.md) (final status: **Not Ready**, with the list of what lifts it).

1. [ ] Push the database changes together with Phase 8 step 1 (the repair of `20261201005`, then `bash scripts/db-push.sh`). Afterwards in the SQL editor: `SELECT tablename FROM pg_publication_tables WHERE pubname = 'supabase_realtime' ORDER BY 1;` should list 26 tables including `money_assets` and not `audit_logs`; `SELECT check_key, problem FROM ops_watchdog_checks() WHERE check_key = 'storage:size';` should return one row with an empty problem.
2. [ ] Release the app (`git push`, with Phase 7/8). Then open Payments on two devices and make a cash sale on one: the Cash balance on the other should change within a few seconds without a refresh.
3. [ ] **You:** Supabase → Organization → Billing: confirm the plan. Before the first paying business, move to **Pro** with the **spend cap on** (OPS-06). Then in the SQL editor: `UPDATE ops_watchdog_config SET db_size_limit_mb = 8192, storage_limit_mb = 102400;`. Write the plan and the invoice amount in cost-management.md section 1.
4. [ ] **You:** fill in the "Owner to confirm" cells of [accounts-and-ownership.md](operations/accounts-and-ownership.md): 2FA by authenticator app and backup codes for Supabase, Cloudflare, GitHub, Google, Hugging Face, Telegram and DreamHost; the billing card and email for each; the domain's renewal date with auto-renew on.
5. [ ] **You:** name a backup person who can reach the offline copy and the accounts if you can't (OPS-05), and write down how (password manager emergency access or a sealed copy).
6. [ ] **You:** GitHub → Settings → Billing: spending limit $0 (Actions never charge). Cloudflare → Notifications: a usage-based billing alert once R2 is on (OPS-07).
7. [ ] Before ~20 businesses or any bulk customer email: move email off personal Gmail to a sending service on kaykays.com (SPF/DKIM set at the domain), then change the `SMTP_*` function secrets (OPS-04). A sign-in code should then arrive from the new address.
8. [ ] Each month: refresh the numbers with cost-management.md section 8.

## Phase 9: expansion (2026-11-23)

Report: [ISMS-TD Ch 20.4](../documentation/final/ISMS-Technical-Documentation/ISMS-TD.md). Nothing to deploy; the other findings are design work for when expansion starts.

1. [ ] **You:** ask a Kenyan data protection adviser two things (EXP-06): does ISMS need to register with the ODPC, and is the privacy policy enough for data stored in the EU (Supabase, Paris) and the processors it uses (Cloudflare, AI providers)? Then update the website's privacy page (`website/src/infoPages.ts` → `privacy`) as advised. The page should name where data is stored and every processor.
2. [x] **You:** choose how long to keep notifications and the audit log (EXP-07). (2026-11-24: owner said "as Kenyan law demands"; built, see Retention and erasure at the top.)

## Phase 8: performance (2026-11-23)

Report: [ISMS-TD Ch 20](../documentation/final/ISMS-Technical-Documentation/ISMS-TD.md). The database change and the app change are independent of each other; both are safe with old and new app versions.

1. [x] (2026-11-23: live database reset with `supabase db reset --linked`, all data wiped, every migration re-applied from the files; `db-push.sh --check` reports 30 on live and unchanged, `check-live-grants.sh` reports no problems.) **Live has an earlier draft of `20261201005`** (found in Phase 10: no REVOKE on `fn_perm_cache_gen`, no `prune-cron-history` job; the rest works). The file is safe to run twice (tested), so re-apply it: `npx supabase migration repair --status reverted 20261201005 --linked`, then `bash scripts/db-push.sh`. That push also applies Phase 10's `20261201006` and `20261201007`, and it should end with "Live now has every migration in this folder, unchanged, and its access rules are right." Then `SELECT jobname FROM cron.job WHERE jobname = 'prune-cron-history';` should return one row.
2. [ ] Release the app: `git push` (with the Phase 7 push). After the update, open the app on two devices as a cashier and sell one item on the first. On the second, that product's stock should change within about a second, and the browser's Network tab should show no new `products` request.
3. [ ] A week after step 1, in the SQL editor: `SELECT calls, round(mean_exec_time) ms FROM pg_stat_statements WHERE query LIKE '%transaction_items_1%' ORDER BY calls DESC LIMIT 3;` The sales-list averages should be well under the old 650–1,000 ms. Record the numbers in ISMS-TD Ch 20 section 1.

---

## Phase 7: release safety (2026-11-23)

Report: [deployment/release-safety.md](deployment/release-safety.md). From now on push migrations with `bash scripts/db-push.sh`, not a bare `npx supabase db push`.

1. [ ] Push `main`: `git push`. In **Actions → Release and Deploy**, the jobs *Database checks* and *Security checks* should pass (about 5 minutes for the database one). If *Database checks* fails, its log names the migration or test.
2. [ ] Before the next release is due, open a test pull request (any small change) and check *Database checks*, *Security checks* and *Type check and tests* appear on it and pass.
3. [ ] **You:** GitHub → Settings → Branches → add a rule for `main`: block force pushes and deletion. (Requiring checks too would block direct pushes; only add it if you switch to pull requests.) `git push --force` to `main` should then be refused.
4. [ ] **You (optional):** GitHub → Settings → Environments → `production-app` and `production-website` (they appear after the first deploy): add yourself as a required reviewer if you want to approve each web deploy. Delete the old Vercel environments `Production`, `Production – isms`, `Preview – isms`.
5. [ ] Staging (WEB-03, deferred): when it exists, point `.env` at it (REL-01) and rehearse **Actions → Roll back web** there.

## Phase 6: attack resistance (2026-11-23)

Report: [ISMS-AG Ch 9.5](../documentation/final/ISMS-System-Administration-Guide/ISMS-AG.md). Order matters: the new website understands both the old and the new promo check, the old website only the old one.

1. [x] Deploy the website: `npm run website:deploy`. Applying a wrong promo code in the cart should still say "We don't recognise that promo code." (2026-11-23: the live website's script has the new promo check, found in Phase 10.)
2. [x] Apply the database change: `bash scripts/db-push.sh` (it runs the checks and `check-live-grants.sh` itself). It should end with "Live now has every migration in this folder, unchanged, and its access rules are right." (2026-11-23: `20261201004` found on live, identical to the file; `check-live-grants.sh` clean.)
3. [ ] Deploy the edge functions (2026-11-23 Phase 10: all were redeployed at 11:53 Nairobi time, after the Phase 6 commit; only the `curl` check below is left, and `security_events` was still empty) (all of them share the changed `shared/` code; named one by one so the `shared` folder is never deployed as a function): `npx supabase functions deploy accept-alert ai-config airtel-callback airtel-payments alarm-sync area-advisor auth-otp backup-config bi-analyze card-payments card-webhook chat complaints customer-assistant customer-checkout kra-etims mpesa-payments mpesa-webhook ops-alert send-email send-fcm sms-config sync till-callback ussd whatsapp-config`. `config.toml` keeps the no-login ones open. `curl -s -X POST "https://<project-ref>.supabase.co/functions/v1/mpesa-webhook?token=wrong"` should answer `Forbidden`, and `SELECT kind, source FROM security_events ORDER BY id DESC LIMIT 1;` should show `bad_token | mpesa-webhook`.
4. [ ] Push `main`: `git push`. **Actions → Security checks** should pass (npm audit, cargo audit, gitleaks, guard tests). If `cargo audit` fails, update the crate it names or record why it doesn't apply.
5. [ ] **You:** GitHub → Settings → Code security: turn on *Dependabot alerts* and *Dependabot security updates*. Dependabot PRs should appear under Pull requests within a day.
6. [ ] **You (optional):** set the provider IP lists from Safaricom's and Paystack's current docs: `npx supabase secrets set MPESA_ALLOWED_IPS=... PAYSTACK_ALLOWED_IPS=...`. Then make one test payment of each; it should still complete. If it doesn't, unset the list (`npx supabase secrets unset MPESA_ALLOWED_IPS`).
7. [ ] **You:** arrange an independent penetration test before onboarding larger customers. Give the tester the report above and a staging copy, not production.

## Phase 5: monitoring and alerting (2026-11-23)

Commits `225ac53`, `a54baa2`. Report: [ISMS-AG Ch 10.3](../documentation/final/ISMS-System-Administration-Guide/ISMS-AG.md).

1. [x] Apply the database change. (2026-11-23: `20261201003` found already on live by `db-push.sh --check`, identical to the file.)
2. [ ] Deploy the function: `npx supabase functions deploy ops-alert --no-verify-jwt`.
3. [ ] Run `SELECT public.run_ops_watchdog(true);` in the SQL editor. A "Watchdog test" message should arrive in Telegram.
4. [ ] **You:** create free UptimeRobot or Better Stack monitors for the web app, the website and the health check (`https://<project-ref>.supabase.co/functions/v1/ops-alert`, keyword `"ok":true`), with both Telegram and email as contacts. Then break one on purpose once to see the alert arrive. Steps: [ISMS-TD Ch 15 and 17](../documentation/final/ISMS-Technical-Documentation/ISMS-TD.md) → Uptime monitor.
5. [ ] After a month, write the monthly availability (target 99.9%) in the Phase 5 report.

## FIN-02: one-step sale saving (2026-11-23)

Report: [ISMS-AG Ch 9.5](../documentation/final/ISMS-System-Administration-Guide/ISMS-AG.md).

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
