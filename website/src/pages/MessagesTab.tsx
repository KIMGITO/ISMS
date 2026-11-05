import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { Send } from 'lucide-react';
import { fetchMessages, friendlyError, markMessagesRead, Message, sendMessage } from '../api';
import { useStorefront } from '../store';
import { ErrorText, formatDateTime, Loading, primaryButton } from '../ui';

export default function MessagesTab({ onRead }: { onRead: () => void }) {
  const { business } = useStorefront();
  const [messages, setMessages] = useState<Message[] | null>(null);
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const endRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    const data = await fetchMessages();
    setMessages(data);
    if (data.some((m) => m.sender !== 'customer' && !m.read_at)) {
      await markMessagesRead();
      onRead();
    }
  }, [onRead]);

  useEffect(() => {
    load().catch((err) => setError(friendlyError(err)));
    const timer = setInterval(() => load().catch(() => undefined), 15000);
    return () => clearInterval(timer);
  }, [load]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'nearest' });
  }, [messages?.length]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await sendMessage(body);
      setBody('');
      await load();
    } catch (err) {
      setError(friendlyError(err, "We couldn't send your message. Please try again."));
    } finally {
      setBusy(false);
    }
  };

  if (!messages) return error ? <ErrorText>{error}</ErrorText> : <Loading />;

  return (
    <div className="max-w-2xl">
      <div aria-live="polite" className="max-h-[55dvh] space-y-3 overflow-y-auto rounded-xl border border-line bg-white p-4">
        {messages.length === 0 && (
          <p className="py-8 text-center text-muted">Send us a message and our team will reply here.</p>
        )}
        {messages.map((message) => {
          const mine = message.sender === 'customer';
          return (
            <div key={message.id} className={mine ? 'flex flex-col items-end' : 'flex flex-col items-start'}>
              <div className={`max-w-[85%] rounded-2xl px-4 py-2.5 ${mine ? 'bg-brand text-on-brand' : 'bg-amber-50'}`}>
                <p className="whitespace-pre-wrap break-words">{message.body}</p>
              </div>
              <p className="mt-1 text-xs text-muted">
                {mine ? 'You' : message.sender === 'system' ? business.name : message.staff_name || business.name} · {formatDateTime(message.created_at)}
              </p>
            </div>
          );
        })}
        <div ref={endRef} />
      </div>
      <form onSubmit={handleSubmit} className="mt-3 flex gap-2">
        <label className="min-w-0 flex-1">
          <span className="sr-only">Your message</span>
          <textarea
            required
            rows={2}
            maxLength={1000}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Write your message"
            className="w-full rounded-lg border border-line bg-white px-3.5 py-2.5 text-base"
          />
        </label>
        <button type="submit" disabled={busy} aria-label="Send message" className={`${primaryButton} self-stretch`}>
          <Send size={18} aria-hidden />
        </button>
      </form>
      <div className="mt-2"><ErrorText>{error}</ErrorText></div>
    </div>
  );
}
