// Website > Address & publishing: the website's name and own domain (saved straight away: they
// decide where the website lives, not how it looks), a preview link for the draft, and every
// published version with Put back.
import React, { useCallback, useEffect, useState } from 'react';
import { ExternalLink, History, RotateCcw, Save } from 'lucide-react';
import WebAddressCard from '../../components/website/WebAddressCard';
import { getSupabase } from '../../services/supabaseClient';
import { listVersions, makePreviewLink, WebsiteVersion } from '../../services/websiteDraft';
import { ReceiptShareService } from '../../services/receipt/ReceiptShareService';
import { useNotificationStore } from '../../stores/notificationStore';
import { toUserMessage } from '../../utils/userError';
import { cardClass, hintClass, inputClass, labelClass, primaryClass, ScreenHeading, secondaryClass } from './ui';
import { useWebsiteDraft } from './useWebsiteDraft';

const slugify = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const when = (iso: string) => new Date(iso).toLocaleString('en-KE', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });
const KIND: Record<WebsiteVersion['kind'], string> = { start: 'Before the first publish', publish: 'Published', rollback: 'Put back' };

function WebsiteName({ businessId, onSaved }: { businessId: string; onSaved: () => void }) {
  const showToast = useNotificationStore((s) => s.showToast);
  const [slug, setSlug] = useState('');
  const [saved, setSaved] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    getSupabase().from('businesses').select('website_slug').eq('id', businessId).single()
      .then(({ data }) => { setSlug(data?.website_slug ?? ''); setSaved(data?.website_slug ?? ''); });
  }, [businessId]);
  const clean = slugify(slug);
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const { error } = await getSupabase().from('businesses').update({ website_slug: clean || null }).eq('id', businessId);
      if (error) throw error;
      setSlug(clean);
      setSaved(clean);
      onSaved();
      showToast('Website', 'Website name saved.', undefined, 'success');
    } catch (err) {
      showToast('Website', toUserMessage(err, 'Could not save the website name.'), undefined, 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <form onSubmit={save} className={`${cardClass} space-y-3`}>
      <h3 className="font-bold text-app-text">Website name</h3>
      <label className={labelClass}>
        Name in the address
        <span className={hintClass}>The website stays hidden until this is set. Letters, numbers and dashes. Saved straight away.</span>
        <input value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="myshop" className={`${inputClass} mt-1`} />
        {saved && clean && clean !== saved && (
          <span className="mt-1 block text-xs font-normal text-amber-600">Saving uses one of the two name changes allowed a year. The old address forwards visitors for 90 days.</span>
        )}
      </label>
      <button type="submit" className={primaryClass} disabled={busy || clean === saved}><Save size={16} /> {busy ? 'Saving…' : 'Save name'}</button>
    </form>
  );
}

function VersionHistory({ businessId }: { businessId: string }) {
  const putBack = useWebsiteDraft((s) => s.putBack);
  const busy = useWebsiteDraft((s) => s.busy);
  const changed = useWebsiteDraft((s) => s.draft?.changed ?? false);
  const published = useWebsiteDraft((s) => s.draft?.published?.number ?? null);
  const showToast = useNotificationStore((s) => s.showToast);
  const [versions, setVersions] = useState<WebsiteVersion[] | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  const load = useCallback(() => {
    listVersions(businessId).then(setVersions).catch((err) => showToast('Website', toUserMessage(err, 'Could not load the history.'), undefined, 'error'));
  }, [businessId, showToast]);
  useEffect(load, [load, published]);

  const doPutBack = async (v: WebsiteVersion) => {
    const result = await putBack(v.id);
    setConfirm(null);
    if (result.ok) showToast('Website', `Version ${v.number} is live again (as version ${result.number}).`, undefined, 'success');
    else showToast('Website', result.message ?? 'Could not put that version back.', undefined, 'error');
  };

  return (
    <section className={`${cardClass} space-y-3`}>
      <h3 className="flex items-center gap-2 font-bold text-app-text"><History size={16} /> History</h3>
      <p className="text-sm text-app-text-muted">Every publish is kept. Putting an older one back publishes it again as a new version; nothing is deleted.</p>
      {versions === null && <p className="text-sm text-app-text-muted">Loading…</p>}
      {versions?.length === 0 && <p className="text-sm text-app-text-muted">Nothing published from here yet. The first publish also keeps how the website looked before it.</p>}
      <ul className="divide-y divide-app-border">
        {versions?.map((v) => (
          <li key={v.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
            <div className="min-w-0">
              <p className="font-medium text-app-text">
                Version {v.number} · {KIND[v.kind]}
                {v.number === published && <span className="ml-2 rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs font-semibold text-emerald-600">Live</span>}
              </p>
              <p className="text-xs text-app-text-muted">{when(v.created_at)}{v.created_by_name ? ` by ${v.created_by_name}` : ''}{v.note ? ` · ${v.note}` : ''}</p>
            </div>
            {v.number !== published && (confirm === v.id ? (
              <span className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-app-text-muted">{changed ? 'Your unpublished changes will be thrown away.' : 'Visitors see it within about 5 minutes.'}</span>
                <button type="button" className={primaryClass} disabled={busy !== null} onClick={() => doPutBack(v)}>Put back</button>
                <button type="button" className={secondaryClass} onClick={() => setConfirm(null)}>Cancel</button>
              </span>
            ) : (
              <button type="button" className={secondaryClass} onClick={() => setConfirm(v.id)}><RotateCcw size={15} /> Put back</button>
            ))}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Opens the draft on the shop's own address with a two-hour secret link. */
export function usePreview() {
  const businessId = useWebsiteDraft((s) => s.businessId);
  const showToast = useNotificationStore((s) => s.showToast);
  const [opening, setOpening] = useState(false);
  const open = async () => {
    if (!businessId) return;
    setOpening(true);
    try {
      const link = await makePreviewLink(businessId);
      if (!link.host) throw new Error('Set the website name first, so the preview has an address.');
      await ReceiptShareService.openExternalUrl(`https://${link.host}/?preview=${link.secret}`);
    } catch (err) {
      showToast('Website', toUserMessage(err, 'Could not open the preview.'), undefined, 'error');
    } finally {
      setOpening(false);
    }
  };
  return { open, opening };
}

export default function PublishingScreen() {
  const businessId = useWebsiteDraft((s) => s.businessId!);
  const [addressKey, setAddressKey] = useState(0);
  const preview = usePreview();
  return (
    <div className="space-y-4">
      <ScreenHeading
        title="Address and publishing"
        actions={<button type="button" className={secondaryClass} disabled={preview.opening} onClick={preview.open}><ExternalLink size={15} /> {preview.opening ? 'Opening…' : 'Preview the draft'}</button>}
      >
        Where your website lives, and every version you have published. The preview link works for two hours, only on your own address.
      </ScreenHeading>
      <div className="grid gap-4 lg:grid-cols-2 lg:items-start">
        <div className="space-y-4">
          <WebsiteName businessId={businessId} onSaved={() => setAddressKey((k) => k + 1)} />
          <WebAddressCard businessId={businessId} reloadKey={addressKey} />
        </div>
        <VersionHistory businessId={businessId} />
      </div>
    </div>
  );
}
