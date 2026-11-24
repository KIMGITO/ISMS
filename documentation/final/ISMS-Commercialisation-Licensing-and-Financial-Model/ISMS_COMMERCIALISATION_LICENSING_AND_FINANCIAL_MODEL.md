---
title: ISMS Software Commercialisation, Licensing and Financial Model
short_title: ISMS Commercialisation, Licensing and Financial Model (ISMS-CLF)
software: KayKay's Integrated Shop Management System (ISMS)
description: How ISMS can be sold, licensed, offered as a hosted service, maintained, financed and transferred: commercial models, roles, costs, prices, financial calculations, contracts, ownership, resellers, records and risks.
doc_id: ISMS-CLF
version: "0.1"
software_release: "1.0.1"
status: Draft for owner decision
created: 24 November 2026
date: 24 November 2026
classification: Confidential: owner, advisers, prospective partners and acquirers under NDA
organisation: Codensons
author: Dennis Kimanthi Gitonga, Codensons
contact: kimanthidennis02@gmail.com; codensons@gmail.com
---

# Document Control

| Item | Value |
|---|---|
| Document title | ISMS Software Commercialisation, Licensing and Financial Model |
| Document identifier | ISMS-CLF |
| Version | 0.1 |
| Status | Draft for owner decision. Prices are recommendations, not approved prices |
| Software release described | ISMS 1.0.1 |
| Created | 24 November 2026 |
| Last updated | 24 November 2026 |
| Document owner | Dennis Kimanthi Gitonga, Codensons |
| Contact | kimanthidennis02@gmail.com (developer); codensons@gmail.com (company) |
| Related documents | ISMS-UG System User Guide; ISMS-TD Technical Documentation; ISMS-AG System Administration Guide |
| Approval needed from | The software owner (all decisions in the Decision Register); a qualified Kenyan advocate (legal matters); an accountant or tax adviser (tax matters) |
| Source file | `documentation/final/ISMS-Commercialisation-Licensing-and-Financial-Model/ISMS_COMMERCIALISATION_LICENSING_AND_FINANCIAL_MODEL.md` |

# Version History

| Version | Date | Description |
|---|---|---|
| 0.1 | 24 November 2026 | First draft. Built from the project repository (code, migrations, LICENSE, TERMS), the three existing documents and the cost, accounts and threat registers. All figures that are not measured are labelled as estimates, assumptions or recommendations. |

# Table of Contents

<!-- TOC -->

# List of Tables

<!-- LIST OF TABLES -->

# Part I: Introduction and Product Position

# Chapter 1: Executive Summary

## 1.1 Purpose

ISMS is a working, multi-branch shop management system: till, customers and credit, stock, buying, deliveries, accounting, an online store and AI advisors, delivered as Android, Windows, Linux and web apps on one shared hosted database. It is owned by its developer, Dennis Kimanthi Gitonga, trading as Codensons, and is already distributed under a commercial licence ("downloading is free, using it is not").

This document sets out how ISMS can earn money, what each customer pays for, what the owner must provide in return, which costs every price must recover, and how the software can later be licensed exclusively, sold or transferred. It is a framework for decisions. It does not change the application.

## 1.2 Key findings

**Table 1.1:** Key findings

| # | Finding | Basis |
|---|---|---|
| 1 | **ISMS is built as a hosted, multi-business service.** One database serves every business, separated by `business_id` and row-level security; only the platform owner can create a business. Selling it as a subscription service (SaaS) fits the product as built; selling separate installed copies does not, without extra work. | Verified (ISMS-TD Chapter 8) |
| 2 | **The app has no licensing or billing controls.** Nothing in it checks a licence, a plan, a user or branch limit, or an unpaid account. Every limit in this document is enforced by contract and by hand until such controls are built. | Verified (code search, [Section 4.6](#s-4-6)) |
| 3 | **Provider costs are small; people are the main cost.** Today ISMS runs on free plans (about USD 0 a month plus the domain). The minimum production set-up is about USD 25 to 30 a month. Support and maintenance time costs more than every provider bill at every stage up to thousands of businesses. | Measured and list prices (`docs/infrastructure/cost-management.md`) |
| 4 | **Per-business payment and messaging fees already fall on each business.** M-Pesa, Airtel, Paystack, SMS, WhatsApp and KRA eTIMS use each business's own accounts. The shared costs are hosting, database, files, email, push notifications and the shared AI allowance. | Verified (ISMS-TD Chapter 12) |
| 5 | **The platform is not yet ready for paying customers.** The 23 November 2026 assessment was *Not Ready*: no working independent backup, no two-step sign-in for owners, the database likely on the free plan, no uptime monitor. Charging before these are fixed creates liability. | Verified (ISMS-AG Section 2.3) |
| 6 | **The intellectual property sits with one person.** The LICENSE names Dennis Kimanthi Gitonga (trading as Codensons) as licensor; all 229 commits have one author. This is simple to transfer, but the business has a single point of failure (OPS-05). | Verified (LICENSE, git history) |
| 7 | **Under the illustrative assumptions, the business breaks even at about 39 paying businesses** at an average KSh 4,500 a month, with a fixed monthly cost base of about KSh 89,900 (mostly the owner's own maintenance time). | Estimate ([Chapter 11](#ch-11)) |

## 1.3 Recommended model and suggested amounts

The recommended primary model is a **hosted subscription (SaaS) under a non-exclusive licence**, with one-off set-up fees, priced in three plans. Selling installed copies, source code or the whole intellectual property are kept as secondary options with prices worked out from cost and value, not guessed.

**Table 1.2:** Suggested amounts at a glance (recommendations, excluding VAT; see [Appendix B](#app-b) for the full list)

| Item | Suggested amount | Basis |
|---|---|---|
| Starter plan (1 branch, 3 users) | KSh 3,000 a month | [Section 7.3](#s-7-3), [Chapter 11](#ch-11) |
| Business plan (up to 3 branches, 10 users) | KSh 6,000 a month | [Section 7.3](#s-7-3) |
| Enterprise plan | From KSh 12,000 a month, quoted | [Section 7.3](#s-7-3) |
| Annual prepayment | 10 times the monthly fee (two months free) | [Section 7.8](#s-7-8) |
| Set-up and onboarding | KSh 10,000 (Starter), KSh 25,000 (Business), quoted from KSh 50,000 (Enterprise) | Hours times the charge-out rate |
| Online store (customer website) add-on | KSh 30,000 set-up plus KSh 1,500 a month | [Table 7.4](#t-7-4) |
| Charge-out rate for extra work | KSh 2,500 an hour | [Section 12.7](#s-12-7) |
| Perpetual licence of a separate deployed copy | KSh 220,000 once, plus KSh 44,000 a year maintenance, plus deployment at cost | [Table 5.3](#t-5-3) |
| Non-exclusive source-code licence | About KSh 2,100,000 | [Table 5.3](#t-5-3) |
| Full assignment of the intellectual property (pre-revenue) | Asking about KSh 6,000,000; floor about KSh 3,600,000; independent valuation advised | [Section 5.5](#s-5-5) |

> **Important:** These amounts are recommendations derived from stated assumptions ([Table 11.1](#t-11-1)). They are not market prices that have been tested, and the actual provider bills have not been confirmed by the owner. Validate them with at least five prospective customers and with the owner's real costs before publishing them ([Chapter 18](#ch-18)).

## 1.4 What the owner must decide

The decisions are listed in [Chapter 18](#ch-18) and the missing information in [Chapter 19](#ch-19). The most urgent are: confirm the SaaS-first model; approve or change the prices; decide whether ISMS is owned by Dennis personally or by a registered company; fix the readiness gaps before the first invoice; and have a Kenyan advocate turn the contract checklist ([Appendix C](#app-c)) into signed agreements.

# Chapter 2: Scope, Objectives and Method

## 2.1 Scope

Included: commercial models, licensing, hosted subscription, roles, costs, pricing, financial calculations, maintenance and support, customer contracts, intellectual property and transfers, resellers, the software business's own records, risks, decisions and information gaps.

Not included: changes to the application, database, functions or the three existing documents; legal advice (legal points are flagged for an advocate); tax advice (tax points are flagged for an accountant); marketing plans.

## 2.2 Objectives

1. Show how ISMS can generate revenue under each commercial model.
2. Show what each customer pays for, and what the owner is obliged to provide.
3. Identify every cost that prices must recover, and who bears it.
4. Give price recommendations that follow from costs and stated assumptions.
5. Explain how ownership can be licensed, sold or transferred without breaking obligations to existing customers.

## 2.3 Readers

**Table 2.1:** Intended readers

| Reader | Uses this document to |
|---|---|
| Software owner | Choose the model, approve prices, sign contracts |
| Accountant or tax adviser | Set up the software business's records, check the tax treatment, review the financial model |
| Business manager or partner | Sell, onboard and support customers within agreed rules |
| Developer or maintenance provider | Understand what maintenance and support are owed, and what is chargeable |
| Prospective investor or acquirer | Understand the asset, its obligations and its economics |
| Kenyan advocate | Draft the agreements listed in [Appendix C](#app-c) |

## 2.4 Evidence labels

Every material statement is labelled with the strength of its evidence ([Table 2.2](#t-2-2)).

**Table 2.2:** Evidence labels used in this document

| Label | Meaning | Example |
|---|---|---|
| **Verified** | Read from the code, the database design, the repository or a measurement on the live system | The app has no licence check |
| **List price** | A provider's published price as recorded in `docs/infrastructure/cost-management.md` (November 2026). Check the provider's page before budgeting | Supabase Pro USD 25 a month |
| **Estimate** | Worked out from measurements and stated assumptions | About 2.2 KB of database per sale |
| **Assumption** | A value chosen to make a calculation possible. It must be replaced by the owner's real figure | 40 hours of maintenance a month |
| **Recommendation** | Advice for the owner to accept, change or reject | Starter plan at KSh 3,000 a month |
| **Legal point** | A matter of law. To be confirmed by a qualified Kenyan advocate (or tax adviser) before relying on it | Copyright assignment must be in writing |
| **Owner input** | Information only the owner can provide | Domain renewal price |

## 2.5 Sources examined

The repository at commit `42507c4` (24 November 2026): the LICENSE and TERMS files, `package.json` and the open-source licences of the direct dependencies, the database migrations, the edge functions, the GitHub workflows, the git history, the three existing documents, the cost management record, the accounts register, the threat register and the To finish list. The full list is in [Appendix G](#app-g).

## 2.6 Conventions

- **Currency.** Amounts are in Kenyan shillings (KSh). Provider prices in US dollars are converted at the assumption **USD 1 = KSh 129** (assumption A-01). Replace it with the rate on the day of budgeting.
- **Rounding.** Calculated amounts are rounded to whole shillings for readability. Invoices issued to customers follow the ISMS number rule: two decimal places (KSh 3,000.00).
- **Tax.** Prices exclude VAT unless stated ([Section 10.6](#s-10-6)).
- **Per month.** "A month" means a calendar month. Annual amounts are twelve times the monthly figure unless stated.
- **Names.** "ISMS" is the software. "KayKay's" is the name the apps currently carry. "The owner" means the owner of the ISMS intellectual property. "The customer" means a business that uses ISMS (a licensee or subscriber), not that business's own shoppers.

# Chapter 3: Definitions and Terminology

**Table 3.1:** Terms used in this document

| Term | Meaning in this document |
|---|---|
| Intellectual property (IP) | The legal rights in ISMS: copyright in the source code, database design, documentation and designs; trade secrets; the names and marks the product is sold under |
| Source code | The human-readable program text (`src/`, `website/`, `supabase/`, `src-tauri/`, `android/`) from which the apps are built |
| Deployed copy (instance) | A running installation of ISMS on its own database project and hosting, serving one customer or group |
| Tenant | One business on the shared platform, separated from others by `business_id` and row-level security |
| Licence | Written permission from the owner to use ISMS on stated terms, without transferring ownership |
| Perpetual licence | A licence with no end date, paid once; updates and support are bought separately |
| Term licence | A licence for a fixed period (monthly or annual) that must be renewed |
| Subscription (SaaS) | Use of ISMS as a hosted service for a recurring fee; hosting, updates and the included support are part of the service |
| Assignment | A transfer of ownership of the IP. The buyer becomes the owner |
| Exclusive licence | A licence under which the owner promises not to license the same rights to anyone else (in a stated territory, sector or period) |
| Non-exclusive licence | A licence that the owner may also grant to any number of other customers |
| Escrow | A deposit of the source code with a neutral third party, released to a customer if the owner stops supporting the product |
| Set-up fee | A one-off fee for creating the business, configuring it, importing data and initial training |
| MRR / ARR | Monthly / annual recurring revenue: the subscription fees in force at a point in time (ARR = MRR x 12) |
| ARPU | Average revenue per paying customer per month |
| Contribution margin | Price minus every cost that rises with each extra customer |
| Gross profit per customer | Price minus the direct cost of serving that customer (hosting share, AI, support, payment collection) |
| Break-even | The number of customers at which total contribution equals the fixed costs |
| CAC | Customer acquisition cost: sales and marketing spend divided by new customers won |
| LTV | Customer lifetime value: contribution per month times the expected months a customer stays |
| Churn | The share of paying customers who leave in a month |
| Data controller / processor | Under the Data Protection Act, 2019: the customer decides why and how its customers' data is used (controller); the ISMS operator processes it on the customer's behalf (processor) |
| Charge-out rate | The hourly price at which extra work is sold (distinct from the internal cost of an hour) |
| Fair use | A stated normal level of use of a shared resource (for example AI questions) beyond which the provider may limit or charge |

# Chapter 4: ISMS as a Commercial Asset

## 4.1 What ISMS is

ISMS runs a shop from one system: selling at the till, customers and their debts, wallets and points, money in and out, stock, buying from suppliers, deliveries, staff shifts and the books. It ships as the staff app (Android, Windows, Linux, web) and a customer website, on a Supabase backend (PostgreSQL 17, Auth, Storage, Realtime, 25 edge functions) with web hosting on Cloudflare Workers and releases through GitHub (Verified: README, ISMS-TD Chapter 2 and ISMS-TD Chapter 3).

## 4.2 Architecture facts that shape the commercial model

**Table 4.1:** Facts about the product and their commercial consequences

| Fact | Evidence | Commercial consequence |
|---|---|---|
| One shared database for all businesses; each business is a tenant | Verified, ISMS-TD Section 8.1 | SaaS is the natural model; shared costs must be allocated ([Section 9.3](#s-9-3)) |
| Only the platform owner can create a business (`is_system_creator`, `can_create_business`) | Verified, migration `20261128003` | The operator controls onboarding; a customer cannot start using ISMS without the operator. Supports a "paid before set-up" rule |
| Multi-branch: each branch has its own stock, sales and cash | Verified, ISMS-UG Chapter 3 and ISMS-UG Section 6.4 | Branch count is a meaningful price dimension |
| Roles and permissions are enforced in the database | Verified, ISMS-AG Chapter 3 and ISMS-AG Chapter 5 | Users can be counted per business; feature gating per plan would need a new mechanism ([Appendix E](#app-e)) |
| The database address is fixed when the app is built (`VITE_SUPABASE_URL`) and updates come from one release channel | Verified, ISMS-TD Section 15.6 and ISMS-TD Section 16.1 | A separate deployed copy for one customer needs its own builds, signing and update channel: a costly, custom engagement |
| The customer website is built per business (`VITE_WEBSITE_SLUG`) | Verified, ISMS-TD Section 16.1 | The online store is a per-customer set-up and hosting job: price it as an add-on |
| Payments, SMS, WhatsApp and eTIMS use each business's own provider accounts | Verified, ISMS-TD Chapter 12, cost-management section 2 | Transaction fees are the customer's; they are excluded from the subscription |
| AI uses shared Hugging Face tokens by default; a business may add its own key | Verified, ISMS-TD Section 12.7 | Shared AI must be fair-use limited; heavy users bring their own key |
| All email goes through one personal Gmail mailbox (about 500 a day) | Verified, OPS-04 | A paid email service is a required cost before about 20 businesses |
| Kenya-only assumptions: KSh, Nairobi time, +254 phones, M-Pesa, KRA | Verified, ISMS-TD Section 20.4 (EXP-03 to EXP-05) | Sell in Kenya only until these are changed; an export licence would need development |
| No per-business usage quota (EXP-01) | Verified, threat register | Usage and storage limits in a plan cannot yet be measured or enforced automatically |
| Data hosted in the EU (Supabase eu-west-3) | Verified, accounts register | Cross-border data transfer must be disclosed and lawful (Legal point, Data Protection Act, 2019) |

## 4.3 Functionality that influences pricing

**Table 4.2:** Modules and their pricing relevance

| Module (as documented) | Where described | Cost driver | Suggested plan |
|---|---|---|---|
| Quick Sale, POS, Sales Log, receipts, refunds, offline sales | ISMS-UG Chapter 8 to ISMS-UG Chapter 10 | Database rows and real-time messages per sale | All plans |
| Credit sales, invoices, customers, wallets | ISMS-UG Chapter 11 and ISMS-UG Chapter 12 | Database | All plans |
| Payments, expenses, petty cash | ISMS-UG Chapter 16 | Database | All plans |
| Inventory and stock | ISMS-UG Chapter 18 | Database | All plans |
| Shifts and clock-in | ISMS-UG Chapter 7 | Scheduled jobs | All plans |
| Home and reports | ISMS-UG Chapter 23 | Egress (data sent to devices) | All plans |
| Finance and accounting (double-entry books) | ISMS-UG Chapter 17 | Database | Business and Enterprise |
| Buying, suppliers, supplier view | ISMS-UG Chapter 20 | Database, notifications | Business and Enterprise |
| Production and bills of materials | ISMS-UG Chapter 19 | Database | Business and Enterprise |
| Deliveries and riders | ISMS-UG Chapter 21 | Push notifications, real time | Business and Enterprise |
| Promotions, points, referrals | ISMS-UG Chapter 13 | Database | Business and Enterprise |
| Regular orders | ISMS-UG Chapter 14 | Scheduled jobs | Business and Enterprise |
| Branch transfers | ISMS-UG Chapter 18 | Database | Business and Enterprise (needs 2+ branches) |
| Assistant and advisors (AI) | ISMS-UG Chapter 24 | Shared AI tokens | Business (fair use) and Enterprise |
| Online store and dial-code ordering | ISMS-UG Chapter 22, ISMS-TD Section 12.4 | Per-business website build and hosting; gateway fees (the customer's) | Add-on |
| M-Pesa, Airtel, card prompts; KRA eTIMS | ISMS-TD Chapter 12 | Customer's own provider fees; set-up time | Set-up service, not a monthly item |
| Google Sheets backup per business | ISMS-AG Section 12.4 | Set-up time | All plans |

> **Note:** No payment or tax integration has yet been run against the real provider or its sandbox (ISMS-TD Section 23.2). Do not sell M-Pesa, card, Airtel or eTIMS integration as a working feature until each has been tested live.

## 4.4 Existing legal instruments

Two documents already govern use of ISMS ([Table 4.3](#t-4-3)). The commercial model must work with them or change them deliberately.

**Table 4.3:** Key terms already in force (Verified)

| Instrument | Term | Effect on the commercial model |
|---|---|---|
| LICENSE s.2 | Downloading is not a licence; use needs a paid licence | Supports charging for use, not for the download |
| LICENSE s.3 | Limited, non-exclusive, non-transferable right for the business's internal use, on the devices and users covered; updates during the licence period | Matches a term licence or subscription |
| LICENSE s.4 | No copying, resale, reverse engineering, modification; no running ISMS as a service for others | Resellers and white-label partners need a separate written agreement |
| LICENSE s.5 | Source code is a trade secret; no licence includes it | A source-code licence needs a separate agreement |
| LICENSE s.6 | Fees and periods set by invoice; suspension after notice for non-payment | Invoices must state period, fee and scope |
| LICENSE s.7 | Business data belongs to the customer; export on request within 30 days after the licence ends | An export procedure and tool are needed ([Section 13.5](#s-13-5)) |
| LICENSE s.8 | Termination after 14 days' notice for breach or overdue fees | Suspension timeline in [Section 13.2](#s-13-2) builds on this |
| LICENSE s.11 | Liability capped at fees paid in the previous 12 months | Appropriate; advocate to confirm enforceability |
| TERMS s.5 | Data may be deleted 30 days after a licence ends, except where law requires keeping it | Recommended to extend to 90 days ([Section 13.3](#s-13-3)) |
| TERMS s.9 | Same-day response to problems that stop the business; other reports within 3 working days | Becomes the Standard support level ([Table 12.4](#t-12-4)) |

## 4.5 Readiness for paying customers

**Table 4.4:** Readiness items that must be closed before the first invoice

| ID | Gap | Why it matters commercially | Source |
|---|---|---|---|
| OPS-06 | Database very likely on the free plan: pauses after a week idle, no restorable backups, 500 MB | A paid customer's records could be lost or unavailable | ISMS-AG Section 2.3 |
| SEC-02 | Independent hourly backup never run (secrets unset) | No recovery from a provider-side failure | ISMS-AG Section 12.1 |
| SEC-03 | No two-step sign-in for owners and admins | Account takeover risk for customers' money records | Threat register |
| SEC-04 / SEC-05 | Test password published; earlier exposure cannot be ruled out | Reputational and legal exposure | Threat register |
| OPS-04 | All email through one personal mailbox | Sign-in codes stop at the daily cap | Cost management |
| OPS-05 | One person holds every account and key | Service cannot be continued if the owner is unavailable | Accounts register |
| Test data | Seed data on the live database | Must be wiped before real use | ISMS-TD Section 23.3 |
| EXP-06 | Registration with the Data Commissioner (ODPC) unconfirmed | Legal point: processing customers' personal data as a business | Threat register |

## 4.6 Commercial capabilities the app does not have

A search of the code and migrations for licence, subscription, plan, trial and billing features found none apart from a notice on the About screen ("Licensed software: use needs a paid licence"). The capabilities in [Table 4.5](#t-4-5) are therefore **proposed**, not existing. Each is described further in [Appendix E](#app-e).

**Table 4.5:** Missing commercial capabilities (Verified absent)

| Capability | Needed for | Workaround until built |
|---|---|---|
| Plan and entitlement per business (which modules, branches, users) | Tiered plans | Contract terms; operator checks counts monthly |
| Licence status per business (active, overdue, restricted, suspended) | Suspension for non-payment | Operator disables staff accounts by hand |
| Read-only (restricted) mode | Graceful suspension that still allows export | None: suspension today means removing access |
| Usage metering per business (database rows, files, AI calls, egress) | Usage and storage charges | Operator SQL queries |
| Self-service full data export per business | LICENSE s.7 export promise | Operator export by SQL; Google Sheets backup covers part |
| Subscription invoicing and payment reconciliation | Billing | Separate accounting records ([Chapter 16](#ch-16)) |
| Per-customer branding (white-label) | Resellers, branded deployments | Not possible without a build per customer |
| Per-customer build and update channel | Separate deployed copies | Custom engagement |

# Part II: Commercial Models

# Chapter 5: Complete Software Sale and Acquisition

## 5.1 Six forms of sale

"Selling the software" can mean six very different transactions ([Table 5.1](#t-5-1)). They differ in what leaves the owner's hands, and in what obligations stay behind.

**Table 5.1:** Forms of sale and what the buyer acquires

| # | Form | What the buyer acquires | What the buyer does not acquire |
|---|---|---|---|
| S1 | Sale of a deployed copy | A running installation on its own database and hosting, with a licence to use it, and usually its hosting accounts | Ownership of the IP; the source code; the right to resell |
| S2 | Perpetual licence | A permanent right to use a stated version, for a stated business and scope | Ownership; source code; future versions unless maintenance is bought |
| S3 | Source-code licence | A copy of the source code and the right to modify and build it for stated purposes | Ownership; the right to sell or license ISMS to others (unless stated) |
| S4 | Assignment of the IP | Ownership of the copyright, designs, documentation and (if included) the names. The buyer becomes the licensor | Anything left out of the assignment schedule (for example the owner's other software, general know-how) |
| S5 | Sale of the product and business | The IP plus the customer contracts, subscriptions, provider accounts, domain, brand, records and goodwill (as a business or by selling the company) | Liabilities left with the seller by the agreement |
| S6 | Sale with retained rights | One of S3 to S5, with rights kept back: for example a licence back to the seller, a reserved territory or sector, the right to keep serving existing customers, or a royalty | Whatever is retained |

## 5.2 Rights transferred and retained

**Table 5.2:** Rights and obligations under each form of sale (Recommendation; Legal point for final wording)

| Question | S1 Deployed copy | S2 Perpetual licence | S3 Source-code licence | S4 IP assignment | S5 Product and business | S6 Sale, rights retained |
|---|---|---|---|---|---|---|
| Who owns the IP afterwards | Owner | Owner | Owner | Buyer | Buyer | Buyer, subject to retained rights |
| Rights transferred | Use of one installation | Use of one version | Use, modify, build for stated purposes | All IP rights in the schedule | IP, contracts, accounts, goodwill | As S4/S5 less the retained rights |
| Rights the developer keeps | All IP; right to sell to others | All IP | All IP; right to license others | None in the assigned IP, except a licence back if agreed | None, except as agreed | The retained rights, for example a licence back to keep using and adapting the code |
| Can the developer keep developing or selling similar software | Yes | Yes | Yes | Only general skills and non-copied work; a non-compete clause may limit it | Usually restricted by a non-compete for a period | Yes, within the retained rights |
| Can the customer modify it | No | No | Yes, within the licence | Yes | Yes | Yes |
| Can the customer redistribute or resell it | No | No | Not unless the licence says so | Yes | Yes | Yes, subject to retained rights |
| Is future maintenance included | Only if bought | Only if bought (annual maintenance) | No; optional paid support | No; transition support is negotiated | Transition period negotiated | Negotiated; may stay with the seller under a maintenance contract |
| Infrastructure and subscriptions | Customer's accounts, paid by the customer | Customer's accounts | Customer's accounts | Buyer takes over or replaces the owner's accounts | Accounts transferred to the buyer | As agreed |
| Existing SaaS customers and their data | Unaffected | Unaffected | Unaffected | Contracts and data stay with the operator unless also transferred; customers must be told | Transferred with notice to each customer; data moves with the processor role | As agreed |
| Outstanding subscriptions and support obligations | Unaffected | Unaffected | Unaffected | Remain the seller's unless assigned with customer consent | Assigned to the buyer; prepaid periods honoured | As agreed |

### 5.2.1 Legal and commercial implications

- **S1 Deployed copy.** Commercially a custom project: it needs its own builds, signing keys, update channel, monitoring and backups ([Table 4.1](#t-4-1)). The customer must hold its own Supabase and Cloudflare accounts so the copy survives without the owner. Licence terms must forbid copying the deployment to other businesses.
- **S2 Perpetual licence.** The customer pays once but the product depends on hosted services that cost money every month; the licence must state that hosting is the customer's cost and that updates and support after the first year are paid. Legal point: the licence must still survive if the owner stops trading, so escrow is advised for large perpetual customers.
- **S3 Source-code licence.** Exposes the trade secret (LICENSE s.5). Requires a confidentiality clause, a list of permitted purposes, a ban on competing products, and a statement of the open-source components included and their licences ([Section 14.2](#s-14-2)).
- **S4 Assignment.** Legal point: under the Copyright Act (Cap. 130 of Kenya) an assignment of copyright must be in writing and signed by the assignor; the assignment schedule must list every asset. Existing customer licences continue: the buyer steps into the licensor's position only if the licences are assigned, and customers should be notified.
- **S5 Product and business.** Either an asset sale (each contract, account and domain is assigned one by one, with customer consent where needed) or a share sale of the company that owns ISMS. A share sale is only possible if ISMS is first assigned into a company ([Section 14.1](#s-14-1)). Data protection: the buyer becomes the processor; customers must be told and the processing contract updated.
- **S6 Retained rights.** Common forms: a non-exclusive licence back to the seller; a royalty on future sales; the seller keeping a maintenance contract. Every retained right must be listed precisely or it is lost.

## 5.3 When each form is suitable

**Table 5.3:** Suitability and suggested amounts for each form of sale (Recommendation)

| Form | Suitable when | Suggested amount | How the amount is derived |
|---|---|---|---|
| S1 Deployed copy | A large customer insists on its own database and hosting | Perpetual licence fee (S2) plus deployment of about 40 hours at KSh 2,500 = **KSh 100,000**, plus hosting paid by the customer directly (about USD 25 to 30 a month at list price) | Hours times charge-out rate |
| S2 Perpetual licence | A customer prefers a one-off payment | **KSh 220,000** once for one business (up to 3 branches), plus **KSh 44,000 a year** for updates and Standard support (20%) | About 3 years of the Business plan (3 x 12 x KSh 6,000 = KSh 216,000), rounded; maintenance at 20% a year is a common software convention (Assumption A-20) |
| S3 Source-code licence (non-exclusive, internal use and modification only) | A business or developer wants to adapt ISMS for its own use | About **KSh 2,100,000** | 35% of the IP asking value in [Section 5.5](#s-5-5) (Assumption A-21) |
| S3 Exclusive source-code licence (territory or sector, 3 years) | A partner wants sole rights in a region or sector | About **KSh 3,600,000** plus an annual fee or royalty | 60% of the asking value (Assumption A-21); exclusivity removes the owner's own sales in that field |
| S4 IP assignment | The owner wants to exit entirely | Asking about **KSh 6,000,000**; floor about **KSh 3,600,000** | [Section 5.5](#s-5-5) |
| S5 Product and business | Once there are paying customers | IP value plus a multiple of ARR | [Section 5.5](#s-5-5), formula F-15 |
| S6 Sale, rights retained | The owner wants cash now but to keep using or maintaining ISMS | IP value less a discount for each retained right, or plus a maintenance contract | Negotiated |

## 5.4 Recommendation on outright sale

**Recommendation:** do not sell or assign the IP now. ISMS has no revenue yet and is not ready for paying customers ([Section 4.5](#s-4-5)), so any valuation today rests on cost alone and will be low compared with its value once it has paying customers. Run the SaaS model first; revisit S4 or S5 when ARR exists. Offer S1/S2 only to a customer large enough to pay for the custom work, and S3 only with an advocate-drafted agreement.

## 5.5 Valuation methods

**Table 5.4:** Methods for valuing ISMS

| Method | Formula | Inputs available today | Result |
|---|---|---|---|
| Cost actually invested | F-13: Value = hours spent x internal rate + cash spent | **Owner input:** hours and cash spent are not recorded. Git history runs from 16 July 2026 (229 commits on 27 distinct days), but the copyright notice says 2024 to 2026 | Not computable yet (Gap G-07) |
| Replacement cost | F-14: Value = person-months to rebuild x cost per person-month | About 148,000 lines of source (Verified: `src` 88,631; migrations 36,759; `website/src` 9,733; edge functions 9,598; Android Java 2,936; Rust 351). Basic COCOMO would give 340 to 456 person-months, which overstates effort for modern, tool-assisted development. **Assumption A-22:** 18 to 36 person-months at **KSh 200,000** a person-month | **KSh 3,600,000 to 7,200,000** |
| Income (once revenue exists) | F-15: Value = ARR x multiple (+ IP value if not already reflected) | ARR is zero today. Multiples for small software businesses vary widely; **Assumption A-23:** 2 to 4 times ARR, to be confirmed by a valuer | Example: ARR KSh 5,400,000 (100 customers, [Table 11.7](#t-11-7)) gives KSh 10.8 to 21.6 million |
| Market comparison | Prices of similar Kenyan software sales | **Owner input:** none collected | Not computable |

**Suggested position today:** floor (walk-away) KSh 3,600,000, the low end of replacement cost; asking about KSh 6,000,000, inside the replacement-cost range and allowing for negotiation. An independent valuation is advised before any offer is accepted.

# Chapter 6: Software Licensing Framework

## 6.1 Principle

ISMS is **licensed, not sold** (LICENSE s.9). The owner keeps the IP and grants each customer a limited right to use it. Every commercial model in this document except S4 and S5 is a form of licence.

## 6.2 Licence types evaluated

**Table 6.1:** Licence types and their fit with ISMS

| Type | How it would work for ISMS | Advantages | Disadvantages | Verdict |
|---|---|---|---|---|
| Perpetual | One payment for permanent use of a version | Cash up front; simple for the customer | ISMS depends on hosted services that cost money monthly; no recurring income to pay for them; customers on old versions break against a changing server | Only with a separate deployed copy (S1) and paid maintenance |
| Annual | Use for 12 months, renewable | Predictable income; lower collection effort | Larger single payment for small shops | **Offer**, at 10 x monthly |
| Monthly | Use for one month, renewable | Affordable for small shops; matches cash flow | More collections and more churn | **Offer** (default) |
| Module-based | Pay per module (accounting, deliveries, online store) | Customers pay for what they use | Requires feature gating that does not exist; more complex to sell and support | Bundle modules into plans; only the online store is a separate add-on |
| Enterprise | Negotiated licence for a group with many branches | Higher value; tailored terms | Custom contracts, higher support load | **Offer** on quotation |
| Restricted | Use limited by branches, users, devices, period, purpose | Protects the owner; aligns price with value | Limits cannot be enforced in the app yet | **Use** (all licences are restricted by plan) |
| Unrestricted | No limits on users, branches or purpose | Simple | Uncontrolled cost; under-pricing | Not recommended, except inside an enterprise contract with a price per extra branch |
| Exclusive | Only one licensee in a territory or sector | High fee | Blocks the owner's own sales; big commitment | Only as S3 exclusive, with minimum performance targets |
| Non-exclusive | Any number of licensees | Scales; matches LICENSE s.3 | — | **Standard** |

## 6.3 Recommended licence structure

**Table 6.2:** Recommended licence structure

| Element | Recommendation |
|---|---|
| Licence type | Non-exclusive, non-transferable, restricted term licence, delivered as a hosted subscription |
| Licensee | One named business (legal name and KRA PIN on the invoice) |
| Scope | The branches and users of the chosen plan; internal business use; the business's own shoppers may use the customer website |
| Term | One month or one year, renewing automatically when paid |
| Proof of licence | The paid invoice or receipt naming the business, plan, period and limits (as LICENSE s.1 already allows) |
| Updates | All updates released during the paid period are included |
| Source code | Never included (LICENSE s.5) |
| Other forms | Perpetual licence only with a separate deployed copy; source-code and exclusive licences only by separate signed agreement |

## 6.4 Licence lifecycle

**Table 6.3:** Validity, renewal, suspension, termination and transfer

| Stage | Rule (Recommendation, building on LICENSE s.6 and s.8) |
|---|---|
| Validity | From the date the first fee is received to the end of the paid period |
| Renewal | Automatic on payment of the next fee; the owner may change prices with 30 days' written notice, effective at the next renewal; annual prices fixed for the paid year |
| Grace | 7 days after the due date; full access continues |
| Restriction | From day 15 overdue (after written notice): read-only, export allowed (needs the read-only mode in [Table 4.5](#t-4-5); until built, go straight to the next stage with longer notice) |
| Suspension | From day 30 overdue, after 14 days' written notice (LICENSE s.8(b)): staff sign-in blocked; data kept untouched |
| Termination | By either side with 30 days' notice for convenience; by the owner for unremedied breach (14 days) or unpaid fees (after suspension) |
| After termination | Export window 30 days (LICENSE s.7), data kept at least 90 days in total, then deleted after a final written notice ([Section 13.3](#s-13-3)) |
| Transfer | Not without the owner's written consent (LICENSE s.13(e)); consent normally given when the business itself is sold, with a KSh 2,500 administration fee (one hour) |
| Change of plan | Upgrade at any time, charged pro rata; downgrade at the next renewal |

## 6.5 Permitted use and restrictions

**Table 6.4:** Permitted use and restrictions (aligned with LICENSE s.3 and s.4)

| Permitted | Not permitted |
|---|---|
| Use for the named business's own operations | Use for other businesses, or running ISMS as a service for others |
| The branches and users in the plan | More branches or users than paid for (each extra is charged) |
| The business's customers using its online store | Sharing staff log-ins between people |
| Exporting and keeping the business's own data | Copying, reselling, sublicensing or reverse-engineering the apps |
| Installing the apps on the business's devices | Removing licence notices or bypassing access controls |

## 6.6 Suggested licence amounts

**Table 6.5:** Suggested licence fees by type (Recommendation; excluding VAT)

| Licence | Suggested fee | Notes |
|---|---|---|
| Monthly term licence (hosted) | The plan fee in [Table 7.2](#t-7-2) | Default |
| Annual term licence (hosted) | 10 x the monthly plan fee | Two months free for paying ahead |
| Enterprise licence | From KSh 12,000 a month, plus KSh 1,500 a month per branch above the included number | Quoted |
| Perpetual licence (separate deployed copy) | KSh 220,000 once plus KSh 44,000 a year maintenance | [Table 5.3](#t-5-3) |
| Source-code licence, non-exclusive | About KSh 2,100,000 | [Table 5.3](#t-5-3) |
| Source-code licence, exclusive (3 years) | About KSh 3,600,000 plus an annual fee or royalty | [Table 5.3](#t-5-3) |

## 6.7 Changes advised to the current LICENSE

**Table 6.6:** LICENSE changes for an advocate to consider (Legal point)

| Clause | Change |
|---|---|
| s.1 Definitions | Define plans, branches, users and the hosted service; define "Subscription" |
| s.6 Fees | Add the grace, restriction and suspension stages of [Table 6.3](#t-6-3); price-change notice |
| s.7 Data | Name the processor role, the hosting location (EU) and the export format; align with the 90-day retention recommended here |
| s.8 Termination | Add termination for convenience by either side with 30 days' notice; what happens to prepaid fees |
| New | Service levels by reference to a support schedule ([Table 12.4](#t-12-4)) |
| New | A data processing agreement (Data Protection Act, 2019) as a schedule |
| TERMS s.5 | Change "may delete after 30 days" to match the 90-day rule |

# Chapter 7: SaaS Subscription Model

## 7.1 Why SaaS is the primary model

ISMS is already a hosted, multi-tenant service: one database, one set of server functions, one release channel, and the operator creates every business ([Table 4.1](#t-4-1)). A subscription pays the monthly hosting and maintenance that the product needs to keep working. Every other model needs extra engineering or gives away the asset.

## 7.2 Pricing dimensions evaluated

**Table 7.1:** Pricing dimensions for the subscription

| Dimension | Fits ISMS? | Can it be measured today? | Recommendation |
|---|---|---|---|
| Monthly subscription | Yes | Yes (by invoice) | Default |
| Annual subscription | Yes | Yes | Offer at 10 x monthly |
| Tiered plans | Yes | Partly: branches and staff can be counted by SQL; modules cannot be switched off per plan | Three plans ([Table 7.2](#t-7-2)) |
| Per-branch charge | Yes: each branch has its own stock, sales and cash | Yes (`branches` per business) | Included branches per plan, then KSh 1,500 a month per extra branch |
| Extra-user charge | Yes | Yes (active memberships) | KSh 300 a month per staff user above the plan |
| Usage (per sale or transaction) | Weak: penalises busy shops, hard to predict | Yes (sales rows) | Do not charge per sale; use fair-use limits |
| Storage limit and overage | Yes, as a safeguard | Partly (file storage per business by SQL; database share not measured) | Allowance per plan; KSh 50 per GB a month above it |
| Premium support | Yes | — | KSh 3,000 a month add-on; included in Enterprise |
| Enterprise arrangement | Yes | — | Quoted |

## 7.3 Recommended plans

**Table 7.2:** Subscription plans (Recommendation; excluding VAT)

| Plan | Monthly | Annual (10 x) | Branches | Staff users | File storage | Modules |
|---|---|---|---|---|---|---|
| Starter | KSh 3,000 | KSh 30,000 | 1 | 3 | 1 GB | Selling, customers and credit, payments and expenses, stock, shifts, reports, offline sales, Google Sheets backup |
| Business | KSh 6,000 | KSh 60,000 | Up to 3 | 10 | 5 GB | Starter plus accounting, buying and suppliers, production, deliveries and riders, promotions and points, regular orders, branch transfers, AI assistant and advisors (fair use) |
| Enterprise | From KSh 12,000 | From KSh 120,000 | By contract (4 or more) | By contract | By contract | Everything, plus Premium support, quarterly review, scheduled data exports |

Riders, suppliers using the supplier view and the business's own shoppers are not counted as staff users (Recommendation: they create little load and charging for them would discourage use).

## 7.4 What each plan includes and excludes

**Table 7.3:** Included and excluded services

| Item | Starter | Business | Enterprise |
|---|---|---|---|
| Hosting, database, backups, security updates | Included | Included | Included |
| All new versions and features of included modules | Included | Included | Included |
| Standard support (TERMS s.9 targets) | Included | Included | Included |
| Premium support | Add-on | Add-on | Included |
| Push notifications, email notices, shared AI (fair use) | Notifications included; AI not included | Included | Included |
| Set-up, data import, first training | Set-up fee | Set-up fee | Set-up fee (quoted) |
| Online store (customer website) | Add-on | Add-on | Add-on or by contract |
| M-Pesa, Airtel, card, SMS, WhatsApp, eTIMS provider fees | Excluded: customer's own accounts | Excluded | Excluded |
| Connecting a payment or eTIMS account | Chargeable set-up (time) | Chargeable set-up | Included once |
| Custom features, reports or integrations | Excluded: change request | Excluded | Excluded unless contracted |
| On-site visits | Excluded | Excluded | By contract |
| Hardware (printers, phones, tills) | Excluded | Excluded | Excluded |

## 7.5 Add-ons and extra charges

**Table 7.4:** Add-ons (Recommendation; excluding VAT)

| Add-on | Price | Basis |
|---|---|---|
| Extra branch | KSh 1,500 a month | Each branch adds stock, sales and support; half a Starter plan |
| Extra staff user | KSh 300 a month | Support and real-time connections per user |
| Extra file storage | KSh 50 per GB a month | Safeguard against uncontrolled growth; provider list price is far lower, the margin covers backups and handling |
| Online store set-up | KSh 30,000 once | About 12 hours (build, domain, deploy, products) at KSh 2,500 |
| Online store hosting and upkeep | KSh 1,500 a month | Build and release per business with every update |
| Premium support | KSh 3,000 a month | About 1 extra hour a month plus priority |
| Own AI key instead of fair use | Free | The customer pays its AI provider directly |
| Payment or eTIMS connection | KSh 5,000 per connection | About 2 hours at KSh 2,500 |

## 7.6 Onboarding, migration, training and cancellation

**Table 7.5:** Subscription lifecycle

| Step | What happens | Fee |
|---|---|---|
| Quotation and agreement | Plan, add-ons and set-up agreed; subscription agreement and data processing terms signed | None |
| Set-up fee paid | The operator creates the business (only the operator can) | Set-up fee ([Table 13.1](#t-13-1)) |
| Configuration | Business details, branches, roles, receipts, payment methods | In the set-up fee |
| Data import | Products, customers, opening stock and balances from the customer's spreadsheet | In the set-up fee up to 500 products and 500 customers; more at KSh 2,500 an hour |
| Training | One 2-hour remote session for owner and admins; the User Guide (ISMS-UG) for staff | In the set-up fee; extra at KSh 2,500 an hour |
| First month | Subscription starts on go-live day; pro-rated to the next billing date | Plan fee |
| Migration from another system | Export from the old system, mapping, import, checking balances | Quoted at the charge-out rate |
| Cancellation | 30 days' notice; access to the end of the paid period; export window; deletion after notice ([Section 13.4](#s-13-4)) | None; exports after the window are charged |

## 7.7 Fair use

The shared AI allowance, email and real-time traffic are shared resources. The subscription agreement should define fair use as the normal use of a business of the plan's size, allow the operator to limit use that harms others, and require a business that exceeds it repeatedly to add its own AI key or move up a plan. (Recommendation. Fair-use limits cannot be measured per business until usage metering is built; see [Appendix E](#app-e).)

## 7.8 Annual against monthly billing

Annual billing at 10 times the monthly fee gives the customer two months free and gives the owner cash in advance, lower collection cost and lower churn. Because annual fees are received in advance for service not yet delivered, they are recorded as deferred revenue and recognised month by month ([Chapter 16](#ch-16)). Refund rules for annual plans are in [Table 13.4](#t-13-4).

# Chapter 8: Commercial Roles and Responsibilities

## 8.1 Roles defined

**Table 8.1:** Commercial roles

| # | Role | Responsibilities | Revenue entitlement | Liabilities and obligations |
|---|---|---|---|---|
| 1 | Software owner | Holds the IP; decides licensing, prices and sale | Licence fees, royalties, sale proceeds | Defending the IP; warranties given on sale; tax on income |
| 2 | Software licensor | Grants licences; enforces their terms | Licence fees | Honouring licence terms; warranties in the licence |
| 3 | Software vendor | Markets and sells licences or subscriptions; issues invoices | Sales revenue or commission | Accuracy of sales claims; consumer and contract law; tax invoices |
| 4 | SaaS provider (operator) | Runs the hosted service for customers; creates businesses; applies updates | Subscription fees | Availability and security of the service; processor duties under the Data Protection Act, 2019; backups; service levels |
| 5 | Software developer | Writes and changes the code | Salary, fees or development contract | Quality of work; assigning the copyright in their work to the owner |
| 6 | Maintenance provider | Fixes defects, keeps dependencies and security current, adapts to provider changes | Maintenance fees | Agreed maintenance scope and timelines |
| 7 | Hosting and infrastructure provider | Supplies database, hosting, storage (Supabase, Cloudflare, GitHub) | Its own fees from the operator | Its own terms; usually very limited liability to the operator |
| 8 | Technical support provider | Answers customers, diagnoses problems, guides configuration | Support fees or a share of subscription | Response targets; correct advice |
| 9 | Customer (licensee) | Uses ISMS within the licence; pays fees; controls its own business data and its customers' personal data | — | Paying on time; lawful use; data controller duties; its own tax filings and eTIMS |
| 10 | Business partner or reseller | Finds and may serve customers under a partner agreement | Commission or margin ([Chapter 15](#ch-15)) | Not misrepresenting ISMS; first-line support if agreed; confidentiality |
| 11 | Software acquirer | Buys the IP or the business | Future revenue | Takes over obligations assigned to it: customer contracts, prepaid periods, data processing |

## 8.2 Who holds each role today

**Table 8.2:** Roles held today (Verified unless stated)

| Role | Holder today |
|---|---|
| Owner, licensor, vendor | Dennis Kimanthi Gitonga, trading as Codensons (LICENSE) |
| SaaS provider (operator) | The same person: holds every provider account (accounts register, OPS-05) |
| Developer, maintenance provider, support provider | The same person (single git author; TERMS s.9) |
| Hosting providers | Supabase (EU, project `kaykays`), Cloudflare Workers, GitHub, Google Firebase and Gmail, Hugging Face, Telegram |
| Customers | No paying customers recorded (Owner input to confirm). Live data holds two businesses, one of which is seed test data |
| Resellers | None |

Holding all roles in one person keeps decisions simple but concentrates risk: if the owner is unavailable, no one can run, support or repair the service (Risk R-09, [Chapter 17](#ch-17)).

## 8.3 Responsibility matrix

**Table 8.3:** Who is responsible (R), accountable (A), consulted (C) or informed (I)

| Activity | Owner | Operator | Developer / maintenance | Support | Reseller | Customer |
|---|---|---|---|---|---|---|
| Set prices and licence terms | A/R | C | — | — | C | I |
| Sign the customer agreement | A | R | — | — | R (if reselling) | R |
| Create and configure the business | I | A/R | — | C | C | C |
| Pay provider bills | A (if owner operates) | R | — | — | — | — |
| Keep the service running and backed up | I | A/R | C | I | — | I |
| Fix defects and security issues | I | A | R | C | I | I |
| Answer users' questions | — | A | C | R | R (first line, if agreed) | I |
| Keep business data correct; lawful use of customers' data | — | C (processor) | — | — | — | A/R (controller) |
| Invoice and collect fees | A | R | — | — | R (if reselling) | Pays |
| Export or delete data on request | I | A/R | C | C | I | Requests |

## 8.4 When the owner and the operator are different

**Table 8.4:** Split-role scenarios

| Scenario | Who earns what | Who is responsible to customers | Agreements needed |
|---|---|---|---|
| A. Owner licenses an operator (for example a hosting company or a partner in another town) to run ISMS as a service | Operator collects subscriptions; pays the owner a royalty per customer (for example 30 to 40% of subscription, Assumption) or a fixed platform fee | Operator: service, support, data processing. Owner: defects in the software | Operator licence with service standards, royalty reporting, audit right, data and exit terms |
| B. Owner sells the IP but keeps operating the service for the buyer | Buyer owns the IP and the customer revenue; owner earns an operating and maintenance fee | Depends on who signs with customers; customers must know | Assignment plus a services agreement back to the seller |
| C. Owner keeps the IP, hands day-to-day support to a partner | Owner keeps subscriptions; partner earns a support fee or revenue share | Owner to customers; partner to owner | Subcontract with confidentiality and data-processing terms |
| D. Customer runs its own copy (S1/S2) | Owner earns licence and maintenance fees | Customer runs hosting; owner fixes defects under maintenance | Perpetual licence, maintenance agreement, optional escrow |

# Part III: Costs, Pricing and Financial Model

# Chapter 9: Cost Structure and Allocation

## 9.1 Principles

1. **A free tier is not a zero cost.** Free plans have limits, can be withdrawn, and lack features a paid service needs (the Supabase free plan has no restorable backups and pauses idle projects). Every free resource is budgeted at the price of its paid replacement.
2. **People are a cost even when the owner does the work.** The owner's hours on maintenance and support are priced at an internal rate (Assumption A-09), or prices will look profitable while the owner works unpaid.
3. **Shared costs are spread; attributable costs are charged.** Costs every customer causes together are recovered through the subscription; costs one customer causes are billed to that customer.
4. **Money rules apply to the software business too.** Every payment in and out is recorded, and the figures in reports come from the same records as the books (CLAUDE.md money rules).

## 9.2 Cost register

**Table 9.1:** Cost register

| Cost | ISMS today (evidence) | Fixed / variable / usage | Once / recurring | Shared / per customer | Absorb or charge | In subscription or billed separately |
|---|---|---|---|---|---|---|
| Application hosting (web app, website) | Cloudflare Workers, free (Verified) | Fixed, usage steps at scale | Recurring | Shared | Absorb | Subscription |
| Database hosting | Supabase, very likely free; Pro USD 25 a month needed (List price) | Fixed base plus usage overage | Recurring | Shared | Absorb | Subscription |
| Database storage | 37 MB live; about 80 MB a year per busy business (Estimate) | Usage | Recurring | Shared, attributable by business share | Absorb up to the plan | Subscription; enterprise by contract |
| File and object storage | 3.4 MB live; about 25 MB a year per business (Estimate) | Usage | Recurring | Attributable (files are per business) | Absorb up to allowance | Overage KSh 50 per GB a month |
| Backups | Supabase daily (Pro); R2 hourly copy, free up to 10 GB; secrets unset (Verified) | Fixed, usage at scale | Recurring | Shared | Absorb | Subscription |
| Bandwidth (egress) | About 1.5 GB a business a month (Estimate, least certain) | Usage | Recurring | Shared, attributable by business | Absorb | Subscription (fair use) |
| Domain registration | `kaykays.com` at DreamHost; price Owner input | Fixed | Yearly | Shared | Absorb | Subscription |
| Customer's own domain (online store) | Not yet | Fixed | Yearly | Per customer | Charge | Paid by the customer directly |
| DNS and CDN | Cloudflare, free (Verified) | Fixed | Recurring | Shared | Absorb | Subscription |
| Email delivery | Personal Gmail, free, capped (Verified, OPS-04); sending service about USD 20 a month (Estimate) | Fixed then usage | Recurring | Shared | Absorb | Subscription; bulk customer email by fair use |
| SMS | Per-business Twilio or Africa's Talking (Verified) | Usage | Recurring | Per customer | Charge | Customer pays the provider |
| WhatsApp | Per-business Meta account (Verified) | Usage | Recurring | Per customer | Charge | Customer pays the provider |
| Push notifications | Firebase FCM, no charge (List price) | Fixed (zero today) | Recurring | Shared | Absorb | Subscription |
| Payment gateway charges | Per-business M-Pesa, Airtel, Paystack (Verified) | Usage | Per transaction | Per customer | Charge | Customer pays the provider |
| Collecting the owner's own subscription fees | M-Pesa or bank charges on receipts (Owner input) | Variable, % of fee | Per payment | Per customer | Absorb in price | Subscription (1.5%, Assumption A-14) |
| AI (shared) | Hugging Face free credits, about USD 0.10 a month (Verified earlier) | Usage | Recurring | Shared | Absorb up to fair use | Subscription; heavy users own key |
| KRA eTIMS | Per business (Verified) | — | — | Per customer | Charge | Customer's own registration |
| Monitoring and logging | Telegram alerts, database watchdog (free); uptime monitor not set up | Fixed | Recurring | Shared | Absorb | Subscription |
| Security services | GitHub security scans (free, public repo); code-signing certificate for Windows not bought (SmartScreen warning) | Fixed | Yearly | Shared | Absorb | Subscription |
| Development tools | GitHub Free; Actions minutes free only while the repository is public (Verified) | Fixed, may rise if private | Recurring | Shared | Absorb | Subscription |
| AI coding and design tools used by the developer | Owner input | Fixed | Recurring | Shared | Absorb | Subscription |
| Customer support | Owner's time (TERMS s.9) | Variable (per customer) | Recurring | Attributable | Standard absorbed; premium charged | Subscription; Premium add-on |
| Maintenance and upgrades | Owner's time | Fixed (base) | Recurring | Shared | Absorb | Subscription (hosted); maintenance fee (perpetual) |
| Customer-specific work | Not yet | Variable | Once | Per customer | Charge | Billed separately |
| Technical personnel (future hires) | None | Fixed steps | Recurring | Shared | Absorb | Subscription |
| Accounting and administration | Owner input | Fixed | Recurring | Shared | Absorb | Subscription |
| Legal and compliance (contracts, ODPC, trademark) | Not yet incurred | Fixed | Once and periodic | Shared | Absorb, amortised | Subscription |
| Device testing (phones, printers) | Owner input | Fixed | Occasional | Shared | Absorb | Subscription |
| Taxes on the software business | Owner input (business structure unknown) | Variable | Periodic | — | — | Not a cost to price in as such; plan for it ([Section 10.6](#s-10-6)) |

## 9.3 Allocating shared infrastructure fairly

Shared costs (database plan, hosting, email, monitoring, backups) cannot be traced exactly to one business. [Table 9.2](#t-9-2) compares ways to share them.

**Table 9.2:** Allocation methods for shared costs

| Method | Formula | Fairness | Practicality today | Recommendation |
|---|---|---|---|---|
| Equal share | F-01: share = shared cost / active businesses | Low: a 1-branch shop pays as much as a 3-branch business | Easy | Use for the base platform fee only |
| By branches | F-02: share = shared cost x branches of the business / all branches | Good: load roughly follows branches | Easy (count `branches`) | **Use** for pricing plans and extra branches |
| By staff users | F-03: share = shared cost x users of the business / all users | Good for real-time and support load | Easy (count memberships) | Use for the extra-user charge |
| By measured usage | F-04: share = cost of resource x business's use / total use | Best | Not possible until usage metering exists (EXP-01) | Adopt once metering is built |
| By plan weight | F-05: share = cost x plan weight / sum of weights (Starter 1, Business 2, Enterprise 4) | Reasonable proxy | Easy | Use in monthly profitability reports |

**Recommendation:** price with plan weights and per-branch and per-user charges now; switch the profitability report to measured usage when metering exists.

## 9.4 Costs that belong to each customer

The customer pays directly, outside the subscription: payment provider fees (M-Pesa, Airtel, Paystack), SMS and WhatsApp messages, its own AI key if used, its eTIMS registration, its own domain for the online store, hardware, internet and devices. These are already set up as per-business accounts in ISMS (Verified), so no cost re-charging is needed.

## 9.5 Infrastructure cost at each growth stage

Estimates from the list prices in `docs/infrastructure/cost-management.md`, converted at KSh 129 per USD:

**Table 9.3:** Platform provider cost by number of businesses

| Businesses | Supabase plan and size | Monthly (USD) | Monthly (KSh) | Per business (KSh) |
|---|---|---|---|---|
| 0 to 10 | Pro, Micro | about 25 | about 3,225 | about 323 at 10 |
| 100 | Pro, Small; email service | about 55 | about 7,095 | about 71 |
| 1,000 | Pro, Large; point-in-time recovery | about 560 to 680 | about 72,240 to 87,720 | about 72 to 88 |
| 10,000 | About ten projects of 1,000 | about 6,000 to 7,000 | about 774,000 to 903,000 | about 77 to 90 |

The model in [Chapter 11](#ch-11) budgets **KSh 100 per business a month** for variable infrastructure (Assumption A-11) on top of the fixed base. That is above every per-business figure in [Table 9.3](#t-9-3) from 100 businesses up, which leaves a margin for the least certain estimate (egress).

# Chapter 10: Pricing Framework

## 10.1 Inputs to price

**Table 10.1:** Pricing inputs and their status

| Input | Value used | Status |
|---|---|---|
| Actual operating costs | [Table 11.2](#t-11-2) | Assumptions; provider bills Owner input |
| Infrastructure cost per customer | KSh 100 a month variable plus share of base | Estimate ([Section 9.5](#s-9-5)) |
| Expected usage | 100 sales a day, 3 devices, 3 users per business | Estimate (cost management, section 3) |
| Users and branches | Plan limits ([Table 7.2](#t-7-2)) | Recommendation |
| Storage | About 105 MB a business a year (80 database plus 25 files) | Estimate |
| Support workload | 1 hour a business a month (3 for Enterprise) | Assumption A-13; measure from the first customers |
| Maintenance expenditure | 40 hours a month | Assumption A-09 |
| Development investment | Not recorded | Owner input (Gap G-07) |
| Desired profit margin | 20% after fixed costs at target volume | Assumption A-24 |
| Market position | Kenyan small and medium shops; mid-priced, full-featured | Recommendation; to be validated |
| Customer affordability | Not researched | Owner input (Gap G-10) |
| Customer acquisition cost | KSh 11,000 a customer | Assumption ([Table 11.8](#t-11-8)) |

## 10.2 Pricing strategies compared

**Table 10.2:** Pricing strategies

| Strategy | How it works | Advantages | Disadvantages | Fit for ISMS |
|---|---|---|---|---|
| Cost-plus | Cost per customer plus a margin | Guarantees costs are covered; easy to explain to an accountant | Ignores what customers will pay; high price when few customers | Use as the **floor** ([Section 11.6](#s-11-6)) |
| Value-based | Price as a share of the value to the customer (time saved, losses prevented) | Captures more value; justifies higher plans | Value not yet measured with real shops | Use to set the **ceiling** once case studies exist |
| Competitive | Match or undercut similar Kenyan systems | Easy to sell | Competitor prices not collected (Gap G-10); race to the bottom | Check only |
| Penetration | Low price to win the first customers | Fast early adoption; references | Hard to raise prices later; cash shortfall | Use as a time-limited **launch discount** (for example 30% for the first 6 months, for the first 10 customers), never as the list price |
| Freemium | Free basic plan | Wide adoption | Free users cost money (hosting, support); no paywall exists in the app | **Not recommended** |
| Tiered | Plans by size and modules | Customers self-select; upgrade path | Needs plan limits enforced | **Recommended** (with manual checks until built) |
| Per user | Fee per staff user | Scales with customer size | Shops share log-ins to save money (forbidden, hard to police) | Use only for extra users above the plan |
| Per branch | Fee per branch | Matches load and value | Single-branch shops pay the base | **Recommended** as the main size dimension |
| Usage-based | Fee per sale or per GB | Matches cost | Unpredictable bills; metering not built | Only for storage overage |

## 10.3 Price formulas

- **F-06 Minimum sustainable price** for a target number of customers *N*: `P_min = (F / N + c) / (1 - p)`, where *F* = fixed monthly costs, *c* = variable cost per customer in shillings, *p* = variable cost as a share of price (collection fee plus bad-debt allowance).
- **F-07 Price with a target margin** *m*: `P = (F / N + c) / (1 - p - m)`.
- **F-08 Plan price from cost weight**: `P_plan = P_base x plan weight`, checked against F-06 for that plan alone.
- **F-09 Extra branch** ≈ half the Starter plan, because a branch adds roughly half the load and support of a new business (Assumption).
- **F-10 Set-up fee** = estimated hours x charge-out rate, rounded up to the next KSh 5,000.

## 10.4 Recommended price list

The recommended prices are in [Table 7.2](#t-7-2), [Table 7.4](#t-7-4) and [Table 13.1](#t-13-1), and collected in [Appendix B](#app-b). They are set so that:

- the Business plan alone breaks even at 23 customers and the Enterprise plan at 14 ([Table 11.5](#t-11-5));
- the Starter plan contributes above its variable cost from the first customer, but needs 82 customers to carry the fixed costs alone, so it is an entry plan, not the core of the business;
- an average of KSh 4,500 a month per customer (60% Starter, 35% Business, 5% Enterprise, Assumption A-25) breaks even at 39 customers.

## 10.5 Affordability and market checks

**Table 10.3:** Checks to run before publishing prices

| Check | How | Pass if |
|---|---|---|
| Willingness to pay | Show the plans to at least 5 shop owners of each size; ask which plan and whether the price is acceptable | At least 3 of 5 would pay the plan they need |
| Share of the customer's margin | Starter fee as a share of a small shop's monthly gross profit (Owner input) | Below an agreed threshold (for example 3%) |
| Competitor prices | Collect published prices of 3 to 5 systems sold in Kenya | ISMS is within the range for its features, or the difference is explained |
| Cost check | Recompute F-06 with real provider bills and measured support hours after 3 months | Prices stay above P_min at the actual customer count |

## 10.6 Tax treatment of prices

**Table 10.4:** Tax points for the software business (Legal point: confirm with a tax adviser)

| Tax | Point | Effect on pricing |
|---|---|---|
| VAT (16%) | Registration is compulsory once taxable turnover passes KSh 5 million in 12 months (as understood; confirm) | Quote prices "excluding VAT". 100 customers at KSh 4,500 a month (KSh 5.4 million a year) would pass the threshold, adding 16% to customers' bills |
| Turnover tax or income tax | Depends on whether the owner trades as an individual or a company, and on turnover | Plan the tax on profit; it is not a cost added to the price |
| Withholding tax | Some customers may withhold a percentage on software or service fees | State in the agreement whether prices are gross; account for withholding certificates |
| eTIMS invoices | The software business must itself issue eTIMS-compliant invoices to its customers if registered | ISMS could issue them once its own eTIMS integration is tested |

## 10.7 Price review

Review prices every 12 months and whenever a provider bill rises by more than 20%, using the monthly profitability report ([Chapter 16](#ch-16)). Give existing customers 30 days' notice; honour annual prepayments until renewal.

# Chapter 11: Financial Calculations and Scenarios

> **Important:** Every number in this chapter is illustrative. It is calculated from the assumptions in [Table 11.1](#t-11-1), not from the owner's actual costs. Replace each assumption with the real figure and recompute with the formulas in [Appendix A](#app-a).

## 11.1 Assumptions

**Table 11.1:** Assumptions used in the financial model

| ID | Assumption | Value | Basis |
|---|---|---|---|
| A-01 | Exchange rate | USD 1 = KSh 129 | Assumption; use the day's rate |
| A-02 | Supabase Pro plan | USD 25 a month = KSh 3,225 | List price |
| A-03 | Email sending service on the domain | USD 20 a month = KSh 2,580 | Estimate (cost management, section 4) |
| A-04 | Domain renewal | KSh 3,000 a year = KSh 250 a month | Placeholder; Owner input |
| A-05 | Windows code-signing certificate | KSh 50,000 a year = KSh 4,167 a month | Placeholder; obtain quotes |
| A-06 | Tools, backup storage, monitoring buffer | KSh 1,500 a month | Placeholder for paid tiers of free tools |
| A-07 | Bookkeeping | KSh 5,000 a month | Placeholder; obtain quotes |
| A-08 | Legal set-up (agreements by an advocate) | KSh 120,000 once, spread over 24 months = KSh 5,000 a month | Placeholder; obtain quotes |
| A-09 | Maintenance and development time | 40 hours a month at KSh 1,500 an hour = KSh 60,000 | Internal cost rate, not the charge-out rate |
| A-10 | Contingency | 10% of the fixed costs | Prudence |
| A-11 | Variable infrastructure per business | KSh 100 a month | Above [Table 9.3](#t-9-3) per-business costs from 100 businesses |
| A-12 | Shared AI per business | KSh 100 a month | Budget; free credits are not permanent |
| A-13 | Support time | 1 hour a month (Starter, Business); 3 hours (Enterprise) at KSh 1,500 | To be measured |
| A-14 | Cost of collecting fees | 1.5% of the fee | Placeholder; depends on the payment channel |
| A-15 | Bad-debt allowance | 5% of the fee | Prudence |
| A-16 | Monthly churn | 3% (base), 5% (pessimistic) | Assumption |
| A-17 | Marketing spend | KSh 20,000 a month | Placeholder |
| A-18 | Sales time per new customer | 4 hours at KSh 1,500 | Assumption |
| A-19 | New customers a month | 4 | Assumption |
| A-20 | Perpetual maintenance | 20% of the licence fee a year | Common software convention |
| A-21 | Source-code licence values | 35% (non-exclusive) and 60% (exclusive) of the IP asking value | Assumption |
| A-22 | Replacement effort | 18 to 36 person-months at KSh 200,000 | Assumption |
| A-23 | Business sale multiple | 2 to 4 times ARR | Assumption; valuer to confirm |
| A-24 | Target margin | 20% | Assumption |
| A-25 | Plan mix | 60% Starter, 35% Business, 5% Enterprise at KSh 12,000 | Assumption |

## 11.2 Fixed cost base

**Table 11.2:** Fixed monthly costs *F* (Assumptions A-02 to A-10)

| Item | KSh a month |
|---|---|
| Supabase Pro | 3,225 |
| Email sending service | 2,580 |
| Domain | 250 |
| Windows code-signing certificate | 4,167 |
| Tools, backup storage, monitoring | 1,500 |
| Bookkeeping | 5,000 |
| Legal set-up (spread) | 5,000 |
| Maintenance and development time | 60,000 |
| **Subtotal** | **81,722** |
| Contingency 10% | 8,172 |
| **Fixed costs F (rounded)** | **89,900** |

Maintenance time is 67% of the fixed costs; provider bills, the certificate and tools together are about 13%. The fixed base holds up to about 100 customers; beyond that, compute upgrades are covered by the variable infrastructure allowance, and extra staff by the support cost per customer.

## 11.3 Variable cost per customer

**Table 11.3:** Variable cost per customer per month

| Item | Starter and Business | Enterprise | Type |
|---|---|---|---|
| Infrastructure (A-11) | 100 | 100 | Shillings, *c* |
| Shared AI (A-12) | 100 | 100 | Shillings, *c* |
| Support (A-13) | 1,500 | 4,500 | Shillings, *c* |
| **c (fixed shillings)** | **1,700** | **4,700** | |
| Fee collection (A-14) | 1.5% | 1.5% | Share of price, *p* |
| Bad debt (A-15) | 5% | 5% | Share of price, *p* |
| **p** | **6.5%** | **6.5%** | |

## 11.4 Gross profit and contribution margin per plan

Formulas: **F-11** gross profit per customer `GP = P - c - 0.015 x P`; **F-12** contribution margin `CM = P x (1 - p) - c`.

**Table 11.4:** Gross profit and contribution per customer per month

| Plan | Price P | Gross profit | Gross margin | Contribution CM | Contribution margin |
|---|---|---|---|---|---|
| Starter | 3,000 | 1,255 | 41.8% | 1,105 | 36.8% |
| Business | 6,000 | 4,210 | 70.2% | 3,910 | 65.2% |
| Enterprise | 12,000 | 7,120 | 59.3% | 6,520 | 54.3% |
| Blended (A-25) | 4,500 | 2,583 | 57.4% | 2,358 | 52.4% |

Blended *c* = 0.95 x 1,700 + 0.05 x 4,700 = 1,850. Blended GP = 4,500 - 1,850 - 67.50 = 2,582.50. Blended CM = 4,500 x 0.935 - 1,850 = 2,358 (2,357.50).

## 11.5 Break-even customer count

Formula **F-16**: `N_breakeven = F / CM`, rounded up.

**Table 11.5:** Break-even customers

| Customer base | CM | Calculation | Break-even |
|---|---|---|---|
| Starter only | 1,105 | 89,900 / 1,105 = 81.4 | 82 |
| Business only | 3,910 | 89,900 / 3,910 = 23.0 | 23 |
| Enterprise only | 6,520 | 89,900 / 6,520 = 13.8 | 14 |
| Blended mix | 2,357.50 | 89,900 / 2,357.50 = 38.1 | 39 |

## 11.6 Minimum sustainable subscription price

Using F-06 and F-07 with *c* = 1,700 and *p* = 6.5% (a single-plan business):

**Table 11.6:** Minimum sustainable price by number of customers (KSh a month)

| Customers N | F / N | P_min (break-even) | Price with 20% margin |
|---|---|---|---|
| 10 | 8,990 | 11,433 | 14,544 |
| 20 | 4,495 | 6,626 | 8,429 |
| 40 | 2,248 | 4,222 | 5,371 |
| 50 | 1,798 | 3,741 | 4,759 |
| 100 | 899 | 2,780 | 3,536 |
| 200 | 450 | 2,299 | 2,924 |

Example (N = 50): (89,900 / 50 + 1,700) / 0.935 = (1,798 + 1,700) / 0.935 = 3,741. The recommended average of KSh 4,500 is sustainable from about 40 customers; the Starter price of KSh 3,000 becomes sustainable on its own only from about 82 customers.

## 11.7 MRR, ARR and profitability at different volumes

Formulas: **F-17** `MRR = sum of monthly fees in force` (here N x ARPU); **F-18** `ARR = MRR x 12`; **F-19** `Profit = MRR - N x (c + p x ARPU) - F`; **F-20** infrastructure cost per customer `= (provider base + N x 100) / N`.

**Table 11.7:** Profitability at different volumes (blended ARPU KSh 4,500)

| Customers | MRR | ARR | Variable costs | Fixed costs | Monthly profit | Margin | Total cost per customer | Infrastructure per customer |
|---|---|---|---|---|---|---|---|---|
| 10 | 45,000 | 540,000 | 21,425 | 89,900 | -66,325 | -147.4% | 11,133 | 423 |
| 25 | 112,500 | 1,350,000 | 53,563 | 89,900 | -30,963 | -27.5% | 5,738 | 229 |
| 39 | 175,500 | 2,106,000 | 83,558 | 89,900 | 2,042 | 1.2% | 4,448 | 183 |
| 50 | 225,000 | 2,700,000 | 107,125 | 89,900 | 27,975 | 12.4% | 3,941 | 165 |
| 100 | 450,000 | 5,400,000 | 214,250 | 89,900 | 145,850 | 32.4% | 3,042 | 132 |
| 250 | 1,125,000 | 13,500,000 | 535,625 | 89,900 | 499,475 | 44.4% | 2,502 | 113 |
| 500 | 2,250,000 | 27,000,000 | 1,071,250 | 89,900 | 1,088,850 | 48.4% | 2,322 | 106 |

Variable costs = N x (1,850 + 0.065 x 4,500) = N x 2,142.50. Infrastructure per customer = (3,225 + N x 100) / N. Above about 100 customers the fixed base will in practice step up (an employed support person, a bigger database), so the margins at 250 and 500 are upper bounds.

## 11.8 Customer acquisition cost and lifetime value

Formulas: **F-21** `CAC = (marketing + sales cost) / new customers`; **F-22** payback months `= CAC / CM`; **F-23** `LTV = CM / monthly churn`; **F-24** `LTV : CAC`.

**Table 11.8:** CAC, payback and LTV (blended)

| Measure | Calculation | Result |
|---|---|---|
| CAC | (20,000 + 4 x 4 x 1,500) / 4 = 44,000 / 4 | KSh 11,000 |
| Payback | 11,000 / 2,357.50 | 4.7 months |
| LTV at 3% churn | 2,357.50 / 0.03 | KSh 78,583 |
| LTV at 5% churn | 2,357.50 / 0.05 | KSh 47,150 |
| LTV : CAC | 78,583 / 11,000 and 47,150 / 11,000 | 7.1 and 4.3 |

A ratio above about 3 is generally taken as healthy. The set-up fee (KSh 10,000 to 25,000) recovers most of the acquisition cost at the start, which shortens payback further.

## 11.9 Sensitivity analysis

**Table 11.9:** Break-even customers as support time and infrastructure cost change (blended ARPU KSh 4,500)

| Infrastructure per business | Support x 0.5 | Support x 1 (base) | Support x 2 |
|---|---|---|---|
| KSh 100 (base) | 29 | 39 | 128 |
| KSh 200 (twice) | 30 | 40 | 148 |
| KSh 500 (five times) | 33 | 46 | 293 |

Reading: infrastructure prices barely move break-even; **support time is the deciding variable**. If each customer needs two hours a month instead of one, the business needs more than three times as many customers. Keep support efficient: the User Guide, short training videos, self-service troubleshooting, and Premium support charged separately.

**Table 11.10:** Storage and traffic growth (provider overage, KSh a month; list prices: extra disk USD 0.125 per GB, egress USD 0.09 per GB)

| Scenario | Database size | Egress a month | Overage | Note |
|---|---|---|---|---|
| 100 businesses, year 1 | 8 GB (included 8) | 150 GB (included 250) | 0 | Small compute +USD 15 (KSh 1,935) |
| 100 businesses, year 3 | 24 GB | 150 GB | 258 | Disk 16 GB over |
| 250 businesses, year 1 | 20 GB | 375 GB | 1,645 | Disk 12 GB and egress 125 GB over |
| 250 businesses, traffic doubled | 20 GB | 750 GB | 5,999 | Egress 500 GB over |
| 1,000 businesses | 80 GB | 1,500 GB | about 15,700 plus Realtime | Cost management table, section 4 |

Even the doubled-traffic case costs about KSh 24 per business a month, inside the KSh 100 allowance. Storage only becomes a risk if one customer uploads very large files; the per-plan file allowance and overage charge guard against that.

## 11.10 Formula check

**Table 11.11:** Checks performed on the calculations

| Check | Result |
|---|---|
| Fixed cost subtotal 3,225 + 2,580 + 250 + 4,167 + 1,500 + 5,000 + 5,000 + 60,000 | 81,722 ✓ |
| Break-even row in [Table 11.7](#t-11-7): 39 x 4,500 - 39 x 2,142.50 - 89,900 | 2,042 (positive), and at 38: -315 ✓ |
| P_min at N = 100: (899 + 1,700) / 0.935 | 2,780 ✓ |
| Business plan CM: 6,000 x 0.935 - 1,700 | 3,910 ✓ |
| LTV : CAC at 3% churn: 78,583 / 11,000 | 7.14 ✓ |
| Units: every price and cost per customer per month in KSh; *p* applied to price only | Consistent ✓ |

# Part IV: Service, Contracts and Ownership

# Chapter 12: Maintenance, Support and Upgrades

## 12.1 Kinds of work

**Table 12.1:** Kinds of maintenance and service work

| Kind | Meaning | ISMS example | Normally paid by |
|---|---|---|---|
| Corrective maintenance | Fixing a defect: the software does not do what its documentation says | A receipt prints the wrong total | Included in every paid model |
| Preventive maintenance | Work that stops future failures | Pruning the scheduler log; adding a storage alert (OPS-03) | Included (hosted); maintenance fee (perpetual) |
| Adaptive maintenance | Keeping ISMS working when its environment changes | A provider retires an AI model; Android or KRA changes its rules; Rust update breaks a build | Included (hosted); maintenance fee (perpetual) |
| Perfective maintenance | Improving speed, usability or clarity of existing features | Faster sales list; clearer wording | Included in the product roadmap; never owed on demand |
| Security maintenance | Fixing vulnerabilities, rotating keys, updating dependencies | The function-grant fix of 23 November 2026 | Always included; cannot be refused to a paying customer |
| Infrastructure maintenance | Running the database, hosting, backups, restore drills | Monday restore drill; compute size changes | Included (hosted); the customer's own cost (deployed copy) |
| Customer-specific customisation | A change only one customer wants | A special report format for one shop | Chargeable change request |
| New feature development | A new capability for the product | HR and payroll (roadmap) | Owner's investment; may be co-funded by a customer |
| Technical support | Answering questions, diagnosing problems, guiding configuration | "How do I add a branch?" | Standard included; Premium add-on |
| Emergency support | Urgent help when a business cannot trade | No one can sign in on a Saturday morning | Included for platform faults; chargeable outside hours if the cause is on the customer's side |

## 12.2 What each commercial model includes

**Table 12.2:** Services included by commercial model

| Service | SaaS subscription | Perpetual licence (deployed copy) | Source-code licence | IP assignment |
|---|---|---|---|---|
| Corrective and security maintenance | Included | First 12 months, then with annual maintenance | No (optional paid support) | Transition period only |
| Preventive and adaptive maintenance | Included | With annual maintenance | No | No |
| Infrastructure maintenance | Included | Customer's responsibility (or a hosting contract) | Customer | Buyer |
| New versions | Included | With annual maintenance | No | Buyer develops |
| Standard support | Included | With annual maintenance | No | Transition period only |
| Premium or emergency support | Add-on (Enterprise included) | Add-on | Add-on | Negotiated |
| Customisation and new features | Chargeable | Chargeable | Customer does it | Buyer does it |
| Hosting | Included | Customer pays providers | Customer | Buyer |

> **Important:** A perpetual licence buys the right to use a version. It does not buy unlimited development, hosting or support.

## 12.3 Classifying a request

**Table 12.3:** Defect, configuration problem, feature request or change request

| Class | Test | Example | Charge |
|---|---|---|---|
| Software defect | ISMS behaves differently from ISMS-UG, ISMS-AG or ISMS-TD, or loses or corrupts data, or fails a security expectation | Stock does not fall after a sale | Free, under maintenance |
| Configuration problem | ISMS works as documented, but settings, roles, devices or provider accounts are set up wrongly | A cashier cannot refund because the role lacks the permission | Free within Standard support time; set-up work beyond 30 minutes at the charge-out rate |
| Customer-side fault | Caused by the customer's devices, internet, printer, or third-party provider account | M-Pesa prompts fail because the business's Daraja keys expired | Diagnosis free; fixing at the charge-out rate |
| Feature request | A change that would help many customers | A new report useful to every shop | Free to submit; added to the roadmap at the owner's discretion; no delivery date owed |
| Change request | A change wanted by one customer, or wanted by a date | A custom export for one accountant | Quoted fixed price or hourly; 50% deposit |

Decision order: (1) does the documentation describe the expected behaviour? If yes and ISMS differs, it is a defect. (2) If ISMS matches the documentation, is the problem the settings? Configuration. (3) If neither, is it the customer's equipment or provider? Customer-side. (4) Otherwise it is a request: feature (for everyone) or change (for one).

## 12.4 Support levels and response targets

The Standard level matches the targets already published in TERMS s.9.

**Table 12.4:** Support levels (Recommendation)

| Priority | Meaning | Standard (all plans) | Premium (add-on; Enterprise) |
|---|---|---|---|
| P1 Critical | The business cannot sell, or money records are wrong, for all users | Response the same day (within 4 business hours); work continues until a workaround exists | Response within 1 hour, 7:00 to 22:00, seven days |
| P2 High | An important feature fails; a workaround exists | Next business day | Within 4 hours in business hours |
| P3 Normal | Minor fault or question | Within 3 working days (TERMS s.9) | Next business day |
| P4 Request | Feature or change request | Acknowledged within 5 working days | Within 3 working days |
| Channel | | Report a problem in the app; email | Plus phone and WhatsApp |
| Hours | | Monday to Saturday, 8:00 to 18:00 (Assumption) | As above |

No uptime percentage is guaranteed at the Starter and Business levels, because the hosting providers' own plans used by ISMS are not known to carry an uptime guarantee (Owner input: confirm the Supabase plan terms). An objective of 99.5% monthly availability can be published as a target, not a promise. A contractual uptime credit should be offered only to Enterprise customers and only once the hosting plan carries a matching guarantee.

> **Warning:** With one person on call (OPS-05), even the Standard P1 target is at risk when the owner is ill or travelling. Name a backup person before signing the first agreement.

## 12.5 Maintenance packages for licence customers

**Table 12.5:** Maintenance packages for perpetual or deployed-copy customers (Recommendation)

| Package | Includes | Price |
|---|---|---|
| Basic maintenance | Corrective and security fixes; new versions; Standard support | 20% of the licence fee a year (KSh 44,000 on KSh 220,000) |
| Managed hosting | Basic maintenance plus operating the customer's own database and hosting accounts, backups, restore drills | Basic plus KSh 5,000 a month, plus the customer's provider bills |
| Support block | 10 hours of support or small changes, valid 12 months | KSh 22,500 (10% off the hourly rate) |

## 12.6 Exclusions

Not included in any plan unless written into the agreement: work caused by misuse or by changes the customer made outside ISMS; recovering data the customer deleted where the change is recorded and reversible in the app; hardware, internet and devices; the customer's own provider accounts and their fees; training of new staff after the first session; on-site visits; data entry; tax or accounting advice; integrations with systems not listed in ISMS-TD Chapter 12.

## 12.7 Pricing additional services

**Table 12.6:** Additional services (Recommendation; excluding VAT)

| Service | Price | Basis |
|---|---|---|
| Charge-out rate (support beyond included time, configuration, change requests) | KSh 2,500 an hour | Internal cost KSh 1,500 plus overheads and margin |
| Fixed-price change request | Estimate in hours x KSh 2,500, plus 20% risk margin | Quoted; 50% deposit, 50% on acceptance |
| Training (remote) | KSh 2,500 an hour | |
| Training (on site, Nairobi) | KSh 2,500 an hour plus transport at cost | |
| Emergency call-out outside support hours (customer-side cause) | KSh 5,000 minimum, then hourly | |
| Data migration from another system | Quoted (hours x KSh 2,500) | |
| Full data export after the free window | KSh 5,000 per export | About 2 hours |

# Chapter 13: Customer Commercial Arrangements

## 13.1 Fees and payment schedules

**Table 13.1:** Fees and when they are paid (Recommendation; excluding VAT)

| Fee | Amount | When paid |
|---|---|---|
| Set-up: Starter | KSh 10,000 | In full before the business is created |
| Set-up: Business | KSh 25,000 | In full before the business is created |
| Set-up: Enterprise | Quoted, from KSh 50,000 | 50% on signing, 50% at go-live |
| Subscription | [Table 7.2](#t-7-2) | Monthly in advance by the 5th, or yearly in advance |
| Licence fee (perpetual) | KSh 220,000 | 50% on signing, 50% at go-live |
| Renewal | Same as the current plan unless notified 30 days before | On the renewal date |
| Annual maintenance (perpetual) | 20% of the licence fee | Yearly in advance |
| Deposit | Not taken for subscriptions. 50% for change requests and enterprise set-up | On order |
| Reactivation | KSh 2,000 (within 90 days of suspension) | Before access is restored, with the arrears |

Set-up fees are based on estimated hours: Starter about 4 hours, Business about 10 hours, at KSh 2,500, rounded up (F-10).

Invoices must name the business, plan, branches, users, period, amount and payment details; payments are recorded against the customer in the software business's books ([Chapter 16](#ch-16)). Payment by M-Pesa paybill or bank transfer to an account in the software business's name, never to a personal number (Recommendation).

## 13.2 Late payment, suspension and reactivation

**Table 13.2:** Timeline when a customer does not pay (Recommendation, building on LICENSE s.6 and s.8)

| Day after due date | Action | Customer's access |
|---|---|---|
| 0 | Invoice due | Full |
| 1 | Friendly reminder (SMS or email) | Full |
| 7 | Second reminder; grace period ends | Full |
| 14 | Written notice: access will be restricted on day 21 and suspended on day 30 unless paid | Full |
| 21 | Restricted: read-only, exports allowed (once read-only mode exists; until then, a final notice) | Read-only |
| 30 | Suspended: staff cannot sign in; the business's shoppers see the online store closed | None; data untouched |
| 60 | Written notice of termination with 30 days to pay or export | None |
| 90 | Licence terminated; the 90-day data retention period starts ([Table 13.3](#t-13-3)) | None |

Late payment interest is not recommended for small shops (it is rarely collected and damages goodwill); the reactivation fee covers the administrative cost.

## 13.3 Suspension is not deletion

Suspending access and deleting data are separate decisions, taken at different times, with separate notices.

**Table 13.3:** Safeguards before data is deleted

| Safeguard | Rule |
|---|---|
| Separate decision | Deletion is never automatic on non-payment; it needs a recorded decision by the operator |
| Notice | Two written notices: at termination (deletion date stated) and 14 days before deletion |
| Export first | A full export is offered free within 30 days after termination (LICENSE s.7) |
| Minimum retention | Data kept at least 90 days after termination (recommended change to TERMS s.5, which says 30 days) |
| Legal retention | The customer, as data controller and taxpayer, must keep its own records for the statutory periods (sales at least 5 years by the owner's 24 November 2026 decision; money records and audit trail 7 years in ISMS). The operator reminds the customer of this in the export notice (Legal point) |
| Backups | Data remains in encrypted backups until they expire under the backup schedule (up to 13 months, ISMS-AG Section 12.3); state this in the agreement |
| Record | The deletion is logged with date, business and the person who authorised it |
| Erasure of individuals | Requests to erase one of the customer's shoppers go to the customer, who uses **Erase personal details** (ISMS-TD Section 2.3) |

## 13.4 Refunds and cancellation

**Table 13.4:** Refund and cancellation rules (Recommendation)

| Case | Rule |
|---|---|
| Monthly plan cancelled by the customer | 30 days' notice; no refund of the current month; access to the end of the paid period |
| Annual plan cancelled by the customer | Refund of whole unused months, less the discount already given (charged as if monthly) |
| Annual plan ended by the owner for convenience or product discontinuation | Full pro-rata refund of unused months |
| Service failure (P1 not resolved for more than 3 business days in a month) | Credit of one month's fee on request (Recommendation; Enterprise by contract) |
| Set-up fee | Refundable in full before work starts; not refundable after the business has been created |
| Change requests | Deposit refundable only if the owner cannot deliver |

## 13.5 Data export, migration and requests for information

**Table 13.5:** Data the customer can obtain

| Request | How | Fee |
|---|---|---|
| Ongoing own copy | Google Sheets backup (sales, stock, customers, debts, wallet) set up by the admin (ISMS-AG Section 12.4) | Included |
| Full export during the licence | Operator export of all the business's rows (CSV per table) | One a year included; further at KSh 5,000 |
| Export at termination | Full export within 30 days | Included |
| Migration to another system | Export plus mapping help | Charge-out rate |
| Personal data request by one of the customer's shoppers | Handled by the customer as controller; operator assists | Included |

> **Note:** A full self-service export of one business does not exist in the app today ([Table 4.5](#t-4-5)); exports would be made by the operator with database queries. Building a tested export is a prerequisite for honouring LICENSE s.7 at scale ([Appendix E](#app-e)).

## 13.6 Customer-specific development, training and premium support

- **Customer-specific development** is a change request ([Table 12.3](#t-12-3)): written specification, fixed quote or hourly estimate, 50% deposit, acceptance test, then the balance. Unless agreed otherwise, the owner keeps the IP in all changes and may add them to the product for everyone; the customer gets a licence to use them. (Recommendation; Legal point.)
- **Training**: one 2-hour remote session is in the set-up fee; further training is charged ([Table 12.6](#t-12-6)).
- **Premium support**: monthly add-on ([Table 7.4](#t-7-4)) with the targets in [Table 12.4](#t-12-4).

# Chapter 14: Intellectual Property and Ownership Transfers

## 14.1 Who owns ISMS today

**Table 14.1:** Ownership facts

| Item | Fact | Status |
|---|---|---|
| Copyright owner | Dennis Kimanthi Gitonga (LICENSE: "Copyright (c) 2024-2026 Dennis Kimanthi Gitonga (Codensons)") | Verified |
| Trading name | Codensons; whether it is a registered business name or company | Owner input (Gap G-01) |
| Contributors | All 229 commits by one author (`lioDenson`, codensons@gmail.com) | Verified |
| AI-assisted code | The code was written with AI assistance. Whether this affects copyright ownership under Kenyan law is unsettled | Legal point |
| Open-source components | Direct dependencies under MIT, Apache-2.0, BSD-2-Clause and ISC licences (permissive); background-removal model under MIT. Transitive npm, Rust and Android components not audited | Verified (direct only); Gap G-08 |
| Product names | "ISMS" and "KayKay's". The relationship between the KayKay's shop and the software brand is not documented; no trademark registration known | Owner input (Gap G-02) |
| Domain | `kaykays.com`, registered at DreamHost; registrant name to confirm | Owner input |
| Provider accounts | Held personally by the owner (accounts register) | Verified |
| Signing keys | Android keystore and Tauri updater key; losing them stops updates | Verified |

## 14.2 Before any transfer

**Table 14.2:** Preparing ISMS for licensing, sale or transfer

| Step | Why |
|---|---|
| Decide the owning entity; if a company, assign the IP into it in writing | A buyer of a company gets only what the company owns |
| Keep a register of open-source components and their licences (including transitive ones) | Buyers and licensees will ask; some licences carry obligations |
| Record development hours and costs from now on | Supports valuation (method F-13) and tax treatment |
| Move provider accounts to business-owned accounts (company email, company card) | Accounts in a personal name are hard to transfer |
| Register the product name as a trademark if it will be sold under that name | Protects the brand being sold |
| Keep signed agreements with every customer, partner and contractor | Contracts are what a buyer takes over |
| Keep the source code private (the move in `docs/GOING_PRIVATE.md`) | Trade-secret protection weakens while the code is public |

## 14.3 Transfer scenarios

**Table 14.3:** Effect of each scenario on licences, customers, contracts and data

| Scenario | Existing licences and customers | Contracts | Customer data | Hosting and third parties | Warranties and outstanding obligations |
|---|---|---|---|---|---|
| Sell the entire IP (S4) | Continue; the buyer becomes licensor only if licences are assigned | Assign with notice; some need consent | Stays with the operator; moves only if operation moves | Owner's accounts transferred or replaced | Seller warrants title and non-infringement; prepaid periods honoured by whoever operates |
| Sell the company operating ISMS | Unchanged: the company remains the licensor | Unchanged, unless change-of-control clauses apply | Unchanged | Unchanged (accounts must be in the company's name) | Stay with the company; buyer protected by warranties in the share sale |
| Sell one deployment to a customer (S1) | Unaffected for others | New perpetual licence and maintenance | That customer's data moves to its own accounts | New accounts for that customer | Limited warranty period; maintenance if bought |
| License exclusively | Existing non-exclusive licences in the exclusive field must be carved out or bought back | Partner agreement with performance targets | Depends on who operates | Partner's or owner's | Owner must not breach exclusivity |
| License non-exclusively | Unaffected | Licence agreement | Unaffected | Unaffected | Licence warranties only |
| Transfer to another developer (maintenance only) | Unaffected | Subcontract; developer assigns IP in their work | Developer accesses data only as sub-processor under a written agreement | Access granted, not ownership | Owner remains responsible to customers |
| Acquire ISMS-like software from another developer | — | Assignment from that developer; check its contributors and licences | Data from its customers moves only with consent and a processing agreement | Take over or rebuild hosting | Obtain title and non-infringement warranties |
| Sell the product but keep maintenance (S6) | Customers see a new licensor, same support | Assignment plus a maintenance agreement back to the seller | Operator role defined in the maintenance agreement | As agreed | Seller's maintenance obligations become contractual to the buyer |
| Discontinue the product | Terminate with notice ([Section 14.4](#s-14-4)) | End by notice per their terms | Export, then delete after retention | Close accounts after the last export | Refund prepaid periods; honour escrow |

## 14.4 Discontinuing the product

If ISMS is discontinued: (1) give every customer at least 6 months' written notice (Recommendation); (2) stop new sales at once; (3) provide a full export to each customer and help with migration at cost; (4) refund prepaid fees for months after the end date; (5) release escrowed source code to entitled customers; (6) keep the service running, with security fixes, until the end date; (7) delete data after the retention period and close the provider accounts; (8) keep the software business's own financial records for the statutory period.

## 14.5 Matters for a Kenyan advocate

**Table 14.4:** Legal agreements and points requiring review by a qualified Kenyan advocate

| Matter | Why |
|---|---|
| Subscription agreement (terms of service plus order form) | Binds price, scope, suspension and data terms |
| Data processing agreement | Data Protection Act, 2019: controller-processor terms, cross-border transfer to EU hosting, breach notification |
| ODPC registration of the software business | Possibly required as a data processor (EXP-06) |
| Revised LICENSE and TERMS | [Table 6.6](#t-6-6) |
| Perpetual licence and maintenance agreement | S1/S2 |
| Source-code licence (exclusive and non-exclusive) | S3 |
| Deed of assignment of IP | S4; Copyright Act formalities; stamp duty if any |
| Asset or share purchase agreement | S5 |
| Reseller, referral and operator agreements | [Chapter 15](#ch-15), [Table 8.4](#t-8-4) |
| Contractor and employee IP assignment clauses | Every future developer |
| Escrow agreement | Enterprise and perpetual customers |
| Ownership of AI-assisted code | Unsettled area of law |
| Enforceability of the liability cap and exclusions | LICENSE s.10 and s.11 |
| Tax structure and withholding | With a tax adviser |

# Chapter 15: Reseller and Partnership Model

## 15.1 Partner types

**Table 15.1:** Partner types evaluated

| Type | What the partner does | Who signs with the customer | Who supports | Suitable now? |
|---|---|---|---|---|
| Referral partner | Introduces customers | Owner | Owner | **Yes**: simple, low risk |
| Commission reseller | Sells at the list price; owner invoices | Owner | Owner (partner may do first contact) | Yes, after the first 10 direct customers |
| Margin reseller (distributor) | Buys at a discount, sells at its own price, invoices the customer | Reseller | Reseller first line; owner second line | Later, once support processes are written |
| Regional distributor | Recruits resellers in a region | Distributor or resellers | Distributor | Later; consider an exclusive region only with targets |
| Implementation partner | Sells set-up, training, migration and hardware around ISMS | Owner for the subscription; partner for its services | Partner for its services | **Yes**: extends reach without sharing subscription income |
| White-label partner | Sells ISMS under its own brand | Partner | Partner | **Not possible yet**: the brand and website are built in ([Table 4.5](#t-4-5)) |

## 15.2 Revenue division

**Table 15.2:** Suggested revenue split (Recommendation)

| Partner | Share | Formula | Example (Business plan, KSh 6,000 a month) |
|---|---|---|---|
| Referral partner | 10% of the first 12 months' subscription, paid monthly while the customer pays | F-25: commission = 0.10 x fee received | KSh 600 a month for 12 months (KSh 7,200 in total) |
| Commission reseller | 20% of subscription for as long as the customer pays, plus 20% of the set-up fee | F-25 with 0.20 | KSh 1,200 a month; KSh 5,000 of the set-up fee |
| Margin reseller | Buys at 30% off list; keeps the difference; does first-line support | F-26: owner receives 0.70 x list | Owner receives KSh 4,200 a month |
| Implementation partner | Keeps 100% of its own service fees; may also earn referral commission | — | — |
| Operator licensee ([Table 8.4](#t-8-4) A) | Owner receives a royalty of 30 to 40% of subscriptions | F-27: royalty = rate x subscriptions collected | KSh 1,800 to 2,400 a month |

Check against the economics: a 30% margin reseller leaves the owner KSh 4,200, still above the Business plan's variable cost (KSh 1,700 + 6.5%) because the reseller takes on first-line support (reducing the owner's support cost). Commission is paid only on money actually received.

## 15.3 Customer ownership and responsibilities

**Table 15.3:** Responsibilities under partner arrangements

| Matter | Referral or commission reseller | Margin reseller or distributor | White-label (future) |
|---|---|---|---|
| Customer contract | Owner | Reseller (on terms no wider than the owner's) | Partner |
| Customer data | Owner as processor | Owner as processor; reseller as sub-processor if it can access data | Owner as processor or sub-processor |
| Billing and collection | Owner | Reseller | Partner |
| Non-payment risk | Owner | Reseller (pays the owner regardless) | Partner |
| First-line support | Owner | Reseller | Partner |
| Defects, security, hosting | Owner | Owner | Owner |
| If the partner leaves | Customers stay with the owner | Customers transfer to the owner (clause needed) | Transfer clause needed |

## 15.4 Partner rules

1. Every partner signs an agreement before selling: commission or discount, territory (if any), conduct, confidentiality, data protection, and what happens to customers if the partnership ends.
2. Partners may not change prices below the floor, promise features that do not exist, or promise integrations that have not been tested ([Section 4.3](#s-4-3)).
3. The owner keeps the right to serve any customer directly.
4. Commission is recorded in the reseller commission register ([Chapter 16](#ch-16)).

# Part V: Management and Governance

# Chapter 16: Financial Reporting and Business Management

## 16.1 Registers

The software business needs its own records, separate from the owner's personal money and from any shop that uses ISMS. Templates are in [Appendix D](#app-d).

**Table 16.1:** Registers for the software business

| Register | Records | Updated | Used for |
|---|---|---|---|
| Customer subscription register | Business, plan, branches, users, add-ons, start, renewal date, price, status | On every change | MRR, renewals, limits check |
| Licence register | Licence number, type (term, perpetual, source, exclusive), scope, period, agreement reference | On issue and change | Proving who may use what |
| Revenue register | Each invoice line by type (subscription, set-up, add-on, service, licence), period covered, deferred part | Monthly | Revenue recognition, tax |
| Customer payment register | Each payment received, method, reference, invoice matched | On receipt | Collections; links payment to invoice |
| Outstanding invoice register | Unpaid invoices by age (0 to 30, 31 to 60, over 60 days) | Weekly | Suspension timeline ([Table 13.2](#t-13-2)) |
| Recurring expense register | Every provider subscription, amount, renewal date, card | Monthly | Budget; renewal alerts |
| Infrastructure cost register | Each month's provider bills and usage (database, files, egress, Realtime, functions) | Monthly | Cost per customer; price review |
| Maintenance expenditure register | Hours by kind ([Table 12.1](#t-12-1)) and by customer where attributable | Weekly | Support cost per customer; valuation |
| Refund register | Refunds and credits, reason, approval | On issue | Churn and quality review |
| Reseller commission register | Partner, customer, fee received, rate, commission due and paid | Monthly | Paying partners correctly |
| Monthly profitability report | [Table 16.2](#t-16-2) | Monthly | Owner decisions |

> **Note:** The owner could run the software business itself as a business in ISMS (customers, invoices, expenses, debts and the books exist there). This is an option to test, not a verified fit: ISMS has no subscription or recurring-invoice features.

## 16.2 Monthly profitability report

**Table 16.2:** Contents of the monthly profitability report

| Line | Source |
|---|---|
| MRR at month end; new, upgraded, downgraded, lost MRR | Subscription register |
| Revenue recognised (subscription, set-up, services, licences) | Revenue register |
| Provider costs | Infrastructure cost register |
| Support and maintenance hours x internal rate | Maintenance register |
| Other fixed costs | Recurring expense register |
| Contribution and profit, total and per plan | Calculated (F-12, F-19) |
| Cash received and overdue balance | Payment and outstanding registers |

## 16.3 Management indicators

**Table 16.3:** Indicators, formulas and review intervals

| Indicator | Formula | Interval | Warning level (Recommendation) |
|---|---|---|---|
| MRR and growth | F-17; (MRR this month - last month) / last month | Monthly | Two months of decline |
| ARR | F-18 | Quarterly | — |
| ARPU | MRR / paying customers | Monthly | Below KSh 4,000 |
| Customer churn | Customers lost / customers at start of month | Monthly | Above 3% |
| Revenue churn | MRR lost / MRR at start of month | Monthly | Above 3% |
| Infrastructure cost per customer | F-20 using real bills | Monthly | Above KSh 150 |
| Support hours per customer | Support hours / paying customers | Monthly | Above 1 hour |
| Contribution margin | F-12 / price | Monthly | Below 45% blended |
| CAC and payback | F-21, F-22 | Quarterly | Payback above 12 months |
| LTV : CAC | F-24 | Quarterly | Below 3 |
| Days sales outstanding | Overdue balance / monthly revenue x 30 | Monthly | Above 15 days |
| Largest customer share | Largest customer's MRR / MRR | Quarterly | Above 20% |
| Break-even gap | Break-even customers - paying customers | Monthly | — |

## 16.4 Reporting calendar

**Table 16.4:** Reporting calendar

| When | Task |
|---|---|
| Weekly | Outstanding invoices; support and maintenance hours; P1 incidents |
| Monthly (by the 10th) | Provider bills and usage; profitability report; renewal reminders for the next month; commissions |
| Quarterly | Indicators review; price check against P_min; customer concentration |
| Yearly | Price review; budget; tax filings; licence and contract renewals; independent check of the model by an accountant |

# Chapter 17: Risk and Sustainability

## 17.1 Risk register

**Table 17.1:** Commercial risks and safeguards

| ID | Risk | Likelihood | Impact | Safeguards |
|---|---|---|---|---|
| R-01 | Underpricing: prices below P_min at the real customer count | Medium | High | Compute P_min quarterly; launch discounts time-limited; set-up fees always charged |
| R-02 | Unlimited usage by a few customers (AI, email, traffic) | Medium | Medium | Fair-use clause; own AI key; build usage metering (EXP-01) |
| R-03 | Uncontrolled storage growth | Low | Medium | File allowance per plan; overage charge; storage alert (OPS-03); compressed uploads (already in the uploader) |
| R-04 | Provider price rises or free tiers withdrawn | Medium | Medium | Budget at paid-tier prices; price-change clause with 30 days' notice; review when bills rise 20% |
| R-05 | Unpaid subscriptions | High | Medium | Payment in advance; set-up fee before work; suspension timeline; bad-debt allowance |
| R-06 | Excessive support demand | High | High | Support is the deciding cost ([Table 11.9](#t-11-9)); Standard hours and channels; Premium charged; documentation and training first |
| R-07 | Customer concentration (one customer is a large share of revenue) | Medium early | High | Watch the largest-customer share; no exclusivity without minimum fees |
| R-08 | Dependence on third-party platforms (Supabase, Cloudflare, GitHub, Google, Safaricom, KRA) | Certain | High | Backups off-provider (R2, offline copy); terms that exclude provider outages; migration plan documented in ISMS-TD Chapter 15 |
| R-09 | Key-person dependence (OPS-05) | High | Critical | Named backup person; sealed credentials; written runbooks (ISMS-AG); escrow for large customers |
| R-10 | Ownership disputes (personal versus company; brand; AI-assisted code) | Low | High | Decide the owning entity; written assignment; trademark; advocate review |
| R-11 | Selling without transferring operating obligations | Medium (on sale) | High | Sale agreements list customers, prepaid periods, data processing, support duties, transition period |
| R-12 | Product discontinuation | Low | High | Discontinuation procedure ([Section 14.4](#s-14-4)); 6 months' notice; refunds |
| R-13 | Selling untested integrations (M-Pesa, cards, eTIMS) | Medium | High | Do not sell until tested live; state status in proposals |
| R-14 | Charging before readiness gaps are closed ([Table 4.4](#t-4-4)) | High now | Critical | Close SEC-02, SEC-03, SEC-04, OPS-04, OPS-06 first |
| R-15 | Limits not enforced in the app (branches, users, modules) | High | Medium | Monthly manual check; build plan entitlements ([Appendix E](#app-e)) |
| R-16 | Tax or legal non-compliance of the software business (VAT, ODPC) | Medium | High | Accountant and advocate before the first invoice |

## 17.2 Sustainable practices

1. Charge for set-up, always, and take subscriptions in advance.
2. Price above P_min for the customer count actually reached, not the one hoped for.
3. Record every hour of support and maintenance; it is the main cost.
4. Keep provider costs visible: monthly bills in the infrastructure register, spend caps on.
5. Promise only what is built and tested; label everything else as roadmap.
6. Keep customer data recoverable: backups tested weekly, export ready.
7. Put every agreement in writing, and keep the IP in one clearly owned place.

# Chapter 18: Decision Register

**Table 18.1:** Decisions requiring the software owner's approval

| ID | Decision | Options | Recommendation | Needed before |
|---|---|---|---|---|
| D-01 | Primary commercial model | SaaS; perpetual; source licence; sale | SaaS under non-exclusive licence | First customer |
| D-02 | Plans and prices | [Table 7.2](#t-7-2) as proposed, or changed | Approve after the checks in [Table 10.3](#t-10-3) | Publishing prices |
| D-03 | Set-up fees | [Table 13.1](#t-13-1) | Approve | First customer |
| D-04 | Add-on prices | [Table 7.4](#t-7-4) | Approve | First customer |
| D-05 | Charge-out rate | KSh 2,500 an hour, or another | Approve | First change request |
| D-06 | Launch discount | None; 30% for 6 months for first 10 customers | Time-limited discount only | Launch |
| D-07 | Owning entity | Personal (sole trader); registered company | Company, with the IP assigned into it, if a sale or investment is likely | Any sale, investment or partner |
| D-08 | Readiness before charging | Charge now; fix first | Fix [Table 4.4](#t-4-4) items first | First invoice |
| D-09 | Data retention after termination | 30 days (TERMS today); 90 days | 90 days with export in the first 30 | Agreement drafting |
| D-10 | Support hours and Premium targets | [Table 12.4](#t-12-4) | Approve once a backup person exists | First agreement |
| D-11 | Perpetual licences offered? | Yes; no; only Enterprise | Only for customers who pay for a deployed copy | First request |
| D-12 | Source-code licensing offered? | Yes; no; case by case | Case by case, advocate-drafted | First request |
| D-13 | Sale of IP | Now; later | Later, once ARR exists | — |
| D-14 | Partner programme | None; referral only; resellers | Referral now; resellers after 10 direct customers | Launch |
| D-15 | Uptime commitment | None; target; contractual | Target only (99.5%), no credits except Enterprise | First agreement |
| D-16 | Commercial features to build ([Appendix E](#app-e)) | Which and when | Entitlements, licence status and full export first | Before 10 customers |
| D-17 | Brand under which ISMS is sold to other businesses | KayKay's; ISMS; Codensons; new name | Owner choice; register it | Marketing |
| D-18 | Payment channel for subscription fees | M-Pesa paybill; till; bank | Paybill or bank in the business's name | First invoice |

# Chapter 19: Information Gaps

**Table 19.1:** Information needed from the owner or advisers

| ID | Missing information | Why it matters | Provided by | Used in |
|---|---|---|---|---|
| G-01 | Legal form of Codensons (registered business name, company, or none); KRA PIN; VAT status | Who signs, who owns the IP, tax | Owner | [Chapter 14](#ch-14), [Section 10.6](#s-10-6) |
| G-02 | Relationship between KayKay's (the shop) and the ISMS product and brand | Brand ownership; whether KayKay's is a customer | Owner | [Table 14.1](#t-14-1) |
| G-03 | Actual Supabase plan and bills; domain renewal price; any other paid tools | Replace assumptions A-02 to A-06 | Owner (provider billing pages) | [Table 11.2](#t-11-2) |
| G-04 | Owner's internal hourly cost and hours available | A-09, A-13; the largest cost | Owner | [Chapter 11](#ch-11) |
| G-05 | Number of paying customers and any existing price agreements | Whether any current users are already under terms | Owner | [Table 8.2](#t-8-2) |
| G-06 | Measured support hours per customer | Deciding variable for break-even | First customers | [Table 11.9](#t-11-9) |
| G-07 | Development hours and cash invested to date; history before July 2026 | Valuation; tax; proof of authorship | Owner | [Table 5.4](#t-5-4) |
| G-08 | Full licence audit of transitive npm, Rust and Android components | IP warranties on sale or source licence | Developer | [Section 14.2](#s-14-2) |
| G-09 | Supabase and Cloudflare plan terms on uptime and data location | Service levels; data protection disclosures | Owner | [Section 12.4](#s-12-4) |
| G-10 | Competitor prices and customers' willingness to pay | Price validation | Owner (market research) | [Table 10.3](#t-10-3) |
| G-11 | Cost of an advocate, accountant, code-signing certificate, trademark | Replace A-05, A-07, A-08 | Quotes | [Table 11.1](#t-11-1) |
| G-12 | Payment collection fees for the chosen channel | A-14 | Bank or Safaricom tariff | [Table 11.3](#t-11-3) |
| G-13 | ODPC registration requirement and fee for the software business | Compliance cost | Advocate or ODPC | [Table 14.4](#t-14-4) |
| G-14 | Whether a backup person is available | Support promises; key-person risk | Owner | [Section 12.4](#s-12-4) |

# Chapter 20: Recommendations and Implementation Plan

## 20.1 Recommendations

**Table 20.1:** Recommendations

| # | Recommendation | Reason |
|---|---|---|
| 1 | Adopt hosted subscription (SaaS) under a non-exclusive licence as the primary model | Matches the multi-tenant design; recurring income pays recurring costs |
| 2 | Close the readiness gaps before the first invoice | A paid customer's data must be recoverable and secure ([Table 4.4](#t-4-4)) |
| 3 | Use three plans with branch and user limits; online store as an add-on | Simple, fair, fits the product |
| 4 | Charge set-up fees and bill in advance | Recovers acquisition cost; reduces bad debt |
| 5 | Measure support time from the first customer | It decides profitability ([Table 11.9](#t-11-9)) |
| 6 | Have an advocate draft the agreements in [Table 14.4](#t-14-4) | Legal certainty |
| 7 | Decide and formalise the owning entity; move accounts into it | Enables investment, sale and continuity |
| 8 | Do not sell the IP until ARR exists | Cost-only valuation undervalues ISMS |
| 9 | Build entitlements, licence status, read-only mode and full export | Makes the contract terms enforceable ([Appendix E](#app-e)) |
| 10 | Start with referral partners only | Low risk while support processes mature |

## 20.2 Order of work

**Table 20.2:** Implementation phases

| Phase | Work | Done when |
|---|---|---|
| 1. Decide | Owner answers D-01 to D-08 and fills G-01 to G-05 | Decision register signed off |
| 2. Prepare | Readiness gaps closed; Supabase Pro; email service; backup person named | ISMS-AG Section 2.3 reads "Ready" |
| 3. Contract | Advocate drafts subscription agreement, data processing agreement, revised LICENSE and TERMS | Signed templates on file |
| 4. Validate prices | Checks in [Table 10.3](#t-10-3) with five or more prospects | Prices confirmed or adjusted |
| 5. Launch | First customers on the Starter and Business plans; registers in use | First paid invoice recorded |
| 6. Build | Commercial features in [Appendix E](#app-e) | Limits enforced in the app |
| 7. Grow | Referral partners; then resellers; quarterly price review | Break-even reached |

## 20.3 To finish

This document is a draft. These steps remain, in order:

1. **You:** read this document and answer the decisions in [Table 18.1](#t-18-1) (mark each approved, changed or rejected). Done when every decision has an answer and a date.
2. **You:** provide the information in [Table 19.1](#t-19-1) G-01 to G-05 and G-07 (business form, KayKay's brand relationship, actual bills, your hourly cost and hours, existing customers, development hours). The developer then replaces assumptions A-02 to A-09 and recomputes [Chapter 11](#ch-11) with the formulas in [Appendix A](#app-a). Done when the break-even figure is based on real costs.
3. **You:** show the plans to at least five shop owners ([Table 10.3](#t-10-3)). Done when at least three of five would pay for the plan they need.
4. **You:** take [Appendix C](#app-c) to a qualified Kenyan advocate and a tax adviser. Done when signed agreement templates and tax advice are on file.
5. Close the readiness items in [Table 4.4](#t-4-4) (steps in `docs/TO_FINISH.md` and `docs/operations/owner-setup.md`). Done when the ISMS-AG readiness section can be changed to "Ready".
6. Rebuild this document after changes: `python3 documentation/tools/build_clf.py` (described in [Appendix G](#app-g)). Done when the PDF and DOCX show the new version and status "Approved".

# Appendix A: Formula Reference

**Table A.1:** Formulas used in this document

| ID | Name | Formula | Inputs |
|---|---|---|---|
| F-01 | Equal share of shared cost | shared cost / active businesses | Bills; business count |
| F-02 | Share by branches | shared cost x business branches / all branches | Branch counts |
| F-03 | Share by users | shared cost x business users / all users | Active memberships |
| F-04 | Share by measured usage | resource cost x business use / total use | Usage metering (not built) |
| F-05 | Share by plan weight | cost x plan weight / sum of weights | Weights 1, 2, 4 |
| F-06 | Minimum sustainable price | P_min = (F / N + c) / (1 - p) | F, N, c, p |
| F-07 | Price with target margin | P = (F / N + c) / (1 - p - m) | as F-06, plus m |
| F-08 | Plan price by weight | P_base x plan weight | — |
| F-09 | Extra branch price | about 0.5 x Starter price | — |
| F-10 | Set-up fee | hours x charge-out rate, rounded up to KSh 5,000 | Hours; rate |
| F-11 | Gross profit per customer | GP = P - c - collection rate x P | P, c |
| F-12 | Contribution margin | CM = P x (1 - p) - c | P, c, p |
| F-13 | Value by cost invested | hours x internal rate + cash spent | Records (not kept yet) |
| F-14 | Replacement cost | person-months x cost per person-month | A-22 |
| F-15 | Business value by income | ARR x multiple | ARR; A-23 |
| F-16 | Break-even customers | N = F / CM, rounded up | F, CM |
| F-17 | MRR | sum of monthly subscription fees in force (annual fees / 12) | Subscription register |
| F-18 | ARR | MRR x 12 | MRR |
| F-19 | Monthly profit | MRR - N x (c + p x ARPU) - F | — |
| F-20 | Infrastructure cost per customer | (provider base + N x variable infrastructure) / N | Bills |
| F-21 | CAC | (marketing + sales cost) / new customers | A-17 to A-19 |
| F-22 | Payback months | CAC / CM | — |
| F-23 | LTV | CM / monthly churn | A-16 |
| F-24 | LTV to CAC ratio | LTV / CAC | — |
| F-25 | Commission | rate x fee received | Partner rate |
| F-26 | Margin reseller income to owner | (1 - discount) x list price | Discount |
| F-27 | Operator royalty | rate x subscriptions collected | Royalty rate |

Symbols: *F* fixed monthly costs; *N* paying customers; *P* price per customer per month; *c* variable cost per customer in shillings; *p* variable cost as a share of price; *m* target margin; ARPU average revenue per customer per month.

# Appendix B: Suggested Price List

All amounts are recommendations, excluding VAT, subject to the owner's decisions ([Chapter 18](#ch-18)).

**Table B.1:** Subscription and add-ons

| Item | Amount |
|---|---|
| Starter (1 branch, 3 staff users, 1 GB files) | KSh 3,000 a month; KSh 30,000 a year |
| Business (up to 3 branches, 10 staff users, 5 GB files) | KSh 6,000 a month; KSh 60,000 a year |
| Enterprise (4 or more branches) | From KSh 12,000 a month; quoted |
| Extra branch | KSh 1,500 a month |
| Extra staff user | KSh 300 a month |
| Extra file storage | KSh 50 per GB a month |
| Premium support | KSh 3,000 a month |
| Online store | KSh 30,000 set-up; KSh 1,500 a month |
| Payment or eTIMS connection | KSh 5,000 each |

**Table B.2:** One-off fees, services and other licences

| Item | Amount |
|---|---|
| Set-up: Starter / Business / Enterprise | KSh 10,000 / KSh 25,000 / from KSh 50,000 |
| Charge-out rate (support beyond scope, changes, training) | KSh 2,500 an hour |
| Support block (10 hours, 12 months) | KSh 22,500 |
| Emergency call-out (customer-side cause, out of hours) | KSh 5,000 minimum |
| Extra full data export | KSh 5,000 |
| Reactivation after suspension | KSh 2,000 |
| Licence transfer on sale of the customer's business | KSh 2,500 |
| Perpetual licence, deployed copy | KSh 220,000 once; KSh 44,000 a year maintenance; deployment about KSh 100,000 |
| Managed hosting of a deployed copy | KSh 5,000 a month plus provider bills |
| Source-code licence, non-exclusive | About KSh 2,100,000 |
| Source-code licence, exclusive (3 years) | About KSh 3,600,000 plus annual fee or royalty |
| Full IP assignment (pre-revenue) | Asking about KSh 6,000,000; floor about KSh 3,600,000 |
| Product and business sale (with revenue) | IP value plus 2 to 4 times ARR (to be valued) |
| Referral commission | 10% of fees received for 12 months |
| Reseller commission / margin | 20% recurring / 30% discount |

# Appendix C: Contract Checklist for a Kenyan Advocate

**Table C.1:** Clauses each agreement should cover

| Agreement | Must cover |
|---|---|
| Subscription agreement | Parties (legal names, KRA PINs); plan, limits, add-ons; fees, VAT, payment terms; grace, restriction, suspension, termination; price changes; support schedule; fair use; data ownership; export and retention; liability cap; governing law (Kenya); dispute resolution |
| Data processing agreement | Controller (customer) and processor (operator) roles; purposes; sub-processors (Supabase, Cloudflare, Google, Hugging Face, Telegram); EU hosting and transfer safeguards; security measures; breach notice period; assistance with data-subject requests; deletion and return at the end |
| Perpetual licence and maintenance | Version and scope; no source code; installation on customer accounts; warranty period; maintenance fee and what it covers; escrow trigger events |
| Source-code licence | Permitted purposes; confidentiality; no redistribution or competing product (unless exclusive terms say otherwise); open-source notices; no warranty beyond title; audit right; termination and return or destruction |
| Exclusive licence | Field (territory, sector), period, minimum fees or targets, carve-outs for existing customers, termination if targets missed |
| Deed of assignment | Schedule of assets (code, repositories, documentation, designs, domains, marks, accounts, keys); written and signed; moral rights; warranties of title and non-infringement; transition support; treatment of existing licences |
| Business or share purchase | Customer contracts and consents; prepaid periods; data transfer; employees or contractors; liabilities kept by the seller; non-compete; earn-out if any |
| Reseller or referral agreement | Commission or discount; payment on money received; territory; conduct and claims; data access; customer ownership on exit; confidentiality |
| Operator licence ([Table 8.4](#t-8-4) A) | Service standards; royalty and reporting; audit; security; data processing; brand use; exit and customer transfer |
| Contractor agreement | Assignment of all IP in work done; confidentiality; data access limits |
| Escrow agreement | Deposit contents and update frequency; release triggers; costs |

# Appendix D: Register Templates

**Table D.1:** Customer subscription register (columns)

| Column | Example |
|---|---|
| Customer ID | C-0001 |
| Business legal name and KRA PIN | Example Shop Ltd, P000000000X |
| Plan | Business |
| Branches / staff users (contracted) | 3 / 10 |
| Branches / staff users (actual, checked monthly) | 3 / 8 |
| Add-ons | Online store |
| Billing | Monthly |
| Monthly value (MRR) | 7,500.00 |
| Start date / renewal date | 2027-01-01 / 2027-02-01 |
| Status | Active / Grace / Restricted / Suspended / Terminated |
| Agreement reference | SA-2027-001 |

**Table D.2:** Licence register (columns)

| Column | Example |
|---|---|
| Licence number | L-2027-001 |
| Licensee | Example Shop Ltd |
| Type | Term (hosted) / Perpetual / Source non-exclusive / Source exclusive |
| Scope | 3 branches, 10 users, internal use |
| Period | 2027-01-01 to 2027-12-31 |
| Version (perpetual only) | 1.4.0 |
| Agreement reference | SA-2027-001 |

**Table D.3:** Revenue and payment register (columns)

| Column | Example |
|---|---|
| Invoice number | INV-2027-0001 |
| Customer ID | C-0001 |
| Line type | Subscription / Set-up / Add-on / Service / Licence |
| Period covered | January 2027 |
| Amount excluding VAT / VAT / total | 7,500.00 / 1,200.00 / 8,700.00 |
| Recognised this month / deferred | 7,500.00 / 0.00 |
| Payment date, method, reference | 2027-01-03, M-Pesa, QAB12CD34E |

**Table D.4:** Cost and maintenance registers (columns)

| Register | Columns |
|---|---|
| Recurring expense | Provider, service, plan, amount (currency and KSh), billing date, renewal date, card or account, owner |
| Infrastructure cost | Month, provider, bill, database size, file storage, egress, Realtime messages, function calls, businesses active, cost per business |
| Maintenance expenditure | Date, hours, kind ([Table 12.1](#t-12-1)), customer (if attributable), description, chargeable (yes/no), invoice reference |

**Table D.5:** Refund and commission registers (columns)

| Register | Columns |
|---|---|
| Refund | Date, customer, invoice, amount, reason, approved by, method, reference |
| Reseller commission | Month, partner, customer, fee received, rate, commission due, paid date, reference |

# Appendix E: Features Needed to Support the Commercial Models

None of these exist today ([Section 4.6](#s-4-6)). They are listed so that the owner can decide whether and when to build them (D-16). Each must follow the project rules: enforced in the database, every money movement recorded, permissions checked in the database.

**Table E.1:** Proposed commercial features

| # | Feature | Supports | Priority |
|---|---|---|---|
| E-1 | Plan and entitlements per business (plan, branch limit, user limit, enabled modules), checked in the database | Tiered plans; add-ons | High |
| E-2 | Licence status per business (active, grace, restricted, suspended, terminated) with dates, set by the platform owner only | Suspension timeline | High |
| E-3 | Read-only restricted mode (sign-in and viewing allowed; writes refused by the database) | Suspension without blocking export | High |
| E-4 | Full export of one business's data (all tables, CSV or JSON) by the owner or operator | LICENSE s.7; termination; migration | High |
| E-5 | Usage metering per business (rows added, files stored, AI calls, emails, devices) | Fair use; storage overage; allocation F-04; EXP-01 | Medium |
| E-6 | Platform owner console: list businesses, plans, status, usage, renewal dates | Running the subscription business | Medium |
| E-7 | Subscription invoicing and M-Pesa collection for the software business itself | Billing | Medium (registers can be kept outside the app first) |
| E-8 | Per-customer branding and website build pipeline (name, logo, colours, domain) | White-label; online store at scale | Low |
| E-9 | Per-deployment build and update channel | Deployed copies (S1) | Low (only on demand) |
| E-10 | Country settings (currency, time zone, phone format, tax) | Export licences outside Kenya (EXP-03 to EXP-05) | Low |
| E-11 | Licence key or business-bound activation for installed apps | Perpetual licences on customer infrastructure | Low |

# Appendix F: Final Review Report

## F.1 Review of this document

**Table F.1:** Completeness and accuracy review

| Check | Result |
|---|---|
| Every section required by the brief is present | Yes: executive summary, scope, definitions, models, roles, pricing, costs, maintenance, calculations, IP, contracts, resellers, risks, decisions, gaps, recommendations, appendices |
| Every formula checked | Yes ([Table 11.11](#t-11-11)); the calculations were run in a script and match the tables |
| No unsupported figure presented as an actual cost | Yes: only the live usage measurements and the provider list prices are presented as facts; every other amount is labelled Assumption, Estimate or Recommendation |
| Consistency with ISMS-UG, ISMS-TD, ISMS-AG | See [Table F.2](#t-f-2) |
| Existing functionality kept apart from proposed capabilities | Yes: [Section 4.6](#s-4-6) and [Appendix E](#app-e) |
| Legal points flagged for an advocate | Yes: [Table 14.4](#t-14-4), [Appendix C](#app-c) |

## F.2 Contradictions between the commercial model and the application

**Table F.2:** Contradictions and inconsistencies found

| # | Contradiction | Where | Resolution |
|---|---|---|---|
| 1 | LICENSE s.3 speaks of a licence "on the devices and users your License covers", but the app cannot count or limit devices, users per plan or modules | LICENSE; [Section 4.6](#s-4-6) | Enforce by contract and monthly checks; build E-1 |
| 2 | LICENSE s.6 allows suspension, but the app has no suspension or read-only state; today suspension means removing every staff member by hand | LICENSE; [Section 4.6](#s-4-6) | Build E-2 and E-3 |
| 3 | LICENSE s.7 promises an export on request; there is no full-export tool | LICENSE; [Section 13.5](#s-13-5) | Build E-4; until then operator exports by query |
| 4 | TERMS s.5 allows deletion 30 days after a licence ends; this document recommends 90 days, and customers must keep tax records for years | TERMS; [Table 13.3](#t-13-3) | Owner decision D-09; revise TERMS |
| 5 | TERMS s.9 promises same-day response, but there is one person on call | TERMS; OPS-05 | Name a backup person (D-10) |
| 6 | The apps and website carry the KayKay's name, which would appear to every customer | ISMS-UG Chapter 1; ISMS-TD Section 16.1 | Brand decision D-17; E-8 for white-label |
| 7 | The customer website is built for one business per deployment | ISMS-TD Section 16.1 | Price as a per-customer add-on ([Table 7.4](#t-7-4)) |
| 8 | Payment and tax integrations are documented as features but have not been run against the real providers | ISMS-TD Table 12.1 | Do not sell them as working (R-13) |
| 9 | The LICENSE forbids running ISMS as a service for others, which a reseller or operator licensee would need | LICENSE s.4(f) | Separate written agreements override it (LICENSE s.13(b)) |
| 10 | The cost register in `docs/infrastructure/cost-management.md` is the source for provider costs; it records them in US dollars and is partly "Owner to confirm" | Cost management | Fill G-03; keep both documents in step |

No contradictions were found between this document and the procedures in ISMS-UG, ISMS-TD and ISMS-AG; this document adds commercial terms on top of them and changes none of them.

# Appendix G: Source Documents and Build

**Table G.1:** Sources examined

| Source | Used for |
|---|---|
| `LICENSE` (Commercial Software License Agreement) | Existing licence terms, ownership |
| `TERMS.md` (Terms of Use 1.0) | Support targets, data deletion, providers |
| `README.md` | Product description, technology |
| `documentation/final/ISMS-System-User-Guide/ISMS-UG.md` | Modules and screens |
| `documentation/final/ISMS-Technical-Documentation/ISMS-TD.md` | Architecture, integrations, build variables, limitations, scalability |
| `documentation/final/ISMS-System-Administration-Guide/ISMS-AG.md` | Duties, readiness, backups, data management |
| `docs/infrastructure/cost-management.md` | Measured usage, provider plans, list prices, growth costs |
| `docs/operations/accounts-and-ownership.md` | Provider accounts and holders |
| `docs/security/threat-register.md` | Open findings (SEC, OPS, EXP) |
| `docs/TO_FINISH.md` | Items not yet live |
| `supabase/migrations/` | Business creation rights; absence of licence or billing tables |
| `package.json` and `node_modules/*/package.json` | Open-source licences of direct dependencies |
| `git log` | Authorship and history |
| `CLAUDE.md` | Money and number rules |

**Building this document.** The Markdown file is the master. The PDF and Word files are produced with the same tool as the other three documents, through a small wrapper that registers this document without changing the tool:

```bash
python3 documentation/tools/build_clf.py            # checks, PDF and DOCX
python3 documentation/tools/build_clf.py --check    # checks only
```
