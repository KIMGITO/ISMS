// src/services/supabaseService.ts
import { getSupabase } from "./supabaseClient";
import { toUuid } from "../utils/idUtils";
import { Product, Transaction, Customer, Employee, Shift, DbSchedule, CustomerLedgerEntry, DebtPayment } from "../types";
import { useBusinessStore } from "../stores/businessStore";

export class SupabaseService {
  // ==========================================
  // PRODUCT / INVENTORY OPERATIONS (CRUD)
  // ==========================================

  static async fetchProducts(businessId: string): Promise<Product[]> {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from("products")
      .select("*")
      .eq("business_id", toUuid(businessId))
      .order("name", { ascending: true });

    if (error) { if (typeof window !== "undefined") window.dispatchEvent(new Event("network-action-failed")); throw error; }
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
    }));
  }

  // ==========================================
  // TRANSACTION / SALES LOGS OPERATIONS
  // ==========================================

  static async fetchTransactions(businessId: string): Promise<Transaction[]> {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from("transactions")
      .select(`
        *,
        transaction_items (
          *,
          products (*)
        )
      `)
      .eq("business_id", toUuid(businessId))
      .order("timestamp", { ascending: false });

    if (error) { if (typeof window !== "undefined") window.dispatchEvent(new Event("network-action-failed")); throw error; }

    return (data || []).map(t => ({
      id: t.id,
      total: Number(t.total),
      discount: Number(t.discount),
      tax: Number(t.tax),
      finalTotal: Number(t.final_total),
      paymentMethod: t.payment_method,
      customerId: t.customer_id,
      customerName: t.customer_name,
      staffId: t.staff_id,
      staffName: t.staff_name,
      status: t.status as any,
      timestamp: t.timestamp,
      note: t.note,
      isDelivery: t.is_delivery,
      deliveryFee: Number(t.delivery_fee),
      riderName: t.rider_name,
      businessId: t.business_id,
      items: (t.transaction_items || []).map((ti: any) => ({
        product: {
          id: ti.products.id,
          name: ti.products.name,
          category: ti.products.category,
          price: Number(ti.products.price),
          cost: Number(ti.products.cost),
          image: ti.products.image || "",
          stock: Number(ti.products.stock),
          minStock: Number(ti.products.min_stock),
          unit: ti.products.unit,
          sku: ti.products.sku || "",
        },
        quantity: Number(ti.quantity),
        discountPercentage: Number(ti.discount_percentage),
      })),
    }));
  }

  static async createTransaction(tx: Transaction): Promise<any> {
    const supabase = getSupabase();
    
    // 1. Insert transaction header (include id if generated on client)
    const { data: header, error: headerErr } = await supabase
      .from("transactions")
      .insert({
        id: tx.id ? toUuid(tx.id) : undefined,
        business_id: toUuid(tx.businessId),
        total: tx.total,
        discount: tx.discount,
        tax: tx.tax,
        final_total: tx.finalTotal,
        payment_method: tx.paymentMethod,
        customer_id: tx.customerId ? toUuid(tx.customerId) : null,
        customer_name: tx.customerName,
        staff_id: tx.staffId ? toUuid(tx.staffId) : null,
        staff_name: tx.staffName,
        status: "Synced",
        timestamp: tx.timestamp,
        note: tx.note,
        is_delivery: tx.isDelivery,
        delivery_fee: tx.deliveryFee,
        rider_name: tx.riderName,
      })
      .select()
      .single();

    if (headerErr) throw headerErr;

    // 2. Insert transaction items
    if (tx.items && tx.items.length > 0) {
      const itemsPayload = tx.items.map(item => ({
        transaction_id: header.id,
        product_id: toUuid(item.product.id),
        product_name: item.product.name,
        unit_price: item.product.price,
        quantity: item.quantity,
        discount_percentage: item.discountPercentage,
        line_total: Number(((item.product.price * (1 - item.discountPercentage / 100)) * item.quantity).toFixed(2)),
      }));

      const { error: itemsErr } = await supabase
        .from("transaction_items")
        .insert(itemsPayload);

      if (itemsErr) throw itemsErr;
    }

    return header;
  }

  // ==========================================
  // CUSTOMER LOYALTY OPERATIONS
  // ==========================================

  static async fetchCustomers(businessId: string): Promise<Customer[]> {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from("customers")
      .select("*")
      .eq("business_id", toUuid(businessId))
      .order("name", { ascending: true });

    if (error) { if (typeof window !== "undefined") window.dispatchEvent(new Event("network-action-failed")); throw error; }

    return (data || []).map(c => ({
      id: c.id,
      name: c.name,
      phone: c.phone,
      email: c.email || "",
      loyaltyPoints: c.loyalty_points,
      joinDate: c.join_date,
      tier: c.tier as any,
      purchasesCount: c.purchases_count,
      debtBalance: Number(c.debt_balance),
      walletBalance: Number(c.wallet_balance),
      businessId: c.business_id,
      description: c.description || "",
    }));
  }

  static async fetchCustomerLedger(customerId: string): Promise<CustomerLedgerEntry[]> {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from("customer_ledger")
      .select("*")
      .eq("customer_id", toUuid(customerId))
      .order("created_at", { ascending: false });

    if (error) { if (typeof window !== "undefined") window.dispatchEvent(new Event("network-action-failed")); throw error; }

    return (data || []).map(d => ({
      id: d.id,
      businessId: d.business_id,
      customerId: d.customer_id,
      type: d.type as any,
      amount: Number(d.amount),
      walletBalance: Number(d.wallet_balance),
      debtBalance: Number(d.debt_balance),
      recordedBy: d.recorded_by,
      note: d.note || "",
      transactionId: d.transaction_id || "",
      created_at: d.created_at,
    }));
  }

  static async fetchDebtPayments(customerId: string): Promise<DebtPayment[]> {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from("debt_payments")
      .select("*")
      .eq("customer_id", toUuid(customerId))
      .order("created_at", { ascending: false });

    if (error) { if (typeof window !== "undefined") window.dispatchEvent(new Event("network-action-failed")); throw error; }

    return (data || []).map(d => ({
      id: d.id,
      businessId: d.business_id,
      customerId: d.customer_id,
      amountPaid: Number(d.amount_paid),
      remainingDebt: Number(d.remaining_debt),
      paymentMethod: d.payment_method as any,
      recordedBy: d.recorded_by,
      note: d.note || "",
      created_at: d.created_at,
    }));
  }

  static async createDebtPayment(payment: Omit<DebtPayment, 'id' | 'created_at'> & { id?: string }): Promise<DebtPayment> {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from("debt_payments")
      .insert({
        id: payment.id ? toUuid(payment.id) : undefined,
        business_id: toUuid(payment.businessId),
        customer_id: toUuid(payment.customerId),
        amount_paid: payment.amountPaid,
        remaining_debt: payment.remainingDebt,
        payment_method: payment.paymentMethod,
        recorded_by: payment.recordedBy,
        note: payment.note || "",
      })
      .select()
      .single();

    if (error) { if (typeof window !== "undefined") window.dispatchEvent(new Event("network-action-failed")); throw error; }

    return {
      id: data.id,
      businessId: data.business_id,
      customerId: data.customer_id,
      amountPaid: Number(data.amount_paid),
      remainingDebt: Number(data.remaining_debt),
      paymentMethod: data.payment_method as any,
      recordedBy: data.recorded_by,
      note: data.note || "",
      created_at: data.created_at,
    };
  }

  static async createLedgerEntry(entry: Omit<CustomerLedgerEntry, 'id' | 'created_at'> & { id?: string }): Promise<CustomerLedgerEntry> {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from("customer_ledger")
      .insert({
        id: entry.id ? toUuid(entry.id) : undefined,
        business_id: toUuid(entry.businessId),
        customer_id: toUuid(entry.customerId),
        type: entry.type,
        amount: entry.amount,
        wallet_balance: entry.walletBalance,
        debt_balance: entry.debtBalance,
        recorded_by: entry.recordedBy,
        note: entry.note || "",
        transaction_id: entry.transactionId || null,
      })
      .select()
      .single();

    if (error) { if (typeof window !== "undefined") window.dispatchEvent(new Event("network-action-failed")); throw error; }

    return {
      id: data.id,
      businessId: data.business_id,
      customerId: data.customer_id,
      type: data.type as any,
      amount: Number(data.amount),
      walletBalance: Number(data.wallet_balance),
      debtBalance: Number(data.debt_balance),
      recordedBy: data.recorded_by,
      note: data.note || "",
      transactionId: data.transaction_id || "",
      created_at: data.created_at,
    };
  }

  static async fetchBusinessDebtPayments(businessId: string): Promise<DebtPayment[]> {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from("debt_payments")
      .select("*")
      .eq("business_id", toUuid(businessId))
      .order("created_at", { ascending: false });

    if (error) { if (typeof window !== "undefined") window.dispatchEvent(new Event("network-action-failed")); throw error; }

    return (data || []).map(d => ({
      id: d.id,
      businessId: d.business_id,
      customerId: d.customer_id,
      amountPaid: Number(d.amount_paid),
      remainingDebt: Number(d.remaining_debt),
      paymentMethod: d.payment_method as any,
      recordedBy: d.recorded_by,
      note: d.note || "",
      created_at: d.created_at,
    }));
  }

  static subscribeBusinessDebtPayments(businessId: string, callback: (payments: DebtPayment[]) => void): () => void {
    if (!businessId) {
      callback([]);
      return () => {};
    }

    this.fetchBusinessDebtPayments(businessId).then(callback).catch(console.error);

    const supabase = getSupabase();
    const filterString = `business_id=eq.${businessId}`;
    const channel = supabase
      .channel("realtime-business-debt-payments")
      .on(
        "postgres_changes", 
        { 
          event: "*", 
          schema: "public", 
          table: "debt_payments", 
          filter: filterString 
        }, 
        () => {
          this.fetchBusinessDebtPayments(businessId).then(callback).catch(console.error);
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }

  // ==========================================
  // STORAGE & FILE UPLOADS
  // ==========================================

  static async uploadFile(bucketName: string, path: string, file: File): Promise<string> {
    const supabase = getSupabase();
    const { error } = await supabase.storage
      .from(bucketName)
      .upload(path, file, { cacheControl: "3600", upsert: true });

    if (error) { if (typeof window !== "undefined") window.dispatchEvent(new Event("network-action-failed")); throw error; }

    const { data: publicUrlData } = supabase.storage
      .from(bucketName)
      .getPublicUrl(path);

    return publicUrlData.publicUrl;
  }

  // ==========================================
  // EMPLOYEE / STAFF OPERATIONS
  // ==========================================

  static async fetchEmployees(): Promise<Employee[]> {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from("employees")
      .select("*")
      .order("name", { ascending: true });

    if (error) { if (typeof window !== "undefined") window.dispatchEvent(new Event("network-action-failed")); throw error; }
    return (data || []).map(e => ({
      id: e.id,
      name: e.name,
      role: e.role as any,
      email: e.email || "",
      phone: e.phone || "",
      pin: e.pin || "",
      activeShiftId: e.active_shift_id || null,
      avatar: e.avatar || "",
      assignedBranches: Array.isArray(e.assigned_branches) ? e.assigned_branches : [],
      tasks: Array.isArray(e.tasks) ? e.tasks : []
    }));
  }

  // ==========================================
  // INVENTORY ADJUSTMENTS OPERATIONS
  // ==========================================

  static async fetchAllIntegrationConfigs(businessId: string): Promise<Record<string, any>> {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from("integration_configurations")
      .select("section, payload")
      .eq("business_id", toUuid(businessId));

    if (error) {
      console.error(`Error fetching all configs:`, error);
      return {};
    }
    
    const configs: Record<string, any> = {};
    (data || []).forEach(row => {
      configs[row.section] = row.payload;
    });
    return configs;
  }

  static async fetchIntegrationConfig(businessId: string, section: string): Promise<any> {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from("integration_configurations")
      .select("payload")
      .eq("business_id", toUuid(businessId))
      .eq("section", section)
      .maybeSingle();

    if (error && error.code !== 'PGRST116') {
      console.error(`Error fetching config for ${section}:`, error);
      return null;
    }
    return data?.payload || null;
  }

  static async saveIntegrationConfig(businessId: string, section: string, payload: any): Promise<void> {
    const supabase = getSupabase();
    
    const { data: existing } = await supabase
      .from("integration_configurations")
      .select("id")
      .eq("business_id", toUuid(businessId))
      .eq("section", section)
      .maybeSingle();

    if (existing) {
      const { error } = await supabase
        .from("integration_configurations")
        .update({ payload, updated_at: new Date().toISOString() })
        .eq("id", existing.id);
      if (error) throw error;
    } else {
      const { error } = await supabase
        .from("integration_configurations")
        .insert({ business_id: toUuid(businessId), section, payload });
      if (error) throw error;
    }
  }

  static async fetchAdjustments(businessId: string): Promise<any[]> {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from("inventory_adjustments")
      .select("*")
      .eq("business_id", toUuid(businessId))
      .order("timestamp", { ascending: false });

    if (error) { if (typeof window !== "undefined") window.dispatchEvent(new Event("network-action-failed")); throw error; }
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
    }));
  }

  // ==========================================
  // BUSINESS OPERATIONS
  // ==========================================

  static async fetchBusinesses(): Promise<any[]> {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from("businesses")
      .select("*")
      .order("name", { ascending: true });

    if (error) { if (typeof window !== "undefined") window.dispatchEvent(new Event("network-action-failed")); throw error; }
    return (data || []).map(b => ({
      id: b.id,
      name: b.name,
      description: b.description || "",
      address: b.address || "",
      logoUrl: b.logo_url || "",
      businessType: b.business_type || "Retail",
      country: b.country || "Kenya",
      currency: b.currency || "Ksh",
      coverImageUrl: b.cover_image_url || "",
      contactEmail: b.contact_email || "",
      contactPhone: b.contact_phone || "",
      primaryColor: b.primary_color || "",
      secondaryColor: b.secondary_color || "",
      timezone: b.timezone || "Africa/Nairobi",
      defaultPaymentMethods: Array.isArray(b.default_payment_methods) ? b.default_payment_methods : ["Cash", "M-Pesa"],
      isTaxEnabled: b.is_tax_enabled !== false,
      taxPercentage: typeof b.tax_percentage === 'number' ? b.tax_percentage : 16.0
    }));
  }

  // ==========================================
  // EDGE FUNCTION CALLER
  // ==========================================

  static async callEdgeFunction(functionName: string, payload: any): Promise<any> {
    const supabase = getSupabase();
    const { data, error } = await supabase.functions.invoke(functionName, {
      body: payload,
    });

    if (error) {
      console.error(`[callEdgeFunction] "${functionName}" failed:`, error);
      if (typeof window !== "undefined") window.dispatchEvent(new Event("network-action-failed"));
      throw new Error(`Edge function "${functionName}" failed: ${error.message}`);
    }
    return data;
  }

  // ==========================================
  // BILL OF MATERIALS (BOM) OPERATIONS
  // ==========================================

  static async fetchBoms(businessId: string): Promise<any[]> {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from("bill_of_materials")
      .select(`
        *,
        bom_ingredients (
          *,
          products (id, name)
        ),
        products!bill_of_materials_product_id_fkey (id, name),
        recipes (id, name)
      `)
      .eq("business_id", toUuid(businessId))
      .order("name", { ascending: true });

    if (error) { if (typeof window !== "undefined") window.dispatchEvent(new Event("network-action-failed")); throw error; }

    return (data || []).map((bom: any) => ({
      id: bom.id,
      businessId: bom.business_id,
      productId: bom.product_id,
      productName: bom.products?.name || "",
      recipeId: bom.recipe_id,
      recipeName: bom.recipes?.name || "",
      name: bom.name,
      yieldQuantity: Number(bom.yield_quantity),
      yieldUnit: bom.yield_unit,
      ingredients: (bom.bom_ingredients || []).map((ing: any) => ({
        id: ing.id,
        bomId: ing.bom_id,
        productId: ing.product_id,
        productName: ing.products?.name || "",
        quantityRequired: Number(ing.quantity_required),
        unit: ing.unit,
        wastePercentage: Number(ing.waste_percentage),
        createdAt: ing.created_at,
      })),
      createdAt: bom.created_at,
      updatedAt: bom.updated_at,
    }));
  }

  static async createBom(payload: {
    businessId: string;
    productId: string;
    recipeId?: string;
    name: string;
    yieldQuantity: number;
    yieldUnit: string;
    ingredients: Array<{
      productId: string;
      quantityRequired: number;
      unit: string;
      wastePercentage?: number;
    }>;
  }): Promise<any> {
    const supabase = getSupabase();

    // 1. Insert BOM header
    const { data: bom, error: bomErr } = await supabase
      .from("bill_of_materials")
      .insert({
        business_id: toUuid(payload.businessId),
        product_id: toUuid(payload.productId),
        recipe_id: payload.recipeId ? toUuid(payload.recipeId) : null,
        name: payload.name,
        yield_quantity: payload.yieldQuantity,
        yield_unit: payload.yieldUnit,
      })
      .select()
      .single();

    if (bomErr) throw bomErr;

    // 2. Insert BOM ingredients
    if (payload.ingredients.length > 0) {
      const ingredientsPayload = payload.ingredients.map((ing) => ({
        bom_id: bom.id,
        product_id: toUuid(ing.productId),
        quantity_required: ing.quantityRequired,
        unit: ing.unit,
        waste_percentage: ing.wastePercentage || 0,
      }));

      const { error: ingErr } = await supabase
        .from("bom_ingredients")
        .insert(ingredientsPayload);

      if (ingErr) throw ingErr;
    }

    return bom;
  }

  static async deleteBom(id: string): Promise<void> {
    const supabase = getSupabase();
    const { error } = await supabase
      .from("bill_of_materials")
      .delete()
      .eq("id", id);

    if (error) { if (typeof window !== "undefined") window.dispatchEvent(new Event("network-action-failed")); throw error; }
  }

  // Production Batch RPC Operations
  static async createProductionBatchWithDeduction(payload: {
    businessId: string;
    bomId: string;
    recipeName: string;
    quantityProduced: number;
    unit: string;
    status: string;
    staffName: string;
    date?: string;
  }): Promise<any> {
    const supabase = getSupabase();
    const { data, error } = await supabase.rpc("fn_create_production_batch", {
      p_business_id: toUuid(payload.businessId),
      p_bom_id: toUuid(payload.bomId),
      p_recipe_name: payload.recipeName,
      p_quantity_produced: payload.quantityProduced,
      p_unit: payload.unit,
      p_status: payload.status,
      p_staff_name: payload.staffName,
      p_date: payload.date || new Date().toISOString(),
    });

    if (error) {
      if (typeof window !== "undefined") window.dispatchEvent(new Event("network-action-failed"));
      throw error;
    }
    return data;
  }

  static async completeProductionBatch(batchId: string, staffName: string): Promise<any> {
    const supabase = getSupabase();
    const { data, error } = await supabase.rpc("fn_complete_production_batch", {
      p_batch_id: toUuid(batchId),
      p_staff_name: staffName,
    });

    if (error) {
      if (typeof window !== "undefined") window.dispatchEvent(new Event("network-action-failed"));
      throw error;
    }
    return data;
  }

  static async cancelProductionBatchWithRestock(
    batchId: string,
    staffName: string,
    returnItems: Array<{ productId: string; returnQty: number; wasteReason?: string }>
  ): Promise<any> {
    const supabase = getSupabase();
    const { data, error } = await supabase.rpc("fn_cancel_production_batch", {
      p_batch_id: toUuid(batchId),
      p_staff_name: staffName,
      p_return_items: returnItems,
    });

    if (error) {
      if (typeof window !== "undefined") window.dispatchEvent(new Event("network-action-failed"));
      throw error;
    }
    return data;
  }

  static async fetchProductionBatches(businessId: string): Promise<any[]> {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from("production_batches")
      .select("*")
      .eq("business_id", toUuid(businessId))
      .order("date", { ascending: false });

    if (error) {
      if (typeof window !== "undefined") window.dispatchEvent(new Event("network-action-failed"));
      throw error;
    }

    return (data || []).map((b) => ({
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
    }));
  }

  // ==========================================
  // NOTIFICATIONS & DEVICES
  // ==========================================

  static async registerDeviceToken(deviceToken: string, deviceType: string = "web"): Promise<void> {
    const supabase = getSupabase();
    const { data: { user } } = await supabase.auth.getUser();
    
    if (!user) {
      console.warn("User not authenticated, cannot register device token.");
      return;
    }

    const { error } = await supabase
      .from("device_fcm_tokens")
      .upsert({
        user_id: user.id,
        device_token: deviceToken,
        device_type: deviceType,
        updated_at: new Date().toISOString()
      }, {
        onConflict: "user_id, device_token"
      });

    if (error) {
      console.error("Failed to register device token:", error);
    } else {
      console.log("Device token registered successfully.");
    }
  }
  // ==========================================
  // SHIFT OPERATIONS (CRUD)
  // ==========================================

  static async fetchShifts(businessId: string): Promise<Shift[]> {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('shifts')
      .select('*')
      .eq('business_id', toUuid(businessId))
      .order('start_time', { ascending: false });
    if (error) { if (typeof window !== "undefined") window.dispatchEvent(new Event("network-action-failed")); throw error; }
    return (data || []).map(s => ({
      id: s.id,
      employeeId: s.employee_id,
      startTime: s.start_time,
      endTime: s.end_time,
      salesCount: Number(s.sales_count),
      salesTotal: Number(s.sales_total),
      status: s.status as any,
    }));
  }

  static async createShift(payload: { id?: string; businessId: string; employeeId: string; startTime: string; title?: string; notes?: string; color?: string; }): Promise<Shift> {
    const supabase = getSupabase();
    const insertPayload = {
  id: payload.id ? toUuid(payload.id) : undefined,
  business_id: toUuid(payload.businessId),
  employee_id: payload.employeeId,
  start_time: payload.startTime,
  end_time: null,
  status: 'Active',
  title: payload.title || null,
  notes: payload.notes || null,
  // color is UI only; not stored in DB
};
    const { data, error } = await supabase
      .from('shifts')
      .insert(insertPayload)
      .select('*')
      .single();
    if (error) { if (typeof window !== "undefined") window.dispatchEvent(new Event("network-action-failed")); throw error; }
    const s = data as any;
    return {
      id: s.id,
      employeeId: s.employee_id,
      startTime: s.start_time,
      endTime: s.end_time,
      salesCount: Number(s.sales_count),
      salesTotal: Number(s.sales_total),
      status: s.status as any,
    };
  }

  static async updateShift(shift: Shift): Promise<Shift> {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('shifts')
      .update({
        employee_id: shift.employeeId,
        start_time: shift.startTime,
        end_time: shift.endTime,
        sales_count: shift.salesCount,
        sales_total: shift.salesTotal,
        status: shift.status,
      })
      .eq('id', shift.id)
      .select('*')
      .single();
    if (error) { if (typeof window !== "undefined") window.dispatchEvent(new Event("network-action-failed")); throw error; }
    const s = data as any;
    return {
      id: s.id,
      employeeId: s.employee_id,
      startTime: s.start_time,
      endTime: s.end_time,
      salesCount: Number(s.sales_count),
      salesTotal: Number(s.sales_total),
      status: s.status as any,
    };
  }

  static async closeShift(shiftId: string): Promise<void> {
    const supabase = getSupabase();
    const { error } = await supabase
      .from('shifts')
      .update({ status: 'Closed', end_time: new Date().toISOString() })
      .eq('id', shiftId);
    if (error) { if (typeof window !== "undefined") window.dispatchEvent(new Event("network-action-failed")); throw error; }
  }

  // ==========================================
  // SCHEDULE OPERATIONS (CRUD + Real-time)
  // ==========================================

  /** Helper: map a raw DB row to DbSchedule */
  private static mapScheduleRow(s: any): DbSchedule {
    return {
      id: s.id,
      businessId: s.business_id,
      employeeId: s.employee_id,
      title: s.title || '',
      notes: s.notes || null,
      date: s.date,            // DATE → string 'YYYY-MM-DD'
      startTime: s.start_time, // TIME → string 'HH:MM:SS' or 'HH:MM'
      endTime: s.end_time || null,
      repeat: s.repeat || 'None',
      color: s.color || '#f59e0b',
      reminderSent: s.reminder_sent ?? false,
      createdBy: s.created_by || null,
      deletedAt: s.deleted_at || null,
      createdAt: s.created_at,
      updatedAt: s.updated_at,
    };
  }

  /** Fetch all non-deleted schedules for a business */
  static async fetchSchedules(businessId: string): Promise<DbSchedule[]> {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('schedules')
      .select('*')
      .eq('business_id', toUuid(businessId))
      .is('deleted_at', null)
      .order('date', { ascending: true })
      .order('start_time', { ascending: true });
    if (error) {
      if (typeof window !== 'undefined') window.dispatchEvent(new Event('network-action-failed'));
      throw error;
    }
    return (data || []).map(SupabaseService.mapScheduleRow);
  }

  /** Create a new schedule entry */
  static async createSchedule(payload: {
    id?: string;
    businessId: string;
    employeeId: string;
    createdBy?: string;
    title: string;
    notes?: string;
    date: string;       // YYYY-MM-DD
    startTime: string;  // HH:MM
    endTime?: string;   // HH:MM
    repeat?: 'None' | 'Daily' | 'Weekly' | 'Monthly';
    color?: string;
  }): Promise<DbSchedule> {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('schedules')
      .insert({
        id: payload.id ? toUuid(payload.id) : undefined,
        business_id: toUuid(payload.businessId),
        employee_id: payload.employeeId,
        created_by: payload.createdBy || null,
        title: payload.title,
        notes: payload.notes || null,
        date: payload.date,
        start_time: payload.startTime,
        end_time: payload.endTime || null,
        repeat: payload.repeat || 'None',
        color: payload.color || '#f59e0b',
      })
      .select('*')
      .single();
    if (error) {
      if (typeof window !== 'undefined') window.dispatchEvent(new Event('network-action-failed'));
      throw error;
    }
    return SupabaseService.mapScheduleRow(data);
  }

  /** Update an existing schedule */
  static async updateSchedule(schedule: Partial<DbSchedule> & { id: string }): Promise<DbSchedule> {
    const supabase = getSupabase();
    const patch: any = {};
    if (schedule.employeeId !== undefined) patch.employee_id = schedule.employeeId;
    if (schedule.title !== undefined)      patch.title = schedule.title;
    if (schedule.notes !== undefined)      patch.notes = schedule.notes;
    if (schedule.date !== undefined)       patch.date = schedule.date;
    if (schedule.startTime !== undefined)  patch.start_time = schedule.startTime;
    if (schedule.endTime !== undefined)    patch.end_time = schedule.endTime;
    if (schedule.repeat !== undefined)     patch.repeat = schedule.repeat;
    if (schedule.color !== undefined)      patch.color = schedule.color;
    const { data, error } = await supabase
      .from('schedules')
      .update(patch)
      .eq('id', schedule.id)
      .select('*')
      .single();
    if (error) {
      if (typeof window !== 'undefined') window.dispatchEvent(new Event('network-action-failed'));
      throw error;
    }
    return SupabaseService.mapScheduleRow(data);
  }

  /** Soft-delete a schedule */
  static async deleteSchedule(id: string): Promise<void> {
    const supabase = getSupabase();
    const { error } = await supabase
      .from('schedules')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', id);
    if (error) {
      if (typeof window !== 'undefined') window.dispatchEvent(new Event('network-action-failed'));
      throw error;
    }
  }

  /** Subscribe to real-time changes on the schedules table for a given business.
   *  Returns the channel so the caller can unsubscribe. */
  static subscribeToSchedules(
    businessId: string,
    onInsert: (row: DbSchedule) => void,
    onUpdate: (row: DbSchedule) => void,
    onDelete: (id: string) => void,
  ) {
    const supabase = getSupabase();
    const channel = supabase
      .channel(`schedules:${businessId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'schedules',
          filter: `business_id=eq.${toUuid(businessId)}`,
        },
        (payload) => onInsert(SupabaseService.mapScheduleRow(payload.new))
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'schedules',
          filter: `business_id=eq.${toUuid(businessId)}`,
        },
        (payload) => {
          const row = SupabaseService.mapScheduleRow(payload.new);
          // If soft-deleted, treat as delete
          if (row.deletedAt) {
            onDelete(row.id);
          } else {
            onUpdate(row);
          }
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'DELETE',
          schema: 'public',
          table: 'schedules',
          filter: `business_id=eq.${toUuid(businessId)}`,
        },
        (payload) => onDelete(payload.old.id)
      )
      .subscribe();
    return channel;
  }

  static async fetchOpenCreditPayments(customerId: string): Promise<any[]> {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from("credit_payments")
      .select("*")
      .eq("customer_id", toUuid(customerId))
      .in("status", ["Open", "Partial"])
      .order("created_at", { ascending: true });
    if (error) { if (typeof window !== "undefined") window.dispatchEvent(new Event("network-action-failed")); throw error; }
    return data || [];
  }

  static async updateCreditPayment(id: string, updates: { amount_paid: number; status: 'Open' | 'Partial' | 'Settled'; settled_at?: string | null }): Promise<void> {
    const supabase = getSupabase();
    const { error } = await supabase
      .from("credit_payments")
      .update({
        amount_paid: updates.amount_paid,
        status: updates.status,
        settled_at: updates.settled_at || null,
        updated_at: new Date().toISOString()
      })
      .eq("id", id);
    if (error) { if (typeof window !== "undefined") window.dispatchEvent(new Event("network-action-failed")); throw error; }
  }

}

