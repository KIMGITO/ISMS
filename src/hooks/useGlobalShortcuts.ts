// src/hooks/useGlobalShortcuts.ts
// Keys that work on every screen: search, help, "G then a letter" to change screen,
// "/" for the screen's search box, [ ] for tabs, and the page actions listed in
// utils/shortcuts.ts. Screens with their own keys (POS, Quick Sale, receipts) keep them.

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
}

const SCREEN_FOR_KEY = new Map(Object.entries(GO_TO_KEYS).map(([screen, key]) => [key, screen as ScreenId]));

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

export function useGlobalShortcuts({ role, activeTab, navigate, openSearch, toggleHelp }: Options) {
  const latest = useRef({ role, activeTab, navigate, openSearch, toggleHelp });
  latest.current = { role, activeTab, navigate, openSearch, toggleHelp };

  useEffect(() => {
    let goPending = false;
    let goTimer: ReturnType<typeof setTimeout> | undefined;

    const onKey = (e: KeyboardEvent) => {
      const { role, activeTab, navigate, openSearch, toggleHelp } = latest.current;
      if (!role || e.defaultPrevented || e.isComposing) return;

      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        openSearch();
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

      if (key === "?" && activeTab !== "pos") {
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

    window.addEventListener("keydown", onKey);
    return () => {
      clearTimeout(goTimer);
      window.removeEventListener("keydown", onKey);
    };
  }, []);
}
