#!/bin/bash
# Records the books stand on are kept (20261203001): the audit trail can't be deleted or edited,
# sales can't be deleted (only voided), and Old records only clears logs that carry no money.
#   C=supabase_db_isms-seedtest bash supabase/tests/promotions/rebuild.sh
#   C=supabase_db_isms-seedtest bash supabase/tests/records/keep_records_test.sh
HERE=$(cd "$(dirname "$0")" && pwd)
source "$HERE/../promotions/lib.sh"
B1=b1000000-0000-0000-0000-000000000000
EMP=e2000000-0000-0000-0000-000000000000
BR=d3000000-0000-0000-0000-000000000000
item(){ echo "{\"product_id\":\"$1\",\"product_name\":\"Bread\",\"quantity\":$2,\"unit_price\":$3,\"discount_percentage\":0}"; }
T=$(as cash "select record_till_sale('{\"business_id\":\"$B1\",\"total\":50,\"discount\":0,\"tax\":0,\"final_total\":50,\"payment_method\":\"Cash\",\"staff_name\":\"Carl\",\"staff_id\":\"$EMP\"}'::jsonb, '[$(item $BR 1 50)]'::jsonb)")
SALE=$(grep -oE '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' <<<"$T" | head -1)
ok "a till sale" "$T"
sql "update transactions set timestamp = now() - interval '2 years' where id = '$SALE'" >/dev/null

echo "--- audit trail"
A=$(sql "insert into audit_logs (business_id, action, table_name, timestamp) values ('$B1','test','x', now() - interval '3 years') returning id" | head -1)
has "owner can't delete audit via cleanup" "$(as owner "select delete_log_entries('$B1','audit',null,'infinity')")" "can't be deleted"
has "owner can't delete an audit row" "$(as owner "delete from audit_logs where id='$A'"; sql "select count(*) from audit_logs where id='$A'")" "1"
has "even the service role can't delete it" "$(sql "set role service_role; delete from audit_logs where id='$A'")" "can't be deleted"
has "nobody can edit it" "$(sql "update audit_logs set action='changed' where id='$A'")" "can't be changed"
has "service role can't truncate it" "$(sql "set role service_role; truncate audit_logs")" "permission denied"

echo "--- sales"
has "cleanup refuses sales" "$(as owner "select delete_log_entries('$B1','sales',null,'infinity')")" "can't be deleted"
has "cleanup refuses one sale" "$(as owner "select delete_log_entries('$B1','sales',array['$SALE']::uuid[])")" "can't be deleted"
has "owner can't delete a sale directly" "$(as owner "delete from transactions where id='$SALE'")" "permission denied"
eq "the sale is still there" "$(sql "select count(*) from transactions where id='$SALE'")" "1"

echo "--- money logs"
has "stock history is kept" "$(as owner "select delete_log_entries('$B1','stock',null,'infinity')")" "can't be deleted"
has "points used are kept" "$(as owner "select delete_log_entries('$B1','points_used',null,'infinity')")" "can't be deleted"

echo "--- logs that can still be cleared"
ok "crash reports clear" "$(as owner "select delete_log_entries('$B1','crashes',null,'infinity')")"
ok "points earned clear" "$(as owner "select delete_log_entries('$B1','points_earned',null,now() - interval '10 years')")"
has "a cashier can't clear anything" "$(as cash "select delete_log_entries('$B1','crashes',null,'infinity')")" "Only an owner or admin"
eq "sizes list only the clearable logs" "$(as owner "select string_agg(log, ',' order by log) from log_sizes('$B1')")" "backups,crashes,points_earned"

echo "--- $PASS passed, $FAIL failed"
[ $FAIL -eq 0 ]
