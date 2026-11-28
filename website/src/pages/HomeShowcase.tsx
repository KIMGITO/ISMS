// Home page sections from the 2026-11-28 design rebuild, each a variant in engine/layout.ts:
//   hero "overlay"         one big picture, the words on a card over it
//   hero "collage"         words beside three pictures
//   categories "photos"    tall picture cards with the name over the picture
//   products "spotlight"   one product large, four more small beside it
//   testimonials "people"  customer cards: who, when, what they bought, the shop's reply
//   testimonials "slider"  one quote at a time, large, with arrows and dots
// Every section draws nothing (or falls back to a simpler variant) when the shop lacks the
// pictures or reviews it needs, so no section is ever empty or broken.
import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { ArrowRight, BadgeCheck, ChevronLeft, ChevronRight, MessageSquareReply, Quote } from 'lucide-react';
import { Product, Review } from '../api';
import { industryGroup, safeHref, visibleHeroSlides } from '../heroSlides';
import { shopPictures } from '../shopPictures';
import { productPaths } from '../seo';
import { useStorefront } from '../store';
import { NoPicture, perUnit, ProductImage, tintFor } from '../ui';
import ProductCard, { CartStepper, OfferRibbon, PriceLine } from './ProductCard';
import { reviewStats, Stars } from './Reviews';
import { HeroStatement, topCategories } from './HomeSections';

const reducedMotion = () =>
  typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** The words and buttons the other openings use: first saved slide, else tagline, else built-in. */
function useHeroWords() {
  const { business, brand, heroSlides, articles, products } = useStorefront();
  const pictures = shopPictures(products);
  const saved = (heroSlides ?? []).length > 0;
  const first = visibleHeroSlides(heroSlides, articles.length > 0, pictures, brand?.industry)[0];
  const services = ['services', 'logistics'].includes(industryGroup(brand?.industry));
  const cta = { label: first?.ctaLabel || 'Shop now', href: safeHref(first?.ctaHref) };
  return {
    name: business.name,
    title: (!saved && brand?.tagline) || first?.title || business.name,
    body: first?.body,
    cta,
    second: services || cta.href === '/contact' ? { label: 'About us', href: '/about' } : { label: 'Contact us', href: '/contact' },
    // Saved slide pictures first, then the cover, then product photos: never another shop's.
    pictures: [...new Set([...(saved ? first?.images ?? [] : []), business.coverImageUrl, ...pictures.map((p) => p.src)].filter((s): s is string => !!s))],
  };
}

/** One big picture across the page, the words on a card over its lower corner. */
export function HeroOverlay() {
  const words = useHeroWords();
  const picture = words.pictures[0];
  if (!picture) return <HeroStatement variant="banner" />;
  return (
    <section className="site-gutter pt-3 sm:pt-6" aria-label="Welcome">
      <div className="relative overflow-hidden rounded-2xl bg-sand">
        <img src={picture} alt="" fetchPriority="high" className="aspect-[4/5] w-full object-cover min-[480px]:aspect-[4/3] md:aspect-[21/9]" />
        <div className="absolute inset-0 bg-gradient-to-t from-black/55 via-black/10 to-transparent md:bg-gradient-to-r md:from-black/45 md:via-black/5" aria-hidden />
        <div className="absolute inset-x-3 bottom-3 rounded-xl bg-cream/95 p-4 shadow-soft backdrop-blur sm:inset-x-auto sm:bottom-6 sm:left-6 sm:max-w-md sm:p-6 lg:bottom-10 lg:left-10 lg:max-w-lg lg:p-8">
          <p className="eyebrow">{words.name}</p>
          <h1 className="display-xl mt-1.5 max-w-[18ch]">{words.title}</h1>
          {words.body && <p className="mt-2 text-sm text-muted sm:text-base">{words.body}</p>}
          <div className="mt-4 pill-row gap-2 sm:mt-6">
            <a href={words.cta.href} className="btn btn-primary">{words.cta.label} <ArrowRight size={16} aria-hidden /></a>
            <a href={words.second.href} className="btn btn-secondary">{words.second.label}</a>
          </div>
        </div>
      </div>
    </section>
  );
}

/** Words beside three pictures: one tall, two stacked. Fewer than three pictures: the statement opening. */
export function HeroCollage() {
  const words = useHeroWords();
  const [a, b, c] = words.pictures;
  if (!c) return <HeroStatement variant="statement" />;
  const tile = 'size-full overflow-hidden rounded-xl bg-sand';
  return (
    <section className="site-gutter pt-3 sm:pt-6" aria-label="Welcome">
      <div className="grid items-center gap-6 md:grid-cols-[1fr_1.15fr] lg:gap-12">
        <div>
          <p className="eyebrow">{words.name}</p>
          <h1 className="display-xl mt-2 max-w-[16ch]">{words.title}</h1>
          {words.body && <p className="mt-3 max-w-md text-sm text-muted sm:text-base">{words.body}</p>}
          <div className="mt-6 pill-row gap-2.5">
            <a href={words.cta.href} className="btn btn-primary">{words.cta.label} <ArrowRight size={16} aria-hidden /></a>
            <a href={words.second.href} className="btn btn-secondary">{words.second.label}</a>
          </div>
        </div>
        <div className="grid aspect-[5/4] grid-cols-[1.25fr_1fr] grid-rows-2 gap-2 sm:gap-3">
          <div className={`${tile} row-span-2`}><img src={a} alt="" fetchPriority="high" className="size-full object-cover" /></div>
          <div className={tile}><img src={b} alt="" className="size-full object-cover" /></div>
          <div className={tile}><img src={c} alt="" loading="lazy" className="size-full object-cover" /></div>
        </div>
      </div>
    </section>
  );
}

/** Tall picture cards, the name and item count on the picture. Swipes on phones, a grid from tablets up. */
export function CategoryPhotos({ title, gap }: { title: string; gap: string }) {
  const { products } = useStorefront();
  const categories = topCategories(products, 8);
  if (categories.length < 2) return null;
  // As many across as there are cards (up to six), so no card sits alone on a last row.
  const n = categories.length;
  const columns = n <= 3 ? 'sm:grid-cols-3' : n === 4 ? 'sm:grid-cols-4' : n === 5 ? 'sm:grid-cols-3 lg:grid-cols-5' : n === 6 ? 'sm:grid-cols-3 lg:grid-cols-6' : 'sm:grid-cols-3 lg:grid-cols-4';
  return (
    <section className={`site-gutter ${gap}`} aria-labelledby="categories-heading">
      <h2 id="categories-heading" className="display-md">{title}</h2>
      <ul className={`no-scrollbar -mx-4 mt-4 flex snap-x snap-mandatory gap-3 overflow-x-auto scroll-px-4 px-4 pb-1 sm:mx-0 sm:mt-5 sm:grid sm:gap-4 sm:overflow-visible sm:px-0 ${columns}`}>
        {categories.map((c) => (
          <li key={c.name} className="w-[42vw] max-w-[13rem] shrink-0 snap-start sm:w-auto sm:max-w-none">
            <a href={`/shop?category=${encodeURIComponent(c.name)}`} className="group relative block aspect-[4/5] overflow-hidden rounded-xl">
              {c.image
                ? <img src={c.image} alt="" loading="lazy" className={`size-full object-cover transition duration-700 group-hover:scale-105 ${tintFor(c.name)}`} />
                : <NoPicture text={c.name} />}
              <span className="absolute inset-0 bg-gradient-to-t from-black/65 via-black/5 to-transparent" aria-hidden />
              <span className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-2 p-3 text-white sm:p-4">
                <span className="min-w-0">
                  <span className="block truncate font-display text-base capitalize leading-tight sm:text-lg" style={{ fontWeight: 'var(--heading-weight, 600)' }}>{c.name}</span>
                  <span className="text-xs opacity-85">{c.count} {c.count === 1 ? 'item' : 'items'}</span>
                </span>
                <span className="grid size-8 shrink-0 place-items-center rounded-full bg-white/90 text-ink transition group-hover:bg-ember group-hover:text-white" aria-hidden>
                  <ArrowRight size={15} />
                </span>
              </span>
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** One product large with its description and cart buttons, four more as ordinary cards beside it. */
export function ProductSpotlight({ id, title, products, viewAll, gap }: {
  id: string; title: string; products: Product[]; viewAll?: string; gap: string;
}) {
  const { business, products: all } = useStorefront();
  const [lead, ...rest] = products;
  if (!lead) return null;
  const href = productPaths(all).get(lead.id);
  return (
    <section id={id} className={`site-gutter scroll-mt-36 ${gap}`} aria-labelledby={`${id}-heading`}>
      <div className="flex items-end justify-between gap-3">
        <h2 id={`${id}-heading`} className="display-md">{title}</h2>
        {viewAll && (
          <a href={viewAll} className="inline-flex shrink-0 items-center gap-1 text-sm font-medium text-ember hover:underline">
            View all <ArrowRight size={14} aria-hidden />
          </a>
        )}
      </div>
      <div className="mt-4 grid gap-3 sm:gap-4 lg:grid-cols-2">
        <article className="relative grid overflow-hidden rounded-xl border border-line bg-white sm:grid-cols-2 lg:grid-cols-1 lg:grid-rows-[1fr_auto]">
          <a href={href} tabIndex={-1} aria-hidden className="relative block aspect-square bg-shell sm:aspect-auto sm:min-h-full lg:aspect-auto lg:min-h-[16rem]">
            <span className="absolute inset-0 p-[var(--img-pad-lg,0.75rem)]"><ProductImage product={lead} width={720} fit="brand" /></span>
            <OfferRibbon product={lead} className="absolute left-3 top-3" />
          </a>
          <div className="flex flex-col p-4 sm:p-6">
            <p className="eyebrow capitalize">{lead.category}</p>
            <h3 className="mt-1 font-display text-xl leading-tight first-letter:uppercase sm:text-2xl">
              <a href={href} className="hover:text-ember">{lead.name}</a>
            </h3>
            {lead.description && <p className="mt-2 line-clamp-4 text-sm leading-relaxed text-muted">{lead.description}</p>}
            <div className="mt-4"><PriceLine product={lead} currency={business.currency} large /></div>
            <p className="text-xs text-muted">per {perUnit(lead.unit)}</p>
            <div className="mt-4 grid gap-2 sm:mt-auto sm:pt-5 lg:grid-cols-2">
              {lead.inStock ? <CartStepper product={lead} size="lg" /> : <p className="text-sm font-medium text-muted">Sold out</p>}
              <a href={href} className="btn btn-secondary">See details</a>
            </div>
          </div>
        </article>
        {rest.length > 0 && (
          <ul className="grid grid-cols-2 gap-2.5 sm:gap-4">
            {rest.slice(0, 4).map((p) => <ProductCard key={p.id} product={p} />)}
          </ul>
        )}
      </div>
    </section>
  );
}

/** "3 weeks ago", for people; the exact date is in the title. */
function sinceText(iso: string): string {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (!Number.isFinite(days) || days < 0) return '';
  if (days < 1) return 'Today';
  if (days < 2) return 'Yesterday';
  if (days < 14) return `${days} days ago`;
  if (days < 60) return `${Math.floor(days / 7)} weeks ago`;
  if (days < 730) return `${Math.floor(days / 30)} months ago`;
  return `${Math.floor(days / 365)} years ago`;
}

/** The best reviews to show: 4 stars or more, with something to say, featured first. */
function usePicks(reviews: Review[], max: number) {
  return useMemo(
    () => [...reviews].filter((r) => r.rating >= 4 && r.body.length >= 20)
      .sort((a, b) => Number(b.featured) - Number(a.featured) || b.rating - a.rating || b.createdAt.localeCompare(a.createdAt))
      .slice(0, max),
    [reviews, max],
  );
}

function ReviewsHeading({ title, reviews, center = false }: { title: string; reviews: Review[]; center?: boolean }) {
  const { count, average } = reviewStats(reviews);
  return (
    <div className={center ? 'flex flex-col items-center gap-2 text-center' : 'flex flex-wrap items-end justify-between gap-x-4 gap-y-2'}>
      <h2 id="testimonials-heading" className="display-lg">{title}</h2>
      {count > 0 && (
        <p className="flex flex-wrap items-center gap-2 text-sm text-muted">
          <Stars rating={average} size={15} />
          <span><strong className="font-medium text-ink">{average.toFixed(1)}</strong> from {count} {count === 1 ? 'review' : 'reviews'}</span>
          <a href="/reviews" className="inline-flex min-h-10 items-center font-medium text-ember hover:underline">See all</a>
        </p>
      )}
    </div>
  );
}

/** Customer cards: initials, name, when, stars, the words, what they bought and the shop's reply. */
export function CustomerCards({ title, gap, fallback }: { title: string; gap: string; fallback: ReactNode }) {
  const { reviews = [], products } = useStorefront();
  const picks = usePicks(reviews, 6);
  if (picks.length === 0) return <>{fallback}</>;
  const paths = productPaths(products);
  return (
    <section className={`site-gutter ${gap}`} aria-labelledby="testimonials-heading">
      <ReviewsHeading title={title} reviews={reviews} />
      <ul className="no-scrollbar -mx-4 mt-5 flex snap-x snap-mandatory gap-3 overflow-x-auto scroll-px-4 px-4 pb-2 sm:mx-0 sm:mt-6 sm:grid sm:grid-cols-2 sm:gap-4 sm:overflow-visible sm:px-0 lg:grid-cols-3">
        {picks.map((r) => {
          const product = r.productId ? products.find((p) => p.id === r.productId) : undefined;
          return (
            <li key={r.id} className="w-[84vw] max-w-sm shrink-0 snap-start sm:w-auto sm:max-w-none">
              <figure className="flex h-full flex-col rounded-xl border border-line bg-white p-4 sm:p-5">
                <figcaption className="flex items-center gap-3">
                  <span className={`grid size-11 shrink-0 place-items-center rounded-full font-display text-lg font-semibold uppercase text-ink/70 ${tintFor(r.name)}`} aria-hidden>
                    {r.name.trim().charAt(0) || '?'}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{r.name}</span>
                    <span className="flex flex-wrap items-center gap-x-2 text-xs text-muted">
                      <time dateTime={r.createdAt} title={new Date(r.createdAt).toDateString()}>{sinceText(r.createdAt)}</time>
                      {r.verified && <span className="inline-flex items-center gap-1 text-leaf"><BadgeCheck size={13} aria-hidden /> Verified buyer</span>}
                    </span>
                  </span>
                </figcaption>
                <Stars rating={r.rating} size={15} className="mt-3" />
                <blockquote className="mt-2 flex-1 text-sm leading-relaxed sm:text-[0.9375rem]">
                  {r.title && <p className="font-medium">{r.title}</p>}
                  <p className="line-clamp-5 text-ink/85">{r.body}</p>
                </blockquote>
                {product && (
                  <a href={paths.get(product.id)} className="mt-4 flex items-center gap-2.5 rounded-lg bg-shell p-2 text-sm hover:bg-sand">
                    <span className="block size-10 shrink-0 overflow-hidden rounded-md bg-white"><ProductImage product={product} width={120} fit="brand" /></span>
                    <span className="min-w-0 flex-1 truncate first-letter:uppercase">{product.name}</span>
                    <ArrowRight size={14} className="shrink-0 text-muted" aria-hidden />
                  </a>
                )}
                {r.reply && (
                  <p className="mt-3 flex gap-2 border-l-2 border-ember/40 pl-3 text-xs text-muted">
                    <MessageSquareReply size={14} className="mt-0.5 shrink-0" aria-hidden />
                    <span className="line-clamp-3"><span className="font-medium text-ink">Reply: </span>{r.reply}</span>
                  </p>
                )}
              </figure>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

const QUOTE_MS = 8000;

/** One quote at a time, large, with arrows and dots. Moves on by itself unless the visitor prefers less motion. */
export function QuoteSlider({ title, gap, fallback }: { title: string; gap: string; fallback: ReactNode }) {
  const { reviews = [] } = useStorefront();
  const picks = usePicks(reviews, 6);
  const [raw, setActive] = useState(0);
  const [paused, setPaused] = useState(reducedMotion);
  const count = picks.length;
  const active = count ? raw % count : 0;
  useEffect(() => {
    if (paused || count < 2) return;
    const t = setTimeout(() => { if (!document.hidden) setActive((i) => (i + 1) % count); }, QUOTE_MS);
    return () => clearTimeout(t);
  }, [active, paused, count]);
  if (count === 0) return <>{fallback}</>;
  const go = (step: number) => { setPaused(true); setActive((active + step + count) % count); };
  const r = picks[active];
  const arrow = 'grid size-10 place-items-center rounded-full border border-line bg-white text-ink transition hover:border-ember hover:bg-ember hover:text-white';
  return (
    <section className={`site-gutter ${gap}`} aria-labelledby="testimonials-heading" aria-roledescription="carousel">
      <ReviewsHeading title={title} reviews={reviews} center />
      <div className="soft-panel relative mx-auto mt-6 max-w-4xl rounded-2xl px-5 py-8 text-center sm:mt-8 sm:px-14 sm:py-12">
        <Quote size={36} className="mx-auto text-ember/35" aria-hidden />
        <figure key={r.id} aria-live={paused ? 'polite' : 'off'} className="animate-[page-enter_400ms_ease-out] motion-reduce:animate-none">
          <blockquote className="mt-3 font-display text-lg leading-snug sm:text-2xl lg:text-[1.75rem]">
            {r.title && <p className="mb-2 font-semibold">{r.title}</p>}
            <p className="line-clamp-6">“{r.body}”</p>
          </blockquote>
          <figcaption className="mt-5 flex flex-col items-center gap-1 text-sm">
            <Stars rating={r.rating} size={15} />
            <span className="font-medium">{r.name}</span>
            {r.verified && <span className="inline-flex items-center gap-1 text-xs text-leaf"><BadgeCheck size={13} aria-hidden /> Verified buyer</span>}
          </figcaption>
        </figure>
        {count > 1 && (
          <div className="mt-6 flex items-center justify-center gap-3">
            <button type="button" onClick={() => go(-1)} aria-label="Previous review" className={arrow}><ChevronLeft size={18} aria-hidden /></button>
            <div className="flex items-center">
              {picks.map((p, i) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => { setPaused(true); setActive(i); }}
                  aria-label={`Review ${i + 1} of ${count}`}
                  aria-current={i === active}
                  className="grid size-6 place-items-center"
                >
                  <span className={`block h-2 rounded-full transition-all ${i === active ? 'w-5 bg-ember' : 'w-2 bg-ink/20'}`} />
                </button>
              ))}
            </div>
            <button type="button" onClick={() => go(1)} aria-label="Next review" className={arrow}><ChevronRight size={18} aria-hidden /></button>
          </div>
        )}
      </div>
    </section>
  );
}
