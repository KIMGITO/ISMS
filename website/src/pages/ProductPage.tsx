import { ReactNode, useEffect, useState } from 'react';
import { Check, ChevronDown, Clock, MapPin, Minus, Plus, Share2, ShoppingBag, Store } from 'lucide-react';
import { pointsOn } from '../points';
import { productPaths } from '../seo';
import { navigate } from '../router';
import { usePanels, useRecent, useStorefront } from '../store';
import { hasStorePicker } from '../stores';
import { formatPrice, Notice, pageClass, perUnit, primaryButton, ProductImage, TrustStrip } from '../ui';
import Breadcrumbs from './Breadcrumbs';
import { OfferRibbon, PriceLine, SaveButton, useAddToCart } from './ProductCard';
import ProductCarousel from './ProductCarousel';
import { ProductReviews, RatingLine } from './Reviews';

function Accordion({ title, children, open = false }: { title: string; children: ReactNode; open?: boolean }) {
  return (
    <details className="accordion border-b border-line" open={open}>
      <summary className="flex min-h-14 items-center justify-between gap-3 font-medium">
        {title}
        <ChevronDown size={18} className="accordion-icon shrink-0 text-muted" aria-hidden />
      </summary>
      <div className="pb-5 leading-relaxed text-muted">{children}</div>
    </details>
  );
}

function QuantityPicker({ value, onChange, unit }: { value: number; onChange: (value: number) => void; unit: string }) {
  return (
    <div className="flex h-12 items-center rounded-full border border-line bg-white">
      <button aria-label="Less" onClick={() => onChange(Math.max(0.5, value - (value > 1 ? 1 : 0.5)))} className="grid size-12 place-items-center">
        <Minus size={17} aria-hidden />
      </button>
      <label>
        <span className="sr-only">Amount in {unit}</span>
        <input
          type="number"
          inputMode="decimal"
          min="0.5"
          max="1000"
          step="0.5"
          value={value}
          onChange={(e) => {
            const next = Number(e.target.value);
            if (next > 0 && next <= 1000) onChange(next);
          }}
          className="h-full w-14 bg-transparent text-center text-base font-semibold"
        />
      </label>
      <button aria-label="More" onClick={() => onChange(value + 1)} className="grid size-12 place-items-center">
        <Plus size={17} aria-hidden />
      </button>
    </div>
  );
}

function ShareButton({ title }: { title: string }) {
  const [copied, setCopied] = useState(false);
  const share = async () => {
    const url = window.location.href;
    try {
      if (navigator.share) {
        await navigator.share({ title, url });
        return;
      }
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // The person closed the share sheet, or the clipboard is blocked.
    }
  };
  return (
    <button onClick={share} className="grid size-10 place-items-center rounded-full border border-line bg-white hover:border-ink" aria-label={copied ? 'Link copied' : `Share ${title}`}>
      {copied ? <Check size={17} aria-hidden /> : <Share2 size={17} aria-hidden />}
    </button>
  );
}

/** Which branch sells it, like a marketplace's seller box, with a way to switch. */
function SoldBy() {
  const site = useStorefront();
  const open = usePanels((s) => s.open);
  const { business, settings } = site;
  const address = business.address ?? site.branches.find((b) => b.address)?.address ?? null;
  return (
    <div className="mt-6 rounded-xl border border-line p-4">
      <p className="text-sm font-medium text-muted">Sold by</p>
      <div className="mt-2 flex items-start gap-3">
        <img src={business.logoUrl || '/logo.png'} alt="" className="size-11 shrink-0 rounded-full border border-line object-cover" />
        <div className="min-w-0 flex-1">
          <p className="font-semibold">{business.name}</p>
          {address && <p className="mt-0.5 flex items-start gap-1.5 text-sm text-muted"><MapPin size={14} className="mt-0.5 shrink-0" aria-hidden /> {address}</p>}
          {settings.openingHours && <p className="mt-0.5 flex items-start gap-1.5 text-sm text-muted"><Clock size={14} className="mt-0.5 shrink-0" aria-hidden /> <span className="whitespace-pre-line">{settings.openingHours}</span></p>}
        </div>
        {hasStorePicker(site) && (
          <button onClick={() => open('store')} className="inline-flex shrink-0 items-center gap-1 text-sm font-medium text-ember hover:underline">
            <Store size={14} aria-hidden /> Change store
          </button>
        )}
      </div>
    </div>
  );
}

export default function ProductPage({ path }: { path: string }) {
  const site = useStorefront();
  const { products, business, settings, deliveryZones } = site;
  const addToCart = useAddToCart();
  const recentIds = useRecent((s) => s.ids);
  const view = useRecent((s) => s.view);
  const [quantity, setQuantity] = useState(1);
  const [added, setAdded] = useState(false);

  const paths = productPaths(products);
  const product = products.find((p) => paths.get(p.id) === path);

  useEffect(() => {
    if (product) view(product.id);
    setQuantity(1);
    setAdded(false);
  }, [product?.id, view]);

  // The phone add-to-cart bar sits above the tab bar, so floating buttons move up to clear it.
  useEffect(() => {
    if (!product?.inStock) return;
    document.documentElement.style.setProperty('--float-offset', '4.25rem');
    return () => { document.documentElement.style.removeProperty('--float-offset'); };
  }, [product?.inStock]);

  if (!product) {
    return (
      <Notice title="We can't find that product" body="It may no longer be available.">
        <a href="/shop" className={`${primaryButton} mt-6`}>Go to the shop</a>
      </Notice>
    );
  }

  const related = products.filter((p) => p.category === product.category && p.id !== product.id && p.inStock).slice(0, 12);
  const others = products.filter((p) => p.category !== product.category && p.inStock).slice(0, 12);
  const recent = recentIds.filter((id) => id !== product.id).map((id) => products.find((p) => p.id === id)).filter((p) => p !== undefined).slice(0, 12);
  const lineTotal = product.price * quantity;
  const handleAdd = () => {
    addToCart(product, quantity);
    setAdded(true);
  };
  const buyNow = () => {
    addToCart(product, quantity);
    navigate('/cart');
  };

  const deliveryText = !settings.deliveryEnabled
    ? 'We are not delivering right now. Order online and pick up from us.'
    : deliveryZones.length > 0
      ? `We deliver to ${deliveryZones.length} ${deliveryZones.length === 1 ? 'area' : 'areas'}, from ${formatPrice(business.currency, Math.min(...deliveryZones.map((z) => Number(z.fee))))}. Choose yours at checkout.`
      : Number(settings.deliveryFee) > 0
        ? `Delivery is ${formatPrice(business.currency, settings.deliveryFee)} per order, or pick up for free.`
        : 'Free delivery, or pick up from us.';

  return (
    <>
      <div className={pageClass}>
        <Breadcrumbs
          items={[
            { label: 'Home', href: '/' },
            { label: 'Shop', href: '/shop' },
            { label: product.category, href: `/shop?category=${encodeURIComponent(product.category)}` },
            { label: product.name },
          ]}
        />
        <div className="mt-4 grid gap-8 md:grid-cols-2 lg:gap-14">
          <div className="relative md:sticky md:top-36 md:self-start">
            <div className="aspect-square overflow-hidden rounded-xl border border-line bg-shell p-3 sm:p-5">
              <div className="size-full overflow-hidden rounded-lg bg-white">
                <ProductImage product={product} width={1000} fit="contain" />
              </div>
            </div>
            <OfferRibbon product={product} className="top-5 text-sm" />
            {!product.inStock && <span className="absolute right-4 top-4 rounded-full bg-ink px-3 py-1.5 text-sm font-semibold text-cream">Sold out</span>}
          </div>

          <div>
            <div className="flex items-start justify-between gap-3">
              <a href={`/shop?category=${encodeURIComponent(product.category)}`} className="eyebrow py-1 hover:underline">{product.category}</a>
              <div className="flex gap-2">
                <ShareButton title={product.name} />
                <SaveButton productId={product.id} name={product.name} className="size-10 border border-line shadow-none" />
              </div>
            </div>
            <h1 className="display-lg mt-1">{product.name}</h1>
            <RatingLine reviews={(site.reviews ?? []).filter((r) => r.productId === product.id)} href="#reviews" className="mt-2" />
            <div className="mt-3">
              <PriceLine product={product} currency={business.currency} large />
              <p className="text-sm text-muted">per {perUnit(product.unit)}</p>
            </div>
            <p className={`mt-3 inline-flex items-center gap-2 rounded-full px-3 py-1 text-sm font-semibold ${product.inStock ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-800'}`}>
              <span className={`size-2 rounded-full ${product.inStock ? 'bg-emerald-600' : 'bg-red-600'}`} />
              {product.inStock ? 'In stock, ready to order' : 'Out of stock right now'}
            </p>
            {product.description && <p className="mt-5 text-lg leading-relaxed text-muted">{product.description}</p>}

            {product.inStock ? (
              <div className="mt-7 space-y-3">
                <div className="flex flex-wrap items-center gap-3">
                  <QuantityPicker value={quantity} onChange={setQuantity} unit={product.unit} />
                  <p className="text-muted">Total <span className="font-semibold text-ink">{formatPrice(business.currency, lineTotal)}</span></p>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <button onClick={handleAdd} className="btn btn-primary min-h-12">
                    {added ? <Check size={18} aria-hidden /> : <ShoppingBag size={18} aria-hidden />}
                    {added ? 'Added. Add more?' : 'Add to cart'}
                  </button>
                  <button onClick={buyNow} className="btn btn-dark min-h-12">Buy now</button>
                </div>
              </div>
            ) : (
              <div className="mt-7 rounded-xl bg-sand p-4">
                <p className="font-semibold">Back soon</p>
                <p className="mt-1 text-muted">
                  Save it to find it quickly later, or <a href="/account/messages" className="font-medium text-ink underline">ask us</a> when it will be back.
                </p>
              </div>
            )}

            <dl className="mt-8 grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-line bg-line text-sm">
              {[
                ['Category', product.category],
                ['Sold per', perUnit(product.unit)],
                ['Availability', product.inStock ? 'In stock' : 'Out of stock'],
                ['Sold by', business.name],
              ].map(([label, value]) => (
                <div key={label} className="bg-white px-4 py-3">
                  <dt className="text-muted">{label}</dt>
                  <dd className="mt-0.5 font-semibold capitalize">{value}</dd>
                </div>
              ))}
            </dl>

            <SoldBy />

            <div className="mt-6 border-t border-line">
              <Accordion title="Delivery & pickup" open>
                <p>{deliveryText}</p>
                {Number(settings.minOrder) > 0 && <p className="mt-2">Minimum order {formatPrice(business.currency, settings.minOrder)}.</p>}
                <a href="/delivery" className="mt-2 inline-block font-medium text-ink underline">Delivery details</a>
              </Accordion>
              <Accordion title="Payment">
                <p>Pay with M-Pesa. After you order we send a prompt to your phone. Enter your PIN and you're done.{pointsOn(site) && ' Every paid order earns reward points.'}</p>
                <a href="/payments" className="mt-2 inline-block font-medium text-ink underline">How payment works</a>
              </Accordion>
              <Accordion title="Freshness & returns">
                <p>Keep fresh dairy in the fridge as soon as it arrives. If anything is wrong with your order, tell us within 24 hours and we'll replace or refund it.</p>
                <a href="/returns" className="mt-2 inline-block font-medium text-ink underline">Returns & refunds</a>
              </Accordion>
              <Accordion title="Order it regularly">
                <p>Need this every week? Set up a regular order and we'll prepare it on your chosen days.</p>
                <a href="/account/schedules" className="mt-2 inline-block font-medium text-ink underline">Set up a regular order</a>
              </Accordion>
            </div>
          </div>
        </div>

        <div className="mt-12"><TrustStrip site={site} compact /></div>

        <ProductReviews productId={product.id} productName={product.name} />

      </div>

      <ProductCarousel id="related" title={`More ${product.category}`} products={related} viewAll={`/shop?category=${encodeURIComponent(product.category)}`} />
      <ProductCarousel id="top-selling" title="Top selling products" products={others} viewAll="/shop" />
      <ProductCarousel id="recent" title="Recently viewed" products={recent} />

      {product.inStock && <div className="h-16 md:hidden" aria-hidden />}
      {product.inStock && (
        <div className="fixed inset-x-0 bottom-[calc(3.5rem+env(safe-area-inset-bottom))] z-20 border-t border-line bg-white/95 px-4 py-2.5 backdrop-blur md:hidden">
          <div className="flex items-center gap-3">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">{product.name}</p>
              <p className="text-sm text-muted">{formatPrice(business.currency, lineTotal)}</p>
            </div>
            <button onClick={handleAdd} className="btn btn-primary min-h-11 shrink-0 px-5">
              {added ? <Check size={17} aria-hidden /> : <ShoppingBag size={17} aria-hidden />} {added ? 'Added' : 'Add'}
            </button>
          </div>
        </div>
      )}
    </>
  );
}
