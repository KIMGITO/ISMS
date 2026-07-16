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
    defaultTitle: "⚠️ Low Stock Warning",
    defaultMessageTemplate: "The stock level of {productName} is low ({currentStock} {unit} left). Threshold: {minStock}.",
    defaultPriority: "high",
    defaultActionTarget: "inventory",
  },
  "Out Of Stock": {
    type: "Out Of Stock",
    defaultTitle: "🚨 Out of Stock Alert",
    defaultMessageTemplate: "CRITICAL: {productName} is now completely out of stock!",
    defaultPriority: "critical",
    defaultActionTarget: "inventory",
  },
  "Low Cash Balance": {
    type: "Low Cash Balance",
    defaultTitle: "⚠️ Low Cash Drawer Balance",
    defaultMessageTemplate: "Cash drawer balance is low: KSh {currentBalance}. Recommended to restock register.",
    defaultPriority: "medium",
    defaultActionTarget: "sales",
  },
  "Debt Due Reminder": {
    type: "Debt Due Reminder",
    defaultTitle: "📅 Debt Payment Reminder",
    defaultMessageTemplate: "Customer {customerName} owes KSh {debtBalance} with a due date of {dueDate}.",
    defaultPriority: "high",
    defaultActionTarget: "customer_debt",
  },
  "Delivery Assigned": {
    type: "Delivery Assigned",
    defaultTitle: "📦 New Delivery Assigned",
    defaultMessageTemplate: "You have been assigned to deliver to {customerName} at {address}. Total: KSh {finalTotal}.",
    defaultPriority: "medium",
    defaultActionTarget: "delivery",
  },
  "Delivery Completed": {
    type: "Delivery Completed",
    defaultTitle: "✅ Delivery Completed",
    defaultMessageTemplate: "Rider {riderName} has successfully completed the delivery to {customerName}.",
    defaultPriority: "medium",
    defaultActionTarget: "delivery",
  },
  "Payment Received": {
    type: "Payment Received",
    defaultTitle: "💰 Payment Received",
    defaultMessageTemplate: "A payment of KSh {amount} was received via {paymentMethod} for invoice #{txId}.",
    defaultPriority: "medium",
    defaultActionTarget: "sales",
  },
  "Sales Summary": {
    type: "Sales Summary",
    defaultTitle: "📊 Daily Sales Summary",
    defaultMessageTemplate: "Sales summary for {date}: Total Sales KSh {totalSales} across {txCount} transactions.",
    defaultPriority: "medium",
    defaultActionTarget: "sales",
  },
  "Daily Report": {
    type: "Daily Report",
    defaultTitle: "🗓️ Daily Business Performance",
    defaultMessageTemplate: "Your daily business report is ready. Revenue: KSh {revenue}, Profit Margin: {profitMargin}%.",
    defaultPriority: "medium",
    defaultActionTarget: "sales",
  },
  "Weekly Report": {
    type: "Weekly Report",
    defaultTitle: "📈 Weekly Business Performance",
    defaultMessageTemplate: "Your weekly performance report. Total sales: KSh {totalSales}. Active customers: {activeCustomers}.",
    defaultPriority: "medium",
    defaultActionTarget: "sales",
  },
  "Monthly Report": {
    type: "Monthly Report",
    defaultTitle: "🏆 Monthly Business Performance",
    defaultMessageTemplate: "Monthly report completed. Outstanding growth detected! Total Revenue: KSh {revenue}.",
    defaultPriority: "medium",
    defaultActionTarget: "sales",
  },
  "Scheduled Reminder": {
    type: "Scheduled Reminder",
    defaultTitle: "⏰ Scheduled Task Reminder",
    defaultMessageTemplate: "Friendly reminder: {taskTitle} is scheduled to start now.",
    defaultPriority: "low",
    defaultActionTarget: "none",
  },
  "AI Business Insight": {
    type: "AI Business Insight",
    defaultTitle: "🤖 AI Business Insight",
    defaultMessageTemplate: "{insightText} Confidence Score: {confidenceScore}%.",
    defaultPriority: "medium",
    defaultActionTarget: "ai_insight",
  },
  "AI Recommendation": {
    type: "AI Recommendation",
    defaultTitle: "💡 AI Action Recommendation",
    defaultMessageTemplate: "{recommendationText} Suggested Action: {suggestedAction}.",
    defaultPriority: "medium",
    defaultActionTarget: "ai_insight",
  },
  "AI Risk Alert": {
    type: "AI Risk Alert",
    defaultTitle: "🛡️ AI Business Risk Alert",
    defaultMessageTemplate: "CRITICAL: {riskText}. Recommended action: {actionText}.",
    defaultPriority: "high",
    defaultActionTarget: "ai_insight",
  },
  "System Update": {
    type: "System Update",
    defaultTitle: "⚡ System Software Update",
    defaultMessageTemplate: "KayKay Dairy POS has been upgraded to version {version}. Explore the new offline speed increases!",
    defaultPriority: "low",
    defaultActionTarget: "none",
  },
  "Role Invitation": {
    type: "Role Invitation",
    defaultTitle: "✉️ Business Role Invitation",
    defaultMessageTemplate: "You have been invited to join {businessName} as a {roleName}.",
    defaultPriority: "high",
    defaultActionTarget: "none",
  },
  "Account Activity": {
    type: "Account Activity",
    defaultTitle: "🔒 Account Security Activity",
    defaultMessageTemplate: "A new login was detected from {deviceInfo} at {timestamp}.",
    defaultPriority: "medium",
    defaultActionTarget: "none",
  },
  "Business Announcement": {
    type: "Business Announcement",
    defaultTitle: "📢 Business Announcement",
    defaultMessageTemplate: "{announcementTitle}: {announcementBody}",
    defaultPriority: "low",
    defaultActionTarget: "none",
  },
  "Custom Notification": {
    type: "Custom Notification",
    defaultTitle: "🔔 Notification",
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
      message = message.replace(new RegExp(`{${key}}`, "g"), String(val));
    });

    return {
      title: overrides?.title || template.defaultTitle,
      message,
      priority: overrides?.priority || template.defaultPriority,
      actionTarget: overrides?.actionTarget || template.defaultActionTarget,
    };
  }
}
