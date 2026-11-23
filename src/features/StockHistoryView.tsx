// Stock History: every change to stock (restocks, wastage, counts, production), moved out
// of Inventory. Tap a change to see it as a receipt. Hiding logs only affects this device;
// owners and admins can also delete logs older than 3 days for everyone (stock levels don't
// change). On a phone: swipe a row left to Delete.
import React, { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ArrowDownRight, ArrowUpRight, CheckSquare, Copy, Eye, EyeOff, History, ReceiptText, Search, Share2, Square, Trash2, X,
} from 'lucide-react';
import { useAppStore } from '../stores/appStore';
import { useOverlay } from '../hooks/useOverlay';
import SheetLayer from '../components/shared/SheetLayer';
import { searchMatch } from '../utils/stringUtils';
import { useUiStore } from '../stores/uiStore';
import { mentionsReceipt, receiptCode, receiptCodeIn } from '../utils/references';
import { getShortId } from '../utils/idUtils';
import { useInventoryStore } from '../stores/inventoryStore';
import { useBusinessStore } from '../stores/businessStore';
import { appDialog } from '../components/AppDialog';
import { deleteLogRows, oldEnoughToDelete, useIsAdmin } from '../services/logCleanup';
import { SwipeRow } from '../components/shared/SwipeRow';
import { toUserMessage } from '../utils/userError';
import type { AdjustmentType, InventoryAdjustment } from '../types';
import { CopyRef } from '../components/shared/CopyRef';

const HIDDEN_KEY = 'kkm_hidden_inventory_logs';
const TZ = 'Africa/Nairobi';

type Filter = 'all' | 'in' | 'out' | 'transfers' | AdjustmentType;
const TRANSFER_TYPES: AdjustmentType[] = ['Transfer Out', 'Transfer In', 'Transfer Return'];

const TYPE_LABEL: Record<AdjustmentType, string> = {
  Restock: 'Restock',
  Damage: 'Damage / waste',
  Reconciliation: 'Stock count',
  'Production Consumption': 'Used in production',
  'Production Output': 'Produced',
  'Production Reversal': 'Production undone',
  'Production Waste': 'Production waste',
  'Transfer Out': 'Sent to branch',
  'Transfer In': 'From branch',
  'Transfer Return': 'Transfer cancelled',
};

const TYPE_TONE: Record<AdjustmentType, string> = {
  Restock: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  Damage: 'bg-red-500/10 text-red-600 dark:text-red-400',
  Reconciliation: 'bg-sky-500/10 text-sky-600 dark:text-sky-400',
  'Production Consumption': 'bg-amber-500/10 text-amber-700 dark:text-amber-400',
  'Production Output': 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  'Production Reversal': 'bg-blue-500/10 text-blue-600 dark:text-blue-400',
  'Production Waste': 'bg-purple-500/10 text-purple-600 dark:text-purple-400',
  'Transfer Out': 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-400',
  'Transfer In': 'bg-teal-500/10 text-teal-600 dark:text-teal-400',
  'Transfer Return': 'bg-slate-500/10 text-slate-600 dark:text-slate-300',
};

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'in', label: 'Stock in' },
  { id: 'out', label: 'Stock out' },
  { id: 'Restock', label: 'Restocks' },
  { id: 'Damage', label: 'Damage' },
  { id: 'Reconciliation', label: 'Counts' },
  { id: 'Production Output', label: 'Produced' },
  { id: 'Production Consumption', label: 'Used' },
  { id: 'transfers', label: 'Transfers' },
];

const fmtQty = (n: number) => String(Math.round(n * 1000) / 1000);
const dayKey = (iso: string) => new Date(iso).toLocaleDateString('en-CA', { timeZone: TZ });
const dayLabel = (iso: string) => {
  const key = dayKey(iso);
  const today = dayKey(new Date().toISOString());
  const yesterday = dayKey(new Date(Date.now() - 864e5).toISOString());
  if (key === today) return 'Today';
  if (key === yesterday) return 'Yesterday';
  return new Date(iso).toLocaleDateString('en-KE', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: TZ });
};
const clock = (iso: string) => new Date(iso).toLocaleTimeString('en-KE', { hour: 'numeric', minute: '2-digit', timeZone: TZ });
const fullDate = (iso: string) =>
  new Date(iso).toLocaleString('en-KE', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: TZ });
// The movement's own reference (STM-2026-000123); before 20261202001, the document that moved it.
const shortRef = (adj: InventoryAdjustment) => adj.refNo || adj.referenceNumber || `ADJ-${adj.id.replace(/[^a-z0-9]/gi, '').slice(-6).toUpperCase()}`;

export default function StockHistoryView() {
  const { adjustments, products, showToast } = useAppStore();
  const all = useMemo(
    () => (Array.isArray(adjustments) ? [...adjustments] : []).sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()),
    [adjustments],
  );
  const unitOf = (adj: InventoryAdjustment) => (Array.isArray(products) ? products : []).find((p) => p.id === adj.productId)?.unit || '';

  const [hidden, setHidden] = useState<string[]>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(HIDDEN_KEY) || '[]');
      return Array.isArray(saved) ? saved : [];
    } catch {
      return [];
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(HIDDEN_KEY, JSON.stringify(hidden));
    } catch {
      /* storage blocked: hiding still works until the app closes */
    }
  }, [hidden]);

  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');

  // Opened from search: with a receipt number, show what that sale moved; with one movement,
  // clear the filters so its row shows (search then highlights it). A movement older than the
  // loaded list is fetched and opened on its own.
  const searchTarget = useUiStore((st) => st.searchTarget);
  useEffect(() => {
    if (searchTarget?.kind !== 'stock') return;
    const { query: q, id } = searchTarget;
    setQuery(q);
    setFilter('all');
    useUiStore.getState().setSearchTarget(null);
    if (!id) return;
    setHidden((h) => h.filter((x) => x !== id));
    if (all.some((a) => a.id === id)) return;
    import('../services/repositories')
      .then(({ InventoryAdjustmentRepository }) => InventoryAdjustmentRepository.getAll([id]))
      .then((rows) => {
        if (rows[0]) setOpen(rows[0] as InventoryAdjustment);
        else showToast('Not found', 'That stock change may have been deleted.', undefined, 'info');
      })
      .catch(() => showToast('Could not open it', 'Check your connection and try again.', undefined, 'error'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchTarget]);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [open, setOpen] = useState<InventoryAdjustment | null>(null);
  useOverlay(!!open, () => setOpen(null), 'bottom-sheet');

  const visible = useMemo(() => {
    const hiddenSet = new Set(hidden);
    return all.filter((adj) => {
      if (hiddenSet.has(adj.id)) return false;
      if (filter === 'in' && !(adj.quantityAdjusted > 0)) return false;
      if (filter === 'out' && !(adj.quantityAdjusted < 0)) return false;
      if (filter === 'transfers' && !TRANSFER_TYPES.includes(adj.type)) return false;
      if (filter !== 'all' && filter !== 'in' && filter !== 'out' && filter !== 'transfers' && adj.type !== filter) return false;
      if (query.trim()) {
        // Any form of a receipt number finds the sale's stock moves (logs say TXN-…, the paper RCT-2026-…).
        const code = receiptCode(query);
        if (code && (mentionsReceipt(adj.referenceNumber, code) || mentionsReceipt(adj.notes, code))) return true;
        const hay = [adj.productName, adj.reason, adj.staffName, adj.referenceNumber, adj.refNo, adj.notes, adj.type].filter(Boolean).join(' ');
        if (!searchMatch(hay, query)) return false;
      }
      return true;
    });
  }, [all, hidden, filter, query]);

  const groups = useMemo(() => {
    const out: { key: string; label: string; items: InventoryAdjustment[]; added: number; removed: number }[] = [];
    for (const adj of visible) {
      const key = dayKey(adj.timestamp);
      let g = out[out.length - 1];
      if (!g || g.key !== key) {
        g = { key, label: dayLabel(adj.timestamp), items: [], added: 0, removed: 0 };
        out.push(g);
      }
      g.items.push(adj);
      if (adj.quantityAdjusted > 0) g.added += 1;
      else if (adj.quantityAdjusted < 0) g.removed += 1;
    }
    return out;
  }, [visible]);

  const toggle = (id: string) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  const allSelected = visible.length > 0 && selected.length === visible.length;
  const hideSelected = () => {
    if (selected.length === 0) return;
    setHidden((h) => [...new Set([...h, ...selected])]);
    showToast('Hidden', `${selected.length} ${selected.length === 1 ? 'log' : 'logs'} hidden on this device.`, undefined, 'success');
    setSelected([]);
    setSelecting(false);
  };
  const isAdmin = useIsAdmin();
  const businessId = useBusinessStore((s) => s.activeBusinessId);
  const [deleting, setDeleting] = useState(false);
  /** Deletes logs for everyone. Stock levels stay as they are. */
  const canDelete = (adj: InventoryAdjustment) => isAdmin && oldEnoughToDelete('stock', adj.timestamp);
  const deleteLogs = async (picked: string[]) => {
    if (!businessId || picked.length === 0 || deleting) return false;
    // Logs from the last 3 days stay (the database refuses them too).
    const byId = new Map(all.map((a) => [a.id, a]));
    const ids = picked.filter((id) => { const a = byId.get(id); return !!a && canDelete(a); });
    if (ids.length === 0) {
      showToast('Too new to delete', 'Stock logs can be deleted once they are older than 3 days.', undefined, 'error');
      return false;
    }
    const tooNew = picked.length - ids.length;
    const many = ids.length === 1 ? 'this stock log' : `${ids.length} stock logs`;
    const ok = await appDialog.confirm({
      title: `Delete ${many}?`,
      message: `Deleted for good. Stock stays.${tooNew ? ` ${tooNew} from the last 3 days ${tooNew === 1 ? 'stays' : 'stay'}.` : ''}`,
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (!ok) return false;
    setDeleting(true);
    try {
      const n = await deleteLogRows(businessId, 'stock', ids);
      const gone = new Set(ids);
      useInventoryStore.setState((st) => ({ adjustments: st.adjustments.filter((a) => !gone.has(a.id)) }));
      showToast('Deleted', `${n} ${n === 1 ? 'log' : 'logs'} deleted.`, undefined, 'success');
      return true;
    } catch (err) {
      showToast('Not deleted', toUserMessage(err, 'Could not delete. Check your connection.'), undefined, 'error');
      return false;
    } finally {
      setDeleting(false);
    }
  };
  const deleteSelected = async () => {
    if (await deleteLogs(selected)) {
      setSelected([]);
      setSelecting(false);
    }
  };

  const restore = () => {
    setHidden([]);
    showToast('Restored', 'Hidden logs are showing again.', undefined, 'success');
  };

  return (
    <div className="h-full flex flex-col bg-app-bg">
      {/* Header: search, filters, actions */}
      <div className="shrink-0 bg-app-card px-3 pt-3 pb-2 space-y-2.5 shadow-xs">
        <div className="flex items-center gap-2">
          <div className="relative flex-1 min-w-0">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-app-text-muted" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search product, reason, person, ref"
              className="w-full bg-app-bg text-app-text text-sm pl-9 pr-3 py-2.5 rounded-xl focus:outline-none"
            />
          </div>
          <button
            onClick={() => {
              setSelecting((v) => !v);
              setSelected([]);
            }}
            className={`shrink-0 px-3 py-2.5 rounded-xl text-sm font-medium ${selecting ? 'bg-amber-500 text-slate-950' : 'bg-app-bg text-app-text'}`}
          >
            {selecting ? 'Done' : 'Select'}
          </button>
        </div>
        <div className="flex gap-1.5 overflow-x-auto scrollbar-none -mx-3 px-3">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              onClick={() => setFilter(f.id)}
              className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-medium ${
                filter === f.id ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900' : 'bg-app-bg text-app-text-muted'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
        {(selecting || hidden.length > 0) && (
          <div className="flex items-center justify-between gap-2 text-xs">
            {selecting ? (
              <button onClick={() => setSelected(allSelected ? [] : visible.map((a) => a.id))} className="flex items-center gap-1.5 text-app-text">
                {allSelected ? <CheckSquare size={15} className="text-amber-500" /> : <Square size={15} />}
                {allSelected ? 'Clear selection' : `Select all (${visible.length})`}
              </button>
            ) : (
              <span className="text-app-text-muted">{hidden.length} hidden on this device</span>
            )}
            {selecting ? (
              <span className="flex items-center gap-1.5 shrink-0">
                <button
                  onClick={hideSelected}
                  disabled={selected.length === 0}
                  title="Hide on this device"
                  className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-app-bg text-app-text font-medium disabled:opacity-40 whitespace-nowrap"
                >
                  <EyeOff size={13} /> Hide {selected.length || ''}
                </button>
                {isAdmin && (
                  <button
                    onClick={() => void deleteSelected()}
                    disabled={selected.length === 0 || deleting}
                    title="Delete for everyone"
                    className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-red-500/10 text-red-600 dark:text-red-400 font-medium disabled:opacity-40 whitespace-nowrap"
                  >
                    <Trash2 size={13} /> Delete {selected.length || ''}
                  </button>
                )}
              </span>
            ) : (
              <button onClick={restore} className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-medium">
                <Eye size={13} /> Show hidden
              </button>
            )}
          </div>
        )}
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto pb-nav">
        {visible.length === 0 ? (
          <div className="flex flex-col items-center justify-center text-center gap-2 py-20 px-6 text-app-text-muted">
            <History size={28} className="opacity-50" />
            <p className="text-sm font-medium text-app-text">{all.length === 0 ? 'No stock changes yet' : 'Nothing matches'}</p>
            <p className="text-xs">
              {all.length === 0 ? 'Restocks, wastage, counts and production show up here.' : 'Try another search or filter.'}
            </p>
          </div>
        ) : (
          groups.map((g) => (
            <section key={g.key}>
              <div className="sticky top-0 z-10 bg-app-bg/95 backdrop-blur px-4 pt-3 pb-1.5 flex items-baseline justify-between">
                <h2 className="text-xs font-semibold text-app-text">{g.label}</h2>
                <span className="text-[11px] text-app-text-muted">
                  {g.items.length} {g.items.length === 1 ? 'change' : 'changes'}
                  {g.added ? ` · ${g.added} in` : ''}
                  {g.removed ? ` · ${g.removed} out` : ''}
                </span>
              </div>
              <div className="bg-app-card mx-1 sm:mx-3 rounded-xl divide-y divide-app-border overflow-hidden">
                {g.items.map((adj) => {
                  const unit = unitOf(adj);
                  const up = adj.quantityAdjusted > 0;
                  const isChecked = selected.includes(adj.id);
                  return (
                    <SwipeRow
                      key={adj.id}
                      searchId={`adj-${adj.id}`}
                      onClick={() => (selecting ? toggle(adj.id) : setOpen(adj))}
                      disabled={selecting}
                      title={`${adj.productName} · ${up ? '+' : ''}${fmtQty(adj.quantityAdjusted)}${unit ? ` ${unit}` : ''}`}
                      subtitle={`${TYPE_LABEL[adj.type] || adj.type} · ${fullDate(adj.timestamp)}`}
                      actions={[{ label: 'Delete', icon: <Trash2 size={18} />, tone: 'red', hidden: !canDelete(adj), onClick: () => void deleteLogs([adj.id]) }]}
                      more={[
                        { label: 'Open receipt', icon: <Eye size={16} />, onClick: () => setOpen(adj) },
                        { label: 'Hide on this device', icon: <EyeOff size={16} />, onClick: () => setHidden((h) => [...new Set([...h, adj.id])]) },
                        { label: 'Delete for everyone', icon: <Trash2 size={16} />, tone: 'red', hidden: !canDelete(adj), onClick: () => void deleteLogs([adj.id]) },
                      ]}
                      contentClassName="w-full text-left flex items-center gap-3 px-3 py-3 cursor-pointer"
                    >
                      {selecting ? (
                        isChecked ? <CheckSquare size={18} className="text-amber-500 shrink-0" /> : <Square size={18} className="text-app-text-muted shrink-0" />
                      ) : (
                        <span className={`grid place-items-center size-9 rounded-full shrink-0 ${up ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' : 'bg-red-500/10 text-red-600 dark:text-red-400'}`}>
                          {up ? <ArrowUpRight size={17} /> : <ArrowDownRight size={17} />}
                        </span>
                      )}
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium text-app-text truncate">{adj.productName}</span>
                        <span className="flex items-center gap-1.5 mt-0.5 min-w-0">
                          <span className={`shrink-0 px-1.5 py-0.5 rounded text-[10px] font-medium ${TYPE_TONE[adj.type] || 'bg-slate-500/10 text-slate-500'}`}>
                            {TYPE_LABEL[adj.type] || adj.type}
                          </span>
                          <span className="text-[11px] text-app-text-muted truncate">
                            {clock(adj.timestamp)} · {adj.staffName}
                          </span>
                          {adj.refNo && !selecting && <CopyRef value={adj.refNo} label="stock movement" className="hidden sm:inline-flex shrink-0" />}
                        </span>
                      </span>
                      <span className="text-right shrink-0">
                        <span className={`block text-sm font-semibold tabular-nums ${up ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
                          {up ? '+' : ''}{fmtQty(adj.quantityAdjusted)}{unit ? ` ${unit}` : ''}
                        </span>
                        <span className="block text-[11px] text-app-text-muted tabular-nums">
                          {fmtQty(adj.previousStock)} → {fmtQty(adj.newStock)}
                        </span>
                      </span>
                    </SwipeRow>
                  );
                })}
              </div>
            </section>
          ))
        )}
      </div>

      {/* Receipt for one change */}
      <SheetLayer>
        <AnimatePresence>
          {open && (
            <>
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => setOpen(null)}
                className="absolute inset-0 bg-black/50"
              />
              <motion.div
                initial={{ y: '100%' }}
                animate={{ y: 0 }}
                exit={{ y: '100%' }}
                transition={{ type: 'spring', stiffness: 420, damping: 40 }}
                className="absolute inset-x-0 bottom-0 sm:inset-auto sm:left-1/2 sm:top-1/2 sm:-translate-x-1/2 sm:-translate-y-1/2 sm:w-[380px] max-h-[90dvh] overflow-y-auto bg-app-card rounded-t-2xl sm:rounded-2xl p-4 pb-[calc(1rem+var(--inset-bottom))] sm:pb-4"
              >
                <AdjustmentReceipt
                  adj={open}
                  unit={unitOf(open)}
                  onClose={() => setOpen(null)}
                  onHide={() => {
                    setHidden((h) => [...new Set([...h, open.id])]);
                    setOpen(null);
                    showToast('Hidden', 'Log hidden on this device.', undefined, 'success');
                  }}
                  onCopied={() => showToast('Copied', 'Stock receipt copied.', undefined, 'success')}
                  onDelete={canDelete(open) ? async () => { if (await deleteLogs([open.id])) setOpen(null); } : undefined}
                />
              </motion.div>
            </>
          )}
        </AnimatePresence>
      </SheetLayer>
    </div>
  );
}

function AdjustmentReceipt({
  adj, unit, onClose, onHide, onCopied, onDelete,
}: { adj: InventoryAdjustment; unit: string; onClose: () => void; onHide: () => void; onCopied: () => void; onDelete?: () => void }) {
  const up = adj.quantityAdjusted > 0;
  const u = unit ? ` ${unit}` : '';
  // A sale's stock move names its receipt: link back to that sale.
  const { transactions } = useAppStore();
  const saleCode = receiptCodeIn(adj.referenceNumber) || receiptCodeIn(adj.notes) || receiptCodeIn(adj.reason);
  const sale = saleCode ? (Array.isArray(transactions) ? transactions : []).find((t) => getShortId(t.id) === saleCode) : undefined;
  const openSale = () => {
    if (!sale) return;
    const ui = useUiStore.getState();
    ui.setSearchTarget({ kind: 'sale', id: sale.id });
    onClose();
    ui.setActiveTab('sales');
  };
  const rows: [string, string][] = [
    ['Reference', shortRef(adj)],
    ...(adj.refNo && adj.referenceNumber ? [['Moved by', adj.referenceNumber] as [string, string]] : []),
    ['Date', fullDate(adj.timestamp)],
    ['Type', TYPE_LABEL[adj.type] || adj.type],
    ['Product', adj.productName],
    ['Recorded by', adj.staffName || '—'],
  ];
  if (adj.batchId) rows.push(['Batch', adj.batchId]);

  const text = [
    'STOCK RECEIPT',
    ...rows.map(([k, v]) => `${k}: ${v}`),
    `Before: ${fmtQty(adj.previousStock)}${u}`,
    `Change: ${up ? '+' : ''}${fmtQty(adj.quantityAdjusted)}${u}`,
    `After: ${fmtQty(adj.newStock)}${u}`,
    adj.reason ? `Reason: ${adj.reason}` : '',
    adj.notes ? `Notes: ${adj.notes}` : '',
  ].filter(Boolean).join('\n');

  const share = async () => {
    try {
      if (navigator.share) {
        await navigator.share({ title: `Stock receipt ${shortRef(adj)}`, text });
        return;
      }
    } catch (err: any) {
      if (err?.name === 'AbortError') return;
    }
    try {
      await navigator.clipboard.writeText(text);
      onCopied();
    } catch {
      /* nothing else to try */
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-base font-semibold text-app-text">Stock receipt</h3>
        <button onClick={onClose} aria-label="Close" className="p-2 -m-1 rounded-lg text-app-text-muted hover:bg-app-bg">
          <X size={18} />
        </button>
      </div>

      {/* Receipt paper */}
      <div className="bg-app-bg rounded-xl p-4 font-mono text-[12px] text-app-text">
        <div className="text-center mb-3">
          <div className={`text-2xl font-semibold tabular-nums ${up ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
            {up ? '+' : ''}{fmtQty(adj.quantityAdjusted)}{u}
          </div>
          <div className="text-app-text-muted font-sans text-xs mt-0.5">{adj.productName}</div>
        </div>
        <div className="border-t border-dashed border-app-text-muted/40 my-2" />
        {rows.map(([k, v]) => (
          <div key={k} className="flex justify-between gap-3 py-0.5">
            <span className="text-app-text-muted shrink-0">{k}</span>
            {k === 'Reference' || k === 'Moved by'
              ? <CopyRef value={v} label={k === 'Reference' ? 'stock movement' : 'reference'} />
              : <span className="text-right break-words min-w-0">{v}</span>}
          </div>
        ))}
        <div className="border-t border-dashed border-app-text-muted/40 my-2" />
        <div className="flex justify-between py-0.5"><span className="text-app-text-muted">Before</span><span className="tabular-nums">{fmtQty(adj.previousStock)}{u}</span></div>
        <div className="flex justify-between py-0.5"><span className="text-app-text-muted">Change</span><span className="tabular-nums">{up ? '+' : ''}{fmtQty(adj.quantityAdjusted)}{u}</span></div>
        <div className="flex justify-between py-0.5 font-semibold"><span>After</span><span className="tabular-nums">{fmtQty(adj.newStock)}{u}</span></div>
        {(adj.reason || adj.notes) && <div className="border-t border-dashed border-app-text-muted/40 my-2" />}
        {adj.reason && <p className="font-sans text-xs"><span className="text-app-text-muted">Reason: </span>{adj.reason}</p>}
        {adj.notes && <p className="font-sans text-xs mt-1"><span className="text-app-text-muted">Notes: </span>{adj.notes}</p>}
      </div>

      {sale && (
        <button onClick={openSale} className="mt-3 w-full flex items-center justify-center gap-1.5 py-2.5 rounded-xl bg-app-bg text-app-text text-sm font-medium hover:bg-app-border/50">
          <ReceiptText size={16} /> Open the sale that moved this stock
        </button>
      )}

      <div className="flex gap-2 mt-3">
        <button onClick={onHide} title="Hide on this device" aria-label="Hide on this device" className="flex items-center justify-center px-4 py-3 rounded-xl bg-app-bg text-app-text">
          <EyeOff size={16} />
        </button>
        {onDelete && (
          // Phones delete by swiping the row left; the button is for mouse users.
          <button onClick={onDelete} title="Delete for everyone" aria-label="Delete for everyone" className="pointer-coarse:hidden flex items-center justify-center px-4 py-3 rounded-xl bg-red-500/10 text-red-600 dark:text-red-400">
            <Trash2 size={16} />
          </button>
        )}
        <button onClick={share} className="flex-1 flex items-center justify-center gap-1.5 py-3 rounded-xl bg-amber-500 text-slate-950 text-sm font-semibold">
          {typeof navigator !== 'undefined' && 'share' in navigator ? <Share2 size={16} /> : <Copy size={16} />}
          {typeof navigator !== 'undefined' && 'share' in navigator ? 'Share' : 'Copy'}
        </button>
      </div>
    </div>
  );
}
