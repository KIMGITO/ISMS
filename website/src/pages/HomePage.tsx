import { Fragment, TouchEvent, useCallback, useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowRight, ChevronLeft, ChevronRight, ShoppingCart, Tag } from 'lucide-react';
import { Product } from '../api';
import { AdCard, AD_TONES, visibleAdCards } from '../adCards';
import { shopPictures } from '../shopPictures';
import { useRecent, useStorefront } from '../store';
import { HeroSlide, heroLayout, safeHref, visibleHeroSlides } from '../heroSlides';
import { formatDate, NoPicture, ProductDisplay, promotionLabel, Reveal, RevealList, SectionHeader, TrustStrip } from '../ui';
import { OrderAnyWayBand } from './PageEnd';
import { Testimonials } from './Reviews';
import ProductCarousel from './ProductCarousel';
import { ArticleCard } from './ArticlesPage';
import { CategoryChips, CategoryTiles, HeroStatement, ProductGrid, StorySection, VisitSection } from './HomeSections';
import { composeHome, ResolvedSection, SectionKind } from '../engine/layout';
import { presetFor } from '../engine/tokens';
import { HeroAds, PromoCards, VideoAds } from '../ads/AdSlots';

const SLIDE_MS = 7000;

const prefersReducedMotion = () =>
  typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Class names for one slide's arrangement, written out in full so Tailwind finds them.
 * Phones (under 640px) follow `phone`; wider screens put the pictures on `side`.
 */
function slideClasses(slide: HeroSlide) {
  const { phone, side } = heroLayout(slide);
  const pictures = slide.images.length > 0;
  const beside = pictures && phone === 'beside';
  // A slide without pictures (a shop with no product photos yet) is words only, across the panel.
  const grid = [
    'grid w-full shrink-0 items-center gap-3 px-4 pb-11 pt-6 sm:gap-6 sm:px-16 sm:pb-16 sm:pt-12 lg:px-20 lg:pb-20 lg:pt-14',
    beside ? 'grid-cols-[1.2fr_1fr]' : 'grid-cols-1',
    !pictures ? '' : side === 'left' ? 'sm:grid-cols-[1fr_1.2fr] md:grid-cols-[1fr_1.15fr]' : 'sm:grid-cols-[1.2fr_1fr] md:grid-cols-[1.15fr_1fr]',
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
  const { articles, heroSlides, products, brand } = useStorefront();
  const slides = visibleHeroSlides(heroSlides, articles.length > 0, shopPictures(products), brand?.industry);
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
                {slide.images.length > 0 && (
                  <ProductDisplay images={slide.images} positions={slide.positions} title={slide.title} eager={index === 0} className={layout.picture} />
                )}
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
function Promotions({ gap }: { gap: string }) {
  const { promotions = [], business } = useStorefront();
  if (promotions.length === 0) return null;
  return (
    <section className={`site-gutter ${gap}`} aria-label="Promo codes">
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

/** Each category's picture: its first product with a photo, or none. */
function categoryImage(category: string, products: Product[]): string | undefined {
  return products.find((p) => p.category === category && p.image)?.image ?? undefined;
}

/** "Shop by category": round pictures in a row, the biggest categories first. Swipes on phones. */
function CategoryCircles({ title, gap }: { title: string; gap: string }) {
  const { products } = useStorefront();
  const counts = new Map<string, number>();
  for (const p of products) counts.set(p.category, (counts.get(p.category) ?? 0) + 1);
  const categories = Array.from(counts.entries()).sort((a, b) => b[1] - a[1]).map(([c]) => c).slice(0, 8);
  if (categories.length < 2) return null;
  return (
    <section className={`site-gutter ${gap}`} aria-labelledby="categories-heading">
      <h2 id="categories-heading" className="display-md text-center font-semibold">{title}</h2>
      <ul className="no-scrollbar -mx-4 mt-5 flex snap-x gap-4 overflow-x-auto scroll-px-4 px-4 pb-1 sm:mx-0 sm:justify-center sm:gap-6 sm:scroll-px-0 sm:px-0 lg:gap-8">
        {categories.map((category) => {
          const image = categoryImage(category, products);
          return (
            <li key={category} className="shrink-0 snap-start">
              <a href={`/shop?category=${encodeURIComponent(category)}`} className="flex w-[4.625rem] flex-col items-center gap-2 text-center lg:w-[7.5rem]">
                <span className="category-circle">
                  {image
                    ? <img src={image} alt="" loading="lazy" className="size-full object-contain p-2 lg:p-3" />
                    : <NoPicture text={category} />}
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

function AdPosters({ cards, gap }: { cards: AdCard[]; gap: string }) {
  if (cards.length === 0) return null;
  return (
    <section className={`site-gutter ${gap}`} aria-label="Offers and news">
      <ul className="poster-row -mx-4 scroll-px-4 px-4 sm:mx-0 sm:scroll-px-0 sm:px-0">
        {cards.map((card, index) => <li key={card.id || index}><AdPoster card={card} /></li>)}
      </ul>
    </section>
  );
}

/** Space above each section on the original design: the exact classes it always had. */
const ORIGINAL_GAP: Partial<Record<SectionKind, string>> = {
  categories: 'pt-8 sm:pt-10', adverts: 'pt-8 sm:pt-10', strip: 'pt-6 sm:pt-8', promotions: 'pt-6 sm:pt-8',
  strip2: 'pt-10 sm:pt-12', trust: 'pt-12 sm:pt-16', testimonials: 'pt-12 sm:pt-16', guides: 'pt-12 sm:pt-16',
  contact: 'pt-12 sm:pt-16', story: 'pt-12 sm:pt-16', visit: 'pt-12 sm:pt-16',
};

/**
 * The home page, drawn from the layout engine: the shop's saved arrangement, or the one for its
 * industry and personality (engine/layout.ts). Sections with nothing to show draw nothing.
 */
export default function HomePage() {
  const site = useStorefront();
  const { products, articles, reviews = [], brand } = site;
  const recentIds = useRecent((s) => s.ids);
  const cards = visibleAdCards(site.adCards, shopPictures(products), brand?.industry);
  const posters = cards.filter((c) => c.kind === 'poster').slice(0, 6);
  const strips = cards.filter((c) => c.kind === 'strip');
  const original = presetFor(brand) === 'original';
  const sections = composeHome(brand, site.home);

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

  const draw = (section: ResolvedSection) => {
    const { kind, variant, title } = section;
    const legacyRow = 'pt-10 sm:pt-12';
    const gap = original ? ORIGINAL_GAP[kind] ?? legacyRow : section.gap === 'lg' ? 'section-gap-lg' : 'section-gap';
    const rows = (id: string, list: Product[], viewAll?: string) => variant === 'grid'
      ? <ProductGrid key={id} id={id} title={title} products={list} viewAll={viewAll} gap={gap} />
      : <ProductCarousel key={id} id={id} title={title} products={list} viewAll={viewAll} gap={gap} />;
    switch (kind) {
      case 'hero': return variant === 'carousel' ? <Hero key={kind} /> : <HeroStatement key={kind} variant={variant} />;
      case 'categories':
        if (variant === 'tiles') return <CategoryTiles key={kind} title={title} gap={gap} />;
        if (variant === 'chips') return <CategoryChips key={kind} title={title} gap={gap} />;
        return <CategoryCircles key={kind} title={title} gap={gap} />;
      case 'adverts': return <AdPosters key={kind} cards={posters} gap={gap} />;
      case 'strip': return strips[0] ? <div key={kind} className={`site-gutter ${gap}`}><AdStrip card={strips[0]} /></div> : null;
      case 'strip2': return strips[1] ? <div key={kind} className={`site-gutter ${gap}`}><AdStrip card={strips[1]} /></div> : null;
      case 'promotions': return <Promotions key={kind} gap={gap} />;
      case 'offers': return rows('offers', offers, '/shop?offers=1');
      case 'products': return rows('popular', popular, products.length > popular.length ? '/shop' : undefined);
      case 'reviewed': return rows('best', mostReviewed);
      case 'recent': return rows('recent', recent);
      case 'aisles':
        return aisles.map((category) => {
          const id = `aisle-${category.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
          const list = inStockFirst(products.filter((p) => p.category === category)).slice(0, 12);
          const heading = category.replace(/^./, (c) => c.toUpperCase());
          const viewAll = `/shop?category=${encodeURIComponent(category)}`;
          return variant === 'grid'
            ? <ProductGrid key={id} id={id} title={heading} products={list} viewAll={viewAll} gap={gap} max={4} />
            : <ProductCarousel key={id} id={id} title={heading} products={list} viewAll={viewAll} gap={gap} />;
        });
      case 'story': return <StorySection key={kind} variant={variant} title={title} gap={gap} />;
      case 'trust': return <div key={kind} className={`site-gutter ${gap}`}><TrustStrip site={site} /></div>;
      case 'testimonials': return <Testimonials key={kind} title={title} gap={gap} />;
      case 'guides':
        return articles.length > 0 && (
          <section key={kind} className={`site-gutter ${gap}`} aria-labelledby="guides-heading">
            <Reveal><SectionHeader center id="guides-heading" title={title} subtitle="Tips to get the most from what you buy." /></Reveal>
            <RevealList className="no-scrollbar -mx-4 mt-6 flex snap-x gap-3 overflow-x-auto px-4 pb-1 sm:mx-0 sm:mt-8 sm:grid sm:grid-cols-2 sm:gap-5 sm:overflow-visible sm:px-0 lg:grid-cols-3 max-sm:[&>li]:w-[78vw] max-sm:[&>li]:max-w-xs max-sm:[&>li]:shrink-0 max-sm:[&>li]:snap-start">
              {articles.slice(0, 3).map((article) => <ArticleCard key={article.id} article={article} />)}
            </RevealList>
          </section>
        );
      case 'visit': return <VisitSection key={kind} title={title} gap={gap} />;
      case 'contact': return <OrderAnyWayBand key={kind} gap={gap} title={title} track={brand?.industry !== 'professional_services'} />;
      default: return null;
    }
  };

  // Campaign adverts (Marketing, 20261207001): banners before the shop's own opening, cards after
  // the categories, a video after the first row of products. Each renders nothing when no
  // running campaign uses it, so the page is unchanged without campaigns.
  const find = (kinds: SectionKind[]) => sections.findIndex((s) => kinds.includes(s.kind));
  const cardsAfter = Math.max(find(['categories']), find(['hero']), 0);
  const videoAfter = (() => { const i = find(['products', 'offers', 'reviewed']); return i >= 0 ? i : sections.length - 1; })();
  return (
    <>
      <HeroAds />
      {sections.map((section, i) => (
        <Fragment key={`${section.kind}-${i}`}>
          {draw(section)}
          {i === cardsAfter && <PromoCards />}
          {i === videoAfter && <VideoAds />}
        </Fragment>
      ))}
      {sections.length === 0 && <><PromoCards /><VideoAds /></>}
    </>
  );
}
