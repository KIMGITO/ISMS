// Stock Transfers: moving stock between branches (e.g. Main supplies the shops).
// Sending takes the stock off this branch at once; the receiving branch counts what arrived
// and confirms, and only that is added there. Nothing here is a sale or an expense, so sales,
// profit and cash are untouched; each line carries the sender's cost so the receiving branch's
// cost (and later profit) stays true. All of it runs in the database (send/receive/cancel).
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowRight, ArrowRightLeft, Check, PackageCheck, Plus, RotateCcw, Search, Send, Trash2, Truck, X } from 'lucide-react';
import { getSupabase } from '../services/supabaseClient';
import { useBusinessStore } from '../stores/businessStore';
import { useAuthStore } from '../stores/authStore';
import { useAppStore } from '../stores/appStore';
import { useNotificationStore } from '../stores/notificationStore';
import { hasRolePermission } from '../utils/permissions';
import { toUserMessage } from '../utils/userError';
import { toUuid } from '../utils/idUtils';
import { searchMatch } from '../utils/stringUtils';
import { useOverlay } from '../hooks/useOverlay';
import SheetLayer from '../components/shared/SheetLayer';
import type { Product } from '../types';

const TZ = 'Africa/Nairobi';

interface TransferItem {
  id: string;
  fromProductId: string | null;
  toProductId: string | null;
  productName: string;
  sku: string | null;
  unit: string;
  unitCost: number;
  quantitySent: number;
  quantityReceived: number | null;
}

interface Transfer {
  id: string;
  reference: string;
  direction: 'in' | 'out';
  fromName: string;
  toName: string;
  status: 'in_transit' | 'received' | 'cancelled';
  note: string | null;
  sentBy: string;
  sentAt: string;
  receivedBy: string | null;
  receivedAt: string | null;
  receiveNote: string | null;
  cancelledBy: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  items: TransferItem[];
}

interface Branch {
  id: string;
  name: string;
}

const ksh = (n: number) => `KSh ${Math.round(n).toLocaleString()}`;
const qty = (n: number) => String(Math.round(n * 1000) / 1000);
const when = (iso: string) => {
  const d = new Date(iso);
  const key = d.toLocaleDateString('en-CA', { timeZone: TZ });
  const today = new Date().toLocaleDateString('en-CA', { timeZone: TZ });
  const yesterday = new Date(Date.now() - 864e5).toLocaleDateString('en-CA', { timeZone: TZ });
  const time = d.toLocaleTimeString('en-KE', { hour: 'numeric', minute: '2-digit', timeZone: TZ });
  if (key === today) return `Today ${time}`;
  if (key === yesterday) return `Yesterday ${time}`;
  return `${d.toLocaleDateString('en-KE', { day: 'numeric', month: 'short', timeZone: TZ })} ${time}`;
};
const sentValue = (t: Transfer) => t.items.reduce((s, i) => s + i.quantitySent * i.unitCost, 0);
const shortValue = (t: Transfer) =>
  t.items.reduce((s, i) => s + (i.quantityReceived === null ? 0 : (i.quantitySent - i.quantityReceived) * i.unitCost), 0);

function mapTransfer(r: any): Transfer {
  return {
    id: r.id,
    reference: r.reference,
    direction: r.direction,
    fromName: r.fromName,
    toName: r.toName,
    status: r.status,
    note: r.note,
    sentBy: r.sentBy,
    sentAt: r.sentAt,
    receivedBy: r.receivedBy,
    receivedAt: r.receivedAt,
    receiveNote: r.receiveNote,
    cancelledBy: r.cancelledBy,
    cancelledAt: r.cancelledAt,
    cancelReason: r.cancelReason,
    items: (r.items || []).map((i: any) => ({
      id: i.id,
      fromProductId: i.fromProductId,
      toProductId: i.toProductId,
      productName: i.productName,
      sku: i.sku,
      unit: i.unit,
      unitCost: Number(i.unitCost) || 0,
      quantitySent: Number(i.quantitySent) || 0,
      quantityReceived: i.quantityReceived === null || i.quantityReceived === undefined ? null : Number(i.quantityReceived),
    })),
  };
}

/** The product at this branch an arriving line will be added to (same SKU, else same name). */
function matchHere(item: TransferItem, products: Product[]): Product | undefined {
  const live = products.filter((p) => !(p as any).deletedAt);
  if (item.sku) {
    const bySku = live.find((p) => p.sku && p.sku === item.sku);
    if (bySku) return bySku;
  }
  const name = item.productName.trim().toLowerCase();
  return live.find((p) => (p.name || '').trim().toLowerCase() === name);
}

const STATUS: Record<Transfer['status'], { label: string; cls: string }> = {
  in_transit: { label: 'On the way', cls: 'bg-amber-500/15 text-amber-700 dark:text-amber-400' },
  received: { label: 'Received', cls: 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-400' },
  cancelled: { label: 'Cancelled', cls: 'bg-slate-500/12 text-slate-600 dark:text-slate-300' },
};

export default function StockTransfersView() {
  const businessId = useBusinessStore((s) => s.activeBusinessId);
  const branchName = useBusinessStore((s) => s.businesses.find((b) => b.id === s.activeBusinessId)?.name) || 'This branch';
  const role = useAuthStore((s) => s.currentEmployee?.role) || 'Guest';
  const showToast = useNotificationStore((s) => s.showToast);
  const { products } = useAppStore();
  const canSend = hasRolePermission(role, 'inventory.transfer_stock');
  const canReceive = canSend || hasRolePermission(role, 'inventory.receive_stock');

  const [tab, setTab] = useState<'open' | 'history'>('open');
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  const load = useCallback(async () => {
    if (!businessId) return;
    setLoadError(null);
    const { data, error } = await getSupabase().rpc('list_stock_transfers', { p_business_id: toUuid(businessId), p_limit: 200 });
    setLoading(false);
    if (error) {
      setLoadError(toUserMessage(error, 'Could not load transfers. Check your connection.'));
      return;
    }
    setTransfers((Array.isArray(data) ? data : []).map(mapTransfer));
  }, [businessId]);

  useEffect(() => {
    setLoading(true);
    void load();
  }, [load]);

  // Live: the other branch sending, receiving or cancelling shows here at once.
  useEffect(() => {
    if (!businessId) return;
    const id = toUuid(businessId);
    const channel = getSupabase()
      .channel(`stock-transfers-${id}-${Math.random().toString(36).slice(2, 8)}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'stock_transfers', filter: `from_business_id=eq.${id}` }, () => void load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'stock_transfers', filter: `to_business_id=eq.${id}` }, () => void load())
      .subscribe();
    return () => {
      void getSupabase().removeChannel(channel);
    };
  }, [businessId, load]);

  const incoming = transfers.filter((t) => t.status === 'in_transit' && t.direction === 'in');
  const outgoing = transfers.filter((t) => t.status === 'in_transit' && t.direction === 'out');
  const history = transfers.filter((t) => t.status !== 'in_transit');
  const onTheWayValue = outgoing.reduce((s, t) => s + sentValue(t), 0);
  const opened = transfers.find((t) => t.id === openId) || null;

  const list = tab === 'open' ? [...incoming, ...outgoing] : history;

  return (
    <div className="h-full overflow-y-auto overflow-x-hidden bg-app-bg pb-nav">
      <div className="max-w-3xl mx-auto px-3 pt-3 sm:px-5 sm:pt-5 space-y-3">
        {/* Summary */}
        <section className="bg-app-card rounded-2xl p-4 shadow-xs space-y-3">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2 min-w-0">
              <span className="grid place-items-center size-9 rounded-full bg-indigo-500/15 text-indigo-600 dark:text-indigo-400 shrink-0">
                <ArrowRightLeft size={18} />
              </span>
              <div className="min-w-0">
                <h2 className="text-sm font-semibold text-app-text">Stock between branches</h2>
                <p className="text-xs text-app-text-muted">Not a sale or an expense: sales, profit and cash don't change.</p>
              </div>
            </div>
            {canSend && (
              <button
                data-shortcut="new"
                onClick={() => setSending(true)}
                className="flex items-center gap-1.5 bg-amber-500 hover:bg-amber-600 text-slate-950 font-semibold text-sm rounded-xl px-4 py-2.5 cursor-pointer"
              >
                <Send size={15} /> Send stock
              </button>
            )}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-xl bg-app-bg p-3">
              <p className="text-[11px] text-app-text-muted">Coming to {branchName}</p>
              <p className="text-lg font-bold text-app-text tabular-nums">{incoming.length}</p>
            </div>
            <div className="rounded-xl bg-app-bg p-3">
              <p className="text-[11px] text-app-text-muted">Sent, not yet received</p>
              <p className="text-lg font-bold text-app-text tabular-nums">
                {outgoing.length} <span className="text-xs font-medium text-app-text-muted">· {ksh(onTheWayValue)} at cost</span>
              </p>
            </div>
          </div>
        </section>

        {/* Tabs */}
        <div role="tablist" className="flex bg-app-card rounded-xl p-1 shadow-xs">
          {([
            ['open', `On the way (${incoming.length + outgoing.length})`],
            ['history', 'History'],
          ] as const).map(([id, label]) => (
            <button
              key={id}
              role="tab"
              aria-selected={tab === id}
              onClick={() => setTab(id)}
              className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium cursor-pointer ${tab === id ? 'bg-amber-500 text-slate-950' : 'text-app-text-muted'}`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* List */}
        <section className="bg-app-card rounded-2xl shadow-xs overflow-hidden">
          {loading ? (
            <p className="p-6 text-sm text-app-text-muted text-center">Loading…</p>
          ) : loadError ? (
            <div className="p-6 text-center space-y-2">
              <p className="text-sm text-red-600 dark:text-red-400">{loadError}</p>
              <button onClick={() => void load()} className="inline-flex items-center gap-1.5 text-sm text-app-text underline cursor-pointer">
                <RotateCcw size={14} /> Try again
              </button>
            </div>
          ) : list.length === 0 ? (
            <div className="p-8 text-center space-y-1">
              <Truck size={28} className="mx-auto text-app-text-muted" />
              <p className="text-sm text-app-text">{tab === 'open' ? 'Nothing on the way.' : 'No transfers yet.'}</p>
              {tab === 'open' && canSend && <p className="text-xs text-app-text-muted">Tap Send stock to supply another branch.</p>}
            </div>
          ) : (
            <ul className="divide-y divide-app-border">
              {list.map((t) => {
                const short = shortValue(t);
                return (
                  <li key={t.id}>
                    <button onClick={() => setOpenId(t.id)} className="w-full text-left px-4 py-3 flex items-start gap-3 hover:bg-app-bg cursor-pointer">
                      <span
                        className={`grid place-items-center size-9 rounded-full shrink-0 ${
                          t.direction === 'in' ? 'bg-teal-500/12 text-teal-600 dark:text-teal-400' : 'bg-indigo-500/12 text-indigo-600 dark:text-indigo-400'
                        }`}
                      >
                        {t.direction === 'in' ? <PackageCheck size={17} /> : <Send size={16} />}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-app-text flex items-center gap-1.5 flex-wrap">
                          <span className="break-words">{t.fromName}</span>
                          <ArrowRight size={13} className="text-app-text-muted shrink-0" />
                          <span className="break-words">{t.toName}</span>
                        </p>
                        <p className="text-[11px] text-app-text-muted mt-0.5 break-words">
                          {t.reference} · {when(t.sentAt)} · {t.items.length} {t.items.length === 1 ? 'product' : 'products'} · {ksh(sentValue(t))}
                        </p>
                        {t.status === 'received' && short > 0 && (
                          <p className="text-[11px] text-red-600 dark:text-red-400 mt-0.5">Arrived short · {ksh(short)} at cost</p>
                        )}
                      </div>
                      <span className={`shrink-0 px-2 py-1 rounded-full text-[11px] font-medium ${STATUS[t.status].cls}`}>
                        {t.status === 'in_transit' && t.direction === 'in' ? 'To receive' : STATUS[t.status].label}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>

      {sending && businessId && (
        <SendSheet
          businessId={businessId}
          branchName={branchName}
          products={products}
          onClose={() => setSending(false)}
          onSent={(reference, toName) => {
            setSending(false);
            setTab('open');
            showToast('Stock sent', `${reference} is on the way to ${toName}. It is off this branch's stock now.`, undefined, 'success');
            void load();
          }}
        />
      )}

      {opened && (
        <DetailSheet
          transfer={opened}
          products={products}
          canReceive={canReceive}
          canCancel={canSend}
          onClose={() => setOpenId(null)}
          onDone={(title, message) => {
            setOpenId(null);
            showToast(title, message, undefined, 'success');
            void load();
          }}
          onError={(title, message) => showToast(title, message, undefined, 'error')}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Send
// ---------------------------------------------------------------------------
function SendSheet({
  businessId,
  branchName,
  products,
  onClose,
  onSent,
}: {
  businessId: string;
  branchName: string;
  products: Product[];
  onClose: () => void;
  onSent: (reference: string, toName: string) => void;
}) {
  useOverlay(true, onClose, 'bottom-sheet');
  const [branches, setBranches] = useState<Branch[] | null>(null);
  const [branchError, setBranchError] = useState<string | null>(null);
  const [to, setTo] = useState<string>('');
  const [lines, setLines] = useState<{ productId: string; qty: string }[]>([]);
  const [query, setQuery] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // One reference per sheet, so a retry after a dropped connection cannot send twice.
  const [reference] = useState(() => `tr-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);

  useEffect(() => {
    let live = true;
    void getSupabase()
      .rpc('list_transfer_branches', { p_business_id: toUuid(businessId) })
      .then(({ data, error: e }) => {
        if (!live) return;
        if (e) return setBranchError(toUserMessage(e, 'Could not load your branches.'));
        const list = (data || []).map((b: any) => ({ id: b.id, name: b.name }));
        setBranches(list);
        if (list.length === 1) setTo(list[0].id);
      });
    return () => {
      live = false;
    };
  }, [businessId]);

  const byId = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const picked = new Set(lines.map((l) => l.productId));
  const matches = useMemo(() => {
    const q = query.trim();
    return products
      .filter((p) => !picked.has(p.id) && (p.stock || 0) > 0 && (!q || searchMatch([p.name, p.sku, p.category].filter(Boolean).join(' '), q)))
      .slice(0, q ? 30 : 12);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [products, query, lines]);

  const rows = lines.map((l) => {
    const p = byId.get(l.productId);
    const n = Number(l.qty);
    const problem = !p
      ? 'Not in this branch any more'
      : !Number.isFinite(n) || n <= 0
        ? 'Enter how much'
        : n > (p.stock || 0)
          ? `Only ${qty(p.stock || 0)} ${p.unit} here`
          : null;
    return { ...l, product: p, n, problem };
  });
  const total = rows.reduce((s, r) => s + (r.product && !r.problem ? r.n * (r.product.cost || 0) : 0), 0);
  const toName = branches?.find((b) => b.id === to)?.name || '';
  const ready = !!to && rows.length > 0 && rows.every((r) => !r.problem) && !busy;

  const submit = async () => {
    if (!ready) return;
    setBusy(true);
    setError(null);
    const { data, error: e } = await getSupabase().rpc('send_stock_transfer', {
      p_from_business_id: toUuid(businessId),
      p_to_business_id: to,
      p_items: rows.map((r) => ({ product_id: toUuid(r.productId), quantity: r.n })),
      p_note: note.trim() || null,
      p_reference_id: reference,
    });
    setBusy(false);
    if (e) return setError(toUserMessage(e, 'Could not send. Check your connection and try again.'));
    onSent((data as any)?.reference || 'Transfer', toName);
  };

  const input = 'w-full bg-app-bg border border-app-border rounded-xl px-3 py-2.5 text-sm text-app-text focus:outline-none focus:ring-1 focus:ring-amber-500';

  return (
    <SheetLayer>
      <div className="fixed inset-0 z-[9000] flex items-end sm:items-center justify-center bg-black/40 sm:p-4" onClick={onClose}>
        <div
          className="w-full sm:max-w-lg bg-app-card rounded-t-2xl sm:rounded-2xl max-h-[92vh] flex flex-col"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between gap-2 px-4 pt-4 pb-2">
            <h3 className="text-base font-semibold text-app-text">Send stock from {branchName}</h3>
            <button onClick={onClose} aria-label="Close" className="p-1.5 rounded-lg text-app-text-muted hover:bg-app-bg cursor-pointer">
              <X size={18} />
            </button>
          </div>

          <div className="overflow-y-auto px-4 pb-3 space-y-4 min-h-0">
            {/* Branch */}
            <div>
              <p className="text-xs font-medium text-app-text-muted mb-1.5">To</p>
              {branchError ? (
                <p className="text-xs text-red-600 dark:text-red-400">{branchError}</p>
              ) : branches === null ? (
                <p className="text-xs text-app-text-muted">Loading branches…</p>
              ) : branches.length === 0 ? (
                <p className="text-xs text-app-text-muted">
                  There is no other branch to send to. Branches must have the same owner; add one under Business Management.
                </p>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {branches.map((b) => (
                    <button
                      key={b.id}
                      onClick={() => setTo(b.id)}
                      aria-pressed={to === b.id}
                      className={`px-3 py-1.5 rounded-full text-sm font-medium cursor-pointer ${to === b.id ? 'bg-amber-500 text-slate-950' : 'bg-app-bg text-app-text border border-app-border'}`}
                    >
                      {b.name}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Picked */}
            {rows.length > 0 && (
              <ul className="space-y-2">
                {rows.map((r) => (
                  <li key={r.productId} className="rounded-xl bg-app-bg p-3">
                    <div className="flex items-start gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-app-text break-words">{r.product?.name || 'Removed product'}</p>
                        {r.product && (
                          <p className="text-[11px] text-app-text-muted">
                            {qty(r.product.stock || 0)} {r.product.unit} here · cost {ksh(r.product.cost || 0)} each
                          </p>
                        )}
                      </div>
                      <input
                        type="number"
                        inputMode="decimal"
                        min="0"
                        step="any"
                        value={r.qty}
                        onChange={(e) => setLines((ls) => ls.map((l) => (l.productId === r.productId ? { ...l, qty: e.target.value } : l)))}
                        aria-label={`How much ${r.product?.name || ''} to send`}
                        className="w-24 bg-app-card border border-app-border rounded-lg px-2 py-1.5 text-sm text-right tabular-nums text-app-text focus:outline-none focus:ring-1 focus:ring-amber-500"
                      />
                      <button
                        onClick={() => setLines((ls) => ls.filter((l) => l.productId !== r.productId))}
                        aria-label="Remove"
                        className="p-1.5 rounded-lg text-app-text-muted hover:text-red-500 cursor-pointer"
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                    {r.problem && <p className="text-[11px] text-red-600 dark:text-red-400 mt-1">{r.problem}</p>}
                  </li>
                ))}
              </ul>
            )}

            {/* Add products */}
            <div>
              <p className="text-xs font-medium text-app-text-muted mb-1.5">Add products</p>
              <div className="relative">
                <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-app-text-muted" />
                <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search product or SKU" className={`${input} pl-9`} />
              </div>
              <ul className="mt-2 max-h-56 overflow-y-auto divide-y divide-app-border rounded-xl border border-app-border">
                {matches.length === 0 ? (
                  <li className="p-3 text-xs text-app-text-muted text-center">{query ? 'No product with stock matches.' : 'No products with stock.'}</li>
                ) : (
                  matches.map((p) => (
                    <li key={p.id}>
                      <button
                        onClick={() => {
                          setLines((ls) => [...ls, { productId: p.id, qty: '' }]);
                          setQuery('');
                        }}
                        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-app-bg cursor-pointer"
                      >
                        <Plus size={14} className="text-amber-600 shrink-0" />
                        <span className="text-sm text-app-text flex-1 min-w-0 truncate">{p.name}</span>
                        <span className="text-[11px] text-app-text-muted shrink-0 tabular-nums">
                          {qty(p.stock || 0)} {p.unit}
                        </span>
                      </button>
                    </li>
                  ))
                )}
              </ul>
            </div>

            <label className="block text-xs font-medium text-app-text-muted">
              Note (optional)
              <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} placeholder="e.g. With Kamau, morning van" className={`${input} mt-1`} />
            </label>
          </div>

          <div className="border-t border-app-border px-4 pt-3 pb-[calc(1rem+var(--inset-bottom,0px))] space-y-2">
            {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
            {rows.length > 0 && (
              <p className="text-xs text-app-text-muted">
                {rows.length} {rows.length === 1 ? 'product' : 'products'} · {ksh(total)} at cost. Comes off {branchName}'s stock now;
                {toName ? ` added to ${toName}` : ' added at the other branch'} when they confirm what arrived.
              </p>
            )}
            <button
              onClick={() => void submit()}
              disabled={!ready}
              className="w-full flex items-center justify-center gap-2 bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-slate-950 font-semibold text-sm rounded-xl py-3 cursor-pointer"
            >
              <Send size={15} /> {busy ? 'Sending…' : toName ? `Send to ${toName}` : 'Send'}
            </button>
          </div>
        </div>
      </div>
    </SheetLayer>
  );
}

// ---------------------------------------------------------------------------
// Detail: receive, cancel, or read
// ---------------------------------------------------------------------------
function DetailSheet({
  transfer: t,
  products,
  canReceive,
  canCancel,
  onClose,
  onDone,
  onError,
}: {
  transfer: Transfer;
  products: Product[];
  canReceive: boolean;
  canCancel: boolean;
  onClose: () => void;
  onDone: (title: string, message: string) => void;
  onError: (title: string, message: string) => void;
}) {
  useOverlay(true, onClose, 'bottom-sheet');
  const receiving = t.status === 'in_transit' && t.direction === 'in' && canReceive;
  const cancellable = t.status === 'in_transit' && t.direction === 'out' && canCancel;
  const [got, setGot] = useState<Record<string, string>>(() => Object.fromEntries(t.items.map((i) => [i.id, qty(i.quantitySent)])));
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState('');

  const lineProblem = (i: TransferItem) => {
    const n = Number(got[i.id]);
    if (got[i.id] === '' || !Number.isFinite(n) || n < 0) return 'Enter what arrived (0 if none)';
    if (n > i.quantitySent) return `Only ${qty(i.quantitySent)} was sent`;
    return null;
  };
  const anyProblem = receiving && t.items.some((i) => lineProblem(i));
  const shortNow = receiving
    ? t.items.reduce((s, i) => {
        const n = Number(got[i.id]);
        return s + (Number.isFinite(n) && n < i.quantitySent ? (i.quantitySent - n) * i.unitCost : 0);
      }, 0)
    : shortValue(t);

  const receive = async () => {
    if (anyProblem || busy) return;
    setBusy(true);
    const { data, error } = await getSupabase().rpc('receive_stock_transfer', {
      p_transfer_id: t.id,
      p_lines: t.items.map((i) => ({ item_id: i.id, quantity_received: Number(got[i.id]) })),
      p_note: note.trim() || null,
    });
    setBusy(false);
    if (error) return onError('Not received', toUserMessage(error, 'Could not save. Check your connection and try again.'));
    const added = Number((data as any)?.productsAdded) || 0;
    onDone(
      'Stock received',
      `${t.reference} is in stock.` +
        (shortNow > 0 ? ` ${ksh(shortNow)} short was reported to ${t.fromName}.` : '') +
        (added > 0 ? ` ${added} new ${added === 1 ? 'product was' : 'products were'} added here; check the selling price.` : ''),
    );
  };

  const cancel = async () => {
    if (!reason.trim() || busy) return;
    setBusy(true);
    const { error } = await getSupabase().rpc('cancel_stock_transfer', { p_transfer_id: t.id, p_reason: reason.trim() });
    setBusy(false);
    if (error) return onError('Not cancelled', toUserMessage(error, 'Could not cancel. Check your connection and try again.'));
    onDone('Transfer cancelled', `${t.reference}: the stock is back in ${t.fromName}.`);
  };

  return (
    <SheetLayer>
      <div className="fixed inset-0 z-[9000] flex items-end sm:items-center justify-center bg-black/40 sm:p-4" onClick={onClose}>
        <div className="w-full sm:max-w-lg bg-app-card rounded-t-2xl sm:rounded-2xl max-h-[92vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-start justify-between gap-2 px-4 pt-4 pb-2">
            <div className="min-w-0">
              <h3 className="text-base font-semibold text-app-text flex items-center gap-1.5 flex-wrap">
                {t.fromName} <ArrowRight size={14} className="text-app-text-muted" /> {t.toName}
              </h3>
              <p className="text-xs text-app-text-muted">
                {t.reference} · <span className={`px-1.5 py-0.5 rounded-full ${STATUS[t.status].cls}`}>{STATUS[t.status].label}</span>
              </p>
            </div>
            <button onClick={onClose} aria-label="Close" className="p-1.5 rounded-lg text-app-text-muted hover:bg-app-bg cursor-pointer">
              <X size={18} />
            </button>
          </div>

          <div className="overflow-y-auto px-4 pb-3 space-y-3 min-h-0">
            <dl className="text-xs grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-app-text-muted">
              <dt>Sent</dt>
              <dd className="text-app-text">{when(t.sentAt)} by {t.sentBy}</dd>
              {t.note && (
                <>
                  <dt>Note</dt>
                  <dd className="text-app-text break-words">{t.note}</dd>
                </>
              )}
              {t.receivedAt && (
                <>
                  <dt>Received</dt>
                  <dd className="text-app-text">{when(t.receivedAt)} by {t.receivedBy}</dd>
                </>
              )}
              {t.receiveNote && (
                <>
                  <dt>On arrival</dt>
                  <dd className="text-app-text break-words">{t.receiveNote}</dd>
                </>
              )}
              {t.cancelledAt && (
                <>
                  <dt>Cancelled</dt>
                  <dd className="text-app-text break-words">{when(t.cancelledAt)} by {t.cancelledBy}: {t.cancelReason}</dd>
                </>
              )}
            </dl>

            {receiving && (
              <p className="text-xs rounded-xl bg-amber-500/10 text-amber-800 dark:text-amber-300 p-3">
                Count what actually arrived. Only that is added to {t.toName}'s stock; anything missing is reported back to {t.fromName}.
              </p>
            )}

            <ul className="space-y-2">
              {t.items.map((i) => {
                const here = receiving ? matchHere(i, products) : undefined;
                const n = Number(got[i.id]);
                const newCost =
                  here && Number.isFinite(n) && n > 0
                    ? (here.stock || 0) <= 0
                      ? i.unitCost
                      : Math.round((((here.stock || 0) * (here.cost || 0) + n * i.unitCost) / ((here.stock || 0) + n)) * 100) / 100
                    : null;
                const problem = receiving ? lineProblem(i) : null;
                const short = i.quantityReceived !== null ? i.quantitySent - i.quantityReceived : 0;
                return (
                  <li key={i.id} className="rounded-xl bg-app-bg p-3">
                    <div className="flex items-start gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-app-text break-words">{i.productName}</p>
                        <p className="text-[11px] text-app-text-muted">
                          Sent {qty(i.quantitySent)} {i.unit} · cost {ksh(i.unitCost)} each
                          {i.quantityReceived !== null && ` · received ${qty(i.quantityReceived)}`}
                        </p>
                        {short > 0 && (
                          <p className="text-[11px] text-red-600 dark:text-red-400">
                            {qty(short)} {i.unit} short · {ksh(short * i.unitCost)}
                          </p>
                        )}
                        {receiving && !here && <p className="text-[11px] text-app-text-muted">New here: it will be added to this branch's products.</p>}
                        {receiving && here && newCost !== null && Math.abs(newCost - (here.cost || 0)) >= 0.01 && (
                          <p className="text-[11px] text-app-text-muted">
                            Cost here goes from {ksh(here.cost || 0)} to {ksh(newCost)} (average of what you have and what came)
                          </p>
                        )}
                      </div>
                      {receiving && (
                        <label className="shrink-0 text-[11px] text-app-text-muted text-right">
                          Arrived
                          <input
                            type="number"
                            inputMode="decimal"
                            min="0"
                            step="any"
                            value={got[i.id]}
                            onChange={(e) => setGot((g) => ({ ...g, [i.id]: e.target.value }))}
                            className="mt-0.5 block w-24 bg-app-card border border-app-border rounded-lg px-2 py-1.5 text-sm text-right tabular-nums text-app-text focus:outline-none focus:ring-1 focus:ring-amber-500"
                          />
                        </label>
                      )}
                    </div>
                    {problem && <p className="text-[11px] text-red-600 dark:text-red-400 mt-1">{problem}</p>}
                  </li>
                );
              })}
            </ul>

            {receiving && (
              <input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                maxLength={200}
                placeholder="Note (optional), e.g. two packets burst"
                className="w-full bg-app-bg border border-app-border rounded-xl px-3 py-2.5 text-sm text-app-text focus:outline-none focus:ring-1 focus:ring-amber-500"
              />
            )}

            {cancelling && (
              <div className="space-y-2">
                <p className="text-xs text-app-text-muted">The stock goes back into {t.fromName}. {t.toName} is told.</p>
                <input
                  autoFocus
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  maxLength={200}
                  placeholder="Why? e.g. van did not leave"
                  className="w-full bg-app-bg border border-app-border rounded-xl px-3 py-2.5 text-sm text-app-text focus:outline-none focus:ring-1 focus:ring-amber-500"
                />
              </div>
            )}
          </div>

          <div className="border-t border-app-border px-4 pt-3 pb-[calc(1rem+var(--inset-bottom,0px))] space-y-2">
            <p className="text-xs text-app-text-muted">
              {t.items.length} {t.items.length === 1 ? 'product' : 'products'} · {ksh(sentValue(t))} at cost
              {shortNow > 0 ? ` · ${ksh(shortNow)} short` : ''}
            </p>
            {receiving && (
              <button
                onClick={() => void receive()}
                disabled={anyProblem || busy}
                className="w-full flex items-center justify-center gap-2 bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-slate-950 font-semibold text-sm rounded-xl py-3 cursor-pointer"
              >
                <Check size={16} /> {busy ? 'Saving…' : 'Confirm received'}
              </button>
            )}
            {cancellable &&
              (cancelling ? (
                <div className="flex gap-2">
                  <button onClick={() => setCancelling(false)} className="flex-1 py-3 rounded-xl text-sm text-app-text bg-app-bg cursor-pointer">
                    Keep it
                  </button>
                  <button
                    onClick={() => void cancel()}
                    disabled={!reason.trim() || busy}
                    className="flex-1 py-3 rounded-xl text-sm font-semibold bg-red-600 text-white disabled:opacity-50 cursor-pointer"
                  >
                    {busy ? 'Cancelling…' : 'Cancel transfer'}
                  </button>
                </div>
              ) : (
                <button onClick={() => setCancelling(true)} className="w-full py-3 rounded-xl text-sm font-medium text-red-600 dark:text-red-400 bg-red-500/10 cursor-pointer">
                  Cancel this transfer
                </button>
              ))}
            {t.status === 'in_transit' && t.direction === 'in' && !canReceive && (
              <p className="text-xs text-app-text-muted">Ask a manager to confirm this when it arrives.</p>
            )}
          </div>
        </div>
      </div>
    </SheetLayer>
  );
}
