// src/components/RingToneSetting.tsx
// Picks the sound for alarms and urgent alerts, which ring on a loop until Accept.
// Separate from the notification tone. Saved on this device.

import React, { useEffect, useRef, useState } from 'react';
import { AlarmClock, Check, Play, Square } from 'lucide-react';
import { NOTIFICATION_TONES, RingToneService, type RingToneId } from '../services/notifications/notificationTone';
import { ringsNatively, setRingTone } from '../services/notifications/ringingAlerts';
import { useAppStore } from '../stores/appStore';

const PREVIEW_MS = 8000;

const OPTIONS: { id: RingToneId; label: string }[] = [
  { id: 'alarm', label: ringsNatively ? "Phone's alarm sound" : 'Alarm (Reveille)' },
  ...NOTIFICATION_TONES.map((t) => ({ id: t.id as RingToneId, label: t.label })),
];

export default function RingToneSetting() {
  const { showToast } = useAppStore();
  const [toneId, setToneId] = useState<RingToneId>(RingToneService.getId());
  const [playing, setPlaying] = useState<RingToneId | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const stop = () => {
    audio.current?.pause();
    audio.current = null;
    if (timer.current) clearTimeout(timer.current);
    setPlaying(null);
  };

  useEffect(() => stop, []);

  // Plays the tone on a loop for a few seconds, the way an alarm sounds.
  const preview = (id: RingToneId) => {
    stop();
    const a = new Audio(RingToneService.webUrl(id));
    a.loop = true;
    audio.current = a;
    a.play().then(
      () => {
        setPlaying(id);
        timer.current = setTimeout(stop, PREVIEW_MS);
      },
      () => setPlaying(null),
    );
  };

  const choose = async (id: RingToneId) => {
    setToneId(id);
    preview(id);
    await setRingTone(id);
    const label = OPTIONS.find((o) => o.id === id)?.label || 'Tone';
    showToast('Ringing tone saved', `${label} will ring for reminders and urgent alerts on this device.`, undefined, 'success');
  };

  return (
    <div className="rounded-2xl border border-app-border bg-app-bg p-3 mb-3">
      <div className="flex items-center gap-2 mb-1">
        <AlarmClock size={15} className="text-amber-500" />
        <h4 className="text-sm font-semibold text-app-text">Ringing alert tone</h4>
      </div>
      <p className="text-xs text-app-text-muted mb-2.5">
        For reminders and urgent alerts. It keeps ringing until you tap Accept. Saved on this device.
        {ringsNatively && " On the phone it rings at alarm volume, even with the app closed."}
      </p>
      <div role="radiogroup" aria-label="Ringing alert tone" className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
        {OPTIONS.map((o) => {
          const active = toneId === o.id;
          const isPlaying = playing === o.id;
          return (
            <div
              key={o.id}
              className={`flex items-center rounded-xl border text-xs transition ${
                active ? 'border-amber-500/50 bg-amber-500/10 text-amber-600 dark:text-amber-400' : 'border-app-border bg-app-card text-app-text'
              }`}
            >
              <button
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => choose(o.id)}
                className="flex-1 min-w-0 flex items-center gap-1.5 px-2.5 py-2 text-left font-medium cursor-pointer"
              >
                {active ? <Check size={12} strokeWidth={3} className="shrink-0" /> : <span className="w-3 shrink-0" />}
                <span className="truncate">{o.label}</span>
              </button>
              <button
                type="button"
                onClick={() => (isPlaying ? stop() : preview(o.id))}
                aria-label={isPlaying ? `Stop ${o.label}` : `Play ${o.label}`}
                title={isPlaying ? 'Stop' : 'Play'}
                className="px-2 py-2 text-app-text-muted hover:text-amber-500 cursor-pointer shrink-0"
              >
                {isPlaying ? <Square size={11} /> : <Play size={11} />}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
