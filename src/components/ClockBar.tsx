import { useEffect, useState } from 'react';
import { AlertTriangle, Clock, LogIn, LogOut } from 'lucide-react';
import EndShiftModal from './EndShiftModal';
import { useAuthStore } from '../stores/authStore';
import { useBusinessStore } from '../stores/businessStore';
import { finishShift } from '../services/shiftReport';
import { formatCurrency } from '../utils/helpers';

const LONG_SHIFT_HOURS = 10;

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

  const employeeId = currentEmployee?.id;

  // A shift survives restarts and logouts, so it is reloaded from the database.
  useEffect(() => {
    if (employeeId && activeBusinessId) restoreActiveShift();
  }, [employeeId, activeBusinessId, restoreActiveShift]);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(timer);
  }, []);

  if (!currentEmployee) return null;

  const handleClockIn = async () => {
    setIsBusy(true);
    await punchIn();
    setIsBusy(false);
  };

  if (!activeShift) {
    return (
      <div className="shrink-0 flex items-center justify-between gap-3 px-3 py-2 bg-amber-500/15 border-b border-amber-500/30">
        <span className="flex items-center gap-2 text-sm font-semibold text-app-text min-w-0">
          <Clock size={18} className="shrink-0 text-amber-600" aria-hidden="true" />
          <span className="truncate">You're not clocked in</span>
        </span>
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

  return (
    <>
      <div
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
        onConfirm={(reportText, customMessage) => {
          setIsEnding(false);
          finishShift(reportText, customMessage);
        }}
      />
    </>
  );
}
