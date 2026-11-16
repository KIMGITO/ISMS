# Step 8: Projects, timesheets and helpdesk (low priority)

## Goal

For businesses that do jobs as well as sell (installing coolers, catering an event, building a milk collection point): plan the work, track the time and costs, and bill for it. Give customer problems a proper queue with an owner and a deadline.

## What we have today

- Clock-in shows when people worked, but not on what.
- Complaints and feedback, with staff replies and archive.
- Problem reports from the app go to Telegram (ops alerts), but that's for app faults, not customers.

## What to build

### Projects and tasks

- `projects`: customer, budget, start and end dates, status. Tasks with assignee, due date, checklist and stage (To do → Doing → Done).
- Board and list views. Task reminders use the native alarms.
- Costs on a project: stock used (stock out to the project), expenses tagged to it, and staff time.
- Project profit = what was billed − stock − expenses − time × cost rate.

### Timesheets

- Staff log time against a project or task. A timer runs from the clock-in bar, or they type hours.
- Clock-in hours not logged to a project show as "unassigned", so gaps are visible.
- Approval by a manager. Approved time can feed payroll (step 4) for hourly staff, and invoices (step 2) when time is billable.

### Helpdesk

- A ticket from a complaint, a website message, WhatsApp or a call. It gets a number, customer, category, priority and assignee.
- Statuses: New → Open → Waiting on customer → Solved → Closed. Customer replies reopen it.
- Response deadlines by priority (say 2 hours urgent, 1 day normal). A ticket close to its deadline alerts its owner, and a late one goes to the manager.
- Saved replies, and a satisfaction rating after solving (by SMS link).
- Existing complaints become tickets; the Feedback screen becomes the Helpdesk screen.

## How it posts to the books

| Event | Debit | Credit |
|---|---|---|
| Stock used on a project | Project costs (or Work in progress) | Stock |
| Billing a project | Customers owe us | Sales (services) |

Tagging expenses and journal lines with a `project_id` gives project profit and loss for free from the books.

## Permissions

`projects.view`, `projects.manage`, `timesheets.log` (everyone), `timesheets.approve` (Manager), `helpdesk.view`, `helpdesk.manage`.

## Done when

- A cooler installation project uses stock, gets two people's time and an expense, is billed, and shows its profit.
- A complaint becomes a ticket, is answered, goes late, and alerts the manager.

## Open questions

- Is this needed by current customers, or only for selling to new kinds of business?
- Should tickets be visible to the customer on the website (my tickets)?
