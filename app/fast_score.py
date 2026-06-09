"""Single-round-trip scoring against the Lakebase online store.

Feast 0.63 issues one online read PER feature view. flight_delay_v1 spans four
views across three entity grains (origin and weather by airport+year, carrier by
carrier+year, route by route), so get_online_features does 3-4 reads and ~20ms of
Python serving overhead even though the database part is single-digit ms.

All of those features already live in the same Lakebase Postgres online store that
Feast materialized, in tables keyed by Feast's serialized entity key. Here we
reproduce those keys with Feast's own serializer and read all four tables in ONE
SQL UNION, so a score is a single round trip (~6ms in region). Same store, same
data, one query.
"""
import threading
import psycopg
from feast.protos.feast.types.EntityKey_pb2 import EntityKey
from feast.protos.feast.types.Value_pb2 import Value
from feast.infra.online_stores.helpers import serialize_entity_key

import lakebase_app

# Online tables Feast created (project prefix `flight_demo`).
T_ORIGIN = "flight_demo_airport_origin_stats"
T_WEATHER = "flight_demo_airport_weather_stats"
T_CARRIER = "flight_demo_carrier_stats"
T_ROUTE = "flight_demo_route_stats"

# Every feature the service returns, so a missing row (e.g. no weather for a year)
# comes back as None instead of a missing key, matching get_online_features.
ALL_FEATURES = [
    "origin_avg_arr_delay", "origin_avg_distance", "origin_avg_elapsed_min",
    "origin_delay_rate_15", "origin_flights",
    "wx_avg_tmax_c", "wx_avg_tmin_c", "wx_avg_wind_ms", "wx_fog_days",
    "wx_precip_days", "wx_snow_days", "wx_thunder_days", "wx_total_precip_mm",
    "wx_total_snow_mm",
    "carrier_avg_arr_delay", "carrier_delay_rate_15", "carrier_flights",
    "carrier_ontime_pct",
    "route_avg_arr_delay", "route_delay_rate_15", "route_distance", "route_flights",
]

_SQL = f'''
SELECT feature_name, value FROM "{T_ORIGIN}"  WHERE entity_key = %(ay)s
UNION ALL
SELECT feature_name, value FROM "{T_WEATHER}" WHERE entity_key = %(ay)s
UNION ALL
SELECT feature_name, value FROM "{T_CARRIER}" WHERE entity_key = %(cy)s
UNION ALL
SELECT feature_name, value FROM "{T_ROUTE}"   WHERE entity_key = %(r)s
'''

_conn = None
_lock = threading.Lock()


def _connect():
    host, token, user = lakebase_app.credentials()
    return psycopg.connect(host=host, port=5432, dbname="feast", user=user,
                           password=token, sslmode="require", autocommit=True)


def _ek(join_keys, values):
    return serialize_entity_key(
        EntityKey(join_keys=join_keys, entity_values=values),
        entity_key_serialization_version=3,
    )


def _decode(val):
    v = Value()
    v.ParseFromString(bytes(val))
    f = v.WhichOneof("val")
    return getattr(v, f) if f else None


def _params(origin, carrier, route, year):
    y = int(year)
    return {
        "ay": _ek(["airport_id", "flight_year"],
                  [Value(string_val=origin), Value(int64_val=y)]),
        "cy": _ek(["carrier_id", "flight_year"],
                  [Value(string_val=carrier), Value(int64_val=y)]),
        "r": _ek(["route_id"], [Value(string_val=route)]),
    }


def read_features(origin, carrier, route, year):
    """All flight_delay_v1 features for one flight, in a single Lakebase query."""
    global _conn
    params = _params(origin, carrier, route, year)
    with _lock:
        try:
            if _conn is None or _conn.closed:
                _conn = _connect()
            cur = _conn.cursor()
            cur.execute(_SQL, params)
            rows = cur.fetchall()
        except (psycopg.OperationalError, psycopg.InterfaceError):
            # connection dropped or token rotated: reconnect once and retry
            try:
                if _conn is not None and not _conn.closed:
                    _conn.close()
            except Exception:
                pass
            _conn = _connect()
            cur = _conn.cursor()
            cur.execute(_SQL, params)
            rows = cur.fetchall()

    out = {f: None for f in ALL_FEATURES}
    for fn, val in rows:
        out[fn] = _decode(val)
    return out


def warm():
    """Open the connection so the first real score is warm (skips TLS setup)."""
    try:
        read_features("ORD", "AA", "ORD-LAX", 2007)
    except Exception:
        pass
