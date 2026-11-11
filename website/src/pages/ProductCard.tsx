import { useState } from 'react';
import { Check, Heart, ShoppingCart, Star } from 'lucide-react';
import { Product } from '../api';
import { productPaths } from '../seo';
import { useCart, useSaved, useStorefront, useToast } from '../store';
import { formatPrice, perUnit, ProductImage } from '../ui';

export function SaveButton({ productId, name, className = '' }: { productId: string; name: string; className?: string }) {
  const saved = useSaved((s) => s.ids.includes(productId));
  const toggle = useSaved((s) => s.toggle);
  return (
    <button
      type="button"
      onClick={() => toggle(productId)}
      aria-pressed={saved}
      aria-label={saved ? `Remove ${name} from saved items` : `Save ${name} for later`}
      className={`grid place-items-center rounded-full bg-white/95 shadow-sm transition hover:scale-105 ${saved ? 'text-ember' : 'text-ink'} ${className}`}
    >
      <Heart size={15} strokeWidth={1.9} fill={saved ? 'currentColor' : 'none'} aria-hidden />
    </button>
  );
}

/** Adds to the cart and confirms with a toast. */
export function useAddToCart() {
  const add = useCart((s) => s.add);
  const show = useToast((s) => s.show);
  return (product: Product, quantity = 1) => {
    add(product.id, quantity);
    show(`${product.name} added to your cart`);
  };
}

export default function ProductCard({ product, as = 'li' }: { product: Product; as?: 'li' | 'div' }) {
  const { business, products, reviews = [] } = useStorefront();
  const href = productPaths(products).get(product.id);
  const ratings = reviews.filter((r) => r.productId === product.id);
  const average = ratings.length ? ratings.reduce((sum, r) => sum + r.rating, 0) / ratings.length : 0;
  const addToCart = useAddToCart();
  const [justAdded, setJustAdded] = useState(false);
  const Tag = as;

  // A small bordered card: photo on a soft tile, category and rating, name, price in green and an "Add" pill.
  return (
    <Tag className="group flex min-w-0 flex-col rounded-lg border border-line bg-white p-1.5 transition hover:border-ember/40 hover:shadow-soft sm:p-2.5">
      <div className="relative">
        <a href={href} className="block aspect-square overflow-hidden rounded-md bg-shell" tabIndex={-1} aria-hidden>
          <span className="block size-full transition duration-500 group-hover:scale-[1.04]">
            <ProductImage product={product} width={500} />
          </span>
        </a>
        {!product.inStock && (
          <span className="absolute left-2 top-2 rounded-full bg-ink/90 px-2.5 py-0.5 text-[0.6875rem] font-medium text-cream">Sold out</span>
        )}
        <SaveButton
          productId={product.id}
          name={product.name}
          className="absolute -bottom-3.5 left-1/2 size-7 -translate-x-1/2 border border-line shadow-none hover:scale-110 sm:-bottom-4 sm:size-8"
        />
      </div>
      <div className="flex flex-1 flex-col px-0.5 pb-0.5 pt-4 sm:px-1.5 sm:pt-5">
        <div className="flex items-center justify-between gap-1 text-[0.625rem] text-muted sm:gap-2 sm:text-[0.6875rem]">
          <span className="truncate">{product.category}</span>
          {ratings.length > 0 && (
            <span className="flex shrink-0 items-center gap-0.5">
              <Star size={11} className="text-star" fill="currentColor" strokeWidth={0} aria-hidden />
              {average.toFixed(1)}
              <span className="sr-only"> out of 5 from {ratings.length} {ratings.length === 1 ? 'review' : 'reviews'}</span>
            </span>
          )}
        </div>
        <h3 className="mt-0.5 line-clamp-2 text-xs font-medium leading-snug sm:mt-1 sm:text-sm">
          <a href={href} className="hover:text-ember">{product.name}</a>
        </h3>
        <div className="mt-auto flex flex-col gap-1.5 pt-2 sm:flex-row sm:items-end sm:justify-between sm:pt-2.5">
          <p className="min-w-0 leading-tight">
            <span className="hidden text-[0.6875rem] text-muted sm:block">per {perUnit(product.unit)}</span>
            <span className="block text-[0.8125rem] font-semibold text-leaf sm:text-base">{formatPrice(business.currency, product.price)}</span>
          </p>
          {product.inStock ? (
            <button
              aria-label={`Add ${product.name} to cart`}
              onClick={() => {
                addToCart(product);
                setJustAdded(true);
                setTimeout(() => setJustAdded(false), 1500);
              }}
              className={`btn btn-sm shrink-0 gap-1 px-3 max-sm:min-h-7 max-sm:w-full max-sm:text-[0.6875rem] ${justAdded ? 'border border-leaf bg-leaf text-white' : 'btn-primary'}`}
            >
              {justAdded ? <Check size={14} aria-hidden /> : <ShoppingCart size={14} aria-hidden />}
              <span>{justAdded ? 'Added' : 'Add'}</span>
            </button>
          ) : (
            <a href={href} className="shrink-0 py-1 text-center text-xs text-muted underline">Details</a>
          )}
        </div>
      </div>
    </Tag>
  );
}
