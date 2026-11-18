// Regular Orders: who we supply on fixed days. Every cashier and admin sees the same list.
// Pick a day (today by default, tomorrow to plan ahead): customers still to serve come first,
// with Delivered (one sale on their account or paid now) and Change / Skip (with a message to
// the customer). Above it, stock: today's stock less regular orders and usual sales, day by day,
// with a warning and how much to order when it runs short. Customer requests wait for the owner.
// If today's orders are not all done by the ring time, everyone's phone rings (server job).
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, BellRing, CalendarClock, Check, CheckCircle2, Package, Plus, RefreshCw, Truck, UserRound } from 'lucide-react';
import { useBusinessStore, onBranchChange } from '../stores/businessStore';
import { useAuthStore } from '../stores/authStore';
import { useCustomerStore } from '../stores/customerStore';
import { useNotificationStore } from '../stores/notificationStore';
import { hasRolePermission } from '../utils/permissions';
import { formatCurrency } from '../utils/helpers';
import { toUserMessage } from '../utils/userError';
import { FormSheet, Field, fieldClass, primaryBtn, secondaryBtn } from '../components/shared/FormSheet';
import { Segmented } from '../components/shared/Choice';
import SearchableDropdown from '../components/SearchableDropdown';
import {
  DeliverSheet, DaySheet, DecisionSheet, RegularOrderSheet, deliveryPlace, useWaiting,
} from '../components/regular/RegularOrderSheets';
import {
  addDays, customersForDay, dayLabel, kenyaToday, loadRegularOrders, planStock, qtyText, saveRingTime,
  stockAdvice, STATUS_LABEL, weekText,
  type CustomerDay, type RegularBoard, type RegularOrder,
} from '../services/regularOrders';

const REFRESH_MS = 60000;
type View = 'day' | 'all';

export default function RegularOrdersView() {
  const businessId = useBusinessStore((s) => s.activeBusinessId);
  const role = useAuthStore((s) => s.currentEmployee?.role) || '';
  const customers = useCustomerStore((s) => s.customers);
  const canEdit = hasRolePermission(role, 'customers.schedules');
  const canApprove = hasRolePermission(role, 'customers.manage');
  const canSell = hasRolePermission(role, 'pos.create_sale');

  const [board, setBoard] = useState<RegularBoard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const today = board?.today ?? kenyaToday();
  const [day, setDay] = useState(today);
  const [view, setView] = useState<View>('day');
  const [deliver, setDeliver] = useState<CustomerDay | null>(null);
  const [change, setChange] = useState<CustomerDay | null>(null);
  const [decide, setDecide] = useState<RegularOrder | null>(null);
  const [edit, setEdit] = useState<{ customerId: string; name: string; order: RegularOrder | null } | null>(null);
  const [pickCustomer, setPickCustomer] = useState(false);

  const load = useCallback(async () => {
    if (!businessId) return;
    setLoading(true);
    try {
      const t = kenyaToday();
      setBoard(await loadRegularOrders(businessId, addDays(t, -1), addDays(t, 6)));
      setError(null);
    } catch (e) {
      setError(toUserMessage(e, 'Could not load regular orders. Check your connection.'));
    } finally {
      setLoading(false);
    }
  }, [businessId]);

  useEffect(() => {
    load();
    const timer = setInterval(load, REFRESH_MS);
    const onFocus = () => load();
    window.addEventListener('focus', onFocus);
    const off = onBranchChange(() => { setBoard(null); load(); });
    return () => { clearInterval(timer); window.removeEventListener('focus', onFocus); off(); };
  }, [load]);

  // Follow the date over midnight.
  useEffect(() => { if (board && day < addDays(board.today, -1)) setDay(board.today); }, [board, day]);

  const days = useMemo(() => [-1, 0, 1, 2, 3, 4, 5, 6].map((n) => addDays(today, n)), [today]);
  const list = useMemo(() => (board ? customersForDay(board, day) : []), [board, day]);
  // Stock through the chosen day (at least through tomorrow), from today.
  const stockDays = useMemo(() => days.filter((d) => d >= today && d <= (day > addDays(today, 1) ? day : addDays(today, 1))), [days, today, day]);
  const plan = useMemo(() => (board ? planStock(board, stockDays) : []), [board, stockDays]);
  const waiting = useWaiting(board?.orders ?? []);
  const open = list.filter((c) => c.state === 'open');

  const dayChip = (d: string) => {
    const n = board ? customersForDay(board, d).filter((c) => c.state === 'open').length : 0;
    const label = dayLabel(d, today);
    return { id: d, label: label.length > 9 ? label.split(' ').slice(0, 2).join(' ') : label, count: n || undefined };
  };

  if (!businessId) return null;

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-4xl mx-auto px-4 py-4 space-y-4 pb-[calc(6rem+var(--inset-bottom))]">
        <header className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <h1 className="text-lg font-semibold">Regular Orders</h1>
            <p className="text-sm text-app-text-muted">Customers we supply on fixed days</p>
          </div>
          <button className={secondaryBtn} onClick={load} disabled={loading} aria-label="Refresh"><RefreshCw size={15} className={loading ? 'animate-spin' : ''} /></button>
          {canEdit && <button className={primaryBtn} onClick={() => setPickCustomer(true)}><Plus size={16} /> Add</button>}
        </header>

        {error && <p className="rounded-xl bg-red-500/10 text-red-700 dark:text-red-300 p-3 text-sm">{error}</p>}

        <Segmented<View> options={[{ id: 'day', label: 'By day' }, { id: 'all', label: `All orders${board ? ` (${board.orders.filter((o) => o.status === 'active').length})` : ''}` }]} value={view} onChange={setView} size="sm" ariaLabel="View" />

        {waiting.length > 0 && (
          <section className="rounded-2xl ring-1 ring-amber-500/40 bg-amber-500/5 p-3 space-y-2">
            <h2 className="text-sm font-semibold flex items-center gap-2"><UserRound size={16} className="text-amber-600" /> Customers asking ({waiting.length})</h2>
            {!canApprove && <p className="text-xs text-app-text-muted">The owner or a manager approves these.</p>}
            <ul className="space-y-1.5">
              {waiting.map((o) => (
                <li key={o.id}>
                  <button disabled={!canApprove} onClick={() => setDecide(o)} className="w-full text-left flex items-center gap-3 rounded-xl bg-app-card ring-1 ring-app-border px-3 py-2 hover:bg-app-bg disabled:cursor-default cursor-pointer">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium truncate">{o.customerName} · {o.productName}</p>
                      <p className="text-xs text-app-text-muted truncate">
                        {o.status === 'requested' ? 'New: ' : 'Change to: '}{weekText(o.pendingDayQty ?? o.dayQty, o.unit)}
                      </p>
                    </div>
                    {canApprove && <span className="text-xs font-semibold text-amber-700 dark:text-amber-400">Review</span>}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        {view === 'day' && (
          <>
            <div className="overflow-x-auto -mx-4 px-4">
              <div className="flex gap-1.5 w-max">
                {days.map((d) => {
                  const c = dayChip(d);
                  const on = d === day;
                  return (
                    <button key={d} onClick={() => setDay(d)}
                      className={`px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap ring-1 cursor-pointer ${on ? 'bg-amber-500 text-slate-950 ring-amber-500' : 'bg-app-card ring-app-border text-app-text hover:bg-app-bg'}`}>
                      {c.label}{c.count ? <span className={`ml-1.5 inline-block min-w-[1.25rem] rounded-full px-1 ${on ? 'bg-slate-950/15' : 'bg-amber-500/20 text-amber-700 dark:text-amber-400'}`}>{c.count}</span> : null}
                    </button>
                  );
                })}
              </div>
            </div>

            {plan.length > 0 && day >= today && (
              <section className="rounded-2xl ring-1 ring-app-border bg-app-card p-3 space-y-2">
                <h2 className="text-sm font-semibold flex items-center gap-2"><Package size={16} /> Stock {stockDays.length > 1 ? `to ${dayLabel(stockDays[stockDays.length - 1], today).toLowerCase()}` : 'today'}</h2>
                <ul className="divide-y divide-app-border/60">
                  {plan.map((p) => {
                    const need = p.days.reduce((s, d) => s + d.regular, 0);
                    const tone = p.level === 'short' ? 'text-red-600' : p.level === 'tight' ? 'text-amber-600' : 'text-emerald-600';
                    return (
                      <li key={p.productId} className="py-2 flex items-start gap-3">
                        {p.level === 'ok' ? <CheckCircle2 size={16} className={`${tone} mt-0.5 shrink-0`} /> : <AlertTriangle size={16} className={`${tone} mt-0.5 shrink-0`} />}
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium">{p.name}</p>
                          <p className="text-xs text-app-text-muted">
                            {qtyText(p.stock)} in stock · regular orders {qtyText(need)} · usual sales about {qtyText(p.avgOther)} a day
                          </p>
                          <p className={`text-xs font-medium ${tone}`}>{stockAdvice(p, today)}</p>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </section>
            )}

            <section className="space-y-2">
              <h2 className="text-sm font-semibold flex items-center gap-2">
                <Truck size={16} /> {dayLabel(day, today)}
                <span className="font-normal text-app-text-muted">
                  {list.length === 0 ? '' : open.length === 0 ? '· all done' : `· ${open.length} still to serve`}
                </span>
              </h2>
              {board && list.length === 0 && (
                <p className="rounded-2xl bg-app-card ring-1 ring-app-border p-4 text-sm text-app-text-muted">
                  No regular orders {dayLabel(day, today).toLowerCase() === 'today' ? 'today' : `on ${dayLabel(day, today)}`}.
                  {canEdit ? ' Add one with the Add button, or from the customer’s page in Loyalty.' : ''}
                </p>
              )}
              <ul className="space-y-2">
                {list.map((c) => (
                  <li key={c.customerId} className={`rounded-2xl ring-1 bg-app-card p-3 ${c.state === 'open' ? 'ring-app-border' : 'ring-app-border/50 opacity-80'}`}>
                    <div className="flex items-start gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold truncate">{c.name}</p>
                        <ul className="mt-1 space-y-0.5">
                          {c.items.map(({ order, line }) => (
                            <li key={order.id} className="text-xs">
                              <span className={line.state === 'skipped' ? 'line-through text-app-text-muted' : ''}>
                                {order.productName} {qtyText(line.state === 'skipped' ? line.planned : line.quantity)}{order.unit ? ` ${order.unit}` : ''}
                              </span>
                              {line.state === 'changed' && <span className="ml-1 text-amber-600">(usually {qtyText(line.planned)})</span>}
                              {line.state === 'delivered' && <span className="ml-1 text-emerald-600">delivered{line.by ? ` by ${line.by}` : ''}</span>}
                              {line.state === 'skipped' && <span className="ml-1 text-app-text-muted">skipped</span>}
                              {order.fulfilment === 'pickup' && line.state !== 'delivered' && <span className="ml-1 text-app-text-muted">· collects</span>}
                            </li>
                          ))}
                        </ul>
                        {c.items[0]?.order.fulfilment === 'delivery' && c.items[0].order.address && c.state === 'open' && (
                          <p className="text-xs text-app-text-muted mt-1 truncate">To: {c.items[0].order.address}</p>
                        )}
                      </div>
                      {c.state === 'done' && <Check size={18} className="text-emerald-600 shrink-0" />}
                    </div>
                    {c.state !== 'done' && (canEdit || canSell) && (
                      <div className="mt-2 flex flex-wrap gap-2 justify-end">
                        {canEdit && <button className={`${secondaryBtn} py-1.5`} onClick={() => setChange(c)}>{c.state === 'skipped' ? 'Change' : 'Change / skip'}</button>}
                        {canSell && c.state === 'open' && day <= today && (
                          <button className={`${primaryBtn} py-1.5`} onClick={() => setDeliver(c)}><Check size={15} /> Delivered · {formatCurrency(c.value)}</button>
                        )}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </section>

            {board && <RingTime businessId={businessId} ringAt={board.ringAt} canChange={canApprove} onSaved={load} />}
          </>
        )}

        {view === 'all' && board && (
          <AllOrders orders={board.orders} canEdit={canEdit}
            onOpen={(o) => (o.status === 'requested' || o.pendingDayQty) && canApprove ? setDecide(o) : setEdit({ customerId: o.customerId, name: o.customerName, order: o })} />
        )}
      </div>

      {deliver && <DeliverSheet businessId={businessId} day={day} today={today} entry={deliver} onClose={() => setDeliver(null)} onDone={load} />}
      {change && <DaySheet businessId={businessId} day={day} today={today} entry={change} onClose={() => setChange(null)} onDone={load} />}
      {decide && <DecisionSheet businessId={businessId} order={decide} onClose={() => setDecide(null)} onDone={load} />}
      {edit && (
        <RegularOrderSheet businessId={businessId} customerId={edit.customerId} customerName={edit.name} order={edit.order}
          defaultAddress={deliveryPlace(customers.find((c) => c.id === edit.customerId))} canApprove={canApprove}
          onClose={() => setEdit(null)} onSaved={load} />
      )}
      {pickCustomer && (
        <PickCustomer onClose={() => setPickCustomer(false)} onPick={(id, name) => { setPickCustomer(false); setEdit({ customerId: id, name, order: null }); }} />
      )}
    </div>
  );
}

function AllOrders({ orders, canEdit, onOpen }: { orders: RegularOrder[]; canEdit: boolean; onOpen: (o: RegularOrder) => void }) {
  const byCustomer = useMemo(() => {
    const m = new Map<string, RegularOrder[]>();
    for (const o of orders) m.set(o.customerId, [...(m.get(o.customerId) ?? []), o]);
    return [...m.values()];
  }, [orders]);
  if (orders.length === 0) return <p className="rounded-2xl bg-app-card ring-1 ring-app-border p-4 text-sm text-app-text-muted">No regular orders yet.</p>;
  return (
    <ul className="space-y-2">
      {byCustomer.map((list) => (
        <li key={list[0].customerId} className="rounded-2xl ring-1 ring-app-border bg-app-card p-3">
          <p className="text-sm font-semibold">{list[0].customerName}
            {list[0].debtBalance > 0 && <span className="ml-2 text-xs font-normal text-red-600">owes {formatCurrency(list[0].debtBalance)}</span>}
          </p>
          <ul className="mt-1 divide-y divide-app-border/50">
            {list.map((o) => (
              <li key={o.id}>
                <button disabled={!canEdit} onClick={() => onOpen(o)} className="w-full text-left py-1.5 flex items-center gap-2 disabled:cursor-default cursor-pointer">
                  <span className="min-w-0 flex-1 text-xs">
                    <span className="font-medium text-sm">{o.productName}</span>{' '}
                    <span className="text-app-text-muted">{weekText(o.dayQty, o.unit)}</span>
                  </span>
                  <span className={`text-[11px] px-2 py-0.5 rounded-full ${o.status === 'active' ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400' : 'bg-app-bg text-app-text-muted'}`}>
                    {o.pendingDayQty ? 'Change asked' : STATUS_LABEL[o.status]}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ul>
  );
}

function PickCustomer({ onClose, onPick }: { onClose: () => void; onPick: (id: string, name: string) => void }) {
  const customers = useCustomerStore((s) => s.customers);
  const [id, setId] = useState('');
  return (
    <FormSheet title="New regular order" subtitle="Choose the customer" onClose={onClose}
      footer={<>
        <button className={secondaryBtn} onClick={onClose}>Cancel</button>
        <button className={primaryBtn} disabled={!id} onClick={() => onPick(id, customers.find((c) => c.id === id)?.name || 'Customer')}>Next</button>
      </>}>
      <Field label="Customer">
        <SearchableDropdown items={customers.map((c) => ({ id: c.id, label: c.name, sublabel: c.phone || undefined }))}
          selectedValue={id} onChange={setId} placeholder="Choose a customer" searchPlaceholder="Name or phone" />
      </Field>
      <p className="text-xs text-app-text-muted">Not listed? Add them in Loyalty first.</p>
    </FormSheet>
  );
}

function RingTime({ businessId, ringAt, canChange, onSaved }: { businessId: string; ringAt: string; canChange: boolean; onSaved: () => void }) {
  const [value, setValue] = useState(ringAt);
  const [busy, setBusy] = useState(false);
  useEffect(() => setValue(ringAt), [ringAt]);
  const save = async () => {
    setBusy(true);
    try {
      await saveRingTime(businessId, value);
      useNotificationStore.getState().showToast('Saved', `Rings at ${value} if today's orders are not done.`, undefined, 'success');
      onSaved();
    } catch (e) {
      useNotificationStore.getState().showToast('Not saved', toUserMessage(e, 'Could not save.'), undefined, 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="rounded-2xl ring-1 ring-app-border bg-app-card p-3 flex flex-wrap items-center gap-3">
      <BellRing size={16} className="text-app-text-muted" />
      <p className="text-xs text-app-text-muted flex-1 min-w-[12rem]">
        From {ringAt}, everyone's phone rings while today's orders are not all delivered or skipped, then every 2 hours.
      </p>
      {canChange && (
        <div className="flex items-center gap-2">
          <input type="time" className={`${fieldClass} w-28 py-1.5`} value={value} min="06:00" max="22:00" onChange={(e) => setValue(e.target.value)} aria-label="Ring time" />
          <button className={`${secondaryBtn} py-1.5`} onClick={save} disabled={busy || value === ringAt}><CalendarClock size={14} /> Save</button>
        </div>
      )}
    </section>
  );
}
