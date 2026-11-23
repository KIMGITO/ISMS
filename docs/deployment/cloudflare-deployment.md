# Phase 4 report: Cloudflare deployment, DNS and edge security

Session of 2026-11-23. Plan: [master checklist](../ISMS_Production_Readiness_Master_Checklist.md). The setup guide stays in [HOSTING_CLOUDFLARE.md](../HOSTING_CLOUDFLARE.md), and release, rollback and alerts in [DEPLOYMENT_AND_MONITORING.md](../DEPLOYMENT_AND_MONITORING.md). This file records what was verified and what is left.

## Contents

1. [Result](#1-result)
2. [Verified](#2-verified)
3. [Changes made](#3-changes-made)
4. [Findings](#4-findings)
5. [Deferred and owner actions](#5-deferred-and-owner-actions)
6. [Rollback in one minute](#6-rollback-in-one-minute)

## 1. Result

Production web hosting on Cloudflare works and is verified: both Workers, blue-green deploys, headers, caching, routing and rollback history. **Phase 4 is not complete:** there is no staging environment (deferred by the owner), no custom domain (kaykays.com DNS is at DreamHost), and the live Supabase Auth URL settings are unverified.

## 2. Verified

| Item | How | Result |
|---|---|---|
| Right Cloudflare product | build output, no SSR or server routes | Workers static assets, no Worker code. Pages not needed |
| Build and output | `wrangler.jsonc`, `website/wrangler.jsonc`, `scripts/deploy-web.sh` | `dist/`, `website/dist/`; `.assetsignore` written by `prepare-cloudflare.mjs` |
| SPA fallback | `curl` `/pos`, `/some/deep/route` | 200 with the app page |
| Real browser load | headless Chromium (Playwright) on both live Workers | website: 0 console errors, 0 CSP blocks, Supabase calls 200. App: 0 CSP blocks; one failing signed-out call, now fixed in code (WEB-01) |
| Repo smoke test | `scripts/smoke-test-web.mjs` | app `/`, website `/` and `/terms`: ok |
| Headers | `curl -I` | CSP, HSTS (2 years), `X-Frame-Options: DENY`, nosniff, Referrer-Policy, Permissions-Policy on both |
| Cache | headers on page, assets, images | page `max-age=0, must-revalidate`; `/assets/*` `max-age=31536000, immutable`. No private data passes through Cloudflare: all API calls go straight to Supabase |
| No files leak | `/.env`, `/wrangler.jsonc`, `/_headers` | each returns the app page (same hash as `/`), not the file |
| No secrets in the bundle | searched `dist/`; source maps | no service-role or secret key; no `.map` files are built |
| No service worker | code search | none, so nothing caches API responses on devices |
| Build variables | `deploy-web.yml` | only `VITE_*` public values; service keys never in a web build |
| Rollback ready | `wrangler versions list`; `rollback-web.yml` | 10 versions kept per Worker; workflow validates the id and checks the live site (see WEB-02) |
| Vercel removed | repo search | no config left (only `.gitignore` entries) |
| Account | wrangler, API (read-only) | Free plan; zones: two unrelated sites; Workers: `kaykays-app`, `kaykays-website` (+3 unrelated); **R2 not enabled** |

## 3. Changes made

| Commit | Change |
|---|---|
| `aee6615` | WEB-01: the app no longer asks the database for shop data before sign-in (it could only fail with 401 and log an error). |
| `ef00a35` | WEB-02: `rollback-web.yml` falls back to the workers.dev addresses, so the post-rollback live check runs even without the `APP_URL`/`WEBSITE_URL` variables. |

## 4. Findings

| ID | Sev | Finding | Status |
|---|---|---|---|
| WEB-01 | P3 | Signed-out app called `businesses` and logged a 401 error on every load | Fixed in code (next release) |
| WEB-02 | P3 | Rollback workflow skipped its live check because `APP_URL`/`WEBSITE_URL` are not set | Fixed in code |
| WEB-03 | P2 | No staging: preview URLs and tests use the live database (= SEC-08) | Deferred by owner |
| WEB-04 | P2 | R2 not enabled, so the planned backups to R2 could never upload | Owner: enable R2 (Phase 3) |
| WEB-05 | P3 | No custom domain; workers.dev answers plain HTTP with 200 (= SEC-19) | Owner: move kaykays.com DNS |
| WEB-06 | P3 | WAF and rate limiting: the Free plan only offers them on a zone (custom domain). Abuse limits today come from Supabase (Auth limits) and the edge functions' own `enforceRateLimit` | Re-assess after the domain move |
| WEB-07 | P2 | Live Supabase Auth Site URL and redirect URLs unverified (they matter for Google sign-in and email links). The keyring read needed to check them was blocked | Owner: check in the dashboard |

## 5. Deferred and owner actions

1. **Staging (WEB-03):** deferred on 2026-11-23. The proposal: a free Supabase project `kaykays-staging` in the second org, migrations only and no real data, plus `kaykays-app-staging` and `kaykays-website-staging` Workers, with CI deploying there first. A rollback rehearsal waits for it.
2. **Enable R2 (WEB-04):** Cloudflare dashboard → R2 → enable, then create bucket `kaykays-backups`. Part of the redo of Phase 3.
3. **Custom domain (WEB-05):** move kaykays.com's nameservers from DreamHost to Cloudflare (Add a site, Free plan), then uncomment the `routes` in both `wrangler.jsonc` files. Steps are in [HOSTING_CLOUDFLARE.md](../HOSTING_CLOUDFLARE.md). Afterwards: turn on Always Use HTTPS and add a rate-limit rule. Don't switch until you approve the cutover.
4. **Auth URLs (WEB-07):** Supabase → Authentication → URL Configuration. Site URL is the live app address, and the redirect list holds both workers.dev URLs (and the custom domain later). Nothing else.
5. **Optional:** set repository variables `APP_URL` and `WEBSITE_URL` to the live addresses.

## 6. Rollback in one minute

- GitHub → Actions → **Roll back web** → choose `app` or `website` → leave the version empty for the previous one → Run. It rolls back, checks the live site and posts to Telegram.
- From this machine: `npx wrangler@4.156.0 rollback -c wrangler.jsonc` (or `-c website/wrangler.jsonc`).
- A rollback changes only the web files. Database changes are not undone; see [phase-2-financial-integrity.md](../security/phase-2-financial-integrity.md#5-deployment-order) and the rollback scripts in `~/isms-backups/`.
