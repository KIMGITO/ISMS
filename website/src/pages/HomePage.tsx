import { TouchEvent, useCallback, useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowRight, ChevronLeft, ChevronRight, ShoppingCart, Tag } from 'lucide-react';
import { Product } from '../api';
import { PHOTOS, photoUrl, productPhoto } from '../images';
import { useRecent, useStorefront } from '../store';
import { formatDate, promotionLabel, Reveal, RevealList, SectionHeader, TrustStrip } from '../ui';
import { Testimonials } from './Reviews';
import ProductCard from './ProductCard';
import { ArticleCard } from './ArticlesPage';

type Photo = Parameters<typeof photoUrl>[0];

const SLIDE_MS = 7000;

const prefersReducedMotion = () =>
  typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** The product photo in a large circle with two small circles beside it, like a cut-out product cluster. */
function PhotoCluster({ main, mainAlt, small }: { main: string; mainAlt: string; small: [Photo, Photo] }) {
  return (
    <div className="relative mx-auto aspect-square w-full max-w-[9.5rem] min-[400px]:max-w-[10.5rem] sm:max-w-[18rem] lg:max-w-[22rem]">
      <img src={main} alt={mainAlt} className="size-full rounded-full object-cover shadow-soft ring-[5px] ring-white sm:ring-[12px]" />
      <img
        src={photoUrl(small[0], 240, 240)}
        alt=""
        className="absolute -left-3 bottom-[8%] size-[32%] rounded-full object-cover shadow-soft ring-4 ring-white sm:-left-6 sm:ring-[6px]"
      />
      <img
        src={photoUrl(small[1], 200, 200)}
        alt=""
        className="absolute -right-2 top-[6%] size-[24%] rounded-full object-cover shadow-soft ring-4 ring-white sm:-right-4 sm:ring-[6px]"
      />
    </div>
  );
}

/**
 * The opening slider: a soft sand panel, a short headline and one button, the photo cluster on the
 * right, arrows on wide screens and dots on phones, and a round button in a notch that jumps to the products.
 */
function Hero() {
  const { business, articles } = useStorefront();
  const slides = [
    {
      title: 'Fresh Milk Daily, Delivered to Your Door',
      body: 'Order online and pay with M-Pesa.',
      cta: { label: 'Explore shop', href: '/shop' },
      main: photoUrl(PHOTOS.glassLight, 700, 700),
      alt: PHOTOS.glassLight.alt,
      small: [PHOTOS.butter, PHOTOS.yoghurt] as [Photo, Photo],
    },
    // The shop's own cover photo, when set, gets a slide of its own rather than leading the page.
    ...(business.coverImageUrl
      ? [{
          title: 'From Our Farm to Your Fridge',
          body: 'Delivery or pickup, your choice.',
          cta: { label: 'Order now', href: '/shop' },
          main: business.coverImageUrl,
          alt: '',
          small: [PHOTOS.bottle, PHOTOS.splash] as [Photo, Photo],
        }]
      : []),
    {
      title: 'Yoghurt, Butter and More From Our Dairy',
      body: 'Everything fresh, every day.',
      cta: { label: 'Shop dairy', href: '/shop' },
      main: photoUrl(PHOTOS.yoghurt, 700, 700),
      alt: PHOTOS.yoghurt.alt,
      small: [PHOTOS.bottle, PHOTOS.splash] as [Photo, Photo],
    },
    {
      title: 'Never Run Out of Milk Again',
      body: 'Pick your days. We prepare each order.',
      cta: { label: 'Set up regular orders', href: '/account/schedules' },
      main: photoUrl(PHOTOS.bottle, 700, 700),
      alt: PHOTOS.bottle.alt,
      small: [PHOTOS.glassLight, PHOTOS.butter] as [Photo, Photo],
    },
    ...(articles.length > 0
      ? [{
          title: 'Keep Your Milk Fresh for Longer',
          body: 'Simple guides for your kitchen.',
          cta: { label: 'Read our guides', href: '/articles' },
          main: photoUrl(PHOTOS.bottleTray, 700, 700),
          alt: PHOTOS.bottleTray.alt,
          small: [PHOTOS.splash, PHOTOS.yoghurt] as [Photo, Photo],
        }]
      : []),
  ];
  const count = slides.length;
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(prefersReducedMotion);
  const touchStart = useRef<number | null>(null);

  const goTo = useCallback((index: number) => setActive((index + count) % count), [count]);

  useEffect(() => {
    if (paused) return;
    const timer = setTimeout(() => { if (!document.hidden) goTo(active + 1); }, SLIDE_MS);
    return () => clearTimeout(timer);
  }, [active, paused, goTo]);

  const onTouchEnd = (e: TouchEvent) => {
    if (touchStart.current === null) return;
    const distance = e.changedTouches[0].clientX - touchStart.current;
    touchStart.current = null;
    if (Math.abs(distance) > 45) goTo(active + (distance < 0 ? 1 : -1));
  };

  const arrow = 'absolute top-1/2 z-10 hidden size-9 -translate-y-1/2 place-items-center rounded-full bg-white text-ink shadow-soft transition hover:bg-ember hover:text-white sm:grid';

  return (
    <section className="site-gutter pt-3 sm:pt-6" aria-roledescription="carousel" aria-label="Welcome">
      <div className="relative pb-7 sm:pb-9">
        <div
          className="soft-panel relative grid touch-pan-y overflow-hidden rounded-2xl"
          onMouseEnter={() => setPaused(true)}
          onMouseLeave={() => setPaused(prefersReducedMotion())}
          onTouchStart={(e) => { touchStart.current = e.touches[0].clientX; }}
          onTouchEnd={onTouchEnd}
        >
          {slides.map((slide, index) => {
            const isActive = index === active;
            const Heading = index === 0 ? 'h1' : 'h2';
            return (
              <div
                key={slide.title}
                role="group"
                aria-roledescription="slide"
                aria-label={`${index + 1} of ${count}`}
                aria-hidden={!isActive}
                {...({ inert: !isActive } as object)}
                className={`grid grid-cols-[1.2fr_1fr] items-center gap-3 px-4 pb-11 pt-6 transition-opacity duration-700 [grid-area:1/1] sm:gap-6 sm:px-16 sm:pb-16 sm:pt-12 md:grid-cols-[1.15fr_1fr] lg:px-20 lg:pb-20 lg:pt-14 ${isActive ? 'opacity-100' : 'pointer-events-none opacity-0'}`}
              >
                <div>
                  <Heading className="display-xl max-w-[18ch] max-sm:text-[1.3125rem] max-sm:leading-tight">{slide.title}</Heading>
                  <p className="mt-1.5 text-xs text-muted sm:mt-3 sm:text-[0.9375rem]">{slide.body}</p>
                  <a href={slide.cta.href} className="btn btn-primary mt-3.5 max-sm:min-h-9 max-sm:px-3.5 max-sm:text-xs sm:mt-7">
                    {slide.cta.label} <ShoppingCart size={16} aria-hidden />
                  </a>
                </div>
                {(isActive || index === (active + 1) % count) && (
                  <PhotoCluster main={slide.main} mainAlt={slide.alt} small={slide.small} />
                )}
              </div>
            );
          })}

          <button onClick={() => goTo(active - 1)} aria-label="Previous slide" className={`${arrow} left-3 lg:left-5`}>
            <ChevronLeft size={18} aria-hidden />
          </button>
          <button onClick={() => goTo(active + 1)} aria-label="Next slide" className={`${arrow} right-3 lg:right-5`}>
            <ChevronRight size={18} aria-hidden />
          </button>
          <div className="absolute bottom-3 left-6 z-10 flex gap-1.5 sm:hidden">
            {slides.map((slide, index) => (
              <button
                key={slide.title}
                onClick={() => goTo(index)}
                aria-label={`Go to slide ${index + 1}`}
                aria-current={index === active}
                className={`h-1.5 rounded-full transition-all ${index === active ? 'w-5 bg-ember' : 'w-1.5 bg-ink/20'}`}
              />
            ))}
          </div>
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
    { kicker: `${loyalty?.pointsPerShilling ?? 2} points per shilling`, title: 'Rewards', href: '/account/rewards', photo: PHOTOS.butter, cta: 'My points' },
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
