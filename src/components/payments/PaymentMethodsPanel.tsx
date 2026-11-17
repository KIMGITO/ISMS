// src/components/payments/PaymentMethodsPanel.tsx
// Payments → Methods: switch each way of being paid on or off for this business.
// Off means hidden at the till and on payment forms, and no new prompts or card charges with
// it. Money that still arrives is recorded, and old records keep their method.

import { useState } from 'react';
import { Banknote, CreditCard, Landmark, Lock, Smartphone } from 'lucide-react';
import { Switch } from '../shared/Switch';
import { useAppStore } from '../../stores/appStore';
import { useBusinessStore } from '../../stores/businessStore';
import { usePaymentMethods } from '../../hooks/usePaymentMethods';
import { hasRolePermission } from '../../utils/permissions';
import { MONEY_METHODS, methodLabel } from '../../utils/paymentMethods';
import { toUserMessage } from '../../utils/userError';
import type { MoneyMethod } from '../../types';

const ABOUT: Record<MoneyMethod, { icon: React.ReactNode; text: string }> = {
  Cash: { icon: <Banknote size={18} className="text-amber-500" />, text: 'Notes and coins at the till.' },
  'M-Pesa': { icon: <Smartphone size={18} className="text-emerald-600" />, text: 'M-Pesa till payments and prompts.' },
  'Airtel Money': { icon: <Smartphone size={18} className="text-red-500" />, text: 'Airtel Money payments and prompts.' },
  Card: { icon: <CreditCard size={18} className="text-blue-500" />, text: 'Card machine and Paystack.' },
  Bank: { icon: <Landmark size={18} className="text-violet-500" />, text: 'Bank transfers, recorded with the bank reference.' },
};

export default function PaymentMethodsPanel() {
  const { showToast, currentEmployee } = useAppStore();
  const setPaymentMethods = useBusinessStore((s) => s.setPaymentMethods);
  const role = currentEmployee?.role || 'Guest';
  const canConfigure = hasRolePermission(role, 'payments.configure');
  const enabled = usePaymentMethods();
  const [busy, setBusy] = useState<MoneyMethod | null>(null);

  const toggle = async (method: MoneyMethod, on: boolean) => {
    const next = on ? [...enabled, method] : enabled.filter((m) => m !== method);
    if (next.length === 0) {
      showToast('Payment methods', 'Keep at least one payment method on.', undefined, 'error');
      return;
    }
    setBusy(method);
    try {
      await setPaymentMethods(next);
      showToast(
        on ? `${methodLabel(method)} on` : `${methodLabel(method)} off`,
        on ? 'Shown at the till.' : 'Hidden at the till.',
        undefined,
        'success',
      );
    } catch (err) {
      showToast('Payment methods', toUserMessage(err, "Couldn't save. Please try again."), undefined, 'error');
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="bg-app-card border border-app-border rounded-2xl p-4 sm:p-5 shadow-sm animate-in fade-in duration-200">
      <h3 className="text-sm font-bold text-app-text mb-1">Ways customers can pay</h3>
      <p className="text-xs text-app-text-muted mb-4">
        Off: hidden at the till.
      </p>

      {!canConfigure && (
        <p className="text-xs text-app-text-muted mb-3 flex items-center gap-1.5">
          <Lock size={12} /> Only the owner or admins can change these.
        </p>
      )}

      <ul className="divide-y divide-app-border/50">
        {MONEY_METHODS.map((m) => {
          const on = enabled.includes(m);
          return (
            <li key={m} className="py-3 flex items-center gap-3">
              <span className="shrink-0">{ABOUT[m].icon}</span>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold text-app-text">{methodLabel(m)}</div>
                <div className="text-xs text-app-text-muted">{ABOUT[m].text}</div>
              </div>
              <Switch
                checked={on}
                disabled={!canConfigure || busy !== null || (on && enabled.length === 1)}
                onChange={(v) => void toggle(m, v)}
                ariaLabel={`${methodLabel(m)} ${on ? 'on' : 'off'}`}
              />
            </li>
          );
        })}
      </ul>
    </section>
  );
}
