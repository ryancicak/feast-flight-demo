#!/usr/bin/env bash
# Warm the deployed flight-ops agent so the first read is hot, not a cold start.
# Point this at YOUR deployment:
#   export APP_URL="https://<your-app>.aws.databricksapps.com"
#   export DATABRICKS_PROFILE="<your-profile>"
#   bash video/warmup.sh
set -euo pipefail
: "${APP_URL:?set APP_URL to your deployed app, e.g. https://<your-app>.aws.databricksapps.com}"
: "${DATABRICKS_PROFILE:=DEFAULT}"

TOK=$(databricks auth token -p "$DATABRICKS_PROFILE" | python3 -c "import sys,json;print(json.load(sys.stdin)['access_token'])")
curl -sS -X POST "$APP_URL/api/agent" \
  -H "Authorization: Bearer $TOK" \
  -H "Origin: $APP_URL" \
  -H "Content-Type: application/json" \
  -d '{"message":"warm up"}' >/dev/null && echo "warmed - ready"
