// src/components/CustomerRewards.tsx
// Shows what a customer's points are worth and lets staff redeem them onto the account.

import React, { useEffect, useState } from 'react';
import { Gift } from 'lucide-react';
import { Customer } from '../types';
import { getSupabase } from '../services/supabaseClient';
import { useAppStore } from '../stores/appStore';
import { useCustomerStore } from '../stores/customerStore';
import { hasRolePermission } from '../utils/permissions';
import { toUserMessage } from '../utils/userError';

interface Props {
  customer: Customer;
  formatCurrency: (amount: number) => string;
}

export default function CustomerRewards({ customer, formatCurrency }: Props) {
  const { currentEmployee, showToast } = useAppStore();
  const redeemPoints = useCustomerStore((s) => s.redeemPoints);
  const [settings, setSettings] = useState({ pointValue: 1, minRedeem: 100 });
  const [points, setPoints] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!customer.businessId) return;
    getSupabase()
      .from('loyalty_settings')
      .select('point_value, min_redeem_points')
      .eq('business_id', customer.businessId)
      .maybeSingle()
      .then(({ data }) => {
        if (data) setSettings({ pointValue: Number(data.point_value), minRedeem: data.min_redeem_points });
      });
  }, [customer.businessId]);

  const canRedeem = !!currentEmployee && hasRolePermission(currentEmployee.role, 'customers.loyalty');
  const requested = Number(points);

  const handleRedeem = async () => {
    setBusy(true);
    try {
      const result = await redeemPoints(customer.id, requested, currentEmployee?.name || 'Staff');
      setPoints('');
      showToast(
        'Points Redeemed',
        `${requested} points added ${formatCurrency(result.value)} to ${customer.name}'s account.`,
        undefined,
        'success',
      );
    } catch (err) {
      showToast('Could Not Redeem', toUserMessage(err, 'Please try again.'), undefined, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="bg-app-bg p-3 rounded-2xl border border-app-border flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <Gift size={14} className="text-amber-500 shrink-0" />
        <span className="text-xs font-bold text-app-text">
          {customer.loyaltyPoints} points, worth {formatCurrency(customer.loyaltyPoints * settings.pointValue)}
        </span>
      </div>
      <p className="text-[11px] text-app-text-muted">
        Redeem from {settings.minRedeem} points. The value clears any debt first, then goes to the wallet.
      </p>
      {canRedeem && (
        <div className="flex gap-2">
          <input
            type="number"
            min={settings.minRedeem}
            max={customer.loyaltyPoints}
            inputMode="numeric"
            value={points}
            onChange={(e) => setPoints(e.target.value)}
            placeholder="Points to redeem"
            aria-label="Points to redeem"
            className="flex-1 min-w-0 bg-app-card border border-app-border rounded-xl px-3 py-2 text-xs text-app-text"
          />
          <button
            type="button"
            onClick={handleRedeem}
            disabled={busy || !Number.isInteger(requested) || requested < settings.minRedeem || requested > customer.loyaltyPoints}
            className="px-3 py-2 bg-amber-500 text-slate-950 font-bold rounded-xl text-xs disabled:opacity-40"
          >
            {busy ? 'Redeeming…' : 'Redeem'}
          </button>
        </div>
      )}
    </div>
  );
}
