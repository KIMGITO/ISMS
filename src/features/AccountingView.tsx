// Finance & Accounting: one screen for the money side. "Summary" is the plain view (profit,
// money in and out, debts, wallets, points; FinanceView, finance.view). The other parts are
// the business's books (accounting.view).
// The books: Every sale, expense, petty cash entry, customer payment,
// purchase, supplier payment and stock loss posts itself as a double-entry journal entry
// (see services/accounting.ts and 20261116003_accounting.sql). Owners and admins can add
// entries by hand, count money, pay suppliers, lock past months and rebuild the books;
// managers can read everything.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, BookOpen, CheckCircle2, ChevronDown, ChevronRight, Lock, Plus, RotateCcw, Scale, Search, Trash2, Undo2, Wallet,
} from 'lucide-react';
import { useBusinessStore } from '../stores/businessStore';
import { useNotificationStore } from '../stores/notificationStore';
import { toUserMessage } from '../utils/userError';
import { GroupedTabs, type TabGroup } from '../components/TabOptions';
import FinanceView from './FinanceView';
import AreaAdvisor from '../components/assistant/AreaAdvisor';
import SearchableDropdown from '../components/SearchableDropdown';
import { Checkbox } from '../components/shared/Checkbox';
import { useAuthStore } from '../stores/authStore';
import { useUiStore } from '../stores/uiStore';
import { hasRolePermission } from '../utils/permissions';
import { FormSheet, Field, fieldClass, primaryBtn, secondaryBtn, dangerBtn } from '../components/shared/FormSheet';
import { appDialog } from '../components/AppDialog';
import { formatKsh, getRange, kenyaNow, RANGE_LABELS, toDateInput, type RangeKey } from './home/metrics';
import {
  balanceSheet, checkDraft, deleteAccount, deleteEntry, isMoneyKey, kenyaToday, loadChecks, loadErrors, loadJournal, loadLedger,
  loadPayables, loadReceivables, loadReport, loadVat, matchStock, profitAndLoss, QUICK_ENTRIES, quickLines, rebuildBooks,
  reconcileMoney, recordSupplierPayment, retryErrors, reverseEntry, saveAccount, saveEntry, setLockDate, SOURCE_LABELS,
  trialBalance, TYPE_LABELS, voidSupplierPayment,
  type AccountBalance, type AccountingReport, type AccountType, type DraftLine, type JournalEntry, type LedgerLine,
  type Payable, type QuickTemplate, type Receivable, type SourceType, type StatementRow, type SupplierPayment, type VatMonth,
  type MoneyCheck, type CheckHistory,
} from '../services/accounting';
import { recordBillPayment } from '../services/buying';
import { NumberInput } from '../components/shared/Input';

type Tab = 'summary' | 'overview' | 'pnl' | 'balance' | 'trial' | 'journal' | 'accounts' | 'receivables' | 'payables' | 'checks' | 'vat' | 'settings';

const RANGES: RangeKey[] = ['today', 'yesterday', 'last7', 'month', 'last30', 'quarter', 'year', 'custom'];
const TYPES: AccountType[] = ['asset', 'liability', 'equity', 'income', 'expense'];
const METHODS = ['Cash', 'M-Pesa', 'Airtel Money', 'Bank', 'Card'];

const money = (v: number) => formatKsh(v);
/** Whole shillings and cents, for statements where small differences matter. */
const exact = (v: number) => {
  const s = Math.abs(v).toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${v < 0 ? '−' : ''}${s}`;
};
const day = (d: string | null) =>
  d ? new Date(`${d.slice(0, 10)}T12:00:00+03:00`).toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Africa/Nairobi' }) : '';
const when = (iso: string) =>
  new Date(iso).toLocaleString('en-KE', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Africa/Nairobi' });
const monthName = (m: string) => new Date(`${m}-15T12:00:00+03:00`).toLocaleDateString('en-KE', { month: 'long', year: 'numeric' });

function Card({ title, subtitle, action, children }: { title: string; subtitle?: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="bg-app-card rounded-2xl p-4 shadow-xs min-w-0">
      <div className="flex items-start gap-2 flex-wrap">
        <div className="min-w-0 flex-1 basis-56">
          <h2 className="text-sm font-semibold text-app-text">{title}</h2>
          {subtitle && <p className="text-xs text-app-text-muted mt-0.5">{subtitle}</p>}
        </div>
        {action}
      </div>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function Tile({ label, value, note, tone, onClick }: { label: string; value: string; note?: string; tone?: 'bad' | 'good'; onClick?: () => void }) {
  const Comp: any = onClick ? 'button' : 'div';
  return (
    <Comp onClick={onClick} className={`bg-app-card rounded-2xl p-3.5 shadow-xs min-w-0 text-left ${onClick ? 'cursor-pointer hover:ring-1 hover:ring-amber-500/40' : ''}`}>
      <div className="text-xs text-app-text-muted">{label}</div>
      <div className={`text-lg font-bold tabular-nums mt-0.5 break-words ${tone === 'bad' ? 'text-red-600 dark:text-red-400' : tone === 'good' ? 'text-emerald-600 dark:text-emerald-400' : 'text-app-text'}`}>{value}</div>
      {note && <div className="text-[11px] text-app-text-muted mt-0.5">{note}</div>}
    </Comp>
  );
}

function Row({ label, value, strong, code, onClick, sub }: { label: string; value: number; strong?: boolean; code?: string; onClick?: () => void; sub?: boolean }) {
  return (
    <div
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => { if (e.key === 'Enter') onClick(); } : undefined}
      className={`flex items-baseline justify-between gap-3 py-1.5 ${strong ? 'border-t border-app-border mt-1 pt-2.5' : ''} ${onClick ? 'cursor-pointer hover:bg-app-bg rounded-lg -mx-2 px-2' : ''} ${sub ? 'pl-3' : ''}`}
    >
      <span className={`min-w-0 text-[13px] ${strong ? 'font-semibold' : ''} text-app-text`}>
        {code && <span className="text-app-text-muted tabular-nums mr-2 text-xs">{code}</span>}
        {label}
      </span>
      <span className={`shrink-0 tabular-nums text-[13px] ${strong ? 'font-bold' : 'font-medium'} ${value < 0 ? 'text-red-600 dark:text-red-400' : 'text-app-text'}`}>{exact(value)}</span>
    </div>
  );
}

function Statement({ rows, onOpen }: { rows: StatementRow[]; onOpen: (id: string) => void }) {
  if (!rows.length) return <p className="text-xs text-app-text-muted py-1">Nothing here for this period.</p>;
  return <>{rows.map((r) => <Row key={r.id} code={r.code} label={r.name} value={r.amount} sub onClick={() => onOpen(r.id)} />)}</>;
}

function Note({ tone = 'warn', children }: { tone?: 'warn' | 'ok' | 'info'; children: React.ReactNode }) {
  const style = tone === 'ok'
    ? 'bg-emerald-500/10 text-emerald-800 dark:text-emerald-200'
    : tone === 'info' ? 'bg-sky-500/10 text-sky-900 dark:text-sky-100' : 'bg-amber-500/10 text-amber-900 dark:text-amber-100';
  const Icon = tone === 'ok' ? CheckCircle2 : AlertTriangle;
  return (
    <div className={`rounded-xl px-3 py-2.5 text-xs flex gap-2 items-start ${style}`}>
      <Icon size={15} className="shrink-0 mt-px" />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

/** An account picker, grouped by kind. */
function AccountSelect({ accounts, value, onChange, filter, placeholder = 'Choose an account' }: {
  accounts: AccountBalance[]; value: string; onChange: (id: string) => void; filter?: (a: AccountBalance) => boolean; placeholder?: string;
}) {
  const list = accounts.filter((a) => a.active && (!filter || filter(a)));
  return (
    <SearchableDropdown
      items={TYPES.flatMap((t) => list.filter((a) => a.type === t).map((a) => ({ id: a.id, label: `${a.code} · ${a.name}`, sublabel: TYPE_LABELS[t] })))}
      selectedValue={value}
      onChange={onChange}
      placeholder={placeholder}
      searchPlaceholder="Search accounts by name or code"
    />
  );
}

export default function AccountingView() {
  const businessId = useBusinessStore((s) => s.activeBusinessId);
  const showToast = useNotificationStore((s) => s.showToast);
  const role = useAuthStore((s) => s.currentEmployee?.role) || 'Guest';
  const seesSummary = hasRolePermission(role, 'finance.view' as any);
  const seesBooks = hasRolePermission(role, 'accounting.view' as any);

  const [tab, setTab] = useState<Tab>(seesSummary ? 'summary' : 'overview');
  // Opened as "accounting" (old screen id, search): start on the books.
  const section = useUiStore((s) => s.screenSection);
  useEffect(() => {
    if (section !== 'books') return;
    useUiStore.getState().setScreenSection(null);
    if (seesBooks) setTab('overview');
  }, [section, seesBooks]);
  const [rangeKey, setRangeKey] = useState<RangeKey>('month');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  const range = useMemo(() => getRange(rangeKey, kenyaNow(), customStart, customEnd), [rangeKey, customStart, customEnd]);
  const start = toDateInput(range.start);
  const end = toDateInput(range.end);

  const [report, setReport] = useState<AccountingReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Sheets
  const [ledgerFor, setLedgerFor] = useState<string | null>(null);
  const [entryOpen, setEntryOpen] = useState<JournalEntry | null>(null);
  const [newEntry, setNewEntry] = useState<{ template: QuickTemplate | null; editing?: JournalEntry } | null>(null);
  const [accountForm, setAccountForm] = useState<Partial<AccountBalance> | null>(null);
  const [paying, setPaying] = useState<{ supplier: Payable; purchaseId: string | null; amount: number; billId?: string | null } | null>(null);
  const [counting, setCounting] = useState<MoneyCheck | null>(null);

  const load = useCallback(async () => {
    if (!businessId || !seesBooks) { setLoading(false); return; }
    setLoading(true);
    setError(null);
    try {
      setReport(await loadReport(businessId, start, end));
    } catch (err) {
      setError(toUserMessage(err, 'Could not load the books. Check your connection.'));
    } finally {
      setLoading(false);
    }
  }, [businessId, start, end, seesBooks]);

  useEffect(() => { void load(); }, [load]);

  const accounts = report?.accounts ?? [];
  const canManage = !!report?.canManage;
  const pnl = useMemo(() => profitAndLoss(accounts), [accounts]);
  const bs = useMemo(() => balanceSheet(accounts), [accounts]);
  const tb = useMemo(() => trialBalance(accounts), [accounts]);
  const byKey = (k: string) => accounts.find((a) => a.key === k);
  const closingOf = (k: string) => { const a = byKey(k); return a ? (a.type === 'asset' ? a.closing : -a.closing) : 0; };
  const moneyTotal = accounts.filter((a) => isMoneyKey(a.key)).reduce((s, a) => s + a.closing, 0);

  /** After anything is written: reload the figures and whatever tab is open. */
  const [version, setVersion] = useState(0);
  const changed = () => { setVersion((v) => v + 1); void load(); };

  const groups: TabGroup<Tab>[] = [
    { id: 'summary', label: 'Summary', tabs: seesSummary ? [{ id: 'summary', label: 'Summary', shortcut: 'fin-summary' }] : [] },
    { id: 'books', label: 'Books', tabs: seesBooks ? [
      { id: 'overview', label: 'Overview', shortcut: 'acc-overview' },
      { id: 'pnl', label: 'Profit & loss', shortcut: 'acc-pnl' },
      { id: 'balance', label: 'Balance sheet', shortcut: 'acc-balance' },
      { id: 'trial', label: 'Trial balance', shortcut: 'acc-trial' },
      { id: 'journal', label: 'Journal', shortcut: 'acc-journal' },
      { id: 'accounts', label: 'Accounts', shortcut: 'acc-accounts' },
    ] : [] },
    { id: 'owed', label: 'Who owes', tabs: seesBooks ? [
      { id: 'receivables', label: 'Customers owe us', shortcut: 'acc-receivables' },
      { id: 'payables', label: 'We owe suppliers', shortcut: 'acc-payables' },
    ] : [] },
    { id: 'checks', label: 'Checks', tabs: seesBooks ? [
      { id: 'checks', label: 'Count money & stock', shortcut: 'acc-checks' },
      { id: 'vat', label: 'VAT', shortcut: 'acc-vat' },
      ...(canManage ? [{ id: 'settings' as const, label: 'Lock & rebuild', badge: report?.errors || 0, shortcut: 'acc-settings' }] : []),
    ] : [] },
  ];
  const [summaryReload, setSummaryReload] = useState(0);

  const periodWord = rangeKey === 'custom' ? `${day(start)} – ${day(end)}` : RANGE_LABELS[rangeKey].toLowerCase();

  return (
    <div className="h-full overflow-y-auto overflow-x-hidden bg-app-bg pb-nav">
      <div className="max-w-6xl mx-auto px-3 pt-3 sm:px-5 sm:pt-5 space-y-4 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <GroupedTabs<Tab> groups={groups} activeTab={tab} onChange={setTab} className="w-full" />
        </div>
        {(seesBooks || seesSummary) && <AreaAdvisor area="finance" />}

        {tab !== 'accounts' && tab !== 'receivables' && tab !== 'payables' && tab !== 'checks' && tab !== 'settings' && (
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex gap-1.5 overflow-x-auto scrollbar-none min-w-0 max-w-full">
              {RANGES.map((k) => (
                <button
                  key={k}
                  onClick={() => setRangeKey(k)}
                  aria-pressed={rangeKey === k}
                  className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-medium cursor-pointer ${rangeKey === k ? 'bg-amber-500 text-slate-950' : 'bg-app-card text-app-text border border-app-border'}`}
                >
                  {RANGE_LABELS[k]}
                </button>
              ))}
            </div>
            {rangeKey === 'custom' && (
              <div className="flex flex-wrap items-center gap-1.5 text-xs text-app-text">
                <input type="date" value={customStart} onChange={(e) => setCustomStart(e.target.value)} className="bg-app-card border border-app-border rounded-lg px-2 py-1" />
                to
                <input type="date" value={customEnd} onChange={(e) => setCustomEnd(e.target.value)} className="bg-app-card border border-app-border rounded-lg px-2 py-1" />
              </div>
            )}
            <button onClick={() => { if (tab === 'summary') setSummaryReload((n) => n + 1); else changed(); }} className="ml-auto p-2 rounded-lg text-app-text-muted hover:bg-app-card cursor-pointer" title="Refresh" aria-label="Refresh">
              <RotateCcw size={16} className={loading ? 'animate-spin' : ''} />
            </button>
          </div>
        )}

        {tab !== 'summary' && error && (
          <div className="bg-app-card rounded-2xl p-4 text-sm text-red-600 dark:text-red-400 flex items-center justify-between gap-3">
            {error}
            <button onClick={() => void load()} className="text-app-text underline cursor-pointer">Try again</button>
          </div>
        )}
        {tab === 'summary' && seesSummary && (
          <FinanceView embedded period={{ rangeKey, customStart, customEnd }} reloadKey={summaryReload} />
        )}
        {tab !== 'summary' && !report && loading && <p className="text-sm text-app-text-muted text-center py-10">Opening the books…</p>}

        {report && tab === 'overview' && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
              <Tile label={`${pnl.netProfit < 0 ? 'Loss' : 'Profit'} · ${periodWord}`} value={money(pnl.netProfit)} tone={pnl.netProfit < 0 ? 'bad' : 'good'} onClick={() => setTab('pnl')} note={`Sales ${money(pnl.totalIncome)}`} />
              <Tile label="Money in all accounts" value={money(moneyTotal)} note="Cash, M-Pesa, Airtel, bank, card" onClick={() => setTab('checks')} />
              <Tile label="Customers owe us" value={money(closingOf('receivable'))} onClick={() => setTab('receivables')} />
              <Tile label="We owe suppliers" value={money(closingOf('payable'))} onClick={() => setTab('payables')} tone={closingOf('payable') > 0 ? 'bad' : undefined} />
              <Tile label="Stock value (books)" value={money(closingOf('inventory'))} onClick={() => setTab('checks')} />
              <Tile label="VAT to pay KRA" value={money(closingOf('vat'))} onClick={() => setTab('vat')} />
            </div>

            <div className="space-y-2">
              {report.errors > 0 && (
                <Note>
                  {report.errors} record{report.errors === 1 ? '' : 's'} could not be posted to the books.{' '}
                  {canManage ? <button className="underline font-semibold cursor-pointer" onClick={() => setTab('settings')}>See and retry</button> : 'Ask the owner to look at Lock & rebuild.'}
                </Note>
              )}
              {bs.difference !== 0 ? (
                <Note>Off by {exact(bs.difference)}. Use Lock & rebuild.</Note>
              ) : (
                <Note tone="ok">The books balance.</Note>
              )}
              {closingOf('inventory') < 0 && (
                <Note>
                  Stock in the books is below zero.{' '}
                  <button className="underline font-semibold cursor-pointer" onClick={() => setTab('checks')}>Match it to stock on hand</button>
                </Note>
              )}
              {report.lockDate && <Note tone="info">Books locked up to {day(report.lockDate)}.</Note>}
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <Card title="Profit & loss" subtitle={periodWord}>
                <Row label="Income" value={pnl.totalIncome} />
                <Row label="Cost of sales" value={-pnl.totalCostOfSales} />
                <Row label="Gross profit" value={pnl.grossProfit} strong />
                <Row label="Expenses" value={-pnl.totalExpenses} />
                <Row label={pnl.netProfit < 0 ? 'Net loss' : 'Net profit'} value={pnl.netProfit} strong />
              </Card>
              {canManage && (
                <Card title="Record something" subtitle="Things the app can't see by itself">
                  <div className="grid gap-2 sm:grid-cols-2">
                    {QUICK_ENTRIES.slice(0, 6).map((t) => (
                      <button key={t.id} onClick={() => setNewEntry({ template: t })} className="text-left rounded-xl bg-app-bg px-3 py-2.5 hover:ring-1 hover:ring-amber-500/40 cursor-pointer">
                        <div className="text-[13px] font-medium text-app-text">{t.title}</div>
                        <div className="text-[11px] text-app-text-muted">{t.hint}</div>
                      </button>
                    ))}
                  </div>
                  <button data-shortcut="new" onClick={() => setNewEntry({ template: null })} className={`${secondaryBtn} mt-3 w-full`}>
                    <Plus size={15} /> More kinds of entry
                  </button>
                </Card>
              )}
            </div>
          </div>
        )}

        {report && tab === 'pnl' && (
          <Card title={`Profit & loss · ${periodWord}`} subtitle={`${day(start)} to ${day(end)}. Tap a line to see what is in it.`}>
            <h3 className="text-xs font-semibold text-app-text-muted mt-1">Income</h3>
            <Statement rows={pnl.income} onOpen={setLedgerFor} />
            <Row label="Total income" value={pnl.totalIncome} strong />
            <h3 className="text-xs font-semibold text-app-text-muted mt-4">Cost of sales</h3>
            <Statement rows={pnl.costOfSales} onOpen={setLedgerFor} />
            <Row label="Gross profit" value={pnl.grossProfit} strong />
            <h3 className="text-xs font-semibold text-app-text-muted mt-4">Expenses</h3>
            <Statement rows={pnl.expenses} onOpen={setLedgerFor} />
            <Row label="Total expenses" value={pnl.totalExpenses} strong />
            <div className="mt-3 rounded-xl bg-app-bg px-3">
              <Row label={pnl.netProfit < 0 ? 'Net loss' : 'Net profit'} value={pnl.netProfit} strong />
            </div>
            <p className="text-[11px] text-app-text-muted mt-3">
              Sales after discounts, without VAT.
            </p>
          </Card>
        )}

        {report && tab === 'balance' && (
          <Card title={`Balance sheet · ${day(end)}`} subtitle="What the business owns and owes.">
            <div className="grid gap-6 lg:grid-cols-2">
              <div>
                <h3 className="text-xs font-semibold text-app-text-muted">What we own</h3>
                <Statement rows={bs.assets} onOpen={setLedgerFor} />
                <Row label="Total assets" value={bs.totalAssets} strong />
              </div>
              <div>
                <h3 className="text-xs font-semibold text-app-text-muted">What we owe</h3>
                <Statement rows={bs.liabilities} onOpen={setLedgerFor} />
                <Row label="Total liabilities" value={bs.totalLiabilities} strong />
                <h3 className="text-xs font-semibold text-app-text-muted mt-4">Owner's share</h3>
                <Statement rows={bs.equity} onOpen={setLedgerFor} />
                <Row label="Profit so far" value={bs.profitToDate} sub />
                <Row label="Total owner's share" value={bs.totalEquity} strong />
                <div className="mt-3 rounded-xl bg-app-bg px-3">
                  <Row label="Liabilities + owner's share" value={bs.totalLiabilities + bs.totalEquity} strong />
                </div>
              </div>
            </div>
            {bs.difference !== 0 && <div className="mt-3"><Note>Off by {exact(bs.difference)}. Rebuild the books from Lock & rebuild.</Note></div>}
          </Card>
        )}

        {report && tab === 'trial' && (
          <Card title={`Trial balance · ${day(end)}`} subtitle="The two totals must match.">
            <div className="overflow-x-auto">
              <table className="w-full text-[13px] tabular-nums">
                <thead className="text-app-text-muted text-xs">
                  <tr>
                    <th className="text-left font-medium py-1.5">Account</th>
                    <th className="text-right font-medium">Debit</th>
                    <th className="text-right font-medium">Credit</th>
                  </tr>
                </thead>
                <tbody className="text-app-text">
                  {tb.rows.map((r) => (
                    <tr key={r.id} className="border-t border-app-border cursor-pointer hover:bg-app-bg" onClick={() => setLedgerFor(r.id)}>
                      <td className="py-1.5 pr-3"><span className="text-app-text-muted text-xs mr-2">{r.code}</span>{r.name}</td>
                      <td className="text-right">{r.debit ? exact(r.debit) : ''}</td>
                      <td className="text-right pl-3">{r.credit ? exact(r.credit) : ''}</td>
                    </tr>
                  ))}
                  <tr className="border-t-2 border-app-border font-bold">
                    <td className="py-2">Total</td>
                    <td className="text-right">{exact(tb.debit)}</td>
                    <td className="text-right pl-3">{exact(tb.credit)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            {!tb.balanced && <div className="mt-3"><Note>Debits and credits differ. Rebuild the books from Lock & rebuild.</Note></div>}
          </Card>
        )}

        {report && tab === 'journal' && businessId && (
          <JournalTab businessId={businessId} start={start} end={end} version={version} canManage={canManage}
            onOpen={setEntryOpen} onNew={() => setNewEntry({ template: null })} />
        )}

        {report && tab === 'accounts' && (
          <Card
            title="Chart of accounts"
            subtitle="Balances today."
            action={canManage ? <button data-shortcut="new" onClick={() => setAccountForm({ type: 'expense', active: true })} className={primaryBtn}><Plus size={15} /> Account</button> : undefined}
          >
            {TYPES.map((t) => {
              const list = accounts.filter((a) => a.type === t);
              return (
                <div key={t} className="mb-4">
                  <h3 className="text-xs font-semibold text-app-text-muted">{TYPE_LABELS[t]}</h3>
                  {list.map((a) => (
                    <div key={a.id} role="button" tabIndex={0} onClick={() => setLedgerFor(a.id)} onKeyDown={(e) => { if (e.key === 'Enter') setLedgerFor(a.id); }}
                      className={`flex items-center gap-2 py-2 border-b border-app-border/60 cursor-pointer hover:bg-app-bg -mx-2 px-2 rounded-lg ${a.active ? '' : 'opacity-50'}`}>
                      <span className="text-xs text-app-text-muted tabular-nums w-10 shrink-0">{a.code}</span>
                      <span className="min-w-0 flex-1">
                        <span className="text-[13px] text-app-text">{a.name}</span>
                        {a.key && !a.key.startsWith('exp:') && <span className="ml-2 text-[10px] rounded bg-app-bg px-1.5 py-0.5 text-app-text-muted">Auto</span>}
                        {!a.active && <span className="ml-2 text-[10px] text-app-text-muted">off</span>}
                        {a.description && <span className="block text-[11px] text-app-text-muted truncate">{a.description}</span>}
                      </span>
                      <span className="text-[13px] tabular-nums text-app-text shrink-0">{exact(a.type === 'asset' || a.type === 'expense' ? a.closing : -a.closing)}</span>
                    </div>
                  ))}
                </div>
              );
            })}
          </Card>
        )}

        {report && tab === 'receivables' && businessId && <ReceivablesTab businessId={businessId} version={version} />}

        {report && tab === 'payables' && businessId && (
          <PayablesTab businessId={businessId} version={version} onPay={(s, purchaseId, amount, billId) => setPaying({ supplier: s, purchaseId, amount, billId })} onChanged={changed} />
        )}

        {report && tab === 'checks' && businessId && (
          <ChecksTab businessId={businessId} version={version} canManage={canManage} onCount={setCounting} onChanged={changed} />
        )}

        {report && tab === 'vat' && businessId && (
          <VatTab businessId={businessId} start={start} end={end} version={version} canManage={canManage}
            onPayVat={() => setNewEntry({ template: QUICK_ENTRIES.find((t) => t.id === 'vat_paid')! })} />
        )}

        {report && tab === 'settings' && canManage && businessId && (
          <SettingsTab businessId={businessId} report={report} onChanged={changed} />
        )}
      </div>

      {ledgerFor && businessId && (
        <LedgerSheet
          account={accounts.find((a) => a.id === ledgerFor)!}
          start={start}
          end={end}
          canManage={canManage}
          onClose={() => setLedgerFor(null)}
          onOpenEntry={async (no) => {
            try {
              const { entries } = await loadJournal(businessId, { start, end, search: `JE-${no}`, limit: 1 });
              if (entries[0]) setEntryOpen(entries[0]);
            } catch (err) {
              showToast('Not opened', toUserMessage(err, 'Could not open the entry.'), undefined, 'error');
            }
          }}
          onEdit={(a) => { setLedgerFor(null); setAccountForm(a); }}
        />
      )}

      {entryOpen && (
        <EntrySheet
          entry={entryOpen}
          canManage={canManage}
          locked={!!report?.lockDate && entryOpen.date <= report.lockDate}
          onClose={() => setEntryOpen(null)}
          onEdit={() => { const e = entryOpen; setEntryOpen(null); setNewEntry({ template: QUICK_ENTRIES.find((t) => t.id === 'custom')!, editing: e }); }}
          onChanged={() => { setEntryOpen(null); changed(); }}
        />
      )}

      {newEntry && businessId && (
        <EntryForm
          businessId={businessId}
          accounts={accounts}
          template={newEntry.template}
          editing={newEntry.editing}
          lockDate={report?.lockDate ?? null}
          onClose={() => setNewEntry(null)}
          onSaved={() => { setNewEntry(null); changed(); showToast('Saved', 'The entry is in the books.', undefined, 'success'); }}
        />
      )}

      {accountForm && businessId && (
        <AccountForm businessId={businessId} initial={accountForm} onClose={() => setAccountForm(null)} onSaved={() => { setAccountForm(null); changed(); }} />
      )}

      {paying && businessId && (
        <PaySupplierForm businessId={businessId} {...paying} lockDate={report?.lockDate ?? null} onClose={() => setPaying(null)}
          onSaved={() => { setPaying(null); changed(); showToast('Paid', 'The payment is recorded and the money balance is lower.', undefined, 'success'); }} />
      )}

      {counting && businessId && (
        <CountMoneyForm businessId={businessId} check={counting} onClose={() => setCounting(null)}
          onSaved={(diff) => { setCounting(null); changed(); showToast('Counted', diff === 0 ? 'It matches the books.' : `The books were off by ${exact(diff)}; that is now booked as cash short or over.`, undefined, 'success'); }} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------- Journal

function JournalTab({ businessId, start, end, version, canManage, onOpen, onNew }: {
  businessId: string; start: string; end: string; version: number; canManage: boolean; onOpen: (e: JournalEntry) => void; onNew: () => void;
}) {
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState<SourceType | 'manual' | ''>('');
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [typed, setTyped] = useState('');

  useEffect(() => {
    const t = setTimeout(() => setQuery(typed.trim()), 300);
    return () => clearTimeout(t);
  }, [typed]);

  const fetchPage = useCallback(async (offset: number) => {
    setBusy(true);
    setErr(null);
    try {
      const r = await loadJournal(businessId, { start, end, search: query, kind: kind || null, limit: 60, offset });
      setTotal(r.total);
      setEntries((list) => (offset === 0 ? r.entries : [...list, ...r.entries]));
    } catch (e) {
      setErr(toUserMessage(e, 'Could not load the journal.'));
    } finally {
      setBusy(false);
    }
  }, [businessId, start, end, query, kind]);

  useEffect(() => { void fetchPage(0); }, [fetchPage, version]);

  return (
    <Card
      title="Journal"
      subtitle={`${total.toLocaleString()} entr${total === 1 ? 'y' : 'ies'}. Search by JE number, what it was for, or a customer or supplier.`}
      action={canManage ? <button data-shortcut="new" onClick={onNew} className={primaryBtn}><Plus size={15} /> Entry</button> : undefined}
    >
      <div className="flex flex-wrap gap-2 mb-3">
        <div className="relative flex-1 min-w-[12rem]">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-app-text-muted" />
          <input type="search" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="JE-120, rent, Mama Njeri…" className={`${fieldClass} pl-9`} />
        </div>
        <div className="w-full sm:w-56">
          <SearchableDropdown
            items={[{ id: '', label: 'Everything' }, ...(Object.keys(SOURCE_LABELS) as (SourceType | 'manual')[]).map((k) => ({ id: k, label: SOURCE_LABELS[k] }))]}
            selectedValue={kind}
            onChange={(v) => setKind(v as any)}
            placeholder="Everything"
          />
        </div>
      </div>
      {err && <p className="text-sm text-red-600 dark:text-red-400">{err}</p>}
      <div className="divide-y divide-app-border/60">
        {entries.map((e) => {
          const amount = e.lines.reduce((s, l) => s + l.debit, 0);
          return (
            <button key={e.id} onClick={() => onOpen(e)} className="w-full text-left py-2.5 flex gap-3 items-start hover:bg-app-bg -mx-2 px-2 rounded-lg cursor-pointer">
              <div className="w-16 shrink-0 text-[11px] text-app-text-muted tabular-nums">
                <div className="font-semibold text-app-text">JE-{e.no}</div>
                {day(e.date).replace(/ \d{4}$/, '')}
              </div>
              <div className="min-w-0 flex-1">
                <div className={`text-[13px] text-app-text truncate ${e.reversed ? 'line-through opacity-60' : ''}`}>{e.memo}</div>
                <div className="text-[11px] text-app-text-muted truncate">
                  {SOURCE_LABELS[e.source || 'manual']} · {e.lines.map((l) => l.account).slice(0, 3).join(', ')}{e.lines.length > 3 ? '…' : ''}
                </div>
              </div>
              <div className="text-[13px] tabular-nums text-app-text shrink-0">{exact(amount)}</div>
            </button>
          );
        })}
      </div>
      {!busy && entries.length === 0 && <p className="text-sm text-app-text-muted py-6 text-center">No entries in this period.</p>}
      {entries.length < total && (
        <button onClick={() => void fetchPage(entries.length)} disabled={busy} className={`${secondaryBtn} w-full mt-3`}>
          {busy ? 'Loading…' : `Show more (${(total - entries.length).toLocaleString()} left)`}
        </button>
      )}
    </Card>
  );
}

function EntrySheet({ entry, canManage, locked, onClose, onEdit, onChanged }: {
  entry: JournalEntry; canManage: boolean; locked: boolean; onClose: () => void; onEdit: () => void; onChanged: () => void;
}) {
  const showToast = useNotificationStore((s) => s.showToast);
  const [busy, setBusy] = useState(false);
  const manual = entry.source === null;
  const canChange = canManage && manual && !entry.reversed && !entry.reversalOf;
  const totalDr = entry.lines.reduce((s, l) => s + l.debit, 0);

  const run = async (what: 'reverse' | 'delete') => {
    const ok = await appDialog.confirm(what === 'reverse'
      ? { title: `Reverse JE-${entry.no}?`, message: 'A new entry dated today undoes it. Both stay in the journal.', confirmLabel: 'Reverse' }
      : { title: `Delete JE-${entry.no}?`, message: 'The entry is removed from the books. Money balances it moved go back.', confirmLabel: 'Delete', destructive: true });
    if (!ok) return;
    setBusy(true);
    try {
      if (what === 'reverse') await reverseEntry(entry.id);
      else await deleteEntry(entry.id);
      onChanged();
    } catch (err) {
      showToast('Not done', toUserMessage(err, 'Could not change the entry.'), undefined, 'error');
      setBusy(false);
    }
  };

  return (
    <FormSheet
      title={`JE-${entry.no} · ${day(entry.date)}`}
      subtitle={`${SOURCE_LABELS[entry.source || 'manual']} · by ${entry.by} · ${when(entry.at)}`}
      onClose={onClose}
      wide
      footer={canChange ? (
        <>
          {!locked && <button onClick={() => void run('delete')} disabled={busy} className={dangerBtn}><Trash2 size={15} /> Delete</button>}
          <button onClick={() => void run('reverse')} disabled={busy} className={secondaryBtn}><Undo2 size={15} /> Reverse</button>
          {!locked && <button onClick={onEdit} disabled={busy} className={primaryBtn}>Edit</button>}
        </>
      ) : undefined}
    >
      <p className="text-sm text-app-text">{entry.memo}</p>
      {entry.reversed && <Note tone="info">This entry was reversed by a later entry.</Note>}
      {!manual && <Note tone="info">The app made this entry. To change it, change the {SOURCE_LABELS[entry.source!].toLowerCase()} itself; the books follow.</Note>}
      <div className="overflow-x-auto">
        <table className="w-full text-[13px] tabular-nums">
          <thead className="text-xs text-app-text-muted">
            <tr><th className="text-left font-medium py-1">Account</th><th className="text-right font-medium">Debit</th><th className="text-right font-medium">Credit</th></tr>
          </thead>
          <tbody>
            {entry.lines.map((l, i) => (
              <tr key={i} className="border-t border-app-border">
                <td className="py-1.5 pr-3">
                  <span className="text-xs text-app-text-muted mr-2">{l.code}</span>{l.account}
                  {(l.party || l.memo) && <span className="block text-[11px] text-app-text-muted">{[l.party, l.memo].filter(Boolean).join(' · ')}</span>}
                </td>
                <td className="text-right">{l.debit ? exact(l.debit) : ''}</td>
                <td className="text-right pl-3">{l.credit ? exact(l.credit) : ''}</td>
              </tr>
            ))}
            <tr className="border-t-2 border-app-border font-semibold">
              <td className="py-1.5">Total</td><td className="text-right">{exact(totalDr)}</td><td className="text-right pl-3">{exact(totalDr)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </FormSheet>
  );
}

// ---------------------------------------------------------------- Ledger

function LedgerSheet({ account, start, end, canManage, onClose, onOpenEntry, onEdit }: {
  account: AccountBalance; start: string; end: string; canManage: boolean;
  onClose: () => void; onOpenEntry: (no: number) => void; onEdit: (a: AccountBalance) => void;
}) {
  const [data, setData] = useState<{ opening: number; total: number; lines: LedgerLine[] } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const sign = account.type === 'asset' || account.type === 'expense' ? 1 : -1;

  useEffect(() => {
    let live = true;
    loadLedger(account.id, start, end, 500)
      .then((d) => { if (live) setData(d); })
      .catch((e) => { if (live) setErr(toUserMessage(e, 'Could not load this account.')); });
    return () => { live = false; };
  }, [account.id, start, end]);

  return (
    <FormSheet
      title={`${account.code} · ${account.name}`}
      subtitle={`${TYPE_LABELS[account.type]} · ${day(start)} to ${day(end)}`}
      onClose={onClose}
      wide
      footer={canManage ? <button onClick={() => onEdit(account)} className={secondaryBtn}>Edit account</button> : undefined}
    >
      {account.description && <p className="text-xs text-app-text-muted">{account.description}</p>}
      <div className="grid grid-cols-3 gap-2 text-center">
        <div className="rounded-xl bg-app-bg p-2"><div className="text-[11px] text-app-text-muted">Before</div><div className="text-sm font-semibold tabular-nums">{exact(sign * account.opening)}</div></div>
        <div className="rounded-xl bg-app-bg p-2"><div className="text-[11px] text-app-text-muted">Change</div><div className="text-sm font-semibold tabular-nums">{exact(sign * (account.debit - account.credit))}</div></div>
        <div className="rounded-xl bg-app-bg p-2"><div className="text-[11px] text-app-text-muted">At the end</div><div className="text-sm font-bold tabular-nums">{exact(sign * account.closing)}</div></div>
      </div>
      {err && <p className="text-sm text-red-600 dark:text-red-400">{err}</p>}
      {!data && !err && <p className="text-sm text-app-text-muted">Loading…</p>}
      {data && (
        <>
          {data.total > data.lines.length && <p className="text-[11px] text-app-text-muted">Showing the newest {data.lines.length} of {data.total.toLocaleString()} lines.</p>}
          <div className="overflow-x-auto">
            <table className="w-full text-[12px] tabular-nums">
              <thead className="text-app-text-muted">
                <tr>
                  <th className="text-left font-medium py-1">Date</th>
                  <th className="text-left font-medium">What</th>
                  <th className="text-right font-medium">In</th>
                  <th className="text-right font-medium">Out</th>
                  <th className="text-right font-medium">Balance</th>
                </tr>
              </thead>
              <tbody>
                {data.lines.map((l, i) => {
                  const up = sign > 0 ? l.debit : l.credit;
                  const down = sign > 0 ? l.credit : l.debit;
                  return (
                    <tr key={i} className="border-t border-app-border cursor-pointer hover:bg-app-bg" onClick={() => onOpenEntry(l.no)}>
                      <td className="py-1.5 pr-2 whitespace-nowrap">{day(l.date).replace(/ \d{4}$/, '')}</td>
                      <td className="pr-2 min-w-[10rem]">
                        <span className="text-app-text">{l.memo}</span>
                        <span className="block text-[10px] text-app-text-muted">JE-{l.no}{l.party ? ` · ${l.party}` : ''}</span>
                      </td>
                      <td className="text-right">{up ? exact(up) : ''}</td>
                      <td className="text-right pl-2">{down ? exact(down) : ''}</td>
                      <td className="text-right pl-2 font-medium">{exact(sign * l.balance)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {data.lines.length === 0 && <p className="text-sm text-app-text-muted text-center py-4">Nothing moved in this account in the period.</p>}
        </>
      )}
    </FormSheet>
  );
}

// ---------------------------------------------------------------- Entry form

function EntryForm({ businessId, accounts, template, editing, lockDate, onClose, onSaved }: {
  businessId: string; accounts: AccountBalance[]; template: QuickTemplate | null; editing?: JournalEntry;
  lockDate: string | null; onClose: () => void; onSaved: () => void;
}) {
  const [t, setT] = useState<QuickTemplate | null>(template);
  const [date, setDate] = useState(editing?.date || kenyaToday());
  const [memo, setMemo] = useState(editing?.memo || '');
  const [amount, setAmount] = useState('');
  const [picks, setPicks] = useState<{ money?: string; to?: string; account?: string }>({});
  const [lines, setLines] = useState<DraftLine[]>(
    editing ? editing.lines.map((l) => ({ accountId: l.accountId, debit: l.debit, credit: l.credit, memo: l.memo || '' }))
      : [{ accountId: '', debit: 0, credit: 0 }, { accountId: '', debit: 0, credit: 0 }],
  );
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const moneyAccounts = (a: AccountBalance) => isMoneyKey(a.key);
  const custom = t?.id === 'custom';
  const check = checkDraft(lines);
  const minDate = lockDate ? new Date(new Date(`${lockDate}T12:00:00Z`).getTime() + 864e5).toISOString().slice(0, 10) : undefined;

  const submit = async () => {
    if (!t) return;
    setErr(null);
    let draftLines: DraftLine[];
    if (custom) {
      if (check.error) { setErr(check.error); return; }
      draftLines = lines.filter((l) => l.debit > 0 || l.credit > 0);
    } else {
      const made = quickLines(t, accounts, Number(amount), picks);
      if (typeof made === 'string') { setErr(made); return; }
      draftLines = made;
    }
    const note = memo.trim() || t.title;
    setBusy(true);
    try {
      await saveEntry(businessId, { date, memo: note, lines: draftLines }, editing?.id);
      onSaved();
    } catch (e) {
      setErr(toUserMessage(e, 'Could not save the entry.'));
      setBusy(false);
    }
  };

  if (!t) {
    return (
      <FormSheet title="New entry" subtitle="What happened?" onClose={onClose}>
        <div className="grid gap-2">
          {QUICK_ENTRIES.map((q) => (
            <button key={q.id} onClick={() => setT(q)} className="text-left rounded-xl bg-app-bg px-3 py-2.5 hover:ring-1 hover:ring-amber-500/40 cursor-pointer flex items-center gap-2">
              <span className="min-w-0 flex-1">
                <span className="block text-[13px] font-medium text-app-text">{q.title}</span>
                <span className="block text-[11px] text-app-text-muted">{q.hint}</span>
              </span>
              <ChevronRight size={16} className="text-app-text-muted" />
            </button>
          ))}
        </div>
      </FormSheet>
    );
  }

  const usesMoney = t.debit === 'money' || t.credit === 'money';
  return (
    <FormSheet
      title={editing ? `Edit JE-${editing.no}` : t.title}
      subtitle={t.hint}
      onClose={onClose}
      wide={custom}
      footer={
        <>
          {!editing && <button onClick={() => setT(null)} className={secondaryBtn}>Back</button>}
          <button onClick={() => void submit()} disabled={busy} className={primaryBtn}>{busy ? 'Saving…' : 'Save entry'}</button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Date" hint={lockDate ? `Books are locked up to ${day(lockDate)}.` : undefined}>
          <input type="date" value={date} min={minDate} onChange={(e) => setDate(e.target.value)} className={fieldClass} />
        </Field>
        {!custom && (
          <Field label="Amount (KSh)">
            <NumberInput min={0} value={amount} onChange={(v) => setAmount((v == null ? '' : String(v)))} autoFocus />
          </Field>
        )}
      </div>

      {t.id === 'transfer' && (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="From"><AccountSelect accounts={accounts} value={picks.money || ''} onChange={(v) => setPicks((p) => ({ ...p, money: v }))} filter={moneyAccounts} /></Field>
          <Field label="To"><AccountSelect accounts={accounts} value={picks.to || ''} onChange={(v) => setPicks((p) => ({ ...p, to: v }))} filter={moneyAccounts} /></Field>
        </div>
      )}
      {t.id !== 'transfer' && usesMoney && (
        <Field label={t.debit === 'money' ? 'Money went into' : 'Paid from'}>
          <AccountSelect accounts={accounts} value={picks.money || ''} onChange={(v) => setPicks((p) => ({ ...p, money: v }))} filter={moneyAccounts} />
        </Field>
      )}
      {t.id === 'opening' && (
        <Field label="Account" hint="For stock, use Count money & stock → Match stock instead.">
          <AccountSelect accounts={accounts} value={picks.account || ''} onChange={(v) => setPicks((p) => ({ ...p, account: v }))} filter={(a) => a.type === 'asset'} />
        </Field>
      )}

      {custom && (
        <div className="space-y-2">
          <div className="hidden sm:grid grid-cols-[minmax(0,1fr)_7rem_7rem_2rem] gap-2 text-[11px] text-app-text-muted px-0.5">
            <span>Account</span><span className="text-right">Debit</span><span className="text-right">Credit</span><span />
          </div>
          {lines.map((l, i) => (
            <div key={i} className="grid grid-cols-2 sm:grid-cols-[minmax(0,1fr)_7rem_7rem_2rem] gap-2 items-center rounded-xl sm:rounded-none bg-app-bg sm:bg-transparent p-2 sm:p-0">
              <div className="col-span-2 sm:col-span-1">
                <AccountSelect accounts={accounts} value={l.accountId} onChange={(v) => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, accountId: v } : x)))} />
              </div>
              <NumberInput aria-label="Debit" min={0} placeholder="Debit" value={l.debit || ''}
                onChange={(v) => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, debit: (v ?? 0) || 0, credit: (v ?? 0) ? 0 : x.credit } : x)))} inputClassName="text-right" />
              <NumberInput aria-label="Credit" min={0} placeholder="Credit" value={l.credit || ''}
                onChange={(v) => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, credit: (v ?? 0) || 0, debit: (v ?? 0) ? 0 : x.debit } : x)))} inputClassName="text-right" />
              <button type="button" aria-label="Remove line" disabled={lines.length <= 2} onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}
                className="p-1.5 rounded-lg text-app-text-muted hover:bg-app-bg disabled:opacity-30 cursor-pointer justify-self-end col-span-2 sm:col-span-1">
                <Trash2 size={15} />
              </button>
            </div>
          ))}
          <div className="flex items-center gap-3 flex-wrap">
            <button type="button" onClick={() => setLines((ls) => [...ls, { accountId: '', debit: 0, credit: 0 }])} className={secondaryBtn}><Plus size={15} /> Line</button>
            <span className={`ml-auto text-xs tabular-nums ${check.debit === check.credit && check.debit > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-app-text-muted'}`}>
              Debits {exact(check.debit)} · Credits {exact(check.credit)}
            </span>
          </div>
          <p className="text-[11px] text-app-text-muted">
            Debit: money in or an expense. Credit: where it came from.
          </p>
        </div>
      )}

      <Field label="What is it for?">
        <input value={memo} onChange={(e) => setMemo(e.target.value)} placeholder={t.title} className={fieldClass} maxLength={200} />
      </Field>
      {(usesMoney || custom) && <p className="text-[11px] text-app-text-muted">Money lines also change Payments balances.</p>}
      {err && <p className="text-sm text-red-600 dark:text-red-400">{err}</p>}
    </FormSheet>
  );
}

// ---------------------------------------------------------------- Accounts

function AccountForm({ businessId, initial, onClose, onSaved }: { businessId: string; initial: Partial<AccountBalance>; onClose: () => void; onSaved: () => void }) {
  const showToast = useNotificationStore((s) => s.showToast);
  const [code, setCode] = useState(initial.code || '');
  const [name, setName] = useState(initial.name || '');
  const [type, setType] = useState<AccountType>(initial.type || 'expense');
  const [description, setDescription] = useState(initial.description || '');
  const [active, setActive] = useState(initial.active !== false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const system = !!initial.key && !initial.key.startsWith('exp:');

  const save = async () => {
    setBusy(true);
    setErr(null);
    try {
      await saveAccount(businessId, { id: initial.id, code, name, type, description, active });
      onSaved();
    } catch (e) {
      setErr(toUserMessage(e, 'Could not save the account.'));
      setBusy(false);
    }
  };
  const remove = async () => {
    if (!initial.id) return;
    const ok = await appDialog.confirm({ title: `Remove ${initial.name}?`, message: 'Only an account with no entries can be removed.', confirmLabel: 'Remove', destructive: true });
    if (!ok) return;
    try {
      await deleteAccount(initial.id);
      onSaved();
    } catch (e) {
      showToast('Not removed', toUserMessage(e, 'Could not remove the account.'), undefined, 'error');
    }
  };

  return (
    <FormSheet
      title={initial.id ? 'Edit account' : 'New account'}
      subtitle={system ? 'The app posts to this account: you can rename it, but not change its kind.' : undefined}
      onClose={onClose}
      footer={
        <>
          {initial.id && !initial.key && <button onClick={() => void remove()} className={dangerBtn}><Trash2 size={15} /> Remove</button>}
          <button onClick={() => void save()} disabled={busy} className={primaryBtn}>{busy ? 'Saving…' : 'Save'}</button>
        </>
      }
    >
      <div className="grid gap-3 grid-cols-[6rem_minmax(0,1fr)]">
        <Field label="Code"><input value={code} onChange={(e) => setCode(e.target.value)} className={fieldClass} placeholder="6500" maxLength={12} /></Field>
        <Field label="Name"><input value={name} onChange={(e) => setName(e.target.value)} className={fieldClass} placeholder="Motorbike fuel" maxLength={80} /></Field>
      </div>
      <Field label="Kind" hint="Codes usually start 1 (own), 2 (owe), 3 (owner), 4 (income), 5–6 (expenses).">
        <SearchableDropdown
          items={TYPES.map((t) => ({ id: t, label: TYPE_LABELS[t] }))}
          selectedValue={type}
          onChange={(v) => setType(v as AccountType)}
          disabled={system}
          placeholder="Choose a kind"
        />
      </Field>
      <Field label="Description (optional)"><input value={description} onChange={(e) => setDescription(e.target.value)} className={fieldClass} maxLength={200} /></Field>
      {!system && (
        <Checkbox checked={active} onChange={setActive} label="In use" description="Off hides it from new entries" />
      )}
      {err && <p className="text-sm text-red-600 dark:text-red-400">{err}</p>}
    </FormSheet>
  );
}

// ---------------------------------------------------------------- Customers owe

function ReceivablesTab({ businessId, version }: { businessId: string; version: number }) {
  const [rows, setRows] = useState<Receivable[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [q, setQ] = useState('');
  useEffect(() => {
    let live = true;
    loadReceivables(businessId).then((r) => live && setRows(r)).catch((e) => live && setErr(toUserMessage(e, 'Could not load what customers owe.')));
    return () => { live = false; };
  }, [businessId, version]);
  const list = (rows || []).filter((r) => !q || `${r.name} ${r.phone || ''}`.toLowerCase().includes(q.toLowerCase()));
  const owed = (rows || []).reduce((s, r) => s + r.owes, 0);
  const held = (rows || []).reduce((s, r) => s + r.holds, 0);
  const mismatched = (rows || []).filter((r) => Math.round(r.owes) !== Math.round(r.appDebt) || Math.round(r.holds) !== Math.round(r.appWallet)).length;

  return (
    <Card title="What customers owe" subtitle="Per customer, today.">
      {err && <p className="text-sm text-red-600 dark:text-red-400">{err}</p>}
      {!rows && !err && <p className="text-sm text-app-text-muted">Loading…</p>}
      {rows && (
        <>
          <div className="grid grid-cols-2 gap-2 mb-3">
            <Tile label="Customers owe" value={money(owed)} />
            <Tile label="Wallet money we hold" value={money(held)} />
          </div>
          {mismatched > 0 && <div className="mb-3"><Note>{mismatched} customer{mismatched === 1 ? '\'s' : 's\''} balance differs from the customer screen. Check Lock & rebuild.</Note></div>}
          <div className="relative mb-2">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-app-text-muted" />
            <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search customers" className={`${fieldClass} pl-9`} />
          </div>
          <div className="divide-y divide-app-border/60">
            {list.map((r) => (
              <div key={r.customerId} className="py-2 flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] text-app-text truncate">{r.name}</div>
                  <div className="text-[11px] text-app-text-muted">{[r.phone, r.since ? `owing since ${day(r.since)}` : null].filter(Boolean).join(' · ')}</div>
                </div>
                <div className="text-right shrink-0 tabular-nums">
                  {r.owes !== 0 && <div className="text-[13px] font-semibold text-app-text">{exact(r.owes)}</div>}
                  {r.holds !== 0 && <div className="text-[11px] text-emerald-600 dark:text-emerald-400">wallet {exact(r.holds)}</div>}
                  {(Math.round(r.owes) !== Math.round(r.appDebt) || Math.round(r.holds) !== Math.round(r.appWallet)) && (
                    <div className="text-[10px] text-amber-600">screen shows {exact(r.appDebt)}{r.appWallet ? ` / wallet ${exact(r.appWallet)}` : ''}</div>
                  )}
                </div>
              </div>
            ))}
          </div>
          {list.length === 0 && <p className="text-sm text-app-text-muted text-center py-4">No customer owes anything.</p>}
        </>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------- Suppliers

function PayablesTab({ businessId, version, onPay, onChanged }: {
  businessId: string; version: number; onPay: (s: Payable, purchaseId: string | null, amount: number, billId?: string | null) => void; onChanged: () => void;
}) {
  const showToast = useNotificationStore((s) => s.showToast);
  const [data, setData] = useState<{ suppliers: Payable[]; payments: SupplierPayment[]; canPay: boolean } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [showPaid, setShowPaid] = useState(false);

  useEffect(() => {
    let live = true;
    loadPayables(businessId).then((d) => live && setData(d)).catch((e) => live && setErr(toUserMessage(e, 'Could not load what we owe suppliers.')));
    return () => { live = false; };
  }, [businessId, version]);

  const voidPayment = async (p: SupplierPayment) => {
    const ok = await appDialog.confirm({ title: `Void ${money(p.amount)} to ${p.supplier}?`, message: 'The money goes back to its account and the supplier is owed it again.', confirmLabel: 'Void', destructive: true });
    if (!ok) return;
    try {
      await voidSupplierPayment(p.id, 'Voided from Accounting');
      onChanged();
    } catch (e) {
      showToast('Not voided', toUserMessage(e, 'Could not void the payment.'), undefined, 'error');
    }
  };

  const list = (data?.suppliers || []).filter((s) => showPaid || Math.round(s.owed) !== 0);
  const total = (data?.suppliers || []).reduce((s, x) => s + x.owed, 0);

  return (
    <div className="space-y-4">
      <Card title="What we owe suppliers" subtitle="What you owe suppliers.">
        {err && <p className="text-sm text-red-600 dark:text-red-400">{err}</p>}
        {!data && !err && <p className="text-sm text-app-text-muted">Loading…</p>}
        {data && (
          <>
            <div className="flex items-center gap-3 mb-3 flex-wrap">
              <div className="text-lg font-bold tabular-nums text-app-text">{money(total)}</div>
              <label className="ml-auto flex items-center gap-2 text-xs text-app-text-muted">
                <Checkbox checked={showPaid} onChange={(on) => setShowPaid(on)} /> Show suppliers paid up
              </label>
            </div>
            <div className="divide-y divide-app-border/60">
              {list.map((s) => (
                <div key={s.party} className="py-2">
                  <div className="flex items-center gap-2">
                    <button onClick={() => setOpen(open === s.party ? null : s.party)} className="min-w-0 flex-1 text-left flex items-center gap-2 cursor-pointer" aria-expanded={open === s.party}>
                      {open === s.party ? <ChevronDown size={15} className="text-app-text-muted shrink-0" /> : <ChevronRight size={15} className="text-app-text-muted shrink-0" />}
                      <span className="min-w-0">
                        <span className="block text-[13px] text-app-text truncate">{s.name}</span>
                        <span className="block text-[11px] text-app-text-muted">Billed {money(s.billed)}{s.returned > 0 ? ` · returned ${money(s.returned)}` : ''} · paid {money(s.paid)}{s.notBilled > 0 ? ` · ${money(s.notBilled)} received, not billed yet` : ''}</span>
                      </span>
                    </button>
                    <span className={`text-[13px] font-semibold tabular-nums shrink-0 ${s.owed > 0 ? 'text-app-text' : 'text-emerald-600 dark:text-emerald-400'}`}>{exact(s.owed)}</span>
                    {data.canPay && s.owed > 0 && (
                      <button onClick={() => onPay(s, null, s.owed)} className={`${secondaryBtn} !px-3 !py-1.5 text-xs`}><Wallet size={13} /> Pay</button>
                    )}
                  </div>
                  {open === s.party && (
                    <div className="mt-2 ml-6 space-y-1">
                      {s.bills.map((b) => (
                        <div key={b.billId || b.purchaseId} className="flex items-center gap-2 text-[12px]">
                          <span className="min-w-0 flex-1 text-app-text truncate">{b.ref} · {day(b.received)}</span>
                          <span className="tabular-nums text-app-text-muted">{exact(b.total)}</span>
                          <span className={`tabular-nums w-24 text-right ${b.owed > 0 ? 'text-app-text font-medium' : 'text-emerald-600 dark:text-emerald-400'}`}>{b.owed > 0 ? `owe ${exact(b.owed)}` : 'paid'}</span>
                          {data.canPay && b.owed > 0 && (
                            <button onClick={() => onPay(s, b.purchaseId, b.owed, b.billId)} className="text-xs underline text-app-text cursor-pointer">Pay</button>
                          )}
                        </div>
                      ))}
                      {s.unlinkedPaid > 0 && <p className="text-[11px] text-app-text-muted">{money(s.unlinkedPaid)} was paid on account, not against one purchase.</p>}
                    </div>
                  )}
                </div>
              ))}
            </div>
            {list.length === 0 && <p className="text-sm text-app-text-muted text-center py-4">Nothing owed to suppliers.</p>}
          </>
        )}
      </Card>

      {data && data.payments.length > 0 && (
        <Card title="Supplier payments" subtitle="Newest first">
          <div className="divide-y divide-app-border/60">
            {data.payments.slice(0, 60).map((p) => (
              <div key={p.id} className={`py-2 flex items-center gap-3 ${p.voidedAt ? 'opacity-50' : ''}`}>
                <div className="min-w-0 flex-1">
                  <div className={`text-[13px] text-app-text truncate ${p.voidedAt ? 'line-through' : ''}`}>{p.supplier}</div>
                  <div className="text-[11px] text-app-text-muted">{when(p.paidAt)} · {p.method}{p.reference ? ` · ${p.reference}` : ''}{p.by ? ` · ${p.by}` : ''}{p.voidedAt ? ' · voided' : ''}</div>
                </div>
                <span className="text-[13px] tabular-nums text-app-text">{exact(p.amount)}</span>
                {data.canPay && !p.voidedAt && (
                  <button onClick={() => void voidPayment(p)} className="p-1.5 rounded-lg text-app-text-muted hover:bg-app-bg cursor-pointer" aria-label="Void payment" title="Void"><Undo2 size={15} /></button>
                )}
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}

function PaySupplierForm({ businessId, supplier, purchaseId, amount, billId, lockDate, onClose, onSaved }: {
  businessId: string; supplier: Payable; purchaseId: string | null; amount: number; billId?: string | null; lockDate: string | null; onClose: () => void; onSaved: () => void;
}) {
  const [value, setValue] = useState(String(Math.round(amount * 100) / 100));
  const [method, setMethod] = useState('M-Pesa');
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');
  const [date, setDate] = useState(kenyaToday());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const bill = billId ? supplier.bills.find((b) => b.billId === billId) : supplier.bills.find((b) => b.purchaseId === purchaseId && !b.billId);

  const save = async () => {
    setBusy(true);
    setErr(null);
    try {
      const paidAt = date === kenyaToday() ? null : new Date(`${date}T12:00:00+03:00`).toISOString();
      if (billId) {
        await recordBillPayment(billId, { amount: Number(value), method, reference, note, paidAt });
      } else {
        await recordSupplierPayment(businessId, {
          supplierId: supplier.supplierId, supplierName: supplier.name, purchaseId, amount: Number(value), method, reference, note, paidAt,
        });
      }
      onSaved();
    } catch (e) {
      setErr(toUserMessage(e, 'Could not record the payment.'));
      setBusy(false);
    }
  };

  return (
    <FormSheet
      title={`Pay ${supplier.name}`}
      subtitle={bill ? `For ${bill.ref}, owing ${money(bill.owed)}` : `Owing ${money(supplier.owed)} in total`}
      onClose={onClose}
      footer={<button onClick={() => void save()} disabled={busy} className={primaryBtn}>{busy ? 'Saving…' : 'Record payment'}</button>}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Amount (KSh)"><NumberInput min={0} value={value} onChange={(v) => setValue((v == null ? '' : String(v)))} /></Field>
        <Field label="Paid from">
          <SearchableDropdown items={METHODS.map((m) => ({ id: m, label: m }))} selectedValue={method} onChange={setMethod} placeholder="Choose how" />
        </Field>
        <Field label="Date" hint={lockDate ? `Books are locked up to ${day(lockDate)}.` : undefined}>
          <input type="date" value={date} max={kenyaToday()} onChange={(e) => setDate(e.target.value)} className={fieldClass} />
        </Field>
        <Field label="Reference (optional)"><input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="M-Pesa code, cheque no." className={fieldClass} maxLength={60} /></Field>
      </div>
      <Field label="Note (optional)"><input value={note} onChange={(e) => setNote(e.target.value)} className={fieldClass} maxLength={200} /></Field>
      <p className="text-[11px] text-app-text-muted">The {method} balance on the Payments screen goes down by this amount.</p>
      {err && <p className="text-sm text-red-600 dark:text-red-400">{err}</p>}
    </FormSheet>
  );
}

// ---------------------------------------------------------------- Count money & stock

function ChecksTab({ businessId, version, canManage, onCount, onChanged }: {
  businessId: string; version: number; canManage: boolean; onCount: (m: MoneyCheck) => void; onChanged: () => void;
}) {
  const showToast = useNotificationStore((s) => s.showToast);
  const [data, setData] = useState<{ money: MoneyCheck[]; stock: { books: number; actual: number; difference: number }; history: CheckHistory[] } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    loadChecks(businessId).then((d) => live && setData(d)).catch((e) => live && setErr(toUserMessage(e, 'Could not load the checks.')));
    return () => { live = false; };
  }, [businessId, version]);

  const match = async () => {
    if (!data) return;
    const ok = await appDialog.confirm({
      title: 'Match the books to stock on hand?',
      message: `On hand ${money(data.stock.actual)}, books ${money(data.stock.books)}. The difference is booked today.`,
      confirmLabel: 'Match',
    });
    if (!ok) return;
    setBusy(true);
    try {
      await matchStock(businessId);
      onChanged();
    } catch (e) {
      showToast('Not matched', toUserMessage(e, 'Could not match the stock.'), undefined, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <Card title="Money accounts" subtitle="Books next to Payments. Count to correct both.">
        {err && <p className="text-sm text-red-600 dark:text-red-400">{err}</p>}
        {!data && !err && <p className="text-sm text-app-text-muted">Loading…</p>}
        {data && (
          <div className="overflow-x-auto">
            <table className="w-full text-[13px] tabular-nums">
              <thead className="text-xs text-app-text-muted">
                <tr><th className="text-left font-medium py-1">Account</th><th className="text-right font-medium">Books</th><th className="text-right font-medium">Payments screen</th><th /></tr>
              </thead>
              <tbody>
                {data.money.map((m) => {
                  const differs = m.app !== null && Math.round(m.app) !== Math.round(m.books);
                  return (
                    <tr key={m.accountId} className="border-t border-app-border">
                      <td className="py-2 pr-3">{m.name}</td>
                      <td className={`text-right ${m.books < 0 ? 'text-red-600 dark:text-red-400' : ''}`}>{exact(m.books)}</td>
                      <td className={`text-right pl-3 ${differs ? 'text-amber-600' : 'text-app-text-muted'}`}>{m.app === null ? '—' : exact(m.app)}</td>
                      <td className="text-right pl-3">
                        {canManage && <button onClick={() => onCount(m)} className="text-xs underline cursor-pointer text-app-text">Count</button>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {data && (
        <Card title="Stock value" subtitle="The stock account against stock on hand × each product's cost">
          <div className="grid grid-cols-3 gap-2">
            <Tile label="Books" value={money(data.stock.books)} />
            <Tile label="On hand" value={money(data.stock.actual)} />
            <Tile label="Difference" value={money(data.stock.difference)} tone={Math.abs(data.stock.difference) >= 1 ? 'bad' : 'good'} />
          </div>
          
          {canManage && Math.abs(data.stock.difference) >= 1 && (
            <button onClick={() => void match()} disabled={busy} className={`${primaryBtn} mt-3`}><Scale size={15} /> Match stock</button>
          )}
        </Card>
      )}

      {data && data.history.length > 0 && (
        <Card title="Past counts">
          <div className="divide-y divide-app-border/60">
            {data.history.map((h) => (
              <div key={h.id} className="py-2 flex items-center gap-3 text-[13px]">
                <div className="min-w-0 flex-1">
                  <div className="text-app-text">{h.account}{h.note ? ` · ${h.note}` : ''}</div>
                  <div className="text-[11px] text-app-text-muted">{when(h.at)} · {h.by}{h.entryNo ? ` · JE-${h.entryNo}` : ''}</div>
                </div>
                <div className="text-right tabular-nums">
                  <div className="text-app-text">{exact(h.actual)}</div>
                  <div className={`text-[11px] ${h.difference === 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600'}`}>{h.difference === 0 ? 'matched' : `${h.difference > 0 ? '+' : ''}${exact(h.difference)}`}</div>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}

function CountMoneyForm({ businessId, check, onClose, onSaved }: { businessId: string; check: MoneyCheck; onClose: () => void; onSaved: (diff: number) => void }) {
  const [value, setValue] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const actual = Number(value);
  const diff = value === '' ? null : Math.round((actual - check.books) * 100) / 100;

  const save = async () => {
    if (value === '' || isNaN(actual)) { setErr('Enter the amount you counted.'); return; }
    setBusy(true);
    setErr(null);
    try {
      const r = await reconcileMoney(businessId, check.accountId, actual, note);
      onSaved(Number(r?.difference) || 0);
    } catch (e) {
      setErr(toUserMessage(e, 'Could not save the count.'));
      setBusy(false);
    }
  };

  return (
    <FormSheet
      title={`Count ${check.name}`}
      subtitle={check.key === 'cash' ? 'Count the till and the safe' : `Check the ${check.name} statement or app`}
      onClose={onClose}
      footer={<button onClick={() => void save()} disabled={busy} className={primaryBtn}>{busy ? 'Saving…' : 'Save count'}</button>}
    >
      <div className="grid grid-cols-2 gap-2">
        <Tile label="Books say" value={exact(check.books)} />
        <Tile label="Payments screen" value={check.app === null ? '—' : exact(check.app)} />
      </div>
      <Field label="What is really there (KSh)">
        <NumberInput value={value} onChange={(v) => setValue((v == null ? '' : String(v)))} autoFocus />
      </Field>
      {diff !== null && !isNaN(diff) && (
        <Note tone={diff === 0 ? 'ok' : 'warn'}>
          {diff === 0 ? 'It matches the books.' : `${diff > 0 ? 'More' : 'Less'} than the books by ${exact(Math.abs(diff))}. This is booked as cash short or over, and the Payments screen balance becomes ${exact(actual)}.`}
        </Note>
      )}
      <Field label="Note (optional)"><input value={note} onChange={(e) => setNote(e.target.value)} className={fieldClass} placeholder="End of month count" maxLength={200} /></Field>
      {err && <p className="text-sm text-red-600 dark:text-red-400">{err}</p>}
    </FormSheet>
  );
}

// ---------------------------------------------------------------- VAT

function VatTab({ businessId, start, end, version, canManage, onPayVat }: {
  businessId: string; start: string; end: string; version: number; canManage: boolean; onPayVat: () => void;
}) {
  const [data, setData] = useState<Awaited<ReturnType<typeof loadVat>> | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    loadVat(businessId, start, end).then((d) => live && setData(d)).catch((e) => live && setErr(toUserMessage(e, 'Could not load VAT.')));
    return () => { live = false; };
  }, [businessId, start, end, version]);

  const charged = (data?.months || []).reduce((s, m) => s + m.vatCharged, 0);
  const paid = (data?.months || []).reduce((s, m) => s + m.vatPaid, 0);
  const onPurchases = (data?.months || []).reduce((s, m) => s + m.vatOnPurchases, 0);

  return (
    <Card
      title="VAT"
      subtitle="VAT charged on sales each month, VAT on supplier bills (claimed back), and what was paid to KRA. File the return on iTax; this gives you the figures."
      action={canManage ? <button onClick={onPayVat} className={secondaryBtn}>Record VAT paid</button> : undefined}
    >
      {err && <p className="text-sm text-red-600 dark:text-red-400">{err}</p>}
      {!data && !err && <p className="text-sm text-app-text-muted">Loading…</p>}
      {data && (
        <>
          {!data.taxOn && <div className="mb-3"><Note tone="info">VAT is off for this branch.</Note></div>}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
            <Tile label="Charged in period" value={money(charged)} />
            <Tile label="On purchases in period" value={money(onPurchases)} />
            <Tile label="Paid to KRA in period" value={money(paid)} />
            <Tile label="Owed to KRA now" value={money(data.owedNow)} tone={data.owedNow > 0 ? 'bad' : undefined} />
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-[13px] tabular-nums">
              <thead className="text-xs text-app-text-muted">
                <tr>
                  <th className="text-left font-medium py-1">Month</th>
                  <th className="text-right font-medium">Sales</th>
                  <th className="text-right font-medium">With VAT</th>
                  <th className="text-right font-medium">VAT charged</th>
                  <th className="text-right font-medium">On purchases</th>
                  <th className="text-right font-medium">Paid</th>
                </tr>
              </thead>
              <tbody>
                {data.months.map((m) => (
                  <tr key={m.month} className="border-t border-app-border">
                    <td className="py-1.5 pr-3 whitespace-nowrap">{monthName(m.month)}</td>
                    <td className="text-right">{exact(m.sales)}</td>
                    <td className="text-right pl-2">{exact(m.taxedSales)}</td>
                    <td className="text-right pl-2 font-medium">{exact(m.vatCharged)}</td>
                    <td className="text-right pl-2">{exact(m.vatOnPurchases)}</td>
                    <td className="text-right pl-2">{exact(m.vatPaid)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-[11px] text-app-text-muted mt-2">"With VAT" is sales that charged VAT; the rest were zero-rated or VAT was off. "Owed to KRA now" is VAT charged less VAT on purchases.</p>
        </>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------- Lock & rebuild

function SettingsTab({ businessId, report, onChanged }: { businessId: string; report: AccountingReport; onChanged: () => void }) {
  const showToast = useNotificationStore((s) => s.showToast);
  const [lock, setLock] = useState(report.lockDate || '');
  const [busy, setBusy] = useState<string | null>(null);
  const [errors, setErrors] = useState<{ source: SourceType; sourceId: string; message: string; at: string }[] | null>(null);

  useEffect(() => {
    let live = true;
    loadErrors(businessId).then((e) => live && setErrors(e)).catch(() => live && setErrors([]));
    return () => { live = false; };
  }, [businessId, report]);

  const saveLock = async () => {
    setBusy('lock');
    try {
      await setLockDate(businessId, lock || null);
      showToast('Saved', lock ? `Books locked up to ${day(lock)}.` : 'Books unlocked.', undefined, 'success');
      onChanged();
    } catch (e) {
      showToast('Not saved', toUserMessage(e, 'Could not change the lock date.'), undefined, 'error');
    } finally {
      setBusy(null);
    }
  };

  const rebuild = async () => {
    const ok = await appDialog.confirm({
      title: 'Rebuild the books?',
      message: `Every entry the app made${report.lockDate ? ` after ${day(report.lockDate)}` : ''} is worked out again from the sales, expenses, payments and purchases. Entries you typed stay. This can take a minute on a big business.`,
      confirmLabel: 'Rebuild',
    });
    if (!ok) return;
    setBusy('Starting…');
    try {
      await rebuildBooks(businessId, (t) => setBusy(t));
      showToast('Rebuilt', 'The books were worked out again.', undefined, 'success');
      onChanged();
    } catch (e) {
      showToast('Not finished', toUserMessage(e, 'The rebuild stopped. Run it again.'), undefined, 'error');
    } finally {
      setBusy(null);
    }
  };

  const retry = async () => {
    setBusy('retry');
    try {
      const r = await retryErrors(businessId);
      showToast('Retried', `${r.fixed} posted${r.failed ? `, ${r.failed} still failing` : ''}.`, undefined, r.failed ? 'error' : 'success');
      onChanged();
    } catch (e) {
      showToast('Not retried', toUserMessage(e, 'Could not retry.'), undefined, 'error');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-4">
      <Card title="Lock the books" subtitle="After you close a month (or file VAT), lock it. Nothing dated on or before the lock date can change; later corrections are booked after it.">
        <div className="flex flex-wrap items-end gap-2">
          <Field label="Locked up to and including">
            <input type="date" value={lock} max={kenyaToday()} onChange={(e) => setLock(e.target.value)} className={fieldClass} />
          </Field>
          <button onClick={() => void saveLock()} disabled={!!busy} className={primaryBtn}><Lock size={15} /> Save</button>
          {report.lockDate && <button onClick={() => { setLock(''); }} className={secondaryBtn}>Clear</button>}
        </div>
      </Card>

      <Card title="Records that did not post" subtitle="A sale or payment is never held up by the books; if posting fails it is listed here.">
        {errors === null && <p className="text-sm text-app-text-muted">Loading…</p>}
        {errors && errors.length === 0 && <Note tone="ok">Everything is posted.</Note>}
        {errors && errors.length > 0 && (
          <>
            <div className="divide-y divide-app-border/60 mb-3">
              {errors.map((e) => (
                <div key={`${e.source}-${e.sourceId}`} className="py-2 text-[12px]">
                  <div className="text-app-text">{SOURCE_LABELS[e.source] || e.source} · {when(e.at)}</div>
                  <div className="text-app-text-muted break-words">{e.message}</div>
                </div>
              ))}
            </div>
            <button onClick={() => void retry()} disabled={!!busy} className={primaryBtn}><RotateCcw size={15} /> Try posting again</button>
          </>
        )}
      </Card>

      <Card title="Rebuild the books" subtitle="Redo all automatic entries. Use if the books look wrong.">
        <button onClick={() => void rebuild()} disabled={!!busy} className={secondaryBtn}>
          <BookOpen size={15} /> {busy && busy !== 'lock' && busy !== 'retry' ? busy : 'Rebuild'}
        </button>
        {report.firstDate && <p className="text-[11px] text-app-text-muted mt-2">The books start on {day(report.firstDate)}.</p>}
      </Card>
    </div>
  );
}
