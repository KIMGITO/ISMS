#!/bin/bash
# Daraja callbacks are stored before they are processed, retried when they fail or beat their
# prompt row, kept once per CheckoutRequestID/TransID, and the callback token survives a
# disconnect (20261215001). Payloads follow Safaricom's documented STK and C2B shapes; these are
# simulated callbacks, not ones Safaricom sent.
#   C=supabase_db_isms-seedtest bash supabase/tests/payments/daraja_callback_inbox_test.sh
HERE=$(cd "$(dirname "$0")" && pwd)
source "$HERE/../promotions/lib.sh"
B1=b1000000-0000-0000-0000-000000000000
B2=b2000000-0000-0000-0000-000000000000
R=$$

stk_payload(){ # checkout code amount receipt
  if [ "$2" = "0" ]; then
    echo "{\"Body\":{\"stkCallback\":{\"MerchantRequestID\":\"m-$1\",\"CheckoutRequestID\":\"$1\",\"ResultCode\":0,\"ResultDesc\":\"The service request is processed successfully.\",\"CallbackMetadata\":{\"Item\":[{\"Name\":\"Amount\",\"Value\":$3},{\"Name\":\"MpesaReceiptNumber\",\"Value\":\"$4\"},{\"Name\":\"Balance\"},{\"Name\":\"TransactionDate\",\"Value\":20261128101500},{\"Name\":\"PhoneNumber\",\"Value\":254708374149}]}}}}"
  else
    echo "{\"Body\":{\"stkCallback\":{\"MerchantRequestID\":\"m-$1\",\"CheckoutRequestID\":\"$1\",\"ResultCode\":$2,\"ResultDesc\":\"Request cancelled by user\"}}}"
  fi
}
c2b_payload(){ # transid amount billref
  echo "{\"TransactionType\":\"Pay Bill\",\"TransID\":\"$1\",\"TransTime\":\"20261128101500\",\"TransAmount\":\"$2\",\"BusinessShortCode\":\"600999\",\"BillRefNumber\":\"$3\",\"InvoiceNumber\":\"\",\"OrgAccountBalance\":\"\",\"ThirdPartyTransID\":\"\",\"MSISDN\":\"2547 ***  149\",\"FirstName\":\"John\",\"MiddleName\":\"\",\"LastName\":\"Doe\"}"
}
receive(){ sql "select daraja_callback_receive('$1', '$2', '$3'::jsonb)"; }
inbox_id(){ sql "select id from daraja_callbacks where kind='$1' and dedupe_key='$2'"; }
process(){ sql "select daraja_callback_process('$1')"; }
field(){ sql "select $3 from daraja_callbacks where kind='$1' and dedupe_key='$2'"; }
prompt(){ sql "insert into mpesa_transactions (business_id, checkout_request_id, merchant_request_id, phone, amount, requested_by)
               values ('$B1', '$1', 'm-$1', '254708374149', $2, 'Carl')" >/dev/null; }
cash(){ sql "select coalesce(sum(balance),0) from money_assets where business_id='$B1'"; }
pays(){ sql "select count(*) from payments where business_id='$B1'"; }
books(){ sql "select coalesce(sum(debit),0) = coalesce(sum(credit),0) from acc_lines l join acc_entries e on e.id=l.entry_id where e.business_id='$B1'"; }
due_now(){ sql "update daraja_callbacks set next_try_at = now() - interval '1 second' where kind='$1' and dedupe_key='$2'" >/dev/null; }

echo "--- callback token survives disconnect and reconnect"
sql "delete from mpesa_payment_secrets where business_id='$B1'" >/dev/null
sql "insert into mpesa_payment_secrets (business_id, consumer_key, consumer_secret, passkey, shortcode)
     values ('$B1', 'consumerkey1', 'consumersecret1', 'passkey12345', '174379')" >/dev/null
T1=$(sql "select callback_token from mpesa_payment_secrets where business_id='$B1'")
eq "token stored separately" "$(sql "select token from mpesa_callback_tokens where business_id='$B1'")" "$T1"
eq "token names the business" "$(sql "select fn_mpesa_business_by_token('$T1')")" "$B1"
sql "delete from mpesa_payment_secrets where business_id='$B1'" >/dev/null
eq "still names the business while disconnected" "$(sql "select fn_mpesa_business_by_token('$T1')")" "$B1"
sql "insert into mpesa_payment_secrets (business_id, consumer_key, consumer_secret, passkey, shortcode)
     values ('$B1', 'consumerkey2', 'consumersecret2', 'passkey67890', '174379')" >/dev/null
eq "reconnect keeps the same token" "$(sql "select callback_token from mpesa_payment_secrets where business_id='$B1'")" "$T1"
eq "bad token names nobody" "$(sql "select coalesce(fn_mpesa_business_by_token('zz'||repeat('0',46))::text,'none')")" "none"
ok "authenticated can't read tokens" "$(as owner "select count(*) from mpesa_callback_tokens" 2>&1 | grep -q 'permission denied' && echo ok || echo ERROR)"
ok "authenticated can't read inbox" "$(as owner "select count(*) from daraja_callbacks" 2>&1 | grep -q 'permission denied' && echo ok || echo ERROR)"

M0=$(cash); P0=$(pays)

echo "--- STK success callback arrives before its prompt row"
has "stored" "$(receive stk $B1 "$(stk_payload EARLY-$R 0 1.00 RCE$R)")" '"duplicate": false'
I=$(inbox_id stk EARLY-$R)
eq "no prompt yet: unmatched, kept" "$(process $I)" "unknown"
eq "status unmatched" "$(field stk EARLY-$R status)" "unmatched"
prompt EARLY-$R 1
# Earlier runs leave failed rows that fall due, so look at this run's row, not the whole result.
sql "select daraja_callback_retry(50)" >/dev/null
eq "retry not due yet leaves it unmatched" "$(field stk EARLY-$R status):$(sql "select status from mpesa_transactions where checkout_request_id='EARLY-$R'")" "unmatched:Pending"
due_now stk EARLY-$R
has "retry records it" "$(sql "select daraja_callback_retry(50)")" '"recorded": 1'
eq "inbox processed" "$(field stk EARLY-$R status):$(field stk EARLY-$R result)" "processed:recorded"
eq "prompt completed with real receipt" "$(sql "select status||':'||receipt_number from mpesa_transactions where checkout_request_id='EARLY-$R'")" "Completed:RCE$R"
eq "one payment added" "$(pays)" "$((P0+1))"
eq "money balance up by 1.00" "$(sql "select ($(cash) - $M0)::numeric(14,2)")" "1.00"
eq "books balance" "$(books)" "t"

echo "--- the same callback delivered again"
has "second delivery is a duplicate" "$(receive stk $B1 "$(stk_payload EARLY-$R 0 1.00 RCE$R)")" '"duplicate": true'
eq "deliveries counted" "$(field stk EARLY-$R deliveries)" "2"
eq "processing again changes nothing" "$(process $I)" "recorded"
eq "still one payment" "$(pays)" "$((P0+1))"

echo "--- STK failed callback (cancelled)"
prompt FAIL-$R 5
receive stk $B1 "$(stk_payload FAIL-$R 1032)" >/dev/null
eq "failed result recorded" "$(process "$(inbox_id stk FAIL-$R)")" "failed"
eq "prompt failed" "$(sql "select status from mpesa_transactions where checkout_request_id='FAIL-$R'")" "Failed"
eq "no payment for a failure" "$(pays)" "$((P0+1))"

echo "--- malformed and wrong-business callbacks"
has "no CheckoutRequestID is rejected but kept" "$(receive stk $B1 '{"Body":{}}')" '"status": "rejected"'
prompt OTHER-$R 2
receive stk $B2 "$(stk_payload OTHER-$R 0 2.00 RCO$R)" >/dev/null
eq "another business's token can't settle it" "$(process "$(inbox_id stk OTHER-$R)")" "wrong_business"
eq "prompt untouched" "$(sql "select status from mpesa_transactions where checkout_request_id='OTHER-$R'")" "Pending"

echo "--- C2B confirmation and duplicate"
receive c2b_confirmation $B1 "$(c2b_payload TC$R 10.00 NOSUCHREF)" >/dev/null
has "queued for staff" "$(process "$(inbox_id c2b_confirmation TC$R)")" "queued"
eq "till payment saved" "$(sql "select amount||':'||payer_name from mpesa_till_payments where trans_id='TC$R'")" "10.00:John Doe"
has "duplicate confirmation" "$(receive c2b_confirmation $B1 "$(c2b_payload TC$R 10.00 NOSUCHREF)")" '"duplicate": true'
eq "one till payment" "$(sql "select count(*) from mpesa_till_payments where trans_id='TC$R'")" "1"

echo "--- C2B processing error is kept and retried, not lost"
receive c2b_confirmation $B1 "{\"TransID\":\"TB$R\",\"TransAmount\":\"\"}" >/dev/null
has "processing fails" "$(process "$(inbox_id c2b_confirmation TB$R)")" "failed"
has "error kept" "$(field c2b_confirmation TB$R error)" "missing TransID or TransAmount"
eq "payload kept" "$(field c2b_confirmation TB$R "payload->>'TransID'")" "TB$R"
eq "retry scheduled later" "$(field c2b_confirmation TB$R "next_try_at > now()")" "t"

echo "--- C2B validation"
receive c2b_validation $B1 "$(c2b_payload TV$R 3.00 X)" >/dev/null
eq "validation accepted" "$(process "$(inbox_id c2b_validation TV$R)")" "accepted"
eq "validation moves no money" "$(sql "select count(*) from mpesa_till_payments where trans_id='TV$R'")" "0"

echo "--- online order: status query first, real receipt from the late callback"
ORD=$(sql "insert into online_orders (business_id, customer_name, customer_phone, fulfilment, subtotal, total, status)
           values ('$B1', 'Web Buyer', '0708374149', 'pickup', 100, 100, 'pending_payment') returning id" | head -1)
sql "insert into mpesa_transactions (business_id, online_order_id, checkout_request_id, merchant_request_id, phone, amount)
     values ('$B1', '$ORD', 'ORD-$R', 'm-ORD-$R', '254708374149', 100)" >/dev/null
has "query settles the order" "$(sql "select confirm_online_order_payment('ORD-$R', 0, 100, 'QRY-ORD-$R', '{}'::jsonb)")" "paid"
receive stk $B1 "$(stk_payload ORD-$R 0 100.00 RCORD$R)" >/dev/null
eq "late callback adds the receipt" "$(process "$(inbox_id stk ORD-$R)")" "receipt_added"
eq "order shows real receipt" "$(sql "select mpesa_receipt from online_orders where id='$ORD'")" "RCORD$R"
eq "prompt shows real receipt" "$(sql "select receipt_number from mpesa_transactions where checkout_request_id='ORD-$R'")" "RCORD$R"
eq "one sale for the order" "$(sql "select count(*) from transactions where reference_id='online-$ORD'")" "1"
eq "books balance" "$(books)" "t"

echo "--- retries stop after 3 days"
sql "insert into daraja_callbacks (business_id, kind, dedupe_key, payload, status, error, received_at, next_try_at)
     values ('$B1', 'stk', 'OLD-$R', '{}', 'failed', 'boom', now() - interval '4 days', now() - interval '1 day')" >/dev/null
sql "select daraja_callback_retry(10)" >/dev/null
eq "old row given up" "$(field stk OLD-$R status)" "rejected"
has "last error kept" "$(field stk OLD-$R error)" "Gave up after 3 days. boom"

echo "PASS=$PASS FAIL=$FAIL"
[ "$FAIL" = 0 ]
