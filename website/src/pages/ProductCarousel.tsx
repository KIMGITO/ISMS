import { useEffect, useRef, useState } from 'react';
import { ArrowRight, ChevronLeft, ChevronRight } from 'lucide-react';
import { Product } from '../api';
import ProductCard from './ProductCard';

/**
 * A titled row of product cards that scrolls sideways: arrows beside the title on wide screens,
 * swipe on phones (about two and a half cards show, so it's clear there is more), and a
 * "View all" link. Arrows grey out at each end.
 */
export default function ProductCarousel({ id, title, products, viewAll, className = '', gap = 'pt-10 sm:pt-12' }: {
  id: string;
  title: string;
  products: Product[];
  viewAll?: string;
  className?: string;
  /** Space above, as classes. */
  gap?: string;
}) {
  const track = useRef<HTMLUListElement>(null);
  const [edges, setEdges] = useState({ start: true, end: false });
  // How much of the row is in view and how far it has scrolled, for the bar under it.
  const [bar, setBar] = useState({ size: 1, at: 0 });

  const measure = () => {
    const el = track.current;
    if (!el) return;
    setEdges({ start: el.scrollLeft <= 4, end: el.scrollLeft + el.clientWidth >= el.scrollWidth - 4 });
    const size = el.scrollWidth > 0 ? Math.min(1, el.clientWidth / el.scrollWidth) : 1;
    const room = el.scrollWidth - el.clientWidth;
    setBar({ size, at: room > 0 ? (el.scrollLeft / room) * (1 - size) : 0 });
  };

  useEffect(() => {
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [products.length]);

  const scroll = (direction: 1 | -1) => {
    const el = track.current;
    if (!el) return;
    el.scrollBy({ left: direction * el.clientWidth * 0.85, behavior: 'smooth' });
  };

  if (products.length === 0) return null;
  const arrow = 'grid size-9 place-items-center rounded-full border border-line bg-white text-ink transition hover:border-ember hover:bg-ember hover:text-white disabled:pointer-events-none disabled:opacity-35';

  return (
    <section id={id} className={`site-gutter scroll-mt-36 ${gap} ${className}`} aria-labelledby={`${id}-heading`}>
      <div className="flex items-center justify-between gap-3">
        <h2 id={`${id}-heading`} className="display-md font-semibold">{title}</h2>
        <div className="flex shrink-0 items-center gap-2">
          {viewAll && (
            <a href={viewAll} className="mr-1 hidden items-center gap-1 text-sm font-medium text-ember hover:underline sm:inline-flex">
              View all <ArrowRight size={14} aria-hidden />
            </a>
          )}
          <button type="button" onClick={() => scroll(-1)} disabled={edges.start} aria-label={`Scroll ${title} back`} className={`${arrow} max-sm:hidden`}>
            <ChevronLeft size={18} aria-hidden />
          </button>
          <button type="button" onClick={() => scroll(1)} disabled={edges.end} aria-label={`Scroll ${title} forward`} className={`${arrow} max-sm:hidden`}>
            <ChevronRight size={18} aria-hidden />
          </button>
        </div>
      </div>
      <ul
        ref={track}
        onScroll={measure}
        className="product-rail no-scrollbar -mx-4 mt-4 flex snap-x snap-mandatory gap-2.5 overflow-x-auto scroll-px-4 px-4 pb-2 sm:mx-0 sm:gap-4 sm:scroll-px-0 sm:px-0"
      >
        {products.map((product) => <ProductCard key={product.id} product={product} />)}
      </ul>
      {bar.size < 0.99 && (
        <div className="relative mx-auto mt-2 h-1 w-24 overflow-hidden rounded-full bg-ink/10 sm:w-32" aria-hidden>
          <span
            className="absolute inset-y-0 rounded-full bg-ember transition-[left] duration-150"
            style={{ width: `${bar.size * 100}%`, left: `${bar.at * 100}%` }}
          />
        </div>
      )}
      {viewAll && (
        <div className="mt-3 text-center sm:hidden">
          <a href={viewAll} className="inline-flex min-h-10 items-center gap-1 text-sm font-medium text-ember">View all <ArrowRight size={14} aria-hidden /></a>
        </div>
      )}
    </section>
  );
}
