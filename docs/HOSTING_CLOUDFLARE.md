# Hosting on Cloudflare

The staff web app and the customer website are hosted on Cloudflare Workers (static assets). They used to be on Vercel. This guide covers what runs where, the one-time setup, moving over from Vercel, and day-to-day deploys and rollbacks. Alerts and incidents are in [ISMS-TD Ch 15 and 17](../documentation/final/ISMS-Technical-Documentation/ISMS-TD.md).

## 1. What runs where

| Part | Where | Config |
|---|---|---|
| Staff web app (the same build the desktop apps use) | Cloudflare Worker **`kaykays-app`** | [`wrangler.jsonc`](../wrangler.jsonc), headers in [`public/_headers`](../public/_headers) |
| Customer website (shop, prerendered product and policy pages) | Cloudflare Worker **`kaykays-website`** | [`website/wrangler.jsonc`](../website/wrangler.jsonc), headers in [`website/public/_headers`](../website/public/_headers) |
| Database, sign-in, edge functions, logo storage | Supabase (unchanged) | `supabase/` |
| Windows, Linux and Android installers, `latest.json` | GitHub Releases in `KIMGITO/kaykays-releases` (unchanged) | release-and-deploy.yml |
| Background remover's 26 MB WebGPU runtime (web app only) | jsDelivr, at the exact bundled version | `src/services/backgroundRemoval.worker.ts` |

Both Workers are static files only: no server code runs on Cloudflare. Any path that isn't a file gets `index.html` (`not_found_handling: "single-page-application"`), and `/terms` serves `terms/index.html`.

**Why Workers and not Pages:** Workers keep every uploaded version, give each one its own preview URL, and switch traffic between versions in one step. That is exactly blue-green: upload, check, switch, and switch back if needed.

**Why the runtime comes from jsDelivr:** Cloudflare takes at most 25 MiB per file, and the onnxruntime WebGPU build is 26 MB (every WebGPU variant is over the limit). The web build (`VITE_ORT_WASM_FROM_CDN=1`) loads just that `.wasm` from `cdn.jsdelivr.net/npm/onnxruntime-web@<bundled version>`. The Android and desktop apps still carry their own copy and work offline. `scripts/prepare-cloudflare.mjs` leaves the file out of the upload and stops the deploy if any other file grows past the limit.

## 2. The files

| File | Does |
|---|---|
| `wrangler.jsonc`, `website/wrangler.jsonc` | Worker name, assets folder, SPA fallback, workers.dev and preview URLs, custom domains (commented out until set up) |
| `public/_headers`, `website/public/_headers` | Security headers (CSP, HSTS, frame and referrer rules) and long caching for `/assets/*`. Vite copies them into the build |
| `scripts/prepare-cloudflare.mjs` | Writes `.assetsignore`, checks the file-size and file-count limits and that `index.html` and `_headers` are there |
| `scripts/deploy-web.sh` | The blue-green deploy (section 4). Used by CI and by hand |
| `scripts/smoke-test-web.mjs` | Checks a URL: pages answer, the app's root is there, every script and stylesheet loads |
| `.github/workflows/deploy-web.yml` | Runs the deploy for both sites after each release, or by hand |
| `.github/workflows/rollback-web.yml` | Returns a site to an earlier version |

## 3. One-time setup

### 3.1 Cloudflare account

1. Sign up at dash.cloudflare.com (the free plan is enough: static asset requests are free and unlimited).
2. **Workers & Pages** → pick your **workers.dev subdomain**, e.g. `kaykays`. The sites will first be at `kaykays-app.kaykays.workers.dev` and `kaykays-website.kaykays.workers.dev`.
3. Copy your **Account ID** (Workers & Pages overview, right-hand side).
4. **My Profile → API Tokens → Create Token → "Edit Cloudflare Workers"** template. Account: yours. Zone: your domain once it's on Cloudflare (needed for custom domains), or "All zones". Copy the token.

### 3.2 GitHub

```bash
gh secret set CLOUDFLARE_API_TOKEN
gh secret set CLOUDFLARE_ACCOUNT_ID
```

The builds now happen in CI rather than on Vercel, so every build setting Vercel held must exist in GitHub. Open each Vercel project → Settings → Environment Variables and check:

| Setting | GitHub | Used by |
|---|---|---|
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` | secrets (already set for the apps) | both |
| `VITE_AI_NAME`, `VITE_UNSPLASH_ACCESS_KEY` | secrets (already set) | app |
| `VITE_SITE_URL` | secret: the website's public address, e.g. `https://kaykays.com`. Without it the website asks search engines not to index it | website |
| `VITE_WEBSITE_SLUG` | secret (defaults to `kaykays`) | website |
| `VITE_AUTH_PROVIDERS` | **variable**, if it was set on Vercel | app |
| `APP_URL`, `WEBSITE_URL` | **variables**: the live addresses checked after each switch. Empty = the workers.dev address | deploy, rollback |

Then delete the old `VERCEL_*` secrets (Settings → Secrets and variables → Actions).

### 3.3 First deploy

From this machine (once: `npx wrangler login`, which opens the browser):

```bash
npm run app:deploy        # bash scripts/deploy-web.sh app
npm run website:deploy    # bash scripts/deploy-web.sh website
```

Or **Actions → Deploy web (blue-green) → Run workflow**. The first deploy of each Worker creates it and goes straight live, because there is no previous version to keep. It prints the workers.dev address. Open both and sign in, place a test order, and open `/terms`.

The settings `workers_dev` and `preview_urls` in the config turn both on. If a later deploy says "No preview URL", check Workers & Pages → the Worker → Settings → Domains & Routes that **workers.dev** and **Preview URLs** are enabled.

### 3.4 Supabase sign-in addresses

Supabase only sends people back to addresses it knows. Supabase → **Authentication → URL Configuration**:

- **Site URL:** the website's address.
- **Redirect URLs:** add both new addresses with `/**`, e.g. `https://kaykays-app.kaykays.workers.dev/**`, `https://kaykays.com/**`. Keep the Vercel ones until Vercel is switched off, then remove them.

Without this, Google sign-in and password-reset links land on the wrong site or fail. Card payments need no change: Paystack sends customers back to the site that started the payment. If you set a callback URL in the Paystack dashboard, update it.

### 3.5 Your own domain

1. Cloudflare → **Add a domain** → `kaykays.com` → free plan. At your registrar, change the nameservers to the two Cloudflare gives you. It can take up to 24 hours; Cloudflare emails when it's active. (Moving DNS also moves any email records: check the MX records it imported before you switch.)
2. Uncomment `routes` in the configs, for example the website:
   ```jsonc
   "routes": [
     { "pattern": "kaykays.com", "custom_domain": true },
     { "pattern": "www.kaykays.com", "custom_domain": true }
   ]
   ```
   and the app (`app.kaykays.com`). Cloudflare creates the DNS records and certificates itself.
3. Routes are applied by a full deploy, not by the version uploads blue-green uses, so apply them once:
   ```bash
   npx wrangler@4.156.0 deploy -c website/wrangler.jsonc
   npx wrangler@4.156.0 deploy -c wrangler.jsonc
   ```
   (Or Workers & Pages → the Worker → Settings → Domains & Routes → Add → Custom domain. Then the config is just a record of it.)
4. Set the variables `WEBSITE_URL=https://kaykays.com`, `APP_URL=https://app.kaykays.com` and the secret `VITE_SITE_URL=https://kaykays.com`, and add them to Supabase's redirect URLs (3.4).

### 3.6 Moving off Vercel without downtime

1. Do 3.1–3.4 and check both sites on their workers.dev addresses. Vercel keeps serving the old addresses meanwhile.
2. Point the domain at Cloudflare (3.5). Old and new answer the same during the DNS change, so nobody sees a gap.
3. Tell staff who use the web app in a browser the new address, or keep the old one working by adding a redirect in the Vercel project for a few weeks.
4. When nothing has reached Vercel for a week (Vercel → project → Analytics or Logs), delete both Vercel projects and remove the Vercel addresses from Supabase.

## 4. How a deploy works

`scripts/deploy-web.sh <app|website>`:

| Step | Command | If it fails |
|---|---|---|
| 1. Build and check | `npm run build` with `VITE_ORT_WASM_FROM_CDN=1`, or `npm run website:build`; then `prepare-cloudflare.mjs` | Nothing changed |
| 2. Note blue | `wrangler deployments status`: the version taking 100% of traffic | — |
| 3. Upload green | `wrangler versions upload`: new version, **no traffic**, own preview URL `https://<id>-kaykays-app.<sub>.workers.dev` | Nothing changed |
| 4. Check green | `smoke-test-web.mjs` on the preview URL (website also `/terms`, `/privacy`) | Nothing changed. Telegram: "never went live" |
| 5. Switch | `wrangler versions deploy <green>@100%`: all traffic moves at once | Blue keeps serving |
| 6. Check live | The same check on `APP_URL` / `WEBSITE_URL` (or the workers.dev address) | `wrangler versions deploy <blue>@100%` at once. Telegram: "rolled back" |

Exit codes: 0 live, 1 nothing changed, 2 rolled back, 3 rollback failed. CI shows blue, green, the preview URL and the result in the run summary.

CI runs this for both sites after every release (`deploy-web` job in release-and-deploy.yml), with the release's version so About shows it.

### Rolling back

- **Actions → Roll back web → Run workflow.** Leave "version" empty for the previous deployment, or paste a version id from a deploy run's summary.
- From this machine: `npx wrangler@4.156.0 rollback -c website/wrangler.jsonc` (or `-c wrangler.jsonc` for the app).
- Dashboard: Workers & Pages → the Worker → **Deployments** → the good version → **Rollback**.

The next release goes live normally after a rollback.

### Trying a version on some users first (optional)

```bash
npx wrangler@4.156.0 versions deploy <green>@10% <blue>@90% -c wrangler.jsonc   # 10% of visitors
npx wrangler@4.156.0 versions deploy <green>@100% -c wrangler.jsonc             # everyone
```

## 5. Limits and costs (free plan)

| Limit | Value | Where we are |
|---|---|---|
| File size | 25 MiB per file | Largest uploaded file ~3 MB (the onnxruntime `.wasm` is left out) |
| Files per version | 20,000 | App ~50, website ~15 plus one per product and guide |
| Requests for static files | Free, unlimited | — |
| Versions kept | The 100 most recent | Rollback reaches any of them |

Preview URLs are public, like the sites themselves. To hide them, put `*-kaykays-app.<sub>.workers.dev` behind Cloudflare Access and give CI a service token (secrets `CF_ACCESS_CLIENT_ID`, `CF_ACCESS_CLIENT_SECRET`).

## 6. Troubleshooting

| Message | Fix |
|---|---|
| `Set these repository secrets: CLOUDFLARE_API_TOKEN …` | 3.2 |
| `Couldn't read the current deployment. Is Wrangler logged in` | Token expired or lacks Workers Scripts: Edit; account id wrong |
| `No preview URL for the new version` | Enable workers.dev and Preview URLs on the Worker (3.3) |
| `… is N MiB; Cloudflare takes at most 25 MiB per file` | A new big file in the build. Load it from a CDN like the onnxruntime one, or split it |
| `_headers is missing` | `public/_headers` (or `website/public/_headers`) was deleted or renamed |
| Live check fails with 404 on `/terms` | The prerender couldn't reach the storefront during the build: check `VITE_SUPABASE_*` and `VITE_WEBSITE_SLUG` |
| Sign-in works on one address but not another | Supabase redirect URLs (3.4) |
| Background remover fails on the web app only | jsDelivr blocked or down, or the CSP blocks WebAssembly. Desktop and Android are unaffected |
