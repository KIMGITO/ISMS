import { useEffect, useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { useStorefront } from '../store';
import { PHOTOS } from '../images';
import { PageHero, pageClass, RevealList } from '../ui';
import Breadcrumbs from './Breadcrumbs';
import ProductCard from './ProductCard';

export default function ShopPage({ initialQuery }: { initialQuery: string }) {
  const { products } = useStorefront();
  const [query, setQuery] = useState(initialQuery);
  const [category, setCategory] = useState(() => new URLSearchParams(window.location.search).get('category') ?? 'All');

  useEffect(() => {
    setQuery(initialQuery);
  }, [initialQuery]);

  useEffect(() => {
    setCategory(new URLSearchParams(window.location.search).get('category') ?? 'All');
  }, [window.location.search]);

  const categories = useMemo(() => ['All', ...Array.from(new Set(products.map((p) => p.category)))], [products]);

  const visible = useMemo(() => {
    const term = query.trim().toLowerCase();
    return products.filter(
      (p) =>
        (category === 'All' || p.category === category) &&
        (!term || `${p.name} ${p.description ?? ''}`.toLowerCase().includes(term)),
    );
  }, [products, query, category]);

  return (
    <>
      <PageHero
        eyebrow="Our dairy"
        title="Shop"
        body="Order online, pay with M-Pesa, and choose delivery or pickup."
        photo={PHOTOS.pour}
      >
        <Breadcrumbs items={[{ label: 'Home', href: '/' }, { label: 'Shop' }]} />
      </PageHero>
      <div className={pageClass}>
      <div className="flex justify-end">
        {products.length > 0 && (
          <label className="relative block w-full sm:w-72">
            <span className="sr-only">Search products</span>
            <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" aria-hidden />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search products"
              className="min-h-11 w-full rounded-lg border border-line bg-white py-2.5 pl-10 pr-3 text-base"
            />
          </label>
        )}
      </div>

      {categories.length > 2 && (
        <div className="-mx-4 mt-6 flex gap-2 overflow-x-auto px-4 pb-2 sm:mx-0 sm:flex-wrap sm:px-0">
          {categories.map((c) => (
            <button
              key={c}
              aria-pressed={c === category}
              onClick={() => setCategory(c)}
              className={`min-h-11 shrink-0 rounded-full border px-4 font-medium transition ${
                c === category ? 'border-brand bg-brand text-on-brand' : 'border-line bg-white text-muted hover:text-ink'
              }`}
            >
              {c}
            </button>
          ))}
        </div>
      )}

      {visible.length > 0 ? (
        <RevealList className="mt-8 grid grid-cols-2 gap-3 sm:gap-5 lg:grid-cols-4">
          {visible.map((product) => (
            <ProductCard key={product.id} product={product} />
          ))}
        </RevealList>
      ) : (
        <p className="mt-10 rounded-xl border border-dashed border-line p-10 text-center text-muted">
          {products.length === 0
            ? 'Our product list is coming soon. Please contact us to ask what is available today.'
            : 'No products match your search.'}
        </p>
      )}
      </div>
    </>
  );
}
