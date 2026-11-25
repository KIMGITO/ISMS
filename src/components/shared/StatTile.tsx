// src/components/shared/StatTile.tsx
// Figures in the same style as Home's key figures: a joined grid of plain cells split by hairlines,
// each with its label, the figure, and one short line saying what it means. No icon badges.
// The tone colours the sparkline (and the figure when it needs attention):
// amber = activity, emerald = money in / good, rose = money out / cost, sky = people or counts,
// violet = points, red = needs attention. Put tiles in a StatGrid (two across on phones).

import React from 'react';
import { ArrowDownRight, ArrowUpRight, ChevronRight } from 'lucide-react';
import { Sparkline } from './Sparkline';

export type StatTone = 'amber' | 'emerald' | 'rose' | 'sky' | 'violet' | 'slate' | 'red';

const LINE: Record<StatTone, string> = {
  amber: '#d97706',
  emerald: 'var(--good, #059669)',
  rose: '#e11d48',
  sky: '#0284c7',
  violet: '#7c3aed',
  slate: 'var(--viz-muted, #94a3b8)',
  red: 'var(--bad, #dc2626)',
};

export function StatTile({ icon: _icon, label, value, note, tone = 'slate', trend, change, spark, onClick, inset: _inset, className = '' }: {
  /** Kept for older callers; figures no longer show an icon. */
  icon?: React.ReactNode;
  label: string;
  value: React.ReactNode;
  note?: React.ReactNode;
  tone?: StatTone;
  /** Colours the note: up is good, down is bad. */
  trend?: 'up' | 'down';
  /** Change against the last period, shown top right, e.g. "+12%". Coloured by `trend`. */
  change?: string;
  /** Recent values, drawn as a small line in the tone's colour. */
  spark?: number[];
  onClick?: () => void;
  /** Kept for older callers; the grid decides the background. */
  inset?: boolean;
  className?: string;
}) {
  const Comp: React.ElementType = onClick ? 'button' : 'div';
  const trendText = trend === 'up' ? 'text-[var(--good)]' : trend === 'down' ? 'text-[var(--bad)]' : 'text-app-text-muted';
  const TrendIcon = trend === 'down' ? ArrowDownRight : ArrowUpRight;
  return (
    <Comp
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      className={`group min-w-0 p-3.5 sm:p-4 text-left ${onClick ? 'cursor-pointer hover:bg-app-bg/60 transition-colors' : ''} ${className}`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="min-w-0 text-[12px] sm:text-[13px] text-app-text-muted leading-tight line-clamp-2">{label}</span>
        {change ? (
          <span className={`flex shrink-0 items-center gap-0.5 text-xs font-medium ${trendText}`}>
            {trend && <TrendIcon size={13} aria-hidden />}
            {change}
          </span>
        ) : onClick ? (
          <ChevronRight size={14} className="shrink-0 text-app-text-muted opacity-0 group-hover:opacity-100 transition-opacity" aria-hidden />
        ) : null}
      </div>
      <div className={`mt-1 truncate text-[18px] sm:text-[21px] font-semibold leading-tight tabular-nums ${tone === 'red' ? 'text-[var(--bad)]' : 'text-app-text'}`}>{value}</div>
      {spark && spark.length > 1 && <div className="mt-2"><Sparkline values={spark} color={LINE[tone]} className="h-7" /></div>}
      {note != null && note !== '' && (
        <div className={`mt-1 text-[11px] leading-snug truncate ${change ? 'text-app-text-muted' : trendText}`}>{note}</div>
      )}
    </Comp>
  );
}

/**
 * A joined grid of figures with hairline dividers, like Home's key figures. Two across on phones.
 * `inset` when it sits on a card or sheet (grey) instead of on the page (white).
 */
export function StatGrid({ children, cols = 4, inset, className = '' }: { children: React.ReactNode; cols?: 2 | 3 | 4; inset?: boolean; className?: string }) {
  const wide = cols === 4 ? 'sm:grid-cols-4' : cols === 3 ? 'sm:grid-cols-3' : '';
  return (
    <div
      className={`grid grid-cols-2 ${wide} overflow-hidden rounded-2xl border border-app-border ${inset ? 'bg-app-bg' : 'bg-app-card'} [&>*]:-mb-px [&>*]:-mr-px [&>*]:border-b [&>*]:border-r [&>*]:border-app-border ${className}`}
    >
      {children}
    </div>
  );
}

export default StatTile;
