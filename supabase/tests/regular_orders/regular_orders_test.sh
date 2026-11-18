#!/bin/bash
# Acceptance tests for 20261130005_regular_orders.sql (money rules in CLAUDE.md):
# delivering a regular order is one sale - stock down, books balanced, wallet/debt or money
# balance moved by the same amount - and removing that sale puts the day back.
#   C=supabase_db_isms-seedtest bash supabase/tests/promotions/rebuild.sh
#   C=supabase_db_isms-seedtest bash supabase/tests/regular_orders/regular_orders_test.sh
HERE=$(cd "$(dirname "$0")" && pwd)
source "$HERE/../promotions/lib.sh"
# This throwaway database has no vault, so new notifications print a push warning; hide it.
sql(){ docker exec -i $C psql -U supabase_admin -d $DB -tAq -v ON_ERROR_STOP=1 2>&1 <<<"SET client_min_messages = error;
$1"; }
B=b1000000-0000-0000-0000-000000000000
MILK=d1000000-0000-0000-0000-000000000000; BREAD=d3000000-0000-0000-0000-000000000000
ALICE=c1000000-0000-0000-0000-000000000000; BOB=c2000000-0000-0000-0000-000000000000; CAROL=c3000000-0000-0000-0000-000000000000
CUST_AUTH=a9000000-0000-0000-0000-000000000000
ascust(){ sql "SET request.jwt.claims = '{\"sub\":\"$CUST_AUTH\",\"role\":\"authenticated\"}'; SET role authenticated;
$1"; }
books(){ sql "select coalesce(sum(debit),0)-coalesce(sum(credit),0) from acc_lines where business_id='$B'"; }
stock(){ sql "select stock::numeric(14,3) from products where id='$1'"; }
debt(){ sql "select debt_balance::numeric(14,2) from customers where id='$1'"; }
cash(){ sql "select coalesce((select balance from money_assets where business_id='$B' and method='Cash'),0)::numeric(14,2)"; }
TODAY=$(sql "select fn_nairobi_today()")
WEEK="array[5,20,20,23,23,19,10]::numeric[]"   # every day has something, so today is due

# A customer with a website account linked to Bob.
sql "insert into auth.users (id, email, aud, role) values ('$CUST_AUTH','bob@c.test','authenticated','authenticated') on conflict do nothing;
     insert into customer_accounts (id, business_id, customer_id, name, phone) values ('$CUST_AUTH','$B','$BOB','Bob New','0711000002') on conflict do nothing;
     update products set show_on_website = true where business_id = '$B';" >/dev/null

echo "== staff set up"
R1=$(as cash "select save_regular_order('$B', null, '$BOB', '$MILK', $WEEK, 'delivery', 'Gate 4', null, null, null, 'active')"); ok "cashier sets Bob's milk" "$R1"
R2=$(as cash "select save_regular_order('$B', null, '$CAROL', '$MILK', $WEEK, 'pickup', null, null, null, null, 'active')"); ok "cashier sets Carol's milk" "$R2"
R3=$(as cash "select save_regular_order('$B', null, '$ALICE', '$BREAD', $WEEK, 'delivery', 'Shop 2', null, null, null, 'active')"); ok "cashier sets Alice's bread" "$R3"
has "same product twice refused" "$(as cash "select save_regular_order('$B', null, '$BOB', '$MILK', $WEEK, 'delivery', 'x', null, null, null, 'active')")" "already has a regular order"
has "rider can't set" "$(as rider "select save_regular_order('$B', null, '$BOB', '$BREAD', $WEEK, 'delivery', 'x', null, null, null, 'active')")" "does not allow"
TQ=$(sql "select (array[5,20,20,23,23,19,10])[extract(dow from fn_nairobi_today())::int+1]")
eq "today's line for Bob" "$(as cash "select l->>'quantity' from jsonb_array_elements(get_regular_orders('$B','$TODAY','$TODAY')->'lines') l where l->>'orderId'='$R1'")" "$TQ.0"
has "stock shown" "$(as cash "select get_regular_orders('$B','$TODAY','$TODAY')->'stock'")" "avgOther"

echo "== ring when not done"
sql "insert into regular_order_settings (business_id, ring_at) values ('$B','00:00') on conflict (business_id) do update set ring_at='00:00'" >/dev/null
sql "select ring_regular_orders()" >/dev/null
eq "rings once" "$(sql "select count(*) from notifications where business_id='$B' and type='Regular Order' and ring and accepted_at is null")" "1"
sql "select ring_regular_orders()" >/dev/null
eq "not twice" "$(sql "select count(*) from notifications where business_id='$B' and type='Regular Order' and ring")" "1"
has "cashier gets it" "$(as cash "select title from get_my_ringing_alerts('$B')")" "Regular orders not done"

echo "== delivered on account (wallet first, rest debt)"
sql "update customers set wallet_balance = 300 where id='$BOB'" >/dev/null
S0=$(stock $MILK); D0=$(debt $BOB); BK0=$(books)
TX=$(as cash "select deliver_regular_orders('$B', '$BOB', '$TODAY', jsonb_build_array(jsonb_build_object('orderId','$R1','quantity',$TQ)), 'Credit_Debt', 'Ray', 50, 'reg-test-1', null)")
ok "Bob delivered" "$TX"
TOTAL=$(sql "select final_total from transactions where id='$TX'")
eq "sale total = qty x price" "$TOTAL" "$(sql "select round($TQ*100,2)")"
eq "stock down by qty" "$(stock $MILK)" "$(sql "select ($S0 - $TQ)::numeric(14,3)")"
eq "debt up by total less wallet" "$(debt $BOB)" "$(sql "select ($D0 + greatest($TOTAL - 300, 0))::numeric(14,2)")"
eq "wallet used first" "$(sql "select wallet_balance::numeric(14,2) from customers where id='$BOB'")" "$(sql "select greatest(300 - $TOTAL, 0)::numeric(14,2)")"
eq "books balanced" "$(books)" "0.00"
eq "books: the sale and the rider's pay" "$(sql "select string_agg(source_type, ',' order by source_type) from acc_entries where business_id='$B' and source_id='$TX'")" "rider_pay,sale"
eq "delivery marked delivered" "$(sql "select delivery_status from transactions where id='$TX'")" "delivered"
eq "rider pay kept" "$(sql "select rider_pay from transactions where id='$TX'")" "50.00"
eq "repeat is the same sale" "$(as cash "select deliver_regular_orders('$B', '$BOB', '$TODAY', jsonb_build_array(jsonb_build_object('orderId','$R1','quantity',$TQ)), 'Credit_Debt', null, 0, 'reg-test-1', null)")" "$TX"
has "second sale same day refused" "$(as cash "select deliver_regular_orders('$B', '$BOB', '$TODAY', jsonb_build_array(jsonb_build_object('orderId','$R1','quantity',1)), 'Cash', null, 0, 'reg-test-2', null)")" "Already marked delivered"
has "future day refused" "$(as cash "select deliver_regular_orders('$B', '$BOB', '$TODAY'::date + 1, jsonb_build_array(jsonb_build_object('orderId','$R1','quantity',1)), 'Cash', null, 0, 'reg-test-3', null)")" "today or an earlier day"
has "delivered day can't be changed" "$(as cash "select set_regular_order_day('$B', array['$R1']::uuid[], '$TODAY', 'skip', null, null)")" "Already delivered"
eq "still ringing (others left)" "$(sql "select count(*) from notifications where business_id='$B' and type='Regular Order' and ring and accepted_at is null")" "1"

echo "== skip with message, paid in cash"
J=$(as cash "select set_regular_order_day('$B', array['$R3']::uuid[], '$TODAY', 'skip', null, 'Sorry, no bread today. We deliver tomorrow.')")
has "skip returns phone for WhatsApp" "$J" "711000001"
eq "Alice skipped" "$(as cash "select l->>'state' from jsonb_array_elements(get_regular_orders('$B','$TODAY','$TODAY')->'lines') l where l->>'orderId'='$R3'")" "skipped"
C0=$(cash); S1=$(stock $MILK)
TX2=$(as cash "select deliver_regular_orders('$B', '$CAROL', '$TODAY', jsonb_build_array(jsonb_build_object('orderId','$R2','quantity',2)), 'Cash', null, 0, 'reg-test-4', null)")
ok "Carol paid cash" "$TX2"
eq "cash balance up by the sale" "$(cash)" "$(sql "select ($C0 + 200)::numeric(14,2)")"
eq "stock down 2" "$(stock $MILK)" "$(sql "select ($S1 - 2)::numeric(14,3)")"
eq "pickup is not a delivery" "$(sql "select is_delivery from transactions where id='$TX2'")" "f"
eq "books balanced" "$(books)" "0.00"
eq "all done: ringing stops" "$(sql "select count(*) from notifications where business_id='$B' and type='Regular Order' and ring and accepted_at is null")" "0"

echo "== a full refund puts the day back"
S2=$(stock $MILK)
CN=$(as owner "select create_credit_note('$B', jsonb_build_object('transactionId','$TX','settlement','wallet','reason','Not delivered after all','returnStock',true,'lines',(select jsonb_agg(jsonb_build_object('transactionItemId',id,'quantity',quantity)) from transaction_items where transaction_id='$TX')))")
ok "owner refunds Bob's sale" "$CN"
eq "Bob due again" "$(as cash "select l->>'state' from jsonb_array_elements(get_regular_orders('$B','$TODAY','$TODAY')->'lines') l where l->>'orderId'='$R1'")" "due"
eq "stock back" "$(stock $MILK)" "$(sql "select ($S2 + $TQ)::numeric(14,3)")"
eq "refund clears the debt it made" "$(debt $BOB)" "$D0"
eq "and gives back the wallet used" "$(sql "select wallet_balance::numeric(14,2) from customers where id='$BOB'")" "300.00"
eq "books balanced after refund" "$(books)" "0.00"
TX3=$(as cash "select deliver_regular_orders('$B', '$BOB', '$TODAY', jsonb_build_array(jsonb_build_object('orderId','$R1','quantity',$TQ)), 'M-Pesa', null, 0, 'reg-test-5', null)")
ok "can deliver again after removal" "$TX3"
eq "books balanced" "$(books)" "0.00"

echo "== one-day change"
TOM=$(sql "select fn_nairobi_today() + 1")
ok "change tomorrow to 7" "$(as cash "select set_regular_order_day('$B', array['$R2']::uuid[], '$TOM', 'change', 7, null)")"
eq "tomorrow is 7" "$(as cash "select l->>'quantity' from jsonb_array_elements(get_regular_orders('$B','$TOM','$TOM')->'lines') l where l->>'orderId'='$R2'")" "7.0"
ok "reset" "$(as cash "select set_regular_order_day('$B', array['$R2']::uuid[], '$TOM', 'reset', null, null)")"

echo "== customer asks, owner confirms"
REQ=$(ascust "select request_regular_order(null, '$BREAD', array[0,2,2,2,2,2,0]::numeric[], 'delivery', 'Gate 4', 'Please ring the bell')")
ok "customer requests bread" "$REQ"
has "staff told" "$(sql "select title from notifications where business_id='$B' and type='Regular Order' and payload->>'regularOrderId'='$REQ'")" "Regular order request"
eq "request not in today's lines" "$(as cash "select count(*) from jsonb_array_elements(get_regular_orders('$B','$TODAY','$TODAY')->'lines') l where l->>'orderId'='$REQ'")" "0"
has "cashier can't approve" "$(as cash "select decide_regular_order('$B', '$REQ', true, null)")" "does not allow"
has "cashier can't edit a request" "$(as cash "select save_regular_order('$B', '$REQ', '$BOB', '$BREAD', array[0,2,2,2,2,2,0]::numeric[], 'delivery', 'x', null, null, null, 'active')")" "needs approval"
ok "manager approves" "$(as mgr "select decide_regular_order('$B', '$REQ', true, null)")"
eq "now running" "$(sql "select status from regular_orders where id='$REQ'")" "active"
has "customer told" "$(sql "select body from customer_messages where account_id='$CUST_AUTH' order by created_at desc limit 1")" "confirmed"
ok "customer changes milk" "$(ascust "select request_regular_order('$R1', null, array[0,30,30,30,30,30,0]::numeric[], 'delivery', 'Gate 4', null)")"
eq "old quantity still runs" "$(sql "select day_qty[2] from regular_orders where id='$R1'")" "20.0"
has "customer sees it waiting" "$(ascust "select get_my_regular_orders()->'orders'")" "pendingDayQty\": [0.0, 30.0"
ok "owner approves change" "$(as owner "select decide_regular_order('$B', '$R1', true, null)")"
eq "new quantity runs" "$(sql "select day_qty[2] from regular_orders where id='$R1'")" "30.0"
ok "customer asks to stop" "$(ascust "select request_regular_order('$REQ', null, array[0,0,0,0,0,0,0]::numeric[], 'delivery', 'Gate 4', null)")"
ok "manager approves stop" "$(as mgr "select decide_regular_order('$B', '$REQ', true, null)")"
eq "stopped" "$(sql "select status from regular_orders where id='$REQ'")" "ended"
has "customer sees skip message" "$(sql "select count(*) from customer_messages where account_id='$CUST_AUTH'")" ""
has "other customers can't touch Bob's" "$(sql "SET request.jwt.claims = '{\"sub\":\"a2000000-0000-0000-0000-000000000000\",\"role\":\"authenticated\"}'; SET role authenticated; select withdraw_my_regular_order_request('$R1')")" "ERROR"
has "no direct table access" "$(as cash "select count(*) from regular_orders")" "permission denied"

echo "== tomorrow short notice"
sql "update products set stock = 1 where id='$MILK'; delete from notifications where payload->>'kind'='short'" >/dev/null
sql "select ring_regular_orders()" >/dev/null
has "short notice" "$(sql "select message from notifications where business_id='$B' and payload->>'kind'='short'")" "Milk 1L: need about"

echo; echo "$PASS passed, $FAIL failed"; [ $FAIL -eq 0 ]
