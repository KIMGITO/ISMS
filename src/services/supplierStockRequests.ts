// src/services/supplierStockRequests.ts
// Asking a supplier for stock when a product runs low (20261123001_supplier_stock_requests.sql).
// The request rings on the phones of the people at that supplier who have the app; they
// accept or decline in their portal, and the person who asked gets a notification each step.
import { getSupabase } from './supabaseClient';

export type StockRequestStatus = 'sent' | 'seen' | 'accepted' | 'declined' | 'cancelled';

export interface StockRequest {
  id: string;
  productId: string | null;
  productName: string;
  unit: string | null;
  quantity: number;
  neededBy: string | null;
  note: string | null;
  status: StockRequestStatus;
  inApp: boolean;
  askedBy: string | null;
  createdAt: string;
  seenAt: string | null;
  respondedAt: string | null;
  respondedBy: string | null;
  deliveryDate: string | null;
  responseNote: string | null;
  supplierId: string;
  supplierName: string;
  supplierPhone: string | null;
}

export interface AskResult {
  id: string;
  /** True when it rang on at least one phone at the supplier. */
  inApp: boolean;
  people: number;
  supplierName: string;
  phone: string | null;
  email: string | null;
  /** The same words, ready for WhatsApp or SMS. */
  message: string;
}

export async function askSupplierForStock(input: {
  productId: string;
  quantity: number;
  neededBy: string | null;
  note: string;
  supplierId?: string | null;
}): Promise<AskResult> {
  const { data, error } = await getSupabase().rpc('ask_supplier_for_stock', {
    p_product_id: input.productId,
    p_quantity: input.quantity,
    p_needed_by: input.neededBy,
    p_note: input.note.trim() || null,
    p_supplier_id: input.supplierId ?? null,
  });
  if (error) throw error;
  return data as AskResult;
}

/** A supplier who could be asked; preferred first, then those who delivered it before. */
export interface StockRequestSupplier {
  id: string; name: string; contact: string; phone: string | null; preferred: boolean; inApp: boolean;
  times: number; lastDate: string | null; lastPrice: number | null;
}

export async function listStockRequestSuppliers(productId: string): Promise<StockRequestSupplier[]> {
  const { data, error } = await getSupabase().rpc('stock_request_suppliers', { p_product_id: productId });
  if (error) throw error;
  return ((data || []) as any[]).map((r) => ({ ...r, times: Number(r.times || 0), lastPrice: r.lastPrice == null ? null : Number(r.lastPrice) }));
}

export async function listStockRequests(businessId: string, productId?: string): Promise<StockRequest[]> {
  const { data, error } = await getSupabase().rpc('supplier_stock_requests_list', {
    p_business_id: businessId,
    p_product_id: productId ?? null,
  });
  if (error) throw error;
  return ((data || []) as any[]).map((r) => ({ ...r, quantity: Number(r.quantity) }));
}

export async function cancelStockRequest(id: string): Promise<void> {
  const { error } = await getSupabase().rpc('cancel_supplier_stock_request', { p_request_id: id });
  if (error) throw error;
}

/** "Waiting", "Seen", "Coming Tue 18 Nov", "Declined"... for a request's current state. */
export function stockRequestLabel(r: Pick<StockRequest, 'status' | 'deliveryDate' | 'inApp'>): string {
  switch (r.status) {
    case 'sent': return r.inApp ? 'Ringing, not seen yet' : 'Sent by message';
    case 'seen': return 'Seen, waiting for an answer';
    case 'accepted': return r.deliveryDate ? `Coming ${shortDay(r.deliveryDate)}` : 'Accepted';
    case 'declined': return 'Declined';
    case 'cancelled': return 'Cancelled';
  }
}

export function shortDay(iso: string): string {
  return new Date(`${iso.slice(0, 10)}T12:00:00`).toLocaleDateString('en-KE', { weekday: 'short', day: 'numeric', month: 'short' });
}

/** Today in Kenya, as YYYY-MM-DD. */
export function kenyaToday(offsetDays = 0): string {
  return new Date(Date.now() + 3 * 3600_000 + offsetDays * 86400_000).toISOString().slice(0, 10);
}
