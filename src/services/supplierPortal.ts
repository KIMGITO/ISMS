// src/services/supplierPortal.ts
// The supplier side: people at a supplier sign in and see their own orders, price requests,
// deliveries and statement (20261119003_supplier_portal.sql). Every call is checked in the
// database against their supplier account; nothing here can reach staff data.
import { getSupabase } from './supabaseClient';
import { EmailService } from './emailService';

export interface SupplierAccount {
  accountId: string;
  businessId: string;
  businessName: string;
  businessLogo: string | null;
  businessPhone: string | null;
  supplierId: string;
  supplierName: string;
  can: { orders: boolean; priceRequests: boolean; deliveries: boolean; statement: boolean; updateDetails: boolean; stock: boolean; stockRequests?: boolean };
}

export interface PortalOrder {
  id: string; number: string; status: string; orderedAt: string; total: number; notes: string | null;
  confirmedAt: string | null; expectedDate: string | null; supplierNote: string | null;
  lines: { name: string; quantity: number; unit: string; price: number; received: number; damaged: number }[];
}
export interface PortalPriceRequest {
  id: string; status: 'asked' | 'priced' | 'won' | 'lost'; open: boolean; askedAt: string; pricedAt: string | null;
  total: number; deliveryDays: number | null; note: string | null; purchaseNotes: string | null;
  lines: { itemId: string; name: string; quantity: number; unit: string; price: number | null; available: boolean }[];
}
export interface PortalDelivery {
  id: string; number: string; receivedAt: string; receivedBy: string | null; note: string | null; orderNumber: string;
  value: number; damagedValue: number; lines: { name: string; unit: string; received: number; damaged: number }[];
}
export interface PortalBill { id: string; number: string; theirInvoice: string | null; date: string; dueDate: string | null; total: number; vat: number; paid: number; balance: number; status: string }
export interface PortalPayment { id: string; amount: number; method: string; paidAt: string; reference: string | null; bill: string | null }
export interface PortalReturn { id: string; number: string; date: string; reason: string | null; total: number; lines: { name: string; unit: string; quantity: number }[] }
export interface SupplierDetails {
  id: string; name: string; company: string | null; phone: string; email: string | null; kraPin: string | null;
  mpesaPaybill: string | null; mpesaAccount: string | null; mpesaTill: string | null; bankName: string | null; bankAccount: string | null;
}
export interface PortalData {
  supplier: SupplierDetails;
  orders: PortalOrder[]; priceRequests: PortalPriceRequest[]; deliveries: PortalDelivery[];
  bills: PortalBill[]; payments: PortalPayment[]; returns: PortalReturn[]; owed: number;
  stock: { name: string; unit: string; stock: number; reorderLevel: number | null }[];
}

/** Money and quantities come back from Postgres as strings; these fields become numbers. */
const NUMERIC = new Set(['total', 'quantity', 'price', 'received', 'damaged', 'value', 'damagedValue', 'vat', 'paid', 'balance', 'amount', 'owed', 'stock', 'reorderLevel', 'deliveryDays']);
function numbers<T>(v: T): T {
  if (Array.isArray(v)) return v.map(numbers) as any;
  if (v && typeof v === 'object') {
    const out: any = {};
    for (const [k, x] of Object.entries(v as any)) out[k] = NUMERIC.has(k) && x !== null && x !== '' ? Number(x) : numbers(x);
    return out;
  }
  return v;
}

async function call<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await getSupabase().rpc(fn, args);
  if (error) throw error;
  return numbers(data) as T;
}

export const loadSupplierAccounts = () => call<SupplierAccount[]>('supplier_portal_accounts');
export const loadPortalData = (businessId: string) => call<PortalData>('supplier_portal_data', { p_business_id: businessId });
export const sendPrices = (quoteId: string, lines: { itemId: string; price: number; available: boolean }[], deliveryDays: number | null, note: string) =>
  call<number>('supplier_portal_price', { p_quote_id: quoteId, p_lines: lines, p_delivery_days: deliveryDays, p_note: note || null });
export const confirmOrder = (purchaseId: string, expectedDate: string, note: string) =>
  call<void>('supplier_portal_confirm', { p_purchase_id: purchaseId, p_expected_date: expectedDate, p_note: note || null });
/** A business asking for stock (it rang on their phone). */
export interface PortalStockRequest {
  id: string; productName: string; unit: string | null; quantity: number; neededBy: string | null; note: string | null;
  status: 'sent' | 'seen' | 'accepted' | 'declined' | 'cancelled'; askedBy: string | null; askedAt: string;
  deliveryDate: string | null; responseNote: string | null; respondedAt: string | null;
}
export const loadPortalStockRequests = (businessId: string) =>
  call<PortalStockRequest[]>('supplier_portal_stock_requests', { p_business_id: businessId });
export const answerStockRequest = (id: string, accept: boolean, deliveryDate: string | null, note: string) =>
  call<void>('supplier_portal_answer_stock_request', { p_request_id: id, p_accept: accept, p_delivery_date: deliveryDate, p_note: note.trim() || null });

export const updateMyDetails = (businessId: string, d: Omit<SupplierDetails, 'id' | 'name' | 'company'>) =>
  call<void>('supplier_portal_update_details', { p_business_id: businessId, p_details: d });

// ── Staff side (Buying → Suppliers → App access) ──────────────────────────────────────────
export interface SupplierAccess {
  accounts: { id: string; name: string; email: string; since: string; lastSeen: string | null }[];
  invitations: { id: string; name: string; email: string; code: string; expiresAt: string }[];
}
export const loadSupplierAccess = (supplierId: string) => call<SupplierAccess>('supplier_access_list', { p_supplier_id: supplierId });
export const removeSupplierAccess = (ids: { accountId?: string; invitationId?: string }) =>
  call<void>('remove_supplier_access', { p_account_id: ids.accountId ?? null, p_invitation_id: ids.invitationId ?? null });

/** Invites someone at a supplier and emails them the code. Returns the code (shown, in case the email is slow). */
export async function inviteSupplierUser(supplierId: string, name: string, email: string, businessName: string): Promise<string> {
  const r = await call<{ id: string; code: string; supplierName: string }>('invite_supplier_user', {
    p_supplier_id: supplierId, p_name: name, p_email: email,
  });
  try {
    await EmailService.sendInvitation(email.trim(), r.code, name.trim() || r.supplierName, businessName, 'Supplier',
      `Sign in to see the orders ${businessName} places with ${r.supplierName}, send your prices and follow your payments.`);
  } catch {
    // The code still works; staff can share it by WhatsApp or SMS.
  }
  return r.code;
}
