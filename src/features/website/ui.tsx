// Shared pieces of the Website workspace: styles, a screen heading, saving into the draft with a
// message, and the live brand preview (the website's own design tokens on a small page).
import React, { useEffect, useMemo, useState } from 'react';
import { buildTokens } from '../../../website/src/engine/tokens';
import { fontStack } from '../../../website/src/engine/brand';
import { menuLinks } from '../../../website/src/engine/navigation';
import { toPublicBrand } from '../../services/websiteBrand';
import type { WebsiteDocument, WebsitePart } from '../../services/websiteDraft';
import { useInventoryStore } from '../../stores/inventoryStore';
import { useNotificationStore } from '../../stores/notificationStore';
import { formatMoney } from '../../utils/money';
import { useWebsiteDraft } from './useWebsiteDraft';

export const inputClass =
  'w-full rounded-lg border border-app-border bg-app-bg px-3 py-2 text-sm text-app-text outline-none focus:border-brand-500';
export const primaryClass =
  'inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-brand-500 px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-brand-600 disabled:opacity-50';
export const secondaryClass =
  'inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-app-border px-4 py-2 text-sm font-semibold text-app-text transition hover:bg-app-bg disabled:opacity-50';
export const cardClass = 'rounded-xl border border-app-border bg-app-card p-4';
export const labelClass = 'block text-sm font-medium text-app-text';
export const hintClass = 'block font-normal text-app-text-muted';

export function ScreenHeading({ title, children, actions }: { title: string; children?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="max-w-2xl">
        <h2 className="font-display text-lg font-bold text-app-text">{title}</h2>
        {children && <p className="mt-0.5 text-sm text-app-text-muted">{children}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

/** Saves parts into the draft and says so. Resolves true when saved. */
export function useSaveToDraft() {
  const savePart = useWebsiteDraft((s) => s.savePart);
  const showToast = useNotificationStore((s) => s.showToast);
  return async <K extends WebsitePart>(parts: Pick<WebsiteDocument, K>, what: string): Promise<boolean> => {
    const result = await savePart(parts);
    if (result.ok) showToast('Website', `${what} saved to the draft. Publish to show it on the website.`, undefined, 'success');
    else showToast('Website', result.message ?? 'Could not save.', undefined, 'error');
    return result.ok;
  };
}

/**
 * A screen's own copy of one part of the draft. It follows the draft when that changes (saved,
 * published, reloaded) and tells the workspace when it holds unsaved edits.
 */
export function useLocalPart<K extends WebsitePart>(part: K) {
  const saved = useWebsiteDraft((s) => s.draft!.document[part]);
  const setDirty = useWebsiteDraft((s) => s.setDirty);
  const [value, setValue] = useState<WebsiteDocument[K]>(saved);
  useEffect(() => setValue(saved), [saved]);
  const dirty = JSON.stringify(value) !== JSON.stringify(saved);
  useEffect(() => {
    setDirty(part, dirty);
    return () => setDirty(part, false);
  }, [part, dirty, setDirty]);
  useUnsavedWarning(dirty);
  return { value, setValue, dirty, saved, reset: () => setValue(saved) };
}

/** Warns before leaving the app with unsaved edits on a screen. */
export function useUnsavedWarning(dirty: boolean) {
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
}

/** Loads the Google Fonts stylesheet the preview needs (the same one the website loads). */
function useFontSheet(href: string) {
  useEffect(() => {
    const id = 'website-preview-fonts';
    let link = document.getElementById(id) as HTMLLinkElement | null;
    if (!link) {
      link = document.createElement('link');
      link.id = id;
      link.rel = 'stylesheet';
      document.head.appendChild(link);
    }
    if (link.href !== href) link.href = href;
  }, [href]);
}

/**
 * A small page in the shop's design, from the same buildTokens() the website uses: header and
 * menu, opening band, buttons and the first three real products. Colour notes (a colour made
 * deeper so text stays readable) are listed under it.
 */
export function BrandPreview({ doc, name }: { doc: WebsiteDocument; name: string }) {
  const brand = useMemo(() => toPublicBrand(doc.brand), [doc.brand]);
  const tokens = useMemo(() => buildTokens(doc.brand.primary_color, brand), [doc.brand.primary_color, brand]);
  useFontSheet(tokens.fontHref);
  const products = useInventoryStore((s) => s.products);
  const sample = useMemo(() => products.filter((p) => Number(p.price) > 0).slice(0, 3), [products]);
  const menu = menuLinks(doc.navigation, brand, false).slice(0, 5);
  const v = tokens.vars;
  const d = tokens.design;
  const heading: React.CSSProperties = { fontFamily: fontStack(d.headingFont), fontWeight: d.headingWeight, letterSpacing: v['--heading-tracking'] };
  const button: React.CSSProperties = {
    background: v['--btn-bg'], color: v['--btn-fg'], borderRadius: v['--btn-radius'],
    border: `1.5px solid ${v['--color-ember']}`, padding: '0.45rem 0.9rem', fontWeight: 600, fontSize: 13,
  };
  const words = doc.brand.tagline || doc.brand.description || name;

  return (
    <figure className="space-y-2">
      <div
        aria-label="Preview of the website design"
        className="overflow-hidden rounded-xl border border-app-border shadow-sm"
        style={{ background: v['--color-cream'], color: v['--color-ink'], fontFamily: fontStack(d.bodyFont) }}
      >
        <div className="flex items-center gap-3 border-b px-4 py-3" style={{ borderColor: v['--color-line'], background: '#fff' }}>
          {doc.brand.logo_url
            ? <img src={doc.brand.logo_url} alt="" className="h-7 w-auto max-w-[7rem] object-contain" />
            : <span style={{ ...heading, fontSize: 16 }}>{name}</span>}
          <span className="ml-auto hidden gap-3 text-xs sm:flex">
            {menu.map((m) => <span key={m.href + m.label}>{m.label}</span>)}
          </span>
        </div>
        <div className="m-3 px-5 py-6" style={{ background: v['--color-hero'], color: '#fff', borderRadius: v['--radius-xl'] }}>
          <p className="text-xs opacity-80">{name}</p>
          <p className="mt-1 max-w-[22ch] text-xl leading-tight" style={heading}>{words}</p>
          <span className="mt-4 inline-block" style={{ ...button, background: '#fff', color: v['--color-ink'], borderColor: '#fff' }}>Explore</span>
        </div>
        <div className="grid grid-cols-3 gap-2 px-3 pb-4">
          {sample.map((p) => (
            <div key={p.id} className="overflow-hidden border bg-white" style={{ borderColor: v['--color-line'], borderRadius: v['--radius-lg'] }}>
              <div className="aspect-square" style={{ background: v['--color-sand'] }}>
                {p.image && <img src={p.image} alt="" loading="lazy" className="size-full" style={{ objectFit: v['--img-fit'] as React.CSSProperties['objectFit'] }} />}
              </div>
              <div className="p-2">
                <p className="truncate text-xs">{p.name}</p>
                <p className="text-xs font-semibold" style={{ color: v['--color-ember'] }}>{formatMoney(Number(p.price))}</p>
              </div>
            </div>
          ))}
          {sample.length === 0 && <p className="col-span-3 text-xs" style={{ color: v['--color-muted'] }}>Your products appear here once they have a price.</p>}
        </div>
        <div className="flex flex-wrap gap-2 px-3 pb-4">
          <span style={button}>Add to cart</span>
          <span style={{ ...button, background: 'transparent', color: v['--color-ink'], borderColor: v['--color-line'] }}>Contact us</span>
        </div>
      </div>
      <figcaption className="text-xs text-app-text-muted">
        {d.headingFont} headings, {d.bodyFont} text. {tokens.notes.map((n) => n.message).join(' ')}
      </figcaption>
    </figure>
  );
}
