import React from "react";

export interface TabOption<T extends string> {
  id: T;
  label: string;
  icon?: React.ReactNode;
  /** A count shown beside the label. Zero hides it. */
  badge?: number;
  /** Shows a small dot, for something new inside the tab. */
  dot?: boolean;
}

interface TabsProps<T extends string> {
  tabs: TabOption<T>[];
  activeTab: T;
  onChange: (tabId: T) => void;
  className?: string;
}

export function Tabs<T extends string>({
  tabs,
  activeTab,
  onChange,
  className = "",
}: TabsProps<T>) {
  return (
    <div role="tablist" className={`flex items-center gap-2 overflow-x-auto border-b border-app-border pb-4 ${className}`}>
      {tabs.map((tab) => {
        const isActive = activeTab === tab.id;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange(tab.id)}
            className={`inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap px-4 py-2 rounded text-[11px] font-black uppercase tracking-widest transition-all ${
              isActive
                ? "bg-amber-500/10 text-amber-500 border border-amber-500/20"
                : "text-app-text-muted hover:bg-app-card border border-transparent"
            }`}
          >
            {tab.dot && <span className="w-1.5 h-1.5 shrink-0 rounded-full bg-red-500" />}
            {tab.icon}
            {tab.label}
            {!!tab.badge && (
              <span className="rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[9px] text-amber-500">
                {tab.badge > 99 ? "99+" : tab.badge}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
