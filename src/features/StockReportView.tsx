// Stock Report: the daily or monthly report owners used to type by hand for the boss
// ("Opening 34.5, Sales 3, Colors 10 ... Closed 107, Till 5040, Not paid ..."), worked out
// from the records for a day, a month or any dates. Per product: opening, what came in, where
// it went (counter sales, delivery, each big buyer, production, branches, waste), closing and
// how far that is from what the records expect; what was paid by method and who has not paid.
// Then who owes money now, and a notes box for anything else (tokens, meter readings).
// Copy it, share it on WhatsApp, or send it to the owners' notifications.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Check, ChevronLeft, ChevronRight, ClipboardCopy, FileBarChart, Package, RotateCcw, Send, Share2, SlidersHorizontal, Wallet, X,
} from 'lucide-react';
import { useBusinessStore } from '../stores/businessStore';
import { useAuthStore } from '../stores/authStore';
import { useNotificationStore } from '../stores/notificationStore';
import { useOverlay } from '../hooks/useOverlay';
import SheetLayer from '../components/shared/SheetLayer';
import { Segmented } from '../components/shared/Choice';
import { StatGrid, StatTile } from '../components/shared/StatTile';
import { Checkbox } from '../components/shared/Checkbox';
import { toUserMessage } from '../utils/userError';
import { NotificationService } from '../services/notifications/notificationService';
import { ReceiptShareService } from '../services/receipt/ReceiptShareService';
import {
  addDays, buildStockReport, fetchStockReport, kenyaDateKey, periodRange, periodTitle, stockReportText,
  type PeriodKind, type RawStockReport, type StockReportProduct,
} from '../services/stockReport';

const q = (n: number) => String(Math.round(n * 1000) / 1000);
const ksh = (n: number) => `KSh ${Math.round(n).toLocaleString('en-KE')}`;

function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
function save(key: string, value: unknown) {
  try {
    if (value === null || value === '' || (Array.isArray(value) && !value.length)) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* private mode: kept for this visit only */
  }
}

function shiftMonth(month: string, by: number): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + by, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

const dateBox =
  'min-w-0 w-full bg-app-bg ring-1 ring-app-border rounded-xl px-3 py-2 text-sm text-app-text tabular-nums [color-scheme:light] dark:[color-scheme:dark] focus:outline-none focus:ring-2 focus:ring-amber-500';

export default function StockReportView() {
  const businessId = useBusinessStore((s) => s.activeBusinessId);
  const branch = useBusinessStore((s) => s.businesses.find((b) => b.id === s.activeBusinessId)?.name) || 'This branch';
  const me = useAuthStore((s) => s.currentEmployee?.name) || 'Staff';
  const showToast = useNotificationStore((s) => s.showToast);

  const today = kenyaDateKey();
  const [kind, setKind] = useState<PeriodKind>('day');
  const [day, setDay] = useState(today);
  const [month, setMonth] = useState(today.slice(0, 7));
  const [from, setFrom] = useState(addDays(today, -6));
  const [to, setTo] = useState(today);
  const [byType, setByType] = useState(false);

  const [raw, setRaw] = useState<RawStockReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [copied, setCopied] = useState(false);
  const [sending, setSending] = useState(false);

  const value = { day, month, from, to };
  const range = useMemo(() => periodRange(kind, value), [kind, day, month, from, to]); // eslint-disable-line react-hooks/exhaustive-deps
  const period = periodTitle(kind, value);
  const periodKey = kind === 'day' ? day : kind === 'month' ? month : `${from}_${to}`;

  const productsKey = `kkm_stock_report_products_${businessId}`;
  const notesKey = `kkm_stock_report_notes_${businessId}_${periodKey}`;
  const [productIds, setProductIds] = useState<string[]>(() => load(productsKey, []));
  const [notes, setNotes] = useState('');
  useEffect(() => setProductIds(load(productsKey, [])), [productsKey]);
  useEffect(() => setNotes(load(notesKey, '')), [notesKey]);

  const refresh = useCallback(async () => {
    if (!businessId) return;
    setLoading(true);
    setError(null);
    try {
      setRaw(await fetchStockReport(businessId, range.from, range.to));
    } catch (e) {
      setError(toUserMessage(e, 'Could not load the report. Check your connection.'));
    } finally {
      setLoading(false);
    }
  }, [businessId, range.from.getTime(), range.to.getTime()]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const report = useMemo(
    () => (raw ? buildStockReport(raw, { productIds, groupBuyersByType: kind !== 'day' && byType }) : null),
    [raw, productIds, kind, byType],
  );
  const title = kind === 'month' ? 'Monthly stock report' : kind === 'day' ? 'Daily stock report' : 'Stock report';
  const text = report ? stockReportText(report, { title, branch, period, notes }) : '';

  const step = (by: number) => {
    if (kind === 'day') setDay((d) => (addDays(d, by) > today ? d : addDays(d, by)));
    else if (kind === 'month') setMonth((m) => (shiftMonth(m, by) > today.slice(0, 7) ? m : shiftMonth(m, by)));
  };
  const atLatest = kind === 'day' ? day >= today : kind === 'month' ? month >= today.slice(0, 7) : true;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      showToast('Not copied', 'Could not copy on this device.', undefined, 'error');
    }
  };

  const sendToOwners = () => {
    if (!report || sending) return;
    setSending(true);
    try {
      NotificationService.createNotification(
        'Custom Notification',
        { message: `${me} sent the ${title.toLowerCase()} for ${period}.` },
        {
          title: `${title}: ${branch}, ${period}`,
          role: 'Owner',
          priority: 'medium',
          actionTarget: 'none',
          payloadExtra: { reportText: text, reportTitle: `${title} · ${period}`, employeeName: me },
        },
      );
      showToast('Report sent', 'The owners can read it in Notifications.', undefined, 'success');
    } catch (e) {
      showToast('Not sent', toUserMessage(e, 'Copy it and send it on WhatsApp instead.'), undefined, 'error');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="h-full overflow-y-auto overflow-x-hidden bg-app-bg pb-nav">
      <div className="max-w-3xl mx-auto px-3 pt-3 sm:px-5 sm:pt-5 space-y-3">
        {/* Period */}
        <section className="bg-app-card rounded-2xl p-4 shadow-xs space-y-3">
          <div className="flex items-center gap-2 min-w-0">
            <span className="grid place-items-center size-9 rounded-full bg-amber-500/15 text-amber-700 dark:text-amber-400 shrink-0">
              <FileBarChart size={18} />
            </span>
            <div className="min-w-0 flex-1">
              <h2 className="text-sm font-semibold text-app-text">{title}</h2>
              <p className="text-xs text-app-text-muted truncate">{branch}</p>
            </div>
            <button
              onClick={() => setPicking(true)}
              className="flex items-center gap-1.5 bg-app-bg ring-1 ring-app-border text-app-text text-sm font-medium rounded-xl px-3 py-2 cursor-pointer shrink-0"
            >
              <SlidersHorizontal size={15} /> Products{productIds.length ? ` (${productIds.length})` : ''}
            </button>
          </div>

          <Segmented<PeriodKind>
            ariaLabel="Report period"
            value={kind}
            onChange={setKind}
            options={[
              { id: 'day', label: 'Day' },
              { id: 'month', label: 'Month' },
              { id: 'custom', label: 'Dates' },
            ]}
          />

          {kind === 'custom' ? (
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
              <button onClick={() => step(-1)} aria-label="Earlier" className="grid place-items-center size-10 rounded-xl bg-app-bg ring-1 ring-app-border text-app-text cursor-pointer shrink-0">
                <ChevronLeft size={18} />
              </button>
              {kind === 'day' ? (
                <input type="date" aria-label="Day" value={day} max={today} onChange={(e) => e.target.value && setDay(e.target.value)} className={dateBox} />
              ) : (
                <input type="month" aria-label="Month" value={month} max={today.slice(0, 7)} onChange={(e) => e.target.value && setMonth(e.target.value)} className={dateBox} />
              )}
              <button
                onClick={() => step(1)}
                disabled={atLatest}
                aria-label="Later"
                className="grid place-items-center size-10 rounded-xl bg-app-bg ring-1 ring-app-border text-app-text cursor-pointer shrink-0 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <ChevronRight size={18} />
              </button>
            </div>
          )}

          {kind !== 'day' && (
            <Segmented
              size="sm"
              ariaLabel="Big buyers"
              value={byType ? 'type' : 'name'}
              onChange={(v) => setByType(v === 'type')}
              options={[
                { id: 'name', label: 'Buyers by name' },
                { id: 'type', label: 'Buyers by type' },
              ]}
            />
          )}
        </section>

        {loading && !report ? (
          <p className="p-6 text-sm text-app-text-muted text-center">Loading…</p>
        ) : error ? (
          <section className="bg-app-card rounded-2xl p-6 text-center space-y-2 shadow-xs">
            <p className="text-sm text-red-700 dark:text-red-300">{error}</p>
            <button onClick={() => void refresh()} className="inline-flex items-center gap-1.5 text-sm text-app-text underline cursor-pointer">
              <RotateCcw size={14} /> Try again
            </button>
          </section>
        ) : report ? (
          <>
            <StatGrid>
              <StatTile icon={<Wallet />} tone="emerald" label="Paid" value={ksh(report.paidTotal)} note={report.paidByMethod.filter((l) => l.value).map((l) => l.label).join(' · ') || 'Nothing yet'} />
              <StatTile icon={<Wallet />} tone={report.notPaidTotal ? 'red' : 'slate'} label="Not paid" value={ksh(report.notPaidTotal)} note="Sold on credit" />
              <StatTile icon={<Wallet />} tone="rose" label="Owed now" value={ksh(report.debtsTotal)} note={`${report.debts.length} ${report.debts.length === 1 ? 'customer' : 'customers'}`} />
              <StatTile icon={<Package />} tone="sky" label="Products" value={report.products.length} note={productIds.length ? 'Chosen' : 'That moved'} />
            </StatGrid>

            {report.products.length === 0 ? (
              <section className="bg-app-card rounded-2xl p-8 text-center shadow-xs space-y-1">
                <Package size={28} className="mx-auto text-app-text-muted" />
                <p className="text-sm text-app-text">No stock moved {kind === 'day' ? 'this day' : 'in this time'}.</p>
              </section>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                {report.products.map((p) => (
                  <ProductCard key={p.id} p={p} />
                ))}
              </div>
            )}

            {report.paidByMethod.length > 0 && (
              <section className="bg-app-card rounded-2xl p-4 shadow-xs">
                <h3 className="text-sm font-semibold text-app-text mb-2">Money</h3>
                <dl className="divide-y divide-app-border text-sm">
                  {report.paidByMethod.map((l) => (
                    <Row key={l.label} label={l.label} value={ksh(l.value || 0)} />
                  ))}
                  <Row label="Total paid" value={ksh(report.paidTotal)} strong />
                  {report.notPaidTotal > 0 && <Row label="Not paid" value={ksh(report.notPaidTotal)} tone="bad" />}
                </dl>
              </section>
            )}

            {report.debts.length > 0 && (
              <section className="bg-app-card rounded-2xl p-4 shadow-xs">
                <div className="flex items-baseline justify-between gap-2 mb-2">
                  <h3 className="text-sm font-semibold text-app-text">Pending bills</h3>
                  <span className="text-xs text-app-text-muted">Owed now</span>
                </div>
                <ol className="divide-y divide-app-border text-sm">
                  {report.debts.map((d, i) => (
                    <li key={`${d.name}-${i}`} className="flex items-center justify-between gap-3 py-1.5">
                      <span className="min-w-0 truncate text-app-text">
                        <span className="text-app-text-muted tabular-nums mr-2">{i + 1}.</span>
                        {d.name}
                      </span>
                      <span className="shrink-0 tabular-nums font-medium text-app-text">{ksh(d.owes)}</span>
                    </li>
                  ))}
                  <li className="flex items-center justify-between gap-3 pt-2">
                    <span className="font-semibold text-app-text">Total</span>
                    <span className="tabular-nums font-semibold text-red-700 dark:text-red-300">{ksh(report.debtsTotal)}</span>
                  </li>
                </ol>
              </section>
            )}

            <section className="bg-app-card rounded-2xl p-4 shadow-xs space-y-2">
              <label htmlFor="stock-report-notes" className="text-sm font-semibold text-app-text">
                Notes
              </label>
              <textarea
                id="stock-report-notes"
                value={notes}
                onChange={(e) => {
                  setNotes(e.target.value);
                  save(notesKey, e.target.value);
                }}
                rows={3}
                placeholder="Tokens, readings, anything else"
                className="w-full bg-app-bg ring-1 ring-app-border rounded-xl px-3 py-2 text-sm text-app-text placeholder:text-app-text-muted focus:outline-none focus:ring-2 focus:ring-amber-500"
              />
            </section>

            <section className="grid grid-cols-3 gap-2 pb-3">
              <button onClick={() => void copy()} className="flex flex-col sm:flex-row items-center justify-center gap-1.5 bg-app-card ring-1 ring-app-border text-app-text text-sm font-medium rounded-xl px-3 py-2.5 cursor-pointer">
                {copied ? <Check size={16} /> : <ClipboardCopy size={16} />} {copied ? 'Copied' : 'Copy'}
              </button>
              <button
                onClick={() => void ReceiptShareService.shareTextViaWhatsApp('', text)}
                className="flex flex-col sm:flex-row items-center justify-center gap-1.5 bg-app-card ring-1 ring-app-border text-app-text text-sm font-medium rounded-xl px-3 py-2.5 cursor-pointer"
              >
                <Share2 size={16} /> WhatsApp
              </button>
              <button
                onClick={sendToOwners}
                disabled={sending}
                className="flex flex-col sm:flex-row items-center justify-center gap-1.5 bg-amber-500 hover:bg-amber-600 text-slate-950 text-sm font-semibold rounded-xl px-3 py-2.5 cursor-pointer disabled:opacity-60"
              >
                <Send size={16} /> To owners
              </button>
            </section>
          </>
        ) : null}
      </div>

      {picking && raw && (
        <ProductPicker
          products={raw.products}
          chosen={productIds}
          onClose={() => setPicking(false)}
          onSave={(ids) => {
            setProductIds(ids);
            save(productsKey, ids);
            setPicking(false);
          }}
        />
      )}
    </div>
  );
}

function Row({ label, value, strong, tone }: { label: string; value: string; strong?: boolean; tone?: 'good' | 'bad' }) {
  const color = tone === 'bad' ? 'text-red-700 dark:text-red-300' : tone === 'good' ? 'text-emerald-700 dark:text-emerald-300' : 'text-app-text';
  return (
    <div className="flex items-center justify-between gap-3 py-1.5">
      <dt className={`min-w-0 truncate ${strong ? 'font-semibold text-app-text' : 'text-app-text-muted'}`}>{label}</dt>
      <dd className={`shrink-0 tabular-nums ${strong ? 'font-semibold' : 'font-medium'} ${color}`}>{value}</dd>
    </div>
  );
}

function ProductCard({ p }: { p: StockReportProduct }) {
  const unit = p.unit ? ` ${p.unit}` : '';
  const diff = p.difference;
  return (
    <section className="bg-app-card rounded-2xl p-4 shadow-xs min-w-0">
      <div className="flex items-baseline justify-between gap-2 mb-1">
        <h3 className="text-sm font-semibold text-app-text min-w-0 break-words">{p.name}</h3>
        {p.soldValue > 0 && <span className="text-xs text-app-text-muted tabular-nums shrink-0">{ksh(p.soldValue)} sold</span>}
      </div>
      <dl className="text-sm">
        <Row label="Opening" value={`${q(p.opening)}${unit}`} strong />
        {p.added.map((l) => (
          <Row key={`in-${l.label}`} label={`+ ${l.label}`} value={q(l.qty)} tone="good" />
        ))}
        {p.out.map((l) => (
          <Row key={`out-${l.label}`} label={`− ${l.label}`} value={q(l.qty)} />
        ))}
        <div className="border-t border-app-border mt-1" />
        <Row label="Closed" value={`${q(p.closing)}${unit}`} strong />
      </dl>
      {diff !== 0 && (
        <p
          className={`mt-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium ${
            diff < 0 ? 'bg-red-500/10 text-red-800 dark:text-red-200' : 'bg-sky-500/10 text-sky-800 dark:text-sky-200'
          }`}
        >
          {diff < 0 ? `${q(-diff)}${unit} short` : `${q(diff)}${unit} more`} than the {q(p.expected)} the records expect
        </p>
      )}
      {(p.paid.length > 0 || p.notPaid.length > 0) && (
        <div className="mt-3 pt-2 border-t border-app-border space-y-1.5 text-sm">
          {p.paid.map((l) => (
            <div key={l.label} className="flex justify-between gap-3">
              <span className="text-app-text-muted">{l.label === 'M-Pesa' ? 'Till (M-Pesa)' : l.label}</span>
              <span className="tabular-nums font-medium text-app-text">{ksh(l.value || 0)}</span>
            </div>
          ))}
          {p.notPaid.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-red-700 dark:text-red-300 mt-1">Not paid</p>
              <ol className="mt-0.5 space-y-0.5">
                {p.notPaid.map((l, i) => (
                  <li key={l.label} className="flex justify-between gap-3">
                    <span className="min-w-0 truncate text-app-text">
                      <span className="text-app-text-muted tabular-nums mr-1.5">{i + 1}.</span>
                      {l.label} <span className="text-app-text-muted">· {q(l.qty)}{unit}</span>
                    </span>
                    <span className="tabular-nums text-app-text shrink-0">{ksh(l.value || 0)}</span>
                  </li>
                ))}
              </ol>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function ProductPicker({ products, chosen, onClose, onSave }: {
  products: RawStockReport['products'];
  chosen: string[];
  onClose: () => void;
  onSave: (ids: string[]) => void;
}) {
  useOverlay(true, onClose, 'bottom-sheet');
  const [ids, setIds] = useState<string[]>(chosen);
  const sorted = [...products].sort((a, b) => a.name.localeCompare(b.name));
  return (
    <SheetLayer>
      <div className="fixed inset-0 z-[9000] flex items-end sm:items-center justify-center bg-black/40 sm:p-4" onClick={onClose}>
        <div className="w-full sm:max-w-md bg-app-card rounded-t-2xl sm:rounded-2xl max-h-[88vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center justify-between gap-2 px-4 pt-4 pb-1">
            <h3 className="text-base font-semibold text-app-text">Products in the report</h3>
            <button onClick={onClose} aria-label="Close" className="p-1.5 rounded-lg text-app-text-muted hover:bg-app-bg cursor-pointer">
              <X size={18} />
            </button>
          </div>
          <p className="px-4 pb-2 text-xs text-app-text-muted">None ticked: every product that moved.</p>
          <ul className="overflow-y-auto px-2 min-h-0 divide-y divide-app-border">
            {sorted.map((p) => {
              const on = ids.includes(p.id);
              return (
                <li key={p.id} className="px-2 py-2.5">
                  <Checkbox
                    checked={on}
                    onChange={(v) => setIds((cur) => (v ? [...cur, p.id] : cur.filter((x) => x !== p.id)))}
                    label={p.unit ? `${p.name} (${p.unit})` : p.name}
                  />
                </li>
              );
            })}
          </ul>
          <div className="flex gap-2 p-4 pb-[calc(1rem+var(--inset-bottom))]">
            <button onClick={() => setIds([])} className="flex-1 bg-app-bg ring-1 ring-app-border text-app-text text-sm font-medium rounded-xl px-4 py-2.5 cursor-pointer">
              Clear
            </button>
            <button onClick={() => onSave(ids)} className="flex-1 bg-amber-500 hover:bg-amber-600 text-slate-950 text-sm font-semibold rounded-xl px-4 py-2.5 cursor-pointer">
              Save
            </button>
          </div>
        </div>
      </div>
    </SheetLayer>
  );
}
