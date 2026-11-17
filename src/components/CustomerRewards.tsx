// src/components/CustomerRewards.tsx
// Shows what a customer's points are worth (by tier) and lets staff use them to pay off debt.
// Points are not money: they never become cash, M-Pesa or wallet balance.

import React, { useEffect, useState } from 'react';
import { Gift } from 'lucide-react';
import { Customer } from '../types';
import { DEFAULT_POINT_SETTINGS, fetchPointSettings, pointValueFor, pointsPerShilling } from '../services/loyalty/pointValue';
import { useAppStore } from '../stores/appStore';
import { useCustomerStore } from '../stores/customerStore';
import { hasRolePermission } from '../utils/permissions';
import { toUserMessage } from '../utils/userError';
import { NumberInput } from './shared/Input';

interface Props {
  customer: Customer;
  formatCurrency: (amount: number) => string;
}

export default function CustomerRewards({ customer, formatCurrency }: Props) {
  const { currentEmployee, showToast } = useAppStore();
  const redeemPoints = useCustomerStore((s) => s.redeemPoints);
  const [settings, setSettings] = useState(DEFAULT_POINT_SETTINGS);
  const [points, setPoints] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!customer.businessId) return;
    fetchPointSettings(customer.businessId).then(setSettings);
  }, [customer.businessId]);

  const canRedeem = !!currentEmployee && hasRolePermission(currentEmployee.role, 'customers.loyalty');
  const requested = Number(points);
  const value = pointValueFor(settings, customer.tier);
  const debt = customer.debtBalance || 0;
  // Only the points the debt needs can be used here.
  const neededForDebt = debt > 0 ? Math.ceil(debt / value) : 0;
  const usable = Math.min(customer.loyaltyPoints || 0, neededForDebt);

  const handleRedeem = async () => {
    setBusy(true);
    try {
      const result = await redeemPoints(customer.id, requested, currentEmployee?.name || 'Staff');
      setPoints('');
      showToast(
        'Points used',
        `${(result as any).pointsUsed ?? requested} points paid ${formatCurrency(result.value)} of ${customer.name}'s debt.`,
        undefined,
        'success',
      );
    } catch (err) {
      showToast('Could Not Redeem', toUserMessage(err, 'Please try again.'), undefined, 'error');
    } finally {
      setBusy(false);
    }
  };

  if (!settings.enabled) return null; // points switched off for this business

  return (
    <div className="bg-app-bg p-2.5 rounded-xl border border-app-border flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <Gift size={14} className="text-amber-500 shrink-0" />
        <span className="text-xs font-bold text-app-text">
          {(customer.loyaltyPoints || 0).toLocaleString()} points, worth {formatCurrency((customer.loyaltyPoints || 0) * value)}
        </span>
      </div>
      <p className="text-[11px] text-app-text-muted">
        {customer.tier || 'Bronze'}: {pointsPerShilling(value)} points = KSh 1. Points come off a purchase at the till, or pay off debt here
        {debt > 0 ? ` (up to ${usable.toLocaleString()} points)` : ''}. They are not cash.
      </p>
      {canRedeem && debt > 0 && usable >= settings.minRedeem && (
        <div className="flex gap-2">
          <NumberInput decimals={0}
            min={settings.minRedeem}
            max={usable}
            value={points}
            onChange={(v) => setPoints((v == null ? '' : String(v)))}
            placeholder={`Points for debt (max ${usable.toLocaleString()})`}
            aria-label="Points to use for debt"
            size="sm" className="flex-1 min-w-0"
          />
          <button
            type="button"
            onClick={handleRedeem}
            disabled={busy || !Number.isInteger(requested) || requested < settings.minRedeem || requested > usable}
            className="px-3 py-1.5 bg-amber-500 text-slate-950 font-bold rounded-lg text-xs disabled:opacity-40"
          >
            {busy ? 'Using…' : 'Pay debt'}
          </button>
        </div>
      )}
    </div>
  );
}
