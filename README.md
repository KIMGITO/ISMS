# ISMS: Integrated Shop Management System

ISMS runs a shop from one system: selling at the till, customers and their debts, wallets and
points, money in and out, stock, buying from suppliers, deliveries, staff shifts and the books.
It ships as the KayKay's staff app (Windows, Linux, Android and the web) and a customer website.

Developed by **Dennis Kimanthi Gitonga**, **Codensons**.

| | |
|---|---|
| Developer | Dennis Kimanthi Gitonga (kimanthidennis02@gmail.com) |
| Company | Codensons (codensons@gmail.com) |
| Licence | Commercial. See [LICENSE](LICENSE) |

## Documentation

The full documentation is in [documentation/](documentation/README.md). Each document comes in
three formats (Markdown, Word and PDF) in its own folder under `documentation/final/`:

| Document | For |
|---|---|
| ISMS-UG System User Guide | Staff: owners, managers, cashiers, riders, suppliers |
| ISMS-AG System Administration Guide | Business administrators and the platform operator |
| ISMS-TD Technical Documentation | Developers and technical staff |

Work still to be finished on the live system is listed in [docs/TO_FINISH.md](docs/TO_FINISH.md).

## How it is built

| Part | Technology |
|---|---|
| Staff app | React 19, TypeScript, Vite 6, Tailwind CSS 4, Zustand 5 (`src/`) |
| Desktop apps | Tauri 2 (`src-tauri/`): Windows `.msi`/`.exe`, Linux `.deb`/`.AppImage` |
| Android app | Capacitor 8 (`android/`) |
| Customer website | React and Vite (`website/`) |
| Database and server | Supabase: PostgreSQL 17 with row-level security, edge functions in Deno (`supabase/`) |
| Web hosting | Cloudflare Workers, blue-green deploys (`scripts/deploy-web.sh`) |
| Payments and tax | M-Pesa (Daraja), Airtel Money, Paystack cards, KRA eTIMS |

## Rules the code keeps

These are set by the owner and written out in [CLAUDE.md](CLAUDE.md):

- **Every money movement is recorded**, and the books and the figures on screen come from the
  same records, so they always agree.
- **Records the books and the audit trail stand on are never deleted.** Sales are voided or
  refunded, not deleted. The audit trail, stock history and points used are kept for good.
- **Money has 2 decimal places, quantities at most 1.**
- **Every permission the app checks is also enforced by the database.**

## Getting started

Needs Node.js 22, the Supabase CLI and Docker. Desktop builds also need Rust; Android builds
need Android Studio and its SDK.

```bash
npm install
cp .env.example .env        # then fill in VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY
npm run dev                 # staff app (Vite prints the address)
npm run website:dev         # customer website
```

Other commands:

| Command | Does |
|---|---|
| `npm run lint` | Type-checks the staff app |
| `npm test` | Runs the app's unit tests |
| `bash scripts/run-db-tests.sh` | Builds a test database from the migrations and runs every database test |
| `npm run tauri:dev` | Desktop app in development |
| `npm run android` | Debug Android build |
| `npm run release` | Versioned release for every platform (see the Technical Documentation) |

## Changing the database

Migrations live in `supabase/migrations/`. Push them with the release-safe script, then check
the live access rules:

```bash
bash scripts/db-push.sh
bash scripts/check-live-grants.sh
```

## Licence

Commercial software. Copyright (c) 2024-2026 Dennis Kimanthi Gitonga (Codensons). All rights
reserved. The installers can be downloaded freely, but using the app requires a paid licence,
and the software, its installers and this source code may not be copied, shared or
redistributed. See [LICENSE](LICENSE). To buy a licence: kimanthidennis02@gmail.com or
codensons@gmail.com.
