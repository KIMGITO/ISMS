// Website > Pages: About us, Contact, Delivery, Help, Returns and the legal pages. Each shows the
// standard text (kept up to date with delivery areas, minimum order and points) until the shop
// writes its own. Saved into the draft; Publish shows it.
import React, { useEffect, useState } from 'react';
import { BookOpen, RefreshCw, Save, Undo2 } from 'lucide-react';
import PageEditor from '../../components/website/PageEditor';
import { defaultInfoPageText, INFO_PAGES, InfoPageId } from '../../../website/src/infoPages';
import type { Storefront } from '../../../website/src/api';
import { getSupabase } from '../../services/supabaseClient';
import { cardClass, primaryClass, ScreenHeading, secondaryClass, useLocalPart, useSaveToDraft } from './ui';
import { useWebsiteDraft } from './useWebsiteDraft';

/** The live storefront, for the standard page text (it names delivery areas, fees and points). */
function useLiveStorefront(businessId: string) {
  const [site, setSite] = useState<Storefront | null>(null);
  useEffect(() => {
    let alive = true;
    (async () => {
      const { data: biz } = await getSupabase().from('businesses').select('website_slug').eq('id', businessId).single();
      if (!biz?.website_slug) return;
      const { data } = await getSupabase().rpc('get_public_storefront', { p_slug: biz.website_slug });
      if (alive) setSite((data as Storefront | null) ?? null);
    })().catch(() => undefined);
    return () => { alive = false; };
  }, [businessId]);
  return site;
}

export default function PagesScreen() {
  const businessId = useWebsiteDraft((s) => s.businessId!);
  const busy = useWebsiteDraft((s) => s.busy);
  const part = useLocalPart('pages');
  const save = useSaveToDraft();
  const site = useLiveStorefront(businessId);
  const [selected, setSelected] = useState<InfoPageId>('about');
  const pages = part.value;
  const page = INFO_PAGES.find((p) => p.id === selected)!;
  const text = pages[selected] ?? '';
  const standard = site ? defaultInfoPageText(selected, site) : '';

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleaned = Object.fromEntries(Object.entries(pages).filter(([, t]) => t.trim()));
    await save({ pages: cleaned }, 'Pages');
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <ScreenHeading
        title="Pages"
        actions={part.dirty && (
          <>
            <button type="button" className={secondaryClass} onClick={part.reset}><Undo2 size={15} /> Undo changes</button>
            <button type="submit" className={primaryClass} disabled={busy !== null}><Save size={16} /> Save to draft</button>
          </>
        )}
      >
        Every page starts with standard text that stays up to date by itself. Write your own where you want to.
      </ScreenHeading>

      <div className="grid gap-4 lg:grid-cols-[15rem_minmax(0,1fr)] lg:items-start">
        <nav className={`${cardClass} p-2`} aria-label="Website pages">
          {INFO_PAGES.map((p) => (
            <button
              key={p.id}
              type="button"
              aria-current={selected === p.id ? 'page' : undefined}
              onClick={() => setSelected(p.id)}
              className={`flex min-h-10 w-full items-center justify-between gap-2 rounded-lg px-3 text-left text-sm font-medium ${selected === p.id ? 'bg-brand-500/15 text-app-text' : 'text-app-text-muted hover:bg-app-bg'}`}
            >
              {p.label}
              <span className="text-xs">{pages[p.id]?.trim() ? 'Your text' : 'Standard'}</span>
            </button>
          ))}
        </nav>

        <section className={`${cardClass} space-y-3`}>
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h3 className="font-bold text-app-text">{page.title}</h3>
              <p className="text-sm text-app-text-muted">
                Address: {page.path}. {text.trim() ? 'Your text is shown. Clear it to go back to the standard text.' : 'The standard text is shown.'}
              </p>
            </div>
            {standard && !text.trim() && (
              <button type="button" className={secondaryClass} onClick={() => part.setValue({ ...pages, [selected]: standard })}>
                <BookOpen size={16} /> Start from standard text
              </button>
            )}
          </div>
          <PageEditor
            key={selected}
            value={text}
            onChange={(next) => part.setValue((current) => ({ ...current, [selected]: next }))}
            businessId={businessId}
            fallback={standard}
            header={{ eyebrow: page.eyebrow, title: page.title, summary: page.summary }}
            sectionHeadings
            placeholder="Your own text"
            previewNote={
              selected === 'help'
                ? 'On the website, each heading on this page becomes a question customers tap to open, with a search box above.'
                : 'On the website, pages with more than three headings also get an "On this page" list of the headings.'
            }
          />
          {page.legal && <p className="text-xs text-app-text-muted">Legal pages: have a lawyer check them before launch.</p>}
          {text.trim() && (
            <button type="button" className={secondaryClass} onClick={() => part.setValue({ ...pages, [selected]: '' })}>
              <RefreshCw size={16} /> Use standard text
            </button>
          )}
        </section>
      </div>
    </form>
  );
}
