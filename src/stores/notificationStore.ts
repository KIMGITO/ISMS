import { create } from "zustand";
import { EmployeeRole, NotificationType, NotificationPriority, AppNotification } from "../types";
import { useAuthStore } from "./authStore";
import { useBusinessStore } from "./businessStore";
import { NotificationRepository, SQLiteRow } from "../services/notifications/notificationRepository";

export interface ToastMessage {
  id: string;
  sender: string;
  message: string;
  avatar?: string;
  time?: string;
  type?: "success" | "error" | "info";
  timestamp: string;
  read: boolean;
  category?: "inventory" | "logistics" | "security" | "sales" | "audit" | "system";
}

export interface NotificationPref {
  inventory: boolean;
  logistics: boolean;
  security: boolean;
  sales: boolean;
  audit: boolean;
}

export const DEFAULT_PREFS_BY_ROLE: Record<string, NotificationPref> = {
  Owner: { inventory: true, logistics: true, security: true, sales: true, audit: true },
  Admin: { inventory: false, logistics: false, security: true, sales: false, audit: true },
  Manager: { inventory: true, logistics: true, security: true, sales: true, audit: true },
  Cashier: { inventory: true, logistics: false, security: false, sales: true, audit: false },
  "Inventory Manager": { inventory: true, logistics: false, security: true, sales: false, audit: false },
  Staff: { inventory: true, logistics: true, security: false, sales: true, audit: false },
  Administrator: { inventory: false, logistics: false, security: true, sales: false, audit: true },
  Rider: { inventory: false, logistics: true, security: false, sales: false, audit: false },
  "Production Staff": { inventory: true, logistics: false, security: false, sales: false, audit: false },
  "Inventory Staff": { inventory: true, logistics: false, security: false, sales: false, audit: false },
  "Delivery Driver": { inventory: false, logistics: true, security: false, sales: false, audit: false },
  "Customer Support": { inventory: false, logistics: true, security: false, sales: true, audit: false }
};

export const ROLE_ELIGIBLE_CATEGORIES: Record<string, ("inventory" | "logistics" | "security" | "sales" | "audit")[]> = {
  Owner: ["inventory", "logistics", "security", "sales", "audit"],
  Admin: ["security", "audit"],
  Manager: ["inventory", "logistics", "security", "sales", "audit"],
  Cashier: ["inventory", "sales"],
  "Inventory Manager": ["inventory", "security"],
  Staff: ["inventory", "logistics", "sales"],
  Administrator: ["security", "audit"],
  Rider: ["logistics"],
  "Production Staff": ["inventory"],
  "Inventory Staff": ["inventory"],
  "Delivery Driver": ["logistics"],
  "Customer Support": ["sales", "logistics"]
};

export const getNotificationPrefs = (employeeId: string, role: EmployeeRole): NotificationPref => {
  try {
    const saved = localStorage.getItem(`kkm_notif_pref_${employeeId}`);
    if (saved) return JSON.parse(saved);
  } catch {}
  return DEFAULT_PREFS_BY_ROLE[role] || { inventory: true, logistics: true, security: true, sales: true, audit: true };
};

export const saveNotificationPrefs = (employeeId: string, prefs: NotificationPref) => {
  try {
    localStorage.setItem(`kkm_notif_pref_${employeeId}`, JSON.stringify(prefs));
  } catch {}
};

export const getCategoryForNotification = (sender: string, message: string): "inventory" | "logistics" | "security" | "sales" | "audit" => {
  const text = (sender + " " + message).toLowerCase();
  if (text.includes("stock") || text.includes("inventory") || text.includes("catalog") || text.includes("product") || text.includes("damage") || text.includes("restock")) {
    return "inventory";
  }
  if (text.includes("rider") || text.includes("delivery") || text.includes("courier") || text.includes("logistics") || text.includes("dispatch") || text.includes("route")) {
    return "logistics";
  }
  if (text.includes("security") || text.includes("pin") || text.includes("access") || text.includes("biometric") || text.includes("fingerprint") || text.includes("violation") || text.includes("clearance") || text.includes("operator")) {
    return "security";
  }
  if (text.includes("sale") || text.includes("pos") || text.includes("checkout") || text.includes("transaction") || text.includes("cash drawer") || text.includes("refund")) {
    return "sales";
  }
  if (text.includes("audit") || text.includes("reconcile") || text.includes("financial") || text.includes("ledger") || text.includes("shift")) {
    return "audit";
  }
  return "inventory"; // Default fallback
};

interface NotificationState {
  toast: ToastMessage | null;
  notifications: SQLiteRow<AppNotification>[];
  unreadCount: number;
  init: () => void;
  // Local UI-only toast (doesn't save to DB)
  showToast: (sender: string, message: string, avatar?: string, type?: "success" | "error" | "info", category?: "inventory" | "logistics" | "security" | "sales" | "audit" | "system") => void;
  clearToast: () => void;
  markAsRead: (id: string) => void;
  markAllAsRead: () => void;
  deleteNotification: (id: string) => void;
  clearAllNotifications: () => void;
}

export const useNotificationStore = create<NotificationState>((set, get) => ({
  toast: null,
  notifications: [],
  unreadCount: 0,
  
  init: () => {
    // Subscribe to DB notifications via repository
    NotificationRepository.subscribe((activeNotifications) => {
      // Filter out deleted/archived and update state
      set({ 
        notifications: activeNotifications,
        unreadCount: activeNotifications.filter(n => !n.read_at).length
      });
      
      // When a new notification arrives via realtime, pop up a toast if it's new
      // We can determine if it's new by checking if it was just created within the last 10 seconds
      if (activeNotifications.length > 0) {
        const latest = activeNotifications[0];
        const age = Date.now() - new Date(latest.created_at).getTime();
        if (age < 10000 && !latest.read_at) {
          // Play audio cue
          playAudioCue(latest.priority === "high" || latest.priority === "critical" ? "error" : "info");
          
          let parsedPayload: any = {};
          try {
            parsedPayload = typeof latest.payload === "string" ? JSON.parse(latest.payload) : latest.payload;
          } catch(e) {}
          
          set({
            toast: {
              id: latest.id,
              sender: latest.title,
              message: latest.message,
              avatar: parsedPayload?.avatar || "https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&q=80&w=150",
              timestamp: latest.created_at,
              read: false,
              type: latest.priority === "high" || latest.priority === "critical" ? "error" : "info",
              category: parsedPayload?.category || "system"
            }
          });
          
          setTimeout(() => {
            const current = get().toast;
            if (current && current.id === latest.id) {
              set({ toast: null });
            }
          }, 5000);
        }
      }
    });
  },

  showToast: (sender, message, avatar, type, category) => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    const timestamp = new Date().toISOString();
    
    let computedType = type;
    if (!computedType) {
      const txt = (sender + " " + message).toLowerCase();
      if (txt.includes("fail") || txt.includes("error") || txt.includes("denied")) {
        computedType = "error";
      } else {
        computedType = "success";
      }
    }
    
    if (get().toast) set({ toast: null });

    playAudioCue(computedType);

    set({
      toast: {
        id,
        sender,
        message,
        avatar: avatar || "https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&q=80&w=150",
        time: "Just now",
        type: computedType,
        timestamp,
        read: false,
        category: category || "system"
      }
    });

    setTimeout(() => {
      const active = get().toast;
      if (active && active.id === id) {
        set({ toast: null });
      }
    }, 5000);
  },

  clearToast: () => {
    set({ toast: null });
  },

  markAsRead: (id) => {
    NotificationRepository.update(id, { read_at: new Date().toISOString() });
  },

  markAllAsRead: () => {
    const active = get().notifications.filter(n => !n.read_at);
    active.forEach(n => {
      NotificationRepository.update(n.id, { read_at: new Date().toISOString() });
    });
  },

  deleteNotification: (id) => {
    NotificationRepository.update(id, { deleted_at: new Date().toISOString() });
  },

  clearAllNotifications: () => {
    const active = get().notifications;
    active.forEach(n => {
      NotificationRepository.update(n.id, { deleted_at: new Date().toISOString() });
    });
  }
}));

// Helper function to play a synthesized chime
function playAudioCue(type: "error" | "success" | "info") {
  try {
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    if (AudioContextClass) {
      const ctx = new AudioContextClass();
      if (type === "error") {
        const osc1 = ctx.createOscillator();
        const gain1 = ctx.createGain();
        osc1.type = "sine";
        osc1.frequency.setValueAtTime(260, ctx.currentTime);
        gain1.gain.setValueAtTime(0.12, ctx.currentTime);
        gain1.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.15);
        osc1.connect(gain1);
        gain1.connect(ctx.destination);
        osc1.start();
        osc1.stop(ctx.currentTime + 0.15);
      } else if (type === "success") {
        const osc1 = ctx.createOscillator();
        const gain1 = ctx.createGain();
        osc1.type = "triangle";
        osc1.frequency.setValueAtTime(523.25, ctx.currentTime);
        gain1.gain.setValueAtTime(0.15, ctx.currentTime);
        gain1.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.15);
        osc1.connect(gain1);
        gain1.connect(ctx.destination);
        osc1.start();
        osc1.stop(ctx.currentTime + 0.15);
      } else {
        const osc1 = ctx.createOscillator();
        const gain = ctx.createGain();
        osc1.type = "sine";
        osc1.frequency.setValueAtTime(440, ctx.currentTime);
        gain.gain.setValueAtTime(0.15, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3);
        osc1.connect(gain);
        gain.connect(ctx.destination);
        osc1.start();
        osc1.stop(ctx.currentTime + 0.3);
      }
    }
  } catch (e) {}
}
