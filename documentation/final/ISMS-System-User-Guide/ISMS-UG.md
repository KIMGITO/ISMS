---
title: ISMS System User Guide
short_title: ISMS System User Guide (ISMS-UG)
software: KayKay's Integrated Shop Management System (ISMS)
description: How authorised staff use the ISMS staff app on a phone, tablet or computer: selling, customers, money, stock, buying, deliveries and reports.
doc_id: ISMS-UG
version: "1.1"
software_release: "1.0.1"
status: Draft for review
created: 24 November 2026
date: 24 November 2026
classification: Internal
organisation: KayKay's
author: Dennis Kimanthi Gitonga, Codensons
contact: kimanthidennis02@gmail.com; codensons@gmail.com
---

# Document Control

| Item | Value |
|---|---|
| Document title | ISMS System User Guide |
| Document identifier | ISMS-UG |
| Version | 1.1 |
| Status | Draft for review |
| Software release described | ISMS staff app 1.0.1 |
| Created | 24 November 2026 |
| Last updated | 24 November 2026 |
| Document owner | Dennis Kimanthi Gitonga, Codensons |
| Contact | kimanthidennis02@gmail.com (developer); codensons@gmail.com (company) |
| Related documents | ISMS-TD Technical Documentation; ISMS-AG System Administration Guide |
| Source file | `documentation/final/ISMS-System-User-Guide/ISMS-UG.md` |

# Version History

| Version | Date | Description |
|---|---|---|
| 1.1 | 24 November 2026 | Document owner named (Dennis Kimanthi Gitonga, Codensons). Updated for the owner's decisions: the audit trail, sales, stock history and points used can no longer be deleted; one receipt number format (`TXN-`) everywhere; points settings only on Promotions & Points; Report a problem needs the `support.report` permission. |
| 1.0 | 24 November 2026 | First issue of the restructured guide. Replaces `docs/USER_GUIDE.md` (app 1.0.0). Screen names follow the screen registry; administration chapters moved to ISMS-AG; screenshots re-captured from release 1.0.1. |

# Table of Contents

<!-- TOC -->

# List of Figures

<!-- LIST OF FIGURES -->

# List of Tables

<!-- LIST OF TABLES -->

# Part I: Introduction

# Chapter 1: Introduction

## 1.1 Purpose

This guide explains how authorised staff use the ISMS staff app to run the shop day to day. It gives, for every screen a staff member can reach, what the screen is for, who may use it, the steps for each task, the rules the app applies, and what to do when something goes wrong.

## 1.2 Scope

The guide covers the staff app on Android phones and tablets, Windows and Linux computers, and in a web browser, at release 1.0.1. It covers the supplier view of the same app.

It does not cover:

- configuring the business, staff accounts, roles, integrations, backups and security, which are in the **ISMS System Administration Guide (ISMS-AG)**;
- how the system is built, deployed and maintained, which is in the **ISMS Technical Documentation (ISMS-TD)**;
- the customer website and dial-code ordering, except where staff handle their orders ([Chapter 22](#ch-22)).

## 1.3 Intended audience

**Table 1.1:** Readers and the chapters most relevant to them

| Reader | Typical tasks | Most relevant chapters |
|---|---|---|
| Cashier | Shifts, selling, receipts, customers, payment prompts, petty cash | [Chapter 7](#ch-7) to [Chapter 12](#ch-12), [Chapter 16](#ch-16), [Chapter 28](#ch-28) |
| Manager | Everything a cashier does, plus stock, buying, deliveries, finance and reports | All of Part III |
| Owner or Admin | Everything, plus administration (see ISMS-AG) | All chapters |
| Rider | Accepting and completing deliveries | [Chapter 7](#ch-7), [Chapter 21](#ch-21) |
| Supplier | Answering orders and stock requests | [Section 20.6](#s-20-6) |

## 1.4 How to read this guide

Each chapter in Part III describes one screen or a group of closely related screens, in the same order: overview, access requirements, available operations, step-by-step procedures, business rules, expected results, troubleshooting and related features. Sections that do not apply to a screen are left out.

You only see the screens and buttons your role allows. If a procedure mentions a button you cannot see, your role does not include it; ask the Admin.

**Table 1.2:** Conventions used in this guide

| Convention | Meaning | Example |
|---|---|---|
| **Bold** | A screen, tab, button or field as it appears in the app | **Payments & Expenses > M-Pesa** |
| `>` | A path through screens and tabs | **Settings > Receipts & printing** |
| Key names | A keyboard key or combination | **Ctrl+K**, **Alt+2**, **G** then **H** |
| `TXN-…` | A record number as the app shows it | `TXN-1A2B3C4D` |
| KSh | Kenyan shillings, always with two decimals | KSh 1,250.50 |

> **Note:** The screenshots were taken from a test business with sample data. Names, figures and branch names in them are examples only.

# Chapter 2: System Overview

## 2.1 What ISMS does

ISMS (Integrated Shop Management System) is the business system used at KayKay's. One shared database serves every device, so a sale made on one till changes the stock, the customer's balance and the books on every other device straight away.

**Table 2.1:** What the staff app covers

| Area | What staff can do |
|---|---|
| Selling | Sell at the counter (Quick Sale and POS), keep a sales log with receipts, handle website orders, send payment prompts |
| Customers | Keep customer records, debts and wallets; run points, promotion codes and referrals; supply customers on fixed days; read feedback; message customers |
| Money | Record payments, expenses and petty cash; see the books, profit, balances and VAT |
| Stock | Keep products and stock levels; see every stock change; move stock between branches; produce goods from recipes |
| Buying and deliveries | Order from suppliers, receive goods, pay bills; deliver to customers through riders |
| Reports | See the business at a glance (Home) and a per-product stock report |
| Team | Clock in and out, see hours worked, set reminders |

## 2.2 Devices

The same app runs on every device, with the same screens and data.

**Table 2.2:** Supported devices

| Device | How it is installed | Notes |
|---|---|---|
| Android phone or tablet | Android installer (APK) from the shop | Bluetooth and Wi-Fi receipt printers; camera for product photos; ringing alerts |
| Windows or Linux computer | Desktop installer | Wi-Fi or network printers; keyboard shortcuts |
| Web browser | The shop's web address | No direct printing (use PDF) |

## 2.3 Roles

Every person has one role per business. The role decides which screens and buttons appear. An Owner or Admin can change what each role may do (see ISMS-AG, Role and Permission Management).

**Table 2.3:** Roles

| Role | Purpose |
|---|---|
| Owner | Owns the business. Can do everything |
| Admin | Can do everything |
| Manager | Runs the shop day to day: sales, stock, customers, expenses, staff schedules, reports |
| Cashier | Sells at the till, opens and closes shifts, registers customers, takes payments |
| Rider | Accepts and completes deliveries; adds and prices delivery areas |
| Supplier | An outside supplier. Sees only their own orders, requests and bills |

[Appendix B](#app-b) lists which screens each role can open by default.

# Chapter 3: Terminology and Definitions

**Table 3.1:** Terms used throughout this guide

| Term | Meaning |
|---|---|
| Branch | One shop location of the business. Each branch has its own stock, sales and cash |
| Walk-in sale | A sale with no registered customer |
| Credit sale | Goods taken now and paid for later; the amount becomes the customer's debt |
| Wallet | Money a customer has paid in advance, spent on later purchases |
| Points | Loyalty points earned by registered customers; a discount, never money |
| Payment prompt | A request sent to the customer's phone asking them to enter their M-Pesa or Airtel Money PIN |
| Till | The shop's M-Pesa Buy Goods number. Payments sent to it carry no account number |
| Credit note | The record of a refund (`CN-…`) |
| Quote | A priced list of goods given to a customer before they buy (`QT-…`) |
| Invoice | A bill for what a customer owes on credit (`INV-…`); not a receipt |
| The books | The business's accounts. ISMS writes them automatically from every money and stock movement |
| Shift | The period between a staff member's clock-in and clock-out |

The full glossary is in [Chapter 32](#ch-32).

# Part II: Getting Started

# Chapter 4: Accessing the System

## 4.1 Before you start

You need:

1. an invitation from the Admin, sent to your email address ([Section 5.1](#s-5-1));
2. the app installed on your device, or the shop's web address;
3. an internet connection for the first sign-in.

## 4.2 Opening the app

Open the app from the device's app list or desktop, or open the web address in a browser. The first screen is the sign-in screen ([Figure 4.1](#f-4-1)).

![Figure 4.1: The sign-in screen](images/screens/sign-in.jpg)

## 4.3 Accepting the terms

The first time you open the app it shows the Terms of Use ([Figure 4.2](#f-4-2)). Read them and accept to continue. You can read them again at any time in **About this app > Terms of Use**.

![Figure 4.2: The Terms of Use shown the first time the app opens](images/screens/terms.jpg)

## 4.4 Signing in

1. Enter your email address and password.
2. Tap **Sign in**.

**Expected result:** the app opens on your first screen. The first time, the guided tour starts ([Section 5.6](#s-5-6)).

If sign-in fails, see [Section 31.1](#s-31-1).

# Chapter 5: User Account Access

## 5.1 Joining the business

**Purpose:** to get access to the business after the Admin invites you.

**Prerequisite:** the Admin has invited you from **Workers** using your email address.

1. You receive a code by email.
2. Open the app and sign up or sign in **with the same email address** the invitation was sent to.
3. Enter the code.
4. If you are new, confirm your email with the code sent to it.

**Expected result:** once your email is confirmed, you are a member of the business with the role the Admin chose.

**Rules:**

- An invitation works only for the email it was sent to. To use a different email, ask the Admin to send a new invitation.
- If the invitation is revoked before you finish, the half-made account is removed as well.
- Only the person who set up the business can create a new business. Invited staff never see that option.

## 5.2 Resetting a forgotten password

1. On the sign-in screen, tap **Forgot password**.
2. Enter your login email. A six-digit code is sent to it.
3. Enter the code and choose a new password.

**Rules:** the code is sent only to the email you sign in with. After five wrong tries the code stops working and you must ask for a new one.

## 5.3 Your profile

![Figure 5.1: My Profile: your details, PIN, the guided tour and sign out](images/screens/my-profile.jpg)

**My Profile** ([Figure 5.1](#f-5-1)) holds your name, email, phone number and PIN, the button to take the tour again, and **Sign out**. Every role can open it.

## 5.4 Signing out

Tap **Sign out** in **My Profile** (owners, admins and managers also have it in **Settings > Account**).

**Expected result:** your session ends at once, on the server as well as on the device. The app on that device cannot reach the business's data again until someone signs in.

## 5.5 Locking a shared device

If several people use one device, set a personal PIN in **My Profile**. The app then asks for the PIN to unlock when you come back to it.

## 5.6 The guided tour

![Figure 5.2: The guided tour starts by itself the first time you sign in](images/screens/guided-tour.jpg)

The first time you sign in, a short tour points out the screens you can use ([Figure 5.2](#f-5-2)). Tap **Skip the tour** to close it. To watch it again, open **My Profile** and tap **Take the tour again** (or **Settings > Help & tour**).

# Chapter 6: System Navigation and General Usage

## 6.1 Screen groups

Screens are grouped the same way on every device.

**Table 6.1:** Screen groups

| Group | Screens |
|---|---|
| Selling | Quick Sale, POS, Sales Log, Online Store, Payment Prompts |
| Customers | Customers, Promotions & Points, Regular Orders, Feedback |
| Stock | Inventory, Stock History, Stock Transfers, Production & BOM |
| Buying & deliveries | Buying, Deliveries |
| Money | Payments & Expenses, Petty Cash, Finance & Accounting |
| Reports | Home, Stock Report |
| Team | Shift, Workers |
| Admin | Roles, Audit Log, Business Management, Settings |
| You & the app | Assistant, Notifications, My Profile, About this app |

## 6.2 On a computer

All screens you can use are in the sidebar on the left ([Figure 6.1](#f-6-1)). Each entry shows the screen name and a short description.

![Figure 6.1: On a computer every screen is in the sidebar on the left](images/screens/home-dashboard.jpg)

## 6.3 On a phone

The bar at the bottom holds your most-used screens; **More** opens the full list ([Figure 6.2](#f-6-2)).

- Cashiers have **Quick Sale** in the middle of the bar.
- Owners, admins and managers have **Home**, **Sales Log**, **Payments & Expenses** and **Inventory** on the bar.
- **Settings** and **About this app** are always under **More**.
- **Double-tap** anywhere to hide the bar, and again to bring it back.

![Figure 6.2: On a phone, More opens the full list of screens](images/screens/phone-more.jpg)

## 6.4 Switching branch

If you work at more than one branch, tap **Switch ▾** under the business name at the top and choose the branch ([Figure 6.3](#f-6-3)).

**Expected result:** everything changes to that branch: the screens, the cart and the figures.

![Figure 6.3: Switch ▾ under the business name changes branch](images/screens/branch-switch.jpg)

## 6.5 Messages from the app

**Table 6.2:** What the app's messages mean

| What you see | What it means |
|---|---|
| A small pill that fades away | Your action worked |
| A red message | Something went wrong. Read it: it says what to do |
| A **rose-red** message with a cloud | Saved on this device; it will be sent when the internet is back. This is not an error |
| A thin strip under the header | You are offline. It shows how many sales are waiting to be sent |
| A phone that rings and doesn't stop | A ringing alert (a reminder, a stock request, a regular order not done). Open it to stop it ([Section 26.3](#s-26-3)) |

## 6.6 Numbers

- Money always has two decimals: **KSh 1,250.50**, **KSh 100.00**.
- Quantities have at most one decimal: **2**, **1.5**.
- Number boxes remove leading zeros by themselves.
- Dates and periods are in Kenya time.

## 6.7 Searching and shortcuts

The search box at the top (or **Ctrl+K**) finds screens, settings, products, customers and any record by its number. On a computer, press **?** on any screen to see its keyboard shortcuts. Both are described in [Chapter 27](#ch-27).

# Part III: Application Modules

# Chapter 7: Shifts

## 7.1 Overview

![Figure 7.1: Shift: clock in, the team calendar, reminders and hours worked](images/screens/shift.jpg)

The **Shift** screen ([Figure 7.1](#f-7-1)) is where you clock in and out. Every sale you make while clocked in is added to your shift, and the end-of-shift report compares the cash you count with the cash expected.

## 7.2 Access requirements

Permission `dashboard.view`. By default: every role.

## 7.3 Available operations

- Clock in and clock out.
- See the team calendar and schedules.
- See hours worked by day, week and month.
- Set reminders that ring at a chosen time.

## 7.4 Procedures

### 7.4.1 Clocking in

1. Open **Shift** and tap **Clock in** (or press **C**).
2. Enter the cash in the drawer at the start.

**Expected result:** your shift starts. Your sales from now on count towards it.

### 7.4.2 Clocking out

1. Open **Shift** and tap **Clock out**.
2. Count the cash in the drawer and enter it.
3. Check the end-of-shift report: every payment type, the cash expected (after your petty cash and expenses), the cash you counted and any difference.
4. If the cash does not match, add a note.

**Expected result:** the shift closes and the report goes to the Owner.

### 7.4.3 Setting a reminder

1. On the **Shift** screen, press **N** (or use the reminder button).
2. Choose the time and write the reminder.

**Expected result:** at that time the device rings, even if the app is closed, until you accept the alert.

## 7.5 Business rules

- Your shift is the same on every device. Clocking out on the phone also clocks you out on the computer.
- **"Still working?"** After 15 hours on shift the app asks whether you are still working. Tap **Yes** within 3 minutes, or you are clocked out automatically at the time the question appeared. If you keep working, it asks again every 2 hours.
- People who manage staff see everyone's hours; others see their own.

## 7.6 Troubleshooting

**Table 7.1:** Shift problems

| Problem | Cause and action |
|---|---|
| I was clocked out on my own | You did not answer "Still working?" within 3 minutes. Clock in again |
| My phone keeps ringing | A reminder or alert is waiting. Open it to stop it |

## 7.7 Related features

Petty cash taken during a shift reduces the cash expected ([Section 16.7](#s-16-7)).

# Chapter 8: Quick Sale

## 8.1 Overview

**Quick Sale** is the fastest way to sell at a busy counter: find the product, set the amount, choose how the customer paid ([Figure 8.1](#f-8-1), [Figure 8.2](#f-8-2)).

![Figure 8.1: Quick Sale on a computer: tap products, then the payment button](images/screens/quick-sale-cart.jpg)

![Figure 8.2: Quick Sale on a phone](images/screens/phone-quick-sale.jpg)

## 8.2 Access requirements

Permission `pos.create_sale`. By default: Owner, Admin, Manager, Cashier.

## 8.3 Available operations

- Sell products for cash, M-Pesa, card or Airtel Money.
- Print or send the receipt.
- Add a registered customer to the sale afterwards, so they get their points.

## 8.4 Procedures

### 8.4.1 Making a sale

1. Open **Quick Sale**.
2. Scan the barcode, or type the product's name or code and press **Enter**. An exact code match is added first.
3. To change the amount, type it, for example **2**, or **0.5** for half a kilo. **−** and **+** change it by one.
4. Choose how the customer paid: **Cash** (Alt+1), **M-Pesa** (Alt+2), **Card** (Alt+4) or **Airtel Money** (Alt+6).

**Expected result:** the sale is saved and a green banner appears with **Receipt** and **Add customer**.

### 8.4.2 After the sale

- **Receipt** (Alt+R): print or send the receipt ([Section 10.2](#s-10-2)).
- **Add customer** (Alt+C): put the sale on a registered customer so they get their points ([Section 12.4.4](#s-12-4-4)).

### 8.4.3 Clearing

Press **Esc** to clear the search, and **Esc** again to clear the whole sale.

## 8.5 Business rules

- You cannot sell more than the branch has in stock.
- Only the payment methods switched on for the business appear.
- Quick Sale has no customer, discount, delivery or credit. Use the POS for those ([Chapter 9](#ch-9)).
- Cash, card and M-Pesa sales with a typed code can be made offline ([Chapter 28](#ch-28)).

## 8.6 Troubleshooting

**Table 8.1:** Quick Sale problems

| Problem | Cause and action |
|---|---|
| A payment method is missing | It is switched off for the business (see ISMS-AG, Payment methods) |
| The amount won't go higher | Not enough stock in this branch |
| A shortcut does nothing | Click outside any text box, then press **?** to see your keys |

# Chapter 9: Point of Sale (POS)

## 9.1 Overview

![Figure 9.1: The POS with two items in the cart: customer, payment, note, delivery and discount](images/screens/pos-cart.jpg)

Use the **POS** ([Figure 9.1](#f-9-1)) when a sale needs more than Quick Sale: a registered customer, discounts, promotion codes, delivery, credit, split payments or a quote.

## 9.2 Access requirements

Permission `pos.create_sale`. By default: Owner, Admin, Manager, Cashier. Discounts need `pos.discount`; changing a price needs `pos.override_price`; credit needs `customers.debts`.

## 9.3 Available operations

- Sell to a registered customer, with points.
- Apply a discount, a price change, or a promotion or referral code.
- Deliver the sale through a rider.
- Take payment in any of seven ways, or split between two.
- Send a payment prompt to the customer's phone.
- Save the cart as a quote.

## 9.4 Procedures

### 9.4.1 Making a sale

1. Open **POS** and add products by tapping them or searching (**/** or **F2**).
2. **Choose a customer** (Alt+C) if they are registered. Their delivery location fills in.
3. Add a **discount** or change a price, if your role allows it.
4. If the customer has a **promotion or referral code**, type it in the code box. The discount is checked with the shop before it is applied.
5. For **delivery** (Alt+D), see [Section 9.4.2](#s-9-4-2).
6. Add a **Note** (Alt+N) if needed.
7. Choose the payment ([Table 9.2](#t-9-2)). You can split a payment between two methods.
8. If the customer has points, you can use them as a discount. The cart shows "Paid with N points" before you finish.
9. Tap **Complete** (Ctrl+Enter or F9).

**Expected result:** the sale is saved; stock, the customer's balance and points, your shift and the books are updated.

### 9.4.2 Adding delivery

1. Turn on delivery (Alt+D).
2. Choose the delivery area.
3. Choose the rider from the list, or type their name.
4. Choose how the delivery is paid ([Table 9.1](#t-9-1)).

**Table 9.1:** Delivery payment choices

| Choice | Who pays | The rider |
|---|---|---|
| **On our bill** | The fee is added to the bill (or to their account, if on credit) | Collects nothing; the shop pays them |
| **Pay the rider** | The customer pays the rider in cash | Keeps the fee |
| **Free** | Nobody | The shop pays them |

What the rider earns is recorded as owed to them ([Section 21.7](#s-21-7)).

### 9.4.3 Sending a payment prompt

Choose **M-Pesa** or **Airtel Money**, then **Send prompt**. The customer gets a request on their phone and enters their PIN. The sale is recorded when they pay.

### 9.4.4 Saving a quote

Press **Quote** (Alt+Q) to save the cart as a numbered quote (`QT-…`) and share it as a PDF or on WhatsApp. Quotes are listed in **Sales Log > Quotes**; tap **Sell in POS** to load one back at the quoted prices.

## 9.5 Payment methods

**Table 9.2:** Payment methods at the POS

| Method | Key | Effect |
|---|---|---|
| M-Pesa | Alt+2 | Picked first by default |
| Cash | Alt+1 | — |
| Credit | Alt+3 | Becomes the customer's debt ([Chapter 11](#ch-11)). Picked automatically for customers on weekly or monthly terms |
| Card | Alt+4 | — |
| Bank | Alt+5 | — |
| Airtel Money | Alt+6 | — |
| Mobile Wallet | — | Taken from the customer's prepaid wallet |

## 9.6 Business rules

- Only registered customers earn points.
- Promotion and referral codes work only online.
- **VAT:** the VAT line shows the rate actually charged. VAT can be turned on only once the business is connected to KRA eTIMS.
- A customer who holds wallet money pays from the wallet first.
- On a phone, **F4** or the cart button shows and hides the cart.

## 9.7 Troubleshooting

**Table 9.3:** POS problems

| Problem | Cause and action |
|---|---|
| A code says it needs the internet | Promotion and referral codes only work online |
| Credit is not offered | No customer chosen, or your role cannot sell on credit |
| The prompt didn't arrive | Check the number and that the line has M-Pesa or Airtel Money, then send again |
| I can't turn on VAT | The business must be connected to KRA eTIMS first |

# Chapter 10: Sales Log, Receipts and Refunds

## 10.1 Overview

![Figure 10.1: Sales Log: every sale with its receipt number](images/screens/sales-log.jpg)

**Sales Log** ([Figure 10.1](#f-10-1)) lists every sale, grouped by day, newest first, each with its sale number (`TXN-…`). The printed receipt, search, the books and every log show the same number, for example `TXN-D6EB287C`. Receipts printed before release 1.1 may show it as `RCT-2026-D6EB287C`; search finds both. From here you open receipts, refund, change a sale and see quotes.

Access: permission `orders.view`. By default: Owner, Admin, Manager, Cashier. Cashiers see their own sales and their customers' sales.

## 10.2 Sending a receipt

![Figure 10.2: A sale opened from the Sales Log, with its receipt actions](images/screens/sale-detail.jpg)

Open the sale ([Figure 10.2](#f-10-2)), or tap **Receipt** after a sale. The customer's phone and email are filled in if they are on file.

**Table 10.1:** Receipt actions

| Button | Key | What it does |
|---|---|---|
| Print | P | Choose a printer and print |
| WhatsApp | W | Sends the receipt as a WhatsApp message |
| Email | E | Emails the receipt (as a PDF on Android) |
| PDF | D | Saves or shares a PDF |
| Copy | C | Copies the receipt text |
| Barcode | B | Shows or hides the barcode |
| Add customer | A | Puts a walk-in sale on a customer |

The receipt shows points used and earned, the customer's new balance, any wallet money used, and how delivery was paid ("Delivery: Free", "Delivery: pay the rider"). A credit sale is marked **not paid**. If the business is connected to KRA eTIMS, signed sales show a KRA section and QR code; a receipt never shows one unless KRA signed that sale.

## 10.3 Refunding a sale

**Purpose:** to give a customer their money back. A sale is never deleted.

1. In **Sales Log**, swipe or hold the sale (or open it).
2. Tap **Refund**.
3. Choose how the customer gets the money: cash or M-Pesa, into their wallet, or off their debt.

**Expected result:** a numbered credit note (`CN-…`) is made, the stock goes back, and the money, the customer's balance and the books are reversed.

**Rule:** cashiers can refund their own sales on the same day. Older sales need a manager.

## 10.4 Changing a sale

1. Open the sale and tap **Edit**.
2. The old sale is refunded in full and its items are loaded into the POS cart at the same prices, for the same customer.
3. Change what is needed and complete it as a new sale.

**Expected result:** figures count only the new sale. Every change is kept; managers see **Edited N×** on the sale and can open the list of changes.

## 10.5 Printing receipts

![Figure 10.3: Settings > Receipts & printing: printers](images/screens/settings-printers.jpg)

Printers are set up once per device in **Settings > Receipts & printing** ([Figure 10.3](#f-10-3)).

**Bluetooth printer (Android):**

1. Turn the printer on.
2. Pair it once in the phone's **Settings > Bluetooth**.
3. In the app, open **Settings > Receipts & printing**, find the printer and tap **Test print**.

**Wi-Fi or network printer (Android, Windows, Linux):** connect the printer to the same network, find it in **Settings > Receipts & printing**, and test it.

**Rules:** every print asks you to confirm the printer. In a web browser the app cannot print directly; use **PDF**.

## 10.6 Troubleshooting

**Table 10.2:** Receipt and sales problems

| Problem | Cause and action |
|---|---|
| The printer isn't listed | On Android, pair it in the phone's Bluetooth settings first; check it is on |
| **Add customer** isn't on the receipt | The sale already has a customer, wasn't paid, or is too old (24 hours for cashiers, 30 days for managers) |
| A sale shows **Waiting to sync** | It was made offline and sends when the internet is back. Do not ring it up again |

# Chapter 11: Credit Sales and Invoices

## 11.1 Overview

A credit sale means the customer takes the goods now and pays later. An invoice is a bill for what a customer owes on credit; it is different from a receipt.

## 11.2 Access requirements

Credit sales: `customers.debts` with `pos.create_sale` (Owner, Admin, Manager, Cashier by default). Invoices: `invoices.manage` (Owner, Admin, Manager by default).

## 11.3 Selling on credit

1. In the POS, choose the customer. Credit needs a registered customer.
2. Choose **Credit** (Alt+3). Customers on weekly or monthly terms get it picked for them.
3. Complete the sale.

**Business rules:**

- If the customer has money in their wallet, the wallet pays first; only the rest becomes debt. A customer never holds wallet money and debt at the same time: a top-up pays their debt first.
- The amount owed is **not** a payment. The notification says **Sold on credit**, the receipt is marked not paid, and the customer earns **no points** now. They earn points as they pay the debt ([Table 13.1](#t-13-1)).
- When the customer pays, record it on their page ([Section 16.4.2](#s-16-4-2)). Their oldest debts are cleared first.
- Credit sales work only online.

## 11.4 Making an invoice

1. Open **Customers**, choose the customer and open **Invoices**.
2. Choose what to bill: **everything owed**, **this week**, **this month** or **your own dates**. You can include older unpaid debt.
3. Check the preview. Each credit sale is listed at the price it was sold at. You can edit the descriptions and texts.
4. Tap **Issue**.
5. Share it as a PDF, by WhatsApp or by email.

**Expected result:** the invoice gets the next number (`INV-…`), is saved on the customer's page, and can be sent again later.

## 11.5 Invoice settings

Owners and managers set the invoice texts, number prefix, due days, payment details, logo size and stamp in **Settings > Invoices** (see ISMS-AG).

## 11.6 Troubleshooting

**Table 11.1:** Credit and invoice problems

| Problem | Cause and action |
|---|---|
| Credit is greyed out | You are offline, or no customer is chosen |
| "Not set up on the server" when issuing | Report it to the Admin; a server update is missing |

# Chapter 12: Customers

## 12.1 Overview

![Figure 12.1: Customers: the list of customers with their balances](images/screens/customers.jpg)

**Customers** ([Figure 12.1](#f-12-1)) holds every registered customer, with their debt, wallet, points, invoices and history.

## 12.2 Access requirements

Permission `customers.view`. By default: Owner, Admin, Manager, Cashier. Adding needs `customers.create`; merging duplicates needs `customers.manage` (Owner, Admin, Manager).

## 12.3 Available operations

- Add and edit customers.
- Open a customer's page: money, invoices, history, ledger, messages.
- Add a customer to a walk-in sale afterwards.
- Find and merge duplicate customers.
- Open the points report (key **P**).

## 12.4 Procedures

### 12.4.1 Adding a customer

![Figure 12.2: The New customer form](images/screens/customer-add.jpg)

1. Open **Customers** and press **N** (or tap **Add**). The **New customer** form opens ([Figure 12.2](#f-12-2)).
2. Enter the **full name** (one box).
3. Enter the **phone number**: any network, Kenyan or international with "+".
4. Enter the email (optional).
5. Enter the **delivery location**: area, estate or street, building and house number, a nearby landmark, and delivery instructions.
6. Optionally set the customer type, payment terms and notes.
7. Tap **Add customer**.

**Rules:** names and phone numbers are tidied automatically. Weekly or monthly payment terms mean credit is picked at the till. The website asks customers for the same details, so both records look the same.

### 12.4.2 Opening a customer's page

![Figure 12.3: A customer's page, open on the Money tab](images/screens/customer-page.jpg)

Tap a customer to open their page ([Figure 12.3](#f-12-3)).

**Table 12.1:** Tabs on a customer's page

| Tab | Use it to |
|---|---|
| Profile | Edit their details and the messages they agree to receive |
| Money | Take a payment, top up the wallet, pay debt with money or points, send a payment prompt |
| Invoices | Make an invoice for what they owe ([Section 11.4](#s-11-4)) |
| History | See what they bought and paid |
| Ledger | See every change to their balances |
| Message | Send a WhatsApp, SMS or email |

The page also shows their regular order, if any ([Chapter 14](#ch-14)), and their referral code.

### 12.4.3 Taking money on a customer's page

See [Section 16.4.2](#s-16-4-2).

### 12.4.4 Giving points for a walk-in sale

If you made a Quick Sale and the customer then says they are a member:

1. Tap **Add customer** on the sale banner (Alt+C), or open the sale's receipt and tap **Add customer** (A).
2. Choose the customer.

**Expected result:** they get the same points as if you had chosen them at the till.

**Rules:**

- Cashiers can do this for their own sales from the last 24 hours.
- Managers can do it for any sale from the last 30 days.
- Only paid sales qualify. Once a sale has a customer, it cannot move to another customer.

### 12.4.5 Merging the same customer twice

Someone added at the shop who also signed up on the website appears twice. They are never joined automatically.

1. In **Customers**, open **Duplicates**.
2. Check the details of each pair.
3. Choose which name and phone number to keep.
4. Merge.

**Expected result:** debts, wallets, points and history are added together on one record.

> **Warning:** A merge cannot be undone.

## 12.5 Troubleshooting

**Table 12.2:** Customer problems

| Problem | Cause and action |
|---|---|
| A customer's balance change is refused | The record was merged on another device. Refresh the app (F5) |
| Two records for one person | Merge them ([Section 12.4.5](#s-12-4-5)) |

## 12.6 Related features

Points and promotions: [Chapter 13](#ch-13). Messaging many customers: [Section 15.3](#s-15-3).

# Chapter 13: Promotions and Points

## 13.1 Overview

![Figure 13.1: Promotions & Points, Overview tab](images/screens/promotions.jpg)

**Promotions & Points** ([Figure 13.1](#f-13-1)) holds everything that rewards customers, in four tabs: **Overview**, **Codes**, **Referrals** and **Points**.

## 13.2 Access requirements

Any of `promotions.view`, `promotions.manage`, `referrals.view`, `referrals.manage`, `loyalty.view`, `loyalty.configure`, `customers.loyalty`. Creating codes needs `promotions.manage` (Owner, Admin, Manager). Changing point values needs `loyalty.configure` (Owner, Admin). Cashiers can apply codes at the till but cannot create them.

## 13.3 How points work

**Table 13.1:** How customers earn points

| When the customer… | They earn |
|---|---|
| Pays for goods | **2 points for every KSh 1** (delivery not included) |
| Buys on credit | Nothing at the time |
| Pays off a debt | **1 point for every KSh 1** repaid |
| Makes a walk-in sale | Nothing, unless they are added afterwards ([Section 12.4.4](#s-12-4-4)) |

**Table 13.2:** What points are worth, by tier

| Tier | Reached at total spending of | Points needed for KSh 1 off |
|---|---|---|
| Bronze | KSh 0.00 | 50 points |
| Silver | KSh 10,000.00 | 100 points |
| Gold | KSh 30,000.00 | 200 points |

**Rules:**

- **Points are a discount, not money.** They cannot be paid out as cash, M-Pesa or wallet money.
- A customer can use them at the till or, on their page, to pay off what they owe. They need at least 100 points first.
- Tiers rise automatically and never fall automatically.

## 13.4 Points settings and report

![Figure 13.2: Points tab: switch points on or off, earning and tier values, points report](images/screens/promotions-points.jpg)

The **Points** tab ([Figure 13.2](#f-13-2)) has the **points report** (points held and their value, earned, used, and what they cost the shop) and, for owners and admins, the switch that turns points on or off and the tier values. This is the only place points are set.

## 13.5 Creating a promotion code

![Figure 13.3: Codes tab: + New makes a promotion code](images/screens/promotions-codes.jpg)

1. Open the **Codes** tab ([Figure 13.3](#f-13-3)) and press **N** (or **+ New**).
2. Choose **what it gives**: a percentage or KSh off, wallet money, or a free item.
3. Choose **what it covers**: the whole sale, chosen items or groups.
4. Choose **who** can use it (anyone or chosen customers), **when**, a minimum spend, and how many times.
5. Choose whether it works with other discounts.
6. Save.

**Expected result:** the code works at the till and on the website. Every use is recorded and counted in the books as a promotion discount.

## 13.6 Referrals

A referral campaign gives each customer a personal code to share. The friend gets a welcome discount on their first purchase; the customer who shared it gets a reward (a code or wallet money) after the friend's purchase is confirmed. Referrals that look suspicious wait in **To check** for a manager.

## 13.7 Advisor

The **Advisor** card reads your figures and suggests what to try. It never changes anything by itself ([Chapter 24](#ch-24)).

# Chapter 14: Regular Orders

## 14.1 Overview

![Figure 14.1: Regular Orders, By day: who is due today and the ring time](images/screens/regular-orders.jpg)

**Regular Orders** ([Figure 14.1](#f-14-1)) is for customers supplied on fixed days, such as daily milk.

## 14.2 Access requirements

Any of `customers.view`, `customers.schedules`, `pos.create_sale`. By default: Owner, Admin, Manager, Cashier. Approving a customer's request from the website needs `customers.manage`.

## 14.3 Procedures

### 14.3.1 Adding a regular order

1. Open **Regular Orders** and add one.
2. Choose the customer and the product.
3. Enter the amount for **each day of the week** (for example 20 on Monday, 23 on Wednesday, none on Sunday).
4. Save.

### 14.3.2 Delivering the day's orders

1. Open the **By day** list. It shows who is due today and how much.
2. To change one day only, edit that day; to skip a day, choose **skip** and add a message to the customer.
3. Tap **Delivered**.

**Expected result:** one sale is made on the customer's account, paid from the wallet first and then as debt.

### 14.3.3 Undoing a delivery

Refund the sale in **Sales Log** ([Section 10.3](#s-10-3)). The day goes back to "due".

## 14.4 Business rules

- Customers can ask for a regular order on the website. A manager approves it before it starts.
- If today's orders are not done by the ring time (4 pm unless changed), the phones of staff who handle them ring every 2 hours.
- In the evening the app warns if stock is short for tomorrow's orders.

# Chapter 15: Feedback and Customer Messaging

## 15.1 Overview

![Figure 15.1: Feedback: customer reviews and complaints](images/screens/feedback.jpg)

**Feedback** ([Figure 15.1](#f-15-1)) holds customer reviews and complaints, with filters by stars and mood, and the **Communication** tab for messaging many customers at once.

## 15.2 Access requirements

Permission `complaints.view` (Owner, Admin, Manager, Cashier). Replying needs `complaints.reply` (Owner, Admin, Manager). The **Communication** tab needs `communication.send` (Owner, Admin, Manager).

## 15.3 Messaging many customers

1. Open **Feedback > Communication**.
2. Pick the customer groups (for example, everyone who owes money).
3. Write the message. Use variables such as **{first_name}**, **{debt}** or **{points}** to fill in each customer's own details.
4. Optionally tap **Write with AI** for a draft, and check it.
5. Send.

**Rules:** customers who have not agreed to a kind of message are skipped. Order updates and reminders are on by default; offers need the customer's agreement.

# Chapter 16: Payments, Expenses and Petty Cash

## 16.1 Overview

![Figure 16.1: Payments & Expenses](images/screens/payments-expenses.jpg)

**Payments & Expenses** ([Figure 16.1](#f-16-1)) has the tabs **Payments**, **M-Pesa**, **Airtel Money**, **Cards**, **Expenses** and **Methods**. Each shows its balance; the balances and the books always agree. **Payment Prompts** and **Petty Cash** are separate screens in the same group.

## 16.2 Access requirements

**Table 16.1:** Access to money screens (defaults)

| Screen or tab | Permission | Default roles |
|---|---|---|
| Payments & Expenses | `payments.*` or `expenses.view` / `expenses.create` | Owner, Admin, Manager, Cashier (tabs vary) |
| Methods tab | `payments.configure` | Owner, Admin |
| Payment Prompts | `payments.mpesa` or `payments.airtel` | Owner, Admin, Cashier |
| Petty Cash | `pettycash.record` | Owner, Admin, Manager, Cashier |
| Void a payment | `payments.manage` | Owner, Admin |

## 16.3 How customers can pay

**Table 16.2:** How customer payments reach ISMS

| How the customer pays | What happens |
|---|---|
| You send a **prompt** (Payment Prompts, POS, or their page) | They enter their PIN; the payment is recorded against them automatically |
| They pay the M-Pesa **till** from their own phone | The payment has no account number, so it waits in **M-Pesa > Paid to the till** |
| They pay Airtel Money from their own phone | Record it by hand |
| They order on the website or by dial code | They get a prompt; the order is paid when they enter their PIN |

## 16.4 Procedures

### 16.4.1 Sending a payment prompt

![Figure 16.2: Payment Prompts: choose M-Pesa or Airtel Money, enter the number and amount](images/screens/payment-prompts.jpg)

1. Open **Payment Prompts** (**G** then **M**) ([Figure 16.2](#f-16-2)).
2. Choose **M-Pesa** (M) or **Airtel Money** (A).
3. Type the phone number and the amount.
4. Send, and watch the prompt go from sent to paid.

### 16.4.2 Recording a debt payment or wallet top-up

On the customer's page, open **Money**:

- **Pay debt** takes money towards what they owe; the oldest debts are cleared first.
- **Top up wallet** adds money they can spend later (it pays any debt first).
- **Send prompt** asks them to pay from their phone.
- **Points to use for debt**: enter points and tap **Pay debt**. Only the points the debt needs are used.

### 16.4.3 Clearing the "Paid to the till" list

Check this list every day. For each payment in **Payments & Expenses > M-Pesa > Paid to the till**, choose:

- **Record for customer**: it goes to their debt first, then their wallet;
- **Already rung up as a sale**: nothing is added twice;
- **Walk-in, not a sale**: money from someone with no account;
- **Ignore**, with a note saying why.

### 16.4.4 Recording an expense

1. Open **Payments & Expenses > Expenses** and press **N**.
2. Enter the amount, category and description, and add a photo of the receipt.
3. Save.

Filter the list by today, this week, this month or last month.

### 16.4.5 Paying a rider

1. Tap **Pay a rider** on **Petty Cash** or **Expenses**.
2. Choose the rider and the amount, and where the money came from.

**Expected result:** what the shop owes the rider is cleared. The payment is not counted as spending a second time ([Section 21.7](#s-21-7)).

## 16.5 Correcting a mistake

Payments and expenses are never edited into a different amount. If one is wrong:

1. Open it and tap **Void** (or **Remove**).
2. Give a reason.
3. Record it again correctly.

**Expected result:** the money and the books are put back; the record keeps who voided it and why.

## 16.6 Switching payment methods on or off

Owners and admins use the **Methods** tab. See ISMS-AG, Payment methods.

## 16.7 Petty cash

![Figure 16.3: Petty Cash: what was taken, what for, and Pay a rider](images/screens/petty-cash.jpg)

**Petty Cash** ([Figure 16.3](#f-16-3)) is for money taken from the till to spend, for example buying bread for the shop.

1. Open **Petty Cash**.
2. Record what you took and what it was spent on.

**Rules:** it counts as an expense and comes off the cash expected at the end of your shift. You can remove your own entry within 24 hours.

## 16.8 Troubleshooting

**Table 16.3:** Payment problems

| Problem | Cause and action |
|---|---|
| A customer paid the till but it isn't on their account | Find it in **M-Pesa > Paid to the till** and record it for them |
| The prompt didn't arrive | Check the number and that the line has M-Pesa or Airtel Money, then send again |
| I can't change a payment's amount | Void it and record it again ([Section 16.5](#s-16-5)) |
| "Too many requests" | A limit was reached. Wait a few minutes and try again |

# Chapter 17: Finance and Accounting

## 17.1 Overview

![Figure 17.1: Finance & Accounting, Summary tab](images/screens/finance-accounting.jpg)

**Finance & Accounting** ([Figure 17.1](#f-17-1)) shows profit, money in and out, debts, VAT and the books. The books fill themselves: every sale, refund, payment, expense, purchase, stock change and transfer posts an entry. Nothing needs to be typed for the books to be right.

## 17.2 Access requirements

Permission `finance.view` or `accounting.view`. By default: Owner, Admin, Manager. Journal entries, accounts and locking need `accounting.manage` (Owner, Admin).

## 17.3 Tabs

![Figure 17.2: Books tab: profit and loss, balance sheet, trial balance and accounts](images/screens/finance-books.jpg)

**Table 17.1:** Finance & Accounting tabs

| Tab | What it shows |
|---|---|
| Summary | Profit, money in and out, debts and VAT for the period |
| Who owes | **Customers owe us** and **We owe suppliers** |
| VAT | VAT charged and paid (only with KRA eTIMS) |
| Books | Overview, profit and loss, balance sheet, trial balance, journal and accounts ([Figure 17.2](#f-17-2)) |
| Checks | **Count money & stock** against the books; lock and rebuild |

## 17.4 Procedures

### 17.4.1 Counting money and stock

1. Open **Checks > Count money & stock**.
2. Count the cash or stock you really have and enter it.

**Expected result:** any difference is posted, so the books match what is in the shop.

### 17.4.2 Locking a month (owners)

Once a month has been checked, an owner can lock it. A later change to a locked month is posted as a correction in the open month instead.

## 17.5 Business rules

- Refunds are taken off sales.
- Rider pay counts as spending on the day it is owed.
- Debt paid with points is taken off profit, because the shop gave that value away.
- Home and Finance & Accounting read the same books, so their figures agree.

# Chapter 18: Inventory and Stock

## 18.1 Overview

![Figure 18.1: Inventory: stock level, minimum and Adjust for each product](images/screens/inventory.jpg)

**Inventory** ([Figure 18.1](#f-18-1)) lists every product with its stock level and minimum. **Stock History** shows every change; **Stock Transfers** moves stock between branches.

## 18.2 Access requirements

**Table 18.1:** Access to stock screens (defaults)

| Screen or action | Permission | Default roles |
|---|---|---|
| Inventory (view) | `inventory.view` | Owner, Admin, Manager, Cashier |
| Add or edit products | `products.create`, `products.update` | Owner, Admin, Manager |
| Restock, adjust, count, wastage | `inventory.receive_stock`, `inventory.adjust_stock`, `inventory.stock_count`, `inventory.wastage` | Owner, Admin, Manager |
| Stock History | `inventory.stock_history` | Owner, Admin, Manager |
| Stock Transfers | `inventory.transfer_stock`, `inventory.receive_stock` or `inventory.request_transfer` | Owner, Admin, Manager |

## 18.3 Adding a product

![Figure 18.2: The Add New Product form](images/screens/product-add.jpg)

1. In **Inventory**, press **N** or tap **Add product** ([Figure 18.2](#f-18-2)).
2. Enter the name, category, barcode or code, unit, cost, price, opening stock and minimum stock level.
3. For a photo, use the **Camera** (phone), **Webcam** (computer), a file, or search for a free photo. The background can be removed with one tap.
4. Save.

Products without their own photo show a standard stock image.

## 18.4 Receiving, adjusting and counting stock

![Figure 18.3: Adjust stock: what happened, how many, and the reason](images/screens/stock-adjust.jpg)

1. In **Inventory**, tap **Adjust** on the product. The **Adjust stock** form opens ([Figure 18.3](#f-18-3)).
2. Under **What happened**, choose the kind of change ([Table 18.2](#t-18-2)).
3. Enter **How many**. The form shows **Now**, **Change** and **After**.
4. Enter the **Reason** (for example "Delivery from Brookside, 2 spilt").
5. Tap **Save change**.

**Table 18.2:** Kinds of stock change

| Change | Use it when |
|---|---|
| Restock (+) | Goods arrive (or receive a purchase, [Section 20.4](#s-20-4)) |
| Damage (−) | Goods are spilt, sour or damaged |
| Stock count | Setting the number you actually counted |

**Expected result:** the stock changes and the change appears in **Stock History** with your name and a number (`STM-…`).

**Alerts:** when a product runs low, staff who manage stock get **Stock Almost Finished**, and **Out Of Stock** at zero. The alert has an **Ask supplier** button ([Section 20.5](#s-20-5)).

## 18.5 Stock History

![Figure 18.4: Stock History: every change with who did it and its STM- number](images/screens/stock-history.jpg)

**Stock History** ([Figure 18.4](#f-18-4)) shows every change to stock: restocks, wastage, counts, sales, transfers and production, with who made it. Each line has a number (`STM-…`); sales show their receipt number.

## 18.6 Moving stock between branches

![Figure 18.5: Stock Transfers: To do, History and By product](images/screens/stock-transfers.jpg)

![Figure 18.6: Send stock: choose the branch and products](images/screens/transfer-send.jpg)

**Stock Transfers** ([Figure 18.5](#f-18-5)) has the tabs **To do**, **History** and **By product**.

1. **Send** (N): choose the branch and products ([Figure 18.6](#f-18-6)). Stock leaves your branch at once and shows as **On the way**.
2. The other branch **receives** it, counting what really arrived. Only that is added.
3. If something is short, the shortage stays on the transfer and the sender is told. It can be settled later as arrived late, found, or written off.

**Rules:**

- A transfer is not a sale: profit does not change.
- You can cancel while it is still on the way; the stock comes back.
- To **ask** another branch for stock, press **A**.
- **By product** totals transfers per product by week, month or dates.

# Chapter 19: Production and Bills of Materials

## 19.1 Overview

![Figure 19.1: Production & BOM: recipes and batches](images/screens/production-bom.jpg)

In **Production & BOM** ([Figure 19.1](#f-19-1)), a recipe (bill of materials, BOM) says which raw materials make one batch and how many items the batch gives.

## 19.2 Access requirements

Permission `bom.view`. By default: Owner, Admin, Manager. Creating recipes needs `bom.create`; running batches needs `production.create`.

## 19.3 Procedures

1. **New recipe** (B): choose the finished product, the ingredients and the amounts per batch, and how many items one batch gives.
2. **Start a batch** (N): the ingredients are taken out of stock.
3. **Complete** the batch: the finished goods are added to stock.
4. **Cancel** a batch if needed: unused raw materials go back to stock and the rest is recorded as waste.

## 19.4 Business rules

- If stock is short, the app will not start the batch.
- Recipes state amounts per batch (the yield), not per item.
- Each step is all or nothing: a failed step changes nothing.

# Chapter 20: Buying and Suppliers

## 20.1 Overview

![Figure 20.1: Buying > Orders > Reorder lists what is running low](images/screens/buying.jpg)

**Buying** ([Figure 20.1](#f-20-1)) has the tabs **Suppliers**, **Orders**, **Bills** and **Settings**. It covers ordering from suppliers, receiving goods and paying the bills.

## 20.2 Access requirements

Any of `suppliers.view`, `purchases.view`, `purchases.create`, `purchases.approve`, `supplier_bills.manage`. By default: Owner, Admin, Manager. Each role can have a limit above which a purchase needs approval.

## 20.3 Suppliers

![Figure 20.2: Buying > Suppliers](images/screens/buying-suppliers.jpg)

Add or invite suppliers from **Buying > Invite a supplier**, which opens **Workers** with the Supplier role. A supplier with an email gets their own sign-in ([Section 20.6](#s-20-6)); one without is just kept on the list. Edit a supplier's details in **Buying > Suppliers** ([Figure 20.2](#f-20-2)).

## 20.4 Buying stock

1. **Reorder** lists what is running low and how much to order. Tick lines and press **N** to draft purchases.
2. A purchase goes from draft to **Ordered**. If it is above your role's limit, it waits in **Approvals** for an owner or someone allowed.
3. When goods arrive, **receive** them (`GRN-…`). Stock goes up and the cost is updated.
4. Record the supplier's **bill** (`BILL-…`). The app flags a bill that does not match what was ordered and received (**Needs a check**).
5. Pay the bill from **Bills**. Send back damaged goods with a **Return** (`RTS-…`).

![Figure 20.3: Bills: supplier bills and Riders to pay in one list](images/screens/buying-bills.jpg)

**Bills** ([Figure 20.3](#f-20-3)) has one filter bar: **Not paid / Paid / All** and **Today / This week / This month / All**. It lists supplier bills and **Riders to pay** together.

**Rule:** the branch that orders pays the supplier.

## 20.5 Asking a supplier for stock

1. From a low-stock alert or a **Reorder** line, tap **Ask supplier**.
2. Choose **one** supplier (the preferred one is first).
3. Enter the amount, when you need it (today, tomorrow, a day) and a note, for example "we need 200 L milk tomorrow".
4. Send.

**Expected result:** the supplier's phone rings. You are told when they accept or decline. A supplier without the app gets it by WhatsApp or SMS instead.

## 20.6 The supplier's view

A supplier the shop invites signs in with the same app but sees only their own **supplier page**: orders sent to them, bills, and **Requests** for stock. When the shop asks for stock, the supplier's phone rings; they accept or decline, and the shop is told.

# Chapter 21: Deliveries and Riders

## 21.1 Overview

![Figure 21.1: Deliveries: Requests, Mine, Trips and Areas & prices](images/screens/deliveries.jpg)

**Deliveries** ([Figure 21.1](#f-21-1)) has the tabs **Requests**, **Mine**, **History**, **Trips** and **Areas & prices**.

## 21.2 Access requirements

Permission `deliveries.view`. By default: Owner, Admin, Manager, Rider. **Trips** needs `deliveries.assign` (Owner, Admin, Manager). Only the Rider role can accept requests.

## 21.3 Accepting a delivery (riders)

1. Open **Requests**. It lists deliveries with no rider.
2. Tap **Accept**. First come, first served.

**Expected result:** the delivery moves to **Mine** and the customer's phone number shows.

You can give a delivery back until you start it.

## 21.4 Completing a delivery (riders)

1. In **Mine**, open the delivery. Products are listed first with their quantities; tick them as you check them.
2. Mark it as started.
3. Mark it as delivered. If some items are not ticked, the app asks once.

The screen tells you what to collect from the customer and what you keep.

## 21.5 Delivery areas and prices

Riders, owners and admins can add delivery areas and set their prices in **Areas & prices**; other roles see them read-only. New areas show on the website checkout straight away.

## 21.6 Trips

![Figure 21.2: Trips: deliveries joined into one round with one rider pay](images/screens/deliveries-trips.jpg)

An owner or manager can join two or more deliveries for one rider into a **trip** with one price ([Figure 21.2](#f-21-2)). Accepting or giving back one delivery in a trip does it for the whole trip.

## 21.7 What riders are owed

- Rider pay is owed from the day of the delivery and counts as spending that day.
- Nothing is owed for **Pay the rider** deliveries, or for failed or cancelled ones.
- A rider does not need an account: the name typed at the sale is enough. A delivery for a typed-in name does not appear under anyone's **Mine**.
- See and pay what each rider is owed in **Buying > Bills > Riders to pay**, or with **Pay a rider** ([Section 16.4.5](#s-16-4-5)).

# Chapter 22: Online Store

## 22.1 Overview

![Figure 22.1: Online Store: Orders, Messages, Feedback, Reviews and the Website tabs](images/screens/online-store.jpg)

**Online Store** ([Figure 22.1](#f-22-1)) is the staff side of the shop's website: orders, customer messages and the website's content.

## 22.2 Access requirements

Permission `online_store.view`. By default: Owner, Admin, Manager, Cashier. The **Reviews**, **Product ideas** and website content tabs need `business.update` (Owner, Admin).

## 22.3 Handling website orders

Move each order on in turn:

1. **Start preparing**.
2. **Mark ready for pickup**, or **Send out for delivery**.
3. **Mark completed**.

Orders with a wrong amount, a second payment or a stock shortage are flagged for staff.

## 22.4 Messages, feedback, reviews and ideas

The **Messages** and **Feedback** tabs hold what website customers send. Owners and admins also see **Reviews** and **Product ideas**: customers' reviews, and their product suggestions and votes.

## 22.5 Website content

For owners and admins, the website tabs hold the home banner, pages, adverts, guides, and which products are on the website or hidden. Setting up the website is described in ISMS-AG.

## 22.6 Business rules

- Refunds of website orders are done by hand, in M-Pesa and the POS.
- Points used on a cancelled order are returned to the customer.

# Chapter 23: Home and Reports

## 23.1 Overview

**Home** shows how the business is doing; **Stock Report** gives the daily or monthly report per product.

Access: Home needs `home.view`; Stock Report needs any of `reports.inventory`, `reports.view`, `reports.sales`, `inventory.stock_history`, `finance.view`. By default both are for Owner, Admin and Manager.

## 23.2 Home

![Figure 23.1: Home on a phone](images/screens/phone-home.jpg)

- Choose the **period**: today, this week, this month or your own dates. Times are Kenya time.
- On a phone you see **Sales**, **Profit**, **Money in** and **Spending** ([Figure 23.1](#f-23-1)). Swipe sideways for more.
- **Needs attention** lists things to act on, such as low stock and unpaid debts.
- Tap a chart's **Full screen** button, then turn the phone sideways to see it large.

**Rules:** refunds are taken off sales; rider pay counts as spending on the day it is owed; debt paid with points is taken off profit. Home and Finance & Accounting read the same books, so their figures agree.

## 23.3 Stock Report

![Figure 23.2: Stock Report for a month, per product](images/screens/stock-report-month.jpg)

**Stock Report** (**G** then **G**) is the daily or monthly report per product ([Figure 23.2](#f-23-2)): opening stock, sales, what was added, closing stock, till money, what is not paid, and pending bills. Share it on WhatsApp in one tap.

# Chapter 24: Assistant and Advisors

## 24.1 Overview

![Figure 24.1: The Assistant](images/screens/assistant.jpg)

The **Assistant** ([Figure 24.1](#f-24-1)) answers questions about the business in plain language: products, stock, customers and staff. **Advisor** cards on Promotions & Points, Payments & Expenses and Finance & Accounting explain the figures on those screens.

## 24.2 Access requirements

Permission `ai.use`. By default: every staff role. The Assistant is available only when the Admin has set up an AI service (see ISMS-AG).

## 24.3 Business rules

- The Assistant never changes data by itself. When it suggests an action (for example a stock adjustment), the action is shown as a card in the chat. A person allowed to do that action checks it, can change it, and approves or rejects it. The action then runs with that person's permissions.
- Advisor cards only explain and suggest; they never change anything.
- Without an AI service set up, the Assistant is unavailable and the rest of the app works normally.

# Chapter 25: Administration Screens

The Admin group (**Roles**, **Audit Log**, **Business Management**, **Settings**) and **Workers** are used to run the business rather than to serve customers. Their procedures are in the **ISMS System Administration Guide (ISMS-AG)**.

**Table 25.1:** Administration screens and where they are described

| Screen | Purpose | Default roles | ISMS-AG chapter |
|---|---|---|---|
| Workers | Invite staff and suppliers, change roles, remove people, schedules | Owner, Admin, Manager (view, schedule) | User and Access Administration |
| Roles | What each role can see and do | Owner, Admin | Role and Permission Management |
| Audit Log | Who changed what | Owner, Admin | Audit Trails and Activity Monitoring |
| Business Management | Branches, business details, logo, colours, tax | Owner, Admin | Business Configuration |
| Settings | Receipts and printing, invoices, SMS, WhatsApp, AI, backups, old records, device, notifications | Owner, Admin, Manager | System Configuration |

# Part IV: General Operations

# Chapter 26: Notifications and Alerts

## 26.1 The notifications screen

![Figure 26.1: Notifications: tap the bell at the top right](images/screens/notifications.jpg)

Tap the bell at the top right to open **Notifications** ([Figure 26.1](#f-26-1)). It has a category panel (stock, sales and reports, deliveries, payments, AI insights, reminders, system and security), tabs for **All**, **Unread**, **Important** and **Reminders**, and search. Press **M** to mark all as read.

## 26.2 Choosing what you receive

Open **Notifications** and tap **Notification settings**. Choose the categories you want, the sounds, and whether to pause. The choices apply to your account on every device.

**Rules:**

- You can only receive categories your role can see (for example, stock alerts need the stock screens).
- Pausing turns off everything except account and security alerts, which cannot be turned off.

## 26.3 Ringing alerts

Some alerts ring like an alarm until someone accepts them: reminders you set ([Section 7.4.3](#s-7-4-3)), stock requests to suppliers, and regular orders not done by the ring time. Open the alert to stop it. Accepting it on one device stops it on your other devices.

# Chapter 27: Search and Keyboard Shortcuts

## 27.1 Searching the app

![Figure 27.1: Typing "milk" in the search box finds the product, its category and related screens](images/screens/global-search.jpg)

The search box at the top (or **Ctrl+K**) finds ([Figure 27.1](#f-27-1)):

- screens, settings and keyboard shortcuts: type "invoice", "merge", "KRA" or "offline";
- products and customers;
- **any record by its number** ([Table 27.1](#t-27-1)).

**Table 27.1:** Record numbers the search recognises

| Prefix | Record |
|---|---|
| `TXN-` | Sale (receipt) |
| `INV-` | Invoice |
| `QT-` | Quote |
| `CN-` | Credit note (refund) |
| `GRN-`, `BILL-`, `RTS-` | Goods received, supplier bill, return to supplier |
| `EXP-` | Expense |
| `STM-` | Stock change |
| `LDG-` | Customer ledger line |
| `JE-` | Journal entry |

Picking a result opens the exact record and highlights it. Most records show their number on a small chip; tap the chip to copy the number.

## 27.2 Keyboard shortcuts

![Figure 27.2: Press ? anywhere for the shortcut list](images/screens/shortcuts-help.jpg)

On a computer, or a tablet with a keyboard, press **?** (or **F1**) on any screen to see its shortcuts ([Figure 27.2](#f-27-2)). On wide screens, buttons show their key. **About this app** has the full list for your role.

- **Ctrl+K** searches; **/** or **Ctrl+F** goes to the screen's search box.
- **G** then a letter opens a screen (for example **G** then **H** for Home).
- **Esc** closes a window or clears a search.

The full tables are in [Appendix A](#app-a).

# Chapter 28: Working Offline

You can keep selling when the internet goes off.

## 28.1 What works offline

- **Cash**, **card** and **M-Pesa sales with a code you type in** are saved on the device.
- They show in rose red with **Waiting to sync** in the Sales Log, and the strip under the header counts them.
- They are sent by themselves when the internet comes back or the app is opened again. Prices and stock are checked again when they arrive.

> **Important:** Do not ring the sale up again. Each sale is sent only once, even if the app retries.

## 28.2 What needs the internet

Credit sales, sales with a promotion or referral code, payment prompts, customer changes, stock changes and transfers, payments, expenses and petty cash.

# Chapter 29: Updating the App

![Figure 29.1: About this app: version, updates and terms](images/screens/about-this-app.jpg)

## 29.1 How updates arrive

The app checks for a new version by itself 15 seconds after it starts, whenever the internet comes back, and every six hours. Updates download in the background. **About this app** ([Figure 29.1](#f-29-1)) shows the version and the update state.

## 29.2 Installing an update

- **Windows and Linux:** when the update is ready, open **About this app** and tap **Restart and install**.
- **Android:** the app opens Android's installer once by itself; tap **Install**. The first time, Android asks you to allow installs from KayKay's. If you closed it, open **About this app** and tap **Install update**.

To check by hand, open **About this app** and tap **Check for updates**. If an update fails, the app says so and **Try again** appears there.

## 29.3 Version numbers

Version numbers started again at **1.0.0** in November 2026. Android phones on the old 7.x versions update normally; Windows and Linux computers on 7.x must install the new version by hand once.

# Part V: Support

# Chapter 30: Frequently Asked Questions

## 30.1 Selling

**Can a customer pay with points instead of money?** Points are a discount, not money. They can come off a sale at the till, or pay off debt on the customer's page. They are never paid out as cash, M-Pesa or wallet money ([Section 13.3](#s-13-3)).

**A regular customer bought through Quick Sale. Can they still get points?** Yes. Add them to the sale within 24 hours (cashiers) or 30 days (managers) ([Section 12.4.4](#s-12-4-4)).

**Can I delete a wrong sale?** No. Refund it, or use **Edit** to refund and sell again ([Section 10.3](#s-10-3), [Section 10.4](#s-10-4)).

**Why does a credit sale not show as a payment?** A credit sale is money owed, not money received. It becomes a payment when the customer pays the debt ([Section 11.3](#s-11-3)).

## 30.2 Money

**Why does an M-Pesa payment to the till not reach the customer's account by itself?** A till payment carries no account number, so the app cannot tell whose it is. Assign it from **Paid to the till** ([Section 16.4.3](#s-16-4-3)).

**How do I correct a payment?** Void it with a reason and record it again ([Section 16.5](#s-16-5)).

## 30.3 Access

**Why can't I see a screen my colleague has?** Your role does not include it. Ask the Admin.

# Chapter 31: Troubleshooting

## 31.1 Signing in

**Table 31.1:** Sign-in problems

| Problem | What to do |
|---|---|
| The invitation code doesn't work | Sign in with the email the invitation was sent to and confirm that email, or ask for a new invitation |
| The reset code stopped working | It was entered wrong five times. Ask for a new code |
| "Too many requests" | Wait a few minutes and try again |

## 31.2 Working

**Table 31.2:** Everyday problems

| Problem | What to do |
|---|---|
| I can't see a screen or button | Your role doesn't include it. Ask the Admin |
| A sale says **Waiting to sync** | You were offline. It sends when the internet is back; don't ring it up again |
| A payment method is missing at the till | It is switched off in **Payments & Expenses > Methods** |
| A code says it needs the internet | Promotion and referral codes work only online |
| **Add customer** isn't on the receipt | The sale already has a customer, wasn't paid, or is too old |
| I can't turn on VAT | The business must be connected to KRA eTIMS first |
| I was clocked out on my own | You didn't answer "Still working?" within 3 minutes. Clock in again |
| My phone keeps ringing | Open the alert to stop it |
| A shortcut does nothing | Click outside any text box, then press **?** |
| The data looks old | Press **F5** to reload the latest data |

## 31.3 Devices and updates

**Table 31.3:** Device problems

| Problem | What to do |
|---|---|
| The printer isn't listed | On Android, pair it in the phone's Bluetooth settings first; check it is on |
| The phone says "App not installed" when updating | Uninstall and install the latest version by hand once |
| Android won't install the update | Allow installs from KayKay's when Android asks |

## 31.4 Reporting a problem

![Figure 31.1: About this app > Report a problem](images/screens/report-problem.jpg)

Owners and admins, and any role the owner gives the `support.report` permission, can report a problem from **About this app > Report a problem** ([Figure 31.1](#f-31-1)): choose how serious it is, describe it, and keep the reference number (`PR-…`) the app gives. Other staff should tell the Admin what they were doing and what the message said.

# Chapter 32: Glossary

**Table 32.1:** Glossary

| Term | Meaning |
|---|---|
| Advisor | A card that explains the figures on a screen and suggests actions; it never changes data |
| Bill of materials (BOM) | A recipe: the ingredients and amounts that make one batch of a product |
| Branch | One shop location of the business |
| Credit note | The record of a refund (`CN-…`) |
| Credit sale | A sale paid later; the amount becomes the customer's debt |
| Dial code (USSD) | Ordering by dialling a code such as `*384*123#` on any phone |
| eTIMS | The Kenya Revenue Authority's electronic tax invoice system |
| GRN | Goods received note: the record of goods arriving from a supplier |
| Invoice | A bill for what a customer owes on credit (`INV-…`) |
| Ledger | The list of every change to a customer's balances |
| Payment prompt (STK push) | A request on the customer's phone to enter their M-Pesa or Airtel Money PIN |
| Petty cash | Money taken from the till to spend for the shop |
| Points | Loyalty points: a discount, never money |
| Quote | A priced list of goods before a sale (`QT-…`) |
| Referral | A customer's personal code that gives a friend a welcome discount and the customer a reward |
| Regular order | A fixed amount supplied to a customer on chosen weekdays |
| Ringing alert | An alert that rings until someone accepts it |
| Shift | The time between clock-in and clock-out |
| Tier | Bronze, Silver or Gold; decides what a customer's points are worth |
| Till | The shop's M-Pesa Buy Goods number |
| Trip | Several deliveries for one rider, paid as one |
| Walk-in sale | A sale with no registered customer |
| Wallet | Money a customer paid in advance |

# Appendix A: Keyboard Shortcut Reference

**Table A.1:** Shortcuts on every screen

| Keys | Action |
|---|---|
| Ctrl+K | Search the app |
| ? or F1 | Shortcuts for this screen |
| / or Ctrl+F | Go to this screen's search box |
| F5 or Ctrl+R | Reload the latest data (Ctrl+Shift+R restarts the app) |
| Alt+← | Back to the previous screen |
| Ctrl+, | Settings |
| [ and ] | Previous / next tab |
| Esc | Close a window or clear a search |

**Table A.2:** Go to a screen: press G, then the key

| Key | Screen | Key | Screen | Key | Screen |
|---|---|---|---|---|---|
| H | Home | I | Inventory | E | Payments & Expenses |
| Q | Quick Sale | Y | Stock History | M | Payment Prompts |
| P | POS | T | Stock Transfers | C | Petty Cash |
| S | Sales Log | G | Stock Report | F | Finance & Accounting |
| L | Customers | B | Buying | K | Shift |
| O | Online Store | J | Production & BOM | W | Workers |
| % | Promotions & Points | D | Deliveries | R | Roles |
| 7 | Regular Orders | V | Feedback | X | Audit Log |
| A | Assistant | Z | Business Management | , | Settings |
| N | Notifications | U | My Profile | ? | About this app |

**Table A.3:** Quick Sale and POS

| Keys | Action |
|---|---|
| Alt+1 / Alt+2 | Cash / M-Pesa |
| Alt+3 | Credit (POS only) |
| Alt+4 / Alt+5 / Alt+6 | Card / Bank (POS only) / Airtel Money |
| Alt+C | Choose a customer (POS) / add a customer to the last sale (Quick Sale) |
| Alt+R | Receipt for the last sale |
| Enter | Add the scanned or highlighted product |
| ↑ ↓ | Move through products |
| + − | One more / one less of the last item |
| Esc | Clear the search, then the sale (Quick Sale) |

**Table A.4:** POS only

| Keys | Action |
|---|---|
| / or F2 | Search products |
| Alt+← Alt+→ | Previous / next category |
| Delete | Remove the last item |
| Ctrl+Delete | Empty the cart |
| F4 | Show / hide the cart (phone layout) |
| Alt+D | Delivery on / off |
| Alt+N | Add a note |
| Alt+Q | Save the cart as a quote |
| Ctrl+Enter or F9 | Complete the sale |

**Table A.5:** Other screens

| Screen | Key | Action |
|---|---|---|
| Receipt | P W E D C B A | Print, WhatsApp, email, PDF, copy, barcode, add customer |
| Inventory, Customers, Promotions & Points | N | Add a product / customer / promotion |
| Customers | P | Points report and settings |
| Shift | C / N / T / ← → / M | Clock in or out / reminder / today / day before or after / month view |
| Stock Transfers | N / A | Send stock / ask a branch for stock |
| Buying | N | Invite a supplier / new purchase / draft from ticked lines |
| Payments & Expenses | N | Record an expense (Expenses tab) |
| Payment Prompts | M / A / N / R | M-Pesa / Airtel / new prompt / send again |
| Finance & Accounting | N | New journal entry or account |
| Production & BOM | N / B | Start a batch / new recipe |
| Business Management | N | Add a branch |
| Notifications | M | Mark all as read |

# Appendix B: Default Screen Access by Role

These are the defaults built into release 1.0.1. An Owner or Admin can change them in **Roles**; the change applies at once on every device.

**Table B.1:** Screens each role can open by default

| Screen | Owner, Admin | Manager | Cashier | Rider |
|---|---|---|---|---|
| Home | Yes | Yes | — | — |
| Quick Sale, POS | Yes | Yes | Yes | — |
| Sales Log | Yes | Yes | Yes (own and customers' sales) | — |
| Online Store | Yes | Yes | Yes | — |
| Payment Prompts | Yes | — | Yes | — |
| Customers | Yes | Yes | Yes | — |
| Promotions & Points | Yes | Yes | Yes (points report) | — |
| Regular Orders | Yes | Yes | Yes | — |
| Feedback | Yes | Yes | Yes | — |
| Inventory | Yes | Yes | Yes (view) | — |
| Stock History, Stock Transfers, Production & BOM | Yes | Yes | — | — |
| Buying | Yes | Yes | — | — |
| Deliveries | Yes | Yes | — | Yes |
| Payments & Expenses | Yes | Yes | Yes (some tabs) | — |
| Petty Cash | Yes | Yes | Yes | — |
| Finance & Accounting, Stock Report | Yes | Yes | — | — |
| Shift | Yes | Yes | Yes | Yes |
| Workers | Yes | Yes (view, schedule) | — | — |
| Roles, Audit Log, Business Management | Yes | — | — | — |
| Settings | Yes | Yes | — | — |
| Assistant, Notifications, My Profile, About this app | Yes | Yes | Yes | Yes |

The Supplier role sees only the supplier page ([Section 20.6](#s-20-6)).
