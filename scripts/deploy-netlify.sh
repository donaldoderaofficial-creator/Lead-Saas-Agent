#!/usr/bin/env bash
set -euo pipefail

DIR="${1:-public}"
SITE_ID="${NETLIFY_SITE_ID:-}"
TOKEN="${NETLIFY_AUTH_TOKEN:-}"

if [[ -z "$SITE_ID" || -z "$TOKEN" ]]; then
  echo "Missing NETLIFY_SITE_ID or NETLIFY_AUTH_TOKEN. Set both in your environment before deploying."
  echo "Example:"
  echo "  export NETLIFY_SITE_ID=your_site_id"
  echo "  export NETLIFY_AUTH_TOKEN=your_token"
  echo "  npm run deploy"
  exit 1
fi

if [[ ! -d "$DIR" ]]; then
  echo "Directory not found: $DIR"
  exit 1
fi

npx netlify deploy --prod --dir="$DIR" --site="$SITE_ID" --auth="$TOKEN"
