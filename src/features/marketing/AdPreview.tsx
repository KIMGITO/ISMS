// How a campaign's creatives sit on the shop's website, at phone, tablet and desktop width, drawn
// with the real pictures, their crop and focal point, the phone versions and the shop's main
// colour. For the real thing, "Open on my website" shows it on the live website (preview link).
import React, { useLayoutEffect, useRef, useState } from 'react';
import { Monitor, Play, Smartphone, Tablet } from 'lucide-react';
import { Segmented } from '../../components/shared/Choice';
import SearchableDropdown from '../../components/SearchableDropdown';
import { useBusinessStore } from '../../stores/businessStore';
import type { Campaign, Creative, MediaItem } from '../../services/marketing';
import { FORMATS, focalPosition, PLACEMENTS, type AdPlacement } from '../../../website/src/ads/rules';

type Device = 'phone' | 'tablet' | 'desktop';
const WIDTH: Record<Device, number> = { phone: 390, tablet: 768, desktop: 1280 };

function Picture({ c, media, mobile, phone, className = '' }: { c: Creative; media?: MediaItem; mobile?: MediaItem; phone: boolean; className?: string }) {
  const m = phone && mobile ? mobile : media;
  if (!m) return null;
  if (m.kind === 'video') return <div className={`grid h-full w-full place-items-center bg-black/80 text-white ${className}`}><Play size={36} /></div>;
  const fx = m === media ? c.focal_x ?? m.focal_x : m.focal_x;
  const fy = m === media ? c.focal_y ?? m.focal_y : m.focal_y;
  return <img src={m.url} alt={c.alt_text ?? m.alt_text ?? ''} className={`h-full w-full object-cover ${className}`} style={{ objectPosition: focalPosition(fx, fy) }} />;
}

function ratio(c: Creative, media: Record<string, MediaItem>, phone: boolean): string {
  const mobile = c.mobile_media_id ? media[c.mobile_media_id] : undefined;
  if (phone && mobile?.width && mobile.height) return `${mobile.width} / ${mobile.height}`;
  return String(FORMATS[c.format].ratio ?? 1);
}

export default function AdPreview({ campaign, creatives, media, shopName }: {
  campaign: Pick<Campaign, 'name' | 'tone' | 'discount_label' | 'cta_label'>;
  creatives: Creative[];
  media: Record<string, MediaItem>;
  shopName: string;
}) {
  const [device, setDevice] = useState<Device>('phone');
  const [placement, setPlacement] = useState<AdPlacement | 'all'>('all');
  const outer = useRef<HTMLDivElement | null>(null);
  const inner = useRef<HTMLDivElement | null>(null);
  const [scale, setScale] = useState(1);
  const [height, setHeight] = useState(0);
  const colour = useBusinessStore((s) => s.businesses.find((b) => b.id === s.activeBusinessId)?.primaryColor) || '#c2571a';
  useLayoutEffect(() => {
    const el = outer.current;
    if (!el) return;
    const fit = () => {
      setScale(Math.min(1, el.clientWidth / WIDTH[device]));
      setHeight(inner.current?.offsetHeight ?? 0);
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    if (inner.current) ro.observe(inner.current);
    return () => ro.disconnect();
  }, [device]);

  const phone = device === 'phone';
  const visible = creatives.filter((c) => !c.hidden && (placement === 'all' || c.placement === placement));
  const of = (p: AdPlacement) => visible.filter((c) => c.placement === p);
  const tone = campaign.tone === 'dark' ? { background: '#1c1917', color: '#fff' } : campaign.tone === 'light' ? { background: '#fffdf9', color: '#1c1917' } : { background: colour, color: '#fff' };
  const used = Array.from(new Set(creatives.filter((c) => !c.hidden).map((c) => c.placement)));
  const cta = campaign.cta_label;

  const frame = (
    <div style={{ width: WIDTH[device], fontFamily: 'Poppins, system-ui, sans-serif' }} className="bg-[#fffdf9] text-[#1c1917]">
      {of('announcement').slice(0, 1).map((c) => (
        <div key={c.id} style={tone} className="px-4 py-2 text-center text-[13px] font-medium">{c.headline} {cta && <u className="ml-1 font-semibold">{cta}</u>}</div>
      ))}
      <div className="flex items-center justify-between border-b border-black/10 px-4 py-3">
        <span className="font-bold">{shopName}</span>
        <span className="text-xs text-black/50">Shop · Cart</span>
      </div>
      <div className="space-y-5 p-4">
        {of('hero').slice(0, 1).map((c) => (
          <div key={c.id} className="relative overflow-hidden rounded-2xl bg-black/5" style={{ aspectRatio: ratio(c, media, phone) }}>
            <div className="absolute inset-0"><Picture c={c} media={c.media_id ? media[c.media_id] : undefined} mobile={c.mobile_media_id ? media[c.mobile_media_id] : undefined} phone={phone} /></div>
            {c.text_position !== 'none' && (c.headline || c.body) && (
              <div className={`absolute inset-0 flex flex-col justify-end bg-gradient-to-r from-black/65 via-black/30 to-transparent p-5 text-white ${c.text_position === 'center' ? 'items-center text-center' : c.text_position === 'right' ? 'items-end text-right' : ''}`}>
                {c.headline && <p className={`${phone ? 'text-2xl' : 'text-4xl'} font-bold leading-tight`}>{c.headline}</p>}
                {c.body && <p className="mt-1 text-sm opacity-90">{c.body}</p>}
                {(c.cta_label || cta) && <span className="mt-3 inline-block rounded-full bg-white px-4 py-2 text-sm font-semibold text-black">{c.cta_label || cta}</span>}
              </div>
            )}
          </div>
        ))}
        {of('category').slice(0, 1).map((c) => (
          <div key={c.id} className="overflow-hidden rounded-xl" style={{ aspectRatio: ratio(c, media, phone) }}>
            <Picture c={c} media={c.media_id ? media[c.media_id] : undefined} mobile={c.mobile_media_id ? media[c.mobile_media_id] : undefined} phone={phone} />
          </div>
        ))}
        {of('card').length > 0 && (
          <div className={`grid gap-3 ${phone ? 'grid-cols-2' : 'grid-cols-3'}`}>
            {of('card').slice(0, 3).map((c) => (
              <div key={c.id}>
                <div className="relative overflow-hidden rounded-xl bg-black/5" style={{ aspectRatio: String(FORMATS[c.format].ratio) }}>
                  <div className="absolute inset-0"><Picture c={c} media={c.media_id ? media[c.media_id] : undefined} phone={false} /></div>
                  {campaign.discount_label && <span style={tone} className="absolute left-2 top-2 rounded-full px-2 py-0.5 text-[11px] font-semibold">{campaign.discount_label}</span>}
                </div>
                {c.headline && <p className="mt-1 text-sm font-semibold">{c.headline}</p>}
              </div>
            ))}
          </div>
        )}
        {of('video').slice(0, 1).map((c) => (
          <div key={c.id} className={c.format === 'video_9x16' ? 'max-w-[280px]' : ''}>
            <div className="relative overflow-hidden rounded-2xl bg-black" style={{ aspectRatio: String(FORMATS[c.format].ratio) }}>
              {c.poster_media_id && media[c.poster_media_id] && <img src={media[c.poster_media_id].url} alt="" className="absolute inset-0 h-full w-full object-cover" />}
              <span className="absolute left-1/2 top-1/2 grid size-14 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-white/90 text-black"><Play size={22} /></span>
            </div>
            {c.headline && <p className="mt-2 font-semibold">{c.headline}</p>}
          </div>
        ))}
        {of('product').slice(0, 1).map((c) => (
          <div key={c.id} style={tone} className="flex items-center gap-3 rounded-xl p-3">
            {c.media_id && media[c.media_id] && <div className="w-16 overflow-hidden rounded-lg" style={{ aspectRatio: String(FORMATS[c.format].ratio ?? 1) }}><Picture c={c} media={media[c.media_id]} phone={false} /></div>}
            <div>
              {campaign.discount_label && <p className="text-[11px] font-semibold uppercase opacity-90">{campaign.discount_label}</p>}
              <p className="text-sm font-semibold">{c.headline || campaign.name}</p>
            </div>
          </div>
        ))}
        {of('landing').length > 0 && placement === 'landing' && (
          <p className="text-sm text-black/60">The campaign page shows its banner, words, products, video and other pictures in that order.</p>
        )}
        <div className="grid grid-cols-2 gap-3 opacity-40" aria-hidden>
          {[1, 2].map((i) => <div key={i} className="aspect-square rounded-xl bg-black/10" />)}
        </div>
      </div>
      {of('popup').slice(0, 1).map((c) => (
        <div key={c.id} className="absolute inset-0 grid place-items-center bg-black/50 p-4">
          <div className="w-full max-w-[340px] overflow-hidden rounded-2xl bg-white shadow-2xl">
            {c.media_id && media[c.media_id] && <div style={{ aspectRatio: String(FORMATS[c.format].ratio ?? 1) }}><Picture c={c} media={media[c.media_id]} phone={false} /></div>}
            <div className="p-4">
              {c.headline && <p className="text-lg font-bold">{c.headline}</p>}
              {c.body && <p className="mt-1 text-sm text-black/60">{c.body}</p>}
              <div className="mt-3 flex gap-2"><span style={tone} className="flex-1 rounded-full px-3 py-2 text-center text-sm font-semibold">{c.cta_label || cta || 'Shop now'}</span><span className="rounded-full border px-3 py-2 text-sm">Not now</span></div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Segmented<Device>
          size="sm"
          ariaLabel="Screen size"
          value={device}
          onChange={setDevice}
          options={[
            { id: 'phone', label: 'Phone', icon: <Smartphone size={14} /> },
            { id: 'tablet', label: 'Tablet', icon: <Tablet size={14} /> },
            { id: 'desktop', label: 'Desktop', icon: <Monitor size={14} /> },
          ]}
        />
        <SearchableDropdown className="w-52" placeholder="Every placement" selectedValue={placement} onChange={(x) => setPlacement(x as AdPlacement | 'all')} items={[{ id: 'all', label: 'Every placement' }, ...used.map((p) => ({ id: p, label: PLACEMENTS[p].label }))]} />
      </div>
      <div ref={outer} className="overflow-hidden rounded-xl border border-app-border bg-app-bg">
        <div style={{ width: WIDTH[device] * scale, height: height * scale }} className="mx-auto">
          <div ref={inner} className="relative origin-top-left" style={{ transform: `scale(${scale})`, width: WIDTH[device] }}>{frame}</div>
        </div>
      </div>
      {visible.length === 0 && <p className="text-sm text-app-text-muted">Add a creative to see it here.</p>}
    </div>
  );
}
