import { ReactNode, useEffect, useRef, useState } from 'react';
import { ArrowRight, BadgeCheck, CreditCard, Headphones, Store, Truck } from 'lucide-react';
import { Order, OrderStatus, Product, Storefront, takesAirtel } from './api';
import { pictureSet, shopPictures, textSeed } from './shopPictures';
import { useSite } from './store';
import { HERO_DRAW_ORDER, HeroBox, heroBoxes, heroBoxStyle } from './heroSlides';
import { formatPrice, qtyNumber, roundQty } from './numbers';

export const primaryButton = 'btn btn-primary';
export const secondaryButton = 'btn btn-secondary';
export const fieldClass = 'field';
export const pageClass = 'site-gutter py-6 sm:py-10';
export const cardClass = 'card';


export { formatPrice, qtyNumber, roundQty };

/** "Litres" reads wrong after "per", so a per-unit label uses the singular. */
export const perUnit = (unit: string) => unit.replace(/s$/i, '').toLowerCase();

export const formatQuantity = (quantity: number, unit: string) =>
  `${qtyNumber(quantity)} ${roundQty(quantity) === 1 ? unit.replace(/s$/i, '') : unit}`;

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

/**
 * `fit="contain"` shows the whole picture (product cut-outs); `cover` fills the box; `brand`
 * follows the shop's picture style (design token --img-fit).
 */
export function ProductImage({ product, width = 640, fit = 'cover' }: {
  product: Pick<Product, 'image' | 'name'> & { category?: string };
  width?: number;
  fit?: 'cover' | 'contain' | 'brand';
}) {
  const [failed, setFailed] = useState(false);
  if (!product.image || failed) return <NoPicture text={product.name} label={product.name} />;
  return (
    <img
      src={product.image}
      alt={product.name}
      loading="lazy"
      width={width}
      onError={() => setFailed(true)}
      className={`size-full ${fit === 'brand' ? '[object-fit:var(--img-fit,contain)]' : fit === 'contain' ? 'object-contain' : 'object-cover'}`}
    />
  );
}

/** Stands in for a missing photo: a soft colour with the first letter, never another shop's picture. */
export function NoPicture({ text, label }: { text: string; label?: string }) {
  return (
    <span role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true} className={`grid size-full place-items-center ${tintFor(text)}`}>
      <span className="font-display text-[2.5em] font-semibold uppercase text-ink/30">{text.trim().charAt(0) || '?'}</span>
    </span>
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
        <Store size={40} className="mx-auto text-brand" aria-hidden />
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
        <img src="/denso-loader.svg" width={88} height={88} alt="Loading" />
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

/**
 * Product pictures placed like a shop-window display: the main product with up to two smaller
 * ones beside and in front. Best with cut-outs (background removed in the app's uploader).
 * The home hero and every inner page banner use it, so the whole site shows the same products.
 */
export function ProductDisplay({ images, positions, title, eager = false, className = '' }: {
  images: readonly string[];
  positions?: HeroBox[];
  title: string;
  eager?: boolean;
  className?: string;
}) {
  const boxes = heroBoxes(images.length, positions);
  return (
    <div className={`relative mx-auto aspect-square w-full ${className}`}>
      {/* A soft floor shadow so the products stand on the panel rather than float. */}
      <span className="absolute inset-x-[8%] bottom-[3%] h-[10%] rounded-[50%] bg-hero/15 blur-md" aria-hidden />
      {HERO_DRAW_ORDER.filter((index) => index < images.length).map((index) => (
        <img
          key={`${index}-${images[index]}`}
          src={images[index]}
          alt={index === 0 ? title : ''}
          loading={eager ? 'eager' : 'lazy'}
          fetchPriority={eager && index === 0 ? 'high' : 'auto'}
          style={heroBoxStyle(boxes[index])}
          className="object-contain object-bottom drop-shadow-[0_14px_16px_rgba(35,22,14,0.22)]"
        />
      ))}
    </div>
  );
}

/**
 * The banner at the top of every inner page: the home hero's sand panel, a bold headline,
 * and a small product display on the right, so each page reads as part of the same shop.
 * Pages may pass `images`; otherwise the shop's own product photos are used (picked by the title),
 * and a shop without product photos gets a banner with words only.
 */
export function PageHeader({ eyebrow, title, body, images, children }: {
  eyebrow?: string;
  title: string;
  body?: string;
  images?: readonly string[];
  children?: ReactNode;
}) {
  const products = useSite((s) => s.site?.products);
  const pictures = images ?? pictureSet(shopPictures(products), textSeed(title), 3);
  return (
    <section className="site-gutter pt-3 sm:pt-6">
      <div className="soft-panel relative isolate grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 overflow-hidden rounded-2xl px-4 py-6 sm:gap-6 sm:px-12 sm:py-8 lg:px-16">
        <div className="min-w-0">
          {children}
          {eyebrow && <p className="eyebrow rise-in mt-3 max-sm:hidden">{eyebrow}</p>}
          <h1 className="display-xl rise-in mt-1.5 max-w-[22ch] font-semibold max-sm:text-[1.375rem] max-sm:leading-tight">{title}</h1>
          {body && <p className="rise-in-late mt-2 max-w-xl text-muted max-sm:hidden sm:text-[0.9375rem]">{body}</p>}
        </div>
        {pictures.length > 0 && <ProductDisplay images={pictures} title="" eager className="rise-in-late w-[5.5rem] min-[400px]:w-[6.5rem] sm:w-[11rem] lg:w-[14rem]" />}
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
    { icon: BadgeCheck, title: 'Our guarantee', body: 'Problem? We put it right', href: '/returns' },
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
