#!/bin/bash
# Record references and global search (20261202001): every new expense, stock movement, audit
# entry and customer account entry gets a readable reference from the database; search finds
# records by those references, receipt numbers and journal numbers; and nobody finds a record
# their role can't read.
#   C=supabase_db_isms-seedtest bash supabase/tests/promotions/rebuild.sh
#   C=supabase_db_isms-seedtest bash supabase/tests/search/global_search_test.sh
HERE=$(cd "$(dirname "$0")" && pwd)
source "$HERE/../promotions/lib.sh"
B1=b1000000-0000-0000-0000-000000000000; B2=b2000000-0000-0000-0000-000000000000
EMP=e2000000-0000-0000-0000-000000000000
BR=d3000000-0000-0000-0000-000000000000   # Bread, 50.00
YEAR=$(sql "select to_char(now() at time zone 'Africa/Nairobi','YYYY')")
item(){ echo "{\"product_id\":\"$1\",\"product_name\":\"Bread\",\"quantity\":$2,\"unit_price\":$3,\"discount_percentage\":0}"; }
sale(){ as cash "select record_till_sale('{\"business_id\":\"$B1\",\"total\":$1,\"discount\":0,\"tax\":0,\"final_total\":$1,\"payment_method\":\"Cash\",\"staff_name\":\"Carl\",\"staff_id\":\"$EMP\"${3:+,$3}}'::jsonb, '$2'::jsonb)"; }
id_of(){ grep -oE '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' <<<"$1" | head -1; }
# search <who> <business> <query> → one line per result: kind|ref|title
search(){ as "$1" "select r->>'kind' || '|' || coalesce(r->>'ref','') || '|' || coalesce(r->>'title','') from jsonb_array_elements(global_search('$2', '$3')) r"; }

echo "--- references are given by the database"
E=$(as owner "insert into expenses (business_id, category, amount, description, staff_name, ref_no) values ('$B1','Rent',1200,'Shop rent November','Olive','EXP-1999-000001') returning ref_no" | head -1)
has "an expense gets EXP-$YEAR-…" "$E" "EXP-$YEAR-"
[[ "$E" != "EXP-1999-000001" ]] && { PASS=$((PASS+1)); echo "pass  a reference sent by the app is replaced"; } || { FAIL=$((FAIL+1)); echo "FAIL  the app chose its own reference"; }
as owner "update expenses set ref_no='EXP-2000-999999', description='Shop rent Nov' where ref_no='$E'" >/dev/null
eq "a reference never changes" "$(sql "select count(*) from expenses where ref_no='$E' and description='Shop rent Nov'")" "1"
E2=$(as owner "insert into expenses (business_id, category, amount, description, staff_name) values ('$B1','Transport',300,'Boda to market','Olive') returning ref_no" | head -1)
[[ "$E2" > "$E" ]] && { PASS=$((PASS+1)); echo "pass  the next expense gets the next number ($E2)"; } || { FAIL=$((FAIL+1)); echo "FAIL  $E2 after $E"; }
has "a duplicate reference is refused" "$(sql "update expenses set ref_no='$E' where ref_no='$E2'" ; sql "alter table expenses disable trigger trg_ref_no; update expenses set ref_no='$E' where ref_no='$E2'; alter table expenses enable trigger trg_ref_no;")" "duplicate key"
eq "rows made before this change were numbered" "$(sql "select count(*) from audit_logs where ref_no is null")" "0"

T=$(sale 100 "[$(item $BR 2 50)]"); SALE=$(id_of "$T"); ok "a till sale" "$T"
CODE=$(sql "select fn_short_id('$SALE')"); RECEIPT="TXN-$CODE"
STM=$(sql "select ref_no from inventory_adjustments where reference_number ilike '%$CODE%' limit 1")
has "the sale's stock movement gets STM-$YEAR-…" "$STM" "STM-$YEAR-"

echo "--- two tills at once: different references, no waiting on each other"
for i in 1 2 3 4; do sale 50 "[$(item $BR 1 50)]" > /tmp/gs_par_$i.txt & done; wait
eq "four parallel sales saved" "$(cat /tmp/gs_par_*.txt | grep -c ERROR)" "0"; rm -f /tmp/gs_par_*.txt
eq "stock movement references are unique" "$(sql "select count(*) - count(distinct ref_no) from inventory_adjustments")" "0"

echo "--- search finds the exact record"
has "receipt as logged ($RECEIPT)" "$(search owner $B1 "$RECEIPT")" "sale|$RECEIPT"
has "receipt as printed (RCT-$YEAR-$CODE)" "$(search owner $B1 "RCT-$YEAR-$CODE")" "sale|$RECEIPT"
has "first 5 characters of the receipt" "$(search owner $B1 "${CODE:0:5}")" "sale|$RECEIPT"
has "receipt number ranks first" "$(search owner $B1 "$RECEIPT" | head -1)" "sale|$RECEIPT"
has "expense by reference" "$(search owner $B1 "$E")" "expense|$E|Shop rent"
has "expense by the end of its reference" "$(search owner $B1 "${E: -6}")" "expense|$E"
has "expense by what it was for" "$(search owner $B1 "boda")" "expense|$E2"
has "stock movement by reference" "$(search owner $B1 "$STM")" "stock_move|$STM|Bread"
has "stock moved by a receipt" "$(search owner $B1 "$RECEIPT")" "stock_move|"
JE=$(sql "select no from acc_entries where business_id='$B1' and source_id='$SALE' limit 1")
has "journal entry by JE-$JE" "$(search owner $B1 "JE-$JE")" "journal|JE-$JE"
LOG=$(sql "select ref_no from audit_logs where business_id='$B1' order by ref_no desc limit 1")
if [ -n "$LOG" ]; then has "audit entry by reference" "$(search owner $B1 "$LOG")" "audit|$LOG"; fi
eq "nothing for a reference that doesn't exist" "$(search owner $B1 "EXP-$YEAR-987654")" ""
eq "one letter is not searched" "$(search owner $B1 "a")" ""
ok "odd characters don't break search" "$(search owner $B1 "%_\\''x(")"

echo "--- deliveries: receipt number and product lines"
D=$(sale 150 "[$(item $BR 3 50)]" '"is_delivery":true,"delivery_fee":0,"delivery_mode":"free","note":"Deliver to: Kahawa West."'); DSALE=$(id_of "$D"); ok "a delivery sale" "$D"
DCODE="TXN-$(sql "select fn_short_id('$DSALE')")"
has "delivery found by its receipt" "$(search owner $B1 "$DCODE")" "delivery|$DCODE"
has "delivery found by a product on it" "$(search owner $B1 "bread")" "delivery|"
eq "a till delivery shows its receipt, not 'Till sale'" "$(sql "select reference from fn_delivery_rows('$B1') where id='$DSALE'")" "$DCODE"
eq "each product is a line with its quantity" "$(sql "select l->>'name' || ':' || (l->>'quantity') from fn_delivery_rows('$B1') d, jsonb_array_elements(d.lines) l where d.id='$DSALE'")" "Bread:3"
has "the rider's list carries the lines" "$(as rider "select get_delivery_requests('$B1')")" "\"lines\""

echo "--- nobody finds what their role can't read"
eq "cashier finds no expenses" "$(search cash $B1 "$E")" ""
eq "cashier finds no journal entries" "$(search cash $B1 "JE-$JE" | grep -c journal)" "0"
eq "cashier finds no audit entries" "$(search cash $B1 "LOG-$YEAR" | grep -c audit)" "0"
has "cashier still finds the sale" "$(search cash $B1 "$RECEIPT")" "sale|$RECEIPT"
eq "rider finds no sales or expenses" "$(search rider $B1 "$RECEIPT" | grep -c 'sale|\|expense|')" "0"
eq "owner searching branch 2 doesn't see branch 1's expense" "$(search owner $B2 "$E")" ""
eq "signed-out callers can't search" "$(sql "set role anon; select global_search('$B1','$E')" | grep -c 'permission denied')" "1"

echo
echo "$PASS passed, $FAIL failed"
[ $FAIL -eq 0 ]
