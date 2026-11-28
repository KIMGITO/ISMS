// Design presets ("design approaches"): the starting look for a brand. The industry picks a
// personality (INDUSTRIES in brand.ts) and the picture treatment; the personality picks type,
// shapes, spacing and neutral colours. A shop can override any single property on its Brand
// screen, so these are defaults, never rules.
import type { ButtonStyle, CornerStyle, Density, FontName, ImageRatio, ImageStyle, Industry, Personality, PresetId } from './brand';

export interface Preset {
  id: PresetId;
  label: string;
  headingFont: FontName;
  bodyFont: FontName;
  headingWeight: number;
  /** Tighter letter-spacing for heavy sans headings, a touch looser for light serifs. */
  headingTracking: string;
  corners: CornerStyle | 'original';
  buttons: ButtonStyle;
  density: Density;
  /** Neutral colours. `primary` is used only when the shop has not chosen one. */
  page: string;
  ink: string;
  muted: string;
  line: string;
  primary: string;
}

export const PRESETS: Record<PresetId, Preset> = {
  // The website's look before brand profiles existed (theme.css). Existing shops start here.
  original: {
    id: 'original', label: 'Original', headingFont: 'Poppins', bodyFont: 'Poppins', headingWeight: 500,
    headingTracking: '-0.015em', corners: 'original', buttons: 'pill', density: 'comfortable',
    page: '#fffdf9', ink: '#23160e', muted: '#7a6858', line: '#efe5d7', primary: '#c2571a',
  },
  premium: {
    id: 'premium', label: 'Premium', headingFont: 'Cormorant Garamond', bodyFont: 'Manrope', headingWeight: 600,
    headingTracking: '0', corners: 'square', buttons: 'outline', density: 'airy',
    page: '#fbfaf8', ink: '#1c1a17', muted: '#6a655e', line: '#e8e4de', primary: '#1c1a17',
  },
  friendly: {
    id: 'friendly', label: 'Friendly', headingFont: 'Nunito Sans', bodyFont: 'Nunito Sans', headingWeight: 800,
    headingTracking: '-0.01em', corners: 'round', buttons: 'pill', density: 'comfortable',
    page: '#fffefb', ink: '#1f2a24', muted: '#5a665f', line: '#e9ece7', primary: '#2f7d4f',
  },
  bold: {
    id: 'bold', label: 'Bold', headingFont: 'Archivo', bodyFont: 'Inter', headingWeight: 800,
    headingTracking: '-0.025em', corners: 'soft', buttons: 'solid', density: 'compact',
    page: '#ffffff', ink: '#111418', muted: '#565c64', line: '#e3e5e8', primary: '#d4411a',
  },
  classic: {
    id: 'classic', label: 'Classic', headingFont: 'Lora', bodyFont: 'Work Sans', headingWeight: 600,
    headingTracking: '-0.005em', corners: 'soft', buttons: 'solid', density: 'comfortable',
    page: '#fdfcf9', ink: '#1d2433', muted: '#586174', line: '#e6e3dc', primary: '#1f3a5f',
  },
  minimal: {
    id: 'minimal', label: 'Minimal', headingFont: 'Inter', bodyFont: 'Inter', headingWeight: 600,
    headingTracking: '-0.02em', corners: 'square', buttons: 'outline', density: 'airy',
    page: '#ffffff', ink: '#111111', muted: '#626262', line: '#e8e8e8', primary: '#111111',
  },
  natural: {
    id: 'natural', label: 'Natural', headingFont: 'Fraunces', bodyFont: 'DM Sans', headingWeight: 600,
    headingTracking: '-0.01em', corners: 'soft', buttons: 'pill', density: 'comfortable',
    page: '#faf8f2', ink: '#2a2a22', muted: '#65645a', line: '#e6e2d6', primary: '#5b7b4a',
  },
  technical: {
    id: 'technical', label: 'Technical', headingFont: 'Space Grotesk', bodyFont: 'IBM Plex Sans', headingWeight: 600,
    headingTracking: '-0.02em', corners: 'square', buttons: 'solid', density: 'compact',
    page: '#f8f9fb', ink: '#0f172a', muted: '#4f5c70', line: '#dde2ea', primary: '#1d5bd8',
  },
  playful: {
    id: 'playful', label: 'Playful', headingFont: 'Outfit', bodyFont: 'DM Sans', headingWeight: 700,
    headingTracking: '-0.015em', corners: 'round', buttons: 'pill', density: 'comfortable',
    page: '#fffdf7', ink: '#24123a', muted: '#64577a', line: '#efe8f3', primary: '#7b3fe4',
  },
  // Looks made for one kind of business (INDUSTRIES picks them by default).
  fresh: {
    id: 'fresh', label: 'Fresh market', headingFont: 'Plus Jakarta Sans', bodyFont: 'Figtree', headingWeight: 800,
    headingTracking: '-0.025em', corners: 'round', buttons: 'pill', density: 'compact',
    page: '#fcfdf8', ink: '#15241a', muted: '#55645a', line: '#e4eadf', primary: '#1f8a4c',
  },
  editorial: {
    id: 'editorial', label: 'Editorial', headingFont: 'DM Serif Display', bodyFont: 'Figtree', headingWeight: 400,
    headingTracking: '-0.01em', corners: 'square', buttons: 'solid', density: 'airy',
    page: '#faf7f2', ink: '#161412', muted: '#625c55', line: '#e7e1d8', primary: '#161412',
  },
  care: {
    id: 'care', label: 'Care', headingFont: 'Lexend', bodyFont: 'Lexend', headingWeight: 600,
    headingTracking: '-0.015em', corners: 'round', buttons: 'solid', density: 'comfortable',
    page: '#f8fbfc', ink: '#102a33', muted: '#4c6470', line: '#dfe9ed', primary: '#0e7c86',
  },
  workshop: {
    id: 'workshop', label: 'Workshop', headingFont: 'Bebas Neue', bodyFont: 'Barlow', headingWeight: 400,
    headingTracking: '0.01em', corners: 'square', buttons: 'solid', density: 'compact',
    page: '#fbfaf7', ink: '#141414', muted: '#545454', line: '#e2e0db', primary: '#c2410c',
  },
  bistro: {
    id: 'bistro', label: 'Bistro', headingFont: 'EB Garamond', bodyFont: 'Rubik', headingWeight: 600,
    headingTracking: '-0.01em', corners: 'soft', buttons: 'pill', density: 'comfortable',
    page: '#fdf8f1', ink: '#2a1810', muted: '#6e5a4c', line: '#eedfd0', primary: '#a3311f',
  },
};

/** How an industry shows its products: whole on a plain ground, or a photo filling the frame. */
export const INDUSTRY_IMAGES: Record<Industry, { style: ImageStyle; ratio: ImageRatio }> = {
  food_grocery: { style: 'cutout', ratio: 'square' },
  restaurant: { style: 'photo', ratio: 'landscape' },
  beauty: { style: 'photo', ratio: 'portrait' },
  fashion: { style: 'photo', ratio: 'portrait' },
  electronics: { style: 'cutout', ratio: 'square' },
  pharmacy: { style: 'cutout', ratio: 'square' },
  hardware: { style: 'cutout', ratio: 'square' },
  professional_services: { style: 'photo', ratio: 'landscape' },
  logistics: { style: 'photo', ratio: 'landscape' },
  general_retail: { style: 'cutout', ratio: 'square' },
  other: { style: 'photo', ratio: 'square' },
};

export const PERSONALITY_IDS = Object.keys(PRESETS).filter((id) => id !== 'original') as Personality[];
