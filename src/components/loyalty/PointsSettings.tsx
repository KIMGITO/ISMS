// Loyalty points settings: the on/off switch, what a point is worth in each tier, and the
// fewest points a customer can use. Shown on Loyalty → Points and on Online Store → Website,
// only to roles with "loyalty.configure" (the database checks the same permission).
import React, { FormEvent, useEffect, useState } from 'react';
import { Settings2 } from 'lucide-react';
import { getSupabase } from '../../services/supabaseClient';
import { fetchPointSettings, pointsPerShilling, setPointsEnabled } from '../../services/loyalty/pointValue';
import { useNotificationStore } from '../../stores/notificationStore';
import { toUserMessage } from '../../utils/userError';
import { hasRolePermission } from '../../utils/permissions';
import { Switch } from '../shared/Switch';

const inputClass =
  'w-full rounded-lg border border-app-border bg-app-bg px-3 py-2 text-sm text-app-text outline-none focus:border-brand-500 mt-1';

/** Whether this role may change the points settings. */
export function canConfigurePoints(role: string | undefined): boolean {
  return !!role && hasRolePermission(role, 'loyalty.configure');
}

export function PointsSettings({ businessId, onSaved }: { businessId: string; onSaved?: () => void }) {
  const showToast = useNotificationStore((s) => s.showToast);
  // Entered as "points for KSh 1" per tier; stored as the KSh value of one point.
  const [perKsh, setPerKsh] = useState({ bronze: '50', silver: '100', gold: '200' });
  const [minRedeem, setMinRedeem] = useState('100');
  const [enabled, setEnabled] = useState(true);
  const [switching, setSwitching] = useState(false);
  const [saving, setSaving] = useState(false);

  const fail = (err: unknown, fallback: string) => {
    console.error(err);
    showToast('Loyalty points', toUserMessage(err, fallback), undefined, 'error');
  };

  useEffect(() => {
    fetchPointSettings(businessId).then((s) => {
      setEnabled(s.enabled);
      setPerKsh({ bronze: String(pointsPerShilling(s.bronze)), silver: String(pointsPerShilling(s.silver)), gold: String(pointsPerShilling(s.gold)) });
      setMinRedeem(String(s.minRedeem));
    });
  }, [businessId]);

  const handleSave = async (e: FormEvent) => {
    e.preventDefault();
    const v = (n: string) => Math.round((1 / Math.max(1, Number(n) || 1)) * 10000) / 10000;
    setSaving(true);
    try {
      const { error } = await getSupabase().from('loyalty_settings').upsert({
        business_id: businessId,
        value_bronze: v(perKsh.bronze),
        value_silver: v(perKsh.silver),
        value_gold: v(perKsh.gold),
        // Older app versions read this single value.
        point_value: Math.max(0.01, Math.round(v(perKsh.silver) * 100) / 100),
        min_redeem_points: Number(minRedeem),
      });
      if (error) throw error;
      showToast('Points Saved', 'Your points settings are saved.', undefined, 'success');
      onSaved?.();
    } catch (err) {
      fail(err, 'Could not save points settings.');
    } finally {
      setSaving(false);
    }
  };

  // Saved straight away, on its own: the tier values below keep whatever they were.
  const toggle = async () => {
    const next = !enabled;
    setSwitching(true);
    try {
      const { error } = await getSupabase().from('loyalty_settings').upsert({ business_id: businessId, points_enabled: next });
      if (error) throw error;
      setEnabled(next);
      setPointsEnabled(businessId, next);
      showToast(
        next ? 'Points On' : 'Points Off',
        next ? 'Customers earn and use points again.' : "Customers keep their points but can't earn or use them until you switch this back on.",
        undefined,
        'success',
      );
      onSaved?.();
    } catch (err) {
      fail(err, 'Could not switch points.');
    } finally {
      setSwitching(false);
    }
  };

  const row = (tier: 'bronze' | 'silver' | 'gold', label: string) => {
    const n = Number(perKsh[tier]) || 0;
    return (
      <label className="block text-sm font-medium text-app-text">
        {label}: points for Ksh 1
        <input required type="number" min="1" step="1" value={perKsh[tier]} onChange={(e) => setPerKsh((p) => ({ ...p, [tier]: e.target.value }))} className={inputClass} />
        <span className="block mt-1 text-xs font-normal text-app-text-muted">{n > 0 ? `${Math.round((2 / n) * 1000) / 10}% back on what they pay` : ''}</span>
      </label>
    );
  };

  return (
    <form id="points-settings" onSubmit={handleSave} className="rounded-2xl bg-app-card ring-1 ring-app-border p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2 min-w-0">
          <Settings2 size={16} className="mt-0.5 shrink-0 text-app-text-muted" />
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-app-text">Points settings</h3>
            <p className="text-xs text-app-text-muted">
              {enabled ? 'On: customers earn and use points.' : 'Off: nobody earns or uses points. Balances are kept for when you switch back on.'}
            </p>
          </div>
        </div>
        <Switch checked={enabled} onChange={() => toggle()} disabled={switching} ariaLabel="Loyalty points on or off" />
      </div>
      {enabled && (
        <>
          
          <div className="grid gap-3 sm:grid-cols-3">
            {row('bronze', 'Bronze')}
            {row('silver', 'Silver')}
            {row('gold', 'Gold')}
          </div>
          <label className="block text-sm font-medium text-app-text">
            Fewest points that can be used
            <input required type="number" min="1" value={minRedeem} onChange={(e) => setMinRedeem(e.target.value)} className={inputClass} />
          </label>
          <button type="submit" disabled={saving} className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-slate-950 disabled:opacity-50 cursor-pointer">
            {saving ? 'Saving…' : 'Save'}
          </button>
        </>
      )}
    </form>
  );
}
