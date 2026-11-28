// src/core/native/NotificationService.ts
import { LocalNotifications } from "@capacitor/local-notifications";
import { PushNotifications } from "@capacitor/push-notifications";
import { Capacitor, registerPlugin } from "@capacitor/core";
import { nativePlatformService } from "./NativePlatformService";
import { SupabaseService } from "../../services/supabaseService";
import { NotificationToneService } from "../../services/notifications/notificationTone";

export interface ScheduledReminder {
  id: number;
  title: string;
  body: string;
  scheduleAt: Date;
  extra?: any;
}

const PushSupport = registerPlugin<{ isAvailable(): Promise<{ available: boolean }> }>("PushSupport");
let pushAvailable: Promise<boolean> | null = null;

/**
 * Whether this build can use push notifications.
 * On Android, push needs Firebase (google-services.json at build time). Without it,
 * PushNotifications.register() crashes the whole app natively, beyond any try/catch,
 * so always check this first.
 */
export function isPushAvailable(): Promise<boolean> {
  if (!pushAvailable) {
    pushAvailable =
      Capacitor.getPlatform() !== "android"
        ? Promise.resolve(Capacitor.isNativePlatform())
        : PushSupport.isAvailable()
            .then((r) => r.available === true)
            .catch(() => false);
  }
  return pushAvailable;
}

type PushRegistrationCallback = (token: string) => void;
type PushReceivedCallback = (notification: any) => void;

class NotificationService {
  private registrationListeners: Set<PushRegistrationCallback> = new Set();
  private receiveListeners: Set<PushReceivedCallback> = new Set();
  private currentPushToken: string | null = null;
  /** Why push is or isn't working on this device, for the Settings health check. */
  public pushState: "unknown" | "unsupported" | "no-firebase" | "denied" | "requested" | "registered" | "error" = "unknown";

  constructor() {
    this.initPushListeners();
  }

  // ==========================================
  // PUSH NOTIFICATIONS
  // ==========================================

  private initPushListeners() {
    if (!nativePlatformService.isNative()) return;

    try {
      // Token registration success
      PushNotifications.addListener("registration", (token) => {
        console.log("[PUSH_REGISTRATION] FCM token received");
        this.currentPushToken = token.value;
        this.pushState = "registered";
        this.registrationListeners.forEach((l) => l(token.value));

        // Saved for the signed-in person, with this phone's notification tone. register() runs
        // on every start, so a refreshed token is saved the next time the app opens.
        this.saveToken(token.value);
      });

      // Token registration failure (no Google Play services, no network, bad Firebase config)
      PushNotifications.addListener("registrationError", (error) => {
        this.pushState = "error";
        console.error("[PUSH_REGISTRATION] Push registration failed:", error);
      });

      // Notification received while app is open / in foreground
      PushNotifications.addListener("pushNotificationReceived", (notification) => {
        console.log("[PushNotifications] Push received in foreground");
        this.receiveListeners.forEach((l) => l(notification));
      });

      // User tapped a notification that was shown in the system tray
      PushNotifications.addListener("pushNotificationActionPerformed", (action) => {
        console.log("[PushNotifications] Notification tapped");
        this.receiveListeners.forEach((l) => l(action.notification));
      });

    } catch (e) {
      console.warn("[PushNotifications] Failed initializing push notification native listeners:", e);
    }
  }

  /**
   * Saves the token, retrying: right after start-up the sign-in session may not be attached to
   * requests yet ("permission denied"), and the phone may still be connecting.
   */
  private async saveToken(token: string): Promise<void> {
    const delays = [0, 3000, 10000, 30000, 120000];
    for (const delay of delays) {
      if (delay) await new Promise((r) => setTimeout(r, delay));
      if (this.currentPushToken !== token) return; // replaced by a newer token
      try {
        if (await SupabaseService.registerDeviceToken(token, Capacitor.getPlatform(), NotificationToneService.getNativeSoundName())) return;
      } catch (err) {
        console.error("[PUSH_REGISTRATION] Failed to save FCM token:", err);
      }
    }
  }

  public async registerPush(): Promise<boolean> {
    if (!nativePlatformService.isNative()) {
      this.pushState = "unsupported";
      return false;
    }
    if (!(await isPushAvailable())) {
      // The APK was built without google-services.json (in CI: the GOOGLE_SERVICES_JSON secret).
      this.pushState = "no-firebase";
      console.error("[PUSH_REGISTRATION] This build has no Firebase config, so push is off.");
      // Phone alarms don't need push, but on Android 13+ they need this to show at all.
      try {
        const perm = await LocalNotifications.checkPermissions();
        if (perm.display === "prompt" || perm.display === "prompt-with-rationale") await LocalNotifications.requestPermissions();
      } catch {
        // ignore
      }
      return false;
    }

    try {
      let perm = await PushNotifications.checkPermissions();
      if (perm.receive !== "granted") {
        perm = await PushNotifications.requestPermissions();
      }
      if (perm.receive === "granted") {
        // Channels are created natively at start-up (NotificationChannels.java).
        await PushNotifications.register();
        if (this.pushState !== "registered") this.pushState = "requested";
        return true;
      }
      this.pushState = "denied";
      console.warn("[PUSH_REGISTRATION] notification permission:", perm.receive);
      return false;
    } catch (e) {
      console.error("[PushNotifications] Failed registering push notification permissions:", e);
      return false;
    }
  }

  public getPushToken(): string | null {
    return this.currentPushToken;
  }

  public onPushRegistered(callback: PushRegistrationCallback): () => void {
    this.registrationListeners.add(callback);
    if (this.currentPushToken) {
      callback(this.currentPushToken);
    }
    return () => this.registrationListeners.delete(callback);
  }

  public onPushReceived(callback: PushReceivedCallback): () => void {
    this.receiveListeners.add(callback);
    return () => this.receiveListeners.delete(callback);
  }

  // ==========================================
  // LOCAL NOTIFICATIONS
  // ==========================================

  /**
   * Post a local system notification instantly
   */
  public async sendLocalNotification(title: string, body: string, id = Math.floor(Math.random() * 100000)): Promise<void> {
    if (!nativePlatformService.isNative()) {
      this.sendLocalNotificationWeb(title, body);
      return;
    }

    try {
      const permStatus = await LocalNotifications.checkPermissions();
      if (permStatus.display !== "granted") {
        await LocalNotifications.requestPermissions();
      }

      const selectedSound = NotificationToneService.getNativeSoundName();

      await LocalNotifications.schedule({
        notifications: [
          {
            id,
            title,
            body,
            schedule: { at: new Date(Date.now() + 50) },
            sound: selectedSound,
            actionTypeId: "OPEN_ACTION"
          }
        ]
      });
    } catch (e) {
      console.error("[LocalNotifications] Native local notification failed:", e);
      this.sendLocalNotificationWeb(title, body);
    }
  }

  /**
   * Schedule a future local notification reminder
   */
  public async scheduleReminder(reminder: ScheduledReminder): Promise<boolean> {
    if (!nativePlatformService.isNative()) {
      console.log(`Reminder scheduled (Web fallback simulation) for ${reminder.scheduleAt.toISOString()}: ${reminder.title}`);
      return true;
    }

    try {
      const permStatus = await LocalNotifications.checkPermissions();
      if (permStatus.display !== "granted") {
        await LocalNotifications.requestPermissions();
      }

      const selectedSound = NotificationToneService.getNativeSoundName();

      await LocalNotifications.schedule({
        notifications: [
          {
            id: reminder.id,
            title: reminder.title,
            body: reminder.body,
            schedule: { at: reminder.scheduleAt },
            sound: selectedSound,
            extra: reminder.extra
          }
        ]
      });
      return true;
    } catch (e) {
      console.error("[LocalNotifications] Native local reminder scheduling failed:", e);
      return false;
    }
  }

  /**
   * Cancel pending scheduled local notification reminders
   */
  public async cancelReminders(ids: number[]): Promise<void> {
    if (!nativePlatformService.isNative()) return;
    try {
      await LocalNotifications.cancel({
        notifications: ids.map(id => ({ id }))
      });
    } catch (e) {
      console.error("[LocalNotifications] Native reminder cancelation failed:", e);
    }
  }

  private sendLocalNotificationWeb(title: string, body: string) {
    if (typeof window !== "undefined" && "Notification" in window && Notification.permission === "granted") {
      try {
        new Notification(title, { body, icon: "/icon.png", badge: "/denso-badge.png" });
      } catch (e) {
        console.warn("[Notification] Browser HTML5 Notification block prevented launch:", e);
      }
    } else {
      console.log(`[Notification Fallback]: ${title} - ${body}`);
    }
  }
}

export const notificationService = new NotificationService();
export default notificationService;
