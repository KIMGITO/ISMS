import { ReactNode, useEffect, useRef, useState } from 'react';
import { BadgeCheck, CreditCard, Headphones, Milk, Truck } from 'lucide-react';
import { Order, OrderStatus, Product, Storefront } from './api';
import { photoUrl, productPhoto } from './images';

export const primaryButton = 'btn btn-primary';
export const secondaryButton = 'btn btn-secondary';
export const fieldClass = 'field';
export const pageClass = 'site-gutter py-8 sm:py-12';
export const cardClass = 'card';

export const formatPrice = (currency: string, price: number) =>
  `${currency} ${Number(price).toLocaleString('en-KE', { maximumFractionDigits: 2 })}`;

/** "Litres" reads wrong after "per", so a per-unit label uses the singular. */
export const perUnit = (unit: string) => unit.replace(/s$/i, '').toLowerCase();

export const formatQuantity = (quantity: number, unit: string) =>
  `${Number(quantity)} ${Number(quantity) === 1 ? unit.replace(/s$/i, '') : unit}`;

export const formatDate = (value: string) =>
  new Date(value).toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric' });

export const formatDateTime = (value: string) =>
  new Date(value).toLocaleString('en-KE', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

export const STATUS_LABELS: Record<OrderStatus, string> = {
  pending_payment: 'Waiting for payment',
  payment_failed: 'Payment not completed',
  paid: 'Paid',
  preparing: 'Being prepared',
  out_for_delivery: 'On the way',
  ready_for_pickup: 'Ready for pickup',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

const STATUS_STYLES: Record<OrderStatus, string> = {
  pending_payment: 'bg-amber-100 text-amber-900',
  payment_failed: 'bg-red-100 text-red-800',
  paid: 'bg-emerald-100 text-emerald-900',
  preparing: 'bg-sky-100 text-sky-900',
  out_for_delivery: 'bg-sky-100 text-sky-900',
  ready_for_pickup: 'bg-sky-100 text-sky-900',
  completed: 'bg-stone-200 text-stone-800',
  cancelled: 'bg-stone-200 text-stone-700',
};

export function StatusBadge({ status }: { status: Order['status'] }) {
  return (
    <span className={`inline-block rounded-full px-3 py-1 text-sm font-medium ${STATUS_STYLES[status]}`}>
      {STATUS_LABELS[status]}
    </span>
  );
}

export function ProductImage({ product, width = 640 }: { product: Pick<Product, 'image' | 'name'> & { category?: string }; width?: number }) {
  const [failed, setFailed] = useState(false);
  const photo = productPhoto(`${product.name} ${product.category ?? ''}`);
  return (
    <img
      src={product.image && !failed ? product.image : photoUrl(photo, width, width)}
      alt={product.name}
      loading="lazy"
      onError={() => setFailed(true)}
      className="size-full bg-sand object-cover"
    />
  );
}

/** Headline text. Kept as a component so headings can get special handling in one place. */
export function DisplayText({ children }: { children: string }) {
  return <>{children}</>;
}

/** Adds is-visible once an element scrolls into view, which theme.css animates. */
function useReveal<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    if (typeof IntersectionObserver === 'undefined') {
      element.classList.add('is-visible');
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          element.classList.add('is-visible');
          observer.disconnect();
        }
      },
      { rootMargin: '0px 0px -8% 0px' },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return ref;
}

export function Reveal({ children, className = '' }: { children: ReactNode; className?: string }) {
  const ref = useReveal<HTMLDivElement>();
  return <div ref={ref} className={`reveal ${className}`}>{children}</div>;
}

/** A list whose items appear one after another. */
export function RevealList({ children, className = '' }: { children: ReactNode; className?: string }) {
  const ref = useReveal<HTMLUListElement>();
  return <ul ref={ref} className={`reveal-list ${className}`}>{children}</ul>;
}

/** The banner at the top of inner pages. */
export function PageHero({ eyebrow, title, body, photo, children }: {
  eyebrow?: string;
  title: string;
  body?: string;
  photo: Parameters<typeof photoUrl>[0];
  children?: ReactNode;
}) {
  return (
    // The photo fills the whole banner on every screen; a sand fade keeps the words readable.
    <section className="relative isolate flex min-h-[17rem] items-end overflow-hidden bg-sand sm:min-h-[20rem] sm:items-center">
      <picture>
        <source media="(orientation: portrait)" srcSet={[480, 720, 1080].map((w) => `${photoUrl(photo, w, Math.round(w * 1.1))} ${w}w`).join(', ')} sizes="100vw" />
        <img
          src={photoUrl(photo, 1400, 700)}
          srcSet={[800, 1400, 2000].map((w) => `${photoUrl(photo, w, Math.round(w * 0.5))} ${w}w`).join(', ')}
          sizes="100vw"
          alt=""
          className="photo-warm absolute inset-0 -z-20 h-full w-full object-cover"
        />
      </picture>
      <div className="absolute inset-0 -z-10 bg-gradient-to-t from-sand from-25% via-sand/75 via-55% to-sand/10 sm:bg-gradient-to-r sm:from-sand sm:from-35% sm:via-sand/70 sm:via-55% sm:to-transparent" />
      <div className="site-gutter w-full py-8 sm:py-12">
        {children}
        {eyebrow && <p className="eyebrow rise-in mt-3">{eyebrow}</p>}
        <h1 className="display-lg rise-in mt-2 max-w-xl">{title}</h1>
        {body && <p className="rise-in-late mt-4 max-w-md text-lg leading-relaxed text-muted">{body}</p>}
      </div>
    </section>
  );
}

export function ErrorText({ children }: { children: ReactNode }) {
  if (!children) return null;
  return (
    <p role="alert" className="rounded-lg bg-red-50 px-3.5 py-2.5 font-medium text-red-800">
      {children}
    </p>
  );
}

export function Notice({ title, body, children }: { title: string; body: string; children?: ReactNode }) {
  return (
    <div className="grid min-h-[60vh] place-items-center px-4 py-12 text-center">
      <div className="max-w-md">
        <Milk size={40} className="mx-auto text-brand" aria-hidden />
        <h1 className="display-md mt-4">{title}</h1>
        <p className="mt-2 text-muted">{body}</p>
        {children}
      </div>
    </div>
  );
}

export function Loading() {
  return (
    <div role="status" className="grid min-h-[40vh] place-items-center text-muted">
      <div className="flex flex-col items-center gap-3">
        <Milk size={36} className="animate-pulse text-brand" aria-hidden />
        <p>Loading…</p>
      </div>
    </div>
  );
}

/** A section title with an optional "see all" link on the right. */
export function SectionHeader({ eyebrow, title, id, link }: { eyebrow?: string; title: string; id?: string; link?: { href: string; label: string } }) {
  return (
    <div className="flex items-end justify-between gap-4">
      <div className="min-w-0">
        {eyebrow && <p className="eyebrow">{eyebrow}</p>}
        <h2 id={id} className="display-lg mt-1.5">{title}</h2>
      </div>
      {link && (
        <a href={link.href} className="shrink-0 py-3 text-[0.9375rem] font-semibold underline decoration-line underline-offset-4 hover:decoration-ink">
          {link.label}
        </a>
      )}
    </div>
  );
}

/** A plain banner for inner pages that don't need a photo. */
export function PageHeader({ eyebrow, title, body, children }: { eyebrow?: string; title: string; body?: string; children?: ReactNode }) {
  return (
    <section className="border-b border-line bg-sand/60">
      <div className="site-gutter py-8 sm:py-12">
        {children}
        {eyebrow && <p className="eyebrow mt-3">{eyebrow}</p>}
        <h1 className="display-lg mt-1.5 max-w-3xl">{title}</h1>
        {body && <p className="mt-3 max-w-2xl text-lg leading-relaxed text-muted">{body}</p>}
      </div>
    </section>
  );
}

/** The four reasons to trust the shop, shown on the home, product and cart pages. */
export function TrustStrip({ site, compact = false }: { site: Storefront; compact?: boolean }) {
  const { settings, business } = site;
  const items = [
    { icon: CreditCard, title: 'Pay with M-Pesa', body: 'Secure prompt on your phone', href: '/payments' },
    {
      icon: Truck,
      title: settings.deliveryEnabled ? 'Delivery or pickup' : 'Pickup in store',
      body: settings.deliveryEnabled ? 'Your choice at checkout' : 'Collect when it suits you',
      href: '/delivery',
    },
    { icon: BadgeCheck, title: 'Fresh guarantee', body: 'Problem? We put it right', href: '/returns' },
    { icon: Headphones, title: 'Real people', body: business.contactPhone ? `Call ${business.contactPhone}` : 'Message us any time', href: '/contact' },
  ];
  return (
    <ul className={`grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-line bg-line lg:grid-cols-4 ${compact ? 'text-sm' : ''}`}>
      {items.map(({ icon: Icon, title, body, href }) => (
        <li key={title} className="bg-white">
          <a href={href} className={`flex h-full items-start gap-3 transition hover:bg-amber-50 ${compact ? 'p-3' : 'p-4 sm:p-5'}`}>
            <Icon size={compact ? 20 : 24} strokeWidth={1.6} className="mt-0.5 shrink-0 text-ember" aria-hidden />
            <span className="min-w-0">
              <span className="block font-semibold leading-snug">{title}</span>
              <span className="mt-0.5 block text-sm leading-snug text-muted">{body}</span>
            </span>
          </a>
        </li>
      ))}
    </ul>
  );
}

/** "10% off" or "Ksh 100 off", plus any minimum order. */
export function promotionLabel(promo: { kind: 'percent' | 'amount'; value: number; minOrder?: number }, currency: string) {
  const saving = promo.kind === 'percent' ? `${Number(promo.value)}% off` : `${formatPrice(currency, promo.value)} off`;
  return Number(promo.minOrder) > 0 ? `${saving} orders over ${formatPrice(currency, promo.minOrder!)}` : saving;
}
