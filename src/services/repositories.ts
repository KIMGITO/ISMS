// src/services/repositories.ts
// Re-engineered for Strict Online-First Real-Time Architecture

import { getSupabase } from "./supabaseClient";
import { toUuid } from "../utils/idUtils";
import { Product, Transaction, Customer, Expense, ExpenseCategory, InventoryAdjustment, Payment } from "../types";
import { useBusinessStore } from "../stores/businessStore";
import { SupabaseService } from "./supabaseService";
import { normalizeForStorage } from "../utils/stringUtils";

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

// ─────────────────────────────────────────────
// PRODUCT REPOSITORY (With Soft Deletion)
// ─────────────────────────────────────────────
export class ProductRepository {
  // ── FIX: Add No-Op Stub to prevent SyncEngine crashes ──
  public static setAll(_products: any[]) {}

  public static async getAll(): Promise<SQLiteRow<Product>[]> {
    const supabase = getSupabase();
    const activeBusinessId = getActiveBusinessId();
    
    const { data, error } = await supabase
      .from("products")
      .select("*")
      .eq("business_id", activeBusinessId)
      .is("deleted_at", null)
      .order("name");

    if (error) { triggerNetworkFailureEvent(); throw error; }
    
    return (data || []).map(p => ({
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
    }));
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
    // Trigger initial load
    this.getAll().then(callback).catch(console.error);

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
        () => { this.getAll().then(callback).catch(console.error); }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
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

  public static async getAll(): Promise<SQLiteRow<Transaction>[]> {
    const supabase = getSupabase();
    const activeBusinessId = getActiveBusinessId();

    const { data, error } = await supabase
      .from("transactions")
      .select("*")
      .eq("business_id", activeBusinessId)
      .is("deleted_at", null)
      .order("timestamp", { ascending: false });

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
      customerName: t.customer_name || "",
      staffId: t.staff_id,
      staffName: t.staff_name,
      timestamp: t.timestamp,
      note: t.note || "",
      isDelivery: t.is_delivery,
      deliveryFee: Number(t.delivery_fee || 0),
      riderName: t.rider_name || "",
      status: "Synced" as const,
      sync_status: "synced",
      items: []
    }));
  }

  public static subscribe(callback: (transactions: SQLiteRow<Transaction>[]) => void): () => void {
    let activeChannel: any = null;
    let isCancelled = false;

    this.getAll().then((txs) => {
      if (!isCancelled) callback(txs);
    }).catch(console.error);

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
            () => { 
              this.getAll().then(callback).catch(console.error); 
            }
          )
          .subscribe();
      } catch (err) {
        console.error("Lazy subscribe error:", err);
      }
    }, 0);

    return () => { 
      isCancelled = true;
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
      paymentMethod: createdTx.payment_method || transaction.paymentMethod,
      customerId: createdTx.customer_id || transaction.customerId,
      customerName: createdTx.customer_name || transaction.customerName || "",
      staffId: createdTx.staff_id || transaction.staffId,
      staffName: createdTx.staff_name || transaction.staffName,
      timestamp: createdTx.timestamp || transaction.timestamp,
      note: createdTx.note || transaction.note || "",
      isDelivery: createdTx.is_delivery !== undefined ? createdTx.is_delivery : transaction.isDelivery,
      deliveryFee: Number(createdTx.delivery_fee || transaction.deliveryFee || 0),
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
export class CustomerRepository {
  // ── FIX: Add No-Op Stub to prevent SyncEngine crashes ──
  public static setAll(_customers: any[]) {}

  public static async getAll(): Promise<SQLiteRow<Customer>[]> {
    const supabase = getSupabase();
    const activeBusinessId = getActiveBusinessId();

    const { data, error } = await supabase
      .from("customers")
      .select("*")
      .eq("business_id", activeBusinessId)
      .is("deleted_at", null)
      .order("name");

    if (error) { triggerNetworkFailureEvent(); throw error; }
    return (data || []).map(c => ({
      id: c.id,
      name: c.name,
      phone: c.phone,
      email: c.email || "",
      loyaltyPoints: c.loyalty_points,
      joinDate: c.join_date,
      tier: c.tier,
      purchasesCount: c.purchases_count,
      debtBalance: Number(c.debt_balance),
      walletBalance: Number(c.wallet_balance),
      businessId: c.business_id,
      description: c.description || "",
      sync_status: "synced"
    }));
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

    return {
      id: data.id,
      name: data.name,
      phone: data.phone,
      email: data.email || "",
      loyaltyPoints: data.loyalty_points,
      joinDate: data.join_date,
      tier: data.tier,
      purchasesCount: data.purchases_count,
      debtBalance: Number(data.debt_balance),
      walletBalance: Number(data.wallet_balance),
      businessId: data.business_id,
      description: data.description || "",
      sync_status: "synced"
    };
  }

  public static subscribe(callback: (customers: SQLiteRow<Customer>[]) => void): () => void {
    callback([]); 

    this.getAll().then(callback).catch((err) => {
      console.error(err);
      callback([]);
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
      .on("postgres_changes", { event: "*", schema: "public", table: "customers", filter: filterString }, () => {
        this.getAll().then(callback).catch(console.error);
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }

  public static async add(customer: Omit<Customer, "id" | "created_at" | "updated_at"> & { id?: string }): Promise<SQLiteRow<Customer>> {
    const supabase = getSupabase();
    const activeBusinessId = getActiveBusinessId();

    const payload = {
      id: customer.id ? toUuid(customer.id) : undefined,
      business_id: toUuid(customer.businessId || activeBusinessId),
      name: normalizeForStorage(customer.name),
      phone: customer.phone,
      email: customer.email ? normalizeForStorage(customer.email) : "",
      loyalty_points: customer.loyaltyPoints || 10,
      join_date: customer.joinDate || new Date().toISOString().split("T")[0],
      tier: customer.tier || "Bronze",
      purchases_count: customer.purchasesCount || 0,
      debt_balance: customer.debtBalance || 0,
      wallet_balance: customer.walletBalance || 0,
      description: customer.description ? normalizeForStorage(customer.description) : "",
    };

    const { data, error } = await supabase.from("customers").insert(payload).select().single();
    if (error) { triggerNetworkFailureEvent(); throw error; }

    return {
      id: data.id,
      name: data.name,
      phone: data.phone,
      email: data.email || "",
      loyaltyPoints: Number(data.loyalty_points),
      joinDate: data.join_date,
      tier: data.tier,
      purchasesCount: Number(data.purchases_count),
      debtBalance: Number(data.debt_balance),
      walletBalance: Number(data.wallet_balance),
      businessId: data.business_id,
      description: data.description || "",
      sync_status: "synced"
    };
  }

  public static async update(id: string, updates: Partial<Customer>): Promise<SQLiteRow<Customer> | null> {
    const supabase = getSupabase();
    const payload: Record<string, any> = {};

    if (updates.name !== undefined) payload.name = normalizeForStorage(updates.name);
    if (updates.phone !== undefined) payload.phone = updates.phone;
    if (updates.email !== undefined) payload.email = updates.email ? normalizeForStorage(updates.email) : updates.email;
    if (updates.loyaltyPoints !== undefined) payload.loyalty_points = updates.loyaltyPoints;
    if (updates.joinDate !== undefined) payload.join_date = updates.joinDate;
    if (updates.tier !== undefined) payload.tier = updates.tier;
    if (updates.purchasesCount !== undefined) payload.purchases_count = updates.purchasesCount;
    if (updates.debtBalance !== undefined) payload.debt_balance = updates.debtBalance;
    if (updates.walletBalance !== undefined) payload.wallet_balance = updates.walletBalance;
    if (updates.description !== undefined) payload.description = updates.description ? normalizeForStorage(updates.description) : "";

    const { data, error } = await supabase.from("customers").update(payload).eq("id", id).select().single();
    if (error) { triggerNetworkFailureEvent(); throw error; }

    return {
      id: data.id,
      name: data.name,
      phone: data.phone,
      email: data.email || "",
      loyaltyPoints: Number(data.loyalty_points),
      joinDate: data.join_date,
      tier: data.tier,
      purchasesCount: Number(data.purchases_count),
      debtBalance: Number(data.debt_balance),
      walletBalance: Number(data.wallet_balance),
      businessId: data.business_id,
      description: data.description || "",
      sync_status: "synced"
    };
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

  public static async getAll(): Promise<SQLiteRow<Expense>[]> {
    const supabase = getSupabase();
    const activeBusinessId = getActiveBusinessId();

    const { data, error } = await supabase
      .from("expenses")
      .select("*")
      .eq("business_id", activeBusinessId)
      .is("deleted_at", null)
      .order("date", { ascending: false });

    if (error) { triggerNetworkFailureEvent(); throw error; }

    return (data || []).map(e => ({
      id: e.id,
      amount: Number(e.amount),
      category: e.category,
      description: e.description || "",
      date: e.date,
      staffName: e.staff_name,
      businessId: e.business_id,
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

  public static async getAll(): Promise<SQLiteRow<InventoryAdjustment>[]> {
    const supabase = getSupabase();
    const activeBusinessId = getActiveBusinessId();

    const { data, error } = await supabase
      .from("inventory_adjustments")
      .select("*")
      .eq("business_id", activeBusinessId)
      .is("deleted_at", null)
      .order("timestamp", { ascending: false });

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
      reason: a.reason,
      staffName: a.staff_name,
      batchId: a.batch_id || undefined,
      referenceNumber: a.reference_number || undefined,
      notes: a.notes || undefined,
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
      reason: data.reason,
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

  public static async add(payment: Omit<Payment, "id" | "created_at" | "updated_at">): Promise<SQLiteRow<Payment>> {
    const supabase = getSupabase();
    const activeBusinessId = getActiveBusinessId();
    const payload = {
      business_id: toUuid(payment.businessId || activeBusinessId),
      reference_code: normalizeForStorage(payment.referenceCode),
      amount: payment.amount,
      method: payment.method,
      sender_name: normalizeForStorage(payment.senderName),
      sender_phone: payment.senderPhone || null,
      status: payment.status || 'Success',
      date: payment.date || new Date().toISOString(),
    };

    const { data, error } = await supabase.from("payments").insert(payload).select().single();
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
      sync_status: "synced",
    };
  }

  public static async delete(id: string): Promise<boolean> {
    const supabase = getSupabase();
    const { error } = await supabase.from("payments").delete().eq("id", id);
    if (error) { triggerNetworkFailureEvent(); throw error; }
    return true;
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