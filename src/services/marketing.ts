// src/services/marketing.ts
// Marketing & advertising (migration 20261207001): campaigns, creatives, placements, the media
// library, statistics and Canva. Every change goes through a database function that checks the
// permission and the rules; this file only shapes what the screens need.
import { getSupabase } from './supabaseClient';
import { configManager } from './configManager';
import { uploadToStorage } from './upload/storageUpload';
import type { AdFormat, AdPlacement, CampaignState, CampaignStatus, CtaKind, PlacementSettings } from '../../website/src/ads/rules';
import { campaignStatus } from '../../website/src/ads/rules';

async function rpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await getSupabase().rpc(name, args);
  if (error) throw error;
  return data as T;
}

export const MEDIA_BUCKET = 'website-media';

// ─────────────────────────────────────────────── types
export interface Campaign {
  id: string;
  business_id: string;
  name: string;
  description: string | null;
  campaign_type: string;
  objective: string;
  state: CampaignState;
  starts_at: string;
  ends_at: string | null;
  priority: number;
  cta_label: string | null;
  cta_kind: CtaKind;
  cta_target: string | null;
  discount_label: string | null;
  promotion_id: string | null;
  target_product_ids: string[];
  target_category: string | null;
  landing_slug: string | null;
  tone: 'brand' | 'dark' | 'light';
  revision: number;
  published_at: string | null;
  created_at: string;
  updated_at: string;
  /** Worked out from state and the clock, like the website. */
  status: CampaignStatus;
  creative_count?: number;
}

export interface Creative {
  id: string;
  campaign_id: string;
  placement: AdPlacement;
  format: AdFormat;
  media_id: string | null;
  mobile_media_id: string | null;
  poster_media_id: string | null;
  captions_media_id: string | null;
  headline: string | null;
  body: string | null;
  cta_label: string | null;
  alt_text: string | null;
  focal_x: number | null;
  focal_y: number | null;
  text_position: 'left' | 'center' | 'right' | 'none';
  autoplay_muted: boolean;
  hidden: boolean;
  position: number;
}

export interface MediaItem {
  id: string;
  business_id: string;
  kind: 'image' | 'video' | 'captions';
  path: string;
  url: string;
  mime_type: string;
  bytes: number;
  width: number | null;
  height: number | null;
  duration_ms: number | null;
  title: string | null;
  alt_text: string | null;
  folder: string | null;
  focal_x: number;
  focal_y: number;
  source: 'upload' | 'canva';
  canva_design_id: string | null;
  created_at: string;
}

export interface CampaignEvent { id: number; event: string; note: string | null; at: string; actor: string | null }

export interface CampaignDraft {
  id?: string;
  name: string;
  description?: string;
  campaign_type: string;
  objective: string;
  /** In the shop's own time zone, 'YYYY-MM-DDTHH:mm'. */
  starts_local: string;
  ends_local?: string;
  priority: number;
  cta_label?: string;
  cta_kind: CtaKind;
  cta_target?: string;
  discount_label?: string;
  promotion_id?: string | null;
  target_product_ids: string[];
  target_category?: string;
  landing_slug?: string;
  tone: 'brand' | 'dark' | 'light';
}

export type CreativeDraft = Partial<Omit<Creative, 'campaign_id'>> & { placement: AdPlacement; format: AdFormat; mobile_format?: AdFormat };

export interface Totals { loads: number; views: number; clicks: number; conversions: number }
export interface Overview {
  timezone: string;
  counts: Partial<Record<CampaignStatus, number>>;
  totals: Totals;
  orderValue: number;
  byDay: { day: string; views: number; clicks: number }[];
  from: string;
}
export interface CampaignReport {
  byCreative: (Totals & { creativeId: string; placement: AdPlacement; format: AdFormat; headline: string | null; hidden: boolean })[];
  byDay: (Totals & { day: string })[];
  orders: { count: number; value: number };
  problems: string[];
}

const withStatus = (c: Omit<Campaign, 'status'>): Campaign => ({ ...c, status: campaignStatus(c.state, c.starts_at, c.ends_at) });

/** Click-through rate as a percentage of times seen; null when nothing was seen (never a made-up 0%). */
export const clickRate = (t: Pick<Totals, 'views' | 'clicks'>): number | null => (t.views > 0 ? (t.clicks / t.views) * 100 : null);

// ─────────────────────────────────────────────── time zone
/** An instant shown as 'YYYY-MM-DDTHH:mm' in the shop's time zone (for the date boxes). */
export function toZoneLocal(iso: string | null | undefined, timeZone: string): string {
  if (!iso) return '';
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(iso));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '00';
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`;
}

/** A readable date and time in the shop's time zone. */
export function formatInZone(iso: string | null | undefined, timeZone: string): string {
  if (!iso) return '';
  return new Intl.DateTimeFormat(undefined, { timeZone, dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso));
}

export async function getBusinessTimezone(businessId: string): Promise<string> {
  const { data, error } = await getSupabase().from('businesses').select('timezone').eq('id', businessId).maybeSingle();
  if (error) throw error;
  return (data as { timezone?: string } | null)?.timezone || 'Africa/Nairobi';
}

export const setBusinessTimezone = (businessId: string, timezone: string) =>
  rpc<void>('business_set_timezone', { p_business_id: businessId, p_timezone: timezone });

// ─────────────────────────────────────────────── campaigns
export async function listCampaigns(businessId: string): Promise<Campaign[]> {
  const { data, error } = await getSupabase()
    .from('marketing_campaigns')
    .select('*, marketing_creatives(count)')
    .eq('business_id', businessId)
    .order('updated_at', { ascending: false })
    .limit(500);
  if (error) throw error;
  return (data ?? []).map((row: any) => withStatus({ ...row, creative_count: row.marketing_creatives?.[0]?.count ?? 0 }));
}

export async function getCampaign(id: string): Promise<{ campaign: Campaign; creatives: Creative[]; events: CampaignEvent[] }> {
  const sb = getSupabase();
  const [c, r, e] = await Promise.all([
    sb.from('marketing_campaigns').select('*').eq('id', id).single(),
    sb.from('marketing_creatives').select('*').eq('campaign_id', id).order('position'),
    sb.from('marketing_campaign_events').select('id, event, note, at, actor').eq('campaign_id', id).order('at', { ascending: false }).limit(100),
  ]);
  if (c.error) throw c.error;
  if (r.error) throw r.error;
  if (e.error) throw e.error;
  return { campaign: withStatus(c.data as any), creatives: (r.data ?? []) as Creative[], events: (e.data ?? []) as CampaignEvent[] };
}

export const saveCampaign = (businessId: string, draft: CampaignDraft, baseRevision?: number) =>
  rpc<string>('marketing_campaign_save', { p_business_id: businessId, p_campaign: draft, p_base_revision: baseRevision ?? null });

export type CampaignAction = 'publish' | 'unpublish' | 'pause' | 'resume' | 'end' | 'archive' | 'restore';
export const campaignAction = (id: string, action: CampaignAction, note?: string) =>
  rpc<CampaignStatus>('marketing_campaign_action', { p_campaign_id: id, p_action: action, p_note: note ?? null });

export const duplicateCampaign = (id: string) => rpc<string>('marketing_campaign_duplicate', { p_campaign_id: id });
export const saveCreative = (campaignId: string, draft: CreativeDraft) => rpc<string>('marketing_creative_save', { p_campaign_id: campaignId, p_creative: draft });
export const removeCreative = (id: string) => rpc<void>('marketing_creative_remove', { p_creative_id: id });

export const overview = (businessId: string, days = 30) => rpc<Overview>('marketing_overview', { p_business_id: businessId, p_days: days });
export const campaignReport = (id: string) => rpc<CampaignReport>('marketing_campaign_report', { p_campaign_id: id });

/** Recent history across every campaign of the shop (dashboard). */
export async function recentEvents(businessId: string, limit = 12): Promise<(CampaignEvent & { campaign_id: string; name: string })[]> {
  const { data, error } = await getSupabase()
    .from('marketing_campaign_events')
    .select('id, event, note, at, actor, campaign_id, marketing_campaigns(name)')
    .eq('business_id', businessId)
    .in('event', ['published', 'started', 'finished', 'paused', 'resumed', 'ended'])
    .order('at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []).map((r: any) => ({ ...r, name: r.marketing_campaigns?.name ?? '' }));
}

// ─────────────────────────────────────────────── placements
export async function getPlacements(businessId: string): Promise<Partial<Record<AdPlacement, PlacementSettings>>> {
  const { data, error } = await getSupabase().from('marketing_placements').select('*').eq('business_id', businessId);
  if (error) throw error;
  const out: Partial<Record<AdPlacement, PlacementSettings>> = {};
  for (const r of (data ?? []) as any[]) {
    out[r.placement as AdPlacement] = {
      enabled: r.enabled, maxItems: r.max_items, rotation: r.rotation, intervalS: r.interval_s,
      popupDelayS: r.popup_delay_s, popupEveryH: r.popup_every_h,
    };
  }
  return out;
}

export const savePlacement = (businessId: string, placement: AdPlacement, s: PlacementSettings) =>
  rpc<void>('marketing_placement_save', {
    p_business_id: businessId, p_placement: placement,
    p_settings: { enabled: s.enabled, max_items: s.maxItems, rotation: s.rotation, interval_s: s.intervalS, popup_delay_s: s.popupDelayS, popup_every_h: s.popupEveryH },
  });

// ─────────────────────────────────────────────── media library
export async function listMedia(businessId: string): Promise<MediaItem[]> {
  const { data, error } = await getSupabase()
    .from('website_media')
    .select('*')
    .eq('business_id', businessId)
    .order('created_at', { ascending: false })
    .limit(1000);
  if (error) throw error;
  return (data ?? []) as MediaItem[];
}

export const updateMedia = (id: string, meta: Partial<Pick<MediaItem, 'title' | 'alt_text' | 'folder' | 'focal_x' | 'focal_y'>>) =>
  rpc<void>('website_media_update', { p_media_id: id, p_meta: meta });

/** Removes media no campaign uses; deletes the stored file when nothing ever referred to it. */
export async function removeMedia(id: string): Promise<void> {
  const path = await rpc<string | null>('website_media_remove', { p_media_id: id });
  if (path) await getSupabase().storage.from(MEDIA_BUCKET).remove([path]).catch(() => undefined);
}

export const MEDIA_LIMITS = { imageBytes: 10 * 1024 * 1024, videoBytes: 50 * 1024 * 1024, captionBytes: 200 * 1024, videoSeconds: 180, maxSide: 8000 } as const;

const IMAGE_TYPES: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/avif': 'avif', 'image/gif': 'gif' };
const VIDEO_TYPES: Record<string, string> = { 'video/mp4': 'mp4', 'video/webm': 'webm' };

export type MediaKind = 'image' | 'video' | 'captions';

/** What kind of file this is, from its type and name; null when it is not accepted. */
export function acceptedKind(file: { type: string; name: string }): MediaKind | null {
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  if (IMAGE_TYPES[file.type]) return 'image';
  if (VIDEO_TYPES[file.type]) return 'video';
  if ((file.type === 'text/vtt' || file.type === '') && ext === 'vtt') return 'captions';
  return null;
}

/** Plain-words problem with a file before it is sent, or '' when fine. */
export function fileProblem(file: { type: string; name: string; size: number }): string {
  const kind = acceptedKind(file);
  if (!kind) return 'Use a JPG, PNG, WebP, AVIF or GIF picture, an MP4 or WebM video, or a .vtt captions file.';
  if (kind === 'image' && file.size > MEDIA_LIMITS.imageBytes * 3) return 'That picture is over 30 MB. Export it smaller.';
  if (kind === 'video' && file.size > MEDIA_LIMITS.videoBytes) return 'Videos can be up to 50 MB. Export it at 1080p or lower.';
  if (kind === 'captions' && file.size > MEDIA_LIMITS.captionBytes) return 'Captions files can be up to 200 KB.';
  return '';
}

/** Width and height of a picture (after phone rotation). */
async function imageSize(blob: Blob): Promise<{ width: number; height: number }> {
  const bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' } as ImageBitmapOptions);
  const size = { width: bitmap.width, height: bitmap.height };
  bitmap.close();
  return size;
}

/** Width, height and length of a video, read by the browser without playing it. */
function videoInfo(file: Blob): Promise<{ width: number; height: number; durationMs: number; video: HTMLVideoElement; url: string }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const v = document.createElement('video');
    v.preload = 'metadata';
    v.muted = true;
    v.playsInline = true;
    v.onloadedmetadata = () => resolve({ width: v.videoWidth, height: v.videoHeight, durationMs: Math.round(v.duration * 1000), video: v, url });
    v.onerror = () => { URL.revokeObjectURL(url); reject(new Error('This video cannot be read. Export it as MP4 (H.264) and try again.')); };
    v.src = url;
  });
}

/** A still from about one second in, as the video's cover picture. */
async function videoStill(v: HTMLVideoElement): Promise<Blob | null> {
  await new Promise<void>((resolve) => {
    v.onseeked = () => resolve();
    v.currentTime = Math.min(1, (v.duration || 2) / 2);
    setTimeout(resolve, 3000);
  });
  const canvas = document.createElement('canvas');
  const scale = Math.min(1, 1920 / Math.max(v.videoWidth, v.videoHeight));
  canvas.width = Math.round(v.videoWidth * scale);
  canvas.height = Math.round(v.videoHeight * scale);
  canvas.getContext('2d')?.drawImage(v, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/webp', 0.85));
}

/** Pictures above 2560 px on the long side are shrunk (WebP); smaller ones are kept as they are. */
async function prepareImage(file: File): Promise<{ blob: Blob; width: number; height: number; type: string }> {
  const { width, height } = await imageSize(file);
  const longest = Math.max(width, height);
  if (file.type === 'image/gif' || (longest <= 2560 && file.size <= MEDIA_LIMITS.imageBytes)) {
    return { blob: file, width, height, type: file.type };
  }
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' } as ImageBitmapOptions);
  const scale = Math.min(1, 2560 / longest);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/webp', 0.88));
  if (!blob) throw new Error('This picture could not be prepared. Try a JPG or PNG.');
  return { blob, width: canvas.width, height: canvas.height, type: 'image/webp' };
}

async function sendAndRegister(
  businessId: string, blob: Blob, type: string, ext: string, meta: Record<string, unknown>, onProgress?: (p: number) => void,
): Promise<string> {
  const path = `${businessId}/${meta.kind === 'video' ? 'videos' : meta.kind === 'captions' ? 'captions' : 'pictures'}/${Date.now()}-${crypto.randomUUID().slice(0, 8)}.${ext}`;
  await uploadToStorage(MEDIA_BUCKET, path, blob, { contentType: type, cacheControl: '31536000', upsert: false }, onProgress);
  const url = getSupabase().storage.from(MEDIA_BUCKET).getPublicUrl(path).data.publicUrl;
  const { kind: _k, ...rest } = meta;
  try {
    return await rpc<string>('website_media_register', { p_business_id: businessId, p_path: path, p_meta: { ...rest, url } });
  } catch (e) {
    // Refused (wrong type, too large, storage full): don't leave the file behind.
    await getSupabase().storage.from(MEDIA_BUCKET).remove([path]).catch(() => undefined);
    throw e;
  }
}

export interface UploadOptions {
  title?: string;
  alt_text?: string;
  folder?: string;
  source?: 'upload' | 'canva';
  canva_design_id?: string;
  onProgress?: (percent: number) => void;
}

/**
 * Checks, prepares and stores one file, then registers it. Videos also get a cover picture taken
 * from the video itself (returned as posterId). The database checks the stored file's real size
 * and type again, so nothing relies on this check alone.
 */
export async function uploadMedia(businessId: string, file: File, opts: UploadOptions = {}): Promise<{ id: string; posterId?: string }> {
  const problem = fileProblem(file);
  if (problem) throw new Error(problem);
  const kind = acceptedKind(file)!;
  const base = { title: opts.title ?? file.name.replace(/\.[^.]+$/, '').slice(0, 120), alt_text: opts.alt_text, folder: opts.folder, source: opts.source, canva_design_id: opts.canva_design_id };
  if (kind === 'captions') {
    const text = await file.text();
    if (!text.trimStart().startsWith('WEBVTT')) throw new Error('This is not a WebVTT captions file (it must start with WEBVTT).');
    return { id: await sendAndRegister(businessId, new Blob([text], { type: 'text/vtt' }), 'text/vtt', 'vtt', { ...base, kind }, opts.onProgress) };
  }
  if (kind === 'image') {
    const img = await prepareImage(file);
    if (img.blob.size > MEDIA_LIMITS.imageBytes) throw new Error('That picture is still over 10 MB after shrinking. Export it smaller.');
    return { id: await sendAndRegister(businessId, img.blob, img.type, IMAGE_TYPES[img.type], { ...base, kind, width: img.width, height: img.height }, opts.onProgress) };
  }
  const info = await videoInfo(file);
  try {
    if (!info.width || !info.height) throw new Error('This video has no picture track.');
    if (info.durationMs > MEDIA_LIMITS.videoSeconds * 1000) throw new Error('Videos can be up to 3 minutes long.');
    if (info.durationMs < 1000) throw new Error('This video is shorter than one second.');
    const id = await sendAndRegister(businessId, file, file.type, VIDEO_TYPES[file.type], { ...base, kind, width: info.width, height: info.height, duration_ms: info.durationMs }, (p) => opts.onProgress?.(Math.round(p * 0.9)));
    let posterId: string | undefined;
    const still = await videoStill(info.video).catch(() => null);
    if (still) {
      const size = await imageSize(still).catch(() => null);
      if (size) {
        posterId = await sendAndRegister(businessId, still, 'image/webp', 'webp',
          { kind: 'image', title: `${base.title} (cover)`.slice(0, 120), alt_text: base.alt_text, folder: base.folder, width: size.width, height: size.height }).catch(() => undefined);
      }
    }
    opts.onProgress?.(100);
    return { id, posterId };
  } finally {
    URL.revokeObjectURL(info.url);
  }
}

// ─────────────────────────────────────────────── Canva (supabase/functions/canva-connect)
export interface CanvaStatus { configured: boolean; connected: boolean; name?: string | null }
export interface CanvaDesign { id: string; title: string; thumbnail?: string | null; editUrl?: string | null; updatedAt?: string | null }

async function canva<T>(body: Record<string, unknown>): Promise<T> {
  const { supabaseUrl, supabaseAnonKey } = configManager.getConfig();
  const { data } = await getSupabase().auth.getSession();
  const res = await fetch(`${supabaseUrl.replace(/\/+$/, '')}/functions/v1/canva-connect`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: supabaseAnonKey, Authorization: `Bearer ${data.session?.access_token ?? supabaseAnonKey}` },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(json.error || `Canva request failed (${res.status})`), { code: json.code });
  return json as T;
}

export const canvaStatus = (businessId: string) => canva<CanvaStatus>({ action: 'status', businessId });
export const canvaConnect = (businessId: string, returnTo?: string) => canva<{ url: string }>({ action: 'authorize', businessId, returnTo });
export const canvaDisconnect = (businessId: string) => canva<{ ok: true }>({ action: 'disconnect', businessId });
export const canvaCreateDesign = (businessId: string, format: AdFormat, title: string) => canva<{ designId: string; editUrl: string }>({ action: 'create', businessId, format, title });
export const canvaListDesigns = (businessId: string, query?: string, continuation?: string) =>
  canva<{ designs: CanvaDesign[]; continuation?: string | null }>({ action: 'list', businessId, query, continuation });
export const canvaEditUrl = (businessId: string, designId: string) => canva<{ editUrl: string }>({ action: 'edit', businessId, designId });
/** Exports the design from Canva and stores it in the media library. Videos come back as MP4. */
export const canvaImport = (businessId: string, designId: string, format: AdFormat, title?: string, altText?: string) =>
  canva<{ mediaId: string; posterId?: string }>({ action: 'import', businessId, designId, format, title, altText });
