// src/features/home/ChartViewer.tsx
// A chart on the whole screen, with the other charts one tap away in the top bar.
// Phones turn sideways while it is open; computers go true full screen.

import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Capacitor, registerPlugin } from "@capacitor/core";
import { ChevronLeft, ChevronRight, RotateCw, Table2, BarChart3, X } from "lucide-react";
import { useOverlay } from "../../hooks/useOverlay";
import { PlaybackBar, type Playback } from "./playback";
import type { Bucket } from "./metrics";

const ScreenOrientation = registerPlugin<{ lockLandscape(): Promise<void>; unlock(): Promise<void> }>("ScreenOrientation");

export interface ChartDef {
  id: string;
  title: string;
  subtitle: string;
  /** Uses the shared replay timeline. */
  playable: boolean;
  render: (opts: { full: boolean; frame: number | null; animate: boolean }) => React.ReactNode;
  table: (frame: number | null) => { columns: string[]; rows: (string | number)[][] };
}

const isTouch = () => typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches;
const isPortrait = () => window.innerHeight > window.innerWidth;

async function enterLandscape(el: HTMLElement): Promise<{ native: boolean; locked: boolean; fullscreen: boolean }> {
  if (Capacitor.getPlatform() === "android") {
    try {
      await ScreenOrientation.lockLandscape();
      return { native: true, locked: true, fullscreen: false };
    } catch {
      // Older app builds have no plugin; fall through to the browser route.
    }
  }
  let fullscreen = false;
  try {
    if (el.requestFullscreen && !document.fullscreenElement) {
      await el.requestFullscreen({ navigationUI: "hide" } as any);
      fullscreen = true;
    }
  } catch {
    /* not allowed here; the overlay already covers the window */
  }
  let locked = false;
  if (isTouch()) {
    try {
      await (screen.orientation as any)?.lock?.("landscape");
      locked = true;
    } catch {
      /* most browsers only allow this in full screen, some never */
    }
  }
  return { native: false, locked, fullscreen };
}

async function leaveLandscape(state: { native: boolean; locked: boolean; fullscreen: boolean } | null) {
  if (!state) return;
  if (state.native) await ScreenOrientation.unlock().catch(() => {});
  if (state.locked) try { (screen.orientation as any)?.unlock?.(); } catch { /* ignore */ }
  if (state.fullscreen && document.fullscreenElement) await document.exitFullscreen().catch(() => {});
}

export default function ChartViewer({
  charts, index, onIndex, onClose, playback, buckets, range,
}: {
  charts: ChartDef[];
  index: number;
  onIndex: (i: number) => void;
  onClose: () => void;
  playback: Playback;
  buckets: Bucket[];
  range: { start: Date; end: Date };
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const modeRef = useRef<Awaited<ReturnType<typeof enterLandscape>> | null>(null);
  const [locked, setLocked] = useState(false);
  const [showTable, setShowTable] = useState(false);
  // When the phone could not be turned for us, draw the chart sideways instead.
  const [rotate, setRotate] = useState(false);
  const [autoRotate, setAutoRotate] = useState(true);
  const chart = charts[index];

  useOverlay(true, onClose, "screen");

  useEffect(() => {
    let cancelled = false;
    if (rootRef.current) {
      enterLandscape(rootRef.current).then((m) => {
        if (cancelled) leaveLandscape(m);
        else {
          modeRef.current = m;
          setLocked(m.locked);
        }
      });
    }
    return () => {
      cancelled = true;
      leaveLandscape(modeRef.current);
    };
  }, []);

  useLayoutEffect(() => {
    const update = () => setRotate(autoRotate && isTouch() && isPortrait() && !locked);
    update();
    // The lock takes effect a moment after the request.
    const t = window.setTimeout(update, 600);
    window.addEventListener("resize", update);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener("resize", update);
    };
  }, [autoRotate, locked]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === "INPUT") return;
      if (e.key === "ArrowRight") onIndex((index + 1) % charts.length);
      else if (e.key === "ArrowLeft") onIndex((index - 1 + charts.length) % charts.length);
      else if (e.key === " " && chart.playable) {
        e.preventDefault();
        playback.playing ? playback.pause() : playback.play();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [index, charts.length, chart, playback, onIndex]);

  const frame = chart.playable ? playback.frame : null;
  const table = showTable ? chart.table(frame) : null;

  const panelStyle: React.CSSProperties = rotate
    ? { position: "absolute", top: 0, left: "100%", width: "100vh", height: "100vw", transform: "rotate(90deg)", transformOrigin: "top left" }
    : { position: "absolute", inset: 0 };

  // Rendered into <body>: screens sit in transformed (animated) containers, which would
  // otherwise trap a fixed element inside the screen instead of the whole window.
  return createPortal(
    <div ref={rootRef} className="fixed inset-0 z-200 bg-app-bg text-app-text" role="dialog" aria-modal="true" aria-label={chart.title}>
      <div style={panelStyle} className="flex flex-col pt-[env(safe-area-inset-top,0px)] pb-[env(safe-area-inset-bottom,0px)]">
        {/* Top navigation */}
        <header className="flex items-center gap-1 border-b border-app-border bg-app-card px-2 py-1.5 sm:px-4 sm:py-2 shrink-0">
          <button type="button" onClick={onClose} className="flex h-10 w-10 items-center justify-center rounded-full hover:bg-app-bg cursor-pointer" aria-label="Close full screen">
            <X size={20} />
          </button>
          <button type="button" onClick={() => onIndex((index - 1 + charts.length) % charts.length)} className="flex h-10 w-10 items-center justify-center rounded-full hover:bg-app-bg cursor-pointer" aria-label="Previous chart">
            <ChevronLeft size={20} />
          </button>
          <div className="min-w-0 flex-1 text-center">
            <div className="text-sm font-semibold truncate">{chart.title}</div>
            <div className="text-[11px] text-app-text-muted truncate">{index + 1} of {charts.length} · {chart.subtitle}</div>
          </div>
          <button type="button" onClick={() => onIndex((index + 1) % charts.length)} className="flex h-10 w-10 items-center justify-center rounded-full hover:bg-app-bg cursor-pointer" aria-label="Next chart">
            <ChevronRight size={20} />
          </button>
          <button type="button" onClick={() => setShowTable((v) => !v)} className="flex h-10 w-10 items-center justify-center rounded-full hover:bg-app-bg cursor-pointer" aria-label={showTable ? "Show chart" : "Show table"} title={showTable ? "Chart" : "Table"}>
            {showTable ? <BarChart3 size={18} /> : <Table2 size={18} />}
          </button>
          {isTouch() && !locked && (
            <button type="button" onClick={() => setAutoRotate((v) => !v)} className={`flex h-10 w-10 items-center justify-center rounded-full hover:bg-app-bg cursor-pointer ${autoRotate ? "text-brand-500" : ""}`} aria-label="Turn sideways" title="Turn sideways">
              <RotateCw size={18} />
            </button>
          )}
        </header>

        {/* Chart picker on wide screens */}
        <nav className="hidden md:flex gap-1 overflow-x-auto border-b border-app-border px-4 py-2 shrink-0" aria-label="Charts">
          {charts.map((c, i) => (
            <button
              key={c.id}
              type="button"
              onClick={() => onIndex(i)}
              className={`whitespace-nowrap rounded-full px-3 py-1.5 text-xs cursor-pointer ${i === index ? "bg-app-text text-app-card font-semibold" : "text-app-text-muted hover:bg-app-card hover:text-app-text"}`}
            >
              {c.title}
            </button>
          ))}
        </nav>

        <main className="min-h-0 flex-1 overflow-y-auto px-3 py-3 sm:px-6 sm:py-5">
          {table ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-app-border text-left text-xs text-app-text-muted">
                    {table.columns.map((c, i) => <th key={c} className={`py-2 pr-4 font-medium ${i > 0 ? "text-right" : ""}`}>{c}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {table.rows.map((r, ri) => (
                    <tr key={ri} className="border-b border-app-border/60">
                      {r.map((cell, ci) => <td key={ci} className={`py-2 pr-4 ${ci > 0 ? "text-right tabular-nums" : ""}`}>{cell}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="mx-auto h-full max-w-6xl">{chart.render({ full: true, frame, animate: !playback.playing })}</div>
          )}
        </main>

        {chart.playable && (
          <footer className="shrink-0 border-t border-app-border bg-app-card px-3 py-2 sm:px-6">
            <PlaybackBar playback={playback} buckets={buckets} range={range} compact />
          </footer>
        )}
      </div>
    </div>,
    document.body,
  );
}
