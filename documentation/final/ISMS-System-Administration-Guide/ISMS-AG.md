---
title: ISMS System Administration Guide
short_title: ISMS System Administration Guide (ISMS-AG)
software: KayKay's Integrated Shop Management System (ISMS)
description: Administrative responsibilities and procedures for business owners and admins, and for the operator of the ISMS platform: access, configuration, security, audit, data, backups, incidents and maintenance.
doc_id: ISMS-AG
version: "1.1"
software_release: "1.0.1"
status: Draft for review
created: 24 November 2026
date: 24 November 2026
classification: Internal: restricted to administrators
organisation: KayKay's
author: Dennis Kimanthi Gitonga, Codensons
contact: kimanthidennis02@gmail.com; codensons@gmail.com
---

# Document Control

| Item | Value |
|---|---|
| Document title | ISMS System Administration Guide |
| Document identifier | ISMS-AG |
| Version | 1.1 |
| Status | Draft for review |
| Software release described | ISMS 1.0.1 |
| Created | 24 November 2026 |
| Last updated | 24 November 2026 |
| Document owner | Dennis Kimanthi Gitonga, Codensons |
| Contact | kimanthidennis02@gmail.com (developer); codensons@gmail.com (company) |
| Related documents | ISMS-UG System User Guide; ISMS-TD Technical Documentation |
| Source file | `documentation/final/ISMS-System-Administration-Guide/ISMS-AG.md` |

# Version History

| Version | Date | Description |
|---|---|---|
| 1.1 | 24 November 2026 | Document owner named (Dennis Kimanthi Gitonga, Codensons). Updated for the owner's decisions: the audit trail, sales, stock history and points used can no longer be deleted; one receipt number format (`TXN-`) everywhere; points settings only on Promotions & Points; Report a problem needs the `support.report` permission. |
| 1.0 | 24 November 2026 | First issue. Consolidates the administration content of the user guide (Workers, Roles, Settings, Business Management), the roles document, the backup and recovery plan, the deployment and monitoring guide, the owner setup steps, the incident response plan and the accounts register. |

# Table of Contents

<!-- TOC -->

# List of Figures

<!-- LIST OF FIGURES -->

# List of Tables

<!-- LIST OF TABLES -->

# Part I: Administration Overview

# Chapter 1: Introduction

## 1.1 Purpose

This guide describes the administrative duties and procedures that keep ISMS correctly configured, secure and recoverable. It covers the administration screens of the staff app and the operations performed on the providers that host ISMS.

## 1.2 Intended audience

**Table 1.1:** Administrative audiences

| Audience | Who | Works in |
|---|---|---|
| Business administrator | A person with the Owner or Admin role in a business | The staff app: Workers, Roles, Audit Log, Business Management, Settings, Payments & Expenses > Methods |
| Platform operator | Whoever holds the ISMS provider accounts (Supabase, Cloudflare, GitHub, Telegram, Google) and the signing keys | Provider dashboards, the repository and its scripts |

Today one person holds the platform operator duties and is also on call (finding OPS-05). Sections marked **Platform operator** are not available to business administrators.

## 1.3 Scope

Included: user and access administration, role and permission management, system and business configuration, payment and integration set-up, security administration, audit and monitoring, data management, backups and recovery, incident management and maintenance.

Not included: daily use of the screens (ISMS-UG) and the internal design, code and development procedures (ISMS-TD).

## 1.4 Conventions

The conventions of ISMS-UG apply. In addition, commands are shown in `code` and are run from the repository folder on the platform operator's computer unless stated otherwise. `<project-ref>` stands for the Supabase project reference; real identifiers are kept in `docs/operations/accounts-and-ownership.md`, not in this guide.

# Chapter 2: Administrative Responsibilities

## 2.1 Business administrator duties

**Table 2.1:** Business administrator duties

| Duty | How often | Where |
|---|---|---|
| Invite, change and remove staff | When staff change | Workers ([Chapter 4](#ch-4)) |
| Decide what each role may do | When needed | Roles ([Chapter 5](#ch-5)) |
| Keep business details, branches, logo and tax correct | When they change | Business Management ([Section 7.1](#s-7-1)) |
| Keep receipts, invoices, printers and messaging set up | When they change | Settings ([Chapter 6](#ch-6)) |
| Choose which payment methods are on | When needed | Payments & Expenses > Methods ([Section 7.2](#s-7-2)) |
| Clear the "Paid to the till" list | Daily | Payments & Expenses > M-Pesa (ISMS-UG) |
| Check flagged website orders | Daily | Online Store > Orders |
| Review the audit log | Weekly | Audit Log ([Chapter 10](#ch-10)) |
| Set up and check the business's own Google Sheets backup | Once, then monthly | Settings > Backups ([Section 12.4](#s-12-4)) |
| Count money and stock against the books; lock checked months | Monthly | Finance & Accounting > Checks |
| Report problems | As they happen | About this app > Report a problem ([Section 13.2](#s-13-2)) |

## 2.2 Platform operator duties

**Table 2.2:** Platform operator duties

| Duty | How often | Where |
|---|---|---|
| Answer alerts | As they come | Telegram ([Section 10.3](#s-10-3)) |
| Apply database changes and deploy server functions | Each change | [Section 14.2](#s-14-2) |
| Check the restore drill passed | Weekly (Mondays) | GitHub Actions > Restore drill |
| Make the offline copy of backups and keys | Monthly | [Section 12.6](#s-12-6) |
| Read provider usage and bills | Monthly | `docs/infrastructure/cost-management.md` |
| Review security scans | Weekly | GitHub Actions > Security |
| Review the threat register and incident plan | Quarterly | `docs/security/threat-register.md` |
| Renew the domain, check payment cards on file | Yearly or when told | Provider dashboards |

## 2.3 Current readiness

At 23 November 2026 the platform was assessed as **Not Ready** for paying businesses. The reasons are on the provider side: the independent backup has never run because its secrets are not set, two-step sign-in (MFA) is not available to owners and admins, the database is very likely on the provider's free plan, and the uptime monitor is not set up. The open findings are summarised in [Section 9.5](#s-9-5).

# Chapter 3: Administrative Roles and Permissions

## 3.1 Roles

**Table 3.1:** Roles and their purpose

| Role | Purpose | Administrative reach |
|---|---|---|
| Owner | Owns the business | Everything. Bypasses permission checks by design |
| Admin | Runs the business on the owner's behalf | Everything. Bypasses permission checks by design |
| Manager | Runs the shop day to day | Settings (no keys), staff view and schedules; no Roles, Audit Log or Business Management |
| Cashier | Sells at the till | None |
| Rider | Delivers orders | None |
| Supplier | Outside supplier | None; sees only the supplier page |

Other role names, such as `Sales Staff` and `Viewer`, exist in the database but have no permissions until an Owner or Admin grants some.

## 3.2 Who can see what

**Table 3.2:** Default access by area

| Area | Owner, Admin | Manager | Cashier | Rider |
|---|---|---|---|---|
| Own profile, own shifts, clock in | Yes | Yes | Yes | Yes |
| Home (business figures) | Yes | Yes | No | No |
| Sell | Yes | Yes | Yes | No |
| Inventory | Full | Full | View | No |
| Sales history | All | All | Own sales and customers' sales | No |
| Online orders | All | All | View, prepare | Only assigned deliveries |
| Customers | Full | Full, no delete | View, add | Only customers on their deliveries |
| Debts | Yes | Yes | Yes | No |
| Profit | Yes | Yes | No | No |
| Complaints | Reply | Reply | View, log | No |
| Expenses | Yes | Yes, no delete | No | No |
| Payments & Expenses screen | All tabs, void payments | Payments, Expenses, M-Pesa (assign till payments) | Payments, M-Pesa (send prompts, assign till payments) | No |
| M-Pesa till number and registration | Yes | No | No | No |
| Payment Prompts screen | Yes | No | Yes | No |
| Business Management (branches, branding) | Yes | No | No | No |
| Staff | Full | View, schedule | No | No |
| Settings, backups, API keys | Yes | Some settings, no keys | No | No |
| Set points or tiers by hand | Yes | Yes | No | No |
| Set wallet or debt balances by hand | Yes | Yes | No | No |
| Deliveries assigned to them | Yes | Yes | Yes, by assigning | Yes |

The screen-by-screen defaults are in ISMS-UG Appendix B. The full list of 188 permission codes is in ISMS-TD Appendix A.

## 3.3 How access is enforced

A permission is enforced in three places, so hiding a screen is never the only protection:

1. the app hides screens and buttons the role does not have;
2. the database refuses the rows and functions, even for a direct API call;
3. server functions refuse the call before doing paid or sensitive work.

A change made in **Roles** is read by all three at once.

## 3.4 Known limits of access control

- Any member can read colleagues' names and contact details, because the app needs them for assigning and display.
- Owners and Admins bypass permission checks by design. Give these roles only to people who need everything.

# Part II: System Administration

# Chapter 4: User and Access Administration

## 4.1 The Workers screen

![Figure 4.1: Workers: invite someone and see the team](images/screens/workers.jpg)

**Workers** ([Figure 4.1](#f-4-1)) lists the team, invitations and schedules. Access: `staff.view` to see it (Owner, Admin, Manager); inviting needs `staff.invite`, changing roles `staff.update`, removing `staff.remove` (Owner, Admin).

## 4.2 Inviting a staff member

1. Open **Workers** and choose to invite.
2. Enter the person's email address and choose their role.
3. Send the invitation.

**Expected result:** the person receives a code by email. They join by signing up or signing in with **that email** and confirming it (ISMS-UG Section 5.1).

**Rules:**

- An invitation works only for the email it was sent to. Only an email the server has verified counts; an unverified account can only claim the invitation, which completes after the email is confirmed.
- Only the person who created the business can create another business. Invited staff never see that option.

## 4.3 Inviting a supplier

Choose **+ A new supplier** in **Workers** (or **Buying > Invite a supplier**, which opens the same form with the Supplier role). A supplier with an email gets a sign-in to the supplier page only. Suppliers are kept separately from staff and never gain access to staff data.

## 4.4 Managing an invitation

Hold an invitation to copy its code or revoke it. Revoking an invitation also removes the half-made account of a person who started signing up with it.

## 4.5 Changing a person's role or removing them

1. In **Workers**, hold or swipe the person.
2. Choose to change their role, copy their details, or remove them from the business.

**Expected result:** a role change applies at once on every device. A removed person loses access to the business.

## 4.6 When someone leaves or a device is lost

1. Remove the person in **Workers**, or change their role.
2. If an account may be misused, the platform operator signs out all its sessions in the Supabase dashboard (**Authentication > Users**). Signing out revokes the session on the server.
3. Check what the person did recently: the sale edit log, the Audit Log, money movements, refunds, wallet top-ups and stock adjustments ([Chapter 10](#ch-10)).

## 4.7 Shared devices

Each person can set a personal PIN in **My Profile** so that a shared device locks when they step away (ISMS-UG Section 5.5).

# Chapter 5: Role and Permission Management

## 5.1 The Roles screen

![Figure 5.1: Roles: what each role can see and do](images/screens/roles.jpg)

**Roles** ([Figure 5.1](#f-5-1)) shows every permission, grouped by area, with a plain description, and whether each role has it. Access: `staff.roles` (Owner, Admin).

## 5.2 Granting or removing a permission

1. Open **Roles** and choose the role.
2. Find the permission (use the search box if needed).
3. Switch it on or off.

**Expected result:** the change saves for the business and overrides the built-in default. It applies at once on every device, in the app, the database and the server functions.

## 5.3 Guidance

- Grant the smallest set a person needs. For example, cashiers can apply promotion codes at the till (`pos.apply_promotion`) but should not create them (`promotions.manage`).
- By default, Managers do not have the M-Pesa and Airtel prompt permissions (`payments.mpesa`, `payments.airtel`), so they do not see **Payment Prompts**. Grant them if managers should send prompts.
- Changing the built-in defaults for every business is a code change (ISMS-TD Section 22.4), not a Roles change.

# Chapter 6: System Configuration

## 6.1 The Settings screen

![Figure 6.1: Settings, open on Receipts & printing](images/screens/settings.jpg)

**Settings** ([Figure 6.1](#f-6-1)) holds the business's configuration in collapsible sections. Access: `settings.view` (Owner, Admin, Manager). Sections with keys or data management are for owners and admins. Settings save by themselves.

**Table 6.1:** Settings sections

| Group | Section | What is set |
|---|---|---|
| Shop | Receipts & printing | Paper size, shop details on receipts, printers, barcode, QR code, KRA eTIMS |
| Shop | Invoices | Invoice texts, number prefix, due days, payment details, logo size, stamp |
| Connections | SMS | Text messages through Twilio |
| Connections | WhatsApp | Sending through WhatsApp |
| Connections | AI assistant | Provider, model and instructions |
| Data | Backups | Google Sheets backup and its schedule |
| Data | Old records | Clear old crash and backup logs (owners and admins) |
| This device | Device permissions | Camera, location, Bluetooth, notifications, storage |
| Account | Notifications | What you are notified about |
| Account | Help & tour | Restart the guided tour |
| Account | Sign out | End the session on this device |

## 6.2 Receipts and printing

Set the paper width, the shop details printed on receipts, the header and footer text, the barcode and the extra QR code. The receipt number is always `TXN-` and the sale's code (for example `TXN-D6EB287C`), the same as in the Sales Log, search and the books. It is not a counted number: the code comes from the sale itself, so sales made offline already have it. Printers are found and tested in the same section (ISMS-UG Section 10.5).

Nothing on a receipt is a placeholder: there are no default contact details or sample verification links. Enter the real shop details before the first sale.

## 6.3 Invoices

Set the invoice texts, the number prefix, the due days, the payment details printed on invoices, the logo size and the stamp.

## 6.4 KRA eTIMS

KRA eTIMS signs each sale with the Kenya Revenue Authority. Access: `settings.integrations`.

1. Open **Settings > Receipts & printing > KRA eTIMS**.
2. Choose the system: **KRA test system** first. Receipts from the test system are marked as not valid.
3. Enter the **KRA PIN**, the **Branch ID** (00 for head office) and the **Device serial number** from the eTIMS approval.
4. Enter the **Item classification code** for products that have none.
5. Choose how **sales without VAT** are reported: Non-VAT (D), Exempt (A) or Zero-rated (C). This is also used for delivery fees, which are charged without VAT.
6. Connect. The details are checked with KRA before they are saved.

**Expected result:** each sale is sent to KRA and its receipt carries the KRA section and QR code. VAT can be switched on only once eTIMS is connected. An offline sale is signed when it syncs.

> **Warning:** The KRA connection has not yet been run against the KRA test system. Confirm one signed test sale before switching to the live system.

## 6.5 Messaging (SMS and WhatsApp)

Enter the business's own Twilio (SMS) or WhatsApp Cloud API account details. Keys are stored on the server and shown masked. Without them, staff send WhatsApp messages by opening each chat by hand.

- WhatsApp allows free text only within 24 hours of the customer's last message; otherwise an approved template is used. Delivery is not confirmed: a send counts as done once WhatsApp accepts it.
- Limits: SMS and WhatsApp 200 per hour per person and 1,000 per day per business; email 30 per hour per person.

## 6.6 AI assistant

Choose the AI provider and model and enter the key. The key is stored on the server and only ever shown masked. Without a provider, AI answers are unavailable and the rest of the app works. AI use is limited to 20 requests per minute per person and 500 per day per business.

## 6.7 Device permissions and notifications

**Device permissions** shows and requests camera, location, Bluetooth, notification and storage access on the current device. **Notifications** sets what the signed-in person is alerted about (ISMS-UG Chapter 26).

# Chapter 7: Business Configuration

## 7.1 Business Management

![Figure 7.1: Business Management: branches, details, logo and cover](images/screens/business-management.jpg)

**Business Management** ([Figure 7.1](#f-7-1)) holds the business details, branches (**N** adds one), logo and cover, colours and tax. Access: `business.update` (Owner, Admin). The website uses the business description, address, phone and email from here.

## 7.2 Payment methods

1. Open **Payments & Expenses > Methods** (`payments.configure`, Owner and Admin).
2. Switch each method on or off: Cash, M-Pesa, Airtel Money, Card, Bank.

**Expected result:** a method that is off disappears from the till and the website, and the server refuses prompts or charges for it. Money that still arrives by that method is recorded.

## 7.3 M-Pesa till

ISMS uses an M-Pesa **till** (Buy Goods). A payment sent to a till from the customer's own phone carries no account number, so it waits in **Paid to the till** until staff assign it.

1. **Platform operator:** set the M-Pesa credentials on the server (ISMS-TD Section 16.2), starting with the sandbox.
2. Open **Payments & Expenses > M-Pesa** (Owner only).
3. Enter the till number.
4. Press **Register till with Safaricom**. Each branch with its own till does this once.

**Expected result:** payments to the till appear in **Paid to the till**; prompts sent from the app are recorded automatically when the customer pays.

> **Warning:** M-Pesa, Airtel Money and card payments have not yet been run against the real providers or their test systems. Make a sandbox payment, then one small real payment, before relying on them.

## 7.4 Airtel Money and cards

Airtel Money prompts are set up in **Payments & Expenses > Airtel Money**, and Paystack card payments in **Payments & Expenses > Cards** (`settings.integrations`). Each business uses its own provider account; the secret keys stay on the server.

## 7.5 Delivery areas and fees

Delivery areas and their prices are kept in **Deliveries > Areas & prices**. The delivery fee defaults to zero: set the areas and prices before opening the website.

## 7.6 Customer website

**Business administrator:**

1. In **Online Store > Website**, set the website name, the delivery areas or fee, and untick products customers should not see.
2. Add, check and publish the starter guides under **Online Store > Guides**.
3. Fill in the business description, address, phone and email in **Business Management**.

**Platform operator:**

4. Deploy the checkout, payment callback and shop assistant functions and set the M-Pesa secrets (ISMS-TD Chapter 16).
5. In Supabase Auth, add the website address to the redirect URLs and set up an email provider.
6. Publish the website (ISMS-TD Section 15.2).
7. Make a sandbox payment, then switch to the live till credentials and make one small real payment before announcing the site.

To use the shop's own domain, follow `docs/HOSTING_CLOUDFLARE.md` section 3.5, then set the website address in the build settings and in the Supabase redirect URLs, and submit the sitemap to Google Search Console.

## 7.7 Dial-code ordering

Customers without a smartphone can order and pay from any phone by dialling a code, through Africa's Talking.

1. **Platform operator:** create an Africa's Talking account, generate a callback token and set it with the shop's website name on the server, then deploy the dial-code function (ISMS-TD Section 12.4).
2. In Africa's Talking, create a USSD channel whose callback is the dial-code function address with the token.
3. Test on the Africa's Talking simulator.
4. For live use, request a service code (approval can take weeks), top up the account, set the same callback on the live channel, and test one order from a real phone.

> **Note:** Dial-code ordering has been tested with simulated requests only; the real gateway has never been called.

# Chapter 8: Administrative Operations

## 8.1 Money rules

These rules are set by the owner and apply to every administrative action:

1. **Every money movement is recorded in the app.** Sales, refunds, debt payments, wallet top-ups, supplier payments, rider pay, petty cash, expenses and wages each have a record. Nothing is paid outside the app.
2. **The books and the figures on screen always agree.** One record moves the payment balance, posts to the books and feeds every report.
3. **A money record is never edited into a different amount.** To correct it, void or remove it (which reverses the balance and the books) and record it again.
4. **Whoever the money goes to does not need an account.** Their name is recorded so the payment can be traced (for example a rider named at the sale).

Money always has two decimals; quantities have at most one.

## 8.2 Correcting records

**Table 8.1:** How to correct each kind of record

| Record | Correction |
|---|---|
| Sale | Refund (credit note), or Edit (refund and sell again). Never deleted |
| Payment | Void with a reason (`payments.manage`, Owner and Admin), then record again |
| Expense, petty cash | Remove with a reason, then record again. Staff can remove their own petty cash entry within 24 hours |
| Stock level | Adjust or count with a reason |
| Books | Count money and stock in Finance & Accounting > Checks; a journal entry for anything else (`accounting.manage`) |
| Customer balance | Pay debt, top up, or an Owner or Manager adjusts by hand; direct changes are refused |

## 8.3 Locking a month

In **Finance & Accounting > Checks**, an owner can lock a month once it is checked. A later change to a locked month is posted as a correction in the open month.

## 8.4 Merging duplicate customers

Managers merge duplicates in **Customers > Duplicates** (ISMS-UG Section 12.4.5). There is no undo; each merge is recorded with both records as they were.

# Part III: Security and Data Management

# Chapter 9: Security Administration

## 9.1 Security principles

- Every table is protected by row-level rules: a person reaches only the data of businesses they are an active member of.
- Prices, stock, points, balances and permissions are worked out and checked on the server; the app's own totals are never trusted.
- Provider keys are kept on the server; the app only ever sees masked values.
- Signed-out sessions are refused by the server.
- Only a server-verified email gives access.
- Public functions that turn a caller away write a security log; promotion codes are rate limited so they cannot be guessed.

## 9.2 Owner account settings (Platform operator)

These settings make the platform safe to run and can only be changed with the owner's provider logins. Click-by-click steps for each are in `docs/operations/owner-setup.md`.

**Table 9.1:** Owner account settings

| # | Setting | Where | Check |
|---|---|---|---|
| 1 | Password rules: at least 8 characters, letters and digits | Supabase > Authentication | The password `abc123` is refused at sign-up |
| 2 | Two-step sign-in (TOTP) | Supabase > Authentication > Multi-Factor | The switch stays on after reload |
| 3 | Remove old and test accounts | Supabase > Authentication > Users | Only wanted accounts remain |
| 4 | Empty old files (not the buckets) | Supabase > Storage | Buckets hold only wanted files |
| 5 | New database password | Supabase > Project Settings > Database | The migration list still connects |
| 6 | Paid plan with spend cap | Supabase > Organization > Billing | "Spend cap: enabled" |
| 7 | Backup storage bucket and token | Cloudflare > R2 | Bucket `kaykays-backups` exists |
| 8 | Backup secrets | GitHub > Settings > Secrets | Four secrets listed ([Section 12.5](#s-12-5)) |
| 9 | Test backup and restore | GitHub > Actions | Both runs green |
| 10 | Protect `main` | GitHub > Settings > Branches | A force push is refused |
| 11 | Dependency alerts | GitHub > Settings > Code security | Alerts enabled |
| 12 | Spending limit $0 | GitHub > Billing | The limit shows $0 |
| 13 | Two-step sign-in on every provider account | Supabase, GitHub, Cloudflare, Google, Hugging Face, Telegram, domain registrar | A new browser asks for the code |

## 9.3 Secrets

- Server secrets (payment, messaging, AI, alerts) are set with the Supabase command line and never placed in the app or the repository. The names are listed in ISMS-TD Chapter 16.
- Build secrets are GitHub repository secrets.
- Treat provider callback addresses that contain a token as passwords. If one leaks, change the token, register the till again, and update the Africa's Talking channel.
- The Telegram bot token lets anyone send as the bot. If it leaks, revoke it with @BotFather and store the new one.

## 9.4 Accounts and recovery

Every provider account ISMS depends on must have two ways back in: an authenticator app and backup codes kept offline. Keys that have no recovery (the Android signing key, the desktop update key and the backup passphrase) must exist in at least two offline places.

**Table 9.2:** Keys without a recovery route

| Key | If lost |
|---|---|
| Android signing key | Installed phones can never update; every phone must reinstall |
| Desktop update key | Installed computers refuse every update |
| Backup passphrase | No backup can ever be opened |

The register of accounts, their owners and recovery routes is `docs/operations/accounts-and-ownership.md`. A second trusted person who can reach the offline copy has not yet been named (finding OPS-05).

## 9.5 Open security findings

Findings are tracked in `docs/security/threat-register.md`. At 24 November 2026 the open items that need administrative action are:

**Table 9.3:** Open findings needing administrative action

| ID | Severity | Finding | Action |
|---|---|---|---|
| SEC-02 | P1 | No working independent backup; restore never tested on real data | Owner settings 7–9 ([Table 9.1](#t-9-1)) |
| SEC-03 | P1 | No two-step sign-in for owners and admins | Owner setting 2; app work also needed |
| SEC-04, SEC-05 | P1 | A test password was published; earlier misuse cannot be ruled out | Owner setting 3; reset passwords |
| SEC-07 | P2 | Live password minimum is 6 characters | Owner setting 1 |
| SEC-09 | P2 | `main` branch unprotected | Owner setting 10 |
| SEC-10 | P2 | M-Pesa success taken from the callback; callback token not set live | Platform operator |
| SEC-12 | P2 | An old Android key is still reachable in public history | Platform operator |
| OPS-04 | P2 | All email goes through one personal mailbox (about 500 a day) | Move to a sending service |
| OPS-05 | P2 | One person holds every account, key and the on-call phone | Name a backup person |
| OPS-06 | P2 | Database very likely on the free plan (pauses when idle, no restorable backups) | Owner setting 6 |
| EXP-06 | P2 | Privacy policy does not disclose hosting in the EU or every processor | Data protection adviser |

# Chapter 10: Audit Trails and Activity Monitoring

## 10.1 The Audit Log

![Figure 10.1: Audit Log: who changed what](images/screens/audit-log.jpg)

**Audit Log** ([Figure 10.1](#f-10-1)) shows who changed what: prices, suppliers, purchases, staff PINs and roles, and changes to sales. Access: `audit.view` (Owner, Admin). Entries cannot be edited or deleted by anyone, including owners and admins: the database refuses it.

> **Note:** The audit trail is kept for good. It is not one of the logs that **Settings > Old records** can clear ([Section 11.2](#s-11-2)).

## 10.2 Other activity records

**Table 10.1:** Where activity is recorded

| Activity | Where to see it |
|---|---|
| Changes to a sale | **Edited N×** on the sale in the Sales Log |
| Stock changes | Stock History, each with a `STM-` number and who made it |
| Customer balance changes | The customer's **Ledger** tab |
| Payments and voids | Payments & Expenses; a void keeps who and why |
| Crashes | Reported to the platform operator; also readable by owners and admins of the business |
| Problem reports | Telegram and the `problem_reports` table |
| Refused calls to public functions | The `security_events` log (platform operator) |

## 10.3 Alerts (Platform operator)

Alerts go to the operator's Telegram chat.

**Table 10.2:** Alerts and their sources

| Alert | When |
|---|---|
| Release live; release, build or test failed | Each release or failure |
| Web deploy failed or rolled back | A failed check, or any rollback |
| Database backup failed | A failed or suspicious hourly backup (once, then daily while it lasts) |
| Restore drill failed | Monday's test restore failed, or the newest backup is over 26 hours old |
| New crash | First occurrence, then at 10, 100 and 1,000 (at most 30 an hour) |
| Problem report | Someone with `support.report` (owners and admins by default) uses **Report a problem** |
| Watchdog problem | A scheduled job failed, a payment is stuck over 30 minutes, the database is over 80% full or over 80% of connections, file storage is nearly full, or calls to server functions are failing. Sent once, again every 6 hours while it lasts, and when fixed |
| Site or database down | The outside uptime monitor (not yet set up) |

The database watchdog runs every 10 minutes. The public health check (`GET …/functions/v1/ops-alert`) answers 503 when the watchdog has not run for 30 minutes, so an outside monitor notices if scheduled jobs stop.

## 10.4 Setting up the uptime monitor (Platform operator)

1. Create HTTP monitors every 5 minutes in a free outside service (for example UptimeRobot or Better Stack) for: the staff web app (expect 200), the website and its `/terms` page (expect 200), and the health check (expect 200 and the text `"ok":true`).
2. Add Telegram **and** email as alert contacts, so an alert still arrives if one channel fails.
3. Break one monitor on purpose once to see the alert arrive.

## 10.5 Testing the alert path (Platform operator)

Run `SELECT public.run_ops_watchdog(true);` in the Supabase SQL editor. A "Watchdog test" message should arrive in Telegram.

# Chapter 11: Data Management

## 11.1 Where the data lives

All business data is in one Supabase database, separated by business. Logos and photos are in Supabase Storage. Offline sales wait on the device until they are sent.

## 11.2 Clearing old records

**Settings > Old records** (owners and admins) shows how large each log that may be cleared is, and deletes entries older than a chosen age (30 days, 3 months, 6 months, 1 year, or everything).

**Table 11.1:** Logs that can be cleared

| Log | Effect of deleting |
|---|---|
| Points earned | Balances stay; the Earned totals drop |
| Backup history | Only the list of runs; not the backups |
| Crash reports | None on the business |

**Table 11.2:** Records that are always kept

| Record | Why it is kept |
|---|---|
| Sales | Sales reports, the books and tax records stand on them. A wrong sale is refunded or edited, never deleted |
| Stock history | Damage, waste, count differences and opening stock are in the books; the stock report reads them |
| Points used | A discount that profit figures read |
| Audit trail | The record of who changed what; one that can be deleted proves nothing |

> **Note:** Sales are kept for at least five years, the period Kenyan tax law requires records to be kept (owner decision, 24 November 2026). The app never removes them; any archiving of older sales must keep at least five years available.

## 11.3 Personal data

Customer and staff data is personal data under Kenya's Data Protection Act 2019. There is not yet a tool to erase one customer's data, and no automatic retention period for notifications and the audit log (finding EXP-07). Crash and problem reports have emails, phone numbers, IDs and tokens removed on the device before they are sent.

## 11.4 Test data

The live database holds test data (two branches, an admin, riders, products and customers) loaded from `supabase/seed_quick.sql`. Its logins are in `supabase/SEED_LOGINS.md`.

> **Warning:** Wipe the test data before real use with `supabase/dev_wipe.sql` (Platform operator). The wipe also removes the owner's own account and business, and refuses to run until a confirmation setting is given. Never run it against a database with real data without a backup.

# Chapter 12: Backup and Recovery

## 12.1 Targets

**Table 12.1:** Recovery targets

| Target | Value | Means |
|---|---|---|
| Recovery point (most data that can be lost) | 1 hour | Hourly encrypted copy. Offline sales still on devices sync after a restore |
| Recovery time | 4 hours for a full restore; 30 minutes for a web rollback | [Section 12.7](#s-12-7) |
| Proof | Automatic restore drill every Monday, plus a hands-on one each month | [Section 12.8](#s-12-8) |

> **Important:** The hourly backup has never run: its secrets are not set (SEC-02). Until owner settings 7–9 are done, the only recovery is the database provider's own backup, which the free plan does not include.

## 12.2 What must be protected

**Table 12.2:** Protected items

| Item | Where it lives | Backed up by | If lost |
|---|---|---|---|
| Database (all businesses, sign-ins) | Supabase | Layers 1, 2 and 3 | Everything |
| Storage files (logos) | Supabase Storage | Monthly manual copy | Logos re-uploaded by hand |
| Android signing key | Operator's computer, GitHub secret | Offline copy | Phones can never update |
| Desktop update key | Operator's computer, GitHub secret | Offline copy | Computers refuse updates |
| Backup passphrase | GitHub secret | Offline copy, password manager | Every backup unreadable |
| Secrets and configuration | GitHub, Supabase, Cloudflare | Names in ISMS-TD Chapter 16; values in a password manager | Hours of re-issuing keys |
| Source code | GitHub | Every clone; monthly offline bundle | Rebuild from a clone |
| Releases | The public releases repository | Rebuilt from a tag | Re-run the release |

## 12.3 Backup layers

**Table 12.3:** Backup layers

| Layer | What | How often | Kept | Where |
|---|---|---|---|---|
| L1 Provider backups | Whole database | Daily on the paid plan | 7 days (none on the free plan) | Supabase |
| L2 Hourly encrypted copy | Roles, schema and data | Every hour, and by hand before risky changes | Hourly 3 days; daily 35 days; weekly 6 months; monthly 13 months | Cloudflare R2 bucket `kaykays-backups`, AES-256 encrypted |
| L3 Google Sheets | One business's sales, stock, customers, debts, wallet | The business's chosen schedule | In the owner's sheet | The business's Google Drive |
| L4 Offline copy | Latest weekly L2 copy, signing keys, passphrase, code bundle | First Monday of each month | 12 months | Encrypted USB drive off-site, plus a password manager |

L1 is quickest but sits with the same provider as the database. L2 survives losing the provider project or account. L3 lets an owner keep their own records. L4 survives losing GitHub access as well.

## 12.4 Setting up the Google Sheets backup (Business administrator)

1. Open **Settings > Backups**.
2. Connect the Google Sheet and service account.
3. Choose the schedule (for example every night at 12:00 AM or 3:00 AM, or every 12 hours). Times are Nairobi time.
4. Use **Backup Now** once and check the sheet.

**Expected result:** runs appear in the backup history; automatic ones are marked `auto`. Runs need two server secrets set by the platform operator (ISMS-TD Section 16.3).

## 12.5 Setting up the hourly backup (Platform operator)

1. In Supabase, copy the **Session pooler** connection string and fill in the database password.
2. Make a passphrase (`openssl rand -base64 32`). **Save it in the password manager and the offline copy first.**
3. In Cloudflare R2, create the private bucket `kaykays-backups` and an API token with Object Read & Write on that bucket only.
4. Set the four GitHub secrets: `gh secret set SUPABASE_DB_URL`, `BACKUP_PASSPHRASE`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`.
5. Run **Actions > Back up database**, then **Actions > Restore drill**. Both must be green.
6. Put the same values in `~/.config/kaykays-backup/env` (`chmod 600`) so `scripts/db-backup.sh` can reach the backups.

Each run checks that the copy holds the core tables, is not suspiciously small, and opens with the passphrase. It also records the code commit, the latest migration and the row count of every table.

Before a risky database change, take a copy by hand and keep it long: **Run workflow** with tier `monthly`, or `scripts/db-backup.sh now`.

## 12.6 Offline copy (Platform operator, monthly)

1. Download the latest weekly copy: `scripts/db-backup.sh list weekly`, then `scripts/db-backup.sh get <name>`.
2. Copy the signing keys: `~/.config/kaykays-signing` and `~/.tauri`.
3. Bundle the code: `git bundle create isms-<date>.bundle --all`.
4. Copy everything to the encrypted USB drive, delete the loose keys, and check the drive opens before putting it away.
5. Copy the logos: `npx supabase storage cp -r ss:///business-logos <folder> --experimental`.

## 12.7 Restoring

> **Important:** Before restoring anything, take a fresh backup of the current state, even if it is broken.

**Table 12.4:** Choosing a restore

| Situation | Restore |
|---|---|
| Whole database lost or corrupted | L1 (provider restore, or point-in-time if available). Otherwise L2 into a new project: load roles, schema and data, deploy every function, set the secrets again, copy the logos back, and point the apps at the new project with a release. Restore into the same project when possible, so apps need no new release |
| One business, one table or a few rows wrong | Do not restore over live data. Restore the L2 copy from just before the mistake into a separate local database (`scripts/db-backup.sh restore <name>`), find the rows, and copy only those back with a checked insert |
| Rows soft-deleted by mistake | Bring them back without a restore |
| A key lost | Restore it from the offline copy and set the GitHub secret again |

`scripts/db-backup.sh restore` loads the copy into a separate local database (never the development one), removes scheduled jobs and server keys so the copy cannot call M-Pesa, Telegram or live functions, and checks every table has the rows the backup recorded. Delete the restored copy when finished: it holds customers' data unencrypted.

After a restore: tell owners what time the data goes back to; offline sales still on devices sync by themselves; payments made after the backup can be found again from M-Pesa and Paystack statements. Then check the books balance and the payment balances match the books.

## 12.8 Restore drill

The **Restore drill** workflow restores the newest backup on a clean machine every Monday and fails if the newest backup is over 26 hours old. Once a month, restore by hand, check the number of businesses and one business's last sale against the live app, and record the date and result in `docs/BACKUP_AND_RECOVERY.md` section 6.

# Chapter 13: Incident Management

## 13.1 Severity levels

**Table 13.1:** Severity levels and response times

| Level | Examples | First response | Owners told | Fixed or worked around |
|---|---|---|---|---|
| P1: cannot trade, or data exposed | Sales cannot be saved, sign-in fails for everyone, M-Pesa payments not arriving, database down | 15 minutes | 30 minutes | 4 hours |
| P2: something is wrong | One feature broken, a report wrong, receipts not printing | Same day | If it affects them | 2 days |
| P3: small | Wording, layout, ideas | Next release | No | When planned |

A problem report marked "We can't work" is P1 until shown otherwise.

## 13.2 Reporting a problem (Business administrator)

1. Open **About this app > Report a problem**.
2. Choose how serious it is: "We can't work", "Something is wrong", or "Small issue or idea".
3. Describe it.

**Expected result:** the report is saved first, so it is not lost if Telegram is down, and posted to the operator with the business, the reporter's name and role, the app version, platform and screen. Personal details are removed on the device. The app gives a reference such as `PR-4F2A9C` to quote when following up. Limit: 10 reports an hour per person.

## 13.3 The first 15 minutes (Platform operator)

1. **Is it everyone?** Check the uptime monitor, the health check, and the Supabase and Cloudflare status pages. If a provider is down, there is nothing to roll back: tell owners and wait.
2. **Did a release just go out?** If the web broke after a deploy, run **Actions > Roll back web**. If the database broke after a change, see [Section 12.7](#s-12-7).
3. **Tell owners.** Cash and M-Pesa till sales keep working offline and sync later; credit sales, payments, prompts, messages and sign-in need the connection.
4. **Fix forward** with a `fix:` commit; the release pipeline tests and checks it before it goes live.
5. **Afterwards,** write three lines: what broke, why, and what stops it happening again.

## 13.4 Playbooks

Each playbook follows the same order: stop it, find out how big it is, put it right, tell people. Keep a timeline as you go.

**Account compromise.** Signs: a sign-in you did not make, a provider's "new login" email, changed settings or secrets, an unexpected deploy, release or database change. From a clean device, change the password, sign out every other session and check two-step sign-in. Rotate what the account could read (database password, server keys, GitHub secrets, Cloudflare tokens, mail password). Look for changes made while the intruder was in. For an ISMS user account, remove or suspend the member, sign out their sessions, and check what they did ([Section 4.6](#s-4-6)).

**Data breach.** Close the hole and keep the evidence (do not delete logs or rows; copy the provider logs before their retention ends). Within 24 hours, establish which businesses, which data, how many people, and over what period. Kenya's Data Protection Act 2019 requires notifying the Data Commissioner within 72 hours of becoming aware of a breach that risks harm, and telling the people affected without undue delay. Tell each affected business owner at once. Confirm the exact duties with a data protection adviser before the first real case.

**Outage.** Check whether a provider is down, a release broke it, the project is paused (free plan after a week idle; restore it in the dashboard), or a quota is reached (free space or upgrade).

**Data loss.** Stop the writes that make it worse, find the extent, restore a copy (not live) and copy back only the missing rows, then check the books balance. Offline sales during the incident sync when the database is back.

## 13.5 Escalation

1. An alert in Telegram, or a "We can't work" report.
2. No answer to a P1 in 15 minutes: the uptime monitor's email reaches the same person on a second channel.
3. Provider at fault: open a ticket with the provider and tell owners.
4. A suspected breach: the platform owner decides on notices the same day, after the data protection adviser is consulted.

# Part IV: Maintenance and Support

# Chapter 14: System Maintenance

## 14.1 Routine tasks

**Table 14.1:** Routine maintenance

| When | Task | Who |
|---|---|---|
| Daily | Clear **Paid to the till**; check flagged online orders | Business administrator |
| Weekly | Review crash reports and failed backups; check the restore drill passed | Platform operator |
| After a release | Confirm one device updated | Platform operator |
| Monthly | Offline copy; hands-on restore drill; read provider usage and bills | Platform operator |
| Every 6 months | Renew the Apple sign-in client secret, if Apple sign-in is on | Platform operator |
| Quarterly | Review the threat register and incident plan | Platform owner and developer |
| Yearly | Renew the domain; check cards on file | Platform owner |

## 14.2 Applying changes (Platform operator)

Changes must keep the old and new app versions working during the switch.

1. Deploy changed server functions first: `npx supabase functions deploy <name>` (with `--no-verify-jwt` for the public callback functions).
2. Apply database changes only with `bash scripts/db-push.sh`. It refuses when a migration file has uncommitted changes, a check fails, the live database differs from the files, or a database test fails; then it shows the dry run, asks for `yes`, pushes, and runs `bash scripts/check-live-grants.sh`, which must list no problems.
3. Release the app by pushing to `main`. The release builds the apps, publishes the update, and deploys the web app and website.
4. Tick the steps in `docs/TO_FINISH.md`.

Take a backup by hand before any change that alters or deletes data.

## 14.3 Costs

At 23 November 2026 the platform cost nothing per month on free plans; the minimum for production use is about US$25–30 a month (the database provider's paid plan). The cost model and the levers to watch are in `docs/infrastructure/cost-management.md`.

## 14.4 Rolling back

- **Web app and website:** automatic when the live check after a deploy fails; by hand with **Actions > Roll back web**. Every version is kept.
- **Installed apps:** no rollback; the updaters refuse older versions. Push a `fix:` release; apps pick it up within 6 hours, or at once from **About this app > Check for updates**.
- **Database:** no automatic reversal. Fix forward with a new migration; restore data from a backup if needed ([Section 12.7](#s-12-7)).

A web rollback does not roll back the database; it is safe only while the database still supports the older app.

## 14.5 Planned changes

- **Making the code repository private** is planned in `docs/GOING_PRIVATE.md`. Until it is done, the code repository must stay public, because older apps download updates from it.
- **Moving to the shop's own domain** is described in `docs/HOSTING_CLOUDFLARE.md` section 3.5.

## 14.6 Work still to finish

Every change that is not fully live has numbered steps in `docs/TO_FINISH.md`, newest first. Nothing is called done until its steps are ticked.

# Chapter 15: Troubleshooting and Recovery Procedures

**Table 15.1:** Administrative troubleshooting

| Symptom | Likely cause | Action |
|---|---|---|
| A person can't see a screen | Their role lacks the permission | Grant it in **Roles** ([Section 5.2](#s-5-2)) |
| The invitation code doesn't work | Signed in with a different email, or email not confirmed | Sign in with the invited email and confirm it, or send a new invitation |
| No push notifications | Server push secret mismatch, or no Firebase set-up | Platform operator: check the push secrets (ISMS-TD Section 18.3) |
| M-Pesa prompt sent but sale not recorded | Callback function not deployed, or token mismatch | Platform operator: deploy it; check the callback token |
| Till payments never appear | Till not registered, or wrong short code | **Register till with Safaricom**; check the till short code setting |
| Dial-code callers see a network error | The reply took longer than 10 seconds | Check M-Pesa response time; retry |
| The website shows nothing | Website name not set | Set it in **Online Store > Website** |
| Backups never run | Server secrets missing | Platform operator: ISMS-TD Section 16.3 |
| "Too many requests" | A rate limit was reached | Wait; limits are in ISMS-TD Section 9.6 |
| Sign-up or password reset stopped working | Server change applied before the code function was deployed, or an old app | Deploy the sign-in code function; update the app |
| A customer's balance change is refused | The record was merged | Refresh the app |
| The VAT switch is greyed out | KRA eTIMS not connected | Connect it ([Section 6.4](#s-6-4)) |
| A phone shows "App not installed" for an update | Phone on a version signed with the old key | Uninstall and install the latest version by hand once |
| The project is paused | Free plan, a week without use | Restore it in the Supabase dashboard; move to the paid plan |

# Chapter 16: Administrative Best Practices

## 16.1 Access

- Give the Owner and Admin roles only to people who need everything; they bypass permission checks.
- Review **Workers** and **Roles** whenever staff change.
- Use a personal PIN on shared devices.

## 16.2 Money and data

- Clear **Paid to the till** daily, so customers' balances stay right.
- Count money and stock against the books monthly, then lock the month.
- Never correct a money record by editing; void and record again.
- Agree a retention period before clearing old records.

## 16.3 Platform

- Apply database changes only with `scripts/db-push.sh`.
- Keep keys without a recovery route in two offline places.
- Test the backup by restoring it, not by trusting it.
- Name a second person who can reach the offline copy.
- Test a new payment or tax connection in the provider's test system first, then with one small real transaction.

# Part V: References

# Chapter 17: Glossary

**Table 17.1:** Administrative glossary

| Term | Meaning |
|---|---|
| Blue-green deploy | Upload a new web version with no traffic, check it, then switch all traffic to it at once; switch back if the check fails |
| Edge function | Server code that runs on Supabase |
| MFA | Multi-factor (two-step) sign-in |
| Platform operator | Whoever holds the ISMS provider accounts and keys |
| Point-in-time recovery (PITR) | Restoring the database to a chosen moment |
| R2 | Cloudflare's file storage, used for the hourly backups |
| Recovery point (RPO) | The most data that can be lost |
| Recovery time (RTO) | The time to be working again |
| Row-level security | Database rules that decide which rows each person can reach |
| Service role key | The server key that bypasses row-level security; used only on the server |
| Soft delete | Marking a record deleted without removing it, so it can be brought back |
| Supabase | The hosted database, sign-in, storage and server-function platform ISMS runs on |
| Watchdog | The database job that checks scheduled jobs, payments, size and connections every 10 minutes |

# Appendix A: Source Documents

This guide consolidates the following documents, which remain in the repository for detail and history.

**Table A.1:** Source documents

| Document | Holds |
|---|---|
| `docs/operations/owner-setup.md` | Click-by-click owner settings |
| `docs/operations/accounts-and-ownership.md` | Provider accounts, identifiers and recovery routes |
| `docs/BACKUP_AND_RECOVERY.md` | Restore drill log (section 6) |
| `docs/HOSTING_CLOUDFLARE.md` | Hosting set-up, domains and rollback |
| `docs/security/threat-register.md` | Every finding and its status |
| `docs/TO_FINISH.md` | Steps still to do |
