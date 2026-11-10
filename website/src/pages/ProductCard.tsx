import { useState } from 'react';
import { Check, Heart, Plus } from 'lucide-react';
import { Product } from '../api';
import { productPaths } from '../seo';
import { useCart, useSaved, useStorefront, useToast } from '../store';
import { formatPrice, perUnit, ProductImage } from '../ui';
import { Stars } from './Reviews';

export function SaveButton({ productId, name, className = '' }: { productId: string; name: string; className?: string }) {
  const saved = useSaved((s) => s.ids.includes(productId));
  const toggle = useSaved((s) => s.toggle);
  return (
    <button
      type="button"
      onClick={() => toggle(productId)}
      aria-pressed={saved}
      aria-label={saved ? `Remove ${name} from saved items` : `Save ${name} for later`}
      className={`grid size-10 place-items-center rounded-full bg-white/95 shadow-sm transition hover:scale-105 ${saved ? 'text-ember' : 'text-ink'} ${className}`}
    >
      <Heart size={18} strokeWidth={1.8} fill={saved ? 'currentColor' : 'none'} aria-hidden />
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

  return (
    <Tag className="card card-lift group flex flex-col overflow-hidden">
      <div className="relative">
        <a href={href} className="block aspect-square overflow-hidden bg-sand" tabIndex={-1} aria-hidden>
          <ProductImage product={product} width={500} />
        </a>
        <SaveButton productId={product.id} name={product.name} className="absolute right-2.5 top-2.5" />
        {!product.inStock && (
          <span className="absolute left-2.5 top-2.5 rounded-full bg-ink/90 px-2.5 py-1 text-xs font-semibold text-cream">Sold out</span>
        )}
      </div>
      <div className="flex flex-1 flex-col p-3 sm:p-4">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted">{product.category}</p>
        <h3 className="mt-1 line-clamp-2 text-[0.9375rem] font-semibold leading-snug sm:text-base">
          <a href={href} className="hover:text-brand-deep">{product.name}</a>
        </h3>
        {ratings.length > 0 && (
          <p className="mt-1 flex items-center gap-1 text-xs text-muted">
            <Stars rating={average} size={13} /> <span>({ratings.length})</span>
          </p>
        )}
        <div className="mt-auto flex items-end justify-between gap-2 pt-3">
          <p className="min-w-0 font-bold leading-tight sm:text-lg">
            {formatPrice(business.currency, product.price)}
            <span className="block text-xs font-normal text-muted sm:inline sm:text-sm"> / {perUnit(product.unit)}</span>
          </p>
          {product.inStock ? (
            <button
              aria-label={`Add ${product.name} to cart`}
              onClick={() => {
                addToCart(product);
                setJustAdded(true);
                setTimeout(() => setJustAdded(false), 1500);
              }}
              className={`grid size-10 shrink-0 place-items-center rounded-full transition sm:size-11 ${
                justAdded ? 'bg-leaf text-white' : 'bg-ink text-cream hover:bg-ember'
              }`}
            >
              {justAdded ? <Check size={18} aria-hidden /> : <Plus size={19} strokeWidth={2} aria-hidden />}
            </button>
          ) : (
            <a href={href} className="shrink-0 py-2 text-sm font-medium text-muted underline">Details</a>
          )}
        </div>
      </div>
    </Tag>
  );
}
