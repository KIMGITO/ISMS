#!/usr/bin/env bash
# Apply migrations to the LIVE database, with the checks first (Phase 7). Use this instead of a
# bare `npx supabase db push`.
#
#   bash scripts/db-push.sh            # checks, shows what will be applied, asks, pushes
#   bash scripts/db-push.sh --check    # checks only; changes nothing
#   bash scripts/db-push.sh --include-all   # extra arguments go to `supabase db push`
#
# 1. No uncommitted migration files: a half-written file pushed to live is how the
#    2026-11-18 rider-pay bug happened (live kept the draft; `migration list` said applied).
# 2. scripts/check-migrations.mjs against origin/main.
# 3. Live vs this folder, file by file (Supabase keeps the text of each applied migration):
#    an applied migration whose text differs here, or one live has that this folder doesn't, stops it.
# 4. Every DB test suite on a local database built from these files (scripts/run-db-tests.sh).
#    SKIP_DB_TESTS=1 skips it only when CI's "Database checks" already passed on this commit.
# 5. `supabase db push --dry-run`, a yes/no, the push, then scripts/check-live-grants.sh and
#    step 3 again, which must now find every file on live unchanged.
# Needs the Supabase CLI linked to the project (supabase link). Exit 0 = pushed (or checks
# passed with --check); 1 = a check failed, nothing pushed; 2 = pushed, but a check after it failed.
set -uo pipefail
cd "$(dirname "$0")/.."
CHECK_ONLY=""; ARGS=()
for a in "$@"; do [ "$a" = "--check" ] && CHECK_ONLY=1 || ARGS+=("$a"); done
stop() { echo; echo "STOPPED: $1"; echo "Nothing was pushed."; exit 1; }

echo "== 1. Uncommitted migration files"
dirty=$(git status --porcelain -- supabase/migrations)
[ -z "$dirty" ] || { echo "$dirty"; stop "commit (or remove) these migration files first."; }
echo "none"

echo; echo "== 2. Migration files"
git fetch -q origin main 2>/dev/null || echo "(couldn't fetch origin; comparing with the last fetched origin/main)"
node scripts/check-migrations.mjs origin/main || stop "fix the migration errors above."

# Prints "<version> same|DIFFERS|pending" per local file and "<version> LIVE-ONLY" per extra live one.
compare_live() {
  local json
  json=$(supabase db query --linked "select version, md5(regexp_replace(array_to_string(statements,''), '[[:space:];]', '', 'g')) h from supabase_migrations.schema_migrations order by version" 2>&1) \
    || { echo "$json" | tail -3; return 2; }
  LIVE_JSON="$json" node -e '
    const fs = require("fs"), crypto = require("crypto");
    const s = process.env.LIVE_JSON, live = new Map(JSON.parse(s.slice(s.indexOf("{"))).rows.map(r => [r.version, r.h]));
    const dir = "supabase/migrations", local = new Set();
    for (const f of fs.readdirSync(dir).filter(f => f.endsWith(".sql")).sort()) {
      const v = f.split("_")[0]; local.add(v);
      // Supabase stores each statement trimmed and without its semicolon; compare without either.
      const h = crypto.createHash("md5").update(fs.readFileSync(`${dir}/${f}`, "utf8").replace(/[\s;]/g, "")).digest("hex");
      console.log(v, !live.has(v) ? "pending" : live.get(v) === h ? "same" : "DIFFERS", f);
    }
    for (const v of live.keys()) if (!local.has(v)) console.log(v, "LIVE-ONLY");
  '
}

echo; echo "== 3. Live database vs these files"
cmp=$(compare_live) || stop "couldn't read the live database. Is the CLI linked (supabase link)?"
same=$(grep -c ' same' <<<"$cmp"); pending=$(grep ' pending' <<<"$cmp" || true)
echo "$same already on live and unchanged."
if grep -qE ' (DIFFERS|LIVE-ONLY)' <<<"$cmp"; then
  grep -E ' (DIFFERS|LIVE-ONLY)' <<<"$cmp"
  stop "DIFFERS = live ran an older text of that file (put the change in a new migration, or repair it on purpose: docs/deployment/release-safety.md). LIVE-ONLY = live has a migration this folder lacks (pull it first)."
fi
if [ -z "$pending" ]; then echo; echo "Live is up to date. Nothing to push."; exit 0; fi
echo "To apply:"; sed 's/^/  /' <<<"$pending"

echo; echo "== 4. Database tests"
if [ -n "${SKIP_DB_TESTS:-}" ]; then
  echo "Skipped (SKIP_DB_TESTS). Only do this when Actions → Database checks passed on $(git rev-parse --short HEAD)."
else
  bash scripts/run-db-tests.sh || stop "a database test failed (or no local database: npx supabase db start)."
fi

if [ -n "$CHECK_ONLY" ]; then echo; echo "Checks passed (--check). Nothing was pushed."; exit 0; fi

echo; echo "== 5. Push"
supabase db push --linked --dry-run "${ARGS[@]}" || stop "the dry run failed."
read -r -p "Apply these to the LIVE database now? Type yes: " answer
[ "$answer" = "yes" ] || stop "not confirmed."
supabase db push --linked "${ARGS[@]}" || { echo "The push failed part-way. Run: supabase migration list --linked"; exit 2; }

echo; echo "== After the push"
bash scripts/check-live-grants.sh; grants=$?
after=$(compare_live) || { echo "Couldn't re-read live."; exit 2; }
if grep -qE ' (DIFFERS|LIVE-ONLY|pending)' <<<"$after"; then
  grep -E ' (DIFFERS|LIVE-ONLY|pending)' <<<"$after"; echo "Live doesn't match these files after the push."; exit 2
fi
[ $grants -eq 0 ] || exit 2
echo "Live now has every migration in this folder, unchanged, and its access rules are right."
