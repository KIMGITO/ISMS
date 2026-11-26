import { FormEvent, useCallback, useEffect, useState } from 'react';
import { CheckCircle2, Clock, Hammer, Lightbulb, PackageCheck, ThumbsUp } from 'lucide-react';
import { fetchProductIdeas, friendlyError, ProductIdea, suggestProductIdea, voteProductIdea } from '../api';
import { productPaths } from '../seo';
import { useAuth, useStorefront } from '../store';
import { ErrorText, fieldClass, PageHeader, pageClass, primaryButton } from '../ui';
import Breadcrumbs from './Breadcrumbs';

type Filter = 'all' | 'upcoming' | 'suggestion' | 'available';

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'Everything' },
  { id: 'upcoming', label: 'Coming soon' },
  { id: 'suggestion', label: 'Customer ideas' },
  { id: 'available', label: 'Now in the shop' },
];

const STATUS: Record<ProductIdea['status'], { label: string; className: string; icon: typeof Clock }> = {
  pending: { label: 'Waiting for our team', className: 'bg-stone-100 text-stone-700', icon: Clock },
  open: { label: 'Voting open', className: 'bg-amber-100 text-amber-900', icon: ThumbsUp },
  planned: { label: 'We are making it', className: 'bg-sky-100 text-sky-900', icon: Hammer },
  available: { label: 'Now in the shop', className: 'bg-emerald-100 text-emerald-900', icon: PackageCheck },
};

function SuggestForm({ onDone }: { onDone: () => Promise<void> }) {
  const account = useAuth((s) => s.account);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState('');

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setSent('');
    if (title.trim().length < 3) {
      setError('Please name the product you would like, in at least 3 letters.');
      return;
    }
    setBusy(true);
    try {
      await suggestProductIdea(title, description);
      setSent(`Thanks! We'll check "${title.trim()}", then others can vote for it.`);
      setTitle('');
      setDescription('');
      await onDone();
    } catch (err) {
      setError(friendlyError(err, "We couldn't send your suggestion. Please try again."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-labelledby="suggest-heading" className="card p-5 sm:p-6">
      <h2 id="suggest-heading" className="flex items-center gap-2 text-lg font-medium">
        <Lightbulb size={20} className="text-ember" aria-hidden /> Suggest a product
      </h2>
      <p className="mt-1 text-sm text-muted">Tell us what you wish we sold.</p>
      {!account ? (
        <div className="mt-4 rounded-lg bg-shell p-4 text-sm">
          <p>Sign in to suggest products and vote.</p>
          <a href="/account" className={`${primaryButton} mt-3 w-full`}>Sign in or create an account</a>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="mt-4 space-y-3">
          <label className="block text-sm font-medium">
            Product name
            <input
              required
              maxLength={80}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Brown bread 400 g"
              className={fieldClass}
            />
          </label>
          <label className="block text-sm font-medium">
            Details <span className="font-normal text-muted">(optional)</span>
            <textarea
              rows={3}
              maxLength={500}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Size, flavour, how often you would buy it…"
              className={fieldClass}
            />
          </label>
          <ErrorText>{error}</ErrorText>
          {sent && (
            <p role="status" className="flex gap-2 rounded-lg bg-emerald-50 px-3.5 py-2.5 text-sm text-emerald-900">
              <CheckCircle2 size={18} className="shrink-0" aria-hidden /> {sent}
            </p>
          )}
          <button type="submit" disabled={busy} className={`${primaryButton} w-full`}>{busy ? 'Sending…' : 'Send suggestion'}</button>
        </form>
      )}
    </section>
  );
}

function IdeaCard({ idea, onVoted }: { idea: ProductIdea; onVoted: (idea: ProductIdea) => void }) {
  const account = useAuth((s) => s.account);
  const { products } = useStorefront();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const status = STATUS[idea.status];
  const StatusIcon = status.icon;
  const productHref = idea.productId ? productPaths(products).get(idea.productId) : undefined;
  const canVote = idea.status === 'open' || idea.status === 'planned';

  const toggleVote = async () => {
    setError('');
    if (!account) {
      setError('Please sign in to vote. Each customer gets one vote per idea.');
      return;
    }
    setBusy(true);
    try {
      const result = await voteProductIdea(idea.id, !idea.voted);
      onVoted({ ...idea, votes: result.votes, voted: result.voted });
    } catch (err) {
      setError(friendlyError(err, "Your vote didn't go through. Please try again."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <article className="flex h-full gap-4 rounded-lg border border-line bg-white p-4 sm:p-5">
      <div className="flex shrink-0 flex-col items-center">
        {canVote ? (
          <button
            type="button"
            onClick={toggleVote}
            disabled={busy}
            aria-pressed={idea.voted}
            aria-label={`${idea.voted ? 'Take back your vote for' : 'Vote for'} ${idea.title}. ${idea.votes} ${idea.votes === 1 ? 'vote' : 'votes'}.`}
            className={`flex w-16 flex-col items-center gap-0.5 rounded-lg border py-2 transition disabled:opacity-60 ${
              idea.voted ? 'border-ember bg-ember text-white' : 'border-line bg-white text-ink hover:border-ember hover:text-ember'
            }`}
          >
            <ThumbsUp size={18} fill={idea.voted ? 'currentColor' : 'none'} aria-hidden />
            <span className="text-base font-semibold leading-none">{idea.votes}</span>
            <span className="text-[0.6875rem] leading-none">{idea.voted ? 'Voted' : 'Vote'}</span>
          </button>
        ) : (
          <span className="flex w-16 flex-col items-center gap-0.5 rounded-lg border border-line bg-shell py-2 text-muted">
            <ThumbsUp size={18} aria-hidden />
            <span className="text-base font-semibold leading-none text-ink">{idea.votes}</span>
            <span className="text-[0.6875rem] leading-none">{idea.votes === 1 ? 'vote' : 'votes'}</span>
          </span>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ${status.className}`}>
            <StatusIcon size={12} aria-hidden /> {status.label}
          </span>
          <span className="text-xs text-muted">{idea.kind === 'upcoming' ? 'From our team' : `Suggested by ${idea.mine ? 'you' : idea.suggestedBy ?? 'a customer'}`}</span>
        </div>
        <h3 className="mt-2 font-medium leading-snug first-letter:uppercase">{idea.title}</h3>
        {idea.description && <p className="mt-1 whitespace-pre-wrap break-words text-sm text-muted">{idea.description}</p>}
        {idea.staffNote && (
          <p className="mt-2 rounded-md bg-shell px-3 py-2 text-sm"><span className="font-medium">Our team: </span>{idea.staffNote}</p>
        )}
        {idea.status === 'available' && productHref && (
          <a href={productHref} className="mt-3 inline-block text-sm font-medium text-ember underline">See it in the shop</a>
        )}
        {idea.status === 'pending' && (
          <p className="mt-2 text-xs text-muted">Only you see this until we approve it.</p>
        )}
        {error && <div className="mt-3"><ErrorText>{error}</ErrorText></div>}
      </div>
      {idea.imageUrl && (
        <img src={idea.imageUrl} alt="" loading="lazy" className="hidden size-20 shrink-0 rounded-md object-cover sm:block" />
      )}
    </article>
  );
}

/** /ideas: vote for products that are coming, and suggest new ones. */
export default function IdeasPage() {
  const { business } = useStorefront();
  const session = useAuth((s) => s.session);
  const [ideas, setIdeas] = useState<ProductIdea[] | null | undefined>(undefined);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState<Filter>('all');

  const load = useCallback(async () => {
    try {
      setIdeas(await fetchProductIdeas());
      setError('');
    } catch (err) {
      setError(friendlyError(err, "We couldn't load the ideas. Please refresh the page."));
      setIdeas([]);
    }
  }, []);

  // Reload when someone signs in or out, so "Voted" and their own suggestions are right.
  useEffect(() => {
    void load();
  }, [load, session?.user.id]);

  const visible = (ideas ?? []).filter((idea) =>
    filter === 'all' ? idea.status !== 'available'
      : filter === 'available' ? idea.status === 'available'
        : idea.kind === filter && idea.status !== 'available');

  return (
    <>
      <PageHeader
        eyebrow="Your say"
        title="Vote & Suggest Products"
        body={`Vote for what ${business.name} makes next.`}
      >
        <Breadcrumbs items={[{ label: 'Home', href: '/' }, { label: 'Vote & suggest' }]} />
      </PageHeader>
      <div className={`${pageClass} grid gap-8 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start`}>
        <div>
          <div className="pill-row gap-2" role="group" aria-label="Show">
            {FILTERS.map((f) => (
              <button key={f.id} onClick={() => setFilter(f.id)} aria-pressed={filter === f.id} className="chip">{f.label}</button>
            ))}
          </div>
          {error && <div className="mt-5"><ErrorText>{error}</ErrorText></div>}
          {ideas === undefined ? (
            <p role="status" className="mt-5 text-muted">Loading ideas…</p>
          ) : ideas === null ? (
            <p className="mt-5 rounded-xl border border-dashed border-line p-10 text-center text-muted">
              Voting opens soon. Please check back in a few days.
            </p>
          ) : visible.length > 0 ? (
            <ul className="mt-5 grid gap-3 md:grid-cols-2">
              {visible.map((idea) => (
                <li key={idea.id}>
                  <IdeaCard idea={idea} onVoted={(next) => setIdeas((list) => list?.map((i) => (i.id === next.id ? next : i)))} />
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-5 rounded-xl border border-dashed border-line p-10 text-center text-muted">
              {filter === 'available'
                ? 'Nothing here yet.'
                : 'No ideas here yet. Be the first to suggest a product.'}
            </p>
          )}
        </div>
        <div className="lg:sticky lg:top-36">
          {ideas !== null && <SuggestForm onDone={load} />}
        </div>
      </div>
    </>
  );
}
