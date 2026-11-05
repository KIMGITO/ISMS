# External systems

What KayKay's connects to, what each connection needs, and what happens without it. Every connection is optional except Supabase. Secrets go in Supabase, never in the repo or the app.

## What runs where

| Part | Where it runs | How it starts |
|---|---|---|
| Staff app (Android, Windows, Linux) | Staff devices | Built by `.github/workflows/build.yml`, see [the release guide](RELEASE_AND_OPERATIONS.md) |
| Customer website | Any static host | `npm run website:build`, see [website/README.md](../website/README.md) |
| Database, logins, files | Supabase | `supabase db push` |
| Edge functions | Supabase | `supabase functions deploy` |
| Scheduled jobs | Supabase `pg_cron` | Registered by migration `20261105012` |

No server of our own is needed. External services call the edge functions directly.

## Connections

| System | Used for | Without it | Status |
|---|---|---|---|
| Safaricom Daraja | M-Pesa payment prompts, on the website and by dial code | Online orders can't be paid | Tested against a mock only |
| Africa's Talking | Dial code for phones without internet | No dial-code ordering | Menu unit tested; gateway never called |
| WhatsApp Cloud API | Automatic WhatsApp messages | Staff open each chat by hand | Never run against Meta |
| Twilio | SMS from the staff app | Staff use WhatsApp or email | Never run |
| SMS provider in Supabase Auth | Phone number sign-in codes | Phone sign-in stays hidden | Never run |
| Google, Apple | Website sign-in | Those buttons stay hidden | Never run |
| Resend or SendGrid | Email | Sign-in emails and email messages fail | Never run |
| Google Sheets | Nightly backups | No Sheets backup | Scheduling tested; a real backup hasn't run |
| Firebase | Push notifications | No pushes | Never run |
| Hugging Face or another AI provider | AI features | AI answers are unavailable | The website assistant's model path hasn't run |

## Setting each one up

### M-Pesa (Daraja)

1. Create an app at [developer.safaricom.co.ke](https://developer.safaricom.co.ke) and make a sandbox payment first.
2. Apply to go live for the till. Safaricom issues the store number and passkey.
3. Set the secrets:

   ```bash
   supabase secrets set MPESA_ENV=production MPESA_CONSUMER_KEY=... MPESA_CONSUMER_SECRET=... \
     MPESA_SHORTCODE=<store number> MPESA_PARTY_B=<till number> MPESA_PASSKEY=... \
     MPESA_TRANSACTION_TYPE=CustomerBuyGoodsOnline MPESA_CALLBACK_TOKEN=<long random string>
   ```

Safaricom calls `https://<project-ref>.supabase.co/functions/v1/mpesa-webhook?token=<MPESA_CALLBACK_TOKEN>`. The app builds this address itself.

### Dial code (Africa's Talking)

1. Create an [Africa's Talking](https://africastalking.com) account and request a USSD code. A shared code such as `*384*123#` is the usual start; a dedicated one costs more. Approval goes through the mobile networks and can take weeks.
2. Set the secrets: `supabase secrets set USSD_CALLBACK_TOKEN=<long random string> USSD_SHOP_SLUG=kaykays`.
3. Deploy with `supabase functions deploy ussd` and set the callback URL in Africa's Talking to `https://<project-ref>.supabase.co/functions/v1/ussd?token=<USSD_CALLBACK_TOKEN>`.

Callers can create an account with just their name, order, pay through an M-Pesa prompt, and check their orders, points and balances. It shows the first 7 products in stock. Payment needs M-Pesa on that line.

### WhatsApp

1. In [Meta for Developers](https://developers.facebook.com), create a WhatsApp Business app and register a number. That number can't stay on the ordinary WhatsApp app.
2. Create a permanent access token.
3. Get a message template approved, with one variable as its whole body, such as `{{1}}`. WhatsApp only allows free text within 24 hours of the customer's last message, so bulk messages need this template. Meta charges per conversation.
4. Enter the phone number ID, token and template name in **Settings > WhatsApp API**.

Message delivery reports aren't tracked: a send counts as done once Meta accepts it.

### Sending messages

**Communication Center > Send by** chooses the channel:

| Option | What happens |
|---|---|
| Automatic | WhatsApp API, then SMS. Anyone still unreached is listed to send by hand. |
| WhatsApp API, SMS or Email | That channel only. Anyone it can't reach is listed to send by hand. |
| By hand | Lists everyone, and each tap opens that customer's WhatsApp chat. |

Email is limited to 30 per hour per person, so it doesn't suit large lists.

### Website sign-in

Email works without further setup. Turn on the others in **Supabase > Authentication > Providers**, then list them in `VITE_AUTH_PROVIDERS` and rebuild the website. Buttons only appear for options on that list.

| Option | Needs |
|---|---|
| Phone | An SMS provider supported by Supabase Auth, such as Twilio. Each code is a paid SMS. |
| Google | An OAuth client in [Google Cloud](https://console.cloud.google.com), with the Supabase callback URL added |
| Apple | A paid Apple Developer account, a Services ID and a signing key. Its secret expires and must be renewed about every 6 months. |

Customers who sign in with Google, Apple or a phone number are asked for any missing name and M-Pesa number the first time.

Add `https://kaykays.com/account` to **Authentication > URL Configuration > Redirect URLs** once the domain is connected.

### Backups, push notifications and AI

See [Scheduled jobs](RELEASE_AND_OPERATIONS.md#scheduled-jobs) for backups and [the deploy steps](RELEASE_AND_OPERATIONS.md#deploying-backend-changes) for the push notification webhook. Add AI provider keys in the app's AI settings.

## Protecting inbound calls

Safaricom and Africa's Talking can't sign in, so `mpesa-webhook` and `ussd` require a secret token in the URL. Treat those URLs as passwords, and change the token if one leaks. Africa's Talking also publishes its IP ranges, which are worth restricting at a later stage.
