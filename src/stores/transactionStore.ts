// src/stores/transactionStore.ts
import { create } from "zustand";
import { Transaction, DebtPayment } from "../types";
import { TransactionRepository } from "../services/repositories";
import { networkService } from "../services/networkService";
import { SupabaseService } from "../services/supabaseService";
import { useBusinessStore } from "./businessStore";
import { salesOutbox } from "../services/offline/salesOutbox";

interface TransactionState {
  transactions: Transaction[];
  /** Sales saved on this device while offline, not yet on the server (all businesses). */
  offlineSales: Transaction[];
  /** Sends offline sales to the server now (also runs when the connection returns). */
  syncOfflineSales: () => Promise<void>;
  debtPayments: DebtPayment[];
  isOnline: boolean;
  isSyncing: boolean;
  lastSyncedAt: string | null;
  toggleNetwork: () => void;
  addTransaction: (tx: Transaction) => Promise<Transaction>;
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

  // Subscribe to networkService for dynamic online/offline detection.
  // Coming back online sends any sales that were saved while offline.
  networkService.subscribe((isOnline) => {
    const wasOnline = get()?.isOnline;
    set({ isOnline });
    if (isOnline && wasOnline === false) void get().syncOfflineSales();
  });

  // Offline sales show in the sales lists until they reach the server
  salesOutbox.subscribe((queue) => set({ offlineSales: queue.map((q) => q.tx) }));

  // Sales left from an earlier session (app closed while offline) go out on start
  setTimeout(() => {
    if (networkService.isOnline() && salesOutbox.count() > 0) void get().syncOfflineSales();
  }, 3000);

  return {
    transactions: [],
    offlineSales: salesOutbox.list().map((q) => q.tx),
    debtPayments: [],

    syncOfflineSales: async () => {
      if (salesOutbox.count() === 0 || !networkService.isOnline()) return;
      const result = await salesOutbox.flush();
      if (result.synced.length === 0) return;

      // Imported here to keep the stores free of import cycles
      const [{ useNotificationStore }, { kraService }] = await Promise.all([
        import("./notificationStore"),
        import("../services/kra/kraService"),
      ]);
      const n = result.synced.length;
      useNotificationStore.getState().showToast(
        n === 1 ? "Offline sale synced" : `${n} offline sales synced`,
        result.remaining > 0 ? `${result.remaining} still waiting.` : "Everything is up to date.",
        undefined,
        "success",
      );
      // KRA signing needs the server copy, so it happens now rather than at the till
      for (const { queued, saved } of result.synced) {
        const businessId = queued.businessId;
        if (businessId && saved?.id) void kraService.reportSaleIfConnected(businessId, saved.id);
      }
      await get().loadTransactionsFromServer().catch(() => {});
    },

    isOnline: networkService.isOnline(),
    isSyncing: false,
    lastSyncedAt: new Date().toISOString(),

    addTransaction: async (tx) => {
      // Direct call to TransactionRepository (which writes securely to live Supabase)
      return TransactionRepository.add(tx);
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