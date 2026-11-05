import { useEffect } from 'react';
import { metaForRoute } from './seo';
import type { Storefront } from './api';

/** The live domain, such as https://kaykays.com. While unset, search engines are told not to index. */
export const SITE_URL: string = (import.meta.env.VITE_SITE_URL || '').replace(/\/+$/, '');

function setTag(selector: string, create: () => HTMLElement, attribute: string, value: string | null) {
  let tag = document.head.querySelector<HTMLElement>(selector);
  if (value === null) {
    tag?.remove();
    return;
  }
  if (!tag) {
    tag = create();
    document.head.appendChild(tag);
  }
  tag.setAttribute(attribute, value);
}

const setMeta = (key: 'name' | 'property', id: string, content: string | null) =>
  setTag(
    `meta[${key}="${id}"]`,
    () => {
      const tag = document.createElement('meta');
      tag.setAttribute(key, id);
      return tag;
    },
    'content',
    content,
  );

/** Keeps the document head right as customers move between pages. */
export function usePageMeta(parts: string[], site: Storefront | null) {
  const key = parts.join('/');

  useEffect(() => {
    if (!site) return;
    const meta = metaForRoute(parts, site, SITE_URL);
    const canonical = SITE_URL ? `${SITE_URL}${meta.path === '/' ? '/' : meta.path}` : null;

    document.title = meta.title;
    setMeta('name', 'description', meta.description);
    setMeta('name', 'robots', meta.noindex || !SITE_URL ? 'noindex, nofollow' : 'index, follow');
    setMeta('property', 'og:title', meta.title);
    setMeta('property', 'og:description', meta.description);
    setMeta('property', 'og:type', meta.type === 'article' ? 'article' : 'website');
    setMeta('property', 'og:url', canonical);
    setMeta('property', 'og:site_name', site.business.name);
    setTag('link[rel="canonical"]', () => {
      const tag = document.createElement('link');
      tag.setAttribute('rel', 'canonical');
      return tag;
    }, 'href', canonical);

    document.head.querySelectorAll('script[data-seo]').forEach((tag) => tag.remove());
    (meta.jsonLd ?? []).forEach((data) => {
      const tag = document.createElement('script');
      tag.type = 'application/ld+json';
      tag.dataset.seo = 'true';
      tag.textContent = JSON.stringify(data);
      document.head.appendChild(tag);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, site]);
}
