// Daily / monthly stock report: per product, what was there, what came in, where it went and
// what was paid, the way owners already write it on WhatsApp ("Opening 34.5, Sales 3,
// Colors 10, Added 250 ... Closed 107, Till 5040, Not paid ..."), but worked out from the
// records. The figures come from the database (stock_period_report); this file turns them
// into the report (a pure function, so it can be tested) and the text that is shared.
import { getSupabase } from './supabaseClient';
import { toUuid } from '../utils/idUtils';
import { methodLabel } from '../utils/paymentMethods';
import { formatMoney } from '../utils/money';

export const REPORT_TZ = 'Africa/Nairobi';

export interface RawStockProduct {
  id: string;
  name: string;
  unit: string;
  price: number;
  stockNow: number;
  opening: number;
  closing: number;
  received: number;
  returned: number;
  fromBranches: number;
  toBranches: number;
  made: number;
  used: number;
  waste: number;
  toSupplier: number;
  soldLogged: number;
  counted: number;
  changes: number;
}

export interface RawSaleGroup {
  productId: string;
  customerId: string | null;
  customerName: string | null;
  customerType: string | null;
  method: string;
  delivery: boolean;
  qty: number;
  value: number;
  sales: number;
}

export interface RawStockReport {
  products: RawStockProduct[];
  sales: RawSaleGroup[];
  debts: { id: string; name: string; owes: number }[];
}

/** One line of where stock went or came from: "Zimmer 75". */
export interface ReportLine {
  label: string;
  qty: number;
  value?: number;
}

export interface StockReportProduct {
  id: string;
  name: string;
  unit: string;
  opening: number;
  closing: number;
  /** Stock in, biggest first, zeros left out. */
  added: ReportLine[];
  /** Stock out, in the order owners read it: counter sales, delivery, each big buyer, then the rest. */
  out: ReportLine[];
  /** Everything sold (all customers), and what it was worth. */
  soldQty: number;
  soldValue: number;
  /** Opening + in − out: what should be there. */
  expected: number;
  /** closing − expected: below zero means stock is missing. */
  difference: number;
  /** Paid per method (M-Pesa, Cash, ...), biggest first. */
  paid: ReportLine[];
  paidTotal: number;
  /** Sold on credit, per customer. */
  notPaid: ReportLine[];
  notPaidTotal: number;
}

export interface StockReport {
  products: StockReportProduct[];
  /** Who owes money now. */
  debts: { name: string; owes: number }[];
  debtsTotal: number;
  /** All products together. */
  paidByMethod: ReportLine[];
  paidTotal: number;
  notPaidTotal: number;
}

export interface BuildOptions {
  /** Show only these products (in this order). Empty or missing: every product that moved. */
  productIds?: string[];
  /** Customers of these types get their own line (Zimmer 75); everyone else is counted in Sales. */
  ownLineTypes?: string[];
  /** Put big buyers together by their type ("Institutions 554") instead of by name, e.g. for a month. */
  groupBuyersByType?: boolean;
}

const BIG_BUYER_TYPES = ['institution', 'business'];
const TYPE_PLURAL: Record<string, string> = { institution: 'Institutions', business: 'Businesses', individual: 'Individuals', other: 'Others' };
const CREDIT = new Set(['Credit', 'Credit_Debt']);

const r3 = (n: number) => Math.round(n * 1000) / 1000;
const r2 = (n: number) => Math.round(n * 100) / 100;
const num = (v: unknown) => (v === null || v === undefined || v === '' ? 0 : Number(v) || 0);

export function normalizeRaw(data: any): RawStockReport {
  return {
    products: (data?.products || []).map((p: any) => ({
      id: p.id,
      name: p.name || 'Product',
      unit: p.unit || '',
      price: num(p.price),
      stockNow: num(p.stockNow),
      opening: num(p.opening),
      closing: num(p.closing),
      received: num(p.received),
      returned: num(p.returned),
      fromBranches: num(p.fromBranches),
      toBranches: num(p.toBranches),
      made: num(p.made),
      used: num(p.used),
      waste: num(p.waste),
      toSupplier: num(p.toSupplier),
      soldLogged: num(p.soldLogged),
      counted: num(p.counted),
      changes: num(p.changes),
    })),
    sales: (data?.sales || []).map((s: any) => ({
      productId: s.productId,
      customerId: s.customerId ?? null,
      customerName: s.customerName ?? null,
      customerType: s.customerType ?? null,
      method: s.method || 'Cash',
      delivery: !!s.delivery,
      qty: num(s.qty),
      value: num(s.value),
      sales: num(s.sales),
    })),
    debts: (data?.debts || []).map((d: any) => ({ id: d.id, name: d.name || 'Customer', owes: num(d.owes) })),
  };
}

function addTo(map: Map<string, ReportLine>, label: string, qty: number, value = 0) {
  const row = map.get(label) || { label, qty: 0, value: 0 };
  row.qty += qty;
  row.value = (row.value || 0) + value;
  map.set(label, row);
}

const tidy = (lines: Iterable<ReportLine>) =>
  [...lines].map((l) => ({ ...l, qty: r3(l.qty), value: l.value === undefined ? undefined : r2(l.value) })).filter((l) => l.qty !== 0 || (l.value || 0) !== 0);

export function buildStockReport(raw: RawStockReport, opts: BuildOptions = {}): StockReport {
  const ownTypes = new Set(opts.ownLineTypes ?? BIG_BUYER_TYPES);
  const salesBy = new Map<string, RawSaleGroup[]>();
  for (const s of raw.sales) {
    const list = salesBy.get(s.productId) || [];
    list.push(s);
    salesBy.set(s.productId, list);
  }

  const chosen = opts.productIds?.length
    ? opts.productIds.map((id) => raw.products.find((p) => p.id === id)).filter((p): p is RawStockProduct => !!p)
    : raw.products.filter((p) => p.changes > 0 || salesBy.has(p.id));

  const allPaid = new Map<string, ReportLine>();
  let notPaidAll = 0;

  const products = chosen.map((p): StockReportProduct => {
    const sales = salesBy.get(p.id) || [];
    let counter = 0;
    let counterValue = 0;
    let delivery = 0;
    let deliveryValue = 0;
    const buyers = new Map<string, ReportLine>();
    const paid = new Map<string, ReportLine>();
    const notPaid = new Map<string, ReportLine>();
    for (const s of sales) {
      const name = s.customerName?.trim() || '';
      const big = !!name && !!s.customerType && ownTypes.has(s.customerType);
      if (big) addTo(buyers, opts.groupBuyersByType ? TYPE_PLURAL[s.customerType!] || 'Customers' : name, s.qty, s.value);
      else if (s.delivery) {
        delivery += s.qty;
        deliveryValue += s.value;
      } else {
        counter += s.qty;
        counterValue += s.value;
      }
      if (CREDIT.has(s.method)) addTo(notPaid, name || 'No name', s.qty, s.value);
      else {
        addTo(paid, methodLabel(s.method), 0, s.value);
        addTo(allPaid, methodLabel(s.method), 0, s.value);
      }
    }
    const soldQty = sales.reduce((n, s) => n + s.qty, 0);
    const soldValue = sales.reduce((n, s) => n + s.value, 0);

    const added = tidy([
      { label: 'Received', qty: p.received },
      { label: 'From branches', qty: p.fromBranches },
      { label: 'Made', qty: p.made },
      { label: 'Returned by customers', qty: p.returned },
    ]).sort((a, b) => b.qty - a.qty);

    const out = tidy([
      { label: 'Sales', qty: counter, value: counterValue },
      { label: 'Delivery', qty: delivery, value: deliveryValue },
      ...[...buyers.values()].sort((a, b) => b.qty - a.qty),
      { label: 'Used in production', qty: p.used },
      { label: 'Sent to branches', qty: p.toBranches },
      { label: 'Waste', qty: p.waste },
      { label: 'Back to supplier', qty: p.toSupplier },
    ]);

    const inQty = added.reduce((n, l) => n + l.qty, 0);
    const outQty = out.reduce((n, l) => n + l.qty, 0);
    const expected = r3(p.opening + inQty - outQty);
    const paidLines = tidy(paid.values()).sort((a, b) => (b.value || 0) - (a.value || 0));
    const notPaidLines = tidy(notPaid.values()).sort((a, b) => b.qty - a.qty);
    const notPaidTotal = r2(notPaidLines.reduce((n, l) => n + (l.value || 0), 0));
    notPaidAll += notPaidTotal;
    return {
      id: p.id,
      name: p.name,
      unit: p.unit,
      opening: r3(p.opening),
      closing: r3(p.closing),
      added,
      out,
      soldQty: r3(soldQty),
      soldValue: r2(soldValue),
      expected,
      difference: r3(p.closing - expected),
      paid: paidLines,
      paidTotal: r2(paidLines.reduce((n, l) => n + (l.value || 0), 0)),
      notPaid: notPaidLines,
      notPaidTotal,
    };
  });

  // Cash and M-Pesa always show, so the owner sees they were checked.
  for (const m of ['M-Pesa', 'Cash']) if (!allPaid.has(m) && products.length) allPaid.set(m, { label: m, qty: 0, value: 0 });
  const paidByMethod = [...allPaid.values()].map((l) => ({ ...l, value: r2(l.value || 0) })).sort((a, b) => (b.value || 0) - (a.value || 0));
  const debts = raw.debts.filter((d) => d.owes > 0).map((d) => ({ name: d.name, owes: r2(d.owes) }));
  return {
    products,
    debts,
    debtsTotal: r2(debts.reduce((n, d) => n + d.owes, 0)),
    paidByMethod,
    paidTotal: r2(paidByMethod.reduce((n, l) => n + (l.value || 0), 0)),
    notPaidTotal: r2(notPaidAll),
  };
}

// ---------------------------------------------------------------------------
// Periods (Kenya time)
// ---------------------------------------------------------------------------

export type PeriodKind = 'day' | 'month' | 'custom';

/** "2026-11-18" in Kenya time. */
export const kenyaDateKey = (d: Date = new Date()) => d.toLocaleDateString('en-CA', { timeZone: REPORT_TZ });

/** Start of a Kenya day (Kenya has no daylight saving: always +03:00). */
export const kenyaDayStart = (key: string) => new Date(`${key}T00:00:00+03:00`);

export function addDays(key: string, days: number): string {
  const d = kenyaDayStart(key);
  return kenyaDateKey(new Date(d.getTime() + days * 864e5 + 3 * 36e5));
}

/** [from, to) for a period. month is "2026-11"; custom uses from/to day keys, both days included. */
export function periodRange(kind: PeriodKind, value: { day?: string; month?: string; from?: string; to?: string }): { from: Date; to: Date } {
  if (kind === 'month') {
    const month = value.month || kenyaDateKey().slice(0, 7);
    const [y, m] = month.split('-').map(Number);
    const next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
    return { from: kenyaDayStart(`${month}-01`), to: kenyaDayStart(`${next}-01`) };
  }
  if (kind === 'custom') {
    const a = value.from || kenyaDateKey();
    const b = value.to || a;
    const [first, last] = a <= b ? [a, b] : [b, a];
    return { from: kenyaDayStart(first), to: kenyaDayStart(addDays(last, 1)) };
  }
  const day = value.day || kenyaDateKey();
  return { from: kenyaDayStart(day), to: kenyaDayStart(addDays(day, 1)) };
}

export function periodTitle(kind: PeriodKind, value: { day?: string; month?: string; from?: string; to?: string }): string {
  const fmt = (key: string, o: Intl.DateTimeFormatOptions) => kenyaDayStart(key).toLocaleDateString('en-KE', { ...o, timeZone: REPORT_TZ });
  if (kind === 'month') return fmt(`${value.month || kenyaDateKey().slice(0, 7)}-01`, { month: 'long', year: 'numeric' });
  if (kind === 'custom') {
    const { from, to } = periodRange('custom', value);
    const a = kenyaDateKey(from);
    const b = kenyaDateKey(new Date(to.getTime() - 1));
    return a === b ? fmt(a, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }) : `${fmt(a, { day: 'numeric', month: 'short' })} – ${fmt(b, { day: 'numeric', month: 'short', year: 'numeric' })}`;
  }
  return fmt(value.day || kenyaDateKey(), { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
}

export async function fetchStockReport(businessId: string, from: Date, to: Date): Promise<RawStockReport> {
  const { data, error } = await getSupabase().rpc('stock_period_report', {
    p_business_id: toUuid(businessId),
    p_from: from.toISOString(),
    p_to: to.toISOString(),
  });
  if (error) throw error;
  return normalizeRaw(data);
}

// ---------------------------------------------------------------------------
// The text for WhatsApp and the owner's notification
// ---------------------------------------------------------------------------

const q = (n: number) => String(r3(n));
const ksh = (n: number) => formatMoney(n);

export function stockReportText(report: StockReport, meta: { title: string; branch: string; period: string; notes?: string }): string {
  const lines: string[] = [`*${meta.title} · ${meta.period}*`, meta.branch, ''];
  for (const p of report.products) {
    const unit = p.unit ? ` (${p.unit})` : '';
    lines.push(`*${p.name}${unit}*`);
    lines.push(`Opening: ${q(p.opening)}`);
    for (const l of p.added) lines.push(`+ ${l.label}: ${q(l.qty)}`);
    for (const l of p.out) lines.push(`- ${l.label}: ${q(l.qty)}`);
    const diff = p.difference;
    lines.push(`Closed: ${q(p.closing)}${diff ? ` (${diff < 0 ? `${q(-diff)} short` : `${q(diff)} over`} of ${q(p.expected)} expected)` : ''}`);
    if (p.paid.length) lines.push(`Paid: ${p.paid.map((l) => `${l.label} ${ksh(l.value || 0)}`).join(' · ')}`);
    if (p.notPaid.length) {
      lines.push('Not paid:');
      p.notPaid.forEach((l, i) => lines.push(`${i + 1}. ${l.label} ${q(l.qty)}${l.value ? ` (${ksh(l.value)})` : ''}`));
    }
    lines.push('');
  }
  if (report.products.length > 1 || report.notPaidTotal) {
    lines.push('*Money*');
    for (const l of report.paidByMethod) lines.push(`${l.label}: ${ksh(l.value || 0)}`);
    lines.push(`Total paid: ${ksh(report.paidTotal)}`);
    if (report.notPaidTotal) lines.push(`Not paid: ${ksh(report.notPaidTotal)}`);
    lines.push('');
  }
  if (report.debts.length) {
    lines.push('*Pending bills (owed now)*');
    report.debts.forEach((d, i) => lines.push(`${i + 1}. ${d.name} ${ksh(d.owes)}`));
    lines.push(`Total: ${ksh(report.debtsTotal)}`, '');
  }
  if (meta.notes?.trim()) lines.push('*Notes*', meta.notes.trim(), '');
  return lines.join('\n').trim();
}
