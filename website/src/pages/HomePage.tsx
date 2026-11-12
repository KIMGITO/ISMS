import { TouchEvent, useCallback, useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowRight, ChevronLeft, ChevronRight, ShoppingCart, Tag } from 'lucide-react';
import { Product } from '../api';
import { pointsOn } from '../points';
import { PHOTOS, photoUrl, productPhoto } from '../images';
import { useRecent, useStorefront } from '../store';
import { HERO_DRAW_ORDER, HeroBox, heroBoxes, heroBoxStyle, safeHref, visibleHeroSlides } from '../heroSlides';
import { formatDate, promotionLabel, Reveal, RevealList, SectionHeader, TrustStrip } from '../ui';
import { Testimonials } from './Reviews';
import ProductCard from './ProductCard';
import { ArticleCard } from './ArticlesPage';

const SLIDE_MS = 7000;

const prefersReducedMotion = () =>
  typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Product pictures placed like a shop-window display: the main product with up to two smaller
 * ones beside and in front. Best with cut-outs (background removed in the app's uploader).
 */
function ProductDisplay({ images, positions, title, eager }: { images: string[]; positions?: HeroBox[]; title: string; eager: boolean }) {
  const boxes = heroBoxes(images.length, positions);
  return (
    <div className="relative mx-auto aspect-square w-full max-w-[10rem] min-[400px]:max-w-[11rem] sm:max-w-[19rem] lg:max-w-[24rem]">
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
            return (
              <div
                key={slide.id || index}
                role="group"
                aria-roledescription="slide"
                aria-label={`${index + 1} of ${count}`}
                aria-hidden={!isActive}
                {...({ inert: !isActive } as object)}
                className="grid w-full shrink-0 grid-cols-[1.2fr_1fr] items-center gap-3 px-4 pb-11 pt-6 sm:gap-6 sm:px-16 sm:pb-16 sm:pt-12 md:grid-cols-[1.15fr_1fr] lg:px-20 lg:pb-20 lg:pt-14"
              >
                <div>
                  <Heading className="display-xl max-w-[18ch] max-sm:text-[1.3125rem] max-sm:leading-tight">{slide.title}</Heading>
                  {slide.body?.trim() && <p className="mt-1.5 text-xs text-muted sm:mt-3 sm:text-[0.9375rem]">{slide.body}</p>}
                  {slide.ctaLabel?.trim() && (
                    <a href={safeHref(slide.ctaHref)} className="btn btn-primary mt-3.5 max-sm:min-h-9 max-sm:px-3.5 max-sm:text-xs sm:mt-7">
                      {slide.ctaLabel} <ShoppingCart size={16} aria-hidden />
                    </a>
                  )}
                </div>
                <ProductDisplay images={slide.images} positions={slide.positions} title={slide.title} eager={index === 0} />
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
    <section className="site-gutter pt-8" aria-label="Offers">
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

// Three across even on phones, like a shop shelf; six on wide screens.
const productGrid = 'grid grid-cols-3 gap-2 sm:gap-4 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6';

function ProductSection({ id, title, subtitle, products, link }: { id: string; title: string; subtitle: string; products: Product[]; link?: boolean }) {
  return (
    <section id={id} className="site-gutter scroll-mt-32 pt-12 sm:pt-16" aria-labelledby={`${id}-heading`}>
      <Reveal><SectionHeader center id={`${id}-heading`} title={title} subtitle={subtitle} /></Reveal>
      <RevealList className={`mt-6 sm:mt-8 ${productGrid}`}>
        {products.map((product) => <ProductCard key={product.id} product={product} />)}
      </RevealList>
      {link && (
        <div className="mt-6 text-center">
          <a href="/shop" className="btn btn-secondary">View all products <ArrowRight size={15} aria-hidden /></a>
        </div>
      )}
    </section>
  );
}

/** The wide two-part banner between product rows: brand colour on the left, photo cut on a slant. */
function PromoBanner() {
  const halves = [
    { kicker: '100%', title: 'Natural', body: 'Pure farm milk', photo: PHOTOS.pour, bg: 'bg-[#f3b04a]', href: '/shop' },
    { kicker: 'Fresh', title: 'Every day', body: 'Yoghurt, butter and more', photo: PHOTOS.yoghurt, bg: 'bg-[#f6cf7d]', href: '/shop' },
  ];
  return (
    <section className="site-gutter pt-12 sm:pt-16" aria-label="Featured">
      <Reveal className="grid grid-cols-2 overflow-hidden rounded-xl">
        {halves.map((half) => (
          <a key={half.title} href={half.href} className={`group relative flex h-24 items-center overflow-hidden sm:h-44 ${half.bg}`}>
            <img
              src={photoUrl(half.photo, 700, 400)}
              alt=""
              loading="lazy"
              className="absolute inset-y-0 right-0 h-full w-1/2 object-cover sm:w-[58%] transition duration-700 [clip-path:polygon(22%_0,100%_0,100%_100%,0_100%)] group-hover:scale-105"
            />
            <span className="relative z-10 pl-3 sm:pl-10">
              <span className="block text-[0.625rem] font-medium text-brand-deep sm:text-sm">{half.kicker}</span>
              <span className="block text-base font-semibold leading-tight text-ember sm:text-4xl">{half.title}</span>
              <span className="mt-0.5 hidden text-sm text-ink/70 sm:block">{half.body}</span>
            </span>
            <span className="absolute bottom-2 right-2 z-10 rounded-full bg-white/95 px-2 py-0.5 text-[0.625rem] font-medium text-ink shadow-soft sm:bottom-5 sm:right-6 sm:px-3 sm:py-1 sm:text-sm">
              Shop now
            </span>
          </a>
        ))}
      </Reveal>
    </section>
  );
}

/** Three photo-backed cards: the biggest categories, topped up with regular orders and rewards. */
function CategoryBanners() {
  const { products, loyalty } = useStorefront();
  const counts = new Map<string, number>();
  for (const p of products) counts.set(p.category, (counts.get(p.category) ?? 0) + 1);
  const fromCategories = Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([category, count]) => ({
      kicker: `${count} ${count === 1 ? 'product' : 'products'}`,
      title: category,
      href: `/shop?category=${encodeURIComponent(category)}`,
      photo: productPhoto(category),
      cta: 'Order now',
    }));
  const extras = [
    { kicker: 'Every week', title: 'Regular orders', href: '/account/schedules', photo: PHOTOS.pour, cta: 'Set up' },
    ...(pointsOn({ loyalty })
      ? [{ kicker: `${loyalty?.pointsPerShilling ?? 2} points per shilling`, title: 'Rewards', href: '/account/rewards', photo: PHOTOS.butter, cta: 'My points' }]
      : []),
    { kicker: 'Milk care', title: 'Guides', href: '/articles', photo: PHOTOS.bottleTray, cta: 'Read' },
  ];
  const cards = [...fromCategories, ...extras].slice(0, 3);
  const looks = [
    { bg: 'bg-[#f6d27a]', fade: 'from-[#f6d27a]', text: 'text-ink', button: 'btn-dark' },
    { bg: 'bg-hero', fade: 'from-hero', text: 'text-cream', button: 'btn-primary' },
    { bg: 'bg-[#f2b27c]', fade: 'from-[#f2b27c]', text: 'text-ink', button: 'btn-dark' },
  ];

  return (
    <section className="site-gutter pt-12 sm:pt-16" aria-label="Browse">
      <RevealList className="grid gap-3 sm:gap-5 md:grid-cols-3">
        {cards.map((card, index) => {
          const look = looks[index];
          return (
            <li key={card.title}>
              <a href={card.href} className={`group relative flex h-28 overflow-hidden rounded-xl sm:h-52 ${look.bg} ${look.text}`}>
                <img
                  src={photoUrl(card.photo, 600, 420)}
                  alt=""
                  loading="lazy"
                  className="absolute inset-y-0 right-0 h-full w-2/3 object-cover transition duration-700 group-hover:scale-105"
                />
                <span className={`absolute inset-y-0 left-0 w-2/3 bg-gradient-to-r ${look.fade} from-45% to-transparent`} aria-hidden />
                <span className="relative z-10 flex flex-col p-3.5 sm:p-5">
                  <span className="text-xs font-medium text-ember">{card.kicker}</span>
                  <span className="mt-0.5 text-lg font-medium capitalize leading-tight sm:text-xl">{card.title}</span>
                  <span className={`btn btn-sm mt-auto w-fit ${look.button}`}>{card.cta}</span>
                </span>
              </a>
            </li>
          );
        })}
      </RevealList>
    </section>
  );
}

export default function HomePage() {
  const site = useStorefront();
  const { products, articles, reviews = [] } = site;
  const recentIds = useRecent((s) => s.ids);

  const popular = [...products].sort((a, b) => Number(b.inStock) - Number(a.inStock)).slice(0, 12);
  const reviewCount = (id: string) => reviews.filter((r) => r.productId === id).length;
  const bestSellers = products.length > 6
    ? products.filter((p) => p.inStock).sort((a, b) => reviewCount(b.id) - reviewCount(a.id)).slice(0, 6)
    : [];
  const recent = recentIds.map((id) => products.find((p) => p.id === id)).filter((p) => p !== undefined).slice(0, 6);

  return (
    <>
      <Hero />
      <Promotions />
      {popular.length > 0 && (
        <ProductSection
          id="popular"
          title="Popular Products"
          subtitle="Fresh from our dairy and ready to order today."
          products={popular}
          link={products.length > popular.length}
        />
      )}
      <PromoBanner />
      {bestSellers.length > 0 && (
        <ProductSection id="best" title="Best Sellers" subtitle="The products our customers order most." products={bestSellers} />
      )}
      <CategoryBanners />
      <div className="site-gutter pt-12 sm:pt-16"><TrustStrip site={site} /></div>
      <Testimonials />
      {recent.length > 0 && (
        <ProductSection id="recent" title="Recently Viewed" subtitle="Pick up where you left off." products={recent} />
      )}
      {articles.length > 0 && (
        <section className="site-gutter pt-12 sm:pt-16" aria-labelledby="guides-heading">
          <Reveal><SectionHeader center id="guides-heading" title="Milk Guides" subtitle="How to store, handle and enjoy your milk." /></Reveal>
          <RevealList className="no-scrollbar -mx-4 mt-6 flex snap-x gap-3 overflow-x-auto px-4 pb-1 sm:mx-0 sm:mt-8 sm:grid sm:grid-cols-2 sm:gap-5 sm:overflow-visible sm:px-0 lg:grid-cols-3 max-sm:[&>li]:w-[78vw] max-sm:[&>li]:max-w-xs max-sm:[&>li]:shrink-0 max-sm:[&>li]:snap-start">
            {articles.slice(0, 3).map((article) => <ArticleCard key={article.id} article={article} />)}
          </RevealList>
        </section>
      )}
    </>
  );
}
