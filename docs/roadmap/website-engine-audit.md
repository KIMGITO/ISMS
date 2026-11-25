# Website engine: Phase 1 audit

**Progress:** Phase 1 done (this file). Phase 2 done 2026-11-25 (`20261206001`, `website/src/engine/`). Phase 3 done 2026-11-25 (`website/src/engine/layout.ts`, `website/src/pages/HomeSections.tsx`, industry defaults in `heroSlides.ts`/`adCards.ts`; no migration; the `'Milk care'` article default was already removed by `20261204008`). Phases 4 and 5 done together 2026-11-25 (`20261206002`: draft, versions, publish, put back, preview links, `website_stats`; app `src/features/website/`; website menu `engine/navigation.ts` and search text; screenshots `scripts/website-shots.mjs`). Phase 6 done 2026-11-25 (`website/src/engine/checks.ts`: score, blockers stop Publish in the app; Overview shows the checks; no migration). Phase 7 done 2026-11-25 (`20261208001`: private visit counter `website_visit_daily` + `record_website_view`, visits in `website_stats`, nightly own-address recheck; `website/src/engine/visits.ts`; Worker cache key `rpcCacheKey` tested per shop). Phase 8 done 2026-11-25 (`supabase/tests/website/tenants_test.sh`: five fictional businesses end to end; final report in section 9). All eight phases built; none of it is live yet. Owner decisions 2026-11-25: brand per shop; split Online Store into Online orders and Website; count anonymous visits; fonts from an allow-list.

Date: 2026-11-25. Scope: the customer website (`website/`), its Worker, the database behind it,
and the app's Online Store screen. Nothing has been changed yet. This file is the baseline for
phases 2 to 8.

Terms used here, as in the code: a **company** is a tenant (`tenants`); a **shop** is a
`businesses` row (one per branch) that has a website name (`businesses.website_slug`). One
company can have several shops; the website lets customers switch between shops of the same owner.

## 1. Existing architecture

### Request path

```
visitor -> Cloudflare Worker (website/worker/index.ts)
             |  host -> resolve_website_host(host)        cached 60 s at the edge, key = host
             |         none | platform | redirect | closed | shop{slug, host, ...}
             |  shop -> get_public_storefront(slug)       cached 300 s at the edge, key = slug
             |         one JSON: business, settings, pages, hero slides, adverts, stores,
             |         loyalty, 300 reviews, promotions, zones, branches, ALL products, articles
             |  renderRoute(shell.tpl, storefront, path)  real <head> + readable HTML per route
             v
browser  -> same React SPA (website/src) reads <meta name="shop">, fetches the storefront again,
            applies the brand colour, renders the page
```

- `*.workers.dev`, `localhost` and `SINGLE_SHOP_HOSTS` skip the database and serve pages
  prerendered at build time for one fixed shop (`website/scripts/prerender.ts`, slug from
  `VITE_WEBSITE_SLUG`, fallback `kaykays`).
- The platform's bare domain serves the public plans page (`worker/plansPage.ts`).

### Tenant to website

- `businesses.website_slug` = subdomain `<slug>.<platform_domain>`. Rules in
  `fn_website_slug_guard` (3-40 chars, reserved words, two renames a year, 90-day redirects via
  `website_slug_history`).
- `website_domains` (one own domain per shop): Cloudflare for SaaS through the `website-domain`
  edge function (add / check / remove). Status `pending | active | failed`, DNS records stored.
- `fn_website_shop` decides open / orders open / "powered by" from the company's plan
  (`online_store`, `own_domain` modules).
- The Worker never trusts a client tenant id: the shop comes from the host, through the database.
  The SPA can switch to a sibling branch (`loadStartingStore`), but only to one the storefront
  lists as the same owner's.

### Data the website uses today

| Where | What |
|---|---|
| `businesses` | name, description, address, contact email/phone, `logo_url`, `cover_image_url`, `primary_color`, `secondary_color` (unused), `business_type` (free text, default `Retail`), currency, payment methods |
| `website_settings` (one row per shop) | delivery on/fee, min order, assistant on, opening hours (free text), WhatsApp, `pages` jsonb (text overrides for 8 fixed info pages), `hero_slides` jsonb, `ad_cards` jsonb |
| `website_articles` | guides (title, body, category default `'Milk care'`, cover, published flag) |
| `website_reviews`, `website_product_ideas(+_votes)`, `website_promo_codes` | reviews, idea voting, promo codes |
| `products` | `show_on_website`, `website_was_price`, `image` |
| storage `business-logos` (public) | every website picture, under the shop's folder; resized on the device to 1600 px WebP |

RLS: `website_settings` / `website_articles` readable by members, writable with
`business.update` (fixed in `20261130006`). Grants to `authenticated` exist.

### Look and layout

- One theme for every shop: `website/src/theme.css` (575 lines) with a fixed warm cream/amber
  palette, Poppins only, fixed radii and shadows. Only `--brand-primary` changes per shop, and
  only on "small accents". Many pages use `amber-*`, `ember`, `sand` classes directly.
- The brand colour is applied in the browser after the storefront loads (`applyBrandColor`), so
  the server-rendered HTML and the first paint show the default amber. Text colour on the brand
  colour comes from a simple brightness threshold, not a WCAG contrast check.
- One home page composition, fixed order (`pages/HomePage.tsx`): hero carousel, promo codes,
  category circles, advert posters, products, guides.
- Pages: 8 fixed info pages (`website/src/infoPages.ts`); a shop can only replace their text.
  No custom pages, no page order or visibility, no per-page SEO, no navigation control.

### SEO and performance

- Good base: server-built `<title>`, description, canonical, Open Graph, JSON-LD (business,
  product, article), per-shop `robots.txt` and `sitemap.xml`, strict CSP and security headers.
- Pictures: one size (up to 1600 px WebP), no `srcset`, no width/height stored, no alt text on
  hero slides or adverts.
- The storefront JSON carries the whole catalogue, 300 reviews and full article bodies on every
  page view, both at the edge and again in the browser.
- Google Fonts loaded from `index.html` for Poppins only.

### Management in the app

- `src/features/OnlineStoreView.tsx` (1,184 lines): one screen with 10 tabs that mixes daily
  operations (Orders, Messages, Feedback, Reviews, Product ideas) with website building (Guides,
  Home banner, Adverts, Pages, Website settings).
- Editors: `HeroSlidesEditor` (845 lines, drag/zoom pictures, device preview), `AdCardsEditor`,
  `PageEditor` + `InlineEditable` (rich text), `WebAddressCard` (name + own domain).
- Every save goes live straight away (after up to 5 minutes of edge cache).

## 2. What works and should be kept

1. Host-based tenant resolution in the database, slug rules, redirects, own domains through
   Cloudflare for SaaS, plan gating. Keep and extend; do not rebuild.
2. Server-rendered SEO head and per-shop sitemap/robots. Extend with per-page settings.
3. Hero slide and advert editors (picture positioning, device preview). Reuse them as homepage
   section editors.
4. Rich text format (`richFormat.ts`) rendered as React elements, never raw HTML on the website.
5. Client-side picture shrinking and per-shop storage folders.
6. Edge cache keys are per host and per slug, so one shop's page cannot be served for another.

## 3. Limitations and missing capabilities

| # | Gap | Effect |
|---|---|---|
| L1 | One fixed palette, one font, one radius set for every shop | A beauty brand and a dairy shop look the same apart from one accent colour |
| L2 | No brand profile: no industry category, personality, tone, fonts, favicon, logo variants, socials, mission, structured hours | The engine has nothing to design from |
| L3 | Brand colour applied only after JavaScript runs; no contrast check | Colour flash, possible unreadable buttons |
| L4 | One fixed home page composition | No layout variety between businesses |
| L5 | Fixed 8 info pages, text only | No custom pages, URLs, visibility, order or page SEO |
| L6 | No navigation management | Header/footer menus are hardcoded in `Layout.tsx` |
| L7 | No draft / publish / history / rollback | Every edit is live at once; no safe preview of unsaved work |
| L8 | No cache invalidation | Changes appear after up to 5 minutes; nothing purges on change |
| L9 | No media library: pictures exist only as URLs inside JSON; no alt text, sizes, categories | No reuse, no alt text checks, no responsive images |
| L10 | Whole catalogue in every storefront call | Slow first load and large edge objects for big catalogues |
| L11 | No quality checks or readiness score | Nothing tells a shop its website is incomplete |
| L12 | No visitor statistics at all | An analytics screen can only show real order data unless we start counting visits |
| L13 | Dairy-specific defaults: hero slides `fresh-milk`, `dairy`; advert `ad-dairy`; article category default `'Milk care'`; storage keys `kaykays-*`; slug fallback `kaykays` | New shops of other kinds inherit a dairy shop's content |
| L14 | Management is one 10-tab screen mixing operations and website building | The pattern the brief asks to replace |
| L15 | Own-domain status is only checked when someone presses Check | A domain that breaks later stays "active" |

## 4. Security review

| # | Finding | Severity | Recommendation |
|---|---|---|---|
| S1 | Tenant chosen by host in the database; client never supplies the tenant | OK | Keep. The new published-snapshot reader must also resolve by host/slug only |
| S2 | `get_public_storefront(slug)` is callable by anyone for any slug | Low (by design: public data) | Serve published snapshots only, so drafts never leak through it |
| S3 | Draft content would be readable through the same public function once drafts exist | Must handle in Phase 5 | Public functions read only `website_versions` rows marked published; the preview requires a signed-in member |
| S4 | Website pictures share the public `business-logos` bucket | Low | Keep bucket (public by nature); add a `website_media` table so ownership and alt text are recorded |
| S5 | Tenant-chosen fonts/colours/CSS | Must handle in Phase 2 | Fonts from an allow-list only; colours validated as hex; no free CSS or HTML anywhere |
| S6 | Custom page slugs could collide with app routes (`/cart`, `/account`) | Must handle in Phase 3 | Reserved path list enforced in the database |
| S7 | Edge cache of a draft preview could be served to visitors | Must handle in Phase 5/7 | Preview never goes through the shared cache; cache key includes published version id |

No live vulnerability was found in the current website path.

## 5. Recommended design

### Layers (maps to the brief's A-E)

| Layer | Where | Notes |
|---|---|---|
| A. Brand identity | `website_brand` table (per shop) + existing `businesses` columns as fallback | Logo, colours, fonts, personality, tone, industry, story, socials, hours |
| B. Design system | `website/src/engine/tokens.ts`: brand -> tokens (colour roles with WCAG-checked foregrounds, type scale, spacing, radii, shadows, button style) emitted as CSS variables in the server-rendered `<head>` | All components read variables; `theme.css` keeps structure only |
| C. Layout | `website/src/engine/sections/*`: each section type with 2-3 layout variants; header and footer variants | Presets ("design approaches") pick variants and token settings |
| D. Content | Pages, sections, navigation, media, products, articles, promotions | New tables below; products/articles stay where they are |
| E. Rendering | Worker builds head + tokens + readable HTML from the **published snapshot**; SPA renders the same sections | The app's preview renders the same section components with the draft |

"Brand intelligence" is a rules table, not hardcoded per-industry code: industry category +
personality pick a default design preset (fonts, radii, density, image ratio, section order),
which the shop can override field by field. Presets live in one file and are data.

### Draft and publish

- Every edit writes to the shop's **draft** (`website_drafts`, one row per shop, jsonb document
  with a version counter for concurrent-edit detection).
- **Publish** runs the quality checks, copies the draft into a new `website_versions` row
  (immutable snapshot), points `website_published` at it, and records who/when. Blocked when a
  blocking check fails.
- **Rollback** = point the shop at an older version (a new history entry, nothing deleted).
- The public storefront reads the published snapshot; operational data (products, stock, reviews,
  promotions, zones) stays live as today.
- Existing `website_settings.pages / hero_slides / ad_cards` are migrated into the first draft
  and first published version, so current shops look the same on day one.
- Cache: snapshot version id goes into the edge cache key, so a publish takes effect at once
  without a purge API; the host lookup returns the current version id.

### Management workspace (app)

Split `OnlineStoreView` in two:

- **Online orders** (existing operations: orders, messages, feedback, reviews, ideas) stays where
  it is, minus the website-building tabs.
- **Website** becomes its own area with a sidebar: Overview, Brand, Design, Pages, Home page,
  Media, Navigation, SEO, Domain & publishing, Statistics. Each is its own screen under
  `src/features/website/`. Editors with a preview use a split view on wide screens and an
  Edit / Preview toggle on phones. A shared draft store gives the unsaved / draft / published
  indicator and Save / Discard / Publish actions in one top bar.

### Quality checks

`website/src/engine/checks.ts`: pure functions over the snapshot (+ tokens), so the app, the
publish function and tests all run the same code. Categories: brand, content, SEO,
accessibility (contrast computed from tokens, alt text, heading order), performance (picture
sizes, catalogue size), functional (links resolve to real pages/products, contact actions),
domain. Each check has a weight, severity and fix text; the score is the weighted pass rate per
category, and any `blocker` stops publishing. Checks that need a real browser (Core Web Vitals,
overflow at each width) run in a Playwright script in CI against the test shops, and are labelled
as such instead of being guessed.

### Statistics

Only real data: website orders, revenue, conversion from carts that became orders (from
`online_orders`), top products. Visits need a new privacy-friendly counter (daily page views per
shop and path, no personal data, counted in the Worker with `waitUntil`). Until that exists the
screen says visits are not counted yet.

## 6. Database changes (planned)

All new, nothing dropped. Existing columns stay readable for old app versions.

| Migration | Contents |
|---|---|
| `20261206001_website_brand.sql` | `website_brand` (shop, industry, personality, tone, story, mission, audience, positioning, colours, fonts, weights, radius style, button style, image style, logo variants, favicon, socials, structured hours); allow-listed fonts; RLS with `business.update`; seeded from `businesses` for existing shops |
| `20261206002_website_content.sql` | `website_media` (url, alt, category, width, height, bytes), `website_drafts` (document jsonb, revision), `website_versions` (immutable snapshots), `website_published` pointer, `website_publish_log`; reserved page paths; migrate `pages/hero_slides/ad_cards` into draft + version 1 |
| `20261206003_website_published_storefront.sql` | `get_public_storefront` reads the published snapshot; `resolve_website_host` returns the version id; `website_publish`, `website_rollback`, `website_preview` (members only) RPCs |
| `20261206004_website_quality_stats.sql` | `website_quality_reports`, `website_daily_views` + Worker counter RPC (rate-limited), scheduled own-domain recheck |

## 7. Implementation order and dependencies

1. Phase 2 (brand + tokens) needs nothing else. Tokens must be server-rendered in Phase 3.
2. Phase 3 (engine) needs tokens; section components are what the preview in Phase 4 reuses.
3. Phase 5 (draft/publish) needs the content document shape from Phase 3; Phase 4 screens save
   into the draft, so in practice Phases 4 and 5 land together.
4. Phase 6 checks need the snapshot shape; Phase 7 caching needs the version id from Phase 5.
5. Phase 8 tests run on the local Supabase stack (`supabase_db_isms-seedtest`, the same way as
   `supabase/tests/promotions`) with five fictional shops; nothing touches the live database.

Size: this is several weeks of work in a normal team. Expect the work to land over several
sessions, phase by phase, each ending with tests and a **To finish** list.

## 8. Decisions needed from the owner

1. **Brand per shop or per company?** Recommended: per shop (`businesses` row), because that
   is what has a website, with a "copy brand from another shop" action for companies with
   several branches.
2. **Split Online Store** into "Online orders" (operations) and "Website" (building)?
   Recommended: yes.
3. **Count visits** (anonymous daily page views per path) so Statistics can show traffic?
   Recommended: yes; no cookies, no personal data.
4. **Fonts**: a curated allow-list (about 12 Google Fonts) rather than any font. Recommended.

## 9. Final report (2026-11-25)

All eight phases are built and tested on the local test database. Nothing is committed, pushed or live.

### What was built

| Phase | Result | Main files |
|---|---|---|
| 1 Audit | This document | `docs/roadmap/website-engine-audit.md` |
| 2 Brand | Brand per shop: industry, personality, colours (contrast-checked), fonts from an allow-list, tagline, hours; tokens drive the website | `20261206001`, `website/src/engine/brand.ts`, `tokens.ts`, `color.ts`, `presets.ts` |
| 3 Layouts | Homepage built from sections and variants, defaults per industry, no made-up content | `website/src/engine/layout.ts`, `website/src/pages/HomeSections.tsx` |
| 4 Workspace | Website area in the app (Overview, Brand, Homepage, Menu, Pages, Search, Address, Statistics, History); Online Store split into Online orders and Website; copy brand from another of your own shops | `src/features/website/` |
| 5 Publishing | Draft, preview link (secret, hashed, 7 days, one shop), Publish, history, put back | `20261206002` |
| 6 Quality | Readiness score; blockers stop Publish | `website/src/engine/checks.ts` |
| 7 Operations | Private visit counter (daily totals, no cookie or IP stored), nightly own-address recheck, per-shop cache keys | `20261208001`, `website/src/engine/visits.ts`, `website/worker/hosts.ts` |
| 8 Tests | Five fictional businesses end to end | `supabase/tests/website/tenants_test.sh` |

### Tests (local test build, never live)

| Test | Result |
|---|---|
| `brand_test.sh` | 33 passed |
| `drafts_test.sh` | 73 passed |
| `visits_test.sh` | 27 passed |
| `tenants_test.sh` | 124 passed |
| App tests (`npx tsx src/test/runTests.ts`) | 112 passed |

`tenants_test.sh` runs five made-up businesses (beauty, dairy, electronics, professional services, logistics; one with a second shop), each with its own owner. It checks:

- each owner saves, previews and publishes their own website;
- each live website shows only its own brand, homepage and products;
- addresses resolve on the server (subdomain, own address, case, nested names, pending, failed);
- no owner can open, save, publish, preview, put back, read statistics, read history or copy the brand of another business;
- visits are counted per business;
- a suspended plan closes only that website;
- putting one website back leaves the others alone.

### Security position

- The business is chosen on the server, from the address or the slug. A business id sent by the app is only acted on after `has_permission` agrees.
- The Worker cache key always includes the slug or address. Drafts and previews are never cached.
- Draft, history and preview tables cannot be read or written directly. Only checked functions touch them.
- No real or seeded business data. Test data lives only in the throwaway `promo_test` database.

### Known limits

- The app screens have not been opened in a browser yet.
- A visit is a landing, not a person. The same person coming twice counts twice.
- Anyone can raise a shop's visit count by calling the counter directly. It is capped at 300 pages per IP per 10 minutes.
- Publish is blocked by the readiness checks in the app only. The database checks each value but not the readiness score.
