# Phase 2 report: financial and stock integrity

Session of 2026-11-23. Plan: [master checklist](../ISMS_Production_Readiness_Master_Checklist.md). Findings: [threat-register.md](threat-register.md) (FIN-*). Phase 1: [security-assessment.md](security-assessment.md).

## Contents

1. [Result](#1-result)
2. [Flows traced](#2-flows-traced)
3. [Tests and results](#3-tests-and-results)
4. [Changes made](#4-changes-made)
5. [Deployment order](#5-deployment-order)
6. [Not done yet](#6-not-done-yet)

## 1. Result

- **FIN-01 (P1), fixed in code:** a sale's money figures were not checked against its items, in both paid (`record_till_sale`) and customer/credit (`process_customer_transaction`) sales. A till could move KSh 200.00 of stock and book KSh 1.00 without recording a discount. Now refused.
- **FIN-02 (P1), fixed in code for new app builds:** most paid sales were saved as two requests (header, then items), so a dropped connection could book money with no items or stock change. The app now saves every paid sale in one database step. Older installed apps still use the two requests until they update.
- Already sound, verified by test: refusal of zero and negative amounts in every money function; no overpaying a debt; retried and duplicated sales counted once; replayed till callbacks recorded once; parallel sales keep stock and books right; books balance (debits = credits); no floating-point money columns.

## 2. Flows traced

| Flow | Path | Atomic | Retry-safe | Amount trusted from client |
|---|---|---|---|---|
| Paid sale (new app) | `record_till_sale` (caller's rights + RLS) | yes | `reference_id` unique | checked against the items (FIN-01) |
| Paid sale (older apps) | direct insert of header, then items | **no** (FIN-02) | `reference_id` unique + repair on retry | not checked until old apps are retired |
| Customer / credit sale | `process_customer_transaction` (definer + permission) | yes | `reference_id` | checked (FIN-01) |
| Regular order delivered | `deliver_regular_orders` → `process_customer_transaction` | yes | yes | computed by the server |
| Debt payment, wallet, petty cash, supplier, business payment | own RPCs | yes | `reference_id` where given | amount > 0; debt payment ≤ amount owed |
| M-Pesa till (C2B) | `till-callback` → `record_till_payment` | yes | unique `trans_id` | amount from Safaricom; URL token |
| M-Pesa STK | `mpesa-webhook` → `confirm_*` | yes, `FOR UPDATE` | unique `checkout_request_id` | amount compared with the order; body trusted (SEC-10) |
| Airtel | callback → provider status check | yes | unique `reference` | provider status |
| Card (Paystack) | `card-webhook` (HMAC signature) → `settle_card_payment` | yes | unique `reference` | signed webhook |

## 3. Tests and results

`supabase/tests/sales/sale_totals_test.sh`: **44 passed**.

| Group | Cases |
|---|---|
| Correct sale | saved; stock −2; cash +100.00; books balance; income = 100.00 |
| Refused, nothing saved | pays 1.00 for 100.00; total ≠ items; discount > total; pays more than items; negative quantity; discount 150 %; negative price; empty cart. No stock, cash or sale row changes |
| Real tills accepted | recorded discount; item discount + 16 % VAT; cent rounding (3 × 33.33 at 7.5 % off); 1.5 quantity; charged delivery; free delivery; delivery can't add more than its fee |
| Repeats | same reference returns the same sale; stock and cash move once |
| Older-app split sale | header alone moves nothing; retry adds the item once; a further retry adds nothing |
| Concurrency | 4 tills sending the same sale: 1 sale, stock −1. 8 different sales at once: 8 saved, stock −8, all books balance |
| Credit sales | 1.00 for 100.00 refused, with no debt or stock change; total ≠ items refused; correct credit and paid customer sales saved, debt up by the right amount |

Also run by hand: money RPCs with 0 and −100 (all refused); a debt payment of 1,000,000 (refused); `record_till_payment` replayed 3 times in a row and 3 at once (1 row, `duplicate` after the first).

Regression after the change: all DB suites pass (promotions 98, referrals 74, numbers 9, permissions 34, AI permissions 10, regular orders 63, sales 44). `npm test` 72 passed; typecheck clean.

## 4. Changes made

| Commit | Change |
|---|---|
| `a06f049` | `20261201002`: `record_till_sale` checks figures against items and repairs older split sales on retry. App: `createTransaction` sends every paid sale with items through `record_till_sale`. Tests: `sale_totals_test.sh`. `rebuild.sh` now applies every `2026*.sql` (it skipped December files). |
| `696a010` | The check moved into `fn_check_sale_totals`, now also used by `process_customer_transaction` (otherwise identical to live, checked by md5). |

## 5. Deployment order

1. `supabase db push` (applies `20261201002`), then `bash scripts/check-live-grants.sh`. Safe before the app update: the current app's promo and credit sales already send matching figures, and its plain paid sales don't use these functions.
2. Release the app as usual. New builds save paid sales in one step.
3. Once every device runs the new build: add the same check to direct inserts (a deferred constraint trigger on `transactions` / `transaction_items`), or revoke direct `INSERT` on those tables, so FIN-02 is closed for good.

## 6. Not done yet

- SEC-10: M-Pesa STK status query before marking paid (needs the Daraja sandbox).
- Edits and refunds of sales (`sale_edit_log`, `create_credit_note`) were not re-tested in this pass; they are covered by the existing promotions tests for refunds.
- The UI was not driven in a browser; the change sits in the service layer that every sale path already uses.
