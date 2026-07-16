// src/services/backup/usecases/RunBackupUseCase.ts
import { createClient } from "@supabase/supabase-js";
import path from "path";
import { BackupRepository, SpreadsheetClient } from "../domain/ports";
import { BackupHistoryLog, BackupConfig } from "../domain/entities";

export class RunBackupUseCase {
  constructor(
    private repository: BackupRepository,
    private spreadsheetClient: SpreadsheetClient
  ) {}

  /**
   * Helper to normalize date strings
   */
  private formatTimestamp(dateStr?: string): string {
    if (!dateStr) return "";
    try {
      return new Date(dateStr).toLocaleString("en-KE", { timeZone: "Africa/Nairobi" });
    } catch {
      return dateStr;
    }
  }

  /**
   * Executes the backup pipeline for a business
   */
  public async execute(
    businessId: string,
    type: "manual" | "auto",
    clientPayload?: Record<string, any[]>
  ): Promise<BackupHistoryLog> {
    const timestamp = new Date().toISOString();
    const logId = "log-" + Math.random().toString(36).substring(2, 11);
    
    // Create initial log
    const initialLog: BackupHistoryLog = {
      id: logId,
      timestamp,
      type,
      status: "failed", // default until successful completion
      retries: 0,
      details: {},
    };

    let config: BackupConfig | null = null;
    try {
      config = await this.repository.getConfig(businessId);
      if (!config || !config.enabled) {
        throw new Error("Google Sheets backup integration is disabled or unconfigured.");
      }

      if (!config.googleSheetUrl || !config.googleServiceAccount) {
        throw new Error("Google Sheet URL or Google Service Account JSON is missing.");
      }

      // Add to log
      await this.repository.addHistoryLog(businessId, initialLog);

      // 1. Gather Tables Data
      let products: any[] = [];
      let adjustments: any[] = [];
      let transactions: any[] = [];
      let customers: any[] = [];
      let employees: any[] = [];
      let expenses: any[] = [];
      let suppliers: any[] = [];
      let settings: any[] = [];

      if (clientPayload) {
        // Use client payload (manual backup from browser SQLite/State)
        products = clientPayload.products || [];
        adjustments = clientPayload.adjustments || [];
        transactions = clientPayload.transactions || [];
        customers = clientPayload.customers || [];
        employees = clientPayload.employees || [];
        expenses = clientPayload.expenses || [];
        suppliers = clientPayload.suppliers || [];
        settings = clientPayload.settings || [];
      } else {
        // Run in background on server: fetch from Supabase if available
        const supabaseUrl = process.env.SUPABASE_URL || "";
        const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || "";

        if (supabaseUrl && supabaseKey) {
          console.log("RunBackupUseCase: Fetching data from Supabase in background...");
          const supabase = createClient(supabaseUrl, supabaseKey);
          
          // Products
          const { data: prodData } = await supabase.from("products").select("*").eq("business_id", businessId);
          products = (prodData || []).map(p => ({
            id: p.id,
            name: p.name,
            category: p.category,
            price: Number(p.price),
            cost: Number(p.cost),
            stock: Number(p.stock),
            minStock: Number(p.min_stock),
            unit: p.unit,
            sku: p.sku || "",
            description: p.description || "",
          }));

          // Inventory Adjustments
          const { data: adjData } = await supabase.from("inventory_adjustments").select("*, products(name)").order("timestamp", { ascending: false });
          adjustments = (adjData || []).map(a => ({
            id: a.id,
            productId: a.product_id,
            productName: a.products?.name || "Unknown Product",
            type: a.type,
            quantityAdjusted: Number(a.quantity_adjusted),
            previousStock: Number(a.previous_stock),
            newStock: Number(a.new_stock),
            timestamp: a.timestamp,
            reason: a.reason,
            staffName: a.staff_name,
          }));

          // Transactions
          const { data: txData } = await supabase.from("transactions").select("*").eq("business_id", businessId);
          transactions = txData || [];

          // Customers
          const { data: custData } = await supabase.from("customers").select("*").eq("business_id", businessId);
          customers = custData || [];

          // Employees
          const { data: empData } = await supabase.from("employees").select("*").eq("business_id", businessId);
          employees = empData || [];

          // Expenses (query table or fallback to JSON)
          try {
            const { data: expData, error: expErr } = await supabase.from("expenses").select("*").eq("business_id", businessId);
            if (!expErr && expData) {
              expenses = expData;
            } else {
              expenses = await this.repository.getExpenses(businessId);
            }
          } catch {
            expenses = await this.repository.getExpenses(businessId);
          }

          // Suppliers (query table or fallback to JSON)
          try {
            const { data: supData, error: supErr } = await supabase.from("suppliers").select("*").eq("business_id", businessId);
            if (!supErr && supData) {
              suppliers = supData;
            } else {
              suppliers = await this.repository.getSuppliers(businessId);
            }
          } catch {
            suppliers = await this.repository.getSuppliers(businessId);
          }
        } else {
          // Supabase details are missing, pull whatever local JSON file data is synced to server
          console.warn("RunBackupUseCase: Supabase credentials missing. Backing up local server files...");
          expenses = await this.repository.getExpenses(businessId);
          suppliers = await this.repository.getSuppliers(businessId);
          
          // For sales, read transactions.json
          const localTxFile = path.join(process.cwd(), "data", "transactions.json");
          const fs = await import("fs");
          if (fs.existsSync(localTxFile)) {
            const txData = fs.readFileSync(localTxFile, "utf-8");
            transactions = JSON.parse(txData || "[]");
          }
        }

        // Settings config list (read local settings)
        settings = [
          { name: "Live Supabase Sync Enabled", status: "Active", source: "System Settings" },
          { name: "Google Sheets Backup Integration", status: config.enabled ? "Enabled" : "Disabled", source: "Integration" },
          { name: "Backup Schedule Configured", status: config.schedule, source: "Integration" }
        ];
      }

      // 2. Format Data for Google Sheets
      const backupTimeStr = this.formatTimestamp(timestamp);

      const tables: Record<string, { headers: string[]; rows: any[][] }> = {
        Products: {
          headers: ["Backup Time", "Product ID", "Name", "Category", "Price (KSh)", "Cost (KSh)", "Stock Level", "Min Threshold", "Unit", "SKU", "Description"],
          rows: products.map(p => [
            backupTimeStr,
            p.id,
            p.name,
            p.category,
            p.price,
            p.cost,
            p.stock,
            p.minStock,
            p.unit,
            p.sku,
            p.description || "",
          ]),
        },
        Inventory: {
          headers: ["Backup Time", "Adjustment ID", "Product ID", "Product Name", "Type", "Quantity Adjusted", "Previous Stock", "New Stock", "Timestamp", "Reason", "Logged By"],
          rows: adjustments.map(a => [
            backupTimeStr,
            a.id,
            a.productId,
            a.productName,
            a.type,
            a.quantityAdjusted,
            a.previousStock,
            a.newStock,
            this.formatTimestamp(a.timestamp),
            a.reason,
            a.staffName,
          ]),
        },
        Sales: {
          headers: ["Backup Time", "Transaction ID", "Date/Time", "Customer Name", "Attendant", "Payment Mode", "Subtotal (KSh)", "Discount (KSh)", "Tax (KSh)", "Final Total (KSh)", "Sync Status", "Notes"],
          rows: transactions.map(t => [
            backupTimeStr,
            t.id,
            this.formatTimestamp(t.timestamp),
            t.customer_name || t.customerName || "Walk-in",
            t.staff_name || t.staffName,
            t.payment_method || t.paymentMethod,
            t.total,
            t.discount,
            t.tax,
            t.final_total || t.finalTotal,
            t.status,
            t.note || "",
          ]),
        },
        Expenses: {
          headers: ["Backup Time", "Expense ID", "Amount (KSh)", "Category", "Description", "Date Logged", "Recorded By"],
          rows: expenses.map(e => [
            backupTimeStr,
            e.id,
            e.amount,
            e.category,
            e.description,
            this.formatTimestamp(e.date),
            e.staffName || e.staff_name || "System",
          ]),
        },
        Customers: {
          headers: ["Backup Time", "Customer ID", "Full Name", "Phone Number", "Email Address", "Membership Tier", "Loyalty Points", "Purchases Count", "Debt Balance (KSh)", "Wallet Balance (KSh)"],
          rows: customers.map(c => [
            backupTimeStr,
            c.id,
            c.name,
            c.phone,
            c.email || "",
            c.tier,
            c.loyalty_points !== undefined ? c.loyalty_points : c.loyaltyPoints,
            c.purchases_count !== undefined ? c.purchases_count : c.purchasesCount,
            c.debt_balance !== undefined ? c.debt_balance : (c.debtBalance || 0),
            c.wallet_balance !== undefined ? c.wallet_balance : (c.walletBalance || 0),
          ]),
        },
        Suppliers: {
          headers: ["Backup Time", "Supplier ID", "Contact Name", "Phone", "Email", "Company", "Product Supplied"],
          rows: suppliers.map(s => [
            backupTimeStr,
            s.id,
            s.name,
            s.phone,
            s.email || "",
            s.company || "",
            s.productSupplied || s.product_supplied,
          ]),
        },
        Debts: {
          headers: ["Backup Time", "Customer ID", "Customer Name", "Phone Number", "Outstanding Debt (KSh)", "Loyalty Tier"],
          rows: customers
            .filter(c => (c.debt_balance !== undefined ? c.debt_balance : c.debtBalance) > 0)
            .map(c => [
              backupTimeStr,
              c.id,
              c.name,
              c.phone,
              c.debt_balance !== undefined ? c.debt_balance : c.debtBalance,
              c.tier,
            ]),
        },
        Deliveries: {
          headers: ["Backup Time", "Order ID", "Customer Name", "Rider Assigned", "Delivery Fee (KSh)", "Total Value (KSh)", "Time Placed"],
          rows: transactions
            .filter(t => t.is_delivery || t.isDelivery)
            .map(t => [
              backupTimeStr,
              t.id,
              t.customer_name || t.customerName || "Walk-in",
              t.rider_name || t.riderName || "Not Assigned",
              t.delivery_fee || t.deliveryFee || 0,
              t.final_total || t.finalTotal,
              this.formatTimestamp(t.timestamp),
            ]),
        },
        Employees: {
          headers: ["Backup Time", "Staff ID", "Full Name", "Assigned Role", "Email", "Phone", "Current Shift Status"],
          rows: employees.map(emp => [
            backupTimeStr,
            emp.id,
            emp.name,
            emp.role,
            emp.email || "",
            emp.phone || "",
            emp.active_shift_id || emp.activeShiftId ? "On-Duty" : "Off-Duty",
          ]),
        },
        Settings: {
          headers: ["Backup Time", "Config Section", "Parameter Key", "Config Status", "Parameter Detail"],
          rows: settings.map(set => [
            backupTimeStr,
            set.source,
            set.name,
            set.status,
            set.description || "",
          ]),
        },
      };

      // 3. Upload to Google Sheets
      const syncResult = await this.spreadsheetClient.backupTables(
        config.googleSheetUrl,
        config.googleServiceAccount,
        tables
      );

      const finalLog: BackupHistoryLog = {
        id: logId,
        timestamp,
        type,
        status: syncResult.success ? "success" : "failed",
        error: syncResult.error,
        retries: 0,
        details: syncResult.details,
      };

      // Update log file
      await this.repository.updateHistoryLog(businessId, logId, finalLog);
      return finalLog;
    } catch (err: any) {
      console.error("RunBackupUseCase: Execution caught error:", err.message || err);
      
      const errorLog: BackupHistoryLog = {
        id: logId,
        timestamp,
        type,
        status: "failed",
        error: err.message || "Unknown backup runtime error",
        retries: 0,
        details: {},
      };

      // Update log file with failure
      try {
        await this.repository.updateHistoryLog(businessId, logId, errorLog);
      } catch (logErr) {
        console.error("Failed to update history log with failure status:", logErr);
      }

      return errorLog;
    }
  }

  /**
   * Retries a previously failed backup log
   */
  public async retry(businessId: string, logId: string): Promise<BackupHistoryLog | null> {
    try {
      const logs = await this.repository.getHistory(businessId);
      const targetLog = logs.find(l => l.id === logId);
      if (!targetLog) {
        throw new Error(`Backup log with ID ${logId} not found.`);
      }

      if (targetLog.status === "success") {
        return targetLog;
      }

      const config = await this.repository.getConfig(businessId);
      if (!config || !config.enabled) {
        throw new Error("Google Sheets integration is currently disabled.");
      }

      // Increment retries
      const updatedRetries = targetLog.retries + 1;
      await this.repository.updateHistoryLog(businessId, logId, {
        retries: updatedRetries,
        error: `Retrying attempt #${updatedRetries}...`,
      });

      // Run execution again (we assume this is auto/manual based on log type)
      // Note: For a retry, we don't have clientPayload since it's triggered asynchronously,
      // so it will fetch fresh state from Supabase / server JSON files.
      const syncResult = await this.execute(businessId, targetLog.type);

      // Merge the syncResult with original log ID to update in-place
      const finalLog = {
        ...targetLog,
        status: syncResult.status,
        error: syncResult.error,
        retries: updatedRetries,
        details: syncResult.details,
        timestamp: new Date().toISOString(), // update runtime
      };

      await this.repository.updateHistoryLog(businessId, logId, finalLog);
      return finalLog;
    } catch (err: any) {
      console.error(`Retry failed for log ${logId}:`, err);
      await this.repository.updateHistoryLog(businessId, logId, {
        error: `Retry failed: ${err.message || err}`,
      });
      return null;
    }
  }
}
