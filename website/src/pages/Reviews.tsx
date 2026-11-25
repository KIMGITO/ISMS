import { FormEvent, useEffect, useMemo, useState } from 'react';
import { BadgeCheck, MessageSquareReply, PenLine, Quote, Star } from 'lucide-react';
import { fetchMyReviews, friendlyError, MyReview, Review, submitReview } from '../api';
import { productPaths } from '../seo';
import { useAuth, useStorefront } from '../store';
import { ErrorText, formatDate, PageHeader, pageClass, Reveal } from '../ui';
import Breadcrumbs from './Breadcrumbs';

export function Stars({ rating, size = 16, className = '' }: { rating: number; size?: number; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-0.5 ${className}`} role="img" aria-label={`${rating.toFixed(1).replace(/\.0$/, '')} out of 5 stars`}>
      {[1, 2, 3, 4, 5].map((n) => {
        const fill = Math.max(0, Math.min(1, rating - n + 1));
        return (
          <span key={n} className="relative inline-block" style={{ width: size, height: size }}>
            <Star size={size} className="absolute inset-0 text-sand-deep" fill="currentColor" strokeWidth={0} aria-hidden />
            {fill > 0 && (
              <span className="absolute inset-0 overflow-hidden" style={{ width: `${fill * 100}%` }}>
                <Star size={size} className="text-star" fill="currentColor" strokeWidth={0} aria-hidden />
              </span>
            )}
          </span>
        );
      })}
    </span>
  );
}

export interface ReviewStats {
  count: number;
  average: number;
  /** Count of reviews for 5, 4, 3, 2 and 1 stars. */
  bars: [number, number][];
}

export function reviewStats(reviews: Review[]): ReviewStats {
  const count = reviews.length;
  const average = count ? reviews.reduce((sum, r) => sum + r.rating, 0) / count : 0;
  const bars = [5, 4, 3, 2, 1].map((star) => [star, reviews.filter((r) => r.rating === star).length] as [number, number]);
  return { count, average, bars };
}

/** "4.8 · 23 reviews", or nothing when there are none. */
export function RatingLine({ reviews, href, className = '' }: { reviews: Review[]; href?: string; className?: string }) {
  const { count, average } = reviewStats(reviews);
  if (!count) return null;
  const content = (
    <>
      <Stars rating={average} size={15} />
      <span className="font-semibold">{average.toFixed(1)}</span>
      <span className="text-muted">({count} {count === 1 ? 'review' : 'reviews'})</span>
    </>
  );
  return href
    ? <a href={href} className={`inline-flex items-center gap-1.5 text-sm hover:underline ${className}`}>{content}</a>
    : <span className={`inline-flex items-center gap-1.5 text-sm ${className}`}>{content}</span>;
}

export function ReviewSummary({ reviews, onFilter, active }: { reviews: Review[]; onFilter?: (star: number | null) => void; active?: number | null }) {
  const { count, average, bars } = reviewStats(reviews);
  return (
    <div className="card flex flex-col gap-6 p-5 sm:flex-row sm:items-center sm:p-6">
      <div className="shrink-0 text-center sm:w-40">
        <p className="text-5xl font-medium">{count ? average.toFixed(1) : '–'}</p>
        <Stars rating={average} size={18} className="mt-2" />
        <p className="mt-1 text-sm text-muted">{count} {count === 1 ? 'review' : 'reviews'}</p>
      </div>
      <ul className="flex-1 space-y-1.5">
        {bars.map(([star, n]) => {
          const share = count ? (n / count) * 100 : 0;
          const row = (
            <>
              <span className="w-12 shrink-0 text-sm font-medium">{star} star</span>
              <span className="h-2.5 flex-1 overflow-hidden rounded-full bg-sand">
                <span className="block h-full rounded-full bg-star" style={{ width: `${share}%` }} />
              </span>
              <span className="w-8 shrink-0 text-right text-sm text-muted">{n}</span>
            </>
          );
          return (
            <li key={star}>
              {onFilter ? (
                <button
                  onClick={() => onFilter(active === star ? null : star)}
                  aria-pressed={active === star}
                  disabled={!n}
                  className={`flex min-h-8 w-full items-center gap-3 rounded-md px-1 disabled:opacity-50 ${active === star ? 'bg-amber-50 ring-1 ring-sand-deep' : 'hover:bg-amber-50'}`}
                >
                  {row}
                </button>
              ) : (
                <div className="flex min-h-8 items-center gap-3 px-1">{row}</div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function ReviewCard({ review, showProduct = false }: { review: Review; showProduct?: boolean }) {
  const { products, business } = useStorefront();
  const product = review.productId ? products.find((p) => p.id === review.productId) : null;
  const href = product ? productPaths(products).get(product.id) : null;
  return (
    <article className="card flex h-full flex-col p-5">
      <div className="flex items-center justify-between gap-3">
        <Stars rating={review.rating} />
        <time className="text-sm text-muted" dateTime={review.createdAt}>{formatDate(review.createdAt)}</time>
      </div>
      {review.title && <h3 className="mt-3 font-semibold leading-snug">{review.title}</h3>}
      <p className="mt-2 whitespace-pre-line leading-relaxed text-ink/85">{review.body}</p>
      <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1 pt-4 text-sm">
        <span className="font-semibold">{review.name}</span>
        {review.verified && (
          <span className="inline-flex items-center gap-1 text-leaf"><BadgeCheck size={15} aria-hidden /> Verified buyer</span>
        )}
        {showProduct && (product && href
          ? <a href={href} className="text-muted underline hover:text-ink">{product.name}</a>
          : !review.productId && <span className="text-muted">Shop review</span>)}
      </div>
      {review.reply && (
        <div className="mt-4 rounded-lg bg-sand/70 p-3.5 text-sm">
          <p className="flex items-center gap-1.5 font-semibold"><MessageSquareReply size={15} aria-hidden /> Reply from {business.name}</p>
          <p className="mt-1 whitespace-pre-line leading-relaxed text-muted">{review.reply}</p>
        </div>
      )}
    </article>
  );
}

function StarPicker({ value, onChange }: { value: number; onChange: (value: number) => void }) {
  const labels = ['Poor', 'Fair', 'Good', 'Very good', 'Excellent'];
  return (
    <fieldset>
      <legend className="font-medium">Your rating</legend>
      <div className="mt-2 flex flex-wrap items-center gap-1">
        {[1, 2, 3, 4, 5].map((n) => (
          <label key={n} className="cursor-pointer rounded-md p-1 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-ember">
            <input type="radio" name="rating" value={n} checked={value === n} onChange={() => onChange(n)} className="sr-only" />
            <span className="sr-only">{n} {n === 1 ? 'star' : 'stars'}, {labels[n - 1]}</span>
            <Star size={30} strokeWidth={1.5} className={n <= value ? 'text-star' : 'text-sand-deep'} fill="currentColor" aria-hidden />
          </label>
        ))}
        {value > 0 && <span className="ml-2 font-medium text-muted">{labels[value - 1]}</span>}
      </div>
    </fieldset>
  );
}

/** Write or edit a review of one product, or of the shop when productId is null. */
export function ReviewForm({ productId, productName }: { productId: string | null; productName?: string }) {
  const account = useAuth((s) => s.account);
  const ready = useAuth((s) => s.ready);
  const [mine, setMine] = useState<MyReview | null>(null);
  const [open, setOpen] = useState(false);
  const [rating, setRating] = useState(0);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);

  useEffect(() => {
    if (!account) return;
    fetchMyReviews().then((reviews) => {
      const existing = reviews.find((r) => r.product_id === productId) ?? null;
      setMine(existing);
      if (existing) {
        setRating(existing.rating);
        setTitle(existing.title ?? '');
        setBody(existing.body);
      }
    });
  }, [account, productId]);

  if (!ready) return null;
  if (!account) {
    return (
      <div className="rounded-xl border border-dashed border-line p-5">
        <p className="font-semibold">Tried {productName ?? 'our shop'}?</p>
        <p className="mt-1 text-muted">Sign in to write a review.</p>
        <a href="/account" className="btn btn-secondary mt-4">Sign in to write a review</a>
      </div>
    );
  }
  if (sent) {
    return (
      <p role="status" className="rounded-xl bg-emerald-50 p-5 font-medium text-emerald-900">
        Thank you! It shows once we have checked it.
      </p>
    );
  }
  if (!open) {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <button onClick={() => setOpen(true)} className="btn btn-primary">
          <PenLine size={17} aria-hidden /> {mine ? 'Edit your review' : 'Write a review'}
        </button>
        {mine?.status === 'pending' && <span className="text-sm text-muted">Your review is waiting to be checked.</span>}
        {mine?.status === 'hidden' && <span className="text-sm text-muted">Your review isn't shown. You can edit and resend it.</span>}
      </div>
    );
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!rating) {
      setError('Please choose a star rating.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await submitReview(productId, rating, title, body);
      setSent(true);
    } catch (err) {
      setError(friendlyError(err, "We couldn't send your review. Please try again."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="card space-y-4 p-5">
      <h3 className="text-lg font-semibold">{productName ? `Review ${productName}` : 'Review our shop'}</h3>
      <StarPicker value={rating} onChange={setRating} />
      <label className="block font-medium">
        Headline <span className="font-normal text-muted">(optional)</span>
        <input maxLength={120} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="For example: Always fresh" className="field" />
      </label>
      <label className="block font-medium">
        Your review
        <textarea required minLength={3} maxLength={2000} rows={4} value={body} onChange={(e) => setBody(e.target.value)} placeholder="What did you like? How was delivery?" className="field" />
      </label>
      <p className="text-sm text-muted">We show your first name and initial.</p>
      <ErrorText>{error}</ErrorText>
      <div className="flex flex-wrap gap-3">
        <button type="submit" disabled={busy} className="btn btn-primary">{busy ? 'Sending…' : 'Send review'}</button>
        <button type="button" onClick={() => setOpen(false)} className="btn btn-secondary">Cancel</button>
      </div>
    </form>
  );
}

/** The reviews block on a product page. */
export function ProductReviews({ productId, productName }: { productId: string; productName: string }) {
  const { reviews = [] } = useStorefront();
  const mine = reviews.filter((r) => r.productId === productId);
  const [shown, setShown] = useState(6);
  return (
    <section id="reviews" className="mt-14 scroll-mt-36" aria-labelledby="reviews-heading">
      <h2 id="reviews-heading" className="display-md">Customer Reviews</h2>
      <div className="mt-5 grid gap-6 lg:grid-cols-[22rem_minmax(0,1fr)] lg:items-start">
        <div className="space-y-4 lg:sticky lg:top-36">
          <ReviewSummary reviews={mine} />
          <ReviewForm productId={productId} productName={productName} />
        </div>
        {mine.length > 0 ? (
          <div>
            <ul className="grid gap-4 md:grid-cols-2">
              {mine.slice(0, shown).map((r) => <li key={r.id}><ReviewCard review={r} /></li>)}
            </ul>
            {mine.length > shown && (
              <button onClick={() => setShown(shown + 6)} className="btn btn-secondary mt-5">Show more reviews</button>
            )}
          </div>
        ) : (
          <p className="rounded-xl border border-dashed border-line p-8 text-center text-muted">No reviews yet. Be the first to share what you think.</p>
        )}
      </div>
    </section>
  );
}

/** "What our customers say" on the home page. Shows nothing invented: with no reviews it invites the first. */
export function Testimonials({ title = 'What Customers Say', gap = 'pt-12 sm:pt-16' }: { title?: string; gap?: string } = {}) {
  const { reviews = [], business } = useStorefront();
  const picks = useMemo(
    () => [...reviews].filter((r) => r.rating >= 4 && r.body.length >= 20)
      .sort((a, b) => Number(b.featured) - Number(a.featured) || b.rating - a.rating)
      .slice(0, 6),
    [reviews],
  );
  const { count, average } = reviewStats(reviews);

  return (
    <section className={`site-gutter ${gap}`} aria-labelledby="testimonials-heading">
      <Reveal className="section-title">
        <h2 id="testimonials-heading" className="display-lg">{title}</h2>
        {count > 0 ? (
          <p className="mt-1.5 flex flex-wrap items-center justify-center gap-2 text-sm text-muted">
            <Stars rating={average} size={15} />
            <span><strong className="font-medium text-ink">{average.toFixed(1)} out of 5</strong> from {count} {count === 1 ? 'review' : 'reviews'}</span>
            <a href="/reviews" className="font-medium text-ember">See all</a>
          </p>
        ) : (
          <p className="mt-1.5 text-sm text-muted max-sm:hidden">Reviews from customers who order from us.</p>
        )}
      </Reveal>
      {picks.length > 0 ? (
        <ul className="no-scrollbar -mx-4 mt-6 flex snap-x gap-3 overflow-x-auto px-4 pb-2 sm:-mx-6 sm:mt-8 sm:gap-4 sm:px-6 lg:mx-0 lg:grid lg:grid-cols-3 lg:overflow-visible lg:px-0">
          {picks.map((review) => (
            <li key={review.id} className="w-[80vw] max-w-sm shrink-0 snap-start lg:w-auto lg:max-w-none">
              <figure className="flex h-full flex-col rounded-lg border border-line bg-white p-5 sm:p-6">
                <div className="flex items-center justify-between">
                  <Stars rating={review.rating} />
                  <Quote size={22} className="text-ember/30" aria-hidden />
                </div>
                <blockquote className="mt-3 flex-1 text-sm leading-relaxed sm:text-[0.9375rem]">
                  {review.title && <p className="font-medium">{review.title}</p>}
                  <p className="line-clamp-4 text-muted">{review.body}</p>
                </blockquote>
                <figcaption className="mt-5 flex items-center gap-3">
                  <span className="grid size-10 shrink-0 place-items-center rounded-full bg-tint-peach font-medium text-ember">{review.name.charAt(0)}</span>
                  <span className="text-sm">
                    <span className="block font-medium">{review.name}</span>
                    {review.verified && <span className="inline-flex items-center gap-1 text-leaf"><BadgeCheck size={14} aria-hidden /> Verified buyer</span>}
                  </span>
                </figcaption>
              </figure>
            </li>
          ))}
        </ul>
      ) : (
        <div className="mx-auto mt-6 max-w-xl rounded-lg border border-line bg-white p-6 text-center sm:mt-8 sm:p-8">
          <p className="font-medium">Ordered from {business.name}?</p>
          <p className="mt-1 text-sm text-muted">Your review helps other customers choose.</p>
          <a href="/reviews" className="btn btn-primary mt-4">Write a review</a>
        </div>
      )}
    </section>
  );
}

/** /reviews: every approved review, filters, and a form to review the shop. */
export function ReviewsPage() {
  const { reviews = [], business } = useStorefront();
  const [star, setStar] = useState<number | null>(null);
  const [kind, setKind] = useState<'all' | 'shop' | 'products'>('all');
  const [shown, setShown] = useState(12);
  const visible = reviews.filter((r) =>
    (star === null || r.rating === star) &&
    (kind === 'all' || (kind === 'shop' ? !r.productId : Boolean(r.productId))));

  return (
    <>
      <PageHeader eyebrow="Reviews" title="What Our Customers Say" body={`What ${business.name} customers say.`}>
        <Breadcrumbs items={[{ label: 'Home', href: '/' }, { label: 'Reviews' }]} />
      </PageHeader>
      <div className={`${pageClass} grid gap-8 lg:grid-cols-[22rem_minmax(0,1fr)] lg:items-start`}>
        <div className="space-y-4 lg:sticky lg:top-36">
          <ReviewSummary reviews={reviews} onFilter={setStar} active={star} />
          <ReviewForm productId={null} />
        </div>
        <div>
          <div className="flex flex-wrap items-center gap-2">
            {(['all', 'shop', 'products'] as const).map((k) => (
              <button key={k} onClick={() => setKind(k)} aria-pressed={kind === k} className="chip">
                {k === 'all' ? 'All reviews' : k === 'shop' ? 'About the shop' : 'About products'}
              </button>
            ))}
            {star !== null && <button onClick={() => setStar(null)} className="px-2 text-sm font-medium underline">Show all ratings</button>}
          </div>
          {visible.length > 0 ? (
            <>
              <ul className="mt-5 grid gap-4 md:grid-cols-2">
                {visible.slice(0, shown).map((r) => <li key={r.id}><ReviewCard review={r} showProduct /></li>)}
              </ul>
              {visible.length > shown && <button onClick={() => setShown(shown + 12)} className="btn btn-secondary mt-6">Show more reviews</button>}
            </>
          ) : (
            <p className="mt-5 rounded-xl border border-dashed border-line p-10 text-center text-muted">
              {reviews.length ? 'No reviews match that filter.' : 'No reviews yet. Yours could be the first.'}
            </p>
          )}
        </div>
      </div>
    </>
  );
}
