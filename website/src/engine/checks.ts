// Website quality checks and the readiness score (website engine phase 6). One pure function
// looks at the draft (or live) website and the shop's facts and says what is wrong, how much it
// matters and which app screen fixes it. The app shows the list on Overview and refuses to
// publish while a blocker is open; the tests run it on fictional shops.
//
// Levels:
//   blocker - something visitors would see broken or misleading (a link to a page that does not
//             exist, leftover placeholder text, no way to contact the shop). Publish waits.
//   warning - the website works but looks unfinished or loses customers (no products, no logo,
//             most products without pictures, a colour that had to be adjusted).
//   tip     - would make it better (tagline, story, sharing picture).
// The score is the share of check weight passed, so it rises with every fix and is 100 only
// when nothing is open. Checks never invent facts: anything not known is not checked.
import type { PublicBrand } from './brand';
import { INFO_PAGES } from '../infoPages';
import { buildTokens } from './tokens';
import { safeMenuHref, type MenuLink } from './navigation';

export type CheckLevel = 'blocker' | 'warning' | 'tip';
/** Where the fix is: a Website screen id, or 'products' for the products list in Online orders. */
export type FixPlace = 'brand' | 'design' | 'home' | 'pages' | 'content' | 'menu' | 'seo' | 'publishing' | 'products';

export interface CheckResult {
  id: string;
  level: CheckLevel;
  passed: boolean;
  title: string;
  /** What is wrong and how to fix it, or what is good. Plain words. */
  detail: string;
  fix: FixPlace;
}

export interface Readiness {
  score: number;
  status: 'blocked' | 'ready' | 'needs_work';
  checks: CheckResult[];
  blockers: CheckResult[];
}

interface TextLink { label?: string; href?: string; hidden?: boolean; title?: string; body?: string; ctaLabel?: string; ctaHref?: string; kicker?: string }

/** Everything the checks read. Lists and counts are what the database says, never estimates. */
export interface SiteFacts {
  name: string;
  slug: string | null;
  primaryColor: string | null;
  description: string | null;
  logoUrl: string | null;
  brand: PublicBrand;
  contact: { phone: string | null; email: string | null; whatsapp: string | null; address: string | null; hoursText: string | null };
  /** Products shown on the website with a price, and how many of them have a picture. */
  products: { shown: number; withPicture: number };
  heroSlides: TextLink[];
  adCards: TextLink[];
  navigation: { header: MenuLink[] } | null;
  seo: { title?: string; description?: string; shareImage?: string } | null;
  pages: Record<string, string>;
}

/** First parts of every page the website has (website/src/App.tsx Routes). */
export const SITE_SECTIONS = [
  'shop', 'search', 'checkout', 'order-confirmed', 'reviews', 'ideas', 'products', 'cart', 'articles',
  'feedback', 'contact', 'account', 'saved', 'track', 'sitemap', 'promo',
] as const;
/** Sections that need something after them (/products/<id>, /promo/<offer address>). */
const NEEDS_ID = new Set(['products', 'order-confirmed', 'promo']);

/** A link to a page of this website that does not exist. External and safe links are fine. */
export function brokenLink(href: string | undefined): boolean {
  if (!href) return false;
  if (!safeMenuHref(href)) return true;
  if (!href.startsWith('/')) return false;
  const path = href.split(/[?#]/)[0];
  const parts = path.split('/').filter(Boolean);
  if (parts.length === 0) return false;
  const [section, id] = parts;
  if ((SITE_SECTIONS as readonly string[]).includes(section)) return NEEDS_ID.has(section) && !id;
  return !(parts.length === 1 && INFO_PAGES.some((p) => p.id === section));
}

/** Text a template or a half-finished edit leaves behind. */
const PLACEHOLDER = /\b(lorem ipsum|dolor sit amet|todo|tbd|placeholder|xxx+|example\.(com|org)|your (business|shop|company|store) name|insert [a-z ]{2,20} here)\b/i;
export const hasPlaceholder = (text: string | null | undefined) => Boolean(text && PLACEHOLDER.test(text));

const WEIGHT: Record<CheckLevel, number> = { blocker: 12, warning: 6, tip: 2 };
const SHOWN_TITLE = 60;

export function checkWebsite(f: SiteFacts): Readiness {
  const checks: CheckResult[] = [];
  const add = (id: string, level: CheckLevel, passed: boolean, title: string, detail: string, fix: FixPlace) =>
    checks.push({ id, level, passed, title, detail, fix });

  const slides = f.heroSlides.filter((s) => !s.hidden);
  const cards = f.adCards.filter((c) => !c.hidden);

  // ---- Blockers ----
  const broken: string[] = [];
  for (const l of f.navigation?.header ?? []) if (brokenLink(l.href)) broken.push(`menu link "${l.label}"`);
  for (const s of slides) if (brokenLink(s.ctaHref)) broken.push(`banner "${s.title}"`);
  for (const c of cards) if (brokenLink(c.href)) broken.push(`advert "${c.title}"`);
  add('links', 'blocker', broken.length === 0, 'Links go to real pages',
    broken.length ? `These point to a page the website does not have: ${broken.slice(0, 3).join(', ')}${broken.length > 3 ? ` and ${broken.length - 3} more` : ''}.` : 'Every menu, banner and advert link opens a page.',
    broken[0]?.startsWith('menu') ? 'menu' : 'content');

  const texts: [string, string | null | undefined, FixPlace][] = [
    ['tagline', f.brand.tagline, 'brand'], ['short description', f.description, 'brand'],
    ['story', f.brand.story, 'brand'], ['mission', f.brand.mission, 'brand'],
    ['search title', f.seo?.title, 'seo'], ['search description', f.seo?.description, 'seo'],
    ...slides.flatMap((s) => [[`banner "${s.title}"`, `${s.title} ${s.body ?? ''} ${s.ctaLabel ?? ''}`, 'content']] as [string, string, FixPlace][]),
    ...cards.flatMap((c) => [[`advert "${c.title}"`, `${c.title} ${c.body ?? ''} ${c.kicker ?? ''} ${c.ctaLabel ?? ''}`, 'content']] as [string, string, FixPlace][]),
    ...Object.entries(f.pages).map(([id, text]) => [`${INFO_PAGES.find((p) => p.id === id)?.label ?? id} page`, text, 'pages'] as [string, string, FixPlace]),
  ];
  const leftovers = texts.filter(([, text]) => hasPlaceholder(text));
  add('placeholders', 'blocker', leftovers.length === 0, 'No leftover placeholder text',
    leftovers.length ? `Placeholder words such as "lorem ipsum" or "TODO" are in: ${leftovers.slice(0, 3).map(([w]) => w).join(', ')}.` : 'No template or unfinished text found.',
    leftovers[0]?.[2] ?? 'brand');

  const { phone, email, whatsapp } = f.contact;
  add('contact', 'blocker', Boolean(phone || email || whatsapp), 'Customers can reach you',
    phone || email || whatsapp ? 'A phone number, email or WhatsApp is on the website.' : 'Add a phone number, email or WhatsApp number so customers can ask about orders.',
    'brand');

  // ---- Warnings ----
  add('address', 'warning', Boolean(f.slug), 'Web address chosen',
    f.slug ? `The website's name is ${f.slug}.` : 'Choose a name for the web address; until then nobody can open the website.', 'publishing');
  add('products', 'warning', f.products.shown > 0, 'Products on the website',
    f.products.shown > 0 ? `${f.products.shown} showing.` : 'No products are shown yet. Choose them in Online orders, with a price above zero.', 'products');
  if (f.products.shown > 0) {
    const share = f.products.withPicture / f.products.shown;
    add('pictures', 'warning', share >= 0.5, 'Most products have a picture',
      `${f.products.withPicture} of ${f.products.shown} products have a picture.${share < 0.5 ? ' Products without one show a plain tile and sell less.' : ''}`, 'products');
  }
  add('logo', 'warning', Boolean(f.logoUrl), 'Logo',
    f.logoUrl ? 'Uploaded.' : 'Without a logo the header shows your name in text.', 'brand');
  add('description', 'warning', Boolean(f.description?.trim()), 'Short description',
    f.description?.trim() ? 'Written.' : 'Search engines and shared links show it. Write one or two sentences.', 'brand');
  const notes = buildTokens(f.primaryColor, f.brand).notes;
  add('colours', 'warning', notes.length === 0, 'Colours are easy to read',
    notes.length ? notes.map((n) => n.message).join(' ') : 'Text and buttons are readable on every background.', 'brand');
  if (f.seo?.title) add('seo_title', 'warning', f.seo.title.length <= SHOWN_TITLE, 'Search title fits',
    f.seo.title.length <= SHOWN_TITLE ? 'Shown in full in search results.' : `${f.seo.title.length} letters; search results cut it off after about ${SHOWN_TITLE}.`, 'seo');

  // ---- Tips ----
  add('tagline', 'tip', Boolean(f.brand.tagline), 'Tagline', f.brand.tagline ? 'Written.' : 'One line under your name on the home page.', 'brand');
  add('story', 'tip', Boolean(f.brand.story || f.brand.mission), 'Story or mission',
    f.brand.story || f.brand.mission ? 'Written.' : 'Gives the home page and About us something real to say.', 'brand');
  const hours = (f.brand.openingHours?.length ?? 0) > 0 || Boolean(f.contact.hoursText);
  add('hours', 'tip', hours, 'Opening hours', hours ? 'Set.' : 'Shown on the home and contact pages, and to search engines.', 'brand');
  add('share_image', 'tip', Boolean(f.seo?.shareImage || f.logoUrl), 'Picture for shared links',
    f.seo?.shareImage ? 'Set.' : f.logoUrl ? 'Your logo is used.' : 'Links shared on WhatsApp show no picture.', 'seo');
  add('socials', 'tip', Object.keys(f.brand.socialLinks ?? {}).length > 0, 'Social media links',
    Object.keys(f.brand.socialLinks ?? {}).length ? 'Linked.' : 'Link your Facebook, Instagram or TikTok in the footer.', 'brand');

  const total = checks.reduce((n, c) => n + WEIGHT[c.level], 0);
  const earned = checks.reduce((n, c) => n + (c.passed ? WEIGHT[c.level] : 0), 0);
  const score = Math.round((earned / total) * 100);
  const blockers = checks.filter((c) => c.level === 'blocker' && !c.passed);
  const warningsOpen = checks.some((c) => c.level === 'warning' && !c.passed);
  return { score, status: blockers.length ? 'blocked' : warningsOpen ? 'needs_work' : 'ready', checks, blockers };
}
