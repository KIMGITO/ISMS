// End-of-shift report: the figures (a pure function, so it can be tested), the text sent
// to the owners and pasted into WhatsApp, and closing the shift.
import { useAuthStore } from '../stores/authStore';
import { useNotificationStore } from '../stores/notificationStore';
import { NotificationService } from './notifications/notificationService';
import { toUserMessage } from '../utils/userError';
import type { BillOfMaterials, Customer, DebtPayment, Expense, Product, Shift, Transaction } from '../types';
import type { ProductionBatch } from '../stores/extraModulesStore';
import { formatMoney } from '../utils/money';

const TZ = 'Africa/Nairobi';

export interface ShiftReport {
  employeeName: string;
  start: number;
  end: number;
  salesCount: number;
  salesTotal: number;
  cash: number;
  mpesa: number;
  airtel: number;
  card: number;
  bank: number;
  credit: number;
  deliveries: number;
  expensesTotal: number;
  /** Cash sales + cash debt repaid − cash expenses − cash given back on refunds */
  expectedCash: number;
  cashDebtRepaid: number;
  cashExpenses: number;
  /** Refunds this person made during the shift (edits not counted), and all cash given back (out of the drawer). */
  refundsTotal: number;
  cashRefunds: number;
  /** Per product: what it sold and how it was paid. Money is the product's share of each sale's total, so the products add up to the shift totals. */
  products: ProductLine[];
  production: { name: string; produced: number; unit: string; used: string }[];
  creditTaken: { name: string; items: string; amount: number; owesNow: number }[];
  debtRepaid: { name: string; amount: number; method: string; owesNow: number }[];
  expenses: { category: string; amount: number; method: string; note: string }[];
  /** Real money taken in (sales not on credit + debt repaid), per method, biggest first. */
  moneyIn: { method: string; sales: number; debt: number; total: number }[];
  moneyInTotal: number;
  debtRepaidTotal: number;
  /** Products sold this shift that are now at or below their minimum stock. */
  lowStock: { name: string; left: number; unit: string; out: boolean }[];
  /** Everything that happened, in order. */
  timeline: { at: number; kind: 'sale' | 'debt' | 'expense' | 'production'; text: string; amount?: number }[];
}

export interface ProductLine {
  name: string;
  unit: string;
  sold: number;
  /** Sales value (its share of the sale totals) */
  earned: number;
  /** How many sales it was in */
  salesCount: number;
  cash: number;
  till: number;
  /** Paid by Airtel, card or bank */
  otherPaid: number;
  credit: number;
  /** Cash + till + other: money actually taken in for it */
  moneyIn: number;
  left: number | null;
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
  /** Refunds of till sales (any sale, any day); only this person's, made in the shift, count. */
  refunds?: { transactionId: string; date: string; total: number; settlement: string; method: string | null; createdBy: string; edit?: boolean }[];
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

  // An edited sale was redone in the till: the redone sale stands, the original and its
  // take-back are left out, so the report reads as if it was right the first time.
  const edited = new Set((input.refunds || []).filter((r) => r.edit).map((r) => r.transactionId));
  const sales = input.transactions.filter((t) => t.staffId === employee.id && during(time(t.timestamp)) && !edited.has(t.id));
  const leftOut = new Set(input.transactions.filter((t) => edited.has(t.id) && t.staffId === employee.id && during(time(t.timestamp))).map((t) => t.id));
  const report: ShiftReport = {
    employeeName: employee.name,
    start,
    end,
    salesCount: sales.length,
    salesTotal: 0,
    cash: 0,
    mpesa: 0,
    airtel: 0,
    credit: 0,
    card: 0,
    bank: 0,
    deliveries: 0,
    expensesTotal: 0,
    expectedCash: 0,
    cashDebtRepaid: 0,
    cashExpenses: 0,
    refundsTotal: 0,
    cashRefunds: 0,
    products: [],
    production: [],
    creditTaken: [],
    debtRepaid: [],
    expenses: [],
    moneyIn: [],
    moneyInTotal: 0,
    debtRepaidTotal: 0,
    lowStock: [],
    timeline: [],
  };
  const methods = new Map<string, { method: string; sales: number; debt: number; total: number }>();
  const addMoney = (method: string, kind: 'sales' | 'debt', amount: number) => {
    const row = methods.get(method) || { method, sales: 0, debt: 0, total: 0 };
    row[kind] += amount;
    row.total += amount;
    methods.set(method, row);
  };

  const products = new Map<string, ProductLine>();
  const credit = new Map<string, { name: string; items: string[]; amount: number; owesNow: number }>();
  for (const tx of sales) {
    const amount = Number(tx.finalTotal) || 0;
    report.salesTotal += amount;
    if (tx.isDelivery) report.deliveries += 1;
    if (tx.paymentMethod === 'Cash') report.cash += amount;
    else if (tx.paymentMethod === 'M-Pesa') report.mpesa += amount;
    else if (tx.paymentMethod === 'Airtel Money') report.airtel += amount;
    else if (tx.paymentMethod === 'Card') report.card += amount;
    else if (tx.paymentMethod === 'Bank') report.bank += amount;
    else if (tx.paymentMethod === 'Credit' || tx.paymentMethod === 'Credit_Debt') {
      report.credit += amount;
      const key = tx.customerId || tx.customerName || 'unknown';
      const customer = input.customers.find((c) => c.id === tx.customerId);
      const row = credit.get(key) || { name: tx.customerName || customer?.name || 'Unknown customer', items: [], amount: 0, owesNow: customer?.debtBalance || 0 };
      row.amount += amount;
      tx.items.forEach((i) => row.items.push(`${i.quantity} × ${i.product.name}`));
      credit.set(key, row);
    }
    const onCredit = tx.paymentMethod === 'Credit' || tx.paymentMethod === 'Credit_Debt';
    if (!onCredit && amount) addMoney(tx.paymentMethod || 'Other', 'sales', amount);
    const count = tx.items.reduce((n, i) => n + (Number(i.quantity) || 0), 0);
    report.timeline.push({
      at: time(tx.timestamp),
      kind: 'sale',
      text: `Sale${onCredit ? ` on credit to ${tx.customerName || 'customer'}` : ` · ${tx.paymentMethod}`} · ${round(count)} ${count === 1 ? 'item' : 'items'}${tx.isDelivery ? ' · delivery' : ''}`,
      amount,
    });

    // Each product gets its share of the sale's final total (so discounts, fees and tax are spread fairly).
    const lineValue = (i: (typeof tx.items)[number]) => (Number(i.product.price) || 0) * (Number(i.quantity) || 0) * (1 - (i.discountPercentage || 0) / 100);
    const linesTotal = tx.items.reduce((n, i) => n + lineValue(i), 0);
    for (const item of tx.items) {
      const id = item.product.id || item.product.name;
      const product = input.products.find((p) => p.id === item.product.id);
      const row = products.get(id) || { name: item.product.name, unit: product?.unit || item.product.unit || '', sold: 0, earned: 0, salesCount: 0, cash: 0, till: 0, otherPaid: 0, credit: 0, moneyIn: 0, left: product ? product.stock : null };
      const share = linesTotal > 0 ? (amount * lineValue(item)) / linesTotal : amount / tx.items.length;
      row.sold += item.quantity;
      row.earned += share;
      row.salesCount += 1;
      if (onCredit) row.credit += share;
      else {
        row.moneyIn += share;
        if (tx.paymentMethod === 'Cash') row.cash += share;
        else if (tx.paymentMethod === 'M-Pesa') row.till += share;
        else row.otherPaid += share;
      }
      products.set(id, row);
    }
  }
  for (const [id, row] of products) {
    const product = input.products.find((p) => p.id === id);
    if (!product) continue;
    const left = Number(product.stock) || 0;
    const min = Number(product.minStock) || 0;
    if (left <= 0 || (min > 0 && left <= min)) report.lowStock.push({ name: row.name, left: round(left), unit: row.unit, out: left <= 0 });
  }
  report.lowStock.sort((a, b) => Number(b.out) - Number(a.out) || a.left - b.left);
  report.products = [...products.values()]
    .map((p) => ({ ...p, sold: round(p.sold), earned: round(p.earned), cash: round(p.cash), till: round(p.till), otherPaid: round(p.otherPaid), credit: round(p.credit), moneyIn: round(p.moneyIn) }))
    .sort((a, b) => b.earned - a.earned);
  report.creditTaken = [...credit.values()].map((c) => ({ ...c, items: c.items.join(', '), amount: round(c.amount) }));

  for (const batch of input.productionBatches) {
    if (batch.staffName !== employee.name || !during(time(batch.date))) continue;
    const bom = input.billOfMaterials.find((b) => b.id === batch.bomId);
    const used = (bom?.ingredients || [])
      .map((ing) => `${round(ing.quantityRequired * (1 + (ing.wastePercentage || 0) / 100) * batch.quantityProduced)}${ing.unit} ${ing.productName}`)
      .join(', ');
    report.production.push({ name: batch.recipeName, produced: batch.quantityProduced, unit: batch.unit || '', used });
    report.timeline.push({ at: time(batch.date), kind: 'production', text: `Made ${batch.quantityProduced}${batch.unit ? ` ${batch.unit}` : ''} ${batch.recipeName}` });
  }

  for (const dp of input.debtPayments) {
    if (dp.recordedBy !== employee.name || !during(time(dp.created_at))) continue;
    const amount = Number(dp.amountPaid) || 0;
    if (dp.paymentMethod === 'Cash') report.cashDebtRepaid += amount;
    report.debtRepaidTotal += amount;
    if (amount) addMoney(dp.paymentMethod || 'Other', 'debt', amount);
    const name = input.customers.find((c) => c.id === dp.customerId)?.name || 'Unknown customer';
    report.timeline.push({ at: time(dp.created_at), kind: 'debt', text: `${name} paid debt · ${dp.paymentMethod}`, amount });
    report.debtRepaid.push({
      name,
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
    report.timeline.push({ at: time(e.created_at || e.date), kind: 'expense', text: `Expense: ${e.category}${e.description ? ` (${e.description})` : ''} · ${method}`, amount: e.amount });
  }

  // Refunds this person gave: money paid back comes out of what they took in.
  for (const r of input.refunds || []) {
    if (r.createdBy !== employee.name || !during(time(r.date)) || leftOut.has(r.transactionId)) continue;
    // An edit of a sale from an earlier shift: cash still left the drawer, but it is not a refund.
    if (!r.edit) report.refundsTotal += r.total;
    const how = r.settlement === 'refund' ? r.method || 'Cash' : r.settlement === 'wallet' ? 'into wallet' : 'off debt';
    if (r.settlement === 'refund') {
      if (how === 'Cash') report.cashRefunds += r.total;
      addMoney(how, 'sales', -r.total);
    }
    if (!r.edit) report.timeline.push({ at: time(r.date), kind: 'expense', text: `Refund · ${methodLabel(how)}`, amount: r.total });
  }

  // Cash and M-Pesa always show, even at zero, so the owner sees they were checked.
  for (const m of ['Cash', 'M-Pesa']) if (!methods.has(m)) methods.set(m, { method: m, sales: 0, debt: 0, total: 0 });
  report.moneyIn = [...methods.values()]
    .map((m) => ({ ...m, sales: round(m.sales), debt: round(m.debt), total: round(m.total) }))
    // Cash first, then the till, then anything else by size, as the owner reads them.
    .sort((a, b) => { const rank = (m: string) => (m === 'Cash' ? 0 : m === 'M-Pesa' ? 1 : 2); return rank(a.method) - rank(b.method) || b.total - a.total; });
  report.moneyInTotal = round(report.moneyIn.reduce((n, m) => n + m.total, 0));
  report.timeline.sort((a, b) => a.at - b.at);

  for (const key of ['salesTotal', 'cash', 'mpesa', 'airtel', 'card', 'bank', 'credit', 'expensesTotal', 'cashDebtRepaid', 'cashExpenses', 'debtRepaidTotal', 'refundsTotal', 'cashRefunds'] as const) {
    report[key] = round(report[key]);
  }
  report.expectedCash = round(report.cash + report.cashDebtRepaid - report.cashExpenses - report.cashRefunds);
  return report;
}

export const ksh = (n: number) => formatMoney(n);
export const shiftClock = (ms: number) => new Date(ms).toLocaleTimeString('en-KE', { hour: 'numeric', minute: '2-digit', timeZone: TZ });
export function shiftLength(r: Pick<ShiftReport, 'start' | 'end'>): string {
  const mins = Math.max(0, Math.round((r.end - r.start) / 60000));
  return mins >= 60 ? `${Math.floor(mins / 60)}h ${mins % 60}m` : `${mins}m`;
}

/** Things the owner should look at first: cash difference and stock running out. */
export function shiftAttention(r: ShiftReport, countedCash?: number | null): string[] {
  const out: string[] = [];
  if (typeof countedCash === 'number') {
    const diff = round(countedCash - r.expectedCash);
    if (diff < 0) out.push(`Cash short by ${ksh(-diff)}`);
    else if (diff > 0) out.push(`Cash over by ${ksh(diff)}`);
  } else if (r.expectedCash > 0) {
    out.push('Cash in the drawer was not counted');
  }
  r.lowStock.forEach((p) => out.push(p.out ? `${p.name} is out of stock` : `${p.name} is running low (${p.left}${p.unit ? ` ${p.unit}` : ''} left)`));
  return out;
}

/** What the owner calls each payment method. */
export const methodLabel = (m: string) => (m === 'M-Pesa' ? 'Till (M-Pesa)' : m);

const qty = (n: number, unit: string) => `${round(n)}${unit ? ` ${unit}` : ''}`;

/**
 * Plain text for the owners' notification and WhatsApp (*bold* and "- " lists).
 * Order: summary per product, amount made today, needs attention, closing balances, then details.
 */
export function shiftReportText(r: ShiftReport, extra: { countedCash?: number | null; notes?: string } = {}): string {
  const date = new Date(r.end).toLocaleDateString('en-KE', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: TZ });
  const counted = typeof extra.countedCash === 'number' ? extra.countedCash : null;
  const diff = counted === null ? null : round(counted - r.expectedCash);
  const diffText = diff === null ? '' : diff === 0 ? ' (matches)' : diff < 0 ? ` (short by ${ksh(-diff)})` : ` (over by ${ksh(diff)})`;
  const lines: string[] = [];
  const section = (title: string) => { lines.push(''); lines.push(`*${title}*`); };

  lines.push(`*Shift report: ${r.employeeName}*`);
  lines.push(`${date}, ${shiftClock(r.start)} – ${shiftClock(r.end)} (${shiftLength(r)})`);

  section('Summary');
  if (!r.products.length) lines.push('No sales this shift.');
  r.products.forEach((p, i) => {
    if (i) lines.push('');
    lines.push(p.name);
    lines.push(`- Sales: ${ksh(p.earned)} from ${p.salesCount} ${p.salesCount === 1 ? 'sale' : 'sales'} (${qty(p.sold, p.unit)})`);
    const paid = [p.cash ? `cash ${ksh(p.cash)}` : '', p.till ? `till ${ksh(p.till)}` : '', p.otherPaid ? `other ${ksh(p.otherPaid)}` : ''].filter(Boolean).join(', ');
    lines.push(`- Money taken in: ${ksh(p.moneyIn)}${paid ? ` (${paid})` : ''}`);
    if (p.credit) lines.push(`- On credit: ${ksh(p.credit)}`);
  });

  section('Amount made today');
  r.moneyIn.forEach((m) => lines.push(`- ${methodLabel(m.method)}: ${ksh(m.total)}${m.debt ? ` (incl. ${ksh(m.debt)} debt repaid)` : ''}`));
  lines.push(`- Total: ${ksh(r.moneyInTotal)}${r.credit ? `, plus ${ksh(r.credit)} on credit` : ''}`);
  if (r.cashExpenses) lines.push(`- Cash spent: ${ksh(r.cashExpenses)}`);
  if (r.refundsTotal) lines.push(`- Refunds given: ${ksh(r.refundsTotal)}${r.cashRefunds ? ` (${ksh(r.cashRefunds)} in cash)` : ''}`);
  lines.push(`- Cash to hand over: ${ksh(r.expectedCash)}${counted !== null ? `, counted ${ksh(counted)}${diffText}` : ''}`);

  const attention = shiftAttention(r, counted);
  if (attention.length) {
    section('Needs attention');
    attention.forEach((a) => lines.push(`- ${a}`));
  }

  section('Closing balances');
  lines.push(`- Cash in drawer: ${ksh(counted ?? r.expectedCash)}${counted === null ? ' (expected, not counted)' : ''}`);
  const till = r.moneyIn.find((m) => m.method === 'M-Pesa');
  if (till) lines.push(`- Till (M-Pesa) received: ${ksh(till.total)}`);
  r.products.forEach((p) => { if (p.left !== null) lines.push(`- ${p.name}: ${qty(p.left, p.unit)} left`); });

  if (extra.notes?.trim()) {
    section(`Notes from ${r.employeeName}`);
    lines.push(extra.notes.trim());
  }
  if (r.creditTaken.length) {
    section(`Credit given (${ksh(r.credit)})`);
    r.creditTaken.forEach((c) => lines.push(`- ${c.name}: ${ksh(c.amount)} (${c.items}) | now owes ${ksh(c.owesNow)}`));
  }
  if (r.debtRepaid.length) {
    section(`Debt repaid (${ksh(r.debtRepaidTotal)})`);
    r.debtRepaid.forEach((d) => lines.push(`- ${d.name}: ${ksh(d.amount)} by ${methodLabel(d.method)} | still owes ${ksh(d.owesNow)}`));
  }
  if (r.expenses.length) {
    section(`Expenses (${ksh(r.expensesTotal)})`);
    r.expenses.forEach((e) => lines.push(`- ${e.category}: ${ksh(e.amount)} (${methodLabel(e.method)})${e.note ? `, ${e.note}` : ''}`));
  }
  if (r.production.length) {
    section('Production');
    r.production.forEach((b) => lines.push(`- ${b.name}: ${b.produced}${b.unit ? ` ${b.unit}` : ''}${b.used ? ` | used ${b.used}` : ''}`));
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
