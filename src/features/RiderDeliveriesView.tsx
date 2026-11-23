// src/features/RiderDeliveriesView.tsx
// The rider's delivery cycle: open requests anyone can accept, their own deliveries (start,
// delivered, couldn't deliver, give back), history, and the delivery areas and prices.
// The database decides what each person sees; a request shows the phone number only once accepted.

import { Tabs } from '../components/TabOptions';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Clock, MapPin, Navigation, Phone, Route, Truck, Wallet } from 'lucide-react';
import DeliveryTripsBoard from '../components/DeliveryTripsBoard';
import DeliveryZonesEditor from '../components/DeliveryZonesEditor';
import { getSupabase } from '../services/supabaseClient';
import { useAppStore } from '../stores/appStore';
import { useBusinessStore } from '../stores/businessStore';
import { formatCurrency } from '../utils/helpers';
import { hasRolePermission } from '../utils/permissions';
import { toUserMessage } from '../utils/userError';

type DeliveryStatus = 'assigned' | 'out_for_delivery' | 'delivered' | 'failed';
type TabId = 'requests' | 'mine' | 'history' | 'trips' | 'zones';

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
  /** How the delivery is paid (20261125001): on the shop's bill, to the rider in cash, or free. */
  delivery_mode?: 'charged' | 'rider_collects' | 'free';
  /** What the rider earns for it: their share of the trip pay when it is in a trip. */
  rider_pay?: number;
  /** One round for several deliveries, paid once (20261130001). */
  trip_id?: string | null;
  trip_pay?: number | null;
  trip_size?: number | null;
  status: DeliveryStatus;
  assigned_at: string;
  delivered_at: string | null;
  created_at?: string;
  items: string | null;
  // Added in 20261110003; missing before that migration runs.
  payment?: string | null;
  balance_due?: number | null;
}

const STATUS_LABELS: Record<DeliveryStatus, string> = {
  assigned: 'Accepted',
  out_for_delivery: 'On the way',
  delivered: 'Delivered',
  failed: 'Not delivered',
};

const REFRESH_MS = 20000;

const primaryClass = 'min-h-11 flex-1 rounded-xl bg-amber-500 px-4 text-sm font-bold text-slate-950 disabled:opacity-40';
const secondaryClass = 'min-h-11 rounded-xl border border-app-border px-4 text-sm font-medium disabled:opacity-40';

const keyOf = (d: Delivery) => `${d.source}-${d.id}`;

function waitingFor(iso: string) {
  const minutes = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `Waiting ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `Waiting ${hours} h ${minutes % 60} min` : `Waiting ${Math.floor(hours / 24)} d`;
}

/** Trip members next to each other, in the order the first of each appears. */
function tripsTogether(list: Delivery[]): Delivery[] {
  const out: Delivery[] = [];
  const done = new Set<string>();
  for (const d of list) {
    if (!d.trip_id) { out.push(d); continue; }
    if (done.has(d.trip_id)) continue;
    done.add(d.trip_id);
    out.push(...list.filter((x) => x.trip_id === d.trip_id));
  }
  return out;
}

const isMissingFunction = (err: unknown) => (err as { code?: string } | null)?.code === 'PGRST202';

export default function RiderDeliveriesView() {
  const { currentEmployee, showToast } = useAppStore();
  const { activeBusinessId } = useBusinessStore();
  const [mine, setMine] = useState<Delivery[] | null>(null);
  const [requests, setRequests] = useState<Delivery[] | null>(null);
  const [requestsMissing, setRequestsMissing] = useState(false);
  const [tab, setTab] = useState<TabId | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [confirmFail, setConfirmFail] = useState<string | null>(null);

  const role = currentEmployee?.role ?? '';
  const isRider = role === 'Rider';
  const canComplete = hasRolePermission(role, 'deliveries.complete');
  const canCancel = hasRolePermission(role, 'deliveries.cancel');
  const canGroup = hasRolePermission(role, 'deliveries.assign');

  const load = useCallback(async () => {
    if (!activeBusinessId) return;
    const supabase = getSupabase();
    const [own, open] = await Promise.all([
      supabase.rpc('get_my_deliveries', { p_business_id: activeBusinessId }),
      supabase.rpc('get_delivery_requests', { p_business_id: activeBusinessId }),
    ]);
    if (own.error) throw own.error;
    setMine((own.data ?? []) as Delivery[]);
    if (open.error) {
      if (!isMissingFunction(open.error)) throw open.error;
      setRequestsMissing(true);
      setRequests([]);
    } else {
      setRequestsMissing(false);
      setRequests((open.data ?? []) as Delivery[]);
    }
  }, [activeBusinessId]);

  useEffect(() => {
    load().catch((err) => {
      setMine((m) => m ?? []);
      setRequests((r) => r ?? []);
      showToast('Could not load deliveries', toUserMessage(err, 'Please try again.'), undefined, 'error');
    });
    const timer = setInterval(() => load().catch(() => undefined), REFRESH_MS);
    // Riders mostly switch back from maps or calls, so check for new work straight away.
    const onReturn = () => {
      if (document.visibilityState === 'visible') load().catch(() => undefined);
    };
    document.addEventListener('visibilitychange', onReturn);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onReturn);
    };
  }, [load, showToast]);

  const act = async (delivery: Delivery, fn: string, params: Record<string, unknown>, done?: string) => {
    setBusyKey(keyOf(delivery));
    try {
      const { error } = await getSupabase().rpc(fn, { p_source: delivery.source, p_id: delivery.id, ...params });
      if (error) throw error;
      setConfirmFail(null);
      if (done) showToast('Deliveries', done, undefined, 'success');
      await load().catch(() => undefined);
      return true;
    } catch (err) {
      showToast('Could not update', toUserMessage(err, 'Please try again.'), undefined, 'error');
      load().catch(() => undefined);
      return false;
    } finally {
      setBusyKey(null);
    }
  };

  const accept = (d: Delivery) =>
    act(d, 'rider_accept_delivery', {}, `${d.customer_name}'s delivery is yours. You'll find it under Mine.`).then((ok) => {
      if (ok) setTab('mine');
    });
  const giveBack = (d: Delivery) => act(d, 'rider_release_delivery', {}, 'Delivery put back in the requests.');
  const setStatus = (d: Delivery, status: DeliveryStatus) => act(d, 'rider_update_delivery', { p_status: status });

  const active = useMemo(
    () => (mine ?? []).filter((d) => d.status === 'assigned' || d.status === 'out_for_delivery'),
    [mine],
  );
  const history = useMemo(() => (mine ?? []).filter((d) => d.status === 'delivered' || d.status === 'failed'), [mine]);
  const delivered = history.filter((d) => d.status === 'delivered');
  // What the rider earned: the shop owes them for deliveries on the bill or free; with
  // 'rider_collects' they already kept it from the customer. (Before 20261125001 there's no
  // rider_pay, so the fee stands in.)
  const payOf = (d: Delivery) => Number(d.rider_pay ?? d.delivery_fee ?? 0);
  const fees = delivered.reduce((sum, d) => sum + payOf(d), 0);
  const kept = delivered.filter((d) => d.delivery_mode === 'rider_collects').reduce((sum, d) => sum + payOf(d), 0);
  const fromShop = fees - kept;

  // Open on the tab with work in it.
  const currentTab: TabId = tab ?? (active.length > 0 ? 'mine' : 'requests');

  const renderDetails = (d: Delivery, showPhone: boolean) => {
    const due = Number(d.balance_due || 0);
    const place = [d.area, d.address].filter(Boolean).join(', ');
    return (
      <>
        {d.trip_id && (
          <p className="flex items-center gap-1.5 text-xs font-semibold text-amber-600 dark:text-amber-400">
            <Route size={12} /> One trip with {Math.max(0, (d.trip_size ?? 1) - 1)} other{(d.trip_size ?? 1) - 1 === 1 ? '' : 's'}
            {Number(d.trip_pay) > 0 && ` · ${formatCurrency(Number(d.trip_pay))} for the whole trip`}
          </p>
        )}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-bold">{d.customer_name}</h3>
          <span className="rounded-full bg-amber-500/10 px-3 py-1 text-xs font-semibold">
            {currentTab === 'requests' ? (d.source === 'online' ? 'Website order' : 'Till sale') : STATUS_LABELS[d.status]}
          </span>
        </div>
        <p className="flex items-center gap-1 text-xs text-app-text-muted">
          <Clock size={12} />
          {d.reference} ·{' '}
          {currentTab === 'requests'
            ? waitingFor(d.created_at ?? d.assigned_at)
            : new Date(d.delivered_at ?? d.assigned_at).toLocaleString()}
        </p>
        {d.items && <p className="text-sm">{d.items}</p>}
        <p className="flex items-start gap-2 text-sm">
          <MapPin size={14} className="mt-0.5 shrink-0 text-amber-500" />
          {place || <span className="text-app-text-muted">No location given. Ask the shop.</span>}
        </p>
        {d.notes && <p className="text-sm text-app-text-muted">Note: {d.notes}</p>}
        {showPhone && d.customer_phone && (
          <a href={`tel:${d.customer_phone}`} className="flex min-h-11 items-center gap-2 text-sm font-medium underline">
            <Phone size={14} className="text-amber-500" /> {d.customer_phone}
          </a>
        )}
        <div className="flex flex-wrap items-baseline justify-between gap-2 rounded-xl bg-app-bg p-3 text-sm">
          <span>
            <span className="font-semibold">{formatCurrency(Number(d.amount))}</span>
            {Number(d.delivery_fee) > 0 && (
              <span className="text-app-text-muted"> including {formatCurrency(Number(d.delivery_fee))} delivery</span>
            )}
            <DeliveryPayNote d={d} pay={payOf(d)} />
          </span>
          {d.payment && (
            <span className="flex items-center gap-1 text-xs text-app-text-muted">
              <Wallet size={12} /> {d.payment}
            </span>
          )}
          {due > 0 && (
            <span className="w-full text-xs font-semibold text-amber-600">Not yet paid: {formatCurrency(due)}</span>
          )}
        </div>
      </>
    );
  };

  const renderList = (list: Delivery[] | null, empty: string, render: (d: Delivery) => React.ReactNode) => {
    if (list === null) return <p className="text-sm text-app-text-muted">Loading deliveries…</p>;
    if (list.length === 0) return <p className="text-sm text-app-text-muted">{empty}</p>;
    return tripsTogether(list).map((d) => (
      <article key={keyOf(d)} className="flex flex-col gap-2 rounded-2xl border border-app-border bg-app-card p-4">
        {render(d)}
      </article>
    ));
  };

  return (
    <div className="h-full overflow-y-auto bg-app-bg p-4 pb-nav font-sans text-app-text">
      <div className="mx-auto flex max-w-3xl flex-col gap-4">
        <h2 className="flex items-center gap-2 text-lg font-bold">
          <Truck size={18} className="text-amber-500" /> Deliveries
        </h2>

        {isRider && (
          <dl className="grid grid-cols-3 gap-2 rounded-2xl border border-app-border bg-app-card p-3 text-center">
            <div>
              <dt className="text-xs text-app-text-muted">Delivered</dt>
              <dd className="text-lg font-bold">{delivered.length}</dd>
            </div>
            <div>
              <dt className="text-xs text-app-text-muted">On my list</dt>
              <dd className="text-lg font-bold">{active.length}</dd>
            </div>
            <div>
              <dt className="text-xs text-app-text-muted">Delivery pay</dt>
              <dd className="text-lg font-bold">{formatCurrency(fees)}</dd>
              {kept > 0 && (
                <dd className="text-[10px] leading-tight text-app-text-muted">
                  {formatCurrency(fromShop)} from the shop · {formatCurrency(kept)} kept
                </dd>
              )}
            </div>
          </dl>
        )}

        <Tabs<TabId>
          tabs={[
            { id: 'requests' as const, label: 'Requests', badge: requests?.length ?? 0 },
            ...(isRider
              ? [
                  { id: 'mine' as const, label: 'Mine', badge: active.length },
                  { id: 'history' as const, label: 'History', badge: history.length },
                ]
              : []),
            ...(canGroup ? [{ id: 'trips' as const, label: 'Trips' }] : []),
            { id: 'zones' as const, label: 'Areas & prices' },
          ]}
          activeTab={currentTab}
          onChange={setTab}
        />

        {currentTab === 'requests' && (
          <>
            {requestsMissing && (
              <p className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
                Delivery requests are not available right now. Try again later.
              </p>
            )}
            {!isRider && (
              <p className="text-xs text-app-text-muted">
                Deliveries waiting for a rider.
              </p>
            )}
            {renderList(requests, 'No delivery requests right now. New ones show up here and you get a notification.', (d) => (
              <>
                {renderDetails(d, false)}
                {isRider && canComplete && (
                  <button type="button" disabled={busyKey === keyOf(d)} onClick={() => accept(d)} className={primaryClass}>
                    {d.trip_id ? `Accept trip (${d.trip_size ?? 2} deliveries)` : 'Accept delivery'}
                  </button>
                )}
              </>
            ))}
          </>
        )}

        {currentTab === 'mine' &&
          renderList(active, 'Nothing on your list. Check Requests for deliveries to accept.', (d) => {
            const busy = busyKey === keyOf(d);
            const place = [d.address, d.area].filter(Boolean).join(', ');
            return (
              <>
                {renderDetails(d, true)}
                {place && (
                  <a
                    href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(place)}`}
                    target="_blank"
                    rel="noreferrer"
                    className="flex min-h-11 items-center gap-2 text-sm font-medium underline"
                  >
                    <Navigation size={14} className="text-amber-500" /> Open in maps
                  </a>
                )}
                {confirmFail === keyOf(d) ? (
                  <div className="flex flex-col gap-2 rounded-xl border border-red-500/40 p-3">
                    <p className="text-sm">
                      Mark as not delivered?
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <button type="button" disabled={busy} onClick={() => setStatus(d, 'failed')} className="min-h-11 flex-1 rounded-xl bg-red-500 px-4 text-sm font-bold text-white disabled:opacity-40">
                        Yes, not delivered
                      </button>
                      <button type="button" onClick={() => setConfirmFail(null)} className={secondaryClass}>Back</button>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {canComplete && d.status === 'assigned' && (
                      <button type="button" disabled={busy} onClick={() => setStatus(d, 'out_for_delivery')} className={primaryClass}>
                        Start delivery
                      </button>
                    )}
                    {canComplete && d.status === 'out_for_delivery' && (
                      <button type="button" disabled={busy} onClick={() => setStatus(d, 'delivered')} className={primaryClass}>
                        Mark delivered
                      </button>
                    )}
                    {canComplete && d.status === 'assigned' && !requestsMissing && (
                      <button type="button" disabled={busy} onClick={() => giveBack(d)} className={secondaryClass}>
                        {d.trip_id ? 'Give back trip' : 'Give back'}
                      </button>
                    )}
                    {canCancel && (
                      <button type="button" disabled={busy} onClick={() => setConfirmFail(keyOf(d))} className={secondaryClass}>
                        Couldn't deliver
                      </button>
                    )}
                  </div>
                )}
              </>
            );
          })}

        {currentTab === 'history' && renderList(history, 'No past deliveries yet.', (d) => renderDetails(d, true))}

        {currentTab === 'trips' && canGroup && activeBusinessId && (
          <DeliveryTripsBoard businessId={activeBusinessId} onChanged={() => load().catch(() => undefined)} />
        )}

        {currentTab === 'zones' && activeBusinessId && <DeliveryZonesEditor businessId={activeBusinessId} />}
      </div>
    </div>
  );
}

/** What the rider collects for the delivery and who pays them, in one plain line. */
function DeliveryPayNote({ d, pay }: { d: Delivery; pay: number }) {
  if (!d.delivery_mode || pay <= 0) return null;
  const cls = 'block text-xs font-medium text-emerald-600 dark:text-emerald-400';
  if (d.delivery_mode === 'rider_collects') {
    // A cash sale whose money the rider brings back: one amount to collect, one to keep.
    const goods = d.payment === 'Cash' ? Number(d.amount) || 0 : 0;
    return (
      <span className={cls}>
        {goods > 0
          ? `Collect ${formatCurrency(goods + pay)} in cash: bring ${formatCurrency(goods)} to the shop, keep ${formatCurrency(pay)} for delivery.`
          : `Collect ${formatCurrency(pay)} for delivery in cash and keep it.`}
      </span>
    );
  }
  return (
    <span className={cls}>
      {d.delivery_mode === 'free' ? 'Free delivery for the customer. ' : 'Delivery is on the shop\'s bill. '}
      Collect nothing for it: the shop pays you {formatCurrency(pay)}.
    </span>
  );
}
