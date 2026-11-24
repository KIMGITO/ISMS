# ISMS Documentation Inventory and Audit Report

| | |
|---|---|
| Document identifier | ISMS-DOC-AUD-01 |
| Version | 1.0 |
| Status | Final |
| Date | 24 November 2026 |
| Scope | Every documentation file in the ISMS repository as of commit `aaf44e8` plus uncommitted changes of 24 November 2026 |

## 1. Purpose

This report records what documentation existed before the restructuring, what each file was for, how current it was, and the structural problems that the new documentation set addresses. It is Phase 1 of the documentation restructuring. The mapping of each section to its new home is in [02-restructuring-and-migration-map.md](02-restructuring-and-migration-map.md).

All original files are preserved unchanged at their original paths and are also copied, with their folder structure, to `documentation/original/`.

## 2. Method

1. Every Markdown, PDF, DOCX and text file tracked in the repository was listed (`git ls-files`), excluding dependency folders.
2. The heading outline of every file was extracted and every substantive file was read in full.
3. Statements likely to drift (counts, schedules, keyboard keys, version rules, screen names, tab names, point rules) were checked against the source code, the migrations and the live migration history (read-only `supabase migration list`).
4. Each file was given a currency rating:
   - **Current**: agrees with the code checked.
   - **Mostly current**: small stale details.
   - **Stale**: describes an earlier version in substance.
   - **Report**: a dated record of work (phase report, audit); accurate for its date, not a reference.

## 3. Inventory

### 3.1 Principal documents

| # | File | Format | Lines | Purpose | Audience | Currency |
|---|---|---|---|---|---|---|
| D1 | `docs/USER_GUIDE.md` (+ `.pdf`) | Markdown, PDF | 840 | How staff use the app, 24 chapters, 48 screenshots | All staff | Mostly current (screen names changed on 24 Nov) |
| D2 | `docs/SYSTEM_DOCUMENTATION.md` (+ `.pdf`) | Markdown, PDF | 1,611 | Architecture, modules, database, functions, security, operations, appendices | Developers, operators | Mostly current; repository section and some counts stale |
| D3 | `README.md` | Markdown | 329 | Repository front page: structure, stack, features, roles, schema, setup | Developers | Stale (early version: old screen names, roles and assistant name) |
| D4 | `APP_DOCUMENTATION.md` / `.txt` / `.pdf` | Markdown, text, PDF | 323 | Early application overview | General | Stale; superseded by D2 (D2 §24.3 says so) |
| D5 | `DOCUMENTATION.md`, `INSTALL.md` | Markdown | 0 | Empty placeholders | — | Empty |

### 3.2 Administration and operations

| # | File | Lines | Purpose | Currency |
|---|---|---|---|---|
| A1 | `docs/ROLES_AND_ACCESS.md` | 88 | Roles, access matrix, riders, points, duplicates, messages | Mostly current; **points rule is the old one** (1 point per KSh 100) |
| A2 | `docs/BACKUP_AND_RECOVERY.md` | 174 | Targets, protected items, four backup layers, restores, drill | Current (backups not yet running: secrets unset) |
| A3 | `docs/DEPLOYMENT_AND_MONITORING.md` | 157 | Release flow, blue-green web, Telegram alerts, problem reports, severity | Current |
| A4 | `docs/RELEASE_AND_OPERATIONS.md` | 148 | Signing, secrets, releases, updates, scheduled jobs, rate limits | Mostly current; **three stale statements** (section 5) |
| A5 | `docs/HOSTING_CLOUDFLARE.md` | 164 | Cloudflare Workers hosting, setup, deploy, rollback, limits | Current |
| A6 | `docs/INTEGRATIONS.md` | 167 | External providers, status, setup steps, inbound call protection | Current |
| A7 | `docs/GOING_PRIVATE.md` | 99 | Plan for making the code repository private | Current (plan, not done) |
| A8 | `docs/operations/owner-setup.md` | 224 | Click-by-click owner account settings (13 steps) | Current |
| A9 | `docs/operations/incident-response.md` | 114 | Roles, response times, escalation, four playbooks | Current |
| A10 | `docs/operations/accounts-and-ownership.md` | 32 | Provider accounts and recovery routes | Current (many "owner to confirm" cells) |
| A11 | `docs/operations/monitoring-and-alerting.md` | 79 | Phase 5 report: watchdog, health check | Report |
| A12 | `docs/TO_FINISH.md` | 168 | Steps still to do per change | Mostly current; several "not on live" notes are out of date (section 5) |
| A13 | `NOTIFICATIONS.md` | 173 | Notification architecture | Mostly current; content also in D2 §12 |
| A14 | `docs/PROMOTIONS_AND_REFERRALS.md` | 243 | Promotions and referrals design, books, permissions, tests | Current |
| A15 | `supabase/SEED_LOGINS.md` | 49 | Test logins for the seed data | Current; holds test credentials (not reproduced) |

### 3.3 Technical and engineering reports

| # | File | Lines | Purpose | Currency |
|---|---|---|---|---|
| T1 | `docs/infrastructure/architecture.md` | 167 | Phase 0 architecture baseline, secrets inventory | Report (accurate for 23 Nov) |
| T2 | `docs/infrastructure/cost-management.md` | 139 | Costs today and at growth stages | Report |
| T3 | `docs/deployment/release-safety.md` | 90 | Phase 7: CI gates, `db-push.sh`, rollback | Report, still the reference for `db-push.sh` |
| T4 | `docs/deployment/performance.md` | 127 | Phase 8 load test and fixes | Report |
| T5 | `docs/deployment/expansion.md` | 76 | Phase 9 multi-tenant and country review | Report |
| T6 | `docs/deployment/cloudflare-deployment.md` | 68 | Phase 4 report | Report |
| T7 | `docs/security/threat-register.md` | 206 | Every security, finance, release, performance and operations finding | Current register |
| T8 | `docs/security/security-assessment.md` | 128 | Phase 0–1 report | Report |
| T9 | `docs/security/phase-2-financial-integrity.md` | 69 | Phase 2 report | Report |
| T10 | `docs/security/phase-6-attack-resistance.md` | 105 | Phase 6 report | Report |
| T11 | `docs/production-readiness.md` | 121 | Phase status and final readiness assessment ("Not Ready") | Current for 23 Nov |
| T12 | `docs/ISMS_Production_Readiness_Master_Checklist.md` | 629 | The hardening programme brief | Reference (instructions, not documentation) |
| T13 | `docs/FEATURE_MAP.md` | 108 | Which feature depends on which, merges of 16 Nov | Mostly current |
| T14 | `docs/navigation-search-improvement.md` | 163 | Navigation regroup and global search design | Current |
| T15 | `docs/ui-content-audit.md` | 55 | Wording standards and changes | Current |
| T16 | `docs/UI_UX_ISSUES.md` | 95 | UI issues found during screenshot capture | Current for 24 Nov; several items since fixed |
| T17 | `supabase/README.md` | 94 | Backend overview | Stale (early schema, "Premium Milk" title) |
| T18 | `website/README.md` | 90 | Customer website commands, going live, SEO | Current |
| T19 | `public/sounds/README.md`, `supabase/tests/promotions/README.md` | 45 | Sound files; how to run the promotions tests | Current |
| T20 | Project rules file at the repository root | — | Money, number, finishing and permission rules set by the owner | Current (normative) |

### 3.4 Planning documents

| # | File | Purpose | Currency |
|---|---|---|---|
| P1 | `docs/roadmap/README.md`, `02`–`08` | Odoo-parity roadmap; steps 2 and 3 marked built | Plans. Not documentation of the system; steps 4–8 are not built |

### 3.5 Earlier documentation set

`documentation/` already held tooling and assets from an earlier "Master Software Documentation" (9 November 2026) whose source file is no longer in the repository: `tools/` (build pipeline, DOCX converter, print stylesheet), `diagrams/` (14 Graphviz and sequence diagrams with SVG and PNG output), `screenshots/` (10 sign-in and website images) and `supporting-references/` (schema export, test output). The tooling is reused; the diagrams were corrected and re-rendered for the new set (section 6).

### 3.6 Customer-facing legal text

`TERMS.md` (89 lines) holds the Terms of Use shown in the app. It is a legal text, not system documentation. It is left unchanged and referenced from the User Guide.

## 4. Structural weaknesses found

| # | Weakness | Effect | Example |
|---|---|---|---|
| W1 | **No audience separation.** Owner duties, developer procedures and staff instructions are mixed. | Owners must read developer material to find their duties; staff guide refers to code. | D2 §22 (operations) sits beside §6 (screen map); A8 (owner setup) is under `operations/` with incident playbooks |
| W2 | **Heavy duplication.** The same table appears in up to four files. | Copies drift apart. | Roles matrix: D2 §5.3, A1, D3, D4. Rate limits: D2 §18.4, A4. Merge rules: D2 §10.5, A1. Release pipeline: D2 §20, A3, A4, T3 |
| W3 | **Copies drifted.** | Readers get contradictory facts. | Points rule (A1 old, D2 new); Quick Sale keys (A4 F1–F3, code Alt+1–6); scheduled jobs (A4 "every 15 minutes", code every minute) |
| W4 | **Phase reports used as reference.** | Readers must know the history to find the current state. | `db-push.sh` documented only in T3; watchdog only in A11 |
| W5 | **No document control.** | No identifiers, owners, status or revision history. | All files |
| W6 | **Inconsistent product naming.** | "KayKay's", "KayKay's App", "ISMS", "ISMS Premium Milk", "Business Management App". | D2 title vs D3 vs T17 |
| W7 | **Screen names out of date** after the 24 November rename. | Instructions point at names that no longer exist. | D1 "Loyalty" (now **Customers**), D1 §17 "Workers" vs old "Staff & invitations" |
| W8 | **Flat structure.** Chapters are numbered but not grouped into parts; procedures, rules and troubleshooting are mixed in prose. | Hard to find the procedure or the rule. | D1 §5 (POS) |
| W9 | **Empty and stale files at the root.** | First impression of the repository is wrong. | D3, D4, D5 |
| W10 | **Lists of figures and tables absent;** screenshots uncaptioned and unnumbered. | No cross-referencing. | D1 |

## 5. Discrepancies found and how they were settled

Each was checked against the implementation. The new documents follow the implementation.

| # | Statement | Where | Implementation | Settled as |
|---|---|---|---|---|
| X1 | Customers earn 1 point per KSh 100; 1 point = KSh 1 | A1 "Loyalty points" | 2 points per KSh 1 paid, 1 per KSh 1 of debt repaid; tier values 50/100/200 points per KSh 1 (`20261108002`, `src/services/loyalty/pointValue.ts`) | New rule documented |
| X2 | Quick Sale finishes with F1 / F2 / F3 | A4 "Quick Sale keyboard shortcuts" | Alt+1 cash, Alt+2 M-Pesa, Alt+4 card, Alt+6 Airtel (`src/utils/shortcuts.ts` lines 98–101) | Alt keys documented |
| X3 | Desktop update restarts after a 15-second countdown; green bar while downloading | A4 "Automatic updates" | No update bar; **About this app → Restart and install** (`AboutView.tsx` line 99, `UpdateService.restartToUpdate`) | About-page flow documented |
| X4 | Schedule reminders every 15 minutes; three scheduled jobs | A4 "Scheduled jobs" | 13 `pg_cron` jobs; reminders every minute (migrations) | Full job table documented |
| X5 | Android release code = 10,000,000 + version | D2 §20.4 | 20,000,000 + major×100,000 + minor×1,000 + patch (`release-and-deploy.yml` line 103); v1.0.0 = 20,100,000 | New formula documented |
| X6 | 180 permission codes | D2 App. B | 188 `code:` entries in `src/utils/permissions.ts` | 188 |
| X7 | 18 edge functions, 40 migrations | D2 §4 | 27 functions (+ `shared/`), 31 migrations | Current counts |
| X8 | Many migrations "not on live" | A12 | All 31 recorded as applied on live (read-only check, 24 Nov). Whether each live text equals its file was not re-checked (`scripts/db-push.sh --check` does that) | Recorded as applied; equality flagged for confirmation |
| X9 | Point values set in **Online Store > Website** | D2 §10.1 | `PointsSettings` is shown in Promotions & Points (Points tab), Customers (key P) and Online Store | Promotions & Points documented as the main place; the three entry points noted |
| X10 | Sign out is in Settings | D1 §1.2 | In **Settings > Account** and in **My Profile** | Both documented |
| X11 | Current version 1.0.0 | D1, D2 | Latest tag `v1.0.1` | Documents state release 1.0.1 |
| X12 | Screen names (Loyalty Club / Loyalty / Customers; Permissions / Role permissions / Roles; Workers List / Staff & invitations / Workers; Kim / Assistant) | D1, D3, T16 | One registry, `src/utils/screens.ts`, since 24 Nov: **Customers, Roles, Workers, Assistant** | Registry names used everywhere |
| X13 | Paid till sales saved by `process_customer_transaction` | Old diagram `sale-dataflow` | Paid sales through `record_till_sale` (one request, FIN-02); credit sales through `process_customer_transaction` | Diagram corrected |
| X14 | Release key replaced after v2.0.0 | D2 §20.4, D2 §25 | Still true for history; numbering restarted at 1.0.0 on 23 Nov | Kept as a historical note in troubleshooting |

## 6. Assets

| Asset | State before | Action |
|---|---|---|
| 48 user guide screenshots (`docs/images/guide/`) | Taken 24 Nov before the screen-name and form fixes | Re-captured from the running app (web build, seeded test business) into `documentation/final/images/screens/` |
| 14 diagrams (`documentation/diagrams/`) | 9 Nov; navigation groups, function counts, sale path and release pipeline out of date | Sources copied to `documentation/final/diagrams/src/`, corrected and re-rendered; originals untouched |
| PDF build (`scripts/build-docs-pdf.py`) | Single-file renderer, no TOC page numbers | Replaced for the new set by `documentation/tools/build_docs.py`, based on the earlier master pipeline |

## 7. Conclusion

The existing material is accurate in most of its detail and rich in business rules. Its problems are structural: no separation by audience, repeated tables that have drifted, phase reports standing in for reference material, and no document control. The new set keeps the content and solves the structure: one User Guide (ISMS-UG), one Technical Documentation (ISMS-TD) and one System Administration Guide (ISMS-AG), each with document control, numbered parts, chapters, figures and tables, and generated contents.
