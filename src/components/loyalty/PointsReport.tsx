// Loyalty points report: what is held and what it is worth, what was earned and used in a
// period, and who used points where. Points used to pay off debt cost the business on top of
// sales, so that figure is also taken off profit on the Home screen.
import React, { useEffect, useMemo, useState } from 'react';
import { RefreshCw, ArrowLeft, Coins, TrendingUp, ShoppingBag, CreditCard, Globe, Trash2, Medal } from 'lucide-react';
import { Segmented } from '../shared/Choice';
import { StatTile, StatGrid } from '../shared/StatTile';
import { getSupabase } from '../../services/supabaseClient';
import { toUuid } from '../../utils/idUtils';
import { formatCurrency } from '../../utils/helpers';
import { customerName } from '../../utils/stringUtils';
import { toUserMessage } from '../../utils/userError';
import type { Customer } from '../../types';
import { appDialog } from '../AppDialog';
import { deleteLogRows, useIsAdmin } from '../../services/logCleanup';
import { useNotificationStore } from '../../stores/notificationStore';
import { DEFAULT_POINT_SETTINGS, fetchPointSettings, pointValueFor, pointsPerShilling, PointSettings } from '../../services/loyalty/pointValue';

type Range = 'this_month' | 'last_month' | 'this_year' | 'all';
const RANGES: { id: Range; label: string }[] = [
  { id: 'this_month', label: 'Month' },
  { id: 'last_month', label: 'Last' },
  { id: 'this_year', label: 'Year' },
  { id: 'all', label: 'All' },
];

function rangeDates(r: Range): { from?: string; to?: string } {
  const now = new Date();
  const d = (y: number, m: number, day: number) => new Date(y, m, day).toISOString();
  if (r === 'this_month') return { from: d(now.getFullYear(), now.getMonth(), 1) };
  if (r === 'last_month') return { from: d(now.getFullYear(), now.getMonth() - 1, 1), to: d(now.getFullYear(), now.getMonth(), 1) };
  if (r === 'this_year') return { from: d(now.getFullYear(), 0, 1) };
  return {};
}

interface Redemption {
  id: string;
  customerId: string;
  points: number;
  value: number;
  kind: 'till' | 'online' | 'account';
  recordedBy: string;
  createdAt: string;
}

const KIND_LABEL: Record<Redemption['kind'], string> = {
  till: 'Off a sale at the till',
  online: 'Off an online order',
  account: 'Paid off debt',
};

export function PointsReport({ businessId, customers, onBack, onOpenCustomer, settings: settingsPanel }: {
  businessId: string;
  customers: Customer[];
  onBack?: () => void;
  onOpenCustomer: (id: string) => void;
  /** Points settings, for roles allowed to change them; shown under the heading. */
  settings?: React.ReactNode;
}) {
  const [range, setRange] = useState<Range>('this_month');
  const [settings, setSettings] = useState<PointSettings>(DEFAULT_POINT_SETTINGS);
  const [earned, setEarned] = useState<{ sale: number; debt: number }>({ sale: 0, debt: 0 });
  const [used, setUsed] = useState<Redemption[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState('');

  useEffect(() => {
    fetchPointSettings(businessId).then(setSettings);
  }, [businessId]);

  const load = React.useCallback(async () => {
    setState('loading');
    const { from, to } = rangeDates(range);
    const sb = getSupabase();
    try {
      let e = sb.from('loyalty_points_earned').select('points, source').eq('business_id', toUuid(businessId)).limit(20000);
      let u = sb
        .from('loyalty_redemptions')
        .select('id, customer_id, points, value, kind, recorded_by, created_at')
        .eq('business_id', toUuid(businessId))
        .is('refunded_at', null)
        .order('created_at', { ascending: false })
        .limit(2000);
      if (from) {
        e = e.gte('created_at', from);
        u = u.gte('created_at', from);
      }
      if (to) {
        e = e.lt('created_at', to);
        u = u.lt('created_at', to);
      }
      let [er, ur] = await Promise.all([e, u]);
      if (ur.error) {
        // Before the points migration there is no "kind" column: tell till, online and debt apart by their links.
        let plain = sb
          .from('loyalty_redemptions')
          .select('id, customer_id, points, value, recorded_by, created_at, transaction_id, order_id')
          .eq('business_id', toUuid(businessId))
          .is('refunded_at', null)
          .order('created_at', { ascending: false })
          .limit(2000);
        if (from) plain = plain.gte('created_at', from);
        if (to) plain = plain.lt('created_at', to);
        const retry: any = await plain;
        if (retry.error) throw ur.error;
        ur = { ...retry, data: (retry.data || []).map((r: any) => ({ ...r, kind: r.order_id ? 'online' : r.transaction_id ? 'till' : 'account' })) };
      }
      // Before the points migration there is no earnings log; earnings then show as 0.
      const rows = er.error ? [] : er.data || [];
      setEarned({
        sale: rows.filter((r: any) => r.source === 'sale').reduce((s: number, r: any) => s + (r.points || 0), 0),
        debt: rows.filter((r: any) => r.source === 'debt_payment').reduce((s: number, r: any) => s + (r.points || 0), 0),
      });
      setUsed(
        (ur.data || []).map((r: any) => ({
          id: r.id,
          customerId: r.customer_id,
          points: Number(r.points) || 0,
          value: Number(r.value) || 0,
          kind: (r.kind as Redemption['kind']) || 'account',
          recordedBy: r.recorded_by || '',
          createdAt: r.created_at,
        })),
      );
      setState('ready');
    } catch (err) {
      setError(toUserMessage(err, 'Could not load the points report.'));
      setState('error');
    }
  }, [businessId, range]);

  useEffect(() => {
    load();
  }, [load]);

  const byId = useMemo(() => new Map(customers.map((c) => [c.id, c])), [customers]);

  const isAdmin = useIsAdmin();
  const showToast = useNotificationStore((s) => s.showToast);
  /** Owners and admins can delete a "who used points" record. Balances don't change. */
  const deleteUse = async (r: Redemption) => {
    const ok = await appDialog.confirm({
      title: `Delete this record of ${r.points.toLocaleString()} points used?`,
      message: "Only the record goes: the customer's balance stays. It no longer counts in this report or in profit, and can't be refunded later.",
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (!ok) return;
    try {
      await deleteLogRows(businessId, 'points_used', [r.id]);
      setUsed((list) => list.filter((x) => x.id !== r.id));
      showToast('Deleted', 'Record deleted.', undefined, 'success');
    } catch (err) {
      showToast('Not deleted', toUserMessage(err, 'Could not delete. Check your connection.'), undefined, 'error');
    }
  };

  // Held now, by tier, at each tier's value.
  const held = useMemo(() => {
    const tiers = (['Bronze', 'Silver', 'Gold'] as const).map((tier) => {
      const list = customers.filter((c) => (c.tier || 'Bronze') === tier && (c.loyaltyPoints || 0) > 0);
      const points = list.reduce((s, c) => s + (c.loyaltyPoints || 0), 0);
      const value = pointValueFor(settings, tier);
      return { tier, customers: list.length, points, value, worth: points * value };
    });
    return { tiers, points: tiers.reduce((s, t) => s + t.points, 0), worth: tiers.reduce((s, t) => s + t.worth, 0) };
  }, [customers, settings]);

  const topHolders = useMemo(
    () =>
      [...customers]
        .filter((c) => (c.loyaltyPoints || 0) > 0)
        .sort((a, b) => (b.loyaltyPoints || 0) - (a.loyaltyPoints || 0))
        .slice(0, 8),
    [customers],
  );

  const usedTotals = useMemo(() => {
    const sum = (k?: Redemption['kind']) => used.filter((r) => !k || r.kind === k).reduce((s, r) => ({ points: s.points + r.points, value: s.value + r.value }), { points: 0, value: 0 });
    return { all: sum(), till: sum('till'), online: sum('online'), account: sum('account') };
  }, [used]);

  const TIER_TONE: Record<string, string> = {
    Bronze: 'bg-orange-500/15 text-orange-700 dark:text-orange-300',
    Silver: 'bg-slate-400/20 text-slate-600 dark:text-slate-300',
    Gold: 'bg-yellow-400/25 text-yellow-700 dark:text-yellow-300',
  };
  const maxTier = Math.max(1, ...held.tiers.map((t) => t.points));

  return (
    <div className="flex flex-col gap-3">
      {onBack && (
        <div className="flex items-center gap-2">
          <button onClick={onBack} aria-label="Back" className="p-2 -ml-2 rounded-xl hover:bg-app-card cursor-pointer lg:hidden">
            <ArrowLeft size={20} />
          </button>
          <h2 className="text-base font-semibold flex-1">Loyalty points</h2>
        </div>
      )}

      {settingsPanel}

      <div className="flex items-center gap-2">
        <Segmented<Range> options={RANGES} value={range} onChange={setRange} ariaLabel="Period" className="flex-1 bg-app-card" />
        <button onClick={load} aria-label="Refresh" className="grid place-items-center size-11 sm:size-10 shrink-0 rounded-xl bg-app-card ring-1 ring-app-border text-app-text-muted hover:text-app-text cursor-pointer">
          <RefreshCw size={16} className={state === 'loading' ? 'animate-spin' : ''} />
        </button>
      </div>

      {state === 'error' && <p className="p-3 rounded-xl bg-red-500/10 text-sm text-red-600 dark:text-red-400">{error}</p>}

      <StatGrid>
        <StatTile icon={<Coins />} tone="violet" label="Held now" value={held.points.toLocaleString()} note={`worth ${formatCurrency(held.worth)}`} />
        <StatTile icon={<TrendingUp />} tone="emerald" label="Earned" value={(earned.sale + earned.debt).toLocaleString()} note={`${earned.debt.toLocaleString()} on debt paid`} />
        <StatTile icon={<ShoppingBag />} tone="amber" label="Used" value={usedTotals.all.points.toLocaleString()} note={`worth ${formatCurrency(usedTotals.all.value)}`} />
        <StatTile icon={<CreditCard />} tone={usedTotals.account.value > 0 ? 'red' : 'slate'} label="Off profit" value={formatCurrency(usedTotals.account.value)} note="debt paid with points" />
      </StatGrid>

      <section className="rounded-2xl bg-app-card shadow-xs overflow-hidden">
        <h3 className="flex items-center gap-2 px-4 pt-3.5 pb-2 text-sm font-semibold"><Medal size={15} className="text-app-text-muted" /> By tier</h3>
        <ul className="divide-y divide-app-border/60">
          {held.tiers.map((t) => (
            <li key={t.tier} className="flex items-center gap-3 px-4 py-2.5 min-w-0">
              <span className={`inline-flex items-center gap-1 shrink-0 w-[4.75rem] justify-center rounded-full px-2 py-1 text-[11px] font-semibold ${TIER_TONE[t.tier]}`}><Medal size={11} /> {t.tier}</span>
              <div className="min-w-0 flex-1">
                <p className="text-[11px] text-app-text-muted truncate">{t.customers} customers · {pointsPerShilling(t.value)} pts/KSh</p>
                <div className="mt-1 h-1 rounded-full bg-app-bg overflow-hidden"><div className="h-full rounded-full bg-violet-500/70" style={{ width: `${Math.max(3, (t.points / maxTier) * 100)}%` }} /></div>
              </div>
              <div className="text-right shrink-0">
                <p className="text-sm font-semibold tabular-nums">{t.points.toLocaleString()}</p>
                <p className="text-[11px] text-app-text-muted tabular-nums">{formatCurrency(t.worth)}</p>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section className="rounded-2xl bg-app-card shadow-xs overflow-hidden">
        <h3 className="flex items-center gap-2 px-4 pt-3.5 pb-2 text-sm font-semibold"><ShoppingBag size={15} className="text-app-text-muted" /> Who used points</h3>
        {state === 'loading' ? (
          <div className="py-6 flex justify-center text-app-text-muted"><RefreshCw size={16} className="animate-spin" /></div>
        ) : used.length === 0 ? (
          <p className="px-4 pb-4 text-sm text-app-text-muted">No points were used in this period.</p>
        ) : (
          <ul className="divide-y divide-app-border/60">
            {used.map((r) => {
              const c = byId.get(r.customerId);
              const Icon = r.kind === 'account' ? CreditCard : r.kind === 'online' ? Globe : ShoppingBag;
              return (
                <li key={r.id} className="flex items-center">
                  <button type="button" onClick={() => c && onOpenCustomer(c.id)} className="flex-1 min-w-0 flex items-center gap-3 px-4 py-2.5 text-left hover:bg-app-bg cursor-pointer">
                    <span className={`size-8 rounded-lg grid place-items-center shrink-0 ${r.kind === 'account' ? 'bg-red-500/10 text-red-600 dark:text-red-400' : 'bg-amber-500/10 text-amber-600 dark:text-amber-400'}`}>
                      <Icon size={15} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium truncate">{c ? customerName(c.name) : 'Customer no longer listed'}</span>
                      <span className="block text-xs text-app-text-muted truncate">
                        {KIND_LABEL[r.kind]} · {new Date(r.createdAt).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                        {r.recordedBy ? ` · by ${r.recordedBy}` : ''}
                      </span>
                    </span>
                    <span className="text-right shrink-0">
                      <span className="block text-sm font-semibold tabular-nums">{r.points.toLocaleString()} pts</span>
                      <span className="block text-xs text-app-text-muted tabular-nums">{formatCurrency(r.value)}</span>
                    </span>
                  </button>
                  {isAdmin && (
                    <button
                      type="button"
                      onClick={() => void deleteUse(r)}
                      title="Delete this record"
                      aria-label="Delete this record"
                      className="shrink-0 p-2 mr-1 rounded-lg text-app-text-muted hover:text-red-500 hover:bg-app-bg cursor-pointer"
                    >
                      <Trash2 size={15} />
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="rounded-2xl bg-app-card shadow-xs overflow-hidden">
        <h3 className="flex items-center gap-2 px-4 pt-3.5 pb-2 text-sm font-semibold"><Coins size={15} className="text-app-text-muted" /> Most points held</h3>
        {topHolders.length === 0 ? (
          <p className="px-4 pb-4 text-sm text-app-text-muted">No customer has points yet.</p>
        ) : (
          <ul className="divide-y divide-app-border/60">
            {topHolders.map((c) => (
              <li key={c.id}>
                <button type="button" onClick={() => onOpenCustomer(c.id)} className="w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-app-bg cursor-pointer">
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium truncate">{customerName(c.name)}</span>
                    <span className="block text-xs text-app-text-muted">{c.tier || 'Bronze'}</span>
                  </span>
                  <span className="text-right shrink-0">
                    <span className="block text-sm font-semibold tabular-nums">{(c.loyaltyPoints || 0).toLocaleString()} pts</span>
                    <span className="block text-xs text-app-text-muted tabular-nums">{formatCurrency((c.loyaltyPoints || 0) * pointValueFor(settings, c.tier))}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

export default PointsReport;
