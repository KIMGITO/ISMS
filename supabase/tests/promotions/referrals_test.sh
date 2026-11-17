#!/bin/bash
# Referral programme and accounting acceptance tests. Run after promotions_test.sh on a fresh build.
source "$(dirname "$0")/lib.sh"
B1=b1000000-0000-0000-0000-000000000000
M1=d1000000-0000-0000-0000-000000000000; BR=d3000000-0000-0000-0000-000000000000
ALICE=c1000000-0000-0000-0000-000000000000
EMP=e2000000-0000-0000-0000-000000000000
item(){ echo "{\"product_id\":\"$1\",\"quantity\":$2,\"unit_price\":$3,\"discount_percentage\":0}"; }
CART="[$(item $M1 2 100),$(item $BR 1 50)]"     # 250
SMALL="[$(item $BR 1 50)]"
field(){ python3 -c "import json,sys; d=json.loads(sys.stdin.read()); v=d.get('$1'); print(f'{v:.2f}' if isinstance(v,(int,float)) and not isinstance(v,bool) else v)"; }
newcust(){ sql "insert into customers (business_id, name, phone, created_at) values ('$B1', '$1', $2, now() - interval '${3:-0} days') returning id"; }
check(){ as cash "select promo_check('$B1', '$1', ${3:-NULL}, '$2'::jsonb, 0)"; }
reserve(){ as cash "select promo_reserve('$B1', '$1', ${3:-NULL}, '$2'::jsonb, 0)"; }
sale(){ # sale <redemption> <discount> <customer> <items> <final>
  as cash "select record_till_sale('{\"business_id\":\"$B1\",\"total\":250,\"discount\":$2,\"tax\":0,\"final_total\":$5,\"payment_method\":\"Cash\",\"staff_name\":\"Carl\",\"staff_id\":\"$EMP\",\"customer_id\":\"$3\",\"promotion_redemption_id\":\"$1\"}'::jsonb, '$4'::jsonb)"; }
refer(){ # refer <code> <customer> -> transaction id (full flow at the till)
  local R; R=$(reserve "$1" "$CART" "'$2'"); local RID=$(echo "$R" | field redemptionId); local D=$(echo "$R" | field discount)
  sale "$RID" "$D" "$2" "$CART" "$(python3 -c "print(250-$D)")"; }
camp(){ as mgr "select save_referral_campaign('$B1', $1, '$2'::jsonb)"; }
ref_status(){ sql "select status from referrals where referred_customer_id='$1' order by created_at desc limit 1"; }
wallet(){ sql "select wallet_balance from customers where id='$1'"; }
acct(){ sql "select coalesce(sum(l.debit - l.credit),0)::numeric(14,2) from acc_lines l join acc_accounts a on a.id=l.account_id where a.business_id='$B1' and a.system_key='$1'"; }

echo "--- set-up and permissions"
DOC='{"name":"Bring a friend","referrerKind":"wallet","referrerValue":100,"welcomeKind":"amount","welcomeValue":50,"minPurchase":200,"holdDays":0,"reviewFlagged":false}'
has "cashier can't set up referrals" "$(as cash "select save_referral_campaign('$B1', NULL, '$DOC'::jsonb)")" "permission"
K=$(camp NULL "$DOC"); ok "manager starts a programme" "$K"
sql "insert into loyalty_settings (business_id, points_enabled) values ('$B1', false) on conflict (business_id) do update set points_enabled = false" >/dev/null
has "points reward refused while points are off" "$(camp NULL '{"name":"P","referrerKind":"points","referrerValue":500,"welcomeKind":"amount","welcomeValue":10}')" "points are switched off"
sql "update loyalty_settings set points_enabled = true where business_id='$B1'" >/dev/null
eq  "the programme running is still the first" "$(sql "select name from referral_campaigns where active and business_id='$B1'")" "Bring a friend"
CODE=$(as cash "select customer_referral('$ALICE')" | field code); has "Alice gets a code from her name" "$CODE" "ALICE"
eq  "same code next time" "$(as cash "select customer_referral('$ALICE')" | field code)" "$CODE"
has "code typed in any case" "$(check "$(echo $CODE | tr A-Z a-z)" "$CART")" "new customer"
has "cashier can't give rewards directly" "$(as cash "select fn_referral_issue(gen_random_uuid(), 'x')")" "permission denied"
has "cashier can't write rewards (RLS)" "$(as cash "insert into referral_rewards (business_id, referral_id, campaign_id, customer_id, side, kind, status) values ('$B1', gen_random_uuid(), '$K', '$ALICE', 'referrer', 'wallet', 'issued')")" "ERROR"
has "promotion can't take a referral code" "$(as mgr "select save_promotion('$B1', NULL, '{\"name\":\"x\",\"code\":\"$CODE\",\"promoType\":\"fixed\",\"value\":5}')")" "referral code"

echo "--- fraud rules"
has "self referral"          "$(check $CODE "$CART" "'$ALICE'")" "own referral code"
EVE=$(newcust "Eve Twin" "'+254 711 000 001'")
has "same phone as referrer (other format)" "$(check $CODE "$CART" "'$EVE'")" "same phone or email"
FAY=$(newcust "Fay Nophone" "''")
has "phone required"         "$(check $CODE "$CART" "'$FAY'")" "phone number first"
GUS=$(newcust "Gus Old" "'0733000009'" 60)
has "existing customer excluded" "$(check $CODE "$CART" "'$GUS'")" "more than 30 days"
IVY=$(newcust "Ivy Dup" "'0711000002'")
has "duplicate of another customer" "$(check $CODE "$CART" "'$IVY'")" "already belongs to Bob New"
has "has bought before"      "$(check $CODE "$CART" "'c3000000-0000-0000-0000-000000000000'")" "isn't a new customer"

echo "--- two-sided reward"
DAN=$(newcust "Dan New" "'0722000004'")
has "minimum purchase"       "$(check $CODE "$SMALL" "'$DAN'")" "Spend at least KSh 200"
R=$(check $CODE "$CART" "'$DAN'"); eq "welcome discount 50" "$(echo $R | field discount)" "50.00"
has "  ...shows referrer by first name only" "$R" '"referrer": "Alice O."'
W0=$(wallet $ALICE); TX=$(refer $CODE $DAN); ok "first purchase saved" "$TX"
eq  "referral rewarded (no wait)" "$(ref_status $DAN)" "rewarded"
eq  "referrer wallet +100" "$(python3 -c "print(f'{$(wallet $ALICE)-$W0:.2f}')")" "100.00"
eq  "rewards recorded once per side" "$(sql "select string_agg(r.side||':'||r.kind||':'||r.status, ',' order by r.side) from referral_rewards r join referrals f on f.id=r.referral_id where f.referred_customer_id='$DAN'")" "referred:discount_at_sale:used,referrer:wallet:issued"
ok  "issuing again does nothing" "$(sql "select fn_referral_issue(id) from referrals where referred_customer_id='$DAN'")"
eq  "  ...wallet still +100" "$(python3 -c "print(f'{$(wallet $ALICE)-$W0:.2f}')")" "100.00"
eq  "wallet ledger row" "$(sql "select count(*) from customer_ledger where customer_id='$ALICE' and type='referral_reward'")" "1"
has "same new customer can't be referred again" "$(check $CODE "$CART" "'$DAN'")" "bought before"

echo "--- books"
eq  "Referral rewards expense 100" "$(acct referral_rewards)" "100.00"
eq  "Promotion discounts 50 on Dan's sale (debit)" "$(sql "select coalesce(sum(l.debit-l.credit),0) from acc_lines l join acc_accounts a on a.id=l.account_id join acc_entries e on e.id=l.entry_id where e.source_id='$TX' and a.system_key='promo_discounts'")" "50.00"
eq  "Sales credited at price before code (250)" "$(sql "select coalesce(sum(l.credit),0) from acc_lines l join acc_accounts a on a.id=l.account_id join acc_entries e on e.id=l.entry_id where e.source_id='$TX' and a.system_key='sales'")" "250.00"
eq  "Sale entry balances" "$(sql "select sum(debit)-sum(credit) from acc_lines l join acc_entries e on e.id=l.entry_id where e.source_id='$TX'")" "0.00"
eq  "Books balance overall" "$(sql "select sum(debit)-sum(credit) from acc_lines where business_id='$B1'")" "0.00"
eq  "No posting errors" "$(sql "select count(*) from acc_post_errors where business_id='$B1'")" "0"

echo "--- refund after reward takes it back"
ok  "refund Dan's first purchase" "$(refund $TX)"
eq  "referral cancelled" "$(ref_status $DAN)" "cancelled"
eq  "  ...flagged refunded after reward" "$(sql "select 'refunded_after_reward' = any(flags) from referrals where referred_customer_id='$DAN'")" "t"
eq  "  ...wallet credit taken back" "$(python3 -c "print(f'{$(wallet $ALICE)-$W0:.2f}')")" "0.00"
eq  "  ...books follow (expense back to 0)" "$(acct referral_rewards)" "0.00"
eq  "  ...books still balance" "$(sql "select sum(debit)-sum(credit) from acc_lines where business_id='$B1'")" "0.00"

echo "--- waiting period, review, suspend"
camp "'$K'" '{"name":"Bring a friend","referrerKind":"wallet","referrerValue":100,"welcomeKind":"amount","welcomeValue":50,"minPurchase":200,"holdDays":3,"reviewFlagged":false}' >/dev/null
ENA=$(newcust "Ena Wait" "'0722000005'"); TX=$(refer $CODE $ENA); ok "sale with 3-day wait" "$TX"
eq  "qualified, not yet rewarded" "$(ref_status $ENA)" "qualified"
sql "select run_referral_jobs()" >/dev/null; eq "job waits for the 3 days" "$(ref_status $ENA)" "qualified"
sql "update referrals set reward_due_at = now() - interval '1 minute' where referred_customer_id='$ENA'" >/dev/null
sql "select run_referral_jobs()" >/dev/null; eq "job pays when due" "$(ref_status $ENA)" "rewarded"
FIN=$(newcust "Fin Cancel" "'0722000006'"); TX=$(refer $CODE $FIN)
ok  "cancel before reward" "$(as owner "update transactions set deleted_at=now() where id='$TX'")"
eq  "  ...referral cancelled, no reward" "$(ref_status $FIN):$(sql "select count(*) from referral_rewards r join referrals f on f.id=r.referral_id where f.referred_customer_id='$FIN' and r.status in ('issued','used')")" "cancelled:0"
camp "'$K'" '{"name":"Bring a friend","referrerKind":"wallet","referrerValue":100,"welcomeKind":"amount","welcomeValue":50,"minPurchase":200,"holdDays":0,"reviewFlagged":true}' >/dev/null
GIL=$(newcust "Gil Review" "'0722000007'"); refer $CODE $GIL >/dev/null
eq  "flagged referral waits for a manager" "$(ref_status $GIL)" "qualified"
has "  ...flags say why" "$(sql "select flags from referrals where referred_customer_id='$GIL'")" "added_at_the_till"
GID=$(sql "select id from referrals where referred_customer_id='$GIL'")
has "cashier can't approve" "$(as cash "select decide_referral('$GID', true)")" "permission"
ok  "manager approves" "$(as mgr "select decide_referral(id, true) from referrals where referred_customer_id='$GIL'")"
eq  "  ...rewarded" "$(ref_status $GIL)" "rewarded"
HAL=$(newcust "Hal Reject" "'0722000008'"); refer $CODE $HAL >/dev/null
has "reject needs a reason" "$(as mgr "select decide_referral(id, false, '') from referrals where referred_customer_id='$HAL'")" "Say why"
ok  "manager rejects" "$(as mgr "select decide_referral(id, false, 'Same household') from referrals where referred_customer_id='$HAL'")"
eq  "  ...rejected, no referrer reward" "$(ref_status $HAL):$(sql "select count(*) from referral_rewards r join referrals f on f.id=r.referral_id where f.referred_customer_id='$HAL' and r.side='referrer'")" "rejected:0"
CID=$(sql "select id from referral_codes where code='$CODE'")
ok  "suspend Alice's code" "$(as mgr "select set_referral_code_status('$CID', 'suspended', 'Checking')")"
JOY=$(newcust "Joy Held" "'0722000010'")
has "suspended code refused" "$(check $CODE "$CART" "'$JOY'")" "on hold"
ok  "restore" "$(as mgr "select set_referral_code_status('$CID', 'active', NULL)")"

echo "--- limits"
camp "'$K'" '{"name":"Bring a friend","referrerKind":"wallet","referrerValue":100,"welcomeKind":"amount","welcomeValue":50,"minPurchase":200,"holdDays":0,"reviewFlagged":false,"maxPerReferrer":2}' >/dev/null
has "max per referrer (Ena + Gil; cancelled and rejected don't count)" "$(check $CODE "$CART" "'$JOY'")" "most referrals this programme allows (2)"
KIM=$(newcust "Kim Base" "'0722000011'" ); BCODE=$(as cash "select customer_referral('$KIM')" | field code)
camp "'$K'" '{"name":"Bring a friend","referrerKind":"wallet","referrerValue":100,"welcomeKind":"amount","welcomeValue":50,"minPurchase":200,"holdDays":0,"reviewFlagged":false,"maxTotal":3}' >/dev/null
L1=$(newcust "Lee One" "'0722000012'"); L2=$(newcust "Lou Two" "'0722000013'")
(reserve $BCODE "$CART" "'$L1'" > ${TMPDIR:-/tmp}/promo_rc1.txt) & (reserve $BCODE "$CART" "'$L2'" > ${TMPDIR:-/tmp}/promo_rc2.txt) & wait
eq  "concurrency: programme limit holds (1 of 2 tills)" "$(cat ${TMPDIR:-/tmp}/promo_rc1.txt ${TMPDIR:-/tmp}/promo_rc2.txt | grep -c 'programme is full')" "1"
rm -f ${TMPDIR:-/tmp}/promo_rc*.txt

echo "--- other reward kinds"
camp NULL '{"name":"Codes","referrerKind":"free_product","referrerProductId":"'$BR'","referrerQty":1,"welcomeKind":"wallet","welcomeValue":30,"minPurchase":100,"holdDays":0,"reviewFlagged":false,"rewardExpiryDays":30}' >/dev/null
MO=$(newcust "Mo Free" "'0722000014'"); refer $BCODE $MO >/dev/null
eq  "new customer got wallet welcome" "$(wallet $MO)" "30.00"
RW=$(sql "select p.code from referral_rewards r join website_promo_codes p on p.id=r.promotion_id where r.customer_id='$KIM' and r.kind='free_product'")
has "referrer got a personal free-bread code" "$RW" "RW"
has "  ...only Kim can use it" "$(check $RW "$CART" "'$MO'")" "can't use this code"
R=$(reserve $RW "$CART" "'$KIM'"); eq "  ...Kim's bread free" "$(echo $R | field discount)" "50.00"
TXK=$(sale "$(echo $R | field redemptionId)" 50 "$KIM" "$CART" 200); ok "  ...used at the till" "$TXK"
eq  "  ...reward marked used" "$(sql "select status from referral_rewards where customer_id='$KIM' and kind='free_product'")" "used"
has "  ...and can't be used twice" "$(check $RW "$CART" "'$KIM'")" "fully used"

echo "--- customer views"
sql "update businesses set website_slug='main' where id='$B1'; insert into auth.users (id, email, aud, role) values ('a4000000-0000-0000-0000-000000000000','alice@t.test','authenticated','authenticated') on conflict do nothing; insert into customer_accounts (id, business_id, customer_id, name, phone) values ('a4000000-0000-0000-0000-000000000000','$B1','$KIM','Kim','0722000011') on conflict do nothing" >/dev/null
MY=$(docker exec -i $C psql -U supabase_admin -d $DB -tAq <<<"SET request.jwt.claims = '{\"sub\":\"a4000000-0000-0000-0000-000000000000\",\"role\":\"authenticated\"}'; SET role authenticated; select my_referral('main')" 2>&1)
eq  "website: own code" "$(echo $MY | field code)" "$BCODE"
has "website: friends by first name + initial" "$MY" '"Mo F."'
has "website: no phone numbers of others" "$(echo $MY | grep -c 0722)" "0"
has "website: invited count (Mo + Lou waiting)" "$MY" '"invited": 2'

echo "--- dashboard"
D=$(as mgr "select referral_dashboard('$B1', current_date - 1, current_date)")
has "dashboard: costs include wallet" "$D" '"wallet": 230'
has "dashboard: top referrers" "$D" '"topReferrers"'
has "cashier can't see dashboard" "$(as cash "select referral_dashboard('$B1', current_date, current_date)")" "permission"
eq  "books still balance at the end" "$(sql "select sum(debit)-sum(credit) from acc_lines where business_id='$B1'")" "0.00"
eq  "no posting errors at the end" "$(sql "select count(*) from acc_post_errors where business_id='$B1'")" "0"
echo; echo "$PASS passed, $FAIL failed"; [ $FAIL -eq 0 ]
