import React, { useEffect, useMemo, useState } from 'react';
import { NumberInput } from './shared/Input';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Copy, Check, LogOut, Loader2, AlertTriangle, ChevronDown } from 'lucide-react';
import { useInventoryStore } from '../stores/inventoryStore';
import { useTransactionStore } from '../stores/transactionStore';
import { useCustomerStore } from '../stores/customerStore';
import { useAuthStore } from '../stores/authStore';
import { useNotificationStore } from '../stores/notificationStore';
import { useExtraModulesStore } from '../stores/extraModulesStore';
import { useOverlay } from '../hooks/useOverlay';
import SheetLayer from './shared/SheetLayer';
import type { Expense } from '../types';
import { useBusinessStore } from '../stores/businessStore';
import { getSupabase } from '../services/supabaseClient';
import { toUuid } from '../utils/idUtils';
import { loadTillRefunds, type TillRefund } from '../services/salesDocs';
import { buildShiftReport, finishShift, ksh, methodLabel, shiftAttention, shiftClock, shiftLength, shiftReportText } from '../services/shiftReport';

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
  const [refunds, setRefunds] = useState<TillRefund[]>([]);
  const [now, setNow] = useState(() => Date.now());

  // Expenses aren't kept in a store, so they're loaded when the report opens.
  useEffect(() => {
    if (!isOpen) return;
    setError(null);
    setNow(Date.now());
    // Only money this person took from the till counts against their cash: their petty cash
    // entries, plus expenses they recorded themselves (cashiers can't read other expenses).
    const businessId = useBusinessStore.getState().activeBusinessId;
    const from = activeShift?.startTime || new Date(Date.now() - 864e5).toISOString();
    if (businessId) loadTillRefunds(businessId, from).then(setRefunds).catch(() => setRefunds([]));
    const name = currentEmployee?.name;
    const petty: Promise<Expense[]> = businessId
      ? Promise.resolve(getSupabase()
          .rpc('list_petty_cash', { p_business_id: toUuid(businessId), p_start: from, p_end: new Date(Date.now() + 60_000).toISOString() })
          .then(({ data, error }) => {
            if (error) throw error;
            return (data || [])
              .filter((r: any) => r.mine && !r.removed)
              .map((r: any): Expense => ({
                id: r.id,
                amount: Number(r.amount) || 0,
                category: `Petty cash: ${r.category}`,
                description: r.description || '',
                date: r.date,
                created_at: r.date,
                staffName: r.staff_name || '',
                paymentMethod: 'Cash',
              }));
          }))
          .catch((err: unknown) => {
            console.error('Could not load petty cash for the shift report:', err);
            return [] as Expense[];
          })
      : Promise.resolve([] as Expense[]);
    const own = import('../services/repositories')
      .then(({ ExpenseRepository }) => ExpenseRepository.getAll())
      .then((all) => all.filter((e) => e.staffName === name))
      .catch(() => [] as Expense[]);
    Promise.all([petty, own]).then(([p, o]) => {
      const ids = new Set(p.map((e) => e.id));
      setExpenses([...p, ...o.filter((e) => !ids.has(e.id))]);
    });
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
      refunds,
      now,
    });
  }, [activeShift, currentEmployee, transactions, debtPayments, expenses, products, customers, productionBatches, billOfMaterials, refunds, now]);

  const countedCash = counted.trim() === '' ? null : Number(counted);
  const countedValid = countedCash === null || (Number.isFinite(countedCash) && countedCash >= 0);
  const diff = report && countedCash !== null && countedValid ? Math.round(countedCash - report.expectedCash) : null;
  const attention = report ? shiftAttention(report, countedValid ? countedCash : null) : [];
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
    <SheetLayer>
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
          className="relative w-full sm:max-w-lg bg-app-card rounded-t-2xl sm:rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[calc(100dvh-var(--inset-top)-0.5rem)] sm:max-h-[92dvh]"
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

          <div className="px-5 pb-4 overflow-y-auto overscroll-contain flex-1 min-h-0 space-y-4">
            {!report ? (
              <p className="text-sm text-app-text-muted py-6 text-center">You don't have an open shift.</p>
            ) : (
              <>
                {/* 1. Summary */}
                <div className="grid grid-cols-2 gap-2">
                  <Tile label="Sales" value={ksh(report.salesTotal)} hint={`${report.salesCount} ${report.salesCount === 1 ? 'sale' : 'sales'}${report.deliveries ? ` · ${report.deliveries} ${report.deliveries === 1 ? 'delivery' : 'deliveries'}` : ''}`} strong />
                  <Tile label="Money taken in" value={ksh(report.moneyInTotal)} hint={report.debtRepaidTotal ? `incl. ${ksh(report.debtRepaidTotal)} debt repaid` : 'sales not on credit'} />
                  <Tile label="Given on credit" value={ksh(report.credit)} hint={report.creditTaken.length ? `${report.creditTaken.length} ${report.creditTaken.length === 1 ? 'customer' : 'customers'}` : undefined} />
                  <Tile label="Expenses" value={ksh(report.expensesTotal)} hint={report.expenses.length ? `${report.expenses.length} ${report.expenses.length === 1 ? 'entry' : 'entries'}` : undefined} />
                </div>

                {/* Per product */}
                {report.products.length > 0 && (
                  <div className="space-y-2">
                    <h3 className="text-xs font-medium text-app-text-muted">Summary by product</h3>
                    {report.products.map((p) => (
                      <div key={p.name} className="rounded-xl bg-app-bg p-3 space-y-1">
                        <div className="flex items-baseline justify-between gap-3">
                          <span className="text-sm font-semibold text-app-text break-words">{p.name}</span>
                          <span className="text-sm font-semibold text-app-text tabular-nums shrink-0">{ksh(p.earned)}</span>
                        </div>
                        <Line label={`${p.salesCount} ${p.salesCount === 1 ? 'sale' : 'sales'} · ${Math.round(p.sold * 100) / 100}${p.unit ? ` ${p.unit}` : ''}`} value={`Taken in ${ksh(p.moneyIn)}`} />
                        <Line
                          label={[p.cash ? `Cash ${ksh(p.cash)}` : '', p.till ? `Till ${ksh(p.till)}` : '', p.otherPaid ? `Other ${ksh(p.otherPaid)}` : '', p.credit ? `Credit ${ksh(p.credit)}` : ''].filter(Boolean).join(' · ') || '—'}
                          value={p.left !== null ? `${Math.round(p.left * 100) / 100}${p.unit ? ` ${p.unit}` : ''} left` : ''}
                        />
                      </div>
                    ))}
                  </div>
                )}

                {/* Amount made today */}
                <div className="rounded-xl bg-app-bg p-3.5 space-y-2">
                  <h3 className="text-xs font-medium text-app-text-muted">Amount made today</h3>
                  {report.moneyIn.map((m) => (
                    <Line key={m.method} label={`${methodLabel(m.method)}${m.debt ? ` (incl. ${ksh(m.debt)} debt)` : ''}`} value={ksh(m.total)} />
                  ))}
                  <div className="flex items-baseline justify-between gap-3 pt-2 border-t border-app-border">
                    <span className="text-sm font-medium text-app-text">Total</span>
                    <span className="text-sm font-semibold text-app-text tabular-nums">{ksh(report.moneyInTotal)}</span>
                  </div>
                </div>

                {/* 2. Needs attention */}
                {attention.length > 0 && (
                  <div className="rounded-xl bg-amber-500/10 p-3.5">
                    <div className="flex items-center gap-1.5 text-xs font-semibold text-amber-700 dark:text-amber-400 mb-1.5">
                      <AlertTriangle size={14} /> Needs attention
                    </div>
                    <ul className="space-y-1">
                      {attention.map((a) => (
                        <li key={a} className="text-xs text-app-text">• {a}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* 3. Cash drawer */}
                <div className="rounded-xl bg-app-bg p-3.5 space-y-2">
                  <h3 className="text-xs font-medium text-app-text-muted">Cash drawer</h3>
                  <Line label="Cash sales" value={ksh(report.cash)} />
                  {report.cashDebtRepaid > 0 && <Line label="+ Debt repaid in cash" value={ksh(report.cashDebtRepaid)} />}
                  {report.cashExpenses > 0 && <Line label="− Cash spent" value={ksh(report.cashExpenses)} />}
                  {report.cashRefunds > 0 && <Line label="− Cash given back" value={ksh(report.cashRefunds)} />}
                  <div className="flex items-baseline justify-between gap-3 pt-2 border-t border-app-border">
                    <span className="text-sm font-medium text-app-text">Cash to hand over</span>
                    <span className="text-sm font-semibold text-app-text tabular-nums">{ksh(report.expectedCash)}</span>
                  </div>
                  <label className="flex items-center justify-between gap-3">
                    <span className="text-xs text-app-text-muted">Cash counted</span>
                    <NumberInput
                      value={counted}
                      onChange={(n) => setCounted(n == null ? '' : String(n))}
                      min={0}
                      placeholder="Count the drawer"
                      invalid={!countedValid}
                      className="w-36 bg-app-card"
                      inputClassName="text-right tabular-nums"
                    />
                  </label>
                  {diff !== null && (
                    <p className={`text-xs font-medium ${diff === 0 ? 'text-emerald-600' : diff < 0 ? 'text-red-500' : 'text-amber-600'}`}>
                      {diff === 0 ? 'Matches what is expected.' : diff < 0 ? `Short by ${ksh(-diff)}.` : `Over by ${ksh(diff)}.`}
                    </p>
                  )}
                </div>

                {report.creditTaken.length > 0 && (
                  <Section title="Credit given" count={report.creditTaken.length} total={ksh(report.credit)}>
                    {report.creditTaken.map((c) => (
                      <Row key={c.name} left={c.name} sub={`${c.items} · now owes ${ksh(c.owesNow)}`} right={ksh(c.amount)} />
                    ))}
                  </Section>
                )}

                {report.debtRepaid.length > 0 && (
                  <Section title="Debt repaid" count={report.debtRepaid.length} total={ksh(report.debtRepaidTotal)}>
                    {report.debtRepaid.map((d, i) => (
                      <Row key={i} left={d.name} sub={`${d.method} · still owes ${ksh(d.owesNow)}`} right={ksh(d.amount)} />
                    ))}
                  </Section>
                )}

                {report.expenses.length > 0 && (
                  <Section title="Expenses" count={report.expenses.length} total={ksh(report.expensesTotal)}>
                    {report.expenses.map((e, i) => (
                      <Row key={i} left={e.category} sub={[e.method, e.note].filter(Boolean).join(' · ')} right={ksh(e.amount)} />
                    ))}
                  </Section>
                )}

                {report.production.length > 0 && (
                  <Section title="Production" count={report.production.length}>
                    {report.production.map((b, i) => (
                      <Row key={i} left={b.name} sub={b.used ? `Used ${b.used}` : undefined} right={`${b.produced}${b.unit ? ` ${b.unit}` : ''}`} />
                    ))}
                  </Section>
                )}

                {/* Closing balances */}
                <div className="rounded-xl bg-app-bg p-3.5 space-y-2">
                  <h3 className="text-xs font-medium text-app-text-muted">Closing balances</h3>
                  <Line label={`Cash in drawer${countedCash === null || !countedValid ? ' (expected)' : ''}`} value={ksh(countedCash !== null && countedValid ? countedCash : report.expectedCash)} />
                  {report.moneyIn.filter((m) => m.method === 'M-Pesa').map((m) => <Line key="till" label="Till (M-Pesa) received" value={ksh(m.total)} />)}
                  {report.products.filter((p) => p.left !== null).map((p) => (
                    <Line key={p.name} label={p.name} value={`${Math.round((p.left as number) * 100) / 100}${p.unit ? ` ${p.unit}` : ''} left`} />
                  ))}
                </div>

                {report.timeline.length > 0 ? (
                  <Section title="Timeline" count={report.timeline.length}>
                    {report.timeline.map((t, i) => (
                      <Row key={i} left={t.text} sub={shiftClock(t.at)} right={t.amount !== undefined ? `${t.kind === 'expense' ? '−' : ''}${ksh(t.amount)}` : ''} />
                    ))}
                  </Section>
                ) : (
                  <p className="text-xs text-app-text-muted text-center py-2">No sales, payments or expenses were recorded this shift.</p>
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
              <span className="whitespace-nowrap">{saving ? 'Ending…' : 'End & send report'}</span>
            </button>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
    </SheetLayer>
  );
}

function Tile({ label, value, hint, strong }: { label: string; value: string; hint?: string; strong?: boolean }) {
  return (
    <div className={`rounded-xl p-3 min-w-0 ${strong ? 'bg-amber-500/10' : 'bg-app-bg'}`}>
      <div className="text-[11px] text-app-text-muted">{label}</div>
      <div className={`tabular-nums text-app-text break-words ${strong ? 'text-lg font-semibold' : 'text-sm font-semibold'}`}>{value}</div>
      {hint && <div className="text-[11px] text-app-text-muted">{hint}</div>}
    </div>
  );
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-xs text-app-text-muted">
      <span>{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}

/** A titled list that folds away; the heading shows how many and the total so it reads even when closed. */
function Section({ title, count, total, open: startOpen = false, children }: { title: string; count?: number; total?: string; open?: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(startOpen);
  return (
    <div className="rounded-xl border border-app-border">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="w-full flex items-center justify-between gap-3 px-3.5 py-2.5 text-left"
      >
        <span className="text-xs font-medium text-app-text">
          {title}
          {count !== undefined && <span className="text-app-text-muted"> · {count}</span>}
        </span>
        <span className="flex items-center gap-2 shrink-0">
          {total && <span className="text-xs font-semibold text-app-text tabular-nums">{total}</span>}
          <ChevronDown size={14} className={`text-app-text-muted transition-transform ${open ? 'rotate-180' : ''}`} />
        </span>
      </button>
      {open && <div className="px-3.5 pb-1 divide-y divide-app-border border-t border-app-border">{children}</div>}
    </div>
  );
}

function Row({ left, sub, right }: { left: string; sub?: string; right: string }) {
  return (
    <div className="flex items-start justify-between gap-3 py-2">
      <div className="min-w-0">
        <div className="text-sm text-app-text break-words">{left}</div>
        {sub && <div className="text-[11px] text-app-text-muted break-words">{sub}</div>}
      </div>
      <div className="text-sm font-medium text-app-text tabular-nums shrink-0">{right}</div>
    </div>
  );
}
