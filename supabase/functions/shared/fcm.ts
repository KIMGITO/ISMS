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
    const result = await response.json().catch(() => ({}));
    if (response.ok) return { ok: true, staleToken: false };
    const staleToken =
      result?.error?.status === "UNREGISTERED" ||
      result?.error?.code === 404 ||
      result?.error?.message?.includes("invalid") ||
      result?.error?.message?.includes("not found");
    return { ok: false, staleToken, error: result?.error?.message };
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
