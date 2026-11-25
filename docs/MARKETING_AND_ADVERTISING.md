# Marketing and advertising

Built 2026-11-25. Migration `supabase/migrations/20261207001_marketing_campaigns.sql`, edge function
`supabase/functions/canva-connect`, app screens in `src/features/marketing/`, website code in
`website/src/ads/`. Nothing here is live yet: see "To finish" in [TO_FINISH.md](TO_FINISH.md).

## 1. What a shop can do

- **Campaigns** (Marketing > Campaigns): name, description, kind (seasonal, discount, flash sale,
  brand awareness, Black Friday, Christmas, new product, clearance, event, other), aim, start and
  end in the shop's own time zone, priority 1 to 100, colour (brand, dark, light), button
  (a page or https address, a product, a category, the campaign page, a promotion code or
  WhatsApp), offer label, promotion code, products or category in the offer, and an optional
  campaign page at `/promo/<address>`.
- **Actions**: create, change, copy, publish (or schedule when the start is in the future), back
  to draft, pause, resume, end now, archive, restore. Every action is written to the campaign's
  history, with who and when.
- **Creatives**: up to 20 per campaign, each for one placement, sharing the campaign's schedule
  and status. Picture or video, optional phone version, cover picture and captions for videos,
  headline, words, button text, picture description, focal point, where the words sit on a
  banner, play-by-itself (muted) for videos, hide.
- **Creative studio**: the media library (pictures, videos, captions), with folders, search,
  descriptions, focal points and removal; and Canva (section 4).
- **Placements**: switch each placement on or off, how many adverts share it, priority or
  rotation, seconds per banner, pop-up delay and how often a visitor sees it again; the shop's
  time zone.
- **Overview and Performance**: counts by status, what is showing, what is coming, dates to plan
  for, recent activity, and loaded / seen / clicked / orders after a click / their value, per
  shop, per campaign and per creative.

Permissions: `marketing.view` (see) and `marketing.manage` (change). Owner and Admin have both,
Manager gets both by default, others none. The module is `online_store`: a plan without the
online store has no marketing.

## 2. Placements and formats

| Placement | Where | Formats | Phone version |
|---|---|---|---|
| Home banner | Top of the home page, before the shop's own banner; up to 3, carousel | 16:9 picture or 16:9 video | 16:9, 4:5, 1:1, 9:16 |
| Announcement bar | Thin bar above the menu on every page; visitor can close it | Text | - |
| Promotional cards | Home page, after the categories | 4:5 or 1:1 | - |
| Product promotion | Product pages of the chosen products or category | Text, 1:1, 4:5 | - |
| Video | Home page, after the first products row | 16:9 or 9:16 video | 9:16 |
| Pop-up | Once per visit, after a delay; never on cart, checkout, account, tracking | 1:1, 4:5, text | - |
| Category banner | Top of the shop page (whole shop, or the campaign's category) | 3:1 | 3:1, 1:1, 4:5 |
| Campaign page | `/promo/<address>`: banner, words, code, products, videos, more pictures | any | 4:5, 1:1, 9:16 |

Recommended widths: 16:9 1280 px, 3:1 1200 px, 4:5 and 1:1 600 px, 9:16 720 px. Below half of
that the database refuses the picture; between half and the full width the app warns.

Pictures sit in a box of the format's shape (or the phone version's shape on phones), so nothing
moves while they load, and are cropped around their focal point with `object-fit: cover`: never
stretched. The rules live in one file, `website/src/ads/rules.ts`, used by the website and the
app; the database has the same numbers (`fn_mkt_format`, `fn_mkt_placement`) and a test compares
them.

## 3. Scheduling

- A campaign's stored `state` is what staff decided (draft, live, paused, ended, archived). What
  visitors see is worked out from the clock each time (`fn_mkt_status`, same in `rules.ts`):
  draft, scheduled, active, paused, completed, archived. A campaign is never public before its
  start or after its end, and nothing has to run on time for that to be true.
- Times are typed in the shop's time zone (`businesses.timezone`, default `Africa/Nairobi`,
  changed on Placements) and converted by the database.
- The website asks for adverts again at the next start or end the database reports
  (`refreshAt`), and at least every 5 minutes; each placement also re-checks end times every
  30 seconds in an open tab.
- A job every 5 minutes (`marketing-jobs`) only writes "started" and "finished" into the history
  and clears old de-duplication keys.
- Conflicts: two campaigns with pop-ups at the same time and the same priority are refused at
  publish (only one pop-up ever shows). Other placements take the highest priority first; equal
  priorities take turns per visit when the placement is set to rotate.

## 4. Canva

Investigated against Canva's official documentation (canva.dev, Connect APIs):

- Connect API: OAuth 2.0 authorization code with PKCE; the token exchange needs the client
  secret and must happen on a server. Refresh tokens are single-use.
- Create design: `POST /rest/v1/designs` with a custom size in pixels (40 to 8000); returns an
  edit link valid 30 days, usable only by the person who asked.
- List designs: `GET /rest/v1/designs` (search, owned, newest first). Get design for a fresh edit
  link. Export: `POST /rest/v1/exports` (JPG, PNG, MP4 ...), then poll the job; download links
  last 24 hours. Revoke: `POST /rest/v1/oauth/revoke`. Profile: `GET /rest/v1/users/me/profile`.
- **Integration types**: a *public* integration works for any Canva user but must be reviewed
  and approved by Canva first (it can be tested by its developer while in draft). A *private*
  integration needs a Canva Enterprise team and works only for that team. Preview API features
  fail review, so none are used (no brand templates, no design copying).

What was built:

1. **Canva-assisted (works today, no setup)**: Creative studio shows the exact pixel size for the
   chosen format, the steps (Custom size, design, Download as JPG/PNG or MP4), a link to Canva,
   and an upload button that puts the file in the library (folder "Canva").
2. **Connected (after the owner registers the integration)**: `canva-connect` edge function.
   Each person connects their own Canva account; tokens are stored encrypted (AES-GCM, key
   `CANVA_TOKEN_KEY`) in `canva_connections`, readable only by the server. The studio can then
   create a design at the advert's exact size and open it in Canva, list the person's designs,
   reopen one to edit, and **Import**: Canva exports it (JPG, or MP4 at 1080p plus a JPG cover),
   the function reads the real size and length from the file, stores it in the shop's folder and
   registers it as the person, so permission, file type, size and plan storage are checked as for
   any upload. To update a design: edit it in Canva, import again, change the creative's picture.

Canva is never required: every advert can be made with any tool and uploaded.

## 5. Media and uploads

- Bucket `website-media` (public, 50 MB, only JPG, PNG, WebP, AVIF, GIF, MP4, WebM, VTT). Writes
  only into the shop's own folder, only with `marketing.manage` or `business.update`.
- The app checks type and size first, shrinks pictures above 2560 px, reads video size and
  length in the browser, takes a cover picture from the video, and checks captions start with
  `WEBVTT`. The database (`website_media_register`) then checks the stored file's real type and
  size from Storage, the address, the size limits (pictures 10 MB, videos 50 MB and 3 minutes,
  captions 200 KB) and the plan's storage allowance (`storage_mb`, summed over the company).
  SVG and HTML are never accepted.
- A refused upload is deleted again. Media used by a campaign that is not archived can't be
  removed; media only used by archived campaigns is hidden but kept; unused media is deleted
  with its file.

## 6. Statistics

| Figure | Meaning |
|---|---|
| Loaded | The advert was on the page |
| Seen | At least half of it was on screen for one second, with the tab visible |
| Clicked | Its button or picture was pressed (or the video was played) |
| Orders after a click | An online order placed by the signed-in customer, at this shop, within 24 hours after clicking, and under an hour old when reported; one advert per order |
| Value | Sum of those orders' totals, read from `online_orders` at report time; cancelled, unpaid and failed orders left out |

Each figure is counted once per visit, advert and day. A visit is a random id kept only in that
browser tab (no cookies, nothing personal, no IP stored). Browsers sending Do Not Track or Global
Privacy Control are not counted. The tracking call is rate-limited per IP. Click rate is shown
only once something has been seen. Preview links count nothing. Hidden creatives keep their
figures; creatives with figures are hidden instead of deleted.

## 7. Preview

- In the app: the campaign editor draws the creatives at phone, tablet and desktop width with
  the real pictures, crops, phone versions and the shop's colour.
- On the real website: **Open on my website** makes a link valid two hours (secret stored only as
  a hash, tied to the shop and campaign) that shows the campaign as if running, on top of what is
  live, with a "Campaign preview" bar and a Leave button.

## 8. Security

- Tenant from the address only: `get_public_campaigns(slug)` looks the shop up by its web name;
  no caller-supplied business id is trusted. Drafts, paused, ended and archived campaigns and
  hidden creatives are never returned. Shops closed by their plan return nothing.
- Tables are read-only to members with `marketing.view`; all writes go through functions that
  check `marketing.manage` and validate every field (unknown fields refused, links limited to
  `/path` or `https://`, products and promotion codes must be the shop's own, media must be in
  the shop's library). Read-only plans block changes (`trg_zz_plan_read_only`).
- Statistics, conversions, Canva tokens and preview links are server-only tables.
- The website's Content-Security-Policy now allows `media-src https:` so videos from Storage play.

## 9. Tests

- `supabase/tests/marketing/marketing_test.sh` (122 checks) on a throwaway database
  (`rebuild.sh`, database `mkt_test`): time zone, media registration and refusals, storage
  policy, campaigns and validation, creatives and format/size checks, preview links, drafts never
  public, schedule (scheduled, starts with no job, expires at once, job history idempotent),
  pause/resume/end/archive, duplicate, placements and pop-up conflicts, statistics
  de-duplication, cross-shop and draft events ignored, conversions (own order only, once),
  reports, removing, plan gating, tenant isolation.
- `src/test/marketingTests.ts` (13, in `npm test`): rules match the database and the Canva
  function, status, selection, rotation, targeting, safe links, picture fit, pop-up rules,
  refresh timing, honest figures, lazy video, upload checks, time zones and dates.
- Browser check (2026-11-25, headless Chrome against the real functions on the test database):
  announcement bar, home banner with phone version, cards, video poster, pop-up after its delay,
  category banner only on its category, campaign page with its products; expired and future
  campaigns absent; loads and views recorded once per visit.

## 10. Limitations

- Not yet clicked through in the running app (Tauri, Android) or on the live website.
- Canva connected mode is untested against Canva itself: it needs the owner's integration
  (section 4) and Canva's review before shops other than the developer's can use it.
- Order attribution is last-click within 24 hours and needs the customer signed in; till sales
  are not attributed.
- Pictures are served at their uploaded size (up to 2560 px); there is no image resizing service
  yet, so phones load the phone version when given, else the full picture.
- Videos are stored as uploaded (no transcoding or streaming formats). Keep them short and 1080p
  or smaller.
- The campaign page's title is set in the browser; the Worker does not yet write its own head
  tags for `/promo/` addresses.
- Files uploaded to Storage but never registered (a closed tab mid-upload) are not cleaned up.
- Custom website pages should reserve the path `promo` (website engine `fn_valid_pages`).
