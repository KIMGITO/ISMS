// src/stores/pendingActionStore.ts
// Tasks the assistant prepares. Each one shows as a card inside the AI chat, where the
// person checks the details, changes them if needed and taps Confirm. Nothing runs before.

import { toUserMessage } from '../utils/userError';
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
import { hasRolePermission, PermissionCode } from '../utils/permissions';
import { useCartStore } from './cartStore';
import { useUiStore } from './uiStore';
import { isMoneyMethod } from '../utils/paymentMethods';

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

  addPendingAction: (input: PendingActionInput) => PendingAction;
  /** Changes a draft's details from its chat card; the checks run again straight away. */
  updatePendingParams: (id: string, updatedParams: Record<string, any>) => void;
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

/**
 * What the assistant may do, and the permission each needs. The app decides the
 * permission, never the AI: a draft's own requiredPermission is ignored, so the
 * assistant can only carry out what the person could do by hand. A type not
 * listed here is not carried out.
 */
export const ASSISTANT_ACTIONS: Partial<Record<PendingActionType, { permission: PermissionCode | null; label: string }>> = {
  create_checkout: { permission: 'pos.create_sale', label: 'start a sale' },
  create_customer: { permission: 'customers.create', label: 'add customers' },
  update_customer: { permission: 'customers.update', label: 'edit customers' },
  settle_debt: { permission: 'customers.debts', label: 'record debt payments' },
  adjust_wallet: { permission: 'customers.debts', label: 'top up customer wallets' },
  create_product: { permission: 'products.create', label: 'add products' },
  update_product: { permission: 'products.update', label: 'change product prices and details' },
  adjust_stock: { permission: 'inventory.adjust_stock', label: 'adjust stock' },
  create_expense: { permission: 'expenses.create', label: 'record expenses' },
  create_recipe_bom: { permission: 'bom.create', label: 'create recipes' },
  create_shift: { permission: 'staff.schedule', label: 'schedule shifts' },
  create_feedback_reply: { permission: 'complaints.reply', label: 'reply to feedback' },
  // Everyone may clock themselves in and out.
  clock_in: { permission: null, label: 'clock in' },
  clock_out: { permission: null, label: 'clock out' },
};

/** Draft types the AI writes in other words, mapped to the ones above. */
export function normalizeActionType(raw: string): PendingActionType {
  const t = (raw || '').toLowerCase().trim().replace(/[\s-]+/g, '_');
  const aliases: Record<string, PendingActionType> = {
    createcheckout: 'create_checkout', create_sale: 'create_checkout', checkout: 'create_checkout', sale: 'create_checkout',
    create_schedule: 'create_shift', schedule_shift: 'create_shift', schedule: 'create_shift',
    record_debt_payment: 'settle_debt', pay_debt: 'settle_debt', debt_payment: 'settle_debt',
    wallet_deposit: 'adjust_wallet', top_up_wallet: 'adjust_wallet', deposit_wallet: 'adjust_wallet',
    add_customer: 'create_customer', add_product: 'create_product', add_expense: 'create_expense',
    record_expense: 'create_expense', stock_adjustment: 'adjust_stock', clockin: 'clock_in', clockout: 'clock_out',
  };
  return (aliases[t] || t) as PendingActionType;
}

const norm = (v: unknown) => String(v ?? '').trim().toLowerCase();

/** Finds by id, then exact name, then a unique partial name (never guesses between two). */
function findByName<T extends { id: string; name: string }>(list: T[], id?: unknown, name?: unknown): T | undefined {
  if (id) {
    const byId = list.find((x) => x.id === id);
    if (byId) return byId;
  }
  const n = norm(name);
  if (!n) return undefined;
  const exact = list.find((x) => norm(x.name) === n);
  if (exact) return exact;
  const partial = list.filter((x) => norm(x.name).includes(n) || n.includes(norm(x.name)));
  return partial.length === 1 ? partial[0] : undefined;
}

const findProduct = (id?: unknown, name?: unknown) => findByName(useInventoryStore.getState().products, id, name);
const findCustomer = (id?: unknown, name?: unknown) => findByName(useCustomerStore.getState().customers, id, name);
const findEmployee = (id?: unknown, name?: unknown) => findByName(useAuthStore.getState().employees, id, name);

const amountOf = (v: unknown) => {
  const n = parseFloat(String(v ?? '').replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) ? n : 0;
};

export const evaluateValidation = (
  type: PendingActionType,
  _requiredPermission: string,
  params: Record<string, any>
): PendingActionValidation => {
  const currentRole = useAuthStore.getState().currentEmployee?.role || 'Staff';
  const spec = ASSISTANT_ACTIONS[type];

  const warnings: string[] = [];
  const errors: string[] = [];
  let hasStock = true;

  const hasPermission = !!spec && (spec.permission === null || hasRolePermission(currentRole, spec.permission));
  if (!spec) {
    errors.push("The assistant can't do this yet. Please do it from its own screen.");
  } else if (!hasPermission) {
    errors.push(`Your role (${currentRole}) isn't allowed to ${spec.label}. Ask the owner if you need this.`);
  }

  if (type === 'create_checkout') {
    const items = Array.isArray(params.items) ? params.items : [];
    if (items.length === 0) errors.push('No items in this sale.');
    for (const item of items) {
      const prod = findProduct(item.productId, item.productName);
      const qty = parseFloat(item.quantity) || 1;
      if (!prod) {
        errors.push(`"${item.productName || item.productId}" isn't in your products.`);
      } else if (prod.stock < qty) {
        hasStock = false;
        warnings.push(`Only ${prod.stock} ${prod.name} in stock (sale asks for ${qty}).`);
      }
    }
  }

  if (type === 'adjust_stock' || type === 'update_product') {
    const prod = findProduct(params.productId, params.productName || params.name);
    if (!prod) errors.push(`"${params.productName || params.name || params.productId || 'That product'}" isn't in your products.`);
    if (type === 'adjust_stock') {
      const qty = parseFloat(params.quantity) || 0;
      if (qty <= 0) errors.push('Enter how many to add or remove.');
      if (prod && params.type === 'damage' && prod.stock < qty) {
        warnings.push(`Removing ${qty} but only ${prod.stock} ${prod.name} in stock.`);
      }
    }
  }

  if (type === 'settle_debt' || type === 'adjust_wallet' || type === 'update_customer') {
    const cust = findCustomer(params.customerId, params.customerName || params.name);
    if (!cust) {
      errors.push(`Couldn't find the customer "${params.customerName || params.name || params.customerId || ''}". Use their full name.`);
    } else if (type === 'settle_debt') {
      const amt = amountOf(params.amount);
      if (amt <= 0) errors.push('Enter the amount paid.');
      else if (amt > Number(cust.debtBalance || 0)) errors.push(`${cust.name} owes KSh ${Number(cust.debtBalance || 0).toLocaleString()}, less than KSh ${amt.toLocaleString()}.`);
    } else if (type === 'adjust_wallet' && amountOf(params.amount) <= 0) {
      errors.push('Enter the amount to add to the wallet.');
    }
  }

  if (type === 'create_customer' && !norm(params.name)) errors.push('The customer needs a name.');
  if (type === 'create_product' && !norm(params.name)) errors.push('The product needs a name.');
  if (type === 'create_expense' && amountOf(params.amount) <= 0) errors.push('Enter the expense amount.');
  if (type === 'create_shift' && !findEmployee(params.workerId || params.employeeId, params.workerName || params.employeeName)) {
    errors.push(`Couldn't find the worker "${params.workerName || params.employeeName || ''}".`);
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

    addPendingAction: (input) => {
      const activeBizId = useBusinessStore.getState().activeBusinessId || 'biz-1';
      const staffName = useAuthStore.getState().currentEmployee?.name || 'Kim AI Copilot';
      const type = normalizeActionType(input.type);
      const requiredPermission = ASSISTANT_ACTIONS[type]?.permission || 'none';
      const validation = evaluateValidation(type, requiredPermission, input.params);

      const newAction: PendingAction = {
        id: `act-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
        businessId: activeBizId,
        type,
        title: input.title,
        summary: input.summary,
        requiredPermission,
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

      return newAction;
    },

    updatePendingParams: (id, updatedParams) => {
      set((state) => {
        const updated = state.pendingActions.map((act) =>
          act.id === id && (act.status === 'pending_review' || act.status === 'verified')
            ? { ...act, params: updatedParams, validation: evaluateValidation(act.type, act.requiredPermission, updatedParams) }
            : act
        );
        saveActions(updated);
        return { pendingActions: updated };
      });
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
        let doneMessage = `Done: ${action.title}.`;
        switch (action.type) {
          case 'create_checkout': {
            // The sale is finished on the till, where the person takes the payment
            // and the receipt prints. Approving loads the cart; nothing is charged yet.
            const cart = useCartStore.getState();
            cart.clearCart();
            for (const item of params.items || []) {
              const prod = findProduct(item.productId, item.productName);
              if (!prod) continue;
              cart.addToCart(prod);
              const qty = parseFloat(item.quantity) || 1;
              if (qty !== 1) cart.updateCartQty(prod.id, qty);
            }
            useUiStore.getState().setActiveTab('pos');
            doneMessage = 'The items are in the cart. Take the payment to finish the sale.';
            break;
          }

          case 'create_customer': {
            await useCustomerStore.getState().addCustomer({
              name: params.name,
              phone: params.phone || '',
              email: params.email || '',
              tier: params.tier || 'Bronze',
              loyaltyPoints: 0,
              businessId: activeBizId,
            } as any);
            doneMessage = `${params.name} was added to your customers.`;
            break;
          }

          case 'update_customer': {
            const cust = findCustomer(params.customerId, params.customerName || params.name)!;
            // Only contact details. Balances change through payments, never by editing.
            const updates: Record<string, any> = {};
            if (params.newName) updates.name = params.newName;
            if (params.phone) updates.phone = params.phone;
            if (params.email) updates.email = params.email;
            if (Object.keys(updates).length === 0) throw new Error('Nothing to change. Say the new name, phone or email.');
            await useCustomerStore.getState().updateCustomer({ ...cust, ...updates });
            doneMessage = `${cust.name}'s details were updated.`;
            break;
          }

          case 'settle_debt': {
            const cust = findCustomer(params.customerId, params.customerName || params.name)!;
            const amount = amountOf(params.amount);
            const rawMethod = params.method || params.paymentMethod;
            const method = isMoneyMethod(rawMethod) ? rawMethod : norm(rawMethod).includes('airtel') ? 'Airtel Money' : norm(rawMethod).includes('pesa') ? 'M-Pesa' : 'Cash';
            await useCustomerStore.getState().payCustomerDebt(cust.id, amount, method, staffName, params.note || 'Recorded through the assistant');
            await useCustomerStore.getState().refreshCustomer(cust.id).catch(() => {});
            doneMessage = `KSh ${amount.toLocaleString()} ${method} payment recorded for ${cust.name}.`;
            break;
          }

          case 'adjust_wallet': {
            const cust = findCustomer(params.customerId, params.customerName || params.name)!;
            const amount = amountOf(params.amount);
            await useCustomerStore.getState().depositCustomerWallet(cust.id, amount, staffName, params.note || 'Top-up through the assistant');
            await useCustomerStore.getState().refreshCustomer(cust.id).catch(() => {});
            doneMessage = `KSh ${amount.toLocaleString()} added to ${cust.name}'s wallet.`;
            break;
          }

          case 'create_product': {
            await ProductRepository.add({
              name: params.name,
              category: params.category || 'General',
              price: amountOf(params.price),
              cost: amountOf(params.cost),
              image: params.image || '',
              stock: parseFloat(params.stock) || 0,
              minStock: parseFloat(params.minStock) || 5,
              unit: params.unit || 'Unit',
              sku: params.sku || `SKU-${Date.now().toString().slice(-4)}`,
              description: params.description || '',
              businessId: activeBizId,
            });
            doneMessage = `${params.name} was added to your products.`;
            break;
          }

          case 'update_product': {
            const prod = findProduct(params.productId, params.productName || params.name)!;
            // Stock changes go through adjust_stock so they keep a history.
            const updates: Record<string, any> = {};
            if (params.price !== undefined) updates.price = amountOf(params.price);
            if (params.cost !== undefined) updates.cost = amountOf(params.cost);
            if (params.minStock !== undefined) updates.minStock = parseFloat(params.minStock) || 0;
            if (params.category) updates.category = params.category;
            if (params.unit) updates.unit = params.unit;
            if (params.newName) updates.name = params.newName;
            if (Object.keys(updates).length === 0) throw new Error('Nothing to change. Say the new price, cost or other detail.');
            await ProductRepository.update(prod.id, updates);
            doneMessage = `${prod.name} was updated.`;
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

          case 'adjust_stock': {
            const prod = findProduct(params.productId, params.productName)!;
            const adjType = params.type === 'damage' ? 'Damage' : 'Restock';
            const qty = parseFloat(params.quantity) || 0;
            await useInventoryStore.getState().adjustStock(
              prod.id,
              adjType === 'Damage' ? -qty : qty,
              adjType,
              params.reason || 'Through the assistant'
            );
            doneMessage = `${prod.name}: ${adjType === 'Damage' ? 'removed' : 'added'} ${qty}.`;
            break;
          }

          case 'create_expense': {
            await ExpenseRepository.add({
              amount: amountOf(params.amount),
              category: params.category || 'Supplies',
              description: params.description || 'Recorded through the assistant',
              date: new Date().toISOString(),
              staffName,
              businessId: activeBizId,
            });
            doneMessage = `Expense of KSh ${amountOf(params.amount).toLocaleString()} recorded.`;
            break;
          }

          case 'create_shift': {
            const worker = findEmployee(params.workerId || params.employeeId, params.workerName || params.employeeName)!;
            await SupabaseService.createSchedule({
              businessId: activeBizId,
              employeeId: worker.id,
              createdBy: useAuthStore.getState().currentUser?.id,
              title: params.title || 'Shift',
              notes: params.notes || '',
              date: params.date || new Date().toISOString().split('T')[0],
              startTime: params.startTime || '09:00',
              endTime: params.endTime || '17:00',
              repeat: params.repeat || 'None',
            });
            doneMessage = `${worker.name} is scheduled for ${params.date || 'today'} at ${params.startTime || '09:00'}.`;
            break;
          }

          case 'clock_in': {
            if (!(await useAuthStore.getState().punchIn())) throw new Error('Could not clock you in.');
            doneMessage = 'You are clocked in.';
            break;
          }

          case 'clock_out': {
            if (!(await useAuthStore.getState().punchOut())) throw new Error('Could not clock you out.');
            doneMessage = 'You are clocked out on all your devices.';
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
            // evaluateValidation already refuses types not in ASSISTANT_ACTIONS.
            return { success: false, error: "The assistant can't do this yet. Please do it from its own screen." };
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
            a.id === id ? { ...a, status: 'executed' as const, resultMessage: doneMessage } : a
          );
          saveActions(updated);
          return { pendingActions: updated };
        });

        useNotificationStore.getState().showToast('Done', doneMessage, undefined, 'success');

        return { success: true };
      } catch (err: any) {
        return { success: false, error: toUserMessage(err, "That didn't go through. Please try again.") };
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
