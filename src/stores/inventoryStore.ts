// src/stores/inventoryStore.ts
// Re-engineered for Pure Real-Time Streaming — Removes local cache lookups entirely

import { create } from "zustand";
import { Product, InventoryAdjustment } from "../types";
import { useAuthStore } from "./authStore";
import { useNotificationStore } from "./notificationStore";
import { useBusinessStore } from "./businessStore";
import { ProductRepository, InventoryAdjustmentRepository } from "../services/repositories";
import { getSupabase } from "../services/supabaseClient";
import { toUuid } from "../utils/idUtils";
import { checkPermissionGate } from "../utils/permissions";

interface InventoryState {
  products: Product[];
  adjustments: InventoryAdjustment[];
  categories: string[];
  adjustStock: (
    productId: string,
    quantityAdjusted: number,
    type: "Restock" | "Damage" | "Reconciliation",
    reason: string
  ) => Promise<void>;
  addProduct: (product: Product) => Promise<void>;
  updateProduct: (product: Product) => Promise<void>;
  deleteProduct: (id: string) => Promise<void>;
  deductStock: (items: { product: Product; quantity: number }[]) => Promise<void>;
  addCategory: (category: string) => void;
  updateCategory: (oldCategory: string, newCategory: string) => Promise<void>;
  setProducts: (products: Product[]) => void;
}

export const useInventoryStore = create<InventoryState>((set, get) => {
  let unsubProducts: (() => void) | null = null;
  let unsubAdjustments: (() => void) | null = null;

  const setupSubscriptions = (businessId: string) => {
    if (unsubProducts) unsubProducts();
    if (unsubAdjustments) unsubAdjustments();

    if (!businessId) {
      set({ products: [], adjustments: [], categories: [] });
      return;
    }

    unsubProducts = ProductRepository.subscribe((prods) => {
      set({ 
        products: prods,
        categories: Array.from(new Set(prods.map(p => p.category).filter(Boolean)))
      });
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

      // Find item from active live reactive state instead of old local memory array lookups
      const prod = get().products.find(p => p.id === productId);
      if (!prod) return;

      const previousStock = prod.stock;
      const newStock = Math.max(0, previousStock + quantityAdjusted);

      // Trigger Out of Stock / Low Stock toast notifications dynamically
      if (newStock === 0 && previousStock > 0) {
        useNotificationStore.getState().showToast(
          "Inventory Alert",
          `CRITICAL: "${prod.name}" is now completely Out of Stock!`,
          prod.image || "",
          "error"
        );
      } else if (newStock <= prod.minStock && previousStock > prod.minStock && newStock > 0) {
        useNotificationStore.getState().showToast(
          "Inventory Alert",
          `Warning: "${prod.name}" is low in stock! Current: ${newStock} units.`,
          prod.image || "",
          "info"
        );
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
          } else if (newStock <= p.minStock && previousStock > p.minStock && newStock > 0) {
            useNotificationStore.getState().showToast(
              "Inventory Alert",
              `Warning: "${p.name}" is low in stock! Current: ${newStock} units.`,
              p.image || "",
              "info"
            );
          }
          
          // Local optimistic memory state feedback
          set({
            products: get().products.map(prod => prod.id === p.id ? { ...prod, stock: newStock } : prod)
          });
        }
      }
    },

    addCategory: (category) => {
      const current = get().categories;
      if (current.map((c) => c.toLowerCase()).includes(category.toLowerCase())) return;
      set({ categories: [...current, category] });
    },

    updateCategory: async (oldCategory, newCategory) => {
      if (!checkPermissionGate("products.manage_categories")) return;
      const currentProds = get().products;
      for (const p of currentProds) {
        if (p.category === oldCategory) {
          await ProductRepository.update(p.id, { category: newCategory });
        }
      }
    },

    setProducts: () => {
      // Intentional No-Op: Stream updates handle sync automatically.
    },
  };
});