// Riders to pay (20261130004_rider_pay_bills.sql). Rider pay is spending on the day it is
// owed (the delivery's day); paying it later only moves money. A payment is one expense row
// (rider_payment = true) linked to the deliveries it paid, so the money balance and books
// move with it, but it is never counted as spending a second time.
import { getSupabase } from './supabaseClient';
import { toUuid } from '../utils/idUtils';
import type { Expense } from '../types';

export type RiderItemKind = 'sale' | 'online' | 'trip';

export interface RiderPayItem {
  kind: RiderItemKind;
  id: string;
  riderKey: string;
  rider: string;
  reference: string;
  customer: string;
  place: string | null;
  date: string;
  status: string;
  amount: number;
  paid: number;
  balance: number;
}

export interface RiderToPay {
  key: string;
  riderId: string | null;
  name: string;
  owed: number;
  /** Paid for deliveries that are no longer owed; it covers the rider's next ones. */
  ahead: number;
}

export interface RiderPayment {
  expenseId: string;
  date: string;
  amount: number;
  method: string;
  from: 'petty_cash' | 'expense';
  by: string;
  note: string;
  rider: string;
  deliveries: number;
  removed: boolean;
}

export type PayFrom = 'petty_cash' | 'account';

const n = (v: unknown) => Number(v) || 0;

/** Riders with what they are owed, every delivery owed since `start` (paid or not) plus
 *  anything still unpaid from before, and the payments since `start`. */
export async function loadRidersToPay(businessId: string, start: Date | null = null): Promise<{
  riders: RiderToPay[]; items: RiderPayItem[]; payments: RiderPayment[];
}> {
  const { data, error } = await getSupabase().rpc('list_rider_pay', {
    p_business_id: toUuid(businessId),
    p_start: start ? start.toISOString() : null,
  });
  if (error) throw error;
  const r = (data || {}) as any;
  return {
    riders: (r.riders || []).map((x: any) => ({
      key: x.key, riderId: x.riderId ?? null, name: x.name || 'Rider', owed: n(x.owed), ahead: n(x.ahead),
    })),
    items: (r.items || []).map((i: any) => ({
      kind: i.kind, id: i.id, riderKey: i.riderKey, rider: i.rider || 'Rider', reference: i.reference || '',
      customer: i.customer || '', place: i.place ?? null, date: i.date, status: i.status || 'assigned',
      amount: n(i.amount), paid: n(i.paid), balance: n(i.balance),
    })),
    payments: (r.payments || []).map((p: any) => ({
      expenseId: p.expenseId, date: p.date, amount: n(p.amount), method: p.method || 'Cash', from: p.from,
      by: p.by || '', note: p.note || '', rider: p.rider || '', deliveries: n(p.deliveries), removed: !!p.removed,
    })),
  };
}

/** Pays the chosen deliveries (or everything owed when `items` is null). Safe to retry. */
export async function payRider(
  businessId: string,
  riderKey: string,
  items: { kind: RiderItemKind; id: string }[] | null,
  from: PayFrom,
  method: string,
  note: string,
  referenceId: string,
): Promise<{ amount: number; deliveries: number; rider: string }> {
  const { data, error } = await getSupabase().rpc('pay_rider', {
    p_business_id: toUuid(businessId),
    p_rider_key: riderKey,
    p_items: items ? items.map((i) => `${i.kind}:${i.id}`) : null,
    p_from: from,
    p_method: from === 'petty_cash' ? 'Cash' : method,
    p_note: note.trim() || null,
    p_reference_id: referenceId,
  });
  if (error) throw error;
  const r = (data || {}) as any;
  return { amount: n(r.amount), deliveries: n(r.deliveries), rider: r.rider || '' };
}

/** Takes a payment back: money returns, books undo it, the deliveries are owed again. */
export async function removeRiderPayment(businessId: string, expenseId: string, reason: string): Promise<void> {
  const { error } = await getSupabase().rpc('remove_rider_payment', {
    p_business_id: toUuid(businessId), p_expense_id: expenseId, p_reason: reason.trim(),
  });
  if (error) throw error;
}

/** Rider pay owed, as spending rows dated the day it was owed (for Home and Expenses). */
export async function loadRiderPayOwed(businessId: string): Promise<Expense[]> {
  const { data, error } = await getSupabase().rpc('list_rider_pay_owed', { p_business_id: toUuid(businessId) });
  if (error) throw error;
  return ((data || []) as any[]).map((o) => ({
    id: `rider-${o.id}`,
    amount: n(o.amount),
    category: 'Rider pay',
    description: `${o.rider || 'Rider'} · ${o.reference || ''}${o.customer ? ` · ${o.customer}` : ''}`,
    date: o.date,
    staffName: o.rider || 'Rider',
    businessId,
    riderOwed: true,
  }));
}

/** Spending as the books see it: rider payments out (already counted when owed), rider pay
 *  owed in. Use this wherever expenses add up to spending or profit; use the plain list for
 *  cash (shift report, petty cash), where the payment is the money that left. */
export function spendingWithRiderPay(expenses: Expense[], owed: Expense[]): Expense[] {
  return [...expenses.filter((e) => !e.riderPayment), ...owed];
}
