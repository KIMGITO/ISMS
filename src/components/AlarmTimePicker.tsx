// src/components/AlarmTimePicker.tsx
// Picks one time, like setting an alarm: hour, minute, AM/PM, and quick "in 5 min" choices.
// Shows the time the same way the app shows it everywhere ("1:38 PM"), whatever the phone's
// own clock setting, unlike the browser's time box.

import React from 'react';
import { AlarmClock } from 'lucide-react';
import { formatClock, minutesFromNow, parseClock, toClock } from '../utils/timeFormat';

interface Props {
  /** "HH:MM", 24-hour */
  value: string;
  onChange: (time: string) => void;
  /** Quick choices also move the day (for example "in 1 hr" late at night is tomorrow). */
  onQuickPick?: (date: string, time: string) => void;
  disabled?: boolean;
}

const HOURS = Array.from({ length: 12 }, (_, i) => i + 1);
const MINUTES = Array.from({ length: 60 }, (_, i) => i);
const QUICK = [
  { label: '+5 min', minutes: 5 },
  { label: '+15 min', minutes: 15 },
  { label: '+30 min', minutes: 30 },
  { label: '+1 hr', minutes: 60 },
];

const selectClass =
  'bg-app-bg text-app-text text-lg font-mono font-black px-2 py-1.5 rounded-xl border border-app-border focus:border-amber-500 focus:outline-none cursor-pointer disabled:opacity-50';

export default function AlarmTimePicker({ value, onChange, onQuickPick, disabled }: Props) {
  const parts = parseClock(value) || { hour: 9, minute: 0 };
  const pm = parts.hour >= 12;
  const hour12 = parts.hour % 12 === 0 ? 12 : parts.hour % 12;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5">
        <AlarmClock size={18} className="text-amber-500 shrink-0" aria-hidden />
        <select
          aria-label="Hour"
          disabled={disabled}
          value={hour12}
          onChange={(e) => onChange(toClock(Number(e.target.value), parts.minute, pm))}
          className={selectClass}
        >
          {HOURS.map((h) => (
            <option key={h} value={h}>{h}</option>
          ))}
        </select>
        <span className="text-lg font-black text-app-text">:</span>
        <select
          aria-label="Minute"
          disabled={disabled}
          value={parts.minute}
          onChange={(e) => onChange(toClock(hour12, Number(e.target.value), pm))}
          className={selectClass}
        >
          {MINUTES.map((m) => (
            <option key={m} value={m}>{String(m).padStart(2, '0')}</option>
          ))}
        </select>
        <div role="radiogroup" aria-label="AM or PM" className="flex rounded-xl border border-app-border overflow-hidden ml-1">
          {(['AM', 'PM'] as const).map((p) => {
            const active = (p === 'PM') === pm;
            return (
              <button
                key={p}
                type="button"
                role="radio"
                aria-checked={active}
                disabled={disabled}
                onClick={() => onChange(toClock(hour12, parts.minute, p === 'PM'))}
                className={`px-2.5 py-2 text-xs font-black transition cursor-pointer ${active ? 'bg-amber-500 text-slate-950' : 'bg-app-bg text-app-text-muted hover:text-app-text'}`}
              >
                {p}
              </button>
            );
          })}
        </div>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {QUICK.map((q) => (
          <button
            key={q.label}
            type="button"
            disabled={disabled}
            onClick={() => {
              const next = minutesFromNow(q.minutes);
              onChange(next.time);
              onQuickPick?.(next.date, next.time);
            }}
            className="px-2 py-1 text-[10px] font-bold rounded-lg border border-app-border bg-app-bg text-app-text-muted hover:text-amber-500 hover:border-amber-500/40 transition cursor-pointer"
            title={`Set to ${formatClock(minutesFromNow(q.minutes).time)}`}
          >
            {q.label}
          </button>
        ))}
      </div>
    </div>
  );
}
