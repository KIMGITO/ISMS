// src/services/repositories.ts
// Reads and writes for the tables the app uses, one repository per kind of record. Online first:
// every call goes to the database.

import { AppError } from "../utils/userError";
import { getSupabase } from "./supabaseClient";
import { toUuid } from "../utils/idUtils";
import { customerName } from "../utils/stringUtils";
import { OPEN_TILL_STATUSES } from "../types";
import { Product, Transaction, Customer, Expense, ExpenseCategory, InventoryAdjustment, Payment, TillPayment, TillSaleCandidate, TillPaymentEvent, TillAllocation, StkException, MpesaPrompt, PaymentPrompt, PromptProvider } from "../types";
import { useBusinessStore } from "../stores/businessStore";
import { SupabaseService } from "./supabaseService";
import { normalizeForStorage, readableIds } from "../utils/stringUtils";

const getActiveBusinessId = (): string | null => {
  try {
    return useBusinessStore.getState().activeBusinessId;
  } catch {
    return null;
  }
};

export type SQLiteRow<T> = T & {
  created_at?: string;
  updated_at?: string;
  deleted_at?: string | null;
  version?: number;
  sync_status?: string;
  last_modified_by?: string;
};

// Helper to standard dispatch network failure context events
const triggerNetworkFailureEvent = () => {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event("network-action-failed"));
  }
};

/**
 * Every row of a query, read 1,000 at a time (the API returns at most 1,000 per request, so a
 * shop with 1,500 products used to see only the first 1,000 at the till). `page` builds the
 * query for one range; its order must be stable (end with "id").
 */
export async function allPages<T>(
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: any }>,
  maxRows = 50_000,
): Promise<T[]> {
  const SIZE = 1000;
  const out: T[] = [];
  for (let from = 0; from < maxRows; from += SIZE) {
    const { data, error } = await page(from, from + SIZE - 1);
    if (error) throw error;
    out.push(...(data || []));
    if (!data || data.length < SIZE) break;
  }
  return out;
}

/**
 * Keeps a list current from live changes without reading the whole list again: the change
 * already carries the row. (Every sale changes stock, and each change used to make every open
 * device download every product again.) Rows with deleted_at set leave the list.
 */
export function liveList<T extends { id: string }>(
  map: (row: any) => T,
  sortKey: (item: T) => string,
  emit: (list: T[]) => void,
) {
  let current: T[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;
  const publish = () => {
    timer = undefined;
    emit(current);
  };
  return {
    set(list: T[]) {
      current = list;
      if (timer) { clearTimeout(timer); timer = undefined; }
      emit(current);
    },
    apply(payload: any) {
      const row = payload?.new && Object.keys(payload.new).length ? payload.new : null;
      const id = String(row?.id ?? payload?.old?.id ?? "");
      if (!id) return false;
      const was = current.findIndex((x) => String(x.id) === id);
      const rest = was < 0 ? current : [...current.slice(0, was), ...current.slice(was + 1)];
      if (payload.eventType === "DELETE" || !row || row.deleted_at) {
        current = rest;
      } else {
        const item = map(row);
        const key = sortKey(item);
        if (was >= 0 && sortKey(current[was]) === key) {
          // Same name (a stock or price change): keep its place.
          current = [...current.slice(0, was), item, ...current.slice(was + 1)];
        } else {
          const at = rest.findIndex((x) => sortKey(x).localeCompare(key) > 0);
          current = at < 0 ? [...rest, item] : [...rest.slice(0, at), item, ...rest.slice(at)];
        }
      }
      // A sale changes several products at once: show them together.
      if (!timer) timer = setTimeout(publish, 300);
      return true;
    },
    stop() { if (timer) clearTimeout(timer); },
  };
}

/** One products row as the app's Product. */
function rowToProduct(p: any): SQLiteRow<Product> {
  return {
    id: p.id,
    name: p.name,
    category: p.category,
    price: Number(p.price),
    cost: Number(p.cost),
    image: p.image || "",
    stock: Number(p.stock),
    minStock: Number(p.min_stock),
    unit: p.unit,
    sku: p.sku || "",
    description: p.description || "",
    perishable: p.perishable,
    expiryDays: p.expiry_days,
    businessId: p.business_id,
    sync_status: "synced"
  };
}

// ─────────────────────────────────────────────
// PRODUCT REPOSITORY (With Soft Deletion)
// ─────────────────────────────────────────────
export class ProductRepository {
  // ── FIX: Add No-Op Stub to prevent SyncEngine crashes ──
  public static setAll(_products: any[]) {}

  /** Reloads the product list the open subscription shows (pull to refresh). */
  private static reloadActive: (() => Promise<void>) | null = null;
  public static async reload(): Promise<void> {
    await this.reloadActive?.();
  }

  public static async getAll(): Promise<SQLiteRow<Product>[]> {
    const supabase = getSupabase();
    const activeBusinessId = getActiveBusinessId();

    try {
      const rows = await allPages<any>((from, to) => supabase
        .from("products")
        .select("*")
        .eq("business_id", activeBusinessId)
        .is("deleted_at", null)
        .order("name")
        .order("id")
        .range(from, to));
      return rows.map(rowToProduct);
    } catch (error) {
      triggerNetworkFailureEvent();
      throw error;
    }
  }

  public static async getById(id: string): Promise<SQLiteRow<Product> | null> {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from("products")
      .select("*")
      .eq("id", id)
      .is("deleted_at", null)
      .maybeSingle();

    if (error) { triggerNetworkFailureEvent(); throw error; }
    if (!data) return null;

    return {
      id: data.id,
      name: data.name,
      category: data.category,
      price: Number(data.price),
      cost: Number(data.cost),
      image: data.image || "",
      stock: Number(data.stock),
      minStock: Number(data.min_stock),
      unit: data.unit,
      sku: data.sku || "",
      description: data.description || "",
      perishable: data.perishable,
      expiryDays: data.expiry_days,
      businessId: data.business_id,
      sync_status: "synced"
    };
  }

  public static subscribe(callback: (products: SQLiteRow<Product>[]) => void): () => void {
    const list = liveList(rowToProduct, (p) => `${String(p.name).toLowerCase()} ${p.id}`, callback);
    const reload = () => this.getAll().then((all) => list.set(all));
    this.reloadActive = reload;
    reload().catch(console.error);

    if (typeof global !== "undefined" && (global as any).IS_TEST) {
      return () => {};
    }

    const activeBusinessId = getActiveBusinessId();
    const supabase = getSupabase();
    const channelId = Math.random().toString(36).substring(2, 10);

    const channel = supabase
      .channel(`realtime-products-${activeBusinessId}-${channelId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "products", filter: `business_id=eq.${activeBusinessId}` },
        (payload: any) => { if (!list.apply(payload)) this.getAll().then((all) => list.set(all)).catch(console.error); }
      )
      .subscribe();

    return () => {
      if (this.reloadActive === reload) this.reloadActive = null;
      list.stop();
      supabase.removeChannel(channel);
    };
  }

  public static async add(product: Omit<Product, "id" | "created_at" | "updated_at"> & { id?: string }): Promise<SQLiteRow<Product>> {
    const supabase = getSupabase();
    const activeBusinessId = getActiveBusinessId();
    
    const payload = {
      id: product.id ? toUuid(product.id) : undefined,
      business_id: toUuid(product.businessId || activeBusinessId),
      name: normalizeForStorage(product.name),
      category: normalizeForStorage(product.category),
      price: product.price,
      cost: product.cost,
      image: product.image,
      stock: product.stock,
      min_stock: product.minStock,
      unit: normalizeForStorage(product.unit),
      sku: product.sku ? normalizeForStorage(product.sku) : product.sku,
      description: product.description ? normalizeForStorage(product.description) : product.description,
      perishable: product.perishable,
      expiry_days: product.expiryDays,
    };

    const { data, error } = await supabase.from("products").insert(payload).select().single();
    if (error) { triggerNetworkFailureEvent(); throw error; }

    return {
      id: data.id,
      name: data.name,
      category: data.category,
      price: Number(data.price),
      cost: Number(data.cost),
      image: data.image || "",
      stock: Number(data.stock),
      minStock: Number(data.min_stock),
      unit: data.unit,
      sku: data.sku || "",
      description: data.description || "",
      perishable: data.perishable,
      expiryDays: data.expiry_days,
      businessId: data.business_id,
      sync_status: "synced",
    };
  }

  public static async update(id: string, updates: Partial<Product>): Promise<SQLiteRow<Product> | null> {
    const supabase = getSupabase();
    const payload: Record<string, any> = {};
    
    if (updates.name !== undefined) payload.name = normalizeForStorage(updates.name);
    if (updates.category !== undefined) payload.category = normalizeForStorage(updates.category);
    if (updates.price !== undefined) payload.price = updates.price;
    if (updates.cost !== undefined) payload.cost = updates.cost;
    if (updates.image !== undefined) payload.image = updates.image;
    if (updates.stock !== undefined) payload.stock = updates.stock;
    if (updates.minStock !== undefined) payload.min_stock = updates.minStock;
    if (updates.unit !== undefined) payload.unit = normalizeForStorage(updates.unit);
    if (updates.sku !== undefined) payload.sku = updates.sku ? normalizeForStorage(updates.sku) : updates.sku;
    if (updates.description !== undefined) payload.description = updates.description ? normalizeForStorage(updates.description) : updates.description;
    if (updates.perishable !== undefined) payload.perishable = updates.perishable;
    if (updates.expiryDays !== undefined) payload.expiry_days = updates.expiryDays;

    const { data, error } = await supabase.from("products").update(payload).eq("id", id).select().single();
    if (error) { triggerNetworkFailureEvent(); throw error; }

    return {
      id: data.id,
      name: data.name,
      category: data.category,
      price: Number(data.price),
      cost: Number(data.cost),
      image: data.image || "",
      stock: Number(data.stock),
      minStock: Number(data.min_stock),
      unit: data.unit,
      sku: data.sku || "",
      description: data.description || "",
      perishable: data.perishable,
      expiryDays: data.expiry_days,
      businessId: data.business_id,
      sync_status: "synced",
    };
  }

  public static async delete(id: string): Promise<boolean> {
    const supabase = getSupabase();
    const { error } = await supabase
      .from("products")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", id);

    if (error) { triggerNetworkFailureEvent(); throw error; }
    return true;
  }
}

// ─────────────────────────────────────────────
// TRANSACTION REPOSITORY (TYPES REMAPPED)
// ─────────────────────────────────────────────
export class TransactionRepository {
  // ── FIX: Add No-Op Stub to prevent SyncEngine crashes ──
  public static setAll(_transactions: any[]) {}

  /** Reloads the sales list the open subscription shows (refresh, back online, offline sales sent). */
  private static reloadActive: (() => Promise<void>) | null = null;
  public static async reload(): Promise<void> {
    await this.reloadActive?.();
  }

  /** All of this branch's sales, or just the ones given (after a live change). */
  public static async getAll(ids?: string[]): Promise<SQLiteRow<Transaction>[]> {
    const supabase = getSupabase();
    const activeBusinessId = getActiveBusinessId();

    let query = supabase
      .from("transactions")
      .select(`
        *,
        transaction_items (
          *,
          products (id, name, category, image, stock, min_stock, unit, sku, price, cost)
        )
      `)
      .eq("business_id", activeBusinessId)
      .is("deleted_at", null);
    // The newest 1,000 (the API's row cap, now explicit). Older sales: Sales log search and reports.
    query = ids ? query.in("id", ids) : query.limit(1000);
    const { data, error } = await query.order("timestamp", { ascending: false });

    if (error) { triggerNetworkFailureEvent(); throw error; }

    return (data || []).map(t => ({
      id: t.id,
      businessId: t.business_id,
      total: Number(t.total || 0),
      discount: Number(t.discount || 0),
      tax: Number(t.tax || 0),
      finalTotal: Number(t.final_total || 0),
      paymentMethod: t.payment_method,
      customerId: t.customer_id,
      customerName: customerName(t.customer_name),
      staffId: t.staff_id,
      staffName: t.staff_name,
      timestamp: t.timestamp,
      note: t.note || "",
      isDelivery: t.is_delivery,
      deliveryFee: Number(t.delivery_fee || 0),
      deliveryMode: t.delivery_mode || "charged",
      riderPay: Number(t.rider_pay || 0),
      riderName: t.rider_name || "",
      referenceId: t.reference_id || undefined,
      walletApplied: Number(t.wallet_applied) || 0,
      promotionCode: t.promotion_code || undefined,
      promotionDiscount: Number(t.promotion_discount) || 0,
      status: "Synced" as const,
      sync_status: "synced",
      items: (t.transaction_items || []).map((ti: any) => ({
        product: {
          id: ti.products?.id ?? ti.product_id,
          name: ti.products?.name ?? ti.product_name ?? "Unknown Item",
          category: ti.products?.category ?? "",
          // What the customer was charged, not today's price
          price: Number(ti.unit_price ?? ti.products?.price ?? 0),
          cost: Number(ti.unit_cost ?? ti.products?.cost ?? 0),
          image: ti.products?.image ?? "",
          stock: Number(ti.products?.stock ?? 0),
          minStock: Number(ti.products?.min_stock ?? 0),
          unit: ti.products?.unit ?? "unit",
          sku: ti.products?.sku ?? "",
        },
        quantity: Number(ti.quantity || 0),
        discountPercentage: Number(ti.discount_percentage || 0),
      })),
    }));
  }

  public static subscribe(callback: (transactions: SQLiteRow<Transaction>[]) => void): () => void {
    let activeChannel: any = null;
    let isCancelled = false;

    // A live change fetches only the sales that changed and merges them in. Reloading every
    // sale (with items and products) after each one made the till slower with every sale.
    let current: SQLiteRow<Transaction>[] = [];
    const emit = (list: SQLiteRow<Transaction>[]) => {
      if (isCancelled) return;
      current = list;
      callback(list);
    };
    const changed = new Set<string>();
    const retried = new Set<string>();
    let flushTimer: ReturnType<typeof setTimeout> | undefined;
    // Waits a moment: a sale's items are written just after the sale itself.
    const flush = async () => {
      flushTimer = undefined;
      const ids = Array.from(changed);
      changed.clear();
      if (ids.length === 0) return;
      try {
        const fresh = await this.getAll(ids);
        const gone = new Set(ids);
        const merged = [...fresh, ...current.filter((t) => !gone.has(t.id))];
        merged.sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp)));
        emit(merged);
        // On a slow line the items can land after we looked: look once more for a new sale
        // that came back without them.
        const late = fresh.filter((t) => (t.items || []).length === 0 && !retried.has(t.id));
        if (late.length) {
          late.forEach((t) => { retried.add(t.id); changed.add(t.id); });
          if (!flushTimer) flushTimer = setTimeout(() => void flush(), 2500);
        }
      } catch (err) {
        console.error(err);
      }
    };

    const reload = () => this.getAll().then(emit);
    this.reloadActive = reload;
    reload().catch(console.error);

    setTimeout(() => {
      if (isCancelled) return;
      if (typeof global !== "undefined" && (global as any).IS_TEST) return;
      try {
        const activeBusinessId = getActiveBusinessId();
        const supabase = getSupabase();
        const filterString = `business_id=eq.${activeBusinessId}`;
        const channelId = Math.random().toString(36).substring(2, 10);

        activeChannel = supabase
          .channel(`realtime-transactions-${activeBusinessId}-${channelId}`)
          .on(
            "postgres_changes",
            { 
              event: "*", 
              schema: "public", 
              table: "transactions", 
              filter: filterString 
            },
            (payload: any) => {
              const id = payload?.new?.id ?? payload?.old?.id;
              if (!id) {
                this.getAll().then(emit).catch(console.error);
                return;
              }
              changed.add(String(id));
              if (flushTimer) clearTimeout(flushTimer);
              flushTimer = setTimeout(() => void flush(), 700);
            }
          )
          .subscribe();
      } catch (err) {
        console.error("Lazy subscribe error:", err);
      }
    }, 0);

    return () => { 
      isCancelled = true;
      if (this.reloadActive === reload) this.reloadActive = null;
      if (flushTimer) clearTimeout(flushTimer);
      if (activeChannel) {
        const supabase = getSupabase();
        supabase.removeChannel(activeChannel); 
      }
    };
  }

  public static async add(transaction: Omit<Transaction, "id" | "created_at" | "updated_at">): Promise<SQLiteRow<Transaction>> {
    const createdTx = await SupabaseService.createTransaction(transaction as Transaction);
    
    return {
      id: createdTx.id,
      businessId: createdTx.business_id || transaction.businessId,
      total: Number(createdTx.total || transaction.total),
      discount: Number(createdTx.discount || transaction.discount),
      tax: Number(createdTx.tax || transaction.tax),
      finalTotal: Number(createdTx.final_total || transaction.finalTotal),
      walletApplied: Number(createdTx.wallet_applied) || 0,
      paymentMethod: createdTx.payment_method || transaction.paymentMethod,
      customerId: createdTx.customer_id || transaction.customerId,
      customerName: createdTx.customer_name || transaction.customerName || "",
      staffId: createdTx.staff_id || transaction.staffId,
      staffName: createdTx.staff_name || transaction.staffName,
      timestamp: createdTx.timestamp || transaction.timestamp,
      note: createdTx.note || transaction.note || "",
      isDelivery: createdTx.is_delivery !== undefined ? createdTx.is_delivery : transaction.isDelivery,
      deliveryFee: Number(createdTx.delivery_fee || transaction.deliveryFee || 0),
      deliveryMode: createdTx.delivery_mode || transaction.deliveryMode || "charged",
      riderPay: Number(createdTx.rider_pay || transaction.riderPay || 0),
      riderName: createdTx.rider_name || transaction.riderName || "",
      status: "Synced",
      sync_status: "synced",
      items: transaction.items || []
    };
  }

  public static async delete(id: string): Promise<boolean> {
    const supabase = getSupabase();
    const { error } = await supabase
      .from("transactions")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", id);
      
    if (error) { triggerNetworkFailureEvent(); throw error; }
    return true;
  }
}

// ─────────────────────────────────────────────
// CUSTOMER REPOSITORY
// ─────────────────────────────────────────────
/** One customers row as the app's Customer. */
function rowToCustomer(c: any): SQLiteRow<Customer> {
  return {
    id: c.id,
    name: customerName(c.name),
    phone: c.phone,
    email: c.email || "",
    loyaltyPoints: Number(c.loyalty_points),
    joinDate: c.join_date,
    tier: c.tier,
    purchasesCount: Number(c.purchases_count),
    debtBalance: Number(c.debt_balance),
    walletBalance: Number(c.wallet_balance),
    accountNumber: c.account_number || undefined,
    businessId: c.business_id,
    description: c.description || "",
    customerType: c.customer_type,
    paymentTerms: c.payment_terms,
    deliveryFrequency: c.delivery_frequency,
    notifyService: c.notify_service,
    notifyPromotions: c.notify_promotions,
    deliveryZoneId: c.delivery_zone_id ?? null,
    deliveryAddress: c.delivery_address ?? "",
    deliveryBuilding: c.delivery_building ?? "",
    deliveryLandmark: c.delivery_landmark ?? "",
    deliveryNotes: c.delivery_notes ?? "",
    sync_status: "synced",
  } as SQLiteRow<Customer>;
}

/** Only the delivery parts that were given (the database trims and empties blanks). */
function deliveryPayload(c: Partial<Customer>): Record<string, any> {
  const out: Record<string, any> = {};
  if (c.deliveryZoneId !== undefined) out.delivery_zone_id = c.deliveryZoneId || null;
  if (c.deliveryAddress !== undefined) out.delivery_address = c.deliveryAddress || null;
  if (c.deliveryBuilding !== undefined) out.delivery_building = c.deliveryBuilding || null;
  if (c.deliveryLandmark !== undefined) out.delivery_landmark = c.deliveryLandmark || null;
  if (c.deliveryNotes !== undefined) out.delivery_notes = c.deliveryNotes || null;
  return out;
}

export class CustomerRepository {
  // ── FIX: Add No-Op Stub to prevent SyncEngine crashes ──
  public static setAll(_customers: any[]) {}

  /** Reloads the customer list the open subscription shows (pull to refresh). */
  private static reloadActive: (() => Promise<void>) | null = null;
  public static async reload(): Promise<void> {
    await this.reloadActive?.();
  }

  public static async getAll(): Promise<SQLiteRow<Customer>[]> {
    const supabase = getSupabase();
    const activeBusinessId = getActiveBusinessId();

    try {
      const rows = await allPages<any>((from, to) => supabase
        .from("customers")
        .select("*")
        .eq("business_id", activeBusinessId)
        .is("deleted_at", null)
        .order("name")
        .order("id")
        .range(from, to));
      return rows.map(rowToCustomer);
    } catch (error) {
      triggerNetworkFailureEvent();
      throw error;
    }
  }

  public static async getById(id: string): Promise<SQLiteRow<Customer> | null> {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from("customers")
      .select("*")
      .eq("id", id)
      .is("deleted_at", null)
      .maybeSingle();

    if (error) { triggerNetworkFailureEvent(); throw error; }
    if (!data) return null;

    return rowToCustomer(data);
  }

  public static subscribe(callback: (customers: SQLiteRow<Customer>[]) => void): () => void {
    const list = liveList(rowToCustomer, (c) => `${String(c.name).toLowerCase()} ${c.id}`, callback);
    list.set([]);
    const reload = () => this.getAll().then((all) => list.set(all));
    this.reloadActive = reload;
    reload().catch((err) => {
      console.error(err);
      list.set([]);
    });

    if (typeof global !== "undefined" && (global as any).IS_TEST) {
      return () => {};
    }

    const activeBusinessId = getActiveBusinessId();
    const supabase = getSupabase();
    const channelId = Math.random().toString(36).substring(2, 10);

    const filterString = `business_id=eq.${activeBusinessId}`;
    const channel = supabase
      .channel(`realtime-customers-${activeBusinessId}-${channelId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "customers", filter: filterString }, (payload: any) => {
        if (!list.apply(payload)) this.getAll().then((all) => list.set(all)).catch(console.error);
      })
      .subscribe();

    return () => {
      if (this.reloadActive === reload) this.reloadActive = null;
      list.stop();
      supabase.removeChannel(channel);
    };
  }

  public static async add(customer: Omit<Customer, "id" | "created_at" | "updated_at"> & { id?: string }): Promise<SQLiteRow<Customer>> {
    const supabase = getSupabase();
    const activeBusinessId = getActiveBusinessId();

    const payload = {
      id: customer.id ? toUuid(customer.id) : undefined,
      business_id: toUuid(customer.businessId || activeBusinessId),
      name: customerName(customer.name),
      phone: customer.phone,
      email: customer.email ? normalizeForStorage(customer.email) : null,
      loyalty_points: customer.loyaltyPoints || 0,
      join_date: customer.joinDate || new Date().toISOString().split("T")[0],
      tier: customer.tier || "Bronze",
      purchases_count: customer.purchasesCount || 0,
      debt_balance: customer.debtBalance || 0,
      wallet_balance: customer.walletBalance || 0,
      description: customer.description ? normalizeForStorage(customer.description) : "",
      customer_type: customer.customerType || "individual",
      payment_terms: customer.paymentTerms || "pay_now",
      delivery_frequency: customer.deliveryFrequency || "none",
      notify_service: customer.notifyService ?? true,
      notify_promotions: customer.notifyPromotions ?? false,
      ...deliveryPayload(customer),
    };

    const { data, error } = await supabase.from("customers").insert(payload).select().single();
    if (error) { triggerNetworkFailureEvent(); throw error; }

    return rowToCustomer(data);
  }

  public static async update(id: string, updates: Partial<Customer>): Promise<SQLiteRow<Customer> | null> {
    const supabase = getSupabase();
    const payload: Record<string, any> = {};

    if (updates.name !== undefined) payload.name = customerName(updates.name);
    if (updates.phone !== undefined) payload.phone = updates.phone;
    if (updates.email !== undefined) payload.email = updates.email ? normalizeForStorage(updates.email) : null;
    if (updates.loyaltyPoints !== undefined) payload.loyalty_points = updates.loyaltyPoints;
    if (updates.joinDate !== undefined) payload.join_date = updates.joinDate;
    if (updates.tier !== undefined) payload.tier = updates.tier;
    if (updates.purchasesCount !== undefined) payload.purchases_count = updates.purchasesCount;
    if (updates.debtBalance !== undefined) payload.debt_balance = updates.debtBalance;
    if (updates.walletBalance !== undefined) payload.wallet_balance = updates.walletBalance;
    if (updates.customerType !== undefined) payload.customer_type = updates.customerType;
    if (updates.paymentTerms !== undefined) payload.payment_terms = updates.paymentTerms;
    if (updates.deliveryFrequency !== undefined) payload.delivery_frequency = updates.deliveryFrequency;
    if (updates.notifyService !== undefined) payload.notify_service = updates.notifyService;
    if (updates.notifyPromotions !== undefined) payload.notify_promotions = updates.notifyPromotions;
    Object.assign(payload, deliveryPayload(updates));
    if (updates.description !== undefined) payload.description = updates.description ? normalizeForStorage(updates.description) : "";

    const { data, error } = await supabase.from("customers").update(payload).eq("id", id).select().single();
    if (error) { triggerNetworkFailureEvent(); throw error; }

    return rowToCustomer(data);
  }

  public static async delete(id: string): Promise<boolean> {
    const supabase = getSupabase();
    const { error } = await supabase
      .from("customers")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", id);

    if (error) { triggerNetworkFailureEvent(); throw error; }
    return true;
  }
}

// ─────────────────────────────────────────────
// EXPENSE REPOSITORY
// ─────────────────────────────────────────────
export class ExpenseRepository {
  // ── FIX: Add No-Op Stub to prevent SyncEngine crashes ──
  public static setAll(_expenses: any[]) {}

  /** All of this branch's expenses, or just the ones given (a search result older than the list). */
  public static async getAll(ids?: string[]): Promise<SQLiteRow<Expense>[]> {
    const supabase = getSupabase();
    const activeBusinessId = getActiveBusinessId();

    let query = supabase
      .from("expenses")
      .select("*")
      .eq("business_id", activeBusinessId)
      .is("deleted_at", null);
    if (ids) query = query.in("id", ids);
    const { data, error } = await query.order("date", { ascending: false });

    if (error) { triggerNetworkFailureEvent(); throw error; }

    return (data || []).map(e => ({
      id: e.id,
      amount: Number(e.amount),
      category: e.category,
      description: e.description || "",
      date: e.date,
      staffName: e.staff_name,
      businessId: e.business_id,
      paymentMethod: e.payment_method,
      categoryId: e.category_id || undefined,
      created_at: e.created_at,
      riderPayment: !!e.rider_payment,
      refNo: e.ref_no || undefined,
      sync_status: "synced"
    }));
  }

  public static subscribe(callback: (expenses: SQLiteRow<Expense>[]) => void): () => void {
  this.getAll().then(callback).catch(console.error);

  if (typeof global !== "undefined" && (global as any).IS_TEST) {
    return () => {};
  }

  const activeBusinessId = getActiveBusinessId();
  const supabase = getSupabase();
  const channelId = Math.random().toString(36).substring(2, 10);

  const channel = supabase
    .channel(`realtime-expenses-${activeBusinessId}-${channelId}`)
    .on( // 1. Attach the callback listener first!
      "postgres_changes",
      { event: "*", schema: "public", table: "expenses", filter: `business_id=eq.${activeBusinessId}` },
      () => { this.getAll().then(callback).catch(console.error); }
    )
    .subscribe(); // 2. Call subscribe() at the very end! 👈 FIXED HERE

  return () => { supabase.removeChannel(channel); };
}

  public static async add(expense: Omit<Expense, "id" | "created_at" | "updated_at">): Promise<SQLiteRow<Expense>> {
    const supabase = getSupabase();
    const activeBusinessId = getActiveBusinessId();
    const payload = {
      amount: expense.amount,
      category: normalizeForStorage(expense.category),
      description: expense.description ? normalizeForStorage(expense.description) : expense.description,
      date: expense.date,
      staff_name: expense.staffName,
      business_id: toUuid(expense.businessId || activeBusinessId),
      payment_method: expense.paymentMethod || 'Cash',
      category_id: expense.categoryId ? toUuid(expense.categoryId) : null,
      last_modified_by: expense.staffName || 'system',
    };

    const { data, error } = await supabase.from("expenses").insert(payload).select().single();
    if (error) { triggerNetworkFailureEvent(); throw error; }

    return {
      id: data.id,
      amount: Number(data.amount),
      category: data.category,
      description: data.description || "",
      date: data.date,
      staffName: data.staff_name,
      businessId: data.business_id,
      paymentMethod: data.payment_method,
      categoryId: data.category_id || undefined,
      created_at: data.created_at,
      sync_status: "synced",
    };
  }

  public static async update(id: string, updates: Partial<Expense>): Promise<SQLiteRow<Expense> | null> {
    const supabase = getSupabase();
    const payload: Record<string, any> = {};

    if (updates.amount !== undefined) payload.amount = updates.amount;
    if (updates.category !== undefined) payload.category = normalizeForStorage(updates.category);
    if (updates.description !== undefined) payload.description = updates.description ? normalizeForStorage(updates.description) : updates.description;
    if (updates.date !== undefined) payload.date = updates.date;
    if (updates.staffName !== undefined) payload.staff_name = updates.staffName;
    if (updates.paymentMethod !== undefined) payload.payment_method = updates.paymentMethod;

    const { data, error } = await supabase.from("expenses").update(payload).eq("id", id).select().single();
    if (error) { triggerNetworkFailureEvent(); throw error; }

    return {
      id: data.id,
      amount: Number(data.amount),
      category: data.category,
      description: data.description || "",
      date: data.date,
      staffName: data.staff_name,
      businessId: data.business_id,
      paymentMethod: data.payment_method,
      categoryId: data.category_id || undefined,
      created_at: data.created_at,
      sync_status: "synced",
    };
  }

  public static async delete(id: string): Promise<boolean> {
    const supabase = getSupabase();
    const { error } = await supabase.from("expenses").update({ deleted_at: new Date().toISOString() }).eq("id", id);
    if (error) { triggerNetworkFailureEvent(); throw error; }
    return true;
  }
}

// ─────────────────────────────────────────────
// EXPENSE CATEGORY REPOSITORY
// ─────────────────────────────────────────────
export class ExpenseCategoryRepository {
  // ── FIX: Add No-Op Stub to prevent SyncEngine crashes ──
  public static setAll(_categories: any[]) {}

  public static async getAll(): Promise<SQLiteRow<ExpenseCategory>[]> {
    const supabase = getSupabase();
    const activeBusinessId = getActiveBusinessId();

    const { data, error } = await supabase
      .from("expense_categories")
      .select("*")
      .eq("business_id", activeBusinessId)
      .is("deleted_at", null);

    if (error) { triggerNetworkFailureEvent(); throw error; }

    return (data || []).map(c => ({
      id: c.id,
      name: c.name,
      status: c.status,
      isCustom: c.is_custom,
      businessId: c.business_id,
      sync_status: "synced"
    }));
  }

  public static subscribe(callback: (categories: SQLiteRow<ExpenseCategory>[]) => void): () => void {
    this.getAll().then(callback).catch(console.error);

    if (typeof global !== "undefined" && (global as any).IS_TEST) {
      return () => {};
    }

    const activeBusinessId = getActiveBusinessId();
    const supabase = getSupabase();
    const channelId = Math.random().toString(36).substring(2, 10);

    const channel = supabase
      .channel(`realtime-expense-categories-${activeBusinessId}-${channelId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "expense_categories", filter: `business_id=eq.${activeBusinessId}` },
        () => { this.getAll().then(callback).catch(console.error); }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }

  public static async add(category: Omit<ExpenseCategory, "id" | "created_at" | "updated_at">): Promise<SQLiteRow<ExpenseCategory>> {
    const supabase = getSupabase();
    const activeBusinessId = getActiveBusinessId();
    const payload = {
      name: normalizeForStorage(category.name),
      status: category.status,
      is_custom: category.isCustom,
      business_id: toUuid(category.businessId || activeBusinessId),
    };

    const { data, error } = await supabase.from("expense_categories").insert(payload).select().single();
    if (error) { triggerNetworkFailureEvent(); throw error; }

    return {
      id: data.id,
      name: data.name,
      status: data.status,
      isCustom: data.is_custom,
      businessId: data.business_id,
      sync_status: "synced",
    };
  }

  public static async update(id: string, updates: Partial<ExpenseCategory>): Promise<SQLiteRow<ExpenseCategory> | null> {
    const supabase = getSupabase();
    const payload: Record<string, any> = {};

    if (updates.name !== undefined) payload.name = normalizeForStorage(updates.name);
    if (updates.status !== undefined) payload.status = updates.status;
    if (updates.isCustom !== undefined) payload.is_custom = updates.isCustom;

    const { data, error } = await supabase.from("expense_categories").update(payload).eq("id", id).select().single();
    if (error) { triggerNetworkFailureEvent(); throw error; }

    return {
      id: data.id,
      name: data.name,
      status: data.status,
      isCustom: data.is_custom,
      businessId: data.business_id,
      sync_status: "synced",
    };
  }

  public static async delete(id: string): Promise<boolean> {
    const supabase = getSupabase();
    const { error } = await supabase.from("expense_categories").update({ deleted_at: new Date().toISOString() }).eq("id", id);
    if (error) { triggerNetworkFailureEvent(); throw error; }
    return true;
  }
}

// ─────────────────────────────────────────────
// INVENTORY ADJUSTMENT REPOSITORY
// ─────────────────────────────────────────────
export class InventoryAdjustmentRepository {
  // ── FIX: Add No-Op Stub to prevent SyncEngine crashes ──
  public static setAll(_adjustments: any[]) {}

  /** All of this branch's stock movements, or just the ones given (a search result older than the list). */
  public static async getAll(ids?: string[]): Promise<SQLiteRow<InventoryAdjustment>[]> {
    const supabase = getSupabase();
    const activeBusinessId = getActiveBusinessId();

    let query = supabase
      .from("inventory_adjustments")
      .select("*")
      .eq("business_id", activeBusinessId)
      .is("deleted_at", null);
    if (ids) query = query.in("id", ids);
    const { data, error } = await query.order("timestamp", { ascending: false });

    if (error) { triggerNetworkFailureEvent(); throw error; }

    return (data || []).map(a => ({
      id: a.id,
      productId: a.product_id,
      productName: a.product_name,
      type: a.type,
      quantityAdjusted: Number(a.quantity_adjusted),
      previousStock: Number(a.previous_stock),
      newStock: Number(a.new_stock),
      timestamp: a.timestamp,
      reason: readableIds(a.reason),
      staffName: a.staff_name,
      batchId: a.batch_id || undefined,
      referenceNumber: a.reference_number || undefined,
      notes: a.notes ? readableIds(a.notes) : undefined,
      refNo: a.ref_no || undefined,
      sync_status: "synced"
    }));
  }

  public static subscribe(callback: (adjustments: SQLiteRow<InventoryAdjustment>[]) => void): () => void {
    this.getAll().then(callback).catch(console.error);

    if (typeof global !== "undefined" && (global as any).IS_TEST) {
      return () => {};
    }

    const activeBusinessId = getActiveBusinessId();
    const supabase = getSupabase();
    const channelId = Math.random().toString(36).substring(2, 10);

    const channel = supabase
      .channel(`realtime-adjustments-${activeBusinessId}-${channelId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "inventory_adjustments", filter: `business_id=eq.${activeBusinessId}` },
        () => { this.getAll().then(callback).catch(console.error); }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }

  public static async add(adjustment: Omit<InventoryAdjustment, "id" | "timestamp">): Promise<SQLiteRow<InventoryAdjustment>> {
    const supabase = getSupabase();
    const activeBusinessId = getActiveBusinessId();
    const payload = {
      business_id: toUuid(activeBusinessId),
      product_id: toUuid(adjustment.productId),
      product_name: normalizeForStorage(adjustment.productName),
      type: adjustment.type,
      quantity_adjusted: adjustment.quantityAdjusted,
      previous_stock: adjustment.previousStock,
      new_stock: adjustment.newStock,
      reason: adjustment.reason ? normalizeForStorage(adjustment.reason) : adjustment.reason,
      staff_name: adjustment.staffName,
    };

    const { data, error } = await supabase.from("inventory_adjustments").insert(payload).select().single();
    if (error) { triggerNetworkFailureEvent(); throw error; }

    return {
      id: data.id,
      productId: data.product_id,
      productName: data.product_name,
      type: data.type,
      quantityAdjusted: Number(data.quantity_adjusted),
      previousStock: Number(data.previous_stock),
      newStock: Number(data.new_stock),
      timestamp: data.timestamp,
      reason: readableIds(data.reason),
      staffName: data.staff_name,
      sync_status: "synced",
    };
  }
}

// ─────────────────────────────────────────────
// PAYMENT REPOSITORY
// ─────────────────────────────────────────────
export class PaymentRepository {
  public static setAll(_payments: any[]) {}

  public static async getAll(): Promise<SQLiteRow<Payment>[]> {
    const supabase = getSupabase();
    const activeBusinessId = getActiveBusinessId();

    const { data, error } = await supabase
      .from("payments")
      .select("*")
      .eq("business_id", activeBusinessId)
      .order("date", { ascending: false });

    if (error) { triggerNetworkFailureEvent(); throw error; }

    return (data || []).map(p => ({
      id: p.id,
      businessId: p.business_id,
      referenceCode: p.reference_code,
      amount: Number(p.amount),
      method: p.method as any,
      senderName: p.sender_name,
      senderPhone: p.sender_phone || "",
      status: p.status as any,
      date: p.date,
      customerId: p.customer_id || undefined,
      customerName: p.customer_name || undefined,
      paymentType: p.payment_type || 'walk-in',
      description: p.description || undefined,
      appliedTo: p.applied_to || 'none',
      debtApplied: p.debt_applied ? Number(p.debt_applied) : 0,
      walletApplied: p.wallet_applied ? Number(p.wallet_applied) : 0,
      referenceId: p.reference_id || undefined,
      recordedBy: p.recorded_by || undefined,
      voidedAt: p.voided_at || undefined,
      voidedBy: p.voided_by || undefined,
      voidReason: p.void_reason || undefined,
      sync_status: "synced"
    }));
  }

  public static subscribe(callback: (payments: SQLiteRow<Payment>[]) => void): () => void {
    this.getAll().then(callback).catch(console.error);

    if (typeof global !== "undefined" && (global as any).IS_TEST) {
      return () => {};
    }

    const activeBusinessId = getActiveBusinessId();
    const supabase = getSupabase();
    const channelId = Math.random().toString(36).substring(2, 10);

    const channel = supabase
      .channel(`realtime-payments-${activeBusinessId}-${channelId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "payments", filter: `business_id=eq.${activeBusinessId}` },
        () => { this.getAll().then(callback).catch(console.error); }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }

  /**
   * Add a payment using the atomic `process_business_payment` RPC.
   * This records the payment, increments money assets, and applies
   * to customer debt/wallet in a single DB transaction.
   */
  public static async add(payment: Omit<Payment, "id" | "created_at" | "updated_at">): Promise<SQLiteRow<Payment>> {
    const supabase = getSupabase();
    const businessId = payment.businessId || getActiveBusinessId();
    if (!businessId) throw new AppError("Choose a business before recording a payment.");

    // Always go through the RPC so money assets and customer balances are updated.
    // Cash often has no reference, and payments.reference_code is unique per business,
    // so one is generated instead of storing an empty string.
    const referenceCode =
      payment.referenceCode?.trim() ||
      `CASH-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`.toUpperCase();

    const paymentId = await SupabaseService.processBusinessPayment({
      businessId,
      referenceCode,
      amount: payment.amount,
      method: payment.method,
      senderName: payment.senderName,
      senderPhone: payment.senderPhone,
      status: payment.status as Exclude<Payment["status"], "Voided">,
      date: payment.date,
      customerId: payment.customerId,
      paymentType: payment.paymentType,
      description: payment.description,
      recordedBy: payment.recordedBy,
    });

    // Fetch the created payment from DB
    const { data, error } = await supabase
      .from("payments")
      .select("*")
      .eq("id", paymentId)
      .single();

    if (error) { triggerNetworkFailureEvent(); throw error; }

    return {
      id: data.id,
      businessId: data.business_id,
      referenceCode: data.reference_code,
      amount: Number(data.amount),
      method: data.method as any,
      senderName: data.sender_name,
      senderPhone: data.sender_phone || "",
      status: data.status as any,
      date: data.date,
      customerId: data.customer_id || undefined,
      customerName: data.customer_name || undefined,
      paymentType: data.payment_type || 'walk-in',
      description: data.description || undefined,
      appliedTo: data.applied_to || 'none',
      debtApplied: data.debt_applied ? Number(data.debt_applied) : 0,
      walletApplied: data.wallet_applied ? Number(data.wallet_applied) : 0,
      referenceId: data.reference_id || undefined,
      recordedBy: data.recorded_by || undefined,
      voidedAt: data.voided_at || undefined,
      voidedBy: data.voided_by || undefined,
      voidReason: data.void_reason || undefined,
      sync_status: "synced",
    };
  }

  public static async update(id: string, updates: Partial<Payment>): Promise<SQLiteRow<Payment> | null> {
    const supabase = getSupabase();
    const payload: Record<string, any> = {};

    if (updates.referenceCode !== undefined) payload.reference_code = normalizeForStorage(updates.referenceCode);
    if (updates.amount !== undefined) payload.amount = updates.amount;
    if (updates.method !== undefined) payload.method = updates.method;
    if (updates.senderName !== undefined) payload.sender_name = normalizeForStorage(updates.senderName);
    if (updates.senderPhone !== undefined) payload.sender_phone = updates.senderPhone;
    if (updates.status !== undefined) payload.status = updates.status;
    if (updates.date !== undefined) payload.date = updates.date;
    if (updates.customerId !== undefined) payload.customer_id = updates.customerId ? toUuid(updates.customerId) : null;
    if (updates.customerName !== undefined) payload.customer_name = updates.customerName;
    if (updates.paymentType !== undefined) payload.payment_type = updates.paymentType;
    if (updates.description !== undefined) payload.description = updates.description;
    if (updates.appliedTo !== undefined) payload.applied_to = updates.appliedTo;
    if (updates.debtApplied !== undefined) payload.debt_applied = updates.debtApplied;
    if (updates.walletApplied !== undefined) payload.wallet_applied = updates.walletApplied;
    if (updates.recordedBy !== undefined) payload.recorded_by = updates.recordedBy;

    const { data, error } = await supabase.from("payments").update(payload).eq("id", id).select().single();
    if (error) { triggerNetworkFailureEvent(); throw error; }

    return {
      id: data.id,
      businessId: data.business_id,
      referenceCode: data.reference_code,
      amount: Number(data.amount),
      method: data.method as any,
      senderName: data.sender_name,
      senderPhone: data.sender_phone || "",
      status: data.status as any,
      date: data.date,
      customerId: data.customer_id || undefined,
      customerName: data.customer_name || undefined,
      paymentType: data.payment_type || 'walk-in',
      description: data.description || undefined,
      appliedTo: data.applied_to || 'none',
      debtApplied: data.debt_applied ? Number(data.debt_applied) : 0,
      walletApplied: data.wallet_applied ? Number(data.wallet_applied) : 0,
      referenceId: data.reference_id || undefined,
      recordedBy: data.recorded_by || undefined,
      voidedAt: data.voided_at || undefined,
      voidedBy: data.voided_by || undefined,
      voidReason: data.void_reason || undefined,
      sync_status: "synced",
    };
  }

  /**
   * Reverses everything the payment did (money balance, customer debt and wallet)
   * and keeps the record marked Voided. Payments are never deleted.
   */
  public static async void(id: string, reason: string, voidedBy: string): Promise<void> {
    const supabase = getSupabase();
    const { error } = await supabase.rpc("void_business_payment", {
      p_payment_id: toUuid(id),
      p_reason: reason,
      p_voided_by: voidedBy,
    });
    if (error) { triggerNetworkFailureEvent(); throw error; }
  }

  /** Makes a walk-in payment a customer's payment (voided and recorded again for them). */
  public static async assignToCustomer(id: string, customerId: string, by: string): Promise<string> {
    const { data, error } = await getSupabase().rpc("assign_payment_to_customer", {
      p_payment_id: toUuid(id),
      p_customer_id: toUuid(customerId),
      p_by: by,
    });
    if (error) { triggerNetworkFailureEvent(); throw error; }
    return data as string;
  }
}

// ─────────────────────────────────────────────
// MONEY ASSET REPOSITORY
// ─────────────────────────────────────────────
export class MoneyAssetRepository {
  public static setAll(_assets: any[]) {}

  public static async getAll(): Promise<SQLiteRow<any>[]> {
    const supabase = getSupabase();
    const activeBusinessId = getActiveBusinessId();

    const { data, error } = await supabase
      .from("money_assets")
      .select("*")
      .eq("business_id", activeBusinessId)
      .order("balance", { ascending: false });

    if (error) { triggerNetworkFailureEvent(); throw error; }

    return (data || []).map(a => ({
      id: a.id,
      businessId: a.business_id,
      method: a.method,
      balance: Number(a.balance),
      lastPaymentAt: a.last_payment_at || undefined,
      created_at: a.created_at,
      updated_at: a.updated_at,
      sync_status: "synced"
    }));
  }

  public static subscribe(callback: (assets: SQLiteRow<any>[]) => void): () => void {
    this.getAll().then(callback).catch(console.error);

    if (typeof global !== "undefined" && (global as any).IS_TEST) {
      return () => {};
    }

    const activeBusinessId = getActiveBusinessId();
    const supabase = getSupabase();
    const channelId = Math.random().toString(36).substring(2, 10);

    const channel = supabase
      .channel(`realtime-money-assets-${activeBusinessId}-${channelId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "money_assets", filter: `business_id=eq.${activeBusinessId}` },
        () => { this.getAll().then(callback).catch(console.error); }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }
}

// ─────────────────────────────────────────────
// PRODUCTION BATCH REPOSITORY (With Realtime Sync)
// ─────────────────────────────────────────────
export class ProductionBatchRepository {
  public static setAll(_batches: any[]) {}

  public static async getAll(): Promise<any[]> {
    const supabase = getSupabase();
    const activeBusinessId = getActiveBusinessId();

    const { data, error } = await supabase
      .from("production_batches")
      .select("*")
      .eq("business_id", activeBusinessId)
      .order("date", { ascending: false });

    if (error) { triggerNetworkFailureEvent(); throw error; }

    return (data || []).map(b => ({
      id: b.id,
      businessId: b.business_id,
      recipeName: b.recipe_name,
      productId: b.product_id,
      bomId: b.bom_id,
      quantityProduced: Number(b.quantity_produced),
      unit: b.unit,
      status: b.status === "In Progress" ? "In_Progress" : b.status,
      staffName: b.staff_name,
      referenceNumber: b.reference_number || undefined,
      date: b.date,
      sync_status: "synced"
    }));
  }

  public static subscribe(callback: (batches: any[]) => void): () => void {
    this.getAll().then(callback).catch(console.error);

    if (typeof global !== "undefined" && (global as any).IS_TEST) {
      return () => {};
    }

    const activeBusinessId = getActiveBusinessId();
    const supabase = getSupabase();
    const channelId = Math.random().toString(36).substring(2, 10);

    const channel = supabase
      .channel(`realtime-production-batches-${activeBusinessId}-${channelId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "production_batches", filter: `business_id=eq.${activeBusinessId}` },
        () => { this.getAll().then(callback).catch(console.error); }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }
}
// ─────────────────────────────────────────────
// M-PESA (DARAJA) REPOSITORY
// Secrets stay on the server; everything Safaricom-facing goes through the
// mpesa-payments edge function. Rows are read directly, under RLS.
// ─────────────────────────────────────────────
export interface MpesaStatus {
  configured: boolean;
  environment: "sandbox" | "production";
  transactionType: "CustomerBuyGoodsOnline" | "CustomerPayBillOnline";
  shortcode: string | null;
  partyB: string | null;
  tillNumber: string | null;
  registeredAt: string | null;
  /** When Safaricom last delivered a prompt result / a till payment to the app. */
  lastStkCallbackAt?: string | null;
  lastTillPaymentAt?: string | null;
}

export type TillPaymentAction = "customer" | "walk_in" | "sale" | "ignore" | "reopen";

export class MpesaRepository {
  private static call(action: string, extra: Record<string, unknown> = {}) {
    return SupabaseService.callEdgeFunction("mpesa-payments", {
      action,
      businessId: getActiveBusinessId(),
      ...extra,
    });
  }

  public static status(): Promise<MpesaStatus> {
    return this.call("status");
  }

  /** Connects this business's own Daraja app. Empty secrets keep the saved ones. */
  public static async saveKeys(keys: {
    environment: "sandbox" | "production";
    transactionType: "CustomerBuyGoodsOnline" | "CustomerPayBillOnline";
    shortcode: string;
    partyB: string;
    consumerKey: string;
    consumerSecret: string;
    passkey: string;
  }): Promise<void> {
    await this.call("save_keys", keys);
  }

  public static async removeKeys(): Promise<void> {
    await this.call("remove_keys");
  }

  public static async saveTill(tillNumber: string): Promise<void> {
    await this.call("save_till", { tillNumber });
  }

  /** Safaricom took the registration (otherwise this throws); reachable: our callback address answered. */
  public static async registerTill(): Promise<{ reachable: boolean }> {
    const data = await this.call("register");
    return { reachable: !!data?.reachable };
  }

  /** Sandbox only: registers the till again, then has Safaricom send it a test KSh 1. */
  public static async testTill(): Promise<void> {
    await this.call("test_till");
  }

  /** Sends a payment prompt to the customer's phone. Returns its checkout id. */
  public static async requestPayment(params: {
    phone: string;
    amount: number;
    customerId?: string;
    description?: string;
  }): Promise<string> {
    const data = await this.call("request", params);
    return data.checkoutRequestId;
  }

  public static async checkPrompt(checkoutRequestId: string): Promise<{ status: MpesaPrompt["status"]; paid?: boolean }> {
    return this.call("check", { checkoutRequestId });
  }

  public static async handleTillPayment(
    id: string,
    action: TillPaymentAction,
    options: { customerId?: string; note?: string; handledBy: string },
  ): Promise<void> {
    const { error } = await getSupabase().rpc("handle_till_payment", {
      p_till_payment_id: toUuid(id),
      p_action: action,
      p_customer_id: options.customerId ? toUuid(options.customerId) : null,
      p_note: options.note || null,
      p_handled_by: options.handledBy,
    });
    if (error) { triggerNetworkFailureEvent(); throw error; }
  }

  /** M-Pesa sales this till payment could belong to; searched on the server. */
  public static async tillSaleCandidates(tillPaymentId: string, search?: string): Promise<TillSaleCandidate[]> {
    const { data, error } = await getSupabase().rpc("till_payment_sale_candidates", {
      p_till_payment_id: toUuid(tillPaymentId),
      p_search: search?.trim() || null,
      p_limit: 30,
    });
    if (error) { triggerNetworkFailureEvent(); throw error; }
    return (data || []).map((r: any) => ({
      saleId: r.sale_id,
      reference: r.reference,
      createdAt: r.created_at,
      customerName: r.customer_name || undefined,
      total: Number(r.total),
      linked: Number(r.linked),
      remaining: Number(r.remaining),
      sameAmount: Boolean(r.same_amount),
      customerPhone: r.customer_phone || undefined,
      score: Number(r.score || 0),
      reasons: r.reasons || [],
    }));
  }

  /** Gives part or all of a waiting till payment to one M-Pesa sale (locked, checked in the DB). */
  public static async allocateTillPayment(
    tillPaymentId: string, saleId: string, amount: number, handledBy: string,
  ): Promise<{ status: string; left: number; saleReference: string }> {
    const { data, error } = await getSupabase().rpc("allocate_till_payment", {
      p_till_payment_id: toUuid(tillPaymentId),
      p_sale_id: toUuid(saleId),
      p_amount: amount,
      p_handled_by: handledBy,
    });
    if (error) { triggerNetworkFailureEvent(); throw error; }
    return { status: data?.status, left: Number(data?.left ?? 0), saleReference: data?.sale_reference };
  }

  /** under_review / disputed / reversed, or 'unclaimed' to clear a flag. A reason is required. */
  public static async flagTillPayment(
    tillPaymentId: string, status: "under_review" | "disputed" | "reversed" | "unclaimed", note: string, handledBy: string,
  ): Promise<void> {
    const { error } = await getSupabase().rpc("flag_till_payment", {
      p_till_payment_id: toUuid(tillPaymentId), p_status: status, p_note: note, p_handled_by: handledBy,
    });
    if (error) { triggerNetworkFailureEvent(); throw error; }
  }

  public static async tillPaymentHistory(tillPaymentId: string): Promise<{ events: TillPaymentEvent[]; allocations: TillAllocation[] }> {
    const sb = getSupabase();
    const [ev, al] = await Promise.all([
      sb.from("mpesa_till_payment_events").select("*").eq("till_payment_id", toUuid(tillPaymentId)).order("id"),
      sb.from("mpesa_till_allocations").select("*, transactions(reference_id)").eq("till_payment_id", toUuid(tillPaymentId)).order("allocated_at"),
    ]);
    if (ev.error || al.error) { triggerNetworkFailureEvent(); throw ev.error || al.error; }
    return {
      events: (ev.data || []).map((r: any) => ({
        id: r.id, action: r.action, previousStatus: r.previous_status || undefined, newStatus: r.new_status || undefined,
        amount: r.amount == null ? undefined : Number(r.amount), saleId: r.sale_id || undefined,
        staffName: r.staff_name || undefined, note: r.note || undefined, createdAt: r.created_at,
      })),
      allocations: (al.data || []).map((r: any) => ({
        id: r.id, saleId: r.sale_id, saleReference: r.transactions?.reference_id || undefined, amount: Number(r.amount),
        allocatedBy: r.allocated_by, allocatedAt: r.allocated_at, reversedAt: r.reversed_at || undefined,
        reversedBy: r.reversed_by || undefined, reverseReason: r.reverse_reason || undefined,
      })),
    };
  }

  public static async stkExceptions(): Promise<StkException[]> {
    const { data, error } = await getSupabase().rpc("stk_payment_exceptions", { p_business_id: getActiveBusinessId() });
    if (error) { triggerNetworkFailureEvent(); throw error; }
    return (data || []).map((r: any) => ({
      id: r.id, receiptNumber: r.receipt_number, amount: Number(r.amount), phone: r.phone, paidAt: r.paid_at,
      saleId: r.sale_id || undefined, saleReference: r.sale_reference || undefined,
      paymentId: r.payment_id || undefined, requestedBy: r.requested_by || undefined,
    }));
  }

  public static async resolveStkException(id: string, note: string, by: string): Promise<void> {
    const { error } = await getSupabase().rpc("resolve_stk_exception", { p_id: toUuid(id), p_note: note, p_by: by });
    if (error) { triggerNetworkFailureEvent(); throw error; }
  }

  /** Links a waiting till payment to the sale it paid for. The database checks the sale has room. */
  public static async linkTillPaymentToSale(tillPaymentId: string, saleId: string, handledBy: string): Promise<void> {
    const { error } = await getSupabase().rpc("link_till_payment_to_sale", {
      p_till_payment_id: toUuid(tillPaymentId),
      p_sale_id: toUuid(saleId),
      p_handled_by: handledBy,
    });
    if (error) { triggerNetworkFailureEvent(); throw error; }
  }

  public static async getTillPayments(): Promise<TillPayment[]> {
    // The latest 200, plus every one still waiting however old, so the queue is never cut short.
    const sb = getSupabase();
    const [recent, open] = await Promise.all([
      sb.from("mpesa_till_payments").select("*").eq("business_id", getActiveBusinessId())
        .order("trans_time", { ascending: false }).limit(200),
      sb.from("mpesa_till_payments").select("*").eq("business_id", getActiveBusinessId())
        .in("status", OPEN_TILL_STATUSES).order("trans_time", { ascending: false }).limit(1000),
    ]);
    const error = recent.error || open.error;
    if (error) { triggerNetworkFailureEvent(); throw error; }
    const seen = new Set<string>();
    const data = [...(open.data || []), ...(recent.data || [])]
      .filter((r) => (seen.has(r.id) ? false : (seen.add(r.id), true)))
      .sort((a, b) => (a.trans_time < b.trans_time ? 1 : -1));
    return data.map((r) => ({
      id: r.id,
      transId: r.trans_id,
      amount: Number(r.amount),
      msisdn: r.msisdn || undefined,
      payerName: r.payer_name || undefined,
      billRef: r.bill_ref || undefined,
      transTime: r.trans_time,
      status: r.status,
      allocated: Number(r.allocated || 0),
      shortCode: r.short_code || undefined,
      transType: r.trans_type || undefined,
      customerId: r.customer_id || undefined,
      paymentId: r.payment_id || undefined,
      saleId: r.sale_id || undefined,
      handledBy: r.handled_by || undefined,
      handledAt: r.handled_at || undefined,
      note: r.note || undefined,
    }));
  }

  public static async getPrompts(): Promise<MpesaPrompt[]> {
    const { data, error } = await getSupabase()
      .from("mpesa_transactions")
      .select("*")
      .eq("business_id", getActiveBusinessId())
      .is("online_order_id", null)
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) { triggerNetworkFailureEvent(); throw error; }
    return (data || []).map((r) => ({
      id: r.id,
      checkoutRequestId: r.checkout_request_id,
      phone: r.phone,
      amount: Number(r.amount),
      status: r.status,
      receiptNumber: r.receipt_number || undefined,
      customerId: r.customer_id || undefined,
      accountReference: r.account_reference || undefined,
      description: r.description || undefined,
      requestedBy: r.requested_by || undefined,
      paymentId: r.payment_id || undefined,
      createdAt: r.created_at,
    }));
  }

  /** Calls back with fresh till payments and prompts whenever either table changes. */
  public static subscribe(callback: (data: { tillPayments: TillPayment[]; prompts: MpesaPrompt[] }) => void): () => void {
    const load = () =>
      Promise.all([this.getTillPayments(), this.getPrompts()])
        .then(([tillPayments, prompts]) => callback({ tillPayments, prompts }))
        .catch(console.error);
    load();

    if (typeof global !== "undefined" && (global as any).IS_TEST) {
      return () => {};
    }

    const activeBusinessId = getActiveBusinessId();
    const supabase = getSupabase();
    const channelId = Math.random().toString(36).substring(2, 10);
    const filter = `business_id=eq.${activeBusinessId}`;
    const channel = supabase
      .channel(`realtime-mpesa-${activeBusinessId}-${channelId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "mpesa_till_payments", filter }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "mpesa_transactions", filter }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "mpesa_till_allocations", filter }, load)
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }
}

// ─────────────────────────────────────────────
// AIRTEL MONEY REPOSITORY
// The client secret stays on the server; everything Airtel-facing goes through the
// airtel-payments edge function. Prompts are read directly, under RLS.
// ─────────────────────────────────────────────
export interface AirtelStatus {
  configured: boolean;
  /** Airtel Money is switched on in this business's payment methods. */
  enabled: boolean;
  environment: "staging" | "production";
  country: string;
  currency: string;
  merchantCode: string | null;
  status: "connected" | "error" | null;
  lastError: string | null;
  /** Only for people who may change the setup. */
  clientIdHint: string | null;
  callbackUrl: string | null;
}

export class AirtelRepository {
  private static call(action: string, extra: Record<string, unknown> = {}) {
    return SupabaseService.callEdgeFunction("airtel-payments", {
      action,
      businessId: getActiveBusinessId(),
      ...extra,
    });
  }

  public static status(): Promise<AirtelStatus> {
    return this.call("status");
  }

  public static async saveSettings(settings: {
    clientId?: string;
    clientSecret?: string;
    environment: "staging" | "production";
    merchantCode?: string;
  }): Promise<{ callbackUrl: string }> {
    return this.call("save_settings", settings);
  }

  public static async remove(): Promise<void> {
    await this.call("remove");
  }

  /** Sends an Airtel Money prompt. Returns the prompt's row id. */
  public static async requestPayment(params: {
    phone: string;
    amount: number;
    customerId?: string;
    description?: string;
  }): Promise<string> {
    const data = await this.call("request", params);
    return data.id;
  }

  public static async checkPrompt(id: string): Promise<{ status: PaymentPrompt["status"] }> {
    return this.call("check", { id });
  }
}

// Plain words for the M-Pesa result codes staff actually see.
const MPESA_RESULTS: Record<string, string> = {
  "1": "Not enough money in their M-Pesa",
  "1032": "The customer cancelled the prompt",
  "1037": "Their phone couldn't be reached or the prompt timed out",
  "1019": "The prompt expired before they paid",
  "2001": "Wrong M-Pesa PIN",
  "1001": "Another M-Pesa payment was in progress on that phone",
  "1025": "M-Pesa couldn't send the prompt",
  "9999": "M-Pesa couldn't send the prompt",
};

function mpesaPrompt(r: any): PaymentPrompt {
  const callback = r.raw_callback?.Body?.stkCallback;
  const code = callback?.ResultCode ?? r.raw_callback?.resultCode;
  const codeText = code === undefined || code === null ? undefined : String(code);
  return {
    provider: "mpesa",
    id: r.id,
    reference: r.checkout_request_id,
    phone: r.phone,
    amount: Number(r.amount),
    status: r.status,
    receiptNumber: r.receipt_number || undefined,
    resultCode: codeText,
    resultMessage: r.status === "Failed"
      ? (codeText && MPESA_RESULTS[codeText]) || callback?.ResultDesc || undefined
      : undefined,
    customerId: r.customer_id || undefined,
    description: r.description || undefined,
    requestedBy: r.requested_by || undefined,
    paymentId: r.payment_id || undefined,
    saleId: r.transaction_id || undefined,
    createdAt: r.created_at,
    updatedAt: r.updated_at || undefined,
  };
}

function airtelPrompt(r: any): PaymentPrompt {
  return {
    provider: "airtel",
    id: r.id,
    reference: r.reference,
    phone: r.phone,
    amount: Number(r.amount),
    status: r.status,
    receiptNumber: r.status === "Completed" ? r.airtel_money_id || undefined : undefined,
    resultCode: r.result_code || undefined,
    resultMessage: r.result_message || undefined,
    customerId: r.customer_id || undefined,
    description: r.description || undefined,
    requestedBy: r.requested_by || undefined,
    paymentId: r.payment_id || undefined,
    createdAt: r.created_at,
    updatedAt: r.updated_at || undefined,
  };
}

// ─────────────────────────────────────────────
// PAYMENT PROMPTS (M-Pesa and Airtel Money together)
// The prompt screen lists and follows both kinds the same way.
// ─────────────────────────────────────────────
export class PromptRepository {
  public static async getRecent(options: { mpesa: boolean; airtel: boolean }): Promise<PaymentPrompt[]> {
    const businessId = getActiveBusinessId();
    const supabase = getSupabase();
    const [mpesa, airtel] = await Promise.all([
      options.mpesa
        ? supabase.from("mpesa_transactions").select("*").eq("business_id", businessId).is("online_order_id", null)
            .order("created_at", { ascending: false }).limit(60)
        : Promise.resolve({ data: [], error: null }),
      options.airtel
        ? supabase.from("airtel_transactions").select("*").eq("business_id", businessId)
            .order("created_at", { ascending: false }).limit(60)
        : Promise.resolve({ data: [], error: null }),
    ]);
    if (mpesa.error || airtel.error) { triggerNetworkFailureEvent(); throw mpesa.error || airtel.error; }
    return [...(mpesa.data || []).map(mpesaPrompt), ...(airtel.data || []).map(airtelPrompt)]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  /** Calls back with fresh prompts whenever either table changes. */
  public static subscribe(options: { mpesa: boolean; airtel: boolean }, callback: (prompts: PaymentPrompt[]) => void): () => void {
    let alive = true;
    const load = () => this.getRecent(options).then((p) => { if (alive) callback(p); }).catch(console.error);
    load();

    if (typeof global !== "undefined" && (global as any).IS_TEST) {
      return () => { alive = false; };
    }

    const activeBusinessId = getActiveBusinessId();
    const supabase = getSupabase();
    const channelId = Math.random().toString(36).substring(2, 10);
    const filter = `business_id=eq.${activeBusinessId}`;
    let channel = supabase.channel(`realtime-prompts-${activeBusinessId}-${channelId}`);
    if (options.mpesa) channel = channel.on("postgres_changes", { event: "*", schema: "public", table: "mpesa_transactions", filter }, load);
    if (options.airtel) channel = channel.on("postgres_changes", { event: "*", schema: "public", table: "airtel_transactions", filter }, load);
    channel.subscribe();
    // Realtime can drop on a weak connection; a slow poll keeps a waiting screen honest.
    const timer = setInterval(load, 15000);

    return () => { alive = false; clearInterval(timer); supabase.removeChannel(channel); };
  }

  /** Sends a prompt with either network. Returns the new prompt's row id. */
  public static async send(
    provider: PromptProvider,
    params: { phone: string; amount: number; customerId?: string; description?: string; saleId?: string },
  ): Promise<string> {
    if (provider === "airtel") {
      if (params.saleId) throw new Error("Prompts for a sale are M-Pesa only for now.");
      return AirtelRepository.requestPayment(params);
    }
    const data = await SupabaseService.callEdgeFunction("mpesa-payments", {
      action: "request",
      businessId: getActiveBusinessId(),
      ...params,
    });
    return data.id;
  }

  /** Asks the network now instead of waiting for its callback. */
  public static async check(prompt: PaymentPrompt): Promise<{ status: PaymentPrompt["status"]; paid?: boolean }> {
    return prompt.provider === "airtel"
      ? AirtelRepository.checkPrompt(prompt.id)
      : MpesaRepository.checkPrompt(prompt.reference);
  }
}

// ─────────────────────────────────────────────
// PRODUCT CATEGORY REPOSITORY
// Categories are saved on their own, so one can exist before any product uses it.
// The database also adds any category a product is saved with.
// ─────────────────────────────────────────────
export class ProductCategoryRepository {
  public static async getAll(): Promise<string[]> {
    const { data, error } = await getSupabase()
      .from("product_categories")
      .select("name")
      .eq("business_id", getActiveBusinessId())
      .order("name");
    if (error) { triggerNetworkFailureEvent(); throw error; }
    return (data || []).map((r) => r.name);
  }

  public static subscribe(callback: (names: string[]) => void): () => void {
    this.getAll().then(callback).catch(console.error);

    if (typeof global !== "undefined" && (global as any).IS_TEST) {
      return () => {};
    }

    const activeBusinessId = getActiveBusinessId();
    const supabase = getSupabase();
    const channelId = Math.random().toString(36).substring(2, 10);
    const channel = supabase
      .channel(`realtime-product-categories-${activeBusinessId}-${channelId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "product_categories", filter: `business_id=eq.${activeBusinessId}` },
        () => { this.getAll().then(callback).catch(console.error); }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }

  public static async add(name: string, createdBy: string): Promise<void> {
    const { error } = await getSupabase()
      .from("product_categories")
      .insert({ business_id: toUuid(getActiveBusinessId()), name: normalizeForStorage(name.trim()), created_by: createdBy });
    // Already there under the same name: nothing to do.
    if (error && error.code !== "23505") { triggerNetworkFailureEvent(); throw error; }
  }

  public static async rename(oldName: string, newName: string): Promise<void> {
    const { error } = await getSupabase()
      .from("product_categories")
      .update({ name: normalizeForStorage(newName.trim()), updated_at: new Date().toISOString() })
      .eq("business_id", getActiveBusinessId())
      .eq("name", oldName);
    if (!error) return;
    // Renaming the products already added the new name, so the old one just goes.
    if (error.code === "23505") {
      const { error: deleteError } = await getSupabase()
        .from("product_categories")
        .delete()
        .eq("business_id", getActiveBusinessId())
        .eq("name", oldName);
      if (!deleteError) return;
    }
    triggerNetworkFailureEvent();
    throw error;
  }
}

// ─────────────────────────────────────────────
// CARD PAYMENTS (PAYSTACK) REPOSITORY
// The Paystack key stays on the server; charging and checking go through the
// card-payments edge function. Rows are read directly, under RLS.
// ─────────────────────────────────────────────
export interface CardStatus {
  connected: boolean;
  environment: "test" | "live" | null;
  onlineEnabled: boolean;
  terminalId: string | null;
  terminalName: string | null;
  status: "connected" | "error" | null;
  lastError: string | null;
  webhookUrl: string;
  updatedAt: string | null;
  updatedBy: string | null;
}

export type CardChannel = "online" | "terminal";
export type CardPurpose = "sale" | "payment" | "online_order";

export interface CardPayment {
  id: string;
  reference: string;
  status: "pending" | "success" | "failed" | "cancelled";
  channel: CardChannel;
  purpose: CardPurpose;
  amount: number;
  amountPaid: number | null;
  authorizationUrl: string | null;
  cardBrand: string | null;
  cardLast4: string | null;
  failureReason: string | null;
  paymentId: string | null;
  transactionId?: string | null;
  payerName?: string | null;
  description?: string | null;
  requestedBy?: string | null;
  createdAt?: string;
  paidAt?: string | null;
}

function cardRow(r: any): CardPayment {
  return {
    id: r.id,
    reference: r.reference,
    status: r.status,
    channel: r.channel,
    purpose: r.purpose,
    amount: Number(r.amount),
    amountPaid: r.amount_paid === null || r.amount_paid === undefined ? null : Number(r.amount_paid),
    authorizationUrl: r.authorization_url,
    cardBrand: r.card_brand,
    cardLast4: r.card_last4,
    failureReason: r.failure_reason,
    paymentId: r.payment_id,
    transactionId: r.transaction_id,
    payerName: r.payer_name,
    description: r.description,
    requestedBy: r.requested_by,
    createdAt: r.created_at,
    paidAt: r.paid_at,
  };
}

export class CardRepository {
  private static call(action: string, extra: Record<string, unknown> = {}) {
    return SupabaseService.callEdgeFunction("card-payments", {
      action,
      businessId: getActiveBusinessId(),
      ...extra,
    });
  }

  public static status(): Promise<CardStatus> {
    return this.call("status");
  }

  /** Leave secretKey empty to keep the saved key and change only the other settings. */
  public static async saveSettings(settings: { secretKey?: string; terminalId?: string; onlineEnabled: boolean }): Promise<void> {
    await this.call("save_settings", settings);
  }

  public static async remove(): Promise<void> {
    await this.call("remove");
  }

  public static async charge(params: {
    channel: CardChannel;
    purpose: "sale" | "payment";
    amount: number;
    customerId?: string;
    email?: string;
    payerName?: string;
    payerPhone?: string;
    description?: string;
  }): Promise<CardPayment> {
    const data = await this.call("charge", params);
    return data.payment;
  }

  public static async check(reference: string): Promise<CardPayment> {
    const data = await this.call("check", { reference });
    return data.payment;
  }

  public static async cancel(reference: string): Promise<CardPayment> {
    const data = await this.call("cancel", { reference });
    return data.payment;
  }

  public static async attachToSale(cardPaymentId: string, transactionId: string): Promise<void> {
    const { error } = await getSupabase().rpc("attach_card_payment_to_sale", {
      p_card_payment_id: cardPaymentId,
      p_transaction_id: toUuid(transactionId),
    });
    if (error) throw error;
  }

  public static async getRecent(): Promise<CardPayment[]> {
    const { data, error } = await getSupabase()
      .from("card_payments")
      .select("*")
      .eq("business_id", getActiveBusinessId())
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) {
      // A database without card payments yet shows an empty list, not an error.
      if (error.code === "42P01" || error.code === "PGRST205") return [];
      triggerNetworkFailureEvent();
      throw error;
    }
    return (data || []).map(cardRow);
  }

  public static subscribe(callback: (rows: CardPayment[]) => void): () => void {
    this.getRecent().then(callback).catch(console.error);
    if (typeof global !== "undefined" && (global as any).IS_TEST) return () => {};
    const businessId = getActiveBusinessId();
    const supabase = getSupabase();
    const channel = supabase
      .channel(`realtime-card-payments-${businessId}-${Math.random().toString(36).slice(2, 10)}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "card_payments", filter: `business_id=eq.${businessId}` },
        () => { this.getRecent().then(callback).catch(console.error); })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }
}
