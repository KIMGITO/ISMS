#!/bin/bash
# 20261205002: deleting a customer, product, supplier, worker, branch or expense shows what it touches first, and the
# database refuses deletes that would break the money rules.
#   C=supabase_db_isms-seedtest bash supabase/tests/promotions/rebuild.sh
#   C=supabase_db_isms-seedtest bash supabase/tests/records/delete_impact_test.sh
HERE=$(cd "$(dirname "$0")" && pwd)
source "$HERE/../promotions/lib.sh"
B=b1000000-0000-0000-0000-000000000000
UID_OF[stranger]=a8000000-0000-0000-0000-000000000000
CU=$(sql "insert into customers (business_id, name, phone, debt_balance, wallet_balance, loyalty_points) values ('$B','Dora Debt','0700111222', 250, 0, 40) returning id")
PR=$(sql "insert into products (business_id, name, category, price, cost, stock, unit) values ('$B','Test Flour','Baking', 100, 60, 5, 'kg') returning id")
SU=$(sql "insert into suppliers (business_id, name, phone, product_supplied) values ('$B','Sam Supplies','0700111444','Flour') returning id")

echo "--- customer"
R=$(as owner "select delete_impact('customer','$CU')")
has "names what they owe" "$R" "Owes KSh 250.00"
has "and the points that are lost" "$R" "40 loyalty points are lost"
has "the database refuses the delete" "$(as owner "update customers set deleted_at = now() where id='$CU'")" "Owes KSh 250.00"
sql "update customers set debt_balance = 0 where id='$CU'" >/dev/null
eq "paid up: nothing blocks" "$(as owner "select jsonb_array_length(delete_impact('customer','$CU')->'blockers')")" "0"
ok "and the delete goes through" "$(as owner "update customers set deleted_at = now() where id='$CU'")"
W=$(sql "insert into customers (business_id, name, phone, wallet_balance) values ('$B','Wendy Wallet','0700111333', 80) returning id")
has "wallet money blocks too" "$(as owner "select delete_impact('customer','$W')->'blockers'")" "in their wallet"

echo "--- product"
has "stock blocks a product delete" "$(as owner "select delete_impact('product','$PR')->'blockers'")" "5.0 kg still in stock, worth KSh 300.00"
has "the database refuses it" "$(as owner "update products set deleted_at = now() where id='$PR'")" "still in stock"
sql "update products set stock = 0 where id='$PR'" >/dev/null
ok "at 0 it can go" "$(as owner "update products set deleted_at = now() where id='$PR'")"

echo "--- supplier"
sql "insert into supplier_bills (business_id, number, supplier_id, supplier_name, bill_date, due_date, subtotal, total, status, balance) values ('$B','BILL-T$RANDOM','$SU','Sam Supplies', current_date, current_date, 500, 500, 'open', 500)" >/dev/null
has "an unpaid bill blocks" "$(as owner "select delete_impact('supplier','$SU')->'blockers'")" "We still owe them KSh 500.00 on 1 bill"
has "the database refuses it" "$(as owner "update suppliers set deleted_at = now() where id='$SU'")" "We still owe"
sql "update supplier_bills set status='paid', paid=500, balance=0 where supplier_id='$SU'" >/dev/null
ok "paid: it can go" "$(as owner "update suppliers set deleted_at = now() where id='$SU'")"

echo "--- worker"
B2=b2000000-0000-0000-0000-000000000000
CASH=00000000-0000-0000-0000-0000000000a2
OWNER=00000000-0000-0000-0000-0000000000a0
sql "insert into shifts (business_id, employee_id, start_time) values ('$B','e2000000-0000-0000-0000-000000000000', now() - interval '1 hour')" >/dev/null
R=$(as owner "select delete_impact('worker','$CASH','$B')")
has "clocked in blocks removing them" "$R" "They are clocked in"
has "and says they keep their other branch" "$R" "keep their place at 1 other branch"
has "the database refuses it" "$(as owner "delete from business_memberships where business_id='$B' and user_id='$CASH'")" "They are clocked in"
has "the owner can't be removed" "$(as owner "select delete_impact('worker','$OWNER','$B')->'blockers'")" "They own the business"
sql "update shifts set end_time = now(), status = 'Closed' where business_id='$B' and employee_id='e2000000-0000-0000-0000-000000000000'" >/dev/null
ok "clocked out: they can be removed" "$(as owner "delete from business_memberships where business_id='$B' and user_id='$CASH'")"
eq "and they are gone from that branch only" "$(sql "select count(*) from business_memberships where user_id='$CASH'")" "1"

echo "--- expense"
EX=$(sql "insert into expenses (business_id, category, amount, staff_name, payment_method) values ('$B','Transport', 120, 'Olive', 'Cash') returning id")
R=$(as owner "select delete_impact('expense','$EX')")
has "says where the money goes back" "$R" "KSh 120.00 goes back to Cash"
has "and that the books entry comes out" "$R" "books entry is taken out"
ok "an expense delete is not blocked" "$(as owner "update expenses set deleted_at = now() where id='$EX'")"

echo "--- branch"
has "stock blocks closing a branch" "$(as owner "select delete_impact('branch','$B2')->'blockers'")" "1 product still has stock"
has "close_branch is refused while it has stock" "$(as owner "select close_branch('$B2')")" "still has stock"
has "nobody signed in can hard-delete a branch" "$(as owner "delete from businesses where id='$B2'")" "permission denied"
has "the cashier may not close it" "$(as cash "select close_branch('$B2')")" "permission"
sql "update products set stock = 0 where business_id='$B2'" >/dev/null
ok "at 0 stock it closes" "$(as owner "select close_branch('$B2')")"
eq "closed, not deleted: its records stay" "$(sql "select (deleted_at is not null)::text || count(*) over () from businesses where id='$B2'")" "true1"
has "the last open branch can't be closed" "$(as owner "select delete_impact('branch','$B')->'blockers'")" "only branch"

echo "--- who may look"
X=$(sql "insert into customers (business_id, name, phone) values ('$B','Plain Pat','0700111555') returning id")
has "a stranger can't read the impact" "$(as stranger "select delete_impact('customer','$X')")" "ERROR"
has "an unknown kind is refused" "$(as owner "select delete_impact('bogus','$X')")" "Unknown kind"
ok "merging is not a delete" "$(sql "update customers set merged_into_id='$X', deleted_at=now(), wallet_balance=0, debt_balance=0 where id='$W'")"

echo "delete impact: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
