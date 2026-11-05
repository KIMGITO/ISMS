// src/services/notifications/notificationPreferences.ts
// Reads and changes this person's notification settings. The database owns the rules and also
// applies them to pushes; this copy decides what the inbox shows.

import { AppNotification } from "../../types";
import { getSupabase } from "../supabaseClient";

export interface NotificationCategorySetting {
  category: string;
  types: string[];
  locked: boolean;
  followsRole: boolean;
  enabled: boolean;
}

export interface NotificationSettings {
  userId: string;
  role: string;
  paused: boolean;
  categories: NotificationCategorySetting[];
  hiddenTypes: string[];
}

const CACHE_KEY = "kkm_notification_settings_v2";

let settings: NotificationSettings | null = null;

function remember(businessId: string, value: NotificationSettings) {
  settings = value;
  try {
    localStorage.setItem(`${CACHE_KEY}:${businessId}`, JSON.stringify(value));
  } catch {
    // The saved copy only helps when offline.
  }
}

function recall(businessId: string): NotificationSettings | null {
  try {
    const saved = localStorage.getItem(`${CACHE_KEY}:${businessId}`);
    return saved ? JSON.parse(saved) : null;
  } catch {
    return null;
  }
}

export class NotificationPreferences {
  public static get(): NotificationSettings | null {
    return settings;
  }

  public static async load(businessId: string): Promise<NotificationSettings | null> {
    const { data, error } = await getSupabase().rpc("get_my_notification_settings", {
      p_business_id: businessId,
    });
    if (error) {
      console.error("Could not load notification settings:", error);
      settings = settings ?? recall(businessId);
      return settings;
    }
    remember(businessId, data as NotificationSettings);
    return settings;
  }

  /** Pass "all" as the category to pause or resume everything that can be turned off. */
  public static async set(businessId: string, category: string, enabled: boolean): Promise<void> {
    const { error } = await getSupabase().rpc("set_my_notification_setting", {
      p_business_id: businessId,
      p_category: category,
      p_enabled: enabled,
    });
    if (error) throw error;
    await this.load(businessId);
  }

  private static categoryFor(type: string, direct: boolean): NotificationCategorySetting | undefined {
    // A rider's assignment is stored as "Online Store", but to them it's a delivery.
    if (type === "Online Store" && direct) {
      return settings?.categories.find((c) => c.category === "deliveries");
    }
    return settings?.categories.find((c) => c.types.includes(type));
  }

  /** Before settings load, nothing is hidden, because a missed alert costs more than an extra one. */
  public static isTypeEnabled(type: string, direct = false): boolean {
    if (!settings) return true;
    if (!direct && settings.hiddenTypes.includes(type)) return false;
    const category = this.categoryFor(type, direct);
    if (!category) return true;
    if (category.locked) return true;
    return !settings.paused && category.enabled;
  }

  public static shouldShow(notification: Pick<AppNotification, "type" | "user_id" | "role">): boolean {
    if (!settings) return true;
    const direct = !!notification.user_id;
    if (direct && notification.user_id !== settings.userId) return false;
    if (!direct && notification.role) {
      const category = this.categoryFor(notification.type, false);
      const followsRole = !category || category.followsRole;
      if (followsRole && !settings.hiddenTypes.includes(notification.type)
          && notification.role.toLowerCase() !== settings.role.toLowerCase()) {
        return false;
      }
    }
    return this.isTypeEnabled(notification.type, direct);
  }
}
