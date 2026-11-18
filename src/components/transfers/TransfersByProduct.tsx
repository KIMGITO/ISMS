// Stock Transfers → By product: every product line sent or received in a week, a month or
// any dates, grouped by product, with the branch and the day for each. Filter by branch,
// by sent/received, or search a product. Only stock that actually moved is listed (asked-for,
// drafts, declined and cancelled transfers moved nothing).
import React, { useEffect, useMemo, useState } from 'react';
import { ArrowDownLeft, ArrowUpRight, ChevronLeft, ChevronRight, Package, RotateCcw } from 'lucide-react';
import { getSupabase } from '../../services/supabaseClient';
import { toUuid } from '../../utils/idUtils';
import { toUserMessage } from '../../utils/userError';
import { searchMatch } from '../../utils/stringUtils';
import { FilterChips, Segmented } from '../shared/Choice';
import { SearchInput } from '../shared/Input';
import { addDays, kenyaDateKey, kenyaDayStart, periodRange, REPORT_TZ } from '../../services/stockReport';
import { formatMoney } from '../../utils/money';

export interface TransferLine {
  transferId: string;
  reference: string;
  status: string;
  direction: 'in' | 'out';
  otherBranch: string;
  sentAt: string;
  productName: string;
  unit: string;
  unitCost: number;
  quantitySent: number;
  quantityReceived: number | null;
}

type Span = 'week' | 'month' | 'custom';

const q = (n: number) => String(Math.round(n * 1000) / 1000);
const ksh = (n: number) => formatMoney(n);
const dayLabel = (iso: string) =>
  new Date(iso).toLocaleDateString('en-KE', { weekday: 'short', day: 'numeric', month: 'short', timeZone: REPORT_TZ });

/** Monday of the week that holds this Kenya day. */
function weekStart(key: string): string {
  const dow = (kenyaDayStart(key).getUTCDay() + 1) % 7; // the UTC day of Kenya midnight is the day before
  return addDays(key, -((dow + 6) % 7));
}

function shiftMonth(month: string, by: number): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + by, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

const dateBox =
  'min-w-0 w-full bg-app-bg ring-1 ring-app-border rounded-xl px-3 py-2 text-sm text-app-text tabular-nums [color-scheme:light] dark:[color-scheme:dark] focus:outline-none focus:ring-2 focus:ring-amber-500';

export default function TransfersByProduct({ businessId, fallback }: {
  businessId: string;
  /** Lines from the transfers already loaded, used when the server can't list by date. */
  fallback: TransferLine[];
}) {
  const today = kenyaDateKey();
  const [span, setSpan] = useState<Span>('week');
  const [week, setWeek] = useState(weekStart(today));
  const [month, setMonth] = useState(today.slice(0, 7));
  const [from, setFrom] = useState(addDays(today, -13));
  const [to, setTo] = useState(today);
  const [branch, setBranch] = useState('all');
  const [way, setWay] = useState<'all' | 'out' | 'in'>('all');
  const [search, setSearch] = useState('');

  const [lines, setLines] = useState<TransferLine[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [usingFallback, setUsingFallback] = useState(false);
  const [retry, setRetry] = useState(0);

  const range = useMemo(() => {
    if (span === 'week') return periodRange('custom', { from: week, to: addDays(week, 6) });
    if (span === 'month') return periodRange('month', { month });
    return periodRange('custom', { from, to });
  }, [span, week, month, from, to]);

  const label = useMemo(() => {
    const fmt = (d: Date, o: Intl.DateTimeFormatOptions) => d.toLocaleDateString('en-KE', { ...o, timeZone: REPORT_TZ });
    if (span === 'month') return fmt(range.from, { month: 'long', year: 'numeric' });
    const last = new Date(range.to.getTime() - 1);
    return `${fmt(range.from, { day: 'numeric', month: 'short' })} – ${fmt(last, { day: 'numeric', month: 'short', year: 'numeric' })}`;
  }, [span, range]);

  useEffect(() => {
    let live = true;
    setLoading(true);
    setError(null);
    void (async () => {
      const { data, error: err } = await getSupabase().rpc('list_stock_transfer_lines', {
        p_business_id: toUuid(businessId),
        p_from: range.from.toISOString(),
        p_to: range.to.toISOString(),
      });
      if (!live) return;
      setLoading(false);
      if (err) {
        // Not on the server yet: use what is loaded (the latest 200 transfers).
        if ((err as any).code === 'PGRST202' || /could not find the function/i.test(err.message || '')) {
          setUsingFallback(true);
          setLines(fallback.filter((l) => {
            const t = new Date(l.sentAt).getTime();
            return t >= range.from.getTime() && t < range.to.getTime();
          }));
          return;
        }
        setError(toUserMessage(err, 'Could not load transfers. Check your connection.'));
        return;
      }
      setUsingFallback(false);
      setLines((Array.isArray(data) ? data : []).map((r: any) => ({
        transferId: r.transferId,
        reference: r.reference,
        status: r.status,
        direction: r.direction,
        otherBranch: r.otherBranch || 'Branch',
        sentAt: r.sentAt,
        productName: r.productName || 'Product',
        unit: r.unit || '',
        unitCost: Number(r.unitCost) || 0,
        quantitySent: Number(r.quantitySent) || 0,
        quantityReceived: r.quantityReceived === null || r.quantityReceived === undefined ? null : Number(r.quantityReceived),
      })));
    })();
    return () => {
      live = false;
    };
    // fallback changes on every load of the parent; the range is what matters here
  }, [businessId, range.from.getTime(), range.to.getTime(), retry]); // eslint-disable-line react-hooks/exhaustive-deps

  const branches = useMemo(() => [...new Set(lines.map((l) => l.otherBranch))].sort(), [lines]);
  useEffect(() => {
    if (branch !== 'all' && !branches.includes(branch)) setBranch('all');
  }, [branches, branch]);

  const shown = lines.filter(
    (l) => (branch === 'all' || l.otherBranch === branch) && (way === 'all' || l.direction === way) && (!search.trim() || searchMatch(l.productName, search)),
  );

  const groups = useMemo(() => {
    const map = new Map<string, { name: string; unit: string; sent: number; received: number; value: number; rows: TransferLine[] }>();
    for (const l of shown) {
      const key = l.productName.trim().toLowerCase();
      const g = map.get(key) || { name: l.productName, unit: l.unit, sent: 0, received: 0, value: 0, rows: [] };
      const moved = l.direction === 'in' ? l.quantityReceived ?? l.quantitySent : l.quantitySent;
      if (l.direction === 'out') g.sent += moved;
      else g.received += moved;
      g.value += moved * l.unitCost;
      g.rows.push(l);
      map.set(key, g);
    }
    return [...map.values()].sort((a, b) => b.sent + b.received - (a.sent + a.received));
  }, [shown]);

  const step = (by: number) => {
    if (span === 'week') setWeek((w) => (addDays(w, by * 7) > today ? w : addDays(w, by * 7)));
    else if (span === 'month') setMonth((m) => (shiftMonth(m, by) > today.slice(0, 7) ? m : shiftMonth(m, by)));
  };
  const atLatest = span === 'week' ? addDays(week, 7) > today : span === 'month' ? month >= today.slice(0, 7) : true;

  return (
    <div className="space-y-3">
      <section className="bg-app-card rounded-2xl p-3 shadow-xs space-y-2.5">
        <Segmented<Span>
          ariaLabel="Period"
          value={span}
          onChange={setSpan}
          options={[
            { id: 'week', label: 'Week' },
            { id: 'month', label: 'Month' },
            { id: 'custom', label: 'Dates' },
          ]}
        />
        {span === 'custom' ? (
          <div className="grid grid-cols-2 gap-2">
            <label className="min-w-0 text-xs text-app-text-muted space-y-1">
              <span>From</span>
              <input type="date" value={from} max={today} onChange={(e) => e.target.value && setFrom(e.target.value)} className={dateBox} />
            </label>
            <label className="min-w-0 text-xs text-app-text-muted space-y-1">
              <span>To</span>
              <input type="date" value={to} max={today} onChange={(e) => e.target.value && setTo(e.target.value)} className={dateBox} />
            </label>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <button onClick={() => step(-1)} aria-label="Earlier" className="grid place-items-center size-9 rounded-xl bg-app-bg ring-1 ring-app-border text-app-text cursor-pointer shrink-0">
              <ChevronLeft size={17} />
            </button>
            <p className="flex-1 text-center text-sm font-medium text-app-text tabular-nums">{label}</p>
            <button
              onClick={() => step(1)}
              disabled={atLatest}
              aria-label="Later"
              className="grid place-items-center size-9 rounded-xl bg-app-bg ring-1 ring-app-border text-app-text cursor-pointer shrink-0 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <ChevronRight size={17} />
            </button>
          </div>
        )}
        <Segmented
          size="sm"
          ariaLabel="Direction"
          value={way}
          onChange={(v) => setWay(v as 'all' | 'out' | 'in')}
          options={[
            { id: 'all', label: 'All' },
            { id: 'out', label: 'Sent' },
            { id: 'in', label: 'Received' },
          ]}
        />
        {branches.length > 1 && (
          <FilterChips
            ariaLabel="Branch"
            value={branch}
            onChange={setBranch}
            options={[{ id: 'all', label: 'All branches' }, ...branches.map((b) => ({ id: b, label: b, count: lines.filter((l) => l.otherBranch === b).length }))]}
          />
        )}
        <SearchInput value={search} onChange={setSearch} placeholder="Search a product" size="sm" />
        {usingFallback && <p className="text-[11px] text-app-text-muted">Showing the latest 200 transfers only.</p>}
      </section>

      {loading ? (
        <p className="p-6 text-sm text-app-text-muted text-center">Loading…</p>
      ) : error ? (
        <section className="bg-app-card rounded-2xl p-6 text-center space-y-2 shadow-xs">
          <p className="text-sm text-red-700 dark:text-red-300">{error}</p>
          <button onClick={() => setRetry((n) => n + 1)} className="inline-flex items-center gap-1.5 text-sm text-app-text underline cursor-pointer">
            <RotateCcw size={14} /> Try again
          </button>
        </section>
      ) : groups.length === 0 ? (
        <section className="bg-app-card rounded-2xl p-8 text-center shadow-xs space-y-1">
          <Package size={28} className="mx-auto text-app-text-muted" />
          <p className="text-sm text-app-text">No stock moved between branches in this time.</p>
        </section>
      ) : (
        groups.map((g) => (
          <section key={g.name} className="bg-app-card rounded-2xl shadow-xs overflow-hidden">
            <div className="px-4 pt-3 pb-2 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="text-sm font-semibold text-app-text break-words">{g.name}</h3>
                <p className="text-xs text-app-text-muted tabular-nums">
                  {g.rows.length} {g.rows.length === 1 ? 'transfer' : 'transfers'} · {ksh(g.value)} at cost
                </p>
              </div>
              <div className="text-right text-xs tabular-nums shrink-0 space-y-0.5">
                {g.sent > 0 && <p className="text-indigo-700 dark:text-indigo-300 font-medium">Sent {q(g.sent)}{g.unit ? ` ${g.unit}` : ''}</p>}
                {g.received > 0 && <p className="text-teal-700 dark:text-teal-300 font-medium">Received {q(g.received)}{g.unit ? ` ${g.unit}` : ''}</p>}
              </div>
            </div>
            <ul className="divide-y divide-app-border border-t border-app-border">
              {g.rows.map((l, i) => {
                const moved = l.direction === 'in' ? l.quantityReceived ?? l.quantitySent : l.quantitySent;
                const short = l.quantityReceived !== null && l.quantityReceived < l.quantitySent;
                return (
                  <li key={`${l.transferId}-${i}`} className="px-4 py-2 flex items-center gap-3 text-sm">
                    <span
                      className={`grid place-items-center size-7 rounded-full shrink-0 ${
                        l.direction === 'out' ? 'bg-indigo-500/12 text-indigo-700 dark:text-indigo-300' : 'bg-teal-500/12 text-teal-700 dark:text-teal-300'
                      }`}
                      aria-label={l.direction === 'out' ? 'Sent' : 'Received'}
                    >
                      {l.direction === 'out' ? <ArrowUpRight size={14} /> : <ArrowDownLeft size={14} />}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-app-text truncate">
                        {l.direction === 'out' ? 'To' : 'From'} {l.otherBranch}
                      </p>
                      <p className="text-[11px] text-app-text-muted truncate">
                        {dayLabel(l.sentAt)} · {l.reference}
                        {l.status === 'in_transit' ? ' · on the way' : ''}
                        {short ? ` · ${q(l.quantityReceived!)} of ${q(l.quantitySent)} arrived` : ''}
                      </p>
                    </div>
                    <span className="tabular-nums font-medium text-app-text shrink-0">
                      {q(moved)}
                      {l.unit ? <span className="text-app-text-muted font-normal"> {l.unit}</span> : null}
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}
