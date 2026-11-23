#!/usr/bin/env bash
# Load test (Phase 8): many tills at once against a big branch, in a throwaway local database.
# Never points at live: it only talks to a local Supabase DB container.
#
#   bash scripts/perf/load-test.sh                 # rebuilds perf_test from perf_tpl, runs all
#   SECS=60 CLIENTS="10 50 100" bash scripts/perf/load-test.sh
#
# Needs perf_tpl (scripts/perf/seed.sql on a promo_test copy; see docs/deployment/performance.md).
# Each "client" is one till or phone working as fast as it can, so 25 clients is far more load
# than 25 real cashiers (a real till makes a sale every 30 s or so, not every 50 ms).
#
# Scenarios, signed in as the cashier with row security on, through the same functions the app calls:
#   mix   6 x till sale (record_till_sale, 3 random lines of 2,000 products, stock + books)
#         3 x cashier reads (last 50 sales with lines, the product list)
#         1 x M-Pesa till callback (record_till_payment, as the till-callback edge function)
#   hot   till sales that all sell the same 5 products (stock row contention, like milk at 7 am)
set -uo pipefail
cd "$(dirname "$0")/../.."
C=${C:-$(docker ps --format '{{.Names}}' | grep -E '^supabase_db_isms' | head -1)}
DB=${DB:-perf_test}; SECS=${SECS:-20}; CLIENTS=${CLIENTS:-"1 10 25 50"}
MIGRATION=${MIGRATION:-}   # a migration file to apply on top first (to compare before/after)
B=b1000000-0000-0000-0000-000000000000
p() { docker exec -i "$C" psql -U supabase_admin -q -v ON_ERROR_STOP=1 "$@"; }

p -d postgres -c "DROP DATABASE IF EXISTS $DB WITH (FORCE)" -c "CREATE DATABASE $DB TEMPLATE perf_tpl" >/dev/null || exit 2
[ -n "$MIGRATION" ] && { docker exec -i "$C" psql -U postgres -d "$DB" -q -v ON_ERROR_STOP=1 -1 < "$MIGRATION" >/dev/null 2>&1 || { echo "migration failed"; exit 2; }; }
# A till for the callbacks; the cashier on shift.
p -d "$DB" >/dev/null <<SQL
INSERT INTO public.mpesa_settings (business_id, till_number) VALUES ('$B', '555000') ON CONFLICT DO NOTHING;
SQL

W=$(mktemp -d)
as_cashier="BEGIN;
SELECT set_config('request.jwt.claims', '{\"sub\":\"a2000000-0000-0000-0000-000000000000\",\"role\":\"authenticated\"}', true);
SET LOCAL role authenticated;"
sale_sql() { # $1 = how many products the lines are drawn from
cat <<SQL
\set a random(1, $1)
\set b random(1, $1)
\set c random(1, $1)
$as_cashier
SELECT public.record_till_sale(
  jsonb_build_object('business_id','$B','total',s.t,'discount',0,'tax',0,'final_total',s.t,
    'payment_method','Cash','staff_id','e2000000-0000-0000-0000-000000000000','staff_name','Carl Cashier'),
  s.items)
FROM (SELECT sum(price) t, jsonb_agg(jsonb_build_object('product_id',id,'product_name',name,'unit_price',price,'quantity',1,'discount_percentage',0)) items
      FROM public.products WHERE business_id = '$B' AND sku IN ('SKU' || :a, 'SKU' || :b, 'SKU' || :c)) s;
COMMIT;
SQL
}
sale_sql 2000 > "$W/sale.sql"
sale_sql 5 > "$W/hot.sql"
cat > "$W/read.sql" <<SQL
$as_cashier
SELECT count(*) FROM (SELECT t.id, (SELECT json_agg(ti) FROM public.transaction_items ti WHERE ti.transaction_id = t.id) FROM public.transactions t
  WHERE t.business_id = '$B' AND t.deleted_at IS NULL ORDER BY t.timestamp DESC LIMIT 50) x;
SELECT count(*) FROM (SELECT * FROM public.products WHERE business_id = '$B' AND deleted_at IS NULL LIMIT 1000) x;
COMMIT;
SQL
cat > "$W/callback.sql" <<SQL
SELECT public.record_till_payment(jsonb_build_object('TransID', 'LT' || md5(random()::text), 'TransAmount', '150',
  'BusinessShortCode', '555000', 'MSISDN', '254711000000', 'FirstName', 'Load', 'TransTime', to_char(now(), 'YYYYMMDDHH24MISS')));
SQL
docker exec "$C" mkdir -p /tmp/perf && docker cp -q "$W/." "$C:/tmp/perf/" && rm -rf "$W"

run() { # name, clients, pgbench script args...
  local name=$1 n=$2; shift 2
  local out; out=$(docker exec "$C" pgbench -U supabase_admin -d "$DB" -n -c "$n" -j "$(( n < 8 ? n : 8 ))" -T "$SECS" -r "$@" 2>&1)
  local tps fail aborted lats
  tps=$(grep -oE '^tps = [0-9.]+' <<<"$out" | grep -oE '[0-9.]+$' | xargs printf '%.1f')
  fail=$(grep -m1 -oE 'number of failed transactions: [0-9]+' <<<"$out" | grep -oE '[0-9]+$')
  aborted=$(grep -c 'aborted' <<<"$out")
  # Average ms per script, in the order given (sale, read, callback).
  lats=$(grep -E '^ - latency average' <<<"$out" | grep -oE '[0-9.]+' | xargs -r -n1 printf '%.0f ')
  [ -n "$lats" ] || lats=$(grep -m1 -oE '^latency average = [0-9.]+' <<<"$out" | grep -oE '[0-9.]+$' | xargs -r printf '%.0f')
  printf '%-6s %8s %10s %8s %8s   %s\n' "$name" "$n" "${tps:-?}" "${fail:-?}" "$aborted" "${lats:-?}"
  [ -n "${VERBOSE:-}" ] && echo "$out"
  [ "$aborted" -gt 0 ] && grep -m3 -E 'ERROR|aborted' <<<"$out" | sed 's/^/        /'
}

before=$(p -d "$DB" -tAc "select count(*) from public.transactions where business_id = '$B'")
echo "Database $DB in $C, $SECS s per run. Sales in the branch before: $before"
printf '%-6s %8s %10s %8s %8s   %s\n' "test" "clients" "per sec" "failed" "aborted" "avg ms per kind (mix: sale read callback)"
for n in $CLIENTS; do
  run mix "$n" -f /tmp/perf/sale.sql@6 -f /tmp/perf/read.sql@3 -f /tmp/perf/callback.sql@1
done
for n in $CLIENTS; do
  run hot "$n" -f /tmp/perf/hot.sql
done

echo
echo "== Did every sale add up? (sale lines = total, stock moved, books balanced)"
p -d "$DB" -tA <<SQL
SELECT 'sales recorded: ' || count(*) FROM public.transactions WHERE business_id = '$B' AND staff_name = 'Carl Cashier';
SELECT 'sales whose lines do not add up to the total: ' || count(*) FROM public.transactions t
 WHERE t.business_id = '$B' AND t.staff_name = 'Carl Cashier'
   AND t.total <> (SELECT COALESCE(sum(line_total), 0) FROM public.transaction_items i WHERE i.transaction_id = t.id);
SELECT 'hot products: units sold ' || COALESCE(sum(i.quantity), 0) || ', stock went down by ' || (5 * 1000000 - (SELECT sum(stock) FROM public.products WHERE business_id = '$B' AND sku IN ('SKU1','SKU2','SKU3','SKU4','SKU5')))
  FROM public.transaction_items i JOIN public.transactions t ON t.id = i.transaction_id JOIN public.products p ON p.id = i.product_id
 WHERE t.business_id = '$B' AND t.staff_name = 'Carl Cashier' AND p.sku IN ('SKU1','SKU2','SKU3','SKU4','SKU5');
SELECT 'books entries out of balance: ' || count(*) FROM (SELECT e.id FROM public.acc_entries e JOIN public.acc_lines l ON l.entry_id = e.id
 WHERE e.business_id = '$B' GROUP BY e.id HAVING sum(l.debit) <> sum(l.credit)) x;
SELECT 'till payments recorded: ' || count(*) FROM public.mpesa_till_payments WHERE business_id = '$B';
SQL
