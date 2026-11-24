#!/bin/bash
# How long records are kept and erasing a customer (20261203002).
#   C=supabase_db_isms-seedtest bash supabase/tests/promotions/rebuild.sh
#   C=supabase_db_isms-seedtest bash supabase/tests/records/retention_erasure_test.sh
HERE=$(cd "$(dirname "$0")" && pwd)
source "$HERE/../promotions/lib.sh"
B1=b1000000-0000-0000-0000-000000000000
EMP=e2000000-0000-0000-0000-000000000000
BR=d3000000-0000-0000-0000-000000000000
ACC=c9000000-0000-0000-0000-0000000000e1

echo "--- retention job"
OLD_A=$(sql "insert into audit_logs (business_id, action, timestamp) values ('$B1','old', now() - interval '8 years') returning id" | head -1)
NEW_A=$(sql "insert into audit_logs (business_id, action, timestamp) values ('$B1','recent', now() - interval '6 years') returning id" | head -1)
sql "insert into notifications (business_id, title, message, type, created_at) values
     ('$B1','old','x','info', now() - interval '13 months'), ('$B1','new','x','info', now() - interval '11 months')" >/dev/null
sql "insert into crash_reports (business_id, fingerprint, message, last_seen_at) values
     ('$B1','old','x', now() - interval '100 days'), ('$B1','new','x', now() - interval '10 days')" >/dev/null
has "a cashier can't run it" "$(as cash "select run_data_retention()")" "permission denied"
has "an owner can't run it" "$(as owner "select run_data_retention()")" "permission denied"
R=$(sql "set role service_role; select run_data_retention()")
ok "service role runs it" "$R"
eq "audit entry older than 7 years removed" "$(sql "select count(*) from audit_logs where id='$OLD_A'")" "0"
eq "audit entry 6 years old kept" "$(sql "select count(*) from audit_logs where id='$NEW_A'")" "1"
eq "notification older than a year removed" "$(sql "select count(*) from notifications where business_id='$B1' and title='old'")" "0"
eq "recent notification kept" "$(sql "select count(*) from notifications where business_id='$B1' and title='new'")" "1"
eq "old crash report removed, recent kept" "$(sql "select string_agg(fingerprint, ',') from crash_reports where business_id='$B1' and fingerprint in ('old','new')")" "new"
has "outside the job, old audit entries still can't be deleted" \
    "$(sql "insert into audit_logs (business_id, action, timestamp) values ('$B1','old2', now() - interval '9 years'); set role service_role; delete from audit_logs where action='old2'")" "can't be deleted"
has "setting the switch doesn't open recent entries" \
    "$(sql "set isms.retention_job = 'on'; delete from audit_logs where id='$NEW_A'")" "can't be deleted"

echo "--- erase a customer"
C1=$(sql "insert into customers (business_id, name, phone, email, delivery_address) values ('$B1','Wanjiru Kamau','0712000111','w@example.com','Kahawa') returning id" | head -1)
sql "insert into auth.users (id, email, instance_id, aud, role) values ('$ACC','w@example.com','00000000-0000-0000-0000-000000000000','authenticated','authenticated')" >/dev/null
sql "insert into customer_accounts (id, business_id, customer_id, name, phone, email) values ('$ACC','$B1','$C1','Wanjiru Kamau','0712000111','w@example.com')" >/dev/null
sql "insert into customer_messages (business_id, account_id, sender, body) values ('$B1','$ACC','customer','My gate is blue')" >/dev/null
O=$(sql "insert into online_orders (business_id, account_id, customer_name, customer_phone, fulfilment, delivery_address, subtotal, total) values ('$B1','$ACC','Wanjiru Kamau','0712000111','delivery','Kahawa',100,100) returning id" | head -1)
T=$(as cash "select record_till_sale('{\"business_id\":\"$B1\",\"customer_id\":\"$C1\",\"total\":50,\"discount\":0,\"tax\":0,\"final_total\":50,\"payment_method\":\"Cash\",\"staff_name\":\"Carl\",\"staff_id\":\"$EMP\"}'::jsonb, '[{\"product_id\":\"$BR\",\"product_name\":\"Bread\",\"quantity\":1,\"unit_price\":50,\"discount_percentage\":0}]'::jsonb)")
ok "the customer has a sale" "$T"

has "a cashier can't erase" "$(as cash "select erase_customer('$C1')")" "permission"
sql "update customers set debt_balance = 20 where id='$C1'" >/dev/null
has "refused while they owe money" "$(as owner "select erase_customer('$C1')")" "Settle the debt"
sql "update customers set debt_balance = 0, wallet_balance = 30 where id='$C1'" >/dev/null
has "refused while the wallet has money" "$(as owner "select erase_customer('$C1')")" "in their wallet"
sql "update customers set wallet_balance = 0 where id='$C1'" >/dev/null

R=$(as owner "select erase_customer('$C1')")
has "owner erases" "$R" '"website_accounts_deleted": 1'
eq "name and contacts removed" "$(sql "select name||'|'||phone||'|'||coalesce(email,'-')||'|'||coalesce(delivery_address,'-') from customers where id='$C1'")" "Erased Customer|0000000|-|-"
eq "marked erased and hidden" "$(sql "select (erased_at is not null)::text||(deleted_at is not null)::text from customers where id='$C1'")" "truetrue"
eq "website sign-in deleted" "$(sql "select count(*) from auth.users where id='$ACC'")" "0"
eq "website chat deleted" "$(sql "select count(*) from customer_messages where account_id='$ACC'")" "0"
eq "online order kept without name or phone" "$(sql "select customer_name||'|'||customer_phone||'|'||coalesce(delivery_address,'-') from online_orders where id='$O'")" "Erased Customer||-"
eq "the sale is kept, still linked" "$(sql "select count(*) from transactions where customer_id='$C1'")" "1"
has "the erasure is in the audit trail" "$(sql "select action from audit_logs where record_id='$C1'")" "customer_erased"
has "can't erase twice" "$(as owner "select erase_customer('$C1')")" "already erased"

echo "--- $PASS passed, $FAIL failed"
[ $FAIL -eq 0 ]
