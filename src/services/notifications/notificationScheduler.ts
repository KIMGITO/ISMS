// src/services/notifications/notificationScheduler.ts
import { NotificationTemplates } from "./notificationTemplates";
import { NotificationRepository } from "./notificationRepository";
import { AppNotification, NotificationType } from "../../types";

export interface ScheduledTask {
  id: string;
  name: string;
  cronExpression: string; // e.g. "Daily at 7:00 PM"
  nextRunTime: string;
  type: NotificationType;
}

const SCHEDULER_TASKS_KEY = "kkm_notification_scheduled_tasks_v1";

const DEFAULT_TASKS: ScheduledTask[] = [
  {
    id: "sched-1",
    name: "Daily Sales Summary Report",
    cronExpression: "Daily at 7:00 PM",
    nextRunTime: new Date(new Date().setHours(19, 0, 0, 0)).toISOString(),
    type: "Daily Report",
  },
  {
    id: "sched-2",
    name: "Weekly Business Performance Report",
    cronExpression: "Every Monday at 8:00 AM",
    nextRunTime: new Date(Date.now() + 3600000 * 24 * 3).toISOString(), // 3 days from now
    type: "Weekly Report",
  },
  {
    id: "sched-3",
    name: "Monthly Business Performance Report",
    cronExpression: "Last Day of Month at 11:30 PM",
    nextRunTime: new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0, 23, 30, 0).toISOString(),
    type: "Monthly Report",
  },
  {
    id: "sched-4",
    name: "Bi-Weekly Inventory Audit Reminder",
    cronExpression: "Bi-Weekly on Sundays",
    nextRunTime: new Date(Date.now() + 3600000 * 24 * 5).toISOString(),
    type: "Scheduled Reminder",
  },
];

export class NotificationScheduler {
  /**
   * Retrieves scheduled background crons
   */
  public static getTasks(): ScheduledTask[] {
    try {
      const saved = localStorage.getItem(SCHEDULER_TASKS_KEY);
      return saved ? JSON.parse(saved) : DEFAULT_TASKS;
    } catch {
      return DEFAULT_TASKS;
    }
  }

  /**
   * Saves task schedules
   */
  public static saveTasks(tasks: ScheduledTask[]): void {
    try {
      localStorage.setItem(SCHEDULER_TASKS_KEY, JSON.stringify(tasks));
    } catch (err) {
      console.error("Failed to save scheduled notification tasks:", err);
    }
  }

  /**
   * Generates a notification from a scheduled task and stores it.
   */
  public static triggerTask(taskId: string): AppNotification | null {
    const tasks = this.getTasks();
    const taskIndex = tasks.findIndex((t) => t.id === taskId);
    if (taskIndex === -1) return null;

    const task = tasks[taskIndex];
    let rendered: any;

    if (task.type === "Daily Report") {
      rendered = NotificationTemplates.render("Daily Report", {
        revenue: "38,450",
        profitMargin: "32",
        date: new Date().toLocaleDateString()
      });
    } else if (task.type === "Weekly Report") {
      rendered = NotificationTemplates.render("Weekly Report", {
        totalSales: "245,600",
        activeCustomers: "87"
      });
    } else if (task.type === "Monthly Report") {
      rendered = NotificationTemplates.render("Monthly Report", {
        revenue: "1,148,000"
      });
    } else {
      rendered = NotificationTemplates.render("Scheduled Reminder", {
        taskTitle: task.name
      });
    }

    const newNotif: AppNotification = {
      id: `notif-sched-${Date.now()}`,
      business_id: "all",
      user_id: null,
      role: "Owner",
      title: rendered.title,
      message: rendered.message,
      type: task.type,
      priority: rendered.priority,
      action_type: "navigate",
      action_target: rendered.actionTarget,
      payload: JSON.stringify({ taskId: task.id }),
      read_at: null,
      clicked_at: null,
      created_at: new Date().toISOString(),
      expires_at: null,
      sent_at: new Date().toISOString(),
      delivered_at: new Date().toISOString(),
      status: "delivered",
      created_by: "scheduler",
    };

    // Store in local SQLite
    NotificationRepository.add(newNotif as any);

    // Calculate next runtime (e.g., add 24 hours for daily)
    let addedTime = 3600000 * 24; // Default to 24h
    if (task.type === "Weekly Report") {
      addedTime = 3600000 * 24 * 7;
    } else if (task.type === "Monthly Report") {
      addedTime = 3600000 * 24 * 30;
    }

    tasks[taskIndex].nextRunTime = new Date(Date.now() + addedTime).toISOString();
    this.saveTasks(tasks);

    return newNotif;
  }
}
