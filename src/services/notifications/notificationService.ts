import { NotificationRepository } from "./notificationRepository";
import { NotificationTemplates } from "./notificationTemplates";
import { pushNotificationService } from "./pushNotificationService";
import { NotificationPreferences } from "./notificationPreferences";
import { AppNotification, NotificationType, NotificationPriority, NotificationActionTarget } from "../../types";

export class NotificationService {
  /**
   * Generates and registers a new notification. Stores in Supabase database, then pushes via FCM/APNs.
   * Only important events are allowed to generate notifications.
   */
  public static createNotification(
    type: NotificationType,
    params: Record<string, string | number>,
    options?: {
      title?: string;
      priority?: NotificationPriority;
      actionTarget?: NotificationActionTarget;
      role?: string | null;
      userId?: string | null;
      createdBy?: string;
      payloadExtra?: Record<string, any>;
    }
  ): AppNotification | null {
    // 1. Enforce reduction of in-app notifications (Only allow important events)
    const IMPORTANT_TYPES: NotificationType[] = [
      "Stock Almost Finished",
      "Out Of Stock",
      "Low Cash Balance",
      "Debt Due Reminder",
      "Delivery Assigned",
      "Delivery Completed",
      "Payment Received",
      "Role Invitation",
      "Account Activity",
      "System Update",
      "AI Business Insight",
      "AI Recommendation",
      "AI Risk Alert",
      "Custom Notification",
    ];

    if (!IMPORTANT_TYPES.includes(type)) {
      console.log(`[NotificationService] Skipping routine/non-important notification type: "${type}"`);
      return null;
    }

    // 2. Check if type is enabled in preferences
    const isEnabled = NotificationPreferences.isTypeEnabled(type);
    if (!isEnabled) {
      console.log(`Notification of type "${type}" skipped because it is disabled in preferences.`);
      return null;
    }

    // 3. Render Template
    const rendered = NotificationTemplates.render(type, params, {
      title: options?.title,
      priority: options?.priority,
      actionTarget: options?.actionTarget,
    });

    const payloadObj = {
      ...options?.payloadExtra,
      renderedAt: new Date().toISOString(),
    };

    const newNotif: Omit<
      AppNotification,
      "created_at" | "updated_at" | "deleted_at" | "version" | "sync_status" | "last_modified_by"
    > = {
      id: `notif-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      business_id: "all",
      user_id: options?.userId || null,
      role: options?.role || "Owner",
      title: rendered.title,
      message: rendered.message,
      type,
      priority: rendered.priority,
      action_type: rendered.actionTarget !== "none" ? "navigate" : "none",
      action_target: rendered.actionTarget,
      payload: JSON.stringify(payloadObj),
      read_at: null,
      clicked_at: null,
      expires_at: null,
      sent_at: new Date().toISOString(),
      delivered_at: new Date().toISOString(),
      status: "delivered",
      created_by: options?.createdBy || "system",
    };

    // 4. Save to Repository (which automatically syncs to Supabase PostgreSQL database)
    // NOTE: The Supabase Dashboard Webhook (INSERT on public.notifications) already
    // calls the send-fcm Edge Function automatically. Do NOT call send-fcm here as well,
    // that would cause every notification to fire TWICE on the user's device.
    const row = NotificationRepository.add(newNotif);

    // 5. Show local in-app banner only (FCM push handled exclusively by DB webhook)
    pushNotificationService.handleIncomingPush(row);

    return row;
  }

  /**
   * Helper to create beautiful AI business insights
   */
  public static createAINotification(
    title: string,
    message: string,
    priority: NotificationPriority = "medium",
    confidenceScore: number = 90,
    recommendedAction: string = "Review business trends",
    insightText?: string
  ): AppNotification | null {
    const payloadExtra = {
      confidenceScore,
      recommendedAction,
      insightText: insightText || message,
    };

    return this.createNotification("AI Business Insight", {
      insightText: message,
      confidenceScore,
    }, {
      title: `🤖 ${title}`,
      priority,
      actionTarget: "ai_insight",
      createdBy: "ai_engine",
      payloadExtra,
    });
  }

  /**
   * Helper to create inventory alert notifications
   */
  public static createInventoryAlert(
    productName: string,
    currentStock: number,
    minStock: number,
    unit: string,
    isOutOfStock = false
  ): AppNotification | null {
    if (isOutOfStock) {
      return this.createNotification("Out Of Stock", {
        productName
      }, {
        role: "Owner",
      });
    }

    return this.createNotification("Stock Almost Finished", {
      productName,
      currentStock,
      minStock,
      unit,
    }, {
      role: "Owner",
    });
  }

  /**
   * Helper to create delivery updates
   */
  public static createDeliveryNotification(
    riderName: string,
    customerName: string,
    type: "assigned" | "completed"
  ): AppNotification | null {
    if (type === "assigned") {
      return this.createNotification("Delivery Assigned", {
        customerName,
        address: "Nairobi Dairy Route",
        finalTotal: "1,500"
      }, {
        role: "Rider"
      });
    }

    return this.createNotification("Delivery Completed", {
      riderName,
      customerName,
    }, {
      role: "Owner"
    });
  }

  /**
   * Marks notification as read
   */
  public static markAsRead(id: string): void {
    NotificationRepository.markAsRead(id);
  }

  /**
   * Marks notification as clicked
   */
  public static markAsClicked(id: string): void {
    NotificationRepository.markAsClicked(id);
  }

  /**
   * Marks all read
   */
  public static markAllRead(): void {
    NotificationRepository.markAllAsRead();
  }

  /**
   * Archives a notification
   */
  public static archive(id: string): void {
    NotificationRepository.archive(id);
  }

  /**
   * Unarchives a notification
   */
  public static unarchive(id: string): void {
    NotificationRepository.update(id, { archived_at: null });
  }

  /**
   * Soft deletes a notification
   */
  public static delete(id: string): void {
    NotificationRepository.delete(id);
  }

  /**
   * Restores a soft-deleted notification
   */
  public static restore(id: string): void {
    NotificationRepository.update(id, { deleted_at: null });
  }
}
export default NotificationService;
