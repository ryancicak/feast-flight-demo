#!/usr/bin/env bash
# Launch the demo: refresh Lakebase creds, start Feast's registry UI, and serve
# the dashboard (FastAPI API + the built React app). Ctrl-C stops everything.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$HERE"
source .venv/bin/activate

python scripts/lakebase.py render   # fresh Lakebase host+token into feature_store.yaml

if [ ! -d app/web/dist ]; then
  echo "NOTE: app/web/dist not found — the API will run but the UI won't be served."
  echo "      Build the UI once with:  (cd app/web && npm install && npm run build)"
fi

cleanup() { kill "$(jobs -p)" 2>/dev/null || true; }
trap cleanup EXIT

feast -c feature_repo ui --port 8888 >/tmp/feast_ui.log 2>&1 &

echo
echo "  Feast registry UI  ->  http://localhost:8888   (entities, feature views, lineage)"
echo "  Dashboard          ->  http://localhost:8000   (deck.gl UI + JSON API at /api, /docs)"
echo

cd app
exec ../.venv/bin/uvicorn server:app --host 0.0.0.0 --port 8000
