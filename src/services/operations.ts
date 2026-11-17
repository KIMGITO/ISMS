// Suppliers, purchases, business assets, stored files and the audit log, read and written
// straight to the database. Row rules there decide who may do what (see
// 20261105014_role_enforcement.sql and 20261116001_suppliers_purchases_assets_files_audit.sql);
// the screens only hide buttons a role can't use.
import { getSupabase } from './supabaseClient';
import { toUuid } from '../utils/idUtils';

// ---------------------------------------------------------------- Suppliers

export interface Supplier {
  id: string;
  name: string;
  company: string;
  phone: string;
  email: string;
  productSupplied: string;
  notes: string;
  /** How they get paid; kept by the supplier in their portal (read-only here). */
  pay?: { kraPin: string; mpesaPaybill: string; mpesaAccount: string; mpesaTill: string; bankName: string; bankAccount: string; updatedBySupplierAt: string | null };
}

export type SupplierDraft = Omit<Supplier, 'id'>;

const toSupplier = (r: any): Supplier => ({
  id: r.id,
  name: r.name || '',
  company: r.company || '',
  phone: r.phone || '',
  email: r.email || '',
  productSupplied: r.product_supplied || '',
  notes: r.notes || '',
  pay: {
    kraPin: r.kra_pin || '', mpesaPaybill: r.mpesa_paybill || '', mpesaAccount: r.mpesa_account || '', mpesaTill: r.mpesa_till || '',
    bankName: r.bank_name || '', bankAccount: r.bank_account || '', updatedBySupplierAt: r.details_updated_by_supplier_at || null,
  },
});

export async function listSuppliers(businessId: string): Promise<Supplier[]> {
  const { data, error } = await getSupabase()
    .from('suppliers')
    .select('id, name, company, phone, email, product_supplied, notes, kra_pin, mpesa_paybill, mpesa_account, mpesa_till, bank_name, bank_account, details_updated_by_supplier_at')
    .eq('business_id', toUuid(businessId))
    .is('deleted_at', null)
    .order('name');
  if (error) throw error;
  return (data || []).map(toSupplier);
}

export async function saveSupplier(businessId: string, draft: SupplierDraft, id?: string, staffName = 'staff'): Promise<string> {
  const row = {
    name: draft.name.trim(),
    company: draft.company.trim() || null,
    phone: draft.phone.trim(),
    email: draft.email.trim() || null,
    product_supplied: draft.productSupplied.trim(),
    notes: draft.notes.trim() || null,
    last_modified_by: staffName,
  };
  const db = getSupabase().from('suppliers');
  if (id) {
    const { error } = await db.update(row).eq('id', id);
    if (error) throw error;
    return id;
  }
  const { data, error } = await db.insert({ ...row, business_id: toUuid(businessId) }).select('id').single();
  if (error) throw error;
  return String(data.id);
}

/** Soft delete: past purchases keep the supplier's name. */
export async function removeSupplier(id: string, staffName = 'staff') {
  const { error } = await getSupabase()
    .from('suppliers')
    .update({ deleted_at: new Date().toISOString(), last_modified_by: staffName })
    .eq('id', id);
  if (error) throw error;
}

// ---------------------------------------------------------------- Purchases

export type PurchaseStatus = 'Pending' | 'RFQ' | 'Awaiting approval' | 'Ordered' | 'Part received' | 'Received' | 'Cancelled';
export const PURCHASE_STATUSES: PurchaseStatus[] = ['Pending', 'RFQ', 'Awaiting approval', 'Ordered', 'Part received', 'Received', 'Cancelled'];
/** Still to finish: not yet ordered, waiting, or not everything has arrived. */
export const OPEN_PURCHASE: PurchaseStatus[] = ['Pending', 'RFQ', 'Awaiting approval', 'Ordered', 'Part received'];

export interface PurchaseLine {
  id?: string;
  productId: string | null;
  name: string;
  quantity: number;
  unit: string;
  /** Price per unit. */
  price: number;
  /** Arrived in good order so far (receiving in parts). */
  received?: number;
  /** Arrived damaged so far; not in stock. */
  damaged?: number;
  /** Central buying: the branch this line is for (null = this branch). */
  forBusinessId?: string | null;
  forBranchName?: string;
}

export interface PurchaseOrder {
  id: string;
  supplierId: string | null;
  supplierName: string;
  reference: string;
  status: PurchaseStatus;
  total: number;
  date: string;
  notes: string;
  createdBy: string;
  receivedAt: string | null;
  receivedBy: string | null;
  requestedByUserId: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  rejectedBy: string | null;
  rejectReason: string | null;
  orderedAt: string | null;
  closedNote: string | null;
  /** The supplier confirmed in their portal, with the day they will deliver. */
  supplierConfirmedAt?: string | null;
  supplierExpectedDate?: string | null;
  supplierNote?: string | null;
  lines: PurchaseLine[];
}

/** The number shown for a purchase until one is typed: PO- and the first 8 of its id. */
export const purchaseRef = (p: { id: string; reference?: string }) =>
  p.reference || `PO-${p.id.replace(/-/g, '').slice(0, 8).toUpperCase()}`;

export const lineTotal = (lines: PurchaseLine[]) =>
  Math.round(lines.reduce((s, l) => s + (Number(l.quantity) || 0) * (Number(l.price) || 0), 0) * 100) / 100;

export async function listPurchases(businessId: string, limit = 300): Promise<PurchaseOrder[]> {
  const { data, error } = await getSupabase()
    .from('purchases')
    .select('id, supplier_id, supplier_name, reference_number, status, total_amount, date, notes, created_by, received_at, received_by, requested_by_user_id, approved_by, approved_at, rejected_by, reject_reason, ordered_at, closed_note, supplier_confirmed_at, supplier_expected_date, supplier_note, purchase_items(id, product_id, name, quantity, unit, price, qty_received, qty_damaged, for_business_id, created_at)')
    .eq('business_id', toUuid(businessId))
    .order('date', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data || []).map((r: any) => ({
    id: r.id,
    supplierId: r.supplier_id,
    supplierName: r.supplier_name || '',
    reference: r.reference_number || '',
    status: r.status,
    total: Number(r.total_amount) || 0,
    date: r.date,
    notes: r.notes || '',
    createdBy: r.created_by || '',
    receivedAt: r.received_at,
    receivedBy: r.received_by,
    requestedByUserId: r.requested_by_user_id ?? null,
    approvedBy: r.approved_by ?? null,
    approvedAt: r.approved_at ?? null,
    rejectedBy: r.rejected_by ?? null,
    rejectReason: r.reject_reason ?? null,
    orderedAt: r.ordered_at ?? null,
    closedNote: r.closed_note ?? null,
    supplierConfirmedAt: r.supplier_confirmed_at ?? null,
    supplierExpectedDate: r.supplier_expected_date ?? null,
    supplierNote: r.supplier_note ?? null,
    lines: [...(r.purchase_items || [])]
      .sort((a: any, b: any) => String(a.created_at || '').localeCompare(String(b.created_at || '')))
      .map((i: any) => ({
        id: i.id,
        productId: i.product_id,
        name: i.name,
        quantity: Number(i.quantity) || 0,
        unit: i.unit || '',
        price: Number(i.price) || 0,
        received: Number(i.qty_received) || 0,
        damaged: Number(i.qty_damaged) || 0,
        forBusinessId: i.for_business_id ?? null,
      })),
  }));
}

export interface PurchaseDraft {
  supplierId: string | null;
  supplierName: string;
  reference: string;
  date: string;
  notes: string;
  status: 'Pending' | 'Ordered';
  lines: PurchaseLine[];
}

/**
 * Create a purchase, or rewrite one that hasn't been received. Lines are replaced as a
 * set: they're never edited once received, so there's no history to keep on them.
 * Saved as "Ordered" above the person's approval limit, the database makes it
 * "Awaiting approval"; the status it ended up with is returned.
 */
export async function savePurchase(businessId: string, draft: PurchaseDraft, staffName: string, id?: string): Promise<{ id: string; status: PurchaseStatus }> {
  const db = getSupabase();
  const lines = draft.lines.filter((l) => l.name.trim() && Number(l.quantity) > 0);
  const head = {
    supplier_id: draft.supplierId,
    supplier_name: draft.supplierName.trim(),
    reference_number: draft.reference.trim() || null,
    date: draft.date,
    notes: draft.notes.trim() || null,
    status: draft.status,
    total_amount: lineTotal(lines),
  };
  let purchaseId = id;
  if (id) {
    const { error } = await db.from('purchases').update(head).eq('id', id);
    if (error) throw error;
    const { error: delErr } = await db.from('purchase_items').delete().eq('purchase_id', id);
    if (delErr) throw delErr;
  } else {
    const { data, error } = await db
      .from('purchases')
      .insert({ ...head, business_id: toUuid(businessId), created_by: staffName })
      .select('id')
      .single();
    if (error) throw error;
    purchaseId = data.id;
  }
  if (lines.length) {
    const { error } = await db.from('purchase_items').insert(
      lines.map((l) => ({
        purchase_id: purchaseId,
        product_id: l.productId,
        name: l.name.trim(),
        quantity: Number(l.quantity),
        unit: l.unit.trim() || 'pcs',
        price: Number(l.price) || 0,
        for_business_id: l.forBusinessId || null,
      })),
    );
    if (error) throw error;
  }
  const { data: after } = await db.from('purchases').select('status').eq('id', purchaseId!).maybeSingle();
  return { id: purchaseId!, status: ((after as any)?.status || draft.status) as PurchaseStatus };
}

export async function setPurchaseStatus(id: string, status: 'Pending' | 'Ordered' | 'Cancelled') {
  const { error } = await getSupabase().from('purchases').update({ status }).eq('id', id);
  if (error) throw error;
}

/** Marks it received and adds every line linked to a product to stock. Returns how many lines were stocked. */
export async function receivePurchase(id: string, staffName: string, updateCost: boolean): Promise<number> {
  const { data, error } = await getSupabase().rpc('receive_purchase', {
    p_purchase_id: id,
    p_staff_name: staffName,
    p_update_cost: updateCost,
  });
  if (error) throw error;
  return Number(data) || 0;
}

export async function deletePurchase(id: string) {
  const { error } = await getSupabase().from('purchases').delete().eq('id', id);
  if (error) throw error;
}

// ---------------------------------------------------------------- Assets

export type AssetStatus = 'Active' | 'Under Repair' | 'Disposed' | 'Sold';
export const ASSET_STATUSES: AssetStatus[] = ['Active', 'Under Repair', 'Disposed', 'Sold'];

export interface Asset {
  id: string;
  name: string;
  code: string;
  serialNumber: string;
  value: number;
  status: AssetStatus;
  location: string;
  purchasedOn: string;
  notes: string;
}

export type AssetDraft = Omit<Asset, 'id'>;

export async function listAssets(businessId: string): Promise<Asset[]> {
  const { data, error } = await getSupabase()
    .from('business_assets')
    .select('id, name, code, serial_number, value, status, location, purchased_on, notes')
    .eq('business_id', toUuid(businessId))
    .order('name');
  if (error) throw error;
  return (data || []).map((r: any) => ({
    id: r.id,
    name: r.name,
    code: r.code || '',
    serialNumber: r.serial_number || '',
    value: Number(r.value) || 0,
    status: r.status,
    location: r.location || '',
    purchasedOn: r.purchased_on || '',
    notes: r.notes || '',
  }));
}

export async function saveAsset(businessId: string, draft: AssetDraft, id?: string) {
  const row = {
    name: draft.name.trim(),
    code: draft.code.trim(),
    serial_number: draft.serialNumber.trim() || null,
    value: Number(draft.value) || 0,
    status: draft.status,
    location: draft.location.trim() || null,
    purchased_on: draft.purchasedOn || null,
    notes: draft.notes.trim() || null,
  };
  const db = getSupabase().from('business_assets');
  const { error } = id ? await db.update(row).eq('id', id) : await db.insert({ ...row, business_id: toUuid(businessId) });
  if (error) throw error;
}

export async function deleteAsset(id: string) {
  const { error } = await getSupabase().from('business_assets').delete().eq('id', id);
  if (error) throw error;
}

/** Next free code like AST-004, from the codes already used. */
export function nextAssetCode(assets: Asset[]): string {
  const max = assets.reduce((m, a) => {
    const n = /^AST-(\d+)$/i.exec(a.code)?.[1];
    return n ? Math.max(m, Number(n)) : m;
  }, 0);
  return `AST-${String(max + 1).padStart(3, '0')}`;
}

// ---------------------------------------------------------------- Files

export const FILES_BUCKET = 'business-files';
export const MAX_FILE_BYTES = 20 * 1024 * 1024;
/** What the bucket accepts; anything else is refused before upload with a clear message. */
export const FILE_TYPES = [
  'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif', 'image/heic', 'image/heif',
  'application/pdf', 'text/plain', 'text/csv',
  'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-powerpoint', 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/zip',
];
export const FILE_ACCEPT = '.jpg,.jpeg,.png,.webp,.gif,.avif,.heic,.pdf,.txt,.csv,.xls,.xlsx,.doc,.docx,.ppt,.pptx,.zip';

export interface StoredFile {
  id: string;
  name: string;
  size: string;
  sizeBytes: number | null;
  type: string;
  path: string | null;
  uploadedBy: string;
  date: string;
  notes: string;
}

export const formatBytes = (n: number) =>
  n < 1024 ? `${n} B` : n < 1024 ** 2 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1024 ** 2).toFixed(1)} MB`;

export async function listFiles(businessId: string): Promise<StoredFile[]> {
  const { data, error } = await getSupabase()
    .from('storage_files')
    .select('id, name, size, size_bytes, type, url, storage_path, uploaded_by, date, notes')
    .eq('business_id', toUuid(businessId))
    .order('date', { ascending: false });
  if (error) throw error;
  return (data || []).map((r: any) => ({
    id: r.id,
    name: r.name,
    size: r.size || '',
    sizeBytes: r.size_bytes,
    type: r.type || '',
    path: r.storage_path || null,
    uploadedBy: r.uploaded_by || '',
    date: r.date,
    notes: r.notes || '',
  }));
}

export async function uploadFile(businessId: string, file: File, staffName: string, notes = '') {
  if (file.size > MAX_FILE_BYTES) throw new Error(`${file.name} is ${formatBytes(file.size)}. Files can be up to 20 MB.`);
  if (file.type && !FILE_TYPES.includes(file.type)) {
    throw new Error(`${file.name} can't be stored. Use a photo, PDF, Word, Excel, PowerPoint, text, CSV or zip file.`);
  }
  const db = getSupabase();
  const safe = file.name.replace(/[^\w.\- ]+/g, '_').replace(/\s+/g, ' ').slice(-120);
  const path = `${toUuid(businessId)}/files/${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${safe}`;
  const { error: upErr } = await db.storage.from(FILES_BUCKET).upload(path, file, {
    contentType: file.type || 'application/octet-stream',
    upsert: false,
  });
  if (upErr) throw upErr;
  const { error } = await db.from('storage_files').insert({
    business_id: toUuid(businessId),
    name: file.name,
    size: formatBytes(file.size),
    size_bytes: file.size,
    type: file.type || 'application/octet-stream',
    url: path,
    storage_path: path,
    uploaded_by: staffName,
    notes: notes.trim() || null,
  });
  if (error) {
    // Don't leave a file nobody can see in the list.
    await db.storage.from(FILES_BUCKET).remove([path]);
    throw error;
  }
}

/** A link that works for a few minutes; the bucket is private. */
export async function fileLink(file: StoredFile, download = false): Promise<string> {
  if (!file.path) throw new Error('This file was listed before files were stored online, so there is nothing to open.');
  const { data, error } = await getSupabase()
    .storage.from(FILES_BUCKET)
    .createSignedUrl(file.path, 300, download ? { download: file.name } : undefined);
  if (error) throw error;
  return data.signedUrl;
}

export async function deleteFile(file: StoredFile) {
  const db = getSupabase();
  if (file.path) {
    const { error } = await db.storage.from(FILES_BUCKET).remove([file.path]);
    if (error) throw error;
  }
  const { error } = await db.from('storage_files').delete().eq('id', file.id);
  if (error) throw error;
}

// ---------------------------------------------------------------- Audit log

export interface AuditEntry {
  id: string;
  action: string;
  table: string;
  recordId: string;
  label: string;
  by: string;
  at: string;
  changes: Record<string, { from: unknown; to: unknown }>;
  details: Record<string, unknown>;
}

export async function listAudit(
  businessId: string,
  opts: { since?: string; table?: string; limit?: number } = {},
): Promise<AuditEntry[]> {
  let q = getSupabase()
    .from('audit_logs')
    .select('id, action, table_name, record_id, details, timestamp')
    .eq('business_id', toUuid(businessId))
    .order('timestamp', { ascending: false })
    .limit(opts.limit ?? 300);
  if (opts.since) q = q.gte('timestamp', opts.since);
  if (opts.table) q = q.eq('table_name', opts.table);
  const { data, error } = await q;
  if (error) throw error;
  return (data || []).map((r: any) => {
    const d = (r.details && typeof r.details === 'object' ? r.details : {}) as Record<string, any>;
    return {
      id: r.id,
      action: r.action,
      table: r.table_name || '',
      recordId: r.record_id || '',
      label: String(d.label ?? d.employee_name ?? d.name ?? ''),
      by: String(d.by ?? d.staff_name ?? ''),
      at: r.timestamp,
      changes: (d.changes && typeof d.changes === 'object' ? d.changes : {}) as AuditEntry['changes'],
      details: d,
    };
  });
}

/**
 * Changes made to sales after they were made (amounts, items, customer, note…), by sale id,
 * oldest first. The database writes these itself (20261125001); nobody can skip or edit them.
 */
export async function listSaleEdits(businessId: string, sinceDays = 120): Promise<Map<string, AuditEntry[]>> {
  const since = new Date(Date.now() - sinceDays * 86_400_000).toISOString();
  const entries = await listAudit(businessId, { since, table: 'transactions', limit: 1000 });
  const bySale = new Map<string, AuditEntry[]>();
  for (const e of entries.reverse()) {
    if (e.action === 'CREATE') continue;
    const list = bySale.get(e.recordId) ?? [];
    list.push(e);
    bySale.set(e.recordId, list);
  }
  return bySale;
}

/** Plain words for the tables the log covers. */
export const AUDIT_TABLES: Record<string, string> = {
  products: 'Product',
  suppliers: 'Supplier',
  purchases: 'Purchase',
  business_assets: 'Asset',
  storage_files: 'File',
  employees: 'Staff',
  transactions: 'Sale',
};

/** "Price: 50 → 60", for the fields people care about, in plain words. */
const FIELD_LABELS: Record<string, string> = {
  name: 'Name', price: 'Price', cost: 'Cost', category: 'Category', sku: 'SKU', unit: 'Unit',
  min_stock: 'Low-stock level', status: 'Status', phone: 'Phone', email: 'Email', company: 'Company',
  product_supplied: 'Supplies', value: 'Value', location: 'Location', serial_number: 'Serial',
  code: 'Code', total_amount: 'Total', supplier_name: 'Supplier', reference_number: 'Number',
  deleted_at: 'Removed', notes: 'Notes', note: 'Note',
  final_total: 'Total', total: 'Before discounts', discount: 'Discount', tax: 'VAT', amount_paid: 'Paid',
  payment_method: 'Payment', customer_name: 'Customer', customer_id: 'Customer link', delivery_fee: 'Delivery fee',
  delivery_mode: 'Delivery paid', rider_pay: 'Rider pay', is_delivery: 'Delivery', timestamp: 'Time of sale', wallet_applied: 'From wallet',
  staff_name: 'Sold by', received_by: 'Received by', created_by: 'Created by', supplier_id: 'Supplier link', description: 'Description', image: 'Photo', is_active: 'On sale',
};

export function describeChanges(changes: AuditEntry['changes']): string[] {
  return Object.entries(changes)
    .filter(([k]) => !['received_at', 'image_url', 'search_text'].includes(k))
    .map(([k, v]) => {
      const label = FIELD_LABELS[k] || k.replace(/_/g, ' ');
      const show = (x: unknown) => (x === null || x === undefined || x === '' ? '—' : typeof x === 'object' ? JSON.stringify(x) : String(x));
      if (k === 'deleted_at') return v.to ? 'Removed' : 'Brought back';
      if (k === 'image') return 'Photo changed';
      return `${label}: ${show(v.from)} → ${show(v.to)}`;
    });
}

export function describeAction(e: AuditEntry): string {
  const what = AUDIT_TABLES[e.table] || (e.table ? e.table.replace(/_/g, ' ') : 'Record');
  switch (e.action) {
    case 'CREATE': return `${what} added`;
    case 'DELETE': return `${what} removed`;
    case 'RESTORE': return `${what} brought back`;
    case 'STATUS': return `${what} marked ${String(e.details.status || '').toLowerCase()}`;
    case 'UPDATE': return `${what} changed`;
    case 'UPDATE_PIN': return 'PIN changed';
    case 'UPDATE_ROLE': return `Role changed to ${String(e.details.new_role || '')}`;
    default: return e.action.replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
  }
}
