#!/usr/bin/env bash
# Puts the customer website live on Vercel, in its own project (kaykays-website), separate
# from the staff app ("isms"). Run: npm run website:deploy
# Vercel builds it the same way as on a push to main: npm run website:build, serving
# website/dist, with the VITE_* variables set on that Vercel project.
set -euo pipefail
cd "$(dirname "$0")/.."

VERCEL="npx --yes vercel@latest"

# Not logged in on this machine yet: log in first (opens the browser once)
if ! $VERCEL whoami >/dev/null 2>&1; then
  echo "Log in to Vercel to publish the website (only needed once on this machine)."
  $VERCEL login
fi

# Which Vercel project is the website. Kept in website/.vercel so the repo root stays
# unlinked and can never deploy over the staff app by accident.
LINK=website/.vercel/project.json
if [ ! -f "$LINK" ]; then
  (mkdir -p website/.vercel-tmp && cd website/.vercel-tmp && $VERCEL link --yes --project "${WEBSITE_VERCEL_PROJECT:-kaykays-website}" >/dev/null)
  mkdir -p website/.vercel && cp website/.vercel-tmp/.vercel/project.json "$LINK"
  rm -rf website/.vercel-tmp
fi
export VERCEL_PROJECT_ID=$(node -p "require('./$LINK').projectId")
export VERCEL_ORG_ID=$(node -p "require('./$LINK').orgId")

# Quick local check first, so a broken build fails here and not on Vercel
npm run website:lint

$VERCEL deploy --prod --yes
