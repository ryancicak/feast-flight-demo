"""Feast feature definitions for the flight-delay demo.

Entities: airport (origin), carrier, route (origin->dest).
Offline source: parquet built by scripts/build_features.py.
Online store: Lakebase Postgres (see feature_store.yaml).

Serving story: at flight departure we know origin, carrier, and route. We
fetch each entity's historical delay profile from the online store to feed a
delay-risk model.
"""
import os
from datetime import timedelta

from feast import Entity, FeatureView, Field, FileSource, FeatureService
from feast.types import Float32, Int64

DATA = os.path.join(os.path.dirname(__file__), "data")

# ---- Entities --------------------------------------------------------------
airport = Entity(name="airport", join_keys=["airport_id"],
                 description="Origin airport IATA code, e.g. ORD")
carrier = Entity(name="carrier", join_keys=["carrier_id"],
                 description="Carrier code, e.g. AA")
route = Entity(name="route", join_keys=["route_id"],
               description="Origin-Dest pair, e.g. ORD-LAX")
year = Entity(name="year", join_keys=["flight_year"],
              description="Calendar year of the snapshot, e.g. 2007 — makes every "
                          "year of the 20-year history individually servable online")

# ---- Offline sources -------------------------------------------------------
airport_src = FileSource(
    name="airport_origin_stats_src",
    path=os.path.join(DATA, "airport_origin_stats.parquet"),
    timestamp_field="event_timestamp",
)
carrier_src = FileSource(
    name="carrier_stats_src",
    path=os.path.join(DATA, "carrier_stats.parquet"),
    timestamp_field="event_timestamp",
)
route_src = FileSource(
    name="route_stats_src",
    path=os.path.join(DATA, "route_stats.parquet"),
    timestamp_field="event_timestamp",
)
airport_weather_src = FileSource(
    name="airport_weather_stats_src",
    path=os.path.join(DATA, "airport_weather_stats.parquet"),
    timestamp_field="event_timestamp",
)

# ---- Feature views ---------------------------------------------------------
# Static historical dataset (ends 2008) served "today": use a very long TTL so
# the latest yearly snapshot is never considered stale at online read time.
TTL = timedelta(days=36500)

airport_origin_stats = FeatureView(
    name="airport_origin_stats",
    entities=[airport, year],
    ttl=TTL,
    source=airport_src,
    online=True,
    schema=[
        Field(name="origin_flights", dtype=Int64),
        Field(name="origin_avg_arr_delay", dtype=Float32),
        Field(name="origin_delay_rate_15", dtype=Float32),
        Field(name="origin_avg_distance", dtype=Float32),
        Field(name="origin_avg_elapsed_min", dtype=Float32),
    ],
)

carrier_stats = FeatureView(
    name="carrier_stats",
    entities=[carrier, year],
    ttl=TTL,
    source=carrier_src,
    online=True,
    schema=[
        Field(name="carrier_flights", dtype=Int64),
        Field(name="carrier_avg_arr_delay", dtype=Float32),
        Field(name="carrier_delay_rate_15", dtype=Float32),
        Field(name="carrier_ontime_pct", dtype=Float32),
    ],
)

route_stats = FeatureView(
    name="route_stats",
    entities=[route],
    ttl=timedelta(days=36500),  # lifetime profile, always valid
    source=route_src,
    online=True,
    schema=[
        Field(name="route_flights", dtype=Int64),
        Field(name="route_avg_arr_delay", dtype=Float32),
        Field(name="route_delay_rate_15", dtype=Float32),
        Field(name="route_distance", dtype=Float32),
    ],
)

# Per-origin-airport yearly weather climate, keyed on the same airport entity as
# airport_origin_stats. Derived from raw GHCN-Daily via the nearest on-airport
# weather station (see scripts/build_weather_features.py). Same point-in-time
# convention: year Y stamped Jan 1 (Y+1).
airport_weather_stats = FeatureView(
    name="airport_weather_stats",
    entities=[airport, year],
    ttl=TTL,
    source=airport_weather_src,
    online=True,
    schema=[
        Field(name="wx_avg_tmax_c", dtype=Float32),
        Field(name="wx_avg_tmin_c", dtype=Float32),
        Field(name="wx_total_precip_mm", dtype=Float32),
        Field(name="wx_precip_days", dtype=Int64),
        Field(name="wx_total_snow_mm", dtype=Float32),
        Field(name="wx_snow_days", dtype=Int64),
        Field(name="wx_avg_wind_ms", dtype=Float32),
        Field(name="wx_fog_days", dtype=Int64),
        Field(name="wx_thunder_days", dtype=Int64),
    ],
)

# ---- Feature service (what the model requests at serving time) -------------
flight_delay_v1 = FeatureService(
    name="flight_delay_v1",
    features=[airport_origin_stats, carrier_stats, route_stats, airport_weather_stats],
)
