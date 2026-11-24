# ISMS Documentation Verification and Quality Assurance Report

| | |
|---|---|
| Document identifier | ISMS-DOC-AUD-03 |
| Version | 1.0 |
| Status | Final |
| Date | 24 November 2026 |
| Documents checked | ISMS-UG 1.0, ISMS-TD 1.0, ISMS-AG 1.0 |

## 1. Purpose

This report records how the three new documents were checked against the implementation and for editorial and layout quality (Phases 2 and 6). Open items are carried to [04-outstanding-gaps-and-clarifications.md](04-outstanding-gaps-and-clarifications.md).

## 2. Verification methods

| Code | Method | Evidence |
|---|---|---|
| V-UI | Seen in the running app (web build of release 1.0.1, test business, Admin role, desktop 1366×820 and phone 400×860) | 57 screenshots in `documentation/final/images/screens/` |
| V-CODE | Read in the source: screen registry, permissions, shortcuts, stores, services, edge functions, workflows, scripts | File and line references in the audit report |
| V-DB | Read in the migrations; live migration history read-only | `supabase migration list --linked` lists all 31 applied |
| V-TEST | Covered by passing tests | `npm test`: 75 of 75 passed on 24 Nov 2026; database suites per the release-safety report |
| DOC | Taken from an existing document and not independently re-checked | Source named in the migration map |

## 3. Feature verification matrix

Status values: **Verified** (implemented and verified), **Partial** (implemented; part not run), **Built, not run live** (code exists; never run against the real provider), **Undocumented before** (implemented but missing from the old documents), **Unclear** (awaiting confirmation).

| Feature | Document and chapter | Method | Status |
|---|---|---|---|
| Sign-in, terms, guided tour | UG 4, 5 | V-UI, V-CODE | Verified |
| Invitations bound to the invited email; revoke removes sign-up | UG 5.1, AG 4 | V-CODE, V-DB | Verified |
| Password reset codes (`auth-otp`) | UG 5.2, TD 9.1 | V-CODE | Verified in code |
| PIN lock on shared devices | UG 5.5 | V-CODE (`LocalTerminalSecurity`, PIN in My Profile) | Partial: lock behaviour not exercised |
| Sign out in My Profile and Settings | UG 5.4 | V-UI | Verified |
| Screen groups, sidebar, phone bar, More sheet | UG 6 | V-UI, V-CODE (`screens.ts`, `mobileNav.ts`), V-TEST | Verified |
| Branch switching | UG 6.4 | V-UI | Verified |
| Shifts, "Still working?", reminders | UG 7, TD 11.12 | V-UI, V-DB (cron), V-TEST | Verified (clock-in not performed: live database) |
| Quick Sale and keys | UG 8, App. A | V-UI, V-CODE (`shortcuts.ts`) | Verified (no sale completed: live database) |
| POS: customer, delivery modes, codes, quotes, payment methods | UG 9 | V-UI (cart), V-CODE | Verified in code; completion not performed |
| Sales Log, receipt sheet and actions | UG 10 | V-UI | Verified |
| Refund, edit sale, edit log | UG 10.3–10.4 | V-CODE, V-DB | Verified in code |
| Printing (Bluetooth, network) | UG 10.5, TD 11.11 | V-UI (settings), V-CODE, V-TEST (ESC/POS) | Partial: no printer attached during checks |
| Credit sales, wallet first | UG 11, TD 10.2 | V-CODE, V-DB | Verified in code |
| Invoices | UG 11.4 | V-CODE, V-TEST | Verified in code |
| Customers: add, page tabs, duplicates, merge | UG 12 | V-UI, V-CODE | Verified |
| Attach customer to walk-in sale (24 h / 30 days) | UG 12.4.4 | V-CODE, V-TEST | Verified |
| Points rule and tier values | UG 13.3, TD 11.4 | V-CODE, V-DB, V-TEST | Verified |
| Promotion codes and referrals | UG 13.5–13.6, TD 11.6 | V-UI, V-DB, database suites | Verified (UI creation not performed) |
| Regular orders | UG 14, TD 11.7 | V-UI, V-DB, database suite | Verified; phone click-through not recorded |
| Feedback and bulk messaging | UG 15 | V-UI, V-CODE | Verified in UI; sending not performed |
| Payments & Expenses tabs, till queue, void | UG 16, AG 7.2 | V-UI, V-CODE (`BusinessManagementView`, `payments.manage`) | Verified |
| Payment Prompts | UG 16.4.1 | V-UI | Verified in UI; no prompt sent |
| Petty Cash and rider pay | UG 16.7, 21.7, TD 10.1 | V-UI, V-DB | Verified |
| Finance & Accounting tabs, counts, locking | UG 17, TD 11.2 | V-UI, V-CODE | Verified (locking not performed) |
| Inventory, Adjust stock form, Stock History, Transfers | UG 18 | V-UI | Verified |
| Production & BOM | UG 19 | V-UI, V-TEST | Verified |
| Buying, approvals, GRN/BILL/RTS, ask supplier | UG 20, TD 11.8 | V-UI, V-DB | Verified in UI and schema; no purchase made |
| Supplier view | UG 20.6, TD 6.3 | V-CODE | Verified in code; not seen as a supplier |
| Deliveries, trips, areas, rider pay | UG 21, TD 11.9 | V-UI (admin view), V-DB | Partial: rider view not seen |
| Online Store, tab visibility by `business.update` | UG 22 | V-UI, V-CODE | Verified |
| Home, Stock Report | UG 23 | V-UI, V-TEST | Verified |
| Assistant and advisors | UG 24, TD 12.7 | V-UI, V-CODE | Verified in UI; answers depend on the AI provider |
| Notifications, preferences, ringing alerts | UG 26, TD 11.10 | V-UI, V-CODE | Partial: push and native alarms not tested on a phone |
| Global search and references | UG 27, TD 11.13 | V-UI, V-DB, database suite | Verified |
| Offline sales | UG 28, TD 6.6 | V-CODE, V-TEST | Verified in code and tests; not exercised offline |
| Updates (Restart and install, Android installer) | UG 29, TD 15.6 | V-UI (About), V-CODE | Verified in code; installs not performed |
| Report a problem (Owner and Admin) | UG 31.4, AG 13.2 | V-UI, V-CODE | Verified |
| Roles screen, overrides | AG 5 | V-UI, V-CODE | Verified |
| Default role permissions | UG App. B, AG 3 | V-CODE (computed from `SYSTEM_ROLES` and `screens.ts`) | Verified |
| Settings sections | AG 6 | V-UI, V-CODE | Verified |
| Old records cleanup and its effects | AG 11.2 | V-CODE (`logCleanup.ts`) | Undocumented before; now documented |
| KRA eTIMS | AG 6.4, TD 12.3 | V-CODE | Built, not run live (never run against the KRA sandbox) |
| M-Pesa, Airtel, Paystack | AG 7.3–7.4, TD 12.2 | V-CODE | Built, not run live |
| Dial-code ordering | AG 7.7, TD 12.4 | V-CODE, V-TEST (menu) | Built, not run live |
| SMS, WhatsApp, email | AG 6.5, TD 12.5 | V-CODE | Built, not run live (email in use through one mailbox) |
| Google Sheets backup | AG 12.4 | V-UI, V-DB (cron) | Partial: a real backup has not run |
| Hourly R2 backup and restore drill | AG 12.5, TD 19 | V-CODE (workflows, `db-backup.sh`), DOC | Built, not run (secrets unset) |
| Watchdog and health check | AG 10.3, TD 17 | V-DB, DOC | Verified in schema; Telegram delivery not re-checked |
| Blue-green web deploy | TD 15.2 | V-CODE, DOC | Verified per Phase 4 report |
| Release pipeline and version codes | TD 15.3, 15.5 | V-CODE (workflows) | Verified |
| `db-push.sh` gates | TD 15.4, AG 14.2 | V-CODE, DOC | Verified in code |
| Storage buckets (6) | TD 14 | V-DB | Verified; `business-files` was undocumented before |
| Table and view counts (145, 14) | TD 8.2 | V-DB | Verified |
| Assistant actions need human approval | UG 24.3, TD 12.7 | V-CODE (`pendingActionStore.ts`) | Verified in code |

**Documented but not implemented:** none found. Roadmap steps 4–8 (HR and payroll, valuation, CRM, platform, projects) are described only as plans (TD 23.4).

**Unclear or awaiting confirmation:** listed in the gaps report (items G-02 to G-08).

## 4. Completeness of migrated content

Every section of the two principal documents and every other file in the inventory has a row in the migration map with its destination and action. Content that was deliberately not reproduced (test passwords, account identifiers, dated phase narratives) is listed in map section 6 with where it stays. The removed files (`APP_DOCUMENTATION.*`, empty `DOCUMENTATION.md` and `INSTALL.md`, the stale `supabase/README.md`) were compared with the new documents; no fact found only in them is still true and missing.

## 5. Editorial and layout checks

| Check | Method | Result |
|---|---|---|
| Heading numbering and hierarchy | Build checks (`build_docs.py --check`): chapters in order, sections inside their chapter, no unnumbered sections inside chapters | Pass (UG 210 headings, TD 134, AG 103) |
| Table of contents | Generated from the headings; page numbers read back from the rendered PDF and injected; DOCX uses a Word TOC field built from heading styles | Pass: every part, chapter and section has a page number |
| Lists of figures and tables | Generated from captions | Pass (UG 48 figures / 38 tables; TD 9 / 40; AG 5 / 22) |
| Figure and table numbering | Build checks: numbered per chapter, in sequence, every table captioned | Pass |
| Internal cross-references | Build checks: every `#` link resolves; references to "Section/Table/Figure/Chapter N" inside a document are links | Pass (UG 406 links, TD 229, AG 175); cross-document references are by document and chapter name |
| Missing images | Build check | Pass |
| Page layout | A4, 25.4 mm margins, header (document name, version, status) and footer (classification, "Page X of Y") on every body page; cover unnumbered | Pass, inspected on rendered pages |
| Typography | Body 11 pt, chapters 20 pt, sections 15 pt, subsections 12.5 pt, line spacing 1.3 | Pass |
| Tables | Header row repeats across pages; rows do not split; words no longer break mid-word in narrow columns | Pass after fix (see section 7) |
| Terminology | Screen names as in `src/utils/screens.ts`; "Sign in / Sign out"; "Admin" for whom to ask | Pass |
| Document control | Title, identifier, version, status, created and updated dates, owner, version history in each document | Pass; owner recorded as "Not yet assigned" (no department established) |
| Sensitive content | No passwords, keys, account identifiers or test credentials | Pass |
| Development-tool attribution | Searched all new sources, PDFs and DOCX files | None present |

## 6. User interface issues found while capturing

The issues recorded in `docs/UI_UX_ISSUES.md` were re-checked on the new screenshots.

| Issue | State on 24 November 2026 |
|---|---|
| New customer and Adjust stock forms cut off on desktop | Fixed: both use the shared form sheet with a fixed footer |
| Receipt settings dropdowns too narrow; save button beside autosave | Fixed |
| Floating assistant button covers figures | Mitigated: it can be dragged, and now shows a motion hint |
| Screen names differ between sidebar, phone and page titles | Fixed: one registry |
| Developer words (code names on Roles, "Synced" badges) | Fixed |
| Phone side margin; shared stock photo for products without images | Intended by the owner; documented as behaviour |
| Same sale shown as `TXN-…` in the Sales Log and `RCT-2026-…` on the receipt | Open: gap G-04 |

## 7. Defects found and fixed during QA

| Defect | Fix |
|---|---|
| Contents entries for long headings had no page number (PDF bookmarks drop the space at a line wrap) | Page lookup ignores whitespace |
| Words broken mid-word in narrow table columns | Table cells wrap only between words |
| Version and date squeezed in the version history table | Kept on one line |
| Sale data-flow diagram too wide to read | Redrawn top to bottom |
| Architecture diagram too wide | Nodes stacked vertically |
| Screenshot of Buying > Suppliers caught while loading; phone Home caught on the splash screen; sale detail did not open (the number chip now copies instead) | Re-captured |
| Temporary browser profile cleanup could fail the build | Cleanup made tolerant |

## 8. Limits of this verification

- No sale, payment, clock-in, stock change or message was made: the development environment points at the live database.
- Only the Admin role was used in the running app; cashier, rider and supplier views were checked in code and permissions, not on screen.
- No phone or desktop installer, printer, push notification or provider integration was exercised.
- The guided tour, sign-in and terms screenshots are from the capture of the same day before the screen-name changes; those screens were not affected by the changes.
