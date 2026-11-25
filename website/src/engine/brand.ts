// The brand vocabulary: what a shop can say about itself, with the labels the app's Brand
// screen shows. The database checks the same values (20261206001_website_brand.sql), so a new
// option goes in both places. Type-only: the app imports this file.

export type Industry =
  | 'food_grocery' | 'restaurant' | 'beauty' | 'fashion' | 'electronics' | 'pharmacy' | 'hardware'
  | 'professional_services' | 'logistics' | 'general_retail' | 'other';
export type Personality = 'premium' | 'friendly' | 'bold' | 'classic' | 'minimal' | 'natural' | 'technical' | 'playful';
export type Tone = 'warm' | 'formal' | 'confident' | 'playful' | 'plain';
export type PresetId = 'original' | Personality;
export type CornerStyle = 'square' | 'soft' | 'round';
export type ButtonStyle = 'solid' | 'outline' | 'pill';
export type Density = 'compact' | 'comfortable' | 'airy';
export type ImageStyle = 'cutout' | 'photo';
export type ImageRatio = 'square' | 'portrait' | 'landscape';
export type SocialNetwork = 'facebook' | 'instagram' | 'tiktok' | 'x' | 'youtube' | 'linkedin';

/** One opening period. day 0 = Monday ... 6 = Sunday. A day with no period is closed. */
export interface OpeningPeriod {
  day: number;
  open: string;
  close: string;
}

/** The brand as the public website receives it (fn_website_brand_public). Every field optional. */
export interface PublicBrand {
  industry?: Industry;
  personality?: Personality;
  designPreset?: PresetId;
  tagline?: string;
  story?: string;
  mission?: string;
  secondaryColor?: string;
  accentColor?: string;
  backgroundColor?: string;
  headingFont?: FontName;
  bodyFont?: FontName;
  headingWeight?: number;
  cornerStyle?: CornerStyle;
  buttonStyle?: ButtonStyle;
  density?: Density;
  imageStyle?: ImageStyle;
  imageRatio?: ImageRatio;
  logoLightUrl?: string;
  logoMarkUrl?: string;
  faviconUrl?: string;
  socialLinks?: Partial<Record<SocialNetwork, string>>;
  openingHours?: OpeningPeriod[];
}

interface Option<T extends string> {
  id: T;
  label: string;
  hint: string;
}

export const INDUSTRIES: (Option<Industry> & { personality: Personality })[] = [
  { id: 'food_grocery', label: 'Food & groceries', hint: 'Dairy, bakery, grocery, farm produce', personality: 'friendly' },
  { id: 'restaurant', label: 'Restaurant & café', hint: 'Meals, drinks, takeaway', personality: 'natural' },
  { id: 'beauty', label: 'Beauty & personal care', hint: 'Skin care, salon, cosmetics, fragrance', personality: 'premium' },
  { id: 'fashion', label: 'Fashion', hint: 'Clothes, shoes, accessories', personality: 'minimal' },
  { id: 'electronics', label: 'Electronics', hint: 'Phones, computers, appliances', personality: 'technical' },
  { id: 'pharmacy', label: 'Pharmacy & health', hint: 'Chemist, health products', personality: 'classic' },
  { id: 'hardware', label: 'Hardware & building', hint: 'Tools, paint, building materials', personality: 'bold' },
  { id: 'professional_services', label: 'Professional services', hint: 'Consulting, legal, accounting, agencies', personality: 'classic' },
  { id: 'logistics', label: 'Logistics & delivery', hint: 'Courier, transport, moving', personality: 'bold' },
  { id: 'general_retail', label: 'General shop', hint: 'A bit of everything', personality: 'friendly' },
  { id: 'other', label: 'Something else', hint: '', personality: 'classic' },
];

export const PERSONALITIES: Option<Personality>[] = [
  { id: 'premium', label: 'Premium', hint: 'Refined serif headings, quiet colours, generous space' },
  { id: 'friendly', label: 'Friendly', hint: 'Rounded shapes, warm and easy to shop' },
  { id: 'bold', label: 'Bold', hint: 'Strong headings, solid colour, tight layout' },
  { id: 'classic', label: 'Classic', hint: 'Trusted serif headings, calm and orderly' },
  { id: 'minimal', label: 'Minimal', hint: 'Plain type, sharp corners, lots of white' },
  { id: 'natural', label: 'Natural', hint: 'Soft serif, earthy tones, relaxed spacing' },
  { id: 'technical', label: 'Technical', hint: 'Precise type, square shapes, dense details' },
  { id: 'playful', label: 'Playful', hint: 'Round, bright and lively' },
];

export const TONES: Option<Tone>[] = [
  { id: 'warm', label: 'Warm', hint: 'Like a neighbour who knows you' },
  { id: 'formal', label: 'Formal', hint: 'Polite and professional' },
  { id: 'confident', label: 'Confident', hint: 'Direct, sure of the product' },
  { id: 'playful', label: 'Playful', hint: 'Light, fun, a little cheeky' },
  { id: 'plain', label: 'Plain', hint: 'Short and factual' },
];

export const SOCIAL_NETWORKS: { id: SocialNetwork; label: string; host: RegExp }[] = [
  { id: 'facebook', label: 'Facebook', host: /^https:\/\/(www\.|m\.)?(facebook|fb)\.com\//i },
  { id: 'instagram', label: 'Instagram', host: /^https:\/\/(www\.)?instagram\.com\//i },
  { id: 'tiktok', label: 'TikTok', host: /^https:\/\/(www\.)?tiktok\.com\//i },
  { id: 'x', label: 'X (Twitter)', host: /^https:\/\/(www\.)?(x|twitter)\.com\//i },
  { id: 'youtube', label: 'YouTube', host: /^https:\/\/(www\.)?(youtube\.com|youtu\.be)\//i },
  { id: 'linkedin', label: 'LinkedIn', host: /^https:\/\/(www\.)?linkedin\.com\//i },
];

export type FontName =
  | 'Poppins' | 'Inter' | 'DM Sans' | 'Manrope' | 'Work Sans' | 'Nunito Sans' | 'Outfit' | 'Archivo'
  | 'Space Grotesk' | 'IBM Plex Sans' | 'Lora' | 'Playfair Display' | 'Cormorant Garamond' | 'Fraunces' | 'Source Serif 4';

/**
 * The fonts a shop can choose (Google Fonts; the website's CSP allows only that host). Keep in
 * step with fn_website_fonts() in the database. `weights` are the ones the font file offers.
 */
export const FONTS: Record<FontName, { kind: 'sans' | 'serif'; weights: number[] }> = {
  Poppins: { kind: 'sans', weights: [400, 500, 600, 700] },
  Inter: { kind: 'sans', weights: [400, 500, 600, 700, 800] },
  'DM Sans': { kind: 'sans', weights: [400, 500, 600, 700] },
  Manrope: { kind: 'sans', weights: [400, 500, 600, 700, 800] },
  'Work Sans': { kind: 'sans', weights: [400, 500, 600, 700] },
  'Nunito Sans': { kind: 'sans', weights: [400, 600, 700, 800] },
  Outfit: { kind: 'sans', weights: [400, 500, 600, 700, 800] },
  Archivo: { kind: 'sans', weights: [400, 500, 600, 700, 800] },
  'Space Grotesk': { kind: 'sans', weights: [400, 500, 600, 700] },
  'IBM Plex Sans': { kind: 'sans', weights: [400, 500, 600, 700] },
  Lora: { kind: 'serif', weights: [400, 500, 600, 700] },
  'Playfair Display': { kind: 'serif', weights: [400, 500, 600, 700, 800] },
  'Cormorant Garamond': { kind: 'serif', weights: [400, 500, 600, 700] },
  Fraunces: { kind: 'serif', weights: [400, 500, 600, 700, 800] },
  'Source Serif 4': { kind: 'serif', weights: [400, 500, 600, 700] },
};

export const isFont = (name: unknown): name is FontName => typeof name === 'string' && Object.hasOwn(FONTS, name);

/** CSS font-family value with a real fallback stack. */
export function fontStack(name: FontName): string {
  return FONTS[name].kind === 'serif'
    ? `"${name}", ui-serif, Georgia, "Times New Roman", serif`
    : `"${name}", ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif`;
}

const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const SCHEMA_DAYS = DAY_NAMES;

/** "Mon-Fri 08:00-18:00; Sat 09:00-13:00" grouped by identical hours, for people. */
export function hoursText(periods: OpeningPeriod[] | undefined): string | null {
  if (!periods?.length) return null;
  const byDay = new Map<number, string>();
  for (const p of [...periods].sort((a, b) => a.day - b.day || a.open.localeCompare(b.open))) {
    byDay.set(p.day, byDay.has(p.day) ? `${byDay.get(p.day)}, ${p.open}-${p.close}` : `${p.open}-${p.close}`);
  }
  const parts: string[] = [];
  let start = -1;
  for (let d = 0; d <= 7; d++) {
    const cur = byDay.get(d);
    const prev = start >= 0 ? byDay.get(start) : undefined;
    if (start >= 0 && cur !== prev) {
      const name = (i: number) => DAY_NAMES[i].slice(0, 3);
      parts.push(`${d - 1 === start ? name(start) : `${name(start)}-${name(d - 1)}`} ${prev}`);
      start = -1;
    }
    if (start < 0 && cur) start = d;
  }
  return parts.join('; ');
}

/** schema.org openingHoursSpecification for the business's structured data. */
export const hoursJsonLd = (periods: OpeningPeriod[] | undefined) =>
  (periods ?? []).map((p) => ({
    '@type': 'OpeningHoursSpecification',
    dayOfWeek: `https://schema.org/${SCHEMA_DAYS[p.day]}`,
    opens: p.open,
    closes: p.close === '24:00' ? '23:59' : p.close,
  }));
