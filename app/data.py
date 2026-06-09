"""Data access for the dashboard API.

Per-flight scoring goes through Feast to the Lakebase Postgres ONLINE store
(live, per-year). Whole-fleet views (map, leaderboard, trends) read the offline
feature parquet — the same feature data, all airports/years at once.
"""
import asyncio
import functools
import os
import threading
import time
import pandas as pd
from feast import FeatureStore

import lakebase_app
import fast_score

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "feature_repo"))
DATA = os.path.join(REPO, "data")
SERVICE = "flight_delay_v1"

# Lakebase OAuth tokens live ~1h. We render feature_store.yaml with a fresh
# token and recreate the FeatureStore well before expiry (background refresh),
# plus a lazy re-render + single retry if a read hits an auth/connection error.
_REFRESH_SECONDS = 40 * 60  # 40 min — comfortably under the ~1h token lifetime
_store_lock = threading.Lock()
_store_obj: FeatureStore | None = None
_refresher_started = False

# A single, long-lived asyncio loop on its own daemon thread. Feast's async
# Postgres path caches a psycopg AsyncConnectionPool bound to the loop it was
# opened on, so every async read MUST run on the same loop — calling
# asyncio.run() per request (a fresh loop each time) leaves the pool bound to a
# dead loop and hangs. We open one loop here and dispatch coroutines onto it
# with run_coroutine_threadsafe from FastAPI's (sync) request threads.
_loop: asyncio.AbstractEventLoop | None = None
_loop_lock = threading.Lock()


def _get_loop() -> asyncio.AbstractEventLoop:
    global _loop
    with _loop_lock:
        if _loop is None:
            loop = asyncio.new_event_loop()
            t = threading.Thread(target=loop.run_forever, name="feast-async-loop",
                                 daemon=True)
            t.start()
            _loop = loop
        return _loop


def _build_store() -> FeatureStore:
    """Render feature_store.yaml with a fresh token, then init the FeatureStore.

    Eagerly fire one async read on the shared loop so the psycopg pool opens its
    min_conn connections (4 warm TLS sessions) and Feast's async code paths are
    JIT-warmed before the first user score — that removes the cold-start spike
    on the first scored flight. Failures here are non-fatal (the lazy retry path
    still covers a bad/expired token).
    """
    host, user = lakebase_app.render()
    print(f"[lakebase] rendered feature_store.yaml host={host} user={user} "
          f"mode={'app' if lakebase_app.IS_APP else 'local'}", flush=True)
    store = FeatureStore(repo_path=REPO)
    try:
        warm_rows = [{"airport_id": "ORD", "carrier_id": "AA",
                      "route_id": "ORD-LAX", "flight_year": 2007}]
        fut = asyncio.run_coroutine_threadsafe(
            _online_read_async(store, warm_rows), _get_loop())
        fut.result(timeout=20)
        print("[lakebase] warmed online-store connection pool", flush=True)
    except Exception as e:
        print(f"[lakebase] pool warm-up skipped (non-fatal): {e}", flush=True)
    # Warm the single-query fast path too (opens its own Lakebase connection).
    fast_score.warm()
    return store


def _store() -> FeatureStore:
    global _store_obj, _refresher_started
    with _store_lock:
        if _store_obj is None:
            _store_obj = _build_store()
            if not _refresher_started:
                _start_refresher()
                _refresher_started = True
        return _store_obj


def _refresh_store():
    global _store_obj
    new = _build_store()
    with _store_lock:
        _store_obj = new


def _start_refresher():
    def loop():
        while True:
            time.sleep(_REFRESH_SECONDS)
            try:
                _refresh_store()
                print("[lakebase] refreshed token + FeatureStore", flush=True)
            except Exception as e:  # never let the refresher kill the app
                print(f"[lakebase] refresh failed (will retry): {e}", flush=True)

    t = threading.Thread(target=loop, name="lakebase-token-refresh", daemon=True)
    t.start()


@functools.lru_cache(maxsize=1)
def _frames():
    rd = lambda t: pd.read_parquet(os.path.join(DATA, f"{t}.parquet"))
    origin = rd("airport_origin_stats")
    weather = rd("airport_weather_stats")
    carrier = rd("carrier_stats")
    loc = rd("airport_locations")
    names = rd("carrier_names")
    name_map = dict(zip(names.carrier_id, names.carrier_name))
    return origin, weather, carrier, loc, name_map


def years() -> list[int]:
    origin, *_ = _frames()
    return sorted(int(y) for y in origin.flight_year.unique())


def carrier_name(code: str) -> str:
    *_, name_map = _frames()
    return name_map.get(code, code)


def meta() -> dict:
    origin, weather, carrier, loc, name_map = _frames()
    served = sorted(set(origin.airport_id) & set(loc.airport_id))
    locs = loc.set_index("airport_id")
    airports = [
        {"code": a, "name": locs.loc[a, "name"], "city": locs.loc[a, "city"],
         "lat": float(locs.loc[a, "lat"]), "lon": float(locs.loc[a, "lon"])}
        for a in served
    ]
    carriers = sorted(
        ({"code": c, "name": name_map.get(c, c)} for c in carrier.carrier_id.unique()),
        key=lambda d: d["name"],
    )
    return {"years": years(), "airports": airports, "carriers": carriers}


def map_for_year(year: int) -> list[dict]:
    origin, weather, carrier, loc, name_map = _frames()
    o = origin[origin.flight_year == year]
    w = weather[weather.flight_year == year]
    df = o.merge(loc, on="airport_id", how="inner").merge(
        w.drop(columns=["event_timestamp"]), on=["airport_id", "flight_year"], how="left"
    )
    out = []
    for r in df.itertuples():
        out.append({
            "code": r.airport_id, "name": r.name, "city": r.city,
            "lat": float(r.lat), "lon": float(r.lon),
            "flights": int(r.origin_flights),
            "avg_delay": _f(r.origin_avg_arr_delay),
            "delay_rate": _f(r.origin_delay_rate_15),
            "snow_days": _i(getattr(r, "wx_snow_days", None)),
            "precip_days": _i(getattr(r, "wx_precip_days", None)),
            "fog_days": _i(getattr(r, "wx_fog_days", None)),
            "thunder_days": _i(getattr(r, "wx_thunder_days", None)),
            "tmax": _f(getattr(r, "wx_avg_tmax_c", None)),
        })
    return out


def carriers_for_year(year: int) -> list[dict]:
    origin, weather, carrier, loc, name_map = _frames()
    c = carrier[carrier.flight_year == year]
    rows = [{
        "code": r.carrier_id, "name": name_map.get(r.carrier_id, r.carrier_id),
        "flights": int(r.carrier_flights),
        "avg_delay": _f(r.carrier_avg_arr_delay),
        "delay_rate": _f(r.carrier_delay_rate_15),
        "ontime_pct": _f(r.carrier_ontime_pct),
    } for r in c.itertuples()]
    return sorted(rows, key=lambda d: (d["avg_delay"] is None, d["avg_delay"]))


def airport_trend(code: str) -> dict:
    origin, weather, carrier, loc, name_map = _frames()
    o = origin[origin.airport_id == code].sort_values("flight_year")
    w = weather[weather.airport_id == code].set_index("flight_year")
    series = []
    for r in o.itertuples():
        wr = w.loc[r.flight_year] if r.flight_year in w.index else None
        series.append({
            "year": int(r.flight_year),
            "avg_delay": _f(r.origin_avg_arr_delay),
            "delay_rate": _f(r.origin_delay_rate_15),
            "flights": int(r.origin_flights),
            "snow_days": _i(wr.wx_snow_days) if wr is not None else None,
            "fog_days": _i(wr.wx_fog_days) if wr is not None else None,
        })
    locs = loc.set_index("airport_id")
    name = locs.loc[code, "name"] if code in locs.index else code
    return {"code": code, "name": name, "series": series}


def _online_read(store: FeatureStore, rows: list[dict]) -> dict:
    # The feature service spans 4 feature views (origin / carrier / route /
    # weather). The SYNC path issues one SELECT per view *sequentially* over a
    # single connection (~4 round-trips). The ASYNC path fans the 4 reads out
    # with asyncio.gather (see feast online_store.get_online_features_async), so
    # with conn_type=pool they hit Lakebase concurrently — collapsing ~4
    # round-trips into ~1 and cutting warm latency well under the sync number.
    # Run on the shared persistent loop (see _get_loop) so the async pool stays
    # bound to one live event loop across requests.
    fut = asyncio.run_coroutine_threadsafe(_online_read_async(store, rows), _get_loop())
    return fut.result(timeout=30)


async def _online_read_async(store: FeatureStore, rows: list[dict]) -> dict:
    resp = await store.get_online_features_async(
        features=store.get_feature_service(SERVICE), entity_rows=rows
    )
    return resp.to_dict()


def score(origin: str, dest: str, carrier: str, year: int) -> dict:
    store = _store()
    rows = [{"airport_id": origin, "carrier_id": carrier,
             "route_id": f"{origin}-{dest}", "flight_year": int(year)}]
    t0 = time.perf_counter()
    try:
        feats = _online_read(store, rows)
    except Exception as e:
        # Likely an expired token (auth/OperationalError). Re-render + retry once.
        print(f"[lakebase] online read failed, refreshing token + retrying: {e}", flush=True)
        _refresh_store()
        store = _store()
        t0 = time.perf_counter()
        feats = _online_read(store, rows)
    latency_ms = round((time.perf_counter() - t0) * 1000, 1)  # the live Lakebase round-trip
    out = {k: (v[0] if v else None) for k, v in feats.items()}
    parts = [out.get("origin_delay_rate_15"), out.get("carrier_delay_rate_15"), out.get("route_delay_rate_15")]
    parts = [p for p in parts if p is not None]
    out["blended_delay_risk"] = (sum(parts) / len(parts)) if parts else None
    out["carrier_name"] = carrier_name(carrier)
    out["year"] = int(year)
    out["latency_ms"] = latency_ms
    out["mode"] = "feast"
    return out


def score_fast(origin: str, dest: str, carrier: str, year: int) -> dict:
    """Same score, but reads every feature in ONE Lakebase query (see fast_score).

    Cuts the 4-feature-view, ~20ms get_online_features path down to a single
    round trip. The store, the data, and the result are identical.
    """
    route = f"{origin}-{dest}"
    t0 = time.perf_counter()
    try:
        feats = fast_score.read_features(origin, carrier, route, int(year))
    except Exception as e:
        print(f"[lakebase] fast read failed, refreshing token + retrying: {e}", flush=True)
        _refresh_store()  # re-renders feature_store.yaml, which re-mints the token
        feats = fast_score.read_features(origin, carrier, route, int(year))
    latency_ms = round((time.perf_counter() - t0) * 1000, 1)

    out = dict(feats)
    out["airport_id"] = origin
    out["carrier_id"] = carrier
    out["route_id"] = route
    out["flight_year"] = int(year)
    parts = [out.get("origin_delay_rate_15"), out.get("carrier_delay_rate_15"),
             out.get("route_delay_rate_15")]
    parts = [p for p in parts if p is not None]
    out["blended_delay_risk"] = (sum(parts) / len(parts)) if parts else None
    out["carrier_name"] = carrier_name(carrier)
    out["year"] = int(year)
    out["latency_ms"] = latency_ms
    out["mode"] = "fast"
    return out


def _f(v):
    return None if v is None or (isinstance(v, float) and pd.isna(v)) else round(float(v), 3)


def _i(v):
    return None if v is None or pd.isna(v) else int(v)
