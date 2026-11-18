// src/utils/workedHours.ts
// Hours worked from clock-in and clock-out times. Used by WorkedHoursPanel; kept free of
// React so the tests can check the maths.
import type { Shift } from '../types';

export type Period = 'day' | 'week' | 'month';

/** Start and end (exclusive) of the period containing `anchor`. Weeks start on Monday. */
export function periodRange(period: Period, anchor: Date): { from: Date; to: Date } {
  const from = new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate());
  if (period === 'week') from.setDate(from.getDate() - ((from.getDay() + 6) % 7));
  if (period === 'month') from.setDate(1);
  const to = new Date(from);
  if (period === 'day') to.setDate(to.getDate() + 1);
  if (period === 'week') to.setDate(to.getDate() + 7);
  if (period === 'month') to.setMonth(to.getMonth() + 1);
  return { from, to };
}

/** Minutes of a shift inside [from, to), counting an open shift up to now. */
export function minutesWithin(shift: Pick<Shift, 'startTime' | 'endTime'>, from: Date, to: Date, now = Date.now()): number {
  const start = Math.max(new Date(shift.startTime).getTime(), from.getTime());
  const end = Math.min(shift.endTime ? new Date(shift.endTime).getTime() : now, to.getTime());
  return Math.max(0, Math.round((end - start) / 60000));
}

export function formatHours(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

