// src/components/shared/FloatingButton.tsx
// A small round floating button that can be dragged out of the way. Drag it anywhere; on
// release it snaps to the nearest side edge, stays inside the safe areas (below the header and
// status bar, above the bottom nav and the phone's bar) and remembers where it was left.
// A tap (no drag) presses it.

import React, { useCallback, useEffect, useRef, useState } from 'react';

const SIZE = 44;
const EDGE = 12;

function bounds() {
  const css = getComputedStyle(document.documentElement);
  const px = (v: string) => parseFloat(css.getPropertyValue(v)) || 0;
  const vh = window.visualViewport?.height ?? window.innerHeight;
  const vw = window.visualViewport?.width ?? window.innerWidth;
  const header = document.querySelector('.app-header')?.getBoundingClientRect().bottom ?? px('--inset-top') + 56;
  // Room the bottom nav leaves on phones (--mobile-nav-space), or just the phone's bar on wide screens.
  const bottomRoom = vw < 768 ? px('--inset-bottom') + 76 : px('--inset-bottom') + 16;
  return {
    vw,
    minTop: Math.max(px('--inset-top'), header) + EDGE,
    maxTop: vh - bottomRoom - SIZE,
    minLeft: px('--inset-left') + EDGE,
    maxLeft: vw - px('--inset-right') - EDGE - SIZE,
  };
}

type Spot = { side: 'left' | 'right'; top: number };

export function FloatingButton({ id, icon, label, onClick, className = 'bg-violet-600 text-white hover:bg-violet-500' }: {
  /** Remembers the position per button. */
  id: string;
  icon: React.ReactNode;
  /** Tooltip and screen-reader name. */
  label: string;
  onClick: () => void;
  className?: string;
}) {
  const key = `fab-spot:${id}`;
  const [spot, setSpot] = useState<Spot | null>(() => {
    try {
      const s = JSON.parse(localStorage.getItem(key) || 'null');
      return s && (s.side === 'left' || s.side === 'right') && typeof s.top === 'number' ? s : null;
    } catch {
      return null;
    }
  });
  const [drag, setDrag] = useState<{ x: number; y: number } | null>(null);
  const start = useRef<{ x: number; y: number; ox: number; oy: number; moved: boolean } | null>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const [, force] = useState(0);

  // Keep it on screen when the window turns or the keyboard opens.
  useEffect(() => {
    const re = () => force((n) => n + 1);
    window.addEventListener('resize', re);
    window.visualViewport?.addEventListener('resize', re);
    return () => {
      window.removeEventListener('resize', re);
      window.visualViewport?.removeEventListener('resize', re);
    };
  }, []);

  const place = useCallback((): { left: number; top: number } => {
    const b = bounds();
    if (drag) return { left: Math.min(b.maxLeft, Math.max(b.minLeft, drag.x)), top: Math.min(b.maxTop, Math.max(b.minTop, drag.y)) };
    const s = spot ?? { side: 'right' as const, top: b.maxTop };
    return { left: s.side === 'left' ? b.minLeft : b.maxLeft, top: Math.min(b.maxTop, Math.max(b.minTop, s.top)) };
  }, [drag, spot]);

  const pos = place();

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    start.current = { x: e.clientX, y: e.clientY, ox: pos.left, oy: pos.top, moved: false };
    btn.current?.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const s = start.current;
    if (!s) return;
    const dx = e.clientX - s.x;
    const dy = e.clientY - s.y;
    if (!s.moved && Math.hypot(dx, dy) < 6) return;
    s.moved = true;
    setDrag({ x: s.ox + dx, y: s.oy + dy });
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const s = start.current;
    start.current = null;
    btn.current?.releasePointerCapture?.(e.pointerId);
    if (!s) return;
    if (!s.moved) {
      onClick();
      return;
    }
    const b = bounds();
    const p = place();
    const next: Spot = { side: p.left + SIZE / 2 < b.vw / 2 ? 'left' : 'right', top: p.top };
    setDrag(null);
    setSpot(next);
    try {
      localStorage.setItem(key, JSON.stringify(next));
    } catch {
      /* private window: position just isn't remembered */
    }
  };

  return (
    <button
      ref={btn}
      type="button"
      aria-label={label}
      title={`${label} (drag to move)`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => { start.current = null; setDrag(null); }}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } }}
      style={{ left: pos.left, top: pos.top, width: SIZE, height: SIZE, touchAction: 'none' }}
      className={`fixed z-40 grid place-items-center rounded-full shadow-lg ring-2 ring-white/70 dark:ring-slate-900/70 select-none cursor-grab active:cursor-grabbing [&>svg]:size-5 ${
        drag ? 'scale-110 opacity-90' : 'transition-[left,top] duration-200 ease-out'
      } ${className}`}
    >
      {icon}
    </button>
  );
}

export default FloatingButton;
