#!/usr/bin/env bash
# Deploy the approver Worker + set its secrets.
# Prereqs (one time):  cd approver && npx wrangler login
# Usage:
#   GH_TOKEN=<github PAT, PRs:write on principe-feed> \
#   APPROVE_HMAC_SECRET=<same value as the GH Actions secret> \
#   ./deploy.sh
set -euo pipefail
cd "$(dirname "$0")"

: "${GH_TOKEN:?set GH_TOKEN (GitHub fine-grained PAT, Pull requests: write on principe-feed)}"
: "${APPROVE_HMAC_SECRET:?set APPROVE_HMAC_SECRET (must equal the GitHub Actions secret of the same name)}"

printf '%s' "$GH_TOKEN"            | npx wrangler secret put GH_TOKEN
printf '%s' "$APPROVE_HMAC_SECRET" | npx wrangler secret put APPROVE_HMAC_SECRET
npx wrangler deploy

echo
echo "Deployed. Copy the workers.dev URL above, then set it on the repo:"
echo "  gh secret set APPROVER_URL --repo omergrossman/principe-feed --body 'https://principe-feed-approver.<your-subdomain>.workers.dev'"
