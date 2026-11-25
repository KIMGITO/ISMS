// Website > Content > Adverts: the advert cards on the website's home page.
// "Poster" cards sit three in a row under the categories; a "strip" is a thin full-width offer bar
// (the first strip shows above the offers, a second one lower down). Each card has a colour from
// the website's own palette (the same names on both sides, from website/src/adCards.ts), short text,
// a link and an optional picture. Saved into the website draft (20261206002); the database checks
// every field when the draft is saved and again on Publish (fn_valid_ad_cards, 20261114006).
import SearchableDropdown from '../SearchableDropdown';
import { FormEvent, useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowRight, ArrowUp, Eye, EyeOff, ImagePlus, Megaphone, Plus, Save, Tag, Trash2, X } from 'lucide-react';
import UnifiedUploader from '../shared/UnifiedUploader';
import type { Industry } from '../../../website/src/engine/brand';
import OwnProductPictures, { useOwnProductPictures } from './OwnProductPictures';
import type { ShopPicture } from '../../../website/src/shopPictures';
import {
  AD_LIMITS,
  AD_TONE_ORDER,
  AD_TONES,
  AdCard,
  AdTone,
  adCardProblem,
  cleanAdCard,
  visibleAdCards,
} from '../../../website/src/adCards';

const inputClass =
  'w-full rounded-lg border border-app-border bg-app-bg px-3 py-2 text-sm text-app-text outline-none focus:border-brand-500';
const primaryClass =
  'inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-brand-500 px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-brand-600 disabled:opacity-50';
const secondaryClass =
  'inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-app-border px-3 py-2 text-sm font-semibold text-app-text transition hover:bg-app-bg disabled:opacity-50';
const iconClass =
  'grid size-9 place-items-center rounded-lg border border-app-border text-app-text transition hover:bg-app-bg disabled:opacity-40';
const cardClass = 'rounded-xl border border-app-border bg-app-card p-4';

/** Pages a card can open. "Other" lets staff type any page on the site or an https address. */
const LINK_CHOICES = [
  { href: '/shop', label: 'Shop (all products)' },
  { href: '/shop?offers=1', label: 'Offers' },
  { href: '/account/schedules', label: 'Regular orders' },
  { href: '/account/rewards', label: 'Rewards & points' },
  { href: '/articles', label: 'Guides' },
  { href: '/delivery', label: 'Delivery & pickup' },
  { href: '/contact', label: 'Contact us' },
];

const newId = () => `ad-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
/** The built-in cards as the website shows them: posters carry the shop's own product photos. */
const copyDefaults = (pictures: readonly ShopPicture[], industry?: Industry) => visibleAdCards([], pictures, industry).map((c) => ({ ...c }));

/** A small copy of the card as the website draws it, in the website's colours and font. */
function CardPreview({ card }: { card: AdCard }) {
  const tone = AD_TONES[card.tone ?? (card.kind === 'strip' ? 'ember' : 'cream')];
  const font = 'Poppins, ui-sans-serif, system-ui, sans-serif';
  if (card.kind === 'strip') {
    return (
      <div className="flex min-h-14 items-center gap-3 rounded-xl px-4 py-2.5" style={{ background: tone.bg, color: tone.text, fontFamily: font, opacity: card.hidden ? 0.5 : 1 }}>
        <Tag size={18} style={{ color: tone.kicker }} />
        <span className="min-w-0 flex-1 leading-tight">
          {card.kicker && <span className="mr-2 text-[11px] font-semibold uppercase tracking-wide" style={{ color: tone.kicker }}>{card.kicker}</span>}
          <span className="text-sm font-semibold">{card.title || 'Your offer'}</span>
        </span>
        {card.ctaLabel && <span className="rounded-full px-3 py-1 text-xs font-semibold" style={{ background: tone.button, color: tone.buttonText }}>{card.ctaLabel}</span>}
      </div>
    );
  }
  return (
    <div className="relative mx-auto flex aspect-[4/3] w-full max-w-xs overflow-hidden rounded-xl" style={{ background: tone.bg, color: tone.text, fontFamily: font, opacity: card.hidden ? 0.5 : 1 }}>
      {card.image && (
        <img src={card.image} alt="" className="absolute bottom-0 right-0 h-[78%] w-[52%]" style={{ objectFit: 'contain', objectPosition: 'bottom', filter: 'drop-shadow(0 10px 12px rgba(35,22,14,0.25))' }} />
      )}
      <div className="relative flex w-[62%] flex-col p-4">
        {card.kicker && <span className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: tone.kicker }}>{card.kicker}</span>}
        <span className="mt-1 text-lg font-semibold leading-tight">{card.title || 'Your headline'}</span>
        {card.body && <span className="mt-1 text-xs" style={{ opacity: 0.8 }}>{card.body}</span>}
        {card.ctaLabel && (
          <span className="mt-auto inline-flex w-fit items-center gap-1 rounded-full px-3 py-1 text-xs font-semibold" style={{ background: tone.button, color: tone.buttonText }}>
            {card.ctaLabel} <ArrowRight size={12} />
          </span>
        )}
      </div>
    </div>
  );
}

function CardEditor({ card, index, total, onChange, onMove, onRemove }: {
  card: AdCard;
  index: number;
  total: number;
  onChange: (next: AdCard) => void;
  onMove: (direction: -1 | 1) => void;
  onRemove: () => void;
}) {
  const known = LINK_CHOICES.some((c) => c.href === card.href);
  const [customLink, setCustomLink] = useState(!known && Boolean(card.href));
  const [stockOpen, setStockOpen] = useState(false);
  const set = (patch: Partial<AdCard>) => onChange({ ...card, ...patch });

  return (
    <section className={`${cardClass} space-y-4`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-bold text-app-text">
          Card {index + 1} <span className="font-normal text-app-text-muted">· {card.kind === 'poster' ? 'Poster' : 'Strip'}</span>
          {card.hidden && <span className="ml-2 rounded-full bg-app-bg px-2 py-0.5 text-xs font-medium text-app-text-muted">Hidden</span>}
        </h3>
        <div className="flex gap-1.5">
          <button type="button" className={iconClass} onClick={() => onMove(-1)} disabled={index === 0} aria-label="Move card up"><ArrowUp size={16} /></button>
          <button type="button" className={iconClass} onClick={() => onMove(1)} disabled={index === total - 1} aria-label="Move card down"><ArrowDown size={16} /></button>
          <button type="button" className={iconClass} onClick={() => set({ hidden: !card.hidden })} aria-label={card.hidden ? 'Show card on the website' : 'Hide card from the website'}>
            {card.hidden ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
          <button type="button" className={`${iconClass} text-red-500`} onClick={onRemove} aria-label="Delete card"><Trash2 size={16} /></button>
        </div>
      </div>

      <CardPreview card={card} />

      <div>
        <p className="text-sm font-medium text-app-text">Colour</p>
        <div className="mt-1.5 flex flex-wrap gap-2" role="radiogroup" aria-label="Card colour">
          {AD_TONE_ORDER.map((name: AdTone) => {
            const tone = AD_TONES[name];
            const selected = (card.tone ?? (card.kind === 'strip' ? 'ember' : 'cream')) === name;
            return (
              <button
                key={name}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => set({ tone: name })}
                className={`inline-flex min-h-9 items-center gap-2 rounded-full border px-3 text-xs font-semibold ${selected ? 'border-brand-500 ring-2 ring-brand-500/40' : 'border-app-border'}`}
                style={{ background: tone.bg, color: tone.text }}
              >
                {tone.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-sm font-medium text-app-text">
          Small line on top <span className="font-normal text-app-text-muted">(optional)</span>
          <input value={card.kicker ?? ''} maxLength={AD_LIMITS.kicker} onChange={(e) => set({ kicker: e.target.value })} placeholder="This week only" className={`${inputClass} mt-1`} />
        </label>
        <label className="block text-sm font-medium text-app-text">
          Headline
          <input value={card.title} maxLength={AD_LIMITS.title} onChange={(e) => set({ title: e.target.value })} placeholder="20% off snacks" className={`${inputClass} mt-1`} />
        </label>
        {card.kind === 'poster' && (
          <label className="block text-sm font-medium text-app-text sm:col-span-2">
            Short line <span className="font-normal text-app-text-muted">(optional)</span>
            <input value={card.body ?? ''} maxLength={AD_LIMITS.body} onChange={(e) => set({ body: e.target.value })} placeholder="All flavours, while stocks last." className={`${inputClass} mt-1`} />
          </label>
        )}
        <label className="block text-sm font-medium text-app-text">
          Button text <span className="font-normal text-app-text-muted">(empty: no button)</span>
          <input value={card.ctaLabel ?? ''} maxLength={AD_LIMITS.ctaLabel} onChange={(e) => set({ ctaLabel: e.target.value })} placeholder="Shop now" className={`${inputClass} mt-1`} />
        </label>
        <label className="block text-sm font-medium text-app-text">
          Card opens
          <div className="mt-1">
            <SearchableDropdown
              items={[...LINK_CHOICES.map((c) => ({ id: c.href, label: c.label })), { id: 'other', label: 'Other page or web address…' }]}
              selectedValue={customLink ? 'other' : card.href || '/shop'}
              onChange={(v) => {
                if (v === 'other') setCustomLink(true);
                else { setCustomLink(false); set({ href: v }); }
              }}
              placeholder="Choose a page"
            />
          </div>
        </label>
        {customLink && (
          <label className="block text-sm font-medium text-app-text sm:col-span-2">
            Link
            <input value={card.href ?? ''} maxLength={AD_LIMITS.href} onChange={(e) => set({ href: e.target.value })} placeholder="/shop?category=Snacks or https://wa.me/2547…" className={`${inputClass} mt-1`} />
          </label>
        )}
      </div>

      {card.kind === 'poster' && (
        <div>
          <p className="text-sm font-medium text-app-text">Picture <span className="font-normal text-app-text-muted">(optional, sits on the right)</span></p>
          <p className="text-xs text-app-text-muted">Photos without a background look best.</p>
          {card.image && (
            <div className="mt-2 flex items-center gap-3">
              <img src={card.image} alt="" className="size-16 rounded-lg border border-app-border object-contain p-1" style={{ background: 'repeating-conic-gradient(#e4e4e7 0 25%, #ffffff 0 50%) 0 0 / 12px 12px' }} />
              <button type="button" className={secondaryClass} onClick={() => set({ image: undefined })}><X size={15} /> Remove picture</button>
            </div>
          )}
          <div className="mt-2 flex flex-wrap gap-2">
            <UnifiedUploader allowedTypes={['image']} bucketName="business-logos" cropAspect={1} buttonText={card.image ? 'Change picture' : 'Upload picture'} onUploadSuccess={(url) => set({ image: url })} />
            <button type="button" className={secondaryClass} onClick={() => setStockOpen(!stockOpen)}>
              <ImagePlus size={15} /> {stockOpen ? 'Close' : 'Choose from your products'}
            </button>
          </div>
          {stockOpen && <OwnProductPictures onPick={(src) => { set({ image: src }); setStockOpen(false); }} />}
        </div>
      )}
    </section>
  );
}

/** The advert cards in the website draft. Save puts them in the draft; visitors see them after Publish. */
export default function AdCardsEditor({ saved, industry, onSave }: {
  saved: AdCard[];
  industry?: Industry;
  onSave: (next: AdCard[]) => Promise<boolean>;
}) {
  const [cards, setCards] = useState<AdCard[]>([]);
  const [usingBuiltIn, setUsingBuiltIn] = useState(false);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState('');
  const pictures = useOwnProductPictures();
  // Edits in progress are kept when the product photos arrive.
  const touched = useRef(false);
  useEffect(() => {
    touched.current = false;
    setUsingBuiltIn(saved.length === 0);
    // With nothing saved the website shows the built-in cards, so start editing from those.
    setCards(saved.length > 0 ? saved : copyDefaults(pictures, industry));
    // pictures is left out on purpose: photos arriving must not undo edits (next effect).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saved, industry]);
  useEffect(() => {
    if (saved.length === 0 && !touched.current) setCards(copyDefaults(pictures, industry));
  }, [pictures, industry, saved.length]);
  const edit = (update: (list: AdCard[]) => AdCard[]) => {
    touched.current = true;
    setCards(update);
  };

  const write = async (next: AdCard[]) => {
    setSaving(true);
    setProblem('');
    try {
      return await onSave(next);
    } finally {
      setSaving(false);
    }
  };

  const save = async (e: FormEvent) => {
    e.preventDefault();
    const issue = cards.map(adCardProblem).find(Boolean);
    if (issue) {
      setProblem(issue);
      return;
    }
    // The website only receives cards that are showing, so all hidden would look like none saved.
    if (cards.length > 0 && cards.every((c) => c.hidden)) {
      setProblem('Every card is hidden, so the website would show the built-in cards. Show at least one card.');
      return;
    }
    if (cards.length > AD_LIMITS.cards) {
      setProblem(`Up to ${AD_LIMITS.cards} cards. Delete one first.`);
      return;
    }
    await write(cards.map((c) => cleanAdCard(c, newId)));
  };

  const resetToBuiltIn = () => write([]);

  const add = (kind: AdCard['kind']) =>
    edit((list) => [...list, { id: newId(), kind, title: '', tone: kind === 'strip' ? 'ember' : 'butter', ctaLabel: 'Shop now', href: '/shop' }]);

  const move = (index: number, direction: -1 | 1) => {
    const next = [...cards];
    const target = index + direction;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    edit(() => next);
  };

  const full = cards.length >= AD_LIMITS.cards;
  return (
    <form onSubmit={save} className="space-y-4">
      <section className={`${cardClass} space-y-2`}>
        <h3 className="flex items-center gap-2 font-bold text-app-text"><Megaphone size={16} /> Adverts on the home page</h3>
        <p className="text-sm text-app-text-muted">
          Posters show three in a row under the categories (customers swipe them on phones). A strip is a thin offer bar across the page.
          {usingBuiltIn && ' The website is showing the built-in cards for your kind of business. Change them and save to use your own.'}
        </p>
        <div className="flex flex-wrap gap-2 pt-1">
          <button type="button" className={secondaryClass} onClick={() => add('poster')} disabled={full}><Plus size={15} /> Add poster</button>
          <button type="button" className={secondaryClass} onClick={() => add('strip')} disabled={full}><Plus size={15} /> Add strip</button>
          {!usingBuiltIn && <button type="button" className={secondaryClass} onClick={resetToBuiltIn} disabled={saving}>Use the built-in cards</button>}
        </div>
      </section>

      <div className="grid gap-4 xl:grid-cols-2 xl:items-start">
        {cards.map((card, index) => (
          <CardEditor
            key={card.id || index}
            card={card}
            index={index}
            total={cards.length}
            onChange={(next) => edit((list) => list.map((c, i) => (i === index ? next : c)))}
            onMove={(direction) => move(index, direction)}
            onRemove={() => edit((list) => list.filter((_, i) => i !== index))}
          />
        ))}
      </div>

      {problem && <p className="text-sm font-medium text-red-500" role="alert">{problem}</p>}
      <div className="sticky bottom-3 flex justify-end">
        <button type="submit" disabled={saving} className={`${primaryClass} shadow-lg`}><Save size={16} /> {saving ? 'Saving…' : 'Save to draft'}</button>
      </div>
    </form>
  );
}
