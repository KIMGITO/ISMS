#!/bin/bash
# Promotion code acceptance tests, run against a database built from the migrations.
source "$(dirname "$0")/lib.sh"
B1=b1000000-0000-0000-0000-000000000000; B2=b2000000-0000-0000-0000-000000000000
M1=d1000000-0000-0000-0000-000000000000; M5=d2000000-0000-0000-0000-000000000000; BR=d3000000-0000-0000-0000-000000000000
ALICE=c1000000-0000-0000-0000-000000000000; BOB=c2000000-0000-0000-0000-000000000000; CAROL=c3000000-0000-0000-0000-000000000000
item(){ echo "{\"product_id\":\"$1\",\"quantity\":$2,\"unit_price\":$3,\"discount_percentage\":${4:-0}}"; }
CART="[$(item $M1 2 100),$(item $BR 1 50)]"           # 250, milk 200
save(){ as mgr "select save_promotion('$B1', NULL, '$1'::jsonb)"; }
check(){ as cash "select promo_check('$B1', '$1', ${3:-NULL}, '$2'::jsonb, ${4:-0})"; }
field(){ python3 -c "import json,sys; d=json.loads(sys.stdin.read()); v=d.get('$1'); print(f'{v:.2f}' if isinstance(v,(int,float)) and not isinstance(v,bool) else v)"; }
num(){ python3 -c "import json,sys; d=json.load(sys.stdin); v=eval(sys.argv[1]); print(' '.join(f'{x:.2f}' if isinstance(x,float) else str(x) for x in (v if isinstance(v,tuple) else (v,))))" "$1"; }
sale(){ # sale <redemption|null> <discount> <items> [customer] [final]
  local items=$3 cust=${4:-null}; [[ $cust != null ]] && cust="\"$cust\""
  as cash "select record_till_sale('{\"business_id\":\"$B1\",\"total\":$(echo "$items" | python3 -c "import json,sys;print(sum(i['quantity']*i['unit_price'] for i in json.load(sys.stdin)))"),\"discount\":$2,\"tax\":0,\"final_total\":${5:-0},\"payment_method\":\"Cash\",\"staff_name\":\"Carl\",\"staff_id\":\"e2000000-0000-0000-0000-000000000000\",\"customer_id\":$cust,\"promotion_redemption_id\":$1}'::jsonb, '$items'::jsonb)"; }
reserve(){ as cash "select promo_reserve('$B1', '$1', ${3:-NULL}, '$2'::jsonb, 0)"; }
red(){ sql "select status from promotion_redemptions where id='$1'"; }

echo "--- permissions"
has "rider can't create"  "$(as rider "select save_promotion('$B1', NULL, '{\"name\":\"X\",\"promoType\":\"percentage\",\"value\":5}')")" "permission"
has "cashier can't create" "$(as cash "select save_promotion('$B1', NULL, '{\"name\":\"X\",\"promoType\":\"percentage\",\"value\":5}')")" "permission"
has "rider can't apply"   "$(as rider "select promo_check('$B1','X',NULL,'[]',0)")" "permission"
has "cashier can't see dashboard" "$(as cash "select promotion_dashboard('$B1', current_date, current_date)")" "permission"
eq  "cashier can't read redemptions (RLS)" "$(as cash "select count(*) from promotion_redemptions")" "0"
has "cashier can't write promotions directly (RLS)" "$(as cash "insert into website_promo_codes (business_id, code, kind, value) values ('$B1','HACK','amount',1000)")" "row-level security"

echo "--- create"
ok  "manager creates MILK10" "$(save '{"name":"Milk week","code":"milk10","promoType":"percentage","value":10,"productScope":"categories","categories":["Milk"]}')"
has "codes are unique, any case" "$(save '{"name":"Again","code":"Milk10","promoType":"percentage","value":5}')" "already used"
has "bad percentage refused" "$(save '{"name":"Too much","promoType":"percentage","value":95}')" "between 1 and 90"
ok  "SAVE100 fixed"   "$(save '{"name":"Hundred off","code":"SAVE100","promoType":"fixed","value":100,"maxUses":2}')"
ok  "SPEND1000"       "$(save '{"name":"Big spend","code":"SPEND1000","promoType":"min_spend","kind":"amount","value":100,"minOrder":1000}')"
ok  "VIP for Carol"   "$(save "{\"name\":\"VIP\",\"code\":\"VIP\",\"promoType\":\"customer\",\"kind\":\"percent\",\"value\":20,\"customerIds\":[\"$CAROL\"]}")"
ok  "NEW50 first buy" "$(save '{"name":"Welcome","code":"NEW50","promoType":"first_purchase","kind":"amount","value":50}')"
ok  "B2G1 buy 2 get 1" "$(save "{\"name\":\"2+1\",\"code\":\"B2G1\",\"promoType\":\"buy_x_get_y\",\"buyQty\":2,\"rewardProductId\":\"$M5\",\"rewardQty\":1,\"productScope\":\"products\",\"productIds\":[\"$M1\"]}")"
ok  "FREEBREAD"       "$(save "{\"name\":\"Free bread\",\"code\":\"FREEBREAD\",\"promoType\":\"free_product\",\"rewardProductId\":\"$BR\",\"rewardQty\":1,\"minOrder\":200}")"
ok  "CAP capped 50%"  "$(save '{"name":"Capped","code":"CAP","promoType":"percentage","value":50,"maxDiscount":30}')"
ok  "OLD5 expired"    "$(save '{"name":"Old","code":"OLD5","promoType":"percentage","value":5,"startsAt":"2026-01-01","endsAt":"2026-02-01"}')"
ok  "SOON scheduled"  "$(save '{"name":"Soon","code":"SOON","promoType":"percentage","value":5,"startsAt":"2099-01-01"}')"
ok  "ONE single use"  "$(save '{"name":"One","code":"ONE","promoType":"fixed","value":10,"maxUses":1}')"
has "online refuses free items" "$(save "{\"name\":\"x\",\"promoType\":\"free_product\",\"rewardProductId\":\"$BR\",\"rewardQty\":1,\"useOnline\":true}")" "online shop takes only"

echo "--- validation"
R=$(check MILK10 "$CART");                 eq "valid: 10% of milk 200 = 20" "$(echo $R | field discount)" "20.00"
eq  "valid: subtotal shown"  "$(echo $R | field subtotal)" "250.00"
R=$(check ' milk10 ' "$CART");             eq "case and spaces don't matter" "$(echo $R | field ok)" "True"
has "invalid code"        "$(check NOPE "$CART")" "No promotion uses the code NOPE"
has "expired"             "$(check OLD5 "$CART")" "ended on"
has "not started"         "$(check SOON "$CART")" "starts on"
has "minimum not met"     "$(check SPEND1000 "$CART")" "Spend at least KSh 1,000"
has "product not eligible" "$(check MILK10 "[$(item $BR 2 50)]")" "None of the items"
has "customer needed"     "$(check VIP "$CART")" "Choose the customer first"
has "customer not eligible" "$(check VIP "$CART" "'$BOB'")" "Bob New can't use this code"
eq  "chosen customer ok (20% of 250)" "$(check VIP "$CART" "'$CAROL'" | field discount)" "50.00"
has "first purchase: old customer" "$(check NEW50 "$CART" "'$ALICE'")" "has bought before"
eq  "first purchase: new customer" "$(check NEW50 "$CART" "'$BOB'" | field discount)" "50.00"
has "can't combine with item discount" "$(check MILK10 "[$(item $M1 2 100 10)]")" "can't be combined"
has "can't combine with cart discount" "$(check MILK10 "$CART" NULL 15)" "can't be combined"
eq  "fixed 100"           "$(check SAVE100 "$CART" | field discount)" "100.00"
eq  "fixed never above cart" "$(check SAVE100 "[$(item $BR 1 50)]" | field discount)" "50.00"
eq  "max discount caps 50% of 250 at 30" "$(check CAP "$CART" | field discount)" "30.00"
eq  "buy 2 get 1: 500ml free" "$(check B2G1 "[$(item $M1 2 100),$(item $M5 1 60)]" | field discount)" "60.00"
has "buy 2 get 1: says add the free one" "$(check B2G1 "[$(item $M1 2 100)]")" "Add 1 Milk 500ml"
has "buy 2 get 1: not enough bought" "$(check B2G1 "[$(item $M1 1 100),$(item $M5 1 60)]")" "Buy at least 2"
R=$(check B2G1 "[$(item $M1 4 100),$(item $M5 1 60)]"); eq "buy 4 earns 2, 1 in cart" "$(echo $R | field discount)" "60.00"
has "  ...and tells to add another" "$R" "also free"
eq  "free bread over 200" "$(check FREEBREAD "$CART" | field discount)" "50.00"
has "branch: not on at B2" "$(as cash "select promo_check('$B2','MILK10',NULL,'[$(item d4000000-0000-0000-0000-000000000000 1 100)]',0)")" "No promotion uses the code"
ok  "share MILK10 with B2" "$(as owner "select save_promotion('$B1', id, (select jsonb_build_object('name',name,'code',code,'promoType','percentage','value',value,'productScope','categories','categories','[\"Milk\"]'::jsonb,'branchIds',jsonb_build_array('$B2')) from website_promo_codes where code='MILK10' and business_id='$B1')) from website_promo_codes where code='MILK10' and business_id='$B1'")"
eq  "branch: works at B2 once shared" "$(as cash "select promo_check('$B2','MILK10',NULL,'[$(item d4000000-0000-0000-0000-000000000000 1 100)]',0)" | field discount)" "10.00"

echo "--- sale with promotion"
R=$(reserve MILK10 "$CART"); RID=$(echo $R | field redemptionId); eq "reserve gives server discount" "$(echo $R | field discount)" "20.00"
TX=$(sale "\"$RID\"" 20 "$CART" null 230); ok "sale saved with promotion" "$TX"
eq  "redemption redeemed" "$(red $RID)" "redeemed"
eq  "sale stamped with code and discount" "$(sql "select promotion_code||' '||promotion_discount||' '||final_total from transactions where id='$TX'")" "MILK10 20.00 230.00"
eq  "redemption linked to sale, cashier recorded" "$(sql "select (transaction_id='$TX')::text||' '||staff_name from promotion_redemptions where id='$RID'")" "true Carl"
has "duplicate: same hold on a 2nd sale refused" "$(sale "\"$RID\"" 20 "$CART" null 230)" "ERROR"
R=$(reserve MILK10 "$CART"); RID2=$(echo $R | field redemptionId)
has "tampered cart refused" "$(sale "\"$RID2\"" 20 "[$(item $M1 5 100)]" null 480)" "cart changed"
eq  "  ...whole sale rolled back" "$(sql "select count(*) from transactions where promotion_redemption_id='$RID2'")" "0"
eq  "  ...hold still open" "$(red $RID2)" "reserved"
has "discount smaller than promotion refused" "$(sale "\"$RID2\"" 5 "$CART" null 245)" "less than the promotion"
ok  "release hold" "$(as cash "select promo_release('$RID2')")"; eq "  ...released" "$(red $RID2)" "released"
has "released hold can't be used" "$(sale "\"$RID2\"" 20 "$CART" null 230)" "given back"
ok  "normal sale without promotion" "$(sale null 0 "$CART" null 250)"
ok  "normal direct insert (app path) without promotion" "$(as cash "insert into transactions (business_id,total,final_total,amount_paid,payment_method,staff_name,staff_id) values ('$B1',50,50,50,'Cash','Carl','e2000000-0000-0000-0000-000000000000') returning id")"
has "app can't set promotion discount itself" "$(as cash "insert into transactions (business_id,total,final_total,amount_paid,payment_method,staff_name,staff_id,promotion_discount) values ('$B1',50,40,40,'Cash','Carl','e2000000-0000-0000-0000-000000000000',10) returning promotion_discount")" "0.00"
has "promotion can't be changed after sale" "$(as owner "update transactions set promotion_redemption_id=NULL where id='$TX'")" "can't be changed"

echo "--- credit sale with promotion"
R=$(as cash "select promo_reserve('$B1','VIP','$CAROL','$CART'::jsonb,0)"); RC=$(echo $R | field redemptionId)
TXC=$(as cash "select process_customer_transaction('$B1','$CAROL','Carol Chosen',NULL,'Carl',250,50,0,200,0,'Credit',now(),NULL,false,0,NULL,'ref-carol-1','[{\"product_id\":\"$M1\",\"product_name\":\"Milk 1L\",\"unit_price\":100,\"quantity\":2,\"discount_percentage\":0},{\"product_id\":\"$BR\",\"product_name\":\"Bread\",\"unit_price\":50,\"quantity\":1,\"discount_percentage\":0}]'::jsonb,'charged',0,'$RC')")
ok  "credit sale with promotion" "$TXC"; eq "  ...redeemed" "$(red $RC)" "redeemed"
eq  "  ...debt is the discounted total" "$(sql "select debt_balance from customers where id='$CAROL'")" "200.00"
ok  "credit sale without promotion still works" "$(as cash "select process_customer_transaction('$B1','$CAROL','Carol Chosen',NULL,'Carl',50,0,0,50,0,'Credit',now(),NULL,false,0,NULL,'ref-carol-2','[{\"product_id\":\"$BR\",\"product_name\":\"Bread\",\"unit_price\":50,\"quantity\":1,\"discount_percentage\":0}]'::jsonb)")"

echo "--- limits"
R1=$(reserve ONE "$CART" | field redemptionId); ok "ONE: first hold" "$R1"
has "ONE: second hold refused (limit)" "$(reserve ONE "$CART")" "fully used (1 of 1)"
ok  "ONE: give back" "$(as cash "select promo_release('$R1')")"
R1=$(reserve ONE "$CART" | field redemptionId); ok "ONE: free again after release" "$R1"
sql "update promotion_redemptions set expires_at = now() - interval '1 minute' where id='$R1'" >/dev/null
ok  "ONE: timed-out hold frees the use" "$(reserve ONE "$CART" | field redemptionId)"
ok  "concurrency: CONC limited to 1" "$(save '{"name":"Race","code":"CONC","promoType":"fixed","value":10,"maxUses":1}')"
for i in 1 2 3 4 5 6; do (reserve CONC "$CART" > ${TMPDIR:-/tmp}/promo_conc_$i.txt) & done; wait
eq  "concurrency: 6 tills at once, exactly 1 hold" "$(sql "select count(*) from promotion_redemptions r join website_promo_codes p on p.id=r.promotion_id where p.code='CONC' and r.status='reserved'")" "1"
eq  "concurrency: the other 5 told it's used" "$(cat ${TMPDIR:-/tmp}/promo_conc_*.txt | grep -c 'fully used')" "5"
rm -f ${TMPDIR:-/tmp}/promo_conc_*.txt

echo "--- cancel and refund"
RS=$(reserve SAVE100 "$CART" | field redemptionId); TXS=$(sale "\"$RS\"" 100 "$CART" null 150); ok "SAVE100 sale" "$TXS"
ok  "cancel sale" "$(as owner "update transactions set deleted_at=now() where id='$TXS'")"
eq  "cancelled sale frees the use" "$(red $RS)" "cancelled"
RS=$(reserve SAVE100 "$CART" | field redemptionId); TXS=$(sale "\"$RS\"" 100 "$CART" null 150)
ok  "refund the bread" "$(refund $TXS $BR)"
eq  "part refund keeps the use" "$(red $RS)" "partially_refunded"
ok  "refund the milk too" "$(refund $TXS $M1)"
eq  "full refund frees the use" "$(red $RS)" "refunded"
eq  "refunded amount kept" "$(sql "select refunded_amount from promotion_redemptions where id='$RS'")" "150.00"

echo "--- online shop shares the table"
has "online: till-only code refused" "$(sql "select fn_promo_value(p, 500, NULL) from website_promo_codes p where code='MILK10' and business_id='$B1'")" "only be used in our shop"
ok  "online code" "$(save '{"name":"Web","code":"WEB5","promoType":"percentage","value":5,"useOnline":true,"usePos":false}')"
eq  "online: value works" "$(sql "select fn_promo_value(p, 500, NULL) from website_promo_codes p where code='WEB5'")" "25.00"
has "till: online-only code refused" "$(check WEB5 "$CART")" "online shop only"

echo "--- manage and report"
ok  "switch off" "$(as mgr "select set_promotion_status(id,'deactivate') from website_promo_codes where code='SPEND1000'")"
has "inactive refused" "$(check SPEND1000 "$CART")" "switched off"
ok  "archive" "$(as mgr "select set_promotion_status(id,'archive') from website_promo_codes where code='OLD5'")"
has "archived refused" "$(check OLD5 "$CART")" "archived"
D=$(as mgr "select promotion_dashboard('$B1', current_date, current_date)")
eq  "dashboard: uses (MILK10 + VIP; refunded SAVE100 left out)" "$(echo $D | python3 -c "import json,sys;print(json.load(sys.stdin)['totals']['redemptions'])")" "2"
eq  "dashboard: discount total" "$(echo $D | num "d['totals']['discount']")" "70.00"
eq  "dashboard: gross vs net" "$(echo $D | num "(d['totals']['grossSales'],d['totals']['netSales'])")" "500.00 430.00"
eq  "dashboard: per product milk discount (20 + 40 of VIP)" "$(echo $D | num "[p['discount'] for p in d['byProduct'] if p['name']=='Milk 1L'][0]")" "60.00"
eq  "list shows uses" "$(as mgr "select x->>'uses' from jsonb_array_elements(promotions_list('$B1')) x where x->>'code'='MILK10'")" "1"

eq  "dashboard: refunds counted apart" "$(echo $D | num "d['refunds']['count']")" "1"
echo; echo "$PASS passed, $FAIL failed"; [ $FAIL -eq 0 ]
