#!/bin/bash
# Read-only check of the LIVE database's access rules (supabase/tests/permissions/grants_check.sql).
# Needs the Supabase CLI linked to the project (supabase link). Changes nothing.
# Exit 0 = no problems; 1 = problems listed; 2 = could not run.
#   bash scripts/check-live-grants.sh
set -uo pipefail
HERE=$(cd "$(dirname "$0")/.." && pwd)
SQL=$(grep -v '^\s*--' "$HERE/supabase/tests/permissions/grants_check.sql" | tr '\n' ' ')
OUT=$(cd "$HERE" && supabase db query --linked "$SQL" 2>&1) || { echo "Could not query the live database:"; echo "$OUT" | tail -5; exit 2; }
PROBLEMS=$(printf '%s' "$OUT" | node -e '
let s = ""; process.stdin.on("data", d => s += d).on("end", () => {
  const j = JSON.parse(s.slice(s.indexOf("{")));
  for (const r of j.rows || []) console.log(r.problem);
});') || { echo "Could not read the result."; exit 2; }
if [ -z "$PROBLEMS" ]; then echo "Live access rules: no problems."; exit 0; fi
echo "Live access rules: $(printf '%s\n' "$PROBLEMS" | wc -l) problem(s):"
printf '%s\n' "$PROBLEMS"
exit 1
