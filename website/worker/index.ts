// The website Worker: one Worker serves every business's shop, chosen by the address
// (SaaS step 6, 20261204004).
//
//   <website name>.<platform domain>   a shop's own subdomain (never a path)
//   shop.example.co.ke                 a shop's own domain (Cloudflare for SaaS sends it here)
//   *.workers.dev, localhost,          the build's own shop, exactly as before: the pages
//   SINGLE_SHOP_HOSTS                  prerendered at build time (scripts/prerender.ts)
//
// For a shop address the Worker asks the database which shop it is (resolve_website_host,
// cached a minute), sends old names and subdomains on to the shop's home address, and builds
// each page's head and readable content from that shop's storefront (cached five minutes).
// The page then runs the same app, which reads the shop from <meta name="shop">.
// Unknown addresses get a plain "nothing here" page that names no business.
import type { Storefront } from '../src/api';
import { escapeHtml, publicPaths, renderRoute, robotsTxt, ShopTag, sitemapXml } from '../src/render';
import { cleanHost, HostAnswer, isFilePath, isSingleShopHost, redirectTo } from './hosts';
import { plansPageHtml, PublicPlans } from './plansPage';

interface Env {
  ASSETS: { fetch(request: Request | string): Promise<Response> };
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
  SINGLE_SHOP_HOSTS?: string;
}

interface Ctx {
  waitUntil(promise: Promise<unknown>): void;
}

// Same rules as website/public/_headers, set here because pages the Worker builds don't get them.
const SECURITY_HEADERS: Record<string, string> = {
  'Content-Security-Policy':
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' data: https://fonts.gstatic.com; img-src 'self' data: blob: https:; media-src 'self' data: blob:; connect-src 'self' https: wss://*.supabase.co; frame-src 'self' blob:; worker-src 'self' blob:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; upgrade-insecure-requests",
  'Strict-Transport-Security': 'max-age=63072000',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(self), microphone=(), geolocation=(self), payment=(self), usb=(), interest-cohort=()',
};

const cache = () => (globalThis as unknown as { caches: { default: Cache } }).caches.default;

function withHeaders(res: Response, extra: Record<string, string> = {}): Response {
  const out = new Response(res.body, res);
  for (const [k, v] of Object.entries({ ...SECURITY_HEADERS, ...extra })) {
    if (!out.headers.has(k)) out.headers.set(k, v);
  }
  return out;
}

function plainPage(title: string, text: string, status: number): Response {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>${escapeHtml(title)}</title><style>body{font-family:system-ui,sans-serif;background:#fffdf9;color:#1f2937;display:grid;place-items:center;min-height:100vh;margin:0;padding:16px}main{max-width:28rem;text-align:center}h1{font-size:1.25rem}</style></head><body><main><h1>${escapeHtml(title)}</h1><p>${escapeHtml(text)}</p></main></body></html>`;
  return withHeaders(new Response(html, { status, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } }));
}

/** A database call through the public REST endpoint, cached at the edge for `ttl` seconds. */
async function cachedRpc<T>(env: Env, ctx: Ctx, fn: string, args: Record<string, string>, ttl: number): Promise<T | null> {
  const key = new Request(`https://rpc.cache/${fn}?${new URLSearchParams(args)}`);
  const hit = await cache().match(key);
  if (hit) return (await hit.json()) as T | null;
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { apikey: env.SUPABASE_ANON_KEY, Authorization: `Bearer ${env.SUPABASE_ANON_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  });
  if (!res.ok) throw new Error(`${fn} answered ${res.status}`);
  const text = await res.text();
  ctx.waitUntil(cache().put(key, new Response(text, { headers: { 'Content-Type': 'application/json', 'Cache-Control': `max-age=${ttl}` } })));
  return JSON.parse(text) as T | null;
}

/**
 * The platform's own address (bare domain and www): the public plans page. Customers see the
 * plans here and "Choose" opens the app's sign-up with that plan picked.
 */
async function platformPage(url: URL, env: Env, ctx: Ctx): Promise<Response> {
  const siteUrl = `https://${cleanHost(url.host)}`;
  if (url.pathname === '/robots.txt') {
    return withHeaders(new Response(`User-agent: *\nAllow: /\n\nSitemap: ${siteUrl}/sitemap.xml\n`, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } }));
  }
  if (url.pathname === '/sitemap.xml') {
    return withHeaders(new Response(sitemapXml(siteUrl, ['/']), { headers: { 'Content-Type': 'application/xml; charset=utf-8' } }));
  }
  if (url.pathname !== '/' && url.pathname !== '/plans' && url.pathname !== '/pricing') {
    return plainPage('Nothing here', 'This page does not exist.', 404);
  }
  let data: PublicPlans | null;
  try {
    data = await cachedRpc<PublicPlans>(env, ctx, 'get_public_plans', {}, 300);
  } catch {
    return plainPage('Please try again', 'The plans could not be loaded just now. Please try again in a moment.', 503);
  }
  if (!data) return plainPage('Coming soon', 'This page is being set up.', 200);
  const cycle = url.searchParams.get('cycle') === 'annual' ? 'annual' : 'monthly';
  return withHeaders(
    new Response(plansPageHtml(data, cycle, siteUrl), {
      headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=60' },
    }),
  );
}

export default {
  async fetch(request: Request, env: Env, ctx: Ctx): Promise<Response> {
    const url = new URL(request.url);
    const host = cleanHost(url.host);

    if (isSingleShopHost(host, env.SINGLE_SHOP_HOSTS)) {
      return env.ASSETS.fetch(request);
    }

    let answer: HostAnswer | null;
    try {
      answer = await cachedRpc<HostAnswer>(env, ctx, 'resolve_website_host', { p_host: host }, 60);
    } catch {
      return plainPage('Please try again', 'The shop could not be reached just now. Please try again in a moment.', 503);
    }

    switch (answer?.kind) {
      case 'redirect':
        return Response.redirect(redirectTo(url, answer.host), 301);
      case 'closed':
        return plainPage(answer.name, 'This shop is not open online right now.', 404);
      case 'platform':
        return platformPage(url, env, ctx);
      case 'shop':
        break;
      default:
        return plainPage('Nothing here', 'There is no shop at this address.', 404);
    }

    // Files (scripts, styles, pictures) are the same for every shop.
    if (isFilePath(url.pathname) && url.pathname !== '/robots.txt' && url.pathname !== '/sitemap.xml') {
      return withHeaders(await env.ASSETS.fetch(request));
    }

    const siteUrl = `https://${answer.host}`;
    let site: Storefront | null;
    try {
      site = await cachedRpc<Storefront>(env, ctx, 'get_public_storefront', { p_slug: answer.slug }, 300);
    } catch {
      return plainPage('Please try again', 'The shop could not be reached just now. Please try again in a moment.', 503);
    }
    if (!site) return plainPage('Nothing here', 'There is no shop at this address.', 404);

    if (url.pathname === '/robots.txt') {
      return withHeaders(new Response(robotsTxt(siteUrl, true), { headers: { 'Content-Type': 'text/plain; charset=utf-8' } }));
    }
    if (url.pathname === '/sitemap.xml') {
      return withHeaders(new Response(sitemapXml(siteUrl, publicPaths(site, siteUrl)), { headers: { 'Content-Type': 'application/xml; charset=utf-8' } }));
    }

    const shell = await env.ASSETS.fetch(new Request(`${url.origin}/shell.tpl`));
    if (!shell.ok) return plainPage('Please try again', 'The shop could not be shown just now.', 503);
    const shop: ShopTag = {
      slug: answer.slug,
      poweredBy: answer.powered_by,
      ordersOpen: answer.orders_open,
      platformName: answer.platform_name,
      platformUrl: answer.platform_url,
    };
    const html = renderRoute(await shell.text(), site, siteUrl, url.pathname, shop);
    return withHeaders(
      new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=0, must-revalidate' } }),
    );
  },
};
