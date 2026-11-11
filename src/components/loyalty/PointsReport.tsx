// Loyalty points report: what is held and what it is worth, what was earned and used in a
// period, and who used points where. Points used to pay off debt cost the business on top of
// sales, so that figure is also taken off profit on the Home screen.
import React, { useEffect, useMemo, useState } from 'react';
import { Gift, RefreshCw, ArrowLeft, Coins, TrendingUp, ShoppingBag, CreditCard, Globe } from 'lucide-react';
import { getSupabase } from '../../services/supabaseClient';
import { toUuid } from '../../utils/idUtils';
import { formatCurrency } from '../../utils/helpers';
import { customerName } from '../../utils/stringUtils';
import { toUserMessage } from '../../utils/userError';
import type { Customer } from '../../types';
import { DEFAULT_POINT_SETTINGS, fetchPointSettings, pointValueFor, pointsPerShilling, PointSettings } from '../../services/loyalty/pointValue';

type Range = 'this_month' | 'last_month' | 'this_year' | 'all';
const RANGES: { id: Range; label: string }[] = [
  { id: 'this_month', label: 'This month' },
  { id: 'last_month', label: 'Last month' },
  { id: 'this_year', label: 'This year' },
  { id: 'all', label: 'All time' },
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

  const tile = 'rounded-xl bg-app-bg p-3 min-w-0';

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        {onBack && (
          <button onClick={onBack} aria-label="Back" className="p-2 -ml-2 rounded-xl hover:bg-app-card cursor-pointer lg:hidden">
            <ArrowLeft size={20} />
          </button>
        )}
        <div className="size-9 rounded-xl bg-amber-500/10 text-amber-600 dark:text-amber-400 grid place-items-center shrink-0">
          <Gift size={18} />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-semibold">Loyalty points</h2>
          <p className="text-xs text-app-text-muted">A reward inside the app, worth money but never recorded as cash or M-Pesa.</p>
        </div>
        <button onClick={load} aria-label="Refresh" className="p-2 rounded-xl hover:bg-app-card text-app-text-muted cursor-pointer">
          <RefreshCw size={16} className={state === 'loading' ? 'animate-spin' : ''} />
        </button>
      </div>

      {settingsPanel}

      <div className="flex gap-1.5 overflow-x-auto scrollbar-none" role="radiogroup" aria-label="Period">
        {RANGES.map((r) => (
          <button
            key={r.id}
            role="radio"
            aria-checked={range === r.id}
            onClick={() => setRange(r.id)}
            className={`shrink-0 px-3 py-1.5 rounded-full text-[13px] font-medium cursor-pointer ${range === r.id ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900' : 'bg-app-card ring-1 ring-app-border'}`}
          >
            {r.label}
          </button>
        ))}
      </div>

      {state === 'error' && <p className="p-3 rounded-xl bg-red-500/10 text-sm text-red-600 dark:text-red-400">{error}</p>}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
        <div className={tile}>
          <div className="text-xs text-app-text-muted flex items-center gap-1"><Coins size={12} /> Held by customers now</div>
          <div className="text-lg font-semibold tabular-nums">{held.points.toLocaleString()}</div>
          <div className="text-xs text-app-text-muted">worth {formatCurrency(held.worth)}</div>
        </div>
        <div className={tile}>
          <div className="text-xs text-app-text-muted flex items-center gap-1"><TrendingUp size={12} /> Earned</div>
          <div className="text-lg font-semibold tabular-nums">{(earned.sale + earned.debt).toLocaleString()}</div>
          <div className="text-xs text-app-text-muted">{earned.sale.toLocaleString()} on sales · {earned.debt.toLocaleString()} on debt paid</div>
        </div>
        <div className={tile}>
          <div className="text-xs text-app-text-muted flex items-center gap-1"><ShoppingBag size={12} /> Used</div>
          <div className="text-lg font-semibold tabular-nums">{usedTotals.all.points.toLocaleString()}</div>
          <div className="text-xs text-app-text-muted">worth {formatCurrency(usedTotals.all.value)}</div>
        </div>
        <div className={`${tile} ${usedTotals.account.value > 0 ? 'bg-red-500/10' : ''}`}>
          <div className="text-xs text-app-text-muted flex items-center gap-1"><CreditCard size={12} /> Taken off profit</div>
          <div className="text-lg font-semibold tabular-nums text-red-600 dark:text-red-400">{formatCurrency(usedTotals.account.value)}</div>
          <div className="text-xs text-app-text-muted">debt paid with points</div>
        </div>
      </div>
      <p className="text-xs text-app-text-muted -mt-2">
        Points used at the till ({formatCurrency(usedTotals.till.value)}) and online ({formatCurrency(usedTotals.online.value)}) are already off those sales' totals, so profit counts them there.
      </p>

      <section>
        <h3 className="text-sm font-semibold mb-2">By tier</h3>
        <div className="overflow-x-auto rounded-xl ring-1 ring-app-border">
          <table className="w-full text-sm min-w-[24rem] [&_th]:whitespace-nowrap [&_td]:whitespace-nowrap [&_th]:[word-break:normal] [&_td]:[word-break:normal]">
            <thead className="text-xs text-app-text-muted bg-app-bg">
              <tr>
                <th className="text-left font-medium px-3 py-2">Tier</th>
                <th className="text-right font-medium px-3 py-2">Pts per KSh 1</th>
                <th className="text-right font-medium px-3 py-2">Customers</th>
                <th className="text-right font-medium px-3 py-2">Held</th>
                <th className="text-right font-medium px-3 py-2">Worth</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-app-border/60">
              {held.tiers.map((t) => (
                <tr key={t.tier}>
                  <td className="px-3 py-2 font-medium">{t.tier}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{pointsPerShilling(t.value)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{t.customers}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{t.points.toLocaleString()}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatCurrency(t.worth)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h3 className="text-sm font-semibold mb-2">Who used points</h3>
        {state === 'loading' ? (
          <div className="py-6 flex justify-center text-app-text-muted"><RefreshCw size={16} className="animate-spin" /></div>
        ) : used.length === 0 ? (
          <p className="p-3 rounded-xl bg-app-bg text-sm text-app-text-muted">No points were used in this period.</p>
        ) : (
          <ul className="rounded-xl ring-1 ring-app-border divide-y divide-app-border/60 overflow-hidden">
            {used.map((r) => {
              const c = byId.get(r.customerId);
              const Icon = r.kind === 'account' ? CreditCard : r.kind === 'online' ? Globe : ShoppingBag;
              return (
                <li key={r.id}>
                  <button type="button" onClick={() => c && onOpenCustomer(c.id)} className="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-app-bg cursor-pointer">
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
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section>
        <h3 className="text-sm font-semibold mb-2">Most points held</h3>
        {topHolders.length === 0 ? (
          <p className="p-3 rounded-xl bg-app-bg text-sm text-app-text-muted">No customer has points yet.</p>
        ) : (
          <ul className="rounded-xl ring-1 ring-app-border divide-y divide-app-border/60 overflow-hidden">
            {topHolders.map((c) => (
              <li key={c.id}>
                <button type="button" onClick={() => onOpenCustomer(c.id)} className="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-app-bg cursor-pointer">
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
