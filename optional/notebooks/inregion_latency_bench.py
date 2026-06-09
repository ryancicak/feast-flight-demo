# Databricks notebook source
# MAGIC %md
# MAGIC # In-region Lakebase online-serving latency benchmark
# MAGIC
# MAGIC Runs the **exact** `store.get_online_features()` call the app's `data.score()`
# MAGIC makes, but from compute co-located with Lakebase (us-west-2). Reports warm
# MAGIC latency distribution. This is the validation metric for the app.

# COMMAND ----------

# MAGIC %pip install "feast[postgres]==0.63.0" "psycopg[binary]>=3.2" "databricks-sdk>=0.30" pandas pyarrow
# MAGIC %restart_python

# COMMAND ----------

import os, shutil, time, uuid, statistics, socket
import pandas as pd

SRC = "/Workspace/Users/ryan.cicak@databricks.com/feast-flight-bench/feature_repo"
REPO = "/tmp/feature_repo"
ENDPOINT_NAME = "projects/feast-flight-demo/branches/production/endpoints/primary"
SERVICE = "flight_delay_v1"

# Copy the feature repo to local driver storage (Feast wants a writable dir).
if os.path.exists(REPO):
    shutil.rmtree(REPO)
shutil.copytree(SRC, REPO)
print("copied feature_repo ->", REPO)
print("files:", sorted(os.listdir(os.path.join(REPO, "data"))))

# COMMAND ----------

# Mint a fresh Lakebase token with the running identity (ryan.cicak, who owns the DB),
# in-region, then render feature_store.yaml exactly like the app does.
from databricks.sdk import WorkspaceClient

w = WorkspaceClient()
host = None
eps = w.postgres.list_endpoints("projects/feast-flight-demo/branches/production")
for ep in eps:
    host = ep.status.hosts.host
cred = w.postgres.generate_database_credential(endpoint=ENDPOINT_NAME)
token = cred.token
user = "ryan.cicak@databricks.com"
print("host:", host, "token len:", len(token))

with open(os.path.join(REPO, "feature_store.yaml.template")) as f:
    cfg = f.read()
cfg = cfg.replace("__LAKEBASE_HOST__", host).replace("__LAKEBASE_TOKEN__", token)
with open(os.path.join(REPO, "feature_store.yaml"), "w") as f:
    f.write(cfg)
print(cfg)

# COMMAND ----------

# Where is this driver? Confirm region co-location.
import urllib.request
try:
    tok = urllib.request.urlopen(urllib.request.Request(
        "http://169.254.169.254/latest/api/token",
        headers={"X-aws-ec2-metadata-token-ttl-seconds": "60"}, method="PUT"), timeout=2).read().decode()
    az = urllib.request.urlopen(urllib.request.Request(
        "http://169.254.169.254/latest/meta-data/placement/availability-zone",
        headers={"X-aws-ec2-metadata-token": tok}), timeout=2).read().decode()
    print("driver AZ:", az)
except Exception as e:
    print("AZ probe failed (non-fatal):", e)
print("hostname:", socket.gethostname())

# COMMAND ----------

from feast import FeatureStore
store = FeatureStore(repo_path=REPO)
fs = store.get_feature_service(SERVICE)

def one_read():
    rows = [{"airport_id": "ORD", "carrier_id": "AA", "route_id": "ORD-LAX", "flight_year": 2007}]
    t0 = time.perf_counter()
    feats = store.get_online_features(features=fs, entity_rows=rows).to_dict()
    return (time.perf_counter() - t0) * 1000.0, feats

# Warm up (first call pays connection + import costs)
warm_ms, feats = one_read()
print("cold/first read ms:", round(warm_ms, 1))
print("sample features:", {k: (v[0] if v else None) for k, v in list(feats.items())[:6]})

# COMMAND ----------

# Warm measurements — same single-entity read as data.score()
N = 30
samples = []
for i in range(N):
    ms, _ = one_read()
    samples.append(ms)
samples_sorted = sorted(samples)
print("warm get_online_features() latency over", N, "reads (ms):")
print("  raw:   ", [round(x, 1) for x in samples])
print("  min:   ", round(min(samples), 2))
print("  median:", round(statistics.median(samples), 2))
print("  p95:   ", round(samples_sorted[int(0.95 * (N - 1))], 2))
print("  max:   ", round(max(samples), 2))
print("  mean:  ", round(statistics.mean(samples), 2))

# COMMAND ----------

# Also time a raw psycopg point-lookup to isolate Feast overhead vs. pure DB round-trip.
import psycopg
conn = psycopg.connect(host=host, port=5432, dbname="feast", user=user,
                       password=token, sslmode="require")
cur = conn.cursor()
# warm
cur.execute("SELECT 1"); cur.fetchone()
raw = []
for i in range(30):
    t0 = time.perf_counter()
    cur.execute("SELECT 1"); cur.fetchone()
    raw.append((time.perf_counter() - t0) * 1000.0)
print("raw SELECT 1 round-trip (pooled conn) ms  min/median:",
      round(min(raw), 3), "/", round(statistics.median(raw), 3))

# A real single-row keyed lookup against one online table
cur.execute("SELECT * FROM information_schema.columns WHERE table_name='flight_demo_carrier_stats' LIMIT 1")
cur.fetchone()
keyed = []
for i in range(30):
    t0 = time.perf_counter()
    cur.execute('SELECT * FROM flight_demo_carrier_stats LIMIT 1'); cur.fetchone()
    keyed.append((time.perf_counter() - t0) * 1000.0)
print("raw single-row table read (pooled conn) ms  min/median:",
      round(min(keyed), 3), "/", round(statistics.median(keyed), 3))
conn.close()

# COMMAND ----------

print("=== SUMMARY ===")
print(f"In-region (us-west-2) warm get_online_features(): "
      f"min={round(min(samples),2)}ms median={round(statistics.median(samples),2)}ms "
      f"p95={round(samples_sorted[int(0.95*(N-1))],2)}ms")
print(f"Raw pooled DB round-trip (SELECT 1): "
      f"min={round(min(raw),3)}ms median={round(statistics.median(raw),3)}ms")
print(f"Raw pooled single-row table read: "
      f"min={round(min(keyed),3)}ms median={round(statistics.median(keyed),3)}ms")
