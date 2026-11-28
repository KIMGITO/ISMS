#!/bin/bash
# M-Pesa prompts linked to a sale before they are sent (20261212007), mocked Safaricom results.
#   C=supabase_db_isms-seedtest bash supabase/tests/payments/stk_sale_link_test.sh
HERE=$(cd "$(dirname "$0")" && pwd)
source "$HERE/../promotions/lib.sh"
B1=b1000000-0000-0000-0000-000000000000; EMP=e2000000-0000-0000-0000-000000000000
BR=d3000000-0000-0000-0000-000000000000   # Bread, 50.00
R=$$
item(){ echo "[{\"product_id\":\"$BR\",\"product_name\":\"x\",\"quantity\":$1,\"unit_price\":50,\"discount_percentage\":0}]"; }
sale(){ as cash "select record_till_sale('{\"business_id\":\"$B1\",\"total\":$1,\"discount\":0,\"tax\":0,\"final_total\":$1,\"payment_method\":\"$3\",\"staff_name\":\"Carl\",\"staff_id\":\"$EMP\",\"reference_id\":\"$2\",\"payment_ref\":\"PR-$2\"}'::jsonb, '$(item 2)'::jsonb)"; }
id_of(){ grep -oE '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' <<<"$1" | head -1; }
# What the edge function does: check, then store the prompt with the sale linked.
prompt(){ local chk; chk=$(sql "select check_sale_prompt('$B1', '$1', $2)");
  if [[ "$chk" == *ERROR* ]]; then echo "$chk"; return; fi
  sql "insert into mpesa_transactions (business_id, checkout_request_id, merchant_request_id, phone, amount, transaction_id, requested_by)
       values ('$B1', '$3', 'm-$3', '254700000000', $2, '$1', 'Carl')" >/dev/null; echo "sent $chk"; }
paid(){ sql "select confirm_store_payment_request('$1', 0, $2, '$3', '{}'::jsonb)"; }
failed(){ sql "select confirm_store_payment_request('$1', 1032, null, null, '{}'::jsonb)"; }
cash(){ sql "select coalesce(sum(balance),0) from money_assets where business_id='$B1'"; }
pays(){ sql "select count(*) from payments where business_id='$B1'"; }
books(){ sql "select coalesce(sum(debit),0) = coalesce(sum(credit),0) from acc_lines l join acc_entries e on e.id=l.entry_id where e.business_id='$B1'"; }

S1=$(id_of "$(sale 100 TXN-P$R M-Pesa)"); S2=$(id_of "$(sale 100 TXN-Q$R M-Pesa)"); SC=$(id_of "$(sale 100 TXN-K$R Cash)")
M0=$(cash); P0=$(pays)

echo "--- checks before sending"
has "cash sale refused" "$(prompt $SC 100 CK1-$R)" "Only a sale paid by M-Pesa"
has "more than the sale refused" "$(prompt $S1 101 CK2-$R)" "more than the sale still needs"
has "other business's sale refused" "$(sql "select check_sale_prompt('b2000000-0000-0000-0000-000000000000', '$S1', 10)")" "Sale not found"
has "prompt for sale 1 sent" "$(prompt $S1 100 CK3-$R)" "sent TXN-P$R"
has "second prompt while first waits refused" "$(prompt $S1 100 CK4-$R)" "already paid or has a prompt waiting"

echo "--- paid prompt proves the sale, moves no new money"
has "paid links to sale" "$(paid CK3-$R 100 RCP1$R)" "matched_sale"
eq "status completed, no payment row" "$(sql "select status||':'||coalesce(payment_id::text,'none') from mpesa_transactions where checkout_request_id='CK3-$R'")" "Completed:none"
eq "no extra payment" "$(pays)" "$P0"
eq "money balance unchanged" "$(cash)" "$M0"
eq "duplicate callback ignored" "$(paid CK3-$R 100 RCP1$R)" "duplicate"
has "sale 1 now full" "$(prompt $S1 1 CK5-$R)" "already paid"

echo "--- a cancelled prompt frees the sale"
has "prompt for sale 2 sent" "$(prompt $S2 100 CK6-$R)" "sent"
eq "customer cancels" "$(failed CK6-$R)" "failed"
has "can send again" "$(prompt $S2 100 CK7-$R)" "sent"

echo "--- sale removed before the money came: money still recorded"
sql "update transactions set deleted_at = now() where id='$S2'" >/dev/null
has "recorded as a payment" "$(paid CK7-$R 100 RCP2$R)" "recorded"
eq "unlinked from removed sale" "$(sql "select coalesce(transaction_id::text,'none')||':'||(payment_id is not null) from mpesa_transactions where checkout_request_id='CK7-$R'")" "none:true"
eq "one new payment" "$(pays)" "$((P0+1))"
eq "money balance up by 100" "$(sql "select $(cash) - $M0")" "100.00"
eq "books balance" "$(books)" "t"

echo "PASS=$PASS FAIL=$FAIL"
