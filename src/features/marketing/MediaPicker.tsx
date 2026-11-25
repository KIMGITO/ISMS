// Choosing a picture or video from the media library (or uploading one there and then), with a
// plain warning when it doesn't suit the format; and setting a picture's focal point, the spot
// cropping keeps in view.
import React, { useMemo, useRef, useState } from 'react';
import { Check, Film, ImageIcon, Upload, X } from 'lucide-react';
import { FormSheet } from '../../components/shared/FormSheet';
import { SearchInput } from '../../components/shared/Input';
import { useNotificationStore } from '../../stores/notificationStore';
import { toUserMessage } from '../../utils/userError';
import { listMedia, uploadMedia, type MediaItem } from '../../services/marketing';
import { FORMATS, focalPosition, mediaFit, type AdFormat, type MediaFit } from '../../../website/src/ads/rules';
import { primaryClass, secondaryClass, useLoad } from './shared';

export const FIT_TEXT: Record<MediaFit, string> = {
  ok: 'Fits this format',
  cropped: 'A different shape: it will be cropped around its focal point, never stretched',
  small: 'Smaller than recommended: may look soft on large screens',
  too_small: 'Too small for this format',
  wrong_kind: 'Wrong kind for this format',
};
const FIT_TONE: Record<MediaFit, string> = {
  ok: 'text-emerald-600 dark:text-emerald-400', cropped: 'text-amber-600 dark:text-amber-400',
  small: 'text-amber-600 dark:text-amber-400', too_small: 'text-red-600 dark:text-red-400', wrong_kind: 'text-red-600 dark:text-red-400',
};

export function FitNote({ media, format }: { media: Pick<MediaItem, 'kind' | 'width' | 'height'>; format: AdFormat }) {
  const fit = mediaFit(media, format);
  return <span className={`text-xs ${FIT_TONE[fit]}`}>{FIT_TEXT[fit]}</span>;
}

export function MediaThumb({ item, className = 'aspect-square' }: { item: MediaItem; className?: string }) {
  if (item.kind === 'image') {
    return <img src={item.url} alt={item.alt_text ?? ''} loading="lazy" className={`w-full rounded-lg bg-app-bg object-cover ${className}`} style={{ objectPosition: focalPosition(item.focal_x, item.focal_y) }} />;
  }
  return (
    <div className={`grid w-full place-items-center rounded-lg bg-app-bg text-app-text-muted ${className}`}>
      {item.kind === 'video' ? <Film size={22} /> : <span className="text-xs font-semibold">VTT</span>}
    </div>
  );
}

/** Upload button that sends files to the media library. */
export function UploadButton({ businessId, accept, onUploaded, label = 'Upload', className = primaryClass, folder }: {
  businessId: string; accept: string; onUploaded: (ids: { id: string; posterId?: string }[]) => void; label?: string; className?: string; folder?: string;
}) {
  const input = useRef<HTMLInputElement | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const showToast = useNotificationStore((s) => s.showToast);
  const send = async (files: FileList | null) => {
    if (!files?.length) return;
    const done: { id: string; posterId?: string }[] = [];
    for (const file of Array.from(files).slice(0, 10)) {
      try {
        setProgress(0);
        done.push(await uploadMedia(businessId, file, { folder, onProgress: setProgress }));
      } catch (e) {
        showToast('Upload', `${file.name}: ${toUserMessage(e, 'Could not upload.')}`, undefined, 'error');
      }
    }
    setProgress(null);
    if (input.current) input.current.value = '';
    if (done.length) onUploaded(done);
  };
  return (
    <>
      <input ref={input} type="file" accept={accept} multiple hidden onChange={(e) => send(e.target.files)} />
      <button type="button" className={className} disabled={progress !== null} onClick={() => input.current?.click()}>
        <Upload size={15} /> {progress !== null ? `Uploading ${progress}%` : label}
      </button>
    </>
  );
}

export const ACCEPT = {
  image: 'image/jpeg,image/png,image/webp,image/avif,image/gif',
  video: 'video/mp4,video/webm',
  captions: '.vtt,text/vtt',
} as const;

/** A sheet listing the library's files of one kind; picks one. */
export function MediaPicker({ businessId, kind, format, title, onPick, onClose }: {
  businessId: string; kind: 'image' | 'video' | 'captions'; format?: AdFormat; title: string;
  onPick: (item: MediaItem, posterId?: string) => void; onClose: () => void;
}) {
  const { data, error, reload } = useLoad(() => listMedia(businessId), [businessId]);
  const [q, setQ] = useState('');
  const items = useMemo(() => {
    const term = q.trim().toLowerCase();
    return (data ?? []).filter((m) => m.kind === kind && (!term || `${m.title ?? ''} ${m.alt_text ?? ''} ${m.folder ?? ''}`.toLowerCase().includes(term)));
  }, [data, kind, q]);
  return (
    <FormSheet title={title} subtitle={format && FORMATS[format].ratio ? `${FORMATS[format].label}, ${FORMATS[format].shape}, ideally ${FORMATS[format].minWidth} px wide or more` : undefined} onClose={onClose} wide>
      <div className="space-y-3">
        <div className="flex flex-wrap gap-2">
          <div className="min-w-48 flex-1"><SearchInput value={q} onChange={setQ} placeholder="Search the library" /></div>
          <UploadButton
            businessId={businessId}
            accept={ACCEPT[kind]}
            onUploaded={async (ids) => {
              const fresh = await listMedia(businessId);
              const first = fresh.find((m) => m.id === ids[0].id);
              if (first) onPick(first, ids[0].posterId);
              else reload();
            }}
          />
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        {data && items.length === 0 && <p className="text-sm text-app-text-muted">Nothing here yet. Upload a file, or make one in Canva from the Creative studio.</p>}
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {items.map((m) => {
            const fit = format ? mediaFit(m, format) : 'ok';
            const blocked = fit === 'too_small' || fit === 'wrong_kind';
            return (
              <li key={m.id}>
                <button type="button" disabled={blocked} onClick={() => onPick(m)} className="block w-full rounded-xl border border-app-border p-2 text-left transition hover:border-brand-500 disabled:cursor-not-allowed disabled:opacity-50">
                  <MediaThumb item={m} />
                  <span className="mt-1.5 block truncate text-xs font-medium text-app-text">{m.title || 'Untitled'}</span>
                  {m.width && <span className="block text-[11px] text-app-text-muted">{m.width} × {m.height}{m.duration_ms ? ` · ${Math.round(m.duration_ms / 1000)} s` : ''}</span>}
                  {format && kind !== 'captions' && <FitNote media={m} format={format} />}
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </FormSheet>
  );
}

/** Click or use the arrow keys on the picture to choose what cropping keeps in view. */
export function FocalPointPicker({ url, x, y, onChange }: { url: string; x: number; y: number; onChange: (x: number, y: number) => void }) {
  const box = useRef<HTMLDivElement | null>(null);
  const set = (e: React.MouseEvent) => {
    const r = box.current!.getBoundingClientRect();
    onChange(Math.round(((e.clientX - r.left) / r.width) * 100), Math.round(((e.clientY - r.top) / r.height) * 100));
  };
  const key = (e: React.KeyboardEvent) => {
    const step = e.shiftKey ? 10 : 2;
    const moves: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    const m = moves[e.key];
    if (!m) return;
    e.preventDefault();
    onChange(Math.min(100, Math.max(0, x + m[0])), Math.min(100, Math.max(0, y + m[1])));
  };
  return (
    <div>
      <div
        ref={box}
        role="slider"
        tabIndex={0}
        aria-label="Focal point"
        aria-valuetext={`${x}% across, ${y}% down`}
        onClick={set}
        onKeyDown={key}
        className="relative cursor-crosshair overflow-hidden rounded-lg bg-app-bg outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
      >
        <img src={url} alt="" className="block w-full select-none" draggable={false} />
        <span className="pointer-events-none absolute size-6 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_2px_rgba(0,0,0,0.5)]" style={{ left: `${x}%`, top: `${y}%` }} />
      </div>
      <p className="mt-1 text-xs text-app-text-muted">Click the part that must stay in view when the picture is cropped (arrow keys move it).</p>
    </div>
  );
}

/** A chosen file shown in a form, with Change and Remove. */
export function ChosenMedia({ item, format, onChange, onRemove, label }: {
  item: MediaItem | undefined; format?: AdFormat; onChange: () => void; onRemove?: () => void; label: string;
}) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-app-border p-2">
      <div className="w-16 shrink-0">{item ? <MediaThumb item={item} /> : <div className="grid aspect-square place-items-center rounded-lg bg-app-bg text-app-text-muted"><ImageIcon size={18} /></div>}</div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-app-text">{item ? item.title || 'Untitled' : label}</p>
        {item && format && item.kind !== 'captions' && <FitNote media={item} format={format} />}
      </div>
      <button type="button" className={secondaryClass} onClick={onChange}>{item ? 'Change' : <><Check size={14} /> Choose</>}</button>
      {item && onRemove && <button type="button" aria-label={`Remove ${label}`} className="grid size-9 place-items-center rounded-lg text-app-text-muted hover:bg-app-bg" onClick={onRemove}><X size={16} /></button>}
    </div>
  );
}
