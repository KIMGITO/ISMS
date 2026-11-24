# ISMS Outstanding Documentation Gaps and Items Requiring Clarification

| | |
|---|---|
| Document identifier | ISMS-DOC-AUD-04 |
| Version | 1.1 |
| Status | Open |
| Date | 24 November 2026 |

## 1. Purpose

These are the items the restructuring could not settle from the existing documents or the implementation. None has been guessed in the new documents: each is either left out or marked as needing confirmation there. Each item names who can resolve it.

## 2. Decisions needed from the owner

Decided on 24 November 2026 (G-01 to G-05, G-07, G-08). G-06 was completed the same day: money records are kept for at least 7 years (tax law 5, Companies Act 7).

| ID | Decision | Done in |
|---|---|---|
| G-01 | Replace the README with a short one that points to `documentation/`, without emojis | `README.md` |
| G-02 | Document owner: Dennis Kimanthi Gitonga, Codensons (kimanthidennis02@gmail.com; codensons@gmail.com) | All three documents, `LICENSE`, `TERMS.md` |
| G-03 | Still open: review, then set the status to Approved | |
| G-04 | Receipt numbers come from the sale: `TXN-` and the first 8 characters of the sale id. One format everywhere; the prefix and format settings were removed (they suggested a counted number that never existed) | App 1.1; UG 10.1, AG 6, TD 10.4 |
| G-05 | The audit trail can't be deleted or changed by anyone; the database refuses it | Migration `20261203001`; AG 10.1, 11.2 |
| G-06 | Sales, stock history and points used are never deleted (they carry money and the books). Sales are kept for at least 5 years (the Kenyan tax record period; owner decision 24 November 2026) | Migration `20261203001`; AG 11.2 |
| G-07 | Points settings live only on Promotions & Points | App 1.1; UG 13.4 |
| G-08 | New permission `support.report`; owners and admins have it, others when the owner ticks it | App 1.1, `ops-alert`; AG 3.4, UG 31 |

### Original items

| ID | Item | Affects | Needed |
|---|---|---|---|
| G-01 | **Repository README.** `README.md` at the root describes an early version (old screen names, roles, assistant name). It was left unchanged. | First impression of the repository | Approve replacing it with a short README that points to `documentation/` |
| G-02 | **Document owner.** No owner or responsible department is established, so every document shows "Not yet assigned". | Document control in all three documents | Name the owner of each document |
| G-03 | **Approval status.** All three documents are "Draft for review". | Status field | Review and approve, then set status to "Approved" and the version to 1.0 final |
| G-04 | **Two number formats for one sale.** The Sales Log and search show `TXN-D6EB287C`; the printed receipt shows `RCT-2026-D6EB287C` (receipt prefix setting). Both are documented as they are. | UG 10.1, 27.1; TD 10.4 | Decide whether staff should see one format everywhere |
| G-05 | **Audit trail can be deleted.** The Audit Log says entries cannot be edited, but owners and admins can delete them by age in Settings > Old records. Documented with a warning. | AG 10.1, 11.2 | Decide a retention policy, or whether the audit trail should be excluded from cleanup |
| G-06 | **Deleting old sales changes past reports.** Old records cleanup removes sales older than 3 months from sales reports (stock not restored; payments and debts kept). This sits uneasily with the rule that the books and the figures on screen always agree. Documented with a warning. | AG 11.2 | Confirm the intended behaviour |
| G-07 | **Points settings in three places** (Promotions & Points, Customers via P, Online Store), against the one-place-per-feature rule. Documented as found. | UG 13.4, TD 23.1 | Decide the single home |
| G-08 | **Report a problem is limited by role name** (Owner, Admin) rather than by a permission. Documented as found. | AG 3.4 | Confirm, or add a permission |

## 3. Facts not verified

| ID | Item | Why not verified | How to verify |
|---|---|---|---|
| G-09 | Every live migration text equals its file | Only the migration list was read | `bash scripts/db-push.sh --check` |
| G-10 | PIN lock behaviour on a shared device | Not exercised | Set a PIN in My Profile, leave the app, return |
| G-11 | Cashier, rider and supplier views as they appear on screen | Only the Admin role was used | Sign in with each seeded role (`supabase/SEED_LOGINS.md`) and compare with UG Appendix B |
| G-12 | Push notifications and ringing alarms on Android | No device used | Steps in `docs/TO_FINISH.md` |
| G-13 | Every payment, tax and messaging integration | Never run against real providers or sandboxes | Provider sandbox tests listed in `docs/TO_FINISH.md` |
| G-14 | Backups and the restore drill | Secrets not set; never ran | AG 12.5 |
| G-15 | Telegram delivery of watchdog alerts on live | Not re-tested during this work | `SELECT public.run_ops_watchdog(true);` |
| G-16 | Receipt printing on a physical printer | No printer attached | UG 10.5 test print |

## 4. Documentation not yet written

These were not created because there was not enough verified information. Writing them would require the input named.

| ID | Missing document or section | Needed input |
|---|---|---|
| G-17 | Customer-facing guide to the website and dial-code ordering | Owner's decision that customers need one; the website and USSD going live |
| G-18 | Installation guide for each platform (where installers are downloaded, first-run steps on Windows SmartScreen and Android "unknown apps") | Final download location for staff |
| G-19 | Data retention and privacy procedures (erasing a customer, retention periods) | Done 2026-11-24: retention periods and Erase personal details (AG 11.2, 11.3; migration `20261203002`). ODPC registration still needs the adviser (EXP-06) |
| G-20 | Named backup person and escalation contacts | Owner decision (finding OPS-05) |
| G-21 | Staging environment procedures | A staging project does not exist (REL-01, WEB-03) |
| G-22 | Database reference (every table and column) | Can be generated: `documentation/tools/generate_db_reference.py` exists from the earlier documentation set and needs a fresh schema export |

## 5. Pre-existing material to note

- `docs/TO_FINISH.md` still says several migrations are "not on live"; the live migration history now lists all 31 as applied. The file should be brought up to date by ticking the completed steps.
- `docs/ROLES_AND_ACCESS.md` and `docs/RELEASE_AND_OPERATIONS.md` contain the stale statements listed in the inventory (X1–X4). They are preserved unchanged; the new documents supersede them.
