// Creative studio: the shop's media library (pictures, videos, captions) and Canva.
// Canva has two ways in, and neither is required:
//   * Connected (when the platform has a Canva integration): create a design at an advert's exact
//     size, reopen your designs, and import a finished one straight into the library.
//   * By hand (always): open Canva at the size shown, download the design, upload it here.
import React, { useMemo, useState } from 'react';
import { Copy, ExternalLink, Film, Link2, Link2Off, RefreshCw, Trash2, Wand2 } from 'lucide-react';
import { FilterChips } from '../../components/shared/Choice';
import { SearchInput } from '../../components/shared/Input';
import { FormSheet } from '../../components/shared/FormSheet';
import SearchableDropdown from '../../components/SearchableDropdown';
import { useNotificationStore } from '../../stores/notificationStore';
import { toUserMessage } from '../../utils/userError';
import {
  canvaConnect, canvaCreateDesign, canvaDisconnect, canvaEditUrl, canvaImport, canvaListDesigns, canvaStatus,
  listMedia, removeMedia, updateMedia, type CanvaDesign, type CanvaStatus, type MediaItem,
} from '../../services/marketing';
import { DESIGN_SIZES, FORMATS, type AdFormat } from '../../../website/src/ads/rules';
import { ACCEPT, FocalPointPicker, MediaThumb, UploadButton } from './MediaPicker';
import { cardClass, dangerClass, ErrorBox, hintClass, inputClass, labelClass, primaryClass, ScreenHeading, secondaryClass, useCanManage, useLoad } from './shared';

type Filter = 'all' | 'image' | 'video' | 'captions' | 'canva';
const DESIGN_FORMATS = Object.keys(DESIGN_SIZES) as Exclude<AdFormat, 'text'>[];
const mb = (n: number) => `${(n / 1048576).toFixed(1)} MB`;

export default function StudioScreen({ businessId }: { businessId: string }) {
  const canManage = useCanManage();
  const { data, error, reload } = useLoad(() => listMedia(businessId), [businessId]);
  const [filter, setFilter] = useState<Filter>('all');
  const [folder, setFolder] = useState('');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<MediaItem | null>(null);

  const folders = useMemo(() => Array.from(new Set((data ?? []).map((m) => m.folder).filter(Boolean) as string[])).sort(), [data]);
  const items = useMemo(() => {
    const term = q.trim().toLowerCase();
    return (data ?? []).filter((m) =>
      (filter === 'all' || (filter === 'canva' ? m.source === 'canva' : m.kind === filter)) &&
      (!folder || m.folder === folder) &&
      (!term || `${m.title ?? ''} ${m.alt_text ?? ''} ${m.folder ?? ''}`.toLowerCase().includes(term)));
  }, [data, filter, folder, q]);
  const used = (data ?? []).reduce((a, m) => a + m.bytes, 0);

  return (
    <div className="space-y-5">
      <ScreenHeading
        title="Creative studio"
        actions={canManage ? (
          <UploadButton businessId={businessId} accept={`${ACCEPT.image},${ACCEPT.video},${ACCEPT.captions}`} folder={folder || undefined} onUploaded={reload} label="Upload files" />
        ) : undefined}
      >
        Pictures and videos for your campaigns and website. Pictures: JPG, PNG, WebP, AVIF or GIF up to 10 MB. Videos: MP4 or WebM up to 50 MB and 3 minutes. Captions: .vtt.
      </ScreenHeading>

      {canManage && <CanvaPanel businessId={businessId} onImported={reload} />}

      <section className="space-y-3" aria-label="Media library">
        <div className="flex flex-wrap items-center gap-2">
          <FilterChips<Filter> ariaLabel="Show" value={filter} onChange={setFilter} options={[
            { id: 'all', label: 'All' }, { id: 'image', label: 'Pictures' }, { id: 'video', label: 'Videos' }, { id: 'captions', label: 'Captions' }, { id: 'canva', label: 'From Canva' },
          ]} />
          {folders.length > 0 && (
            <SearchableDropdown className="w-44" placeholder="Every folder" selectedValue={folder} onChange={setFolder} items={[{ id: '', label: 'Every folder' }, ...folders.map((f) => ({ id: f, label: f }))]} />
          )}
          <div className="min-w-48 flex-1"><SearchInput value={q} onChange={setQ} placeholder="Search by name or description" /></div>
          <span className="text-xs text-app-text-muted">{(data ?? []).length} files · {mb(used)}</span>
        </div>
        {error && <ErrorBox message={error} onRetry={reload} />}
        {data && items.length === 0 && <div className={`${cardClass} text-sm text-app-text-muted`}>{data.length ? 'Nothing matches.' : 'The library is empty. Upload pictures or videos, or make them in Canva.'}</div>}
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {items.map((m) => (
            <li key={m.id}>
              <button type="button" onClick={() => setOpen(m)} className="block w-full rounded-xl border border-app-border bg-app-card p-2 text-left transition hover:border-brand-500">
                <MediaThumb item={m} />
                <span className="mt-1.5 block truncate text-xs font-medium text-app-text">{m.title || 'Untitled'}</span>
                <span className="block text-[11px] text-app-text-muted">
                  {m.kind === 'captions' ? 'Captions' : `${m.width} × ${m.height}`}{m.duration_ms ? ` · ${Math.round(m.duration_ms / 1000)} s` : ''}{m.source === 'canva' ? ' · Canva' : ''}
                </span>
                {m.kind !== 'captions' && !m.alt_text && <span className="block text-[11px] text-amber-600 dark:text-amber-400">No description yet</span>}
              </button>
            </li>
          ))}
        </ul>
      </section>

      {open && <MediaDetails item={open} canManage={canManage} folders={folders} onClose={() => setOpen(null)} onChanged={() => { setOpen(null); reload(); }} />}
    </div>
  );
}

function MediaDetails({ item, canManage, folders, onClose, onChanged }: { item: MediaItem; canManage: boolean; folders: string[]; onClose: () => void; onChanged: () => void }) {
  const showToast = useNotificationStore((s) => s.showToast);
  const [title, setTitle] = useState(item.title ?? '');
  const [alt, setAlt] = useState(item.alt_text ?? '');
  const [folder, setFolder] = useState(item.folder ?? '');
  const [fx, setFx] = useState(Number(item.focal_x));
  const [fy, setFy] = useState(Number(item.focal_y));
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      await updateMedia(item.id, { title, alt_text: alt, folder, focal_x: fx, focal_y: fy });
      showToast('Media', 'Saved.', undefined, 'success');
      onChanged();
    } catch (e) { showToast('Media', toUserMessage(e, 'Could not save.'), undefined, 'error'); } finally { setBusy(false); }
  };
  const remove = async () => {
    setBusy(true);
    try {
      await removeMedia(item.id);
      showToast('Media', 'Removed from the library.', undefined, 'success');
      onChanged();
    } catch (e) { showToast('Media', toUserMessage(e, 'Could not remove it.'), undefined, 'error'); } finally { setBusy(false); }
  };
  return (
    <FormSheet title={item.title || 'Untitled'} subtitle={`${item.mime_type} · ${mb(item.bytes)}${item.width ? ` · ${item.width} × ${item.height}` : ''}`} onClose={onClose} wide
      footer={canManage ? (
        <div className="flex flex-wrap justify-between gap-2">
          <button type="button" className={dangerClass} disabled={busy} onClick={remove}><Trash2 size={15} /> Remove</button>
          <span className="flex gap-2"><button type="button" className={secondaryClass} onClick={onClose}>Cancel</button><button type="button" className={primaryClass} disabled={busy} onClick={save}>Save</button></span>
        </div>
      ) : undefined}>
      <div className="grid gap-4 md:grid-cols-2">
        <div>
          {item.kind === 'image' && canManage ? <FocalPointPicker url={item.url} x={fx} y={fy} onChange={(x, y) => { setFx(x); setFy(y); }} />
            : item.kind === 'video' ? <video src={item.url} controls preload="metadata" className="w-full rounded-lg bg-black" />
              : item.kind === 'image' ? <img src={item.url} alt={item.alt_text ?? ''} className="w-full rounded-lg" />
                : <p className="text-sm text-app-text-muted">Captions file</p>}
          {item.kind === 'image' && item.width && (
            <p className="mt-2 text-xs text-app-text-muted">
              Best for: {(Object.keys(FORMATS) as AdFormat[]).filter((f) => FORMATS[f].media === 'image' && FORMATS[f].ratio && Math.abs(item.width! / item.height! - FORMATS[f].ratio!) / FORMATS[f].ratio! <= 0.03).map((f) => FORMATS[f].label).join(', ') || 'any format, cropped around the focal point'}
            </p>
          )}
        </div>
        <fieldset disabled={!canManage} className="space-y-3">
          <label className={labelClass}>Name<input className={`${inputClass} mt-1`} maxLength={120} value={title} onChange={(e) => setTitle(e.target.value)} /></label>
          {item.kind !== 'captions' && (
            <label className={labelClass}>Description <span className={hintClass}>What it shows, for people who can't see it. Used when a creative has none of its own.</span>
              <textarea className={`${inputClass} mt-1`} rows={3} maxLength={250} value={alt} onChange={(e) => setAlt(e.target.value)} />
            </label>
          )}
          <label className={labelClass}>Folder
            <input className={`${inputClass} mt-1`} list="media-folders" maxLength={60} value={folder} onChange={(e) => setFolder(e.target.value)} placeholder="Black Friday" />
            <datalist id="media-folders">{folders.map((f) => <option key={f} value={f} />)}</datalist>
          </label>
          <button type="button" className={secondaryClass} onClick={() => navigator.clipboard?.writeText(item.url)}><Copy size={15} /> Copy file address</button>
          {item.source === 'canva' && <p className="text-xs text-app-text-muted">Made in Canva. To change it, edit the design in Canva and import it again.</p>}
        </fieldset>
      </div>
    </FormSheet>
  );
}

function CanvaPanel({ businessId, onImported }: { businessId: string; onImported: () => void }) {
  const showToast = useNotificationStore((s) => s.showToast);
  const status = useLoad(() => canvaStatus(businessId).catch((): CanvaStatus => ({ configured: false, connected: false })), [businessId]);
  const [format, setFormat] = useState<Exclude<AdFormat, 'text'>>('hero_16x9');
  const [busy, setBusy] = useState<string | null>(null);
  const [designs, setDesigns] = useState<CanvaDesign[] | null>(null);
  const [importing, setImporting] = useState<CanvaDesign | null>(null);
  const size = DESIGN_SIZES[format];

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    try { await fn(); } catch (e: any) {
      if (e?.code === 'NOT_CONNECTED') status.reload();
      showToast('Canva', toUserMessage(e, 'Canva did not answer.'), undefined, 'error');
    } finally { setBusy(null); }
  };

  const formatSelect = (
    <label className={labelClass}>Advert format
      <SearchableDropdown className="mt-1" placeholder="Choose a size" selectedValue={format} onChange={(x) => setFormat(x as typeof format)} items={DESIGN_FORMATS.map((f) => ({ id: f, label: `${FORMATS[f].label}: ${DESIGN_SIZES[f].width} × ${DESIGN_SIZES[f].height} px${FORMATS[f].media === 'video' ? ' (video)' : ''}` }))} />
    </label>
  );

  if (!status.data) return null;

  // By hand: always available, and the only way when the platform has no Canva integration.
  if (!status.data.configured || !status.data.connected) {
    return (
      <section className={`${cardClass} space-y-3`} aria-label="Design in Canva">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h3 className="flex items-center gap-2 font-semibold text-app-text"><Wand2 size={16} /> Design in Canva</h3>
            <p className="text-sm text-app-text-muted">Optional. Any design tool works; upload the finished file here.</p>
          </div>
          {status.data.configured && (
            <span className="flex gap-2">
              <button type="button" className={primaryClass} disabled={busy !== null} onClick={() => run('connect', async () => {
                const { url } = await canvaConnect(businessId);
                window.open(url, '_blank', 'noopener');
                showToast('Canva', 'Allow access in the Canva tab, then come back and press "I have connected".', undefined, 'info' as any);
              })}><Link2 size={15} /> Connect Canva</button>
              <button type="button" className={secondaryClass} onClick={status.reload}><RefreshCw size={15} /> I have connected</button>
            </span>
          )}
        </div>
        <div className="grid gap-3 md:grid-cols-[minmax(0,18rem)_1fr]">
          {formatSelect}
          <ol className="list-decimal space-y-1 pl-5 text-sm text-app-text">
            <li>In Canva, choose <strong>Create a design</strong>, then <strong>Custom size</strong>: <strong>{size.width} × {size.height} px</strong>.</li>
            <li>Design the advert. Keep important words away from the edges: phones may crop a little.</li>
            <li>Choose <strong>Share</strong>, <strong>Download</strong>, file type <strong>{FORMATS[format].media === 'video' ? 'MP4 Video' : 'JPG or PNG'}</strong>.</li>
            <li>Upload the downloaded file here, then add it to a campaign.</li>
          </ol>
        </div>
        <div className="flex flex-wrap gap-2">
          <a className={secondaryClass} href="https://www.canva.com/" target="_blank" rel="noopener noreferrer"><ExternalLink size={15} /> Open Canva</a>
          <button type="button" className={secondaryClass} onClick={() => navigator.clipboard?.writeText(`${size.width} x ${size.height}`)}><Copy size={15} /> Copy size</button>
          <UploadButton businessId={businessId} accept={FORMATS[format].media === 'video' ? ACCEPT.video : ACCEPT.image} folder="Canva" className={primaryClass} label="Upload the design" onUploaded={onImported} />
        </div>
      </section>
    );
  }

  // Connected.
  return (
    <section className={`${cardClass} space-y-3`} aria-label="Canva">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="flex items-center gap-2 font-semibold text-app-text"><Wand2 size={16} /> Canva</h3>
          <p className="text-sm text-app-text-muted">Connected{status.data.name ? ` as ${status.data.name}` : ''}. Designs stay in your Canva account; imports are copied into this library.</p>
        </div>
        <button type="button" className={secondaryClass} disabled={busy !== null} onClick={() => run('disconnect', async () => { await canvaDisconnect(businessId); status.reload(); })}><Link2Off size={15} /> Disconnect</button>
      </div>
      <div className="grid gap-3 md:grid-cols-[minmax(0,18rem)_auto] md:items-end">
        {formatSelect}
        <div className="flex flex-wrap gap-2">
          <button type="button" className={primaryClass} disabled={busy !== null} onClick={() => run('create', async () => {
            const { editUrl } = await canvaCreateDesign(businessId, format, `${FORMATS[format].label} ${new Date().toLocaleDateString()}`);
            window.open(editUrl, '_blank', 'noopener');
            setDesigns(null);
          })}><Wand2 size={15} /> {busy === 'create' ? 'Opening…' : 'New design in Canva'}</button>
          <button type="button" className={secondaryClass} disabled={busy !== null} onClick={() => run('list', async () => setDesigns((await canvaListDesigns(businessId)).designs))}>
            <RefreshCw size={15} /> {designs ? 'Refresh my designs' : 'Show my designs'}
          </button>
        </div>
      </div>
      {designs && (
        designs.length === 0 ? <p className="text-sm text-app-text-muted">No designs in your Canva account yet.</p> : (
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {designs.map((d) => (
              <li key={d.id} className="rounded-xl border border-app-border p-2">
                {d.thumbnail ? <img src={d.thumbnail} alt="" className="aspect-video w-full rounded-lg bg-app-bg object-contain" /> : <div className="grid aspect-video place-items-center rounded-lg bg-app-bg text-app-text-muted"><Film size={18} /></div>}
                <p className="mt-1 truncate text-xs font-medium text-app-text">{d.title}</p>
                <div className="mt-1.5 flex gap-1.5">
                  <button type="button" className="flex-1 rounded-lg bg-brand-500 px-2 py-1.5 text-xs font-semibold text-slate-950" onClick={() => setImporting(d)}>Import</button>
                  <button type="button" className="rounded-lg border border-app-border px-2 py-1.5 text-xs font-semibold text-app-text" onClick={() => run('edit', async () => { window.open((await canvaEditUrl(businessId, d.id)).editUrl, '_blank', 'noopener'); })}>Edit</button>
                </div>
              </li>
            ))}
          </ul>
        )
      )}
      {importing && (
        <FormSheet title={`Import "${importing.title}"`} subtitle="Canva exports it and it is copied into your library." onClose={() => setImporting(null)}
          footer={<div className="flex justify-end gap-2">
            <button type="button" className={secondaryClass} onClick={() => setImporting(null)}>Cancel</button>
            <button type="button" className={primaryClass} disabled={busy !== null} onClick={() => run('import', async () => {
              await canvaImport(businessId, importing.id, format, importing.title);
              showToast('Canva', 'Imported into the library. Add a description before using it.', undefined, 'success');
              setImporting(null);
              onImported();
            })}>{busy === 'import' ? 'Exporting from Canva…' : 'Import'}</button>
          </div>}>
          <div className="space-y-2">
            {formatSelect}
            <p className="text-sm text-app-text-muted">Pictures come in as JPG at {size.width} px wide; videos as MP4 at 1080p with a cover picture. Paid Canva elements you haven't bought can stop the export.</p>
          </div>
        </FormSheet>
      )}
    </section>
  );
}
