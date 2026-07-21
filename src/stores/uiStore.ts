import { create } from "zustand";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  timestamp?: string;
}

interface UiState {
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
  activeTab: "home" | "pos" | "inventory" | "sales" | "customers" | "feedback" | "dashboard" | "ai" | "workers" | "permissions" | "profile" | "settings" | "notifications" | "business-management" | "production";
  setActiveTab: (tab: "home" | "pos" | "inventory" | "sales" | "customers" | "feedback" | "dashboard" | "ai" | "workers" | "permissions" | "profile" | "settings" | "notifications" | "business-management" | "production") => void;
}

const localChatHistoryKey = "kkm_ai_chat_history_v1";

const getSavedChatHistory = (): ChatMessage[] => {
  const aiName = typeof window !== "undefined" ? (import.meta.env?.VITE_AI_NAME || "Kim") : "Kim";
  const defaultMsg: ChatMessage = {
    role: "assistant",
    content: `Hello! I am ${aiName}, your professional KayKay's Milk Workspace Assistant. I can explain POS workflows, analyze sales history, suggest stocking actions, or generate fresh-batch SMS marketing templates. How can I help you today?`,
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
  selectedCustomerId: null,
  setSelectedCustomerId: (id) => set({ selectedCustomerId: id }),
  activeInvoiceData: null,
  setActiveInvoiceData: (data) => set({ activeInvoiceData: data }),
  activeTab: "home",
  setActiveTab: (tab) => set({ activeTab: tab }),
}));
