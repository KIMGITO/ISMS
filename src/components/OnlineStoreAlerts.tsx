// src/components/OnlineStoreAlerts.tsx
// Dashboard strip for website orders and messages waiting on staff. Hidden when there's nothing to do.

import React, { useEffect, useState } from 'react';
import { ChevronRight, Globe } from 'lucide-react';
import { useAppStore } from '../stores/appStore';
import { useBusinessStore } from '../stores/businessStore';
import { getSupabase } from '../services/supabaseClient';
import { hasRolePermission } from '../utils/permissions';

const REFRESH_MS = 60000;

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

export default function OnlineStoreAlerts() {
  const { currentEmployee, setActiveTab } = useAppStore();
  const { activeBusinessId } = useBusinessStore();
  const [counts, setCounts] = useState({ orders: 0, messages: 0 });

  const allowed = !!currentEmployee && hasRolePermission(currentEmployee.role, 'online_store.view');

  useEffect(() => {
    if (!allowed || !activeBusinessId) return;

    const load = async () => {
      const supabase = getSupabase();
      const [orders, messages] = await Promise.all([
        supabase
          .from('online_orders')
          .select('id', { count: 'exact', head: true })
          .eq('business_id', activeBusinessId)
          .or('status.eq.paid,needs_attention.eq.true'),
        supabase
          .from('customer_messages')
          .select('id', { count: 'exact', head: true })
          .eq('business_id', activeBusinessId)
          .eq('sender', 'customer')
          .is('read_at', null),
      ]);
      // A failed refresh keeps the last counts; the strip is a prompt, not a record.
      if (orders.error || messages.error) return;
      setCounts({ orders: orders.count ?? 0, messages: messages.count ?? 0 });
    };

    load();
    const timer = setInterval(load, REFRESH_MS);
    return () => clearInterval(timer);
  }, [allowed, activeBusinessId]);

  if (!allowed || (counts.orders === 0 && counts.messages === 0)) return null;

  const summary = [
    counts.orders > 0 ? plural(counts.orders, 'online order') : null,
    counts.messages > 0 ? plural(counts.messages, 'customer message') : null,
  ].filter(Boolean).join(' and ');

  return (
    <button
      type="button"
      onClick={() => setActiveTab('online-store')}
      className="w-full flex items-center gap-3 p-3 mb-4 text-left bg-app-card border border-app-border rounded-2xl shadow-sm"
    >
      <span className="p-2 bg-amber-500/10 text-amber-500 rounded-xl">
        <Globe size={16} />
      </span>
      <span className="flex-1 text-sm font-semibold">{summary} waiting</span>
      <ChevronRight size={16} className="text-app-text-muted" />
    </button>
  );
}
