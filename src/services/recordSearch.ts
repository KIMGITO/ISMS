// Records found by the database's global_search() (20261202001): sales, deliveries, website
// orders, payments, expenses, stock movements, customer account entries, journal entries, audit
// log entries and transfers, each with its reference. The database runs the search as the
// signed-in person, so RLS leaves out anything their role can't read.
//
// recordDestination() says where each one opens: the screen, what that screen must show (the
// search target) and the row search then centres and highlights.
import { getSupabase } from './supabaseClient';
import { toUuid } from '../utils/idUtils';
import type { ScreenId } from '../utils/screens';
import type { SearchTarget } from '../stores/uiStore';

export type RecordKind =
  | 'sale' | 'delivery' | 'order' | 'payment' | 'expense' | 'stock_move'
  | 'customer_ledger' | 'journal' | 'audit' | 'transfer';

export interface RecordHit {
  kind: RecordKind;
  id: string;
  ref: string | null;
  title: string;
  subtitle: string | null;
  amount?: number | null;
  quantity?: number | null;
  at?: string | null;
  status?: string | null;
  rank: number;
  source?: 'sale' | 'online';
  customer_id?: string;
  no?: number;
  petty_cash?: boolean;
  is_delivery?: boolean;
  rider?: string | null;
  source_ref?: string | null;
}

/** Search group each kind is listed under. */
export const RECORD_CATEGORY: Record<RecordKind, string> = {
  sale: 'Sales',
  delivery: 'Deliveries',
  order: 'Website orders',
  payment: 'Payments',
  expense: 'Expenses',
  stock_move: 'Stock movements',
  customer_ledger: 'Customer accounts',
  journal: 'Journal entries',
  audit: 'Audit Logs',
  transfer: 'Stock transfers',
};

/** The id search uses for a record; rows on screen carry the same id in data-search-id. */
export function recordSearchId(hit: Pick<RecordHit, 'kind' | 'id' | 'source'>): string {
  switch (hit.kind) {
    case 'sale': return `sale-${hit.id}`;
    case 'delivery': return `delivery-${hit.source ?? 'sale'}-${hit.id}`;
    case 'order': return `order-${hit.id}`;
    case 'payment': return `pay-${hit.id}`;
    case 'expense': return `exp-${hit.id}`;
    case 'stock_move': return `adj-${hit.id}`;
    case 'customer_ledger': return `ledger-${hit.id}`;
    case 'journal': return `je-${hit.id}`;
    case 'audit': return `audit-${hit.id}`;
    case 'transfer': return `transfer-${hit.id}`;
  }
}

export interface RecordDestination {
  screen: ScreenId;
  target: SearchTarget | null;
  /** Row to centre and highlight. */
  spotId: string;
  /** A tab to open first (data-shortcut), e.g. Expenses on Payments & Expenses. */
  press?: string;
}

/**
 * Where a record opens, or null when this person can open none of the screens that show it.
 * @param canOpen whether the signed-in person may open a screen
 */
export function recordDestination(hit: RecordHit, canOpen: (screen: ScreenId) => boolean): RecordDestination | null {
  const spotId = recordSearchId(hit);
  const asSale = (): RecordDestination | null =>
    hit.source !== 'online' && canOpen('sales') ? { screen: 'sales', target: { kind: 'sale', id: hit.id }, spotId: `sale-${hit.id}` } : null;

  switch (hit.kind) {
    case 'sale':
      return asSale();
    case 'delivery':
      if (canOpen('deliveries')) return { screen: 'deliveries', target: { kind: 'delivery', source: hit.source ?? 'sale', id: hit.id }, spotId };
      if (hit.source === 'online' && canOpen('online-store')) return { screen: 'online-store', target: { kind: 'order', id: hit.id }, spotId: `order-${hit.id}` };
      return asSale();
    case 'order':
      return canOpen('online-store') ? { screen: 'online-store', target: { kind: 'order', id: hit.id }, spotId } : null;
    case 'payment':
      return canOpen('money') ? { screen: 'money', target: { kind: 'payment', id: hit.id }, spotId, press: 'money-payments' } : null;
    case 'expense':
      return canOpen('money') ? { screen: 'money', target: { kind: 'expense', id: hit.id }, spotId, press: 'money-expenses' } : null;
    case 'stock_move':
      if (canOpen('stock-history')) return { screen: 'stock-history', target: { kind: 'stock', query: '', id: hit.id }, spotId };
      return null;
    case 'customer_ledger':
      return canOpen('customers') && hit.customer_id
        ? { screen: 'customers', target: { kind: 'ledger', customerId: hit.customer_id, id: hit.id }, spotId }
        : null;
    case 'journal':
      return canOpen('finance') && hit.no != null
        ? { screen: 'finance', target: { kind: 'journal', id: hit.id, no: hit.no, at: hit.at ?? undefined }, spotId }
        : null;
    case 'audit':
      return canOpen('audit') ? { screen: 'audit', target: { kind: 'audit', id: hit.id, at: hit.at ?? undefined }, spotId } : null;
    case 'transfer':
      return canOpen('stock-transfers') ? { screen: 'stock-transfers', target: { kind: 'transfer', id: hit.id }, spotId } : null;
  }
  return null;
}

const isMissingFunction = (err: unknown) => (err as { code?: string } | null)?.code === 'PGRST202';

/**
 * Records matching what was typed, best first within each kind. Empty when offline, when the
 * database doesn't have global_search yet, or for fewer than 2 characters.
 */
export async function searchRecords(businessId: string, query: string, limit = 6): Promise<RecordHit[]> {
  const q = query.trim();
  if (q.length < 2 || !businessId) return [];
  const { data, error } = await getSupabase().rpc('global_search', { p_business_id: toUuid(businessId), p_query: q, p_limit: limit });
  if (error) {
    if (isMissingFunction(error)) return [];
    throw error;
  }
  return Array.isArray(data) ? (data as RecordHit[]) : [];
}

// ---------------------------------------------------------------- how a result reads
const DELIVERY_STATUS: Record<string, string> = {
  assigned: 'Accepted', out_for_delivery: 'On the way', delivered: 'Delivered', failed: 'Not delivered',
};
const ORDER_STATUS: Record<string, string> = {
  pending_payment: 'Not paid', payment_failed: 'Payment failed', paid: 'Paid', preparing: 'Preparing',
  out_for_delivery: 'On the way', ready_for_pickup: 'Ready', completed: 'Completed', cancelled: 'Cancelled',
};
const LEDGER_TYPE: Record<string, string> = {
  wallet_topup: 'Wallet top-up', wallet_usage: 'Paid from wallet', debt_creation: 'Debt added',
  debt_payment: 'Debt paid', debt_adjustment: 'Debt corrected', refund: 'Refund',
};

function when(at: string | null | undefined, dateOnly = false): string {
  if (!at) return '';
  const d = new Date(dateOnly && /^\d{4}-\d{2}-\d{2}$/.test(at) ? `${at}T12:00:00` : at);
  if (Number.isNaN(d.getTime())) return '';
  return dateOnly
    ? d.toLocaleDateString('en-KE', { dateStyle: 'medium' })
    : d.toLocaleString('en-KE', { dateStyle: 'medium', timeStyle: 'short' });
}

const qty = (n: number | null | undefined) => {
  const v = Number(n ?? 0);
  return `${v > 0 ? '+' : ''}${Math.round(v * 10) / 10}`;
};

/** Title, detail line and status chip for a found record: the reference first, then what identifies it. */
export function describeRecord(hit: RecordHit, money: (n: number) => string): { title: string; subtitle: string; status?: string } {
  const ref = hit.ref ? `${hit.ref} · ` : '';
  const amount = hit.amount != null ? money(Number(hit.amount)) : '';
  const join = (...parts: (string | null | undefined)[]) => parts.filter(Boolean).join(' · ');
  switch (hit.kind) {
    case 'sale':
      return { title: `Receipt ${ref}${hit.title}`, subtitle: join(when(hit.at), amount, hit.status, hit.subtitle) };
    case 'delivery':
      return {
        title: `${ref}${hit.title}`,
        subtitle: join(hit.subtitle, amount, hit.rider ? `Rider ${hit.rider}` : '', when(hit.at)),
        status: hit.source === 'online' ? ORDER_STATUS[hit.status ?? ''] : DELIVERY_STATUS[hit.status ?? 'assigned'],
      };
    case 'order':
      return { title: `Order ${ref}${hit.title}`, subtitle: join(hit.subtitle, amount, when(hit.at)), status: ORDER_STATUS[hit.status ?? ''] };
    case 'payment':
      return { title: `${ref}${hit.title}`, subtitle: join(amount, hit.subtitle, when(hit.at)), status: hit.status ?? undefined };
    case 'expense':
      return { title: `${ref}${hit.title}`, subtitle: join(amount, hit.subtitle, when(hit.at)) };
    case 'stock_move':
      return {
        title: `${ref}${hit.title}`,
        subtitle: join(`${qty(hit.quantity)} ${hit.status ?? ''}`.trim(), hit.source_ref, when(hit.at)),
      };
    case 'customer_ledger':
      return { title: `${ref}${hit.title}`, subtitle: join(LEDGER_TYPE[hit.status ?? ''] ?? hit.status, amount, when(hit.at)) };
    case 'journal':
      return { title: `${ref}${hit.title}`, subtitle: join(hit.subtitle, amount, when(hit.at, true)) };
    case 'audit':
      return { title: `${ref}${hit.title}`, subtitle: join(hit.subtitle, when(hit.at)) };
    case 'transfer':
      return { title: hit.ref || hit.title, subtitle: join(hit.subtitle, when(hit.at)) };
  }
  return { title: hit.title, subtitle: hit.subtitle ?? '' };
}
