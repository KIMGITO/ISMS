import { useMemo } from 'react';
import { Search, X } from 'lucide-react';
import { navigate, Route } from '../router';
import { useStorefront } from '../store';
import { PageHeader, pageClass } from '../ui';
import Breadcrumbs from './Breadcrumbs';
import ProductCard from './ProductCard';
import { percentOff } from '../adCards';

const SORTS = [
  { id: 'featured', label: 'Featured' },
  { id: 'price-asc', label: 'Price: low to high' },
  { id: 'price-desc', label: 'Price: high to low' },
  { id: 'name', label: 'Name: A to Z' },
  { id: 'saving', label: 'Biggest saving' },
] as const;

type SortId = (typeof SORTS)[number]['id'];

/** Filters live in the address, so a filtered shop can be shared and the back button works. */
function useShopFilters(route: Route) {
  const q = route.query.get('q') ?? '';
  const category = route.query.get('category') ?? 'All';
  const sort = (SORTS.some((s) => s.id === route.query.get('sort')) ? route.query.get('sort') : 'featured') as SortId;
  const inStock = route.query.get('stock') === '1';
  const offersOnly = route.query.get('offers') === '1';

  const update = (changes: Record<string, string | null>) => {
    const params = new URLSearchParams(window.location.search);
    for (const [key, value] of Object.entries(changes)) {
      if (value === null || value === '' || (key === 'category' && value === 'All') || (key === 'sort' && value === 'featured')) params.delete(key);
      else params.set(key, value);
    }
    const query = params.toString();
    navigate(`${window.location.pathname}${query ? `?${query}` : ''}`, { replace: true });
  };
  return { q, category, sort, inStock, offersOnly, update };
}

export default function ShopPage({ route }: { route: Route }) {
  const { products } = useStorefront();
  const { q, category, sort, inStock, offersOnly, update } = useShopFilters(route);
  const hasOffers = products.some((p) => percentOff(p.price, p.wasPrice) > 0);

  const categories = useMemo(() => {
    const counts = new Map<string, number>();
    for (const p of products) counts.set(p.category, (counts.get(p.category) ?? 0) + 1);
    return [['All', products.length] as const, ...Array.from(counts.entries())];
  }, [products]);

  const visible = useMemo(() => {
    const term = q.trim().toLowerCase();
    const list = products.filter(
      (p) =>
        (category === 'All' || p.category === category) &&
        (!inStock || p.inStock) &&
        (!offersOnly || percentOff(p.price, p.wasPrice) > 0) &&
        (!term || `${p.name} ${p.category} ${p.description ?? ''}`.toLowerCase().includes(term)),
    );
    const sorted = [...list];
    if (sort === 'price-asc') sorted.sort((a, b) => a.price - b.price);
    else if (sort === 'price-desc') sorted.sort((a, b) => b.price - a.price);
    else if (sort === 'name') sorted.sort((a, b) => a.name.localeCompare(b.name));
    else if (sort === 'saving') sorted.sort((a, b) => percentOff(b.price, b.wasPrice) - percentOff(a.price, a.wasPrice));
    // Featured keeps the shop's order but shows what can be bought first.
    else sorted.sort((a, b) => Number(b.inStock) - Number(a.inStock));
    return sorted;
  }, [products, q, category, sort, inStock, offersOnly]);

  const searching = route.parts[0] === 'search';
  const title = searching
    ? (q ? `Search Results for “${q}”` : 'Search Our Shop')
    : category !== 'All' ? category : q ? `Results for “${q}”` : offersOnly ? 'Offers' : 'Shop All Products';
  const filtersOn = category !== 'All' || inStock || offersOnly || Boolean(q);

  return (
    <>
      <PageHeader
        eyebrow={searching ? 'Search' : 'Our dairy'}
        title={title}
        body={searching ? `${visible.length} ${visible.length === 1 ? 'product matches' : 'products match'}. Refine with the filters below.` : 'Order online, pay with M-Pesa, and choose delivery or pickup.'}
      >
        <Breadcrumbs
          items={searching
            ? [{ label: 'Home', href: '/' }, { label: 'Search' }]
            : [{ label: 'Home', href: '/' }, { label: 'Shop', href: category !== 'All' ? '/shop' : undefined }, ...(category !== 'All' ? [{ label: category }] : [])]}
        />
      </PageHeader>
      <div className={`${pageClass} lg:grid lg:grid-cols-[14rem_minmax(0,1fr)] lg:gap-10`}>
        <aside className="hidden lg:block" aria-label="Filters">
          <div className="sticky top-36 space-y-8">
            <div>
              <h2 className="eyebrow">Categories</h2>
              <ul className="mt-3 space-y-0.5">
                {categories.map(([name, count]) => (
                  <li key={name}>
                    <button
                      onClick={() => update({ category: name })}
                      aria-pressed={category === name}
                      className={`flex min-h-10 w-full items-center justify-between rounded-md px-3 text-left text-sm capitalize transition ${
                        category === name ? 'bg-ember text-white' : 'hover:bg-shell hover:text-ember'
                      }`}
                    >
                      <span className="truncate">{name === 'All' ? 'All products' : name}</span>
                      <span className={`text-sm ${category === name ? 'text-white/80' : 'text-muted'}`}>{count}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <h2 className="eyebrow">Availability</h2>
              <label className="mt-3 flex min-h-10 cursor-pointer items-center gap-3 px-1 font-medium">
                <input type="checkbox" checked={inStock} onChange={(e) => update({ stock: e.target.checked ? '1' : null })} className="size-5 accent-[var(--color-ink)]" />
                In stock only
              </label>
              {hasOffers && (
                <label className="flex min-h-10 cursor-pointer items-center gap-3 px-1 font-medium">
                  <input type="checkbox" checked={offersOnly} onChange={(e) => update({ offers: e.target.checked ? '1' : null })} className="size-5 accent-[var(--color-ink)]" />
                  Offers only
                </label>
              )}
            </div>
          </div>
        </aside>

        <div className="min-w-0">
          {categories.length > 2 && (
            <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:-mx-6 sm:px-6 lg:hidden">
              {categories.map(([name]) => (
                <button key={name} aria-pressed={category === name} onClick={() => update({ category: name })} className="chip">
                  {name === 'All' ? 'All' : name}
                </button>
              ))}
            </div>
          )}

          <div className="mt-4 flex flex-wrap items-center gap-3 lg:mt-0">
            <label className="relative order-first w-full md:hidden">
              <span className="sr-only">Search products</span>
              <Search size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted" aria-hidden />
              <input
                type="search"
                value={q}
                onChange={(e) => update({ q: e.target.value })}
                placeholder="Search products"
                className="h-11 w-full rounded-md border border-line bg-white pl-10 pr-4 text-base focus:border-ember focus:outline-none"
              />
            </label>
            <p className="mr-auto text-muted" aria-live="polite">
              {visible.length} {visible.length === 1 ? 'product' : 'products'}
            </p>
            <label className="flex min-h-10 cursor-pointer items-center gap-2 text-sm font-medium lg:hidden">
              <input type="checkbox" checked={inStock} onChange={(e) => update({ stock: e.target.checked ? '1' : null })} className="size-5 accent-[var(--color-ink)]" />
              In stock
            </label>
            {hasOffers && (
              <label className="flex min-h-10 cursor-pointer items-center gap-2 text-sm font-medium lg:hidden">
                <input type="checkbox" checked={offersOnly} onChange={(e) => update({ offers: e.target.checked ? '1' : null })} className="size-5 accent-[var(--color-ink)]" />
                Offers
              </label>
            )}
            <label className="flex items-center gap-2 text-sm font-medium">
              <span className="hidden sm:inline">Sort by</span>
              <select value={sort} onChange={(e) => update({ sort: e.target.value })} className="h-10 rounded-md border border-line bg-white px-3 text-sm">
                {SORTS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
              </select>
            </label>
          </div>

          {filtersOn && (
            <div className="mt-3 flex flex-wrap gap-2">
              {q && <FilterTag label={`“${q}”`} onRemove={() => update({ q: null })} />}
              {category !== 'All' && <FilterTag label={category} onRemove={() => update({ category: null })} />}
              {inStock && <FilterTag label="In stock" onRemove={() => update({ stock: null })} />}
              {offersOnly && <FilterTag label="Offers" onRemove={() => update({ offers: null })} />}
              <button onClick={() => navigate(window.location.pathname, { replace: true })} className="px-2 text-sm font-medium underline">Clear all</button>
            </div>
          )}

          {visible.length > 0 ? (
            <ul className="mt-5 grid grid-cols-2 gap-2.5 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4 xl:grid-cols-5">
              {visible.map((product) => <ProductCard key={product.id} product={product} />)}
            </ul>
          ) : (
            <div className="mt-8 rounded-lg border border-dashed border-line p-8 text-center sm:p-10">
              <p className="text-lg font-semibold">
                {products.length === 0 ? 'Our product list is coming soon' : 'No products match'}
              </p>
              <p className="mt-2 text-muted">
                {products.length === 0
                  ? 'Please contact us to ask what is available today.'
                  : 'Check the spelling, try a shorter word such as “milk”, or ask our assistant.'}
              </p>
              {filtersOn && <a href="/shop" className="btn btn-secondary mt-5">Show all products</a>}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

function FilterTag({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <button onClick={onRemove} className="inline-flex min-h-9 items-center gap-1.5 rounded-full bg-sand px-3 text-sm font-medium hover:bg-sand-deep" aria-label={`Remove filter ${label}`}>
      {label} <X size={14} aria-hidden />
    </button>
  );
}
