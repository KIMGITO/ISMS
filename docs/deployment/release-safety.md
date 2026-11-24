# Phase 7: CI/CD, environments and release safety

Date: 2026-11-23. Status: **built and tested locally; the new CI runs start with the next `git push`.** Live needs nothing for this phase except the owner's GitHub settings ([TO_FINISH.md](../TO_FINISH.md) → Phase 7).

Checklist: [ISMS-TD Ch 23](../../documentation/final/ISMS-Technical-Documentation/ISMS-TD.md). Findings: [threat-register.md](../security/threat-register.md) (REL-01 to REL-03).

## 1. The pipeline after this phase

| When | What runs | A failure means |
|---|---|---|
| Pull request to `main` | `build.yml`: type check (app + website), unit tests, website build, desktop + Android builds. `db-checks.yml`. `security.yml` | The PR shows red. Telegram (build.yml) |
| Push to `main` | `release-and-deploy.yml`: version → **database checks** + **security checks** + tests and builds (Windows, Linux, Android, website) → tag and publish → web deploy → Telegram | **No tag, no release, no deploy.** Telegram names the failed job. The checks run even when no release is due ("Checks failed on main") |
| Web deploy (from a release, or by hand from `main` only) | `deploy-web.yml`: build → green upload → smoke test → switch → live check → automatic rollback | Users stay on (or go back to) the previous version |
| Every Monday | `security.yml` (new advisories), `restore-drill.yml` | Telegram |
| Migrations to live (from this machine) | `bash scripts/db-push.sh` | Nothing is pushed |

New in this phase:

- **`db-checks.yml`** ([workflow](../../.github/workflows/db-checks.yml)): `scripts/check-migrations.mjs`, then `supabase db start` (applies every migration to a fresh Supabase database the way `db push` applies them to live), then `scripts/run-db-tests.sh`: all 7 suites, 332 checks (access rules and grants, money and books, sales totals, promotions, referrals, numbers, regular orders), signed in as owner, manager, cashier and rider.
- **`scripts/run-db-tests.sh`**: builds the test database once and copies it per suite: 142 s instead of 419 s. A suite fails on a non-zero exit or any `FAIL` line. `ai_permissions_test.sh` always exited 0 before; fixed.
- **`scripts/check-migrations.mjs`**: refuses bad names, duplicate versions, a new file that sorts before one already on `main` (live would skip it), a deleted migration, and a drop / rename / type change / `TRUNCATE` without a `-- destructive-ok: <reason>` line. Warns when a file already on `main` is edited.
- **`scripts/db-push.sh`**: the only way to push migrations from now on. See section 3.
- **Release gate:** `release` now needs `db-checks` and `security` as well as the builds. `security.yml` no longer runs separately on pushes (it is called by the release run, so it doesn't run twice).
- **Deploy web** refuses to run from any branch but `main`, and each deploy is recorded under GitHub → Environments (`production-app`, `production-website`) with its address.

## 2. Checklist results

| Item | Result |
|---|---|
| Separate dev, staging and production configuration | **Partly.** Production: one Supabase project, two Cloudflare Workers, settings in GitHub secrets. Builds read only `VITE_*` values; server secrets live in Supabase function secrets. No staging (deferred by the owner, WEB-03). **Local `npm run dev` uses the live database** (REL-01) |
| Protect production branches and deploy permissions | Owner action (SEC-09, REL-02). Deploy web now only from `main` |
| Build and type checks | Already on every PR and push (`npm run lint`, `website:lint`, builds) |
| Unit and integration tests for critical flows | Unit tests (`npm test`) on every PR and release; DB integration suites now in CI |
| RLS and tenant-isolation tests | `permissions_test.sh` (grants, roles, Roles screen) and the as-role checks in every suite, now in CI. Cross-business isolation is covered by the grants check and RLS; a dedicated two-business suite is still open (checklist Phase 1, "branch-level permission tests") |
| Dependency and secret scanning | `security.yml` (Phase 6), now a release gate |
| Validate migrations before deployment | CI applies every migration to a fresh database and runs the suites; `db-push.sh` compares live with the files first |
| Backward-compatible migrations | Expand first, contract later ([ISMS-TD Ch 15 and 17](../../documentation/final/ISMS-Technical-Documentation/ISMS-TD.md) → Database and edge functions), now enforced by `check-migrations.mjs` |
| Deployment health checks and smoke tests | `smoke-test-web.mjs` before and after the switch (Phase 4); `verify-update-manifest.mjs` after each release; `ops-alert` health check (Phase 5) |
| Application rollback documented | Section 4 |
| Database recovery documented separately | Section 5 |
| Cloudflare workflows and environment separation | Verified in Phase 4; main-only guard added. One environment only (no staging) |
| Failed checks prevent release | Yes: the `release` job needs every check and build |

## 3. Putting migrations on live: `scripts/db-push.sh`

`db push` is the one deploy step CI doesn't do, and the one that caused the 2026-11-18 bug (live kept a half-written `20261130004`; `migration list` said "applied"). The script stops before pushing when:

1. a migration file has uncommitted changes;
2. `check-migrations.mjs` finds an error;
3. **live differs from the files:** Supabase keeps the text of every applied migration, and the script compares it with each file (whitespace and semicolons ignored). `DIFFERS` = live ran another text; `LIVE-ONLY` = live has a migration this folder lacks;
4. a database test fails (`SKIP_DB_TESTS=1` only when CI's Database checks passed on this commit).

Then it shows the dry run, asks for `yes`, pushes, runs `check-live-grants.sh`, and checks every file is now on live unchanged.

`bash scripts/db-push.sh --check` changes nothing. Run on 2026-11-23: 26 migrations on live, all identical to their files; `20261201004_abuse_limits` pending. (`20261201003_ops_watchdog` is already on live.)

If live `DIFFERS` on purpose (a file was fixed after it was pushed, and the fix must reach live): make the migration safe to run twice, then `npx supabase migration repair --status reverted <version> --linked` and run `db-push.sh --include-all`. Otherwise put the change in a new migration.

## 4. Application rollback

| What | How to go back | Tested |
|---|---|---|
| Web app, website | Automatic when the live check fails. By hand: **Actions → Roll back web**, or Cloudflare → Worker → Deployments → Rollback. Every version stays on Cloudflare | Version history and rollback command verified in Phase 4; a live rollback rehearsal waits for staging (WEB-03) |
| Installed apps (Windows, Linux, Android) | No rollback: the updaters refuse older versions. Fix forward: push a `fix:` commit; apps pick it up within 6 h, or at once from **About this app → Check for updates** | Release gate tested on every release |
| Edge functions | `git checkout <good commit> -- supabase/functions/<name>` then `npx supabase functions deploy <name>` (name each one, never a bare deploy) | No |

Rolling back the app **does not roll back the database.** A web rollback is safe only while the database is still backward compatible with the older app, which is what expand-first migrations guarantee.

## 5. Database recovery (separate from app rollback)

Migrations are not reversed automatically and there are no down-migrations. A bad migration is fixed with a new migration that undoes it (forward fix). Before any migration that changes or deletes data, take a manual backup (**Actions → Back up database**; needs the SEC-02 secrets).

Lost or corrupted data: [BACKUP_AND_RECOVERY.md](../BACKUP_AND_RECOVERY.md) sections 5.2 (whole database) and 5.3 (one business or a few rows). Backups don't run yet (SEC-02, Phase 3 deferred), so today the only recovery is Supabase's own daily backup on the paid plans; check what the project's plan includes.

## 6. Findings

| ID | Sev | Finding | Status |
|---|---|---|---|
| REL-01 | P2 | Local `npm run dev` uses the live database (`.env` points at the production project), so testing in dev writes real sales, stock and books | Open: needs the staging project (WEB-03), then point `.env` at it |
| REL-02 | P2 | `main` unprotected (= SEC-09): a force push can rewrite history and every push releases | Owner action |
| REL-03 | P3 | Migrations were pushed by hand with no gate; live could differ from the files unnoticed | Fixed: `db-push.sh`, `db-checks.yml` |

## 7. How this was tested

- `run-db-tests.sh` on a fresh `supabase db start` database (CLI 2.109.0, the CI version): 7 suites, 332 checks, all pass, 142 s.
- `supabase db start` with all 27 migrations: applies cleanly in ~100 s.
- `check-migrations.mjs`: against `origin/main` (0 errors); with no base it flags the real type change and view drop in `20261130007`; a test file with `DROP COLUMN`, `TRUNCATE` and an old version is refused three times.
- `db-push.sh --check` against live (read-only).
- actionlint on the changed workflows: no errors (only old shellcheck notes in unchanged steps).
- Not yet: the workflows on GitHub itself. They run on the next push.
