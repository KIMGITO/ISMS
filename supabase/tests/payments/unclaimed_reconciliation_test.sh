#!/bin/bash
# Unclaimed Payments reconciliation (20261213001): partial and split allocations, flags,
# history, concurrency, no deletes. Mocked Daraja bodies.
#   C=supabase_db_isms-seedtest bash supabase/tests/payments/unclaimed_reconciliation_test.sh
HERE=$(cd "$(dirname "$0")" && pwd)
source "$HERE/../promotions/lib.sh"
B1=b1000000-0000-0000-0000-000000000000; EMP=e2000000-0000-0000-0000-000000000000
BR=d3000000-0000-0000-0000-000000000000
R=$$
item(){ echo "[{\"product_id\":\"$BR\",\"product_name\":\"x\",\"quantity\":$1,\"unit_price\":50,\"discount_percentage\":0}]"; }
msale(){ as cash "select record_till_sale('{\"business_id\":\"$B1\",\"total\":$1,\"discount\":0,\"tax\":0,\"final_total\":$1,\"payment_method\":\"M-Pesa\",\"staff_name\":\"Carl\",\"staff_id\":\"$EMP\",\"reference_id\":\"$2\",\"payment_ref\":\"PR-$2\"}'::jsonb, '$(item $3)'::jsonb)"; }
c2b(){ sql "select record_till_payment('{\"TransID\":\"$1\",\"TransAmount\":\"$2\",\"BusinessShortCode\":\"600000\",\"BillRefNumber\":\"\",\"MSISDN\":\"254711000$R\",\"FirstName\":\"Jane\",\"TransTime\":\"$(TZ=Africa/Nairobi date +%Y%m%d%H%M%S)\"}'::jsonb, '$B1')"; }
tp(){ sql "select id from mpesa_till_payments where trans_id='$1'"; }
st(){ sql "select status||':'||allocated from mpesa_till_payments where trans_id='$1'"; }
id_of(){ grep -oE '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' <<<"$1" | head -1; }
cash(){ sql "select coalesce(sum(balance),0) from money_assets where business_id='$B1'"; }
books(){ sql "select coalesce(sum(debit),0) = coalesce(sum(credit),0) from acc_lines l join acc_entries e on e.id=l.entry_id where e.business_id='$B1'"; }
alloc(){ as cash "select allocate_till_payment('$(tp $1)', '$2', $3, 'Carl')"; }

S1=$(id_of "$(msale 100 TXN-UA$R 2)"); S2=$(id_of "$(msale 150 TXN-UB$R 3)"); S3=$(id_of "$(msale 100 TXN-UC$R 2)")
M0=$(cash); P0=$(sql "select count(*) from payments where business_id='$B1'")

echo "--- arrival and duplicate"
has "C2B with no sale waits" "$(c2b UP1$R 200)" "queued"
eq "duplicate callback ignored" "$(c2b UP1$R 200)" "duplicate"
eq "one row, one received event" "$(sql "select count(*) from mpesa_till_payment_events where trans_id='UP1$R' and action='received'")" "1"

echo "--- one payment split over two sales"
has "suggestions carry reasons" "$(as cash "select reasons::text from till_payment_sale_candidates('$(tp UP1$R)', 'UA$R')")" "{"
has "over the sale's balance refused" "$(alloc UP1$R $S1 150)" "only needs KSh 100.00"
has "partial to sale A" "$(alloc UP1$R $S1 100)" "\"status\": \"partial\""
eq "partial, 100 given" "$(st UP1$R)" "partial:100.00"
has "more than is left refused" "$(alloc UP1$R $S2 150)" "Only KSh 100.00"
has "rest to sale B" "$(alloc UP1$R $S2 100)" "matched_sale"
eq "fully claimed" "$(st UP1$R)" "matched_sale:200.00"
eq "two allocations" "$(sql "select count(*) from mpesa_till_allocations where till_payment_id='$(tp UP1$R)' and reversed_at is null")" "2"
has "nothing left to give" "$(alloc UP1$R $S2 10)" "already handled"

echo "--- several payments for one sale (B has 50 left)"
c2b UP2$R 30 >/dev/null; c2b UP3$R 30 >/dev/null
has "first 30" "$(alloc UP2$R $S2 30)" "matched_sale"
has "second refused above room" "$(alloc UP3$R $S2 30)" "only needs KSh 20.00"
has "second 20 partial" "$(alloc UP3$R $S2 20)" "partial"

echo "--- concurrent allocation of the same money"
c2b UP4$R 100 >/dev/null; ID4=$(tp UP4$R)
as cash "select allocate_till_payment('$ID4', '$S3', 100, 'Carl')" >/dev/null &
as cash "select allocate_till_payment('$ID4', '$S3', 100, 'Carl')" >/dev/null
wait
eq "exactly one allocation won" "$(sql "select count(*) from mpesa_till_allocations where till_payment_id='$ID4'")" "1"
eq "sale C not over its total" "$(sql "select fn_sale_till_linked('$S3')")" "100.00"

echo "--- flags, dispute, reversal, history"
c2b UP5$R 80 >/dev/null
has "flag needs a reason" "$(as cash "select flag_till_payment('$(tp UP5$R)', 'disputed', '', 'Carl')")" "Say why"
ok "under review" "$(as cash "select flag_till_payment('$(tp UP5$R)', 'under_review', 'Checking statement', 'Carl')")"
ok "disputed" "$(as cash "select flag_till_payment('$(tp UP5$R)', 'disputed', 'Customer says not theirs', 'Carl')")"
has "disputed can't be allocated" "$(alloc UP5$R $S1 10)" "already handled"
ok "cleared" "$(as cash "select flag_till_payment('$(tp UP5$R)', 'unclaimed', 'Statement checked', 'Carl')")"
ok "reversed" "$(as cash "select flag_till_payment('$(tp UP5$R)', 'reversed', 'Safaricom reversal', 'Carl')")"
eq "history in order" "$(sql "select string_agg(coalesce(new_status,''), '>' order by id) from mpesa_till_payment_events where trans_id='UP5$R'")" "unclaimed>under_review>disputed>unclaimed>reversed"
eq "history names staff" "$(sql "select count(*) from mpesa_till_payment_events where trans_id='UP5$R' and staff_name='Carl'")" "4"

echo "--- reassignment: back to queue reverses allocations, keeps them"
ok "reopen UP2" "$(as cash "select handle_till_payment('$(tp UP2$R)', 'reopen', null, 'Wrong sale', 'Carl')")"
eq "unclaimed, nothing given" "$(st UP2$R)" "unclaimed:0.00"
eq "old allocation kept as reversed" "$(sql "select count(*) from mpesa_till_allocations where till_payment_id='$(tp UP2$R)' and reversed_at is not null")" "1"
has "re-allocate to sale B" "$(alloc UP2$R $S2 30)" "matched_sale"

echo "--- linking moves no money; the rest to a customer moves only the rest"
eq "no payments rows from allocations" "$(sql "select count(*) from payments where business_id='$B1'")" "$P0"
eq "money unchanged" "$(cash)" "$M0"
CU=$(sql "select id from customers where business_id='$B1' and deleted_at is null limit 1")
ok "UP3's last 10 to a customer" "$(as cash "select handle_till_payment('$(tp UP3$R)', 'customer', '$CU', null, 'Carl')")"
eq "payment is 10.00" "$(sql "select amount from payments where reference_code='UP3$R'")" "10.00"
eq "money up by 10.00" "$(sql "select ($(cash) - $M0)::numeric(14,2)")" "10.00"
eq "books balance" "$(books)" "t"

echo "--- integrity and access"
has "never deleted" "$(sql "delete from mpesa_till_payments where trans_id='UP1$R'")" "never deleted"
has "amount immutable" "$(sql "update mpesa_till_payments set amount=1 where trans_id='UP1$R'")" "cannot be changed"
has "history append-only" "$(sql "delete from mpesa_till_payment_events where trans_id='UP1$R'")" "cannot be changed"
has "rider cannot allocate" "$(as rider "select allocate_till_payment('$(tp UP4$R)', '$S1', 1, 'R')")" "ERROR"
has "rider cannot flag" "$(as rider "select flag_till_payment('$(tp UP4$R)', 'disputed', 'x', 'R')")" "ERROR"
eq "rider sees no allocations" "$(as rider "select count(*) from mpesa_till_allocations")" "0"
has "cashier sees allocations" "$(as cash "select count(*) > 0 from mpesa_till_allocations")" "t"

echo "--- STK exception: paid prompt whose sale is already covered"
sql "insert into mpesa_transactions (business_id, checkout_request_id, merchant_request_id, phone, amount, transaction_id, requested_by) values ('$B1','UX$R','m-UX$R','254700000000',5,'$S1','Carl')" >/dev/null
has "recorded as a payment" "$(sql "select confirm_store_payment_request('UX$R', 0, 5, 'RX$R', '{}'::jsonb)")" "recorded"
has "listed as exception" "$(as cash "select receipt_number from stk_payment_exceptions('$B1')")" "RX$R"
ok "resolve" "$(as cash "select resolve_stk_exception((select id from mpesa_transactions where checkout_request_id='UX$R'), 'Refunded customer', 'Carl')")"
eq "no longer listed" "$(as cash "select count(*) from stk_payment_exceptions('$B1') where receipt_number='RX$R'")" "0"
eq "books balance" "$(books)" "t"
echo "PASS=$PASS FAIL=$FAIL"
