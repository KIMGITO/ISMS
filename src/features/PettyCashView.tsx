// Petty Cash: the cashier's book of money taken from the till to spend (boda, soap, tea).
// Each entry is saved as a cash expense, so it comes off the cash balance and shows on the
// Finances page. Staff see their own entries; managers see everyone's.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, Coins, Pencil, Plus, RotateCcw, Settings2, Trash2, X } from 'lucide-react';
import { getSupabase } from '../services/supabaseClient';
import { useBusinessStore } from '../stores/businessStore';
import { useAuthStore } from '../stores/authStore';
import { useNotificationStore } from '../stores/notificationStore';
import { hasRolePermission } from '../utils/permissions';
import { toUserMessage } from '../utils/userError';
import { toUuid } from '../utils/idUtils';
import SheetLayer from '../components/shared/SheetLayer';
import { SwipeRow } from '../components/shared/SwipeRow';
import { appDialog } from '../components/AppDialog';
import { isAdminRole } from '../services/logCleanup';
import { NumberInput } from '../components/shared/Input';
import { PayRiderButton } from '../components/RidersToPay';
import { formatMoney } from '../utils/money';

const TZ = 'Africa/Nairobi';
/** Used until the business's own list loads, or if it can't be loaded. Admins edit the list. */
export const PETTY_CASH_CATEGORIES = ['Transport', 'Cleaning', 'Food & tea', 'Repairs', 'Supplies', 'Airtime', 'Other'];

interface Category {
  id: string | null;
  name: string;
}

interface Entry {
  id: string;
  date: string;
  category: string;
  description: string;
  amount: number;
  staffName: string;
  receiptRef: string | null;
  mine: boolean;
  removed: boolean;
  removedBy: string | null;
  removedReason: string | null;
}

type Period = 'today' | 'week' | 'month';
const PERIODS: { id: Period; label: string }[] = [
  { id: 'today', label: 'Today' },
  { id: 'week', label: '7 days' },
  { id: 'month', label: '30 days' },
];

/** Start of today on the Kenya clock, as a real instant. */
function kenyaStartOfDay(daysBack = 0): Date {
  const key = new Date(Date.now() - daysBack * 864e5).toLocaleDateString('en-CA', { timeZone: TZ });
  return new Date(`${key}T00:00:00+03:00`);
}

const ksh = (n: number) => formatMoney(n);
const dayLabel = (iso: string) => {
  const key = new Date(iso).toLocaleDateString('en-CA', { timeZone: TZ });
  if (key === new Date().toLocaleDateString('en-CA', { timeZone: TZ })) return 'Today';
  if (key === new Date(Date.now() - 864e5).toLocaleDateString('en-CA', { timeZone: TZ })) return 'Yesterday';
  return new Date(iso).toLocaleDateString('en-KE', { weekday: 'short', day: 'numeric', month: 'short', timeZone: TZ });
};
const clock = (iso: string) => new Date(iso).toLocaleTimeString('en-KE', { hour: 'numeric', minute: '2-digit', timeZone: TZ });

export default function PettyCashView() {
  const businessId = useBusinessStore((s) => s.activeBusinessId);
  const role = useAuthStore((s) => s.currentEmployee?.role) || 'Guest';
  const showToast = useNotificationStore((s) => s.showToast);
  const seesAll = hasRolePermission(role, 'expenses.view') || hasRolePermission(role, 'finance.view');
  const canRemoveAny = hasRolePermission(role, 'expenses.delete');

  const [period, setPeriod] = useState<Period>('today');
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const isAdmin = isAdminRole(role);
  const [categories, setCategories] = useState<Category[]>(PETTY_CASH_CATEGORIES.map((name) => ({ id: null, name })));
  const [editingCats, setEditingCats] = useState(false);
  const [catDraft, setCatDraft] = useState('');
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const [catBusy, setCatBusy] = useState(false);

  const [amount, setAmount] = useState('');
  const [category, setCategory] = useState(PETTY_CASH_CATEGORIES[0]);

  const loadCategories = useCallback(async () => {
    if (!businessId) return;
    const { data, error } = await getSupabase()
      .from('petty_cash_categories')
      .select('id, name')
      .eq('business_id', toUuid(businessId))
      .order('sort_order')
      .order('name');
    // Before the categories migration (or offline): keep the built-in list.
    if (error || !data || data.length === 0) return;
    const list = data.map((r: any) => ({ id: r.id as string, name: r.name as string }));
    setCategories(list);
    setCategory((current) => (list.some((c) => c.name === current) ? current : list[0].name));
  }, [businessId]);

  useEffect(() => {
    void loadCategories();
  }, [loadCategories]);

  const saveCategory = async (id: string | null, name: string) => {
    if (!businessId || catBusy || !name.trim()) return false;
    setCatBusy(true);
    const { error } = await getSupabase().rpc('save_petty_cash_category', {
      p_business_id: toUuid(businessId),
      p_id: id,
      p_name: name.trim(),
    });
    setCatBusy(false);
    if (error) {
      showToast('Not saved', toUserMessage(error, 'Could not save. Check your connection.'), undefined, 'error');
      return false;
    }
    await loadCategories();
    if (id) void load(); // Renamed: past entries carry the new name.
    return true;
  };

  const removeCategory = async (c: Category) => {
    if (!businessId || !c.id || catBusy) return;
    const ok = await appDialog.confirm({
      title: `Remove "${c.name}"?`,
      message: 'It stops showing as a choice. Past entries keep it.',
      confirmLabel: 'Remove',
      destructive: true,
    });
    if (!ok) return;
    setCatBusy(true);
    const { error } = await getSupabase().rpc('delete_petty_cash_category', { p_business_id: toUuid(businessId), p_id: c.id });
    setCatBusy(false);
    if (error) {
      showToast('Not removed', toUserMessage(error, 'Could not remove. Check your connection.'), undefined, 'error');
      return;
    }
    await loadCategories();
  };
  const [description, setDescription] = useState('');
  const [receiptRef, setReceiptRef] = useState('');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [removing, setRemoving] = useState<Entry | null>(null);
  const [reason, setReason] = useState('');

  const load = useCallback(async () => {
    if (!businessId) return;
    setLoading(true);
    setLoadError(null);
    const start = kenyaStartOfDay(period === 'today' ? 0 : period === 'week' ? 6 : 29);
    const { data, error } = await getSupabase().rpc('list_petty_cash', {
      p_business_id: toUuid(businessId),
      p_start: start.toISOString(),
      p_end: new Date(Date.now() + 60_000).toISOString(),
    });
    setLoading(false);
    if (error) {
      setLoadError(toUserMessage(error, 'Could not load petty cash. Check your connection.'));
      return;
    }
    setEntries(
      (data || []).map((r: any) => ({
        id: r.id,
        date: r.date,
        category: r.category,
        description: r.description || '',
        amount: Number(r.amount) || 0,
        staffName: r.staff_name || '',
        receiptRef: r.receipt_ref,
        mine: !!r.mine,
        removed: !!r.removed,
        removedBy: r.removed_by,
        removedReason: r.removed_reason,
      })),
    );
  }, [businessId, period]);

  useEffect(() => {
    void load();
  }, [load]);

  const active = entries.filter((e) => !e.removed);
  const total = active.reduce((s, e) => s + e.amount, 0);
  const byCategory = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of active) m.set(e.category, (m.get(e.category) || 0) + e.amount);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [active]);

  const save = async (ev: React.FormEvent) => {
    ev.preventDefault();
    if (saving || !businessId) return;
    const value = Number(amount);
    if (!Number.isFinite(value) || value <= 0) return setFormError('Enter how much was spent.');
    if (!description.trim()) return setFormError('Say what the money was spent on.');
    setFormError(null);
    setSaving(true);
    const { error } = await getSupabase().rpc('record_petty_cash', {
      p_business_id: toUuid(businessId),
      p_amount: value,
      p_category: category,
      p_description: description.trim(),
      p_receipt_ref: receiptRef.trim() || null,
      p_reference_id: `pc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    });
    setSaving(false);
    if (error) {
      const msg = toUserMessage(error, 'Could not save. Check your connection and try again.');
      setFormError(msg);
      showToast('Petty cash not saved', msg, undefined, 'error');
      return;
    }
    showToast('Petty cash recorded', `${ksh(value)} for ${category.toLowerCase()} taken from the till.`, undefined, 'success');
    setAmount('');
    setDescription('');
    setReceiptRef('');
    void load();
  };

  const confirmRemove = async () => {
    if (!removing) return;
    if (!reason.trim()) return;
    const { error } = await getSupabase().rpc('remove_petty_cash', { p_expense_id: removing.id, p_reason: reason.trim() });
    if (error) {
      showToast('Not removed', toUserMessage(error, 'Could not remove the entry.'), undefined, 'error');
      return;
    }
    showToast('Entry removed', `${ksh(removing.amount)} is back in the cash count.`, undefined, 'success');
    setRemoving(null);
    setReason('');
    void load();
  };

  const canRemove = (e: Entry) =>
    !e.removed && (canRemoveAny || (e.mine && Date.now() - new Date(e.date).getTime() < 24 * 3600_000));

  const input = 'w-full bg-app-bg border border-app-border rounded-xl px-3 py-2.5 text-sm text-app-text focus:outline-none focus:ring-1 focus:ring-amber-500';

  return (
    <div className="h-full overflow-y-auto overflow-x-hidden bg-app-bg pb-nav">
      <div className="max-w-5xl mx-auto px-3 pt-3 sm:px-5 sm:pt-5 grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)] items-start">
        {/* Record */}
        <form onSubmit={save} className="bg-app-card rounded-2xl p-4 space-y-3 shadow-xs min-w-0">
          <div className="flex items-center gap-2">
            <span className="grid place-items-center size-9 rounded-full bg-amber-500/15 text-amber-600 dark:text-amber-400">
              <Coins size={18} />
            </span>
            <div>
              <h2 className="text-sm font-semibold text-app-text">Money taken from the till</h2>
              <p className="text-xs text-app-text-muted">It's deducted from the cash you count at the end of the shift.</p>
            </div>
          </div>

          <label className="block text-xs font-medium text-app-text-muted">
            Amount (KSh)
            <NumberInput
              min={0}
              value={amount}
              onChange={(v) => setAmount((v == null ? '' : String(v)))}
              placeholder="0" prefix="KSh" className="mt-1" inputClassName="text-lg font-semibold tabular-nums"
            />
          </label>

          <div>
            <div className="flex items-center justify-between gap-2 mb-1">
              <span className="text-xs font-medium text-app-text-muted">Spent on</span>
              {isAdmin && categories.some((c) => c.id) && (
                <button
                  type="button"
                  onClick={() => {
                    setEditingCats((v) => !v);
                    setRenaming(null);
                    setCatDraft('');
                  }}
                  title={editingCats ? 'Done editing' : 'Edit the choices'}
                  aria-label={editingCats ? 'Done editing the choices' : 'Edit the choices'}
                  className={`p-1.5 rounded-lg cursor-pointer ${editingCats ? 'bg-amber-500 text-slate-950' : 'text-app-text-muted hover:bg-app-bg'}`}
                >
                  {editingCats ? <Check size={14} /> : <Settings2 size={14} />}
                </button>
              )}
            </div>
            {!editingCats ? (
              <div className="flex gap-1.5 overflow-x-auto overscroll-x-contain -mx-4 px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                {categories.map((c) => (
                  <button
                    type="button"
                    key={c.name}
                    onClick={() => setCategory(c.name)}
                    aria-pressed={category === c.name}
                    className={`shrink-0 whitespace-nowrap px-3 py-1.5 rounded-full text-xs font-medium cursor-pointer ${category === c.name ? 'bg-amber-500 text-slate-950' : 'bg-app-bg text-app-text border border-app-border'}`}
                  >
                    {c.name}
                  </button>
                ))}
              </div>
            ) : (
              <div className="space-y-1.5">
                <ul className="rounded-xl border border-app-border divide-y divide-app-border">
                  {categories.map((c) => (
                    <li key={c.id ?? c.name} className="flex items-center gap-1.5 px-2 py-1.5">
                      {renaming && renaming.id === c.id ? (
                        <>
                          <input
                            autoFocus
                            value={renaming.name}
                            onChange={(e) => setRenaming({ id: renaming.id, name: e.target.value })}
                            onKeyDown={async (e) => {
                              if (e.key === 'Enter') {
                                e.preventDefault();
                                if (await saveCategory(renaming.id, renaming.name)) setRenaming(null);
                              } else if (e.key === 'Escape') setRenaming(null);
                            }}
                            maxLength={40}
                            aria-label="New name"
                            className="flex-1 min-w-0 bg-app-bg border border-app-border rounded-lg px-2 py-1.5 text-xs text-app-text focus:outline-none focus:ring-1 focus:ring-amber-500"
                          />
                          <button
                            type="button"
                            disabled={catBusy || !renaming.name.trim()}
                            onClick={async () => { if (await saveCategory(renaming.id, renaming.name)) setRenaming(null); }}
                            title="Save name"
                            aria-label="Save name"
                            className="p-1.5 rounded-lg text-emerald-600 dark:text-emerald-400 hover:bg-app-bg disabled:opacity-40 cursor-pointer"
                          >
                            <Check size={14} />
                          </button>
                          <button type="button" onClick={() => setRenaming(null)} title="Cancel" aria-label="Cancel" className="p-1.5 rounded-lg text-app-text-muted hover:bg-app-bg cursor-pointer">
                            <X size={14} />
                          </button>
                        </>
                      ) : (
                        <>
                          <span className="flex-1 min-w-0 truncate text-xs text-app-text">{c.name}</span>
                          <button
                            type="button"
                            disabled={!c.id || catBusy}
                            onClick={() => c.id && setRenaming({ id: c.id, name: c.name })}
                            title="Rename"
                            aria-label={`Rename ${c.name}`}
                            className="p-1.5 rounded-lg text-app-text-muted hover:bg-app-bg disabled:opacity-40 cursor-pointer"
                          >
                            <Pencil size={13} />
                          </button>
                          <button
                            type="button"
                            disabled={!c.id || catBusy || categories.length <= 1}
                            onClick={() => void removeCategory(c)}
                            title="Remove"
                            aria-label={`Remove ${c.name}`}
                            className="p-1.5 rounded-lg text-app-text-muted hover:text-red-500 hover:bg-app-bg disabled:opacity-40 cursor-pointer"
                          >
                            <Trash2 size={13} />
                          </button>
                        </>
                      )}
                    </li>
                  ))}
                </ul>
                <div className="flex items-center gap-1.5">
                  <input
                    value={catDraft}
                    onChange={(e) => setCatDraft(e.target.value)}
                    onKeyDown={async (e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        if (await saveCategory(null, catDraft)) setCatDraft('');
                      }
                    }}
                    maxLength={40}
                    placeholder="New choice, e.g. Fuel"
                    aria-label="New choice"
                    className={`${input} py-2 text-xs`}
                  />
                  <button
                    type="button"
                    disabled={catBusy || !catDraft.trim()}
                    onClick={async () => { if (await saveCategory(null, catDraft)) setCatDraft(''); }}
                    title="Add choice"
                    aria-label="Add choice"
                    className="shrink-0 grid place-items-center size-9 rounded-xl bg-amber-500 text-slate-950 disabled:opacity-50 cursor-pointer"
                  >
                    <Plus size={16} />
                  </button>
                </div>
                <p className="text-[11px] text-app-text-muted">Renaming changes past entries too.</p>
              </div>
            )}
          </div>

          <label className="block text-xs font-medium text-app-text-muted">
            What exactly
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="e.g. Boda to pick milk cans"
              maxLength={200}
              className={`${input} mt-1`}
            />
          </label>

          <label className="block text-xs font-medium text-app-text-muted">
            Receipt or M-Pesa code (optional)
            <input type="text" value={receiptRef} onChange={(e) => setReceiptRef(e.target.value)} maxLength={60} className={`${input} mt-1`} />
          </label>

          {formError && <p className="text-xs text-red-600 dark:text-red-400">{formError}</p>}

          <button
            type="submit"
            disabled={saving}
            className="w-full flex items-center justify-center gap-2 bg-amber-500 hover:bg-amber-600 disabled:opacity-60 text-slate-950 font-semibold text-sm rounded-xl py-3 cursor-pointer"
          >
            <Plus size={16} /> {saving ? 'Saving…' : 'Record spending'}
          </button>
          {businessId && (
            <PayRiderButton
              businessId={businessId}
              canPettyCash
              canAccount={hasRolePermission(role, 'expenses.create')}
              canRemove={canRemoveAny}
              defaultFrom="petty_cash"
              onPaid={() => void load()}
              onToast={showToast}
              className="w-full flex items-center justify-center gap-2 bg-app-bg ring-1 ring-app-border text-app-text font-medium text-sm rounded-xl py-2.5 cursor-pointer"
            />
          )}
        </form>

        {/* Book */}
        <section className="bg-app-card rounded-2xl shadow-xs min-w-0">
          <div className="p-4 border-b border-app-border space-y-3">
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div>
                <h2 className="text-sm font-semibold text-app-text">{seesAll ? 'Petty cashbook' : 'My petty cash'}</h2>
                <p className="text-2xl font-bold text-app-text tabular-nums mt-0.5">{ksh(total)}</p>
                <p className="text-xs text-app-text-muted">
                  {active.length} {active.length === 1 ? 'entry' : 'entries'} · {PERIODS.find((p) => p.id === period)!.label.toLowerCase()}
                </p>
              </div>
              <div className="flex bg-app-bg rounded-xl p-1 border border-app-border">
                {PERIODS.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => setPeriod(p.id)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer ${period === p.id ? 'bg-amber-500 text-slate-950' : 'text-app-text-muted'}`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>
            {byCategory.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {byCategory.map(([c, v]) => (
                  <span key={c} className="px-2 py-1 rounded-lg bg-app-bg text-[11px] text-app-text">
                    {c} <span className="font-semibold tabular-nums">{ksh(v)}</span>
                  </span>
                ))}
              </div>
            )}
          </div>

          {loading ? (
            <p className="p-6 text-sm text-app-text-muted text-center">Loading…</p>
          ) : loadError ? (
            <div className="p-6 text-center space-y-2">
              <p className="text-sm text-red-600 dark:text-red-400">{loadError}</p>
              <button onClick={() => void load()} className="inline-flex items-center gap-1.5 text-sm text-app-text underline cursor-pointer">
                <RotateCcw size={14} /> Try again
              </button>
            </div>
          ) : entries.length === 0 ? (
            <p className="p-6 text-sm text-app-text-muted text-center">Nothing spent from the till in this period.</p>
          ) : (
            <ul className="divide-y divide-app-border">
              {entries.map((e) => (
                <SwipeRow
                  key={e.id}
                  as="li"
                  title={`${ksh(e.amount)} · ${e.category}`}
                  subtitle={e.description || undefined}
                  disabled={!canRemove(e)}
                  actions={[{ label: 'Remove', icon: <Trash2 size={18} />, tone: 'red', onClick: () => { setRemoving(e); setReason(''); } }]}
                  contentClassName={`flex items-start gap-3 px-4 py-3 ${e.removed ? 'opacity-55' : ''}`}
                >
                  <div className="min-w-0 flex-1">
                    <p className={`text-sm font-medium text-app-text break-words ${e.removed ? 'line-through' : ''}`}>{e.description || e.category}</p>
                    <p className="text-[11px] text-app-text-muted mt-0.5 break-words">
                      {e.category} · {dayLabel(e.date)} {clock(e.date)}
                      {seesAll && e.staffName ? ` · ${e.staffName}` : ''}
                      {e.receiptRef ? ` · ${e.receiptRef}` : ''}
                    </p>
                    {e.removed && (
                      <p className="text-[11px] text-app-text-muted mt-0.5">
                        Removed by {e.removedBy || 'staff'}: {e.removedReason}
                      </p>
                    )}
                  </div>
                  <span className="text-sm font-semibold text-app-text tabular-nums shrink-0">{ksh(e.amount)}</span>
                  {canRemove(e) && (
                    <button
                      onClick={() => {
                        setRemoving(e);
                        setReason('');
                      }}
                      title="Remove this entry"
                      aria-label="Remove this entry"
                      className="p-1.5 rounded-lg text-app-text-muted hover:text-red-500 hover:bg-app-bg cursor-pointer shrink-0"
                    >
                      <Trash2 size={15} />
                    </button>
                  )}
                </SwipeRow>
              ))}
            </ul>
          )}
        </section>
      </div>

      {removing && (
        <SheetLayer>
        <div className="fixed inset-0 z-[9000] grid place-items-center p-4 bg-black/40" onClick={() => setRemoving(null)}>
          <div className="w-full max-w-sm bg-app-card rounded-2xl p-4 space-y-3" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-sm font-semibold text-app-text">Remove {ksh(removing.amount)} for {removing.category.toLowerCase()}?</h3>
            <p className="text-xs text-app-text-muted">The money goes back in the till.</p>
            <input autoFocus value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why? e.g. typed the wrong amount" className={input} />
            <div className="flex gap-2 justify-end">
              <button onClick={() => setRemoving(null)} className="px-4 py-2 rounded-xl text-sm text-app-text bg-app-bg cursor-pointer">Keep</button>
              <button
                onClick={() => void confirmRemove()}
                disabled={!reason.trim()}
                className="px-4 py-2 rounded-xl text-sm font-semibold bg-red-600 text-white disabled:opacity-50 cursor-pointer"
              >
                Remove
              </button>
            </div>
          </div>
        </div>
        </SheetLayer>
      )}
    </div>
  );
}
