# Security assessment: Phase 0 and Phase 1 report

Session of 2026-11-22/23. Plan: [master checklist](../ISMS_Production_Readiness_Master_Checklist.md). Findings in full: [threat-register.md](threat-register.md). System map: [architecture.md](../infrastructure/architecture.md).

## Contents

1. [Result](#1-result)
2. [Baseline before changes](#2-baseline-before-changes)
3. [What was tested and how](#3-what-was-tested-and-how)
4. [Changes made](#4-changes-made)
5. [Regression results](#5-regression-results)
6. [Provider-side actions](#6-provider-side-actions)
7. [Not tested, and why](#7-not-tested-and-why)
8. [Owner decisions required](#8-owner-decisions-required)
9. [Next recommended tasks](#9-next-recommended-tasks)
10. [How to repeat these checks](#10-how-to-repeat-these-checks)

## 1. Result

- **One P0 found and fixed on live (SEC-01).** Anyone with the public app key could call 285 database functions meant only for the server, including one that sets any account's password. The fix was approved by the owner, applied as migration `20261201001`, and verified on live.
- **No cross-tenant data leak found.** RLS is on for all 142 tables, and no policy is `USING (true)`. A user who owns a different business read 0 of the 486 rows of the test business across 136 tables, and 87 of the 99 business functions refused a non-member. The 12 that ran only read the caller's own state.
- **P1s remain:** no working backups (SEC-02), no MFA (SEC-03), the test owner password is public (SEC-04), and possible use of SEC-01 before the fix (SEC-05). All need the owner.
- **Phase 1 exit criterion** ("no known P0 remains; tenant isolation and critical authorization rules have passing tests"): **met for P0 and isolation.** The P1 items above are still open, so Phase 1 is not complete.

## 2. Baseline before changes

| Check | Result |
|---|---|
| `npm test` | 72 passed |
| `npm run lint`, `npm run website:lint` | clean |
| `npm audit --omit=dev` | 0 vulnerabilities |
| DB suites (`supabase/tests`) | 286 passed, 1 failed: `referrals_test.sh` "phone required" used a customer with no phone, which `20261128001` no longer allows (test fixture problem, not an app bug) |
| Live migrations | 23 of 23 applied |
| Live Workers | both 200, headers present, deep links fall back to the SPA |

## 3. What was tested and how

All destructive or probing tests ran on `promo_test`, a throwaway database built from the migrations inside the local `isms-seedtest` container (`supabase/tests/promotions/rebuild.sh`), or on the local seed stack. On live, only read-only catalog queries and harmless API calls were made.

| Area | Method | Result |
|---|---|---|
| RLS coverage | catalog: tables without RLS, permissive `true` policies, anon table grants | none |
| Cross-tenant reads | owner of business C counts rows of business B in every table with `business_id` (RLS on) | 0 / 486 visible |
| Business RPCs | every authenticated-callable `SECURITY DEFINER` function with `p_business_id`, called as a non-member | 87 refused; 12 self-scoped helpers ran |
| Anonymous RPCs | every function anon may call, with live's grants copied in, called as anon | exposed server-only functions → SEC-01 |
| Live drift | `grants_check.sql` on live (read-only) | 294 problems before the fix, 0 after |
| Definer function hygiene | `search_path` set on all `SECURITY DEFINER` functions | all set except two extension wrappers |
| Storage | bucket limits and policies | private buckets member-only by business folder; size and type limits on all 6 |
| Edge functions | read all 17 `verify_jwt = false` functions for their own checks | callbacks: token or signature; webhooks: shared secret; the rest: `requirePermission`. `send-email` was too open → SEC-06 |
| Payments | `confirm_*`, `record_till_payment`, `settle_card_payment` | row locks, unique references, amount mismatch flagged; M-Pesa body trusted → SEC-10 |
| OTP | `otp_check`, rate limits | 5 tries per code, 15-minute expiry, 30/10 min per IP, 15/h per email |
| Secrets in Git | gitleaks 8.28.0 on all 175 commits | 8 hits, all false positives (localStorage key names); known old items SEC-12, SEC-14 |
| Secrets in bundle | searched `dist/` for service-role / secret key text | none |
| Headers / TLS | `curl -I` on both live Workers | CSP, HSTS, XFO, nosniff, Referrer-Policy, Permissions-Policy present; HTTP not redirected (SEC-19) |
| Dependencies | `npm audit --omit=dev` | 0 |
| Auth config | `config.toml`; live not readable from here | password min 6 (SEC-07), MFA off (SEC-03) |

## 4. Changes made

| Commit | Change |
|---|---|
| `157771f` | `send-email`: app users can send only real invitations from their own shop and customer messages with `communication.send`. Referral test fixture fixed. |
| `6f5f079` | Migration `20261201001_lock_function_grants.sql` (SEC-01, SEC-17). `supabase/tests/permissions/grants_check.sql` + `permissions_test.sh` check. `scripts/check-live-grants.sh` (read-only live check). `config.toml` password minimum 8. |
| (this commit) | Docs: architecture, threat register, this report, production-readiness index, checklist statuses. |

## 5. Regression results

After the fix, on a copy carrying live's grants:

| Suite | Result |
|---|---|
| promotions_test.sh | 98 passed |
| referrals_test.sh | 74 passed |
| numbers_test.sh | 9 passed |
| permissions_test.sh | 34 passed (includes the new grants check) |
| ai_permissions_test.sh | 10 passed |
| regular_orders_test.sh | 63 passed |
| All 509 functions vs a clean build | identical grants |

Live after the fix: `get_public_storefront`, `website_accepts_cards` and `check_owner_exists` return 200 for anonymous callers. `update_user_password_by_email` returns `42501 permission denied`, and the money/payment functions are no longer exposed (`PGRST202`).

`send-email`: 13-case matrix passed locally (see SEC-06). `deno check` clean.

## 6. Provider-side actions

| Action | Status |
|---|---|
| Apply `20261201001` to live | **Done 2026-11-23** (owner approved). Rollback: `~/isms-backups/2026-11-23-before-grant-lockdown/rollback_grants.sql` |
| Deploy `send-email` | Pending |
| Set backup secrets (SEC-02) | Owner |
| Auth settings: password policy, MFA, leaked-password check (SEC-03, SEC-07) | Owner |
| Delete `kim-chat`, `shared` functions (SEC-11) | Owner approval |
| Protect `main` (SEC-09) | Owner |

## 7. Not tested, and why

- **Signed-in screens on live after the grant fix.** There is no live test login, and the clean build these grants come from is what every local test and session has used. The owner should open the app and do one sale, one expense and open Finances.
- **Live Auth settings.** The Management API token is in the system keyring and can't be read from scripts.
- **Payment providers end to end.** No sandbox credentials (Daraja, Airtel, Paystack, KRA).
- **`send-email` on live.** Not deployed yet.
- **Branch-level permissions in depth.** The role/permission matrix tests cover roles; per-branch membership tests are planned for Phase 9.

## 8. Owner decisions required

1. SEC-05: did you change account `abb89fdf…` on 2026-11-22 around 14:15 UTC? If not, reset both live passwords and check the API logs.
2. SEC-04: confirm the live owner password is not the seed password.
3. SEC-02: set the four backup secrets.
4. SEC-03: turn on TOTP MFA in Supabase Auth; approve building MFA screens in the app.
5. Approve deploying `send-email` and deleting `kim-chat` / `shared`.

## 9. Next recommended tasks

1. Deploy `send-email`, then run `scripts/check-live-grants.sh` after every `supabase db push`, and add it to the release checklist.
2. App MFA (SEC-03).
3. Phase 2: M-Pesa STK query before marking paid (SEC-10); concurrent sale/stock tests.
4. Phase 3: once the secrets are set, run the first backup and restore drill, and record RPO/RTO.

## 10. How to repeat these checks

```bash
# Test database from the migrations, then every suite (order matters: promotions first)
C=supabase_db_isms-seedtest bash supabase/tests/promotions/rebuild.sh
for t in promotions/promotions_test.sh promotions/referrals_test.sh numbers/numbers_test.sh \
         permissions/permissions_test.sh permissions/ai_permissions_test.sh regular_orders/regular_orders_test.sh; do
  C=supabase_db_isms-seedtest bash supabase/tests/$t | tail -1
done

# Live access rules, read-only (exit 0 = no problems)
bash scripts/check-live-grants.sh
```
