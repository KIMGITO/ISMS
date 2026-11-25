// The shop's website brand (20261206001). The Brand and Design screens edit it inside the
// website draft (websiteDraft.ts); Publish writes it to businesses and website_brand together.
// loadBrand reads another shop's live brand for "Copy brand from another shop".
import type { PublicBrand } from '../../website/src/engine/brand';
import { getSupabase } from './supabaseClient';

/** Columns of website_brand plus the brand facts kept on businesses. snake_case, as saved. */
export interface BrandRecord {
  description: string | null;
  logo_url: string | null;
  primary_color: string | null;
  secondary_color: string | null;
  industry: string;
  personality: string | null;
  tone: string;
  design_preset: string | null;
  tagline: string | null;
  story: string | null;
  mission: string | null;
  audience: string | null;
  positioning: string | null;
  guidelines: string | null;
  accent_color: string | null;
  background_color: string | null;
  heading_font: string | null;
  body_font: string | null;
  heading_weight: number | null;
  corner_style: string | null;
  button_style: string | null;
  density: string | null;
  image_style: string | null;
  image_ratio: string | null;
  logo_light_url: string | null;
  logo_mark_url: string | null;
  favicon_url: string | null;
  social_links: Record<string, string>;
  opening_hours: { day: number; open: string; close: string }[];
}

export async function loadBrand(businessId: string): Promise<BrandRecord> {
  const db = getSupabase();
  const [biz, brand] = await Promise.all([
    db.from('businesses').select('description, logo_url, primary_color, secondary_color').eq('id', businessId).single(),
    db.from('website_brand').select('*').eq('business_id', businessId).maybeSingle(),
  ]);
  if (biz.error) throw biz.error;
  if (brand.error) throw brand.error;
  const { business_id: _id, created_at: _c, updated_at: _u, updated_by: _by, ...b } = (brand.data ?? {}) as Partial<BrandRecord> & Record<string, unknown>;
  return {
    industry: 'general_retail', personality: null, tone: 'warm', design_preset: null, tagline: null, story: null,
    mission: null, audience: null, positioning: null, guidelines: null, accent_color: null, background_color: null,
    heading_font: null, body_font: null, heading_weight: null, corner_style: null, button_style: null, density: null,
    image_style: null, image_ratio: null, logo_light_url: null, logo_mark_url: null, favicon_url: null,
    ...b,
    social_links: b.social_links ?? {},
    opening_hours: b.opening_hours ?? [],
    description: biz.data.description,
    logo_url: biz.data.logo_url,
    primary_color: biz.data.primary_color || null,
    secondary_color: biz.data.secondary_color || null,
  };
}

/** The record as the website receives it, so the preview renders exactly what visitors will see. */
export function toPublicBrand(r: BrandRecord): PublicBrand {
  const v = <T,>(x: T | null | undefined) => (x === null || x === '' ? undefined : x) as never;
  return {
    industry: v(r.industry), personality: v(r.personality), designPreset: v(r.design_preset), tagline: v(r.tagline),
    story: v(r.story), mission: v(r.mission), secondaryColor: v(r.secondary_color), accentColor: v(r.accent_color),
    backgroundColor: v(r.background_color), headingFont: v(r.heading_font), bodyFont: v(r.body_font),
    headingWeight: v(r.heading_weight), cornerStyle: v(r.corner_style), buttonStyle: v(r.button_style),
    density: v(r.density), imageStyle: v(r.image_style), imageRatio: v(r.image_ratio), logoLightUrl: v(r.logo_light_url),
    logoMarkUrl: v(r.logo_mark_url), faviconUrl: v(r.favicon_url),
    socialLinks: Object.keys(r.social_links).length ? (r.social_links as PublicBrand['socialLinks']) : undefined,
    openingHours: r.opening_hours.length ? r.opening_hours : undefined,
  };
}
