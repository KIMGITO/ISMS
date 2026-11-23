#!/bin/bash
# What the assistant is told a person may do (20261130008_ai_reads_permissions.sql):
# my_permissions must agree with has_permission, and follow the Roles screen at once.
#   C=supabase_db_isms-seedtest bash supabase/tests/promotions/rebuild.sh
#   C=supabase_db_isms-seedtest bash supabase/tests/permissions/ai_permissions_test.sh
HERE=$(cd "$(dirname "$0")" && pwd)
source "$HERE/../promotions/lib.sh"
sql(){ docker exec -i $C psql -U supabase_admin -d $DB -tAq -v ON_ERROR_STOP=1 2>&1 <<<"SET client_min_messages = error;
$1"; }
B=b1000000-0000-0000-0000-000000000000
grant(){ sql "INSERT INTO role_permissions (business_id, role, permission, granted) VALUES ('$B','$1','$2',${3:-true})
  ON CONFLICT (business_id, role, permission) DO UPDATE SET granted = EXCLUDED.granted" >/dev/null; }
mine(){ as "$1" "select '$2' = any(codes) from my_permissions('$B')"; }
sql "DELETE FROM public.role_permissions WHERE business_id='$B' AND role='Cashier' AND permission='inventory.transfer_stock'" >/dev/null

echo "-- owner"
eq "owner has full access" "$(as owner "select full_access from my_permissions('$B')")" "t"

echo "-- cashier: the role's default when the Roles screen saved nothing"
DEF=$(sql "select 'inventory.transfer_stock' = any(permissions) from role_default_permissions where role='Cashier'")
eq "transfer follows the default" "$(mine cash inventory.transfer_stock)" "$(as cash "select has_permission('$B','inventory.transfer_stock')")"
echo "   (default for Cashier: $DEF)"

echo "-- cashier: the Roles screen allows transfers"
grant Cashier inventory.transfer_stock true
eq "assistant sees transfer allowed" "$(mine cash inventory.transfer_stock)" "t"
eq "database agrees" "$(as cash "select has_permission('$B','inventory.transfer_stock')")" "t"

echo "-- cashier: the Roles screen takes it away"
grant Cashier inventory.transfer_stock false
eq "assistant sees transfer refused" "$(mine cash inventory.transfer_stock)" "f"
eq "database agrees" "$(as cash "select has_permission('$B','inventory.transfer_stock')")" "f"

echo "-- every code the assistant is told about passes has_permission, and no other does"
eq "lists agree" "$(as cash "select count(*) from (select unnest(codes) c from my_permissions('$B')) x where not has_permission('$B', x.c)")" "0"
eq "nothing missing" "$(as cash "select count(*) from (select distinct permission c from role_permissions where business_id='$B' and role='Cashier') x
  where has_permission('$B', x.c) and x.c not in (select unnest(codes) from my_permissions('$B'))")" "0"

echo "-- outsiders and anon"
ok "anon can't call it" "$(sql "SET role anon; select my_permissions('$B')" | grep -q 'permission denied' && echo yes || echo ERROR)"
eq "AI settings fall back to the business itself" "$(sql "select fn_ai_settings_business('$B') = '$B'")" "t"
sql "DELETE FROM public.role_permissions WHERE business_id='$B' AND role='Cashier' AND permission='inventory.transfer_stock'" >/dev/null
echo; echo "passed $PASS, failed $FAIL"; [ $FAIL -eq 0 ]
