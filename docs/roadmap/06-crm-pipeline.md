# Step 6: CRM pipeline and campaigns

## Goal

Win and keep customers on purpose: track possible deals (a school, hotel or supermarket that might buy milk every week), follow up on time, and send offers to the right customers by SMS, WhatsApp or email.

## What we have today

- Customers with loyalty points, tiers, debt, wallet, groups, schedules and merging.
- Communication Center sends SMS, WhatsApp and email messages.
- Feedback and complaints, reviews, website product ideas and voting.
- No record of people who aren't customers yet, and no follow-ups.

## What to build

### Leads and deals

- `crm_leads`: name, business, phone, email, source (walk-in, website, referral, call, event), what they want, rough value per month, owner (staff).
- Stages (editable per business): New → Contacted → Tasting/sample → Quote sent → Won / Lost (with reason).
- Board view with drag between stages (desktop) and a list with swipe (phone).
- Won: turn into a customer (reuse the merge rules, so no duplicates) and optionally a quote (step 2).

### Activities

- Calls, visits, messages and to-dos with a due date, on a lead or a customer.
- Reminders use the existing native alarms (AlarmManager), like shift reminders.
- "My follow-ups today" on Home for staff with CRM access.

### Customer insights

- Last bought, how often, average spend, and favourite products (from `transactions`).
- Segments built from rules: "Gold customers who haven't bought in 14 days", "owes more than KSh 2,000", "bought yoghurt last month".

### Campaigns

- A campaign = a segment + a message (SMS, WhatsApp template or email) + an optional promo code (website promotions exist) + a send time.
- Personal fields: {name}, {points}, {debt}.
- Respect opt-out: an "unsubscribe" or STOP reply marks the customer, and they are never messaged again by campaigns.
- Results: sent, delivered, failed, promo code uses, and sales within N days by people who got it.
- Cost estimate before sending (SMS units).

## How it posts to the books

Nothing directly. Campaign SMS costs can be recorded as a Marketing expense automatically if the SMS provider bills per message.

## Permissions

`crm.view`, `crm.manage` (Manager), `campaigns.send` (Owner/Admin by default, because it costs money and reaches every customer).

## Done when

- A lead moves through the stages to Won and becomes a customer with no duplicate.
- A follow-up rings on the phone at its time.
- A campaign to a segment sends, opt-outs are skipped, and the promo code uses are counted.

## Open questions

- WhatsApp templates need Meta approval. Which messages do we pre-approve?
- Should leads be shared across branches (main branch's sales team)?
