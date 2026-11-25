// src/features/console/ConsoleHome.tsx
// The platform console's Home: money in and expected, where it comes from (plans and add-ons),
// growth, break-even against our running costs, and how much of what companies may use they use.
// Everything comes from platform_home_stats() (20261205001): counts and our own prices, never a
// business's sales amounts.

import React, { useEffect, useMemo, useState } from 'react';
import {
  Bar, BarChart, CartesianGrid, ComposedChart, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { StatGrid, StatTile } from '../../components/shared/StatTile';
import { formatMoney } from '../../utils/money';
import { RankedBars, ShareBar, EmptyChart, CATEGORY_COLORS } from '../home/charts';
import { formatAxis } from '../home/metrics';
import { StatusPill, card, num, useCall } from './common';

export interface HomeStats {
  as_of: string;
  companies: number;
  paying: number;
  by_status: Record<string, number>;
  expected_month: number;
  agreed_companies: number;
  given_off_month: number;
  free_companies: number;
  received_this_month: number;
  owing: number;
  plans: { code: string; name: string; kind: string; companies: number; paying: number; month_value: number }[];
  addons: { key: string; name: string; companies: number; month_value: number }[];
  one_time: { plan: string; companies: number; price: number | null }[];
  growth: { month: string; new_companies: number; companies: number; branches: number; expected_month: number; received: number; sales: number; ai_calls: number }[];
  usage: {
    branches: number; branches_allowed: number; staff: number; staff_allowed: number;
    ai_today: number; ai_cap_today: number; ai_30_days: number;
    database_bytes: number; files_bytes: number | null; storage_allowed_mb: number;
  };
  busiest: { tenant_id: string; name: string; plan: string; status: string; branches: number; max_branches: number; staff: number; max_staff: number; ai_today: number; ai_cap: number; ai_30: number; load: number }[];
  costs: { fixed_month: number; per_company_month: number; share_percent: number };
}

const MONTH = (ym: string) => {
  const [y, m] = ym.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('en-KE', { month: 'short' });
};
const MONTH_FULL = (ym: string) => {
  const [y, m] = ym.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('en-KE', { month: 'long', year: 'numeric' });
};
const bytes = (b: number | null | undefined) => {
  if (b == null) return '-';
  if (b >= 1024 ** 3) return `${(b / 1024 ** 3).toFixed(1)} GB`;
  if (b >= 1024 ** 2) return `${Math.round(b / 1024 ** 2)} MB`;
  return `${Math.round(b / 1024)} KB`;
};

const axis = {
  stroke: 'var(--viz-axis)',
  tick: { fill: 'var(--viz-axis)', fontSize: 11 },
  tickLine: false,
  axisLine: false,
} as const;

function Tip({ active, payload, label, money }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl border border-app-border bg-app-card px-3 py-2 shadow-lg text-xs min-w-[150px]">
      <div className="font-semibold text-app-text mb-1">{MONTH_FULL(label)}</div>
      {payload.map((p: any) => (
        <div key={p.dataKey} className="flex items-center justify-between gap-4 py-0.5">
          <span className="flex items-center gap-1.5 text-app-text-muted">
            <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: p.color || p.stroke || p.fill }} />
            {p.name}
          </span>
          <span className="font-semibold text-app-text tabular-nums">{money ? formatMoney(num(p.value)) : num(p.value).toLocaleString()}</span>
        </div>
      ))}
    </div>
  );
}

function Legend({ items }: { items: { label: string; color: string; line?: boolean }[] }) {
  return (
    <ul className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-app-text-muted">
      {items.map((i) => (
        <li key={i.label} className="flex items-center gap-1.5">
          <span className={`inline-block shrink-0 rounded ${i.line ? 'w-3 h-0.5' : 'w-2.5 h-2.5'}`} style={{ background: i.color }} />
          {i.label}
        </li>
      ))}
    </ul>
  );
}

function Panel({ title, note, children, className = '' }: { title: string; note?: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={`min-w-0 rounded-2xl border border-app-border bg-app-card p-4 sm:p-5 ${className}`}>
      <h3 className="text-[15px] font-semibold leading-snug text-app-text">{title}</h3>
      {note && <p className="mt-0.5 text-xs text-app-text-muted">{note}</p>}
      <div className="mt-3">{children}</div>
    </section>
  );
}

/** A used-of-allowed bar, plain: label and figures above, the bar below. */
function Meter({ label, used, allowed, format = (n: number) => n.toLocaleString(), note, goal }: {
  label: string; used: number; allowed: number; format?: (n: number) => string; note?: string;
  /** Progress towards a target (filling up is good), not use of a limit. */
  goal?: boolean;
}) {
  const pct = allowed > 0 ? Math.min(100, (used / allowed) * 100) : 0;
  const hot = !goal && pct >= 85;
  return (
    <li className="min-w-0">
      <div className="flex items-baseline justify-between gap-3 text-[13px]">
        <span className="text-app-text">{label}</span>
        <span className="shrink-0 tabular-nums">
          <span className="font-semibold text-app-text">{format(used)}</span>
          <span className="text-app-text-muted"> of {allowed > 0 ? format(allowed) : goal ? '-' : 'no limit'}</span>
        </span>
      </div>
      <div className="mt-1 h-2 rounded-full bg-[var(--viz-grid)] overflow-hidden" role="img" aria-label={`${label}: ${Math.round(pct)}% used`}>
        <div className="h-full rounded-full transition-[width] duration-300" style={{ width: `${pct}%`, background: hot ? 'var(--bad)' : goal ? 'var(--viz-3)' : 'var(--viz-1)' }} />
      </div>
      {note && <p className="mt-1 text-[11px] text-app-text-muted">{note}</p>}
    </li>
  );
}

export function breakEven(s: HomeStats) {
  const share = num(s.costs.share_percent) / 100;
  const avg = s.paying > 0 ? num(s.expected_month) / s.paying : 0;
  const perCompany = avg * (1 - share) - num(s.costs.per_company_month);
  const needed = perCompany > 0 ? Math.ceil(num(s.costs.fixed_month) / perCompany) : null;
  const profit = num(s.expected_month) * (1 - share) - s.paying * num(s.costs.per_company_month) - num(s.costs.fixed_month);
  return { avg, perCompany, needed, profit };
}

export default function ConsoleHome({ onOpen }: { onOpen: (section: 'companies' | 'money' | 'requests' | 'running_costs') => void }) {
  const { call } = useCall();
  const [s, setS] = useState<HomeStats | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    call<HomeStats>('platform_home_stats', { p_months: 12 }).then((r) => (r ? setS(r) : setFailed(true)));
  }, [call]);

  const be = useMemo(() => (s ? breakEven(s) : null), [s]);

  if (failed) return <p className={`${card} text-sm text-app-text-muted`}>The figures could not be loaded. Has the latest database change been applied?</p>;
  if (!s || !be) return <p className="text-sm text-app-text-muted">Loading...</p>;

  const g = s.growth ?? [];
  const last = g[g.length - 1];
  const prev = g[g.length - 2];
  const change = (a?: number, b?: number) => (a == null || b == null || b === 0 ? undefined : Math.round(((a - b) / b) * 100));
  const fmtChange = (c?: number) => (c == null ? undefined : `${c > 0 ? '+' : ''}${c}%`);
  const recChange = change(last?.received, prev?.received);
  const coChange = change(last?.companies, prev?.companies);

  const sources = [
    ...s.plans.filter((p) => num(p.month_value) > 0).map((p) => ({ key: `p-${p.code}`, label: `${p.name} (${p.paying})`, value: num(p.month_value) })),
    ...s.addons.filter((a) => num(a.month_value) > 0).map((a) => ({ key: `a-${a.key}`, label: `${a.name} add-on (${a.companies})`, value: num(a.month_value) })),
  ].map((x, i) => ({ ...x, color: CATEGORY_COLORS[i % CATEGORY_COLORS.length] }));

  const u = s.usage;
  const storageUsed = num(u.database_bytes) + num(u.files_bytes);

  return (
    <div className="space-y-5">
      <StatGrid>
        <StatTile
          label="Expected each month"
          value={formatMoney(num(s.expected_month))}
          note={`${s.paying} paying ${s.paying === 1 ? 'company' : 'companies'}`}
          tone="emerald"
          spark={g.map((x) => num(x.expected_month))}
          onClick={() => onOpen('money')}
        />
        <StatTile
          label="Received this month"
          value={formatMoney(num(s.received_this_month))}
          change={fmtChange(recChange)}
          trend={recChange == null ? undefined : recChange >= 0 ? 'up' : 'down'}
          note={s.owing ? `${s.owing} behind on paying` : 'Nobody behind'}
          tone="emerald"
          spark={g.map((x) => num(x.received))}
          onClick={() => onOpen('money')}
        />
        <StatTile
          label="Companies"
          value={s.companies}
          change={fmtChange(coChange)}
          trend={coChange == null ? undefined : coChange >= 0 ? 'up' : 'down'}
          note={`${s.by_status.trial ?? 0} on trial · ${s.free_companies} free`}
          tone="sky"
          spark={g.map((x) => x.companies)}
          onClick={() => onOpen('companies')}
        />
        <StatTile
          label="Break-even"
          value={be.needed == null ? '-' : `${s.paying} of ${be.needed}`}
          note={be.profit >= 0 ? `${formatMoney(be.profit)} a month over costs` : `${formatMoney(-be.profit)} a month short`}
          tone={be.profit >= 0 ? 'emerald' : 'red'}
          onClick={() => onOpen('running_costs')}
        />
      </StatGrid>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Money by month" note="Bars: payments recorded. Line: what paying companies owe a month at their prices.">
          <Legend items={[{ label: 'Received', color: 'var(--viz-1)' }, { label: 'Expected a month', color: 'var(--viz-3)', line: true }]} />
          <div className="h-56 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={g} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid stroke="var(--viz-grid)" vertical={false} />
                <XAxis dataKey="month" {...axis} tickFormatter={MONTH} interval="preserveStartEnd" minTickGap={12} />
                <YAxis {...axis} width={44} tickFormatter={formatAxis} />
                <Tooltip content={<Tip money />} cursor={{ fill: 'var(--viz-grid)', opacity: 0.5 }} />
                <Bar dataKey="received" name="Received" fill="var(--viz-1)" radius={[4, 4, 0, 0]} maxBarSize={28} />
                <Line dataKey="expected_month" name="Expected a month" type="monotone" stroke="var(--viz-3)" strokeWidth={2} dot={false} activeDot={{ r: 5, strokeWidth: 2, stroke: 'var(--app-card)' }} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </Panel>

        <Panel title="Where the money comes from" note="Each month, by plan and add-on, at the prices companies pay.">
          {sources.length ? <ShareBar parts={sources} /> : <EmptyChart text="No paying companies yet" />}
          {(s.agreed_companies > 0 || s.one_time.length > 0) && (
            <div className="mt-4 space-y-1 border-t border-app-border pt-3 text-xs text-app-text-muted">
              {s.agreed_companies > 0 && (
                <p>{s.agreed_companies} on an agreed price: {formatMoney(num(s.given_off_month))} a month below the list prices.</p>
              )}
              {s.one_time.map((o) => (
                <p key={o.plan}>{o.companies} on {o.plan} (paid once, not in the monthly figure).</p>
              ))}
            </div>
          )}
        </Panel>

        <Panel title="Growth" note="Companies and branches at the end of each month.">
          <Legend items={[{ label: 'Companies', color: 'var(--viz-1)', line: true }, { label: 'Branches', color: 'var(--viz-2)', line: true }]} />
          <div className="h-52 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={g} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid stroke="var(--viz-grid)" vertical={false} />
                <XAxis dataKey="month" {...axis} tickFormatter={MONTH} interval="preserveStartEnd" minTickGap={12} />
                <YAxis {...axis} width={36} allowDecimals={false} />
                <Tooltip content={<Tip />} cursor={{ stroke: 'var(--viz-axis)', strokeWidth: 1 }} />
                <Line dataKey="companies" name="Companies" type="monotone" stroke="var(--viz-1)" strokeWidth={2} dot={false} activeDot={{ r: 5, strokeWidth: 2, stroke: 'var(--app-card)' }} />
                <Line dataKey="branches" name="Branches" type="monotone" stroke="var(--viz-2)" strokeWidth={2} dot={false} activeDot={{ r: 5, strokeWidth: 2, stroke: 'var(--app-card)' }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <p className="mt-2 text-xs text-app-text-muted">{last ? `${last.new_companies} new this month.` : ''}</p>
        </Panel>

        <Panel title="Break-even" note="Our running costs against what paying companies bring in.">
          <dl className="space-y-2 text-[13px]">
            <Row label="Our fixed costs a month" value={formatMoney(num(s.costs.fixed_month))} />
            <Row label="Cost per paying company" value={formatMoney(num(s.costs.per_company_month))} />
            <Row label={`Fees and bad debt (${num(s.costs.share_percent)}%)`} value={formatMoney(num(s.expected_month) * num(s.costs.share_percent) / 100)} />
            <Row label="Average a paying company brings" value={formatMoney(be.avg)} />
            <Row label="Left from each, after its costs" value={formatMoney(be.perCompany)} />
          </dl>
          <ul className="mt-4">
            <Meter
              goal
              label="Paying companies"
              used={s.paying}
              allowed={be.needed ?? 0}
              note={be.needed == null
                ? 'Each company costs more than it brings in at today\'s prices, so no number of companies breaks even.'
                : be.profit >= 0 ? 'Past break-even.' : `${be.needed - s.paying} more paying companies to break even at today's average.`}
            />
          </ul>
          <button type="button" onClick={() => onOpen('running_costs')} className="mt-3 text-xs font-semibold text-amber-600 cursor-pointer">Check our running costs</button>
        </Panel>

        <Panel title="Resources in use" note="All companies together, against what their plans allow.">
          <ul className="space-y-3.5">
            <Meter label="Branches" used={num(u.branches)} allowed={num(u.branches_allowed)} />
            <Meter label="Staff" used={num(u.staff)} allowed={num(u.staff_allowed)} />
            <Meter label="AI questions today" used={num(u.ai_today)} allowed={num(u.ai_cap_today)} note={`${num(u.ai_30_days).toLocaleString()} in the last 30 days`} />
            <Meter label="Storage (database and files)" used={storageUsed} allowed={num(u.storage_allowed_mb) * 1024 * 1024} format={bytes}
              note={`Database ${bytes(u.database_bytes)} · files ${bytes(u.files_bytes)}`} />
          </ul>
        </Panel>

        <Panel title="Busiest companies" note="Nearest to a plan limit (branches, staff or today's AI).">
          {s.busiest.length ? (
            <RankedBars
              rows={s.busiest.map((b) => ({
                key: b.tenant_id,
                label: `${b.name} · ${b.plan}`,
                value: num(b.load),
                note: <StatusPill status={b.status} />,
                color: num(b.load) >= 85 ? 'var(--bad)' : 'var(--viz-1)',
              }))}
              scaleMax={100}
              limit={8}
              sort={false}
              format={(n) => `${Math.round(n)}%`}
              emptyText="No companies yet"
            />
          ) : <EmptyChart text="No companies yet" />}
        </Panel>

        <Panel title="Activity" note="Sales recorded and AI questions asked across all companies, by month." className="lg:col-span-2">
          <div className="grid gap-4 sm:grid-cols-2">
            {([['sales', 'Sales recorded', 'var(--viz-1)'], ['ai_calls', 'AI questions', 'var(--viz-5)']] as const).map(([k, label, color]) => (
              <div key={k}>
                <p className="mb-1 text-xs font-semibold text-app-text">{label}</p>
                <div className="h-40 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={g} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                      <CartesianGrid stroke="var(--viz-grid)" vertical={false} />
                      <XAxis dataKey="month" {...axis} tickFormatter={MONTH} interval="preserveStartEnd" minTickGap={12} />
                      <YAxis {...axis} width={36} allowDecimals={false} tickFormatter={formatAxis} />
                      <Tooltip content={<Tip />} cursor={{ fill: 'var(--viz-grid)', opacity: 0.5 }} />
                      <Bar dataKey={k} name={label} fill={color} radius={[4, 4, 0, 0]} maxBarSize={24} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            ))}
          </div>
        </Panel>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-app-text-muted">{label}</dt>
      <dd className="font-semibold text-app-text tabular-nums">{value}</dd>
    </div>
  );
}
