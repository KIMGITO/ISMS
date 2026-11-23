#!/bin/bash
# Paid till sales (record_till_sale, 20261201002): money figures must match the items, a sale
# is saved whole or not at all, repeats never count twice, and parallel sales keep stock right.
#   C=supabase_db_isms-seedtest bash supabase/tests/promotions/rebuild.sh
#   C=supabase_db_isms-seedtest bash supabase/tests/sales/sale_totals_test.sh
HERE=$(cd "$(dirname "$0")" && pwd)
source "$HERE/../promotions/lib.sh"
B1=b1000000-0000-0000-0000-000000000000; EMP=e2000000-0000-0000-0000-000000000000
BR=d3000000-0000-0000-0000-000000000000   # Bread, 50.00
M5=d2000000-0000-0000-0000-000000000000   # Milk 500ml, 60.00
item(){ echo "{\"product_id\":\"$1\",\"product_name\":\"x\",\"quantity\":$2,\"unit_price\":$3,\"discount_percentage\":${4:-0}}"; }
# sale <total> <discount> <tax> <final> <items json> [reference] [extra json fields]
sale(){ as cash "select record_till_sale('{\"business_id\":\"$B1\",\"total\":$1,\"discount\":$2,\"tax\":$3,\"final_total\":$4,\"payment_method\":\"Cash\",\"staff_name\":\"Carl\",\"staff_id\":\"$EMP\"${6:+,\"reference_id\":\"$6\"}${7:+,$7}}'::jsonb, '$5'::jsonb)"; }
stock(){ sql "select stock from products where id='$1'"; }
cash(){ sql "select coalesce(sum(balance),0) from money_assets where business_id='$B1' and method='Cash'"; }
count_ref(){ sql "select count(*) from transactions where business_id='$B1' and reference_id='$1'"; }
id_of(){ grep -oE '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' <<<"$1" | head -1; }

echo "--- a correct sale"
S0=$(stock $BR); C0=$(cash)
T=$(sale 100 0 0 100 "[$(item $BR 2 50)]" "st-ok-$$"); ID=$(id_of "$T"); ok "2 bread for 100.00 saved" "$T"
eq "stock down by 2" "$(python3 -c "print($S0-$(stock $BR))")" "2.0"
eq "cash up by 100.00" "$(python3 -c "print(f'{$(cash)-$C0:.2f}')")" "100.00"
eq "books balance for the sale" "$(sql "select sum(l.debit)-sum(l.credit) from acc_lines l join acc_entries e on e.id=l.entry_id where e.business_id='$B1' and e.source_id='$ID'")" "0.00"
eq "books income = 100.00" "$(sql "select sum(l.credit-l.debit) from acc_lines l join acc_entries e on e.id=l.entry_id join acc_accounts a on a.id=l.account_id where e.source_id='$ID' and a.type='income'")" "100.00"

echo "--- figures that don't match the items are refused, and nothing is saved"
S0=$(stock $BR); C0=$(cash); N0=$(sql "select count(*) from transactions where business_id='$B1'")
has "pays 1.00 for 100.00 of goods, no discount" "$(sale 100 0 0 1 "[$(item $BR 2 50)]")" "does not match the items"
has "total 5.00 but items 100.00" "$(sale 5 0 0 5 "[$(item $BR 2 50)]")" "does not match its items"
has "discount above the total" "$(sale 100 150 0 0 "[$(item $BR 2 50)]")" "more than the sale total"
has "pays more than the items" "$(sale 100 0 0 150 "[$(item $BR 2 50)]")" "does not match the items"
has "negative quantity" "$(sale -50 0 0 -50 "[$(item $BR -1 50)]")" "quantity above 0"
has "discount 150%" "$(sale 50 0 0 50 "[$(item $BR 1 50 150)]")" "discount from 0 to 100"
has "negative price" "$(sale -50 0 0 0 "[$(item $BR 1 -50)]")" "price of 0 or more"
has "empty cart" "$(sale 0 0 0 0 "[]")" "cart is empty"
eq "no stock moved by refused sales" "$(stock $BR)" "$S0"
eq "no cash moved by refused sales" "$(cash)" "$C0"
eq "no refused sale was saved" "$(sql "select count(*) from transactions where business_id='$B1'")" "$N0"

echo "--- real tills: discounts, VAT, rounding, deliveries"
ok "recorded discount: 99.00 off, pays 1.00" "$(sale 100 99 0 1 "[$(item $BR 2 50)]")"
ok "item discount 10% + VAT 16%" "$(sale 100 10 14.40 104.40 "[$(item $BR 2 50 10)]")"
ok "cent rounding: 3 x 33.33 at 7.5% off" "$(sale 99.99 7.50 0 92.49 "[$(item $M5 3 33.33 7.5)]")"
ok "1.5 quantity" "$(sale 75 0 0 75 "[$(item $BR 1.5 50)]")"
ok "charged delivery: fee 50.00 on top" "$(sale 100 0 0 150 "[$(item $BR 2 50)]" "" '"is_delivery":true,"delivery_fee":50,"delivery_mode":"charged"')"
ok "free delivery: fee not charged" "$(sale 100 0 0 100 "[$(item $BR 2 50)]" "" '"is_delivery":true,"delivery_fee":50,"delivery_mode":"free"')"
has "delivery can't add more than its fee" "$(sale 100 0 0 200 "[$(item $BR 2 50)]" "" '"is_delivery":true,"delivery_fee":50,"delivery_mode":"charged"')" "does not match the items"

echo "--- repeats never count twice"
REF="st-retry-$$"; S0=$(stock $BR); C0=$(cash)
A=$(sale 50 0 0 50 "[$(item $BR 1 50)]" "$REF"); B=$(sale 50 0 0 50 "[$(item $BR 1 50)]" "$REF")
eq "the repeat returns the same sale" "$(id_of "$B")" "$(id_of "$A")"
eq "one sale" "$(count_ref $REF)" "1"
eq "stock moved once" "$(python3 -c "print($S0-$(stock $BR))")" "1.0"
eq "cash moved once" "$(python3 -c "print(f'{$(cash)-$C0:.2f}')")" "50.00"

echo "--- a sale an older app saved without its items is completed by the retry"
REF="st-orphan-$$"; S0=$(stock $BR)
ORPHAN=$(as cash "insert into transactions (business_id,total,discount,tax,final_total,amount_paid,payment_method,staff_name,staff_id,status,reference_id) values ('$B1',50,0,0,50,50,'Cash','Carl','$EMP','Synced','$REF') returning id" | head -1)
eq "header alone moves no stock" "$(stock $BR)" "$S0"
eq "retry returns the old sale" "$(id_of "$(sale 50 0 0 50 "[$(item $BR 1 50)]" "$REF")")" "$(id_of "$ORPHAN")"
eq "its item is added" "$(sql "select count(*) from transaction_items where transaction_id='$(id_of "$ORPHAN")'")" "1"
eq "stock now moved once" "$(python3 -c "print($S0-$(stock $BR))")" "1.0"
sale 50 0 0 50 "[$(item $BR 1 50)]" "$REF" >/dev/null
eq "a further retry adds nothing" "$(sql "select count(*) from transaction_items where transaction_id='$(id_of "$ORPHAN")'")" "1"

echo "--- customer and credit sales (process_customer_transaction) get the same check"
AL=c1000000-0000-0000-0000-000000000000
credit(){ local ref=null; [ -n "${6:-}" ] && ref="'$6'"; as cash "select process_customer_transaction('$B1','$AL','Alice','$EMP','Carl',$1,$2,0,$3,$4,'${5:-Credit_Debt}',now(),null,false,0,null,$ref,'[$(item $BR 2 50)]'::jsonb,'charged',0,null)"; }
DEBT0=$(sql "select debt_balance from customers where id='$AL'"); S0=$(stock $BR)
has "credit sale books 1.00 for 100.00 of goods" "$(credit 100 0 1 0)" "does not match the items"
eq "  ...no debt added" "$(sql "select debt_balance from customers where id='$AL'")" "$DEBT0"
eq "  ...no stock moved" "$(stock $BR)" "$S0"
has "credit sale total 5.00 for items 100.00" "$(credit 5 0 5 0)" "does not match its items"
ok "correct credit sale saved" "$(credit 100 10 90 0 Credit_Debt "st-credit-$$")"
eq "  ...debt up by 90.00 (less any wallet)" "$(python3 -c "print(f'{$(sql "select debt_balance + 0 from customers where id='$AL'")-$DEBT0+$(sql "select wallet_applied from transactions where reference_id='st-credit-$$'"):.2f}')")" "90.00"
ok "correct paid customer sale saved" "$(credit 100 0 100 100 Cash)"

echo "--- two tills at once"
REF="st-race-$$"; S0=$(stock $BR)
for i in 1 2 3 4; do sale 50 0 0 50 "[$(item $BR 1 50)]" "$REF" >/dev/null & done; wait
eq "four tills sending the same sale: one sale" "$(count_ref $REF)" "1"
eq "  ...stock moved once" "$(python3 -c "print($S0-$(stock $BR))")" "1.0"
S0=$(stock $BR)
for i in $(seq 1 8); do sale 50 0 0 50 "[$(item $BR 1 50)]" "st-par-$$-$i" >/dev/null & done; wait
eq "eight different sales at once: all saved" "$(sql "select count(*) from transactions where reference_id like 'st-par-$$-%'")" "8"
eq "  ...stock down by exactly 8" "$(python3 -c "print($S0-$(stock $BR))")" "8.0"
eq "all books still balance" "$(sql "select count(*) from (select entry_id from acc_lines group by 1 having sum(debit)<>sum(credit)) x")" "0"

echo; echo "passed $PASS, failed $FAIL"; [ $FAIL -eq 0 ]
