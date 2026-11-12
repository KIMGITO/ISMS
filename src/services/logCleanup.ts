// Deleting logs that only ever grow (stock history, points used and earned, audit trail, backup
// runs, crash reports). Owners and admins only; the database checks that too. Deleting a log
// never changes stock, points or money: only the record of it goes.
import { getSupabase } from './supabaseClient';
import { useAuthStore } from '../stores/authStore';
import { toUuid } from '../utils/idUtils';

export type LogName = 'stock' | 'points_used' | 'points_earned' | 'audit' | 'backups' | 'crashes';

export const LOG_LABELS: Record<LogName, { title: string; detail: string }> = {
  stock: { title: 'Stock history', detail: 'Restocks, damage, counts, production and transfers. Stock levels stay as they are.' },
  points_used: { title: 'Who used points', detail: 'Points spent at the till, online or on debt. Profit figures for those days lose this deduction.' },
  points_earned: { title: 'Points earned', detail: 'Points customers earned. Their balances stay; the Earned totals drop.' },
  audit: { title: 'Audit trail', detail: 'Background record of changes made in the app.' },
  backups: { title: 'Backup history', detail: 'The list of past backup runs (not the backups themselves).' },
  crashes: { title: 'Crash reports', detail: 'Errors the app reported automatically.' },
};

export const isAdminRole = (role?: string | null) => role === 'Owner' || role === 'Admin' || role === 'Administrator';

export const useIsAdmin = () => isAdminRole(useAuthStore((s) => s.currentEmployee?.role));

/** Deletes chosen rows. Returns how many went. */
export async function deleteLogRows(businessId: string, log: LogName, ids: string[]): Promise<number> {
  if (ids.length === 0) return 0;
  const { data, error } = await getSupabase().rpc('delete_log_entries', {
    p_business_id: toUuid(businessId),
    p_log: log,
    p_ids: ids.map(toUuid),
  });
  if (error) throw error;
  return Number(data) || 0;
}

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
  for (const row of (data || []) as { log: LogName; row_count: number; oldest: string | null }[]) {
    out[row.log] = { count: Number(row.row_count) || 0, oldest: row.oldest };
  }
  return out;
}
