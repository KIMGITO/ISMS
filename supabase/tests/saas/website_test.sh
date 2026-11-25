#!/bin/bash
# SaaS step 6 (20261204004): shop addresses. Subdomain per shop, reserved names, two name
# changes a year with 90-day redirects, own domains, the shop only open on a plan with the
# Online store, and orders refused when it isn't.
#   C=supabase_db_isms-seedtest bash supabase/tests/promotions/rebuild.sh
#   C=supabase_db_isms-seedtest bash supabase/tests/saas/website_test.sh
HERE=$(cd "$(dirname "$0")" && pwd)
source "$HERE/../promotions/lib.sh"
UID_OF[admin]=a9000000-0000-0000-0000-000000000000
UID_OF[stranger]=a8000000-0000-0000-0000-000000000000
B1=b1000000-0000-0000-0000-000000000000
B2=b2000000-0000-0000-0000-000000000000

sql "
INSERT INTO auth.users (id, email, aud, role) VALUES
 ('${UID_OF[admin]}','admin@t.test','authenticated','authenticated'),
 ('${UID_OF[stranger]}','stranger@t.test','authenticated','authenticated') ON CONFLICT DO NOTHING;
INSERT INTO public.users (id, auth_user_id, name, email) VALUES
 ('00000000-0000-0000-0000-0000000000a9','${UID_OF[admin]}','Pat Platform','admin@t.test'),
 ('00000000-0000-0000-0000-0000000000a8','${UID_OF[stranger]}','Sam Stranger','stranger@t.test') ON CONFLICT DO NOTHING;
INSERT INTO public.platform_admins (auth_user_id, name) VALUES ('${UID_OF[admin]}', 'Pat') ON CONFLICT DO NOTHING;" >/dev/null
T=$(sql "select tenant_id from businesses where id='$B1'")
anon(){ sql "SET role anon; $1"; }
kind(){ anon "select resolve_website_host('$1')->>'kind'"; }

echo "--- before the platform has a domain"
as owner "update businesses set website_slug='mainshop' where id='$B1'" >/dev/null
eq "no platform domain: a subdomain finds nothing" "$(kind 'mainshop.example.test')" "none"
as admin "select platform_update_settings('{\"platform_domain\":\"shops.test\",\"platform_name\":\"Shopsy\"}')" >/dev/null

echo "--- subdomains"
R=$(anon "select resolve_website_host('MainShop.Shops.test:443')")
has "the shop is found from its subdomain (any case, port ignored)" "$R" '"slug": "mainshop"'
has "it carries its home address" "$R" '"host": "mainshop.shops.test"'
has "Pro Plus shows no Powered by" "$R" '"powered_by": false'
eq "the bare platform domain is the platform" "$(kind 'shops.test')" "platform"
eq "www is the platform" "$(kind 'www.shops.test')" "platform"
eq "an unknown subdomain says nothing" "$(kind 'nobody.shops.test')" "none"
eq "two levels deep says nothing" "$(kind 'a.mainshop.shops.test')" "none"
eq "rubbish says nothing" "$(kind 'not a host!')" "none"
eq "an unknown outside domain says nothing" "$(kind 'evil.example.com')" "none"
has "anyone can read the open storefront" "$(anon "select get_public_storefront('mainshop')->'site'")" '"ordersOpen": true'

echo "--- website names"
has "reserved names are refused" "$(as owner "update businesses set website_slug='admin' where id='$B2'")" "kept for the platform"
has "too short is refused" "$(as owner "update businesses set website_slug='ab' where id='$B2'")" "3 to 40"
ok "a branch takes its first name (not a change)" "$(as owner "update businesses set website_slug='second' where id='$B2'")"
eq "a first name leaves two changes" "$(as owner "select website_address_info('$B2')->>'changes_left'")" "2"
ok "first change" "$(as owner "update businesses set website_slug='second-shop' where id='$B2'")"
eq "the old name sends visitors on" "$(anon "select resolve_website_host('second.shops.test')->>'host'")" "second-shop.shops.test"
eq "the old name redirects" "$(kind 'second.shops.test')" "redirect"
has "another shop can't take a name in its 90 days" "$(as owner "update businesses set website_slug='second' where id='$B1'")" "used that website name recently"
ok "second change" "$(as owner "update businesses set website_slug='branch-two' where id='$B2'")"
has "a third change in a year is refused" "$(as owner "update businesses set website_slug='branch-2' where id='$B2'")" "twice a year"
eq "none left" "$(as owner "select website_address_info('$B2')->>'changes_left'")" "0"
eq "both old names still redirect" "$(as owner "select jsonb_array_length(website_address_info('$B2')->'old_names')")" "2"
ok "the server (admin website) can still change it" "$(sql "update businesses set website_slug='second' where id='$B2'")"
eq "taking back its own old name ends that redirect" "$(sql "select count(*) from website_slug_history where business_id='$B2' and old_slug='second'")" "0"
has "a cashier can't see the address settings" "$(as cash "select website_address_info('$B1')")" "Only the owner or an admin"
eq "nobody reads the name history directly" "$(as owner "select count(*) from website_slug_history" | grep -c 'permission denied')" "1"

echo "--- own domains"
has "a cashier can't add an address" "$(as cash "select website_domain_start('$B1','shop.example.co.ke')")" "Only the owner or an admin"
has "an address must be one" "$(as owner "select website_domain_start('$B1','not an address')")" "not a web address"
has "the platform's own domain is refused" "$(as owner "select website_domain_start('$B1','x.shops.test')")" "belongs to the platform"
R=$(as owner "select website_domain_start('$B1','HTTPS://Shop.Example.co.ke/home')")
has "the owner adds an address (cleaned)" "$R" '"hostname": "shop.example.co.ke"'
has "another shop can't use it" "$(as owner "select website_domain_start('$B2','shop.example.co.ke')")" "already in use"
eq "a pending address isn't served" "$(kind 'shop.example.co.ke')" "none"
sql "update website_domains set status='active', cf_hostname_id='cf1' where business_id='$B1'" >/dev/null
eq "an active address serves the shop" "$(anon "select resolve_website_host('shop.example.co.ke')->>'slug'")" "mainshop"
eq "the subdomain now sends visitors to it" "$(anon "select resolve_website_host('mainshop.shops.test')->>'host'")" "shop.example.co.ke"
eq "a stranger can't read the domains" "$(as stranger "select count(*) from website_domains")" "0"
eq "the owner reads theirs" "$(as owner "select status from website_domains where business_id='$B1'")" "active"
eq "nobody writes the table directly" "$(as owner "update website_domains set status='pending'" | grep -c 'permission denied')" "1"

echo "--- plans"
as admin "select platform_change_plan('$T','pro','manual'); select platform_set_addons('$T', array[]::text[])" >/dev/null
eq "Pro without the Online store: closed" "$(kind 'mainshop.shops.test')" "closed"
eq "and the own domain stops too" "$(kind 'shop.example.co.ke')" "closed"
eq "the storefront is empty" "$(anon "select get_public_storefront('mainshop') is null")" "t"
has "Pro can't add an own address without the add-on" "$(as owner "select website_domain_start('$B2','two.example.co.ke')")" "does not include your own web address"
has "no order reaches a closed shop" "$(sql "insert into online_orders (order_number, business_id, customer_name, customer_phone, fulfilment, subtotal, total) values (999001, '$B1', 'A', '0700', 'pickup', 1, 1)")" "not taking online orders"
as admin "select platform_set_addons('$T', array['online_store'])" >/dev/null
R=$(anon "select resolve_website_host('mainshop.shops.test')")
has "Pro with the Online store add-on: open" "$R" '"kind": "shop"'
has "Pro shows Powered by" "$R" '"powered_by": true'
has "with the platform's name" "$R" '"platform_name": "Shopsy"'
eq "the own domain isn't the home without its add-on" "$(kind 'shop.example.co.ke')" "redirect"
as admin "select platform_set_addons('$T', array['online_store','own_domain'])" >/dev/null
has "Pro with an own domain shows no Powered by" "$(anon "select resolve_website_host('shop.example.co.ke')")" '"powered_by": false'
as admin "select platform_set_suspended('$T', true, 'test')" >/dev/null
eq "a suspended company's shop is closed" "$(kind 'shop.example.co.ke')" "closed"
as admin "select platform_set_suspended('$T', false); select platform_change_plan('$T','pro_plus','manual')" >/dev/null
eq "back on Pro Plus it opens" "$(kind 'shop.example.co.ke')" "shop"

echo "--- removing"
eq "the owner removes the address (Cloudflare id returned)" "$(as owner "select website_domain_remove('$B1')")" "cf1"
eq "the subdomain is the home again" "$(kind 'mainshop.shops.test')" "shop"
eq "the removed address says nothing" "$(kind 'shop.example.co.ke')" "none"

echo "website: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
