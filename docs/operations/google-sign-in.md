# Sign in with Google (website)

How Google sign-in works on the customer website, and how to switch it on.

## What the customer sees

1. **"Continue with Google" button** with the Google logo, on the Sign in and Create account screens (`/account`). Tapping it opens Google's page and comes back signed in.
2. **Automatic prompt (Google One Tap).** A visitor who is already signed in to Google in their browser sees Google's own box in the top-right corner (a bottom sheet on phones): "Sign in to <shop> with google.com" and their account, "Continue as <name>". Nothing happens until they tap it to confirm. If they close it, it stays away for 24 hours on that device. It does not show on the account pages, inside the app's website preview, or for someone already signed in.

Both ways create a customer account on the **branch being browsed** (the one picked in the store picker, or the website's own shop). An existing customer who signs in on another branch's store has their account moved to that branch, like any other branch switch. After a first Google sign-in, the website asks for name and phone once (Google does not give a phone number).

## Setting it up (once)

### 1. Google Cloud

1. Go to console.cloud.google.com and create a project (or use an existing one), for example "Kaykays website".
2. **APIs & Services → OAuth consent screen**: user type **External**; app name (the shop name), support email, logo (optional), and the website address under Authorised domains (for example `kaykays.com`, and `workers.dev` while testing). Scopes: `email`, `profile`, `openid` only. Publish the app (move it from Testing to In production), or only test users can sign in.
3. **APIs & Services → Credentials → Create credentials → OAuth client ID**, type **Web application**:
   - **Authorised JavaScript origins** (needed for the automatic prompt): every website address, for example `https://kaykays.com`, `https://www.kaykays.com`, the workers.dev address, and `http://localhost:5174` for local testing (both `http://localhost` and `http://localhost:<port>` are needed for One Tap locally).
   - **Authorised redirect URIs** (needed for the button): `https://<project-ref>.supabase.co/auth/v1/callback` (Supabase shows this exact address on its Google provider page).
4. Copy the **Client ID** and **Client secret**.

### 2. Supabase

1. Dashboard → **Authentication → Sign In / Providers → Google**: turn it on, paste the Client ID and Client secret, save.
2. Same page: leave **Skip nonce checks** OFF (the website sends a nonce).
3. **Authentication → URL Configuration**: Site URL = the main website address; add every website address followed by `/account` to **Redirect URLs** (for example `https://kaykays.com/account`, `https://*.workers.dev/account`, `http://localhost:5174/account`).

### 3. Website settings

- GitHub → Settings → Secrets and variables → Actions → **Variables**: add `VITE_GOOGLE_CLIENT_ID` = the Client ID. `VITE_AUTH_PROVIDERS` stays `google` (or unset).
- Local: add `VITE_GOOGLE_CLIENT_ID=...` to `.env`.
- Push to main (or rerun the "Deploy web" workflow) so the website is rebuilt with it.

The website's security headers already allow Google's sign-in script and frame (`accounts.google.com/gsi/...`), in `website/public/_headers` and `website/worker/index.ts`.

## Checking it works

1. Open the website in a private window, signed in to Google: the "Continue as <name>" box appears top-right within a few seconds. Tap it: you are signed in, then asked for name and phone once.
2. Sign out, pick a different branch in the store picker, sign in with the button: Account shows that branch's orders and points.
3. Close the prompt once: it does not come back for a day on that browser.

## When it does not show

- No `VITE_GOOGLE_CLIENT_ID` in the build, or Google turned off in Supabase: the prompt stays hidden; the button explains Google sign-in isn't available yet.
- The site address is missing from Authorised JavaScript origins: the browser console shows "The given origin is not allowed".
- The visitor is not signed in to Google, has third-party sign-in blocked in the browser, or closed it recently: Google decides not to show it. The button always works.
- "Nonces mismatch" in Supabase: Skip nonce checks must be off and the page must not be cached between prompt and tap; reload and try again.
