import { ReactNode, useEffect, useRef, useState } from 'react';
import { Milk } from 'lucide-react';
import { Order, OrderStatus, Product } from './api';
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

/** Italiana's hyphen is nearly invisible, which turns "M-Pesa" into "M Pesa", so hyphens in display text use the body font. */
export function DisplayText({ children }: { children: string }) {
  return (
    <>
      {children.split('-').map((part, index) => (
        <span key={index}>
          {index > 0 && <span className="font-sans font-normal">-</span>}
          {part}
        </span>
      ))}
    </>
  );
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
    <section className="relative isolate overflow-hidden bg-sand">
      <img
        src={photoUrl(photo, 1000, 560)}
        alt=""
        className="photo-warm absolute inset-y-0 right-0 -z-20 hidden h-full w-1/2 object-cover sm:block"
      />
      <div className="absolute inset-y-0 right-0 -z-10 hidden w-1/2 bg-gradient-to-r from-sand to-transparent sm:block" />
      <div className="site-gutter py-10 sm:py-16">
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
        <h1 className="mt-4 text-3xl font-bold">{title}</h1>
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
