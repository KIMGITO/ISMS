#!/bin/bash
# SaaS step 7 (20261204005): the platform console inside the app, and the public plans page.
# Only platform admins read the console; what it shows are counts, never business figures.
# Anyone (the website Worker, anon) reads the plans page data.
#   C=supabase_db_isms-seedtest bash supabase/tests/promotions/rebuild.sh
#   C=supabase_db_isms-seedtest bash supabase/tests/saas/console_test.sh
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
UPDATE public.users SET verified_email = email WHERE auth_user_id = '${UID_OF[stranger]}';
INSERT INTO public.platform_admins (auth_user_id, name) VALUES ('${UID_OF[admin]}', 'Pat') ON CONFLICT DO NOTHING;" >/dev/null
T=$(sql "select tenant_id from businesses where id='$B1'")
anon(){ sql "SET role anon; $1"; }

echo "--- the public plans page"
R=$(anon "select get_public_plans()")
has "anyone reads the plans" "$R" '"code": "starter"'
has "with prices" "$R" '"monthly_price": 3000'
has "and the modules each plan has" "$R" '"online_store"'
eq "the trial is not a plan to buy" "$(anon "select count(*) from jsonb_array_elements(get_public_plans()->'plans') p where p->>'code'='trial'")" "0"
eq "a hidden plan is not shown" "$(sql "update plans set is_public=false where code='perpetual'"; anon "select count(*) from jsonb_array_elements(get_public_plans()->'plans') p where p->>'code'='perpetual'")" "0"
sql "update plans set is_public=true where code='perpetual'" >/dev/null
eq "it names no business" "$(anon "select get_public_plans()::text like '%$B1%'")" "f"

echo "--- app address"
has "the address must be https" "$(as admin "select platform_update_settings('{\"app_url\":\"http://app.shops.test\"}')")" "app_url_check"
ok "the admin sets it" "$(as admin "select platform_update_settings('{\"app_url\":\"https://app.shops.test/\"}')")"
eq "the plans page links to it (no trailing slash)" "$(anon "select get_public_plans()->>'app_url'")" "https://app.shops.test"
has "an owner can't set it" "$(as owner "select platform_update_settings('{\"app_url\":\"https://evil.test\"}')")" "Only the platform admin"

echo "--- console reads are for the platform admin only"
for f in "platform_overview()" "platform_tenant_detail('$T')" "platform_requests()" "platform_tenants()"; do
  has "an owner can't call $f" "$(as owner "select $f")" "Only the platform admin"
  has "a stranger can't call $f" "$(as stranger "select $f")" "Only the platform admin"
  has "anon can't call $f" "$(anon "select $f")" "permission denied"
done

echo "--- overview and company detail"
R=$(as admin "select platform_overview()")
has "overview counts companies" "$R" '"companies":'
has "and waiting requests" "$R" '"requests_waiting":'
R=$(as admin "select platform_tenant_detail('$T')")
has "detail lists the branches" "$R" '"branches":'
has "with sale counts" "$R" '"sales_30_days":'
eq "never sales amounts" "$(as admin "select platform_tenant_detail('$T')::text ~* '(total|amount|revenue|customer)'")" "f"
has "an unknown company is refused" "$(as admin "select platform_tenant_detail(gen_random_uuid())")" "Unknown company"
as admin "select platform_extend_trial('$T', 5)" >/dev/null 2>&1
as admin "select platform_set_plan('$T','pro_plus','active','manual',null,'console test')" >/dev/null
has "plan changes show in its history" "$(as admin "select platform_tenant_detail('$T')->'history'")" '"plan_set"'

echo "--- requests"
as stranger "select request_business_signup('pro','monthly','Sam Shop','0700000000',null,'{}','QWE123')" >/dev/null
R=$(as admin "select platform_requests()")
has "a waiting request is listed" "$R" '"business_name": "Sam Shop"'
has "with the payment code" "$R" '"payment_reference": "QWE123"'
has "and who asked" "$R" '"person": "stranger'
RID=$(sql "select id from signup_requests where business_name='Sam Shop'")
ok "the admin approves it" "$(as admin "select platform_decide_signup('$RID', true, 'paid')")"
eq "a decided request leaves the waiting list" "$(as admin "select jsonb_array_length(platform_requests())")" "0"
has "but shows with the decided ones" "$(as admin "select platform_requests(true)")" '"status": "approved"'

echo "console: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
