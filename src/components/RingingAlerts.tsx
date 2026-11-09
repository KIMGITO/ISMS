// src/components/RingingAlerts.tsx
// Full-screen alert for shift reminders and urgent alerts. It can't be closed: Accept is the
// only way out, and it opens the alert's screen. One person accepting clears it for everyone.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { BellRing } from 'lucide-react';
import { useAppStore } from '../stores/appStore';
import { useBusinessStore } from '../stores/businessStore';
import { useNotificationStore } from '../stores/notificationStore';
import { getSupabase } from '../services/supabaseClient';
import { canOpenScreen } from '../utils/screens';
import {
  acceptAlert,
  fetchRingingAlerts,
  onNativeAccept,
  ringsNatively,
  type NativeAccept,
  type RingingAlert,
} from '../services/notifications/ringingAlerts';

const REFRESH_MS = 30000;
const RING_SOUND = '/sounds/notification11.mp3';

function timeAgo(iso: string): string {
  const minutes = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours} hr${hours === 1 ? '' : 's'} ago`;
}

export default function RingingAlerts() {
  const { currentEmployee, setActiveTab } = useAppStore();
  const { activeBusinessId } = useBusinessStore();
  const [alerts, setAlerts] = useState<RingingAlert[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const role = currentEmployee?.role;

  const open = useCallback((target: string | undefined) => {
    if (target && role && canOpenScreen(role, target)) setActiveTab(target as any);
  }, [role, setActiveTab]);

  const load = useCallback(async () => {
    if (!activeBusinessId) return;
    try {
      setAlerts(await fetchRingingAlerts(activeBusinessId));
    } catch {
      // Keep what's showing; the next refresh tries again.
    }
  }, [activeBusinessId]);

  const accept = useCallback(async (id: string, fallbackTarget?: string) => {
    setBusy(true);
    setError(null);
    try {
      const result = await acceptAlert(id);
      setAlerts((prev) => prev.filter((a) => a.id !== id));
      if (result.alreadyAcceptedBy && result.alreadyAcceptedBy !== 'you') {
        useNotificationStore.getState().showToast('Already accepted', `${result.alreadyAcceptedBy} accepted this alert.`, undefined, 'info');
      }
      open(result.actionTarget || fallbackTarget);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not accept the alert. Check your connection and try again.');
      load();
    } finally {
      setBusy(false);
    }
  }, [open, load]);

  // Load, refresh, and reload whenever an alert is added or accepted.
  useEffect(() => {
    if (!currentEmployee || !activeBusinessId) {
      setAlerts([]);
      return;
    }
    load();
    const timer = setInterval(load, REFRESH_MS);
    const onFocus = () => load();
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onFocus);

    let pending: ReturnType<typeof setTimeout> | null = null;
    const reload = () => {
      if (pending) clearTimeout(pending);
      pending = setTimeout(load, 500);
    };
    const channel = getSupabase()
      .channel(`ringing-alerts:${activeBusinessId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: `business_id=eq.${activeBusinessId}` }, reload)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'notifications', filter: `business_id=eq.${activeBusinessId}` }, reload)
      .subscribe();

    return () => {
      clearInterval(timer);
      if (pending) clearTimeout(pending);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onFocus);
      getSupabase().removeChannel(channel);
    };
  }, [currentEmployee?.id, activeBusinessId, load]);

  // Accept tapped on the Android notification, including the tap that opened the app.
  useEffect(() => {
    if (!currentEmployee) return;
    let stop: (() => void) | null = null;
    let cancelled = false;
    onNativeAccept((data: NativeAccept) => accept(data.id, data.actionTarget)).then((fn) => {
      if (cancelled) fn();
      else stop = fn;
    });
    return () => {
      cancelled = true;
      stop?.();
    };
  }, [currentEmployee?.id, accept]);

  // Ring while the app is open. Android rings from its own service instead.
  const ringing = alerts.length > 0 && !ringsNatively;
  useEffect(() => {
    if (!ringing) {
      audioRef.current?.pause();
      return;
    }
    if (!audioRef.current) {
      audioRef.current = new Audio(RING_SOUND);
      audioRef.current.loop = true;
    }
    // A browser may block sound until the page has been clicked; the alert still shows.
    audioRef.current.play().catch(() => undefined);
    return () => audioRef.current?.pause();
  }, [ringing]);

  if (alerts.length === 0) return null;
  const current = alerts[0];
  const waiting = alerts.length - 1;

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/75 backdrop-blur-sm p-4"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="ringing-alert-title"
      aria-describedby="ringing-alert-message"
    >
      <div className="w-full max-w-sm rounded-2xl bg-white dark:bg-slate-900 shadow-2xl p-6 text-center">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-amber-500/15 text-amber-500 animate-pulse">
          <BellRing size={32} aria-hidden />
        </div>
        <h2 id="ringing-alert-title" className="text-lg font-bold text-slate-900 dark:text-white">
          {current.title}
        </h2>
        <p id="ringing-alert-message" className="mt-2 text-sm text-slate-600 dark:text-slate-300">
          {current.message}
        </p>
        <p className="mt-2 text-xs text-slate-400">{timeAgo(current.created_at)}</p>
        {error && <p className="mt-3 text-sm text-red-500" role="alert">{error}</p>}
        <button
          type="button"
          autoFocus
          disabled={busy}
          onClick={() => accept(current.id, current.action_target)}
          className="mt-5 w-full rounded-xl bg-amber-500 py-3 font-semibold text-white hover:bg-amber-600 disabled:opacity-60"
        >
          {busy ? 'Accepting…' : 'Accept'}
        </button>
        {waiting > 0 && (
          <p className="mt-3 text-xs text-slate-500">{waiting} more waiting after this one</p>
        )}
      </div>
    </div>
  );
}
