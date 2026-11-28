#!/bin/bash
# Website engine phases 4-5 (20261206002): draft, publish, history, put back, preview links,
# who may do what, and that nothing a visitor sees changes before Publish.
#   C=supabase_db_isms-seedtest bash supabase/tests/promotions/rebuild.sh
#   C=supabase_db_isms-seedtest bash supabase/tests/website/drafts_test.sh   (after brand_test.sh, which
#   re-runs 20261206001 and so puts back that file's storefront function)
HERE=$(cd "$(dirname "$0")" && pwd)
source "$HERE/../promotions/lib.sh"
M=$(cd "$HERE/../../migrations" && pwd)
UID_OF[stranger]=a8000000-0000-0000-0000-000000000000
B1=b1000000-0000-0000-0000-000000000000
B2=b2000000-0000-0000-0000-000000000000
rev(){ as owner "select (website_draft_get('$1')->>'revision')"; }
save(){ as "$1" "select website_draft_save('$2', '$3'::jsonb, $4)"; }
live(){ sql "SET role anon; select get_public_storefront('$1')$2"; }

sql "INSERT INTO auth.users (id, email, aud, role) VALUES ('${UID_OF[stranger]}','stranger@t.test','authenticated','authenticated') ON CONFLICT DO NOTHING;
update businesses set website_slug='mainshop' where id='$B1'; update businesses set website_slug='branchtwo' where id='$B2';
update tenant_subscriptions set plan_code='pro_plus', status='active' where tenant_id in (select tenant_id from businesses where id in ('$B1','$B2'));
insert into website_settings (business_id, hero_slides) values ('$B1', '[]') on conflict do nothing;
delete from website_published where business_id in ('$B1','$B2'); delete from website_versions where business_id in ('$B1','$B2');
delete from website_drafts where business_id in ('$B1','$B2'); delete from website_preview_links;
update website_settings set home=null, navigation=null, seo=null, whatsapp=null, delivery_fee=0 where business_id in ('$B1','$B2');
delete from website_brand where business_id in ('$B1','$B2');" >/dev/null

echo "--- the migration runs twice"
out=$(docker exec -i $C psql -U postgres -q -d $DB -v ON_ERROR_STOP=1 -1 < "$M/../migrations_archive/20261206002_website_drafts_publish.sql" 2>&1 | grep ERROR || true)
eq "migration is repeatable" "$out" ""

echo "--- reading the draft"
D=$(as owner "select website_draft_get('$B1')")
has "no draft yet: the live website, revision 0" "$D" '"revision": 0'
has "no draft yet: nothing changed" "$D" '"changed": false'
has "cashier may not open the website editor" "$(as cash "select website_draft_get('$B1')")" "permission"
has "a stranger may not either" "$(as stranger "select website_draft_get('$B1')")" "permission"

echo "--- saving the draft does not change the live website"
ok "owner saves a draft" "$(save owner $B1 '{"brand":{"tagline":"Fresh every day","industry":"food_grocery"},"home":[{"kind":"hero","variant":"statement"},{"kind":"products","variant":"grid","title":"Our best"}],"seo":{"title":"Main Shop | Fresh food"}}' 0)"
eq "revision is now 1" "$(rev $B1)" "1"
has "draft is marked as changed" "$(as owner "select website_draft_get('$B1')")" '"changed": true'
eq "live tagline untouched" "$(live mainshop "->'brand'->>'tagline'")" ""
eq "live home untouched" "$(live mainshop "->'home'")" ""
has "a stale save is refused" "$(save owner $B1 '{"brand":{"tagline":"x"}}' 0)" "Someone else saved"
has "a save from another shop's member is refused" "$(save stranger $B1 '{"brand":{"tagline":"x"}}' 1)" "permission"

echo "--- a draft is checked like a publish"
has "unknown part" "$(save owner $B1 '{"css":"body{}"}' 1)" "Unknown website part"
has "unknown brand field" "$(save owner $B1 '{"brand":{"script":"x"}}' 1)" "Unknown brand setting"
has "unknown section" "$(save owner $B1 '{"home":[{"kind":"iframe"}]}' 1)" "does not know"
has "javascript menu link" "$(save owner $B1 '{"navigation":{"header":[{"label":"Go","href":"javascript:alert(1)"}]}}' 1)" "menu link"
has "protocol-relative menu link" "$(save owner $B1 '{"navigation":{"header":[{"label":"Go","href":"//evil.test"}]}}' 1)" "menu link"
has "nine menu links" "$(save owner $B1 "{\"navigation\":{\"header\":[$(for i in 1 2 3 4 5 6 7 8 9; do printf '{"label":"L%s","href":"/shop"},' $i; done | sed 's/,$//')]}}" 1)" "menu link"
has "long search title" "$(save owner $B1 "{\"seo\":{\"title\":\"$(printf 'x%.0s' {1..71})\"}}" 1)" "Search engine text"
has "font not on the list" "$(save owner $B1 '{"brand":{"heading_font":"Comic Sans"}}' 1)" "font"
has "dark page background" "$(save owner $B1 '{"brand":{"background_color":"#111111"}}' 1)" "light page background"
has "bad WhatsApp number" "$(save owner $B1 '{"contact":{"whatsapp":"call me"}}' 1)" "WhatsApp"
has "page text that is not text" "$(save owner $B1 '{"pages":{"about":{"html":"<b>"}}}' 1)" "page"
eq "refused saves leave the revision alone" "$(rev $B1)" "1"
eq "and the live tables alone" "$(sql "select coalesce((select heading_font from website_brand where business_id='$B1'),'-')")" "-"
ok "valid menu and contact" "$(save owner $B1 '{"navigation":{"header":[{"label":"Shop","href":"/shop"},{"label":"Blog","href":"https://blog.example.com/x"}]},"contact":{"whatsapp":"+254 712 345678"}}' 1)"
eq "parts not sent are kept" "$(as owner "select website_draft_get('$B1')->'document'->'brand'->>'tagline'")" "Fresh every day"

echo "--- nobody writes the design directly"
has "owner cannot write banner slides directly" "$(as owner "update website_settings set hero_slides='[]' where business_id='$B1'")" "permission denied"
has "owner cannot write the home arrangement directly" "$(as owner "update website_settings set home='[]' where business_id='$B1'")" "permission denied"
has "owner cannot call the brand save directly" "$(as owner "select website_brand_save('$B1','{\"tagline\":\"x\"}')")" "permission denied"
has "owner cannot read draft rows directly" "$(as owner "select count(*) from website_drafts")" "permission denied"
ok "delivery fee still saves directly (old screen)" "$(as owner "insert into website_settings (business_id, delivery_enabled, delivery_fee, min_order, assistant_enabled) values ('$B1', true, 150, 0, true) on conflict (business_id) do update set business_id=excluded.business_id, delivery_enabled=excluded.delivery_enabled, delivery_fee=excluded.delivery_fee, min_order=excluded.min_order, assistant_enabled=excluded.assistant_enabled")"

echo "--- preview"
L=$(as owner "select website_preview_link('$B1')")
S=$(sed -E 's/.*"secret": "([0-9a-f]+)".*/\1/' <<<"$L")
eq "secret is 48 hex characters" "${#S}" "48"
eq "only the hash is stored" "$(sql "select count(*) from website_preview_links where encode(secret_hash,'hex')='$S'")" "0"
P=$(sql "SET role anon; select get_preview_storefront('mainshop', '$S')")
has "preview shows the draft tagline" "$P" '"tagline": "Fresh every day"'
has "preview shows the draft home" "$P" '"title": "Our best"'
has "preview shows the draft menu" "$P" '"href": "https://blog.example.com/x"'
has "preview is marked" "$P" '"preview": true'
has "preview takes no orders" "$P" '"ordersOpen": false'
eq "preview keeps internal notes private" "$(grep -c 'guidelines\|audience' <<<"$P")" "0"
eq "the secret does not work on another shop's address" "$(sql "SET role anon; select coalesce(get_preview_storefront('branchtwo', '$S')::text,'NULL')")" "NULL"
eq "a made-up secret shows nothing" "$(sql "SET role anon; select coalesce(get_preview_storefront('mainshop', repeat('a',48))::text,'NULL')")" "NULL"
eq "an expired secret shows nothing" "$(sql "update website_preview_links set expires_at=now()-interval '1 minute'; SET role anon; select coalesce(get_preview_storefront('mainshop', '$S')::text,'NULL')")" "NULL"
has "cashier cannot make a preview link" "$(as cash "select website_preview_link('$B1')")" "permission"

echo "--- publish"
has "cashier cannot publish" "$(as cash "select website_publish('$B1', 2)")" "permission"
has "stale publish refused" "$(as owner "select website_publish('$B1', 1)")" "Someone else saved"
ok "owner publishes" "$(as owner "select website_publish('$B1', 2, 'New look')")"
eq "live tagline now set" "$(live mainshop "->'brand'->>'tagline'")" "Fresh every day"
eq "live home now set" "$(live mainshop "->'home'->1->>'title'")" "Our best"
eq "live SEO title now set" "$(live mainshop "->'seo'->>'title'")" "Main Shop | Fresh food"
eq "live WhatsApp now set" "$(live mainshop "->'settings'->>'whatsapp'")" "+254 712 345678"
eq "delivery fee kept" "$(live mainshop "->'settings'->>'deliveryFee'")" "150.00"
eq "versions: start + publish" "$(sql "select string_agg(number||':'||kind, ',' order by number) from website_versions where business_id='$B1'")" "1:start,2:publish"
eq "the draft is gone after publishing" "$(rev $B1)" "0"
has "nothing changed after publishing" "$(as owner "select website_draft_get('$B1')")" '"changed": false'
has "published info shows version 2 and who" "$(as owner "select website_draft_get('$B1')->'published'")" '"by": "Olive Owner"'
has "nothing to publish now" "$(as owner "select website_publish('$B1', 0)")" "no changes"
eq "owner reads the history list" "$(as owner "select count(*) from website_versions where business_id='$B1'")" "2"
eq "cashier does not" "$(as cash "select count(*) from website_versions where business_id='$B1'")" "0"
has "history documents are not readable directly" "$(as owner "select document from website_versions limit 1")" "permission denied"
eq "other shop untouched" "$(sql "select count(*) from website_versions where business_id='$B2'")" "0"

echo "--- put back"
ok "second change published" "$(save owner $B1 '{"brand":{"tagline":"Second look"},"home":null}' 0) $(as owner "select website_publish('$B1', 1)")"
eq "live shows the second look" "$(live mainshop "->'brand'->>'tagline'")" "Second look"
V1=$(sql "select id from website_versions where business_id='$B1' and number=1")
V2=$(sql "select id from website_versions where business_id='$B1' and number=2")
has "another shop's version cannot be put back here" "$(as owner "select website_rollback('$B2', '$V2')")" "not found"
has "cashier cannot put back" "$(as cash "select website_rollback('$B1', '$V2')")" "permission"
ok "put back version 2" "$(as owner "select website_rollback('$B1', '$V2')")"
eq "live tagline is version 2's again" "$(live mainshop "->'brand'->>'tagline'")" "Fresh every day"
eq "live home is version 2's again" "$(live mainshop "->'home'->1->>'title'")" "Our best"
eq "put back is a new version" "$(sql "select kind||':'||note from website_versions where business_id='$B1' order by number desc limit 1")" "rollback:Put back version 2"
ok "put back the very start" "$(as owner "select website_rollback('$B1', '$V1')")"
eq "start had no tagline" "$(live mainshop "->'brand'->>'tagline'")" ""
eq "start had no home arrangement" "$(live mainshop "->'home'")" ""
eq "delivery fee survives put back" "$(live mainshop "->'settings'->>'deliveryFee'")" "150.00"

echo
echo "passed $PASS, failed $FAIL"
[ "$FAIL" -eq 0 ]
