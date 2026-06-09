# Databricks notebook source
# MAGIC %md
# MAGIC # Feast on Databricks — read Unity Catalog *live* (Spark offline store)
# MAGIC
# MAGIC This is the higher-fidelity variant of the local demo. Run it **inside a
# MAGIC Databricks notebook** on a UC-enabled cluster. Here Feast's `spark` offline
# MAGIC store binds to the notebook's native SparkSession (`getActiveSession()`), so
# MAGIC feature views read the Unity Catalog Delta tables **directly** — no parquet
# MAGIC sync. `feast materialize` then writes into the **Lakebase Postgres** online
# MAGIC store, exactly like the local path.
# MAGIC
# MAGIC Prereq: run `optional/build_features.py` (or the cells of the local demo) first
# MAGIC so `<your-catalog>.feast_flight_demo.{airport_origin_stats, carrier_stats,
# MAGIC route_stats, airport_weather_stats}` exist.
# MAGIC
# MAGIC > Why a separate file: locally, Feast 0.63's spark offline store can't run over
# MAGIC > Databricks Connect (a `df.rdd` call breaks on Spark Connect, and the matrix
# MAGIC > tops out at Python 3.12). On a cluster it's native Spark, so it just works.

# COMMAND ----------

# MAGIC %pip install "feast[spark,postgres]==0.63.0"
# dbutils.library.restartPython()

# COMMAND ----------

import os, textwrap

CATALOG, SCHEMA = "main", "feast_flight_demo"  # set to your UC catalog and schema
REPO = "/tmp/feast_repo"
os.makedirs(os.path.join(REPO, "data"), exist_ok=True)

# ---- feature_store.yaml: spark offline store + Lakebase Postgres online -----
# Fill host/password from your Lakebase endpoint + a fresh OAuth token. In the
# local repo, scripts/lakebase.py render does this from a template.
LAKEBASE_HOST = dbutils.secrets.get("lakebase", "host")      # or paste the endpoint host
LAKEBASE_TOKEN = dbutils.secrets.get("lakebase", "token")    # short-lived OAuth token

open(os.path.join(REPO, "feature_store.yaml"), "w").write(textwrap.dedent(f"""
    project: flight_demo
    provider: local
    registry: data/registry.db
    entity_key_serialization_version: 3
    offline_store:
      type: spark
      spark_conf:
        spark.sql.session.timeZone: UTC
    online_store:
      type: postgres
      host: {LAKEBASE_HOST}
      port: 5432
      database: feast
      db_schema: public
      user: {os.environ.get('DATABRICKS_USERNAME', 'you@org.com')}
      password: {LAKEBASE_TOKEN}
      sslmode: require
"""))

# COMMAND ----------

# ---- features.py: same entities/feature views, but SparkSource on UC Delta --
features_py = f'''
from datetime import timedelta
from feast import Entity, FeatureView, Field, FeatureService
from feast.types import Float32, Int64
from feast.infra.offline_stores.contrib.spark_offline_store.spark_source import SparkSource

TTL = timedelta(days=36500)
airport = Entity(name="airport", join_keys=["airport_id"])
carrier = Entity(name="carrier", join_keys=["carrier_id"])
route   = Entity(name="route",   join_keys=["route_id"])
year    = Entity(name="year",    join_keys=["flight_year"])

def src(tbl):
    return SparkSource(name=f"{{tbl}}_src",
                       table="{CATALOG}.{SCHEMA}." + tbl,
                       timestamp_field="event_timestamp")

airport_origin_stats = FeatureView(name="airport_origin_stats", entities=[airport, year], ttl=TTL,
    online=True, source=src("airport_origin_stats"), schema=[
        Field(name="origin_flights", dtype=Int64),
        Field(name="origin_avg_arr_delay", dtype=Float32),
        Field(name="origin_delay_rate_15", dtype=Float32),
        Field(name="origin_avg_distance", dtype=Float32),
        Field(name="origin_avg_elapsed_min", dtype=Float32)])
carrier_stats = FeatureView(name="carrier_stats", entities=[carrier, year], ttl=TTL,
    online=True, source=src("carrier_stats"), schema=[
        Field(name="carrier_flights", dtype=Int64),
        Field(name="carrier_avg_arr_delay", dtype=Float32),
        Field(name="carrier_delay_rate_15", dtype=Float32),
        Field(name="carrier_ontime_pct", dtype=Float32)])
route_stats = FeatureView(name="route_stats", entities=[route], ttl=TTL,
    online=True, source=src("route_stats"), schema=[
        Field(name="route_flights", dtype=Int64),
        Field(name="route_avg_arr_delay", dtype=Float32),
        Field(name="route_delay_rate_15", dtype=Float32),
        Field(name="route_distance", dtype=Float32)])
airport_weather_stats = FeatureView(name="airport_weather_stats", entities=[airport, year], ttl=TTL,
    online=True, source=src("airport_weather_stats"), schema=[
        Field(name="wx_avg_tmax_c", dtype=Float32), Field(name="wx_avg_tmin_c", dtype=Float32),
        Field(name="wx_total_precip_mm", dtype=Float32), Field(name="wx_precip_days", dtype=Int64),
        Field(name="wx_total_snow_mm", dtype=Float32), Field(name="wx_snow_days", dtype=Int64),
        Field(name="wx_avg_wind_ms", dtype=Float32), Field(name="wx_fog_days", dtype=Int64),
        Field(name="wx_thunder_days", dtype=Int64)])

flight_delay_v1 = FeatureService(name="flight_delay_v1",
    features=[airport_origin_stats, carrier_stats, route_stats, airport_weather_stats])
'''
open(os.path.join(REPO, "features.py"), "w").write(features_py)

# COMMAND ----------

# ---- apply + materialize: reads UC Delta via Spark, writes Lakebase Postgres -
import subprocess
print(subprocess.run(["feast", "apply"], cwd=REPO, capture_output=True, text=True).stdout)
print(subprocess.run(["feast", "materialize", "1989-01-01T00:00:00", "2010-01-01T00:00:00"],
                     cwd=REPO, capture_output=True, text=True).stdout)

# COMMAND ----------

# ---- serve online from Lakebase + point-in-time training off UC -------------
from feast import FeatureStore
import pandas as pd
store = FeatureStore(repo_path=REPO)

print(store.get_online_features(
    features=store.get_feature_service("flight_delay_v1"),
    entity_rows=[{"airport_id": "ORD", "carrier_id": "AA", "route_id": "ORD-LAX", "flight_year": 2007}],
).to_dict())

entity_df = pd.DataFrame({
    "airport_id": ["ORD", "DEN"], "carrier_id": ["AA", "UA"],
    "route_id": ["ORD-LAX", "DEN-SFO"], "flight_year": [1995, 2008],
    "event_timestamp": pd.to_datetime(["1997-06-15", "2010-02-10"])})
display(store.get_historical_features(
    entity_df=entity_df, features=store.get_feature_service("flight_delay_v1")).to_df())
