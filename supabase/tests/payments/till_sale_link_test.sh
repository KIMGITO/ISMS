#!/bin/bash
# Till (C2B) payments linked to sales (20261212005), with mocked Daraja confirmation bodies.
#   C=supabase_db_isms-seedtest bash supabase/tests/promotions/rebuild.sh
#   C=supabase_db_isms-seedtest bash supabase/tests/payments/till_sale_link_test.sh
HERE=$(cd "$(dirname "$0")" && pwd)
source "$HERE/../promotions/lib.sh"
B1=b1000000-0000-0000-0000-000000000000; EMP=e2000000-0000-0000-0000-000000000000
BR=d3000000-0000-0000-0000-000000000000   # Bread, 50.00
R=$$
item(){ echo "[{\"product_id\":\"$BR\",\"product_name\":\"x\",\"quantity\":$1,\"unit_price\":50,\"discount_percentage\":0}]"; }
msale(){ as cash "select record_till_sale('{\"business_id\":\"$B1\",\"total\":$1,\"discount\":0,\"tax\":0,\"final_total\":$1,\"payment_method\":\"M-Pesa\",\"staff_name\":\"Carl\",\"staff_id\":\"$EMP\",\"reference_id\":\"$2\"}'::jsonb, '$(item $3)'::jsonb)"; }
c2b(){ sql "select record_till_payment('{\"TransID\":\"$1\",\"TransAmount\":\"$2\",\"BusinessShortCode\":\"600000\",\"BillRefNumber\":\"$3\",\"MSISDN\":\"2547XXXXXXXX\",\"FirstName\":\"Jane\",\"TransTime\":\"20261126101500\"}'::jsonb, '$B1')"; }
tp(){ sql "select id from mpesa_till_payments where trans_id='$1'"; }
id_of(){ grep -oE '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' <<<"$1" | head -1; }
cash(){ sql "select coalesce(sum(balance),0) from money_assets where business_id='$B1'"; }

S1=$(id_of "$(msale 100 TXN-A$R 2)"); S2=$(id_of "$(msale 100 TXN-B$R 2)")
S3=$(id_of "$(msale 100 TXN-C$R 2)")
M0=$(cash); P0=$(sql "select count(*) from payments where business_id='$B1'")

echo "--- confirmation naming the receipt number links itself"
has "first delivery links" "$(c2b QA$R 100 TXN-A$R)" "matched_sale"
eq "linked to sale A" "$(sql "select sale_id from mpesa_till_payments where trans_id='QA$R'")" "$S1"
eq "duplicate delivery ignored" "$(c2b QA$R 100 TXN-A$R)" "duplicate"
eq "one row only" "$(sql "select count(*) from mpesa_till_payments where trans_id='QA$R'")" "1"

echo "--- no reference: waits, never guessed by amount (two sales of 100.00 exist)"
has "queued" "$(c2b QB$R 100 '')" "queued"
eq "not linked" "$(sql "select coalesce(sale_id::text,'none') from mpesa_till_payments where trans_id='QB$R'")" "none"
has "sale B offered" "$(as cash "select reference from till_payment_sale_candidates('$(tp QB$R)')")" "TXN-B$R"
has "sale A (already covered) not offered" "x$(as cash "select string_agg(reference,',') from till_payment_sale_candidates('$(tp QB$R)')" | grep -c "TXN-A$R")" "x0"
has "search by receipt" "$(as cash "select reference from till_payment_sale_candidates('$(tp QB$R)', 'B$R')")" "TXN-B$R"

echo "--- manual link"
has "cannot link to a covered sale" "$(as cash "select link_till_payment_to_sale('$(tp QB$R)', '$S1', 'Carl')")" "already covered"
ok "link to sale B" "$(as cash "select link_till_payment_to_sale('$(tp QB$R)', '$S2', 'Carl')")"
eq "linked" "$(sql "select status||':'||sale_id from mpesa_till_payments where trans_id='QB$R'")" "matched_sale:$S2"
has "cannot link twice" "$(as cash "select link_till_payment_to_sale('$(tp QB$R)', '$S2', 'Carl')")" "already handled"
ok "back to waiting" "$(as cash "select handle_till_payment('$(tp QB$R)', 'reopen', null, null, 'Carl')")"
eq "unlinked on reopen" "$(sql "select status||':'||coalesce(sale_id::text,'none') from mpesa_till_payments where trans_id='QB$R'")" "unclaimed:none"

echo "--- partial: two till payments of 50 + 50 for a 100 sale, a third refused"
c2b QC1$R 50 '' >/dev/null; c2b QC2$R 50 '' >/dev/null; c2b QC3$R 50 '' >/dev/null
ok "first half" "$(as cash "select link_till_payment_to_sale('$(tp QC1$R)', '$S3', 'Carl')")"
ok "second half" "$(as cash "select link_till_payment_to_sale('$(tp QC2$R)', '$S3', 'Carl')")"
has "overpay refused" "$(as cash "select link_till_payment_to_sale('$(tp QC3$R)', '$S3', 'Carl')")" "already covered"

echo "--- linking moves no money (the sale already counted it)"
eq "no new payments rows" "$(sql "select count(*) from payments where business_id='$B1'")" "$P0"
eq "money balance unchanged by links" "$(cash)" "$M0"

echo "--- tenant isolation"
OTHER=$(sql "select id from businesses where id<>'$B1' limit 1")
if [ -n "$OTHER" ]; then
  sql "insert into mpesa_till_payments(business_id,trans_id,amount) values('$OTHER','QX$R',100)" >/dev/null
  has "other business's payment refused" "$(as cash "select link_till_payment_to_sale('$(tp QX$R)', '$S2', 'Carl')")" "ERROR"
fi
has "rider cannot link" "$(as rider "select link_till_payment_to_sale('$(tp QC3$R)', '$S2', 'Rider')")" "ERROR"

echo "PASS=$PASS FAIL=$FAIL"; [ $FAIL -eq 0 ]
