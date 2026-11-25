// src/features/console/common.tsx
// Small pieces every platform console section shares.

import React, { useCallback, useState } from 'react';
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
