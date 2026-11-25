// Colour maths for the design tokens: WCAG 2 contrast, mixing, and nudging a colour until it is
// readable. Colours are #rrggbb strings throughout.

export type Rgb = [number, number, number];

export const isHex = (value: unknown): value is string => typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);

export function toRgb(hex: string): Rgb {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as Rgb;
}

export function toHex([r, g, b]: Rgb): string {
  return `#${[r, g, b].map((c) => Math.max(0, Math.min(255, Math.round(c))).toString(16).padStart(2, '0')).join('')}`;
}

/** WCAG relative luminance, 0 (black) to 1 (white). */
export function luminance(hex: string): number {
  const [r, g, b] = toRgb(hex).map((c) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio, 1 to 21. */
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** `weight` of `b` mixed into `a` (0 = all a, 1 = all b). */
export function mix(a: string, b: string, weight: number): string {
  const x = toRgb(a);
  const y = toRgb(b);
  return toHex([0, 1, 2].map((i) => x[i] + (y[i] - x[i]) * weight) as Rgb);
}

/** Whichever of `dark` and `light` reads better on `bg`. */
export function readableOn(bg: string, dark = '#111111', light = '#ffffff'): string {
  return contrast(bg, dark) >= contrast(bg, light) ? dark : light;
}

/**
 * `color` moved towards black (on a light ground) or white (on a dark one) in small steps until
 * it reaches `ratio` against `bg`. The brand hue is kept as far as possible.
 */
export function ensureContrast(color: string, bg: string, ratio: number): string {
  if (contrast(color, bg) >= ratio) return color;
  const toward = luminance(bg) > 0.4 ? '#000000' : '#ffffff';
  for (let step = 1; step <= 20; step++) {
    const next = mix(color, toward, step * 0.05);
    if (contrast(next, bg) >= ratio) return next;
  }
  return toward;
}

/** Contrast levels used by the tokens and the quality checks. */
export const AA_TEXT = 4.5;
export const AA_LARGE = 3;
