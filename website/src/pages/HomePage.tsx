import { useState } from 'react';
import { ArrowRight, Check, Plus } from 'lucide-react';
import { PHOTOS, photoUrl, productPhoto } from '../images';
import { useCart, useStorefront } from '../store';
import { formatPrice, perUnit, ProductImage } from '../ui';
import { productPaths } from '../seo';
import ProductCard from './ProductCard';
import { ArticleCard } from './ArticlesPage';

const STEPS = [
  { title: 'Choose your milk', body: 'Browse the shop, or ask our assistant what is available today.' },
  { title: 'Pay with M-Pesa', body: 'Enter your PIN when the prompt reaches your phone. That is all.' },
  { title: 'Delivery or pickup', body: 'Have it brought to you, or collect it from us when it suits you.' },
];

function HeroProduct() {
  const { products, business } = useStorefront();
  const add = useCart((s) => s.add);
  const [added, setAdded] = useState(false);
  const product = products.find((p) => p.inStock);
  if (!product) return null;
  const href = productPaths(products).get(product.id);

  return (
    <div className="card hidden w-48 shrink-0 text-center shadow-sm lg:block xl:w-56">
      <div className="p-3">
        <a href={href} className="font-medium hover:underline">{product.name}</a>
        <p className="mt-0.5 font-semibold">
          {formatPrice(business.currency, product.price)}
          <span className="text-sm font-normal text-muted"> / {perUnit(product.unit)}</span>
        </p>
      </div>
      <div className="relative">
        <div className="aspect-[5/4] overflow-hidden"><ProductImage product={product} width={400} /></div>
        <button
          aria-label={`Add ${product.name} to cart`}
          onClick={() => {
            add(product.id);
            setAdded(true);
          }}
          className="absolute bottom-0 left-1/2 grid size-11 -translate-x-1/2 translate-y-1/2 place-items-center rounded-full border border-line bg-white shadow-md transition hover:bg-ink hover:text-cream"
        >
          {added ? <Check size={18} aria-hidden /> : <Plus size={18} strokeWidth={1.6} aria-hidden />}
        </button>
      </div>
    </div>
  );
}

function Hero() {
  const { business, articles } = useStorefront();
  const hero = business.coverImageUrl || photoUrl(PHOTOS.bottleTray, 1400, 1100);

  return (
    <section className="relative isolate overflow-hidden bg-sand">
      <img
        src={hero}
        alt=""
        fetchPriority="high"
        className="photo-warm absolute inset-0 -z-20 h-full w-full object-cover object-[70%_60%] lg:left-auto lg:right-0 lg:w-[62%]"
      />
      <div className="absolute inset-0 -z-10 bg-gradient-to-b from-sand from-30% via-sand/55 via-55% to-sand/85 lg:bg-gradient-to-r lg:from-sand lg:from-[38%] lg:via-sand/70 lg:via-[52%] lg:to-transparent lg:to-[72%]" />
      <div className="site-gutter flex min-h-[34rem] flex-col justify-between gap-10 py-12 lg:min-h-[43rem] lg:py-16">
        <h1 className="display-xl max-w-[13ch]">Fresh Milk, Poured With Care for Your Home</h1>
        <div className="flex flex-col gap-8 lg:flex-row lg:items-end lg:gap-12">
          <HeroProduct />
          <div className="max-w-md lg:pb-6">
            <p className="text-lg leading-relaxed">
              {business.description || 'Order fresh milk and dairy online, pay with M-Pesa, and choose delivery or pickup. Simple, every time.'}
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <a href="/shop" className="btn btn-primary">Shop Milk</a>
              <a href={articles.length > 0 ? '/articles' : '/contact'} className="btn btn-secondary">
                {articles.length > 0 ? 'Read Our Guides' : 'Find Us'}
              </a>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function Categories() {
  const { products } = useStorefront();
  const categories = Array.from(new Set(products.map((p) => p.category))).slice(0, 4);
  if (categories.length < 2) return null;
  return (
    <section className="site-gutter py-14 sm:py-20" aria-labelledby="categories-heading">
      <p className="eyebrow">Our dairy</p>
      <h2 id="categories-heading" className="display-lg mt-2">Shop by Category</h2>
      <ul className="mt-8 grid grid-cols-2 gap-3 sm:gap-5 lg:grid-cols-4">
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
      </ul>
    </section>
  );
}

/** The dark feature panel. */
function HowItWorks() {
  return (
    <section className="site-gutter py-4">
      <div className="ember-panel relative grid gap-8 overflow-hidden rounded-2xl p-6 sm:p-10 lg:grid-cols-[1.1fr_0.8fr_1fr] lg:gap-10 lg:p-14">
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
      </div>
    </section>
  );
}

function RegularOrders() {
  return (
    <section className="site-gutter grid items-center gap-8 py-14 sm:py-20 lg:grid-cols-2 lg:gap-16">
      <img src={photoUrl(PHOTOS.pour, 1000, 800)} alt={PHOTOS.pour.alt} loading="lazy" className="aspect-[5/4] w-full object-cover" />
      <div>
        <p className="eyebrow">Regular orders</p>
        <h2 className="display-lg mt-2">Never Run Out of Milk</h2>
        <p className="mt-4 max-w-md text-lg leading-relaxed text-muted">
          Choose your products and your days. We prepare your order on each of those days and send you a message to pay for it.
        </p>
        <a href="/account/schedules" className="btn btn-primary mt-6">Set Up a Schedule</a>
      </div>
    </section>
  );
}

export default function HomePage() {
  const { products, articles } = useStorefront();
  const featured = products.filter((p) => p.inStock).slice(0, 4);

  return (
    <>
      <Hero />
      <Categories />
      {featured.length > 0 && (
        <section className="bg-sand">
          <div className="site-gutter py-14 sm:py-20">
            <div className="flex items-end justify-between gap-4">
              <div>
                <p className="eyebrow">In stock now</p>
                <h2 className="display-lg mt-2">Available Today</h2>
              </div>
              <a href="/shop" className="shrink-0 py-3 font-medium underline underline-offset-4">See all</a>
            </div>
            <ul className="mt-8 grid grid-cols-2 gap-3 sm:gap-5 lg:grid-cols-4">
              {featured.map((product) => <ProductCard key={product.id} product={product} />)}
            </ul>
          </div>
        </section>
      )}
      <div className="py-10 sm:py-16"><HowItWorks /></div>
      <RegularOrders />
      {articles.length > 0 && (
        <section className="bg-sand">
          <div className="site-gutter py-14 sm:py-20">
            <div className="flex items-end justify-between gap-4">
              <div>
                <p className="eyebrow">Milk care</p>
                <h2 className="display-lg mt-2">Guides for Your Kitchen</h2>
              </div>
              <a href="/articles" className="shrink-0 py-3 font-medium underline underline-offset-4">All guides</a>
            </div>
            <ul className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {articles.slice(0, 3).map((article) => <ArticleCard key={article.id} article={article} />)}
            </ul>
          </div>
        </section>
      )}
      <section className="site-gutter flex flex-col items-start justify-between gap-5 py-14 sm:py-20 lg:flex-row lg:items-center">
        <div>
          <h2 className="display-lg">How Was Your Milk?</h2>
          <p className="mt-3 max-w-lg text-lg text-muted">Tell us what you liked, what to improve, or what you would like us to stock.</p>
        </div>
        <a href="/feedback" className="btn btn-secondary shrink-0">Share Feedback</a>
      </section>
    </>
  );
}
