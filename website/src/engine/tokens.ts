// Brand -> design tokens. One function turns a shop's brand profile into the CSS variables
// every website component reads (theme.css names), the fonts to load, and notes about any
// colour it had to adjust. The Worker puts the result in each page's <head>, so the first paint
// is already in the shop's colours; the app's preview uses the same function.
import { FONTS, fontStack, INDUSTRIES, isFont, type FontName, type Industry, type PresetId, type PublicBrand } from './brand';
import { AA_TEXT, contrast, ensureContrast, isHex, mix, readableOn } from './color';
import { INDUSTRY_IMAGES, PRESETS, type Preset } from './presets';

export interface ResolvedDesign {
  preset: Preset;
  industry: Industry;
  primary: string;
  primaryChosen: boolean;
  secondary: string | null;
  accent: string | null;
  page: string;
  headingFont: FontName;
  bodyFont: FontName;
  headingWeight: number;
  corners: Preset['corners'];
  buttons: Preset['buttons'];
  density: Preset['density'];
  imageStyle: 'cutout' | 'photo';
  imageRatio: 'square' | 'portrait' | 'landscape';
}

export interface TokenNote {
  /** Which colour was changed and why, for the Brand screen and the quality checks. */
  token: 'primary' | 'secondary' | 'accent' | 'muted';
  message: string;
}

export interface DesignTokens {
  design: ResolvedDesign;
  vars: Record<string, string>;
  /** Google Fonts stylesheet for the chosen fonts and weights. */
  fontHref: string;
  notes: TokenNote[];
}

/** The preset a brand starts from: chosen, else its personality, else its industry's. */
export function presetFor(brand: PublicBrand | undefined): PresetId {
  if (brand?.designPreset && PRESETS[brand.designPreset]) return brand.designPreset;
  if (brand?.personality && PRESETS[brand.personality]) return brand.personality;
  const industry = INDUSTRIES.find((i) => i.id === brand?.industry) ?? INDUSTRIES.find((i) => i.id === 'general_retail')!;
  return industry.personality;
}

/** Preset defaults with the shop's own choices on top. Anything invalid falls back quietly. */
export function resolveDesign(primaryColor: string | null | undefined, brand: PublicBrand | undefined): ResolvedDesign {
  const preset = PRESETS[presetFor(brand)];
  const industry: Industry = INDUSTRIES.some((i) => i.id === brand?.industry) ? brand!.industry! : 'general_retail';
  const images = INDUSTRY_IMAGES[industry];
  const headingFont = isFont(brand?.headingFont) ? brand!.headingFont! : preset.headingFont;
  const weights = FONTS[headingFont].weights;
  const wantWeight = brand?.headingWeight ?? preset.headingWeight;
  // The nearest weight the font really has, so the browser never fakes bold.
  const headingWeight = weights.reduce((best, w) => (Math.abs(w - wantWeight) < Math.abs(best - wantWeight) ? w : best), weights[0]);
  const page = isHex(brand?.backgroundColor) && contrast(brand!.backgroundColor!, '#000000') >= 15 ? brand!.backgroundColor!.toLowerCase() : preset.page;
  return {
    preset,
    industry,
    primary: isHex(primaryColor) ? primaryColor.toLowerCase() : preset.primary,
    primaryChosen: isHex(primaryColor),
    secondary: isHex(brand?.secondaryColor) ? brand!.secondaryColor!.toLowerCase() : null,
    accent: isHex(brand?.accentColor) ? brand!.accentColor!.toLowerCase() : null,
    page,
    headingFont,
    bodyFont: isFont(brand?.bodyFont) && !FONTS[brand!.bodyFont!].headingOnly ? brand!.bodyFont! : preset.bodyFont,
    headingWeight,
    corners: brand?.cornerStyle ?? preset.corners,
    buttons: brand?.buttonStyle ?? preset.buttons,
    density: brand?.density ?? preset.density,
    imageStyle: brand?.imageStyle ?? (preset.id === 'original' ? 'cutout' : images.style),
    imageRatio: brand?.imageRatio ?? (preset.id === 'original' ? 'square' : images.ratio),
  };
}

const RADII: Record<ResolvedDesign['corners'], [string, string, string, string, string]> = {
  original: ['6px', '8px', '12px', '16px', '24px'],
  square: ['2px', '2px', '3px', '4px', '4px'],
  soft: ['4px', '6px', '8px', '10px', '14px'],
  round: ['8px', '12px', '16px', '20px', '28px'],
};

const SECTION_SPACE: Record<ResolvedDesign['density'], [string, string]> = {
  compact: ['1.75rem', '2.5rem'],
  comfortable: ['2.25rem', '3.5rem'],
  airy: ['3rem', '5rem'],
};

const RATIO = { square: '1 / 1', portrait: '4 / 5', landscape: '4 / 3' } as const;

function fontHref(design: ResolvedDesign): string {
  const families = new Map<FontName, Set<number>>();
  const add = (font: FontName, weights: number[]) => {
    const set = families.get(font) ?? new Set<number>();
    weights.filter((w) => FONTS[font].weights.includes(w)).forEach((w) => set.add(w));
    families.set(font, set);
  };
  add(design.bodyFont, [400, 500, 600, 700]);
  add(design.headingFont, [design.headingWeight]);
  const query = [...families]
    .map(([font, weights]) => `family=${font.replace(/ /g, '+')}:wght@${[...weights].sort((a, b) => a - b).join(';')}`)
    .join('&');
  return `https://fonts.googleapis.com/css2?${query}&display=swap`;
}

/** Every token for one brand. */
export function buildTokens(primaryColor: string | null | undefined, brand: PublicBrand | undefined): DesignTokens {
  const d = resolveDesign(primaryColor, brand);
  const p = d.preset;
  const notes: TokenNote[] = [];
  const original = p.id === 'original';
  const page = d.page;
  const ink = ensureContrast(p.ink, page, 12);
  const shell = mix(page, ink, 0.03);
  const muted = ensureContrast(p.muted, shell, AA_TEXT);

  // The action colour: buttons and links. It is also used as text, so it must read on the page.
  // The original look keeps its ember buttons and uses the shop's colour for small accents only.
  const wantedAction = original ? '#c2571a' : d.primary;
  const action = ensureContrast(wantedAction, page, AA_TEXT);
  if (!original && action !== wantedAction && d.primaryChosen) {
    notes.push({ token: 'primary', message: `Your main colour ${d.primary} is too light to read on the page, so buttons and links use a deeper shade (${action}).` });
  }
  const brandText = original ? ensureContrast(d.primary, page, AA_TEXT) : action;
  if (original && d.primaryChosen && brandText !== d.primary) {
    notes.push({ token: 'primary', message: `Your main colour ${d.primary} is too light to read on the page, so a deeper shade (${brandText}) is used for text.` });
  }
  const actionHover = mix(action, '#000000', 0.18);

  // Dark bands (banners, footer): the secondary colour when set, else a deep shade of the main one.
  const wantedBand = d.secondary ?? (original ? '#2b1409' : mix(d.primary, ink, 0.78));
  const band = ensureContrast(wantedBand, '#ffffff', 7);
  if (d.secondary && band !== d.secondary) {
    notes.push({ token: 'secondary', message: `White text is hard to read on your second colour ${d.secondary}, so banners use a deeper shade (${band}).` });
  }

  // Offer ribbons and highlights: the accent colour, else the action colour.
  const accent = d.accent ?? action;
  const onAccent = readableOn(accent, ink, '#ffffff');
  if (d.accent && contrast(accent, onAccent) < AA_TEXT) {
    notes.push({ token: 'accent', message: `Text on your accent colour ${d.accent} may be hard to read; choose a deeper or lighter shade.` });
  }

  const tintBase = original ? '#c2571a' : d.primary;
  const radii = RADII[d.corners];
  const [spaceSm, spaceLg] = SECTION_SPACE[d.density];
  const vars: Record<string, string> = {
    '--font-sans': fontStack(d.bodyFont),
    '--font-display': fontStack(d.headingFont),
    '--heading-weight': String(d.headingWeight),
    '--heading-tracking': p.headingTracking,
    '--color-brand': brandText,
    '--color-on-brand': readableOn(brandText, ink, '#ffffff'),
    '--color-ember': action,
    '--color-on-ember': readableOn(action, ink, '#ffffff'),
    '--color-brand-deep': actionHover,
    '--color-hero': band,
    '--color-accent': accent,
    '--color-on-accent': onAccent,
    '--btn-radius': d.buttons === 'pill' ? '999px' : radii[1],
    '--btn-bg': d.buttons === 'outline' ? 'transparent' : action,
    '--btn-fg': d.buttons === 'outline' ? action : readableOn(action, ink, '#ffffff'),
    '--section-space': spaceSm,
    '--section-space-lg': spaceLg,
    '--img-fit': d.imageStyle === 'photo' ? 'cover' : 'contain',
    '--img-ratio': RATIO[d.imageRatio],
    '--img-pad': d.imageStyle === 'photo' ? '0' : '0.5rem',
    '--img-pad-lg': d.imageStyle === 'photo' ? '0' : '0.75rem',
  };
  if (!original || d.corners !== 'original') {
    Object.assign(vars, {
      '--radius-sm': radii[0], '--radius-md': radii[1], '--radius-lg': radii[2], '--radius-xl': radii[3], '--radius-2xl': radii[4],
    });
  }
  if (!original || page !== p.page) {
    const sand = mix(page, tintBase, 0.07);
    const sandDeep = mix(page, tintBase, 0.16);
    Object.assign(vars, {
      '--color-cream': page,
      '--color-shell': shell,
      '--color-sand': sand,
      '--color-sand-deep': sandDeep,
      '--color-ink': ink,
      '--color-muted': muted,
      '--color-line': mix(page, ink, 0.09),
      '--color-amber-50': mix(page, tintBase, 0.04),
      '--color-amber-100': sand,
      '--color-gray-50': shell,
      '--color-gray-200': sandDeep,
      '--color-gray-600': muted,
      '--color-tint-sand': sand,
      '--color-tint-peach': mix(page, tintBase, 0.13),
      '--color-tint-butter': mix(page, d.accent ?? '#e7a019', 0.15),
      '--color-tint-sage': mix(page, d.secondary ?? '#2f6b45', 0.1),
      '--color-tint-blush': mix(page, '#d9576b', 0.1),
    });
  }
  if (contrast(muted, page) < AA_TEXT) notes.push({ token: 'muted', message: 'Small grey text is close to the readability limit on this background.' });
  return { design: d, vars, fontHref: fontHref(d), notes };
}

/** `:root{...}` for a <style> tag. Values come from validated inputs; anything odd is dropped. */
export function tokensCss(tokens: DesignTokens): string {
  const safe = /^[#a-z0-9 ,.'"()/%+-]+$/i;
  const body = Object.entries(tokens.vars)
    .filter(([k, v]) => /^--[a-z0-9-]+$/.test(k) && safe.test(v))
    .map(([k, v]) => `${k}:${v}`)
    .join(';');
  return `:root{${body}}`;
}
