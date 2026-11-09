// src/services/notifications/ringingAlerts.ts
// Shift reminders and urgent alerts that ring until someone accepts them.
// The database decides which alerts ring (fn_ringing_alert_target). On Android a native
// service rings, even with the app closed; elsewhere the app rings while it is open.

import { Capacitor, registerPlugin, type PluginListenerHandle } from "@capacitor/core";
import { getSupabase } from "../supabaseClient";

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
  id: string;
  actionTarget?: string;
  businessId?: string;
}

interface RingAlarmPlugin {
  getPendingAccept(): Promise<{ accept: NativeAccept | null }>;
  stop(options: { id: string }): Promise<void>;
  keepOnly(options: { businessId: string; ids: string[] }): Promise<void>;
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

/** Accept taps from the Android notification, including the one that opened the app. */
export async function onNativeAccept(cb: (data: NativeAccept) => void): Promise<() => void> {
  if (!ringsNatively) return () => undefined;
  const handle = await RingAlarm.addListener("accept", cb);
  try {
    const { accept } = await RingAlarm.getPendingAccept();
    if (accept?.id) cb(accept);
  } catch {
    // Older app build without the plugin.
  }
  return () => handle.remove();
}
