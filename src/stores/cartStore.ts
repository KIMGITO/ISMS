import { create } from "zustand";
import { CartItem, Customer, Product, Transaction, PaymentMethod } from "../types";
import { useAuthStore } from "./authStore";
import { useInventoryStore } from "./inventoryStore";
import { useTransactionStore } from "./transactionStore";
import { useCustomerStore } from "./customerStore";
import { useNotificationStore } from "./notificationStore";
import { useBusinessStore } from "./businessStore";
import { checkPermissionGate } from "../utils/permissions";
import { SupabaseService } from "../services/supabaseService";

interface CartState {
  cart: CartItem[];
  selectedCustomer: Customer | null;
  addToCart: (product: Product) => void;
  removeFromCart: (productId: string) => void;
  updateCartQty: (productId: string, quantity: number) => void;
  updateCartDiscount: (productId: string, discount: number) => void;
  clearCart: () => void;
  selectCustomer: (customer: Customer | null) => void;
  checkout: (
    paymentMethod: PaymentMethod,
    note?: string,
    taxRate?: number,
    cartDiscountType?: 'percent' | 'amount',
    cartDiscountValue?: number,
    isDelivery?: boolean,
    deliveryFee?: number,
    riderName?: string
  ) => Promise<{ success: boolean; transaction?: Transaction; error?: string }>;
}

export const useCartStore = create<CartState>((set, get) => ({
  cart: [],
  selectedCustomer: null,

  addToCart: (product) => {
    const currentCart = get().cart;
    const existing = currentCart.find((item) => item.product.id === product.id);

    if (existing) {
      if (existing.quantity >= product.stock) return; 
      set({
        cart: currentCart.map((item) =>
          item.product.id === product.id
            ? { ...item, quantity: item.quantity + 1 }
            : item
        ),
      });
    } else {
      if (product.stock <= 0) return;
      set({
        cart: [...currentCart, { product, quantity: 1, discountPercentage: 0 }],
      });
    }
  },

  removeFromCart: (productId) => {
    set({ cart: get().cart.filter((item) => item.product.id !== productId) });
  },

  updateCartQty: (productId, quantity) => {
    const currentCart = get().cart;
    const item = currentCart.find((i) => i.product.id === productId);
    if (!item) return;

    const safeQty = Math.max(1, Math.min(quantity, item.product.stock));
    set({
      cart: currentCart.map((i) =>
        i.product.id === productId ? { ...i, quantity: safeQty } : i
      ),
    });
  },

  updateCartDiscount: (productId, discount) => {
    const safeDiscount = Math.max(0, Math.min(discount, 100));
    set({
      cart: get().cart.map((i) =>
        i.product.id === productId ? { ...i, discountPercentage: safeDiscount } : i
      ),
    });
  },

  clearCart: () => {
    set({ cart: [], selectedCustomer: null });
  },

  selectCustomer: (customer) => {
    set({ selectedCustomer: customer });
  },

  checkout: async (paymentMethod, note, taxRate = 0.16, cartDiscountType = 'percent', cartDiscountValue = 0, isDelivery = false, deliveryFee = 0, riderName = "") => {
    if (!checkPermissionGate("pos.create_sale")) {
      return { success: false, error: "Permission Denied: pos.create_sale" };
    }
    
    const { cart, selectedCustomer } = get();
    if (cart.length === 0) return { success: false, error: "Cart is empty." };

    // Strict connectivity check
    const transactionStore = useTransactionStore.getState();
    if (!transactionStore.isOnline) {
      return {
        success: false,
        error: "Checkout Blocked: This application requires an active internet connection to process live sales securely."
      };
    }

    if (paymentMethod === 'Credit_Debt' && !selectedCustomer) {
      return {
        success: false,
        error: "Debt payment is only available for registered loyalty customers, not walk-in customers."
      };
    }

    // Resolving dynamic, live staff session identifiers rather than using historical local storage values
    const authStore = useAuthStore.getState();
    const currentEmployee = authStore.currentEmployee || authStore.employees[0];
    if (!currentEmployee) return { success: false, error: "No employee logged in." };

    // Double check stock levels in the inventory store
    const inventoryStore = useInventoryStore.getState();
    const products = inventoryStore.products;
    for (const item of cart) {
      const liveProduct = products.find((p) => p.id === item.product.id);
      if (!liveProduct || liveProduct.stock < item.quantity) {
        return {
          success: false,
          error: `Insufficient stock for ${item.product.name}.`,
        };
      }
    }

    try {
      // Deduct stock in real time in inventoryStore
      await useInventoryStore.getState().deductStock(cart);

      // Calculate totals
      let total = 0;
      let itemDiscountSum = 0;
      cart.forEach((item) => {
        const lineTotal = item.product.price * item.quantity;
        const lineDisc = lineTotal * (item.discountPercentage / 100);
        total += lineTotal;
        itemDiscountSum += lineDisc;
      });

      const subtotalBeforeCartDiscount = total - itemDiscountSum;
      let cartDiscount = 0;
      if (cartDiscountValue > 0) {
        if (cartDiscountType === 'percent') {
          cartDiscount = subtotalBeforeCartDiscount * (cartDiscountValue / 100);
        } else {
          cartDiscount = cartDiscountValue;
        }
      }
      cartDiscount = Math.min(cartDiscount, subtotalBeforeCartDiscount);

      const subtotal = subtotalBeforeCartDiscount - cartDiscount;
      const tax = subtotal * taxRate;
      const finalTotal = subtotal + tax + (isDelivery ? deliveryFee : 0);
      const totalDiscount = itemDiscountSum + cartDiscount;

      const newTransaction: Transaction = {
        id: `tx-${Date.now()}`,
        items: [...cart],
        total,
        discount: totalDiscount,
        tax,
        finalTotal,
        paymentMethod,
        customerId: selectedCustomer?.id,
        customerName: selectedCustomer?.name,
        staffId: currentEmployee.id,
        staffName: currentEmployee.name,
        status: "Synced",
        timestamp: new Date().toISOString(),
        note,
        isDelivery,
        deliveryFee: isDelivery ? deliveryFee : 0,
        riderName: isDelivery ? riderName : undefined,
        businessId: useBusinessStore.getState().activeBusinessId,
      };

      // Update active shift counters
      useAuthStore.getState().addShiftSale(finalTotal);

      // Database trigger safely takes over ledger metrics processing seamlessly inside database transaction wrappers
      if (selectedCustomer) {
        await useCustomerStore.getState().addLoyaltyPoints(selectedCustomer.id, finalTotal);

        const activeBusinessId = useBusinessStore.getState().activeBusinessId;
        const currentWallet = Number(selectedCustomer.walletBalance || 0);
        const currentDebt = Number(selectedCustomer.debtBalance || 0);

        if (paymentMethod === 'Credit_Debt') {
          let resolvedWallet = currentWallet;
          let resolvedDebt = currentDebt;
          let walletUsed = 0;
          let debtCreated = 0;

          if (currentWallet > 0) {
            if (finalTotal <= currentWallet) {
              resolvedWallet = currentWallet - finalTotal;
              walletUsed = finalTotal;
            } else {
              resolvedWallet = 0;
              resolvedDebt = currentDebt + (finalTotal - currentWallet);
              walletUsed = currentWallet;
              debtCreated = finalTotal - currentWallet;
            }
          } else {
            resolvedDebt = currentDebt + finalTotal;
            debtCreated = finalTotal;
          }

          await useCustomerStore.getState().updateCustomer({
            ...selectedCustomer,
            walletBalance: resolvedWallet,
            debtBalance: resolvedDebt
          });

          if (walletUsed > 0) {
            await SupabaseService.createLedgerEntry({
              businessId: activeBusinessId,
              customerId: selectedCustomer.id,
              type: 'wallet_usage',
              amount: walletUsed,
              walletBalance: resolvedWallet,
              debtBalance: currentDebt, 
              recordedBy: currentEmployee.name,
              note: `Paid for order ${newTransaction.id} using wallet credit`,
              transactionId: newTransaction.id
            });
          }

          if (debtCreated > 0) {
            await SupabaseService.createLedgerEntry({
              businessId: activeBusinessId,
              customerId: selectedCustomer.id,
              type: 'debt_creation',
              amount: debtCreated,
              walletBalance: resolvedWallet,
              debtBalance: resolvedDebt,
              recordedBy: currentEmployee.name,
              note: `Outstanding balance for order ${newTransaction.id} charged to debt`,
              transactionId: newTransaction.id
            });
          }
        }
      }

      await useTransactionStore.getState().addTransaction(newTransaction);

      if (isDelivery && riderName) {
        useNotificationStore.getState().showToast(
          "Rider Dispatch",
          `Dispatch Alert: Rider "${riderName}" assigned to deliver Order ${newTransaction.id} (KSh ${finalTotal.toLocaleString()}). Delivery route logged.`,
          "data:image/svg+xml;utf8,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100' fill='%23f59e0b'%3E%3Ccircle cx='50' cy='35' r='20'/%3E%3Cpath d='M20,80 C20,60 80,60 80,80'/%3E%3C/svg%3E",
          "info"
        );
      }

      set({ cart: [], selectedCustomer: null });
      return { success: true, transaction: newTransaction };
    } catch (err: any) {
      return { success: false, error: err.message || "Checkout failed due to database or connection error." };
    }
  },
}));