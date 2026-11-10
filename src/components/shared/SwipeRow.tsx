// src/components/shared/SwipeRow.tsx
// Phone gestures for list rows, shared by every screen:
//
//   - Swipe a row left: it slides open and PAUSES on its buttons (Archive, Delete, ...).
//     Nothing happens until a button is tapped, and Delete still asks to confirm. Tapping
//     the row, tapping elsewhere, scrolling or swiping back closes it again.
//   - Hold a row (long press): a sheet opens with everything you can do with it ("more").
//     With a mouse, right-click opens the same sheet.
//
//   <SwipeRow
//     title={p.name}
//     actions={[{ label: 'Delete', icon: <Trash2 size={18} />, tone: 'red', onClick: () => remove(p) }]}
//     more={[{ label: 'Edit', icon: <Pencil size={16} />, onClick: () => edit(p) }, ...]}
//   >
//     ...the row as before...
//   </SwipeRow>
//
// Swiping only happens on touch screens; desktop rows keep their own buttons.

import React, { useEffect, useRef, useState } from 'react';
import { AnimatePresence, animate, motion, useDragControls, useMotionValue, type PanInfo } from 'motion/react';
import { SheetLayer } from './SheetLayer';
import { useOverlay } from '../../hooks/useOverlay';

export type RowActionTone = 'red' | 'sky' | 'amber' | 'emerald' | 'slate' | 'violet';

export interface RowAction {
  label: string;
  icon?: React.ReactNode;
  onClick: () => void;
  /** Colour of the button behind the row. Red items are also red in the sheet. */
  tone?: RowActionTone;
  /** Red text in the sheet (implied by tone "red"). */
  danger?: boolean;
  disabled?: boolean;
  /** Leave the item out (handy for permission checks inline). */
  hidden?: boolean;
}

const TONES: Record<RowActionTone, string> = {
  red: 'bg-red-600',
  sky: 'bg-sky-600',
  amber: 'bg-amber-500',
  emerald: 'bg-emerald-600',
  slate: 'bg-slate-500',
  violet: 'bg-violet-600',
};

const ACTION_W = 76;
const LONG_PRESS_MS = 480;

const prefersReducedMotion = () =>
  typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Only one row is open at a time: opening one closes the last. */
let closeOpenRow: (() => void) | null = null;

/** Presses that start on these belong to the control, not the row. */
function isFormField(target: EventTarget | null) {
  const el = target as HTMLElement | null;
  return !!el?.closest?.('input, textarea, select, [contenteditable="true"], [data-no-swipe]');
}

const visible = (list?: RowAction[]) => (list || []).filter((a) => !a.hidden);

interface Props {
  children: React.ReactNode;
  /** Buttons revealed by swiping left, right-most last. Usually Archive and Delete. */
  actions?: RowAction[];
  /** Everything shown on long press / right-click. Defaults to `actions`. */
  more?: RowAction[];
  /** Heading of the long-press sheet: the row's name. */
  title?: string;
  subtitle?: string;
  /** Extra detail shown in the long-press sheet above the actions (the "more"). */
  details?: React.ReactNode;
  /** Element to render as. Use "li" inside lists. */
  as?: 'div' | 'li';
  /** Classes for the outer box (margins, rounding, borders). Rounding also clips the tray. */
  className?: string;
  /** Classes for the part that slides (padding, layout, background). */
  contentClassName?: string;
  /** Background of the sliding part; it must be solid so the tray is hidden behind it. */
  surfaceClassName?: string;
  /** Turns the gestures off (e.g. while selecting, or no permission). */
  disabled?: boolean;
  onClick?: (e: React.MouseEvent) => void;
}

export function SwipeRow({
  children,
  actions,
  more,
  title,
  subtitle,
  details,
  as = 'div',
  className = '',
  contentClassName = '',
  surfaceClassName = 'bg-app-card',
  disabled,
  onClick,
}: Props) {
  const tray = visible(actions);
  const sheetItems = more ? visible(more) : tray;
  const canSwipe = !disabled && tray.length > 0;
  const canHold = !disabled && (sheetItems.length > 0 || !!details);
  const trayW = tray.length * ACTION_W;

  const reduced = useRef(prefersReducedMotion()).current;
  const x = useMotionValue(0);
  const controls = useDragControls();
  const [open, setOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const rootRef = useRef<HTMLElement | null>(null);

  const dragged = useRef(false);
  const longPressed = useRef(false);
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pressStart = useRef<{ x: number; y: number } | null>(null);

  const settle = (to: number) => animate(x, to, reduced ? { duration: 0 } : { type: 'spring', stiffness: 500, damping: 40 });

  const close = () => {
    setOpen(false);
    settle(0);
  };

  useEffect(() => {
    if (!open) return;
    if (closeOpenRow && closeOpenRow !== close) closeOpenRow();
    closeOpenRow = close;
    // Tapping anywhere outside the row, or scrolling, closes it.
    const outside = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) close();
    };
    const onScroll = (e: Event) => {
      if (rootRef.current && e.target instanceof Node && e.target.contains(rootRef.current)) close();
    };
    document.addEventListener('pointerdown', outside, true);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      document.removeEventListener('pointerdown', outside, true);
      window.removeEventListener('scroll', onScroll, true);
      if (closeOpenRow === close) closeOpenRow = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Gestures switched off (e.g. permission lost) while open.
  useEffect(() => {
    if (!canSwipe && open) close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canSwipe]);

  const cancelPress = () => {
    if (pressTimer.current) clearTimeout(pressTimer.current);
    pressTimer.current = null;
    pressStart.current = null;
  };
  useEffect(() => cancelPress, []);

  const onPointerDown = (e: React.PointerEvent) => {
    // The sheet is portalled but its React events still bubble here; ignore them.
    if (!rootRef.current?.contains(e.target as Node)) return;
    longPressed.current = false;
    if (e.pointerType === 'mouse' || isFormField(e.target)) return;
    if (canSwipe) controls.start(e);
    if (!canHold || open) return;
    pressStart.current = { x: e.clientX, y: e.clientY };
    pressTimer.current = setTimeout(() => {
      longPressed.current = true;
      pressTimer.current = null;
      try {
        navigator.vibrate?.(12);
      } catch {
        /* not supported */
      }
      setSheetOpen(true);
    }, LONG_PRESS_MS);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const s = pressStart.current;
    if (s && Math.hypot(e.clientX - s.x, e.clientY - s.y) > 8) cancelPress();
  };

  const onDragEnd = (_: unknown, info: PanInfo) => {
    const at = x.get();
    // A short or slow swipe falls back closed; a long or fast one stops on the buttons.
    // However far it goes, it never acts by itself.
    const next = at < -trayW * 0.35 || (info.velocity.x < -400 && at < 0);
    setOpen(next);
    settle(next ? -trayW : 0);
    setTimeout(() => (dragged.current = false), 60);
  };

  const run = (a: RowAction) => {
    if (a.disabled) return;
    close();
    a.onClick();
  };

  const Tag = as as any;
  return (
    <Tag
      ref={rootRef}
      className={`relative overflow-hidden ${className}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={cancelPress}
      onPointerCancel={cancelPress}
    >
      {canSwipe && (
        <div className="absolute inset-y-0 right-0 flex" style={{ width: trayW }} aria-hidden={!open}>
          {tray.map((a) => (
            <button
              key={a.label}
              type="button"
              tabIndex={open ? 0 : -1}
              disabled={a.disabled}
              onClick={() => run(a)}
              className={`flex-1 h-full flex flex-col items-center justify-center gap-1 px-1 text-white text-xs font-medium cursor-pointer disabled:opacity-50 ${TONES[a.tone || (a.danger ? 'red' : 'slate')]}`}
            >
              {a.icon}
              <span className="leading-tight text-center">{a.label}</span>
            </button>
          ))}
        </div>
      )}

      <motion.div
        drag={canSwipe ? 'x' : false}
        dragListener={false}
        dragControls={controls}
        dragDirectionLock
        dragConstraints={{ left: -trayW, right: 0 }}
        dragElastic={{ left: 0.12, right: 0 }}
        dragMomentum={false}
        style={{ x }}
        onDragStart={() => {
          dragged.current = true;
          cancelPress();
        }}
        onDragEnd={onDragEnd}
        onClickCapture={(e) => {
          // The tap that ends a swipe or a hold, or a tap on an open row, only closes it.
          if (dragged.current || longPressed.current || open) {
            e.stopPropagation();
            e.preventDefault();
            if (open && !dragged.current) close();
          }
        }}
        onClick={onClick}
        onContextMenu={(e) => {
          if (!canHold) return;
          e.preventDefault();
          // A phone sends this on long press too; the timer above already handles that.
          if ((e.nativeEvent as PointerEvent).pointerType !== 'touch' && !longPressed.current && !pressTimer.current) setSheetOpen(true);
        }}
        className={`relative ${surfaceClassName} ${canSwipe ? 'touch-pan-y' : ''} ${canHold ? 'pointer-coarse:select-none pointer-coarse:[-webkit-touch-callout:none]' : ''} ${contentClassName}`}
      >
        {children}
      </motion.div>

      <AnimatePresence>
        {sheetOpen && <MoreSheet title={title} subtitle={subtitle} details={details} items={sheetItems} onClose={() => setSheetOpen(false)} />}
      </AnimatePresence>
    </Tag>
  );
}

/** The "more" sheet: every action for one thing, as a list. Slides up on phones. */
export function MoreSheet({ title, subtitle, details, items, onClose }: { title?: string; subtitle?: string; details?: React.ReactNode; items: RowAction[]; onClose: () => void }) {
  useOverlay(true, onClose, 'dialog');
  const reduced = prefersReducedMotion();
  const list = visible(items);
  return (
    <SheetLayer>
      <motion.div
        className="absolute inset-0 z-[60] flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-[2px] p-2 sm:p-6 pb-[calc(0.5rem+var(--inset-bottom))]"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: reduced ? 0 : 0.15 }}
        // Portalled, but React still bubbles events to the row that opened it: stop them here.
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onClose();
        }}
      >
        <motion.div
          role="menu"
          aria-label={title ? `${title}: actions` : 'Actions'}
          initial={{ y: 40, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 40, opacity: 0 }}
          transition={{ duration: reduced ? 0 : 0.18 }}
          onClick={(e) => e.stopPropagation()}
          className="w-full max-w-sm bg-app-card text-app-text rounded-3xl shadow-2xl ring-1 ring-app-border overflow-hidden"
        >
          {(title || subtitle) && (
            <div className="px-5 pt-4 pb-3 border-b border-app-border/70">
              {title && <h3 className="text-[15px] font-semibold truncate">{title}</h3>}
              {subtitle && <p className="text-xs text-app-text-muted mt-0.5 line-clamp-2">{subtitle}</p>}
            </div>
          )}
          {details && <div className="px-5 py-3 border-b border-app-border/70 max-h-[40vh] overflow-y-auto text-sm">{details}</div>}
          <div className="p-1.5 max-h-[50vh] overflow-y-auto empty:hidden">
            {list.map((it) => {
              const danger = it.danger || it.tone === 'red';
              return (
                <button
                  key={it.label}
                  type="button"
                  role="menuitem"
                  disabled={it.disabled}
                  onClick={() => {
                    onClose();
                    // Let the sheet close first so a confirm dialog opens on a clear screen.
                    setTimeout(it.onClick, 0);
                  }}
                  className={`w-full flex items-center gap-3 px-3.5 h-12 rounded-xl text-sm text-left transition cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
                    danger ? 'text-red-600 dark:text-red-400 hover:bg-red-500/10' : 'text-app-text hover:bg-app-bg'
                  }`}
                >
                  <span className="w-5 flex justify-center shrink-0">{it.icon}</span>
                  <span className="flex-1 min-w-0 truncate">{it.label}</span>
                </button>
              );
            })}
          </div>
          <div className="p-1.5 pt-0">
            <button type="button" onClick={onClose} className="w-full h-11 rounded-xl bg-app-bg hover:bg-app-border/50 text-sm font-medium cursor-pointer">
              Cancel
            </button>
          </div>
        </motion.div>
      </motion.div>
    </SheetLayer>
  );
}

export default SwipeRow;
