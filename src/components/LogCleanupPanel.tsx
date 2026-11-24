// Settings > Data > Old records: owners and admins see how big each growing log is and clear
// entries older than a chosen age. Only logs with no money and no audit value are listed; sales,
// stock history, points used and the audit trail are kept for good (20261203001).
import React, { useCallback, useEffect, useState } from 'react';
import { Archive, RefreshCw, Trash2 } from 'lucide-react';
import { useBusinessStore } from '../stores/businessStore';
import { useNotificationStore } from '../stores/notificationStore';
import { appDialog } from './AppDialog';
import SearchableDropdown from './SearchableDropdown';
import { toUserMessage } from '../utils/userError';
import { deleteLogsBefore, fetchLogSizes, LOG_LABELS, LogName } from '../services/logCleanup';

const AGES: { id: string; label: string; days: number | null }[] = [
  { id: '30', label: 'Older than 30 days', days: 30 },
  { id: '90', label: 'Older than 3 months', days: 90 },
  { id: '180', label: 'Older than 6 months', days: 180 },
  { id: '365', label: 'Older than 1 year', days: 365 },
  { id: 'all', label: 'Everything', days: null },
];

const LOGS = Object.keys(LOG_LABELS) as LogName[];

export default function LogCleanupPanel() {
  const businessId = useBusinessStore((s) => s.activeBusinessId);
  const showToast = useNotificationStore((s) => s.showToast);
  const [sizes, setSizes] = useState<Awaited<ReturnType<typeof fetchLogSizes>> | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [age, setAge] = useState<Record<LogName, string>>(() => Object.fromEntries(LOGS.map((l) => [l, '90'])) as Record<LogName, string>);
  const [busy, setBusy] = useState<LogName | null>(null);

  const load = useCallback(async () => {
    if (!businessId) return;
    setLoading(true);
    setError('');
    try {
      setSizes(await fetchLogSizes(businessId));
    } catch (err) {
      setError(toUserMessage(err, 'Could not load the record sizes. Check your connection.'));
    } finally {
      setLoading(false);
    }
  }, [businessId]);

  useEffect(() => {
    void load();
  }, [load]);

  const clear = async (log: LogName) => {
    if (!businessId || busy) return;
    const choice = AGES.find((a) => a.id === age[log]) || AGES[0];
    const before = choice.days === null ? null : new Date(Date.now() - choice.days * 864e5);
    const ok = await appDialog.confirm({
      title: `Delete ${choice.days === null ? 'all' : choice.label.toLowerCase()} from ${LOG_LABELS[log].title.toLowerCase()}?`,
      message: `${LOG_LABELS[log].detail} This can't be undone.`,
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (!ok) return;
    setBusy(log);
    try {
      const n = await deleteLogsBefore(businessId, log, before);
      showToast('Deleted', `${n.toLocaleString()} ${n === 1 ? 'entry' : 'entries'} deleted from ${LOG_LABELS[log].title.toLowerCase()}.`, undefined, 'success');
      void load();
    } catch (err) {
      showToast('Not deleted', toUserMessage(err, 'Could not delete. Check your connection.'), undefined, 'error');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="bg-app-card border border-app-border rounded-3xl p-5 flex flex-col gap-4 shadow-sm">
      <div className="flex items-start gap-3">
        <span className="grid place-items-center size-9 rounded-xl bg-amber-500/10 text-amber-600 dark:text-amber-400 shrink-0">
          <Archive size={18} />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold text-app-text">Old records</h3>
          <p className="text-xs text-app-text-muted">
            Deleting these logs frees space. Sales, stock history, points used and the audit trail are always kept.
          </p>
        </div>
        <button onClick={() => void load()} title="Refresh" aria-label="Refresh" className="p-2 rounded-xl text-app-text-muted hover:bg-app-bg cursor-pointer shrink-0">
          <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {error && <p className="p-3 rounded-xl bg-red-500/10 text-sm text-red-600 dark:text-red-400">{error}</p>}

      <ul className="divide-y divide-app-border rounded-2xl ring-1 ring-app-border">
        {LOGS.map((log) => {
          const size = sizes?.[log];
          return (
            <li key={log} className="p-3 flex flex-col gap-2">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-sm font-medium text-app-text">{LOG_LABELS[log].title}</span>
                <span className="text-xs text-app-text-muted tabular-nums shrink-0">
                  {size ? `${size.count.toLocaleString()} ${size.count === 1 ? 'entry' : 'entries'}` : loading ? '…' : '—'}
                </span>
              </div>
              <p className="text-[11px] text-app-text-muted">
                {LOG_LABELS[log].detail}
                {size?.oldest ? ` Oldest: ${new Date(size.oldest).toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric' })}.` : ''}
              </p>
              <div className="flex items-center gap-2">
                <SearchableDropdown
                  items={AGES.map((a) => ({ id: a.id, label: a.label }))}
                  selectedValue={age[log]}
                  onChange={(v) => setAge((a) => ({ ...a, [log]: v }))}
                  placeholder="How old"
                  className="flex-1 min-w-0"
                />
                <button
                  onClick={() => void clear(log)}
                  disabled={!size || size.count === 0 || busy !== null}
                  title="Delete these entries"
                  aria-label={`Delete ${LOG_LABELS[log].title.toLowerCase()} entries`}
                  className="shrink-0 grid place-items-center size-9 rounded-xl bg-red-500/10 text-red-600 dark:text-red-400 disabled:opacity-40 cursor-pointer"
                >
                  {busy === log ? <RefreshCw size={15} className="animate-spin" /> : <Trash2 size={15} />}
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
