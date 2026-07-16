import { create } from "zustand";

export interface HealthState {
  dbStatus: "Connected" | "Connecting" | "Offline" | "Error";
  internetStatus: "Online" | "Offline";
  aiStatus: "Online" | "Offline" | "Error" | "Connecting";
  sessionStatus: "Logged In" | "Logged Out" | "Session Expired" | "Connecting" | "Error";
  dbErrorMsg: string | null;
  aiErrorMsg: string | null;
  sessionErrorMsg: string | null;
  lastCheckedAt: string | null;
  
  setStatuses: (updates: Partial<Omit<HealthState, "setStatuses">>) => void;
}

export const useSystemHealthStore = create<HealthState>((set) => ({
  dbStatus: "Connecting",
  internetStatus: "Online",
  aiStatus: "Connecting",
  sessionStatus: "Connecting",
  dbErrorMsg: null,
  aiErrorMsg: null,
  sessionErrorMsg: null,
  lastCheckedAt: null,
  
  setStatuses: (updates) => set((state) => ({ ...state, ...updates })),
}));
