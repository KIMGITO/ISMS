// Regular orders from the customer's side (20261130005): the same orders the shop sees.
// Ask for a product on fixed days with an amount for each day; the shop confirms it. A change
// to a running order waits for the shop too, while the current amounts keep coming. The coming
// days show anything the shop changed or couldn't deliver, with their message.
import { FormEvent, useEffect, useState } from 'react';
import { CalendarClock, Pencil, Plus, Undo2 } from 'lucide-react';
import { fetchRegularOrders, friendlyError, requestRegularOrder, withdrawRegularOrderRequest, RegularDay, RegularOrder } from '../api';
import { useAuth, useStorefront } from '../store';
import { formatLocation } from '../customerProfile';
import { cardClass, ErrorText, fieldClass, formatPrice, Loading, primaryButton, qtyNumber, secondaryButton } from '../ui';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const WEEK = [1, 2, 3, 4, 5, 6, 0]; // shown Monday first
const qty = (n: number) => qtyNumber(n);

/** "Mon–Fri 10", "Sat 10", "Mon–Tue 20 · Wed–Thu 23 · Fri 19". */
function weekText(dayQty: number[], unit = '') {
  const qs = WEEK.map((d) => dayQty[d] || 0);
  if (qs.every((q) => q === 0)) return 'Stop';
  const u = unit ? ` ${unit}` : '';
  if (qs.every((q) => q === qs[0])) return `Every day ${qty(qs[0])}${u}`;
  const parts: string[] = [];
  for (let i = 0; i < 7; ) {
    if (!qs[i]) { i++; continue; }
    let j = i;
    while (j + 1 < 7 && qs[j + 1] === qs[i]) j++;
    parts.push(`${i === j ? DAYS[WEEK[i]] : `${DAYS[WEEK[i]]}–${DAYS[WEEK[j]]}`} ${qty(qs[i])}`);
    i = j + 1;
  }
  return parts.join(' · ') + u;
}

const STATUS: Record<RegularOrder['status'], string> = {
  requested: 'Waiting for the shop to confirm',
  active: 'Running',
  paused: 'Paused by the shop',
  declined: 'Not accepted',
  ended: 'Stopped',
};

interface Draft {
  id: string | null;
  productId: string;
  dayQty: string[];
  fulfilment: 'delivery' | 'pickup';
  address: string;
  note: string;
}

function OrderForm({ initial, unitOf, onDone }: { initial: Draft; unitOf: (id: string) => string; onDone: () => void }) {
  const { products, settings, business } = useStorefront();
  const [draft, setDraft] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const amounts = draft.dayQty.map((v) => Number(v) || 0);
  const product = products.find((p) => p.id === draft.productId);
  const isNew = draft.id === null;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (isNew && !draft.productId) return setError('Please choose a product.');
    if (isNew && amounts.every((a) => a === 0)) return setError('Please enter an amount for at least one day.');
    setBusy(true);
    setError('');
    try {
      await requestRegularOrder({ id: draft.id, productId: isNew ? draft.productId : null, dayQty: amounts, fulfilment: draft.fulfilment, address: draft.address, note: draft.note });
      onDone();
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className={`${cardClass} space-y-5 p-5`}>
      {isNew ? (
        <label className="block font-semibold">
          Product
          <select value={draft.productId} onChange={(e) => setDraft({ ...draft, productId: e.target.value })} className={fieldClass} required>
            <option value="">Choose a product</option>
            {products.map((p) => <option key={p.id} value={p.id}>{p.name} ({formatPrice(business.currency, p.price)} / {p.unit})</option>)}
          </select>
        </label>
      ) : (
        <p className="font-semibold">{product?.name ?? 'Your order'}</p>
      )}

      <fieldset>
        <legend className="font-semibold">How much on each day?</legend>
        <p className="text-sm text-muted">Leave a day at 0 if you don't need it then.</p>
        <div className="mt-2 grid grid-cols-7 gap-1.5">
          {WEEK.map((d) => (
            <label key={d} className="flex flex-col items-center gap-1 text-sm font-medium">
              {DAYS[d]}
              <input
                type="number" inputMode="decimal" min="0" max="1000" step="0.5" placeholder="0"
                value={draft.dayQty[d]}
                onChange={(e) => { const next = [...draft.dayQty]; next[d] = e.target.value.replace(/([.,]\d)\d+$/, '$1'); setDraft({ ...draft, dayQty: next }); }}
                className="h-11 w-full rounded-lg border border-line px-1 text-center text-base"
                aria-label={`${DAYS[d]} amount`}
              />
            </label>
          ))}
        </div>
        <p className="mt-2 text-sm text-muted">{weekText(amounts, unitOf(draft.productId))}</p>
      </fieldset>

      <label className="block font-semibold">
        How will you receive it?
        <select value={draft.fulfilment} onChange={(e) => setDraft({ ...draft, fulfilment: e.target.value as Draft['fulfilment'] })} className={fieldClass}>
          {settings.deliveryEnabled && <option value="delivery">Delivery</option>}
          <option value="pickup">Pickup</option>
        </select>
      </label>
      {draft.fulfilment === 'delivery' && (
        <label className="block font-semibold">
          Delivery location
          <textarea required rows={2} maxLength={300} value={draft.address} onChange={(e) => setDraft({ ...draft, address: e.target.value })} className={fieldClass} />
        </label>
      )}
      <label className="block font-semibold">
        Note for the shop (optional)
        <input maxLength={500} value={draft.note} onChange={(e) => setDraft({ ...draft, note: e.target.value })} className={fieldClass} />
      </label>

      <p className="text-sm text-muted">
        {isNew ? 'The shop confirms your order before the first delivery.' : 'The shop confirms the change. Until then your current amounts keep coming.'}
        {' '}Deliveries go on your account; you pay from your wallet or your balance.
      </p>
      <ErrorText>{error}</ErrorText>
      <div className="flex flex-col gap-2 sm:flex-row">
        <button type="submit" disabled={busy} className={primaryButton}>{busy ? 'Sending…' : isNew ? 'Ask the shop' : 'Send change'}</button>
        <button type="button" onClick={onDone} className={secondaryButton}>Cancel</button>
      </div>
    </form>
  );
}

function dayName(day: string, today: string) {
  const d = new Date(`${day}T12:00:00Z`);
  const t = new Date(`${today}T12:00:00Z`);
  const diff = Math.round((d.getTime() - t.getTime()) / 864e5);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff === -1) return 'Yesterday';
  return d.toLocaleDateString('en-KE', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
}

export default function SchedulesTab() {
  const { settings } = useStorefront();
  const account = useAuth((s) => s.account)!;
  const [data, setData] = useState<{ today: string; orders: RegularOrder[]; days: RegularDay[] } | null>(null);
  const [editing, setEditing] = useState<Draft | null>(null);
  const [error, setError] = useState('');

  const load = () => fetchRegularOrders().then(setData).catch((err) => setError(friendlyError(err)));
  useEffect(() => { load(); }, []);

  const defaultAddress = formatLocation({ address: account.delivery_address, building: account.delivery_building, landmark: account.delivery_landmark });
  const toDraft = (o: RegularOrder): Draft => ({
    id: o.id,
    productId: o.productId,
    dayQty: (o.pendingDayQty ?? o.dayQty).map((n) => (n ? String(n) : '')),
    fulfilment: o.pendingFulfilment ?? o.fulfilment,
    address: o.pendingAddress ?? o.address ?? defaultAddress,
    note: o.pendingNote ?? o.note ?? '',
  });

  const act = async (action: () => Promise<unknown>) => {
    setError('');
    try {
      await action();
      await load();
    } catch (err) {
      setError(friendlyError(err));
    }
  };

  if (!data) return error ? <ErrorText>{error}</ErrorText> : <Loading />;
  const unitOf = (productId: string) => data.orders.find((o) => o.productId === productId)?.unit ?? '';

  if (editing) {
    return (
      <div className="max-w-2xl">
        <OrderForm initial={editing} unitOf={unitOf} onDone={() => { setEditing(null); load(); }} />
      </div>
    );
  }

  // The coming days with something to tell: changed amounts and days the shop can't come.
  const news = data.days.filter((d) => d.state === 'skipped' || d.state === 'changed' || (d.state === 'delivered' && d.day >= data.today));
  const upcoming = data.days.filter((d) => d.day >= data.today && (d.state === 'due' || d.state === 'changed') && d.quantity > 0).slice(0, 6);
  const nameOf = (orderId: string) => data.orders.find((o) => o.id === orderId);

  return (
    <div className="max-w-2xl space-y-4">
      <p className="text-muted">Get the same products on fixed days, with a different amount each day if you like. The shop confirms each order and change.</p>
      <ErrorText>{error}</ErrorText>
      <button
        onClick={() => setEditing({ id: null, productId: '', dayQty: ['', '', '', '', '', '', ''], fulfilment: settings.deliveryEnabled ? 'delivery' : 'pickup', address: defaultAddress, note: '' })}
        className={`${primaryButton} w-full sm:w-auto`}
      >
        <Plus size={18} aria-hidden /> New regular order
      </button>

      {data.orders.length === 0 ? (
        <p className="rounded-xl border border-dashed border-line p-8 text-center text-muted">You don't have any regular orders yet.</p>
      ) : (
        <ul className="space-y-3">
          {data.orders.map((o) => (
            <li key={o.id} className={`${cardClass} p-4`}>
              <div className="flex items-start gap-3">
                <CalendarClock className="mt-0.5 shrink-0 text-brand-deep" aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">{o.productName}</p>
                  <p className="mt-1 text-muted">{weekText(o.dayQty, o.unit)} · {o.fulfilment === 'delivery' ? 'Delivery' : 'Pickup'}</p>
                  <p className="mt-1 text-sm text-muted">{STATUS[o.status]}{o.decisionNote ? ` — ${o.decisionNote}` : ''}</p>
                  {o.pendingDayQty && (
                    <p className="mt-1 text-sm font-medium text-brand-deep">Change sent, waiting for the shop: {weekText(o.pendingDayQty, o.unit)}</p>
                  )}
                </div>
              </div>
              <div className="mt-3 pill-row gap-2">
                {o.status !== 'declined' && o.status !== 'ended' && (
                  <button onClick={() => setEditing(toDraft(o))} className={secondaryButton}><Pencil size={16} aria-hidden /> Change</button>
                )}
                {(o.pendingDayQty || o.status === 'requested' || o.status === 'declined' || o.status === 'ended') && (
                  <button onClick={() => act(() => withdrawRegularOrderRequest(o.id))} className={secondaryButton}>
                    <Undo2 size={16} aria-hidden /> {o.pendingDayQty ? 'Take back change' : o.status === 'requested' ? 'Cancel request' : 'Remove'}
                  </button>
                )}
                {o.status === 'active' && !o.pendingDayQty && (
                  <button onClick={() => act(() => requestRegularOrder({ id: o.id, productId: null, dayQty: [0, 0, 0, 0, 0, 0, 0], fulfilment: o.fulfilment, address: o.address ?? defaultAddress, note: '' }))} className={secondaryButton}>
                    Ask to stop
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {(upcoming.length > 0 || news.length > 0) && (
        <section className={`${cardClass} p-4`}>
          <h3 className="font-semibold">Coming days</h3>
          <ul className="mt-2 space-y-2">
            {[...new Map([...upcoming, ...news].map((d) => [`${d.orderId}:${d.day}`, d])).values()]
              .sort((a, b) => a.day.localeCompare(b.day))
              .map((d) => {
                const o = nameOf(d.orderId);
                return (
                  <li key={`${d.orderId}:${d.day}`} className="text-sm">
                    <span className="font-medium">{dayName(d.day, data.today)}:</span>{' '}
                    {o?.productName} {d.state === 'skipped' ? <span className="text-muted">— not coming</span> : `${qty(d.quantity)} ${o?.unit ?? ''}`}
                    {d.state === 'delivered' && <span className="text-muted"> — delivered</span>}
                    {d.state === 'changed' && <span className="text-muted"> — changed by the shop</span>}
                    {d.message && <span className="block text-muted">“{d.message}”</span>}
                  </li>
                );
              })}
          </ul>
        </section>
      )}
    </div>
  );
}
