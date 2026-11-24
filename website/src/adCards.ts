// Advert cards on the home page, managed in the app at Online Store > Adverts.
// "poster" cards sit three in a row under the categories (they scroll sideways on phones);
// a "strip" card is one thin full-width offer bar. The database checks every field again
// (fn_valid_ad_cards, migration 20261114006). Plain data, so the app editor imports it too and
// both use the same colour names.
import { isSafeHeroImage, safeHref } from './heroSlides';
import type { ShopPicture } from './shopPictures';

export type AdTone = 'ember' | 'espresso' | 'butter' | 'peach' | 'sage' | 'cream';

export interface AdCard {
  id?: string;
  kind: 'poster' | 'strip';
  title: string;
  body?: string;
  kicker?: string;
  ctaLabel?: string;
  href?: string;
  /** A cut-out or photo, on the right of the card. */
  image?: string;
  tone?: AdTone;
  hidden?: boolean;
}

export const AD_LIMITS = { cards: 9, title: 60, body: 120, kicker: 30, ctaLabel: 24, href: 300 } as const;

/**
 * The brand colours a card can use, by name. Hex values, not class names, so the app's editor
 * draws exactly what the website shows. `button` is the colour of the small pill on the card.
 */
export const AD_TONES: Record<AdTone, { label: string; bg: string; text: string; kicker: string; button: string; buttonText: string }> = {
  ember: { label: 'Ember', bg: '#c2571a', text: '#ffffff', kicker: '#fde7d2', button: '#ffffff', buttonText: '#23160e' },
  espresso: { label: 'Espresso', bg: '#2b1409', text: '#fffdf9', kicker: '#f3b04a', button: '#c2571a', buttonText: '#ffffff' },
  butter: { label: 'Butter', bg: '#f6d27a', text: '#23160e', kicker: '#9a4313', button: '#23160e', buttonText: '#fffdf9' },
  peach: { label: 'Peach', bg: '#fbe7d6', text: '#23160e', kicker: '#c2571a', button: '#c2571a', buttonText: '#ffffff' },
  sage: { label: 'Sage', bg: '#e6efe2', text: '#23160e', kicker: '#2f6b45', button: '#2f6b45', buttonText: '#ffffff' },
  cream: { label: 'Cream', bg: '#f6eee2', text: '#23160e', kicker: '#c2571a', button: '#23160e', buttonText: '#fffdf9' },
};

export const AD_TONE_ORDER: AdTone[] = ['ember', 'espresso', 'butter', 'peach', 'sage', 'cream'];

/** Shown until staff save their own, so a new website never has an empty space. Posters get the shop's own product photos. */
export const DEFAULT_AD_CARDS: AdCard[] = [
  { id: 'ad-fresh', kind: 'poster', kicker: 'Fresh every morning', title: 'New Stock Daily', body: 'From our shelves to your door.', ctaLabel: 'Shop now', href: '/shop', tone: 'butter' },
  { id: 'ad-regular', kind: 'poster', kicker: 'Never run out', title: 'Regular Orders', body: 'Pick your days and we prepare it.', ctaLabel: 'Set up', href: '/account/schedules', tone: 'espresso' },
  { id: 'ad-dairy', kind: 'poster', kicker: 'More to choose from', title: 'Everything in One Place', body: 'Browse every product we sell.', ctaLabel: 'Browse', href: '/shop', tone: 'peach' },
  { id: 'ad-mpesa', kind: 'strip', kicker: 'Easy checkout', title: 'Order online, pay with M-Pesa', ctaLabel: 'Start shopping', href: '/shop', tone: 'ember' },
];

/** Same checks as the database, worded for staff. '' when the card is fine. */
export function adCardProblem(card: AdCard, index: number): string {
  const name = `Card ${index + 1}`;
  if (!card.title.trim()) return `${name} needs a headline.`;
  if (card.image && !isSafeHeroImage(card.image)) return `${name} has a picture that isn't stored securely (https). Upload it again.`;
  if (card.href?.trim() && safeHref(card.href) !== card.href.trim()) {
    return `${name}: the link must be a page on the site (starting with /) or an address starting with https://.`;
  }
  return '';
}

/** Trims text and drops empty optional fields, so only clean data is saved. */
export function cleanAdCard(card: AdCard, newId: () => string): AdCard {
  const out: AdCard = { id: card.id || newId(), kind: card.kind, title: card.title.trim().slice(0, AD_LIMITS.title) };
  if (card.body?.trim()) out.body = card.body.trim().slice(0, AD_LIMITS.body);
  if (card.kicker?.trim()) out.kicker = card.kicker.trim().slice(0, AD_LIMITS.kicker);
  if (card.ctaLabel?.trim()) out.ctaLabel = card.ctaLabel.trim().slice(0, AD_LIMITS.ctaLabel);
  if (card.href?.trim()) out.href = card.href.trim();
  if (card.image) out.image = card.image;
  if (card.tone && card.tone in AD_TONES) out.tone = card.tone;
  if (card.hidden) out.hidden = true;
  return out;
}

/** The saved cards when there are any, otherwise the built-in ones with the shop's own photos (none without). */
export function visibleAdCards(saved: AdCard[] | undefined, pictures: readonly ShopPicture[] = []): AdCard[] {
  const cards = (saved ?? []).filter((c) => !c.hidden && c.title?.trim());
  if (cards.length > 0) return cards;
  let next = 0;
  return DEFAULT_AD_CARDS.map((card) => {
    if (card.kind !== 'poster' || pictures.length === 0) return card;
    const picture = pictures[next++ % pictures.length];
    return { ...card, image: picture.src };
  });
}

/** "-20%" style saving, rounded down so it never overstates the offer. */
export function percentOff(price: number, wasPrice: number | null | undefined): number {
  if (!wasPrice || wasPrice <= price) return 0;
  return Math.floor(((wasPrice - price) / wasPrice) * 100);
}
