// Renders the website for fictional shops in headless Chrome and saves screenshots, so a design
// change can be looked at for several kinds of business at desktop and phone width.
//
//   1. cd website && VITE_SUPABASE_URL=https://fixture.test VITE_SUPABASE_ANON_KEY=fixture \
//        VITE_WEBSITE_SLUG=fixture npx vite --port 5199 --strictPort
//   2. node scripts/website-shots.mjs [out-dir] [shop ...]       (default: every shop below)
//
// Every network request is answered here: the storefront call gets the fixture, pictures are
// drawn as SVG, Google Fonts is allowed, anything else is refused and listed at the end. Nothing
// reaches a real database. Needs google-chrome on the PATH.
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const args = process.argv.slice(2);
const OUT = args[0] && !/^[a-z]+$/.test(args[0]) ? args.shift() : mkdtempSync(join(tmpdir(), 'website-shots-'));
mkdirSync(OUT, { recursive: true });
const PORT = 9333;

const P = (name, category, price, n, was) => ({ name, category, price, wasPrice: was ?? null, n });
const week = (days, open, close) => days.map((day) => ({ day, open, close }));

/** Fictional shops (website engine brief, section 14). Only what a real owner might fill in. */
const SHOPS = {
  original: {
    name: 'Mama Dairy', primary: '#c2571a', brand: { designPreset: 'original', industry: 'food_grocery' },
    products: [P('Fresh milk 1L', 'Milk', 65, 1), P('Yoghurt 500ml', 'Yoghurt', 120, 2, 140), P('Butter 250g', 'Butter', 310, 3), P('Ghee 500g', 'Butter', 650, 4), P('Mala 1L', 'Milk', 110, 5), P('Cheese 200g', 'Cheese', 420, 6)],
  },
  beauty: {
    name: 'Lumiere Skin Studio', primary: '#b76e79',
    brand: { industry: 'beauty', tagline: 'Skin care, slowly made', story: 'We blend small batches of serums and balms in Nairobi using shea, baobab and marula oils from women-led cooperatives.', mission: 'Honest skin care that respects your skin and the people who grow its ingredients.' },
    extra: {
      navigation: { header: [{ label: 'Shop', href: '/shop' }, { label: 'Journal', href: 'https://journal.example.com/' }, { label: 'Bad', href: 'javascript:alert(1)' }, { label: 'About', href: '/about' }] },
      seo: { title: 'Lumiere Skin Studio | Small-batch skin care' },
    },
    products: [P('Baobab face oil', 'Face', 2400, 1), P('Shea night balm', 'Face', 1900, 2, 2300), P('Marula body butter', 'Body', 1600, 3), P('Rose toner', 'Face', 1200, 4), P('Lip balm trio', 'Lips', 900, 5), P('Body scrub', 'Body', 1400, 7, 1700)],
  },
  dairy: {
    name: 'Green Valley Dairy', primary: '#2f7d4f', brand: { industry: 'food_grocery', tagline: 'Milk from our farm to your fridge', openingHours: week([0, 1, 2, 3, 4, 5], '07:00', '19:00') },
    products: [P('Fresh milk 1L', 'Milk', 65, 1), P('Yoghurt 500ml', 'Yoghurt', 120, 2, 140), P('Butter 250g', 'Butter', 310, 3), P('Cheese 200g', 'Cheese', 420, 6), P('Cream 250ml', 'Milk', 180, 7)],
  },
  electronics: {
    name: 'Voltline Electronics', primary: '#1d5bd8', brand: { industry: 'electronics', accentColor: '#ffcc00' },
    products: [P('Wireless earbuds', 'Audio', 3500, 1, 4200), P('Bluetooth speaker', 'Audio', 5200, 2), P('65W charger', 'Chargers', 2100, 3), P('Smart watch', 'Wearables', 8900, 5, 9900), P('Power bank 20000', 'Chargers', 3800, 6)],
  },
  services: {
    name: 'Kipchoge & Mwangi Advocates', primary: '#1f3a5f', address: 'Delta Towers, 4th Floor, Westlands, Nairobi',
    brand: { industry: 'professional_services', secondaryColor: '#0b1f33', tagline: 'Clear legal advice for growing businesses', mission: 'We help founders and family businesses make sound decisions with plain-language advice.', openingHours: week([0, 1, 2, 3, 4], '08:30', '17:30') },
    products: [P('Company registration', 'Business', 25000, 0), P('Contract review', 'Business', 15000, 0), P('Trademark filing', 'Intellectual property', 30000, 0)],
  },
  logistics: {
    name: 'Swiftway Couriers', primary: '#f59e0b', address: 'Enterprise Road, Industrial Area, Nairobi',
    brand: { industry: 'logistics', tagline: 'Same-day deliveries across Nairobi', story: 'Swiftway started with two motorbikes in 2019. Today 40 riders deliver parcels, documents and stock for over 300 businesses.' },
    products: [P('Same-day parcel (CBD)', 'Parcels', 350, 0), P('Document delivery', 'Documents', 300, 0), P('Business pickup plan', 'Business', 12000, 0, 14000)],
  },
};

function storefront(id) {
  const t = SHOPS[id];
  return {
    business: { name: t.name, slug: 'fixture', description: null, address: t.address ?? null, contactEmail: null, contactPhone: '0712 345 678', logoUrl: null, coverImageUrl: null, primaryColor: t.primary, currency: 'KES', paymentMethods: ['Cash', 'M-Pesa'] },
    settings: { deliveryEnabled: true, deliveryFee: 150, minOrder: 0, assistantEnabled: false, openingHours: null, whatsapp: null },
    pages: {},
    brand: t.brand,
    stores: [{ slug: 'fixture', name: t.name, address: null, phone: null, logoUrl: null, openingHours: null }],
    loyalty: { enabled: true, pointsPerShilling: 2, valueBronze: 0.02, valueSilver: 0.01, valueGold: 0.005, minRedeem: 100 },
    reviews: [], promotions: [], deliveryZones: [], branches: [], articles: [], heroSlides: [], adCards: [],
    site: { ordersOpen: true, poweredBy: false, platformName: null, platformUrl: null, host: null },
    products: t.products.map((p, i) => ({
      id: `${id}-${i}`, name: p.name, unit: 'Item', category: p.category, price: p.price, wasPrice: p.wasPrice,
      inStock: true, description: null, image: p.n ? `https://img.test/${id}/${p.n}.svg` : null,
    })),
    ...(t.extra ?? {}),
  };
}

const svg = (id, n) => {
  const hue = (n * 47 + id.length * 31) % 360;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600"><rect width="600" height="600" fill="hsl(${hue} 45% 88%)"/><circle cx="300" cy="300" r="170" fill="hsl(${hue} 50% 55%)"/></svg>`;
};

const chrome = spawn('google-chrome', ['--headless=new', `--remote-debugging-port=${PORT}`, '--no-first-run', '--no-default-browser-check', `--user-data-dir=${join(OUT, '.chrome')}`, 'about:blank'], { stdio: 'ignore' });
let targets;
for (let i = 0; i < 40 && !targets; i++) {
  await new Promise((r) => setTimeout(r, 500));
  targets = await fetch(`http://127.0.0.1:${PORT}/json`).then((r) => r.json()).catch(() => undefined);
}
const ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r));
let seq = 0;
const waiting = new Map();
const handlers = [];
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id && waiting.has(m.id)) { waiting.get(m.id)(m); waiting.delete(m.id); } else handlers.forEach((h) => h(m));
});
const send = (method, params = {}) => new Promise((res) => { const id = ++seq; waiting.set(id, res); ws.send(JSON.stringify({ id, method, params })); });

let current = 'original';
const refused = new Set();
handlers.push(async (m) => {
  if (m.method === 'Runtime.exceptionThrown') console.log('PAGE ERROR', m.params.exceptionDetails.exception?.description?.slice(0, 300));
  if (m.method !== 'Fetch.requestPaused') return;
  const { requestId, request } = m.params;
  const url = new URL(request.url);
  const body = (s, type = 'application/json') => send('Fetch.fulfillRequest', { requestId, responseCode: 200, responseHeaders: [{ name: 'Content-Type', value: type }, { name: 'Access-Control-Allow-Origin', value: '*' }, { name: 'Access-Control-Allow-Headers', value: '*' }], body: Buffer.from(s).toString('base64') });
  if (url.hostname === 'localhost' || url.hostname === '127.0.0.1' || /fonts\.(googleapis|gstatic)\.com$/.test(url.hostname)) return send('Fetch.continueRequest', { requestId });
  if (url.hostname === 'img.test') { const [, id, file] = url.pathname.split('/'); return body(svg(id, parseInt(file, 10)), 'image/svg+xml'); }
  if (url.hostname === 'fixture.test') {
    if (request.method === 'OPTIONS') return body('');
    if (url.pathname.endsWith('/rpc/get_public_storefront')) return body(JSON.stringify(storefront(current)));
    return body(url.pathname.includes('/rpc/') ? 'null' : '[]');
  }
  refused.add(url.hostname);
  return send('Fetch.failRequest', { requestId, errorReason: 'BlockedByClient' });
});
await send('Runtime.enable');
await send('Page.enable');
await send('Fetch.enable', { patterns: [{ urlPattern: '*' }] });

const facts = `JSON.stringify({
  title: document.title,
  h1: [...document.querySelectorAll('h1')].map((e) => e.textContent),
  h2: [...document.querySelectorAll('main h2')].map((e) => e.textContent).slice(0, 14),
  menu: [...document.querySelectorAll('nav[aria-label=Main] a')].map((e) => e.textContent + (e.target === '_blank' ? ' (new tab)' : '')),
  font: getComputedStyle(document.querySelector('h1') || document.body).fontFamily.slice(0, 40),
})`;

for (const id of args.length ? args : Object.keys(SHOPS)) {
  current = id;
  for (const [label, width, mobile] of [['desktop', 1280, false], ['phone', 390, true]]) {
    await send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile });
    await send('Page.navigate', { url: 'http://localhost:5199/' });
    await new Promise((r) => setTimeout(r, 5000));
    const height = Math.min((await send('Runtime.evaluate', { expression: 'document.documentElement.scrollHeight', returnByValue: true })).result.result.value, 9000);
    await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile });
    await new Promise((r) => setTimeout(r, 1200));
    const shot = await send('Page.captureScreenshot', { format: 'jpeg', quality: 70 });
    writeFileSync(join(OUT, `${id}-${label}.jpg`), Buffer.from(shot.result.data, 'base64'));
    const info = await send('Runtime.evaluate', { returnByValue: true, expression: facts });
    console.log(id, label, height, info.result.result.value);
  }
}
console.log('screenshots in', OUT);
console.log('refused hosts:', [...refused].join(', ') || 'none');
ws.close();
chrome.kill();
