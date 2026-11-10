import React, { useRef, useState } from 'react';
import { Image as ImageIcon, Link as LinkIcon, Loader2, Upload, X } from 'lucide-react';
import { useOverlay } from '../../hooks/useOverlay';
import { toUserMessage } from '../../utils/userError';
import { CREDITED_PHOTOS, photoUrl } from '../../../website/src/images';
import { uploadPageImage } from './pageImages';

export interface PickedImage {
  src: string;
  alt: string;
}

interface Props {
  open: boolean;
  businessId: string;
  title?: string;
  onClose: () => void;
  onPick: (image: PickedImage) => void;
}

type Source = 'device' | 'stock' | 'link';

const tabClass = (active: boolean) =>
  `inline-flex min-h-9 items-center gap-1.5 rounded-lg px-3 text-sm font-semibold ${active ? 'bg-brand-500/15 text-app-text' : 'text-app-text-muted hover:bg-app-bg'}`;

/** Upload a photo, choose one of the website's own photos, or paste a link. */
export default function ImagePicker({ open, businessId, title = 'Add a photo', onClose, onPick }: Props) {
  const [source, setSource] = useState<Source>('device');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [link, setLink] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  useOverlay(open, onClose, 'dialog');

  if (!open) return null;

  const upload = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    setError('');
    try {
      const src = await uploadPageImage(businessId, file);
      onPick({ src, alt: file.name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').replace(/^(img|image|photo|dsc|pxl)\s*\d*/i, '').trim() });
    } catch (err) {
      setError(toUserMessage(err, 'Could not upload the photo. Check the connection and try again.'));
    } finally {
      setBusy(false);
    }
  };

  const applyLink = () => {
    const value = link.trim().replace(/^http:\/\//i, 'https://');
    if (!/^https:\/\/[^\s)"]+$/.test(value)) {
      setError('Paste a full photo link starting with https://');
      return;
    }
    onPick({ src: value, alt: '' });
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[90vh] w-full max-w-2xl flex-col rounded-t-2xl border border-app-border bg-app-card pb-[var(--inset-bottom,0px)] shadow-2xl sm:rounded-2xl"
      >
        <header className="flex items-center justify-between gap-2 border-b border-app-border p-4">
          <h2 className="font-display text-lg font-bold text-app-text">{title}</h2>
          <button type="button" onClick={onClose} className="rounded-lg p-2 text-app-text-muted hover:bg-app-bg" aria-label="Close">
            <X size={18} />
          </button>
        </header>
        <div className="flex gap-1 border-b border-app-border p-2" role="tablist">
          <button type="button" role="tab" aria-selected={source === 'device'} className={tabClass(source === 'device')} onClick={() => setSource('device')}>
            <Upload size={15} /> Upload
          </button>
          <button type="button" role="tab" aria-selected={source === 'stock'} className={tabClass(source === 'stock')} onClick={() => setSource('stock')}>
            <ImageIcon size={15} /> Website photos
          </button>
          <button type="button" role="tab" aria-selected={source === 'link'} className={tabClass(source === 'link')} onClick={() => setSource('link')}>
            <LinkIcon size={15} /> Link
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {source === 'device' && (
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                upload(e.dataTransfer.files[0]);
              }}
              className={`flex min-h-56 flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed p-6 text-center ${dragOver ? 'border-brand-500 bg-brand-500/10' : 'border-app-border'}`}
            >
              {busy ? (
                <>
                  <Loader2 className="animate-spin text-brand-500" size={28} />
                  <p className="text-sm text-app-text-muted">Making the photo web-sized and uploading…</p>
                </>
              ) : (
                <>
                  <Upload className="text-brand-500" size={28} />
                  <p className="text-sm font-medium text-app-text">Drop a photo here, or</p>
                  <button
                    type="button"
                    onClick={() => fileRef.current?.click()}
                    className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-brand-500 px-4 text-sm font-semibold text-slate-950 hover:bg-brand-600"
                  >
                    Choose a photo or take one
                  </button>
                  <p className="max-w-sm text-xs text-app-text-muted">Large photos are shrunk to 1600 pixels so pages load fast on phones. You can crop and position it after.</p>
                </>
              )}
              <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => upload(e.target.files?.[0])} />
            </div>
          )}

          {source === 'stock' && (
            <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {CREDITED_PHOTOS.map((photo) => (
                <li key={photo.id}>
                  <button
                    type="button"
                    onClick={() => onPick({ src: photoUrl(photo, 1600), alt: photo.alt })}
                    className="group block w-full overflow-hidden rounded-lg border border-app-border text-left"
                  >
                    <img src={photoUrl(photo, 400, 300)} alt="" className="aspect-[4/3] w-full object-cover transition group-hover:scale-105" loading="lazy" />
                    <span className="block truncate px-2 py-1.5 text-xs text-app-text-muted">{photo.alt}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          {source === 'link' && (
            <div className="space-y-3">
              <label className="block text-sm font-medium text-app-text">
                Photo link
                <span className="block font-normal text-app-text-muted">A direct link to a photo, starting with https://</span>
                <input
                  value={link}
                  onChange={(e) => setLink(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      applyLink();
                    }
                  }}
                  inputMode="url"
                  placeholder="https://…/photo.jpg"
                  className="mt-1 w-full rounded-lg border border-app-border bg-app-bg px-3 py-2 text-sm text-app-text outline-none focus:border-brand-500"
                />
              </label>
              {/^https:\/\/\S+$/.test(link.trim()) && (
                <img src={link.trim()} alt="" className="max-h-48 rounded-lg border border-app-border object-contain" />
              )}
              <button type="button" onClick={applyLink} className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-brand-500 px-4 text-sm font-semibold text-slate-950 hover:bg-brand-600">
                Use this photo
              </button>
            </div>
          )}

          {error && <p role="alert" className="mt-3 rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-600">{error}</p>}
        </div>
      </div>
    </div>
  );
}
