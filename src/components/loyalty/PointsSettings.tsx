// Loyalty points settings: the on/off switch, what a point is worth in each tier, and the
// fewest points a customer can use. Shown on Loyalty → Points and on Online Store → Website,
// only to roles with "loyalty.configure" (the database checks the same permission).
import React, { FormEvent, useEffect, useState } from 'react';
import { Settings2, Coins, Medal, Ban, Check } from 'lucide-react';
import { getSupabase } from '../../services/supabaseClient';
import { fetchPointSettings, pointsPerShilling, setPointsEnabled } from '../../services/loyalty/pointValue';
import { useNotificationStore } from '../../stores/notificationStore';
import { toUserMessage } from '../../utils/userError';
import { hasRolePermission } from '../../utils/permissions';
import { Switch } from '../shared/Switch';
import { Field, NumberInput } from '../shared/Input';
import { primaryBtn } from '../shared/FormSheet';

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

  const TIERS = [
    { tier: 'bronze' as const, label: 'Bronze', tone: 'bg-orange-500/15 text-orange-700 dark:text-orange-300' },
    { tier: 'silver' as const, label: 'Silver', tone: 'bg-slate-400/20 text-slate-600 dark:text-slate-300' },
    { tier: 'gold' as const, label: 'Gold', tone: 'bg-yellow-400/25 text-yellow-700 dark:text-yellow-300' },
  ];

  return (
    <form id="points-settings" onSubmit={handleSave} className="rounded-2xl bg-app-card shadow-xs p-4 space-y-4">
      <div className="flex items-center gap-3">
        <span className="grid place-items-center size-9 shrink-0 rounded-xl bg-violet-500/15 text-violet-600 dark:text-violet-400"><Settings2 size={17} /></span>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold text-app-text">Points settings</h3>
          <p className="text-xs text-app-text-muted">{enabled ? 'On: customers earn and use points.' : 'Off. Balances are kept.'}</p>
        </div>
        <Switch checked={enabled} onChange={() => toggle()} disabled={switching} ariaLabel="Loyalty points on or off" />
      </div>
      {enabled && (
        <>
          {/* Fixed in the database (fn_sale_points, fn_debt_payment_points, calculate_customer_tier); the website says the same. */}
          <ul className="grid gap-1.5 sm:grid-cols-3 text-xs">
            <li className="flex items-start gap-2 rounded-xl bg-app-bg p-2.5"><Coins size={14} className="shrink-0 mt-px text-violet-600 dark:text-violet-400" /><span className="text-app-text-muted"><b className="text-app-text">2 pts</b> per KSh 1 paid, <b className="text-app-text">1 pt</b> per KSh 1 of debt paid off</span></li>
            <li className="flex items-start gap-2 rounded-xl bg-app-bg p-2.5"><Medal size={14} className="shrink-0 mt-px text-yellow-600 dark:text-yellow-400" /><span className="text-app-text-muted">Silver from <b className="text-app-text">20,000</b>, Gold from <b className="text-app-text">60,000</b>. Never goes down.</span></li>
            <li className="flex items-start gap-2 rounded-xl bg-app-bg p-2.5"><Ban size={14} className="shrink-0 mt-px text-red-600 dark:text-red-400" /><span className="text-app-text-muted">Off a purchase or debt only. Never cash.</span></li>
          </ul>
          <Field label="Points worth KSh 1" group>
            <div className="grid grid-cols-3 gap-2">
              {TIERS.map(({ tier, label, tone }) => {
                const n = Number(perKsh[tier]) || 0;
                return (
                  <div key={tier} className="min-w-0 space-y-1">
                    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${tone}`}><Medal size={11} /> {label}</span>
                    <NumberInput aria-label={`${label}: points for KSh 1`} min={1} decimals={0} value={perKsh[tier]} onChange={(v) => setPerKsh((p) => ({ ...p, [tier]: v == null ? '' : String(v) }))} suffix="pts" />
                    <span className="block text-[11px] text-app-text-muted">{n > 0 ? `${Math.round((2 / n) * 1000) / 10}% back` : '\u00a0'}</span>
                  </div>
                );
              })}
            </div>
          </Field>
          <div className="flex items-end gap-3">
            <Field label="Fewest points to use" className="flex-1">
              <NumberInput min={1} decimals={0} value={minRedeem} onChange={(v) => setMinRedeem(v == null ? '' : String(v))} suffix="pts" />
            </Field>
            <button type="submit" disabled={saving} className={`${primaryBtn} h-11 sm:h-10`}>
              <Check size={15} /> {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </>
      )}
    </form>
  );
}
