import { create } from "zustand";
import { SCREEN_ALIASES } from "../utils/screens";

/** A question the assistant asks with answers to tap instead of typing. */
export interface ChatQuestion {
  question: string;
  /** buttons: tap one; single: radio list; multi: tick several; select: dropdown. */
  style: "buttons" | "single" | "multi" | "select";
  options: string[];
  /** Also offer a box to type a different answer. */
  allowOther?: boolean;
  /** Set once answered, so the choices lock. */
  answer?: string;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  timestamp?: string;
  /** Tasks prepared in this reply, shown as cards under it (ids in pendingActionStore). */
  actionIds?: string[];
  questions?: ChatQuestion[];
}

/** Something search found, for the screen it opens on to show straight away. */
export type SearchTarget =
  | { kind: "sale"; id: string }
  | { kind: "invoice"; customerId: string; invoiceId: string }
  | { kind: "stock"; query: string; id?: string }
  | { kind: "feedback"; tab: "reviews" | "messages" | "reminders" }
  // One exact record from the global search (20261202001). The screen shows it even when it is
  // older than what it has loaded, then search centres and highlights its row.
  | { kind: "expense"; id: string }
  | { kind: "payment"; id: string }
  | { kind: "journal"; id: string; no: number; at?: string }
  | { kind: "ledger"; customerId: string; id: string }
  | { kind: "audit"; id: string; at?: string }
  | { kind: "delivery"; source: "sale" | "online"; id: string }
  | { kind: "transfer"; id: string }
  | { kind: "order"; id: string };

interface UiState {
  searchTarget: SearchTarget | null;
  setSearchTarget: (target: SearchTarget | null) => void;
  aiIsLoading: boolean;
  setAiIsLoading:(loading:  boolean)=> void;
  showNav: boolean;
  setShowNav: (show: boolean) => void;
  aiChatHistory: ChatMessage[];
  setAiChatHistory: (history: ChatMessage[] | ((prev: ChatMessage[]) => ChatMessage[])) => void;
  selectedCustomerId: string | null;
  setSelectedCustomerId: (id: string | null) => void;
  activeInvoiceData: any | null;
  setActiveInvoiceData: (data: any | null) => void;
  activeTab: "home" | "sell" | "pos" | "inventory" | "sales" | "customers" | "feedback" | "online-store" | "website" | "deliveries" | "dashboard" | "ai" | "workers" | "permissions" | "profile" | "settings" | "notifications" | "business-management" | "production" | "about" | "money" | "stock-history" | "stock-transfers" | "stock-report" | "petty-cash" | "finance" | "prompt" | "suppliers" | "audit" | "accounting" | "buying" | "promotions" | "regular-orders" | "marketing";
  setActiveTab: (tab: "home" | "pos" | "inventory" | "sales" | "customers" | "feedback" | "online-store" | "website" | "deliveries" | "dashboard" | "ai" | "workers" | "permissions" | "profile" | "settings" | "notifications" | "business-management" | "production" | "about" | "sell" | "money" | "stock-history" | "stock-transfers" | "stock-report" | "petty-cash" | "finance" | "prompt" | "suppliers" | "audit" | "accounting" | "buying" | "promotions" | "regular-orders" | "marketing") => void;
  /**
   * The part of a merged screen to open, e.g. "books" on Finance or "suppliers" on Buying.
   * Set when an old screen id (accounting, suppliers) is opened; the screen reads it once.
   */
  screenSection: string | null;
  setScreenSection: (section: string | null) => void;
  /** Screens visited before the current one, oldest first. */
  tabHistory: UiState["activeTab"][];
  /** Returns to the previous screen. False when there is none. */
  goBack: () => boolean;
  resetTabHistory: () => void;
}

const localChatHistoryKey = "kkm_ai_chat_history_v1";

const getSavedChatHistory = (): ChatMessage[] => {
  const aiName = typeof window !== "undefined" ? (import.meta.env?.VITE_AI_NAME || "Kim") : "Kim";
  const defaultMsg: ChatMessage = {
    role: "assistant",
    content: `Hi, I'm ${aiName}. Ask me about your sales, stock or customers.`,
    timestamp: new Date().toISOString()
  };

  try {
    const saved = localStorage.getItem(localChatHistoryKey);
    if (saved) {
      const parsed = JSON.parse(saved);
      // Ensure all loaded messages have a fallback timestamp
      return parsed.map((m: any, idx: number) => ({
        ...m,
        timestamp: m.timestamp || new Date(Date.now() - (parsed.length - idx) * 60000).toISOString()
      }));
    }
    return [defaultMsg];
  } catch {
    return [defaultMsg];
  }
};

export const useUiStore = create<UiState>((set, get) => ({
  showNav: true,
  setShowNav: (show) => set({ showNav: show }),
  aiIsLoading: false,
  setAiIsLoading: (loading) => set({ aiIsLoading: loading }),
  aiChatHistory: getSavedChatHistory(),
  setAiChatHistory: (updater) => {
    const nextHistory = typeof updater === "function" ? updater(get().aiChatHistory) : updater;
    localStorage.setItem(localChatHistoryKey, JSON.stringify(nextHistory));
    set({ aiChatHistory: nextHistory });
  },
  searchTarget: null,
  setSearchTarget: (target) => set({ searchTarget: target }),
  selectedCustomerId: null,
  setSelectedCustomerId: (id) => set({ selectedCustomerId: id }),
  activeInvoiceData: null,
  setActiveInvoiceData: (data) => set({ activeInvoiceData: data }),
  activeTab: "home",
  tabHistory: [],
  screenSection: null,
  setScreenSection: (section) => set({ screenSection: section }),
  setActiveTab: (requested) => {
    const merged = SCREEN_ALIASES[requested as string];
    const tab = (merged ? merged.screen : requested) as UiState["activeTab"];
    if (merged) set({ screenSection: merged.section });
    const current = get().activeTab;
    if (tab === current) return;
    // Remembered so the phone's back button returns here instead of closing the app.
    set({ activeTab: tab, tabHistory: [...get().tabHistory.filter((t) => t !== tab), current].slice(-30) });
  },
  goBack: () => {
    const history = get().tabHistory;
    if (history.length === 0) return false;
    set({ activeTab: history[history.length - 1], tabHistory: history.slice(0, -1) });
    return true;
  },
  resetTabHistory: () => set({ tabHistory: [] }),
}));

// A screen id set straight into the store (saved start screen, ?screen= links, older code)
// is moved to the screen it was merged into.
useUiStore.subscribe((state) => {
  const merged = SCREEN_ALIASES[state.activeTab as string];
  if (merged) useUiStore.setState({ activeTab: merged.screen, screenSection: merged.section });
});
