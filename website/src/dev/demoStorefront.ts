// "Test 1": a made-up shop for checking the website's design on a developer's machine, one for
// each kind of business. Loaded only by the dev server when VITE_DEMO_SHOP=1 (api.ts
// fetchStorefront); production builds never include it (import.meta.env.DEV is false there, so
// the import is dropped).
//
// Pick the kind of business with ?demo=<industry> (food_grocery, restaurant, beauty, fashion,
// electronics, pharmacy, hardware, professional_services, logistics, general_retail), and a
// design with &preset=<id> (presets.ts). The choice is kept for the browser tab.
// Food uses the website's own pictures; the others use stock photos from picsum.photos, which
// do not match the product names: they are only there to fill the layouts.
import type { Storefront } from '../api';
import type { Industry, PresetId } from '../engine/brand';
import { PRESETS } from '../engine/presets';

const local = (name: string) => `/hero/${name}.webp`;
const stock = (seed: string) => `https://picsum.photos/seed/test1-${seed}/800/800`;

type P = [name: string, category: string, price: number, unit: string, extra?: { was?: number; out?: boolean; img?: string | null }];

interface Kit {
  tagline: string;
  story: string;
  products: P[];
  picture: (i: number, name: string) => string | null;
}

const KITS: Partial<Record<Industry, Kit>> & { food_grocery: Kit } = {
  food_grocery: {
    tagline: 'Milk from our cows to your door by 9am',
    story: 'We have kept dairy cows on the slopes of Limuru since 1998. Every bottle is cooled within an hour of milking.',
    picture: (i) => [local('milk-bottle'), local('milk-glass'), local('butter'), local('cheese'), local('milk-pour'), local('milk-splash'), local('milk-bottle-cookies')][i] ?? null,
    products: [
      ['Fresh milk 1 litre', 'Milk', 85, 'Bottles', { was: 95 }], ['Fresh milk 500 ml', 'Milk', 50, 'Bottles'],
      ['Salted butter 250 g', 'Butter', 320, 'Packets'], ['Farm cheddar 200 g', 'Cheese', 450, 'Blocks'],
      ['Mala 1 litre', 'Yoghurt', 120, 'Packets'], ['Strawberry yoghurt 500 ml', 'Yoghurt', 160, 'Cups', { was: 180 }],
      ['Milk and cookies box', 'Treats', 650, 'Boxes'], ['Ghee 500 g', 'Butter', 780, 'Jars', { out: true }],
      ['Natural yoghurt 1 litre', 'Yoghurt', 210, 'Tubs'], ['Cream cheese 150 g', 'Cheese', 290, 'Tubs', { was: 320 }],
    ],
  },
  restaurant: {
    tagline: 'Slow-cooked Swahili food, ready in twenty minutes',
    story: 'A family kitchen on Moi Avenue. Our pilau recipe came from Lamu with our grandmother.',
    picture: (i) => stock(`food${i}`),
    products: [
      ['Beef pilau', 'Mains', 650, 'Plates', { was: 720 }], ['Chicken biryani', 'Mains', 780, 'Plates'], ['Fish in coconut', 'Mains', 950, 'Plates'],
      ['Chapati', 'Sides', 60, 'Pieces'], ['Kachumbari', 'Sides', 150, 'Bowls'], ['Mandazi box', 'Snacks', 200, 'Boxes'],
      ['Samosa (beef)', 'Snacks', 80, 'Pieces'], ['Passion juice', 'Drinks', 180, 'Glasses'], ['Chai masala', 'Drinks', 120, 'Cups'],
    ],
  },
  beauty: {
    tagline: 'Skin care made with shea and baobab from East Africa',
    story: 'Small batches, mixed in Nairobi, tested on our own skin first.',
    picture: (i) => stock(`beauty${i}`),
    products: [
      ['Shea body butter', 'Body', 1200, 'Jars', { was: 1450 }], ['Baobab face oil', 'Face', 1850, 'Bottles'], ['Rose water toner', 'Face', 900, 'Bottles'],
      ['Coffee scrub', 'Body', 1100, 'Jars'], ['Lip balm trio', 'Lips', 650, 'Sets'], ['Hair growth oil', 'Hair', 1350, 'Bottles'],
      ['Gift box', 'Gifts', 3900, 'Boxes'],
    ],
  },
  fashion: {
    tagline: 'Kitenge cuts for every day of the week',
    story: 'Designed and sewn in our Westlands studio, in runs of thirty.',
    picture: (i) => stock(`fashion${i}`),
    products: [
      ['Wrap dress', 'Dresses', 4500, 'Pieces', { was: 5200 }], ['Shirt dress', 'Dresses', 3900, 'Pieces'], ['Linen shirt', 'Tops', 2800, 'Pieces'],
      ['Kitenge blazer', 'Jackets', 6500, 'Pieces'], ['Wide trousers', 'Bottoms', 3200, 'Pieces'], ['Head wrap', 'Accessories', 900, 'Pieces'],
      ['Tote bag', 'Accessories', 1800, 'Pieces', { out: true }], ['Pleated skirt', 'Bottoms', 3400, 'Pieces'],
    ],
  },
  electronics: {
    tagline: 'Genuine phones and laptops, with a one-year warranty',
    story: 'An authorised reseller in Luthuli Avenue since 2012.',
    picture: (i) => stock(`tech${i}`),
    products: [
      ['Android phone 128 GB', 'Phones', 24500, 'Pieces', { was: 27999 }], ['Android phone 256 GB', 'Phones', 34999, 'Pieces'], ['14-inch laptop', 'Laptops', 68000, 'Pieces'],
      ['Wireless earbuds', 'Audio', 3500, 'Pairs', { was: 4200 }], ['Bluetooth speaker', 'Audio', 5900, 'Pieces'], ['Power bank 20000 mAh', 'Accessories', 2800, 'Pieces'],
      ['USB-C charger 65 W', 'Accessories', 2200, 'Pieces'], ['Smart watch', 'Wearables', 7500, 'Pieces'], ['32-inch smart TV', 'TVs', 21999, 'Pieces'],
    ],
  },
  pharmacy: {
    tagline: 'Your neighbourhood chemist, open until 10pm',
    story: 'Registered pharmacists on every shift. Ask us anything, free.',
    picture: (i) => stock(`health${i}`),
    products: [
      ['Paracetamol 500 mg x 24', 'Pain relief', 120, 'Packs'], ['Vitamin C 1000 mg', 'Vitamins', 950, 'Tubes', { was: 1100 }], ['Oral rehydration salts', 'Everyday', 60, 'Sachets'],
      ['Digital thermometer', 'Devices', 850, 'Pieces'], ['Blood pressure monitor', 'Devices', 5400, 'Pieces'], ['Hand sanitiser 500 ml', 'Everyday', 450, 'Bottles'],
      ['Baby diapers size 3', 'Baby', 1450, 'Packs'], ['Multivitamin for kids', 'Vitamins', 780, 'Bottles'], ['Sunscreen SPF 50', 'Skin', 1650, 'Tubes'],
    ],
  },
  hardware: {
    tagline: 'Building supplies delivered to site, same day in Nairobi',
    story: 'Three generations in Industrial Area. Contractors get account terms.',
    picture: (i) => stock(`tools${i}`),
    products: [
      ['Cement 50 kg', 'Building', 780, 'Bags', { was: 820 }], ['Y12 steel bar', 'Building', 1150, 'Pieces'], ['Iron sheet 3 m', 'Roofing', 1350, 'Sheets'],
      ['Emulsion paint 20 L', 'Paint', 6800, 'Buckets'], ['Gloss paint 4 L', 'Paint', 2900, 'Tins'], ['Claw hammer', 'Tools', 650, 'Pieces'],
      ['Cordless drill', 'Tools', 8900, 'Pieces', { was: 9900 }], ['PVC pipe 4 inch', 'Plumbing', 1250, 'Pieces'], ['Wheelbarrow', 'Tools', 5200, 'Pieces'],
    ],
  },
  professional_services: {
    tagline: 'Accounts, tax and payroll for growing Kenyan businesses',
    story: 'Certified accountants who answer the phone. We have filed for more than 400 companies.',
    picture: (i) => stock(`office${i}`),
    products: [
      ['Monthly bookkeeping', 'Accounting', 15000, 'Months'], ['Annual tax return', 'Tax', 25000, 'Returns'], ['Payroll for 10 staff', 'Payroll', 8000, 'Months'],
      ['Company registration', 'Setup', 18000, 'Companies'], ['Audit preparation', 'Accounting', 45000, 'Audits'],
    ],
  },
  logistics: {
    tagline: 'Parcels across Kenya by tomorrow',
    story: 'Our own riders and vans, tracked from pick-up to signature.',
    picture: (i) => stock(`move${i}`),
    products: [
      ['Same-day Nairobi parcel', 'Courier', 350, 'Parcels'], ['Next-day upcountry parcel', 'Courier', 600, 'Parcels'], ['Small move (studio)', 'Moving', 12000, 'Moves'],
      ['Office move', 'Moving', 45000, 'Moves'], ['Warehouse storage', 'Storage', 6000, 'Months'],
    ],
  },
};
KITS.general_retail = {
  tagline: 'Everything for the home, at fair prices',
  story: 'A family shop in Ruaka since 2009.',
  picture: (i) => stock(`shop${i}`),
  products: [...KITS.food_grocery.products.slice(0, 4), ...KITS.electronics!.products.slice(3, 7), ...KITS.pharmacy!.products.slice(5, 8)],
};

const REVIEW_WORDS = [
  ['Wanjiru', 'Came before 8 as promised and everything was exactly as ordered.'],
  ['Otieno', 'Good quality and a fair price. The rider called before arriving.'],
  ['Achieng', 'I have ordered every week for three months. Never once a problem.'],
  ['Kamau', 'Friendly people. They helped me choose and did not push the expensive one.'],
  ['Fatuma', 'Packed with care and on time for the party. Will order again.'],
];

function choose<T extends string>(key: string, valid: (v: string) => boolean, fallback: T): T {
  let v: string | null = null;
  try {
    v = new URLSearchParams(location.search).get(key);
    if (v && valid(v)) sessionStorage.setItem(`test1-${key}`, v);
    else v = sessionStorage.getItem(`test1-${key}`);
  } catch { /* private window: use the default */ }
  return (v && valid(v) ? v : fallback) as T;
}

export function demoStorefront(): Storefront {
  const industry = choose<Industry>('demo', (v) => Object.hasOwn(KITS, v), 'food_grocery');
  const preset = choose<PresetId | ''>('preset', (v) => Object.hasOwn(PRESETS, v), '');
  const kit = KITS[industry] ?? KITS.food_grocery;
  const products = kit.products.map(([name, category, price, unit, extra = {}], i) => ({
    id: `test1-${i + 1}`, name, category, price, unit,
    description: `${name}. ${kit.story.split('.')[0]}.`,
    image: extra.img === undefined ? kit.picture(i, name) : extra.img,
    inStock: !extra.out,
    ...(extra.was ? { wasPrice: extra.was } : {}),
  }));
  return {
    business: {
      name: 'Test 1', slug: 'test-1',
      description: kit.story,
      address: 'Moi Avenue, Nairobi',
      contactEmail: 'hello@test1.example', contactPhone: '0712 345 678',
      logoUrl: null, coverImageUrl: null, primaryColor: null, currency: 'KSh',
      paymentMethods: ['mpesa', 'cash', 'card'],
    },
    settings: { deliveryEnabled: industry !== 'professional_services', deliveryFee: 150, minOrder: 300, assistantEnabled: false, openingHours: 'Mon to Sat 7am to 7pm', whatsapp: '0712345678' },
    brand: { industry, ...(preset ? { designPreset: preset } : {}), tagline: kit.tagline, story: kit.story },
    reviews: REVIEW_WORDS.map(([name, body], i) => ({
      id: `r${i}`, productId: i % 2 === 0 ? products[i]?.id ?? null : null, rating: i === 1 ? 4 : 5, title: null, body, name,
      verified: i !== 3, featured: i < 2, reply: i === 1 ? 'Thank you, see you next week.' : null,
      createdAt: new Date(Date.now() - (i * 9 + 3) * 86_400_000).toISOString(),
    })),
    promotions: [{ code: 'TEST10', description: '10% off your first order', kind: 'percent', value: 10, minOrder: 500, endsAt: null }],
    site: { ordersOpen: true, poweredBy: true, platformName: 'Denso', platformUrl: null, host: null },
    deliveryZones: [{ id: 'z1', name: 'Westlands', fee: 150 }, { id: 'z2', name: 'Kilimani', fee: 200 }],
    branches: [{ name: 'Moi Avenue', address: 'Moi Avenue, Nairobi' }],
    products,
    articles: [
      { id: 'a1', slug: 'getting-started', title: 'How to order in two minutes', summary: 'Pick, pay with M-Pesa, and track your rider.', body: 'Pick what you need.', category: 'Tips', coverImageUrl: kit.picture(1, 'guide'), publishedAt: '2026-10-01' },
    ],
  };
}
