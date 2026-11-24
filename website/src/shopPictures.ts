// The shop's own product photos, used wherever the website (or the app's website editors) needs a
// picture the staff haven't chosen: built-in home slides, adverts and page banners. A shop with no
// product photos gets no pictures there, never someone else's stock photos.
// Plain data, so the app imports it too.

interface WithPicture {
  id?: string;
  name?: string;
  image?: string | null;
  inStock?: boolean;
}

export interface ShopPicture {
  id: string;
  label: string;
  src: string;
}

/** Each product photo once, products in stock first. */
export function shopPictures(products: readonly WithPicture[] | null | undefined, max = 24): ShopPicture[] {
  const seen = new Set<string>();
  const out: ShopPicture[] = [];
  const list = [...(products ?? [])].sort((a, b) => Number(b.inStock !== false) - Number(a.inStock !== false));
  for (const p of list) {
    const src = p.image?.trim();
    if (!src || seen.has(src) || !/^https:\/\//.test(src)) continue;
    seen.add(src);
    out.push({ id: p.id ?? src, label: p.name?.trim() || 'Product', src });
    if (out.length >= max) break;
  }
  return out;
}

/** Up to `count` different pictures starting at `offset` (wrapping round); [] when there are none. */
export function pictureSet(pictures: readonly ShopPicture[], offset: number, count: number): string[] {
  if (pictures.length === 0) return [];
  const n = Math.min(count, pictures.length);
  return Array.from({ length: n }, (_, i) => pictures[(offset + i) % pictures.length].src);
}

/** A stable number from text, so the same page always picks the same pictures. */
export function textSeed(text: string): number {
  let hash = 0;
  for (const char of text) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return hash;
}
