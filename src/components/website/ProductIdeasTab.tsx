// Online Store → Product ideas: what customers see on the website's "Vote & suggest" page.
// Staff add products that are coming, approve or hide customer suggestions, and mark ideas
// planned or available. Votes come only from customers (vote_product_idea); the database
// ignores any vote count written here.
import { FormEvent, useCallback, useEffect, useState } from 'react';
import { CheckCircle2, EyeOff, Lightbulb, PackageCheck, Plus, Sparkles, ThumbsUp, Trash2 } from 'lucide-react';
import SearchableDropdown from '../SearchableDropdown';
import { getSupabase } from '../../services/supabaseClient';
import { useAuthStore } from '../../stores/authStore';
import { useNotificationStore } from '../../stores/notificationStore';
import { toUserMessage } from '../../utils/userError';

type Status = 'pending' | 'open' | 'planned' | 'available' | 'hidden';

interface Idea {
  id: string;
  kind: 'upcoming' | 'suggestion';
  title: string;
  description: string | null;
  staff_note: string | null;
  status: Status;
  product_id: string | null;
  suggested_name: string | null;
  vote_count: number;
  created_at: string;
}

const FILTERS: { id: Status; label: string; empty: string }[] = [
  { id: 'pending', label: 'Waiting for approval', empty: 'No suggestions waiting. New ones from the website appear here.' },
  { id: 'open', label: 'Voting open', empty: 'Nothing open for voting. Add a product that is coming, or approve a suggestion.' },
  { id: 'planned', label: 'Planned', empty: 'Nothing planned yet.' },
  { id: 'available', label: 'In the shop', empty: 'No ideas marked as in the shop yet.' },
  { id: 'hidden', label: 'Hidden', empty: 'Nothing hidden.' },
];

const inputClass =
  'w-full rounded-lg border border-app-border bg-app-bg px-3 py-2 text-sm text-app-text outline-none focus:border-brand-500';
const primaryClass =
  'inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-brand-500 px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-brand-600 disabled:opacity-50';
const secondaryClass =
  'inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-app-border px-4 py-2 text-sm font-semibold text-app-text transition hover:bg-app-bg disabled:opacity-50';
const cardClass = 'rounded-xl border border-app-border bg-app-card p-4';

export default function ProductIdeasTab({ businessId }: { businessId: string }) {
  const showToast = useNotificationStore((s) => s.showToast);
  const staffName = useAuthStore((s) => s.currentEmployee?.name ?? 'Staff');
  const [filter, setFilter] = useState<Status>('pending');
  const [ideas, setIdeas] = useState<Idea[] | null>(null);
  const [loadError, setLoadError] = useState('');
  const [products, setProducts] = useState<{ id: string; label: string }[]>([]);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [linking, setLinking] = useState<Record<string, string>>({});
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [draft, setDraft] = useState({ title: '', description: '', note: '' });
  const [adding, setAdding] = useState(false);

  const report = useCallback(
    (err: unknown, fallback: string) => {
      console.error(err);
      showToast('Product ideas', toUserMessage(err, fallback), undefined, 'error');
    },
    [showToast],
  );

  const load = useCallback(async () => {
    const { data, error } = await getSupabase()
      .from('website_product_ideas')
      .select('id, kind, title, description, staff_note, status, product_id, suggested_name, vote_count, created_at')
      .eq('business_id', businessId)
      .eq('status', filter)
      .order('vote_count', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(300);
    if (error) throw error;
    setIdeas(data as Idea[]);
    setLoadError('');
  }, [businessId, filter]);

  useEffect(() => {
    setIdeas(null);
    load().catch((err) => {
      console.error(err);
      setIdeas([]);
      setLoadError(
        (err as { code?: string }).code === '42P01'
          ? 'Product ideas need the database update 20261114005_product_ideas.sql. Apply it, then reopen this tab.'
          : toUserMessage(err, 'Could not load product ideas. Check your connection and try again.'),
      );
    });
  }, [load]);

  useEffect(() => {
    getSupabase()
      .from('products')
      .select('id, name')
      .eq('business_id', businessId)
      .is('deleted_at', null)
      .eq('show_on_website', true)
      .order('name')
      .then(({ data }) => setProducts((data ?? []).map((p) => ({ id: p.id as string, label: p.name as string }))));
  }, [businessId]);

  const update = async (idea: Idea, fields: Partial<Idea>, done: string) => {
    setBusyId(idea.id);
    const { error } = await getSupabase().from('website_product_ideas').update(fields).eq('id', idea.id);
    setBusyId(null);
    if (error) {
      report(error, `Could not update "${idea.title}". Only owners and admins can change product ideas.`);
      return;
    }
    showToast('Product ideas', done, undefined, 'success');
    load().catch(() => undefined);
  };

  const remove = async (idea: Idea) => {
    setBusyId(idea.id);
    const { error } = await getSupabase().from('website_product_ideas').delete().eq('id', idea.id);
    setBusyId(null);
    setConfirmDelete(null);
    if (error) {
      report(error, `Could not delete "${idea.title}".`);
      return;
    }
    showToast('Product ideas', `"${idea.title}" deleted, with its votes.`, undefined, 'success');
    load().catch(() => undefined);
  };

  const addUpcoming = async (e: FormEvent) => {
    e.preventDefault();
    const title = draft.title.trim();
    if (title.length < 3 || title.length > 80) {
      showToast('Product ideas', 'Give the product a name of 3 to 80 characters.', undefined, 'error');
      return;
    }
    setAdding(true);
    const { error } = await getSupabase().from('website_product_ideas').insert({
      business_id: businessId,
      kind: 'upcoming',
      title,
      description: draft.description.trim() || null,
      staff_note: draft.note.trim() || null,
      status: 'open',
      created_by: staffName,
    });
    setAdding(false);
    if (error) {
      report(error, 'Could not add the product. Only owners and admins can add product ideas.');
      return;
    }
    setDraft({ title: '', description: '', note: '' });
    showToast('Product ideas', `"${title}" is on the website for customers to vote on.`, undefined, 'success');
    if (filter === 'open') load().catch(() => undefined);
    else setFilter('open');
  };

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_22rem] xl:items-start">
      <div className="space-y-4">
        <p className="text-sm text-app-text-muted">
          Customers vote and suggest products on the website's <strong>Vote &amp; suggest</strong> page. Suggestions wait here until you approve them.
        </p>
        <div className="flex flex-wrap gap-2">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              onClick={() => setFilter(f.id)}
              className={`min-h-10 rounded-full px-4 text-sm font-semibold ${filter === f.id ? 'bg-brand-500 text-slate-950' : 'border border-app-border text-app-text'}`}
            >
              {f.label}
            </button>
          ))}
        </div>
        {loadError ? (
          <p role="alert" className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-600">{loadError}</p>
        ) : !ideas ? (
          <p className="text-sm text-app-text-muted">Loading product ideas…</p>
        ) : ideas.length === 0 ? (
          <p className="py-8 text-center text-sm text-app-text-muted">{FILTERS.find((f) => f.id === filter)?.empty}</p>
        ) : (
          <ul className="grid gap-3 lg:grid-cols-2">
            {ideas.map((idea) => {
              const busy = busyId === idea.id;
              const note = notes[idea.id] ?? idea.staff_note ?? '';
              return (
                <li key={idea.id} className={cardClass}>
                  <div className="flex items-start gap-3">
                    <span className="flex w-14 shrink-0 flex-col items-center rounded-lg border border-app-border py-1.5 text-app-text" title="Customer votes">
                      <ThumbsUp size={16} aria-hidden />
                      <span className="text-base font-bold">{idea.vote_count}</span>
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold text-app-text">{idea.title}</p>
                      <p className="text-xs text-app-text-muted">
                        {idea.kind === 'upcoming' ? 'Added by staff' : `Suggested by ${idea.suggested_name ?? 'a customer'}`} ·{' '}
                        {new Date(idea.created_at).toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric' })}
                      </p>
                      {idea.description && <p className="mt-1 whitespace-pre-wrap break-words text-sm text-app-text">{idea.description}</p>}
                    </div>
                  </div>
                  <label className="mt-3 block text-xs font-medium text-app-text-muted">
                    Public note (optional)
                    <input
                      maxLength={300}
                      value={note}
                      onChange={(e) => setNotes({ ...notes, [idea.id]: e.target.value })}
                      placeholder="e.g. Coming in December"
                      className={`${inputClass} mt-1`}
                    />
                  </label>
                  {filter === 'planned' || filter === 'open' ? (
                    <div className="mt-3">
                      <p className="text-xs font-medium text-app-text-muted">Now in the shop? Link the product</p>
                      <SearchableDropdown
                        items={products}
                        selectedValue={linking[idea.id] ?? idea.product_id ?? ''}
                        onChange={(value) => setLinking({ ...linking, [idea.id]: value })}
                        placeholder="Choose the product"
                        searchPlaceholder="Search products"
                        className="mt-1"
                      />
                    </div>
                  ) : null}
                  <div className="mt-3 flex flex-wrap gap-2">
                    {idea.status === 'pending' && (
                      <button disabled={busy} className={primaryClass} onClick={() => update(idea, { status: 'open', staff_note: note.trim() || null }, `"${idea.title}" is on the website for voting.`)}>
                        <CheckCircle2 size={16} /> Approve for voting
                      </button>
                    )}
                    {(idea.status === 'open' || idea.status === 'pending') && (
                      <button disabled={busy} className={secondaryClass} onClick={() => update(idea, { status: 'planned', staff_note: note.trim() || null }, `"${idea.title}" marked as planned.`)}>
                        <Sparkles size={16} /> We'll make it
                      </button>
                    )}
                    {(idea.status === 'open' || idea.status === 'planned') && linking[idea.id] && (
                      <button
                        disabled={busy}
                        className={primaryClass}
                        onClick={() => update(idea, { status: 'available', product_id: linking[idea.id], staff_note: note.trim() || null }, `"${idea.title}" now links to the product in the shop.`)}
                      >
                        <PackageCheck size={16} /> Mark as in the shop
                      </button>
                    )}
                    {idea.status === 'hidden' && (
                      <button disabled={busy} className={secondaryClass} onClick={() => update(idea, { status: 'open' }, `"${idea.title}" is back on the website.`)}>
                        Show again
                      </button>
                    )}
                    {idea.status !== 'hidden' && (
                      <button disabled={busy} className={secondaryClass} onClick={() => update(idea, { status: 'hidden' }, `"${idea.title}" hidden from the website.`)}>
                        <EyeOff size={16} /> Hide
                      </button>
                    )}
                    {notes[idea.id] !== undefined && notes[idea.id] !== (idea.staff_note ?? '') && (
                      <button disabled={busy} className={secondaryClass} onClick={() => update(idea, { staff_note: notes[idea.id].trim() || null }, 'Note saved.')}>
                        Save note
                      </button>
                    )}
                    {confirmDelete === idea.id ? (
                      <span className="flex flex-wrap items-center gap-2 text-sm text-app-text">
                        Delete it and its {idea.vote_count} {idea.vote_count === 1 ? 'vote' : 'votes'}?
                        <button disabled={busy} className="inline-flex min-h-10 items-center rounded-lg bg-red-600 px-3 text-sm font-semibold text-white" onClick={() => remove(idea)}>Delete</button>
                        <button className={secondaryClass} onClick={() => setConfirmDelete(null)}>Keep</button>
                      </span>
                    ) : (
                      <button disabled={busy} aria-label={`Delete ${idea.title}`} className={secondaryClass} onClick={() => setConfirmDelete(idea.id)}>
                        <Trash2 size={16} />
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <form onSubmit={addUpcoming} className={`${cardClass} space-y-3 xl:sticky xl:top-4`}>
        <h2 className="flex items-center gap-2 font-semibold text-app-text"><Lightbulb size={18} className="text-brand-500" /> Add a product that is coming</h2>
        <p className="text-xs text-app-text-muted">It goes straight onto the website so customers can vote for it.</p>
        <label className="block text-xs font-medium text-app-text-muted">
          Product name
          <input required maxLength={80} value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} placeholder="e.g. Goat milk 1L" className={`${inputClass} mt-1`} />
        </label>
        <label className="block text-xs font-medium text-app-text-muted">
          Details (optional)
          <textarea rows={3} maxLength={500} value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} className={`${inputClass} mt-1`} />
        </label>
        <label className="block text-xs font-medium text-app-text-muted">
          Public note (optional)
          <input maxLength={300} value={draft.note} onChange={(e) => setDraft({ ...draft, note: e.target.value })} placeholder="e.g. Coming in December" className={`${inputClass} mt-1`} />
        </label>
        <button type="submit" disabled={adding} className={`${primaryClass} w-full`}><Plus size={16} /> {adding ? 'Adding…' : 'Add for voting'}</button>
      </form>
    </div>
  );
}
