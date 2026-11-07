// src/features/RiderDeliveriesView.tsx
// A rider's own deliveries and history. The database only returns deliveries assigned to them.

import { Tabs } from '../components/TabOptions';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { MapPin, Phone, Truck } from 'lucide-react';
import { getSupabase } from '../services/supabaseClient';
import { useAppStore } from '../stores/appStore';
import { useBusinessStore } from '../stores/businessStore';
import { formatCurrency } from '../utils/helpers';
import { hasRolePermission } from '../utils/permissions';
import { toUserMessage } from '../utils/userError';

type DeliveryStatus = 'assigned' | 'out_for_delivery' | 'delivered' | 'failed';

interface Delivery {
  source: 'online' | 'sale';
  id: string;
  reference: string;
  customer_name: string;
  customer_phone: string | null;
  address: string | null;
  area: string | null;
  notes: string | null;
  amount: number;
  delivery_fee: number;
  status: DeliveryStatus;
  assigned_at: string;
  delivered_at: string | null;
  items: string | null;
}

const STATUS_LABELS: Record<DeliveryStatus, string> = {
  assigned: 'To deliver',
  out_for_delivery: 'On the way',
  delivered: 'Delivered',
  failed: 'Not delivered',
};

const REFRESH_MS = 30000;

export default function RiderDeliveriesView() {
  const { currentEmployee, showToast } = useAppStore();
  const { activeBusinessId } = useBusinessStore();
  const [deliveries, setDeliveries] = useState<Delivery[] | null>(null);
  const [tab, setTab] = useState<'active' | 'history'>('active');
  const [busyId, setBusyId] = useState<string | null>(null);

  const role = currentEmployee?.role ?? '';
  const canComplete = hasRolePermission(role, 'deliveries.complete');
  const canCancel = hasRolePermission(role, 'deliveries.cancel');

  const load = useCallback(async () => {
    if (!activeBusinessId) return;
    const { data, error } = await getSupabase().rpc('get_my_deliveries', { p_business_id: activeBusinessId });
    if (error) throw error;
    setDeliveries(data as Delivery[]);
  }, [activeBusinessId]);

  useEffect(() => {
    load().catch((err) => {
      setDeliveries([]);
      showToast('Could Not Load Deliveries', toUserMessage(err, 'Please try again.'), undefined, 'error');
    });
    const timer = setInterval(() => load().catch(() => undefined), REFRESH_MS);
    return () => clearInterval(timer);
  }, [load, showToast]);

  const updateStatus = async (delivery: Delivery, status: DeliveryStatus) => {
    setBusyId(delivery.id);
    try {
      const { error } = await getSupabase().rpc('rider_update_delivery', {
        p_source: delivery.source,
        p_id: delivery.id,
        p_status: status,
      });
      if (error) throw error;
      await load();
    } catch (err) {
      showToast('Could Not Update', toUserMessage(err, 'Please try again.'), undefined, 'error');
    } finally {
      setBusyId(null);
    }
  };

  const active = useMemo(
    () => (deliveries ?? []).filter((d) => d.status === 'assigned' || d.status === 'out_for_delivery'),
    [deliveries],
  );
  const history = useMemo(
    () => (deliveries ?? []).filter((d) => d.status === 'delivered' || d.status === 'failed'),
    [deliveries],
  );
  const delivered = history.filter((d) => d.status === 'delivered');
  const customerCount = new Set(delivered.map((d) => d.customer_phone || d.customer_name)).size;
  const visible = tab === 'active' ? active : history;

  return (
    <div className="h-full overflow-y-auto bg-app-bg p-4 pb-nav font-sans text-app-text">
      <div className="mx-auto flex max-w-3xl flex-col gap-4">
        <h2 className="flex items-center gap-2 text-lg font-bold">
          <Truck size={18} className="text-amber-500" /> My Deliveries
        </h2>

        <dl className="grid grid-cols-3 gap-2 rounded-2xl border border-app-border bg-app-card p-3 text-center">
          <div>
            <dt className="text-xs text-app-text-muted">Delivered</dt>
            <dd className="text-lg font-bold">{delivered.length}</dd>
          </div>
          <div>
            <dt className="text-xs text-app-text-muted">Customers</dt>
            <dd className="text-lg font-bold">{customerCount}</dd>
          </div>
          <div>
            <dt className="text-xs text-app-text-muted">Value</dt>
            <dd className="text-lg font-bold">{formatCurrency(delivered.reduce((sum, d) => sum + Number(d.amount), 0))}</dd>
          </div>
        </dl>

        <Tabs<typeof tab>
          tabs={[
            { id: 'active' as const, label: 'To deliver', badge: active.length },
            { id: 'history' as const, label: 'History', badge: history.length },
          ]}
          activeTab={tab}
          onChange={setTab}
        />

        {deliveries === null && <p className="text-sm text-app-text-muted">Loading deliveries…</p>}
        {deliveries !== null && visible.length === 0 && (
          <p className="text-sm text-app-text-muted">
            {tab === 'active' ? 'Nothing to deliver right now.' : 'No past deliveries yet.'}
          </p>
        )}

        {visible.map((delivery) => (
          <article key={`${delivery.source}-${delivery.id}`} className="flex flex-col gap-2 rounded-2xl border border-app-border bg-app-card p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-bold">{delivery.customer_name}</h3>
              <span className="rounded-full bg-amber-500/10 px-3 py-1 text-xs font-semibold">
                {STATUS_LABELS[delivery.status]}
              </span>
            </div>
            <p className="text-xs text-app-text-muted">
              {delivery.reference} · {new Date(delivery.delivered_at ?? delivery.assigned_at).toLocaleString()}
            </p>
            {delivery.items && <p className="text-sm">{delivery.items}</p>}
            {(delivery.address || delivery.area) && (
              <p className="flex items-start gap-2 text-sm">
                <MapPin size={14} className="mt-0.5 shrink-0 text-amber-500" />
                {[delivery.area, delivery.address].filter(Boolean).join(', ')}
              </p>
            )}
            {delivery.notes && <p className="text-sm text-app-text-muted">{delivery.notes}</p>}
            {delivery.customer_phone && (
              <a href={`tel:${delivery.customer_phone}`} className="flex min-h-11 items-center gap-2 text-sm font-medium underline">
                <Phone size={14} className="text-amber-500" /> {delivery.customer_phone}
              </a>
            )}
            <p className="text-sm font-semibold">
              {formatCurrency(Number(delivery.amount))}
              {Number(delivery.delivery_fee) > 0 && (
                <span className="font-normal text-app-text-muted"> including {formatCurrency(Number(delivery.delivery_fee))} delivery</span>
              )}
            </p>

            {tab === 'active' && (
              <div className="flex flex-wrap gap-2">
                {canComplete && delivery.status === 'assigned' && (
                  <button type="button" disabled={busyId === delivery.id} onClick={() => updateStatus(delivery, 'out_for_delivery')} className="min-h-11 flex-1 rounded-xl bg-amber-500 px-4 text-sm font-bold text-slate-950 disabled:opacity-40">
                    Start delivery
                  </button>
                )}
                {canComplete && delivery.status === 'out_for_delivery' && (
                  <button type="button" disabled={busyId === delivery.id} onClick={() => updateStatus(delivery, 'delivered')} className="min-h-11 flex-1 rounded-xl bg-amber-500 px-4 text-sm font-bold text-slate-950 disabled:opacity-40">
                    Mark delivered
                  </button>
                )}
                {canCancel && (
                  <button type="button" disabled={busyId === delivery.id} onClick={() => updateStatus(delivery, 'failed')} className="min-h-11 rounded-xl border border-app-border px-4 text-sm font-medium disabled:opacity-40">
                    Couldn't deliver
                  </button>
                )}
              </div>
            )}
          </article>
        ))}
      </div>
    </div>
  );
}
