// src/services/crashReporter.ts
// Sends crash details to the crash_reports table. Reports never block or break the app,
// and personal details are scrubbed before anything leaves the device.
import { Capacitor } from '@capacitor/core';
import { getSupabase } from './supabaseClient';
import { useUiStore } from '../stores/uiStore';

const MAX_REPORTS_PER_SESSION = 10;
const sentThisSession = new Set<string>();

export function scrubPersonalData(text: string): string {
  return text
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '<email>')
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '<id>')
    .replace(/\+?\d[\d\s-]{7,}\d/g, '<number>')
    .replace(/eyJ[\w-]+\.[\w-]+\.[\w-]+/g, '<token>');
}

function fingerprintOf(text: string): string {
  let hash = 0;
  for (let i = 0; i < text.length; i++) hash = (hash * 31 + text.charCodeAt(i)) | 0;
  return Math.abs(hash).toString(36);
}

export function reportCrash(error: unknown, source: string): void {
  try {
    const err = error instanceof Error ? error : new Error(String(error));
    const message = scrubPersonalData(`${source}: ${err.message}`);
    const stack = scrubPersonalData(err.stack || '');
    const fingerprint = fingerprintOf(message + stack.split('\n').slice(0, 3).join());

    if (sentThisSession.has(fingerprint) || sentThisSession.size >= MAX_REPORTS_PER_SESSION) return;
    sentThisSession.add(fingerprint);

    Promise.resolve(
      getSupabase().rpc('report_crash', {
        p_fingerprint: fingerprint,
        p_message: message,
        p_stack: stack,
        p_screen: useUiStore.getState().activeTab,
        p_platform: Capacitor.getPlatform(),
        p_app_version: import.meta.env.VITE_APP_VERSION || 'dev',
      }),
    ).catch(() => {});
  } catch {
    // A crash in crash reporting must never surface to the user.
  }
}

export function installCrashHandlers(): void {
  window.addEventListener('error', (event) => reportCrash(event.error ?? event.message, 'window'));
  window.addEventListener('unhandledrejection', (event) => {
    console.error('[Unhandled rejection]', event.reason);
    reportCrash(event.reason, 'promise');
  });
}
