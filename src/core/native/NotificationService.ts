// src/core/native/NotificationService.ts
import { LocalNotifications } from "@capacitor/local-notifications";
import { PushNotifications } from "@capacitor/push-notifications";
import { nativePlatformService } from "./NativePlatformService";

export interface ScheduledReminder {
  id: number;
  title: string;
  body: string;
  scheduleAt: Date;
  extra?: any;
}

type PushRegistrationCallback = (token: string) => void;
type PushReceivedCallback = (notification: any) => void;

class NotificationService {
  private registrationListeners: Set<PushRegistrationCallback> = new Set();
  private receiveListeners: Set<PushReceivedCallback> = new Set();
  private currentPushToken: string | null = null;

  constructor() {
    this.initPushListeners();
  }

  // ==========================================
  // PUSH NOTIFICATIONS
  // ==========================================

  private initPushListeners() {
    if (!nativePlatformService.isNative()) return;

    try {
      PushNotifications.addListener("registration", (token) => {
        this.currentPushToken = token.value;
        this.registrationListeners.forEach((l) => l(token.value));
      });

      PushNotifications.addListener("registrationError", (error) => {
        console.error("Push registration failed natively:", error);
      });

      PushNotifications.addListener("pushNotificationReceived", (notification) => {
        this.receiveListeners.forEach((l) => l(notification));
      });
    } catch (e) {
      console.warn("Failed initializing push notification native listeners:", e);
    }
  }

  public async registerPush(): Promise<boolean> {
    if (!nativePlatformService.isNative()) {
      return false;
    }

    try {
      let perm = await PushNotifications.checkPermissions();
      if (perm.receive !== "granted") {
        perm = await PushNotifications.requestPermissions();
      }
      if (perm.receive === "granted") {
        await PushNotifications.register();
        return true;
      }
      return false;
    } catch (e) {
      console.error("Failed registering push notification permissions:", e);
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

      await LocalNotifications.schedule({
        notifications: [
          {
            id,
            title,
            body,
            schedule: { at: new Date(Date.now() + 50) },
            sound: "beep.wav",
            actionTypeId: "OPEN_ACTION"
          }
        ]
      });
    } catch (e) {
      console.error("Native local notification failed:", e);
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

      await LocalNotifications.schedule({
        notifications: [
          {
            id: reminder.id,
            title: reminder.title,
            body: reminder.body,
            schedule: { at: reminder.scheduleAt },
            extra: reminder.extra
          }
        ]
      });
      return true;
    } catch (e) {
      console.error("Native local reminder scheduling failed:", e);
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
      console.error("Native reminder cancelation failed:", e);
    }
  }

  private sendLocalNotificationWeb(title: string, body: string) {
    if (typeof window !== "undefined" && "Notification" in window && Notification.permission === "granted") {
      try {
        new Notification(title, { body });
      } catch (e) {
        console.warn("Browser HTML5 Notification block prevented launch:", e);
      }
    } else {
      console.log(`[Notification Fallback]: ${title} - ${body}`);
    }
  }
}

export const notificationService = new NotificationService();
export default notificationService;
