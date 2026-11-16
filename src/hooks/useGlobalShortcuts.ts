// src/hooks/useGlobalShortcuts.ts
// Keys that work on every screen, the ones people already know from other apps:
// Ctrl+K search, ? or F1 help, / or Ctrl+F the screen's search box, F5 or Ctrl+R reload,
// Alt+← back, Ctrl+, settings, "G then a letter" to change screen, [ ] for tabs, and the
// page actions listed in utils/shortcuts.ts. POS, Quick Sale and receipts add their own.

import { useEffect, useRef } from "react";
import { pressShortcut } from "../utils/pressShortcut";
import { canOpenScreen, type ScreenId } from "../utils/screens";
import { GO_TO_KEYS, shortcutsFor } from "../utils/shortcuts";

interface Options {
  role: string | undefined;
  activeTab: string;
  navigate: (tab: ScreenId) => void;
  openSearch: () => void;
  toggleHelp: () => void;
  /** Fetch the latest data (the same as pulling down on a phone). */
  reload: () => void;
  /** The previous screen; false when there is none. */
  goBack: () => boolean;
}

const SCREEN_FOR_KEY = new Map(Object.entries(GO_TO_KEYS).map(([screen, key]) => [key as string, screen as ScreenId]));

const isVisible = (el: Element) => (el as HTMLElement).getClientRects().length > 0;

function viewport(): HTMLElement {
  return (document.querySelector(".app-viewport") as HTMLElement | null) || document.body;
}

/** Presses the visible, enabled button tagged data-shortcut=name on the current screen. */
function press(name: string): boolean {
  return pressShortcut(name, viewport());
}

function focusPageSearch(): boolean {
  const input = Array.from(
    viewport().querySelectorAll<HTMLInputElement>('input[type="search"], input[placeholder^="Search" i], [data-shortcut="search"]'),
  ).find(isVisible);
  if (!input) return false;
  input.focus();
  input.select?.();
  return true;
}

function moveTab(step: 1 | -1): boolean {
  const list = Array.from(viewport().querySelectorAll('[role="tablist"]')).find(isVisible);
  if (!list) return false;
  const tabs = Array.from(list.querySelectorAll<HTMLElement>('[role="tab"]')).filter(isVisible);
  if (tabs.length < 2) return false;
  const current = tabs.findIndex((t) => t.getAttribute("aria-selected") === "true");
  const next = tabs[(Math.max(0, current) + step + tabs.length) % tabs.length];
  next.click();
  next.focus();
  return true;
}

export function useGlobalShortcuts({ role, activeTab, navigate, openSearch, toggleHelp, reload, goBack }: Options) {
  const latest = useRef({ role, activeTab, navigate, openSearch, toggleHelp, reload, goBack });
  latest.current = { role, activeTab, navigate, openSearch, toggleHelp, reload, goBack };

  useEffect(() => {
    let goPending = false;
    let goTimer: ReturnType<typeof setTimeout> | undefined;

    const onKey = (e: KeyboardEvent) => {
      const { role, activeTab, navigate, openSearch, toggleHelp, reload, goBack } = latest.current;
      if (!role || e.defaultPrevented || e.isComposing) return;
      const ctrl = (e.ctrlKey || e.metaKey) && !e.altKey;
      const lower = e.key.toLowerCase();

      if (ctrl && !e.shiftKey && lower === "k") {
        e.preventDefault();
        openSearch();
        return;
      }
      // F5 / Ctrl+R fetch the latest data in place. Ctrl+Shift+R is left alone, so it still
      // restarts the whole app the way it does in a browser.
      if (e.key === "F5" || (ctrl && !e.shiftKey && lower === "r")) {
        e.preventDefault();
        reload();
        return;
      }
      if (ctrl && e.key === ",") {
        if (canOpenScreen(role, "settings")) {
          e.preventDefault();
          navigate("settings");
        }
        return;
      }
      if (e.key === "F1") {
        e.preventDefault();
        toggleHelp();
        return;
      }
      if (e.altKey && !e.ctrlKey && !e.metaKey && e.key === "ArrowLeft" && activeTab !== "pos") {
        if (goBack()) e.preventDefault();
        return;
      }
      // Ctrl+F goes to the screen's own search box when it has one; otherwise the browser's find.
      if (ctrl && !e.shiftKey && lower === "f" && !document.querySelector('[role="dialog"][aria-modal="true"]')) {
        if (focusPageSearch()) e.preventDefault();
        return;
      }

      const el = e.target as HTMLElement | null;
      const typing = !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable);
      if (typing || e.ctrlKey || e.metaKey || e.altKey) return;
      // A window is open over the screen (receipt, form, menu): its own keys apply.
      if (document.querySelector('[role="dialog"][aria-modal="true"]')) return;

      const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;

      if (goPending) {
        goPending = false;
        clearTimeout(goTimer);
        const screen = SCREEN_FOR_KEY.get(key);
        if (screen && canOpenScreen(role, screen)) {
          e.preventDefault();
          navigate(screen);
        }
        return;
      }

      // POS and Quick Sale have their own keys for these.
      const ownKeys = activeTab === "pos" || activeTab === "sell";

      if (key === "?") {
        e.preventDefault();
        toggleHelp();
        return;
      }
      if (key === "g") {
        e.preventDefault();
        goPending = true;
        goTimer = setTimeout(() => (goPending = false), 1500);
        return;
      }
      if (ownKeys) return;
      if (key === "/" && focusPageSearch()) return e.preventDefault();
      if ((key === "[" || key === "]") && moveTab(key === "]" ? 1 : -1)) return e.preventDefault();

      // Page actions this role may do on this screen
      const action = shortcutsFor(role).find((s) => s.scope === activeTab && s.key === key && s.target);
      if (action && press(action.target!)) e.preventDefault();
    };

    // The Shortcuts button in POS (and anything else) opens the same help.
    const onHelp = () => latest.current.toggleHelp();
    window.addEventListener("keydown", onKey);
    window.addEventListener("app:shortcut-help", onHelp);
    return () => {
      clearTimeout(goTimer);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("app:shortcut-help", onHelp);
    };
  }, []);
}
