// End-of-shift report: the figures (a pure function, so it can be tested), the text sent
// to the owners and pasted into WhatsApp, and closing the shift.
import { useAuthStore } from '../stores/authStore';
import { useNotificationStore } from '../stores/notificationStore';
import { NotificationService } from './notifications/notificationService';
import { toUserMessage } from '../utils/userError';
import type { BillOfMaterials, Customer, DebtPayment, Expense, Product, Shift, Transaction } from '../types';
import type { ProductionBatch } from '../stores/extraModulesStore';

const TZ = 'Africa/Nairobi';

export interface ShiftReport {
  employeeName: string;
  start: number;
  end: number;
  salesCount: number;
  salesTotal: number;
  cash: number;
  mpesa: number;
  credit: number;
  other: number;
  deliveries: number;
  expensesTotal: number;
  /** Cash sales + cash debt repaid − cash expenses */
  expectedCash: number;
  cashDebtRepaid: number;
  cashExpenses: number;
  products: { name: string; unit: string; sold: number; earned: number; left: number | null }[];
  production: { name: string; produced: number; unit: string; used: string }[];
  creditTaken: { name: string; items: string; amount: number; owesNow: number }[];
  debtRepaid: { name: string; amount: number; method: string; owesNow: number }[];
  expenses: { category: string; amount: number; method: string; note: string }[];
}

export interface ShiftReportInput {
  shift: Pick<Shift, 'startTime' | 'endTime'>;
  employee: { id: string; name: string };
  transactions: Transaction[];
  debtPayments: DebtPayment[];
  expenses: Expense[];
  products: Product[];
  customers: Customer[];
  productionBatches: ProductionBatch[];
  billOfMaterials: BillOfMaterials[];
  now?: number;
}

const round = (n: number) => Math.round(n * 100) / 100;
const time = (v: string | undefined | null) => {
  const t = v ? new Date(v).getTime() : NaN;
  return Number.isFinite(t) ? t : NaN;
};

export function buildShiftReport(input: ShiftReportInput): ShiftReport {
  const { shift, employee } = input;
  const start = time(shift.startTime);
  const end = shift.endTime ? time(shift.endTime) : input.now ?? Date.now();
  const during = (t: number) => t >= start && t <= end;

  const sales = input.transactions.filter((t) => t.staffId === employee.id && during(time(t.timestamp)));
  const report: ShiftReport = {
    employeeName: employee.name,
    start,
    end,
    salesCount: sales.length,
    salesTotal: 0,
    cash: 0,
    mpesa: 0,
    credit: 0,
    other: 0,
    deliveries: 0,
    expensesTotal: 0,
    expectedCash: 0,
    cashDebtRepaid: 0,
    cashExpenses: 0,
    products: [],
    production: [],
    creditTaken: [],
    debtRepaid: [],
    expenses: [],
  };

  const products = new Map<string, { name: string; unit: string; sold: number; earned: number; left: number | null }>();
  const credit = new Map<string, { name: string; items: string[]; amount: number; owesNow: number }>();
  for (const tx of sales) {
    const amount = Number(tx.finalTotal) || 0;
    report.salesTotal += amount;
    if (tx.isDelivery) report.deliveries += 1;
    if (tx.paymentMethod === 'Cash') report.cash += amount;
    else if (tx.paymentMethod === 'M-Pesa' || tx.paymentMethod === 'Mobile_Wallet') report.mpesa += amount;
    else if (tx.paymentMethod === 'Credit' || tx.paymentMethod === 'Credit_Debt') {
      report.credit += amount;
      const key = tx.customerId || tx.customerName || 'unknown';
      const customer = input.customers.find((c) => c.id === tx.customerId);
      const row = credit.get(key) || { name: tx.customerName || customer?.name || 'Unknown customer', items: [], amount: 0, owesNow: customer?.debtBalance || 0 };
      row.amount += amount;
      tx.items.forEach((i) => row.items.push(`${i.quantity} × ${i.product.name}`));
      credit.set(key, row);
    } else report.other += amount;

    for (const item of tx.items) {
      const id = item.product.id || item.product.name;
      const product = input.products.find((p) => p.id === item.product.id);
      const row = products.get(id) || { name: item.product.name, unit: product?.unit || item.product.unit || '', sold: 0, earned: 0, left: product ? product.stock : null };
      row.sold += item.quantity;
      row.earned += item.product.price * item.quantity * (1 - (item.discountPercentage || 0) / 100);
      products.set(id, row);
    }
  }
  report.products = [...products.values()]
    .map((p) => ({ ...p, sold: round(p.sold), earned: round(p.earned) }))
    .sort((a, b) => b.earned - a.earned);
  report.creditTaken = [...credit.values()].map((c) => ({ ...c, items: c.items.join(', '), amount: round(c.amount) }));

  for (const batch of input.productionBatches) {
    if (batch.staffName !== employee.name || !during(time(batch.date))) continue;
    const bom = input.billOfMaterials.find((b) => b.id === batch.bomId);
    const used = (bom?.ingredients || [])
      .map((ing) => `${round(ing.quantityRequired * (1 + (ing.wastePercentage || 0) / 100) * batch.quantityProduced)}${ing.unit} ${ing.productName}`)
      .join(', ');
    report.production.push({ name: batch.recipeName, produced: batch.quantityProduced, unit: batch.unit || '', used });
  }

  for (const dp of input.debtPayments) {
    if (dp.recordedBy !== employee.name || !during(time(dp.created_at))) continue;
    const amount = Number(dp.amountPaid) || 0;
    if (dp.paymentMethod === 'Cash') report.cashDebtRepaid += amount;
    report.debtRepaid.push({
      name: input.customers.find((c) => c.id === dp.customerId)?.name || 'Unknown customer',
      amount,
      method: dp.paymentMethod,
      owesNow: Number(dp.remainingDebt) || 0,
    });
  }

  for (const e of input.expenses) {
    if (!during(time(e.created_at || e.date))) continue;
    const method = e.paymentMethod || 'Cash';
    report.expensesTotal += e.amount;
    if (method === 'Cash') report.cashExpenses += e.amount;
    report.expenses.push({ category: e.category, amount: e.amount, method, note: e.description || '' });
  }

  for (const key of ['salesTotal', 'cash', 'mpesa', 'credit', 'other', 'expensesTotal', 'cashDebtRepaid', 'cashExpenses'] as const) {
    report[key] = round(report[key]);
  }
  report.expectedCash = round(report.cash + report.cashDebtRepaid - report.cashExpenses);
  return report;
}

export const ksh = (n: number) => `KSh ${Math.round(n).toLocaleString('en-KE')}`;
export const shiftClock = (ms: number) => new Date(ms).toLocaleTimeString('en-KE', { hour: 'numeric', minute: '2-digit', timeZone: TZ });
export function shiftLength(r: Pick<ShiftReport, 'start' | 'end'>): string {
  const mins = Math.max(0, Math.round((r.end - r.start) / 60000));
  return mins >= 60 ? `${Math.floor(mins / 60)}h ${mins % 60}m` : `${mins}m`;
}

/** Plain text for the owners' notification and WhatsApp (*bold* and "- " lists). */
export function shiftReportText(r: ShiftReport, extra: { countedCash?: number | null; notes?: string } = {}): string {
  const date = new Date(r.end).toLocaleDateString('en-KE', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: TZ });
  const lines: string[] = [];
  lines.push(`*Shift report: ${r.employeeName}*`);
  lines.push(`${date}, ${shiftClock(r.start)} – ${shiftClock(r.end)} (${shiftLength(r)})`);
  lines.push('');
  lines.push('*Sales*');
  lines.push(`- Total: ${ksh(r.salesTotal)} from ${r.salesCount} ${r.salesCount === 1 ? 'sale' : 'sales'}`);
  lines.push(`- Cash: ${ksh(r.cash)}`);
  lines.push(`- M-Pesa: ${ksh(r.mpesa)}`);
  if (r.credit) lines.push(`- On credit: ${ksh(r.credit)}`);
  if (r.other) lines.push(`- Card/bank/other: ${ksh(r.other)}`);
  if (r.deliveries) lines.push(`- Deliveries: ${r.deliveries}`);
  lines.push('');
  lines.push('*Cash drawer*');
  lines.push(`- Expected: ${ksh(r.expectedCash)}`);
  if (r.cashDebtRepaid || r.cashExpenses) {
    lines.push(`  cash sales ${ksh(r.cash)} + debt repaid ${ksh(r.cashDebtRepaid)} − expenses ${ksh(r.cashExpenses)}`);
  }
  if (typeof extra.countedCash === 'number') {
    const diff = round(extra.countedCash - r.expectedCash);
    lines.push(`- Counted: ${ksh(extra.countedCash)}${diff === 0 ? ' (matches)' : diff < 0 ? ` (short by ${ksh(-diff)})` : ` (over by ${ksh(diff)})`}`);
  }
  if (r.products.length) {
    lines.push('');
    lines.push('*Products sold*');
    r.products.forEach((p) => {
      const unit = p.unit ? ` ${p.unit}` : '';
      lines.push(`- ${p.name}: ${p.sold}${unit} | ${ksh(p.earned)}${p.left !== null ? ` | ${round(p.left)}${unit} left` : ''}`);
    });
  }
  if (r.production.length) {
    lines.push('');
    lines.push('*Production*');
    r.production.forEach((b) => lines.push(`- ${b.name}: ${b.produced}${b.unit ? ` ${b.unit}` : ''}${b.used ? ` | used ${b.used}` : ''}`));
  }
  if (r.creditTaken.length) {
    lines.push('');
    lines.push('*Credit given*');
    r.creditTaken.forEach((c) => lines.push(`- ${c.name}: ${ksh(c.amount)} (${c.items}) | owes ${ksh(c.owesNow)}`));
  }
  if (r.debtRepaid.length) {
    lines.push('');
    lines.push('*Debt repaid*');
    r.debtRepaid.forEach((d) => lines.push(`- ${d.name}: ${ksh(d.amount)} by ${d.method} | still owes ${ksh(d.owesNow)}`));
  }
  if (r.expenses.length) {
    lines.push('');
    lines.push(`*Expenses (${ksh(r.expensesTotal)})*`);
    r.expenses.forEach((e) => lines.push(`- ${e.category}: ${ksh(e.amount)} (${e.method})${e.note ? `, ${e.note}` : ''}`));
  }
  if (extra.notes?.trim()) {
    lines.push('');
    lines.push('*Notes*');
    lines.push(extra.notes.trim());
  }
  return lines.join('\n');
}

/**
 * Closes the active shift, then sends the report to the owners.
 * Returns false (and says why) when the shift could not be closed, so nothing is lost.
 */
export async function finishShift(reportText: string, notes: string): Promise<boolean> {
  const { currentEmployee: employee, punchOut } = useAuthStore.getState();
  const closed = await punchOut();
  if (!closed) return false;

  try {
    // Saved for the owners' notification feed; the database webhook sends the push.
    NotificationService.createNotification(
      'Custom Notification',
      { message: `${employee?.name || 'Staff'} ended their shift.${notes.trim() ? `\nNotes: ${notes.trim()}` : ''}` },
      {
        title: `Shift ended: ${employee?.name || 'Staff'}`,
        role: 'Owner',
        priority: 'high',
        payloadExtra: {
          reportText,
          customMessage: notes,
          employeeName: employee?.name || 'Staff',
          employeeId: employee?.id || '',
          closedAt: new Date().toISOString(),
        },
      },
    );
    useNotificationStore.getState().showToast('Shift ended', 'Your report was sent to the owners.', undefined, 'success');
  } catch (err) {
    // The shift is closed either way; only the report didn't go out.
    useNotificationStore.getState().showToast(
      'Shift ended, report not sent',
      toUserMessage(err, 'Copy the report and send it on WhatsApp instead.'),
      undefined,
      'info',
    );
  }
  return true;
}
