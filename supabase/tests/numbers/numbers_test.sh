#!/bin/bash
# Money is stored to the cent, quantities to one decimal place (20261130007_quantity_one_decimal.sql).
#   C=supabase_db_isms-seedtest bash supabase/tests/promotions/rebuild.sh
#   C=supabase_db_isms-seedtest bash supabase/tests/numbers/numbers_test.sh
HERE=$(cd "$(dirname "$0")" && pwd)
source "$HERE/../promotions/lib.sh"
sql(){ docker exec -i $C psql -U supabase_admin -d $DB -tAq -v ON_ERROR_STOP=1 2>&1 <<<"SET client_min_messages = error;
$1"; }
B=b1000000-0000-0000-0000-000000000000; MILK=d1000000-0000-0000-0000-000000000000
EMP=e2000000-0000-0000-0000-000000000000

echo "-- column types"
# Points are worth a fraction of a shilling each (0.005), a rate rather than an amount.
eq "no quantity column keeps more than one decimal" "$(sql "select string_agg(table_name||'.'||column_name, ',') from information_schema.columns c
  join information_schema.tables t using (table_schema, table_name)
  where table_schema='public' and t.table_type='BASE TABLE' and data_type='numeric' and numeric_scale > 2
    and not (table_name='loyalty_settings' and column_name like 'value_%')")" ""
eq "no quantity array keeps more than one decimal" "$(sql "select string_agg(c.relname||'.'||a.attname, ',') from pg_attribute a join pg_class c on c.oid=a.attrelid
  where c.relnamespace='public'::regnamespace and c.relkind='r' and a.attnum>0 and not a.attisdropped
    and a.atttypid='numeric[]'::regtype and format_type(a.atttypid, a.atttypmod) !~ ',1\\)'")" ""
eq "every money column is stored to the cent" "$(sql "select string_agg(table_name||'.'||column_name, ',') from information_schema.columns c
  join information_schema.tables t using (table_schema, table_name)
  where table_schema='public' and t.table_type='BASE TABLE' and data_type='numeric'
    and column_name ~ '(price|cost|amount|total|fee|balance|paid|owed|due|wallet|debt)' and column_name !~ '(pct|percent|rate)'
    and coalesce(numeric_scale, -1) <> 2")" ""

echo "-- a till sale"
sql "update products set stock = 100 where id='$MILK'" >/dev/null
before=100
tx=$(as cash "select record_till_sale('{\"business_id\":\"$B\",\"total\":125.555,\"discount\":0,\"tax\":0,\"final_total\":125.555,\"amount_paid\":125.555,\"payment_method\":\"Cash\",\"staff_name\":\"Carl\",\"staff_id\":\"$EMP\"}'::jsonb,
  '[{\"product_id\":\"$MILK\",\"product_name\":\"Milk 1L\",\"unit_price\":100.444,\"quantity\":1.25}]'::jsonb)")
ok  "sale saved" "$tx"
eq  "quantity 1.25 is kept as 1.3" "$(sql "select quantity from transaction_items where transaction_id='$tx'")" "1.3"
eq  "price 100.444 is kept as 100.44" "$(sql "select unit_price from transaction_items where transaction_id='$tx'")" "100.44"
eq  "total 125.555 is kept as 125.56" "$(sql "select final_total from transactions where id='$tx'")" "125.56"
eq  "stock goes down by 1.3" "$(sql "select ($before - stock)::numeric(14,1) from products where id='$MILK'")" "1.3"
eq  "the books balance" "$(sql "select coalesce(sum(debit),0)-coalesce(sum(credit),0) from acc_lines where business_id='$B'")" "0.00"

echo; echo "passed $PASS, failed $FAIL"; [ $FAIL -eq 0 ]
