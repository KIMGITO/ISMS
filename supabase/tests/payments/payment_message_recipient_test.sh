#!/bin/bash
# "M-Pesa payment received" goes only to the person who made the sale (or sent the prompt),
# and only once the money is confirmed (20261214002).
#   C=supabase_db_isms-seedtest bash supabase/tests/payments/payment_message_recipient_test.sh
HERE=$(cd "$(dirname "$0")" && pwd)
source "$HERE/../promotions/lib.sh"
B1=b1000000-0000-0000-0000-000000000000; EMP=e2000000-0000-0000-0000-000000000000
BR=d3000000-0000-0000-0000-000000000000   # Bread, 50.00
CARL=00000000-0000-0000-0000-0000000000a2; OLIVE=00000000-0000-0000-0000-0000000000a0
R=$$
item(){ echo "[{\"product_id\":\"$BR\",\"product_name\":\"x\",\"quantity\":2,\"unit_price\":50,\"discount_percentage\":0}]"; }
sale(){ as cash "select record_till_sale('{\"business_id\":\"$B1\",\"total\":100,\"discount\":0,\"tax\":0,\"final_total\":100,\"payment_method\":\"M-Pesa\",\"staff_name\":\"Carl\",\"staff_id\":\"$EMP\",\"reference_id\":\"$1\"}'::jsonb, '$(item)'::jsonb)"; }
id_of(){ grep -oE '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' <<<"$1" | head -1; }
c2b(){ sql "select record_till_payment('{\"TransID\":\"$1\",\"TransAmount\":\"100\",\"BusinessShortCode\":\"600000\",\"BillRefNumber\":\"$2\",\"MSISDN\":\"254711000000\",\"FirstName\":\"Jane\",\"TransTime\":\"$(TZ=Africa/Nairobi date +%Y%m%d%H%M%S)\"}'::jsonb, '$B1')"; }
# Who got a "payment received" message mentioning $1 (user ids, or "everyone" for a team message).
to(){ sql "select coalesce(string_agg(coalesce(user_id::text,'everyone'), ',' order by user_id), 'nobody')
           from notifications where business_id='$B1' and title='M-Pesa payment received' and message like '%$1%'"; }

S1=$(id_of "$(sale TXN-A$R)"); S2=$(id_of "$(sale TXN-B$R)"); S3=$(id_of "$(sale TXN-C$R)")

echo "--- a sale alone sends nothing"
eq "no message for unpaid M-Pesa sale" "$(to TXN-A$R)" "nobody"

echo "--- STK prompt for a sale"
sql "insert into mpesa_transactions (business_id, checkout_request_id, merchant_request_id, phone, amount, transaction_id, requested_by)
     values ('$B1', 'MR1-$R', 'm1', '254700000000', 100, '$S1', 'Carl')" >/dev/null
eq "still nothing while waiting" "$(to TXN-A$R)" "nobody"
sql "select confirm_store_payment_request('MR1-$R', 1032, null, null, '{}'::jsonb)" >/dev/null
eq "nothing when the customer cancels" "$(to TXN-A$R)" "nobody"
sql "insert into mpesa_transactions (business_id, checkout_request_id, merchant_request_id, phone, amount, transaction_id, requested_by)
     values ('$B1', 'MR2-$R', 'm2', '254700000000', 100, '$S1', 'Carl')" >/dev/null
has "paid" "$(sql "select confirm_store_payment_request('MR2-$R', 0, 100, 'MRA$R', '{}'::jsonb)")" "matched_sale"
eq "only the sale maker told" "$(to TXN-A$R)" "$CARL"

echo "--- till payment carrying the receipt number"
has "matched by receipt" "$(c2b MRB$R TXN-B$R)" "matched_sale"
eq "only the sale maker told" "$(to TXN-B$R)" "$CARL"

echo "--- staff match a waiting till payment"
has "queued" "$(c2b MRC$R '')" "queued"
eq "nothing yet for the sale" "$(to TXN-C$R)" "nobody"
TP=$(sql "select id from mpesa_till_payments where trans_id='MRC$R'")
as owner "select allocate_till_payment('$TP', '$S3', 100, 'Olive')" >/dev/null
eq "only the sale maker told (not the owner who matched)" "$(to TXN-C$R)" "$CARL"

echo "--- prompt not tied to a sale"
sql "insert into mpesa_transactions (business_id, checkout_request_id, merchant_request_id, phone, amount, requested_by, requested_user_id)
     values ('$B1', 'MR3-$R', 'm3', '254700000000', 50, 'Olive', '$OLIVE')" >/dev/null
has "recorded" "$(sql "select confirm_store_payment_request('MR3-$R', 0, 50, 'MRD$R', '{}'::jsonb)")" "recorded"
eq "only the sender told" "$(to MRD$R)" "$OLIVE"
sql "insert into mpesa_transactions (business_id, checkout_request_id, merchant_request_id, phone, amount, requested_by)
     values ('$B1', 'MR4-$R', 'm4', '254700000000', 50, 'Old')" >/dev/null
sql "select confirm_store_payment_request('MR4-$R', 0, 50, 'MRE$R', '{}'::jsonb)" >/dev/null
eq "old prompt without a sender tells nobody" "$(to MRE$R)" "nobody"

echo "--- the cashier sees it, the owner does not"
eq "cashier sees sale A message" "$(as cash "select count(*) from notifications where message like '%TXN-A$R%'")" "1"
eq "owner does not" "$(as owner "select count(*) from notifications where message like '%TXN-A$R%'")" "0"

echo "PASS=$PASS FAIL=$FAIL"
