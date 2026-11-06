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
| Africa's Talking | Dial code for phones without internet | No dial-code ordering | Tested with simulated gateway requests; the real gateway has never been called |
| WhatsApp Cloud API | Automatic WhatsApp messages | Staff open each chat by hand | Never run against Meta |
| Twilio | SMS from the staff app | Staff use WhatsApp or email | Never run |
| SMS provider in Supabase Auth | Phone number sign-in codes | Phone sign-in stays hidden | Never run |
| Google | Website sign-in | The button shows, and says it isn't available yet | Never run against real Google |
| Apple | Website sign-in | The button stays hidden | Never run |
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

4. Deploy `mpesa-webhook`, `mpesa-payments` and `till-callback`, then apply migration `20261106001_void_payments_expenses_mpesa_till.sql`.
5. In the app, open **Business Management > M-Pesa**, enter the till number and press **Register till with Safaricom**. Each branch with its own till does this once.

How payments reach the app:

| How the customer pays | What happens |
| --- | --- |
| Online order or dial code | A prompt goes to their phone and the order settles when they pay. |
| Staff press **Send M-Pesa prompt** | A prompt goes to their phone. When they pay, the payment is recorded by itself, against the customer's debt and then their wallet, or as a walk-in. |
| They pay the till from their own phone | A till payment carries no account number, so it waits under **Paid to the till** until staff assign it to a customer, mark it as a sale already rung up, record it as a walk-in, or ignore it with a note. |

Every customer has an account number (from 100001). It appears on the customer's page and goes out as the account reference on prompts. If the business ever adds a paybill, payments quoting the number will be matched automatically.

Safaricom refuses till callback addresses containing words like "mpesa", which is why that function is called `till-callback`. It calls `https://<project-ref>.supabase.co/functions/v1/till-callback?type=confirmation&token=<MPESA_CALLBACK_TOKEN>`. Set `MPESA_C2B_SHORTCODE` if Safaricom registers your till under a different short code than `MPESA_SHORTCODE`.

### Dial code (Africa's Talking)

**Try it free first, in the sandbox:**

1. Create an account at [africastalking.com](https://africastalking.com) and open the [sandbox](https://help.africastalking.com/en/articles/1170660-how-do-i-get-started-on-the-africa-s-talking-sandbox). Its username is always `sandbox`.
2. Generate a long random token with `openssl rand -hex 32`, then set the secrets and deploy:

   ```bash
   supabase secrets set USSD_CALLBACK_TOKEN=<token> USSD_SHOP_SLUG=kaykays
   supabase functions deploy ussd
   ```

3. In **USSD > Create Channel**, choose a test channel and set the callback URL to `https://<project-ref>.supabase.co/functions/v1/ussd?token=<token>`.
4. Dial it on the Africa's Talking simulator. Sandbox sessions only reach the simulator, not real phones.

**Go live:**

1. Switch to your live Africa's Talking account and request a service code. A shared code such as `*384*123#` is the usual start; a dedicated one costs more. Approval goes through the mobile networks and can take weeks, so allow for it.
2. Top up the account, since sessions are charged. Check current prices with Africa's Talking.
3. Set the same callback URL on the live channel, then test one order from a real phone.

**How it behaves:**

- Africa's Talking sends `sessionId`, `serviceCode`, `phoneNumber` and `text`, with each answer so far joined by `*`. Every reply starts with `CON` to continue or `END` to finish.
- The gateway [expects a reply within 10 seconds](https://developers.africastalking.com/docs/ussd/overview). Placing an order calls M-Pesa inside that time, so a slow M-Pesa response can show callers a network error. Test this on the live service, because the mock can't show it.
- Callers create an account with just their name, then order, pay through an M-Pesa prompt, and check their orders, points and balances. It offers the first 7 products in stock, and paying needs M-Pesa on that line.
- The network supplies the phone number, so it identifies the caller. Someone with a website account under another login gets a separate dial-code account.

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

Email works without further setup. The Google button shows by default and tells customers it isn't available until the steps below are done. For phone and Apple, finish the steps below, then add the option to `VITE_AUTH_PROVIDERS` (for example `google,phone,apple`) and rebuild the website. Buttons only appear for options on that list.

First, in **Supabase > Authentication > URL Configuration**, set the Site URL and add `https://kaykays.com/account` to the Redirect URLs. Add the address you test from too.

Google and Apple both send customers back to the same Supabase address, shown on each provider's page in the dashboard:

```text
https://<project-ref>.supabase.co/auth/v1/callback
```

Customers who sign in with Google, Apple or a phone number are asked for any missing name and M-Pesa number the first time.

#### Google

Full reference: [Supabase Google guide](https://supabase.com/docs/guides/auth/social-login/auth-google).

1. Create a project in the [Google Cloud Console](https://console.cloud.google.com) and open the **Google Auth Platform**.
2. Under **Branding**, set the app name and logo. Brand verification can take a few business days.
3. Under **Audience**, choose who can sign in.
4. Under **Data Access**, add the `openid` scope. The email and profile scopes are there by default. Don't add others, because they can trigger a long review.
5. Under **Clients**, create an OAuth client of type **Web application**:
   - **Authorized JavaScript origins:** `https://kaykays.com`
   - **Authorized redirect URIs:** the Supabase address above
6. Copy the Client ID and Client Secret into **Supabase > Authentication > Providers > Google**, then save.

#### Apple

Full reference: [Supabase Apple guide](https://supabase.com/docs/guides/auth/social-login/auth-apple). This needs a paid Apple Developer account.

1. Note your **Team ID**, the 10-character code in the Apple Developer account.
2. Create an **App ID** with **Sign in with Apple** turned on. Leave the server-to-server notification address blank.
3. Create a **Services ID**, such as `com.kaykays.app.web`, and link it to the App ID. Under its website settings, set:
   - **Domain:** `<project-ref>.supabase.co`
   - **Redirect URL:** the Supabase address above
4. Under **Keys**, create a Sign in with Apple key and download its `AuthKey_XXXXXXXXXX.p8` file. Keep it offline, because Apple only lets you download it once.
5. Generate the client secret from the `.p8` file with the generator in the Supabase guide. It doesn't work in Safari.
6. In **Supabase > Authentication > Providers > Apple**, enter the Services ID as the client ID and the generated secret as the secret key.
7. To have Apple's private relay addresses receive your emails, register your sending domain under **Sign in with Apple for Email Communication**.

**Renew the secret every 6 months.** Apple requires it, and sign-in stops if it lapses. Set a recurring calendar reminder now.

#### Phone number

1. In **Supabase > Authentication > Providers > Phone**, turn on phone sign-in and enter an SMS provider's details. Check that the provider delivers to Kenyan numbers.
2. Each code is a paid SMS, and Supabase's own rate limits apply. Review them under **Authentication > Rate Limits**.

### Backups, push notifications and AI

See [Scheduled jobs](RELEASE_AND_OPERATIONS.md#scheduled-jobs) for backups and [the deploy steps](RELEASE_AND_OPERATIONS.md#deploying-backend-changes) for the push notification webhook. Add AI provider keys in the app's AI settings.

## Protecting inbound calls

Safaricom and Africa's Talking can't sign in, so `mpesa-webhook` and `ussd` require a secret token in the URL. Treat those URLs as passwords, and change the token if one leaks. Africa's Talking also publishes its IP ranges, which are worth restricting at a later stage.
