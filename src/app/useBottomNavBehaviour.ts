// Phones: when the bottom nav shows. Double-tapping empty space toggles it, scrolling a long
// screen hides it (down) and shows it (up), and switching screens brings it back.
import { useEffect, useRef } from 'react';
import { useAppStore } from '../stores/appStore';
import { useUiStore } from '../stores/uiStore';

export function useBottomNavBehaviour(isTourOpen: boolean, isKeyboardVisible: boolean) {
  const { activeTab, showNav, setShowNav, showToast } = useAppStore();

  // Auto-scroll the active mobile tab to center when the active tab changes
  useEffect(() => {
    if (activeTab) {
      setTimeout(() => {
        const activeEl = document.getElementById(`mobile-tab-${activeTab}`);
        if (activeEl) {
          activeEl.scrollIntoView({
            behavior: 'smooth',
            inline: 'center',
            block: 'nearest',
          });
        }
      }, 120);
    }
  }, [activeTab]);

  // Bottom nav: double-tapping empty space hides or shows it, on any screen.
  // Taps on buttons, fields, links and sheets are ignored.
  useEffect(() => {
    let lastTap = { time: 0, x: 0, y: 0 };
    const INTERACTIVE =
      'button, a, input, textarea, select, label, summary, [contenteditable="true"], ' +
      '[role="button"], [role="tab"], [role="menuitem"], [role="option"], [role="slider"], ' +
      '[role="dialog"], nav, .no-nav-toggle';
    const onPointerUp = (e: PointerEvent) => {
      if (e.pointerType === 'mouse' || window.innerWidth >= 768) return; // phones only
      if (isTourOpen) return;
      const target = e.target as Element | null;
      if (!target?.closest || target.closest(INTERACTIVE)) {
        lastTap.time = 0;
        return;
      }
      const now = e.timeStamp;
      const near = Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 40;
      if (now - lastTap.time < 320 && near) {
        lastTap.time = 0;
        const next = !useUiStore.getState().showNav;
        setShowNav(next);
        if (!next) {
          try {
            if (!localStorage.getItem('isms-nav-tap-hint')) {
              localStorage.setItem('isms-nav-tap-hint', '1');
              showToast('Menu hidden', 'Double-tap an empty spot to bring it back.', undefined, 'info');
            }
          } catch {}
        }
        return;
      }
      lastTap = { time: now, x: e.clientX, y: e.clientY };
    };
    window.addEventListener('pointerup', onPointerUp, true);
    return () => window.removeEventListener('pointerup', onPointerUp, true);
  }, [isTourOpen]);

  // Scrolling a long screen also hides the nav (down) and shows it (up). Screens with
  // little to scroll never hide it this way; double-tap covers those. Reaching the end of a
  // screen brings it back, so the last items are never left with an empty gap below.
  // Per scroll area: last position, and where the current up/down movement started.
  const scrollTrack = useRef<WeakMap<Element, { last: number; anchor: number; dir: number }>>(new WeakMap());
  useEffect(() => {
    const scrollable = (el: HTMLElement) => {
      if (el.tagName === 'MAIN') return true;
      const oy = getComputedStyle(el).overflowY;
      return oy === 'auto' || oy === 'scroll';
    };
    const onScroll = (e: Event) => {
      if (activeTab === 'ai' || isTourOpen || window.innerWidth >= 768) return;
      const el = e.target as HTMLElement;
      if (!(el instanceof HTMLElement) || !scrollable(el)) return;
      if (el.closest('[role="dialog"], [aria-modal="true"]')) return; // sheets and popups don't move the nav

      const room = el.scrollHeight - el.clientHeight; // how far this area can scroll
      const y = el.scrollTop;
      const t = scrollTrack.current.get(el) ?? { last: y, anchor: y, dir: 0 };
      const dir = y > t.last ? 1 : y < t.last ? -1 : t.dir;
      if (dir !== t.dir) t.anchor = t.last; // movement changed direction: measure from here
      t.dir = dir;
      t.last = y;
      scrollTrack.current.set(el, t);

      if (room < 160) return; // short screen: double-tap instead
      if (y <= 16 || y >= room - 24) return setShowNav(true); // top or end of the screen
      const moved = y - t.anchor; // distance in the current direction (small steps add up)
      if (moved > 36 && y > 60) setShowNav(false);
      else if (moved < -36) setShowNav(true);
    };
    window.addEventListener('scroll', onScroll, { capture: true, passive: true });
    return () => window.removeEventListener('scroll', onScroll, { capture: true } as EventListenerOptions);
  }, [activeTab, isTourOpen]);

  // The onboarding tour keeps the bottom navigation visible
  useEffect(() => {
    if (isTourOpen) setShowNav(true);
  }, [isTourOpen]);

  // Floating buttons follow the nav down when it hides (screen padding stays fixed)
  useEffect(() => {
    document.documentElement.toggleAttribute('data-nav-hidden', !showNav);
  }, [showNav]);

  // Keyboard open: the clock bar steps aside and screens give back the nav's room
  // (see data-keyboard-open in index.css), so the typing area sits on the keyboard.
  useEffect(() => {
    document.documentElement.toggleAttribute('data-keyboard-open', isKeyboardVisible);
  }, [isKeyboardVisible]);

  // Show bottom nav instantly when switching views
  useEffect(() => {
    setShowNav(true);
  }, [activeTab]);
}
