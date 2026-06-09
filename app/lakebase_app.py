"""Dual-mode Lakebase auth + feature_store.yaml rendering for the Feast online store.

Feast reads the online-store host + password from feature_store.yaml at
FeatureStore() init, and Lakebase OAuth tokens expire ~1h. So we render the
yaml with a freshly minted token and re-render + recreate the FeatureStore
before the token expires.

Two modes (detected at import):

  * Databricks App  (DATABRICKS_APP_NAME / DATABRICKS_APP_PORT set):
      - mint the token with the APP's own service principal:
            WorkspaceClient().postgres.generate_database_credential(endpoint=ENDPOINT_NAME)
      - host from the attached DB resource's PGHOST (fallback: SDK endpoint lookup)
      - Postgres user = the app SP's role = PGUSER injected by the DB resource

  * Local dev:
      - reuse scripts/lakebase.py (feast-demo CLI profile) exactly as before,
        so `python scripts/lakebase.py render` and local uvicorn keep working.

Nothing here touches feature definitions or the React app.
"""
import os
import uuid

# Apps inject DATABRICKS_APP_NAME; DATABRICKS_APP_PORT is also present at runtime.
IS_APP = bool(os.environ.get("DATABRICKS_APP_NAME") or os.environ.get("DATABRICKS_APP_PORT"))

# The Lakebase endpoint path the SDK/CLI use to mint a credential.
ENDPOINT_NAME = os.environ.get(
    "ENDPOINT_NAME",
    "projects/feast-flight-demo/branches/production/endpoints/primary",
)

_REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "feature_repo"))
_TEMPLATE = os.path.join(_REPO, "feature_store.yaml.template")
_OUT = os.path.join(_REPO, "feature_store.yaml")


def _app_credentials():
    """(host, token, user) for the App, minted with the app's service principal.

    Uses the SDK's low-level REST client (``WorkspaceClient().api_client.do``)
    rather than ``w.postgres.*``: the autoscaling-Postgres (``postgres``) API
    surface is only present on newer databricks-sdk builds, and the Databricks
    Apps base image preinstalls an SDK that predates it (so ``w.postgres`` raises
    AttributeError). ``api_client.do`` exists in every SDK version and carries
    the app SP's OAuth automatically. The two routes below are exactly what the
    CLI (`databricks postgres list-endpoints` / `generate-database-credential`)
    calls.
    """
    from databricks.sdk import WorkspaceClient

    w = WorkspaceClient()  # default auth inside Apps == the app SP
    ac = w.api_client

    # Host + Postgres user come from the attached Database resource if present.
    host = os.environ.get("PGHOST")
    user = os.environ.get("PGUSER")  # app SP's Postgres role (its client id)

    if not host:
        # Fallback: resolve the endpoint host over REST (same value as PGHOST).
        host = _endpoint_host_via_rest(ac)

    if not user:
        # Fallback: the SP client id is the Postgres role name.
        user = os.environ.get("DATABRICKS_CLIENT_ID") or w.config.client_id

    cred = ac.do("POST", "/api/2.0/postgres/credentials",
                 body={"endpoint": ENDPOINT_NAME})
    return host, cred["token"], user


def _endpoint_host_via_rest(ac):
    """Best-effort host lookup if PGHOST wasn't injected. Parses ENDPOINT_NAME."""
    # ENDPOINT_NAME = projects/<proj>/branches/<branch>/endpoints/<ep>
    parts = ENDPOINT_NAME.split("/")
    proj = parts[1]
    branch = parts[3] if len(parts) > 3 else "production"
    res = ac.do("GET", f"/api/2.0/postgres/projects/{proj}/branches/{branch}/endpoints")
    for ep in (res.get("endpoints") or []):
        host = ep.get("status", {}).get("hosts", {}).get("host")
        if host:
            return host
    raise RuntimeError("could not resolve Lakebase host from REST")


def _local_credentials():
    """(host, token, user) for local dev via scripts/lakebase.py (feast-demo profile)."""
    import sys

    sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
    from scripts import lakebase as lb

    host = lb.endpoint_host()
    token = lb.oauth_token()
    return host, token, lb.USER


def credentials():
    """Return (host, token, user) for the current mode."""
    return _app_credentials() if IS_APP else _local_credentials()


def render():
    """Render feature_store.yaml from template with fresh host/token/user.

    Returns the user that was written (useful for logging).
    """
    host, token, user = credentials()
    with open(_TEMPLATE) as f:
        cfg = f.read()
    # The template carries placeholders for all three connection values. The
    # Postgres role differs by mode: locally it is whoever runs the demo, in the
    # App it is the app's own service principal. credentials() returns the right
    # one, so a single substitution covers both.
    cfg = (cfg.replace("__LAKEBASE_HOST__", host)
              .replace("__LAKEBASE_TOKEN__", token)
              .replace("__LAKEBASE_USER__", user))
    with open(_OUT, "w") as f:
        f.write(cfg)
    os.chmod(_OUT, 0o600)  # the rendered file holds a live OAuth token
    return host, user
