// src/hooks/useShortcutBadges.ts
// On big screens every button with a keyboard shortcut shows its key in its bottom-right
// corner. Buttons are tagged data-shortcut="<name>"; the name is looked up in the one list
// of shortcuts (utils/shortcuts.ts), first as a page action of this screen (target), then by
// id. The key is stamped as data-kbd and drawn by CSS (index.css, min-width 1024px), so
// phones never show it and no screen has to draw its own.

import { useEffect } from "react";
import { shortcutsFor } from "../utils/shortcuts";

export function useShortcutBadges(role: string | undefined, activeTab: string) {
  useEffect(() => {
    if (typeof document === "undefined" || !role) return;
    const list = shortcutsFor(role);
    const cache = new Map<string, string | null>();
    const keysFor = (name: string): string | null => {
      if (cache.has(name)) return cache.get(name)!;
      const s =
        list.find((x) => x.target === name && x.scope === activeTab) ??
        list.find((x) => x.id === name && (x.scope === activeTab || x.scope === "everywhere"));
      // "Ctrl+Enter F9" → the first way of pressing it is enough on a small badge.
      const keys = s ? s.keys.split(" ")[0] : null;
      cache.set(name, keys);
      return keys;
    };

    const stamp = () => {
      document.querySelectorAll<HTMLElement>("[data-shortcut]").forEach((el) => {
        // Inputs can't draw a badge; their placeholder already says the key.
        if (el.tagName === "INPUT" || el.tagName === "TEXTAREA") return;
        const keys = keysFor(el.dataset.shortcut || "");
        if (keys) {
          if (el.dataset.kbd !== keys) el.dataset.kbd = keys;
        } else if (el.dataset.kbd) delete el.dataset.kbd;
      });
    };

    let frame = 0;
    const schedule = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        stamp();
      });
    };
    stamp();
    const observer = new MutationObserver(schedule);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-shortcut"] });
    return () => {
      observer.disconnect();
      if (frame) cancelAnimationFrame(frame);
    };
  }, [role, activeTab]);
}
