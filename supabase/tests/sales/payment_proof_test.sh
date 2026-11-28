#!/bin/bash
# Money first (20261217001): an M-Pesa, Airtel or bank sale recorded by staff needs the payment's
# code before anything moves; a code pays one sale; a code already in the till queue is matched
# and must cover the sale; removing the sale gives the till payment back.
#   C=supabase_db_isms-seedtest bash supabase/tests/promotions/rebuild.sh
#   C=supabase_db_isms-seedtest bash supabase/tests/sales/payment_proof_test.sh
HERE=$(cd "$(dirname "$0")" && pwd)
source "$HERE/../promotions/lib.sh"
B1=b1000000-0000-0000-0000-000000000000; EMP=e2000000-0000-0000-0000-000000000000
BR=d3000000-0000-0000-0000-000000000000   # Bread, 50.00
item(){ echo "{\"product_id\":\"$1\",\"product_name\":\"x\",\"quantity\":$2,\"unit_price\":$3,\"discount_percentage\":0}"; }
# sale <method> <final> <qty of bread> [payment_ref]
sale(){ as cash "select record_till_sale('{\"business_id\":\"$B1\",\"total\":$2,\"discount\":0,\"tax\":0,\"final_total\":$2,\"payment_method\":\"$1\",\"staff_name\":\"Carl\",\"staff_id\":\"$EMP\"${4:+,\"payment_ref\":\"$4\"}}'::jsonb, '[$(item $BR $3 50)]'::jsonb)"; }
stock(){ sql "select stock from products where id='$BR'"; }
money(){ sql "select coalesce(sum(balance),0) from money_assets where business_id='$B1' and method='$1'"; }
sales(){ sql "select count(*) from transactions where business_id='$B1' and deleted_at is null"; }
id_of(){ grep -oE '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' <<<"$1" | head -1; }
R=$$

echo "--- no code, no sale: nothing moves"
S0=$(stock); M0=$(money M-Pesa); N0=$(sales)
has "M-Pesa without a code refused" "$(sale M-Pesa 50 1)" "Record the money first"
has "Airtel without a code refused" "$(sale 'Airtel Money' 50 1)" "Record the money first"
has "Bank without a code refused" "$(sale Bank 50 1)" "enter the bank code"
has "a made-up short code refused" "$(sale M-Pesa 50 1 'ab1')" "doesn't look right"
eq "stock unchanged" "$(stock)" "$S0"
eq "M-Pesa balance unchanged" "$(money M-Pesa)" "$M0"
eq "no sale saved" "$(sales)" "$N0"
has "direct insert of an M-Pesa sale without a code refused" "$(as cash "insert into transactions (business_id, total, final_total, amount_paid, payment_method, staff_name) values ('$B1', 50, 50, 50, 'M-Pesa', 'Carl')")" "Record the money first"

echo "--- cash needs no code"
ok "cash sale saved" "$(sale Cash 50 1)"

echo "--- with the code: money, stock and books move once"
S0=$(stock); M0=$(money M-Pesa)
T=$(sale M-Pesa 100 2 "qk${R}x 1"); ID=$(id_of "$T"); ok "M-Pesa sale with its code saved" "$T"
eq "code kept, tidied" "$(sql "select payment_ref from transactions where id='$ID'")" "QK${R}X1"
eq "stock down 2" "$(python3 -c "print($S0-$(stock))")" "2.0"
eq "M-Pesa balance up 100.00" "$(python3 -c "print(f'{$(money M-Pesa)-$M0:.2f}')")" "100.00"
eq "books balance" "$(sql "select sum(l.debit)-sum(l.credit) from acc_lines l join acc_entries e on e.id=l.entry_id where e.source_id='$ID'")" "0.00"
has "the same code can't pay a second sale" "$(sale M-Pesa 50 1 "QK${R}X1")" "already paid another sale"
has "the code can't be swapped later" "$(sql "update transactions set payment_ref='OTHER12345' where id='$ID'")" "can't be changed"

echo "--- a code already in the till queue is matched and must cover the sale"
TP=$(sql "insert into mpesa_till_payments (business_id, trans_id, amount, status) values ('$B1', 'TQ${R}AA', 100, 'unclaimed') returning id")
SMALL=$(sql "insert into mpesa_till_payments (business_id, trans_id, amount, status) values ('$B1', 'TS${R}BB', 40, 'unclaimed') returning id")
has "a 40.00 payment can't pay a 100.00 sale" "$(sale M-Pesa 100 2 "TS${R}BB")" "Take the rest another way"
eq "small payment still waiting" "$(sql "select status from mpesa_till_payments where id='$SMALL'")" "unclaimed"
T2=$(sale M-Pesa 100 2 "tq${R}aa"); ID2=$(id_of "$T2"); ok "sale paid by the queued payment" "$T2"
eq "till payment matched to the sale" "$(sql "select status||' '||sale_id from mpesa_till_payments where id='$TP'")" "matched_sale $ID2"
eq "allocation of 100.00" "$(sql "select amount from mpesa_till_allocations where till_payment_id='$TP' and reversed_at is null")" "100.00"

echo "--- removing the sale gives the payment back"
ok "sale removed" "$(sql "update transactions set deleted_at=now(), last_modified_by='Owner' where id='$ID2'")"
eq "till payment back in the queue" "$(sql "select status||' '||allocated from mpesa_till_payments where id='$TP'")" "unclaimed 0.00"
ok "the code can pay the sale recorded again" "$(sale M-Pesa 100 2 "TQ${R}AA")"

echo
echo "passed $PASS, failed $FAIL"
[ "$FAIL" = 0 ]
