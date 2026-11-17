import { Clock, HelpCircle, Mail, MapPin, MessageCircle, Phone } from 'lucide-react';
import { FormEvent, useState } from 'react';
import { friendlyError, sendMessage, submitFeedback } from '../api';
import { useAuth, useStorefront } from '../store';
import { ErrorText } from '../ui';
import { BANNER_IMAGES, PageHeader, pageClass } from '../ui';
import Breadcrumbs from './Breadcrumbs';

function ContactTile({ icon: Icon, title, body, href, external = false }: {
  icon: typeof Phone;
  title: string;
  body: string;
  href?: string;
  external?: boolean;
}) {
  const inner = (
    <>
      <Icon size={26} strokeWidth={1.5} className="shrink-0 text-ember" aria-hidden />
      <span className="min-w-0">
        <span className="block text-sm font-medium">{title}</span>
        <span className="mt-0.5 block whitespace-pre-line break-words text-sm text-muted">{body}</span>
      </span>
    </>
  );
  const box = 'flex h-full items-center gap-3 rounded-lg border border-line bg-white p-4 sm:px-5';
  return (
    <li>
      {href ? (
        <a href={href} {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})} className={`${box} transition hover:border-ember/50`}>{inner}</a>
      ) : (
        <div className={box}>{inner}</div>
      )}
    </li>
  );
}

const mapUrl = (address: string) =>
  `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;

/**
 * Signed-in customers' messages go to Online Store > Messages, where staff reply in the account.
 * Guests' messages go to Online Store > Feedback as a suggestion, with the contact they give.
 */
function ContactForm() {
  const account = useAuth((s) => s.account);
  const [name, setName] = useState('');
  const [contact, setContact] = useState('');
  const [topic, setTopic] = useState('An order');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const text = `${topic}: ${message.trim()}`;
      if (account) await sendMessage(text);
      else await submitFeedback({ name, contact, rating: null, comment: `[Contact form] ${text}`, type: 'suggestion', productId: null });
      setSent(true);
    } catch (err) {
      setError(friendlyError(err, "We couldn't send your message. Please try again or call us."));
    } finally {
      setBusy(false);
    }
  };

  if (sent) {
    return (
      <div role="status" className="card p-6">
        <p className="text-lg font-semibold">Thank you, we've got your message.</p>
        <p className="mt-1 text-muted">
          {account
            ? <>We'll reply in <a href="/account/messages" className="font-medium text-ink underline">your messages</a>.</>
            : 'We will get back to you on the phone number or email you gave.'}
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="card space-y-4 p-5 sm:p-6">
      <h2 className="display-md">Send us a message</h2>
      {account ? (
        <p className="text-muted">Signed in as {account.name}. We reply in your account messages.</p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block font-medium">Your name<input required maxLength={100} value={name} onChange={(e) => setName(e.target.value)} className="field" /></label>
          <label className="block font-medium">Phone or email<input required maxLength={120} value={contact} onChange={(e) => setContact(e.target.value)} className="field" /></label>
        </div>
      )}
      <label className="block font-medium">
        About
        <select value={topic} onChange={(e) => setTopic(e.target.value)} className="field">
          {['An order', 'Delivery', 'Payment', 'A product', 'Regular orders', 'Something else'].map((t) => <option key={t}>{t}</option>)}
        </select>
      </label>
      <label className="block font-medium">
        Message
        <textarea required minLength={3} maxLength={1800} rows={5} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Include your order number if it's about an order." className="field" />
      </label>
      <ErrorText>{error}</ErrorText>
      <button type="submit" disabled={busy} className="btn btn-primary w-full sm:w-auto">{busy ? 'Sending…' : 'Send message'}</button>
    </form>
  );
}

export default function ContactPage() {
  const { business, branches, settings } = useStorefront();
  const whatsapp = settings.whatsapp || business.contactPhone;
  const { address, contactEmail, contactPhone, name } = business;
  const locations = branches.some((b) => b.address) ? branches.filter((b) => b.address) : address ? [{ name, address }] : [];

  return (
    <>
      <PageHeader eyebrow="Contact" title="Find Us" body="Visit us, call, or send a message." images={BANNER_IMAGES.bottle}>
        <Breadcrumbs items={[{ label: 'Home', href: '/' }, { label: 'Contact' }]} />
      </PageHeader>
      <div className={pageClass}>
      {/* Every way to reach us as a tile, in the same bordered boxes as the home page's trust strip. */}
      <ul className="grid gap-2.5 sm:grid-cols-2 sm:gap-4 lg:grid-cols-3">
        {locations.map((location) => (
          <li key={location.name} className="soft-panel rounded-xl p-4 sm:col-span-2 sm:p-5 lg:col-span-1 lg:row-span-2">
            <span className="grid size-11 place-items-center rounded-full bg-white text-ember shadow-soft"><MapPin size={20} aria-hidden /></span>
            <h2 className="mt-3 text-lg font-semibold">{location.name}</h2>
            <p className="mt-1 text-muted">{location.address}</p>
            <a href={mapUrl(location.address!)} target="_blank" rel="noopener noreferrer" className="btn btn-primary mt-4">
              Open in Google Maps
            </a>
          </li>
        ))}
        {settings.openingHours && <ContactTile icon={Clock} title="Opening hours" body={settings.openingHours} />}
        {contactPhone && <ContactTile icon={Phone} title="Call us" body={contactPhone} href={`tel:${contactPhone.replace(/\s/g, '')}`} />}
        {whatsapp && (
          <ContactTile icon={MessageCircle} title="WhatsApp" body="Message us any time" href={`https://wa.me/${whatsapp.replace(/\D/g, '').replace(/^0/, '254')}`} external />
        )}
        {contactEmail && <ContactTile icon={Mail} title="Email" body={contactEmail} href={`mailto:${contactEmail}`} />}
        <ContactTile icon={MessageCircle} title="Your account" body="Send us a message and read our reply" href="/account/messages" />
        <ContactTile icon={HelpCircle} title="Help centre" body="Answers to common questions" href="/help" />
      </ul>
      {settings.assistantEnabled && (
        <p className="mt-4 text-sm text-muted">For a quick answer about stock or prices, use the <strong>Ask us</strong> assistant at the bottom of any page.</p>
      )}
      <div className="mt-10 max-w-3xl sm:mt-12"><ContactForm /></div>
      </div>
    </>
  );
}
