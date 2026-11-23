# Phase 6: network, API and attack resistance

Date: 2026-11-23. Status: **fixes built and tested on a test database and in unit tests; not yet on live.** Live needs `db push`, the edge function deploys and the website deploy ([TO_FINISH.md](../TO_FINISH.md) → Phase 6). An independent penetration test is still open; it needs the owner.

Checklist: [Phase 6](../ISMS_Production_Readiness_Master_Checklist.md#phase-6-----network-api-and-attack-resistance). Findings: [threat-register.md](threat-register.md).

No denial-of-service or load test was run against production. Every test below ran on a local test database, in unit tests, or as plain read-only requests (`curl -I`) to the live sites.

## 1. Attack surface

| Entry point | Who can call it | Protection |
|---|---|---|
| Web app, website (Cloudflare Workers, static files) | Anyone | Cloudflare network (DDoS absorbed by the platform), security headers, no server code |
| Supabase Auth (sign-in, sign-up, refresh) | Anyone | Supabase per-IP limits (`[auth.rate_limit]`), passwords min 8 |
| PostgREST tables | Signed-in users | RLS on every table; anon reads/writes no table (grants check) |
| PostgREST RPCs callable by anon | Anyone with the public key | 21 functions, listed in `grants_check.sql`; each checked below |
| Edge functions with login (`verify_jwt` on) | Signed-in users | `requirePermission`, membership check, `enforceRateLimit` on costly actions (AI, SMS, payments, email) |
| Edge functions without login | Anyone on the internet | Per-function secret: callback token, Paystack signature, service key, or per-visitor quota |

### Functions without login, after this phase

| Function | Caller | Authenticated by | Body cap | Abuse handling |
|---|---|---|---|---|
| `mpesa-webhook` | Safaricom | `?token=` (constant-time) + optional `MPESA_ALLOWED_IPS` | 64 KB | refused calls logged; repeats ignored by `FOR UPDATE` + status check |
| `till-callback` | Safaricom | same | 64 KB | same; `trans_id` unique |
| `airtel-callback` | Airtel | per-shop 48-hex token; success re-checked with Airtel | 64 KB | refused calls logged |
| `card-webhook` | Paystack | HMAC-SHA512 of the body with the shop's key (constant-time); format pre-check before any DB read; optional `PAYSTACK_ALLOWED_IPS` | 64 KB | refused calls logged; amount taken from Paystack's verify, not the body |
| `ussd` | Africa's Talking | `?token=` (constant-time) | 8 KB | 40 requests / 10 min per phone |
| `auth-otp` | Anyone | none (it is the sign-up/reset step) | 8 KB | 30 / 10 min per IP, 15 / h per email, guess limit per code in `otp_check`; same answer whether the account exists or not |
| `customer-assistant` | Website visitors | none | 32 KB | per-visitor quota (`consume_assistant_quota`), message ≤ 500 chars |
| `send-fcm`, `alarm-sync` | Database triggers | service key or `FCM_WEBHOOK_SECRET` (constant-time) | n/a | not reachable without the secret |
| `ops-alert` | Uptime monitor (GET), app, database | GET shows only "ok"/age; POST checks its own caller (constant-time) | 64 KB | rate limits per action |
| `send-email` | Backend, staff | service key (constant-time) or staff JWT + `communication.send` | n/a | 30 / h per user |

## 2. What was checked, and what was found

| Area | Result |
|---|---|
| DDoS exposure | Web delivery is static on Cloudflare (platform DDoS protection, free). Supabase API and edge functions sit on Supabase's own edge, not behind our Cloudflare zone, so Cloudflare WAF/rate rules can't cover them (WEB-06). Residual risk: a flood of edge-function calls uses the plan's monthly invocations (SEC-26) |
| Rate limits | Auth: Supabase limits. OTP, email, AI, SMS, payments, USSD, assistant: already limited. **Gap found:** `check_promo_code` (anon) had no limit, so codes could be guessed fast (SEC-21). Fixed |
| Request size | Storage: 10–20 MB per bucket, file types allow-listed (no SVG, which can carry scripts). **Gap found:** public functions read bodies of any size (SEC-22). Fixed with caps |
| Security headers / CSP | Live on both sites: CSP (`script-src 'self'`, `frame-ancestors 'none'`, `object-src 'none'`), HSTS 2 years, `nosniff`, `X-Frame-Options DENY`, Referrer-Policy, Permissions-Policy. Plain `http://` on workers.dev answers 200 instead of redirecting (SEC-19, needs the custom domain) |
| CORS / origin | Edge functions answer `*`. They take bearer tokens, not cookies, so another site can't act as a signed-in user (SEC-16, accepted). Webhooks don't send CORS headers at all |
| Injection | Database access goes through the Supabase client or RPC parameters; no SQL is built from strings in edge functions. Dynamic SQL in migrations uses `format('%I')` / `%L` |
| XSS | No `dangerouslySetInnerHTML`, `eval` or `document.write` in the app or website. The page editor's HTML is built from escaped text with five allowed tags. Links: only `/path`, `https:`, `mailto:`, `tel:`. **Gap found:** `//host` passed as an internal link (SEC-25). Fixed |
| CSRF | Not applicable: no cookie sessions; the Supabase token travels in the `Authorization` header |
| IDOR / broken access control | RLS on every table, permissions in the database (`has_permission`). `permissions_test.sh`: 34 passed, 0 failed on a fresh build of all migrations, including this phase's |
| Bots / abuse patterns | Abuse was invisible: blocked keys and refused webhook calls left no trace (SEC-23). Now logged to `security_events`, and the watchdog alerts in Telegram |
| Webhook authentication, timestamps, replay | Daraja and Airtel send no signature or timestamp; protection is the secret URL token plus, for Airtel and Paystack, a status check with the provider. Replays are harmless: every confirm function ignores a payment it has already settled. Tokens were compared with `!==` (SEC-15). Fixed. M-Pesa still trusts the body for the amount (SEC-10, open) |
| Dependency scan | `npm audit`: 10 advisories (1 critical `tar`, 3 high incl. `sharp`), all in build tools pulled in by `@capacitor/assets` 3, none shipped. Upgraded to 4.0.0: **0 vulnerabilities** (SEC-24). `cargo audit` runs in CI; not run locally |
| Secret scan | gitleaks over the full history (262 commits): 8 matches, all browser storage key names, none real. Allow-listed by exact name in `.gitleaks.toml`; scan now clean |

## 3. Changes

| Change | Files |
|---|---|
| Shared guard: constant-time compare, size-capped body reads, optional IP allow-list (platform header only, never `X-Forwarded-For`), refused-call logging | `supabase/functions/shared/guard.ts` |
| Callbacks use it: M-Pesa, till, USSD, Airtel, Paystack. Paystack calls without a well-formed signature are refused before the database is touched | `mpesa-webhook`, `till-callback`, `ussd`, `airtel-callback`, `card-webhook` |
| Public JSON bodies capped; service-key checks constant-time | `auth-otp`, `customer-assistant`, `ops-alert`, `send-email`, `send-fcm`, `alarm-sync`, `shared/cors.ts` |
| `security_events` table, `log_security_event`, first block of each rate limit logged, promo guess limit (20 wrong / 15 min per IP), watchdog checks `abuse:refused` and `abuse:rate_limited`, daily purge (events 30 days, rate-limit rows 2 days) | `supabase/migrations/20261201004_abuse_limits.sql` |
| Website reads the promo check's new answer; `//host` links refused | `website/src/api.ts`, `website/src/richFormat.ts` |
| CI security workflow: `npm audit --audit-level=high`, `cargo audit`, gitleaks (whole history), guard tests; Monday run; Telegram on failure | `.github/workflows/security.yml`, `.gitleaks.toml` |
| Dependabot: security PRs, weekly grouped npm/cargo updates, monthly Actions updates | `.github/dependabot.yml` |
| Grants check knows the new server-only functions | `supabase/tests/permissions/grants_check.sql` |
| Build tools without known vulnerabilities | `package.json`, `package-lock.json` (`@capacitor/assets` ^4.0.0) |

The IP allow-lists are **off** until `MPESA_ALLOWED_IPS` / `PAYSTACK_ALLOWED_IPS` are set. Take the IPs from Safaricom's and Paystack's current documentation when setting them; a wrong list would refuse real payments (they would retry, and the watchdog would report stuck payments).

## 4. Tests

| Test | Where | Result |
|---|---|---|
| Guard: compare, body caps (declared and streamed), IP allow-list ignores `X-Forwarded-For` | `deno test supabase/tests/functions/` | 6 passed |
| Type check of the 11 changed functions | `deno check` | pass |
| Rate limit blocks after the limit and logs only the first refusal | test DB, rolled back | pass (1 event for 2 blocked calls) |
| Promo: 20 wrong codes per IP, then "Too many wrong codes"; another IP unaffected; a valid code still returns its saving, also as anon | test DB (`promo_test`), rolled back | pass |
| Watchdog: 14 core checks unchanged + 2 new; `abuse:refused` fires at 13 refused calls with source and IP | test DB, rolled back | pass |
| Purge removes old events and old rate-limit rows; cron job scheduled | test DB, rolled back | pass |
| New functions/table closed to anon and authenticated | test DB | pass |
| Migration runs twice without error | test DB, rolled back | pass |
| Fresh build of all migrations + permissions suite (includes grants check) | `rebuild.sh` + `permissions_test.sh` | 34 passed, 0 failed |
| App type check + unit tests; website type check | `npm run lint`, `npm test`, `npm run website:lint` | pass |
| Live headers on both Workers | `curl -I` | all present; HTTP not redirected (SEC-19) |
| gitleaks whole history with the allow-list | docker `gitleaks git` | no leaks |
| npm audit | local | 0 vulnerabilities |

Not tested: the edge functions running on the Supabase runtime (they are not deployed yet), the IP allow-lists against real provider traffic, and `cargo audit` (first result comes from CI).

## 5. Residual risks

| ID | Risk | Mitigation / owner decision |
|---|---|---|
| SEC-10 | A leaked M-Pesa callback token lets someone mark M-Pesa prompts as paid | Open. Add a Daraja STK query before marking paid (needs sandbox keys). Meanwhile: long random token, optional IP allow-list, refused calls alert |
| SEC-26 | No per-IP limit in front of the Supabase API or the edge functions in general; a flood costs invocations and could hit the plan's monthly quota | Accepted for now. Every anon write has its own cap (crash reports 2000 rows, feedback 30/h per shop, invite guesses 10/15 min, promo 20/15 min); costly functions have per-user limits. Re-assess with the domain move or at the Pro plan |
| — | `enforceRateLimit` lets a request through if the limiter itself fails (a limiter outage must not stop sales) | Accepted. OTP guesses are also limited per code inside the database |
| SEC-19 | `http://` not redirected on workers.dev | Turn on "Always Use HTTPS" with the custom domain |
| — | No independent penetration test | **Owner:** arrange one before onboarding larger customers |

## 6. Security updates

1. Dependabot opens a PR for every dependency with a known vulnerability (turn on *Dependabot security updates* in GitHub → Settings → Code security), plus grouped weekly updates.
2. The *Security checks* workflow fails on a high or critical npm advisory, a RustSec vulnerability or a committed secret, on every push and every Monday, and tells Telegram.
3. A failing check is handled as an incident ([incident-response.md](../operations/incident-response.md)): critical/high in shipped code within 2 days, in build tools within 2 weeks; moderate with the next routine update.
4. Merge an update only when the normal checks pass, then release as usual (`fix:` commit gives a patch release).
5. A leaked secret: rotate it first (provider dashboard, then `supabase secrets set`), then remove it from the code. Rewriting history does not un-leak it.
