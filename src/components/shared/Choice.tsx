// src/components/shared/Choice.tsx
// Picking one thing from a short list, without a dropdown. Use these instead of <select>
// whenever the choices fit on screen (up to about eight); for long lists use SearchableDropdown.
//
//   Segmented  – two to five short options in one row of equal parts (period, on/off modes).
//   ChoiceGrid – cards with an icon and a label, for options that need a picture (type, reward).
//   FilterChips – a row of pills with counts that scrolls sideways, for filtering a list.

import React, { useEffect, useRef } from 'react';
import { Check } from 'lucide-react';

export interface ChoiceOption<T extends string> {
  id: T;
  label: string;
  icon?: React.ReactNode;
  /** Shown under the label in a ChoiceGrid. */
  hint?: string;
  /** Tailwind colour classes for the icon chip in a ChoiceGrid, e.g. "bg-sky-500/15 text-sky-600". */
  tone?: string;
  disabled?: boolean;
  count?: number;
}

/** Equal-width segments in one row. Fits a 360px phone with up to five short labels. */
export function Segmented<T extends string>({ options, value, onChange, size = 'md', ariaLabel, className = '' }: {
  options: ChoiceOption<T>[];
  value: T;
  onChange: (v: T) => void;
  size?: 'md' | 'sm';
  ariaLabel?: string;
  className?: string;
}) {
  return (
    <div role="radiogroup" aria-label={ariaLabel} className={`grid grid-flow-col auto-cols-fr gap-1 rounded-xl bg-app-bg p-1 ring-1 ring-app-border min-w-0 ${className}`}>
      {options.map((o) => {
        const on = o.id === value;
        return (
          <button
            key={o.id}
            type="button"
            role="radio"
            aria-checked={on}
            disabled={o.disabled}
            onClick={() => onChange(o.id)}
            className={`min-w-0 inline-flex items-center justify-center gap-1.5 rounded-lg font-semibold transition cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
              size === 'sm' ? 'px-1.5 py-1 text-[11px]' : 'px-2 py-2 text-xs'
            } ${on ? 'bg-app-card text-app-text shadow-sm ring-1 ring-app-border' : 'text-app-text-muted hover:text-app-text'}`}
          >
            {o.icon && <span className={`shrink-0 [&>svg]:size-3.5 ${on ? 'text-amber-600 dark:text-amber-400' : ''}`}>{o.icon}</span>}
            <span className="truncate">{o.label}</span>
            {o.count != null && <span className="shrink-0 tabular-nums opacity-70">{o.count}</span>}
          </button>
        );
      })}
    </div>
  );
}

/** Cards with an icon: a picture for each choice. Two across on phones. */
export function ChoiceGrid<T extends string>({ options, value, onChange, columns = 'grid-cols-2 sm:grid-cols-4', compact, ariaLabel }: {
  options: ChoiceOption<T>[];
  value: T;
  onChange: (v: T) => void;
  /** Tailwind grid-cols classes. */
  columns?: string;
  /** Icon above a one-line label, for five or more small choices in one row. */
  compact?: boolean;
  ariaLabel?: string;
}) {
  return (
    <div role="radiogroup" aria-label={ariaLabel} className={`grid ${columns} gap-2`}>
      {options.map((o) => {
        const on = o.id === value;
        const tone = o.tone ?? 'bg-amber-500/15 text-amber-600 dark:text-amber-400';
        return (
          <button
            key={o.id}
            type="button"
            role="radio"
            aria-checked={on}
            disabled={o.disabled}
            onClick={() => onChange(o.id)}
            className={`relative min-w-0 rounded-xl ring-1 transition cursor-pointer text-left disabled:opacity-40 disabled:cursor-not-allowed ${
              on ? 'ring-2 ring-amber-500 bg-amber-500/5' : 'ring-app-border bg-app-bg hover:ring-amber-500/40'
            } ${compact ? 'flex flex-col items-center gap-1 px-1 py-2.5 text-center' : 'flex items-center gap-2.5 p-2.5'}`}
          >
            {o.icon && (
              <span className={`grid place-items-center shrink-0 rounded-lg [&>svg]:size-4 ${compact ? 'size-8' : 'size-8'} ${tone}`}>{o.icon}</span>
            )}
            <span className="min-w-0 flex-1">
              <span className={`block font-semibold text-app-text leading-tight ${compact ? 'text-[11px] truncate' : 'text-xs'}`}>{o.label}</span>
              {o.hint && !compact && <span className="block text-[11px] text-app-text-muted leading-tight mt-0.5 line-clamp-2">{o.hint}</span>}
            </span>
            {on && !compact && <Check size={14} className="shrink-0 text-amber-600 dark:text-amber-400" />}
          </button>
        );
      })}
    </div>
  );
}

/** Filter pills with counts in a row that scrolls sideways; the chosen one stays in view. */
export function FilterChips<T extends string>({ options, value, onChange, ariaLabel, className = '' }: {
  options: ChoiceOption<T>[];
  value: T;
  onChange: (v: T) => void;
  ariaLabel?: string;
  className?: string;
}) {
  const rowRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const row = rowRef.current;
    const el = row?.querySelector<HTMLElement>('[aria-checked="true"]');
    if (!row || !el || row.scrollWidth <= row.clientWidth) return;
    const left = el.offsetLeft - row.offsetLeft;
    if (left < row.scrollLeft || left + el.offsetWidth > row.scrollLeft + row.clientWidth) row.scrollTo({ left: Math.max(0, left - 24), behavior: 'smooth' });
  }, [value]);
  return (
    <div ref={rowRef} role="radiogroup" aria-label={ariaLabel} className={`flex items-center gap-1.5 overflow-x-auto scrollbar-none -mx-3 px-3 sm:mx-0 sm:px-0 ${className}`}>
      {options.map((o) => {
        const on = o.id === value;
        return (
          <button
            key={o.id}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(o.id)}
            className={`inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-medium cursor-pointer transition ${
              on ? 'bg-app-text text-app-bg' : 'bg-app-card text-app-text ring-1 ring-app-border'
            }`}
          >
            {o.icon && <span className="shrink-0 [&>svg]:size-3.5">{o.icon}</span>}
            {o.label}
            {o.count != null && (
              <span className={`tabular-nums rounded-full px-1.5 text-[10px] leading-4 ${on ? 'bg-app-bg/20' : 'bg-app-bg text-app-text-muted'}`}>{o.count}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
