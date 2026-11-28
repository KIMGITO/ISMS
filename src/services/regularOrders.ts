// Regular orders (20261130005_regular_orders.sql): customers we supply on fixed days, with a
// quantity for each day of the week. Staff set them on the customer's page; customers ask from
// their website account and the owner approves. Marking a day delivered records one sale
// through the till's customer-sale function, so stock, books, wallet/debt and points follow
// the usual rules. A full refund of that sale makes the day due again.
//
// The plain functions below (weekText, planStock, customersForDay) hold the arithmetic the
// screens show, so they can be tested without a database.
import { getSupabase } from './supabaseClient';
import { toUuid } from '../utils/idUtils';

export type RegularStatus = 'requested' | 'active' | 'paused' | 'declined' | 'ended';
export type LineState = 'due' | 'changed' | 'skipped' | 'delivered';
export type Fulfilment = 'delivery' | 'pickup';

/** Sunday first, like Date.getDay() and the database. */
export const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
/** The order a week is shown in: Monday to Sunday. */
export const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0] as const;
export const EMPTY_WEEK = (): number[] => [0, 0, 0, 0, 0, 0, 0];

export interface RegularOrder {
  id: string;
  customerId: string;
  customerName: string;
  customerPhone: string | null;
  productId: string;
  productName: string;
  unit: string;
  price: number;
  dayQty: number[];
  status: RegularStatus;
  fulfilment: Fulfilment;
  address: string | null;
  note: string | null;
  startsOn: string;
  endsOn: string | null;
  pendingDayQty: number[] | null;
  pendingFulfilment: Fulfilment | null;
  pendingAddress: string | null;
  pendingNote: string | null;
  pendingSince: string | null;
  requestedByCustomer: boolean;
  decisionNote: string | null;
  decidedBy: string | null;
  decidedAt: string | null;
  createdBy: string;
  updatedBy: string | null;
  updatedAt: string;
  walletBalance: number;
  debtBalance: number;
}

export interface RegularLine {
  orderId: string;
  customerId: string;
  productId: string;
  day: string;
  planned: number;
  state: LineState;
  /** What to deliver that day (or what was delivered). 0 when skipped. */
  quantity: number;
  transactionId: string | null;
  message: string | null;
  by: string | null;
}

export interface StockInfo {
  productId: string;
  name: string;
  unit: string;
  price: number;
  stock: number;
  /** Usual sales a day, not counting regular orders (last 28 days). */
  avgOther: number;
  soldTodayOther: number;
}

export interface RegularBoard {
  today: string;
  ringAt: string;
  orders: RegularOrder[];
  lines: RegularLine[];
  stock: StockInfo[];
}

const rpc = async <T>(fn: string, args: Record<string, unknown>): Promise<T> => {
  const { data, error } = await getSupabase().rpc(fn, args);
  if (error) throw error;
  return data as T;
};

const num = (v: unknown) => Number(v ?? 0) || 0;
const week = (v: unknown): number[] => (Array.isArray(v) && v.length === 7 ? v.map(num) : EMPTY_WEEK());

export async function loadRegularOrders(businessId: string, from: string, to: string, customerId?: string): Promise<RegularBoard> {
  const raw = await rpc<any>('get_regular_orders', {
    p_business_id: toUuid(businessId),
    p_from: from,
    p_to: to,
    p_customer_id: customerId ? toUuid(customerId) : null,
  });
  return {
    today: raw.today,
    ringAt: raw.ringAt,
    orders: (raw.orders || []).map((o: any): RegularOrder => ({
      ...o,
      price: num(o.price),
      dayQty: week(o.dayQty),
      pendingDayQty: o.pendingDayQty ? week(o.pendingDayQty) : null,
      walletBalance: num(o.walletBalance),
      debtBalance: num(o.debtBalance),
    })),
    lines: (raw.lines || []).map((l: any): RegularLine => ({ ...l, planned: num(l.planned), quantity: num(l.quantity) })),
    stock: (raw.stock || []).map((s: any): StockInfo => ({
      ...s, price: num(s.price), stock: num(s.stock), avgOther: num(s.avgOther), soldTodayOther: num(s.soldTodayOther),
    })),
  };
}

export interface RegularOrderInput {
  id: string | null;
  customerId: string;
  productId: string;
  dayQty: number[];
  fulfilment: Fulfilment;
  address: string;
  note: string;
  startsOn: string | null;
  endsOn: string | null;
  status: 'active' | 'paused' | 'ended';
}

export const saveRegularOrder = (businessId: string, o: RegularOrderInput) =>
  rpc<string>('save_regular_order', {
    p_business_id: toUuid(businessId),
    p_id: o.id ? toUuid(o.id) : null,
    p_customer_id: toUuid(o.customerId),
    p_product_id: toUuid(o.productId),
    p_day_qty: o.dayQty.map((q) => Math.max(0, q || 0)),
    p_fulfilment: o.fulfilment,
    p_address: o.address,
    p_note: o.note,
    p_starts_on: o.startsOn,
    p_ends_on: o.endsOn,
    p_status: o.status,
  });

export const removeRegularOrder = (businessId: string, id: string) =>
  rpc<void>('remove_regular_order', { p_business_id: toUuid(businessId), p_id: toUuid(id) });

export const decideRegularOrder = (businessId: string, id: string, approve: boolean, note: string) =>
  rpc<void>('decide_regular_order', { p_business_id: toUuid(businessId), p_id: toUuid(id), p_approve: approve, p_note: note });

export interface DayChangeResult {
  /** Sent to their website account messages. */
  inApp: boolean;
  phone: string | null;
  name: string;
  text: string | null;
}

export const setRegularOrderDay = (
  businessId: string, orderIds: string[], day: string, action: 'change' | 'skip' | 'reset', qty: number | null, message: string,
) =>
  rpc<DayChangeResult>('set_regular_order_day', {
    p_business_id: toUuid(businessId),
    p_order_ids: orderIds.map(toUuid),
    p_day: day,
    p_action: action,
    p_qty: qty,
    p_message: message,
  });

/** 'Credit_Debt' = on the customer's account: wallet first, the rest as debt. */
export type DeliverPayment = 'Credit_Debt' | 'Cash' | 'M-Pesa' | 'Airtel Money' | 'Card' | 'Bank';

export const deliverRegularOrders = (businessId: string, d: {
  customerId: string;
  day: string;
  lines: { orderId: string; quantity: number }[];
  payment: DeliverPayment;
  riderName: string;
  riderPay: number;
  /** Made once when the sheet opens, so a double tap or retry records one sale. */
  referenceId: string;
  note: string;
  /** M-Pesa / Airtel code or bank reference: required for those methods (money first, 20261217001). */
  paymentRef?: string;
}) =>
  rpc<string>('deliver_regular_orders', {
    p_business_id: toUuid(businessId),
    p_customer_id: toUuid(d.customerId),
    p_day: d.day,
    p_lines: d.lines.map((l) => ({ orderId: toUuid(l.orderId), quantity: l.quantity })),
    p_payment_method: d.payment,
    p_rider_name: d.riderName,
    p_rider_pay: d.riderPay,
    p_reference_id: d.referenceId,
    p_note: d.note,
    // Only with a code, so a database without 20261217001 still takes cash and credit days.
    ...(d.paymentRef ? { p_payment_ref: d.paymentRef } : {}),
  });

export const saveRingTime = (businessId: string, ringAt: string) =>
  rpc<void>('save_regular_order_settings', { p_business_id: toUuid(businessId), p_ring_at: ringAt });

// ── Words and dates ─────────────────────────────────────────────────────────────────────

export const qtyText = (n: number): string =>
  (Math.round(n * 1000) / 1000).toLocaleString('en-KE', { maximumFractionDigits: 3 });

/**
 * A week in a few words, Monday first, with runs of the same amount joined:
 * "Mon–Fri 10", "Sat 10", "Mon–Tue 20 · Wed–Thu 23 · Fri 19", "Every day 5".
 */
export function weekText(dayQty: number[], unit = ''): string {
  const u = unit ? ` ${unit}` : '';
  const qs = WEEK_ORDER.map((d) => dayQty[d] || 0);
  if (qs.every((q) => q === 0)) return 'No days';
  if (qs.every((q) => q === qs[0])) return `Every day ${qtyText(qs[0])}${u}`;
  const parts: string[] = [];
  let i = 0;
  while (i < 7) {
    if (qs[i] === 0) { i++; continue; }
    let j = i;
    while (j + 1 < 7 && qs[j + 1] === qs[i]) j++;
    const from = DAY_NAMES[WEEK_ORDER[i]];
    const to = DAY_NAMES[WEEK_ORDER[j]];
    parts.push(`${i === j ? from : `${from}–${to}`} ${qtyText(qs[i])}`);
    i = j + 1;
  }
  return parts.join(' · ') + u;
}

export const weekTotal = (dayQty: number[]) => dayQty.reduce((s, q) => s + (q || 0), 0);

/** Adds days to a YYYY-MM-DD date. */
export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export const weekdayOf = (day: string) => new Date(`${day}T12:00:00Z`).getUTCDay();

export function dayLabel(day: string, today: string): string {
  if (day === today) return 'Today';
  if (day === addDays(today, 1)) return 'Tomorrow';
  if (day === addDays(today, -1)) return 'Yesterday';
  return new Date(`${day}T12:00:00Z`).toLocaleDateString('en-KE', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
}

export const STATUS_LABEL: Record<RegularStatus, string> = {
  requested: 'Waiting for approval',
  active: 'Running',
  paused: 'Paused',
  declined: 'Declined',
  ended: 'Ended',
};

/** Something a customer asked for that the owner still has to decide. */
export const needsDecision = (o: Pick<RegularOrder, 'status' | 'pendingDayQty'>) =>
  o.status === 'requested' || o.pendingDayQty != null;

// ── A day's customers ───────────────────────────────────────────────────────────────────

export interface CustomerDay {
  customerId: string;
  name: string;
  phone: string | null;
  items: { order: RegularOrder; line: RegularLine }[];
  /** open: something still to deliver; done: all delivered; skipped: nothing to do. */
  state: 'open' | 'done' | 'skipped';
  /** Value of what is still to deliver (current prices). */
  value: number;
}

/** One entry per customer for a day, those still to deliver first. */
export function customersForDay(board: Pick<RegularBoard, 'orders' | 'lines'>, day: string): CustomerDay[] {
  const orders = new Map(board.orders.map((o) => [o.id, o]));
  const byCustomer = new Map<string, CustomerDay>();
  for (const line of board.lines) {
    if (line.day !== day) continue;
    const order = orders.get(line.orderId);
    if (!order) continue;
    let c = byCustomer.get(line.customerId);
    if (!c) {
      c = { customerId: line.customerId, name: order.customerName, phone: order.customerPhone, items: [], state: 'skipped', value: 0 };
      byCustomer.set(line.customerId, c);
    }
    c.items.push({ order, line });
  }
  const rank = { open: 0, done: 1, skipped: 2 } as const;
  return [...byCustomer.values()]
    .map((c) => {
      const open = c.items.filter((i) => (i.line.state === 'due' || i.line.state === 'changed') && i.line.quantity > 0);
      const done = c.items.some((i) => i.line.state === 'delivered');
      return {
        ...c,
        items: c.items.sort((a, b) => a.order.productName.localeCompare(b.order.productName)),
        state: open.length > 0 ? 'open' : done ? 'done' : 'skipped',
        value: open.reduce((s, i) => s + i.line.quantity * i.order.price, 0),
      } as CustomerDay;
    })
    .sort((a, b) => rank[a.state] - rank[b.state] || a.name.localeCompare(b.name));
}

// ── Stock outlook ───────────────────────────────────────────────────────────────────────

export interface StockDay {
  day: string;
  /** Regular orders still to deliver that day. */
  regular: number;
  /** Usual sales expected that day (today: what is left of a normal day). */
  other: number;
  /** Stock left at the end of the day if all of that goes out. */
  closing: number;
}

export interface StockPlan {
  productId: string;
  name: string;
  unit: string;
  stock: number;
  avgOther: number;
  days: StockDay[];
  /** First day stock runs out, or null. */
  shortOn: string | null;
  /** How much more is needed to get through all the days shown. */
  orderMore: number;
  level: 'ok' | 'tight' | 'short';
}

/**
 * Stock for the days shown: today's stock, less regular orders still to deliver and the usual
 * other sales, day by day. Stock already reflects anything delivered, so only open lines count.
 * "Tight" means less than one normal day of sales would be left.
 */
export function planStock(board: Pick<RegularBoard, 'today' | 'lines' | 'stock'>, days: string[]): StockPlan[] {
  return board.stock
    .map((s): StockPlan => {
      let left = s.stock;
      let worst = 0;
      let shortOn: string | null = null;
      const out = days.map((day): StockDay => {
        const regular = board.lines
          .filter((l) => l.productId === s.productId && l.day === day && (l.state === 'due' || l.state === 'changed'))
          .reduce((sum, l) => sum + l.quantity, 0);
        const other = day < board.today ? 0 : day === board.today ? Math.max(s.avgOther - s.soldTodayOther, 0) : s.avgOther;
        left -= regular + other;
        if (left < 0 && !shortOn) shortOn = day;
        worst = Math.min(worst, left);
        return { day, regular, other, closing: left };
      });
      const level = shortOn ? 'short' : left < s.avgOther ? 'tight' : 'ok';
      return {
        productId: s.productId, name: s.name, unit: s.unit, stock: s.stock, avgOther: s.avgOther,
        days: out, shortOn, orderMore: Math.ceil(-worst), level,
      };
    })
    .filter((p) => p.days.some((d) => d.regular > 0))
    .sort((a, b) => ({ short: 0, tight: 1, ok: 2 }[a.level] - { short: 0, tight: 1, ok: 2 }[b.level]) || a.name.localeCompare(b.name));
}

/** The words for one product's outlook. */
export function stockAdvice(p: StockPlan, today: string): string {
  if (p.level === 'short' && p.shortOn) {
    return `Runs out ${dayLabel(p.shortOn, today).toLowerCase()}. Order about ${qtyText(p.orderMore)}${p.unit ? ` ${p.unit}` : ''} more.`;
  }
  if (p.level === 'tight') return 'Enough, but little left for walk-in sales. Consider ordering.';
  return 'Enough stock.';
}

/** Kenya's date today (YYYY-MM-DD), for screens that open before the board loads. */
export const kenyaToday = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Nairobi' });
