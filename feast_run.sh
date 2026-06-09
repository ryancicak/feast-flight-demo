#!/usr/bin/env bash
# Wrapper: refresh Lakebase creds into feature_store.yaml, then run feast.
# Usage: ./feast_run.sh apply   |   ./feast_run.sh materialize-incremental <END>   etc.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$HERE/.venv/bin/activate"
python "$HERE/scripts/lakebase.py" render
cd "$HERE/feature_repo"
exec feast "$@"
