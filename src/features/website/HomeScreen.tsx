// Website > Home page: the order of the home page's sections, how each looks and its heading.
// Starts from the layout suggested for the brand (engine/layout.ts defaultHome); "Use the
// suggested layout" saves nothing, so the home page keeps following the brand when that changes.
// Sections that have nothing to show (no reviews yet, no guides) stay hidden on the website by
// themselves, so the outline says so instead of pretending they are there.
import { useMemo } from 'react';
import { ArrowDown, ArrowUp, Eye, EyeOff, RotateCcw, Save, Undo2 } from 'lucide-react';
import { Segmented } from '../../components/shared/Choice';
import {
  composeHome,
  defaultHome,
  HOME_LIMITS,
  HomeSection,
  normaliseHome,
  SECTION_INFO,
  SECTION_KINDS,
  SECTION_VARIANTS,
  sectionWords,
  VARIANT_LABELS,
} from '../../../website/src/engine/layout';
import { toPublicBrand } from '../../services/websiteBrand';
import { cardClass, inputClass, primaryClass, ScreenHeading, secondaryClass, useLocalPart, useSaveToDraft } from './ui';
import { useWebsiteDraft } from './useWebsiteDraft';

export default function HomeScreen() {
  const part = useLocalPart('home');
  const brandRecord = useWebsiteDraft((s) => s.draft!.document.brand);
  const busy = useWebsiteDraft((s) => s.busy);
  const save = useSaveToDraft();
  const brand = useMemo(() => toPublicBrand(brandRecord), [brandRecord]);
  const suggested = useMemo(() => defaultHome(brand), [brand]);
  // What the editor shows: the saved arrangement, or the suggested one to start from.
  const sections: HomeSection[] = part.value ? normaliseHome(part.value) : suggested;
  const resolved = useMemo(() => composeHome(brand, sections), [brand, sections]);
  const words = sectionWords(brand);
  const missing = SECTION_KINDS.filter((k) => !sections.some((s) => s.kind === k));
  const following = part.value === null;

  const update = (next: HomeSection[]) => part.setValue(next.slice(0, HOME_LIMITS.sections));
  const change = (index: number, patch: Partial<HomeSection>) =>
    update(sections.map((s, i) => (i === index ? { ...s, ...patch } : s)));
  const move = (index: number, by: -1 | 1) => {
    const next = [...sections];
    const to = index + by;
    if (to < 0 || to >= next.length) return;
    [next[index], next[to]] = [next[to], next[index]];
    update(next);
  };

  return (
    <form onSubmit={async (e) => { e.preventDefault(); await save({ home: part.value && part.value.length > 0 ? normaliseHome(part.value) : null }, 'Home page'); }} className="space-y-4">
      <ScreenHeading
        title="Home page"
        actions={part.dirty && (
          <>
            <button type="button" className={secondaryClass} onClick={part.reset}><Undo2 size={15} /> Undo changes</button>
            <button type="submit" className={primaryClass} disabled={busy !== null}><Save size={16} /> Save to draft</button>
          </>
        )}
      >
        {following
          ? 'Your home page follows the layout suggested for your industry and design. Change anything below to make it your own.'
          : 'Your own layout. Sections with nothing to show (no reviews or guides yet) stay hidden on the website by themselves.'}
      </ScreenHeading>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_18rem] xl:items-start">
        <ol className="space-y-2">
          {sections.map((section, index) => {
            const info = SECTION_INFO[section.kind];
            const variants = SECTION_VARIANTS[section.kind];
            const shown = resolved.find((r) => r.kind === section.kind);
            const defaultTitle = (words as unknown as Record<string, string>)[section.kind] ?? '';
            return (
              <li key={section.kind} className={`${cardClass} space-y-2 ${section.hidden ? 'opacity-60' : ''}`}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-semibold text-app-text">{index + 1}. {info.label}</p>
                    <p className="text-xs text-app-text-muted">{info.hint}</p>
                  </div>
                  <div className="flex gap-1">
                    <button type="button" className={secondaryClass} aria-label={`Move ${info.label} up`} disabled={index === 0} onClick={() => move(index, -1)}><ArrowUp size={15} /></button>
                    <button type="button" className={secondaryClass} aria-label={`Move ${info.label} down`} disabled={index === sections.length - 1} onClick={() => move(index, 1)}><ArrowDown size={15} /></button>
                    <button type="button" className={secondaryClass} aria-pressed={!section.hidden} aria-label={section.hidden ? `Show ${info.label}` : `Hide ${info.label}`} onClick={() => change(index, { hidden: !section.hidden })}>
                      {section.hidden ? <EyeOff size={15} /> : <Eye size={15} />}
                    </button>
                  </div>
                </div>
                {!section.hidden && (
                  <div className="grid gap-2 sm:grid-cols-[auto_minmax(0,1fr)] sm:items-center">
                    {variants.length > 1 && (
                      <Segmented
                        size="sm"
                        ariaLabel={`${info.label}: look`}
                        options={variants.map((v) => ({ id: v, label: VARIANT_LABELS[v] ?? v }))}
                        value={section.variant && variants.includes(section.variant) ? section.variant : (shown?.variant ?? variants[0])}
                        onChange={(v) => change(index, { variant: v })}
                      />
                    )}
                    {defaultTitle && (
                      <input
                        aria-label={`${info.label}: heading`}
                        maxLength={HOME_LIMITS.title}
                        value={section.title ?? ''}
                        placeholder={defaultTitle}
                        onChange={(e) => change(index, { title: e.target.value || undefined })}
                        className={inputClass}
                      />
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ol>

        <aside className="space-y-3 xl:sticky xl:top-4">
          {missing.length > 0 && (
            <section className={`${cardClass} space-y-2`}>
              <h3 className="text-sm font-bold text-app-text">Add a section</h3>
              <ul className="flex flex-wrap gap-1.5">
                {missing.map((kind) => (
                  <li key={kind}>
                    <button type="button" title={SECTION_INFO[kind].hint} className="rounded-full border border-app-border px-3 py-1.5 text-xs font-medium text-app-text hover:bg-app-bg" onClick={() => update([...sections, { kind }])}>
                      + {SECTION_INFO[kind].label}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {!following && (
            <button type="button" className={`${secondaryClass} w-full`} onClick={() => part.setValue(null)}>
              <RotateCcw size={15} /> Use the suggested layout
            </button>
          )}
          <section className={`${cardClass} space-y-1`}>
            <h3 className="text-sm font-bold text-app-text">Outline</h3>
            <ol className="space-y-1">
              {resolved.map((r) => (
                <li key={r.kind} className={`rounded-md bg-app-bg px-2 ${r.kind === 'hero' ? 'py-4' : 'py-1.5'} text-xs text-app-text`}>
                  <span className="font-medium">{r.title || SECTION_INFO[r.kind].label}</span>
                  {SECTION_VARIANTS[r.kind].length > 1 && <span className="text-app-text-muted"> · {VARIANT_LABELS[r.variant] ?? r.variant}</span>}
                </li>
              ))}
            </ol>
          </section>
        </aside>
      </div>
    </form>
  );
}
