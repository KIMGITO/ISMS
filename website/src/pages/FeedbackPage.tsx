import { FormEvent, useEffect, useState } from 'react';
import { CheckCircle2, Star } from 'lucide-react';
import { FeedbackInput, friendlyError, submitFeedback } from '../api';
import { useAuth, useStorefront } from '../store';
import { PHOTOS } from '../images';
import { ErrorText, fieldClass, primaryButton, secondaryButton, PageHero } from '../ui';

const TYPES: { id: FeedbackInput['type']; label: string; prompt: string }[] = [
  { id: 'feedback', label: 'Feedback', prompt: 'How was your milk?' },
  { id: 'suggestion', label: 'Suggestion', prompt: 'What could we do better, or start doing?' },
  { id: 'complaint', label: 'Complaint', prompt: 'What went wrong?' },
];

export default function FeedbackPage() {
  const { products } = useStorefront();
  const account = useAuth((s) => s.account);
  const [type, setType] = useState<FeedbackInput['type']>('feedback');
  const [rating, setRating] = useState(0);
  const [productId, setProductId] = useState('');
  const [name, setName] = useState('');
  const [contact, setContact] = useState('');
  const [comment, setComment] = useState('');
  const [website, setWebsite] = useState(''); // Honeypot: hidden from people, filled in by bots.
  const [state, setState] = useState<'idle' | 'sending' | 'sent'>('idle');
  const [error, setError] = useState('');

  useEffect(() => {
    if (account) {
      setName((current) => current || account.name);
      setContact((current) => current || account.phone);
    }
  }, [account]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (type !== 'suggestion' && rating === 0) {
      setError('Please choose a star rating.');
      return;
    }
    setError('');
    if (website) {
      setState('sent');
      return;
    }
    setState('sending');
    try {
      await submitFeedback({
        name,
        contact,
        comment,
        type,
        rating: type === 'suggestion' ? null : rating,
        productId: productId || null,
      });
      setComment('');
      setRating(0);
      setProductId('');
      setState('sent');
    } catch (err) {
      setError(friendlyError(err, "We couldn't send your message. Please try again, or call us instead."));
      setState('idle');
    }
  };

  const current = TYPES.find((t) => t.id === type)!;

  return (
    <>
      <PageHero eyebrow="Feedback" title="Tell Us What You Think" body="Your feedback helps us look after your milk better." photo={PHOTOS.glassLight} />
      <div className="mx-auto w-full max-w-2xl px-4 pb-14 pt-4 sm:px-6">
      {state === 'sent' ? (
        <div role="status" className="mt-8 rounded-xl border border-line bg-white p-8 text-center">
          <CheckCircle2 size={40} className="mx-auto text-emerald-700" aria-hidden />
          <p className="mt-3 text-xl font-semibold">Thank you! We've received your message.</p>
          <button onClick={() => setState('idle')} className={`${secondaryButton} mt-5`}>Send another</button>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="mt-8 space-y-5">
          <div role="group" aria-label="Type of message" className="grid grid-cols-3 gap-2">
            {TYPES.map((option) => (
              <button
                key={option.id}
                type="button"
                aria-pressed={type === option.id}
                onClick={() => setType(option.id)}
                className={`min-h-11 rounded-lg border px-2 text-sm font-medium sm:text-base ${
                  type === option.id ? 'border-brand bg-amber-50' : 'border-line bg-white text-muted'
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>

          {type !== 'suggestion' && (
            <fieldset>
              <legend className="font-medium">Your rating</legend>
              <div className="mt-1 flex">
                {[1, 2, 3, 4, 5].map((value) => (
                  <button
                    key={value}
                    type="button"
                    aria-label={`${value} star${value > 1 ? 's' : ''}`}
                    aria-pressed={rating === value}
                    onClick={() => setRating(value)}
                    className="grid size-11 place-items-center"
                  >
                    <Star size={28} className={value <= rating ? 'fill-brand text-brand' : 'text-muted/50'} aria-hidden />
                  </button>
                ))}
              </div>
            </fieldset>
          )}

          {products.length > 0 && (
            <label className="block font-medium">
              Which product? <span className="font-normal text-muted">(optional)</span>
              <select value={productId} onChange={(e) => setProductId(e.target.value)} className={fieldClass}>
                <option value="">Not about one product</option>
                {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </label>
          )}

          <label className="block font-medium">
            {current.prompt}
            <textarea
              required
              rows={4}
              maxLength={2000}
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              className={fieldClass}
            />
          </label>
          <label className="block font-medium">
            Your name
            <input required maxLength={100} autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} className={fieldClass} />
          </label>
          <label className="block font-medium">
            Phone or email <span className="font-normal text-muted">(optional, if you'd like a reply)</span>
            <input maxLength={120} value={contact} onChange={(e) => setContact(e.target.value)} className={fieldClass} />
          </label>
          <label className="absolute -left-[9999px]" aria-hidden>
            Website
            <input tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} />
          </label>
          <ErrorText>{error}</ErrorText>
          <button type="submit" disabled={state === 'sending'} className={`${primaryButton} w-full sm:w-auto`}>
            {state === 'sending' ? 'Sending…' : 'Send'}
          </button>
        </form>
      )}
      </div>
    </>
  );
}
