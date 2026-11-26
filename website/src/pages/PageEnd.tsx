import { MessageCircle, Phone, Truck } from 'lucide-react';
import { Product } from '../api';
import { useStorefront } from '../store';
import { TrustStrip } from '../ui';
import ProductCarousel from './ProductCarousel';

/** Ways to order without the website, like a shop's "get the app" band. Ends the home page and inner pages. */
export function OrderAnyWayBand({ gap = 'pt-12 sm:pt-16', title = 'Order the way that suits you', track = true }: {
  gap?: string; title?: string; track?: boolean;
} = {}) {
  const { business, settings } = useStorefront();
  const phone = business.contactPhone;
  const whatsapp = settings.whatsapp || phone;
  const whatsappHref = whatsapp ? `https://wa.me/${whatsapp.replace(/\D/g, '').replace(/^0/, '254')}` : null;
  return (
    <section className={`site-gutter ${gap}`} aria-labelledby="order-heading">
      <div className="soft-panel flex flex-col items-center gap-5 rounded-2xl px-5 py-8 text-center sm:px-10 sm:py-12 lg:flex-row lg:justify-between lg:text-left">
        <div className="max-w-xl">
          <h2 id="order-heading" className="display-lg font-semibold">{title}</h2>
          <p className="mt-2 text-sm text-muted sm:text-base">
            Order here, or message us and we'll put it together.
          </p>
        </div>
        <div className="pill-row pill-row-center gap-2.5">
          {whatsappHref && (
            <a href={whatsappHref} target="_blank" rel="noopener noreferrer" className="btn btn-primary"><MessageCircle size={16} aria-hidden /> WhatsApp us</a>
          )}
          {phone && <a href={`tel:${phone.replace(/\s/g, '')}`} className="btn btn-dark"><Phone size={16} aria-hidden /> Call {phone}</a>}
          {track && <a href="/track" className="btn btn-secondary"><Truck size={16} aria-hidden /> Track an order</a>}
        </div>
      </div>
    </section>
  );
}

/**
 * The close of every inner content page (About, Help, policies, Contact, Feedback and the rest):
 * the same popular products row, trust boxes and order band as the home page, so no page ends
 * on an empty cream background and every page still feels like the shop.
 */
export default function PageEnd() {
  const site = useStorefront();
  const inStockFirst = (list: Product[]) => [...list].sort((a, b) => Number(b.inStock) - Number(a.inStock));
  const popular = inStockFirst(site.products).slice(0, 12);
  return (
    <div className="pb-4">
      <ProductCarousel id="page-end-popular" title="Our Products" products={popular} viewAll={site.products.length > popular.length ? '/shop' : undefined} />
      <div className="site-gutter pt-12 sm:pt-16"><TrustStrip site={site} /></div>
      <OrderAnyWayBand />
    </div>
  );
}
