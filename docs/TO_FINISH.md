# To finish

Every change that isn't fully live yet has its steps here, in order. A step marked **You:** needs the owner. The others can be run by the developer (or Claude when asked). When a step is done, tick it and add the date. When every step of an item is ticked, move it to **Done** at the bottom.

Rule: [CLAUDE.md](../CLAUDE.md) → "Finishing rule".

---

## Phase 5: monitoring and alerting (2026-11-23)

Commits `225ac53`, `a54baa2`. Report: [operations/monitoring-and-alerting.md](operations/monitoring-and-alerting.md).

1. [ ] Apply the database change: `npx supabase db push`, then `bash scripts/check-live-grants.sh`. It should print "Live access rules: no problems."
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
