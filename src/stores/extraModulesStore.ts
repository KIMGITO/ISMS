import { create } from "zustand";
import { BillOfMaterials, BomIngredient, ProductionBatchInput } from "../types";

export interface PurchaseItem {
  name: string;
  quantity: number;
  unit: string;
  price: number;
}

export interface Purchase {
  id: string;
  businessId: string;
  supplierName: string;
  items: PurchaseItem[];
  totalAmount: number;
  status: "Pending" | "Approved" | "Cancelled";
  date: string;
}

export interface RecipeIngredient {
  name: string;
  quantity: number;
  unit: string;
}

export interface Recipe {
  id: string;
  businessId: string;
  name: string;
  code: string;
  ingredients: RecipeIngredient[];
  description: string;
  yieldQuantity: number;
  yieldUnit: string;
}

export interface ProductionBatch {
  id: string;
  businessId: string;
  recipeName: string;
  productId?: string;
  bomId?: string;
  quantityProduced: number;
  unit: string;
  status: "Pending" | "In_Progress" | "Completed" | "Cancelled";
  staffName: string;
  referenceNumber?: string;
  date: string;
}

export interface BusinessAsset {
  id: string;
  businessId: string;
  name: string;
  code: string;
  serialNumber: string;
  value: number;
  status: "Active" | "Under_Maintenance" | "Retired";
}

export interface StorageFile {
  id: string;
  businessId: string;
  name: string;
  size: string;
  type: string;
  url: string;
  uploadedBy: string;
  date: string;
}

export interface AuditLog {
  id: string;
  businessId: string;
  staffName: string;
  action: string;
  module: string;
  details: string;
  date: string;
}

export interface AIInsight {
  id: string;
  businessId: string;
  title: string;
  content: string;
  type: "Recommendation" | "Alert" | "Insight";
  date: string;
}

export interface Payment {
  id: string;
  businessId: string;
  referenceCode: string;
  amount: number;
  method: "M-Pesa" | "Cash" | "Card" | "Bank";
  senderName: string;
  senderPhone?: string;
  status: "Success" | "Pending" | "Failed";
  date: string;
}

interface ExtraModulesState {
  purchases: Purchase[];
  recipes: Recipe[];
  productionBatches: ProductionBatch[];
  assets: BusinessAsset[];
  storageFiles: StorageFile[];
  auditLogs: AuditLog[];
  aiInsights: AIInsight[];
  payments: Payment[];
  billOfMaterials: BillOfMaterials[];
  
  // Basic mutations
  addPurchase: (purchase: Purchase) => void;
  addRecipe: (recipe: Recipe) => void;
  addProductionBatch: (batch: ProductionBatch) => void;
  addAsset: (asset: BusinessAsset) => void;
  addStorageFile: (file: StorageFile) => void;
  addAuditLog: (log: AuditLog) => void;
  addPayment: (payment: Payment) => void;

  // BOM mutations
  setBillOfMaterials: (boms: BillOfMaterials[]) => void;
  addBillOfMaterial: (bom: BillOfMaterials) => void;
  updateBillOfMaterial: (id: string, bom: Partial<BillOfMaterials>) => void;
  removeBillOfMaterial: (id: string) => void;

  // Production batch with backflushing
  createProductionBatch: (input: ProductionBatchInput) => Promise<{ success: boolean; error?: string }>;
  updateProductionBatch: (id: string, updates: { status?: string; quantityProduced?: number; unit?: string; staffName?: string }) => Promise<{ success: boolean; error?: string }>;
  cancelProductionBatch: (
    id: string,
    staffName: string,
    returnItems: Array<{ productId: string; returnQty: number; wasteReason?: string }>
  ) => Promise<{ success: boolean; error?: string }>;
  deleteProductionBatch: (id: string) => Promise<{ success: boolean; error?: string }>;
}

const getSavedJson = <T>(key: string, defaultVal: T): T => {
  try {
    const saved = localStorage.getItem(key);
    return saved ? JSON.parse(saved) : defaultVal;
  } catch {
    return defaultVal;
  }
};

const saveJson = (key: string, data: any) => {
  try {
    localStorage.setItem(key, JSON.stringify(data));
  } catch (err) {
    console.error("Local storage sync error", err);
  }
};

// Seed Data definition
const SEED_PURCHASES: Purchase[] = [
  {
    id: "PO-2026-001",
    businessId: "biz-1",
    supplierName: "Limuru Dairy Cooperative",
    items: [
      { name: "Raw Unpasteurized Milk", quantity: 500, unit: "Liters", price: 65.00 },
      { name: "Heavy Cream tubs", quantity: 20, unit: "Units", price: 450.00 }
    ],
    totalAmount: 41500.00,
    status: "Approved",
    date: "2026-07-07T08:30:00Z"
  },
  {
    id: "PO-2026-002",
    businessId: "biz-1",
    supplierName: "Naivasha Fresh Farms",
    items: [
      { name: "Cultured Lala yeast mix", quantity: 5, unit: "Packets", price: 1200.00 }
    ],
    totalAmount: 6000.00,
    status: "Pending",
    date: "2026-07-08T09:15:00Z"
  },
  {
    id: "PO-2026-003",
    businessId: "biz-1",
    supplierName: "Kiganjo Bottlers",
    items: [
      { name: "1L Glass Bottles (Dairy Spec)", quantity: 1000, unit: "Pieces", price: 35.00 },
      { name: "Silicon Caps batch", quantity: 1, unit: "Box", price: 2500.00 }
    ],
    totalAmount: 37500.00,
    status: "Approved",
    date: "2026-07-06T14:40:00Z"
  }
];

const SEED_RECIPES: Recipe[] = [
  {
    id: "REC-01",
    businessId: "biz-1",
    name: "Pasteurized Creamy Whole Milk 1L",
    code: "REC-WMLK-1L",
    ingredients: [
      { name: "Raw Unpasteurized Milk", quantity: 1.05, unit: "Liters" },
      { name: "Fortified Vitamin D drops", quantity: 2, unit: "Drops" }
    ],
    description: "Standard pasteurization formula at 72°C for 15 seconds. Standardized to 3.5% milk fat.",
    yieldQuantity: 1.0,
    yieldUnit: "Liter"
  },
  {
    id: "REC-02",
    businessId: "biz-1",
    name: "Classic Strawberry Milkshake 250ml",
    code: "REC-SMSH-250",
    ingredients: [
      { name: "Pasteurized Whole Milk", quantity: 0.20, unit: "Liters" },
      { name: "Fresh Strawberry Paste", quantity: 30, unit: "Grams" },
      { name: "Organic Refined Cane Sugar", quantity: 15, unit: "Grams" }
    ],
    description: "Cold emulsified dairy mix. Shake well. Store under 4°C.",
    yieldQuantity: 1.0,
    yieldUnit: "Bottle"
  },
  {
    id: "REC-03",
    businessId: "biz-1",
    name: "Cultured Probio Greek Yogurt 500g",
    code: "REC-GYOG-500",
    ingredients: [
      { name: "Raw Unpasteurized Milk", quantity: 1.50, unit: "Liters" },
      { name: "Thermophilic Yogurt Culture", quantity: 0.5, unit: "Grams" }
    ],
    description: "Double strained fermented dairy. Ferment at 43°C for 8 hours before strain.",
    yieldQuantity: 1.0,
    yieldUnit: "Tub"
  }
];

const SEED_PRODUCTION_BATCHES: ProductionBatch[] = [
  {
    id: "BATCH-PAST-041",
    businessId: "biz-1",
    recipeName: "Pasteurized Creamy Whole Milk 1L",
    quantityProduced: 480,
    unit: "Bottles",
    status: "Completed",
    staffName: "KayKay (Owner)",
    date: "2026-07-07T11:00:00Z"
  },
  {
    id: "BATCH-YOG-012",
    businessId: "biz-1",
    recipeName: "Cultured Probio Greek Yogurt 500g",
    quantityProduced: 120,
    unit: "Tubs",
    status: "In_Progress",
    staffName: "Manager (Operations Supervisor)",
    date: "2026-07-08T06:00:00Z"
  },
  {
    id: "BATCH-SMSH-008",
    businessId: "biz-1",
    recipeName: "Classic Strawberry Milkshake 250ml",
    quantityProduced: 200,
    unit: "Bottles",
    status: "Pending",
    staffName: "Cashier (POS Checkout)",
    date: "2026-07-08T15:00:00Z"
  }
];

const SEED_ASSETS: BusinessAsset[] = [
  {
    id: "AST-001",
    businessId: "biz-1",
    name: "Alfa Laval Milk Pasteurizer & Separator",
    code: "AST-AL-PAST",
    serialNumber: "SN-ALFA-982738-X",
    value: 650000.00,
    status: "Active"
  },
  {
    id: "AST-002",
    businessId: "biz-1",
    name: "Nairobi Hub Cold Storage Cold Room compressor",
    code: "AST-CR-COMP",
    serialNumber: "SN-COPELAND-3817-Y",
    value: 380000.00,
    status: "Active"
  },
  {
    id: "AST-003",
    businessId: "biz-1",
    name: "Cooper Dairy Digital Lactometer analyser",
    code: "AST-LACT-D1",
    serialNumber: "SN-COOPER-L81",
    value: 45000.00,
    status: "Under_Maintenance"
  }
];

const SEED_FILES: StorageFile[] = [
  {
    id: "FILE-001",
    businessId: "biz-1",
    name: "KRA_VAT_Declaration_June_2026.pdf",
    size: "1.4 MB",
    type: "application/pdf",
    url: "/storage/kra/vat_june_2026.pdf",
    uploadedBy: "KayKay (Owner)",
    date: "2026-06-30T16:30:00Z"
  },
  {
    id: "FILE-002",
    businessId: "biz-1",
    name: "Limuru_Supplier_Cooperative_Contract.docx",
    size: "450 KB",
    type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    url: "/storage/contracts/limuru_coop_2026.docx",
    uploadedBy: "Admin",
    date: "2026-01-15T09:00:00Z"
  },
  {
    id: "FILE-003",
    businessId: "biz-1",
    name: "Cold_Storage_Diesel_Spillage_Log.xlsx",
    size: "820 KB",
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    url: "/storage/logs/spillage_diesel_may.xlsx",
    uploadedBy: "Manager (Operations Supervisor)",
    date: "2026-05-31T17:15:00Z"
  }
];

const SEED_AUDIT_LOGS: AuditLog[] = [
  {
    id: "AUD-8912",
    businessId: "biz-1",
    staffName: "KayKay (Owner)",
    action: "ROLE_PERMISSIONS_UPDATE",
    module: "Roles & Permissions",
    details: "Modified POS Checkout permissions mapping. Granted pos.refund to Cashier role.",
    date: "2026-07-08T10:15:00Z"
  },
  {
    id: "AUD-8913",
    businessId: "biz-1",
    staffName: "Manager (Operations Supervisor)",
    action: "INVENTORY_ADJUST",
    module: "Inventory",
    details: "Adjusted stock of Greek Yogurt 500g from 15 to 10. Reason: 5 Tubs Damaged in cooling room.",
    date: "2026-07-08T11:45:00Z"
  },
  {
    id: "AUD-8914",
    businessId: "biz-1",
    staffName: "Admin",
    action: "BACKUP_TRIGGERED",
    module: "Settings",
    details: "Manual backup executed. Synchronized 142 transactions to Google Sheets.",
    date: "2026-07-08T12:00:00Z"
  }
];

const SEED_INSIGHTS: AIInsight[] = [
  {
    id: "INS-001",
    businessId: "biz-1",
    title: "Pasteurization Temperature Warning",
    content: "Historical logs indicate cooling diesel consumption increases by 12% when pasteurizer cooling is kept active past 7 PM. Recommend running batches before 2 PM.",
    type: "Alert",
    date: "2026-07-07T18:00:00Z"
  },
  {
    id: "INS-002",
    businessId: "biz-1",
    title: "Strawberry Milkshake Sales Surge",
    content: "Sales data shows Classic Strawberry Milkshake 250ml velocity is up 35% on Wednesday afternoons. Consider raising production batch limits for Tuesday runs.",
    type: "Recommendation",
    date: "2026-07-08T08:00:00Z"
  }
];

const SEED_PAYMENTS: Payment[] = [
  {
    id: "PAY-001",
    businessId: "biz-1",
    referenceCode: "PGB8A983K2",
    amount: 1250.00,
    method: "M-Pesa",
    senderName: "Dennis Kamau",
    senderPhone: "+254712345678",
    status: "Success",
    date: "2026-07-08T14:20:00Z"
  },
  {
    id: "PAY-002",
    businessId: "biz-1",
    referenceCode: "CASH-VER-3918",
    amount: 4500.00,
    method: "Cash",
    senderName: "Walk-in Customer",
    status: "Success",
    date: "2026-07-08T15:10:00Z"
  }
];

export const useExtraModulesStore = create<ExtraModulesState>((set) => {
  const localPurchasesKey = "kkm_purchases_v1";
  const localRecipesKey = "kkm_recipes_v1";
  const localProductionKey = "kkm_production_v1";
  const localAssetsKey = "kkm_assets_v1";
  const localFilesKey = "kkm_files_v1";
  const localAuditKey = "kkm_audit_logs_v1";
  const localInsightsKey = "kkm_ai_insights_v1";
  const localPaymentsKey = "kkm_payments_v1";

  const initialPurchases = getSavedJson<Purchase[]>(localPurchasesKey, SEED_PURCHASES);
  const initialRecipes = getSavedJson<Recipe[]>(localRecipesKey, SEED_RECIPES);
  const initialProduction = getSavedJson<ProductionBatch[]>(localProductionKey, SEED_PRODUCTION_BATCHES);
  const initialAssets = getSavedJson<BusinessAsset[]>(localAssetsKey, SEED_ASSETS);
  const initialFiles = getSavedJson<StorageFile[]>(localFilesKey, SEED_FILES);
  const initialAudit = getSavedJson<AuditLog[]>(localAuditKey, SEED_AUDIT_LOGS);
  const initialInsights = getSavedJson<AIInsight[]>(localInsightsKey, SEED_INSIGHTS);
  const initialPayments = getSavedJson<Payment[]>(localPaymentsKey, SEED_PAYMENTS);
  const localBomKey = "kkm_bill_of_materials_v1";
  const initialBoms = getSavedJson<BillOfMaterials[]>(localBomKey, []);

  return {
    purchases: initialPurchases,
    recipes: initialRecipes,
    productionBatches: initialProduction,
    assets: initialAssets,
    storageFiles: initialFiles,
    auditLogs: initialAudit,
    aiInsights: initialInsights,
    payments: initialPayments,
    billOfMaterials: initialBoms,

    addPurchase: (purchase) => {
      set((state) => {
        const updated = [purchase, ...state.purchases];
        saveJson(localPurchasesKey, updated);
        return { purchases: updated };
      });
    },

    addRecipe: (recipe) => {
      set((state) => {
        const updated = [recipe, ...state.recipes];
        saveJson(localRecipesKey, updated);
        return { recipes: updated };
      });
    },

    addProductionBatch: (batch) => {
      set((state) => {
        const updated = [batch, ...state.productionBatches];
        saveJson(localProductionKey, updated);
        return { productionBatches: updated };
      });
    },

    addAsset: (asset) => {
      set((state) => {
        const updated = [asset, ...state.assets];
        saveJson(localAssetsKey, updated);
        return { assets: updated };
      });
    },

    addStorageFile: (file) => {
      set((state) => {
        const updated = [file, ...state.storageFiles];
        saveJson(localFilesKey, updated);
        return { storageFiles: updated };
      });
    },

    addAuditLog: (log) => {
      set((state) => {
        const updated = [log, ...state.auditLogs];
        saveJson(localAuditKey, updated);
        return { auditLogs: updated };
      });
    },

    addPayment: (payment) => {
      set((state) => {
        const updated = [payment, ...state.payments];
        saveJson(localPaymentsKey, updated);
        return { payments: updated };
      });
    },

    // BOM mutations
    setBillOfMaterials: (boms) => {
      set({ billOfMaterials: boms });
      saveJson(localBomKey, boms);
    },

    addBillOfMaterial: (bom) => {
      set((state) => {
        const updated = [bom, ...state.billOfMaterials];
        saveJson(localBomKey, updated);
        return { billOfMaterials: updated };
      });
    },

    updateBillOfMaterial: (id, bom) => {
      set((state) => {
        const updated = state.billOfMaterials.map((b) =>
          b.id === id ? { ...b, ...bom } : b
        );
        saveJson(localBomKey, updated);
        return { billOfMaterials: updated };
      });
    },

    removeBillOfMaterial: (id) => {
      set((state) => {
        const updated = state.billOfMaterials.filter((b) => b.id !== id);
        saveJson(localBomKey, updated);
        return { billOfMaterials: updated };
      });
    },

    // Production batch with atomic RPCs and backflushing
    createProductionBatch: async (input) => {
      try {
        const { SupabaseService } = await import("../services/supabaseService");
        const data = await SupabaseService.createProductionBatchWithDeduction({
          businessId: input.businessId,
          bomId: input.bomId || "",
          recipeName: input.recipeName,
          quantityProduced: input.quantityProduced,
          unit: input.unit,
          status: input.status === "In Progress" ? "In Progress" : input.status,
          staffName: input.staffName,
          date: input.date,
        });

        const newBatch: ProductionBatch = {
          id: data.id,
          businessId: data.business_id,
          recipeName: data.recipe_name,
          productId: data.product_id || undefined,
          bomId: data.bom_id || undefined,
          quantityProduced: Number(data.quantity_produced),
          unit: data.unit,
          status: data.status === "In Progress" ? "In_Progress" : data.status as any,
          staffName: data.staff_name,
          referenceNumber: data.reference_number || undefined,
          date: data.date,
        };

        set((state) => {
          const updated = [newBatch, ...state.productionBatches.filter(b => b.id !== newBatch.id)];
          saveJson(localProductionKey, updated);
          return { productionBatches: updated };
        });

        return { success: true };
      } catch (err: any) {
        return { success: false, error: err.message || "Failed to create production batch." };
      }
    },

    updateProductionBatch: async (id, updates) => {
      try {
        const { SupabaseService } = await import("../services/supabaseService");
        
        let data: any;
        if (updates.status === 'Completed') {
          data = await SupabaseService.completeProductionBatch(id, updates.staffName || 'Staff');
        } else {
          const { getSupabase } = await import("../services/supabaseClient");
          const supabase = getSupabase();

          const updateData: any = {};
          if (updates.status !== undefined) updateData.status = updates.status;
          if (updates.quantityProduced !== undefined) updateData.quantity_produced = updates.quantityProduced;
          if (updates.unit !== undefined) updateData.unit = updates.unit;
          if (updates.staffName !== undefined) updateData.staff_name = updates.staffName;

          const { data: updatedRow, error } = await supabase
            .from("production_batches")
            .update(updateData)
            .eq("id", id)
            .select()
            .single();

          if (error) throw error;
          data = updatedRow;
        }

        const updatedBatch: ProductionBatch = {
          id: data.id,
          businessId: data.business_id,
          recipeName: data.recipe_name,
          productId: data.product_id || undefined,
          bomId: data.bom_id || undefined,
          quantityProduced: Number(data.quantity_produced),
          unit: data.unit,
          status: data.status === "In Progress" ? "In_Progress" : data.status as any,
          staffName: data.staff_name,
          referenceNumber: data.reference_number || undefined,
          date: data.date,
        };

        set((state) => {
          const updated = state.productionBatches.map(b => b.id === id ? updatedBatch : b);
          saveJson(localProductionKey, updated);
          return { productionBatches: updated };
        });

        return { success: true };
      } catch (err: any) {
        return { success: false, error: err.message || "Failed to update production batch." };
      }
    },

    cancelProductionBatch: async (id, staffName, returnItems) => {
      try {
        const { SupabaseService } = await import("../services/supabaseService");
        const data = await SupabaseService.cancelProductionBatchWithRestock(id, staffName, returnItems);

        const updatedBatch: ProductionBatch = {
          id: data.id,
          businessId: data.business_id,
          recipeName: data.recipe_name,
          productId: data.product_id || undefined,
          bomId: data.bom_id || undefined,
          quantityProduced: Number(data.quantity_produced),
          unit: data.unit,
          status: "Cancelled",
          staffName: data.staff_name,
          referenceNumber: data.reference_number || undefined,
          date: data.date,
        };

        set((state) => {
          const updated = state.productionBatches.map(b => b.id === id ? updatedBatch : b);
          saveJson(localProductionKey, updated);
          return { productionBatches: updated };
        });

        return { success: true };
      } catch (err: any) {
        return { success: false, error: err.message || "Failed to cancel production batch." };
      }
    },

    deleteProductionBatch: async (id) => {
      try {
        const { getSupabase } = await import("../services/supabaseClient");
        const supabase = getSupabase();

        const { error } = await supabase
          .from("production_batches")
          .delete()
          .eq("id", id);

        if (error) throw error;

        set((state) => {
          const updated = state.productionBatches.filter(b => b.id !== id);
          saveJson(localProductionKey, updated);
          return { productionBatches: updated };
        });

        return { success: true };
      } catch (err: any) {
        return { success: false, error: err.message || "Failed to delete production batch." };
      }
    },
  };
});
