// Website engine tests (docs/roadmap/website-engine-audit.md): brand -> design tokens, contrast,
// fictional businesses of different kinds, and the tokens in the server-built page head.
import { readFileSync } from "fs";
import { contrast, ensureContrast, luminance } from "../../website/src/engine/color";
import { FONTS, hoursText, INDUSTRIES, PERSONALITIES, type PublicBrand } from "../../website/src/engine/brand";
import { PRESETS } from "../../website/src/engine/presets";
import { buildTokens, presetFor, tokensCss } from "../../website/src/engine/tokens";
import { homeHtml, pageHtml } from "../../website/src/render";
import { businessJsonLd } from "../../website/src/seo";
import type { Storefront } from "../../website/src/api";
import { composeHome, defaultHome, normaliseHome, SECTION_KINDS, SECTION_VARIANTS } from "../../website/src/engine/layout";
import { visibleHeroSlides, defaultHeroSlides } from "../../website/src/heroSlides";
import { visibleAdCards } from "../../website/src/adCards";
import { defaultMenu, isCurrentLink, menuLinks, safeMenuHref } from "../../website/src/engine/navigation";
import { homeMeta } from "../../website/src/seo";
import { brokenLink, checkWebsite, hasPlaceholder, SITE_SECTIONS, type SiteFacts } from "../../website/src/engine/checks";
import { isBot, VISIT_PAGES, VISIT_SOURCES, visitPage, visitSource } from "../../website/src/engine/visits";
import { rpcCacheKey } from "../../website/worker/hosts";

type Run = (name: string, fn: () => void) => void;

const eq = (got: unknown, want: unknown, what: string) => {
  if (JSON.stringify(got) !== JSON.stringify(want)) throw new Error(`${what}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
};
const ok = (cond: boolean, what: string) => {
  if (!cond) throw new Error(what);
};

/** Five fictional businesses (brief section 14), each with only what a real owner might fill in. */
export const TEST_BRANDS: Record<string, { primary: string | null; brand: PublicBrand }> = {
  beauty: { primary: "#e8b4b8", brand: { industry: "beauty", tagline: "Skin care, slowly made" } },
  dairy: { primary: "#2f7d4f", brand: { industry: "food_grocery", openingHours: [{ day: 0, open: "07:00", close: "19:00" }] } },
  electronics: { primary: "#1d5bd8", brand: { industry: "electronics", accentColor: "#ffcc00" } },
  services: { primary: "#1f3a5f", brand: { industry: "professional_services", secondaryColor: "#0b1f33" } },
  logistics: { primary: "#f59e0b", brand: { industry: "logistics" } },
};

const site = (primary: string | null, brand?: PublicBrand): Storefront =>
  ({
    business: { name: "Test <Shop>", description: "", address: null, contactEmail: null, contactPhone: null, logoUrl: null, coverImageUrl: null, primaryColor: primary, currency: "KSh", paymentMethods: [] },
    settings: { deliveryEnabled: true, deliveryFee: 0, minOrder: 0, assistantEnabled: false },
    products: [],
    brand,
  }) as unknown as Storefront;

export function runWebsiteEngineTests(runTest: Run) {
  runTest("Website engine: WCAG contrast maths", () => {
    eq(Math.round(contrast("#000000", "#ffffff") * 10) / 10, 21, "black on white");
    eq(contrast("#777777", "#777777"), 1, "same colour");
    ok(Math.abs(contrast("#767676", "#ffffff") - 4.54) < 0.02, "#767676 on white is 4.54");
    ok(luminance("#ffffff") === 1 && luminance("#000000") === 0, "luminance ends");
    for (const c of ["#ffff00", "#e8b4b8", "#f59e0b", "#00ff00"]) {
      const fixed = ensureContrast(c, "#ffffff", 4.5);
      ok(contrast(fixed, "#ffffff") >= 4.5, `${c} deepened to readable (${fixed})`);
    }
    eq(ensureContrast("#1d5bd8", "#ffffff", 4.5), "#1d5bd8", "a readable colour is kept");
  });

  runTest("Website engine: the brand vocabulary matches the database rules", () => {
    const sql = ["20261206001_website_brand.sql", "20261216001_website_more_fonts_designs.sql"]
      .map((f) => readFileSync(`supabase/migrations_archive/${f}`, "utf8")).join("\n");
    for (const f of Object.keys(FONTS)) ok(sql.includes(`'${f}'`), `font ${f} allowed in the database`);
    for (const i of INDUSTRIES) ok(sql.includes(`'${i.id}'`), `industry ${i.id} allowed in the database`);
    for (const p of PERSONALITIES) ok(sql.includes(`'${p.id}'`), `personality ${p.id} allowed in the database`);
    for (const p of Object.keys(PRESETS)) ok(sql.includes(`'${p}'`), `preset ${p} allowed in the database`);
  });

  runTest("Website engine: existing shops keep the original look", () => {
    eq(presetFor({ designPreset: "original" }), "original", "seeded preset");
    eq(presetFor(undefined), "friendly", "no brand row: general shop default");
    const t = buildTokens("#c2571a", { designPreset: "original" });
    ok(!("--color-cream" in t.vars) && !("--radius-md" in t.vars), "original look leaves the theme palette and corners alone");
    // The old ember (#c2571a) is 4.4:1 on cream, just under AA for text: a barely deeper shade is used.
    ok(contrast(t.vars["--color-ember"], "#fffdf9") >= 4.5 && contrast(t.vars["--color-ember"], "#c2571a") < 1.15, "ember buttons stay, readable");
    eq(t.vars["--btn-radius"], "999px", "pill buttons stay");
    ok(t.fontHref.includes("family=Poppins"), "Poppins stays");
    eq(buildTokens("#9a4313", { designPreset: "original" }).notes, [], "a readable colour is not adjusted");
    eq(t.notes.length, 1, "a too-light colour is adjusted and the owner told");
  });

  runTest("Website engine: five kinds of business get distinct, readable designs", () => {
    const seen = new Map<string, string>();
    for (const [name, { primary, brand }] of Object.entries(TEST_BRANDS)) {
      const t = buildTokens(primary, brand);
      const v = t.vars;
      const page = v["--color-cream"];
      ok(!!page, `${name}: full palette`);
      for (const k of ["--color-ink", "--color-muted", "--color-ember", "--color-brand"]) {
        ok(contrast(v[k], page) >= 4.5, `${name}: ${k} ${v[k]} reads on the page ${page}`);
      }
      ok(contrast(v["--color-ember"], v["--color-on-ember"]) >= 4.5, `${name}: button text reads`);
      ok(contrast(v["--color-hero"], "#ffffff") >= 7, `${name}: white text reads on dark bands`);
      ok(contrast(v["--color-muted"], v["--color-shell"]) >= 4.5, `${name}: grey text reads on panels`);
      const signature = [t.design.preset.id, t.design.headingFont, v["--btn-radius"], v["--radius-md"], v["--img-fit"], v["--img-ratio"], v["--section-space"]].join("|");
      ok(!seen.has(signature), `${name} looks the same as ${seen.get(signature)}`);
      seen.set(signature, name);
    }
    const beauty = buildTokens(TEST_BRANDS.beauty.primary, TEST_BRANDS.beauty.brand);
    eq(beauty.design.preset.id, "premium", "beauty starts premium");
    eq([beauty.vars["--img-fit"], beauty.vars["--img-ratio"]], ["cover", "4 / 5"], "beauty shows portrait photos");
    ok(beauty.notes.some((n) => n.token === "primary"), "pale pink is deepened and the owner is told");
    const dairy = buildTokens(TEST_BRANDS.dairy.primary, TEST_BRANDS.dairy.brand);
    eq([dairy.vars["--img-fit"], dairy.vars["--btn-radius"]], ["contain", "999px"], "groceries show whole products, round buttons");
    const elec = buildTokens(TEST_BRANDS.electronics.primary, TEST_BRANDS.electronics.brand);
    eq(elec.vars["--color-accent"], "#ffcc00", "accent used for offers");
    ok(contrast(elec.vars["--color-accent"], elec.vars["--color-on-accent"]) >= 4.5, "dark text on yellow offers");
  });

  runTest("Website engine: the shop's own choices beat the preset; bad values fall back", () => {
    const t = buildTokens("#123456", { industry: "beauty", headingFont: "Inter", headingWeight: 900, cornerStyle: "round", buttonStyle: "solid", imageStyle: "cutout", density: "compact" });
    eq(t.design.headingFont, "Inter", "chosen font");
    eq(t.design.headingWeight, 800, "nearest weight the font has");
    eq([t.vars["--radius-md"], t.vars["--btn-radius"], t.vars["--img-fit"], t.vars["--section-space"]], ["12px", "12px", "contain", "1.75rem"], "chosen shapes");
    const bad = buildTokens("red", { headingFont: "Comic Sans" as never, backgroundColor: "#101010", designPreset: "nope" as never });
    eq(bad.design.primary, PRESETS[bad.design.preset.id].primary, "invalid colour: preset colour");
    eq(bad.design.page, PRESETS[bad.design.preset.id].page, "dark background refused");
    ok(bad.design.headingFont !== ("Comic Sans" as never), "unknown font refused");
  });

  runTest("Website engine: token CSS cannot break out of its style tag", () => {
    const t = buildTokens("#1d5bd8", { industry: "electronics" });
    t.vars["--evil"] = "red;}</style><script>alert(1)</script>";
    t.vars["bad name"] = "#fff";
    const css = tokensCss(t);
    ok(!css.includes("<") && !css.includes("evil") && !css.includes("bad name"), "unsafe values dropped");
    ok(css.startsWith(":root{--font-sans:"), "root block");
  });

  runTest("Website engine: tokens, fonts and icon are in the server-built head", () => {
    const template = readFileSync("website/index.html", "utf8");
    ok(template.includes('id="brand-fonts"'), "template has the font link to replace");
    const html = pageHtml(template, { title: "T", description: "D", path: "/" }, site("#1d5bd8", { industry: "electronics", faviconUrl: "https://img.test/fav.png" }), "https://x.test", "", { indexable: true, shop: { slug: "x", poweredBy: false, ordersOpen: true, platformName: null, platformUrl: null } });
    ok(html.includes('<style id="brand-tokens">:root{'), "tokens in head");
    ok(html.includes("family=Space+Grotesk"), "technical fonts loaded");
    ok(!html.includes("family=Poppins"), "default font not loaded");
    ok(html.includes('<link rel="icon" href="https://img.test/fav.png" />'), "favicon");
    ok(html.indexOf('id="brand-tokens"') < html.indexOf("</head>"), "before body");
  });

  runTest("Website engine: hours and socials reach structured data", () => {
    eq(hoursText([{ day: 0, open: "08:00", close: "18:00" }, { day: 1, open: "08:00", close: "18:00" }, { day: 5, open: "09:00", close: "13:00" }]), "Mon-Tue 08:00-18:00; Sat 09:00-13:00", "grouped hours");
    eq(hoursText([]), null, "no hours");
    const ld = businessJsonLd(site(null, { industry: "food_grocery", tagline: "Fresh daily", socialLinks: { instagram: "https://instagram.com/x" }, openingHours: [{ day: 6, open: "10:00", close: "24:00" }] }), "https://x.test") as Record<string, unknown>;
    eq(ld["@type"], "GroceryStore", "industry type");
    eq(ld.sameAs, ["https://instagram.com/x"], "socials");
    eq((ld.openingHoursSpecification as { closes: string }[])[0].closes, "23:59", "midnight close");
    eq(ld.slogan, "Fresh daily", "tagline");
  });

  runTest("Website engine: the original design keeps the old home page, section for section", () => {
    const old = "hero categories adverts strip promotions offers products reviewed strip2 aisles trust testimonials recent guides contact";
    eq(composeHome({ designPreset: "original", industry: "beauty" }).map((s) => s.kind).join(" "), old, "order");
    eq(composeHome(undefined).map((s) => s.kind).join(" "), old, "older database without a brand");
    const titles = Object.fromEntries(composeHome({ designPreset: "original" }).map((s) => [s.kind, s.title]));
    eq([titles.categories, titles.offers, titles.products], ["Top Picks by Category", "Exclusive Offers", "Our Products"], "old headings");
    ok(composeHome({ designPreset: "original" }).every((s) => s.variant === SECTION_VARIANTS[s.kind][0]), "old variants");
  });

  runTest("Website engine: five kinds of business get different home pages", () => {
    const shapes = Object.entries(TEST_BRANDS).map(([name, t]) => {
      const home = composeHome(t.brand);
      ok(home.length >= 8, `${name}: a full page`);
      eq(home[0].kind, "hero", `${name}: opens with the banner`);
      eq(home[home.length - 1].kind, "contact", `${name}: ends with contact`);
      eq(new Set(home.map((s) => s.kind)).size, home.length, `${name}: each section once`);
      return home.map((s) => `${s.kind}:${s.variant}`).join(" ");
    });
    eq(new Set(shapes).size, 5, "all five differ");
    const services = composeHome(TEST_BRANDS.services.brand);
    eq(services[0].variant, "banner", "services open on words, not product photos");
    eq(services.find((s) => s.kind === "products")?.title, "Our services", "services say services");
    ok(!services.some((s) => ["aisles", "adverts", "trust"].includes(s.kind)), "no shop aisles or delivery promises for a firm");
    eq(services.at(-1)?.title, "Talk to us", "a firm's closing band");
    eq(composeHome(TEST_BRANDS.beauty.brand)[0].variant, "statement", "beauty opens editorially");
    eq(composeHome({ industry: "food_grocery", personality: "premium" }).find((s) => s.kind === "products")?.variant, "grid", "premium shows a calm grid");
  });

  runTest("Website engine: a saved home page is cleaned before use", () => {
    const saved = [
      { kind: "story", variant: "centred", title: "  Who   we are  " },
      { kind: "story" },
      { kind: "<script>" },
      { kind: "products", variant: "marquee" },
      { kind: "trust", hidden: true },
      { kind: "hero", title: "x".repeat(200) },
      "junk", null,
    ];
    const clean = normaliseHome(saved);
    eq(clean.map((s) => s.kind), ["story", "products", "trust", "hero"], "unknown and repeated sections dropped");
    eq(clean[0].title, "Who we are", "heading tidied");
    eq(clean[1].variant, undefined, "unknown variant dropped");
    eq(clean[3].title?.length, 60, "heading cut to length");
    const drawn = composeHome({ industry: "beauty" }, saved);
    eq(drawn.map((s) => s.kind), ["story", "products", "hero"], "hidden sections not drawn");
    eq(drawn[1].variant, "carousel", "default variant");
    eq(composeHome({ industry: "beauty" }, "not a list").length, defaultHome({ industry: "beauty" }).length, "garbage = default");
    for (const k of SECTION_KINDS) ok(SECTION_VARIANTS[k].length > 0, `${k} has a variant`);
  });

  runTest("Website engine: built-in words fit the business, with no dairy left", () => {
    const all = JSON.stringify([
      ...Object.values(TEST_BRANDS).flatMap((t) => [defaultHeroSlides(t.brand.industry), visibleAdCards([], [], t.brand.industry)]),
      defaultHeroSlides(undefined),
    ]);
    ok(!/dairy|milk/i.test(all), "no dairy words or ids");
    ok(/Fresh/.test(JSON.stringify(visibleAdCards([], [], "food_grocery"))), "food keeps its fresh words");
    ok(!/Fresh/.test(JSON.stringify(visibleAdCards([], [], "electronics"))), "electronics does not say fresh");
    eq(visibleHeroSlides([], false, [], "logistics").some((s) => s.ctaHref === "/track"), true, "logistics links tracking");
    eq(visibleHeroSlides([], false, [], "beauty").some((s) => s.ctaHref === "/articles"), false, "no guides slide without guides");
    const saved = [{ id: "a", title: "Mine", images: ["https://x.test/a.webp"] }];
    eq(visibleHeroSlides(saved, false, [], "beauty").map((s) => s.title), ["Mine"], "saved slides win");
  });

  runTest("Website engine: the home page HTML carries tagline, story and hours", () => {
    const s = site("#2f7d4f", { tagline: "Milk <fresh>", story: "Since 1998", openingHours: [{ day: 0, open: "08:00", close: "17:00" }] });
    const home = homeHtml(s, "<ul><li>Milk</li></ul>", "<ul></ul>");
    ok(home.includes("Milk &lt;fresh&gt;"), "tagline, escaped");
    ok(home.includes("Since 1998") && home.includes("Mon 08:00-17:00"), "story and hours");
    ok(!home.includes("Guides"), "no empty guides heading");
  });

  // Phases 4-5 (20261206002): the draft's rules match the website's.
  runTest("Website: home sections and menu links follow the same rules in the database", () => {
    const sql = readFileSync("supabase/migrations_archive/20261206002_website_drafts_publish.sql", "utf8");
    const list = sql.match(/COALESCE\(e->>'kind', ''\) = ANY \(ARRAY\[([^\]]+)\]/)![1];
    const kinds = Array.from(list.matchAll(/'([a-z0-9]+)'/g), (m) => m[1]);
    eq(kinds, SECTION_KINDS, "section kinds in fn_valid_home");
    ok(sql.includes("'^/([A-Za-z0-9_~%+=&?.#-][A-Za-z0-9/_~%+=&?.#-]*)?$'"), "same page-link rule in fn_valid_link");
    for (const good of ["/", "/shop", "/shop?offers=1", "/articles/my-guide", "https://blog.example.com/x"]) eq(safeMenuHref(good), good, good);
    for (const bad of ["javascript:alert(1)", "//evil.test", "http://x.test", "/a b", "https://x.test/\"onmouseover", "data:text/html,x"]) eq(safeMenuHref(bad), null, bad);
  });

  runTest("Website: the menu fits the business, and a saved menu is cleaned", () => {
    const labels = (brand: Partial<PublicBrand>, offers = false) => defaultMenu(brand as PublicBrand, offers).map((l) => l.label);
    eq(labels({ designPreset: "original", industry: "professional_services" }, true),
      ["Home", "Shop", "Offers", "Regular orders", "About us", "Track order", "Help"], "original design keeps the old menu");
    const firm = labels({ industry: "professional_services" });
    ok(!firm.includes("Track order") && !firm.includes("Regular orders") && firm.includes("Contact"), "a firm gets no delivery links");
    ok(labels({ industry: "logistics" }).includes("Track order"), "a courier keeps Track order");
    eq(labels({ industry: "restaurant" })[1], "Menu", "a restaurant shops from its Menu");
    const saved = menuLinks({ header: [{ label: " Blog ", href: "https://blog.example.com" }, { label: "Bad", href: "javascript:x" }, { label: "", href: "/shop" }] }, undefined, false);
    eq(saved, [{ label: "Blog", href: "https://blog.example.com" }], "bad links dropped, labels trimmed");
    eq(menuLinks({ header: [{ label: "Bad", href: "//x" }] }, { industry: "beauty" }, false).length > 0, true, "nothing usable: the default menu");
    ok(isCurrentLink("/shop", "/shop?category=milk") && !isCurrentLink("/shop", "/shop?offers=1") && isCurrentLink("/shop?offers=1", "/shop?offers=1"), "current link");
    ok(!isCurrentLink("/", "/about") && isCurrentLink("/", "/"), "home is current only on the home page");
  });

  runTest("Website: the shop's own search text leads the home page meta", () => {
    const site = { business: { name: "Lumiere", description: "Skin care", currency: "KES" }, brand: {}, products: [], articles: [], branches: [], settings: {} } as unknown as Storefront;
    eq(homeMeta(site, "https://x.test").title, "Lumiere | Order online", "automatic title");
    const own = homeMeta({ ...site, seo: { title: "Lumiere Skin Studio, Nairobi", description: "Small-batch skin care", shareImage: "https://img.test/a.jpg" } } as Storefront, "https://x.test");
    eq([own.title, own.description, own.image], ["Lumiere Skin Studio, Nairobi", "Small-batch skin care", "https://img.test/a.jpg"], "own title, description and picture");
    eq(homeMeta({ ...site, seo: { shareImage: "http://img.test/a.jpg" } } as Storefront, "https://x.test").image, undefined, "only https sharing pictures");
  });
  /** A shop as a real owner might leave it: the facts the checks read, nothing invented. */
  const shop = (over: Partial<SiteFacts> = {}): SiteFacts => ({
    name: "Green Valley Dairy", slug: "green-valley", primaryColor: "#2f7d4f", description: "Fresh milk from our farm in Limuru.",
    logoUrl: "https://img.test/logo.png",
    brand: { industry: "food_grocery", tagline: "Milk from our farm", story: "Started in 2015.", openingHours: [{ day: 0, open: "07:00", close: "19:00" }], socialLinks: { instagram: "https://instagram.com/gv" } },
    contact: { phone: "0712 345 678", email: null, whatsapp: null, address: null, hoursText: null },
    products: { shown: 12, withPicture: 10 }, heroSlides: [], adCards: [], navigation: null, seo: null, pages: {},
    ...over,
  });

  runTest("Website checks: the link check knows every page of the website", () => {
    const app = readFileSync("website/src/App.tsx", "utf8");
    const cases = Array.from(app.matchAll(/case '([a-z-]+)':/g), (m) => m[1]).sort();
    eq(cases, [...SITE_SECTIONS].sort(), "SITE_SECTIONS matches the website's routes");
    for (const good of ["/", "/shop?offers=1", "/about", "/terms", "/products/abc", "/articles", "/articles/x", "/account/schedules", "https://blog.example.com"]) ok(!brokenLink(good), `${good} works`);
    for (const bad of ["/abuot", "/products", "/promo", "/about/x", "javascript:alert(1)", "http://x.test"]) ok(brokenLink(bad), `${bad} is broken`);
    ok(!brokenLink("/promo/easter-week"), "an offer page works");
    ok(!brokenLink(undefined) && !brokenLink(""), "no link is not a broken link");
    ok(hasPlaceholder("Lorem ipsum dolor") && hasPlaceholder("TODO: write this") && hasPlaceholder("Visit example.com"), "placeholders found");
    ok(!hasPlaceholder("Today we deliver") && !hasPlaceholder("Toddler clothes") && !hasPlaceholder(null), "real words are not placeholders");
  });

  runTest("Website checks: five fictional shops get the score they deserve", () => {
    const finished = checkWebsite(shop({ seo: { shareImage: "https://img.test/s.jpg" } }));
    eq([finished.status, finished.score, finished.blockers.length], ["ready", 100, 0], "a finished dairy");

    const beauty = checkWebsite(shop({ name: "Lumiere", primaryColor: "#e8b4b8", brand: { industry: "beauty" }, logoUrl: null, description: null, products: { shown: 6, withPicture: 1 } }));
    eq(beauty.status, "needs_work", "a new beauty shop works but needs work");
    for (const id of ["logo", "description", "pictures", "colours"]) ok(beauty.checks.some((c) => c.id === id && !c.passed), `beauty: ${id} open`);
    ok(beauty.score < 70 && beauty.score > 0, `beauty score ${beauty.score}`);

    const firm = checkWebsite(shop({ name: "Kipchoge & Mwangi", contact: { phone: null, email: null, whatsapp: null, address: "Westlands", hoursText: null }, navigation: { header: [{ label: "Services", href: "/servcies" }] } }));
    eq(firm.status, "blocked", "a firm with no contact and a typo link is blocked");
    eq(firm.blockers.map((b) => b.id).sort(), ["contact", "links"], "both blockers named");
    ok(firm.blockers.find((b) => b.id === "links")!.detail.includes('menu link "Services"') && firm.blockers.find((b) => b.id === "links")!.fix === "menu", "the link blocker names the link and opens Menu");

    const electronics = checkWebsite(shop({ heroSlides: [{ title: "Lorem ipsum deals", images: [] } as never, { title: "Hidden lorem ipsum", hidden: true, images: [] } as never] }));
    eq(electronics.blockers.map((b) => b.id), ["placeholders"], "a visible placeholder banner blocks; a hidden one does not count");

    const courier = checkWebsite(shop({ slug: null, products: { shown: 0, withPicture: 0 }, contact: { phone: null, email: null, whatsapp: "254712345678", address: null, hoursText: "Mon-Sat 7am-7pm" }, brand: { industry: "logistics" } }));
    eq(courier.status, "needs_work", "a courier with WhatsApp only is not blocked");
    ok(courier.checks.some((c) => c.id === "address" && !c.passed) && courier.checks.some((c) => c.id === "products" && !c.passed), "no address and no products are warnings");
    ok(courier.checks.some((c) => c.id === "hours" && c.passed), "hours written as text count");
    ok(!courier.checks.some((c) => c.id === "pictures"), "no picture check without products");

    ok(checkWebsite(shop({ seo: { title: "x".repeat(65) } })).checks.some((c) => c.id === "seo_title" && !c.passed), "a long search title is a warning");
  });

  runTest("Visit counter: page kinds and sources match the database, and nothing personal is sent", () => {
    const sql = readFileSync("supabase/migrations_archive/20261208001_website_visits_domain_recheck.sql", "utf8");
    const list = (re: RegExp) => Array.from((sql.match(re)?.[1] ?? "").matchAll(/'([a-z]+)'/g), (m) => m[1]);
    eq(list(/page text NOT NULL CHECK \(page IN \(([^)]*)\)/), [...VISIT_PAGES], "page kinds = table check");
    eq(list(/source text NOT NULL CHECK \(source IN \(([^)]*)\)/), [...VISIT_SOURCES], "sources = table check");
    eq(list(/p_page NOT IN \(([^)]*)\)/), [...VISIT_PAGES], "page kinds = counter check");

    eq([[], ["shop"], ["products", "p1"], ["about"], ["about", "x"], ["promo", "easter"], ["order-confirmed", "o1"], ["reviews"]].map(visitPage),
      ["home", "shop", "product", "info", "other", "campaign", "order", "other"], "page kinds");
    eq(visitSource("", "dairy.denso.app"), "direct", "no referrer = typed in");
    eq(visitSource("https://www.google.co.ke/", "dairy.denso.app"), "search", "Google");
    eq(visitSource("https://l.facebook.com/l.php?u=x", "dairy.denso.app"), "social", "Facebook link");
    eq(visitSource("https://t.co/abc", "dairy.denso.app"), "social", "X link");
    eq(visitSource("https://blog.example.org/post", "dairy.denso.app"), "site", "another website");
    eq(visitSource("https://dairy.denso.app/shop", "dairy.denso.app"), null, "own website = not a new visit");
    eq(visitSource("not a url", "dairy.denso.app"), "direct", "garbage referrer");
    ok(isBot("Mozilla/5.0 (compatible; Googlebot/2.1)", false) && isBot("WhatsApp/2.23", false) && isBot("Mozilla/5.0 Chrome/120", true), "robots, link previews and automated browsers");
    ok(!isBot("Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36", false), "a phone browser is a visitor");

    // Nothing about the visitor in the table or the call.
    const table = sql.slice(sql.indexOf("CREATE TABLE IF NOT EXISTS public.website_visit_daily"), sql.indexOf("COMMENT ON TABLE public.website_visit_daily"));
    eq(Array.from(table.matchAll(/^ {4}([a-z_]+) [a-z]/gm), (m) => m[1]), ["business_id", "day", "page", "source", "views"], "only these columns: no address, device or visitor");
    const call = readFileSync("website/src/api.ts", "utf8").match(/record_website_view', \{([^}]*)\}/)?.[1] ?? "";
    eq(Array.from(call.matchAll(/(p_[a-z]+):/g), (m) => m[1]), ["p_slug", "p_page", "p_source", "p_landing"], "the website sends only these four");
    ok(!/localStorage|sessionStorage|cookie/.test(readFileSync("website/src/useVisitCounter.ts", "utf8").replace(/^\/\/.*$/gm, "")), "the counter stores nothing in the browser");
  });

  runTest("Worker cache: one shop's answer is never another shop's", () => {
    ok(rpcCacheKey("get_public_storefront", { p_slug: "green-valley" }) !== rpcCacheKey("get_public_storefront", { p_slug: "voltline" }), "different shops, different keys");
    ok(rpcCacheKey("resolve_website_host", { p_host: "a.denso.app" }) !== rpcCacheKey("resolve_website_host", { p_host: "b.denso.app" }), "different addresses, different keys");
    ok(rpcCacheKey("get_public_storefront", { p_slug: "a" }) !== rpcCacheKey("resolve_website_host", { p_slug: "a" }), "different calls, different keys");
    ok(rpcCacheKey("get_public_storefront", { p_slug: "a&p_slug=b" }) !== rpcCacheKey("get_public_storefront", { p_slug: "a" }), "a crafted name cannot reach another key");
    eq(rpcCacheKey("f", { b: "2", a: "1" }), rpcCacheKey("f", { a: "1", b: "2" }), "same call, same key");
    const worker = readFileSync("website/worker/index.ts", "utf8");
    eq((worker.match(/cache\(\)\.(put|match)\(/g) ?? []).length, 2, "the edge cache is used only by cachedRpc");
    ok(!/get_preview_storefront|website_draft/.test(worker), "drafts are never fetched or cached by the Worker");
    ok(/preview \? 'no-store'/.test(worker), "preview pages are never stored");
  });
}
