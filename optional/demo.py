"""Feast retrieval demos — both sides of the feature store.

  python scripts/demo.py serve   # ONLINE: get_online_features() from Lakebase Postgres
  python scripts/demo.py train   # OFFLINE: get_historical_features() point-in-time join

`serve` simulates scoring flights about to depart (we know only origin/carrier/
route). `train` shows time-travel correctness: the same route on two dates joins
to the snapshot available as of each date, never leaking future stats.
"""
import argparse
import os
import pandas as pd
from feast import FeatureStore

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "feature_repo"))
SERVICE = "flight_delay_v1"

# Each flight also carries the year — features are per-year, so the online store
# serves that specific year's profile (any of the 20 years, not just the latest).
FLIGHTS = [
    {"airport_id": "ORD", "carrier_id": "AA", "route_id": "ORD-LAX", "flight_year": 2007},
    {"airport_id": "ATL", "carrier_id": "DL", "route_id": "ATL-JFK", "flight_year": 2007},
    {"airport_id": "DEN", "carrier_id": "UA", "route_id": "DEN-SFO", "flight_year": 2007},
]


def serve():
    store = FeatureStore(repo_path=REPO)
    feats = store.get_online_features(
        features=store.get_feature_service(SERVICE), entity_rows=FLIGHTS,
    ).to_dict()
    keys = [k for k in feats if k not in ("airport_id", "carrier_id", "route_id")]
    print("Online feature retrieval from Lakebase (feature_service=flight_delay_v1)\n")
    for i, f in enumerate(FLIGHTS):
        print(f"Flight {i+1}: {f['carrier_id']} {f['route_id']} (depart {f['airport_id']})")
        for k in keys:
            print(f"    {k:26s} = {feats[k][i]}")
        parts = [feats[k][i] for k in ("origin_delay_rate_15", "carrier_delay_rate_15", "route_delay_rate_15")]
        parts = [p for p in parts if p is not None]
        if parts:
            print(f"    >> blended delay-risk (>15min) = {sum(parts)/len(parts):.1%}")
        print()


def train():
    store = FeatureStore(repo_path=REPO)
    entity_df = pd.DataFrame({
        "airport_id": ["ORD", "ORD", "ATL", "DEN"],
        "carrier_id": ["AA", "AA", "DL", "UA"],
        "route_id": ["ORD-LAX", "ORD-LAX", "ATL-JFK", "DEN-SFO"],
        "flight_year": [1995, 2007, 2003, 2008],
        "event_timestamp": pd.to_datetime(["1997-06-15", "2009-06-15", "2005-06-15", "2010-06-15"]),
    })
    training_df = store.get_historical_features(
        entity_df=entity_df, features=store.get_feature_service(SERVICE),
    ).to_df()
    pd.set_option("display.width", 220); pd.set_option("display.max_columns", 50)
    print("Point-in-time training set (get_historical_features):\n")
    print(training_df.to_string(index=False))
    print("\nNote: ORD in 1995 vs 2007 fetches different yearly snapshots — the 20-year "
          "history is fully addressable, point-in-time correct, no leakage.")


if __name__ == "__main__":
    p = argparse.ArgumentParser(description="Feast retrieval demos")
    p.add_argument("mode", choices=["serve", "train"])
    args = p.parse_args()
    (serve if args.mode == "serve" else train)()
