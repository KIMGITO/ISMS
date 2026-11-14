#!/usr/bin/env bash
# Puts the staff web app or the customer website live on Cloudflare, blue-green.
#
#   bash scripts/deploy-web.sh app        # npm run app:deploy
#   bash scripts/deploy-web.sh website    # npm run website:deploy
#
#   1. Build, and check Cloudflare will take every file (scripts/prepare-cloudflare.mjs).
#   2. Note the version serving traffic now: blue.
#   3. Upload the new version without traffic: green. It gets its own preview URL.
#   4. Check green (scripts/smoke-test-web.mjs). Fails → stop; users never saw it.
#   5. Send 100% of traffic to green in one step (wrangler versions deploy). No gap.
#   6. Check the live address. Fails → send traffic back to blue at once.
#
# The very first deploy of a Worker has no blue, so it is a plain `wrangler deploy`.
#
# Logs in: locally `npx wrangler login` once; in CI CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID.
# Optional: APP_URL / WEBSITE_URL (live address to check; default the workers.dev one),
# SKIP_BUILD=1 (use what is already built), APP_VERSION (shown in About).
#
# Exit codes: 0 live · 1 failed before the switch (nothing changed) · 2 failed after the
# switch and rolled back to blue · 3 rollback failed too (act now).
# In GitHub Actions the steps' results also go to $GITHUB_OUTPUT.

set -uo pipefail
cd "$(dirname "$0")/.."

TARGET="${1:-}"
WRANGLER="npx --yes wrangler@4.156.0"
UUID='[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'

case "$TARGET" in
  app)     CONFIG=wrangler.jsonc;         DIR=dist;         LIVE="${APP_URL:-}";     PATHS=() ;;
  website) CONFIG=website/wrangler.jsonc; DIR=website/dist; LIVE="${WEBSITE_URL:-}"; PATHS=(--path /terms --path /privacy) ;;
  *) echo "Usage: $0 app|website"; exit 1 ;;
esac

output() { if [ -n "${GITHUB_OUTPUT:-}" ]; then echo "$1=$2" >> "$GITHUB_OUTPUT"; fi; }
fail() { echo "::error::$1"; exit "${2:-1}"; }
COMMIT=$(git rev-parse --short HEAD 2>/dev/null || echo local)
MESSAGE="${APP_VERSION:+v$APP_VERSION }$COMMIT $(git log -1 --format=%s 2>/dev/null | cut -c1-60)"

# ── 1. Build ────────────────────────────────────────────────────────────────
if [ -z "${SKIP_BUILD:-}" ]; then
  if [ "$TARGET" = app ]; then
    VITE_ORT_WASM_FROM_CDN=1 npm run build || fail "The web app did not build."
  else
    npm run website:lint && npm run website:build || fail "The website did not build."
  fi
fi
node scripts/prepare-cloudflare.mjs "$DIR" || fail "The build can't go on Cloudflare as it is."

# ── 2. Blue ────────────────────────────────────────────────────────────────
status=$($WRANGLER deployments status -c "$CONFIG" 2>&1)
status_code=$?
BLUE=""
if [ $status_code -eq 0 ]; then
  BLUE=$(grep -oE "\(100%\)[[:space:]]+$UUID" <<<"$status" | grep -oE "$UUID" | head -1 || true)
  echo "Blue (live now): ${BLUE:-traffic is split or unknown; a rollback would use the previous deployment}"
elif grep -qiE "10007|does not exist|not found" <<<"$status"; then
  echo "No Worker yet: first deploy, straight to live."
  out=$($WRANGLER deploy -c "$CONFIG" --message "$MESSAGE" 2>&1); code=$?
  echo "$out"
  [ $code -eq 0 ] || fail "The first deploy failed."
  live_url="${LIVE:-$(grep -oE 'https://[a-z0-9.-]+\.workers\.dev' <<<"$out" | head -1)}"
  output switched yes
  [ -n "$live_url" ] && { node scripts/smoke-test-web.mjs --url "$live_url" "${PATHS[@]}" || fail "First deploy is up but fails its check: $live_url"; }
  output live_url "$live_url"
  exit 0
else
  echo "$status"
  fail "Couldn't read the current deployment. Is Wrangler logged in (CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID)?"
fi
output blue "$BLUE"

# ── 3. Green ───────────────────────────────────────────────────────────────
upload=$($WRANGLER versions upload -c "$CONFIG" --tag "$COMMIT" --message "$MESSAGE" 2>&1); code=$?
echo "$upload"
[ $code -eq 0 ] || fail "Uploading the new version failed. Nothing changed for users."
GREEN=$(grep -iE "version id" <<<"$upload" | grep -oE "$UUID" | head -1)
PREVIEW=$(grep -oE 'https://[a-z0-9-]+\.[a-z0-9-]+\.workers\.dev' <<<"$upload" | head -1)
[ -n "$GREEN" ] || fail "Wrangler did not report the new version's id."
[ -n "$PREVIEW" ] || fail "No preview URL for the new version. Turn on workers.dev and preview URLs for the Worker (docs/HOSTING_CLOUDFLARE.md)."
output green "$GREEN"
output preview "$PREVIEW"
echo "Green: $GREEN at $PREVIEW"

# ── 4. Check green ─────────────────────────────────────────────────────────
node scripts/smoke-test-web.mjs --url "$PREVIEW" "${PATHS[@]}" \
  || fail "The new version failed its check on $PREVIEW. Nothing changed for users."

# ── 5. Switch ──────────────────────────────────────────────────────────────
$WRANGLER versions deploy "$GREEN@100%" -c "$CONFIG" -y --message "$MESSAGE" \
  || fail "Switching traffic failed. Users are still on the previous version."
output switched yes

# ── 6. Check live, roll back if needed ─────────────────────────────────────
# The preview host is <8 characters>-<worker>.<subdomain>.workers.dev; the live one drops the prefix.
LIVE_URL="${LIVE:-https://${PREVIEW#https://*-}}"
output live_url "$LIVE_URL"
sleep 10
if node scripts/smoke-test-web.mjs --url "$LIVE_URL" "${PATHS[@]}"; then
  echo "Live: $LIVE_URL now serves $GREEN."
  exit 0
fi

echo "::error::$LIVE_URL failed its check after the switch. Rolling back."
if [ -n "$BLUE" ]; then
  $WRANGLER versions deploy "$BLUE@100%" -c "$CONFIG" -y --message "Rollback: $MESSAGE failed its live check"
else
  $WRANGLER rollback -c "$CONFIG" -y --message "Rollback: $MESSAGE failed its live check"
fi
if [ $? -eq 0 ]; then
  output rolled_back yes
  fail "Rolled back to the previous version." 2
fi
output rolled_back failed
fail "Rollback FAILED. Run 'Roll back web' or roll back in the Cloudflare dashboard now." 3
