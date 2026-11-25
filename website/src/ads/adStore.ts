// The adverts showing on this shop now (get_public_campaigns), and the statistics sender.
//
// Loading: the Worker may put the list in the page (<script id="ads-data">); otherwise it is
// fetched once. It is fetched again at the next start or end (refreshAt) and at least every five
// minutes, and each placement also checks the end time itself, so an advert never outlives its
// campaign even in a tab left open.
//
// Statistics (no cookies, nothing personal): a random visit id kept in this tab only. "load" =
// the advert is on the page; "view" = at least half of it was on screen for one second; "click" =
// its button or picture was pressed. Each is sent once per visit and advert; the database counts
// each once per visit, advert and day. Browsers that send Do Not Track or Global Privacy Control
// are not counted at all.
import { create } from 'zustand';
import { storeSlug, supabase } from '../api';
import { nextRefresh, type PublicAds } from './rules';

const SUPABASE_URL: string = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY: string = import.meta.env.VITE_SUPABASE_ANON_KEY;

interface AdState {
  ads: PublicAds | null;
  /** True in the app's preview: nothing is counted and nothing is fetched. */
  preview: boolean;
  setAds: (ads: PublicAds | null, preview?: boolean) => void;
}

export const useAds = create<AdState>((set) => ({
  ads: null,
  preview: false,
  setAds: (ads, preview = false) => set({ ads, preview }),
}));

let timer: ReturnType<typeof setTimeout> | undefined;
let loadedFor = '';

function fromPage(): PublicAds | null {
  try {
    const el = typeof document !== 'undefined' ? document.getElementById('ads-data') : null;
    return el?.textContent ? (JSON.parse(el.textContent) as PublicAds) : null;
  } catch {
    return null;
  }
}

/**
 * A campaign preview link from the app (?adpreview=<secret>): kept for this tab, removed from the
 * address bar. While it is set the website shows that campaign as if it were running and counts
 * nothing. The database checks the secret, its two hours and that it belongs to this shop.
 */
function previewSecret(): string | null {
  try {
    const url = new URL(window.location.href);
    const fromLink = url.searchParams.get('adpreview');
    if (fromLink !== null) {
      url.searchParams.delete('adpreview');
      window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash);
      if (/^[0-9a-f]{48}$/.test(fromLink)) sessionStorage.setItem('ad-preview', fromLink);
    }
    const saved = sessionStorage.getItem('ad-preview');
    return saved && /^[0-9a-f]{48}$/.test(saved) ? saved : null;
  } catch {
    return null;
  }
}

/** Leave campaign preview and show the live website again. */
export function leaveAdPreview() {
  try { sessionStorage.removeItem('ad-preview'); } catch { /* nothing kept */ }
  window.location.reload();
}

/** Load (or reload) the adverts for the shop being shown. Safe to call on every store switch. */
export async function loadAds(slug = storeSlug()): Promise<void> {
  clearTimeout(timer);
  const secret = typeof window !== 'undefined' ? previewSecret() : null;
  if (secret) {
    const { data } = await supabase.rpc('get_preview_campaigns', { p_slug: slug, p_secret: secret });
    if (data) {
      useAds.getState().setAds(data as PublicAds, true);
      return;
    }
    try { sessionStorage.removeItem('ad-preview'); } catch { /* ignore */ }
  }
  if (useAds.getState().preview) return;
  let ads: PublicAds | null = null;
  if (loadedFor === '' && slug === storeSlug()) ads = fromPage();
  loadedFor = slug;
  if (!ads) {
    try {
      const { data, error } = await supabase.rpc('get_public_campaigns', { p_slug: slug });
      if (error) throw error;
      ads = (data as PublicAds | null) ?? null;
    } catch {
      // Adverts are extra: a failed load shows the website without them and tries again later.
      ads = useAds.getState().ads;
    }
  }
  if (loadedFor !== slug) return; // the visitor switched shop meanwhile
  useAds.getState().setAds(ads);
  timer = setTimeout(() => void loadAds(slug), Math.max(15_000, nextRefresh(ads) - Date.now()));
}

// ── Statistics ───────────────────────────────────────────────────────────────────────────────
type Kind = 'load' | 'view' | 'click';
const sent = new Set<string>();
let queue: { c: string; k: Kind }[] = [];
let flushTimer: ReturnType<typeof setTimeout> | undefined;

function trackingAllowed(): boolean {
  if (typeof navigator === 'undefined' || useAds.getState().preview) return false;
  const nav = navigator as Navigator & { globalPrivacyControl?: boolean };
  return nav.doNotTrack !== '1' && nav.globalPrivacyControl !== true;
}

/** A random id for this tab's visit. Not stored anywhere but this tab. */
export function visitId(): string {
  try {
    let id = sessionStorage.getItem('ad-visit');
    if (!id) {
      const bytes = crypto.getRandomValues(new Uint8Array(18));
      id = btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      sessionStorage.setItem('ad-visit', id);
    }
    return id;
  } catch {
    return 'nostorage_' + Math.random().toString(36).slice(2).padEnd(12, '0');
  }
}

export function trackAd(creativeId: string, kind: Kind): void {
  if (!trackingAllowed()) return;
  const key = `${creativeId}:${kind}`;
  if (sent.has(key)) return;
  sent.add(key);
  if (kind === 'click') {
    try { sessionStorage.setItem('ad-clicked', '1'); } catch { /* ignore */ }
  }
  queue.push({ c: creativeId, k: kind });
  clearTimeout(flushTimer);
  flushTimer = setTimeout(flush, kind === 'click' ? 0 : 3000);
}

function flush(keepalive = false): void {
  if (queue.length === 0) return;
  const events = queue.splice(0, 40);
  // keepalive lets the last events leave when the visitor follows the advert's link away.
  void fetch(`${SUPABASE_URL}/rest/v1/rpc/track_ad_events`, {
    method: 'POST',
    keepalive,
    headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` },
    body: JSON.stringify({ p_slug: storeSlug(), p_visit: visitId(), p_events: events }),
  }).catch(() => undefined);
  if (queue.length) flushTimer = setTimeout(flush, 1000);
}

if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => flush(true));
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(true); });
}

/**
 * After an order is placed: if this visit clicked an advert, tell the database. It checks the
 * order is the signed-in customer's own, at this shop, and that the click came first.
 */
export async function trackAdConversion(orderId: string): Promise<void> {
  if (!trackingAllowed()) return;
  try {
    if (sessionStorage.getItem('ad-clicked') !== '1') return;
    const done = `ad-order-${orderId}`;
    if (sessionStorage.getItem(done)) return;
    sessionStorage.setItem(done, '1');
    await supabase.rpc('track_ad_conversion', { p_slug: storeSlug(), p_visit: visitId(), p_order_id: orderId });
  } catch {
    // Statistics never get in the way of an order.
  }
}
