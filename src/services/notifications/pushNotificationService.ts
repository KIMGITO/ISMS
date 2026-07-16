// src/services/notifications/pushNotificationService.ts
import { AppNotification } from "../../types";
import { SupabaseService } from "../supabaseService";

export type PushSubscriptionCallback = (token: string) => void;
export type PushNotificationCallback = (notification: AppNotification) => void;

class PushNotificationService {
  private deviceToken: string | null = null;
  private notificationListeners: Set<PushNotificationCallback> = new Set();
  private registrationListeners: Set<PushSubscriptionCallback> = new Set();
  private isPushSupported = false;

  constructor() {
    this.checkSupport();
    this.initNativeListeners();
  }

  private checkSupport() {
    if (typeof window !== "undefined") {
      this.isPushSupported = "Notification" in window || !!(window as any).Capacitor;
    }
  }

  private initNativeListeners() {
    if (typeof window === "undefined") return;
    const cap = (window as any).Capacitor;
    if (cap) {
      try {
        const { PushNotifications } = cap.Plugins;
        if (PushNotifications) {
          PushNotifications.addListener("registration", (token: any) => {
            console.log("Capacitor FCM/APNs Registration Token:", token.value);
            this.deviceToken = token.value;
            SupabaseService.registerDeviceToken(token.value, "capacitor");
            this.registrationListeners.forEach((listener) => listener(token.value));
          });

          PushNotifications.addListener("registrationError", (err: any) => {
            console.error("Capacitor Push Registration Error:", err);
          });

          PushNotifications.addListener("pushNotificationReceived", (notification: any) => {
            console.log("Push received while app open / background:", notification);
            const parsedNotif = this.parseCapacitorPush(notification);
            if (parsedNotif) {
              this.handleIncomingPush(parsedNotif);
            }
          });

          PushNotifications.addListener("pushNotificationActionPerformed", (action: any) => {
            console.log("Push action clicked:", action);
            const parsedNotif = this.parseCapacitorPush(action.notification);
            if (parsedNotif) {
              this.handlePushClick(parsedNotif);
            }
          });
        }
      } catch (err) {
        console.warn("Failed to initialize Capacitor Push Notification plugins:", err);
      }
    }
  }

  private parseCapacitorPush(capNotif: any): AppNotification | null {
    if (!capNotif) return null;
    try {
      const data = capNotif.data || {};
      return {
        id: capNotif.id || `push-${Date.now()}`,
        business_id: data.business_id || "all",
        user_id: data.user_id || null,
        role: data.role || null,
        title: capNotif.title || data.title || "KayKay Dairy Alert",
        message: capNotif.body || data.message || "",
        type: data.type || "Custom Notification",
        priority: data.priority || "medium",
        action_type: data.action_type || "navigate",
        action_target: data.action_target || "none",
        payload: data.payload || "{}",
        read_at: null,
        clicked_at: null,
        created_at: new Date().toISOString(),
        expires_at: null,
        sent_at: new Date().toISOString(),
        delivered_at: new Date().toISOString(),
        status: "delivered",
        created_by: data.created_by || "system",
      };
    } catch {
      return null;
    }
  }

  /**
   * Requests push notification permissions and registers device with APNs/FCM or Web Push.
   */
  public async requestPermissions(): Promise<boolean> {
    if (typeof window === "undefined") return false;
    const cap = (window as any).Capacitor;

    // 1. Mobile Native App via Capacitor
    if (cap) {
      try {
        const { PushNotifications } = cap.Plugins;
        if (PushNotifications) {
          let permStatus = await PushNotifications.checkPermissions();
          if (permStatus.receive === "prompt") {
            permStatus = await PushNotifications.requestPermissions();
          }
          if (permStatus.receive === "granted") {
            await PushNotifications.register();
            return true;
          }
        }
      } catch (err) {
        console.error("Capacitor request permission failed:", err);
      }
    }

    // 2. Web Browser Fallback (Web Push API)
    if (typeof window !== "undefined" && "Notification" in window) {
      try {
        const permission = await Notification.requestPermission();
        if (permission === "granted") {
          // Mock token generation for Web Push
          this.deviceToken = `web-push-token-${Math.random().toString(36).substring(2, 15)}`;
          SupabaseService.registerDeviceToken(this.deviceToken, "web");
          this.registrationListeners.forEach((listener) => listener(this.deviceToken!));
          return true;
        }
      } catch (err) {
        console.error("Web Notification API request permission failed:", err);
      }
    }

    return false;
  }

  /**
   * Subscribes to notification click/deep link actions
   */
  public onNotificationClick(callback: PushNotificationCallback) {
    this.notificationListeners.add(callback);
    return () => {
      this.notificationListeners.delete(callback);
    };
  }

  /**
   * Subscribes to device registration token events
   */
  public onRegistrationComplete(callback: PushSubscriptionCallback) {
    this.registrationListeners.add(callback);
    if (this.deviceToken) {
      callback(this.deviceToken);
    }
    return () => {
      this.registrationListeners.delete(callback);
    };
  }

  /**
   * Receives incoming notifications, displays them natively on device if supported, and runs logic.
   */
  public handleIncomingPush(notification: AppNotification) {
    // 1. Play standard notification sound / haptic feedback
    try {
      if (typeof window !== "undefined" && "vibrate" in navigator) {
        navigator.vibrate([100, 50, 100]);
      }
    } catch {}

    // 2. Display System Notification via HTML5 Notification (Web Push fallback)
    if (typeof window !== "undefined" && "Notification" in window && Notification.permission === "granted") {
      try {
        new Notification(notification.title, {
          body: notification.message,
          icon: "/favicon.ico",
          tag: notification.id,
          requireInteraction: notification.priority === "high" || notification.priority === "critical",
        });
      } catch (err) {
        console.warn("Unable to trigger active Web system notification:", err);
      }
    }

    // 3. Update Launcher App Badge Count
    this.incrementBadgeCount();

    // 4. Notify app listeners
    this.notificationListeners.forEach((listener) => {
      try {
        listener(notification);
      } catch (err) {
        console.error("Error in push listener:", err);
      }
    });
  }

  public handlePushClick(notification: AppNotification) {
    console.log("App opened via push notification:", notification);
    this.notificationListeners.forEach((listener) => {
      try {
        listener(notification);
      } catch (err) {
        console.error("Error in click notification handler:", err);
      }
    });
  }

  /**
   * Increments application badge count (supported on mobile native and compatible web browsers)
   */
  public incrementBadgeCount() {
    if (typeof navigator !== "undefined" && "setAppBadge" in navigator) {
      try {
        const unreadCount = this.getUnreadCount();
        (navigator as any).setAppBadge(unreadCount + 1);
      } catch {}
    }
  }

  /**
   * Clears application badge count
   */
  public clearBadge() {
    if (typeof navigator !== "undefined" && "clearAppBadge" in navigator) {
      try {
        (navigator as any).clearAppBadge();
      } catch {}
    }
  }

  private getUnreadCount(): number {
    try {
      const db = localStorage.getItem("kkm_sqlite_db_v2");
      if (db) {
        const parsed = JSON.parse(db);
        const notifications = parsed.notifications || {};
        return Object.values(notifications).filter((n: any) => n.read_at === null && n.deleted_at === null).length;
      }
    } catch {}
    return 0;
  }

  public getDeviceToken(): string | null {
    return this.deviceToken;
  }

  public getIsSupported(): boolean {
    return this.isPushSupported;
  }

}

export const pushNotificationService = new PushNotificationService();
export default pushNotificationService;
