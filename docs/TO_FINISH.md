# To finish

Every change that isn't fully live yet has its steps here, in order. A step marked **You:** needs the owner. The others can be run by the developer (or Claude when asked). When a step is done, tick it and add the date. When every step of an item is ticked, move it to **Done** at the bottom.

Rule: [CLAUDE.md](../CLAUDE.md) → "Finishing rule".

All the owner's account settings (Supabase passwords and MFA, backups, GitHub safety, 2FA), with click-by-click steps: [operations/owner-setup.md](operations/owner-setup.md).

## Money first at the till, hold a sale, visitor cookies, Statistics redesign (2026-11-28)

Money first: a till sale used to be saved as paid the moment it was rung up. One tap on M-Pesa, Airtel or Bank (POS, Quick Sale, a quote sold from the Sales Log, a regular order marked delivered) moved the money balance, posted the books, took the stock and printed a "Paid" receipt with no proof the money had arrived. Now those methods need the payment's code (M-Pesa or Airtel code, bank reference) before anything is saved. The database refuses the sale without it (`20261217001_sale_payment_proof.sql`), and a code pays one sale only. An M-Pesa code already in the till queue is matched to the sale and must cover it. Removing the sale gives the payment back to the queue. Cash and Card are unchanged (cash is in hand; a card already needs an approved charge). Online orders are unchanged (they settle only on the provider's callback). Receipts show the code; older sales without one print "Payment code: Not recorded". The after-sale "Send M-Pesa prompt" button is gone from POS and Quick Sale, since the money is now proven before the sale.

Hold: POS has Hold (Alt+H) to park a cart and serve the next customer, and Quick Sale has Hold on the code step. Held carts sit in the cart panel; tap one to resume, and the current cart is held in its place. Nothing is sold or taken from stock while held. Held carts are kept on that device per branch.

Website: visitors are asked about statistics cookies. With "Allow", two random first-party cookies (visitor 13 months, visit 30 minutes) let the shop see unique and returning visitors and each visitor's pages (`20261217002_website_visitor_history.sql`, kept 13 months). "Needed only" keeps the old anonymous counter. The Cookies page explains this. Website > Statistics is redesigned: a visit-to-paid-order strip, money per day, recent visitors. Unsplash search shows a centred loader.

1. [ ] Apply the database changes: `bash scripts/db-push.sh` (or `npx supabase db push`), then `bash scripts/check-live-grants.sh`. No missing grants should be reported.
2. [ ] Check on a test DB that the books agree: `C=supabase_db_isms-seedtest bash supabase/tests/sales/payment_proof_test.sh`. It should report "failed 0", including "books balance" and "M-Pesa balance up 100.00".
3. [ ] **You:** in POS, add an item and choose M-Pesa, then press Complete sale without a code. It must say "Record the money first" and save nothing. Type a code such as `QK12AB34CD` and complete. The receipt shows "Payment code QK12AB34CD". Try the same code on a second sale: it must be refused.
4. [ ] **You:** in POS, fill a cart and press Hold. The cart empties and a chip appears under "On hold". Ring up another sale, then tap the chip: the first cart comes back.
5. [ ] **You:** if a phone still has offline M-Pesa sales queued from before this update, sync them before updating. After the update the database refuses an M-Pesa sale with no code.
6. [ ] Deploy the website (the release does this), open it in a private window, and choose Allow statistics. Browse two pages. Website > Statistics should list one new visitor with those pages. Choose "Needed only" on /cookies, and the kk_vid and kk_sid cookies should be gone (browser dev tools > Storage).

## Escape closes sheets, fillable till test payment (2026-11-28)

Escape now closes the top sheet, dialog or menu on every screen (one handler in `src/app/useNativeShell.ts`, the same list the phone's Back button uses; the screen underneath never sees the key). Sheets that weren't on that list were added. Payments > M-Pesa > "Send a test payment" (sandbox only) opens a sheet with amount, account reference, payer name and phone. "In the app" posts Safaricom's C2B callback to the app's own till-callback address, so it is received, matched and booked like a real payment; "Through Safaricom" uses Safaricom's simulator (whole shillings, Safaricom's own name). No database change.

1. [ ] Deploy the function: `npx supabase functions deploy mpesa-payments`.
2. [ ] On a sandbox business, open Payments > M-Pesa > Send a test payment, enter KSh 150.50, name "Jane Wanjiku", account "INV-0012", choose In the app, Send. It should show under Payments with that name, amount and reference, and the Payments balance and books should move by KSh 150.50.
3. [ ] Open any sheet (e.g. a sale's edits, a till payment) and press Escape: only that sheet closes. In Quick Sale, Escape with a sheet open must not clear the cart.
4. [ ] Commit, then release the app.

## App.tsx split into src/app (2026-11-28)

`src/App.tsx` went from 5,385 lines to 455. The screens and pieces are now in `src/app/` (top bar, side menu, phone bar, screen list, toasts, branch list, first-launch screens), the sign-in screens in `src/app/auth/` (one file per screen plus `useAuthFlow.ts`), and App's effects in hooks (`useDataSync`, `useNativeShell`, `useBottomNavBehaviour`, `useAppearance`, `usePlanReady`, `useBranchChooser`). Unused state was removed. Nothing a user sees changed: type check, the 112 unit tests and the build pass, and a browser run of the same 24 steps on the old and new code gave pixel-identical screens, apart from animation frames. No database change.

1. [ ] **You:** on an Android phone, open the app. Check that Back closes an open sheet, then goes back a screen, then asks to exit. A field you tap should stay above the keyboard. Double-tapping an empty spot should hide and show the bottom bar. These only run on a phone.
2. [ ] Commit the split, then release the app.

## App.tsx split, migrations merged into five files (2026-11-28)

`src/App.tsx` lost its tab list, permission constants, tour steps and logo to `src/app/` (navConfig.ts, tour.ts, WorkspaceLogo.tsx). The 68 migrations are now 5: the two earlier squashed files, `20261121001_shop_features.sql`, `20261204006_support_role.sql` (kept alone: it adds an enum value) and `20261204007_platform_payments_website.sql`. A test DB built from the 5 has the same schema as one built from the 68 (`pg_dump -s`, no difference). The old files are in `supabase/migrations_archive/`. Also fixed: `20261214001` failed on a database without pg_cron.

The live database's migration history still lists the old file names, so a plain `db push` will refuse. The app is not in production, so reset live onto the new files:

1. **You:** take a backup of live first (`bash scripts/db-backup.sh`), since a reset wipes the data (including the test seed).
2. Reset live onto the 5 files: `npx supabase db reset --linked`, then `bash scripts/check-live-grants.sh`. The check should report no missing grants.
3. Run `npx supabase migration list --linked`. It should show exactly the 5 versions, local and remote matching.
4. **You:** sign up again as the first user (you become platform admin), create the business, and open Home, POS and Payments to check they load.

## Code and wording review: no fake feedback insights, AI access from the database, strict types (2026-11-28)

Feedback > Insights no longer shows made-up figures when AI is off, and reads the feedback itself. The assistant takes full access from the database instead of the role name. Strict type checks are on. Wording fixes across the app and website. Details: [operations/code-review-2026-11-28.md](operations/code-review-2026-11-28.md). No database change.

1. [ ] Deploy the two changed functions: `npx supabase functions deploy complaints --no-verify-jwt` and `npx supabase functions deploy chat --no-verify-jwt`.
2. [ ] **You:** switch AI off for messages (Settings > AI), then open Feedback > Insights. It should say Kim is not available, with no categories or numbers. Switch AI back on: Insights should list categories from your real feedback.
3. [ ] **You:** sign in as a Cashier and ask the assistant "what can I do?". It should list only the Cashier's permissions. As the Owner it should say you can do everything.
4. [ ] Deploy the website (`npm run website:deploy`) and release the app, so the wording and About-page fixes reach users.

## Customer website: designs per business type, more fonts and colour sets, new home sections (2026-11-28)

Five new designs made for one kind of business (Fresh market, Editorial, Care, Workshop, Bistro), 17 more fonts, 18 one-tap colour sets on Website > Brand, and new home sections in Website > Homepage: big-picture and three-picture openings, tall category cards, "one large, four small" products, customer cards and a one-at-a-time review slider. Sliding rows get a progress bar. Fixed: the contact band at the foot of every page made phones scroll sideways. Shops on the Original design look the same as before. Migration `20261216001_website_more_fonts_designs.sql`. Design test shop: `VITE_DEMO_SHOP=1 npm run website:dev`, then `http://localhost:5180/?demo=fashion` (any industry id; `&preset=workshop` for a design). Reasons: [DECISIONS-2026-11-28-website.md](DECISIONS-2026-11-28-website.md).

1. [ ] Apply the database change: `bash scripts/db-push.sh`, then `bash scripts/check-live-grants.sh`. It should say no problems.
2. [ ] Deploy the website: `npm run website:deploy`, and release the app (Brand and Design screens changed).
3. [ ] **You:** in the app, Website > Design: choose "Workshop" and Save to draft. The preview headings should turn tall capitals. Then choose the heading font "Abril Fatface"; it should be offered for headings but not for text.
4. [ ] **You:** Website > Brand > Colour sets: tap one. The four colour boxes should fill in, and the preview should change colour.
5. [ ] **You:** Website > Homepage: set Opening banner to "Words over a big picture", Customer reviews to "Customer cards", Publish, and open the shop on your phone. No part of the page should scroll sideways.

## Customer website: SEO fixes, instant first screen, compact list layout (2026-11-28)

Real 404s, canonical/trailing-slash fix, noindex on the fallback page, robots.txt only blocks /search, shop data embedded in each page so the first screen draws at once, bigger tap targets on phones, and a "Compact list" layout for product rows (Website > Homepage). Plan and reasons: [operations/website-seo-fix-plan.md](operations/website-seo-fix-plan.md). Code only; no database change. Tests: `npm test` (Website Worker test extended).

1. [ ] Deploy the website: `npm run website:deploy` (or let CI release it).
2. [ ] `curl -sI https://<a shop>.interlockingblockbuilders.co.ke/no-such-page`. It should say `404`. Then `/cart` should say `200`.
3. [ ] `curl -s https://<a shop>.interlockingblockbuilders.co.ke/robots.txt`. It should show `Disallow: /search` and no other Disallow.
4. [ ] `curl -s https://<a shop>.interlockingblockbuilders.co.ke/ | grep -c storefront-data`. It should print `1`.
5. [ ] **You:** open a shop on your phone with mobile data. The shop should appear without the loading picture first.
6. [ ] **You:** in the app, Website → Homepage → Products → choose "Compact list", Preview. Products should show as rows with picture, price and Add.
7. [ ] **You:** in Google Search Console for a shop, Pages → "Soft 404" should stop growing over the next weeks.

## Pay debt moves the Payments screen balance (2026-11-28)

Found by the M-Pesa reconciliation: Customers > Pay debt posted the books but never moved the Payments screen balance or made a payment row (every method). `process_debt_payment` now records through `process_business_payment`. Live had no affected rows (checked read-only 2026-11-28: Cash and M-Pesa agree with the books), so nothing needs correcting. Migration `20261215002_debt_payment_moves_money.sql`; test `supabase/tests/payments/debt_payment_money_test.sh` (20 pass). Staff with a custom role that has "customers.debts" but no payments permission can no longer record a debt payment.

1. [ ] Apply the database change with the Daraja one below: `bash scripts/db-push.sh`, then `bash scripts/check-live-grants.sh`. It should say no problems.
2. [ ] **You:** Customers → pick a customer who owes → Pay debt, KSh 1 by Cash. Payments should list the payment, and the Cash balance should go up by KSh 1.00.
3. [ ] In the SQL editor: `select m.business_id, m.method, m.balance, coalesce(sum(l.debit-l.credit),0) books from money_assets m join acc_accounts a on a.business_id=m.business_id and acc_key_method(a.system_key)=m.method left join acc_lines l on l.account_id=a.id group by 1,2,3;`. Each row's two numbers should be equal.

## Daraja audit: callbacks kept before processing, token cache, timeouts (2026-11-28)

Every STK and till callback is now stored (`daraja_callbacks`) before it is processed; failed or too-early ones are retried by `payment-sweep`. OAuth tokens are cached, every Daraja call has a timeout, the callback token survives a disconnect, and online orders get their real receipt after a status-query settle. Report: [operations/daraja-integration-report.md](operations/daraja-integration-report.md). Migration `20261215001_daraja_callback_inbox.sql`; tests `supabase/tests/payments/daraja_callback_inbox_test.sh` (43 pass) and `supabase/functions/customer-checkout/daraja_test.ts` (12 pass).

1. [ ] Apply the database change: `bash scripts/db-push.sh` (after 20261214002), then `bash scripts/check-live-grants.sh`. It should say no problems (`daraja_callbacks` and `mpesa_callback_tokens` are service-role only on purpose).
2. [ ] Deploy the functions, in this order, so no callback hits old code reading a missing table: `npx supabase functions deploy mpesa-webhook --no-verify-jwt`, `npx supabase functions deploy till-callback --no-verify-jwt`, `npx supabase functions deploy payment-sweep --no-verify-jwt`, `npx supabase functions deploy mpesa-payments`, `npx supabase functions deploy customer-checkout`, `npx supabase functions deploy ussd --no-verify-jwt`.
3. [ ] Run `select count(*) from mpesa_callback_tokens;` in the SQL editor. It should equal `select count(*) from mpesa_payment_secrets;`.
4. [ ] **You:** Payments & Expenses → M-Pesa → "Register till with Safaricom". The message should say Safaricom accepted it and "Our payment address answered".
5. [ ] **You:** on sandbox, "Send a test KSh 1 to the till". Within a minute the panel should say "Last till payment received from Safaricom just now", and `select kind, status, result from daraja_callbacks order by received_at desc limit 3;` should show `c2b_confirmation | processed | queued`.
6. [ ] **You:** send a KSh 1 prompt to your own phone from Payment Prompts and pay it. The panel should show "Last prompt result received", and `daraja_callbacks` a row `stk | processed | recorded`.
7. [ ] **You:** send another prompt and cancel it on the phone. The prompt should show Failed and `daraja_callbacks` should show `stk | processed | failed`.
8. [ ] Run `npx supabase functions logs payment-sweep` after 5 minutes. Lines should include `"callbacks"` and no `errors` above 0.
9. [ ] **You (production only):** with live keys, register the till once and pay KSh 1 from a phone straight to the till (no prompt). It should appear under Payments → Paid to the till. If registration is refused, check whether Safaricom wants the store number instead of the till number for your Buy Goods account (see report, "Outstanding").

## Payment messages: only when confirmed, only to the sale maker (2026-11-28)

An M-Pesa sale no longer says "Payment received" when it is saved. "M-Pesa payment received" comes only after the money is confirmed (STK prompt paid, till payment with the receipt number, or staff matching a till payment to the sale, which sent nothing before). Sale and debt money messages (payment received, credit sale, debt payment) go only to the person who made the sale or recorded the payment, never to the Owner or other staff. A prompt not tied to a sale goes only to whoever sent it. Payments nobody started (paid to a customer's account number, or waiting to be assigned) still go to the team. Migration `20261214002_mpesa_received_confirmed_sale_maker.sql`; test `supabase/tests/payments/payment_message_recipient_test.sh` (15 checks pass; the other 4 payment tests still pass).

1. [ ] Apply the database change first (the function below writes the new column): `bash scripts/db-push.sh` (or `npx supabase db push`), then `bash scripts/check-live-grants.sh`.
2. [ ] Deploy the function: `npx supabase functions deploy mpesa-payments`.
3. [ ] Release the app (web deploy and next app version).
4. [ ] **You:** on sandbox, make an M-Pesa sale with an STK prompt. No "payment received" message should show until you enter the PIN on the phone; after that, only the cashier who made the sale gets it (the Owner's phone gets nothing). Cancel a second prompt: no message at all.
5. [ ] **You:** make a Cash sale and a Credit sale as a cashier. The cashier gets the message; the Owner does not.

## Export data replaces Sheets backup; SMS and WhatsApp connections removed (2026-11-28)

Settings → Export data builds one Excel workbook (Summary, Charts, Daily sales, Sales, Product sales, Items sold, Expenses, Customer payments, Supplier payments, Products and stock, Customers, Profit and loss, Books) for a chosen period (30 days by default). It shows progress, and Retry carries on from the step that failed. The Google Sheets backup, the hourly backup job, and the Twilio SMS and WhatsApp Cloud connections are gone. Bulk messages go by email or WhatsApp by hand. Migration `20261214001_drop_sheets_sms_whatsapp.sql`.

1. [ ] Apply the database change: `bash scripts/db-push.sh` (or `npx supabase db push`), then `bash scripts/check-live-grants.sh`. `SELECT jobname FROM cron.job;` should no longer list `run-due-backups`.
2. [ ] Delete the old functions on live: `npx supabase functions delete backup-config`, `npx supabase functions delete sms-config`, `npx supabase functions delete whatsapp-config`. `npx supabase functions list` should no longer show them.
3. [ ] In the web app, open Settings → Export data, keep 30 days and press Export. The bar should fill and a `.xlsx` should download. In Excel, the Summary sheet's Profit (books) should match Finance → Profit and loss for the same dates.
4. [ ] **You:** run the same export on the Android phone and the Windows app. The file should save (Documents on Android) and open. Turn on airplane mode halfway through: an error should show, and Retry should finish once you are back online.

## Unclaimed Payments reconciliation (2026-11-28)

Till payments can be split over sales or partly claimed, flagged (under review, disputed, reversed), and every step is kept in an append-only history. Header indicator on every screen. Migration `20261213001_unclaimed_reconciliation.sql`; test `supabase/tests/payments/unclaimed_reconciliation_test.sh` (47 checks pass on the test DB).

1. [ ] Apply the database change: `bash scripts/db-push.sh` (or `npx supabase db push`), then `bash scripts/check-live-grants.sh`. It should list `mpesa_till_allocations` and `mpesa_till_payment_events` as SELECT for authenticated.
2. [x] (2026-11-28, v1.8.0) Release the app (web deploy and next app version). The Inbox icon should show in the top bar next to the bell for staff with M-Pesa or payment-checking rights.
3. [ ] **You:** on sandbox, pay the till without an account reference. Within seconds the Inbox count should go up by 1 on another open device without reloading.
4. [ ] **You:** open it, give part of it to an M-Pesa sale, then the rest to another. It should show "Partly claimed" after the first and disappear from the count after the second; History lists both with your name.
5. [ ] **You:** check the screen on a phone and a tablet: rows stack, no sideways scrolling, details open full screen.

## M-Pesa results no longer depend on Safaricom's callback (2026-11-26)

Found: prompt callbacks were arriving, but a paid prompt whose callback is lost was never recorded. Till payments stopped after 15:18 because the sandbox short code 600000 is shared by every Daraja developer, and the last one to register gets the callbacks.

1. [ ] Apply the database changes: `bash scripts/db-push.sh` (20261212007 first, then 20261212008: stand-in receipt swap and the `payment-sweep` cron job every 2 min), then `bash scripts/check-live-grants.sh`. It should say "no problems".
2. [ ] Deploy the functions: `npx supabase functions deploy payment-sweep --no-verify-jwt`, `npx supabase functions deploy mpesa-payments`, `npx supabase functions deploy mpesa-webhook --no-verify-jwt`, `npx supabase functions deploy till-callback --no-verify-jwt`.
3. [ ] Run `select jobname, schedule from cron.job where jobname = 'payment-sweep';` in the SQL editor. It should show `*/2 * * * *`. After 5 minutes, `select registered_at from mpesa_settings;` should show a time within the last 5 minutes (sandbox till renewed).
4. [ ] Run `C=supabase_db_isms-seedtest bash supabase/tests/payments/stk_query_settle_test.sh`. It should end `FAIL=0` (22 checks passed on 2026-11-26 against promo_test).
5. [ ] **You:** Payments & Expenses → M-Pesa → "Send a test KSh 1". KSh 1.00 from John Doe should show under Payments → "Paid to the till" within a minute.
6. [ ] **You:** send a KSh 1 prompt to your phone and pay it. "Paid" should show within seconds, or within 4 minutes at most if Safaricom's callback is lost (receipt shows as QRY-... until the callback arrives).
7. [ ] **You:** for real money paid from a phone straight to the till, connect the live (production) Daraja keys and your own till, then "Register till with Safaricom" once. Sandbox code 600000 can't receive real money.

## Mobile checkout bar in POS (2026-11-26)

1. Check the app builds: `npx vite build`, then `npm test`.
2. **You:** on a phone, open POS and add 2 products. A full-width amber bar above the menu should show the item count, payment method, total and "Checkout". The last row of products should stay visible above it.
3. **You:** tap Checkout. The sheet opens with large "Back" and "Complete sale · KSh ..." buttons. Finish an M-Pesa sale.

## M-Pesa prompts linked to the sale before sending (2026-11-26)

1. [ ] Apply the database change: `bash scripts/db-push.sh` (migration 20261212007: `check_sale_prompt`, prompts count toward a sale's M-Pesa proof, paid linked prompt makes no second payment), then `bash scripts/check-live-grants.sh`. It should say "no problems".
2. [ ] Run `C=supabase_db_isms-seedtest bash supabase/tests/payments/stk_sale_link_test.sh` and `.../till_sale_link_test.sh`. Both should end `FAIL=0` (19 and 22 checks passed on 2026-11-26 against promo_test).
3. [ ] Deploy the function: `npx supabase functions deploy mpesa-payments`.
4. [ ] Check the app builds: `npx vite build`, then `npm test` (the type check passed).
5. [ ] **You:** ring up a KSh 1 M-Pesa sale in POS. On the "Sale saved" card tap "Send M-Pesa prompt", enter your number, pay on the phone. The card should say "M-Pesa paid KSh 1.00 for this sale", and Payments should show no new walk-in payment. Do the same once in Quick Sale.

## Unassigned till payments no longer ring (2026-11-26)

1. Apply the database change: `bash scripts/db-push.sh`, then `bash scripts/check-live-grants.sh` (includes `20261212006_till_payment_no_ring.sql`). It should say no problems.
2. **You:** pay KSh 1 to the till with no prompt. The phone should not ring; the payment should show in Payments > Paid to the till and as a quiet notice in the bell.

## Till payments linked to the sale they paid (2026-11-26)

1. [ ] Apply the database change: `bash scripts/db-push.sh` (migration 20261212005: `sale_id` on till payments, `link_till_payment_to_sale`, `till_payment_sale_candidates`, receipt-number auto link in `record_till_payment`), then `bash scripts/check-live-grants.sh`. It should say "no problems".
2. [ ] Run `C=supabase_db_isms-seedtest bash supabase/tests/payments/till_sale_link_test.sh`. It should end `FAIL=0` (22 checks passed on 2026-11-26 against promo_test).
3. [ ] Check the app builds: `npx vite build`, then `npm test`.
4. [ ] **You:** ring up a KSh 1 M-Pesa sale, then pay KSh 1 to the till from a phone without a prompt. Under Payments → "Paid to the till", tap "Say what it was", choose that sale and confirm. It should move to "Marked as sale or ignored" showing "Sale TXN-...".
5. [ ] **You:** on a paybill, pay with the sale's receipt number (TXN-...) as the account. It should link itself, and staff get "M-Pesa payment received ... for sale TXN-...".

## Prompt results from Safaricom, new Payments tab (2026-11-26)

1. [ ] Check the app builds and tests pass: `npx vite build`, then `npm test` (the build/test run was cut off; the type check passed).
2. [ ] Apply the database change: `bash scripts/db-push.sh` (adds `assign_payment_to_customer`, migration 20261212004), then `bash scripts/check-live-grants.sh`. It should say "no problems".
3. [ ] Deploy the function: `npx supabase functions deploy mpesa-payments`.
4. [ ] On a test DB, open a walk-in payment, tap "Give to a customer" and pick a customer. The old payment shows Voided, a new one shows on the customer, the M-Pesa balance is unchanged and the books balance (debits = credits).
5. [ ] **You:** send a prompt and cancel it on the phone. After Safaricom answers, the screen should say "Cancelled by the customer". Send another one and pay it: the screen should show "Paid" with the name, amount and receipt.
6. [ ] **You:** open Payments on a phone. The list should scroll, with no broken text, and a till payment should show under "Paid to the till".

## M-Pesa prompt and till registration 502 fix (2026-11-26)

1. [ ] Deploy the three functions that share the Daraja client: `npx supabase functions deploy mpesa-payments`, `npx supabase functions deploy customer-checkout`, `npx supabase functions deploy ussd --no-verify-jwt`.
2. [ ] Check: Payments & Expenses → M-Pesa → "Register till with Safaricom" says registered (Safaricom was already accepting it; the app misread its "00000000" success code).
3. [ ] Check: send a KSh 1 prompt to a phone. On sandbox it goes out as a paybill to 174379 (sandbox refuses Buy Goods with "Invalid TransactionType"). A refused prompt now shows Safaricom's reason.

## Payment methods in Settings, Daraja till fields (2026-11-26)

1. [ ] Release the app (commit, push, tag the next version). No database or function change.
2. [ ] Check: Settings → Shop → Payment methods switches methods on and off; Payments & Expenses no longer has a Methods tab.
3. [ ] **You:** Payments & Expenses → M-Pesa → Account type "Till (Buy Goods)". Enter Business Short Code (Store Number), PartyB (Till Number), Consumer Key, Consumer Secret, Passkey from developer.safaricom.co.ke. "M-Pesa connected" should show, then "Register till with Safaricom".
4. [ ] After release, open Marketing → a campaign, an advert, Placements and Studio: every choice box should be the app dropdown with a search box (the 16 raw `<select>` boxes are replaced).

## Console dropdowns, one confirm popup, module prices (2026-11-26)

1. [ ] Apply the database change: `bash scripts/db-push.sh` (or `npx supabase db push`), then `bash scripts/check-live-grants.sh`. Needs 20261212002 live first.
2. [ ] Check: in the console, Plans → Add-ons, clear one module's price. In a company's Business screen → Add modules, that module says "Price not set yet" and has no Request button.
3. [ ] Check: console → Module requests, the payment picker is the app's searchable dropdown; Approve is greyed while the module has no price.
4. [ ] Check: open a company with an approved, paid module, untick it under Add-ons or Extra modules: the app's popup asks "Switch off ...?" with Keep it on / Switch off. Every console save button now opens that same popup.

## Website Google sign-in, automatic prompt, scrolling pills (2026-11-26)

1. [ ] **You:** create the Google OAuth Web client (origins = every website address; redirect = `https://<project-ref>.supabase.co/auth/v1/callback`) and turn Google on in Supabase with its ID and secret. Click-by-click: [operations/google-sign-in.md](operations/google-sign-in.md).
2. [ ] **You:** add the GitHub Actions variable `VITE_GOOGLE_CLIENT_ID` = that Client ID.
3. [ ] Deploy the website: push to main (Deploy web workflow). The new security headers allow `accounts.google.com/gsi`.
4. [ ] Check: private window signed in to Google, open the website: "Continue as <name>" appears top-right; tap it, you are signed in and asked for name/phone once. Switch branch, sign in with the Google button: Account shows that branch.
5. [ ] Check on a phone: button and pill rows (home buttons, categories, review filters, ideas filters) stay on one line and swipe sideways.

## Console About and updates (2026-11-26)

1. [ ] Ship it with the next release (push a version tag so CI builds the apps; web deploys on push to main).
2. [ ] Check: Console → Setup → About this app shows the version and "Check for updates"; on the desktop/Android app it finds and installs a newer release; on the web it says to reload.

## Console UI rework (2026-11-26)

1. [ ] Apply the storage figure: `bash scripts/db-push.sh` (or `npx supabase db push`), then `bash scripts/check-live-grants.sh`. Open Console → Companies → a company → Overview: "Storage: X used / Y available" should show with a bar.
2. [ ] Check in the browser: company opens as a full screen with tabs; Change plan, Save limits, Save add-ons, plan/price saves and Settings save each ask to confirm; Void is a red button; Activity has search and colour filters; Plans show 3 across on wide screens with Perpetual full width below.
3. [ ] Apply `20261212002_module_requests_support_messages.sql` (same push as step 1), then `bash scripts/check-live-grants.sh` and `bash supabase/tests/permissions/permissions_test.sh`.
4. [ ] As an Owner: Business and branches → "Plan, storage and support" → Add modules → Request. In Console → Module requests it should show; Approve stays off until a recorded payment is picked; after Approve the module appears under the company's Limits & modules.
5. [ ] As an Owner send a message on the Messages tab; Console → Messages shows it with a red dot; reply, and the reply shows in the business in blue.

---

## M-Pesa keys obey read-only plans (2026-11-26)

1. [ ] Apply the database change: `bash scripts/db-push.sh` (adds `20261211004_mpesa_secrets_plan_read_only.sql`, after 20261211001), then `bash scripts/check-live-grants.sh`. It should list no "no read-only plan check" line.

## Storage limit covers all files (2026-11-26)

1. Apply the database change: `bash scripts/db-push.sh` (includes `20261211003_storage_quota_all_buckets.sql`), then `bash scripts/check-live-grants.sh`.
2. In the console, give a test company a 1 MB storage limit, then upload a product picture twice. The second upload should fail; set the limit back afterwards.

## Plan gates in the database + M-Pesa per branch (2026-11-26)

1. Apply the database change: `bash scripts/db-push.sh`, then `bash scripts/check-live-grants.sh` (adds 20261211002).
2. On a Starter company, open Stock Report: it should say "The stock report is not on your plan." Marketing screens should refuse saves.
3. **You:** in each branch, open Business Management > M-Pesa and connect that branch's own keys and till. Switching branch should show that branch's settings.

## M-Pesa per business: each shop connects its own Daraja keys (2026-11-26)

Migration `20261211001_mpesa_per_business.sql` (table `mpesa_payment_secrets`, `record_till_payment(p_raw, p_business_id)` without the single-till fallback). Edge functions `mpesa-payments`, `mpesa-webhook`, `till-callback`, `customer-checkout`, `ussd` now use the business's own keys and callback token. The server secrets `MPESA_CONSUMER_KEY`, `MPESA_CONSUMER_SECRET`, `MPESA_SHORTCODE`, `MPESA_PASSKEY`, `MPESA_CALLBACK_TOKEN`, `MPESA_PARTY_B`, `MPESA_TRANSACTION_TYPE` are no longer read.

1. [ ] Apply the database change: `bash scripts/db-push.sh`, then `bash scripts/check-live-grants.sh`. `SELECT count(*) FROM public.mpesa_payment_secrets;` should run (0 rows).
2. [ ] Deploy the functions together, right after step 1: `npx supabase functions deploy mpesa-payments mpesa-webhook till-callback customer-checkout ussd --no-verify-jwt`.
3. [ ] **You:** on developer.safaricom.co.ke, create a sandbox app. In the app, open Payments -> M-Pesa -> Connect M-Pesa, choose Sandbox, and enter the sandbox short code `174379`, the passkey and the consumer key and secret. It should say "M-Pesa connected". Wrong keys should say "Safaricom refused these keys".
4. [ ] Press "Register till with Safaricom". It should say "Till Registered". Then send a prompt to a test phone. The prompt should appear and show as Paid once accepted.
5. [ ] **You:** for each real shop, the owner does Go Live on Daraja for their own till and enters the production keys under Production. A payment made straight to that till should show under that shop only, never another.
6. [ ] Optional clean-up: `npx supabase secrets unset MPESA_CONSUMER_KEY MPESA_CONSUMER_SECRET MPESA_SHORTCODE MPESA_PASSKEY MPESA_CALLBACK_TOKEN MPESA_PARTY_B MPESA_TRANSACTION_TYPE MPESA_ENV MPESA_C2B_SHORTCODE` (only the ones that exist).

## First sign-up becomes platform admin, console edges 2px (2026-11-26)

1. Apply the database change: `bash scripts/db-push.sh` (or `npx supabase db push`), then `bash scripts/check-live-grants.sh`.
2. Run `SELECT public.platform_admin_claimable();` in the SQL editor while signed in as a normal user. It should be false on live (an admin already exists).
3. On a fresh test DB, sign up and verify an email. A "Become the platform admin?" box should appear; "Make me admin" opens the console. A second sign-up should never see the box.
4. Open the console on a phone and desktop. Content should sit 2px from the screen edges.

## Domain interlockingblockbuilders.co.ke, look-alike names blocked, app per business (2026-11-25)

Shops at `<name>.interlockingblockbuilders.co.ke`, the app at `<name>-app.interlockingblockbuilders.co.ke` (opens only that business; one level deep, so the free certificate covers it). Migration `20261209002_platform_domain_unique_names.sql` (website names may not end in `-app`), routes in `wrangler.jsonc` and `website/wrangler.jsonc` (the website Worker forwards `*-app` to the app Worker through the `APP` binding), app lock in `src/utils/tenantHost.ts`, `scripts/deploy-web.sh` now applies routes (`wrangler triggers deploy`).

1. [x] **You:** in Cloudflare DNS for the domain, make sure the wildcard record `*` (CNAME, any target) is **Proxied** (orange cloud). Do not add records for `app`, `www` or the bare domain: the deploy creates them. SSL/TLS -> Edge Certificates should list the free Universal certificate as Active. Done 2026-11-25 (wildcard is proxied: `demo-app.` loads the app).
2. [ ] Check no two existing businesses already clash: `SELECT public.fn_business_name_key(name) k, array_agg(name) FROM public.tenants GROUP BY 1 HAVING count(*) > 1;` (rename any it lists), and none has a website name ending in `-app`: `SELECT name, website_slug FROM public.businesses WHERE website_slug LIKE '%-app';`.
3. [ ] Apply the database change: `bash scripts/db-push.sh`, then `bash scripts/check-live-grants.sh`. `SELECT platform_domain, app_url FROM platform_settings;` should show the new domain.
4. [x] **You:** the CI deploy (v1.5.2, 2026-11-25) went live but could not add the addresses ("Routes: No access to the specified resource"). In Cloudflare -> My Profile -> API Tokens, edit the token saved as GitHub secret `CLOUDFLARE_API_TOKEN`. Add **Zone -> Workers Routes -> Edit** and **Zone -> DNS -> Edit** for `interlockingblockbuilders.co.ke`. (Checked 2026-11-25: the domain is on the same account as the Workers; `app.` and the bare domain already work as custom domains; only the two wildcard routes `*-app.` and `*.` are missing, so `demo-app.interlockingblockbuilders.co.ke` gives 522.) Then re-run the "Release and Deploy" run's two "Deploy web" jobs (GitHub -> Actions -> Re-run failed jobs, or push). They should finish with no "could not be applied" warning. Done 2026-11-25: new token saved, `CLOUDFLARE_ACCOUNT_ID` restored after it was overwritten, both routes added.
5. [x] Deploy the app first, then the website (the website binds to the app Worker): `bash scripts/deploy-web.sh app`, then `bash scripts/deploy-web.sh website`. Both should end with "Live" and no "could not be applied" warning. `https://app.interlockingblockbuilders.co.ke` shows the sign-in screen. Done 2026-11-25 by CI v1.5.3 (also fixed `app.` being caught by the shops' wildcard route, 17ababd).
6. [ ] **You:** Supabase -> Authentication -> URL Configuration: Site URL `https://app.interlockingblockbuilders.co.ke`, and add the redirect URL `https://*.interlockingblockbuilders.co.ke/**`. Email links (sign-up, reset) should then open on the new address.
7. [ ] Test isolation: give two businesses the website names `testa` and `testb`. Signed in as testa's owner, `https://testb-app.interlockingblockbuilders.co.ke` should show the no-business screen and `https://testa-app...` testa's data; `https://testa.interlockingblockbuilders.co.ke` should show testa's shop only. Website name `foo-app` and business "TestA Ltd" should be refused.
8. [ ] Run `bash supabase/tests/permissions/permissions_test.sh` and `bash supabase/tests/website/tenants_test.sh`; both should pass.

---

## Nobody could add a customer, the Owner too (2026-11-25)

1. [ ] Apply the database change: `bash scripts/db-push.sh` (or `npx supabase db push`), then `bash scripts/check-live-grants.sh`.
2. [ ] Signed in as the Owner, open Customers and add one with a phone number. It should save with the phone as `+254...` and an account number.

---

## Website engine phase 8: five-business test and final report (2026-11-25)

Report: [roadmap/website-engine-audit.md](roadmap/website-engine-audit.md), section 9. Run the phase 2 to 7 steps below first.

1. [ ] Rerun the tests on a fresh local build: `C=supabase_db_isms-seedtest bash supabase/tests/promotions/rebuild.sh`, then each of `brand_test.sh`, `drafts_test.sh`, `visits_test.sh` and `tenants_test.sh` in `supabase/tests/website/`. Each should end with 0 failed.
2. [ ] **You:** run `npm run dev` and open Website in the app. Change the brand, the homepage and the menu, use Preview, then Publish and put the earlier version back from History. Each screen should save, and the website should change only after Publish.
3. [ ] **You:** decide when to commit. Nothing from phases 1 to 8 is committed yet.

---

## Marketing and advertising: campaigns, creatives, placements, Canva, statistics (2026-11-25)

Plan and report: [MARKETING_AND_ADVERTISING.md](MARKETING_AND_ADVERTISING.md). New Marketing area (Overview, Campaigns, Creative studio, Placements, Performance): scheduled campaigns in the shop's time zone with several creatives each, eight website placements with their own layouts, a media library for pictures and videos (`website-media` bucket), real statistics (loaded, seen, clicked, orders after a click), preview at three screen sizes and on the real website, Canva by hand today and connected once registered. Migration `20261207001_marketing_campaigns.sql` (after the website engine's `20261206002`), edge function `canva-connect`. `supabase/tests/marketing/marketing_test.sh` 122 passed, app tests 110 passed, website builds; checked in headless Chrome against the test database; not clicked through in the app.

1. [ ] Apply the database change (after the website engine migrations above): `bash scripts/db-push.sh`, then `bash scripts/check-live-grants.sh` (no problems listed). In the SQL editor, `select id, public, file_size_limit from storage.buckets where id = 'website-media';` should return one public row with 52428800, and `select jobname from cron.job where jobname = 'marketing-jobs';` one row.
2. [ ] Deploy the website: `npm run website:deploy`. View source on any shop: the Content-Security-Policy header should include `media-src 'self' data: blob: https:`. Nothing else changes until a campaign is published.
3. [ ] Release the app (`bash release.sh`). As an owner, Marketing should appear under Customers. Create a campaign starting in 5 minutes with a home banner (upload a 1920 x 1080 picture) and an announcement bar, press Schedule: the status shows Scheduled, and after the start time (within a minute) the banner and bar appear on the website; Overview shows Loaded and Seen after you open the website.
4. [ ] On that campaign, press **Open on my website** for a draft copy: the website opens with a "Campaign preview" bar and shows it; Leave preview returns to the live website. Then End the campaign: it disappears from the website within a minute.
5. [ ] Deploy the Canva function (it only answers "not set up" until step 6): `npx supabase functions deploy canva-connect --no-verify-jwt`. Creative studio should show "Design in Canva" with sizes and an upload button.
6. [ ] **You:** at canva.com/developers create a **public** integration (a private one needs a Canva Enterprise team). Scopes: design:content:read, design:content:write, design:meta:read, profile:read. Redirect URL: `https://<project-ref>.supabase.co/functions/v1/canva-connect`. Then set the secrets: `npx supabase secrets set CANVA_CLIENT_ID=... CANVA_CLIENT_SECRET=... CANVA_REDIRECT_URI=https://<project-ref>.supabase.co/functions/v1/canva-connect CANVA_TOKEN_KEY=$(openssl rand -base64 32)`, optionally `CANVA_DONE_URL=<your app address>`. In Creative studio press Connect Canva, allow access, press "I have connected": it should say "Connected as <your Canva name>". Make a design with New design in Canva, then Show my designs, Import: it should appear in the library from Canva.
7. [ ] **You:** submit the Canva integration for review (canva.com/developers, Submit). Until Canva approves it, only your own Canva account can connect; other shops use the by-hand Canva steps.
8. [ ] **You:** decide whether the website's privacy page should mention the anonymous advert counting (no cookies, nothing personal, Do Not Track respected). Wording to add, if you want it: "We count how often our adverts are shown and pressed, per visit, without cookies or personal details."
9. [ ] Website engine (whoever continues it): add `promo` to the reserved page paths in `fn_valid_pages`, and add `trg_zz_plan_read_only` to `website_drafts`, `website_versions`, `website_published` and `website_preview_links` if a fresh build still lists them in `grants_check.sql`.

## Website engine phase 7: private visit counter, own-address recheck, cache review (2026-11-25)

The website now counts visits without cookies. For each page opened it sends only the shop's web name, the kind of page (home, product, cart...) and, for the first page of a visit, the kind of place the visitor came from (typed in, search, social media, another website). The database keeps daily totals per shop (`website_visit_daily`): no IP, no visitor id, no full address, no device. Robots, link previews, preview links and `localhost` are not counted; one IP may count 300 pages per 10 minutes. Unique visitors are not counted (that needs an identifier). Website > Statistics shows visits, pages opened, orders per 100 visits, where visits came from and the most-opened pages; Overview shows visits for 30 days. Days are the shop's own days, the same for orders and visits. Own web addresses are checked every night at 03:20: one that stopped working goes back to waiting, so the shop's subdomain stops sending visitors to a dead address. Cache review: every Worker cache key carries the shop's web name or the address (now a tested helper), drafts are never cached, and a remembered branch is used only if it belongs to the address's own shop. Migration `20261208001_website_visits_domain_recheck.sql`; `supabase/tests/website/visits_test.sh` (27) and app tests (112) pass on a local database.

1. [ ] After phases 4 and 5 step 1, apply this change: `bash scripts/db-push.sh`, then `bash scripts/check-live-grants.sh` (no problems listed for `record_website_view` or `website_visit_daily`). `select jobname from cron.job where jobname = 'website-domain-recheck';` should return one row.
2. [ ] Deploy the address function: `npx supabase functions deploy website-domain`. Then in the SQL editor `select public.website_domains_recheck();`; after a few seconds, Edge Functions > website-domain > Logs should show one call answered 200 (with no own addresses yet it does nothing).
3. [ ] Deploy the website (`npm run website:deploy`, phases 4 and 5 step 2). Open a shop's website from a phone, then open two more pages. Website > Statistics should show 1 visit and 3 pages opened (Typed in or saved link).
4. [ ] Open the same shop from a Google search result: Where visits came from should add one under "Search engines".

## Website engine phase 6: quality checks and readiness score (2026-11-25)

No database change. Ships with the app release in phases 4 and 5, step 3. Website > Overview now shows a readiness score (0 to 100) and every check: **must fix** (a link to a page the website does not have, leftover placeholder text such as "lorem ipsum" or "TODO", no phone, email or WhatsApp), **should fix** (no web address, no products, most products without a picture, no logo, no short description, a colour that had to be adjusted, a search title longer than 60 letters) and **would help** (tagline, story, opening hours, sharing picture, social links). Publish stays off while a must-fix problem is open. The app enforces this, not the database: the problems are about quality, not safety, and every value is still checked by the database on save. Rules in `website/src/engine/checks.ts`; two app tests cover five fictional shops and check the link rule against the website's routes.

1. [ ] After phases 4 and 5 step 3, open **Website**: Overview shows the score and the list. On a test shop, Menu > add a link to `/abuot` > **Save to draft**. Publish should stay greyed out, with a red line naming the menu link; Overview lists "Links go to real pages" first. Remove the link and save: Publish works again.

## Website engine phases 4 and 5: Website workspace, draft, preview, publish, put back (2026-11-25)

The app has a new **Website** screen (needs "change the business"), with Overview, Brand, Design, Home page, Pages, Content (banner, adverts, guides), Menu, Search engines, Address & publishing, and Statistics. **Online Store** is now **Online orders** (orders, messages, feedback, reviews, product ideas, delivery and products on the website). Every website change goes into a draft; **Publish** puts it live and keeps a numbered version; **Put back** makes any older version live again; **Preview** opens the draft on the shop's own address for two hours. The first publish also keeps how the website looked before. Delivery fee, minimum order, the assistant switch, products and the web address still change straight away. Old app versions can no longer change the banner, adverts or pages (they get "no permission"), so install the new app before staff edit the website. Migration `20261206002_website_drafts_publish.sql`; app tests (95), `supabase/tests/website/drafts_test.sh` (73), `brand_test.sh` (33) and the permissions test pass on a local database, except grant problems from the marketing migration `20261207001` (another piece of work). Website pages for six fictional shops were checked in headless Chrome (`node scripts/website-shots.mjs`); the app's Website screens were not opened in a browser.

1. [ ] Do phase 2 step 1 first (`20261206001`), then apply this change: `bash scripts/db-push.sh`, then `bash scripts/check-live-grants.sh` (no problems listed for website tables or `get_preview_storefront`).
2. [ ] Deploy the website: `npm run website:deploy`. A shop's home page and menu should look as before.
3. [ ] Release the app (`git push`) and install it. Open **Website**: the top bar should say "Live. Nothing published from here yet."
4. [ ] On a test shop: Brand > change the tagline > **Save to draft**. The top bar turns amber ("Changes not published yet"); the live website is unchanged. **Preview** should open the website with a dark "Preview of unpublished changes" bar and the new tagline.
5. [ ] **Publish** with a note. After about 5 minutes the live website shows the new tagline. Address & publishing > History lists version 1 (before the first publish) and version 2.
6. [ ] **Put back** version 1: after about 5 minutes the old tagline is back, and History shows version 3 "Put back version 1".
7. [ ] **You:** tell staff who edit the website that changes now wait for **Publish**, and that the banner, adverts and pages moved from Online Store to Website.

## Website engine phase 3: home page layouts per kind of business (2026-11-25)

No database change. Ships with the website deploy in phase 2, step 2.

1. After `npm run website:deploy`, open a shop on the original look: the home page should be unchanged except the built-in banner and advert words now fit its industry (no "Fresh every morning" on a non-food shop).
2. In the SQL editor, `select website_brand_save('<test business id>', '{"design_preset":null,"industry":"professional_services","tagline":"Clear advice"}');`. After about 5 minutes the home page should open on a dark banner with "Clear advice", then About us, Our services, reviews, Our office and "Talk to us". Set it back with `'{"design_preset":"original","industry":"<its old industry>"}'`.

## Website engine phase 2: brand profile and design tokens (2026-11-25)

Plan and audit: [roadmap/website-engine-audit.md](roadmap/website-engine-audit.md). Each shop now has a brand profile (`website_brand`: industry, personality, tone, story, mission, audience, fonts from an allow-list, corners, buttons, spacing, picture style, logo variants, favicon, social links, opening hours), saved through `website_brand_save` together with the brand facts already on `businesses` (description, logo, main and second colour), so there is one record per fact. `website/src/engine/` turns a brand into design tokens (colours checked to WCAG AA, fonts, corners, buttons, spacing, picture fit and shape) that the Worker writes into every page head, so pages open in the shop's colours and fonts with no flash. Industry and personality pick one of eight design presets; existing shops are set to "original" and look as before, except the old amber text is a shade deeper (it was 4.4:1, under the 4.5:1 minimum). Structured data now uses the industry's schema.org type, social links, opening hours and tagline. There is no screen to edit the brand yet (phase 4). Migration `20261206001_website_brand.sql`; app tests, `supabase/tests/website/brand_test.sh` (33), `saas/website_test.sh` (53) and permissions (37) pass on a local database.

1. [ ] Apply the database change: `bash scripts/db-push.sh`, then `bash scripts/check-live-grants.sh` (no problems listed). `select count(*) from website_brand;` should equal the number of businesses.
2. [ ] Deploy the website: `npm run website:deploy`. Open any shop: it should look as before, and View source should show `<style id="brand-tokens">` in the head.
3. [ ] Test a change in the SQL editor on one test shop: `select website_brand_save('<business id>', '{"design_preset":"premium"}');`, wait 5 minutes (edge cache) and reload: serif headings and square outline buttons. Set it back with `'{"design_preset":"original"}'`.

---

## Debian package, console Home and Money, AI switches, delete checks (2026-11-25)

Linux: the .deb installed its program as `/usr/bin/app` with an `app.png` icon (names that clash with other packages) and had no description, licence or release notes, so Software showed nothing and warned "proprietary, may change without oversight". It now installs `/usr/bin/denso` with an AppStream file (`src-tauri/linux/com.isms.app.metainfo.xml`: summary, description, licence link, homepage, this release's notes) and the licence under `/usr/share/doc/denso/copyright`; the release fails if the .deb lacks them. The Windows .exe is now `denso.exe`. Platform console: new Home (money by month, where it comes from, growth, break-even against **Our running costs**, resources in use, busiest companies, activity), new **Money** (record payments; the paid-up date is worked out from the amount and the plan's or agreed price, never typed; payments can only be voided with a reason; approving a paid request needs its payment first; "Free" has no end date), suspend needs a reason, a bottom bar on phones. Stat tiles everywhere use Home's plain figure style. Businesses no longer set an AI provider, key or model: Settings > AI is on/off per use (assistant, insights, website, messages) plus instructions; own-key companies get their key set by the platform admin. Deleting a customer, product, supplier or expense, removing a worker, or closing a branch shows what it affects first, and the database refuses it while money is owed, wallet money or stock remains, orders or deliveries are open, someone is clocked in, or it would remove the owner or the last branch. A branch used to be hard-deleted, which wiped its sales, books and stock records; it is now closed (hidden, records kept) and nobody signed in can hard-delete one. Migrations `20261205001_platform_home_billing_ai.sql` and `20261205002_delete_impact.sql`; all 18 database suites pass; the console was checked in a browser with sample data, not with live data.

1. [ ] Apply the database changes: `bash scripts/db-push.sh`, then `bash scripts/check-live-grants.sh` (no problems listed). Existing companies keep their paid-up dates; new payments carry on from them.
2. [ ] Deploy the AI functions: `npx supabase functions deploy ai-config chat complaints customer-assistant bi-analyze area-advisor`. Settings > AI should show only switches and instructions; switching "Shop assistant on your website" off should make the website chat answer without the AI.
3. [ ] **You:** in the console, open **Our running costs** and replace the estimates with your real bills (Supabase, email, domain, your time). Home's break-even uses them.
4. [ ] **You:** check each paying company in Companies: how it pays and any agreed price. Paid-up dates typed before this change are kept (a "by hand" company with a date becomes Monthly; one with no date becomes Free). From now on record each payment under Money; its days start after the kept date.
5. [ ] Release the app (`git push`). Install the new .deb on Debian with `sudo apt install ./Denso-<version>-linux-amd64.deb`: it should install, and Software should show the description, licence link and "What's new". The menu entry should start Denso.
6. [ ] On a phone: the console shows the bottom bar (Home, Requests, Companies, Money, More); swiping a customer with debt and tapping Delete shows "Do this first" with Delete off; removing a worker who is clocked in, or closing a branch that still has stock, shows the same.
7. [ ] **You:** decide whether to buy a Windows code-signing certificate (SmartScreen says "unknown publisher" until the installer is signed) and whether to host an apt repository so Debian updates through Software (needs a signing key). Both are listed under Other devices below.

Other devices (checked 2026-11-25): Windows shows SmartScreen "Windows protected your PC" because the installer is not code-signed; Android warns "install unknown apps" for any APK outside the Play Store; Linux Software always labels paid software "Proprietary". These are expected for direct downloads; only the certificate, the Play Store or an apt repository remove them.

---

## Sign-up screens fit phones, Back works, no code for a taken email (2026-11-24)

Sign-in/Start/plan screens, the Platform console and the supplier portal scroll and stay below the status bar (they used `env()`, 0 on many Android phones, and centred tall forms off the top). Create account has "Already have an account? Sign in"; the Sign in / Create account / Join team bar always shows. Phone Back closes the console and steps back through sign-in, plans and the Start screen. Create account with an email that already has an account now says so (Supabase hid it as a stand-in user) and the old "business already has an owner" block is gone; `auth-otp` sends no sign-up code to an email already verified. Emails show the app mark drawn in HTML instead of the old KayKays logo picture. App tests pass; not tried on a phone.

1. [ ] Deploy the functions: `npx supabase functions deploy auth-otp send-email` (`config.toml` keeps auth-otp open to signed-out visitors). Create account with an email that already has an account: the form should say "This email already has an account" and no code email should arrive.
2. [ ] Create account with a new email. The code email should show an amber square with a dark "D" at the top (drawn in HTML, no picture, so it shows even with images off), not the old KayKays picture.
3. [ ] Release the app (`git push`). On an Android phone: the Start screen and plan list scroll to the top with the logo below the status bar; the Platform console header sits below the status bar; phone Back on the console returns to the app, and on Create account returns to Sign in.

---

## Retention and erasing a customer (2026-11-24)

Owner: keep records as Kenyan law demands. Money records and the audit trail 7 years (Tax Procedures Act 5, Companies Act 7); a nightly job removes notifications after 1 year, website chat after 2, crash reports after 90 days, backup run log after 1 year, audit entries after 7. Customers > profile > **Erase personal details** (`customers.erase`, Data Protection Act s.40), refused while debt or wallet money remains. Website privacy page names EU hosting, Cloudflare, the periods and erasure. Migration `20261203002_retention_and_erasure.sql`; `records/retention_erasure_test.sh` 23 passed; not clicked through in the app.

1. [ ] Apply the database change (with `20261203001` above): `bash scripts/db-push.sh`, then `bash scripts/check-live-grants.sh` (no problems listed).
2. [ ] In the SQL editor: `select jobname, schedule from cron.job where jobname = 'data-retention';` should return one row `30 0 * * *`, and `select public.run_data_retention();` should return counts, not an error.
3. [ ] Deploy the website: `npm run website:deploy`. The privacy page should say "at least seven years" and name Cloudflare.
4. [ ] Release the app (`git push`). As an owner, a customer with no debt and an empty wallet should show **Erase personal details** at the bottom of their profile; erasing a test customer should remove them from Customers while their sales stay in the Sales Log.
5. [ ] **You:** ask a data protection adviser whether the business must register with the ODPC (EXP-06). Registration is your step; the app cannot do it.

---

## Records kept, one receipt number, points in one place, owner named (2026-11-24)

Gaps G-01 to G-08 from `documentation/audit/04-outstanding-gaps-and-clarifications.md`. The audit trail is append-only; sales, stock history and points used can't be deleted (Settings > Old records clears only points earned, backup runs and crash reports); receipts show `TXN-…` everywhere; points settings only on Promotions & Points; Report a problem needs `support.report`; README, LICENSE, TERMS and the three documents name Dennis Kimanthi Gitonga, Codensons. Migration `20261203001_keep_records.sql`. All 9 database suites (incl. the new `records/keep_records_test.sh`) and the app tests pass; not clicked through in the app.

1. [ ] Apply the database change: `bash scripts/db-push.sh`, then `bash scripts/check-live-grants.sh` (no problems listed).
2. [ ] Check it on live in the SQL editor: `select count(*) from pg_trigger where tgname = 'trg_audit_logs_append_only';` should return 1, and `select count(*) from pg_policies where policyname = 'pol_transactions_delete';` should return 0.
3. [ ] Deploy the function: `npx supabase functions deploy ops-alert --no-verify-jwt`. About this app > Report a problem should still send for an owner (a Telegram message arrives).
4. [ ] Commit and release the app (`bash release.sh`). Settings > Old records should list only three logs, and a printed receipt should show `TXN-…`.
5. [x] **You:** decide how long sales are kept. (2026-11-24: owner decided sales are kept for at least 5 years, the Kenyan tax record period. Nothing is removed today, so nothing to deploy.)
6. [ ] **You:** review the three documents (each folder in `documentation/final/` has .md, .docx and .pdf), then set `status: Approved` in each front matter and rebuild: `python3 documentation/tools/build_docs.py all`.

---

## Documentation set restructured; UI fixes and wording (2026-11-24)

Three new documents in `documentation/` (User Guide ISMS-UG, Technical Documentation ISMS-TD, Administration Guide ISMS-AG), with Markdown, DOCX and PDF, re-captured screenshots, and the audit, migration map, QA report and gaps list in `documentation/audit/`. The app also has the form, receipt-settings, screen-name, wording and "ask the admin" fixes of 24 November (uncommitted).

1. [x] **You:** answer the owner decisions G-01 to G-08 (2026-11-24; G-03 approval still open; sales retention decided: at least 5 years, see the item above).
2. [ ] **You:** document owner named (2026-11-24: Dennis Kimanthi Gitonga, Codensons); still to do: set `status: Approved` and `author:` in each document's front matter and rebuild: `python3 documentation/tools/build_docs.py all`. The cover should show the owner and "Approved".
3. [ ] Deploy the three edge functions whose wording changed: `npx supabase functions deploy chat --no-verify-jwt`, then the same for `bi-analyze` and `area-advisor`. The assistant should say "ask the admin", not "ask the owner".
4. [ ] Commit the app changes and the documentation, then release (`git push`). About this app should show the new version, and the sidebar should show **Customers**, **Roles** and **Workers**.
5. [ ] Optional: a migration changing the two database messages "Ask the owner." (in `20261120001_schema.sql`) to "Ask the admin.", pushed with `bash scripts/db-push.sh`.
6. [ ] Check that every live migration text equals its file: `bash scripts/db-push.sh --check` (no `DIFFERS`), then tick the older steps above that are already live.

---

## Navigation, global search, references, deliveries (2026-11-23)

Regrouped menus, one search across sales/payments/expenses/stock/books/audit/deliveries with exact landing and highlight, EXP/STM/LOG/LDG references, copyable references, product-first deliveries. Migration `20261202001_record_refs_global_search.sql`. Details: [ISMS-TD Ch 11.13](../documentation/final/ISMS-Technical-Documentation/ISMS-TD.md). DB suite, 75 app tests and both builds pass; not clicked through in the app.

1. [ ] Apply the database change: `bash scripts/db-push.sh`, then `bash scripts/check-live-grants.sh` (no problems listed).
2. [ ] Check it on live in the SQL editor: `select ref_no from expenses order by created_at desc limit 3;` should show `EXP-2026-…`, and `select jsonb_array_length(global_search('<your business id>', 'TXN'));` should return a number, not an error.
3. [ ] Commit and release the app (`bash release.sh`).
4. [ ] **You:** in the app, search a receipt number, an `EXP-` number and a `JE-` number. Each should open its screen with that row glowing amber (the journal one opens the entry).
5. [ ] **You:** tap a reference chip (e.g. a receipt number in the Sales Log). It should show "Copied", and pasting it elsewhere gives the full number. The row itself should not open.
6. [ ] **You:** as a rider on a phone, open a delivery under Mine. Products should be listed first with quantities. Tick some, press "Mark delivered": it should ask "… items not checked" once.
7. [ ] **You:** look over the new menu groups (sidebar and the phone's More sheet) and say if anything should sit elsewhere.

---

## UI wording cleanup + update bar removed (2026-11-23)

Text-only changes across the app and website, and the top update bar removed (updates show only in About this app). Details: [ISMS-TD Ch 22.5](../documentation/final/ISMS-Technical-Documentation/ISMS-TD.md). Type checks, 73 tests and both builds pass.

1. [ ] Commit and release the app (`bash release.sh`, as usual). The new version should appear in About this app → Updates on an installed copy.
2. [ ] **You:** on the desktop app, when an update has downloaded, open About this app and press "Restart and install". The app should reopen on the new version. No bar should appear at the top while it downloads.
3. [ ] **You:** walk the tour once (My Profile → Take the tour again) on a phone and check no step is cut off.
4. [ ] **You:** decide whether to remove the "Switch offline mode" entry from search (see Outstanding in the audit doc).

---

## Quick test data: seed_quick.sql (2026-11-23)

`supabase/seed_quick.sql`: 2 branches, owner + admin, 5 riders, 5 products in both branches, 5 customers. Checked on a scratch copy of the current schema (all counts right; owner is the system creator). Logins: [supabase/SEED_LOGINS.md](../supabase/SEED_LOGINS.md).

1. [x] Loaded on live with `npx supabase db query --linked -f supabase/seed_quick.sql`, keeping the owner's account and business "KayKay's" as Main; added "KayKay's Westlands". Backup from before: `/home/dennis/isms-backups/2026-11-23-before-seed-quick/data.sql` (2026-11-23).
2. [x] `admin@kaykays.test` and `rider1@kaykays.test` sign in on live (password grant OK) (2026-11-23).
3. [ ] **You:** open the app as owner, switch between both branches: 5 products and the customers should show in each; riders should appear when assigning a delivery.
4. [ ] Before real customers use live: wipe the test data (`supabase/dev_wipe.sql`). That also removes your own account and business.

---

## Version numbers start again at 1.0.0 (2026-11-23)

The old v7.x releases and tags are removed from both repos (KIMGITO/ISMS and KIMGITO/kaykays-releases); the tag `v0.0.0` marks the restart, so the next release is exactly **1.0.0**. The website now shows the same version in its footer. Android version codes start at 20100000 (old ones were 107xxxxx), so phones update in place.

1. [x] Remove the old releases, tags and `update-manifest` branches; push the `v0.0.0` tag (2026-11-23).
2. [ ] `git push`. "Release and Deploy" should show `v0.0.0 -> v1.0.0 (major)` and publish v1.0.0 in kaykays-releases; `https://raw.githubusercontent.com/KIMGITO/kaykays-releases/update-manifest/latest.json` should say `"version": "1.0.0"`.
3. [ ] Open the website: the footer should end with `v1.0.0`. In the app, About should show 1.0.0.
4. [ ] **You:** on each Windows/Linux PC with a 7.x app, uninstall it and install 1.0.0 from the releases page (7.x won't auto-update to a lower number). Android phones update over the old app.

---

## Owner sign-up fails + v7.6 release blocked (2026-11-23)

Sign-up: the cause was the password. Live Supabase Auth needs 8+ characters with a capital, a small letter and a number; the app only checked for 6 characters and hid Supabase's message behind "check your connection". The app now checks the same rule on both sign-up forms (`src/utils/passwordRule.ts`) and shows the password message.

1. [x] Find the cause: the browser console showed `AuthWeakPasswordError` (2026-11-23).
2. [ ] Reload the app (sign out or clear the site data first, to drop the old login from before the reset), then register the owner with a password that has 8+ characters, a capital, a small letter and a number. It should go to the 6-digit code screen, and `SELECT count(*) FROM auth.users;` should return 1.
3. [x] Fix the 6 `zip` advisories (RUSTSEC-2026-0367/0368/0369/0429/0545/0548): `tauri-plugin-updater` 2.14.1 uses `zip` 9 (pinned 9.4.2). This needs Tauri 2.12, so `tauri` went 2.11.5 → 2.12.5 and npm `@tauri-apps/api` 2.12.4, `@tauri-apps/cli` 2.12.4, `@tauri-apps/plugin-updater` 2.14.1 (exact pins, every version at least two weeks old). `cargo audit` shows 0 vulnerabilities and `cargo check` + `tsc` pass on Linux (2026-11-23). The Windows build was not tried locally.
4. [ ] Commit `package.json`, `package-lock.json` and `src-tauri/Cargo.lock`, then `git push`. The "Security checks" jobs should pass and "Release and Deploy" should build Windows/Android/Linux, then tag and publish.
5. [ ] **You:** install the new release on Windows over the old one. The in-app update should download, install and restart on the new version (this is the code path that unzips with `zip` 9).

---

## Phase 10: cost, operations, final readiness (2026-11-23)

Reports: [infrastructure/cost-management.md](infrastructure/cost-management.md), [ISMS-AG Ch 13](../documentation/final/ISMS-System-Administration-Guide/ISMS-AG.md), [operations/accounts-and-ownership.md](operations/accounts-and-ownership.md), [ISMS-TD Ch 23](../documentation/final/ISMS-Technical-Documentation/ISMS-TD.md) (final status: **Not Ready**, with the list of what lifts it).

1. [ ] Push the database changes together with Phase 8 step 1 (the repair of `20261201005`, then `bash scripts/db-push.sh`). Afterwards in the SQL editor: `SELECT tablename FROM pg_publication_tables WHERE pubname = 'supabase_realtime' ORDER BY 1;` should list 26 tables including `money_assets` and not `audit_logs`; `SELECT check_key, problem FROM ops_watchdog_checks() WHERE check_key = 'storage:size';` should return one row with an empty problem.
2. [ ] Release the app (`git push`, with Phase 7/8). Then open Payments on two devices and make a cash sale on one: the Cash balance on the other should change within a few seconds without a refresh.
3. [ ] **You:** Supabase → Organization → Billing: confirm the plan. Before the first paying business, move to **Pro** with the **spend cap on** (OPS-06). Then in the SQL editor: `UPDATE ops_watchdog_config SET db_size_limit_mb = 8192, storage_limit_mb = 102400;`. Write the plan and the invoice amount in cost-management.md section 1.
4. [ ] **You:** fill in the "Owner to confirm" cells of [accounts-and-ownership.md](operations/accounts-and-ownership.md): 2FA by authenticator app and backup codes for Supabase, Cloudflare, GitHub, Google, Hugging Face, Telegram and DreamHost; the billing card and email for each; the domain's renewal date with auto-renew on.
5. [ ] **You:** name a backup person who can reach the offline copy and the accounts if you can't (OPS-05), and write down how (password manager emergency access or a sealed copy).
6. [ ] **You:** GitHub → Settings → Billing: spending limit $0 (Actions never charge). Cloudflare → Notifications: a usage-based billing alert once R2 is on (OPS-07).
7. [ ] Before ~20 businesses or any bulk customer email: move email off personal Gmail to a sending service on kaykays.com (SPF/DKIM set at the domain), then change the `SMTP_*` function secrets (OPS-04). A sign-in code should then arrive from the new address.
8. [ ] Each month: refresh the numbers with cost-management.md section 8.

## Phase 9: expansion (2026-11-23)

Report: [ISMS-TD Ch 20.4](../documentation/final/ISMS-Technical-Documentation/ISMS-TD.md). Nothing to deploy; the other findings are design work for when expansion starts.

1. [ ] **You:** ask a Kenyan data protection adviser two things (EXP-06): does ISMS need to register with the ODPC, and is the privacy policy enough for data stored in the EU (Supabase, Paris) and the processors it uses (Cloudflare, AI providers)? Then update the website's privacy page (`website/src/infoPages.ts` → `privacy`) as advised. The page should name where data is stored and every processor.
2. [x] **You:** choose how long to keep notifications and the audit log (EXP-07). (2026-11-24: owner said "as Kenyan law demands"; built, see Retention and erasure at the top.)

## Phase 8: performance (2026-11-23)

Report: [ISMS-TD Ch 20](../documentation/final/ISMS-Technical-Documentation/ISMS-TD.md). The database change and the app change are independent of each other; both are safe with old and new app versions.

1. [x] (2026-11-23: live database reset with `supabase db reset --linked`, all data wiped, every migration re-applied from the files; `db-push.sh --check` reports 30 on live and unchanged, `check-live-grants.sh` reports no problems.) **Live has an earlier draft of `20261201005`** (found in Phase 10: no REVOKE on `fn_perm_cache_gen`, no `prune-cron-history` job; the rest works). The file is safe to run twice (tested), so re-apply it: `npx supabase migration repair --status reverted 20261201005 --linked`, then `bash scripts/db-push.sh`. That push also applies Phase 10's `20261201006` and `20261201007`, and it should end with "Live now has every migration in this folder, unchanged, and its access rules are right." Then `SELECT jobname FROM cron.job WHERE jobname = 'prune-cron-history';` should return one row.
2. [ ] Release the app: `git push` (with the Phase 7 push). After the update, open the app on two devices as a cashier and sell one item on the first. On the second, that product's stock should change within about a second, and the browser's Network tab should show no new `products` request.
3. [ ] A week after step 1, in the SQL editor: `SELECT calls, round(mean_exec_time) ms FROM pg_stat_statements WHERE query LIKE '%transaction_items_1%' ORDER BY calls DESC LIMIT 3;` The sales-list averages should be well under the old 650–1,000 ms. Record the numbers in ISMS-TD Ch 20 section 1.

---

## Phase 7: release safety (2026-11-23)

Report: [deployment/release-safety.md](deployment/release-safety.md). From now on push migrations with `bash scripts/db-push.sh`, not a bare `npx supabase db push`.

1. [ ] Push `main`: `git push`. In **Actions → Release and Deploy**, the jobs *Database checks* and *Security checks* should pass (about 5 minutes for the database one). If *Database checks* fails, its log names the migration or test.
2. [ ] Before the next release is due, open a test pull request (any small change) and check *Database checks*, *Security checks* and *Type check and tests* appear on it and pass.
3. [ ] **You:** GitHub → Settings → Branches → add a rule for `main`: block force pushes and deletion. (Requiring checks too would block direct pushes; only add it if you switch to pull requests.) `git push --force` to `main` should then be refused.
4. [ ] **You (optional):** GitHub → Settings → Environments → `production-app` and `production-website` (they appear after the first deploy): add yourself as a required reviewer if you want to approve each web deploy. Delete the old Vercel environments `Production`, `Production – isms`, `Preview – isms`.
5. [ ] Staging (WEB-03, deferred): when it exists, point `.env` at it (REL-01) and rehearse **Actions → Roll back web** there.

## Phase 6: attack resistance (2026-11-23)

Report: [ISMS-AG Ch 9.5](../documentation/final/ISMS-System-Administration-Guide/ISMS-AG.md). Order matters: the new website understands both the old and the new promo check, the old website only the old one.

1. [x] Deploy the website: `npm run website:deploy`. Applying a wrong promo code in the cart should still say "We don't recognise that promo code." (2026-11-23: the live website's script has the new promo check, found in Phase 10.)
2. [x] Apply the database change: `bash scripts/db-push.sh` (it runs the checks and `check-live-grants.sh` itself). It should end with "Live now has every migration in this folder, unchanged, and its access rules are right." (2026-11-23: `20261201004` found on live, identical to the file; `check-live-grants.sh` clean.)
3. [ ] Deploy the edge functions (2026-11-23 Phase 10: all were redeployed at 11:53 Nairobi time, after the Phase 6 commit; only the `curl` check below is left, and `security_events` was still empty) (all of them share the changed `shared/` code; named one by one so the `shared` folder is never deployed as a function): `npx supabase functions deploy accept-alert ai-config airtel-callback airtel-payments alarm-sync area-advisor auth-otp backup-config bi-analyze card-payments card-webhook chat complaints customer-assistant customer-checkout kra-etims mpesa-payments mpesa-webhook ops-alert send-email send-fcm sms-config sync till-callback ussd whatsapp-config`. `config.toml` keeps the no-login ones open. `curl -s -X POST "https://<project-ref>.supabase.co/functions/v1/mpesa-webhook?token=wrong"` should answer `Forbidden`, and `SELECT kind, source FROM security_events ORDER BY id DESC LIMIT 1;` should show `bad_token | mpesa-webhook`.
4. [ ] Push `main`: `git push`. **Actions → Security checks** should pass (npm audit, cargo audit, gitleaks, guard tests). If `cargo audit` fails, update the crate it names or record why it doesn't apply.
5. [ ] **You:** GitHub → Settings → Code security: turn on *Dependabot alerts* and *Dependabot security updates*. Dependabot PRs should appear under Pull requests within a day.
6. [ ] **You (optional):** set the provider IP lists from Safaricom's and Paystack's current docs: `npx supabase secrets set MPESA_ALLOWED_IPS=... PAYSTACK_ALLOWED_IPS=...`. Then make one test payment of each; it should still complete. If it doesn't, unset the list (`npx supabase secrets unset MPESA_ALLOWED_IPS`).
7. [ ] **You:** arrange an independent penetration test before onboarding larger customers. Give the tester the report above and a staging copy, not production.

## Phase 5: monitoring and alerting (2026-11-23)

Commits `225ac53`, `a54baa2`. Report: [ISMS-AG Ch 10.3](../documentation/final/ISMS-System-Administration-Guide/ISMS-AG.md).

1. [x] Apply the database change. (2026-11-23: `20261201003` found already on live by `db-push.sh --check`, identical to the file.)
2. [ ] Deploy the function: `npx supabase functions deploy ops-alert --no-verify-jwt`.
3. [ ] Run `SELECT public.run_ops_watchdog(true);` in the SQL editor. A "Watchdog test" message should arrive in Telegram.
4. [ ] **You:** create free UptimeRobot or Better Stack monitors for the web app, the website and the health check (`https://<project-ref>.supabase.co/functions/v1/ops-alert`, keyword `"ok":true`), with both Telegram and email as contacts. Then break one on purpose once to see the alert arrive. Steps: [ISMS-TD Ch 15 and 17](../documentation/final/ISMS-Technical-Documentation/ISMS-TD.md) → Uptime monitor.
5. [ ] After a month, write the monthly availability (target 99.9%) in the Phase 5 report.

## FIN-02: one-step sale saving (2026-11-23)

Report: [ISMS-AG Ch 9.5](../documentation/final/ISMS-System-Administration-Guide/ISMS-AG.md).

1. [ ] **You:** test one cash sale in `npm run dev`. It should save, and appear in the Sales Log with the right total.
2. [ ] Push `main`: `git push`. The `fix:` commits release a patch version. A "vX.Y.Z is live" message should arrive in Telegram.
3. [ ] Once every device runs the new build, block direct sale inserts (new migration), then `npx supabase db push` and `bash scripts/check-live-grants.sh`.

## SEC-04 / SEC-05: test password on live

1. [ ] **You:** if you did not edit account `abb89fdf…` on 2026-11-22, reset both live passwords in Supabase → Authentication → Users. Never use the seed password on live.
2. [ ] **You:** sign out all sessions for those accounts (same screen). Signing in again with the old password should fail.

## SEC-02: backups (Phase 3, deferred)

1. [ ] **You:** in GitHub → Settings → Secrets, set `SUPABASE_DB_URL`, `BACKUP_PASSPHRASE` (keep an offline copy), `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`.
2. [ ] Run **Actions → Back up database → Run workflow**. It should pass and the backup should be in R2.
3. [ ] Run **Actions → Restore drill → Run workflow**. It should pass.

## SEC-03 / SEC-07: sign-in settings

1. [ ] **You:** in Supabase → Authentication, turn on TOTP MFA, set the password minimum to 8 with letters and digits, and turn on the leaked-password check if the plan allows it. A 6-character password should then be refused.

## SEC-09: protect main

1. [ ] **You:** in GitHub → Settings → Branches, protect `main`: require the checks to pass, no force push. A `git push --force` to `main` should then be refused.

## Phase 4: domain and sign-in addresses

1. [ ] **You:** in Supabase → Authentication → URL Configuration, check the Site URL and Redirect URLs are the live web app addresses (WEB-07). A sign-in link from an email should open the live app.
2. [ ] **You:** when ready, move kaykays.com DNS to Cloudflare (WEB-05), then add SSL and domain expiry checks in the uptime tool.

---

## Done

(nothing yet)
