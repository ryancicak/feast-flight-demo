"""Build the offline feature tables ON DATABRICKS, as Unity Catalog Delta tables.

This replaces the local DuckDB build: the heavy aggregation of 118M flight rows
and 740M GHCN-Daily weather rows runs on the serverless SQL warehouse against the
governed lakehouse, not on a laptop. Feast then reads these UC Delta tables as its
offline store and materializes them into the Lakebase Postgres online store.

Inputs (already uploaded to the UC volume <your-catalog>.feast_flight_demo.raw):
  flights_1988_2008.parquet, weather_1988_2008.parquet (GHCN-Daily long format),
  ghcnd-stations.parquet, airports_openflights.dat (OpenFlights IATA->lat/lon).

Outputs (Delta tables in <your-catalog>.feast_flight_demo):
  flights                 raw flights (governed lakehouse table)
  airport_locations       IATA -> lat/lon/name/city (for the geo-join + the map UI)
  airport_origin_stats    per origin airport / year
  carrier_stats           per carrier / year
  route_stats             per route / lifetime
  airport_weather_stats   per origin airport / year (GHCN nearest-station climate)

Point-in-time convention is unchanged: a year-Y aggregate is stamped
event_timestamp = Jan 1 (Y+1).
"""
import os
from databricks import sql as dbsql
from databricks.sdk.core import Config

OUT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "feature_repo", "data"))

PROFILE = os.environ.get("LAKEBASE_PROFILE", "feast-demo")
WAREHOUSE_ID = os.environ.get("DATABRICKS_WAREHOUSE_ID", "")  # your serverless SQL warehouse id
CATALOG = os.environ.get("UC_CATALOG", "main")               # your Unity Catalog catalog
SCHEMA = os.environ.get("UC_SCHEMA", "feast_flight_demo")
FQ = f"{CATALOG}.{SCHEMA}"
VOL = f"/Volumes/{CATALOG}/{SCHEMA}/raw"
MAX_DIST_KM = 25.0

cfg = Config(profile=PROFILE)
conn = dbsql.connect(
    server_hostname=cfg.host.replace("https://", ""),
    http_path=f"/sql/1.0/warehouses/{WAREHOUSE_ID}",
    credentials_provider=lambda: cfg.authenticate,
)
cur = conn.cursor()


def run(label, statement, fetch=False):
    print(f"-- {label}", flush=True)
    cur.execute(statement)
    if fetch:
        rows = cur.fetchall()
        for r in rows:
            print("   ", r)
        return rows


# ---- raw flights (governed lakehouse table) --------------------------------
run("raw flights table", f"""
CREATE OR REPLACE TABLE {FQ}.flights AS
SELECT * FROM read_files('{VOL}/flights_1988_2008.parquet', format => 'parquet')
""")

# ---- airport locations from OpenFlights (IATA -> lat/lon) ------------------
# OpenFlights airports.dat: no header, comma-sep, quoted text. Cols (0-based):
# 0 id,1 name,2 city,3 country,4 IATA,5 ICAO,6 lat,7 lon,...
run("airport_locations table", f"""
CREATE OR REPLACE TABLE {FQ}.airport_locations AS
SELECT a._c4 AS airport_id, CAST(a._c6 AS DOUBLE) AS lat, CAST(a._c7 AS DOUBLE) AS lon,
       a._c1 AS name, a._c2 AS city
FROM read_files('{VOL}/airports_openflights.dat', format => 'csv', header => false) a
JOIN (SELECT DISTINCT Origin AS airport_id FROM {FQ}.flights WHERE Origin IS NOT NULL) o
  ON a._c4 = o.airport_id
WHERE length(a._c4) = 3 AND a._c4 <> '\\\\N'
""")

# ---- per-origin-airport / year delay stats ---------------------------------
run("airport_origin_stats table", f"""
CREATE OR REPLACE TABLE {FQ}.airport_origin_stats AS
SELECT Origin AS airport_id,
       CAST(yr AS BIGINT) AS flight_year,
       make_timestamp(yr + 1, 1, 1, 0, 0, 0) AS event_timestamp,
       COUNT(*)                                                 AS origin_flights,
       ROUND(AVG(ArrDelay), 2)                                  AS origin_avg_arr_delay,
       ROUND(AVG(CASE WHEN ArrDelay > 15 THEN 1 ELSE 0 END),4) AS origin_delay_rate_15,
       ROUND(AVG(Distance), 1)                                  AS origin_avg_distance,
       ROUND(AVG(CRSElapsedTime), 1)                            AS origin_avg_elapsed_min
FROM (SELECT Origin, year(Year_Month_DayofMonth) AS yr, ArrDelay, Distance, CRSElapsedTime
      FROM {FQ}.flights WHERE ArrDelay IS NOT NULL AND Origin IS NOT NULL
        AND year(Year_Month_DayofMonth) BETWEEN 1988 AND 2007)
GROUP BY Origin, yr
""")

# ---- per-carrier / year delay stats ----------------------------------------
run("carrier_stats table", f"""
CREATE OR REPLACE TABLE {FQ}.carrier_stats AS
SELECT UniqueCarrier AS carrier_id,
       CAST(yr AS BIGINT) AS flight_year,
       make_timestamp(yr + 1, 1, 1, 0, 0, 0) AS event_timestamp,
       COUNT(*)                                                 AS carrier_flights,
       ROUND(AVG(ArrDelay), 2)                                  AS carrier_avg_arr_delay,
       ROUND(AVG(CASE WHEN ArrDelay > 15 THEN 1 ELSE 0 END),4) AS carrier_delay_rate_15,
       ROUND(AVG(CASE WHEN ArrDelay <= 0 THEN 1 ELSE 0 END),4) AS carrier_ontime_pct
FROM (SELECT UniqueCarrier, year(Year_Month_DayofMonth) AS yr, ArrDelay
      FROM {FQ}.flights WHERE ArrDelay IS NOT NULL AND UniqueCarrier IS NOT NULL
        AND year(Year_Month_DayofMonth) BETWEEN 1988 AND 2007)
GROUP BY UniqueCarrier, yr
""")

# ---- per-route / lifetime stats --------------------------------------------
run("route_stats table", f"""
CREATE OR REPLACE TABLE {FQ}.route_stats AS
SELECT concat(Origin, '-', Dest) AS route_id,
       TIMESTAMP '1988-01-01'    AS event_timestamp,
       COUNT(*)                                                 AS route_flights,
       ROUND(AVG(ArrDelay), 2)                                  AS route_avg_arr_delay,
       ROUND(AVG(CASE WHEN ArrDelay > 15 THEN 1 ELSE 0 END),4) AS route_delay_rate_15,
       ROUND(AVG(Distance), 1)                                  AS route_distance
FROM {FQ}.flights
WHERE ArrDelay IS NOT NULL AND Origin IS NOT NULL AND Dest IS NOT NULL
  AND year(Year_Month_DayofMonth) BETWEEN 1988 AND 2007
GROUP BY concat(Origin, '-', Dest)
HAVING COUNT(*) >= 50
""")

# ---- carrier code -> airline name (reference dimension) --------------------
run("carrier_names table", f"""
CREATE OR REPLACE TABLE {FQ}.carrier_names AS
SELECT * FROM VALUES
  ('9E','Pinnacle Airlines'), ('AA','American Airlines'), ('AQ','Aloha Airlines'),
  ('AS','Alaska Airlines'), ('B6','JetBlue Airways'), ('CO','Continental Airlines'),
  ('DH','Independence Air'), ('DL','Delta Air Lines'), ('EA','Eastern Air Lines'),
  ('EV','Atlantic Southeast Airlines'), ('F9','Frontier Airlines'), ('FL','AirTran Airways'),
  ('HA','Hawaiian Airlines'), ('HP','America West Airlines'), ('ML (1)','Midway Airlines'),
  ('MQ','American Eagle (Envoy Air)'), ('NW','Northwest Airlines'), ('OH','Comair'),
  ('OO','SkyWest Airlines'), ('PA (1)','Pan American World Airways'), ('PI','Piedmont Airlines'),
  ('PS','Pacific Southwest Airlines'), ('TW','Trans World Airlines (TWA)'), ('TZ','ATA Airlines'),
  ('UA','United Airlines'), ('US','US Airways'), ('WN','Southwest Airlines'),
  ('XE','ExpressJet Airlines'), ('YV','Mesa Airlines')
  AS t(carrier_id, carrier_name)
""")

# ---- per-origin-airport / year weather climate (GHCN nearest station) ------
# Mirrors scripts/build_weather_features.py: nearest TMAX-reporting US station
# within 25km (with the GHCN longitude sign repair: lon <= -100 lost its minus),
# aggregated per year, GHCN tenths -> natural units, Q-FLAG-failed rows excluded.
# Guarded: the 2.5GB weather parquet may still be uploading — skip if absent.
try:
    run("airport_weather_stats table", f"""
CREATE OR REPLACE TABLE {FQ}.airport_weather_stats AS
WITH tmax_stations AS (
  SELECT DISTINCT ID FROM read_files('{VOL}/weather_1988_2008.parquet', format => 'parquet')
  WHERE ID LIKE 'US%' AND ELEMENT = 'TMAX'
),
us_stations AS (
  SELECT s.ID,
         s.LATITUDE AS lat,
         CASE WHEN s.LONGITUDE > 100 THEN -s.LONGITUDE ELSE s.LONGITUDE END AS lon
  FROM read_files('{VOL}/ghcnd-stations.parquet', format => 'parquet') s
  JOIN tmax_stations t ON s.ID = t.ID
  WHERE s.LATITUDE IS NOT NULL AND s.LONGITUDE IS NOT NULL
),
dist AS (
  SELECT a.airport_id, s.ID AS station_id,
         6371.0 * 2 * asin(sqrt(
           power(sin(radians(s.lat - a.lat) / 2), 2) +
           cos(radians(a.lat)) * cos(radians(s.lat)) * power(sin(radians(s.lon - a.lon) / 2), 2)
         )) AS dist_km
  FROM {FQ}.airport_locations a
  CROSS JOIN us_stations s
),
ranked AS (
  SELECT *, row_number() OVER (PARTITION BY airport_id ORDER BY dist_km) AS rn FROM dist
),
airport_station AS (
  SELECT airport_id, station_id, dist_km FROM ranked WHERE rn = 1 AND dist_km <= {MAX_DIST_KM}
),
station_year AS (
  SELECT ID AS station_id, year(`YEAR/MONTH/DAY`) AS yr,
    ROUND(AVG(CASE WHEN ELEMENT='TMAX' THEN `DATA VALUE` END)/10.0, 2) AS wx_avg_tmax_c,
    ROUND(AVG(CASE WHEN ELEMENT='TMIN' THEN `DATA VALUE` END)/10.0, 2) AS wx_avg_tmin_c,
    CAST(ROUND(COALESCE(SUM(CASE WHEN ELEMENT='PRCP' THEN `DATA VALUE` END),0)/10.0, 1) AS DOUBLE) AS wx_total_precip_mm,
    COUNT(CASE WHEN ELEMENT='PRCP' AND `DATA VALUE` > 0 THEN 1 END)    AS wx_precip_days,
    CAST(ROUND(COALESCE(SUM(CASE WHEN ELEMENT='SNOW' THEN `DATA VALUE` END),0), 1) AS DOUBLE) AS wx_total_snow_mm,
    COUNT(CASE WHEN ELEMENT='SNOW' AND `DATA VALUE` > 0 THEN 1 END)    AS wx_snow_days,
    ROUND(AVG(CASE WHEN ELEMENT='AWND' THEN `DATA VALUE` END)/10.0, 2) AS wx_avg_wind_ms,
    COUNT(CASE WHEN ELEMENT='WT01' THEN 1 END)                         AS wx_fog_days,
    COUNT(CASE WHEN ELEMENT='WT03' THEN 1 END)                         AS wx_thunder_days
  FROM read_files('{VOL}/weather_1988_2008.parquet', format => 'parquet')
  WHERE ID IN (SELECT station_id FROM airport_station)
    AND ELEMENT IN ('TMAX','TMIN','PRCP','SNOW','AWND','WT01','WT03')
    AND (`Q-FLAG` IS NULL OR `Q-FLAG` = '')
    AND year(`YEAR/MONTH/DAY`) BETWEEN 1988 AND 2007
  GROUP BY ID, year(`YEAR/MONTH/DAY`)
)
SELECT m.airport_id,
       CAST(sy.yr AS BIGINT) AS flight_year,
       make_timestamp(sy.yr + 1, 1, 1, 0, 0, 0) AS event_timestamp,
       sy.wx_avg_tmax_c, sy.wx_avg_tmin_c, sy.wx_total_precip_mm, sy.wx_precip_days,
       sy.wx_total_snow_mm, sy.wx_snow_days, sy.wx_avg_wind_ms, sy.wx_fog_days, sy.wx_thunder_days
FROM station_year sy JOIN airport_station m ON sy.station_id = m.station_id
""")
except Exception as e:
    print(f"   !! skipped airport_weather_stats (weather parquet not ready?): {str(e)[:180]}", flush=True)

# ---- report ----------------------------------------------------------------
print("\n=== row counts ===", flush=True)
for t in ["flights", "airport_locations", "airport_origin_stats", "carrier_stats",
          "route_stats", "airport_weather_stats"]:
    try:
        run(t, f"SELECT COUNT(*) FROM {FQ}.{t}", fetch=True)
    except Exception as e:
        print(f"   {t}: not built ({str(e)[:80]})", flush=True)

# ---- sync the SMALL feature tables UC -> local parquet ---------------------
# Feast's file offline store reads these parquet snapshots. Only the post-
# aggregation result (a few thousand rows/table) leaves Databricks; all heavy
# compute already ran on the warehouse above. airport_locations is synced too
# for the Streamlit map.
print("\n=== sync UC Delta -> feature_repo/data/*.parquet ===", flush=True)
for t in ["airport_origin_stats", "carrier_stats", "route_stats",
          "airport_weather_stats", "airport_locations", "carrier_names"]:
    try:
        cur.execute(f"SELECT * FROM {FQ}.{t}")
        df = cur.fetchall_arrow().to_pandas()
        path = os.path.join(OUT, f"{t}.parquet")
        df.to_parquet(path, index=False)
        print(f"   {t:24s} {len(df):>7,} rows -> data/{t}.parquet", flush=True)
    except Exception as e:
        print(f"   {t:24s} SKIPPED ({str(e)[:80]})", flush=True)

cur.close(); conn.close()
print("\nDONE.", flush=True)
