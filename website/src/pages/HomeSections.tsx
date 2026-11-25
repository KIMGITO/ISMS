// Home page sections added with the layout engine (engine/layout.ts): the statement and banner
// openings, category tiles and name buttons, the product grid, the brand story and "Visit us".
// Each returns nothing when the shop has nothing to put in it, so no section is ever empty.
import { ArrowRight, Clock, MapPin, Phone } from 'lucide-react';
import { Product } from '../api';
import { hoursText } from '../engine/brand';
import { industryGroup, safeHref, visibleHeroSlides } from '../heroSlides';
import { shopPictures } from '../shopPictures';
import { useStorefront } from '../store';
import { NoPicture } from '../ui';
import ProductCard from './ProductCard';

/** The biggest categories first, each with its first product photo. */
export function topCategories(products: Product[], max = 8) {
  const counts = new Map<string, number>();
  for (const p of products) counts.set(p.category, (counts.get(p.category) ?? 0) + 1);
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, max)
    .map(([name, count]) => ({ name, count, image: products.find((p) => p.category === name && p.image)?.image ?? undefined }));
}

const shopLink = (category: string) => `/shop?category=${encodeURIComponent(category)}`;

/**
 * One strong opening instead of a slider. "statement": words beside one large picture.
 * "banner": words on the brand's deep colour, no picture, for firms that sell services.
 * Words come from the first saved slide, else the brand's tagline, else the built-in words.
 */
export function HeroStatement({ variant }: { variant: string }) {
  const { business, brand, heroSlides, articles, products } = useStorefront();
  const pictures = shopPictures(products);
  const saved = (heroSlides ?? []).length > 0;
  const first = visibleHeroSlides(heroSlides, articles.length > 0, pictures, brand?.industry)[0];
  const title = (!saved && brand?.tagline) || first?.title || business.name;
  const body = first?.body;
  const picture = (saved && first?.images[0]) || business.coverImageUrl || pictures[0]?.src;
  const services = ['services', 'logistics'].includes(industryGroup(brand?.industry));
  const cta = { label: first?.ctaLabel || 'Explore', href: safeHref(first?.ctaHref) };
  const second = services || cta.href === '/contact' ? { label: 'About us', href: '/about' } : { label: 'Contact us', href: '/contact' };

  if (variant === 'banner' || !picture) {
    return (
      <section className="site-gutter pt-3 sm:pt-6" aria-label="Welcome">
        <div className="rounded-2xl bg-hero px-5 py-12 text-white sm:px-12 sm:py-20 lg:px-16 lg:py-24">
          <p className="text-sm font-medium opacity-80">{business.name}</p>
          <h1 className="display-xl mt-2 max-w-[20ch]">{title}</h1>
          {body && <p className="mt-3 max-w-xl text-sm opacity-85 sm:text-base">{body}</p>}
          <div className="mt-7 flex flex-wrap gap-2.5">
            <a href={cta.href} className="btn bg-white text-ink hover:bg-cream">{cta.label} <ArrowRight size={16} aria-hidden /></a>
            <a href={second.href} className="btn border border-white/60 text-white hover:bg-white/10">{second.label}</a>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="site-gutter pt-3 sm:pt-6" aria-label="Welcome">
      <div className="grid items-center gap-6 sm:grid-cols-[1fr_1fr] lg:gap-12">
        <div className="max-sm:order-2">
          <p className="eyebrow">{business.name}</p>
          <h1 className="display-xl mt-2 max-w-[18ch]">{title}</h1>
          {body && <p className="mt-3 max-w-md text-sm text-muted sm:text-base">{body}</p>}
          <div className="mt-6 flex flex-wrap gap-2.5">
            <a href={cta.href} className="btn btn-primary">{cta.label} <ArrowRight size={16} aria-hidden /></a>
            <a href={second.href} className="btn btn-secondary">{second.label}</a>
          </div>
        </div>
        <div className="product-media overflow-hidden rounded-xl bg-sand sm:max-h-[34rem] sm:w-full">
          <img src={picture} alt="" fetchPriority="high" className="size-full [object-fit:var(--img-fit,cover)]" />
        </div>
      </div>
    </section>
  );
}

/** Categories as picture tiles with the name under each. */
export function CategoryTiles({ title, gap }: { title: string; gap: string }) {
  const { products } = useStorefront();
  const categories = topCategories(products);
  if (categories.length < 2) return null;
  return (
    <section className={`site-gutter ${gap}`} aria-labelledby="categories-heading">
      <h2 id="categories-heading" className="display-md">{title}</h2>
      <ul className={`mt-4 grid grid-cols-2 gap-3 sm:mt-5 sm:grid-cols-3 sm:gap-4 ${categories.length === 3 ? '' : 'lg:grid-cols-4'}`}>
        {categories.map((c) => (
          <li key={c.name}>
            <a href={shopLink(c.name)} className="group block">
              <span className="product-media block overflow-hidden rounded-lg bg-sand">
                {c.image
                  ? <img src={c.image} alt="" loading="lazy" className="size-full transition duration-500 [object-fit:var(--img-fit,contain)] group-hover:scale-[1.03]" />
                  : <NoPicture text={c.name} />}
              </span>
              <span className="mt-2 flex items-center justify-between gap-2 text-sm font-medium capitalize">
                <span className="truncate">{c.name}</span>
                <ArrowRight size={14} className="shrink-0 text-muted transition group-hover:translate-x-0.5 group-hover:text-ember" aria-hidden />
              </span>
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Categories as a row of name buttons, for menus and services where pictures add little. */
export function CategoryChips({ title, gap }: { title: string; gap: string }) {
  const { products } = useStorefront();
  const categories = topCategories(products, 16);
  if (categories.length < 2) return null;
  return (
    <section className={`site-gutter ${gap}`} aria-labelledby="categories-heading">
      <h2 id="categories-heading" className="display-md">{title}</h2>
      <ul className="mt-4 flex flex-wrap gap-2">
        {categories.map((c) => (
          <li key={c.name}>
            <a href={shopLink(c.name)} className="btn btn-secondary min-h-10 capitalize">
              {c.name} <span className="text-xs text-muted">{c.count}</span>
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Products as a still grid: two across on phones, up to four on wide screens. */
export function ProductGrid({ id, title, products, viewAll, gap, max = 8 }: {
  id: string; title: string; products: Product[]; viewAll?: string; gap: string; max?: number;
}) {
  if (products.length === 0) return null;
  return (
    <section id={id} className={`site-gutter scroll-mt-36 ${gap}`} aria-labelledby={`${id}-heading`}>
      <div className="flex items-end justify-between gap-3">
        <h2 id={`${id}-heading`} className="display-md">{title}</h2>
        {viewAll && (
          <a href={viewAll} className="inline-flex shrink-0 items-center gap-1 text-sm font-medium text-ember hover:underline">
            View all <ArrowRight size={14} aria-hidden />
          </a>
        )}
      </div>
      <ul className="mt-4 grid grid-cols-2 gap-2.5 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4">
        {products.slice(0, max).map((product) => <ProductCard key={product.id} product={product} />)}
      </ul>
    </section>
  );
}

/** The brand's story and mission. Nothing when neither (nor a shop description) is written. */
export function StorySection({ variant, title, gap }: { variant: string; title: string; gap: string }) {
  const { business, brand, products } = useStorefront();
  const story = brand?.story?.trim() || business.description?.trim();
  const mission = brand?.mission?.trim();
  if (!story && !mission) return null;
  const picture = variant === 'split' ? business.coverImageUrl || shopPictures(products)[0]?.src : undefined;
  const words = (
    <div className={variant === 'centred' || !picture ? 'mx-auto max-w-2xl text-center' : ''}>
      <h2 id="story-heading" className="display-lg">{title}</h2>
      {mission && <p className="mt-4 text-lg leading-snug sm:text-xl">{mission}</p>}
      {story && <p className="mt-4 line-clamp-8 whitespace-pre-line text-sm leading-relaxed text-muted sm:text-base">{story}</p>}
      <a href="/about" className="mt-5 inline-flex min-h-10 items-center gap-1 text-sm font-medium text-ember hover:underline">
        More about us <ArrowRight size={14} aria-hidden />
      </a>
    </div>
  );
  return (
    <section className={`site-gutter ${gap}`} aria-labelledby="story-heading">
      {picture ? (
        <div className="grid items-center gap-6 sm:grid-cols-2 lg:gap-12">
          <div className="product-media overflow-hidden rounded-xl bg-sand sm:max-h-[34rem] sm:w-full">
            <img src={picture} alt="" loading="lazy" className="size-full [object-fit:var(--img-fit,cover)]" />
          </div>
          {words}
        </div>
      ) : words}
    </section>
  );
}

/** Address, a map link, opening hours and phone. Nothing when the shop has none of them. */
export function VisitSection({ title, gap }: { title: string; gap: string }) {
  const { business, brand, settings } = useStorefront();
  const hours = hoursText(brand?.openingHours) ?? settings.openingHours?.trim() ?? null;
  const address = business.address?.trim();
  if (!address && !hours) return null;
  const map = address ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${business.name}, ${address}`)}` : null;
  const phone = business.contactPhone;
  return (
    <section className={`site-gutter ${gap}`} aria-labelledby="visit-heading">
      <div className="grid gap-6 rounded-2xl border border-line bg-white p-5 sm:grid-cols-[1fr_1.4fr] sm:p-10">
        <h2 id="visit-heading" className="display-lg">{title}</h2>
        <dl className="grid gap-5 text-sm sm:text-base">
          {address && (
            <div className="flex gap-3">
              <MapPin size={20} className="mt-0.5 shrink-0 text-ember" aria-hidden />
              <div>
                <dt className="sr-only">Address</dt>
                <dd>{address}</dd>
                {map && <dd><a href={map} target="_blank" rel="noopener noreferrer" className="text-sm font-medium text-ember hover:underline">Open in maps</a></dd>}
              </div>
            </div>
          )}
          {hours && (
            <div className="flex gap-3">
              <Clock size={20} className="mt-0.5 shrink-0 text-ember" aria-hidden />
              <div>
                <dt className="sr-only">Opening hours</dt>
                {hours.split(/;\s*/).map((line) => <dd key={line}>{line}</dd>)}
              </div>
            </div>
          )}
          {phone && (
            <div className="flex gap-3">
              <Phone size={20} className="mt-0.5 shrink-0 text-ember" aria-hidden />
              <div>
                <dt className="sr-only">Phone</dt>
                <dd><a href={`tel:${phone.replace(/\s/g, '')}`} className="hover:underline">{phone}</a></dd>
              </div>
            </div>
          )}
        </dl>
      </div>
    </section>
  );
}
