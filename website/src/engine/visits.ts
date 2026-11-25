// The private visit counter (website engine phase 7, 20261208001). For each page opened the
// website sends only what kind of page it is and, for the first page of a visit, what kind of
// place the visitor came from. No address, no visitor id, nothing stored in the browser, no
// cookie. Plain logic here so the app's tests can check it.
import { INFO_PAGES } from '../infoPages';

/** Kinds of page counted. Keep in step with website_visit_daily.page (20261208001). */
export const VISIT_PAGES = [
  'home', 'shop', 'product', 'search', 'cart', 'checkout', 'order', 'account', 'articles', 'contact', 'info', 'campaign', 'other',
] as const;
export type VisitPage = (typeof VISIT_PAGES)[number];

/** Where a visit came from. 'inside' = a later page of the same visit. Keep in step with website_visit_daily.source. */
export const VISIT_SOURCES = ['direct', 'search', 'social', 'site', 'inside'] as const;
export type VisitSource = (typeof VISIT_SOURCES)[number];

const PAGE_OF: Record<string, VisitPage> = {
  shop: 'shop', search: 'search', products: 'product', cart: 'cart', checkout: 'checkout',
  'order-confirmed': 'order', track: 'order', account: 'account', saved: 'account', articles: 'articles',
  contact: 'contact', feedback: 'contact', promo: 'campaign',
};

/** The kind of page for a route's parts (["products", "<id>"] -> "product"). */
export function visitPage(parts: readonly string[]): VisitPage {
  const [section, id] = parts;
  if (!section) return 'home';
  if (PAGE_OF[section]) return PAGE_OF[section];
  if (id === undefined && INFO_PAGES.some((p) => p.id === section)) return 'info';
  return 'other';
}

const SEARCH = /(^|\.)(google|bing|duckduckgo|yahoo|yandex|baidu|ecosia|brave|qwant|startpage)\.[a-z.]+$/;
const SOCIAL = /(^|\.)(facebook|fb|instagram|tiktok|twitter|x|t|linkedin|pinterest|reddit|youtube|whatsapp|wa|snapchat|threads|telegram)\.(com|me|co|net|org)$|(^|\.)l\.facebook\.com$|(^|\.)lm\.facebook\.com$/;

/**
 * Where the first page of a visit came from, from the browser's referrer (only its host is
 * looked at, and only to sort it into one of four kinds; nothing of it is sent).
 * Returns null when the "visit" is really a later page: the referrer is this website itself.
 */
export function visitSource(referrer: string, ownHost: string): Exclude<VisitSource, 'inside'> | null {
  if (!referrer) return 'direct';
  let host: string;
  try {
    host = new URL(referrer).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return 'direct';
  }
  if (host === ownHost.toLowerCase().replace(/^www\./, '')) return null;
  if (SEARCH.test(host)) return 'search';
  if (SOCIAL.test(host)) return 'social';
  return 'site';
}

const BOT = /bot|crawl|spider|slurp|preview|fetch|headless|lighthouse|pagespeed|facebookexternalhit|whatsapp|embedly|monitor|uptime|curl|wget|python|axios|java\//i;

/** Robots, link previews, uptime checks and automated browsers are not visitors. */
export const isBot = (userAgent: string, webdriver: boolean) => webdriver || BOT.test(userAgent);
