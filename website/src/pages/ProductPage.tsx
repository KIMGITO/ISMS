import { useState } from 'react';
import { Check, CreditCard, Minus, Plus, ShoppingCart, Truck } from 'lucide-react';
import { productPaths } from '../seo';
import { useCart, useStorefront } from '../store';
import { formatPrice, Notice, pageClass, perUnit, primaryButton, ProductImage, secondaryButton } from '../ui';
import Breadcrumbs from './Breadcrumbs';
import ProductCard from './ProductCard';

export default function ProductPage({ path }: { path: string }) {
  const { products, business, settings } = useStorefront();
  const add = useCart((s) => s.add);
  const [quantity, setQuantity] = useState(1);
  const [added, setAdded] = useState(false);

  const paths = productPaths(products);
  const product = products.find((p) => paths.get(p.id) === path);

  if (!product) {
    return (
      <Notice title="We can't find that product" body="It may no longer be available.">
        <a href="/shop" className={`${primaryButton} mt-6`}>Go to the shop</a>
      </Notice>
    );
  }

  const related = products.filter((p) => p.category === product.category && p.id !== product.id && p.inStock).slice(0, 3);

  return (
    <div className={pageClass}>
      <Breadcrumbs items={[{ label: 'Home', href: '/' }, { label: 'Shop', href: '/shop' }, { label: product.name }]} />
      <div className="mt-4 grid gap-8 md:grid-cols-2 lg:gap-12">
        <div className="aspect-square overflow-hidden rounded-xl border border-line bg-white">
          <ProductImage product={product} />
        </div>
        <div>
          <p className="font-medium text-brand-deep">{product.category}</p>
          <h1 className="mt-1 text-3xl font-bold sm:text-4xl">{product.name}</h1>
          <p className="mt-4 text-3xl font-bold">
            {formatPrice(business.currency, product.price)}
            <span className="text-base font-normal text-muted"> per {perUnit(product.unit)}</span>
          </p>
          <p className={`mt-2 font-medium ${product.inStock ? 'text-emerald-700' : 'text-red-700'}`}>
            {product.inStock ? 'In stock' : 'Out of stock'}
          </p>
          {product.description && <p className="mt-5 text-lg leading-relaxed text-muted">{product.description}</p>}

          {product.inStock && (
            <div className="mt-6 flex flex-col gap-3 sm:flex-row">
              <div className="flex items-center self-start">
                <button
                  aria-label="Less"
                  onClick={() => setQuantity(Math.max(0.5, quantity - (quantity > 1 ? 1 : 0.5)))}
                  className="grid size-12 place-items-center rounded-l-lg border border-line"
                >
                  <Minus size={17} aria-hidden />
                </button>
                <label>
                  <span className="sr-only">Amount in {product.unit}</span>
                  <input
                    type="number"
                    inputMode="decimal"
                    min="0.5"
                    max="1000"
                    step="0.5"
                    value={quantity}
                    onChange={(e) => {
                      const value = Number(e.target.value);
                      if (value > 0 && value <= 1000) setQuantity(value);
                    }}
                    className="h-12 w-20 border-y border-line text-center text-base"
                  />
                </label>
                <button aria-label="More" onClick={() => setQuantity(quantity + 1)} className="grid size-12 place-items-center rounded-r-lg border border-line">
                  <Plus size={17} aria-hidden />
                </button>
              </div>
              <button
                onClick={() => {
                  add(product.id, quantity);
                  setAdded(true);
                }}
                className={`${primaryButton} min-h-12 sm:flex-1`}
              >
                {added ? <Check size={18} aria-hidden /> : <ShoppingCart size={18} aria-hidden />}
                {added ? 'Added to cart' : 'Add to cart'}
              </button>
            </div>
          )}
          {added && <a href="/cart" className={`${secondaryButton} mt-3 w-full`}>View cart and check out</a>}

          <ul className="mt-6 space-y-2.5 border-t border-line pt-5 text-muted">
            <li className="flex items-center gap-2.5"><CreditCard size={19} className="shrink-0" aria-hidden /> Pay securely with M-Pesa</li>
            <li className="flex items-center gap-2.5">
              <Truck size={19} className="shrink-0" aria-hidden />
              {settings.deliveryEnabled
                ? `Delivery for ${formatPrice(business.currency, settings.deliveryFee)}, or pick up in store`
                : 'Pick up in store'}
            </li>
          </ul>
        </div>
      </div>

      {related.length > 0 && (
        <section className="mt-14">
          <h2 className="text-2xl font-bold">You may also like</h2>
          <ul className="mt-5 grid grid-cols-2 gap-3 sm:gap-5 lg:grid-cols-3">
            {related.map((p) => <ProductCard key={p.id} product={p} />)}
          </ul>
        </section>
      )}
    </div>
  );
}
