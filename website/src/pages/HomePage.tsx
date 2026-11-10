import { ArrowRight, ChevronDown, Gift, Tag } from 'lucide-react';
import { PHOTOS, photoUrl, productPhoto } from '../images';
import { useRecent, useStorefront } from '../store';
import { formatDate, promotionLabel, Reveal, RevealList, SectionHeader, TrustStrip } from '../ui';
import { Testimonials } from './Reviews';
import HeroCarousel from './HeroCarousel';
import ProductCard from './ProductCard';
import { ArticleCard } from './ArticlesPage';

const STEPS = [
  { title: 'Choose your milk', body: 'Browse the shop, or ask our assistant what is available today.' },
  { title: 'Pay with M-Pesa', body: 'Enter your PIN when the prompt reaches your phone. That is all.' },
  { title: 'Delivery or pickup', body: 'Have it brought to you, or collect it from us when it suits you.' },
];

function Categories() {
  const { products } = useStorefront();
  const counts = new Map<string, number>();
  for (const p of products) counts.set(p.category, (counts.get(p.category) ?? 0) + 1);
  const categories = Array.from(counts.entries()).slice(0, 8);
  if (categories.length < 2) return null;
  return (
    <section className="site-gutter py-12 sm:py-16" aria-labelledby="categories-heading">
      <Reveal>
        <SectionHeader eyebrow="Our dairy" title="Shop by Category" id="categories-heading" link={{ href: '/shop', label: 'All products' }} />
      </Reveal>
      <RevealList className="no-scrollbar -mx-4 mt-6 flex snap-x gap-3 overflow-x-auto px-4 pb-2 sm:mx-0 sm:grid sm:grid-cols-3 sm:gap-5 sm:overflow-visible sm:px-0 lg:grid-cols-4">
        {categories.map(([category, count]) => (
          <li key={category} className="w-[42vw] shrink-0 snap-start sm:w-auto">
            <a href={`/shop?category=${encodeURIComponent(category)}`} className="card-lift group relative block aspect-[4/5] overflow-hidden rounded-xl bg-sand">
              <img src={photoUrl(productPhoto(category), 600, 750)} alt="" loading="lazy" className="size-full object-cover" />
              <span className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-2 bg-gradient-to-t from-black/75 to-transparent p-4 pt-16 text-white">
                <span className="min-w-0">
                  <span className="block font-display text-xl font-medium leading-tight sm:text-2xl">{category}</span>
                  <span className="text-sm text-white/80">{count} {count === 1 ? 'product' : 'products'}</span>
                </span>
                <ArrowRight size={19} strokeWidth={1.8} className="shrink-0 transition group-hover:translate-x-1" aria-hidden />
              </span>
            </a>
          </li>
        ))}
      </RevealList>
    </section>
  );
}

/** The dark feature panel. */
function HowItWorks() {
  return (
    <section className="site-gutter py-4">
      <Reveal className="ember-panel relative grid gap-8 overflow-hidden rounded-2xl p-6 sm:p-10 lg:grid-cols-[1.1fr_0.8fr_1fr] lg:gap-10 lg:p-14">
        <div className="flex flex-col justify-between gap-10">
          <p className="max-w-xs leading-relaxed text-cream/85">From the pasture to your fridge, with ordering that takes a minute or less.</p>
          <h2 className="display-lg">Good milk, made easy to order</h2>
        </div>
        <img
          src={photoUrl(PHOTOS.cow, 700, 900)}
          alt={PHOTOS.cow.alt}
          loading="lazy"
          className="aspect-[4/3] w-full rounded-lg object-cover object-[60%_50%] lg:aspect-auto lg:h-full lg:min-h-[28rem]"
        />
        <ol className="flex flex-col justify-end gap-7">
          {STEPS.map((step, index) => (
            <li key={step.title} className="border-t border-white/20 pt-4">
              <p className="text-sm text-cream/70">0{index + 1}</p>
              <h3 className="mt-1 font-display text-2xl font-medium">{step.title}</h3>
              <p className="mt-1 leading-relaxed text-cream/85">{step.body}</p>
            </li>
          ))}
        </ol>
      </Reveal>
    </section>
  );
}

function RegularOrders() {
  return (
    <section className="site-gutter grid items-center gap-8 py-14 sm:py-20 lg:grid-cols-2 lg:gap-16">
      <Reveal>
        <img src={photoUrl(PHOTOS.pour, 1000, 800)} alt={PHOTOS.pour.alt} loading="lazy" className="aspect-[5/4] w-full object-cover" />
      </Reveal>
      <Reveal>
        <p className="eyebrow">Regular orders</p>
        <h2 className="display-lg mt-2">Never Run Out of Milk</h2>
        <p className="mt-4 max-w-md text-lg leading-relaxed text-muted">
          Choose your products and your days. We prepare your order on each of those days and send you a message to pay for it.
        </p>
        <a href="/account/schedules" className="btn btn-primary mt-6">Set Up a Schedule</a>
      </Reveal>
    </section>
  );
}

/** Promo codes staff chose to show on the website. Nothing shows when there are none. */
function Promotions() {
  const { promotions = [], business } = useStorefront();
  if (promotions.length === 0) return null;
  return (
    <section className="site-gutter pt-10 sm:pt-14" aria-label="Offers">
      <ul className="grid gap-3 md:grid-cols-2">
        {promotions.slice(0, 4).map((promo) => (
          <li key={promo.code} className="flex flex-wrap items-center gap-4 rounded-2xl border border-dashed border-ember/50 bg-amber-50 p-5">
            <span className="grid size-12 shrink-0 place-items-center rounded-full bg-white text-ember"><Tag size={22} aria-hidden /></span>
            <div className="min-w-0 flex-1">
              <p className="text-lg font-bold">{promotionLabel(promo, business.currency)}</p>
              <p className="text-sm text-muted">
                {promo.description || 'Enter the code in your cart.'}
                {promo.endsAt && ` Ends ${formatDate(promo.endsAt)}.`}
              </p>
            </div>
            <span className="rounded-lg border-2 border-ink px-3 py-1.5 font-mono text-base font-bold tracking-wider">{promo.code}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function RewardsBanner() {
  const { loyalty, business } = useStorefront();
  const perShilling = loyalty?.pointsPerShilling ?? 2;
  return (
    <section className="site-gutter pb-12 sm:pb-16">
      <Reveal className="flex flex-col gap-5 rounded-2xl bg-sand p-6 sm:flex-row sm:items-center sm:p-10">
        <span className="grid size-14 shrink-0 place-items-center rounded-full bg-white text-ember"><Gift size={26} strokeWidth={1.6} aria-hidden /></span>
        <div className="flex-1">
          <h2 className="display-md">Earn points on every order</h2>
          <p className="mt-2 max-w-xl text-muted">
            Get {perShilling} points for every {business.currency} 1 you pay, then use them for money off your next order.
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <a href="/account/rewards" className="btn btn-primary">See my points</a>
          <a href="/help#how-do-reward-points-work" className="btn btn-secondary">How it works</a>
        </div>
      </Reveal>
    </section>
  );
}

const HELP_TOPICS = [
  { q: 'How do I pay?', href: '/payments' },
  { q: 'How much is delivery?', href: '/delivery' },
  { q: 'Where is my order?', href: '/track' },
  { q: 'Something was wrong with my order', href: '/returns' },
];

function HelpPanel() {
  return (
    <section className="site-gutter grid gap-6 py-12 sm:py-16 lg:grid-cols-2 lg:gap-12">
      <Reveal>
        <p className="eyebrow">Customer care</p>
        <h2 className="display-lg mt-1.5">Questions? We're Here to Help</h2>
        <p className="mt-3 max-w-md text-lg text-muted">Find quick answers, or tell us what you liked, what to improve and what you'd like us to stock.</p>
        <div className="mt-6 flex flex-wrap gap-3">
          <a href="/help" className="btn btn-primary">Visit the help centre</a>
          <a href="/feedback" className="btn btn-secondary">Share feedback</a>
        </div>
      </Reveal>
      <Reveal>
        <ul className="divide-y divide-line rounded-xl border border-line bg-white">
          {HELP_TOPICS.map((topic) => (
            <li key={topic.q}>
              <a href={topic.href} className="flex min-h-16 items-center justify-between gap-3 px-5 font-semibold transition hover:bg-amber-50">
                {topic.q}
                <ChevronDown size={18} className="-rotate-90 text-muted" aria-hidden />
              </a>
            </li>
          ))}
        </ul>
      </Reveal>
    </section>
  );
}

export default function HomePage() {
  const site = useStorefront();
  const { products, articles } = site;
  const recentIds = useRecent((s) => s.ids);
  const featured = products.filter((p) => p.inStock).slice(0, 8);
  const recent = recentIds.map((id) => products.find((p) => p.id === id)).filter((p) => p !== undefined).slice(0, 4);

  return (
    <>
      <HeroCarousel />
      <div className="site-gutter -mt-px pt-6 sm:pt-8"><TrustStrip site={site} /></div>
      <Promotions />
      <Categories />
      {featured.length > 0 && (
        <section className="bg-sand/70">
          <div className="site-gutter py-12 sm:py-16">
            <Reveal>
              <SectionHeader eyebrow="In stock now" title="Available Today" link={{ href: '/shop', label: 'See all' }} />
            </Reveal>
            <RevealList className="mt-6 grid grid-cols-2 gap-3 sm:gap-5 md:grid-cols-3 lg:grid-cols-4">
              {featured.map((product) => <ProductCard key={product.id} product={product} />)}
            </RevealList>
          </div>
        </section>
      )}
      <div className="py-10 sm:py-14"><HowItWorks /></div>
      <Testimonials />
      <RegularOrders />
      <RewardsBanner />
      {recent.length > 0 && (
        <section className="site-gutter pb-12 sm:pb-16">
          <SectionHeader title="Recently Viewed" link={{ href: '/shop', label: 'Keep shopping' }} />
          <ul className="mt-6 grid grid-cols-2 gap-3 sm:gap-5 md:grid-cols-3 lg:grid-cols-4">
            {recent.map((product) => <ProductCard key={product.id} product={product} />)}
          </ul>
        </section>
      )}
      {articles.length > 0 && (
        <section className="bg-sand/70">
          <div className="site-gutter py-12 sm:py-16">
            <Reveal>
              <SectionHeader eyebrow="Milk care" title="Guides for Your Kitchen" link={{ href: '/articles', label: 'All guides' }} />
            </Reveal>
            <RevealList className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {articles.slice(0, 3).map((article) => <ArticleCard key={article.id} article={article} />)}
            </RevealList>
          </div>
        </section>
      )}
      <HelpPanel />
    </>
  );
}
