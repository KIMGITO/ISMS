import { Mail, MapPin, MessageCircle, Phone } from 'lucide-react';
import { useStorefront } from '../store';
import { pageClass } from '../ui';

const mapUrl = (address: string) =>
  `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;

export default function ContactPage() {
  const { business, branches } = useStorefront();
  const { address, contactEmail, contactPhone, name } = business;
  const locations = branches.some((b) => b.address) ? branches.filter((b) => b.address) : address ? [{ name, address }] : [];

  return (
    <div className={pageClass}>
      <h1 className="text-4xl font-bold">Find us</h1>
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
          {contactPhone && (
            <>
              <a href={`tel:${contactPhone}`} className="flex min-h-11 items-center gap-3 font-medium">
                <Phone className="shrink-0 text-brand-deep" aria-hidden /> {contactPhone}
              </a>
              <a
                href={`https://wa.me/${contactPhone.replace(/\D/g, '')}`}
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
        </div>
      </div>
    </div>
  );
}
