import { useEffect, useState } from 'react';

const ROUTE_CHANGE = 'site:navigate';

export const navigate = (path: string, { replace = false } = {}) => {
  if (replace) window.history.replaceState({}, '', path);
  else window.history.pushState({}, '', path);
  window.dispatchEvent(new Event(ROUTE_CHANGE));
};

/** Sends same-site link clicks through the router, leaving new-tab clicks and other sites alone. */
export function startLinkInterceptor() {
  document.addEventListener('click', (e) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const link = (e.target as Element).closest?.('a');
    if (!link || link.target || link.hasAttribute('download') || link.origin !== window.location.origin) return;
    // A jump within the same page, such as "Skip to content", is left to the browser.
    if (link.hash && link.pathname === window.location.pathname && link.search === window.location.search) return;
    e.preventDefault();
    navigate(link.pathname + link.search + link.hash);
  });
}

export interface Route {
  /** The path split into parts: /articles/how-to-store is ['articles', 'how-to-store']. */
  parts: string[];
  query: URLSearchParams;
}

const readRoute = (): Route => ({
  parts: window.location.pathname.split('/').filter(Boolean),
  query: new URLSearchParams(window.location.search),
});

export function useRoute(): Route {
  const [route, setRoute] = useState(readRoute);

  useEffect(() => {
    let lastPath = window.location.pathname;
    const onChange = () => {
      // Changing only the query (shop filters, sorting) keeps the scroll position.
      if (window.location.pathname !== lastPath) window.scrollTo(0, 0);
      lastPath = window.location.pathname;
      setRoute(readRoute());
    };
    window.addEventListener(ROUTE_CHANGE, onChange);
    window.addEventListener('popstate', onChange);
    return () => {
      window.removeEventListener(ROUTE_CHANGE, onChange);
      window.removeEventListener('popstate', onChange);
    };
  }, []);

  return route;
}

/** After moving to a link like /sitemap#policies, scrolls to that part once it has rendered. */
export function useHashScroll(route: Route, ready: boolean) {
  const key = `${route.parts.join('/')}${window.location.hash}`;
  useEffect(() => {
    const id = decodeURIComponent(window.location.hash.slice(1));
    if (!ready || !id) return;
    const frame = requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView({ block: 'start' }));
    return () => cancelAnimationFrame(frame);
  }, [key, ready]);
}
