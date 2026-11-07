// src/features/SalesView.tsx
// Re-engineered Chat-Style Accordion Chronological Sales Tracker

import React, { useState, useMemo } from "react";
import { useAppStore } from "../stores/appStore";
import { Transaction } from "../types";
import { ReceiptText, FileText, ShieldAlert, ChevronDown, ChevronUp } from "lucide-react";
import { hasRolePermission } from "../utils/permissions";
import { formatCurrency } from "../utils/helpers";
import { formatReceiptNumber } from "../utils/idUtils";
import { titleCase } from "../utils/stringUtils";
import { ReceiptSheet } from "../components/receipts/ReceiptSheet";

interface GroupedTransactions {
  today: Transaction[];
  yesterday: Transaction[];
  older: Record<string, Transaction[]>;
}

function getPaymentMethodLabel(method: string | undefined): string {
  switch (method) {
    case 'Cash':
      return 'Cash';
    case 'M-Pesa':
      return 'M-Pesa';
    case 'Card':
      return 'Card';
    case 'Bank':
      return 'Bank Transfer';
    case 'Mobile_Wallet':
      return 'Mobile Wallet';
    case 'Credit_Debt':
      return 'Credit Sale';
    case 'Credit':
      return 'Credit Sale';
    default:
      return method || 'Cash';
  }
}

export default function SalesView() {
  const { transactions, currentEmployee } = useAppStore();
  const [selectedTx, setSelectedTx] = useState<Transaction | null>(null);

  // ── FIX: Track only ONE active open section string to auto-collapse others ──
  const [activeOpenSection, setActiveOpenSection] = useState<string>("today");

  const handleToggleSection = (sectionKey: string) => {
    // If clicking the already open section, close it (or leave it open based on choice, here we toggle)
    setActiveOpenSection(prev => prev === sectionKey ? "" : sectionKey);
  };

  const handleSelectTx = (tx: Transaction | null) => setSelectedTx(tx);

  const canViewSales = currentEmployee ? hasRolePermission(currentEmployee.role, "orders.view") : false;

  const groupedLogs = useMemo((): GroupedTransactions => {
    const safeTx = Array.isArray(transactions) ? transactions : [];
    
    // Messaging thread sorting layout (Oldest at top, Latest at bottom)
    const chronologicalTx = [...safeTx].sort((a, b) => 
      new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );

    const todayStr = new Date().toLocaleDateString();
    
    const yest = new Date();
    yest.setDate(yest.getDate() - 1);
    const yesterdayStr = yest.toLocaleDateString();

    const groups: GroupedTransactions = { today: [], yesterday: [], older: {} };

    chronologicalTx.forEach(tx => {
      const txDate = new Date(tx.timestamp);
      const txDateStr = txDate.toLocaleDateString();

      if (txDateStr === todayStr) {
        groups.today.push(tx);
      } else if (txDateStr === yesterdayStr) {
        groups.yesterday.push(tx);
      } else {
        if (!groups.older[txDateStr]) {
          groups.older[txDateStr] = [];
        }
        groups.older[txDateStr].push(tx);
      }
    });

    return groups;
  }, [transactions]);

  if (!canViewSales) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-6 bg-app-bg text-center font-sans">
        <div className="p-4 bg-red-500/10 rounded-2xl border border-red-500/20 text-red-500 max-w-sm flex flex-col items-center gap-2.5 shadow">
          <ShieldAlert size={36} />
          <div>
            <h4 className="font-extrabold text-sm uppercase tracking-wider">Access Restrained</h4>
            <p className="text-[11px] text-app-text-muted mt-1 leading-relaxed">
              Your operator account role (<strong>{currentEmployee?.role || "Guest"}</strong>) does not hold the clearances to review transaction records.
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
        const displayUnit = unit === "unit" ? "unit" : unit;
        const plural = qty === 1 ? displayUnit : `${displayUnit}s`;
        return `${qty} ${plural}`;
      })
      .join(", ");
    const itemQty = tx.items ? tx.items.reduce((acc, item) => acc + item.quantity, 0) : 0;


    return (
      <div
        key={tx.id}
        onClick={() => handleSelectTx(tx)}
        className="bg-app-card rounded-2xl border border-app-border p-3.5 flex items-center justify-between gap-3 shadow-2xs hover:border-amber-500 cursor-pointer transition select-none animate-fadeIn"
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
                  : 'bg-amber-500/15 text-amber-500 '
              }`}
            >
              <span className="w-1 h-1 rounded-full bg-current" />
              <span>{isSynced ? 'Synced' : 'Offline'}</span>
            </span>
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
      </div>
    );
  };

  const totalTxCount = Array.isArray(transactions) ? transactions.length : 0;

  return (
    <div className="flex-1 flex flex-col h-full bg-app-bg text-app-text relative overflow-hidden font-sans">
      {/* HEADER CONTROLS BAR */}
      <div className="bg-app-card border-b border-app-border p-3.5 flex items-center justify-between shrink-0 shadow-xs">
        <div>
          <h2 className="text-sm font-extrabold font-display text-app-text uppercase tracking-wide">
            Business Sales Logs
          </h2>
          <p className="text-[10px] text-app-text-muted font-medium">
            Accordion Day Stream: Opening a day row automatically collapses all
            others.
          </p>
        </div>
        <span className="px-2.5 py-1 bg-app-bg text-app-text border border-app-border rounded-full font-mono font-bold text-[10px] shadow-sm">
          Total: {totalTxCount}
        </span>
      </div>

      {/* CHAT-STYLE SCROLL CONTAINER CONTAINER PANEL */}
      <div className="flex-1 overflow-y-auto p-3.5 flex flex-col gap-4 pb-nav">
        {totalTxCount === 0 ? (
          <div className="p-12 bg-app-card rounded-2xl border border-dashed border-app-border text-center text-xs text-app-text-muted flex flex-col items-center gap-2 my-auto">
            <ReceiptText size={24} className="text-app-text-muted" />
            <span>
              No orders completed in this session yet. Complete some sales in
              POS!
            </span>
          </div>
        ) : (
          <>
            {/* 1. ARCHIVED HISTORICAL DATES */}
            {Object.entries(groupedLogs.older).map(([dateLabel, txList]) => {
              const isSectionOpen = activeOpenSection === dateLabel;
              return (
                <div
                  key={dateLabel}
                  className="flex flex-col gap-2 bg-app-card/30 p-1.5 border border-app-border/40 rounded-2xl"
                >
                  <button
                    type="button"
                    onClick={() => handleToggleSection(dateLabel)}
                    className="w-full flex items-center justify-between p-2 hover:bg-app-card/60 rounded-xl transition text-left cursor-pointer"
                  >
                    <div className="flex items-center gap-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-slate-500" />
                      <span className="text-[10px] font-black font-mono text-app-text tracking-wide uppercase">
                        Archive: {dateLabel}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 text-[9px] font-black text-app-text-muted uppercase">
                      <span>{txList.length} logs</span>
                      {isSectionOpen ? (
                        <ChevronUp size={14} />
                      ) : (
                        <ChevronDown size={12} />
                      )}
                    </div>
                  </button>

                  {isSectionOpen && (
                    <div className="space-y-2 mt-1 px-0.5 animate-fadeIn">
                      {txList.map(renderTxRow)}
                    </div>
                  )}
                </div>
              );
            })}

            {/* 2. YESTERDAY SECTION CONTAINER */}
            {groupedLogs.yesterday.length > 0 && (
              <div className="flex flex-col gap-2 bg-app-card/40 p-1.5 border border-app-border rounded-2xl">
                <button
                  type="button"
                  onClick={() => handleToggleSection('yesterday')}
                  className="w-full flex items-center justify-between p-2 hover:bg-app-card/60 rounded-xl transition text-left cursor-pointer"
                >
                  <div className="flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-500/60" />
                    <span className="text-[10px] font-black text-app-text tracking-wider uppercase">
                      Yesterday's Invoices
                    </span>
                  </div>
                  <div className="flex items-center gap-2 text-[9px] font-black text-app-text-muted uppercase">
                    <span>{groupedLogs.yesterday.length} logs</span>
                    {activeOpenSection === 'yesterday' ? (
                      <ChevronUp size={14} />
                    ) : (
                      <ChevronDown size={12} />
                    )}
                  </div>
                </button>

                {activeOpenSection === 'yesterday' && (
                  <div className="space-y-2 mt-1 px-0.5 animate-fadeIn">
                    {groupedLogs.yesterday.map(renderTxRow)}
                  </div>
                )}
              </div>
            )}

            {/* 3. TODAY ACTIVE STREAM (COLLAPSIBLE ACCORDION CONTAINER) */}
            <div className="flex flex-col gap-2 bg-app-card/20 p-1.5 border border-app-border/40 rounded-2xl">
              <button
                type="button"
                onClick={() => handleToggleSection('today')}
                className="w-full flex items-center justify-between p-2 hover:bg-app-card/60 rounded-xl transition text-left cursor-pointer"
              >
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-emerald-500 animate-ping" />
                  <span className="text-[10px] font-black text-emerald-500 uppercase tracking-widest">
                    Live Feed • Today's Activity
                  </span>
                </div>
                <div className="flex items-center gap-2 text-[9px] font-black text-app-text-muted uppercase">
                  <span>{groupedLogs.today.length} logs</span>
                  {activeOpenSection === 'today' ? (
                    <ChevronUp size={14} />
                  ) : (
                    <ChevronDown size={12} />
                  )}
                </div>
              </button>

              {activeOpenSection === 'today' && (
                <div className="space-y-2.5 mt-1 px-0.5 animate-fadeIn">
                  {groupedLogs.today.length === 0 ? (
                    <div className="p-6 bg-app-card/40 border border-dashed border-app-border rounded-xl text-center text-[10px] text-app-text-muted font-bold">
                      No transaction checkouts completed yet today.
                    </div>
                  ) : (
                    groupedLogs.today.map(renderTxRow)
                  )}
                </div>
              )}
            </div>
          </>
        )}
      </div>

      <ReceiptSheet transaction={selectedTx} onClose={() => setSelectedTx(null)} />
    </div>
  );
}