// Pick customer groups as chips, each with how many customers are in it. Within a section
// any chip matches (Gold or Silver); across sections all must (Gold and owes money).
import React, { useMemo, useState } from 'react';
import { ChevronDown, X } from 'lucide-react';
import type { Customer } from '../../types';
import { describeGroups, visibleGroups, type GroupContext } from '../../services/messaging/customerGroups';

interface Props {
  customers: Customer[];
  value: string[];
  onChange: (ids: string[]) => void;
  ctx: GroupContext;
  /** Starts open (no summary row). */
  defaultOpen?: boolean;
}

export function GroupPicker({ customers, value, onChange, ctx, defaultOpen = false }: Props) {
  const [open, setOpen] = useState(defaultOpen);
  const groups = useMemo(() => visibleGroups(ctx), [ctx]);
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const g of groups) m.set(g.id, customers.filter((c) => g.test(c, ctx)).length);
    return m;
  }, [groups, customers, ctx]);
  const sections = useMemo(() => {
    const out = new Map<string, typeof groups>();
    for (const g of groups) out.set(g.section, [...(out.get(g.section) ?? []), g]);
    return [...out.entries()];
  }, [groups]);

  const toggle = (id: string) => onChange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id]);
  const summary = describeGroups(value);

  return (
    <div className="rounded-xl bg-app-bg">
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="min-w-0 flex-1 flex items-center gap-2 px-3 py-2.5 text-left text-sm cursor-pointer"
        >
          <span className="min-w-0 flex-1 truncate">
            {summary ? <span className="font-medium text-app-text">{summary}</span> : <span className="text-app-text-muted">All customers · pick groups</span>}
          </span>
          <ChevronDown size={15} className={`shrink-0 text-app-text-muted transition ${open ? 'rotate-180' : ''}`} />
        </button>
        {value.length > 0 && (
          <button type="button" onClick={() => onChange([])} aria-label="Clear groups" className="p-2 mr-1 rounded-lg text-app-text-muted hover:text-app-text cursor-pointer">
            <X size={14} />
          </button>
        )}
      </div>
      {open && (
        <div className="px-3 pb-3 space-y-2.5 max-h-[45vh] overflow-y-auto">
          {sections.map(([section, list]) => (
            <div key={section}>
              <p className="text-[11px] font-medium text-app-text-muted mb-1">{section}</p>
              <div className="flex flex-wrap gap-1.5">
                {list.map((g) => {
                  const on = value.includes(g.id);
                  const n = counts.get(g.id) ?? 0;
                  return (
                    <button
                      key={g.id}
                      type="button"
                      aria-pressed={on}
                      onClick={() => toggle(g.id)}
                      className={`rounded-full px-2.5 py-1 text-xs font-medium flex items-center gap-1.5 cursor-pointer transition ${
                        on ? 'bg-amber-500 text-slate-950' : 'bg-app-card ring-1 ring-app-border text-app-text hover:ring-amber-500/50'
                      } ${!on && n === 0 ? 'opacity-50' : ''}`}
                    >
                      {g.label}
                      <span className={`tabular-nums ${on ? 'text-slate-950/70' : 'text-app-text-muted'}`}>{n}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
          <p className="text-[11px] text-app-text-muted">Within a section, any choice counts. Across sections, customers need all of them.</p>
        </div>
      )}
    </div>
  );
}
