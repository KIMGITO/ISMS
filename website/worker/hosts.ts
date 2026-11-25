// Which shop an address belongs to: the parts of the Worker that are plain logic, so the app's
// tests can check them (src/test/runTests.ts).

/** What the database says about an address (resolve_website_host, 20261204004). */
export type HostAnswer =
  | { kind: 'none' }
  | { kind: 'platform' }
  | { kind: 'redirect'; host: string }
  | { kind: 'closed'; name: string }
  | {
      kind: 'shop';
      slug: string;
      host: string;
      powered_by: boolean;
      orders_open: boolean;
      platform_name: string | null;
      platform_url: string | null;
    };

/** "Shop.Example.com:8787" -> "shop.example.com". */
export const cleanHost = (host: string) => host.toLowerCase().split(':')[0].replace(/\.$/, '');

/**
 * Addresses that serve the build's own shop as before (one shop, pages made at build time):
 * workers.dev and preview addresses, localhost, and any listed in SINGLE_SHOP_HOSTS.
 */
export function isSingleShopHost(host: string, listed: string | undefined): boolean {
  const h = cleanHost(host);
  if (h === 'localhost' || h === '127.0.0.1' || h.endsWith('.workers.dev')) return true;
  return (listed ?? '')
    .split(',')
    .map((x) => cleanHost(x.trim()))
    .filter(Boolean)
    .includes(h);
}

/** "<business>-app.<any domain>": a business's staff app, served by the app Worker. */
export const isAppHost = (host: string) => /^[a-z0-9]([a-z0-9-]*[a-z0-9])?-app\.[^.]+\.[^.]/.test(cleanHost(host));

/** Paths that are files of the built site (scripts, pictures, icons), not pages. */
export const isFilePath = (pathname: string) =>
  pathname.startsWith('/assets/') || /\.[a-z0-9]{2,5}$/i.test(pathname.split('/').pop() ?? '');

/** The same page at the shop's home address (keeps the path and query). */
export const redirectTo = (url: URL, host: string) => `https://${host}${url.pathname}${url.search}`;

/**
 * The edge-cache key for a database answer. Everything the answer depends on (the function and
 * every argument: the shop's web name or the address) is in the key, so one shop's answer can
 * never be served for another. Arguments are sorted so the same call always has the same key.
 */
export function rpcCacheKey(fn: string, args: Record<string, string>): string {
  const params = new URLSearchParams(Object.entries(args).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
  return `https://rpc.cache/${encodeURIComponent(fn)}?${params}`;
}
