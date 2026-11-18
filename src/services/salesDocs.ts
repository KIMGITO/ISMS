// Quotes, sales orders, deliveries, invoices, invoice payments and credit notes
// (supabase/migrations/20261117001_quotes_orders_invoices.sql). The database numbers the
// documents, works out totals and statuses, moves stock and posts to the books; this file
// calls those functions, reads the results, and turns a document into the shared invoice look.
import { getSupabase } from './supabaseClient';
import { toUuid } from '../utils/idUtils';
import type { InvoiceDocument, InvoiceLine, InvoiceParty, InvoiceTexts } from './invoice/types';

export type QuoteStatus = 'draft' | 'sent' | 'accepted' | 'declined';
export type OrderStatus = 'confirmed' | 'part_delivered' | 'delivered' | 'invoiced' | 'paid' | 'cancelled';
export type InvoiceStatus = 'unpaid' | 'part_paid' | 'paid' | 'credited' | 'void';
export type Settlement = 'reduce' | 'refund' | 'wallet' | 'debt';
export type MoneyMethod = 'Cash' | 'M-Pesa' | 'Airtel Money' | 'Card' | 'Bank';
export const MONEY_METHODS: MoneyMethod[] = ['Cash', 'M-Pesa', 'Airtel Money', 'Card', 'Bank'];
export const VAT_RATES = [0, 8, 16] as const;

/** A line as typed in a quote or order form. Prices are before VAT; VAT is added on top. */
export interface DraftLine {
  productId: string | null;
  name: string;
  unit: string;
  quantity: number;
  unitPrice: number;
  discountPct: number;
  vatRate: number;
}

export interface DocLine extends DraftLine {
  id: string;
  position: number;
  net: number;
  vat: number;
  total: number;
}

export interface OrderLine extends DocLine {
  delivered: number;
  invoiced: number;
}

export interface InvoiceLineRow extends DocLine {
  orderLineId: string | null;
  credited: number;
}

interface DocBase {
  id: string;
  number: string;
  customerId: string | null;
  customerName: string;
  customerPhone: string;
  notes: string;
  subtotal: number;
  vat: number;
  deliveryFee: number;
  total: number;
  createdBy: string;
  createdAt: string;
}

export interface Quote extends DocBase {
  status: QuoteStatus;
  expired: boolean;
  issueDate: string;
  validUntil: string;
  terms: string;
  orderId: string | null;
  orderNumber: string | null;
  lines: DocLine[];
}

export interface Delivery {
  id: string;
  number: string;
  at: string;
  by: string;
  note: string;
  cost: number;
  cancelled: boolean;
  lines: { orderLineId: string; name: string; quantity: number }[];
}

export interface SalesOrder extends DocBase {
  status: OrderStatus;
  orderDate: string;
  expectedDate: string | null;
  terms: string;
  quoteId: string | null;
  quoteNumber: string | null;
  lines: OrderLine[];
  deliveries: Delivery[];
  invoices: { id: string; number: string; total: number; balance: number; status: InvoiceStatus }[];
}

export interface InvoicePayment {
  id: string;
  paymentId: string | null;
  amount: number;
  method: string;
  reference: string;
  at: string;
  by: string;
  voided: boolean;
}

export interface SalesInvoice extends DocBase {
  status: InvoiceStatus;
  orderId: string | null;
  orderNumber: string | null;
  issueDate: string;
  dueDate: string;
  termsDays: number;
  paid: number;
  credited: number;
  refunded: number;
  balance: number;
  overdue: boolean;
  daysLate: number;
  voidReason: string;
  lines: InvoiceLineRow[];
  payments: InvoicePayment[];
  creditNotes: { id: string; number: string; total: number; settlement: Settlement }[];
}

export interface CreditNote {
  id: string;
  number: string;
  invoiceId: string | null;
  invoiceNumber: string | null;
  transactionId: string | null;
  receiptNumber: string | null;
  customerId: string | null;
  customerName: string;
  issueDate: string;
  reason: string;
  settlement: Settlement;
  method: MoneyMethod | null;
  returnStock: boolean;
  subtotal: number;
  vat: number;
  total: number;
  createdBy: string;
  createdAt: string;
  lines: { name: string; quantity: number; total: number }[];
}

export interface SalesDocs {
  quotes: Quote[];
  orders: SalesOrder[];
  invoices: SalesInvoice[];
  creditNotes: CreditNote[];
}

export interface AgeingRow {
  customerId: string | null;
  name: string;
  invoices: number;
  notDue: number;
  d1_30: number;
  d31_60: number;
  d61_90: number;
  d90: number;
  total: number;
  oldest: number;
}

export interface UnmatchedPayment {
  id: string;
  reference: string;
  amount: number;
  free: number;
  method: string;
  name: string;
  phone: string;
  date: string;
}

export interface RefundLine {
  id: string;
  productId: string | null;
  name: string;
  quantity: number;
  left: number;
  unitNet: number;
  vatRate: number;
}

export interface SaleRefundInfo {
  receipt: string;
  customerId: string | null;
  customerName: string;
  paymentMethod: string;
  finalTotal: number;
  refunded: number;
  owedOnSale: number;
  today: boolean;
  fullAccess: boolean;
  lines: RefundLine[];
}

// ---------------------------------------------------------------- words on screen

export const QUOTE_WORD: Record<QuoteStatus | 'expired', string> = {
  draft: 'Draft', sent: 'Sent', accepted: 'Accepted', declined: 'Declined', expired: 'Expired',
};
export const ORDER_WORD: Record<OrderStatus, string> = {
  confirmed: 'Confirmed', part_delivered: 'Part delivered', delivered: 'Delivered', invoiced: 'Invoiced', paid: 'Paid', cancelled: 'Cancelled',
};
export const INVOICE_WORD: Record<InvoiceStatus | 'overdue', string> = {
  unpaid: 'Unpaid', part_paid: 'Part paid', paid: 'Paid', credited: 'Credited', void: 'Void', overdue: 'Overdue',
};
export const SETTLEMENT_WORD: Record<Settlement, string> = {
  reduce: 'Less owed on the invoice', refund: 'Money given back', wallet: 'Into the customer\'s wallet', debt: 'Taken off their debt',
};
export const TERMS_CHOICES: { days: number; label: string }[] = [
  { days: 0, label: 'Pay now' }, { days: 7, label: '7 days' }, { days: 14, label: '14 days' }, { days: 30, label: '30 days' },
];
/** The customer setting (customers.payment_terms) behind a number of days, when there is one. */
export const termsSetting = (days: number): 'pay_now' | 'weekly' | 'monthly' | null =>
  days === 0 ? 'pay_now' : days === 7 ? 'weekly' : days === 30 ? 'monthly' : null;
export const termsDaysOf = (setting?: string | null): number => (setting === 'weekly' ? 7 : setting === 'monthly' ? 30 : 0);

/** Status shown for a quote: a draft or sent quote past its date reads as expired. */
export const quoteState = (q: Pick<Quote, 'status' | 'expired'>): QuoteStatus | 'expired' => (q.expired ? 'expired' : q.status);
export const invoiceState = (i: Pick<SalesInvoice, 'status' | 'overdue'>): InvoiceStatus | 'overdue' => (i.overdue ? 'overdue' : i.status);

// ---------------------------------------------------------------- sums (same rules as sd_norm_lines)

const round2 = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;
const n = (v: unknown) => Number(v) || 0;

/** Net, VAT and total of one line, rounded like the database rounds them. */
export function lineAmounts(l: Pick<DraftLine, 'quantity' | 'unitPrice' | 'discountPct' | 'vatRate'>): { net: number; vat: number; total: number } {
  const net = round2(n(l.quantity) * n(l.unitPrice) * (1 - n(l.discountPct) / 100));
  const vat = round2((net * n(l.vatRate)) / 100);
  return { net, vat, total: round2(net + vat) };
}

export function draftTotals(lines: DraftLine[], deliveryFee = 0): { net: number; vat: number; total: number } {
  let net = 0;
  let vat = 0;
  for (const l of lines) {
    if (!(n(l.quantity) > 0)) continue;
    const a = lineAmounts(l);
    net += a.net;
    vat += a.vat;
  }
  return { net: round2(net), vat: round2(vat), total: round2(net + vat + n(deliveryFee)) };
}

/** Problems the database would refuse, said before sending. Null when the lines are fine. */
export function checkLines(lines: DraftLine[]): string | null {
  const used = lines.filter((l) => l.name.trim() || l.productId);
  if (!used.length) return 'Add at least one item.';
  for (const l of used) {
    const name = l.name.trim() || 'An item';
    if (!(n(l.quantity) > 0)) return `${name} needs a quantity above zero.`;
    if (n(l.unitPrice) < 0) return `${name} can't have a price below zero.`;
    if (n(l.discountPct) < 0 || n(l.discountPct) > 100) return `The discount on ${name} must be between 0 and 100%.`;
    if (!(VAT_RATES as readonly number[]).includes(n(l.vatRate))) return `VAT on ${name} must be 0%, 8% or 16%.`;
  }
  return null;
}

/** What a refund of these quantities gives back (an estimate; the database has the last word). */
export function refundPreview(lines: RefundLine[], qty: Record<string, number>): { net: number; vat: number; total: number } {
  let net = 0;
  let vat = 0;
  for (const l of lines) {
    const q = Math.min(n(qty[l.id]), l.left);
    if (q <= 0) continue;
    const ln = round2(l.unitNet * q);
    net += ln;
    vat += round2((ln * l.vatRate) / 100);
  }
  return { net: round2(net), vat: round2(vat), total: round2(net + vat) };
}

/** What crediting these invoice quantities gives back. The last units take what is left. */
export function creditPreview(lines: InvoiceLineRow[], qty: Record<string, number>): number {
  let total = 0;
  for (const l of lines) {
    const q = Math.min(n(qty[l.id]), l.quantity - l.credited);
    if (q <= 0 || l.quantity <= 0) continue;
    total += round2((l.net * q) / l.quantity) + round2((l.vat * q) / l.quantity);
  }
  return round2(total);
}

// ---------------------------------------------------------------- reading

async function rpc<T = any>(name: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await getSupabase().rpc(name, args);
  if (error) throw error;
  return data as T;
}

const s = (v: unknown) => (v == null ? '' : String(v));

function toLine(r: any): DocLine {
  return {
    id: r.id,
    position: n(r.position),
    productId: r.product_id ?? null,
    name: s(r.name),
    unit: s(r.unit),
    quantity: n(r.quantity),
    unitPrice: n(r.unit_price),
    discountPct: n(r.discount_pct),
    vatRate: n(r.vat_rate),
    net: n(r.line_net),
    vat: n(r.line_vat),
    total: n(r.line_total),
  };
}

function base(r: any): DocBase {
  return {
    id: r.id,
    number: s(r.number),
    customerId: r.customer_id ?? null,
    customerName: s(r.customer_name),
    customerPhone: s(r.customer_phone),
    notes: s(r.notes),
    subtotal: n(r.subtotal),
    vat: n(r.vat_total),
    deliveryFee: n(r.delivery_fee),
    total: n(r.total),
    createdBy: s(r.created_by),
    createdAt: s(r.created_at),
  };
}

export function toQuote(r: any): Quote {
  return {
    ...base(r),
    status: r.status,
    expired: !!r.expired,
    issueDate: s(r.issue_date),
    validUntil: s(r.valid_until),
    terms: s(r.terms),
    orderId: r.order_id ?? null,
    orderNumber: r.order_number ?? null,
    lines: (r.lines || []).map(toLine),
  };
}

export function toOrder(r: any): SalesOrder {
  return {
    ...base(r),
    status: r.status,
    orderDate: s(r.order_date),
    expectedDate: r.expected_date ?? null,
    terms: s(r.terms),
    quoteId: r.quote_id ?? null,
    quoteNumber: r.quote_number ?? null,
    lines: (r.lines || []).map((l: any) => ({ ...toLine(l), delivered: n(l.qty_delivered), invoiced: n(l.qty_invoiced) })),
    deliveries: (r.deliveries || []).map((d: any) => ({
      id: d.id,
      number: s(d.number),
      at: s(d.delivered_at),
      by: s(d.delivered_by),
      note: s(d.note),
      cost: n(d.total_cost),
      cancelled: !!d.cancelled_at,
      lines: (d.lines || []).map((l: any) => ({ orderLineId: l.order_line_id, name: s(l.name), quantity: n(l.quantity) })),
    })),
    invoices: (r.invoices || []).map((i: any) => ({ id: i.id, number: s(i.number), total: n(i.total), balance: n(i.balance), status: i.status })),
  };
}

export function toInvoice(r: any): SalesInvoice {
  return {
    ...base(r),
    status: r.status,
    orderId: r.order_id ?? null,
    orderNumber: r.order_number ?? null,
    issueDate: s(r.issue_date),
    dueDate: s(r.due_date),
    termsDays: n(r.terms_days),
    paid: n(r.amount_paid),
    credited: n(r.amount_credited),
    refunded: n(r.amount_refunded),
    balance: n(r.balance),
    overdue: !!r.overdue,
    daysLate: n(r.days_late),
    voidReason: s(r.void_reason),
    lines: (r.lines || []).map((l: any) => ({ ...toLine(l), orderLineId: l.order_line_id ?? null, credited: n(l.qty_credited) })),
    payments: (r.payments || []).map((p: any) => ({
      id: p.id,
      paymentId: p.payment_id ?? null,
      amount: n(p.amount),
      method: s(p.method),
      reference: s(p.reference),
      at: s(p.paid_at),
      by: s(p.recorded_by),
      voided: !!p.voided_at,
    })),
    creditNotes: (r.credit_notes || []).map((c: any) => ({ id: c.id, number: s(c.number), total: n(c.total), settlement: c.settlement })),
  };
}

export function toCreditNote(r: any): CreditNote {
  return {
    id: r.id,
    number: s(r.number),
    invoiceId: r.invoice_id ?? null,
    invoiceNumber: r.invoice_number ?? null,
    transactionId: r.transaction_id ?? null,
    receiptNumber: r.receipt_number ?? null,
    customerId: r.customer_id ?? null,
    customerName: s(r.customer_name),
    issueDate: s(r.issue_date),
    reason: s(r.reason),
    settlement: r.settlement,
    method: r.refund_method ?? null,
    returnStock: !!r.return_stock,
    subtotal: n(r.subtotal),
    vat: n(r.vat_total),
    total: n(r.total),
    createdBy: s(r.created_by),
    createdAt: s(r.created_at),
    lines: (r.lines || []).map((l: any) => ({ name: s(l.name), quantity: n(l.quantity), total: n(l.line_total) })),
  };
}

export async function loadSalesDocs(businessId: string): Promise<SalesDocs> {
  const r = await rpc('sales_docs', { p_business_id: toUuid(businessId) });
  return {
    quotes: (r?.quotes || []).map(toQuote),
    orders: (r?.orders || []).map(toOrder),
    invoices: (r?.invoices || []).map(toInvoice),
    creditNotes: (r?.creditNotes || []).map(toCreditNote),
  };
}

export async function loadAgeing(businessId: string): Promise<AgeingRow[]> {
  const rows = await rpc<any[]>('invoice_ageing', { p_business_id: toUuid(businessId) });
  return (rows || []).map((r) => ({
    customerId: r.customerId ?? null,
    name: s(r.name),
    invoices: n(r.invoices),
    notDue: n(r.notDue),
    d1_30: n(r.d1_30),
    d31_60: n(r.d31_60),
    d61_90: n(r.d61_90),
    d90: n(r.d90),
    total: n(r.total),
    oldest: n(r.oldest),
  }));
}

export async function loadUnmatchedPayments(businessId: string): Promise<UnmatchedPayment[]> {
  const rows = await rpc<any[]>('unmatched_payments', { p_business_id: toUuid(businessId) });
  return (rows || []).map((r) => ({
    id: r.id, reference: s(r.reference), amount: n(r.amount), free: n(r.free), method: s(r.method), name: s(r.name), phone: s(r.phone), date: s(r.date),
  }));
}

export async function loadSaleRefund(transactionId: string): Promise<SaleRefundInfo> {
  const r = await rpc('sale_refund_lines', { p_transaction_id: toUuid(transactionId) });
  return {
    receipt: s(r.receipt),
    customerId: r.customerId ?? null,
    customerName: s(r.customerName),
    paymentMethod: s(r.paymentMethod),
    finalTotal: n(r.finalTotal),
    refunded: n(r.refunded),
    owedOnSale: n(r.owedOnSale),
    today: !!r.today,
    fullAccess: !!r.fullAccess,
    lines: (r.lines || []).map((l: any) => ({
      id: l.id, productId: l.productId ?? null, name: s(l.name), quantity: n(l.quantity), left: n(l.left), unitNet: n(l.unitNet), vatRate: n(l.vatRate),
    })),
  };
}

/** Credit notes made from till sales, keyed by sale, for the Sales Log. */
export async function loadSaleCreditNotes(businessId: string): Promise<Map<string, { number: string; total: number; edit: boolean }[]>> {
  const { data, error } = await getSupabase()
    .from('credit_notes')
    .select('number, total, transaction_id, reason')
    .eq('business_id', toUuid(businessId))
    .not('transaction_id', 'is', null)
    .order('created_at', { ascending: false })
    .limit(1000);
  if (error) throw error;
  const map = new Map<string, { number: string; total: number; edit: boolean }[]>();
  for (const r of data || []) {
    const list = map.get(r.transaction_id) || [];
    list.push({ number: r.number, total: n(r.total), edit: r.reason === EDIT_REFUND_REASON });
    map.set(r.transaction_id, list);
  }
  return map;
}

/** A refund of a till sale, as the dashboards and shift report count it. */
export interface TillRefund {
  id: string;
  transactionId: string;
  businessId: string;
  /** When the refund was made (not when the sale was). */
  date: string;
  total: number;
  /** Cost of goods that went back on the shelf (0 when they were thrown away). */
  cost: number;
  settlement: 'refund' | 'wallet' | 'debt' | string;
  /** How money was paid back, for settlement 'refund'. */
  method: string | null;
  createdBy: string;
  /** The take-back of an edited sale: balances the figures but is not shown as a refund. */
  edit: boolean;
  lines: { productId: string | null; name: string; quantity: number; total: number }[];
}

/** The reason saved on the take-back of an edited sale (Sales Log → Edit sale). */
export const EDIT_REFUND_REASON = 'Sale corrected (redone in the till)';

/** Fired after a refund is saved, so open screens reload their refunds. */
export const REFUND_EVENT = 'isms:refund-recorded';

/** Refunds of till sales for these branches, made on or after `sinceIso`. */
export async function loadTillRefunds(businessIds: string | string[], sinceIso?: string): Promise<TillRefund[]> {
  const ids = (Array.isArray(businessIds) ? businessIds : [businessIds]).filter(Boolean).map((id) => toUuid(id));
  if (ids.length === 0) return [];
  let q = getSupabase()
    .from('credit_notes')
    .select('id, business_id, transaction_id, created_at, total, cost_total, return_stock, settlement, refund_method, created_by, reason, credit_note_lines(product_id, name, quantity, line_total)')
    .in('business_id', ids)
    .not('transaction_id', 'is', null)
    .order('created_at', { ascending: false })
    .limit(5000);
  if (sinceIso) q = q.gte('created_at', sinceIso);
  const { data, error } = await q;
  if (error) throw error;
  return (data || []).map((r: any) => ({
    id: r.id,
    transactionId: r.transaction_id,
    businessId: r.business_id,
    date: r.created_at,
    total: n(r.total),
    cost: r.return_stock ? n(r.cost_total) : 0,
    settlement: s(r.settlement),
    method: r.refund_method ?? null,
    createdBy: s(r.created_by),
    edit: r.reason === EDIT_REFUND_REASON,
    lines: (r.credit_note_lines || []).map((l: any) => ({ productId: l.product_id ?? null, name: s(l.name), quantity: n(l.quantity), total: n(l.line_total) })),
  }));
}

// ---------------------------------------------------------------- changing

export interface DocDraft {
  customerId: string | null;
  customerName: string;
  customerPhone: string;
  date: string;
  /** Quote: valid until. Order: expected delivery. */
  untilDate: string;
  notes: string;
  terms: string;
  deliveryFee: number;
  lines: DraftLine[];
}

function docPayload(d: DocDraft, kind: 'quote' | 'order') {
  return {
    customerId: d.customerId || null,
    customerName: d.customerName.trim(),
    customerPhone: d.customerPhone.trim(),
    [kind === 'quote' ? 'issueDate' : 'orderDate']: d.date || null,
    [kind === 'quote' ? 'validUntil' : 'expectedDate']: d.untilDate || null,
    notes: d.notes,
    terms: d.terms,
    deliveryFee: n(d.deliveryFee),
    lines: d.lines
      .filter((l) => l.name.trim() || l.productId)
      .map((l) => ({
        productId: l.productId || null, name: l.name.trim(), unit: l.unit.trim(), quantity: n(l.quantity),
        unitPrice: n(l.unitPrice), discountPct: n(l.discountPct), vatRate: n(l.vatRate),
      })),
  };
}

export const saveQuote = (businessId: string, draft: DocDraft, id?: string) =>
  rpc<string>('save_quote', { p_business_id: toUuid(businessId), p_id: id ? toUuid(id) : null, p_doc: docPayload(draft, 'quote') });
export const setQuoteStatus = (id: string, status: 'sent' | 'declined' | 'draft') => rpc('set_quote_status', { p_id: toUuid(id), p_status: status });
export const deleteQuote = (id: string) => rpc('delete_quote', { p_id: toUuid(id) });
export const quoteToOrder = (id: string) => rpc<string>('quote_to_order', { p_quote_id: toUuid(id) });

export const saveOrder = (businessId: string, draft: DocDraft, id?: string) =>
  rpc<string>('save_sales_order', { p_business_id: toUuid(businessId), p_id: id ? toUuid(id) : null, p_doc: docPayload(draft, 'order') });
export const cancelOrder = (id: string, reason: string) => rpc('cancel_sales_order', { p_id: toUuid(id), p_reason: reason });

type Qty = { lineId: string; quantity: number }[] | null;
const qtyPayload = (q: Qty) => (q ? q.filter((x) => x.quantity > 0).map((x) => ({ lineId: x.lineId, quantity: x.quantity })) : null);

export const deliverOrder = (orderId: string, lines: Qty, note?: string) =>
  rpc<string>('deliver_sales_order', { p_order_id: toUuid(orderId), p_lines: qtyPayload(lines), p_note: note || null });
export const cancelDelivery = (id: string, reason: string) => rpc('cancel_sales_delivery', { p_id: toUuid(id), p_reason: reason });
export const invoiceOrder = (orderId: string, lines: Qty, opts: { issueDate?: string; termsDays?: number; notes?: string } = {}) =>
  rpc<string>('invoice_sales_order', {
    p_order_id: toUuid(orderId), p_lines: qtyPayload(lines), p_issue_date: opts.issueDate || null,
    p_terms_days: opts.termsDays ?? null, p_notes: opts.notes || null,
  });
export const voidInvoice = (id: string, reason: string) => rpc('void_sales_invoice', { p_id: toUuid(id), p_reason: reason });
export const recordInvoicePayment = (
  invoiceId: string,
  p: { amount: number; method: MoneyMethod; reference?: string; paidAt?: string; paymentId?: string | null },
) =>
  rpc<string>('record_invoice_payment', {
    p_invoice_id: toUuid(invoiceId), p_amount: p.amount, p_method: p.method, p_reference: p.reference || null,
    p_paid_at: p.paidAt || null, p_payment_id: p.paymentId ? toUuid(p.paymentId) : null,
  });
export const voidInvoicePayment = (id: string, reason: string) => rpc('void_invoice_payment', { p_id: toUuid(id), p_reason: reason });
export const setCustomerTerms = (customerId: string, terms: 'pay_now' | 'weekly' | 'monthly') =>
  rpc('set_customer_payment_terms', { p_customer_id: toUuid(customerId), p_terms: terms });

export interface CreditNoteDraft {
  invoiceId?: string;
  transactionId?: string;
  /** Invoice line id or transaction item id → quantity. */
  quantities: Record<string, number>;
  reason: string;
  settlement: Settlement;
  method?: MoneyMethod;
  returnStock: boolean;
}

export function creditNotePayload(d: CreditNoteDraft) {
  const key = d.invoiceId ? 'invoiceLineId' : 'transactionItemId';
  return {
    invoiceId: d.invoiceId || null,
    transactionId: d.transactionId || null,
    reason: d.reason.trim(),
    settlement: d.settlement,
    method: d.settlement === 'refund' ? d.method || null : null,
    returnStock: d.returnStock,
    lines: Object.entries(d.quantities).filter(([, q]) => n(q) > 0).map(([id, q]) => ({ [key]: id, quantity: n(q) })),
  };
}

export const createCreditNote = (businessId: string, d: CreditNoteDraft) =>
  rpc<string>('create_credit_note', { p_business_id: toUuid(businessId), p_doc: creditNotePayload(d) });

// ---------------------------------------------------------------- sharing (same look as customer invoices)

export function toInvoiceDocument(args: {
  kind: 'quote' | 'invoice' | 'credit';
  number: string;
  issueDate: string;
  dueDate?: string;
  validUntil?: string;
  lines: DocLine[] | { name: string; quantity: number; total: number }[];
  subtotal: number;
  vat: number;
  deliveryFee: number;
  paid: number;
  balance: number;
  from: InvoiceParty;
  to: InvoiceParty;
  texts: InvoiceTexts;
  currency: string;
  accent: string;
  logoUrl?: string;
  closing?: InvoiceDocument['closing'];
  qr?: InvoiceDocument['qr'];
}): InvoiceDocument {
  const title = args.kind === 'quote' ? 'Quotation' : args.kind === 'credit' ? 'Credit note' : args.texts.title || 'Invoice';
  const lines: InvoiceLine[] = args.lines.map((l: any, i: number) =>
    'net' in l
      ? {
          id: l.id || String(i),
          kind: 'product' as const,
          description: l.discountPct ? `${l.name} (${l.discountPct}% off)` : l.name,
          quantity: l.quantity,
          unit: l.unit || undefined,
          unitPrice: l.quantity ? round2(l.net / l.quantity) : l.unitPrice,
          amount: l.net,
        }
      : { id: String(i), kind: 'product' as const, description: l.name, quantity: l.quantity, unitPrice: l.quantity ? round2(l.total / l.quantity) : l.total, amount: l.total },
  );
  if (args.deliveryFee > 0) {
    lines.push({ id: 'delivery', kind: 'delivery', description: 'Delivery', quantity: 1, unitPrice: args.deliveryFee, amount: args.deliveryFee });
  }
  const note = args.kind === 'quote' && args.validUntil
    ? `Valid until ${args.validUntil.split('-').reverse().join('/')}`
    : args.texts.note;
  return {
    invoiceNo: args.number,
    issuedAt: args.issueDate,
    dueAt: args.kind === 'invoice' ? args.dueDate || '' : '',
    currency: args.currency,
    accent: args.accent,
    logoUrl: args.logoUrl,
    from: args.from,
    to: args.to,
    lines,
    totals: { subtotal: round2(args.subtotal + args.deliveryFee), discount: 0, tax: args.vat, paid: args.paid, balance: args.balance },
    texts: {
      ...args.texts,
      title,
      note,
      showPaymentDetails: args.kind === 'invoice' ? args.texts.showPaymentDetails : false,
      paymentInstructions: args.kind === 'invoice' ? args.texts.paymentInstructions : '',
    },
    closing: args.closing,
    qr: args.qr,
  };
}

/** A quote sold at the till: marks it accepted and links it to the sale. */
export const markQuoteSold = (id: string, transactionId: string) =>
  rpc('mark_quote_sold', { p_id: toUuid(id), p_transaction_id: toUuid(transactionId) });
