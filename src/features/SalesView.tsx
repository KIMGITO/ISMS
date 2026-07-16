// src/features/SalesView.tsx
// Re-engineered Chat-Style Accordion Chronological Sales Tracker

import React, { useState, useMemo } from "react";
import { useAppStore } from "../stores/appStore";
import { Transaction } from "../types";
import { 
  ReceiptText, FileText, CheckCircle2, Clock, MapPin, Printer, 
  ArrowLeft, ShieldAlert, Share2, Send, MessageSquare, Download, Check, AlertCircle, Share, ChevronDown, ChevronUp
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { hasRolePermission } from "../utils/permissions";
import { useCustomerStore } from "../stores/customerStore";
import { useNotificationStore } from "../stores/notificationStore";
import { ReceiptService, ReceiptRenderer } from "../services/receipt/ReceiptService";
import { ReceiptContent, BusinessReceiptSettings } from "../services/receipt/types";
import { formatCurrency } from "../utils/helpers";
import { formatReceiptNumber } from "../utils/idUtils";
import { ReceiptPrinter } from "../services/printer/ReceiptPrinter";
import { normalizePhone } from "../utils/phoneUtils";
import { titleCase } from "../utils/stringUtils";

interface GroupedTransactions {
  today: Transaction[];
  yesterday: Transaction[];
  older: Record<string, Transaction[]>;
}

export default function SalesView() {
  const { transactions, currentEmployee } = useAppStore();
  const { customers } = useCustomerStore();
  const { showToast } = useNotificationStore();
  
  const [selectedTx, setSelectedTx] = useState<Transaction | null>(null);
  const [generatedReceipt, setGeneratedReceipt] = useState<{ content: ReceiptContent; settings: BusinessReceiptSettings } | null>(null);
  const [printNotice, setPrintNotice] = useState(false);
  const [phoneNum, setPhoneNum] = useState("");
  const [apiSending, setApiSending] = useState(false);

  // ── FIX: Track only ONE active open section string to auto-collapse others ──
  const [activeOpenSection, setActiveOpenSection] = useState<string>("today");

  const handleToggleSection = (sectionKey: string) => {
    // If clicking the already open section, close it (or leave it open based on choice, here we toggle)
    setActiveOpenSection(prev => prev === sectionKey ? "" : sectionKey);
  };

  const handleSelectTx = async (tx: Transaction | null) => {
    setSelectedTx(tx);
    if (tx) {
      const cust = tx.customerId ? customers.find(c => c.id === tx.customerId) : null;
      setPhoneNum(cust?.phone || "");
      
      try {
        const outstandingBalance = cust?.debtBalance || 0;
        const receiptData = await ReceiptService.generateReceipt(tx, tx.businessId || "biz-1", {
          customerEmail: cust?.email,
          outstandingBalance,
          customNotes: tx.note
        });
        setGeneratedReceipt(receiptData);
      } catch (err) {
        console.error("Failed to generate receipt content:", err);
      }
    } else {
      setPhoneNum("");
      setGeneratedReceipt(null);
    }
  };

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
    const itemQty = tx.items ? tx.items.reduce((acc, item) => acc + item.quantity, 0) : 0;

    return (
      <div
        key={tx.id}
        onClick={() => handleSelectTx(tx)}
        className="bg-app-card rounded-2xl border border-app-border p-3.5 flex items-center justify-between gap-3 shadow-2xs hover:border-amber-500 cursor-pointer transition select-none animate-fadeIn"
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[10px] font-mono font-bold text-app-text-muted">{formatReceiptNumber(tx.id)}</span>
            <span className={`text-[9px] font-black px-1.5 py-0.5 rounded flex items-center gap-1 ${
              isSynced ? "bg-emerald-500/15 text-emerald-500" : "bg-amber-500/15 text-amber-500 "
            }`}>
              <span className="w-1 h-1 rounded-full bg-current" />
              <span>{isSynced ? "Synced" : "Offline"}</span>
            </span>
          </div>

          <h3 className="text-xs font-black text-amber-500 mt-1.5">{formatCurrency(tx.finalTotal)}</h3>
          <div className="flex items-center gap-2 text-[10px] text-app-text-muted mt-0.5 font-semibold">
            <span>{itemQty} items</span>
            <span>·</span>
            <span>{(tx.paymentMethod || "Cash").replace("_", " ")}</span>
            {tx.customerName && (
              <>
                <span>·</span>
                <span className="text-amber-500 font-bold truncate max-w-[100px]">{titleCase(tx.customerName)}</span>
              </>
            )}
          </div>
        </div>

        <div className="flex flex-col items-end gap-1 shrink-0 text-right">
          <span className="text-[9px] font-mono text-app-text-muted font-bold text-slate-400">
            {new Date(tx.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </span>
          <span className="text-[8.5px] font-mono text-app-text-muted block font-medium">By {titleCase(tx.staffName)}</span>
          <button className="p-1 text-app-text-muted bg-app-bg border border-app-border rounded-lg mt-1 hover:bg-app-card transition"><FileText size={12} /></button>
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
          <h2 className="text-sm font-extrabold font-display text-app-text uppercase tracking-wide">Business Sales Logs</h2>
          <p className="text-[10px] text-app-text-muted font-medium">Accordion Day Stream: Opening a day row automatically collapses all others.</p>
        </div>
        <span className="px-2.5 py-1 bg-app-bg text-app-text border border-app-border rounded-full font-mono font-bold text-[10px] shadow-sm">
          Total: {totalTxCount}
        </span>
      </div>

      {/* CHAT-STYLE SCROLL CONTAINER CONTAINER PANEL */}
      <div className="flex-1 overflow-y-auto p-3.5 flex flex-col gap-4 pb-24">
        {totalTxCount === 0 ? (
          <div className="p-12 bg-app-card rounded-2xl border border-dashed border-app-border text-center text-xs text-app-text-muted flex flex-col items-center gap-2 my-auto">
            <ReceiptText size={24} className="text-app-text-muted" />
            <span>No orders completed in this session yet. Complete some sales in POS!</span>
          </div>
        ) : (
          <>
            {/* 1. ARCHIVED HISTORICAL DATES */}
            {Object.entries(groupedLogs.older).map(([dateLabel, txList]) => {
              const isSectionOpen = activeOpenSection === dateLabel;
              return (
                <div key={dateLabel} className="flex flex-col gap-2 bg-app-card/30 p-1.5 border border-app-border/40 rounded-2xl">
                  <button 
                    type="button" 
                    onClick={() => handleToggleSection(dateLabel)}
                    className="w-full flex items-center justify-between p-2 hover:bg-app-card/60 rounded-xl transition text-left cursor-pointer"
                  >
                    <div className="flex items-center gap-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-slate-500" />
                      <span className="text-[10px] font-black font-mono text-app-text tracking-wide uppercase">Archive: {dateLabel}</span>
                    </div>
                    <div className="flex items-center gap-2 text-[9px] font-black text-app-text-muted uppercase">
                      <span>{txList.length} logs</span>
                      {isSectionOpen ? <ChevronUp size={14} /> : <ChevronDown size={12} />}
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
                  onClick={() => handleToggleSection("yesterday")}
                  className="w-full flex items-center justify-between p-2 hover:bg-app-card/60 rounded-xl transition text-left cursor-pointer"
                >
                  <div className="flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-500/60" />
                    <span className="text-[10px] font-black text-app-text tracking-wider uppercase">Yesterday's Invoices</span>
                  </div>
                  <div className="flex items-center gap-2 text-[9px] font-black text-app-text-muted uppercase">
                    <span>{groupedLogs.yesterday.length} logs</span>
                    {activeOpenSection === "yesterday" ? <ChevronUp size={14} /> : <ChevronDown size={12} />}
                  </div>
                </button>

                {activeOpenSection === "yesterday" && (
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
                onClick={() => handleToggleSection("today")}
                className="w-full flex items-center justify-between p-2 hover:bg-app-card/60 rounded-xl transition text-left cursor-pointer"
              >
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-emerald-500 animate-ping" />
                  <span className="text-[10px] font-black text-emerald-500 uppercase tracking-widest">Live Feed • Today's Activity</span>
                </div>
                <div className="flex items-center gap-2 text-[9px] font-black text-app-text-muted uppercase">
                  <span>{groupedLogs.today.length} logs</span>
                  {activeOpenSection === "today" ? <ChevronUp size={14} /> : <ChevronDown size={12} />}
                </div>
              </button>
              
              {activeOpenSection === "today" && (
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

      {/* DETAILED RECEIPT MODAL DRAWER OVERLAY */}
      <AnimatePresence>
        {selectedTx && (
          <div className="absolute inset-0 z-50 bg-slate-950/80 backdrop-blur-xs flex items-center justify-center p-4">
            <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }} className="bg-app-card border border-app-border w-full max-w-2xl rounded-3xl p-5 shadow-2xl overflow-hidden flex flex-col max-h-[95%]">
              <div className="flex items-center justify-between shrink-0 mb-4 border-b border-app-border pb-3">
                <button onClick={() => handleSelectTx(null)} className="px-3 py-1.5 hover:bg-app-bg text-app-text border border-app-border rounded-xl transition flex items-center gap-1.5 text-xs font-bold cursor-pointer"><ArrowLeft size={14} /><span>Close Log</span></button>
                <div className="flex items-center gap-2">
                  <button onClick={async () => { if (!generatedReceipt) return; const didHardwarePrint = ReceiptPrinter.printReceipt(generatedReceipt.content); if (didHardwarePrint) { showToast("Printer Queue", "Receipt queued.", undefined, "success"); return; } const printContainer = document.querySelector(".print-receipt-container"); if (printContainer) { setPrintNotice(true); const success = await ReceiptService.print(printContainer.innerHTML); setPrintNotice(false); if (success) { showToast("Printer Gateway", "Sent to spool.", undefined, "success"); } } }} disabled={!generatedReceipt} className="px-4 py-1.5 bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-slate-950 font-black rounded-xl text-xs flex items-center gap-1.5 transition cursor-pointer shadow-sm"><Printer size={13} /><span>Print Receipt</span></button>
                </div>
              </div>

              {printNotice && <div className="mb-3.5 p-2 bg-amber-500/10 border border-amber-500/20 text-amber-500 font-bold rounded-xl text-center text-[10px] ">🖨️ Opening print dialog... Prefitting paper frames.</div>}

              <div className="flex-1 grid grid-cols-1 md:grid-cols-2 gap-4 overflow-y-auto pr-1">
                <div className="flex flex-col h-full min-h-[350px]">
                  <div className="flex items-center justify-between mb-1.5"><span className="text-[9px] text-app-text-muted font-bold uppercase block">Receipt Preview</span></div>
                  <div className="flex-1 overflow-y-auto p-3.5 bg-white text-slate-950 rounded-2xl border border-slate-200 print-receipt-container flex flex-col justify-between">
                    {generatedReceipt ? <ReceiptRenderer content={generatedReceipt.content} settings={generatedReceipt.settings} /> : <div className="flex-1 flex flex-col items-center justify-center gap-2 text-slate-500"><div className="w-5 h-5 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" /><span>Compiling layout content...</span></div>}
                  </div>
                </div>

                <div className="flex flex-col justify-between bg-app-bg border border-app-border rounded-2xl p-4 space-y-4">
                  <div className="space-y-4">
                    <div>
                      <div className="flex items-center gap-1.5 mb-2"><Download size={13} className="text-amber-500" /><span className="text-[10px] text-app-text font-black uppercase">Export Vouchers</span></div>
                      <div className="grid grid-cols-3 gap-1.5">
                        <button onClick={() => { if (!generatedReceipt) return; const p = document.querySelector(".print-receipt-container")?.innerHTML || ""; ReceiptService.exportToHtml(generatedReceipt.content, generatedReceipt.settings, p); }} className="py-2 px-1 text-center bg-app-card border border-app-border hover:bg-app-border text-app-text font-bold rounded-xl text-[9.5px] transition flex flex-col items-center justify-center gap-1 cursor-pointer"><FileText size={14} className="text-blue-400" /><span>HTML File</span></button>
                        <button onClick={() => { if (!generatedReceipt) return; ReceiptService.exportToText(generatedReceipt.content, generatedReceipt.settings); }} className="py-2 px-1 text-center bg-app-card border border-app-border hover:bg-app-border text-app-text font-bold rounded-xl text-[9.5px] transition flex flex-col items-center justify-center gap-1 cursor-pointer"><ReceiptText size={14} className="text-amber-400" /><span>POS Text</span></button>
                        <button onClick={() => { if (!generatedReceipt) return; const p = document.querySelector(".print-receipt-container")?.innerHTML || ""; ReceiptService.exportToPdf(generatedReceipt.content, generatedReceipt.settings, p); }} className="py-2 px-1 text-center bg-app-card border border-app-border hover:bg-app-border text-app-text font-bold rounded-xl text-[9.5px] transition flex flex-col items-center justify-center gap-1 cursor-pointer"><Download size={14} className="text-emerald-400" /><span>PDF File</span></button>
                      </div>
                    </div>

                    <div className="border-t border-app-border/40 my-1" />

                    <div>
                      <div className="flex items-center gap-1.5 mb-2"><Share2 size={13} className="text-amber-500" /><span className="text-[10px] text-app-text font-black uppercase">Sharing Gateway</span></div>
                      <div className="space-y-2.5">
                        <input type="text" value={phoneNum} onChange={(e) => setPhoneNum(e.target.value)} placeholder="Phone: +254..." className="w-full bg-app-card border border-app-border rounded-xl px-3 py-2 text-xs text-app-text font-mono focus:outline-none" />
                        <div className="space-y-1.5">
                          <button onClick={() => { if (!generatedReceipt) return; ReceiptService.shareViaWhatsApp(generatedReceipt.content, generatedReceipt.settings, normalizePhone(phoneNum)); }} className="w-full bg-[#25D366]/10 border border-[#25D366]/20 text-[#25D366] font-bold text-xs py-2 px-3 rounded-xl flex items-center justify-between cursor-pointer"><span>WhatsApp </span><span className="text-[7.5px] font-black bg-[#25D366]/20 px-1.5 py-0.5 rounded">WA LINK</span></button>
                          <button onClick={() => { if (!generatedReceipt) return; ReceiptService.shareViaEmail(generatedReceipt.content, generatedReceipt.settings); }} className="w-full bg-blue-500/10 border border-blue-500/20 text-blue-400 font-bold text-xs py-2 px-3 rounded-xl flex items-center justify-between cursor-pointer"><span>Email </span><span className="text-[7.5px] font-black bg-blue-500/20 px-1.5 py-0.5 rounded">MAILTO</span></button>
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className="mt-4 border-t border-app-border/80 pt-3 flex items-center gap-2 text-[8.5px] text-app-text-muted"><div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-ping" /><span>POS Ledger Processing Ready (Capacitor Runtime Hydrated)</span></div>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

    </div>
  );
}