// supabase/functions/shared/fcm.ts
// Sending to Firebase Cloud Messaging, shared by send-fcm and accept-alert.

import { JWT } from "https://esm.sh/google-auth-library@9";

export interface FcmAccess {
  accessToken: string;
  url: string;
}

/** Signs in to FCM with the FIREBASE_SERVICE_ACCOUNT secret. */
export async function getFcmAccess(): Promise<FcmAccess> {
  const serviceAccountStr = Deno.env.get("FIREBASE_SERVICE_ACCOUNT");
  if (!serviceAccountStr) {
    throw new Error("Missing FIREBASE_SERVICE_ACCOUNT secret");
  }
  const serviceAccount = JSON.parse(serviceAccountStr);
  const jwtClient = new JWT({
    email: serviceAccount.client_email,
    key: serviceAccount.private_key,
    scopes: ["https://www.googleapis.com/auth/firebase.messaging"],
  });
  const { token } = await jwtClient.getAccessToken();
  if (!token) throw new Error("Could not sign in to FCM");
  return {
    accessToken: token,
    url: `https://fcm.googleapis.com/v1/projects/${serviceAccount.project_id}/messages:send`,
  };
}

export interface FcmResult {
  ok: boolean;
  /** The token no longer exists, so its row should be deleted. */
  staleToken: boolean;
  error?: string;
}

export async function sendFcm(access: FcmAccess, message: Record<string, unknown>): Promise<FcmResult> {
  try {
    const response = await fetch(access.url, {
      method: "POST",
      headers: { Authorization: `Bearer ${access.accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ message }),
    });
    // deno-lint-ignore no-explicit-any
    const result: any = await response.json().catch(() => ({}));
    if (response.ok) return { ok: true, staleToken: false };
    // Only a token FCM no longer knows is removed. A bad message (also INVALID_ARGUMENT) must
    // never delete a working token, so the error has to name the registration token.
    const details: Array<{ errorCode?: string }> = Array.isArray(result?.error?.details) ? result.error.details : [];
    const code = details.map((d) => d?.errorCode).find(Boolean);
    const errorText = String(result?.error?.message || "");
    const staleToken =
      code === "UNREGISTERED" ||
      result?.error?.status === "NOT_FOUND" ||
      (code === "INVALID_ARGUMENT" && /registration token/i.test(errorText));
    return { ok: false, staleToken, error: `${response.status} ${code || result?.error?.status || ""} ${errorText}`.trim() };
  } catch (e) {
    return { ok: false, staleToken: false, error: (e as Error).message };
  }
}

/**
 * A ringing alert. It carries no "notification" block, so Android hands it to the app's own
 * service even when the app is closed, and that service rings until someone accepts.
 * High priority lets the service start while the phone is idle.
 */
export function ringMessage(token: string, alert: {
  id: string; title: string; body: string; actionTarget: string; type: string; businessId: string;
  /** For reminders: lets the phone match this to the alarm it already rang itself. */
  scheduleId?: string; occurrence?: string; startTime?: string;
}): Record<string, unknown> {
  return {
    token,
    data: {
      kind: "ring",
      notification_id: alert.id,
      title: alert.title,
      body: alert.body,
      action_target: alert.actionTarget,
      type: alert.type,
      business_id: alert.businessId,
      schedule_id: alert.scheduleId || "",
      occurrence: alert.occurrence || "",
      start_time: alert.startTime || "",
    },
    android: { priority: "high", ttl: "43200s" },
  };
}

/** Stops a ringing alert on a device, because someone accepted it. */
export function ringCancelMessage(token: string, notificationId: string): Record<string, unknown> {
  return {
    token,
    data: { kind: "ring_cancel", notification_id: notificationId },
    android: { priority: "high", ttl: "43200s" },
  };
}

/** A reminder for the phone to set as its own alarm. All values are strings, as FCM requires. */
export interface AlarmPayload {
  id: string;
  business_id: string;
  user_id: string;
  title: string;
  notes: string;
  date: string;        // YYYY-MM-DD
  start_time: string;  // HH:MM, Nairobi
  repeat: string;      // None | Daily | Weekly | Monthly
  last_reminded_on: string;
  updated_at: string;
}

/**
 * Sets (or replaces) the alarm on the phone. Data-only, so the app's own service handles it
 * with the app closed. High priority only when the alarm is close, because FCM can hold
 * normal messages for a dozing phone until its next maintenance window.
 */
export function alarmUpsertMessage(token: string, alarm: AlarmPayload, urgent: boolean, ttlSeconds: number): Record<string, unknown> {
  return {
    token,
    data: { kind: "alarm_upsert", ...alarm },
    android: { priority: urgent ? "high" : "normal", ttl: `${Math.max(60, Math.min(ttlSeconds, 2419200))}s` },
  };
}

/** Removes the alarm from the phone: deleted, or now set for someone else. */
export function alarmCancelMessage(token: string, scheduleId: string, userId: string): Record<string, unknown> {
  return {
    token,
    data: { kind: "alarm_cancel", id: scheduleId, user_id: userId },
    android: { priority: "normal", ttl: "2419200s" },
  };
}
