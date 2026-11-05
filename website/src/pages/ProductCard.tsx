import { useState } from 'react';
import { Check, ShoppingCart } from 'lucide-react';
import { Product } from '../api';
import { productPaths } from '../seo';
import { useCart, useStorefront } from '../store';
import { cardClass, formatPrice, perUnit, primaryButton, ProductImage } from '../ui';

export default function ProductCard({ product }: { product: Product }) {
  const { business, products } = useStorefront();
  const { currency } = business;
  const href = productPaths(products).get(product.id);
  const add = useCart((s) => s.add);
  const [justAdded, setJustAdded] = useState(false);

  return (
    <li className={`${cardClass} flex flex-col overflow-hidden`}>
      <a href={href} className="block aspect-square sm:aspect-[4/3]">
        <ProductImage product={product} />
      </a>
      <div className="flex flex-1 flex-col p-3 sm:p-5">
        <p className="text-sm font-medium text-brand-deep">{product.category}</p>
        <h3 className="mt-1 text-base font-semibold sm:text-xl">
          <a href={href} className="hover:underline">{product.name}</a>
        </h3>
        {product.description && <p className="mt-2 line-clamp-2 hidden text-muted sm:block">{product.description}</p>}
        <div className="mt-auto flex flex-wrap items-end justify-between gap-x-3 gap-y-1 pt-4">
          <p className="font-bold sm:text-lg">
            {formatPrice(currency, product.price)}
            <span className="text-sm font-normal text-muted"> / {perUnit(product.unit)}</span>
          </p>
        </div>
        <button
          disabled={!product.inStock}
          onClick={() => {
            add(product.id);
            setJustAdded(true);
            setTimeout(() => setJustAdded(false), 1500);
          }}
          className={`${primaryButton} mt-3 w-full whitespace-nowrap !px-2 sm:mt-4`}
        >
          {product.inStock && (justAdded ? <Check size={18} aria-hidden /> : <ShoppingCart size={18} className="shrink-0" aria-hidden />)}
          {!product.inStock ? 'Out of stock' : justAdded ? 'Added' : 'Add to cart'}
        </button>
      </div>
    </li>
  );
}
