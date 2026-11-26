#!/bin/bash
# Prompts settled from Safaricom's status query when the callback is lost, and the real receipt
# swapped in if the callback comes late (20261212008). Mocked Safaricom results.
#   C=supabase_db_isms-seedtest bash supabase/tests/payments/stk_query_settle_test.sh
HERE=$(cd "$(dirname "$0")" && pwd)
source "$HERE/../promotions/lib.sh"
B1=b1000000-0000-0000-0000-000000000000
R=$$
# What the edge functions do: store the prompt, then a callback or a status query settles it.
prompt(){ sql "insert into mpesa_transactions (business_id, checkout_request_id, merchant_request_id, phone, amount, requested_by)
               values ('$B1', '$1', 'm-$1', '254700000000', $2, 'Carl')" >/dev/null; }
callback(){ sql "select confirm_store_payment_request('$1', 0, $2, '$3', '{\"source\":\"callback\"}'::jsonb)"; }
query_paid(){ sql "select confirm_store_payment_request('$1', 0, $2, 'QRY-$1', '{\"source\":\"status_query\"}'::jsonb)"; }
cash(){ sql "select coalesce(sum(balance),0) from money_assets where business_id='$B1'"; }
pays(){ sql "select count(*) from payments where business_id='$B1'"; }
books(){ sql "select coalesce(sum(debit),0) = coalesce(sum(credit),0) from acc_lines l join acc_entries e on e.id=l.entry_id where e.business_id='$B1'"; }
ref_of(){ sql "select p.reference_code from payments p join mpesa_transactions m on m.payment_id=p.id where m.checkout_request_id='$1'"; }

M0=$(cash); P0=$(pays)

echo "--- callback lost: status query records the money"
prompt Q1-$R 1
has "query settles as paid" "$(query_paid Q1-$R 1)" "recorded"
eq "prompt completed with stand-in receipt" "$(sql "select status||':'||receipt_number from mpesa_transactions where checkout_request_id='Q1-$R'")" "Completed:QRY-Q1-$R"
eq "one payment added" "$(pays)" "$((P0+1))"
eq "money balance up by 1.00" "$(sql "select ($(cash) - $M0)::numeric(14,2)")" "1.00"
eq "books balance" "$(books)" "t"
eq "payment uses stand-in" "$(ref_of Q1-$R)" "QRY-Q1-$R"

echo "--- late callback brings the real receipt"
eq "receipt added" "$(callback Q1-$R 1 RCPT$R)" "receipt_added"
eq "prompt has real receipt" "$(sql "select receipt_number from mpesa_transactions where checkout_request_id='Q1-$R'")" "RCPT$R"
eq "payment has real receipt" "$(ref_of Q1-$R)" "RCPT$R"
eq "no second payment" "$(pays)" "$((P0+1))"
eq "money balance still up by 1.00" "$(sql "select ($(cash) - $M0)::numeric(14,2)")" "1.00"
eq "books balance" "$(books)" "t"
eq "callback again ignored" "$(callback Q1-$R 1 RCPT$R)" "duplicate"
eq "query after callback ignored" "$(query_paid Q1-$R 1)" "duplicate"

echo "--- callback first: the query later changes nothing"
prompt Q2-$R 2
has "callback records" "$(callback Q2-$R 2 RCPU$R)" "recorded"
eq "query ignored" "$(query_paid Q2-$R 2)" "duplicate"
eq "real receipt kept" "$(ref_of Q2-$R)" "RCPU$R"
eq "payments: two in all" "$(pays)" "$((P0+2))"

echo "--- query says failed, then the customer's success callback still records"
prompt Q3-$R 3
eq "query failed" "$(sql "select confirm_store_payment_request('Q3-$R', 1037, null, null, '{}'::jsonb)")" "failed"
has "late success recorded" "$(callback Q3-$R 3 RCPV$R)" "recorded"
eq "money balance up by 6.00 in all" "$(sql "select ($(cash) - $M0)::numeric(14,2)")" "6.00"
eq "books balance" "$(books)" "t"

echo "PASS=$PASS FAIL=$FAIL"
