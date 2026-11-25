#!/bin/bash
# Website engine phase 2 (20261206001): the brand profile. Who may change it, what values are
# refused, existing shops keep the original look, both tables change together, and the public
# storefront carries only the public part.
#   C=supabase_db_isms-seedtest bash supabase/tests/promotions/rebuild.sh
#   C=supabase_db_isms-seedtest bash supabase/tests/website/brand_test.sh
HERE=$(cd "$(dirname "$0")" && pwd)
source "$HERE/../promotions/lib.sh"
M=$(cd "$HERE/../../migrations" && pwd)
UID_OF[stranger]=a8000000-0000-0000-0000-000000000000
B1=b1000000-0000-0000-0000-000000000000
B2=b2000000-0000-0000-0000-000000000000
save(){ as "$1" "select website_brand_save('$2', '$3'::jsonb)"; }

sql "INSERT INTO auth.users (id, email, aud, role) VALUES ('${UID_OF[stranger]}','stranger@t.test','authenticated','authenticated') ON CONFLICT DO NOTHING;" >/dev/null

echo "--- the migration runs twice and seeds existing shops with the original look"
out=$(docker exec -i $C psql -U postgres -q -d $DB -v ON_ERROR_STOP=1 -1 < "$M/20261206001_website_brand.sql" 2>&1 | grep ERROR || true)
eq "migration is repeatable" "$out" ""
eq "existing shops start on the original look" "$(sql "select string_agg(design_preset, ',' order by business_id) from website_brand where business_id in ('$B1','$B2')")" "original,original"
eq "industry guessed from the name" "$(sql "select fn_guess_industry('Retail', 'Mama Dairy Farm')")" "food_grocery"

echo "--- who may change the brand"
ok "owner saves" "$(save owner $B1 '{"industry":"beauty","personality":"premium","tagline":"  Slow skin care  ","primary_color":"#E8B4B8","heading_font":"Lora"}')"
has "cashier is refused" "$(save cash $B2 '{"tagline":"x"}')" "permission"
has "a stranger is refused" "$(save stranger $B1 '{"tagline":"x"}')" "permission"
has "nobody writes the table directly" "$(as owner "update website_brand set tagline='x' where business_id='$B1'")" "permission denied"
eq "cashier can read their shop's brand" "$(as cash "select count(*) from website_brand where business_id='$B2'")" "1"
eq "a stranger reads nothing" "$(as stranger "select count(*) from website_brand")" "0"

echo "--- one record per fact"
eq "tagline trimmed" "$(sql "select tagline from website_brand where business_id='$B1'")" "Slow skin care"
eq "main colour lives on businesses, lower case" "$(sql "select primary_color from businesses where id='$B1'")" "#e8b4b8"
eq "brand table has no colour copy" "$(sql "select count(*) from information_schema.columns where table_name='website_brand' and column_name in ('primary_color','logo_url','description')")" "0"
ok "clearing a field" "$(save owner $B1 '{"tagline":""}')"
eq "empty text = not set" "$(sql "select coalesce(tagline,'NULL') from website_brand where business_id='$B1'")" "NULL"
eq "other fields untouched" "$(sql "select personality||'/'||heading_font from website_brand where business_id='$B1'")" "premium/Lora"

echo "--- refused values"
has "unknown setting" "$(save owner $B1 '{"css":"body{}"}')" "Unknown brand setting"
has "font not on the list" "$(save owner $B1 '{"heading_font":"Comic Sans"}')" "website_brand_heading_font_check"
has "bad colour" "$(save owner $B1 '{"primary_color":"red"}')" "Colours are written like"
has "dark background" "$(save owner $B1 '{"background_color":"#222222"}')" "light page background"
ok "light background accepted" "$(save owner $B1 '{"background_color":"#fbf7f2"}')"
has "logo must be https" "$(save owner $B1 '{"logo_url":"javascript:alert(1)"}')" "uploaded picture"
has "social network not on the list" "$(save owner $B1 '{"social_links":{"myspace":"https://myspace.com/x"}}')" "social_links"
has "social link must be https" "$(save owner $B1 '{"social_links":{"instagram":"http://instagram.com/x"}}')" "social_links"
has "closing before opening" "$(save owner $B1 '{"opening_hours":[{"day":0,"open":"18:00","close":"08:00"}]}')" "opening_hours"
has "unknown industry" "$(save owner $B1 '{"industry":"casino"}')" "industry_check"
ok "valid socials and hours" "$(save owner $B1 '{"social_links":{"instagram":"https://instagram.com/slow"},"opening_hours":[{"day":0,"open":"08:00","close":"18:00"},{"day":6,"open":"10:00","close":"24:00"}],"audience":"Women 25-45 in Nairobi","guidelines":"Never use exclamation marks"}')"

echo "--- the public storefront"
sql "update businesses set website_slug='slowskin' where id='$B1'; update tenant_subscriptions set plan_code='pro_plus', status='active' where tenant_id=(select tenant_id from businesses where id='$B1');" >/dev/null
P=$(sql "SET role anon; select get_public_storefront('slowskin')->'brand'")
has "brand reaches the website" "$P" '"industry": "beauty"'
has "fonts reach the website" "$P" '"headingFont": "Lora"'
has "hours reach the website" "$P" '"openingHours"'
has "socials reach the website" "$P" '"instagram": "https://instagram.com/slow"'
eq "internal notes stay private" "$(grep -c 'Nairobi\|exclamation\|audience\|guidelines\|tone' <<<"$P")" "0"
eq "anon cannot call the brand reader directly" "$(sql "SET role anon; select fn_website_brand_public('$B1')" | grep -c 'permission denied')" "1"
ok "a shop with no brand row still renders" "$(sql "delete from website_brand where business_id='$B2'; select fn_website_brand_public('$B2')")"

echo "PASS=$PASS FAIL=$FAIL"
[ $FAIL -eq 0 ]
