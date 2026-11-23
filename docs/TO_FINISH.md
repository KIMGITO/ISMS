# To finish

Every change that isn't fully live yet has its steps here, in order. A step marked **You:** needs the owner. The others can be run by the developer (or Claude when asked). When a step is done, tick it and add the date. When every step of an item is ticked, move it to **Done** at the bottom.

Rule: [CLAUDE.md](../CLAUDE.md) → "Finishing rule".

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

1. [ ] Deploy the website: `npm run website:deploy`. Applying a wrong promo code in the cart should still say "We don't recognise that promo code."
2. [ ] Apply the database change: `bash scripts/db-push.sh` (it runs the checks and `check-live-grants.sh` itself). It should end with "Live now has every migration in this folder, unchanged, and its access rules are right."
3. [ ] Deploy the edge functions (all of them share the changed `shared/` code; named one by one so the `shared` folder is never deployed as a function): `npx supabase functions deploy accept-alert ai-config airtel-callback airtel-payments alarm-sync area-advisor auth-otp backup-config bi-analyze card-payments card-webhook chat complaints customer-assistant customer-checkout kra-etims mpesa-payments mpesa-webhook ops-alert send-email send-fcm sms-config sync till-callback ussd whatsapp-config`. `config.toml` keeps the no-login ones open. `curl -s -X POST "https://<project-ref>.supabase.co/functions/v1/mpesa-webhook?token=wrong"` should answer `Forbidden`, and `SELECT kind, source FROM security_events ORDER BY id DESC LIMIT 1;` should show `bad_token | mpesa-webhook`.
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
