// Website > Menu: the links across the top of the website. Until changed, the menu fits the
// industry (engine/navigation.ts defaultMenu). Links go to a page of the website or to a secure
// web address; the database refuses anything else (fn_valid_link).
import React, { useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, Plus, RotateCcw, Save, Trash2, Undo2 } from 'lucide-react';
import SearchableDropdown from '../../components/SearchableDropdown';
import { defaultMenu, MENU_LIMITS, MENU_PAGES, MenuLink, safeMenuHref } from '../../../website/src/engine/navigation';
import { toPublicBrand } from '../../services/websiteBrand';
import { cardClass, inputClass, labelClass, primaryClass, ScreenHeading, secondaryClass, useLocalPart, useSaveToDraft } from './ui';
import { useWebsiteDraft } from './useWebsiteDraft';

const OWN = 'own';

function LinkRow({ link, index, total, onChange, onMove, onRemove }: {
  link: MenuLink; index: number; total: number;
  onChange: (next: MenuLink) => void; onMove: (by: -1 | 1) => void; onRemove: () => void;
}) {
  const known = MENU_PAGES.find((p) => p.href === link.href);
  const [own, setOwn] = useState(!known);
  const bad = !safeMenuHref(link.href);
  return (
    <li className={`${cardClass} space-y-2`}>
      <div className="grid gap-2 sm:grid-cols-[minmax(0,12rem)_minmax(0,1fr)_auto] sm:items-end">
        <label className={labelClass}>
          Name
          <input maxLength={MENU_LIMITS.label} value={link.label} onChange={(e) => onChange({ ...link, label: e.target.value })} className={`${inputClass} mt-1`} />
        </label>
        <label className={labelClass}>
          Goes to
          <SearchableDropdown
            className="mt-1"
            placeholder="Choose a page"
            selectedValue={own ? OWN : link.href}
            onChange={(v) => {
              if (v === OWN) { setOwn(true); return; }
              setOwn(false);
              const page = MENU_PAGES.find((p) => p.href === v)!;
              onChange({ label: link.label.trim() ? link.label : page.label, href: page.href });
            }}
            items={[...MENU_PAGES.map((p) => ({ id: p.href, label: p.label, sublabel: p.href })), { id: OWN, label: 'Another address', sublabel: 'A page path or https:// link' }]}
          />
        </label>
        <div className="flex gap-1">
          <button type="button" className={secondaryClass} aria-label={`Move ${link.label} up`} disabled={index === 0} onClick={() => onMove(-1)}><ArrowUp size={15} /></button>
          <button type="button" className={secondaryClass} aria-label={`Move ${link.label} down`} disabled={index === total - 1} onClick={() => onMove(1)}><ArrowDown size={15} /></button>
          <button type="button" className={secondaryClass} aria-label={`Remove ${link.label}`} onClick={onRemove}><Trash2 size={15} /></button>
        </div>
      </div>
      {own && (
        <label className={labelClass}>
          Address
          <input value={link.href} placeholder="/articles/my-guide or https://" onChange={(e) => onChange({ ...link, href: e.target.value.trim() })} className={`${inputClass} mt-1 font-mono`} />
          {bad && <span className="text-xs text-red-600">Use a page of this website (starting with /) or a full https:// address.</span>}
        </label>
      )}
    </li>
  );
}

export default function MenuScreen() {
  const part = useLocalPart('navigation');
  const brandRecord = useWebsiteDraft((s) => s.draft!.document.brand);
  const busy = useWebsiteDraft((s) => s.busy);
  const save = useSaveToDraft();
  const brand = useMemo(() => toPublicBrand(brandRecord), [brandRecord]);
  // Offers shows on the website only while some product has a "was" price, so it is listed here.
  const suggested = useMemo(() => defaultMenu(brand, true), [brand]);
  const links = part.value?.header ?? suggested;
  const following = part.value === null;
  const problem = links.some((l) => !l.label.trim() || !safeMenuHref(l.href));

  const update = (next: MenuLink[]) => part.setValue({ header: next.slice(0, MENU_LIMITS.links) });
  const move = (index: number, by: -1 | 1) => {
    const next = [...links];
    const to = index + by;
    if (to < 0 || to >= next.length) return;
    [next[index], next[to]] = [next[to], next[index]];
    update(next);
  };
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (problem) return;
    const cleaned = part.value ? { header: part.value.header.map((l) => ({ label: l.label.trim(), href: l.href })) } : null;
    await save({ navigation: cleaned && cleaned.header.length > 0 ? cleaned : null }, 'Menu');
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <ScreenHeading
        title="Menu"
        actions={part.dirty && (
          <>
            <button type="button" className={secondaryClass} onClick={part.reset}><Undo2 size={15} /> Undo changes</button>
            <button type="submit" className={primaryClass} disabled={busy !== null || problem}><Save size={16} /> Save to draft</button>
          </>
        )}
      >
        {following
          ? 'The links across the top of your website, as suggested for your industry. Offers shows only while a product has an offer price.'
          : `Your own menu, up to ${MENU_LIMITS.links} links. On phones the same links show as buttons on the home page.`}
      </ScreenHeading>

      <ol className="space-y-2">
        {links.map((link, index) => (
          <LinkRow
            key={`${index}-${links.length}`}
            link={link}
            index={index}
            total={links.length}
            onChange={(next) => update(links.map((l, i) => (i === index ? next : l)))}
            onMove={(by) => move(index, by)}
            onRemove={() => update(links.filter((_, i) => i !== index))}
          />
        ))}
      </ol>
      {links.length === 0 && <p className={`${cardClass} text-sm text-app-text-muted`}>No links. Saving now brings back the suggested menu.</p>}
      <div className="flex flex-wrap gap-2">
        <button type="button" className={secondaryClass} disabled={links.length >= MENU_LIMITS.links} onClick={() => update([...links, { label: 'Contact', href: '/contact' }])}>
          <Plus size={15} /> Add link
        </button>
        {!following && (
          <button type="button" className={secondaryClass} onClick={() => part.setValue(null)}>
            <RotateCcw size={15} /> Use the suggested menu
          </button>
        )}
      </div>
    </form>
  );
}
