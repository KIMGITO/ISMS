// Advert placements on the website. Each placement has its own look: a banner carousel, a thin
// announcement bar, promotional cards, a product promotion box, a video section, one pop-up, a
// category banner. Every picture sits in a box of its format's shape (no layout shift), is
// cropped around its focal point (never stretched), and has a phone version when staff gave one.
// Nothing here moves by itself when the visitor asks for reduced motion.
import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, ChevronLeft, ChevronRight, Pause, Play, X } from 'lucide-react';
import { useStorefront } from '../store';
import { productPaths } from '../seo';
import { leaveAdPreview, trackAd, useAds } from './adStore';
import {
  adsFor, ctaHref, focalPosition, FORMATS, popupAllowedOn, popupDue,
  type AdPlacement, type PlacedAd, type PlacementContext, type PublicCreative, type PublicMedia,
} from './rules';

const reducedMotion = () =>
  typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** A number for this visit, so rotation stays put while the visitor moves between pages. */
function visitSeed(): number {
  try {
    let s = sessionStorage.getItem('ad-seed');
    if (!s) { s = String(Math.random()); sessionStorage.setItem('ad-seed', s); }
    return Number(s);
  } catch {
    return 0;
  }
}

/** The adverts for one placement, re-checked every 30 s so an ending campaign leaves on time. */
export function usePlacement(placement: AdPlacement, ctx: Omit<PlacementContext, 'now' | 'seed'> = {}): PlacedAd[] {
  const ads = useAds((s) => s.ads);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 30_000);
    return () => clearInterval(t);
  }, []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => adsFor(ads, placement, { ...ctx, seed: visitSeed() }), [ads, placement, ctx.productId, ctx.category, ctx.landing, tick]);
}

function useCta(ad: PlacedAd) {
  const site = useStorefront();
  const paths = useMemo(() => productPaths(site.products), [site.products]);
  const href = ctaHref(ad.campaign, (id) => paths.get(id), site.settings?.whatsapp);
  const label = ad.creative.ctaLabel || ad.campaign.ctaLabel || (href ? 'Shop now' : undefined);
  const external = !!href && /^https:/.test(href);
  return { href, label, external };
}

/** Sends "load" once it is on the page and "view" after half of it was visible for a second. */
export function useAdTracking(creativeId: string) {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    trackAd(creativeId, 'load');
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const io = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting && entry.intersectionRatio >= 0.5 && document.visibilityState === 'visible') {
        timer = setTimeout(() => { trackAd(creativeId, 'view'); io.disconnect(); }, 1000);
      } else {
        clearTimeout(timer);
      }
    }, { threshold: [0, 0.5, 1] });
    io.observe(el);
    return () => { clearTimeout(timer); io.disconnect(); };
  }, [creativeId]);
  return ref;
}

const toneClasses = (tone: string) =>
  tone === 'dark' ? 'bg-hero text-white' : tone === 'light' ? 'bg-cream text-ink' : 'bg-brand text-on-brand';

/** A picture in its format's shape, with a phone version and focal-point crop. */
export function AdPicture({ creative, eager = false, className = '', mobileBreak = 640 }: {
  creative: PublicCreative; eager?: boolean; className?: string; mobileBreak?: number;
}) {
  const media = creative.media;
  if (!media || media.kind !== 'image') return null;
  const mobile = creative.mobile?.kind === 'image' ? creative.mobile : undefined;
  return (
    <picture>
      {mobile && <source media={`(max-width: ${mobileBreak}px)`} srcSet={mobile.url} width={mobile.w} height={mobile.h} />}
      <img
        src={media.url}
        alt={creative.alt ?? ''}
        width={media.w}
        height={media.h}
        loading={eager ? 'eager' : 'lazy'}
        decoding="async"
        // @ts-expect-error fetchpriority is valid HTML; React 18 types lag behind
        fetchpriority={eager ? 'high' : undefined}
        className={`h-full w-full object-cover ${className}`}
        style={{ objectPosition: focalPosition(media.fx, media.fy) }}
      />
    </picture>
  );
}

/** True on phone-width screens; follows resizing. */
function usePhone(maxWidth = 640): boolean {
  const query = `(max-width: ${maxWidth}px)`;
  const get = () => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(query).matches;
  const [phone, setPhone] = useState(get);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const m = window.matchMedia(query);
    const on = () => setPhone(m.matches);
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, [query]);
  return phone;
}

/**
 * The box that keeps the picture's shape before it arrives (no layout shift): the format's shape,
 * or on phones the phone picture's own shape when there is one.
 */
function ratioStyle(creative: PublicCreative, phone = false): React.CSSProperties {
  const m = creative.mobile;
  if (phone && m && m.kind === 'image' && m.w && m.h) return { aspectRatio: `${m.w} / ${m.h}` };
  const r = FORMATS[creative.format]?.ratio;
  return r ? { aspectRatio: String(r) } : {};
}

function CtaButton({ ad, className = '' }: { ad: PlacedAd; className?: string }) {
  const { href, label, external } = useCta(ad);
  if (!href || !label) return null;
  return (
    <a
      href={href}
      onClick={() => trackAd(ad.creative.id, 'click')}
      className={`btn ${className}`}
      {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
    >
      {label} <ArrowRight size={16} aria-hidden />
    </a>
  );
}

function Discount({ ad }: { ad: PlacedAd }) {
  const { discount, promoCode } = ad.campaign;
  if (!discount && !promoCode) return null;
  return (
    <p className="mt-3 flex flex-wrap items-center gap-2 text-sm font-semibold">
      {discount && <span className="rounded-full bg-white/90 px-3 py-1 text-ink">{discount}</span>}
      {promoCode && <span className="rounded-full border border-current px-3 py-1">Code {promoCode}</span>}
    </p>
  );
}

// ── Home banner ──────────────────────────────────────────────────────────────────────────────
/** Campaign banners at the top of the home page. Renders nothing when no campaign uses it. */
export function HeroAds() {
  const ads = usePlacement('hero');
  const interval = (useAds((s) => s.ads?.placements?.hero?.intervalS) ?? 7) * 1000;
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(reducedMotion());
  const count = ads.length;
  useEffect(() => { if (index >= count) setIndex(0); }, [count, index]);
  useEffect(() => {
    if (count < 2 || paused) return;
    const t = setTimeout(() => setIndex((i) => (i + 1) % count), interval);
    return () => clearTimeout(t);
  }, [index, count, paused, interval]);
  if (count === 0) return null;
  const ad = ads[Math.min(index, count - 1)];
  return (
    <section
      className="site-gutter pt-3 sm:pt-6"
      aria-roledescription="carousel"
      aria-label="Offers"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(reducedMotion())}
      onFocus={() => setPaused(true)}
    >
      <div className="relative">
        <HeroSlide key={ad.creative.id} ad={ad} eager={index === 0} />
        {count > 1 && (
          <div className="absolute bottom-3 right-3 flex items-center gap-1.5 rounded-full bg-black/45 px-2 py-1 text-white">
            <button type="button" className="grid h-7 w-7 place-items-center" aria-label="Previous offer" onClick={() => setIndex((i) => (i - 1 + count) % count)}><ChevronLeft size={16} /></button>
            {ads.map((a, i) => (
              <button key={a.creative.id} type="button" aria-label={`Offer ${i + 1} of ${count}`} aria-current={i === index}
                className={`h-2 rounded-full transition-all ${i === index ? 'w-5 bg-white' : 'w-2 bg-white/60'}`} onClick={() => setIndex(i)} />
            ))}
            <button type="button" className="grid h-7 w-7 place-items-center" aria-label="Next offer" onClick={() => setIndex((i) => (i + 1) % count)}><ChevronRight size={16} /></button>
            <button type="button" className="grid h-7 w-7 place-items-center" aria-label={paused ? 'Play offers' : 'Pause offers'} onClick={() => setPaused((p) => !p)}>
              {paused ? <Play size={14} /> : <Pause size={14} />}
            </button>
          </div>
        )}
      </div>
    </section>
  );
}

function HeroSlide({ ad, eager }: { ad: PlacedAd; eager: boolean }) {
  const ref = useAdTracking(ad.creative.id);
  const phone = usePhone();
  const { href } = useCta(ad);
  const c = ad.creative;
  const words = c.textPosition !== 'none' && (c.headline || c.body);
  const align = c.textPosition === 'center' ? 'items-center text-center' : c.textPosition === 'right' ? 'items-end text-right' : 'items-start';
  const scrim = c.textPosition === 'center' ? 'bg-black/45' : c.textPosition === 'right' ? 'bg-gradient-to-l from-black/70 via-black/35 to-transparent' : 'bg-gradient-to-r from-black/70 via-black/35 to-transparent';
  if (c.format === 'video_16x9') {
    return <div ref={ref}><VideoPlayer ad={ad} /></div>;
  }
  return (
    <div ref={ref} className="relative overflow-hidden rounded-2xl bg-sand" style={ratioStyle(c, phone)}>
      <div className="absolute inset-0"><AdPicture creative={c} eager={eager} /></div>
      {words && (
        <div className={`absolute inset-0 flex flex-col justify-end p-5 text-white sm:justify-center sm:p-10 lg:p-14 ${scrim} ${align}`}>
          {c.headline && <h2 className="display-xl max-w-[18ch] drop-shadow-sm">{c.headline}</h2>}
          {c.body && <p className="mt-2 max-w-md text-sm opacity-95 sm:text-base">{c.body}</p>}
          <Discount ad={ad} />
          <CtaButton ad={ad} className="mt-4 bg-white text-ink hover:bg-cream" />
        </div>
      )}
      {!words && href && <a href={href} onClick={() => trackAd(c.id, 'click')} className="absolute inset-0" aria-label={c.alt || ad.campaign.name} />}
    </div>
  );
}

// ── Announcement bar ─────────────────────────────────────────────────────────────────────────
export function AnnouncementBar() {
  const preview = useAds((s) => s.preview);
  return (
    <>
      {preview && (
        <div role="status" className="flex flex-wrap items-center justify-center gap-3 bg-amber-300 px-4 py-2 text-center text-sm font-medium text-ink">
          Campaign preview: visitors don't see this campaign until it is published and running. Nothing is counted.
          <button type="button" onClick={leaveAdPreview} className="rounded-full bg-ink px-3 py-1 text-xs font-semibold text-white">Leave preview</button>
        </div>
      )}
      <AnnouncementBarInner />
    </>
  );
}

function AnnouncementBarInner() {
  const ads = usePlacement('announcement');
  const interval = (useAds((s) => s.ads?.placements?.announcement?.intervalS) ?? 7) * 1000;
  const [index, setIndex] = useState(0);
  const [closed, setClosed] = useState(() => {
    try { return sessionStorage.getItem('ad-bar-closed') === '1'; } catch { return false; }
  });
  useEffect(() => {
    if (ads.length < 2 || reducedMotion()) return;
    const t = setInterval(() => setIndex((i) => (i + 1) % ads.length), interval);
    return () => clearInterval(t);
  }, [ads.length, interval]);
  if (closed || ads.length === 0) return null;
  const ad = ads[index % ads.length];
  return <AnnouncementLine key={ad.creative.id} ad={ad} onClose={() => { setClosed(true); try { sessionStorage.setItem('ad-bar-closed', '1'); } catch { /* ignore */ } }} />;
}

function AnnouncementLine({ ad, onClose }: { ad: PlacedAd; onClose: () => void }) {
  const ref = useAdTracking(ad.creative.id);
  const { href, label, external } = useCta(ad);
  return (
    <div ref={ref} role="region" aria-label="Announcement" className={`relative ${toneClasses(ad.campaign.tone)}`}>
      <p className="site-gutter flex min-h-9 items-center justify-center gap-2 py-1.5 pr-10 text-center text-[13px] font-medium sm:text-sm">
        <span>{ad.creative.headline}</span>
        {ad.campaign.promoCode && <span className="rounded border border-current px-1.5 font-semibold">{ad.campaign.promoCode}</span>}
        {href && (
          <a href={href} onClick={() => trackAd(ad.creative.id, 'click')} className="whitespace-nowrap font-semibold underline underline-offset-2"
            {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}>{label}</a>
        )}
      </p>
      <button type="button" onClick={onClose} aria-label="Close announcement" className="absolute right-2 top-1/2 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-full opacity-80 hover:opacity-100">
        <X size={15} />
      </button>
    </div>
  );
}

// ── Promotional cards ────────────────────────────────────────────────────────────────────────
export function PromoCards({ title }: { title?: string }) {
  const ads = usePlacement('card');
  if (ads.length === 0) return null;
  // A fixed grid, so one or two cards keep a card's size instead of stretching across the page.
  const cols = 'sm:grid-cols-3 lg:grid-cols-4';
  return (
    <section className="site-gutter mt-[var(--section-space)]" aria-label={title || 'Offers'}>
      {title && <h2 className="display-md mb-4">{title}</h2>}
      <div className={`grid grid-cols-2 gap-3 sm:gap-5 ${cols}`}>
        {ads.map((ad) => <PromoCard key={ad.creative.id} ad={ad} />)}
      </div>
    </section>
  );
}

function PromoCard({ ad }: { ad: PlacedAd }) {
  const ref = useAdTracking(ad.creative.id);
  const { href, external } = useCta(ad);
  const c = ad.creative;
  const inner = (
    <>
      <div className="relative overflow-hidden rounded-xl bg-sand" style={ratioStyle(c)}>
        <div className="absolute inset-0 transition-transform duration-300 group-hover:scale-[1.02] motion-reduce:transform-none"><AdPicture creative={c} /></div>
        {ad.campaign.discount && <span className="absolute left-2 top-2 rounded-full bg-brand px-2.5 py-1 text-xs font-semibold text-on-brand">{ad.campaign.discount}</span>}
      </div>
      {(c.headline || c.body) && (
        <div className="mt-2">
          {c.headline && <p className="font-semibold leading-snug text-ink">{c.headline}</p>}
          {c.body && <p className="mt-0.5 line-clamp-2 text-sm text-muted">{c.body}</p>}
        </div>
      )}
    </>
  );
  return (
    <div ref={ref}>
      {href ? (
        <a href={href} onClick={() => trackAd(c.id, 'click')} className="group block" {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}>{inner}</a>
      ) : <div>{inner}</div>}
    </div>
  );
}

// ── Product promotion ────────────────────────────────────────────────────────────────────────
export function ProductPromo({ productId, category }: { productId: string; category?: string }) {
  const [ad] = usePlacement('product', { productId, category });
  if (!ad) return null;
  return <ProductPromoBox key={ad.creative.id} ad={ad} />;
}

function ProductPromoBox({ ad }: { ad: PlacedAd }) {
  const ref = useAdTracking(ad.creative.id);
  const c = ad.creative;
  return (
    <aside ref={ref} aria-label="Offer" className={`mt-4 flex items-center gap-4 overflow-hidden rounded-xl p-4 ${toneClasses(ad.campaign.tone)}`}>
      {c.media && <div className="w-20 shrink-0 overflow-hidden rounded-lg sm:w-24" style={ratioStyle(c)}><AdPicture creative={c} /></div>}
      <div className="min-w-0">
        {ad.campaign.discount && <p className="text-xs font-semibold uppercase tracking-wide opacity-90">{ad.campaign.discount}</p>}
        <p className="font-semibold leading-snug">{c.headline || ad.campaign.name}</p>
        {c.body && <p className="mt-0.5 text-sm opacity-90">{c.body}</p>}
        {ad.campaign.promoCode && <p className="mt-1 text-sm">Use code <strong>{ad.campaign.promoCode}</strong> at checkout</p>}
      </div>
    </aside>
  );
}

// ── Video ────────────────────────────────────────────────────────────────────────────────────
export function VideoAds() {
  const [ad] = usePlacement('video');
  if (!ad) return null;
  const c = ad.creative;
  return (
    <section className="site-gutter mt-[var(--section-space)]" aria-label={c.headline || ad.campaign.name}>
      <VideoBlock key={c.id} ad={ad} />
    </section>
  );
}

function VideoBlock({ ad }: { ad: PlacedAd }) {
  const ref = useAdTracking(ad.creative.id);
  const c = ad.creative;
  const tall = c.format === 'video_9x16';
  return (
    <div ref={ref} className={`grid items-center gap-5 ${tall ? 'sm:grid-cols-[minmax(0,22rem)_1fr]' : ''}`}>
      <VideoPlayer ad={ad} />
      {(c.headline || c.body) && (
        <div className={tall ? '' : 'mt-1'}>
          {c.headline && <h2 className="display-md">{c.headline}</h2>}
          {c.body && <p className="mt-2 max-w-xl text-muted">{c.body}</p>}
          <CtaButton ad={ad} className="mt-4 bg-brand text-on-brand" />
        </div>
      )}
    </div>
  );
}

/**
 * Poster first; the video file is only requested when the visitor presses play, or, for an
 * advert set to play by itself, when it scrolls into view on a connection that isn't saving data
 * and the visitor hasn't asked for reduced motion. Self-playing videos are always muted.
 */
export function VideoPlayer({ ad }: { ad: PlacedAd }) {
  const c = ad.creative;
  const media: PublicMedia | undefined = c.media;
  const box = useRef<HTMLDivElement | null>(null);
  const video = useRef<HTMLVideoElement | null>(null);
  const [started, setStarted] = useState(false);
  const [auto, setAuto] = useState(false);
  useEffect(() => {
    const conn = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
    if (!c.autoplay || reducedMotion() || conn?.saveData || !box.current || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(([e]) => {
      if (e.isIntersecting && e.intersectionRatio >= 0.6) { setAuto(true); setStarted(true); }
      else video.current?.pause();
    }, { threshold: [0, 0.6] });
    io.observe(box.current);
    return () => io.disconnect();
  }, [c.autoplay]);
  if (!media || media.kind !== 'video') return null;
  const play = () => { setStarted(true); trackAd(c.id, 'click'); };
  return (
    <div ref={box} className="relative overflow-hidden rounded-2xl bg-hero" style={ratioStyle(c)}>
      {started ? (
        <video
          ref={video}
          className="absolute inset-0 h-full w-full object-contain"
          controls
          playsInline
          preload="metadata"
          autoPlay
          muted={auto}
          poster={c.poster?.url}
          aria-label={c.alt || c.headline || ad.campaign.name}
        >
          <source src={media.url} type={media.type} />
          {c.captions && <track kind="captions" src={c.captions} srcLang="en" label="Captions" default />}
        </video>
      ) : (
        <button type="button" onClick={play} className="group absolute inset-0" aria-label={`Play video: ${c.alt || c.headline || ad.campaign.name}`}>
          {c.poster && <img src={c.poster.url} alt="" width={c.poster.w} height={c.poster.h} loading="lazy" decoding="async" className="h-full w-full object-cover" />}
          <span className="absolute left-1/2 top-1/2 grid h-16 w-16 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-white/90 text-ink shadow-lg transition group-hover:scale-105 motion-reduce:transform-none">
            <Play size={26} className="ml-1" aria-hidden />
          </span>
        </button>
      )}
    </div>
  );
}

// ── Pop-up ───────────────────────────────────────────────────────────────────────────────────
/** At most one pop-up per visit, after a delay, never on buying or account pages. */
export function PopupAd({ section }: { section: string }) {
  const [ad] = usePlacement('popup');
  const settings = useAds((s) => s.ads?.placements?.popup);
  const preview = useAds((s) => s.preview);
  const [open, setOpen] = useState(false);
  const key = ad ? `ad-popup-${ad.creative.id}` : '';
  useEffect(() => {
    if (!ad || !popupAllowedOn(section)) return;
    let seen: number | null = null;
    try {
      if (!preview && sessionStorage.getItem('ad-popup-shown') === '1') return;
      seen = Number(localStorage.getItem(key)) || null;
    } catch { /* storage blocked: still at most once per page view */ }
    if (!preview && !popupDue(seen, settings?.popupEveryH ?? 24)) return;
    const t = setTimeout(() => setOpen(true), preview ? 300 : (settings?.popupDelayS ?? 8) * 1000);
    return () => clearTimeout(t);
  }, [ad, key, section, settings?.popupDelayS, settings?.popupEveryH, preview]);
  useEffect(() => {
    if (!open || preview) return;
    try { sessionStorage.setItem('ad-popup-shown', '1'); localStorage.setItem(key, String(Date.now())); } catch { /* ignore */ }
  }, [open, key, preview]);
  if (!ad || !open || !popupAllowedOn(section)) return null;
  return <PopupDialog ad={ad} onClose={() => setOpen(false)} />;
}

function PopupDialog({ ad, onClose }: { ad: PlacedAd; onClose: () => void }) {
  const ref = useAdTracking(ad.creative.id);
  const close = useRef<HTMLButtonElement | null>(null);
  const c = ad.creative;
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    close.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('keydown', onKey); before?.focus?.(); };
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-[70] grid place-items-center bg-black/50 p-4" onClick={onClose}>
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={c.headline || ad.campaign.name}
        className="relative w-full max-w-sm overflow-hidden rounded-2xl bg-cream text-ink shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <button ref={close} type="button" onClick={onClose} aria-label="Close" className="absolute right-2 top-2 z-10 grid h-9 w-9 place-items-center rounded-full bg-white/90 text-ink shadow">
          <X size={18} />
        </button>
        {c.media && <div className="relative" style={ratioStyle(c)}><div className="absolute inset-0"><AdPicture creative={c} eager /></div></div>}
        <div className="p-5">
          {ad.campaign.discount && <p className="text-xs font-semibold uppercase tracking-wide text-brand-deep">{ad.campaign.discount}</p>}
          {c.headline && <h2 className="display-md mt-1">{c.headline}</h2>}
          {c.body && <p className="mt-1.5 text-sm text-muted">{c.body}</p>}
          {ad.campaign.promoCode && <p className="mt-3 rounded-lg border border-dashed border-line px-3 py-2 text-center text-sm">Code <strong className="tracking-wider">{ad.campaign.promoCode}</strong></p>}
          <div className="mt-4 flex gap-2">
            <CtaButton ad={ad} className="flex-1 justify-center bg-brand text-on-brand" />
            <button type="button" onClick={onClose} className="btn border border-line">Not now</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Category banner ──────────────────────────────────────────────────────────────────────────
export function CategoryBanner({ category }: { category: string }) {
  const [ad] = usePlacement('category', { category });
  if (!ad) return null;
  return <CategoryBannerBox key={ad.creative.id} ad={ad} />;
}

function CategoryBannerBox({ ad }: { ad: PlacedAd }) {
  const ref = useAdTracking(ad.creative.id);
  const phone = usePhone();
  const { href, external } = useCta(ad);
  const c = ad.creative;
  const body = (
    <div className="relative overflow-hidden rounded-xl bg-sand" style={ratioStyle(c, phone)}>
      <div className="absolute inset-0"><AdPicture creative={c} /></div>
    </div>
  );
  return (
    <div ref={ref} className="mb-5">
      {href ? <a href={href} onClick={() => trackAd(c.id, 'click')} aria-label={c.alt || ad.campaign.name} {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}>{body}</a> : body}
    </div>
  );
}
