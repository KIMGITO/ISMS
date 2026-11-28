// src/stores/unclaimedPaymentsStore.ts
// Live till (C2B) payments that still need sorting out (unclaimed, under review, partly claimed,
// disputed). Drives the header indicator and the Unclaimed Payments screen. Supabase realtime
// reloads on any change to till payments, prompts or allocations; the rules live in the DB
// (allocate_till_payment, flag_till_payment, handle_till_payment, 20261213001).
import { create } from "zustand";
import { MpesaRepository } from "../services/repositories";
import { OPEN_TILL_STATUSES, type TillPayment } from "../types";
import { onBranchChange } from "./businessStore";

let liveUnsub: (() => void) | null = null;
let branchHooked = false;

interface State {
  payments: TillPayment[];
  /** Payments still needing action. */
  unclaimedCount: number;
  /** Payment to open when the screen shows (set from the header list). */
  focusId: string | null;
  setFocus: (id: string | null) => void;
  start: () => void;
  stop: () => void;
}

export const useUnclaimedPaymentsStore = create<State>((set) => {
  const apply = (tillPayments: TillPayment[]) =>
    set({
      payments: tillPayments,
      unclaimedCount: tillPayments.filter((p) => OPEN_TILL_STATUSES.includes(p.status)).length,
    });
  const subscribe = () => {
    liveUnsub?.();
    liveUnsub = MpesaRepository.subscribe(({ tillPayments }) => apply(tillPayments));
  };
  return {
    payments: [],
    unclaimedCount: 0,
    focusId: null,
    setFocus: (id) => set({ focusId: id }),
    start: () => {
      if (liveUnsub) return;
      subscribe();
      if (!branchHooked) {
        branchHooked = true;
        onBranchChange(() => {
          set({ payments: [], unclaimedCount: 0, focusId: null });
          if (liveUnsub) subscribe();
        });
      }
    },
    stop: () => {
      liveUnsub?.();
      liveUnsub = null;
      set({ payments: [], unclaimedCount: 0 });
    },
  };
});
