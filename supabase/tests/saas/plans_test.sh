#!/bin/bash
# SaaS plans (20261204001): platform admin, companies (tenants), plans, modules, branch and staff
# limits, read-only, trial switch, sign-up requests and separation between companies.
#   C=supabase_db_isms-seedtest bash supabase/tests/promotions/rebuild.sh
#   C=supabase_db_isms-seedtest bash supabase/tests/saas/plans_test.sh
HERE=$(cd "$(dirname "$0")" && pwd)
source "$HERE/../promotions/lib.sh"
UID_OF[admin]=a9000000-0000-0000-0000-000000000000
UID_OF[newbie]=a8000000-0000-0000-0000-000000000000
UID_OF[late]=a7000000-0000-0000-0000-000000000000
B1=b1000000-0000-0000-0000-000000000000
B2=b2000000-0000-0000-0000-000000000000
EMP=e2000000-0000-0000-0000-000000000000
BR=d3000000-0000-0000-0000-000000000000
uuid(){ grep -oE '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' <<<"$1" | head -1; }
newbiz(){ as "$1" "select create_business_with_owner('$2','Retail','Kenya','Ksh','','','' ${3:+, $3})"; }
item(){ echo "{\"product_id\":\"$1\",\"product_name\":\"Bread\",\"quantity\":$2,\"unit_price\":$3,\"discount_percentage\":0}"; }
sale(){ as cash "select record_till_sale('{\"business_id\":\"$B1\",\"total\":50,\"discount\":0,\"tax\":0,\"final_total\":50,\"payment_method\":\"Cash\",\"staff_name\":\"Carl\",\"staff_id\":\"$EMP\"}'::jsonb, '[$(item $BR 1 50)]'::jsonb)"; }

sql "
INSERT INTO auth.users (id, email, aud, role) VALUES
 ('${UID_OF[admin]}','admin@t.test','authenticated','authenticated'),
 ('${UID_OF[newbie]}','newbie@t.test','authenticated','authenticated'),
 ('${UID_OF[late]}','late@t.test','authenticated','authenticated') ON CONFLICT DO NOTHING;
-- The shared fixture's clean-up removes the owner's sign-in row; put it back.
-- (Triggers off for this one row: its public.users row already exists.)
SET session_replication_role = replica;
INSERT INTO auth.users (id, email, aud, role) VALUES
 ('${UID_OF[owner]}','owner@t.test','authenticated','authenticated') ON CONFLICT DO NOTHING;
SET session_replication_role = DEFAULT;
INSERT INTO public.users (id, auth_user_id, name, email, verified_email) VALUES
 ('00000000-0000-0000-0000-0000000000a9','${UID_OF[admin]}','Pat Platform','admin@t.test','admin@t.test'),
 ('00000000-0000-0000-0000-0000000000a8','${UID_OF[newbie]}','Nina New','newbie@t.test','newbie@t.test'),
 ('00000000-0000-0000-0000-0000000000a7','${UID_OF[late]}','Leo Late','late@t.test','late@t.test') ON CONFLICT DO NOTHING;
UPDATE public.users SET verified_email = email WHERE auth_user_id IN ('${UID_OF[owner]}','${UID_OF[admin]}','${UID_OF[newbie]}','${UID_OF[late]}');
INSERT INTO public.platform_admins (auth_user_id, name) VALUES ('${UID_OF[admin]}', 'Pat') ON CONFLICT DO NOTHING;" >/dev/null
T=$(sql "select tenant_id from businesses where id='$B1'")

echo "--- one company, platform admin"
eq "both branches are one company" "$(sql "select tenant_id from businesses where id='$B2'")" "$T"
eq "transfers see the branches as one company" "$(sql "select fn_branches_share_owner('$B1','$B2')")" "t"
eq "the owner is not the platform admin" "$(as owner "select is_platform_admin()")" "f"
eq "the platform admin is" "$(as admin "select is_platform_admin()")" "t"
has "an owner can't change plans" "$(as owner "select platform_change_plan('$T','pro_plus','manual')")" "Only the platform admin"
has "an owner can't list companies" "$(as owner "select * from platform_tenants()")" "Only the platform admin"
has "an owner can't edit the subscription" "$(as owner "update tenant_subscriptions set plan_code='pro_plus'")" "permission denied"
has "plan internals are not for app users" "$(as owner "select fn_tenant_plan('$T')")" "permission denied"
has "an owner can't move a branch to another company" "$(as owner "update businesses set tenant_id='$(sql "select gen_random_uuid()")' where id='$B1'")" "can't be moved"

echo "--- Starter: core only"
W=$(as admin "select platform_change_plan('$T','starter','manual')")
has "admin puts the company on Starter, with a warning" "$W" "2 branches open"
eq "Starter: books locked for the owner" "$(as owner "select has_permission('$B1','accounting.view')")" "f"
eq "Starter: promotions locked" "$(as owner "select has_permission('$B1','promotions.view')")" "f"
eq "Starter: AI locked" "$(as owner "select has_permission('$B1','ai.use')")" "f"
eq "Starter: customers (core) open" "$(as owner "select has_permission('$B1','customers.view')")" "t"
eq "Starter: one open permission of several is enough" "$(as owner "select has_permission('$B1','promotions.view','customers.view')")" "t"
eq "Starter: the manager can't see buying" "$(as mgr "select has_permission('$B1','purchases.view')")" "f"
eq "usage shows the plan" "$(as cash "select get_plan_usage('$B1')->>'plan'")" "starter"
eq "usage counts branches" "$(as cash "select get_plan_usage('$B1')->>'branches_used'")" "2"
eq "usage counts staff (not the owner or rider)" "$(as owner "select get_plan_usage('$B1')->>'staff_used'")" "2"
has "Starter: a new branch is refused" "$(newbiz owner Third)" "allows 1 branch"
ok "Starter: a third staff member can be invited" "$(as owner "insert into invitations (business_id,name,email,role) values ('$B1','Sam','sam@t.test','Cashier')")"
has "Starter: a fourth is refused" "$(as owner "insert into invitations (business_id,name,email,role) values ('$B1','Tom','tom@t.test','Cashier')")" "allows 3 staff"
ok "riders don't count" "$(as owner "insert into invitations (business_id,name,email,role) values ('$B1','Rae','rae@t.test','Rider')")"
S=$(uuid "$(sale)")
ok "Starter: the cashier still sells" "$S"
eq "the books still post with accounting locked" "$(sql "select count(*) > 0 from acc_entries where source_id = '$S'")" "t"

echo "--- Pro and add-ons"
ok "admin moves the company to Pro" "$(as admin "select platform_change_plan('$T','pro','manual')")"
eq "Pro: promotions open" "$(as owner "select has_permission('$B1','promotions.view')")" "t"
eq "Pro: books still locked" "$(as owner "select has_permission('$B1','accounting.view')")" "f"
ok "Pro: books bought as an add-on" "$(as admin "select platform_set_addons('$T', array['accounting'])")"
eq "Pro + add-on: books open" "$(as owner "select has_permission('$B1','accounting.view')")" "t"
eq "Pro + add-on: online store still locked" "$(as owner "select has_permission('$B1','online_store.view')")" "f"
has "add-ons are only for modules sold alone" "$(as admin "select platform_set_addons('$T', array['buying'])")" "can't be bought on its own"
N3=$(uuid "$(newbiz owner Third)")
ok "Pro: a third branch" "$N3"
eq "the new branch joins the company" "$(sql "select tenant_id from businesses where id='$N3'")" "$T"
has "Pro: a fourth branch is refused" "$(newbiz owner Fourth)" "allows 3 branches"
ok "custom limit: 5 branches for this company" "$(as admin "select platform_set_custom_limits('$T','{\"max_branches\":5}')")"
ok "now a fourth branch fits" "$(uuid "$(newbiz owner Fourth)")"
has "Starter refuses add-ons" "$(as admin "select platform_change_plan('$T','starter','manual'); select platform_set_addons('$T', array['ai'])")" "only be added to the Pro plan"
eq "moving to Starter dropped the add-on" "$(sql "select cardinality(addons) from tenant_subscriptions where tenant_id='$T'")" "0"
eq "a restored branch over the limit is refused" "$(as owner "update businesses set deleted_at = now() where id='$N3'" >/dev/null; sql "update tenant_subscriptions set custom_limits='{}' where tenant_id='$T'" >/dev/null; as owner "update businesses set deleted_at = null where id='$N3'" | grep -c 'allows 1 branch')" "1"

echo "--- read-only and suspended"
sql "update tenant_subscriptions set plan_code='pro_plus', status='trial', trial_ends_at = now() - interval '1 day' where tenant_id='$T'" >/dev/null
eq "trial over: status read_only" "$(as owner "select get_plan_usage('$B1')->>'status'")" "read_only"
has "read-only: no new customer" "$(as owner "insert into product_categories (business_id,name) values ('$B1','Xena')")" "read-only"
has "read-only: no sale" "$(sale)" "read-only"
eq "read-only: records still readable" "$(as owner "select count(*) > 0 from products where business_id='$B1'")" "t"
ok "read-only: server work (payment callbacks) still records" "$(sql "set role service_role; insert into product_categories (business_id,name) values ('$B1','Server')")"
sql "update tenant_subscriptions set status='active', current_period_end = now() - interval '3 days' where tenant_id='$T'" >/dev/null
eq "paid period just ended: grace" "$(as owner "select get_plan_usage('$B1')->>'status'")" "grace"
ok "grace: still writable" "$(uuid "$(sale)")"
ok "admin suspends" "$(as admin "select platform_set_suspended('$T', true, 'test')")"
has "suspended: writes refused" "$(as owner "insert into product_categories (business_id,name) values ('$B1','Yan')")" "suspended"
ok "admin lets them back in" "$(as admin "select platform_set_suspended('$T', false)")"
ok "and puts them on Pro Plus, free (no end date)" "$(as admin "select platform_change_plan('$T','pro_plus','manual')")"
ok "active again" "$(as owner "insert into product_categories (business_id,name) values ('$B1','Zed')")"

echo "--- a second company on a trial, kept apart"
eq "a newcomer may start a business" "$(as newbie "select can_create_business()")" "t"
NB=$(uuid "$(newbiz newbie 'Nina Shop')")
ok "the newcomer creates a company" "$NB"
TN=$(sql "select tenant_id from businesses where id='$NB'")
[ "$TN" != "$T" ] && eq "it is a new company" ok ok || eq "it is a new company" "$TN" "not $T"
eq "on the trial" "$(as newbie "select get_plan_usage('$NB')->>'status'")" "trial"
eq "the trial is claimed" "$(sql "select count(*) from trial_claims where auth_user_id='${UID_OF[newbie]}'")" "1"
eq "the two companies are not branches of each other" "$(sql "select fn_branches_share_owner('$B1','$NB')")" "f"
has "the newcomer can't read the other company's plan" "$(as newbie "select get_plan_usage('$B1')")" "ERROR"
TABLES=$(sql "select string_agg(format('select %L where exists (select 1 from public.%I where business_id in (''IDS''))', c.relname, c.relname), ' union all ')
  from pg_class c join pg_attribute a on a.attrelid=c.oid and a.attname='business_id' and not a.attisdropped
  where c.relnamespace='public'::regnamespace and c.relkind='r' and has_table_privilege('authenticated', c.oid, 'SELECT')")
eq "the newcomer sees no row of the other company in any table" "$(as newbie "select coalesce(string_agg(x, ','), 'none') from (${TABLES//IDS/$B1\',\'$B2}) s(x)")" "none"
eq "nor does the other company see the newcomer's" "$(as owner "select coalesce(string_agg(x, ','), 'none') from (${TABLES//IDS/$NB}) s(x)")" "none"
eq "the newcomer sees only their own company" "$(as newbie "select count(*) from tenants")" "1"
eq "and only their own subscription" "$(as newbie "select count(*) from tenant_subscriptions")" "1"

echo "--- trial off: request, platform admin approves"
ok "admin switches the trial off" "$(as admin "select platform_update_settings('{\"trial_enabled\":false}')")"
has "an owner can't change platform settings" "$(as owner "select platform_update_settings('{\"trial_enabled\":true}')")" "Only the platform admin"
eq "a newcomer can't start without a plan" "$(as late "select can_create_business()")" "f"
has "creating is refused" "$(newbiz late 'Leo Shop')" "Choose a plan"
R=$(uuid "$(as late "select request_business_signup('pro','monthly','Leo Shop','+254711000001','Bank transfer', array['online_store'])")")
ok "the newcomer asks for Pro with the online store" "$R"
has "one request at a time" "$(as late "select request_business_signup('starter','monthly','Leo Shop')")" "already have a request"
has "Starter has no add-ons" "$(as newbie "select request_business_signup('starter','monthly','X', null, null, array['ai'])")" "only be added to the Pro plan"
has "an owner can't approve" "$(as owner "select platform_decide_signup('$R', true)")" "Only the platform admin"
A=$(sql "select fn_platform_rate('pro','monthly','{online_store}',null)->>'month'")
ok "the admin records a month's bank payment" "$(as admin "select platform_record_payment('{\"request_id\":\"$R\",\"amount\":$A,\"method\":\"Bank\",\"reference\":\"BANK-77\"}')")"
ok "the platform admin approves" "$(as admin "select platform_decide_signup('$R', true, 'Paid by bank')")"
eq "now they may start" "$(as late "select can_create_business()")" "t"
LB=$(uuid "$(newbiz late 'Leo Shop')")
ok "the company is created" "$LB"
eq "on Pro, active" "$(as late "select (get_plan_usage('$LB')->>'plan') || ',' || (get_plan_usage('$LB')->>'status')")" "pro,active"
eq "with the online store add-on" "$(as late "select has_permission('$LB','online_store.view')")" "t"
eq "paid for the days a month's money buys (30)" "$(sql "select ((current_period_end at time zone 'Africa/Nairobi')::date - fn_platform_today())::text from tenant_subscriptions s join businesses b on b.tenant_id=s.tenant_id where b.id='$LB'")" "30"
eq "the request is used" "$(sql "select status from signup_requests where id='$R'")" "used"

echo "--- AI run by the platform (20261204002): caps, plans, own key"
ai(){ sql "select fn_ai_use('$1')->>'$2'"; }
LT=$(sql "select tenant_id from businesses where id='$LB'")
ok "LB on Pro + online store: admin sets Pro without AI" "$(as admin "select platform_set_addons('$LT', array['online_store'])")"
eq "Pro without the AI add-on: refused, not in plan" "$(ai $LB reason)" "not_in_plan"
eq "nothing was counted" "$(sql "select count(*) from ai_usage u join businesses b on b.tenant_id=u.tenant_id where b.id='$LB'")" "0"
ok "AI bought as an add-on" "$(as admin "select platform_set_addons('$LT', array['online_store','ai'])")"
eq "Pro + AI add-on: cap is 50" "$(as late "select get_ai_usage('$LB')->>'cap'")" "50"
ok "admin lowers the cap to 2 for this company" "$(as admin "select platform_set_custom_limits('$LT', '{\"ai_daily_cap\":2}')")"
eq "first request allowed" "$(ai $LB allowed)" "true"
eq "second request allowed" "$(ai $LB used)" "2"
eq "third refused: cap reached" "$(ai $LB reason)" "cap_reached"
eq "the app shows 2 of 2 used" "$(as late "select (get_ai_usage('$LB')->>'used') || '/' || (get_ai_usage('$LB')->>'cap')")" "2/2"
eq "a refused request is counted as refused, not used" "$(sql "select calls || ',' || refused from ai_usage u join businesses b on b.tenant_id=u.tenant_id where b.id='$LB'")" "2,1"
has "app users can't call the counter" "$(as late "select fn_ai_use('$LB')")" "permission denied"
has "another company can't read this company's use" "$(as owner "select get_ai_usage('$LB')")" "do not have access"
eq "only the platform admin reads the platform AI setup" "$(as owner "select count(*) from platform_ai_settings")" "0"
has "an owner can't change the platform AI" "$(as owner "select platform_update_ai_settings('{\"model\":\"x\"}')")" "Only the platform admin"
ok "the platform admin changes the model" "$(as admin "select platform_update_ai_settings('{\"model\":\"Qwen/Qwen2.5-7B-Instruct\"}')")"
eq "the runner sees the platform model" "$(sql "select fn_ai_plan('$LB')->'platform'->>'model'")" "Qwen/Qwen2.5-7B-Instruct"
ok "admin moves the company to Perpetual" "$(as admin "select platform_change_plan('$LT','perpetual','one_time',220000)")"
eq "Perpetual: own key" "$(sql "select fn_ai_plan('$LB')->>'own_key'")" "true"
ok "admin clears the custom cap" "$(as admin "select platform_set_custom_limits('$LT', '{}')")"
eq "Perpetual: no cap (they pay their own provider)" "$(ai $LB allowed)" "true"
ok "admin suspends the company" "$(as admin "select platform_set_suspended('$LT', true, 'test')")"
eq "suspended: AI refused" "$(ai $LB reason)" "read_only"

echo "--- the platform admin sets a company up on any plan, no payment"
AB=$(uuid "$(newbiz admin 'Set Up For Them' "'pro_plus', true")")
ok "admin creates a company on Pro Plus" "$AB"
eq "it is Pro Plus, active" "$(as admin "select (get_plan_usage('$AB')->>'plan') || ',' || (get_plan_usage('$AB')->>'status')")" "pro_plus,active"
eq "the admin lists every company" "$(as admin "select count(*) from platform_tenants()")" "4"
eq "the list carries counts only (one branch closed)" "$(as admin "select branches from platform_tenants() where tenant_id='$T'")" "3"
eq "every change is in the platform log" "$(as admin "select count(*) > 5 from platform_audit")" "t"

echo "--- $PASS passed, $FAIL failed"
[ $FAIL -eq 0 ]
