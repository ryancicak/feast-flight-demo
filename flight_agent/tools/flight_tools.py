"""Omnigent function tools that expose the flight-delay demo's live
Lakebase feature serving as agent tools.

These are thin wrappers over the demo's existing serving code in
``app/data.py`` (the same module the FastAPI app and the deployed Databricks
App call). They read a flight's features from the Lakebase Postgres ONLINE
store via Feast -- one entity at a time, the fast single-query path measured at
~7 ms in region -- plus the whole-fleet offline views (leaderboard, trend) used
by the dashboard.

Each callable here is referenced from ``flight-ops-agent.yaml`` as a
``type: function`` tool. Omnigent calls the callable with the JSON arguments the
model produced; the JSON-schema for those arguments is declared in the YAML
(under each tool's ``parameters:`` block), NOT inferred from these signatures,
so keep the two in sync.

Why wrap rather than hit the running app over HTTP: the deployed Databricks App
sits behind workspace OAuth (a GET to it 302-redirects to the OIDC authorize
endpoint), so an agent tool can't anonymously curl it. Importing the serving
module directly reuses the exact same Feast + Lakebase code path, mints its own
short-lived Lakebase token, and returns the structured score the dashboard
shows -- no second auth hop.

Return values are plain JSON-serializable dicts/lists so Omnigent can hand them
straight back to the model as the tool result.
"""
from __future__ import annotations

import os
import sys

# app/data.py imports its sibling modules by bare name (``import lakebase_app``,
# ``import fast_score``) because the FastAPI app runs with app/ as the working
# dir. Put app/ on sys.path so those bare imports resolve when Omnigent imports
# this tool module from anywhere.
_REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
_APP_DIR = os.path.join(_REPO_ROOT, "app")
if _APP_DIR not in sys.path:
    sys.path.insert(0, _APP_DIR)

import data  # app/data.py -- the demo's own serving layer


def score_flight(origin: str, dest: str, carrier: str, year: int,
                 mode: str = "fast") -> dict:
    """Score one flight live from the Lakebase Postgres online store via Feast.

    Args mirror the dashboard's score-a-flight control:
      origin / dest -- airport codes, e.g. "ORD", "LAX"
      carrier       -- carrier code, e.g. "AA"
      year          -- year is part of the entity key (1988-2007), so the same
                       route can be scored "in 1995" vs "in 2007"
      mode          -- "fast" reads every feature in ONE Lakebase query
                       (~7 ms in region); "feast" uses Feast's
                       get_online_features (one read per view). Same result.

    Returns the full feature dict the dashboard shows, including the blended
    delay risk, the carrier name, and ``latency_ms`` (the live Lakebase
    round-trip), so the agent can both reason over the features and report the
    measured serving latency.
    """
    fn = data.score if mode == "feast" else data.score_fast
    return fn(origin, dest, carrier, int(year))


def carrier_leaderboard(year: int) -> list[dict]:
    """Carrier on-time leaderboard for a year, sorted best-to-worst avg delay.

    Reads the offline feature parquet held in memory (the same whole-fleet view
    the dashboard leaderboard uses) -- no per-entity online read. Each row has
    the carrier code + name, flights flown, average arrival delay, delay rate,
    and on-time percentage.
    """
    return data.carriers_for_year(int(year))


def airport_delay_trend(code: str) -> dict:
    """Year-over-year delay trend for one airport (1988-2007).

    Returns the airport code, name, and a per-year series of average delay,
    delay rate, flights, and a couple of weather counters -- the series behind
    the dashboard's airport trend chart. Offline parquet, no online read.
    """
    return data.airport_trend(code)


def list_entities() -> dict:
    """List the airports, carriers, and years the online store can score.

    Useful as the agent's first call so it scores only real entity keys
    (airport codes, carrier codes, and in-range years) rather than guessing.
    """
    return data.meta()
