import { useEffect, useState } from 'react';
import { friendlyError, supabase } from '../api';
import { ErrorText } from '../ui';

interface Choices {
  service: boolean;
  promotions: boolean;
}

/** What the shop may message this customer about. Saves as soon as a box changes. */
export default function ContactPreferences() {
  const [choices, setChoices] = useState<Choices | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    supabase.rpc('get_my_contact_preferences').then(({ data, error: loadError }) => {
      if (loadError) setError(friendlyError(loadError));
      else setChoices(data as Choices);
    });
  }, []);

  const change = async (next: Choices) => {
    const previous = choices;
    setChoices(next);
    setError('');
    const { error: saveError } = await supabase.rpc('update_my_contact_preferences', {
      p_service: next.service,
      p_promotions: next.promotions,
    });
    if (saveError) {
      setChoices(previous);
      setError(friendlyError(saveError));
    }
  };

  return (
    <section className="mt-8 border-t border-line pt-6">
      <h2 className="text-xl font-bold">Messages from us</h2>
      {choices && (
        <div className="mt-3 space-y-3">
          <label className="flex min-h-11 items-start gap-3">
            <input
              type="checkbox"
              checked={choices.service}
              onChange={(e) => change({ ...choices, service: e.target.checked })}
              className="mt-1 h-5 w-5 shrink-0"
            />
            <span>
              <span className="block font-medium">Order updates and reminders</span>
              <span className="text-muted">If you turn this off, you can still follow orders on your Orders page.</span>
            </span>
          </label>
          <label className="flex min-h-11 items-start gap-3">
            <input
              type="checkbox"
              checked={choices.promotions}
              onChange={(e) => change({ ...choices, promotions: e.target.checked })}
              className="mt-1 h-5 w-5 shrink-0"
            />
            <span>
              <span className="block font-medium">Offers and news</span>
              <span className="text-muted">Occasional offers on our milk and products.</span>
            </span>
          </label>
        </div>
      )}
      <ErrorText>{error}</ErrorText>
    </section>
  );
}
