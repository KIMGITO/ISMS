// Home page banner slides. Staff manage them in the app (Online Store > Home banner); they are
// stored in website_settings.hero_slides and checked by fn_valid_hero_slides in the database.
// When none are saved, the website shows DEFAULT_HERO_SLIDES. Plain data and functions only,
// because the staff app imports this file too.
import { AD_TONES, AdTone } from './adCards';

export interface HeroSlide {
  id: string;
  title: string;
  body?: string;
  ctaLabel?: string;
  ctaHref?: string;
  /** 1 to 3 pictures: the main product first, then one on the left, then a small one in front. */
  images: string[];
  /** Where each picture sits, set by dragging and zooming in the app. Missing: the automatic layout. */
  positions?: HeroBox[];
  /** Phones: where the pictures go. Missing: beside the text. */
  phone?: HeroPhoneLayout;
  /** Tablets and computers: which side the pictures are on. Missing: right. */
  side?: HeroSide;
  /** Background colour. Missing: the soft sand panel with its dotted pattern. */
  tone?: AdTone;
  hidden?: boolean;
}

export type HeroPhoneLayout = 'beside' | 'above' | 'below' | 'none';
export type HeroSide = 'right' | 'left';

/** Phone arrangements staff choose from, in the app's words. */
export const HERO_PHONE_LAYOUTS: { value: HeroPhoneLayout; label: string; hint: string }[] = [
  { value: 'beside', label: 'Beside the text', hint: 'Small pictures next to the words. Keeps the banner short.' },
  { value: 'above', label: 'On top', hint: 'Bigger pictures above the words, centred.' },
  { value: 'below', label: 'Under the text', hint: 'Words first, then bigger pictures, centred.' },
  { value: 'none', label: 'Hide on phones', hint: 'Only the words and button on phones.' },
];

export const HERO_SIDES: { value: HeroSide; label: string }[] = [
  { value: 'right', label: 'Pictures on the right' },
  { value: 'left', label: 'Pictures on the left' },
];

/** The slide's choices with defaults filled in; unknown values (from an older or newer app) fall back. */
export function heroLayout(slide: Pick<HeroSlide, 'phone' | 'side' | 'tone'>) {
  const phone: HeroPhoneLayout = HERO_PHONE_LAYOUTS.some((l) => l.value === slide.phone) ? slide.phone! : 'beside';
  const side: HeroSide = slide.side === 'left' ? 'left' : 'right';
  const tone = slide.tone && slide.tone in AD_TONES ? AD_TONES[slide.tone] : null;
  return { phone, side, tone };
}

/** A picture's box in the square display, in percent of its size: left, top, width, height. */
export interface HeroBox { x: number; y: number; w: number; h: number }

/** Same limits as the database: a picture may hang partly outside the display, but not vanish. */
export const HERO_BOX_LIMITS = { minXY: -50, maxXY: 100, minSize: 8, maxSize: 200 } as const;

export const HERO_LIMITS = { slides: 6, images: 3, title: 90, body: 160, ctaLabel: 30, ctaHref: 300 } as const;

/** Product cut-outs shipped with the website (public/hero), backgrounds removed with the app's remover. */
export const HERO_STOCK_IMAGES = [
  { src: '/hero/milk-pour.webp', label: 'Milk poured into a glass' },
  { src: '/hero/milk-bottle.webp', label: 'Swing-top milk bottle' },
  { src: '/hero/milk-bottle-cookies.webp', label: 'Milk bottle with cookies' },
  { src: '/hero/milk-splash.webp', label: 'Milk splash in a glass' },
  { src: '/hero/milk-glass.webp', label: 'Glass of milk' },
  { src: '/hero/butter.webp', label: 'Butter cubes' },
  { src: '/hero/cheese.webp', label: 'Cheese' },
] as const;

export const DEFAULT_HERO_SLIDES: HeroSlide[] = [
  {
    id: 'fresh-milk',
    title: 'Fresh Milk Daily, Delivered to Your Door',
    body: 'Order online and pay with M-Pesa.',
    ctaLabel: 'Explore shop',
    ctaHref: '/shop',
    images: ['/hero/milk-pour.webp', '/hero/milk-bottle.webp', '/hero/butter.webp'],
  },
  {
    id: 'dairy',
    title: 'Butter, Cheese and More From Our Dairy',
    body: 'Everything fresh, every day.',
    ctaLabel: 'Shop dairy',
    ctaHref: '/shop',
    images: ['/hero/butter.webp', '/hero/milk-glass.webp', '/hero/cheese.webp'],
  },
  {
    id: 'regular-orders',
    title: 'Never Run Out of Milk Again',
    body: 'Pick your days. We prepare each order.',
    ctaLabel: 'Set up regular orders',
    ctaHref: '/account/schedules',
    images: ['/hero/milk-bottle-cookies.webp', '/hero/milk-bottle.webp'],
  },
  {
    id: 'guides',
    title: 'Keep Your Milk Fresh for Longer',
    body: 'Simple guides for your kitchen.',
    ctaLabel: 'Read our guides',
    ctaHref: '/articles',
    images: ['/hero/milk-splash.webp', '/hero/milk-glass.webp', '/hero/butter.webp'],
  },
];

/** Same rule as the database: a page on this site or a secure web address. Anything else becomes the shop. */
export function safeHref(href: string | undefined): string {
  const value = (href ?? '').trim();
  if (/^\/(?!\/)[A-Za-z0-9._~%!$&'()*+,;=:@/?#-]*$/.test(value) || value === '/') return value;
  if (/^https:\/\/[A-Za-z0-9.-]+(:\d+)?(\/[A-Za-z0-9._~%!$&'()*+,;=:@/?#-]*)?$/.test(value)) return value;
  return '/shop';
}

/** Same rule as the database for pictures: https addresses or the website's own cut-outs. */
export function isSafeHeroImage(src: string): boolean {
  return /^https:\/\/[A-Za-z0-9.-]+(:\d+)?\/[A-Za-z0-9._~%!$&'()*+,;=:@/?-]*$/.test(src) || /^\/hero\/[a-z0-9-]+\.(webp|png|jpg)$/.test(src);
}

/**
 * The automatic layout, used until staff move a picture. Index 0 is the main product; 1 stands to
 * its left (behind it); 2 is a small one in front on the right.
 */
export function defaultHeroBoxes(count: number): HeroBox[] {
  if (count <= 1) return [{ x: 6, y: 2, w: 88, h: 94 }];
  if (count === 2) return [{ x: 34, y: 2, w: 66, h: 94 }, { x: 0, y: 24, w: 40, h: 72 }];
  return [{ x: 18, y: 2, w: 68, h: 94 }, { x: 0, y: 26, w: 34, h: 70 }, { x: 68, y: 64, w: 32, h: 34 }];
}

const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

export function isValidHeroBox(box: unknown): box is HeroBox {
  if (!box || typeof box !== 'object') return false;
  const { x, y, w, h } = box as HeroBox;
  const L = HERO_BOX_LIMITS;
  return [x, y].every((n) => finite(n) && n >= L.minXY && n <= L.maxXY)
    && [w, h].every((n) => finite(n) && n >= L.minSize && n <= L.maxSize);
}

/** Keeps a box inside the limits and rounds it to one decimal, as it is saved. */
export function clampHeroBox(box: HeroBox): HeroBox {
  const L = HERO_BOX_LIMITS;
  const clamp = (n: number, lo: number, hi: number) => Math.round(Math.min(hi, Math.max(lo, n)) * 10) / 10;
  return { x: clamp(box.x, L.minXY, L.maxXY), y: clamp(box.y, L.minXY, L.maxXY), w: clamp(box.w, L.minSize, L.maxSize), h: clamp(box.h, L.minSize, L.maxSize) };
}

/** The boxes to draw: the saved ones when there is one valid box per picture, else the automatic layout. */
export function heroBoxes(count: number, positions?: HeroBox[]): HeroBox[] {
  if (positions && positions.length === count && positions.every(isValidHeroBox)) return positions;
  return defaultHeroBoxes(count);
}

/** Inline style for a picture's box, the same on the website and in the app's editor. */
export function heroBoxStyle(box: HeroBox) {
  return { position: 'absolute' as const, left: `${box.x}%`, top: `${box.y}%`, width: `${box.w}%`, height: `${box.h}%` };
}

/** Drawing order: the left picture first (behind), then the main one, then the small one in front. */
export const HERO_DRAW_ORDER = [1, 0, 2] as const;

/** Slides the website should show: saved ones that pass the checks, or the built-in ones. */
export function visibleHeroSlides(saved: HeroSlide[] | undefined, hasArticles: boolean): HeroSlide[] {
  const usable = (saved ?? [])
    .filter((slide) => !slide.hidden && slide.title?.trim())
    .map((slide) => {
      const images = (slide.images ?? []).filter(isSafeHeroImage).slice(0, HERO_LIMITS.images);
      // A picture dropped above would shift every box after it, so positions only count when nothing was dropped.
      const positions = images.length === (slide.images ?? []).length ? slide.positions : undefined;
      return { ...slide, images, positions };
    })
    .filter((slide) => slide.images.length > 0);
  if (usable.length > 0) return usable.slice(0, HERO_LIMITS.slides);
  return DEFAULT_HERO_SLIDES.filter((slide) => hasArticles || slide.ctaHref !== '/articles');
}
