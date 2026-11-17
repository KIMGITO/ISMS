// Stock Transfers: moving stock between branches (e.g. Main supplies the shops).
// Sending takes the stock off this branch at once; the receiving branch counts what arrived
// and confirms, and only that is added there. Nothing here is a sale or an expense, so sales,
// profit and cash are untouched; each line carries the sender's cost so the receiving branch's
// cost (and later profit) stays true. All of it runs in the database.
//
// Also (20261118001): a branch can ask another for stock; a transfer above the sender's
// approval limit waits for approval; a purchase bought for several branches drafts their
// transfers when it arrives; and what arrived short is settled (arrived late, found at the
// sender, or written off). Both branches' books follow every step.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowRight, ArrowRightLeft, Check, Hand, PackageCheck, Plus, RotateCcw, Search, Send, ShieldCheck, Trash2, Truck, X,
} from 'lucide-react';
import { getSupabase } from '../services/supabaseClient';
import { useBusinessStore } from '../stores/businessStore';
import { useAuthStore } from '../stores/authStore';
import { useAppStore } from '../stores/appStore';
import { useNotificationStore } from '../stores/notificationStore';
import { hasRolePermission } from '../utils/permissions';
import { toUserMessage } from '../utils/userError';
import { toUuid } from '../utils/idUtils';
import { displayName, searchMatch } from '../utils/stringUtils';
import { useOverlay } from '../hooks/useOverlay';
import SheetLayer from '../components/shared/SheetLayer';
import {
  acceptTransferRequest, approveStockTransfer, declineTransferRequest, requestStockTransfer, sendDraftTransfer,
  settleTransferShortage, type ShortAction,
} from '../services/buying';
import type { Product } from '../types';
import { NumberInput } from '../components/shared/Input';

const TZ = 'Africa/Nairobi';

type Status = 'requested' | 'draft' | 'awaiting_approval' | 'in_transit' | 'received' | 'cancelled' | 'declined';

interface TransferItem {
  id: string;
  fromProductId: string | null;
  toProductId: string | null;
  productName: string;
  sku: string | null;
  unit: string;
  unitCost: number;
  quantityRequested: number | null;
  quantitySent: number;
  quantityReceived: number | null;
  quantityLate: number;
  quantityFound: number;
  quantityWrittenOff: number;
  stillShort: number;
}

interface Transfer {
  id: string;
  reference: string;
  direction: 'in' | 'out';
  fromName: string;
  toName: string;
  status: Status;
  note: string | null;
  sentBy: string | null;
  sentAt: string;
  createdAt: string;
  receivedBy: string | null;
  receivedAt: string | null;
  receiveNote: string | null;
  cancelledBy: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  requestedBy: string | null;
  requestedAt: string | null;
  declinedBy: string | null;
  declinedAt: string | null;
  declineReason: string | null;
  approvedBy: string | null;
  purchaseId: string | null;
  items: TransferItem[];
}

interface Branch {
  id: string;
  name: string;
}

const ksh = (n: number) => `KSh ${Math.round(n).toLocaleString()}`;
const qty = (n: number) => String(Math.round(n * 1000) / 1000);
const when = (iso: string | null) => {
  if (!iso) return '';
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
const shortValue = (t: Transfer) => t.items.reduce((s, i) => s + i.stillShort * i.unitCost, 0);
const hasShort = (t: Transfer) => t.status === 'received' && t.items.some((i) => i.stillShort > 0);
/** The time that matters for where the transfer is now. */
const shownAt = (t: Transfer) =>
  t.status === 'requested' || t.status === 'declined' ? t.requestedAt || t.createdAt : t.status === 'draft' || t.status === 'awaiting_approval' ? t.createdAt : t.sentAt;

function mapTransfer(r: any): Transfer {
  const num = (v: any) => (v === null || v === undefined ? 0 : Number(v) || 0);
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
    createdAt: r.createdAt || r.sentAt,
    receivedBy: r.receivedBy,
    receivedAt: r.receivedAt,
    receiveNote: r.receiveNote,
    cancelledBy: r.cancelledBy,
    cancelledAt: r.cancelledAt,
    cancelReason: r.cancelReason,
    requestedBy: r.requestedBy ?? null,
    requestedAt: r.requestedAt ?? null,
    declinedBy: r.declinedBy ?? null,
    declinedAt: r.declinedAt ?? null,
    declineReason: r.declineReason ?? null,
    approvedBy: r.approvedBy ?? null,
    purchaseId: r.purchaseId ?? null,
    items: (r.items || []).map((i: any) => ({
      id: i.id,
      fromProductId: i.fromProductId,
      toProductId: i.toProductId,
      productName: i.productName,
      sku: i.sku,
      unit: i.unit,
      unitCost: num(i.unitCost),
      quantityRequested: i.quantityRequested === null || i.quantityRequested === undefined ? null : Number(i.quantityRequested),
      quantitySent: num(i.quantitySent),
      quantityReceived: i.quantityReceived === null || i.quantityReceived === undefined ? null : Number(i.quantityReceived),
      quantityLate: num(i.quantityLate),
      quantityFound: num(i.quantityFound),
      quantityWrittenOff: num(i.quantityWrittenOff),
      stillShort: num(i.stillShort),
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

const STATUS: Record<Status, { label: string; cls: string }> = {
  requested: { label: 'Asked for', cls: 'bg-sky-500/15 text-sky-700 dark:text-sky-300' },
  draft: { label: 'Draft', cls: 'bg-slate-500/12 text-slate-600 dark:text-slate-300' },
  awaiting_approval: { label: 'Needs approval', cls: 'bg-violet-500/15 text-violet-700 dark:text-violet-300' },
  in_transit: { label: 'On the way', cls: 'bg-amber-500/15 text-amber-700 dark:text-amber-400' },
  received: { label: 'Received', cls: 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-400' },
  cancelled: { label: 'Cancelled', cls: 'bg-slate-500/12 text-slate-600 dark:text-slate-300' },
  declined: { label: 'Declined', cls: 'bg-red-500/12 text-red-700 dark:text-red-300' },
};

function rowLabel(t: Transfer): string {
  if (t.status === 'requested') return t.direction === 'out' ? 'Asked of you' : 'You asked';
  if (t.status === 'in_transit') return t.direction === 'in' ? 'To receive' : 'On the way';
  if (hasShort(t)) return 'Short to settle';
  return STATUS[t.status].label;
}

export default function StockTransfersView() {
  const businessId = useBusinessStore((s) => s.activeBusinessId);
  const branchName = useBusinessStore((s) => s.businesses.find((b) => b.id === s.activeBusinessId)?.name) || 'This branch';
  const role = useAuthStore((s) => s.currentEmployee?.role) || 'Guest';
  const showToast = useNotificationStore((s) => s.showToast);
  const { products } = useAppStore();
  const canSend = hasRolePermission(role, 'inventory.transfer_stock');
  const canReceive = canSend || hasRolePermission(role, 'inventory.receive_stock');
  const canRequest = canSend || hasRolePermission(role, 'inventory.request_transfer' as any);
  const canApprove = hasRolePermission(role, 'purchases.approve');
  const canWriteOff = canSend && (hasRolePermission(role, 'inventory.wastage') || hasRolePermission(role, 'inventory.adjust_stock'));

  const [tab, setTab] = useState<'open' | 'history'>('open');
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [sheet, setSheet] = useState<'send' | 'request' | null>(null);

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
  const toAnswer = transfers.filter(
    (t) => (t.status === 'requested' && t.direction === 'out') || (t.direction === 'out' && (t.status === 'draft' || t.status === 'awaiting_approval')),
  );
  const asked = transfers.filter((t) => t.status === 'requested' && t.direction === 'in');
  const shorts = transfers.filter(hasShort);
  const openList = [...toAnswer, ...incoming, ...outgoing, ...asked, ...shorts];
  const openIds = new Set(openList.map((t) => t.id));
  const history = transfers.filter((t) => !openIds.has(t.id));
  const onTheWayValue = outgoing.reduce((s, t) => s + sentValue(t), 0);
  const opened = transfers.find((t) => t.id === openId) || null;

  const list = tab === 'open' ? openList : history;

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
                <p className="text-xs text-app-text-muted">Not a sale!</p>
              </div>
            </div>
            <div className="flex gap-2 flex-wrap justify-between ">
              {canRequest && (
                <button
                  data-shortcut="transfer-request"
                  onClick={() => setSheet('request')}
                  className="flex items-center gap-1.5 bg-app-bg ring-1 ring-app-border text-app-text font-medium text-sm rounded-xl px-4 py-2.5 cursor-pointer"
                >
                  <Hand size={15} /> Ask for stock
                </button>
              )}
              {canSend && (
                <button
                  data-shortcut="new"
                  onClick={() => setSheet('send')}
                  className="flex items-center gap-1.5 bg-amber-500 hover:bg-amber-600 text-slate-950 font-semibold text-sm rounded-xl px-4 py-2.5 cursor-pointer"
                >
                  <Send size={15} /> Send stock
                </button>
              )}
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div className="rounded-xl bg-app-bg p-3">
              <p className="text-[11px] text-app-text-muted">All</p>
              <p className="text-lg font-bold text-app-text tabular-nums">{toAnswer.length}</p>
            </div>
            <div className="rounded-xl bg-app-bg p-3">
              <p className="text-[11px] text-app-text-muted">Receiving</p>
              <p className="text-lg font-bold text-app-text tabular-nums">{incoming.length}</p>
            </div>
            <div className="rounded-xl bg-app-bg p-3">
              <p className="text-[11px] text-app-text-muted">Pending</p>
              <p className="text-lg font-bold text-app-text tabular-nums">
                {outgoing.length} <span className="text-xs font-medium text-app-text-muted">· {ksh(onTheWayValue)}</span>
              </p>
            </div>
          </div>
        </section>

        {/* Tabs */}
        <div role="tablist" className="flex bg-app-card rounded-xl p-1 shadow-xs">
          {([
            ['open', `To do (${openList.length})`],
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
              <p className="text-sm text-app-text">{tab === 'open' ? 'Nothing to do.' : 'No transfers yet.'}</p>
              {tab === 'open' && canSend && <p className="text-xs text-app-text-muted">No transfers yet.</p>}
            </div>
          ) : (
            <ul className="divide-y divide-app-border">
              {list.map((t) => {
                const short = shortValue(t);
                const value = sentValue(t);
                return (
                  <li key={t.id}>
                    <button onClick={() => setOpenId(t.id)} className="w-full text-left px-4 py-3 flex items-start gap-3 hover:bg-app-bg cursor-pointer">
                      <span
                        className={`grid place-items-center size-9 rounded-full shrink-0 ${
                          t.direction === 'in' ? 'bg-teal-500/12 text-teal-600 dark:text-teal-400' : 'bg-indigo-500/12 text-indigo-600 dark:text-indigo-400'
                        }`}
                      >
                        {t.status === 'requested' ? <Hand size={16} /> : t.direction === 'in' ? <PackageCheck size={17} /> : <Send size={16} />}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-app-text flex items-center gap-1.5 flex-wrap">
                          <span className="break-words">{t.fromName}</span>
                          <ArrowRight size={13} className="text-app-text-muted shrink-0" />
                          <span className="break-words">{t.toName}</span>
                        </p>
                        <p className="text-[11px] text-app-text-muted mt-0.5 break-words">
                          {t.reference} · {when(shownAt(t))} · {t.items.length} {t.items.length === 1 ? 'product' : 'products'}
                          {value > 0 && t.status !== 'requested' ? ` · ${ksh(value)}` : ''}
                        </p>
                        {hasShort(t) && short > 0 && (
                          <p className="text-[11px] text-red-600 dark:text-red-400 mt-0.5">Arrived short · {ksh(short)} at cost still to settle</p>
                        )}
                      </div>
                      <span className={`shrink-0 px-2 py-1 rounded-full text-[11px] font-medium ${hasShort(t) ? 'bg-red-500/12 text-red-700 dark:text-red-300' : STATUS[t.status].cls}`}>
                        {rowLabel(t)}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>

      {sheet && businessId && (
        <PickSheet
          mode={sheet}
          businessId={businessId}
          branchName={branchName}
          products={products}
          onClose={() => setSheet(null)}
          onDone={(title, message) => {
            setSheet(null);
            setTab('open');
            showToast(title, message, undefined, 'success');
            void load();
          }}
        />
      )}

      {opened && (
        <DetailSheet
          transfer={opened}
          products={products}
          can={{ send: canSend, receive: canReceive, request: canRequest, approve: canApprove, writeOff: canWriteOff }}
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
// Send stock, or ask another branch for it
// ---------------------------------------------------------------------------
function PickSheet({
  mode,
  businessId,
  branchName,
  products,
  onClose,
  onDone,
}: {
  mode: 'send' | 'request';
  businessId: string;
  branchName: string;
  products: Product[];
  onClose: () => void;
  onDone: (title: string, message: string) => void;
}) {
  useOverlay(true, onClose, 'bottom-sheet');
  const sending = mode === 'send';
  const [branches, setBranches] = useState<Branch[] | null>(null);
  const [branchError, setBranchError] = useState<string | null>(null);
  const [other, setOther] = useState<string>('');
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
        if (list.length === 1) setOther(list[0].id);
      });
    return () => {
      live = false;
    };
  }, [businessId]);

  // Asking: the other branch's products this branch doesn't sell yet can be asked for too.
  // Receiving adds them here, so a branch opened from scratch can stock up from another.
  const [theirs, setTheirs] = useState<(Product & { theirs: true })[]>([]);
  useEffect(() => {
    setTheirs([]);
    if (sending || !other) return;
    let live = true;
    void getSupabase()
      .rpc('transfer_request_catalog', { p_to_business_id: toUuid(businessId), p_from_business_id: other })
      .then(({ data, error: e }) => {
        if (!live || e) return; // an older database: only this branch's products, as before
        setTheirs(((data as any[]) || []).map((t) => ({
          id: t.id, name: t.name, sku: t.sku || '', unit: t.unit || '', category: t.category || '',
          price: Number(t.price) || 0, cost: 0, stock: Number(t.stock) || 0, minStock: 0, theirs: true,
        } as any)));
      });
    return () => { live = false; };
  }, [sending, other, businessId]);
  const pool = useMemo(() => (sending ? products : [...products, ...theirs]), [sending, products, theirs]);

  const byId = useMemo(() => new Map(pool.map((p) => [p.id, p])), [pool]);
  const picked = new Set(lines.map((l) => l.productId));
  const matches = useMemo(() => {
    const q = query.trim();
    return pool
      .filter((p) => !picked.has(p.id) && (!sending || (p.stock || 0) > 0) && (!q || searchMatch([p.name, p.sku, p.category].filter(Boolean).join(' '), q)))
      .slice(0, q ? 30 : 12);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pool, query, lines, sending]);

  const rows = lines.map((l) => {
    const p = byId.get(l.productId);
    const n = Number(l.qty);
    const problem = !p
      ? 'Not in this branch any more'
      : !Number.isFinite(n) || n <= 0
        ? 'Enter how much'
        : sending && n > (p.stock || 0)
          ? `Only ${qty(p.stock || 0)} ${p.unit} here`
          : null;
    return { ...l, product: p, n, problem };
  });
  const total = rows.reduce((s, r) => s + (r.product && !r.problem ? r.n * (r.product.cost || 0) : 0), 0);
  const otherName = branches?.find((b) => b.id === other)?.name || '';
  const ready = !!other && rows.length > 0 && rows.every((r) => !r.problem) && !busy;

  const submit = async () => {
    if (!ready) return;
    setBusy(true);
    setError(null);
    try {
      if (sending) {
        const { data, error: e } = await getSupabase().rpc('send_stock_transfer', {
          p_from_business_id: toUuid(businessId),
          p_to_business_id: other,
          p_items: rows.map((r) => ({ product_id: toUuid(r.productId), quantity: r.n })),
          p_note: note.trim() || null,
          p_reference_id: reference,
        });
        if (e) throw e;
        const ref = (data as any)?.reference || 'Transfer';
        if ((data as any)?.status === 'awaiting_approval') {
          onDone('Waiting for approval', `${ref} is above your limit. Nothing has left yet; it goes once someone approves it.`);
        } else {
          onDone('Stock sent', `${ref} is on the way to ${otherName}. It is off this branch's stock now.`);
        }
      } else {
        const r = await requestStockTransfer(businessId, other, rows.map((x) => ({ productId: x.productId, quantity: x.n })), note.trim());
        onDone('Stock asked for', `${r.reference}: ${otherName} is told. You'll see it here when they send it.`);
      }
    } catch (e) {
      setBusy(false);
      setError(toUserMessage(e, sending ? 'Could not send. Check your connection and try again.' : 'Could not ask. Check your connection and try again.'));
    }
  };

  const input = 'w-full bg-app-bg border border-app-border rounded-xl px-3 py-2.5 text-sm text-app-text focus:outline-none focus:ring-1 focus:ring-amber-500';

  return (
    <SheetLayer>
      <div className="fixed inset-0 z-[9000] flex items-end sm:items-center justify-center bg-black/40 sm:p-4" onClick={onClose}>
        <div className="w-full sm:max-w-lg bg-app-card rounded-t-2xl sm:rounded-2xl max-h-[92vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center justify-between gap-2 px-4 pt-4 pb-2">
            <h3 className="text-base font-semibold text-app-text">{sending ? `Send stock from ${branchName}` : `Ask for stock for ${branchName}`}</h3>
            <button onClick={onClose} aria-label="Close" className="p-1.5 rounded-lg text-app-text-muted hover:bg-app-bg cursor-pointer">
              <X size={18} />
            </button>
          </div>

          <div className="overflow-y-auto px-4 pb-3 space-y-4 min-h-0">
            <div>
              <p className="text-xs font-medium text-app-text-muted mb-1.5">{sending ? 'To' : 'Ask'}</p>
              {branchError ? (
                <p className="text-xs text-red-600 dark:text-red-400">{branchError}</p>
              ) : branches === null ? (
                <p className="text-xs text-app-text-muted">Loading branches…</p>
              ) : branches.length === 0 ? (
                <p className="text-xs text-app-text-muted">
                  There is no other branch. Branches must have the same owner; add one under Business Management.
                </p>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {branches.map((b) => (
                    <button
                      key={b.id}
                      onClick={() => setOther(b.id)}
                      aria-pressed={other === b.id}
                      className={`px-3 py-1.5 rounded-full text-sm font-medium cursor-pointer ${other === b.id ? 'bg-amber-500 text-slate-950' : 'bg-app-bg text-app-text border border-app-border'}`}
                    >
                      {b.name}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {rows.length > 0 && (
              <ul className="space-y-2">
                {rows.map((r) => (
                  <li key={r.productId} className="rounded-xl bg-app-bg p-3">
                    <div className="flex items-start gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-app-text break-words">{r.product ? displayName(r.product.name) : 'Removed product'}</p>
                        {r.product && (
                          <p className="text-[11px] text-app-text-muted">
                            {(r.product as any).theirs
                              ? `${qty(r.product.stock || 0)} ${r.product.unit} at ${otherName} · new here, added when it arrives`
                              : `${qty(r.product.stock || 0)} ${r.product.unit} here${sending ? ` · cost ${ksh(r.product.cost || 0)} each` : ''}`}
                          </p>
                        )}
                      </div>
                      <NumberInput
                        min={0}
                        value={r.qty}
                        onChange={(v) => setLines((ls) => ls.map((l) => (l.productId === r.productId ? { ...l, qty: (v == null ? '' : String(v)) } : l)))}
                        aria-label={`How much ${r.product ? displayName(r.product.name) : ''}`}
                        size="sm" className="w-24" inputClassName="text-right tabular-nums"
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

            <div>
              <p className="text-xs font-medium text-app-text-muted mb-1.5">Add products</p>
              <div className="relative">
                <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-app-text-muted" />
                <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search product or SKU" className={`${input} pl-9`} />
              </div>
              <ul className="mt-2 max-h-56 overflow-y-auto divide-y divide-app-border rounded-xl border border-app-border">
                {matches.length === 0 ? (
                  <li className="p-3 text-xs text-app-text-muted text-center">{query ? 'No product matches.' : sending ? 'No products with stock.' : 'No products.'}</li>
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
                        <span className="text-sm text-app-text flex-1 min-w-0 truncate">{displayName(p.name)}</span>
                        <span className="text-[11px] text-app-text-muted shrink-0 tabular-nums text-right">
                          {(p as any).theirs ? (
                            <>{qty(p.stock || 0)} {p.unit} at {otherName}<span className="block text-amber-600">New here</span></>
                          ) : (
                            <>{qty(p.stock || 0)} {p.unit}</>
                          )}
                        </span>
                      </button>
                    </li>
                  ))
                )}
              </ul>
            </div>

            <label className="block text-xs font-medium text-app-text-muted">
              Note (optional)
              <input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                maxLength={200}
                placeholder={sending ? 'e.g. With Kamau, morning van' : 'e.g. For the weekend, before Friday'}
                className={`${input} mt-1`}
              />
            </label>
          </div>

          <div className="border-t border-app-border px-4 pt-3 pb-[calc(1rem+var(--inset-bottom,0px))] space-y-2">
            {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
            {rows.length > 0 && (
              <p className="text-xs text-app-text-muted">
                {sending
                  ? `${rows.length} ${rows.length === 1 ? 'product' : 'products'} · ${ksh(total)} at cost. Comes off ${branchName}'s stock now;${otherName ? ` added to ${otherName}` : ' added at the other branch'} when they confirm what arrived.`
                  : `${rows.length} ${rows.length === 1 ? 'product' : 'products'}. ${otherName || 'The other branch'} sends what it can; you confirm what arrives.`}
              </p>
            )}
            <button
              onClick={() => void submit()}
              disabled={!ready}
              className="w-full flex items-center justify-center gap-2 bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-slate-950 font-semibold text-sm rounded-xl py-3 cursor-pointer"
            >
              {sending ? <Send size={15} /> : <Hand size={15} />}
              {busy ? (sending ? 'Sending…' : 'Asking…') : sending ? (otherName ? `Send to ${otherName}` : 'Send') : otherName ? `Ask ${otherName}` : 'Ask'}
            </button>
          </div>
        </div>
      </div>
    </SheetLayer>
  );
}

// ---------------------------------------------------------------------------
// Detail: answer, send, approve, receive, settle a shortage, cancel, or read
// ---------------------------------------------------------------------------
type Mode = 'answer' | 'draft' | 'approve' | 'receive' | 'settle' | 'none';

function DetailSheet({
  transfer: t,
  products,
  can,
  onClose,
  onDone,
  onError,
}: {
  transfer: Transfer;
  products: Product[];
  can: { send: boolean; receive: boolean; request: boolean; approve: boolean; writeOff: boolean };
  onClose: () => void;
  onDone: (title: string, message: string) => void;
  onError: (title: string, message: string) => void;
}) {
  useOverlay(true, onClose, 'bottom-sheet');
  const out = t.direction === 'out';
  const mode: Mode =
    t.status === 'requested' && out && can.send ? 'answer'
      : t.status === 'draft' && out && can.send ? 'draft'
        : t.status === 'awaiting_approval' && out && can.approve ? 'approve'
          : t.status === 'in_transit' && !out && can.receive ? 'receive'
            : hasShort(t) && (out ? can.send : can.receive) ? 'settle'
              : 'none';
  const editsQty = mode === 'answer' || mode === 'draft' || mode === 'receive';
  const cancellable =
    (t.status === 'in_transit' && out && can.send) ||
    ((t.status === 'draft' || t.status === 'awaiting_approval') && out && (can.send || can.approve)) ||
    (t.status === 'requested' && !out && can.request);

  const [got, setGot] = useState<Record<string, string>>(() =>
    Object.fromEntries(t.items.map((i) => [i.id, qty(mode === 'answer' ? i.quantityRequested ?? i.quantitySent : i.quantitySent)])),
  );
  const [settle, setSettle] = useState<Record<string, { action: ShortAction | ''; qty: string }>>(() =>
    Object.fromEntries(t.items.filter((i) => i.stillShort > 0).map((i) => [i.id, { action: '' as const, qty: qty(i.stillShort) }])),
  );
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [closing, setClosing] = useState<'cancel' | 'decline' | null>(null);
  const [reason, setReason] = useState('');

  const lineProblem = (i: TransferItem) => {
    if (!editsQty) return null;
    const n = Number(got[i.id]);
    if (got[i.id] === '' || !Number.isFinite(n) || n < 0) return mode === 'receive' ? 'Enter what arrived (0 if none)' : 'Enter how much (0 leaves it out)';
    if (mode === 'receive' && n > i.quantitySent) return `Only ${qty(i.quantitySent)} was sent`;
    return null;
  };
  const anyProblem = editsQty && t.items.some((i) => lineProblem(i));
  const allZero = (mode === 'answer' || mode === 'draft') && t.items.every((i) => Number(got[i.id]) === 0);
  const shortNow =
    mode === 'receive'
      ? t.items.reduce((s, i) => {
          const n = Number(got[i.id]);
          return s + (Number.isFinite(n) && n < i.quantitySent ? (i.quantitySent - n) * i.unitCost : 0);
        }, 0)
      : shortValue(t);

  const run = async (fn: () => Promise<void>, failTitle: string, failMsg: string) => {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      setBusy(false);
      onError(failTitle, toUserMessage(e, failMsg));
    }
  };

  const qtyLines = () => t.items.map((i) => ({ itemId: i.id, quantity: Number(got[i.id]) }));

  const answer = () =>
    run(async () => {
      const r = await acceptTransferRequest(t.id, qtyLines());
      onDone(
        r.status === 'awaiting_approval' ? 'Waiting for approval' : 'Stock sent',
        r.status === 'awaiting_approval'
          ? `${t.reference} is above your limit. It goes once someone approves it.`
          : `${t.reference} is on the way to ${t.toName}. It is off this branch's stock now.`,
      );
    }, 'Not sent', 'Could not send. Check your connection and try again.');

  const sendDraft = () =>
    run(async () => {
      const r = await sendDraftTransfer(t.id, qtyLines());
      onDone(
        r.status === 'awaiting_approval' ? 'Waiting for approval' : 'Stock sent',
        r.status === 'awaiting_approval' ? `${t.reference} is above your limit. It goes once someone approves it.` : `${t.reference} is on the way to ${t.toName}.`,
      );
    }, 'Not sent', 'Could not send. Check your connection and try again.');

  const approve = () =>
    run(async () => {
      await approveStockTransfer(t.id);
      onDone('Approved and sent', `${t.reference} is on the way to ${t.toName}.`);
    }, 'Not approved', 'Could not approve. Check your connection and try again.');

  const receive = () =>
    run(async () => {
      const { data, error } = await getSupabase().rpc('receive_stock_transfer', {
        p_transfer_id: t.id,
        p_lines: t.items.map((i) => ({ item_id: i.id, quantity_received: Number(got[i.id]) })),
        p_note: note.trim() || null,
      });
      if (error) throw error;
      const added = Number((data as any)?.productsAdded) || 0;
      onDone(
        'Stock received',
        `${t.reference} is in stock.` +
          (shortNow > 0 ? ` ${ksh(shortNow)} short was reported to ${t.fromName}.` : '') +
          (added > 0 ? ` ${added} new ${added === 1 ? 'product was' : 'products were'} added here; check the selling price.` : ''),
      );
    }, 'Not received', 'Could not save. Check your connection and try again.');

  const settleChosen = Object.entries(settle).filter(([, v]) => v.action);
  const settleProblem = settleChosen.some(([id, v]) => {
    const i = t.items.find((x) => x.id === id)!;
    const n = Number(v.qty);
    return !Number.isFinite(n) || n <= 0 || n > i.stillShort;
  });
  const saveSettle = () =>
    run(async () => {
      await settleTransferShortage(
        t.id,
        settleChosen.map(([itemId, v]) => ({ itemId, action: v.action as ShortAction, quantity: Number(v.qty) })),
        note.trim(),
      );
      onDone('Shortage settled', `${t.reference}: both branches' books now show where the stock went.`);
    }, 'Not saved', 'Could not save. Check your connection and try again.');

  const close = () =>
    run(async () => {
      if (closing === 'decline') {
        await declineTransferRequest(t.id, reason.trim());
        onDone('Request declined', `${t.toName} is told why.`);
        return;
      }
      const { error } = await getSupabase().rpc('cancel_stock_transfer', { p_transfer_id: t.id, p_reason: reason.trim() });
      if (error) throw error;
      onDone(
        t.status === 'requested' ? 'Request withdrawn' : 'Transfer cancelled',
        t.status === 'in_transit' ? `${t.reference}: the stock is back in ${t.fromName}.` : `${t.reference} is cancelled. No stock moved.`,
      );
    }, 'Not saved', 'Could not save. Check your connection and try again.');

  const settleOptions = (): { id: ShortAction; label: string }[] =>
    out
      ? [{ id: 'found', label: 'Found here' }, ...(can.writeOff ? [{ id: 'written_off' as const, label: 'Write off (lost)' }] : [])]
      : [{ id: 'late', label: 'Arrived late' }];

  const primary =
    'w-full flex items-center justify-center gap-2 bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-slate-950 font-semibold text-sm rounded-xl py-3 cursor-pointer';
  const inputCls =
    'w-full bg-app-bg border border-app-border rounded-xl px-3 py-2.5 text-sm text-app-text focus:outline-none focus:ring-1 focus:ring-amber-500';

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
                {t.reference} · <span className={`px-1.5 py-0.5 rounded-full ${STATUS[t.status].cls}`}>{rowLabel(t)}</span>
              </p>
            </div>
            <button onClick={onClose} aria-label="Close" className="p-1.5 rounded-lg text-app-text-muted hover:bg-app-bg cursor-pointer">
              <X size={18} />
            </button>
          </div>

          <div className="overflow-y-auto px-4 pb-3 space-y-3 min-h-0">
            <dl className="text-xs grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-app-text-muted">
              {t.requestedAt && (
                <>
                  <dt>Asked</dt>
                  <dd className="text-app-text">{when(t.requestedAt)} by {t.requestedBy}</dd>
                </>
              )}
              {(t.status === 'in_transit' || t.status === 'received') && (
                <>
                  <dt>Sent</dt>
                  <dd className="text-app-text">{when(t.sentAt)} by {t.sentBy}{t.approvedBy ? ` · approved by ${t.approvedBy}` : ''}</dd>
                </>
              )}
              {(t.status === 'draft' || t.status === 'awaiting_approval') && t.sentBy && (
                <>
                  <dt>{t.status === 'draft' ? 'Drafted' : 'Sent by'}</dt>
                  <dd className="text-app-text">{when(t.createdAt)} · {t.sentBy}</dd>
                </>
              )}
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
              {t.declinedAt && (
                <>
                  <dt>Declined</dt>
                  <dd className="text-app-text break-words">{when(t.declinedAt)} by {t.declinedBy}: {t.declineReason}</dd>
                </>
              )}
              {t.cancelledAt && (
                <>
                  <dt>Cancelled</dt>
                  <dd className="text-app-text break-words">{when(t.cancelledAt)} by {t.cancelledBy}: {t.cancelReason}</dd>
                </>
              )}
            </dl>

            {mode === 'receive' && (
              <p className="text-xs rounded-xl bg-amber-500/10 text-amber-800 dark:text-amber-300 p-3">
                Count what actually arrived. Only that is added to {t.toName}'s stock; anything missing is reported back to {t.fromName}.
              </p>
            )}
            {mode === 'answer' && (
              <p className="text-xs rounded-xl bg-sky-500/10 text-sky-800 dark:text-sky-300 p-3">
                {t.toName} asked for this. Change an amount to send less.
              </p>
            )}
            {mode === 'draft' && (
              <p className="text-xs rounded-xl bg-app-bg text-app-text-muted p-3">
                {t.purchaseId ? `Drafted when a purchase for ${t.toName} arrived here. ` : ''}Check the amounts, then send. Nothing has left yet.
              </p>
            )}
            {t.status === 'awaiting_approval' && (
              <p className="text-xs rounded-xl bg-violet-500/10 text-violet-800 dark:text-violet-300 p-3">
                Worth {ksh(t.items.reduce((s, i) => s + i.quantitySent * i.unitCost, 0))} at cost, above {t.sentBy || 'the sender'}'s limit. Nothing has left yet.
                {mode !== 'approve' && ' Someone who can approve this amount has to send it.'}
              </p>
            )}
            {mode === 'settle' && (
              <p className="text-xs rounded-xl bg-red-500/10 text-red-800 dark:text-red-300 p-3">
                {out
                  ? `Part of this didn't reach ${t.toName}. If it never left, say it was found here; if it was lost on the way, write it off as a stock loss.`
                  : `Part of this didn't arrive. If it came later, record it here so it is added to stock.`}
              </p>
            )}

            <ul className="space-y-2">
              {t.items.map((i) => {
                const here = mode === 'receive' ? matchHere(i, products) : undefined;
                const n = Number(got[i.id]);
                const newCost =
                  here && Number.isFinite(n) && n > 0
                    ? (here.stock || 0) <= 0
                      ? i.unitCost
                      : Math.round((((here.stock || 0) * (here.cost || 0) + n * i.unitCost) / ((here.stock || 0) + n)) * 100) / 100
                    : null;
                const problem = lineProblem(i);
                const s = settle[i.id];
                return (
                  <li key={i.id} className="rounded-xl bg-app-bg p-3">
                    <div className="flex items-start gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-app-text break-words">{displayName(i.productName)}</p>
                        <p className="text-[11px] text-app-text-muted">
                          {t.status === 'requested'
                            ? `Asked for ${qty(i.quantityRequested ?? i.quantitySent)} ${i.unit}`
                            : `${t.status === 'draft' || t.status === 'awaiting_approval' ? 'To send' : 'Sent'} ${qty(i.quantitySent)} ${i.unit}${i.unitCost > 0 ? ` · cost ${ksh(i.unitCost)} each` : ''}`}
                          {i.quantityRequested !== null && t.status !== 'requested' && i.quantityRequested !== i.quantitySent && ` · asked ${qty(i.quantityRequested)}`}
                          {i.quantityReceived !== null && ` · received ${qty(i.quantityReceived)}`}
                        </p>
                        {(i.quantityLate > 0 || i.quantityFound > 0 || i.quantityWrittenOff > 0) && (
                          <p className="text-[11px] text-app-text-muted">
                            {[i.quantityLate > 0 && `${qty(i.quantityLate)} arrived late`, i.quantityFound > 0 && `${qty(i.quantityFound)} found at ${t.fromName}`, i.quantityWrittenOff > 0 && `${qty(i.quantityWrittenOff)} written off`]
                              .filter(Boolean)
                              .join(' · ')}
                          </p>
                        )}
                        {i.stillShort > 0 && (
                          <p className="text-[11px] text-red-600 dark:text-red-400">
                            {qty(i.stillShort)} {i.unit} still short · {ksh(i.stillShort * i.unitCost)}
                          </p>
                        )}
                        {mode === 'receive' && !here && <p className="text-[11px] text-app-text-muted">New here: it will be added to this branch's products.</p>}
                        {mode === 'receive' && here && newCost !== null && Math.abs(newCost - (here.cost || 0)) >= 0.01 && (
                          <p className="text-[11px] text-app-text-muted">
                            Cost here goes from {ksh(here.cost || 0)} to {ksh(newCost)} (average of what you have and what came)
                          </p>
                        )}
                      </div>
                      {editsQty && (
                        <label className="shrink-0 text-[11px] text-app-text-muted text-right">
                          {mode === 'receive' ? 'Arrived' : 'Send'}
                          <NumberInput
                            min={0}
                            value={got[i.id]}
                            onChange={(v) => setGot((g) => ({ ...g, [i.id]: (v == null ? '' : String(v)) }))}
                            size="sm" className="mt-0.5 block w-24" inputClassName="text-right tabular-nums"
                          />
                        </label>
                      )}
                    </div>
                    {mode === 'settle' && s && (
                      <div className="mt-2 flex items-center gap-2 flex-wrap">
                        {settleOptions().map((o) => (
                          <button
                            key={o.id}
                            onClick={() => setSettle((m) => ({ ...m, [i.id]: { ...m[i.id], action: m[i.id].action === o.id ? '' : o.id } }))}
                            aria-pressed={s.action === o.id}
                            className={`px-3 py-1.5 rounded-full text-xs font-medium cursor-pointer ${s.action === o.id ? 'bg-amber-500 text-slate-950' : 'bg-app-card text-app-text ring-1 ring-app-border'}`}
                          >
                            {o.label}
                          </button>
                        ))}
                        {s.action && (
                          <NumberInput
                            min={0}
                            value={s.qty}
                            onChange={(v) => setSettle((m) => ({ ...m, [i.id]: { ...m[i.id], qty: (v == null ? '' : String(v)) } }))}
                            aria-label="How much"
                            size="sm" className="w-20 ml-auto" inputClassName="text-right tabular-nums"
                          />
                        )}
                      </div>
                    )}
                    {problem && <p className="text-[11px] text-red-600 dark:text-red-400 mt-1">{problem}</p>}
                  </li>
                );
              })}
            </ul>

            {(mode === 'receive' || mode === 'settle') && (
              <input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                maxLength={200}
                placeholder={mode === 'receive' ? 'Note (optional), e.g. two packets burst' : 'Note (optional), e.g. fell off the van'}
                className={inputCls}
              />
            )}

            {closing && (
              <div className="space-y-2">
                <p className="text-xs text-app-text-muted">
                  {closing === 'decline'
                    ? `${t.toName} is told why.`
                    : t.status === 'in_transit'
                      ? `The stock goes back into ${t.fromName}. ${t.toName} is told.`
                      : 'Nothing has moved, so no stock changes.'}
                </p>
                <input
                  autoFocus
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  maxLength={200}
                  placeholder={closing === 'decline' ? 'Why? e.g. we are out too' : 'Why? e.g. van did not leave'}
                  className={inputCls}
                />
              </div>
            )}
          </div>

          <div className="border-t border-app-border px-4 pt-3 pb-[calc(1rem+var(--inset-bottom,0px))] space-y-2">
            {t.status !== 'requested' && (
              <p className="text-xs text-app-text-muted">
                {t.items.length} {t.items.length === 1 ? 'product' : 'products'} · {ksh(sentValue(t))} at cost
                {shortNow > 0 ? ` · ${ksh(shortNow)} short` : ''}
              </p>
            )}
            {closing ? (
              <div className="flex gap-2">
                <button onClick={() => setClosing(null)} className="flex-1 py-3 rounded-xl text-sm text-app-text bg-app-bg cursor-pointer">
                  Keep it
                </button>
                <button
                  onClick={() => void close()}
                  disabled={!reason.trim() || busy}
                  className="flex-1 py-3 rounded-xl text-sm font-semibold bg-red-600 text-white disabled:opacity-50 cursor-pointer"
                >
                  {busy ? 'Saving…' : closing === 'decline' ? 'Decline request' : t.status === 'requested' ? 'Withdraw request' : 'Cancel transfer'}
                </button>
              </div>
            ) : (
              <>
                {mode === 'answer' && (
                  <button onClick={() => void answer()} disabled={anyProblem || allZero || busy} className={primary}>
                    <Send size={15} /> {busy ? 'Sending…' : `Send to ${t.toName}`}
                  </button>
                )}
                {mode === 'draft' && (
                  <button onClick={() => void sendDraft()} disabled={anyProblem || allZero || busy} className={primary}>
                    <Send size={15} /> {busy ? 'Sending…' : `Send to ${t.toName}`}
                  </button>
                )}
                {mode === 'approve' && (
                  <button onClick={() => void approve()} disabled={busy} className={primary}>
                    <ShieldCheck size={16} /> {busy ? 'Approving…' : 'Approve and send'}
                  </button>
                )}
                {mode === 'receive' && (
                  <button onClick={() => void receive()} disabled={anyProblem || busy} className={primary}>
                    <Check size={16} /> {busy ? 'Saving…' : 'Confirm received'}
                  </button>
                )}
                {mode === 'settle' && (
                  <button onClick={() => void saveSettle()} disabled={!settleChosen.length || settleProblem || busy} className={primary}>
                    <Check size={16} /> {busy ? 'Saving…' : 'Save'}
                  </button>
                )}
                {mode === 'answer' && (
                  <button onClick={() => setClosing('decline')} className="w-full py-3 rounded-xl text-sm font-medium text-red-600 dark:text-red-400 bg-red-500/10 cursor-pointer">
                    Decline
                  </button>
                )}
                {cancellable && (
                  <button onClick={() => setClosing('cancel')} className="w-full py-3 rounded-xl text-sm font-medium text-red-600 dark:text-red-400 bg-red-500/10 cursor-pointer">
                    {t.status === 'requested' ? 'Withdraw request' : t.status === 'in_transit' ? 'Cancel this transfer' : t.status === 'awaiting_approval' && mode === 'approve' ? 'Reject' : 'Cancel'}
                  </button>
                )}
                {t.status === 'in_transit' && !out && !can.receive && <p className="text-xs text-app-text-muted">Ask a manager to confirm this when it arrives.</p>}
                {t.status === 'requested' && out && !can.send && <p className="text-xs text-app-text-muted">Someone who can send stock has to answer this.</p>}
              </>
            )}
          </div>
        </div>
      </div>
    </SheetLayer>
  );
}
