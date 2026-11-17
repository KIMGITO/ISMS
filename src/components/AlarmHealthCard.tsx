// src/components/AlarmHealthCard.tsx
// "Alarms on this phone": everything Android can switch off that would stop a reminder ringing,
// each with a button that opens the right Android settings page, plus a test alarm.
// Android only; other platforms ring while the app is open.

import React, { useCallback, useEffect, useState } from 'react';
import { AlarmClock, AlertTriangle, CheckCircle2, ChevronRight } from 'lucide-react';
import { App } from '@capacitor/app';
import {
  getAlarmStatus,
  hasNativeAlarms,
  openAlarmSettings,
  syncAlarms,
  testAlarm,
  type AlarmSettingsTarget,
  type AlarmStatus,
} from '../services/notifications/alarmSync';
import { notificationService } from '../core/native/NotificationService';
import { useAppStore } from '../stores/appStore';

interface Check {
  id: string;
  ok: boolean;
  /** Needed for alarms to work at all, rather than just better. */
  required: boolean;
  label: string;
  okText: string;
  problem: string;
  fix?: AlarmSettingsTarget;
  fixLabel?: string;
}

function checksFor(s: AlarmStatus): Check[] {
  const pushState = notificationService.pushState;
  return [
    {
      id: 'notifications', ok: s.notificationsEnabled, required: true,
      label: 'Notifications', okText: 'Allowed',
      problem: 'Turned off for KayKay\'s, so alarms can\'t show and nothing arrives. Turn on "Allow notifications".',
      fix: 'notifications', fixLabel: 'Turn on',
    },
    {
      id: 'channel', ok: s.alarmChannelEnabled, required: true,
      label: 'Alarm notifications', okText: 'On',
      problem: '"Alarms and ringing alerts" is switched off in Android settings.',
      fix: 'alarmChannel', fixLabel: 'Turn on',
    },
    {
      id: 'exact', ok: s.exactAlarms, required: false,
      label: 'Ring on the minute', okText: 'Allowed',
      problem: 'Android hasn\'t allowed exact alarms, so reminders may ring a few minutes late. Allow "Alarms & reminders".',
      fix: 'exactAlarm', fixLabel: 'Allow',
    },
    {
      id: 'fullscreen', ok: s.fullScreen, required: false,
      label: 'Alarm screen over the lock screen', okText: 'Allowed',
      problem: 'Not allowed. Alarms show as a notification.',
      fix: 'fullScreen', fixLabel: 'Allow',
    },
    {
      id: 'battery', ok: s.batteryUnrestricted, required: false,
      label: 'Battery', okText: 'Unrestricted',
      problem: 'Some phones stop apps in the background to save battery, which can delay pushes. Set KayKay\'s to "Unrestricted" or "Don\'t optimise".',
      fix: 'battery', fixLabel: 'Open',
    },
    {
      id: 'push', ok: s.pushAvailable && pushState !== 'denied' && pushState !== 'error', required: false,
      label: 'Reminders from the server', okText: pushState === 'registered' ? 'Connected' : 'Available',
      problem: !s.pushAvailable
        ? 'This copy of the app was built without push, so reminders set on other phones only arrive when you open the app. Update the app.'
        : pushState === 'denied'
          ? 'Notifications are blocked, so this phone can\'t be told about new reminders until the app opens.'
          : 'This phone couldn\'t connect for push (check Google Play services and the internet).',
      fix: s.pushAvailable ? 'notifications' : undefined, fixLabel: 'Open',
    },
  ];
}

function clock(ms: number): string {
  const d = new Date(ms);
  const sameDay = d.toDateString() === new Date().toDateString();
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return sameDay ? time : `${d.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' })}, ${time}`;
}

export default function AlarmHealthCard() {
  const { showToast } = useAppStore();
  const [status, setStatus] = useState<AlarmStatus | null>(null);
  const [testing, setTesting] = useState(false);

  const refresh = useCallback(async () => {
    setStatus(await getAlarmStatus());
  }, []);

  // Coming back from Android settings: show the new state.
  useEffect(() => {
    if (!hasNativeAlarms) return;
    refresh();
    let remove: (() => void) | null = null;
    App.addListener('resume', () => {
      refresh();
      syncAlarms('settings changed');
    }).then((h) => (remove = () => h.remove())).catch(() => undefined);
    return () => remove?.();
  }, [refresh]);

  if (!hasNativeAlarms || !status) return null;

  const checks = checksFor(status);
  const blocking = checks.filter((c) => !c.ok && c.required);
  const advisories = checks.filter((c) => !c.ok && !c.required);

  const runTest = async () => {
    setTesting(true);
    try {
      const { at, exact } = await testAlarm(60);
      showToast(
        'Test alarm set',
        `It rings at ${clock(at)}. Close the app or lock the phone now to check it rings by itself.${exact ? '' : ' Exact alarms are off, so it may be a little late.'}`,
        undefined,
        'success',
      );
      refresh();
    } catch {
      showToast('Test alarm not set', 'Update the app to the latest version and try again.', undefined, 'error');
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="rounded-2xl bg-app-bg p-3 mb-2">
      <div className="flex items-center gap-3">
        <div className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 ${blocking.length ? 'bg-red-500/10 text-red-500' : 'bg-amber-500/10 text-amber-500'}`}>
          <AlarmClock size={16} />
        </div>
        <div className="flex-1 min-w-0">
          <span className="text-[13px] font-bold block">Alarms on this phone</span>
          <span className="text-[10px] text-app-text-muted block">
            {blocking.length
              ? 'Reminders can\'t ring here until this is fixed.'
              : status.nextAt
                ? `${status.scheduled} reminder${status.scheduled === 1 ? '' : 's'} saved. Next rings ${clock(status.nextAt)}, even offline.`
                : status.scheduled
                  ? `${status.scheduled} reminder${status.scheduled === 1 ? '' : 's'} saved, none due to ring.`
                  : 'No reminders set for you yet.'}
          </span>
        </div>
      </div>

      <div className="mt-2 flex flex-col gap-1">
        {[...blocking, ...advisories].map((c) => (
          <div key={c.id} className="flex items-start gap-2 rounded-xl px-2 py-2 bg-app-card">
            <AlertTriangle size={14} className={`mt-0.5 shrink-0 ${c.required ? 'text-red-500' : 'text-amber-500'}`} />
            <div className="flex-1 min-w-0">
              <span className="text-[12px] font-bold block">{c.label}</span>
              <span className="text-[10px] text-app-text-muted block">{c.problem}</span>
            </div>
            {c.fix && (
              <button
                onClick={() => openAlarmSettings(c.fix!)}
                className="shrink-0 flex items-center gap-0.5 text-[11px] font-bold text-amber-500 px-2 py-1 rounded-lg hover:bg-amber-500/10"
              >
                {c.fixLabel}
                <ChevronRight size={12} />
              </button>
            )}
          </div>
        ))}
        {checks.filter((c) => c.ok).length > 0 && (
          <div className="flex flex-wrap gap-x-3 gap-y-1 px-2 pt-1">
            {checks.filter((c) => c.ok).map((c) => (
              <span key={c.id} className="flex items-center gap-1 text-[10px] text-app-text-muted">
                <CheckCircle2 size={11} className="text-emerald-500" />
                {c.label}: {c.okText}
              </span>
            ))}
          </div>
        )}
      </div>

      <button
        onClick={runTest}
        disabled={testing || blocking.length > 0}
        className="mt-2 w-full text-[12px] font-bold text-amber-600 dark:text-amber-400 py-2 rounded-xl border border-amber-500/30 hover:bg-amber-500/10 disabled:opacity-50"
      >
        {testing ? 'Setting…' : 'Test: ring in 1 minute'}
      </button>
    </div>
  );
}
