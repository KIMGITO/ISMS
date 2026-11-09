// src/utils/timeFormat.ts
// One way to write clock times and days across the app: "1:38 PM", "Mon, 9 Nov 2026".
// Times are stored as 24-hour "HH:MM" (what the database keeps); people only see this format.

/** "13:38" or "13:38:00" → "1:38 PM". Returns "" for an empty or bad value. */
export function formatClock(hhmm: string | null | undefined): string {
  const parts = parseClock(hhmm);
  if (!parts) return '';
  const { hour, minute } = parts;
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${h12}:${String(minute).padStart(2, '0')} ${hour < 12 ? 'AM' : 'PM'}`;
}

export function parseClock(hhmm: string | null | undefined): { hour: number; minute: number } | null {
  const m = /^(\d{1,2}):(\d{2})/.exec(hhmm || '');
  if (!m) return null;
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  if (hour > 23 || minute > 59) return null;
  return { hour, minute };
}

/** 12-hour parts → "HH:MM" (24-hour, for saving). */
export function toClock(hour12: number, minute: number, pm: boolean): string {
  const hour = (hour12 % 12) + (pm ? 12 : 0);
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

/** Local date as "YYYY-MM-DD", without the UTC shift toISOString causes. */
export function toDateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function fromDateKey(key: string): Date {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

/** "Mon, 9 Nov 2026" */
export function formatDay(d: Date | string): string {
  const date = typeof d === 'string' ? fromDateKey(d) : d;
  return date.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
}

/** "today", "tomorrow", "yesterday" or "on Mon, 9 Nov 2026". */
export function relativeDay(d: Date | string, now = new Date()): string {
  const date = typeof d === 'string' ? fromDateKey(d) : d;
  const days = Math.round((fromDateKey(toDateKey(date)).getTime() - fromDateKey(toDateKey(now)).getTime()) / 86400000);
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  if (days === -1) return 'yesterday';
  return `on ${formatDay(date)}`;
}

/** The date and "HH:MM" a number of minutes from now. */
export function minutesFromNow(minutes: number, now = new Date()): { date: string; time: string } {
  const t = new Date(now.getTime() + minutes * 60000);
  return { date: toDateKey(t), time: `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}` };
}

/** "in 25 min", "in 2 hr 5 min", "now". */
export function untilText(target: Date, now = new Date()): string {
  const mins = Math.round((target.getTime() - now.getTime()) / 60000);
  if (mins <= 0) return 'now';
  if (mins < 60) return `in ${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `in ${h} hr${m ? ` ${m} min` : ''}`;
}
