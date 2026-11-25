// Small pieces shared by the Marketing screens.
import React, { useCallback, useEffect, useState } from 'react';
import { useAuthStore } from '../../stores/authStore';
import { hasRolePermission } from '../../utils/permissions';
import { toUserMessage } from '../../utils/userError';
import { STATUS_LABELS, type CampaignStatus } from '../../../website/src/ads/rules';
import { getBusinessTimezone } from '../../services/marketing';

export { cardClass, inputClass, primaryClass, secondaryClass, labelClass, hintClass, ScreenHeading } from '../website/ui';

export const dangerClass =
  'inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-red-500/40 px-4 py-2 text-sm font-semibold text-red-600 transition hover:bg-red-500/10 disabled:opacity-50 dark:text-red-400';

/** Whether this person may change marketing (the database checks it again). */
export function useCanManage(): boolean {
  const role = useAuthStore((s) => s.currentEmployee?.role);
  return !!role && hasRolePermission(role, 'marketing.manage');
}

const STATUS_TONE: Record<CampaignStatus, string> = {
  draft: 'bg-slate-500/15 text-slate-600 dark:text-slate-300',
  scheduled: 'bg-sky-500/15 text-sky-700 dark:text-sky-300',
  active: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
  paused: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
  completed: 'bg-violet-500/15 text-violet-700 dark:text-violet-300',
  archived: 'bg-slate-500/10 text-app-text-muted',
};

export function StatusBadge({ status }: { status: CampaignStatus }) {
  return <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${STATUS_TONE[status]}`}>{STATUS_LABELS[status]}</span>;
}

/** Loads with a reload function, an error message in plain words, and a loading flag. */
export function useLoad<T>(load: () => Promise<T>, deps: React.DependencyList): { data: T | null; error: string | null; loading: boolean; reload: () => void } {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [n, setN] = useState(0);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const run = useCallback(load, deps);
  useEffect(() => {
    let live = true;
    setLoading(true);
    run().then(
      (d) => { if (live) { setData(d); setError(null); setLoading(false); } },
      (e) => { if (live) { setError(toUserMessage(e, 'Could not load this.')); setLoading(false); } },
    );
    return () => { live = false; };
  }, [run, n]);
  return { data, error, loading, reload: () => setN((x) => x + 1) };
}

export function useTimezone(businessId: string): string {
  const { data } = useLoad(() => getBusinessTimezone(businessId), [businessId]);
  return data ?? 'Africa/Nairobi';
}

export const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

/** A whole number with separators. Counts, not money. */
export const count = (n: number | null | undefined) => (n ?? 0).toLocaleString();

export const percent = (n: number | null) => (n === null ? 'Not enough views yet' : `${n.toFixed(1)}%`);

export const EVENT_LABELS: Record<string, string> = {
  created: 'Created', edited: 'Changed', published: 'Published', unpublished: 'Back to draft', paused: 'Paused',
  resumed: 'Resumed', ended: 'Ended early', archived: 'Archived', restored: 'Restored', duplicated: 'Copied',
  started: 'Started showing', finished: 'Reached its end', creative_added: 'Creative added',
  creative_changed: 'Creative changed', creative_removed: 'Creative removed',
};

export function ErrorBox({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-red-500/30 bg-red-500/5 p-3 text-sm text-red-700 dark:text-red-300">
      {message}
      {onRetry && <button type="button" onClick={onRetry} className="font-semibold underline">Try again</button>}
    </div>
  );
}
