// Temporary photography from Unsplash, kept in one place so each photo can be
// replaced by KayKay's own once it exists. Products and guides with their own
// image never use these. Plain data, because scripts/prerender.ts imports it too.

interface Photo {
  id: string;
  alt: string;
  by: string;
  username: string;
}

export const PHOTOS = {
  bottleTray: { id: 'photo-1634141510639-d691d86f47be', alt: 'A glass bottle of milk on a wooden tray', by: 'Ahmadreza Rezaie', username: 'ahmdrzarzai' },
  pour: { id: 'photo-1550583724-b2692b85b150', alt: 'Milk being poured from a jug into a glass', by: 'Eiliv Aceron', username: 'shootdelicious' },
  bottle: { id: 'photo-1576186726115-4d51596775d1', alt: 'A swing-top bottle of milk', by: 'No Revisions', username: 'norevisions' },
  glassWood: { id: 'photo-1517448931760-9bf4414148c5', alt: 'A glass of milk on a dark wooden table', by: 'Kim Leary', username: 'kimleary' },
  glassLight: { id: 'photo-1596151163116-98a5033814c2', alt: 'A glass of milk on a pale background', by: 'an_vision', username: 'anvision' },
  cow: { id: 'photo-1778091959181-9798b0244734', alt: 'A dairy cow in a field at sunset', by: 'Brianna Sanders', username: 'briesanders' },
  pasture: { id: 'photo-1743362814840-bc41dd1b3a2d', alt: 'Cows grazing on green pasture', by: 'Veronica White', username: 'veronicaa_white' },
  butter: { id: 'photo-1587185717368-4d92f8de4ad2', alt: 'Cubes of butter on baking paper', by: 'Jess Bailey', username: 'jessbaileydesigns' },
  yoghurt: { id: 'photo-1633104060731-32143505bacc', alt: 'A bowl of yoghurt with berries and granola', by: 'Shayna Douglas', username: 'itsmaemedia' },
  splash: { id: 'photo-1644346402970-d8d7304ff82f', alt: 'Milk splashing into a glass', by: 'Kt Rb', username: 'katy_rb' },
  cheese: { id: 'photo-1589985270826-4b7bb135bc9d', alt: 'Dairy on a glass plate', by: 'Sorin Gheorghita', username: 'sxtcxtc' },
} satisfies Record<string, Photo>;

export const photoUrl = (photo: Photo, width: number, height?: number) =>
  `https://images.unsplash.com/${photo.id}?auto=format&fit=crop&q=75&w=${width}${height ? `&h=${height}` : ''}`;

export const HERO_SHARE_IMAGE = photoUrl(PHOTOS.pour, 1200, 630);

export const CREDITED_PHOTOS: Photo[] = Object.values(PHOTOS);

/** The closest stand-in for a product that has no photo of its own. */
export function productPhoto(text: string): Photo {
  const t = text.toLowerCase();
  if (/yog/.test(t)) return PHOTOS.yoghurt;
  if (/butter|ghee|spread/.test(t)) return PHOTOS.butter;
  if (/cheese/.test(t)) return PHOTOS.cheese;
  if (/mala|lala|ferment|sour|kefir/.test(t)) return PHOTOS.glassLight;
  if (/cream/.test(t)) return PHOTOS.splash;
  if (/raw|farm/.test(t)) return PHOTOS.pour;
  return PHOTOS.bottle;
}

/** The closest stand-in for a guide that has no cover of its own. */
export function articlePhoto(text: string): Photo {
  const t = text.toLowerCase();
  if (/boil|heat|warm/.test(t)) return PHOTOS.pour;
  if (/off|spoil|safe|sour|tell/.test(t)) return PHOTOS.glassWood;
  if (/store|storage|fridge|keep/.test(t)) return PHOTOS.bottleTray;
  return PHOTOS.splash;
}
