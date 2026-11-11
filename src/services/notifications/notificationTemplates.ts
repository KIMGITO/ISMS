// src/services/notifications/notificationTemplates.ts
import { NotificationType, NotificationPriority, NotificationActionTarget } from "../../types";

export interface NotificationTemplate {
  type: NotificationType;
  defaultTitle: string;
  defaultMessageTemplate: string;
  defaultPriority: NotificationPriority;
  defaultActionTarget: NotificationActionTarget;
}

export const NOTIFICATION_TEMPLATES: Record<NotificationType, NotificationTemplate> = {
  "Stock Almost Finished": {
    type: "Stock Almost Finished",
    defaultTitle: "Running low",
    defaultMessageTemplate: "{productName}: {currentStock} {unit} left (you restock at {minStock}).",
    defaultPriority: "high",
    defaultActionTarget: "inventory",
  },
  "Stock Transfer": {
    type: "Stock Transfer",
    defaultTitle: "Stock on the way",
    defaultMessageTemplate: "{message}",
    defaultPriority: "high",
    defaultActionTarget: "stock-transfers",
  },
  "Out Of Stock": {
    type: "Out Of Stock",
    defaultTitle: "Out of stock",
    defaultMessageTemplate: "{productName} is out of stock.",
    defaultPriority: "critical",
    defaultActionTarget: "inventory",
  },
  "Low Cash Balance": {
    type: "Low Cash Balance",
    defaultTitle: "Cash drawer is low",
    defaultMessageTemplate: "The cash drawer has KSh {currentBalance}.",
    defaultPriority: "medium",
    defaultActionTarget: "sales",
  },
  "Debt Due Reminder": {
    type: "Debt Due Reminder",
    defaultTitle: "Debt reminder",
    defaultMessageTemplate: "{customerName} owes KSh {debtBalance}, due {dueDate}.",
    defaultPriority: "high",
    defaultActionTarget: "customer_debt",
  },
  "Delivery Assigned": {
    type: "Delivery Assigned",
    defaultTitle: "New delivery",
    defaultMessageTemplate: "Deliver to {customerName}{address}. Order total KSh {finalTotal}.",
    defaultPriority: "medium",
    defaultActionTarget: "delivery",
  },
  "Delivery Completed": {
    type: "Delivery Completed",
    defaultTitle: "Delivered",
    defaultMessageTemplate: "{riderName} delivered to {customerName}.",
    defaultPriority: "medium",
    defaultActionTarget: "delivery",
  },
  "Payment Received": {
    type: "Payment Received",
    defaultTitle: "Payment received",
    defaultMessageTemplate: "KSh {amount} received by {paymentMethod}{fromCustomer}.",
    defaultPriority: "medium",
    defaultActionTarget: "sales",
  },
  // A sale on credit is a debt, not money received.
  "Credit Sale": {
    type: "Credit Sale",
    defaultTitle: "Sold on credit",
    defaultMessageTemplate: "{customerName} took KSh {amount} on credit. They now owe KSh {debtBalance}.",
    defaultPriority: "medium",
    defaultActionTarget: "customer_debt",
  },
  "Sales Summary": {
    type: "Sales Summary",
    defaultTitle: "Sales summary",
    defaultMessageTemplate: "{date}: KSh {totalSales} from {txCount} sales.",
    defaultPriority: "medium",
    defaultActionTarget: "sales",
  },
  "Daily Report": {
    type: "Daily Report",
    defaultTitle: "Daily report",
    defaultMessageTemplate: "Revenue KSh {revenue}, profit margin {profitMargin}%.",
    defaultPriority: "medium",
    defaultActionTarget: "sales",
  },
  "Weekly Report": {
    type: "Weekly Report",
    defaultTitle: "Weekly report",
    defaultMessageTemplate: "Sales KSh {totalSales}, {activeCustomers} active customers.",
    defaultPriority: "medium",
    defaultActionTarget: "sales",
  },
  "Monthly Report": {
    type: "Monthly Report",
    defaultTitle: "Monthly report",
    defaultMessageTemplate: "Revenue this month: KSh {revenue}.",
    defaultPriority: "medium",
    defaultActionTarget: "sales",
  },
  "Scheduled Reminder": {
    type: "Scheduled Reminder",
    defaultTitle: "Reminder",
    defaultMessageTemplate: "{taskTitle} starts now.",
    defaultPriority: "low",
    defaultActionTarget: "none",
  },
  "AI Business Insight": {
    type: "AI Business Insight",
    defaultTitle: "Business insight",
    defaultMessageTemplate: "{insightText}",
    defaultPriority: "medium",
    defaultActionTarget: "ai_insight",
  },
  "AI Recommendation": {
    type: "AI Recommendation",
    defaultTitle: "Suggestion",
    defaultMessageTemplate: "{recommendationText} {suggestedAction}",
    defaultPriority: "medium",
    defaultActionTarget: "ai_insight",
  },
  "AI Risk Alert": {
    type: "AI Risk Alert",
    defaultTitle: "Risk alert",
    defaultMessageTemplate: "{riskText}. {actionText}",
    defaultPriority: "high",
    defaultActionTarget: "ai_insight",
  },
  "System Update": {
    type: "System Update",
    defaultTitle: "App updated",
    defaultMessageTemplate: "Now on version {version}.",
    defaultPriority: "low",
    defaultActionTarget: "none",
  },
  "Role Invitation": {
    type: "Role Invitation",
    defaultTitle: "Invitation",
    defaultMessageTemplate: "You are invited to join {businessName} as {roleName}.",
    defaultPriority: "high",
    defaultActionTarget: "none",
  },
  "Account Activity": {
    type: "Account Activity",
    defaultTitle: "New sign-in",
    defaultMessageTemplate: "Signed in on {deviceInfo} at {timestamp}.",
    defaultPriority: "medium",
    defaultActionTarget: "none",
  },
  "Business Announcement": {
    type: "Business Announcement",
    defaultTitle: "Announcement",
    defaultMessageTemplate: "{announcementTitle}: {announcementBody}",
    defaultPriority: "low",
    defaultActionTarget: "none",
  },
  "Custom Notification": {
    type: "Custom Notification",
    defaultTitle: "Notification",
    defaultMessageTemplate: "{message}",
    defaultPriority: "low",
    defaultActionTarget: "none",
  },
};

export class NotificationTemplates {
  /**
   * Builds an AppNotification payload by injecting variables into templates
   */
  public static render(
    type: NotificationType,
    params: Record<string, string | number>,
    overrides?: { title?: string; priority?: NotificationPriority; actionTarget?: NotificationActionTarget }
  ): { title: string; message: string; priority: NotificationPriority; actionTarget: NotificationActionTarget } {
    const template = NOTIFICATION_TEMPLATES[type] || NOTIFICATION_TEMPLATES["Custom Notification"];
    
    let message = template.defaultMessageTemplate;
    Object.entries(params).forEach(([key, val]) => {
      message = message.split(`{${key}}`).join(String(val));
    });
    // A value that was not given is left out rather than shown as "{name}".
    message = message.replace(/\{[a-zA-Z]+\}/g, "").replace(/\s+([.,])/g, "$1").replace(/\s{2,}/g, " ").trim();

    return {
      title: overrides?.title || template.defaultTitle,
      message,
      priority: overrides?.priority || template.defaultPriority,
      actionTarget: overrides?.actionTarget || template.defaultActionTarget,
    };
  }
}
