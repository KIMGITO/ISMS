import { Heart, Minus, Plus, Star } from 'lucide-react';
import { Product } from '../api';
import { percentOff } from '../adCards';
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

/** The offer ribbon on the card's top-left corner: "20% Off". */
export function OfferRibbon({ product, className = '' }: { product: Pick<Product, 'price' | 'wasPrice'>; className?: string }) {
  const off = percentOff(product.price, product.wasPrice);
  if (!off) return null;
  return (
    <span className={`absolute left-0 z-10 flex flex-col rounded-r-full bg-accent py-1 pl-2 pr-3 text-[0.6875rem] font-semibold leading-tight text-on-accent sm:text-xs ${className}`}>
      {off}%<span className="font-normal">Off</span>
    </span>
  );
}

/** Price with the old price struck through and the saving, as on the card and product page. */
export function PriceLine({ product, currency, large = false }: { product: Pick<Product, 'price' | 'wasPrice'>; currency: string; large?: boolean }) {
  const off = percentOff(product.price, product.wasPrice);
  return (
    <p className={`flex flex-wrap items-baseline gap-x-2 leading-tight ${large ? 'gap-y-1' : ''}`}>
      <span className={`font-semibold text-leaf ${large ? 'text-3xl' : 'text-sm sm:text-base'}`}>{formatPrice(currency, product.price)}</span>
      {off > 0 && (
        <>
          <span className={`text-muted line-through ${large ? 'text-lg' : 'text-[0.6875rem] sm:text-xs'}`}>
            <span className="sr-only">was </span>{formatPrice(currency, product.wasPrice!)}
          </span>
          <span className={`font-semibold text-ember ${large ? 'text-sm' : 'text-[0.6875rem] sm:text-xs'}`}>{off}% Off</span>
        </>
      )}
    </p>
  );
}

/**
 * "Add" until the product is in the cart, then a − amount + stepper on the card itself, so a
 * customer can fill the cart from any list without opening the product.
 */
export function CartStepper({ product, size = 'sm' }: { product: Product; size?: 'sm' | 'lg' }) {
  const line = useCart((s) => s.lines.find((l) => l.productId === product.id));
  const setQuantity = useCart((s) => s.setQuantity);
  const remove = useCart((s) => s.remove);
  const addToCart = useAddToCart();
  const height = size === 'lg' ? 'h-12' : 'h-8 sm:h-9';

  if (!line) {
    return (
      <button
        type="button"
        aria-label={`Add ${product.name} to cart`}
        onClick={() => addToCart(product)}
        className={`${height} w-full rounded-full border border-ember bg-white text-xs font-semibold text-ember transition hover:bg-ember hover:text-white sm:text-[0.8125rem]`}
      >
        Add
      </button>
    );
  }
  const less = () => (line.quantity <= 1 ? remove(product.id) : setQuantity(product.id, line.quantity - 1));
  return (
    <div className={`${height} flex w-full items-center justify-between rounded-full bg-ember text-white`} role="group" aria-label={`${product.name} in cart`}>
      <button type="button" onClick={less} aria-label={line.quantity <= 1 ? `Remove ${product.name}` : `Less ${product.name}`} className="grid h-full w-9 place-items-center rounded-l-full hover:bg-brand-deep sm:w-10">
        <Minus size={15} aria-hidden />
      </button>
      <span className="min-w-6 text-center text-sm font-semibold" aria-live="polite">{line.quantity}</span>
      <button type="button" onClick={() => setQuantity(product.id, Math.min(1000, line.quantity + 1))} aria-label={`More ${product.name}`} className="grid h-full w-9 place-items-center rounded-r-full hover:bg-brand-deep sm:w-10">
        <Plus size={15} aria-hidden />
      </button>
    </div>
  );
}

export default function ProductCard({ product, as = 'li' }: { product: Product; as?: 'li' | 'div' }) {
  const { business, products, reviews = [] } = useStorefront();
  const href = productPaths(products).get(product.id);
  const ratings = reviews.filter((r) => r.productId === product.id);
  const average = ratings.length ? ratings.reduce((sum, r) => sum + r.rating, 0) / ratings.length : 0;
  const Tag = as;

  // A bordered shop card: offer ribbon, product on white, price (with the old one struck through),
  // name, then a full-width "Add" pill that turns into a stepper.
  return (
    <Tag className="group relative flex min-w-0 flex-col rounded-lg border border-line bg-white p-2 transition hover:border-ember/40 hover:shadow-soft sm:p-3">
      <OfferRibbon product={product} className="top-3 sm:top-4" />
      <SaveButton productId={product.id} name={product.name} className="absolute right-2 top-2 z-10 size-8 border border-line shadow-none sm:right-3 sm:top-3" />
      <a href={href} className="product-media relative block overflow-hidden rounded-md bg-white" tabIndex={-1} aria-hidden>
        <span className="block size-full transition duration-500 group-hover:scale-[1.04]">
          <ProductImage product={product} width={460} fit="brand" />
        </span>
        {!product.inStock && (
          <span className="absolute inset-x-0 bottom-1 mx-auto w-fit rounded-full bg-ink/90 px-2.5 py-0.5 text-[0.6875rem] font-medium text-cream">Sold out</span>
        )}
      </a>
      <div className="flex flex-1 flex-col pt-2">
        <PriceLine product={product} currency={business.currency} />
        <h3 className="mt-1 line-clamp-2 min-h-[2.6em] text-xs font-medium leading-snug first-letter:uppercase sm:text-sm">
          <a href={href} className="hover:text-ember">{product.name}</a>
        </h3>
        <div className="mt-0.5 flex items-center justify-between gap-1 text-[0.6875rem] text-muted">
          <span className="truncate">per {perUnit(product.unit)}</span>
          {ratings.length > 0 && (
            <span className="flex shrink-0 items-center gap-0.5">
              <Star size={11} className="text-star" fill="currentColor" strokeWidth={0} aria-hidden />
              {average.toFixed(1)}
              <span className="sr-only"> out of 5 from {ratings.length} {ratings.length === 1 ? 'review' : 'reviews'}</span>
            </span>
          )}
        </div>
        <div className="mt-auto pt-2.5">
          {product.inStock ? (
            <CartStepper product={product} />
          ) : (
            <a href={href} className="grid h-8 place-items-center rounded-full border border-line text-xs text-muted sm:h-9">Details</a>
          )}
        </div>
      </div>
    </Tag>
  );
}
