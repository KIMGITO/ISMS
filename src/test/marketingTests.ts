// Marketing & advertising tests (docs/MARKETING_AND_ADVERTISING.md): the shared advert rules
// (website/src/ads/rules.ts) agree with the database (20261207001), pick the right adverts for
// each placement, never show expired ones, never stretch, keep links safe, and the app's time
// zone and date helpers are right. The database side has its own suite: supabase/tests/marketing.
import { readFileSync } from "fs";
import {
  adsFor, campaignStatus, ctaHref, DESIGN_SIZES, FORMATS, isSafeAdHref, mediaFit, nextRefresh, PLACEMENTS,
  popupAllowedOn, popupDue, ratioMismatch, type AdFormat, type AdPlacement, type PublicAds, type PublicCampaign,
} from "../../website/src/ads/rules";
import { clickRate, fileProblem, toZoneLocal } from "../services/marketing";
import { upcomingDates } from "../features/marketing/DashboardScreen";

type Run = (name: string, fn: () => void) => void;
const eq = (got: unknown, want: unknown, what: string) => {
  if (JSON.stringify(got) !== JSON.stringify(want)) throw new Error(`${what}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
};
const ok = (cond: boolean, what: string) => { if (!cond) throw new Error(what); };

const SQL = readFileSync("supabase/migrations/20261207001_marketing_campaigns.sql", "utf8");
const NOW = Date.parse("2026-11-27T09:00:00Z");
const iso = (offsetMin: number) => new Date(NOW + offsetMin * 60_000).toISOString();

function campaign(id: string, priority: number, creatives: [AdPlacement, AdFormat][], extra: Partial<PublicCampaign> = {}): PublicCampaign {
  return {
    id, name: id, type: "discount", priority, startsAt: iso(-60), endsAt: iso(60), tone: "brand", ctaKind: "link", ctaTarget: "/shop",
    products: [], creatives: creatives.map(([placement, format], i) => ({ id: `${id}-${i}`, placement, format })), ...extra,
  };
}
const ads = (campaigns: PublicCampaign[], placements: Partial<PublicAds["placements"]> = {}): PublicAds =>
  ({ now: iso(0), refreshAt: null, placements: placements as PublicAds["placements"], campaigns });

export function runMarketingTests(runTest: Run) {
  runTest("Marketing: formats and placements match the database", () => {
    const fmt = SQL.slice(SQL.indexOf("FUNCTION public.fn_mkt_format"), SQL.indexOf("FUNCTION public.fn_mkt_placement("));
    for (const [key, spec] of Object.entries(FORMATS)) {
      const line = fmt.split("\n").find((l) => l.includes(`WHEN '${key}'`));
      ok(!!line, `format ${key} missing in SQL`);
      if (spec.minWidth) ok(line!.includes(`"min_width":${spec.minWidth}`), `min width of ${key}`);
      if (spec.ratio) ok(line!.includes(`"ratio":${spec.ratio.toFixed(4).replace(/0+$/, "").replace(/\.$/, ".0")}`), `ratio of ${key}: ${line}`);
      ok(line!.includes(`"media":"${spec.media}"`), `media of ${key}`);
    }
    const pl = SQL.slice(SQL.indexOf("FUNCTION public.fn_mkt_placement("), SQL.indexOf("FUNCTION public.fn_mkt_valid_href"));
    for (const [key, spec] of Object.entries(PLACEMENTS)) {
      const line = pl.split("\n").find((l) => l.includes(`WHEN '${key}'`));
      ok(!!line, `placement ${key} missing in SQL`);
      ok(line!.includes(`"formats":${JSON.stringify(spec.formats)}`), `formats of ${key}`);
      ok(line!.includes(`"mobile":${JSON.stringify(spec.mobile)}`), `phone formats of ${key}`);
      ok(line!.includes(`"max_items":${spec.maxItems}`), `max items of ${key}`);
      ok(line!.includes(`"rotation":"${spec.rotation}"`), `rotation of ${key}`);
    }
    // Every design size has the format's shape.
    for (const [f, s] of Object.entries(DESIGN_SIZES)) eq(ratioMismatch(s.width, s.height, f as AdFormat) < 0.01, true, `design size of ${f}`);
    // The Canva function uses the same sizes.
    const fn = readFileSync("supabase/functions/canva-connect/index.ts", "utf8");
    for (const [f, s] of Object.entries(DESIGN_SIZES)) ok(fn.includes(`${f}: { width: ${s.width}, height: ${s.height}`), `canva size of ${f}`);
  });

  runTest("Marketing: status follows the clock like fn_mkt_status", () => {
    eq(campaignStatus("draft", iso(-10), iso(10), NOW), "draft", "draft");
    eq(campaignStatus("live", iso(10), iso(20), NOW), "scheduled", "before start");
    eq(campaignStatus("live", iso(-10), iso(10), NOW), "active", "running");
    eq(campaignStatus("live", iso(-10), null, NOW), "active", "no end");
    eq(campaignStatus("live", iso(-20), iso(-1), NOW), "completed", "after end");
    eq(campaignStatus("paused", iso(-20), iso(10), NOW), "paused", "paused");
    eq(campaignStatus("paused", iso(-20), iso(-1), NOW), "completed", "paused past its end");
    eq(campaignStatus("ended", iso(-20), iso(10), NOW), "completed", "ended early");
    eq(campaignStatus("archived", iso(-20), iso(10), NOW), "archived", "archived");
    ok(SQL.includes("WHEN p_ends IS NOT NULL AND p_now >= p_ends THEN 'completed'"), "SQL ends at the same moment");
  });

  runTest("Marketing: one placement shows only what is running, best first, never too many", () => {
    const a = campaign("a", 50, [["card", "card_4x5"], ["card", "card_4x5"]]);
    const b = campaign("b", 90, [["card", "square_1x1"]]);
    const c = campaign("c", 70, [["card", "card_4x5"], ["card", "card_4x5"]]);
    const expired = campaign("x", 100, [["card", "card_4x5"]], { endsAt: iso(-1) });
    const early = campaign("y", 100, [["card", "card_4x5"]], { startsAt: iso(1) });
    const got = adsFor(ads([a, b, c, expired, early]), "card", { now: NOW });
    eq(got.map((g) => g.creative.id), ["b-0", "c-0", "c-1"], "three highest, no expired or early");
    eq(adsFor(ads([a, b], { card: { enabled: true, maxItems: 1, rotation: "priority", intervalS: 7, popupDelayS: 8, popupEveryH: 24 } }), "card", { now: NOW }).length, 1, "placement limit");
    eq(adsFor(ads([a], { card: { enabled: false, maxItems: 3, rotation: "priority", intervalS: 7, popupDelayS: 8, popupEveryH: 24 } }), "card", { now: NOW }), [], "placement switched off");
    eq(adsFor(ads([a]), "hero", { now: NOW }), [], "nothing for an unused placement");
    eq(adsFor(null, "hero"), [], "no data");
    // The moment it ends it is gone, even before the list is fetched again.
    eq(adsFor(ads([a]), "card", { now: Date.parse(a.endsAt!) }), [], "gone at its end");
  });

  runTest("Marketing: equal campaigns take turns per visit; higher priority always first", () => {
    const x = campaign("x", 60, [["hero", "hero_16x9"]]);
    const y = campaign("y", 60, [["hero", "hero_16x9"]]);
    const low = campaign("low", 10, [["hero", "hero_16x9"]]);
    const firsts = new Set([0, 0.3, 0.6, 0.9].map((seed) => adsFor(ads([x, y, low]), "hero", { now: NOW, seed })[0].campaign.id));
    eq(Array.from(firsts).sort(), ["x", "y"], "both get the first slot");
    eq(adsFor(ads([x, y, low]), "hero", { now: NOW, seed: 0.9 })[2].campaign.id, "low", "lower priority stays last");
    const prio = adsFor(ads([x, y], { hero: { enabled: true, maxItems: 3, rotation: "priority", intervalS: 7, popupDelayS: 8, popupEveryH: 24 } }), "hero", { now: NOW, seed: 0.9 });
    eq(prio[0].campaign.id, "x", "priority mode does not rotate");
  });

  runTest("Marketing: product, category and campaign-page adverts go only where they belong", () => {
    const p = campaign("p", 50, [["product", "text"]], { products: ["prod-1"] });
    const cat = campaign("cat", 50, [["product", "text"], ["category", "wide_3x1"]], { category: "Milk" });
    const all = campaign("all", 40, [["category", "wide_3x1"]]);
    const land = campaign("land", 50, [["landing", "hero_16x9"]], { landing: "black-friday" });
    eq(adsFor(ads([p, cat]), "product", { now: NOW, productId: "prod-1", category: "Bread" }).map((a) => a.campaign.id), ["p"], "chosen product");
    eq(adsFor(ads([p, cat]), "product", { now: NOW, productId: "prod-2", category: "Milk" }).map((a) => a.campaign.id), ["cat"], "its category");
    eq(adsFor(ads([p, cat]), "product", { now: NOW, productId: "prod-2", category: "Bread" }), [], "other products");
    eq(adsFor(ads([cat, all]), "category", { now: NOW, category: "All" }).map((a) => a.campaign.id), ["all"], "whole shop page");
    eq(adsFor(ads([cat, all]), "category", { now: NOW, category: "Milk" })[0].campaign.id, "cat", "category page");
    eq(adsFor(ads([land]), "landing", { now: NOW, landing: "black-friday" }).length, 1, "its own page");
    eq(adsFor(ads([land]), "landing", { now: NOW, landing: "other" }), [], "not another page");
  });

  runTest("Marketing: button links are safe and follow the chosen action", () => {
    for (const bad of ["javascript:alert(1)", "//evil.test", "http://x.test", "data:text/html,x", "/a b", "/x\"y", "https://", ""]) ok(!isSafeAdHref(bad), `refuse ${bad}`);
    for (const good of ["/shop", "/shop?offers=1", "https://example.com", "https://shop.example.co.ke/x?y=1"]) ok(isSafeAdHref(good), `allow ${good}`);
    const base = campaign("c", 50, [["hero", "hero_16x9"]]);
    const paths = (id: string) => (id === "p1" ? "/products/milk-1l" : undefined);
    eq(ctaHref({ ...base, ctaKind: "link", ctaTarget: "javascript:x" }, paths), undefined, "unsafe link dropped");
    eq(ctaHref({ ...base, ctaKind: "product", ctaTarget: "p1" }, paths), "/products/milk-1l", "product path");
    eq(ctaHref({ ...base, ctaKind: "product", ctaTarget: "gone" }, paths), undefined, "removed product: no broken link");
    eq(ctaHref({ ...base, ctaKind: "category", ctaTarget: "Milk & Eggs" }, paths), "/shop?category=Milk%20%26%20Eggs", "category");
    eq(ctaHref({ ...base, ctaKind: "landing", landing: "bf" }, paths), "/promo/bf", "campaign page");
    eq(ctaHref({ ...base, ctaKind: "whatsapp" }, paths, "+254 712 345678"), "https://wa.me/254712345678", "WhatsApp");
    eq(ctaHref({ ...base, ctaKind: "whatsapp" }, paths, null), undefined, "no WhatsApp number");
    eq(ctaHref({ ...base, ctaKind: "none" }, paths), undefined, "no button");
    ok(SQL.includes("(p ~ '^/' AND p !~ '^//')"), "database refuses protocol-relative links too");
  });

  runTest("Marketing: pictures are judged for their format, never stretched", () => {
    eq(mediaFit({ kind: "image", width: 1920, height: 1080 }, "hero_16x9"), "ok", "exact");
    eq(mediaFit({ kind: "image", width: 1080, height: 1080 }, "hero_16x9"), "small", "square in a wide slot: small first");
    eq(mediaFit({ kind: "image", width: 2000, height: 2000 }, "hero_16x9"), "cropped", "square in a wide slot: cropped");
    eq(mediaFit({ kind: "image", width: 500, height: 281 }, "hero_16x9"), "too_small", "refused below half");
    eq(mediaFit({ kind: "video", width: 1920, height: 1080 }, "hero_16x9"), "wrong_kind", "video in a picture slot");
    eq(mediaFit({ kind: "image", width: 1, height: 1 }, "text"), "ok", "text needs no picture");
    ok(SQL.includes("IF m.width < (f->>'min_width')::integer / 2 THEN"), "database refuses below half too");
    // Website: object-fit cover with an aspect-ratio box, never fill.
    const slots = readFileSync("website/src/ads/AdSlots.tsx", "utf8");
    ok(slots.includes("object-cover") && !slots.includes("object-fill"), "no stretching on the website");
    ok(slots.includes("aspectRatio"), "space kept before pictures load");
  });

  runTest("Marketing: pop-ups are rare and stay off buying pages", () => {
    for (const s of ["cart", "checkout", "account", "order-confirmed", "track"]) ok(!popupAllowedOn(s), `no pop-up on ${s}`);
    ok(popupAllowedOn("") && popupAllowedOn("shop"), "home and shop allowed");
    ok(popupDue(null, 24, NOW), "never seen");
    ok(!popupDue(NOW - 3_600_000, 24, NOW), "seen an hour ago");
    ok(popupDue(NOW - 25 * 3_600_000, 24, NOW), "seen yesterday");
    ok(SQL.includes("Only one pop-up is ever shown at a time"), "database: one pop-up");
  });

  runTest("Marketing: the website asks again at the next start or end, at most 5 minutes later", () => {
    eq(nextRefresh({ ...ads([]), refreshAt: iso(2) }, NOW), NOW + 2 * 60_000 + 1000, "next change");
    eq(nextRefresh({ ...ads([]), refreshAt: iso(60) }, NOW), NOW + 5 * 60_000, "capped");
    eq(nextRefresh(ads([]), NOW), NOW + 5 * 60_000, "nothing scheduled");
  });

  runTest("Marketing: statistics are honest", () => {
    eq(clickRate({ views: 0, clicks: 0 }), null, "no made-up 0% before anything was seen");
    eq(clickRate({ views: 200, clicks: 5 }), 2.5, "click rate");
    const store = readFileSync("website/src/ads/adStore.ts", "utf8");
    ok(store.includes("doNotTrack") && store.includes("globalPrivacyControl"), "Do Not Track and GPC respected");
    ok(!/document\.cookie/.test(store), "no cookies");
    const slots = readFileSync("website/src/ads/AdSlots.tsx", "utf8");
    ok(slots.includes("intersectionRatio >= 0.5") && slots.includes("1000"), "seen = half visible for a second");
    ok(SQL.includes("PRIMARY KEY (visit, creative_id, kind, day)"), "once per visit, advert and day");
  });

  runTest("Marketing: videos wait for the visitor", () => {
    const slots = readFileSync("website/src/ads/AdSlots.tsx", "utf8");
    ok(slots.includes("preload=\"metadata\"") && slots.includes("started ?"), "no video file before play");
    ok(slots.includes("muted={auto}") && slots.includes("reducedMotion()") && slots.includes("saveData"), "self-play only muted, never with reduced motion or data saver");
    ok(slots.includes("kind=\"captions\""), "captions track");
  });

  runTest("Marketing: uploads are checked before sending", () => {
    eq(fileProblem({ type: "image/svg+xml", name: "x.svg", size: 10 }) !== "", true, "SVG refused (can carry script)");
    eq(fileProblem({ type: "text/html", name: "x.html", size: 10 }) !== "", true, "HTML refused");
    eq(fileProblem({ type: "video/mp4", name: "x.mp4", size: 60 * 1048576 }) !== "", true, "video over 50 MB");
    eq(fileProblem({ type: "image/webp", name: "x.webp", size: 1000 }), "", "WebP fine");
    eq(fileProblem({ type: "", name: "subs.vtt", size: 1000 }), "", "captions fine");
    ok(SQL.includes("'{image/jpeg,image/png,image/webp,image/avif,image/gif,video/mp4,video/webm,text/vtt}'"), "bucket allows only these");
  });

  runTest("Marketing: dates in the shop's time zone", () => {
    eq(toZoneLocal("2026-11-27T05:00:00Z", "Africa/Nairobi"), "2026-11-27T08:00", "Nairobi is UTC+3");
    eq(toZoneLocal("2026-11-27T05:00:00Z", "Europe/London"), "2026-11-27T05:00", "London in winter");
    eq(toZoneLocal(null, "Africa/Nairobi"), "", "empty");
    const d = upcomingDates(new Date(2026, 10, 1), 60);
    eq(d.find((x) => x.name === "Black Friday")?.date.getDate(), 27, "Black Friday 2026 is 27 November");
    eq(upcomingDates(new Date(2024, 10, 1), 60).find((x) => x.name === "Black Friday")?.date.getDate(), 29, "Black Friday 2024 is 29 November");
    eq(d.find((x) => x.name === "Cyber Monday")?.date.getDate(), 30, "Cyber Monday 2026");
  });
}
