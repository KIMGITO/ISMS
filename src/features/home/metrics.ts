// src/features/home/metrics.ts
// The numbers behind the Home screen. Pure functions only, so they can be tested.

import type { Transaction, Expense, DebtPayment, Payment, Product } from "../../types";

export type RangeKey = "today" | "yesterday" | "last7" | "last30" | "month" | "quarter" | "year" | "custom";
export type Granularity = "hour" | "day" | "week" | "month";

export interface DateRange {
  start: Date;
  end: Date;
}

export const RANGE_LABELS: Record<RangeKey, string> = {
  today: "Today",
  yesterday: "Yesterday",
  last7: "7 days",
  last30: "30 days",
  month: "This month",
  quarter: "This quarter",
  year: "This year",
  custom: "Custom",
};

const DAY = 24 * 60 * 60 * 1000;

function startOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function endOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

/** Parses a yyyy-mm-dd input value as a local date (new Date("yyyy-mm-dd") would be UTC). */
export function parseDateInput(value: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

export function toDateInput(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** The chosen period. "This month" etc. run to the end of today, not the end of the month. */
export function getRange(key: RangeKey, now = new Date(), customStart?: string, customEnd?: string): DateRange {
  const end = endOfDay(now);
  switch (key) {
    case "today":
      return { start: startOfDay(now), end };
    case "yesterday": {
      const y = new Date(now.getTime() - DAY);
      return { start: startOfDay(y), end: endOfDay(y) };
    }
    case "last7":
      return { start: startOfDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6)), end };
    case "last30":
      return { start: startOfDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 29)), end };
    case "month":
      return { start: new Date(now.getFullYear(), now.getMonth(), 1), end };
    case "quarter":
      return { start: new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1), end };
    case "year":
      return { start: new Date(now.getFullYear(), 0, 1), end };
    case "custom": {
      const s = customStart ? parseDateInput(customStart) : null;
      const e = customEnd ? parseDateInput(customEnd) : null;
      const start = s ? startOfDay(s) : startOfDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 29));
      const finish = e ? endOfDay(e) : end;
      return finish < start ? { start: startOfDay(finish), end: endOfDay(start) } : { start, end: finish };
    }
  }
}

/** The period of the same length just before `range`, used for growth rates. */
export function previousRange(range: DateRange): DateRange {
  const length = range.end.getTime() - range.start.getTime() + 1;
  return { start: new Date(range.start.getTime() - length), end: new Date(range.start.getTime() - 1) };
}

export function inRange(ts: number, range: DateRange) {
  return ts >= range.start.getTime() && ts <= range.end.getTime();
}

export function pickGranularity(range: DateRange): Granularity {
  const days = (range.end.getTime() - range.start.getTime()) / DAY;
  if (days <= 2) return "hour";
  if (days <= 62) return "day";
  if (days <= 200) return "week";
  return "month";
}

export interface Bucket {
  start: number;
  end: number;
  label: string;
  /** Longer label for tooltips and the play readout. */
  fullLabel: string;
}

function nextStart(d: Date, g: Granularity): Date {
  const x = new Date(d);
  if (g === "hour") x.setHours(x.getHours() + 1);
  else if (g === "day") x.setDate(x.getDate() + 1);
  else if (g === "week") x.setDate(x.getDate() + 7);
  else x.setMonth(x.getMonth() + 1, 1);
  return x;
}

function labelFor(d: Date, g: Granularity, multiDay: boolean): { label: string; fullLabel: string } {
  if (g === "hour") {
    const hour = d.toLocaleTimeString(undefined, { hour: "numeric" });
    const day = d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
    return { label: multiDay ? `${d.toLocaleDateString(undefined, { weekday: "short" })} ${hour}` : hour, fullLabel: `${day}, ${hour}` };
  }
  if (g === "month") {
    return {
      label: d.toLocaleDateString(undefined, { month: "short" }),
      fullLabel: d.toLocaleDateString(undefined, { month: "long", year: "numeric" }),
    };
  }
  const label = d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
  const full = d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short", year: "numeric" });
  return { label, fullLabel: g === "week" ? `Week of ${full}` : full };
}

/** Consecutive slots covering the whole range. Weeks start on the range's first day. */
export function makeBuckets(range: DateRange, g: Granularity): Bucket[] {
  const buckets: Bucket[] = [];
  const multiDay = range.end.getTime() - range.start.getTime() > DAY;
  let cursor = new Date(range.start);
  if (g === "month") cursor = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
  while (cursor.getTime() <= range.end.getTime() && buckets.length < 500) {
    const next = nextStart(cursor, g);
    const start = Math.max(cursor.getTime(), range.start.getTime());
    buckets.push({ start, end: Math.min(next.getTime() - 1, range.end.getTime()), ...labelFor(cursor, g, multiDay) });
    cursor = next;
  }
  return buckets;
}

export function bucketIndex(ts: number, buckets: Bucket[]): number {
  let lo = 0;
  let hi = buckets.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (ts < buckets[mid].start) hi = mid - 1;
    else if (ts > buckets[mid].end) lo = mid + 1;
    else return mid;
  }
  return -1;
}

export function txAmount(t: Pick<Transaction, "finalTotal" | "total">): number {
  if (Number.isFinite(t.finalTotal)) return t.finalTotal;
  return Number.isFinite(t.total) ? t.total : 0;
}

export function txTime(t: Pick<Transaction, "timestamp">): number {
  const ts = new Date(t.timestamp).getTime();
  return Number.isFinite(ts) ? ts : NaN;
}

/** Cost of the goods in a sale, from each product's recorded cost. */
export function txCost(t: Transaction): number {
  if (!Array.isArray(t.items)) return 0;
  return t.items.reduce((sum, line) => sum + (line.product?.cost || 0) * (line.quantity || 0), 0);
}

export type MethodKey = "M-Pesa" | "Cash" | "Card" | "Bank" | "Credit";
export const METHODS: MethodKey[] = ["M-Pesa", "Cash", "Card", "Bank", "Credit"];

export function methodOf(raw: string | undefined): MethodKey {
  const m = (raw || "").toLowerCase();
  if (m.includes("credit") || m.includes("debt")) return "Credit";
  if (m.includes("pesa") || m.includes("wallet") || m.includes("mobile")) return "M-Pesa";
  if (m.includes("card")) return "Card";
  if (m.includes("bank") || m.includes("transfer")) return "Bank";
  return "Cash";
}

/** Growth from `prev` to `cur` as a percentage, or null when there is nothing to compare with. */
export function growth(cur: number, prev: number): number | null {
  if (!prev) return null;
  return ((cur - prev) / Math.abs(prev)) * 100;
}

export interface SeriesPoint {
  label: string;
  fullLabel: string;
  sales: number;
  orders: number;
  cost: number;
  expenses: number;
  profit: number;
  /** Sales in the same slot of the previous period, for comparison. */
  prevSales: number;
}

export interface Snapshot {
  sales: number;
  orders: number;
  cost: number;
  expenses: number;
  profit: number;
  creditSales: number;
  received: Record<MethodKey, number>;
  products: Map<string, { name: string; qty: number; revenue: number }>;
  expenseCategories: Map<string, number>;
  hours: number[];
}

function emptySnapshot(): Snapshot {
  return {
    sales: 0,
    orders: 0,
    cost: 0,
    expenses: 0,
    profit: 0,
    creditSales: 0,
    received: { "M-Pesa": 0, Cash: 0, Card: 0, Bank: 0, Credit: 0 },
    products: new Map(),
    expenseCategories: new Map(),
    hours: Array(24).fill(0),
  };
}

export function expenseGroup(category: string | undefined): string {
  const c = (category || "").toLowerCase();
  if (c.includes("rent")) return "Rent";
  if (c.includes("wage") || c.includes("salar") || c.includes("labor") || c.includes("staff")) return "Wages";
  if (c.includes("transport") || c.includes("fuel") || c.includes("travel") || c.includes("logistic")) return "Transport";
  if (c.includes("utilit") || c.includes("electric") || c.includes("water") || c.includes("power")) return "Utilities";
  if (c.includes("repair") || c.includes("mainten")) return "Repairs";
  if (c.includes("market") || c.includes("advert")) return "Marketing";
  if (c.includes("stock") || c.includes("supplier") || c.includes("purchase")) return "Stock purchases";
  return category?.trim() ? category.trim() : "Other";
}

export interface DashboardInput {
  transactions: Transaction[];
  expenses: Expense[];
  debtPayments: DebtPayment[];
  payments: Payment[];
}

/**
 * Every figure for the range, per slot. `cumulative[i]` holds totals from the start of the
 * range to the end of slot i, so a chart can be replayed slot by slot.
 */
export function analyse(input: DashboardInput, range: DateRange, buckets: Bucket[]) {
  const prev = previousRange(range);
  const prevBuckets = buckets.map((b) => ({ ...b, start: b.start - (range.start.getTime() - prev.start.getTime()), end: b.end - (range.start.getTime() - prev.start.getTime()) }));
  const perSlot: Snapshot[] = buckets.map(() => emptySnapshot());
  const previous = emptySnapshot();
  const prevSlotSales = buckets.map(() => 0);

  for (const t of input.transactions) {
    const ts = txTime(t);
    if (!Number.isFinite(ts)) continue;
    const amount = txAmount(t);
    const cost = txCost(t);
    const method = methodOf(t.paymentMethod);
    if (inRange(ts, range)) {
      const i = bucketIndex(ts, buckets);
      if (i < 0) continue;
      const s = perSlot[i];
      s.sales += amount;
      s.orders += 1;
      s.cost += cost;
      s.received[method] += amount;
      if (method === "Credit") s.creditSales += amount;
      s.hours[new Date(ts).getHours()] += amount;
      t.items?.forEach((line) => {
        if (!line.product) return;
        const id = line.product.id || line.product.name;
        const row = s.products.get(id) || { name: line.product.name || "Unnamed product", qty: 0, revenue: 0 };
        row.qty += line.quantity || 0;
        row.revenue += (line.product.price || 0) * (line.quantity || 0) * (1 - (line.discountPercentage || 0) / 100);
        s.products.set(id, row);
      });
    } else if (inRange(ts, prev)) {
      previous.sales += amount;
      previous.orders += 1;
      previous.cost += cost;
      if (method === "Credit") previous.creditSales += amount;
      previous.received[method] += amount;
      const j = bucketIndex(ts, prevBuckets);
      if (j >= 0) prevSlotSales[j] += amount;
    }
  }

  // Money that came in later for earlier credit sales, and standalone payments.
  const addReceipt = (ts: number, amount: number, method: MethodKey) => {
    if (method === "Credit") method = "Cash";
    if (inRange(ts, range)) {
      const i = bucketIndex(ts, buckets);
      if (i >= 0) perSlot[i].received[method] += amount;
    } else if (inRange(ts, prev)) previous.received[method] += amount;
  };
  // A recorded payment that clears debt also writes a debt_payments row with no link back,
  // so a debt payment matching such a payment (same customer, same amount, within a day) is skipped.
  const successful = input.payments.filter((p) => p.status === "Success");
  const used = new Set<Payment>();
  for (const dp of input.debtPayments) {
    const ts = new Date(dp.created_at || "").getTime();
    const twin = successful.find(
      (p) =>
        !used.has(p) &&
        p.customerId === dp.customerId &&
        Math.abs(Number((p as any).debtApplied || 0) - (dp.amountPaid || 0)) < 0.01 &&
        Math.abs(new Date(p.date).getTime() - ts) < DAY,
    );
    if (twin) {
      used.add(twin);
      continue;
    }
    addReceipt(ts, dp.amountPaid || 0, methodOf(dp.paymentMethod));
  }
  for (const p of successful) addReceipt(new Date(p.date).getTime(), p.amount || 0, methodOf(p.method));

  for (const e of input.expenses) {
    const ts = new Date(e.date || e.created_at || "").getTime();
    if (!Number.isFinite(ts)) continue;
    if (inRange(ts, range)) {
      const i = bucketIndex(ts, buckets);
      if (i < 0) continue;
      perSlot[i].expenses += e.amount || 0;
      const g = expenseGroup(e.category);
      perSlot[i].expenseCategories.set(g, (perSlot[i].expenseCategories.get(g) || 0) + (e.amount || 0));
    } else if (inRange(ts, prev)) previous.expenses += e.amount || 0;
  }

  for (const s of [...perSlot, previous]) s.profit = s.sales - s.cost - s.expenses;

  const series: SeriesPoint[] = buckets.map((b, i) => ({
    label: b.label,
    fullLabel: b.fullLabel,
    sales: perSlot[i].sales,
    orders: perSlot[i].orders,
    cost: perSlot[i].cost,
    expenses: perSlot[i].expenses,
    profit: perSlot[i].profit,
    prevSales: prevSlotSales[i],
  }));

  const cumulative: Snapshot[] = [];
  let running = emptySnapshot();
  for (const s of perSlot) running = cumulative[cumulative.push(mergeSnapshots(running, s)) - 1];

  return { series, cumulative, previous, total: cumulative[cumulative.length - 1] || emptySnapshot() };
}

function mergeSnapshots(a: Snapshot, b: Snapshot): Snapshot {
  const out = emptySnapshot();
  out.sales = a.sales + b.sales;
  out.orders = a.orders + b.orders;
  out.cost = a.cost + b.cost;
  out.expenses = a.expenses + b.expenses;
  out.profit = a.profit + b.profit;
  out.creditSales = a.creditSales + b.creditSales;
  for (const m of METHODS) out.received[m] = a.received[m] + b.received[m];
  for (const src of [a.products, b.products]) {
    src.forEach((v, k) => {
      const row = out.products.get(k) || { name: v.name, qty: 0, revenue: 0 };
      row.qty += v.qty;
      row.revenue += v.revenue;
      out.products.set(k, row);
    });
  }
  for (const src of [a.expenseCategories, b.expenseCategories]) src.forEach((v, k) => out.expenseCategories.set(k, (out.expenseCategories.get(k) || 0) + v));
  out.hours = a.hours.map((h, i) => h + b.hours[i]);
  return out;
}

export function moneyReceived(s: Snapshot) {
  return s.received["M-Pesa"] + s.received.Cash + s.received.Card + s.received.Bank;
}

/** A lightweight sale row, enough for branch comparisons. */
export interface BranchSale {
  businessId: string;
  amount: number;
  ts: number;
}

export interface BranchRow {
  id: string;
  name: string;
  sales: number;
  orders: number;
  prevSales: number;
  growth: number | null;
  share: number;
  /** Sales per slot, for the trend chart and replay. */
  perSlot: number[];
}

export function analyseBranches(branches: { id: string; name: string }[], sales: BranchSale[], range: DateRange, buckets: Bucket[]): BranchRow[] {
  const prev = previousRange(range);
  const rows = new Map<string, BranchRow>(
    branches.map((b) => [b.id, { id: b.id, name: b.name, sales: 0, orders: 0, prevSales: 0, growth: null, share: 0, perSlot: buckets.map(() => 0) }]),
  );
  for (const s of sales) {
    const row = rows.get(s.businessId);
    if (!row || !Number.isFinite(s.ts)) continue;
    if (inRange(s.ts, range)) {
      const i = bucketIndex(s.ts, buckets);
      if (i < 0) continue;
      row.sales += s.amount;
      row.orders += 1;
      row.perSlot[i] += s.amount;
    } else if (inRange(s.ts, prev)) row.prevSales += s.amount;
  }
  const all = [...rows.values()];
  const total = all.reduce((sum, r) => sum + r.sales, 0);
  for (const r of all) {
    r.growth = growth(r.sales, r.prevSales);
    r.share = total > 0 ? (r.sales / total) * 100 : 0;
  }
  return all;
}

export interface StockSummary {
  value: number;
  costValue: number;
  outOfStock: Product[];
  lowStock: Product[];
  slowMoving: Product[];
}

export function stockSummary(products: Product[], soldIds: Set<string>): StockSummary {
  return {
    value: products.reduce((s, p) => s + (p.price || 0) * Math.max(0, p.stock || 0), 0),
    costValue: products.reduce((s, p) => s + (p.cost || 0) * Math.max(0, p.stock || 0), 0),
    outOfStock: products.filter((p) => (p.stock || 0) <= 0),
    lowStock: products.filter((p) => p.stock > 0 && p.stock <= (p.minStock || 0)).sort((a, b) => a.stock / (a.minStock || 1) - b.stock / (b.minStock || 1)),
    slowMoving: products.filter((p) => !soldIds.has(p.id) && p.stock > 0).sort((a, b) => b.price * b.stock - a.price * a.stock),
  };
}

export function formatKsh(n: number, compact = false): string {
  const sign = n < 0 ? "-" : "";
  const a = Math.abs(n);
  if (compact && a >= 1_000_000) return `${sign}KSh ${(a / 1_000_000).toFixed(a >= 10_000_000 ? 1 : 2)}M`;
  if (compact && a >= 100_000) return `${sign}KSh ${(a / 1000).toFixed(0)}K`;
  return `${sign}KSh ${Math.round(a).toLocaleString()}`;
}

/** Short axis ticks: 1.2M, 450K, 900. */
export function formatAxis(n: number): string {
  const a = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (a >= 1_000_000) return `${sign}${(a / 1_000_000).toFixed(a >= 10_000_000 ? 0 : 1)}M`;
  if (a >= 1000) return `${sign}${(a / 1000).toFixed(a >= 10_000 ? 0 : 1)}K`;
  return `${sign}${Math.round(a)}`;
}

export function formatGrowth(g: number | null): string {
  if (g === null) return "No earlier data";
  const r = Math.round(g);
  return `${r > 0 ? "+" : ""}${r}%`;
}
