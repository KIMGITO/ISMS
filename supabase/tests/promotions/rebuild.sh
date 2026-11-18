#!/bin/bash
# Builds a throwaway database "promo_test" inside a running local Supabase Postgres container
# from this repo's migrations (as production does: schema dump, then the later files as
# postgres), and loads the test fixtures. Nothing else in that container is touched.
#   C=<container> bash supabase/tests/promotions/rebuild.sh
set -e
HERE=$(cd "$(dirname "$0")" && pwd); M=$(cd "$HERE/../../migrations" && pwd)
C=${C:-supabase_db_isms-seedtest}
p(){ docker exec -i $C psql -U supabase_admin -q "$@"; }
BASE=$(mktemp)
# Supabase's own schemas (auth, storage, extensions) from the container's main database.
docker exec $C pg_dump -U postgres -s -n auth -n storage -n extensions postgres > "$BASE" 2>/dev/null
p -d postgres -c "DROP DATABASE IF EXISTS promo_test WITH (FORCE)" -c "CREATE DATABASE promo_test" >/dev/null
p -d promo_test < "$BASE" >/dev/null 2>&1 || true
rm -f "$BASE"
# pg_cron lives only in the main database; realtime/vault/storage errors are expected here.
grep -v 'pg_cron' "$M/20261120001_schema.sql" | p -d promo_test 2>&1 >/dev/null \
  | grep ERROR | grep -v 'supabase_realtime\|vault\|fn_can_write\|fn_storage_folder\|handle_new_user' || true
p -d promo_test -c "ALTER SCHEMA public OWNER TO postgres" >/dev/null
for f in "$M"/202611[2-9][0-9]*.sql; do
  [[ $f == *20261120001* ]] && continue
  who=postgres; [[ $f == *20261120002* ]] && who=supabase_admin
  out=$(grep -v "cron.schedule('[a-z-]*', '[^']*', \$job" "$f" | docker exec -i $C psql -U $who -q -d promo_test -v ON_ERROR_STOP=1 -1 2>&1 | grep ERROR || true)
  [ -n "$out" ] && { echo "$(basename "$f"): $out"; exit 1; }
done
p -d promo_test -v ON_ERROR_STOP=1 < "$HERE/fixtures.sql" 2>&1 | grep ERROR || true
echo rebuilt
