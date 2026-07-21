# Notification System Architecture

This document describes the unified notification system implemented in KayKay's Milk Application.

## Overview

The notification system provides reliable, offline-friendly, and categorized alerts across web and mobile platforms. It replaces fragmented local storage approaches with a single source of truth stored in Supabase PostgreSQL, synchronized in real-time, and pushed via FCM (Firebase Cloud Messaging).

## Key Components

### 1. Database (`notifications` & `device_fcm_tokens`)
All meaningful events are recorded in the `notifications` table. 
- **`notifications`**: Stores the structured notification (type, priority, payload, read state).
- **`device_fcm_tokens`**: Stores active FCM push tokens mapped to specific users.

### 2. Edge Function (`send-fcm`)
A scalable Supabase Edge Function that sends push notifications using the Firebase Admin SDK.
- Retrieves device tokens directly from `device_fcm_tokens`.
- Invalidates and deletes stale/bounced tokens automatically.
- Sanitizes errors so internal structures are not leaked to the client.

### 3. Repository (`NotificationRepository.ts`)
The single source of truth on the client side.
- Maintains an array of `AppNotification` rows.
- Periodically syncs with Supabase.
- Publishes updates to subscribers (e.g., Zustand stores) whenever a read state changes or a new alert arrives.

### 4. Real-time Store (`notificationStore.ts`)
A Zustand store that bridges the Repository to the UI.
- Subscribes to the `NotificationRepository`.
- Computes unread counts and exposes the list of active notifications.
- Automatically generates floating UI toasts (chimes and visual banners) for newly arriving unread notifications via Realtime.

### 5. Native Integration (`NotificationService.ts`)
- Requests native Push permissions via Capacitor.
- Creates Android Notification Channels (`default` and `alerts`).
- Registers tokens and syncs them to the backend upon login.

## Types and Priorities

To prevent notification fatigue, the system **only** generates notifications for non-routine actions:
- `Stock Almost Finished` / `Out Of Stock`
- `Delivery Assigned` / `Delivery Completed`
- `Payment Received`
- `Role Invitation`
- `Account Activity` / `Security`

Each type is categorized into `inventory`, `logistics`, `security`, `sales`, or `audit` so that employees only receive alerts relevant to their roles (e.g. Riders only see logistics, Cashiers only see sales).

## Android Specifics

- A customized monochromatic vector icon (`ic_stat_name.xml`) representing a milk glass is used for the notification bar.
- The default notification color is set to Amber (`#F59E0B`) in the `AndroidManifest.xml`.
- Dedicated channels ensure high-priority alerts can break through system silences if allowed.
