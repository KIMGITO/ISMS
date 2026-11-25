// Website > Design: the look. A design approach (preset) sets fonts, shapes, spacing and picture
// treatment together; each can then be changed on its own. "Automatic" means: from the design.
// Fonts come only from the website's allow-list (engine/brand.ts FONTS = fn_website_fonts()).
import { useMemo } from 'react';
import { Check, Save, Undo2 } from 'lucide-react';
import { Segmented } from '../../components/shared/Choice';
import SearchableDropdown from '../../components/SearchableDropdown';
import { FONTS, fontStack, INDUSTRIES, PERSONALITIES, PresetId } from '../../../website/src/engine/brand';
import { PRESETS } from '../../../website/src/engine/presets';
import { presetFor } from '../../../website/src/engine/tokens';
import { toPublicBrand, type BrandRecord } from '../../services/websiteBrand';
import { useBusinessStore } from '../../stores/businessStore';
import { BrandPreview, cardClass, labelClass, primaryClass, ScreenHeading, secondaryClass, useLocalPart, useSaveToDraft } from './ui';
import { useWebsiteDraft } from './useWebsiteDraft';

const AUTO = 'auto';

/** A row of choices where "Automatic" stands for "from the design" (saved as empty). */
function Choice<K extends keyof BrandRecord>({ label, field, options, brand, onChange, current }: {
  label: string;
  field: K;
  options: { id: string; label: string }[];
  brand: BrandRecord;
  onChange: (field: K, value: BrandRecord[K]) => void;
  current: string;
}) {
  const value = brand[field] == null ? AUTO : String(brand[field]);
  return (
    <div className={labelClass}>
      {label}
      <Segmented
        className="mt-1"
        size="sm"
        ariaLabel={label}
        options={[{ id: AUTO, label: `Automatic (${current})` }, ...options]}
        value={value}
        onChange={(v) => onChange(field, (v === AUTO ? null : field === 'heading_weight' ? Number(v) : v) as BrandRecord[K])}
      />
    </div>
  );
}

export default function DesignScreen() {
  const name = useBusinessStore((s) => s.businesses.find((b) => b.id === s.activeBusinessId)?.name ?? 'Your shop');
  const part = useLocalPart('brand');
  const doc = useWebsiteDraft((s) => s.draft!.document);
  const busy = useWebsiteDraft((s) => s.busy);
  const save = useSaveToDraft();
  const b = part.value;
  const set = <K extends keyof BrandRecord>(key: K, value: BrandRecord[K]) => part.setValue({ ...b, [key]: value });
  const preview = useMemo(() => ({ ...doc, brand: b }), [doc, b]);
  // What "Automatic" resolves to, from the chosen design with no single overrides.
  const base = PRESETS[presetFor(toPublicBrand({ ...b }))];
  const suggested = PERSONALITIES.find((p) => p.id === INDUSTRIES.find((i) => i.id === b.industry)?.personality);
  const fontItems = (current: string) => [
    { id: AUTO, label: `Automatic (${current})` },
    ...Object.entries(FONTS).map(([font, info]) => ({ id: font, label: font, sublabel: info.kind === 'serif' ? 'Serif' : 'Sans serif' })),
  ];
  const presets: { id: string; label: string; hint: string }[] = [
    { id: AUTO, label: 'Suggested', hint: `From your personality or industry: ${PRESETS[presetFor(toPublicBrand({ ...b, design_preset: null }))].label}` },
    { id: 'original', label: 'Original', hint: 'The website\'s first look, before brand designs' },
    ...PERSONALITIES.map((p) => ({ id: p.id, label: p.label, hint: p.hint })),
  ];

  return (
    <form onSubmit={async (e) => { e.preventDefault(); await save({ brand: b }, 'Design'); }} className="space-y-4">
      <ScreenHeading
        title="Design"
        actions={part.dirty && (
          <>
            <button type="button" className={secondaryClass} onClick={part.reset}><Undo2 size={15} /> Undo changes</button>
            <button type="submit" className={primaryClass} disabled={busy !== null}><Save size={16} /> Save to draft</button>
          </>
        )}
      >
        Pick a design approach, then change single details if you want. Colours are on the Brand screen.
      </ScreenHeading>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_24rem] xl:items-start">
        <div className="space-y-4">
          <section className={`${cardClass} space-y-3`}>
            <h3 className="font-bold text-app-text">Design approach</h3>
            {suggested && <p className="text-sm text-app-text-muted">For your industry we suggest {suggested.label}: {suggested.hint.toLowerCase()}.</p>}
            <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {presets.map((p) => {
                const on = (b.design_preset ?? AUTO) === p.id;
                const font = p.id === AUTO ? null : PRESETS[p.id as PresetId].headingFont;
                return (
                  <li key={p.id}>
                    <button
                      type="button"
                      aria-pressed={on}
                      onClick={() => set('design_preset', p.id === AUTO ? null : p.id)}
                      className={`flex h-full w-full flex-col items-start gap-1 rounded-xl border p-3 text-left transition ${on ? 'border-brand-500 bg-brand-500/10' : 'border-app-border hover:bg-app-bg'}`}
                    >
                      <span className="flex w-full items-center justify-between gap-2">
                        <span className="text-base text-app-text" style={font ? { fontFamily: fontStack(font) } : undefined}>{p.label}</span>
                        {on && <Check size={16} className="text-brand-500" />}
                      </span>
                      <span className="text-xs text-app-text-muted">{p.hint}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>

          <section className={`${cardClass} space-y-3`}>
            <h3 className="font-bold text-app-text">Type</h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className={labelClass}>
                Headings
                <SearchableDropdown className="mt-1" placeholder="Font" selectedValue={b.heading_font ?? AUTO} onChange={(v) => set('heading_font', v === AUTO ? null : v)} items={fontItems(base.headingFont)} />
              </label>
              <label className={labelClass}>
                Text
                <SearchableDropdown className="mt-1" placeholder="Font" selectedValue={b.body_font ?? AUTO} onChange={(v) => set('body_font', v === AUTO ? null : v)} items={fontItems(base.bodyFont)} />
              </label>
            </div>
            <Choice label="Heading weight" field="heading_weight" brand={b} onChange={set} current={String(base.headingWeight)}
              options={[{ id: '400', label: 'Light' }, { id: '600', label: 'Medium' }, { id: '700', label: 'Bold' }, { id: '800', label: 'Heavy' }]} />
          </section>

          <section className={`${cardClass} space-y-3`}>
            <h3 className="font-bold text-app-text">Shapes and spacing</h3>
            <Choice label="Corners" field="corner_style" brand={b} onChange={set} current={base.corners === 'original' ? 'Original' : base.corners}
              options={[{ id: 'square', label: 'Square' }, { id: 'soft', label: 'Soft' }, { id: 'round', label: 'Round' }]} />
            <Choice label="Buttons" field="button_style" brand={b} onChange={set} current={base.buttons}
              options={[{ id: 'solid', label: 'Solid' }, { id: 'outline', label: 'Outline' }, { id: 'pill', label: 'Pill' }]} />
            <Choice label="Spacing" field="density" brand={b} onChange={set} current={base.density}
              options={[{ id: 'compact', label: 'Compact' }, { id: 'comfortable', label: 'Comfortable' }, { id: 'airy', label: 'Airy' }]} />
          </section>

          <section className={`${cardClass} space-y-3`}>
            <h3 className="font-bold text-app-text">Pictures</h3>
            <Choice label="Product pictures" field="image_style" brand={b} onChange={set} current="for your industry"
              options={[{ id: 'cutout', label: 'Whole product' }, { id: 'photo', label: 'Fill the frame' }]} />
            <Choice label="Picture shape" field="image_ratio" brand={b} onChange={set} current="for your industry"
              options={[{ id: 'square', label: 'Square' }, { id: 'portrait', label: 'Tall' }, { id: 'landscape', label: 'Wide' }]} />
          </section>
        </div>

        <aside className="space-y-2 xl:sticky xl:top-4">
          <h3 className="text-sm font-bold text-app-text">Preview</h3>
          <BrandPreview doc={preview} name={name} />
        </aside>
      </div>
    </form>
  );
}
