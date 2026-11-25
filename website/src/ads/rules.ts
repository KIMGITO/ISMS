// Advert rules shared by the website and the app's Marketing screens (the app imports this file,
// as it does adCards.ts). The database has the same numbers in fn_mkt_format / fn_mkt_placement
// (migration 20261207001); src/test/marketingTests.ts compares the two.
// Plain data and pure functions only: no React, no network.

export type AdFormat = 'hero_16x9' | 'wide_3x1' | 'card_4x5' | 'square_1x1' | 'story_9x16' | 'video_16x9' | 'video_9x16' | 'text';
export type AdPlacement = 'hero' | 'announcement' | 'card' | 'product' | 'video' | 'popup' | 'category' | 'landing';
export type CampaignStatus = 'draft' | 'scheduled' | 'active' | 'paused' | 'completed' | 'archived';
export type CampaignState = 'draft' | 'live' | 'paused' | 'ended' | 'archived';
export type CtaKind = 'none' | 'link' | 'product' | 'category' | 'landing' | 'promo_code' | 'whatsapp';

export interface FormatSpec {
  label: string;
  /** width / height; undefined for text. */
  ratio?: number;
  /** "16:9" etc., for people. */
  shape: string;
  /** Recommended width in pixels; the database refuses under half of it. */
  minWidth?: number;
  media: 'image' | 'video' | 'none';
}

export const FORMATS: Record<AdFormat, FormatSpec> = {
  hero_16x9: { label: 'Home banner', ratio: 16 / 9, shape: '16:9', minWidth: 1280, media: 'image' },
  wide_3x1: { label: 'Wide banner', ratio: 3, shape: '3:1', minWidth: 1200, media: 'image' },
  card_4x5: { label: 'Promotional card', ratio: 4 / 5, shape: '4:5', minWidth: 600, media: 'image' },
  square_1x1: { label: 'Square', ratio: 1, shape: '1:1', minWidth: 600, media: 'image' },
  story_9x16: { label: 'Story (tall)', ratio: 9 / 16, shape: '9:16', minWidth: 720, media: 'image' },
  video_16x9: { label: 'Wide video', ratio: 16 / 9, shape: '16:9', minWidth: 640, media: 'video' },
  video_9x16: { label: 'Tall video', ratio: 9 / 16, shape: '9:16', minWidth: 360, media: 'video' },
  text: { label: 'Text only', shape: 'text', media: 'none' },
};

/** Canva design size for each format (pixels), used by the Canva workflow. */
export const DESIGN_SIZES: Record<Exclude<AdFormat, 'text'>, { width: number; height: number }> = {
  hero_16x9: { width: 1920, height: 1080 },
  wide_3x1: { width: 1800, height: 600 },
  card_4x5: { width: 1080, height: 1350 },
  square_1x1: { width: 1080, height: 1080 },
  story_9x16: { width: 1080, height: 1920 },
  video_16x9: { width: 1920, height: 1080 },
  video_9x16: { width: 1080, height: 1920 },
};

export interface PlacementSpec {
  label: string;
  where: string;
  formats: AdFormat[];
  /** Formats allowed for the separate phone version. */
  mobile: AdFormat[];
  maxItems: number;
  rotation: 'priority' | 'rotate';
}

export const PLACEMENTS: Record<AdPlacement, PlacementSpec> = {
  hero: { label: 'Home banner', where: 'Top of the home page, before your own banner', formats: ['hero_16x9', 'video_16x9'], mobile: ['hero_16x9', 'card_4x5', 'square_1x1', 'story_9x16'], maxItems: 3, rotation: 'rotate' },
  announcement: { label: 'Announcement bar', where: 'Thin bar above the menu on every page', formats: ['text'], mobile: [], maxItems: 1, rotation: 'rotate' },
  card: { label: 'Promotional cards', where: 'Home page, under the categories', formats: ['card_4x5', 'square_1x1'], mobile: [], maxItems: 3, rotation: 'priority' },
  product: { label: 'Product promotion', where: 'On the pages of the chosen products or category', formats: ['text', 'square_1x1', 'card_4x5'], mobile: [], maxItems: 1, rotation: 'priority' },
  video: { label: 'Video', where: 'Home page, after the first products', formats: ['video_16x9', 'video_9x16'], mobile: ['video_9x16'], maxItems: 1, rotation: 'priority' },
  popup: { label: 'Pop-up', where: 'Once per visitor, after a delay; never on cart, checkout or account', formats: ['square_1x1', 'card_4x5', 'text'], mobile: [], maxItems: 1, rotation: 'priority' },
  category: { label: 'Category banner', where: 'Top of the shop page (all products or one category)', formats: ['wide_3x1'], mobile: ['wide_3x1', 'square_1x1', 'card_4x5'], maxItems: 1, rotation: 'rotate' },
  landing: { label: 'Campaign page', where: 'Its own page at /promo/<address>', formats: ['hero_16x9', 'wide_3x1', 'square_1x1', 'card_4x5', 'video_16x9', 'video_9x16', 'text'], mobile: ['card_4x5', 'square_1x1', 'story_9x16', 'video_9x16'], maxItems: 6, rotation: 'priority' },
};

export const PLACEMENT_ORDER: AdPlacement[] = ['hero', 'announcement', 'card', 'product', 'video', 'popup', 'category', 'landing'];

export const CAMPAIGN_TYPES: { value: string; label: string }[] = [
  { value: 'seasonal', label: 'Seasonal' },
  { value: 'discount', label: 'Discount' },
  { value: 'flash_sale', label: 'Flash sale' },
  { value: 'brand_awareness', label: 'Brand awareness' },
  { value: 'black_friday', label: 'Black Friday' },
  { value: 'christmas', label: 'Christmas' },
  { value: 'new_product', label: 'New product' },
  { value: 'clearance', label: 'Clearance' },
  { value: 'event', label: 'Event' },
  { value: 'other', label: 'Other' },
];

export const OBJECTIVES: { value: string; label: string }[] = [
  { value: 'sales', label: 'Sell more' },
  { value: 'awareness', label: 'Be known' },
  { value: 'traffic', label: 'Visits to the website' },
  { value: 'product_launch', label: 'Launch a product' },
  { value: 'engagement', label: 'Engagement' },
  { value: 'store_visits', label: 'Visits to the shop' },
];

export const STATUS_LABELS: Record<CampaignStatus, string> = {
  draft: 'Draft', scheduled: 'Scheduled', active: 'Showing', paused: 'Paused', completed: 'Finished', archived: 'Archived',
};

/** Same as fn_mkt_status. */
export function campaignStatus(state: CampaignState, startsAt: string, endsAt: string | null, now = Date.now()): CampaignStatus {
  if (state === 'archived') return 'archived';
  if (state === 'draft') return 'draft';
  if (state === 'ended') return 'completed';
  if (endsAt && now >= Date.parse(endsAt)) return 'completed';
  if (state === 'paused') return 'paused';
  if (now < Date.parse(startsAt)) return 'scheduled';
  return 'active';
}

/** Same as fn_mkt_valid_href: a page of this website or an https address. */
export function isSafeAdHref(href: string | null | undefined): boolean {
  if (!href || href.length > 300 || /[\s"'<>\\]/.test(href)) return false;
  if (href.startsWith('/') && !href.startsWith('//')) return true;
  return /^https:\/\/[a-z0-9.-]+\.[a-z]{2,}(\/|$|\?|#)/i.test(href);
}

/** How far a picture's shape is from the format's (0 = exact). Over 0.03 it will be cropped, never stretched. */
export function ratioMismatch(width: number, height: number, format: AdFormat): number {
  const want = FORMATS[format].ratio;
  if (!want || !width || !height) return 0;
  return Math.abs(width / height - want) / want;
}

export type MediaFit = 'ok' | 'cropped' | 'small' | 'too_small' | 'wrong_kind';

/** What staff are told about a picture for a format. 'too_small' is refused by the database. */
export function mediaFit(media: { kind: string; width?: number | null; height?: number | null }, format: AdFormat): MediaFit {
  const spec = FORMATS[format];
  if (spec.media === 'none') return 'ok';
  if (media.kind !== spec.media) return 'wrong_kind';
  const w = media.width ?? 0;
  if (spec.minWidth && w < spec.minWidth / 2) return 'too_small';
  if (spec.minWidth && w < spec.minWidth) return 'small';
  if (ratioMismatch(w, media.height ?? 0, format) > 0.03) return 'cropped';
  return 'ok';
}

/** CSS object-position from a focal point (0-100 each), so cropping keeps what matters. */
export const focalPosition = (fx?: number | null, fy?: number | null) => `${clamp(fx ?? 50)}% ${clamp(fy ?? 50)}%`;
const clamp = (n: number) => Math.min(100, Math.max(0, Number.isFinite(n) ? n : 50));

// ── What the public website receives (get_public_campaigns) ─────────────────────────────────
export interface PublicMedia { url: string; kind: 'image' | 'video'; w: number; h: number; fx?: number; fy?: number; type?: string }
export interface PublicCreative {
  id: string;
  placement: AdPlacement;
  format: AdFormat;
  headline?: string;
  body?: string;
  ctaLabel?: string;
  alt?: string;
  textPosition?: 'left' | 'center' | 'right' | 'none';
  autoplay?: boolean;
  media?: PublicMedia;
  mobile?: PublicMedia;
  poster?: { url: string; w: number; h: number };
  captions?: string;
}
export interface PublicCampaign {
  id: string;
  name: string;
  type: string;
  priority: number;
  startsAt: string;
  endsAt: string | null;
  tone: 'brand' | 'dark' | 'light';
  ctaLabel?: string | null;
  ctaKind: CtaKind;
  ctaTarget?: string | null;
  discount?: string | null;
  promoCode?: string | null;
  products: string[];
  category?: string | null;
  landing?: string | null;
  description?: string | null;
  creatives: PublicCreative[];
}
export interface PlacementSettings { enabled: boolean; maxItems: number; rotation: 'priority' | 'rotate'; intervalS: number; popupDelayS: number; popupEveryH: number }
export interface PublicAds {
  now: string;
  refreshAt: string | null;
  placements: Record<AdPlacement, PlacementSettings>;
  campaigns: PublicCampaign[];
}

export interface PlacedAd { campaign: PublicCampaign; creative: PublicCreative }

export interface PlacementContext {
  /** Product being viewed (product placement). */
  productId?: string;
  /** Category being viewed, or 'All' (category / product placements). */
  category?: string;
  /** Campaign page address (landing placement). */
  landing?: string;
  /** Milliseconds since epoch; defaults to now. Lets the browser hide an advert the moment it ends. */
  now?: number;
  /** 0..1, for rotation; defaults to Math.random(). Fixed per visit so a page doesn't reshuffle. */
  seed?: number;
}

/**
 * The adverts one placement shows: only campaigns showing now, highest priority first, never more
 * than the placement allows. With rotation 'rotate' the starting point moves per visit among the
 * campaigns that share the top priority, so equal campaigns take turns instead of the newest
 * always winning; the carousel then cycles through what is returned.
 */
export function adsFor(ads: PublicAds | null | undefined, placement: AdPlacement, ctx: PlacementContext = {}): PlacedAd[] {
  if (!ads) return [];
  const settings = ads.placements?.[placement];
  if (settings && !settings.enabled) return [];
  const now = ctx.now ?? Date.now();
  const max = Math.max(1, settings?.maxItems ?? PLACEMENTS[placement].maxItems);
  const out: PlacedAd[] = [];
  const campaigns = ads.campaigns
    .filter((c) => Date.parse(c.startsAt) <= now && (!c.endsAt || Date.parse(c.endsAt) > now))
    .filter((c) => placement !== 'landing' || (!!ctx.landing && c.landing === ctx.landing))
    .filter((c) => placement !== 'product' || matchesProduct(c, ctx))
    .filter((c) => placement !== 'category' || matchesCategory(c, ctx.category))
    .sort((a, b) => b.priority - a.priority || Date.parse(b.startsAt) - Date.parse(a.startsAt));
  for (const campaign of campaigns) {
    for (const creative of campaign.creatives) {
      if (creative.placement === placement) out.push({ campaign, creative });
    }
  }
  if (out.length === 0) return out;
  const rotation = settings?.rotation ?? PLACEMENTS[placement].rotation;
  if (rotation === 'rotate') {
    const top = out[0].campaign.priority;
    const tied = out.filter((a) => a.campaign.priority === top).length;
    if (tied > 1) {
      const shift = Math.floor((ctx.seed ?? Math.random()) * tied) % tied;
      const head = out.slice(0, tied);
      return [...head.slice(shift), ...head.slice(0, shift), ...out.slice(tied)].slice(0, max);
    }
  }
  return out.slice(0, max);
}

function matchesProduct(c: PublicCampaign, ctx: PlacementContext) {
  if (ctx.productId && c.products.includes(ctx.productId)) return true;
  return !!c.category && !!ctx.category && c.category === ctx.category;
}

function matchesCategory(c: PublicCampaign, category?: string) {
  // No category on the campaign: the banner shows on the whole shop page.
  if (!c.category) return true;
  return !!category && category !== 'All' && c.category === category;
}

/**
 * Where an advert's button goes. Returns undefined when there is no button. Product links use
 * the website's own product paths (passed in), so a removed product never gives a broken link.
 */
export function ctaHref(c: PublicCampaign, productPath: (id: string) => string | undefined, whatsapp?: string | null): string | undefined {
  switch (c.ctaKind) {
    case 'link': return isSafeAdHref(c.ctaTarget) ? c.ctaTarget! : undefined;
    case 'product': return c.ctaTarget ? productPath(c.ctaTarget) : undefined;
    case 'category': return c.ctaTarget ? `/shop?category=${encodeURIComponent(c.ctaTarget)}` : '/shop';
    case 'landing': return c.landing ? `/promo/${c.landing}` : undefined;
    case 'promo_code': return c.landing ? `/promo/${c.landing}` : '/shop';
    case 'whatsapp': {
      const digits = (whatsapp ?? '').replace(/\D/g, '');
      return digits ? `https://wa.me/${digits}` : undefined;
    }
    default: return undefined;
  }
}

/** When the advert list must be fetched again: the next start or end, at most 5 minutes away. */
export function nextRefresh(ads: PublicAds | null, now = Date.now()): number {
  const cap = now + 5 * 60_000;
  const at = ads?.refreshAt ? Date.parse(ads.refreshAt) : NaN;
  return Number.isFinite(at) && at > now ? Math.min(at + 1000, cap) : cap;
}

// ── Pop-up rules ─────────────────────────────────────────────────────────────────────────────
/** Pages a pop-up never covers: buying, signing in, the account. */
const NO_POPUP = new Set(['cart', 'checkout', 'order-confirmed', 'account', 'track']);
export function popupAllowedOn(section: string): boolean {
  return !NO_POPUP.has(section);
}

/** True when this visitor has not seen this pop-up within `everyHours`. `seenAt` from local storage. */
export function popupDue(seenAt: number | null, everyHours: number, now = Date.now()): boolean {
  return seenAt === null || now - seenAt >= everyHours * 3_600_000;
}
