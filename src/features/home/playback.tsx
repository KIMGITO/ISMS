// src/features/home/playback.tsx
// One timeline drives every chart: play reveals the period slot by slot from a chosen date.

import React, { useCallback, useEffect, useState } from "react";
import { Pause, Play, RotateCcw, X } from "lucide-react";
import { bucketIndex, parseDateInput, toDateInput, type Bucket } from "./metrics";

const SPEEDS = [1, 2, 4] as const;
const BASE_STEP_MS = 650;

export interface Playback {
  /** Last slot shown, or null when not replaying (everything shown). */
  frame: number | null;
  playing: boolean;
  speed: number;
  fromDate: string;
  setFromDate: (v: string) => void;
  setSpeed: (v: number) => void;
  play: () => void;
  pause: () => void;
  seek: (i: number) => void;
  stop: () => void;
}

export function usePlayback(buckets: Bucket[], rangeStart: Date): Playback {
  const [frame, setFrame] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [fromDate, setFromDate] = useState(toDateInput(rangeStart));

  // A new period resets the replay.
  useEffect(() => {
    setFrame(null);
    setPlaying(false);
    setFromDate(toDateInput(rangeStart));
  }, [rangeStart.getTime(), buckets.length]);

  const startIndex = useCallback(() => {
    const d = parseDateInput(fromDate);
    if (!d) return 0;
    const i = bucketIndex(d.getTime(), buckets);
    if (i >= 0) return i;
    return d.getTime() < (buckets[0]?.start ?? 0) ? 0 : Math.max(0, buckets.length - 1);
  }, [fromDate, buckets]);

  useEffect(() => {
    if (!playing) return;
    const id = window.setInterval(() => {
      setFrame((f) => {
        const next = (f ?? startIndex()) + 1;
        if (next >= buckets.length - 1) {
          setPlaying(false);
          return buckets.length - 1;
        }
        return next;
      });
    }, BASE_STEP_MS / speed);
    return () => window.clearInterval(id);
  }, [playing, speed, buckets.length, startIndex]);

  const play = useCallback(() => {
    if (buckets.length < 2) return;
    setFrame((f) => (f === null || f >= buckets.length - 1 ? startIndex() : f));
    setPlaying(true);
  }, [buckets.length, startIndex]);

  return {
    frame,
    playing,
    speed,
    fromDate,
    setFromDate: (v) => {
      setFromDate(v);
      setPlaying(false);
      setFrame(null);
    },
    setSpeed,
    play,
    pause: () => setPlaying(false),
    seek: (i) => {
      setPlaying(false);
      setFrame(i);
    },
    stop: () => {
      setPlaying(false);
      setFrame(null);
    },
  };
}

export function PlayButton({ playback, disabled }: { playback: Playback; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={() => (playback.playing ? playback.pause() : playback.play())}
      disabled={disabled}
      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-app-text-muted hover:bg-app-bg hover:text-app-text transition cursor-pointer disabled:opacity-40"
      title={playback.playing ? "Pause" : "Play how this moved over the period"}
      aria-label={playback.playing ? "Pause replay" : "Play replay"}
    >
      {playback.playing ? <Pause size={16} /> : <Play size={16} />}
    </button>
  );
}

/** Controls shown while replaying: play/pause, scrubber, date readout, start date, speed. */
export function PlaybackBar({ playback, buckets, range, compact }: { playback: Playback; buckets: Bucket[]; range: { start: Date; end: Date }; compact?: boolean }) {
  const last = Math.max(0, buckets.length - 1);
  const at = playback.frame ?? last;
  return (
    <div className={`flex flex-wrap items-center gap-x-3 gap-y-2 ${compact ? "" : "rounded-2xl border border-app-border bg-app-card px-3 py-2"}`}>
      <button
        type="button"
        onClick={() => (playback.playing ? playback.pause() : playback.play())}
        disabled={buckets.length < 2}
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-500 text-slate-950 cursor-pointer disabled:opacity-40"
        aria-label={playback.playing ? "Pause" : "Play"}
      >
        {playback.playing ? <Pause size={16} /> : <Play size={16} className="ml-0.5" />}
      </button>
      <div className="min-w-0 flex-1 basis-40">
        <div className="flex items-baseline justify-between gap-2 text-xs">
          <span className="font-semibold text-app-text truncate">{playback.frame === null ? "Whole period" : `Up to ${buckets[at]?.fullLabel ?? ""}`}</span>
          <span className="text-app-text-muted tabular-nums shrink-0">{at + 1}/{buckets.length}</span>
        </div>
        <input
          type="range"
          min={0}
          max={last}
          value={at}
          onChange={(e) => playback.seek(Number(e.target.value))}
          className="mt-1 w-full accent-[var(--color-brand-500)] cursor-pointer"
          aria-label="Move through the period"
        />
      </div>
      <label className="flex items-center gap-1.5 text-xs text-app-text-muted shrink-0">
        From
        <input
          type="date"
          value={playback.fromDate}
          min={toDateInput(range.start)}
          max={toDateInput(range.end)}
          onChange={(e) => playback.setFromDate(e.target.value)}
          className="rounded-lg border border-app-border bg-app-bg px-2 py-1 text-xs text-app-text"
        />
      </label>
      <div className="flex shrink-0 rounded-lg border border-app-border overflow-hidden" role="group" aria-label="Speed">
        {SPEEDS.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => playback.setSpeed(s)}
            className={`px-2 py-1 text-xs cursor-pointer ${playback.speed === s ? "bg-app-text text-app-card font-semibold" : "text-app-text-muted hover:text-app-text"}`}
          >
            {s}×
          </button>
        ))}
      </div>
      {playback.frame !== null && (
        <button type="button" onClick={playback.stop} className="flex items-center gap-1 text-xs text-app-text-muted hover:text-app-text shrink-0 cursor-pointer" title="Show the whole period">
          {playback.playing ? <X size={14} /> : <RotateCcw size={14} />}
          {playback.playing ? "Stop" : "Show all"}
        </button>
      )}
    </div>
  );
}
