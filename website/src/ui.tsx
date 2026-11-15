import { ReactNode, useEffect, useRef, useState } from 'react';
import { ArrowRight, BadgeCheck, CreditCard, Headphones, Milk, Truck } from 'lucide-react';
import { Order, OrderStatus, Product, Storefront, takesAirtel } from './api';
import { photoUrl, productPhoto } from './images';

export const primaryButton = 'btn btn-primary';
export const secondaryButton = 'btn btn-secondary';
export const fieldClass = 'field';
export const pageClass = 'site-gutter py-6 sm:py-10';
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

/** `fit="contain"` shows the whole picture (product cut-outs); the default fills the box. */
export function ProductImage({ product, width = 640, fit = 'cover' }: {
  product: Pick<Product, 'image' | 'name'> & { category?: string };
  width?: number;
  fit?: 'cover' | 'contain';
}) {
  const [failed, setFailed] = useState(false);
  const photo = productPhoto(`${product.name} ${product.category ?? ''}`);
  return (
    <img
      src={product.image && !failed ? product.image : photoUrl(photo, width, width)}
      alt={product.name}
      loading="lazy"
      onError={() => setFailed(true)}
      className={`size-full ${fit === 'contain' && product.image && !failed ? 'object-contain' : 'object-cover'}`}
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

/**
 * The banner at the top of inner pages: the same soft sand panel as the home hero,
 * with the photo in a circle on wider screens. Phones get the title and breadcrumbs only.
 */
export function PageHero({ eyebrow, title, body, photo, children }: {
  eyebrow?: string;
  title: string;
  body?: string;
  photo: Parameters<typeof photoUrl>[0];
  children?: ReactNode;
}) {
  return (
    <section className="site-gutter pt-4 sm:pt-6">
      <div className="soft-panel relative isolate grid items-center gap-6 overflow-hidden rounded-2xl px-5 py-7 sm:grid-cols-[1fr_auto] sm:px-12 sm:py-10">
        <div className="min-w-0">
          {children}
          {eyebrow && <p className="eyebrow rise-in mt-3 max-sm:hidden">{eyebrow}</p>}
          <h1 className="display-lg rise-in mt-1.5 max-w-xl">{title}</h1>
          {body && <p className="rise-in-late mt-2 max-w-md text-muted max-sm:hidden">{body}</p>}
        </div>
        <img
          src={photoUrl(photo, 480, 480)}
          alt=""
          className="rise-in-late hidden size-40 rounded-full object-cover ring-8 ring-white sm:block lg:size-48"
        />
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
        <img src="/milk-loader.svg" width={88} height={88} alt="Loading" />
      </div>
    </div>
  );
}

/**
 * A section title. Left-aligned with a "see all" link on the right by default;
 * `center` gives the shop's centred title with a short muted line under it.
 */
export function SectionHeader({ eyebrow, title, id, link, subtitle, center = false }: {
  eyebrow?: string;
  title: string;
  id?: string;
  link?: { href: string; label: string };
  subtitle?: string;
  center?: boolean;
}) {
  if (center) {
    return (
      <div className="section-title">
        <h2 id={id} className="display-lg">{title}</h2>
        {subtitle && <p className="mt-1.5 text-sm text-muted max-sm:hidden">{subtitle}</p>}
      </div>
    );
  }
  return (
    <div className="flex items-end justify-between gap-4">
      <div className="min-w-0">
        {eyebrow && <p className="eyebrow max-sm:hidden">{eyebrow}</p>}
        <h2 id={id} className="display-lg sm:mt-1">{title}</h2>
        {subtitle && <p className="mt-1 text-sm text-muted max-sm:hidden">{subtitle}</p>}
      </div>
      {link && (
        <a href={link.href} className="group inline-flex shrink-0 items-center gap-1 py-2 text-sm font-medium text-ember">
          {link.label} <ArrowRight size={15} className="transition group-hover:translate-x-0.5" aria-hidden />
        </a>
      )}
    </div>
  );
}

const TINTS = ['bg-tint-sand', 'bg-tint-peach', 'bg-tint-butter', 'bg-tint-sage', 'bg-tint-blush'];

/** A soft background class picked from the text, so the same category always gets the same colour. */
export function tintFor(text: string) {
  let hash = 0;
  for (const char of text) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return TINTS[hash % TINTS.length];
}

/** A plain banner for inner pages that don't need a photo. Same panel as PageHero. */
export function PageHeader({ eyebrow, title, body, children }: { eyebrow?: string; title: string; body?: string; children?: ReactNode }) {
  return (
    <section className="site-gutter pt-4 sm:pt-6">
      <div className="soft-panel rounded-2xl px-5 py-6 sm:px-12 sm:py-10">
        {children}
        {eyebrow && <p className="eyebrow mt-3 max-sm:hidden">{eyebrow}</p>}
        <h1 className="display-lg mt-1.5 max-w-3xl">{title}</h1>
        {body && <p className="mt-2 max-w-2xl text-muted max-sm:hidden">{body}</p>}
      </div>
    </section>
  );
}

/** The four reasons to trust the shop, shown on the home, product and cart pages. */
export function TrustStrip({ site, compact = false }: { site: Storefront; compact?: boolean }) {
  const { settings, business } = site;
  const items = [
    { icon: CreditCard, title: takesAirtel(site) ? 'M-Pesa or Airtel Money' : 'Pay with M-Pesa', body: 'Secure prompt on your phone', href: '/payments' },
    {
      icon: Truck,
      title: settings.deliveryEnabled ? 'Delivery or pickup' : 'Pickup in store',
      body: settings.deliveryEnabled ? 'Your choice at checkout' : 'Collect when it suits you',
      href: '/delivery',
    },
    { icon: BadgeCheck, title: 'Fresh guarantee', body: 'Problem? We put it right', href: '/returns' },
    { icon: Headphones, title: 'Real people', body: business.contactPhone ? `Call ${business.contactPhone}` : 'Message us any time', href: '/contact' },
  ];
  // Bordered boxes with the icon on the left. Phones see the icon and title; the line under it joins in on wider screens.
  return (
    <ul className={`grid grid-cols-2 gap-2.5 sm:gap-4 lg:grid-cols-4 ${compact ? 'text-sm' : ''}`}>
      {items.map(({ icon: Icon, title, body, href }) => (
        <li key={title}>
          <a href={href} className={`flex h-full items-center gap-3 rounded-lg border border-line bg-white transition hover:border-ember/50 ${compact ? 'p-3' : 'p-3 sm:px-5 sm:py-4'}`}>
            <Icon size={compact ? 22 : 28} strokeWidth={1.5} className="shrink-0 text-ember" aria-hidden />
            <span className="min-w-0">
              <span className="block text-[0.8125rem] font-medium leading-snug sm:text-sm">{title}</span>
              <span className="mt-0.5 hidden text-xs leading-snug text-muted sm:block">{body}</span>
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
