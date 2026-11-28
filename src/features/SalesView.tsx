// src/features/SalesView.tsx
// Sales Log: every sale, grouped by day, newest first.

import React, { useState, useMemo, useEffect } from "react";
import { useOverlay } from "../hooks/useOverlay";
import { useUiStore } from "../stores/uiStore";
import { useAppStore } from "../stores/appStore";
import { Transaction } from "../types";
import { ReceiptText, FileText, ShieldAlert, ChevronDown, ChevronUp, Undo2, History, X, Pencil } from "lucide-react";
import { SheetLayer } from "../components/shared/SheetLayer";
import { listSaleEdits, describeChanges, describeAction, type AuditEntry } from "../services/operations";
import { hasRolePermission } from "../utils/permissions";
import { formatCurrency } from "../utils/helpers";
import { formatReceiptNumber } from "../utils/idUtils";
import { titleCase } from "../utils/stringUtils";
import { ReceiptSheet } from "../components/receipts/ReceiptSheet";
import { SwipeRow } from "../components/shared/SwipeRow";
import { useBusinessStore } from "../stores/businessStore";
import { RefundSheet } from "../components/sales/RefundSheet";
import { loadSaleCreditNotes, REFUND_EVENT } from "../services/salesDocs";
import { Tabs } from "../components/TabOptions";
import QuotesPanel from "../components/sales/QuotesPanel";
import { CopyRef } from "../components/shared/CopyRef";

interface DaySection {
  key: string; // "today", "yesterday" or the day as YYYY-MM-DD
  label: string;
  txs: Transaction[]; // newest first
  total: number;
}

const dayKey = (d: Date) => d.toLocaleDateString("en-CA");

function getPaymentMethodLabel(method: string | undefined): string {
  switch (method) {
    case 'Cash':
      return 'Cash';
    case 'M-Pesa':
      return 'M-Pesa';
    case 'Airtel Money':
      return 'Airtel Money';
    case 'Card':
      return 'Card';
    case 'Bank':
      return 'Bank Transfer';
    case 'Credit_Debt':
      return 'Credit Sale';
    case 'Credit':
      return 'Credit Sale';
    default:
      return method || 'Cash';
  }
}

export default function SalesView() {
  const { transactions, currentEmployee, showToast } = useAppStore();
  const [selectedTx, setSelectedTx] = useState<Transaction | null>(null);

  // Opened from search (a receipt number): show that sale's receipt straight away.
  const searchTarget = useUiStore((st) => st.searchTarget);
  useEffect(() => {
    if (searchTarget?.kind !== "sale") return;
    const id = searchTarget.id;
    useUiStore.getState().setSearchTarget(null);
    const tx = transactions.find((t) => t.id === id);
    if (tx) {
      setSelectedTx(tx);
      return;
    }
    // Older than the newest 1,000 sales this list holds: fetch just that one and open its receipt.
    import("../services/repositories")
      .then(({ TransactionRepository }) => TransactionRepository.getAll([id]))
      .then((rows) => {
        if (rows[0]) setSelectedTx(rows[0] as Transaction);
        else showToast("Sale not found", "It may have been deleted.", undefined, "info");
      })
      .catch(() => showToast("Could not open the sale", "Check your connection and try again.", undefined, "error"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchTarget, transactions]);

  // Sales are never deleted (20261203001): a refund or credit note undoes one and the sale stays.
  const businessId = useBusinessStore((s) => s.activeBusinessId);

  // Refunds: a credit note for some or all of a sale; the sale stays in the log.
  // Managers refund any sale; staff who can cancel a sale refund today's only (the database checks too).
  const role = currentEmployee?.role || "Guest";
  const canRefund = (tx: Transaction) => {
    if (tx.status !== "Synced") return false;
    if (hasRolePermission(role, "refunds.create")) return true;
    const kenyaDay = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: "Africa/Nairobi" });
    return hasRolePermission(role, "pos.cancel_sale") && kenyaDay(new Date(tx.timestamp)) === kenyaDay(new Date());
  };
  const [refunding, setRefunding] = useState<Transaction | null>(null);
  // Edit = take the whole sale back, then redo it in the till (RefundSheet in edit mode).
  const [refundMode, setRefundMode] = useState<'refund' | 'edit'>('refund');
  const startRefund = (tx: Transaction, mode: 'refund' | 'edit') => { setRefundMode(mode); setRefunding(tx); };
  const [refunds, setRefunds] = useState<Map<string, { number: string; total: number; edit: boolean }[]>>(new Map());
  const loadRefunds = React.useCallback(() => {
    if (!businessId) return;
    loadSaleCreditNotes(businessId).then(setRefunds).catch(() => undefined);
  }, [businessId]);
  useEffect(() => {
    loadRefunds();
    window.addEventListener(REFUND_EVENT, loadRefunds);
    return () => window.removeEventListener(REFUND_EVENT, loadRefunds);
  }, [loadRefunds, transactions.length]);

  // Every change to a sale after it was made is logged by the database; people who can see
  // the audit log see it here, on the sale.
  const seesEdits = hasRolePermission(role, "audit.view" as any);
  const [edits, setEdits] = useState<Map<string, AuditEntry[]>>(new Map());
  const [editsOf, setEditsOf] = useState<Transaction | null>(null);
  useEffect(() => {
    if (!businessId || !seesEdits) return;
    listSaleEdits(businessId).then(setEdits).catch(() => undefined);
  }, [businessId, seesEdits, transactions]);

  // One day open at a time; today starts open.
  const [activeOpenSection, setActiveOpenSection] = useState<string>("today");

  const handleToggleSection = (sectionKey: string) => {
    setActiveOpenSection(prev => prev === sectionKey ? "" : sectionKey);
  };

  const handleSelectTx = (tx: Transaction | null) => setSelectedTx(tx);

  const canViewSales = currentEmployee ? hasRolePermission(currentEmployee.role, "orders.view") : false;
  const seesQuotes = hasRolePermission(role, "quotes.view" as any) || hasRolePermission(role, "quotes.manage" as any);
  const [view, setView] = useState<"sales" | "quotes">("sales");
  // Opened as the old Quotes & Invoices screen (a saved start screen, a link): show Quotes.
  const screenSection = useUiStore((st) => st.screenSection);
  useEffect(() => {
    if (screenSection !== "quotes") return;
    if (seesQuotes) setView("quotes");
    useUiStore.getState().setScreenSection(null);
  }, [screenSection, seesQuotes]);

  // Newest first everywhere: today on top, then yesterday, then older days, and inside each
  // day the latest sale first.
  const sections = useMemo((): DaySection[] => {
    const safeTx = Array.isArray(transactions) ? transactions : [];
    const sorted = [...safeTx].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    const today = dayKey(new Date());
    const y = new Date();
    y.setDate(y.getDate() - 1);
    const yesterday = dayKey(y);
    const byDay = new Map<string, DaySection>();
    byDay.set(today, { key: "today", label: "Today", txs: [], total: 0 });
    for (const tx of sorted) {
      const d = new Date(tx.timestamp);
      const k = dayKey(d);
      let sec = byDay.get(k);
      if (!sec) {
        sec = k === yesterday
          ? { key: "yesterday", label: "Yesterday", txs: [], total: 0 }
          : { key: k, label: d.toLocaleDateString([], { weekday: "short", day: "numeric", month: "short", year: d.getFullYear() === new Date().getFullYear() ? undefined : "numeric" }), txs: [], total: 0 };
        byDay.set(k, sec);
      }
      sec.txs.push(tx);
      // A day's total is what was kept: refunds on its sales come off.
      sec.total += (tx.finalTotal || 0) - (refunds.get(tx.id) || []).reduce((n, r) => n + r.total, 0);
    }
    // Map keeps insertion order: today first, then days in the order of the newest-first sales.
    return Array.from(byDay.values());
  }, [transactions, refunds]);

  // No sales yet today: open the latest day that has some (once, so a tap to close sticks).
  const autoOpened = React.useRef(false);
  useEffect(() => {
    if (autoOpened.current || sections.length < 2) return;
    autoOpened.current = true;
    if (sections[0].txs.length === 0) setActiveOpenSection(sections[1].key);
  }, [sections]);

  if (!canViewSales) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-6 bg-app-bg text-center font-sans">
        <div className="p-4 bg-red-500/10 rounded-2xl border border-red-500/20 text-red-500 max-w-sm flex flex-col items-center gap-2.5 shadow">
          <ShieldAlert size={36} />
          <div>
            <h4 className="font-semibold text-sm">No access</h4>
            <p className="text-[11px] text-app-text-muted mt-1 leading-relaxed">
              Your role ({currentEmployee?.role || "Guest"}) can't see sales.
            </p>
          </div>
        </div>
      </div>
    );
  }

  const renderTxRow = (tx: Transaction) => {
    const isSynced = tx.status === "Synced";
    // Aggregate quantities by unit, e.g. "9 Litres" or "5 Litres, 3 Units"
    const unitTotals = new Map<string, number>();
    (tx.items || []).forEach((item) => {
      const unit = item.product?.unit?.trim() || "unit";
      const key = unit.toLowerCase();
      unitTotals.set(key, (unitTotals.get(key) || 0) + item.quantity);
    });
    const unitSummary = Array.from(unitTotals.entries())
      .map(([unit, qty]) => {
        // Units are often saved plural already ("packets", "litres"): only add an s when missing.
        const singular = unit.endsWith("s") && unit.length > 2 ? unit.slice(0, -1) : unit;
        const plural = qty === 1 ? singular : `${singular}s`;
        return `${qty} ${plural}`;
      })
      .join(", ");
    const itemQty = tx.items ? tx.items.reduce((acc, item) => acc + item.quantity, 0) : 0;
    // What was sold, product first: "2 × Milk 500ml, 1 × Bread and 2 more".
    const lines = tx.items || [];
    const products = lines
      .slice(0, 3)
      .map((item) => `${item.quantity} × ${titleCase(item.product?.name || 'Item')}`)
      .join(", ") + (lines.length > 3 ? ` and ${lines.length - 3} more` : "");


    return (
      <SwipeRow
        key={tx.id}
        searchId={`sale-${tx.id}`}
        onClick={() => handleSelectTx(tx)}
        // Hold a sale to see everything in it without opening the receipt.
        title={`${formatReceiptNumber(tx.id)} · ${formatCurrency(tx.finalTotal)}`}
        subtitle={`${new Date(tx.timestamp).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })} · ${getPaymentMethodLabel(tx.paymentMethod)} · by ${titleCase(tx.staffName)}`}
        details={
          <div className="space-y-1.5">
            {tx.customerName && <p className="text-xs text-app-text-muted">Customer: <span className="text-app-text font-medium">{titleCase(tx.customerName)}</span></p>}
            <ul className="space-y-1">
              {(tx.items || []).map((item, i) => (
                <li key={i} className="flex items-baseline justify-between gap-3">
                  <span className="min-w-0 truncate">{item.quantity} × {titleCase(item.product?.name || 'Item')}</span>
                  <span className="tabular-nums text-app-text-muted shrink-0">{formatCurrency((item.product?.price || 0) * item.quantity * (1 - (item.discountPercentage || 0) / 100))}</span>
                </li>
              ))}
            </ul>
            <p className="flex justify-between font-semibold pt-1 border-t border-app-border/60">
              <span>Total</span>
              <span className="tabular-nums">{formatCurrency(tx.finalTotal)}</span>
            </p>
          </div>
        }
        actions={[
          { label: 'Edit', icon: <Pencil size={18} />, tone: 'amber', hidden: !canRefund(tx), onClick: () => startRefund(tx, 'edit') },
          { label: 'Refund', icon: <Undo2 size={18} />, tone: 'amber', hidden: !canRefund(tx), onClick: () => startRefund(tx, 'refund') },
        ]}
        more={[
          { label: 'Open receipt (print or share)', icon: <ReceiptText size={16} />, onClick: () => handleSelectTx(tx) },
          { label: 'Edit sale (redo in the till)', icon: <Pencil size={16} />, hidden: !canRefund(tx), onClick: () => startRefund(tx, 'edit') },
          { label: 'Refund (credit note)', icon: <Undo2 size={16} />, hidden: !canRefund(tx), onClick: () => startRefund(tx, 'refund') },
          { label: `Changes made to this sale (${edits.get(tx.id)?.length ?? 0})`, icon: <History size={16} />, hidden: !edits.get(tx.id)?.length, onClick: () => setEditsOf(tx) },
        ]}
        className="rounded-2xl border border-app-border shadow-2xs hover:border-amber-500 transition animate-fadeIn"
        contentClassName="p-3.5 flex items-center justify-between gap-3 cursor-pointer select-none"
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <CopyRef value={formatReceiptNumber(tx.id)} label="receipt" className="font-bold text-[10px]" />
            {/* Only a sale saved on this device and not yet sent is marked; sent sales need no badge. */}
            {!isSynced && (
              <span className="text-[11px] font-semibold px-1.5 py-0.5 rounded flex items-center gap-1 bg-rose-600/15 text-rose-600 dark:text-rose-300">
                <span className="w-1 h-1 rounded-full bg-current" />
                <span>Waiting to sync</span>
              </span>
            )}
            {edits.get(tx.id)?.length ? (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); setEditsOf(tx); }}
                className="text-[11px] font-semibold px-1.5 py-0.5 rounded bg-sky-500/15 text-sky-700 dark:text-sky-300 flex items-center gap-1 cursor-pointer"
                title="This sale was changed after it was made. See what changed."
              >
                <History size={10} /> Edited {edits.get(tx.id)!.length}×
              </button>
            ) : null}
            {refunds.get(tx.id)?.length ? (
              <span className="text-[11px] font-semibold px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-700 dark:text-amber-300" title={refunds.get(tx.id)!.map((r) => `${r.number} ${formatCurrency(r.total)}`).join(', ')}>
                {refunds.get(tx.id)!.some((r) => r.edit) ? 'Edited, redone in the till' : <>Refunded {formatCurrency(refunds.get(tx.id)!.reduce((s, r) => s + r.total, 0))} · {refunds.get(tx.id)![0].number}</>}
              </span>
            ) : null}
          </div>

          {products && (
            <h3 className="text-xs font-semibold text-app-text mt-1.5 truncate">{products}</h3>
          )}
          <div className="flex items-center gap-2 text-[10px] text-app-text-muted mt-0.5 font-semibold">
            <span className="text-amber-600 dark:text-amber-400 font-bold">{formatCurrency(tx.finalTotal)}</span>
            <span>·</span>
            <span>{unitSummary || `${itemQty} items`}</span>
            <span>·</span>
            <span>{getPaymentMethodLabel(tx.paymentMethod)}</span>
            {tx.customerName && (
              <>
                <span>·</span>
                <span className="text-amber-500 font-bold truncate max-w-[100px]">
                  {titleCase(tx.customerName)}
                </span>
              </>
            )}
          </div>
        </div>

        <div className="flex flex-col items-end gap-1 shrink-0 text-right">
          <span className="text-[11px] font-mono text-app-text-muted font-bold text-slate-400">
            {new Date(tx.timestamp).toLocaleTimeString([], {
              hour: '2-digit',
              minute: '2-digit',
            })}
          </span>
          <span className="text-[11px] font-mono text-app-text-muted block font-medium">
            By {titleCase(tx.staffName)}
          </span>
          <button className="p-1 text-app-text-muted bg-app-bg border border-app-border rounded-lg mt-1 hover:bg-app-card transition">
            <FileText size={12} />
          </button>
        </div>
      </SwipeRow>
    );
  };

  const totalTxCount = Array.isArray(transactions) ? transactions.length : 0;

  return (
    <div className="flex-1 flex flex-col h-full bg-app-bg text-app-text relative overflow-hidden font-sans">
      {/* HEADER CONTROLS BAR */}
      <div className="bg-app-card border-b border-app-border p-3.5 flex items-center justify-between shrink-0 shadow-xs">
        <div>
          <h2 className="text-sm font-semibold font-display text-app-text">
            Sales Log
          </h2>
          <p className="text-[10px] text-app-text-muted font-medium">
            {view === "quotes" ? "Quotes from the POS cart" : "Every sale, newest first"}
          </p>
        </div>
        <span className="px-2.5 py-1 bg-app-bg text-app-text border border-app-border rounded-full font-mono font-bold text-[10px] shadow-sm">
           {totalTxCount}
        </span>
      </div>

      {seesQuotes && (
        <div className="px-3.5 pt-3 shrink-0">
          <Tabs
            tabs={[
              { id: "sales" as const, label: "Sales", icon: <ReceiptText size={14} />, shortcut: "sales-tab" },
              { id: "quotes" as const, label: "Quotes", icon: <FileText size={14} />, shortcut: "quotes-tab" },
            ]}
            activeTab={view}
            onChange={(t) => setView(t as "sales" | "quotes")}
            className="pb-3"
          />
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-3.5 flex flex-col gap-4 pb-nav">
        {view === "quotes" ? (
          <QuotesPanel />
        ) : totalTxCount === 0 ? (
          <div className="p-12 bg-app-card rounded-2xl border border-dashed border-app-border text-center text-xs text-app-text-muted flex flex-col items-center gap-2 my-auto">
            <ReceiptText size={24} className="text-app-text-muted" />
            <span>No sales yet.</span>
          </div>
        ) : (
          sections.map((sec) => {
            const open = activeOpenSection === sec.key;
            const isToday = sec.key === "today";
            return (
              <div key={sec.key} className="flex flex-col gap-2 bg-app-card/30 p-1.5 border border-app-border/50 rounded-2xl">
                <button
                  type="button"
                  onClick={() => handleToggleSection(sec.key)}
                  aria-expanded={open}
                  className="w-full flex items-center justify-between gap-3 p-2 hover:bg-app-card/60 rounded-xl transition text-left cursor-pointer"
                >
                  <span className="flex items-center gap-2 min-w-0">
                    <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${isToday ? "bg-emerald-500" : "bg-slate-400"}`} />
                    <span className={`text-xs font-bold truncate ${isToday ? "text-emerald-600 dark:text-emerald-400" : "text-app-text"}`}>{sec.label}</span>
                  </span>
                  <span className="flex items-center gap-2 text-[11px] text-app-text-muted shrink-0">
                    <span className="tabular-nums">{sec.txs.length} {sec.txs.length === 1 ? "sale" : "sales"}</span>
                    {sec.total > 0 && <span className="tabular-nums font-semibold text-app-text">{formatCurrency(sec.total)}</span>}
                    {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                  </span>
                </button>

                {open && (
                  <div className="space-y-2 mt-1 px-0.5 animate-fadeIn">
                    {sec.txs.length === 0 ? (
                      <div className="p-5 border border-dashed border-app-border rounded-xl text-center text-xs text-app-text-muted">
                        No sales yet today.
                      </div>
                    ) : (
                      sec.txs.map(renderTxRow)
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      <ReceiptSheet
        transaction={selectedTx}
        onClose={() => setSelectedTx(null)}
        onRefund={selectedTx && canRefund(selectedTx) ? () => { startRefund(selectedTx, 'refund'); setSelectedTx(null); } : undefined}
        onEdit={selectedTx && canRefund(selectedTx) ? () => { startRefund(selectedTx, 'edit'); setSelectedTx(null); } : undefined}
      />
      {refunding && <RefundSheet transactionId={refunding.id} mode={refundMode} onClose={() => setRefunding(null)} onDone={() => loadRefunds()} />}
      {editsOf && (
        <SaleEditsSheet sale={editsOf} entries={edits.get(editsOf.id) ?? []} onClose={() => setEditsOf(null)} />
      )}
    </div>
  );
}

/** What was changed on one sale after it was made, who changed it and when, oldest first. */
function SaleEditsSheet({ sale, entries, onClose }: { sale: Transaction; entries: AuditEntry[]; onClose: () => void }) {
  useOverlay(true, onClose, "bottom-sheet");
  return (
    <SheetLayer>
      <div className="absolute inset-0 z-50 bg-black/60 flex items-end md:items-center justify-center p-0 md:p-4" onClick={onClose}>
        <div
          role="dialog"
          aria-label={`Changes to sale ${formatReceiptNumber(sale.id)}`}
          onClick={(e) => e.stopPropagation()}
          className="w-full md:max-w-md max-h-[85%] bg-app-card border border-app-border rounded-t-3xl md:rounded-3xl shadow-2xl flex flex-col overflow-hidden"
        >
          <div className="px-5 py-4 border-b border-app-border flex items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-app-text">Changes to sale {formatReceiptNumber(sale.id)}</h2>
              <p className="text-xs text-app-text-muted mt-0.5">Logged by the system; nobody can change or remove them.</p>
            </div>
            <button type="button" onClick={onClose} aria-label="Close" className="p-2 rounded-xl hover:bg-app-bg text-app-text-muted cursor-pointer">
              <X size={16} />
            </button>
          </div>
          <ol className="overflow-y-auto p-4 flex flex-col gap-3 pb-[calc(1rem+var(--inset-bottom))]">
            {entries.map((e) => (
              <li key={e.id} className="rounded-2xl border border-app-border p-3">
                <p className="text-xs font-semibold text-app-text">{describeAction(e)}</p>
                <p className="text-[11px] text-app-text-muted">
                  {e.by || "Someone"} · {new Date(e.at).toLocaleString("en-KE", { dateStyle: "medium", timeStyle: "short" })}
                </p>
                {describeChanges(e.changes).length > 0 && (
                  <ul className="mt-2 space-y-1">
                    {describeChanges(e.changes).map((c, i) => (
                      <li key={i} className="text-xs text-app-text break-words">{c}</li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ol>
        </div>
      </div>
    </SheetLayer>
  );
}
