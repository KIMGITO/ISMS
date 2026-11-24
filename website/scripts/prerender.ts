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
import { metaForRoute } from '../src/seo';
import { pageHtml, robotsTxt, shopPages, sitemapXml } from '../src/render';

const root = join(import.meta.dirname, '..');
const dist = join(root, 'dist');
config({ path: join(root, '..', '.env'), quiet: true });

const SITE_URL = (process.env.VITE_SITE_URL || '').replace(/\/+$/, '');
const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY;
const SLUG = process.env.VITE_WEBSITE_SLUG || 'kaykays';

async function fetchStorefront(): Promise<Storefront | null> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/get_public_storefront`, {
    method: 'POST',
    headers: { apikey: ANON_KEY!, Authorization: `Bearer ${ANON_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_slug: SLUG }),
  });
  if (!res.ok) throw new Error(`Storefront request failed: ${res.status}`);
  return res.json();
}

async function main() {
  const template = readFileSync(join(dist, 'index.html'), 'utf8');
  // Any path without its own file falls back to the app. On Cloudflare that is
  // not_found_handling in website/wrangler.jsonc; 404.html is for hosts that look for one.
  // No _redirects file: a "/* /index.html 200" rule there would hide the prerendered pages.
  copyFileSync(join(dist, 'index.html'), join(dist, '404.html'));
  // The clean template the website Worker fills in for every shop (worker/index.ts). Not .html,
  // so the asset server's trailing-slash rules leave it alone.
  copyFileSync(join(dist, 'index.html'), join(dist, 'shell.tpl'));

  const site = await fetchStorefront().catch((err) => {
    console.warn(`[prerender] Skipped pages: ${err.message}`);
    return null;
  });

  const urls: string[] = [];
  if (site) {
    const pages = shopPages(site);

    for (const [parts, content] of pages) {
      const meta = metaForRoute(parts, site, SITE_URL);
      const file = join(dist, ...parts, 'index.html');
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, pageHtml(template, meta, site, SITE_URL, content, { indexable: !!SITE_URL }));
      urls.push(meta.path);
    }
    console.log(`[prerender] Wrote ${pages.length} pages.`);
  }

  writeFileSync(join(dist, 'robots.txt'), robotsTxt(SITE_URL, !!SITE_URL));
  if (SITE_URL) {
    writeFileSync(join(dist, 'sitemap.xml'), sitemapXml(SITE_URL, urls));
  } else {
    console.log('[prerender] VITE_SITE_URL is not set, so search engines are asked not to index this build.');
  }
}

main().catch((err) => {
  console.error('[prerender]', err);
  process.exit(1);
});
