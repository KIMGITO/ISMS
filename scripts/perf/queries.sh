#!/usr/bin/env bash
# Times the app's busiest reads (the top of live pg_stat_statements, 2026-11-23) against the
# perf_test database, signed in as each role with row security on, the way PostgREST runs them.
#
#   bash scripts/perf/queries.sh            # perf_test in the local Supabase DB container
#   DB=promo_test bash scripts/perf/queries.sh
#
# Prints the median of 3 runs in ms per query and role. See docs/deployment/performance.md.
set -uo pipefail
C=${C:-$(docker ps --format '{{.Names}}' | grep -E '^supabase_db_isms' | head -1)}
DB=${DB:-perf_test}
B=b1000000-0000-0000-0000-000000000000
declare -A UID_OF=([owner]=a0000000-0000-0000-0000-000000000000 [cashier]=a2000000-0000-0000-0000-000000000000)

# name|SQL (what PostgREST sends for the app's request; LIMIT 1000 = the API row cap)
QUERIES=(
"Sales list with lines and products (Sales log, Home)|select json_agg(x) from (select t.*, (select json_agg(i) from (select ti.*, (select row_to_json(p) from products p where p.id = ti.product_id) products from transaction_items ti where ti.transaction_id = t.id) i) transaction_items from transactions t where t.business_id = '$B' and t.deleted_at is null order by t.timestamp desc limit 1000) x"
"Last 50 sales with lines|select json_agg(x) from (select t.*, (select json_agg(ti) from transaction_items ti where ti.transaction_id = t.id) items from transactions t where t.business_id = '$B' and t.deleted_at is null order by t.timestamp desc limit 50) x"
"Role permissions (every screen)|select json_agg(r) from (select * from role_permissions where business_id = '$B' limit 1000) r"
"Products (till)|select json_agg(p) from (select * from products where business_id = '$B' and deleted_at is null limit 1000) p"
"Customers|select json_agg(c) from (select * from customers where business_id = '$B' and deleted_at is null limit 1000) c"
"Stock history|select json_agg(a) from (select * from inventory_adjustments where business_id = '$B' and deleted_at is null order by timestamp desc limit 1000) a"
"Notifications|select json_agg(n) from (select * from notifications where business_id = '$B' order by created_at desc limit 100) n"
"Session check (every request)|select public.check_request_session()"
)

run() { # role, sql -> median execution ms
  local who=$1 sql=$2 t=()
  for _ in 1 2 3; do
    t+=("$(docker exec -i "$C" psql -U supabase_admin -d "$DB" -tAq 2>&1 <<SQL | grep -oE 'Execution Time: [0-9.]+' | grep -oE '[0-9.]+$'
BEGIN;
SELECT set_config('request.jwt.claims', '{"sub":"${UID_OF[$who]}","role":"authenticated"}', true);
SET LOCAL role authenticated;
EXPLAIN (ANALYZE, TIMING OFF, COSTS OFF, SUMMARY ON) $sql;
ROLLBACK;
SQL
)")
  done
  printf '%s\n' "${t[@]}" | sort -n | sed -n 2p
}

printf '%-55s %10s %10s\n' "Query ($DB)" "owner ms" "cashier ms"
for q in "${QUERIES[@]}"; do
  name=${q%%|*}; sql=${q#*|}
  printf '%-55s %10s %10s\n' "$name" "$(run owner "$sql")" "$(run cashier "$sql")"
done
