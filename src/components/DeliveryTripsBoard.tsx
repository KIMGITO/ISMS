// src/components/DeliveryTripsBoard.tsx
// Group deliveries into trips before riders are paid (20261130001_delivery_trips).
// Three customers on one estate each pay KSh 200 delivery, but the rider goes once: put the
// three in one trip and the rider earns the trip pay (say KSh 200) instead of 600. What the
// customers pay never changes. Grouping is optional; a delivery left alone is paid as before.
//
// Rules the database enforces: two or more deliveries, one rider (or all still waiting for a
// rider), none the customer pays the rider for in cash, none already in a trip.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Layers, MapPin, Route, Undo2 } from 'lucide-react';
import { Checkbox } from './shared/Checkbox';
import { NumberInput } from './shared/Input';
import { getSupabase } from '../services/supabaseClient';
import { useAppStore } from '../stores/appStore';
import { formatCurrency } from '../utils/helpers';
import { toUserMessage } from '../utils/userError';

export interface BoardDelivery {
  source: 'online' | 'sale';
  id: string;
  reference: string;
  customer_name: string;
  address: string | null;
  area: string | null;
  amount: number;
  delivery_fee: number;
  status: 'assigned' | 'out_for_delivery' | 'delivered' | 'failed';
  created_at: string;
  delivery_mode?: 'charged' | 'rider_collects' | 'free';
  rider_pay: number;
  own_pay?: number;
  trip_id?: string | null;
  trip_pay?: number | null;
  trip_size?: number | null;
  rider_id?: string | null;
  rider_name?: string | null;
}

const keyOf = (d: { source: string; id: string }) => `${d.source}-${d.id}`;
const placeOf = (d: BoardDelivery) => [d.area, d.address].filter(Boolean).join(', ');
/** Deliveries to the same place: lower case, no punctuation or extra spaces. */
const placeKey = (d: BoardDelivery) => placeOf(d).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const riderKey = (d: BoardDelivery) => d.rider_id ?? 'open';
const ownPay = (d: BoardDelivery) => Number(d.own_pay ?? d.rider_pay ?? 0);
const canJoin = (d: BoardDelivery) => !d.trip_id && d.delivery_mode !== 'rider_collects' && d.status !== 'failed';

const STATUS: Record<BoardDelivery['status'], string> = {
  assigned: 'Accepted',
  out_for_delivery: 'On the way',
  delivered: 'Delivered',
  failed: 'Not delivered',
};
const statusOf = (d: BoardDelivery) => (d.rider_id ? STATUS[d.status] : 'Waiting for a rider');

const primaryClass = 'min-h-11 rounded-xl bg-amber-500 px-4 text-sm font-bold text-slate-950 disabled:opacity-40 cursor-pointer';
const secondaryClass = 'min-h-11 rounded-xl border border-app-border px-4 text-sm font-medium disabled:opacity-40 cursor-pointer';

export default function DeliveryTripsBoard({ businessId, onChanged }: { businessId: string; onChanged?: () => void }) {
  const { showToast } = useAppStore();
  const [rows, setRows] = useState<BoardDelivery[] | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [pay, setPay] = useState<Record<string, number | null>>({});
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data, error } = await getSupabase().rpc('get_delivery_board', { p_business_id: businessId });
    if (error) throw error;
    setRows((data ?? []) as BoardDelivery[]);
  }, [businessId]);

  useEffect(() => {
    load().catch((err) => {
      setRows([]);
      showToast('Could not load deliveries', toUserMessage(err, 'Please try again.'), undefined, 'error');
    });
  }, [load, showToast]);

  const free = useMemo(() => (rows ?? []).filter(canJoin), [rows]);

  // Same rider (or still open) and same place, two or more: offer them as one trip.
  const suggestions = useMemo(() => {
    const groups = new Map<string, BoardDelivery[]>();
    for (const d of free) {
      const place = placeKey(d);
      if (!place) continue;
      const k = `${riderKey(d)}|${place}`;
      groups.set(k, [...(groups.get(k) ?? []), d]);
    }
    return [...groups.entries()].filter(([, list]) => list.length >= 2).map(([k, list]) => ({ key: k, list }));
  }, [free]);

  const trips = useMemo(() => {
    const byTrip = new Map<string, BoardDelivery[]>();
    for (const d of rows ?? []) if (d.trip_id) byTrip.set(d.trip_id, [...(byTrip.get(d.trip_id) ?? []), d]);
    return [...byTrip.entries()].map(([id, list]) => ({ id, list, pay: Number(list[0].trip_pay ?? 0) }));
  }, [rows]);

  const pickedRows = free.filter((d) => picked.includes(keyOf(d)));
  const pickedRiders = new Set(pickedRows.map(riderKey));
  const mixedRiders = pickedRiders.size > 1;

  const run = async (key: string, fn: () => PromiseLike<{ error: unknown }>, done: string) => {
    setBusy(key);
    try {
      const { error } = await fn();
      if (error) throw error;
      showToast('Deliveries', done, undefined, 'success');
      setPicked([]);
      await load();
      onChanged?.();
    } catch (err) {
      showToast('Could not update', toUserMessage(err, 'Please try again.'), undefined, 'error');
      load().catch(() => undefined);
    } finally {
      setBusy(null);
    }
  };

  const group = (key: string, list: BoardDelivery[], tripPay: number | null | undefined, label?: string) => {
    const amount = tripPay ?? Math.max(...list.map(ownPay));
    return run(
      key,
      () => getSupabase().rpc('group_deliveries', {
        p_business_id: businessId,
        p_items: list.map((d) => ({ source: d.source, id: d.id })),
        p_rider_pay: amount,
        p_label: label ?? null,
      }),
      `${list.length} deliveries are one trip. The rider gets ${formatCurrency(amount)} for it.`,
    );
  };

  const defaultPay = (list: BoardDelivery[]) => (list.length ? Math.max(...list.map(ownPay)) : 0);
  const separatePay = (list: BoardDelivery[]) => list.reduce((s, d) => s + ownPay(d), 0);

  const payBox = (k: string, list: BoardDelivery[]) => (
    <label className="flex flex-col gap-1 text-xs text-app-text-muted min-w-0 flex-1">
      Rider gets for the trip
      <NumberInput
        value={pay[k] ?? defaultPay(list)}
        onChange={(v) => setPay((p) => ({ ...p, [k]: v }))}
        min={0}
        prefix="KSh"
        aria-label="Rider pay for the trip"
      />
    </label>
  );

  const line = (d: BoardDelivery) => (
    <span className="min-w-0">
      <span className="block text-sm font-medium truncate">
        {d.customer_name} <span className="font-normal text-app-text-muted">· {d.reference}</span>
      </span>
      <span className="block text-xs text-app-text-muted truncate">
        {placeOf(d) || 'No location'} · {d.rider_name || 'No rider yet'} · {statusOf(d)} · pays {formatCurrency(Number(d.delivery_fee))}
      </span>
    </span>
  );

  if (rows === null) return <p className="text-sm text-app-text-muted">Loading deliveries…</p>;

  return (
    <div className="flex flex-col gap-4">
      <p className="text-xs text-app-text-muted">
        Deliveries that go in one round can be one trip: the rider is paid once for the trip. Customers still pay their own delivery.
      </p>

      {suggestions.length > 0 && (
        <section className="flex flex-col gap-2">
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <MapPin size={14} className="text-amber-500" /> Same place
          </h3>
          {suggestions.map(({ key, list }) => {
            const tripPay = pay[key] ?? defaultPay(list);
            return (
              <article key={key} className="flex flex-col gap-2 rounded-2xl border border-app-border bg-app-card p-4">
                <p className="text-sm font-semibold">
                  {list.length} deliveries to {placeOf(list[0])}
                  <span className="font-normal text-app-text-muted"> · {list[0].rider_name || 'no rider yet'}</span>
                </p>
                <ul className="flex flex-col gap-1">{list.map((d) => <li key={keyOf(d)} data-search-id={`delivery-${d.source}-${d.id}`}>{line(d)}</li>)}</ul>
                <div className="flex flex-wrap items-end gap-2">
                  {payBox(key, list)}
                  <button
                    type="button"
                    disabled={busy === key || tripPay == null}
                    onClick={() => group(key, list, tripPay, placeOf(list[0]))}
                    className={primaryClass}
                  >
                    Make one trip
                  </button>
                </div>
                <p className="text-xs text-app-text-muted">
                  Paid separately: {formatCurrency(separatePay(list))}. As one trip: {formatCurrency(tripPay ?? 0)}.
                </p>
              </article>
            );
          })}
        </section>
      )}

      <section className="flex flex-col gap-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <Layers size={14} className="text-amber-500" /> Pick deliveries
        </h3>
        {free.length < 2 ? (
          <p className="text-sm text-app-text-muted">Fewer than two deliveries from the last 7 days can go in a trip.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-app-border/60 rounded-2xl border border-app-border bg-app-card px-3">
            {free.map((d) => {
              const k = keyOf(d);
              return (
                <li key={k} data-search-id={`delivery-${d.source}-${d.id}`} className="py-2">
                  <Checkbox
                    checked={picked.includes(k)}
                    onChange={(on) => setPicked((p) => (on ? [...p, k] : p.filter((x) => x !== k)))}
                    label={line(d)}
                  />
                </li>
              );
            })}
          </ul>
        )}
        {pickedRows.length >= 1 && (
          <div className="sticky bottom-2 flex flex-col gap-2 rounded-2xl border border-amber-500/40 bg-app-card p-3 shadow-lg">
            {mixedRiders ? (
              <p className="text-sm text-red-600 dark:text-red-400">
                A trip is one rider's round. Pick deliveries of the same rider, or ones still waiting for a rider.
              </p>
            ) : pickedRows.length < 2 ? (
              <p className="text-sm text-app-text-muted">Pick at least one more.</p>
            ) : (
              <div className="flex flex-wrap items-end gap-2">
                {payBox('picked', pickedRows)}
                <button
                  type="button"
                  disabled={busy === 'picked' || (pay.picked ?? defaultPay(pickedRows)) == null}
                  onClick={() => group('picked', pickedRows, pay.picked ?? defaultPay(pickedRows))}
                  className={primaryClass}
                >
                  Group {pickedRows.length} as one trip
                </button>
              </div>
            )}
            <button type="button" onClick={() => setPicked([])} className="self-start text-xs font-medium text-app-text-muted underline cursor-pointer">
              Clear
            </button>
          </div>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <Route size={14} className="text-amber-500" /> Trips
        </h3>
        {trips.length === 0 ? (
          <p className="text-sm text-app-text-muted">No trips in the last 7 days.</p>
        ) : (
          trips.map((t) => {
            const k = `trip-${t.id}`;
            const newPay = pay[k];
            return (
              <article key={t.id} className="flex flex-col gap-2 rounded-2xl border border-app-border bg-app-card p-4">
                <p className="text-sm font-semibold">
                  {t.list.length} deliveries · {t.list[0].rider_name || 'no rider yet'} · rider gets {formatCurrency(t.pay)}
                </p>
                <p className="text-xs text-app-text-muted">
                  Customers paid {formatCurrency(t.list.reduce((s, d) => s + Number(d.delivery_fee), 0))}. Paid separately it would be{' '}
                  {formatCurrency(separatePay(t.list))}.
                </p>
                <ul className="flex flex-col gap-1">{t.list.map((d) => <li key={keyOf(d)} data-search-id={`delivery-${d.source}-${d.id}`}>{line(d)}</li>)}</ul>
                <div className="flex flex-wrap items-end gap-2">
                  <label className="flex flex-col gap-1 text-xs text-app-text-muted min-w-0 flex-1">
                    Rider gets for the trip
                    <NumberInput value={newPay ?? t.pay} onChange={(v) => setPay((p) => ({ ...p, [k]: v }))} min={0} prefix="KSh" />
                  </label>
                  {newPay != null && newPay !== t.pay && (
                    <button
                      type="button"
                      disabled={busy === k}
                      onClick={() => run(k, () => getSupabase().rpc('set_delivery_trip_pay', { p_trip_id: t.id, p_rider_pay: newPay }), `Trip pay is now ${formatCurrency(newPay)}.`)}
                      className={primaryClass}
                    >
                      Save pay
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={busy === k}
                    onClick={() => run(k, () => getSupabase().rpc('ungroup_delivery_trip', { p_trip_id: t.id }), 'Trip undone. Each delivery is paid on its own again.')}
                    className={`${secondaryClass} flex items-center gap-1.5`}
                  >
                    <Undo2 size={14} /> Undo trip
                  </button>
                </div>
              </article>
            );
          })
        )}
      </section>
    </div>
  );
}
