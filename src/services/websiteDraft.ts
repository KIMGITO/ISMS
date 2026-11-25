// The website draft (20261206002). Every Website screen edits one document; Save puts a part of
// it in the draft, Publish puts the whole draft live and keeps a numbered version, and any
// version can be put back. The database checks every value on save and again on publish, and
// decides who may do it (business.update); nothing here is trusted for that.
import type { HeroSlide } from '../../website/src/heroSlides';
import type { AdCard } from '../../website/src/adCards';
import type { HomeSection } from '../../website/src/engine/layout';
import type { MenuLink } from '../../website/src/engine/navigation';
import type { BrandRecord } from './websiteBrand';
import { getSupabase } from './supabaseClient';

export interface WebsiteDocument {
  brand: BrandRecord;
  /** Home page arrangement; null = the suggested layout for the brand. */
  home: HomeSection[] | null;
  heroSlides: HeroSlide[];
  adCards: AdCard[];
  pages: Record<string, string>;
  /** Header menu; null = the menu for the shop's industry. */
  navigation: { header: MenuLink[] } | null;
  seo: { title?: string; description?: string; shareImage?: string } | null;
  contact: { openingHours: string | null; whatsapp: string | null };
}

export type WebsitePart = keyof WebsiteDocument;

export interface PublishedInfo {
  number: number;
  at: string;
  by: string | null;
  kind: 'start' | 'publish' | 'rollback';
}

export interface DraftState {
  document: WebsiteDocument;
  /** 0 = no draft: the document is what is live. */
  revision: number;
  /** The draft differs from the live website. */
  changed: boolean;
  savedAt: string | null;
  savedBy: string | null;
  published: PublishedInfo | null;
}

export interface WebsiteVersion {
  id: string;
  number: number;
  kind: 'start' | 'publish' | 'rollback';
  note: string | null;
  created_by_name: string | null;
  created_at: string;
}

export interface WebsiteStats {
  days: number;
  orders: number;
  paidOrders: number;
  revenue: number;
  /** visits per day once the visit counter is in the database (20261208001). */
  byDay: { day: string; orders: number; revenue: number; visits?: number }[];
  topProducts: { name: string; quantity: number }[];
  visitsCounted: boolean;
  /** The rest exist once visitsCounted is true. A visit = a page opened from outside the website. */
  views?: number;
  visits?: number;
  sources?: { source: 'direct' | 'search' | 'social' | 'site'; visits: number }[];
  pages?: { page: string; views: number }[];
  /** First day anything was counted for this shop (null: nothing yet). */
  countingSince?: string | null;
}

async function call<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await getSupabase().rpc(fn, args);
  if (error) throw error;
  return data as T;
}

export const loadDraft = (businessId: string) => call<DraftState>('website_draft_get', { p_business_id: businessId });

/** Saves some parts of the document into the draft. Fails if someone saved since `revision`. */
export const saveDraft = (businessId: string, parts: Partial<WebsiteDocument>, revision: number) =>
  call<{ revision: number; changed: boolean }>('website_draft_save', { p_business_id: businessId, p_document: parts, p_base_revision: revision });

export const discardDraft = (businessId: string) => call<void>('website_draft_discard', { p_business_id: businessId });

export const publishDraft = (businessId: string, revision: number, note: string) =>
  call<{ number: number }>('website_publish', { p_business_id: businessId, p_base_revision: revision, p_note: note.trim() || null });

export const putBackVersion = (businessId: string, versionId: string) =>
  call<{ number: number }>('website_rollback', { p_business_id: businessId, p_version_id: versionId });

export async function listVersions(businessId: string): Promise<WebsiteVersion[]> {
  const { data, error } = await getSupabase()
    .from('website_versions')
    .select('id, number, kind, note, created_by_name, created_at')
    .eq('business_id', businessId)
    .order('number', { ascending: false })
    .limit(50);
  if (error) throw error;
  return (data ?? []) as WebsiteVersion[];
}

/** A two-hour link that shows the draft on the shop's own address. */
export const makePreviewLink = (businessId: string) =>
  call<{ secret: string; expiresAt: string; slug: string; host: string | null }>('website_preview_link', { p_business_id: businessId });

export const loadWebsiteStats = (businessId: string, days: number) =>
  call<WebsiteStats>('website_stats', { p_business_id: businessId, p_days: days });

/** Someone else saved first: the screen offers Reload instead of an error. */
export const isConflict = (err: unknown) => /Someone else saved the website/.test(String((err as { message?: string })?.message ?? ''));
