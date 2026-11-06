import { ArrowRight } from 'lucide-react';
import { PHOTOS, photoUrl, productPhoto } from '../images';
import { useStorefront } from '../store';
import { DisplayText, Reveal, RevealList } from '../ui';
import HeroCarousel from './HeroCarousel';
import ProductCard from './ProductCard';
import { ArticleCard } from './ArticlesPage';

const STEPS = [
  { title: 'Choose your milk', body: 'Browse the shop, or ask our assistant what is available today.' },
  { title: 'Pay with M-Pesa', body: 'Enter your PIN when the prompt reaches your phone. That is all.' },
  { title: 'Delivery or pickup', body: 'Have it brought to you, or collect it from us when it suits you.' },
];

const MARQUEE_ITEMS = ['Order online', 'Pay with M-Pesa', 'Delivery or pickup', 'Regular orders', 'Milk care guides'];

function Marquee() {
  const items = [...MARQUEE_ITEMS, ...MARQUEE_ITEMS, ...MARQUEE_ITEMS, ...MARQUEE_ITEMS];
  return (
    <div className="marquee overflow-hidden border-b border-line bg-cream py-4" aria-hidden>
      <div className="marquee-track flex w-max gap-10">
        {items.map((item, index) => (
          <span key={index} className="flex items-center gap-10 whitespace-nowrap font-display text-2xl">
            <span><DisplayText>{item}</DisplayText></span>
            <span className="size-1.5 rounded-full bg-ember" />
          </span>
        ))}
      </div>
    </div>
  );
}

function Categories() {
  const { products } = useStorefront();
  const categories = Array.from(new Set(products.map((p) => p.category))).slice(0, 4);
  if (categories.length < 2) return null;
  return (
    <section className="site-gutter py-14 sm:py-20" aria-labelledby="categories-heading">
      <Reveal>
        <p className="eyebrow">Our dairy</p>
        <h2 id="categories-heading" className="display-lg mt-2">Shop by Category</h2>
      </Reveal>
      <RevealList className="mt-8 grid grid-cols-2 gap-3 sm:gap-5 lg:grid-cols-4">
        {categories.map((category) => (
          <li key={category}>
            <a href={`/shop?category=${encodeURIComponent(category)}`} className="card-lift group relative block aspect-[4/5] overflow-hidden bg-sand">
              <img src={photoUrl(productPhoto(category), 600, 750)} alt="" loading="lazy" className="size-full object-cover" />
              <span className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-2 bg-gradient-to-t from-black/70 to-transparent p-4 pt-14 text-white">
                <span className="font-display text-2xl sm:text-3xl">{category}</span>
                <ArrowRight size={19} strokeWidth={1.6} className="shrink-0 transition group-hover:translate-x-1" aria-hidden />
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
              <h3 className="mt-1 font-display text-2xl">{step.title}</h3>
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

export default function HomePage() {
  const { products, articles } = useStorefront();
  const featured = products.filter((p) => p.inStock).slice(0, 4);

  return (
    <>
      <HeroCarousel />
      <Marquee />
      <Categories />
      {featured.length > 0 && (
        <section className="bg-sand">
          <div className="site-gutter py-14 sm:py-20">
            <Reveal className="flex items-end justify-between gap-4">
              <div>
                <p className="eyebrow">In stock now</p>
                <h2 className="display-lg mt-2">Available Today</h2>
              </div>
              <a href="/shop" className="shrink-0 py-3 font-medium underline underline-offset-4">See all</a>
            </Reveal>
            <RevealList className="mt-8 grid grid-cols-2 gap-3 sm:gap-5 lg:grid-cols-4">
              {featured.map((product) => <ProductCard key={product.id} product={product} />)}
            </RevealList>
          </div>
        </section>
      )}
      <div className="py-10 sm:py-16"><HowItWorks /></div>
      <RegularOrders />
      {articles.length > 0 && (
        <section className="bg-sand">
          <div className="site-gutter py-14 sm:py-20">
            <Reveal className="flex items-end justify-between gap-4">
              <div>
                <p className="eyebrow">Milk care</p>
                <h2 className="display-lg mt-2">Guides for Your Kitchen</h2>
              </div>
              <a href="/articles" className="shrink-0 py-3 font-medium underline underline-offset-4">All guides</a>
            </Reveal>
            <RevealList className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {articles.slice(0, 3).map((article) => <ArticleCard key={article.id} article={article} />)}
            </RevealList>
          </div>
        </section>
      )}
      <section className="site-gutter py-14 sm:py-20">
        <Reveal className="flex flex-col items-start justify-between gap-5 lg:flex-row lg:items-center">
          <div>
            <h2 className="display-lg">How Was Your Milk?</h2>
            <p className="mt-3 max-w-lg text-lg text-muted">Tell us what you liked, what to improve, or what you would like us to stock.</p>
          </div>
          <a href="/feedback" className="btn btn-secondary shrink-0">Share Feedback</a>
        </Reveal>
      </section>
    </>
  );
}
