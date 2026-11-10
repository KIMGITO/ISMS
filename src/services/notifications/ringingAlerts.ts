// src/services/notifications/ringingAlerts.ts
// Shift reminders and urgent alerts that ring until someone accepts them.
// The database decides which alerts ring (fn_ringing_alert_target). On Android a native
// service rings, even with the app closed; elsewhere the app rings while it is open.

import { Capacitor, registerPlugin, type PluginListenerHandle } from "@capacitor/core";
import { getSupabase } from "../supabaseClient";
import { RingToneService, type RingToneId } from "./notificationTone";

export interface RingingAlert {
  id: string;
  title: string;
  message: string;
  type: string;
  action_target: string;
  created_at: string;
}

export interface AcceptResult {
  accepted: boolean;
  /** "you", a name, or null when this tap accepted it. */
  alreadyAcceptedBy: string | null;
  actionTarget: string;
  businessId: string;
}

export interface NativeAccept {
  /** The server's notification id, or "" when the phone's own alarm rang first. */
  id: string;
  scheduleId?: string;
  /** The reminder's day (YYYY-MM-DD) the phone rang for. */
  occurrence?: string;
  /** And its time (HH:mm): a reminder moved later the same day is a separate ring. */
  time?: string;
  actionTarget?: string;
  businessId?: string;
  /** A test alarm from Settings: nothing to accept on the server. */
  test?: boolean;
}

interface RingAlarmPlugin {
  takePendingAccepts(): Promise<{ accepts: NativeAccept[] }>;
  stop(options: { id: string }): Promise<void>;
  keepOnly(options: { businessId: string; ids: string[] }): Promise<void>;
  setTone(options: { sound: string }): Promise<void>;
  addListener(event: "accept", cb: (data: NativeAccept) => void): Promise<PluginListenerHandle>;
}

const RingAlarm = registerPlugin<RingAlarmPlugin>("RingAlarm");

/** Android rings natively; the in-app alert stays silent there so it doesn't ring twice. */
export const ringsNatively = Capacitor.getPlatform() === "android";

export async function fetchRingingAlerts(businessId: string): Promise<RingingAlert[]> {
  const { data, error } = await getSupabase().rpc("get_my_ringing_alerts", { p_business_id: businessId });
  if (error) throw error;
  const alerts = (data || []) as RingingAlert[];
  // Stop anything still ringing on this phone that someone else has accepted.
  if (ringsNatively) {
    RingAlarm.keepOnly({ businessId, ids: alerts.map((a) => a.id) }).catch(() => undefined);
  }
  return alerts;
}

/**
 * Accepts through the accept-alert function, which also stops the alert ringing on other
 * phones. Falls back to the database alone if the function can't be reached.
 */
export async function acceptAlert(id: string): Promise<AcceptResult> {
  const supabase = getSupabase();
  let result: AcceptResult | null = null;
  const { data, error } = await supabase.functions.invoke("accept-alert", { body: { notificationId: id } });
  if (!error) {
    result = data as AcceptResult;
  } else {
    // A refusal (not yours, not found) is final. A network, relay or deployment problem
    // falls through to accepting in the database directly.
    const response = (error as any).context as Response | undefined;
    if (error.name === "FunctionsHttpError" && response && (response.status === 400 || response.status === 403)) {
      const body = await response.json().catch(() => null);
      throw new Error(body?.error || "Could not accept the alert.");
    }
  }
  if (!result) {
    const { data, error } = await supabase.rpc("accept_alert", { p_notification_id: id });
    if (error) throw new Error(error.message || "Could not accept the alert.");
    result = data as AcceptResult;
  }
  if (ringsNatively) RingAlarm.stop({ id }).catch(() => undefined);
  return result;
}

const RETRY_KEY = "kk_pending_native_accepts_v1";

function loadRetries(): NativeAccept[] {
  try {
    return JSON.parse(localStorage.getItem(RETRY_KEY) || "[]");
  } catch {
    return [];
  }
}

function saveRetries(list: NativeAccept[]): void {
  try {
    localStorage.setItem(RETRY_KEY, JSON.stringify(list.slice(-50)));
  } catch {
    // ignore
  }
}

/**
 * Sends an Accept tapped on the phone to the server. The phone's own alarm knows the reminder
 * and day, not the server's notification row, so those go by schedule. Accepts that fail
 * (offline) are kept and sent again later, so managers aren't told it was ignored.
 */
export async function acceptNative(data: NativeAccept): Promise<AcceptResult | null> {
  if (data.test) return null;
  try {
    if (data.scheduleId && data.occurrence) {
      const { data: result, error } = await getSupabase().rpc("accept_schedule_occurrence", {
        p_schedule_id: data.scheduleId,
        p_date: data.occurrence,
        p_time: data.time || null,
      });
      if (error) throw error;
      return result as AcceptResult;
    }
    if (data.id) return await acceptAlert(data.id);
    return null;
  } catch (e: any) {
    // A refusal (not yours / not found) is final; anything else is tried again later.
    if (e?.code !== "42501" && !/not found|not sent to you/i.test(String(e?.message))) {
      saveRetries([...loadRetries(), data]);
    }
    console.warn("[ALARM_DISMISS] could not send accept to the server:", e?.message || e);
    return null;
  }
}

/** Sends Accepts that failed before (no internet at the time). */
export async function retryNativeAccepts(): Promise<void> {
  const list = loadRetries();
  if (list.length === 0) return;
  saveRetries([]);
  for (const a of list) await acceptNative(a);
}

/**
 * Accept taps from the Android alarm screen or notification, including ones made while the app
 * was closed (the phone keeps them until the app opens).
 */
export async function onNativeAccept(cb: (data: NativeAccept) => void): Promise<() => void> {
  if (!ringsNatively) return () => undefined;
  const handle = await RingAlarm.addListener("accept", cb);
  try {
    const { accepts } = await RingAlarm.takePendingAccepts();
    for (const a of accepts || []) cb(a);
  } catch {
    // Older app build without the plugin.
  }
  retryNativeAccepts().catch(() => undefined);
  return () => handle.remove();
}

/** Saves the ringing tone and tells the Android ringing service, which plays it with the app closed. */
export async function setRingTone(id: RingToneId): Promise<void> {
  RingToneService.setId(id);
  await syncRingTone();
}

/** Sends the saved ringing tone to the Android service (it keeps its own copy). */
export async function syncRingTone(): Promise<void> {
  if (!ringsNatively) return;
  try {
    await RingAlarm.setTone({ sound: RingToneService.nativeName() });
  } catch {
    // Older app build without setTone: it rings with the phone's alarm sound.
  }
}

/**
 * Shows a ringing alert as a system notification on desktop and in the browser, so it is seen
 * when the app is behind other windows. Android shows its own from the ringing service.
 */
export async function showSystemNotice(alert: Pick<RingingAlert, "id" | "title" | "message">): Promise<void> {
  if (ringsNatively || typeof window === "undefined") return;
  try {
    if ((window as any).__TAURI__) {
      const n = await import("@tauri-apps/plugin-notification");
      let granted = await n.isPermissionGranted();
      if (!granted) granted = (await n.requestPermission()) === "granted";
      if (granted) n.sendNotification({ title: alert.title, body: alert.message });
      return;
    }
    if ("Notification" in window && Notification.permission === "granted") {
      new Notification(alert.title, { body: alert.message, tag: `ring-${alert.id}`, requireInteraction: true });
    }
  } catch {
    // The full-screen alert in the app still shows and rings.
  }
}
