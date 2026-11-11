// Home page banner slides. Staff manage them in the app (Online Store > Home banner); they are
// stored in website_settings.hero_slides and checked by fn_valid_hero_slides in the database.
// When none are saved, the website shows DEFAULT_HERO_SLIDES. Plain data and functions only,
// because the staff app imports this file too.

export interface HeroSlide {
  id: string;
  title: string;
  body?: string;
  ctaLabel?: string;
  ctaHref?: string;
  /** 1 to 3 pictures: the main product first, then one on the left, then a small one in front. */
  images: string[];
  hidden?: boolean;
}

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

export interface HeroSlot { left?: string; right?: string; top?: string; bottom?: string; width?: string; height?: string }

/**
 * Where each picture sits in the square display, by how many there are, as inline styles so the
 * website and the app's preview lay out the same. Index 0 is the main product; 1 stands to its
 * left (behind it); 2 is a small one in front on the right.
 */
export function heroImageSlots(count: number): HeroSlot[] {
  if (count <= 1) return [{ left: '6%', right: '6%', top: '2%', bottom: '4%' }];
  if (count === 2) {
    return [
      { right: '0', width: '66%', top: '2%', bottom: '4%' },
      { left: '0', width: '40%', height: '72%', bottom: '4%' },
    ];
  }
  return [
    { left: '18%', right: '14%', top: '2%', bottom: '4%' },
    { left: '0', width: '34%', height: '70%', bottom: '4%' },
    { right: '0', width: '32%', height: '34%', bottom: '2%' },
  ];
}

/** Drawing order: the left picture first (behind), then the main one, then the small one in front. */
export const HERO_DRAW_ORDER = [1, 0, 2] as const;

/** Slides the website should show: saved ones that pass the checks, or the built-in ones. */
export function visibleHeroSlides(saved: HeroSlide[] | undefined, hasArticles: boolean): HeroSlide[] {
  const usable = (saved ?? [])
    .filter((slide) => !slide.hidden && slide.title?.trim())
    .map((slide) => ({ ...slide, images: (slide.images ?? []).filter(isSafeHeroImage).slice(0, HERO_LIMITS.images) }))
    .filter((slide) => slide.images.length > 0);
  if (usable.length > 0) return usable.slice(0, HERO_LIMITS.slides);
  return DEFAULT_HERO_SLIDES.filter((slide) => hasArticles || slide.ctaHref !== '/articles');
}
