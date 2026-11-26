// One campaign: its details, schedule (in the shop's time zone), button, the creatives it shows,
// a preview, its figures and its history. The actions shown depend on the status the database
// reports; the database refuses anything that doesn't fit (e.g. publishing with no creative).
import React, { useEffect, useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import {
  Archive, ArrowLeft, Copy, ExternalLink, Eye, Pause, Pencil, Play, Plus, RotateCcw, Save, Send, Square, Trash2, Undo2, X,
} from 'lucide-react';
import { useInventoryStore } from '../../stores/inventoryStore';
import { useNotificationStore } from '../../stores/notificationStore';
import { useBusinessStore } from '../../stores/businessStore';
import { toUserMessage } from '../../utils/userError';
import { formatMoney } from '../../utils/money';
import { NumberInput } from '../../components/shared/Input';
import { StatGrid, StatTile } from '../../components/shared/StatTile';
import SearchableDropdown from '../../components/SearchableDropdown';
import { getSupabase } from '../../services/supabaseClient';
import { listPromotions, type Promotion } from '../../services/promotions';
import {
  campaignAction, campaignReport, clickRate, duplicateCampaign, formatInZone, getCampaign, listMedia, removeCreative,
  saveCampaign, toZoneLocal, type CampaignAction, type CampaignDraft, type Creative, type MediaItem,
} from '../../services/marketing';
import { CAMPAIGN_TYPES, OBJECTIVES, PLACEMENTS, FORMATS, type CtaKind } from '../../../website/src/ads/rules';
import AdPreview from './AdPreview';
import CreativeForm from './CreativeForm';
import { MediaThumb } from './MediaPicker';
import {
  cardClass, count, dangerClass, ErrorBox, EVENT_LABELS, hintClass, inputClass, labelClass, percent, primaryClass, ScreenHeading,
  secondaryClass, StatusBadge, useCanManage, useLoad, useTimezone,
} from './shared';

const CTA_KINDS: { value: CtaKind; label: string }[] = [
  { value: 'none', label: 'No button' },
  { value: 'link', label: 'A page or web address' },
  { value: 'product', label: 'A product' },
  { value: 'category', label: 'A category' },
  { value: 'landing', label: 'The campaign page' },
  { value: 'promo_code', label: 'Show a promotion code' },
  { value: 'whatsapp', label: 'WhatsApp chat' },
];

const DEFAULT_NAMES: Record<string, string> = {
  black_friday: 'Black Friday', christmas: 'Christmas offers', flash_sale: 'Flash sale', new_product: 'New arrival',
  brand_awareness: 'Get to know us', discount: 'Special offer', seasonal: 'Seasonal offer',
};

function blankDraft(type: string | undefined, tz: string): CampaignDraft {
  const start = new Date(Date.now() + 60 * 60_000);
  const end = new Date(start.getTime() + 7 * 86_400_000);
  return {
    name: DEFAULT_NAMES[type ?? ''] ?? '', campaign_type: type ?? 'discount', objective: type === 'brand_awareness' ? 'awareness' : type === 'new_product' ? 'product_launch' : 'sales',
    starts_local: toZoneLocal(start.toISOString(), tz).replace(/:\d\d$/, ':00'), ends_local: toZoneLocal(end.toISOString(), tz).replace(/:\d\d$/, ':00'),
    priority: type === 'black_friday' || type === 'flash_sale' ? 80 : 50, cta_kind: 'link', cta_target: '/shop', cta_label: 'Shop now',
    target_product_ids: [], tone: 'brand',
  };
}

const slugify = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50);

export default function CampaignEditor({ businessId, campaignId, newType, onClose, onOpen }: {
  businessId: string; campaignId: string | 'new'; newType?: string; onClose: () => void; onOpen: (id: string) => void;
}) {
  const canManage = useCanManage();
  const tz = useTimezone(businessId);
  const showToast = useNotificationStore((s) => s.showToast);
  const shopName = useBusinessStore((s) => s.businesses.find((b) => b.id === s.activeBusinessId)?.name ?? 'Your shop');
  const { products, categories } = useInventoryStore(useShallow((s) => ({ products: s.products, categories: s.categories })));
  const isNew = campaignId === 'new';
  const loaded = useLoad(() => (isNew ? Promise.resolve(null) : getCampaign(campaignId)), [campaignId]);
  const mediaLoad = useLoad(() => listMedia(businessId), [businessId]);
  const report = useLoad(() => (isNew ? Promise.resolve(null) : campaignReport(campaignId)), [campaignId]);
  const promos = useLoad<Promotion[]>(() => listPromotions(businessId).catch(() => []), [businessId]);
  const [draft, setDraft] = useState<CampaignDraft | null>(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [creative, setCreative] = useState<Creative | 'new' | null>(null);
  const [confirm, setConfirm] = useState<CampaignAction | null>(null);

  const campaign = loaded.data?.campaign;
  const creatives = loaded.data?.creatives ?? [];
  const media = useMemo(() => Object.fromEntries((mediaLoad.data ?? []).map((m) => [m.id, m])) as Record<string, MediaItem>, [mediaLoad.data]);
  const readOnly = !canManage || campaign?.state === 'archived';

  useEffect(() => {
    if (isNew) { setDraft(blankDraft(newType, tz)); return; }
    if (!campaign || dirty) return;
    setDraft({
      id: campaign.id, name: campaign.name, description: campaign.description ?? '', campaign_type: campaign.campaign_type, objective: campaign.objective,
      starts_local: toZoneLocal(campaign.starts_at, tz), ends_local: toZoneLocal(campaign.ends_at, tz), priority: campaign.priority,
      cta_label: campaign.cta_label ?? '', cta_kind: campaign.cta_kind, cta_target: campaign.cta_target ?? '', discount_label: campaign.discount_label ?? '',
      promotion_id: campaign.promotion_id, target_product_ids: campaign.target_product_ids ?? [], target_category: campaign.target_category ?? '',
      landing_slug: campaign.landing_slug ?? '', tone: campaign.tone,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campaign, tz, isNew]);

  const set = <K extends keyof CampaignDraft>(k: K, v: CampaignDraft[K]) => { setDraft((d) => (d ? { ...d, [k]: v } : d)); setDirty(true); };
  const reloadAll = () => { setDirty(false); loaded.reload(); report.reload(); mediaLoad.reload(); };

  const save = async () => {
    if (!draft) return;
    if (!draft.name.trim()) { showToast('Campaign', 'Give the campaign a name.', undefined, 'error'); return; }
    setBusy('save');
    try {
      const clean: CampaignDraft = { ...draft, landing_slug: draft.landing_slug ? slugify(draft.landing_slug) : '' };
      const id = await saveCampaign(businessId, clean, campaign?.revision);
      setDirty(false);
      showToast('Campaign', isNew ? 'Campaign created as a draft. Now add its creatives.' : 'Saved.', undefined, 'success');
      if (isNew) onOpen(id); else reloadAll();
    } catch (e) {
      showToast('Campaign', toUserMessage(e, 'Could not save the campaign.'), undefined, 'error');
    } finally { setBusy(null); }
  };

  const act = async (action: CampaignAction) => {
    if (!campaign) return;
    if (dirty) { showToast('Campaign', 'Save your changes first.', undefined, 'error'); return; }
    setBusy(action);
    try {
      const status = await campaignAction(campaign.id, action);
      setConfirm(null);
      const words: Record<string, string> = {
        active: 'It is on your website now (visitors may need up to a minute to see it).', scheduled: 'It will start by itself at its start time.',
        paused: 'Paused: it is off the website.', completed: 'Ended: it is off the website.', archived: 'Archived.', draft: 'Back to draft: off the website.',
      };
      showToast('Campaign', words[status] ?? 'Done.', undefined, 'success');
      reloadAll();
    } catch (e) {
      showToast('Campaign', toUserMessage(e, 'Could not do that.'), undefined, 'error');
    } finally { setBusy(null); }
  };

  const duplicate = async () => {
    if (!campaign) return;
    setBusy('dup');
    try {
      const id = await duplicateCampaign(campaign.id);
      showToast('Campaign', 'Copied as a new draft.', undefined, 'success');
      onOpen(id);
    } catch (e) { showToast('Campaign', toUserMessage(e, 'Could not copy.'), undefined, 'error'); } finally { setBusy(null); }
  };

  const preview = async () => {
    if (!campaign) return;
    setBusy('preview');
    try {
      const { data, error } = await getSupabase().rpc('marketing_preview_link', { p_campaign_id: campaign.id });
      if (error) throw error;
      const host = (data as any).host as string | null;
      if (!host) throw new Error('This shop has no web address yet.');
      const path = (data as any).landing ? `/promo/${(data as any).landing}` : '/';
      window.open(`https://${host}${path}?adpreview=${(data as any).secret}`, '_blank', 'noopener');
    } catch (e) { showToast('Preview', toUserMessage(e, 'Could not open the preview.'), undefined, 'error'); } finally { setBusy(null); }
  };

  const removeOne = async (c: Creative) => {
    try {
      await removeCreative(c.id);
      showToast('Campaign', 'Creative removed.', undefined, 'success');
      reloadAll();
    } catch (e) { showToast('Campaign', toUserMessage(e, 'Could not remove it.'), undefined, 'error'); }
  };

  if (loaded.error) return <ErrorBox message={loaded.error} onRetry={loaded.reload} />;
  if (!draft) return <p className="text-sm text-app-text-muted">Opening the campaign…</p>;

  const status = campaign?.status ?? 'draft';
  const problems = report.data?.problems ?? [];
  const t = report.data ? report.data.byCreative.reduce((a, r) => ({ loads: a.loads + r.loads, views: a.views + r.views, clicks: a.clicks + r.clicks, conversions: a.conversions + r.conversions }), { loads: 0, views: 0, clicks: 0, conversions: 0 }) : null;
  const actionButtons: { action: CampaignAction; label: string; icon: React.ReactNode; show: boolean; danger?: boolean; ask?: string }[] = [
    { action: 'publish', label: 'Publish', icon: <Send size={15} />, show: status === 'draft' },
    { action: 'pause', label: 'Pause', icon: <Pause size={15} />, show: status === 'active' || status === 'scheduled' },
    { action: 'resume', label: 'Resume', icon: <Play size={15} />, show: status === 'paused' },
    { action: 'unpublish', label: 'Back to draft', icon: <Undo2 size={15} />, show: status === 'scheduled' || status === 'paused' || status === 'active', ask: 'Take it off the website and back to draft?' },
    { action: 'end', label: 'End now', icon: <Square size={15} />, show: ['active', 'scheduled', 'paused'].includes(status), danger: true, ask: 'End the campaign now? It leaves the website and cannot run again (you can copy it).' },
    { action: 'archive', label: 'Archive', icon: <Archive size={15} />, show: status === 'completed' || status === 'draft', ask: 'Archive it? Its figures are kept.' },
    { action: 'restore', label: 'Restore', icon: <RotateCcw size={15} />, show: status === 'archived' },
  ];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={secondaryClass} onClick={onClose}><ArrowLeft size={15} /> Campaigns</button>
        {campaign && <StatusBadge status={status} />}
        {campaign?.published_at && <span className="text-xs text-app-text-muted">Published {formatInZone(campaign.published_at, tz)}</span>}
      </div>

      <ScreenHeading
        title={isNew ? 'New campaign' : campaign!.name}
        actions={campaign && canManage ? (
          <>
            <button type="button" className={secondaryClass} disabled={busy !== null} onClick={preview}><ExternalLink size={15} /> Open on my website</button>
            <button type="button" className={secondaryClass} disabled={busy !== null} onClick={duplicate}><Copy size={15} /> Copy</button>
            {actionButtons.filter((b) => b.show).map((b) => (
              <button key={b.action} type="button" disabled={busy !== null || (b.action === 'publish' && problems.length > 0)}
                title={b.action === 'publish' && problems.length > 0 ? problems.join(' ') : undefined}
                className={b.action === 'publish' ? primaryClass : b.danger ? dangerClass : secondaryClass}
                onClick={() => (b.ask ? setConfirm(b.action) : act(b.action))}>
                {b.icon} {b.action === 'publish' && campaign && new Date(campaign.starts_at) > new Date() ? 'Schedule' : b.label}
              </button>
            ))}
          </>
        ) : undefined}
      >
        {isNew ? 'Name it, set its dates, then add its creatives. Nothing shows on your website until you publish.' : `Times are in ${tz}.`}
      </ScreenHeading>

      {confirm && (
        <div role="alertdialog" className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-app-text">
          {actionButtons.find((b) => b.action === confirm)?.ask}
          <span className="flex gap-2">
            <button type="button" className={secondaryClass} onClick={() => setConfirm(null)}>Keep it</button>
            <button type="button" className={primaryClass} disabled={busy !== null} onClick={() => act(confirm)}>Yes</button>
          </span>
        </div>
      )}

      {campaign && status === 'draft' && problems.length > 0 && (
        <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-app-text">
          <p className="font-semibold">Before you can publish</p>
          <ul className="mt-1 list-disc pl-5">{problems.map((p) => <li key={p}>{p}</li>)}</ul>
        </div>
      )}

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,26rem)]">
        <div className="space-y-5">
          {/* ── Details ── */}
          <fieldset disabled={readOnly} className={`${cardClass} space-y-3`}>
            <legend className="sr-only">Campaign details</legend>
            <h3 className="font-semibold text-app-text">Details</h3>
            <label className={labelClass}>Name
              <input className={`${inputClass} mt-1`} maxLength={80} value={draft.name} onChange={(e) => set('name', e.target.value)} placeholder="Black Friday 2026" />
            </label>
            <label className={labelClass}>Description <span className={hintClass}>For your team, and the campaign page if it has no other words.</span>
              <textarea className={`${inputClass} mt-1`} rows={2} maxLength={500} value={draft.description ?? ''} onChange={(e) => set('description', e.target.value)} />
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className={labelClass}>Kind
                <SearchableDropdown className="mt-1" placeholder="Choose a type" selectedValue={draft.campaign_type} onChange={(x) => set('campaign_type', x)} items={CAMPAIGN_TYPES.map((x) => ({ id: x.value, label: x.label }))} />
              </label>
              <label className={labelClass}>Aim
                <SearchableDropdown className="mt-1" placeholder="Choose a goal" selectedValue={draft.objective} onChange={(x) => set('objective', x)} items={OBJECTIVES.map((x) => ({ id: x.value, label: x.label }))} />
              </label>
            </div>
          </fieldset>

          {/* ── Schedule ── */}
          <fieldset disabled={readOnly} className={`${cardClass} space-y-3`}>
            <legend className="sr-only">Schedule</legend>
            <h3 className="font-semibold text-app-text">When it shows</h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className={labelClass}>Starts <span className={hintClass}>{tz}</span>
                <input type="datetime-local" className={`${inputClass} mt-1`} value={draft.starts_local} onChange={(e) => set('starts_local', e.target.value)} />
              </label>
              <label className={labelClass}>Ends <span className={hintClass}>Leave empty to run until you end it</span>
                <input type="datetime-local" className={`${inputClass} mt-1`} value={draft.ends_local ?? ''} min={draft.starts_local} onChange={(e) => set('ends_local', e.target.value)} />
              </label>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className={labelClass}>Priority <span className={hintClass}>1 to 100. Higher shows first when campaigns share a space.</span>
                <NumberInput className="mt-1" value={draft.priority} decimals={0} min={1} max={100} onChange={(v) => set('priority', Math.min(100, Math.max(1, v ?? 50)))} />
              </label>
              <label className={labelClass}>Colour of bars and boxes
                <SearchableDropdown className="mt-1" placeholder="Choose a colour" selectedValue={draft.tone} onChange={(x) => set('tone', x as CampaignDraft['tone'])} items={[{ id: 'brand', label: 'Your brand colour' }, { id: 'dark', label: 'Dark' }, { id: 'light', label: 'Light' }]} />
              </label>
            </div>
          </fieldset>

          {/* ── Button and offer ── */}
          <fieldset disabled={readOnly} className={`${cardClass} space-y-3`}>
            <legend className="sr-only">Button and offer</legend>
            <h3 className="font-semibold text-app-text">Button and offer</h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className={labelClass}>The button goes to
                <SearchableDropdown className="mt-1" placeholder="Choose where it goes" selectedValue={draft.cta_kind} onChange={(x) => { set('cta_kind', x as CtaKind); set('cta_target', ''); }} items={CTA_KINDS.map((x) => ({ id: x.value, label: x.label }))} />
              </label>
              {draft.cta_kind !== 'none' && (
                <label className={labelClass}>Button words
                  <input className={`${inputClass} mt-1`} maxLength={30} value={draft.cta_label ?? ''} onChange={(e) => set('cta_label', e.target.value)} placeholder="Shop now" />
                </label>
              )}
            </div>
            {draft.cta_kind === 'link' && (
              <label className={labelClass}>Page or address <span className={hintClass}>A page of your website such as /shop, or an address starting https://</span>
                <input className={`${inputClass} mt-1`} maxLength={300} value={draft.cta_target ?? ''} onChange={(e) => set('cta_target', e.target.value.trim())} placeholder="/shop?offers=1" />
              </label>
            )}
            {draft.cta_kind === 'product' && (
              <label className={labelClass}>Product
                <SearchableDropdown className="mt-1" placeholder="Choose a product" searchPlaceholder="Search products..." selectedValue={draft.cta_target ?? ''} onChange={(x) => set('cta_target', x)} items={products.filter((p: any) => p.showOnWebsite !== false).map((p: any) => ({ id: String(p.id), label: p.name }))} />
              </label>
            )}
            {draft.cta_kind === 'category' && (
              <label className={labelClass}>Category
                <SearchableDropdown className="mt-1" placeholder="Choose a category" selectedValue={draft.cta_target ?? ''} onChange={(x) => set('cta_target', x)} items={categories.map((c: any) => { const n = typeof c === 'string' ? c : c.name; return { id: n, label: n }; })} />
              </label>
            )}
            <div className="grid gap-3 sm:grid-cols-2">
              <label className={labelClass}>Offer label <span className={hintClass}>Shown as a badge, e.g. "Up to 40% off"</span>
                <input className={`${inputClass} mt-1`} maxLength={40} value={draft.discount_label ?? ''} onChange={(e) => set('discount_label', e.target.value)} />
              </label>
              <label className={labelClass}>Promotion code <span className={hintClass}>From Promotions & Points; the discount itself is set there</span>
                <SearchableDropdown className="mt-1" placeholder="None" selectedValue={draft.promotion_id ?? ''} onChange={(x) => set('promotion_id', x || null)} items={[{ id: '', label: 'None' }, ...(promos.data ?? []).filter((p) => p.code).map((p) => ({ id: p.id, label: `${p.code} · ${p.name}` }))]} />
              </label>
            </div>
            <label className={labelClass}>Campaign page address <span className={hintClass}>Optional. Gives the campaign its own page at /promo/…</span>
              <div className="mt-1 flex items-center gap-1 text-sm text-app-text-muted">/promo/
                <input className={inputClass} maxLength={50} value={draft.landing_slug ?? ''} onChange={(e) => set('landing_slug', e.target.value.toLowerCase())} onBlur={(e) => set('landing_slug', slugify(e.target.value))} placeholder={slugify(draft.name) || 'black-friday'} />
              </div>
            </label>
          </fieldset>

          {/* ── Targets ── */}
          <fieldset disabled={readOnly} className={`${cardClass} space-y-3`}>
            <legend className="sr-only">Products in the offer</legend>
            <h3 className="font-semibold text-app-text">Products in the offer</h3>
            <p className="text-sm text-app-text-muted">Used by product promotions, category banners and the campaign page.</p>
            <label className={labelClass}>Category
              <SearchableDropdown className="mt-1" placeholder="Any (whole shop page)" selectedValue={draft.target_category ?? ''} onChange={(x) => set('target_category', x)} items={[{ id: '', label: 'Any (whole shop page)' }, ...categories.map((c: any) => { const n = typeof c === 'string' ? c : c.name; return { id: n, label: n }; })]} />
            </label>
            <ProductChooser all={products as any[]} chosen={draft.target_product_ids} onChange={(ids) => set('target_product_ids', ids)} />
          </fieldset>

          {canManage && !readOnly && (
            <div className="sticky bottom-2 z-10 flex justify-end">
              <button type="button" className={`${primaryClass} shadow-lg`} disabled={busy !== null || (!dirty && !isNew)} onClick={save}>
                <Save size={15} /> {busy === 'save' ? 'Saving…' : isNew ? 'Create campaign' : 'Save changes'}
              </button>
            </div>
          )}

          {/* ── Creatives ── */}
          {campaign && (
            <section className={`${cardClass} space-y-3`} aria-label="Creatives">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="font-semibold text-app-text">Creatives <span className="font-normal text-app-text-muted">({creatives.filter((c) => !c.hidden).length})</span></h3>
                {!readOnly && <button type="button" className={primaryClass} onClick={() => setCreative('new')}><Plus size={15} /> Add creative</button>}
              </div>
              {creatives.length === 0 && <p className="text-sm text-app-text-muted">No creatives yet. Add a banner, cards, a video or a message bar.</p>}
              <ul className="divide-y divide-app-border">
                {creatives.map((c) => {
                  const m = c.media_id ? media[c.media_id] : c.poster_media_id ? media[c.poster_media_id] : undefined;
                  return (
                    <li key={c.id} className={`flex items-center gap-3 py-2 ${c.hidden ? 'opacity-50' : ''}`}>
                      <div className="w-14 shrink-0">{m ? <MediaThumb item={m} /> : <div className="grid aspect-square place-items-center rounded-lg bg-app-bg text-[10px] font-semibold text-app-text-muted">TEXT</div>}</div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-app-text">{c.headline || m?.title || 'No words'}</p>
                        <p className="text-xs text-app-text-muted">{PLACEMENTS[c.placement].label} · {FORMATS[c.format].label} ({FORMATS[c.format].shape}){c.mobile_media_id ? ' · with phone version' : ''}{c.hidden ? ' · hidden' : ''}</p>
                      </div>
                      {!readOnly && (
                        <span className="flex gap-1">
                          <button type="button" aria-label="Change creative" className="grid size-9 place-items-center rounded-lg text-app-text-muted hover:bg-app-bg" onClick={() => setCreative(c)}><Pencil size={15} /></button>
                          <button type="button" aria-label="Remove creative" className="grid size-9 place-items-center rounded-lg text-app-text-muted hover:bg-red-500/10 hover:text-red-600" onClick={() => removeOne(c)}><Trash2 size={15} /></button>
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          )}
        </div>

        <div className="space-y-5">
          {campaign && (
            <section className={cardClass} aria-label="Preview">
              <h3 className="mb-2 flex items-center gap-2 font-semibold text-app-text"><Eye size={16} /> Preview</h3>
              <AdPreview campaign={{ name: draft.name, tone: draft.tone, discount_label: draft.discount_label ?? null, cta_label: draft.cta_label ?? null }} creatives={creatives} media={media} shopName={shopName} />
            </section>
          )}

          {campaign && report.data && (
            <section className={cardClass} aria-label="Performance">
              <h3 className="font-semibold text-app-text">Performance</h3>
              {t && t.loads === 0 ? <p className="mt-1 text-sm text-app-text-muted">No figures yet. They start when the campaign shows on your website.</p> : t && (
                <>
                  <StatGrid cols={2} className="mt-2">
                    <StatTile label="Seen" value={count(t.views)} note={`${count(t.loads)} loaded`} />
                    <StatTile label="Clicked" value={count(t.clicks)} note={`Click rate ${percent(clickRate(t))}`} />
                    <StatTile label="Orders after a click" value={count(report.data.orders.count)} />
                    <StatTile label="Their value" value={formatMoney(report.data.orders.value)} />
                  </StatGrid>
                  <ul className="mt-3 space-y-1 text-xs text-app-text-muted">
                    {report.data.byCreative.map((r) => (
                      <li key={r.creativeId} className="flex justify-between gap-2">
                        <span className="truncate">{PLACEMENTS[r.placement].label}: {r.headline || FORMATS[r.format].label}{r.hidden ? ' (hidden)' : ''}</span>
                        <span className="shrink-0">{count(r.views)} seen · {count(r.clicks)} clicks</span>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </section>
          )}

          {loaded.data && loaded.data.events.length > 0 && (
            <section className={cardClass} aria-label="History">
              <h3 className="font-semibold text-app-text">History</h3>
              <ul className="mt-2 space-y-1 text-sm">
                {loaded.data.events.slice(0, 30).map((ev) => (
                  <li key={ev.id} className="flex justify-between gap-3">
                    <span className="text-app-text">{EVENT_LABELS[ev.event] ?? ev.event}{ev.note ? <span className="text-app-text-muted">: {ev.note}</span> : null}</span>
                    <span className="shrink-0 text-xs text-app-text-muted">{formatInZone(ev.at, tz)}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </div>

      {creative && campaign && (
        <CreativeForm
          businessId={businessId}
          campaignId={campaign.id}
          creative={creative === 'new' ? null : creative}
          media={media}
          onMediaChanged={mediaLoad.reload}
          onClose={() => setCreative(null)}
          onSaved={() => { setCreative(null); reloadAll(); }}
        />
      )}
    </div>
  );
}

function ProductChooser({ all, chosen, onChange }: { all: { id: string; name: string }[]; chosen: string[]; onChange: (ids: string[]) => void }) {
  const [q, setQ] = useState('');
  const picked = all.filter((p) => chosen.includes(p.id));
  const found = q.trim() ? all.filter((p) => !chosen.includes(p.id) && p.name.toLowerCase().includes(q.trim().toLowerCase())).slice(0, 8) : [];
  return (
    <div className="space-y-2">
      <span className={labelClass}>Products <span className={hintClass}>Up to 24</span></span>
      {picked.length > 0 && (
        <ul className="flex flex-wrap gap-1.5">
          {picked.map((p) => (
            <li key={p.id}>
              <button type="button" onClick={() => onChange(chosen.filter((x) => x !== p.id))} className="inline-flex items-center gap-1 rounded-full bg-brand-500/15 px-2.5 py-1 text-xs font-medium text-app-text">
                {p.name} <X size={12} aria-label="Remove" />
              </button>
            </li>
          ))}
        </ul>
      )}
      {chosen.length < 24 && <input className={inputClass} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a product to add" aria-label="Find a product to add" />}
      {found.length > 0 && (
        <ul className="rounded-lg border border-app-border">
          {found.map((p) => (
            <li key={p.id}><button type="button" className="block w-full px-3 py-2 text-left text-sm text-app-text hover:bg-app-bg" onClick={() => { onChange([...chosen, p.id]); setQ(''); }}>{p.name}</button></li>
          ))}
        </ul>
      )}
    </div>
  );
}
