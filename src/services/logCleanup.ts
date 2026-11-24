// Deleting logs that only ever grow and carry no money and no audit value: points earned (points
// are never cash; balances stay), backup runs and crash reports. Owners and admins only; the
// database checks that too. Sales, stock history, points used and the audit trail are kept for
// good: the books, the reports and the audit trail stand on them (20261203001).
import { getSupabase } from './supabaseClient';
import { useAuthStore } from '../stores/authStore';
import { toUuid } from '../utils/idUtils';

export type LogName = 'points_earned' | 'backups' | 'crashes';

export const LOG_LABELS: Record<LogName, { title: string; detail: string }> = {
  points_earned: { title: 'Points earned', detail: 'Points customers earned. Their balances stay; the Earned totals drop.' },
  backups: { title: 'Backup history', detail: 'The list of past backup runs (not the backups themselves).' },
  crashes: { title: 'Crash reports', detail: 'Errors the app reported automatically.' },
};

export const isAdminRole = (role?: string | null) => role === 'Owner' || role === 'Admin' || role === 'Administrator';

export const useIsAdmin = () => isAdminRole(useAuthStore((s) => s.currentEmployee?.role));

/** Deletes every row older than `before` (null: all of them). Returns how many went. */
export async function deleteLogsBefore(businessId: string, log: LogName, before: Date | null): Promise<number> {
  const { data, error } = await getSupabase().rpc('delete_log_entries', {
    p_business_id: toUuid(businessId),
    p_log: log,
    p_before: before ? before.toISOString() : 'infinity',
  });
  if (error) throw error;
  return Number(data) || 0;
}

export async function fetchLogSizes(businessId: string): Promise<Record<LogName, { count: number; oldest: string | null }>> {
  const { data, error } = await getSupabase().rpc('log_sizes', { p_business_id: toUuid(businessId) });
  if (error) throw error;
  const out = {} as Record<LogName, { count: number; oldest: string | null }>;
  for (const row of (data || []) as { log: string; row_count: number; oldest: string | null }[]) {
    if (row.log in LOG_LABELS) out[row.log as LogName] = { count: Number(row.row_count) || 0, oldest: row.oldest };
  }
  return out;
}
