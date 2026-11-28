# Customer website: SEO fix plan (2026-11-28)

Goal: every shop's public pages (home, shop, products, guides, info pages) are crawlable, indexable once, and fast on a phone. Source: a read-only code review of `website/` (Worker, render, prerender, head tags). 4 critical, 3 quick wins, 4 planned. Tickets marked **Done in code** are built and tested but not deployed (see TO_FINISH.md).

## Critical

**T-1 Unknown addresses answered 200 (soft 404).** Done in code.
- Where: `website/src/render.ts` `renderRoute`, `website/worker/index.ts` shop branch; `website/src/seo.ts` `notFoundMeta`.
- What: the Worker built a "not found" page with status 200 for any path, including deleted products and broken `%` addresses (which threw). Now `PageMeta.notFound` makes the Worker answer 404, and a broken address is a 404, not an error. `/promo/<id>` and `/order-confirmed/<id>` are explicit noindex pages (200).
- Who: developer. Effort: done.
- Accept: `curl -sI https://<shop>/no-such-page` → `404`; `/products/<deleted>` → `404`; `/cart` and `/promo/x` → `200` with `noindex`.
- Verify after release: the curl lines above on one live shop; Search Console > Pages "Soft 404" should stop growing for that shop.

**T-2 Canonical pointed at an address that redirects (single-shop build).** Done in code.
- Where: `website/wrangler.jsonc` `html_handling`.
- What: with `auto-trailing-slash`, the prerendered `/shop/index.html` was served at `/shop/` and `/shop` redirected there, while every canonical and sitemap entry says `/shop`. Changed to `drop-trailing-slash`. Affects only workers.dev and `SINGLE_SHOP_HOSTS`; shop subdomains are built by the Worker and never had this.
- Accept: `curl -sI https://<single-shop host>/shop` → `200`; `/shop/` → redirect to `/shop`.
- Verify: same two curls after deploy.

**T-3 Fallback page had no noindex in the server HTML.** Done in code.
- Where: `website/index.html`, `website/src/render.ts` `pageHtml`.
- What: on single-shop hosts any non-prerendered path got `index.html` (200, no robots tag); the app set noindex later in JavaScript, which Google may not honour. `index.html` now carries `noindex`; every real page replaces it with its own robots tag. Trade-off: on single-shop hosts a product added after the last build is noindex until the next build (it was already missing from the sitemap and prerendered pages until then). Shop subdomains are unaffected (built per request).
- Accept: `curl -s https://<single-shop host>/anything-new | grep robots` → `noindex`; a prerendered product → exactly one robots tag, `index, follow`.

**T-4 robots.txt blocked pages that carry noindex.** Done in code.
- Where: `website/src/render.ts` `robotsTxt`.
- What: `/account`, `/cart`, `/saved`, `/track`, `/checkout`, `/order-confirmed` were disallowed, so crawlers could never read their noindex and could list the bare URLs from header links. Only `/search` (endless query addresses) stays blocked.
- Accept: `curl -s https://<shop>/robots.txt` shows `Disallow: /search` only.

## Quick wins

**T-5 First screen waited for a second request.** Done in code.
- Where: `website/src/render.ts` `renderRoute` (embeds `<script id="storefront-data">`), `website/src/api.ts` `takeEmbeddedStorefront`, `website/src/App.tsx`.
- What: the server already had the shop's data but the app showed a spinner, deleting the readable content, until it fetched the same data again. Now the data rides in the page (skipped above 600 KB so content stays well inside the first 2 MB Google reads), the shop draws at once, and the live data is fetched straight after without a spinner. Not used on preview links or for another branch picked on the device.
- Accept: on a shop page, view source shows the script tag after `#root`; the network panel shows the page drawn before `get_public_storefront` returns.
- Verify: PageSpeed Insights mobile on one shop's home and one product, before and after; compare LCP. No target promised.

**T-6 Small tap targets on product cards.** Done in code. `website/src/pages/ProductCard.tsx`: Add/stepper and Details 40px tall on phones (was 32px), save heart 36px.

**T-7 "Coming soon" text ran off narrow screens.** Done in code. `website/src/ui.tsx` `Notice`: the text box now fills the width instead of a fixed 448px.

## Planned

**T-8 Product pages for shop subdomains: sitemap `lastmod`.** `website/src/render.ts` `sitemapXml` has no `lastmod`. Needs an `updatedAt` per product and article in `get_public_storefront` (database change). Developer, about half a day. Accept: each `<url>` has `<lastmod>` in `YYYY-MM-DD`.

**T-9 `/shop/anything` and `/contact/anything` answer 200 with the parent page's canonical.** `website/src/seo.ts` `metaForRoute` ignores extra path parts for most sections. Make extra parts `notFoundMeta` except under `products`, `articles`, `account`, `order-confirmed`, `promo`. Developer, under an hour. Accept: `/shop/x` → 404.

**T-10 Shop rating on the business schema.** `website/src/seo.ts` `reviewsMeta` adds `aggregateRating` to the LocalBusiness block from the shop's own reviews. Google does not show stars for reviews a business collects about itself, so this earns nothing; it is harmless. Investigation only: decide whether to keep it.

**T-11 Single-shop builds go stale.** Prerendered pages and sitemap on workers.dev / `SINGLE_SHOP_HOSTS` only change on rebuild. Investigation: move those hosts to the per-request Worker path (as shop subdomains already are) and retire `scripts/prerender.ts`. Output: whether any host still needs the build-time path.

## Not now

- Rewriting titles and descriptions: the per-page meta in `seo.ts` is already specific; fix status codes first.
- More structured data types: products, articles, breadcrumbs and business are already covered.
