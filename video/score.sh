#!/usr/bin/env bash
# Score one flight live from the Lakebase online store via the deployed agent.
# reads[].latency_ms is the in-region online-read latency (single-digit ms in-region).
#   export APP_URL="https://<your-app>.aws.databricksapps.com"
#   export DATABRICKS_PROFILE="<your-profile>"
#   bash video/score.sh                                  # default question
#   bash video/score.sh "Score DL from ATL to JFK 2005"  # your own question
set -euo pipefail
: "${APP_URL:?set APP_URL to your deployed app, e.g. https://<your-app>.aws.databricksapps.com}"
: "${DATABRICKS_PROFILE:=DEFAULT}"
MSG="${1:-Score AA from ORD to LAX in 2007 and explain the risk.}"

TOK=$(databricks auth token -p "$DATABRICKS_PROFILE" | python3 -c "import sys,json;print(json.load(sys.stdin)['access_token'])")
PAYLOAD=$(python3 -c "import json,sys;print(json.dumps({'message':sys.argv[1]}))" "$MSG")
curl -sS -X POST "$APP_URL/api/agent" \
  -H "Authorization: Bearer $TOK" \
  -H "Origin: $APP_URL" \
  -H "Content-Type: application/json" \
  -d "$PAYLOAD" | python3 -m json.tool
