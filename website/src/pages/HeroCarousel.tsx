import { TouchEvent, useCallback, useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Check, Pause, Play, Plus } from 'lucide-react';
import { PHOTOS, photoUrl } from '../images';
import { productPaths } from '../seo';
import { useCart, useStorefront } from '../store';
import { DisplayText, formatPrice, perUnit, ProductImage } from '../ui';

const SLIDE_MS = 6500;

type Photo = Parameters<typeof photoUrl>[0];

interface Slide {
  title: string;
  body: string;
  photo?: Photo;
  imageUrl?: string | null;
  tone: 'light' | 'dark';
  focus: string;
  primary: { label: string; href: string };
  secondary: { label: string; href: string };
}

const prefersReducedMotion = () =>
  typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const srcSet = (photo: Photo) =>
  [800, 1400, 2000].map((width) => `${photoUrl(photo, width, Math.round(width * 0.62))} ${width}w`).join(', ');

function HeroProduct() {
  const { products, business } = useStorefront();
  const add = useCart((s) => s.add);
  const [added, setAdded] = useState(false);
  const product = products.find((p) => p.inStock);
  if (!product) return null;
  const href = productPaths(products).get(product.id);

  return (
    <div className="hero-rise card hidden w-48 shrink-0 text-center shadow-sm lg:block xl:w-56">
      <div className="p-3">
        <a href={href} className="font-medium hover:underline">{product.name}</a>
        <p className="mt-0.5 font-semibold">
          {formatPrice(business.currency, product.price)}
          <span className="text-sm font-normal text-muted"> / {perUnit(product.unit)}</span>
        </p>
      </div>
      <div className="relative">
        <div className="aspect-[5/4] overflow-hidden"><ProductImage product={product} width={400} /></div>
        <button
          aria-label={`Add ${product.name} to cart`}
          onClick={() => {
            add(product.id);
            setAdded(true);
          }}
          className="plus-button absolute bottom-0 left-1/2 grid size-11 -translate-x-1/2 translate-y-1/2 place-items-center rounded-full border border-line bg-white shadow-md hover:bg-ink hover:text-cream"
        >
          {added ? <Check size={18} aria-hidden /> : <Plus size={18} strokeWidth={1.6} aria-hidden />}
        </button>
      </div>
    </div>
  );
}

export default function HeroCarousel() {
  const { business, articles } = useStorefront();

  const slides: Slide[] = [
    {
      title: 'Fresh Milk, Poured With Care for Your Home',
      body: business.description || 'Order fresh milk and dairy online, pay with M-Pesa, and choose delivery or pickup. Simple, every time.',
      photo: PHOTOS.bottleTray,
      imageUrl: business.coverImageUrl,
      tone: 'light',
      focus: 'object-[70%_60%]',
      primary: { label: 'Shop Milk', href: '/shop' },
      secondary: articles.length > 0 ? { label: 'Read Our Guides', href: '/articles' } : { label: 'Find Us', href: '/contact' },
    },
    {
      title: 'Order Today. Pay With M-Pesa.',
      body: 'Choose your milk, enter your PIN when the prompt reaches your phone, and you are done.',
      photo: PHOTOS.pour,
      tone: 'dark',
      focus: 'object-[50%_55%]',
      primary: { label: 'Start an Order', href: '/shop' },
      secondary: { label: 'Create an Account', href: '/account' },
    },
    {
      title: 'From the Pasture to Your Fridge',
      body: 'Have your dairy brought to you, or collect it from us when it suits you.',
      photo: PHOTOS.cow,
      tone: 'dark',
      focus: 'object-[62%_45%]',
      primary: { label: 'See What Is Available', href: '/shop' },
      secondary: { label: 'Find Us', href: '/contact' },
    },
    {
      title: 'Never Run Out of Milk',
      body: 'Choose your products and your days. We prepare each order and send you a message to pay for it.',
      photo: PHOTOS.glassWood,
      tone: 'dark',
      focus: 'object-[50%_70%]',
      primary: { label: 'Set Up a Schedule', href: '/account/schedules' },
      secondary: { label: 'Shop Milk', href: '/shop' },
    },
  ];
  const count = slides.length;

  const [active, setActive] = useState(0);
  const [userPaused, setUserPaused] = useState(prefersReducedMotion);
  const [hoverPaused, setHoverPaused] = useState(false);
  const [focusPaused, setFocusPaused] = useState(false);
  const [seen, setSeen] = useState<Set<number>>(() => new Set([0]));
  const touchStart = useRef<number | null>(null);
  const paused = userPaused || hoverPaused || focusPaused;

  const goTo = useCallback((index: number) => {
    const next = (index + count) % count;
    setSeen((current) => new Set(current).add(next));
    setActive(next);
  }, [count]);

  useEffect(() => {
    if (paused) return;
    const timer = setTimeout(() => {
      if (!document.hidden) goTo(active + 1);
      else setSeen((current) => new Set(current));
    }, SLIDE_MS);
    return () => clearTimeout(timer);
  }, [active, paused, seen, goTo]);

  const onTouchEnd = (e: TouchEvent) => {
    if (touchStart.current === null) return;
    const distance = e.changedTouches[0].clientX - touchStart.current;
    touchStart.current = null;
    if (Math.abs(distance) > 45) goTo(active + (distance < 0 ? 1 : -1));
  };

  return (
    <section
      aria-roledescription="carousel"
      aria-label="Welcome"
      className="relative isolate grid touch-pan-y overflow-hidden bg-sand"
      onMouseEnter={() => setHoverPaused(true)}
      onMouseLeave={() => setHoverPaused(false)}
      // Only keyboard focus holds the slide. A clicked button keeps focus, which must not stop the slides for good.
      onFocusCapture={(e) => setFocusPaused(e.target.matches(':focus-visible'))}
      onBlurCapture={() => setFocusPaused(false)}
      onTouchStart={(e) => { touchStart.current = e.touches[0].clientX; }}
      onTouchEnd={onTouchEnd}
    >
      {slides.map((slide, index) => {
        const isActive = index === active;
        const dark = slide.tone === 'dark';
        const Heading = index === 0 ? 'h1' : 'h2';
        // The next photo loads ahead so it is ready, and later ones wait, which saves mobile data.
        const load = seen.has(index) || index === (active + 1) % count;
        return (
          <div
            key={slide.title}
            role="group"
            aria-roledescription="slide"
            aria-label={`${index + 1} of ${count}`}
            aria-hidden={!isActive}
            // Keeps hidden slides' links out of keyboard reach. React 19 supports it; these types don't yet.
            {...({ inert: !isActive } as object)}
            className={`hero-slide relative isolate overflow-hidden [grid-area:1/1] ${isActive ? 'is-active' : ''} ${dark ? 'bg-hero text-cream' : 'bg-sand text-ink'}`}
          >
            {load && (
              slide.imageUrl ? (
                <img src={slide.imageUrl} alt="" className={`hero-photo absolute inset-0 -z-20 h-full w-full object-cover ${slide.focus} ${dark ? '' : 'lg:left-auto lg:right-0 lg:w-[62%]'}`} />
              ) : (
                <img
                  src={photoUrl(slide.photo!, 1400, 868)}
                  srcSet={srcSet(slide.photo!)}
                  sizes={dark ? '100vw' : '(min-width: 1024px) 62vw, 100vw'}
                  alt=""
                  fetchPriority={index === 0 ? 'high' : 'auto'}
                  className={`hero-photo absolute inset-0 -z-20 h-full w-full object-cover ${slide.focus} ${dark ? '' : 'photo-warm lg:left-auto lg:right-0 lg:w-[62%]'}`}
                />
              )
            )}
            <div className={`absolute inset-0 -z-10 ${dark
              ? 'bg-gradient-to-b from-black/70 via-black/45 to-black/75 lg:bg-gradient-to-r lg:from-[#2b1409] lg:from-[20%] lg:via-[#2b1409]/70 lg:via-[45%] lg:to-transparent lg:to-[80%]'
              : 'bg-gradient-to-b from-sand from-30% via-sand/55 via-55% to-sand/85 lg:bg-gradient-to-r lg:from-sand lg:from-[38%] lg:via-sand/70 lg:via-[52%] lg:to-transparent lg:to-[72%]'}`}
            />
            <div className="site-gutter flex min-h-[35rem] flex-col justify-between gap-10 pb-24 pt-12 lg:min-h-[43rem] lg:py-16">
              <Heading className="hero-rise display-xl max-w-[13ch]"><DisplayText>{slide.title}</DisplayText></Heading>
              <div className="flex flex-col gap-8 lg:flex-row lg:items-end lg:gap-12">
                {index === 0 && <HeroProduct />}
                <div className="max-w-md lg:pb-6">
                  <p className="hero-rise text-lg leading-relaxed">{slide.body}</p>
                  <div className="hero-rise mt-6 flex flex-wrap gap-3">
                    <a href={slide.primary.href} className={`btn ${dark ? 'bg-cream text-ink hover:bg-white' : 'btn-primary'}`}>{slide.primary.label}</a>
                    <a href={slide.secondary.href} className={`btn ${dark ? 'border border-white/60 text-white hover:bg-white/10' : 'btn-secondary'}`}>{slide.secondary.label}</a>
                  </div>
                </div>
              </div>
            </div>
          </div>
        );
      })}

      <div className="absolute bottom-4 left-4 z-10 flex items-center bg-white/95 text-ink shadow-sm sm:left-6 lg:left-1/2 lg:-translate-x-1/2">
        <button onClick={() => goTo(active - 1)} aria-label="Previous slide" className="grid size-11 place-items-center hover:bg-sand">
          <ChevronLeft size={19} strokeWidth={1.6} aria-hidden />
        </button>
        <div className="flex items-center">
          {slides.map((slide, index) => (
            <button
              key={slide.title}
              onClick={() => goTo(index)}
              aria-label={`Go to slide ${index + 1}`}
              aria-current={index === active}
              className="grid h-11 w-7 place-items-center sm:w-9"
            >
              <span className="block h-0.5 w-full overflow-hidden bg-sand-deep">
                {index === active && (
                  <span
                    key={active}
                    className="hero-progress block h-full bg-ink"
                    style={{ animationDuration: `${SLIDE_MS}ms`, animationPlayState: paused ? 'paused' : 'running' }}
                  />
                )}
              </span>
            </button>
          ))}
        </div>
        <button onClick={() => goTo(active + 1)} aria-label="Next slide" className="grid size-11 place-items-center hover:bg-sand">
          <ChevronRight size={19} strokeWidth={1.6} aria-hidden />
        </button>
        <button
          onClick={() => setUserPaused(!userPaused)}
          aria-label={userPaused ? 'Play slides' : 'Pause slides'}
          className="grid size-11 place-items-center border-l border-line hover:bg-sand"
        >
          {userPaused ? <Play size={16} strokeWidth={1.6} aria-hidden /> : <Pause size={16} strokeWidth={1.6} aria-hidden />}
        </button>
      </div>
    </section>
  );
}
