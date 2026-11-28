# Safaricom Daraja integration report

Date: 2026-11-28. Scope: Daraja only (OAuth, STK Push, STK callback, STK Query, C2B registration,
validation and confirmation, and where their results are saved).

## 1. Implementation map

| Part | File | Called by |
|---|---|---|
| Daraja client (OAuth, STK, query, register, simulate) | `supabase/functions/customer-checkout/daraja.ts` | all below |
| Staff actions: keys, till, register, prompt, check, sandbox test | `supabase/functions/mpesa-payments/index.ts` (+ `settle.ts`, `phone.ts`) | `MpesaRepository` in `src/services/repositories.ts`, `MpesaPaymentsPanel.tsx`, Payment Prompts |
| Website checkout prompt + check | `supabase/functions/customer-checkout/index.ts` | website `api.ts` |
| Dial-code (USSD) order prompt | `supabase/functions/ussd/index.ts` | Africa's Talking |
| STK callback | `supabase/functions/mpesa-webhook/index.ts` | Safaricom (`?token=`) |
| C2B validation + confirmation | `supabase/functions/till-callback/index.ts` | Safaricom (`?type=&token=`) |
| Callback store / retry (new) | `supabase/functions/shared/darajaInbox.ts`, migration `20261215001` | the two callbacks, `payment-sweep` |
| Lost-callback recovery, sandbox re-registration | `supabase/functions/payment-sweep/index.ts` | pg_cron every 2 min (`run_payment_sweep`, 20261212008) |
| Money posting | `confirm_store_payment_request`, `confirm_online_order_payment`, `record_till_payment` (SQL) | callbacks, status query |
| Keys | `mpesa_payment_secrets` (service role only), `mpesa_settings` (till, registered_at) | |

Deployed state could not be compared with the source: the Supabase CLI here is not logged in.

## 2. Defects found and root causes

| # | Defect | Root cause | Effect |
|---|---|---|---|
| D1 | New OAuth token on every Daraja call | no token cache | sweep could make about 100 Daraja calls every 2 min; rate limits made prompts and queries fail at random (the "intermittent" failures) |
| D2 | No timeout on any Daraja call | plain `fetch` | a slow Safaricom held the function until the platform killed it; the user got a generic 500 |
| D3 | Callback lost when processing failed | handler answered 500 and kept only a log line without the payload; the comment assumed Safaricom retries, which it does not reliably do | money arrived with no record (C2B had no recovery at all) |
| D4 | Fast STK callback dropped | prompt row saved after the push; a callback that arrived first got `unknown` and was ignored | prompt stayed Pending until the status query (no receipt) |
| D5 | Callback token changed on disconnect then reconnect | token lived on the deleted secrets row | till URLs registered with Safaricom got 403 for good; live URLs can't simply be registered again |
| D6 | Online order settled by status query kept `QRY-` receipt | only in-store prompts swapped in the late callback's receipt | wrong receipt on the order |
| D7 | Sweep handled oldest prompts first, 50 max | ordering | stuck prompts could block new ones |
| D8 | Payer name "John  Doe" | Safaricom sends `MiddleName: ""` | cosmetic |
| D9 | "Till Registered: Safaricom will now send till payments" | treated acceptance as proof of delivery | misleading |
| D10 | "Send a test KSh 1" shown twice on sandbox | duplicated JSX | cosmetic |
| D11 | Changing the till number kept the old "registered" time | not reset | misleading |
| D12 | Expired/invalid token not renewed | no retry on `404.001.03` / `401.003.01` | one failed call per token expiry |
| D13 | Three copies of callback-URL building, two copies of "settle from query" | duplication | drift (customer check used a 20 s rule, sweep 60/180 s) |

Checked and **not** a defect: order totals with cents (DB check `total = trunc(total)` prevents them; a
whole-shilling guard was still added in `stkPush`). Password = base64(shortcode + passkey + timestamp),
Nairobi timestamp, PartyB = till for Buy Goods, AccountReference 12 / TransactionDesc 13 chars,
phone format 2547/2541, query "still processing" (500.001.1001, 4999) treated as no answer, C2B v2
`00000000` success code, duplicate TransID and CheckoutRequestID protection, RLS (secrets and callbacks
service role only): all correct.

## 3. Changes

Files: `customer-checkout/daraja.ts`, `customer-checkout/index.ts`, `mpesa-payments/index.ts`,
`mpesa-payments/settle.ts`, `mpesa-webhook/index.ts`, `till-callback/index.ts`, `payment-sweep/index.ts`,
`ussd/index.ts`, new `shared/darajaInbox.ts`, `src/components/MpesaPaymentsPanel.tsx`,
`src/services/repositories.ts`.

- Client: per-instance token cache (expires_in minus 60 s), one renewal on an invalid token, timeouts
  (OAuth 15 s, STK 30 s, query 15 s, register 30 s), body read as text so empty/HTML bodies can't throw,
  `DarajaError` kinds (auth, timeout, network, rejected), JSON logs without secrets, `stkCallbackUrl()`.
- STK push timeout is reported as "uncertain: check the phone before sending again" (504), not "not sent".
- Callbacks: token resolves the business from `mpesa_callback_tokens`; the payload is stored first
  (`daraja_callback_receive`), then processed in a sub-transaction (`daraja_callback_process`). Stored =
  acknowledged 200; only a failure to store answers 500 (and the payload goes to the log). Malformed
  bodies are kept and answered 400. `?type=ping` checks reachability without touching money.
- `payment-sweep` retries due callbacks (`daraja_callback_retry`, up to 3 days, backoff) and handles
  newest prompts first.
- Register: distinguishes Safaricom rejection, duplicate registration and success; after success the
  function pings its own confirmation URL. The panel shows the last till payment and last prompt
  result Safaricom actually delivered.
- Website check uses the same `settlePrompt` rule as the sweep.

Database (migration `20261215001_daraja_callback_inbox.sql`): tables `daraja_callbacks`,
`mpesa_callback_tokens`; triggers that keep the token across reconnects; functions
`fn_mpesa_business_by_token`, `daraja_callback_receive`, `daraja_callback_process`,
`daraja_callback_retry`, `fn_online_order_real_receipt`. No money function changed; books unchanged.

Edge functions deployed: **none** (no CLI login, and live deploys need the owner). See `docs/TO_FINISH.md`.

## 4. Tests

| Test | Kind | Result |
|---|---|---|
| Real sandbox, invalid credentials | real Safaricom sandbox | HTTP 400 empty body (handled) |
| Real sandbox, invalid token on query / register | real Safaricom sandbox | 404.001.03 / 401.003.01 (handled, renews) |
| `daraja_test.ts`: OAuth header, cache, bad keys, STK payload + password, decimal amount, rejection, token renewal, network failure, query codes, register success / rejection / duplicate | mock Safaricom | 12/12 pass |
| `daraja_callback_inbox_test.sh`: token kept, early callback then retry, duplicate delivery, failed STK, malformed, wrong business, C2B confirm + duplicate, C2B DB failure kept and retried, validation, online order receipt swap, books balance, money +1.00 | local DB, simulated callbacks | 43/43 pass |
| Existing payment tests (5 files) | local DB | 125/125 pass |
| App tests (`npm test`) | unit | 112 pass |

No real callback from Safaricom was received in this work. Every callback test used hand-built
payloads in Safaricom's documented shape.

## 5. Status per feature

| Feature | Status |
|---|---|
| OAuth: request format, bad keys, renewal | FIXED AND TESTED (mock + real sandbox error shapes) |
| OAuth with valid sandbox keys | NOT TESTED (no sandbox app keys available) |
| Token caching | FIXED AND TESTED (mock) |
| STK push request, response parsing, errors, timeouts | FIXED AND TESTED (mock) |
| STK push real sandbox prompt | NOT TESTED (needs keys; To finish step 6) |
| STK callback success / failure / duplicate / early / malformed | FIXED AND TESTED (simulated) |
| STK callback delivery from Safaricom | NOT TESTED |
| STK query | FIXED AND TESTED (mock) |
| C2B register URL (request, response, duplicate) | FIXED AND TESTED (mock) |
| C2B register real sandbox | NOT TESTED (To finish step 4) |
| C2B validation | VERIFIED WORKING (simulated); only called if Safaricom enables validation |
| C2B confirmation, duplicates, DB failure | FIXED AND TESTED (simulated) |
| C2B delivery from Safaricom | NOT TESTED (To finish step 5) |
| Live till / paybill, production URLs | REQUIRES SAFARICOM PRODUCTION ACCESS |
| Deployed functions match source | NOT TESTED (no CLI login) |

## 6. Outstanding

1. Buy Goods registration short code: the app registers the till number. Some Buy Goods accounts
   need the store (head office) number for C2B registration. Only a live registration can confirm
   this; if Safaricom refuses, try the store number.
2. The exact production wording for "URLs already registered" is assumed (matches "duplicate" or
   "already registered"); check it on the first live attempt.
3. Callbacks that stay `unmatched` or `failed` after 3 days are kept but not retried; nothing alerts on
   them yet. Check with `select * from daraja_callbacks where status in ('unmatched','failed');`.
4. `MPESA_ALLOWED_IPS`: if set, it must contain Safaricom's current callback IPs, or every callback is
   refused (403).
5. Production MSISDN in C2B callbacks is masked/hashed by Safaricom; matching relies on BillRefNumber
   and staff assignment, not phone numbers.
