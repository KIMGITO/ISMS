import { RichText } from '../RichText';
import { Article } from '../api';
import { articlePhoto, PHOTOS, photoUrl } from '../images';
import { useStorefront } from '../store';
import { DisplayText, formatDate, Notice, PageHero, pageClass, RevealList } from '../ui';
import Breadcrumbs from './Breadcrumbs';

export function ArticleCard({ article }: { article: Article }) {
  return (
    <li className="group overflow-hidden rounded-lg border border-line bg-white transition hover:border-ember/40 hover:shadow-soft">
      <a href={`/articles/${article.slug}`} className="flex h-full flex-col">
        <div className="aspect-[16/10] overflow-hidden bg-sand">
          <img
            src={article.coverImageUrl || photoUrl(articlePhoto(`${article.slug} ${article.title}`), 800, 600)}
            alt=""
            loading="lazy"
            className="size-full object-cover"
          />
        </div>
        <div className="p-4 sm:p-5">
          <p className="eyebrow">{article.category}</p>
          <h3 className="mt-1 text-[0.9375rem] font-medium leading-snug group-hover:text-ember sm:text-base"><DisplayText>{article.title}</DisplayText></h3>
          <p className="mt-1 line-clamp-2 text-sm text-muted">{article.summary}</p>
        </div>
      </a>
    </li>
  );
}

export default function ArticlesPage({ slug }: { slug?: string }) {
  const { articles } = useStorefront();

  if (slug) {
    const article = articles.find((a) => a.slug === slug);
    if (!article) {
      return (
        <Notice title="We can't find that guide" body="It may have been moved or removed.">
          <a href="/articles" className="mt-6 inline-block py-2 font-medium text-brand-deep underline">See all guides</a>
        </Notice>
      );
    }
    return (
      <article className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6 sm:py-12">
        <Breadcrumbs items={[{ label: 'Home', href: '/' }, { label: 'Milk guides', href: '/articles' }, { label: article.title }]} />
        <p className="eyebrow mt-4">{article.category}</p>
        <h1 className="display-lg mt-2"><DisplayText>{article.title}</DisplayText></h1>
        {article.publishedAt && <p className="mt-3 text-muted">{formatDate(article.publishedAt)}</p>}
        <img
          src={article.coverImageUrl || photoUrl(articlePhoto(`${article.slug} ${article.title}`), 1200, 700)}
          alt=""
          className="mt-6 aspect-[12/7] w-full rounded-xl bg-sand object-cover"
        />
        {article.summary && <p className="mt-6 text-xl leading-relaxed text-muted">{article.summary}</p>}
        <RichText body={article.body} className="mt-6 text-lg" />
      </article>
    );
  }

  return (
    <>
      <PageHero
        eyebrow="Milk care"
        title="Milk Guides"
        body="How to store, handle and enjoy your milk."
        photo={PHOTOS.bottleTray}
      >
        <Breadcrumbs items={[{ label: 'Home', href: '/' }, { label: 'Milk guides' }]} />
      </PageHero>
      <div className={pageClass}>
      {articles.length > 0 ? (
        <RevealList className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {articles.map((article) => <ArticleCard key={article.id} article={article} />)}
        </RevealList>
      ) : (
        <p className="mt-10 rounded-xl border border-dashed border-line p-10 text-center text-muted">
          Our first guides are coming soon.
        </p>
      )}
      </div>
    </>
  );
}
