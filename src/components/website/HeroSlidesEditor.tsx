// Online Store > Home banner: the slides at the top of the website's home page.
// Each slide has a headline, a short line, a button (label + where it goes) and 1 to 3 product
// pictures. Pictures upload through the app's uploader, which can remove the background so the
// product stands on the banner like a shop display. Saved to website_settings.hero_slides; the
// database checks every field again (fn_valid_hero_slides, migrations 20261111002 + 20261112004).
// Pictures can be dragged and zoomed anywhere in the display; their boxes are saved as positions.
import { FormEvent, KeyboardEvent, PointerEvent, useCallback, useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, Eye, EyeOff, ImagePlus, Minus, Move, Plus, RotateCcw, Save, Trash2, X, ZoomIn } from 'lucide-react';
import UnifiedUploader from '../shared/UnifiedUploader';
import { getSupabase } from '../../services/supabaseClient';
import { useNotificationStore } from '../../stores/notificationStore';
import { toUserMessage } from '../../utils/userError';
import {
  DEFAULT_HERO_SLIDES,
  HERO_DRAW_ORDER,
  HERO_LIMITS,
  HERO_STOCK_IMAGES,
  HeroBox,
  HeroSlide,
  clampHeroBox,
  defaultHeroBoxes,
  heroBoxStyle,
  heroBoxes,
  isSafeHeroImage,
  isValidHeroBox,
  safeHref,
} from '../../../website/src/heroSlides';

const inputClass =
  'w-full rounded-lg border border-app-border bg-app-bg px-3 py-2 text-sm text-app-text outline-none focus:border-brand-500';
const primaryClass =
  'inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-brand-500 px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-brand-600 disabled:opacity-50';
const secondaryClass =
  'inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-app-border px-3 py-2 text-sm font-semibold text-app-text transition hover:bg-app-bg disabled:opacity-50';
const iconClass =
  'grid size-9 place-items-center rounded-lg border border-app-border text-app-text transition hover:bg-app-bg disabled:opacity-40';
const cardClass = 'rounded-xl border border-app-border bg-app-card p-4';

/** Pages a button can open. "Other" lets staff type any page on the site or an https address. */
const LINK_CHOICES = [
  { href: '/shop', label: 'Shop (all products)' },
  { href: '/account/schedules', label: 'Regular orders' },
  { href: '/account/rewards', label: 'Rewards & points' },
  { href: '/articles', label: 'Milk guides' },
  { href: '/reviews', label: 'Customer reviews' },
  { href: '/delivery', label: 'Delivery & pickup' },
  { href: '/contact', label: 'Contact us' },
  { href: '/help', label: 'Help & FAQs' },
];

const newId = () => `slide-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/** The same checks as the database, worded for staff. Returns a problem, or '' when the slide is fine. */
function slideProblem(slide: HeroSlide, index: number): string {
  const name = `Slide ${index + 1}`;
  if (!slide.title.trim()) return `${name} needs a headline.`;
  if (slide.images.length === 0) return `${name} needs at least one picture.`;
  if (slide.images.some((src) => !isSafeHeroImage(src))) return `${name} has a picture that isn't stored securely (https). Upload it again.`;
  if (slide.ctaLabel?.trim() && safeHref(slide.ctaHref) !== (slide.ctaHref ?? '').trim()) {
    return `${name}: the button link must be a page on the site (starting with /) or an address starting with https://.`;
  }
  return '';
}

/** Trims text and drops empty optional fields, so only clean data is saved. */
function cleanSlide(slide: HeroSlide): HeroSlide {
  const out: HeroSlide = { id: slide.id || newId(), title: slide.title.trim(), images: slide.images.slice(0, HERO_LIMITS.images) };
  if (slide.body?.trim()) out.body = slide.body.trim();
  if (slide.ctaLabel?.trim()) {
    out.ctaLabel = slide.ctaLabel.trim();
    out.ctaHref = (slide.ctaHref ?? '/shop').trim() || '/shop';
  }
  if (slide.positions && slide.positions.length === out.images.length && slide.positions.every(isValidHeroBox)) {
    out.positions = slide.positions.map(clampHeroBox);
  }
  if (slide.hidden) out.hidden = true;
  return out;
}

/** Grows or shrinks a box around its centre, keeping its shape. */
function zoomBox(box: HeroBox, factor: number): HeroBox {
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  let w = box.w * factor;
  let h = box.h * factor;
  // Stop at the size limits without bending the shape.
  const limit = Math.min(200 / Math.max(w, h), 1) * Math.max(8 / Math.min(w, h), 1);
  w *= limit;
  h *= limit;
  return clampHeroBox({ x: cx - w / 2, y: cy - h / 2, w, h });
}

/**
 * The picture area of the banner, where staff place pictures freely: drag one to move it, scroll
 * or pinch to zoom it, or select it and use the arrow keys and + / -. Positions are percentages of
 * the square, so the website draws the same layout at every screen size.
 */
function ArrangeDisplay({ slide, onPositions }: { slide: HeroSlide; onPositions: (boxes: HeroBox[]) => void }) {
  const boxes = heroBoxes(slide.images.length, slide.positions);
  const [selected, setSelected] = useState<number | null>(null);
  const areaRef = useRef<HTMLDivElement>(null);
  const boxesRef = useRef(boxes);
  boxesRef.current = boxes;
  const onPositionsRef = useRef(onPositions);
  onPositionsRef.current = onPositions;
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  // Pointers currently down, and what the gesture started from.
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ index: number; start: HeroBox; px: number; py: number; distance: number } | null>(null);

  const update = (index: number, box: HeroBox) => {
    onPositionsRef.current(boxesRef.current.map((b, i) => (i === index ? clampHeroBox(box) : b)));
  };

  // Wheel zoom needs a non-passive listener so the page doesn't scroll at the same time.
  useEffect(() => {
    const area = areaRef.current;
    if (!area) return;
    const onWheel = (e: WheelEvent) => {
      const index = selectedRef.current;
      if (index === null || !boxesRef.current[index]) return;
      e.preventDefault();
      const next = zoomBox(boxesRef.current[index], e.deltaY < 0 ? 1.06 : 1 / 1.06);
      onPositionsRef.current(boxesRef.current.map((b, i) => (i === index ? next : b)));
    };
    area.addEventListener('wheel', onWheel, { passive: false });
    return () => area.removeEventListener('wheel', onWheel);
  }, []);

  const toPercent = (dx: number, dy: number) => {
    const rect = areaRef.current?.getBoundingClientRect();
    if (!rect || !rect.width) return { dx: 0, dy: 0 };
    return { dx: (dx / rect.width) * 100, dy: (dy / rect.height) * 100 };
  };

  const pinchDistance = () => {
    const [a, b] = [...pointers.current.values()];
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  };

  const onImageDown = (e: PointerEvent, index: number) => {
    e.preventDefault();
    e.stopPropagation();
    if (gesture.current) {
      onAreaDown(e);
      return;
    }
    setSelected(index);
    areaRef.current?.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    gesture.current = { index, start: boxesRef.current[index], px: e.clientX, py: e.clientY, distance: pinchDistance() };
  };

  const onAreaDown = (e: PointerEvent) => {
    // A second finger anywhere on the display pinches the picture being moved.
    if (gesture.current) {
      areaRef.current?.setPointerCapture(e.pointerId);
      pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      gesture.current = { ...gesture.current, start: boxesRef.current[gesture.current.index], px: e.clientX, py: e.clientY, distance: pinchDistance() };
    } else {
      setSelected(null);
    }
  };

  const onMove = (e: PointerEvent) => {
    const g = gesture.current;
    if (!g || !pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size >= 2 && g.distance > 0) {
      update(g.index, zoomBox(g.start, pinchDistance() / g.distance));
    } else if (pointers.current.size === 1) {
      const { dx, dy } = toPercent(e.clientX - g.px, e.clientY - g.py);
      update(g.index, { ...g.start, x: g.start.x + dx, y: g.start.y + dy });
    }
  };

  const onUp = (e: PointerEvent) => {
    pointers.current.delete(e.pointerId);
    const g = gesture.current;
    if (!g) return;
    const rest = [...pointers.current.values()][0];
    // Lifting one finger of a pinch carries on as a drag from where things are now.
    gesture.current = rest ? { index: g.index, start: boxesRef.current[g.index], px: rest.x, py: rest.y, distance: 0 } : null;
  };

  const onKey = (e: KeyboardEvent) => {
    if (!boxes.length) return;
    // Tab focuses the display; the main picture is the one the keys move until another is picked.
    const index = selected !== null && boxes[selected] ? selected : 0;
    const step = e.shiftKey ? 5 : 1;
    const box = boxes[index];
    const moves: Record<string, HeroBox> = {
      ArrowLeft: { ...box, x: box.x - step },
      ArrowRight: { ...box, x: box.x + step },
      ArrowUp: { ...box, y: box.y - step },
      ArrowDown: { ...box, y: box.y + step },
      '+': zoomBox(box, 1.06),
      '=': zoomBox(box, 1.06),
      '-': zoomBox(box, 1 / 1.06),
    };
    const next = moves[e.key];
    if (!next) return;
    e.preventDefault();
    setSelected(index);
    update(index, next);
  };

  const zoomSelected = (factor: number) => {
    if (selected !== null && boxes[selected]) update(selected, zoomBox(boxes[selected], factor));
  };

  return (
    <div className="w-full">
      <div
        ref={areaRef}
        tabIndex={slide.images.length ? 0 : -1}
        onKeyDown={onKey}
        onPointerDown={onAreaDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        aria-label="Picture layout. Drag a picture to move it, scroll or pinch to resize it, or use the arrow keys and + / -."
        className="relative mx-auto aspect-square w-full max-w-[16rem] touch-none select-none rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
        style={{ backgroundImage: 'linear-gradient(rgba(35,22,14,0.06) 1px, transparent 1px), linear-gradient(90deg, rgba(35,22,14,0.06) 1px, transparent 1px)', backgroundSize: '25% 25%', outline: '1px dashed #ead9c1' }}
      >
        {slide.images.length === 0 && (
          <div className="grid size-full place-items-center rounded-lg border-2 border-dashed text-xs" style={{ borderColor: '#ead9c1', color: '#7a6858' }}>
            Add a picture
          </div>
        )}
        {HERO_DRAW_ORDER.filter((i) => i < slide.images.length).map((i) => (
          <div
            key={`${i}-${slide.images[i]}`}
            onPointerDown={(e) => onImageDown(e, i)}
            className="cursor-grab active:cursor-grabbing"
            style={{ ...heroBoxStyle(boxes[i]), outline: selected === i ? '2px solid #c2571a' : 'none', outlineOffset: 2, borderRadius: 6 }}
          >
            <img
              src={slide.images[i]}
              alt=""
              draggable={false}
              className="pointer-events-none size-full"
              style={{ objectFit: 'contain', objectPosition: 'bottom', filter: 'drop-shadow(0 10px 12px rgba(35,22,14,0.22))' }}
            />
          </div>
        ))}
      </div>
      {slide.images.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center justify-center gap-1.5 text-xs" style={{ color: '#7a6858' }}>
          {selected === null ? (
            <span className="inline-flex items-center gap-1"><Move size={13} /> Drag a picture to move it</span>
          ) : (
            <>
              <button type="button" onClick={() => zoomSelected(1 / 1.1)} className="grid size-7 place-items-center rounded-full bg-white shadow" aria-label="Make picture smaller"><Minus size={14} /></button>
              <span className="inline-flex items-center gap-1"><ZoomIn size={13} /> Scroll or pinch to resize</span>
              <button type="button" onClick={() => zoomSelected(1.1)} className="grid size-7 place-items-center rounded-full bg-white shadow" aria-label="Make picture bigger"><Plus size={14} /></button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/** A small copy of the website banner, laid out with the same rules, so staff see what customers get. */
function SlidePreview({ slide, onPositions }: { slide: HeroSlide; onPositions: (boxes: HeroBox[]) => void }) {
  return (
    <div
      className="grid grid-cols-[1fr_1.2fr] items-center gap-3 overflow-hidden rounded-xl p-4"
      style={{ background: '#f6eee2', color: '#23160e', fontFamily: 'Poppins, ui-sans-serif, system-ui, sans-serif', opacity: slide.hidden ? 0.5 : 1 }}
    >
      <div className="min-w-0">
        <p className="text-base font-medium leading-tight sm:text-lg">{slide.title || 'Your headline'}</p>
        {slide.body?.trim() && <p className="mt-1 text-xs" style={{ color: '#7a6858' }}>{slide.body}</p>}
        {slide.ctaLabel?.trim() && (
          <span className="mt-3 inline-block rounded-full px-3 py-1.5 text-xs font-medium text-white" style={{ background: '#c2571a' }}>
            {slide.ctaLabel}
          </span>
        )}
      </div>
      <ArrangeDisplay slide={slide} onPositions={onPositions} />
    </div>
  );
}

export function SlideCard({ slide, index, total, onChange, onMove, onRemove }: {
  slide: HeroSlide;
  index: number;
  total: number;
  onChange: (next: HeroSlide) => void;
  onMove: (direction: -1 | 1) => void;
  onRemove: () => void;
}) {
  const [stockOpen, setStockOpen] = useState(false);
  const knownLink = LINK_CHOICES.some((c) => c.href === slide.ctaHref);
  const [customLink, setCustomLink] = useState(!knownLink && Boolean(slide.ctaHref));
  const set = (patch: Partial<HeroSlide>) => onChange({ ...slide, ...patch });
  const full = slide.images.length >= HERO_LIMITS.images;
  const roles = ['Main product', 'Left, behind', 'Small, in front'];
  // A new picture starts where the automatic layout would put it; pictures already placed stay put.
  const addImage = (src: string) => {
    const images = [...slide.images, src].slice(0, HERO_LIMITS.images);
    const positions = slide.positions && slide.positions.length === slide.images.length
      ? [...slide.positions, defaultHeroBoxes(images.length)[images.length - 1]].slice(0, images.length)
      : undefined;
    set({ images, positions });
  };

  return (
    <section className={`${cardClass} space-y-4`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-bold text-app-text">
          Slide {index + 1}
          {slide.hidden && <span className="ml-2 rounded-full bg-app-bg px-2 py-0.5 text-xs font-medium text-app-text-muted">Hidden</span>}
        </h3>
        <div className="flex gap-1.5">
          <button type="button" className={iconClass} onClick={() => onMove(-1)} disabled={index === 0} aria-label="Move slide up"><ArrowUp size={16} /></button>
          <button type="button" className={iconClass} onClick={() => onMove(1)} disabled={index === total - 1} aria-label="Move slide down"><ArrowDown size={16} /></button>
          <button type="button" className={iconClass} onClick={() => set({ hidden: !slide.hidden })} aria-label={slide.hidden ? 'Show slide on the website' : 'Hide slide from the website'}>
            {slide.hidden ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
          <button type="button" className={`${iconClass} text-red-500`} onClick={onRemove} aria-label="Delete slide"><Trash2 size={16} /></button>
        </div>
      </div>

      <SlidePreview slide={slide} onPositions={(positions) => set({ positions })} />
      {slide.positions && (
        <div className="-mt-2 flex justify-end">
          <button type="button" className={secondaryClass} onClick={() => set({ positions: undefined })}>
            <RotateCcw size={15} /> Automatic layout
          </button>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-sm font-medium text-app-text sm:col-span-2">
          Headline
          <input value={slide.title} maxLength={HERO_LIMITS.title} onChange={(e) => set({ title: e.target.value })} placeholder="Fresh Milk Daily, Delivered to Your Door" className={`${inputClass} mt-1`} />
        </label>
        <label className="block text-sm font-medium text-app-text sm:col-span-2">
          Short line <span className="font-normal text-app-text-muted">(optional, keep it short for phones)</span>
          <input value={slide.body ?? ''} maxLength={HERO_LIMITS.body} onChange={(e) => set({ body: e.target.value })} placeholder="Order online and pay with M-Pesa." className={`${inputClass} mt-1`} />
        </label>
        <label className="block text-sm font-medium text-app-text">
          Button text <span className="font-normal text-app-text-muted">(empty: no button)</span>
          <input value={slide.ctaLabel ?? ''} maxLength={HERO_LIMITS.ctaLabel} onChange={(e) => set({ ctaLabel: e.target.value })} placeholder="Explore shop" className={`${inputClass} mt-1`} />
        </label>
        <label className="block text-sm font-medium text-app-text">
          Button opens
          <select
            value={customLink ? 'other' : slide.ctaHref || '/shop'}
            onChange={(e) => {
              if (e.target.value === 'other') {
                setCustomLink(true);
              } else {
                setCustomLink(false);
                set({ ctaHref: e.target.value });
              }
            }}
            className={`${inputClass} mt-1`}
          >
            {LINK_CHOICES.map((c) => <option key={c.href} value={c.href}>{c.label}</option>)}
            <option value="other">Other page or web address…</option>
          </select>
        </label>
        {customLink && (
          <label className="block text-sm font-medium text-app-text sm:col-span-2">
            Link
            <input
              value={slide.ctaHref ?? ''}
              maxLength={HERO_LIMITS.ctaHref}
              onChange={(e) => set({ ctaHref: e.target.value })}
              placeholder="/shop?category=Yoghurt or https://wa.me/2547…"
              className={`${inputClass} mt-1`}
            />
          </label>
        )}
      </div>

      <div>
        <p className="text-sm font-medium text-app-text">Pictures <span className="font-normal text-app-text-muted">({slide.images.length} of {HERO_LIMITS.images})</span></p>
        <p className="text-xs text-app-text-muted">Photos with the background removed look best. When uploading, tap "Remove" on the crop screen. Drag and zoom the pictures in the banner above to place them.</p>
        <ul className="mt-2 grid grid-cols-3 gap-2">
          {slide.images.map((src, i) => (
            <li key={`${i}-${src}`} className="relative rounded-lg border border-app-border p-1.5" style={{ background: 'repeating-conic-gradient(#e4e4e7 0 25%, #ffffff 0 50%) 0 0 / 12px 12px' }}>
              <img src={src} alt="" className="aspect-square w-full object-contain" />
              <span className="mt-1 block rounded bg-app-card/90 px-1 text-center text-[10px] font-medium text-app-text-muted">{roles[i]}</span>
              <button
                type="button"
                onClick={() => set({ images: slide.images.filter((_, k) => k !== i), positions: slide.positions?.filter((_, k) => k !== i) })}
                className="absolute right-1 top-1 grid size-6 place-items-center rounded-full bg-app-card text-app-text shadow"
                aria-label={`Remove picture ${i + 1}`}
              >
                <X size={13} />
              </button>
            </li>
          ))}
        </ul>
        {!full && (
          <div className="mt-2 flex flex-wrap gap-2">
            <UnifiedUploader
              allowedTypes={['image']}
              bucketName="business-logos"
              cropAspect={1}
              buttonText="Upload picture"
              onUploadSuccess={(url) => addImage(url)}
            />
            <button type="button" className={secondaryClass} onClick={() => setStockOpen(!stockOpen)}>
              <ImagePlus size={15} /> {stockOpen ? 'Close' : 'Choose a ready cut-out'}
            </button>
          </div>
        )}
        {stockOpen && !full && (
          <ul className="mt-2 grid grid-cols-4 gap-2 sm:grid-cols-7">
            {HERO_STOCK_IMAGES.map((image) => (
              <li key={image.src}>
                <button
                  type="button"
                  onClick={() => addImage(image.src)}
                  className="w-full rounded-lg border border-app-border bg-app-bg p-1 hover:border-brand-500"
                  title={image.label}
                >
                  <img src={image.src} alt={image.label} className="aspect-square w-full object-contain" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

export default function HeroSlidesEditor({ businessId }: { businessId: string }) {
  const showToast = useNotificationStore((s) => s.showToast);
  const [slides, setSlides] = useState<HeroSlide[]>([]);
  const [usingBuiltIn, setUsingBuiltIn] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState('');
  const [loadError, setLoadError] = useState('');

  const load = useCallback(async () => {
    const { data, error } = await getSupabase().from('website_settings').select('hero_slides').eq('business_id', businessId).maybeSingle();
    if (error) throw error;
    const saved = (data?.hero_slides as HeroSlide[] | undefined) ?? [];
    setUsingBuiltIn(saved.length === 0);
    // With nothing saved the website shows the built-in slides, so start editing from those.
    setSlides(saved.length > 0 ? saved : DEFAULT_HERO_SLIDES.map((s) => ({ ...s, images: [...s.images] })));
    setLoaded(true);
  }, [businessId]);

  const tryLoad = useCallback(() => {
    setLoadError('');
    load().catch((err) => {
      // Never show an empty editor here: saving it would wipe slides we simply failed to read.
      setLoadError(toUserMessage(err, 'Could not load the home banner.'));
      setLoaded(true);
    });
  }, [load]);

  useEffect(() => { tryLoad(); }, [tryLoad]);

  const write = async (next: HeroSlide[], message: string) => {
    setSaving(true);
    setProblem('');
    try {
      const { error } = await getSupabase().from('website_settings').upsert({ business_id: businessId, hero_slides: next });
      if (error) throw error;
      showToast('Online Store', message, undefined, 'success');
      return true;
    } catch (err) {
      showToast('Online Store', toUserMessage(err, 'Could not save the home banner. Check each slide has a headline and a picture.'), undefined, 'error');
      return false;
    } finally {
      setSaving(false);
    }
  };

  const save = async (e: FormEvent) => {
    e.preventDefault();
    const issue = slides.map(slideProblem).find(Boolean);
    if (issue) {
      setProblem(issue);
      return;
    }
    if (slides.length > 0 && slides.every((s) => s.hidden)) {
      setProblem('Every slide is hidden. Show at least one, or delete them all to use the built-in slides.');
      return;
    }
    const cleaned = slides.map(cleanSlide);
    if (await write(cleaned, cleaned.length ? 'Home banner saved. Customers see it straight away.' : 'Home banner reset to the built-in slides.')) {
      setSlides(cleaned.length ? cleaned : DEFAULT_HERO_SLIDES.map((s) => ({ ...s, images: [...s.images] })));
      setUsingBuiltIn(cleaned.length === 0);
    }
  };

  const resetToBuiltIn = async () => {
    if (await write([], 'Home banner reset to the built-in slides.')) {
      setSlides(DEFAULT_HERO_SLIDES.map((s) => ({ ...s, images: [...s.images] })));
      setUsingBuiltIn(true);
    }
  };

  const move = (index: number, direction: -1 | 1) => {
    const next = [...slides];
    const target = index + direction;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    setSlides(next);
  };

  if (!loaded) return <p className="text-sm text-app-text-muted">Loading home banner…</p>;
  if (loadError) {
    return (
      <section className={`${cardClass} space-y-3`}>
        <h3 className="font-bold text-app-text">Home banner</h3>
        <p className="text-sm text-app-text-muted">
          {loadError} Check your connection. If this keeps happening, the database update for the home banner
          (20261111002) may not be applied yet; until then the website shows its built-in slides.
        </p>
        <button type="button" className={secondaryClass} onClick={tryLoad}><RotateCcw size={15} /> Try again</button>
      </section>
    );
  }

  return (
    <form onSubmit={save} className="space-y-4">
      <section className={`${cardClass} flex flex-wrap items-start justify-between gap-3`}>
        <div className="max-w-2xl">
          <h3 className="font-bold text-app-text">Home banner</h3>
          <p className="text-sm text-app-text-muted">
            The slides at the top of the website's home page. They move by themselves every few seconds, and customers can swipe them.
            {usingBuiltIn ? ' The website is showing the built-in slides; change anything below and save to use your own.' : ''}
          </p>
        </div>
        {!usingBuiltIn && (
          <button type="button" className={secondaryClass} onClick={resetToBuiltIn} disabled={saving}>
            <RotateCcw size={15} /> Use built-in slides
          </button>
        )}
      </section>

      {slides.map((slide, index) => (
        <SlideCard
          key={slide.id || index}
          slide={slide}
          index={index}
          total={slides.length}
          onChange={(next) => setSlides(slides.map((s, i) => (i === index ? next : s)))}
          onMove={(direction) => move(index, direction)}
          onRemove={() => setSlides(slides.filter((_, i) => i !== index))}
        />
      ))}

      {slides.length === 0 && (
        <p className={`${cardClass} text-sm text-app-text-muted`}>No slides. Saving now brings back the built-in slides.</p>
      )}

      {problem && <p role="alert" className="rounded-lg bg-red-500/10 px-3 py-2 text-sm font-medium text-red-600">{problem}</p>}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className={secondaryClass}
          disabled={slides.length >= HERO_LIMITS.slides}
          onClick={() => setSlides([...slides, { id: newId(), title: '', body: '', ctaLabel: 'Shop now', ctaHref: '/shop', images: [] }])}
        >
          <Plus size={15} /> Add slide {slides.length >= HERO_LIMITS.slides ? `(up to ${HERO_LIMITS.slides})` : ''}
        </button>
        <button type="submit" disabled={saving} className={primaryClass}>
          <Save size={16} /> {saving ? 'Saving…' : 'Save home banner'}
        </button>
      </div>
    </form>
  );
}
