#!/usr/bin/env bash
set -euo pipefail

DIR="${1:-public}"
FUNCTIONS_DIR="${2:-netlify/functions}"
SITE_ID="${NETLIFY_SITE_ID:-}"
TOKEN="${NETLIFY_AUTH_TOKEN:-}"

if [[ -z "$SITE_ID" || -z "$TOKEN" ]]; then
  echo "Missing NETLIFY_SITE_ID or NETLIFY_AUTH_TOKEN. Set both in your environment before deploying."
  echo "Example:"
  echo "  export NETLIFY_SITE_ID=your_site_id"
  echo "  export NETLIFY_AUTH_TOKEN=your_token"
  echo "  npm run deploy:netlify"
  exit 1
fi

if [[ ! -d "$DIR" ]]; then
  echo "Directory not found: $DIR"
  exit 1
fi

# --no-build: this repo publishes the static public/ folder as-is and has no
# build step. Without the flag the CLI runs the site's UI-configured build
# command, which fails the deploy.
npx netlify deploy --prod --no-build --dir="$DIR" --functions="$FUNCTIONS_DIR" --site="$SITE_ID" --auth="$TOKEN"
