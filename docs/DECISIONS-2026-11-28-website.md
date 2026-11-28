# Decisions: customer website pass (2026-11-28)

Made without asking (unattended-work rule). Change any of them by saying so.

1. Kept the existing design engine (presets, layouts, brand tokens) instead of rebuilding it. It already gives 9 looks, 11 industries and a section builder; a rewrite would have reset every shop's look.
2. "Most customizable": added a third product-row layout, "Compact list", to Offers, Products, Most reviewed, Aisles and Recently viewed. The app's Homepage builder lists it automatically; no database change (variants are not checked by the database).
3. Faster first screen: the Worker embeds the shop's data in the page (up to 600 KB) and the app refreshes it in the background. Prices on screen can be up to 5 minutes old for a moment; the order is still priced by the database.
4. robots.txt now blocks only /search; private pages rely on their noindex tag.
5. Single-shop hosts (workers.dev, SINGLE_SHOP_HOSTS): fallback page is noindex. A product added after the last build is not indexed there until a rebuild. Shop subdomains are not affected.
6. Added a dev-only demo shop (`VITE_DEMO_SHOP=1 npm run website:dev`) because live has no published shop to look at. It is not in production builds.
7. No visual redesign of the theme: no screenshots could be reviewed this session, so I did not change colours, type or layout of existing sections blind.

## Later the same day: visual rebuild per business type

8. Supersedes 7: the owner asked for the visual rebuild with "Test 1" as the design test. No shop called Test 1 could be read (the database check was refused in this session), so "Test 1" is the dev design-test shop: `?demo=<industry>` switches the kind of business, `&preset=<design>` the design. Non-food kinds use stock photos from picsum.photos (dev only, unrelated pictures, just to fill the layouts).
9. Canva design feedback was not used: the Canva connector is not signed in. The review was done from screenshots of Test 1 at 1366px and 390px instead.
10. Five new designs, each the default for one industry: food = Fresh market, restaurant = Bistro, fashion = Editorial, pharmacy = Care, hardware = Workshop. Beauty, electronics, services, logistics and general shops keep their previous default. Shops with the Original design (all existing shops) are unchanged.
11. New home arrangements for food, fashion, pharmacy and hardware, and new variants on electronics, restaurant, services and logistics pages. Saved arrangements are untouched.
12. Display fonts (Syne, Bebas Neue, DM Serif Display, Abril Fatface) are for headings only: the app does not offer them for text, and the website ignores one saved for text.
13. Colour sets fill the four existing colour fields; no new database column.
14. New sections fall back rather than show empty: customer cards and the review slider show the old "write a review" card when there are no 4-5 star reviews; the three-picture opening needs three pictures, else the statement opening; the big-picture opening needs one picture, else the words-on-colour opening.
15. Fixed an existing bug found in the phone screenshots: the contact band's buttons made the whole page 446-454px wide on a 390px phone. They now wrap.
16. Picture tiles drop the smallest category when the count is odd (above 3), so no tile sits alone on phones.
