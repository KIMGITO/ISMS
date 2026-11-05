// src/stores/customerStore.ts
import { create } from "zustand";
import { Customer } from "../types";
import { useBusinessStore } from "./businessStore";
import { CustomerRepository } from "../services/repositories";
import { normalizePhone } from "../utils/phoneUtils";
import { checkPermissionGate } from "../utils/permissions";
import { SupabaseService } from "../services/supabaseService";
import { getSupabase } from "../services/supabaseClient";
import { NotificationService } from "../services/notifications/notificationService";

interface CustomerState {
  customers: Customer[];
  addCustomer: (
    customer: Omit<Customer, "id" | "purchasesCount" | "joinDate">
  ) => Promise<Customer>;
  refreshCustomer: (customerId: string) => Promise<void>;
  redeemPoints: (
    customerId: string,
    points: number,
    recordedBy: string
  ) => Promise<{ value: number; toDebt: number; toWallet: number; points: number }>;
  updateCustomer: (customer: Customer) => Promise<void>;
  deleteCustomer: (id: string) => Promise<void>;
  setCustomers: (customers: Customer[]) => void;
  payCustomerDebt: (
    customerId: string,
    amount: number,
    method: 'Cash' | 'M-Pesa',
    cashierName: string,
    note?: string,
    id?: string
  ) => Promise<void>;
  depositCustomerWallet: (
    customerId: string,
    amount: number,
    cashierName: string,
    note?: string,
    id?: string
  ) => Promise<void>;
  spendCustomerWallet: (
    customerId: string,
    amount: number,
    cashierName: string,
    note?: string,
    id?: string
  ) => Promise<void>;
  adjustCustomerDebt: (
    customerId: string,
    amount: number,
    operation: 'add' | 'subtract',
    cashierName: string,
    note?: string,
    id?: string
  ) => Promise<void>;
}

export const useCustomerStore = create<CustomerState>((set, get) => {
  let unsub: (() => void) | null = null;

  const setupSubscription = (businessId: string) => {
    if (unsub) unsub();

    if (!businessId) {
      set({ customers: [] });
      return;
    }

    unsub = CustomerRepository.subscribe((custs) => {
      set({ customers: custs });
    });
  };

  // Listen to business transitions dynamically after all modules load to avoid circular init issues
  setTimeout(() => {
    useBusinessStore.subscribe((state) => {
      setupSubscription(state.activeBusinessId);
    });
    setupSubscription(useBusinessStore.getState().activeBusinessId);
  }, 0);

  return {
    customers: [],

    addCustomer: async (customerData) => {
      if (!checkPermissionGate("customers.create")) {
        throw new Error("Permission Denied: customers.create");
      }
      const activeBusinessId = useBusinessStore.getState().activeBusinessId;
      const normalizedPhone = normalizePhone(customerData.phone);
      const newCustomer = {
        ...customerData,
        phone: normalizedPhone,
        joinDate: new Date().toISOString().split("T")[0],
        loyaltyPoints: customerData.loyaltyPoints || 10,
        purchasesCount: 0,
        debtBalance: customerData.debtBalance || 0,
        walletBalance: customerData.walletBalance || 0,
        businessId: customerData.businessId || activeBusinessId,
      };

      const added = await CustomerRepository.add(newCustomer);
      return added;
    },

    refreshCustomer: async (customerId) => {
      const fresh = await CustomerRepository.getById(customerId);
      if (!fresh) return;
      set((state) => ({
        customers: state.customers.map((c) => (c.id === customerId ? fresh : c)),
      }));
    },

    redeemPoints: async (customerId, points, recordedBy) => {
      if (!checkPermissionGate("customers.loyalty")) throw new Error("Permission denied");
      const { data, error } = await getSupabase().rpc("redeem_customer_points", {
        p_customer_id: customerId,
        p_points: points,
        p_recorded_by: recordedBy,
      });
      if (error) throw error;
      await get().refreshCustomer(customerId);
      return data as { value: number; toDebt: number; toWallet: number; points: number };
    },

    updateCustomer: async (customer) => {
      if (!checkPermissionGate("customers.update")) return;
      const normalizedPhone = normalizePhone(customer.phone);
      await CustomerRepository.update(customer.id, {
        ...customer,
        phone: normalizedPhone,
      });
    },

    deleteCustomer: async (id) => {
      if (!checkPermissionGate("customers.delete")) return;
      await CustomerRepository.delete(id);
    },

    setCustomers: (customers) => {
      CustomerRepository.setAll(customers);
    },

    payCustomerDebt: async (customerId, amount, method, cashierName, note, id) => {
      const cust = await CustomerRepository.getById(customerId);
      if (!cust) throw new Error("Customer profile not found.");
      if (amount <= 0) throw new Error("Amount must be greater than zero.");

      const currentDebt = Number(cust.debtBalance || 0);
      if (amount > currentDebt) throw new Error("Cannot pay off more than outstanding debt.");

      const newDebt = currentDebt - amount;
      const activeBusinessId = useBusinessStore.getState().activeBusinessId;
      const referenceId = id || `debt-pay-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;

      // Use the atomic RPC for debt payment. This handles debt reduction,
      // credit_payments FIFO settlement, and ledger entry in ONE DB transaction.
      // Idempotent via reference_id — retrying the same operation does not
      // create a duplicate financial record.
      await SupabaseService.processDebtPayment({
        businessId: activeBusinessId,
        customerId,
        amount,
        method,
        recordedBy: cashierName,
        note: note || `Debt payment via ${method}`,
        referenceId,
      });

      // Trigger notification
      NotificationService.createNotification(
        "Payment Received",
        {
          amount: amount.toLocaleString(),
          paymentMethod: method,
          txId: id ? id.slice(-8) : "Debt-Payment"
        },
        {
          title: `💰 Debt Repaid: ${cust.name}`,
          role: "Owner",
          priority: "medium",
          payloadExtra: { customerName: cust.name, remainingDebt: newDebt }
        }
      );
    },

    depositCustomerWallet: async (customerId, amount, cashierName, note, id) => {
      const cust = await CustomerRepository.getById(customerId);
      if (!cust) throw new Error("Customer profile not found.");
      if (amount <= 0) throw new Error("Amount must be greater than zero.");

      const activeBusinessId = useBusinessStore.getState().activeBusinessId;
      const referenceId = id || `wallet-topup-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;

      // Use the atomic RPC for wallet top-up. This handles debt repayment
      // + wallet deposit + ledger entries in ONE DB transaction.
      // Idempotent via reference_id — retrying the same operation does not
      // create a duplicate financial record.
      await SupabaseService.processWalletTopup({
        businessId: activeBusinessId,
        customerId,
        amount,
        recordedBy: cashierName,
        note: note || "Wallet top-up",
        referenceId,
      });
    },

    spendCustomerWallet: async (customerId, amount, cashierName, note, id) => {
      const cust = await CustomerRepository.getById(customerId);
      if (!cust) throw new Error("Customer profile not found.");
      if (amount <= 0) throw new Error("Amount must be greater than zero.");
      const currentWallet = Number(cust.walletBalance || 0);
      if (amount > currentWallet) throw new Error("Insufficient wallet balance.");

      const activeBusinessId = useBusinessStore.getState().activeBusinessId;
      const referenceId = id || `wallet-spend-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;

      // Use the atomic RPC for wallet spending. Handles wallet deduction +
      // ledger entry in ONE DB transaction. Idempotent via reference_id.
      await SupabaseService.processWalletSpend({
        businessId: activeBusinessId,
        customerId,
        amount,
        recordedBy: cashierName,
        note: note || "Wallet credit spent",
        referenceId,
      });
    },

    adjustCustomerDebt: async (customerId, amount, operation, cashierName, note, id) => {
      const cust = await CustomerRepository.getById(customerId);
      if (!cust) throw new Error("Customer profile not found.");
      if (amount <= 0) throw new Error("Amount must be greater than zero.");

      const currentDebt = Number(cust.debtBalance || 0);
      const currentWallet = Number(cust.walletBalance || 0);
      const activeBusinessId = useBusinessStore.getState().activeBusinessId;

      let newDebt = currentDebt;
      let newWallet = currentWallet;
      let ledgerType: 'debt_creation' | 'debt_adjustment' | 'wallet_usage' = 'debt_adjustment';
      let resolvedAmount = amount;

      if (operation === 'add') {
        if (currentWallet > 0) {
          if (amount <= currentWallet) {
            newWallet = currentWallet - amount;
            ledgerType = 'wallet_usage';
            resolvedAmount = amount;
          } else {
            newWallet = 0;
            newDebt = amount - currentWallet;
            ledgerType = 'debt_creation';
            resolvedAmount = amount - currentWallet;
            
            await SupabaseService.createLedgerEntry({
              businessId: activeBusinessId,
              customerId,
              type: 'wallet_usage',
              amount: currentWallet,
              walletBalance: 0,
              debtBalance: 0,
              recordedBy: cashierName,
              note: note || `Wallet usage prior to manual debt creation`,
              referenceId: `${id || 'debt-adj'}-pre-wallet-usage`,
            });
          }
        } else {
          newDebt = currentDebt + amount;
          ledgerType = 'debt_creation';
        }
      } else {
        newDebt = Math.max(0, currentDebt - amount);
        ledgerType = 'debt_adjustment';
      }

      await CustomerRepository.update(customerId, {
        debtBalance: newDebt,
        walletBalance: newWallet
      });

      await SupabaseService.createLedgerEntry({
        businessId: activeBusinessId,
        customerId,
        type: ledgerType,
        amount: resolvedAmount,
        walletBalance: newWallet,
        debtBalance: newDebt,
        recordedBy: cashierName,
        note: note || (operation === 'add' ? `Manual debt increase` : `Manual debt reduction`),
        referenceId: id || `debt-adj-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`,
      });
    },
  };
});
