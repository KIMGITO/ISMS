import React, { useMemo, useState } from 'react';
import { ArrowLeft, ChevronRight, Search } from 'lucide-react';

export interface NavSection<T extends string> {
  id: T;
  group: string;
  label: string;
  description: string;
  icon: React.ElementType;
  /** Extra words people might search for. */
  keywords?: string;
}

interface SectionNavProps<T extends string> {
  sections: NavSection<T>[];
  active: T;
  onSelect: (id: T) => void;
  searchPlaceholder?: string;
  children: React.ReactNode;
}

/**
 * A searchable list of sections beside one open section, for screens with too
 * much to show at once. On phones the list comes first and a section opens over it.
 */
export function SectionNav<T extends string>({
  sections,
  active,
  onSelect,
  searchPlaceholder = 'Search',
  children,
}: SectionNavProps<T>) {
  const [query, setQuery] = useState('');
  const [openOnPhone, setOpenOnPhone] = useState(false);

  const visible = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return sections;
    return sections.filter((s) =>
      `${s.label} ${s.description} ${s.keywords ?? ''}`.toLowerCase().includes(term),
    );
  }, [sections, query]);

  const groups = Array.from(new Set(visible.map((s) => s.group)));
  const current = sections.find((s) => s.id === active);

  return (
    <div className="flex w-full flex-col gap-5 md:flex-row md:items-start">
      <nav aria-label="Sections" className={`w-full shrink-0 md:sticky md:top-0 md:w-64 ${openOnPhone ? 'hidden md:block' : ''}`}>
        <label className="relative mb-4 block">
          <span className="sr-only">{searchPlaceholder}</span>
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-app-text-muted" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={searchPlaceholder}
            className="w-full rounded-xl border border-app-border bg-app-card py-2.5 pl-9 pr-3 text-xs text-app-text outline-none focus:border-amber-500"
          />
        </label>
        {visible.length === 0 && <p className="px-1 text-xs text-app-text-muted">Nothing matches that search.</p>}
        <div className="flex flex-col gap-4">
          {groups.map((group) => (
            <div key={group}>
              <h3 className="mb-1.5 px-3 text-[10px] font-black uppercase tracking-widest text-app-text-muted">{group}</h3>
              <ul className="flex flex-col gap-0.5">
                {visible.filter((s) => s.group === group).map((section) => {
                  const Icon = section.icon;
                  const isActive = section.id === active;
                  return (
                    <li key={section.id}>
                      <button
                        type="button"
                        aria-current={isActive ? 'page' : undefined}
                        onClick={() => {
                          onSelect(section.id);
                          setOpenOnPhone(true);
                        }}
                        className={`flex w-full min-h-11 items-center gap-2.5 rounded-xl px-3 py-2 text-left transition ${
                          isActive
                            ? 'md:bg-amber-500/10 md:text-amber-500 text-app-text'
                            : 'text-app-text hover:bg-app-card'
                        }`}
                      >
                        <Icon size={16} className="shrink-0 text-amber-500" />
                        <span className="min-w-0 flex-1">
                          <span className="block text-xs font-bold">{section.label}</span>
                          <span className="block truncate text-[10px] font-medium text-app-text-muted">{section.description}</span>
                        </span>
                        <ChevronRight size={14} className="shrink-0 text-app-text-muted md:hidden" />
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      </nav>
      <div className={`min-w-0 flex-1 ${openOnPhone ? '' : 'hidden md:block'}`}>
        <button
          type="button"
          onClick={() => setOpenOnPhone(false)}
          className="mb-3 inline-flex min-h-10 items-center gap-1.5 text-xs font-bold text-app-text-muted md:hidden"
        >
          <ArrowLeft size={14} /> All sections
        </button>
        {current && (
          <header className="mb-4">
            <h2 className="font-display text-lg font-bold text-app-text">{current.label}</h2>
            <p className="text-xs font-medium text-app-text-muted">{current.description}</p>
          </header>
        )}
        {children}
      </div>
    </div>
  );
}
