// Real HTML for a shop's public pages: title, description, canonical address, structured data and
// readable content, so search engines and link previews work without running JavaScript.
// Used by the website Worker for every shop (worker/index.ts) and by scripts/prerender.ts for the
// build's own shop. Plain data only: no browser, Vite or Node APIs.
import { buildTokens, tokensCss } from './engine/tokens';
import { hoursText } from './engine/brand';
import type { Storefront } from './api';
import { shopPictures } from './shopPictures';
import { metaForRoute, PageMeta, productPaths } from './seo';
import { INFO_PAGES, infoPageText } from './infoPages';
import { Block, parseDocument, plainText } from './richFormat';
import { formatPrice } from './numbers';

export const escapeHtml = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Page or guide text as plain HTML for crawlers: headings, paragraphs, list items and photos. */
const bodyHtml = (body: string) =>
  parseDocument(body)
    .map((block: Block) => {
      switch (block.type) {
        case 'hr':
          return '<hr>';
        case 'img':
          return `<figure><img src="${escapeHtml(block.src)}" alt="${escapeHtml(block.alt)}">${block.caption ? `<figcaption>${escapeHtml(plainText(block.caption))}</figcaption>` : ''}</figure>`;
        case 'ul':
        case 'ol':
          return `<${block.type}>${block.items.map((item) => `<li>${escapeHtml(plainText(item))}</li>`).join('')}</${block.type}>`;
        case 'h2':
        case 'h3':
          return `<${block.type}>${escapeHtml(plainText(block.text))}</${block.type}>`;
        default:
          return `<p>${escapeHtml(plainText(block.text))}</p>`;
      }
    })
    .join('');

/** JSON-LD sits inside a script tag, so "<" must not be able to close it. */
const safeJson = (data: object) => JSON.stringify(data).replace(/</g, '\\u003c');

/** What the Worker tells the page about the shop at this address (read by api.ts). */
export interface ShopTag {
  slug: string;
  poweredBy: boolean;
  ordersOpen: boolean;
  platformName: string | null;
  platformUrl: string | null;
}

export const SHOP_META_NAME = 'shop';

function headTags(meta: PageMeta, site: Storefront, siteUrl: string, indexable: boolean, shop?: ShopTag): string {
  const url = siteUrl ? `${siteUrl}${meta.path}` : null;
  const logo = site.business.logoUrl;
  // The page's own picture, else the shop's logo, else one of its product photos; none rather than a stock photo.
  const image = meta.image?.startsWith('http') ? meta.image : logo?.startsWith('http') ? logo : shopPictures(site.products, 1)[0]?.src;
  const title = escapeHtml(meta.title);
  const description = escapeHtml(meta.description);
  return [
    `<title>${title}</title>`,
    `<meta name="description" content="${description}" />`,
    `<meta name="robots" content="${meta.noindex || !indexable ? 'noindex, nofollow' : 'index, follow'}" />`,
    url && `<link rel="canonical" href="${escapeHtml(url)}" />`,
    `<meta property="og:title" content="${title}" />`,
    `<meta property="og:description" content="${description}" />`,
    `<meta property="og:type" content="${meta.type === 'article' ? 'article' : 'website'}" />`,
    `<meta property="og:site_name" content="${escapeHtml(site.business.name)}" />`,
    `<meta property="og:locale" content="en_KE" />`,
    url && `<meta property="og:url" content="${escapeHtml(url)}" />`,
    image && `<meta property="og:image" content="${escapeHtml(image)}" />`,
    `<meta name="twitter:card" content="${image ? 'summary_large_image' : 'summary'}" />`,
    shop && `<meta name="${SHOP_META_NAME}" content="${escapeHtml(JSON.stringify(shop))}" />`,
    ...(meta.jsonLd ?? []).map((data) => `<script type="application/ld+json" data-seo="true">${safeJson(data)}</script>`),
  ].filter(Boolean).join('\n    ');
}

/**
 * The page template (the built index.html) with this page's head and readable content.
 * The shop's own logo replaces the platform's tab icon when it has one.
 */
export function pageHtml(
  template: string,
  meta: PageMeta,
  site: Storefront,
  siteUrl: string,
  content: string,
  opts: { indexable: boolean; shop?: ShopTag },
): string {
  let html = template
    .replace(/<title>[\s\S]*?<\/title>\s*/, '')
    .replace(/<meta (name="description"|name="robots"|property="og:[^"]+"|name="twitter:card")[^>]*>\s*/g, '')
    .replace('</head>', `  ${headTags(meta, site, siteUrl, opts.indexable, opts.shop)}\n  </head>`)
    .replace('<div id="root"></div>', `<div id="root">${content}</div>`);
  // The shop's design tokens and fonts, so the first paint is already in its colours.
  const tokens = buildTokens(site.business.primaryColor, site.brand);
  html = html
    .replace(/<link id="brand-fonts"[^>]*>/, `<link id="brand-fonts" href="${escapeHtml(tokens.fontHref)}" rel="stylesheet" />`)
    .replace(/<meta name="theme-color"[^>]*>/, `<meta name="theme-color" content="${escapeHtml(tokens.design.page)}" />`)
    .replace('</head>', `  <style id="brand-tokens">${tokensCss(tokens).replace(/</g, '')}</style>\n  </head>`);
  const icon = [site.brand?.faviconUrl, site.brand?.logoMarkUrl, site.business.logoUrl].find((u) => u && /^https:\/\//.test(u));
  if (opts.shop && icon) {
    html = html
      .replace(/<link rel="icon"[^>]*>/, `<link rel="icon" href="${escapeHtml(icon)}" />`)
      .replace(/<link rel="apple-touch-icon"[^>]*>/, `<link rel="apple-touch-icon" href="${escapeHtml(icon)}" />`);
  }
  return html;
}

const list = (items: string[]) => `<ul>${items.join('')}</ul>`;
const para = (text: string | null | undefined) => (text?.trim() ? `<p>${escapeHtml(text.trim())}</p>` : '');

/** The home page as plain HTML: who the shop is, what it sells, where and when to find it. */
export function homeHtml(site: Storefront, productLinks: string, articleLinks: string): string {
  const { business, brand, settings } = site;
  const hours = hoursText(brand?.openingHours) ?? settings.openingHours;
  return `<h1>${escapeHtml(business.name)}</h1>${para(brand?.tagline)}${para(brand?.mission)}${para(brand?.story || business.description)}`
    + `<h2>Products</h2>${productLinks}${guidesHtml(articleLinks)}`
    + (business.address || hours ? `<h2>Visit us</h2>${para(business.address)}${para(hours)}` : '');
}
const guidesHtml = (links: string) => (links === '<ul></ul>' ? '' : `<h2>Guides</h2>${links}`);

/** Every public page of a shop: [path parts, readable content]. */
export function shopPages(site: Storefront): [string[], string][] {
  const { business, products, articles } = site;
  const paths = productPaths(products);
  const productLinks = list(products.map((p) => `<li><a href="${paths.get(p.id)}">${escapeHtml(p.name)}</a></li>`));
  const articleLinks = list(articles.map((a) => `<li><a href="/articles/${a.slug}">${escapeHtml(a.title)}</a></li>`));
  return [
    [[], homeHtml(site, productLinks, articleLinks)],
    [['shop'], `<h1>Shop</h1>${productLinks}`],
    [['articles'], `<h1>Guides</h1>${articleLinks}`],
    [['contact'], `<h1>Contact ${escapeHtml(business.name)}</h1><p>${escapeHtml(business.address ?? '')}</p><p>${escapeHtml(business.contactPhone ?? '')}</p>`],
    [['feedback'], `<h1>Share your feedback</h1>`],
    [['ideas'], `<h1>Vote & suggest products</h1>`],
    [['reviews'], `<h1>Customer reviews</h1>${list((site.reviews ?? []).slice(0, 30).map((r) => `<li>${'★'.repeat(r.rating)} ${escapeHtml(r.name)}: ${escapeHtml(r.body)}</li>`))}`],
    [['sitemap'], `<h1>Site map</h1>${productLinks}${list(INFO_PAGES.map((p) => `<li><a href="${p.path}">${escapeHtml(p.label)}</a></li>`))}${articleLinks}`],
    ...INFO_PAGES.map((page): [string[], string] => [
      [page.id],
      `<article><h1>${escapeHtml(page.title)}</h1>${bodyHtml(infoPageText(page.id, site))}</article>`,
    ]),
    ...products.map((p): [string[], string] => [
      (paths.get(p.id) as string).split('/').filter(Boolean),
      `<h1>${escapeHtml(p.name)}</h1><p>${escapeHtml(p.description ?? '')}</p><p>${escapeHtml(formatPrice(business.currency, p.price))} per ${escapeHtml(p.unit)}</p><p>${p.inStock ? 'In stock' : 'Out of stock'}</p>`,
    ]),
    ...articles.map((a): [string[], string] => [
      ['articles', a.slug],
      `<article><h1>${escapeHtml(a.title)}</h1><p>${escapeHtml(a.summary)}</p>${bodyHtml(a.body)}</article>`,
    ]),
  ];
}

/**
 * Only search results are blocked: every query is a new address. Account, cart and the other
 * private pages stay crawlable so search engines can read their noindex tag; a blocked page
 * they never read can still be listed from links to it.
 */
export const robotsTxt = (siteUrl: string, indexable: boolean) =>
  indexable
    ? `User-agent: *\nAllow: /\nDisallow: /search\n\nSitemap: ${siteUrl}/sitemap.xml\n`
    : 'User-agent: *\nDisallow: /\n';

export const sitemapXml = (siteUrl: string, paths: string[]) =>
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${paths
    .map((path) => `  <url><loc>${escapeHtml(`${siteUrl}${path}`)}</loc></url>`)
    .join('\n')}\n</urlset>\n`;

/** The id of the script tag that carries the shop's data into the page (read by api.ts). */
export const STOREFRONT_DATA_ID = 'storefront-data';

/**
 * Above this the data is left out and the page fetches it as before: search engines read only
 * the first 2 MB of a page, and the readable content and links must come first.
 */
const MAX_EMBEDDED = 600_000;

/**
 * One page for the Worker: the matching public page, or the app shell with the right head, and
 * the HTTP status (404 for an address with no page). The shop's data rides along in the page so
 * the app draws the shop at once instead of waiting for a second request.
 */
export function renderRoute(template: string, site: Storefront, siteUrl: string, pathname: string, shop: ShopTag): { html: string; status: number } {
  let parts: string[];
  try {
    parts = pathname.split('/').filter(Boolean).map((p) => decodeURIComponent(p));
  } catch {
    // A broken address such as /%E0 is no page, not a server error.
    parts = ['%'];
  }
  const key = parts.join('/');
  const page = shopPages(site).find(([p]) => p.join('/') === key);
  const meta = metaForRoute(parts, site, siteUrl);
  let html = pageHtml(template, meta, site, siteUrl, page?.[1] ?? '', { indexable: true, shop });
  const data = safeJson(site);
  if (data.length <= MAX_EMBEDDED) {
    html = html.replace('</body>', `<script id="${STOREFRONT_DATA_ID}" type="application/json">${data}</script>\n  </body>`);
  }
  return { html, status: meta.notFound ? 404 : 200 };
}

/** Paths of every public page (for sitemap.xml). */
export const publicPaths = (site: Storefront, siteUrl: string) =>
  shopPages(site).map(([parts]) => metaForRoute(parts, site, siteUrl).path);
