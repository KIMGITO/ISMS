import React, { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Copy, Check, LogOut, Loader2 } from 'lucide-react';
import { useInventoryStore } from '../stores/inventoryStore';
import { useTransactionStore } from '../stores/transactionStore';
import { useCustomerStore } from '../stores/customerStore';
import { useAuthStore } from '../stores/authStore';
import { useNotificationStore } from '../stores/notificationStore';
import { useExtraModulesStore } from '../stores/extraModulesStore';
import { useOverlay } from '../hooks/useOverlay';
import type { Expense } from '../types';
import { buildShiftReport, finishShift, ksh, shiftClock, shiftLength, shiftReportText } from '../services/shiftReport';

interface EndShiftModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Called once the shift has been closed and the report sent. */
  onDone?: () => void;
}

export default function EndShiftModal({ isOpen, onClose, onDone }: EndShiftModalProps) {
  const [saving, setSaving] = useState(false);
  useOverlay(isOpen, () => !saving && onClose(), 'dialog');

  const { products } = useInventoryStore();
  const { transactions, debtPayments } = useTransactionStore();
  const { customers } = useCustomerStore();
  const { activeShift, currentEmployee } = useAuthStore();
  const { productionBatches, billOfMaterials } = useExtraModulesStore();
  const showToast = useNotificationStore((s) => s.showToast);

  const [notes, setNotes] = useState('');
  const [counted, setCounted] = useState('');
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [now, setNow] = useState(() => Date.now());

  // Expenses aren't kept in a store, so they're loaded when the report opens.
  useEffect(() => {
    if (!isOpen) return;
    setError(null);
    setNow(Date.now());
    import('../services/repositories')
      .then(({ ExpenseRepository }) => ExpenseRepository.getAll())
      .then(setExpenses)
      .catch((err) => console.error('Could not load expenses for the shift report:', err));
  }, [isOpen]);

  const report = useMemo(() => {
    if (!activeShift || !currentEmployee) return null;
    return buildShiftReport({
      shift: activeShift,
      employee: currentEmployee,
      transactions,
      debtPayments,
      expenses,
      products,
      customers,
      productionBatches,
      billOfMaterials,
      now,
    });
  }, [activeShift, currentEmployee, transactions, debtPayments, expenses, products, customers, productionBatches, billOfMaterials, now]);

  const countedCash = counted.trim() === '' ? null : Number(counted);
  const countedValid = countedCash === null || (Number.isFinite(countedCash) && countedCash >= 0);
  const diff = report && countedCash !== null && countedValid ? Math.round(countedCash - report.expectedCash) : null;
  const text = report ? shiftReportText(report, { countedCash: countedValid ? countedCash : null, notes }) : '';

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      showToast('Not copied', 'Could not copy the report on this device.', undefined, 'error');
    }
  };

  const endShift = async () => {
    if (saving || !countedValid) return;
    setSaving(true);
    setError(null);
    const ok = await finishShift(text, notes);
    setSaving(false);
    if (ok) {
      setNotes('');
      setCounted('');
      onDone?.();
      onClose();
    } else {
      // Stays open with everything typed, so it can be tried again
      setError('Your shift could not be closed. Check your connection and try again.');
    }
  };

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center sm:p-4">
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="absolute inset-0 bg-slate-950/70 backdrop-blur-sm"
          onClick={() => !saving && onClose()}
        />

        <motion.div
          role="dialog"
          aria-modal="true"
          aria-labelledby="end-shift-title"
          initial={{ opacity: 0, y: 40 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 40 }}
          transition={{ type: 'spring', stiffness: 420, damping: 38 }}
          className="relative w-full sm:max-w-lg bg-app-card rounded-t-2xl sm:rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[92dvh]"
        >
          {/* Header */}
          <div className="flex items-start justify-between gap-3 px-5 pt-5 pb-3">
            <div className="min-w-0">
              <h2 id="end-shift-title" className="text-base font-semibold text-app-text">End shift</h2>
              {report && (
                <p className="text-xs text-app-text-muted mt-0.5">
                  {report.employeeName} · {shiftClock(report.start)} – {shiftClock(report.end)} · {shiftLength(report)}
                </p>
              )}
            </div>
            <button onClick={onClose} disabled={saving} aria-label="Close" className="p-2 -m-1 rounded-lg text-app-text-muted hover:text-app-text hover:bg-app-bg disabled:opacity-40">
              <X size={18} />
            </button>
          </div>

          <div className="px-5 pb-4 overflow-y-auto flex-1 space-y-4">
            {!report ? (
              <p className="text-sm text-app-text-muted py-6 text-center">You don't have an open shift.</p>
            ) : (
              <>
                {/* Sales */}
                <div className="grid grid-cols-2 gap-2">
                  <Tile label="Sales" value={ksh(report.salesTotal)} hint={`${report.salesCount} ${report.salesCount === 1 ? 'sale' : 'sales'}`} strong />
                  <Tile label="Cash" value={ksh(report.cash)} />
                  <Tile label="M-Pesa" value={ksh(report.mpesa)} />
                  <Tile label="On credit" value={ksh(report.credit)} />
                  {report.other > 0 && <Tile label="Card, bank, other" value={ksh(report.other)} />}
                  {report.expensesTotal > 0 && <Tile label="Expenses" value={ksh(report.expensesTotal)} />}
                </div>

                {/* Cash drawer */}
                <div className="rounded-xl bg-app-bg p-3.5 space-y-2.5">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-sm font-medium text-app-text">Cash expected in drawer</span>
                    <span className="text-sm font-semibold text-app-text tabular-nums">{ksh(report.expectedCash)}</span>
                  </div>
                  {(report.cashDebtRepaid > 0 || report.cashExpenses > 0) && (
                    <p className="text-[11px] text-app-text-muted">
                      Cash sales {ksh(report.cash)} + debt repaid {ksh(report.cashDebtRepaid)} − cash expenses {ksh(report.cashExpenses)}
                    </p>
                  )}
                  <label className="flex items-center justify-between gap-3">
                    <span className="text-xs text-app-text-muted">Cash counted (optional)</span>
                    <input
                      inputMode="decimal"
                      value={counted}
                      onChange={(e) => setCounted(e.target.value.replace(/[^\d.]/g, ''))}
                      placeholder="0"
                      aria-invalid={!countedValid}
                      className="w-32 text-right bg-app-card text-app-text text-sm px-3 py-2 rounded-lg focus:outline-none tabular-nums"
                    />
                  </label>
                  {diff !== null && (
                    <p className={`text-xs font-medium ${diff === 0 ? 'text-emerald-600' : diff < 0 ? 'text-red-500' : 'text-amber-600'}`}>
                      {diff === 0 ? 'Matches what is expected.' : diff < 0 ? `Short by ${ksh(-diff)}.` : `Over by ${ksh(diff)}.`}
                    </p>
                  )}
                </div>

                {report.products.length > 0 && (
                  <Section title="Products sold">
                    {report.products.map((p) => (
                      <Row key={p.name} left={p.name} sub={`${p.sold}${p.unit ? ` ${p.unit}` : ''} sold${p.left !== null ? ` · ${Math.round(p.left * 100) / 100} left` : ''}`} right={ksh(p.earned)} />
                    ))}
                  </Section>
                )}

                {report.production.length > 0 && (
                  <Section title="Production">
                    {report.production.map((b, i) => (
                      <Row key={i} left={b.name} sub={b.used ? `Used ${b.used}` : undefined} right={`${b.produced}${b.unit ? ` ${b.unit}` : ''}`} />
                    ))}
                  </Section>
                )}

                {report.creditTaken.length > 0 && (
                  <Section title="Credit given">
                    {report.creditTaken.map((c) => (
                      <Row key={c.name} left={c.name} sub={`${c.items} · owes ${ksh(c.owesNow)}`} right={ksh(c.amount)} />
                    ))}
                  </Section>
                )}

                {report.debtRepaid.length > 0 && (
                  <Section title="Debt repaid">
                    {report.debtRepaid.map((d, i) => (
                      <Row key={i} left={d.name} sub={`${d.method} · still owes ${ksh(d.owesNow)}`} right={ksh(d.amount)} />
                    ))}
                  </Section>
                )}

                {report.expenses.length > 0 && (
                  <Section title="Expenses">
                    {report.expenses.map((e, i) => (
                      <Row key={i} left={e.category} sub={[e.method, e.note].filter(Boolean).join(' · ')} right={ksh(e.amount)} />
                    ))}
                  </Section>
                )}

                <label className="block space-y-1.5">
                  <span className="text-xs font-medium text-app-text-muted">Notes for the owner (optional)</span>
                  <textarea
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="E.g. left KSh 500 float in the drawer"
                    className="w-full bg-app-bg text-app-text text-sm p-3 rounded-xl focus:outline-none min-h-[72px] resize-none"
                  />
                </label>

                {error && (
                  <p role="alert" className="text-xs font-medium text-red-500 bg-red-500/10 rounded-lg px-3 py-2">{error}</p>
                )}
              </>
            )}
          </div>

          {/* Footer */}
          <div className="px-5 pt-3 pb-[calc(1rem+var(--inset-bottom))] sm:pb-4 border-t border-app-border flex gap-2">
            <button
              onClick={copy}
              disabled={!report}
              className="flex items-center justify-center gap-1.5 px-4 py-3 rounded-xl bg-app-bg text-app-text text-sm font-medium disabled:opacity-40"
            >
              {copied ? <Check size={16} /> : <Copy size={16} />}
              {copied ? 'Copied' : 'Copy'}
            </button>
            <button
              onClick={endShift}
              disabled={!report || saving || !countedValid}
              className="flex-1 flex items-center justify-center gap-2 py-3 px-4 rounded-xl bg-amber-500 hover:bg-amber-600 text-slate-950 text-sm font-semibold disabled:opacity-60"
            >
              {saving ? <Loader2 size={16} className="animate-spin" /> : <LogOut size={16} />}
              {saving ? 'Ending shift…' : 'End shift and send report'}
            </button>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}

function Tile({ label, value, hint, strong }: { label: string; value: string; hint?: string; strong?: boolean }) {
  return (
    <div className={`rounded-xl p-3 ${strong ? 'bg-amber-500/10' : 'bg-app-bg'}`}>
      <div className="text-[11px] text-app-text-muted">{label}</div>
      <div className={`tabular-nums text-app-text ${strong ? 'text-lg font-semibold' : 'text-sm font-semibold'}`}>{value}</div>
      {hint && <div className="text-[11px] text-app-text-muted">{hint}</div>}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="text-xs font-medium text-app-text-muted mb-1">{title}</h3>
      <div className="divide-y divide-app-border">{children}</div>
    </div>
  );
}

function Row({ left, sub, right }: { left: string; sub?: string; right: string }) {
  return (
    <div className="flex items-start justify-between gap-3 py-2">
      <div className="min-w-0">
        <div className="text-sm text-app-text truncate">{left}</div>
        {sub && <div className="text-[11px] text-app-text-muted break-words">{sub}</div>}
      </div>
      <div className="text-sm font-medium text-app-text tabular-nums shrink-0">{right}</div>
    </div>
  );
}
