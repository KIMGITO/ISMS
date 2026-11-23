#!/bin/bash
# Roles and permissions at the database level (20261130006_permissions_db_level.sql).
# Every role reads what its rules allow, the Roles screen (role_permissions) decides writes,
# and only the Owner or an Admin can make, change or remove an Admin.
#   C=supabase_db_isms-seedtest bash supabase/tests/promotions/rebuild.sh
#   C=supabase_db_isms-seedtest bash supabase/tests/permissions/permissions_test.sh
HERE=$(cd "$(dirname "$0")" && pwd)
source "$HERE/../promotions/lib.sh"
sql(){ docker exec -i $C psql -U supabase_admin -d $DB -tAq -v ON_ERROR_STOP=1 2>&1 <<<"SET client_min_messages = error;
$1"; }
B=b1000000-0000-0000-0000-000000000000
ALICE=c1000000-0000-0000-0000-000000000000
UID_OF[admin]=a4000000-0000-0000-0000-000000000000
# An Admin (the sign-up trigger makes the users row with the same id as the login).
sql "INSERT INTO auth.users (id,email,aud,role) VALUES ('${UID_OF[admin]}','adm@t.test','authenticated','authenticated') ON CONFLICT DO NOTHING;
INSERT INTO public.users (id,auth_user_id,name,email) VALUES ('${UID_OF[admin]}','${UID_OF[admin]}','Ada Admin','adm@t.test') ON CONFLICT DO NOTHING;
INSERT INTO public.business_memberships (business_id,user_id,role,status) VALUES ('$B','${UID_OF[admin]}','Admin','Active') ON CONFLICT DO NOTHING;
DELETE FROM public.role_permissions WHERE business_id='$B';" >/dev/null
ADMIN_USER=${UID_OF[admin]}; CASH_USER=00000000-0000-0000-0000-0000000000a2; MGR_USER=00000000-0000-0000-0000-0000000000a1
grant(){ sql "INSERT INTO role_permissions (business_id, role, permission, granted) VALUES ('$B','$1','$2',${3:-true})
  ON CONFLICT (business_id, role, permission) DO UPDATE SET granted = EXCLUDED.granted" >/dev/null; }

echo "-- every table with a read rule can be read (no missing grant)"
eq "no table with a read rule lacks the SELECT grant" "$(sql "select string_agg(distinct c.relname, ',') from pg_class c join pg_namespace n on n.oid=c.relnamespace
  join pg_policies p on p.schemaname=n.nspname and p.tablename=c.relname
  where n.nspname='public' and p.cmd in ('SELECT','ALL') and not has_table_privilege('authenticated', c.oid, 'SELECT')")" ""
eq "no table with a write rule lacks its grant" "$(sql "select string_agg(distinct c.relname||':'||p.cmd, ',') from pg_class c join pg_namespace n on n.oid=c.relnamespace
  join pg_policies p on p.schemaname=n.nspname and p.tablename=c.relname
  where n.nspname='public' and p.cmd in ('INSERT','UPDATE','DELETE') and not has_table_privilege('authenticated', c.oid, p.cmd)")" ""

echo "-- who can reach what (grants_check.sql; scripts/check-live-grants.sh runs it on live)"
eq "no grant problems" "$(sql "$(cat "$HERE/grants_check.sql")" | tr '\n' ';')" ""

echo "-- invoices"
ok  "admin issues an invoice" "$(as admin "select invoice_no from issue_invoice('$B','$ALICE','INV',null,null,100,'{\"a\":1}','Ada')")"
eq  "admin sees invoices" "$(as admin "select count(*) > 0 from invoices")" "t"
eq  "owner sees invoices" "$(as owner "select count(*) > 0 from invoices")" "t"
eq  "cashier (customers.debts) sees invoices" "$(as cash "select count(*) > 0 from invoices where business_id='$B'")" "t"
eq  "rider sees no invoices" "$(as rider "select count(*) from invoices")" "0"
ok  "admin reads the books" "$(as admin "select count(*) from acc_entries")"
ok  "admin reads credit notes, quotes, sales invoices" "$(as admin "select (select count(*) from credit_notes)+(select count(*) from quotes)+(select count(*) from sales_invoices)")"
grant Cashier customers.debts false
eq  "cashier loses invoices when the Roles screen takes customers.debts away" "$(as cash "select count(*) from invoices where business_id='$B'")" "0"
sql "DELETE FROM role_permissions WHERE business_id='$B'" >/dev/null

echo "-- settings follow the Roles screen"
sql "INSERT INTO receipt_settings (business_id) VALUES ('$B') ON CONFLICT DO NOTHING" >/dev/null
eq  "manager (settings.tax) saves receipt settings" "$(as mgr "update receipt_settings set receipt_prefix='M' where business_id='$B' returning receipt_prefix")" "M"
eq  "cashier can't" "$(as cash "update receipt_settings set receipt_prefix='C' where business_id='$B' returning receipt_prefix")" ""
eq  "manager can't edit business details by default" "$(as mgr "update businesses set name='X' where id='$B' returning name")" ""
grant Manager business.update
eq  "manager given business.update can" "$(as mgr "update businesses set name='Main' where id='$B' returning name")" "Main"

echo "-- invitations"
has "manager without staff.invite can't invite" "$(as mgr "insert into invitations (business_id,name,email,role) values ('$B','Ned','ned@t.test','Cashier')")" "row-level security"
grant Manager staff.invite
ok  "manager given staff.invite invites a cashier" "$(as mgr "insert into invitations (business_id,name,email,role) values ('$B','Ned','ned@t.test','Cashier')")"
has "but not an admin" "$(as mgr "insert into invitations (business_id,name,email,role) values ('$B','Ann','ann@t.test','Admin')")" "Only the Owner or an Admin"
ok  "admin invites an admin" "$(as admin "insert into invitations (business_id,name,email,role) values ('$B','Ann','ann@t.test','Admin')")"
eq  "manager (staff.view) sees pending invitations" "$(as mgr "select count(*) from invitations where business_id='$B'")" "2"

echo "-- team roles"
grant Manager staff.update; grant Manager staff.roles; grant Manager staff.remove
ok  "manager with staff.roles makes the cashier a rider" "$(as mgr "select update_team_member('$B','$CASH_USER','Carl Cashier',null,null,'Rider')")"
sql "update business_memberships set role='Cashier' where business_id='$B' and user_id='$CASH_USER'" >/dev/null
has "manager can't make anyone an admin" "$(as mgr "select update_team_member('$B','$CASH_USER','Carl Cashier',null,null,'Admin')")" "Only the Owner or an Admin"
has "manager can't demote an admin directly" "$(as mgr "update business_memberships set role='Cashier' where business_id='$B' and user_id='$ADMIN_USER'")" "Only the Owner or an Admin"
has "manager can't remove an admin" "$(as mgr "delete from business_memberships where business_id='$B' and user_id='$ADMIN_USER'")" "Only the Owner or an Admin"
eq  "admin's role unchanged" "$(sql "select role from business_memberships where business_id='$B' and user_id='$ADMIN_USER'")" "Admin"
ok  "admin makes the cashier an admin and back" "$(as admin "select update_team_member('$B','$CASH_USER','Carl Cashier',null,null,'Admin'); select update_team_member('$B','$CASH_USER','Carl Cashier',null,null,'Cashier')")"
has "nobody becomes Owner" "$(as admin "select update_team_member('$B','$CASH_USER','Carl Cashier',null,null,'Owner')")" "owner"

echo "-- role permissions"
ok  "manager with staff.roles edits the cashier role" "$(as mgr "insert into role_permissions (business_id,role,permission,granted) values ('$B','Cashier','pos.discount',false)")"
has "manager can't edit their own role" "$(as mgr "insert into role_permissions (business_id,role,permission,granted) values ('$B','Manager','business.delete',true)")" "row-level security"
has "manager can't edit the admin role" "$(as mgr "insert into role_permissions (business_id,role,permission,granted) values ('$B','Admin','business.delete',false)")" "row-level security"
ok  "admin edits the manager role" "$(as admin "insert into role_permissions (business_id,role,permission,granted) values ('$B','Manager','pos.discount',true)")"

echo "-- presence"
sql "update employees set last_seen_at=null where user_id='$CASH_USER'" >/dev/null
ok  "cashier marks itself online" "$(as cash "select touch_my_presence('$B')")"
eq  "cashier is online" "$(sql "select bool_and(last_seen_at is not null) from employees where business_id='$B' and user_id='$CASH_USER'")" "t"
eq  "cashier can't write staff records" "$(as cash "update employees set name='Hacked' where business_id='$B' returning name")" ""

echo "-- answers kept for one request (20261201005) follow changes made in that request"
# One transaction, like one API request: ask, change, ask again.
in_one(){ sql "BEGIN; SELECT set_config('request.jwt.claims','{\"sub\":\"${UID_OF[cash]}\",\"role\":\"authenticated\"}',true) \\g /dev/null
SET LOCAL role authenticated;
$1
ROLLBACK;"; }
grant Cashier reports.sales false
eq  "a new grant counts within the same request" "$(in_one "SELECT has_permission('$B','reports.sales');
RESET role; INSERT INTO role_permissions (business_id,role,permission,granted) VALUES ('$B','Cashier','reports.sales',true)
  ON CONFLICT (business_id,role,permission) DO UPDATE SET granted=true; SET LOCAL role authenticated;
SELECT has_permission('$B','reports.sales');" | tr '\n' ' ')" "f t "
eq  "a removed member loses access within the same request" "$(in_one "SELECT has_permission('$B','pos.create_sale'), '$B' = ANY(get_user_business_ids());
RESET role; UPDATE business_memberships SET status='Suspended' WHERE business_id='$B' AND user_id='$CASH_USER'; SET LOCAL role authenticated;
SELECT has_permission('$B','pos.create_sale'), '$B' = ANY(get_user_business_ids());" | tr '\n' ' ')" "t|t f|f "
eq  "the next request asks again (nothing kept)" "$(as cash "select current_setting('isms_hp.gen', true) is null or current_setting('isms_hp.gen', true) = ''")" "t"

sql "DELETE FROM role_permissions WHERE business_id='$B'; DELETE FROM invitations WHERE business_id='$B'" >/dev/null
echo; echo "passed $PASS, failed $FAIL"; [ $FAIL -eq 0 ]
