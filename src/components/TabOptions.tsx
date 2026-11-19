import React, { useEffect, useRef } from "react";

export interface TabOption<T extends string> {
  id: T;
  label: string;
  icon?: React.ReactNode;
  /** A count shown beside the label. Zero hides it. */
  badge?: number;
  /** Shows a small dot, for something new inside the tab. */
  dot?: boolean;
  /** `data-shortcut` name, so global search and page keys can open this tab. */
  shortcut?: string;
}

interface TabsProps<T extends string> {
  tabs: TabOption<T>[];
  activeTab: T;
  onChange: (tabId: T) => void;
  className?: string;
  /** Extra classes merged onto each individual tab button. */
  tabClassName?: string;
}

/** Keeps the chosen tab in view when a row of tabs is wider than the phone. */
function useActiveInView(activeKey: string) {
  const rowRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const row = rowRef.current;
    const el = row?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (!row || !el || row.scrollWidth <= row.clientWidth) return;
    const left = el.offsetLeft - row.offsetLeft;
    if (left < row.scrollLeft || left + el.offsetWidth > row.scrollLeft + row.clientWidth) {
      row.scrollTo({ left: Math.max(0, left - 24), behavior: "smooth" });
    }
  }, [activeKey]);
  return rowRef;
}

function Badge({ n }: { n?: number }) {
  if (!n) return null;
  return (
    <span className="rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[11px] text-amber-500">
      {n > 99 ? "99+" : n}
    </span>
  );
}

export function Tabs<T extends string>({
  tabs,
  activeTab,
  onChange,
  className = "",
  tabClassName = "",
}: TabsProps<T>) {
  const rowRef = useActiveInView(activeTab);
  return (
    <div ref={rowRef} role="tablist" className={`tab-row flex items-center gap-2 overflow-x-auto scrollbar-none border-b border-app-border pb-4 ${className}`}>
      {tabs.map((tab) => {
        const isActive = activeTab === tab.id;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={isActive}
            data-shortcut={tab.shortcut}
            onClick={() => onChange(tab.id)}
            className={`inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap px-4 py-2 rounded text-[11px] font-semibold transition-all ${tabClassName} ${
              isActive
                ? "bg-amber-500/10 text-amber-500 border border-amber-500/20"
                : "text-app-text-muted hover:bg-app-card border border-transparent"
            }`}
          >
            {tab.dot && <span className="w-1.5 h-1.5 shrink-0 rounded-full bg-red-500" />}
            {tab.icon}
            {tab.label}
            <Badge n={tab.badge} />
          </button>
        );
      })}
    </div>
  );
}

export interface TabGroup<T extends string> {
  id: string;
  label: string;
  icon?: React.ReactNode;
  /** Shortcut for the group itself, pressed by search or page keys. */
  shortcut?: string;
  tabs: TabOption<T>[];
}

interface GroupedTabsProps<T extends string> {
  groups: TabGroup<T>[];
  activeTab: T;
  onChange: (tabId: T) => void;
  className?: string;
}

/**
 * Two rows of tabs for screens with many parts: up to four groups on top as equal segments,
 * and the parts of the open group as chips below. Keep group labels to one or two short words
 * so the top row fits a 360px phone without scrolling.
 * A group button lists its parts' shortcuts in data-shortcut-within, so search can open a part
 * that isn't on screen yet (see utils/pressShortcut).
 */
export function GroupedTabs<T extends string>({ groups, activeTab, onChange, className = "" }: GroupedTabsProps<T>) {
  const shown = groups.filter((g) => g.tabs.length > 0);
  const active = shown.find((g) => g.tabs.some((t) => t.id === activeTab)) ?? shown[0];
  const lastInGroup = useRef<Record<string, T>>({});
  if (active) lastInGroup.current[active.id] = activeTab;
  const topRef = useActiveInView(active?.id ?? "");
  const subRef = useActiveInView(activeTab);
  if (!active) return null;

  return (
    <div className={`space-y-2 min-w-0 ${className}`}>
      {/* Equal-width segments: up to four short labels always fit a phone without scrolling. */}
      <div ref={topRef} role="tablist" className="grid grid-flow-col auto-cols-fr gap-1 rounded-xl bg-app-card p-1 ring-1 ring-app-border">
        {shown.map((g) => {
          const isActive = g.id === active.id;
          const badge = g.tabs.reduce((s, t) => s + (t.badge || 0), 0);
          const within = g.tabs.map((t) => t.shortcut).filter(Boolean).join(" ");
          return (
            <button
              key={g.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              data-shortcut={g.shortcut}
              data-shortcut-within={within || undefined}
              onClick={() => onChange(lastInGroup.current[g.id] && g.tabs.some((t) => t.id === lastInGroup.current[g.id]) ? lastInGroup.current[g.id] : g.tabs[0].id)}
              className={`min-w-0 inline-flex items-center justify-center gap-1 rounded-lg px-1.5 py-2 text-xs font-semibold transition cursor-pointer ${
                isActive ? "bg-amber-500 text-slate-950 shadow-xs" : "text-app-text-muted hover:text-app-text"
              }`}
            >
              {g.tabs.some((t) => t.dot) && <span className="w-1.5 h-1.5 shrink-0 rounded-full bg-red-500" />}
              <span className="hidden sm:inline-flex shrink-0">{g.icon}</span>
              <span className="whitespace-nowrap">{g.label}</span>
              {!!badge && <span className={`shrink-0 rounded-full px-1.5 text-[10px] leading-4 ${isActive ? "bg-slate-950/15" : "bg-amber-500/15 text-amber-600"}`}>{badge > 99 ? "99+" : badge}</span>}
            </button>
          );
        })}
      </div>
      {active.tabs.length > 1 && (
        <div ref={subRef} role="tablist" aria-label={active.label} className="tab-row flex items-center gap-1.5 overflow-x-auto scrollbar-none">
          {active.tabs.map((t) => {
            const isActive = t.id === activeTab;
            return (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={isActive}
                data-shortcut={t.shortcut}
                onClick={() => onChange(t.id)}
                className={`inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap px-3 py-1.5 rounded-full text-xs font-medium cursor-pointer transition ${
                  isActive ? "bg-app-text text-app-bg" : "bg-app-card text-app-text border border-app-border"
                }`}
              >
                {t.dot && <span className="w-1.5 h-1.5 shrink-0 rounded-full bg-red-500" />}
                {t.icon}
                {t.label}
                <Badge n={t.badge} />
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
