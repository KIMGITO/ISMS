import { useState } from 'react';
import { Check, Plus } from 'lucide-react';
import { Product } from '../api';
import { productPaths } from '../seo';
import { useCart, useStorefront } from '../store';
import { formatPrice, perUnit, ProductImage } from '../ui';

export default function ProductCard({ product }: { product: Product }) {
  const { business, products } = useStorefront();
  const href = productPaths(products).get(product.id);
  const add = useCart((s) => s.add);
  const [justAdded, setJustAdded] = useState(false);

  return (
    <li className="card card-lift flex flex-col text-center">
      <div className="px-3 pt-4 sm:px-5 sm:pt-5">
        <h3 className="text-[0.9375rem] font-medium sm:text-lg">
          <a href={href} className="hover:underline">{product.name}</a>
        </h3>
        <p className="mt-1 font-semibold sm:text-lg">
          {formatPrice(business.currency, product.price)}
          <span className="text-sm font-normal text-muted"> / {perUnit(product.unit)}</span>
        </p>
      </div>
      <div className="relative mt-3 sm:mt-4">
        <a href={href} className="block aspect-square overflow-hidden" tabIndex={-1} aria-hidden>
          <ProductImage product={product} />
        </a>
        {product.inStock ? (
          <button
            aria-label={`Add ${product.name} to cart`}
            onClick={() => {
              add(product.id);
              setJustAdded(true);
              setTimeout(() => setJustAdded(false), 1500);
            }}
            className="plus-button absolute -bottom-0 left-1/2 grid size-12 -translate-x-1/2 translate-y-1/3 place-items-center rounded-full border border-line bg-white text-ink shadow-md hover:bg-ink hover:text-cream"
          >
            {justAdded ? <Check size={19} aria-hidden /> : <Plus size={19} strokeWidth={1.6} aria-hidden />}
          </button>
        ) : (
          <span className="absolute bottom-3 left-1/2 -translate-x-1/2 whitespace-nowrap bg-ink px-3 py-1.5 text-sm text-cream">Out of stock</span>
        )}
      </div>
      <div className="h-7 sm:h-8" />
    </li>
  );
}
