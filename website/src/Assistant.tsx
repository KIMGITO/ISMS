import { FormEvent, useEffect, useRef, useState } from 'react';
import { Check, MessageCircleQuestion, Send, ShoppingCart, X } from 'lucide-react';
import { askAssistant, AssistantReply, friendlyError } from './api';
import { useCart, useStorefront } from './store';
import { formatPrice, primaryButton } from './ui';

interface ChatMessage {
  id: number;
  from: 'customer' | 'assistant';
  text: string;
  reply?: AssistantReply;
}

const SUGGESTIONS = ['Do you have milk?', 'How do I store milk?', 'Do you deliver?'];

export default function Assistant() {
  const { business } = useStorefront();
  const add = useCart((s) => s.add);
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [pendingProductId, setPendingProductId] = useState<string | null>(null);
  const [added, setAdded] = useState<number[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 0,
      from: 'assistant',
      text: "Hello! I can check what we have, work out the cost of your order, and help you look after your milk. What would you like?",
    },
  ]);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages, busy, open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const ask = async (text: string) => {
    const question = text.trim();
    if (!question || busy) return;
    setInput('');
    setBusy(true);
    setMessages((m) => [...m, { id: m.length, from: 'customer', text: question }]);
    try {
      const reply = await askAssistant(question, pendingProductId);
      setPendingProductId(reply.pendingProductId ?? null);
      setMessages((m) => [...m, { id: m.length, from: 'assistant', text: reply.reply, reply }]);
    } catch (err) {
      const text = friendlyError(err, "Sorry, I'm having trouble right now. Please try again.");
      setMessages((m) => [...m, { id: m.length, from: 'assistant', text }]);
    } finally {
      setBusy(false);
    }
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    ask(input);
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        aria-label="Ask us"
        className="fixed bottom-[calc(1rem+env(safe-area-inset-bottom))] right-4 z-30 flex min-h-12 min-w-12 items-center justify-center gap-2 rounded-full bg-brand-deep font-semibold text-white shadow-lg transition hover:brightness-110 md:bottom-6 md:right-6 md:px-4"
      >
        <MessageCircleQuestion size={21} aria-hidden />
        <span className="hidden md:inline">Ask us</span>
      </button>
    );
  }

  return (
    <section
      aria-label="Shop assistant"
      className="assistant-enter fixed inset-0 z-40 flex flex-col bg-white pb-[env(safe-area-inset-bottom)] pt-[env(safe-area-inset-top)] sm:inset-auto sm:bottom-6 sm:right-6 sm:h-[min(36rem,calc(100dvh-3rem))] sm:w-96 sm:overflow-hidden sm:rounded-2xl sm:border sm:border-line sm:shadow-2xl"
    >
      <header className="flex items-center justify-between gap-3 bg-brand-deep px-4 py-3 text-white">
        <div className="min-w-0">
          <h2 className="truncate text-lg font-semibold">{business.name} assistant</h2>
          <p className="text-sm text-white/80">Products, orders and milk care</p>
        </div>
        <button onClick={() => setOpen(false)} aria-label="Close assistant" className="grid size-11 shrink-0 place-items-center">
          <X aria-hidden />
        </button>
      </header>

      <div ref={listRef} aria-live="polite" className="flex-1 space-y-3 overflow-y-auto p-4">
        {messages.map((message) => (
          <div key={message.id} className={message.from === 'customer' ? 'flex justify-end' : ''}>
            <div
              className={`max-w-[85%] rounded-2xl px-4 py-2.5 ${
                message.from === 'customer' ? 'bg-brand text-on-brand' : 'bg-amber-50 text-ink'
              }`}
            >
              <p className="break-words">{message.text}</p>
              {message.reply?.addToCart && (
                <button
                  disabled={added.includes(message.id)}
                  onClick={() => {
                    const { productId, quantity } = message.reply!.addToCart!;
                    add(productId, quantity);
                    setAdded((a) => [...a, message.id]);
                  }}
                  className={`${primaryButton} mt-2 w-full`}
                >
                  {added.includes(message.id) ? <Check size={18} aria-hidden /> : <ShoppingCart size={18} aria-hidden />}
                  {added.includes(message.id)
                    ? 'Added to cart'
                    : `Add to cart · ${formatPrice(business.currency, message.reply.addToCart.total)}`}
                </button>
              )}
              {message.reply?.link && (
                <a
                  href={message.reply.link.href}
                  onClick={() => setOpen(false)}
                  className="mt-1 inline-block py-1.5 font-medium text-brand-deep underline"
                >
                  {message.reply.link.label}
                </a>
              )}
            </div>
          </div>
        ))}
        {busy && <p className="text-muted">Checking…</p>}
        {messages.length === 1 && (
          <div className="flex flex-wrap gap-2">
            {SUGGESTIONS.map((suggestion) => (
              <button
                key={suggestion}
                onClick={() => ask(suggestion)}
                className="min-h-11 rounded-full border border-line px-3.5 text-sm font-medium hover:border-brand-deep"
              >
                {suggestion}
              </button>
            ))}
          </div>
        )}
      </div>

      <form onSubmit={handleSubmit} className="flex gap-2 border-t border-line p-3">
        <label className="min-w-0 flex-1">
          <span className="sr-only">Your question</span>
          <input
            value={input}
            maxLength={500}
            onChange={(e) => setInput(e.target.value)}
            placeholder={pendingProductId ? 'How much would you like?' : 'Ask about our products'}
            className="min-h-11 w-full rounded-lg border border-line px-3 text-base"
          />
        </label>
        <button type="submit" disabled={busy || !input.trim()} aria-label="Send" className={`${primaryButton} px-3.5`}>
          <Send size={18} aria-hidden />
        </button>
      </form>
    </section>
  );
}
