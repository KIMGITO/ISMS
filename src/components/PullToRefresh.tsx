// src/components/PullToRefresh.tsx
// iOS-style pull to refresh for the main screen area on touch devices.
// Pull down from the top of any screen: the content follows your finger with
// resistance, a spinner appears above it, and letting go past the line reloads.
//
// It only starts when every scrolling area under your finger is already at its
// top, so it never fights normal scrolling, and it ignores text fields, dialogs
// and anything fixed on screen (sheets, pop-ups).

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowDown, Loader2 } from 'lucide-react';
import { nativeUiService } from '../core/native/NativeUiService';

const TRIGGER_AT = 72; // px of pull (after resistance) needed to refresh
const MAX_PULL = 120;
const HOLD_AT = 56; // where the content rests while refreshing
const MIN_SPIN_MS = 700; // a refresh never flashes by too fast to see

/** Finger distance → content distance: follows at first, then gets heavier. */
const resist = (dy: number) => Math.min(MAX_PULL, dy * 0.55 - (dy * dy) / 4000);

const isTouchDevice = () =>
  typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches;

/** True when the touch shouldn't start a pull: fields, dialogs, fixed layers, or opted out. */
function isExcluded(target: Element, root: HTMLElement): boolean {
  if (target.closest('input, textarea, select, [contenteditable="true"], [role="dialog"], [data-no-pull]')) return true;
  for (let el: Element | null = target; el && el !== root; el = el.parentElement) {
    if (getComputedStyle(el).position === 'fixed') return true;
  }
  return false;
}

/** True when every scrolling area between the touch and the root is at its top. */
function isAtTop(target: Element, root: HTMLElement): boolean {
  for (let el: Element | null = target; el && el !== root; el = el.parentElement) {
    const style = getComputedStyle(el);
    const scrolls = /(auto|scroll)/.test(style.overflowY) && el.scrollHeight > el.clientHeight + 1;
    if (scrolls && el.scrollTop > 0) return false;
  }
  return true;
}

interface Props {
  onRefresh: () => Promise<void>;
  children: ReactNode;
  /** Classes for the outer area (it is the positioning box for the screens). */
  className?: string;
}

export default function PullToRefresh({ onRefresh, children, className = '' }: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [pull, setPull] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  // Kept in refs so the native listeners (attached once) always see current values
  const refreshRef = useRef(onRefresh);
  refreshRef.current = onRefresh;
  const busyRef = useRef(false);

  useEffect(() => {
    const root = rootRef.current;
    if (!root || !isTouchDevice()) return;

    let startX = 0;
    let startY = 0;
    let tracking = false; // finger down somewhere a pull may start
    let pulling = false; // the gesture has become a pull
    let armed = false; // past the trigger line
    let current = 0;
    let frame = 0;

    const show = (value: number) => {
      current = value;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setPull(value));
    };

    const onStart = (e: TouchEvent) => {
      tracking = false;
      pulling = false;
      if (busyRef.current || e.touches.length !== 1) return;
      const target = e.target as Element;
      if (isExcluded(target, root) || !isAtTop(target, root)) return;
      tracking = true;
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
    };

    const onMove = (e: TouchEvent) => {
      if (!tracking) return;
      const dx = e.touches[0].clientX - startX;
      const dy = e.touches[0].clientY - startY;

      if (!pulling) {
        // Decide what this gesture is: a clear downward pull, or something else
        if (dy < -4 || Math.abs(dx) > 10) {
          tracking = false;
          return;
        }
        if (dy > 8 && dy > Math.abs(dx) * 1.5) {
          if (!isAtTop(e.target as Element, root)) {
            tracking = false;
            return;
          }
          pulling = true;
          armed = false;
          setDragging(true);
        } else {
          return;
        }
      }

      if (e.cancelable) e.preventDefault(); // the page itself must not move
      const value = Math.max(0, resist(dy));
      if (!armed && value >= TRIGGER_AT) {
        armed = true;
        nativeUiService.hapticTap();
      } else if (armed && value < TRIGGER_AT) {
        armed = false;
      }
      show(value);
    };

    const onEnd = async () => {
      if (!pulling) {
        tracking = false;
        return;
      }
      tracking = false;
      pulling = false;
      setDragging(false);

      if (current < TRIGGER_AT) {
        show(0);
        return;
      }

      busyRef.current = true;
      setRefreshing(true);
      show(HOLD_AT);
      const started = Date.now();
      try {
        await refreshRef.current();
        nativeUiService.hapticSuccess();
      } catch {
        nativeUiService.hapticError();
      } finally {
        const wait = MIN_SPIN_MS - (Date.now() - started);
        if (wait > 0) await new Promise((r) => setTimeout(r, wait));
        setRefreshing(false);
        busyRef.current = false;
        show(0);
      }
    };

    root.addEventListener('touchstart', onStart, { passive: true });
    root.addEventListener('touchmove', onMove, { passive: false });
    root.addEventListener('touchend', onEnd, { passive: true });
    root.addEventListener('touchcancel', onEnd, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      root.removeEventListener('touchstart', onStart);
      root.removeEventListener('touchmove', onMove);
      root.removeEventListener('touchend', onEnd);
      root.removeEventListener('touchcancel', onEnd);
    };
  }, []);

  const progress = Math.min(1, pull / TRIGGER_AT);
  const settle = dragging ? 'none' : 'transform 0.4s cubic-bezier(0.32, 0.72, 0, 1), opacity 0.3s ease';

  return (
    <div ref={rootRef} className={className}>
      {/* Spinner above the content; revealed as the content moves down */}
      <div
        aria-hidden={!refreshing}
        role={refreshing ? 'status' : undefined}
        className="pointer-events-none absolute left-1/2 top-0 z-20"
        style={{
          transform: `translate3d(-50%, ${pull - 44}px, 0)`,
          opacity: refreshing ? 1 : progress,
          transition: settle,
        }}
      >
        <div className="w-9 h-9 rounded-full bg-app-card shadow-md flex items-center justify-center text-amber-500">
          {refreshing ? (
            <>
              <Loader2 size={18} className="animate-spin" aria-hidden="true" />
              <span className="sr-only">Refreshing</span>
            </>
          ) : (
            <ArrowDown
              size={18}
              aria-hidden="true"
              style={{
                transform: `rotate(${progress >= 1 ? 180 : 0}deg)`,
                transition: 'transform 0.2s cubic-bezier(0.32, 0.72, 0, 1)',
              }}
            />
          )}
        </div>
      </div>

      {/* The screens, moved down with the pull */}
      <div
        className="app-screens absolute inset-0"
        style={{
          transform: pull ? `translate3d(0, ${pull}px, 0)` : undefined,
          transition: settle,
        }}
      >
        {children}
      </div>
    </div>
  );
}
