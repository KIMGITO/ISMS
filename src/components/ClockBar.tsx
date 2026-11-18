import { useEffect, useState } from 'react';
import { AlertTriangle, Clock, LogIn, LogOut, X } from 'lucide-react';
import EndShiftModal from './EndShiftModal';
import { FormSheet } from './shared/FormSheet';
import { SupabaseService } from '../services/supabaseService';
import { useNotificationStore } from '../stores/notificationStore';
import { toUserMessage } from '../utils/userError';
import type { Shift } from '../types';
import { useAuthStore } from '../stores/authStore';
import { useBusinessStore } from '../stores/businessStore';
import { formatCurrency } from '../utils/helpers';
import { getSupabase, isSupabaseConfigured } from '../services/supabaseClient';

const LONG_SHIFT_HOURS = 10;
/** How long "Still working?" waits before the database clocks the person out (20261130002). */
const ANSWER_MS = 3 * 60000;
const SEEN_AUTO_KEY = 'clockbar.seenAutoClockOut';

function formatCountdown(ms: number): string {
  const secs = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
}

function readSeen(): string | null {
  try { return localStorage.getItem(SEEN_AUTO_KEY); } catch { return null; }
}
function writeSeen(id: string) {
  try { localStorage.setItem(SEEN_AUTO_KEY, id); } catch { /* private window */ }
}

function formatElapsed(ms: number): string {
  const minutes = Math.max(0, Math.floor(ms / 60000));
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

/** Always-visible clock in/out, so nobody has to go looking for it. */
export default function ClockBar() {
  const currentEmployee = useAuthStore((s) => s.currentEmployee);
  const activeShift = useAuthStore((s) => s.activeShift);
  const punchIn = useAuthStore((s) => s.punchIn);
  const restoreActiveShift = useAuthStore((s) => s.restoreActiveShift);
  const activeBusinessId = useBusinessStore((s) => s.activeBusinessId);

  const [now, setNow] = useState(Date.now());
  const [isBusy, setIsBusy] = useState(false);
  const [isEnding, setIsEnding] = useState(false);
  const [isAnswering, setIsAnswering] = useState(false);
  const [askHidden, setAskHidden] = useState<string | null>(null);
  const [autoClosed, setAutoClosed] = useState<Shift | null>(null);

  const employeeId = currentEmployee?.id;
  const askedAt = activeShift?.stillOnAskedAt ?? null;

  // The database holds the one open shift per person. Every device and session
  // follows it: reload on open, on any change to this person's shifts (realtime),
  // when the app comes back to the screen or back online, and every minute as a
  // fallback in case the realtime connection dropped.
  useEffect(() => {
    if (!employeeId || !activeBusinessId) return;
    restoreActiveShift();

    const refresh = () => restoreActiveShift();
    const onVisible = () => { if (document.visibilityState === 'visible') refresh(); };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', refresh);
    window.addEventListener('online', refresh);
    const poll = setInterval(refresh, 60000);

    let channel: any = null;
    if (isSupabaseConfigured()) {
      const supabase = getSupabase();
      channel = supabase
        .channel(`shift-watch-${employeeId}-${Date.now()}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'shifts', filter: `employee_id=eq.${employeeId}` }, refresh)
        .subscribe();
    }

    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', refresh);
      window.removeEventListener('online', refresh);
      clearInterval(poll);
      if (channel) getSupabase().removeChannel(channel);
    };
  }, [employeeId, activeBusinessId, restoreActiveShift]);

  // Every second while "Still working?" is waiting, so the countdown moves; else every 30 s.
  useEffect(() => {
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), askedAt ? 1000 : 30000);
    return () => clearInterval(timer);
  }, [askedAt]);

  // Once the 3 minutes are up the database closes the shift within a minute: check often.
  const deadline = askedAt ? new Date(askedAt).getTime() + ANSWER_MS : null;
  const overdue = deadline != null && now >= deadline;
  useEffect(() => {
    if (!overdue) return;
    restoreActiveShift();
    const t = setInterval(() => restoreActiveShift(), 15000);
    return () => clearInterval(t);
  }, [overdue, restoreActiveShift]);

  // Not clocked in: was the last shift closed automatically? Say so until they've seen it.
  const hasShift = Boolean(activeShift);
  useEffect(() => {
    if (hasShift || !employeeId || !activeBusinessId || !isSupabaseConfigured()) {
      setAutoClosed(null);
      return;
    }
    let live = true;
    SupabaseService.fetchLastClosedShift(activeBusinessId, employeeId)
      .then((last) => {
        if (!live || !last?.closedAutomatically || !last.endTime) return;
        const recent = Date.now() - new Date(last.endTime).getTime() < 48 * 3600000;
        if (recent && readSeen() !== last.id) setAutoClosed(last);
      })
      .catch(() => undefined);
    return () => { live = false; };
  }, [hasShift, employeeId, activeBusinessId]);

  if (!currentEmployee) return null;

  const answerStillWorking = async () => {
    if (!activeShift) return;
    setIsAnswering(true);
    try {
      await SupabaseService.confirmStillOnShift(activeShift.id);
      await restoreActiveShift();
      useNotificationStore.getState().showToast('Still on shift', "You'll be asked again in 2 hours.", undefined, 'success');
    } catch (err) {
      useNotificationStore.getState().showToast('Could Not Answer', toUserMessage(err, 'Please try again.'), undefined, 'error');
      restoreActiveShift();
    } finally {
      setIsAnswering(false);
    }
  };

  const dismissAutoClosed = () => {
    if (autoClosed) writeSeen(autoClosed.id);
    setAutoClosed(null);
  };

  const handleClockIn = async () => {
    setIsBusy(true);
    await punchIn();
    setIsBusy(false);
  };

  if (!activeShift) {
    const autoEnd = autoClosed?.endTime ? new Date(autoClosed.endTime) : null;
    return (
      <div id="clock-bar" className="shrink-0 flex items-center justify-between gap-3 px-3 py-2 bg-amber-500/15 border-b border-amber-500/30">
        <span className="flex items-center gap-2 text-sm font-semibold text-app-text min-w-0">
          <Clock size={18} className="shrink-0 text-amber-600" aria-hidden="true" />
          {autoClosed && autoEnd ? (
            <span className="min-w-0">
              <span className="block truncate">You were clocked out automatically</span>
              <span className="block truncate text-xs font-medium text-app-text-muted">
                At {autoEnd.toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' })} after{' '}
                {formatElapsed(autoEnd.getTime() - new Date(autoClosed.startTime).getTime())}. Nobody answered "Still working?".
              </span>
            </span>
          ) : (
            <span className="truncate">You're not clocked in</span>
          )}
        </span>
        {autoClosed && (
          <button type="button" onClick={dismissAutoClosed} aria-label="Dismiss" className="shrink-0 p-2 -mr-1 rounded-lg text-app-text-muted hover:bg-app-bg cursor-pointer">
            <X size={16} />
          </button>
        )}
        <button
          type="button"
          onClick={handleClockIn}
          disabled={isBusy}
          className="shrink-0 min-h-11 px-4 flex items-center gap-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-bold cursor-pointer disabled:opacity-60"
        >
          <LogIn size={16} aria-hidden="true" />
          Clock in
        </button>
      </div>
    );
  }

  const elapsed = now - new Date(activeShift.startTime).getTime();
  const isLong = elapsed > LONG_SHIFT_HOURS * 3600000;
  const left = deadline != null ? deadline - now : 0;

  if (askedAt) {
    return (
      <>
        <div id="clock-bar" className="shrink-0 flex items-center justify-between gap-2 px-3 py-1.5 border-b bg-red-500/15 border-red-500/30">
          <span className="flex items-center gap-2 text-xs sm:text-sm font-semibold text-app-text min-w-0">
            <AlertTriangle size={16} className="shrink-0 text-red-600" aria-hidden="true" />
            <span className="truncate">
              {overdue ? 'Clocking you out…' : `Still working? Answer in ${formatCountdown(left)}`}
            </span>
          </span>
          <div className="flex shrink-0 gap-1.5">
            <button
              type="button"
              onClick={answerStillWorking}
              disabled={isAnswering}
              className="min-h-9 px-3 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold cursor-pointer disabled:opacity-60"
            >
              Still working
            </button>
            <button
              type="button"
              onClick={() => setIsEnding(true)}
              className="min-h-9 px-3 flex items-center gap-1.5 rounded-lg bg-red-500 hover:bg-red-600 text-white text-xs font-bold cursor-pointer"
            >
              <LogOut size={14} aria-hidden="true" />
              Clock out
            </button>
          </div>
        </div>

        {askHidden !== askedAt && !isEnding && (
          <FormSheet
            title="Are you still working?"
            subtitle={`You've been clocked in for ${formatElapsed(elapsed)}.`}
            onClose={() => setAskHidden(askedAt)}
            footer={
              <div className="flex flex-col-reverse sm:flex-row gap-2">
                <button
                  type="button"
                  onClick={() => setIsEnding(true)}
                  className="min-h-11 flex-1 rounded-xl border border-app-border px-4 text-sm font-semibold cursor-pointer"
                >
                  Clock out now
                </button>
                <button
                  type="button"
                  onClick={answerStillWorking}
                  disabled={isAnswering}
                  className="min-h-11 flex-1 rounded-xl bg-emerald-600 hover:bg-emerald-700 px-4 text-sm font-bold text-white cursor-pointer disabled:opacity-60"
                >
                  Yes, still working
                </button>
              </div>
            }
          >
            <p className="text-sm">
              {overdue
                ? 'Time is up. You are being clocked out automatically.'
                : <>If you don't answer in <span className="font-bold tabular-nums">{formatCountdown(left)}</span>, you'll be clocked out automatically and the owners will be told.</>}
            </p>
          </FormSheet>
        )}

        <EndShiftModal isOpen={isEnding} onClose={() => setIsEnding(false)} />
      </>
    );
  }

  return (
    <>
      <div
        id="clock-bar"
        className={`shrink-0 flex items-center justify-between gap-3 px-3 py-1.5 border-b ${
          isLong ? 'bg-amber-500/15 border-amber-500/30' : 'bg-emerald-500/10 border-emerald-500/20'
        }`}
      >
        <span className="flex items-center gap-2 text-xs sm:text-sm font-medium text-app-text min-w-0">
          {isLong ? (
            <AlertTriangle size={16} className="shrink-0 text-amber-600" aria-hidden="true" />
          ) : (
            <Clock size={16} className="shrink-0 text-emerald-600" aria-hidden="true" />
          )}
          <span className="truncate">
            {isLong ? `Still clocked in after ${formatElapsed(elapsed)}. Forgot to clock out?` : `On shift ${formatElapsed(elapsed)}`}
            {!isLong && ` · ${activeShift.salesCount} sales · ${formatCurrency(activeShift.salesTotal)}`}
          </span>
        </span>
        <button
          type="button"
          onClick={() => setIsEnding(true)}
          className="shrink-0 min-h-9 px-3 flex items-center gap-1.5 rounded-lg bg-red-500 hover:bg-red-600 text-white text-xs font-bold cursor-pointer"
        >
          <LogOut size={14} aria-hidden="true" />
          Clock out
        </button>
      </div>

      <EndShiftModal
        isOpen={isEnding}
        onClose={() => setIsEnding(false)}
      />
    </>
  );
}
