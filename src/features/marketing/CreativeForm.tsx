// Add or change one creative: where it shows, its format, the picture or video (and phone
// version, cover, captions), its words, button text, description and focal point. Formats and
// warnings come from the same rules the website and database use.
import React, { useMemo, useState } from 'react';
import { FormSheet } from '../../components/shared/FormSheet';
import { Switch } from '../../components/shared/Switch';
import { useNotificationStore } from '../../stores/notificationStore';
import { toUserMessage } from '../../utils/userError';
import { saveCreative, updateMedia, type Creative, type CreativeDraft, type MediaItem } from '../../services/marketing';
import { FORMATS, mediaFit, PLACEMENT_ORDER, PLACEMENTS, type AdFormat, type AdPlacement } from '../../../website/src/ads/rules';
import { ChosenMedia, FocalPointPicker, MediaPicker } from './MediaPicker';
import { hintClass, inputClass, labelClass, primaryClass, secondaryClass } from './shared';

type Slot = 'media' | 'mobile' | 'poster' | 'captions';

export default function CreativeForm({ businessId, campaignId, creative, media, onMediaChanged, onClose, onSaved }: {
  businessId: string; campaignId: string; creative: Creative | null; media: Record<string, MediaItem>;
  onMediaChanged: () => void; onClose: () => void; onSaved: () => void;
}) {
  const showToast = useNotificationStore((s) => s.showToast);
  const [d, setD] = useState<CreativeDraft>(() => creative ? { ...creative } : { placement: 'hero', format: 'hero_16x9', text_position: 'left', autoplay_muted: false, hidden: false });
  const [mobileFormat, setMobileFormat] = useState<AdFormat | ''>(() => {
    const m = creative?.mobile_media_id ? media[creative.mobile_media_id] : undefined;
    if (!m || !creative) return '';
    return PLACEMENTS[creative.placement].mobile.find((f) => mediaFit(m, f) === 'ok') ?? PLACEMENTS[creative.placement].mobile[0] ?? '';
  });
  const [picking, setPicking] = useState<Slot | null>(null);
  const [extra, setExtra] = useState<Record<string, MediaItem>>({});
  const [saving, setSaving] = useState(false);
  const all = useMemo(() => ({ ...media, ...extra }), [media, extra]);
  const set = <K extends keyof CreativeDraft>(k: K, v: CreativeDraft[K]) => setD((x) => ({ ...x, [k]: v }));

  const spec = PLACEMENTS[d.placement];
  const fmt = FORMATS[d.format];
  const main = d.media_id ? all[d.media_id] : undefined;
  const isVideo = fmt.media === 'video';
  const isText = fmt.media === 'none';

  const choosePlacement = (p: AdPlacement) => {
    const keep = PLACEMENTS[p].formats.includes(d.format);
    setD((x) => ({ ...x, placement: p, format: keep ? x.format : PLACEMENTS[p].formats[0], ...(keep ? {} : { media_id: null, mobile_media_id: null, poster_media_id: null, captions_media_id: null }) }));
    if (!PLACEMENTS[p].mobile.length) setMobileFormat('');
  };
  const chooseFormat = (f: AdFormat) => {
    const kindChanged = FORMATS[f].media !== fmt.media;
    setD((x) => ({ ...x, format: f, ...(kindChanged ? { media_id: null, poster_media_id: null, captions_media_id: null, autoplay_muted: false } : {}) }));
  };

  const picked = (slot: Slot, item: MediaItem, posterId?: string) => {
    setExtra((e) => ({ ...e, [item.id]: item }));
    if (slot === 'media') {
      set('media_id', item.id);
      if (posterId && !d.poster_media_id) set('poster_media_id', posterId);
      if (!d.alt_text && item.alt_text) set('alt_text', item.alt_text);
    }
    if (slot === 'mobile') set('mobile_media_id', item.id);
    if (slot === 'poster') set('poster_media_id', item.id);
    if (slot === 'captions') set('captions_media_id', item.id);
    setPicking(null);
    onMediaChanged();
  };

  const save = async () => {
    setSaving(true);
    try {
      const payload: CreativeDraft = {
        id: creative?.id, placement: d.placement, format: d.format,
        media_id: isText ? null : d.media_id ?? null, mobile_media_id: isText ? null : d.mobile_media_id ?? null,
        poster_media_id: isVideo ? d.poster_media_id ?? null : null, captions_media_id: isVideo ? d.captions_media_id ?? null : null,
        headline: d.headline ?? '', body: d.body ?? '', cta_label: d.cta_label ?? '', alt_text: d.alt_text ?? '',
        focal_x: d.focal_x ?? null, focal_y: d.focal_y ?? null, text_position: d.text_position ?? 'left',
        autoplay_muted: isVideo && !!d.autoplay_muted, hidden: !!d.hidden,
        ...(d.mobile_media_id && mobileFormat ? { mobile_format: mobileFormat } : {}),
      };
      if (!creative) delete payload.id;
      await saveCreative(campaignId, payload);
      showToast('Creative', creative ? 'Saved.' : 'Added.', undefined, 'success');
      onSaved();
    } catch (e) {
      showToast('Creative', toUserMessage(e, 'Could not save the creative.'), undefined, 'error');
    } finally { setSaving(false); }
  };

  const focalX = d.focal_x ?? main?.focal_x ?? 50;
  const focalY = d.focal_y ?? main?.focal_y ?? 50;

  return (
    <FormSheet
      title={creative ? 'Change creative' : 'Add creative'}
      subtitle={spec.where}
      onClose={onClose}
      wide
      footer={
        <div className="flex justify-end gap-2">
          <button type="button" className={secondaryClass} onClick={onClose}>Cancel</button>
          <button type="button" className={primaryClass} disabled={saving} onClick={save}>{saving ? 'Saving…' : creative ? 'Save' : 'Add'}</button>
        </div>
      }
    >
      <div className="space-y-4">
        <div>
          <span className={labelClass}>Where it shows</span>
          <div className="mt-1 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {PLACEMENT_ORDER.map((p) => (
              <button key={p} type="button" aria-pressed={d.placement === p} onClick={() => choosePlacement(p)}
                className={`rounded-lg border px-3 py-2 text-left text-sm transition ${d.placement === p ? 'border-brand-500 bg-brand-500/10 text-app-text' : 'border-app-border text-app-text-muted hover:text-app-text'}`}>
                <span className="block font-medium">{PLACEMENTS[p].label}</span>
              </button>
            ))}
          </div>
        </div>

        {spec.formats.length > 1 && (
          <label className={labelClass}>Format
            <select className={`${inputClass} mt-1`} value={d.format} onChange={(e) => chooseFormat(e.target.value as AdFormat)}>
              {spec.formats.map((f) => <option key={f} value={f}>{FORMATS[f].label} ({FORMATS[f].shape}{FORMATS[f].minWidth ? `, ${FORMATS[f].minWidth} px wide or more` : ''})</option>)}
            </select>
          </label>
        )}

        {!isText && (
          <div className="space-y-2">
            <span className={labelClass}>{isVideo ? 'Video' : 'Picture'} <span className={hintClass}>{fmt.shape}, ideally {fmt.minWidth} px wide or more{isVideo ? ', MP4, up to 50 MB and 3 minutes' : ''}</span></span>
            <ChosenMedia item={main} format={d.format} label={isVideo ? 'Choose a video' : 'Choose a picture'} onChange={() => setPicking('media')} />
            {main?.kind === 'image' && (
              <FocalPointPicker url={main.url} x={focalX} y={focalY} onChange={(x, y) => { set('focal_x', x); set('focal_y', y); }} />
            )}
            {main?.kind === 'image' && d.focal_x != null && (
              <button type="button" className="text-xs font-medium text-brand-600 hover:underline dark:text-brand-400"
                onClick={async () => { try { await updateMedia(main.id, { focal_x: focalX, focal_y: focalY }); showToast('Media', 'Focal point kept for this picture everywhere.', undefined, 'success'); onMediaChanged(); } catch (e) { showToast('Media', toUserMessage(e, 'Could not save.'), undefined, 'error'); } }}>
                Use this focal point for the picture everywhere
              </button>
            )}
          </div>
        )}

        {!isText && spec.mobile.length > 0 && (
          <div className="space-y-2">
            <span className={labelClass}>Phone version <span className={hintClass}>Optional. Without one, phones show the same {isVideo ? 'video' : 'picture'}, cropped around its focal point.</span></span>
            <div className="flex flex-wrap gap-2">
              <select aria-label="Phone version format" className={`${inputClass} max-w-xs`} value={mobileFormat} onChange={(e) => setMobileFormat(e.target.value as AdFormat | '')}>
                <option value="">Shape of the phone version</option>
                {spec.mobile.map((f) => <option key={f} value={f}>{FORMATS[f].label} ({FORMATS[f].shape})</option>)}
              </select>
            </div>
            {mobileFormat && (
              <ChosenMedia item={d.mobile_media_id ? all[d.mobile_media_id] : undefined} format={mobileFormat} label="Choose the phone version"
                onChange={() => setPicking('mobile')} onRemove={() => set('mobile_media_id', null)} />
            )}
          </div>
        )}

        {isVideo && (
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <span className={labelClass}>Cover picture <span className={hintClass}>Shown until the video plays</span></span>
              <ChosenMedia item={d.poster_media_id ? all[d.poster_media_id] : undefined} label="Choose a cover" onChange={() => setPicking('poster')} />
            </div>
            <div className="space-y-1">
              <span className={labelClass}>Captions <span className={hintClass}>Optional .vtt file</span></span>
              <ChosenMedia item={d.captions_media_id ? all[d.captions_media_id] : undefined} label="Add captions" onChange={() => setPicking('captions')} onRemove={() => set('captions_media_id', null)} />
            </div>
            <label className="flex items-center justify-between gap-3 rounded-lg border border-app-border p-3 sm:col-span-2">
              <span className="text-sm text-app-text">Play by itself, muted, when on screen <span className={hintClass}>Never for visitors who ask for less motion or save data</span></span>
              <Switch checked={!!d.autoplay_muted} onChange={(v: boolean) => set('autoplay_muted', v)} />
            </label>
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <label className={`${labelClass} sm:col-span-2`}>{isText ? 'Message' : 'Headline'} <span className={hintClass}>{isText ? 'Short: one line on a phone' : 'Optional; leave empty when the picture already has words'}</span>
            <input className={`${inputClass} mt-1`} maxLength={90} value={d.headline ?? ''} onChange={(e) => set('headline', e.target.value)} />
          </label>
          {!isText && d.placement !== 'announcement' && (
            <label className={`${labelClass} sm:col-span-2`}>Supporting words
              <textarea className={`${inputClass} mt-1`} rows={2} maxLength={200} value={d.body ?? ''} onChange={(e) => set('body', e.target.value)} />
            </label>
          )}
          <label className={labelClass}>Button words <span className={hintClass}>Leave empty to use the campaign's</span>
            <input className={`${inputClass} mt-1`} maxLength={30} value={d.cta_label ?? ''} onChange={(e) => set('cta_label', e.target.value)} />
          </label>
          {d.placement === 'hero' && (
            <label className={labelClass}>Words on the banner
              <select className={`${inputClass} mt-1`} value={d.text_position ?? 'left'} onChange={(e) => set('text_position', e.target.value as Creative['text_position'])}>
                <option value="left">On the left</option>
                <option value="center">In the middle</option>
                <option value="right">On the right</option>
                <option value="none">None (the picture has its own words)</option>
              </select>
            </label>
          )}
          {!isText && (
            <label className={`${labelClass} sm:col-span-2`}>Picture description <span className={hintClass}>Read aloud to people who can't see it. Say what it shows and any words on it.</span>
              <input className={`${inputClass} mt-1`} maxLength={250} value={d.alt_text ?? ''} onChange={(e) => set('alt_text', e.target.value)} placeholder={main?.alt_text ?? 'Shoes and bags with 40% off labels'} />
            </label>
          )}
        </div>

        <label className="flex items-center justify-between gap-3 rounded-lg border border-app-border p-3">
          <span className="text-sm text-app-text">Hide this creative <span className={hintClass}>Keeps it and its figures without showing it</span></span>
          <Switch checked={!!d.hidden} onChange={(v: boolean) => set('hidden', v)} />
        </label>
      </div>

      {picking && (
        <MediaPicker
          businessId={businessId}
          kind={picking === 'captions' ? 'captions' : picking === 'poster' ? 'image' : isVideo && picking === 'media' ? 'video' : picking === 'mobile' && isVideo ? 'video' : 'image'}
          format={picking === 'media' ? d.format : picking === 'mobile' ? (mobileFormat || undefined) : undefined}
          title={picking === 'captions' ? 'Choose captions' : picking === 'poster' ? 'Choose a cover picture' : picking === 'mobile' ? 'Choose the phone version' : isVideo ? 'Choose a video' : 'Choose a picture'}
          onPick={(item, posterId) => picked(picking, item, posterId)}
          onClose={() => setPicking(null)}
        />
      )}
    </FormSheet>
  );
}
