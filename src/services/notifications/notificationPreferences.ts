// src/services/notifications/notificationPreferences.ts
import { NotificationPreference, NotificationType } from "../../types";

const PREFS_LOCAL_KEY = "kkm_notification_prefs_v1";
const BUSINESS_DEFAULTS_KEY = "kkm_business_default_prefs_v1";

const DEFAULT_PREFERENCES: NotificationPreference[] = [
  { category: "Stock Alerts", enabled: true },
  { category: "AI Insights", enabled: true },
  { category: "Sales Reports", enabled: true },
  { category: "Debt Reminders", enabled: true },
  { category: "Delivery Notifications", enabled: true },
  { category: "Payment Notifications", enabled: true },
  { category: "Scheduled Reminders", enabled: true },
  { category: "Announcements", enabled: true },
  { category: "System Notifications", enabled: true },
];

export class NotificationPreferences {
  /**
   * Retrieves the current user's preferences, falling back to business defaults or system defaults
   */
  public static getUserPreferences(): NotificationPreference[] {
    try {
      const userPrefs = localStorage.getItem(PREFS_LOCAL_KEY);
      if (userPrefs) {
        return JSON.parse(userPrefs);
      }
      
      const bizDefaults = localStorage.getItem(BUSINESS_DEFAULTS_KEY);
      if (bizDefaults) {
        return JSON.parse(bizDefaults);
      }

      return [...DEFAULT_PREFERENCES];
    } catch {
      return [...DEFAULT_PREFERENCES];
    }
  }

  /**
   * Saves the current user's overridden preferences
   */
  public static saveUserPreferences(prefs: NotificationPreference[]): void {
    try {
      localStorage.setItem(PREFS_LOCAL_KEY, JSON.stringify(prefs));
    } catch (err) {
      console.error("Failed to save user notification preferences:", err);
    }
  }

  /**
   * Saves the business default preferences (Owner only)
   */
  public static saveBusinessDefaults(prefs: NotificationPreference[]): void {
    try {
      localStorage.setItem(BUSINESS_DEFAULTS_KEY, JSON.stringify(prefs));
    } catch (err) {
      console.error("Failed to save business default preferences:", err);
    }
  }

  /**
   * Returns which category a given NotificationType maps to
   */
  public static getCategoryForType(type: NotificationType): string {
    switch (type) {
      case "Stock Almost Finished":
      case "Out Of Stock":
        return "Stock Alerts";
      case "AI Business Insight":
      case "AI Recommendation":
      case "AI Risk Alert":
        return "AI Insights";
      case "Sales Summary":
      case "Daily Report":
      case "Weekly Report":
      case "Monthly Report":
        return "Sales Reports";
      case "Debt Due Reminder":
        return "Debt Reminders";
      case "Delivery Assigned":
      case "Delivery Completed":
        return "Delivery Notifications";
      case "Payment Received":
      case "Low Cash Balance":
        return "Payment Notifications";
      case "Scheduled Reminder":
        return "Scheduled Reminders";
      case "Business Announcement":
      case "Role Invitation":
        return "Announcements";
      default:
        return "System Notifications";
    }
  }

  /**
   * Checks if a notification type is enabled for delivery under current user settings
   */
  public static isTypeEnabled(type: NotificationType): boolean {
    const category = this.getCategoryForType(type);
    const prefs = this.getUserPreferences();
    const pref = prefs.find((p) => p.category === category);
    return pref ? pref.enabled : true;
  }
}
