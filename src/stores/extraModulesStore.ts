import { toUserMessage } from "../utils/userError";
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
  method: "M-Pesa" | "Airtel Money" | "Cash" | "Card" | "Bank";
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

// Nothing is pre-filled: every list starts empty for a real business.
// Older builds shipped demo records here and saved them on the device; they are dropped on load.
const DEMO_IDS = new Set<string>(["PO-2026-001", "PO-2026-002", "PO-2026-003", "REC-01", "REC-02", "REC-03", "BATCH-PAST-041", "BATCH-YOG-012", "BATCH-SMSH-008", "AST-001", "AST-002", "AST-003", "FILE-001", "FILE-002", "FILE-003", "AUD-8912", "AUD-8913", "AUD-8914", "INS-001", "INS-002", "PAY-001", "PAY-002"]);

const loadList = <T extends { id?: string }>(key: string): T[] => {
  const list = getSavedJson<T[]>(key, []);
  if (!Array.isArray(list)) return [];
  const clean = list.filter((item) => !(item && typeof item.id === "string" && DEMO_IDS.has(item.id)));
  if (clean.length !== list.length) saveJson(key, clean);
  return clean;
};

export const useExtraModulesStore = create<ExtraModulesState>((set) => {
  const localPurchasesKey = "kkm_purchases_v1";
  const localRecipesKey = "kkm_recipes_v1";
  const localProductionKey = "kkm_production_v1";
  const localAssetsKey = "kkm_assets_v1";
  const localFilesKey = "kkm_files_v1";
  const localAuditKey = "kkm_audit_logs_v1";
  const localInsightsKey = "kkm_ai_insights_v1";
  const localPaymentsKey = "kkm_payments_v1";

  const initialPurchases = loadList<Purchase>(localPurchasesKey);
  const initialRecipes = loadList<Recipe>(localRecipesKey);
  const initialProduction = loadList<ProductionBatch>(localProductionKey);
  const initialAssets = loadList<BusinessAsset>(localAssetsKey);
  const initialFiles = loadList<StorageFile>(localFilesKey);
  const initialAudit = loadList<AuditLog>(localAuditKey);
  const initialInsights = loadList<AIInsight>(localInsightsKey);
  const initialPayments = loadList<Payment>(localPaymentsKey);
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
        return { success: false, error: toUserMessage(err, "Failed to create production batch.") };
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
        return { success: false, error: toUserMessage(err, "Failed to update production batch.") };
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
        return { success: false, error: toUserMessage(err, "Failed to cancel production batch.") };
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
        return { success: false, error: toUserMessage(err, "Failed to delete production batch.") };
      }
    },
  };
});
