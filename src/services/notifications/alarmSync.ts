// src/services/notifications/alarmSync.ts
// Copies this person's reminders to the phone, where Android's AlarmManager rings them at their
// time, with the app closed, the screen locked or no internet. The web app only hands over the
// list; ringing never depends on it running.
//
// When it syncs: on sign-in, whenever the app comes back to the front, when the internet comes
// back, every 15 minutes while open, and right after a reminder is saved here. The server also
// sends each change straight to the person's phones (alarm-sync), so this is the safety net.

import { Capacitor, registerPlugin } from "@capacitor/core";
import { App } from "@capacitor/app";
import { getSupabase } from "../supabaseClient";

export interface AlarmStatus {
  sdk: number;
  manufacturer: string;
  notificationsEnabled: boolean;
  alarmChannelEnabled: boolean;
  generalChannelEnabled: boolean;
  exactAlarms: boolean;
  fullScreen: boolean;
  batteryUnrestricted: boolean;
  pushAvailable: boolean;
  scheduled: number;
  nextAt: number;
  signedInOwner: boolean;
}

export type AlarmSettingsTarget = "notifications" | "alarmChannel" | "exactAlarm" | "fullScreen" | "battery" | "app";

interface AlarmSchedulerPlugin {
  replaceAll(options: { ownerId: string; alarms: unknown[] }): Promise<{ saved: number; scheduled: number; nextAt: number }>;
  clearAll(): Promise<void>;
  status(): Promise<AlarmStatus>;
  openSettings(options: { target: AlarmSettingsTarget }): Promise<void>;
  testAlarm(options: { seconds: number }): Promise<{ at: number; exact: boolean }>;
  list(): Promise<{ alarms: Array<{ id: string; repeat: string; test: boolean; nextAt: number; occurrence: string }> }>;
}

const AlarmScheduler = registerPlugin<AlarmSchedulerPlugin>("AlarmScheduler");

/** Only Android sets real alarms; elsewhere the app rings while it's open. */
export const hasNativeAlarms = Capacitor.getPlatform() === "android";

const RESYNC_MS = 15 * 60 * 1000;
let ownerId: string | null = null;
let running: Promise<void> | null = null;
let again = false;
let stopFns: Array<() => void> = [];

/** Fetches this person's reminders and hands the full list to the phone. */
export async function syncAlarms(reason: string): Promise<void> {
  if (!hasNativeAlarms || !ownerId) return;
  if (running) {
    again = true;
    return running;
  }
  running = (async () => {
    try {
      const { data, error } = await getSupabase().rpc("get_my_alarms");
      if (error) {
        // Before the migration is applied, or offline: the phone keeps the alarms it has.
        console.warn(`[REMINDER_SYNC] could not fetch reminders (${reason}): ${error.message}`);
        return;
      }
      const owner = ownerId;
      if (!owner) return;
      const result = await AlarmScheduler.replaceAll({ ownerId: owner, alarms: data || [] });
      console.log(`[REMINDER_SYNC] ${reason}: ${result.saved} reminder(s), ${result.scheduled} set`);
    } catch (e) {
      // An older APK without the plugin: reminders still ring from the server push.
      console.warn("[REMINDER_SYNC] phone alarms unavailable:", e);
    } finally {
      running = null;
      if (again) {
        again = false;
        syncAlarms("queued");
      }
    }
  })();
  return running;
}

/** Starts keeping this person's alarms on the phone. Call after sign-in. */
export function startAlarmSync(userId: string): void {
  if (!hasNativeAlarms) return;
  if (ownerId === userId && stopFns.length > 0) return;
  stopAlarmSync();
  ownerId = userId;
  syncAlarms("sign-in");

  const timer = setInterval(() => syncAlarms("timer"), RESYNC_MS);
  stopFns.push(() => clearInterval(timer));

  const onOnline = () => syncAlarms("back online");
  window.addEventListener("online", onOnline);
  stopFns.push(() => window.removeEventListener("online", onOnline));

  App.addListener("resume", () => syncAlarms("resume"))
    .then((h) => stopFns.push(() => h.remove()))
    .catch(() => undefined);
}

export function stopAlarmSync(): void {
  stopFns.forEach((f) => f());
  stopFns = [];
  ownerId = null;
}

/** Sign-out: nothing of this person's may ring for whoever signs in next. */
export async function clearAlarms(): Promise<void> {
  stopAlarmSync();
  if (!hasNativeAlarms) return;
  try {
    await AlarmScheduler.clearAll();
  } catch {
    // Older APK without the plugin.
  }
}

export async function getAlarmStatus(): Promise<AlarmStatus | null> {
  if (!hasNativeAlarms) return null;
  try {
    return await AlarmScheduler.status();
  } catch {
    return null;
  }
}

export function openAlarmSettings(target: AlarmSettingsTarget): Promise<void> {
  return AlarmScheduler.openSettings({ target });
}

/** A phone-only alarm, to prove this phone rings with the app closed. */
export function testAlarm(seconds = 60): Promise<{ at: number; exact: boolean }> {
  return AlarmScheduler.testAlarm({ seconds });
}
