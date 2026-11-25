// Payments & Expenses → Expenses: what the business spent, by day, with totals for today,
// this week and this month and where most of it went. "Record expense" (N) opens a short
// form; the person signed in is recorded as who spent it. Owners delete (swipe or hold).
import React, { useEffect, useMemo, useState } from 'react';
import { NumberInput } from '../shared/Input';
import { Plus, Receipt, Search, Trash2, X } from 'lucide-react';
import { useAppStore } from '../../stores/appStore';
import { useBusinessStore } from '../../stores/businessStore';
import { hasRolePermission } from '../../utils/permissions';
import { toUserMessage } from '../../utils/userError';
import { formatCurrency } from '../../utils/helpers';
import { methodLabel } from '../../utils/paymentMethods';
import { usePaymentMethods } from '../../hooks/usePaymentMethods';
import { FormSheet, Field, fieldClass, primaryBtn, secondaryBtn } from '../shared/FormSheet';
import { SwipeRow } from '../shared/SwipeRow';
import SearchableDropdown from '../SearchableDropdown';
import { confirmDelete } from '../DeleteImpact';
import type { Expense, ExpenseCategory, MoneyMethod } from '../../types';
import { PayRiderButton } from '../RidersToPay';
import { loadRiderPayOwed, spendingWithRiderPay } from '../../services/riderPay';
import { CopyRef } from '../shared/CopyRef';
import { useUiStore } from '../../stores/uiStore';

const DEFAULT_CATEGORIES = ['Rent', 'Wages', 'Transport', 'Utilities', 'Maintenance', 'Marketing', 'Supplies', 'Other'];
type Period = 'month' | 'last-month' | 'all';
const PERIODS: { id: Period; label: string }[] = [
  { id: 'month', label: 'This month' },
  { id: 'last-month', label: 'Last month' },
  { id: 'all', label: 'All' },
];

const nairobiDay = (d: Date | string) => new Date(d).toLocaleDateString('en-CA', { timeZone: 'Africa/Nairobi' });
const dayHeading = (iso: string) => {
  const today = nairobiDay(new Date());
  const yesterday = nairobiDay(new Date(Date.now() - 86400000));
  if (iso === today) return 'Today';
  if (iso === yesterday) return 'Yesterday';
  return new Date(`${iso}T12:00:00`).toLocaleDateString('en-KE', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
};

export default function ExpensesPanel() {
  const { showToast, currentEmployee } = useAppStore();
  const businessId = useBusinessStore((s) => s.activeBusinessId);
  const role = currentEmployee?.role || 'Guest';
  const canRecord = hasRolePermission(role, 'expenses.create' as any);
  const canDelete = role === 'Owner';
  const methods = usePaymentMethods();

  // Stored expenses (rider payments included, as the money that left).
  const [stored, setStored] = useState<Expense[]>([]);
  // Rider pay owed, counted on the delivery's day (20261130004).
  const [riderOwed, setRiderOwed] = useState<Expense[]>([]);
  const [owedTick, setOwedTick] = useState(0);
  // Spending as the books count it: rider pay on the day it's owed, not when paid.
  const expenses = useMemo(() => spendingWithRiderPay(stored, riderOwed), [stored, riderOwed]);
  const [categories, setCategories] = useState<ExpenseCategory[]>([]);
  const [period, setPeriod] = useState<Period>('month');
  const [category, setCategory] = useState<string>('all');
  const [query, setQuery] = useState('');
  const [formOpen, setFormOpen] = useState(false);

  useEffect(() => {
    if (!businessId) return;
    let unsubExp: (() => void) | undefined;
    let unsubCat: (() => void) | undefined;
    import('../../services/repositories').then((mod) => {
      unsubExp = mod.ExpenseRepository.subscribe((rows: Expense[]) => { setStored(rows); setOwedTick((t) => t + 1); });
      unsubCat = mod.ExpenseCategoryRepository.subscribe((rows: ExpenseCategory[]) => setCategories(rows));
    }).catch((err) => console.error('Could not load expenses', err));
    return () => { unsubExp?.(); unsubCat?.(); };
  }, [businessId]);

  // Opened from search on one expense: show every period and category so its row is there
  // (search then highlights it). One older than the loaded list is fetched and added.
  const searchTarget = useUiStore((st) => st.searchTarget);
  useEffect(() => {
    if (searchTarget?.kind !== 'expense') return;
    const id = searchTarget.id;
    useUiStore.getState().setSearchTarget(null);
    setPeriod('all');
    setCategory('all');
    setQuery('');
    if (stored.some((e) => e.id === id)) return;
    import('../../services/repositories')
      .then(({ ExpenseRepository }) => ExpenseRepository.getAll([id]))
      .then((rows) => {
        if (rows[0]) setStored((list) => (list.some((e) => e.id === id) ? list : [...list, rows[0] as Expense]));
        else showToast('Not found', 'That expense may have been deleted.', undefined, 'info');
      })
      .catch(() => showToast('Could not open it', 'Check your connection and try again.', undefined, 'error'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchTarget]);

  useEffect(() => {
    if (!businessId) return;
    let live = true;
    loadRiderPayOwed(businessId).then((rows) => { if (live) setRiderOwed(rows); }).catch((err) => console.error('Could not load rider pay', err));
    return () => { live = false; };
  }, [businessId, owedTick]);

  const categoryNames = useMemo(
    () => (categories.length ? categories.filter((c) => c.status === 'Enabled').map((c) => c.name) : DEFAULT_CATEGORIES),
    [categories],
  );

  // ---------- totals (always for the current month and week, whatever the filter)
  const today = nairobiDay(new Date());
  const monthKey = today.slice(0, 7);
  const lastMonthKey = nairobiDay(new Date(Date.parse(`${monthKey}-01T12:00:00`) - 86400000)).slice(0, 7);
  const weekStart = (() => {
    const d = new Date(`${today}T12:00:00`);
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); // Monday
    return nairobiDay(d);
  })();
  const sum = (rows: Expense[]) => rows.reduce((s, e) => s + (Number(e.amount) || 0), 0);
  const thisMonth = expenses.filter((e) => nairobiDay(e.date).startsWith(monthKey));
  const lastMonth = expenses.filter((e) => nairobiDay(e.date).startsWith(lastMonthKey));
  const totals = {
    today: sum(expenses.filter((e) => nairobiDay(e.date) === today)),
    week: sum(expenses.filter((e) => nairobiDay(e.date) >= weekStart)),
    month: sum(thisMonth),
    lastMonth: sum(lastMonth),
  };
  const byCategory = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of thisMonth) m.set(e.category, (m.get(e.category) || 0) + (Number(e.amount) || 0));
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [expenses, monthKey]);

  // ---------- the list
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return expenses
      .filter((e) => period === 'all' || nairobiDay(e.date).startsWith(period === 'month' ? monthKey : lastMonthKey))
      .filter((e) => category === 'all' || e.category === category)
      .filter((e) => !q || [e.category, e.description, e.staffName, e.paymentMethod || '', e.refNo || ''].some((v) => (v || '').toLowerCase().includes(q)))
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [expenses, period, category, query, monthKey, lastMonthKey]);
  const days = useMemo(() => {
    const groups = new Map<string, Expense[]>();
    for (const e of shown) {
      const d = nairobiDay(e.date);
      groups.set(d, [...(groups.get(d) || []), e]);
    }
    return [...groups.entries()];
  }, [shown]);

  const remove = async (e: Expense) => {
    if (!canDelete) return;
    const ok = await confirmDelete({ kind: 'expense', id: e.id, name: `${e.category} ${formatCurrency(e.amount)}` });
    if (!ok) return;
    try {
      const { ExpenseRepository } = await import('../../services/repositories');
      await ExpenseRepository.delete(e.id);
      showToast('Deleted', 'Expense deleted.', undefined, 'success');
    } catch (err) {
      showToast('Not deleted', toUserMessage(err, 'Could not delete the expense.'), undefined, 'error');
    }
  };

  const monthChange = totals.lastMonth ? Math.round(((totals.month - totals.lastMonth) / totals.lastMonth) * 100) : null;

  return (
    <div className="space-y-4">
      {/* Totals */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { label: 'Today', value: totals.today },
          { label: 'This week', value: totals.week },
          { label: 'This month', value: totals.month, note: monthChange === null ? undefined : `${monthChange >= 0 ? '+' : ''}${monthChange}% vs last month` },
          { label: 'Most spent on', value: byCategory[0]?.[1] ?? 0, note: byCategory[0]?.[0] ?? 'Nothing yet this month' },
        ].map((t) => (
          <div key={t.label} className="bg-app-card border border-app-border rounded-2xl p-3.5 min-w-0">
            <div className="text-[11px] text-app-text-muted">{t.label}</div>
            <div className="text-base font-semibold tabular-nums text-app-text truncate">{formatCurrency(t.value)}</div>
            {t.note && <div className="text-[10px] text-app-text-muted truncate">{t.note}</div>}
          </div>
        ))}
      </div>

      {/* Where this month's money went */}
      {byCategory.length > 1 && (
        <div className="bg-app-card border border-app-border rounded-2xl p-3.5">
          <div className="text-[11px] text-app-text-muted mb-2">This month by category</div>
          <div className="flex h-2 w-full overflow-hidden rounded-full bg-app-bg">
            {byCategory.map(([name, amount], i) => (
              <div key={name} title={`${name}: ${formatCurrency(amount)}`} style={{ width: `${(amount / totals.month) * 100}%`, opacity: 1 - i * 0.12 }} className="bg-amber-500 border-r border-app-card last:border-r-0" />
            ))}
          </div>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
            {byCategory.slice(0, 6).map(([name, amount]) => (
              <button key={name} type="button" onClick={() => { setCategory(name); setPeriod('month'); }} className="text-[11px] text-app-text-muted hover:text-app-text cursor-pointer">
                {name} <span className="font-semibold text-app-text tabular-nums">{formatCurrency(amount)}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Toolbar */}
      <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
        <div className="relative flex-1 min-w-0">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-app-text-muted" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search expenses"
            className="w-full bg-app-card border border-app-border rounded-xl pl-8 pr-3 py-2 text-xs text-app-text focus:outline-none focus:ring-1 focus:ring-amber-500"
          />
        </div>
        <div className="flex gap-1 rounded-xl bg-app-card p-1 ring-1 ring-app-border shrink-0">
          {PERIODS.map((p) => (
            <button key={p.id} type="button" onClick={() => setPeriod(p.id)} className={`px-3 py-1.5 rounded-lg text-[11px] font-medium cursor-pointer ${period === p.id ? 'bg-amber-500/15 text-amber-700 dark:text-amber-300' : 'text-app-text-muted hover:text-app-text'}`}>
              {p.label}
            </button>
          ))}
        </div>
        <div className="w-full sm:w-44 shrink-0">
          <SearchableDropdown
            items={[{ id: 'all', label: 'All categories' }, ...categoryNames.map((c) => ({ id: c, label: c }))]}
            selectedValue={category}
            onChange={setCategory}
            placeholder="All categories"
          />
        </div>
        {canRecord && businessId && (
          <PayRiderButton
            businessId={businessId}
            canPettyCash={hasRolePermission(role, 'pettycash.record' as any)}
            canAccount
            canRemove={hasRolePermission(role, 'expenses.delete' as any)}
            onPaid={() => setOwedTick((t) => t + 1)}
            defaultFrom="account"
            onToast={showToast}
          />
        )}
        {canRecord && (
          <button type="button" data-shortcut="new" onClick={() => setFormOpen(true)} className={`${primaryBtn} shrink-0`}>
            <Plus size={15} /> Record expense
          </button>
        )}
      </div>

      {/* By day */}
      {days.length === 0 ? (
        <div className="p-10 bg-app-card rounded-2xl border border-dashed border-app-border text-center text-xs text-app-text-muted flex flex-col items-center gap-2">
          <Receipt size={22} />
          {expenses.length === 0 ? 'No expenses yet. Record rent, wages, transport and other costs here so profit is right.' : 'No expenses match.'}
        </div>
      ) : (
        <div className="space-y-4">
          {days.map(([d, rows]) => (
            <section key={d}>
              <div className="flex items-baseline justify-between px-1 pb-1.5">
                <h4 className="text-xs font-semibold text-app-text-muted">{dayHeading(d)}</h4>
                <span className="text-xs font-semibold tabular-nums text-app-text">{formatCurrency(sum(rows))}</span>
              </div>
              <ul className="bg-app-card border border-app-border rounded-2xl divide-y divide-app-border/60 overflow-hidden">
                {rows.map((e) => (
                  <SwipeRow
                    key={e.id}
                    as="li"
                    searchId={`exp-${e.id}`}
                    title={`${e.category} · ${formatCurrency(e.amount)}`}
                    subtitle={e.description || undefined}
                    disabled={!canDelete || e.riderOwed}
                    actions={[{ label: 'Delete', icon: <Trash2 size={18} />, tone: 'red', onClick: () => void remove(e) }]}
                    more={[{ label: 'Delete expense', icon: <Trash2 size={16} />, tone: 'red', hidden: !canDelete || !!e.riderOwed, onClick: () => void remove(e) }]}
                    contentClassName="flex items-center gap-3 px-3.5 py-3"
                  >
                    <span className="shrink-0 w-9 h-9 rounded-xl bg-amber-500/10 text-amber-600 dark:text-amber-400 grid place-items-center text-xs font-bold">
                      {e.category.slice(0, 2).toUpperCase()}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-app-text truncate">{e.description || e.category}</p>
                      <p className="flex items-center gap-1.5 min-w-0 text-[11px] text-app-text-muted">
                        <span className="truncate">{[e.description ? e.category : '', e.paymentMethod ? methodLabel(e.paymentMethod as MoneyMethod) : '', e.staffName].filter(Boolean).join(' · ')}</span>
                        {e.refNo && <CopyRef value={e.refNo} label="expense" className="shrink-0" />}
                      </p>
                    </div>
                    <span className="shrink-0 text-sm font-semibold tabular-nums text-red-600 dark:text-red-400">{formatCurrency(e.amount)}</span>
                    {canDelete && !e.riderOwed && (
                      <button type="button" onClick={(ev) => { ev.stopPropagation(); void remove(e); }} aria-label="Delete expense" className="hidden md:inline-flex p-1.5 rounded-lg text-app-text-muted hover:text-red-500 hover:bg-red-500/10 cursor-pointer">
                        <Trash2 size={14} />
                      </button>
                    )}
                  </SwipeRow>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}

      {formOpen && (
        <ExpenseForm
          categories={categoryNames}
          methods={methods}
          onAddCategory={async (name) => {
            const { ExpenseCategoryRepository } = await import('../../services/repositories');
            const created = await ExpenseCategoryRepository.add({ name, status: 'Enabled', isCustom: true, businessId: businessId! });
            setCategories((c) => [...c, created]);
            return created.name;
          }}
          onSave={async (draft) => {
            const { ExpenseRepository } = await import('../../services/repositories');
            await ExpenseRepository.add({
              ...draft,
              categoryId: categories.find((c) => c.name === draft.category)?.id,
              staffName: currentEmployee?.name || 'Staff',
              businessId: businessId!,
            } as any);
            showToast('Expense recorded', `${draft.category} · ${formatCurrency(draft.amount)}`, undefined, 'success');
          }}
          canAddCategory={canRecord}
          onClose={() => setFormOpen(false)}
        />
      )}
    </div>
  );
}

function ExpenseForm({ categories, methods, canAddCategory, onAddCategory, onSave, onClose }: {
  categories: string[];
  methods: MoneyMethod[];
  canAddCategory: boolean;
  onAddCategory: (name: string) => Promise<string>;
  onSave: (d: { amount: number; category: string; description: string; date: string; paymentMethod: MoneyMethod }) => Promise<void>;
  onClose: () => void;
}) {
  const [amount, setAmount] = useState('');
  const [category, setCategory] = useState(categories[0] || 'Other');
  const [method, setMethod] = useState<MoneyMethod>(methods.includes('Cash') ? 'Cash' : methods[0] || 'Cash');
  const [date, setDate] = useState(nairobiDay(new Date()));
  const [note, setNote] = useState('');
  const [newCategory, setNewCategory] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async (andAnother: boolean) => {
    const value = Number(amount);
    if (!(value > 0)) return setError('Enter an amount above zero.');
    setBusy(true);
    setError(null);
    try {
      // Noon in Nairobi, so the expense stays on the chosen day in every time zone.
      await onSave({ amount: value, category, description: note.trim(), date: new Date(`${date}T12:00:00+03:00`).toISOString(), paymentMethod: method });
      if (andAnother) {
        setAmount('');
        setNote('');
      } else onClose();
    } catch (err) {
      setError(toUserMessage(err, 'Could not save the expense.'));
    } finally {
      setBusy(false);
    }
  };

  const addCategory = async () => {
    const name = (newCategory || '').trim();
    if (!name) return;
    const existing = categories.find((c) => c.toLowerCase() === name.toLowerCase());
    try {
      setCategory(existing || (await onAddCategory(name)));
      setNewCategory(null);
    } catch (err) {
      setError(toUserMessage(err, 'Could not add the category.'));
    }
  };

  return (
    <FormSheet
      title="Record an expense"
      subtitle="Money the business spent: rent, wages, transport, bills"
      onClose={onClose}
      footer={
        <>
          <button type="button" className={`${secondaryBtn} mr-auto`} disabled={busy} onClick={() => void save(true)}>Save and add another</button>
          <button type="button" className={secondaryBtn} disabled={busy} onClick={onClose}>Cancel</button>
          <button type="button" className={primaryBtn} disabled={busy} onClick={() => void save(false)}>{busy ? 'Saving…' : 'Save'}</button>
        </>
      }
    >
      <Field label="Amount (KSh)">
        <NumberInput
          autoFocus
          value={amount}
          onChange={(n) => setAmount(n == null ? '' : String(n))}
          min={0}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void save(false); } }}
          placeholder="0"
          inputClassName="text-lg font-semibold tabular-nums"
        />
      </Field>
      <Field label="Category">
        <div className="flex flex-wrap gap-1.5">
          {categories.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setCategory(c)}
              className={`px-3 py-1.5 rounded-full text-xs ring-1 cursor-pointer ${category === c ? 'bg-amber-500/15 text-amber-700 dark:text-amber-300 ring-amber-500/40 font-semibold' : 'bg-app-bg text-app-text ring-app-border'}`}
            >
              {c}
            </button>
          ))}
          {canAddCategory && newCategory === null && (
            <button type="button" onClick={() => setNewCategory('')} className="px-3 py-1.5 rounded-full text-xs text-amber-600 dark:text-amber-400 ring-1 ring-dashed ring-amber-500/40 cursor-pointer inline-flex items-center gap-1">
              <Plus size={12} /> New
            </button>
          )}
        </div>
        {newCategory !== null && (
          <div className="flex gap-2 mt-2">
            <input
              autoFocus
              value={newCategory}
              onChange={(e) => setNewCategory(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void addCategory(); } if (e.key === 'Escape') setNewCategory(null); }}
              placeholder="New category name"
              maxLength={40}
              className={fieldClass}
            />
            <button type="button" className={primaryBtn} onClick={() => void addCategory()} disabled={!newCategory.trim()}>Add</button>
            <button type="button" className={secondaryBtn} onClick={() => setNewCategory(null)} aria-label="Cancel"><X size={14} /></button>
          </div>
        )}
      </Field>
      <Field label="Paid with">
        <div className="flex flex-wrap gap-1.5">
          {methods.map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMethod(m)}
              className={`px-3 py-1.5 rounded-xl text-xs ring-1 cursor-pointer ${method === m ? 'bg-amber-500/15 text-amber-700 dark:text-amber-300 ring-amber-500/40 font-semibold' : 'bg-app-bg text-app-text ring-app-border'}`}
            >
              {methodLabel(m)}
            </button>
          ))}
        </div>
      </Field>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Date">
          <input type="date" value={date} max={nairobiDay(new Date())} onChange={(e) => setDate(e.target.value)} className={fieldClass} />
        </Field>
        <Field label="What for (optional)">
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Fuel for deliveries" maxLength={200} className={fieldClass} />
        </Field>
      </div>
      {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
    </FormSheet>
  );
}
