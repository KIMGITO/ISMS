// Online Store > Home banner: the slides at the top of the website's home page.
// Each slide has a headline, a short line, a button (label + where it goes) and 1 to 3 product
// pictures. Pictures upload through the app's uploader, which can remove the background so the
// product stands on the banner like a shop display. Saved to website_settings.hero_slides; the
// database checks every field again (fn_valid_hero_slides, migrations 20261111002 + 20261112004).
// Pictures can be dragged and zoomed anywhere in the display; their boxes are saved as positions.
import SearchableDropdown from '../SearchableDropdown';
import { FormEvent, KeyboardEvent, PointerEvent, useCallback, useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, Eye, EyeOff, ImagePlus, Minus, Monitor, Move, Plus, RotateCcw, Save, ShoppingCart, Smartphone, Tablet, Trash2, X, ZoomIn } from 'lucide-react';
import UnifiedUploader from '../shared/UnifiedUploader';
import { getSupabase } from '../../services/supabaseClient';
import { useNotificationStore } from '../../stores/notificationStore';
import { toUserMessage } from '../../utils/userError';
import {
  DEFAULT_HERO_SLIDES,
  HERO_DRAW_ORDER,
  HERO_LIMITS,
  HERO_PHONE_LAYOUTS,
  HERO_SIDES,
  HERO_STOCK_IMAGES,
  HeroBox,
  HeroPhoneLayout,
  HeroSide,
  HeroSlide,
  clampHeroBox,
  defaultHeroBoxes,
  heroBoxStyle,
  heroBoxes,
  heroLayout,
  isSafeHeroImage,
  isValidHeroBox,
  safeHref,
} from '../../../website/src/heroSlides';
import { AD_TONES, AD_TONE_ORDER, AdTone } from '../../../website/src/adCards';

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
  // Defaults are left out, so a slide without choices stays as small as before.
  const layout = heroLayout(slide);
  if (layout.phone !== 'beside') out.phone = layout.phone;
  if (layout.side !== 'right') out.side = layout.side;
  if (layout.tone) out.tone = slide.tone;
  if (slide.hidden) out.hidden = true;
  return out;
}

/** The layout fields, which a database without migration 20261115002 refuses. */
const hasLayoutChoices = (slide: HeroSlide) => Boolean(slide.phone || slide.side || slide.tone);
const withoutLayoutChoices = ({ phone: _p, side: _s, tone: _t, ...rest }: HeroSlide): HeroSlide => rest;

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
        className="relative mx-auto aspect-square w-full max-w-[18rem] touch-none select-none rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
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

type Device = 'phone' | 'tablet' | 'computer';

/** Screen widths the preview draws at, then shrinks to fit: a common phone, a tablet, a laptop. */
const DEVICES: { value: Device; label: string; width: number; icon: typeof Smartphone }[] = [
  { value: 'phone', label: 'Phone', width: 390, icon: Smartphone },
  { value: 'tablet', label: 'Tablet', width: 820, icon: Tablet },
  { value: 'computer', label: 'Computer', width: 1280, icon: Monitor },
];

const SAND_PANEL = {
  backgroundColor: '#f6eee2',
  backgroundImage: 'radial-gradient(circle at 1px 1px, rgb(154 67 19 / 0.09) 1.2px, transparent 0), radial-gradient(90% 90% at 80% 40%, #fbf4ea 0%, transparent 60%)',
  backgroundSize: '22px 22px, 100% 100%',
};

/**
 * The website banner drawn at a real screen width with the website's own sizes (HomePage.tsx and
 * theme.css), then scaled down to fit, so staff see what a phone, tablet or computer shows.
 */
function DevicePreview({ slide, device }: { slide: HeroSlide; device: Device }) {
  const width = DEVICES.find((d) => d.value === device)!.width;
  const outerRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState({ scale: 1, height: 0 });

  useEffect(() => {
    const outer = outerRef.current;
    const inner = innerRef.current;
    if (!outer || !inner) return;
    const measure = () => {
      const scale = Math.min(1, outer.clientWidth / width);
      setFit({ scale, height: inner.offsetHeight * scale });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(outer);
    observer.observe(inner);
    return () => observer.disconnect();
  }, [width]);

  const { phone, side, tone } = heroLayout(slide);
  const isPhone = device === 'phone';
  const md = width >= 768;
  const lg = width >= 1024;
  const beside = phone === 'beside';
  const stacked = isPhone && !beside;
  const showPictures = !(isPhone && phone === 'none');
  const columns = isPhone
    ? (beside ? '1.2fr 1fr' : '1fr')
    : side === 'left' ? (md ? '1fr 1.15fr' : '1fr 1.2fr') : (md ? '1.15fr 1fr' : '1.2fr 1fr');
  const picturesFirst = isPhone ? phone === 'above' : side === 'left';
  const pictureMax = isPhone ? (beside ? (width >= 400 ? 176 : 160) : (width >= 400 ? 224 : 192)) : lg ? 384 : 304;
  const titleSize = isPhone ? 21 : Math.min(52, Math.max(26, 17.6 + 0.026 * width));
  const gutter = isPhone ? 16 : 24;
  const muted = tone ? tone.text : '#7a6858';
  const boxes = heroBoxes(slide.images.length, slide.positions);

  const text = (
    <div style={{ textAlign: stacked ? 'center' : 'left', minWidth: 0 }}>
      <p style={{ fontSize: titleSize, lineHeight: isPhone ? 1.25 : 1.15, fontWeight: 500, letterSpacing: '-0.015em', maxWidth: '18ch', margin: stacked ? '0 auto' : 0, textWrap: 'balance' } as React.CSSProperties}>
        {slide.title || 'Your headline'}
      </p>
      {slide.body?.trim() && (
        <p style={{ marginTop: isPhone ? 6 : 12, fontSize: isPhone ? 12 : 15, color: muted, opacity: tone ? 0.8 : 1 }}>{slide.body}</p>
      )}
      {slide.ctaLabel?.trim() && (
        <span
          style={{
            marginTop: isPhone ? 14 : 28, display: 'inline-flex', alignItems: 'center', gap: 8, borderRadius: 999, fontWeight: 500,
            minHeight: isPhone ? 36 : 46, padding: isPhone ? '0 14px' : '0 24px', fontSize: isPhone ? 12 : 14,
            background: tone ? tone.button : '#c2571a', color: tone ? tone.buttonText : '#ffffff',
          }}
        >
          {slide.ctaLabel} <ShoppingCart size={16} />
        </span>
      )}
    </div>
  );

  const pictures = showPictures && (
    <div style={{ position: 'relative', width: '100%', maxWidth: pictureMax, aspectRatio: '1 / 1', margin: '0 auto', order: picturesFirst ? -1 : 0 }}>
      <span style={{ position: 'absolute', left: '8%', right: '8%', bottom: '3%', height: '10%', borderRadius: '50%', background: 'rgb(43 20 9 / 0.15)', filter: 'blur(8px)' }} />
      {slide.images.length === 0 && (
        <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', border: '2px dashed #ead9c1', borderRadius: 12, color: '#7a6858', fontSize: 14 }}>Pictures</div>
      )}
      {HERO_DRAW_ORDER.filter((i) => i < slide.images.length).map((i) => (
        <img
          key={`${i}-${slide.images[i]}`}
          src={slide.images[i]}
          alt=""
          style={{ ...heroBoxStyle(boxes[i]), objectFit: 'contain', objectPosition: 'bottom', filter: 'drop-shadow(0 14px 16px rgba(35,22,14,0.22))' }}
        />
      ))}
    </div>
  );

  const arrow = { position: 'absolute' as const, top: '50%', transform: 'translateY(-50%)', width: 36, height: 36, borderRadius: 999, background: '#fff', display: 'grid', placeItems: 'center', boxShadow: '0 4px 14px rgba(35,22,14,0.12)', color: '#23160e' };
  const notch = isPhone ? 72 : 88;

  return (
    <div ref={outerRef} className="w-full overflow-hidden rounded-xl" style={{ height: fit.height || undefined, background: '#fffdf9' }}>
      <div
        ref={innerRef}
        style={{ width, transform: `scale(${fit.scale})`, transformOrigin: 'top left', padding: `${isPhone ? 12 : 24}px ${gutter}px 0`, color: '#23160e', fontFamily: 'Poppins, ui-sans-serif, system-ui, sans-serif', opacity: slide.hidden ? 0.5 : 1 }}
      >
        <div style={{ position: 'relative', paddingBottom: isPhone ? 28 : 36 }}>
          <div style={{ position: 'relative', overflow: 'hidden', borderRadius: 16, ...SAND_PANEL }}>
            <div
              style={{
                display: 'grid', gridTemplateColumns: columns, alignItems: 'center', gap: isPhone ? 12 : 24,
                padding: isPhone ? '24px 16px 44px' : lg ? '56px 80px 80px' : '48px 64px 64px',
                ...(tone ? { background: tone.bg, color: tone.text } : {}),
              }}
            >
              {text}
              {pictures}
            </div>
            {!isPhone && (
              <>
                <span style={{ ...arrow, left: lg ? 20 : 12 }}><ChevronLeft size={18} /></span>
                <span style={{ ...arrow, right: lg ? 20 : 12 }}><ChevronRight size={18} /></span>
              </>
            )}
          </div>
          <div style={{ position: 'absolute', bottom: 0, left: '50%', transform: 'translateX(-50%)', width: notch, height: notch, borderRadius: 999, background: '#fffdf9', display: 'grid', placeItems: 'center' }}>
            <span style={{ width: isPhone ? 44 : 56, height: isPhone ? 44 : 56, borderRadius: 999, background: '#c2571a', color: '#fff', display: 'grid', placeItems: 'center' }}>
              <ArrowDown size={20} />
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

/** A tiny drawing of a layout: grey bars for the words, a yellow square for the pictures. */
function LayoutGlyph({ arrangement, wide = false }: { arrangement: HeroPhoneLayout | HeroSide; wide?: boolean }) {
  const column = arrangement === 'above' || arrangement === 'below';
  const bar = (width: string, color?: string) => (
    <span className="block rounded-full" style={{ width, height: color ? 3 : 2, background: color ?? 'currentColor', opacity: color ? 1 : 0.55 }} />
  );
  const words = (
    <span className="flex flex-col gap-[2px]" style={{ flex: column ? 'none' : 1, width: column ? '100%' : undefined, alignItems: column ? 'center' : 'flex-start' }}>
      {bar('100%')}{bar('70%')}{bar('50%', '#c2571a')}
    </span>
  );
  const size = wide ? 14 : column ? 11 : 8;
  const picture = <span className="block shrink-0 rounded-[2px]" style={{ width: size, height: size, background: '#f3b04a' }} />;
  const first = arrangement === 'above' || arrangement === 'left';
  return (
    <span
      aria-hidden
      className="flex shrink-0 items-center justify-center gap-[3px] rounded-md border border-app-border bg-app-bg text-app-text-muted"
      // Phones are drawn upright, wider screens on their side.
      style={{ width: wide ? 54 : 28, height: wide ? 34 : 42, padding: wide ? 6 : 4, flexDirection: column ? 'column' : 'row' }}
    >
      {arrangement === 'none' ? words : first ? <>{picture}{words}</> : <>{words}{picture}</>}
    </span>
  );
}

const choiceClass = (picked: boolean) =>
  `flex items-center gap-2 rounded-lg border px-2.5 py-2 text-left text-sm transition ${picked ? 'border-brand-500 bg-brand-500/10 font-semibold text-app-text' : 'border-app-border text-app-text hover:bg-app-bg'}`;

/** How the slide arranges itself on each kind of screen, and its colour. */
function LayoutChoices({ slide, set, onDevice }: { slide: HeroSlide; set: (patch: Partial<HeroSlide>) => void; onDevice: (d: Device) => void }) {
  const { phone, side } = heroLayout(slide);
  const phoneHint = HERO_PHONE_LAYOUTS.find((l) => l.value === phone)?.hint;
  return (
    <div className="space-y-3">
      <div>
        <p className="text-sm font-medium text-app-text">On phones</p>
        <div className="mt-1.5 grid grid-cols-2 gap-2 sm:grid-cols-4" role="radiogroup" aria-label="Pictures on phones">
          {HERO_PHONE_LAYOUTS.map((choice) => (
            <button
              key={choice.value}
              type="button"
              role="radio"
              aria-checked={phone === choice.value}
              onClick={() => { set({ phone: choice.value }); onDevice('phone'); }}
              className={choiceClass(phone === choice.value)}
            >
              <LayoutGlyph arrangement={choice.value} />
              <span>{choice.label}</span>
            </button>
          ))}
        </div>
        {phoneHint && <p className="mt-1 text-xs text-app-text-muted">{phoneHint}</p>}
      </div>
      <div>
        <p className="text-sm font-medium text-app-text">On tablets and computers</p>
        <div className="mt-1.5 grid grid-cols-2 gap-2 sm:max-w-md" role="radiogroup" aria-label="Pictures on wider screens">
          {HERO_SIDES.map((choice) => (
            <button
              key={choice.value}
              type="button"
              role="radio"
              aria-checked={side === choice.value}
              onClick={() => { set({ side: choice.value }); onDevice('computer'); }}
              className={choiceClass(side === choice.value)}
            >
              <LayoutGlyph arrangement={choice.value} wide />
              <span>{choice.label}</span>
            </button>
          ))}
        </div>
      </div>
      <div>
        <p className="text-sm font-medium text-app-text">Background</p>
        <div className="mt-1.5 flex flex-wrap gap-2" role="radiogroup" aria-label="Banner background">
          {([undefined, ...AD_TONE_ORDER] as (AdTone | undefined)[]).map((tone) => {
            const picked = (slide.tone && slide.tone in AD_TONES ? slide.tone : undefined) === tone;
            const label = tone ? AD_TONES[tone].label : 'Sand pattern';
            return (
              <button
                key={tone ?? 'sand'}
                type="button"
                role="radio"
                aria-checked={picked}
                onClick={() => set({ tone })}
                className={`inline-flex items-center gap-2 rounded-full border py-1 pl-1 pr-3 text-xs font-medium transition ${picked ? 'border-brand-500 ring-2 ring-brand-500/30' : 'border-app-border hover:bg-app-bg'}`}
              >
                <span className="size-6 rounded-full border border-black/10" style={tone ? { background: AD_TONES[tone].bg } : SAND_PANEL} />
                <span className="text-app-text">{label}</span>
              </button>
            );
          })}
        </div>
      </div>
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
  const [device, setDevice] = useState<Device>('phone');
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

      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-medium text-app-text">How customers see it</p>
          <div className="inline-flex rounded-lg border border-app-border p-0.5" role="tablist" aria-label="Preview screen">
            {DEVICES.map((d) => {
              const Icon = d.icon;
              return (
                <button
                  key={d.value}
                  type="button"
                  role="tab"
                  aria-selected={device === d.value}
                  onClick={() => setDevice(d.value)}
                  className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-semibold transition ${device === d.value ? 'bg-brand-500 text-slate-950' : 'text-app-text-muted hover:text-app-text'}`}
                >
                  <Icon size={14} /> {d.label}
                </button>
              );
            })}
          </div>
        </div>
        <div className={device === 'phone' ? 'mx-auto max-w-[390px]' : ''}>
          <DevicePreview slide={slide} device={device} />
        </div>
      </div>

      <LayoutChoices slide={slide} set={set} onDevice={setDevice} />

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
          <div className="mt-1">
            <SearchableDropdown
              items={[...LINK_CHOICES.map((c) => ({ id: c.href, label: c.label })), { id: 'other', label: 'Other page or web address…' }]}
              selectedValue={customLink ? 'other' : slide.ctaHref || '/shop'}
              onChange={(v) => {
                if (v === 'other') {
                  setCustomLink(true);
                } else {
                  setCustomLink(false);
                  set({ ctaHref: v });
                }
              }}
              placeholder="Choose a page"
            />
          </div>
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
        <p className="text-xs text-app-text-muted">Drag to move a picture. Pinch or use + / - to resize.</p>
        <div className="mt-2 grid items-start gap-3 sm:grid-cols-[minmax(0,18rem)_1fr]">
        <div className="space-y-2 rounded-xl p-3" style={SAND_PANEL}>
          <ArrangeDisplay slide={slide} onPositions={(positions) => set({ positions })} />
          {slide.positions && (
            <div className="flex justify-center">
              <button type="button" className={`${secondaryClass} bg-white`} onClick={() => set({ positions: undefined })} style={{ color: '#23160e', borderColor: '#ead9c1' }}>
                <RotateCcw size={15} /> Automatic layout
              </button>
            </div>
          )}
        </div>
        <div>
        <ul className="grid grid-cols-3 gap-2">
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
              cropAspect="original"
              outputWidth={900}
              title="Banner picture"
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
        </div>
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

  /** `reportFailure` is false when a retry follows, so the first refusal shows no error. */
  const write = async (next: HeroSlide[], message: string, reportFailure = true) => {
    setSaving(true);
    setProblem('');
    try {
      const { error } = await getSupabase().from('website_settings').upsert({ business_id: businessId, hero_slides: next });
      if (error) throw error;
      showToast('Online Store', message, undefined, 'success');
      return true;
    } catch (err) {
      if (reportFailure) showToast('Online Store', toUserMessage(err, 'Could not save the home banner. Check each slide has a headline and a picture.'), undefined, 'error');
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
    const savedMessage = cleaned.length ? 'Home banner saved. Customers see it straight away.' : 'Home banner reset to the built-in slides.';
    let ok = await write(cleaned, savedMessage, !cleaned.some(hasLayoutChoices));
    if (!ok && cleaned.some(hasLayoutChoices)) {
      // An older database refuses the layout and colour fields; keep the rest rather than lose it all.
      ok = await write(
        cleaned.map(withoutLayoutChoices),
        'Home banner saved, but the phone layout, side and colour choices could not be saved. Try again later.',
      );
    }
    if (ok) {
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
          {loadError} Check your connection and try again.
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
            Slides at the top of the website's home page.
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
