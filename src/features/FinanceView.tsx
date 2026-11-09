// Finances: what actually happened to the money, for owners, managers and admins.
// Profit or loss, money received, credit and wallets, spending (with petty cash), what
// points cost, debts and their age, products by profit, and a feed of every money event.
// All totals come from get_finance_report on the server, so nothing is capped.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { BarChart, Bar, Cell, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';
import { AlertTriangle, RotateCcw, TrendingDown, TrendingUp } from 'lucide-react';
import { getSupabase } from '../services/supabaseClient';
import { useBusinessStore } from '../stores/businessStore';
import { toUserMessage } from '../utils/userError';
import { toUuid } from '../utils/idUtils';
import { formatAxis, formatKsh, getRange, kenyaNow, kenyaToIso, RANGE_LABELS, type RangeKey } from './home/metrics';
import { EmptyChart, niceTicks, RankedBars, ShareBar } from './home/charts';

const TZ = 'Africa/Nairobi';
const RANGES: RangeKey[] = ['today', 'yesterday', 'last7', 'month', 'last30', 'quarter', 'year', 'custom'];

interface Report {
  sales: { count: number; total: number; vat: number; delivery: number; discounts: number; net: number; paid: number; credit: number; creditCount: number; walletUsed: number; creditOwed: number };
  salesByMethod: Record<string, number>;
  costOfGoods: { total: number; estimatedLines: number; lines: number };
  expenses: { total: number; pettyCash: number; pettyCashCount: number; count: number };
  expenseCategories: { category: string; amount: number; count: number; pettyCash: number | null }[];
  expenseList: { id: string; date: string; category: string; description: string | null; amount: number; staffName: string; source: string; method: string | null; receiptRef: string | null }[];
  points: {
    earned: number;
    earnedBySource: Record<string, number>;
    used: { kind: string; count: number; points: number; value: number }[];
    usedValue: number;
    debtPaidWithPoints: number;
    outstandingPoints: number;
    outstandingValue: number;
  };
  moneyIn: { sales: number; debtRepaid: number; walletTopups: number; otherPayments: number };
  debts: {
    outstanding: number;
    debtors: number;
    aging: { week: number; month: number; quarter: number; older: number };
    top: { id: string; name: string; phone: string; owed: number; since: string | null }[];
  };
  wallets: { held: number; customers: number };
  products: { name: string; qty: number; revenue: number; cost: number; profit: number }[];
  daily: { day: string; sales: number; cost: number; expenses: number; points: number; profit: number }[];
  activity: { at: string; kind: string; amount: number; wallet: number; method: string | null; customer: string | null; by: string | null; detail: string | null }[];
  profit: { sales: number; costOfGoods: number; gross: number; expenses: number; pointsToDebt: number; net: number };
}

const num = (v: unknown) => Number(v) || 0;

/** Numbers arrive as strings from Postgres numerics; make them numbers once. */
function normalise(r: any): Report {
  const n = (o: any) => Object.fromEntries(Object.entries(o || {}).map(([k, v]) => [k, typeof v === 'string' && v !== '' && !isNaN(Number(v)) ? Number(v) : v]));
  return {
    ...r,
    sales: n(r.sales) as any,
    salesByMethod: n(r.salesByMethod) as any,
    costOfGoods: n(r.costOfGoods) as any,
    expenses: n(r.expenses) as any,
    expenseCategories: (r.expenseCategories || []).map(n),
    expenseList: (r.expenseList || []).map(n),
    points: { ...n(r.points), earnedBySource: n(r.points?.earnedBySource), used: (r.points?.used || []).map(n) } as any,
    moneyIn: n(r.moneyIn) as any,
    debts: { ...n(r.debts), aging: n(r.debts?.aging), top: (r.debts?.top || []).map(n) } as any,
    wallets: n(r.wallets) as any,
    products: (r.products || []).map(n),
    daily: (r.daily || []).map(n),
    activity: (r.activity || []).map(n),
    profit: n(r.profit) as any,
  };
}

const METHOD_LABELS: Record<string, string> = {
  Cash: 'Cash', 'M-Pesa': 'M-Pesa', Card: 'Card', Bank: 'Bank', Mobile_Wallet: 'Mobile money', Other: 'Other',
};
const POINT_KIND: Record<string, string> = {
  till: 'Taken off sales at the till',
  online: 'Taken off online orders',
  account: 'Used to pay off debt',
};
const EARN_SOURCE: Record<string, string> = { sale: 'From paid sales', debt_payment: 'From paying debt' };

const ACTIVITY: Record<string, { label: string; sign: 1 | -1 | 0 }> = {
  sale: { label: 'Sale', sign: 1 },
  credit_sale: { label: 'Credit sale', sign: 0 },
  expense: { label: 'Expense', sign: -1 },
  petty_cash: { label: 'Petty cash', sign: -1 },
  debt_payment: { label: 'Debt repaid', sign: 1 },
  wallet_topup: { label: 'Wallet top-up', sign: 1 },
  wallet_usage: { label: 'Wallet used', sign: 0 },
  points_till: { label: 'Points at the till', sign: 0 },
  points_online: { label: 'Points online', sign: 0 },
  points_account: { label: 'Points paid debt', sign: -1 },
  payment_voided: { label: 'Payment voided', sign: -1 },
};
const FEED_FILTERS: { id: string; label: string; kinds: string[] }[] = [
  { id: 'all', label: 'All', kinds: [] },
  { id: 'sales', label: 'Sales', kinds: ['sale', 'credit_sale'] },
  { id: 'spending', label: 'Spending', kinds: ['expense', 'petty_cash'] },
  { id: 'debts', label: 'Debts & wallets', kinds: ['debt_payment', 'wallet_topup', 'wallet_usage', 'credit_sale'] },
  { id: 'points', label: 'Points', kinds: ['points_till', 'points_online', 'points_account'] },
  { id: 'voids', label: 'Voids', kinds: ['payment_voided'] },
];

const when = (iso: string) =>
  new Date(iso).toLocaleString('en-KE', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: TZ });
const dayShort = (key: string) => new Date(`${key}T12:00:00+03:00`).toLocaleDateString('en-KE', { day: 'numeric', month: 'short', timeZone: TZ });
const dayLong = (key: string) => new Date(`${key}T12:00:00+03:00`).toLocaleDateString('en-KE', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: TZ });
const ageDays = (iso: string | null) => (iso ? Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 864e5)) : null);

function Card({ title, subtitle, children, className = '' }: { title: string; subtitle?: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={`bg-app-card rounded-2xl p-4 shadow-xs min-w-0 ${className}`}>
      <h2 className="text-sm font-semibold text-app-text">{title}</h2>
      {subtitle && <p className="text-xs text-app-text-muted mt-0.5">{subtitle}</p>}
      <div className="mt-3">{children}</div>
    </section>
  );
}

function Tile({ label, value, note, tone }: { label: string; value: string; note?: string; tone?: 'bad' | 'good' }) {
  return (
    <div className="bg-app-card rounded-2xl p-3.5 shadow-xs min-w-0">
      <div className="text-xs text-app-text-muted">{label}</div>
      <div className={`text-lg font-bold tabular-nums mt-0.5 break-words ${tone === 'bad' ? 'text-red-600 dark:text-red-400' : 'text-app-text'}`}>{value}</div>
      {note && <div className="text-[11px] text-app-text-muted mt-0.5">{note}</div>}
    </div>
  );
}

function Line({ label, value, strong, minus, note }: { label: string; value: number; strong?: boolean; minus?: boolean; note?: string }) {
  return (
    <div className={`flex items-baseline justify-between gap-3 py-1.5 ${strong ? 'border-t border-app-border mt-1 pt-2.5' : ''}`}>
      <span className={`min-w-0 ${strong ? 'font-semibold text-app-text' : 'text-app-text'} text-[13px]`}>
        {label}
        {note && <span className="block text-[11px] text-app-text-muted font-normal">{note}</span>}
      </span>
      <span className={`shrink-0 tabular-nums text-[13px] ${strong ? 'font-bold' : 'font-medium'} ${strong && value < 0 ? 'text-red-600 dark:text-red-400' : 'text-app-text'}`}>
        {minus && value > 0 ? `− ${formatKsh(value)}` : formatKsh(value)}
      </span>
    </div>
  );
}

function DailyTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="rounded-xl border border-app-border bg-app-card px-3 py-2 shadow-lg text-xs min-w-[170px]">
      <div className="font-semibold text-app-text mb-1">{dayLong(d.day)}</div>
      {[
        ['Sales', d.sales],
        ['Cost of goods', -d.cost],
        ['Expenses', -d.expenses],
        ...(d.points ? [['Points paid debt', -d.points]] : []),
      ].map(([k, v]) => (
        <div key={k as string} className="flex justify-between gap-4 py-0.5">
          <span className="text-app-text-muted">{k}</span>
          <span className="tabular-nums text-app-text">{formatKsh(v as number)}</span>
        </div>
      ))}
      <div className="flex justify-between gap-4 pt-1 mt-1 border-t border-app-border">
        <span className="font-semibold text-app-text">{d.profit < 0 ? 'Loss' : 'Profit'}</span>
        <span className="font-semibold tabular-nums text-app-text">{formatKsh(d.profit)}</span>
      </div>
    </div>
  );
}

function DailyProfit({ daily }: { daily: Report['daily'] }) {
  const [asTable, setAsTable] = useState(false);
  if (daily.length === 0 || daily.every((d) => !d.sales && !d.expenses)) return <EmptyChart text="Nothing sold or spent in this period" />;
  const lo = Math.min(0, ...daily.map((d) => d.profit));
  const hi = Math.max(0, ...daily.map((d) => d.profit));
  const ticks = niceTicks(lo, hi);
  return (
    <div>
      <div className="flex justify-end -mt-9 mb-2">
        <button onClick={() => setAsTable((v) => !v)} className="text-xs text-app-text-muted underline cursor-pointer">
          {asTable ? 'Show chart' : 'Show as table'}
        </button>
      </div>
      {asTable ? (
        <div className="overflow-x-auto">
          <table className="w-full text-xs tabular-nums">
            <thead className="text-app-text-muted">
              <tr>
                <th className="text-left font-medium py-1">Day</th>
                <th className="text-right font-medium">Sales</th>
                <th className="text-right font-medium">Cost</th>
                <th className="text-right font-medium">Expenses</th>
                <th className="text-right font-medium">Profit</th>
              </tr>
            </thead>
            <tbody className="text-app-text">
              {daily.map((d) => (
                <tr key={d.day} className="border-t border-app-border">
                  <td className="py-1">{dayShort(d.day)}</td>
                  <td className="text-right">{formatKsh(d.sales)}</td>
                  <td className="text-right">{formatKsh(d.cost)}</td>
                  <td className="text-right">{formatKsh(d.expenses + d.points)}</td>
                  <td className={`text-right font-semibold ${d.profit < 0 ? 'text-red-600 dark:text-red-400' : ''}`}>{formatKsh(d.profit)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="h-56 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={daily} margin={{ top: 8, right: 4, left: 0, bottom: 0 }} barCategoryGap={2}>
              <CartesianGrid stroke="var(--viz-grid)" vertical={false} />
              <XAxis dataKey="day" tickFormatter={dayShort} tick={{ fill: 'var(--viz-axis)', fontSize: 11 }} tickLine={false} axisLine={false} minTickGap={12} interval="preserveStartEnd" />
              <YAxis tick={{ fill: 'var(--viz-axis)', fontSize: 11 }} tickLine={false} axisLine={false} width={44} domain={[ticks[0], ticks[ticks.length - 1]]} ticks={ticks} tickFormatter={formatAxis} allowDataOverflow />
              <ReferenceLine y={0} stroke="var(--viz-axis)" />
              <Tooltip content={<DailyTooltip />} cursor={{ fill: 'var(--viz-grid)', opacity: 0.6 }} />
              <Bar dataKey="profit" name="Profit" radius={[4, 4, 4, 4]} isAnimationActive={false}>
                {daily.map((d) => (
                  <Cell key={d.day} fill="var(--viz-3)" fillOpacity={d.profit < 0 ? 0.45 : 1} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

export default function FinanceView() {
  const businessId = useBusinessStore((s) => s.activeBusinessId);
  const [rangeKey, setRangeKey] = useState<RangeKey>('month');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [feed, setFeed] = useState('all');
  const [feedShown, setFeedShown] = useState(40);
  const [expShown, setExpShown] = useState(10);

  const range = useMemo(() => getRange(rangeKey, kenyaNow(), customStart, customEnd), [rangeKey, customStart, customEnd]);

  const load = useCallback(async () => {
    if (!businessId) return;
    setLoading(true);
    setError(null);
    const { data, error: err } = await getSupabase().rpc('get_finance_report', {
      p_business_id: toUuid(businessId),
      p_start: kenyaToIso(range.start),
      p_end: kenyaToIso(range.end),
    });
    setLoading(false);
    if (err) {
      setError(toUserMessage(err, 'Could not load the figures. Check your connection.'));
      return;
    }
    setReport(normalise(data));
    setFeedShown(40);
    setExpShown(10);
  }, [businessId, range]);

  useEffect(() => {
    void load();
  }, [load]);

  const r = report;
  const net = r?.profit.net ?? 0;
  const moneyInTotal = r ? r.moneyIn.sales + r.moneyIn.debtRepaid + r.moneyIn.walletTopups : 0;
  const pointsUsedAtSale = r ? r.points.used.filter((u) => u.kind !== 'account').reduce((s, u) => s + num(u.value), 0) : 0;
  const lossMakers = r ? r.products.filter((p) => p.profit < 0) : [];
  const feedKinds = FEED_FILTERS.find((f) => f.id === feed)!.kinds;
  const feedRows = r ? r.activity.filter((a) => feedKinds.length === 0 || feedKinds.includes(a.kind)) : [];

  const paidParts = r
    ? [
        ...Object.entries(r.salesByMethod)
          .filter(([m]) => m !== 'Credit_Debt' && m !== 'Credit')
          .map(([m, v], i) => ({ key: m, label: `Sales: ${METHOD_LABELS[m] || m}`, value: num(v), color: `var(--viz-${(i % 3) + 1})` })),
        { key: 'debt', label: 'Debt repaid', value: r.moneyIn.debtRepaid, color: 'var(--viz-4)' },
        { key: 'wallet', label: 'Wallet top-ups', value: r.moneyIn.walletTopups, color: 'var(--viz-5)' },
      ]
    : [];

  return (
    <div className="h-full overflow-y-auto bg-app-bg">
      <div className="max-w-6xl mx-auto p-3 sm:p-5 space-y-4">
        {/* Period */}
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex gap-1.5 overflow-x-auto scrollbar-none -mx-3 px-3 sm:mx-0 sm:px-0">
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
            <div className="flex items-center gap-1.5 text-xs text-app-text">
              <input type="date" value={customStart} onChange={(e) => setCustomStart(e.target.value)} className="bg-app-card border border-app-border rounded-lg px-2 py-1" />
              to
              <input type="date" value={customEnd} onChange={(e) => setCustomEnd(e.target.value)} className="bg-app-card border border-app-border rounded-lg px-2 py-1" />
            </div>
          )}
          <button onClick={() => void load()} className="ml-auto p-2 rounded-lg text-app-text-muted hover:bg-app-card cursor-pointer" title="Refresh" aria-label="Refresh">
            <RotateCcw size={16} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>

        {error && (
          <div className="bg-app-card rounded-2xl p-4 text-sm text-red-600 dark:text-red-400 flex items-center justify-between gap-3">
            {error}
            <button onClick={() => void load()} className="text-app-text underline cursor-pointer">Try again</button>
          </div>
        )}

        {!r && loading && <p className="text-sm text-app-text-muted text-center py-10">Working out the figures…</p>}

        {r && (
          <>
            {/* Headline: profit or loss, and how it was reached */}
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
              <section className="bg-app-card rounded-2xl p-4 shadow-xs">
                <div className="flex items-center gap-2 text-sm font-semibold text-app-text">
                  {net < 0 ? <TrendingDown size={16} className="text-red-500" /> : <TrendingUp size={16} className="text-emerald-500" />}
                  {net < 0 ? 'Loss' : 'Profit'} · {RANGE_LABELS[rangeKey].toLowerCase()}
                </div>
                <p className={`text-3xl font-bold tabular-nums mt-1 ${net < 0 ? 'text-red-600 dark:text-red-400' : 'text-app-text'}`}>{formatKsh(net)}</p>
                <div className="mt-3">
                  <Line label="Sales" value={r.profit.sales} note={r.sales.vat > 0 ? `Without ${formatKsh(r.sales.vat)} VAT, which goes to KRA` : `${r.sales.count} sales`} />
                  <Line label="Cost of the goods sold" value={r.profit.costOfGoods} minus />
                  <Line label="Gross profit" value={r.profit.gross} strong />
                  <Line label="Expenses" value={r.profit.expenses} minus note={r.expenses.pettyCash > 0 ? `Includes ${formatKsh(r.expenses.pettyCash)} petty cash` : undefined} />
                  {r.profit.pointsToDebt > 0 && <Line label="Debt paid with points" value={r.profit.pointsToDebt} minus note="No money came in for it" />}
                  <Line label={net < 0 ? 'Net loss' : 'Net profit'} value={net} strong />
                </div>
                {r.costOfGoods.estimatedLines > 0 && (
                  <p className="mt-3 flex gap-1.5 text-[11px] text-app-text-muted">
                    <AlertTriangle size={13} className="shrink-0 text-amber-500" />
                    {r.costOfGoods.estimatedLines} of {r.costOfGoods.lines} items sold before costs were recorded on sales; their cost uses today's product cost.
                  </p>
                )}
              </section>
              <Card title="Profit by day" subtitle="Bars below the line are days that lost money">
                <DailyProfit daily={r.daily} />
              </Card>
            </div>

            {/* Key figures */}
            <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
              <Tile label="Money received" value={formatKsh(moneyInTotal)} note="Paid sales, debt repaid, top-ups" />
              <Tile label="Sold on credit" value={formatKsh(r.sales.creditOwed)} note={`${r.sales.creditCount} credit sales`} />
              <Tile label="Owed to you now" value={formatKsh(r.debts.outstanding)} note={`${r.debts.debtors} customers`} tone={r.debts.outstanding > 0 ? 'bad' : undefined} />
              <Tile label="Customers' wallet money" value={formatKsh(r.wallets.held)} note={`You hold it for ${r.wallets.customers} customers`} />
              <Tile label="Unused points" value={formatKsh(r.points.outstandingValue)} note={`${Math.round(r.points.outstandingPoints).toLocaleString()} points could come off future sales`} />
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <Card title="Money that came in" subtitle={`${formatKsh(moneyInTotal)} in total`}>
                <ShareBar parts={paidParts} />
                {r.moneyIn.otherPayments > 0 && (
                  <p className="mt-3 text-[11px] text-app-text-muted">
                    Also {formatKsh(r.moneyIn.otherPayments)} in recorded payments not linked to a customer (for example till payments). These may be for sales already counted above.
                  </p>
                )}
              </Card>

              <Card title="Credit sales" subtitle="Wallet money pays first; only the rest is owed">
                <Line label="Credit sales" value={r.sales.credit} note={`${r.sales.creditCount} sales`} />
                <Line label="Paid from customers' wallets" value={r.sales.walletUsed} minus />
                <Line label="Left owing" value={r.sales.creditOwed} strong />
                <div className="mt-4">
                  <h3 className="text-xs font-semibold text-app-text-muted mb-2">How old the debts are</h3>
                  <RankedBars
                    sort={false}
                    scaleMax={Math.max(r.debts.aging.week, r.debts.aging.month, r.debts.aging.quarter, r.debts.aging.older)}
                    color="var(--viz-2)"
                    emptyText="No one owes anything"
                    rows={[
                      { key: 'w', label: 'This week', value: r.debts.aging.week },
                      { key: 'm', label: '1 to 4 weeks', value: r.debts.aging.month },
                      { key: 'q', label: '1 to 3 months', value: r.debts.aging.quarter },
                      { key: 'o', label: 'Over 3 months', value: r.debts.aging.older },
                    ]}
                  />
                </div>
              </Card>

              <Card title="What was spent on what" subtitle={`${formatKsh(r.expenses.total)} across ${r.expenses.count} entries`}>
                <RankedBars
                  scaleMax={Math.max(0, ...r.expenseCategories.map((c) => c.amount))}
                  color="var(--viz-2)"
                  emptyText="Nothing spent in this period"
                  limit={8}
                  rows={r.expenseCategories.map((c) => ({
                    key: c.category,
                    label: c.category,
                    value: c.amount,
                    note: num(c.pettyCash) > 0 ? 'petty cash' : `${c.count}×`,
                  }))}
                />
                {r.expenseList.length > 0 && (
                  <ul className="mt-4 divide-y divide-app-border border-t border-app-border">
                    {r.expenseList.slice(0, expShown).map((e) => (
                      <li key={e.id} className="flex items-start justify-between gap-3 py-2">
                        <span className="min-w-0">
                          <span className="block text-[13px] text-app-text">{e.description || e.category}</span>
                          <span className="block text-[11px] text-app-text-muted">
                            {e.category} · {when(e.date)} · {e.staffName}
                            {e.source === 'petty_cash' ? ' · petty cash' : ''}
                          </span>
                        </span>
                        <span className="shrink-0 text-[13px] font-medium tabular-nums text-app-text">{formatKsh(e.amount)}</span>
                      </li>
                    ))}
                  </ul>
                )}
                {r.expenseList.length > expShown && (
                  <button onClick={() => setExpShown((n) => n + 30)} className="mt-2 text-xs text-app-text underline cursor-pointer">
                    Show more ({r.expenseList.length - expShown})
                  </button>
                )}
              </Card>

              <Card title="What points cost" subtitle="Points are never cash; they come off a price or a debt">
                <Line label="Points used, in shillings" value={r.points.usedValue} />
                {r.points.used.map((u) => (
                  <Line key={u.kind} label={POINT_KIND[u.kind] || u.kind} value={num(u.value)} note={`${Math.round(num(u.points)).toLocaleString()} points, ${u.count} times`} />
                ))}
                <p className="text-[11px] text-app-text-muted mt-2">
                  {pointsUsedAtSale > 0 ? `${formatKsh(pointsUsedAtSale)} came off sale prices, so sales above are already lower by that. ` : ''}
                  {r.profit.pointsToDebt > 0 ? `${formatKsh(r.profit.pointsToDebt)} paid off debt and is taken off profit.` : ''}
                </p>
                <div className="mt-3 border-t border-app-border pt-2 flex items-baseline justify-between gap-3">
                  <span className="text-[13px] text-app-text min-w-0">
                    Points given out
                    <span className="block text-[11px] text-app-text-muted">
                      {Object.entries(r.points.earnedBySource).map(([k, v]) => `${EARN_SOURCE[k] || k}: ${Math.round(num(v)).toLocaleString()}`).join(' · ') || 'None in this period'}
                    </span>
                  </span>
                  <span className="shrink-0 text-[13px] font-medium tabular-nums text-app-text">{Math.round(r.points.earned).toLocaleString()} pts</span>
                </div>
              </Card>

              <Card title="Who owes the most" subtitle={`${formatKsh(r.debts.outstanding)} owed in total, as of now`}>
                {r.debts.top.length === 0 ? (
                  <EmptyChart text="No one owes anything" />
                ) : (
                  <ul className="divide-y divide-app-border">
                    {r.debts.top.map((d) => {
                      const age = ageDays(d.since);
                      return (
                        <li key={d.id} className="flex items-center justify-between gap-3 py-2">
                          <span className="min-w-0">
                            <span className="block text-[13px] text-app-text truncate">{d.name}</span>
                            <span className="block text-[11px] text-app-text-muted">
                              {d.phone}
                              {age !== null ? ` · oldest ${age === 0 ? 'today' : `${age} days`}` : ''}
                            </span>
                          </span>
                          <span className="shrink-0 text-[13px] font-semibold tabular-nums text-app-text">{formatKsh(d.owed)}</span>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </Card>

              <Card title="Products by profit" subtitle="Sales minus what the goods cost">
                <RankedBars
                  scaleMax={Math.max(0, ...r.products.map((p) => p.profit))}
                  color="var(--viz-3)"
                  emptyText="Nothing sold in this period"
                  rows={r.products.filter((p) => p.profit > 0).map((p) => ({ key: p.name, label: p.name, value: p.profit, note: `${Math.round(p.qty * 100) / 100} sold` }))}
                />
                {lossMakers.length > 0 && (
                  <div className="mt-4 rounded-xl bg-red-500/5 border border-red-500/20 p-3">
                    <p className="flex items-center gap-1.5 text-xs font-semibold text-app-text">
                      <AlertTriangle size={13} className="text-red-500" /> Sold below cost
                    </p>
                    <ul className="mt-1.5 space-y-1">
                      {lossMakers.map((p) => (
                        <li key={p.name} className="flex justify-between gap-3 text-[12px] text-app-text">
                          <span className="min-w-0 truncate">{p.name}</span>
                          <span className="shrink-0 tabular-nums">{formatKsh(p.profit)}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </Card>
            </div>

            {/* Everything that happened */}
            <Card title="What happened" subtitle="Every sale, payment, expense and points use, newest first">
              <div className="flex gap-1.5 flex-wrap mb-3">
                {FEED_FILTERS.map((f) => (
                  <button
                    key={f.id}
                    onClick={() => {
                      setFeed(f.id);
                      setFeedShown(40);
                    }}
                    aria-pressed={feed === f.id}
                    className={`px-3 py-1.5 rounded-full text-xs font-medium cursor-pointer ${feed === f.id ? 'bg-amber-500 text-slate-950' : 'bg-app-bg text-app-text border border-app-border'}`}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
              {feedRows.length === 0 ? (
                <EmptyChart text="Nothing of this kind in the period" />
              ) : (
                <ul className="divide-y divide-app-border">
                  {feedRows.slice(0, feedShown).map((a, i) => {
                    const meta = ACTIVITY[a.kind] || { label: a.kind, sign: 0 };
                    const who = [a.customer, a.by && `by ${a.by}`].filter(Boolean).join(' · ');
                    let detail = a.detail || '';
                    if (a.kind === 'credit_sale') {
                      const owed = Math.max(0, a.amount - a.wallet);
                      detail = a.wallet > 0 ? `${formatKsh(a.wallet)} from wallet, ${formatKsh(owed)} owed` : `${formatKsh(a.amount)} owed`;
                    } else if (a.kind === 'sale' && a.method) detail = METHOD_LABELS[a.method] || a.method;
                    else if (a.kind.startsWith('points_') && a.detail) detail = `${Number(a.detail).toLocaleString()} points`;
                    return (
                      <li key={`${a.at}-${i}`} className="flex items-start justify-between gap-3 py-2">
                        <span className="min-w-0">
                          <span className="block text-[13px] text-app-text">
                            <span className="font-medium">{meta.label}</span>
                            {detail ? <span className="text-app-text-muted"> · {detail}</span> : null}
                          </span>
                          <span className="block text-[11px] text-app-text-muted">
                            {when(a.at)}
                            {who ? ` · ${who}` : ''}
                          </span>
                        </span>
                        <span className={`shrink-0 text-[13px] font-medium tabular-nums ${meta.sign < 0 ? 'text-red-600 dark:text-red-400' : 'text-app-text'}`}>
                          {meta.sign < 0 ? '− ' : meta.sign > 0 ? '+ ' : ''}
                          {formatKsh(a.amount)}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
              {feedRows.length > feedShown && (
                <button onClick={() => setFeedShown((n) => n + 60)} className="mt-2 text-xs text-app-text underline cursor-pointer">
                  Show more ({feedRows.length - feedShown})
                </button>
              )}
              {r.activity.length >= 400 && <p className="mt-2 text-[11px] text-app-text-muted">Showing the latest 400 events. Pick a shorter period to see older ones.</p>}
            </Card>
          </>
        )}
      </div>
    </div>
  );
}
