#!/bin/bash
# Website engine phase 8: five fictional businesses, each with its own owner, taken end to end
# (brand, homepage, preview, publish, live website, own address, visits, put back) on one
# database, checking at every step that no business sees, changes or is served another's
# website. All names, addresses and people here are made up. Local test build only, never live.
#   C=supabase_db_isms-seedtest bash supabase/tests/promotions/rebuild.sh
#   C=supabase_db_isms-seedtest bash supabase/tests/website/tenants_test.sh
HERE=$(cd "$(dirname "$0")" && pwd)
source "$HERE/../promotions/lib.sh"

# slug | business name | industry | colour | heading font | tagline | homepage
TENANTS=(
  'rosepetal|Rosepetal Skin Studio|beauty|#e8b4b8|Lora|Skin care, slowly made|[{"kind":"hero","variant":"statement"},{"kind":"story","variant":"split"},{"kind":"products","variant":"grid","title":"Rosepetal favourites"}]'
  'greenvalley|Green Valley Dairy|food_grocery|#2f7d4f|Poppins|Milk from our own farm|[{"kind":"hero","variant":"banner"},{"kind":"categories","variant":"circles"},{"kind":"products","variant":"carousel","title":"Green Valley today"}]'
  'voltline|Voltline Electronics|electronics|#1d5bd8|Inter|Phones and parts, tested|[{"kind":"hero","variant":"carousel"},{"kind":"offers","variant":"grid"},{"kind":"products","variant":"grid","title":"Voltline deals"}]'
  'harboradvisory|Harbor Advisory|professional_services|#1f3a5f|DM Sans|Tax and books, done right|[{"kind":"hero","variant":"statement"},{"kind":"trust","variant":"boxes"},{"kind":"visit","variant":"card"}]'
  'swiftcargo|Swiftcargo Couriers|logistics|#f59e0b|Inter|Parcels across town by noon|[{"kind":"hero","variant":"banner"},{"kind":"products","variant":"grid","title":"Swiftcargo services"}]'
)
N=${#TENANTS[@]}
f(){ cut -d'|' -f"$2" <<<"${TENANTS[$(( $1 - 1 ))]}"; }
bid(){ echo "d${1}000000-0000-0000-0000-000000000000"; }
for i in $(seq 1 $N); do UID_OF[o$i]="c${i}000000-0000-0000-0000-000000000000"; done
B6=d6000000-0000-0000-0000-000000000000   # a second shop of tenant 5's owner
UID_OF[stranger]=a8000000-0000-0000-0000-000000000000
live(){ sql "SET role anon; select get_public_storefront('$1')$2"; }
host(){ sql "SET role anon; select resolve_website_host('$1')$2"; }
rev(){ as "o$1" "select website_draft_get('$(bid $1)')->>'revision'"; }
nul(){ sed 's/^$/NULL/' <<<"$1"; }

echo "--- five businesses, one owner each, nothing shared"
setup="INSERT INTO auth.users (id, email, aud, role) VALUES ('${UID_OF[stranger]}','stranger@t.test','authenticated','authenticated') ON CONFLICT DO NOTHING;
update platform_settings set platform_domain='shops.test', custom_domain_target='customers.shops.test' where id;
delete from website_domains; delete from website_visit_daily; delete from rate_limits where key like 'webview:%'; delete from website_preview_links;"
for i in $(seq 1 $N) 6; do
  o=$i; [ $i -eq 6 ] && o=5
  b=$(bid $i); [ $i -eq 6 ] && b=$B6
  name=$( [ $i -eq 6 ] && echo "Swiftcargo Thika" || f $i 2 ); slug=$( [ $i -eq 6 ] && echo "swiftcargo-thika" || f $i 1 )
  setup+="
INSERT INTO auth.users (id, email, aud, role) VALUES ('${UID_OF[o$o]}','owner$o@tenant.test','authenticated','authenticated') ON CONFLICT DO NOTHING;
INSERT INTO public.users (id, auth_user_id, name, email) VALUES ('00000000-0000-0000-0000-0000000000c$o','${UID_OF[o$o]}','Owner $o','owner$o@tenant.test') ON CONFLICT DO NOTHING;
INSERT INTO public.businesses (id, name, tenant_id) VALUES ('$b','$name', (select tenant_id from businesses where id='$(bid 5)' and $i = 6)) ON CONFLICT DO NOTHING;
INSERT INTO public.business_memberships (business_id, user_id, role, status) VALUES ('$b',(select id from public.users where auth_user_id='${UID_OF[o$o]}'),'Owner','Active') ON CONFLICT DO NOTHING;
update businesses set website_slug='$slug' where id='$b';
update tenant_subscriptions set plan_code='pro_plus', status='active' where tenant_id=(select tenant_id from businesses where id='$b');
INSERT INTO public.products (id, business_id, name, category, price, cost, stock) VALUES ('f${i}000000-0000-0000-0000-000000000000','$b','$name product','Test',100,50,10) ON CONFLICT DO NOTHING;
delete from website_published where business_id='$b'; delete from website_versions where business_id='$b'; delete from website_drafts where business_id='$b'; delete from website_brand where business_id='$b'; update website_settings set home=null, navigation=null, seo=null where business_id='$b';"
done
out=$(sql "$setup" | grep ERROR || true)
eq "five fictional businesses created" "$out" ""
eq "five separate accounts (tenants)" "$(sql "select count(distinct tenant_id) from businesses where id::text like 'd_000000-%'")" "5"
eq "tenant 5's second shop is in the same account" "$(sql "select count(distinct tenant_id) from businesses where id in ('$(bid 5)','$B6')")" "1"

echo "--- each owner builds and publishes their own website"
for i in $(seq 1 $N); do
  doc="{\"brand\":{\"industry\":\"$(f $i 3)\",\"tagline\":\"$(f $i 6)\",\"heading_font\":\"$(f $i 5)\"},\"home\":$(f $i 7),\"seo\":{\"title\":\"$(f $i 2)\"}}"
  ok "$(f $i 2): draft saved" "$(as o$i "select website_draft_save('$(bid $i)', '$doc'::jsonb, 0)")"
  eq "$(f $i 2): nothing live yet" "$(live $(f $i 1) "->'brand'->>'tagline'")" ""
  L=$(as o$i "select website_preview_link('$(bid $i)')"); S=$(sed -E 's/.*"secret": "([0-9a-f]+)".*/\1/' <<<"$L")
  has "$(f $i 2): preview shows the draft" "$(sql "SET role anon; select get_preview_storefront('$(f $i 1)', '$S')->'brand'->>'tagline'")" "$(f $i 6)"
  j=$(( i % N + 1 ))
  eq "$(f $i 2): its preview secret opens nothing at $(f $j 1)" "$(nul "$(sql "SET role anon; select get_preview_storefront('$(f $j 1)', '$S')")")" "NULL"
  ok "$(f $i 2): published" "$(as o$i "select website_publish('$(bid $i)', 1, 'First website')")"
done

echo "--- every live website is its own"
for i in $(seq 1 $N); do
  S=$(live $(f $i 1))
  has "$(f $i 1): own tagline" "$S" "\"tagline\": \"$(f $i 6)\""
  has "$(f $i 1): own heading font" "$S" "\"headingFont\": \"$(f $i 5)\""
  eq "$(f $i 1): own homepage" "$(live $(f $i 1) "->'home'->>-1")" "$(sql "select ('$(f $i 7)'::jsonb->-1)::text")"
  has "$(f $i 1): own products" "$S" "$(f $i 2) product"
  for j in $(seq 1 $N); do
    [ $i -eq $j ] && continue
    if grep -qF -e "$(f $j 6)" -e "$(f $j 2) product" <<<"$S"; then
      FAIL=$((FAIL+1)); echo "FAIL  $(f $i 1) shows something of $(f $j 1)"
    fi
  done
done
PASS=$((PASS+1)); echo "pass  no live website shows another business's tagline or products"
eq "the second shop of tenant 5 was not changed by its sister shop's publish" "$(sql "select count(*) from website_versions where business_id='$B6'")" "0"

echo "--- addresses: the database decides which business, never the visitor"
for i in $(seq 1 $N); do
  eq "$(f $i 1).shops.test serves $(f $i 1)" "$(host "$(f $i 1).shops.test" "->>'slug'")" "$(f $i 1)"
done
eq "upper case and a trailing dot are the same address" "$(host "VOLTLINE.shops.test." "->>'slug'")" "voltline"
eq "a made-up shop address serves nothing" "$(host "nosuchshop.shops.test" "->>'kind'")" "none"
eq "a nested address serves nothing" "$(host "rosepetal.voltline.shops.test" "->>'kind'")" "none"
sql "insert into website_domains (business_id, hostname, status) values ('$(bid 3)', 'shop.voltline.test', 'active'), ('$(bid 4)', 'harbor.test', 'pending')" >/dev/null
eq "an active own address serves its business" "$(host "shop.voltline.test" "->>'slug'")" "voltline"
eq "and the subdomain now sends visitors there" "$(host "voltline.shops.test")" '{"host": "shop.voltline.test", "kind": "redirect"}'
eq "an own address still being checked serves nothing" "$(host "harbor.test" "->>'kind'")" "none"
eq "so that business stays on its subdomain" "$(host "harboradvisory.shops.test" "->>'slug'")" "harboradvisory"
has "an address cannot be taken twice" "$(sql "insert into website_domains (business_id, hostname, status) values ('$(bid 1)', 'shop.voltline.test', 'active')")" "duplicate"
eq "an owner cannot read another business's address" "$(as o1 "select count(*) from website_domains where business_id='$(bid 3)'")" "0"
has "an owner cannot write an address directly" "$(as o1 "insert into website_domains (business_id, hostname, status) values ('$(bid 1)', 'rose.test', 'active')")" "permission denied"
sql "update website_domains set status='failed' where business_id='$(bid 3)'" >/dev/null
eq "when the own address stops working the subdomain serves again" "$(host "voltline.shops.test" "->>'kind'")" "shop"

echo "--- one owner may not touch another's website"
for i in $(seq 1 $N); do
  j=$(( i % N + 1 )); B=$(bid $j)
  has "owner $i cannot open $(f $j 1)'s editor" "$(as o$i "select website_draft_get('$B')")" "permission"
  has "owner $i cannot save a draft for $(f $j 1)" "$(as o$i "select website_draft_save('$B', '{\"brand\":{\"tagline\":\"taken over\"}}'::jsonb, 0)")" "permission"
  has "owner $i cannot publish $(f $j 1)" "$(as o$i "select website_publish('$B', 0)")" "permission"
  has "owner $i cannot make a preview link for $(f $j 1)" "$(as o$i "select website_preview_link('$B')")" "permission"
  has "owner $i cannot put back $(f $j 1)" "$(as o$i "select website_rollback('$B', (select id from website_versions where business_id='$B' limit 1))")" "permission"
  has "owner $i cannot read $(f $j 1)'s statistics" "$(as o$i "select website_stats('$B', 30)")" "permission"
  eq "owner $i reads none of $(f $j 1)'s brand (no copying)" "$(as o$i "select count(*) from website_brand where business_id='$B'")" "0"
  eq "owner $i reads none of $(f $j 1)'s history" "$(as o$i "select count(*) from website_versions where business_id='$B'")" "0"
done
eq "every website still says what its owner published" "$(for i in $(seq 1 $N); do live $(f $i 1) "->'brand'->>'tagline'"; done | paste -sd'|')" "$(for i in $(seq 1 $N); do f $i 6; done | paste -sd'|')"
eq "tenant 5's owner reads their own shop's brand, to copy it to their other shop" "$(as o5 "select tagline from website_brand where business_id='$(bid 5)'")" "$(f 5 6)"

echo "--- visits are counted per business"
for i in $(seq 1 $N); do
  for k in $(seq 1 $i); do sql "SET role anon; select record_website_view('$(f $i 1)', 'home', 'direct', true)" >/dev/null; done
done
for i in $(seq 1 $N); do
  eq "$(f $i 1) sees its own $i visits only" "$(as o$i "select website_stats('$(bid $i)', 30)->>'visits'")" "$i"
done
eq "the second shop counts none of its sister's" "$(as o5 "select website_stats('$B6', 30)->>'visits'")" "0"
eq "an owner reads only their own visit rows" "$(as o2 "select count(distinct business_id) from website_visit_daily")" "1"

echo "--- a plan that stops closes only that website"
sql "update tenant_subscriptions set status='suspended' where tenant_id=(select tenant_id from businesses where id='$(bid 4)')" >/dev/null
eq "the suspended business's website is closed" "$(host "harboradvisory.shops.test" "->>'kind'")" "closed"
eq "its storefront returns nothing" "$(nul "$(live harboradvisory)")" "NULL"
eq "it counts no visits" "$(sql "SET role anon; select record_website_view('harboradvisory', 'home', 'direct', true)")" "f"
eq "the others stay open" "$(for i in 1 2 3 5; do host "$(f $i 1).shops.test" "->>'kind'"; done | paste -sd,)" "shop,shop,shop,shop"
sql "update tenant_subscriptions set status='active' where tenant_id=(select tenant_id from businesses where id='$(bid 4)')" >/dev/null

echo "--- putting one website back leaves the rest alone"
ok "Rosepetal publishes a second look" "$(as o1 "select website_draft_save('$(bid 1)', '{\"brand\":{\"tagline\":\"Second look\"}}'::jsonb, 0)") $(as o1 "select website_publish('$(bid 1)', 1)")"
ok "and puts the first one back" "$(as o1 "select website_rollback('$(bid 1)', (select id from website_versions where business_id='$(bid 1)' and number=2))")"
eq "Rosepetal shows its first look" "$(live rosepetal "->'brand'->>'tagline'")" "$(f 1 6)"
eq "the others have one publish each, as before" "$(sql "select string_agg(n::text, ',' order by b) from (select business_id b, count(*) filter (where kind='publish') n from website_versions where business_id in ('$(bid 2)','$(bid 3)','$(bid 4)','$(bid 5)') group by 1) x")" "1,1,1,1"

echo "--- no stray test data"
eq "every test business is a made-up .test one" "$(sql "select count(*) from auth.users where id::text like 'c_000000-%' and email not like '%@tenant.test'")" "0"

echo
echo "$PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
