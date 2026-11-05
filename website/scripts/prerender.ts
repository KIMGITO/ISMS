// Runs after `vite build`. Writes a real HTML file for each public page, with its own title,
// description, canonical URL, structured data and readable content, so search engines and
// link previews get the right result without running JavaScript. Also writes robots.txt and
// sitemap.xml. Content comes from the live storefront, so rebuild after adding products or guides.
//
// While VITE_SITE_URL is unset the site asks not to be indexed. Set it to https://kaykays.com
// and rebuild when the domain goes live.
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { config } from 'dotenv';
import type { Storefront } from '../src/api';
import { HERO_SHARE_IMAGE } from '../src/images';
import { metaForRoute, PageMeta, productPaths } from '../src/seo';

const root = join(import.meta.dirname, '..');
const dist = join(root, 'dist');
config({ path: join(root, '..', '.env'), quiet: true });

const SITE_URL = (process.env.VITE_SITE_URL || '').replace(/\/+$/, '');
const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY;
const SLUG = process.env.VITE_WEBSITE_SLUG || 'kaykays';

const escapeHtml = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** JSON-LD sits inside a script tag, so "<" must not be able to close it. */
const safeJson = (data: object) => JSON.stringify(data).replace(/</g, '\\u003c');

async function fetchStorefront(): Promise<Storefront | null> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/get_public_storefront`, {
    method: 'POST',
    headers: { apikey: ANON_KEY!, Authorization: `Bearer ${ANON_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_slug: SLUG }),
  });
  if (!res.ok) throw new Error(`Storefront request failed: ${res.status}`);
  return res.json();
}

function headTags(meta: PageMeta, businessName: string): string {
  const url = SITE_URL ? `${SITE_URL}${meta.path}` : null;
  const image = meta.image?.startsWith('http') ? meta.image : HERO_SHARE_IMAGE;
  const title = escapeHtml(meta.title);
  const description = escapeHtml(meta.description);
  return [
    `<title>${title}</title>`,
    `<meta name="description" content="${description}" />`,
    `<meta name="robots" content="${meta.noindex || !SITE_URL ? 'noindex, nofollow' : 'index, follow'}" />`,
    url && `<link rel="canonical" href="${escapeHtml(url)}" />`,
    `<meta property="og:title" content="${title}" />`,
    `<meta property="og:description" content="${description}" />`,
    `<meta property="og:type" content="${meta.type === 'article' ? 'article' : 'website'}" />`,
    `<meta property="og:site_name" content="${escapeHtml(businessName)}" />`,
    `<meta property="og:locale" content="en_KE" />`,
    url && `<meta property="og:url" content="${escapeHtml(url)}" />`,
    `<meta property="og:image" content="${escapeHtml(image)}" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    ...(meta.jsonLd ?? []).map((data) => `<script type="application/ld+json" data-seo="true">${safeJson(data)}</script>`),
  ].filter(Boolean).join('\n    ');
}

function pageHtml(template: string, meta: PageMeta, businessName: string, content: string): string {
  return template
    .replace(/<title>[\s\S]*?<\/title>\s*/, '')
    .replace(/<meta (name="description"|property="og:[^"]+"|name="twitter:card")[^>]*>\s*/g, '')
    .replace('</head>', `  ${headTags(meta, businessName)}\n  </head>`)
    .replace('<div id="root"></div>', `<div id="root">${content}</div>`);
}

async function main() {
  const template = readFileSync(join(dist, 'index.html'), 'utf8');
  // Any path without its own file falls back to the app. Hosts differ in how they do that.
  copyFileSync(join(dist, 'index.html'), join(dist, '404.html'));
  writeFileSync(join(dist, '_redirects'), '/* /index.html 200\n');

  const site = await fetchStorefront().catch((err) => {
    console.warn(`[prerender] Skipped pages: ${err.message}`);
    return null;
  });

  const urls: string[] = [];
  if (site) {
    const { business, products, articles } = site;
    const paths = productPaths(products);
    const list = (items: string[]) => `<ul>${items.join('')}</ul>`;
    const productLinks = list(products.map((p) => `<li><a href="${paths.get(p.id)}">${escapeHtml(p.name)}</a></li>`));
    const articleLinks = list(articles.map((a) => `<li><a href="/articles/${a.slug}">${escapeHtml(a.title)}</a></li>`));

    const pages: [string[], string][] = [
      [[], `<h1>${escapeHtml(business.name)}</h1><p>${escapeHtml(business.description ?? '')}</p><h2>Products</h2>${productLinks}<h2>Milk guides</h2>${articleLinks}`],
      [['shop'], `<h1>Shop</h1>${productLinks}`],
      [['articles'], `<h1>Milk guides</h1>${articleLinks}`],
      [['contact'], `<h1>Contact ${escapeHtml(business.name)}</h1><p>${escapeHtml(business.address ?? '')}</p><p>${escapeHtml(business.contactPhone ?? '')}</p>`],
      [['feedback'], `<h1>Share your feedback</h1>`],
      ...products.map((p): [string[], string] => [
        (paths.get(p.id) as string).split('/').filter(Boolean),
        `<h1>${escapeHtml(p.name)}</h1><p>${escapeHtml(p.description ?? '')}</p><p>${escapeHtml(business.currency)} ${p.price} per ${escapeHtml(p.unit)}</p><p>${p.inStock ? 'In stock' : 'Out of stock'}</p>`,
      ]),
      ...articles.map((a): [string[], string] => [
        ['articles', a.slug],
        `<article><h1>${escapeHtml(a.title)}</h1><p>${escapeHtml(a.summary)}</p>${a.body.split('\n').filter(Boolean).map((line) =>
          line.startsWith('## ') ? `<h2>${escapeHtml(line.slice(3))}</h2>` : `<p>${escapeHtml(line.replace(/^- /, ''))}</p>`).join('')}</article>`,
      ]),
    ];

    for (const [parts, content] of pages) {
      const meta = metaForRoute(parts, site, SITE_URL);
      const file = join(dist, ...parts, 'index.html');
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, pageHtml(template, meta, business.name, content));
      urls.push(meta.path);
    }
    console.log(`[prerender] Wrote ${pages.length} pages.`);
  }

  if (SITE_URL) {
    writeFileSync(
      join(dist, 'robots.txt'),
      `User-agent: *\nAllow: /\nDisallow: /account\nDisallow: /cart\n\nSitemap: ${SITE_URL}/sitemap.xml\n`,
    );
    writeFileSync(
      join(dist, 'sitemap.xml'),
      `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls
        .map((path) => `  <url><loc>${escapeHtml(`${SITE_URL}${path}`)}</loc></url>`)
        .join('\n')}\n</urlset>\n`,
    );
  } else {
    writeFileSync(join(dist, 'robots.txt'), 'User-agent: *\nDisallow: /\n');
    console.log('[prerender] VITE_SITE_URL is not set, so search engines are asked not to index this build.');
  }
}

main().catch((err) => {
  console.error('[prerender]', err);
  process.exit(1);
});
