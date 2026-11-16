// Audit Log: who changed what. Written by the database (20261116001) for products' details,
// suppliers, purchases, assets, files, and staff PIN and role changes; nobody can edit it.
// Admins clear old entries from Settings → log cleanup.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Activity, RotateCcw, Search, ChevronDown, ChevronUp } from 'lucide-react';
import { useBusinessStore, onBranchChange } from '../stores/businessStore';
import { toUserMessage } from '../utils/userError';
import { fieldClass } from '../components/shared/FormSheet';
import { listAudit, describeAction, describeChanges, AUDIT_TABLES, type AuditEntry } from '../services/operations';

type Period = 'today' | 'week' | 'month' | 'quarter';
const PERIODS: { id: Period; label: string; days: number }[] = [
  { id: 'today', label: 'Today', days: 0 },
  { id: 'week', label: '7 days', days: 6 },
  { id: 'month', label: '30 days', days: 29 },
  { id: 'quarter', label: '90 days', days: 89 },
];
const TZ = 'Africa/Nairobi';

function kenyaStartOfDay(daysBack: number): string {
  const key = new Date(Date.now() - daysBack * 864e5).toLocaleDateString('en-CA', { timeZone: TZ });
  return new Date(`${key}T00:00:00+03:00`).toISOString();
}
const dayKey = (iso: string) => new Date(iso).toLocaleDateString('en-CA', { timeZone: TZ });
const dayLabel = (iso: string) => {
  const key = dayKey(iso);
  if (key === dayKey(new Date().toISOString())) return 'Today';
  if (key === dayKey(new Date(Date.now() - 864e5).toISOString())) return 'Yesterday';
  return new Date(iso).toLocaleDateString('en-KE', { weekday: 'long', day: 'numeric', month: 'short', timeZone: TZ });
};
const clock = (iso: string) => new Date(iso).toLocaleTimeString('en-KE', { hour: 'numeric', minute: '2-digit', timeZone: TZ });

const ACTION_TONE: Record<string, string> = {
  CREATE: 'bg-emerald-500',
  DELETE: 'bg-red-500',
  RESTORE: 'bg-sky-500',
  STATUS: 'bg-violet-500',
  UPDATE: 'bg-amber-500',
  UPDATE_PIN: 'bg-red-500',
  UPDATE_ROLE: 'bg-red-500',
};

export default function AuditLogView() {
  const businessId = useBusinessStore((s) => s.activeBusinessId);
  const [period, setPeriod] = useState<Period>('week');
  const [table, setTable] = useState<string>('');
  const [query, setQuery] = useState('');
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [open, setOpen] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    if (!businessId) return;
    setLoading(true);
    setLoadError(null);
    try {
      const days = PERIODS.find((p) => p.id === period)!.days;
      setEntries(await listAudit(businessId, { since: kenyaStartOfDay(days), table: table || undefined, limit: 500 }));
    } catch (err) {
      setLoadError(toUserMessage(err, 'Could not load the audit log. Check your connection.'));
    } finally {
      setLoading(false);
    }
  }, [businessId, period, table]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => onBranchChange(() => setEntries([])), []);

  const q = query.trim().toLowerCase();
  const shown = entries.filter((e) => !q || [e.label, e.by, describeAction(e), ...describeChanges(e.changes)].some((v) => v.toLowerCase().includes(q)));
  const groups = useMemo(() => {
    const m = new Map<string, AuditEntry[]>();
    for (const e of shown) {
      const k = dayKey(e.at);
      m.set(k, [...(m.get(k) || []), e]);
    }
    return [...m.values()];
  }, [shown]);

  const toggle = (id: string) => setOpen((s) => {
    const n = new Set(s);
    n.has(id) ? n.delete(id) : n.add(id);
    return n;
  });

  return (
    <div className="h-full overflow-y-auto overflow-x-hidden bg-app-bg pb-nav">
      <div className="max-w-4xl mx-auto px-3 pt-3 sm:px-5 sm:pt-5 space-y-3">
        <div className="flex items-start gap-3">
          <span className="grid place-items-center size-9 shrink-0 rounded-full bg-amber-500/15 text-amber-600 dark:text-amber-400"><Activity size={18} /></span>
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-app-text">Who changed what</h2>
            <p className="text-xs text-app-text-muted">Changes to products, suppliers, purchases, assets, files, and staff PINs and roles. Nobody can edit this list.</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex bg-app-card rounded-xl p-1 ring-1 ring-app-border">
            {PERIODS.map((p) => (
              <button
                key={p.id}
                onClick={() => setPeriod(p.id)}
                aria-pressed={period === p.id}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer ${period === p.id ? 'bg-amber-500 text-slate-950' : 'text-app-text-muted'}`}
              >
                {p.label}
              </button>
            ))}
          </div>
          <select value={table} onChange={(e) => setTable(e.target.value)} aria-label="What changed" className={`${fieldClass} !w-auto !py-2 bg-app-card`}>
            <option value="">Everything</option>
            {Object.entries(AUDIT_TABLES).filter(([k]) => k !== 'transactions').map(([k, v]) => <option key={k} value={k}>{v}s</option>)}
          </select>
        </div>

        <div className="relative">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-app-text-muted" />
          <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search by name, person or change" className={`${fieldClass} pl-9 bg-app-card`} />
        </div>

        {loading ? (
          <p className="p-6 text-sm text-app-text-muted text-center">Loading…</p>
        ) : loadError ? (
          <div className="p-6 text-center space-y-2">
            <p className="text-sm text-red-600 dark:text-red-400">{loadError}</p>
            <button onClick={() => void load()} className="inline-flex items-center gap-1.5 text-sm text-app-text underline cursor-pointer"><RotateCcw size={14} /> Try again</button>
          </div>
        ) : shown.length === 0 ? (
          <p className="p-6 text-sm text-app-text-muted text-center">{entries.length ? 'Nothing matches that search.' : 'No changes recorded in this period.'}</p>
        ) : (
          groups.map((list) => (
            <section key={dayKey(list[0].at)}>
              <h3 className="px-3 pb-1.5 text-xs font-semibold text-app-text-muted">{dayLabel(list[0].at)}</h3>
              <ul className="bg-app-card rounded-2xl ring-1 ring-app-border/70 overflow-hidden divide-y divide-app-border/60">
                {list.map((e) => {
                  const changes = describeChanges(e.changes);
                  const isOpen = open.has(e.id);
                  return (
                    <li key={e.id} data-search-id={`audit-${e.id}`}>
                      <button
                        type="button"
                        onClick={() => changes.length && toggle(e.id)}
                        className={`w-full text-left flex items-start gap-3 px-4 py-3 ${changes.length ? 'cursor-pointer hover:bg-app-bg/50' : 'cursor-default'}`}
                        aria-expanded={changes.length ? isOpen : undefined}
                      >
                        <span className={`mt-1.5 size-2 shrink-0 rounded-full ${ACTION_TONE[e.action] || 'bg-slate-400'}`} aria-hidden />
                        <div className="min-w-0 flex-1">
                          <p className="text-sm text-app-text break-words">
                            <span className="font-medium">{describeAction(e)}</span>
                            {e.label && <span className="text-app-text-muted"> · {e.label}</span>}
                          </p>
                          <p className="text-[11px] text-app-text-muted mt-0.5">
                            {clock(e.at)}{e.by ? ` · by ${e.by}` : ''}
                            {!isOpen && changes.length ? ` · ${changes.slice(0, 2).join(', ')}${changes.length > 2 ? ` and ${changes.length - 2} more` : ''}` : ''}
                          </p>
                          {isOpen && (
                            <ul className="mt-1.5 space-y-0.5">
                              {changes.map((c, i) => <li key={i} className="text-xs text-app-text break-words">{c}</li>)}
                            </ul>
                          )}
                        </div>
                        {changes.length > 0 && (isOpen ? <ChevronUp size={15} className="mt-1 text-app-text-muted shrink-0" /> : <ChevronDown size={15} className="mt-1 text-app-text-muted shrink-0" />)}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))
        )}
        {!loading && entries.length >= 500 && <p className="text-xs text-app-text-muted text-center">Showing the latest 500. Pick a shorter period or one kind of change to see older ones.</p>}
      </div>
    </div>
  );
}
