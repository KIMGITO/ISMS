// The header menu (20261206002). A shop can choose its own links in the app (Website > Menu);
// otherwise the menu fits its kind of business. The original design keeps its exact old menu.
// The database checks every saved link with the same rule as safeMenuHref (fn_valid_link).
import type { Industry, PublicBrand } from './brand';
import { industryGroup } from '../heroSlides';

export interface MenuLink {
  label: string;
  href: string;
}

export const MENU_LIMITS = { links: 8, label: 30 } as const;

/** A page of this website (/path) or an https address; anything else is refused. */
export function safeMenuHref(href: unknown): string | null {
  if (typeof href !== 'string' || href.length > 300) return null;
  if (/^\/([A-Za-z0-9_~%+=&?.#-][A-Za-z0-9/_~%+=&?.#-]*)?$/.test(href)) return href;
  if (/^https:\/\/[A-Za-z0-9.-]+(\/[^\s<>"']*)?$/.test(href)) return href;
  return null;
}

/** Pages a menu link can point at, for the app's picker. */
export const MENU_PAGES: MenuLink[] = [
  { label: 'Home', href: '/' },
  { label: 'Shop', href: '/shop' },
  { label: 'Offers', href: '/shop?offers=1' },
  { label: 'Regular orders', href: '/account/schedules' },
  { label: 'About us', href: '/about' },
  { label: 'Contact', href: '/contact' },
  { label: 'Track order', href: '/track' },
  { label: 'Guides', href: '/articles' },
  { label: 'Reviews', href: '/reviews' },
  { label: 'Help', href: '/help' },
  { label: 'Delivery', href: '/delivery' },
];

const link = (label: string, href: string): MenuLink => ({ label, href });

/** The menu a shop gets until it picks its own. */
export function defaultMenu(brand: Pick<PublicBrand, 'industry' | 'designPreset'> | undefined, hasOffers: boolean): MenuLink[] {
  const offers = hasOffers ? [link('Offers', '/shop?offers=1')] : [];
  const group = brand?.designPreset === 'original' ? 'shop' : industryGroup(brand?.industry as Industry | undefined);
  switch (group) {
    case 'services':
      return [link('Home', '/'), link('Services', '/shop'), link('About us', '/about'), link('Contact', '/contact'), link('Help', '/help')];
    case 'logistics':
      return [link('Home', '/'), link('Services', '/shop'), link('Track order', '/track'), link('About us', '/about'), link('Contact', '/contact'), link('Help', '/help')];
    case 'kitchen':
      return [link('Home', '/'), link('Menu', '/shop'), ...offers, link('Track order', '/track'), link('About us', '/about'), link('Help', '/help')];
    case 'style':
      return [link('Home', '/'), link('Shop', '/shop'), ...offers, link('About us', '/about'), link('Help', '/help')];
    default:
      return [link('Home', '/'), link('Shop', '/shop'), ...offers, link('Regular orders', '/account/schedules'), link('About us', '/about'), link('Track order', '/track'), link('Help', '/help')];
  }
}

/** The saved menu, cleaned; links that fail the rule are dropped. Empty or missing: the default. */
export function menuLinks(saved: unknown, brand: Pick<PublicBrand, 'industry' | 'designPreset'> | undefined, hasOffers: boolean): MenuLink[] {
  const header = saved && typeof saved === 'object' ? (saved as { header?: unknown }).header : undefined;
  const links = Array.isArray(header)
    ? header.slice(0, MENU_LIMITS.links).flatMap((item) => {
        const label = typeof item?.label === 'string' ? item.label.trim().slice(0, MENU_LIMITS.label) : '';
        const href = safeMenuHref(item?.href);
        return label && href ? [{ label, href }] : [];
      })
    : [];
  return links.length ? links : defaultMenu(brand, hasOffers);
}

/** Whether a menu link is the page being shown, for the highlighted link. */
export function isCurrentLink(href: string, path: string): boolean {
  if (/^https:/.test(href)) return false;
  if (href.includes('?')) return path === href;
  const page = path.split('?')[0] || '/';
  if (href === '/') return page === '/';
  if (path.includes('offers=1')) return false;
  return page === href || page.startsWith(`${href}/`);
}

/** Links to other websites open in a new tab. */
export const external = (href: string) =>
  /^https:/.test(href) ? { target: '_blank', rel: 'noopener noreferrer' } : {};
