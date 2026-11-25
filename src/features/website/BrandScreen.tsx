// Website > Brand: who the business is and how it presents itself. Industry and personality
// pick the starting design (Design screen); story, mission and tagline feed the home page; logo,
// colours, socials and hours appear across the site. Audience, positioning and guidelines stay
// private (never sent to the website). Saved into the draft; Publish shows it.
import React, { useMemo, useState } from 'react';
import { Copy, ImagePlus, Save, Trash2, Undo2 } from 'lucide-react';
import UnifiedUploader from '../../components/shared/UnifiedUploader';
import SearchableDropdown from '../../components/SearchableDropdown';
import { Segmented } from '../../components/shared/Choice';
import {
  INDUSTRIES,
  OpeningPeriod,
  PERSONALITIES,
  SOCIAL_NETWORKS,
  SocialNetwork,
  TONES,
  Tone,
} from '../../../website/src/engine/brand';
import { isHex } from '../../../website/src/engine/color';
import { BrandRecord, loadBrand } from '../../services/websiteBrand';
import { useBusinessStore } from '../../stores/businessStore';
import { useNotificationStore } from '../../stores/notificationStore';
import { toUserMessage } from '../../utils/userError';
import { BrandPreview, cardClass, hintClass, inputClass, labelClass, primaryClass, ScreenHeading, secondaryClass, useLocalPart, useSaveToDraft } from './ui';
import { useWebsiteDraft } from './useWebsiteDraft';

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

/** Fields copied from another shop: everything except what is specific to this branch. */
const NOT_COPIED: (keyof BrandRecord)[] = ['description', 'opening_hours'];

function TextField({ label, hint, value, onChange, max, rows }: {
  label: string; hint?: string; value: string | null; onChange: (v: string | null) => void; max: number; rows?: number;
}) {
  const text = value ?? '';
  return (
    <label className={labelClass}>
      {label}
      {hint && <span className={hintClass}>{hint}</span>}
      {rows ? (
        <textarea rows={rows} maxLength={max} value={text} onChange={(e) => onChange(e.target.value || null)} className={`${inputClass} mt-1`} />
      ) : (
        <input maxLength={max} value={text} onChange={(e) => onChange(e.target.value || null)} className={`${inputClass} mt-1`} />
      )}
      {text.length > max * 0.8 && <span className={`${hintClass} text-xs`}>{text.length} of {max} letters</span>}
    </label>
  );
}

function ColourField({ label, hint, value, onChange }: { label: string; hint: string; value: string | null; onChange: (v: string | null) => void }) {
  const [text, setText] = useState(value ?? '');
  React.useEffect(() => setText(value ?? ''), [value]);
  return (
    <div className={labelClass}>
      <span>{label}</span>
      <span className={hintClass}>{hint}</span>
      <div className="mt-1 flex items-center gap-2">
        <input
          type="color"
          aria-label={`${label}: pick`}
          value={isHex(value) ? value! : '#ffffff'}
          onChange={(e) => onChange(e.target.value.toLowerCase())}
          className="h-10 w-12 shrink-0 cursor-pointer rounded-lg border border-app-border bg-app-bg p-1"
        />
        <input
          aria-label={`${label}: code`}
          value={text}
          placeholder="Not set"
          onChange={(e) => {
            setText(e.target.value);
            if (isHex(e.target.value)) onChange(e.target.value.toLowerCase());
            if (!e.target.value.trim()) onChange(null);
          }}
          className={`${inputClass} font-mono`}
        />
        {value && (
          <button type="button" onClick={() => onChange(null)} className={secondaryClass} aria-label={`Clear ${label}`}>
            <Trash2 size={15} />
          </button>
        )}
      </div>
      {text && !isHex(text) && <span className="text-xs text-red-600">Write colours like #1f6feb.</span>}
    </div>
  );
}

function PictureField({ label, hint, value, onChange, aspect }: {
  label: string; hint: string; value: string | null; onChange: (v: string | null) => void; aspect: number | 'original';
}) {
  return (
    <div className="flex items-center gap-3">
      <div className="grid size-16 shrink-0 place-items-center overflow-hidden rounded-lg border border-app-border bg-app-bg">
        {value ? <img src={value} alt="" className="size-full object-contain" /> : <ImagePlus size={18} className="text-app-text-muted" />}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-app-text">{label}</p>
        <p className="text-xs text-app-text-muted">{hint}</p>
        <div className="mt-1.5 flex flex-wrap gap-2">
          <UnifiedUploader
            allowedTypes={['image']}
            bucketName="business-logos"
            cropAspect={aspect}
            outputWidth={600}
            title={label}
            buttonText={value ? 'Change' : 'Upload'}
            onUploadSuccess={(url) => onChange(url)}
          />
          {value && <button type="button" className={secondaryClass} onClick={() => onChange(null)}>Remove</button>}
        </div>
      </div>
    </div>
  );
}

function HoursField({ value, onChange }: { value: OpeningPeriod[]; onChange: (v: OpeningPeriod[]) => void }) {
  const byDay = (day: number) => value.find((p) => p.day === day);
  const setDay = (day: number, period: OpeningPeriod | null) =>
    onChange([...value.filter((p) => p.day !== day), ...(period ? [period] : [])].sort((a, b) => a.day - b.day));
  return (
    <ul className="divide-y divide-app-border">
      {DAYS.map((name, day) => {
        const period = byDay(day);
        return (
          <li key={name} className="flex min-h-11 flex-wrap items-center gap-2 py-1.5 text-sm">
            <span className="w-24 font-medium text-app-text">{name}</span>
            <Segmented
              size="sm"
              ariaLabel={`${name}: open or closed`}
              options={[{ id: 'open', label: 'Open' }, { id: 'closed', label: 'Closed' }]}
              value={period ? 'open' : 'closed'}
              onChange={(v) => setDay(day, v === 'open' ? { day, open: '08:00', close: '18:00' } : null)}
              className="w-40"
            />
            {period && (
              <span className="flex items-center gap-1.5">
                <input type="time" aria-label={`${name} opens`} value={period.open} onChange={(e) => setDay(day, { ...period, open: e.target.value })} className={`${inputClass} w-28`} />
                <span className="text-app-text-muted">to</span>
                <input type="time" aria-label={`${name} closes`} value={period.close === '24:00' ? '23:59' : period.close} onChange={(e) => setDay(day, { ...period, close: e.target.value })} className={`${inputClass} w-28`} />
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** Picks another shop this person manages and copies its live brand into this draft. */
function CopyFromShop({ onCopy }: { onCopy: (brand: Partial<BrandRecord>) => void }) {
  const businesses = useBusinessStore((s) => s.businesses);
  const activeId = useBusinessStore((s) => s.activeBusinessId);
  const showToast = useNotificationStore((s) => s.showToast);
  const others = businesses.filter((b) => b.id !== activeId);
  const [from, setFrom] = useState('');
  const [busy, setBusy] = useState(false);
  if (others.length === 0) return null;
  const copy = async () => {
    if (!from) return;
    setBusy(true);
    try {
      const brand = await loadBrand(from);
      const picked = Object.fromEntries(Object.entries(brand).filter(([k]) => !NOT_COPIED.includes(k as keyof BrandRecord)));
      onCopy(picked);
      showToast('Website', `Brand copied from ${others.find((b) => b.id === from)?.name}. Check it, then save.`, undefined, 'success');
    } catch (err) {
      showToast('Website', toUserMessage(err, 'Could not read that shop\'s brand.'), undefined, 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className={`${cardClass} space-y-2`}>
      <h3 className="font-bold text-app-text">Copy brand from another shop</h3>
      <p className="text-sm text-app-text-muted">For branches of one company. Copies the published brand: everything except the shop description and opening hours. Nothing is saved until you press Save.</p>
      <div className="flex flex-wrap gap-2">
        <SearchableDropdown
          className="min-w-56 flex-1"
          selectedValue={from}
          onChange={setFrom}
          placeholder="Choose a shop"
          items={others.map((b) => ({ id: b.id, label: b.name }))}
        />
        <button type="button" className={secondaryClass} disabled={!from || busy} onClick={copy}><Copy size={15} /> {busy ? 'Copying…' : 'Copy'}</button>
      </div>
    </section>
  );
}

export default function BrandScreen() {
  const name = useBusinessStore((s) => s.businesses.find((b) => b.id === s.activeBusinessId)?.name ?? 'Your shop');
  const brandPart = useLocalPart('brand');
  const contactPart = useLocalPart('contact');
  const doc = useWebsiteDraft((s) => s.draft!.document);
  const busy = useWebsiteDraft((s) => s.busy);
  const save = useSaveToDraft();
  const b = brandPart.value;
  const set = <K extends keyof BrandRecord>(key: K, value: BrandRecord[K]) => brandPart.setValue({ ...b, [key]: value });
  const preview = useMemo(() => ({ ...doc, brand: b }), [doc, b]);
  const dirty = brandPart.dirty || contactPart.dirty;

  const badSocial = SOCIAL_NETWORKS.find((n) => b.social_links[n.id] && !n.host.test(b.social_links[n.id]));
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (badSocial) return;
    await save({ brand: b, contact: contactPart.value }, 'Brand');
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <ScreenHeading
        title="Brand"
        actions={dirty && (
          <>
            <button type="button" className={secondaryClass} onClick={() => { brandPart.reset(); contactPart.reset(); }}><Undo2 size={15} /> Undo changes</button>
            <button type="submit" className={primaryClass} disabled={busy !== null || Boolean(badSocial)}><Save size={16} /> Save to draft</button>
          </>
        )}
      >
        What your business is and how it speaks. The industry and personality choose the starting design, layout and words.
      </ScreenHeading>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_24rem] xl:items-start">
        <div className="space-y-4">
          <section className={`${cardClass} space-y-3`}>
            <h3 className="font-bold text-app-text">Identity</h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className={labelClass}>
                Industry
                <span className={hintClass}>Sets the home page layout, menu and built-in words.</span>
                <SearchableDropdown
                  className="mt-1"
                  selectedValue={b.industry}
                  onChange={(v) => set('industry', v)}
                  placeholder="Choose an industry"
                  items={INDUSTRIES.map((i) => ({ id: i.id, label: i.label, sublabel: i.hint || undefined }))}
                />
              </label>
              <label className={labelClass}>
                Personality
                <span className={hintClass}>Sets fonts, shapes and spacing.</span>
                <SearchableDropdown
                  className="mt-1"
                  selectedValue={b.personality ?? 'suggested'}
                  onChange={(v) => set('personality', v === 'suggested' ? null : v)}
                  placeholder="Choose a personality"
                  items={[
                    { id: 'suggested', label: `Suggested for the industry (${PERSONALITIES.find((p) => p.id === INDUSTRIES.find((i) => i.id === b.industry)?.personality)?.label ?? 'Friendly'})` },
                    ...PERSONALITIES.map((p) => ({ id: p.id, label: p.label, sublabel: p.hint })),
                  ]}
                />
              </label>
            </div>
            <div className={labelClass}>
              Tone of voice
              <span className={hintClass}>For your own writing and the assistant's drafts. {TONES.find((t) => t.id === b.tone)?.hint}</span>
              <Segmented<Tone> className="mt-1" ariaLabel="Tone of voice" options={TONES.map((t) => ({ id: t.id, label: t.label }))} value={b.tone as Tone} onChange={(v) => set('tone', v)} />
            </div>
            <TextField label="Tagline" hint="One line under your name, e.g. on the home page opening." value={b.tagline} onChange={(v) => set('tagline', v)} max={120} />
            <TextField label="Short description" hint="Used by search engines and link previews. Two sentences." value={b.description} onChange={(v) => set('description', v)} max={1000} rows={2} />
          </section>

          <section className={`${cardClass} space-y-3`}>
            <h3 className="font-bold text-app-text">Story</h3>
            <TextField label="Mission" hint="Why the business exists, in one or two sentences." value={b.mission} onChange={(v) => set('mission', v)} max={500} rows={2} />
            <TextField label="Your story" hint="How you started and what you care about. Shown on the home page and About us." value={b.story} onChange={(v) => set('story', v)} max={4000} rows={5} />
          </section>

          <section className={`${cardClass} space-y-3`}>
            <h3 className="font-bold text-app-text">Notes for writing</h3>
            <p className="text-sm text-app-text-muted">Private: never shown on the website. They guide your team and the assistant.</p>
            <TextField label="Who you serve" value={b.audience} onChange={(v) => set('audience', v)} max={500} rows={2} />
            <TextField label="What makes you different" value={b.positioning} onChange={(v) => set('positioning', v)} max={500} rows={2} />
            <TextField label="Brand rules" hint="Words to use or avoid, how to write prices, and so on." value={b.guidelines} onChange={(v) => set('guidelines', v)} max={2000} rows={3} />
          </section>

          <section className={`${cardClass} space-y-4`}>
            <h3 className="font-bold text-app-text">Logo and colours</h3>
            <PictureField label="Logo" hint="Also on receipts and invoices." value={b.logo_url} onChange={(v) => set('logo_url', v)} aspect="original" />
            <PictureField label="Logo for dark backgrounds" hint="A white or light version, for banners." value={b.logo_light_url} onChange={(v) => set('logo_light_url', v)} aspect="original" />
            <PictureField label="Small mark" hint="A square symbol, used where the full logo is too wide." value={b.logo_mark_url} onChange={(v) => set('logo_mark_url', v)} aspect={1} />
            <PictureField label="Browser tab icon" hint="Square, simple. Without one, the small mark or logo is used." value={b.favicon_url} onChange={(v) => set('favicon_url', v)} aspect={1} />
            <div className="grid gap-3 sm:grid-cols-2">
              <ColourField label="Main colour" hint="Buttons, links and prices. Also on receipts." value={b.primary_color} onChange={(v) => set('primary_color', v)} />
              <ColourField label="Second colour" hint="Banners and the footer." value={b.secondary_color} onChange={(v) => set('secondary_color', v)} />
              <ColourField label="Accent colour" hint="Small highlights such as offer ribbons." value={b.accent_color} onChange={(v) => set('accent_color', v)} />
              <ColourField label="Page background" hint="Must be light, so text stays readable." value={b.background_color} onChange={(v) => set('background_color', v)} />
            </div>
          </section>

          <section className={`${cardClass} space-y-3`}>
            <h3 className="font-bold text-app-text">Social pages</h3>
            <div className="grid gap-3 sm:grid-cols-2">
              {SOCIAL_NETWORKS.map((n) => {
                const value = b.social_links[n.id] ?? '';
                const bad = value && !n.host.test(value);
                return (
                  <label key={n.id} className={labelClass}>
                    {n.label}
                    <input
                      value={value}
                      inputMode="url"
                      placeholder="https://"
                      onChange={(e) => {
                        const next = { ...b.social_links } as Record<SocialNetwork, string>;
                        if (e.target.value.trim()) next[n.id] = e.target.value.trim(); else delete next[n.id];
                        set('social_links', next);
                      }}
                      className={`${inputClass} mt-1`}
                    />
                    {bad && <span className="text-xs text-red-600">Paste the full address of your {n.label} page.</span>}
                  </label>
                );
              })}
            </div>
          </section>

          <section className={`${cardClass} space-y-3`}>
            <h3 className="font-bold text-app-text">Opening hours and contact</h3>
            <p className="text-sm text-app-text-muted">Shown on the home page, contact page and to search engines.</p>
            <HoursField value={b.opening_hours} onChange={(v) => set('opening_hours', v)} />
            <label className={labelClass}>
              Extra note on opening hours
              <span className={hintClass}>Optional, e.g. "Closed on public holidays". Without set hours above, this is shown instead.</span>
              <input maxLength={500} value={contactPart.value.openingHours ?? ''} onChange={(e) => contactPart.setValue({ ...contactPart.value, openingHours: e.target.value || null })} className={`${inputClass} mt-1`} />
            </label>
            <label className={labelClass}>
              WhatsApp number
              <span className={hintClass}>Empty uses the business phone.</span>
              <input inputMode="tel" placeholder="254712345678" value={contactPart.value.whatsapp ?? ''} onChange={(e) => contactPart.setValue({ ...contactPart.value, whatsapp: e.target.value || null })} className={`${inputClass} mt-1`} />
            </label>
          </section>

          <CopyFromShop onCopy={(copied) => brandPart.setValue({ ...b, ...copied })} />
        </div>

        <aside className="space-y-2 xl:sticky xl:top-4">
          <h3 className="text-sm font-bold text-app-text">Preview</h3>
          <BrandPreview doc={preview} name={name} />
        </aside>
      </div>
    </form>
  );
}
