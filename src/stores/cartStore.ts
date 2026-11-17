import { toUserMessage } from "../utils/userError";
import { newUuid } from "../utils/idUtils";
import { create } from "zustand";
import { CartItem, Customer, Product, Transaction, PaymentMethod, DeliveryMode } from "../types";
import { useAuthStore } from "./authStore";
import { useInventoryStore } from "./inventoryStore";
import { useTransactionStore } from "./transactionStore";
import { useCustomerStore } from "./customerStore";
import { useNotificationStore } from "./notificationStore";
import { onBranchChange, useBusinessStore } from "./businessStore";
import { checkPermissionGate } from "../utils/permissions";
import { SupabaseService } from "../services/supabaseService";
import { getSupabase } from "../services/supabaseClient";
import { CustomerRepository } from "../services/repositories";
import { NotificationService } from "../services/notifications/notificationService";
import { kraService } from "../services/kra/kraService";

/** How a payment method reads in a message: "M-Pesa", "bank transfer", "Cash". */
function paymentMethodName(method: string): string {
  const names: Record<string, string> = { Credit_Debt: "credit", Bank: "bank transfer" };
  return names[method] || method.replace(/_/g, " ");
}
import { salesOutbox, isNetworkError } from "../services/offline/salesOutbox";

interface CartState {
  cart: CartItem[];
  selectedCustomer: Customer | null;
  addToCart: (product: Product) => void;
  removeFromCart: (productId: string) => void;
  updateCartQty: (productId: string, quantity: number) => void;
  updateCartDiscount: (productId: string, discount: number) => void;
  clearCart: () => void;
  selectCustomer: (customer: Customer | null) => void;
  /** The quote this cart was loaded from (Sales Log → Quotes → Sell in POS). Cleared with the cart. */
  quote: { id: string; number: string } | null;
  /** Puts a quote's items in the cart at the quoted prices, for that customer. */
  loadQuote: (quote: { id: string; number: string }, items: CartItem[], customer: Customer | null) => void;
  checkout: (
    paymentMethod: PaymentMethod,
    note?: string,
    taxRate?: number,
    cartDiscountType?: 'percent' | 'amount',
    cartDiscountValue?: number,
    isDelivery?: boolean,
    deliveryFee?: number,
    riderName?: string,
    /** How the delivery is paid (on our bill, to the rider, or free). The fee is what the rider earns. */
    deliveryMode?: DeliveryMode,
    /** A promotion or referral code held with promo_reserve; its discount is already in cartDiscountValue. */
    promotion?: { redemptionId: string; code?: string; discount: number } | null
  ) => Promise<{ success: boolean; transaction?: Transaction; error?: string; /** saved on this device, syncs later */ offline?: boolean }>;
}

export const useCartStore = create<CartState>((set, get) => ({
  cart: [],
  selectedCustomer: null,
  quote: null,
  loadQuote: (quote, items, customer) => set({ quote, cart: items, selectedCustomer: customer }),

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

    const safeQty = Math.max(0, Math.min(quantity, item.product.stock));
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
    set({ cart: [], selectedCustomer: null, quote: null });
  },

  selectCustomer: (customer) => {
    set({ selectedCustomer: customer });
  },

  checkout: async (paymentMethod, note, taxRate = 0, cartDiscountType = 'percent', cartDiscountValue = 0, isDelivery = false, deliveryFeeIn = 0, riderName = "", deliveryMode = "charged", promotion = null) => {
    if (!checkPermissionGate("pos.create_sale")) {
      return { success: false, error: "Permission Denied: pos.create_sale" };
    }
    
    const { cart, selectedCustomer } = get();
    if (cart.length === 0) return { success: false, error: "Cart is empty." };

    // Offline: paid sales are saved on this device and sync later. Credit sales need the
    // server, which holds customer balances, wallets and debt limits.
    const transactionStore = useTransactionStore.getState();
    const isCredit = paymentMethod === 'Credit_Debt' || paymentMethod === 'Credit';
    const isOffline = !transactionStore.isOnline;
    if (isOffline && isCredit) {
      return {
        success: false,
        error: "Credit sales need an internet connection. Take cash, card or M-Pesa, or try again when you're back online.",
      };
    }

    // The database checks a code when the sale is saved, so a sale with one can't wait offline.
    if (isOffline && promotion) {
      return {
        success: false,
        error: "Promotion and referral codes need an internet connection. Remove the code, or try again when you're back online.",
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

    // The fee typed at the till is what the rider earns. Only 'charged' puts it on our bill;
    // with 'rider_collects' the customer hands it to the rider, with 'free' nobody charges it.
    const deliveryFee = isDelivery && deliveryMode === "charged" ? deliveryFeeIn : 0;
    const riderPay = isDelivery ? Math.max(0, deliveryFeeIn) : 0;

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

      const activeBusinessId = useBusinessStore.getState().activeBusinessId;
      const referenceId = `tx-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;

      const newTransaction: Transaction = {
        id: newUuid(),
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
        deliveryMode: isDelivery ? deliveryMode : undefined,
        riderPay,
        riderName: isDelivery ? riderName : undefined,
        businessId: activeBusinessId,
        referenceId,
        promotionCode: promotion?.code,
        promotionDiscount: promotion ? promotion.discount : 0,
      };

      // Keeps the sale on this device until it reaches the server
      const saveOffline = () => {
        salesOutbox.add(newTransaction);
        set({ cart: [], selectedCustomer: null, quote: null });
        useNotificationStore.getState().showToast(
          "Sale saved offline",
          `KSh ${finalTotal.toLocaleString()} by ${paymentMethod.replace("_", " ")}. It syncs when you're back online.`,
          undefined,
          "offline",
        );
        return { success: true, offline: true, transaction: { ...newTransaction, status: "Offline_Pending" as const } };
      };

      // Making a sale proves the person is working, so a forgotten clock-in fixes itself.
      // Clocking in needs the server, so offline it waits for the next online sale.
      // Not waited for: the sale doesn't depend on it. The shift counter follows the clock-in.
      if (!isOffline && !useAuthStore.getState().activeShift) {
        void useAuthStore.getState().punchIn()
          .then(() => useAuthStore.getState().addShiftSale(finalTotal))
          .catch(() => {});
      } else {
        useAuthStore.getState().addShiftSale(finalTotal);
      }

      if (isOffline) return saveOffline();

      let savedTx: any;

      // For credit sales with a registered customer, use the atomic RPC
      // which handles wallet deduction, debt creation, transaction + items,
      // credit_payments, customer_ledger, and wallet_transactions in ONE
      // database transaction. This prevents the chk_not_both_debt_and_wallet
      // error and duplicate ledger entries.
      if (selectedCustomer && (paymentMethod === 'Credit_Debt' || paymentMethod === 'Credit')) {
        const txId = await SupabaseService.processCustomerTransaction({
          businessId: activeBusinessId,
          customerId: selectedCustomer.id,
          customerName: selectedCustomer.name,
          staffId: currentEmployee?.id,
          staffName: currentEmployee?.name,
          total,
          discount: totalDiscount,
          tax,
          finalTotal,
          amountPaid: 0,
          paymentMethod,
          timestamp: new Date().toISOString(),
          note,
          isDelivery,
          deliveryFee: isDelivery ? deliveryFee : 0,
          deliveryMode: isDelivery ? deliveryMode : undefined,
          riderPay,
          riderName: isDelivery ? riderName : undefined,
          referenceId,
          promotionRedemptionId: promotion?.redemptionId ?? null,
          items: cart.map(item => ({
            product_id: item.product.id,
            product_name: item.product.name,
            unit_price: item.product.price,
            quantity: item.quantity,
            discount_percentage: item.discountPercentage,
          })),
        });

        // The server takes wallet money first; the receipt needs to know how much.
        let walletApplied = 0;
        const { data: saved } = await getSupabase().from("transactions").select("wallet_applied").eq("id", txId).maybeSingle();
        if (saved) walletApplied = Number(saved.wallet_applied) || 0;
        else walletApplied = Math.min(Number(selectedCustomer.walletBalance) || 0, finalTotal);
        savedTx = { ...newTransaction, id: txId, walletApplied };
      } else if (promotion) {
        // A code on a paid sale: header, items and the code are saved together. Not kept
        // offline on a dropped line: the database must see the code before the sale counts.
        const txId = await SupabaseService.recordTillSale(newTransaction, promotion.redemptionId);
        savedTx = { ...newTransaction, id: txId };
        if (selectedCustomer) {
          void useCustomerStore.getState().refreshCustomer(selectedCustomer.id).catch(() => {});
        }
      } else {
        // Non-credit or walk-in customer: use the standard transaction flow.
        // If the connection drops mid-sale, keep it offline instead of losing it.
        try {
          savedTx = await useTransactionStore.getState().addTransaction(newTransaction);
        } catch (saveErr) {
          if (!isCredit && isNetworkError(saveErr)) return saveOffline();
          throw saveErr;
        }

        // The database trigger awards points and counts the purchase; this picks up the new
        // balance in the background (the till doesn't wait for it).
        if (selectedCustomer) {
          void useCustomerStore.getState().refreshCustomer(selectedCustomer.id).catch(() => {});
        }
      }

      // A credit sale adds to what the customer owes; only other sales are money received.
      // Wallet money paid for part (or all) of a credit sale; only the rest is a debt.
      // Notifying the owner happens after the till is free again (not waited for).
      const fromWallet = isCredit ? Number(savedTx?.walletApplied) || 0 : 0;
      const onCredit = Math.max(0, Math.round((finalTotal - fromWallet) * 100) / 100);
      void (async () => {
      if (isCredit && selectedCustomer) {
        await useCustomerStore.getState().refreshCustomer(selectedCustomer.id).catch(() => {});
      }
      if (isCredit && selectedCustomer && onCredit > 0) {
        const owes = useCustomerStore.getState().customers.find((c) => c.id === selectedCustomer.id)?.debtBalance;
        NotificationService.createNotification(
          "Credit Sale",
          {
            customerName: selectedCustomer.name,
            amount: onCredit.toLocaleString(),
            debtBalance: (owes ?? (selectedCustomer.debtBalance || 0) + onCredit).toLocaleString(),
          },
          { role: "Owner", priority: "medium", payloadExtra: { customerId: selectedCustomer.id } }
        );
      } else if (isCredit && selectedCustomer) {
        NotificationService.createNotification(
          "Payment Received",
          { amount: fromWallet.toLocaleString(), paymentMethod: "wallet", fromCustomer: ` from ${selectedCustomer.name}` },
          { role: "Owner", priority: "medium" }
        );
      } else {
        NotificationService.createNotification(
          "Payment Received",
          {
            amount: finalTotal.toLocaleString(),
            paymentMethod: paymentMethodName(paymentMethod),
            fromCustomer: selectedCustomer ? ` from ${selectedCustomer.name}` : "",
          },
          { role: "Owner", priority: "medium" }
        );
      }
      })().catch((e) => console.error("Could not send the sale notification:", e?.code ?? e));

      if (isDelivery && riderName) {
        NotificationService.createDeliveryNotification(riderName, selectedCustomer?.name || "a walk-in customer", "assigned", {
          finalTotal,
        });

        useNotificationStore.getState().showToast(
          "Rider assigned",
          `${riderName} will deliver ${selectedCustomer ? `to ${selectedCustomer.name}` : "this order"} (KSh ${finalTotal.toLocaleString()}).`,
          undefined,
          "info"
        );
      }

      set({ cart: [], selectedCustomer: null, quote: null });
      if (activeBusinessId) void kraService.reportSaleIfConnected(activeBusinessId, savedTx.id);
      return { success: true, transaction: savedTx };
    } catch (err: any) {
      return { success: false, error: toUserMessage(err, "Checkout failed due to database or connection error.") };
    }
  },
}));

// The cart and chosen customer belong to the branch they were picked in.
setTimeout(() => onBranchChange(() => useCartStore.getState().clearCart()), 0);
