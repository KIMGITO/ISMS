import { ReactNode } from 'react';
import { Article } from '../api';
import { articlePhoto, PHOTOS, photoUrl } from '../images';
import { useStorefront } from '../store';
import { cardClass, formatDate, Notice, PageHero, pageClass } from '../ui';
import Breadcrumbs from './Breadcrumbs';

export function ArticleCard({ article }: { article: Article }) {
  return (
    <li className={`${cardClass} card-lift overflow-hidden`}>
      <a href={`/articles/${article.slug}`} className="flex h-full flex-col">
        <div className="aspect-[4/3] overflow-hidden bg-sand">
          <img
            src={article.coverImageUrl || photoUrl(articlePhoto(`${article.slug} ${article.title}`), 800, 600)}
            alt=""
            loading="lazy"
            className="size-full object-cover"
          />
        </div>
        <div className="p-5">
          <p className="eyebrow">{article.category}</p>
          <h3 className="mt-2 font-display text-2xl leading-tight">{article.title}</h3>
          <p className="mt-2 line-clamp-3 text-muted">{article.summary}</p>
        </div>
      </a>
    </li>
  );
}

/** Renders ## headings, "- " lists and paragraphs as React nodes, so stored text can never inject HTML. */
function ArticleBody({ body }: { body: string }) {
  const blocks: ReactNode[] = [];
  let list: string[] = [];
  const flush = () => {
    if (list.length > 0) {
      blocks.push(
        <ul key={blocks.length} className="list-disc space-y-1.5 pl-6">
          {list.map((item, i) => <li key={i}>{item}</li>)}
        </ul>,
      );
      list = [];
    }
  };

  for (const raw of body.split('\n')) {
    const line = raw.trim();
    if (line.startsWith('- ')) {
      list.push(line.slice(2));
      continue;
    }
    flush();
    if (line.startsWith('## ')) {
      blocks.push(<h2 key={blocks.length} className="pt-3 text-2xl font-bold">{line.slice(3)}</h2>);
    } else if (line) {
      blocks.push(<p key={blocks.length}>{line}</p>);
    }
  }
  flush();
  return <div className="article-body mt-6 space-y-4 text-lg leading-relaxed">{blocks}</div>;
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
        <h1 className="display-lg mt-2">{article.title}</h1>
        {article.publishedAt && <p className="mt-3 text-muted">{formatDate(article.publishedAt)}</p>}
        <img
          src={article.coverImageUrl || photoUrl(articlePhoto(`${article.slug} ${article.title}`), 1200, 700)}
          alt=""
          className="mt-6 aspect-[12/7] w-full bg-sand object-cover"
        />
        {article.summary && <p className="mt-6 text-xl leading-relaxed text-muted">{article.summary}</p>}
        <ArticleBody body={article.body} />
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
        <ul className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {articles.map((article) => <ArticleCard key={article.id} article={article} />)}
        </ul>
      ) : (
        <p className="mt-10 rounded-xl border border-dashed border-line p-10 text-center text-muted">
          Our first guides are coming soon.
        </p>
      )}
      </div>
    </>
  );
}
