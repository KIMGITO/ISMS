#!/bin/bash
# 20261205001: the console's Home page (stats, our running costs) and AI set-up kept by the
# platform: a business switches each AI use on or off, nothing more.
#   C=supabase_db_isms-seedtest bash supabase/tests/promotions/rebuild.sh
#   C=supabase_db_isms-seedtest bash supabase/tests/saas/home_test.sh
HERE=$(cd "$(dirname "$0")" && pwd)
source "$HERE/../promotions/lib.sh"
UID_OF[admin]=a9000000-0000-0000-0000-000000000000
B1=b1000000-0000-0000-0000-000000000000

sql "
INSERT INTO auth.users (id, email, aud, role) VALUES ('${UID_OF[admin]}','admin@t.test','authenticated','authenticated') ON CONFLICT DO NOTHING;
INSERT INTO public.users (id, auth_user_id, name, email) VALUES ('00000000-0000-0000-0000-0000000000a9','${UID_OF[admin]}','Pat Platform','admin@t.test') ON CONFLICT DO NOTHING;
INSERT INTO public.platform_admins (auth_user_id, name) VALUES ('${UID_OF[admin]}', 'Pat') ON CONFLICT DO NOTHING;
INSERT INTO public.ai_settings (business_id) VALUES ('$B1') ON CONFLICT DO NOTHING;" >/dev/null
T=$(sql "select tenant_id from businesses where id='$B1'")
anon(){ sql "SET role anon; $1"; }

echo "--- AI: the business switches uses, the platform sets it up"
ok "the owner turns the website assistant off" "$(as owner "update ai_settings set uses = '{\"website\": false}', enabled = true where business_id='$B1'")"
eq "it is saved" "$(sql "select uses->>'website' from ai_settings where business_id='$B1'")" "false"
ok "and writes instructions" "$(as owner "update ai_settings set system_prompt = 'Be brief' where business_id='$B1'")"
has "the owner can't change the provider" "$(as owner "update ai_settings set provider = 'openai' where business_id='$B1'")" "set up by the platform"
has "nor the key" "$(as owner "update ai_settings set api_key = 'sk-mine' where business_id='$B1'")" "set up by the platform"
has "nor the model" "$(as owner "update ai_settings set model = 'x' where business_id='$B1'")" "set up by the platform"
has "uses must be an object" "$(as owner "update ai_settings set uses = '[]' where business_id='$B1'")" "ai_settings_uses_object"
has "an owner can't set a company's AI" "$(as owner "select platform_set_company_ai('$T','openai','gpt-x','sk-abc')")" "Only the platform admin"
ok "the platform admin sets it" "$(as admin "select platform_set_company_ai('$T','openai','gpt-x','sk-abcdefghijkl')")"
eq "for the company's branches" "$(sql "select provider||' '||model||' '||api_key from ai_settings where business_id='$B1'")" "openai gpt-x sk-abcdefghijkl"
ok "saving again without a key keeps it" "$(as admin "select platform_set_company_ai('$T','openai','gpt-y',null)")"
eq "the key is kept" "$(sql "select api_key from ai_settings where business_id='$B1'")" "sk-abcdefghijkl"
eq "the console sees only the key's end" "$(as admin "select platform_company_ai('$T')->>'key_end'")" "ijkl"
eq "never the key" "$(as admin "select platform_company_ai('$T')::text like '%sk-abc%'")" "f"
eq "the switches survived" "$(sql "select uses->>'website' from ai_settings where business_id='$B1'")" "false"
has "an unknown provider is refused" "$(as admin "select platform_set_company_ai('$T','acme','m',null)")" "Unknown AI provider"

echo "--- running costs"
eq "starting figures are there" "$(sql "select count(*) > 5 from platform_running_costs")" "t"
eq "an owner reads none" "$(as owner "select count(*) from platform_running_costs")" "0"
has "anon reads none" "$(anon "select count(*) from platform_running_costs")" "permission denied"
has "an owner can't save one" "$(as owner "select platform_save_running_cost('{\"item\":\"x\",\"amount\":1}')")" "Only the platform admin"
ID=$(as admin "select platform_save_running_cost('{\"item\":\"Test bill\",\"kind\":\"fixed\",\"per\":\"year\",\"amount\":1200}')")
ok "the admin adds one" "$ID"
eq "a yearly bill counts as a twelfth a month" "$(as admin "select (platform_home_stats()->'costs'->>'fixed_month')::numeric - round((select sum(case per when 'year' then amount/12 else amount end) from platform_running_costs where active and kind='fixed' and item<>'Test bill'),2)")" "100.00"
ok "and deletes it" "$(as admin "select platform_save_running_cost('{\"id\":\"$ID\",\"delete\":true}')")"
has "a bad kind is refused" "$(as admin "select platform_save_running_cost('{\"item\":\"x\",\"kind\":\"weird\"}')")" "check"

echo "--- home stats"
for f in "platform_home_stats()"; do
  has "an owner can't read $f" "$(as owner "select $f")" "Only the platform admin"
  has "anon can't read $f" "$(anon "select $f")" "permission denied"
done
as admin "select platform_change_plan('$T','pro','monthly')" >/dev/null
sql "update tenant_subscriptions set addons = '{ai}' where tenant_id='$T'; update plan_modules set addon_monthly_price = 1500 where key='ai'" >/dev/null
R=$(as admin "select platform_home_stats()")
has "counts paying companies" "$R" '"paying": 1'
eq "expected income is the plan price plus add-ons" "$(as admin "select (platform_home_stats()->>'expected_month')::numeric >= 7500")" "t"
eq "the add-on is counted" "$(as admin "select x->>'month_value' from jsonb_array_elements(platform_home_stats()->'addons') x where x->>'key'='ai'")" "1500.00"
eq "twelve months of growth" "$(as admin "select jsonb_array_length(platform_home_stats()->'growth')")" "12"
has "with resource use" "$R" '"branches_allowed":'
has "and the busiest companies" "$R" '"busiest":'
eq "never a business's sales amounts" "$(as admin "select platform_home_stats()::text ~* '(revenue|\"total\"|customer)'")" "f"

echo "--- billing: payments decide the paid-up date"
pay(){ as admin "select platform_record_payment('$1')"; }
paid_days(){ sql "select ((current_period_end at time zone 'Africa/Nairobi')::date - fn_platform_today())::text from tenant_subscriptions where tenant_id='$T'"; }
ok "the company pays monthly on Pro at the list price" "$(as admin "select platform_change_plan('$T','pro','monthly')")"
eq "the old typed-date setter is closed" "$(as admin "select platform_set_plan('$T','pro')" | grep -c 'permission denied')" "1"
has "an owner can't record a payment" "$(as owner "select platform_record_payment('{\"tenant_id\":\"$T\",\"amount\":6000,\"method\":\"Cash\",\"received_by\":\"Me\"}')")" "Only the platform admin"
has "M-Pesa needs its code" "$(pay "{\"tenant_id\":\"$T\",\"amount\":6000,\"method\":\"M-Pesa\"}")" "payment code"
has "cash needs who received it" "$(pay "{\"tenant_id\":\"$T\",\"amount\":6000,\"method\":\"Cash\"}")" "who received the cash"
has "no payments dated in the future" "$(pay "{\"tenant_id\":\"$T\",\"amount\":6000,\"method\":\"Cash\",\"received_by\":\"Pat\",\"paid_on\":\"2099-01-01\"}")" "future"
M=$(sql "select fn_platform_rate('pro','monthly',(select addons from tenant_subscriptions where tenant_id='$T'),null)->>'month'")
eq "preview: a month's money buys 30 days" "$(as admin "select platform_payment_preview('$T', $M)->>'days'")" "30"
P1=$(pay "{\"tenant_id\":\"$T\",\"amount\":$M,\"method\":\"M-Pesa\",\"reference\":\"QAZ111\"}")
ok "a month is recorded" "$P1"
eq "paid up 30 days from today" "$(paid_days)" "30"
has "the same code can't be used twice" "$(pay "{\"tenant_id\":\"$T\",\"amount\":$M,\"method\":\"M-Pesa\",\"reference\":\"qaz111\"}")" "already recorded"
P2=$(as admin "select (platform_record_payment('{\"tenant_id\":\"$T\",\"amount\":$M,\"method\":\"Cash\",\"received_by\":\"Pat\"}')->>'id')")
eq "a second month follows on" "$(paid_days)" "60"
has "a payment can't be deleted" "$(sql "delete from platform_payments where id='$P2'")" "Void it instead"
has "nor its amount changed" "$(sql "update platform_payments set amount=1 where id='$P2'")" "can't be changed"
has "voiding needs a reason" "$(as admin "select platform_void_payment('$P2', '')")" "Say why"
ok "the cash payment is voided" "$(as admin "select platform_void_payment('$P2', 'Counted twice')")"
eq "the date is worked out again" "$(paid_days)" "30"
eq "the voided one stays on record" "$(sql "select void_reason from platform_payments where id='$P2'")" "Counted twice"
ok "an agreed price of 3000 a month" "$(as admin "select platform_change_plan('$T','pro','monthly',3000,'Launch deal')")"
eq "the next payment is priced at it: 3000 buys 30 days" "$(as admin "select platform_payment_preview('$T', 3000)->>'days'")" "30"
eq "and half buys 15" "$(as admin "select platform_payment_preview('$T', 1500)->>'days'")" "15"
has "an amount that buys less than a day is refused" "$(pay "{\"tenant_id\":\"$T\",\"amount\":10,\"method\":\"Cash\",\"received_by\":\"Pat\"}")" "less than a day"
eq "income counts the agreed price" "$(as admin "select (platform_home_stats()->>'given_off_month')::numeric > 0")" "t"
eq "money received shows on Home" "$(as admin "select (platform_home_stats()->>'received_this_month')::numeric = $M")" "t"
ok "Free: no end date" "$(as admin "select platform_change_plan('$T','pro','manual')")"
eq "nothing owed" "$(sql "select current_period_end is null from tenant_subscriptions where tenant_id='$T'")" "t"
has "and no payments taken" "$(pay "{\"tenant_id\":\"$T\",\"amount\":3000,\"method\":\"Cash\",\"received_by\":\"Pat\"}")" "no paid plan"
echo "--- a date typed before payments were recorded is kept"
sql "update tenant_subscriptions set billing_cycle='monthly', paid_before = fn_platform_today() + 20, current_period_end = ((fn_platform_today() + 20)::timestamp at time zone 'Africa/Nairobi') where tenant_id='$T'" >/dev/null
as admin "select platform_change_plan('$T','pro','monthly',3000,null)" >/dev/null
ok "a month paid after it" "$(pay "{\"tenant_id\":\"$T\",\"amount\":3000,\"method\":\"Cash\",\"received_by\":\"Pat\"}")"
eq "recorded payments follow the kept 20 days (two months standing: 20 + 30 + 30)" "$(paid_days)" "80"
has "suspending needs a reason" "$(as admin "select platform_set_suspended('$T', true, '')")" "Say why"
ok "suspended" "$(as admin "select platform_set_suspended('$T', true, 'Unpaid')")"
eq "is suspended" "$(as owner "select get_plan_usage('$B1')->>'status'")" "suspended"
ok "back in" "$(as admin "select platform_set_suspended('$T', false)")"
has "the money screen lists payments" "$(as admin "select platform_billing()")" '"void_reason": "Counted twice"'
has "an owner can't read it" "$(as owner "select platform_billing()")" "Only the platform admin"

echo "home: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
