// Brand tokens in the browser. The server already put them in the page head (render.ts); this
// replaces them when the shop changes in place (store picker) or the head was built without them
// (single-shop pages prerendered from an older database).
import type { Storefront } from '../api';
import { buildTokens, tokensCss } from './tokens';

export const TOKENS_STYLE_ID = 'brand-tokens';
export const FONTS_LINK_ID = 'brand-fonts';

export function applyBrand(site: Pick<Storefront, 'business' | 'brand'>) {
  if (typeof document === 'undefined') return;
  const tokens = buildTokens(site.business.primaryColor, site.brand);
  let style = document.getElementById(TOKENS_STYLE_ID) as HTMLStyleElement | null;
  if (!style) {
    style = document.createElement('style');
    style.id = TOKENS_STYLE_ID;
    document.head.appendChild(style);
  }
  const css = tokensCss(tokens);
  if (style.textContent !== css) style.textContent = css;

  let link = document.getElementById(FONTS_LINK_ID) as HTMLLinkElement | null;
  if (!link) {
    link = document.createElement('link');
    link.id = FONTS_LINK_ID;
    link.rel = 'stylesheet';
    document.head.appendChild(link);
  }
  if (link.href !== tokens.fontHref) link.href = tokens.fontHref;
}
