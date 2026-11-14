# Making the code repo private

`KIMGITO/ISMS` is public today. Installed apps (phones and desktops) look for updates
on GitHub, so if the repo is made private straight away **every installed app stops
updating, permanently**. This checklist moves updates to a separate public repo that holds
only installers, then makes the code private.

How it fits together:

| Repo | Visibility | Holds |
|---|---|---|
| `KIMGITO/ISMS` | private (at the end) | all the code, tags, CI |
| `KIMGITO/kaykays-releases` | public | release installers, `latest.json` and `logo.png` on the `update-manifest` branch. No code. |

The app already looks in `kaykays-releases` first, falling back to `ISMS`
(`src/core/native/updateManifest.ts`, `src-tauri/tauri.conf.json`).

## 1. Create the releases repo (once)

**Done 2026-11-11:** <https://github.com/KIMGITO/kaykays-releases> exists, public, with a
README (GitHub needs one commit so releases can be tagged). Never push code to it.

## 2. Give CI a token that can write to both repos (once)

1. GitHub → Settings → Developer settings → **Fine-grained personal access tokens** →
   Generate new token.
   - Repository access: **Only select repositories** → `ISMS` and `kaykays-releases`.
   - Permissions → Repository → **Contents: Read and write**.
   - Expiry: up to a year. Put a reminder in your calendar to renew it: when it
     expires, releases fail at the "Tag and publish" step.
2. In `ISMS` → Settings → Secrets and variables → Actions:
   - **Secrets** tab → New secret `RELEASE_TOKEN` = the token.
   - **Variables** tab → New variable `RELEASES_REPO` = `KIMGITO/kaykays-releases`.

## 3. Ship the bridge release

Push to `main` as usual. While `ISMS` is still public, the release workflow publishes the
same release to **both** repos ("Choose where to publish" in the log lists them). Old apps
read it from `ISMS`, install it, and from then on look in `kaykays-releases`.

Check the run is green, and that
<https://github.com/KIMGITO/kaykays-releases/releases> shows the version.

Then deploy the email function, so emails link the logo and download page in the new repo:

```
supabase functions deploy send-email auth-otp customer-assistant
```

## 4. Wait until every device has the bridge version

There is no central list of which version each device runs, so check by hand: open the app
on each phone and computer → About, and confirm the version is the bridge release or newer.
Devices that are off or rarely opened are the ones that get missed.

Android phones on a version **before 2.0.0** can't update anyway (the signing key changed at
2.0.0). Reinstall those from the releases page.

## 5. Make `ISMS` private

`ISMS` → Settings → General → Danger zone → **Change repository visibility** → Private.

The release workflow notices on its own and stops publishing to `ISMS`.

Check afterwards:
- The next release still goes green and appears in `kaykays-releases`.
- The staff web app and website still deploy. They are on Cloudflare, deployed from
  GitHub Actions (docs/HOSTING_CLOUDFLARE.md), so a private repo makes no difference.

## 6. GitHub Actions minutes (decide before step 5)

Public repos get unlimited Actions minutes. Private repos on the free plan get
**2,000 minutes a month**, and Windows jobs count double. When minutes run out, builds stop
until the month resets (nothing is charged unless you set a spending limit).

Measured in November 2026, a release push costs about 20–25 minutes, mostly the Linux job
installing system packages (4–13 minutes). A push that isn't a release (`chore:`, `docs:`,
`wip:` … commits) skips the release builds and costs about 3 minutes (the Android check
in "Build App Installers"). At about 5 release pushes a day that's over the free 2,000.

What helps:
- The Linux jobs no longer rebuild the man-page index after installing packages
  (changed 2026-11-11), which was the usual cause of the slow installs.
- Use `fix:`/`feat:` only for commits that should reach users; `chore:`/`wip:` for the
  rest, then one `fix:` or `feat:` commit releases everything since.
- GitHub Pro (3,000 minutes), or a spending limit if you'd rather pay than wait.

## 7. Later clean-up

Once every device has updated past the bridge release, the two `KIMGITO/ISMS` addresses at
the end of `MANIFEST_SOURCES` and the Tauri `endpoints` can be removed (keep both lists
identical; a test checks this).

## Note on the old signing key

The pre-2.0.0 Android keystore was in this repo's public history from July 17 to Nov 6,
2026. Making the repo private stops anyone new seeing it, but it may already have been
copied, and its password is the only protection left. The current key (created Nov 6) was
never public.
