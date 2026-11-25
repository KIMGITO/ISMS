#!/bin/bash
# SaaS step 5 (20261204003): plan page prices and cost estimates, sign-up and plan-change
# requests, join codes and join requests, invitations accepted from the start screen.
#   C=supabase_db_isms-seedtest bash supabase/tests/promotions/rebuild.sh
#   C=supabase_db_isms-seedtest bash supabase/tests/saas/signup_test.sh
HERE=$(cd "$(dirname "$0")" && pwd)
source "$HERE/../promotions/lib.sh"
UID_OF[admin]=a9000000-0000-0000-0000-000000000000
UID_OF[joe]=a6000000-0000-0000-0000-000000000000
UID_OF[ivy]=a5000000-0000-0000-0000-000000000000
UID_OF[guess]=a4000000-0000-0000-0000-000000000000
B1=b1000000-0000-0000-0000-000000000000

sql "
INSERT INTO auth.users (id, email, aud, role) VALUES
 ('${UID_OF[admin]}','admin@t.test','authenticated','authenticated'),
 ('${UID_OF[joe]}','joe@t.test','authenticated','authenticated'),
 ('${UID_OF[ivy]}','ivy@t.test','authenticated','authenticated'),
 ('${UID_OF[guess]}','guess@t.test','authenticated','authenticated') ON CONFLICT DO NOTHING;
SET session_replication_role = replica;
INSERT INTO auth.users (id, email, aud, role) VALUES
 ('${UID_OF[owner]}','owner@t.test','authenticated','authenticated') ON CONFLICT DO NOTHING;
SET session_replication_role = DEFAULT;
INSERT INTO public.users (id, auth_user_id, name, email, verified_email) VALUES
 ('00000000-0000-0000-0000-0000000000a9','${UID_OF[admin]}','Pat Platform','admin@t.test','admin@t.test'),
 ('00000000-0000-0000-0000-0000000000a6','${UID_OF[joe]}','Joe Joiner','joe@t.test','joe@t.test'),
 ('00000000-0000-0000-0000-0000000000a5','${UID_OF[ivy]}','Ivy Invited','ivy@t.test','ivy@t.test'),
 ('00000000-0000-0000-0000-0000000000a4','${UID_OF[guess]}','Gus Guesser','guess@t.test','guess@t.test') ON CONFLICT DO NOTHING;
UPDATE public.users SET verified_email = email WHERE auth_user_id IN ('${UID_OF[owner]}','${UID_OF[joe]}','${UID_OF[ivy]}','${UID_OF[guess]}','${UID_OF[admin]}');
INSERT INTO public.platform_admins (auth_user_id, name) VALUES ('${UID_OF[admin]}', 'Pat') ON CONFLICT DO NOTHING;" >/dev/null
T=$(sql "select tenant_id from businesses where id='$B1'")

echo "--- plan page: prices and estimates"
eq "cost estimates are readable" "$(as joe "select count(*) > 0 from provider_cost_estimates")" "t"
has "an owner can't edit estimates" "$(as owner "select platform_save_cost_estimate('{\"provider\":\"X\",\"item\":\"Y\",\"basis\":\"free\"}')")" "Only the platform admin"
ID=$(as admin "select platform_save_cost_estimate('{\"provider\":\"Bank\",\"item\":\"Transfer fee\",\"basis\":\"per_month\",\"amount\":100.555}')")
eq "the admin adds an estimate (money rounded)" "$(sql "select amount from provider_cost_estimates where id='$ID'")" "100.56"
as admin "select platform_save_cost_estimate('{\"id\":\"$ID\",\"active\":false}')" >/dev/null
eq "a switched-off estimate is hidden" "$(as joe "select count(*) from provider_cost_estimates where id='$ID'")" "0"
has "an owner can't change prices" "$(as owner "select platform_update_plan_prices('pro', 1, 1, null, 0)")" "Only the platform admin"
as admin "select platform_update_plan_prices('pro', 6000, 60000, null, 2500)" >/dev/null
eq "the admin sets a set-up fee" "$(as joe "select setup_fee from plans where code='pro'")" "2500.00"
as admin "select platform_update_addon_prices('ai', 2000, 20000)" >/dev/null
eq "the admin prices an add-on" "$(as joe "select addon_monthly_price from plan_modules where key='ai'")" "2000.00"
as admin "select platform_update_settings('{\"vat_percent\":16,\"payment_instructions\":\"Pay to till 123456\"}')" >/dev/null
eq "plan page settings for anyone signed in" "$(as joe "select get_plan_page_settings()->>'vat_percent'")" "16.00"
has "terms must be a https link" "$(as admin "select platform_update_settings('{\"terms_url\":\"javascript:alert(1)\"}')")" "violates check"

echo "--- join codes"
has "a cashier can't make a join code" "$(as cash "select create_join_code('$B1')")" "permission to invite"
CODE=$(as owner "select create_join_code('$B1')->>'code'")
has "the owner makes an 8-letter code" "$CODE" "$(grep -oE '^[A-HJ-NP-Z2-9]{8}$' <<<"$CODE")"
eq "a cashier can't read it" "$(as cash "select get_join_code('$B1')" | grep -c 'permission')" "1"
eq "nobody reads the codes table" "$(as owner "select count(*) from business_join_codes" | grep -c 'permission denied')" "1"
has "a wrong code says nothing" "$(as joe "select redeem_join_code('ABCDEFGH')")" "not valid"
R=$(as joe "select redeem_join_code('${CODE:0:4}-${CODE:4:4}', 'Joe J', '0700000000')")
has "the right code (with a dash) names the business" "$R" "business_name"
REQ=$(as joe "select redeem_join_code('$CODE')->>'request_id'")
eq "entering it again keeps one request" "$(sql "select count(*) from join_requests where auth_user_id='${UID_OF[joe]}'")" "1"
eq "joe sees the request waiting" "$(as joe "select my_signup_state()->'join_requests'->0->>'status'")" "pending"
eq "the owner sees it" "$(as owner "select count(*) from join_requests where business_id='$B1' and status='pending'")" "1"
eq "a cashier doesn't" "$(as cash "select count(*) from join_requests where business_id='$B1'")" "0"
eq "another person doesn't" "$(as ivy "select count(*) from join_requests")" "0"
has "a cashier can't let joe in" "$(as cash "select decide_join_request('$REQ', true, 'Cashier')")" "permission to add staff"
has "no second owner" "$(as owner "select decide_join_request('$REQ', true, 'Owner')")" "one owner"
has "a made-up role is refused" "$(as owner "select decide_join_request('$REQ', true, 'Boss')")" "Choose a role"
ok "the owner lets joe in as cashier" "$(as owner "select decide_join_request('$REQ', true, 'Cashier')")"
eq "joe is a member" "$(sql "select m.role||'/'||m.status from business_memberships m join users u on u.id=m.user_id where u.auth_user_id='${UID_OF[joe]}' and m.business_id='$B1'")" "Cashier/Active"
eq "joe has a staff row" "$(sql "select count(*) from employees e join users u on u.id=e.user_id where u.auth_user_id='${UID_OF[joe]}' and e.business_id='$B1' and e.deleted_at is null")" "1"
has "answered twice is refused" "$(as owner "select decide_join_request('$REQ', false)")" "already been answered"
has "joe can't join again" "$(as joe "select redeem_join_code('$CODE')")" "already in this business"
R2=$(as ivy "select redeem_join_code('$CODE')->>'request_id'")
ok "the owner turns ivy away" "$(as owner "select decide_join_request('$R2', false)")"
eq "ivy sees she was turned away" "$(as ivy "select my_signup_state()->'join_requests'->0->>'status'")" "rejected"
NEW=$(as owner "select create_join_code('$B1', 3)->>'code'")
has "a new code replaces the old" "$(as ivy "select redeem_join_code('$CODE')")" "not valid"
as owner "select revoke_join_code('$B1')" >/dev/null
has "a revoked code stops working" "$(as ivy "select redeem_join_code('$NEW')")" "not valid"
eq "no live code after revoking" "$(as owner "select get_join_code('$B1') is null")" "t"
has "codes last 1 to 30 days" "$(as owner "select create_join_code('$B1', 90)")" "1 to 30 days"
for i in $(seq 1 10); do as guess "select redeem_join_code('ZZZZZZZZ')" >/dev/null; done
has "guessing is limited" "$(as guess "select redeem_join_code('ZZZZZZZZ')")" "Too many tries"
sql "update users set verified_email = null where auth_user_id='${UID_OF[ivy]}'" >/dev/null
has "an unverified email can't use a code" "$(as ivy "select redeem_join_code('ABCDEFGH')")" "verify your email"
sql "update users set verified_email = email where auth_user_id='${UID_OF[ivy]}'" >/dev/null

echo "--- invitations from the start screen"
INV=$(sql "insert into invitations (business_id, name, email, role) values ('$B1','Ivy','IVY@t.test','Manager') returning id" | head -1)
eq "ivy sees her invitation" "$(as ivy "select my_signup_state()->'invites'->0->>'role'")" "Manager"
eq "joe doesn't see it" "$(as joe "select jsonb_array_length(my_signup_state()->'invites')")" "0"
has "joe can't accept ivy's invitation" "$(as joe "select accept_my_invitation('$INV')")" "expired or was cancelled"
eq "ivy accepts without the code" "$(as ivy "select accept_my_invitation('$INV')")" "$B1"
eq "ivy is a manager" "$(sql "select m.role from business_memberships m join users u on u.id=m.user_id where u.auth_user_id='${UID_OF[ivy]}' and m.business_id='$B1'")" "Manager"
has "the invitation is used up" "$(as ivy "select accept_my_invitation('$INV')")" "expired or was cancelled"

echo "--- sign-up requests"
S=$(as guess "select request_business_signup('pro', 'monthly', 'Gus Shop', '0711', null, '{ai}', 'QWE123RTY')")
ok "a request with the payment reference" "$S"
eq "the start screen shows it" "$(as guess "select my_signup_state()->'request'->>'payment_reference'")" "QWE123RTY"
has "an empty business name is refused" "$(as joe "select request_business_signup('pro', 'monthly', '  ')")" "business name"

echo "--- plan changes"
has "only the company owner asks" "$(as mgr "select request_plan_change('$B1', 'pro', 'annual')")" "Only the owner"
has "no trial by request" "$(as owner "select request_plan_change('$B1', 'trial', 'monthly')")" "Choose one of the plans"
has "add-ons only on Pro" "$(as owner "select request_plan_change('$B1', 'starter', 'monthly', '{ai}')")" "only be added to the Pro"
PC=$(as owner "select request_plan_change('$B1', 'pro', 'annual', '{ai}', 'MPESA1')")
eq "the owner sees the request" "$(as owner "select my_plan_request('$B1')->>'status'")" "pending"
eq "it is not a new-company request" "$(as owner "select my_signup_state()->'request'")" "null"
has "one open request at a time" "$(as owner "select request_plan_change('$B1', 'starter', 'monthly')")" "already have a request"
has "approving waits for the payment" "$(as admin "select platform_decide_signup('$PC', true, 'Paid')")" "Record their payment first"
A=$(sql "select fn_platform_rate('pro','annual','{ai}',null)->>'year'")
ok "the admin records the year's payment" "$(as admin "select platform_record_payment('{\"request_id\":\"$PC\",\"amount\":$A,\"method\":\"M-Pesa\",\"reference\":\"MPESA1\"}')")"
ok "the admin approves" "$(as admin "select platform_decide_signup('$PC', true, 'Paid')")"
eq "the company is on Pro now" "$(as owner "select get_plan_usage('$B1')->>'plan'")" "pro"
eq "with the add-on" "$(as owner "select get_plan_usage('$B1')->'addons'->>0")" "ai"
eq "paid for a year, from the payment" "$(sql "select ((current_period_end at time zone 'Africa/Nairobi')::date - fn_platform_today())::text from tenant_subscriptions where tenant_id='$T'")" "365"
eq "the request is used" "$(sql "select status from signup_requests where id='$PC'")" "used"
eq "no open request is shown" "$(as owner "select my_plan_request('$B1')")" ""
as admin "select platform_set_suspended('$T', false); select platform_change_plan('$T','pro_plus','manual')" >/dev/null

echo
echo "signup: $PASS passed, $FAIL failed"
[ $FAIL -eq 0 ]
