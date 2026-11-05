import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, CheckCircle2, RotateCcw, Smartphone } from 'lucide-react';
import { cancelOrder, checkPayment, fetchOrder, fetchOrders, friendlyError, Order, startPayment } from '../api';
import { navigate } from '../router';
import { useAuth, useCart, useStorefront } from '../store';
import { cardClass, ErrorText, fieldClass, formatDateTime, formatPrice, formatQuantity, Loading, primaryButton, secondaryButton, StatusBadge } from '../ui';

const PAYABLE = ['pending_payment', 'payment_failed'];
const PAYMENT_WAIT_MS = 120_000;

function PaymentPanel({ order, onChange }: { order: Order; onChange: () => Promise<void> }) {
  const account = useAuth((s) => s.account)!;
  const { currency } = useStorefront().business;
  const [phone, setPhone] = useState(account.phone);
  const [waiting, setWaiting] = useState(false);
  const [timedOut, setTimedOut] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const startedAt = useRef(0);

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
          if (status === 'payment_failed') setError("The payment wasn't completed. You can try again.");
          await onChange();
        }
      } catch {
        // A failed check shouldn't stop the wait; the next tick tries again.
      }
    }, 4000);
    return () => clearInterval(timer);
  }, [waiting, order.id, onChange]);

  const handlePay = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    setTimedOut(false);
    try {
      await startPayment(order.id, phone);
      startedAt.current = Date.now();
      setWaiting(true);
    } catch (err) {
      setError(friendlyError(err, "We couldn't start the payment. Please try again."));
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

  if (waiting) {
    return (
      <div role="status" className="rounded-xl bg-amber-50 p-6 text-center">
        <Smartphone size={36} className="mx-auto animate-pulse text-brand-deep" aria-hidden />
        <p className="mt-3 text-xl font-semibold">Check your phone</p>
        <p className="mt-1 text-muted">Enter your M-Pesa PIN to pay {formatPrice(currency, order.total)}. This page will update by itself.</p>
      </div>
    );
  }

  return (
    <form onSubmit={handlePay} className="space-y-4 rounded-xl bg-amber-50 p-5">
      {timedOut && (
        <p role="status" className="rounded-lg bg-white px-3.5 py-2.5">
          We haven't received confirmation yet. If you already paid, please wait a few minutes and refresh this page before paying again.
        </p>
      )}
      <label className="block font-medium">
        M-Pesa phone number
        <input required type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} className={fieldClass} />
      </label>
      <ErrorText>{error}</ErrorText>
      <div className="flex flex-col gap-2 sm:flex-row">
        <button type="submit" disabled={busy} className={`${primaryButton} sm:flex-1`}>
          {busy ? 'Please wait…' : `Pay ${formatPrice(currency, order.total)} with M-Pesa`}
        </button>
        <button type="button" disabled={busy} onClick={handleCancel} className={secondaryButton}>Cancel order</button>
      </div>
    </form>
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
        <h2 className="text-2xl font-bold">Order #{order.order_number}</h2>
        <StatusBadge status={order.status} />
      </div>
      <p className="mt-1 text-muted">{formatDateTime(order.created_at)}</p>

      {order.status === 'paid' && (
        <p role="status" className="mt-4 flex items-center gap-2 rounded-lg bg-emerald-50 px-3.5 py-3 font-medium text-emerald-900">
          <CheckCircle2 size={20} className="shrink-0" aria-hidden /> Thank you! We received your payment.
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
        {order.discount > 0 && (
          <div className="flex justify-between"><dt className="text-muted">Rounded down</dt><dd>-{formatPrice(currency, order.discount)}</dd></div>
        )}
        <div className="flex justify-between text-xl font-bold"><dt>Total</dt><dd>{formatPrice(currency, order.total)}</dd></div>
        {order.mpesa_receipt && (
          <div className="flex justify-between gap-3"><dt className="text-muted">M-Pesa receipt</dt><dd className="break-all">{order.mpesa_receipt}</dd></div>
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
              <span className="text-base font-bold text-ink">{formatPrice(currency, order.total)}</span>
            </div>
          </a>
        </li>
      ))}
    </ul>
  );
}
