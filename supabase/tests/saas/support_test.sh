#!/bin/bash
# SaaS support access (20261204006-007): the owner allows platform support into one branch for a
# set time; support can set up but never sell, pay, change the plan or staff; it ends at once.
#   C=supabase_db_isms-seedtest bash supabase/tests/promotions/rebuild.sh
#   C=supabase_db_isms-seedtest bash supabase/tests/saas/support_test.sh
HERE=$(cd "$(dirname "$0")" && pwd)
source "$HERE/../promotions/lib.sh"
UID_OF[admin]=a9000000-0000-0000-0000-000000000000
UID_OF[stranger]=a8000000-0000-0000-0000-000000000000
B1=b1000000-0000-0000-0000-000000000000

sql "
INSERT INTO auth.users (id, email, aud, role) VALUES
 ('${UID_OF[admin]}','admin@t.test','authenticated','authenticated'),
 ('${UID_OF[stranger]}','stranger@t.test','authenticated','authenticated') ON CONFLICT DO NOTHING;
INSERT INTO public.users (id, auth_user_id, name, email) VALUES
 ('00000000-0000-0000-0000-0000000000a9','${UID_OF[admin]}','Pat Platform','admin@t.test'),
 ('00000000-0000-0000-0000-0000000000a8','${UID_OF[stranger]}','Sam Stranger','stranger@t.test') ON CONFLICT DO NOTHING;
INSERT INTO public.platform_admins (auth_user_id, name) VALUES ('${UID_OF[admin]}', 'Pat') ON CONFLICT DO NOTHING;" >/dev/null
T=$(sql "select tenant_id from businesses where id='$B1'")
STAFF0=$(sql "select fn_tenant_staff_used('$T')")
admin_sees(){ as admin "select count(*) from products where business_id='$B1'"; }

echo "--- nothing without the owner"
eq "the admin sees no products before" "$(admin_sees)" "0"
has "the admin can't open the branch" "$(as admin "select platform_support_open('$B1')")" "hasn't allowed support"
has "a manager can't allow it" "$(as mgr "select support_allow('$B1', 2)")" "Only the owner"
has "a stranger can't read the status" "$(as stranger "select support_status('$B1')")" "not in this business"
has "nobody makes someone Support by hand" "$(as owner "insert into business_memberships (business_id,user_id,role,status) values ('$B1','00000000-0000-0000-0000-0000000000a8','Support','Active')")" "not here"
has "or invites Support" "$(as owner "insert into invitations (business_id,name,email,role,invitation_token,expires_at,status) values ('$B1','x','x@t.test','Support','tok-support',now()+interval '1 day','Pending')")" "can't be invited"
has "the time must be 1 to 72 hours" "$(as owner "select support_allow('$B1', 100)")" "between 1 hour"

echo "--- the owner allows it"
R=$(as owner "select support_allow('$B1', 2, 'Set up products')")
has "allowed" "$R" '"open": true'
has "staff see it in the banner" "$(as cash "select support_status('$B1')")" '"open": true'
has "the console lists it" "$(as admin "select platform_support_list()")" '"reason": "Set up products"'
has "an owner can't read the console list" "$(as owner "select platform_support_list()")" "Only the platform admin"
ok "the admin opens the branch" "$(as admin "select platform_support_open('$B1')")"
eq "now the admin sees the products" "$( [ "$(admin_sees)" -gt 0 ] && echo yes)" "yes"
has "and the banner says support is in" "$(as owner "select support_status('$B1')")" '"in_use": true'

echo "--- what support may do"
eq "set up products" "$(as admin "select has_permission('$B1','products.create')")" "t"
eq "adjust stock (opening stock)" "$(as admin "select has_permission('$B1','inventory.adjust_stock')")" "t"
for p in pos.create_sale pos.refund refunds.create payments.manage expenses.create staff.invite staff.roles settings.integrations; do
  eq "never $p" "$(as admin "select has_permission('$B1','$p')")" "f"
done
sql "insert into role_permissions (business_id, role, permission, granted) values ('$B1','Support','pos.create_sale',true) on conflict do nothing" >/dev/null 2>&1
eq "a Roles override doesn't widen it" "$(as admin "select has_permission('$B1','pos.create_sale')")" "f"
eq "not an owner or admin" "$(as admin "select is_owner_or_admin('$B1')")" "f"
has "can't change the plan" "$(as admin "select request_plan_change('$B1','starter','monthly','{}',null)")" "ERROR"
eq "not staff: no employee row" "$(sql "select count(*) from employees e join users u on u.id=e.user_id where u.auth_user_id='${UID_OF[admin]}' and e.business_id='$B1'")" "0"
eq "and no staff place on the plan" "$(sql "select fn_tenant_staff_used('$T')")" "$STAFF0"
eq "the console staff count leaves support out" "$(as admin "select (platform_tenant_detail('$T')->'branches'->0->>'staff')::int = (select count(*) from business_memberships where business_id='$B1' and status='Active' and role::text<>'Support')")" "t"
PID=$(sql "select id from products where business_id='$B1' limit 1")
as admin "update products set name = name || ' (s)' where id='$PID'" >/dev/null
has "a change is in the audit trail as Platform support" "$(sql "select details->>'by' from audit_logs where table_name='products' and record_id='$PID' order by created_at desc limit 1")" "Platform support (Pat)"
has "the opening is in the audit trail" "$(sql "select string_agg(action, ',') from audit_logs where business_id='$B1' and table_name='support_grants'")" "SUPPORT_OPENED"
has "and in the platform log" "$(sql "select string_agg(action, ',') from platform_audit where tenant_id='$T'")" "support_allowed"
as admin "update business_memberships set support_until = now() + interval '30 days' where business_id='$B1' and role='Support'" >/dev/null
eq "support can't make itself longer" "$(sql "select support_until < now() + interval '3 hours' from business_memberships where business_id='$B1' and role::text='Support'")" "t"
has "nor can the owner by hand" "$(as owner "update business_memberships set support_until = now() + interval '30 days' where business_id='$B1' and role='Support'")" "not here"

echo "--- ending"
ok "the owner ends it" "$(as owner "select support_end('$B1')")"
eq "support is out at once" "$(admin_sees)" "0"
eq "and has no permission" "$(as admin "select has_permission('$B1','products.view')")" "f"
eq "the membership is gone" "$(sql "select count(*) from business_memberships where business_id='$B1' and role::text='Support'")" "0"
has "the banner is gone" "$(as owner "select support_status('$B1')")" '"open": false'
has "can't open again" "$(as admin "select platform_support_open('$B1')")" "hasn't allowed support"

echo "--- time runs out"
as owner "select support_allow('$B1', 1)" >/dev/null
as admin "select platform_support_open('$B1')" >/dev/null
sql "update support_grants set starts_at = now() - interval '3 hours', expires_at = now() - interval '1 hour' where business_id='$B1' and ended_at is null;
     update business_memberships set support_until = now() - interval '1 hour' where business_id='$B1' and role::text='Support'" >/dev/null
eq "expired: no access, even before cleanup" "$(admin_sees)" "0"
eq "cleanup removes the leftover" "$(sql "select run_support_cleanup()")" "1"

echo "--- support leaves by itself"
as owner "select support_allow('$B1', 1)" >/dev/null
as admin "select platform_support_open('$B1')" >/dev/null
ok "support leaves" "$(as admin "select support_end('$B1')")"
has "which ends the permission" "$(as owner "select support_status('$B1')")" '"open": false'

echo "support: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
