// src/features/SalesView.tsx
// Sales Log: every sale, grouped by day, newest first.

import React, { useState, useMemo, useEffect } from "react";
import { useUiStore } from "../stores/uiStore";
import { useAppStore } from "../stores/appStore";
import { Transaction } from "../types";
import { ReceiptText, FileText, ShieldAlert, ChevronDown, ChevronUp, Trash2, Undo2 } from "lucide-react";
import { hasRolePermission } from "../utils/permissions";
import { formatCurrency } from "../utils/helpers";
import { formatReceiptNumber } from "../utils/idUtils";
import { titleCase } from "../utils/stringUtils";
import { ReceiptSheet } from "../components/receipts/ReceiptSheet";
import { SwipeRow } from "../components/shared/SwipeRow";
import { appDialog } from "../components/AppDialog";
import { deleteLogRows, oldEnoughToDelete, useIsAdmin } from "../services/logCleanup";
import { useBusinessStore } from "../stores/businessStore";
import { useTransactionStore } from "../stores/transactionStore";
import { toUserMessage } from "../utils/userError";
import { RefundSheet } from "../components/sales/RefundSheet";
import { loadSaleCreditNotes } from "../services/salesDocs";
import { Tabs } from "../components/TabOptions";
import QuotesPanel from "../components/sales/QuotesPanel";

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
    const tx = transactions.find((t) => t.id === searchTarget.id);
    if (tx) setSelectedTx(tx);
    useUiStore.getState().setSearchTarget(null);
  }, [searchTarget, transactions]);

  // Owners and admins can delete sales older than 90 days (swipe left on a phone, right-click
  // or hold elsewhere). The database enforces the same age.
  const isAdmin = useIsAdmin();
  const businessId = useBusinessStore((s) => s.activeBusinessId);
  const canDelete = (tx: Transaction) => isAdmin && tx.status === "Synced" && oldEnoughToDelete("sales", tx.timestamp);
  const deleteSale = async (tx: Transaction) => {
    if (!businessId) return;
    const ok = await appDialog.confirm({
      title: `Delete sale ${formatReceiptNumber(tx.id)}?`,
      message: `${formatCurrency(tx.finalTotal)} on ${new Date(tx.timestamp).toLocaleDateString()}. Gone for everyone, for good. Stock, payments and debts stay as they are.`,
      confirmLabel: "Delete",
      destructive: true,
    });
    if (!ok) return;
    try {
      const n = await deleteLogRows(businessId, "sales", [tx.id]);
      if (n === 0) {
        showToast("Not deleted", "Only sales older than 3 months can be deleted.", undefined, "error");
        return;
      }
      useTransactionStore.setState((st) => ({ transactions: st.transactions.filter((t) => t.id !== tx.id) }));
      showToast("Deleted", "Sale deleted.", undefined, "success");
    } catch (err) {
      showToast("Not deleted", toUserMessage(err, "Could not delete. Check your connection."), undefined, "error");
    }
  };

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
  const [refunds, setRefunds] = useState<Map<string, { number: string; total: number }[]>>(new Map());
  const loadRefunds = React.useCallback(() => {
    if (!businessId) return;
    loadSaleCreditNotes(businessId).then(setRefunds).catch(() => undefined);
  }, [businessId]);
  useEffect(() => { loadRefunds(); }, [loadRefunds, transactions.length]);

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
      sec.total += tx.finalTotal || 0;
    }
    // Map keeps insertion order: today first, then days in the order of the newest-first sales.
    return Array.from(byDay.values());
  }, [transactions]);

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
            <h4 className="font-extrabold text-sm uppercase tracking-wider">No access</h4>
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
          { label: 'Refund', icon: <Undo2 size={18} />, tone: 'amber', hidden: !canRefund(tx), onClick: () => setRefunding(tx) },
          { label: 'Delete', icon: <Trash2 size={18} />, tone: 'red', hidden: !canDelete(tx), onClick: () => void deleteSale(tx) },
        ]}
        more={[
          { label: 'Open receipt (print or share)', icon: <ReceiptText size={16} />, onClick: () => handleSelectTx(tx) },
          { label: 'Refund (credit note)', icon: <Undo2 size={16} />, hidden: !canRefund(tx), onClick: () => setRefunding(tx) },
          { label: 'Delete sale', icon: <Trash2 size={16} />, tone: 'red', hidden: !canDelete(tx), onClick: () => void deleteSale(tx) },
        ]}
        className="rounded-2xl border border-app-border shadow-2xs hover:border-amber-500 transition animate-fadeIn"
        contentClassName="p-3.5 flex items-center justify-between gap-3 cursor-pointer select-none"
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[10px] font-mono font-bold text-app-text-muted">
              {formatReceiptNumber(tx.id)}
            </span>
            <span
              className={`text-[9px] font-black px-1.5 py-0.5 rounded flex items-center gap-1 ${
                isSynced
                  ? 'bg-emerald-500/15 text-emerald-500'
                  : 'bg-rose-600/15 text-rose-600 dark:text-rose-300' // saved on this phone, not yet on the server
              }`}
            >
              <span className="w-1 h-1 rounded-full bg-current" />
              <span>{isSynced ? 'Synced' : 'Waiting to sync'}</span>
            </span>
            {refunds.get(tx.id)?.length ? (
              <span className="text-[9px] font-black px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-700 dark:text-amber-300" title={refunds.get(tx.id)!.map((r) => `${r.number} ${formatCurrency(r.total)}`).join(', ')}>
                Refunded {formatCurrency(refunds.get(tx.id)!.reduce((s, r) => s + r.total, 0))} · {refunds.get(tx.id)![0].number}
              </span>
            ) : null}
          </div>

          <h3 className="text-xs font-black text-amber-500 mt-1.5">
            {formatCurrency(tx.finalTotal)}
          </h3>
          <div className="flex items-center gap-2 text-[10px] text-app-text-muted mt-0.5 font-semibold">
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
          <span className="text-[9px] font-mono text-app-text-muted font-bold text-slate-400">
            {new Date(tx.timestamp).toLocaleTimeString([], {
              hour: '2-digit',
              minute: '2-digit',
            })}
          </span>
          <span className="text-[8.5px] font-mono text-app-text-muted block font-medium">
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
          <h2 className="text-sm font-extrabold font-display text-app-text uppercase tracking-wide">
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

      <ReceiptSheet transaction={selectedTx} onClose={() => setSelectedTx(null)} />
      {refunding && <RefundSheet transactionId={refunding.id} onClose={() => setRefunding(null)} onDone={() => loadRefunds()} />}
    </div>
  );
}