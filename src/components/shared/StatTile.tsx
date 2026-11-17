// src/components/shared/StatTile.tsx
// A figure with a coloured icon, its label and one short note. The colour carries meaning:
// amber = activity, emerald = money in / good, rose = money out / cost, sky = people or counts,
// violet = points, red = needs attention. Put tiles in a StatGrid (two across on phones).

import React from 'react';

export type StatTone = 'amber' | 'emerald' | 'rose' | 'sky' | 'violet' | 'slate' | 'red';

const ICON_TONE: Record<StatTone, string> = {
  amber: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
  emerald: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
  rose: 'bg-rose-500/15 text-rose-600 dark:text-rose-400',
  sky: 'bg-sky-500/15 text-sky-600 dark:text-sky-400',
  violet: 'bg-violet-500/15 text-violet-600 dark:text-violet-400',
  slate: 'bg-app-bg text-app-text-muted ring-1 ring-app-border',
  red: 'bg-red-500/15 text-red-600 dark:text-red-400',
};

export function StatTile({ icon, label, value, note, tone = 'slate', trend, onClick, inset, className = '' }: {
  icon?: React.ReactNode;
  label: string;
  value: React.ReactNode;
  note?: React.ReactNode;
  tone?: StatTone;
  /** Colours the note: up is good, down is bad. */
  trend?: 'up' | 'down';
  onClick?: () => void;
  /** On a card or sheet (grey tile) instead of on the page (white tile). */
  inset?: boolean;
  className?: string;
}) {
  const Comp: React.ElementType = onClick ? 'button' : 'div';
  return (
    <Comp
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      className={`min-w-0 rounded-2xl p-3 text-left ${inset ? 'bg-app-bg' : 'bg-app-card shadow-xs'} ${onClick ? 'cursor-pointer hover:ring-1 hover:ring-amber-500/40' : ''} ${className}`}
    >
      <div className="flex items-center gap-2 min-w-0">
        {icon && <span className={`grid place-items-center size-7 shrink-0 rounded-lg [&>svg]:size-[15px] ${ICON_TONE[tone]}`}>{icon}</span>}
        <span className="text-[11px] font-medium text-app-text-muted leading-tight line-clamp-2">{label}</span>
      </div>
      <div className={`mt-2 text-lg font-bold leading-tight tabular-nums truncate ${tone === 'red' ? 'text-red-600 dark:text-red-400' : 'text-app-text'}`}>{value}</div>
      {note != null && note !== '' && (
        <div className={`mt-0.5 text-[11px] leading-snug truncate ${trend === 'up' ? 'text-emerald-600 dark:text-emerald-400' : trend === 'down' ? 'text-red-600 dark:text-red-400' : 'text-app-text-muted'}`}>{note}</div>
      )}
    </Comp>
  );
}

/** Two tiles across on phones, four on wider screens. */
export function StatGrid({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <div className={`grid grid-cols-2 sm:grid-cols-4 gap-2 ${className}`}>{children}</div>;
}

export default StatTile;
