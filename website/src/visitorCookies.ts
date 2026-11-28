// Statistics cookies (20261217002). Asked for first: nothing is set until the visitor accepts.
// With consent the website keeps two first-party cookies, both random and meaningless on their own:
//   kk_vid  the visitor (13 months), so a second visit is known to be the same browser
//   kk_sid  the visit (ends 30 minutes after the last page)
// kk_consent remembers the answer either way (6 months). Saying no keeps the anonymous counter.

export type StatsConsent = 'yes' | 'no' | null;

const CONSENT = 'kk_consent';
const VISITOR = 'kk_vid';
const VISIT = 'kk_sid';
const DAY_S = 86_400;
const CONSENT_DAYS = 182;
const VISITOR_DAYS = 396; // 13 months, the same as the history kept (run_website_visit_cleanup)
const VISIT_MINUTES = 30;
const MINUTE_S = 60;
// A uuid as crypto.randomUUID makes it: matches "1b4e28ba-2fa1-11d2-883f-0016d3cca427", rejects "abc".
// https://regex101.com/?regex=%5E%5B0-9a-f%5D%7B8%7D-%5B0-9a-f%5D%7B4%7D-%5B0-9a-f%5D%7B4%7D-%5B0-9a-f%5D%7B4%7D-%5B0-9a-f%5D%7B12%7D%24&testString=1b4e28ba-2fa1-11d2-883f-0016d3cca427
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Reads one cookie from a document.cookie string. */
export function readCookie(all: string, name: string): string | null {
  const hit = all.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${name}=`));
  return hit === undefined ? null : decodeURIComponent(hit.slice(name.length + 1));
}

/** The Set-Cookie text for one of ours: first-party, whole site, not sent to other sites. */
export function cookieText(name: string, value: string, maxAgeSeconds: number, secure: boolean): string {
  return `${name}=${encodeURIComponent(value)}; Max-Age=${maxAgeSeconds}; Path=/; SameSite=Lax${secure ? '; Secure' : ''}`;
}

const canUseCookies = (): boolean => typeof document !== 'undefined';
const isSecure = (): boolean => typeof location !== 'undefined' && location.protocol === 'https:';
const setCookie = (name: string, value: string, maxAge: number): void => {
  document.cookie = cookieText(name, value, maxAge, isSecure());
};
/** A random id, or null on an old browser without crypto.randomUUID (then no history is kept). */
const newId = (): string | null =>
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : null;

/** The visitor's answer, or null when not asked yet. */
export function statsConsent(): StatsConsent {
  if (!canUseCookies()) return null;
  const v = readCookie(document.cookie, CONSENT);
  return v === 'yes' || v === 'no' ? v : null;
}

const listeners = new Set<(c: StatsConsent) => void>();
/** Called when the visitor answers (the banner hides, the counter starts keeping history). */
export function onConsentChange(fn: (c: StatsConsent) => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

/** Saves the answer. "No" also removes any ids set before, so nothing of the visitor stays. */
export function setStatsConsent(answer: 'yes' | 'no'): void {
  if (!canUseCookies()) return;
  setCookie(CONSENT, answer, CONSENT_DAYS * DAY_S);
  if (answer === 'no') {
    setCookie(VISITOR, '', 0);
    setCookie(VISIT, '', 0);
  }
  listeners.forEach((fn) => fn(answer));
}

/**
 * The visitor and visit ids for this page, with consent only (else null). The visit id is
 * renewed for 30 minutes on every page; a new one starts a new visit.
 */
export function visitIds(): { visitor: string; visit: string; newVisit: boolean } | null {
  if (statsConsent() !== 'yes') return null;
  const savedVisitor = readCookie(document.cookie, VISITOR);
  const savedVisit = readCookie(document.cookie, VISIT);
  const visitor = savedVisitor && UUID.test(savedVisitor) ? savedVisitor : newId();
  const newVisit = !savedVisit || !UUID.test(savedVisit);
  const visit = newVisit ? newId() : savedVisit;
  if (!visitor || !visit) return null;
  setCookie(VISITOR, visitor, VISITOR_DAYS * DAY_S);
  setCookie(VISIT, visit, VISIT_MINUTES * MINUTE_S);
  return { visitor, visit, newVisit };
}
