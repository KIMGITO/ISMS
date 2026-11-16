// Smarter buying (supabase/migrations/20261118001_smarter_buying.sql): reorder levels and
// suggested orders, quotes from suppliers, approval limits, receiving in parts (GRNs),
// supplier bills, returns to suppliers, and transfer requests, drafts and shortages.
// The database checks permissions and limits, numbers the documents and posts to the
// books; this file calls those functions and shapes what they return.
import { getSupabase } from './supabaseClient';
import { toUuid } from '../utils/idUtils';

async function rpc<T = any>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await getSupabase().rpc(fn, args);
  if (error) throw error;
  return data as T;
}

const n = (v: unknown) => (v === null || v === undefined || v === '' ? 0 : Number(v) || 0);
const nOrNull = (v: unknown) => (v === null || v === undefined || v === '' ? null : Number(v));

/** Roles a limit can be set for. Owners and admins never need approval. */
export const LIMIT_ROLES = ['Manager', 'Inventory Manager', 'Inventory Staff', 'Sales Staff', 'Production Staff', 'Cashier', 'Staff'] as const;

// ---------------------------------------------------------------- reorder

export interface ReorderRow {
  productId: string;
  name: string;
  unit: string;
  sku: string | null;
  category: string;
  stock: number;
  cost: number;
  minStock: number;
  reorderLevel: number | null;
  reorderQty: number | null;
  /** The level in use: the reorder level, else the low-stock level. */
  level: number | null;
  supplierId: string | null;
  supplierName: string | null;
  supplierPrice: number | null;
  leadDays: number | null;
  sold30: number;
  avgDaily: number;
  suggestedLevel: number | null;
  onOrder: number;
  onTheWay: number;
  low: boolean;
  /** Still to get after what is on order or on the way. */
  need: number;
  transferFrom: { businessId: string; name: string; productId: string; spare: number } | null;
}

export async function loadReorder(businessId: string): Promise<{ products: ReorderRow[]; safetyDays: number }> {
  const r = await rpc('reorder_overview', { p_business_id: toUuid(businessId) });
  return {
    safetyDays: n(r?.safetyDays),
    products: (r?.products || []).map((p: any): ReorderRow => ({
      productId: p.productId,
      name: p.name,
      unit: p.unit || '',
      sku: p.sku,
      category: p.category || '',
      stock: n(p.stock),
      cost: n(p.cost),
      minStock: n(p.minStock),
      reorderLevel: nOrNull(p.reorderLevel),
      reorderQty: nOrNull(p.reorderQty),
      level: nOrNull(p.level),
      supplierId: p.supplierId,
      supplierName: p.supplierName,
      supplierPrice: nOrNull(p.supplierPrice),
      leadDays: nOrNull(p.leadDays),
      sold30: n(p.sold30),
      avgDaily: n(p.avgDaily),
      suggestedLevel: nOrNull(p.suggestedLevel),
      onOrder: n(p.onOrder),
      onTheWay: n(p.onTheWay),
      low: !!p.low,
      need: n(p.need),
      transferFrom: p.transferFrom ? { ...p.transferFrom, spare: n(p.transferFrom.spare) } : null,
    })),
  };
}

export interface ReorderSetting {
  productId: string;
  level: number | null;
  qty: number | null;
  supplierId: string | null;
  price: number | null;
  leadDays: number | null;
}

export const saveReorderSettings = (businessId: string, rows: ReorderSetting[]) =>
  rpc<number>('save_reorder_settings', { p_business_id: toUuid(businessId), p_rows: rows });

export const createSuggestedPurchases = (businessId: string, lines: { productId: string; quantity: number; supplierId?: string | null }[]) =>
  rpc<{ id: string; supplierName: string; total: number }[]>('create_suggested_purchases', { p_business_id: toUuid(businessId), p_lines: lines });

// ---------------------------------------------------------------- overview

export interface ApprovalPurchase {
  id: string;
  ref: string;
  supplier: string;
  total: number;
  by: string | null;
  date: string;
  mine: boolean;
  canApprove: boolean;
  items: { name: string; quantity: number; unit: string; price: number }[];
}

export interface ApprovalTransfer {
  id: string;
  reference: string;
  toName: string;
  by: string | null;
  createdAt: string;
  value: number;
  mine: boolean;
  canApprove: boolean;
}

export interface BillToCheck {
  id: string;
  number: string;
  supplier: string;
  subtotal: number;
  receiptsValue: number;
  difference: number;
  by: string | null;
}

export interface ToBill {
  purchaseId: string;
  ref: string;
  supplier: string;
  supplierId: string | null;
  value: number;
  receipts: { id: string; number: string; receivedAt: string; value: number }[];
}

export type BillStatus = 'needs_check' | 'open' | 'paid' | 'void';

export interface SupplierBill {
  id: string;
  number: string;
  supplier: string;
  supplierId: string | null;
  purchaseId: string | null;
  purchaseRef: string | null;
  supplierInvoiceNo: string | null;
  billDate: string;
  dueDate: string;
  subtotal: number;
  vatTotal: number;
  total: number;
  receiptsValue: number;
  difference: number;
  status: BillStatus;
  checkNote: string | null;
  approvedBy: string | null;
  paid: number;
  balance: number;
  note: string | null;
  by: string | null;
  voidReason: string | null;
  receipts: string[];
}

export interface SupplierReturn {
  id: string;
  number: string;
  supplier: string;
  purchaseId: string | null;
  reason: string;
  total: number;
  by: string | null;
  createdAt: string;
  lines: { name: string; quantity: number; unit: string; unitCost: number }[];
}

export interface BuyingOverview {
  settings: { tolerancePct: number; safetyDays: number; limits: { role: string; max: number }[]; canEdit: boolean; updatedBy: string | null; updatedAt: string | null };
  myRole: string | null;
  myLimit: number | null;
  approvals: { purchases: ApprovalPurchase[]; transfers: ApprovalTransfer[]; bills: BillToCheck[] };
  toBill: ToBill[];
  bills: SupplierBill[];
  returns: SupplierReturn[];
  dueSoon: { id: string; number: string; supplier: string; dueDate: string; balance: number }[];
}

export async function loadBuyingOverview(businessId: string): Promise<BuyingOverview> {
  const r = await rpc('buying_overview', { p_business_id: toUuid(businessId) });
  return {
    settings: {
      tolerancePct: n(r.settings?.tolerancePct),
      safetyDays: n(r.settings?.safetyDays),
      limits: (r.settings?.limits || []).map((l: any) => ({ role: l.role, max: n(l.max) })),
      canEdit: !!r.settings?.canEdit,
      updatedBy: r.settings?.updatedBy ?? null,
      updatedAt: r.settings?.updatedAt ?? null,
    },
    myRole: r.myRole ?? null,
    myLimit: nOrNull(r.myLimit),
    approvals: {
      purchases: (r.approvals?.purchases || []).map((p: any) => ({
        ...p,
        total: n(p.total),
        items: (p.items || []).map((i: any) => ({ ...i, quantity: n(i.quantity), price: n(i.price) })),
      })),
      transfers: (r.approvals?.transfers || []).map((t: any) => ({ ...t, value: n(t.value) })),
      bills: (r.approvals?.bills || []).map((b: any) => ({ ...b, subtotal: n(b.subtotal), receiptsValue: n(b.receiptsValue), difference: n(b.difference) })),
    },
    toBill: (r.toBill || []).map((t: any) => ({ ...t, value: n(t.value), receipts: (t.receipts || []).map((x: any) => ({ ...x, value: n(x.value) })) })),
    bills: (r.bills || []).map((b: any) => ({
      ...b,
      subtotal: n(b.subtotal), vatTotal: n(b.vatTotal), total: n(b.total), receiptsValue: n(b.receiptsValue),
      difference: n(b.difference), paid: n(b.paid), balance: n(b.balance), receipts: b.receipts || [],
    })),
    returns: (r.returns || []).map((x: any) => ({
      ...x, total: n(x.total), lines: (x.lines || []).map((l: any) => ({ ...l, quantity: n(l.quantity), unitCost: n(l.unitCost) })),
    })),
    dueSoon: (r.dueSoon || []).map((d: any) => ({ ...d, balance: n(d.balance) })),
  };
}

export const saveBuyingSettings = (businessId: string, tolerancePct: number, safetyDays: number, limits: { role: string; max: number | null }[]) =>
  rpc('save_buying_settings', {
    p_business_id: toUuid(businessId),
    p_tolerance_pct: tolerancePct,
    p_safety_days: safetyDays,
    p_limits: limits.filter((l) => l.max !== null && Number.isFinite(l.max)),
  });

// ---------------------------------------------------------------- approval

export const approvePurchase = (id: string, note?: string) => rpc('approve_purchase', { p_id: id, p_note: note || null });
export const rejectPurchase = (id: string, reason: string) => rpc('reject_purchase', { p_id: id, p_reason: reason });
/** Places a draft. Returns 'Ordered' or 'Awaiting approval'. */
export const placePurchaseOrder = (id: string) => rpc<string>('place_purchase_order', { p_id: id });

// ---------------------------------------------------------------- purchase details

export interface Receipt {
  id: string;
  number: string;
  receivedAt: string;
  by: string | null;
  note: string | null;
  value: number;
  damagedValue: number;
  billId: string | null;
  billNumber: string | null;
  lines: { name: string; unit: string; received: number; damaged: number; price: number }[];
}

export type QuoteStatus = 'asked' | 'priced' | 'won' | 'lost';

export interface SupplierQuote {
  id: string;
  supplierId: string | null;
  supplier: string;
  status: QuoteStatus;
  sentVia: string | null;
  deliveryDays: number | null;
  note: string | null;
  total: number;
  askedAt: string;
  pricedAt: string | null;
  phone: string | null;
  email: string | null;
  lines: { itemId: string; price: number; available: boolean }[];
}

export interface PurchaseDetails {
  receipts: Receipt[];
  quotes: SupplierQuote[];
  bills: { id: string; number: string; status: BillStatus; total: number; balance: number; billDate: string }[];
  returns: { id: string; number: string; total: number; createdAt: string }[];
  transfers: { id: string; reference: string; status: string; toName: string }[];
  unbilledValue: number;
}

export async function loadPurchaseDetails(purchaseId: string): Promise<PurchaseDetails> {
  const r = await rpc('purchase_details', { p_purchase_id: purchaseId });
  return {
    receipts: (r.receipts || []).map((x: any) => ({
      ...x, value: n(x.value), damagedValue: n(x.damagedValue),
      lines: (x.lines || []).map((l: any) => ({ ...l, received: n(l.received), damaged: n(l.damaged), price: n(l.price) })),
    })),
    quotes: (r.quotes || []).map((q: any) => ({
      ...q, total: n(q.total), deliveryDays: nOrNull(q.deliveryDays),
      lines: (q.lines || []).map((l: any) => ({ itemId: l.itemId, price: n(l.price), available: l.available !== false })),
    })),
    bills: (r.bills || []).map((b: any) => ({ ...b, total: n(b.total), balance: n(b.balance) })),
    returns: (r.returns || []).map((x: any) => ({ ...x, total: n(x.total) })),
    transfers: r.transfers || [],
    unbilledValue: n(r.unbilledValue),
  };
}

// ---------------------------------------------------------------- quotes from suppliers

export const askSupplierPrices = (purchaseId: string, supplierIds: string[], via: string) =>
  rpc<number>('ask_supplier_prices', { p_purchase_id: purchaseId, p_supplier_ids: supplierIds, p_via: via });

export const saveSupplierQuote = (quoteId: string, lines: { itemId: string; price: number; available: boolean }[], deliveryDays: number | null, note: string) =>
  rpc<number>('save_supplier_quote', { p_quote_id: quoteId, p_lines: lines, p_delivery_days: deliveryDays, p_note: note || null });

/** Returns 'Ordered' or 'Awaiting approval'. */
export const chooseSupplierQuote = (quoteId: string) => rpc<string>('choose_supplier_quote', { p_quote_id: quoteId });

/** The message sent to a supplier asking for prices. */
export function rfqMessage(business: string, ref: string, lines: { name: string; quantity: number; unit: string }[], supplier?: string): string {
  return [
    `Hello${supplier ? ` ${supplier}` : ''}, ${business} would like your prices for (${ref}):`,
    ...lines.map((l) => `• ${l.name}: ${l.quantity} ${l.unit}`),
    '',
    'Please reply with your price per unit for each, and when you can deliver. Thank you.',
  ].join('\n');
}

// ---------------------------------------------------------------- receiving

export interface ReceiveResult {
  receiptId: string;
  number: string;
  lines: number;
  stocked: number;
  value: number;
  damagedValue: number;
  complete: boolean;
  transfersDrafted: number;
}

export const receivePurchaseLines = (purchaseId: string, lines: { itemId: string; received: number; damaged: number }[], note: string, updateCost: boolean) =>
  rpc<ReceiveResult>('receive_purchase_lines', { p_purchase_id: purchaseId, p_lines: lines, p_note: note || null, p_update_cost: updateCost });

export const closePurchase = (id: string, reason: string) => rpc('close_purchase', { p_id: id, p_reason: reason });

// ---------------------------------------------------------------- bills

export interface BillDraft {
  purchaseId: string;
  receiptIds: string[];
  supplierInvoiceNo: string;
  billDate: string;
  dueDate: string;
  subtotal: number;
  vatTotal: number;
  note: string;
}

export const createSupplierBill = (businessId: string, d: BillDraft) =>
  rpc<{ id: string; number: string; status: BillStatus; difference: number; receiptsValue: number }>('create_supplier_bill', {
    p_business_id: toUuid(businessId),
    p_doc: { ...d, supplierInvoiceNo: d.supplierInvoiceNo || null, note: d.note || null },
  });

export const approveSupplierBill = (id: string, note: string) => rpc('approve_supplier_bill', { p_id: id, p_note: note });
export const voidSupplierBill = (id: string, reason: string) => rpc('void_supplier_bill', { p_id: id, p_reason: reason });

export const recordBillPayment = (billId: string, p: { amount: number; method: string; reference?: string; note?: string; paidAt?: string | null }) =>
  rpc<string>('record_bill_payment', {
    p_bill_id: billId,
    p_amount: p.amount,
    p_method: p.method,
    p_reference: p.reference || null,
    p_note: p.note || null,
    p_paid_at: p.paidAt || null,
  });

// ---------------------------------------------------------------- returns

export const createSupplierReturn = (
  businessId: string,
  d: { supplierId: string | null; supplierName: string; purchaseId: string | null; reason: string; lines: { productId: string; quantity: number; unitCost?: number | null }[] },
) => rpc<{ id: string; number: string; total: number }>('create_supplier_return', { p_business_id: toUuid(businessId), p_doc: d });

// ---------------------------------------------------------------- transfers

export interface Branch {
  id: string;
  name: string;
}

export async function listBranches(businessId: string): Promise<Branch[]> {
  const rows = await rpc<any[]>('list_transfer_branches', { p_business_id: toUuid(businessId) });
  return (rows || []).map((b) => ({ id: b.id, name: b.name }));
}

export const requestStockTransfer = (businessId: string, fromBusinessId: string, items: { productId: string; quantity: number }[], note: string) =>
  rpc<{ id: string; reference: string }>('request_stock_transfer', {
    p_to_business_id: toUuid(businessId),
    p_from_business_id: fromBusinessId,
    p_items: items.map((i) => ({ product_id: toUuid(i.productId), quantity: i.quantity })),
    p_note: note || null,
  });

/** Status after: 'in_transit', or 'awaiting_approval' when above the sender's limit. */
export const acceptTransferRequest = (id: string, items: { itemId: string; quantity: number }[]) =>
  rpc<{ status: string; reference: string }>('accept_transfer_request', { p_transfer_id: id, p_items: items.map((i) => ({ item_id: i.itemId, quantity: i.quantity })) });

export const declineTransferRequest = (id: string, reason: string) => rpc('decline_transfer_request', { p_transfer_id: id, p_reason: reason });

export const sendDraftTransfer = (id: string, items: { itemId: string; quantity: number }[]) =>
  rpc<{ status: string; reference: string }>('send_draft_transfer', { p_transfer_id: id, p_items: items.map((i) => ({ item_id: i.itemId, quantity: i.quantity })) });

export const approveStockTransfer = (id: string) => rpc<{ status: string; reference: string }>('approve_stock_transfer', { p_transfer_id: id });

export type ShortAction = 'late' | 'found' | 'written_off';

export const settleTransferShortage = (id: string, lines: { itemId: string; action: ShortAction; quantity: number }[], note: string) =>
  rpc('settle_transfer_shortage', {
    p_transfer_id: id,
    p_lines: lines.map((l) => ({ item_id: l.itemId, action: l.action, quantity: l.quantity })),
    p_note: note || null,
  });
