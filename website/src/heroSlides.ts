// Home page banner slides. Staff manage them in the app (Online Store > Home banner); they are
// stored in website_settings.hero_slides and checked by fn_valid_hero_slides in the database.
// When none are saved, the website shows DEFAULT_HERO_SLIDES. Plain data and functions only,
// because the staff app imports this file too.
import { AD_TONES, AdTone } from './adCards';
import { pictureSet, ShopPicture } from './shopPictures';
import type { Industry } from './engine/brand';

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

type Group = 'shop' | 'food' | 'style' | 'tech' | 'kitchen' | 'services' | 'logistics';

/** Which built-in words an industry uses. */
export function industryGroup(industry: Industry | undefined): Group {
  switch (industry) {
    case 'food_grocery': return 'food';
    case 'beauty': case 'fashion': return 'style';
    case 'electronics': return 'tech';
    case 'restaurant': return 'kitchen';
    case 'professional_services': return 'services';
    case 'logistics': return 'logistics';
    default: return 'shop';
  }
}

const slide = (id: string, title: string, body: string, ctaLabel: string, ctaHref: string): HeroSlide =>
  ({ id, title, body, ctaLabel, ctaHref, images: [] });

const ORDER_ONLINE = slide('order-online', 'Shop Online, Delivered to Your Door', 'Order online and pay with M-Pesa.', 'Explore shop', '/shop');
const REGULAR = slide('regular-orders', 'Never Run Out Again', 'Pick your days. We prepare each order.', 'Set up regular orders', '/account/schedules');
const GUIDES = slide('guides', 'Tips and Guides From Our Team', 'Simple guides to get the most from what you buy.', 'Read our guides', '/articles');

/** Built-in slides by kind of business: words only. Their pictures are the shop's own product photos (visibleHeroSlides). */
const DEFAULT_SLIDES: Record<Group, HeroSlide[]> = {
  shop: [ORDER_ONLINE, slide('one-place', 'Everything You Need in One Place', 'Good products at fair prices.', 'Browse products', '/shop'), REGULAR, GUIDES],
  food: [ORDER_ONLINE, slide('one-place', 'Fresh Picks for Every Day', 'Good food at fair prices.', 'Browse products', '/shop'), REGULAR, GUIDES],
  style: [
    slide('collection', 'Discover the Collection', 'Chosen with care, delivered to you.', 'Shop the collection', '/shop'),
    slide('new-in', 'New In This Season', 'See what has just arrived.', 'See what is new', '/shop'),
    GUIDES,
  ],
  tech: [
    slide('order-online', 'The Tech You Need, Delivered', 'Compare, choose and order online.', 'Shop now', '/shop'),
    slide('deals', 'Today\'s Deals', 'Lower prices on selected products.', 'See the deals', '/shop?offers=1'),
    slide('guides', 'Not Sure Which to Choose?', 'Our buying guides explain the differences.', 'Read our guides', '/articles'),
  ],
  kitchen: [
    slide('menu', 'Your Favourites, Ready When You Are', 'Order online for delivery or pickup.', 'See the menu', '/shop'),
    slide('specials', 'Today\'s Specials', 'Something new to try.', 'See the specials', '/shop?offers=1'),
  ],
  services: [
    slide('services', 'How We Can Help', 'See our services and what they include.', 'Our services', '/shop'),
    slide('talk', 'Talk to Our Team', 'Tell us what you need and we will advise.', 'Contact us', '/contact'),
    GUIDES,
  ],
  logistics: [
    slide('services', 'Deliveries Made Simple', 'Book online and follow every step.', 'Our services', '/shop'),
    slide('track', 'Where Is My Delivery?', 'Track any order with its number.', 'Track an order', '/track'),
    slide('talk', 'Moving Something Bigger?', 'Talk to our team for a quote.', 'Contact us', '/contact'),
  ],
};

/** The built-in slides for this kind of business (a general shop when unknown). */
export const defaultHeroSlides = (industry?: Industry): HeroSlide[] => DEFAULT_SLIDES[industryGroup(industry)];

/** The general shop's built-in slides. */
export const DEFAULT_HERO_SLIDES: HeroSlide[] = DEFAULT_SLIDES.shop;

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

/**
 * Slides the website should show: saved ones that pass the checks, or the built-in ones with the
 * shop's own product photos (none when it has no photos).
 */
export function visibleHeroSlides(
  saved: HeroSlide[] | undefined,
  hasArticles: boolean,
  pictures: readonly ShopPicture[] = [],
  industry?: Industry,
): HeroSlide[] {
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
  return defaultHeroSlides(industry)
    .filter((slide) => hasArticles || slide.ctaHref !== '/articles')
    .map((slide, index) => ({ ...slide, images: pictureSet(pictures, index * 3, 3) }));
}
