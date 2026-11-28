# Archived migrations

The 65 files here were merged on 2026-11-28 into two files in `supabase/migrations/`:

- `20261121001_shop_features.sql`: every file from 20261121001 to 20261204005, in order.
- `20261204007_platform_payments_website.sql`: every file from 20261204007 to 20261216001, in order.

`20261204006_support_role.sql` stays on its own because it adds an enum value, which has to be
committed before later files can use it.

The Supabase CLI does not read this folder. The files are kept for history and for the website
tests that re-run a single file to check it can run twice. A database built from the merged files
has the same schema as one built from these files (checked with `pg_dump -s` on 2026-11-28).
