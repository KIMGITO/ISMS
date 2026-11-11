import { FormEvent, useEffect, useState } from 'react';
import { CalendarClock, CheckCircle2, MessageCircle, Truck } from 'lucide-react';
import { fetchOrder } from '../api';
import { formatQuantity } from '../ui';
import { CheckoutSteps } from './CartPage';
import { OrderDiscounts } from './OrdersTab';
import { Heart, PackageSearch, Search } from 'lucide-react';
import { fetchOrders, Order } from '../api';
import { INFO_PAGES } from '../infoPages';
import { navigate } from '../router';
import { productPaths } from '../seo';
import { useAuth, useSaved, useStorefront } from '../store';
import { formatDate, formatPrice, Loading, PageHeader, pageClass, primaryButton, secondaryButton, StatusBadge } from '../ui';
import Breadcrumbs from './Breadcrumbs';
import ProductCard from './ProductCard';

export function SavedPage() {
  const { products } = useStorefront();
  const ids = useSaved((s) => s.ids);
  const saved = ids.map((id) => products.find((p) => p.id === id)).filter((p) => p !== undefined);

  return (
    <>
      <PageHeader eyebrow="Your list" title="Saved Items" body="Products you've saved on this device, ready when you are.">
        <Breadcrumbs items={[{ label: 'Home', href: '/' }, { label: 'Saved items' }]} />
      </PageHeader>
      <div className={pageClass}>
        {saved.length > 0 ? (
          <ul className="grid grid-cols-2 gap-3 sm:gap-5 md:grid-cols-3 lg:grid-cols-4">
            {saved.map((product) => <ProductCard key={product.id} product={product} />)}
          </ul>
        ) : (
          <div className="mx-auto max-w-md py-10 text-center">
            <span className="mx-auto grid size-16 place-items-center rounded-full bg-sand"><Heart size={28} strokeWidth={1.5} aria-hidden /></span>
            <h2 className="display-md mt-4">Nothing saved yet</h2>
            <p className="mt-2 text-muted">Tap the heart on any product to keep it here.</p>
            <a href="/shop" className={`${primaryButton} mt-6`}>Browse the shop</a>
          </div>
        )}
      </div>
    </>
  );
}

const ACTIVE = ['pending_payment', 'payment_failed', 'paid', 'preparing', 'out_for_delivery', 'ready_for_pickup'];

/** Order tracking. Orders belong to accounts, so tracking needs sign-in; there is no public lookup that could leak orders. */
export function TrackPage() {
  const { business } = useStorefront();
  const ready = useAuth((s) => s.ready);
  const account = useAuth((s) => s.account);
  const [orders, setOrders] = useState<Order[] | null>(null);
  const [number, setNumber] = useState('');
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (account) fetchOrders().then(setOrders).catch(() => setOrders([]));
  }, [account]);

  const find = (e: FormEvent) => {
    e.preventDefault();
    const match = orders?.find((o) => String(o.order_number) === number.replace(/\D/g, ''));
    if (match) navigate(`/account/orders/${match.id}`);
    else setNotFound(true);
  };

  const active = orders?.filter((o) => ACTIVE.includes(o.status)) ?? [];

  return (
    <>
      <PageHeader eyebrow="Customer care" title="Track Your Order" body="See where your order is, from payment to your door.">
        <Breadcrumbs items={[{ label: 'Home', href: '/' }, { label: 'Track an order' }]} />
      </PageHeader>
      <div className={`${pageClass} max-w-3xl`}>
        {!ready ? (
          <Loading />
        ) : !account ? (
          <div className="card p-6 text-center sm:p-10">
            <PackageSearch size={40} strokeWidth={1.5} className="mx-auto text-ember" aria-hidden />
            <h2 className="display-md mt-4">Sign in to track your orders</h2>
            <p className="mx-auto mt-2 max-w-md text-muted">Your orders are kept safely in your account. Sign in with the email you ordered with to see every order and its status.</p>
            <div className="mt-6 flex flex-wrap justify-center gap-3">
              <a href="/account" className={primaryButton}>Sign in</a>
              <a href="/help#how-do-i-track-my-order" className={secondaryButton}>How tracking works</a>
            </div>
          </div>
        ) : (
          <div className="space-y-8">
            <form onSubmit={find} className="card flex flex-col gap-3 p-5 sm:flex-row sm:items-end">
              <label className="block flex-1 font-medium">
                Order number
                <input
                  inputMode="numeric"
                  value={number}
                  onChange={(e) => { setNumber(e.target.value); setNotFound(false); }}
                  placeholder="For example 1024"
                  className="field"
                />
              </label>
              <button type="submit" className={`${primaryButton} sm:mb-0`}><Search size={17} aria-hidden /> Find order</button>
            </form>
            {notFound && <p role="alert" className="-mt-5 font-medium text-red-800">We couldn't find that order number in your account.</p>}

            <section>
              <h2 className="display-md">Orders in progress</h2>
              {orders === null ? (
                <Loading />
              ) : active.length === 0 ? (
                <p className="mt-3 text-muted">You have no orders in progress. <a href="/account/orders" className="font-medium text-ink underline">See all orders</a></p>
              ) : (
                <ul className="mt-4 space-y-3">
                  {active.map((order) => (
                    <li key={order.id}>
                      <a href={`/account/orders/${order.id}`} className="card flex flex-wrap items-center justify-between gap-3 p-4 transition hover:border-ink">
                        <span>
                          <span className="block font-semibold">Order #{order.order_number}</span>
                          <span className="text-sm text-muted">{formatDate(order.created_at)} · {formatPrice(business.currency, order.total)} · {order.fulfilment === 'delivery' ? 'Delivery' : 'Pickup'}</span>
                        </span>
                        <StatusBadge status={order.status} />
                      </a>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        )}
      </div>
    </>
  );
}

export function SitemapPage() {
  const { products, articles, business } = useStorefront();
  const paths = productPaths(products);
  const categories = Array.from(new Set(products.map((p) => p.category)));
  const group = (title: string, id: string, links: { href: string; label: string }[]) =>
    links.length > 0 && (
      <section id={id} className="scroll-mt-36">
        <h2 className="eyebrow">{title}</h2>
        <ul className="mt-3 space-y-1">
          {links.map((l) => <li key={l.href}><a href={l.href} className="inline-block py-1 hover:text-brand-deep hover:underline">{l.label}</a></li>)}
        </ul>
      </section>
    );

  return (
    <>
      <PageHeader eyebrow={business.name} title="Site Map" body="Every page on our website in one place.">
        <Breadcrumbs items={[{ label: 'Home', href: '/' }, { label: 'Site map' }]} />
      </PageHeader>
      <div className={`${pageClass} grid gap-10 sm:grid-cols-2 lg:grid-cols-4`}>
        {group('Shop', 'shop', [
          { href: '/shop', label: 'All products' },
          ...categories.map((c) => ({ href: `/shop?category=${encodeURIComponent(c)}`, label: c })),
          { href: '/search', label: 'Search' },
          { href: '/saved', label: 'Saved items' },
          { href: '/cart', label: 'Cart' },
          { href: '/checkout', label: 'Checkout' },
        ])}
        {group('Products', 'products', products.map((p) => ({ href: paths.get(p.id)!, label: p.name })))}
        {group('My account', 'account', [
          { href: '/account', label: 'Sign in or create an account' },
          { href: '/account/orders', label: 'My orders' },
          { href: '/track', label: 'Track an order' },
          { href: '/account/schedules', label: 'Regular orders' },
          { href: '/account/rewards', label: 'Rewards & points' },
          { href: '/account/messages', label: 'Messages' },
          { href: '/account/profile', label: 'Profile & settings' },
        ])}
        {group('Help', 'help', [
          ...INFO_PAGES.filter((p) => p.group !== 'legal').map((p) => ({ href: p.path, label: p.label })),
          { href: '/contact', label: 'Contact us' },
          { href: '/reviews', label: 'Customer reviews' },
          { href: '/feedback', label: 'Give feedback' },
        ])}
        {group('Policies', 'policies', INFO_PAGES.filter((p) => p.group === 'legal').map((p) => ({ href: p.path, label: p.label })))}
        {group('Milk guides', 'guides', [{ href: '/articles', label: 'All guides' }, ...articles.map((a) => ({ href: `/articles/${a.slug}`, label: a.title }))])}
      </div>
    </>
  );
}

export function NotFoundPage() {
  const { products } = useStorefront();
  const picks = products.filter((p) => p.inStock).slice(0, 4);
  return (
    <div className={pageClass}>
      <div className="mx-auto max-w-xl py-8 text-center">
        <p className="eyebrow">Error 404</p>
        <h1 className="display-lg mt-2">We can't find that page</h1>
        <p className="mt-3 text-lg text-muted">It may have moved. Try searching, or start from one of these.</p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <a href="/shop" className={primaryButton}>Go to the shop</a>
          <a href="/help" className={secondaryButton}>Help centre</a>
          <a href="/sitemap" className={secondaryButton}>Site map</a>
        </div>
      </div>
      {picks.length > 0 && (
        <ul className="mt-10 grid grid-cols-2 gap-3 sm:gap-5 lg:grid-cols-4">
          {picks.map((p) => <ProductCard key={p.id} product={p} />)}
        </ul>
      )}
    </div>
  );
}

/** /order-confirmed/:id, shown once M-Pesa or the card payment is confirmed. */
export function OrderConfirmedPage({ orderId }: { orderId: string }) {
  const { business, settings } = useStorefront();
  const ready = useAuth((s) => s.ready);
  const account = useAuth((s) => s.account);
  const [order, setOrder] = useState<Order | null | undefined>(undefined);

  useEffect(() => {
    if (account) fetchOrder(orderId).then(setOrder).catch(() => setOrder(null));
  }, [account, orderId]);

  if (!ready || (account && order === undefined)) return <Loading />;
  if (!account) {
    return (
      <div className={`${pageClass} max-w-xl text-center`}>
        <h1 className="display-md">Sign in to see your order</h1>
        <a href="/account" className={`${primaryButton} mt-6`}>Sign in</a>
      </div>
    );
  }
  if (!order) {
    return (
      <div className={`${pageClass} max-w-xl text-center`}>
        <h1 className="display-md">We can't find that order</h1>
        <a href="/account/orders" className={`${primaryButton} mt-6`}>My orders</a>
      </div>
    );
  }

  const paid = !['pending_payment', 'payment_failed', 'cancelled'].includes(order.status);
  const steps = order.fulfilment === 'delivery'
    ? ['We prepare your order now', 'A rider brings it to you; we message you when it is on the way', 'Keep fresh dairy in the fridge as soon as it arrives']
    : ['We prepare your order now', 'We message you when it is ready to collect', settings.openingHours ? `Collect it during opening hours: ${settings.openingHours}` : 'Collect it from our shop'];

  return (
    <div className={`${pageClass} max-w-3xl`}>
      <CheckoutSteps step={paid ? 4 : 3} />
      <div className="mt-8 text-center">
        <span className={`mx-auto grid size-16 place-items-center rounded-full ${paid ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-900'}`}>
          <CheckCircle2 size={34} aria-hidden />
        </span>
        <h1 className="display-lg mt-4">{paid ? 'Thank You for Your Order!' : 'Your Order Is Waiting for Payment'}</h1>
        <p className="mt-3 text-lg text-muted">
          Order <strong className="text-ink">#{order.order_number}</strong>
          {order.mpesa_receipt && <> · M-Pesa receipt <strong className="text-ink">{order.mpesa_receipt}</strong></>}
          {order.payment_method === 'Card' && order.payment_reference && <> · Paid by card, reference <strong className="text-ink">{order.payment_reference}</strong></>}
        </p>
        {!paid && <a href={`/account/orders/${order.id}`} className={`${primaryButton} mt-5`}>Pay now</a>}
      </div>

      {paid && (
        <section className="card mt-8 p-5 sm:p-6">
          <h2 className="flex items-center gap-2 font-sans text-lg font-bold tracking-normal">
            <Truck size={20} className="text-ember" aria-hidden /> What happens next
          </h2>
          <ol className="mt-4 space-y-3">
            {steps.map((step, index) => (
              <li key={step} className="flex gap-3">
                <span className="grid size-7 shrink-0 place-items-center rounded-full bg-sand text-sm font-bold">{index + 1}</span>
                <span className="pt-0.5">{step}</span>
              </li>
            ))}
          </ol>
          <p className="mt-4 text-sm text-muted">
            {order.fulfilment === 'delivery' ? `Delivering to ${order.delivery_address}.` : `Pickup from ${business.name}.`} Follow every step in{' '}
            <a href={`/account/orders/${order.id}`} className="underline">your order</a>.
          </p>
        </section>
      )}

      <section className="card mt-6 p-5 sm:p-6">
        <h2 className="font-sans text-lg font-bold tracking-normal">Order summary</h2>
        <ul className="mt-3 divide-y divide-line">
          {order.online_order_items.map((item) => (
            <li key={item.id} className="flex justify-between gap-3 py-3">
              <span>{item.product_name} <span className="text-muted">· {formatQuantity(item.quantity, item.unit)}</span></span>
              <span className="font-medium">{formatPrice(business.currency, item.line_total)}</span>
            </li>
          ))}
        </ul>
        <dl className="mt-2 space-y-1.5 border-t border-line pt-3">
          {order.delivery_fee > 0 && <div className="flex justify-between"><dt className="text-muted">Delivery</dt><dd>{formatPrice(business.currency, order.delivery_fee)}</dd></div>}
          <OrderDiscounts order={order} currency={business.currency} />
          <div className="flex justify-between text-xl font-bold"><dt>{paid ? 'Paid' : 'To pay'}</dt><dd>{formatPrice(business.currency, order.total)}</dd></div>
        </dl>
        {paid && <p className="mt-3 text-sm text-muted">This order earns you reward points. See them under <a href="/account/rewards" className="underline">Rewards</a>.</p>}
      </section>

      <div className="mt-8 grid gap-3 sm:grid-cols-3">
        <a href="/track" className={`${secondaryButton} w-full`}><PackageSearch size={17} aria-hidden /> Track order</a>
        <a href="/account/schedules" className={`${secondaryButton} w-full`}><CalendarClock size={17} aria-hidden /> Order regularly</a>
        <a href="/account/messages" className={`${secondaryButton} w-full`}><MessageCircle size={17} aria-hidden /> Message us</a>
      </div>
      <div className="mt-4 text-center">
        <a href="/shop" className={primaryButton}>Continue shopping</a>
      </div>
    </div>
  );
}
