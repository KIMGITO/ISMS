# KayKay's customer website

The customer-facing site: shop, M-Pesa checkout, accounts, order schedules, messages, feedback, milk guides and a restricted AI assistant. It is a separate Vite build from the staff app and shares only the Supabase project. Staff run it from the **Online Store** screen in the staff app.

## Commands

    npm run website:dev      # http://localhost:5180
    npm run website:lint
    npm run website:build    # output in website/dist

It reads `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_WEBSITE_SLUG` (default `kaykays`) and `VITE_SITE_URL` from the root `.env`.

## Going live

1. Apply the migrations, including `20261105002_security_hardening.sql` and `20261105010_customer_portal.sql`.
2. Set the M-Pesa secrets. Start with `MPESA_ENV=sandbox`. The variables are listed in `.env.example`:

       supabase secrets set MPESA_ENV=sandbox MPESA_CONSUMER_KEY=... MPESA_CONSUMER_SECRET=... \
         MPESA_SHORTCODE=... MPESA_PASSKEY=... MPESA_CALLBACK_TOKEN=...

3. Deploy the functions:

       supabase functions deploy customer-checkout mpesa-webhook customer-assistant

4. In Supabase Auth, add the website's address to the allowed redirect URLs and set up an email provider, so confirmation and password reset emails can be sent.
5. In the staff app, open **Online Store > Website**:
   - Set the website name to `kaykays`. The site stays hidden until this is set.
   - Confirm the delivery fee. It starts at Ksh 150.
   - Untick any products customers shouldn't see. Every product priced above 0 is shown by default.
6. In **Online Store > Guides**, add the starter guides, check them, then publish them.
7. Fill in the business description, address, phone and email in **Business Management**.
8. Run `npm run website:build` and upload `website/dist` to any static host.
   The host must serve `index.html` for unknown paths. The build includes `_redirects` (Netlify, Cloudflare Pages) and `404.html` (GitHub Pages). For other hosts, add a rewrite rule.
9. Make a real sandbox payment, then switch to `MPESA_ENV=production` with live till credentials (`MPESA_TRANSACTION_TYPE=CustomerBuyGoodsOnline`, `MPESA_SHORTCODE` set to the store number, `MPESA_PARTY_B` set to the till number) and make one small real payment before announcing the site.

## Connecting kaykays.com

1. Point the domain at your host and turn on HTTPS.
2. Set `VITE_SITE_URL=https://kaykays.com` and run `npm run website:build`, then upload the result. Until this is set, every page asks search engines not to index it, so a preview can't compete with the real site.
3. Add `https://kaykays.com/account` to the allowed redirect URLs in Supabase Auth.
4. Add the site to Google Search Console and submit `https://kaykays.com/sitemap.xml`.

## SEO

`src/seo.ts` holds every page's title, description and structured data (Store, Product, Article, BreadcrumbList), generated from your real business data. `scripts/prerender.ts` writes a separate HTML file for each public page at build time, so search engines and link previews see the right content. Cart and account pages are never indexed.

**Rebuild and upload the site after adding products or guides, or changing prices**, so search results stay current. Customers always see live data either way.

## How it works

**Data access.** Customers sign in through Supabase Auth and have no business membership, so staff policies exclude them. They read their own rows through RLS and write only through database functions. Don't add anon or customer policies on `products` or `businesses`, because a policy can't hide columns such as `products.cost`.

**Orders.** `place_online_order` prices everything on the server. Totals are rounded down to whole shillings because M-Pesa rejects cents.

**Payments.** `customer-checkout` starts the STK push and `mpesa-webhook` receives Safaricom's result, authorised by `MPESA_CALLBACK_TOKEN`. Only the callback can mark an order paid. It inserts a normal `transactions` row, so the existing triggers update stock, loyalty points and money assets. Wrong amounts, second payments and stock shortages are flagged for staff under **Online Store > Orders**.

Refunds are manual. Cancelling a paid order from the site isn't supported, so staff handle these in M-Pesa and the POS.

**Assistant.** `customer-assistant/logic.ts` answers availability, quantity and total questions in code from live stock. The language model only sees general guides and the customer's text, never stock or cost figures, and its replies are checked before a customer sees them.

**Schedules.** A daily job (`run_customer_portal_daily`, 05:00 Nairobi) raises due schedules as unpaid orders and messages the customer, because M-Pesa needs their PIN for each payment. It also cancels orders left unpaid for 48 hours. It needs `pg_cron`; without it, call the function from an external scheduler.

**Customer records.** Each website account gets a new `customers` row. It isn't matched to an existing customer by phone, because the phone number is unverified and matching would expose that customer's history.
