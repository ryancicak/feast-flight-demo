"""Lakebase (Postgres) helpers for the Feast flight demo — library + CLI.

Library: endpoint_host / oauth_token / connect / conn_params. Uses the Databricks
CLI to fetch the endpoint host and a short-lived OAuth token (tokens expire ~1h,
so we fetch fresh on each call) and connects with psycopg3.

CLI:
  python scripts/lakebase.py render        # inject fresh host+token into feature_store.yaml
  python scripts/lakebase.py setup-db      # create the `feast` database + grant access (one-time)
  python scripts/lakebase.py inspect [PROJ] # list databases + user tables in a Lakebase project
"""
import argparse
import json
import os
import subprocess
import psycopg
from psycopg import sql

PROFILE = os.environ.get("LAKEBASE_PROFILE", "feast-demo")
PROJECT = os.environ.get("LAKEBASE_PROJECT", "feast-flight-demo")  # Lakebase project backing the online store
DB = os.environ.get("LAKEBASE_DB", "feast")                        # database Feast writes online features into

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "feature_repo"))


def _cli(args):
    out = subprocess.run(
        ["databricks", *args, "-p", PROFILE, "-o", "json"],
        capture_output=True, text=True,
    )
    if out.returncode != 0:
        raise RuntimeError(f"CLI failed: {' '.join(args)}\n{out.stderr}")
    lines = [l for l in out.stdout.splitlines() if not l.startswith("Warn")]
    return json.loads("\n".join(lines))


# The Postgres role to connect as. Whoever runs the demo owns the Lakebase
# project, so their identity (a user email, or a service principal's id) is the
# role. We read it from the CLI instead of hard-coding so a fresh clone works
# for anyone, on any profile.
def _whoami():
    return _cli(["current-user", "me"])["userName"]


USER = _whoami()


def endpoint_host(project=PROJECT, branch="production"):
    eps = _cli(["postgres", "list-endpoints", f"projects/{project}/branches/{branch}"])
    return eps[0]["status"]["hosts"]["host"]


def oauth_token(project=PROJECT, branch="production", endpoint="primary"):
    path = f"projects/{project}/branches/{branch}/endpoints/{endpoint}"
    return _cli(["postgres", "generate-database-credential", path])["token"]


def connect(project=PROJECT, dbname="postgres", branch="production", endpoint="primary", autocommit=False):
    host = endpoint_host(project, branch)
    token = oauth_token(project, branch, endpoint)
    return psycopg.connect(host=host, port=5432, dbname=dbname, user=USER,
                           password=token, sslmode="require", autocommit=autocommit)


def conn_params(project=PROJECT, dbname="postgres", branch="production", endpoint="primary"):
    """Return (host, token, user) for building libpq/SQLAlchemy URLs."""
    return endpoint_host(project, branch), oauth_token(project, branch, endpoint), USER


# ───────────────────────────── CLI subcommands ─────────────────────────────
def render():
    """Inject a fresh Lakebase host + token into feature_store.yaml.

    Lakebase OAuth tokens expire ~hourly, so we regenerate before each run. This
    is also the demo's punchline: pointing Feast's online store at Lakebase is a
    config swap, nothing more.
    """
    template = os.path.join(REPO, "feature_store.yaml.template")
    out = os.path.join(REPO, "feature_store.yaml")
    host, token = endpoint_host(), oauth_token()
    with open(template) as f:
        cfg = f.read()
    cfg = (cfg.replace("__LAKEBASE_HOST__", host)
              .replace("__LAKEBASE_TOKEN__", token)
              .replace("__LAKEBASE_USER__", USER))
    with open(out, "w") as f:
        f.write(cfg)
    os.chmod(out, 0o600)  # the rendered file holds a live OAuth token
    print(f"rendered {out}\n  host={host}\n  user={USER}\n  token=<{len(token)} chars, fresh>")


def setup_db():
    """Create the `feast` database in Lakebase and confirm full access (one-time)."""
    admin = connect(PROJECT, "postgres", autocommit=True)
    cur = admin.cursor()
    cur.execute("SELECT 1 FROM pg_database WHERE datname=%s", (DB,))
    if cur.fetchone():
        print(f"database '{DB}' already exists")
    else:
        # Identifiers are operator/identity-derived, not request input, but we
        # still quote them via psycopg.sql rather than f-string interpolation.
        cur.execute(sql.SQL("CREATE DATABASE {}").format(sql.Identifier(DB)))
        print(f"created database '{DB}'")
    admin.close()

    c = connect(PROJECT, DB, autocommit=True)
    cc = c.cursor()
    cc.execute("SELECT current_user, current_database()")
    who, db = cc.fetchone()
    print(f"connected as {who} to {db}")
    u, d = sql.Identifier(USER), sql.Identifier(DB)
    cc.execute(sql.SQL("GRANT ALL PRIVILEGES ON DATABASE {} TO {}").format(d, u))
    cc.execute(sql.SQL("GRANT ALL ON SCHEMA public TO {}").format(u))
    cc.execute(sql.SQL("ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO {}").format(u))
    cc.execute(sql.SQL("ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO {}").format(u))
    cc.execute("CREATE TABLE IF NOT EXISTS _access_check (id int)")
    cc.execute("DROP TABLE _access_check")
    print("verified: can CREATE/DROP in feast.public  ->  full access OK")
    c.close()


def inspect(project=PROFILE):
    """List databases + user tables in a Lakebase project."""
    host, token, user = conn_params(project)
    print(f"project={project} host={host}")
    conn = connect(project, "postgres")
    cur = conn.cursor()
    cur.execute("SELECT datname FROM pg_database WHERE datistemplate=false ORDER BY datname;")
    dbs = [r[0] for r in cur.fetchall()]
    print("databases:", dbs)
    conn.close()
    for db in dbs:
        try:
            c = psycopg.connect(host=host, port=5432, dbname=db, user=user,
                                password=token, sslmode="require")
            cc = c.cursor()
            cc.execute("""SELECT schemaname, tablename FROM pg_tables
                          WHERE schemaname NOT IN ('pg_catalog','information_schema')
                          ORDER BY 1,2;""")
            rows = cc.fetchall()
            print(f"[{db}] {len(rows)} user tables: {rows[:30]}")
            c.close()
        except Exception as e:
            print(f"[{db}] could not inspect: {e}")


if __name__ == "__main__":
    p = argparse.ArgumentParser(description="Lakebase helpers for the Feast flight demo")
    sub = p.add_subparsers(dest="cmd", required=True)
    sub.add_parser("render", help="inject fresh host+token into feature_store.yaml")
    sub.add_parser("setup-db", help="create the `feast` database + grant access (one-time)")
    insp = sub.add_parser("inspect", help="list databases + user tables")
    insp.add_argument("project", nargs="?", default=PROFILE)
    args = p.parse_args()
    if args.cmd == "render":
        render()
    elif args.cmd == "setup-db":
        setup_db()
    elif args.cmd == "inspect":
        inspect(args.project)
