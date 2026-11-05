import { ReactNode, useState } from 'react';
import { Milk } from 'lucide-react';
import { Order, OrderStatus, Product } from './api';

export const primaryButton =
  'inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-brand px-5 py-2.5 font-semibold text-on-brand transition hover:brightness-95 disabled:cursor-not-allowed disabled:bg-gray-200 disabled:text-gray-600';
export const secondaryButton =
  'inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-line bg-white px-5 py-2.5 font-semibold text-ink transition hover:border-brand-deep disabled:cursor-not-allowed disabled:opacity-60';
export const fieldClass =
  'mt-1.5 w-full rounded-lg border border-line bg-white px-3.5 py-2.5 text-base font-normal text-ink placeholder:text-muted/70';
export const pageClass = 'mx-auto w-full max-w-7xl px-4 py-8 sm:px-6 sm:py-12';
export const cardClass = 'rounded-xl border border-line bg-white';

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

export function ProductImage({ product }: { product: Pick<Product, 'image' | 'name'> }) {
  const [failed, setFailed] = useState(false);
  if (!product.image || failed) {
    return (
      <div className="grid size-full place-items-center bg-amber-50">
        <Milk size={40} className="text-brand/60" aria-hidden />
      </div>
    );
  }
  return (
    <img
      src={product.image}
      alt={product.name}
      loading="lazy"
      onError={() => setFailed(true)}
      className="size-full object-cover"
    />
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
