// src/stores/inventoryStore.ts
// Re-engineered for Pure Real-Time Streaming — Removes local cache lookups entirely

import { create } from "zustand";
import { Product, InventoryAdjustment, AdjustmentType } from "../types";
import { useAuthStore } from "./authStore";
import { useNotificationStore } from "./notificationStore";
import { useBusinessStore } from "./businessStore";
import { ProductRepository, InventoryAdjustmentRepository, ProductCategoryRepository } from "../services/repositories";
import { toUserMessage } from "../utils/userError";
import { normalizeForStorage } from "../utils/stringUtils";
import { getSupabase } from "../services/supabaseClient";
import { toUuid } from "../utils/idUtils";
import { checkPermissionGate } from "../utils/permissions";
import { NotificationService } from "../services/notifications/notificationService";

interface InventoryState {
  products: Product[];
  adjustments: InventoryAdjustment[];
  categories: string[];
  adjustStock: (
    productId: string,
    quantityAdjusted: number,
    type: AdjustmentType,
    reason: string
  ) => Promise<void>;
    adjustStockBulk: (
    adjustments: {
      productId: string;
      quantityAdjusted: number;
      type: AdjustmentType;
      reason: string;
    }[]
  ) => Promise<void>;

  addProduct: (product: Product) => Promise<void>;
  updateProduct: (product: Product) => Promise<void>;
  deleteProduct: (id: string) => Promise<void>;
  deductStock: (items: { product: Product; quantity: number }[]) => Promise<void>;
  addCategory: (category: string) => Promise<boolean>;
  updateCategory: (oldCategory: string, newCategory: string) => Promise<void>;
  setProducts: (products: Product[]) => void;
}

export const useInventoryStore = create<InventoryState>((set, get) => {
  let unsubProducts: (() => void) | null = null;
  let unsubAdjustments: (() => void) | null = null;
  let unsubCategories: (() => void) | null = null;
  // Saved categories, plus any a product uses, so neither list can hide the other.
  let savedCategories: string[] = [];
  const mergeCategories = (prods: Product[]) =>
    Array.from(new Set([...savedCategories, ...prods.map((p) => p.category)].filter(Boolean)))
      .sort((a, b) => a.localeCompare(b));

  const setupSubscriptions = (businessId: string) => {
    if (unsubProducts) unsubProducts();
    if (unsubAdjustments) unsubAdjustments();
    if (unsubCategories) unsubCategories();
    savedCategories = [];

    if (!businessId) {
      set({ products: [], adjustments: [], categories: [] });
      return;
    }

    unsubProducts = ProductRepository.subscribe((prods) => {
      set({ products: prods, categories: mergeCategories(prods) });
    });

    unsubCategories = ProductCategoryRepository.subscribe((names) => {
      savedCategories = names;
      set({ categories: mergeCategories(get().products) });
    });

    unsubAdjustments = InventoryAdjustmentRepository.subscribe((adjs) => {
      set({ adjustments: adjs });
    });
  };

  // Listen to business transitions dynamically after all modules load to avoid circular init issues
  setTimeout(() => {
    useBusinessStore.subscribe((state) => {
      setupSubscriptions(state.activeBusinessId);
    });
    setupSubscriptions(useBusinessStore.getState().activeBusinessId);
  }, 0);

  return {
    // Start with blank arrays; subscriptions will instantly hydrate state on boot
    products: [],
    adjustments: [],
    categories: [],

    adjustStock: async (productId, quantityAdjusted, type, reason) => {
      if (!checkPermissionGate("inventory.adjust_stock")) return;

      const prod = get().products.find(p => p.id === productId);
      if (!prod) return;

      const previousStock = prod.stock;
      const newStock = Math.max(0, previousStock + quantityAdjusted);

      if (newStock === 0 && previousStock > 0) {
        useNotificationStore.getState().showToast(
          "Inventory Alert",
          `CRITICAL: "${prod.name}" is now completely Out of Stock!`,
          prod.image || "",
          "error"
        );
        NotificationService.createInventoryAlert(prod.name, newStock, prod.minStock, prod.unit || "units", true);
      } else if (newStock <= prod.minStock && previousStock > prod.minStock && newStock > 0) {
        useNotificationStore.getState().showToast(
          "Inventory Alert",
          `Warning: "${prod.name}" is low in stock! Current: ${newStock} units.`,
          prod.image || "",
          "info"
        );
        NotificationService.createInventoryAlert(prod.name, newStock, prod.minStock, prod.unit || "units", false);
      }

      const supabase = getSupabase();
      const staffName = useAuthStore.getState().currentEmployee?.name || "System";
      const staffId = useAuthStore.getState().currentEmployee?.id;

      const { error } = await supabase.rpc("adjust_stock_manually", {
        p_product_id: toUuid(productId),
        p_employee_id: staffId ? toUuid(staffId) : null,
        p_staff_name: staffName,
        p_adj_type: type,
        p_quantity: Math.abs(quantityAdjusted),
        p_reason: reason
      });

      if (error) { 
        if (typeof window !== "undefined") window.dispatchEvent(new Event("network-action-failed")); 
        throw error; 
      }
      
      // Realtime listener catches this adjustment change automatically!
    },

    adjustStockBulk: async (adjustments) => {
      if (!checkPermissionGate("inventory.adjust_stock")) return;

      const supabase = getSupabase();
      const staffName = useAuthStore.getState().currentEmployee?.name || "System";
      const staffId = useAuthStore.getState().currentEmployee?.id;

      const { error } = await supabase.rpc("adjust_stock_bulk", {
        p_adjustments: adjustments.map(adj => ({
          product_id: toUuid(adj.productId),
          type: adj.type,
          quantity: Math.abs(adj.quantityAdjusted),
          reason: adj.reason
        })),
        p_employee_id: staffId ? toUuid(staffId) : null,
        p_staff_name: staffName,
      });

      if (error) {
        if (typeof window !== "undefined") window.dispatchEvent(new Event("network-action-failed"));
        throw error;
      }
    },


    addProduct: async (product) => {
      if (!checkPermissionGate("products.create")) return;
      await ProductRepository.add(product);
      // Realtime channel handles state push automatically
    },

    updateProduct: async (product) => {
      if (!checkPermissionGate("products.update")) return;
      await ProductRepository.update(product.id, product);
      // Realtime channel handles state push automatically
    },

    deleteProduct: async (id) => {
      if (!checkPermissionGate("products.delete")) return;
      await ProductRepository.delete(id);
      // Realtime channel handles state push automatically
    },

    deductStock: async (items) => {
      for (const item of items) {
        const p = get().products.find(prod => prod.id === item.product.id);
        if (p) {
          const previousStock = p.stock;
          const newStock = Math.max(0, p.stock - item.quantity);

          if (newStock === 0 && previousStock > 0) {
            useNotificationStore.getState().showToast(
              "Inventory Alert",
              `CRITICAL: "${p.name}" is now completely Out of Stock!`,
              p.image || "",
              "error"
            );
            NotificationService.createInventoryAlert(p.name, newStock, p.minStock, p.unit || "units", true);
          } else if (newStock <= p.minStock && previousStock > p.minStock && newStock > 0) {
            useNotificationStore.getState().showToast(
              "Inventory Alert",
              `Warning: "${p.name}" is low in stock! Current: ${newStock} units.`,
              p.image || "",
              "info"
            );
            NotificationService.createInventoryAlert(p.name, newStock, p.minStock, p.unit || "units", false);
          }
          
          // Local optimistic memory state feedback
          set({
            products: get().products.map(prod => prod.id === p.id ? { ...prod, stock: newStock } : prod)
          });
        }
      }
    },

    addCategory: async (category) => {
      if (!checkPermissionGate("products.manage_categories")) return false;
      const name = category.trim();
      if (!name) return false;
      if (get().categories.some((c) => c.toLowerCase() === name.toLowerCase())) return true;
      try {
        await ProductCategoryRepository.add(name, useAuthStore.getState().currentEmployee?.name || "Staff");
        savedCategories = [...savedCategories, name.toLowerCase()];
        set({ categories: mergeCategories(get().products) });
        return true;
      } catch (err) {
        useNotificationStore.getState().showToast("Could Not Add Category", toUserMessage(err, "Please try again."), undefined, "error");
        return false;
      }
    },

    updateCategory: async (oldCategory, newCategory) => {
      if (!checkPermissionGate("products.manage_categories")) return;
      
      const businessId = useBusinessStore.getState().activeBusinessId;
      const supabase = getSupabase();
      
      const { error } = await supabase.rpc("update_product_category_bulk", {
        p_business_id: toUuid(businessId),
        p_old_category: oldCategory,
        // Products store categories in lowercase; the screen shows them in title case.
        p_new_category: normalizeForStorage(newCategory)
      });

      if (error) {
        if (typeof window !== "undefined") window.dispatchEvent(new Event("network-action-failed"));
        throw error;
      }
      // Products were renamed by the call above; the saved category follows.
      await ProductCategoryRepository.rename(oldCategory, normalizeForStorage(newCategory));
    },

    setProducts: () => {
      // Intentional No-Op: Stream updates handle sync automatically.
    },
  };
});