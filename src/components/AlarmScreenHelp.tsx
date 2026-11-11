// src/components/AlarmScreenHelp.tsx
// About screen: "Alarm not filling the screen?" Explains when Android shows the full alarm
// screen, shows this phone's live alarm checks (AlarmHealthCard), then the switches this
// phone's brand adds. Each brand step is a button that opens that exact setting; the ones
// Android can report show a tick once they're on. Android only.

import { useCallback, useEffect, useState } from 'react';
import { App } from '@capacitor/app';
import { CheckCircle2, ChevronDown, ChevronRight, Info } from 'lucide-react';
import AlarmHealthCard from './AlarmHealthCard';
import { getAlarmStatus, hasNativeAlarms, openAlarmSettings, type AlarmStatus } from '../services/notifications/alarmSync';
import { PHONE_BRAND_TIPS, brandFor, stepDone, type PhoneBrandTips } from '../utils/alarmPhoneTips';

function BrandSteps({ brand, status }: { brand: PhoneBrandTips; status: AlarmStatus | null }) {
  return (
    <ol className="space-y-1.5">
      {brand.steps.map((step, i) => {
        const done = stepDone(step.target, status);
        return (
          <li key={step.text}>
            <button
              onClick={() => openAlarmSettings(step.target)}
              className="w-full flex items-center gap-2 rounded-lg bg-app-bg px-2.5 py-2 min-h-11 text-left hover:bg-amber-500/10"
            >
              <span className="w-5 h-5 shrink-0 rounded-full bg-amber-500/15 text-amber-600 dark:text-amber-400 text-[11px] font-bold flex items-center justify-center">
                {i + 1}
              </span>
              <span className="flex-1 min-w-0 text-xs text-app-text">{step.text}</span>
              {done ? (
                <span className="shrink-0 inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-600">
                  <CheckCircle2 size={13} aria-hidden="true" /> Done
                </span>
              ) : (
                <span className="shrink-0 inline-flex items-center gap-0.5 text-[11px] font-bold text-amber-600 dark:text-amber-400">
                  Open <ChevronRight size={13} aria-hidden="true" />
                </span>
              )}
            </button>
          </li>
        );
      })}
    </ol>
  );
}

export default function AlarmScreenHelp() {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<AlarmStatus | null>(null);

  const refresh = useCallback(() => {
    getAlarmStatus().then(setStatus);
  }, []);

  // Read the phone when opened, and again on coming back from Android settings.
  useEffect(() => {
    if (!open || !hasNativeAlarms) return;
    refresh();
    let remove: (() => void) | null = null;
    App.addListener('resume', refresh).then((h) => (remove = () => h.remove())).catch(() => undefined);
    return () => remove?.();
  }, [open, refresh]);

  if (!hasNativeAlarms) return null;

  const mine = brandFor(status?.manufacturer);
  const others = PHONE_BRAND_TIPS.filter((b) => b.id !== mine?.id);

  return (
    <details id="alarm-screen-help" open={open} onToggle={(e) => setOpen(e.currentTarget.open)} className="group">
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between px-3 pb-1.5 text-xs font-semibold uppercase tracking-wide text-app-text-muted [&::-webkit-details-marker]:hidden">
        Alarm not filling the screen?
        <ChevronDown size={16} className="transition-transform group-open:rotate-180" aria-hidden="true" />
      </summary>

      {open && (
        <div className="bg-app-card rounded-lg p-3 space-y-4 text-sm">
          <p className="flex gap-2 text-xs text-app-text">
            <Info size={14} className="mt-0.5 shrink-0 text-amber-500" aria-hidden="true" />
            <span>
              The full alarm screen only opens when the phone is <strong>locked or the screen is off</strong>. While
              someone is using the phone, Android always shows a ringing banner at the top instead. Test with the
              phone locked.
            </span>
          </p>

          <div>
            <h3 className="text-xs font-semibold text-app-text mb-1">Android settings</h3>
            <p className="text-xs text-app-text-muted mb-2">
              Anything not allowed is listed with a button that opens it. "Alarm screen over the lock screen" matters
              most.
            </p>
            <AlarmHealthCard />
          </div>

          <div>
            <h3 className="text-xs font-semibold text-app-text mb-1">
              {mine
                ? `${mine.name} settings`
                : status?.manufacturer
                  ? `${status.manufacturer} phone`
                  : 'Phone brand settings'}
            </h3>
            {mine ? (
              <>
                <p className="text-xs text-app-text-muted mb-2">
                  Tap each step to open that setting, turn it on, then come back. Names can differ a little between
                  models.
                </p>
                <BrandSteps brand={mine} status={status} />
              </>
            ) : (
              <p className="text-xs text-app-text-muted">
                This phone has no extra brand switches we know of; the Android settings above are enough.
              </p>
            )}
          </div>

          <details className="group/brands">
            <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between text-xs font-semibold text-app-text [&::-webkit-details-marker]:hidden">
              Other phone brands
              <ChevronDown size={14} className="transition-transform group-open/brands:rotate-180" aria-hidden="true" />
            </summary>
            <div className="space-y-3 pt-1">
              {others.map((brand) => (
                <div key={brand.id}>
                  <h4 className="text-xs font-semibold text-app-text mb-1">{brand.name}</h4>
                  <BrandSteps brand={brand} status={status} />
                </div>
              ))}
            </div>
          </details>

          <p className="text-xs text-app-text-muted">
            Still only a banner with everything turned on and the phone locked? Tell your manager the phone's brand and
            model.
          </p>
        </div>
      )}
    </details>
  );
}
