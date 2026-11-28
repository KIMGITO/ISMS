#!/bin/bash
# Website engine phase 7 (20261208001): the private visit counter, statistics per shop, and the
# nightly own-address check. Run on the local test build, never the live database.
#   C=supabase_db_isms-seedtest bash supabase/tests/promotions/rebuild.sh
#   C=supabase_db_isms-seedtest bash supabase/tests/website/visits_test.sh   (after drafts_test.sh)
HERE=$(cd "$(dirname "$0")" && pwd)
source "$HERE/../promotions/lib.sh"
M=$(cd "$HERE/../../migrations" && pwd)
UID_OF[stranger]=a8000000-0000-0000-0000-000000000000
B1=b1000000-0000-0000-0000-000000000000
B2=b2000000-0000-0000-0000-000000000000
view(){ sql "SET role anon; select record_website_view('$1', '$2', '$3', $4)"; }
stats(){ as "$1" "select website_stats('$2', 30)$3"; }

sql "INSERT INTO auth.users (id, email, aud, role) VALUES ('${UID_OF[stranger]}','stranger@t.test','authenticated','authenticated') ON CONFLICT DO NOTHING;
update businesses set website_slug='mainshop' where id='$B1'; update businesses set website_slug='branchtwo' where id='$B2';
delete from website_visit_daily; delete from rate_limits where key like 'webview:%';" >/dev/null 2>&1

echo "--- the migration runs twice"
for i in 1 2; do
  out=$(docker exec -i $C psql -U postgres -q -d $DB -v ON_ERROR_STOP=1 -1 < "$M/../migrations_archive/20261208001_website_visits_domain_recheck.sql" 2>&1 | grep ERROR || true)
  eq "migration run $i" "$out" ""
done
sql "delete from website_visit_daily; delete from rate_limits where key like 'webview:%';" >/dev/null

echo "--- counting"
eq "a landing from search is counted" "$(view mainshop home search true)" "t"
eq "a second landing" "$(view mainshop product direct true)" "t"
eq "browsing inside is counted" "$(view mainshop shop search false)" "t"
eq "the next page is a view, not a visit, whatever source it claims" "$(sql "select source from website_visit_daily where page='shop'")" "inside"
eq "an unknown page kind is ignored" "$(view mainshop '/admin' direct true)" "f"
eq "an unknown source is ignored" "$(view mainshop home 'evil.com' true)" "f"
eq "an unknown shop is ignored" "$(view nosuchshop home direct true)" "f"
eq "nothing was written for those" "$(sql "select sum(views) from website_visit_daily")" "3"
eq "the slug's own case and spaces don't matter" "$(view ' MainShop ' home direct true)" "t"

echo "--- reading, per shop"
has "nobody signed out reads the table" "$(sql "SET role anon; select count(*) from website_visit_daily")" "permission denied"
has "nobody writes the table directly" "$(as owner "insert into website_visit_daily values ('$B1', current_date, 'home', 'direct', 1000)")" "permission denied"
eq "the owner sees visits (landings only)" "$(stats owner $B1 "->>'visits'")" "3"
eq "and pages opened (all)" "$(stats owner $B1 "->>'views'")" "4"
eq "where visits came from" "$(stats owner $B1 "->'sources'")" '[{"source": "direct", "visits": 2}, {"source": "search", "visits": 1}]'
eq "today's visits in the day list" "$(stats owner $B1 "->'byDay'->-1->>'visits'")" "3"
eq "visits are counted" "$(stats owner $B1 "->>'visitsCounted'")" "true"
eq "another shop sees none of them" "$(stats owner $B2 "->>'views'")" "0"
has "a cashier may not see statistics" "$(stats cash $B2 "->>'views'")" "permission"
has "a stranger may not either" "$(stats stranger $B1 "->>'views'")" "permission"
eq "a stranger reads no rows" "$(as stranger "select count(*) from website_visit_daily")" "0"

echo "--- flood limit (per IP, 300 in 10 minutes)"
sql "insert into rate_limits (key, window_start, count) values ('webview:unknown', now(), 300) on conflict (key) do update set count = 300, window_start = now()" >/dev/null
eq "the 301st page in ten minutes is not counted" "$(view mainshop home direct true)" "f"
eq "and was not written" "$(sql "select sum(views) from website_visit_daily")" "4"
sql "delete from rate_limits where key like 'webview:%'" >/dev/null

echo "--- own address check"
has "the app cannot start the nightly check" "$(as owner "select website_domains_recheck()")" "permission denied"
has "nor can a visitor" "$(sql "SET role anon; select website_domains_recheck()")" "permission denied"
eq "with no own addresses it does nothing" "$(sql "select website_domains_recheck()")" ""

echo
echo "$PASS passed, $FAIL failed"
[ $FAIL -eq 0 ]
