import React from "react";

export interface TabOption<T extends string> {
  id: T;
  label: string;
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
    <div className={`flex items-center gap-2 border-b border-app-border pb-4 ${className}`}>
      {tabs.map((tab) => {
        const isActive = activeTab === tab.id;
        return (
          <button
            key={tab.id}
            onClick={() => onChange(tab.id)}
            className={`px-4 py-2 rounded text-[11px] font-black uppercase tracking-widest transition-all ${
              isActive
                ? "bg-amber-500/10 text-amber-500 border border-amber-500/20"
                : "text-app-text-muted hover:bg-app-card border border-transparent"
            }`}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}