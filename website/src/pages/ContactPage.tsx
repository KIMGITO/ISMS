import { Clock, HelpCircle, Mail, MapPin, MessageCircle, Phone } from 'lucide-react';
import { FormEvent, useState } from 'react';
import { friendlyError, sendMessage, submitFeedback } from '../api';
import { useAuth, useStorefront } from '../store';
import { ErrorText } from '../ui';
import { PHOTOS } from '../images';
import { PageHero, pageClass } from '../ui';

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
      <PageHero eyebrow="Contact" title="Find Us" body="Visit us, call, or send a message." photo={PHOTOS.pasture} />
      <div className={pageClass}>
      <div className="mt-8 grid gap-10 md:grid-cols-2">
        {locations.length > 0 && (
          <ul className="space-y-6">
            {locations.map((location) => (
              <li key={location.name} className="flex gap-3">
                <MapPin className="mt-1 shrink-0 text-brand-deep" aria-hidden />
                <div className="min-w-0">
                  <h2 className="text-xl font-semibold">{location.name}</h2>
                  <p className="mt-1 text-muted">{location.address}</p>
                  <a
                    href={mapUrl(location.address!)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-1 inline-block py-2 font-medium text-brand-deep underline"
                  >
                    Open in Google Maps
                  </a>
                </div>
              </li>
            ))}
          </ul>
        )}
        <div className="space-y-3">
          {settings.openingHours && (
            <p className="flex min-h-11 items-center gap-3 font-medium">
              <Clock className="shrink-0 text-brand-deep" aria-hidden /> {settings.openingHours}
            </p>
          )}
          {contactPhone && (
            <a href={`tel:${contactPhone.replace(/\s/g, '')}`} className="flex min-h-11 items-center gap-3 font-medium">
              <Phone className="shrink-0 text-brand-deep" aria-hidden /> {contactPhone}
            </a>
          )}
          {whatsapp && (
            <>
              <a
                href={`https://wa.me/${whatsapp.replace(/\D/g, '').replace(/^0/, '254')}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex min-h-11 items-center gap-3 font-medium"
              >
                <MessageCircle className="shrink-0 text-brand-deep" aria-hidden /> Message us on WhatsApp
              </a>
            </>
          )}
          {contactEmail && (
            <a href={`mailto:${contactEmail}`} className="flex min-h-11 items-center gap-3 break-all font-medium">
              <Mail className="shrink-0 text-brand-deep" aria-hidden /> {contactEmail}
            </a>
          )}
          <a href="/account/messages" className="flex min-h-11 items-center gap-3 font-medium">
            <MessageCircle className="shrink-0 text-brand-deep" aria-hidden /> Send us a message from your account
          </a>
          <a href="/help" className="flex min-h-11 items-center gap-3 font-medium">
            <HelpCircle className="shrink-0 text-brand-deep" aria-hidden /> Find answers in our help centre
          </a>
          {settings.assistantEnabled && (
            <p className="pt-2 text-sm text-muted">For a quick answer about stock or prices, use the <strong>Ask us</strong> assistant at the bottom of any page.</p>
          )}
        </div>
      </div>
      <div className="mt-12 max-w-3xl"><ContactForm /></div>
      </div>
    </>
  );
}
