// The home page composition: which sections a shop's home page shows, in what order, in which
// variant, and with which words for its headings. Pure data so the app's Homepage builder (and its
// preview) uses the same rules as the website.
//
// Order of choice: a saved arrangement (Homepage builder, validated by normaliseHome), else the
// arrangement for the shop's industry, adjusted for its personality. Shops on the "original"
// design keep the arrangement every shop had before brands existed.
import type { Industry, PublicBrand } from './brand';
import { presetFor } from './tokens';

export type SectionKind =
  | 'hero' | 'categories' | 'adverts' | 'strip' | 'strip2' | 'promotions' | 'offers' | 'products'
  | 'reviewed' | 'aisles' | 'story' | 'trust' | 'testimonials' | 'recent' | 'guides' | 'visit' | 'contact';

/** Each section's ways of looking, the first being its default. */
export const SECTION_VARIANTS: Record<SectionKind, readonly string[]> = {
  hero: ['carousel', 'statement', 'banner'],
  categories: ['circles', 'tiles', 'chips'],
  adverts: ['posters'],
  strip: ['bar'],
  strip2: ['bar'],
  promotions: ['codes'],
  offers: ['carousel', 'grid'],
  products: ['carousel', 'grid'],
  reviewed: ['carousel', 'grid'],
  aisles: ['carousel', 'grid'],
  story: ['split', 'centred'],
  trust: ['boxes'],
  testimonials: ['quotes'],
  recent: ['carousel'],
  guides: ['cards'],
  visit: ['card'],
  contact: ['band'],
};

/** Names and one-line explanations for the Homepage builder. */
export const SECTION_INFO: Record<SectionKind, { label: string; hint: string }> = {
  hero: { label: 'Opening banner', hint: 'The first thing visitors see.' },
  categories: { label: 'Categories', hint: 'Links to each kind of product.' },
  adverts: { label: 'Advert cards', hint: 'Up to six picture cards with a link.' },
  strip: { label: 'Offer bar', hint: 'A thin full-width bar: your first bar advert.' },
  strip2: { label: 'Second offer bar', hint: 'Your second bar advert, further down.' },
  promotions: { label: 'Promo codes', hint: 'Codes you chose to show on the website.' },
  offers: { label: 'Offers', hint: 'Products with a lower price than before.' },
  products: { label: 'Products', hint: 'Your products, in stock first.' },
  reviewed: { label: 'Most reviewed', hint: 'Products customers reviewed most.' },
  aisles: { label: 'A row per category', hint: 'Your biggest categories, one row each.' },
  story: { label: 'Your story', hint: 'Your story or mission from the Brand screen.' },
  trust: { label: 'Why buy here', hint: 'Payment, delivery, guarantee and contact.' },
  testimonials: { label: 'Customer reviews', hint: 'What customers said about you.' },
  recent: { label: 'Recently viewed', hint: 'What this visitor looked at before.' },
  guides: { label: 'Guides', hint: 'Your latest three articles.' },
  visit: { label: 'Visit us', hint: 'Address, map link and opening hours.' },
  contact: { label: 'Contact band', hint: 'WhatsApp, call and order tracking.' },
};

export const VARIANT_LABELS: Record<string, string> = {
  carousel: 'Sliding row', statement: 'Statement with picture', banner: 'Words on brand colour',
  circles: 'Round pictures', tiles: 'Picture tiles', chips: 'Name buttons', grid: 'Grid',
  split: 'Words and picture', centred: 'Centred words', posters: 'Cards', bar: 'Bar', codes: 'Codes',
  boxes: 'Boxes', quotes: 'Quotes', cards: 'Cards', card: 'Card', band: 'Band',
};

export const SECTION_KINDS = Object.keys(SECTION_VARIANTS) as SectionKind[];
export const HOME_LIMITS = { sections: SECTION_KINDS.length, title: 60 } as const;

/** One section as saved by the Homepage builder. */
export interface HomeSection {
  kind: SectionKind;
  variant?: string;
  /** A heading in the shop's own words; missing = the heading for its industry. */
  title?: string;
  hidden?: boolean;
}

/** A section ready to draw: variant and heading settled. */
export interface ResolvedSection {
  kind: SectionKind;
  variant: string;
  title: string;
  /** Space above: 'lg' before a new part of the page, 'sm' between related rows. */
  gap: 'sm' | 'lg';
}

/** Headings in each industry's words. */
interface Words {
  categories: string; offers: string; products: string; reviewed: string; story: string;
  testimonials: string; recent: string; guides: string; visit: string; contact: string;
}

const SHOP_WORDS: Words = {
  categories: 'Shop by category', offers: 'Offers', products: 'Our products', reviewed: 'Most reviewed',
  story: 'About us', testimonials: 'What customers say', recent: 'Recently viewed', guides: 'Guides', visit: 'Visit us',
  contact: 'Order the way that suits you',
};

const WORDS: Record<Industry, Words> = {
  food_grocery: { ...SHOP_WORDS, offers: 'This week\'s offers', products: 'Fresh picks' },
  restaurant: { ...SHOP_WORDS, categories: 'On the menu', offers: 'Specials', products: 'Menu favourites', reviewed: 'Customer favourites', visit: 'Find us' },
  beauty: { ...SHOP_WORDS, products: 'The collection', story: 'Our philosophy', guides: 'Beauty notes' },
  fashion: { ...SHOP_WORDS, categories: 'Shop the edit', products: 'New in', guides: 'Style notes' },
  electronics: { ...SHOP_WORDS, categories: 'Shop by department', offers: 'Deals', products: 'Popular now', guides: 'Buying guides' },
  pharmacy: { ...SHOP_WORDS, products: 'Everyday essentials', guides: 'Health notes' },
  hardware: { ...SHOP_WORDS, categories: 'Shop by department', products: 'Popular tools and supplies', guides: 'How-to guides' },
  professional_services: { ...SHOP_WORDS, categories: 'What we do', offers: 'Current offers', products: 'Our services', reviewed: 'Most requested', testimonials: 'What clients say', guides: 'Insights', visit: 'Our office', contact: 'Talk to us' },
  logistics: { ...SHOP_WORDS, categories: 'Services', offers: 'Current offers', products: 'Our services', reviewed: 'Most booked', testimonials: 'What clients say', guides: 'Shipping guides', visit: 'Our office', contact: 'Book or track a delivery' },
  general_retail: SHOP_WORDS,
  other: SHOP_WORDS,
};

/** The headings every shop had before brands existed, kept for the original design. */
const ORIGINAL_WORDS: Words = {
  categories: 'Top Picks by Category', offers: 'Exclusive Offers', products: 'Our Products', reviewed: 'Most Reviewed',
  story: 'About Us', testimonials: 'What Customers Say', recent: 'Recently Viewed', guides: 'Guides', visit: 'Visit Us',
  contact: 'Order the way that suits you',
};

type Recipe = [SectionKind, string?][];

/** The arrangement every shop had before brands existed, section for section. */
const ORIGINAL: Recipe = [
  ['hero', 'carousel'], ['categories', 'circles'], ['adverts'], ['strip'], ['promotions'], ['offers', 'carousel'],
  ['products', 'carousel'], ['reviewed', 'carousel'], ['strip2'], ['aisles', 'carousel'], ['trust'], ['testimonials'],
  ['recent'], ['guides'], ['contact'],
];

/** A shop with many products: browse first, aisle by aisle. */
const STORE: Recipe = ORIGINAL;

/** A shop that sells on looks and story: an editorial opening, fewer rows, the story near the top. */
const BOUTIQUE: Recipe = [
  ['hero', 'statement'], ['categories', 'tiles'], ['products', 'grid'], ['story', 'split'], ['promotions'],
  ['offers', 'carousel'], ['adverts'], ['testimonials'], ['guides'], ['trust'], ['recent'], ['contact'],
];

/** A shop customers compare in: deals and departments first, many rows. */
const TECH: Recipe = [
  ['hero', 'carousel'], ['promotions'], ['offers', 'carousel'], ['categories', 'tiles'], ['products', 'grid'],
  ['strip'], ['reviewed', 'carousel'], ['aisles', 'carousel'], ['trust'], ['guides'], ['testimonials'], ['recent'], ['contact'],
];

/** A kitchen: the menu, today's specials, and where to find it. */
const KITCHEN: Recipe = [
  ['hero', 'statement'], ['promotions'], ['categories', 'chips'], ['products', 'grid'], ['offers', 'carousel'],
  ['story', 'split'], ['testimonials'], ['visit'], ['contact'],
];

/** A firm that sells advice: who they are, what they do, proof, how to reach them. No delivery promises. */
const SERVICES: Recipe = [
  ['hero', 'banner'], ['story', 'centred'], ['products', 'grid'], ['promotions'], ['testimonials'],
  ['guides'], ['visit'], ['contact'],
];

/** A delivery firm: as a services firm, plus the payment and delivery promises customers look for. */
const COURIER: Recipe = [
  ['hero', 'banner'], ['story', 'centred'], ['products', 'grid'], ['promotions'], ['trust'], ['testimonials'],
  ['guides'], ['visit'], ['contact'],
];

const RECIPES: Record<Industry, Recipe> = {
  food_grocery: STORE, general_retail: STORE, pharmacy: STORE, hardware: STORE, other: STORE,
  beauty: BOUTIQUE, fashion: BOUTIQUE, electronics: TECH, restaurant: KITCHEN,
  professional_services: SERVICES, logistics: COURIER,
};

/** Sections that start a new part of the page get more room above them. */
const LARGE_GAP = new Set<SectionKind>(['story', 'trust', 'testimonials', 'guides', 'visit', 'contact']);

const isKind = (k: unknown): k is SectionKind => typeof k === 'string' && Object.hasOwn(SECTION_VARIANTS, k);

/**
 * A saved arrangement made safe: unknown sections dropped, each section once, unknown variants
 * replaced by the default, headings trimmed and cut to length. [] when nothing usable was saved.
 */
export function normaliseHome(saved: unknown): HomeSection[] {
  if (!Array.isArray(saved)) return [];
  const seen = new Set<SectionKind>();
  const out: HomeSection[] = [];
  for (const raw of saved) {
    if (!raw || typeof raw !== 'object') continue;
    const { kind, variant, title, hidden } = raw as Record<string, unknown>;
    if (!isKind(kind) || seen.has(kind)) continue;
    seen.add(kind);
    const section: HomeSection = { kind };
    if (typeof variant === 'string' && SECTION_VARIANTS[kind].includes(variant)) section.variant = variant;
    if (typeof title === 'string' && title.trim()) section.title = title.trim().replace(/\s+/g, ' ').slice(0, HOME_LIMITS.title);
    if (hidden === true) section.hidden = true;
    out.push(section);
  }
  return out;
}

/** The arrangement this brand starts with, before anything is saved. */
export function defaultHome(brand: PublicBrand | undefined): HomeSection[] {
  const preset = presetFor(brand);
  if (preset === 'original') return ORIGINAL.map(([kind, variant]) => ({ kind, variant }));
  const industry = brand?.industry ?? 'general_retail';
  const recipe = RECIPES[industry] ?? STORE;
  // Quiet personalities show products as a calm grid; lively ones keep the sliding rows.
  const calm = preset === 'premium' || preset === 'minimal';
  return recipe.map(([kind, variant]) => {
    if (calm && (kind === 'products' || kind === 'offers') && variant) return { kind, variant: 'grid' };
    return { kind, variant };
  });
}

/** Headings for this brand: the original ones on the original design, else the industry's. */
export function sectionWords(brand: PublicBrand | undefined): Words {
  if (presetFor(brand) === 'original') return ORIGINAL_WORDS;
  return WORDS[brand?.industry ?? 'general_retail'] ?? SHOP_WORDS;
}

/** The sections to draw, in order, with variant, heading and spacing settled. */
export function composeHome(brand: PublicBrand | undefined, saved?: unknown): ResolvedSection[] {
  const chosen = normaliseHome(saved);
  const list = chosen.length > 0 ? chosen : defaultHome(brand);
  const words = sectionWords(brand) as unknown as Record<string, string>;
  return list
    .filter((s) => !s.hidden)
    .map((s) => ({
      kind: s.kind,
      variant: s.variant ?? SECTION_VARIANTS[s.kind][0],
      title: s.title ?? words[s.kind] ?? '',
      gap: LARGE_GAP.has(s.kind) ? 'lg' : 'sm',
    }));
}
