# Step 4: HR and payroll (Kenya)

## Goal

Pay staff correctly every month with Kenyan deductions, give each person a payslip, and keep leave, advances and contracts in one place. Use clock-in hours so casual and hourly staff are paid for the time they worked.

## What we have today

- Workers (employees), roles and permissions, invites.
- Clock-in shifts with totals worked out by the database (`shifts`, one open shift per person).
- Wages are entered by hand as an expense category ("Wages"), so the books see the money but not the person, and nothing is withheld for KRA, NSSF or SHA.

## What to build

### Employee records

- Contract type (permanent, casual daily, hourly, commission), start date, end date, job title, branch.
- Pay: monthly salary, day rate or hourly rate. Allowances (house, transport, airtime) and whether each is taxable.
- KRA PIN, NSSF number, SHA number, national ID, bank or M-Pesa number for pay.
- Documents (contract, ID copy) in the existing `business-files` bucket.

### Leave

- Leave types: annual (21 days a year by law), sick, maternity, paternity, compassionate, unpaid.
- Requests, approval by a manager, balances carried forward, and a team calendar.
- Approved leave blocks clock-in reminders for those days.

### Advances and loans

- Salary advance or staff loan, taken back over N payrolls.
- Paid out from Cash, M-Pesa or Bank (books: Staff advances asset / money).

### Payroll run

- Monthly (and weekly for casuals). Draft → reviewed → approved → paid. A run can be locked.
- Gross pay = salary or (days × rate) or (clock-in hours × rate) + allowances + overtime.
- Deductions worked out in the database:
  - **PAYE** with personal relief and insurance relief.
  - **NSSF** (Tier I and Tier II, employee and employer).
  - **SHIF** (Social Health Insurance Fund).
  - **Affordable Housing Levy** (employee and employer).
  - Advances, loans and other deductions.
- **Rates live in a table** (`payroll_rates`, with dates they apply from), never in code. Check every rate against KRA, NSSF and SHA before release and whenever the Finance Act changes them.
- Payslip as PDF or WhatsApp, in the same look as receipts and invoices.
- Exports: KRA P10 (PAYE return CSV for iTax), NSSF and SHA schedules, and a bank or M-Pesa bulk payment file.
- Year-end P9 per employee.

## How it posts to the books

| Event | Debit | Credit |
|---|---|---|
| Payroll approved | Salaries and wages (gross) + employer NSSF, housing levy | Salaries to pay (net), PAYE to pay KRA, NSSF to pay, SHIF to pay, Housing levy to pay, Staff advances (amounts taken back) |
| Salaries paid | Salaries to pay | Bank / M-Pesa / Cash |
| Statutory paid | PAYE / NSSF / SHIF / Housing levy to pay | Bank / M-Pesa |
| Advance given | Staff advances | Money account |

New source types: `payroll_run`, `payroll_payment`, `staff_advance`. The hand-entered "Wages" expense category stays for businesses that don't use payroll.

## Permissions

`payroll.view` and `payroll.manage` (Owner/Admin only by default; salaries are private), `leave.request` (everyone), `leave.approve` (Manager), `staff.contracts` (Owner/Admin).

## Done when

- A month with one salaried, one casual (paid from clock-in) and one person with an advance gives payslips whose deductions match a manual check against current official calculators.
- The books show the right liabilities until KRA, NSSF and SHA are paid.
- The P10 CSV imports into iTax.

## Open questions

- Pay through M-Pesa B2C directly (needs Daraja B2C approval) or export a bulk file only?
- Overtime rules: one rate, or weekday and holiday rates?
- Do riders get commission per delivery as part of pay?
