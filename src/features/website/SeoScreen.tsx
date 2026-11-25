// Website > Search engines: the home page's title and description in search results, and the
// picture shown when the website link is shared. Other pages get their titles automatically
// from product, guide and page names (website/src/seo.ts). Empty fields use the automatic text.
import { useMemo } from 'react';
import { Save, Undo2 } from 'lucide-react';
import UnifiedUploader from '../../components/shared/UnifiedUploader';
import { cardClass, hintClass, inputClass, labelClass, primaryClass, ScreenHeading, secondaryClass, useLocalPart, useSaveToDraft } from './ui';
import { useWebsiteDraft } from './useWebsiteDraft';
import { useBusinessStore } from '../../stores/businessStore';

const LIMITS = { title: 70, description: 170 };
// Search results show about this much before cutting off.
const SHOWN = { title: 60, description: 155 };

export default function SeoScreen() {
  const part = useLocalPart('seo');
  const brand = useWebsiteDraft((s) => s.draft!.document.brand);
  const busy = useWebsiteDraft((s) => s.busy);
  const name = useBusinessStore((s) => s.businesses.find((b) => b.id === s.activeBusinessId)?.name ?? 'Your shop');
  const save = useSaveToDraft();
  const seo = part.value ?? {};
  const set = (patch: Partial<NonNullable<typeof part.value>>) => part.setValue({ ...seo, ...patch });

  // The same fallbacks as website/src/seo.ts homeMeta.
  const autoTitle = `${name} | Order online`;
  const autoDescription = brand.description || brand.tagline || `Order from ${name} online. Pay with M-Pesa and get delivery or pick up in store.`;
  const title = seo.title?.trim() || autoTitle;
  const description = seo.description?.trim() || autoDescription;
  const cut = (text: string, n: number) => (text.length > n ? `${text.slice(0, n - 1).trimEnd()}…` : text);
  const cleaned = useMemo(() => {
    const out: NonNullable<typeof part.value> = {};
    if (seo.title?.trim()) out.title = seo.title.trim();
    if (seo.description?.trim()) out.description = seo.description.trim();
    if (seo.shareImage) out.shareImage = seo.shareImage;
    return Object.keys(out).length ? out : null;
  }, [seo.title, seo.description, seo.shareImage]);

  return (
    <form onSubmit={async (e) => { e.preventDefault(); await save({ seo: cleaned }, 'Search engine text'); }} className="space-y-4">
      <ScreenHeading
        title="Search engines"
        actions={part.dirty && (
          <>
            <button type="button" className={secondaryClass} onClick={part.reset}><Undo2 size={15} /> Undo changes</button>
            <button type="submit" className={primaryClass} disabled={busy !== null}><Save size={16} /> Save to draft</button>
          </>
        )}
      >
        How your home page appears on Google and when its link is shared. Product, guide and page titles are made automatically from their names.
      </ScreenHeading>

      <div className="grid gap-4 lg:grid-cols-2 lg:items-start">
        <section className={`${cardClass} space-y-3`}>
          <label className={labelClass}>
            Title
            <span className={hintClass}>Name the business and what it offers. Empty uses "{autoTitle}".</span>
            <input maxLength={LIMITS.title} value={seo.title ?? ''} placeholder={autoTitle} onChange={(e) => set({ title: e.target.value })} className={`${inputClass} mt-1`} />
            <span className={`${hintClass} text-xs ${(seo.title?.length ?? 0) > SHOWN.title ? 'text-amber-600' : ''}`}>
              {seo.title?.length ?? 0} of {LIMITS.title} letters{(seo.title?.length ?? 0) > SHOWN.title ? '; search results may cut the end off' : ''}
            </span>
          </label>
          <label className={labelClass}>
            Description
            <span className={hintClass}>One or two sentences: what you sell, where, and why order from you. Empty uses your short description.</span>
            <textarea rows={3} maxLength={LIMITS.description} value={seo.description ?? ''} placeholder={autoDescription} onChange={(e) => set({ description: e.target.value })} className={`${inputClass} mt-1`} />
            <span className={`${hintClass} text-xs`}>{seo.description?.length ?? 0} of {LIMITS.description} letters</span>
          </label>
          <div className="flex items-center gap-3">
            <div className="aspect-[1.91/1] w-32 shrink-0 overflow-hidden rounded-lg border border-app-border bg-app-bg">
              {seo.shareImage && <img src={seo.shareImage} alt="" className="size-full object-cover" />}
            </div>
            <div>
              <p className="text-sm font-medium text-app-text">Sharing picture</p>
              <p className="text-xs text-app-text-muted">Shown when the link is shared on WhatsApp or social media. Wide, about 1200 by 630. Without one, your logo is used.</p>
              <div className="mt-1.5 flex gap-2">
                <UnifiedUploader allowedTypes={['image']} bucketName="business-logos" cropAspect={1.91} outputWidth={1200} title="Sharing picture" buttonText={seo.shareImage ? 'Change' : 'Upload'} onUploadSuccess={(url) => set({ shareImage: url })} />
                {seo.shareImage && <button type="button" className={secondaryClass} onClick={() => set({ shareImage: undefined })}>Remove</button>}
              </div>
            </div>
          </div>
        </section>

        <section className={`${cardClass} space-y-1`} aria-label="How it may look in search results">
          <p className="text-xs text-app-text-muted">How it may look in search results</p>
          <p className="text-lg leading-snug text-blue-700 dark:text-blue-400">{cut(title, SHOWN.title)}</p>
          <p className="text-sm text-app-text-muted">{cut(description, SHOWN.description)}</p>
        </section>
      </div>
    </form>
  );
}
