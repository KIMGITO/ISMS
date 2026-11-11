// The website's information and policy pages. Each one has a default text built from
// live business data (name, contacts, delivery areas, minimum order, points rule), so
// it stays true as staff change settings in the app. Staff can replace any page's text
// in the app under Online Store > Pages; an empty page uses the default below.
// Plain data with no browser APIs, because scripts/prerender.ts and seo.ts import it.
import type { Storefront } from './api';
import { pointsOn } from './points';

export type InfoPageId = 'about' | 'help' | 'delivery' | 'payments' | 'returns' | 'terms' | 'privacy' | 'cookies';

export interface InfoPageDef {
  id: InfoPageId;
  path: string;
  title: string;
  /** Short name for menus and the footer. */
  label: string;
  eyebrow: string;
  summary: string;
  group: 'company' | 'help' | 'legal';
  /** Legal pages show a "last updated" line and a contents list. */
  legal?: boolean;
}

export const INFO_PAGES: InfoPageDef[] = [
  { id: 'about', path: '/about', label: 'About us', title: 'About Us', eyebrow: 'Our story', group: 'company', summary: 'Who we are, how we work and what we promise every customer.' },
  { id: 'help', path: '/help', label: 'Help & FAQs', title: 'Help & FAQs', eyebrow: 'Customer care', group: 'help', summary: 'Answers to common questions about ordering, paying, delivery and your account.' },
  { id: 'delivery', path: '/delivery', label: 'Delivery & pickup', title: 'Delivery & Pickup', eyebrow: 'Customer care', group: 'help', summary: 'Where we deliver, what it costs, and how to collect your order.' },
  { id: 'payments', path: '/payments', label: 'Payments', title: 'Paying With M-Pesa', eyebrow: 'Customer care', group: 'help', summary: 'How M-Pesa payment works on our website, step by step.' },
  { id: 'returns', path: '/returns', label: 'Returns & refunds', title: 'Returns & Refunds', eyebrow: 'Policies', group: 'legal', legal: true, summary: 'What to do if something is wrong with your order, and how refunds work.' },
  { id: 'terms', path: '/terms', label: 'Terms & conditions', title: 'Terms & Conditions', eyebrow: 'Policies', group: 'legal', legal: true, summary: 'The terms that apply when you use our website and place an order.' },
  { id: 'privacy', path: '/privacy', label: 'Privacy policy', title: 'Privacy Policy', eyebrow: 'Policies', group: 'legal', legal: true, summary: 'What personal information we collect, why, and the choices you have.' },
  { id: 'cookies', path: '/cookies', label: 'Cookies & storage', title: 'Cookies & Storage', eyebrow: 'Policies', group: 'legal', legal: true, summary: 'What this website saves on your device and why.' },
];

/** Plain text, for search and descriptions. */
export { plainText } from './richFormat';

export const infoPage = (id: string) => INFO_PAGES.find((p) => p.id === id || p.path === `/${id}`);

const money = (site: Storefront, amount: number) =>
  `${site.business.currency} ${Number(amount).toLocaleString('en-KE', { maximumFractionDigits: 2 })}`;

/** "Silver: 100 points = KSh 1" style lines from the live points settings. */
function pointsLines(site: Storefront): string[] {
  if (!pointsOn(site)) {
    return ['Reward points are paused at the moment, so orders don\'t earn or use points. Points you already have stay in your account.'];
  }
  const l = site.loyalty ?? { pointsPerShilling: 2, valueBronze: 0.02, valueSilver: 0.01, valueGold: 0.005, minRedeem: 100 };
  const per = (value: number) => (value > 0 ? Math.round(1 / value) : 0);
  return [
    `You earn **${l.pointsPerShilling} points for every ${site.business.currency} 1** you pay for products. Delivery fees do not earn points.`,
    `Points are worth more for newer customers: **Bronze ${per(l.valueBronze)} points**, **Silver ${per(l.valueSilver)} points** and **Gold ${per(l.valueGold)} points** each equal ${site.business.currency} 1 off.`,
    `You can use points once you have at least **${l.minRedeem} points**. Points are a discount only. They can't be exchanged for cash or M-Pesa.`,
  ];
}

function deliveryLines(site: Storefront): string[] {
  const { settings, deliveryZones } = site;
  if (!settings.deliveryEnabled) return ['We are not delivering at the moment. You can still order online and pick up from us.'];
  if (deliveryZones.length > 0) {
    return [
      'We deliver to the areas below. Choose your area at checkout and the fee is added to your total.',
      ...deliveryZones.map((z) => `- **${z.name}**: ${Number(z.fee) > 0 ? money(site, z.fee) : 'free'}`),
      `If your area is not listed, [message us](/contact) and we will let you know if we can reach you.`,
    ];
  }
  return [Number(settings.deliveryFee) > 0
    ? `Delivery costs **${money(site, settings.deliveryFee)}** per order, shown at checkout before you pay.`
    : 'Delivery is currently **free**. Any fee will always be shown at checkout before you pay.'];
}

function pickupLines(site: Storefront): string[] {
  const places = site.branches.some((b) => b.address)
    ? site.branches.filter((b) => b.address).map((b) => `- **${b.name}**: ${b.address}`)
    : site.business.address ? [`- ${site.business.address}`] : [];
  return [
    'Choose **Pickup** at checkout and collect your order from us. We will message you when it is ready.',
    ...places,
    ...(site.settings.openingHours ? [`Opening hours: ${site.settings.openingHours}`] : []),
  ];
}

function contactLine(site: Storefront): string {
  const { contactPhone, contactEmail } = site.business;
  const ways = [
    contactPhone && `call [${contactPhone}](tel:${contactPhone.replace(/\s/g, '')})`,
    contactEmail && `email [${contactEmail}](mailto:${contactEmail})`,
    'send a message from [your account](/account/messages)',
  ].filter(Boolean);
  return `You can ${ways.join(', ')}, or visit our [contact page](/contact).`;
}

const minOrderLine = (site: Storefront) =>
  Number(site.settings.minOrder) > 0 ? `The minimum order is **${money(site, site.settings.minOrder)}** worth of products.` : '';

function defaultText(id: InfoPageId, site: Storefront): string {
  const name = site.business.name;
  const lines = (...items: (string | false | null | undefined)[]) => items.filter(Boolean).join('\n');

  switch (id) {
    case 'about':
      return lines(
        site.business.description || `${name} brings fresh milk and dairy to homes and businesses, with ordering that takes a minute.`,
        '## What we promise',
        '- **Fresh every day.** We sell what we can keep fresh, and the shop shows live stock, so what you see is what we have.',
        '- **Fair, clear prices.** The price you see is the price you pay. Any delivery fee is shown before you pay.',
        '- **Easy to order.** Order online, pay with M-Pesa, and choose delivery or pickup.',
        '- **People who answer.** Real staff read every message and every piece of feedback.',
        '## How ordering works',
        '1. Choose your products in the [shop](/shop).',
        '2. Pay with M-Pesa when the prompt reaches your phone.',
        `3. ${site.settings.deliveryEnabled ? 'We deliver to you, or you pick up from us.' : 'Pick up your order from us.'}`,
        'Want the same order every week? Set up [regular orders](/account/schedules) and we will prepare it on your chosen days.',
        '## Visit us',
        ...pickupLines(site).slice(1),
        contactLine(site),
      );

    case 'help':
      return lines(
        '## How do I place an order?',
        'Add products to your cart from the [shop](/shop), open your [cart](/cart), choose delivery or pickup, and select **Continue to payment**. You need a free account so we can send your order updates.',
        '## Do I need an account?',
        'Yes. Your account keeps your orders, regular orders, messages and reward points in one place. [Create one or sign in](/account) with your email or Google.',
        '## How do I pay?',
        'With M-Pesa. After you place your order, we send a payment prompt to your phone. Enter your PIN and the order is confirmed. [Read more about payments](/payments).',
        '## What if the M-Pesa prompt does not arrive?',
        'Check that your phone is on and unlocked, then open the order in [My orders](/account/orders) and select **Pay with M-Pesa** again. Make sure the number shown is your M-Pesa number.',
        '## How much is delivery?',
        ...deliveryLines(site),
        '## Is there a minimum order?',
        minOrderLine(site) || 'No, there is no minimum order.',
        '## How do I track my order?',
        'Open [My orders](/account/orders). Each order shows its status: waiting for payment, paid, being prepared, on the way or ready for pickup, and completed. We also message you as it changes.',
        '## Can I cancel an order?',
        'You can cancel an order yourself while it is still waiting for payment. Once it is paid, please [message us](/account/messages) and we will help. Unpaid orders are cancelled automatically after 48 hours.',
        '## Something was wrong with my order. What do I do?',
        `Tell us as soon as you can. See our [returns and refunds policy](/returns) for what we do. ${contactLine(site)}`,
        '## Can I get the same order every week?',
        'Yes. Set up a [regular order](/account/schedules): choose the products and the days. We prepare it on those days and send you a message to pay.',
        '## How do reward points work?',
        ...pointsLines(site),
        'See your balance under [Rewards](/account/rewards).',
        '## Are prices the same as in the shop?',
        'Yes. Prices on the website come straight from our shop system, and stock updates live.',
        '## How do I change my phone number or delivery address?',
        'Go to [My account > Profile](/account/profile) and save your new details.',
      );

    case 'delivery':
      return lines(
        '## Delivery',
        ...deliveryLines(site),
        minOrderLine(site),
        'We start preparing your order as soon as payment is confirmed. A rider brings it to the location you give at checkout, so please include your estate, street, house number or a landmark. Add a note if the rider should call when they arrive.',
        'We will message you when your order is on the way. You can follow its status any time in [My orders](/account/orders).',
        '## Pickup',
        ...pickupLines(site),
        '## Regular orders',
        'Set up a [regular order](/account/schedules) to have the same products prepared on chosen days each week. We message you each time so you can pay.',
        '## Questions',
        contactLine(site),
      );

    case 'payments':
      return lines(
        `We take payment with **M-Pesa** through our till. You never share your PIN with us: Safaricom asks for it on your own phone.`,
        '## Step by step',
        '1. Place your order from your [cart](/cart).',
        '2. Check the M-Pesa number on the payment screen and select **Pay with M-Pesa**.',
        `3. A prompt from Safaricom appears on your phone showing **${name}** and the amount.`,
        '4. Enter your M-Pesa PIN. The order page updates by itself once payment is confirmed.',
        '5. You receive an M-Pesa message with the receipt number. The receipt number also appears on your order.',
        '## Paying by card',
        'When card payment is available, the payment screen offers **Card (Visa, Mastercard)**. You go to Paystack\'s secure page to enter your card, then come straight back to your order. We never see or keep your card number.',
        '## Good to know',
        '- Totals are rounded **down** to whole shillings, because M-Pesa does not accept cents.',
        '- An order is only marked paid when Safaricom confirms the payment. Nobody can mark it paid by hand on the website.',
        '- If you pay twice by mistake, or pay the wrong amount, our staff see a warning and will contact you.',
        '- Orders that stay unpaid for 48 hours are cancelled automatically.',
        '## Reward points',
        ...pointsLines(site),
        '## Payment problems',
        `If money left your M-Pesa but the order still shows **Waiting for payment** after a few minutes, don't pay again. ${contactLine(site)}`,
      );

    case 'returns':
      return lines(
        `We sell fresh, perishable food, so we can't take back products that are fine but no longer wanted. If something is wrong, we will put it right.`,
        '## When we replace or refund',
        '- A product was missing from your order.',
        '- You received the wrong product or the wrong amount.',
        '- A product was spoiled, leaking or damaged when you received it.',
        '- You were charged more than the order total.',
        '## How to tell us',
        '1. Contact us **within 24 hours** of receiving your order. Fresh milk changes quickly, so the sooner the better.',
        '2. Give your order number and tell us what went wrong. A photo helps.',
        '3. Keep the product until we reply, in case we need to collect it.',
        contactLine(site),
        '## How refunds are paid',
        'Depending on what you prefer, we will replace the product with your next delivery or pickup, or refund the amount to the M-Pesa number that paid for the order. Refunds are made by our staff, usually within 3 working days of agreeing the refund.',
        '## Cancelling',
        'You can cancel an order yourself while it is waiting for payment. After payment, [message us](/account/messages) as soon as possible. If we have not started preparing it, we will cancel and refund it.',
        '## Your rights',
        'This policy does not affect your rights under Kenyan consumer protection law.',
      );

    case 'terms':
      return lines(
        `These terms apply when you use the ${name} website and place an order with us. By creating an account or placing an order you agree to them. Please also read our [privacy policy](/privacy) and [returns policy](/returns).`,
        '## 1. Who we are',
        `This website is run by ${name}${site.business.address ? `, ${site.business.address}` : ''}, Kenya. ${contactLine(site)}`,
        '## 2. Your account',
        '- You must give a real name and an M-Pesa phone number you are allowed to use.',
        '- Keep your password private. You are responsible for orders placed through your account.',
        '- We may suspend an account that is used for fraud, abuse of staff or other customers, or repeated unpaid orders.',
        '## 3. Products and prices',
        `- Prices are in ${site.business.currency} and include any taxes that apply. The price charged is the one shown when you place the order.`,
        '- Photos are for illustration and products may look slightly different.',
        '- Stock is shown live, but an item can sell out between your order and its preparation. If that happens we will tell you and refund or replace that item.',
        '## 4. Orders and payment',
        '- An order is confirmed only when Safaricom confirms your M-Pesa payment. See [how payment works](/payments).',
        '- Totals are rounded down to whole shillings.',
        '- Orders not paid within 48 hours are cancelled.',
        minOrderLine(site) && `- ${minOrderLine(site)}`,
        '## 5. Delivery and pickup',
        '- Delivery is available in the areas and at the fees shown at checkout. See [delivery and pickup](/delivery).',
        '- Please make sure someone can receive the order at the location you give. If a rider cannot reach you after trying to contact you, we will keep your order for pickup.',
        '- Fresh products should be refrigerated as soon as you receive them.',
        '## 6. Regular orders',
        'A regular order creates a new order on each chosen day and asks you to pay for it. You can pause, change or delete a regular order at any time in [your account](/account/schedules). Unpaid regular orders are cancelled after 48 hours like any other order.',
        '## 7. Reward points',
        ...pointsLines(site).map((line) => `- ${line}`),
        '- We may change how points are earned or valued in future, with notice on this website. Points already earned stay in your account.',
        '## 8. Problems and refunds',
        'Our [returns and refunds policy](/returns) explains what to do if something is wrong.',
        '## 9. The assistant',
        site.settings.assistantEnabled
          ? 'The website assistant answers questions about our products and orders. Stock and price answers come from our live system, but general advice from the assistant is for information only. Do not share passwords or your M-Pesa PIN with it.'
          : 'We may offer an assistant on the website to answer product questions. Its general advice is for information only.',
        '## 10. Using the website',
        'Please do not misuse the website, for example by trying to get into other accounts, sending spam through messages or feedback, or interfering with how the site works.',
        '## 11. Responsibility',
        'We take care to keep the website accurate and available, but we cannot promise it will always be free of errors or interruptions. Nothing in these terms limits rights you have under Kenyan law.',
        '## 12. Changes',
        'We may update these terms. The version on this page applies to orders placed after it is published.',
        '## 13. Law',
        'These terms are governed by the laws of Kenya.',
      );

    case 'privacy':
      return lines(
        `${name} respects your privacy and handles personal data in line with the Kenya Data Protection Act, 2019. This policy explains what we collect, why, and the choices you have.`,
        '## What we collect',
        '- **Account details:** your name, M-Pesa phone number and email address.',
        '- **Delivery details:** the delivery location and notes you give us.',
        '- **Orders:** what you ordered, when, how much you paid and your M-Pesa receipt number.',
        '- **Messages and feedback** you send us through the website.',
        '- **Assistant questions:** what you type into the website assistant.',
        '- **Reward points** you earn and use.',
        '## Why we use it',
        '- To prepare, deliver and take payment for your orders.',
        '- To send you updates about your orders and regular orders.',
        '- To answer your messages, feedback and questions.',
        '- To run your reward points.',
        '- To keep accurate business and tax records, as the law requires.',
        '- To send you offers, only if you agree. You can change this any time under [Profile](/account/profile).',
        '## Who we share it with',
        'We never sell your data. We share only what is needed with:',
        '- **Safaricom (M-Pesa)**, to take your payment.',
        '- **Our riders**, who see your name, phone number and delivery location for orders they deliver.',
        '- **Supabase**, which hosts our database and sign-in securely.',
        '- **Google**, only if you choose to sign in with Google.',
        site.settings.assistantEnabled && '- **An AI language service**, which receives the text you type into the assistant to write general answers. It never receives your account, order or payment details.',
        '- **The Kenya Revenue Authority** and other authorities, where the law requires it.',
        '## How long we keep it',
        'We keep order and payment records for as long as tax law requires (currently at least five years). Account and delivery details are kept while your account is open. Messages and feedback are kept as long as needed to help you.',
        '## Your rights',
        'You can ask to see the data we hold about you, correct it, or delete your account and the data we are not required to keep. You can correct most details yourself under [Profile](/account/profile). For anything else, contact us and we will reply within 7 days.',
        contactLine(site),
        'If you are unhappy with how we handle your data you may complain to the Office of the Data Protection Commissioner.',
        '## Security',
        'Your password is handled by our sign-in provider and we never see it. Only staff who need your details can see them. We never ask for your M-Pesa PIN.',
        '## Cookies',
        'See [cookies and storage](/cookies) for what this website saves on your device.',
        '## Changes',
        'We will post any changes to this policy on this page.',
      );

    case 'cookies':
      return lines(
        'This website does not use advertising or tracking cookies. It saves a few things on your device so the shop works for you.',
        '## What we save on your device',
        '- **Your cart**, so it is still there when you come back.',
        '- **Saved items and recently viewed products**, shown only to you on this device.',
        '- **Your sign-in**, so you stay signed in. Signing out removes it.',
        '- **That you have seen our storage notice**, so it doesn\'t keep appearing.',
        'These are needed for the site to work, so they don\'t need consent. You can clear them any time in your browser settings; you will then be signed out and your cart will empty.',
        '## Content from other services',
        'Our fonts are loaded from Google Fonts and some photos from Unsplash. Your browser connects to those services to fetch them, which shares your IP address with them, as with any website. They do not receive your account or order details.',
        '## Questions',
        contactLine(site),
      );
  }
}

/** The text a page shows: what staff wrote in the app, or the default. */
export function infoPageText(id: InfoPageId, site: Storefront): string {
  const custom = site.pages?.[id];
  return custom && custom.trim() ? custom : defaultText(id, site);
}

export const isCustomPage = (id: InfoPageId, site: Storefront) => Boolean(site.pages?.[id]?.trim());

/** Used by the app's Pages editor to show the default text. */
export { defaultText as defaultInfoPageText };
