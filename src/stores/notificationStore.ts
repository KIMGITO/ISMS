import { toUserMessage } from "../utils/userError";
import { create } from "zustand";
import { EmployeeRole, NotificationType, NotificationPriority, AppNotification } from "../types";
import { useAuthStore } from "./authStore";
import { useBusinessStore } from "./businessStore";
import { getSupabase } from "../services/supabaseClient";
import { NotificationRepository, SQLiteRow } from "../services/notifications/notificationRepository";
import { NotificationToneService } from "../services/notifications/notificationTone";

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
  /** A brief confirmation of your own action: shown as a small silent pill. */
  quiet?: boolean;
}

interface NotificationState {
  toast: ToastMessage | null;
  notifications: SQLiteRow<AppNotification>[];
  unreadCount: number;
  scheduleReminders: SQLiteRow<AppNotification>[];
  unreadReminderCount: number;
  init: () => void;
  initScheduleReminders: () => void;
  markReminderAsRead: (id: string) => void;
  // Local UI-only toast (doesn't save to DB)
  showToast: (sender: string, message: string, avatar?: string, type?: "success" | "error" | "info", category?: "inventory" | "logistics" | "security" | "sales" | "audit" | "system") => void;
  clearToast: () => void;
  markAsRead: (id: string) => void;
  markAllAsRead: () => void;
  deleteNotification: (id: string) => void;
  clearAllNotifications: () => void;
}

// Module-level reference to the schedule-reminder realtime channel, so
// repeated calls to initScheduleReminders() (authStore hydration + view mount)
// do NOT create a second channel with the same name. Supabase dedupes channels
// by name and throws "cannot add postgres_changes callbacks ... after subscribe()"
// if a new .on() is added to an already-subscribed channel.
let scheduleReminderChannel: any = null;

export const useNotificationStore = create<NotificationState>((set, get) => ({
  toast: null,
  notifications: [],
  unreadCount: 0,
  scheduleReminders: [],
  unreadReminderCount: 0,
  
  initScheduleReminders: () => {
    const supabase = getSupabase();
    const currentUser = useAuthStore.getState().currentUser;
    if (!supabase || !currentUser) return;

    // Idempotency guard: remove any existing channel BEFORE re-creating it,
    // otherwise Supabase throws on the second .on() after .subscribe().
    if (scheduleReminderChannel) {
      try {
        supabase.removeChannel(scheduleReminderChannel);
      } catch (e) {
        console.warn("[ScheduleReminder] Failed to remove previous channel:", e);
      }
      scheduleReminderChannel = null;
    }

    // Query only Schedule Reminder notifications for the current user
    supabase
      .from("notifications")
      .select("*")
      .eq("user_id", currentUser.id)
      .eq("type", "Schedule Reminder")
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .then(({ data, error }) => {
        if (error) {
          console.error("Failed to load schedule reminders:", error);
          return;
        }
        const rows: SQLiteRow<AppNotification>[] = (data || []).map((r) => r as any);
        set({
          scheduleReminders: rows,
          unreadReminderCount: rows.filter((r) => !r.read_at).length,
        });
      });

    // Subscribe to realtime changes on notifications filtered by user,
    // then retain only Schedule Reminder type in the local list.
    scheduleReminderChannel = supabase
      .channel("realtime-schedule-reminders")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "notifications",
          filter: `user_id=eq.${currentUser.id}`,
        },
        async (payload: any) => {
          const type = payload?.new?.type ?? payload?.old?.type;
          // Re-fetch whenever anything changes for this user; simplest & safe.
          const { data } = await supabase
            .from("notifications")
            .select("*")
            .eq("user_id", currentUser.id)
            .eq("type", "Schedule Reminder")
            .is("deleted_at", null)
            .order("created_at", { ascending: false });
          const rows: SQLiteRow<AppNotification>[] = (data || []).map((r) => r as any);
          set({
            scheduleReminders: rows,
            unreadReminderCount: rows.filter((r) => !r.read_at).length,
          });
        }
      )
      .subscribe();

    // Keep removed on logout / next init
    const unsub = () => {
      if (scheduleReminderChannel) {
        try {
          supabase.removeChannel(scheduleReminderChannel);
        } catch (e) {
          console.warn("[ScheduleReminder] Failed to remove channel on unsub:", e);
        }
        scheduleReminderChannel = null;
      }
    };
    (window as any).__kkm_reminder_unsub__ = unsub;
  },
  
  init: () => {
    // Proactively load existing notifications from Supabase so the Messages
    // page is populated on app startup. Without this fix, the in-memory
    // notifications array starts empty and only fills when a NEW row is
    // inserted (via the realtime postgres_changes event), so existing
    // notifications never appear in the UI.
    const bizId = useBusinessStore.getState().activeBusinessId;
    if (bizId) {
      NotificationRepository.loadFromSupabase(bizId).catch(console.error);
    }

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
              avatar: parsedPayload?.avatar || undefined,
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

  markReminderAsRead: (id) => {
    const supabase = getSupabase();
    const query = supabase
      .from("notifications")
      .update({ read_at: new Date().toISOString() })
      .eq("id", id);
    if (typeof (query as any).then === "function") {
      (query as unknown as Promise<{ error: any }>).then(({ error }) => {
        if (error) {
          console.error("[ScheduleReminder] Failed to mark read:", error);
          return;
        }
        set({
          scheduleReminders: get().scheduleReminders.map((r) =>
            r.id === id ? { ...r, read_at: new Date().toISOString() } : r
          ),
          unreadReminderCount: Math.max(0, get().unreadReminderCount - 1),
        });
      });
    }
  },

  showToast: (sender, rawMessage, avatar, type, category) => {
    // Safety net: an error toast never shows raw database or runtime text.
    const message = type === "error" ? toUserMessage(rawMessage) : rawMessage;
    const id = `toast-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    const timestamp = new Date().toISOString();
    
    let computedType = type;
    if (!computedType) {
      // No type given: guess from the words, so a warning never shows as a green "done".
      const txt = (sender + " " + message).toLowerCase();
      if (/fail|error|denied|invalid|cannot|can't|unable|not allowed/.test(txt)) {
        computedType = "error";
      } else if (/validation|required|must |please|missing|restricted|need|warning|offline|out of stock|not enough/.test(txt)) {
        computedType = "info";
      } else {
        computedType = "success";
      }
    }
    
    if (get().toast) set({ toast: null });

    // Confirmations of your own actions (success, no sender picture) show as a brief,
    // silent pill. Errors, alerts and messages from people or the system keep the card.
    const isQuiet = computedType === "success" && !avatar;
    if (!isQuiet) playAudioCue(computedType);

    set({
      toast: {
        id,
        sender,
        message,
        // No stock photo: the toast falls back to the business logo or your own picture.
        avatar: avatar || undefined,
        quiet: isQuiet,
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
    }, isQuiet ? 1600 : 5000);
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
  // Per-device tone (respects user-selected tone, incl. silent)
  NotificationToneService.playWebTone();
}
