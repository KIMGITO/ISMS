// src/features/console/common.tsx
// Small pieces every platform console section shares.

import React, { useCallback, useState } from 'react';
import { appDialog } from '../../components/AppDialog';
import { getSupabase } from '../../services/supabaseClient';
import { useNotificationStore } from '../../stores/notificationStore';
import { toUserMessage } from '../../utils/userError';

export const btn =
  'inline-flex items-center justify-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-semibold transition disabled:opacity-60 cursor-pointer';
export const btnMain = `${btn} bg-amber-500 hover:bg-amber-600 text-slate-950`;
export const btnQuiet = `${btn} border border-app-border bg-app-card hover:bg-app-bg text-app-text`;
export const btnDanger = `${btn} bg-red-600 hover:bg-red-700 text-white`;
export const card = 'rounded-2xl bg-app-card ring-1 ring-app-border p-4';

export const day = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric' }) : '-';
export const when = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString('en-KE', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '-';
export const num = (v: unknown) => Number(v) || 0;

const STATUS_TONE: Record<string, string> = {
  trial: 'bg-sky-500/15 text-sky-600',
  active: 'bg-emerald-500/15 text-emerald-600',
  grace: 'bg-amber-500/15 text-amber-600',
  read_only: 'bg-red-500/15 text-red-600',
  suspended: 'bg-red-500/15 text-red-600',
};
export const STATUS_TEXT: Record<string, string> = {
  trial: 'Trial', active: 'Active', grace: 'Unpaid (grace)', read_only: 'Read-only', suspended: 'Suspended',
};
export function StatusPill({ status }: { status: string }) {
  return (
    <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${STATUS_TONE[status] ?? 'bg-app-bg text-app-text-muted'}`}>
      {STATUS_TEXT[status] ?? status}
    </span>
  );
}

export const CYCLE_TEXT: Record<string, string> = {
  trial: 'Trial', monthly: 'Monthly', annual: 'Yearly', one_time: 'Once', manual: 'Free',
};

/** A database call with the console's error and success messages. */
export function useCall() {
  const toast = useNotificationStore((s) => s.showToast);
  const [busy, setBusy] = useState(false);
  const call = useCallback(
    async <T,>(fn: string, args: Record<string, unknown> = {}, ok?: string): Promise<T | null> => {
      setBusy(true);
      const { data, error } = await getSupabase().rpc(fn, args);
      setBusy(false);
      if (error) {
        toast('Platform', toUserMessage(error, 'That did not work. Please try again.'), undefined, 'error');
        return null;
      }
      if (ok) toast('Platform', ok, undefined, 'success');
      return (data ?? true) as T;
    },
    [toast],
  );
  return { call, busy };
}

// --- Buttons by what they do: green = save/confirm, red = danger, amber = warning, blue = info.
export const btnBig = 'inline-flex items-center justify-center gap-1.5 rounded-xl px-4 py-2.5 text-sm font-bold shadow-sm transition disabled:opacity-50 cursor-pointer';
export const btnSave = `${btnBig} bg-emerald-600 hover:bg-emerald-700 text-white`;
export const btnStop = `${btnBig} bg-red-600 hover:bg-red-700 text-white`;
export const btnWarn = `${btnBig} bg-amber-500 hover:bg-amber-600 text-slate-950`;
export const btnInfo = `${btnBig} bg-sky-600 hover:bg-sky-700 text-white`;
export type Tone = 'save' | 'danger' | 'warn' | 'info';
const TONE_BTN: Record<Tone, string> = { save: btnSave, danger: btnStop, warn: btnWarn, info: btnInfo };

/** Important actions sit on the right. */
export function ActionBar({ children, left }: { children: React.ReactNode; left?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-2 border-t border-app-border pt-3 mt-2">
      <div className="min-w-0 flex-1 text-xs text-app-text-muted">{left}</div>
      <div className="flex flex-wrap gap-2 justify-end">{children}</div>
    </div>
  );
}

const NOTE_TONE: Record<Tone | 'success', string> = {
  save: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 ring-emerald-500/30',
  success: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 ring-emerald-500/30',
  danger: 'bg-red-500/10 text-red-700 dark:text-red-400 ring-red-500/30',
  warn: 'bg-amber-500/10 text-amber-700 dark:text-amber-400 ring-amber-500/30',
  info: 'bg-sky-500/10 text-sky-700 dark:text-sky-400 ring-sky-500/30',
};
export function Note({ tone, children }: { tone: Tone | 'success'; children: React.ReactNode }) {
  return <div className={`rounded-xl px-3 py-2 text-xs ring-1 ${NOTE_TONE[tone]}`}>{children}</div>;
}

/**
 * A button that asks first. Use for every save, suspend, void or other change that matters.
 * Any module can use it: <ConfirmButton tone="danger" label="Suspend" question="Suspend X?" onConfirm={...} />
 */
export function ConfirmButton({ label, question, details, confirmLabel, tone = 'save', disabled, onConfirm, icon }: {
  label: React.ReactNode; question: string; details?: string; confirmLabel?: string;
  tone?: Tone; disabled?: boolean; onConfirm: () => unknown | Promise<unknown>; icon?: React.ReactNode;
}) {
  const [working, setWorking] = useState(false);
  // The app's one confirm popup (blue Cancel, red or blue confirm).
  const ask = async () => {
    const ok = await appDialog.confirm({ title: question, message: details, confirmLabel: confirmLabel ?? 'Yes, go ahead', cancelLabel: 'Go back', destructive: tone === 'danger' });
    if (!ok) return;
    setWorking(true);
    try {
      await onConfirm();
    } finally {
      setWorking(false);
    }
  };
  return <button type="button" className={TONE_BTN[tone]} disabled={disabled || working} onClick={ask}>{icon}{working ? 'Working...' : label}</button>;
}

/** Tabs for long console screens. */
export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: Array<{ id: NoInfer<T>; label: string; badge?: number }>; value: T; onChange: (id: NoInfer<T>) => void }) {
  return (
    <div className="flex gap-1 overflow-x-auto border-b border-app-border mb-4" role="tablist">
      {tabs.map((t) => (
        <button key={t.id} type="button" role="tab" aria-selected={value === t.id} onClick={() => onChange(t.id)}
          className={`whitespace-nowrap px-3 py-2 text-sm font-semibold border-b-2 -mb-px cursor-pointer ${value === t.id ? 'border-amber-500 text-app-text' : 'border-transparent text-app-text-muted hover:text-app-text'}`}>
          {t.label}{t.badge ? <span className="ml-1.5 rounded-full bg-red-600 px-1.5 text-[10px] text-white">{t.badge}</span> : null}
        </button>
      ))}
    </div>
  );
}

/** Colour of a logged action: red = stops/voids, amber = warnings, green = money in / approvals, blue = the rest. */
export function actionTone(action: string): Tone | 'success' {
  if (/void|suspend|reject|deleted/.test(action)) return 'danger';
  if (/unsuspend|recorded|approved|allowed/.test(action)) return 'success';
  if (/extended|requested|limits|support_opened/.test(action)) return 'warn';
  return 'info';
}
export const TONE_DOT: Record<Tone | 'success', string> = {
  save: 'bg-emerald-500', success: 'bg-emerald-500', danger: 'bg-red-500', warn: 'bg-amber-500', info: 'bg-sky-500',
};

export function bytesText(b: number): string {
  if (b >= 1073741824) return `${(b / 1073741824).toFixed(1)} GB`;
  if (b >= 1048576) return `${(b / 1048576).toFixed(1)} MB`;
  return `${Math.round(b / 1024)} KB`;
}

/** Storage used / allowed for a company (platform admins) or a business (its managers). */
export function StorageUsage({ tenantId, businessId }: { tenantId?: string; businessId?: string }) {
  const [u, setU] = useState<{ used_bytes: number; quota_bytes: number | null } | null | 'error'>(null);
  React.useEffect(() => {
    getSupabase().rpc('tenant_storage_usage', { p_tenant_id: tenantId ?? null, p_business_id: businessId ?? null })
      .then(({ data, error }) => setU(error ? 'error' : (data as any)));
  }, [tenantId, businessId]);
  if (u === null) return <p className="text-xs text-app-text-muted">Loading storage...</p>;
  if (u === 'error') return <p className="text-xs text-app-text-muted">Storage figure not available yet.</p>;
  const pct = u.quota_bytes ? Math.min(100, (u.used_bytes / u.quota_bytes) * 100) : 0;
  const bar = pct >= 90 ? 'bg-red-500' : pct >= 70 ? 'bg-amber-500' : 'bg-emerald-500';
  return (
    <div className="space-y-1.5">
      <div className="flex justify-between text-sm">
        <span className="font-semibold">Storage</span>
        <span className="tabular-nums">{bytesText(u.used_bytes)} used / {u.quota_bytes ? `${bytesText(u.quota_bytes)} available` : 'no limit'}</span>
      </div>
      {u.quota_bytes != null && (
        <div className="h-2 rounded-full bg-app-bg overflow-hidden"><div className={`h-full ${bar}`} style={{ width: `${pct}%` }} /></div>
      )}
    </div>
  );
}
