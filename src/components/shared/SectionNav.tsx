import React, { useMemo, useState } from 'react';
import { useOverlay } from '../../hooks/useOverlay';
import { ArrowLeft, ChevronRight, PanelLeftClose, PanelLeftOpen, Search } from 'lucide-react';

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
  /** Wide screens: lets the list fold to icons only. The choice is remembered under this key. */
  collapseKey?: string;
  /** Phones: whether the open section shows instead of the list. Pass both to control it (a bottom bar). */
  phoneOpen?: boolean;
  onPhoneOpenChange?: (open: boolean) => void;
  children: React.ReactNode;
}

function readCollapsed(key?: string): boolean {
  if (!key) return false;
  try {
    return localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}

/**
 * A searchable list of sections beside one open section, for screens with too
 * much to show at once. On phones the list comes first and a section opens over it.
 * On wider screens it can fold to a column of icons; each stays a button you can Tab to.
 */
export function SectionNav<T extends string>({
  sections,
  active,
  onSelect,
  searchPlaceholder = 'Search',
  collapseKey,
  phoneOpen,
  onPhoneOpenChange,
  children,
}: SectionNavProps<T>) {
  const [query, setQuery] = useState('');
  const [ownOpen, setOwnOpen] = useState(false);
  const controlled = phoneOpen !== undefined && !!onPhoneOpenChange;
  const openOnPhone = controlled ? phoneOpen : ownOpen;
  const setOpenOnPhone = (v: boolean) => (controlled ? onPhoneOpenChange!(v) : setOwnOpen(v));
  const [collapsed, setCollapsed] = useState(() => readCollapsed(collapseKey));
  useOverlay(openOnPhone, () => setOpenOnPhone(false), 'screen');

  const toggle = () =>
    setCollapsed((v) => {
      try {
        if (collapseKey) localStorage.setItem(collapseKey, v ? '0' : '1');
      } catch {
        /* storage blocked */
      }
      return !v;
    });

  // Folded, the search box is hidden, so show every section.
  const visible = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term || collapsed) return sections;
    return sections.filter((s) =>
      `${s.label} ${s.description} ${s.keywords ?? ''}`.toLowerCase().includes(term),
    );
  }, [sections, query, collapsed]);

  const groups = Array.from(new Set(visible.map((s) => s.group)));
  const current = sections.find((s) => s.id === active);
  // Folding only applies from tablet width up; phones always show the full list.
  const c = collapseKey && collapsed;

  return (
    <div className="flex w-full flex-col gap-5 md:flex-row md:items-start">
      <nav
        aria-label="Sections"
        className={`w-full shrink-0 md:sticky md:top-0 transition-[width] duration-200 ${c ? 'md:w-14' : 'md:w-64'} ${openOnPhone ? 'hidden md:block' : ''}`}
      >
        <div className={`mb-4 flex items-center gap-1.5 ${c ? 'md:flex-col md:mb-2' : ''}`}>
          <label className={`relative block flex-1 ${c ? 'md:hidden' : ''}`}>
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
          {collapseKey && (
            <button
              type="button"
              onClick={toggle}
              aria-label={collapsed ? 'Show section names' : 'Show icons only'}
              title={collapsed ? 'Show section names' : 'Show icons only'}
              aria-expanded={!collapsed}
              className="hidden md:grid size-10 shrink-0 place-items-center rounded-xl text-app-text-muted hover:bg-app-card focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 cursor-pointer"
            >
              {collapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
            </button>
          )}
        </div>
        {visible.length === 0 && <p className="px-1 text-xs text-app-text-muted">Nothing matches that search.</p>}
        <div className={`flex flex-col ${c ? 'gap-4 md:gap-2' : 'gap-4'}`}>
          {groups.map((group, gi) => (
            <div key={group} className={c && gi > 0 ? 'md:border-t md:border-app-border/60 md:pt-2' : ''}>
              <h3 className={`mb-1.5 px-3 text-[10px] font-semibold text-app-text-muted ${c ? 'md:sr-only' : ''}`}>{group}</h3>
              <ul className="flex flex-col gap-0.5">
                {visible.filter((s) => s.group === group).map((section) => {
                  const Icon = section.icon;
                  const isActive = section.id === active;
                  return (
                    <li key={section.id}>
                      <button
                        type="button"
                        aria-current={isActive ? 'page' : undefined}
                        aria-label={c ? section.label : undefined}
                        title={c ? `${section.label}: ${section.description}` : undefined}
                        onClick={() => {
                          onSelect(section.id);
                          setOpenOnPhone(true);
                        }}
                        className={`flex w-full min-h-11 items-center gap-2.5 rounded-xl px-3 py-2 text-left transition focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 ${
                          c ? 'md:justify-center md:px-0' : ''
                        } ${isActive ? 'md:bg-amber-500/10 md:text-amber-500 text-app-text' : 'text-app-text hover:bg-app-card'}`}
                      >
                        <Icon size={c ? 18 : 16} className="shrink-0 text-amber-500" />
                        <span className={`min-w-0 flex-1 ${c ? 'md:hidden' : ''}`}>
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
