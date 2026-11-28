// Counts each page opened (engine/visits.ts); with statistics consent also keeps the visit history. The first page of this page load is the
// start of a visit unless the browser says it was a reload or came from this website itself.
// Not counted: previews, robots, and the developer's own machine (it talks to the real database).
import { useEffect, useRef } from 'react';
import { inPreview, recordView, recordVisit } from './api';
import { visitIds } from './visitorCookies';
import { isBot, visitPage, visitSource } from './engine/visits';

function firstPageSource(): ReturnType<typeof visitSource> {
  const nav = performance.getEntriesByType?.('navigation')[0] as PerformanceNavigationTiming | undefined;
  if (nav?.type === 'reload') return null;
  return visitSource(document.referrer, window.location.hostname);
}

export function useVisitCounter(parts: readonly string[], slug: string | null) {
  const first = useRef(true);
  const key = parts.join('/');
  useEffect(() => {
    if (!slug) return;
    const host = window.location.hostname;
    if (host === 'localhost' || host === '127.0.0.1' || inPreview() || isBot(navigator.userAgent, navigator.webdriver === true)) return;
    const source = first.current ? firstPageSource() : null;
    first.current = false;
    // With the visitor's consent the page also goes in their visit history; otherwise only the
    // anonymous daily totals count it.
    const ids = visitIds();
    if (ids) recordVisit(slug, visitPage(parts), source ?? 'inside', source !== null, ids, window.location.pathname);
    else recordView(slug, visitPage(parts), source ?? 'inside', source !== null);
    // Counts once per page, when the page (key) changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, slug]);
}
