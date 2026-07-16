// src/services/notifications/notificationRepository.ts
import { AppNotification } from "../../types";
import { getSupabase } from "../supabaseClient";
import { toUuid } from "../../utils/idUtils";
import { useBusinessStore } from "../../stores/businessStore";

export type SQLiteRow<T> = T & {
  created_at: string;
  updated_at: string;
  deleted_at?: string | null;
  version?: number;
  sync_status?: "synced" | "pending" | "failed";
  last_modified_by?: string;
};

let notifications: SQLiteRow<AppNotification>[] = [];
const subscribers = new Set<(notifications: SQLiteRow<AppNotification>[]) => void>();

function notify() {
  const active = notifications
    .filter((n) => !n.archived_at && !n.deleted_at)
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  subscribers.forEach((cb) => cb(active));
}

export class NotificationRepository {
  /**
   * Loads notifications from Supabase and synchronizes the in-memory array
   */
  public static async loadFromSupabase(businessId: string): Promise<void> {
    try {
      const supabase = getSupabase();
      const { data, error } = await supabase
        .from("notifications")
        .select("*")
        .eq("business_id", toUuid(businessId))
        .is("deleted_at", null)
        .order("created_at", { ascending: false });

      if (error) throw error;

      notifications = (data || []).map((n) => ({
        id: n.id,
        business_id: n.business_id,
        user_id: n.user_id,
        role: n.role,
        title: n.title,
        message: n.message,
        type: n.type as any,
        priority: n.priority as any,
        action_type: n.action_type as any,
        action_target: n.action_target as any,
        payload: typeof n.payload === "object" ? JSON.stringify(n.payload) : (n.payload || "{}"),
        read_at: n.read_at,
        clicked_at: n.clicked_at,
        created_at: n.created_at,
        expires_at: n.expires_at,
        sent_at: n.sent_at,
        delivered_at: n.delivered_at,
        status: n.status as any,
        created_by: n.created_by,
        archived_at: n.archived_at,
        updated_at: n.updated_at || n.created_at,
      }));
      
      notify();
    } catch (err) {
      console.error("[NotificationRepository] Failed to load notifications from Supabase:", err);
    }
  }

  public static getAll(): SQLiteRow<AppNotification>[] {
    return notifications.filter((n) => !n.archived_at && !n.deleted_at).sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );
  }

  public static getById(id: string): SQLiteRow<AppNotification> | null {
    const uuidId = toUuid(id);
    return notifications.find((n) => (n.id === id || n.id === uuidId) && !n.deleted_at) || null;
  }

  public static add(
    notification: Omit<AppNotification, "created_at" | "updated_at" | "deleted_at" | "version" | "sync_status" | "last_modified_by">,
    lastModifiedBy = "system"
  ): SQLiteRow<AppNotification> {
    const uuidId = toUuid(notification.id);
    const now = new Date().toISOString();
    const row: SQLiteRow<AppNotification> = {
      ...notification,
      id: uuidId,
      created_at: now,
      updated_at: now,
      deleted_at: null,
      version: 1,
      sync_status: "synced",
      last_modified_by: lastModifiedBy,
    } as any;
    notifications.push(row);
    notify();

    // Async save to Supabase to verify audit logging
    const activeBizId = useBusinessStore.getState().activeBusinessId;
    const bizIdUuid = toUuid(row.business_id === "all" ? activeBizId : row.business_id);
    const userUuid = row.user_id ? toUuid(row.user_id) : null;

    const supabase = getSupabase();
    supabase
      .from("notifications")
      .insert({
        id: uuidId,
        business_id: bizIdUuid,
        user_id: userUuid,
        role: row.role,
        title: row.title,
        message: row.message,
        type: row.type,
        priority: row.priority,
        action_type: row.action_type,
        action_target: row.action_target,
        payload: JSON.parse(row.payload),
        read_at: row.read_at,
        clicked_at: row.clicked_at,
        expires_at: row.expires_at,
        sent_at: row.sent_at,
        delivered_at: row.delivered_at,
        status: row.status,
        created_by: row.created_by,
      })
      .then(({ error }) => {
        if (error) {
          console.error("[NotificationRepository] Error inserting notification to Supabase:", error);
        }
      });

    return row;
  }

  public static update(
    id: string,
    updates: Partial<SQLiteRow<AppNotification>>,
    lastModifiedBy = "user"
  ): SQLiteRow<AppNotification> | null {
    const uuidId = toUuid(id);
    const idx = notifications.findIndex((n) => n.id === id || n.id === uuidId);
    if (idx === -1) return null;
    const now = new Date().toISOString();
    notifications[idx] = {
      ...notifications[idx],
      ...updates,
      updated_at: now,
      last_modified_by: lastModifiedBy,
    } as any;
    notify();

    // Async update on Supabase
    const dbUpdates: Record<string, any> = {};
    if (updates.read_at !== undefined) dbUpdates.read_at = updates.read_at;
    if (updates.clicked_at !== undefined) dbUpdates.clicked_at = updates.clicked_at;
    if (updates.archived_at !== undefined) dbUpdates.archived_at = updates.archived_at;
    if (updates.deleted_at !== undefined) dbUpdates.deleted_at = updates.deleted_at;
    if (updates.status !== undefined) dbUpdates.status = updates.status;

    const supabase = getSupabase();
    supabase
      .from("notifications")
      .update(dbUpdates)
      .eq("id", uuidId)
      .then(({ error }) => {
        if (error) {
          console.error("[NotificationRepository] Error updating notification on Supabase:", error);
        }
      });

    return notifications[idx];
  }

  public static markAsRead(id: string, lastModifiedBy = "user"): boolean {
    const row = this.update(id, { read_at: new Date().toISOString() }, lastModifiedBy);
    return !!row;
  }

  public static markAsClicked(id: string, lastModifiedBy = "user"): boolean {
    const now = new Date().toISOString();
    const row = this.update(id, { clicked_at: now, read_at: now }, lastModifiedBy);
    return !!row;
  }

  public static markAllAsRead(lastModifiedBy = "user"): void {
    const now = new Date().toISOString();
    notifications = notifications.map((n) => {
      if (!n.read_at && !n.archived_at && !n.deleted_at) {
        return { ...n, read_at: now, updated_at: now, last_modified_by: lastModifiedBy };
      }
      return n;
    });
    notify();

    // Async update on Supabase
    const activeBizId = useBusinessStore.getState().activeBusinessId;
    if (activeBizId) {
      const supabase = getSupabase();
      supabase
        .from("notifications")
        .update({ read_at: now })
        .eq("business_id", toUuid(activeBizId))
        .is("read_at", null)
        .then(({ error }) => {
          if (error) {
            console.error("[NotificationRepository] Error marking all read on Supabase:", error);
          }
        });
    }
  }

  public static archive(id: string, lastModifiedBy = "user"): boolean {
    const row = this.update(id, { archived_at: new Date().toISOString() }, lastModifiedBy);
    return !!row;
  }

  public static delete(id: string, lastModifiedBy = "user"): boolean {
    const uuidId = toUuid(id);
    const idx = notifications.findIndex((n) => n.id === id || n.id === uuidId);
    if (idx === -1) return false;
    const now = new Date().toISOString();
    notifications[idx] = {
      ...notifications[idx],
      deleted_at: now,
      updated_at: now,
      last_modified_by: lastModifiedBy,
    };
    notify();

    // Async update on Supabase
    const supabase = getSupabase();
    supabase
      .from("notifications")
      .update({ deleted_at: now })
      .eq("id", uuidId)
      .then(({ error }) => {
        if (error) {
          console.error("[NotificationRepository] Error deleting notification on Supabase:", error);
        }
      });

    return true;
  }

  public static subscribe(callback: (notifications: SQLiteRow<AppNotification>[]) => void): () => void {
    subscribers.add(callback);
    // Initial call
    const active = notifications
      .filter((n) => !n.archived_at && !n.deleted_at)
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    callback(active);
    return () => {
      subscribers.delete(callback);
    };
  }
}
