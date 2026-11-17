// src/components/DeliveryZonesEditor.tsx
// Delivery areas and their prices. Riders add and price them; owners and admins see who set each
// price and can change anything. Used on the Deliveries page and in Online Store settings.

import React, { FormEvent, useCallback, useEffect, useState } from 'react';
import { MapPin, Pencil, Trash2 } from 'lucide-react';
import { SwipeRow } from './shared/SwipeRow';
import { getSupabase } from '../services/supabaseClient';
import { useAppStore } from '../stores/appStore';
import { formatCurrency } from '../utils/helpers';
import { hasRolePermission } from '../utils/permissions';
import { toUserMessage } from '../utils/userError';
import { Switch } from './shared/Switch';
import { NumberInput } from './shared/Input';

export interface DeliveryZone {
  id: string;
  name: string;
  fee: number;
  active: boolean;
  created_by: string | null;
  created_by_name: string | null;
  updated_by_name: string | null;
  updated_at: string;
}

const inputClass =
  'min-h-11 w-full min-w-0 rounded-xl border border-app-border bg-app-bg px-3 text-sm text-app-text outline-none focus:border-amber-500';
const primaryClass =
  'min-h-11 rounded-xl bg-amber-500 px-4 text-sm font-bold text-slate-950 disabled:opacity-40';
const secondaryClass =
  'min-h-11 rounded-xl border border-app-border px-4 text-sm font-medium text-app-text disabled:opacity-40';

/** Active areas for the business, cheapest first. Used for quick prices at the till. */
export async function fetchActiveZones(businessId: string): Promise<DeliveryZone[]> {
  const { data, error } = await getSupabase()
    .from('delivery_zones')
    .select('id, name, fee, active, created_by, created_by_name, updated_by_name, updated_at')
    .eq('business_id', businessId)
    .eq('active', true)
    .order('fee')
    .order('name');
  if (error) throw error;
  return (data ?? []) as DeliveryZone[];
}

export default function DeliveryZonesEditor({ businessId }: { businessId: string }) {
  const { currentEmployee, showToast } = useAppStore();
  const role = currentEmployee?.role ?? '';
  const isOwner = ['Owner', 'Admin', 'Administrator'].includes(role);
  const canAdd = hasRolePermission(role, 'deliveries.delivery_zones');
  const canEdit = canAdd || hasRolePermission(role, 'deliveries.delivery_price');

  const [zones, setZones] = useState<DeliveryZone[] | null>(null);
  const [myAuthId, setMyAuthId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [fee, setFee] = useState('');
  const [editing, setEditing] = useState<{ id: string; name: string; fee: string } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const fail = useCallback(
    (err: unknown, fallback: string) => showToast('Delivery Areas', toUserMessage(err, fallback), undefined, 'error'),
    [showToast],
  );

  const load = useCallback(async () => {
    const { data, error } = await getSupabase()
      .from('delivery_zones')
      .select('id, name, fee, active, created_by, created_by_name, updated_by_name, updated_at')
      .eq('business_id', businessId)
      .order('name');
    if (error) throw error;
    setZones((data ?? []) as DeliveryZone[]);
  }, [businessId]);

  useEffect(() => {
    load().catch((err) => {
      setZones([]);
      fail(err, 'Could not load delivery areas.');
    });
    getSupabase().auth.getSession().then(({ data }) => setMyAuthId(data.session?.user.id ?? null));
  }, [load, fail]);

  const run = async (action: () => Promise<void>, fallback: string) => {
    setBusy(true);
    try {
      await action();
      await load();
    } catch (err) {
      fail(err, fallback);
    } finally {
      setBusy(false);
    }
  };

  const parseFee = (value: string) => {
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0) throw new Error('Please enter a price of 0 or more.');
    return Math.round(n * 100) / 100;
  };

  const handleAdd = (e: FormEvent) => {
    e.preventDefault();
    run(async () => {
      const { error } = await getSupabase()
        .from('delivery_zones')
        .insert({ business_id: businessId, name: name.trim(), fee: parseFee(fee) });
      if (error) {
        if (error.code === '23505') throw new Error('An area with this name already exists.');
        throw error;
      }
      setName('');
      setFee('');
    }, 'Could not add this delivery area.');
  };

  // RLS hides a refused write as "no rows changed", so check that the row came back.
  const update = (id: string, changes: () => Partial<Pick<DeliveryZone, 'name' | 'fee' | 'active'>>) =>
    run(async () => {
      const { data, error } = await getSupabase().from('delivery_zones').update(changes()).eq('id', id).select('id');
      if (error) {
        if (error.code === '23505') throw new Error('An area with this name already exists.');
        throw error;
      }
      if (!data?.length) throw new Error('Your role does not allow changing delivery areas.');
      setEditing(null);
    }, 'Could not save this delivery area.');

  const remove = (id: string) =>
    run(async () => {
      const { data, error } = await getSupabase().from('delivery_zones').delete().eq('id', id).select('id');
      if (error) throw error;
      if (!data?.length) throw new Error('Only the person who added this area, or an owner, can delete it.');
      setConfirmDelete(null);
    }, 'Could not delete this delivery area.');

  return (
    <section className="flex flex-col gap-3 rounded-2xl border border-app-border bg-app-card p-4 text-app-text">
      <div>
        <h3 className="flex items-center gap-2 font-bold">
          <MapPin size={16} className="text-amber-500" /> Delivery areas and prices
        </h3>
        <p className="text-xs text-app-text-muted">
          Customers pick an area and pay its price. None on: the flat fee is used.
        </p>
      </div>

      {zones === null && <p className="text-sm text-app-text-muted">Loading areas…</p>}
      {zones !== null && zones.length === 0 && <p className="text-sm text-app-text-muted">No delivery areas yet.</p>}

      {zones !== null && zones.length > 0 && (
        <ul className="divide-y divide-app-border">
          {zones.map((zone) => {
            const isEditing = editing?.id === zone.id;
            const canDelete = isOwner || (canAdd && !!myAuthId && zone.created_by === myAuthId);
            const setBy = zone.updated_by_name || zone.created_by_name;
            return (
              <SwipeRow
                key={zone.id}
                as="li"
                title={zone.name}
                subtitle={formatCurrency(Number(zone.fee))}
                disabled={isEditing || !canEdit}
                // Opens the "Delete <area> / Keep" question on the row; nothing is deleted yet.
                actions={[{ label: 'Delete', icon: <Trash2 size={18} />, tone: 'red', hidden: !canDelete, onClick: () => setConfirmDelete(zone.id) }]}
                more={[
                  { label: 'Edit area and price', icon: <Pencil size={16} />, onClick: () => setEditing({ id: zone.id, name: zone.name, fee: String(zone.fee) }) },
                  { label: zone.active ? 'Turn off (hide from customers)' : 'Turn on', icon: <MapPin size={16} />, onClick: () => update(zone.id, () => ({ active: !zone.active })) },
                  { label: 'Delete area', icon: <Trash2 size={16} />, tone: 'red', hidden: !canDelete, onClick: () => setConfirmDelete(zone.id) },
                ]}
                contentClassName="flex flex-col gap-2 py-3"
              >
                {isEditing ? (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      update(zone.id, () => ({ name: editing.name.trim(), fee: parseFee(editing.fee) }));
                    }}
                    className="flex flex-col gap-2 sm:flex-row"
                  >
                    <input required maxLength={80} value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} aria-label="Area name" className={inputClass} />
                    <NumberInput required min={0} value={editing.fee} onChange={(v) => setEditing({ ...editing, fee: (v == null ? '' : String(v)) })} aria-label="Price in Ksh" className="sm:w-32" />
                    <div className="flex gap-2">
                      <button type="submit" disabled={busy} className={`${primaryClass} flex-1`}>Save</button>
                      <button type="button" onClick={() => setEditing(null)} className={secondaryClass}>Cancel</button>
                    </div>
                  </form>
                ) : (
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className={`truncate font-semibold ${zone.active ? '' : 'text-app-text-muted line-through'}`}>{zone.name}</p>
                      <p className="text-xs text-app-text-muted">
                        {setBy ? `Price set by ${setBy}` : 'Price set by the owner'} · {new Date(zone.updated_at).toLocaleDateString()}
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="font-bold">{formatCurrency(Number(zone.fee))}</span>
                      {canEdit && (
                        <button
                          type="button"
                          onClick={() => setEditing({ id: zone.id, name: zone.name, fee: String(zone.fee) })}
                          className="flex min-h-11 min-w-11 items-center justify-center rounded-xl border border-app-border"
                          aria-label={`Edit ${zone.name}`}
                        >
                          <Pencil size={14} />
                        </button>
                      )}
                    </div>
                  </div>
                )}
                {canEdit && !isEditing && (
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <Switch
                      checked={zone.active}
                      disabled={busy}
                      onChange={(active) => update(zone.id, () => ({ active }))}
                      label={zone.active ? 'On: customers can choose it' : 'Off: hidden from customers'}
                    />
                    {canDelete && (confirmDelete === zone.id ? (
                      <span className="flex gap-2">
                        <button type="button" disabled={busy} onClick={() => remove(zone.id)} className="min-h-11 rounded-xl bg-red-500 px-3 text-xs font-bold text-white disabled:opacity-40">
                          Delete {zone.name}
                        </button>
                        <button type="button" onClick={() => setConfirmDelete(null)} className={`${secondaryClass} text-xs`}>Keep</button>
                      </span>
                    ) : (
                      <button type="button" onClick={() => setConfirmDelete(zone.id)} className="min-h-11 px-2 text-xs font-medium text-red-500">
                        Delete
                      </button>
                    ))}
                  </div>
                )}
              </SwipeRow>
            );
          })}
        </ul>
      )}

      {canAdd ? (
        <form
          onSubmit={handleAdd}
          className="flex flex-col gap-2 sm:flex-row"
        >
          <input required maxLength={80} value={name} onChange={(e) => setName(e.target.value)} placeholder="Area name, e.g. Kahawa West" aria-label="Area name" className={inputClass} />
          <NumberInput required min={0} value={fee} onChange={(v) => setFee((v == null ? '' : String(v)))} placeholder="Price (Ksh)" aria-label="Price in Ksh" className="sm:w-32" />
          <button type="submit" disabled={busy} className={primaryClass}>Add area</button>
        </form>
      ) : (
        <p className="text-xs text-app-text-muted">Your role can view these prices but not change them.</p>
      )}
    </section>
  );
}
