// src/stores/pendingActionStore.ts
// Intelligent Pending Actions (Drafts) & Human-in-the-Loop Verification Store

import { create } from 'zustand';
import { PendingAction, PendingActionType, PendingActionValidation } from '../types';
import { useAuthStore } from './authStore';
import { useBusinessStore } from './businessStore';
import { useInventoryStore } from './inventoryStore';
import { useCustomerStore } from './customerStore';
import { useExtraModulesStore } from './extraModulesStore';
import { useNotificationStore } from './notificationStore';
import { ProductRepository, CustomerRepository, ExpenseRepository } from '../services/repositories';
import { SupabaseService } from '../services/supabaseService';
import { hasRolePermission } from '../utils/permissions';

interface PendingActionInput {
  type: PendingActionType;
  title: string;
  summary: string;
  requiredPermission: string;
  params: Record<string, any>;
  createdBy?: string;
}

interface PendingActionState {
  pendingActions: PendingAction[];
  isDrawerOpen: boolean;

  setDrawerOpen: (open: boolean) => void;
  addPendingAction: (input: PendingActionInput) => PendingAction;
  verifyPendingAction: (id: string, updatedParams: Record<string, any>) => void;
  executePendingAction: (id: string) => Promise<{ success: boolean; error?: string }>;
  rejectPendingAction: (id: string) => void;
  clearCompletedActions: () => void;
}

const LOCAL_STORAGE_KEY = 'kkm_pending_actions_v1';

const loadSavedActions = (): PendingAction[] => {
  try {
    const saved = localStorage.getItem(LOCAL_STORAGE_KEY);
    return saved ? JSON.parse(saved) : [];
  } catch {
    return [];
  }
};

const saveActions = (actions: PendingAction[]) => {
  try {
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(actions));
  } catch (err) {
    console.error('Failed to save pending actions:', err);
  }
};

export const evaluateValidation = (
  type: PendingActionType,
  requiredPermission: string,
  params: Record<string, any>
): PendingActionValidation => {
  const currentRole = useAuthStore.getState().currentEmployee?.role || 'Staff';
  const hasPermission = hasRolePermission(currentRole, requiredPermission as any);
  
  const warnings: string[] = [];
  const errors: string[] = [];
  let hasStock = true;

  if (!hasPermission) {
    errors.push(`Action requires "${requiredPermission}" permission. Role "${currentRole}" is unauthorized.`);
  }

  // Stock validation for checkouts / stock adjustments
  if (type === 'create_checkout' && params.items && Array.isArray(params.items)) {
    const products = useInventoryStore.getState().products;
    for (const item of params.items) {
      const prod = products.find(
        (p) => p.id === item.productId || p.name.toLowerCase().includes((item.productName || '').toLowerCase())
      );
      const qty = parseFloat(item.quantity) || 1;
      if (!prod) {
        errors.push(`Product "${item.productName || item.productId}" not found in catalog.`);
      } else if (prod.stock < qty) {
        hasStock = false;
        errors.push(`Insufficient stock for "${prod.name}": required ${qty}, available ${prod.stock}.`);
      }
    }
  }

  if (type === 'adjust_stock' && params.type === 'damage') {
    const products = useInventoryStore.getState().products;
    const prod = products.find(
      (p) => p.id === params.productId || p.name.toLowerCase().includes((params.productName || '').toLowerCase())
    );
    const qty = parseFloat(params.quantity) || 0;
    if (prod && prod.stock < qty) {
      warnings.push(`Damage adjustment quantity (${qty}) exceeds current stock (${prod.stock}).`);
    }
  }

  return {
    isValid: errors.length === 0,
    hasPermission,
    hasStock,
    warnings,
    errors,
  };
};

export const usePendingActionStore = create<PendingActionState>((set, get) => {
  const initialActions = loadSavedActions();

  return {
    pendingActions: initialActions,
    isDrawerOpen: false,

    setDrawerOpen: (open) => set({ isDrawerOpen: open }),

    addPendingAction: (input) => {
      const activeBizId = useBusinessStore.getState().activeBusinessId || 'biz-1';
      const staffName = useAuthStore.getState().currentEmployee?.name || 'Kim AI Copilot';
      const validation = evaluateValidation(input.type, input.requiredPermission, input.params);

      const newAction: PendingAction = {
        id: `act-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
        businessId: activeBizId,
        type: input.type,
        title: input.title,
        summary: input.summary,
        requiredPermission: input.requiredPermission,
        params: input.params,
        status: 'pending_review',
        createdAt: new Date().toISOString(),
        createdBy: input.createdBy || staffName,
        validation,
      };

      set((state) => {
        const updated = [newAction, ...state.pendingActions];
        saveActions(updated);
        return { pendingActions: updated };
      });

      useNotificationStore.getState().showToast(
        'Pending Action Queued',
        `AI prepared "${input.title}". Review and confirm in Pending Actions panel.`,
        undefined,
        'info'
      );

      return newAction;
    },

    verifyPendingAction: (id, updatedParams) => {
      set((state) => {
        const updated = state.pendingActions.map((act) => {
          if (act.id === id) {
            const validation = evaluateValidation(act.type, act.requiredPermission, updatedParams);
            return {
              ...act,
              params: updatedParams,
              status: 'verified' as const,
              validation,
            };
          }
          return act;
        });
        saveActions(updated);
        return { pendingActions: updated };
      });
    },

    executePendingAction: async (id) => {
      const action = get().pendingActions.find((a) => a.id === id);
      if (!action) return { success: false, error: 'Pending action not found.' };

      // Re-evaluate validation before execution
      const validation = evaluateValidation(action.type, action.requiredPermission, action.params);
      if (!validation.isValid) {
        return { success: false, error: validation.errors.join(' ') };
      }

      const activeBizId = useBusinessStore.getState().activeBusinessId;
      const staffName = useAuthStore.getState().currentEmployee?.name || 'Staff Operator';
      const params = action.params;

      try {
        switch (action.type) {
          case 'create_checkout': {
            const { products } = useInventoryStore.getState();
            const items = params.items || [];
            const cartItems: Array<{ product: any; quantity: number }> = [];

            for (const item of items) {
              const prod = products.find(
                (p) => p.id === item.productId || p.name.toLowerCase().includes((item.productName || '').toLowerCase())
              );
              if (prod) {
                cartItems.push({ product: prod, quantity: parseFloat(item.quantity) || 1 });
              }
            }

            if (cartItems.length > 0) {
              await useInventoryStore.getState().deductStock(cartItems);
            }
            break;
          }

          case 'create_customer': {
            await CustomerRepository.add({
              name: params.name,
              phone: params.phone || '',
              email: params.email || '',
              tier: params.tier || 'Bronze',
              loyaltyPoints: params.loyaltyPoints || 0,
              joinDate: new Date().toISOString().split('T')[0],
              purchasesCount: 0,
              businessId: activeBizId,
            });
            break;
          }

          case 'create_product': {
            await ProductRepository.add({
              name: params.name,
              category: params.category || 'General Dairy',
              price: parseFloat(params.price) || 0,
              cost: parseFloat(params.cost) || 0,
              image: params.image || '',
              stock: parseFloat(params.stock) || 0,
              minStock: parseFloat(params.minStock) || 5,
              unit: params.unit || 'Unit',
              sku: params.sku || `SKU-${Date.now().toString().slice(-4)}`,
              description: params.description || '',
              businessId: activeBizId,
            });
            break;
          }

          case 'create_recipe_bom': {
            await SupabaseService.createBom({
              businessId: activeBizId,
              productId: params.productId,
              name: params.name,
              yieldQuantity: parseFloat(params.yieldQuantity) || 1,
              yieldUnit: params.yieldUnit || 'Unit',
              ingredients: params.ingredients || [],
            });
            break;
          }

          case 'create_purchase': {
            useExtraModulesStore.getState().addPurchase({
              id: `PO-${Date.now().toString().slice(-6)}`,
              businessId: activeBizId,
              supplierName: params.supplierName || 'Supplier',
              items: params.items || [],
              totalAmount: parseFloat(params.totalAmount) || 0,
              status: 'Approved',
              date: new Date().toISOString(),
            });
            break;
          }

          case 'adjust_stock': {
            const products = useInventoryStore.getState().products;
            const prod = products.find(
              (p) => p.id === params.productId || p.name.toLowerCase().includes((params.productName || '').toLowerCase())
            );
            if (prod) {
              const adjType = params.type === 'damage' ? 'Damage' : 'Restock';
              const qty = parseFloat(params.quantity) || 0;
              const changeVal = adjType === 'Damage' ? qty * -1 : qty;
              await useInventoryStore.getState().adjustStock(
                prod.id,
                changeVal,
                adjType,
                params.reason || 'AI Verified Adjustment'
              );
            }
            break;
          }

          case 'create_expense': {
            await ExpenseRepository.add({
              amount: parseFloat(params.amount) || 0,
              category: params.category || 'Supplies',
              description: params.description || 'AI Logged Expense',
              date: new Date().toISOString(),
              staffName,
              businessId: activeBizId,
            });
            break;
          }

          case 'create_feedback_reply': {
            const LOCAL_FEEDBACK_KEY = 'kkm_customer_feedback_v1';
            const saved = localStorage.getItem(LOCAL_FEEDBACK_KEY);
            const comments = saved ? JSON.parse(saved) : [];
            const updated = comments.map((c: any) => {
              if (c.id === params.commentId) {
                const replies = c.replies || [];
                return {
                  ...c,
                  resolved: true,
                  replies: [
                    ...replies,
                    {
                      id: `rep-${Date.now()}`,
                      author: staffName,
                      role: useAuthStore.getState().currentEmployee?.role || 'Staff',
                      message: params.message,
                      timestamp: new Date().toISOString(),
                    },
                  ],
                };
              }
              return c;
            });
            localStorage.setItem(LOCAL_FEEDBACK_KEY, JSON.stringify(updated));
            break;
          }

          default:
            break;
        }

        // Write Audit Log
        useExtraModulesStore.getState().addAuditLog({
          id: `AUD-${Date.now()}`,
          businessId: activeBizId,
          staffName,
          action: `AI_ACTION_${action.type.toUpperCase()}`,
          module: 'AI Copilot',
          details: `Confirmed and executed pending action "${action.title}": ${action.summary}`,
          date: new Date().toISOString(),
        });

        // Mark as executed
        set((state) => {
          const updated = state.pendingActions.map((a) =>
            a.id === id ? { ...a, status: 'executed' as const } : a
          );
          saveActions(updated);
          return { pendingActions: updated };
        });

        useNotificationStore.getState().showToast(
          'Action Executed',
          `Successfully executed "${action.title}".`,
          undefined,
          'success'
        );

        return { success: true };
      } catch (err: any) {
        return { success: false, error: err.message || 'Execution failed.' };
      }
    },

    rejectPendingAction: (id) => {
      set((state) => {
        const updated = state.pendingActions.map((a) =>
          a.id === id ? { ...a, status: 'rejected' as const } : a
        );
        saveActions(updated);
        return { pendingActions: updated };
      });
      useNotificationStore.getState().showToast(
        'Action Rejected',
        'Draft action was discarded.',
        undefined,
        'info'
      );
    },

    clearCompletedActions: () => {
      set((state) => {
        const updated = state.pendingActions.filter(
          (a) => a.status === 'pending_review' || a.status === 'verified'
        );
        saveActions(updated);
        return { pendingActions: updated };
      });
    },
  };
});
