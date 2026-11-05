import { FormEvent, useEffect, useState } from 'react';
import { CalendarClock, Pause, Pencil, Play, Plus, Trash2 } from 'lucide-react';
import { deleteSchedule, fetchSchedules, friendlyError, saveSchedule, Schedule } from '../api';
import { useAuth, useStorefront } from '../store';
import { cardClass, ErrorText, fieldClass, formatDate, formatQuantity, Loading, primaryButton, secondaryButton } from '../ui';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

interface Draft {
  id: string | null;
  quantities: Record<string, string>;
  days: number[];
  fulfilment: 'delivery' | 'pickup';
  address: string;
  notes: string;
  active: boolean;
}

function ScheduleForm({ initial, onDone }: { initial: Draft; onDone: () => void }) {
  const { products, settings } = useStorefront();
  const [draft, setDraft] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const items = Object.entries(draft.quantities)
      .map(([productId, quantity]) => ({ productId, quantity: Number(quantity) }))
      .filter((item) => item.quantity > 0);
    if (items.length === 0) {
      setError('Please enter an amount for at least one product.');
      return;
    }
    if (draft.days.length === 0) {
      setError('Please choose at least one day.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await saveSchedule({
        id: draft.id,
        items,
        days_of_week: draft.days,
        fulfilment: draft.fulfilment,
        delivery_address: draft.address,
        notes: draft.notes,
        active: draft.active,
      });
      onDone();
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className={`${cardClass} space-y-5 p-5`}>
      <fieldset>
        <legend className="font-semibold">What would you like?</legend>
        <ul className="mt-2 divide-y divide-line">
          {products.map((product) => (
            <li key={product.id} className="flex items-center justify-between gap-3 py-2">
              <label htmlFor={`qty-${product.id}`} className="min-w-0 flex-1 font-medium">
                {product.name} <span className="block text-sm font-normal text-muted">{product.unit}</span>
              </label>
              <input
                id={`qty-${product.id}`}
                type="number"
                inputMode="decimal"
                min="0"
                max="1000"
                step="0.5"
                placeholder="0"
                value={draft.quantities[product.id] ?? ''}
                onChange={(e) => setDraft({ ...draft, quantities: { ...draft.quantities, [product.id]: e.target.value } })}
                className="h-11 w-20 shrink-0 rounded-lg border border-line px-2 text-center text-base"
              />
            </li>
          ))}
        </ul>
      </fieldset>

      <fieldset>
        <legend className="font-semibold">Which days?</legend>
        <div className="mt-2 grid grid-cols-7 gap-1 sm:flex sm:gap-2">
          {DAYS.map((day, index) => {
            const selected = draft.days.includes(index);
            return (
              <button
                key={day}
                type="button"
                aria-pressed={selected}
                onClick={() =>
                  setDraft({ ...draft, days: selected ? draft.days.filter((d) => d !== index) : [...draft.days, index] })
                }
                className={`min-h-11 rounded-lg border text-sm font-medium sm:px-3.5 sm:text-base ${
                  selected ? 'border-brand bg-brand text-on-brand' : 'border-line'
                }`}
              >
                {day}
              </button>
            );
          })}
        </div>
      </fieldset>

      <label className="block font-semibold">
        How will you receive it?
        <select
          value={draft.fulfilment}
          onChange={(e) => setDraft({ ...draft, fulfilment: e.target.value as Draft['fulfilment'] })}
          className={fieldClass}
        >
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

      <ErrorText>{error}</ErrorText>
      <div className="flex flex-col gap-2 sm:flex-row">
        <button type="submit" disabled={busy} className={primaryButton}>{busy ? 'Saving…' : 'Save schedule'}</button>
        <button type="button" onClick={onDone} className={secondaryButton}>Cancel</button>
      </div>
    </form>
  );
}

export default function SchedulesTab() {
  const { products, settings } = useStorefront();
  const account = useAuth((s) => s.account)!;
  const [schedules, setSchedules] = useState<Schedule[] | null>(null);
  const [editing, setEditing] = useState<Draft | null>(null);
  const [error, setError] = useState('');

  const load = () => fetchSchedules().then(setSchedules).catch((err) => setError(friendlyError(err)));

  useEffect(() => {
    load();
  }, []);

  const toDraft = (schedule: Schedule): Draft => ({
    id: schedule.id,
    quantities: Object.fromEntries(schedule.items.map((i) => [i.productId, String(i.quantity)])),
    days: schedule.days_of_week,
    fulfilment: schedule.fulfilment,
    address: schedule.delivery_address ?? '',
    notes: schedule.notes ?? '',
    active: schedule.active,
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

  if (!schedules) return error ? <ErrorText>{error}</ErrorText> : <Loading />;

  if (editing) {
    return (
      <div className="max-w-2xl">
        <ScheduleForm
          initial={editing}
          onDone={() => {
            setEditing(null);
            load();
          }}
        />
      </div>
    );
  }

  const label = (schedule: Schedule) =>
    schedule.items
      .map((item) => {
        const product = products.find((p) => p.id === item.productId);
        return product ? `${formatQuantity(item.quantity, product.unit)} ${product.name}` : 'A product that is no longer sold';
      })
      .join(', ');

  return (
    <div className="max-w-2xl space-y-4">
      <p className="text-muted">
        On each day you choose, we'll prepare your order and message you. Pay it from your Orders page to confirm it, since M-Pesa needs your PIN each time.
      </p>
      <ErrorText>{error}</ErrorText>
      <button
        onClick={() =>
          setEditing({
            id: null,
            quantities: {},
            days: [],
            fulfilment: settings.deliveryEnabled ? 'delivery' : 'pickup',
            address: account.delivery_address ?? '',
            notes: '',
            active: true,
          })
        }
        className={`${primaryButton} w-full sm:w-auto`}
      >
        <Plus size={18} aria-hidden /> New schedule
      </button>

      {schedules.length === 0 ? (
        <p className="rounded-xl border border-dashed border-line p-8 text-center text-muted">You don't have any schedules yet.</p>
      ) : (
        <ul className="space-y-3">
          {schedules.map((schedule) => (
            <li key={schedule.id} className={`${cardClass} p-4`}>
              <div className="flex items-start gap-3">
                <CalendarClock className="mt-0.5 shrink-0 text-brand-deep" aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">{label(schedule)}</p>
                  <p className="mt-1 text-muted">
                    {[...schedule.days_of_week].sort().map((d) => DAYS[d]).join(', ')} · {schedule.fulfilment === 'delivery' ? 'Delivery' : 'Pickup'}
                  </p>
                  <p className="mt-1 text-sm text-muted">
                    {schedule.active ? `Next order: ${formatDate(schedule.next_run_date)}` : 'Paused'}
                  </p>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <button onClick={() => setEditing(toDraft(schedule))} className={secondaryButton}>
                  <Pencil size={16} aria-hidden /> Edit
                </button>
                <button
                  onClick={() =>
                    act(() =>
                      saveSchedule({
                        id: schedule.id,
                        items: schedule.items,
                        days_of_week: schedule.days_of_week,
                        fulfilment: schedule.fulfilment,
                        delivery_address: schedule.delivery_address,
                        notes: schedule.notes,
                        active: !schedule.active,
                      }),
                    )
                  }
                  className={secondaryButton}
                >
                  {schedule.active ? <Pause size={16} aria-hidden /> : <Play size={16} aria-hidden />}
                  {schedule.active ? 'Pause' : 'Resume'}
                </button>
                <button onClick={() => act(() => deleteSchedule(schedule.id))} className={secondaryButton}>
                  <Trash2 size={16} aria-hidden /> Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
