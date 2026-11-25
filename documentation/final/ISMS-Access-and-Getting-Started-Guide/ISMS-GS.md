---
title: ISMS Access and Getting Started Guide
short_title: ISMS Access and Getting Started Guide (ISMS-GS)
software: KayKay's Integrated Shop Management System (ISMS)
description: How to get into ISMS from scratch: setting up the platform and its first platform admin, how a business signs up and sets itself up, how admins, staff, suppliers and customers get access, and which address to open.
doc_id: ISMS-GS
version: "1.0"
software_release: "1.0.1"
status: Draft for review
created: 24 November 2026
date: 24 November 2026
classification: Internal: platform operator and business administrators
organisation: KayKay's
author: Dennis Kimanthi Gitonga, Codensons
contact: kimanthidennis02@gmail.com; codensons@gmail.com
---

# Document Control

| Item | Value |
|---|---|
| Document title | ISMS Access and Getting Started Guide |
| Document identifier | ISMS-GS |
| Version | 1.0 |
| Status | Draft for review |
| Software release described | ISMS 1.0.1 with the multi-business (SaaS) changes |
| Created | 24 November 2026 |
| Last updated | 24 November 2026 |
| Document owner | Dennis Kimanthi Gitonga, Codensons |
| Contact | kimanthidennis02@gmail.com (developer); codensons@gmail.com (company) |
| Related documents | ISMS-UG System User Guide; ISMS-AG System Administration Guide; ISMS-TD Technical Documentation |
| Source file | `documentation/final/ISMS-Access-and-Getting-Started-Guide/ISMS-GS.md` |

# Version History

| Version | Date | Description |
|---|---|---|
| 1.0 | 24 November 2026 | First issue. Access from scratch: platform set-up, the first platform admin, business sign-up (trial, plan request, admin-created), business set-up, inviting admins and staff, join codes, suppliers, customers, support access and the web addresses. |

# Table of Contents

<!-- TOC -->

# List of Figures

<!-- LIST OF FIGURES -->

# List of Tables

<!-- LIST OF TABLES -->

# Part I: Overview

# Chapter 1: Introduction

## 1.1 Purpose

This guide explains, step by step and from an empty system, how every kind of person gets into ISMS: the platform operator who runs the system, a business that signs up to use it, the business's admins and staff, its suppliers and its customers. It also lists which address each of them opens.

It is a starting point. Day-to-day use of each screen is in the ISMS-UG System User Guide; administration duties (roles, settings, backups, incidents) are in the ISMS-AG System Administration Guide.

## 1.2 Intended audience

**Table 1.1:** Who should read which part

| Reader | Read |
|---|---|
| The platform operator (Codensons) | All of it, especially [Part II](#part-2) |
| A business owner signing up | [Part III](#part-3) |
| A business admin or manager who adds people | [Chapter 7](#ch-7) and [Chapter 8](#ch-8) |
| Staff, suppliers and customers | [Part IV](#part-4) |

## 1.3 Current state

> **Important:** the multi-business changes this guide describes (plans, the platform console, join codes, support access, one website address per shop) are built and committed, but on 24 November 2026 they were **not yet applied to the live system** (migrations `20261204001` to `20261204008`). Until they are, the live system follows the older rule: the person who created the first business is the only one who can create businesses, and staff join only by invitation. [Section 4.4](#s-4-4) lists the steps that make the new behaviour live.

## 1.4 Conventions

- **Bold** text names a screen, tab or button exactly as the app shows it, for example **Workers > Invite**.
- `Code` text is something to type or run exactly.
- A `>` between names means "then open", for example **Settings > Account**.

# Chapter 2: Who Is Who

## 2.1 The three levels

ISMS is one system that many businesses use at the same time. Each business sees only its own data. There are three levels of access.

**Table 2.1:** The three levels of access

| Level | Who | What they can do | How they get it |
|---|---|---|---|
| Platform admin | The operator of ISMS (Codensons) | Open the **Platform console**: approve sign-ups, set plans and prices, change a company's plan, extend trials, set platform settings, help a business when its owner allows it | Added by SQL in the database ([Chapter 4](#ch-4)) |
| Business Owner or Admin | The person who runs one business | Everything inside that business: branches, staff, roles, settings, selling, money | Owner: creates the business ([Chapter 6](#ch-6)). Admin: invited by the Owner ([Chapter 7](#ch-7)) |
| Staff, suppliers, customers | Managers, cashiers, riders; outside suppliers; shoppers on the website | Only what their role allows; suppliers see only their own orders; customers only their own account | Invitation or join code; customers make their own account on the website ([Part IV](#part-4)) |

> **Note:** the platform admin never sees inside a business on their own. The console shows counts only (branches, staff, number of sales, AI use), never sales amounts, customers or products. To help inside a business, its Owner must allow support access first ([Section 9.3](#s-9-3)).

## 2.2 Business roles

Inside a business every person has one role. The Owner or an Admin can change what each role may do on the **Roles** screen.

**Table 2.2:** Business roles

| Role | Purpose |
|---|---|
| Owner | Owns the business and its plan. Can do everything. There is one Owner, the person who created the business |
| Admin | Can do everything except change the owner. Invited by the Owner |
| Manager | Runs the shop day to day: sales, stock, customers, expenses, schedules, reports |
| Cashier | Sells at the till, opens and closes shifts, registers customers, takes payments |
| Rider | Accepts and completes deliveries |
| Supplier | An outside supplier. Sees only their own orders, requests and bills |
| Support | Temporary role for platform support while the Owner allows it ([Section 9.3](#s-9-3)). Cannot sell, refund, move money, or change staff or the plan |

Nobody can be invited as Owner, and invited people never see the option to create a business unless the platform allows them to start one ([Chapter 5](#ch-5)).

# Chapter 3: Where to Go

## 3.1 The addresses

ISMS has two web addresses, plus installers for phones and computers. Until the custom domains are switched on, the web addresses are the Cloudflare `workers.dev` ones.

**Table 3.1:** Web addresses

| What | Now (workers.dev) | Later (custom domain) | Who opens it |
|---|---|---|---|
| Staff app (and the platform console) | `https://kaykays-app.<subdomain>.workers.dev` | `https://app.<platform domain>` | Platform admin, owners, admins, staff, suppliers |
| Public plans page | the platform's own address | `https://<platform domain>` (also `/plans`, `/pricing`) | Businesses choosing a plan |
| A shop's website | `https://kaykays-website.<subdomain>.workers.dev` | `https://<website name>.<platform domain>`, or the shop's own domain | The shop's customers |

`<subdomain>` is the workers.dev name chosen in Cloudflare. To find the exact address, open **Cloudflare > Workers & Pages** and the Worker `kaykays-app` or `kaykays-website`, or read the output of the latest **Deploy web** run in GitHub Actions. How to switch on custom domains is in `docs/HOSTING_CLOUDFLARE.md`, section 4.

## 3.2 Devices

**Table 3.2:** Ways to open the staff app

| Device | How |
|---|---|
| Web browser | Open the staff app address from [Table 3.1](#t-3-1). Works on any computer or phone. No direct printing (print to PDF) |
| Windows or Linux computer | Install the desktop app (MSI or Linux package) from the latest release. It updates itself |
| Android phone or tablet | Install the Android app (APK) from the latest release. Supports Bluetooth receipt printers and ringing alerts |

All of them show the same screens and the same data. A person signs in with the same email and password on every device.

## 3.3 Running it on the developer's computer

For development only:

```bash
npm install
npm run dev            # staff app, http://localhost:5173
npm run website:dev    # customer website
```

> **Warning:** the developer `.env` points at the **live** database. Anything done on `localhost` reads and writes real data.

# Part II: The Platform Operator

# Chapter 4: Setting Up the Platform from Scratch

## 4.1 What must exist first

Before anyone can sign in, the platform needs:

1. a Supabase project (database, sign-in, storage, edge functions);
2. the database schema: `bash scripts/db-push.sh`, then `bash scripts/check-live-grants.sh` (it must list no problems);
3. the staff app and website deployed to Cloudflare (**GitHub > Actions > Deploy web (blue-green) > Run workflow**);
4. both web addresses added to **Supabase > Authentication > URL Configuration > Redirect URLs**, each with `/**` at the end, so email links and password resets come back to the app.

The full steps and secrets are in the ISMS-AG System Administration Guide and in `docs/HOSTING_CLOUDFLARE.md`.

## 4.2 Creating the first platform admin

The platform admin is an ordinary account that is also listed in the `platform_admins` table.

1. Open the staff app address ([Table 3.1](#t-3-1)).
2. Accept the Terms of Use.

![Figure 4.1: The Terms of Use shown the first time the app opens](images/screens/terms.jpg)

3. Choose to create an account, enter your name, email and a password, and confirm the email with the six-digit code sent to it.

![Figure 4.2: The sign-in screen](images/screens/sign-in.jpg)

4. In **Supabase > SQL Editor**, run:

```sql
insert into public.platform_admins (auth_user_id, name)
select id, 'Dennis Kimanthi Gitonga'
from auth.users
where email = 'your-email@example.com';
```

5. In the app, sign out and sign in again (or tap **Check again** on the start screen).

**Expected result:** a **Platform console** button appears on the start screen and in **My Profile**.

**Rules:**

- The email must be verified before the account can create a business or act as platform admin.
- Platform admins are added only by SQL. The app has no button to make someone a platform admin, on purpose.
- When the multi-business migration is applied to a database that already has businesses, the person who created the first business becomes the first platform admin automatically. Nothing needs to be run for them.

To add another platform admin later, repeat step 4 with their email. To remove one:

```sql
delete from public.platform_admins
where auth_user_id = (select id from auth.users where email = 'their-email@example.com');
```

## 4.3 First settings in the console

Open **Platform console** and set these once, before inviting any business.

**Table 4.1:** First platform settings

| Console section | Field | What to enter |
|---|---|---|
| Platform settings | Platform name | The name businesses see, for example the product name |
| Platform settings | Platform domain | The domain shops live under, for example `kaykays.com`. A shop's website becomes `<website name>.<platform domain>` |
| Platform settings | App address | The staff app address. The plans page sends people here to sign up |
| Platform settings | Free trial open, Trial days | Whether new businesses can start a free trial, and for how long (default 14 days) |
| Platform settings | Grace days, Read-only days | What happens when a company stops paying: full use for the grace days (default 7), then read-only (default 30), then suspended |
| Platform settings | VAT on our prices (%), How to pay us, Terms and conditions link, Contact us text | Shown on the plans page and in the in-app plan chooser |
| Plans and prices | Each plan | Monthly, yearly and one-payment prices, set-up fee, add-on prices. Empty = "ask us" |
| Costs paid to others | Each row | Estimates of what a business pays others (Safaricom, card company, SMS, domain). The plans page shows them as estimates |
| AI | Provider, Model, AI on for every company | The AI provider and model all companies use. Keys stay as server secrets |

The plans ready on a new system are shown in [Table 4.2](#t-4-2). Prices are changed in **Plans and prices**; the app reads them from the database.

**Table 4.2:** Plans on a new system

| Plan | Price (KSh) | Branches | Staff | Includes |
|---|---|---|---|---|
| Free trial | 0 | 1 | 2 | Everything, for the trial days |
| Starter | 3,000.00 a month or 30,000.00 a year | 1 | 3 | Selling, stock, customers, money and staff |
| Pro | 6,000.00 a month or 60,000.00 a year | 3 | 10 | Starter plus buying, deliveries, promotions, transfers, regular orders, production, quotes, messaging; add-ons allowed |
| Pro Plus | 12,000.00 a month or 120,000.00 a year | 10 | 30 | Everything: online store, books and accounting, AI, own domain |
| Perpetual licence | One payment (set in the console) | 10 | 30 | Everything; the business brings its own AI key and provider accounts |

## 4.4 Making the multi-business changes live

On 24 November 2026 these steps were still open. They run in this order:

1. Apply the database changes: `bash scripts/db-push.sh`, then `bash scripts/check-live-grants.sh`. No problems should be listed.
2. In the SQL editor run `select * from public.platform_admins;`. It should return one row: your account.
3. Deploy the website (`npm run website:deploy`) and release the app (`git push`).
4. Sign in to the app. **My Profile** should show **Platform console**.
5. Fill in the first settings ([Section 4.3](#s-4-3)).
6. Open the public plans page. It should list the plans with your prices.

# Chapter 5: Running the Platform Day to Day

## 5.1 The console sections

**Table 5.1:** Platform console sections

| Section | What it is for |
|---|---|
| Overview | Number of companies by plan and by state, trials ending, requests waiting, AI questions today |
| Requests | Sign-up requests and plan changes waiting for approval |
| Companies | Each company's plan, add-ons, own limits, trial end, paid-up-to date, history; extend a trial |
| Support | Branches whose Owner has allowed support right now ([Section 9.3](#s-9-3)) |
| Plans and prices | Plan and add-on prices |
| Costs paid to others | Estimates the plans page shows |
| Platform settings | Name, domain, app address, trial, grace, VAT, terms, payment instructions |
| AI | Provider and model for every company |
| Activity | What platform admins did (plan changes, approvals) |

To leave the console and return to a business, use **Leave the console**.

## 5.2 Approving a business that asked for a paid plan

1. Open **Platform console > Requests**.
2. Open the request. It shows the business name, the plan, monthly or yearly, and the payment reference the person entered.
3. Check the payment arrived (M-Pesa statement or bank).
4. Approve it, or turn it down with a note the person will see.

**Expected result:** the person's start screen shows the request as approved. They tap **Check again** and set up the business ([Section 6.4](#s-6-4)).

## 5.3 Creating a business for someone

A platform admin can create a business on any plan without payment, for example for a customer who paid in cash.

1. On the start screen tap **Start a business** (or create a new company from your own account).
2. Choose the plan. As platform admin you can pick any plan without a payment step.
3. Fill in the set-up form ([Section 6.4](#s-6-4)).
4. In the new business open **Workers > Invite** and invite the real owner's email as **Admin**.

> **Note:** the account that creates a business is its Owner. If the business should belong to the customer, they should create it themselves after you approve their request ([Section 5.2](#s-5-2)), rather than you creating it.

## 5.4 Changing a company's plan, trial or limits

Open **Platform console > Companies**, choose the company, then:

- **Plan**: choose a new plan and the paid-up-to date, then **Save plan**.
- **Extend trial**: enter the extra days.
- **Add-ons** (Pro only): switch on extra modules, then **Save add-ons**.
- **Own limits**: a different number of branches, staff, storage or AI questions for this company only. Empty means the plan's limit.

Every change is logged under **Activity** and in the company's history.

## 5.5 What happens when a company does not pay

**Table 5.2:** Company states

| State | When | What the business can do |
|---|---|---|
| Trial | From creation until the trial days end | Everything in the trial plan |
| Active | Paid up | Everything in its plan |
| Grace | Up to the grace days after the paid-up-to date | Everything, with a reminder to pay |
| Read-only | After grace, for the read-only days | Look at its data, no new sales; its website stays visible but takes no orders |
| Suspended | After read-only, or set by hand | Nothing until a platform admin reactivates it |

# Part III: A Business

# Chapter 6: Signing Up a Business

## 6.1 The three ways in

A business owner gets a business in one of three ways:

1. **Free trial**: when the platform has trials open, the owner starts one at once. One trial per account.
2. **Paid plan by request**: the owner chooses a plan, pays as the plan page says, and sends a request; a platform admin approves it ([Section 5.2](#s-5-2)).
3. **Created by the platform admin** ([Section 5.3](#s-5-3)).

## 6.2 Creating the account

1. Open the public plans page and tap **Choose** on a plan, or open the staff app address directly.
2. Accept the Terms of Use.
3. Create an account with your name, email and a password.
4. Enter the six-digit code sent to your email to confirm it.

**Expected result:** the **Welcome** screen opens with two choices: **Start a business** and **Join a business**.

## 6.3 Starting the business

1. Tap **Start a business**.
2. Choose a plan and monthly or yearly. If you came from the plans page, your choice is already selected.
3. Then either:
   - tap **Start free trial** (only shown while trials are open and you have not used one), or
   - follow the payment instructions shown, enter the payment reference and send the request. The screen shows "Request sent. We will let you know when it is approved."
4. After approval, open the app and tap **Check again**.

## 6.4 The set-up form

When the trial starts or the request is approved, the set-up form opens. Fill in:

**Table 6.1:** Business set-up form

| Field | Example |
|---|---|
| Business name | Kaykay's Groceries |
| Type of business | Grocery, butchery, bakery, pharmacy and so on |
| Country and currency | Kenya, KSh |
| Address | Street, town |
| Description | One line about the shop |
| Logo | Optional; can be added later in **Business Management** |

**Expected result:** the business is created with its first branch, you are its **Owner**, and the app opens on **Home**. The guided tour starts the first time.

## 6.5 Setting the business up

In this order:

1. **Business Management**: check the details and logo, and add more branches if your plan allows ([Figure 6.1](#f-6-1)).
2. **Settings**: receipts and printers, messages (SMS and WhatsApp), payment methods.
3. **Inventory**: add products and opening stock.
4. **Customers**: add regular customers, or let them be added at the till.
5. **Roles**: check what each role may do ([Chapter 8](#ch-8)).
6. **Workers**: invite your admins and staff ([Chapter 7](#ch-7)).
7. **Online Store** (plans with the online store): choose the website name ([Section 9.1](#s-9-1)).

![Figure 6.1: Business Management: branches, details and logo](images/screens/business-management.jpg)

> **Note:** adding a branch is refused when the plan is full. To get more, open **Business Management**, tap **Change plan or add a module** on the plan card and send the request; a platform admin approves it.

# Chapter 7: Adding Admins and Staff

## 7.1 Two ways to add a person

**Table 7.1:** Invitation or join code

| | Invitation | Join code |
|---|---|---|
| Best for | One person whose email you know | Several people, or someone in front of you |
| You choose the role | When you send it | When you let them in |
| Where | **Workers > Invite** | **Workers > Join code** |
| What they do | Sign in with that email; tap **Join** on the start screen, or enter the 6-character code from the email | Sign in with any email, tap **Join a business**, enter the 8-letter code (or scan its QR) |

Only people with the permission to invite staff (Owner and Admin by default) see these options.

## 7.2 Making someone an Admin

1. Open **Workers** and tap **Invite** ([Figure 7.1](#f-7-1)).
2. Enter their name and email.
3. Choose the role **Admin** and the branch.
4. Send the invitation.

![Figure 7.1: Workers: staff, invitations and the join code](images/screens/workers.jpg)

The person then:

1. opens the staff app and creates an account **with the same email** (or signs in if they have one);
2. confirms their email with the code sent to it;
3. taps **Join** next to the invitation on the start screen, or enters the 6-character invitation code.

**Expected result:** they open the business as Admin.

**Rules:**

- An invitation works only for the email it was sent to. To use another email, revoke it and send a new one.
- Revoking an invitation before it is accepted also removes the half-made account.
- Nobody can be invited as Owner.

## 7.3 Adding staff (Manager, Cashier, Rider)

Exactly as [Section 7.2](#s-7-2), choosing the role **Manager**, **Cashier** or **Rider**. Riders can also be given delivery areas in **Deliveries**.

## 7.4 Using the join code

1. Open **Workers > Join code**. It shows one code per branch, its expiry and a QR code. Tap to copy, or let the person scan it.
2. The person creates an account, confirms their email, taps **Join a business** and enters the code. The screen says "Request sent to <business>".
3. Their request appears under **Workers > Join code**. Choose a role and let them in, or turn them away.
4. The person taps **Check again** and the business opens.

**Rules:** the code alone does not let anyone in; someone who may invite staff must accept each request. Businesses are never listed or searchable, and a wrong code says nothing about any business. Change the code at any time if it was shared too widely.

## 7.5 Changing a role or removing someone

Open **Workers**, choose the person, and change the role or remove them. Removing a person ends their access at once on every device. Details: ISMS-AG, User and Access Administration.

# Chapter 8: Deciding What Each Role Can Do

1. Open **Roles** ([Figure 8.1](#f-8-1)).
2. Choose a role.
3. Switch each permission on or off. The change applies to everyone with that role straight away.

![Figure 8.1: Roles: what each role can see and do](images/screens/roles.jpg)

Every permission is also enforced by the database, so a screen that is hidden is also refused if someone tries to reach the data another way. The Owner and Admin roles always keep full access, and the Support role cannot be widened.

# Chapter 9: The Website, Suppliers and Support

## 9.1 Choosing the shop's website address

On plans with the online store:

1. Open **Online Store** ([Figure 9.1](#f-9-1)).
2. Enter the **Website name**, for example `mama-mboga`. The shop's website becomes `https://mama-mboga.<platform domain>`.
3. Save.

![Figure 9.1: Online Store: website name, delivery and website orders](images/screens/online-store.jpg)

**Rules:** a shop can change its website name twice a year; the old address forwards visitors for 90 days and no other shop can take it in that time. Platform words such as `www`, `admin`, `app` and `api` cannot be used. With the own-domain module (a Pro add-on, included in Pro Plus) a shop can add its own domain from the same screen.

## 9.2 Inviting a supplier

1. Open **Workers > Invite**.
2. Choose **Supplier** and the supplier from your list.
3. Send it to the supplier's email.

The supplier signs up with that email, confirms it, accepts the invitation, and then sees only their own purchase orders, stock requests and bills.

## 9.3 Letting platform support in

When the business needs help setting up, the Owner can let the platform admin in for a limited time.

1. Switch to the branch that needs help, open **Business Management** and find the **Platform support** card.
2. Choose **For how long** (2 hours, 24 hours or 3 days), optionally say what you need help with, and tap **Allow support**.
3. A banner shows on every screen while support is allowed.
4. Tap **End now** when done. It also ends by itself when the time is up.

While it is allowed, the platform admin opens the branch from **Platform console > Support** with the role **Support**. Support can set up products, opening stock, customers, suppliers and settings. Support can never sell, refund, record payments or expenses, change staff, the plan or the owner. Everything Support changes is in the **Audit Log** as "Platform support (name)".

# Part IV: Staff, Suppliers and Customers

# Chapter 10: Staff and Suppliers

## 10.1 First time

1. Open the staff app address, or install the desktop or Android app ([Table 3.2](#t-3-2)).
2. Accept the Terms of Use.
3. Create an account with the email your business used for the invitation, or any email if you have a join code.
4. Confirm the email with the six-digit code.
5. Tap **Join** next to the invitation, or **Join a business** and enter the join code.

**Expected result:** the business opens with the screens your role allows. The guided tour starts the first time.

## 10.2 Every day after that

Open the app and sign in with your email and password. On a shared device, set a PIN in **My Profile** so the app locks when you step away.

## 10.3 Forgotten password

On the sign-in screen tap **Forgot password**, enter your email, enter the six-digit code sent to it and choose a new password. After five wrong tries the code stops working; ask for a new one.

## 10.4 Signing out

**My Profile > Sign out** ([Figure 10.1](#f-10-1)). The session ends on the server at once, not just on the device.

![Figure 10.1: My Profile: your details, PIN, the guided tour and sign out](images/screens/my-profile.jpg)

# Chapter 11: Customers

Customers never use the staff app. They use the shop's website ([Table 3.1](#t-3-1)).

1. Open the shop's website address.
2. Tap **Sign in**, then **Create account**, or sign in with a code sent to their phone.
3. Fill in their profile: full name, phone and delivery location.

**Expected result:** they can order, pay, follow deliveries, see their points and leave reviews. A customer the shop already has (same phone or email) is linked by the shop's staff from **Customers**.

# Appendix A: Quick Reference

**Table A.1:** How each person gets in

| Person | Where | First time |
|---|---|---|
| Platform admin | Staff app | Create account, verify email, then the SQL in [Section 4.2](#s-4-2) |
| Business Owner | Plans page, then staff app | Create account, verify, **Start a business**, trial or approved request, set-up form |
| Business Admin | Staff app | Invitation as Admin from the Owner; sign up with that email; **Join** |
| Manager, Cashier, Rider | Staff app | Invitation, or join code and approval |
| Supplier | Staff app | Supplier invitation from **Workers** |
| Customer | The shop's website | **Create account** on the website |

**Table A.2:** Useful SQL for the platform operator

| Purpose | SQL |
|---|---|
| List platform admins | `select pa.name, u.email from public.platform_admins pa join auth.users u on u.id = pa.auth_user_id;` |
| Find an account by email | `select id, email, email_confirmed_at from auth.users where email = '...';` |
| Who owns which business | `select b.name, u.name, u.email from public.business_memberships bm join public.businesses b on b.id = bm.business_id join public.users u on u.id = bm.user_id where bm.role = 'Owner';` |

# Appendix B: Troubleshooting

**Table B.1:** Common access problems

| Problem | Cause | Fix |
|---|---|---|
| No **Platform console** button | The account is not in `platform_admins`, or the multi-business migration is not live | Run the SQL in [Section 4.2](#s-4-2); sign out and in again; check [Section 4.4](#s-4-4) |
| "Please verify your email before creating a business" | The email code was never entered | Sign in and enter the code, or ask for a new one |
| **Start free trial** missing | Trials are closed, or this account already used its trial | Choose a plan and send a request, or a platform admin extends or creates one |
| Invitation does not appear | Signed up with a different email | Sign up with the invited email, or ask for a new invitation |
| Join code accepted but the business does not open | Waiting for someone to let you in | Ask the business to accept the request under **Workers > Join code**, then tap **Check again** |
| Cannot add a branch or staff | The plan's limit is reached | **Business Management > Change plan or add a module**; a platform admin approves it |
| Email link or password reset opens the wrong page | The address is missing from Supabase redirect URLs | Add it with `/**` in **Supabase > Authentication > URL Configuration** |
| The shop's website says nothing about the shop | No website name set, plan without online store, or company suspended | Set the name in **Online Store**; check the plan in the console |
