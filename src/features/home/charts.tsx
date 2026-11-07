// src/features/home/charts.tsx
// The Home screen's charts. Each takes `frame`: the last slot to draw (null = all),
// so the same chart can be replayed slot by slot. Scales are fixed to the full
// range so nothing jumps while it plays.

import React, { useMemo } from "react";
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine,
} from "recharts";
import { formatAxis, formatKsh, type SeriesPoint } from "./metrics";

export const SERIES = {
  sales: { label: "Sales", color: "var(--viz-1)" },
  expenses: { label: "Expenses", color: "var(--viz-2)" },
  profit: { label: "Profit", color: "var(--viz-3)" },
  prevSales: { label: "Sales, previous period", color: "var(--viz-muted)" },
} as const;
export type SeriesKey = keyof typeof SERIES;

/** Branches and payment methods keep one colour each, in this order. */
export const CATEGORY_COLORS = ["var(--viz-1)", "var(--viz-2)", "var(--viz-3)", "var(--viz-4)", "var(--viz-5)"];

function niceMax(v: number) {
  if (v <= 0) return 0;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
}

/** Evenly spaced round ticks covering lo..hi (lo <= 0 <= hi), about four steps. */
export function niceTicks(lo: number, hi: number): number[] {
  const span = Math.max(hi - lo, 4);
  const step = niceMax(span / 4);
  const start = Math.floor(lo / step) * step;
  const end = Math.ceil(hi / step) * step || step;
  const out: number[] = [];
  for (let v = start; v <= end + step / 2; v += step) out.push(Math.round(v));
  return out;
}

const axisProps = {
  stroke: "var(--viz-axis)",
  tick: { fill: "var(--viz-axis)", fontSize: 11 },
  tickLine: false,
  axisLine: false,
} as const;

function ChartTooltip({ active, payload, label, rows }: any) {
  if (!active || !payload?.length) return null;
  const point = payload[0]?.payload;
  return (
    <div className="rounded-xl border border-app-border bg-app-card px-3 py-2 shadow-lg text-xs min-w-[150px]">
      <div className="font-semibold text-app-text mb-1">{point?.fullLabel ?? label}</div>
      {payload
        .filter((p: any) => p.value !== null && p.value !== undefined)
        .map((p: any) => (
          <div key={p.dataKey} className="flex items-center justify-between gap-4 py-0.5">
            <span className="flex items-center gap-1.5 text-app-text-muted">
              <span className="inline-block w-2.5 h-0.5 rounded" style={{ background: p.color || p.stroke || p.fill }} />
              {rows?.[p.dataKey] ?? p.name}
            </span>
            <span className="font-semibold text-app-text tabular-nums">{formatKsh(p.value)}</span>
          </div>
        ))}
    </div>
  );
}

/** Sales, expenses and profit over time, on one KSh axis. */
export function TrendChart({
  series, frame, visible, height, animate = true,
}: {
  series: SeriesPoint[];
  frame: number | null;
  visible: SeriesKey[];
  height: number | string;
  animate?: boolean;
}) {
  const { data, ticks, hasNegative } = useMemo(() => {
    let hi = 0;
    let lo = 0;
    for (const p of series) for (const k of visible) {
      hi = Math.max(hi, p[k]);
      lo = Math.min(lo, p[k]);
    }
    const rows = series.map((p, i) => {
      const row: any = { label: p.label, fullLabel: p.fullLabel };
      for (const k of visible) row[k] = frame === null || i <= frame || k === "prevSales" ? p[k] : null;
      return row;
    });
    return { data: rows, ticks: niceTicks(lo, hi), hasNegative: lo < 0 };
  }, [series, frame, visible]);

  const dense = series.length > 14;
  return (
    <div style={{ height }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
          <CartesianGrid stroke="var(--viz-grid)" vertical={false} />
          <XAxis dataKey="label" {...axisProps} minTickGap={16} interval="preserveStartEnd" />
          <YAxis {...axisProps} width={44} domain={[ticks[0], ticks[ticks.length - 1]]} ticks={ticks} tickFormatter={formatAxis} allowDataOverflow />
          {hasNegative && <ReferenceLine y={0} stroke="var(--viz-axis)" />}
          <Tooltip content={<ChartTooltip rows={Object.fromEntries(Object.entries(SERIES).map(([k, v]) => [k, v.label]))} />} cursor={{ stroke: "var(--viz-axis)", strokeWidth: 1 }} />
          {visible.map((k) => (
            <Line
              key={k}
              type="monotone"
              dataKey={k}
              name={SERIES[k].label}
              stroke={SERIES[k].color}
              strokeWidth={k === "prevSales" ? 1.5 : 2}
              dot={dense ? false : { r: 3, strokeWidth: 0, fill: SERIES[k].color }}
              activeDot={{ r: 5, strokeWidth: 2, stroke: "var(--app-card)" }}
              connectNulls={false}
              isAnimationActive={animate}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Sales per branch over time. */
export function BranchTrendChart({
  branches, labels, frame, height, animate = true,
}: {
  branches: { id: string; name: string; color: string; perSlot: number[] }[];
  labels: { label: string; fullLabel: string }[];
  frame: number | null;
  height: number | string;
  animate?: boolean;
}) {
  const { data, ticks } = useMemo(() => {
    let hi = 0;
    const rows = labels.map((l, i) => {
      const row: any = { ...l };
      for (const b of branches) {
        hi = Math.max(hi, b.perSlot[i]);
        row[b.id] = frame === null || i <= frame ? b.perSlot[i] : null;
      }
      return row;
    });
    return { data: rows, ticks: niceTicks(0, hi) };
  }, [branches, labels, frame]);
  const names = Object.fromEntries(branches.map((b) => [b.id, b.name]));
  return (
    <div style={{ height }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
          <CartesianGrid stroke="var(--viz-grid)" vertical={false} />
          <XAxis dataKey="label" {...axisProps} minTickGap={16} interval="preserveStartEnd" />
          <YAxis {...axisProps} width={44} domain={[0, ticks[ticks.length - 1]]} ticks={ticks} tickFormatter={formatAxis} allowDataOverflow />
          <Tooltip content={<ChartTooltip rows={names} />} cursor={{ stroke: "var(--viz-axis)", strokeWidth: 1 }} />
          {branches.map((b) => (
            <Line key={b.id} type="monotone" dataKey={b.id} name={b.name} stroke={b.color} strokeWidth={2} dot={false} activeDot={{ r: 5, strokeWidth: 2, stroke: "var(--app-card)" }} isAnimationActive={animate} />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

const hourLabel = (h: number) => {
  const d = new Date(2000, 0, 1, h);
  return d.toLocaleTimeString(undefined, { hour: "numeric" });
};

/** When in the day sales happen. Inline it trims quiet hours at both ends. */
export function HoursChart({ hours, scaleHours, height, trim = true, animate = true }: { hours: number[]; scaleHours: number[]; height: number | string; trim?: boolean; animate?: boolean }) {
  const data = useMemo(() => {
    let first = 0;
    let last = 23;
    if (trim) {
      const busy = scaleHours.map((v, i) => (v > 0 ? i : -1)).filter((i) => i >= 0);
      if (busy.length) {
        first = Math.max(0, busy[0] - 1);
        last = Math.min(23, busy[busy.length - 1] + 1);
      } else {
        first = 6;
        last = 21;
      }
    }
    const rows = [];
    for (let h = first; h <= last; h++) rows.push({ label: hourLabel(h), fullLabel: `${hourLabel(h)} to ${hourLabel((h + 1) % 24)}`, sales: hours[h] });
    return rows;
  }, [hours, scaleHours, trim]);
  const ticks = niceTicks(0, Math.max(...scaleHours, 0));
  return (
    <div style={{ height }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 4, left: 0, bottom: 0 }} barCategoryGap={2}>
          <CartesianGrid stroke="var(--viz-grid)" vertical={false} />
          <XAxis dataKey="label" {...axisProps} minTickGap={8} interval="preserveStartEnd" />
          <YAxis {...axisProps} width={44} domain={[0, ticks[ticks.length - 1]]} ticks={ticks} tickFormatter={formatAxis} allowDataOverflow />
          <Tooltip content={<ChartTooltip rows={{ sales: "Sales" }} />} cursor={{ fill: "var(--viz-grid)", opacity: 0.6 }} />
          <Bar dataKey="sales" name="Sales" fill="var(--viz-1)" radius={[4, 4, 0, 0]} isAnimationActive={animate} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export interface RankRow {
  key: string;
  label: string;
  value: number;
  /** Right-aligned extra, e.g. "12 sold" or a growth figure. */
  note?: React.ReactNode;
  color?: string;
}

/**
 * Ranked horizontal bars in plain HTML: the name sits above its bar so long names
 * wrap instead of colliding with the bar or the figure.
 */
export function RankedBars({ rows, scaleMax, limit = 6, color = "var(--viz-1)", format = formatKsh, emptyText = "Nothing recorded in this period", sort = true }: { rows: RankRow[]; sort?: boolean; scaleMax: number; limit?: number; color?: string; format?: (n: number) => string; emptyText?: string }) {
  const sorted = sort ? [...rows].sort((a, b) => b.value - a.value) : rows;
  const shown = sorted.slice(0, limit);
  const rest = sorted.slice(limit);
  if (rest.length) shown.push({ key: "__other", label: `${rest.length} more`, value: rest.reduce((s, r) => s + r.value, 0), color: "var(--viz-muted)" });
  const max = scaleMax || 1;
  if (!shown.length || shown.every((r) => r.value === 0)) return <EmptyChart text={emptyText} />;
  return (
    <ol className="space-y-3">
      {shown.map((r) => (
        <li key={r.key} className="min-w-0">
          <div className="flex items-baseline justify-between gap-3 text-[13px]">
            <span className="min-w-0 text-app-text break-words">{r.label}</span>
            <span className="shrink-0 font-semibold text-app-text tabular-nums">{format(r.value)}</span>
          </div>
          <div className="mt-1 flex items-center gap-2">
            <div className="h-2 flex-1 rounded-full bg-[var(--viz-grid)] overflow-hidden">
              <div className="h-full rounded-full transition-[width] duration-300 ease-out" style={{ width: `${Math.max(0, Math.min(100, (r.value / max) * 100))}%`, background: r.color || color }} />
            </div>
            {r.note !== undefined && <span className="shrink-0 text-[11px] text-app-text-muted tabular-nums min-w-[52px] text-right">{r.note}</span>}
          </div>
        </li>
      ))}
    </ol>
  );
}

/** Part-to-whole: one segmented bar with a labelled list beneath. */
export function ShareBar({ parts }: { parts: { key: string; label: string; value: number; color: string }[] }) {
  const total = parts.reduce((s, p) => s + Math.max(0, p.value), 0);
  if (total <= 0) return <EmptyChart text="No money recorded in this period" />;
  return (
    <div>
      <div className="flex h-3 w-full gap-[2px] overflow-hidden rounded-full" role="img" aria-label={parts.map((p) => `${p.label} ${Math.round((p.value / total) * 100)}%`).join(", ")}>
        {parts.filter((p) => p.value > 0).map((p) => (
          <div key={p.key} className="h-full transition-[flex-grow] duration-300 first:rounded-l-full last:rounded-r-full" style={{ flexGrow: p.value, flexBasis: 0, background: p.color }} title={`${p.label}: ${formatKsh(p.value)}`} />
        ))}
      </div>
      <ul className="mt-4 space-y-2">
        {parts.map((p) => (
          <li key={p.key} className="flex items-center justify-between gap-3 text-[13px]">
            <span className="flex items-center gap-2 min-w-0">
              <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: p.color }} />
              <span className="text-app-text truncate">{p.label}</span>
            </span>
            <span className="flex items-baseline gap-2 shrink-0 tabular-nums">
              <span className="font-semibold text-app-text">{formatKsh(p.value)}</span>
              <span className="text-app-text-muted text-[11px] w-9 text-right">{Math.round((p.value / total) * 100)}%</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function EmptyChart({ text }: { text: string }) {
  return <div className="flex h-full min-h-[120px] items-center justify-center text-sm text-app-text-muted text-center px-4">{text}</div>;
}

/** Series chips that double as the legend: tap to show or hide a line. */
export function SeriesToggle({ keys, visible, onToggle, totals }: { keys: SeriesKey[]; visible: SeriesKey[]; onToggle: (k: SeriesKey) => void; totals?: Partial<Record<SeriesKey, number>> }) {
  return (
    <div className="flex flex-wrap gap-2">
      {keys.map((k) => {
        const on = visible.includes(k);
        return (
          <button
            key={k}
            type="button"
            onClick={() => onToggle(k)}
            aria-pressed={on}
            className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs transition cursor-pointer ${on ? "border-app-border bg-app-bg text-app-text" : "border-transparent text-app-text-muted opacity-60"}`}
          >
            <span className="inline-block w-3 h-0.5 rounded" style={{ background: SERIES[k].color }} />
            <span>{SERIES[k].label}</span>
            {totals?.[k] !== undefined && <span className="font-semibold tabular-nums">{formatKsh(totals[k]!, true)}</span>}
          </button>
        );
      })}
    </div>
  );
}
