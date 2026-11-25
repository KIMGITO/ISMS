#!/bin/bash
# Marketing & advertising (20261207001): campaigns, creatives, media checks, schedule in the shop's
# time zone, pause/resume/end/archive, what the public website gets, statistics de-duplication,
# conversions, tenant isolation and who may do what.
#   C=supabase_db_isms-seedtest bash supabase/tests/marketing/rebuild.sh
#   C=supabase_db_isms-seedtest bash supabase/tests/marketing/marketing_test.sh
HERE=$(cd "$(dirname "$0")" && pwd)
export DB=${DB:-mkt_test}
source "$HERE/../promotions/lib.sh"
M=$(cd "$HERE/../../migrations" && pwd)
UID_OF[stranger]=a8000000-0000-0000-0000-000000000000
UID_OF[shopper]=a9000000-0000-0000-0000-000000000000
B1=b1000000-0000-0000-0000-000000000000
B3=b3000000-0000-0000-0000-000000000000
P1=d1000000-0000-0000-0000-000000000000
P4=d4000000-0000-0000-0000-000000000000
BASE=https://x.supabase.co/storage/v1/object/public/website-media
first(){ head -n1 <<<"$1"; }
# as_s <who> <session> <sql>: like as, with the session id every real token carries (storage checks it).
as_s(){ local who=$1 sid=$2; shift 2; sql "SET request.jwt.claims = '{\"sub\":\"${UID_OF[$who]}\",\"role\":\"authenticated\",\"session_id\":\"$sid\"}'; SET role authenticated;
$1"; }
pub(){ sql "SET role anon; select get_public_campaigns('$1')$2"; }
# upload <business> <file> <mime> <bytes>: what Storage writes when a file arrives.
upload(){ sql "insert into storage.objects (bucket_id, name, metadata) values ('website-media', '$1/$2', jsonb_build_object('mimetype','$3','size',$4)) on conflict do nothing" >/dev/null; }
reg(){ first "$(as ${4:-owner} "select website_media_register('$1', '$1/$2', '$3'::jsonb || jsonb_build_object('url', '$BASE/$1/$2'))")"; }
save(){ first "$(as ${3:-owner} "select marketing_campaign_save('$1', '$2'::jsonb)")"; }
act(){ first "$(as ${3:-owner} "select marketing_campaign_action('$1', '$2')")"; }
cre(){ first "$(as ${3:-owner} "select marketing_creative_save('$1', '$2'::jsonb)")"; }
VISIT=visit_aaaaaaaaaaaaaaaa
VISIT2=visit_bbbbbbbbbbbbbbbb

sql "SET session_replication_role = replica; -- the sign-up trigger would add duplicate app users
INSERT INTO auth.users (id, email, aud, role) VALUES ('${UID_OF[stranger]}','stranger@t.test','authenticated','authenticated'),
  ('${UID_OF[shopper]}','shopper@t.test','authenticated','authenticated'), ('${UID_OF[owner]}','owner@t.test','authenticated','authenticated'),
  ('${UID_OF[cash]}','cash@t.test','authenticated','authenticated') ON CONFLICT DO NOTHING;
SET session_replication_role = origin;
insert into public.users (id, auth_user_id, name, email) select '00000000-0000-0000-0000-0000000000a8','${UID_OF[stranger]}','Stranger','stranger@t.test'
  where not exists (select 1 from public.users where auth_user_id='${UID_OF[stranger]}');
insert into businesses (id, name) values ('$B3', 'Other Company') on conflict do nothing;
insert into business_memberships (business_id, user_id, role, status) select '$B3', id, 'Owner', 'Active' from public.users where auth_user_id='${UID_OF[stranger]}' on conflict do nothing;
update businesses set website_slug='mainshop' where id='$B1'; update businesses set website_slug='othershop' where id='$B3';
insert into auth.sessions (id, user_id) values ('5e550000-0000-0000-0000-000000000000', '${UID_OF[owner]}'), ('5e550000-0000-0000-0000-000000000002', '${UID_OF[cash]}') on conflict do nothing;
insert into customer_accounts (id, business_id, name, phone) values ('${UID_OF[shopper]}', '$B1', 'Shopper', '0711999999') on conflict do nothing;
delete from marketing_conversions; delete from online_orders where order_number in (9001, 9002); delete from marketing_campaigns; delete from website_media; delete from marketing_placements; delete from marketing_ad_seen;
delete from storage.objects where bucket_id='website-media'; delete from storage.objects where name like '%/direct.webp';" >/dev/null

echo "--- the migration runs twice"
out=$(docker exec -i $C psql -U postgres -q -d $DB -v ON_ERROR_STOP=1 -1 < <(grep -v "cron.schedule('[a-z-]*', '[^']*', \$job" "$M/20261207001_marketing_campaigns.sql") 2>&1 | grep ERROR || true)
eq "migration is repeatable" "$out" ""

echo "--- time zone"
eq "default time zone" "$(sql "select timezone from businesses where id='$B1'")" "Africa/Nairobi"
has "unknown time zone refused" "$(as owner "select business_set_timezone('$B1', 'Mars/Olympus')")" "Unknown time zone"
has "cashier may not change it" "$(as cash "select business_set_timezone('$B1', 'Europe/London')")" "does not allow"

echo "--- media library"
upload $B1 hero.webp image/webp 400000
upload $B1 small.webp image/webp 5000
upload $B1 card.webp image/webp 200000
upload $B1 clip.mp4 video/mp4 9000000
upload $B1 poster.webp image/webp 100000
upload $B1 subs.vtt text/vtt 900
upload $B1 page.html text/html 900
upload $B1 huge.webp image/webp 20000000
upload $B3 theirs.webp image/webp 400000
HERO=$(reg $B1 hero.webp '{"width":1920,"height":1080,"alt_text":"Black Friday banner"}')
SMALL=$(reg $B1 small.webp '{"width":400,"height":225}')
CARD=$(reg $B1 card.webp '{"width":1080,"height":1350}')
CLIP=$(reg $B1 clip.mp4 '{"width":1920,"height":1080,"duration_ms":20000}')
POSTER=$(reg $B1 poster.webp '{"width":1920,"height":1080}')
SUBS=$(reg $B1 subs.vtt '{}')
ok "picture registered" "$HERO"
ok "video registered" "$CLIP"
ok "captions registered" "$SUBS"
eq "size comes from the stored file" "$(sql "select bytes from website_media where id='$HERO'")" "400000"
has "html refused" "$(reg $B1 page.html '{"width":10,"height":10}')" "not accepted"
has "picture over 10 MB refused" "$(reg $B1 huge.webp '{"width":1920,"height":1080}')" "too large"
has "file that was never uploaded refused" "$(reg $B1 ghost.webp '{"width":1920,"height":1080}')" "did not finish"
has "another shop's folder refused" "$(reg $B1 ../$B3/theirs.webp '{"width":1920,"height":1080}')" "folder"
has "a stranger cannot register into this shop" "$(reg $B1 card.webp '{"width":1,"height":1}' stranger)" "does not allow"
has "video without length refused" "$(as owner "select website_media_register('$B1', '$B1/clip.mp4', jsonb_build_object('width',1920,'height',1080,'url','$BASE/$B1/clip.mp4'))")" "between 1 second"
has "url must match the upload" "$(as owner "select website_media_register('$B1', '$B1/card.webp', '{\"width\":1080,\"height\":1350,\"url\":\"https://evil.test/x.webp\"}')")" "does not match"
eq "cashier cannot see the library" "$(as cash "select count(*) from website_media")" "0"
eq "stranger cannot see this shop's library" "$(as stranger "select count(*) from website_media")" "0"
eq "manager sees it" "$(as mgr "select count(*) from website_media where business_id='$B1'")" "6"

echo "--- storage policy"
has "owner may upload into own folder" "$(as_s owner 5e550000-0000-0000-0000-000000000000 "insert into storage.objects (bucket_id, name) values ('website-media', '$B1/direct-$RANDOM$RANDOM.webp') returning name")" "direct-"
has "owner may not upload into another company's folder" "$(as_s owner 5e550000-0000-0000-0000-000000000000 "insert into storage.objects (bucket_id, name) values ('website-media', '$B3/direct.webp')")" "row-level security"
has "cashier may not upload" "$(as_s cash 5e550000-0000-0000-0000-000000000002 "insert into storage.objects (bucket_id, name) values ('website-media', '$B1/c.webp')")" "row-level security"

echo "--- campaigns"
NOW_LOCAL=$(sql "select to_char((now() at time zone 'Africa/Nairobi') - interval '1 hour', 'YYYY-MM-DD\"T\"HH24:MI')")
END_LOCAL=$(sql "select to_char((now() at time zone 'Africa/Nairobi') + interval '3 days', 'YYYY-MM-DD\"T\"HH24:MI')")
FUT_LOCAL=$(sql "select to_char((now() at time zone 'Africa/Nairobi') + interval '2 days', 'YYYY-MM-DD\"T\"HH24:MI')")
BF=$(save $B1 "{\"name\":\"Black Friday\",\"campaign_type\":\"black_friday\",\"starts_local\":\"$NOW_LOCAL\",\"ends_local\":\"$END_LOCAL\",\"priority\":80,\"cta_label\":\"Shop deals\",\"cta_kind\":\"link\",\"cta_target\":\"/shop?offers=1\",\"discount_label\":\"Up to 40% off\",\"landing_slug\":\"black-friday\"}")
ok "owner creates a campaign" "$BF"
eq "starts in the shop's time zone" "$(sql "select to_char(starts_at at time zone 'Africa/Nairobi', 'YYYY-MM-DD\"T\"HH24:MI') from marketing_campaigns where id='$BF'")" "$NOW_LOCAL"
eq "new campaign is a draft" "$(sql "select fn_mkt_status(state, starts_at, ends_at) from marketing_campaigns where id='$BF'")" "draft"
has "end before start refused" "$(save $B1 "{\"name\":\"X\",\"starts_local\":\"$END_LOCAL\",\"ends_local\":\"$NOW_LOCAL\"}")" "end after"
has "javascript link refused" "$(save $B1 "{\"name\":\"X\",\"starts_local\":\"$NOW_LOCAL\",\"cta_kind\":\"link\",\"cta_target\":\"javascript:alert(1)\"}")" "button link"
has "protocol-relative link refused" "$(save $B1 "{\"name\":\"X\",\"starts_local\":\"$NOW_LOCAL\",\"cta_kind\":\"link\",\"cta_target\":\"//evil.test\"}")" "button link"
has "another company's product refused" "$(save $B1 "{\"name\":\"X\",\"starts_local\":\"$NOW_LOCAL\",\"target_product_ids\":[\"$P4\"]}")" "not this shop"
has "unknown field refused" "$(save $B1 "{\"name\":\"X\",\"starts_local\":\"$NOW_LOCAL\",\"html\":\"<b>\"}")" "Unknown campaign setting"
has "cashier may not create" "$(save $B1 "{\"name\":\"X\",\"starts_local\":\"$NOW_LOCAL\"}" cash)" "does not allow"
has "stranger may not create in this shop" "$(save $B1 "{\"name\":\"X\",\"starts_local\":\"$NOW_LOCAL\"}" stranger)" "does not allow"
has "stale save refused" "$(as owner "select marketing_campaign_save('$B1', '{\"id\":\"$BF\",\"name\":\"BF\",\"starts_local\":\"$NOW_LOCAL\"}'::jsonb, 99)")" "Someone else"
has "same page address refused" "$(save $B1 "{\"name\":\"Y\",\"starts_local\":\"$NOW_LOCAL\",\"landing_slug\":\"black-friday\"}")" "page address"

echo "--- creatives"
has "publishing with no creative refused" "$(act $BF publish)" "at least one creative"
HC=$(cre $BF "{\"placement\":\"hero\",\"format\":\"hero_16x9\",\"media_id\":\"$HERO\",\"headline\":\"Black Friday\",\"mobile_media_id\":\"$CARD\",\"mobile_format\":\"card_4x5\"}")
ok "hero with desktop and phone pictures" "$HC"
has "too small picture refused" "$(cre $BF "{\"placement\":\"hero\",\"format\":\"hero_16x9\",\"media_id\":\"$SMALL\",\"alt_text\":\"x\"}")" "too small"
has "wrong format for placement refused" "$(cre $BF "{\"placement\":\"card\",\"format\":\"hero_16x9\",\"media_id\":\"$HERO\"}")" "does not take"
has "picture with no description refused" "$(cre $BF "{\"placement\":\"card\",\"format\":\"card_4x5\",\"media_id\":\"$CARD\"}")" "Describe the picture"
C1=$(cre $BF "{\"placement\":\"card\",\"format\":\"card_4x5\",\"media_id\":\"$CARD\",\"alt_text\":\"Shoes on sale\",\"headline\":\"Shoes\"}")
C2=$(cre $BF "{\"placement\":\"card\",\"format\":\"card_4x5\",\"media_id\":\"$CARD\",\"alt_text\":\"Bags on sale\",\"headline\":\"Bags\"}")
C3=$(cre $BF "{\"placement\":\"card\",\"format\":\"card_4x5\",\"media_id\":\"$CARD\",\"alt_text\":\"Hats on sale\",\"headline\":\"Hats\"}")
ok "three cards" "$C3"
has "video without cover refused" "$(cre $BF "{\"placement\":\"video\",\"format\":\"video_16x9\",\"media_id\":\"$CLIP\",\"alt_text\":\"x\"}")" "cover picture"
has "picture in a video slot refused" "$(cre $BF "{\"placement\":\"video\",\"format\":\"video_16x9\",\"media_id\":\"$HERO\",\"poster_media_id\":\"$POSTER\"}")" "needs a video"
VC=$(cre $BF "{\"placement\":\"video\",\"format\":\"video_16x9\",\"media_id\":\"$CLIP\",\"poster_media_id\":\"$POSTER\",\"captions_media_id\":\"$SUBS\",\"alt_text\":\"Our Black Friday video\",\"autoplay_muted\":true}")
ok "video with cover and captions" "$VC"
AC=$(cre $BF '{"placement":"announcement","format":"text","headline":"Black Friday: up to 40% off everything"}')
ok "announcement bar" "$AC"
has "text creative needs a message" "$(cre $BF '{"placement":"announcement","format":"text"}')" "needs its message"
has "autoplay only for videos" "$(cre $BF "{\"placement\":\"card\",\"format\":\"card_4x5\",\"media_id\":\"$CARD\",\"alt_text\":\"x\",\"autoplay_muted\":true}")" "Only videos"
has "another shop's media refused" "$(sql "select 1" >/dev/null; as stranger "select marketing_creative_save('$BF', '{}')")" "does not allow"
eq "six creatives under one campaign" "$(sql "select count(*) from marketing_creatives where campaign_id='$BF'")" "6"

echo "--- preview link"
L=$(first "$(as mgr "select marketing_preview_link('$BF')")")
SEC=$(python3 -c 'import json,sys;print(json.loads(sys.argv[1])["secret"])' "$L" 2>/dev/null)
has "manager gets a preview link" "$L" '"slug": "mainshop"'
has "cashier cannot" "$(as cash "select marketing_preview_link('$BF')")" "does not allow"
eq "draft shows in the preview" "$(sql "SET role anon; select get_preview_campaigns('mainshop', '$SEC')->'campaigns'->0->>'name'")" "Black Friday"
eq "preview is flagged" "$(sql "SET role anon; select get_preview_campaigns('mainshop', '$SEC')->>'preview'")" "$BF"
eq "wrong secret: nothing" "$(sql "SET role anon; select get_preview_campaigns('mainshop', repeat('a', 48))")" ""
eq "secret on another shop's address: nothing" "$(sql "SET role anon; select get_preview_campaigns('othershop', '$SEC')")" ""
eq "secret stored only as a hash" "$(sql "select count(*) from marketing_preview_links where encode(secret_hash, 'hex') = '$SEC'")" "0"

echo "--- nothing public before publishing"
eq "draft not on the website" "$(pub mainshop "->'campaigns'->>0")" ""
eq "publish" "$(act $BF publish)" "active"
eq "published campaign on the website" "$(pub mainshop "->'campaigns'->0->>'name'")" "Black Friday"
eq "all six creatives sent" "$(pub mainshop "->'campaigns'->0->'creatives'" | python3 -c 'import json,sys;print(len(json.load(sys.stdin)))')" "6"
has "phone picture sent" "$(pub mainshop "->'campaigns'->0->'creatives'->0->'mobile'->>'url'")" "card.webp"
has "description falls back to the library" "$(pub mainshop "->'campaigns'->0->'creatives'->0->>'alt'")" "Black Friday banner"
has "captions sent" "$(pub mainshop "->'campaigns'->0->'creatives'")" "subs.vtt"
eq "refreshAt = the end" "$(pub mainshop "->>'refreshAt'" | cut -c1-16)" "$(sql "select to_char(ends_at at time zone current_setting('TimeZone'), 'YYYY-MM-DD\"T\"HH24:MI') from marketing_campaigns where id='$BF'" | cut -c1-16)"
eq "other shop sees none of it" "$(pub othershop "->'campaigns'")" "[]"
eq "unknown shop: nothing" "$(pub nosuchshop "")" ""

echo "--- scheduling"
XM=$(save $B1 "{\"name\":\"Christmas\",\"campaign_type\":\"christmas\",\"starts_local\":\"$FUT_LOCAL\",\"priority\":90}")
cre $XM "{\"placement\":\"hero\",\"format\":\"hero_16x9\",\"media_id\":\"$HERO\"}" >/dev/null
eq "future campaign is scheduled" "$(act $XM publish)" "scheduled"
eq "scheduled campaign not shown yet" "$(pub mainshop "->'campaigns'" | grep -c Christmas)" "0"
eq "refreshAt = its start (sooner than Black Friday's end)" "$(pub mainshop "->>'refreshAt'" | cut -c1-10)" "$(sql "select (starts_at at time zone current_setting('TimeZone'))::date from marketing_campaigns where id='$XM'")"
sql "update marketing_campaigns set starts_at = now() - interval '1 minute' where id='$XM'" >/dev/null
eq "once its start passes it shows (no job needed)" "$(pub mainshop "->'campaigns'->0->>'name'")" "Christmas"
eq "higher priority first" "$(pub mainshop "->'campaigns'->1->>'name'")" "Black Friday"
sql "update marketing_campaigns set ends_at = now() - interval '1 second', starts_at = now() - interval '2 days' where id='$XM'" >/dev/null
eq "expired campaign disappears at once" "$(pub mainshop "->'campaigns'" | grep -c Christmas)" "0"
eq "expired shows as completed" "$(sql "select fn_mkt_status(state, starts_at, ends_at) from marketing_campaigns where id='$XM'")" "completed"
J=$(sql "select run_marketing_jobs()")
has "job logs the finish" "$J" '"finished": 1'
has "job logs the start" "$J" '"started": 1'
eq "job is idempotent" "$(sql "select run_marketing_jobs()->>'finished'")" "0"
eq "history has published + finished" "$(sql "select string_agg(event, ',' order by id) from marketing_campaign_events where campaign_id='$XM' and event in ('published','finished')")" "published,finished"

echo "--- pause, resume, end, archive"
eq "pause" "$(act $BF pause)" "paused"
eq "paused campaign not shown" "$(pub mainshop "->'campaigns'")" "[]"
has "cashier cannot resume" "$(act $BF resume cash)" "does not allow"
eq "resume" "$(act $BF resume)" "active"
eq "shown again" "$(pub mainshop "->'campaigns'->0->>'name'")" "Black Friday"
has "cannot archive a running campaign" "$(act $BF archive)" "End the campaign"
D=$(first "$(as owner "select marketing_campaign_duplicate('$BF')")")
ok "duplicate" "$D"
eq "copy is a draft with the same creatives" "$(sql "select state || ':' || (select count(*) from marketing_creatives where campaign_id='$D') from marketing_campaigns where id='$D'")" "draft:6"
eq "copy has no page address (unique)" "$(sql "select coalesce(landing_slug,'-') from marketing_campaigns where id='$D'")" "-"

echo "--- placements"
has "two pop-ups at once refused" "$(as owner "select marketing_placement_save('$B1', 'popup', '{\"max_items\":2}')")" "one pop-up"
ok "cards limited to two" "$(as owner "select marketing_placement_save('$B1', 'card', '{\"max_items\":2,\"rotation\":\"rotate\"}')")"
eq "public settings carry it" "$(pub mainshop "->'placements'->'card'->>'maxItems'")" "2"
has "cashier may not change placements" "$(as cash "select marketing_placement_save('$B1', 'card', '{}')")" "does not allow"
P1C=$(save $B1 "{\"name\":\"Popup A\",\"starts_local\":\"$NOW_LOCAL\",\"priority\":60}")
cre $P1C '{"placement":"popup","format":"text","headline":"Join our list"}' >/dev/null
act $P1C publish >/dev/null
P2C=$(save $B1 "{\"name\":\"Popup B\",\"starts_local\":\"$NOW_LOCAL\",\"priority\":60}")
cre $P2C '{"placement":"popup","format":"text","headline":"Free delivery"}' >/dev/null
has "pop-up clash at the same priority refused" "$(act $P2C publish)" "same priority"
as owner "select marketing_campaign_save('$B1', '{\"id\":\"$P2C\",\"name\":\"Popup B\",\"starts_local\":\"$NOW_LOCAL\",\"priority\":61}'::jsonb)" >/dev/null
eq "different priority allowed" "$(act $P2C publish)" "active"

echo "--- statistics"
EV="[{\"c\":\"$C1\",\"k\":\"load\"},{\"c\":\"$C1\",\"k\":\"load\"},{\"c\":\"$C1\",\"k\":\"view\"},{\"c\":\"$C1\",\"k\":\"click\"}]"
eq "events counted once per visit" "$(sql "SET role anon; select track_ad_events('mainshop', '$VISIT', '$EV')")" "3"
eq "repeat batch counts nothing" "$(sql "SET role anon; select track_ad_events('mainshop', '$VISIT', '$EV')")" "0"
eq "another visit counts" "$(sql "SET role anon; select track_ad_events('mainshop', '$VISIT2', '[{\"c\":\"$C1\",\"k\":\"load\"}]')")" "1"
eq "creative of another shop ignored" "$(sql "SET role anon; select track_ad_events('othershop', '$VISIT', '[{\"c\":\"$C2\",\"k\":\"load\"}]')")" "0"
eq "bad visit id ignored" "$(sql "SET role anon; select track_ad_events('mainshop', 'x', '$EV')")" "0"
eq "draft creative ignored" "$(sql "SET role anon; select track_ad_events('mainshop', '$VISIT', '[{\"c\":\"$(sql "select id from marketing_creatives where campaign_id='$D' limit 1")\",\"k\":\"load\"}]')")" "0"
eq "daily row: 2 loads, 1 view, 1 click" "$(sql "select loads||','||views||','||clicks from marketing_ad_daily where creative_id='$C1'")" "2,1,1"
eq "visitors cannot read statistics" "$(sql "SET role anon; select count(*) from marketing_ad_daily" 2>&1 | grep -c denied)" "1"
eq "stranger reads none of this shop's statistics" "$(as stranger "select count(*) from marketing_ad_daily")" "0"

echo "--- conversions"
ORDER=$(sql "insert into online_orders (order_number, business_id, account_id, customer_name, customer_phone, status, fulfilment, subtotal, total)
  values (9001, '$B1', '${UID_OF[shopper]}', 'Shopper', '0711999999', 'paid', 'pickup', 1500, 1500) returning id")
OTHER=$(sql "insert into online_orders (order_number, business_id, account_id, customer_name, customer_phone, status, fulfilment, subtotal, total)
  values (9002, '$B1', null, 'Someone', '0711888888', 'paid', 'pickup', 900, 900) returning id")
eq "someone else's order is not counted" "$(as shopper "select track_ad_conversion('mainshop', '$VISIT', '$OTHER')")" "f"
eq "visit without a click is not counted" "$(as shopper "select track_ad_conversion('mainshop', '$VISIT2', '$ORDER')")" "f"
eq "own order after a click is counted" "$(as shopper "select track_ad_conversion('mainshop', '$VISIT', '$ORDER')")" "t"
eq "only once" "$(as shopper "select track_ad_conversion('mainshop', '$VISIT', '$ORDER')")" "f"
eq "anonymous caller cannot report orders" "$(sql "SET role anon; select track_ad_conversion('mainshop', '$VISIT', '$ORDER')" 2>&1 | grep -c denied)" "1"
R=$(as mgr "select marketing_campaign_report('$BF')")
has "report: order value read from the order" "$R" '"value": 1500'
has "report: conversion on the clicked card" "$R" '"conversions": 1'
O=$(as mgr "select marketing_overview('$B1', 30)")
has "overview totals" "$O" '"clicks": 1'
has "overview counts by status" "$O" '"active"'
has "cashier cannot read reports" "$(as cash "select marketing_overview('$B1', 30)")" "does not allow"
has "stranger cannot read this shop's report" "$(as stranger "select marketing_campaign_report('$BF')")" "does not allow"

echo "--- removing"
has "media in use cannot be removed" "$(as owner "select website_media_remove('$CARD')")" "still uses"
U=$(as owner "select website_media_remove('$SMALL')")
eq "unused media removed; file path returned for deletion" "$U" "$B1/small.webp"
as owner "select marketing_creative_remove('$C1')" >/dev/null
eq "creative with statistics is hidden, not deleted" "$(sql "select hidden from marketing_creatives where id='$C1'")" "t"
eq "hidden creative no longer public" "$(pub mainshop "" | grep -c "$C1")" "0"
eq "end" "$(act $BF end)" "completed"
eq "ended campaign not public" "$(pub mainshop "->'campaigns'" | grep -c 'Black Friday')" "0"
eq "archive" "$(act $BF archive)" "archived"
has "archived campaign cannot be edited" "$(cre $BF '{"placement":"announcement","format":"text","headline":"x"}')" "Restore"
eq "statistics kept after archiving" "$(sql "select sum(views) from marketing_ad_daily where campaign_id='$BF'")" "1"
eq "history recorded every step" "$(sql "select count(distinct event) from marketing_campaign_events where campaign_id='$BF'")" "9"

echo "--- plan"
sql "update tenant_subscriptions set plan_code='pro' where tenant_id=(select tenant_id from businesses where id='$B1')" >/dev/null
eq "website closed by plan: no adverts" "$(pub mainshop "")" ""
has "and no marketing changes" "$(save $B1 "{\"name\":\"Z\",\"starts_local\":\"$NOW_LOCAL\"}")" "does not allow"
sql "update tenant_subscriptions set plan_code='pro_plus' where tenant_id=(select tenant_id from businesses where id='$B1')" >/dev/null

echo
echo "marketing: $PASS passed, $FAIL failed"
[ $FAIL -eq 0 ]
