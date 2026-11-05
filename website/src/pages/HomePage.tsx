import { ArrowRight, CalendarClock, MessageCircleQuestion, Smartphone } from 'lucide-react';
import { useStorefront } from '../store';
import { cardClass, pageClass, primaryButton } from '../ui';
import ProductCard from './ProductCard';
import { ArticleCard } from './ArticlesPage';

const STEPS = [
  { icon: MessageCircleQuestion, title: 'Choose what you need', body: 'Browse our shop, or ask our assistant what is available today.' },
  { icon: Smartphone, title: 'Pay with M-Pesa', body: 'Enter your M-Pesa PIN when the prompt reaches your phone.' },
  { icon: CalendarClock, title: 'Set it and repeat', body: 'Schedule regular orders from your account on the days that suit you.' },
];

export default function HomePage() {
  const { business, products, articles } = useStorefront();
  const featured = products.filter((p) => p.inStock).slice(0, 3);
  const categories = Array.from(new Set(products.map((p) => p.category))).slice(0, 6);

  return (
    <>
      <section className="relative isolate overflow-hidden bg-hero text-white">
        <img
          src={business.coverImageUrl || '/hero.jpg'}
          alt=""
          fetchPriority="high"
          className="absolute inset-y-0 right-0 -z-20 h-full w-full object-cover object-center md:w-3/5"
        />
        <div className="absolute inset-0 -z-10 bg-hero/65 md:bg-transparent md:bg-gradient-to-r md:from-hero md:from-40% md:to-transparent md:to-75%" />
        <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6 sm:py-32">
          <div className="max-w-xl">
            <h1 className="text-5xl font-bold leading-[1.05] tracking-tight sm:text-6xl">{business.name}</h1>
            <p className="mt-5 text-lg leading-relaxed text-white/90 sm:text-xl">
              {business.description || 'Fresh dairy for your home and business.'}
            </p>
            <a href="/shop" className={`${primaryButton} mt-8`}>
              Order now <ArrowRight size={18} aria-hidden />
            </a>
          </div>
        </div>
      </section>

      {categories.length > 1 && (
        <section className={`${pageClass} !pb-0`} aria-labelledby="categories-heading">
          <h2 id="categories-heading" className="text-2xl font-bold">Shop by category</h2>
          <ul className="-mx-4 mt-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0">
            {categories.map((category) => (
              <li key={category} className="shrink-0">
                <a href={`/shop?category=${encodeURIComponent(category)}`} className="inline-flex min-h-11 items-center rounded-full border border-line px-5 font-medium hover:border-brand-deep">
                  {category}
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}

      {featured.length > 0 && (
        <section className={pageClass}>
          <div className="flex items-end justify-between gap-4">
            <h2 className="text-3xl font-bold sm:text-4xl">Available today</h2>
            <a href="/shop" className="shrink-0 py-2 font-medium text-brand-deep underline">See all</a>
          </div>
          <ul className="mt-8 grid grid-cols-2 gap-3 sm:gap-5 lg:grid-cols-3">
            {featured.map((product) => (
              <ProductCard key={product.id} product={product} />
            ))}
          </ul>
        </section>
      )}

      <section className="bg-gray-50">
        <div className={pageClass}>
          <h2 className="text-3xl font-bold sm:text-4xl">How it works</h2>
          <ol className="mt-8 grid gap-5 md:grid-cols-3">
            {STEPS.map(({ icon: Icon, title, body }) => (
              <li key={title} className={`${cardClass} p-5`}>
                <Icon className="text-brand-deep" aria-hidden />
                <h3 className="mt-3 text-xl font-semibold">{title}</h3>
                <p className="mt-1.5 text-muted">{body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {articles.length > 0 && (
        <section className={pageClass}>
          <div className="flex items-end justify-between gap-4">
            <h2 className="text-3xl font-bold sm:text-4xl">Milk guides</h2>
            <a href="/articles" className="shrink-0 py-2 font-medium text-brand-deep underline">All guides</a>
          </div>
          <ul className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {articles.slice(0, 3).map((article) => (
              <ArticleCard key={article.id} article={article} />
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
