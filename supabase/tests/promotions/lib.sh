# psql runner for tests. as <who> runs SQL signed in as that person (authenticated role, RLS on).
C=${C:-supabase_db_isms-seedtest}; DB=${DB:-promo_test}
declare -A UID_OF=([owner]=a0000000-0000-0000-0000-000000000000 [mgr]=a1000000-0000-0000-0000-000000000000 [cash]=a2000000-0000-0000-0000-000000000000 [rider]=a3000000-0000-0000-0000-000000000000)
PASS=0; FAIL=0
sql(){ docker exec -i $C psql -U supabase_admin -d $DB -tAq -v ON_ERROR_STOP=1 2>&1 <<<"$1"; }
as(){ local who=$1; shift; sql "SET request.jwt.claims = '{\"sub\":\"${UID_OF[$who]}\",\"role\":\"authenticated\"}'; SET role authenticated;
$1"; }
ok(){ if [[ "$2" == *ERROR* ]]; then FAIL=$((FAIL+1)); echo "FAIL  $1 -> $2"; else PASS=$((PASS+1)); echo "pass  $1"; fi; }
has(){ if [[ "$2" == *"$3"* ]]; then PASS=$((PASS+1)); echo "pass  $1"; else FAIL=$((FAIL+1)); echo "FAIL  $1 -> expected [$3] got [$2]"; fi; }
eq(){ if [[ "$2" == "$3" ]]; then PASS=$((PASS+1)); echo "pass  $1"; else FAIL=$((FAIL+1)); echo "FAIL  $1 -> expected [$3] got [$2]"; fi; }

# A real refund through the app's credit-note function. refund <tx> [product_id] (all lines when no product)
refund(){ as owner "select create_credit_note((select business_id from transactions where id='$1'), jsonb_build_object('transactionId','$1','settlement','refund','method','Cash','reason','test','returnStock',false,'lines',(select jsonb_agg(jsonb_build_object('transactionItemId',id,'quantity',quantity)) from transaction_items where transaction_id='$1' ${2:+and product_id='$2'})))"; }
