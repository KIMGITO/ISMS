# Notification System Architecture

This document describes the unified notification system implemented in ISMS  Application.

## Overview

The notification system provides reliable, offline-friendly, and categorized alerts across web and mobile platforms. It replaces fragmented local storage approaches with a single source of truth stored in Supabase PostgreSQL, synchronized in real-time, and pushed via FCM (Firebase Cloud Messaging).

## Key Components

### 1. Database (`notifications` & `device_fcm_tokens`)
All meaningful events are recorded in the `notifications` table.
- **`notifications`**: Stores the structured notification (type, priority, payload, read state, delivery status).
- **`device_fcm_tokens`**: Stores active FCM push tokens mapped to specific users.

`notifications.status` lifecycle:
1. `pending` — row created by a DB trigger / RPC / client insert
2. `sent` — `send-fcm` edge function successfully accepted the message from FCM
3. `delivered` — fallback / no valid device tokens found at dispatch time

### 2. Edge Function (`send-fcm`)
A scalable Supabase Edge Function that sends push notifications using the Firebase Admin SDK.
- Retrieves device tokens directly from `device_fcm_tokens`.
- Filters by `user_id` (targeted) or `role` (broadcast).
- Invalidates and deletes stale/bounced tokens automatically (UNREGISTERED / 404 / invalid).
- **Actualizes delivery**: on success sets `notifications.status = 'sent'`, `sent_at`, and `delivered_at` so the UI shows real delivery status.
- Sanitizes errors so internal structures are not leaked to the client.

### 3. Supabase Dashboard Webhook
A database webhook configured in the Supabase Dashboard:
- **Event**: `INSERT` on `public.notifications`
- **Target**: `send-fcm` edge function
- **Payload**: `{ record }` — the inserted notification row
- This means **every** new notification row is automatically dispatched via FCM.

### 4. Repository (`NotificationRepository.ts`)
The single source of truth on the client side.
- Maintains an array of `AppNotification` rows.
- Periodically syncs with Supabase.
- Publishes updates to subscribers (e.g., Zustand stores) whenever a read state changes or a new alert arrives.

### 5. Real-time Store (`notificationStore.ts`)
A Zustand store that bridges the Repository to the UI.
- Subscribes to the `NotificationRepository`.
- Computes unread counts and exposes the list of active notifications.
- Automatically generates floating UI toasts (chimes and visual banners) for newly arriving unread notifications via Realtime.
- Maintains a separate `scheduleReminders` feed subscribed to `notifications` filtered by `user_id` + `type = 'Schedule Reminder'` for the Staff Reminder feed.

### 6. Native Integration (`NotificationService.ts`)
- Requests native Push permissions via Capacitor.
- Creates Android Notification Channels (`default`, `alerts`, `shifts`).
- Registers tokens and syncs them to the backend upon login.
- Schedules local device reminders via `LocalNotifications.schedule()`.

## FCM Message Type Matrix

The following notification types are emitted into `public.notifications` and dispatched as FCM push via the Supabase Dashboard webhook → `send-fcm` edge function.

| # | `type` | Trigger / Source | Target | Priority | Payload keys |
|---|--------|------------------|--------|----------|--------------|
| 1 | `Schedule Reminder` | `flag_due_schedule_reminders()` (pg_cron every 15 min) | `user_id` (assigned employee) | high | `schedule_id`, `employee_id`, `shift_date`, `start_time` |
| 2 | `Out Of Stock` | DB trigger `fn_check_low_stock` (products UPDATE) | role `Owner` | critical | `productId`, `productName`, `stock`, `minStock` |
| 3 | `Stock Almost Finished` | DB trigger `fn_check_low_stock` (products UPDATE) | role `Owner` | high | `productId`, `productName`, `stock`, `minStock` |
| 4 | `Payment Received` | RPC `log_mpesa_payment` (M-Pesa callback) | role `Owner` | high | `amount`, `phone`, `receiptNumber`, `status` |
| 5 | `Custom Notification` | `NotificationService.createNotification` (shift open/close, punch in/out, EndShiftModal) | role / user | caller-specified | varies (`reportText`, `customMessage`, `employeeName`, `employeeId`, `closedAt`) |
| 6 | `AI Business Insight` | `NotificationService.createAINotification` (AI engine) | role `Owner` | medium | `confidenceScore`, `recommendedAction`, `insightText` |
| 7 | `AI Recommendation` | AI engine | role `Owner` | medium | `recommendationText`, `suggestedAction` |
| 8 | `AI Risk Alert` | AI engine | role `Owner` | high | `riskText`, `actionText` |
| 9 | `Delivery Assigned` | `NotificationService.createDeliveryNotification` | role `Rider` | medium | — |
| 10 | `Delivery Completed` | `NotificationService.createDeliveryNotification` | role `Owner` | medium | — |
| 11 | `Sales Summary` | Scheduled report generator | role `Owner` | medium | `date`, `totalSales`, `txCount` |
| 12 | `Daily Report` | Daily report generator | role `Owner` | medium | `revenue`, `profitMargin` |
| 13 | `Weekly Report` | Weekly report generator | role `Owner` | medium | `totalSales`, `activeCustomers` |
| 14 | `Monthly Report` | Monthly report generator | role `Owner` | medium | `revenue` |
| 15 | `Debt Due Reminder` | `NotificationService.createNotification` | role `Owner` | high | `customerName`, `debtBalance`, `dueDate` |
| 16 | `Low Cash Balance` | POS / cash drawer monitor | role `Owner` | medium | `currentBalance` |
| 17 | `Role Invitation` | Invitation flow | user (invitee) | high | — |
| 18 | `Account Activity` | Auth / security monitor | user | medium | `deviceInfo`, `timestamp` |
| 19 | `System Update` | Build / release pipeline | all users | low | `version` |
| 20 | `Business Announcement` | Owner broadcast | all users | low | `announcementTitle`, `announcementBody` |
| 21 | `Scheduled Reminder` | Schedule system (legacy) | user | low | `taskTitle` |

## UI Architecture (Notification Center)

- **`NotificationsView.tsx`** — Modern Notification Center with:
  - Left category side panel (`All Activity`, `Stock & Inventory`, `Sales & Reports`, `Deliveries`, `Payments`, `AI Insights`, `Schedule Reminders`, `System & Security`)
  - Segmented tabs (`All`, `Unread`, `Important`, `Reminders`) with live counts
  - Search, live status badges (pending / sent / delivered), Collapsible cards, Load-more
- **`CommunicationCenterView.tsx`** — Split into two channels:
  - **Customer Messaging** — bulk SMS/WhatsApp composer
  - **Staff Reminders** — in-app schedule reminder feed for the current user (all shifts / sessions)
- **`notificationStore.ts`** — Zustand store exposing `notifications`, `unreadCount`, `scheduleReminders`, `unreadReminderCount`, `initScheduleReminders()`, `markReminderAsRead()`.

## Types and Priorities

To prevent notification fatigue, the system **only** generates notifications for non-routine actions:
- `Stock Almost Finished` / `Out Of Stock`
- `Delivery Assigned` / `Delivery Completed`
- `Payment Received`
- `Role Invitation`
- `Account Activity` / `Security`
- `Schedule Reminder`

Each type is categorized into `inventory`, `logistics`, `security`, `sales`, `audit`, or `schedule` so that employees only receive alerts relevant to their roles (e.g. Riders only see logistics, Cashiers only see sales).

## Presence / Online Status

Server-side presence tracking:
- `employees.last_seen_at` (TIMESTAMPTZ) is updated by the client every 2 minutes via a heartbeat.
- **Online** — last_seen_at within 3 minutes
- **Away** — last_seen_at between 3–10 minutes
- **Offline** — last_seen_at older than 10 minutes or NULL

This replaces the unreliable `navigator.onLine` check which only detects network connectivity.

## Android Specifics

- A customized monochromatic vector icon (`ic_stat_name.xml`) representing a milk glass is used for the notification bar.
- The default notification color is set to Amber (`#F59E0B`) in the `AndroidManifest.xml`.
- Dedicated channels ensure high-priority alerts can break through system silences if allowed.
- Local device reminders are scheduled via `@capacitor/local-notifications` with the `shifts` channel.