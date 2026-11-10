import { ReactNode, useEffect, useMemo, useState } from 'react';
import { ChevronDown, Mail, MessageCircle, Phone, Search } from 'lucide-react';
import { INFO_PAGES, InfoPageDef, infoPageText } from '../infoPages';
import { plainText, RichText, splitSections } from '../RichText';
import { slugify } from '../seo';
import { useStorefront } from '../store';
import { PageHeader, pageClass } from '../ui';
import Breadcrumbs from './Breadcrumbs';

function ContactCard() {
  const { business, settings } = useStorefront();
  const whatsapp = settings.whatsapp || business.contactPhone;
  return (
    <aside className="rounded-2xl bg-sand p-6">
      <h2 className="display-md">Still need help?</h2>
      <p className="mt-2 text-muted">Our team reads every message.{settings.openingHours ? ` We're open ${settings.openingHours}.` : ''}</p>
      <div className="mt-4 flex flex-wrap gap-3">
        <a href="/account/messages" className="btn btn-primary"><MessageCircle size={17} aria-hidden /> Message us</a>
        {business.contactPhone && (
          <a href={`tel:${business.contactPhone.replace(/\s/g, '')}`} className="btn btn-secondary"><Phone size={17} aria-hidden /> {business.contactPhone}</a>
        )}
        {whatsapp && (
          <a href={`https://wa.me/${whatsapp.replace(/\D/g, '').replace(/^0/, '254')}`} target="_blank" rel="noopener noreferrer" className="btn btn-secondary">WhatsApp</a>
        )}
        {business.contactEmail && (
          <a href={`mailto:${business.contactEmail}`} className="btn btn-secondary"><Mail size={17} aria-hidden /> Email</a>
        )}
      </div>
    </aside>
  );
}

function Faq({ text }: { text: string }) {
  const [term, setTerm] = useState('');
  const questions = useMemo(() => splitSections(text).filter((s) => s.heading), [text]);
  const intro = splitSections(text).find((s) => !s.heading);
  const shown = term.trim()
    ? questions.filter((q) => `${q.heading} ${plainText(q.body)}`.toLowerCase().includes(term.trim().toLowerCase()))
    : questions;

  // A link like /help#how-do-i-pay opens that question.
  useEffect(() => {
    const id = decodeURIComponent(window.location.hash.slice(1));
    if (!id) return;
    const element = document.getElementById(id);
    if (element instanceof HTMLDetailsElement) {
      element.open = true;
      element.scrollIntoView({ block: 'start' });
    }
  }, []);

  return (
    <div>
      {intro && <RichText body={intro.body} className="mb-6 text-lg" />}
      <label className="relative block">
        <span className="sr-only">Search help</span>
        <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-muted" aria-hidden />
        <input
          type="search"
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          placeholder="Search questions, for example “delivery”"
          className="h-12 w-full rounded-full border border-line bg-white pl-11 pr-4 text-base"
        />
      </label>
      <div className="mt-6 divide-y divide-line rounded-xl border border-line bg-white">
        {shown.map((q) => (
          <details key={q.heading} id={slugify(q.heading)} className="accordion group px-5" open={Boolean(term.trim())}>
            <summary className="flex min-h-16 items-center justify-between gap-4 py-3 text-[1.0625rem] font-semibold">
              {q.heading}
              <ChevronDown size={19} className="accordion-icon shrink-0 text-muted" aria-hidden />
            </summary>
            <RichText body={q.body} className="pb-5" />
          </details>
        ))}
        {shown.length === 0 && <p className="p-6 text-center text-muted">No questions match. Try another word, or message us below.</p>}
      </div>
    </div>
  );
}

function PolicyBody({ text, children }: { text: string; children?: ReactNode }) {
  const sections = splitSections(text);
  const headings = sections.filter((s) => s.heading);
  return (
    <div className="lg:grid lg:grid-cols-[15rem_minmax(0,1fr)] lg:gap-12">
      {headings.length > 3 && (
        <nav aria-label="On this page" className="mb-8 lg:mb-0">
          <div className="rounded-xl border border-line bg-white p-4 lg:sticky lg:top-36">
            <h2 className="eyebrow">On this page</h2>
            <ol className="mt-2 space-y-0.5 text-[0.9375rem]">
              {headings.map((s) => (
                <li key={s.heading}>
                  <a href={`#${slugify(s.heading)}`} className="block rounded-md px-2 py-1.5 text-muted hover:bg-sand hover:text-ink">{s.heading}</a>
                </li>
              ))}
            </ol>
          </div>
        </nav>
      )}
      <div className="max-w-3xl space-y-8">
        {sections.map((s, index) => (
          <section key={index} id={s.heading ? slugify(s.heading) : undefined} className="scroll-mt-36">
            {s.heading && <h2 className="display-md">{s.heading}</h2>}
            <RichText body={s.body} className={s.heading ? 'mt-3' : 'text-lg'} />
          </section>
        ))}
        {children}
      </div>
    </div>
  );
}

function RelatedPages({ current }: { current: InfoPageDef }) {
  const pages = INFO_PAGES.filter((p) => p.id !== current.id && (p.group === current.group || current.group === 'company'));
  return (
    <nav aria-label="Related pages" className="mt-12">
      <h2 className="eyebrow">{current.group === 'legal' ? 'Other policies' : 'More help'}</h2>
      <ul className="mt-3 flex flex-wrap gap-2">
        {pages.map((p) => <li key={p.id}><a href={p.path} className="chip">{p.label}</a></li>)}
      </ul>
    </nav>
  );
}

export default function InfoPage({ page }: { page: InfoPageDef }) {
  const site = useStorefront();
  const text = infoPageText(page.id, site);

  return (
    <>
      <PageHeader eyebrow={page.eyebrow} title={page.title} body={page.summary}>
        <Breadcrumbs items={[{ label: 'Home', href: '/' }, ...(page.group === 'legal' ? [{ label: 'Policies', href: '/sitemap#policies' }] : []), { label: page.label }]} />
      </PageHeader>
      <div className={pageClass}>
        {page.id === 'help' ? (
          <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
            <Faq text={text} />
            <div className="space-y-4 lg:sticky lg:top-36">
              <ContactCard />
              <ul className="divide-y divide-line rounded-xl border border-line bg-white">
                {[...INFO_PAGES.filter((p) => p.id !== 'help' && p.group !== 'company'), { path: '/track', label: 'Track an order' }].map((p) => (
                  <li key={p.path}><a href={p.path} className="flex min-h-12 items-center justify-between px-4 font-medium hover:bg-amber-50">{p.label}<ChevronDown size={16} className="-rotate-90 text-muted" aria-hidden /></a></li>
                ))}
              </ul>
            </div>
          </div>
        ) : (
          <PolicyBody text={text}>
            <div className="pt-4"><ContactCard /></div>
          </PolicyBody>
        )}
        <RelatedPages current={page} />
      </div>
    </>
  );
}
