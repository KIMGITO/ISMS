import React, { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, CheckCircle2, CreditCard, RotateCcw, Smartphone } from 'lucide-react';
import { acceptsAirtel, acceptsCards, cancelOrder, checkCardPayment, checkPayment, fetchOrder, fetchOrders, friendlyError, Order, startCardPayment, startPayment } from '../api';
import { navigate } from '../router';
import { networkOf } from '../../../supabase/functions/airtel-payments/phone';
import { CheckoutSteps } from './CartPage';
import { useAuth, useCart, useStorefront } from '../store';
import { cardClass, ErrorText, fieldClass, formatDateTime, formatPrice, formatQuantity, Loading, primaryButton, secondaryButton, StatusBadge } from '../ui';

const PAYABLE = ['pending_payment', 'payment_failed'];

type Method = 'mpesa' | 'airtel' | 'card';
const METHOD_NAMES: Record<Method, string> = { mpesa: 'M-Pesa', airtel: 'Airtel Money', card: 'card' };
const PAYMENT_WAIT_MS = 120_000;

/** Paystack sends the customer back with ?reference=… (and trxref). */
function cardReturnReference(): string | null {
  if (typeof window === 'undefined') return null;
  const params = new URLSearchParams(window.location.search);
  return params.get('reference') || params.get('trxref');
}

function PaymentPanel({ order, onChange }: { order: Order; onChange: () => Promise<void> }) {
  const account = useAuth((s) => s.account)!;
  const { currency } = useStorefront().business;
  const [method, setMethod] = useState<Method>('mpesa');
  const [cardsOn, setCardsOn] = useState(false);
  const [airtelOn, setAirtelOn] = useState(false);
  const [phone, setPhone] = useState(account.phone);
  const [waiting, setWaiting] = useState(false);
  const [confirmingCard, setConfirmingCard] = useState<string | null>(() => cardReturnReference());
  const [timedOut, setTimedOut] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const startedAt = useRef(0);

  useEffect(() => {
    acceptsCards().then(setCardsOn);
    acceptsAirtel().then((on) => {
      setAirtelOn(on);
      // An Airtel line on the account starts on Airtel Money.
      if (on && networkOf(account.phone) === 'airtel') setMethod('airtel');
    });
  }, [account.phone]);

  useEffect(() => {
    if (!waiting) return;
    const timer = setInterval(async () => {
      if (Date.now() - startedAt.current > PAYMENT_WAIT_MS) {
        setWaiting(false);
        setTimedOut(true);
        return;
      }
      try {
        const { status } = await checkPayment(order.id);
        if (status !== 'pending_payment') {
          setWaiting(false);
          if (status === 'payment_failed') {
            setError(`The ${METHOD_NAMES[method]} payment wasn't completed (cancelled, wrong PIN, not enough money or no answer). You can try again.`);
          }
          if (status === 'paid' || status === 'preparing') {
            navigate(`/order-confirmed/${order.id}`);
            return;
          }
          await onChange();
        }
      } catch {
        // A failed check shouldn't stop the wait; the next tick tries again.
      }
    }, 4000);
    return () => clearInterval(timer);
  }, [waiting, order.id, onChange, method]);

  // Back from Paystack: ask until the payment is confirmed (the webhook usually beats us).
  useEffect(() => {
    if (!confirmingCard) return;
    const began = Date.now();
    let stopped = false;
    const finish = (message?: string) => {
      stopped = true;
      setConfirmingCard(null);
      window.history.replaceState(null, '', window.location.pathname);
      if (message) setError(message);
    };
    const tick = async () => {
      if (stopped) return;
      try {
        const { status } = await checkCardPayment(order.id, confirmingCard);
        if (status === 'paid' || status === 'preparing') {
          finish();
          navigate(`/order-confirmed/${order.id}`);
          return;
        }
        if (status === 'payment_failed') {
          finish("The card payment didn't go through. You can try again, or pay with M-Pesa.");
          await onChange();
          return;
        }
      } catch {
        // Keep asking.
      }
      if (Date.now() - began > 60_000) {
        finish("We haven't had confirmation from the card company yet. If you paid, please refresh this page in a few minutes before paying again.");
        return;
      }
      setTimeout(tick, 3000);
    };
    void tick();
    return () => { stopped = true; };
  }, [confirmingCard, order.id, onChange]);

  const handlePay = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    setTimedOut(false);
    try {
      if (method === 'card') {
        const { authorizationUrl } = await startCardPayment(order.id, `${window.location.origin}/account/orders/${order.id}`);
        window.location.assign(authorizationUrl);
        return;
      }
      await startPayment(order.id, phone, method);
      startedAt.current = Date.now();
      setWaiting(true);
    } catch (err) {
      setError(friendlyError(err, `We couldn't start the ${METHOD_NAMES[method]} payment. Please try again.`));
    } finally {
      setBusy(false);
    }
  };

  const handleCancel = async () => {
    setBusy(true);
    try {
      await cancelOrder(order.id);
      await onChange();
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  };

  if (confirmingCard) {
    return (
      <div role="status" className="rounded-xl bg-amber-50 p-6 text-center">
        <CreditCard size={36} className="mx-auto animate-pulse text-brand-deep" aria-hidden />
        <p className="mt-3 text-xl font-semibold">Confirming your card payment</p>
        <p className="mt-1 text-muted">This takes a few seconds. Please don't pay again.</p>
      </div>
    );
  }

  if (waiting) {
    return (
      <div role="status" className="rounded-xl bg-amber-50 p-6 text-center">
        <Smartphone size={36} className="mx-auto animate-pulse text-brand-deep" aria-hidden />
        <p className="mt-3 text-xl font-semibold">Check your phone</p>
        <p className="mt-1 text-muted">
          Enter your {method === 'airtel' ? 'Airtel Money' : 'M-Pesa'} PIN on {phone} to pay {formatPrice(currency, order.total)}. This page will update by itself.
        </p>
      </div>
    );
  }

  const choice = (value: Method, label: string, icon: React.ReactNode) => (
    <label className={`flex min-h-12 flex-1 cursor-pointer items-center gap-2 rounded-lg border px-3.5 py-2.5 font-medium ${method === value ? 'border-brand-deep bg-white ring-2 ring-brand-deep/30' : 'border-line bg-white/60'}`}>
      <input type="radio" name="pay-method" value={value} checked={method === value} onChange={() => setMethod(value)} className="sr-only" />
      {icon}{label}
    </label>
  );

  // Numbers can be ported, so this is advice only, never a block.
  const network = networkOf(phone);
  const networkHint =
    method === 'mpesa' && network === 'airtel'
      ? `This looks like an Airtel number.${airtelOn ? ' Choose Airtel Money above to pay from it.' : ' M-Pesa prompts only reach Safaricom lines.'}`
      : method === 'airtel' && network === 'safaricom'
        ? 'This looks like a Safaricom number. Choose M-Pesa above to pay from it.'
        : '';

  return (
    <form onSubmit={handlePay} className="space-y-4 rounded-xl bg-amber-50 p-5">
      <CheckoutSteps step={3} />
      {timedOut && (
        <p role="status" className="rounded-lg bg-white px-3.5 py-2.5">
          Not confirmed yet. If you paid, wait a few minutes before paying again.
        </p>
      )}
      {(cardsOn || airtelOn) && (
        <fieldset>
          <legend className="mb-2 font-medium">How would you like to pay?</legend>
          <div className="flex flex-col gap-2 sm:flex-row">
            {choice('mpesa', 'M-Pesa', <Smartphone size={18} aria-hidden />)}
            {airtelOn && choice('airtel', 'Airtel Money', <Smartphone size={18} aria-hidden />)}
            {cardsOn && choice('card', 'Card (Visa, Mastercard)', <CreditCard size={18} aria-hidden />)}
          </div>
        </fieldset>
      )}
      {method !== 'card' ? (
        <label className="block font-medium">
          {method === 'airtel' ? 'Airtel Money' : 'M-Pesa'} phone number
          <input required type="tel" autoComplete="tel" placeholder={method === 'airtel' ? '0733 123 456' : '0712 345 678'} value={phone} onChange={(e) => setPhone(e.target.value)} className={fieldClass} />
          {networkHint && <span className="mt-1.5 block text-sm font-normal text-amber-900">{networkHint}</span>}
        </label>
      ) : (
        <p className="rounded-lg bg-white px-3.5 py-2.5 text-sm">
          You enter your card on Paystack's secure page, then come back here.
        </p>
      )}
      <ErrorText>{error}</ErrorText>
      <div className="flex flex-col gap-2 sm:flex-row">
        <button type="submit" disabled={busy} className={`${primaryButton} sm:flex-1`}>
          {busy ? 'Please wait…' : `Pay ${formatPrice(currency, order.total)} ${method === 'card' ? 'by card' : `with ${METHOD_NAMES[method]}`}`}
        </button>
        <button type="button" disabled={busy} onClick={handleCancel} className={secondaryButton}>Cancel order</button>
      </div>
      <p className="text-sm text-muted">
        {method === 'mpesa' ? 'A Safaricom prompt will appear on this phone. ' : method === 'airtel' ? 'An Airtel Money prompt will appear on this phone. ' : ''}<a href="/payments" className="underline hover:text-ink">How payment works</a>
      </p>
    </form>
  );
}

/** Points, promo code and the rounding to whole shillings, each on its own line. */
export function OrderDiscounts({ order, currency }: { order: Order; currency: string }) {
  const points = Number(order.points_value ?? 0);
  const promo = Number(order.promo_value ?? 0);
  const rounding = Number(order.discount) - points - promo;
  return (
    <>
      {promo > 0 && <div className="flex justify-between"><dt className="text-muted">Promo {order.promo_code}</dt><dd>-{formatPrice(currency, promo)}</dd></div>}
      {points > 0 && <div className="flex justify-between"><dt className="text-muted">Points</dt><dd>-{formatPrice(currency, points)}</dd></div>}
      {rounding > 0.004 && <div className="flex justify-between"><dt className="text-muted">Rounded down</dt><dd>-{formatPrice(currency, rounding)}</dd></div>}
    </>
  );
}

function OrderDetail({ orderId }: { orderId: string }) {
  const { currency } = useStorefront().business;
  const add = useCart((s) => s.add);
  const [order, setOrder] = useState<Order | null | undefined>(undefined);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      setOrder(await fetchOrder(orderId));
    } catch (err) {
      setError(friendlyError(err));
    }
  }, [orderId]);

  useEffect(() => {
    load();
  }, [load]);

  if (error) return <ErrorText>{error}</ErrorText>;
  if (order === undefined) return <Loading />;
  if (order === null) return <p className="text-muted">We can't find that order.</p>;

  return (
    <div className="max-w-2xl">
      <a href="/account/orders" className="inline-flex min-h-11 items-center gap-2 font-medium text-brand-deep">
        <ArrowLeft size={18} aria-hidden /> All orders
      </a>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-2xl font-semibold">Order #{order.order_number}</h2>
        <StatusBadge status={order.status} />
      </div>
      <p className="mt-1 text-muted">{formatDateTime(order.created_at)}</p>

      {order.status === 'paid' && (
        <p role="status" className="mt-4 flex flex-wrap items-center gap-2 rounded-lg bg-emerald-50 px-3.5 py-3 font-medium text-emerald-900">
          <CheckCircle2 size={20} className="shrink-0" aria-hidden /> Thank you! We received your payment.
          <a href={`/order-confirmed/${order.id}`} className="underline">See confirmation</a>
        </p>
      )}
      {order.status === 'completed' && (
        <p className="mt-4 rounded-lg bg-sand px-3.5 py-3">
          Enjoyed your order? <a href="/reviews" className="font-medium underline">Leave a review</a> to help other customers.
        </p>
      )}

      <ul className="mt-5 divide-y divide-line rounded-xl border border-line bg-white">
        {order.online_order_items.map((item) => (
          <li key={item.id} className="flex justify-between gap-3 p-4">
            <span className="min-w-0">
              <span className="font-medium">{item.product_name}</span>
              <span className="block text-sm text-muted">{formatQuantity(item.quantity, item.unit)}</span>
            </span>
            <span className="shrink-0 font-medium">{formatPrice(currency, item.line_total)}</span>
          </li>
        ))}
      </ul>

      <dl className="mt-4 space-y-1.5">
        {order.delivery_fee > 0 && (
          <div className="flex justify-between"><dt className="text-muted">Delivery</dt><dd>{formatPrice(currency, order.delivery_fee)}</dd></div>
        )}
        <OrderDiscounts order={order} currency={currency} />
        <div className="flex justify-between text-xl font-semibold"><dt>Total</dt><dd>{formatPrice(currency, order.total)}</dd></div>
        {order.mpesa_receipt && (
          <div className="flex justify-between gap-3"><dt className="text-muted">M-Pesa receipt</dt><dd className="break-all">{order.mpesa_receipt}</dd></div>
        )}
        {order.payment_method === 'Card' && order.payment_reference && (
          <div className="flex justify-between gap-3"><dt className="text-muted">Paid by card</dt><dd className="break-all">{order.payment_reference}</dd></div>
        )}
      </dl>

      <p className="mt-4 text-muted">
        {order.fulfilment === 'delivery' ? `Delivery to ${order.delivery_address}` : 'Pickup from our shop'}
      </p>

      <div className="mt-5">
        {PAYABLE.includes(order.status) ? (
          <PaymentPanel order={order} onChange={load} />
        ) : (
          <button
            onClick={() => {
              order.online_order_items.forEach((item) => add(item.product_id, Number(item.quantity)));
              navigate('/cart');
            }}
            className={`${secondaryButton} w-full sm:w-auto`}
          >
            <RotateCcw size={18} aria-hidden /> Order again
          </button>
        )}
      </div>
    </div>
  );
}

export default function OrdersTab({ orderId }: { orderId?: string }) {
  const { currency } = useStorefront().business;
  const [orders, setOrders] = useState<Order[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (orderId) return;
    fetchOrders().then(setOrders).catch((err) => setError(friendlyError(err)));
  }, [orderId]);

  if (orderId) return <OrderDetail orderId={orderId} />;
  if (error) return <ErrorText>{error}</ErrorText>;
  if (!orders) return <Loading />;
  if (orders.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-line p-10 text-center">
        <p className="text-muted">You haven't placed an order yet.</p>
        <a href="/shop" className={`${primaryButton} mt-4`}>Go to the shop</a>
      </div>
    );
  }

  return (
    <ul className="space-y-3">
      {orders.map((order) => (
        <li key={order.id}>
          <a href={`/account/orders/${order.id}`} className={`${cardClass} block p-4 transition hover:border-brand-deep`}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-lg font-semibold">Order #{order.order_number}</span>
              <StatusBadge status={order.status} />
            </div>
            <p className="mt-1 text-muted">
              {order.online_order_items.map((i) => i.product_name).join(', ')}
            </p>
            <div className="mt-2 flex flex-wrap justify-between gap-2 text-sm text-muted">
              <span>{formatDateTime(order.created_at)}</span>
              <span className="text-base font-semibold text-ink">{formatPrice(currency, order.total)}</span>
            </div>
          </a>
        </li>
      ))}
    </ul>
  );
}
