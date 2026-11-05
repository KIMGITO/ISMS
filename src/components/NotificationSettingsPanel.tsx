// src/components/NotificationSettingsPanel.tsx
// The switches for what this person gets notified about, used by the Notifications page and Settings.

import React, { useCallback, useEffect, useState } from 'react';
import { Bell, BellOff, Bike, CalendarClock, CircleDollarSign, Megaphone, PackageSearch, ShieldCheck, ShoppingBag, Sparkles, Wallet } from 'lucide-react';
import { NotificationPreferences, NotificationSettings } from '../services/notifications/notificationPreferences';
import { NotificationRepository } from '../services/notifications/notificationRepository';
import { useBusinessStore } from '../stores/businessStore';
import { useAppStore } from '../stores/appStore';
import { toUserMessage } from '../utils/userError';

const CATEGORY_DETAILS: Record<string, { label: string; description: string; icon: React.ReactNode }> = {
  stock: { label: 'Stock alerts', description: 'Low stock and products running out', icon: <PackageSearch size={15} /> },
  sales: { label: 'Sales reports', description: 'Daily, weekly and monthly summaries', icon: <Wallet size={15} /> },
  debts: { label: 'Debt reminders', description: 'Customer debts that are due', icon: <CircleDollarSign size={15} /> },
  deliveries: { label: 'Deliveries', description: 'Assigned and completed deliveries', icon: <Bike size={15} /> },
  payments: { label: 'Payments', description: 'M-Pesa results and low cash balance', icon: <CircleDollarSign size={15} /> },
  online_store: { label: 'Online store', description: 'New website orders and possible duplicate customers', icon: <ShoppingBag size={15} /> },
  schedules: { label: 'Schedule reminders', description: 'Your upcoming shifts', icon: <CalendarClock size={15} /> },
  ai: { label: 'AI insights', description: 'Business suggestions and risk alerts', icon: <Sparkles size={15} /> },
  announcements: { label: 'Announcements', description: 'Shift updates and messages from your business', icon: <Megaphone size={15} /> },
  account: { label: 'Account and security', description: 'Role invitations and account activity', icon: <ShieldCheck size={15} /> },
};

function Switch({ on, disabled }: { on: boolean; disabled?: boolean }) {
  return (
    <div className={`w-10 h-6 rounded-full p-0.5 transition-colors shrink-0 ${on ? 'bg-amber-500' : 'bg-app-border'} ${disabled ? 'opacity-50' : ''}`}>
      <div className={`w-5 h-5 rounded-full bg-white shadow transition-transform ${on ? 'translate-x-4' : 'translate-x-0'}`} />
    </div>
  );
}

export default function NotificationSettingsPanel() {
  const businessId = useBusinessStore((s) => s.activeBusinessId);
  const { showToast } = useAppStore();
  const [settings, setSettings] = useState<NotificationSettings | null>(NotificationPreferences.get());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!businessId) return;
    setLoading(true);
    setSettings(await NotificationPreferences.load(businessId));
    setLoading(false);
  }, [businessId]);

  useEffect(() => {
    load();
  }, [load]);

  const change = async (category: string, enabled: boolean) => {
    if (!businessId) return;
    setSaving(category);
    try {
      await NotificationPreferences.set(businessId, category, enabled);
      setSettings(NotificationPreferences.get());
      NotificationRepository.refresh();
    } catch (err) {
      showToast('Could Not Save', toUserMessage(err, 'Your setting did not change. Please try again.'), undefined, 'error');
    } finally {
      setSaving(null);
    }
  };

  if (!settings) {
    return (
      <div className="py-6 text-center text-xs text-app-text-muted">
        {loading ? 'Loading your settings…' : (
          <>
            <p>Your settings could not be loaded.</p>
            <button onClick={load} className="mt-2 font-bold text-amber-500 underline">Try again</button>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <button
        role="switch"
        aria-checked={!settings.paused}
        disabled={saving !== null}
        onClick={() => change('all', settings.paused)}
        className="w-full flex items-center gap-3 px-3 py-3 rounded-2xl bg-app-bg text-left"
      >
        <div className="w-9 h-9 rounded-full flex items-center justify-center shrink-0 bg-amber-500/10 text-amber-500">
          {settings.paused ? <BellOff size={15} /> : <Bell size={15} />}
        </div>
        <div className="flex-1 min-w-0">
          <span className="text-[13px] font-bold block">{settings.paused ? 'Notifications paused' : 'Notifications on'}</span>
          <span className="text-[10px] text-app-text-muted">
            {settings.paused ? 'You only get account and security alerts.' : 'Turn this off to pause everything below.'}
          </span>
        </div>
        <Switch on={!settings.paused} />
      </button>

      {settings.categories.map((setting) => {
        const details = CATEGORY_DETAILS[setting.category];
        const on = setting.locked || (setting.enabled && !settings.paused);
        const fixed = setting.locked || settings.paused;
        return (
          <button
            key={setting.category}
            role="switch"
            aria-checked={on}
            disabled={fixed || saving !== null}
            onClick={() => change(setting.category, !setting.enabled)}
            className={`w-full flex items-center gap-3 px-3 py-3 rounded-2xl transition text-left ${fixed ? 'cursor-default' : 'hover:bg-app-bg'}`}
          >
            <div className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 ${on ? 'bg-amber-500/10 text-amber-500' : 'bg-app-bg text-app-text-muted'}`}>
              {details?.icon ?? <Bell size={15} />}
            </div>
            <div className="flex-1 min-w-0">
              <span className="text-[13px] font-bold block">{details?.label ?? setting.category}</span>
              <span className="text-[10px] text-app-text-muted block">
                {setting.locked ? 'Always on. ' : ''}{details?.description}
              </span>
            </div>
            <Switch on={on} disabled={fixed} />
          </button>
        );
      })}
    </div>
  );
}
