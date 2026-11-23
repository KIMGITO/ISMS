# UI content audit (2026-11-23)

## Scope

All user-facing text in the staff app (`src/`) and the customer website (`website/src/`): screens, shared components, stores and services that produce toasts and errors, the guided tour, search results, permission prompts, placeholders and SEO text. Edge functions and receipts printed for customers were not changed.

Method: a script pulled every string literal and JSX text of 45+ characters (about 1,160) into an inventory, plus every toast title, every heading followed by a description, and every long placeholder. Each was read and kept, cut or rewritten.

The app had already had one plain-language pass (2026-11-17), so most text was fine. The changes below target what was left.

Also in this change: **the update bar at the top of the app is removed.** Update progress, Install and Restart are only on About this app. On desktop, a downloaded update now installs when you press "Restart and install" there (the bar used to restart the app by itself after 15 seconds).

## What changed

| Category | Examples (before → after) |
|---|---|
| Developer language shown to users (critical) | "Configure metadata, contact points, brand representations, and global workspace defaults…" → "Branches, contact details, logo and colours." · "Failed to load SMS configuration from edge engine" → "Could not load SMS settings" · "CORS or Network Error: Disallowed reading remote resource…" → "Could not upload the file. Check your connection and try again." · "Gemini API key is unconfigured on the server." → "The assistant is not set up yet." |
| Claims that weren't true | Permission explanations promised "urgent AI audit reports", "staff punch-in GPS checks", "dictate notes" and "expiring stocks". Rewritten to say what each permission is used for, in one line. Search entry "Let Kim compile milk production reports" → "Ask about your sales, stock and customers". |
| "Successfully … in database" | "\"Milk\" successfully created in database." → "\"Milk\" added." (and 15 similar toasts) |
| Long tour steps | Buying, Finance, Search and Shortcuts steps cut from 40–70 words to one sentence; gestures and side notes users find on the screen removed. |
| Shouting alerts | "CRITICAL: \"Milk\" is now completely Out of Stock!" → "Milk is out of stock." |
| Robotic auth messages | "Secure invitation validated successfully for joining as Cashier! Fill in details to accept." → "You're invited as Cashier. Fill in your details to join." |
| Assistant greeting | 40-word "professional Workspace Assistant" intro → "Hi, I'm Kim. Ask me about your sales, stock or customers." |
| Toast titles | About 90 Title Case titles → sentence case ("Could Not Save" → "Could not save"); vague ones renamed ("System Update" → "Branch deleted", "Operation Blocked" → "Not allowed", "Authentication Expired" → "Signed out"). |
| Redundant descriptions | Audit log "Who changed what. It can't be edited." under the heading "Who changed what" → "This log can't be edited." · Production subtitle "Recipe Formulations & Batch Management" → "Recipes and batches". |
| Placeholders used as instructions | "Describe branch inventory limits, wholesale distribution scopes..." → "What this branch does (optional)". |

## Terminology standards

- **Sign in / Sign out**, not "log in", "login" or "logged out", in new and changed text.
- **Code** for emailed codes ("We sent a 6-digit code to …"), not "verification code" or "recovery code".
- **Recipe** for a BOM in messages; the screen keeps its name "Production & BOM".
- **Saved / Deleted / Added** to confirm an action. No "successfully" and no exclamation marks.
- Errors say what happened, then what to do: "Could not … Check your connection and try again."
- Toast titles are in sentence case; screen names (Online Store, Stock Transfers) stay capitalised as proper names.

## Kept on purpose

- Legal, privacy and money-consequence text (refund, void, delete warnings, VAT and books explanations).
- `LEGACY_PLACEHOLDERS` in `ReceiptSettings.ts`: old default receipt text is matched by exact value to clear it, so it must not change.
- Customer website copy: already short and customer-facing. Two lines trimmed.
- Help and FAQ pages (`website/src/infoPages.ts`): long by nature, written as answers.

## Outstanding

1. Search → "Switch offline mode" is a developer tool that fakes a lost connection. Its text is now honest, but it probably shouldn't be offered to staff at all. Removing it changes behaviour, so it's left for a decision.
2. Some older messages still say "log in", e.g. "Signed out. Sign in again" vs older "Please log out and log back in". New text uses "sign in"; a full sweep wasn't done.
3. Strings shorter than 45 characters were only checked through toast titles and headings, not one by one.

## QA

- `npm run lint` and `npm run website:lint`: pass.
- `npm test`: 73 passed, 0 failed.
- `vite build` (app) and `npm run website:build`: pass.
- Not done: viewing each screen in a running app. Every change shortens text or keeps it the same length, so layouts shouldn't break, but this is unchecked on a phone.
