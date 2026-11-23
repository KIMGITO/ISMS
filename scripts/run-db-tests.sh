#!/usr/bin/env bash
# Every database test suite, against a database built from this repo's migrations (Phase 7).
# Used by CI (.github/workflows/db-checks.yml) and before `scripts/db-push.sh`.
#
#   bash scripts/run-db-tests.sh                    # finds the local Supabase DB container
#   C=supabase_db_isms-seedtest bash scripts/run-db-tests.sh
#
# Needs a running local Supabase Postgres (`npx supabase db start` is enough). Only the throwaway
# databases promo_test and promo_test_tpl in it are touched.
# 1. Builds promo_test from the migrations (supabase/tests/promotions/rebuild.sh). A migration
#    that fails stops everything here.
# 2. Keeps a copy as a template, and gives each suite a fresh copy of it (seconds, not a rebuild).
# 3. Runs every supabase/tests/*/*_test.sh. promotions then referrals share one copy (in that order).
# Exit 0 = all passed; 1 = a suite failed; 2 = couldn't build the database.
set -uo pipefail
cd "$(dirname "$0")/.."

if [ -z "${C:-}" ]; then
  C=$(docker ps --format '{{.Names}}' | grep -E '^supabase_db_isms' | head -1)
  [ -n "$C" ] || { echo "No local Supabase database is running. Start one: npx supabase db start"; exit 2; }
fi
export C DB=promo_test
p() { docker exec -i "$C" psql -U supabase_admin -d postgres -q -v ON_ERROR_STOP=1 "$@"; }
echo "Database container: $C"

T0=$SECONDS
bash supabase/tests/promotions/rebuild.sh || { echo "::error::The migrations did not build a test database."; exit 2; }
p -c "DROP DATABASE IF EXISTS promo_test_tpl WITH (FORCE)" \
  -c "CREATE DATABASE promo_test_tpl TEMPLATE promo_test" >/dev/null || exit 2
echo "Built from the migrations in $((SECONDS - T0)) s."

fresh() {
  p -c "DROP DATABASE IF EXISTS promo_test WITH (FORCE)" -c "CREATE DATABASE promo_test TEMPLATE promo_test_tpl" >/dev/null
}

# Suites that must share one database, in order. Every other *_test.sh runs on its own copy.
GROUPS_IN_ORDER=("promotions/promotions_test.sh promotions/referrals_test.sh")
mapfile -t ALL < <(cd supabase/tests && ls -1 */*_test.sh | sort)
for t in "${ALL[@]}"; do
  [[ " ${GROUPS_IN_ORDER[*]} " == *" $t "* ]] || GROUPS_IN_ORDER+=("$t")
done

failed=()
summary=()
for group in "${GROUPS_IN_ORDER[@]}"; do
  fresh || { echo "::error::Couldn't copy the test database."; exit 2; }
  for t in $group; do
    echo; echo "=== $t"
    out=$(bash "supabase/tests/$t" 2>&1); code=$?
    echo "$out" | grep -E '^FAIL' || true
    last=$(echo "$out" | grep -E 'passed' | tail -1)
    summary+=("$(printf '%-40s %s' "$t" "${last:-no result line}")")
    # A suite fails if it exits non-zero or prints any FAIL line.
    if [ $code -ne 0 ] || grep -q '^FAIL' <<<"$out"; then failed+=("$t"); fi
  done
done

p -c "DROP DATABASE IF EXISTS promo_test_tpl WITH (FORCE)" >/dev/null 2>&1 || true
echo; echo "=== Summary ($((SECONDS - T0)) s)"
printf '%s\n' "${summary[@]}"
if [ ${#failed[@]} -gt 0 ]; then
  echo "::error::Failed: ${failed[*]}"
  exit 1
fi
echo "All database tests passed."
