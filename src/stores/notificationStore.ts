import { create } from "zustand";
import { EmployeeRole, NotificationType, NotificationPriority } from "../types";
import { useAuthStore } from "./authStore";
import { useBusinessStore } from "./businessStore";
import { NotificationRepository } from "../services/notifications/notificationRepository";

export interface ToastMessage {
  id: string;
  sender: string;
  message: string;
  avatar?: string;
  time?: string;
  type?: "success" | "error" | "info";
  timestamp: string;
  read: boolean;
  category?: "inventory" | "logistics" | "security" | "sales" | "audit";
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
  notifications: ToastMessage[];
  showToast: (sender: string, message: string, avatar?: string, type?: "success" | "error" | "info", category?: "inventory" | "logistics" | "security" | "sales" | "audit") => void;
  clearToast: () => void;
  markAsRead: (id: string) => void;
  markAllAsRead: () => void;
  clearAllNotifications: () => void;
  deleteNotification: (id: string) => void;
}

const localNotificationsKey = "kkm_notifications_list_v1";

const getSavedNotifications = (): ToastMessage[] => {
  try {
    const saved = localStorage.getItem(localNotificationsKey);
    return saved ? JSON.parse(saved) : [];
  } catch {
    return [];
  }
};

export const useNotificationStore = create<NotificationState>((set, get) => ({
  toast: null,
  notifications: getSavedNotifications(),
  showToast: (sender, message, avatar, type, category) => {
    // Generate a unique toast message
    const id = `toast-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    const timestamp = new Date().toISOString();
    
    // Auto-detect error type if not explicitly supplied
    let computedType = type;
    if (!computedType) {
      const txt = (sender + " " + message).toLowerCase();
      if (txt.includes("fail") || txt.includes("error") || txt.includes("denied") || txt.includes("violation") || txt.includes("restrict")) {
        computedType = "error";
      } else {
        computedType = "success";
      }
    }
    
    // Clear any existing toast timer
    const currentToast = get().toast;
    if (currentToast) {
      set({ toast: null });
    }

    const resolvedAvatar = avatar || "https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&q=80&w=150";
    const computedCategory = category || getCategoryForNotification(sender, message);

    const newNotification: ToastMessage = {
      id,
      sender,
      message,
      avatar: resolvedAvatar,
      time: "Just now",
      type: computedType,
      timestamp,
      read: false,
      category: computedCategory
    };

    // Detect routine operations (e.g. database syncs, settings saves, backup events)
    const isRoutine = 
      sender.toLowerCase().includes("backup") || 
      sender.toLowerCase().includes("sync") || 
      sender.toLowerCase().includes("save") || 
      sender.toLowerCase().includes("config") ||
      message.toLowerCase().includes("backup") ||
      message.toLowerCase().includes("sync") ||
      message.toLowerCase().includes("saved") ||
      message.toLowerCase().includes("configured") ||
      message.toLowerCase().includes("updated");

    // Update the persistent inbox list only if NOT routine
    let updatedNotifications = get().notifications;
    if (!isRoutine) {
      updatedNotifications = [newNotification, ...get().notifications].slice(0, 50); // limit to last 50
      localStorage.setItem(localNotificationsKey, JSON.stringify(updatedNotifications));

      // Also register/save the in-app notification to the database repository so it appears on the Notifications page
      try {
        const activeBizId = useBusinessStore.getState().activeBusinessId || "all";
        const activeEmp = useAuthStore.getState().currentEmployee;

        // Map computedCategory to NotificationType
        let mappedType: NotificationType = "System Update";
        if (computedCategory === "inventory") {
          mappedType = "Stock Almost Finished";
        } else if (computedCategory === "logistics") {
          mappedType = "Delivery Assigned";
        } else if (computedCategory === "sales") {
          mappedType = "Payment Received";
        } else if (computedCategory === "security") {
          mappedType = "Account Activity";
        } else if (computedCategory === "audit") {
          mappedType = "Account Activity";
        }

        // Map computedType to priority
        let mappedPriority: NotificationPriority = "low";
        if (computedType === "error") {
          mappedPriority = "high";
        } else if (computedType === "success") {
          mappedPriority = "low";
        } else {
          mappedPriority = "medium";
        }

        NotificationRepository.add({
          id,
          business_id: activeBizId,
          user_id: activeEmp ? activeEmp.id : null,
          role: activeEmp ? activeEmp.role : null,
          title: sender,
          message: message,
          type: mappedType,
          priority: mappedPriority,
          action_type: "none",
          action_target: "none",
          payload: JSON.stringify({ category: computedCategory, avatar: resolvedAvatar }),
          read_at: null,
          clicked_at: null,
          expires_at: null,
          sent_at: timestamp,
          delivered_at: timestamp,
          status: "delivered",
          created_by: activeEmp ? activeEmp.name : "system"
        });
      } catch (err) {
        console.error("Failed to register in-app notification to repository", err);
      }
    }

    // Determine if the currently active employee has disabled or is not eligible for this category of notifications.
    // If they have muted or disabled it, we don't show the toast overlay or play the audio cue.
    let shouldShowFloating = true;
    try {
      const activeEmp = useAuthStore.getState().currentEmployee;
      if (activeEmp) {
        const activeRole = activeEmp.role;
        const eligibleCats = ROLE_ELIGIBLE_CATEGORIES[activeRole] || [];
        if (!eligibleCats.includes(computedCategory)) {
          shouldShowFloating = false;
        } else {
          const prefs = getNotificationPrefs(activeEmp.id, activeRole);
          if (prefs[computedCategory] === false) {
            shouldShowFloating = false;
          }
        }
      }
    } catch (err) {
      console.warn("Could not check employee notification preferences", err);
    }

    if (shouldShowFloating) {
      // Play a beautiful synthesized chime tone using Web Audio API (skip for routine notifications)
      if (!isRoutine) {
        try {
          const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
          if (AudioContextClass) {
            const ctx = new AudioContextClass();
            
            if (computedType === "error") {
              // Double alert beep for errors/security warnings
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

              setTimeout(() => {
                try {
                  const osc2 = ctx.createOscillator();
                  const gain2 = ctx.createGain();
                  osc2.type = "sine";
                  osc2.frequency.setValueAtTime(220, ctx.currentTime);
                  gain2.gain.setValueAtTime(0.12, ctx.currentTime);
                  gain2.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.2);
                  osc2.connect(gain2);
                  gain2.connect(ctx.destination);
                  osc2.start();
                  osc2.stop(ctx.currentTime + 0.2);
                } catch {}
              }, 120);
            } else if (computedType === "success") {
              // Satisfying upward success double chime
              const osc1 = ctx.createOscillator();
              const gain1 = ctx.createGain();
              osc1.type = "triangle";
              osc1.frequency.setValueAtTime(523.25, ctx.currentTime); // C5
              gain1.gain.setValueAtTime(0.15, ctx.currentTime);
              gain1.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.15);
              osc1.connect(gain1);
              gain1.connect(ctx.destination);
              osc1.start();
              osc1.stop(ctx.currentTime + 0.15);

              setTimeout(() => {
                try {
                  const osc2 = ctx.createOscillator();
                  const gain2 = ctx.createGain();
                  osc2.type = "sine";
                  osc2.frequency.setValueAtTime(659.25, ctx.currentTime); // E5
                  gain2.gain.setValueAtTime(0.12, ctx.currentTime);
                  gain2.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.25);
                  osc2.connect(gain2);
                  gain2.connect(ctx.destination);
                  osc2.start();
                  osc2.stop(ctx.currentTime + 0.25);
                } catch {}
              }, 100);
            } else {
              // Info or generic alert: warm, soft dual chime
              const osc1 = ctx.createOscillator();
              const osc2 = ctx.createOscillator();
              const gain = ctx.createGain();
              
              osc1.type = "sine";
              osc1.frequency.setValueAtTime(440, ctx.currentTime); // A4
              osc2.type = "sine";
              osc2.frequency.setValueAtTime(554.37, ctx.currentTime); // C#5
              
              gain.gain.setValueAtTime(0.15, ctx.currentTime);
              gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3);
              
              osc1.connect(gain);
              osc2.connect(gain);
              gain.connect(ctx.destination);
              
              osc1.start();
              osc2.start();
              osc1.stop(ctx.currentTime + 0.3);
              osc2.stop(ctx.currentTime + 0.3);
            }
          }
        } catch {}
      }

      // Try to dispatch a real OS/browser push notification! (skip for routine notifications)
      if (!isRoutine && typeof window !== "undefined" && "Notification" in window) {
        if (Notification.permission === "granted") {
          try {
            new Notification(sender, {
              body: message,
              icon: resolvedAvatar,
              tag: id,
            });
          } catch (e) {
            console.warn("Could not dispatch standard Notification object:", e);
          }
        } else if (Notification.permission !== "denied" && localStorage.getItem("kkm_pref_push") === "true") {
          Notification.requestPermission().then((perm) => {
            if (perm === "granted") {
              try {
                new Notification(sender, {
                  body: message,
                  icon: resolvedAvatar,
                  tag: id,
                });
              } catch {}
            }
          });
        }
      }

      set({
        toast: newNotification,
        notifications: updatedNotifications
      });

      // Automatically clear the floating toast in 5 seconds
      setTimeout(() => {
        const active = get().toast;
        if (active && active.id === id) {
          set({ toast: null });
        }
      }, 5000);
    } else {
      set({
        notifications: updatedNotifications
      });
    }
  },
  clearToast: () => {
    set({ toast: null });
  },
  markAsRead: (id) => {
    const updated = get().notifications.map(n => n.id === id ? { ...n, read: true } : n);
    localStorage.setItem(localNotificationsKey, JSON.stringify(updated));
    set({ notifications: updated });
  },
  markAllAsRead: () => {
    const updated = get().notifications.map(n => ({ ...n, read: true }));
    localStorage.setItem(localNotificationsKey, JSON.stringify(updated));
    set({ notifications: updated });
  },
  clearAllNotifications: () => {
    localStorage.setItem(localNotificationsKey, JSON.stringify([]));
    set({ notifications: [] });
  },
  deleteNotification: (id) => {
    const updated = get().notifications.filter(n => n.id !== id);
    localStorage.setItem(localNotificationsKey, JSON.stringify(updated));
    set({ notifications: updated });
  }
}));
