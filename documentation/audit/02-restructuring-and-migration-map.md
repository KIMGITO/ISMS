# ISMS Documentation Restructuring and Migration Map

| | |
|---|---|
| Document identifier | ISMS-DOC-AUD-02 |
| Version | 1.0 |
| Status | Final |
| Date | 24 November 2026 |

## 1. Purpose

This map shows where every part of the existing documentation went. For each source it gives the destination document and chapter, the action taken, and the reason. Nothing substantive was dropped without being accounted for here. File identifiers (D1, A1, T1 …) are those of the inventory in [01-documentation-inventory-and-audit.md](01-documentation-inventory-and-audit.md).

## 2. Destination documents

| ID | Title | Audience | Source file |
|---|---|---|---|
| ISMS-UG | ISMS System User Guide | Owners, managers, cashiers, riders, suppliers | `documentation/final/ISMS-System-User-Guide/ISMS-UG.md` |
| ISMS-TD | ISMS Technical Documentation | Developers and technical staff | `documentation/final/ISMS-Technical-Documentation/ISMS-TD.md` |
| ISMS-AG | ISMS System Administration Guide | Business owners, admins, the platform operator | `documentation/final/ISMS-System-Administration-Guide/ISMS-AG.md` |

The rule applied for placing content: **how to use a screen** goes to the UG; **how the system is built and changed** goes to the TD; **how to configure, secure, back up and keep the system running** goes to the AG. When two documents need the same fact, one holds it and the other links to it.

Actions: **Retain** (moved with light editing), **Rewrite** (same facts, new wording or structure), **Merge** (combined with another source), **Move** (unchanged in substance, new place), **Remove** (not carried over; reason given), **Reference** (left in place and linked).

## 3. User Guide (D1, `docs/USER_GUIDE.md`)

| Source section | Destination | Action | Reason |
|---|---|---|---|
| Front page, audience paragraph | UG Ch 1 Introduction | Rewrite | Split into purpose, scope, audience and conventions |
| 1.1 Joining the shop | UG Ch 5.1 | Rewrite | Procedure format; "Admin" wording kept |
| 1.2 Signing in and out | UG Ch 4.4, 5.2–5.4 | Rewrite | Sign-in screen in "Accessing", account actions in "User Account Access"; sign out also in My Profile (audit X10) |
| 1.3 Guided tour | UG Ch 5.6 | Retain | — |
| 1.4 Locking a shared device | UG Ch 5.5 | Retain | — |
| 1.5 Suppliers | UG Ch 20.6 | Move | Belongs with Buying and Suppliers |
| 2.1 The screens (groups table) | UG Ch 6.1–6.3; App. B | Rewrite | Screen names updated to the registry (audit X12); role table added from A1 |
| 2.2 Searching | UG Ch 27.1 | Move | General operations |
| 2.3 Messages from the app | UG Ch 6.5 | Retain | — |
| 2.4 Numbers | UG Ch 6.6 | Retain | — |
| 3 Your shift | UG Ch 7 | Rewrite | Module template |
| 4 Quick Sale | UG Ch 8 | Rewrite | Module template |
| 5 POS | UG Ch 9 | Rewrite | Split into procedure, delivery, payment, quotes, VAT |
| 6.1 Sending a receipt | UG Ch 10.2 | Retain | — |
| 6.2 Refunds, 6.3 Changing a sale | UG Ch 10.3–10.4 | Retain | — |
| 6.4 Setting up a printer | UG Ch 10.5 | Retain | User task; printer settings themselves in AG Ch 6 |
| 7 Selling on credit | UG Ch 11.1–11.3 | Merge | With 11 Invoices (both are about money owed) |
| 8 Customers | UG Ch 12 | Rewrite | "Loyalty" → **Customers** |
| 8.3 Messaging many customers | UG Ch 15.3 | Move | With Feedback (the Communication tab lives there) |
| 9 Promotions & Points | UG Ch 13 | Rewrite | Points settings marked as owner/admin |
| 10 Regular Orders | UG Ch 14 | Rewrite | Module template |
| 11 Invoices | UG Ch 11.4–11.6 | Merge | See 7 |
| 12 Payments, expenses and petty cash | UG Ch 16 | Rewrite | Methods tab (configuration) moved to AG Ch 7 |
| 13 Finance & Accounting | UG Ch 17 | Rewrite | Month locking marked as owner action, cross-referenced to AG |
| 14.1–14.4 Stock | UG Ch 18 | Rewrite | — |
| 14.5 Stock Report | UG Ch 23.3 | Move | Reports chapter |
| 14.6 Production | UG Ch 19 | Rewrite | Own chapter (own screen) |
| 15 Buying and suppliers | UG Ch 20 | Rewrite | — |
| 16 Deliveries and riders | UG Ch 21 | Rewrite | — |
| 17 Workers and roles | AG Ch 4, 5, 10; UG Ch 25 | Move | Administration; UG keeps a pointer chapter |
| 18 Online Store | UG Ch 22 | Rewrite | Website settings part moved to AG Ch 7 |
| 19 When the internet goes off | UG Ch 28 | Retain | — |
| 20 Home and reports | UG Ch 23 | Rewrite | — |
| 21 Settings and Business Management | AG Ch 6–7; UG Ch 25 | Move | Administration |
| 21 KRA eTIMS paragraph | AG Ch 6.4 | Move | Configuration |
| 22 Updating the app | UG Ch 29 | Retain | — |
| 23 Keyboard shortcuts | UG Ch 27.2, App. A | Rewrite | Summary in the chapter, full tables in an appendix |
| 24 Problems and what to do | UG Ch 31 | Rewrite | Grouped by area; administrator items moved to AG Ch 15 |
| 48 screenshots | UG figures | Rewrite | Re-captured after the 24 November UI fixes; numbered and captioned |

## 4. System Documentation (D2, `docs/SYSTEM_DOCUMENTATION.md`)

| Source section | Destination | Action | Reason |
|---|---|---|---|
| Title block, 1.1–1.4 | TD Ch 1 | Rewrite | Document control added |
| 1.5 What changed since v4.2.1 (both tables) | TD App. D (change history) | Move | History, not reference |
| 2.1–2.3 System overview, design principles | TD Ch 2 | Retain | Diagram updated |
| 3 Technology stack | TD Ch 3 | Retain | Versions checked against `package.json` |
| 4 Repository structure, npm scripts | TD Ch 4 | Rewrite | Counts corrected (audit X7); workflows and scripts completed |
| 5.1 Three layers | TD Ch 9.3 | Move | Authorisation |
| 5.2–5.3 Roles, who can see what | AG Ch 3 | Move | Administrators decide access; TD links to it |
| 5.4 Changing access | AG Ch 5 (screen), TD Ch 22.4 (defaults in code) | Merge | Split by audience |
| 5.5 Riders | TD Ch 11.9 | Retain | — |
| 6 Screen map | TD Ch 6.3 | Retain | Titles updated to the registry |
| 7 Customer website | TD Ch 12.6 (integration view), TD Ch 6.8 (website frontend); AG Ch 7.6 (going live) | Merge | Split by audience |
| 8 Dial-code ordering | TD Ch 12.4; AG Ch 7.7 (setup) | Merge | Split by audience |
| 9 Payments and M-Pesa | TD Ch 11.3, 12.2; AG Ch 7.3 (setup) | Merge | Split by audience |
| 10 Customers, loyalty, wallets, debts | TD Ch 11.4–11.7 | Retain | — |
| 11 Inventory and production | TD Ch 11.8 | Retain | — |
| 12 Notifications and messaging | TD Ch 11.10, 12.5 | Merge | With `NOTIFICATIONS.md` (A13) |
| 13 AI features | TD Ch 12.7 | Retain | — |
| 14 Receipts, printing, KRA eTIMS | TD Ch 11.11, 12.3; AG Ch 6.4 | Merge | Split by audience |
| 15 Frontend architecture | TD Ch 6 | Retain | Diagram updated |
| 16 Database design | TD Ch 8, 10 | Retain | Split into architecture and integrity |
| 17 Edge functions reference | TD Ch 13 | Retain | — |
| 18 Security model | TD Ch 9; AG Ch 9 | Merge | Mechanism in TD, duties in AG |
| 19 Local development | TD Ch 5 | Retain | — |
| 20 Building and releasing | TD Ch 15.3–15.5 | Merge | With A4 and T3; Android code formula corrected (audit X5) |
| 21 Automatic updates | TD Ch 15.6 | Merge | With A4; update flow corrected (audit X3) |
| 22.1 Deploying backend changes | TD Ch 22.2 | Merge | With A3 and T3 |
| 22.2 Scheduled jobs | TD Ch 11.12 | Retain | Verified against migrations |
| 22.3 Backups | AG Ch 12 | Merge | With A2 |
| 22.4–22.5 Monitoring, crash reports | TD Ch 17; AG Ch 10 | Merge | With A3, A11 |
| 22.6 Routine tasks | AG Ch 14 | Move | Administration |
| 23 Testing | TD Ch 21 | Merge | With T3 (DB suites in CI) |
| 24.1 Integration status | TD Ch 12.1 | Retain | — |
| 24.2–24.3 Limits and status | TD Ch 23 | Rewrite | Status refreshed (all migrations recorded on live) |
| 25 Troubleshooting | TD Ch 18.3 (developer items), AG Ch 15 (operator items) | Merge | Split by audience |
| App. A Environment variables and secrets | TD Ch 16 | Move | — |
| App. B Permission codes | TD App. A | Retain | Count corrected (audit X6) |
| App. C Migrations | TD App. B | Retain | — |
| App. D Glossary | TD Ch 24; UG Ch 32 (user terms) | Merge | — |

## 5. Other files

| File | Destination | Action | Reason |
|---|---|---|---|
| D3 `README.md` | TD Ch 3–5 (facts still true) | Reference | Stale; left in place. A repository README is a separate deliverable (gap G-01) |
| D4 `APP_DOCUMENTATION.*` | — | Remove (not carried over) | Superseded by D2 in its own words (D2 §24.3); nothing found that D2 lacks |
| D5 `DOCUMENTATION.md`, `INSTALL.md` | — | Remove (not carried over) | Empty |
| A1 `ROLES_AND_ACCESS.md` | AG Ch 3, 5; TD Ch 11.4 | Merge | Old points rule replaced by the implemented one (audit X1) |
| A2 `BACKUP_AND_RECOVERY.md` | AG Ch 12 | Retain | Whole content; developer commands kept in AG with a marker |
| A3 `DEPLOYMENT_AND_MONITORING.md` | TD Ch 15, 17; AG Ch 10, 13 | Merge | Release in TD; alerts and incidents in AG |
| A4 `RELEASE_AND_OPERATIONS.md` | TD Ch 15, 16 | Merge | Three stale statements corrected (audit X2–X4) |
| A5 `HOSTING_CLOUDFLARE.md` | TD Ch 15.2; AG Ch 7.6, 14.5 | Merge | Architecture in TD; domain move in AG |
| A6 `INTEGRATIONS.md` | TD Ch 12; AG Ch 7 | Merge | — |
| A7 `GOING_PRIVATE.md` | TD Ch 23 (limitation), AG Ch 14.5 | Reference | A plan, not done; summarised and linked |
| A8 `operations/owner-setup.md` | AG Ch 9.2 | Retain | Click steps kept |
| A9 `operations/incident-response.md` | AG Ch 13 | Retain | — |
| A10 `operations/accounts-and-ownership.md` | AG Ch 9.4 | Rewrite | Account identifiers left in the source file, not repeated |
| A11 `operations/monitoring-and-alerting.md` | AG Ch 10.3 | Merge | Report content folded into reference text |
| A12 `TO_FINISH.md` | AG Ch 14.6 | Reference | A live work list; stays where it is |
| A13 `NOTIFICATIONS.md` | TD Ch 11.10 | Merge | With D2 §12 |
| A14 `PROMOTIONS_AND_REFERRALS.md` | TD Ch 11.6; UG Ch 13 | Merge | Design in TD; use in UG; the file stays as the detailed design reference |
| A15 `supabase/SEED_LOGINS.md` | AG Ch 11.4 | Reference | Test credentials are not reproduced |
| T1 `infrastructure/architecture.md` | TD Ch 2, 15, 16 | Merge | Secrets inventory by name only |
| T2 `infrastructure/cost-management.md` | AG Ch 14.3 | Reference | Summary and link |
| T3 `deployment/release-safety.md` | TD Ch 15.4, 21.2, 22.2 | Merge | — |
| T4 `deployment/performance.md` | TD Ch 20 | Merge | — |
| T5 `deployment/expansion.md` | TD Ch 20.4, 23 | Merge | — |
| T6 `deployment/cloudflare-deployment.md` | TD Ch 15.2 | Reference | Phase report |
| T7 `security/threat-register.md` | AG Ch 9.5; TD Ch 23 | Reference | The live register; open items summarised |
| T8–T10 security phase reports | AG Ch 9.5 | Reference | Phase reports |
| T11 `production-readiness.md` | TD Ch 23.3; AG Ch 2.3 | Merge | Readiness status summarised |
| T12 Master checklist | — | Reference | Programme brief, not documentation |
| T13 `FEATURE_MAP.md` | TD Ch 11.1 | Merge | — |
| T14 `navigation-search-improvement.md` | TD Ch 11.13; UG Ch 27 | Merge | — |
| T15 `ui-content-audit.md` | TD Ch 22.5 (writing standards for the UI) | Merge | — |
| T16 `UI_UX_ISSUES.md` | QA report section 6 | Reference | Fixed items noted |
| T17 `supabase/README.md` | — | Remove (not carried over) | Stale early schema; D2 §16 supersedes it |
| T18 `website/README.md` | TD Ch 6.8, AG Ch 7.6 | Merge | — |
| T19 small READMEs | TD Ch 21 | Reference | — |
| T20 Project rules | TD Ch 10.1, 22.1; AG Ch 8.1 | Merge | Money, number and permission rules restated as system rules |
| P1 Roadmap | TD Ch 23.4 | Reference | Plans; steps 4–8 not built and not described as features |
| `TERMS.md` | UG Ch 4.3 | Reference | Legal text, unchanged |

## 6. Content deliberately not reproduced

| Content | Where it stays | Reason |
|---|---|---|
| Test passwords and seed logins | `supabase/SEED_LOGINS.md` | Credentials do not belong in distributed documents |
| Supabase organisation and project identifiers, personal account names | `docs/operations/accounts-and-ownership.md`, `docs/operations/owner-setup.md` | Placeholders such as `<project-ref>` are used instead |
| Dated phase narratives ("what was built on 23 November") | The phase reports | The new documents describe the current state; history is in TD App. D |
