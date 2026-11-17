import { TouchEvent, useCallback, useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowRight, ChevronLeft, ChevronRight, ShoppingCart, Tag } from 'lucide-react';
import { Product } from '../api';
import { AdCard, AD_TONES, visibleAdCards } from '../adCards';
import { photoUrl, productPhoto } from '../images';
import { useRecent, useStorefront } from '../store';
import { HeroSlide, heroLayout, safeHref, visibleHeroSlides } from '../heroSlides';
import { formatDate, ProductDisplay, promotionLabel, Reveal, RevealList, SectionHeader, TrustStrip } from '../ui';
import { OrderAnyWayBand } from './PageEnd';
import { Testimonials } from './Reviews';
import ProductCarousel from './ProductCarousel';
import { ArticleCard } from './ArticlesPage';

const SLIDE_MS = 7000;

const prefersReducedMotion = () =>
  typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Class names for one slide's arrangement, written out in full so Tailwind finds them.
 * Phones (under 640px) follow `phone`; wider screens put the pictures on `side`.
 */
function slideClasses(slide: HeroSlide) {
  const { phone, side } = heroLayout(slide);
  const beside = phone === 'beside';
  const grid = [
    'grid w-full shrink-0 items-center gap-3 px-4 pb-11 pt-6 sm:gap-6 sm:px-16 sm:pb-16 sm:pt-12 lg:px-20 lg:pb-20 lg:pt-14',
    beside ? 'grid-cols-[1.2fr_1fr]' : 'grid-cols-1',
    side === 'left' ? 'sm:grid-cols-[1fr_1.2fr] md:grid-cols-[1fr_1.15fr]' : 'sm:grid-cols-[1.2fr_1fr] md:grid-cols-[1.15fr_1fr]',
  ].join(' ');
  // Stacked on a phone: the words are centred under or over the pictures.
  const text = beside || phone === 'none' ? '' : 'max-sm:text-center';
  const title = beside || phone === 'none' ? '' : 'max-sm:mx-auto';
  const picture = [
    phone === 'none' ? 'max-sm:hidden' : '',
    phone === 'above' ? 'max-sm:-order-1' : '',
    side === 'left' ? 'sm:-order-1' : '',
    beside ? 'max-w-[10rem] min-[400px]:max-w-[11rem]' : 'max-w-[12rem] min-[400px]:max-w-[14rem]',
    'sm:max-w-[19rem] lg:max-w-[24rem]',
  ].join(' ');
  return { grid, text, title, picture };
}

/**
 * The opening slider: a soft sand panel, a short headline and one button, a product display on the
 * right, arrows on wide screens (swipe on phones), and a round button in a notch that jumps to the products.
 * Slides come from Online Store > Home banner in the app, or the built-in ones (heroSlides.ts).
 */
function Hero() {
  const { articles, heroSlides } = useStorefront();
  const slides = visibleHeroSlides(heroSlides, articles.length > 0);
  const count = slides.length;
  const [rawActive, setActive] = useState(0);
  // Saved slides can arrive after the built-in ones, so the position is kept inside the new count.
  const active = count > 0 ? rawActive % count : 0;
  const [paused, setPaused] = useState(prefersReducedMotion);
  const touchStart = useRef<number | null>(null);

  const goTo = useCallback((index: number) => setActive((index + count) % count), [count]);

  useEffect(() => {
    if (paused || count < 2) return;
    const timer = setTimeout(() => { if (!document.hidden) goTo(active + 1); }, SLIDE_MS);
    return () => clearTimeout(timer);
  }, [active, paused, count, goTo]);

  const onTouchEnd = (e: TouchEvent) => {
    if (touchStart.current === null) return;
    const distance = e.changedTouches[0].clientX - touchStart.current;
    touchStart.current = null;
    if (count > 1 && Math.abs(distance) > 45) goTo(active + (distance < 0 ? 1 : -1));
  };

  const arrow = 'absolute top-1/2 z-10 hidden size-9 -translate-y-1/2 place-items-center rounded-full bg-white text-ink shadow-soft transition hover:bg-ember hover:text-white sm:grid';

  return (
    <section className="site-gutter pt-3 sm:pt-6" aria-roledescription="carousel" aria-label="Welcome">
      <div className="relative pb-7 sm:pb-9">
        <div
          className="soft-panel relative touch-pan-y overflow-hidden rounded-2xl"
          // Only a real mouse pauses it: a tap on a phone would otherwise pause it for good.
          onPointerEnter={(e) => { if (e.pointerType === 'mouse') setPaused(true); }}
          onPointerLeave={(e) => { if (e.pointerType === 'mouse') setPaused(prefersReducedMotion()); }}
          onTouchStart={(e) => { touchStart.current = e.touches[0].clientX; }}
          onTouchEnd={onTouchEnd}
        >
          {/* The slides sit side by side on a track that slides left, so the hero visibly moves. */}
          <div
            className="flex transition-transform duration-700 ease-[cubic-bezier(0.2,0.7,0.2,1)] motion-reduce:transition-none"
            style={{ transform: `translateX(-${active * 100}%)` }}
          >
          {slides.map((slide, index) => {
            const isActive = index === active;
            const Heading = index === 0 ? 'h1' : 'h2';
            const layout = slideClasses(slide);
            const { tone } = heroLayout(slide);
            return (
              <div
                key={slide.id || index}
                role="group"
                aria-roledescription="slide"
                aria-label={`${index + 1} of ${count}`}
                aria-hidden={!isActive}
                {...({ inert: !isActive } as object)}
                className={layout.grid}
                // A chosen colour covers the sand panel for this slide only.
                style={tone ? { background: tone.bg, color: tone.text } : undefined}
              >
                <div className={layout.text}>
                  <Heading className={`display-xl max-w-[18ch] max-sm:text-[1.3125rem] max-sm:leading-tight ${layout.title}`}>{slide.title}</Heading>
                  {slide.body?.trim() && (
                    <p className={`mt-1.5 text-xs sm:mt-3 sm:text-[0.9375rem] ${tone ? 'opacity-80' : 'text-muted'}`}>{slide.body}</p>
                  )}
                  {slide.ctaLabel?.trim() && (
                    <a
                      href={safeHref(slide.ctaHref)}
                      className="btn btn-primary mt-3.5 max-sm:min-h-9 max-sm:px-3.5 max-sm:text-xs sm:mt-7"
                      style={tone ? { background: tone.button, borderColor: tone.button, color: tone.buttonText } : undefined}
                    >
                      {slide.ctaLabel} <ShoppingCart size={16} aria-hidden />
                    </a>
                  )}
                </div>
                <ProductDisplay images={slide.images} positions={slide.positions} title={slide.title} eager={index === 0} className={layout.picture} />
              </div>
            );
          })}
          </div>

          {count > 1 && (
            <>
              <button onClick={() => goTo(active - 1)} aria-label="Previous slide" className={`${arrow} left-3 lg:left-5`}>
                <ChevronLeft size={18} aria-hidden />
              </button>
              <button onClick={() => goTo(active + 1)} aria-label="Next slide" className={`${arrow} right-3 lg:right-5`}>
                <ChevronRight size={18} aria-hidden />
              </button>
            </>
          )}
        </div>

        {/* The notch: a page-coloured circle biting into the panel, holding the jump button. */}
        <div className="absolute bottom-0 left-1/2 grid size-[4.5rem] -translate-x-1/2 place-items-center rounded-full bg-cream sm:size-[5.5rem]">
          <a href="#popular" aria-label="Jump to products" className="grid size-11 place-items-center rounded-full bg-ember text-white shadow-soft transition hover:bg-brand-deep sm:size-14">
            <ArrowDown size={20} aria-hidden />
          </a>
        </div>
      </div>
    </section>
  );
}

/** Promo codes staff chose to show on the website. Nothing shows when there are none. */
function Promotions() {
  const { promotions = [], business } = useStorefront();
  if (promotions.length === 0) return null;
  return (
    <section className="site-gutter pt-6 sm:pt-8" aria-label="Promo codes">
      <ul className="grid gap-3 md:grid-cols-2">
        {promotions.slice(0, 4).map((promo) => (
          <li key={promo.code} className="flex items-center gap-3 rounded-lg border border-dashed border-ember/50 bg-amber-50 p-3.5 sm:gap-4 sm:p-4">
            <span className="grid size-10 shrink-0 place-items-center rounded-full bg-white text-ember"><Tag size={18} aria-hidden /></span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium leading-snug sm:text-[0.9375rem]">{promotionLabel(promo, business.currency)}</p>
              <p className="truncate text-xs text-muted">
                {promo.endsAt ? `Ends ${formatDate(promo.endsAt)}` : promo.description || 'Use the code at checkout'}
              </p>
            </div>
            <span className="shrink-0 rounded-md bg-white px-2.5 py-1 font-mono text-sm font-semibold tracking-wider ring-1 ring-line">{promo.code}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Each category's picture: its first product with a photo, or a matching stock photo. */
function categoryImage(category: string, products: Product[]): { src: string; contain: boolean } {
  const withImage = products.find((p) => p.category === category && p.image);
  if (withImage?.image) return { src: withImage.image, contain: true };
  return { src: photoUrl(productPhoto(category), 240, 240), contain: false };
}

/** "Shop by category": round pictures in a row, the biggest categories first. Swipes on phones. */
function CategoryCircles() {
  const { products } = useStorefront();
  const counts = new Map<string, number>();
  for (const p of products) counts.set(p.category, (counts.get(p.category) ?? 0) + 1);
  const categories = Array.from(counts.entries()).sort((a, b) => b[1] - a[1]).map(([c]) => c).slice(0, 8);
  if (categories.length < 2) return null;
  return (
    <section className="site-gutter pt-8 sm:pt-10" aria-labelledby="categories-heading">
      <h2 id="categories-heading" className="display-md text-center font-semibold">Top Picks by Category</h2>
      <ul className="no-scrollbar -mx-4 mt-5 flex snap-x gap-4 overflow-x-auto scroll-px-4 px-4 pb-1 sm:mx-0 sm:justify-center sm:gap-6 sm:scroll-px-0 sm:px-0 lg:gap-8">
        {categories.map((category) => {
          const image = categoryImage(category, products);
          return (
            <li key={category} className="shrink-0 snap-start">
              <a href={`/shop?category=${encodeURIComponent(category)}`} className="flex w-[4.625rem] flex-col items-center gap-2 text-center lg:w-[7.5rem]">
                <span className="category-circle">
                  <img src={image.src} alt="" loading="lazy" className={`size-full ${image.contain ? 'object-contain p-2 lg:p-3' : 'object-cover'}`} />
                </span>
                <span className="line-clamp-2 text-xs font-medium capitalize leading-snug sm:text-sm">{category}</span>
              </a>
            </li>
          );
        })}
      </ul>
      <p className="mt-3 text-center">
        <a href="/shop" className="inline-flex min-h-10 items-center gap-1 text-sm font-medium text-ember hover:underline">
          View all categories <ArrowRight size={14} aria-hidden />
        </a>
      </p>
    </section>
  );
}

/** One advert: brand colour panel, short text and a pill on the left, a picture on the right. */
function AdPoster({ card }: { card: AdCard }) {
  const tone = AD_TONES[card.tone ?? 'cream'];
  return (
    <a
      href={safeHref(card.href)}
      className="group relative flex aspect-[4/3] overflow-hidden rounded-xl sm:aspect-[4/3]"
      style={{ background: tone.bg, color: tone.text }}
    >
      {card.image && (
        <img
          src={card.image}
          alt=""
          loading="lazy"
          className="absolute bottom-0 right-0 h-[78%] w-[52%] object-contain object-bottom drop-shadow-[0_12px_14px_rgba(35,22,14,0.25)] transition duration-700 group-hover:scale-105"
        />
      )}
      <span className="relative z-10 flex w-[62%] flex-col p-4 sm:p-5 lg:p-6">
        {card.kicker && <span className="text-xs font-semibold sm:text-sm" style={{ color: tone.kicker }}>{card.kicker}</span>}
        <span className="mt-1 text-lg font-semibold leading-tight sm:text-xl lg:text-2xl">{card.title}</span>
        {card.body && <span className="mt-1.5 line-clamp-3 text-xs opacity-80 sm:text-sm">{card.body}</span>}
        {card.ctaLabel && (
          <span className="mt-auto inline-flex w-fit items-center gap-1 rounded-full px-3.5 py-1.5 text-xs font-semibold sm:text-sm" style={{ background: tone.button, color: tone.buttonText }}>
            {card.ctaLabel} <ArrowRight size={13} aria-hidden />
          </span>
        )}
      </span>
    </a>
  );
}

/** The thin full-width offer bar between sections. */
function AdStrip({ card }: { card: AdCard }) {
  const tone = AD_TONES[card.tone ?? 'ember'];
  return (
    <a
      href={safeHref(card.href)}
      className="flex min-h-14 items-center gap-3 overflow-hidden rounded-xl px-4 py-2.5 sm:min-h-16 sm:px-6"
      style={{ background: tone.bg, color: tone.text }}
    >
      <Tag size={18} className="shrink-0" aria-hidden style={{ color: tone.kicker }} />
      <span className="min-w-0 flex-1 leading-tight">
        {card.kicker && <span className="mr-2 text-xs font-semibold max-sm:block sm:text-sm" style={{ color: tone.kicker }}>{card.kicker}</span>}
        <span className="text-sm font-semibold sm:text-base">{card.title}</span>
        {card.body && <span className="ml-2 hidden text-sm opacity-80 md:inline">{card.body}</span>}
      </span>
      {card.ctaLabel && (
        <span className="shrink-0 rounded-full px-3.5 py-1.5 text-xs font-semibold sm:text-sm" style={{ background: tone.button, color: tone.buttonText }}>
          {card.ctaLabel}
        </span>
      )}
    </a>
  );
}

function AdPosters({ cards }: { cards: AdCard[] }) {
  if (cards.length === 0) return null;
  return (
    <section className="site-gutter pt-8 sm:pt-10" aria-label="Offers and news">
      <ul className="poster-row -mx-4 scroll-px-4 px-4 sm:mx-0 sm:scroll-px-0 sm:px-0">
        {cards.map((card, index) => <li key={card.id || index}><AdPoster card={card} /></li>)}
      </ul>
    </section>
  );
}

export default function HomePage() {
  const site = useStorefront();
  const { products, articles, reviews = [] } = site;
  const recentIds = useRecent((s) => s.ids);
  const cards = visibleAdCards(site.adCards);
  const posters = cards.filter((c) => c.kind === 'poster').slice(0, 6);
  const strips = cards.filter((c) => c.kind === 'strip');

  const inStockFirst = (list: Product[]) => [...list].sort((a, b) => Number(b.inStock) - Number(a.inStock));
  const offers = inStockFirst(products.filter((p) => p.wasPrice && p.wasPrice > p.price)).slice(0, 12);
  const popular = inStockFirst(products).slice(0, 12);
  const reviewCount = (id: string) => reviews.filter((r) => r.productId === id).length;
  // Only products customers actually reviewed, most reviews first. Sales figures aren't public.
  const mostReviewed = products.length > 6
    ? products.filter((p) => p.inStock && reviewCount(p.id) > 0).sort((a, b) => reviewCount(b.id) - reviewCount(a.id)).slice(0, 12)
    : [];
  const recent = recentIds.map((id) => products.find((p) => p.id === id)).filter((p) => p !== undefined).slice(0, 12);

  // One row per bigger category, like the aisles of a shop.
  const counts = new Map<string, number>();
  for (const p of products) counts.set(p.category, (counts.get(p.category) ?? 0) + 1);
  const aisles = counts.size > 1
    ? Array.from(counts.entries()).filter(([, n]) => n >= 3).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([c]) => c)
    : [];

  return (
    <>
      <Hero />
      <CategoryCircles />
      <AdPosters cards={posters} />
      {strips[0] && <div className="site-gutter pt-6 sm:pt-8"><AdStrip card={strips[0]} /></div>}
      <Promotions />
      <ProductCarousel id="offers" title="Exclusive Offers" products={offers} viewAll="/shop?offers=1" />
      <ProductCarousel id="popular" title="Our Products" products={popular} viewAll={products.length > popular.length ? '/shop' : undefined} />
      <ProductCarousel id="best" title="Most Reviewed" products={mostReviewed} />
      {strips[1] && <div className="site-gutter pt-10 sm:pt-12"><AdStrip card={strips[1]} /></div>}
      {aisles.map((category) => (
        <ProductCarousel
          key={category}
          id={`aisle-${category.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`}
          title={category.replace(/^./, (c) => c.toUpperCase())}
          products={inStockFirst(products.filter((p) => p.category === category)).slice(0, 12)}
          viewAll={`/shop?category=${encodeURIComponent(category)}`}
        />
      ))}
      <div className="site-gutter pt-12 sm:pt-16"><TrustStrip site={site} /></div>
      <Testimonials />
      <ProductCarousel id="recent" title="Recently Viewed" products={recent} />
      {articles.length > 0 && (
        <section className="site-gutter pt-12 sm:pt-16" aria-labelledby="guides-heading">
          <Reveal><SectionHeader center id="guides-heading" title="Milk Guides" subtitle="How to store, handle and enjoy your milk." /></Reveal>
          <RevealList className="no-scrollbar -mx-4 mt-6 flex snap-x gap-3 overflow-x-auto px-4 pb-1 sm:mx-0 sm:mt-8 sm:grid sm:grid-cols-2 sm:gap-5 sm:overflow-visible sm:px-0 lg:grid-cols-3 max-sm:[&>li]:w-[78vw] max-sm:[&>li]:max-w-xs max-sm:[&>li]:shrink-0 max-sm:[&>li]:snap-start">
            {articles.slice(0, 3).map((article) => <ArticleCard key={article.id} article={article} />)}
          </RevealList>
        </section>
      )}
      <OrderAnyWayBand />
    </>
  );
}
