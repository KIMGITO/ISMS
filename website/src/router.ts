import { useEffect, useState } from 'react';

const ROUTE_CHANGE = 'site:navigate';

export const navigate = (path: string) => {
  window.history.pushState({}, '', path);
  window.dispatchEvent(new Event(ROUTE_CHANGE));
};

/** Sends same-site link clicks through the router, leaving new-tab clicks and other sites alone. */
export function startLinkInterceptor() {
  document.addEventListener('click', (e) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const link = (e.target as Element).closest?.('a');
    if (!link || link.target || link.origin !== window.location.origin) return;
    e.preventDefault();
    navigate(link.pathname + link.search);
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
    const onChange = () => {
      setRoute(readRoute());
      window.scrollTo(0, 0);
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
