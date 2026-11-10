import React, { useRef } from 'react';
import { AlignCenter, AlignLeft, AlignRight, Crosshair, ImagePlus, Minus, Plus } from 'lucide-react';
import { IMAGE_RATIOS, IMAGE_WIDTHS, ImageAlign, ImageRatio, ImageStyle, ImageWidth } from '../../../website/src/richFormat';
import { imageCss } from '../../../website/src/RichText';

export type ImageBlock = { id: string; type: 'img'; src: string; alt: string; caption: string; style: ImageStyle };

export const RATIO_LABELS: Record<ImageRatio, string> = {
  auto: 'Original',
  '16:9': '16:9',
  '3:2': '3:2',
  '4:3': '4:3',
  '1:1': 'Square',
  '4:5': '4:5',
  '3:4': '3:4',
  '2:3': '2:3',
  '21:9': 'Wide 21:9',
};

export const WIDTH_LABELS: Record<ImageWidth, string> = { sm: 'Small', md: 'Medium', lg: 'Large', full: 'Full width' };

const clamp = (value: number, min = 0, max = 100) => Math.min(max, Math.max(min, value));

/** A photo placed at the side needs room for text beside it. */
export function withAlign(style: ImageStyle, align: ImageAlign): ImageStyle {
  return { ...style, align, width: align !== 'center' && style.width === 'full' ? 'md' : style.width };
}

interface FocalProps {
  style: ImageStyle;
  /** Called once when a drag starts, so the whole drag undoes in one step. */
  onStart: () => void;
  onChange: (style: ImageStyle) => void;
  className?: string;
  children?: React.ReactNode;
}

/**
 * Covers a photo's frame. Dragging moves the photo inside the frame (which part stays
 * in view when it is cropped); arrow keys do the same in small steps.
 */
export function FocalLayer({ style, onStart, onChange, className = '', children }: FocalProps) {
  const drag = useRef<{ px: number; py: number; style: ImageStyle; fw: number; fh: number; nw: number; nh: number } | null>(null);

  const overflow = (d: NonNullable<typeof drag.current>) => {
    let w = d.fw;
    let h = d.fh;
    if (d.style.ratio !== 'auto') {
      const scale = Math.max(d.fw / d.nw, d.fh / d.nh);
      w = d.nw * scale;
      h = d.nh * scale;
    }
    return { x: w * d.style.zoom - d.fw, y: h * d.style.zoom - d.fh };
  };

  return (
    <div
      role="slider"
      tabIndex={0}
      aria-label="Photo position. Drag, or use the arrow keys, to choose which part of the photo shows."
      aria-valuetext={`${style.x}% across, ${style.y}% down`}
      className={`absolute inset-0 cursor-grab touch-none outline-none focus-visible:ring-2 focus-visible:ring-brand-500 active:cursor-grabbing ${className}`}
      onPointerDown={(e) => {
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        const img = e.currentTarget.parentElement?.querySelector('img');
        if (!img) return;
        e.stopPropagation();
        e.currentTarget.setPointerCapture(e.pointerId);
        const rect = e.currentTarget.getBoundingClientRect();
        drag.current = { px: e.clientX, py: e.clientY, style, fw: rect.width, fh: rect.height, nw: img.naturalWidth || rect.width, nh: img.naturalHeight || rect.height };
        onStart();
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d) return;
        const room = overflow(d);
        const x = room.x > 1 ? clamp(d.style.x - ((e.clientX - d.px) / room.x) * 100) : d.style.x;
        const y = room.y > 1 ? clamp(d.style.y - ((e.clientY - d.py) / room.y) * 100) : d.style.y;
        if (Math.round(x) !== style.x || Math.round(y) !== style.y) onChange({ ...style, x: Math.round(x), y: Math.round(y) });
      }}
      onPointerUp={() => (drag.current = null)}
      onPointerCancel={() => (drag.current = null)}
      onKeyDown={(e) => {
        const step = e.shiftKey ? 10 : 2;
        const moves: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
        const move = moves[e.key];
        if (!move) return;
        e.preventDefault();
        e.stopPropagation();
        onStart();
        onChange({ ...style, x: clamp(style.x + move[0]), y: clamp(style.y + move[1]) });
      }}
    >
      {children}
    </div>
  );
}

const chip = (active: boolean) =>
  `min-h-8 rounded-md border px-2.5 text-xs font-semibold transition ${active ? 'border-brand-500 bg-brand-500/15 text-app-text' : 'border-app-border text-app-text-muted hover:bg-app-bg'}`;

interface CardProps {
  block: ImageBlock;
  onStart: () => void;
  onStyle: (style: ImageStyle, structural: boolean) => void;
  onField: (field: 'alt' | 'caption', value: string) => void;
  onReplace: () => void;
}

/** The photo's settings in the editor column. */
export function ImageCard({ block, onStart, onStyle, onField, onReplace }: CardProps) {
  const { style } = block;
  const css = imageCss(style);
  const cropped = style.ratio !== 'auto' || style.zoom > 1;

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-3 sm:flex-row">
        <div className="w-full shrink-0 sm:w-56">
          <div className="relative overflow-hidden rounded-lg border border-app-border bg-app-bg" style={css.frame}>
            <img
              src={block.src}
              alt=""
              draggable={false}
              className={style.ratio === 'auto' ? 'block h-auto w-full' : 'block h-full w-full object-cover'}
              style={css.img}
            />
            {cropped && (
              <FocalLayer style={style} onStart={onStart} onChange={(next) => onStyle(next, false)}>
                <span
                  className="pointer-events-none absolute h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,0.35)]"
                  style={{ left: `${style.x}%`, top: `${style.y}%` }}
                />
              </FocalLayer>
            )}
          </div>
          <p className="mt-1 text-[11px] text-app-text-muted">
            {cropped ? 'Drag the photo to choose what stays in view.' : 'Pick a shape or zoom in to crop the photo.'}
          </p>
        </div>

        <div className="min-w-0 flex-1 space-y-2.5">
          <fieldset>
            <legend className="mb-1 text-xs font-semibold text-app-text">Shape</legend>
            <div className="flex flex-wrap gap-1">
              {IMAGE_RATIOS.map((ratio) => (
                <button key={ratio} type="button" className={chip(style.ratio === ratio)} aria-pressed={style.ratio === ratio} onClick={() => onStyle({ ...style, ratio }, true)}>
                  {RATIO_LABELS[ratio]}
                </button>
              ))}
            </div>
          </fieldset>
          <fieldset>
            <legend className="mb-1 text-xs font-semibold text-app-text">Size</legend>
            <div className="flex flex-wrap gap-1">
              {IMAGE_WIDTHS.map((width) => (
                <button
                  key={width}
                  type="button"
                  className={chip(style.width === width)}
                  aria-pressed={style.width === width}
                  onClick={() => onStyle({ ...style, width, align: width === 'full' ? 'center' : style.align }, true)}
                >
                  {WIDTH_LABELS[width]}
                </button>
              ))}
            </div>
          </fieldset>
          <fieldset>
            <legend className="mb-1 text-xs font-semibold text-app-text">Place</legend>
            <div className="flex flex-wrap gap-1">
              {([['left', 'Left, text beside', AlignLeft], ['center', 'Centre', AlignCenter], ['right', 'Right, text beside', AlignRight]] as const).map(([align, label, Icon]) => (
                <button
                  key={align}
                  type="button"
                  className={`${chip(style.align === align)} inline-flex items-center gap-1`}
                  aria-pressed={style.align === align}
                  onClick={() => onStyle(withAlign(style, align), true)}
                >
                  <Icon size={13} /> {label}
                </button>
              ))}
            </div>
          </fieldset>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold text-app-text">Zoom</span>
            <button type="button" className={chip(false)} aria-label="Zoom out" onClick={() => onStyle({ ...style, zoom: Math.max(1, Math.round((style.zoom - 0.1) * 10) / 10) }, true)}>
              <Minus size={13} />
            </button>
            <input
              type="range"
              min={1}
              max={3}
              step={0.1}
              value={style.zoom}
              aria-label="Zoom"
              onPointerDown={onStart}
              onKeyDown={onStart}
              onChange={(e) => onStyle({ ...style, zoom: Number(e.target.value) }, false)}
              className="w-28 accent-[var(--color-brand-500)]"
            />
            <button type="button" className={chip(false)} aria-label="Zoom in" onClick={() => onStyle({ ...style, zoom: Math.min(3, Math.round((style.zoom + 0.1) * 10) / 10) }, true)}>
              <Plus size={13} />
            </button>
            <span className="w-10 text-xs tabular-nums text-app-text-muted">{style.zoom.toFixed(1)}×</span>
            <button
              type="button"
              className={`${chip(false)} inline-flex items-center gap-1`}
              onClick={() => onStyle({ ...style, x: 50, y: 50, zoom: 1 }, true)}
              disabled={style.x === 50 && style.y === 50 && style.zoom === 1}
            >
              <Crosshair size={13} /> Reset
            </button>
          </div>
        </div>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        <label className="block text-xs font-semibold text-app-text">
          Describe the photo
          <span className="block font-normal text-app-text-muted">Read aloud to blind customers and used by Google.</span>
          <input
            value={block.alt}
            maxLength={160}
            onChange={(e) => onField('alt', e.target.value)}
            placeholder="A bottle of fresh milk on a table"
            className="mt-1 w-full rounded-lg border border-app-border bg-app-bg px-3 py-2 text-sm font-normal text-app-text outline-none focus:border-brand-500"
          />
        </label>
        <label className="block text-xs font-semibold text-app-text">
          Caption <span className="font-normal text-app-text-muted">(optional)</span>
          <span className="block font-normal text-app-text-muted">Shown under the photo.</span>
          <input
            value={block.caption}
            maxLength={200}
            onChange={(e) => onField('caption', e.target.value)}
            placeholder="Our milk, collected every morning"
            className="mt-1 w-full rounded-lg border border-app-border bg-app-bg px-3 py-2 text-sm font-normal text-app-text outline-none focus:border-brand-500"
          />
        </label>
      </div>
      <button type="button" onClick={onReplace} className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-app-border px-3 text-xs font-semibold text-app-text hover:bg-app-bg">
        <ImagePlus size={14} /> Change photo
      </button>
    </div>
  );
}
