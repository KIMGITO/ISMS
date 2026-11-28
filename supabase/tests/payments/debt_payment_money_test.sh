#!/bin/bash
# Customers > Pay debt (process_debt_payment) moves the Payments screen balance and the books by
# the same amount, makes one payments row, settles credit oldest first, and is safe to retry
# (20261215002).
#   C=supabase_db_isms-seedtest bash supabase/tests/payments/debt_payment_money_test.sh
HERE=$(cd "$(dirname "$0")" && pwd)
source "$HERE/../promotions/lib.sh"
B1=b1000000-0000-0000-0000-000000000000
R=$$
app(){ sql "select coalesce((select balance from money_assets where business_id='$B1' and method='$1'),0)"; }
books(){ sql "select coalesce(sum(l.debit-l.credit),0) from acc_lines l join acc_accounts a on a.id=l.account_id where a.business_id='$B1' and a.code='$1'"; }
balanced(){ sql "select coalesce(sum(debit),0) = coalesce(sum(credit),0) from acc_lines where business_id='$B1'"; }
diff(){ sql "select ($1 - $2)::numeric(14,2)"; }
pay(){ as owner "select process_debt_payment('$B1', '$CUST', $1, '$2', 'Owner', null, '$3')"; }

CUST=$(sql "insert into customers (business_id, name, phone, debt_balance) values ('$B1', 'Debtor $R', '0700$R', 500) returning id" | head -1)
sql "insert into credit_payments (business_id, customer_id, customer_name, amount_owed, amount_paid, status, created_at)
     values ('$B1', '$CUST', 'Debtor $R', 300, 0, 'Open', now() - interval '2 days'),
            ('$B1', '$CUST', 'Debtor $R', 200, 0, 'Open', now() - interval '1 day')" >/dev/null

echo "--- M-Pesa debt payment"
M0=$(app M-Pesa); G0=$(books 1010)
ok "pay 350 by M-Pesa" "$(pay 350 M-Pesa DP1-$R)"
eq "Payments screen M-Pesa up 350.00" "$(diff "$(app M-Pesa)" "$M0")" "350.00"
eq "books M-Pesa up 350.00" "$(diff "$(books 1010)" "$G0")" "350.00"
eq "one payments row, all to debt" "$(sql "select count(*)||':'||max(applied_to)||':'||max(debt_applied) from payments where business_id='$B1' and reference_code='DP1-$R'")" "1:debt:350.00"
eq "debt down to 150" "$(sql "select debt_balance from customers where id='$CUST'")" "150.00"
eq "oldest credit settled first" "$(sql "select string_agg(status::text||':'||balance, ',' order by created_at) from credit_payments where customer_id='$CUST'")" "Settled:0.00,Partial:150.00"
eq "debt_payments row" "$(sql "select count(*) from debt_payments where customer_id='$CUST'")" "1"
eq "books balance" "$(balanced)" "t"

echo "--- retry with the same reference"
ok "retry" "$(pay 350 M-Pesa DP1-$R)"
eq "still one payment" "$(sql "select count(*) from payments where business_id='$B1' and reference_code='DP1-$R'")" "1"
eq "balance unchanged" "$(diff "$(app M-Pesa)" "$M0")" "350.00"
eq "debt unchanged" "$(sql "select debt_balance from customers where id='$CUST'")" "150.00"

echo "--- cash debt payment and limits"
C0=$(app Cash); K0=$(books 1000)
ok "pay 100 cash" "$(pay 100 Cash DP2-$R)"
eq "Payments screen cash up 100.00" "$(diff "$(app Cash)" "$C0")" "100.00"
eq "books cash up 100.00" "$(diff "$(books 1000)" "$K0")" "100.00"
has "more than owed is refused" "$(pay 60 Cash DP3-$R)" "more than outstanding debt"
has "zero is refused" "$(pay 0 Cash DP4-$R)" "greater than zero"
eq "nothing recorded for refused" "$(sql "select count(*) from payments where reference_code in ('DP3-$R','DP4-$R')")" "0"
has "rider can't record it" "$(as rider "select process_debt_payment('$B1', '$CUST', 10, 'Cash', 'R', null, 'DP5-$R')")" "ERROR"
eq "books balance" "$(balanced)" "t"

echo "PASS=$PASS FAIL=$FAIL"
[ "$FAIL" = 0 ]
