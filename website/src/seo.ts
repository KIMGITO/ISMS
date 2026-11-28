// Page titles, descriptions and structured data. Used in the browser and by
// scripts/prerender.ts, so everything here is plain data with no browser or Vite APIs.
import { hoursJsonLd, type Industry } from './engine/brand';
import type { Article, Product, Storefront } from './api';
import { infoPage, InfoPageDef, plainText } from './infoPages';
import { formatPrice } from './numbers';

export interface PageMeta {
  title: string;
  description: string;
  path: string;
  image?: string | null;
  noindex?: boolean;
  /** No such page: the server answers 404 (worker/index.ts), not a "not found" page with 200. */
  notFound?: boolean;
  type?: 'website' | 'article' | 'product';
  jsonLd?: object[];
}

export const slugify = (text: string) =>
  text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

/** Keeps product URLs readable. A name shared by two products gets a short id on the second. */
export function productPaths(products: Product[]): Map<string, string> {
  const paths = new Map<string, string>();
  const used = new Set<string>();
  for (const product of products) {
    let slug = slugify(product.name) || product.id;
    if (used.has(slug)) slug = `${slug}-${product.id.slice(0, 6)}`;
    used.add(slug);
    paths.set(product.id, `/products/${slug}`);
  }
  return paths;
}

/** Search results show about 155 characters, so longer text is cut at a word. */
export function clip(text: string, limit = 155): string {
  const clean = text.replace(/[#*\n]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (clean.length <= limit) return clean;
  return `${clean.slice(0, limit - 1).replace(/\s+\S*$/, '')}…`;
}

const absolute = (siteUrl: string, value: string | null | undefined) => {
  if (!value || value.startsWith('data:')) return undefined;
  return /^https?:/.test(value) ? value : `${siteUrl}${value}`;
};

const currencyCode = (currency: string) => (/^k(e)?sh?$/i.test(currency) ? 'KES' : currency.toUpperCase());

const breadcrumbs = (siteUrl: string, items: [string, string][]) => ({
  '@context': 'https://schema.org',
  '@type': 'BreadcrumbList',
  itemListElement: items.map(([name, path], index) => ({
    '@type': 'ListItem',
    position: index + 1,
    name,
    item: `${siteUrl}${path}`,
  })),
});

/** The most specific schema.org type for the shop's industry (brand profile, 20261206001). */
const SCHEMA_TYPE: Record<Industry, string> = {
  food_grocery: 'GroceryStore',
  restaurant: 'Restaurant',
  beauty: 'HealthAndBeautyBusiness',
  fashion: 'ClothingStore',
  electronics: 'ElectronicsStore',
  pharmacy: 'Pharmacy',
  hardware: 'HardwareStore',
  professional_services: 'ProfessionalService',
  logistics: 'LocalBusiness',
  general_retail: 'Store',
  other: 'LocalBusiness',
};

export function businessJsonLd(site: Storefront, siteUrl: string) {
  const { name, description, address, contactEmail, contactPhone, logoUrl } = site.business;
  const brand = site.brand;
  const sameAs = Object.values(brand?.socialLinks ?? {}).filter((u): u is string => !!u);
  const hours = hoursJsonLd(brand?.openingHours);
  return {
    '@context': 'https://schema.org',
    '@type': SCHEMA_TYPE[brand?.industry ?? 'general_retail'] ?? 'Store',
    slogan: brand?.tagline || undefined,
    sameAs: sameAs.length ? sameAs : undefined,
    openingHoursSpecification: hours.length ? hours : undefined,
    name,
    url: siteUrl || undefined,
    description: description || undefined,
    logo: absolute(siteUrl, logoUrl || '/logo.png'),
    image: absolute(siteUrl, logoUrl || '/logo.png'),
    telephone: contactPhone || undefined,
    email: contactEmail || undefined,
    address: address ? { '@type': 'PostalAddress', streetAddress: address, addressCountry: 'KE' } : undefined,
    currenciesAccepted: currencyCode(site.business.currency),
  };
}

/** The home page. The shop's own search engine text (Website > SEO) comes first. */
export const homeMeta = (site: Storefront, siteUrl: string): PageMeta => ({
  title: site.seo?.title?.trim() || `${site.business.name} | Order online`,
  description: clip(
    site.seo?.description?.trim() ||
      site.business.description ||
      site.brand?.tagline ||
      `Order from ${site.business.name} online. Pay with M-Pesa and get delivery or pick up in store.`,
  ),
  path: '/',
  image: site.seo?.shareImage?.startsWith('https://') ? site.seo.shareImage : undefined,
  jsonLd: [businessJsonLd(site, siteUrl)],
});

export const shopMeta = (site: Storefront, siteUrl: string): PageMeta => ({
  title: `Shop | ${site.business.name}`,
  description: clip(
    `Browse ${site.products.slice(0, 4).map((p) => p.name).join(', ') || 'our products'} from ${site.business.name}. Order online and pay with M-Pesa.`,
  ),
  path: '/shop',
  jsonLd: [breadcrumbs(siteUrl, [['Home', '/'], ['Shop', '/shop']])],
});

function productRating(productId: string, site: Storefront) {
  const reviews = (site.reviews ?? []).filter((r) => r.productId === productId);
  if (!reviews.length) return {};
  const average = reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length;
  return {
    aggregateRating: { '@type': 'AggregateRating', ratingValue: average.toFixed(1), reviewCount: reviews.length },
    review: reviews.slice(0, 5).map((r) => ({
      '@type': 'Review',
      reviewRating: { '@type': 'Rating', ratingValue: r.rating },
      author: { '@type': 'Person', name: r.name },
      datePublished: r.createdAt.slice(0, 10),
      reviewBody: r.body,
    })),
  };
}

export function productMeta(product: Product, path: string, site: Storefront, siteUrl: string): PageMeta {
  const { name: business, currency } = site.business;
  return {
    title: `${product.name} | ${business}`,
    description: clip(
      product.description ||
        `Order ${product.name} from ${business} at ${formatPrice(currency, Number(product.price))} per ${product.unit.replace(/s$/i, '').toLowerCase()}. Pay with M-Pesa.`,
    ),
    path,
    image: product.image,
    type: 'product',
    jsonLd: [
      {
        '@context': 'https://schema.org',
        '@type': 'Product',
        name: product.name,
        description: product.description || undefined,
        category: product.category,
        image: absolute(siteUrl, product.image),
        brand: { '@type': 'Brand', name: business },
        ...productRating(product.id, site),
        offers: {
          '@type': 'Offer',
          url: `${siteUrl}${path}`,
          price: Number(product.price),
          priceCurrency: currencyCode(currency),
          availability: `https://schema.org/${product.inStock ? 'InStock' : 'OutOfStock'}`,
        },
      },
      breadcrumbs(siteUrl, [['Home', '/'], ['Shop', '/shop'], [product.name, path]]),
    ],
  };
}

export const articlesMeta = (site: Storefront, siteUrl: string): PageMeta => ({
  title: `Guides | ${site.business.name}`,
  description: clip(`Practical guides and tips from ${site.business.name}.`),
  path: '/articles',
  jsonLd: [breadcrumbs(siteUrl, [['Home', '/'], ['Guides', '/articles']])],
});

export function articleMeta(article: Article, site: Storefront, siteUrl: string): PageMeta {
  const path = `/articles/${article.slug}`;
  return {
    title: `${article.title} | ${site.business.name}`,
    description: clip(article.summary || plainText(article.body)),
    path,
    image: article.coverImageUrl,
    type: 'article',
    jsonLd: [
      {
        '@context': 'https://schema.org',
        '@type': 'Article',
        headline: article.title,
        description: article.summary || undefined,
        image: absolute(siteUrl, article.coverImageUrl),
        datePublished: article.publishedAt || undefined,
        author: { '@type': 'Organization', name: site.business.name },
        publisher: { '@type': 'Organization', name: site.business.name },
        mainEntityOfPage: `${siteUrl}${path}`,
      },
      breadcrumbs(siteUrl, [['Home', '/'], ['Guides', '/articles'], [article.title, path]]),
    ],
  };
}

export const contactMeta = (site: Storefront, siteUrl: string): PageMeta => ({
  title: `Contact us and find our shop | ${site.business.name}`,
  description: clip(
    `Find ${site.business.name}${site.business.address ? ` at ${site.business.address}` : ''}. Call, message us or get directions.`,
  ),
  path: '/contact',
  jsonLd: [businessJsonLd(site, siteUrl), breadcrumbs(siteUrl, [['Home', '/'], ['Contact', '/contact']])],
});

export const feedbackMeta = (site: Storefront): PageMeta => ({
  title: `Share your feedback | ${site.business.name}`,
  description: clip(`Tell ${site.business.name} what you think, suggest an improvement or report a problem.`),
  path: '/feedback',
});

export const privateMeta = (site: Storefront, title: string, path: string): PageMeta => ({
  title: `${title} | ${site.business.name}`,
  description: clip(`Manage your ${site.business.name} account and orders.`),
  path,
  noindex: true,
});

export const notFoundMeta = (site: Storefront, path: string): PageMeta => ({
  title: `Page not found | ${site.business.name}`,
  description: clip(`We couldn't find that page on the ${site.business.name} website.`),
  path,
  noindex: true,
  notFound: true,
});

export const infoMeta = (page: InfoPageDef, site: Storefront, siteUrl: string): PageMeta => ({
  title: `${page.title} | ${site.business.name}`,
  description: clip(`${page.summary} ${site.business.name}, Kenya.`),
  path: page.path,
  jsonLd: [
    ...(page.id === 'about' ? [businessJsonLd(site, siteUrl)] : []),
    breadcrumbs(siteUrl, [['Home', '/'], [page.label, page.path]]),
  ],
});

export function reviewsMeta(site: Storefront, siteUrl: string): PageMeta {
  const reviews = site.reviews ?? [];
  const average = reviews.length ? reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length : 0;
  return {
    title: `Customer reviews | ${site.business.name}`,
    description: clip(reviews.length
      ? `Rated ${average.toFixed(1)} out of 5 by ${reviews.length} customers. Read what customers say about ${site.business.name}.`
      : `Read and write reviews of ${site.business.name}'s products and delivery.`),
    path: '/reviews',
    jsonLd: [
      ...(reviews.length ? [{ ...businessJsonLd(site, siteUrl), aggregateRating: { '@type': 'AggregateRating', ratingValue: average.toFixed(1), reviewCount: reviews.length } }] : []),
      breadcrumbs(siteUrl, [['Home', '/'], ['Reviews', '/reviews']]),
    ],
  };
}

export const sitemapMeta = (site: Storefront, siteUrl: string): PageMeta => ({
  title: `Site map | ${site.business.name}`,
  description: clip(`Every page on the ${site.business.name} website: shop, products, help, policies and guides.`),
  path: '/sitemap',
  jsonLd: [breadcrumbs(siteUrl, [['Home', '/'], ['Site map', '/sitemap']])],
});

export function metaForRoute(parts: string[], site: Storefront, siteUrl: string): PageMeta {
  const [section, id] = parts;
  const path = `/${parts.join('/')}`;
  switch (section) {
    case undefined:
      return homeMeta(site, siteUrl);
    case 'shop':
      return shopMeta(site, siteUrl);
    case 'products': {
      const paths = productPaths(site.products);
      const product = site.products.find((p) => paths.get(p.id) === path);
      return product ? productMeta(product, path, site, siteUrl) : notFoundMeta(site, path);
    }
    case 'articles': {
      if (!id) return articlesMeta(site, siteUrl);
      const article = site.articles.find((a) => a.slug === id);
      return article ? articleMeta(article, site, siteUrl) : notFoundMeta(site, path);
    }
    case 'contact':
      return contactMeta(site, siteUrl);
    case 'feedback':
      return feedbackMeta(site);
    case 'cart':
      return privateMeta(site, 'Your cart', path);
    case 'account':
      return privateMeta(site, 'My account', path);
    case 'saved':
      return privateMeta(site, 'Saved items', path);
    case 'search':
      return privateMeta(site, 'Search results', path);
    case 'checkout':
      return privateMeta(site, 'Checkout', path);
    case 'order-confirmed':
      return id ? privateMeta(site, 'Order confirmed', path) : notFoundMeta(site, path);
    case 'reviews':
      return reviewsMeta(site, siteUrl);
    case 'ideas':
      return {
        title: `Vote & suggest products | ${site.business.name}`,
        description: clip(`Vote for the products ${site.business.name} makes next, or suggest your own.`),
        path: '/ideas',
        jsonLd: [breadcrumbs(siteUrl, [['Home', '/'], ['Vote & suggest', '/ideas']])],
      };
    case 'track':
      return privateMeta(site, 'Track your order', path);
    // Advert landing pages (ads/CampaignPage.tsx) load in the browser; not for search results.
    case 'promo':
      return id ? privateMeta(site, 'Offer', path) : notFoundMeta(site, path);
    case 'sitemap':
      return sitemapMeta(site, siteUrl);
    default: {
      const page = id === undefined ? infoPage(section) : undefined;
      return page ? infoMeta(page, site, siteUrl) : notFoundMeta(site, path);
    }
  }
}
