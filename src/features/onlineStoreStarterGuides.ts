// General guides for any shop. Staff add them as drafts, then edit and publish from the Online Store screen.
export interface StarterGuide {
  slug: string;
  title: string;
  category: string;
  summary: string;
  body: string;
}

export const STARTER_GUIDES: StarterGuide[] = [
  {
    slug: 'how-to-order-online',
    title: 'How to order online',
    category: 'Ordering',
    summary: 'From choosing products to paying, in a few steps.',
    body: `## Choose what you want
Browse the shop or search by name. Pick how many you want and add it to your cart.

## Check your cart
Open the cart to change amounts or remove items. The total is shown before you pay.

## Delivery or pickup
Choose delivery and give your location, or choose to collect from our shop.

## Pay
Pay with your phone: a prompt arrives, and you enter your PIN to confirm. We message you once the order is on its way or ready to collect.`,
  },
  {
    slug: 'checking-your-order',
    title: 'Checking your order when it arrives',
    category: 'Delivery',
    summary: 'What to look at when your order reaches you.',
    body: `## Before the rider leaves
- Count the items against your order.
- Look for damaged, open or leaking packs.
- Check the dates on anything that has one.

## If something is wrong
Tell us as soon as you can, with your order number and a photo if possible. We will replace it or refund you.`,
  },
  {
    slug: 'regular-orders',
    title: 'Getting the same order every week',
    category: 'Ordering',
    summary: 'Set it up once and we prepare it on the days you choose.',
    body: `## Set it up
Sign in, open your account and choose Regular orders. Pick the products, how many, and the days you want them.

## Changing it
You can change the amounts or the days, or pause it, from your account at any time.

## Paying
Each order is prepared on its day and you pay for it as usual.`,
  },
  {
    slug: 'storing-what-you-buy',
    title: 'Storing what you buy',
    category: 'Care',
    summary: 'Simple ways to make your products last.',
    body: `## Follow the pack
Most packs say how to store them. Follow that first.

## Keep it cool and dry
Unless the pack says otherwise, keep products away from direct sun, heat and damp.

## Check the date
Use the oldest first. Don't use anything past its date, or that looks or smells wrong.`,
  },
];
