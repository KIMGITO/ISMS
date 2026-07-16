// src/stores/transactionStore.ts
import { create } from "zustand";
import { Transaction, DebtPayment } from "../types";
import { TransactionRepository } from "../services/repositories";
import { networkService } from "../services/networkService";
import { SupabaseService } from "../services/supabaseService";
import { useBusinessStore } from "./businessStore";

interface TransactionState {
  transactions: Transaction[];
  debtPayments: DebtPayment[];
  isOnline: boolean;
  isSyncing: boolean;
  lastSyncedAt: string | null;
  toggleNetwork: () => void;
  addTransaction: (tx: Transaction) => Promise<void>;
  syncWithServer: () => Promise<void>;
  loadTransactionsFromServer: () => Promise<void>;
}

export const useTransactionStore = create<TransactionState>((set, get) => {
  let unsub: (() => void) | null = null;
  let unsubDebt: (() => void) | null = null;

  const setupSubscription = (businessId: string) => {
    if (unsub) unsub();
    if (unsubDebt) unsubDebt();

    if (!businessId) {
      set({ transactions: [], debtPayments: [] });
      return;
    }

    unsub = TransactionRepository.subscribe((txs) => {
      set({ transactions: txs });
    });

    unsubDebt = SupabaseService.subscribeBusinessDebtPayments(businessId, (payments) => {
      set({ debtPayments: payments });
    });
  };

  // Listen to business transitions dynamically after all modules load to avoid circular init issues
  setTimeout(() => {
    useBusinessStore.subscribe((state) => {
      setupSubscription(state.activeBusinessId);
    });
    setupSubscription(useBusinessStore.getState().activeBusinessId);
  }, 0);

  // Subscribe to networkService for dynamic online/offline detection
  networkService.subscribe((isOnline) => {
    set({ isOnline });
  });

  return {
    transactions: [],
    debtPayments: [],
    isOnline: networkService.isOnline(),
    isSyncing: false,
    lastSyncedAt: new Date().toISOString(),

    addTransaction: async (tx) => {
      // Direct call to TransactionRepository (which writes securely to live Supabase)
      await TransactionRepository.add(tx);
    },

    toggleNetwork: () => {
      // Explicit simulator toggle intended purely for sandbox/debug environment overrides
      networkService.toggleNetwork();
    },

    syncWithServer: async () => {
      await get().loadTransactionsFromServer();
    },

    loadTransactionsFromServer: async () => {
      const businessId = useBusinessStore.getState().activeBusinessId;
      if (businessId && businessId !== "biz-1") {
        set({ isSyncing: true });
        try {
          const fetchedTx = await SupabaseService.fetchTransactions(businessId);
          if (fetchedTx) {
            TransactionRepository.setAll(fetchedTx);
            set({ lastSyncedAt: new Date().toISOString() });
          }
        } finally {
          set({ isSyncing: false });
        }
      }
    },
  };
});