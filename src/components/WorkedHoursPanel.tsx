// src/components/WorkedHoursPanel.tsx
// Hours worked, from clock-in and clock-out times, for a day, a week or a month.
// Anyone with staff.view sees every worker (tap one for their log); everyone else sees only
// their own. The database decides what each person may read (pol_shifts_select), so this
// screen only chooses how to show it.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronLeft, ChevronRight, Clock, Timer, Users, Zap } from 'lucide-react';
import { Segmented } from './shared/Choice';
import { StatGrid, StatTile } from './shared/StatTile';
import { SupabaseService } from '../services/supabaseService';
import { useAuthStore } from '../stores/authStore';
import { useBusinessStore } from '../stores/businessStore';
import { hasRolePermission } from '../utils/permissions';
import type { Shift } from '../types';
import { formatHours, minutesWithin, periodRange, type Period } from '../utils/workedHours';


const PERIODS: { id: Period; label: string }[] = [
  { id: 'day' as const, label: 'Day' },
  { id: 'week' as const, label: 'Week' },
  { id: 'month' as const, label: 'Month' },
];

function periodTitle(period: Period, from: Date, to: Date): string {
  if (period === 'day') return from.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'short' });
  if (period === 'month') return from.toLocaleDateString([], { month: 'long', year: 'numeric' });
  const last = new Date(to.getTime() - 86400000);
  return `${from.toLocaleDateString([], { day: 'numeric', month: 'short' })} – ${last.toLocaleDateString([], { day: 'numeric', month: 'short' })}`;
}

const timeOf = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const dayOf = (iso: string) => new Date(iso).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' });

interface WorkerTotal {
  employeeId: string;
  name: string;
  minutes: number;
  shifts: Shift[];
  auto: number;
  open: boolean;
}

export default function WorkedHoursPanel() {
  const currentEmployee = useAuthStore((s) => s.currentEmployee);
  const employees = useAuthStore((s) => s.employees);
  const activeShiftId = useAuthStore((s) => s.activeShift?.id ?? null);
  const businessId = useBusinessStore((s) => s.activeBusinessId);

  const [period, setPeriod] = useState<Period>('week');
  const [anchor, setAnchor] = useState(() => new Date());
  const [shifts, setShifts] = useState<Shift[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [openWorker, setOpenWorker] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());

  const seesEveryone = currentEmployee ? hasRolePermission(currentEmployee.role, 'staff.view') : false;
  const myId = currentEmployee?.id;
  const { from, to } = useMemo(() => periodRange(period, anchor), [period, anchor]);
  const isCurrent = from.getTime() <= now && now < to.getTime();

  const load = useCallback(async () => {
    if (!businessId || !myId) return;
    try {
      const rows = await SupabaseService.fetchShiftsOverlapping(businessId, from, to, seesEveryone ? undefined : myId);
      setShifts(rows);
      setFailed(false);
    } catch {
      setFailed(true);
      setShifts((s) => s ?? []);
    }
  }, [businessId, myId, from, to, seesEveryone]);

  // Reload when the period changes or someone clocks in or out here.
  useEffect(() => {
    setShifts(null);
    load();
  }, [load, activeShiftId]);

  // A shift still running keeps adding minutes.
  useEffect(() => {
    if (!isCurrent) return;
    const t = setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(t);
  }, [isCurrent]);

  const totals = useMemo<WorkerTotal[]>(() => {
    const byWorker = new Map<string, WorkerTotal>();
    for (const s of shifts ?? []) {
      const minutes = minutesWithin(s, from, to, now);
      const row = byWorker.get(s.employeeId) ?? {
        employeeId: s.employeeId,
        name: employees.find((e) => e.id === s.employeeId)?.name
          ?? (s.employeeId === myId ? currentEmployee?.name ?? 'You' : 'Former worker'),
        minutes: 0,
        shifts: [],
        auto: 0,
        open: false,
      };
      row.minutes += minutes;
      row.shifts.push(s);
      if (s.closedAutomatically) row.auto += 1;
      if (!s.endTime) row.open = true;
      byWorker.set(s.employeeId, row);
    }
    return [...byWorker.values()].sort((a, b) => b.minutes - a.minutes);
  }, [shifts, from, to, now, employees, myId, currentEmployee?.name]);

  const mine = totals.find((t) => t.employeeId === myId);
  const teamMinutes = totals.reduce((sum, t) => sum + t.minutes, 0);
  const teamAuto = totals.reduce((sum, t) => sum + t.auto, 0);

  const move = (dir: -1 | 1) => {
    const next = new Date(from);
    if (period === 'day') next.setDate(next.getDate() + dir);
    if (period === 'week') next.setDate(next.getDate() + 7 * dir);
    if (period === 'month') next.setMonth(next.getMonth() + dir);
    setAnchor(next);
  };

  const renderLog = (list: Shift[]) => (
    <ul className="divide-y divide-app-border/60">
      {[...list].reverse().map((s) => (
        <li key={s.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5 py-2 text-sm">
          <span className="min-w-0">
            <span className="font-medium">{dayOf(s.startTime)}</span>
            <span className="text-app-text-muted">
              {' '}· {timeOf(s.startTime)} – {s.endTime ? timeOf(s.endTime) : 'still clocked in'}
              {s.endTime && dayOf(s.endTime) !== dayOf(s.startTime) ? ` (${dayOf(s.endTime)})` : ''}
            </span>
          </span>
          <span className="flex items-center gap-2">
            {s.closedAutomatically && (
              <span className="rounded-full bg-red-500/10 px-2 py-0.5 text-[11px] font-semibold text-red-600 dark:text-red-400" title='Nobody answered "Still working?"'>
                Clocked out automatically
              </span>
            )}
            <span className="font-semibold tabular-nums">{formatHours(minutesWithin(s, from, to, now))}</span>
          </span>
        </li>
      ))}
    </ul>
  );

  if (!currentEmployee) return null;

  return (
    <section className="bg-app-card border border-app-border rounded-2xl p-4 shadow-sm flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <Timer size={16} className="text-amber-500" />
          {seesEveryone ? 'Hours worked' : 'My hours'}
        </h3>
        <Segmented<Period> options={PERIODS} value={period} onChange={setPeriod} size="sm" ariaLabel="Period" className="w-full sm:w-64" />
      </div>

      <div className="flex items-center justify-between gap-2">
        <button type="button" onClick={() => move(-1)} aria-label="Previous" className="p-2 rounded-lg border border-app-border hover:bg-app-bg cursor-pointer">
          <ChevronLeft size={14} />
        </button>
        <div className="flex flex-col items-center min-w-0">
          <span className="text-sm font-semibold truncate">{periodTitle(period, from, to)}</span>
          {!isCurrent && (
            <button type="button" onClick={() => setAnchor(new Date())} className="text-xs font-medium text-amber-600 dark:text-amber-400 cursor-pointer">
              Back to {period === 'day' ? 'today' : `this ${period}`}
            </button>
          )}
        </div>
        <button type="button" onClick={() => move(1)} aria-label="Next" className="p-2 rounded-lg border border-app-border hover:bg-app-bg cursor-pointer">
          <ChevronRight size={14} />
        </button>
      </div>

      {failed && <p className="text-sm text-red-600 dark:text-red-400">Could not load hours. Check the connection and try again.</p>}

      {shifts === null ? (
        <p className="text-sm text-app-text-muted">Loading hours…</p>
      ) : seesEveryone ? (
        <>
          <StatGrid>
            <StatTile inset icon={<Clock />} tone="amber" label="Team hours" value={formatHours(teamMinutes)} />
            <StatTile inset icon={<Users />} tone="sky" label="Worked" value={totals.length} note={totals.length === 1 ? 'person' : 'people'} />
            <StatTile inset icon={<Timer />} tone="slate" label="My hours" value={formatHours(mine?.minutes ?? 0)} />
            <StatTile inset icon={<Zap />} tone={teamAuto > 0 ? 'red' : 'slate'} label="Clocked out automatically" value={teamAuto} />
          </StatGrid>
          {totals.length === 0 ? (
            <p className="text-sm text-app-text-muted">Nobody clocked in during this time.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {totals.map((t) => {
                const isOpen = openWorker === t.employeeId;
                return (
                  <li key={t.employeeId} className="rounded-xl bg-app-bg">
                    <button
                      type="button"
                      onClick={() => setOpenWorker(isOpen ? null : t.employeeId)}
                      aria-expanded={isOpen}
                      className="w-full flex items-center justify-between gap-3 px-3 py-2.5 text-left cursor-pointer"
                    >
                      <span className="min-w-0">
                        <span className="block text-sm font-semibold truncate">
                          {t.name}
                          {t.open && <span className="ml-2 text-xs font-medium text-emerald-600 dark:text-emerald-400">on shift</span>}
                        </span>
                        <span className="block text-xs text-app-text-muted">
                          {t.shifts.length} {t.shifts.length === 1 ? 'shift' : 'shifts'}
                          {t.auto > 0 && <span className="text-red-600 dark:text-red-400"> · {t.auto} clocked out automatically</span>}
                        </span>
                      </span>
                      <span className="flex items-center gap-2 shrink-0">
                        <span className="text-base font-bold tabular-nums">{formatHours(t.minutes)}</span>
                        <ChevronDown size={14} className={`transition ${isOpen ? 'rotate-180' : ''}`} />
                      </span>
                    </button>
                    {isOpen && <div className="px-3 pb-2">{renderLog(t.shifts)}</div>}
                  </li>
                );
              })}
            </ul>
          )}
        </>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            <StatTile inset icon={<Clock />} tone="amber" label="Hours worked" value={formatHours(mine?.minutes ?? 0)} />
            <StatTile inset icon={<Timer />} tone="sky" label="Shifts" value={mine?.shifts.length ?? 0}
              note={mine && mine.shifts.length > 0 ? `About ${formatHours(mine.minutes / mine.shifts.length)} each` : undefined} />
            <StatTile inset icon={<Zap />} tone={(mine?.auto ?? 0) > 0 ? 'red' : 'slate'} label="Clocked out automatically" value={mine?.auto ?? 0} />
          </div>
          {mine ? renderLog(mine.shifts) : <p className="text-sm text-app-text-muted">You did not clock in during this time.</p>}
        </>
      )}
    </section>
  );
}
