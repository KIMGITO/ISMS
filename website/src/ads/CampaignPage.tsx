// A campaign's own page, /promo/<address>: its banner, words, discount and code, its products,
// its video and any other creatives placed on the page. When the campaign is not showing (not
// started, paused, ended), the page says so and points to the shop: never an old offer.
import { useEffect, useMemo, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { useStorefront, usePromo } from '../store';
import ProductCard from '../pages/ProductCard';
import { trackAd, useAds } from './adStore';
import { AdPicture, useAdTracking, usePlacement, VideoPlayer } from './AdSlots';
import { FORMATS, type PlacedAd } from './rules';

export default function CampaignPage({ address }: { address: string }) {
  const site = useStorefront();
  const loaded = useAds((s) => s.ads !== null);
  const ads = usePlacement('landing', { landing: address });
  const setPromo = usePromo((s) => s.setCode);
  const [copied, setCopied] = useState(false);
  const campaign = ads[0]?.campaign;

  useEffect(() => {
    if (campaign) document.title = `${campaign.name} | ${site.business.name}`;
  }, [campaign, site.business.name]);

  const products = useMemo(() => {
    if (!campaign) return [];
    const chosen = new Set(campaign.products);
    return site.products.filter((p) => chosen.has(p.id) || (!!campaign.category && p.category === campaign.category)).slice(0, 24);
  }, [campaign, site.products]);

  if (!campaign) {
    return (
      <div className="site-gutter py-16 text-center">
        <h1 className="display-md">{loaded ? 'This offer is not running' : 'Loading offer'}</h1>
        {loaded && <p className="mt-2 text-muted">It may have ended or not started yet.</p>}
        <a href="/shop" className="btn mt-6 bg-brand text-on-brand">See the shop</a>
      </div>
    );
  }

  const banner = ads.find((a) => a.creative.format === 'hero_16x9' || a.creative.format === 'wide_3x1');
  const videos = ads.filter((a) => a.creative.format.startsWith('video'));
  const others = ads.filter((a) => a !== banner && !videos.includes(a) && a.creative.media);
  const words = ads.find((a) => a.creative.format === 'text');
  const headline = banner?.creative.headline || words?.creative.headline || campaign.name;
  const body = banner?.creative.body || words?.creative.body || campaign.description;

  const useCode = async () => {
    if (!campaign.promoCode) return;
    setPromo(campaign.promoCode);
    try { await navigator.clipboard.writeText(campaign.promoCode); } catch { /* still applied to the cart */ }
    setCopied(true);
    if (banner) trackAd(banner.creative.id, 'click');
  };

  return (
    <article className="pb-6">
      {banner && <LandingBanner ad={banner} />}
      <header className="site-gutter mt-6 max-w-3xl">
        {campaign.discount && <p className="text-sm font-semibold uppercase tracking-wide text-brand-deep">{campaign.discount}</p>}
        <h1 className="display-xl mt-1">{headline}</h1>
        {body && <p className="mt-3 text-muted sm:text-lg">{body}</p>}
        {campaign.endsAt && <p className="mt-2 text-sm text-muted">Ends {new Date(campaign.endsAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}</p>}
        {campaign.promoCode && (
          <button type="button" onClick={useCode} className="btn mt-5 border border-dashed border-brand text-ink">
            {copied ? <Check size={16} aria-hidden /> : <Copy size={16} aria-hidden />}
            {copied ? `Code ${campaign.promoCode} added to your cart` : `Use code ${campaign.promoCode}`}
          </button>
        )}
      </header>

      {products.length > 0 && (
        <section className="site-gutter mt-[var(--section-space)]" aria-label="Products in this offer">
          <h2 className="display-md mb-4">In this offer</h2>
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {products.map((p) => <ProductCard key={p.id} product={p} />)}
          </ul>
        </section>
      )}

      {videos.map((ad) => (
        <section key={ad.creative.id} className="site-gutter mt-[var(--section-space)]" aria-label={ad.creative.headline || 'Video'}>
          <div className={ad.creative.format === 'video_9x16' ? 'max-w-sm' : ''}><VideoPlayer ad={ad} /></div>
          {ad.creative.headline && <p className="mt-2 font-semibold">{ad.creative.headline}</p>}
        </section>
      ))}

      {others.length > 0 && (
        <section className="site-gutter mt-[var(--section-space)] grid grid-cols-2 gap-3 sm:grid-cols-3" aria-label="More from this offer">
          {others.map((ad) => (
            <figure key={ad.creative.id}>
              <div className="relative overflow-hidden rounded-xl bg-sand" style={{ aspectRatio: String(FORMATS[ad.creative.format].ratio ?? 1) }}>
                <div className="absolute inset-0"><AdPicture creative={ad.creative} /></div>
              </div>
              {ad.creative.headline && <figcaption className="mt-1.5 text-sm font-medium">{ad.creative.headline}</figcaption>}
            </figure>
          ))}
        </section>
      )}
    </article>
  );
}

function LandingBanner({ ad }: { ad: PlacedAd }) {
  const ref = useAdTracking(ad.creative.id);
  return (
    <div ref={ref} className="site-gutter pt-3 sm:pt-6">
      <div className="relative overflow-hidden rounded-2xl bg-sand" style={{ aspectRatio: String(FORMATS[ad.creative.format].ratio) }}>
        <div className="absolute inset-0"><AdPicture creative={ad.creative} eager /></div>
      </div>
    </div>
  );
}
