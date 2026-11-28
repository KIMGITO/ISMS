// Sheets for regular orders, shared by the customer's page and the Regular Orders screen:
// set up / change an order (a quantity per weekday), mark a customer's day delivered (one sale),
// change or skip one day (with a message for the customer), and approve what a customer asked for.
import React, { useMemo, useState } from 'react';
import PaymentCodeField from '../payments/PaymentCodeField';
import { needsPaymentCode, paymentCodeProblem } from '../../utils/paymentProof';
import { Check, MessageCircle, Smartphone, Trash2, X } from 'lucide-react';
import { FormSheet, Field, fieldClass, primaryBtn, secondaryBtn, dangerBtn } from '../shared/FormSheet';
import { NumberInput } from '../shared/Input';
import { Segmented } from '../shared/Choice';
import SearchableDropdown from '../SearchableDropdown';
import { appDialog } from '../AppDialog';
import { useInventoryStore } from '../../stores/inventoryStore';
import { useNotificationStore } from '../../stores/notificationStore';
import { usePaymentMethods } from '../../hooks/usePaymentMethods';
import { ReceiptShareService } from '../../services/receipt/ReceiptShareService';
import { formatCurrency } from '../../utils/helpers';
import { newUuid } from '../../utils/idUtils';
import { toUserMessage } from '../../utils/userError';
import {
  DAY_NAMES, WEEK_ORDER, EMPTY_WEEK, dayLabel, decideRegularOrder, deliverRegularOrders, qtyText,
  removeRegularOrder, saveRegularOrder, setRegularOrderDay, weekText, weekTotal,
  type CustomerDay, type DayChangeResult, type DeliverPayment, type Fulfilment, type RegularOrder,
} from '../../services/regularOrders';
import { QTY_DECIMALS } from '../../utils/money';

const toast = (title: string, msg: string, kind: 'success' | 'error' | 'info' = 'success') =>
  useNotificationStore.getState().showToast(title, msg, undefined, kind);

// ── Week grid ───────────────────────────────────────────────────────────────────────────
const PATTERNS: { id: string; label: string; days: number[] }[] = [
  { id: 'all', label: 'Every day', days: [0, 1, 2, 3, 4, 5, 6] },
  { id: 'weekdays', label: 'Mon–Fri', days: [1, 2, 3, 4, 5] },
  { id: 'sat', label: 'Saturdays', days: [6] },
];

export function WeekEditor({ value, onChange, unit }: { value: number[]; onChange: (v: number[]) => void; unit?: string }) {
  const [fill, setFill] = useState<number | null>(null);
  const apply = (days: number[]) => {
    if (!fill) return;
    const next = EMPTY_WEEK();
    days.forEach((d) => { next[d] = fill; });
    onChange(next);
  };
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <NumberInput value={fill} onChange={setFill} min={0} decimals={QTY_DECIMALS} placeholder="Amount" className="w-28" size="sm" aria-label="Amount to fill" />
        {PATTERNS.map((p) => (
          <button key={p.id} type="button" disabled={!fill} onClick={() => apply(p.days)}
            className="px-3 py-1.5 rounded-lg text-xs font-medium ring-1 ring-app-border bg-app-bg hover:bg-app-border/40 disabled:opacity-40 cursor-pointer">
            {p.label}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1.5">
        {WEEK_ORDER.map((d) => (
          <label key={d} className="flex flex-col items-center gap-1">
            <span className="text-[11px] font-medium text-app-text-muted">{DAY_NAMES[d]}</span>
            <NumberInput
              value={value[d] || null}
              onChange={(n) => { const next = [...value]; next[d] = n ?? 0; onChange(next); }}
              min={0} decimals={QTY_DECIMALS} placeholder="0" size="sm" inputClassName="text-center px-1"
              aria-label={`${DAY_NAMES[d]} amount`}
            />
          </label>
        ))}
      </div>
      <p className="text-xs text-app-text-muted">
        {weekText(value, unit)}{weekTotal(value) > 0 ? `, ${qtyText(weekTotal(value))}${unit ? ` ${unit}` : ''} a week` : ''}
      </p>
    </div>
  );
}

// ── Set up / change an order ────────────────────────────────────────────────────────────
export function RegularOrderSheet({ businessId, customerId, customerName, defaultAddress, order, canApprove, onClose, onSaved }: {
  businessId: string;
  customerId: string;
  customerName: string;
  defaultAddress?: string;
  order?: RegularOrder | null;
  /** Owner/manager: may edit what a customer asked for (that confirms it). */
  canApprove: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const products = useInventoryStore((s) => s.products);
  const [productId, setProductId] = useState(order?.productId ?? '');
  const [dayQty, setDayQty] = useState<number[]>(order ? [...(order.pendingDayQty ?? order.dayQty)] : EMPTY_WEEK());
  const [fulfilment, setFulfilment] = useState<Fulfilment>(order?.pendingFulfilment ?? order?.fulfilment ?? 'delivery');
  const [address, setAddress] = useState(order?.pendingAddress ?? order?.address ?? defaultAddress ?? '');
  const [note, setNote] = useState(order?.pendingNote ?? order?.note ?? '');
  const [status, setStatus] = useState<'active' | 'paused'>(order?.status === 'paused' ? 'paused' : 'active');
  const [endsOn, setEndsOn] = useState(order?.endsOn ?? '');
  const [busy, setBusy] = useState(false);
  const product = products.find((p) => p.id === productId);
  const unit = order?.unit ?? product?.unit ?? '';
  const price = order?.price ?? product?.price ?? 0;
  const fromCustomer = !!order && (order.status === 'requested' || order.pendingDayQty != null);
  const locked = fromCustomer && !canApprove;

  const save = async () => {
    if (!productId) return toast('Choose a product', 'Pick what this customer gets.', 'error');
    if (status === 'active' && weekTotal(dayQty) <= 0) return toast('Enter amounts', 'Put an amount on at least one day.', 'error');
    setBusy(true);
    try {
      await saveRegularOrder(businessId, {
        id: order?.id ?? null, customerId, productId, dayQty, fulfilment, address, note,
        startsOn: null, endsOn: endsOn || null, status,
      });
      toast('Saved', fromCustomer ? 'Confirmed. The customer is told.' : `${customerName}: ${weekText(dayQty, unit)}`);
      onSaved();
      onClose();
    } catch (e) {
      toast('Not saved', toUserMessage(e, 'Could not save. Check your connection.'), 'error');
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!order) return;
    if (!(await appDialog.confirm({ title: 'Remove this regular order?', message: 'Past deliveries stay in the Sales Log.', confirmLabel: 'Remove', destructive: true }))) return;
    setBusy(true);
    try {
      await removeRegularOrder(businessId, order.id);
      toast('Removed', `${order.productName} for ${customerName}`);
      onSaved();
      onClose();
    } catch (e) {
      toast('Not removed', toUserMessage(e, 'Could not remove.'), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <FormSheet
      title={order ? `${order.productName} for ${customerName}` : `Regular order for ${customerName}`}
      subtitle={fromCustomer ? 'Asked for by the customer. Saving confirms it.' : 'How much on each day of the week'}
      onClose={onClose}
      footer={<>
        {order && !locked && <button className={`${secondaryBtn} mr-auto text-red-600`} onClick={remove} disabled={busy}><Trash2 size={15} /> Remove</button>}
        <button className={secondaryBtn} onClick={onClose}>Cancel</button>
        <button className={primaryBtn} onClick={save} disabled={busy || locked}>{fromCustomer ? 'Confirm' : 'Save'}</button>
      </>}
    >
      {locked && <p className="rounded-xl bg-amber-500/10 p-3 text-sm">The customer asked for this. The owner or a manager confirms it.</p>}
      {!order && (
        <Field label="Product">
          <SearchableDropdown
            items={products.map((p) => ({ id: p.id, label: p.name, sublabel: `${formatCurrency(p.price)}${p.unit ? ` / ${p.unit}` : ''} · ${qtyText(p.stock)} in stock` }))}
            selectedValue={productId} onChange={setProductId} placeholder="Choose a product" searchPlaceholder="Search products"
          />
        </Field>
      )}
      <Field label="Amount each day">
        <WeekEditor value={dayQty} onChange={setDayQty} unit={unit} />
      </Field>
      {price > 0 && weekTotal(dayQty) > 0 && (
        <p className="text-xs text-app-text-muted">About {formatCurrency(weekTotal(dayQty) * price)} a week at today's price.</p>
      )}
      <Segmented<Fulfilment> options={[{ id: 'delivery', label: 'We deliver' }, { id: 'pickup', label: 'They collect' }]} value={fulfilment} onChange={setFulfilment} size="sm" ariaLabel="Delivery or pickup" />
      {fulfilment === 'delivery' && (
        <Field label="Deliver to"><input className={fieldClass} value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Place, building, gate" /></Field>
      )}
      <Field label="Note (optional)"><input className={fieldClass} value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} placeholder="e.g. leave with the guard" /></Field>
      {order && !fromCustomer && (
        <div className="grid gap-3 sm:grid-cols-2">
          <Segmented<'active' | 'paused'> options={[{ id: 'active', label: 'Running' }, { id: 'paused', label: 'Paused' }]} value={status} onChange={setStatus} size="sm" ariaLabel="Running or paused" />
          <Field label="Last day (optional)"><input type="date" className={fieldClass} value={endsOn} onChange={(e) => setEndsOn(e.target.value)} /></Field>
        </div>
      )}
    </FormSheet>
  );
}

// ── Delivered ───────────────────────────────────────────────────────────────────────────
export function DeliverSheet({ businessId, day, today, entry, onClose, onDone }: {
  businessId: string; day: string; today: string; entry: CustomerDay; onClose: () => void; onDone: () => void;
}) {
  const methods = usePaymentMethods();
  const open = entry.items.filter((i) => (i.line.state === 'due' || i.line.state === 'changed') && i.line.quantity > 0);
  const [qty, setQty] = useState<Record<string, number | null>>(() => Object.fromEntries(open.map((i) => [i.order.id, i.line.quantity])));
  const [payment, setPayment] = useState<DeliverPayment>('Credit_Debt');
  const [rider, setRider] = useState('');
  const [riderPay, setRiderPay] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [paymentRef, setPaymentRef] = useState('');
  const [refTried, setRefTried] = useState(false);
  const [reference] = useState(() => `reg-${newUuid()}`);
  const delivering = open.some((i) => i.order.fulfilment === 'delivery');
  const total = open.reduce((s, i) => s + (qty[i.order.id] || 0) * i.order.price, 0);
  const wallet = open[0]?.order.walletBalance ?? 0;

  const save = async () => {
    const lines = open.map((i) => ({ orderId: i.order.id, quantity: qty[i.order.id] || 0 })).filter((l) => l.quantity > 0);
    if (lines.length === 0) return toast('Nothing to record', 'Enter what was delivered, or skip the day instead.', 'error');
    // Money first: an M-Pesa, Airtel or bank day needs the payment's code.
    const refProblem = paymentCodeProblem(payment, paymentRef);
    if (refProblem) {
      setRefTried(true);
      return toast('Record the money first', refProblem, 'error');
    }
    setBusy(true);
    try {
      await deliverRegularOrders(businessId, {
        customerId: entry.customerId, day, lines, payment, riderName: rider.trim(), riderPay: riderPay || 0, referenceId: reference, note: '',
        paymentRef: needsPaymentCode(payment) ? paymentRef : undefined,
      });
      toast('Delivered', `${entry.name}: ${formatCurrency(total)} recorded as a sale.`);
      onDone();
      onClose();
    } catch (e) {
      toast('Not recorded', toUserMessage(e, 'Could not record. Check your connection and try again.'), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <FormSheet
      title={`Delivered to ${entry.name}`}
      subtitle={`${dayLabel(day, today)} · recorded as one sale`}
      onClose={onClose}
      footer={<>
        <button className={secondaryBtn} onClick={onClose}>Cancel</button>
        <button className={primaryBtn} onClick={save} disabled={busy}><Check size={16} /> Record {formatCurrency(total)}</button>
      </>}
    >
      <ul className="divide-y divide-app-border/60 rounded-xl ring-1 ring-app-border">
        {open.map((i) => (
          <li key={i.order.id} className="flex items-center gap-3 px-3 py-2">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium truncate">{i.order.productName}</p>
              <p className="text-xs text-app-text-muted">{formatCurrency(i.order.price)}{i.order.unit ? ` / ${i.order.unit}` : ''}</p>
            </div>
            <NumberInput value={qty[i.order.id]} onChange={(n) => setQty({ ...qty, [i.order.id]: n })} min={0} decimals={QTY_DECIMALS} size="sm" className="w-24" inputClassName="text-center" aria-label={`${i.order.productName} delivered`} />
          </li>
        ))}
      </ul>
      <Field label="Paid how">
        <Segmented<DeliverPayment>
          options={[{ id: 'Credit_Debt', label: 'On account' }, ...methods.map((m) => ({ id: m as DeliverPayment, label: m === 'Airtel Money' ? 'Airtel' : m }))]}
          value={payment} onChange={setPayment} size="sm" ariaLabel="Paid how"
        />
      </Field>
      {needsPaymentCode(payment) && (
        <PaymentCodeField method={payment} amount={total} value={paymentRef} onChange={setPaymentRef} showError={refTried} />
      )}
      {payment === 'Credit_Debt' && (
        <p className="text-xs text-app-text-muted">
          {wallet > 0 ? `Their wallet (${formatCurrency(wallet)}) pays first; the rest goes on their debt.` : 'Goes on their debt, to pay later.'}
        </p>
      )}
      {delivering && (
        <div className="grid gap-3 grid-cols-2">
          <Field label="Rider (optional)"><input className={fieldClass} value={rider} onChange={(e) => setRider(e.target.value)} placeholder="Name" /></Field>
          <Field label="Rider pay (optional)"><NumberInput value={riderPay} onChange={setRiderPay} min={0} placeholder="0" /></Field>
        </div>
      )}
    </FormSheet>
  );
}

// ── Change or skip one day ──────────────────────────────────────────────────────────────
export function DaySheet({ businessId, day, today, entry, onClose, onDone }: {
  businessId: string; day: string; today: string; entry: CustomerDay; onClose: () => void; onDone: () => void;
}) {
  const items = entry.items.filter((i) => i.line.state !== 'delivered');
  const [mode, setMode] = useState<'skip' | 'change'>('skip');
  const [qty, setQty] = useState<Record<string, number | null>>(() => Object.fromEntries(items.map((i) => [i.order.id, i.line.quantity])));
  const firstName = entry.name.split(' ')[0];
  const products = items.map((i) => i.order.productName).join(' and ');
  const when = dayLabel(day, today).toLowerCase();
  const [message, setMessage] = useState(`Hello ${firstName}, sorry, we can't deliver your ${products} ${when}. We'll be back on the next day as usual.`);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<DayChangeResult | null>(null);
  const changed = items.some((i) => i.line.state === 'changed' || i.line.state === 'skipped');
  const past = day < today;

  const run = async (action: 'skip' | 'change' | 'reset') => {
    setBusy(true);
    try {
      let result: DayChangeResult | null = null;
      if (action === 'change') {
        for (const i of items) {
          const q = qty[i.order.id] ?? 0;
          if (q === i.line.quantity && i.line.state !== 'skipped') continue;
          result = await setRegularOrderDay(businessId, [i.order.id], day, 'change', q, message.trim() && q !== i.line.planned ? message : '');
        }
      } else {
        result = await setRegularOrderDay(businessId, items.map((i) => i.order.id), day, action, null, action === 'skip' ? message : '');
      }
      onDone();
      if (result?.text && !result.inApp) setSent(result);
      else {
        toast('Saved', result?.inApp ? `${entry.name} sees the message in their account.` : action === 'reset' ? 'Back to the usual amount.' : 'Saved.');
        onClose();
      }
    } catch (e) {
      toast('Not saved', toUserMessage(e, 'Could not save. Check your connection.'), 'error');
    } finally {
      setBusy(false);
    }
  };

  if (sent) {
    return (
      <FormSheet title={`Tell ${entry.name}`} subtitle="Saved. They have no app account, so send the message yourself." onClose={onClose}
        footer={<button className={primaryBtn} onClick={onClose}>Done</button>}>
        <div className="rounded-xl bg-app-bg p-3 text-[13px] whitespace-pre-wrap break-words">{sent.text}</div>
        <div className="flex flex-wrap gap-2">
          <button className={secondaryBtn} onClick={() => void ReceiptShareService.shareTextViaWhatsApp(sent.phone || '', sent.text || '')}><MessageCircle size={15} /> WhatsApp</button>
          <button className={secondaryBtn} onClick={() => void ReceiptShareService.openExternalUrl(`sms:${sent.phone || ''}?body=${encodeURIComponent(sent.text || '')}`)}><Smartphone size={15} /> SMS</button>
        </div>
      </FormSheet>
    );
  }

  return (
    <FormSheet
      title={`${entry.name} · ${dayLabel(day, today)}`}
      subtitle="This day only. The usual week stays the same."
      onClose={onClose}
      footer={<>
        {changed && <button className={`${secondaryBtn} mr-auto`} onClick={() => run('reset')} disabled={busy}>Back to usual</button>}
        <button className={secondaryBtn} onClick={onClose}>Cancel</button>
        {mode === 'skip'
          ? <button className={dangerBtn} onClick={() => run('skip')} disabled={busy}><X size={15} /> Skip this day</button>
          : <button className={primaryBtn} onClick={() => run('change')} disabled={busy}>Save</button>}
      </>}
    >
      {!past && <Segmented<'skip' | 'change'> options={[{ id: 'skip', label: "Can't deliver" }, { id: 'change', label: 'Different amount' }]} value={mode} onChange={setMode} size="sm" ariaLabel="Skip or change" />}
      {mode === 'change' && (
        <ul className="divide-y divide-app-border/60 rounded-xl ring-1 ring-app-border">
          {items.map((i) => (
            <li key={i.order.id} className="flex items-center gap-3 px-3 py-2">
              <p className="min-w-0 flex-1 text-sm truncate">{i.order.productName} <span className="text-xs text-app-text-muted">(usually {qtyText(i.line.planned)})</span></p>
              <NumberInput value={qty[i.order.id]} onChange={(n) => setQty({ ...qty, [i.order.id]: n })} min={0} decimals={QTY_DECIMALS} size="sm" className="w-24" inputClassName="text-center" aria-label={`${i.order.productName} amount`} />
            </li>
          ))}
        </ul>
      )}
      <Field label={mode === 'skip' ? 'Message to the customer' : 'Message to the customer (optional)'} hint="Goes to their account if they have one; otherwise you can send it by WhatsApp or SMS.">
        <textarea className={`${fieldClass} min-h-[5rem]`} value={message} onChange={(e) => setMessage(e.target.value)} maxLength={1000} />
      </Field>
    </FormSheet>
  );
}

// ── Approve what a customer asked for ───────────────────────────────────────────────────
export function DecisionSheet({ businessId, order, onClose, onDone }: {
  businessId: string; order: RegularOrder; onClose: () => void; onDone: () => void;
}) {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const isNew = order.status === 'requested';
  const asked = order.pendingDayQty ?? order.dayQty;
  const stop = !isNew && weekTotal(asked) === 0;

  const decide = async (approve: boolean) => {
    setBusy(true);
    try {
      await decideRegularOrder(businessId, order.id, approve, note);
      toast(approve ? 'Approved' : 'Declined', `${order.customerName} is told.`);
      onDone();
      onClose();
    } catch (e) {
      toast('Not saved', toUserMessage(e, 'Could not save. Check your connection.'), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <FormSheet
      title={`${order.customerName}: ${order.productName}`}
      subtitle={isNew ? 'New regular order' : stop ? 'Wants to stop' : 'Wants to change'}
      onClose={onClose}
      footer={<>
        <button className={secondaryBtn} onClick={() => decide(false)} disabled={busy}>Decline</button>
        <button className={primaryBtn} onClick={() => decide(true)} disabled={busy}><Check size={16} /> Approve</button>
      </>}
    >
      {!isNew && <p className="text-sm"><span className="text-app-text-muted">Now:</span> {weekText(order.dayQty, order.unit)}</p>}
      <p className="text-sm font-medium"><span className="text-app-text-muted font-normal">{isNew ? 'Asks for:' : 'Asks for:'}</span> {stop ? 'Stop' : weekText(asked, order.unit)}</p>
      {!stop && <p className="text-xs text-app-text-muted">About {formatCurrency(weekTotal(asked) * order.price)} a week.</p>}
      {(order.pendingFulfilment ?? order.fulfilment) === 'delivery'
        ? <p className="text-sm"><span className="text-app-text-muted">Deliver to:</span> {order.pendingAddress ?? order.address ?? '—'}</p>
        : <p className="text-sm">They collect.</p>}
      {(order.pendingNote ?? order.note) && <p className="text-sm"><span className="text-app-text-muted">Note:</span> {order.pendingNote ?? order.note}</p>}
      <Field label="Note to the customer (optional)"><input className={fieldClass} value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} /></Field>
    </FormSheet>
  );
}

/** Where to deliver, from the customer's saved location. */
export function deliveryPlace(c?: { deliveryAddress?: string; deliveryBuilding?: string; deliveryLandmark?: string } | null): string {
  return [c?.deliveryAddress, c?.deliveryBuilding, c?.deliveryLandmark].map((p) => (p || '').trim()).filter(Boolean).join(', ');
}

/** Orders a customer asked for that wait for a decision, newest first. */
export function useWaiting(orders: RegularOrder[]) {
  return useMemo(() => orders.filter((o) => o.status === 'requested' || o.pendingDayQty != null)
    .sort((a, b) => (b.pendingSince ?? b.updatedAt).localeCompare(a.pendingSince ?? a.updatedAt)), [orders]);
}
