# Code and wording review, 2026-11-28

A 30-minute pass over the whole codebase (app `src/`, website `website/src/`, edge functions
`supabase/functions/`, about 112,000 lines). Two goals: make the user-facing text read plainly,
and fix code that breaks the project rules in CLAUDE.md or could cause wrong results. Everything
below was checked with `npm run lint`, `npm run website:lint`, `deno check` on every edge
function, and `npm test` (112 tests pass).

## Fixed

### Wrong data or access

| Where | Problem | Fix |
|---|---|---|
| `supabase/functions/complaints/index.ts` | When AI was off or failed, Feedback > Insights returned `success: true` with made-up figures ("Product Quality 12, 40%") and made-up problems. Staff would read them as their customers' views. | The function now returns `success: false` and the screen shows "not available". The fake data is gone. |
| same | The prompts named "Denso" as the business, which is wrong for every other business on the platform. | Uses the business's own name. |
| same | The app sent the whole feedback list in the request, unbounded, and the function trusted it. | The function reads the business's open feedback from the database with the caller's own session (RLS applies), newest 200, each cut to 600 characters. The three actions nothing called any more (`analyze`, `generate_reply`, `improve_reply`) are removed. |
| `supabase/functions/chat/index.ts` | Full access was decided by comparing the role name, against the permission rule, and a missing role fell back to `"Owner"`. | Full access now comes from the database (`my_permissions.full_access`). A missing role falls back to `"Staff"`. |
| `website/src/infoPages.ts` | The default About page told every shop's customers "Fresh every day. We sell what we can keep fresh", including electronics and services shops. It also promised delivery when a shop has delivery off. | Plain statements that hold for any shop, and delivery is only mentioned when it is on. |
| `src/services/repositories.ts` (`PaymentRepository.add`) | A payment could be sent to the database with no business ID. | Stops with "Choose a business before recording a payment." |
| `src/features/WorkersView.tsx` | Adding a supplier could run with no business selected. | Returns early, as the other branches already did. |
| `src/stores/authStore.ts` | Sign-up, sign-in and accept-invite passed a possibly empty password to Supabase. | Each asks for the password first. |

### Number rule

- `src/services/supabaseService.ts`: sale line totals used `toFixed(2)`; now `roundMoney`.
- `src/features/home/HomeDashboard.tsx`: product quantities showed 2 decimals; now `formatQty` (1 decimal).

### Type safety

- The app's `tsconfig.json` had no `strict` setting, so the compiler did not check for `null` or
  `undefined` anywhere. Turning it on found 45 errors. All are fixed and `strict` is now on for the
  app and the website (which extends the same file). New code that might use a missing value now
  fails the build instead of failing on a customer's screen.
- `ShowToast` is exported from `notificationStore.ts`; `BuyingView` and `RidersToPay` used their
  own copies of the type that did not match the real function.

### Logs

Four `console.log` calls printed whole objects: the full AI reply (business figures), every
realtime change, full push messages, and content being shared (receipts). They now print a
short line only.

### Wording (humanizer pass)

The app's text was already mostly plain after the 2026-11-17 cleanup. Changed:

- Prose dashes replaced: notification sound descriptions ("Sound 1, standard tone"), the
  printer "Not found. Is it switched on?", regular-order notes on the website ("(delivered)",
  "(changed by the shop)"), the weekly total in the regular-order sheet, a petty-cash placeholder.
- "Welcome to X command center!" is now "X is set up and ready to use."; "Welcome to Denso!" lost
  its exclamation mark; "Paste Code" is "Paste code".
- File header comments that described an old version ("Re-engineered for Strict Online-First
  Real-Time Architecture", "Streamlined 5-Role Core", "seamless integration") now say what the
  file holds.

Left as they are on purpose: `—` for an empty value and `–` in date ranges (both correct
typography), Title Case on website banner headings (a design choice), and "Denso" where it names
the product itself.

## Not changed, recommended next

1. **`src/App.tsx` is 5,732 lines, almost all one component.** It is the hardest file to change
   safely. Split it in steps, one per release, each checked in the browser: the sign-in and invite
   screens, the sidebar and mobile tabs, the branch switcher, the tour. Not done here because it
   needs someone clicking through every screen afterwards.
2. **209 `as any` casts**, most in `App.tsx`, `repositories.ts`, `supabaseService.ts` and
   `FinanceView.tsx`. Database rows are read untyped. Generating types with
   `npx supabase gen types typescript` and using them in the repositories would remove most of them.
3. **The website uses raw `<select>`** in 7 places (shop sort, contact topic, delivery zone,
   feedback product, regular orders, branch picker). The component rule names the app's shared
   components, which the website does not have. Either add a small website dropdown or write the
   rule down as app-only.
4. Other files over 1,400 lines: `CustomersView`, `repositories.ts`, `POSView`, `authStore`,
   `BusinessManagementView`, `AccountingView`, `UnifiedUploader`, `PromotionsView`,
   `DashboardView`, `supabaseService.ts`, `InventoryView`.

Edge-function access checks were looked at and are in order: every function checks membership and
permission, a webhook signature, the service key, or (the shop assistant) is public with a
per-visitor quota.
