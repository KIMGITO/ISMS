// src/stores/customerStore.ts
import { create } from "zustand";
import { Customer } from "../types";
import { useBusinessStore } from "./businessStore";
import { CustomerRepository } from "../services/repositories";
import { normalizePhone } from "../utils/phoneUtils";
import { checkPermissionGate } from "../utils/permissions";
import { SupabaseService } from "../services/supabaseService";
import { NotificationService } from "../services/notifications/notificationService";

interface CustomerState {
  customers: Customer[];
  addCustomer: (
    customer: Omit<Customer, "id" | "purchasesCount" | "joinDate">
  ) => Promise<Customer>;
  addLoyaltyPoints: (customerId: string, finalTotal: number) => Promise<void>;
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

    addLoyaltyPoints: async (customerId, finalTotal) => {
      const cust = await CustomerRepository.getById(customerId);
      if (!cust) return;

      const pointsEarned = Math.floor(finalTotal);
      const newPoints = cust.loyaltyPoints + pointsEarned;
      let tier = cust.tier;
      if (newPoints > 300) tier = "Gold";
      else if (newPoints > 100) tier = "Silver";

      await CustomerRepository.update(customerId, {
        loyaltyPoints: newPoints,
        purchasesCount: cust.purchasesCount + 1,
        tier,
      });
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

      // 1. Process local/offline credit tables update sequence
      try {
        const entries = await SupabaseService.fetchCreditSales(customerId);
        let amountLeft = amount;
        for (const credit of entries) {
          if (amountLeft <= 0) break;
          const creditTotal = Number(credit.final_total);
          const creditPaid = Number(credit.amount_paid || 0);
          const creditDue = creditTotal - creditPaid;
          if (creditDue <= 0) continue;

          if (amountLeft >= creditDue) {
            amountLeft -= creditDue;
            await SupabaseService.updateCreditPayment(credit.id, {
              amount_paid: creditTotal,
              status: 'Success',
              settled_at: new Date().toISOString()
            });
          } else {
            const newPaid = creditPaid + amountLeft;
            amountLeft = 0;
            await SupabaseService.updateCreditPayment(credit.id, {
              amount_paid: newPaid,
              status: 'Partial',
              settled_at: null
            });
          }
        }
      } catch (err) {
        console.error("Failed to update sequential credit payment records", err);
      }

      // 2. Create debt payment record
      await SupabaseService.createDebtPayment({
        id: id ? `${id}-payment` : undefined,
        businessId: activeBusinessId,
        customerId,
        amountPaid: amount,
        remainingDebt: newDebt,
        paymentMethod: method,
        recordedBy: cashierName,
        note: note || "",
      });

      // 3. Update customer balance
      await CustomerRepository.update(customerId, {
        debtBalance: newDebt
      });

      // 4. Log to customer ledger
      await SupabaseService.createLedgerEntry({
        id: id ? `${id}-ledger` : undefined,
        businessId: activeBusinessId,
        customerId,
        type: 'debt_payment',
        amount: amount,
        walletBalance: Number(cust.walletBalance || 0),
        debtBalance: newDebt,
        recordedBy: cashierName,
        note: note || `Debt payment via ${method}`,
      });

      // 5. Trigger notification
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

      const currentDebt = Number(cust.debtBalance || 0);
      const currentWallet = Number(cust.walletBalance || 0);
      const activeBusinessId = useBusinessStore.getState().activeBusinessId;

      let newDebt = currentDebt;
      let newWallet = currentWallet;
      let debtPaid = 0;
      let walletDeposited = 0;

      if (currentDebt > 0) {
        if (amount <= currentDebt) {
          newDebt = currentDebt - amount;
          debtPaid = amount;
        } else {
          newDebt = 0;
          debtPaid = currentDebt;
          newWallet = currentWallet + (amount - currentDebt);
          walletDeposited = amount - currentDebt;
        }
      } else {
        newWallet = currentWallet + amount;
        walletDeposited = amount;
      }

      await CustomerRepository.update(customerId, {
        debtBalance: newDebt,
        walletBalance: newWallet
      });

      if (debtPaid > 0) {
        await SupabaseService.createLedgerEntry({
          id: id ? `${id}-ledger-pay` : undefined,
          businessId: activeBusinessId,
          customerId,
          type: 'debt_payment',
          amount: debtPaid,
          walletBalance: currentWallet,
          debtBalance: newDebt,
          recordedBy: cashierName,
          note: note || `Debt automatically paid off via wallet deposit`,
        });
      }

      if (walletDeposited > 0) {
        await SupabaseService.createLedgerEntry({
          id: id ? `${id}-ledger-dep` : undefined,
          businessId: activeBusinessId,
          customerId,
          type: 'wallet_topup',
          amount: walletDeposited,
          walletBalance: newWallet,
          debtBalance: newDebt,
          recordedBy: cashierName,
          note: note || `Wallet top-up`,
        });
      }
    },

    spendCustomerWallet: async (customerId, amount, cashierName, note, id) => {
      const cust = await CustomerRepository.getById(customerId);
      if (!cust) throw new Error("Customer profile not found.");
      if (amount <= 0) throw new Error("Amount must be greater than zero.");
      const currentWallet = Number(cust.walletBalance || 0);
      if (amount > currentWallet) throw new Error("Insufficient wallet balance.");

      const newWallet = currentWallet - amount;
      const activeBusinessId = useBusinessStore.getState().activeBusinessId;

      await CustomerRepository.update(customerId, {
        walletBalance: newWallet
      });

      await SupabaseService.createLedgerEntry({
        id: id ? `${id}-ledger` : undefined,
        businessId: activeBusinessId,
        customerId,
        type: 'wallet_usage',
        amount: amount,
        walletBalance: newWallet,
        debtBalance: Number(cust.debtBalance || 0),
        recordedBy: cashierName,
        note: note || `Wallet credit spent`,
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
              id: id ? `${id}-ledger-pre` : undefined,
              businessId: activeBusinessId,
              customerId,
              type: 'wallet_usage',
              amount: currentWallet,
              walletBalance: 0,
              debtBalance: 0,
              recordedBy: cashierName,
              note: note || `Wallet usage prior to manual debt creation`,
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
        id: id ? `${id}-ledger` : undefined,
        businessId: activeBusinessId,
        customerId,
        type: ledgerType,
        amount: resolvedAmount,
        walletBalance: newWallet,
        debtBalance: newDebt,
        recordedBy: cashierName,
        note: note || (operation === 'add' ? `Manual debt increase` : `Manual debt reduction`),
      });
    },
  };
});
