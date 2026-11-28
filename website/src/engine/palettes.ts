// Ready colour sets for the Brand screen: one tap fills the four colour fields (main, second,
// accent, page background). They are only a starting point; every field stays editable and goes
// through the same contrast fixes as a hand-picked colour (tokens.ts). Backgrounds are all light
// enough for the database rule (fn_hex_luminance >= 0.75).
import type { Industry } from './brand';

export interface Palette {
  id: string;
  label: string;
  /** Kinds of business it suits, best first. Empty = any. */
  industries: Industry[];
  primary: string;
  secondary: string;
  accent: string;
  background: string;
}

export const PALETTES: Palette[] = [
  { id: 'market-green', label: 'Market green', industries: ['food_grocery', 'general_retail'], primary: '#1f8a4c', secondary: '#123d27', accent: '#f2a516', background: '#fcfdf8' },
  { id: 'citrus', label: 'Citrus', industries: ['food_grocery', 'restaurant'], primary: '#e25d12', secondary: '#3a1e0c', accent: '#f6c445', background: '#fffaf2' },
  { id: 'dairy-blue', label: 'Dairy blue', industries: ['food_grocery'], primary: '#1e5fae', secondary: '#0f2d55', accent: '#f4b63f', background: '#f9fbff' },
  { id: 'tomato', label: 'Tomato and cream', industries: ['restaurant', 'food_grocery'], primary: '#b8321e', secondary: '#2e1610', accent: '#e9a23b', background: '#fdf8f1' },
  { id: 'espresso', label: 'Espresso', industries: ['restaurant'], primary: '#7a4a2a', secondary: '#24150d', accent: '#c8963e', background: '#fbf6ef' },
  { id: 'blush', label: 'Blush', industries: ['beauty', 'fashion'], primary: '#b0476a', secondary: '#3b1a28', accent: '#e8b4a0', background: '#fdf8f7' },
  { id: 'sage-spa', label: 'Sage spa', industries: ['beauty', 'pharmacy'], primary: '#4f7a62', secondary: '#1f3328', accent: '#d9b98c', background: '#f8faf6' },
  { id: 'noir', label: 'Noir', industries: ['fashion', 'beauty'], primary: '#161412', secondary: '#161412', accent: '#b8865b', background: '#faf7f2' },
  { id: 'denim', label: 'Denim', industries: ['fashion', 'general_retail'], primary: '#2f4f7f', secondary: '#16243b', accent: '#e0a96d', background: '#f8f9fb' },
  { id: 'electric', label: 'Electric', industries: ['electronics'], primary: '#1d5bd8', secondary: '#0b1a3d', accent: '#18c29c', background: '#f8f9fb' },
  { id: 'graphite', label: 'Graphite and lime', industries: ['electronics', 'logistics'], primary: '#2b3440', secondary: '#111820', accent: '#9ccc2c', background: '#f7f8f9' },
  { id: 'clinic', label: 'Clinic teal', industries: ['pharmacy', 'professional_services'], primary: '#0e7c86', secondary: '#0b3a40', accent: '#f08a5d', background: '#f8fbfc' },
  { id: 'safety', label: 'Safety orange', industries: ['hardware', 'logistics'], primary: '#c2410c', secondary: '#1c1917', accent: '#facc15', background: '#fbfaf7' },
  { id: 'site-yellow', label: 'Site yellow', industries: ['hardware'], primary: '#1c1917', secondary: '#1c1917', accent: '#f5b800', background: '#fffcf2' },
  { id: 'navy-gold', label: 'Navy and gold', industries: ['professional_services', 'pharmacy'], primary: '#1f3a5f', secondary: '#0f1f35', accent: '#c9a227', background: '#fdfcf9' },
  { id: 'courier-red', label: 'Courier red', industries: ['logistics'], primary: '#c8102e', secondary: '#1a1a1a', accent: '#ffb81c', background: '#fafafa' },
  { id: 'violet-pop', label: 'Violet pop', industries: ['general_retail', 'beauty'], primary: '#7b3fe4', secondary: '#24123a', accent: '#ff7a59', background: '#fffdf7' },
  { id: 'ember', label: 'Ember (original)', industries: [], primary: '#c2571a', secondary: '#2b1409', accent: '#e7a019', background: '#fffdf9' },
];

/** Sets for this kind of business first (in their order of fit), then the rest. */
export function palettesFor(industry: Industry | null | undefined): Palette[] {
  if (!industry) return PALETTES;
  const rank = (p: Palette) => { const i = p.industries.indexOf(industry); return i < 0 ? 99 : i; };
  return [...PALETTES].sort((a, b) => rank(a) - rank(b));
}
